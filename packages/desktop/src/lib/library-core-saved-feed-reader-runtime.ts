/** Saved feed pagination over the active native SQLite Library. */

import type {
  FeedItem,
  FilterOptions,
  SavedContentSortMode,
} from "@freed/shared";
import { openSortedSqliteFeedReader } from "./library-core-feed-browse-reader-runtime";

export async function openBoundedDesktopSavedFeedReader(
  filter: FilterOptions,
  sortMode: SavedContentSortMode,
  _rankingClockMs: number,
): Promise<{
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  close(): Promise<void>;
}> {
  const reader = await openSortedSqliteFeedReader(
    { ...filter, savedOnly: true },
    sortMode,
  );
  return {
    totalCount: reader.totalCount,
    readNext: reader.readNext,
    close: reader.close,
  };
}
