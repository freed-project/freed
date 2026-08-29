const LEGACY_DATABASE_NAME = "freed";
const LEGACY_STORE_NAME = "automerge";
const LEGACY_DOCUMENT_KEY = "feed";
const LEGACY_DOCUMENT_BYTE_LENGTH_KEY = "feed:byte-length";
const LEGACY_DOCUMENT_CHUNK_COUNT_KEY = "feed:chunk-count";

function requestResult<T>(request: IDBRequest<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error(`${label} failed without an error`));
  });
}

/**
 * Check for the retired IndexedDB Library without reading its source-sized
 * Automerge value. A missing database is aborted before IndexedDB can create
 * it. An unreadable database fails closed so startup cannot replace data whose
 * absence was not proven.
 */
export function hasLegacyLibraryData(
  indexedDbFactory: IDBFactory = indexedDB,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = indexedDbFactory.open(LEGACY_DATABASE_NAME);
    let settled = false;

    const resolveOnce = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    request.onblocked = () =>
      rejectOnce(new Error("Legacy Library inspection is blocked by another connection"));
    request.onerror = () =>
      rejectOnce(
        request.error ??
          new Error("Legacy Library inspection failed without an error"),
      );
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      request.result.close();
      resolveOnce(false);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        database.close();
        resolveOnce(false);
        return;
      }

      try {
        const transaction = database.transaction(LEGACY_STORE_NAME, "readonly");
        const store = transaction.objectStore(LEGACY_STORE_NAME);
        void Promise.all([
          requestResult(store.getKey(LEGACY_DOCUMENT_KEY), "Legacy Library key inspection"),
          requestResult(
            store.get(LEGACY_DOCUMENT_BYTE_LENGTH_KEY),
            "Legacy Library byte-length inspection",
          ),
          requestResult(
            store.get(LEGACY_DOCUMENT_CHUNK_COUNT_KEY),
            "Legacy Library chunk-count inspection",
          ),
        ]).then(
          ([documentKey, byteLength, chunkCount]) => {
            database.close();
            resolveOnce(
              documentKey !== undefined ||
                (Number.isSafeInteger(byteLength) &&
                  (byteLength as number) > 0 &&
                  Number.isSafeInteger(chunkCount) &&
                  (chunkCount as number) > 0),
            );
          },
          (error) => {
            database.close();
            rejectOnce(error);
          },
        );
      } catch (error) {
        database.close();
        rejectOnce(error);
      }
    };
  });
}
