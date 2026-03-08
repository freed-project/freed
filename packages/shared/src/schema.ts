/**
 * @freed/shared - Automerge document schema
 *
 * CRDT-based storage for conflict-free multi-device sync
 */

import * as A from "@automerge/automerge";
import type {
  FeedItem,
  Friend,
  ReachOutLog,
  RssFeed,
  UserPreferences,
  DocumentMeta,
} from "./types.js";
import { createDefaultPreferences, createDefaultMeta } from "./types.js";

// =============================================================================
// Document Schema
// =============================================================================

/**
 * Root Freed document structure
 *
 * This is the Automerge document that syncs across all devices.
 * Using Record<string, T> for CRDT-friendly map operations.
 */
export interface FreedDoc {
  /** Feed items indexed by globalId */
  feedItems: Record<string, FeedItem>;

  /** RSS feed subscriptions indexed by URL */
  rssFeeds: Record<string, RssFeed>;

  /** Friends (unified identities) indexed by Friend.id */
  friends: Record<string, Friend>;

  /** User preferences */
  preferences: UserPreferences;

  /** Document metadata */
  meta: DocumentMeta;
}

// =============================================================================
// Document Creation
// =============================================================================

/**
 * Create a new empty Freed document
 */
export function createEmptyDoc(): FreedDoc {
  const doc: FreedDoc = {
    feedItems: {},
    rssFeeds: {},
    friends: {},
    preferences: createDefaultPreferences(),
    meta: createDefaultMeta(),
  };
  return A.from(
    doc as unknown as Record<string, unknown>
  ) as unknown as FreedDoc;
}

/**
 * Initialize document from existing data (for migrations)
 */
export function createDocFromData(data: Partial<FreedDoc>): FreedDoc {
  const doc: FreedDoc = {
    feedItems: data.feedItems ?? {},
    rssFeeds: data.rssFeeds ?? {},
    friends: data.friends ?? {},
    preferences: data.preferences ?? createDefaultPreferences(),
    meta: data.meta ?? createDefaultMeta(),
  };
  return A.from(
    doc as unknown as Record<string, unknown>
  ) as unknown as FreedDoc;
}

// =============================================================================
// Feed Item Operations
// =============================================================================

/**
 * Recursively remove any keys whose value is `undefined` from a plain object.
 *
 * Automerge's CRDT proxy throws on `undefined` assignments. This is a
 * last-resort defensive sanitizer applied before writing to the document —
 * normalizers should already produce clean objects, but this prevents a single
 * bad optional field from crashing the whole capture.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        result[k] = stripUndefined(v);
      }
    }
    return result as T;
  }
  return value;
}

/**
 * Add a feed item to the document
 *
 * Strips any `undefined` values before writing — Automerge's proxy throws on
 * them, and a single bad optional field would otherwise crash the whole capture.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param item - The feed item to add
 */
export function addFeedItem(doc: FreedDoc, item: FeedItem): void {
  doc.feedItems[item.globalId] = stripUndefined(item);
}

/**
 * Update a feed item in the document
 *
 * Strips `undefined` values before writing — callers may produce partial
 * updates where optional fields are `undefined` (e.g. `savedAt` when
 * un-saving, `author` when content extraction yields nothing).
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 * @param updates - Partial updates to apply
 */
export function updateFeedItem(
  doc: FreedDoc,
  globalId: string,
  updates: Partial<FeedItem>
): void {
  const existing = doc.feedItems[globalId];
  if (existing) {
    Object.assign(existing, stripUndefined(updates));
  }
}

/**
 * Remove a feed item from the document
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function removeFeedItem(doc: FreedDoc, globalId: string): void {
  delete doc.feedItems[globalId];
}

/**
 * Mark a feed item as read
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function markAsRead(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (item) {
    item.userState.readAt = Date.now();
  }
}

/**
 * Toggle archived status for a feed item, maintaining the archivedAt timestamp.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function toggleArchived(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (!item) return;
  if (item.userState.archived) {
    item.userState.archived = false;
    delete (item.userState as unknown as Record<string, unknown>).archivedAt;
  } else {
    item.userState.archived = true;
    item.userState.archivedAt = Date.now();
  }
}

/**
 * Archive all read, non-saved items — optionally scoped to a platform or feed.
 * Skips items already archived, hidden, or saved.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param platform - Optional platform filter (e.g. "rss", "x")
 * @param feedUrl - Optional RSS feed URL filter
 */
export function archiveAllReadUnsaved(
  doc: FreedDoc,
  platform?: string,
  feedUrl?: string,
): number {
  const now = Date.now();
  let count = 0;
  for (const item of Object.values(doc.feedItems)) {
    if (item.userState.archived) continue;
    if (item.userState.hidden) continue;
    if (item.userState.saved) continue;
    if (!item.userState.readAt) continue;
    if (platform && item.platform !== platform) continue;
    if (feedUrl && item.rssSource?.feedUrl !== feedUrl) continue;
    item.userState.archived = true;
    item.userState.archivedAt = now;
    count++;
  }
  return count;
}

