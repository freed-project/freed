import { appDataDir } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { getDocBinary, getDocState, replaceLocalDoc, subscribe } from "./automerge";
import { log } from "./logger.js";
import { readContactSyncState, readContactSyncStateJson, writeContactSyncStateJson } from "./contact-sync-storage.js";

export type SnapshotReason = "auto" | "manual";

export interface SnapshotSummary {
  id: string;
  createdAt: number;
  byteSize: number;
  itemCount: number;
  friendCount: number;
  contactCount: number;
  pendingMatchCount: number;
  reason: SnapshotReason;
}

interface SnapshotIndex {
  version: 1;
  snapshots: SnapshotSummary[];
}

const SNAPSHOT_DIR_NAME = "snapshots";
const SNAPSHOT_INDEX_FILE = "index.json";
const MAX_SNAPSHOTS = 24;
const AUTO_SNAPSHOT_DEBOUNCE_MS = 30_000;
const AUTO_SNAPSHOT_MIN_INTERVAL_MS = 60 * 60 * 1000;

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotUnsubscribe: (() => void) | null = null;
let lastSnapshotAt = 0;
let snapshotManagerStarted = false;

const snapshotListeners = new Set<() => void>();

function joinPath(base: string, ...parts: string[]): string {
  const clean = [base, ...parts].map((part, index) => {
    const trimmed = part.trim();
    if (index === 0) return trimmed.replace(/\/+$/, "");
    return trimmed.replace(/^\/+|\/+$/g, "");
  });
  return clean.filter(Boolean).join("/");
}

async function getSnapshotRootDir(): Promise<string> {
  return joinPath(await appDataDir(), SNAPSHOT_DIR_NAME);
}

async function getSnapshotIndexPath(): Promise<string> {
  return joinPath(await getSnapshotRootDir(), SNAPSHOT_INDEX_FILE);
}

async function ensureSnapshotDir(): Promise<string> {
  const root = await getSnapshotRootDir();
  await mkdir(root, { recursive: true });
  return root;
}

function snapshotBinaryPath(root: string, id: string): string {
  return joinPath(root, `${id}.automerge`);
}

function snapshotContactsPath(root: string, id: string): string {
  return joinPath(root, `${id}.contacts.json`);
}

function normalizeSnapshotList(snapshots: SnapshotSummary[]): SnapshotSummary[] {
  return snapshots
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_SNAPSHOTS);
}

function notifySnapshotListeners(): void {
  for (const listener of snapshotListeners) {
    listener();
  }
}

