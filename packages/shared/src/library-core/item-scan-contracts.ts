import {
  LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS,
  LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY,
} from "./item-detail-contracts.js";
import {
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageCursorV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreOperationInstanceId } from "./protocol-scalars.js";

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
export const LIBRARY_CORE_ITEM_SCAN_MAXIMUM_CURSOR_BYTES = 5_540;

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
  sourceTable: "library_feed_items",
  fullContentAllowed: false,
  selectedFields: Object.freeze([
    ...LIBRARY_CORE_FEED_PAGE_PROJECTION.selectedFields,
    "hidden",
    "rssSource",
    "sampleDataFingerprint",
  ]),
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

export interface LibraryCoreItemScanResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_ITEM_SCAN_QUERY_ID;
  readonly rows: readonly LibraryCoreItemScanRowV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

export interface LibraryCoreItemScanRssSourceV1 {
  readonly feedTitle: string;
  readonly feedUrl: string;
  readonly siteUrl: string;
}

export interface LibraryCoreItemScanSampleFingerprintV1 {
  readonly batchId: string;
  readonly generatedAt: number;
  readonly generatorVersion: number;
  readonly marker: "freed.sample-data.v1";
}

export interface LibraryCoreItemScanRowV1 extends LibraryCoreFeedCardV1 {
  readonly hidden: boolean;
  readonly rssSource: LibraryCoreItemScanRssSourceV1 | null;
  readonly sampleDataFingerprint: LibraryCoreItemScanSampleFingerprintV1 | null;
}

export type LibraryCoreItemScanCursorV1 = Omit<
  LibraryCoreFeedPageCursorV1,
  "sortAt"
>;

const REQUEST_KEYS = LIBRARY_CORE_ITEM_SCAN_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS = LIBRARY_CORE_ITEM_SCAN_RESPONSE_SCHEMA.canonicalKeys;
const ROW_KEYS = LIBRARY_CORE_ITEM_SCAN_PROJECTION.selectedFields;
const textEncoder = new TextEncoder();

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some(
      (key) => !descriptors[key]?.enumerable || !("value" in descriptors[key]),
    )
  ) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    textEncoder.encode(value).byteLength <= maximumBytes
  );
}

function parseRow(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemScanRowV1> {
  const record = closedRecord(value, ROW_KEYS);
  if (!record) return failure("item scan row is invalid");
  const { hidden, rssSource, sampleDataFingerprint, ...cardInput } = record;
  const card = parseLibraryCoreFeedCardV1(cardInput);
  const rss =
    rssSource === null
      ? null
      : closedRecord(rssSource, ["feedTitle", "feedUrl", "siteUrl"]);
  const fingerprint =
    sampleDataFingerprint === null
      ? null
      : closedRecord(sampleDataFingerprint, [
          "batchId",
          "generatedAt",
          "generatorVersion",
          "marker",
        ]);
  if (
    !card.ok ||
    typeof hidden !== "boolean" ||
    (rssSource !== null && rss === null) ||
    (rss !== null &&
      (!boundedText(rss.feedUrl, 8_192) ||
        rss.feedUrl.length === 0 ||
        !boundedText(rss.feedTitle, 2_048) ||
        !boundedText(rss.siteUrl, 8_192))) ||
    (sampleDataFingerprint !== null && fingerprint === null) ||
    (fingerprint !== null &&
      (fingerprint.marker !== "freed.sample-data.v1" ||
        !boundedText(fingerprint.batchId, 4_096) ||
        fingerprint.batchId.length === 0 ||
        !Number.isSafeInteger(fingerprint.generatedAt) ||
        (fingerprint.generatedAt as number) < 0 ||
        !Number.isSafeInteger(fingerprint.generatorVersion) ||
        (fingerprint.generatorVersion as number) < 1))
  ) {
    return failure("item scan row is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...card.value,
      hidden,
      rssSource:
        rss === null
          ? null
          : Object.freeze({
              feedTitle: rss.feedTitle as string,
              feedUrl: rss.feedUrl as string,
              siteUrl: rss.siteUrl as string,
            }),
      sampleDataFingerprint:
        fingerprint === null
          ? null
          : Object.freeze({
              batchId: fingerprint.batchId as string,
              generatedAt: fingerprint.generatedAt as number,
              generatorVersion: fingerprint.generatorVersion as number,
              marker: "freed.sample-data.v1" as const,
            }),
    }),
  });
}

export function encodeLibraryCoreItemScanCursorV1(
  cursor: LibraryCoreItemScanCursorV1,
): string {
  return encodeLibraryCoreFeedPageCursorV1({ ...cursor, sortAt: 0 });
}

export function decodeLibraryCoreItemScanCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemScanCursorV1> {
  const decoded = decodeLibraryCoreFeedPageCursorV1(value);
  if (!decoded.ok || decoded.value.sortAt !== 0) {
    return failure("item scan cursor is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      generationId: decoded.value.generationId,
      globalId: decoded.value.globalId,
      projectionRevision: decoded.value.projectionRevision,
      transitionSequence: decoded.value.transitionSequence,
    }),
  });
}

export function parseLibraryCoreItemScanRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemScanRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_ITEM_SCAN_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(record.cancellationId) ||
    !isLibraryCoreOperationInstanceId(record.readerSessionId) ||
    !Number.isSafeInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) > LIBRARY_CORE_ITEM_SCAN_MAXIMUM_LIMIT ||
    (record.cursor !== null && typeof record.cursor !== "string")
  ) {
    return failure("item scan request is invalid");
  }
  if (
    record.cursor !== null &&
    !decodeLibraryCoreItemScanCursorV1(record.cursor).ok
  ) {
    return failure("item scan cursor is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      cancellationId: record.cancellationId,
      cursor: record.cursor,
      limit: record.limit,
      queryId: LIBRARY_CORE_ITEM_SCAN_QUERY_ID,
      readerSessionId: record.readerSessionId,
      schemaVersion: LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION,
    }) as LibraryCoreItemScanRequestV1,
  });
}

export function parseLibraryCoreItemScanResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemScanResponseV1> {
  const request = parseLibraryCoreItemScanRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_ITEM_SCAN_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION ||
    !Array.isArray(record.rows) ||
    record.rows.length > request.value.limit ||
    (record.nextCursor !== null && typeof record.nextCursor !== "string")
  ) {
    return failure("item scan response is invalid");
  }
  const rows: LibraryCoreItemScanRowV1[] = [];
  for (const candidate of record.rows) {
    const row = parseRow(candidate);
    if (!row.ok) return failure(row.error);
    const previous = rows.at(-1);
    if (previous && previous.globalId >= row.value.globalId) {
      return failure("item scan rows are not in binary identity order");
    }
    rows.push(row.value);
  }
  if (record.nextCursor !== null) {
    const cursor = decodeLibraryCoreItemScanCursorV1(record.nextCursor);
    if (
      !cursor.ok ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.projectionRevision !== source.value.projectionRevision ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.globalId !== rows.at(-1)?.globalId
    ) {
      return failure("item scan cursor does not bind the final row and source");
    }
  }
  const response = Object.freeze({
    nextCursor: record.nextCursor as string | null,
    queryId: LIBRARY_CORE_ITEM_SCAN_QUERY_ID,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_ITEM_SCAN_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_ITEM_SCAN_MAXIMUM_ROW_BYTES
  ) {
    return failure("item scan response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
