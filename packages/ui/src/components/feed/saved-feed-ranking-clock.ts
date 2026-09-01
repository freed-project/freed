import type { SavedContentSortMode } from "@freed/shared";

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
