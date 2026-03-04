/**
 * @freed/shared - Location types and extraction utilities
 *
 * Pure functions only — no side effects, no network calls.
 */

import type { FeedItem } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Resolved geographic coordinates with optional metadata.
 * Distinct from the existing `Location` type on FeedItem which is capture-time
 * data. GeoLocation is the result after geocoding is applied.
 */
export interface GeoLocation {
  latitude: number;
  longitude: number;
  name?: string;
  city?: string;
  country?: string;
}

// =============================================================================
// Text pattern extraction
// =============================================================================

const LOCATION_PATTERNS: RegExp[] = [
  /📍\s*([^\n,]{2,60})/u,                               // 📍 New York
  /🌍\s*([^\n,]{2,60})/u,                               // 🌍 London
  /🌎\s*([^\n,]{2,60})/u,                               // 🌎 São Paulo
  /🌏\s*([^\n,]{2,60})/u,                               // 🌏 Tokyo
  /(?:^|\s)(?:in|at|from)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)*)/u, // "in Paris"
];

/**
 * Try to extract a place name from free text.
 * Returns the first match or null.
 */
export function extractLocationFromText(text: string): string | null {
  for (const pattern of LOCATION_PATTERNS) {
    const m = pattern.exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// =============================================================================
// FeedItem location extraction
// =============================================================================

/**
 * Extract geographic coordinates from a FeedItem.
 *
 * Priority:
 *   1. Explicit geo-tag coordinates (most accurate)
 *   2. Named location on the item (needs geocoding)
 *   3. Text pattern extraction from content (least accurate)
 *
 * Returns null when no location signal is found.
 */
export function extractLocationFromItem(
  item: FeedItem
): { coordinates: { lat: number; lng: number }; name?: string } | { name: string } | null {
  // 1. Explicit coordinates from geo-tag or check-in
  if (item.location?.coordinates) {
    return {
      coordinates: item.location.coordinates,
      name: item.location.name,
    };
  }

  // 2. Named location without coordinates — needs geocoding
  if (item.location?.name) {
    return { name: item.location.name };
  }

  // 3. Text extraction
  const text = item.content.text;
  if (text) {
    const extracted = extractLocationFromText(text);
    if (extracted) return { name: extracted };
  }

  return null;
}
