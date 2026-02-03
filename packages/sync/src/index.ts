/**
 * @freed/sync - Cross-device sync for Freed
 */

export { FilesystemStorage } from "./storage/filesystem.js";
export { IndexedDBStorage } from "./storage/indexeddb.js";
export { LocalRelay } from "./network/local-relay.js";
export type {
  SyncStatus,
  SyncConfig,
  StorageAdapter,
  SyncStatusListener,
} from "./types.js";

import * as Automerge from "@automerge/automerge";
import { FilesystemStorage } from "./storage/filesystem.js";
import { LocalRelay } from "./network/local-relay.js";
import type {
  SyncStatus,
  StorageAdapter,
  SyncStatusListener,
} from "./types.js";

// Use a generic doc type to avoid strict type constraints with Automerge
type DocType = Record<string, unknown>;

/**
 * Sync manager for coordinating storage and network sync
 */
export class SyncManager<T extends DocType = DocType> {
  private storage: StorageAdapter;
  private relay: LocalRelay | null = null;
  private doc: Automerge.Doc<T> | null = null;
  private statusListeners: Set<SyncStatusListener> = new Set();
  private status: SyncStatus = {
    mode: "offline",
    state: "idle",
    lastSyncAt: null,
    localRelayConnected: false,
  };
  private defaultDoc: T;

  constructor(storage?: StorageAdapter, defaultDoc?: T) {
    this.storage = storage || new FilesystemStorage();
    this.defaultDoc =
      defaultDoc ||
      ({
        feedItems: {},
        rssFeeds: {},
        preferences: {},
        meta: {
          deviceId: crypto.randomUUID(),
          lastSync: 0,
          version: 1,
        },
      } as unknown as T);
  }

  /**
   * Initialize and load the document
   */
  async init(): Promise<Automerge.Doc<T>> {
    const data = await this.storage.load();
    if (data) {
      this.doc = Automerge.load(data);
    } else {
      this.doc = Automerge.from<T>(this.defaultDoc);
    }
    return this.doc;
  }

  /**
   * Get the current document
   */
  getDoc(): Automerge.Doc<T> | null {
    return this.doc;
  }

  /**
   * Update the document and save
   */
  async update(
    changeFn: (doc: T) => void,
    message?: string
  ): Promise<Automerge.Doc<T>> {
    if (!this.doc) {
      throw new Error("Document not initialized. Call init() first.");
    }

    this.doc = Automerge.change(this.doc, message || "Update", changeFn);
    await this.save();
    return this.doc;
  }

  /**
   * Save the document to storage
   */
  async save(): Promise<void> {
    if (!this.doc) return;
    const binary = Automerge.save(this.doc);
    await this.storage.save(binary);
    this.updateStatus({ lastSyncAt: Date.now() });
  }

  /**
   * Start the local relay server (for Desktop app)
   */
  async startRelay(port = 8765): Promise<void> {
    this.relay = new LocalRelay(port);
    await this.relay.start();
    this.updateStatus({ mode: "local", localRelayConnected: true });
  }

  /**
   * Stop the local relay server
   */
  async stopRelay(): Promise<void> {
    if (this.relay) {
      await this.relay.stop();
      this.relay = null;
      this.updateStatus({ localRelayConnected: false });
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /**
   * Subscribe to status changes
   */
  onStatus(listener: SyncStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private updateStatus(update: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...update };
    for (const listener of this.statusListeners) {
      listener(this.status);
    }
  }
}
