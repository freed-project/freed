import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";

/**
 * Closed contract for the whole-corpus facet summary.
 *
 * SQLite computes the aggregate without returning item rows. The response
 * admits at most 4,096 tags of 1,024 UTF-8 bytes each in binary order.
 */
export const LIBRARY_CORE_FACET_SUMMARY_QUERY_ID =
  "library_facet_summary_v1" as const;
export const LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAGS = 4_096;
export const LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAG_UTF8_BYTES = 1_024;
export const LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_PLATFORMS = 64;
export const LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_PLATFORM_UTF8_BYTES = 256;
export const LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_RESPONSE_BYTES = 2 * 1_048_576;

export const LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_facet_summary_request_v1",
  schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  /** No filter, no cursor, no limit: the aggregate covers the whole corpus. */
  canonicalKeys: Object.freeze(["queryId", "schemaVersion"]),
});

export const LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_facet_summary_response_v1",
  schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  canonicalKeys: Object.freeze([
    "queryId",
    "schemaVersion",
    "source",
    "summary",
  ]),
  summaryKeys: Object.freeze([
    "archivedCount",
    "archivableCount",
    "enabledRssFeedCount",
    "friendPersonCount",
    "platformCounts",
    "rssFeedCount",
    "sampleAccountCount",
    "sampleFeedCount",
    "sampleItemCount",
    "samplePersonCount",
    "savedArchivedCount",
    "savedCount",
    "savedPlatformCount",
    "socialAccountCount",
    "tags",
    "totalCount",
    "unreadCount",
  ]),
  maximumTags: LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAGS,
  maximumResponseBytes: LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_RESPONSE_BYTES,
});

/**
 * Counts, not rows. The aggregate is computed inside SQLite and the renderer
 * never receives item rows, so no item projection applies.
 */
export const LIBRARY_CORE_FACET_SUMMARY_PROJECTION = Object.freeze({
  projectionId: "library_core_facet_summary_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["tag"]),
});

export const LIBRARY_CORE_FACET_SUMMARY_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_FACET_SUMMARY_NESTED_BOUNDS = Object.freeze({
  platformCounts: Object.freeze({
    maximumItems: LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_PLATFORMS,
    maximumKeyUtf8Bytes:
      LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_PLATFORM_UTF8_BYTES,
  }),
  tags: Object.freeze({
    maximumItems: LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAGS,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAG_UTF8_BYTES,
    maximumUtf8BytesPerItem: LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAG_UTF8_BYTES,
  }),
});

export const LIBRARY_CORE_FACET_SUMMARY_TAG_ORDER = Object.freeze({
  columns: Object.freeze(["tag"]),
  direction: "asc",
  textCollation: "binary",
});

export interface LibraryCoreFacetSummaryRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_FACET_SUMMARY_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION;
}

export interface LibraryCoreFacetSummaryV1 {
  readonly archivedCount: number;
  readonly archivableCount: number;
  readonly enabledRssFeedCount: number;
  readonly friendPersonCount: number;
  readonly platformCounts: readonly LibraryCoreFacetPlatformCountV1[];
  readonly rssFeedCount: number;
  readonly sampleAccountCount: number;
  readonly sampleFeedCount: number;
  readonly sampleItemCount: number;
  readonly samplePersonCount: number;
  readonly savedArchivedCount: number;
  readonly savedCount: number;
  readonly savedPlatformCount: number;
  readonly socialAccountCount: number;
  readonly tags: readonly string[];
  readonly totalCount: number;
  readonly unreadCount: number;
}

export interface LibraryCoreFacetPlatformCountV1 {
  readonly archivableCount: number;
  readonly platform: string;
  readonly totalCount: number;
  readonly unreadCount: number;
}

export interface LibraryCoreFacetSummaryResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_FACET_SUMMARY_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly summary: LibraryCoreFacetSummaryV1;
}

const REQUEST_KEYS = LIBRARY_CORE_FACET_SUMMARY_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS = LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA.canonicalKeys;
const SUMMARY_KEYS = LIBRARY_CORE_FACET_SUMMARY_RESPONSE_SCHEMA.summaryKeys;
const textEncoder = new TextEncoder();

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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index]! - rightBytes[index]!;
    }
  }
  return leftBytes.length - rightBytes.length;
}

