import type {
  RevisionedStorageAdapter,
  RevisionedStorageValue,
  StorageRevision,
} from "../types.js";

const DB_NAME = "freed";
const DB_VERSION = 2;
const STORE_NAME = "automerge";
const DOC_KEY = "feed";
const DOCUMENT_GENERATION_KEY = "feed:installation-generation";
const SAVE_REVISION_KEY = "feed:save-revision";

function revisionLabel(revision: StorageRevision): string {
  return `${revision.generation.toLocaleString()}:${revision.saveRevision.toLocaleString()}`;
}

function assertRevisionPart(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Stored Automerge ${label} is corrupt`);
  }
  return value as number;
}

function validateExpectedRevision(
  revision: StorageRevision,
): StorageRevision {
  return {
    generation: assertRevisionPart(
      revision?.generation,
      "document generation",
    ),
    saveRevision: assertRevisionPart(
      revision?.saveRevision,
      "save revision",
    ),
  };
}

function sameRevision(
  left: StorageRevision,
  right: StorageRevision,
): boolean {
  return (
    left.generation === right.generation &&
    left.saveRevision === right.saveRevision
  );
}

function exactBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

export class StaleStorageRevisionError extends Error {
  readonly code = "STALE_STORAGE_REVISION";
  readonly expected: StorageRevision;
  readonly actual: StorageRevision;

  constructor(
    expected: StorageRevision,
    actual: StorageRevision,
  ) {
    super(
      `IndexedDB document revision is stale: expected ${revisionLabel(expected)}, current ${revisionLabel(actual)}`,
    );
    this.name = "StaleStorageRevisionError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Revision-fenced IndexedDB storage for the active legacy Automerge document.
 *
 * Every mutation compares both the installation generation and the save
 * revision inside the same readwrite transaction that changes the bytes.
 */
export class IndexedDBStorage implements RevisionedStorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly indexedDBFactory: IDBFactory;

  constructor(indexedDBFactory: IDBFactory = indexedDB) {
    this.indexedDBFactory = indexedDBFactory;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    let opening!: Promise<IDBDatabase>;
    opening = new Promise((resolve, reject) => {
      const request = this.indexedDBFactory.open(DB_NAME, DB_VERSION);
      let settled = false;
      let upgradeFailure: Error | null = null;

      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      request.onerror = () =>
        rejectOnce(
          upgradeFailure ??
            request.error ??
            new Error("IndexedDB open failed without an error"),
        );
      request.onblocked = () =>
        rejectOnce(
          new Error(
            "IndexedDB v2 upgrade is blocked by another open Freed connection",
          ),
        );
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        db.onversionchange = () => {
          db.close();
          if (this.dbPromise === opening) this.dbPromise = null;
        };
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const transaction = request.transaction;
        if (!transaction) {
          upgradeFailure = new Error(
            "IndexedDB v2 upgrade has no versionchange transaction",
          );
          return;
        }

        const store = db.objectStoreNames.contains(STORE_NAME)
          ? transaction.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME);

        try {
          const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
          if (oldVersion >= DB_VERSION) return;

          if (oldVersion === 0) {
            store.put(0, DOCUMENT_GENERATION_KEY);
            store.put(0, SAVE_REVISION_KEY);
            return;
          }

          // Version 1 stored the exact feed bytes and, in later builds, an
          // optional reset generation. Preserve both and begin revision
          // fencing at revision zero.
          const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
          generationRequest.onsuccess = () => {
            try {
              if (generationRequest.result === undefined) {
                store.put(0, DOCUMENT_GENERATION_KEY);
              } else {
                assertRevisionPart(
                  generationRequest.result,
                  "document generation",
                );
              }
              store.put(0, SAVE_REVISION_KEY);
            } catch (error) {
              upgradeFailure =
                error instanceof Error ? error : new Error(String(error));
              transaction.abort();
            }
          };
          generationRequest.onerror = () => {
            upgradeFailure =
              generationRequest.error ??
              new Error("IndexedDB v1 generation migration failed");
          };
        } catch (error) {
          upgradeFailure =
            error instanceof Error ? error : new Error(String(error));
          transaction.abort();
        }
      };
    });

    this.dbPromise = opening;
    try {
      return await opening;
    } catch (error) {
      if (this.dbPromise === opening) this.dbPromise = null;
      throw error;
    }
  }

  private async loadSnapshot(
    copyDocumentBytes: boolean,
  ): Promise<RevisionedStorageValue> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const documentRequest = store.get(DOC_KEY);
      const documentCountRequest = store.count(DOC_KEY);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);

      transaction.onerror = () =>
        reject(
          transaction.error ??
            documentRequest.error ??
            documentCountRequest.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB load failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            documentRequest.error ??
            documentCountRequest.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB load aborted"),
        );
      transaction.oncomplete = () => {
        try {
          const revision = {
            generation: assertRevisionPart(
              generationRequest.result,
              "document generation",
            ),
            saveRevision: assertRevisionPart(
              revisionRequest.result,
              "save revision",
            ),
          };

          if (documentCountRequest.result === 0) {
            if (revision.saveRevision > 0) {
              throw new Error(
                "Stored Automerge data is corrupt: save revision exists without document bytes",
              );
            }
            resolve({ data: null, revision });
            return;
          }

          const result = documentRequest.result;
          if (result instanceof ArrayBuffer) {
            resolve({
              data: copyDocumentBytes
                ? Uint8Array.from(new Uint8Array(result))
                : new Uint8Array(result),
              revision,
            });
            return;
          }
          if (result instanceof Uint8Array) {
            resolve({
              data: copyDocumentBytes ? Uint8Array.from(result) : result,
              revision,
            });
            return;
          }

          const storedType =
            result === null
              ? "null"
              : result === undefined
                ? "undefined"
                : (result.constructor?.name ?? typeof result);
          throw new Error(
            `Stored Automerge data is corrupt: expected binary data, found ${storedType}`,
          );
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  async load(): Promise<RevisionedStorageValue> {
    return this.loadSnapshot(true);
  }

  /**
   * Loads one exact revision for bounded external migration without making a
   * second full-document copy inside the storage adapter.
   *
   * IndexedDB still materializes one structured-clone result. The caller must
   * treat these bytes as immutable, export bounded copied chunks, and release
   * the snapshot. This API does not decode Automerge or change the active
   * persistence contract.
   */
  async loadRawSnapshotForExternalMigration(): Promise<RevisionedStorageValue> {
    return this.loadSnapshot(false);
  }

  /** Reads only the revision fence, never the document bytes. */
  async currentRevision(): Promise<StorageRevision> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);

      transaction.onerror = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB revision read failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB revision read aborted"),
        );
      transaction.oncomplete = () => {
        try {
          resolve({
            generation: assertRevisionPart(
              generationRequest.result,
              "document generation",
            ),
            saveRevision: assertRevisionPart(
              revisionRequest.result,
              "save revision",
            ),
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  async save(
    data: Uint8Array,
    expectedRevision: StorageRevision,
  ): Promise<StorageRevision> {
    const expected = validateExpectedRevision(expectedRevision);
    const buffer = exactBuffer(data);
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);
      let completedReads = 0;
      let result: StorageRevision | null = null;
      let failure: Error | null = null;

      const compareAndWrite = (): void => {
        completedReads += 1;
        if (completedReads !== 2 || failure) return;
        try {
          const actual = {
            generation: assertRevisionPart(
              generationRequest.result,
              "document generation",
            ),
            saveRevision: assertRevisionPart(
              revisionRequest.result,
              "save revision",
            ),
          };
          if (!sameRevision(expected, actual)) {
            failure = new StaleStorageRevisionError(expected, actual);
            transaction.abort();
            return;
          }
          if (actual.saveRevision >= Number.MAX_SAFE_INTEGER) {
            throw new Error("IndexedDB save revision cannot advance safely");
          }

          result = {
            generation: actual.generation,
            saveRevision: actual.saveRevision + 1,
          };
          store.put(buffer, DOC_KEY);
          store.put(result.saveRevision, SAVE_REVISION_KEY);
        } catch (error) {
          failure =
            error instanceof Error ? error : new Error(String(error));
          transaction.abort();
        }
      };

      generationRequest.onsuccess = compareAndWrite;
      revisionRequest.onsuccess = compareAndWrite;
      transaction.oncomplete = () => {
        if (failure) {
          reject(failure);
          return;
        }
        if (!result) {
          reject(new Error("IndexedDB save completed without a revision"));
          return;
        }
        resolve(result);
      };
      transaction.onerror = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB save failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB save aborted"),
        );
    });
  }

  async clear(
    expectedRevision: StorageRevision,
  ): Promise<StorageRevision> {
    const expected = validateExpectedRevision(expectedRevision);
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);
      let completedReads = 0;
      let result: StorageRevision | null = null;
      let failure: Error | null = null;

      const compareAndClear = (): void => {
        completedReads += 1;
        if (completedReads !== 2 || failure) return;
        try {
          const actual = {
            generation: assertRevisionPart(
              generationRequest.result,
              "document generation",
            ),
            saveRevision: assertRevisionPart(
              revisionRequest.result,
              "save revision",
            ),
          };
          if (!sameRevision(expected, actual)) {
            failure = new StaleStorageRevisionError(expected, actual);
            transaction.abort();
            return;
          }
          if (actual.generation >= Number.MAX_SAFE_INTEGER) {
            throw new Error(
              "IndexedDB document generation cannot advance safely",
            );
          }

          result = {
            generation: actual.generation + 1,
            saveRevision: 0,
          };
          store.put(result.generation, DOCUMENT_GENERATION_KEY);
          store.put(result.saveRevision, SAVE_REVISION_KEY);
          store.delete(DOC_KEY);
        } catch (error) {
          failure =
            error instanceof Error ? error : new Error(String(error));
          transaction.abort();
        }
      };

      generationRequest.onsuccess = compareAndClear;
      revisionRequest.onsuccess = compareAndClear;
      transaction.oncomplete = () => {
        if (failure) {
          reject(failure);
          return;
        }
        if (!result) {
          reject(new Error("IndexedDB clear completed without a revision"));
          return;
        }
        resolve(result);
      };
      transaction.onerror = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB clear failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            new Error("IndexedDB clear aborted"),
        );
    });
  }
}
