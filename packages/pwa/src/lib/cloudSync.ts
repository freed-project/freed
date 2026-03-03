/**
 * Cloud file sync for Freed PWA.
 *
 * Both providers store a single `freed.automerge` binary in an app-scoped
 * folder. Every upload uses a download → merge → upload cycle protected by
 * optimistic locking (GDrive If-Match / Dropbox rev) so concurrent writes
 * from the desktop and phone can never silently lose each other's changes.
 *
 * Upload is debounced externally (see sync.ts). The loops here are driven by
 * an AbortSignal for clean teardown on unmount or provider disconnect.
 *
 * Security posture: OAuth tokens stored in localStorage; provider encrypts at
 * rest. E2E encryption of the binary is explicitly deferred per PHASE-4.
 */

import * as A from "@automerge/automerge";
import type { FreedDoc } from "@freed/shared/schema";

export type CloudProvider = "gdrive" | "dropbox";

const FILE_NAME = "freed.automerge";
const GDRIVE_POLL_MS = 5_000;
const DROPBOX_LONGPOLL_TIMEOUT_S = 60;
const MAX_RETRIES = 3;

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Merge two Automerge binaries and return the merged binary.
 * This is a pure function — it does not touch the global doc singleton.
 */
function mergeBinaries(a: Uint8Array, b: Uint8Array): Uint8Array {
  const docA = A.load<FreedDoc>(a);
  const docB = A.load<FreedDoc>(b);
  return A.save(A.merge(docA, docB));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── GDrive ───────────────────────────────────────────────────────────────────

const GDRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const GDRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const GDRIVE_CHANGES = "https://www.googleapis.com/drive/v3/changes";

interface GDriveDownloadResult {
  binary: Uint8Array | null;
  etag: string;
  fileId: string;
}

/** Return the fileId of `freed.automerge` in appDataFolder, creating it if absent. */
async function gdriveEnsureFile(token: string, signal?: AbortSignal): Promise<string> {
  const listRes = await fetch(
    `${GDRIVE_FILES}?spaces=appDataFolder&q=name%3D'${FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!listRes.ok) throw new Error(`GDrive list failed: ${listRes.status}`);

  const { files } = await listRes.json();
  if (files.length > 0) return files[0].id as string;

  const createRes = await fetch(`${GDRIVE_FILES}`, {
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

/**
 * Download `freed.automerge` and return the binary plus the ETag (MD5 checksum)
 * used for optimistic locking. If the file is empty, binary is null.
 */
async function gdriveDownload(
  token: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<GDriveDownloadResult> {
  // Fetch metadata for the ETag before downloading content.
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
 * If-Match so a concurrent write by the desktop returns 412 → we retry.
 */
export async function gdriveUploadSafe(token: string, localBinary: Uint8Array): Promise<void> {
  const fileId = await gdriveEnsureFile(token);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { binary: remoteBinary, etag } = await gdriveDownload(token, fileId);

    const merged = remoteBinary
      ? mergeBinaries(localBinary, remoteBinary)
      : localBinary;

    const res = await fetch(`${GDRIVE_UPLOAD}/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        // Optimistic lock: reject if someone else wrote since we downloaded.
        "If-Match": etag,
      },
      body: merged,
    });

    if (res.ok) return;

    if (res.status === 412) {
      // Precondition failed — concurrent write. Back off and retry.
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
  const fileId = await gdriveEnsureFile(token, signal);
  const { binary } = await gdriveDownload(token, fileId, signal);
  return binary;
}

/**
 * Poll the GDrive Changes API every 5 seconds.
 * Uses a server-side page-token cursor so we only process genuine changes.
 * Calls `onRemoteChange` when `freed.automerge` is updated by another device.
 */
export async function gdriveStartPollLoop(
  token: string,
  onRemoteChange: (binary: Uint8Array) => void,
  signal: AbortSignal,
): Promise<void> {
  // Obtain a page-token marking "now" so we only see future changes.
  const startRes = await fetch(`${GDRIVE_CHANGES}/startPageToken`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!startRes.ok) throw new Error(`GDrive startPageToken failed: ${startRes.status}`);
  let { startPageToken: cursor } = await startRes.json();

  const fileId = await gdriveEnsureFile(token);

  while (!signal.aborted) {
    await delay(GDRIVE_POLL_MS);
    if (signal.aborted) break;

    try {
      const changesRes = await fetch(
        `${GDRIVE_CHANGES}?pageToken=${cursor}&spaces=drive&fields=nextPageToken,newStartPageToken,changes(fileId)`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!changesRes.ok) continue;

      const data = await changesRes.json();
      cursor = data.newStartPageToken ?? data.nextPageToken ?? cursor;

      const changed = (data.changes as Array<{ fileId: string }>).some(
        (c) => c.fileId === fileId,
      );

      if (changed) {
        const binary = await gdriveDownloadLatest(token);
        if (binary) onRemoteChange(binary);
      }
    } catch (err) {
      console.error("[CloudSync/GDrive] Poll error:", err);
    }
  }
}

