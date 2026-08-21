import {
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  parseLibraryCoreFeedBrowsePageRequestV3,
  type LibraryCoreFeedBrowseIdentityModeV2,
} from "./feed-browse-page-contracts.js";
import type { LibraryCoreFeedBrowseFilterV1 } from "./feed-browse-filter-contract.js";
import { LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION } from "./feed-recommendation-order-contract.js";
import {
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageCursorV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import {
  isLibraryCoreSearchQueryV1,
  tokenizeLibraryCoreSearchTextV1,
} from "./search-contracts.js";
import { LibraryCoreSha256 } from "./sha256.js";

export const LIBRARY_CORE_SEARCH_PAGE_QUERY_ID = "search_page_v1" as const;
export const LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_SEARCH_PAGE_DEFAULT_LIMIT = 32;
export const LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_LIMIT = 32;
export const LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_SCAN_ROWS = 256;
export const LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_CURSOR_BYTES = 5_700;
export const LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_RESPONSE_BYTES = 2 * 1_048_576;

export const LIBRARY_CORE_SEARCH_PAGE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_search_page_request_v1",
  schemaVersion: LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SEARCH_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "filter",
    "friendsPredicateSchemaVersion",
    "identityMode",
    "limit",
    "query",
    "queryId",
    "readerSessionId",
    "recommendationOrderSchemaVersion",
    "schemaVersion",
  ]),
  cursorCodec: "library_core_search_page_cursor_v1",
  defaultLimit: LIBRARY_CORE_SEARCH_PAGE_DEFAULT_LIMIT,
  maximumCursorBytes: LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_CURSOR_BYTES,
  maximumLimit: LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_LIMIT,
  maximumScanRows: LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_SCAN_ROWS,
});

export const LIBRARY_CORE_SEARCH_PAGE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_search_page_response_v1",
  schemaVersion: LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SEARCH_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "scannedRows",
    "schemaVersion",
    "source",
  ]),
  maximumResponseBytes: LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_RESPONSE_BYTES,
  maximumRows: LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_LIMIT,
});

export const LIBRARY_CORE_SEARCH_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_scored_feed_card_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["globalId"]),
});

export const LIBRARY_CORE_SEARCH_PAGE_SOURCE_IDENTITY =
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY;

export const LIBRARY_CORE_SEARCH_PAGE_NESTED_BOUNDS = Object.freeze({
  accountAliasTerms: 16,
  cardMedia: 8,
  cardSignals: 32,
  cardTags: 32,
  documentTerms: 384,
  queryTerms: 32,
});

const REQUEST_KEYS = LIBRARY_CORE_SEARCH_PAGE_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS = LIBRARY_CORE_SEARCH_PAGE_RESPONSE_SCHEMA.canonicalKeys;
const ROW_KEYS = ["card", "priority", "score"] as const;
const textEncoder = new TextEncoder();

export interface LibraryCoreSearchPageCursorV1 extends LibraryCoreFeedPageCursorV1 {
  readonly searchDigest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreSearchPageRequestV1 {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly friendsPredicateSchemaVersion: typeof LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION;
  readonly identityMode: LibraryCoreFeedBrowseIdentityModeV2;
  readonly limit: number;
  readonly query: string;
  readonly queryId: typeof LIBRARY_CORE_SEARCH_PAGE_QUERY_ID;
  readonly readerSessionId: string;
  readonly recommendationOrderSchemaVersion: typeof LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION;
  readonly schemaVersion: typeof LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION;
}

export interface LibraryCoreSearchPageRowV1 {
  readonly card: LibraryCoreFeedCardV1;
  readonly priority: number;
  readonly score: number;
}

export interface LibraryCoreSearchPageResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_SEARCH_PAGE_QUERY_ID;
  readonly rows: readonly LibraryCoreSearchPageRowV1[];
  readonly scannedRows: number;
  readonly schemaVersion: typeof LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

function success<T>(value: T): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ error, ok: false });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): LibraryCoreFeedPageParseResult<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return failure(`${label} must be one plain record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return failure(`${label} has unknown or missing fields`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return failure(`${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return success(snapshot);
}

export function libraryCoreSearchPageRequestDigestV1(
  request: Pick<
    LibraryCoreSearchPageRequestV1,
    "filter" | "identityMode" | "query"
  >,
): LibraryCoreLowercaseHex64 {
  const binding = JSON.stringify({
    filter: request.filter,
    identityMode: request.identityMode,
    query: request.query,
  });
  return new LibraryCoreSha256()
    .update(textEncoder.encode(binding))
    .digestLowerHex();
}

export function encodeLibraryCoreSearchPageCursorV1(
  cursor: LibraryCoreSearchPageCursorV1,
): string {
  if (!isLibraryCoreLowercaseHex64(cursor.searchDigest)) {
    throw new TypeError("invalid Library Core search cursor digest");
  }
  return `1.${encodeLibraryCoreFeedPageCursorV1(cursor)}.${cursor.searchDigest}`;
}

export function decodeLibraryCoreSearchPageCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSearchPageCursorV1> {
  if (
    typeof value !== "string" ||
    value.length > LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_CURSOR_BYTES
  ) {
    return failure("search cursor is invalid or unbounded");
  }
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "1" ||
    !isLibraryCoreLowercaseHex64(parts[2])
  ) {
    return failure("search cursor has invalid encoding or version");
  }
  const page = decodeLibraryCoreFeedPageCursorV1(parts[1]);
  if (!page.ok) return failure(page.error);
  return success(
    Object.freeze({ ...page.value, searchDigest: parts[2] }),
  );
}

export function parseLibraryCoreSearchPageRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSearchPageRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS, "search request");
  if (!record.ok) return record;
  const input = record.value;
  if (
    input.queryId !== LIBRARY_CORE_SEARCH_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION ||
    !isLibraryCoreSearchQueryV1(input.query) ||
    tokenizeLibraryCoreSearchTextV1(input.query, 32).length === 0 ||
    !isLibraryCoreOperationInstanceId(input.readerSessionId) ||
    !isLibraryCoreOperationInstanceId(input.cancellationId) ||
    !isLibraryCoreNonnegativeSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_LIMIT ||
    (input.cursor !== null && typeof input.cursor !== "string")
  ) {
    return failure("search request identity or bounds are invalid");
  }
  const browse = parseLibraryCoreFeedBrowsePageRequestV3({
    cancellationId: input.cancellationId,
    cursor: null,
    direction: "next",
    filter: input.filter,
    friendsPredicateSchemaVersion: input.friendsPredicateSchemaVersion,
    identityMode: input.identityMode,
    limit: input.limit,
    queryId: "feed_browse_page_v3",
    rankingClockMs: 0,
    readerSessionId: input.readerSessionId,
    recommendationOrderSchemaVersion: input.recommendationOrderSchemaVersion,
    schemaVersion: 3,
  });
  if (!browse.ok) return failure(browse.error);
  const parsed = Object.freeze({
    cancellationId: browse.value.cancellationId,
    cursor: input.cursor as string | null,
    filter: browse.value.filter,
    friendsPredicateSchemaVersion:
      LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
    identityMode: browse.value.identityMode,
    limit: input.limit,
    query: input.query,
    queryId: LIBRARY_CORE_SEARCH_PAGE_QUERY_ID,
    readerSessionId: browse.value.readerSessionId,
    recommendationOrderSchemaVersion:
      LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    schemaVersion: LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION,
  }) satisfies LibraryCoreSearchPageRequestV1;
  if (parsed.cursor !== null) {
    const cursor = decodeLibraryCoreSearchPageCursorV1(parsed.cursor);
    if (
      !cursor.ok ||
      cursor.value.searchDigest !== libraryCoreSearchPageRequestDigestV1(parsed)
    ) {
      return failure("search cursor belongs to a different request");
    }
  }
  return success(parsed);
}

export function parseLibraryCoreSearchPageResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSearchPageResponseV1> {
  const request = parseLibraryCoreSearchPageRequestV1(requestValue);
  if (!request.ok) return failure(`response request is invalid: ${request.error}`);
  const record = closedRecord(value, RESPONSE_KEYS, "search response");
  if (!record.ok) return record;
  const input = record.value;
  if (
    input.queryId !== LIBRARY_CORE_SEARCH_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION ||
    !Array.isArray(input.rows) ||
    input.rows.length > request.value.limit ||
    !isLibraryCoreNonnegativeSafeInteger(input.scannedRows) ||
    input.scannedRows > LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_SCAN_ROWS ||
    (input.nextCursor !== null && typeof input.nextCursor !== "string")
  ) {
    return failure("search response identity or bounds are invalid");
  }
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return source;
  const inputRows = input.rows;
  const digest = libraryCoreSearchPageRequestDigestV1(request.value);
  for (const cursorValue of [request.value.cursor, input.nextCursor]) {
    if (cursorValue === null) continue;
    const cursor = decodeLibraryCoreSearchPageCursorV1(cursorValue);
    if (
      !cursor.ok ||
      cursor.value.searchDigest !== digest ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.projectionRevision !== source.value.projectionRevision
    ) {
      return failure("search response cursor does not match its request and source");
    }
  }
  const rows: LibraryCoreSearchPageRowV1[] = [];
  for (let index = 0; index < inputRows.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(inputRows, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return failure("search rows must be one dense data array");
    }
    const row = closedRecord(descriptor.value, ROW_KEYS, "search row");
    if (!row.ok) return row;
    const card = parseLibraryCoreFeedCardV1(row.value.card);
    if (
      !card.ok ||
      typeof row.value.priority !== "number" ||
      !Number.isFinite(row.value.priority) ||
      row.value.priority < 0 ||
      row.value.priority > 100 ||
      typeof row.value.score !== "number" ||
      !Number.isFinite(row.value.score) ||
      row.value.score <= 0
    ) {
      return failure("search row is invalid");
    }
    rows.push(
      Object.freeze({
        card: card.value,
        priority: row.value.priority,
        score: row.value.score,
      }),
    );
  }
  if (
    Reflect.ownKeys(inputRows).some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" ||
          !/^(0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= inputRows.length),
    )
  ) {
    return failure("search rows contain non-index properties");
  }
  const response = Object.freeze({
    nextCursor: input.nextCursor as string | null,
    queryId: LIBRARY_CORE_SEARCH_PAGE_QUERY_ID,
    rows: Object.freeze(rows),
    scannedRows: input.scannedRows,
    schemaVersion: LIBRARY_CORE_SEARCH_PAGE_SCHEMA_VERSION,
    source: source.value,
  });
  if (textEncoder.encode(JSON.stringify(response)).byteLength > LIBRARY_CORE_SEARCH_PAGE_MAXIMUM_RESPONSE_BYTES) {
    return failure("search response exceeds its byte bound");
  }
  return success(response);
}
