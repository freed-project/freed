import type { GeoLocation } from "@freed/shared";
import { getFromCache, saveToCache } from "./geocoding-cache.js";
import {
  captureFactoryResetWriteEpoch,
  isFactoryResetWriteAllowed,
  trackFactoryResetSensitiveOperation,
} from "./factory-reset.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Freed/1.0 (app.freed.wtf)";
const MIN_INTERVAL_MS = 1100;
const pendingQueue: Array<() => void> = [];
const memoryCache = new Map<string, GeoLocation | null>();
const inFlightRequests = new Map<string, Promise<GeoLocation | null>>();
let lastRequestAt = 0;
let draining = false;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    country?: string;
  };
}

function drainQueue() {
  if (draining || pendingQueue.length === 0) return;
  draining = true;

  const next = pendingQueue.shift();
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());

  setTimeout(() => {
    lastRequestAt = Date.now();
    next?.();
    draining = false;
    drainQueue();
  }, wait);
}

function throttledFetch(url: string, writeEpoch: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (pendingQueue.length >= 3) {
      reject(new Error("Geocoding queue full"));
      return;
    }

    pendingQueue.push(() => {
      if (!isFactoryResetWriteAllowed(writeEpoch)) {
        reject(new Error("Factory reset stopped the pending geocoding request"));
        return;
      }
      fetch(url, { headers: { "User-Agent": USER_AGENT } })
        .then(resolve)
        .catch(reject);
    });

    drainQueue();
  });
}

export async function geocode(query: string): Promise<GeoLocation | null> {
  const writeEpoch = captureFactoryResetWriteEpoch();
  if (!isFactoryResetWriteAllowed(writeEpoch)) return null;
  if (memoryCache.has(query)) {
    return memoryCache.get(query) ?? null;
  }

  const inFlight = inFlightRequests.get(query);
  if (inFlight) return inFlight;

  const request = trackFactoryResetSensitiveOperation(
    geocodeWithCache(query, writeEpoch),
  );
  inFlightRequests.set(query, request);

  try {
    const location = await request;
    return location;
  } finally {
    inFlightRequests.delete(query);
  }
}

async function geocodeWithCache(
  query: string,
  writeEpoch: number,
): Promise<GeoLocation | null> {
  const cached = await getFromCache(query);
  if (cached !== undefined) {
    if (isFactoryResetWriteAllowed(writeEpoch)) memoryCache.set(query, cached);
    return cached;
  }

  if (!isFactoryResetWriteAllowed(writeEpoch)) return null;
  const location = await geocodeUncached(query, writeEpoch);
  if (isFactoryResetWriteAllowed(writeEpoch)) memoryCache.set(query, location);
  return location;
}

async function geocodeUncached(
  query: string,
  writeEpoch: number,
): Promise<GeoLocation | null> {
  try {
    if (!isFactoryResetWriteAllowed(writeEpoch)) return null;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
    const res = await throttledFetch(url, writeEpoch);
    if (!res.ok) {
      if (isFactoryResetWriteAllowed(writeEpoch)) await saveToCache(query, null);
      return null;
    }

    const results: NominatimResult[] = await res.json();
    if (results.length === 0) {
      if (isFactoryResetWriteAllowed(writeEpoch)) await saveToCache(query, null);
      return null;
    }

    const result = results[0];
    const location: GeoLocation = {
      latitude: Number.parseFloat(result.lat),
      longitude: Number.parseFloat(result.lon),
      name: result.display_name,
      city: result.address?.city ?? result.address?.town ?? result.address?.village,
      country: result.address?.country,
    };

    if (isFactoryResetWriteAllowed(writeEpoch)) await saveToCache(query, location);
    return location;
  } catch {
    return null;
  }
}
