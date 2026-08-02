import { invoke } from "@tauri-apps/api/core";
import type { FeedItem } from "@freed/shared";
import {
  reconstructFeedItem,
  type FeedItemRow,
} from "@freed/shared/projection";

import { getLibraryCoreProjectionSource } from "./automerge";
import type { LibraryCoreProjectionSourceV1 } from "./automerge-types";

const ITEM_DETAIL_QUERY_ID = "item_detail_v1";
const ITEM_SCAN_QUERY_ID = "background_item_page_v1";
const FACET_SUMMARY_QUERY_ID = "library_facet_summary_v1";
const SAVED_ANALYTICS_QUERY_ID = "saved_analytics_v1";
const SURFACE_ITEMS_QUERY_ID = "library_surface_items_v1";
const ITEM_DETAIL_SCHEMA_VERSION = 1;
const ITEM_SCAN_PAGE_LIMIT = 64;
const MAXIMUM_ITEM_SCAN_PAGES = 4_096;
let activeItemScan: Promise<void> | null = null;
export const LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY =
  "freed.libraryCore.itemDetailReaderV1.disabled";
export const LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY =
  "freed.libraryCore.savedAnalyticsReaderV1.disabled";
const ROW_KEYS = [
  "archived",
  "archivedAt",
  "authorDisplayName",
  "authorHandle",
  "authorId",
  "capturedAt",
  "contentBlob",
  "contentType",
  "globalId",
  "hidden",
  "likedAt",
  "platform",
  "preservedBlob",
  "publishedAt",
  "readAt",
  "rest",
  "saved",
  "sourceUrl",
  "tags",
] as const satisfies readonly (keyof FeedItemRow)[];
const RESPONSE_KEYS = ["item", "queryId", "schemaVersion", "source"] as const;
const ITEM_SCAN_RESPONSE_KEYS = [
  "nextCursor",
  "queryId",
  "rows",
  "schemaVersion",
  "source",
] as const;
const FACET_SUMMARY_RESPONSE_KEYS = [
  "queryId",
  "schemaVersion",
  "source",
  "summary",
] as const;
const FACET_SUMMARY_KEYS = [
  "archivedCount",
  "sampleItemCount",
  "savedArchivedCount",
  "savedCount",
  "savedPlatformCount",
  "tags",
  "totalCount",
] as const;
const SAVED_ANALYTICS_RESPONSE_KEYS = [
  "contentMix",
  "dailyCounts",
  "hourlyCounts",
  "latestSavedAt",
  "queryId",
  "schemaVersion",
  "source",
  "sourceCounts",
  "totalCount",
] as const;
const LABELED_COUNT_KEYS = ["count", "label"] as const;
const ANALYTICS_WINDOW_KEYS = ["endMs", "startMs"] as const;
const SURFACE_ITEMS_RESPONSE_KEYS = [
  "queryId",
  "rows",
  "schemaVersion",
  "source",
  "surface",
] as const;
const SOURCE_KEYS = [
  "documentId",
  "generationId",
  "headCount",
  "headsDigest",
  "projectionRevision",
  "storageGeneration",
  "storageSaveRevision",
  "transitionSequence",
] as const;

interface NativeItemDetailSourceV1 {
  readonly documentId: string;
  readonly generationId: string;
  readonly headCount: number;
  readonly headsDigest: string;
  readonly projectionRevision: number;
  readonly storageGeneration: number;
  readonly storageSaveRevision: number;
  readonly transitionSequence: number;
}

interface NativeItemDetailResponseV1 {
  readonly item: FeedItemRow | null;
  readonly queryId: typeof ITEM_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
}

interface NativeItemScanResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof ITEM_SCAN_QUERY_ID;
  readonly rows: FeedItemRow[];
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
}

export interface LibraryCoreFacetSummary {
  readonly archivedCount: number;
  readonly sampleItemCount: number;
  readonly savedArchivedCount: number;
  readonly savedCount: number;
  readonly savedPlatformCount: number;
  readonly tags: readonly string[];
  readonly totalCount: number;
}

export interface LibraryCoreSavedAnalyticsWindow {
  readonly endMs: number;
  readonly startMs: number;
}

export interface LibraryCoreSavedAnalyticsRequest {
  readonly dailyWindows: readonly LibraryCoreSavedAnalyticsWindow[];
  readonly hourlyWindows: readonly LibraryCoreSavedAnalyticsWindow[];
}

