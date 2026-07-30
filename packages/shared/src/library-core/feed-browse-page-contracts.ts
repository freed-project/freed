import {
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseFilterV1,
} from "./feed-browse-filter-contract.js";
import {
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
} from "./feed-recommendation-order-contract.js";
import {
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreEntityId,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEntityId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID =
  "feed_browse_page_v1" as const;
export const LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_FEED_BROWSE_PAGE_MAXIMUM_CURSOR_BYTES = 5_560;

export const LIBRARY_CORE_FEED_BROWSE_PAGE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_feed_browse_page_request_v1",
  schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "filter",
    "limit",
    "queryId",
    "rankingClockMs",
    "readerSessionId",
    "recommendationOrderSchemaVersion",
    "schemaVersion",
  ]),
  cursorCodec: "library_core_feed_browse_page_cursor_v1",
  maximumLimit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  maximumCursorBytes: LIBRARY_CORE_FEED_BROWSE_PAGE_MAXIMUM_CURSOR_BYTES,
});

export const LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_feed_browse_page_response_v1",
  schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "filter",
    "nextCursor",
    "nextOrder",
    "queryId",
    "rankingClockMs",
    "recommendationOrderSchemaVersion",
    "rows",
    "schemaVersion",
    "source",
    "totalCount",
  ]),
  maximumRows: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_FEED_BROWSE_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_feed_card_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze([
    "priority",
    "publishedAt",
    "sourceSequence",
    "globalId",
  ]),
});

export interface LibraryCoreFeedBrowsePageCursorV1 {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly transitionSequence: number;
  readonly projectionRevision: number;
  readonly priority: number;
  readonly publishedAt: number;
  readonly sourceSequence: number;
  readonly globalId: LibraryCoreEntityId;
}

export interface LibraryCoreFeedBrowsePageRequestV1 {
  readonly cancellationId: LibraryCoreOperationInstanceId;
  readonly cursor: string | null;
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID;
  readonly rankingClockMs: number;
  readonly readerSessionId: LibraryCoreOperationInstanceId;
  readonly recommendationOrderSchemaVersion:
    typeof LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION;
  readonly schemaVersion: typeof LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION;
}

