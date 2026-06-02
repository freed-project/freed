/**
 * Google Drive cloud sync for Freed.
 *
 * Stores a single `freed.automerge` binary in the Drive AppData folder.
 * Every write uses a download → CRDT-merge → upload cycle guarded by an
 * If-Match ETag so concurrent writes from multiple devices produce a merged
 * result rather than data loss.
 *
 * Poll interval: 5 s via the Changes API cursor (no long-poll on GDrive).
 */

import { mergeBinaries, delay } from "./merge.js";

const FILE_NAME = "freed.automerge";
const GDRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const GDRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const GDRIVE_CHANGES = "https://www.googleapis.com/drive/v3/changes";
const POLL_MS = 5_000;
const MAX_RETRIES = 3;
/** Per-iteration network timeout. Prevents a stalled fetch from freezing the loop. */
const ITERATION_TIMEOUT_MS = 90_000;
const HEARTBEAT_EVERY_N_ITERS = 120; // every 120 * 5 s = 10 minutes
export type GoogleDriveFetch = typeof fetch;

function parseGoogleDriveErrorBody(body: string): string | null {
  if (!body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: unknown;
        status?: unknown;
        errors?: Array<{ reason?: unknown; message?: unknown }>;
      };
    };
    const googleMessage = typeof parsed.error?.message === "string"
      ? parsed.error.message
      : null;
    const reason = typeof parsed.error?.errors?.[0]?.reason === "string"
      ? parsed.error.errors[0].reason
      : null;
    if (googleMessage && reason) return `${googleMessage} (${reason})`;
    if (googleMessage) return googleMessage;
    if (reason) return reason;
  } catch {
    // Fall through to a trimmed plain text body.
  }
  return body.trim().slice(0, 500);
}

async function gdriveError(message: string, response: Response): Promise<Error & { status: number }> {
  const body = await response.text().catch(() => "");
  const detail = parseGoogleDriveErrorBody(body);
  const statusLabel = response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status);
  const fullMessage = detail
    ? `${message}: ${statusLabel} - ${detail}`
    : `${message}: ${statusLabel}`;
  return Object.assign(new Error(fullMessage), { status: response.status });
}

interface DownloadResult {
  binary: Uint8Array | null;
  etag: string | null;
  fileId: string;
}

export interface CloudUploadResult {
  fileId: string;
  uploadedBinary: Uint8Array;
  uploadedBytes: number;
  remoteBytes: number;
  mergedRemote: boolean;
}

/** Return the fileId of `freed.automerge` in appDataFolder, creating it if absent. */
async function ensureFile(
  token: string,
  signal?: AbortSignal,
  googleFetch: GoogleDriveFetch = fetch,
): Promise<string> {
  const listRes = await googleFetch(
    `${GDRIVE_FILES}?spaces=appDataFolder&q=name%3D'${FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!listRes.ok) throw await gdriveError("GDrive list failed", listRes);

  const { files } = await listRes.json();
  if (files.length > 0) return files[0].id as string;

  const createRes = await googleFetch(GDRIVE_FILES, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] }),
    signal,
  });
  if (!createRes.ok) throw await gdriveError("GDrive create failed", createRes);

  const { id } = await createRes.json();
  return id as string;
}

async function download(
  token: string,
  fileId: string,
  signal?: AbortSignal,
  googleFetch: GoogleDriveFetch = fetch,
): Promise<DownloadResult> {
  const metaRes = await googleFetch(
    `${GDRIVE_FILES}/${fileId}?fields=md5Checksum,size`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!metaRes.ok) throw await gdriveError("GDrive meta failed", metaRes);
  const etag = metaRes.headers.get("ETag");
  const { size } = await metaRes.json();

  if (!size || size === "0") {
    return { binary: null, etag, fileId };
  }

  const contentRes = await googleFetch(`${GDRIVE_FILES}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!contentRes.ok) throw await gdriveError("GDrive download failed", contentRes);

  return {
    binary: new Uint8Array(await contentRes.arrayBuffer()),
    etag,
    fileId,
  };
}

/**
 * Safe upload: always download remote first, CRDT-merge, then upload with
 * If-Match so a concurrent desktop write returns 412 → retry with back-off.
 */
