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
 * Listener function type
 */
export type SyncStatusListener = (status: SyncStatus) => void;