export interface LibraryCoreSavedAnalyticsLabeledCount {
  readonly count: number;
  readonly label: string;
}

export interface LibraryCoreSavedAnalytics {
  readonly contentMix: readonly LibraryCoreSavedAnalyticsLabeledCount[];
  readonly dailyCounts: readonly number[];
  readonly hourlyCounts: readonly number[];
  readonly latestSavedAt: number | null;
  readonly sourceCounts: readonly LibraryCoreSavedAnalyticsLabeledCount[];
  readonly totalCount: number;
}

export type LibraryCoreSurface = "map" | "story_wall";

const LIBRARY_CORE_SURFACE_LIMITS: Readonly<Record<LibraryCoreSurface, number>> =
  Object.freeze({
    map: 1_000,
    story_wall: 250,
  });

interface NativeFacetSummaryResponseV1 {
  readonly queryId: typeof FACET_SUMMARY_QUERY_ID;
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
  readonly summary: LibraryCoreFacetSummary;
}

interface NativeSavedAnalyticsResponseV1 {
  readonly contentMix: readonly LibraryCoreSavedAnalyticsLabeledCount[];
  readonly dailyCounts: readonly number[];
  readonly hourlyCounts: readonly number[];
  readonly latestSavedAt: number | null;
  readonly queryId: typeof SAVED_ANALYTICS_QUERY_ID;
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
  readonly sourceCounts: readonly LibraryCoreSavedAnalyticsLabeledCount[];
  readonly totalCount: number;
}

interface NativeSurfaceItemsResponseV1 {
  readonly queryId: typeof SURFACE_ITEMS_QUERY_ID;
  readonly rows: FeedItemRow[];
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
  readonly surface: LibraryCoreSurface;
}

export interface LibraryCoreItemScanPage {
  readonly items: readonly FeedItem[];
  readonly done: boolean;
}

export interface LibraryCoreItemScanSession {
  nextPage(): Promise<LibraryCoreItemScanPage>;
  close(): Promise<void>;
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
  const record = value as Record<string, unknown>;
  const ownKeys = Object.keys(record);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  return record;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableSafeInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}

function nullableBooleanColumn(value: unknown): value is 0 | 1 | null {
  return value === null || value === 0 || value === 1;
}

function parseRow(value: unknown, requestedId?: string): FeedItemRow {
  const row = closedRecord(value, ROW_KEYS);
  if (
    !row ||
    typeof row.globalId !== "string" ||
    row.globalId.length === 0 ||
    new TextEncoder().encode(row.globalId).length > 4_096 ||
    (requestedId !== undefined && row.globalId !== requestedId) ||
    !nullableString(row.platform) ||
    !nullableString(row.contentType) ||
    !nullableSafeInteger(row.publishedAt) ||
    !nullableSafeInteger(row.capturedAt) ||
    !nullableString(row.authorId) ||
    !nullableString(row.authorDisplayName) ||
    !nullableString(row.authorHandle) ||
    !nullableString(row.sourceUrl) ||
    !nullableBooleanColumn(row.hidden) ||
    !nullableBooleanColumn(row.saved) ||
    !nullableBooleanColumn(row.archived) ||
    !nullableSafeInteger(row.readAt) ||
    !nullableSafeInteger(row.archivedAt) ||
    !nullableSafeInteger(row.likedAt) ||
    !nullableString(row.tags) ||
    !nullableString(row.contentBlob) ||
    !nullableString(row.preservedBlob) ||
    typeof row.rest !== "string"
  ) {
    throw new Error("Library Core item detail row is invalid");
  }
  return row as unknown as FeedItemRow;
}

