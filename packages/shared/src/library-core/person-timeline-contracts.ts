import {
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
} from "./feed-page-contracts.js";

/**
 * Closed contract for the Desktop person-timeline page.
 *
 * Every bound is read from the live native reader rather than chosen here.
 * `library_core_feed_reader_runtime.rs` fixes the query identity, the default
 * and maximum page limits, the 5,000 source-key ceiling, the cursor encoding,
 * and the 2 MiB response ceiling. `shadow_store.rs` fixes the ordering.
 */
export const LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID =
  "person_timeline_v1" as const;
export const LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_PERSON_TIMELINE_DEFAULT_LIMIT = 50;
export const LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_LIMIT = 100;
export const LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_SOURCE_KEYS = 5_000;
export const LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_CURSOR_BYTES = 5_600;
export const LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;

export const LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_person_timeline_request_v1",
  schemaVersion: LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cursor",
    "limit",
    "queryId",
    "schemaVersion",
    "sources",
  ]),
  sourceKeys: Object.freeze(["authorId", "platform"]),
  /** The request selects by identity, so an empty source set is rejected. */
  requiresNonEmptySources: true,
  maximumSourceKeys: LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_SOURCE_KEYS,
  defaultLimit: LIBRARY_CORE_PERSON_TIMELINE_DEFAULT_LIMIT,
  maximumLimit: LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_LIMIT,
  cursorCodec: "library_core_person_timeline_cursor_v1",
  maximumCursorBytes: LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_CURSOR_BYTES,
});

export const LIBRARY_CORE_PERSON_TIMELINE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_person_timeline_response_v1",
  schemaVersion: LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "schemaVersion",
    "source",
    "totalCount",
  ]),
  maximumRows: LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES,
});

/**
 * The timeline pages the same `feed_items` rows through the same compact card
 * as the ordinary feed page, so it reuses that projection, source identity, and
 * nested bounds rather than declaring a parallel copy that could drift.
 */
export const LIBRARY_CORE_PERSON_TIMELINE_PROJECTION =
  LIBRARY_CORE_FEED_PAGE_PROJECTION;
export const LIBRARY_CORE_PERSON_TIMELINE_SOURCE_IDENTITY =
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY;
export const LIBRARY_CORE_PERSON_TIMELINE_NESTED_BOUNDS =
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS;

export interface LibraryCorePersonTimelineSourceKeyV1 {
  readonly platform: string;
  readonly authorId: string;
}

export interface LibraryCorePersonTimelineRequestV1 {
  readonly cursor: string | null;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION;
  readonly sources: readonly LibraryCorePersonTimelineSourceKeyV1[];
}
