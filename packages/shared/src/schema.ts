/**
 * @freed/shared - Automerge document schema
 *
 * CRDT-based storage for conflict-free multi-device sync
 */

import * as A from "@automerge/automerge";
import type {
  FeedItem,
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
 * Add a feed item to the document
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param item - The feed item to add
 */
export function addFeedItem(doc: FreedDoc, item: FeedItem): void {
  doc.feedItems[item.globalId] = item;
}

/**
 * Update a feed item in the document
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
    Object.assign(existing, updates);
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

// =============================================================================
// RSS Feed Operations
// =============================================================================

/**
 * Add an RSS feed subscription
 *
 * @param doc - The Automerge document (mutable within A.change)
 * @param feed - The RSS feed to add
 */
export function addRssFeed(doc: FreedDoc, feed: RssFeed): void {
  doc.rssFeeds[feed.url] = feed;
}

/**
 * Update an RSS feed
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
    Object.assign(existing, updates);
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