function parseItemScanResponse(value: unknown): NativeItemScanResponseV1 {
  const response = closedRecord(value, ITEM_SCAN_RESPONSE_KEYS);
  const source = closedRecord(response?.source, SOURCE_KEYS);
  if (
    !response ||
    !source ||
    response.queryId !== ITEM_SCAN_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    !nullableString(response.nextCursor) ||
    (typeof response.nextCursor === "string" &&
      response.nextCursor.length === 0) ||
    !Array.isArray(response.rows) ||
    response.rows.length > ITEM_SCAN_PAGE_LIMIT ||
    typeof source.documentId !== "string" ||
    source.documentId.length === 0 ||
    typeof source.generationId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.generationId) ||
    !safeInteger(source.headCount) ||
    typeof source.headsDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.headsDigest) ||
    !safeInteger(source.projectionRevision) ||
    !safeInteger(source.storageGeneration) ||
    !safeInteger(source.storageSaveRevision) ||
    !safeInteger(source.transitionSequence)
  ) {
    throw new Error("Library Core item scan response is invalid");
  }
  const rows = response.rows.map((row) => parseRow(row));
  return {
    nextCursor: response.nextCursor,
    queryId: ITEM_SCAN_QUERY_ID,
    rows,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source: source as unknown as NativeItemDetailSourceV1,
  };
}

function parseFacetSummaryResponse(value: unknown): NativeFacetSummaryResponseV1 {
  const response = closedRecord(value, FACET_SUMMARY_RESPONSE_KEYS);
  const source = closedRecord(response?.source, SOURCE_KEYS);
  const summary = closedRecord(response?.summary, FACET_SUMMARY_KEYS);
  if (
    !response ||
    !source ||
    !summary ||
    response.queryId !== FACET_SUMMARY_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    typeof source.documentId !== "string" ||
    source.documentId.length === 0 ||
    typeof source.generationId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.generationId) ||
    !safeInteger(source.headCount) ||
    typeof source.headsDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.headsDigest) ||
    !safeInteger(source.projectionRevision) ||
    !safeInteger(source.storageGeneration) ||
    !safeInteger(source.storageSaveRevision) ||
    !safeInteger(source.transitionSequence) ||
    !safeInteger(summary.archivedCount) ||
    !safeInteger(summary.sampleItemCount) ||
    !safeInteger(summary.savedArchivedCount) ||
    !safeInteger(summary.savedCount) ||
    !safeInteger(summary.savedPlatformCount) ||
    !safeInteger(summary.totalCount) ||
    !Array.isArray(summary.tags) ||
    summary.tags.length > 4_096 ||
    summary.tags.some(
      (tag) =>
        typeof tag !== "string" ||
        new TextEncoder().encode(tag).length > 1_024,
    )
  ) {
    throw new Error("Library Core facet summary response is invalid");
  }
  const tags = summary.tags as string[];
  if (
    tags.some((tag, index) => index > 0 && tags[index - 1]! >= tag) ||
    summary.savedArchivedCount > summary.savedCount ||
    summary.savedCount > summary.totalCount ||
    summary.archivedCount > summary.totalCount ||
    summary.sampleItemCount > summary.totalCount ||
    summary.savedPlatformCount > summary.totalCount
  ) {
    throw new Error("Library Core facet summary response is inconsistent");
  }
  return {
    queryId: FACET_SUMMARY_QUERY_ID,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source: source as unknown as NativeItemDetailSourceV1,
    summary: {
      archivedCount: summary.archivedCount,
      sampleItemCount: summary.sampleItemCount,
      savedArchivedCount: summary.savedArchivedCount,
      savedCount: summary.savedCount,
      savedPlatformCount: summary.savedPlatformCount,
      tags,
      totalCount: summary.totalCount,
    },
  };
}

function parseLabeledCounts(
  value: unknown,
  maximumEntries: number,
  maximumLabelBytes: number,
): LibraryCoreSavedAnalyticsLabeledCount[] | null {
  if (!Array.isArray(value) || value.length > maximumEntries) return null;
  const labels = new Set<string>();
  const result: LibraryCoreSavedAnalyticsLabeledCount[] = [];
  for (const candidate of value) {
    const entry = closedRecord(candidate, LABELED_COUNT_KEYS);
    if (
      !entry ||
      typeof entry.label !== "string" ||
      new TextEncoder().encode(entry.label).length > maximumLabelBytes ||
      !safeInteger(entry.count) ||
      entry.count === 0 ||
      labels.has(entry.label)
    ) {
      return null;
    }
    labels.add(entry.label);
    result.push({ count: entry.count, label: entry.label });
  }
  return result;
}

