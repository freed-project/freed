/** Bounded SQLite readers for the Freed Desktop Library. */

import {
  compileFriendAuthorIndex,
  type FeedItem,
  type FeedSignalMode,
  type SavedContentSortMode,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  normalizeLibraryCoreFeedBrowseFilterV1,
  openLibraryCoreNormalizedFeedReaderV1,
  openLibraryCoreNormalizedSavedFeedReaderV1,
  parseLibraryCoreFeedBrowseFilterV1,
  readLibraryCoreNormalizedFeedSignalCountsV1,
  type LibraryCoreFeedBrowseDirectionV3,
  type LibraryCoreFeedBrowseFilterInputV1,
} from "@freed/shared/library-core";
import { getDocState } from "./library-client";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { querySqliteItems } from "./sqlite-library";

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
  _rankingClockMs: number,
): Promise<
  Pick<BoundedDesktopFeedReader, "totalCount" | "readNext" | "close">
> {
  const state = getDocState();
  const friends = compileFriendAuthorIndex(
    state?.persons ?? {},
    state?.accounts ?? {},
    state?.friends ?? {},
  );
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filter),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const currentFilter = parsed.value;
  const queryFriendsPage = (pageOffset: number, includeTotalCount: boolean) =>
    querySqliteItems({
      platform: currentFilter.platform ?? undefined,
      authorId: currentFilter.authorId ?? undefined,
      feedUrl: currentFilter.feedUrl ?? undefined,
      contentType:
        currentFilter.socialContentFilter === "stories" ? "story" : undefined,
      excludeContentType:
        currentFilter.socialContentFilter === "posts" ? "story" : undefined,
      tags: currentFilter.tags,
      signals: currentFilter.signals,
      authorKeys: friends.entries(),
      saved: currentFilter.savedOnly ? true : undefined,
      archived: currentFilter.archivedOnly ? true : false,
      showHidden: currentFilter.showHidden,
      offset: pageOffset,
      limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
      includeTotalCount,
    });
  let started = false;
  let closed = false;
  const first = await queryFriendsPage(0, true);
  let nextOffset = first.nextOffset;
  return {
    totalCount: first.totalCount,
    async readNext() {
      if (closed) throw new Error("SQLite Library reader is closed");
      if (!started) {
        started = true;
        return first.items;
      }
      if (nextOffset === null) return [];
      const page = await queryFriendsPage(nextOffset, false);
      nextOffset = page.nextOffset;
      return page.items;
    },
    async close() {
      closed = true;
    },
  };
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
