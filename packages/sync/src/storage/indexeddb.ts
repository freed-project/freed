import type {
  RevisionedStorageAdapter,
  RevisionedStorageValue,
  StorageRevision,
} from "../types.js";

const DB_NAME = "freed";
const DB_VERSION = 3;
const STORE_NAME = "automerge";
const DOC_KEY = "feed";
const DOCUMENT_GENERATION_KEY = "feed:installation-generation";
const SAVE_REVISION_KEY = "feed:save-revision";
const DOCUMENT_CHUNK_COUNT_KEY = "feed:chunk-count";
const DOCUMENT_BYTE_LENGTH_KEY = "feed:byte-length";
const DOCUMENT_CHUNK_KEY_PREFIX = "feed:chunk:";
export const INDEXEDDB_AUTOMERGE_CHUNK_BYTES = 1_048_576;

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

function chunkKey(index: number): string {
  return `${DOCUMENT_CHUNK_KEY_PREFIX}${index.toString().padStart(8, "0")}`;
}

function assertChunkCount(value: unknown): number {
  const count = assertRevisionPart(value, "chunk count");
  if (count > Number.MAX_SAFE_INTEGER / INDEXEDDB_AUTOMERGE_CHUNK_BYTES) {
    throw new Error("Stored Automerge chunk count is corrupt");
  }
  return count;
}

function assertByteLength(value: unknown): number {
  return assertRevisionPart(value, "byte length");
}

function expectedChunkCount(byteLength: number): number {
  return Math.ceil(byteLength / INDEXEDDB_AUTOMERGE_CHUNK_BYTES);
}

function writeDocumentChunks(
  store: IDBObjectStore,
  data: Uint8Array,
): number {
  const count = expectedChunkCount(data.byteLength);
  for (let index = 0; index < count; index += 1) {
    const offset = index * INDEXEDDB_AUTOMERGE_CHUNK_BYTES;
    const nextOffset = Math.min(
      offset + INDEXEDDB_AUTOMERGE_CHUNK_BYTES,
      data.byteLength,
    );
    store.put(exactBuffer(data.subarray(offset, nextOffset)), chunkKey(index));
  }
  store.put(count, DOCUMENT_CHUNK_COUNT_KEY);
  store.put(data.byteLength, DOCUMENT_BYTE_LENGTH_KEY);
  return count;
}

function deleteDocumentChunks(
  store: IDBObjectStore,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    store.delete(chunkKey(index));
  }
}

