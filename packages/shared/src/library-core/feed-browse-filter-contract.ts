import type { ContentSignal, FeedItem } from "../types.js";
import type {
  FilterOptions,
  SocialContentFilter,
} from "../store-types.js";

export const LIBRARY_CORE_FEED_BROWSE_FILTER_SCHEMA_VERSION = 1 as const;

/**
 * The smallest structural view needed to reproduce the current product feed
 * filters. `FeedItem` satisfies this interface directly, so the legacy
 * renderer can use the same predicate without allocating one adapter object
 * per corpus row.
 */
export type LibraryCoreFeedBrowseFilterSourceV1 = Pick<
  FeedItem,
  "author" | "contentSignals" | "contentType" | "platform" | "rssSource" | "userState"
>;

export interface LibraryCoreFeedBrowseFilterV1 {
  readonly archivedOnly: boolean;
  readonly authorId: string | null;
  readonly feedUrl: string | null;
  readonly platform: string | null;
  readonly savedOnly: boolean;
  readonly schemaVersion: typeof LIBRARY_CORE_FEED_BROWSE_FILTER_SCHEMA_VERSION;
  readonly showHidden: boolean;
  readonly signals: readonly ContentSignal[];
  readonly socialContentFilter: SocialContentFilter;
  readonly tags: readonly string[];
}

export type LibraryCoreFeedBrowseFilterInputV1 = FilterOptions & {
  readonly showHidden?: boolean;
};

function compareBinaryText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedSet<T extends string>(
  values: readonly T[] | undefined,
): readonly T[] {
  if (!values?.length) return Object.freeze([]);
  return Object.freeze([...new Set(values)].sort(compareBinaryText));
}

/**
 * Canonicalize the product filter for cursor binding and cross-runtime parity.
 *
 * Strings remain byte-for-byte exact because the current product does not
 * trim or case-fold them. Set-like arrays are deduplicated and binary-sorted
 * because their order and multiplicity do not affect the current any-match
 * predicate.
 */
export function normalizeLibraryCoreFeedBrowseFilterV1(
  input: LibraryCoreFeedBrowseFilterInputV1 = {},
): LibraryCoreFeedBrowseFilterV1 {
  return Object.freeze({
    archivedOnly: input.archivedOnly === true,
    authorId: input.authorId ?? null,
    feedUrl: input.feedUrl ?? null,
    platform: input.platform ?? null,
    savedOnly: input.savedOnly === true,
    schemaVersion: LIBRARY_CORE_FEED_BROWSE_FILTER_SCHEMA_VERSION,
    showHidden: input.showHidden === true,
    signals: normalizedSet(input.signals),
    socialContentFilter: input.socialContentFilter ?? "all",
    tags: normalizedSet(input.tags),
  });
}

/**
 * One exact predicate for the current renderer and future bounded adapters.
 *
 * A native or browser row query must prove that its pushed-down predicates
 * produce the same answer as this function before it may replace the current
 * in-memory filter.
 */
export function matchesLibraryCoreFeedBrowseFilterV1(
  item: LibraryCoreFeedBrowseFilterSourceV1,
  filter: LibraryCoreFeedBrowseFilterV1,
): boolean {
  if (!filter.showHidden && item.userState.hidden) return false;

  if (filter.archivedOnly) {
    if (!item.userState.archived) return false;
  } else if (item.userState.archived) {
    return false;
  }

  if (filter.platform) {
    const matchesPlatform = filter.platform === "rss"
      ? item.platform === "rss" || Boolean(item.rssSource)
      : item.platform === filter.platform;
    if (!matchesPlatform) return false;
  }
  if (filter.authorId && item.author.id !== filter.authorId) return false;
  if (filter.feedUrl && item.rssSource?.feedUrl !== filter.feedUrl) return false;

  if (filter.socialContentFilter === "stories") {
    if (item.contentType !== "story") return false;
  } else if (
    filter.socialContentFilter === "posts" &&
    item.contentType === "story"
  ) {
    return false;
  }

  if (filter.savedOnly && !item.userState.saved) return false;

  if (
    filter.tags.length > 0 &&
    !filter.tags.some((tag) => item.userState.tags.includes(tag))
  ) {
    return false;
  }

  const itemSignals = item.contentSignals?.tags ?? [];
  if (
    filter.signals.length > 0 &&
    !filter.signals.some((signal) => itemSignals.includes(signal))
  ) {
    return false;
  }

  return true;
}
