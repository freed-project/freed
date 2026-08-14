import type { FeedItem, SavedContentSortMode } from "../types.js";
import {
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseFilterV1,
} from "./feed-browse-filter-contract.js";
import {
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  projectLibraryCoreFeedCardV1,
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

export const LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID =
  "saved_feed_page_v1" as const;
export const LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_SAVED_FEED_PAGE_DEFAULT_LIMIT = 64;
export const LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT =
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT;
export const LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_RESPONSE_BYTES =
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES;
export const LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_CURSOR_BYTES = 5_564;
export const LIBRARY_CORE_SAVED_FEED_SORT_ORDER_SCHEMA_VERSION = 1 as const;

/**
 * The first native Saved ordering contract is an intentional Gate D order,
 * not a claim that SQLite reproduces the legacy stable-sort input sequence.
 * Every mode is total without retaining that corpus-sized sequence.
 */
export const LIBRARY_CORE_SAVED_FEED_SORT_ORDER_V1 = Object.freeze({
  schemaId: "library_core_saved_feed_sort_order_v1",
  schemaVersion: LIBRARY_CORE_SAVED_FEED_SORT_ORDER_SCHEMA_VERSION,
  generationDomain: "freed-desktop-library-core-saved-feed-generation-v1",
  recommendationPriority: "calculatePriority_at_pinned_rankingClockMs",
  orders: Object.freeze({
    date_saved: Object.freeze([
      "savedAt_or_capturedAt_desc",
      "globalId_binary_asc",
    ]),
    date_published: Object.freeze([
      "publishedAt_or_capturedAt_desc",
      "globalId_binary_asc",
    ]),
    recommended: Object.freeze([
      "recalculatedPriority_desc",
      "rawPublishedAt_desc",
      "globalId_binary_asc",
    ]),
    shortest_read: Object.freeze([
      "finite_before_missing",
      "readingTime_asc",
      "globalId_binary_asc",
    ]),
  }),
  physicalOrder: Object.freeze([
    "sortGroup_desc",
    "sortPrimary_desc",
    "sortSecondary_asc",
    "globalId_binary_asc",
  ]),
});

export const LIBRARY_CORE_SAVED_FEED_SORT_MODES = Object.freeze([
  "date_saved",
  "date_published",
  "recommended",
  "shortest_read",
] as const satisfies readonly SavedContentSortMode[]);

export const LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_saved_feed_page_request_v1",
  schemaVersion: LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "filter",
    "limit",
    "queryId",
    "rankingClockMs",
    "readerSessionId",
    "schemaVersion",
    "sortMode",
  ]),
  cursorCodec: "library_core_saved_feed_page_cursor_v1",
  maximumLimit: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT,
  maximumCursorBytes: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_CURSOR_BYTES,
});

export const LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_saved_feed_page_response_v1",
  schemaVersion: LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "filter",
    "nextCursor",
    "queryId",
    "rankingClockMs",
    "rows",
    "schemaVersion",
    "sortMode",
    "source",
    "totalCount",
  ]),
  maximumRows: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_SAVED_FEED_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_saved_feed_card_v1",
  // The Saved reader uses its own generation root, but deliberately reuses
  // the bounded browse store's physical row schema.
  sourceTable: "feed_browse_rows",
  fullContentAllowed: false,
  orderedColumns: Object.freeze([
    "sortGroup",
    "sortPrimary",
    "sortSecondary",
    "globalId",
  ]),
  savedAtFallback: "capturedAt",
  shortestReadMissingOrder: "after_finite",
  tieBreak: "globalId_binary_asc",
});

export const LIBRARY_CORE_SAVED_FEED_PAGE_SOURCE_IDENTITY =
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY;
export const LIBRARY_CORE_SAVED_FEED_PAGE_NESTED_BOUNDS =
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS;

export interface LibraryCoreSavedFeedPageCursorV1 {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly transitionSequence: number;
  readonly projectionRevision: number;
  readonly sortMode: SavedContentSortMode;
  readonly sortGroup: number;
  readonly sortPrimary: number;
  readonly sortSecondary: number;
  readonly globalId: LibraryCoreEntityId;
}

export interface LibraryCoreSavedFeedPageRequestV1 {
  readonly cancellationId: LibraryCoreOperationInstanceId;
  readonly cursor: string | null;
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID;
  readonly rankingClockMs: number;
  readonly readerSessionId: LibraryCoreOperationInstanceId;
  readonly schemaVersion: typeof LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION;
  readonly sortMode: SavedContentSortMode;
}

export interface LibraryCoreSavedFeedCardV1 extends LibraryCoreFeedCardV1 {
  readonly savedAt: number | null;
}

