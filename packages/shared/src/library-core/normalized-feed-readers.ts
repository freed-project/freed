import { FEED_SIGNAL_FILTER_PRESETS } from "../feed-signal-filters.js";
import type {
  FeedItem,
  FeedSignalMode,
  SavedContentSortMode,
} from "../types.js";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  type LibraryCoreFeedBrowseDirectionV3,
  type LibraryCoreFeedBrowseIdentityModeV2,
} from "./feed-browse-page-contracts.js";
import {
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseFilterInputV1,
  type LibraryCoreFeedBrowseFilterV1,
} from "./feed-browse-filter-contract.js";
import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  libraryCoreFeedCardToItemV1,
} from "./feed-page-contracts.js";
import { LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION } from "./feed-recommendation-order-contract.js";
import { createLibraryCoreOperationInstanceId } from "./protocol-scalars.js";
import {
  LIBRARY_CORE_SAVED_FEED_PAGE_V2_QUERY_ID,
  LIBRARY_CORE_SAVED_FEED_PAGE_V2_SCHEMA_VERSION,
  type LibraryCoreSavedFeedCardV1,
} from "./saved-feed-page-contracts.js";
import type {
  LibraryCoreSqliteQueryRequest,
  LibraryCoreSqliteQueryResponseFor,
} from "./sqlite-worker-protocol.js";

export type LibraryCoreNormalizedQueryExecutor = <
  T extends LibraryCoreSqliteQueryRequest,
>(
  request: T,
) => Promise<LibraryCoreSqliteQueryResponseFor<T>>;

export interface LibraryCoreNormalizedFeedPage {
  readonly items: readonly FeedItem[];
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
}

export interface LibraryCoreNormalizedFeedReader {
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  readPage(
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<LibraryCoreNormalizedFeedPage>;
  close(): Promise<void>;
}

export interface LibraryCoreNormalizedReaderRuntime {
  readonly query: LibraryCoreNormalizedQueryExecutor;
  readonly randomId: () => string;
}

function operationId(
  runtime: LibraryCoreNormalizedReaderRuntime,
  prefix: string,
) {
  return createLibraryCoreOperationInstanceId(prefix, runtime.randomId());
}

export async function openLibraryCoreNormalizedFeedReaderV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
  identityMode: LibraryCoreFeedBrowseIdentityModeV2 = "all_content",
): Promise<LibraryCoreNormalizedFeedReader> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new TypeError(parsed.error);
  const filter = parsed.value;
  const readerSessionId = operationId(runtime, "feed-reader");
  let nextCursor: string | null = null;
  let started = false;
  let closed = false;

  const queryPage = async (
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<
    LibraryCoreNormalizedFeedPage & { readonly totalCount: number }
  > => {
    const page = await runtime.query({
      cancellationId: operationId(runtime, "feed-page"),
      cursor,
      direction,
      filter,
      friendsPredicateSchemaVersion:
        LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
      identityMode,
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
          : await queryPage(cursor, direction);
      return {
        items: page.items,
        nextCursor: page.nextCursor,
        previousCursor: page.previousCursor,
      };
    },
    async close() {
      closed = true;
    },
  };
}

export async function openLibraryCoreNormalizedSavedFeedReaderV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
  sortMode: SavedContentSortMode,
): Promise<LibraryCoreNormalizedFeedReader> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1({
      ...filterInput,
      savedOnly: true,
    }),
  );
  if (!parsed.ok) throw new TypeError(parsed.error);
  const filter = parsed.value;
  const readerSessionId = operationId(runtime, "saved-reader");
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
  ): Promise<
    LibraryCoreNormalizedFeedPage & { readonly totalCount: number }
  > => {
    const page = await runtime.query({
      cancellationId: operationId(runtime, "saved-page"),
      cursor,
      direction,
      filter,
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
          : await queryPage(cursor, direction);
      return {
        items: page.items,
        nextCursor: page.nextCursor,
        previousCursor: page.previousCursor,
      };
    },
    async close() {
      closed = true;
    },
  };
}

export async function readLibraryCoreNormalizedFeedSignalCountsV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<Readonly<Record<FeedSignalMode, number>>> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new TypeError(parsed.error);
  const filter = parsed.value;
  const entries = await Promise.all(
    FEED_SIGNAL_FILTER_PRESETS.map(async (preset) => {
      const signalFilter: LibraryCoreFeedBrowseFilterV1 = {
        ...filter,
        signals: preset.mode === "all" ? [] : preset.signals,
      };
      const page = await runtime.query({
        cancellationId: operationId(runtime, "signal-count"),
        cursor: null,
        direction: "next",
        filter: signalFilter,
        friendsPredicateSchemaVersion:
          LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
        identityMode: "all_content",
        limit: 1,
        queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
        rankingClockMs,
        readerSessionId: operationId(runtime, "signal-reader"),
        recommendationOrderSchemaVersion:
          LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
        schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
      });
      return [preset.mode, page.totalCount] as const;
    }),
  );
  return Object.fromEntries(entries) as Readonly<
    Record<FeedSignalMode, number>
  >;
}
