import type { StorageAdapter } from "../types.js";

const DB_NAME = "freed";
const STORE_NAME = "automerge";
const DOC_KEY = "feed";
// This generation advances only when document deletion commits. A reset that
// stops before clear must leave both the document and its generation intact.
const DOCUMENT_GENERATION_KEY = "feed:installation-generation";

function readDocumentGeneration(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Stored Automerge document generation is corrupt");
  }
  return value as number;
}

function staleDocumentGenerationError(
  expected: number,
  current: number,
): Error {
  return new Error(
    `IndexedDB document generation is stale: expected ${expected.toLocaleString()}, current ${current.toLocaleString()}`,
  );
}

/**
 * IndexedDB storage adapter for browser/PWA
 */
export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly indexedDBFactory: IDBFactory;
  // A worker captures this on its first load. Every later write checks the
  // durable value in the same transaction before it can replace document data.
  private documentGeneration: number | null = null;

  constructor(indexedDBFactory: IDBFactory = indexedDB) {
    this.indexedDBFactory = indexedDBFactory;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDBFactory.open(DB_NAME, 1);

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
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(DOC_KEY);
      const countRequest = store.count(DOC_KEY);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      let generationFailure: Error | null = null;

      generationRequest.onsuccess = () => {
        try {
          const storedGeneration = readDocumentGeneration(
            generationRequest.result,
          );
          if (this.documentGeneration === null) {
            this.documentGeneration = storedGeneration;
          } else if (this.documentGeneration !== storedGeneration) {
            generationFailure = staleDocumentGenerationError(
              this.documentGeneration,
              storedGeneration,
            );
            return;
          }
          if (generationRequest.result === undefined) {
            store.put(storedGeneration, DOCUMENT_GENERATION_KEY);
          }
        } catch (error) {
          generationFailure =
            error instanceof Error ? error : new Error(String(error));
        }
      };

      transaction.onerror = () =>
        reject(
          transaction.error ??
            request.error ??
            countRequest.error ??
            generationRequest.error ??
            new Error("IndexedDB load failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            request.error ??
            countRequest.error ??
            generationRequest.error ??
            new Error("IndexedDB load aborted"),
        );
      transaction.oncomplete = () => {
        if (generationFailure) {
          reject(generationFailure);
          return;
        }
        if (countRequest.result === 0) {
          resolve(null);
          return;
        }

        const result = request.result;
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
        } else if (result instanceof Uint8Array) {
          resolve(Uint8Array.from(result));
        } else {
          const storedType =
            result === null
              ? "null"
              : result === undefined
                ? "undefined"
                : (result.constructor?.name ?? typeof result);
          reject(
            new Error(
              `Stored Automerge data is corrupt: expected binary data, found ${storedType}`,
            ),
          );
        }
      };
    });
  }

  async save(data: Uint8Array): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const exactBuffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(exactBuffer).set(data);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      let generationFailure: Error | null = null;

      generationRequest.onsuccess = () => {
        try {
          const storedGeneration = readDocumentGeneration(
            generationRequest.result,
          );
          if (this.documentGeneration === null) {
            this.documentGeneration = storedGeneration;
          } else if (this.documentGeneration !== storedGeneration) {
            generationFailure = staleDocumentGenerationError(
              this.documentGeneration,
              storedGeneration,
            );
            return;
          }
          if (generationRequest.result === undefined) {
            store.put(storedGeneration, DOCUMENT_GENERATION_KEY);
          }
          store.put(exactBuffer, DOC_KEY);
        } catch (error) {
          generationFailure =
            error instanceof Error ? error : new Error(String(error));
        }
      };

      transaction.oncomplete = () => {
        if (generationFailure) {
          reject(generationFailure);
          return;
        }
        resolve();
      };
      transaction.onerror = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            new Error("IndexedDB save failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            new Error("IndexedDB save aborted"),
        );
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      let nextGeneration: number | null = null;
      let generationFailure: Error | null = null;

      generationRequest.onsuccess = () => {
        try {
          const storedGeneration = readDocumentGeneration(
            generationRequest.result,
          );
          if (
            this.documentGeneration !== null &&
            this.documentGeneration !== storedGeneration
          ) {
            generationFailure = staleDocumentGenerationError(
              this.documentGeneration,
              storedGeneration,
            );
            return;
          }
          if (storedGeneration >= Number.MAX_SAFE_INTEGER) {
            throw new Error(
              "IndexedDB document generation cannot advance safely",
            );
          }
          nextGeneration = storedGeneration + 1;
          store.put(nextGeneration, DOCUMENT_GENERATION_KEY);
          store.delete(DOC_KEY);
        } catch (error) {
          generationFailure =
            error instanceof Error ? error : new Error(String(error));
        }
      };

      transaction.oncomplete = () => {
        if (generationFailure) {
          reject(generationFailure);
          return;
        }
        this.documentGeneration = nextGeneration;
        resolve();
      };
      transaction.onerror = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            new Error("IndexedDB clear failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            new Error("IndexedDB clear aborted"),
        );
    });
  }
}
