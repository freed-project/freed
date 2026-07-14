import type { GeoLocation } from "@freed/shared";
import {
  captureFactoryResetWriteEpoch,
  isFactoryResetInProgress,
  isFactoryResetWriteAllowed,
  trackFactoryResetSensitiveOperation,
} from "./factory-reset.js";

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
let dbPromise: Promise<IDBDatabase> | null = null;
let storageGeneration = 0;
let resetInProgress = false;

async function openDb(): Promise<IDBDatabase> {
  if (resetInProgress || isFactoryResetInProgress()) {
    throw new Error("Geocoding cache is being reset");
  }
  if (db) return db;
  if (dbPromise) return dbPromise;

  const generation = storageGeneration;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "query" });
      }
    };
    req.onsuccess = () => {
      if (generation !== storageGeneration || resetInProgress) {
        req.result.close();
        reject(new Error("Geocoding cache was reset while opening"));
        return;
      }
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbPromise = pending;
  try {
    return await pending;
  } finally {
    if (dbPromise === pending) dbPromise = null;
  }
}

/** Permanently remove the device-local geocoding database. */
export async function clearGeocodingCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  resetInProgress = true;
  try {
    storageGeneration += 1;
    void dbPromise?.catch(() => undefined);
    db?.close();
    db = null;

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not clear geocoding cache"));
      request.onblocked = () => reject(new Error("Geocoding cache is still in use"));
    });
  } finally {
    resetInProgress = false;
  }
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

export function saveToCache(
  query: string,
  location: GeoLocation | null
): Promise<void> {
  const writeEpoch = captureFactoryResetWriteEpoch();
  if (!isFactoryResetWriteAllowed(writeEpoch)) return Promise.resolve();

  return trackFactoryResetSensitiveOperation((async () => {
    try {
      const database = await openDb();
      if (!isFactoryResetWriteAllowed(writeEpoch)) return;
      await new Promise<void>((resolve) => {
        const tx = database.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const entry: CacheEntry = { query, location, cachedAt: Date.now() };
        store.put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } catch {
      // Non-fatal. Worst case we skip caching.
    }
  })());
}