export interface IndexedDBExternalMigrationSnapshot {
  readonly revision: StorageRevision;
  readonly byteLength: number;
  readonly maximumChunkBytes: typeof INDEXEDDB_AUTOMERGE_CHUNK_BYTES;
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
            "IndexedDB v3 upgrade is blocked by another open Freed connection",
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
            "IndexedDB v3 upgrade has no versionchange transaction",
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
            store.put(0, DOCUMENT_CHUNK_COUNT_KEY);
            store.put(0, DOCUMENT_BYTE_LENGTH_KEY);
            return;
          }

          if (oldVersion === 1) {
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
          }

          // Versions 1 and 2 stored one source-sized value. Split it once
          // inside the upgrade transaction. Every later migration read can
          // then retrieve one bounded chunk without materializing the corpus.
          const documentRequest = store.get(DOC_KEY);
          documentRequest.onsuccess = () => {
            try {
              const value = documentRequest.result;
              if (value === undefined) {
                store.put(0, DOCUMENT_CHUNK_COUNT_KEY);
                store.put(0, DOCUMENT_BYTE_LENGTH_KEY);
                return;
              }
              const bytes =
                value instanceof ArrayBuffer
                  ? new Uint8Array(value)
                  : value instanceof Uint8Array
                    ? value
                    : null;
              if (!bytes) {
                throw new Error(
                  "Stored Automerge data is corrupt during IndexedDB v3 upgrade",
                );
              }
              writeDocumentChunks(store, bytes);
              store.delete(DOC_KEY);
            } catch (error) {
              upgradeFailure =
                error instanceof Error ? error : new Error(String(error));
              transaction.abort();
            }
          };
          documentRequest.onerror = () => {
            upgradeFailure =
              documentRequest.error ??
              new Error("IndexedDB document chunk migration failed");
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

  private async loadSnapshot(): Promise<RevisionedStorageValue> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);
      const chunkCountRequest = store.get(DOCUMENT_CHUNK_COUNT_KEY);
      const byteLengthRequest = store.get(DOCUMENT_BYTE_LENGTH_KEY);
      const legacyDocumentCountRequest = store.count(DOC_KEY);
      const metadataRequests = [
        generationRequest,
        revisionRequest,
        chunkCountRequest,
        byteLengthRequest,
        legacyDocumentCountRequest,
      ];
      const chunkRequests: IDBRequest<unknown>[] = [];
      let completedMetadataReads = 0;
      let failure: Error | null = null;
      let chunkCount = 0;
      let byteLength = 0;

      const readChunks = (): void => {
        completedMetadataReads += 1;
        if (completedMetadataReads !== metadataRequests.length || failure) {
          return;
        }
        try {
          if (legacyDocumentCountRequest.result !== 0) {
            throw new Error(
              "Stored Automerge data is corrupt: legacy document survived IndexedDB v3 migration",
            );
          }
          chunkCount = assertChunkCount(chunkCountRequest.result);
          byteLength = assertByteLength(byteLengthRequest.result);
          if (chunkCount !== expectedChunkCount(byteLength)) {
            throw new Error(
              "Stored Automerge data is corrupt: chunk count does not match byte length",
            );
          }
          for (let index = 0; index < chunkCount; index += 1) {
            chunkRequests.push(store.get(chunkKey(index)));
          }
        } catch (error) {
          failure =
            error instanceof Error ? error : new Error(String(error));
          transaction.abort();
        }
      };
      for (const request of metadataRequests) {
        request.onsuccess = readChunks;
      }

      transaction.onerror = () =>
        reject(
          failure ??
            transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            chunkCountRequest.error ??
            byteLengthRequest.error ??
            legacyDocumentCountRequest.error ??
            new Error("IndexedDB load failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            chunkCountRequest.error ??
            byteLengthRequest.error ??
            legacyDocumentCountRequest.error ??
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

          if (byteLength === 0) {
            if (revision.saveRevision > 0) {
              throw new Error(
                "Stored Automerge data is corrupt: save revision exists without document bytes",
              );
            }
            resolve({ data: null, revision });
            return;
          }

          const data = new Uint8Array(byteLength);
          for (let index = 0; index < chunkRequests.length; index += 1) {
            const result = chunkRequests[index]!.result;
            const chunk =
              result instanceof ArrayBuffer
                ? new Uint8Array(result)
                : result instanceof Uint8Array
                  ? result
                  : null;
            const expectedLength = Math.min(
              INDEXEDDB_AUTOMERGE_CHUNK_BYTES,
              byteLength - index * INDEXEDDB_AUTOMERGE_CHUNK_BYTES,
            );
            if (!chunk || chunk.byteLength !== expectedLength) {
              throw new Error(
                "Stored Automerge data is corrupt: document chunk is missing or malformed",
              );
            }
            data.set(chunk, index * INDEXEDDB_AUTOMERGE_CHUNK_BYTES);
          }
          resolve({ data, revision });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  async load(): Promise<RevisionedStorageValue> {
    return this.loadSnapshot();
  }

  /**
   * Pins only the revision and source length for external migration. It never
   * reads an Automerge chunk.
   */
  async beginExternalMigrationSnapshot(): Promise<IndexedDBExternalMigrationSnapshot> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);
      const chunkCountRequest = store.get(DOCUMENT_CHUNK_COUNT_KEY);
      const byteLengthRequest = store.get(DOCUMENT_BYTE_LENGTH_KEY);

      transaction.onerror = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            chunkCountRequest.error ??
            byteLengthRequest.error ??
            new Error("IndexedDB migration snapshot admission failed"),
        );
      transaction.onabort = transaction.onerror;
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
          const byteLength = assertByteLength(byteLengthRequest.result);
          const chunkCount = assertChunkCount(chunkCountRequest.result);
          if (chunkCount !== expectedChunkCount(byteLength)) {
            throw new Error(
              "Stored Automerge migration source has inconsistent chunk metadata",
            );
          }
          if (byteLength === 0 && revision.saveRevision > 0) {
            throw new Error(
              "Stored Automerge migration source has a revision without bytes",
            );
          }
          resolve({
            revision,
            byteLength,
            maximumChunkBytes: INDEXEDDB_AUTOMERGE_CHUNK_BYTES,
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  /**
   * Reads one exact aligned chunk while rechecking the admitted revision in the
   * same transaction. A stale save can never splice bytes into the snapshot.
   */
  async readExternalMigrationChunk(
    expectedRevision: StorageRevision,
    offset: number,
  ): Promise<Uint8Array> {
    const expected = validateExpectedRevision(expectedRevision);
    if (
      !Number.isSafeInteger(offset)
      || offset < 0
      || offset % INDEXEDDB_AUTOMERGE_CHUNK_BYTES !== 0
    ) {
      throw new Error("IndexedDB migration chunk offset is invalid");
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);
      const byteLengthRequest = store.get(DOCUMENT_BYTE_LENGTH_KEY);
      const chunkCountRequest = store.get(DOCUMENT_CHUNK_COUNT_KEY);
      const index = offset / INDEXEDDB_AUTOMERGE_CHUNK_BYTES;
      const chunkRequest = store.get(chunkKey(index));

      transaction.onerror = () =>
        reject(
          transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            byteLengthRequest.error ??
            chunkCountRequest.error ??
            chunkRequest.error ??
            new Error("IndexedDB migration chunk read failed"),
        );
      transaction.onabort = transaction.onerror;
      transaction.oncomplete = () => {
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
            throw new StaleStorageRevisionError(expected, actual);
          }
          const byteLength = assertByteLength(byteLengthRequest.result);
          const chunkCount = assertChunkCount(chunkCountRequest.result);
          if (
            chunkCount !== expectedChunkCount(byteLength)
            || offset >= byteLength
            || index >= chunkCount
          ) {
            throw new Error("IndexedDB migration chunk is outside its source");
          }
          const result = chunkRequest.result;
          const chunk =
            result instanceof ArrayBuffer
              ? new Uint8Array(result)
              : result instanceof Uint8Array
                ? result
                : null;
          const expectedLength = Math.min(
            INDEXEDDB_AUTOMERGE_CHUNK_BYTES,
            byteLength - offset,
          );
          if (!chunk || chunk.byteLength !== expectedLength) {
            throw new Error("IndexedDB migration chunk is missing or malformed");
          }
          resolve(chunk);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
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
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const generationRequest = store.get(DOCUMENT_GENERATION_KEY);
      const revisionRequest = store.get(SAVE_REVISION_KEY);
      const chunkCountRequest = store.get(DOCUMENT_CHUNK_COUNT_KEY);
      const byteLengthRequest = store.get(DOCUMENT_BYTE_LENGTH_KEY);
      let completedReads = 0;
      let result: StorageRevision | null = null;
      let failure: Error | null = null;

      const compareAndWrite = (): void => {
        completedReads += 1;
        if (completedReads !== 4 || failure) return;
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
          const priorChunkCount = assertChunkCount(chunkCountRequest.result);
          const priorByteLength = assertByteLength(byteLengthRequest.result);
          if (priorChunkCount !== expectedChunkCount(priorByteLength)) {
            throw new Error(
              "Stored Automerge data is corrupt: chunk metadata changed before save",
            );
          }

          result = {
            generation: actual.generation,
            saveRevision: actual.saveRevision + 1,
          };
          deleteDocumentChunks(
            store,
            priorChunkCount,
          );
          writeDocumentChunks(store, data);
          store.delete(DOC_KEY);
          store.put(result.saveRevision, SAVE_REVISION_KEY);
        } catch (error) {
          failure =
            error instanceof Error ? error : new Error(String(error));
          transaction.abort();
        }
      };

      generationRequest.onsuccess = compareAndWrite;
      revisionRequest.onsuccess = compareAndWrite;
      chunkCountRequest.onsuccess = compareAndWrite;
      byteLengthRequest.onsuccess = compareAndWrite;
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
            chunkCountRequest.error ??
            byteLengthRequest.error ??
            new Error("IndexedDB save failed without an error"),
        );
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            generationRequest.error ??
            revisionRequest.error ??
            chunkCountRequest.error ??
            byteLengthRequest.error ??
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
          store.clear();
          store.put(result.generation, DOCUMENT_GENERATION_KEY);
          store.put(result.saveRevision, SAVE_REVISION_KEY);
          store.put(0, DOCUMENT_CHUNK_COUNT_KEY);
          store.put(0, DOCUMENT_BYTE_LENGTH_KEY);
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
