/**
 * Closed contract for the Desktop single-item detail lookup.
 *
 * Every bound is read from the live native reader rather than chosen here.
 * `library_core_feed_reader_runtime.rs` fixes the query identity, the 4,096
 * byte entity-ID ceiling, and the 8 MiB response ceiling. `shadow_store.rs`
 * fixes the selected columns, which include the preserved reader body.
 */
export const LIBRARY_CORE_ITEM_DETAIL_QUERY_ID = "item_detail_v1" as const;
export const LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES = 4_096;
export const LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;

export const LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_item_detail_request_v1",
  schemaVersion: LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze(["globalId", "queryId", "schemaVersion"]),
  /** The native reader rejects an empty or oversized identity before opening. */
  requiresNonEmptyGlobalId: true,
  maximumGlobalIdUtf8Bytes:
    LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
});

export const LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_item_detail_response_v1",
  schemaVersion: LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze([
    "item",
    "queryId",
    "schemaVersion",
    "source",
  ]),
  itemKeys: Object.freeze([
    "archived",
    "archivedAt",
    "authorDisplayName",
    "authorHandle",
    "authorId",
    "capturedAt",
    "contentBlob",
    "contentType",
    "globalId",
    "hidden",
    "likedAt",
    "platform",
    "preservedBlob",
    "publishedAt",
    "readAt",
    "rest",
    "saved",
    "sourceUrl",
    "tags",
  ]),
  /** A missing item is an absent row, not an error. */
  nullableItem: true,
  maximumRows: 1,
  maximumResponseBytes: LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
});

/**
 * Unlike the compact feed card, this lookup selects `contentBlob` and
 * `preservedBlob`, so it does carry full reader content. That is why its
 * response ceiling is 8 MiB rather than the ordinary 2 MiB.
 */
export const LIBRARY_CORE_ITEM_DETAIL_PROJECTION = Object.freeze({
  projectionId: "library_core_item_detail_row_v1",
  sourceTable: "feed_items",
  fullContentAllowed: true,
  orderedColumns: Object.freeze(["globalId"]),
});

export const LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS = Object.freeze({
  globalId: Object.freeze({
    maximumItems: 1,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
    maximumUtf8BytesPerItem:
      LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
  }),
  /**
   * Content and preserved bodies are bounded by the response ceiling rather
   * than a per-field cap, because the reader streams one row and the whole
   * response is measured against 8 MiB.
   */
  contentBlob: Object.freeze({
    maximumItems: 1,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
    maximumUtf8BytesPerItem: LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
  }),
  preservedBlob: Object.freeze({
    maximumItems: 1,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
    maximumUtf8BytesPerItem: LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
  }),
});

export interface LibraryCoreItemDetailRequestV1 {
  readonly globalId: string;
  readonly queryId: typeof LIBRARY_CORE_ITEM_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION;
}