export async function gdriveUploadSafe(
  token: string,
  localBinary: Uint8Array,
  googleFetch: GoogleDriveFetch = fetch,
): Promise<CloudUploadResult> {
  const fileId = await ensureFile(token, undefined, googleFetch);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { binary: remoteBinary, etag } = await download(token, fileId, undefined, googleFetch);
    const merged = remoteBinary ? mergeBinaries(localBinary, remoteBinary) : localBinary;

    const res = await googleFetch(`${GDRIVE_UPLOAD}/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: merged as BodyInit,
    });

    if (res.ok) {
      return {
        fileId,
        uploadedBinary: merged,
        uploadedBytes: merged.byteLength,
        remoteBytes: remoteBinary?.byteLength ?? 0,
        mergedRemote: !!remoteBinary,
      };
    }
    if (res.status === 412) {
      await delay(200 * 2 ** attempt);
      continue;
    }
    throw await gdriveError("GDrive upload failed", res);
  }

  throw new Error("GDrive upload failed after max retries (concurrent write conflict)");
}

export async function gdriveDownloadLatest(
  token: string,
  signal?: AbortSignal,
  googleFetch: GoogleDriveFetch = fetch,
): Promise<Uint8Array | null> {
  const fileId = await ensureFile(token, signal, googleFetch);
  const { binary } = await download(token, fileId, signal, googleFetch);
  return binary;
}

/**
 * Permanently delete the `freed.automerge` file from Google Drive appDataFolder.
 * Used during factory reset when the user opts to also wipe cloud storage.
 * Silently succeeds if the file does not exist (404).
 */
export async function gdriveDeleteFile(
  token: string,
  googleFetch: GoogleDriveFetch = fetch,
): Promise<void> {
  const listRes = await googleFetch(
    `${GDRIVE_FILES}?spaces=appDataFolder&q=name%3D'${FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) throw await gdriveError("GDrive list failed", listRes);

  const { files } = await listRes.json();
  if (files.length === 0) return; // Nothing to delete.

  const deleteRes = await googleFetch(`${GDRIVE_FILES}/${files[0].id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw await gdriveError("GDrive delete failed", deleteRes);
  }
}

/**
 * Poll the GDrive Changes API every 5 s.
 * Uses a server-side page-token cursor so only genuine changes trigger a
 * download. Runs until `signal` is aborted.
 *
 * Each iteration is wrapped in a 90 s timeout so a stalled network request
 * on a sleeping machine cannot freeze the loop indefinitely. The optional
 * `onLog` callback receives warn/info messages for file-based logging by
 * the caller (packages/sync is platform-agnostic and cannot import Tauri).
 */
export async function gdriveStartPollLoop(
  token: string,
  onRemoteChange: (binary: Uint8Array) => void,
  signal: AbortSignal,
  onLog?: (level: "info" | "warn" | "error", msg: string) => void,
  googleFetch: GoogleDriveFetch = fetch,
): Promise<void> {
  const log = (level: "info" | "warn" | "error", msg: string) => onLog?.(level, msg);

  const startRes = await googleFetch(`${GDRIVE_CHANGES}/startPageToken`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!startRes.ok) throw await gdriveError("GDrive startPageToken failed", startRes);
  let { startPageToken: cursor } = await startRes.json();

  const fileId = await ensureFile(token, undefined, googleFetch);

  log("info", "[cloud/gdrive] poll loop started");
  let iterCount = 0;

  while (!signal.aborted) {
    await delay(POLL_MS);
    if (signal.aborted) break;

    iterCount++;
    if (iterCount % HEARTBEAT_EVERY_N_ITERS === 0) {
      log("info", `[cloud/gdrive] heartbeat iter=${iterCount}`);
    }

    try {
      // Combine the outer abort signal with a per-iteration timeout so a
      // stalled GDrive fetch doesn't hold the loop open overnight.
      const iterSignal = AbortSignal.any([signal, AbortSignal.timeout(ITERATION_TIMEOUT_MS)]);

      const changesRes = await googleFetch(
        `${GDRIVE_CHANGES}?pageToken=${cursor}&spaces=appDataFolder&fields=nextPageToken,newStartPageToken,changes(fileId)`,
        { headers: { Authorization: `Bearer ${token}` }, signal: iterSignal },
      );
      if (!changesRes.ok) {
        if (changesRes.status === 401 || changesRes.status === 403) {
          throw await gdriveError("GDrive changes failed", changesRes);
        }
        continue;
      }

      const data = await changesRes.json();
      cursor = data.newStartPageToken ?? data.nextPageToken ?? cursor;

      const changed = (data.changes as Array<{ fileId: string }>).some(
        (c) => c.fileId === fileId,
      );

      if (changed) {
        const binary = await gdriveDownloadLatest(token, iterSignal, googleFetch);
        if (binary) onRemoteChange(binary);
      }
    } catch (err) {
      if (signal.aborted) break;
      const status = typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
      if (status === 401 || status === 403) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      if (isTimeout) {
        log("warn", `[cloud/gdrive] poll iteration TIMEOUT iter=${iterCount}`);
      } else {
        log("warn", `[cloud/gdrive] poll error iter=${iterCount} err=${msg}`);
        console.error("[CloudSync/GDrive] Poll error:", err);
      }
    }
  }

  log("info", `[cloud/gdrive] poll loop stopped after ${iterCount} iterations`);
}
