import {
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID =
  "person_graph_page_v1" as const;
export const LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID =
  "account_graph_page_v1" as const;
export const LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID =
  "rss_feed_graph_page_v1" as const;
export const LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_DEFAULT_LIMIT = 64;
export const LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT = 128;
export const LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;

const REQUEST_KEYS = [
  "cancellationId",
  "cursor",
  "limit",
  "queryId",
  "readerSessionId",
  "schemaVersion",
] as const;
const RESPONSE_KEYS = [
  "layoutRevision",
  "nextCursor",
  "queryId",
  "rows",
  "schemaVersion",
  "source",
] as const;
const PERSON_KEYS = [
  "avatarUrl",
  "careLevel",
  "graphPinned",
  "graphUpdatedAt",
  "graphX",
  "graphY",
  "id",
  "lastReachOutAt",
  "name",
  "reachOutIntervalDays",
  "relationshipStatus",
  "updatedAt",
] as const;
const ACCOUNT_KEYS = [
  "activityCount",
  "avatarUrl",
  "discoveredFrom",
  "displayName",
  "externalId",
  "firstSeenAt",
  "followRosterActive",
  "graphPinned",
  "graphUpdatedAt",
  "graphX",
  "graphY",
  "handle",
  "id",
  "kind",
  "lastSeenAt",
  "latestActivityAt",
  "personId",
  "provider",
  "updatedAt",
] as const;
const RSS_FEED_KEYS = [
  "activityCount",
  "enabled",
  "imageUrl",
  "latestActivityAt",
  "title",
  "updatedAt",
  "url",
] as const;
const textEncoder = new TextEncoder();

export const LIBRARY_CORE_PERSON_GRAPH_PAGE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_person_graph_page_request_v1",
  schemaVersion: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID,
  canonicalKeys: REQUEST_KEYS,
  cursorCodec: "library_core_identity_page_cursor_v1",
  defaultLimit: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_DEFAULT_LIMIT,
  maximumLimit: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
});

export const LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_REQUEST_SCHEMA = Object.freeze({
  ...LIBRARY_CORE_PERSON_GRAPH_PAGE_REQUEST_SCHEMA,
  schemaId: "library_core_account_graph_page_request_v1",
  queryId: LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID,
});

export const LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_REQUEST_SCHEMA = Object.freeze({
  ...LIBRARY_CORE_PERSON_GRAPH_PAGE_REQUEST_SCHEMA,
  schemaId: "library_core_rss_feed_graph_page_request_v1",
  queryId: LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID,
});

export const LIBRARY_CORE_PERSON_GRAPH_PAGE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_person_graph_page_response_v1",
  schemaVersion: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID,
  canonicalKeys: RESPONSE_KEYS,
  maximumRows: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
  maximumResponseBytes:
    LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_RESPONSE_SCHEMA = Object.freeze({
  ...LIBRARY_CORE_PERSON_GRAPH_PAGE_RESPONSE_SCHEMA,
  schemaId: "library_core_account_graph_page_response_v1",
  queryId: LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID,
});

export const LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_RESPONSE_SCHEMA = Object.freeze({
  ...LIBRARY_CORE_PERSON_GRAPH_PAGE_RESPONSE_SCHEMA,
  schemaId: "library_core_rss_feed_graph_page_response_v1",
  queryId: LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID,
});

export const LIBRARY_CORE_PERSON_GRAPH_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_person_graph_row_v1",
  sourceTable: "library_persons",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["id"]),
});

export const LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_account_graph_row_v1",
  sourceTable: "library_accounts",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["id"]),
});

export const LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_rss_feed_graph_row_v1",
  sourceTable: "library_rss_feeds",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["url"]),
});

export const LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_SOURCE_IDENTITY = Object.freeze(
  {
    identityId: "library_core_projection_reader_source_v1",
    generationId: "sha256_file_digest",
    transitionSequence: "nonnegative_safe_integer",
    projectionRevision: "nonnegative_safe_integer",
    sessionPinned: true,
  },
);

export const LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_NESTED_BOUNDS = Object.freeze({
  nestedValuesAllowed: false,
});

export interface LibraryCoreIdentityPageCursorV1 {
  readonly entityId: string;
  readonly generationId: string;
  readonly layoutRevision: number;
  readonly projectionRevision: number;
  readonly transitionSequence: number;
}

interface LibraryCoreIdentityPageRequestV1 {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly readerSessionId: string;
  readonly schemaVersion: 1;
}

export interface LibraryCorePersonGraphPageRequestV1 extends LibraryCoreIdentityPageRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID;
}

export interface LibraryCoreAccountGraphPageRequestV1 extends LibraryCoreIdentityPageRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID;
}

export interface LibraryCoreRssFeedGraphPageRequestV1 extends LibraryCoreIdentityPageRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID;
}

