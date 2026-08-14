/**
 * Sync status for UI display
 */
export interface SyncStatus {
  mode: "local" | "cloud" | "offline";
  state: "idle" | "syncing" | "error";
  lastSyncAt: number | null;
  localRelayConnected: boolean;
  cloudProvider?: "gdrive" | "icloud" | "dropbox";
  error?: string;
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  /** Local relay port */
  localPort: number;

  /** Local relay host (for client connection) */
  localHost?: string;

  /** Cloud provider configuration */
  cloud?: {
    provider: "gdrive" | "icloud" | "dropbox";
    credentials?: unknown;
  };
}

/**
 * Storage adapter interface
 */
export interface StorageAdapter {
  load(): Promise<Uint8Array | null>;
  save(data: Uint8Array): Promise<void>;
}

/**
 * Exact durable version of one revision-fenced binary value.
 *
 * `generation` changes only when the value is cleared. `saveRevision`
 * advances for every successful save within that generation.
 */
export interface StorageRevision {
  generation: number;
  saveRevision: number;
}

/**
 * One binary value and the exact revision that must authorize its next write.
 */
export interface RevisionedStorageValue {
  data: Uint8Array | null;
  revision: StorageRevision;
}

/**
 * Binary storage that rejects stale writers with one atomic compare-and-swap.
 */
export interface RevisionedStorageAdapter {
  load(): Promise<RevisionedStorageValue>;
  save(
    data: Uint8Array,
    expectedRevision: StorageRevision,
  ): Promise<StorageRevision>;
  clear(expectedRevision: StorageRevision): Promise<StorageRevision>;
}

/**
 * Listener function type
 */
export type SyncStatusListener = (status: SyncStatus) => void;