/**
 * Delete archived items older than maxAgeMs. Saved items are never deleted.
 * Items archived before archivedAt was introduced (no timestamp) are skipped.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param maxAgeMs - Max age in milliseconds (default: 30 days)
 * @returns Number of items deleted
 */
export function pruneArchivedItems(
  doc: FreedDoc,
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000,
): number {
  if (maxAgeMs <= 0) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const [id, item] of Object.entries(doc.feedItems)) {
    if (!item.userState.archived) continue;
    if (item.userState.saved) continue;
    const { archivedAt } = item.userState;
    if (archivedAt !== undefined && archivedAt < cutoff) {
      delete doc.feedItems[id];
      pruned++;
    }
  }
  return pruned;
}

/**
 * Toggle bookmark status for a feed item
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function toggleSaved(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (item) {
    item.userState.saved = !item.userState.saved;
    if (item.userState.saved) {
      item.userState.savedAt = Date.now();
    } else {
      // Automerge forbids assigning `undefined` — use delete instead
      delete (item.userState as unknown as Record<string, unknown>).savedAt;
    }
  }
}

/**
 * Hide a feed item
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function hideItem(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (item) {
    item.userState.hidden = true;
  }
}

/**
 * Toggle liked status for a feed item.
 * Sets liked + likedAt on like, clears all three like fields on unlike.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function toggleLiked(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId];
  if (!item) return;
  const us = item.userState as unknown as Record<string, unknown>;
  if (item.userState.liked) {
    us.liked = false;
    delete us.likedAt;
    delete us.likedSyncedAt;
  } else {
    us.liked = true;
    us.likedAt = Date.now();
    delete us.likedSyncedAt;
  }
}

/**
 * Confirm that the like was successfully synced to the source platform.
 * Called by the outbox processor after a successful platform action.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 * @param syncedAt - Timestamp when the sync completed (or -1 for permanent failure)
 */
export function confirmLikedSynced(
  doc: FreedDoc,
  globalId: string,
  syncedAt: number = Date.now(),
): void {
  const item = doc.feedItems[globalId];
  if (item) {
    (item.userState as unknown as Record<string, unknown>).likedSyncedAt = syncedAt;
  }
}

/**
 * Confirm that the seen-impression was successfully synced to the source platform.
 * Called by the outbox processor after a successful platform action.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 * @param syncedAt - Timestamp when the sync completed (or -1 for permanent failure)
 */
export function confirmSeenSynced(
  doc: FreedDoc,
  globalId: string,
  syncedAt: number = Date.now(),
): void {
  const item = doc.feedItems[globalId];
  if (item) {
    (item.userState as unknown as Record<string, unknown>).seenSyncedAt = syncedAt;
  }
}

// =============================================================================
// RSS Feed Operations
// =============================================================================

/**
 * Add an RSS feed subscription
 *
 * Strips `undefined` values before writing — feed metadata derived from live
 * XML (imageUrl, siteUrl, etc.) is optional and may be undefined for feeds
 * that lack those elements.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param feed - The RSS feed to add
 */
export function addRssFeed(doc: FreedDoc, feed: RssFeed): void {
  doc.rssFeeds[feed.url] = stripUndefined(feed);
}

/**
 * Update an RSS feed
 *
 * Strips `undefined` values before writing for the same reasons as addRssFeed.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 * @param updates - Partial updates to apply
 */
export function updateRssFeed(
  doc: FreedDoc,
  url: string,
  updates: Partial<RssFeed>
): void {
  const existing = doc.rssFeeds[url];
  if (existing) {
    Object.assign(existing, stripUndefined(updates));
  }
}

/**
 * Remove an RSS feed subscription
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 */
export function removeRssFeed(doc: FreedDoc, url: string): void {
  delete doc.rssFeeds[url];
}

/**
 * Toggle feed enabled status
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 */
export function toggleFeedEnabled(doc: FreedDoc, url: string): void {
  const feed = doc.rssFeeds[url];
  if (feed) {
    feed.enabled = !feed.enabled;
  }
}

/**
 * Remove all RSS feed subscriptions in a single CRDT change.
 *
 * This propagates to all synced devices. When `includeItems` is true,
 * all feedItems are also deleted — equivalent to a full data wipe.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param includeItems - Whether to also delete all feed items
 */
export function removeAllFeeds(doc: FreedDoc, includeItems: boolean): void {
  for (const url of Object.keys(doc.rssFeeds)) {
    delete doc.rssFeeds[url];
  }
  if (includeItems) {
    for (const id of Object.keys(doc.feedItems)) {
      delete doc.feedItems[id];
    }
  }
}

// =============================================================================
// Friend Operations
// =============================================================================

/**
 * Add a friend to the document
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param friend - The friend to add
 */
export function addFriend(doc: FreedDoc, friend: Friend): void {
  doc.friends[friend.id] = friend;
}

/**
 * Update a friend's scalar and array fields.
 *
 * Uses field-by-field assignment rather than Object.assign to avoid replacing
 * Automerge Map/List proxies (sources, reachOutLog arrays) with plain objects.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param id - Friend.id
 * @param updates - Partial updates to apply
 */