export interface LibraryCorePersonGraphRowV1 {
  readonly avatarUrl: string | null;
  readonly careLevel: number;
  readonly graphPinned: boolean;
  readonly graphUpdatedAt: number | null;
  readonly graphX: number | null;
  readonly graphY: number | null;
  readonly id: string;
  readonly lastReachOutAt: number | null;
  readonly name: string;
  readonly reachOutIntervalDays: number | null;
  readonly relationshipStatus: string;
  readonly updatedAt: number;
}

export interface LibraryCoreAccountGraphRowV1 {
  readonly activityCount: number;
  readonly avatarUrl: string | null;
  readonly discoveredFrom: string;
  readonly displayName: string | null;
  readonly externalId: string;
  readonly firstSeenAt: number;
  readonly followRosterActive: boolean | null;
  readonly graphPinned: boolean;
  readonly graphUpdatedAt: number | null;
  readonly graphX: number | null;
  readonly graphY: number | null;
  readonly handle: string | null;
  readonly id: string;
  readonly kind: string;
  readonly lastSeenAt: number;
  readonly latestActivityAt: number | null;
  readonly personId: string | null;
  readonly provider: string;
  readonly updatedAt: number;
}

export interface LibraryCoreRssFeedGraphRowV1 {
  readonly activityCount: number;
  readonly enabled: boolean;
  readonly imageUrl: string | null;
  readonly latestActivityAt: number | null;
  readonly title: string;
  readonly updatedAt: number;
  readonly url: string;
}

interface LibraryCoreIdentityPageResponseV1 {
  readonly layoutRevision: number;
  readonly nextCursor: string | null;
  readonly schemaVersion: 1;
  readonly source: LibraryCoreFeedPageSourceV1;
}

export interface LibraryCorePersonGraphPageResponseV1 extends LibraryCoreIdentityPageResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID;
  readonly rows: readonly LibraryCorePersonGraphRowV1[];
}

export interface LibraryCoreAccountGraphPageResponseV1 extends LibraryCoreIdentityPageResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID;
  readonly rows: readonly LibraryCoreAccountGraphRowV1[];
}

export interface LibraryCoreRssFeedGraphPageResponseV1 extends LibraryCoreIdentityPageResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID;
  readonly rows: readonly LibraryCoreRssFeedGraphRowV1[];
}

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
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
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

function boundedText(
  value: unknown,
  maximumBytes: number,
  nullable: true,
): string | null | undefined;
function boundedText(
  value: unknown,
  maximumBytes: number,
  nullable?: false,
): string | undefined;
function boundedText(
  value: unknown,
  maximumBytes: number,
  nullable = false,
): string | null | undefined {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    textEncoder.encode(value).byteLength > maximumBytes
  ) {
    return undefined;
  }
  return value;
}

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isLibraryCoreNonnegativeSafeInteger(value) ? value : undefined;
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000
    ? value
    : undefined;
}

export function encodeLibraryCoreIdentityPageCursorV1(
  cursor: LibraryCoreIdentityPageCursorV1,
): string {
  return encodeLibraryCoreFeedPageCursorV1({
    generationId: cursor.generationId as never,
    globalId: cursor.entityId as never,
    projectionRevision: cursor.projectionRevision,
    sortAt: cursor.layoutRevision,
    transitionSequence: cursor.transitionSequence,
  });
}

export function decodeLibraryCoreIdentityPageCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreIdentityPageCursorV1> {
  const decoded = decodeLibraryCoreFeedPageCursorV1(value);
  if (!decoded.ok) {
    return failure("identity page cursor is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      entityId: decoded.value.globalId,
      generationId: decoded.value.generationId,
      layoutRevision: decoded.value.sortAt,
      projectionRevision: decoded.value.projectionRevision,
      transitionSequence: decoded.value.transitionSequence,
    }),
  });
}

function parseRequest(
  value: unknown,
  queryId:
    | typeof LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID
    | typeof LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID
    | typeof LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID,
): LibraryCoreFeedPageParseResult<
  | LibraryCorePersonGraphPageRequestV1
  | LibraryCoreAccountGraphPageRequestV1
  | LibraryCoreRssFeedGraphPageRequestV1
> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== queryId ||
    record.schemaVersion !== 1 ||
    !isLibraryCoreOperationInstanceId(record.cancellationId) ||
    !isLibraryCoreOperationInstanceId(record.readerSessionId) ||
    !Number.isSafeInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) >
      LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT ||
    (record.cursor !== null && typeof record.cursor !== "string") ||
    (record.cursor !== null &&
      !decodeLibraryCoreIdentityPageCursorV1(record.cursor).ok)
  ) {
    return failure("identity page request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      cancellationId: record.cancellationId,
      cursor: record.cursor,
      limit: record.limit,
      queryId,
      readerSessionId: record.readerSessionId,
      schemaVersion: 1,
    }) as
      | LibraryCorePersonGraphPageRequestV1
      | LibraryCoreAccountGraphPageRequestV1
      | LibraryCoreRssFeedGraphPageRequestV1,
  });
}

