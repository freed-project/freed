/**
 * Feed ranking algorithm
 *
 * Computes priority scores for feed items based on user preferences.
 * Runs on Desktop/OpenClaw, results synced to edge devices.
 */

import type { Account, ContentSignal, FeedItem, Person, SavedContentSortMode, WeightPreferences } from "./types.js";
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
/** Hours after which the recency term reaches zero and stops changing. */
export const RECENCY_HORIZON_HOURS = 168;

/**
 * The recency term, which is the ONLY part of priority that varies with time.
 *
 * It decays linearly to zero at RECENCY_HORIZON_HOURS and stays there. On the
 * owner's corpus roughly 98.5% of items are already past that horizon, so for
 * almost every row this contributes a constant zero and the whole priority is
 * time-invariant. That is what makes an indexed feed ordering possible.
 */
export function recencyScoreFor(
  publishedAt: number,
  now: number,
): number {
  const ageHours = (now - publishedAt) / (1000 * 60 * 60);
  return Math.max(0, 100 - (ageHours / RECENCY_HORIZON_HOURS) * 100);
}

/** True once an item's priority can no longer change with the passage of time. */
export function isPriorityTimeInvariant(
  publishedAt: number,
  now: number,
): boolean {
  return recencyScoreFor(publishedAt, now) === 0;
}

export interface StaticPriorityComponents {
  /** Weighted sum of every term EXCEPT recency. */
  num: number;
  /** Sum of those terms' weights. */
  den: number;
  /** The recency weight, kept alongside so a reader can reconstitute the average. */
  recencyWeight: number;
}

/**
 * The time-invariant part of priority.
 *
 * Recomputing this only when its inputs change (preferences, saved state,
 * topics, engagement, relationship graph) rather than on every read is what
 * lets feed ordering become an index scan instead of a full-corpus rank and
 * sort. Combine with `effectivePriority` to get the same number
 * `calculatePriority` returns.
 */
export function calculateStaticPriority(
  item: FeedItem,
  preferences: WeightPreferences,
  context?: RelationshipPriorityContext,
): StaticPriorityComponents {
  const scores: number[] = [];
  const weights: number[] = [];
  collectStaticPriorityTerms(item, preferences, scores, weights, context);
  return {
    num: scores.reduce((sum, score, i) => sum + score * weights[i], 0),
    den: weights.reduce((a, b) => a + b, 0),
    recencyWeight: preferences.recency || DEFAULT_WEIGHTS.recency,
  };
}

/** Reconstitute the full priority from stored static components plus the clock. */
export function effectivePriority(
  statics: StaticPriorityComponents,
  publishedAt: number,
  now = Date.now(),
): number {
  const recencyScore = recencyScoreFor(publishedAt, now);
  const totalWeight = statics.den + statics.recencyWeight;
  const weightedSum = statics.num + recencyScore * statics.recencyWeight;
  return Math.round(weightedSum / totalWeight);
}

function collectStaticPriorityTerms(
  item: FeedItem,
  preferences: WeightPreferences,
  scores: number[],
  weights: number[],
  context?: RelationshipPriorityContext,
): void {
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
}

/**
 * Full priority for an item at a point in time.
 *
 * Kept as the single source of truth for the formula. It is now expressed in
 * terms of the decomposed parts so the stored static components and this
 * function can never drift apart, which is the failure mode that would make an
 * index silently disagree with the UI.
 */
export function calculatePriority(
  item: FeedItem,
  preferences: WeightPreferences,
  now = Date.now(),
  context?: RelationshipPriorityContext,
): number {
  return effectivePriority(
    calculateStaticPriority(item, preferences, context),
    item.publishedAt,
    now,
  );
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

function compareNewestTimestamp(
  left: FeedItem,
  right: FeedItem,
  timestamp: (item: FeedItem) => number,
): number {
  const delta = timestamp(right) - timestamp(left);
  return delta || left.globalId.localeCompare(right.globalId);
}

/**
 * Sort saved items for the Saved view.
 */
export function sortSavedFeedItems(
  items: FeedItem[],
  mode: SavedContentSortMode = "date_saved",
): FeedItem[] {
  if (mode === "recommended") {
    return sortByPriority(items);
  }

  return [...items].sort((left, right) => {
    if (mode === "date_published") {
      return compareNewestTimestamp(left, right, (item) => item.publishedAt || item.capturedAt);
    }

    if (mode === "shortest_read") {
      const delta = (left.preservedContent?.readingTime ?? Number.POSITIVE_INFINITY) -
        (right.preservedContent?.readingTime ?? Number.POSITIVE_INFINITY);
      return delta || compareNewestTimestamp(left, right, (item) => item.userState.savedAt ?? item.capturedAt);
    }

    return compareNewestTimestamp(left, right, (item) => item.userState.savedAt ?? item.capturedAt);
  });
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

  // Provider-classified RSS items remain visible in Feeds after identity
  // reconciliation promotes their platform to a first-class source.
  if (options.platform) {
    const matchesPlatform = options.platform === "rss"
      ? item.platform === "rss" || Boolean(item.rssSource)
      : item.platform === options.platform;
    if (!matchesPlatform) return false;
  }
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
