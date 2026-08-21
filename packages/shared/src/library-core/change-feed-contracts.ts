import {
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageCursorV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreEntityId,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEntityId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_CHANGE_FEED_QUERY_ID = "change_feed_v1" as const;
export const LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT = 512;
export const LIBRARY_CORE_CHANGE_FEED_MAXIMUM_RESPONSE_BYTES = 2 * 1_048_576;
export const LIBRARY_CORE_CHANGE_FEED_MAXIMUM_TOPIC_BYTES = 128;
export const LIBRARY_CORE_CHANGE_FEED_MAXIMUM_ENTITY_ID_BYTES = 2_048;

export const LIBRARY_CORE_CHANGE_FEED_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_change_feed_request_v1",
  schemaVersion: LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_CHANGE_FEED_QUERY_ID,
  canonicalKeys: Object.freeze([
    "afterRevision",
    "cancellationId",
    "cursor",
    "limit",
    "queryId",
    "readerSessionId",
    "schemaVersion",
  ]),
  cursorCodec: "library_core_change_feed_cursor_v1",
  maximumLimit: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
  cancellable: true,
});

export const LIBRARY_CORE_CHANGE_FEED_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_change_feed_response_v1",
  schemaVersion: LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_CHANGE_FEED_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "schemaVersion",
    "source",
  ]),
  maximumRows: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_CHANGE_FEED_PROJECTION = Object.freeze({
  projectionId: "library_core_change_feed_v1",
  sourceTable: "library_invalidations",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["revision", "ordinal"]),
});

export const LIBRARY_CORE_CHANGE_FEED_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_change_feed_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "pinned_upper_revision",
  projectionRevision: "pinned_upper_revision",
  sessionPinned: true,
});

export const LIBRARY_CORE_CHANGE_FEED_NESTED_BOUNDS = Object.freeze({
  rows: Object.freeze({
    maximumItems: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT,
    maximumTopicUtf8Bytes: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_TOPIC_BYTES,
    maximumEntityIdUtf8Bytes: LIBRARY_CORE_CHANGE_FEED_MAXIMUM_ENTITY_ID_BYTES,
  }),
});

export interface LibraryCoreChangeFeedRequestV1 {
  readonly afterRevision: number;
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_CHANGE_FEED_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: typeof LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION;
}

export interface LibraryCoreChangeFeedRowV1 {
  readonly entityId: LibraryCoreEntityId | null;
  readonly ordinal: number;
  readonly resetRequired: boolean;
  readonly revision: number;
  readonly topic: string;
}

export interface LibraryCoreChangeFeedResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_CHANGE_FEED_QUERY_ID;
  readonly rows: readonly LibraryCoreChangeFeedRowV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

export interface LibraryCoreChangeFeedCursorV1 {
  readonly afterRevision: number;
  readonly generationId: LibraryCoreFeedPageCursorV1["generationId"];
  readonly ordinal: number;
  readonly revision: number;
  readonly upperRevision: number;
}

const textEncoder = new TextEncoder();
const REQUEST_KEYS = LIBRARY_CORE_CHANGE_FEED_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS = LIBRARY_CORE_CHANGE_FEED_RESPONSE_SCHEMA.canonicalKeys;
const ROW_KEYS = Object.freeze([
  "entityId",
  "ordinal",
  "resetRequired",
  "revision",
  "topic",
]);

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
    isLibraryCoreEntityId(value) &&
    textEncoder.encode(value).byteLength <= maximumBytes
  );
}

export function encodeLibraryCoreChangeFeedCursorV1(
  cursor: LibraryCoreChangeFeedCursorV1,
): string {
  if (
    !isLibraryCoreNonnegativeSafeInteger(cursor.afterRevision) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.upperRevision) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.revision) ||
    !Number.isSafeInteger(cursor.ordinal) ||
    cursor.ordinal < 0 ||
    cursor.ordinal > 255 ||
    cursor.afterRevision > cursor.revision ||
    cursor.revision > cursor.upperRevision
  ) {
    throw new TypeError("invalid Library Core change-feed cursor");
  }
  return encodeLibraryCoreFeedPageCursorV1({
    generationId: cursor.generationId,
    globalId: String(cursor.ordinal) as LibraryCoreEntityId,
    projectionRevision: cursor.afterRevision,
    sortAt: cursor.revision,
    transitionSequence: cursor.upperRevision,
  });
}

export function decodeLibraryCoreChangeFeedCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreChangeFeedCursorV1> {
  const decoded = decodeLibraryCoreFeedPageCursorV1(value);
  if (!decoded.ok || !/^(0|[1-9][0-9]{0,2})$/.test(decoded.value.globalId)) {
    return failure("change-feed cursor is invalid");
  }
  const ordinal = Number(decoded.value.globalId);
  if (
    ordinal > 255 ||
    decoded.value.projectionRevision > decoded.value.sortAt ||
    decoded.value.sortAt > decoded.value.transitionSequence
  ) {
    return failure("change-feed cursor is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      afterRevision: decoded.value.projectionRevision,
      generationId: decoded.value.generationId,
      ordinal,
      revision: decoded.value.sortAt,
      upperRevision: decoded.value.transitionSequence,
    }),
  });
}

export function parseLibraryCoreChangeFeedRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreChangeFeedRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_CHANGE_FEED_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION ||
    !isLibraryCoreNonnegativeSafeInteger(record.afterRevision) ||
    !isLibraryCoreOperationInstanceId(record.cancellationId) ||
    !isLibraryCoreOperationInstanceId(record.readerSessionId) ||
    !Number.isSafeInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) > LIBRARY_CORE_CHANGE_FEED_MAXIMUM_LIMIT ||
    (record.cursor !== null && typeof record.cursor !== "string")
  ) {
    return failure("change-feed request is invalid");
  }
  if (record.cursor !== null) {
    const cursor = decodeLibraryCoreChangeFeedCursorV1(record.cursor);
    if (!cursor.ok || cursor.value.afterRevision !== record.afterRevision) {
      return failure("change-feed request cursor is invalid");
    }
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      afterRevision: record.afterRevision,
      cancellationId: record.cancellationId,
      cursor: record.cursor,
      limit: record.limit,
      queryId: LIBRARY_CORE_CHANGE_FEED_QUERY_ID,
      readerSessionId: record.readerSessionId,
      schemaVersion: LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION,
    }) as LibraryCoreChangeFeedRequestV1,
  });
}

function parseRow(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreChangeFeedRowV1> {
  const row = closedRecord(value, ROW_KEYS);
  if (
    !row ||
    !isLibraryCoreNonnegativeSafeInteger(row.revision) ||
    (row.revision as number) < 1 ||
    !Number.isSafeInteger(row.ordinal) ||
    (row.ordinal as number) < 0 ||
    (row.ordinal as number) > 255 ||
    !boundedText(row.topic, LIBRARY_CORE_CHANGE_FEED_MAXIMUM_TOPIC_BYTES) ||
    (row.entityId !== null &&
      !boundedText(
        row.entityId,
        LIBRARY_CORE_CHANGE_FEED_MAXIMUM_ENTITY_ID_BYTES,
      )) ||
    typeof row.resetRequired !== "boolean"
  ) {
    return failure("change-feed row is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      entityId: row.entityId,
      ordinal: row.ordinal,
      resetRequired: row.resetRequired,
      revision: row.revision,
      topic: row.topic,
    }) as LibraryCoreChangeFeedRowV1,
  });
}

export function parseLibraryCoreChangeFeedResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreChangeFeedResponseV1> {
  const request = parseLibraryCoreChangeFeedRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_CHANGE_FEED_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION ||
    source.value.projectionRevision !== source.value.transitionSequence ||
    source.value.projectionRevision < request.value.afterRevision ||
    !Array.isArray(record.rows) ||
    record.rows.length > request.value.limit ||
    (record.nextCursor !== null && typeof record.nextCursor !== "string")
  ) {
    return failure("change-feed response is invalid");
  }
  const requestCursor =
    request.value.cursor === null
      ? null
      : decodeLibraryCoreChangeFeedCursorV1(request.value.cursor);
  if (requestCursor && !requestCursor.ok) return failure(requestCursor.error);
  const pinnedUpper = requestCursor?.value.upperRevision;
  if (
    (pinnedUpper !== undefined &&
      (pinnedUpper !== source.value.projectionRevision ||
        requestCursor?.value.generationId !== source.value.generationId)) ||
    (pinnedUpper === undefined &&
      source.value.projectionRevision < request.value.afterRevision)
  ) {
    return failure("change-feed response source does not match its cursor");
  }
  const rows: LibraryCoreChangeFeedRowV1[] = [];
  let previousRevision =
    requestCursor?.value.revision ?? request.value.afterRevision;
  let previousOrdinal = requestCursor?.value.ordinal ?? 255;
  for (const candidate of record.rows) {
    const row = parseRow(candidate);
    if (!row.ok) return failure(row.error);
    if (
      row.value.revision > source.value.projectionRevision ||
      row.value.revision < previousRevision ||
      (row.value.revision === previousRevision &&
        row.value.ordinal <= previousOrdinal)
    ) {
      return failure("change-feed rows are outside their pinned order");
    }
    if (row.value.revision > previousRevision + 1 && !row.value.resetRequired) {
      return failure("change-feed rows contain an uncovered revision gap");
    }
    rows.push(row.value);
    previousRevision = row.value.revision;
    previousOrdinal = row.value.ordinal;
  }
  if (record.nextCursor !== null) {
    const cursor = decodeLibraryCoreChangeFeedCursorV1(record.nextCursor);
    const last = rows.at(-1);
    if (
      !cursor.ok ||
      !last ||
      cursor.value.afterRevision !== request.value.afterRevision ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.upperRevision !== source.value.projectionRevision ||
      cursor.value.revision !== last.revision ||
      cursor.value.ordinal !== last.ordinal
    ) {
      return failure(
        "change-feed cursor does not bind the final row and source",
      );
    }
  } else if (
    request.value.afterRevision < source.value.projectionRevision &&
    rows.at(-1)?.revision !== source.value.projectionRevision
  ) {
    return failure(
      "change-feed response does not reach its pinned upper bound",
    );
  }
  const response = Object.freeze({
    nextCursor: record.nextCursor as string | null,
    queryId: LIBRARY_CORE_CHANGE_FEED_QUERY_ID,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_CHANGE_FEED_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_CHANGE_FEED_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("change-feed response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
