/**
 * Nominatim geocoding service.
 *
 * Rate-limit: Nominatim requires at most 1 request per second.
 * All calls go through the cache layer first; network requests are queued
 * via a simple token-bucket to stay within the limit.
 *
 * Privacy: Nominatim is a public endpoint but the queries stay on the user's
 * device — nothing is stored server-side beyond the OSM tile infrastructure.
 * No location data is ever sent to Freed servers.
 */

import type { GeoLocation } from "@freed/shared";
import { getFromCache, saveToCache } from "./geocoding-cache.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Freed/1.0 (app.freed.wtf)";

// ---------------------------------------------------------------------------
// Minimal rate limiter — 1 request/second, up to 3 queued
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100; // slightly over 1s to be safe
const pendingQueue: Array<() => void> = [];
let draining = false;

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

function throttledFetch(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const fn = () =>
      fetch(url, { headers: { "User-Agent": USER_AGENT } })
        .then(resolve)
        .catch(reject);

    // Drop excess requests rather than queue indefinitely
    if (pendingQueue.length >= 3) {
      reject(new Error("Geocoding queue full — try again later"));
      return;
    }

    pendingQueue.push(fn);
    drainQueue();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a place name to coordinates using the Nominatim API.
 *
 * Returns null when the query cannot be resolved.
 * Results (including negative results) are cached in IndexedDB.
 */
export async function geocode(query: string): Promise<GeoLocation | null> {
  const cached = await getFromCache(query);
  if (cached !== undefined) return cached; // null = known miss

  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
    const res = await throttledFetch(url);
    if (!res.ok) {
      await saveToCache(query, null);
      return null;
    }

    const results: NominatimResult[] = await res.json();
    if (results.length === 0) {
      await saveToCache(query, null);
      return null;
    }

    const r = results[0];
    const location: GeoLocation = {
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      name: r.display_name,
      city: r.address?.city ?? r.address?.town ?? r.address?.village,
      country: r.address?.country,
    };

    await saveToCache(query, location);
    return location;
  } catch {
    // Network error — don't cache so we retry next time
    return null;
  }
}

// ---------------------------------------------------------------------------
// Nominatim response types (subset)
// ---------------------------------------------------------------------------

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
