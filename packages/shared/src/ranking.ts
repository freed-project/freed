/**
 * Feed ranking algorithm
 *
 * Computes priority scores for feed items based on user preferences.
 * Runs on Desktop/OpenClaw, results synced to edge devices.
 */

import type { FeedItem, WeightPreferences } from "./types.js";

/**
 * Default weights for ranking factors
 */
const DEFAULT_WEIGHTS = {
  recency: 50,
  engagement: 10,
  author: 20,
  topic: 15,
  platform: 5,
};

/**
 * Calculate a priority score (0-100) for a feed item
 */
export function calculatePriority(
  item: FeedItem,
  preferences: WeightPreferences,
  now = Date.now(),
): number {
  const scores: number[] = [];
  const weights: number[] = [];

  // 1. Recency score (0-100)
  // Items from last hour get 100, decays over 7 days
  const ageHours = (now - item.publishedAt) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 100 - (ageHours / 168) * 100); // 168 hours = 7 days
  scores.push(recencyScore);
  weights.push(preferences.recency || DEFAULT_WEIGHTS.recency);

  // 2. Author boost (0-100)
  const authorWeight = preferences.authors[item.author.id] ?? 50;
  scores.push(authorWeight);
  weights.push(DEFAULT_WEIGHTS.author);

  // 3. Platform boost (0-100)
  const platformWeight = preferences.platforms[item.platform] ?? 50;
  scores.push(platformWeight);
  weights.push(DEFAULT_WEIGHTS.platform);

  // 4. Topic relevance (0-100)
  if (item.topics.length > 0) {
    const topicScores = item.topics.map((t) => preferences.topics[t] ?? 50);
    const avgTopicScore =
      topicScores.reduce((a, b) => a + b, 0) / topicScores.length;
    scores.push(avgTopicScore);
    weights.push(DEFAULT_WEIGHTS.topic);
  }

  // 5. Engagement signal (optional, hidden by default)
  if (item.engagement) {
    const engagementScore = normalizeEngagement(item.engagement);
    scores.push(engagementScore);
    weights.push(DEFAULT_WEIGHTS.engagement);
  }

  // 6. Saved items get a boost
  if (item.userState.saved) {
    scores.push(100);
    weights.push(10);
  }

  // Calculate weighted average
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedSum = scores.reduce(
    (sum, score, i) => sum + score * weights[i],
    0,
  );

  return Math.round(weightedSum / totalWeight);
}

/**
 * Normalize engagement metrics to 0-100 scale
 * Uses log scale to prevent viral content from dominating
 */
function normalizeEngagement(engagement: {
  likes?: number;
  reposts?: number;
  comments?: number;
  views?: number;
}): number {
  const { likes = 0, reposts = 0, comments = 0, views = 0 } = engagement;

  // Weighted combination (comments valued higher for quality signal)
  const raw = likes * 1 + reposts * 2 + comments * 3 + views * 0.01;

  // Log scale: 0 -> 0, 10 -> 33, 100 -> 66, 1000+ -> 100
  if (raw <= 0) return 0;
  const logScore = Math.log10(raw + 1) * 33;
  return Math.min(100, Math.round(logScore));
}

/**
 * Sort feed items by priority (highest first)
 */
export function sortByPriority(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Compute priorities for all items and return updated items
 */
export function rankFeedItems(
  items: FeedItem[],
  preferences: WeightPreferences,
): FeedItem[] {
  const now = Date.now();

  return items.map((item) => ({
    ...item,
    priority: calculatePriority(item, preferences, now),
    priorityComputedAt: now,
  }));
}

/**
 * Filter items based on user state
 */
export function filterFeedItems(
  items: FeedItem[],
  options: {
    showHidden?: boolean;
    showArchived?: boolean;
    platform?: string;
    tags?: string[];
    savedOnly?: boolean;
  } = {},
): FeedItem[] {
  return items.filter((item) => {
    // Filter hidden unless explicitly showing
    if (!options.showHidden && item.userState.hidden) return false;

    // Filter archived unless explicitly showing
    if (!options.showArchived && item.userState.archived) return false;

    // Filter by platform
    if (options.platform && item.platform !== options.platform) return false;

    // Filter by saved status
    if (options.savedOnly && !item.userState.saved) return false;

    // Filter by tags (any match)
    if (options.tags?.length) {
      const hasTag = options.tags.some((t) => item.userState.tags.includes(t));
      if (!hasTag) return false;
    }

    return true;
  });
}
