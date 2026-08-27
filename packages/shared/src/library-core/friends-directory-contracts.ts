import {
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEntityId,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import { sha256LowerHex } from "./sha256.js";
import {
  parseLibraryCoreGeneratedSqliteQueryRow,
  type LibraryCoreGeneratedSqliteQueryRow,
} from "./sqlite-contract.generated.js";

export const LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID =
  "friends_directory_page_v1" as const;
export const LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_FRIENDS_DIRECTORY_DEFAULT_LIMIT = 32;
export const LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_LIMIT = 64;
export const LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_RESPONSE_BYTES =
  512 * 1_024;
export const LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_SEARCH_BYTES = 1_024;
export const LIBRARY_CORE_FRIENDS_DIRECTORY_RECENT_WINDOW_MS =
  7 * 24 * 60 * 60 * 1_000;

export const LIBRARY_CORE_FRIENDS_DIRECTORY_FILTERS = Object.freeze([
  "close_friends",
  "has_location",
  "need_outreach",
  "no_contact",
  "recently_active",
] as const);
export const LIBRARY_CORE_FRIENDS_DIRECTORY_SORTS = Object.freeze([
  "care_level",
  "last_contact",
  "name",
  "recent_activity",
] as const);

export type LibraryCoreFriendsDirectoryFilterV1 =
  (typeof LIBRARY_CORE_FRIENDS_DIRECTORY_FILTERS)[number];
export type LibraryCoreFriendsDirectorySortV1 =
  (typeof LIBRARY_CORE_FRIENDS_DIRECTORY_SORTS)[number];

const FILTER_SET = new Set<string>(LIBRARY_CORE_FRIENDS_DIRECTORY_FILTERS);
const SORT_SET = new Set<string>(LIBRARY_CORE_FRIENDS_DIRECTORY_SORTS);
const REQUEST_KEYS = [
  "cancellationId",
  "cursor",
  "filters",
  "limit",
  "nowMs",
  "queryId",
  "readerSessionId",
  "schemaVersion",
  "search",
  "sort",
] as const;
const RESPONSE_KEYS = [
  "nextCursor",
  "queryId",
  "rows",
  "schemaVersion",
  "source",
  "totalCount",
] as const;
const textEncoder = new TextEncoder();

export const LIBRARY_CORE_FRIENDS_DIRECTORY_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_friends_directory_request_v1",
  schemaVersion: LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID,
  canonicalKeys: REQUEST_KEYS,
  cursorCodec: "library_core_friends_directory_cursor_v1",
  defaultLimit: LIBRARY_CORE_FRIENDS_DIRECTORY_DEFAULT_LIMIT,
  maximumLimit: LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_LIMIT,
  maximumSearchBytes: LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_SEARCH_BYTES,
});

export const LIBRARY_CORE_FRIENDS_DIRECTORY_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_friends_directory_response_v1",
  schemaVersion: LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID,
  canonicalKeys: RESPONSE_KEYS,
  maximumRows: LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_FRIENDS_DIRECTORY_PROJECTION = Object.freeze({
  projectionId: "library_core_friends_directory_row_v1",
  sourceTable: "library_persons",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["selected_sort", "id"]),
});

export const LIBRARY_CORE_FRIENDS_DIRECTORY_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_FRIENDS_DIRECTORY_NESTED_BOUNDS = Object.freeze({
  filters: Object.freeze({
    maximumItems: LIBRARY_CORE_FRIENDS_DIRECTORY_FILTERS.length,
    sortedUnique: true,
  }),
});

export interface LibraryCoreFriendsDirectoryCursorV1 {
  readonly bindingDigest: LibraryCoreLowercaseHex64;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly offset: number;
  readonly projectionRevision: number;
  readonly transitionSequence: number;
}

export interface LibraryCoreFriendsDirectoryPageRequestV1 {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly filters: readonly LibraryCoreFriendsDirectoryFilterV1[];
  readonly limit: number;
  readonly nowMs: number;
  readonly queryId: typeof LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: typeof LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION;
  readonly search: string;
  readonly sort: LibraryCoreFriendsDirectorySortV1;
}

export type LibraryCoreFriendsDirectoryRowV1 =
  LibraryCoreGeneratedSqliteQueryRow<"friends_directory_page_v1">;

export interface LibraryCoreFriendsDirectoryPageResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID;
  readonly rows: readonly LibraryCoreFriendsDirectoryRowV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    textEncoder.encode(value).byteLength <= maximumBytes
  );
}

function normalizedFilters(
  value: unknown,
): readonly LibraryCoreFriendsDirectoryFilterV1[] | null {
  if (!Array.isArray(value) || value.length > FILTER_SET.size) return null;
  const filters: LibraryCoreFriendsDirectoryFilterV1[] = [];
  for (const filter of value) {
    if (typeof filter !== "string" || !FILTER_SET.has(filter)) return null;
    filters.push(filter as LibraryCoreFriendsDirectoryFilterV1);
  }
  const sorted = [...filters].sort();
  if (sorted.some((filter, index) => filter !== filters[index])) return null;
  if (new Set(filters).size !== filters.length) return null;
  return Object.freeze(filters);
}

export function libraryCoreFriendsDirectoryBindingDigestV1(
  input: Pick<
    LibraryCoreFriendsDirectoryPageRequestV1,
    "filters" | "nowMs" | "search" | "sort"
  >,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    textEncoder.encode(
      JSON.stringify([input.filters, input.nowMs, input.search, input.sort]),
    ),
  );
}

