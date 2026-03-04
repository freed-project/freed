/**
 * @freed/shared - Friends identity resolution and CRM utilities
 *
 * Pure functions only. No React, no side effects, no Automerge imports.
 * Safe to call in hot render paths (FeedItem cards, graph nodes, etc.).
 */

import type { FeedItem, Friend, Platform } from "./types.js";

// =============================================================================
// Interval Defaults
// =============================================================================

/**
 * Default reach-out interval in days per care level.
 * Level 5 (closest) = weekly nudge. Level 1 = never nudged.
 */
const DEFAULT_INTERVALS: Record<1 | 2 | 3 | 4 | 5, number | null> = {
  5: 7,
  4: 14,
  3: 30,
  2: 90,
  1: null, // never nudged
};

/**
 * Returns the effective reach-out interval in days for a friend.
 * Returns null if the friend should never receive a nudge.
 */
export function effectiveInterval(
  careLevel: 1 | 2 | 3 | 4 | 5,
  overrideDays?: number
): number | null {
  if (overrideDays !== undefined) return overrideDays;
  return DEFAULT_INTERVALS[careLevel];
}

// =============================================================================
// Identity Resolution
// =============================================================================

/**
 * Look up which Friend (if any) a given platform author belongs to.
 *
 * Hot path — called on every FeedItem render. O(F*S) where F = friend count
 * and S = sources per friend. For typical social graphs (< 500 friends,
 * < 5 sources each) this is negligible. Cache the result if needed.
 */
export function friendForAuthor(
  friends: Record<string, Friend>,
  platform: Platform,
  authorId: string
): Friend | null {
  for (const friend of Object.values(friends)) {
    for (const src of friend.sources) {
      if (src.platform === platform && src.authorId === authorId) {
        return friend;
      }
    }
  }
  return null;
}

/**
 * Collect all FeedItems that belong to a given Friend across all their
 * linked social sources.
 */
export function feedItemsForFriend(
  feedItems: Record<string, FeedItem>,
  friend: Friend
): FeedItem[] {
  // Build a fast lookup set: "platform:authorId"
  const sourceKeys = new Set(
    friend.sources.map((s) => `${s.platform}:${s.authorId}`)
  );

  return Object.values(feedItems).filter((item) =>
    sourceKeys.has(`${item.platform}:${item.author.id}`)
  );
}

/**
 * Returns the publishedAt timestamp of the most recent FeedItem for a Friend,
 * or null if they have no captured posts.
 */
export function lastPostAt(
  feedItems: Record<string, FeedItem>,
  friend: Friend
): number | null {
  const items = feedItemsForFriend(feedItems, friend);
  if (items.length === 0) return null;
  return Math.max(...items.map((i) => i.publishedAt));
}

/**
 * Count posts published within the last `windowMs` milliseconds.
 * Used for graph node sizing.
 */
export function recentPostCount(
  feedItems: Record<string, FeedItem>,
  friend: Friend,
  windowMs: number = 7 * 24 * 60 * 60 * 1000
): number {
  const cutoff = Date.now() - windowMs;
  return feedItemsForFriend(feedItems, friend).filter(
    (i) => i.publishedAt >= cutoff
  ).length;
}

// =============================================================================
// CRM: Reach-out timing
// =============================================================================

/**
 * Returns the timestamp of the most recent logged reach-out, or null.
 */
export function lastReachOutAt(friend: Friend): number | null {
  if (!friend.reachOutLog || friend.reachOutLog.length === 0) return null;
  // Log is stored most-recent-first
  return friend.reachOutLog[0].loggedAt;
}

/**
 * Returns true when the user is due to reach out to this friend.
 *
 * A friend is "due" when:
 *   - Their care level is 2–5 (level 1 is never nudged)
 *   - Days since last reach-out exceeds their effective interval
 */
export function isDue(friend: Friend, now: number = Date.now()): boolean {
  const interval = effectiveInterval(friend.careLevel, friend.reachOutIntervalDays);
  if (interval === null) return false; // level 1 — never nudge

  const lastContact = lastReachOutAt(friend);
  if (lastContact === null) {
    // Never reached out: treat createdAt as the baseline so brand-new friends
    // don't immediately land in the reconnect ring.
    const daysSinceAdded = (now - friend.createdAt) / (1000 * 60 * 60 * 24);
    return daysSinceAdded > interval;
  }

  const daysSince = (now - lastContact) / (1000 * 60 * 60 * 24);
  return daysSince > interval;
}

/**
 * Returns true when a friend should be pulled into the Reconnect ring:
 * due for contact AND care level is 4 or 5.
 */
export function isInReconnectZone(
  friend: Friend,
  now: number = Date.now()
): boolean {
  return friend.careLevel >= 4 && isDue(friend, now);
}

// =============================================================================
// Graph Node Sizing
// =============================================================================

/**
 * Compute display radius for a force-graph node.
 *
 * Base radius scales with careLevel; post activity expands it logarithmically.
 * Capped at 48px so prolific posters don't dominate the canvas.
 */
export function nodeRadius(
  friend: Friend,
  feedItems: Record<string, FeedItem>
): number {
  const BASE: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 16,
    2: 20,
    3: 24,
    4: 28,
    5: 32,
  };
  const base = BASE[friend.careLevel];
  const activity = recentPostCount(feedItems, friend);
  const scaled = base * Math.log2(activity + 2);
  return Math.min(scaled, 48);
}

/**
 * Compute display opacity for a graph node based on post recency.
 *
 * - Posted within 24h  → 1.0 (full opacity)
 * - Posted within 7d   → 0.85
 * - Posted within 30d  → 0.70
 * - Older or no posts  → 0.50
 */
export function nodeOpacity(
  friend: Friend,
  feedItems: Record<string, FeedItem>,
  now: number = Date.now()
): number {
  const last = lastPostAt(feedItems, friend);
  if (last === null) return 0.5;

  const hours = (now - last) / (1000 * 60 * 60);
  if (hours < 24) return 1.0;
  if (hours < 24 * 7) return 0.85;
  if (hours < 24 * 30) return 0.7;
  return 0.5;
}