function parsePlatformCounts(
  value: unknown,
): LibraryCoreFacetPlatformCountV1[] | null {
  if (
    !Array.isArray(value) ||
    value.length > LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_PLATFORMS
  ) {
    return null;
  }
  const counts: LibraryCoreFacetPlatformCountV1[] = [];
  const keys = [
    "archivableCount",
    "platform",
    "totalCount",
    "unreadCount",
  ] as const;
  for (const entry of value) {
    const record = closedRecord(entry, keys);
    if (
      !record ||
      typeof record.platform !== "string" ||
      record.platform.length === 0 ||
      textEncoder.encode(record.platform).byteLength >
        LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_PLATFORM_UTF8_BYTES ||
      (counts.at(-1) !== undefined &&
        compareUtf8(counts.at(-1)!.platform, record.platform) >= 0) ||
      !Number.isSafeInteger(record.totalCount) ||
      (record.totalCount as number) < 0 ||
      !Number.isSafeInteger(record.unreadCount) ||
      (record.unreadCount as number) < 0 ||
      !Number.isSafeInteger(record.archivableCount) ||
      (record.archivableCount as number) < 0 ||
      (record.unreadCount as number) > (record.totalCount as number) ||
      (record.archivableCount as number) > (record.totalCount as number)
    ) {
      return null;
    }
    counts.push(
      Object.freeze({
        archivableCount: record.archivableCount as number,
        platform: record.platform,
        totalCount: record.totalCount as number,
        unreadCount: record.unreadCount as number,
      }),
    );
  }
  return counts;
}

function safeCountSum(
  counts: readonly LibraryCoreFacetPlatformCountV1[],
  select: (count: LibraryCoreFacetPlatformCountV1) => number,
): number | null {
  let total = 0;
  for (const count of counts) {
    total += select(count);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function parseLibraryCoreFacetSummaryRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFacetSummaryRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_FACET_SUMMARY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION
  ) {
    return failure("facet summary request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
    }),
  });
}

export function parseLibraryCoreFacetSummaryResponseV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFacetSummaryResponseV1> {
  const record = closedRecord(value, RESPONSE_KEYS);
  const summary = closedRecord(record?.summary, SUMMARY_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !record ||
    !summary ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_FACET_SUMMARY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION
  ) {
    return failure("facet summary response is invalid");
  }
  const countKeys = SUMMARY_KEYS.filter(
    (key) => key !== "tags" && key !== "platformCounts",
  );
  const platformCounts = parsePlatformCounts(summary.platformCounts);
  if (
    countKeys.some(
      (key) =>
        !Number.isSafeInteger(summary[key]) || (summary[key] as number) < 0,
    ) ||
    platformCounts === null ||
    !Array.isArray(summary.tags) ||
    summary.tags.length > LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAGS
  ) {
    return failure("facet summary values exceed their bounds");
  }
  const tags: string[] = [];
  for (const tag of summary.tags) {
    if (
      typeof tag !== "string" ||
      textEncoder.encode(tag).byteLength >
        LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_TAG_UTF8_BYTES ||
      (tags.at(-1) !== undefined && compareUtf8(tags.at(-1)!, tag) >= 0)
    ) {
      return failure("facet summary tags are invalid");
    }
    tags.push(tag);
  }
  const platformTotalCount = safeCountSum(
    platformCounts,
    (entry) => entry.totalCount,
  );
  const platformUnreadCount = safeCountSum(
    platformCounts,
    (entry) => entry.unreadCount,
  );
  const platformArchivableCount = safeCountSum(
    platformCounts,
    (entry) => entry.archivableCount,
  );
  if (
    (summary.archivedCount as number) > (summary.totalCount as number) ||
    (summary.archivableCount as number) > (summary.totalCount as number) ||
    (summary.enabledRssFeedCount as number) >
      (summary.rssFeedCount as number) ||
    (summary.sampleItemCount as number) > (summary.totalCount as number) ||
    (summary.savedCount as number) > (summary.totalCount as number) ||
    (summary.savedArchivedCount as number) >
      Math.min(summary.savedCount as number, summary.archivedCount as number) ||
    (summary.savedPlatformCount as number) > (summary.savedCount as number) ||
    platformTotalCount === null ||
    platformTotalCount !== (summary.totalCount as number) ||
    platformUnreadCount === null ||
    platformUnreadCount !== (summary.unreadCount as number) ||
    platformArchivableCount === null ||
    platformArchivableCount !== (summary.archivableCount as number)
  ) {
    return failure("facet summary counts are inconsistent");
  }
  const response: LibraryCoreFacetSummaryResponseV1 = Object.freeze({
    queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
    schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
    source: source.value,
    summary: Object.freeze({
      archivedCount: summary.archivedCount as number,
      archivableCount: summary.archivableCount as number,
      enabledRssFeedCount: summary.enabledRssFeedCount as number,
      friendPersonCount: summary.friendPersonCount as number,
      platformCounts: Object.freeze(platformCounts),
      rssFeedCount: summary.rssFeedCount as number,
      sampleAccountCount: summary.sampleAccountCount as number,
      sampleFeedCount: summary.sampleFeedCount as number,
      sampleItemCount: summary.sampleItemCount as number,
      samplePersonCount: summary.samplePersonCount as number,
      savedArchivedCount: summary.savedArchivedCount as number,
      savedCount: summary.savedCount as number,
      savedPlatformCount: summary.savedPlatformCount as number,
      socialAccountCount: summary.socialAccountCount as number,
      tags: Object.freeze(tags),
      totalCount: summary.totalCount as number,
      unreadCount: summary.unreadCount as number,
    }),
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_FACET_SUMMARY_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("facet summary response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
