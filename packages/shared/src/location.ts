/**
 * @freed/shared - Location types and extraction utilities
 *
 * Pure functions only, no side effects, no network calls.
 */

import { friendForAuthor } from "./friends.js";
import type { FeedItem, Friend } from "./types.js";

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

export interface ResolvedLocationItem {
  item: FeedItem;
  friend: Friend | null;
  lat: number;
  lng: number;
  label?: string;
}

export interface LocationMarkerSummary {
  key: string;
  authorKey: string;
  friend: Friend | null;
  item: FeedItem;
  lat: number;
  lng: number;
  label?: string;
  groupCount: number;
  seenAt: number;
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

function markerIdentityKey(resolved: ResolvedLocationItem): string {
  return resolved.friend
    ? `friend:${resolved.friend.id}`
    : `author:${resolved.item.platform}:${resolved.item.author.id}`;
}

function coordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

export function groupResolvedLocations(
  resolvedItems: ResolvedLocationItem[]
): LocationMarkerSummary[] {
  const groups = new Map<string, LocationMarkerSummary>();

  for (const resolved of resolvedItems) {
    const authorKey = markerIdentityKey(resolved);
    const key = `${authorKey}:${coordinateKey(resolved.lat, resolved.lng)}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        authorKey,
        friend: resolved.friend,
        item: resolved.item,
        lat: resolved.lat,
        lng: resolved.lng,
        label: resolved.label,
        groupCount: 1,
        seenAt: resolved.item.publishedAt,
      });
      continue;
    }

    const isNewer = resolved.item.publishedAt > existing.seenAt;
    existing.groupCount += 1;

    if (isNewer) {
      existing.item = resolved.item;
      existing.friend = resolved.friend;
      existing.label = resolved.label ?? existing.label;
      existing.seenAt = resolved.item.publishedAt;
    } else if (!existing.label && resolved.label) {
      existing.label = resolved.label;
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.seenAt - a.seenAt);
}

export function getLatestFriendLocationMarkers(
  resolvedItems: ResolvedLocationItem[]
): LocationMarkerSummary[] {
  const latestByFriend = new Map<string, ResolvedLocationItem>();

  for (const resolved of resolvedItems) {
    if (!resolved.friend) continue;

    const existing = latestByFriend.get(resolved.friend.id);
    if (!existing || resolved.item.publishedAt > existing.item.publishedAt) {
      latestByFriend.set(resolved.friend.id, resolved);
    }
  }

  return Array.from(latestByFriend.values())
    .map((resolved) => {
      const pointKey = coordinateKey(resolved.lat, resolved.lng);
      const groupCount = resolvedItems.filter(
        (candidate) =>
          candidate.friend?.id === resolved.friend?.id &&
          coordinateKey(candidate.lat, candidate.lng) === pointKey
      ).length;

      return {
        key: `friend:${resolved.friend!.id}`,
        authorKey: markerIdentityKey(resolved),
        friend: resolved.friend,
        item: resolved.item,
        lat: resolved.lat,
        lng: resolved.lng,
        label: resolved.label,
        groupCount,
        seenAt: resolved.item.publishedAt,
      };
    })
    .sort((a, b) => b.seenAt - a.seenAt);
}

export function getLastSeenLocationForFriend(
  resolvedItems: ResolvedLocationItem[],
  friendId: string
): LocationMarkerSummary | null {
  return (
    getLatestFriendLocationMarkers(
      resolvedItems.filter((resolved) => resolved.friend?.id === friendId)
    )[0] ?? null
  );
}

export function countFriendsWithRecentLocationUpdates(
  items: FeedItem[],
  friends: Record<string, Friend>,
  windowMs: number = 7 * 24 * 60 * 60 * 1000,
  now: number = Date.now()
): number {
  const cutoff = now - windowMs;
  const friendIds = new Set<string>();

  for (const item of items) {
    if (item.publishedAt < cutoff) continue;
    if (!extractLocationFromItem(item)) continue;

    const friend = friendForAuthor(friends, item.platform, item.author.id);
    if (friend) {
      friendIds.add(friend.id);
    }
  }

  return friendIds.size;
}