export interface LibraryCoreFeedBrowsePageResponseV1 {
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly nextCursor: string | null;
  readonly nextOrder: Readonly<{
    readonly globalId: LibraryCoreEntityId;
    readonly priority: number;
    readonly publishedAt: number;
    readonly sourceSequence: number;
  }> | null;
  readonly queryId: typeof LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID;
  readonly rankingClockMs: number;
  readonly recommendationOrderSchemaVersion:
    typeof LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION;
  readonly rows: readonly LibraryCoreFeedCardV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUE = new Map(
  Array.from(BASE64URL_ALPHABET, (character, index) => [character, index]),
);
const CURSOR_VERSION = 1;
const CURSOR_FIXED_BYTES = 68;
const TEXT_ENCODER = new TextEncoder();
const FATAL_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const REQUEST_KEYS = LIBRARY_CORE_FEED_BROWSE_PAGE_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_FEED_BROWSE_PAGE_RESPONSE_SCHEMA.canonicalKeys;
const NEXT_ORDER_KEYS = [
  "globalId",
  "priority",
  "publishedAt",
  "sourceSequence",
] as const;

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
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return failure(`${label} must be one plain record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) =>
      !descriptors[key]?.enumerable || !("value" in descriptors[key])
    )
  ) {
    return failure(`${label} fields do not match schema version 1`);
  }
  return success(
    Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value])),
  );
}

function lowerHexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToLowerHex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const packed =
      (bytes[index]! << 16) |
      ((bytes[index + 1] ?? 0) << 8) |
      (bytes[index + 2] ?? 0);
    output += BASE64URL_ALPHABET[(packed >>> 18) & 63];
    output += BASE64URL_ALPHABET[(packed >>> 12) & 63];
    if (remaining > 1) output += BASE64URL_ALPHABET[(packed >>> 6) & 63];
    if (remaining > 2) output += BASE64URL_ALPHABET[packed & 63];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length > LIBRARY_CORE_FEED_BROWSE_PAGE_MAXIMUM_CURSOR_BYTES ||
    value.length % 4 === 1
  ) {
    return null;
  }
  const output = new Uint8Array(Math.floor((value.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let outputIndex = 0;
  for (const character of value) {
    const decoded = BASE64URL_VALUE.get(character);
    if (decoded === undefined) return null;
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outputIndex] = (buffer >>> bits) & 0xff;
      outputIndex += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  if (
    (bits > 0 && buffer !== 0) ||
    outputIndex !== output.length ||
    encodeBase64Url(output) !== value
  ) {
    return null;
  }
  return output;
}

export function encodeLibraryCoreFeedBrowsePageCursorV1(
  cursor: LibraryCoreFeedBrowsePageCursorV1,
): string {
  if (
    !isLibraryCoreLowercaseHex64(cursor.generationId) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.transitionSequence) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.projectionRevision) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.priority) ||
    cursor.priority > 100 ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.publishedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.sourceSequence) ||
    !isLibraryCoreEntityId(cursor.globalId)
  ) {
    throw new TypeError("invalid Library Core feed-browse cursor");
  }
  const globalId = TEXT_ENCODER.encode(cursor.globalId);
  const bytes = new Uint8Array(CURSOR_FIXED_BYTES + globalId.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = CURSOR_VERSION;
  bytes.set(lowerHexToBytes(cursor.generationId), 1);
  view.setBigUint64(33, BigInt(cursor.transitionSequence), false);
  view.setBigUint64(41, BigInt(cursor.projectionRevision), false);
  bytes[49] = cursor.priority;
  view.setBigUint64(50, BigInt(cursor.publishedAt), false);
  view.setBigUint64(58, BigInt(cursor.sourceSequence), false);
  view.setUint16(66, globalId.length, false);
  bytes.set(globalId, CURSOR_FIXED_BYTES);
  return encodeBase64Url(bytes);
}

export function decodeLibraryCoreFeedBrowsePageCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedBrowsePageCursorV1> {
  if (typeof value !== "string") return failure("cursor must be a string");
  const bytes = decodeBase64Url(value);
  if (
    !bytes ||
    bytes.length < CURSOR_FIXED_BYTES ||
    bytes[0] !== CURSOR_VERSION
  ) {
    return failure("cursor has invalid encoding or version");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const globalIdLength = view.getUint16(66, false);
  if (bytes.length !== CURSOR_FIXED_BYTES + globalIdLength) {
    return failure("cursor length does not match its entity identity");
  }
  const generationId = bytesToLowerHex(bytes.subarray(1, 33));
  const transitionSequence = view.getBigUint64(33, false);
  const projectionRevision = view.getBigUint64(41, false);
  const priority = bytes[49]!;
  const publishedAt = view.getBigUint64(50, false);
  const sourceSequence = view.getBigUint64(58, false);
  if (
    transitionSequence > BigInt(Number.MAX_SAFE_INTEGER) ||
    projectionRevision > BigInt(Number.MAX_SAFE_INTEGER) ||
    publishedAt > BigInt(Number.MAX_SAFE_INTEGER) ||
    sourceSequence > BigInt(Number.MAX_SAFE_INTEGER) ||
    priority > 100
  ) {
    return failure("cursor contains an unsafe ordering value");
  }
  let globalId: string;
  try {
    globalId = FATAL_TEXT_DECODER.decode(bytes.subarray(CURSOR_FIXED_BYTES));
  } catch {
    return failure("cursor entity identity is not valid UTF-8");
  }
  if (
    !isLibraryCoreLowercaseHex64(generationId) ||
    !isLibraryCoreEntityId(globalId)
  ) {
    return failure("cursor identity is invalid");
  }
  return success(Object.freeze({
    generationId,
    transitionSequence: Number(transitionSequence),
    projectionRevision: Number(projectionRevision),
    priority,
    publishedAt: Number(publishedAt),
    sourceSequence: Number(sourceSequence),
    globalId,
  }));
}

export function parseLibraryCoreFeedBrowsePageRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedBrowsePageRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS, "browse request");
  if (!record.ok) return record;
  const input = record.value;
  const filter = parseLibraryCoreFeedBrowseFilterV1(input.filter);
  if (!filter.ok) return failure(filter.error);
  if (
    input.queryId !== LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION ||
    input.recommendationOrderSchemaVersion !==
      LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(input.readerSessionId) ||
    !isLibraryCoreOperationInstanceId(input.cancellationId) ||
    !isLibraryCoreNonnegativeSafeInteger(input.rankingClockMs) ||
    !isLibraryCoreNonnegativeSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT ||
    (input.cursor !== null && typeof input.cursor !== "string")
  ) {
    return failure("browse request identity or bounds are invalid");
  }
  if (input.cursor !== null) {
    const cursor = decodeLibraryCoreFeedBrowsePageCursorV1(input.cursor);
    if (!cursor.ok) return failure(cursor.error);
  }
  return success(Object.freeze({
    cancellationId: input.cancellationId,
    cursor: input.cursor,
    filter: filter.value,
    limit: input.limit,
    queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
    rankingClockMs: input.rankingClockMs,
    readerSessionId: input.readerSessionId,
    recommendationOrderSchemaVersion:
      LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
  }));
}

export function parseLibraryCoreFeedBrowsePageResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedBrowsePageResponseV1> {
  const request = parseLibraryCoreFeedBrowsePageRequestV1(requestValue);
  if (!request.ok) return failure(request.error);
  const record = closedRecord(value, RESPONSE_KEYS, "browse response");
  if (!record.ok) return record;
  const input = record.value;
  const filter = parseLibraryCoreFeedBrowseFilterV1(input.filter);
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!filter.ok) return failure(filter.error);
  if (!source.ok) return failure(source.error);
  if (
    input.queryId !== LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION ||
    input.recommendationOrderSchemaVersion !==
      LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION ||
    input.rankingClockMs !== request.value.rankingClockMs ||
    JSON.stringify(filter.value) !== JSON.stringify(request.value.filter) ||
    !isLibraryCoreNonnegativeSafeInteger(input.totalCount) ||
    !Array.isArray(input.rows) ||
    input.rows.length > request.value.limit
  ) {
    return failure("browse response identity or bounds are invalid");
  }
  const inputRows = input.rows;
  const rows: LibraryCoreFeedCardV1[] = [];
  let serializedRowsBytes = 0;
  for (let index = 0; index < inputRows.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      inputRows,
      String(index),
    );
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return failure("browse response rows must be one dense array");
    }
    const parsed = parseLibraryCoreFeedCardV1(descriptor.value);
    if (!parsed.ok) return failure(parsed.error);
    serializedRowsBytes += TEXT_ENCODER.encode(JSON.stringify(parsed.value))
      .length + (index > 0 ? 1 : 0);
    rows.push(parsed.value);
  }
  if (
    Reflect.ownKeys(inputRows).some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" ||
          !/^(0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= inputRows.length),
    ) ||
    input.totalCount < rows.length ||
    (input.nextCursor !== null && typeof input.nextCursor !== "string") ||
    (input.nextCursor === null) !== (input.nextOrder === null)
  ) {
    return failure("browse response rows or cursor are invalid");
  }
  let nextOrder: LibraryCoreFeedBrowsePageResponseV1["nextOrder"] = null;
  if (input.nextCursor !== null) {
    const cursor = decodeLibraryCoreFeedBrowsePageCursorV1(input.nextCursor);
    const finalRow = rows[rows.length - 1];
    const order = closedRecord(
      input.nextOrder,
      NEXT_ORDER_KEYS,
      "browse next order",
    );
    if (
      !cursor.ok ||
      !order.ok ||
      !finalRow ||
      !isLibraryCoreEntityId(order.value.globalId) ||
      !isLibraryCoreNonnegativeSafeInteger(order.value.priority) ||
      order.value.priority > 100 ||
      !isLibraryCoreNonnegativeSafeInteger(order.value.publishedAt) ||
      !isLibraryCoreNonnegativeSafeInteger(order.value.sourceSequence) ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.projectionRevision !== source.value.projectionRevision ||
      cursor.value.globalId !== finalRow.globalId ||
      cursor.value.globalId !== order.value.globalId ||
      cursor.value.priority !== order.value.priority ||
      cursor.value.publishedAt !== order.value.publishedAt ||
      cursor.value.sourceSequence !== order.value.sourceSequence
    ) {
      return failure(
        "browse next cursor does not bind its source, row, and order",
      );
    }
    nextOrder = Object.freeze({
      globalId: order.value.globalId,
      priority: order.value.priority,
      publishedAt: order.value.publishedAt,
      sourceSequence: order.value.sourceSequence,
    });
  }
  const response = Object.freeze({
    filter: filter.value,
    nextCursor: input.nextCursor,
    nextOrder,
    queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
    rankingClockMs: request.value.rankingClockMs,
    recommendationOrderSchemaVersion:
      LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
    source: source.value,
    totalCount: input.totalCount,
  });
  if (
    serializedRowsBytes +
      TEXT_ENCODER.encode(JSON.stringify({ ...response, rows: [] })).length >
        LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("browse response exceeds the feed-page byte ceiling");
  }
  return success(response);
}