// ─── Dropbox ─────────────────────────────────────────────────────────────────

const DBX_UPLOAD = "https://content.dropboxapi.com/2/files/upload";
const DBX_DOWNLOAD = "https://content.dropboxapi.com/2/files/download";
const DBX_LIST_FOLDER = "https://api.dropboxapi.com/2/files/list_folder";
const DBX_LIST_FOLDER_CONTINUE = "https://api.dropboxapi.com/2/files/list_folder/continue";
const DBX_LONGPOLL = "https://notify.dropboxapi.com/2/files/list_folder/longpoll";
const DBX_PATH = `/Apps/Freed/${FILE_NAME}`;
const DBX_FOLDER = "/Apps/Freed";

interface DropboxDownloadResult {
  binary: Uint8Array | null;
  rev: string;
}

async function dropboxDownload(
  token: string,
  signal?: AbortSignal,
): Promise<DropboxDownloadResult> {
  const res = await fetch(DBX_DOWNLOAD, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path: DBX_PATH }),
    },
    signal,
  });

  if (res.status === 409) {
    // File does not exist yet — not an error on first run.
    return { binary: null, rev: "" };
  }
  if (!res.ok) throw new Error(`Dropbox download failed: ${res.status}`);

  const metaHeader = res.headers.get("Dropbox-API-Result");
  const meta = metaHeader ? (JSON.parse(metaHeader) as { rev: string }) : { rev: "" };

  return {
    binary: new Uint8Array(await res.arrayBuffer()),
    rev: meta.rev,
  };
}

/**
 * Safe upload: always download first, CRDT-merge, then upload with rev check.
 * A `conflict/wrong_rev` response means another device wrote first → retry.
 */
export async function dropboxUploadSafe(token: string, localBinary: Uint8Array): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { binary: remoteBinary, rev } = await dropboxDownload(token);

    const merged = remoteBinary
      ? mergeBinaries(localBinary, remoteBinary)
      : localBinary;

    // Use `overwrite` on first upload (rev === ""), `update` with rev check thereafter.
    const mode = rev
      ? { ".tag": "update" as const, update: rev }
      : { ".tag": "overwrite" as const };

    const res = await fetch(DBX_UPLOAD, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path: DBX_PATH, mode }),
      },
      body: merged,
    });

    if (res.ok) return;

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const tag = body?.error?.reason?.[".tag"];
      if (tag === "conflict") {
        await delay(200 * 2 ** attempt);
        continue;
      }
    }

    throw new Error(`Dropbox upload failed: ${res.status}`);
  }

  throw new Error("Dropbox upload failed after max retries (concurrent write conflict)");
}

export async function dropboxDownloadLatest(
  token: string,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const { binary } = await dropboxDownload(token, signal);
  return binary;
}

/**
 * Dropbox longpoll loop — near-instant change notification.
 * Blocks at the notify endpoint until the folder changes, then fetches the diff
 * and calls `onRemoteChange` if `freed.automerge` was updated.
 */
export async function dropboxStartLongpollLoop(
  token: string,
  onRemoteChange: (binary: Uint8Array) => void,
  signal: AbortSignal,
): Promise<void> {
  // Get initial cursor for the app folder.
  const listRes = await fetch(DBX_LIST_FOLDER, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: DBX_FOLDER, recursive: false }),
  });
  if (!listRes.ok) throw new Error(`Dropbox list_folder failed: ${listRes.status}`);

  let { cursor } = await listRes.json();

  while (!signal.aborted) {
    try {
      // Long-poll blocks until a change or timeout — no auth header per Dropbox spec.
      const pollRes = await fetch(DBX_LONGPOLL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cursor, timeout: DROPBOX_LONGPOLL_TIMEOUT_S }),
        signal,
      });

      if (!pollRes.ok) {
        await delay(5_000);
        continue;
      }

      const { changes, backoff } = await pollRes.json();

      if (backoff) {
        await delay((backoff as number) * 1_000);
        continue;
      }

      if (!changes) continue; // Timeout — loop again with same cursor.

      // Fetch the actual diff to confirm our file changed.
      const contRes = await fetch(DBX_LIST_FOLDER_CONTINUE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cursor }),
      });
      if (!contRes.ok) continue;

      const diff = await contRes.json();
      cursor = diff.cursor;

      const relevant = (diff.entries as Array<{ path_lower: string }>).some(
        (e) => e.path_lower === DBX_PATH.toLowerCase(),
      );

      if (relevant) {
        const binary = await dropboxDownloadLatest(token);
        if (binary) onRemoteChange(binary);
      }
    } catch (err) {
      if (signal.aborted) break;
      console.error("[CloudSync/Dropbox] Longpoll error:", err);
      await delay(5_000);
    }
  }
}
