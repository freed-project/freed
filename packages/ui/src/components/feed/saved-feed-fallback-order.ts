import {
  rankFeedItems,
  type Account,
  type FeedItem,
  type Person,
  type SavedContentSortMode,
  type WeightPreferences,
} from "@freed/shared";
import {
  compareLibraryCoreSavedFeedSortKeyV1,
  libraryCoreSavedFeedSortKeyV1,
} from "@freed/shared/library-core";

export interface BoundedReaderRankingClock {
  readonly identity: string;
  readonly rankingClockMs: number;
}

export function resolveBoundedReaderRankingClock(
  current: BoundedReaderRankingClock | null,
  identity: string,
  now: number,
): BoundedReaderRankingClock {
  return current?.identity === identity
    ? current
    : { identity, rankingClockMs: now };
}

export function savedFeedRankingClockMs(
  sortMode: SavedContentSortMode,
  identityRankingClockMs: number,
): number {
  return sortMode === "recommended" ? identityRankingClockMs : 0;
}

export function orderDesktopSavedFallbackItems(args: {
  readonly items: FeedItem[];
  readonly sortMode: SavedContentSortMode;
  readonly weights: WeightPreferences;
  readonly persons: Record<string, Person>;
  readonly accounts: Record<string, Account>;
  readonly rankingClockMs: number;
}): FeedItem[] {
  const rankedItems =
    args.sortMode === "recommended"
      ? rankFeedItems(
          args.items,
          args.weights,
          { persons: args.persons, accounts: args.accounts },
          args.rankingClockMs,
        )
      : args.items;
  return [...rankedItems].sort((left, right) =>
    compareLibraryCoreSavedFeedSortKeyV1(
      libraryCoreSavedFeedSortKeyV1(left, args.sortMode, left.priority ?? 0),
      libraryCoreSavedFeedSortKeyV1(right, args.sortMode, right.priority ?? 0),
    ),
  );
}