export function updateFriend(
  doc: FreedDoc,
  id: string,
  updates: Partial<Friend>
): void {
  const existing = doc.friends[id];
  if (!existing) return;

  const { sources, reachOutLog, contact, ...scalars } = updates;

  // Assign scalar fields directly
  Object.assign(existing, scalars);

  // Replace sources array by splicing (Automerge list proxy)
  if (sources !== undefined) {
    existing.sources.splice(0, existing.sources.length, ...sources);
  }

  // Replace reachOutLog array by splicing
  if (reachOutLog !== undefined) {
    if (!existing.reachOutLog) {
      existing.reachOutLog = reachOutLog;
    } else {
      existing.reachOutLog.splice(
        0,
        existing.reachOutLog.length,
        ...reachOutLog
      );
    }
  }

  // Replace contact by assigning individual fields (never replace the Map)
  if (contact !== undefined) {
    if (!existing.contact) {
      existing.contact = contact;
    } else {
      deepMergeInto(
        existing.contact as unknown as Record<string, unknown>,
        contact as unknown as Record<string, unknown>
      );
    }
  }

  existing.updatedAt = Date.now();
}

/**
 * Remove a friend from the document
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param id - Friend.id
 */
export function removeFriend(doc: FreedDoc, id: string): void {
  delete doc.friends[id];
}

/**
 * Prepend a reach-out log entry for a friend, capped at 20 entries.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param id - Friend.id
 * @param entry - The reach-out log entry
 */
export function logReachOut(
  doc: FreedDoc,
  id: string,
  entry: ReachOutLog
): void {
  const friend = doc.friends[id];
  if (!friend) return;

  if (!friend.reachOutLog) {
    friend.reachOutLog = [entry];
  } else {
    friend.reachOutLog.unshift(entry);
    // Keep the log bounded to 20 entries
    if (friend.reachOutLog.length > 20) {
      friend.reachOutLog.splice(20);
    }
  }

  friend.updatedAt = Date.now();
}

// =============================================================================
// Preferences Operations
// =============================================================================

/**
 * Deep-merge scalar values from `source` into the Automerge map `target`.
 *
 * Automerge forbids replacing an existing nested Map with a new object.
 * This helper recurses into nested objects and assigns only scalar leaf values,
 * which allows callers to pass spread objects that may contain Automerge
 * proxy references in their nested sub-objects.
 */
function deepMergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const dstVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      typeof dstVal === "object" &&
      dstVal !== null
    ) {
      // Recurse into nested objects instead of replacing the Automerge Map
      deepMergeInto(
        dstVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      target[key] = srcVal;
    }
  }
}

/**
 * Update user preferences
 *
 * Uses deep merging to avoid replacing Automerge Map objects, which is
 * forbidden. Only scalar leaf values are assigned directly.
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param updates - Partial preference updates
 */
export function updatePreferences(
  doc: FreedDoc,
  updates: Partial<UserPreferences>
): void {
  deepMergeInto(
    doc.preferences as unknown as Record<string, unknown>,
    updates as unknown as Record<string, unknown>
  );
}

/**
 * Set author weight
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param authorId - The author's ID
 * @param weight - Weight value (0-100)
 */
export function setAuthorWeight(
  doc: FreedDoc,
  authorId: string,
  weight: number
): void {
  doc.preferences.weights.authors[authorId] = weight;
}

/**
 * Set topic weight
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param topic - The topic
 * @param weight - Weight value (0-100)
 */
export function setTopicWeight(
  doc: FreedDoc,
  topic: string,
  weight: number
): void {
  doc.preferences.weights.topics[topic] = weight;
}

/**
 * Set platform weight
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param platform - The platform
 * @param weight - Weight value (0-100)
 */
export function setPlatformWeight(
  doc: FreedDoc,
  platform: string,
  weight: number
): void {
  doc.preferences.weights.platforms[platform] = weight;
}

// =============================================================================
// Document Metadata Operations
// =============================================================================

/**
 * Update last sync timestamp
 *
 * @param doc - The Automerge document (mutable within A.change)
 */
export function updateLastSync(doc: FreedDoc): void {
  doc.meta.lastSync = Date.now();
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Get all feed items sorted by published date (newest first)
 */
export function getFeedItemsSorted(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get feed items by platform
 */
export function getFeedItemsByPlatform(
  doc: FreedDoc,
  platform: string
): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => item.platform === platform && !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get saved items
 */
export function getSavedItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => item.userState.saved && !item.userState.archived)
    .sort((a, b) => (b.userState.savedAt ?? 0) - (a.userState.savedAt ?? 0));
}

/**
 * Get archived items
 */
export function getArchivedItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => item.userState.archived)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get unread items
 */
export function getUnreadItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter((item) => !item.userState.readAt && !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get enabled RSS feeds
 */
export function getEnabledFeeds(doc: FreedDoc): RssFeed[] {
  return Object.values(doc.rssFeeds).filter((feed) => feed.enabled);
}

/**
 * Check if a feed item exists
 */
export function hasFeedItem(doc: FreedDoc, globalId: string): boolean {
  return globalId in doc.feedItems;
}
