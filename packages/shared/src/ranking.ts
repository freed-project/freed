/**
 * Feed ranking algorithm
 *
 * Computes priority scores for feed items based on user preferences.
 * Runs on Desktop/OpenClaw, results synced to edge devices.
 */

import type { Account, FeedItem, Person, WeightPreferences } from "./types.js";

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

export interface PriorityCalculationContext {
  persons?: Record<string, Person>;
  accounts?: Record<string, Account>;
  personByAuthorKey?: Map<string, Person | null>;
  careLevel?: number | null;
}

function authorKey(item: Pick<FeedItem, "platform" | "author">): string {
  return `${item.platform}:${item.author.id}`;
}

function buildPersonByAuthorKey(
  context?: PriorityCalculationContext,
): Map<string, Person | null> | null {
  if (!context?.persons || !context.accounts) return null;
  const map = new Map<string, Person | null>();
  for (const account of Object.values(context.accounts)) {
    if (account.kind !== "social") continue;
    map.set(
      `${account.provider}:${account.externalId}`,
      account.personId ? (context.persons[account.personId] ?? null) : null,
    );
  }
  return map;
}

function relationshipPriorityBoost(
  item: FeedItem,
  context?: PriorityCalculationContext,
): { score: number; weight: number } | null {
  if (context?.careLevel !== undefined) {
    const careLevel = context.careLevel;
    if (careLevel === null) return null;
    if (careLevel >= 5) return { score: 100, weight: 28 };
    if (careLevel >= 4) return { score: 100, weight: 22 };
    if (careLevel >= 3) return { score: 100, weight: 14 };
    return { score: 80, weight: 8 };
  }
  if (!context?.persons || !context.accounts) return null;
  const personMap =
    context.personByAuthorKey ?? buildPersonByAuthorKey(context);
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
const RECENCY_HORIZON_HOURS = 168;

/**
 * The recency term, which is the ONLY part of priority that varies with time.
 *
 * It decays linearly to zero at RECENCY_HORIZON_HOURS and stays there. On the
 * owner's corpus roughly 98.5% of items are already past that horizon, so for
 * almost every row this contributes a constant zero and the whole priority is
 * time-invariant. That is what makes an indexed feed ordering possible.
 */
function recencyScoreFor(publishedAt: number, now: number): number {
  const ageHours = (now - publishedAt) / (1000 * 60 * 60);
  return Math.max(0, 100 - (ageHours / RECENCY_HORIZON_HOURS) * 100);
}

function collectStaticPriorityTerms(
  item: FeedItem,
  preferences: WeightPreferences,
  scores: number[],
  weights: number[],
  context?: PriorityCalculationContext,
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
 * This is the single source of truth for the Primary ranking transform.
 */
export function calculatePriority(
  item: FeedItem,
  preferences: WeightPreferences,
  now = Date.now(),
  context?: PriorityCalculationContext,
): number {
  const scores = [recencyScoreFor(item.publishedAt, now)];
  const weights = [preferences.recency || DEFAULT_WEIGHTS.recency];
  collectStaticPriorityTerms(item, preferences, scores, weights, context);
  const weightedSum = scores.reduce(
    (sum, score, index) => sum + score * weights[index]!,
    0,
  );
  return Math.round(
    weightedSum / weights.reduce((sum, weight) => sum + weight, 0),
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
