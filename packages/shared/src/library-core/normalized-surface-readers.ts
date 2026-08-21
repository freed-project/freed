import type { FeedItem } from "../types.js";
import {
  LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  type LibraryCoreFacetSummaryV1,
} from "./facet-summary-contracts.js";
import { libraryCoreFeedCardToItemV1 } from "./feed-page-contracts.js";
import {
  LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
  LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
} from "./item-detail-contracts.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import { createLibraryCoreOperationInstanceId } from "./protocol-scalars.js";
import {
  LIBRARY_CORE_PERSON_TIMELINE_DEFAULT_LIMIT,
  LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_LIMIT,
  LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID,
  LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION,
} from "./person-timeline-contracts.js";
import {
  LIBRARY_CORE_ACCOUNT_TIMELINE_DEFAULT_LIMIT,
  LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_LIMIT,
  LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID,
  LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION,
} from "./account-timeline-contracts.js";
import {
  LIBRARY_CORE_SAVED_ANALYTICS_V2_DAILY_WINDOW_COUNT,
  LIBRARY_CORE_SAVED_ANALYTICS_V2_HOURLY_WINDOW_COUNT,
  LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID,
  LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION,
  type LibraryCoreSavedAnalyticsResponseV2,
  type LibraryCoreSavedAnalyticsWindowV2,
} from "./saved-analytics-v2-contracts.js";
import {
  LIBRARY_CORE_MAP_MARKERS_MAXIMUM_LIMIT,
  LIBRARY_CORE_MAP_MARKERS_QUERY_ID,
  LIBRARY_CORE_MAP_MARKERS_SCHEMA_VERSION,
  LIBRARY_CORE_STORY_WALL_CANDIDATES_MAXIMUM_LIMIT,
  LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID,
  LIBRARY_CORE_STORY_WALL_CANDIDATES_SCHEMA_VERSION,
  libraryCoreMapMarkerToItemV1,
  libraryCoreStoryWallCandidateToItemV1,
} from "./secondary-surface-contracts.js";
import {
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseFilterInputV1,
} from "./feed-browse-filter-contract.js";
import {
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  type LibraryCoreFeedBrowseIdentityModeV2,
} from "./feed-browse-page-contracts.js";
import { LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION } from "./feed-recommendation-order-contract.js";
import {
  LIBRARY_CORE_SEARCH_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_SEARCH_PAGE_QUERY_ID,
  LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION,
  type LibraryCoreSearchPageResponseV1,
} from "./search-page-contracts.js";

export interface LibraryCoreNormalizedSavedAnalyticsInputV1 {
  readonly dailyWindows: readonly LibraryCoreSavedAnalyticsWindowV2[];
  readonly hourlyWindows: readonly LibraryCoreSavedAnalyticsWindowV2[];
}

export type LibraryCoreNormalizedSurfaceV1 = "map" | "story_wall";

export interface LibraryCoreNormalizedPersonTimelineInputV1 {
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly personId: string;
}

export interface LibraryCoreNormalizedPersonTimelinePageV1 {
  readonly items: readonly FeedItem[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
}

export interface LibraryCoreNormalizedAccountTimelineInputV1 {
  readonly accountId: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface LibraryCoreNormalizedSearchInputV1 {
  readonly filter: LibraryCoreFeedBrowseFilterInputV1;
  readonly identityMode: LibraryCoreFeedBrowseIdentityModeV2;
  readonly query: string;
  readonly signal?: AbortSignal;
}

export interface LibraryCoreNormalizedSearchMatchV1 {
  readonly item: FeedItem;
  readonly score: number;
}

function operationId(
  runtime: LibraryCoreNormalizedReaderRuntime,
  prefix: string,
): string {
  return createLibraryCoreOperationInstanceId(prefix, runtime.randomId());
}

function validWindows(
  windows: readonly LibraryCoreSavedAnalyticsWindowV2[],
  count: number,
): boolean {
  return (
    windows.length === count &&
    windows.every(
      (window) =>
        Number.isSafeInteger(window.startMs) &&
        Number.isSafeInteger(window.endMs) &&
        window.endMs >= window.startMs,
    )
  );
}

export async function readLibraryCoreNormalizedItemDetailV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  globalId: string,
): Promise<FeedItem | null> {
  if (!globalId || new TextEncoder().encode(globalId).length > 4_096) {
    throw new Error("Library Core item identity is invalid");
  }
  const response = await runtime.query({
    globalId,
    queryId: LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
  });
  return response.item === null
    ? null
    : libraryCoreFeedCardToItemV1(response.item.card);
}

export async function readLibraryCoreNormalizedFacetSummaryV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
): Promise<LibraryCoreFacetSummaryV1> {
  const response = await runtime.query({
    queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
    schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  });
  return response.summary;
}

