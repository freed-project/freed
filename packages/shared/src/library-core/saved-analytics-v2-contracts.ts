import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";

export const LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID =
  "saved_analytics_v2" as const;
export const LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION = 2 as const;
export const LIBRARY_CORE_SAVED_ANALYTICS_V2_DAILY_WINDOW_COUNT = 7;
export const LIBRARY_CORE_SAVED_ANALYTICS_V2_HOURLY_WINDOW_COUNT = 24;
export const LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_SOURCE_LABELS = 64;
export const LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_CONTENT_TYPES = 64;
export const LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_LABEL_UTF8_BYTES = 256;
export const LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;

export const LIBRARY_CORE_SAVED_ANALYTICS_V2_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_saved_analytics_request_v2",
  schemaVersion: LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID,
  canonicalKeys: Object.freeze([
    "dailyWindows",
    "hourlyWindows",
    "queryId",
    "schemaVersion",
  ]),
  windowKeys: Object.freeze(["endMs", "startMs"]),
  dailyWindowCount: LIBRARY_CORE_SAVED_ANALYTICS_V2_DAILY_WINDOW_COUNT,
  hourlyWindowCount: LIBRARY_CORE_SAVED_ANALYTICS_V2_HOURLY_WINDOW_COUNT,
});

export const LIBRARY_CORE_SAVED_ANALYTICS_V2_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_saved_analytics_response_v2",
  schemaVersion: LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID,
  canonicalKeys: Object.freeze([
    "contentMix",
    "dailyCounts",
    "hourlyCounts",
    "latestSavedAt",
    "queryId",
    "schemaVersion",
    "source",
    "sourceCounts",
    "totalCount",
  ]),
  countKeys: Object.freeze(["count", "label"]),
  maximumResponseBytes: LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_SAVED_ANALYTICS_V2_PROJECTION = Object.freeze({
  projectionId: "library_core_saved_analytics_v2",
  sourceTable: "library_feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["label"]),
});

export const LIBRARY_CORE_SAVED_ANALYTICS_V2_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_normalized_query_source_v1",
  generationId: "sha256_materialization_generation",
  transitionSequence: "source_revision",
  projectionRevision: "source_revision",
  sessionPinned: true,
});

export const LIBRARY_CORE_SAVED_ANALYTICS_V2_NESTED_BOUNDS = Object.freeze({
  sourceCounts: Object.freeze({
    maximumItems: LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_SOURCE_LABELS,
    maximumUtf8BytesPerItem:
      LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_LABEL_UTF8_BYTES,
  }),
  contentMix: Object.freeze({
    maximumItems: LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_CONTENT_TYPES,
    maximumUtf8BytesPerItem:
      LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_LABEL_UTF8_BYTES,
  }),
  dailyCounts: Object.freeze({
    maximumItems: LIBRARY_CORE_SAVED_ANALYTICS_V2_DAILY_WINDOW_COUNT,
  }),
  hourlyCounts: Object.freeze({
    maximumItems: LIBRARY_CORE_SAVED_ANALYTICS_V2_HOURLY_WINDOW_COUNT,
  }),
});

export interface LibraryCoreSavedAnalyticsWindowV2 {
  readonly endMs: number;
  readonly startMs: number;
}

export interface LibraryCoreSavedAnalyticsCountV2 {
  readonly count: number;
  readonly label: string;
}

export interface LibraryCoreSavedAnalyticsRequestV2 {
  readonly dailyWindows: readonly LibraryCoreSavedAnalyticsWindowV2[];
  readonly hourlyWindows: readonly LibraryCoreSavedAnalyticsWindowV2[];
  readonly queryId: typeof LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION;
}

export interface LibraryCoreSavedAnalyticsResponseV2 {
  readonly contentMix: readonly LibraryCoreSavedAnalyticsCountV2[];
  readonly dailyCounts: readonly number[];
  readonly hourlyCounts: readonly number[];
  readonly latestSavedAt: number | null;
  readonly queryId: typeof LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly sourceCounts: readonly LibraryCoreSavedAnalyticsCountV2[];
  readonly totalCount: number;
}

const REQUEST_KEYS =
  LIBRARY_CORE_SAVED_ANALYTICS_V2_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_SAVED_ANALYTICS_V2_RESPONSE_SCHEMA.canonicalKeys;
const WINDOW_KEYS = LIBRARY_CORE_SAVED_ANALYTICS_V2_REQUEST_SCHEMA.windowKeys;
const COUNT_KEYS = LIBRARY_CORE_SAVED_ANALYTICS_V2_RESPONSE_SCHEMA.countKeys;
const TEXT_ENCODER = new TextEncoder();

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