export function parseLibraryCorePersonGraphPageRequestV1(value: unknown) {
  return parseRequest(
    value,
    LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID,
  ) as LibraryCoreFeedPageParseResult<LibraryCorePersonGraphPageRequestV1>;
}

export function parseLibraryCoreAccountGraphPageRequestV1(value: unknown) {
  return parseRequest(
    value,
    LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID,
  ) as LibraryCoreFeedPageParseResult<LibraryCoreAccountGraphPageRequestV1>;
}

export function parseLibraryCoreRssFeedGraphPageRequestV1(value: unknown) {
  return parseRequest(
    value,
    LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID,
  ) as LibraryCoreFeedPageParseResult<LibraryCoreRssFeedGraphPageRequestV1>;
}

function parsePerson(value: unknown): LibraryCorePersonGraphRowV1 | null {
  const row = closedRecord(value, PERSON_KEYS);
  if (!row) return null;
  const avatarUrl = boundedText(row.avatarUrl, 8_192, true);
  const id = boundedText(row.id, 2_048);
  const name = boundedText(row.name, 4_096);
  const relationshipStatus = boundedText(row.relationshipStatus, 255);
  const lastReachOutAt = nullableInteger(row.lastReachOutAt);
  const reachOutIntervalDays = nullableInteger(row.reachOutIntervalDays);
  const graphUpdatedAt = nullableInteger(row.graphUpdatedAt);
  const graphX = nullableFiniteNumber(row.graphX);
  const graphY = nullableFiniteNumber(row.graphY);
  if (
    avatarUrl === undefined ||
    !id ||
    !name ||
    !relationshipStatus ||
    lastReachOutAt === undefined ||
    reachOutIntervalDays === undefined ||
    graphUpdatedAt === undefined ||
    graphX === undefined ||
    graphY === undefined ||
    typeof row.graphPinned !== "boolean" ||
    (row.graphPinned
      ? graphX === null || graphY === null || graphUpdatedAt === null
      : graphX !== null || graphY !== null || graphUpdatedAt !== null) ||
    !Number.isInteger(row.careLevel) ||
    (row.careLevel as number) < 1 ||
    (row.careLevel as number) > 5 ||
    !isLibraryCoreNonnegativeSafeInteger(row.updatedAt)
  ) {
    return null;
  }
  return Object.freeze({
    avatarUrl,
    careLevel: row.careLevel as number,
    graphPinned: row.graphPinned,
    graphUpdatedAt,
    graphX,
    graphY,
    id,
    lastReachOutAt,
    name,
    reachOutIntervalDays,
    relationshipStatus,
    updatedAt: row.updatedAt,
  });
}

function parseAccount(value: unknown): LibraryCoreAccountGraphRowV1 | null {
  const row = closedRecord(value, ACCOUNT_KEYS);
  if (!row) return null;
  const avatarUrl = boundedText(row.avatarUrl, 8_192, true);
  const discoveredFrom = boundedText(row.discoveredFrom, 64);
  const displayName = boundedText(row.displayName, 512, true);
  const externalId = boundedText(row.externalId, 4_096);
  const handle = boundedText(row.handle, 512, true);
  const id = boundedText(row.id, 2_048);
  const kind = boundedText(row.kind, 64);
  const latestActivityAt = nullableInteger(row.latestActivityAt);
  const graphUpdatedAt = nullableInteger(row.graphUpdatedAt);
  const graphX = nullableFiniteNumber(row.graphX);
  const graphY = nullableFiniteNumber(row.graphY);
  const personId = boundedText(row.personId, 2_048, true);
  const provider = boundedText(row.provider, 64);
  if (
    avatarUrl === undefined ||
    !discoveredFrom ||
    displayName === undefined ||
    !externalId ||
    handle === undefined ||
    !id ||
    !kind ||
    latestActivityAt === undefined ||
    graphUpdatedAt === undefined ||
    graphX === undefined ||
    graphY === undefined ||
    typeof row.graphPinned !== "boolean" ||
    (row.graphPinned
      ? graphX === null || graphY === null || graphUpdatedAt === null
      : graphX !== null || graphY !== null || graphUpdatedAt !== null) ||
    personId === undefined ||
    !provider ||
    !isLibraryCoreNonnegativeSafeInteger(row.activityCount) ||
    !isLibraryCoreNonnegativeSafeInteger(row.firstSeenAt) ||
    !isLibraryCoreNonnegativeSafeInteger(row.lastSeenAt) ||
    !isLibraryCoreNonnegativeSafeInteger(row.updatedAt) ||
    (row.followRosterActive !== null &&
      typeof row.followRosterActive !== "boolean")
  ) {
    return null;
  }
  return Object.freeze({
    activityCount: row.activityCount,
    avatarUrl,
    discoveredFrom,
    displayName,
    externalId,
    firstSeenAt: row.firstSeenAt,
    followRosterActive: row.followRosterActive as boolean | null,
    graphPinned: row.graphPinned,
    graphUpdatedAt,
    graphX,
    graphY,
    handle,
    id,
    kind,
    lastSeenAt: row.lastSeenAt,
    latestActivityAt,
    personId,
    provider,
    updatedAt: row.updatedAt,
  });
}

