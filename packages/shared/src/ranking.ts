/**
 * Feed ranking algorithm
 *
 * Computes priority scores for feed items based on user preferences.
 * Runs on Desktop/OpenClaw, results synced to edge devices.
 */

import type { Account, ContentSignal, FeedItem, Person, WeightPreferences } from "./types.js";
import type { SocialContentFilter } from "./store-types.js";

/**
 * Default weights for ranking factors
 */
const DEFAULT_WEIGHTS = {
  recency: 50,
  engagement: 10,
  author: 20,
  relationship: 18,
  topic: 15,
  platform: 5,
};

interface RelationshipPriorityContext {
  persons?: Record<string, Person>;
  accounts?: Record<string, Account>;
  personByAuthorKey?: Map<string, Person | null>;
}

function authorKey(item: Pick<FeedItem, "platform" | "author">): string {
  return `${item.platform}:${item.author.id}`;
}

function buildPersonByAuthorKey(context?: RelationshipPriorityContext): Map<string, Person | null> | null {
  if (!context?.persons || !context.accounts) return null;
  const map = new Map<string, Person | null>();
  for (const account of Object.values(context.accounts)) {
    if (account.kind !== "social") continue;
    map.set(`${account.provider}:${account.externalId}`, account.personId ? context.persons[account.personId] ?? null : null);
  }
  return map;
}

function relationshipPriorityBoost(
  item: FeedItem,
  context?: RelationshipPriorityContext,
): { score: number; weight: number } | null {
  if (!context?.persons || !context.accounts) return null;
  const personMap = context.personByAuthorKey ?? buildPersonByAuthorKey(context);
  const person = personMap?.get(authorKey(item)) ?? null;
  if (!person || person.relationshipStatus !== "friend") return null;
  if (person.careLevel >= 5) return { score: 100, weight: 28 };
  if (person.careLevel >= 4) return { score: 100, weight: 22 };
  if (person.careLevel >= 3) return { score: 100, weight: 14 };
  return { score: 80, weight: 8 };
}

/**
 * Calculate a priority score (0-100) for a feed item
 */
export function calculatePriority(
  item: FeedItem,
  preferences: WeightPreferences,
  now = Date.now(),
  context?: RelationshipPriorityContext,
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

  const relationshipBoost = relationshipPriorityBoost(item, context);
  if (relationshipBoost) {
    scores.push(relationshipBoost.score);
    weights.push(relationshipBoost.weight || DEFAULT_WEIGHTS.relationship);
  }

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
 * Compute priorities for all items and return updated items.
 *
 * Preserves object identity for items whose priority score has not changed.
 * This is critical for React.memo and useMemo to bail out correctly — if every
 * item gets a new object reference on every call (even for unrelated mutations
 * like markAsRead on a different item), every mounted card re-renders.
 */
export function rankFeedItems(
  items: FeedItem[],
  preferences: WeightPreferences,
  context?: RelationshipPriorityContext,
): FeedItem[] {
  const now = Date.now();
  const rankingContext = context
    ? { ...context, personByAuthorKey: context.personByAuthorKey ?? buildPersonByAuthorKey(context) ?? undefined }
    : undefined;

  return items.map((item) => {
    const newPriority = calculatePriority(item, preferences, now, rankingContext);
    if (item.priority === newPriority) return item;
    return { ...item, priority: newPriority, priorityComputedAt: now };
  });
}

/**
 * Filter items based on user state
 */
export function filterFeedItems(
  items: FeedItem[],
  options: {
    showHidden?: boolean;
    /** Show only archived items (the Archived view). Mutually exclusive with normal feed. */
    archivedOnly?: boolean;
    platform?: string;
    authorId?: string;
    feedUrl?: string;
    socialContentFilter?: SocialContentFilter;
    tags?: string[];
    signals?: ContentSignal[];
    savedOnly?: boolean;
  } = {},
): FeedItem[] {
  return items.filter((item) => matchesFeedFilter(item, options));
}

export function matchesFeedFilter(
  item: FeedItem,
  options: {
    showHidden?: boolean;
    /** Show only archived items (the Archived view). Mutually exclusive with normal feed. */
    archivedOnly?: boolean;
    platform?: string;
    authorId?: string;
    feedUrl?: string;
    socialContentFilter?: SocialContentFilter;
    tags?: string[];
    signals?: ContentSignal[];
    savedOnly?: boolean;
  } = {},
): boolean {
  // Filter hidden unless explicitly showing
  if (!options.showHidden && item.userState.hidden) return false;

  // Archived view shows only archived; normal feed excludes archived
  if (options.archivedOnly) {
    if (!item.userState.archived) return false;
  } else {
    if (item.userState.archived) return false;
  }

  // Filter by platform
  if (options.platform && item.platform !== options.platform) return false;
  if (options.authorId && item.author.id !== options.authorId) return false;
  if (options.feedUrl && item.rssSource?.feedUrl !== options.feedUrl) return false;

  if (options.socialContentFilter && options.socialContentFilter !== "all") {
    if (options.socialContentFilter === "stories" && item.contentType !== "story") return false;
    if (options.socialContentFilter === "posts" && item.contentType === "story") return false;
  }

  // Filter by saved status
  if (options.savedOnly && !item.userState.saved) return false;

  // Filter by tags (any match)
  if (options.tags?.length) {
    const hasTag = options.tags.some((t) => item.userState.tags.includes(t));
    if (!hasTag) return false;
  }

  if (options.signals?.length) {
    const itemSignals = item.contentSignals?.tags ?? [];
    const hasSignal = options.signals.some((signal) => itemSignals.includes(signal));
    if (!hasSignal) return false;
  }

  return true;
}
