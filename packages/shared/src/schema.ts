/**
 * @freed/shared - Automerge document schema
 * 
 * CRDT-based storage for conflict-free multi-device sync
 */

import * as A from '@automerge/automerge'
import type {
  FeedItem,
  RssFeed,
  UserPreferences,
  DocumentMeta
} from './types.js'
import {
  createDefaultPreferences,
  createDefaultMeta
} from './types.js'

// =============================================================================
// Document Schema
// =============================================================================

/**
 * Root FREED document structure
 * 
 * This is the Automerge document that syncs across all devices.
 * Using Record<string, T> for CRDT-friendly map operations.
 */
export interface FreedDoc {
  /** Feed items indexed by globalId */
  feedItems: Record<string, FeedItem>
  
  /** RSS feed subscriptions indexed by URL */
  rssFeeds: Record<string, RssFeed>
  
  /** User preferences */
  preferences: UserPreferences
  
  /** Document metadata */
  meta: DocumentMeta
}

// =============================================================================
// Document Creation
// =============================================================================

/**
 * Create a new empty FREED document
 */
export function createEmptyDoc(): FreedDoc {
  const doc: FreedDoc = {
    feedItems: {},
    rssFeeds: {},
    preferences: createDefaultPreferences(),
    meta: createDefaultMeta()
  }
  return A.from(doc as unknown as Record<string, unknown>) as unknown as FreedDoc
}

/**
 * Initialize document from existing data (for migrations)
 */
export function createDocFromData(data: Partial<FreedDoc>): FreedDoc {
  const doc: FreedDoc = {
    feedItems: data.feedItems ?? {},
    rssFeeds: data.rssFeeds ?? {},
    preferences: data.preferences ?? createDefaultPreferences(),
    meta: data.meta ?? createDefaultMeta()
  }
  return A.from(doc as unknown as Record<string, unknown>) as unknown as FreedDoc
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
  doc.feedItems[item.globalId] = item
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
  const existing = doc.feedItems[globalId]
  if (existing) {
    Object.assign(existing, updates)
  }
}

/**
 * Remove a feed item from the document
 * 
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function removeFeedItem(doc: FreedDoc, globalId: string): void {
  delete doc.feedItems[globalId]
}

/**
 * Mark a feed item as read
 * 
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function markAsRead(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId]
  if (item) {
    item.userState.readAt = Date.now()
  }
}

/**
 * Toggle bookmark status for a feed item
 * 
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function toggleBookmark(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId]
  if (item) {
    item.userState.bookmarked = !item.userState.bookmarked
  }
}

/**
 * Hide a feed item
 * 
 * @param doc - The Automerge document (mutable within A.change)
 * @param globalId - The item's global ID
 */
export function hideItem(doc: FreedDoc, globalId: string): void {
  const item = doc.feedItems[globalId]
  if (item) {
    item.userState.hidden = true
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
  doc.rssFeeds[feed.url] = feed
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
  const existing = doc.rssFeeds[url]
  if (existing) {
    Object.assign(existing, updates)
  }
}

/**
 * Remove an RSS feed subscription
 * 
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 */
export function removeRssFeed(doc: FreedDoc, url: string): void {
  delete doc.rssFeeds[url]
}

/**
 * Toggle feed enabled status
 * 
 * @param doc - The Automerge document (mutable within A.change)
 * @param url - The feed URL
 */
export function toggleFeedEnabled(doc: FreedDoc, url: string): void {
  const feed = doc.rssFeeds[url]
  if (feed) {
    feed.enabled = !feed.enabled
  }
}

// =============================================================================
// Preferences Operations
// =============================================================================

/**
 * Update user preferences
 * 
 * @param doc - The Automerge document (mutable within A.change)
 * @param updates - Partial preference updates
 */
export function updatePreferences(
  doc: FreedDoc,
  updates: Partial<UserPreferences>
): void {
  Object.assign(doc.preferences, updates)
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
  doc.preferences.weights.authors[authorId] = weight
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
  doc.preferences.weights.topics[topic] = weight
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
  doc.preferences.weights.platforms[platform] = weight
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
  doc.meta.lastSync = Date.now()
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Get all feed items sorted by published date (newest first)
 */
export function getFeedItemsSorted(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter(item => !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

/**
 * Get feed items by platform
 */
export function getFeedItemsByPlatform(
  doc: FreedDoc,
  platform: string
): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter(item => item.platform === platform && !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

/**
 * Get bookmarked items
 */
export function getBookmarkedItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter(item => item.userState.bookmarked)
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

/**
 * Get unread items
 */
export function getUnreadItems(doc: FreedDoc): FeedItem[] {
  return Object.values(doc.feedItems)
    .filter(item => !item.userState.readAt && !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

/**
 * Get enabled RSS feeds
 */
export function getEnabledFeeds(doc: FreedDoc): RssFeed[] {
  return Object.values(doc.rssFeeds).filter(feed => feed.enabled)
}

/**
 * Check if a feed item exists
 */
export function hasFeedItem(doc: FreedDoc, globalId: string): boolean {
  return globalId in doc.feedItems
}