function parseSavedAnalyticsResponse(
  value: unknown,
): NativeSavedAnalyticsResponseV1 {
  const response = closedRecord(value, SAVED_ANALYTICS_RESPONSE_KEYS);
  const source = closedRecord(response?.source, SOURCE_KEYS);
  const sourceCounts = parseLabeledCounts(response?.sourceCounts, 4_096, 2_048);
  const contentMix = parseLabeledCounts(response?.contentMix, 64, 128);
  const totalCount = safeInteger(response?.totalCount)
    ? response.totalCount
    : null;
  if (
    !response ||
    !source ||
    !sourceCounts ||
    !contentMix ||
    response.queryId !== SAVED_ANALYTICS_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    typeof source.documentId !== "string" ||
    source.documentId.length === 0 ||
    typeof source.generationId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.generationId) ||
    !safeInteger(source.headCount) ||
    typeof source.headsDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.headsDigest) ||
    !safeInteger(source.projectionRevision) ||
    !safeInteger(source.storageGeneration) ||
    !safeInteger(source.storageSaveRevision) ||
    !safeInteger(source.transitionSequence) ||
    totalCount === null ||
    !(response.latestSavedAt === null || safeInteger(response.latestSavedAt)) ||
    !Array.isArray(response.dailyCounts) ||
    response.dailyCounts.length !== 7 ||
    response.dailyCounts.some(
      (count) => !safeInteger(count) || count > totalCount,
    ) ||
    !Array.isArray(response.hourlyCounts) ||
    response.hourlyCounts.length !== 24 ||
    response.hourlyCounts.some(
      (count) => !safeInteger(count) || count > totalCount,
    )
  ) {
    throw new Error("Library Core saved analytics response is invalid");
  }
  const dailyCounts = response.dailyCounts.map((count) => count as number);
  const hourlyCounts = response.hourlyCounts.map((count) => count as number);
  const sourceTotal = sourceCounts.reduce((sum, entry) => sum + entry.count, 0);
  const contentTotal = contentMix.reduce((sum, entry) => sum + entry.count, 0);
  if (
    !Number.isSafeInteger(sourceTotal) ||
    !Number.isSafeInteger(contentTotal) ||
    sourceTotal !== totalCount ||
    contentTotal !== totalCount ||
    (totalCount === 0) !== (response.latestSavedAt === null)
  ) {
    throw new Error("Library Core saved analytics response is inconsistent");
  }
  return {
    contentMix,
    dailyCounts,
    hourlyCounts,
    latestSavedAt: response.latestSavedAt,
    queryId: SAVED_ANALYTICS_QUERY_ID,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source: {
      documentId: source.documentId,
      generationId: source.generationId,
      headCount: source.headCount,
      headsDigest: source.headsDigest,
      projectionRevision: source.projectionRevision,
      storageGeneration: source.storageGeneration,
      storageSaveRevision: source.storageSaveRevision,
      transitionSequence: source.transitionSequence,
    } as NativeItemDetailSourceV1,
    sourceCounts,
    totalCount,
  };
}

function parseAnalyticsWindows(
  value: unknown,
  expectedLength: number,
  allowOneRepeatedWindow = false,
): LibraryCoreSavedAnalyticsWindow[] | null {
  if (!Array.isArray(value) || value.length !== expectedLength) return null;
  const windows: LibraryCoreSavedAnalyticsWindow[] = [];
  let repeatedWindowSeen = false;
  for (const candidate of value) {
    const window = closedRecord(candidate, ANALYTICS_WINDOW_KEYS);
    if (
      !window ||
      !safeInteger(window.startMs) ||
      !safeInteger(window.endMs) ||
      window.startMs >= window.endMs
    ) {
      return null;
    }
    const previous = windows.at(-1);
    if (previous && previous.endMs !== window.startMs) {
      const isAllowedRepeat =
        allowOneRepeatedWindow &&
        !repeatedWindowSeen &&
        previous.startMs === window.startMs &&
        previous.endMs === window.endMs;
      if (!isAllowedRepeat) return null;
      repeatedWindowSeen = true;
    }
    windows.push({ startMs: window.startMs, endMs: window.endMs });
  }
  return windows;
}

