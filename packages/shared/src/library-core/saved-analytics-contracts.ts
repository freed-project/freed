import type { LibraryCoreLowercaseHex64 } from "./protocol-scalars.js";

/**
 * Closed contract for the Desktop Saved-analytics aggregate.
 *
 * Every bound here is read from the live native reader, not chosen here:
 * `library_core_feed_reader_runtime.rs` fixes the window counts and the 8 MiB
 * response ceiling, and `shadow_store.rs` fixes the label caps and the label
 * ordering. Changing a value in this file without changing those does not make
 * it true.
 */
export const LIBRARY_CORE_SAVED_ANALYTICS_QUERY_ID =
  "saved_analytics_v1" as const;
export const LIBRARY_CORE_SAVED_ANALYTICS_SCHEMA_VERSION = 1 as const;

/** Seven contiguous day windows, oldest first. */
export const LIBRARY_CORE_SAVED_ANALYTICS_DAILY_WINDOW_COUNT = 7;
/** Twenty-four hour windows, oldest first. */
export const LIBRARY_CORE_SAVED_ANALYTICS_HOURLY_WINDOW_COUNT = 24;
export const LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_SOURCE_LABELS = 4_096;
export const LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_CONTENT_TYPES = 64;
export const LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_LABEL_UTF8_BYTES = 2_048;
export const LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;

export const LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_saved_analytics_request_v1",
  schemaVersion: LIBRARY_CORE_SAVED_ANALYTICS_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SAVED_ANALYTICS_QUERY_ID,
  canonicalKeys: Object.freeze([
    "dailyWindows",
    "hourlyWindows",
    "queryId",
    "schemaVersion",
  ]),
  windowKeys: Object.freeze(["endMs", "startMs"]),
  dailyWindowCount: LIBRARY_CORE_SAVED_ANALYTICS_DAILY_WINDOW_COUNT,
  hourlyWindowCount: LIBRARY_CORE_SAVED_ANALYTICS_HOURLY_WINDOW_COUNT,
  /**
   * Windows are contiguous: each window's start equals the previous window's
   * end. The hourly series admits exactly one repeated window because a
   * daylight-saving fall-back repeats a wall-clock hour; the daily series
   * admits none.
   */
  contiguousWindows: true,
  repeatedWindowAllowance: Object.freeze({ daily: 0, hourly: 1 }),
});

export const LIBRARY_CORE_SAVED_ANALYTICS_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_saved_analytics_response_v1",
  schemaVersion: LIBRARY_CORE_SAVED_ANALYTICS_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SAVED_ANALYTICS_QUERY_ID,
  canonicalKeys: Object.freeze([
    "contentMix",
    "dailyCounts",
    "hourlyCounts",
    "latestSavedAt",
    "queryId",
    "schemaVersion",
    "source",
    "sourceCounts",
    "totalCount",
  ]),
  countKeys: Object.freeze(["count", "label"]),
  dailyCountsLength: LIBRARY_CORE_SAVED_ANALYTICS_DAILY_WINDOW_COUNT,
  hourlyCountsLength: LIBRARY_CORE_SAVED_ANALYTICS_HOURLY_WINDOW_COUNT,
  maximumSourceCounts: LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_SOURCE_LABELS,
  maximumContentMix: LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_CONTENT_TYPES,
  maximumResponseBytes: LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_RESPONSE_BYTES,
});

/**
 * This query returns aggregates, not entity rows, so it has no row projection
 * over `feed_items`. It projects two label-keyed count series.
 */
export const LIBRARY_CORE_SAVED_ANALYTICS_PROJECTION = Object.freeze({
  projectionId: "library_core_saved_analytics_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["label"]),
});

export const LIBRARY_CORE_SAVED_ANALYTICS_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_SAVED_ANALYTICS_NESTED_BOUNDS = Object.freeze({
  sourceCounts: Object.freeze({
    maximumItems: LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_SOURCE_LABELS,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_LABEL_UTF8_BYTES,
    maximumUtf8BytesPerItem:
      LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_LABEL_UTF8_BYTES,
  }),
  contentMix: Object.freeze({
    maximumItems: LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_CONTENT_TYPES,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_LABEL_UTF8_BYTES,
    maximumUtf8BytesPerItem:
      LIBRARY_CORE_SAVED_ANALYTICS_MAXIMUM_LABEL_UTF8_BYTES,
  }),
});

export interface LibraryCoreSavedAnalyticsWindowV1 {
  readonly startMs: number;
  readonly endMs: number;
}

export interface LibraryCoreSavedAnalyticsCountV1 {
  readonly label: string;
  readonly count: number;
}

export interface LibraryCoreSavedAnalyticsRequestV1 {
  readonly dailyWindows: readonly LibraryCoreSavedAnalyticsWindowV1[];
  readonly hourlyWindows: readonly LibraryCoreSavedAnalyticsWindowV1[];
  readonly queryId: typeof LIBRARY_CORE_SAVED_ANALYTICS_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_SAVED_ANALYTICS_SCHEMA_VERSION;
}

export interface LibraryCoreSavedAnalyticsSourceV1 {
  readonly documentId: string;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly headCount: number;
  readonly headsDigest: LibraryCoreLowercaseHex64;
  readonly projectionRevision: number;
  readonly storageGeneration: number;
  readonly storageSaveRevision: number;
  readonly transitionSequence: number;
}

export interface LibraryCoreSavedAnalyticsResponseV1 {
  readonly contentMix: readonly LibraryCoreSavedAnalyticsCountV1[];
  readonly dailyCounts: readonly number[];
  readonly hourlyCounts: readonly number[];
  readonly latestSavedAt: number | null;
  readonly queryId: typeof LIBRARY_CORE_SAVED_ANALYTICS_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_SAVED_ANALYTICS_SCHEMA_VERSION;
  readonly source: LibraryCoreSavedAnalyticsSourceV1;
  readonly sourceCounts: readonly LibraryCoreSavedAnalyticsCountV1[];
  readonly totalCount: number;
}
