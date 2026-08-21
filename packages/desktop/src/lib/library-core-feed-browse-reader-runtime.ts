/** Bounded SQLite readers for the Freed Desktop Library. */

import {
  compileFriendAuthorIndex,
  FEED_SIGNAL_FILTER_PRESETS,
  type FeedItem,
  type FeedSignalMode,
  type SavedContentSortMode,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  LIBRARY_CORE_SAVED_FEED_PAGE_V2_QUERY_ID,
  LIBRARY_CORE_SAVED_FEED_PAGE_V2_SCHEMA_VERSION,
  libraryCoreFeedCardToItemV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseDirectionV3,
  type LibraryCoreFeedBrowseFilterInputV1,
  type LibraryCoreFeedBrowseFilterV1,
  type LibraryCoreSavedFeedCardV1,
} from "@freed/shared/library-core";
import { getDocState } from "./library-client";
import {
  createDesktopLibraryCoreOperationId,
  queryNormalizedLibrary,
} from "./library-core-normalized-query-client";
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

async function openNormalizedFeedReader(
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<BoundedDesktopFeedReader> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const filter = parsed.value;
  const readerSessionId = createDesktopLibraryCoreOperationId("desktop-feed-reader");
  let nextCursor: string | null = null;
  let started = false;
  let closed = false;

  const queryPage = async (
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<BoundedDesktopFeedPage & { readonly totalCount: number }> => {
    const page = await queryNormalizedLibrary({
      cancellationId: createDesktopLibraryCoreOperationId("desktop-feed-page"),
      cursor,
      direction,
      filter,
      limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
      rankingClockMs,
      readerSessionId,
      recommendationOrderSchemaVersion:
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
    });
    return {
      items: page.rows.map(libraryCoreFeedCardToItemV1),
      nextCursor: page.nextCursor,
      previousCursor: page.previousCursor,
      totalCount: page.totalCount,
    };
  };

  const initial = await queryPage(null, "next");
  return {
    totalCount: initial.totalCount,
    async readNext() {
      if (closed) throw new Error("SQLite Library reader is closed");
      if (!started) {
        started = true;
        nextCursor = initial.nextCursor;
        return initial.items;
      }
      if (nextCursor === null) return [];
      const page = await queryPage(nextCursor, "next");
      nextCursor = page.nextCursor;
      return page.items;
    },
    async readPage(cursor, direction) {
      if (closed) throw new Error("SQLite Library reader is closed");
      const page =
        cursor === null && direction === "next"
          ? initial
          : queryPage(cursor, direction);
      const resolved = await page;
      return {
        items: resolved.items,
        nextCursor: resolved.nextCursor,
        previousCursor: resolved.previousCursor,
      };
    },
    async close() {
      closed = true;
    },
  };
}

export async function openBoundedDesktopFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<BoundedDesktopFeedReader> {
  return openNormalizedFeedReader(filter, rankingClockMs);
}

export async function openSortedSqliteFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  sortMode: SavedContentSortMode,
): Promise<BoundedDesktopFeedReader> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1({ ...filter, savedOnly: true }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const savedFilter = parsed.value;
  const readerSessionId = createDesktopLibraryCoreOperationId("desktop-saved-reader");
  let nextCursor: string | null = null;
  let started = false;
  let closed = false;
  const toItem = (card: LibraryCoreSavedFeedCardV1): FeedItem => {
    const item = libraryCoreFeedCardToItemV1(card);
    return card.savedAt === null
      ? item
      : { ...item, userState: { ...item.userState, savedAt: card.savedAt } };
  };
  const queryPage = async (
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<BoundedDesktopFeedPage & { readonly totalCount: number }> => {
    const page = await queryNormalizedLibrary({
      cancellationId: createDesktopLibraryCoreOperationId("desktop-saved-page"),
      cursor,
      direction,
      filter: savedFilter,
      limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
      queryId: LIBRARY_CORE_SAVED_FEED_PAGE_V2_QUERY_ID,
      readerSessionId,
      schemaVersion: LIBRARY_CORE_SAVED_FEED_PAGE_V2_SCHEMA_VERSION,
      sortMode,
    });
    return {
      items: page.rows.map(toItem),
      nextCursor: page.nextCursor,
      previousCursor: page.previousCursor,
      totalCount: page.totalCount,
    };
  };
  const initial = await queryPage(null, "next");
  return {
    totalCount: initial.totalCount,
    async readNext() {
      if (closed) throw new Error("SQLite Library reader is closed");
      if (!started) {
        started = true;
        nextCursor = initial.nextCursor;
        return initial.items;
      }
      if (nextCursor === null) return [];
      const page = await queryPage(nextCursor, "next");
      nextCursor = page.nextCursor;
      return page.items;
    },
    async readPage(cursor, direction) {
      if (closed) throw new Error("SQLite Library reader is closed");
      const page =
        cursor === null && direction === "next"
          ? initial
          : queryPage(cursor, direction);
      const resolved = await page;
      return {
        items: resolved.items,
        nextCursor: resolved.nextCursor,
        previousCursor: resolved.previousCursor,
      };
    },
    async close() {
      closed = true;
    },
  };
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
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const filter = parsed.value;
  const rankingClockMs = Date.now();
  const entries = await Promise.all(FEED_SIGNAL_FILTER_PRESETS.map(async (preset) => {
    const signalFilter: LibraryCoreFeedBrowseFilterV1 = {
      ...filter,
      signals: preset.mode === "all" ? [] : preset.signals,
    };
    const page = await queryNormalizedLibrary({
      cancellationId: createDesktopLibraryCoreOperationId("desktop-signal-count"),
      cursor: null,
      direction: "next",
      filter: signalFilter,
      limit: 1,
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
      rankingClockMs,
      readerSessionId: createDesktopLibraryCoreOperationId("desktop-signal-reader"),
      recommendationOrderSchemaVersion:
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
    });
    return [preset.mode, page.totalCount] as const;
  }));
  return Object.fromEntries(entries) as Readonly<Record<FeedSignalMode, number>>;
}
