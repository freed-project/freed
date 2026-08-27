import { isTauri } from "@tauri-apps/api/core";
import { waitForFactoryResetDrain, isFactoryResetInProgress } from "@freed/ui/lib/factory-reset";
import { reloadSqliteLibraryState, subscribe } from "./library-client";
import { readLibraryCoreFacetSummary } from "./library-core-item-detail-runtime";
import {
  clearSqliteLibraryBackups,
  createSqliteLibraryBackup,
  isSqliteLibraryActive,
  listSqliteLibraryBackups,
  restoreSqliteLibraryBackup,
} from "./sqlite-library";
import { readContactSyncState } from "./contact-sync-storage.js";
import { isBackgroundRuntimeDeferredError, runBackgroundJob } from "./background-runtime-coordinator.js";
import { log } from "./logger.js";

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

const AUTO_SNAPSHOT_DEBOUNCE_MS = 30_000;
const AUTO_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 180_000;

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotUnsubscribe: (() => void) | null = null;
let lastSnapshotAt = 0;
let snapshotManagerStarted = false;
let snapshotResetInProgress = false;
const activeSnapshotOperations = new Set<Promise<unknown>>();
const snapshotListeners = new Set<() => void>();

function trackSnapshotOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (snapshotResetInProgress || isFactoryResetInProgress()) {
    return Promise.reject(new Error("Snapshots are being reset"));
  }
  let tracked: Promise<T>;
  tracked = Promise.resolve().then(operation).finally(() => activeSnapshotOperations.delete(tracked));
  activeSnapshotOperations.add(tracked);
  return tracked;
}

function notifySnapshotListeners(): void {
  for (const listener of snapshotListeners) listener();
}

export async function listSnapshots(): Promise<SnapshotSummary[]> {
  const contacts = readContactSyncState();
  const friendCount = (await readLibraryCoreFacetSummary()).friendPersonCount;
  return (await listSqliteLibraryBackups()).map((backup) => ({
    id: backup.backupId,
    createdAt: backup.createdAtMs,
    byteSize: backup.byteLength,
    itemCount: backup.itemCount,
    friendCount,
    contactCount: contacts.cachedContacts.length,
    pendingMatchCount: contacts.pendingSuggestions.length,
    reason: backup.reason,
  }));
}

async function createSnapshotInternal(reason: SnapshotReason): Promise<SnapshotSummary | null> {
  if (!isSqliteLibraryActive()) return null;
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }

  const backup = await createSqliteLibraryBackup(reason);
  const contacts = readContactSyncState();
  const friendCount = (await readLibraryCoreFacetSummary()).friendPersonCount;
  const summary: SnapshotSummary = {
    id: backup.backupId,
    createdAt: backup.createdAtMs,
    byteSize: backup.byteLength,
    itemCount: backup.itemCount,
    friendCount,
    contactCount: contacts.cachedContacts.length,
    pendingMatchCount: contacts.pendingSuggestions.length,
    reason,
  };
  lastSnapshotAt = summary.createdAt;
  notifySnapshotListeners();
  log.info(`[snapshots] saved ${reason} SQLite backup ...${summary.id.slice(-8)}`);
  return summary;
}

export function createSnapshot(reason: SnapshotReason = "manual"): Promise<SnapshotSummary | null> {
  return trackSnapshotOperation(() => createSnapshotInternal(reason));
}

function scheduleAutoSnapshot(): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  const elapsed = Math.max(0, Date.now() - lastSnapshotAt);
  const delay = lastSnapshotAt === 0
    ? AUTO_SNAPSHOT_DEBOUNCE_MS
    : Math.max(AUTO_SNAPSHOT_DEBOUNCE_MS, AUTO_SNAPSHOT_INTERVAL_MS - elapsed);

  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    if (Date.now() - lastSnapshotAt < AUTO_SNAPSHOT_INTERVAL_MS) {
      scheduleAutoSnapshot();
      return;
    }
    runBackgroundJob({
      kind: "snapshot",
      source: "auto-snapshot",
      timeoutMs: 180_000,
      run: () => createSnapshot("auto"),
    }).catch((error) => {
      if (isBackgroundRuntimeDeferredError(error)) {
        log.info(`[snapshots] auto snapshot deferred: ${error.reason}`);
        return;
      }
      log.error(`[snapshots] auto snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      if (snapshotManagerStarted && !snapshotResetInProgress) scheduleAutoSnapshot();
    });
  }, delay);
}

async function restoreSnapshotInternal(snapshotId: string): Promise<SnapshotSummary> {
  const snapshot = (await listSnapshots()).find((entry) => entry.id === snapshotId);
  if (!snapshot) throw new Error(`Snapshot ...${snapshotId.slice(-8)} not found`);
  await restoreSqliteLibraryBackup(snapshotId);
  await reloadSqliteLibraryState();
  notifySnapshotListeners();
  log.info(`[snapshots] restored SQLite backup ...${snapshotId.slice(-8)}`);
  return snapshot;
}

export function restoreSnapshot(snapshotId: string): Promise<SnapshotSummary> {
  return trackSnapshotOperation(() => restoreSnapshotInternal(snapshotId));
}

export async function clearSnapshots(): Promise<void> {
  snapshotResetInProgress = true;
  try {
    await waitForFactoryResetDrain(
      () => Array.from(activeSnapshotOperations),
      "Snapshot operations",
      FACTORY_RESET_DRAIN_TIMEOUT_MS,
    );
    await clearSqliteLibraryBackups();
    lastSnapshotAt = 0;
  } finally {
    snapshotResetInProgress = false;
  }
  notifySnapshotListeners();
}

export function subscribeToSnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

export async function startSnapshotManager(): Promise<void> {
  if (!isTauri() || snapshotManagerStarted || !isSqliteLibraryActive()) return;
  const existing = await listSnapshots();
  lastSnapshotAt = existing[0]?.createdAt ?? 0;
  if (existing.length === 0) await createSnapshot("auto");
  snapshotUnsubscribe = subscribe(scheduleAutoSnapshot);
  snapshotManagerStarted = true;
  scheduleAutoSnapshot();
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
