import type { GeoLocation } from "@freed/shared";

const DB_NAME = "freed-geocache";
const STORE_NAME = "locations";
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  query: string;
  location: GeoLocation | null;
  cachedAt: number;
}

let db: IDBDatabase | null = null;

async function openDb(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "query" });
      }
    };
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getFromCache(
  query: string
): Promise<GeoLocation | null | undefined> {
  try {
    const database = await openDb();
    return await new Promise((resolve) => {
      const tx = database.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(query);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined;
        if (!entry) {
          resolve(undefined);
          return;
        }

        const ttl = entry.location ? HIT_TTL_MS : MISS_TTL_MS;
        if (Date.now() - entry.cachedAt > ttl) {
          resolve(undefined);
          return;
        }

        resolve(entry.location);
      };
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function saveToCache(
  query: string,
  location: GeoLocation | null
): Promise<void> {
  try {
    const database = await openDb();
    await new Promise<void>((resolve) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const entry: CacheEntry = { query, location, cachedAt: Date.now() };
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Non-fatal. Worst case we skip caching.
  }
}