export function encodeLibraryCoreFriendsDirectoryCursorV1(
  cursor: LibraryCoreFriendsDirectoryCursorV1,
): string {
  return encodeLibraryCoreFeedPageCursorV1({
    generationId: cursor.generationId,
    transitionSequence: cursor.transitionSequence,
    projectionRevision: cursor.projectionRevision,
    sortAt: cursor.offset,
    globalId: cursor.bindingDigest as unknown as LibraryCoreEntityId,
  });
}

export function decodeLibraryCoreFriendsDirectoryCursorV1(
  value: string,
): LibraryCoreFeedPageParseResult<LibraryCoreFriendsDirectoryCursorV1> {
  const decoded = decodeLibraryCoreFeedPageCursorV1(value);
  if (!decoded.ok) return decoded;
  if (!isLibraryCoreLowercaseHex64(decoded.value.globalId)) {
    return { ok: false, error: "Friends directory cursor is invalid" };
  }
  return {
    ok: true,
    value: Object.freeze({
      bindingDigest: decoded.value
        .globalId as unknown as LibraryCoreLowercaseHex64,
      generationId: decoded.value.generationId,
      offset: decoded.value.sortAt,
      projectionRevision: decoded.value.projectionRevision,
      transitionSequence: decoded.value.transitionSequence,
    }),
  };
}

export function parseLibraryCoreFriendsDirectoryPageRequestV1(
  input: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFriendsDirectoryPageRequestV1> {
  const record = recordValue(input);
  const filters = normalizedFilters(record?.filters);
  if (
    !record ||
    !exactKeys(record, REQUEST_KEYS) ||
    record.queryId !== LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(record.cancellationId) ||
    !isLibraryCoreOperationInstanceId(record.readerSessionId) ||
    !isLibraryCoreNonnegativeSafeInteger(record.nowMs) ||
    !Number.isInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) > LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_LIMIT ||
    !boundedText(
      record.search,
      LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_SEARCH_BYTES,
    ) ||
    typeof record.sort !== "string" ||
    !SORT_SET.has(record.sort) ||
    filters === null ||
    (record.cursor !== null && typeof record.cursor !== "string")
  ) {
    return { ok: false, error: "Friends directory request is invalid" };
  }
  const value = Object.freeze({
    cancellationId: record.cancellationId,
    cursor: record.cursor,
    filters,
    limit: record.limit,
    nowMs: record.nowMs,
    queryId: LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID,
    readerSessionId: record.readerSessionId,
    schemaVersion: LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION,
    search: record.search,
    sort: record.sort as LibraryCoreFriendsDirectorySortV1,
  }) as LibraryCoreFriendsDirectoryPageRequestV1;
  if (value.cursor !== null) {
    const cursor = decodeLibraryCoreFriendsDirectoryCursorV1(value.cursor);
    if (
      !cursor.ok ||
      cursor.value.bindingDigest !==
        libraryCoreFriendsDirectoryBindingDigestV1(value)
    ) {
      return { ok: false, error: "Friends directory cursor is invalid" };
    }
  }
  return { ok: true, value };
}

function parseRow(value: unknown): LibraryCoreFriendsDirectoryRowV1 | null {
  return parseLibraryCoreGeneratedSqliteQueryRow(
    LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID,
    value,
  );
}

export function parseLibraryCoreFriendsDirectoryPageResponseV1(
  input: unknown,
  request: LibraryCoreFriendsDirectoryPageRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreFriendsDirectoryPageResponseV1> {
  const record = recordValue(input);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !record ||
    !exactKeys(record, RESPONSE_KEYS) ||
    record.queryId !== LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION ||
    !source.ok ||
    !isLibraryCoreNonnegativeSafeInteger(record.totalCount) ||
    !Array.isArray(record.rows) ||
    record.rows.length > request.limit ||
    (record.nextCursor !== null && typeof record.nextCursor !== "string") ||
    textEncoder.encode(JSON.stringify(record)).byteLength >
      LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_RESPONSE_BYTES
  ) {
    return { ok: false, error: "Friends directory response is invalid" };
  }
  const rows = record.rows.map(parseRow);
  if (rows.some((row) => row === null)) {
    return { ok: false, error: "Friends directory row is invalid" };
  }
  if (record.nextCursor !== null) {
    const cursor = decodeLibraryCoreFriendsDirectoryCursorV1(record.nextCursor);
    const requestCursor =
      request.cursor === null
        ? null
        : decodeLibraryCoreFriendsDirectoryCursorV1(request.cursor);
    const expectedOffset =
      (requestCursor?.ok ? requestCursor.value.offset : 0) + rows.length;
    if (
      !cursor.ok ||
      cursor.value.bindingDigest !==
        libraryCoreFriendsDirectoryBindingDigestV1(request) ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.projectionRevision !== source.value.projectionRevision ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.offset !== expectedOffset
    ) {
      return { ok: false, error: "Friends directory next cursor is invalid" };
    }
  }
  return {
    ok: true,
    value: Object.freeze({
      nextCursor: record.nextCursor,
      queryId: LIBRARY_CORE_FRIENDS_DIRECTORY_QUERY_ID,
      rows: Object.freeze(rows as LibraryCoreFriendsDirectoryRowV1[]),
      schemaVersion: LIBRARY_CORE_FRIENDS_DIRECTORY_SCHEMA_VERSION,
      source: source.value,
      totalCount: record.totalCount,
    }),
  };
}
