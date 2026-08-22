import { FEED_SIGNAL_FILTER_PRESETS } from "../feed-signal-filters.js";
import type {
  FeedItem,
  FeedSignalMode,
  RssFeed,
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
import {
  LIBRARY_CORE_ITEM_SCAN_MAXIMUM_LIMIT,
  LIBRARY_CORE_ITEM_SCAN_QUERY_ID,
  LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION,
  type LibraryCoreItemScanResponseV1,
} from "./item-scan-contracts.js";
import {
  LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID,
  LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION,
  type LibraryCoreContentFetchCandidateV1,
  type LibraryCoreContentFetchPageResponseV1,
} from "./content-fetch-page-contracts.js";
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
import {
  LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_RSS_FEED_PAGE_QUERY_ID,
  LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_SCHEMA_VERSION,
  libraryCoreRssFeedPageRowToRssFeedV1,
  type LibraryCoreRssFeedPageResponseV1,
} from "./friends-identity-page-contracts.js";
import {
  LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
  LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
  libraryCoreRssFeedDetailToRssFeedV1,
} from "./rss-feed-detail-contracts.js";

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

export type LibraryCoreBackgroundScanDecision = "continue" | "stop";

/** Read one exact synchronized RSS Feed without consulting renderer state. */
export async function readLibraryCoreRssFeedV1(
  query: LibraryCoreNormalizedQueryExecutor,
  url: string,
): Promise<RssFeed | null> {
  const response = await query({
    queryId: LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
    url,
  });
  return response.feed === null
    ? null
    : libraryCoreRssFeedDetailToRssFeedV1(response.feed);
}

/**
 * Visit every RSS Feed through bounded source-fenced SQLite pages.
 *
 * The visitor owns one page only. React views must use a visible-window hook
 * instead of this maintenance and export primitive.
 */
export async function scanLibraryCoreRssFeedsV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  visit: (
    feeds: readonly RssFeed[],
  ) => LibraryCoreBackgroundScanDecision | Promise<LibraryCoreBackgroundScanDecision>,
): Promise<void> {
  let cursor: string | null = null;
  const readerSessionId = createLibraryCoreOperationInstanceId(
    "rss-feed-scan-reader",
    runtime.randomId(),
  );
  for (;;) {
    const response: LibraryCoreRssFeedPageResponseV1 = await runtime.query({
      cancellationId: createLibraryCoreOperationInstanceId(
        "rss-feed-scan-cancel",
        runtime.randomId(),
      ),
      cursor,
      limit: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
      queryId: LIBRARY_CORE_RSS_FEED_PAGE_QUERY_ID,
      readerSessionId,
      schemaVersion: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_SCHEMA_VERSION,
    });
    const decision = await visit(
      response.rows.map(libraryCoreRssFeedPageRowToRssFeedV1),
    );
    if (decision === "stop" || response.nextCursor === null) return;
    cursor = response.nextCursor;
  }
}

/**
 * Visit compact background metadata through one source-fenced SQLite query.
 *
 * The executor owns storage and validates every response against the exact
 * request. Callers receive one bounded page at a time and never see a storage
 * cursor, database handle, or whole-library materialization.
 */
export async function scanLibraryCoreNormalizedBackgroundItemsV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  visit: (
    items: readonly FeedItem[],
  ) =>
    | LibraryCoreBackgroundScanDecision
    | Promise<LibraryCoreBackgroundScanDecision>,
): Promise<void> {
  const readerSessionId = operationId(runtime, "background-reader");
  let cursor: string | null = null;
  do {
    const page: LibraryCoreItemScanResponseV1 = await runtime.query({
      cancellationId: operationId(runtime, "background-page"),
      cursor,
      limit: LIBRARY_CORE_ITEM_SCAN_MAXIMUM_LIMIT,
      queryId: LIBRARY_CORE_ITEM_SCAN_QUERY_ID,
      readerSessionId,
      schemaVersion: LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION,
    });
    const items = Object.freeze(
      page.rows.map((row) => {
        const item = libraryCoreFeedCardToItemV1(row);
        return Object.freeze({
          ...item,
          ...(row.rssSource === null ? {} : { rssSource: row.rssSource }),
          ...(row.sampleDataFingerprint === null
            ? {}
            : { sampleDataFingerprint: row.sampleDataFingerprint }),
          userState: Object.freeze({
            ...item.userState,
            hidden: row.hidden,
          }),
        });
      }),
    );
    if (items.length > 0 && (await visit(items)) === "stop") return;
    cursor = page.nextCursor;
  } while (cursor !== null);
}

/** Visit content fetch candidates without materializing FeedItem records. */
export async function scanLibraryCoreContentFetchCandidatesV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  visit: (
    rows: readonly LibraryCoreContentFetchCandidateV1[],
  ) => void | Promise<void>,
): Promise<void> {
  const readerSessionId = operationId(runtime, "content-fetch-reader");
  let cursor: string | null = null;
  do {
    const page: LibraryCoreContentFetchPageResponseV1 = await runtime.query({
      cancellationId: operationId(runtime, "content-fetch-page"),
      cursor,
      limit: LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_LIMIT,
      queryId: LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID,
      readerSessionId,
      schemaVersion: LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION,
    });
    if (page.rows.length > 0) await visit(page.rows);
    cursor = page.nextCursor;
  } while (cursor !== null);
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
