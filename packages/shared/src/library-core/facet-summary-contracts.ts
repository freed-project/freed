/**
 * Closed contract for the whole-corpus facet summary.
 *
 * Every bound is read from the live native reader. `shadow_store.rs` fixes the
 * 4,096 tag ceiling, the 1,024 byte tag ceiling, and the tag ordering;
 * `library_core_feed_reader_runtime.rs` fixes the query identity.
 */
export const LIBRARY_CORE_FACET_SUMMARY_QUERY_ID =
  "library_facet_summary_v1" as const;
export const LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAGS = 4_096;
export const LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAG_UTF8_BYTES = 1_024;

export const LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_facet_summary_request_v1",
  schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  /** No filter, no cursor, no limit: the aggregate covers the whole corpus. */
  canonicalKeys: Object.freeze(["queryId", "schemaVersion"]),
});

export const LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_facet_summary_response_v1",
  schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  canonicalKeys: Object.freeze([
    "queryId",
    "schemaVersion",
    "source",
    "summary",
  ]),
  summaryKeys: Object.freeze([
    "archivedCount",
    "sampleItemCount",
    "savedArchivedCount",
    "savedCount",
    "savedPlatformCount",
    "tags",
    "totalCount",
  ]),
  maximumTags: LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAGS,
});

/**
 * Counts, not rows. The aggregate is computed inside SQLite and the renderer
 * never receives item rows, so no item projection applies.
 */
export const LIBRARY_CORE_FACET_SUMMARY_PROJECTION = Object.freeze({
  projectionId: "library_core_facet_summary_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["tag"]),
});

export const LIBRARY_CORE_FACET_SUMMARY_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_FACET_SUMMARY_NESTED_BOUNDS = Object.freeze({
  tags: Object.freeze({
    maximumItems: LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAGS,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAG_UTF8_BYTES,
    maximumUtf8BytesPerItem:
      LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAG_UTF8_BYTES,
  }),
});

/**
 * Why this query keeps `sort_contract_unresolved`.
 *
 * The tag list is sorted by **UTF-16 code units**, deliberately, so that Unicode
 * tags keep parity with JavaScript's `Array.sort()`. The Rust comment at the
 * sort site says exactly that. `ResolvedQuerySortContract.textCollation` admits
 * only `"binary"`, meaning UTF-8 byte order, and the two orders disagree for
 * characters outside the Basic Multilingual Plane: UTF-16 compares surrogate
 * pairs in the U+E000..U+FFFF range as greater than astral characters, while
 * UTF-8 byte order does not.
 *
 * Declaring `"binary"` here would misdescribe the order for any library holding
 * an emoji or CJK-extension tag. The blocker stays open until the sort contract
 * can express a UTF-16 collation. The real ordering is recorded below.
 */
export const LIBRARY_CORE_FACET_SUMMARY_TAG_ORDER = Object.freeze({
  columns: Object.freeze(["tag"]),
  direction: "asc",
  textCollation: "utf16_code_unit",
  reason: "product parity with JavaScript Array.sort()",
  unresolvedReason: "sort_contract_admits_only_binary_collation",
});

export interface LibraryCoreFacetSummaryRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_FACET_SUMMARY_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION;
}