function parseSurfaceItemsResponse(
  value: unknown,
  requestedSurface: LibraryCoreSurface,
  limit: number,
): NativeSurfaceItemsResponseV1 {
  const response = closedRecord(value, SURFACE_ITEMS_RESPONSE_KEYS);
  const source = closedRecord(response?.source, SOURCE_KEYS);
  if (
    !response ||
    !source ||
    response.queryId !== SURFACE_ITEMS_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    response.surface !== requestedSurface ||
    !Array.isArray(response.rows) ||
    response.rows.length > limit ||
    typeof source.documentId !== "string" ||
    source.documentId.length === 0 ||
    typeof source.generationId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.generationId) ||
    !safeInteger(source.headCount) ||
    typeof source.headsDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.headsDigest) ||
    !safeInteger(source.projectionRevision) ||
    !safeInteger(source.storageGeneration) ||
    !safeInteger(source.storageSaveRevision) ||
    !safeInteger(source.transitionSequence)
  ) {
    throw new Error("Library Core surface items response is invalid");
  }
  return {
    queryId: SURFACE_ITEMS_QUERY_ID,
    rows: response.rows.map((row) => parseRow(row)),
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source: source as unknown as NativeItemDetailSourceV1,
    surface: requestedSurface,
  };
}

function sameSelectedSource(
  left: NativeItemDetailSourceV1,
  right: NativeItemDetailSourceV1,
): boolean {
  return SOURCE_KEYS.every((key) => left[key] === right[key]);
}

function newReaderOperationId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function parseResponse(
  value: unknown,
  requestedId: string,
): NativeItemDetailResponseV1 {
  const response = closedRecord(value, RESPONSE_KEYS);
  const source = closedRecord(response?.source, SOURCE_KEYS);
  if (
    !response ||
    !source ||
    response.queryId !== ITEM_DETAIL_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    typeof source.documentId !== "string" ||
    source.documentId.length === 0 ||
    typeof source.generationId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.generationId) ||
    !safeInteger(source.headCount) ||
    typeof source.headsDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.headsDigest) ||
    !safeInteger(source.projectionRevision) ||
    !safeInteger(source.storageGeneration) ||
    !safeInteger(source.storageSaveRevision) ||
    !safeInteger(source.transitionSequence)
  ) {
    throw new Error("Library Core item detail response is invalid");
  }
  return {
    item: response.item === null ? null : parseRow(response.item, requestedId),
    queryId: ITEM_DETAIL_QUERY_ID,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source: source as unknown as NativeItemDetailSourceV1,
  };
}

function sourceMatches(
  current: LibraryCoreProjectionSourceV1,
  selected: NativeItemDetailSourceV1,
): boolean {
  return (
    current.documentId === selected.documentId &&
    current.headsDigest === selected.headsDigest &&
    current.headCount === selected.headCount &&
    current.storageRevision.generation === selected.storageGeneration &&
    current.storageRevision.saveRevision === selected.storageSaveRevision
  );
}

/**
 * Read one lossless item from the authenticated immutable SQLite generation.
 * Source checks on both sides of the native read prevent a stale projection
 * from being presented after an Automerge mutation or cloud merge.
 */
export async function readLibraryCoreItemDetail(
  globalId: string,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    globalId: string;
    queryId: typeof ITEM_DETAIL_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  }) => Promise<unknown> = (request) =>
    invoke("read_library_core_item_detail", { request }),
): Promise<FeedItem | null> {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core item detail reader is disabled");
  }
  if (!globalId || new TextEncoder().encode(globalId).length > 4_096) {
    throw new Error("Library Core item identity is invalid");
  }
  const before = await getSource();
  const response = parseResponse(
    await readNative({
      globalId,
      queryId: ITEM_DETAIL_QUERY_ID,
      schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    }),
    globalId,
  );
  if (!sourceMatches(before, response.source)) {
    throw new Error("Library Core item detail source is stale");
  }
  const after = await getSource();
  if (!sourceMatches(after, response.source)) {
    throw new Error("Library Core item detail source changed during read");
  }
  if (response.item === null) return null;
  return reconstructFeedItem(response.item) as unknown as FeedItem;
}

/** Read exact corpus-wide counts and tags from the selected SQLite generation. */
export async function readLibraryCoreFacetSummary(
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    queryId: typeof FACET_SUMMARY_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  }) => Promise<unknown> = (request) =>
    invoke("read_library_core_facet_summary", { request }),
): Promise<LibraryCoreFacetSummary> {
  const before = await getSource();
  const response = parseFacetSummaryResponse(
    await readNative({
      queryId: FACET_SUMMARY_QUERY_ID,
      schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    }),
  );
  if (!sourceMatches(before, response.source)) {
    throw new Error("Library Core facet summary source is stale");
  }
  const after = await getSource();
  if (!sourceMatches(after, response.source)) {
    throw new Error("Library Core facet summary source changed during read");
  }
  return response.summary;
}

