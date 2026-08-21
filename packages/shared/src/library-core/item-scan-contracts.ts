import {
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
} from "./item-detail-contracts.js";

/**
 * Closed contract for the bounded item scan behind `scanLibraryItems`.
 *
 * Background jobs page metadata only. Reader content uses its own ranged
 * content query and never rides inside a corpus traversal.
 */
export const LIBRARY_CORE_ITEM_SCAN_QUERY_ID =
  "background_item_page_v1" as const;
export const LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_ITEM_SCAN_MAXIMUM_LIMIT = 64;
export const LIBRARY_CORE_ITEM_SCAN_MAXIMUM_ROW_BYTES = 2 * 1_048_576;

export const LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_item_scan_request_v1",
  schemaVersion: LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_SCAN_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "limit",
    "queryId",
    "readerSessionId",
    "schemaVersion",
  ]),
  cursorCodec: "library_core_item_scan_cursor_v1",
  maximumLimit: LIBRARY_CORE_ITEM_SCAN_MAXIMUM_LIMIT,
  /** Cancellable: the caller may stop the traversal between pages. */
  cancellable: true,
});

export const LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_item_scan_response_v1",
  schemaVersion: LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_SCAN_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "schemaVersion",
    "source",
  ]),
  maximumRows: LIBRARY_CORE_ITEM_SCAN_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_ITEM_SCAN_MAXIMUM_ROW_BYTES,
});

/**
 * This projection is deliberately separate from item detail. Background jobs
 * can add compact task fields without widening a product-view response.
 */
export const LIBRARY_CORE_ITEM_SCAN_PROJECTION = Object.freeze({
  projectionId: "library_core_background_item_metadata_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["globalId"]),
});
export const LIBRARY_CORE_ITEM_SCAN_SOURCE_IDENTITY =
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY;
export const LIBRARY_CORE_ITEM_SCAN_NESTED_BOUNDS =
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS;

export interface LibraryCoreItemScanRequestV1 {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_ITEM_SCAN_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: typeof LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION;
}
