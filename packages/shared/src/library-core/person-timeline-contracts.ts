import {
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageCursorV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreEntityId,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import { LibraryCoreSha256 } from "./sha256.js";

export const LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID =
  "person_timeline_v1" as const;
export const LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_PERSON_TIMELINE_DEFAULT_LIMIT = 50;
export const LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_LIMIT = 100;
export const LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_CURSOR_BYTES = 5_700;
export const LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;

export const LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_person_timeline_request_v1",
  schemaVersion: LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "limit",
    "personId",
    "queryId",
    "readerSessionId",
    "schemaVersion",
  ]),
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

export const LIBRARY_CORE_PERSON_TIMELINE_PROJECTION =
  LIBRARY_CORE_FEED_PAGE_PROJECTION;
export const LIBRARY_CORE_PERSON_TIMELINE_SOURCE_IDENTITY =
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY;
export const LIBRARY_CORE_PERSON_TIMELINE_NESTED_BOUNDS =
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS;

const REQUEST_KEYS = LIBRARY_CORE_PERSON_TIMELINE_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_PERSON_TIMELINE_RESPONSE_SCHEMA.canonicalKeys;
const textEncoder = new TextEncoder();

export interface LibraryCorePersonTimelineCursorV1 extends LibraryCoreFeedPageCursorV1 {
  readonly personDigest: LibraryCoreLowercaseHex64;
}

export interface LibraryCorePersonTimelineRequestV1 {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly personId: string;
  readonly queryId: typeof LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: typeof LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION;
}

export interface LibraryCorePersonTimelineResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID;
  readonly rows: readonly LibraryCoreFeedCardV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

function success<T>(value: T): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
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

export function libraryCorePersonTimelinePersonDigestV1(
  personId: string,
): LibraryCoreLowercaseHex64 {
  return new LibraryCoreSha256()
    .update(textEncoder.encode(personId))
    .digestLowerHex();
}

export function encodeLibraryCorePersonTimelineCursorV1(
  cursor: LibraryCorePersonTimelineCursorV1,
): string {
  if (!isLibraryCoreLowercaseHex64(cursor.personDigest)) {
    throw new TypeError("invalid Library Core person timeline identity digest");
  }
  return `1.${encodeLibraryCoreFeedPageCursorV1(cursor)}.${cursor.personDigest}`;
}

export function decodeLibraryCorePersonTimelineCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePersonTimelineCursorV1> {
  if (
    typeof value !== "string" ||
    value.length > LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_CURSOR_BYTES
  ) {
    return failure("person timeline cursor is invalid or unbounded");
  }
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "1" ||
    !isLibraryCoreLowercaseHex64(parts[2])
  ) {
    return failure("person timeline cursor has invalid encoding or version");
  }
  const pageCursor = decodeLibraryCoreFeedPageCursorV1(parts[1]);
  if (!pageCursor.ok) return failure(pageCursor.error);
  return success(
    Object.freeze({ ...pageCursor.value, personDigest: parts[2] }),
  );
}

export function parseLibraryCorePersonTimelineRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePersonTimelineRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS, "request");
  if (!record.ok) return record;
  const input = record.value;
  if (
    input.queryId !== LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(input.readerSessionId) ||
    !isLibraryCoreOperationInstanceId(input.cancellationId) ||
    !isLibraryCoreEntityId(input.personId) ||
    !isLibraryCoreNonnegativeSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_LIMIT ||
    (input.cursor !== null && typeof input.cursor !== "string")
  ) {
    return failure("request identity or bounds are invalid");
  }
  if (input.cursor !== null) {
    const cursor = decodeLibraryCorePersonTimelineCursorV1(input.cursor);
    if (!cursor.ok) return cursor;
    if (
      cursor.value.personDigest !==
      libraryCorePersonTimelinePersonDigestV1(input.personId)
    ) {
      return failure("request cursor belongs to a different person");
    }
  }
  return success(
    Object.freeze({
      cancellationId: input.cancellationId,
      cursor: input.cursor,
      limit: input.limit,
      personId: input.personId,
      queryId: LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID,
      readerSessionId: input.readerSessionId,
      schemaVersion: LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION,
    }),
  );
}

export function parseLibraryCorePersonTimelineResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePersonTimelineResponseV1> {
  const request = parseLibraryCorePersonTimelineRequestV1(requestValue);
  if (!request.ok)
    return failure(`response request is invalid: ${request.error}`);
  const record = closedRecord(value, RESPONSE_KEYS, "response");
  if (!record.ok) return record;
  const input = record.value;
  const inputRows = input.rows;
  if (
    input.queryId !== LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION ||
    !isLibraryCoreNonnegativeSafeInteger(input.totalCount) ||
    !Array.isArray(inputRows) ||
    inputRows.length > request.value.limit ||
    (input.nextCursor !== null && typeof input.nextCursor !== "string")
  )
    return failure("response identity or top-level bounds are invalid");
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return source;
  const personDigest = libraryCorePersonTimelinePersonDigestV1(
    request.value.personId,
  );
  for (const cursorValue of [request.value.cursor, input.nextCursor]) {
    if (cursorValue === null) continue;
    const cursor = decodeLibraryCorePersonTimelineCursorV1(cursorValue);
    if (
      !cursor.ok ||
      cursor.value.personDigest !== personDigest ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.projectionRevision !== source.value.projectionRevision
    ) {
      return failure("response cursor does not match its source and person");
    }
  }
  const rows: LibraryCoreFeedCardV1[] = [];
  for (let index = 0; index < inputRows.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      inputRows,
      String(index),
    );
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      return failure("response rows must be one dense data array");
    const row = parseLibraryCoreFeedCardV1(descriptor.value);
    if (!row.ok) return row;
    rows.push(row.value);
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
    return failure("response rows contain decorated or sparse entries");
  }
  if (input.nextCursor !== null) {
    const cursor = decodeLibraryCorePersonTimelineCursorV1(input.nextCursor);
    const finalRow = rows.at(-1);
    if (
      !cursor.ok ||
      !finalRow ||
      cursor.value.globalId !== finalRow.globalId ||
      cursor.value.sortAt !== finalRow.publishedAt
    ) {
      return failure("next cursor does not bind the final timeline row");
    }
  }
  if (input.totalCount < rows.length)
    return failure("response total count is smaller than its returned rows");
  const response = Object.freeze({
    nextCursor: input.nextCursor,
    queryId: LIBRARY_CORE_PERSON_TIMELINE_QUERY_ID,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_PERSON_TIMELINE_SCHEMA_VERSION,
    source: source.value,
    totalCount: input.totalCount,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).length >
    LIBRARY_CORE_PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("response exceeds the person timeline byte ceiling");
  }
  return success(response);
}