/** Read exact Saved overview aggregates from the selected SQLite generation. */
export async function readLibraryCoreSavedAnalytics(
  request: LibraryCoreSavedAnalyticsRequest,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    dailyWindows: readonly LibraryCoreSavedAnalyticsWindow[];
    hourlyWindows: readonly LibraryCoreSavedAnalyticsWindow[];
    queryId: typeof SAVED_ANALYTICS_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  }) => Promise<unknown> = (nativeRequest) =>
    invoke("read_library_core_saved_analytics", { request: nativeRequest }),
): Promise<LibraryCoreSavedAnalytics> {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY) ===
      "1"
  ) {
    throw new Error("Library Core Saved analytics reader is disabled");
  }
  const dailyWindows = parseAnalyticsWindows(request.dailyWindows, 7);
  const hourlyWindows = parseAnalyticsWindows(request.hourlyWindows, 24, true);
  if (!dailyWindows || !hourlyWindows) {
    throw new Error("Library Core saved analytics windows are invalid");
  }
  const before = await getSource();
  const response = parseSavedAnalyticsResponse(
    await readNative({
      dailyWindows,
      hourlyWindows,
      queryId: SAVED_ANALYTICS_QUERY_ID,
      schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    }),
  );
  if (!sourceMatches(before, response.source)) {
    throw new Error("Library Core saved analytics source is stale");
  }
  const after = await getSource();
  if (!sourceMatches(after, response.source)) {
    throw new Error("Library Core saved analytics source changed during read");
  }
  return {
    contentMix: response.contentMix,
    dailyCounts: response.dailyCounts,
    hourlyCounts: response.hourlyCounts,
    latestSavedAt: response.latestSavedAt,
    sourceCounts: response.sourceCounts,
    totalCount: response.totalCount,
  };
}

/** Read one bounded, SQLite-filtered result set for a secondary surface. */
export async function readLibraryCoreSurfaceItems(
  surface: LibraryCoreSurface,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    limit: number;
    queryId: typeof SURFACE_ITEMS_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
    surface: LibraryCoreSurface;
  }) => Promise<unknown> = (request) =>
    invoke("read_library_core_surface_items", { request }),
): Promise<readonly FeedItem[]> {
  const limit = LIBRARY_CORE_SURFACE_LIMITS[surface];
  const before = await getSource();
  const response = parseSurfaceItemsResponse(
    await readNative({
      limit,
      queryId: SURFACE_ITEMS_QUERY_ID,
      schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
      surface,
    }),
    surface,
    limit,
  );
  if (!sourceMatches(before, response.source)) {
    throw new Error("Library Core surface items source is stale");
  }
  const after = await getSource();
  if (!sourceMatches(after, response.source)) {
    throw new Error("Library Core surface items source changed during read");
  }
  return response.rows.map(
    (row) => reconstructFeedItem(row) as unknown as FeedItem,
  );
}

/**
 * Stream every lossless item from one authenticated immutable SQLite
 * generation. At most one native page and one reconstructed page are retained
 * at a time, so background maintenance cost is independent of Library size.
 */
