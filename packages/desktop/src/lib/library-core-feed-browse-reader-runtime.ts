/** Bounded SQLite readers for the Freed Desktop Library. */

import {
  type FeedItem,
  type FeedSignalMode,
  type SavedContentSortMode,
} from "@freed/shared";
import {
  openLibraryCoreNormalizedFeedReaderV1,
  openLibraryCoreNormalizedSavedFeedReaderV1,
  readLibraryCoreNormalizedFeedSignalCountsV1,
  type LibraryCoreFeedBrowseDirectionV3,
  type LibraryCoreFeedBrowseFilterInputV1,
} from "@freed/shared/library-core";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";

export interface BoundedDesktopFeedPage {
  readonly items: readonly FeedItem[];
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
}

export interface BoundedDesktopFeedReader {
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  readPage(
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<BoundedDesktopFeedPage>;
  close(): Promise<void>;
}

const NORMALIZED_READER_RUNTIME = Object.freeze({
  query: queryNormalizedLibrary,
  randomId: () => crypto.randomUUID(),
});

export async function openBoundedDesktopFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<BoundedDesktopFeedReader> {
  return openLibraryCoreNormalizedFeedReaderV1(
    NORMALIZED_READER_RUNTIME,
    filter,
    rankingClockMs,
  );
}

export async function openSortedSqliteFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  sortMode: SavedContentSortMode,
): Promise<BoundedDesktopFeedReader> {
  return openLibraryCoreNormalizedSavedFeedReaderV1(
    NORMALIZED_READER_RUNTIME,
    filter,
    sortMode,
  );
}

export async function openBoundedDesktopFriendsFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<BoundedDesktopFeedReader> {
  return openLibraryCoreNormalizedFeedReaderV1(
    NORMALIZED_READER_RUNTIME,
    filter,
    rankingClockMs,
    "friends",
  );
}

export async function readDesktopFeedSignalCounts(
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
): Promise<Readonly<Record<FeedSignalMode, number>>> {
  return readLibraryCoreNormalizedFeedSignalCountsV1(
    NORMALIZED_READER_RUNTIME,
    filterInput,
    Date.now(),
  );
}
