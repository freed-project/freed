import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID =
  "filter_scope_summary_v1" as const;
export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_MAXIMUM_RESPONSE_BYTES =
  16 * 1_024;

export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_filter_scope_summary_request_v1",
  schemaVersion: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID,
  canonicalKeys: Object.freeze([
    "authorId",
    "feedUrl",
    "platform",
    "queryId",
    "schemaVersion",
  ]),
});

export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_filter_scope_summary_response_v1",
  schemaVersion: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID,
  canonicalKeys: Object.freeze([
    "itemCount",
    "label",
    "queryId",
    "schemaVersion",
    "source",
  ]),
  maximumRows: 1,
  maximumResponseBytes:
    LIBRARY_CORE_FILTER_SCOPE_SUMMARY_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_PROJECTION = Object.freeze({
  projectionId: "library_core_filter_scope_summary_v1",
  sourceTable: "library_rss_feeds_or_accounts",
  fullContentAllowed: false,
  orderedColumns: Object.freeze([]),
});

export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_FILTER_SCOPE_SUMMARY_NESTED_BOUNDS = Object.freeze(
  {},
);

export interface LibraryCoreFilterScopeSummaryRequestV1 {
  readonly authorId: string | null;
  readonly feedUrl: string | null;
  readonly platform: string | null;
  readonly queryId: typeof LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION;
}

export interface LibraryCoreFilterScopeSummaryResponseV1 {
  readonly itemCount: number;
  readonly label: string | null;
  readonly queryId: typeof LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const textEncoder = new TextEncoder();
const REQUEST_KEYS =
  LIBRARY_CORE_FILTER_SCOPE_SUMMARY_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_FILTER_SCOPE_SUMMARY_RESPONSE_SCHEMA.canonicalKeys;

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

function boundedNullableText(
  value: unknown,
  maximumBytes: number,
): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > maximumBytes
  ) {
    return undefined;
  }
  return value;
}

export function parseLibraryCoreFilterScopeSummaryRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFilterScopeSummaryRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  const authorId = boundedNullableText(record?.authorId, 2_048);
  const feedUrl = boundedNullableText(record?.feedUrl, 4_096);
  const platform = boundedNullableText(record?.platform, 256);
  const feedMode =
    feedUrl !== null &&
    feedUrl !== undefined &&
    authorId === null &&
    platform === null;
  const authorMode =
    feedUrl === null &&
    authorId !== null &&
    authorId !== undefined &&
    platform !== null &&
    platform !== undefined;
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION ||
    (!feedMode && !authorMode)
  ) {
    return failure("filter scope summary request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      authorId: authorId ?? null,
      feedUrl: feedUrl ?? null,
      platform: platform ?? null,
      queryId: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION,
    }),
  });
}

export function parseLibraryCoreFilterScopeSummaryResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFilterScopeSummaryResponseV1> {
  const request = parseLibraryCoreFilterScopeSummaryRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  const label =
    record?.label === null ? null : boundedNullableText(record?.label, 4_096);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    label === undefined ||
    !isLibraryCoreNonnegativeSafeInteger(record.itemCount) ||
    record.queryId !== LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION
  ) {
    return failure("filter scope summary response is invalid");
  }
  const response = Object.freeze({
    itemCount: record.itemCount,
    label,
    queryId: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_QUERY_ID,
    schemaVersion: LIBRARY_CORE_FILTER_SCOPE_SUMMARY_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_FILTER_SCOPE_SUMMARY_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("filter scope summary response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
