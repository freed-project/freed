import {
  decodeLibraryCoreFeedBrowsePageCursorV2,
  encodeLibraryCoreFeedBrowsePageCursorV2,
  type LibraryCoreFeedBrowsePageCursorV2,
} from "./feed-browse-page-contracts.js";
import {
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS,
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEntityId,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import { LibraryCoreSha256 } from "./sha256.js";

export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID =
  "provider_media_page_v1" as const;
export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_MAXIMUM_LIMIT = 64;
export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_MAXIMUM_RESPONSE_BYTES =
  4 * 1_048_576;

export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_provider_media_page_request_v1",
  schemaVersion: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "limit",
    "provider",
    "queryId",
    "readerSessionId",
    "savedOnly",
    "schemaVersion",
  ]),
  maximumLimit: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_MAXIMUM_LIMIT,
  cancellable: true,
});
export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_provider_media_page_response_v1",
  schemaVersion: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "schemaVersion",
    "source",
  ]),
  maximumRows: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_MAXIMUM_RESPONSE_BYTES,
});
export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_provider_media_metadata_v1",
  sourceTable: "library_feed_items",
  fullContentAllowed: false,
  selectedFields: Object.freeze([
    ...LIBRARY_CORE_FEED_PAGE_PROJECTION.selectedFields,
    "fbGroup",
    "linkUrl",
  ]),
});
export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SOURCE_IDENTITY =
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY;
export const LIBRARY_CORE_PROVIDER_MEDIA_PAGE_NESTED_BOUNDS =
  LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS;

export type LibraryCoreProviderMediaSourceV1 =
  "facebook" | "instagram" | "youtube";

export interface LibraryCoreProviderMediaPageRequestV1 {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly provider: LibraryCoreProviderMediaSourceV1;
  readonly queryId: typeof LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID;
  readonly readerSessionId: string;
  readonly savedOnly: boolean;
  readonly schemaVersion: typeof LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION;
}

export interface LibraryCoreProviderMediaGroupV1 {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export interface LibraryCoreProviderMediaRowV1 extends LibraryCoreFeedCardV1 {
  readonly fbGroup: LibraryCoreProviderMediaGroupV1 | null;
  readonly linkUrl: string | null;
}

export interface LibraryCoreProviderMediaPageResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID;
  readonly rows: readonly LibraryCoreProviderMediaRowV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS = [
  "cancellationId",
  "cursor",
  "limit",
  "provider",
  "queryId",
  "readerSessionId",
  "savedOnly",
  "schemaVersion",
] as const;
const RESPONSE_KEYS = [
  "nextCursor",
  "queryId",
  "rows",
  "schemaVersion",
  "source",
] as const;
const ROW_KEYS = [
  ...LIBRARY_CORE_FEED_PAGE_PROJECTION.selectedFields,
  "fbGroup",
  "linkUrl",
] as const;
const PROVIDERS = new Set<LibraryCoreProviderMediaSourceV1>([
  "facebook",
  "instagram",
  "youtube",
]);
const textEncoder = new TextEncoder();

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

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    textEncoder.encode(value).length <= maximumBytes
  );
}

export function libraryCoreProviderMediaBindingDigestV1(
  provider: LibraryCoreProviderMediaSourceV1,
  savedOnly: boolean,
): LibraryCoreLowercaseHex64 {
  return new LibraryCoreSha256()
    .update(
      textEncoder.encode(
        JSON.stringify({ provider, savedOnly, schemaVersion: 1 }),
      ),
    )
    .digestLowerHex() as LibraryCoreLowercaseHex64;
}

export function encodeLibraryCoreProviderMediaPageCursorV1(input: {
  readonly filterDigest: LibraryCoreLowercaseHex64;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly globalId: LibraryCoreEntityId;
  readonly projectionRevision: number;
  readonly transitionSequence: number;
}): string {
  return encodeLibraryCoreFeedBrowsePageCursorV2({
    ...input,
    priority: 0,
    publishedAt: 0,
  });
}

export function decodeLibraryCoreProviderMediaPageCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<
  Omit<LibraryCoreFeedBrowsePageCursorV2, "priority" | "publishedAt">
