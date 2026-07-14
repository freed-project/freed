import type { StorageAdapter } from "../types.js";

const DB_NAME = "freed";
const STORE_NAME = "automerge";
const DOC_KEY = "feed";
const CORRUPT_DOC_RECOVERY_KEY = "feed-corrupt-recovery";

/**
 * IndexedDB storage adapter for browser/PWA
 */
export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });

    const tracked = opening.catch((error) => {
      if (this.dbPromise === tracked) this.dbPromise = null;
      throw error;
    });
    this.dbPromise = tracked;
    void tracked
      .then((db) => {
        const reset = () => {
          if (this.dbPromise === tracked) this.dbPromise = null;
        };
        db.addEventListener("close", reset, { once: true });
        db.addEventListener(
          "versionchange",
          () => {
            db.close();
            reset();
          },
          { once: true },
        );
      })
      .catch(() => {});

    return tracked;
  }

  async load(): Promise<Uint8Array | null> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(DOC_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
        } else if (result instanceof Uint8Array) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
    });
  }

  async save(data: Uint8Array): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(data.buffer, DOC_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Save transaction failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Save transaction aborted"));
    });
  }

  async replaceCorruptDocumentWithRecoveryCopy(
    data: Uint8Array,
  ): Promise<void> {
    const db = await this.getDB();
    const recoveryCopy = data.slice().buffer;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(recoveryCopy, CORRUPT_DOC_RECOVERY_KEY);
      store.delete(DOC_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Recovery transaction failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Recovery transaction aborted"));
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.delete(DOC_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Clear transaction failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Clear transaction aborted"));
    });
  }
}
