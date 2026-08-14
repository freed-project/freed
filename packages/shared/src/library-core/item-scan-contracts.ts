import {
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_DETAIL_PROJECTION,
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
} from "./item-detail-contracts.js";

/**
 * Closed contract for the bounded item scan behind `scanLibraryItems`.
 *
 * This is the primitive the rest of the bounded-read program stands on: search,
 * content fetch, the header signal counts, and the compatibility rebuild all
 * page through it. Every bound is read from the live native reader.
 * `library_core_feed_reader_runtime.rs` fixes the 64-row page limit and the
 * cursor encoding; `shadow_store.rs` fixes the selected columns, the ordering,
 * and the per-page row budget.
 */
export const LIBRARY_CORE_ITEM_SCAN_QUERY_ID =
  "background_item_page_v1" as const;
export const LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_ITEM_SCAN_MAXIMUM_LIMIT = 64;
/** 8 MiB less 64 KiB reserved for response framing. */
export const LIBRARY_CORE_ITEM_SCAN_MAXIMUM_ROW_BYTES = 8 * 1_048_576 - 64 * 1_024;

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
 * The scan selects exactly the same columns as the single-item lookup, in the
 * same order, including `contentBlob` and `preservedBlob`. Reused by reference
 * so the two cannot drift: if one grows a column, the other must too.
 */
export const LIBRARY_CORE_ITEM_SCAN_PROJECTION =
  LIBRARY_CORE_ITEM_DETAIL_PROJECTION;
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