export async function openLibraryCoreItemScanSession(
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    cancellationId: string;
    cursor: string | null;
    limit: number;
    queryId: typeof ITEM_SCAN_QUERY_ID;
    readerSessionId: string;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  }) => Promise<unknown> = (request) =>
    invoke("read_library_core_item_scan_page", { request }),
  cancelNative: (
    readerSessionId: string,
    cancellationId: string,
  ) => Promise<unknown> = (readerSessionId, cancellationId) =>
    invoke("cancel_library_core_feed_reader", {
      readerSessionId,
      cancellationId,
    }),
): Promise<LibraryCoreItemScanSession> {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core item scan reader is disabled");
  }
  const before = await getSource();
  const readerSessionId = newReaderOperationId("item-scan-reader");
  let cursor: string | null = null;
  let selectedSource: NativeItemDetailSourceV1 | null = null;
  let previousGlobalId: string | null = null;
  let lastCompletedCancellationId: string | null = null;
  let exhausted = false;
  let closed = false;
  let pageInFlight = false;
  let pageNumber = 0;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (!exhausted && lastCompletedCancellationId !== null) {
      await cancelNative(readerSessionId, lastCompletedCancellationId).catch(
        () => undefined,
      );
    }
  };

  return {
    async nextPage(): Promise<LibraryCoreItemScanPage> {
      if (closed) {
        throw new Error("Library Core item scan session is closed");
      }
      if (pageInFlight) {
        throw new Error("Library Core item scan page is already running");
      }
      if (exhausted) return { items: [], done: true };
      if (pageNumber >= MAXIMUM_ITEM_SCAN_PAGES) {
        await close();
        throw new Error("Library Core item scan exceeded its page bound");
      }
      pageNumber += 1;
      pageInFlight = true;
      const cancellationId = newReaderOperationId("item-scan-page");
      let rawResponse: unknown;
      try {
        rawResponse = await readNative({
          cancellationId,
          cursor,
          limit: ITEM_SCAN_PAGE_LIMIT,
          queryId: ITEM_SCAN_QUERY_ID,
          readerSessionId,
          schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
        });
      } catch (error) {
        pageInFlight = false;
        await close();
        throw error;
      }
      lastCompletedCancellationId = cancellationId;
      let response: NativeItemScanResponseV1;
      try {
        response = parseItemScanResponse(rawResponse);
      } catch (error) {
        pageInFlight = false;
        await close();
        throw error;
      }
      if (!sourceMatches(before, response.source)) {
        pageInFlight = false;
        await close();
        throw new Error("Library Core item scan source is stale");
      }
      if (
        selectedSource &&
        !sameSelectedSource(selectedSource, response.source)
      ) {
        pageInFlight = false;
        await close();
        throw new Error("Library Core item scan generation changed");
      }
      selectedSource ??= response.source;
      for (const row of response.rows) {
        if (previousGlobalId !== null && row.globalId <= previousGlobalId) {
          pageInFlight = false;
          await close();
          throw new Error("Library Core item scan order is invalid");
        }
        previousGlobalId = row.globalId;
      }
      if (response.rows.length === 0 && response.nextCursor !== null) {
        pageInFlight = false;
        await close();
        throw new Error("Library Core item scan cursor made no progress");
      }
      let items: FeedItem[];
      try {
        items = response.rows.map(
          (row) => reconstructFeedItem(row) as unknown as FeedItem,
        );
      } catch (error) {
        pageInFlight = false;
        await close();
        throw error;
      }
      if (response.nextCursor === null) {
        let after: LibraryCoreProjectionSourceV1;
        try {
          after = await getSource();
        } catch (error) {
          pageInFlight = false;
          await close();
          throw error;
        }
        if (!sourceMatches(after, response.source)) {
          pageInFlight = false;
          await close();
          throw new Error("Library Core item scan source changed during read");
        }
        exhausted = true;
        pageInFlight = false;
        return { items, done: true };
      }
      if (response.nextCursor === cursor) {
        pageInFlight = false;
        await close();
        throw new Error("Library Core item scan cursor repeated");
      }
      cursor = response.nextCursor;
      pageInFlight = false;
      return { items, done: false };
    },
    close,
  };
}

async function scanLibraryCoreItemsExclusive(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative?: Parameters<typeof openLibraryCoreItemScanSession>[1],
  cancelNative?: Parameters<typeof openLibraryCoreItemScanSession>[2],
): Promise<void> {
  const session = await openLibraryCoreItemScanSession(
    getSource,
    readNative,
    cancelNative,
  );
  try {
    while (true) {
      const page = await session.nextPage();
      await visitPage(page.items);
      if (page.done) return;
    }
  } finally {
    await session.close();
  }
}

export async function scanLibraryCoreItems(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative?: Parameters<typeof scanLibraryCoreItemsExclusive>[2],
  cancelNative?: Parameters<typeof scanLibraryCoreItemsExclusive>[3],
): Promise<void> {
  while (activeItemScan !== null) {
    try {
      await activeItemScan;
    } catch {
      // A failed prior consumer must not prevent the next bounded scan.
    }
  }

  const current = scanLibraryCoreItemsExclusive(
    visitPage,
    getSource,
    readNative,
    cancelNative,
  );
  activeItemScan = current;
  try {
    await current;
  } finally {
    if (activeItemScan === current) activeItemScan = null;
  }
}