async function readSnapshotIndex(): Promise<SnapshotSummary[]> {
  const indexPath = await getSnapshotIndexPath();
  if (!(await exists(indexPath))) {
    return [];
  }

  try {
    const raw = await readTextFile(indexPath);
    const parsed = JSON.parse(raw) as Partial<SnapshotIndex>;
    return normalizeSnapshotList(parsed.snapshots ?? []);
  } catch (error) {
    log.warn(
      `[snapshots] failed to read index: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

async function writeSnapshotIndex(snapshots: SnapshotSummary[]): Promise<void> {
  const indexPath = await getSnapshotIndexPath();
  const index: SnapshotIndex = {
    version: 1,
    snapshots: normalizeSnapshotList(snapshots),
  };
  await writeTextFile(indexPath, JSON.stringify(index, null, 2));
}

async function pruneSnapshots(
  root: string,
  snapshots: SnapshotSummary[],
): Promise<SnapshotSummary[]> {
  const keep = normalizeSnapshotList(snapshots);
  const keepIds = new Set(keep.map((snapshot) => snapshot.id));

  for (const snapshot of snapshots) {
    if (keepIds.has(snapshot.id)) continue;

    await Promise.allSettled([
      remove(snapshotBinaryPath(root, snapshot.id)),
      remove(snapshotContactsPath(root, snapshot.id)),
    ]);
  }

  return keep;
}

export async function listSnapshots(): Promise<SnapshotSummary[]> {
  const root = await ensureSnapshotDir();
  const indexed = await readSnapshotIndex();
  const filtered: SnapshotSummary[] = [];

  for (const snapshot of indexed) {
    if (await exists(snapshotBinaryPath(root, snapshot.id))) {
      filtered.push(snapshot);
    }
  }

  if (filtered.length !== indexed.length) {
    await writeSnapshotIndex(filtered);
  }

  return filtered;
}

export async function createSnapshot(
  reason: SnapshotReason = "manual",
): Promise<SnapshotSummary | null> {
  const state = getDocState();
  if (!state) {
    return null;
  }

  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }

  const root = await ensureSnapshotDir();
  const createdAt = Date.now();
  const id = String(createdAt);
  const binary = getDocBinary();
  const contactSyncState = readContactSyncState();

  const summary: SnapshotSummary = {
    id,
    createdAt,
    byteSize: binary.byteLength,
    itemCount: state.allItemIds.length,
    friendCount: Object.keys(state.friends).length,
    contactCount: contactSyncState.cachedContacts.length,
    pendingMatchCount: contactSyncState.pendingMatches.length,
    reason,
  };

  await Promise.all([
    writeFile(snapshotBinaryPath(root, id), binary),
    writeTextFile(snapshotContactsPath(root, id), readContactSyncStateJson()),
  ]);

  const existing = await readSnapshotIndex();
  const nextSnapshots = await pruneSnapshots(root, [summary, ...existing]);
  await writeSnapshotIndex(nextSnapshots);

  lastSnapshotAt = createdAt;
  notifySnapshotListeners();
  log.info(
    `[snapshots] saved ${reason} snapshot ...${id.slice(-8)} (${binary.byteLength} bytes)`,
  );
  return summary;
}

function scheduleAutoSnapshot(): void {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
  }

  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    const now = Date.now();
    if (now - lastSnapshotAt < AUTO_SNAPSHOT_MIN_INTERVAL_MS) {
      return;
    }

    createSnapshot("auto").catch((error) => {
      log.error(
        `[snapshots] auto snapshot failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, AUTO_SNAPSHOT_DEBOUNCE_MS);
}

export async function restoreSnapshot(snapshotId: string): Promise<SnapshotSummary> {
  const root = await ensureSnapshotDir();
  const snapshots = await listSnapshots();
  const snapshot = snapshots.find((entry) => entry.id === snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ...${snapshotId.slice(-8)} not found`);
  }

  const [binary, contactsRaw] = await Promise.all([
    readFile(snapshotBinaryPath(root, snapshotId)),
    (await exists(snapshotContactsPath(root, snapshotId)))
      ? readTextFile(snapshotContactsPath(root, snapshotId))
      : Promise.resolve(null),
  ]);

  await replaceLocalDoc(binary);
  writeContactSyncStateJson(contactsRaw);
  log.info(`[snapshots] restored snapshot ...${snapshotId.slice(-8)}`);
  notifySnapshotListeners();
  return snapshot;
}

export async function clearSnapshots(): Promise<void> {
  const root = await ensureSnapshotDir();
  const files = await readDir(root).catch(() => []);

  await Promise.allSettled(
    files
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name))
      .map((name) => remove(joinPath(root, name))),
  );

  lastSnapshotAt = 0;
  notifySnapshotListeners();
}

export function subscribeToSnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

export async function startSnapshotManager(): Promise<void> {
  if (snapshotManagerStarted) {
    return;
  }

  const existing = await listSnapshots();
  lastSnapshotAt = existing[0]?.createdAt ?? 0;

  if (existing.length === 0 && getDocState()) {
    await createSnapshot("auto");
  }

  snapshotUnsubscribe = subscribe(() => {
    scheduleAutoSnapshot();
  });
  snapshotManagerStarted = true;
}

export function stopSnapshotManager(): void {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }

  snapshotUnsubscribe?.();
  snapshotUnsubscribe = null;
  snapshotManagerStarted = false;
}
