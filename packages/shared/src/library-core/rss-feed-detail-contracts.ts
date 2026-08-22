import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export const LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID =
  "rss_feed_detail_v1" as const;
export const LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_RSS_FEED_DETAIL_MAXIMUM_URL_UTF8_BYTES = 4_096;
export const LIBRARY_CORE_RSS_FEED_DETAIL_MAXIMUM_RESPONSE_BYTES = 64 * 1_024;

export const LIBRARY_CORE_RSS_FEED_DETAIL_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_rss_feed_detail_request_v1",
  schemaVersion: LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze(["queryId", "schemaVersion", "url"]),
  maximumUrlUtf8Bytes: LIBRARY_CORE_RSS_FEED_DETAIL_MAXIMUM_URL_UTF8_BYTES,
});

export const LIBRARY_CORE_RSS_FEED_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_rss_feed_detail_response_v1",
  schemaVersion: LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze([
    "feed",
    "queryId",
    "schemaVersion",
    "source",
  ]),
  nullableFeed: true,
  maximumRows: 1,
  maximumResponseBytes: LIBRARY_CORE_RSS_FEED_DETAIL_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_RSS_FEED_DETAIL_PROJECTION = Object.freeze({
  projectionId: "library_core_rss_feed_detail_v1",
  sourceTable: "library_rss_feeds",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["url"]),
});

export const LIBRARY_CORE_RSS_FEED_DETAIL_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_RSS_FEED_DETAIL_NESTED_BOUNDS = Object.freeze({});

export interface LibraryCoreRssFeedDetailV1 {
  readonly enabled: boolean;
  readonly folder: string | null;
  readonly imageUrl: string | null;
  readonly lastFetched: number | null;
  readonly pollInterval: number | null;
  readonly sampleBatchId: string | null;
  readonly sampleGeneratedAt: number | null;
  readonly sampleGeneratorVersion: number | null;
  readonly siteUrl: string | null;
  readonly title: string;
  readonly trackUnread: boolean;
  readonly updatedAt: number;
  readonly url: string;
}

export interface LibraryCoreRssFeedDetailRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION;
  readonly url: string;
}

export interface LibraryCoreRssFeedDetailResponseV1 {
  readonly feed: LibraryCoreRssFeedDetailV1 | null;
  readonly queryId: typeof LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS = ["queryId", "schemaVersion", "url"] as const;
const RESPONSE_KEYS = ["feed", "queryId", "schemaVersion", "source"] as const;
const FEED_KEYS = [
  "enabled",
  "folder",
  "imageUrl",
  "lastFetched",
  "pollInterval",
  "sampleBatchId",
  "sampleGeneratedAt",
  "sampleGeneratorVersion",
  "siteUrl",
  "title",
  "trackUnread",
  "updatedAt",
  "url",
] as const;
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

function nullableSafeInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isLibraryCoreNonnegativeSafeInteger(value) ? value : undefined;
}

export function parseLibraryCoreRssFeedDetailRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreRssFeedDetailRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  const url = boundedText(
    record?.url,
    LIBRARY_CORE_RSS_FEED_DETAIL_MAXIMUM_URL_UTF8_BYTES,
  );
  if (
    !record ||
    !url ||
    record.queryId !== LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION
  ) {
    return failure("RSS Feed detail request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      queryId: LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
      schemaVersion: LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
      url,
    }),
  });
}

function parseFeed(value: unknown): LibraryCoreRssFeedDetailV1 | null {
  const record = closedRecord(value, FEED_KEYS);
  if (!record) return null;
  const strings = {
    folder: boundedText(record.folder, 4_096, true),
    imageUrl: boundedText(record.imageUrl, 4_096, true),
    sampleBatchId: boundedText(record.sampleBatchId, 255, true),
    siteUrl: boundedText(record.siteUrl, 4_096, true),
    title: boundedText(record.title, 4_096),
    url: boundedText(
      record.url,
      LIBRARY_CORE_RSS_FEED_DETAIL_MAXIMUM_URL_UTF8_BYTES,
    ),
  };
  const integers = {
    lastFetched: nullableSafeInteger(record.lastFetched),
    pollInterval: nullableSafeInteger(record.pollInterval),
    sampleGeneratedAt: nullableSafeInteger(record.sampleGeneratedAt),
    sampleGeneratorVersion: nullableSafeInteger(record.sampleGeneratorVersion),
  };
  if (
    Object.values(strings).some((entry) => entry === undefined) ||
    !strings.url ||
    strings.title === undefined ||
    Object.values(integers).some((entry) => entry === undefined) ||
    typeof record.enabled !== "boolean" ||
    typeof record.trackUnread !== "boolean" ||
    !isLibraryCoreNonnegativeSafeInteger(record.updatedAt)
  ) {
    return null;
  }
  return Object.freeze({
    ...strings,
    ...integers,
    enabled: record.enabled,
    trackUnread: record.trackUnread,
    updatedAt: record.updatedAt,
  }) as LibraryCoreRssFeedDetailV1;
}

export function parseLibraryCoreRssFeedDetailResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreRssFeedDetailResponseV1> {
  const request = parseLibraryCoreRssFeedDetailRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION
  ) {
    return failure("RSS Feed detail response is invalid");
  }
  const feed = record.feed === null ? null : parseFeed(record.feed);
  if (feed === null && record.feed !== null) {
    return failure("RSS Feed detail row is invalid");
  }
  if (feed !== null && feed.url !== request.value.url) {
    return failure("RSS Feed detail row does not match the requested URL");
  }
  const response = Object.freeze({
    feed,
    queryId: LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_RSS_FEED_DETAIL_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("RSS Feed detail response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
