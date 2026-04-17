/**
 * @freed/shared - Location types and extraction utilities
 *
 * Pure functions only, no side effects, no network calls.
 */

import { friendForAuthor, personForAuthor } from "./friends";
import type { Account, FeedItem, Friend, MapMode, Person } from "./types.js";

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
  friend: Person | null;
  lat: number;
  lng: number;
  label?: string;
}

export interface LocationMarkerSummary {
  key: string;
  authorKey: string;
  friend: Person | null;
  item: FeedItem;
  lat: number;
  lng: number;
  label?: string;
  groupCount: number;
  seenAt: number;
}

interface NamedLocationSignal {
  name: string;
}

export interface LocationCandidate {
  coordinates?: { lat: number; lng: number };
  name?: string;
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

const LOW_CONFIDENCE_LOCATION_LABELS = new Set([
  "locations",
  "check registration",
]);

function titleCaseLocationSlug(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 2) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function isLowConfidenceLocationLabel(label: string | null | undefined): boolean {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) return true;
  return LOW_CONFIDENCE_LOCATION_LABELS.has(normalized);
}

export function recoverLocationNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url, "https://www.instagram.com");
    const segments = parsed.pathname.split("/").filter(Boolean);
    const locationIndex = segments.findIndex((segment) => segment === "locations");
    const slug = locationIndex >= 0 ? segments[locationIndex + 2] ?? null : segments.at(-1) ?? null;
    if (!slug) return null;

    const decoded = decodeURIComponent(slug)
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!decoded || /^\d+$/.test(decoded)) return null;
    if (isLowConfidenceLocationLabel(decoded)) return null;

    return titleCaseLocationSlug(decoded);
  } catch {
    return null;
  }
}

export function sanitizeLocationName(
  name: string | null | undefined,
  url: string | null | undefined,
): string | null {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || isLowConfidenceLocationLabel(trimmed)) {
    return recoverLocationNameFromUrl(url);
  }
  return trimmed;
}

export function getLocationCandidate(item: FeedItem): LocationCandidate | null {
  if (item.location?.coordinates) {
    const sanitizedName = sanitizeLocationName(item.location.name, item.location.url);
    return {
      coordinates: item.location.coordinates,
      ...(sanitizedName ? { name: sanitizedName } : {}),
    };
  }

  const sanitizedName = sanitizeLocationName(item.location?.name, item.location?.url);
  if (sanitizedName) {
    return { name: sanitizedName };
  }

  const text = item.content.text;
  if (text) {
    const extracted = extractLocationFromText(text);
    if (extracted) return { name: extracted };
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
): { coordinates: { lat: number; lng: number }; name?: string } | NamedLocationSignal | null {
  const candidate = getLocationCandidate(item);
  if (!candidate) return null;
  if (candidate.coordinates) {
    return {
      coordinates: candidate.coordinates,
      ...(candidate.name ? { name: candidate.name } : {}),
    };
  }
  if (candidate.name) {
    return { name: candidate.name };
  }
  return null;
}

function authorIdentityKey(item: FeedItem): string {
  return `author:${item.platform}:${item.author.id}`;
}

function friendIdentityKey(friend: Person): string {
  return `friend:${friend.id}`;
}

function markerIdentityKey(resolved: ResolvedLocationItem): string {
  return resolved.friend
    ? friendIdentityKey(resolved.friend)
    : authorIdentityKey(resolved.item);
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

export function getLatestAuthorLocationMarkers(
  resolvedItems: ResolvedLocationItem[]
): LocationMarkerSummary[] {
  const latestByAuthor = new Map<string, ResolvedLocationItem>();

  for (const resolved of resolvedItems) {
    const authorKey = authorIdentityKey(resolved.item);
    const existing = latestByAuthor.get(authorKey);
    if (!existing || resolved.item.publishedAt > existing.item.publishedAt) {
      latestByAuthor.set(authorKey, resolved);
    }
  }

  return Array.from(latestByAuthor.entries())
    .map(([authorKey, resolved]) => {
      const pointKey = coordinateKey(resolved.lat, resolved.lng);
      const groupCount = resolvedItems.filter(
        (candidate) =>
          authorIdentityKey(candidate.item) === authorKey &&
          coordinateKey(candidate.lat, candidate.lng) === pointKey
      ).length;

      return {
        key: authorKey,
        authorKey,
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
  personsOrFriends: Record<string, Person> | Record<string, Friend>,
  accounts?: Record<string, Account>,
  windowMs: number = 7 * 24 * 60 * 60 * 1000,
  now: number = Date.now()
): number {
  const cutoff = now - windowMs;
  const friendIds = new Set<string>();

  for (const item of items) {
    if (item.publishedAt < cutoff) continue;
    if (!extractLocationFromItem(item)) continue;

    const friend = accounts
      ? personForAuthor(
          personsOrFriends as Record<string, Person>,
          accounts,
          item.platform,
          item.author.id,
        )
      : friendForAuthor(
          personsOrFriends as Record<string, Friend>,
          item.platform,
          item.author.id,
        );
    if (friend) {
      friendIds.add(friend.id);
    }
  }

  return friendIds.size;
}

export function countAuthorsWithRecentLocationUpdates(
  items: FeedItem[],
  windowMs: number = 7 * 24 * 60 * 60 * 1000,
  now: number = Date.now()
): number {
  const cutoff = now - windowMs;
  const authorIds = new Set<string>();

  for (const item of items) {
    if (item.publishedAt < cutoff) continue;
    if (!extractLocationFromItem(item)) continue;
    authorIds.add(authorIdentityKey(item));
  }

  return authorIds.size;
}

export function getDefaultMapMode(
  friendMarkerCount: number,
  allContentMarkerCount: number
): MapMode {
  if (friendMarkerCount > 0) return "friends";
  if (allContentMarkerCount > 0) return "all_content";
  return "friends";
}
