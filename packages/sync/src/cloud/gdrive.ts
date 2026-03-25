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

interface DownloadResult {
  binary: Uint8Array | null;
  etag: string;
  fileId: string;
}

/** Return the fileId of `freed.automerge` in appDataFolder, creating it if absent. */
async function ensureFile(token: string, signal?: AbortSignal): Promise<string> {
  const listRes = await fetch(
    `${GDRIVE_FILES}?spaces=appDataFolder&q=name%3D'${FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!listRes.ok) throw new Error(`GDrive list failed: ${listRes.status}`);

  const { files } = await listRes.json();
  if (files.length > 0) return files[0].id as string;

  const createRes = await fetch(GDRIVE_FILES, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] }),
    signal,
  });
  if (!createRes.ok) throw new Error(`GDrive create failed: ${createRes.status}`);

  const { id } = await createRes.json();
  return id as string;
}

async function download(
  token: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const metaRes = await fetch(
    `${GDRIVE_FILES}/${fileId}?fields=md5Checksum,size`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!metaRes.ok) throw new Error(`GDrive meta failed: ${metaRes.status}`);
  const { md5Checksum, size } = await metaRes.json();

  if (!size || size === "0") {
    return { binary: null, etag: md5Checksum ?? "*", fileId };
  }

  const contentRes = await fetch(`${GDRIVE_FILES}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!contentRes.ok) throw new Error(`GDrive download failed: ${contentRes.status}`);

  return {
    binary: new Uint8Array(await contentRes.arrayBuffer()),
    etag: md5Checksum ?? "*",
    fileId,
  };
}

/**
 * Safe upload: always download remote first, CRDT-merge, then upload with
 * If-Match so a concurrent desktop write returns 412 → retry with back-off.
 */
export async function gdriveUploadSafe(token: string, localBinary: Uint8Array): Promise<void> {
  const fileId = await ensureFile(token);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { binary: remoteBinary, etag } = await download(token, fileId);
    const merged = remoteBinary ? mergeBinaries(localBinary, remoteBinary) : localBinary;

    const res = await fetch(`${GDRIVE_UPLOAD}/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "If-Match": etag,
      },
      body: merged as BodyInit,
    });

    if (res.ok) return;
    if (res.status === 412) {
      await delay(200 * 2 ** attempt);
      continue;
    }
    throw new Error(`GDrive upload failed: ${res.status}`);
  }

  throw new Error("GDrive upload failed after max retries (concurrent write conflict)");
}

export async function gdriveDownloadLatest(
  token: string,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const fileId = await ensureFile(token, signal);
  const { binary } = await download(token, fileId, signal);
  return binary;
}

/**
 * Permanently delete the `freed.automerge` file from Google Drive appDataFolder.
 * Used during factory reset when the user opts to also wipe cloud storage.
 * Silently succeeds if the file does not exist (404).
 */
export async function gdriveDeleteFile(token: string): Promise<void> {
  const listRes = await fetch(
    `${GDRIVE_FILES}?spaces=appDataFolder&q=name%3D'${FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) throw new Error(`GDrive list failed: ${listRes.status}`);

  const { files } = await listRes.json();
  if (files.length === 0) return; // Nothing to delete.

  const deleteRes = await fetch(`${GDRIVE_FILES}/${files[0].id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw new Error(`GDrive delete failed: ${deleteRes.status}`);
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
): Promise<void> {
  const log = (level: "info" | "warn" | "error", msg: string) => onLog?.(level, msg);

  const startRes = await fetch(`${GDRIVE_CHANGES}/startPageToken`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!startRes.ok) throw new Error(`GDrive startPageToken failed: ${startRes.status}`);
  let { startPageToken: cursor } = await startRes.json();

  const fileId = await ensureFile(token);

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

      const changesRes = await fetch(
        `${GDRIVE_CHANGES}?pageToken=${cursor}&spaces=drive&fields=nextPageToken,newStartPageToken,changes(fileId)`,
        { headers: { Authorization: `Bearer ${token}` }, signal: iterSignal },
      );
      if (!changesRes.ok) continue;

      const data = await changesRes.json();
      cursor = data.newStartPageToken ?? data.nextPageToken ?? cursor;

      const changed = (data.changes as Array<{ fileId: string }>).some(
        (c) => c.fileId === fileId,
      );

      if (changed) {
        const binary = await gdriveDownloadLatest(token, iterSignal);
        if (binary) onRemoteChange(binary);
      }
    } catch (err) {
      if (signal.aborted) break;
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
