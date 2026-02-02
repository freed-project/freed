import type { StorageAdapter } from "../types.js";

const DB_NAME = "freed";
const STORE_NAME = "automerge";
const DOC_KEY = "feed";

/**
 * IndexedDB storage adapter for browser/PWA
 */
export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
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

    return this.dbPromise;
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
      const request = store.put(data.buffer, DOC_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(DOC_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