> {
  const decoded = decodeLibraryCoreFeedBrowsePageCursorV2(value);
  if (
    !decoded.ok ||
    decoded.value.priority !== 0 ||
    decoded.value.publishedAt !== 0
  ) {
    return failure("provider media cursor is invalid");
  }
  const {
    priority: _priority,
    publishedAt: _publishedAt,
    ...cursor
  } = decoded.value;
  return Object.freeze({ ok: true, value: Object.freeze(cursor) });
}

export function parseLibraryCoreProviderMediaPageRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreProviderMediaPageRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(record.cancellationId) ||
    !isLibraryCoreOperationInstanceId(record.readerSessionId) ||
    !PROVIDERS.has(record.provider as LibraryCoreProviderMediaSourceV1) ||
    typeof record.savedOnly !== "boolean" ||
    !Number.isSafeInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) > LIBRARY_CORE_PROVIDER_MEDIA_PAGE_MAXIMUM_LIMIT ||
    (record.cursor !== null && typeof record.cursor !== "string")
  ) {
    return failure("provider media request is invalid");
  }
  if (
    record.cursor !== null &&
    !decodeLibraryCoreProviderMediaPageCursorV1(record.cursor).ok
  ) {
    return failure("provider media cursor is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      cancellationId: record.cancellationId,
      cursor: record.cursor,
      limit: record.limit,
      provider: record.provider,
      queryId: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID,
      readerSessionId: record.readerSessionId,
      savedOnly: record.savedOnly,
      schemaVersion: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION,
    }) as LibraryCoreProviderMediaPageRequestV1,
  });
}

function parseRow(
  value: unknown,
  request: LibraryCoreProviderMediaPageRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreProviderMediaRowV1> {
  const record = closedRecord(value, ROW_KEYS);
  if (!record) return failure("provider media row is invalid");
  const { fbGroup, linkUrl, ...cardInput } = record;
  const card = parseLibraryCoreFeedCardV1(cardInput);
  const group =
    fbGroup === null ? null : closedRecord(fbGroup, ["id", "name", "url"]);
  if (
    !card.ok ||
    (card.value.platform !== request.provider &&
      !(
        request.provider === "youtube" &&
        request.savedOnly &&
        card.value.saved === true
      )) ||
    (request.savedOnly && card.value.saved !== true) ||
    (linkUrl !== null && !boundedText(linkUrl, 8_192)) ||
    (group !== null &&
      (!boundedText(group.id, 4_096) ||
        group.id.length === 0 ||
        !boundedText(group.name, 2_048) ||
        !boundedText(group.url, 8_192)))
  ) {
    return failure("provider media row is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...card.value,
      fbGroup:
        group === null
          ? null
          : Object.freeze({
              id: group.id as string,
              name: group.name as string,
              url: group.url as string,
            }),
      linkUrl: linkUrl as string | null,
    }),
  });
}

export function parseLibraryCoreProviderMediaPageResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreProviderMediaPageResponseV1> {
  const request = parseLibraryCoreProviderMediaPageRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION ||
    !Array.isArray(record.rows) ||
    record.rows.length > request.value.limit ||
    (record.nextCursor !== null && typeof record.nextCursor !== "string")
  ) {
    return failure("provider media response is invalid");
  }
  const rows: LibraryCoreProviderMediaRowV1[] = [];
  for (const value of record.rows) {
    const row = parseRow(value, request.value);
    if (!row.ok) return row;
    const previous = rows.at(-1);
    if (previous && previous.globalId >= row.value.globalId) {
      return failure("provider media rows are not in binary identity order");
    }
    rows.push(row.value);
  }
  if (record.nextCursor !== null) {
    const cursor = decodeLibraryCoreProviderMediaPageCursorV1(
      record.nextCursor,
    );
    const digest = libraryCoreProviderMediaBindingDigestV1(
      request.value.provider,
      request.value.savedOnly,
    );
    if (
      !cursor.ok ||
      cursor.value.filterDigest !== digest ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.projectionRevision !== source.value.projectionRevision ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.globalId !== rows.at(-1)?.globalId
    ) {
      return failure(
        "provider media cursor does not bind its request and source",
      );
    }
  }
  const response = Object.freeze({
    nextCursor: record.nextCursor as string | null,
    queryId: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_QUERY_ID,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_PROVIDER_MEDIA_PAGE_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).length >
    LIBRARY_CORE_PROVIDER_MEDIA_PAGE_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("provider media response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