function parseRssFeed(value: unknown): LibraryCoreRssFeedGraphRowV1 | null {
  const row = closedRecord(value, RSS_FEED_KEYS);
  if (!row) return null;
  const imageUrl = boundedText(row.imageUrl, 8_192, true);
  const latestActivityAt = nullableInteger(row.latestActivityAt);
  const title = boundedText(row.title, 4_096);
  const url = boundedText(row.url, 8_192);
  if (
    imageUrl === undefined ||
    latestActivityAt === undefined ||
    !title ||
    !url ||
    typeof row.enabled !== "boolean" ||
    !isLibraryCoreNonnegativeSafeInteger(row.activityCount) ||
    !isLibraryCoreNonnegativeSafeInteger(row.updatedAt)
  ) {
    return null;
  }
  return Object.freeze({
    activityCount: row.activityCount,
    enabled: row.enabled,
    imageUrl,
    latestActivityAt,
    title,
    updatedAt: row.updatedAt,
    url,
  });
}

function parseResponse<Row>(
  value: unknown,
  requestValue: unknown,
  queryId:
    | typeof LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID
    | typeof LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID
    | typeof LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID,
  parseRow: (value: unknown) => Row | null,
  rowIdentity: (row: Row) => string,
): LibraryCoreFeedPageParseResult<{
  readonly nextCursor: string | null;
  readonly queryId: typeof queryId;
  readonly rows: readonly Row[];
  readonly schemaVersion: 1;
  readonly source: LibraryCoreFeedPageSourceV1;
}> {
  const request = parseRequest(requestValue, queryId);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== queryId ||
    record.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(record.layoutRevision) ||
    !Array.isArray(record.rows) ||
    record.rows.length > request.value.limit ||
    (record.nextCursor !== null && typeof record.nextCursor !== "string")
  ) {
    return failure("identity page response is invalid");
  }
  const rows: Row[] = [];
  let previousId: string | null = null;
  for (const candidate of record.rows) {
    const row = parseRow(candidate);
    const id = row ? rowIdentity(row) : null;
    if (
      !row ||
      typeof id !== "string" ||
      (previousId !== null && previousId >= id)
    ) {
      return failure("identity page rows are invalid or unordered");
    }
    previousId = id;
    rows.push(row);
  }
  if (record.nextCursor !== null) {
    const cursor = decodeLibraryCoreIdentityPageCursorV1(record.nextCursor);
    if (
      !cursor.ok ||
      cursor.value.entityId !== previousId ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.layoutRevision !== record.layoutRevision ||
      cursor.value.projectionRevision !== source.value.projectionRevision ||
      cursor.value.transitionSequence !== source.value.transitionSequence
    ) {
      return failure(
        "identity page cursor does not bind the final row and source",
      );
    }
  }
  const response = Object.freeze({
    layoutRevision: record.layoutRevision as number,
    nextCursor: record.nextCursor as string | null,
    queryId,
    rows: Object.freeze(rows),
    schemaVersion: 1 as const,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("identity page response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}

export function parseLibraryCorePersonGraphPageResponseV1(
  value: unknown,
  requestValue: unknown,
) {
  return parseResponse(
    value,
    requestValue,
    LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID,
    parsePerson,
    (row) => row.id,
  ) as LibraryCoreFeedPageParseResult<LibraryCorePersonGraphPageResponseV1>;
}

export function parseLibraryCoreAccountGraphPageResponseV1(
  value: unknown,
  requestValue: unknown,
) {
  return parseResponse(
    value,
    requestValue,
    LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID,
    parseAccount,
    (row) => row.id,
  ) as LibraryCoreFeedPageParseResult<LibraryCoreAccountGraphPageResponseV1>;
}

export function parseLibraryCoreRssFeedGraphPageResponseV1(
  value: unknown,
  requestValue: unknown,
) {
  return parseResponse(
    value,
    requestValue,
    LIBRARY_CORE_RSS_FEED_GRAPH_PAGE_QUERY_ID,
    parseRssFeed,
    (row) => row.url,
  ) as LibraryCoreFeedPageParseResult<LibraryCoreRssFeedGraphPageResponseV1>;
}
