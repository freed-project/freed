import {
  decodeLibraryCoreFeedBrowsePageCursorV2,
  encodeLibraryCoreFeedBrowsePageCursorV2,
} from "./feed-browse-page-contracts.js";
import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEntityId,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import { LibraryCoreSha256 } from "./sha256.js";

export const LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID =
  "content_fetch_claim_v1" as const;
export const LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_LIMIT = 64;
export const LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_RESPONSE_BYTES = 1_048_576;

export const LIBRARY_CORE_CONTENT_FETCH_PAGE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_content_fetch_page_request_v1",
  schemaVersion: LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "limit",
    "queryId",
    "readerSessionId",
    "schemaVersion",
  ]),
  maximumLimit: LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_LIMIT,
  cancellable: true,
});

export const LIBRARY_CORE_CONTENT_FETCH_PAGE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_content_fetch_page_response_v1",
  schemaVersion: LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "schemaVersion",
    "source",
  ]),
  maximumRows: LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_CONTENT_FETCH_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_content_fetch_candidate_v1",
  sourceTable: "library_feed_items",
  fullContentAllowed: false,
  selectedFields: Object.freeze([
    "capturedAt",
    "globalId",
    "linkUrl",
    "publishedAt",
  ]),
});

export const LIBRARY_CORE_CONTENT_FETCH_PAGE_SOURCE_IDENTITY = Object.freeze({
  schemaId: "library_core_feed_page_source_v1",
  fields: Object.freeze([
    "generationId",
    "projectionRevision",
    "transitionSequence",
  ]),
});

export const LIBRARY_CORE_CONTENT_FETCH_PAGE_NESTED_BOUNDS = Object.freeze({
  maximumLinkUrlBytes: 8_192,
});

export interface LibraryCoreContentFetchPageRequestV1 {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: typeof LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION;
}

export interface LibraryCoreContentFetchCandidateV1 {
  readonly capturedAt: number;
  readonly globalId: string;
  readonly linkUrl: string;
  readonly publishedAt: number;
}

export interface LibraryCoreContentFetchPageResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID;
  readonly rows: readonly LibraryCoreContentFetchCandidateV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS =
  LIBRARY_CORE_CONTENT_FETCH_PAGE_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_CONTENT_FETCH_PAGE_RESPONSE_SCHEMA.canonicalKeys;
const ROW_KEYS = LIBRARY_CORE_CONTENT_FETCH_PAGE_PROJECTION.selectedFields;
const textEncoder = new TextEncoder();
const FILTER_DIGEST = new LibraryCoreSha256()
  .update(
    textEncoder.encode(
      JSON.stringify({
        queryId: LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID,
        schemaVersion: LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION,
      }),
    ),
  )
  .digestLowerHex() as LibraryCoreLowercaseHex64;

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ error, ok: false });
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
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

function safeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function encodeLibraryCoreContentFetchPageCursorV1(input: {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly globalId: LibraryCoreEntityId;
  readonly projectionRevision: number;
  readonly publishedAt: number;
  readonly transitionSequence: number;
}): string {
  return encodeLibraryCoreFeedBrowsePageCursorV2({
    filterDigest: FILTER_DIGEST,
    generationId: input.generationId,
    globalId: input.globalId,
    priority: 0,
    projectionRevision: input.projectionRevision,
    publishedAt: input.publishedAt,
    transitionSequence: input.transitionSequence,
  });
}

export function decodeLibraryCoreContentFetchPageCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<{
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly globalId: LibraryCoreEntityId;
  readonly projectionRevision: number;
  readonly publishedAt: number;
  readonly transitionSequence: number;
}> {
  const decoded = decodeLibraryCoreFeedBrowsePageCursorV2(value);
  if (
    !decoded.ok ||
    decoded.value.filterDigest !== FILTER_DIGEST ||
    decoded.value.priority !== 0
  ) {
    return failure("content fetch cursor is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      generationId: decoded.value.generationId,
      globalId: decoded.value.globalId,
      projectionRevision: decoded.value.projectionRevision,
      publishedAt: decoded.value.publishedAt,
      transitionSequence: decoded.value.transitionSequence,
    }),
  });
}

export function parseLibraryCoreContentFetchPageRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreContentFetchPageRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(record.cancellationId) ||
    !isLibraryCoreOperationInstanceId(record.readerSessionId) ||
    !Number.isSafeInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) > LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_LIMIT ||
    (record.cursor !== null && typeof record.cursor !== "string") ||
    (record.cursor !== null &&
      !decodeLibraryCoreContentFetchPageCursorV1(record.cursor).ok)
  ) {
    return failure("content fetch request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      cancellationId: record.cancellationId,
      cursor: record.cursor,
      limit: record.limit,
      queryId: LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID,
      readerSessionId: record.readerSessionId,
      schemaVersion: LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION,
    }) as LibraryCoreContentFetchPageRequestV1,
  });
}

function parseRow(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreContentFetchCandidateV1> {
  const row = closedRecord(value, ROW_KEYS);
  if (
    !row ||
    !safeTime(row.capturedAt) ||
    typeof row.globalId !== "string" ||
    row.globalId.length === 0 ||
    textEncoder.encode(row.globalId).byteLength > 4_096 ||
    typeof row.linkUrl !== "string" ||
    row.linkUrl.length === 0 ||
    textEncoder.encode(row.linkUrl).byteLength > 8_192 ||
    !safeTime(row.publishedAt)
  ) {
    return failure("content fetch row is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      capturedAt: row.capturedAt,
      globalId: row.globalId,
      linkUrl: row.linkUrl,
      publishedAt: row.publishedAt,
    }) as LibraryCoreContentFetchCandidateV1,
  });
}

export function parseLibraryCoreContentFetchPageResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreContentFetchPageResponseV1> {
  const request = parseLibraryCoreContentFetchPageRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION ||
    !Array.isArray(record.rows) ||
    record.rows.length > request.value.limit ||
    (record.nextCursor !== null && typeof record.nextCursor !== "string")
  ) {
    return failure("content fetch response is invalid");
  }
  const rows: LibraryCoreContentFetchCandidateV1[] = [];
  for (const candidate of record.rows) {
    const row = parseRow(candidate);
    if (!row.ok) return row;
    const previous = rows.at(-1);
    if (
      previous &&
      (previous.publishedAt < row.value.publishedAt ||
        (previous.publishedAt === row.value.publishedAt &&
          previous.globalId >= row.value.globalId))
    ) {
      return failure("content fetch rows are not in stable order");
    }
    rows.push(row.value);
  }
  if (record.nextCursor !== null) {
    const cursor = decodeLibraryCoreContentFetchPageCursorV1(record.nextCursor);
    const last = rows.at(-1);
    if (
      !cursor.ok ||
      !last ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.projectionRevision !== source.value.projectionRevision ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.publishedAt !== last.publishedAt ||
      cursor.value.globalId !== last.globalId
    ) {
      return failure("content fetch cursor does not bind the final row");
    }
  }
  const response = Object.freeze({
    nextCursor: record.nextCursor as string | null,
    queryId: LIBRARY_CORE_CONTENT_FETCH_PAGE_QUERY_ID,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_CONTENT_FETCH_PAGE_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_CONTENT_FETCH_PAGE_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("content fetch response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
