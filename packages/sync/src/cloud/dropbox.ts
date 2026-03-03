/**
 * Dropbox cloud sync for Freed.
 *
 * Stores a single `freed.automerge` binary in /Apps/Freed/.
 * Every write uses a download → CRDT-merge → upload cycle guarded by the
 * Dropbox revision ID so concurrent writes produce a merged result.
 *
 * Change detection: `list_folder/longpoll` for near-instant notification
 * (~1-4 s latency) without continuous polling overhead.
 */

import { mergeBinaries, delay } from "./merge.js";

const FILE_NAME = "freed.automerge";
const DBX_UPLOAD = "https://content.dropboxapi.com/2/files/upload";
const DBX_DOWNLOAD = "https://content.dropboxapi.com/2/files/download";
const DBX_LIST_FOLDER = "https://api.dropboxapi.com/2/files/list_folder";
const DBX_LIST_FOLDER_CONTINUE = "https://api.dropboxapi.com/2/files/list_folder/continue";
const DBX_LONGPOLL = "https://notify.dropboxapi.com/2/files/list_folder/longpoll";
const DBX_PATH = `/Apps/Freed/${FILE_NAME}`;
const DBX_FOLDER = "/Apps/Freed";
const LONGPOLL_TIMEOUT_S = 60;
const MAX_RETRIES = 3;

interface DownloadResult {
  binary: Uint8Array | null;
  rev: string;
}

async function download(token: string, signal?: AbortSignal): Promise<DownloadResult> {
  const res = await fetch(DBX_DOWNLOAD, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path: DBX_PATH }),
    },
    signal,
  });

  if (res.status === 409) {
    // File does not exist yet — normal on first run.
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
 * Safe upload: download → CRDT-merge → upload with rev check.
 * A `conflict/wrong_rev` response means another device wrote first → retry.
 */
export async function dropboxUploadSafe(token: string, localBinary: Uint8Array): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { binary: remoteBinary, rev } = await download(token);
    const merged = remoteBinary ? mergeBinaries(localBinary, remoteBinary) : localBinary;

    // On first upload (rev is empty) use overwrite; afterwards use update +
    // revision ID so a concurrent write is detected and rejected.
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
      body: merged as BodyInit,
    });

    if (res.ok) return;

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const tag = (body as { error?: { reason?: { ".tag"?: string } } })?.error?.reason?.[".tag"];
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
  const { binary } = await download(token, signal);
  return binary;
}

/**
 * Permanently delete the `freed.automerge` file from Dropbox.
 * Used during factory reset when the user opts to also wipe cloud storage.
 * A 409 response (path not found) is treated as success.
 */
export async function dropboxDeleteFile(token: string): Promise<void> {
  const res = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: DBX_PATH }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`Dropbox delete failed: ${res.status}`);
  }
}

/**
 * Dropbox longpoll loop — near-instant change notification.
 * Blocks at the notify endpoint until the folder changes or timeout expires,
 * then fetches the diff and calls `onRemoteChange` when our file was updated.
 * Runs until `signal` is aborted.
 */
export async function dropboxStartLongpollLoop(
  token: string,
  onRemoteChange: (binary: Uint8Array) => void,
  signal: AbortSignal,
): Promise<void> {
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
      const pollRes = await fetch(DBX_LONGPOLL, {
        method: "POST",
        // No Authorization header — per Dropbox spec, longpoll uses no auth.
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cursor, timeout: LONGPOLL_TIMEOUT_S }),
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