export async function readLibraryCoreNormalizedSavedAnalyticsV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  request: LibraryCoreNormalizedSavedAnalyticsInputV1,
): Promise<LibraryCoreSavedAnalyticsResponseV2> {
  if (
    !validWindows(
      request.dailyWindows,
      LIBRARY_CORE_SAVED_ANALYTICS_V2_DAILY_WINDOW_COUNT,
    ) ||
    !validWindows(
      request.hourlyWindows,
      LIBRARY_CORE_SAVED_ANALYTICS_V2_HOURLY_WINDOW_COUNT,
    )
  ) {
    throw new Error("Library Core saved analytics windows are invalid");
  }
  return runtime.query({
    dailyWindows: request.dailyWindows,
    hourlyWindows: request.hourlyWindows,
    queryId: LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID,
    schemaVersion: LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION,
  });
}

export async function readLibraryCoreNormalizedSurfaceItemsV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  surface: LibraryCoreNormalizedSurfaceV1,
): Promise<readonly FeedItem[]> {
  const cancellationId = operationId(runtime, `${surface}-surface`);
  const readerSessionId = operationId(runtime, `${surface}-surface-reader`);
  if (surface === "map") {
    const response = await runtime.query({
      cancellationId,
      limit: LIBRARY_CORE_MAP_MARKERS_MAXIMUM_LIMIT,
      queryId: LIBRARY_CORE_MAP_MARKERS_QUERY_ID,
      readerSessionId,
      schemaVersion: LIBRARY_CORE_MAP_MARKERS_SCHEMA_VERSION,
    });
    return response.rows.map(libraryCoreMapMarkerToItemV1);
  }
  const response = await runtime.query({
    cancellationId,
    limit: LIBRARY_CORE_STORY_WALL_CANDIDATES_MAXIMUM_LIMIT,
    queryId: LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID,
    readerSessionId,
    schemaVersion: LIBRARY_CORE_STORY_WALL_CANDIDATES_SCHEMA_VERSION,
  });
  return response.rows.map(libraryCoreStoryWallCandidateToItemV1);
}

export async function readLibraryCoreNormalizedPersonTimelineV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  input: LibraryCoreNormalizedPersonTimelineInputV1,
): Promise<LibraryCoreNormalizedPersonTimelinePageV1> {
  const limit = input.limit ?? LIBRARY_CORE_PERSON_TIMELINE_DEFAULT_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_LIMIT
  ) {
    throw new Error("Library Core person timeline request is invalid");
  }
  const response = await runtime.query({
    cancellationId: operationId(runtime, "person-timeline"),
    cursor: input.cursor ?? null,
    limit,
    personId: input.personId,
    queryId: LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID,
    readerSessionId: operationId(runtime, "person-timeline-reader"),
    schemaVersion: LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION,
  });
  return Object.freeze({
    items: response.rows.map(libraryCoreFeedCardToItemV1),
    nextCursor: response.nextCursor,
    totalCount: response.totalCount,
  });
}

export async function readLibraryCoreNormalizedAccountTimelineV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  input: LibraryCoreNormalizedAccountTimelineInputV1,
): Promise<LibraryCoreNormalizedPersonTimelinePageV1> {
  const limit = input.limit ?? LIBRARY_CORE_ACCOUNT_TIMELINE_DEFAULT_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_LIMIT
  ) {
    throw new Error("Library Core account timeline request is invalid");
  }
  const response = await runtime.query({
    accountId: input.accountId,
    cancellationId: operationId(runtime, "account-timeline"),
    cursor: input.cursor ?? null,
    limit,
    queryId: LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID,
    readerSessionId: operationId(runtime, "account-timeline-reader"),
    schemaVersion: LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION,
  });
  return Object.freeze({
    items: response.rows.map(libraryCoreFeedCardToItemV1),
    nextCursor: response.nextCursor,
    totalCount: response.totalCount,
  });
}

export async function searchLibraryCoreNormalizedItemsV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  input: LibraryCoreNormalizedSearchInputV1,
  visit: (
    matches: readonly LibraryCoreNormalizedSearchMatchV1[],
  ) => "continue" | "stop",
): Promise<void> {
  const parsedFilter = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(input.filter),
  );
  if (!parsedFilter.ok) throw new TypeError(parsedFilter.error);
  const readerSessionId = operationId(runtime, "search-reader");
  let cursor: string | null = null;
  do {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const response: LibraryCoreSearchPageResponseV1 = await runtime.query({
      cancellationId: operationId(runtime, "search-page"),
      cursor,
      filter: parsedFilter.value,
      friendsPredicateSchemaVersion:
        LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
      identityMode: input.identityMode,
      limit: LIBRARY_CORE_SEARCH_PAGE_DEFAULT_LIMIT,
      query: input.query,
      queryId: LIBRARY_CORE_SEARCH_PAGE_QUERY_ID,
      readerSessionId,
      recommendationOrderSchemaVersion:
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
      schemaVersion: LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION,
    });
    if (
      response.rows.length > 0 &&
      visit(
        response.rows.map((row) => ({
          item: {
            ...libraryCoreFeedCardToItemV1(row.card),
            priority: row.priority,
          },
          score: row.score,
        })),
      ) === "stop"
    ) {
      return;
    }
    if (response.nextCursor === cursor) {
      throw new Error("SQLite Library search cursor did not advance");
    }
    cursor = response.nextCursor;
  } while (cursor !== null);
}
