import type { FeedItem } from "../types.js";

export const LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION = 1 as const;

export const LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_V1 = Object.freeze({
  schemaVersion: LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  stablePasses: Object.freeze([
    Object.freeze({ direction: "desc", field: "publishedAt" }),
    Object.freeze({ direction: "desc", field: "priority" }),
  ]),
  finalTieBreak: "source_enumeration_sequence_asc",
});

export type LibraryCoreFeedRecommendationOrderSourceV1 = Pick<
  FeedItem,
  "priority" | "publishedAt"
>;

/**
 * The second stable pass in the current recommendation pipeline.
 */
export function compareLibraryCoreFeedPriorityV1(
  left: LibraryCoreFeedRecommendationOrderSourceV1,
  right: LibraryCoreFeedRecommendationOrderSourceV1,
): number {
  return (right.priority ?? 0) - (left.priority ?? 0);
}

/**
 * The first stable pass in the current recommendation pipeline.
 */
export function compareLibraryCoreFeedPublishedAtV1(
  left: LibraryCoreFeedRecommendationOrderSourceV1,
  right: LibraryCoreFeedRecommendationOrderSourceV1,
): number {
  return right.publishedAt - left.publishedAt;
}

/**
 * Reproduce the product's exact recommendation order.
 *
 * The input order is the committed source-map enumeration sequence. The first
 * stable pass orders newest first. The second stable pass groups by priority
 * without disturbing the first pass, so the complete total order is priority
 * descending, publishedAt descending, then source sequence ascending.
 *
 * The function intentionally mutates `items` during its first pass. Both
 * current workers already sort a newly filtered array in place, so preserving
 * that ownership avoids another corpus-sized allocation.
 */
export function sortLibraryCoreFeedRecommendationV1<
  T extends LibraryCoreFeedRecommendationOrderSourceV1,
>(items: T[]): T[] {
  items.sort(compareLibraryCoreFeedPublishedAtV1);
  return [...items].sort(compareLibraryCoreFeedPriorityV1);
}