function parseWindows(
  value: unknown,
  expectedCount: number,
): readonly LibraryCoreSavedAnalyticsWindowV2[] | null {
  if (!Array.isArray(value) || value.length !== expectedCount) return null;
  const windows: LibraryCoreSavedAnalyticsWindowV2[] = [];
  for (const candidate of value) {
    const window = closedRecord(candidate, WINDOW_KEYS);
    if (
      !window ||
      !Number.isSafeInteger(window.startMs) ||
      !Number.isSafeInteger(window.endMs) ||
      (window.startMs as number) < 0 ||
      (window.endMs as number) <= (window.startMs as number) ||
      (windows.at(-1)?.endMs ?? window.startMs) !== window.startMs
    ) {
      return null;
    }
    windows.push(
      Object.freeze({
        endMs: window.endMs as number,
        startMs: window.startMs as number,
      }),
    );
  }
  return Object.freeze(windows);
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = TEXT_ENCODER.encode(left);
  const rightBytes = TEXT_ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index]! - rightBytes[index]!;
    }
  }
  return leftBytes.length - rightBytes.length;
}

function parseCounts(
  value: unknown,
  maximumItems: number,
): readonly LibraryCoreSavedAnalyticsCountV2[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const counts: LibraryCoreSavedAnalyticsCountV2[] = [];
  for (const candidate of value) {
    const count = closedRecord(candidate, COUNT_KEYS);
    if (
      !count ||
      typeof count.label !== "string" ||
      TEXT_ENCODER.encode(count.label).byteLength >
        LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_LABEL_UTF8_BYTES ||
      !Number.isSafeInteger(count.count) ||
      (count.count as number) < 1 ||
      (counts.at(-1) !== undefined &&
        compareUtf8(counts.at(-1)!.label, count.label) >= 0)
    ) {
      return null;
    }
    counts.push(
      Object.freeze({ count: count.count as number, label: count.label }),
    );
  }
  return Object.freeze(counts);
}

function parseCountSeries(
  value: unknown,
  expectedCount: number,
): readonly number[] | null {
  if (
    !Array.isArray(value) ||
    value.length !== expectedCount ||
    value.some((count) => !Number.isSafeInteger(count) || count < 0)
  ) {
    return null;
  }
  return Object.freeze([...value]) as readonly number[];
}

export function parseLibraryCoreSavedAnalyticsRequestV2(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSavedAnalyticsRequestV2> {
  const record = closedRecord(value, REQUEST_KEYS);
  const dailyWindows = parseWindows(
    record?.dailyWindows,
    LIBRARY_CORE_SAVED_ANALYTICS_V2_DAILY_WINDOW_COUNT,
  );
  const hourlyWindows = parseWindows(
    record?.hourlyWindows,
    LIBRARY_CORE_SAVED_ANALYTICS_V2_HOURLY_WINDOW_COUNT,
  );
  if (
    !record ||
    !dailyWindows ||
    !hourlyWindows ||
    record.queryId !== LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION
  ) {
    return failure("saved analytics request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      dailyWindows,
      hourlyWindows,
      queryId: LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID,
      schemaVersion: LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION,
    }),
  });
}

export function parseLibraryCoreSavedAnalyticsResponseV2(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreSavedAnalyticsResponseV2> {
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  const contentMix = parseCounts(
    record?.contentMix,
    LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_CONTENT_TYPES,
  );
  const sourceCounts = parseCounts(
    record?.sourceCounts,
    LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_SOURCE_LABELS,
  );
  const dailyCounts = parseCountSeries(
    record?.dailyCounts,
    LIBRARY_CORE_SAVED_ANALYTICS_V2_DAILY_WINDOW_COUNT,
  );
  const hourlyCounts = parseCountSeries(
    record?.hourlyCounts,
    LIBRARY_CORE_SAVED_ANALYTICS_V2_HOURLY_WINDOW_COUNT,
  );
  if (
    !record ||
    !source.ok ||
    !contentMix ||
    !sourceCounts ||
    !dailyCounts ||
    !hourlyCounts ||
    record.queryId !== LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION ||
    !Number.isSafeInteger(record.totalCount) ||
    (record.totalCount as number) < 0 ||
    (record.latestSavedAt !== null &&
      (!Number.isSafeInteger(record.latestSavedAt) ||
        (record.latestSavedAt as number) < 0))
  ) {
    return failure("saved analytics response is invalid");
  }
  const totalCount = record.totalCount as number;
  if (
    [...contentMix, ...sourceCounts].some(
      (count) => count.count > totalCount,
    ) ||
    contentMix.reduce((sum, count) => sum + count.count, 0) !== totalCount ||
    sourceCounts.reduce((sum, count) => sum + count.count, 0) !== totalCount ||
    [...dailyCounts, ...hourlyCounts].some((count) => count > totalCount) ||
    (totalCount === 0) !== (record.latestSavedAt === null)
  ) {
    return failure("saved analytics response counts are inconsistent");
  }
  const response: LibraryCoreSavedAnalyticsResponseV2 = Object.freeze({
    contentMix,
    dailyCounts,
    hourlyCounts,
    latestSavedAt: record.latestSavedAt as number | null,
    queryId: LIBRARY_CORE_SAVED_ANALYTICS_V2_QUERY_ID,
    schemaVersion: LIBRARY_CORE_SAVED_ANALYTICS_V2_SCHEMA_VERSION,
    source: source.value,
    sourceCounts,
    totalCount,
  });
  if (
    TEXT_ENCODER.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_SAVED_ANALYTICS_V2_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("saved analytics response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