export interface LibraryCoreSavedFeedPageResponseV1 {
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID;
  readonly rankingClockMs: number;
  readonly rows: readonly LibraryCoreSavedFeedCardV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION;
  readonly sortMode: SavedContentSortMode;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

export interface LibraryCoreSavedFeedSortKeyV1 {
  readonly sortGroup: number;
  readonly sortPrimary: number;
  readonly sortSecondary: number;
  readonly globalId: LibraryCoreEntityId;
}

const SORT_MODE_CODE: Readonly<Record<SavedContentSortMode, number>> =
  Object.freeze({
    date_saved: 0,
    date_published: 1,
    recommended: 2,
    shortest_read: 3,
  });
const SORT_MODE_FROM_CODE = LIBRARY_CORE_SAVED_FEED_SORT_MODES;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUE = new Map(
  Array.from(BASE64URL_ALPHABET, (character, index) => [character, index]),
);
const CURSOR_VERSION = 1;
const CURSOR_FIXED_BYTES = 69;
const TEXT_ENCODER = new TextEncoder();
const FATAL_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const REQUEST_KEYS = LIBRARY_CORE_SAVED_FEED_PAGE_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_SAVED_FEED_PAGE_RESPONSE_SCHEMA.canonicalKeys;

function success<T>(value: T): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function snapshotClosedRecord(
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

function isSavedContentSortMode(value: unknown): value is SavedContentSortMode {
  return LIBRARY_CORE_SAVED_FEED_SORT_MODES.includes(
    value as SavedContentSortMode,
  );
}

function requiredTimestamp(value: number, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) {
    throw new TypeError(`invalid Saved ${label}`);
  }
  return value;
}

/**
 * Encode the four current Saved orders into the three indexed integer columns
 * used by the query-specific SQLite generation. The database orders group and
 * primary descending, secondary ascending, then globalId using BINARY ASC.
 */
export function libraryCoreSavedFeedSortKeyV1(
  item: FeedItem,
  sortMode: SavedContentSortMode,
  recommendationPriority: number,
): LibraryCoreSavedFeedSortKeyV1 {
  if (!isLibraryCoreEntityId(item.globalId)) {
    throw new TypeError("invalid Saved item identity");
  }
  const capturedAt = requiredTimestamp(item.capturedAt, "capturedAt");
  const savedAt =
    item.userState.savedAt === undefined
      ? capturedAt
      : requiredTimestamp(item.userState.savedAt, "savedAt");
  const rawPublishedAt = requiredTimestamp(item.publishedAt, "publishedAt");
  const publishedAt = rawPublishedAt === 0 ? capturedAt : rawPublishedAt;
  if (sortMode === "date_saved") {
    return Object.freeze({
      sortGroup: 0,
      sortPrimary: savedAt,
      sortSecondary: 0,
      globalId: item.globalId,
    });
  }
  if (sortMode === "date_published") {
    return Object.freeze({
      sortGroup: 0,
      sortPrimary: publishedAt,
      sortSecondary: 0,
      globalId: item.globalId,
    });
  }
  if (sortMode === "recommended") {
    if (
      !isLibraryCoreNonnegativeSafeInteger(recommendationPriority) ||
      recommendationPriority > 100
    ) {
      throw new TypeError("invalid Saved recommendation priority");
    }
    return Object.freeze({
      sortGroup: recommendationPriority,
      sortPrimary: rawPublishedAt,
      sortSecondary: 0,
      globalId: item.globalId,
    });
  }
  if (sortMode !== "shortest_read") {
    throw new TypeError("invalid Saved sort mode");
  }
  const readingTime = item.preservedContent?.readingTime;
  const hasFiniteReadingTime = isLibraryCoreNonnegativeSafeInteger(readingTime);
  return Object.freeze({
    sortGroup: hasFiniteReadingTime ? 1 : 0,
    sortPrimary: hasFiniteReadingTime
      ? Number.MAX_SAFE_INTEGER - readingTime
      : 0,
    sortSecondary: 0,
    globalId: item.globalId,
  });
}

export function compareLibraryCoreSavedFeedSortKeyV1(
  left: LibraryCoreSavedFeedSortKeyV1,
  right: LibraryCoreSavedFeedSortKeyV1,
): number {
  return (
    right.sortGroup - left.sortGroup ||
    right.sortPrimary - left.sortPrimary ||
    left.sortSecondary - right.sortSecondary ||
    (left.globalId < right.globalId
      ? -1
      : left.globalId > right.globalId
        ? 1
        : 0)
  );
}

function lowerHexToBytes(value: LibraryCoreLowercaseHex64): Uint8Array {
  const bytes = new Uint8Array(32);
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
    value.length > LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_CURSOR_BYTES ||
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

export function encodeLibraryCoreSavedFeedPageCursorV1(
  cursor: LibraryCoreSavedFeedPageCursorV1,
): string {
  if (
    !isLibraryCoreLowercaseHex64(cursor.generationId) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.transitionSequence) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.projectionRevision) ||
    !isSavedContentSortMode(cursor.sortMode) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.sortGroup) ||
    cursor.sortGroup > 100 ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.sortPrimary) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.sortSecondary) ||
    !isLibraryCoreEntityId(cursor.globalId)
  ) {
    throw new TypeError("invalid Library Core saved-feed cursor");
  }
  const globalId = TEXT_ENCODER.encode(cursor.globalId);
  const bytes = new Uint8Array(CURSOR_FIXED_BYTES + globalId.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = CURSOR_VERSION;
  bytes[1] = SORT_MODE_CODE[cursor.sortMode];
  bytes.set(lowerHexToBytes(cursor.generationId), 2);
  view.setBigUint64(34, BigInt(cursor.transitionSequence), false);
  view.setBigUint64(42, BigInt(cursor.projectionRevision), false);
  bytes[50] = cursor.sortGroup;
  view.setBigUint64(51, BigInt(cursor.sortPrimary), false);
  view.setBigUint64(59, BigInt(cursor.sortSecondary), false);
  view.setUint16(67, globalId.length, false);
  bytes.set(globalId, CURSOR_FIXED_BYTES);
  return encodeBase64Url(bytes);
}

export function decodeLibraryCoreSavedFeedPageCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSavedFeedPageCursorV1> {
  if (typeof value !== "string") return failure("cursor must be a string");
  const bytes = decodeBase64Url(value);
  if (
    !bytes ||
    bytes.length < CURSOR_FIXED_BYTES ||
    bytes[0] !== CURSOR_VERSION ||
    bytes[1]! >= SORT_MODE_FROM_CODE.length
  ) {
    return failure("cursor has invalid encoding, sort, or version");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const globalIdLength = view.getUint16(67, false);
  if (bytes.length !== CURSOR_FIXED_BYTES + globalIdLength) {
    return failure("cursor length does not match its entity identity");
  }
  const transitionSequence = view.getBigUint64(34, false);
  const projectionRevision = view.getBigUint64(42, false);
  const sortPrimary = view.getBigUint64(51, false);
  const sortSecondary = view.getBigUint64(59, false);
  if (
    [transitionSequence, projectionRevision, sortPrimary, sortSecondary].some(
      (entry) => entry > BigInt(Number.MAX_SAFE_INTEGER),
    )
  ) {
    return failure("cursor contains an unsafe integer");
  }
  let globalId: string;
  try {
    globalId = FATAL_TEXT_DECODER.decode(bytes.subarray(CURSOR_FIXED_BYTES));
  } catch {
    return failure("cursor entity identity is not valid UTF-8");
  }
  const generationId = bytesToLowerHex(bytes.subarray(2, 34));
  if (
    !isLibraryCoreLowercaseHex64(generationId) ||
    !isLibraryCoreEntityId(globalId) ||
    bytes[50]! > 100
  ) {
    return failure("cursor identity or sort key is invalid");
  }
  return success(
    Object.freeze({
      generationId,
      transitionSequence: Number(transitionSequence),
      projectionRevision: Number(projectionRevision),
      sortMode: SORT_MODE_FROM_CODE[bytes[1]!]!,
      sortGroup: bytes[50]!,
      sortPrimary: Number(sortPrimary),
      sortSecondary: Number(sortSecondary),
      globalId,
    }),
  );
}

export function projectLibraryCoreSavedFeedCardV1(
  item: FeedItem,
): LibraryCoreSavedFeedCardV1 {
  const card = projectLibraryCoreFeedCardV1(item);
  const savedAt =
    Number.isSafeInteger(item.userState.savedAt) &&
    (item.userState.savedAt ?? -1) >= 0
      ? item.userState.savedAt!
      : null;
  const projected = Object.freeze({ ...card, savedAt });
  const parsed = parseLibraryCoreSavedFeedCardV1(projected);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return parsed.value;
}

export function parseLibraryCoreSavedFeedCardV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSavedFeedCardV1> {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return failure("saved feed card must be one plain record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const savedAtDescriptor = descriptors.savedAt;
  if (
    !savedAtDescriptor ||
    !savedAtDescriptor.enumerable ||
    !("value" in savedAtDescriptor) ||
    (savedAtDescriptor.value !== null &&
      !isLibraryCoreNonnegativeSafeInteger(savedAtDescriptor.value))
  ) {
    return failure("saved feed card has invalid savedAt");
  }
  const baseEntries = Object.entries(descriptors)
    .filter(([key]) => key !== "savedAt")
    .map(([key, descriptor]) => {
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return null;
      }
      return [key, descriptor.value] as const;
    });
  if (baseEntries.some((entry) => entry === null)) {
    return failure("saved feed card fields must be enumerable data properties");
  }
  const base = parseLibraryCoreFeedCardV1(
    Object.fromEntries(baseEntries as readonly (readonly [string, unknown])[]),
  );
  if (!base.ok) return failure(base.error);
  if (base.value.saved !== true) {
    return failure("saved feed card must represent a saved item");
  }
  return success(
    Object.freeze({
      ...base.value,
      savedAt: savedAtDescriptor.value as number | null,
    }),
  );
}

export function parseLibraryCoreSavedFeedPageRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSavedFeedPageRequestV1> {
  const record = snapshotClosedRecord(value, REQUEST_KEYS, "request");
  if (!record.ok) return record;
  const input = record.value;
  if (
    input.queryId !== LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(input.readerSessionId) ||
    !isLibraryCoreOperationInstanceId(input.cancellationId) ||
    !isLibraryCoreNonnegativeSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT ||
    !isLibraryCoreNonnegativeSafeInteger(input.rankingClockMs) ||
    !isSavedContentSortMode(input.sortMode)
  ) {
    return failure("request identity or bounds are invalid");
  }
  if (input.cursor !== null && typeof input.cursor !== "string") {
    return failure("request cursor must be null or a string");
  }
  if (typeof input.cursor === "string") {
    const cursor = decodeLibraryCoreSavedFeedPageCursorV1(input.cursor);
    if (!cursor.ok || cursor.value.sortMode !== input.sortMode) {
      return failure(cursor.ok ? "request cursor sort is stale" : cursor.error);
    }
  }
  const filter = parseLibraryCoreFeedBrowseFilterV1(input.filter);
  if (!filter.ok || !filter.value.savedOnly || filter.value.showHidden) {
    return failure(
      filter.ok
        ? "saved feed filter must require saved visible items"
        : filter.error,
    );
  }
  return success(
    Object.freeze({
      cancellationId: input.cancellationId,
      cursor: input.cursor as string | null,
      filter: filter.value,
      limit: input.limit,
      queryId: LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID,
      rankingClockMs: input.rankingClockMs,
      readerSessionId: input.readerSessionId,
      schemaVersion: LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION,
      sortMode: input.sortMode,
    }),
  );
}

export function parseLibraryCoreSavedFeedPageResponseV1(
  value: unknown,
  request?: LibraryCoreSavedFeedPageRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreSavedFeedPageResponseV1> {
  const record = snapshotClosedRecord(value, RESPONSE_KEYS, "response");
  if (!record.ok) return record;
  const input = record.value;
  if (
    input.queryId !== LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION ||
    !isLibraryCoreNonnegativeSafeInteger(input.rankingClockMs) ||
    !isLibraryCoreNonnegativeSafeInteger(input.totalCount) ||
    !isSavedContentSortMode(input.sortMode) ||
    (input.nextCursor !== null && typeof input.nextCursor !== "string") ||
    !Array.isArray(input.rows) ||
    input.rows.length > LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT
  ) {
    return failure("response identity or bounds are invalid");
  }
  const filter = parseLibraryCoreFeedBrowseFilterV1(input.filter);
  if (!filter.ok || !filter.value.savedOnly || filter.value.showHidden) {
    return failure(filter.ok ? "response filter is invalid" : filter.error);
  }
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return failure(source.error);
  const rows: LibraryCoreSavedFeedCardV1[] = [];
  for (const row of input.rows) {
    const parsed = parseLibraryCoreSavedFeedCardV1(row);
    if (!parsed.ok) return failure(parsed.error);
    rows.push(parsed.value);
  }
  if (typeof input.nextCursor === "string") {
    const cursor = decodeLibraryCoreSavedFeedPageCursorV1(input.nextCursor);
    if (
      !cursor.ok ||
      cursor.value.sortMode !== input.sortMode ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.projectionRevision !== source.value.projectionRevision
    ) {
      return failure(cursor.ok ? "response cursor is stale" : cursor.error);
    }
  }
  if (
    request &&
    (request.sortMode !== input.sortMode ||
      request.rankingClockMs !== input.rankingClockMs ||
      JSON.stringify(request.filter) !== JSON.stringify(filter.value))
  ) {
    return failure("response does not match its request");
  }
  const response = Object.freeze({
    filter: filter.value,
    nextCursor: input.nextCursor as string | null,
    queryId: LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID,
    rankingClockMs: input.rankingClockMs,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION,
    sortMode: input.sortMode,
    source: source.value,
    totalCount: input.totalCount,
  });
  if (
    TEXT_ENCODER.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("response exceeds its byte ceiling");
  }
  return success(response);
}
