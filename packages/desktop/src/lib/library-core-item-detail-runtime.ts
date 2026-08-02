import { invoke } from "@tauri-apps/api/core";
import {
  CONTENT_SIGNAL_KEYS,
  extractLocationFromItem,
  isLocationItemVisibleInTimeMode,
  type ContentSignal,
  type FeedItem,
} from "@freed/shared";
import {
  isLibraryCoreEntityId,
  parseLibraryCoreFeedCardV1,
  type LibraryCoreFeedCardV1,
  LIBRARY_CORE_SAVED_ANALYTICS_DAILY_WINDOW_COUNT,
  LIBRARY_CORE_SAVED_ANALYTICS_HOURLY_WINDOW_COUNT,
  LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA,
} from "@freed/shared/library-core";
import {
  reconstructFeedItem,
  type FeedItemRow,
} from "@freed/shared/projection";

import { getLibraryCoreProjectionSource } from "./automerge";
import type { LibraryCoreProjectionSourceV1 } from "./automerge-types";
import { feedCardToItem } from "./library-core-feed-browse-reader-runtime";

const ITEM_DETAIL_QUERY_ID = "item_detail_v1";
const ITEM_SCAN_QUERY_ID = "background_item_page_v1";
const FACET_SUMMARY_QUERY_ID = "library_facet_summary_v1";
const FRIENDS_GRAPH_QUERY_ID = "persons_graph_v1";
const PERSON_TIMELINE_QUERY_ID = "person_timeline_v1";
const SAVED_ANALYTICS_QUERY_ID = "saved_analytics_v1";
const SURFACE_ITEMS_QUERY_ID = "library_surface_items_v1";
const ITEM_DETAIL_SCHEMA_VERSION = 1;
const ITEM_SCAN_PAGE_LIMIT = 64;
const MAXIMUM_ITEM_SCAN_PAGES = 4_096;
const MAXIMUM_FRIEND_GRAPH_KEYS = 5_000;
const MAXIMUM_FRIEND_GRAPH_RESPONSE_BYTES = 8 * 1_048_576;
const MAXIMUM_FRIEND_REQUEST_BYTES = 2 * 1_048_576;
const MAXIMUM_FRIEND_SOURCE_TOKEN_BYTES = 32_768;
const MAXIMUM_PERSON_TIMELINE_LIMIT = 100;
const DEFAULT_PERSON_TIMELINE_LIMIT = 50;
const MAXIMUM_PERSON_TIMELINE_CURSOR_BYTES = 5_600;
const MAXIMUM_PERSON_TIMELINE_RESPONSE_BYTES = 2 * 1_048_576;
const MAXIMUM_FRIEND_SAMPLE_ITEMS = 5;
const MAXIMUM_FRIEND_LOCATION_CANDIDATES = 8;
let activeItemScan: Promise<void> | null = null;
export const LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY =
  "freed.libraryCore.itemDetailReaderV1.disabled";
export const LIBRARY_CORE_FRIENDS_READER_DISABLED_KEY =
  "freed.libraryCore.friendsReaderV1.disabled";
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
const FRIEND_SOURCE_KEYS = ["authorId", "platform"] as const;
const FRIEND_RECENT_WINDOW_KEYS = ["endMs", "startMs"] as const;
const FRIEND_SAMPLE_ITEM_KEYS = ["globalId", "publishedAt"] as const;
const FRIEND_LOCATION_CANDIDATE_KEYS = [
  "effectiveAt",
  "globalId",
  "publishedAt",
] as const;
const FRIEND_LOCATION_ITEM_REQUEST_KEYS = [
  "effectiveAt",
  "globalId",
  "owner",
  "publishedAt",
  "referenceTimeMs",
  "sourceToken",
] as const;
const FRIEND_LOCATION_SOCIAL_OWNER_KEYS = [
  "authorId",
  "kind",
  "platform",
] as const;
const FRIEND_LOCATION_RSS_OWNER_KEYS = ["feedUrl", "kind"] as const;
const FRIEND_SIGNAL_COUNT_KEYS = ["count", "label"] as const;
const FRIEND_SOCIAL_ACTIVITY_KEYS = [
  "authorId",
  "avatarGlobalId",
  "avatarPublishedAt",
  "avatarUrl",
  "hasLocation",
  "itemCount",
  "latestActivityAt",
  "locationCandidateCount",
  "locationCandidates",
  "platform",
  "recentCount",
  "sampleItems",
  "signalCounts",
] as const;
const FRIEND_RSS_ACTIVITY_KEYS = [
  "avatarGlobalId",
  "avatarPublishedAt",
  "avatarUrl",
  "feedUrl",
  "hasLocation",
  "itemCount",
  "latestActivityAt",
  "locationCandidateCount",
  "locationCandidates",
  "sampleItems",
] as const;
const FRIENDS_GRAPH_RESPONSE_KEYS = [
  "queryId",
  "rss",
  "schemaVersion",
  "social",
  "source",
  "totalItemCount",
] as const;
const PERSON_TIMELINE_RESPONSE_KEYS = [
  "nextCursor",
  "queryId",
  "rows",
  "schemaVersion",
  "source",
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

export interface LibraryFriendsSource {
  readonly platform: string;
  readonly authorId: string;
}

export interface LibraryFriendsRecentWindow {
  readonly startMs: number;
  readonly endMs: number;
}

export interface LibraryFriendsGraphRequest {
  readonly sources: readonly LibraryFriendsSource[];
  readonly rssFeedUrls: readonly string[];
  readonly recentWindow: LibraryFriendsRecentWindow;
}

export interface LibraryFriendsGraphSampleItem {
  readonly globalId: string;
  readonly publishedAt: number;
}

export interface LibraryFriendsGraphSignalCount {
  readonly label: ContentSignal;
  readonly count: number;
}

export interface LibraryFriendsGraphLocationCandidate {
  readonly effectiveAt: number;
  readonly globalId: string;
  readonly publishedAt: number;
}

export interface LibraryFriendsGraphSocialActivity {
  readonly platform: string;
  readonly authorId: string;
  readonly itemCount: number;
  readonly latestActivityAt: number;
  readonly hasLocation: boolean;
  readonly locationCandidateCount: number;
  readonly locationCandidates: readonly LibraryFriendsGraphLocationCandidate[];
  readonly avatarGlobalId: string | null;
  readonly avatarPublishedAt: number | null;
  readonly avatarUrl: string | null;
  readonly sampleItems: readonly LibraryFriendsGraphSampleItem[];
  readonly recentCount: number;
  readonly signalCounts: readonly LibraryFriendsGraphSignalCount[];
}

export interface LibraryFriendsGraphRssActivity {
  readonly feedUrl: string;
  readonly itemCount: number;
  readonly latestActivityAt: number;
  readonly hasLocation: boolean;
  readonly locationCandidateCount: number;
  readonly locationCandidates: readonly LibraryFriendsGraphLocationCandidate[];
  readonly avatarGlobalId: string | null;
  readonly avatarPublishedAt: number | null;
  readonly avatarUrl: string | null;
  readonly sampleItems: readonly LibraryFriendsGraphSampleItem[];
}

export interface LibraryFriendsGraph {
  readonly sourceToken: string;
  readonly totalItemCount: number;
  readonly social: readonly LibraryFriendsGraphSocialActivity[];
  readonly rss: readonly LibraryFriendsGraphRssActivity[];
}

export type LibraryFriendsLocationOwner =
  | {
      readonly kind: "social";
      readonly platform: string;
      readonly authorId: string;
    }
  | {
      readonly kind: "rss";
      readonly feedUrl: string;
    };

export interface LibraryFriendsLocationItemRequest
  extends LibraryFriendsGraphLocationCandidate {
  readonly owner: LibraryFriendsLocationOwner;
  readonly referenceTimeMs: number;
  readonly sourceToken: string;
}

export interface LibraryPersonTimelineRequest {
  readonly sources: readonly LibraryFriendsSource[];
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface LibraryPersonTimelinePage {
  readonly items: readonly FeedItem[];
  readonly totalCount: number;
  readonly nextCursor: string | null;
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

interface NativeFriendsGraphResponseV1 {
  readonly queryId: typeof FRIENDS_GRAPH_QUERY_ID;
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
  readonly totalItemCount: number;
  readonly social: readonly LibraryFriendsGraphSocialActivity[];
  readonly rss: readonly LibraryFriendsGraphRssActivity[];
}

interface NativePersonTimelineResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof PERSON_TIMELINE_QUERY_ID;
  readonly rows: readonly LibraryCoreFeedCardV1[];
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
  readonly totalCount: number;
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

const UTF8_ENCODER = new TextEncoder();
const CONTENT_SIGNAL_INDEX = new Map<string, number>(
  CONTENT_SIGNAL_KEYS.map((signal, index) => [signal, index]),
);

function unicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function boundedUnicodeString(
  value: unknown,
  maximumBytes: number,
  allowEmpty = false,
  maximumScalars = maximumBytes,
): value is string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    !unicodeScalarString(value) ||
    UTF8_ENCODER.encode(value).length > maximumBytes
  ) {
    return false;
  }
  let scalarCount = 0;
  for (const _scalar of value) {
    scalarCount += 1;
    if (scalarCount > maximumScalars) return false;
  }
  return true;
}

function jsonByteLength(value: unknown): number | null {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? UTF8_ENCODER.encode(encoded).length : null;
  } catch {
    return null;
  }
}

function canonicalUnpaddedBase64Url(
  value: unknown,
  maximumBytes: number,
): value is string {
  if (
    !boundedUnicodeString(value, maximumBytes) ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    return false;
  }
  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/")
      + "=".repeat((4 - (value.length % 4)) % 4);
    const decoded = atob(padded);
    return btoa(decoded)
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, "") === value;
  } catch {
    return false;
  }
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function compareFriendSources(
  left: LibraryFriendsSource,
  right: LibraryFriendsSource,
): number {
  const platformOrder = compareUtf8(left.platform, right.platform);
  return platformOrder === 0
    ? compareUtf8(left.authorId, right.authorId)
    : platformOrder;
}

function parseFriendSources(value: unknown): LibraryFriendsSource[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_FRIEND_GRAPH_KEYS) {
    return null;
  }
  const sources: LibraryFriendsSource[] = [];
  for (const candidate of value) {
    const source = closedRecord(candidate, FRIEND_SOURCE_KEYS);
    if (
      !source ||
      !boundedUnicodeString(source.platform, 256, false, 64) ||
      !boundedUnicodeString(source.authorId, 16_384, false, 4_096)
    ) {
      return null;
    }
    sources.push({ platform: source.platform, authorId: source.authorId });
  }
  sources.sort(compareFriendSources);
  if (
    sources.some(
      (source, index) =>
        index > 0 && compareFriendSources(sources[index - 1]!, source) === 0,
    )
  ) {
    return null;
  }
  return sources;
}

function parseRssFeedUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_FRIEND_GRAPH_KEYS) {
    return null;
  }
  const urls: string[] = [];
  for (const candidate of value) {
    if (!boundedUnicodeString(candidate, 8_192, false, 2_048)) return null;
    urls.push(candidate);
  }
  urls.sort(compareUtf8);
  if (urls.some((url, index) => index > 0 && urls[index - 1] === url)) {
    return null;
  }
  return urls;
}

function parseFriendsRecentWindow(
  value: unknown,
): LibraryFriendsRecentWindow | null {
  const window = closedRecord(value, FRIEND_RECENT_WINDOW_KEYS);
  if (
    !window ||
    !safeInteger(window.startMs) ||
    !safeInteger(window.endMs) ||
    window.startMs >= window.endMs
  ) {
    return null;
  }
  return { startMs: window.startMs, endMs: window.endMs };
}

function parseNativeSource(value: unknown): NativeItemDetailSourceV1 | null {
  const source = closedRecord(value, SOURCE_KEYS);
  if (
    !source ||
    !boundedUnicodeString(source.documentId, 16_384) ||
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
    return null;
  }
  return {
    documentId: source.documentId,
    generationId: source.generationId,
    headCount: source.headCount,
    headsDigest: source.headsDigest,
    projectionRevision: source.projectionRevision,
    storageGeneration: source.storageGeneration,
    storageSaveRevision: source.storageSaveRevision,
    transitionSequence: source.transitionSequence,
  };
}

function encodeNativeSourceToken(source: NativeItemDetailSourceV1): string {
  return JSON.stringify(source);
}

function parseNativeSourceToken(value: unknown): NativeItemDetailSourceV1 | null {
  if (
    !boundedUnicodeString(value, MAXIMUM_FRIEND_SOURCE_TOKEN_BYTES) ||
    UTF8_ENCODER.encode(value).length > MAXIMUM_FRIEND_SOURCE_TOKEN_BYTES
  ) {
    return null;
  }
  try {
    return parseNativeSource(JSON.parse(value));
  } catch {
    return null;
  }
}

function assertFriendsReaderEnabled(): void {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_FRIENDS_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core Friends reader is disabled");
  }
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

function parseFriendSampleItems(
  value: unknown,
  itemCount: number,
  latestActivityAt: number,
): LibraryFriendsGraphSampleItem[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAXIMUM_FRIEND_SAMPLE_ITEMS ||
    value.length > itemCount
  ) {
    return null;
  }
  const ids = new Set<string>();
  const samples: LibraryFriendsGraphSampleItem[] = [];
  for (const candidate of value) {
    const sample = closedRecord(candidate, FRIEND_SAMPLE_ITEM_KEYS);
    if (
      !sample ||
      !isLibraryCoreEntityId(sample.globalId) ||
      !safeInteger(sample.publishedAt) ||
      sample.publishedAt > latestActivityAt ||
      ids.has(sample.globalId)
    ) {
      return null;
    }
    ids.add(sample.globalId);
    samples.push({
      globalId: sample.globalId,
      publishedAt: sample.publishedAt,
    });
  }
  if (
    samples.some((sample, index) => {
      if (index === 0) return false;
      const previous = samples[index - 1]!;
      return (
        previous.publishedAt < sample.publishedAt ||
        (previous.publishedAt === sample.publishedAt &&
          compareUtf8(previous.globalId, sample.globalId) >= 0)
      );
    })
  ) {
    return null;
  }
  return samples;
}

function parseFriendSignalCounts(
  value: unknown,
  itemCount: number,
): LibraryFriendsGraphSignalCount[] | null {
  if (!Array.isArray(value) || value.length > CONTENT_SIGNAL_KEYS.length) {
    return null;
  }
  let previousIndex = -1;
  const counts: LibraryFriendsGraphSignalCount[] = [];
  for (const candidate of value) {
    const entry = closedRecord(candidate, FRIEND_SIGNAL_COUNT_KEYS);
    const signalIndex =
      typeof entry?.label === "string"
        ? CONTENT_SIGNAL_INDEX.get(entry.label)
        : undefined;
    if (
      !entry ||
      signalIndex === undefined ||
      signalIndex <= previousIndex ||
      !safeInteger(entry.count) ||
      entry.count === 0 ||
      entry.count > itemCount
    ) {
      return null;
    }
    previousIndex = signalIndex;
    counts.push({
      label: entry.label as ContentSignal,
      count: entry.count,
    });
  }
  return counts;
}

interface ParsedFriendAvatar {
  readonly avatarGlobalId: string | null;
  readonly avatarPublishedAt: number | null;
  readonly avatarUrl: string | null;
}

function parseFriendAvatar(
  avatarUrl: unknown,
  avatarPublishedAt: unknown,
  avatarGlobalId: unknown,
  itemCount: number,
  latestActivityAt: number,
): ParsedFriendAvatar | null {
  if (
    avatarUrl === null &&
    avatarPublishedAt === null &&
    avatarGlobalId === null
  ) {
    return {
      avatarGlobalId: null,
      avatarPublishedAt: null,
      avatarUrl: null,
    };
  }
  if (
    itemCount === 0 ||
    !boundedUnicodeString(avatarUrl, 8_192) ||
    !safeInteger(avatarPublishedAt) ||
    avatarPublishedAt > latestActivityAt ||
    !isLibraryCoreEntityId(avatarGlobalId)
  ) {
    return null;
  }
  return { avatarGlobalId, avatarPublishedAt, avatarUrl };
}

function parseFriendLocationCandidates(
  value: unknown,
  locationCandidateCount: unknown,
  itemCount: number,
  latestActivityAt: number,
  referenceTimeMs: number,
): LibraryFriendsGraphLocationCandidate[] | null {
  if (
    !safeInteger(locationCandidateCount) ||
    locationCandidateCount > itemCount ||
    !Array.isArray(value) ||
    value.length !==
      Math.min(locationCandidateCount, MAXIMUM_FRIEND_LOCATION_CANDIDATES)
  ) {
    return null;
  }
  const candidates: LibraryFriendsGraphLocationCandidate[] = [];
  const identities = new Set<string>();
  for (const rawCandidate of value) {
    const candidate = closedRecord(
      rawCandidate,
      FRIEND_LOCATION_CANDIDATE_KEYS,
    );
    if (
      !candidate ||
      !isLibraryCoreEntityId(candidate.globalId) ||
      identities.has(candidate.globalId) ||
      !safeInteger(candidate.publishedAt) ||
      candidate.publishedAt > latestActivityAt ||
      !safeInteger(candidate.effectiveAt) ||
      candidate.effectiveAt > referenceTimeMs
    ) {
      return null;
    }
    const previous = candidates.at(-1);
    if (
      previous &&
      (candidate.publishedAt > previous.publishedAt ||
        (candidate.publishedAt === previous.publishedAt &&
          compareUtf8(candidate.globalId, previous.globalId) <= 0))
    ) {
      return null;
    }
    identities.add(candidate.globalId);
    candidates.push({
      effectiveAt: candidate.effectiveAt,
      globalId: candidate.globalId,
      publishedAt: candidate.publishedAt,
    });
  }
  return candidates;
}

function parseFriendsGraphResponse(
  value: unknown,
  expectedSources: readonly LibraryFriendsSource[],
  expectedRssFeedUrls: readonly string[],
  referenceTimeMs: number,
): NativeFriendsGraphResponseV1 {
  const response = closedRecord(value, FRIENDS_GRAPH_RESPONSE_KEYS);
  const source = parseNativeSource(response?.source);
  if (
    !response ||
    !source ||
    response.queryId !== FRIENDS_GRAPH_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    !safeInteger(response.totalItemCount) ||
    !Array.isArray(response.social) ||
    response.social.length !== expectedSources.length ||
    !Array.isArray(response.rss) ||
    response.rss.length !== expectedRssFeedUrls.length
  ) {
    throw new Error("Library Core Friends graph response is invalid");
  }

  const social: LibraryFriendsGraphSocialActivity[] = [];
  for (let index = 0; index < response.social.length; index += 1) {
    const expected = expectedSources[index]!;
    const entry = closedRecord(
      response.social[index],
      FRIEND_SOCIAL_ACTIVITY_KEYS,
    );
    if (
      !entry ||
      entry.platform !== expected.platform ||
      entry.authorId !== expected.authorId ||
      !safeInteger(entry.itemCount) ||
      entry.itemCount > response.totalItemCount ||
      !safeInteger(entry.latestActivityAt) ||
      typeof entry.hasLocation !== "boolean" ||
      !safeInteger(entry.locationCandidateCount) ||
      !safeInteger(entry.recentCount) ||
      entry.recentCount > entry.itemCount
    ) {
      throw new Error("Library Core Friends graph social activity is invalid");
    }
    const locationCandidateCount = entry.locationCandidateCount;
    const avatar = parseFriendAvatar(
      entry.avatarUrl,
      entry.avatarPublishedAt,
      entry.avatarGlobalId,
      entry.itemCount,
      entry.latestActivityAt,
    );
    const locationCandidates = parseFriendLocationCandidates(
      entry.locationCandidates,
      locationCandidateCount,
      entry.itemCount,
      entry.latestActivityAt,
      referenceTimeMs,
    );
    const sampleItems = parseFriendSampleItems(
      entry.sampleItems,
      entry.itemCount,
      entry.latestActivityAt,
    );
    const signalCounts = parseFriendSignalCounts(
      entry.signalCounts,
      entry.itemCount,
    );
    if (
      !sampleItems ||
      !signalCounts ||
      !avatar ||
      !locationCandidates ||
      (!entry.hasLocation && locationCandidateCount !== 0) ||
      (entry.itemCount === 0 &&
        (entry.latestActivityAt !== 0 ||
          entry.hasLocation ||
          locationCandidateCount !== 0 ||
          avatar.avatarUrl !== null ||
          sampleItems.length !== 0 ||
          entry.recentCount !== 0 ||
          signalCounts.length !== 0))
    ) {
      throw new Error("Library Core Friends graph social activity is inconsistent");
    }
    social.push({
      platform: expected.platform,
      authorId: expected.authorId,
      itemCount: entry.itemCount,
      latestActivityAt: entry.latestActivityAt,
      hasLocation: entry.hasLocation,
      locationCandidateCount,
      locationCandidates,
      ...avatar,
      sampleItems,
      recentCount: entry.recentCount,
      signalCounts,
    });
  }

  const rss: LibraryFriendsGraphRssActivity[] = [];
  for (let index = 0; index < response.rss.length; index += 1) {
    const expectedFeedUrl = expectedRssFeedUrls[index]!;
    const entry = closedRecord(response.rss[index], FRIEND_RSS_ACTIVITY_KEYS);
    if (
      !entry ||
      entry.feedUrl !== expectedFeedUrl ||
      !safeInteger(entry.itemCount) ||
      entry.itemCount > response.totalItemCount ||
      !safeInteger(entry.latestActivityAt) ||
      typeof entry.hasLocation !== "boolean" ||
      !safeInteger(entry.locationCandidateCount)
    ) {
      throw new Error("Library Core Friends graph RSS activity is invalid");
    }
    const locationCandidateCount = entry.locationCandidateCount;
    const avatar = parseFriendAvatar(
      entry.avatarUrl,
      entry.avatarPublishedAt,
      entry.avatarGlobalId,
      entry.itemCount,
      entry.latestActivityAt,
    );
    const locationCandidates = parseFriendLocationCandidates(
      entry.locationCandidates,
      locationCandidateCount,
      entry.itemCount,
      entry.latestActivityAt,
      referenceTimeMs,
    );
    const sampleItems = parseFriendSampleItems(
      entry.sampleItems,
      entry.itemCount,
      entry.latestActivityAt,
    );
    if (
      !sampleItems ||
      !avatar ||
      !locationCandidates ||
      (!entry.hasLocation && locationCandidateCount !== 0) ||
      (entry.itemCount === 0 &&
        (entry.latestActivityAt !== 0 ||
          entry.hasLocation ||
          locationCandidateCount !== 0 ||
          avatar.avatarUrl !== null ||
          sampleItems.length !== 0))
    ) {
      throw new Error("Library Core Friends graph RSS activity is inconsistent");
    }
    rss.push({
      feedUrl: expectedFeedUrl,
      itemCount: entry.itemCount,
      latestActivityAt: entry.latestActivityAt,
      hasLocation: entry.hasLocation,
      locationCandidateCount,
      locationCandidates,
      ...avatar,
      sampleItems,
    });
  }

  const parsed: NativeFriendsGraphResponseV1 = {
    queryId: FRIENDS_GRAPH_QUERY_ID,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source,
    totalItemCount: response.totalItemCount,
    social,
    rss,
  };
  const responseBytes = jsonByteLength(parsed);
  if (
    responseBytes === null ||
    responseBytes > MAXIMUM_FRIEND_GRAPH_RESPONSE_BYTES
  ) {
    throw new Error("Library Core Friends graph response exceeds its byte bound");
  }
  return parsed;
}

function parsePersonTimelineResponse(
  value: unknown,
  limit: number,
  requestCursor: string | null,
  expectedSources: readonly LibraryFriendsSource[],
): NativePersonTimelineResponseV1 {
  const response = closedRecord(value, PERSON_TIMELINE_RESPONSE_KEYS);
  const source = parseNativeSource(response?.source);
  if (
    !response ||
    !source ||
    response.queryId !== PERSON_TIMELINE_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    !Array.isArray(response.rows) ||
    response.rows.length > limit ||
    !safeInteger(response.totalCount) ||
    response.rows.length > response.totalCount ||
    !(response.nextCursor === null ||
      canonicalUnpaddedBase64Url(
        response.nextCursor,
        MAXIMUM_PERSON_TIMELINE_CURSOR_BYTES,
      )) ||
    (response.nextCursor !== null && response.nextCursor === requestCursor) ||
    (response.rows.length === 0 && response.nextCursor !== null)
  ) {
    throw new Error("Library Core person timeline response is invalid");
  }
  const rows: LibraryCoreFeedCardV1[] = [];
  const ids = new Set<string>();
  const sourceKeys = new Set(
    expectedSources.map((source) =>
      JSON.stringify([source.platform, source.authorId]),
    ),
  );
  for (const candidate of response.rows) {
    const parsed = parseLibraryCoreFeedCardV1(candidate);
    if (
      !parsed.ok ||
      parsed.value.platform === null ||
      parsed.value.authorId === null ||
      parsed.value.publishedAt === null ||
      !sourceKeys.has(
        JSON.stringify([parsed.value.platform, parsed.value.authorId]),
      ) ||
      ids.has(parsed.value.globalId)
    ) {
      throw new Error("Library Core person timeline row is invalid");
    }
    ids.add(parsed.value.globalId);
    rows.push(parsed.value);
  }
  if (
    rows.some((row, index) => {
      if (index === 0) return false;
      const previous = rows[index - 1]!;
      if (previous.publishedAt === null || row.publishedAt === null) return true;
      return (
        previous.publishedAt < row.publishedAt ||
        (previous.publishedAt === row.publishedAt &&
          compareUtf8(previous.globalId, row.globalId) >= 0)
      );
    })
  ) {
    throw new Error("Library Core person timeline row order is invalid");
  }
  if (
    (response.totalCount === 0 &&
      (rows.length !== 0 || response.nextCursor !== null)) ||
    (response.totalCount > 0 && rows.length === 0) ||
    (requestCursor === null &&
      response.totalCount > rows.length &&
      response.nextCursor === null)
  ) {
    throw new Error("Library Core person timeline response is inconsistent");
  }
  const parsed: NativePersonTimelineResponseV1 = {
    nextCursor: response.nextCursor,
    queryId: PERSON_TIMELINE_QUERY_ID,
    rows,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source,
    totalCount: response.totalCount,
  };
  const responseBytes = jsonByteLength(parsed);
  if (
    responseBytes === null ||
    responseBytes > MAXIMUM_PERSON_TIMELINE_RESPONSE_BYTES
  ) {
    throw new Error("Library Core person timeline response exceeds its byte bound");
  }
  return parsed;
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

/**
 * Read compact Friends graph activity from one authenticated SQLite source.
 * Every requested key is returned exactly once, including zero-item keys, so
 * shared UI can join aggregates without retaining Library item bodies.
 */
export async function readLibraryCoreFriendsGraph(
  request: LibraryFriendsGraphRequest,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    queryId: typeof FRIENDS_GRAPH_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
    sources: readonly LibraryFriendsSource[];
    rssFeedUrls: readonly string[];
    recentWindow: LibraryFriendsRecentWindow;
  }) => Promise<unknown> = (nativeRequest) =>
    invoke("read_library_core_persons_graph", { request: nativeRequest }),
): Promise<LibraryFriendsGraph> {
  assertFriendsReaderEnabled();
  const sources = parseFriendSources(request.sources);
  const rssFeedUrls = parseRssFeedUrls(request.rssFeedUrls);
  const recentWindow = parseFriendsRecentWindow(request.recentWindow);
  if (
    !sources ||
    !rssFeedUrls ||
    !recentWindow ||
    sources.length + rssFeedUrls.length > MAXIMUM_FRIEND_GRAPH_KEYS
  ) {
    throw new Error("Library Core Friends graph request is invalid");
  }
  const nativeRequest = {
    queryId: FRIENDS_GRAPH_QUERY_ID,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    sources,
    rssFeedUrls,
    recentWindow,
  } as const;
  const requestBytes = jsonByteLength(nativeRequest);
  if (
    requestBytes === null ||
    requestBytes > MAXIMUM_FRIEND_REQUEST_BYTES
  ) {
    throw new Error("Library Core Friends graph request exceeds its byte bound");
  }
  const before = await getSource();
  const response = parseFriendsGraphResponse(
    await readNative(nativeRequest),
    sources,
    rssFeedUrls,
    recentWindow.endMs,
  );
  if (!sourceMatches(before, response.source)) {
    throw new Error("Library Core Friends graph source is stale");
  }
  const after = await getSource();
  if (!sourceMatches(after, response.source)) {
    throw new Error("Library Core Friends graph source changed during read");
  }
  return {
    sourceToken: encodeNativeSourceToken(response.source),
    totalItemCount: response.totalItemCount,
    social: response.social,
    rss: response.rss,
  };
}

/**
 * Resolve one graph-selected location item from the exact same immutable
 * SQLite generation. The opaque source token prevents a later generation from
 * satisfying a location identity selected by an older graph read.
 */
export async function readLibraryCoreFriendsLocationItem(
  request: LibraryFriendsLocationItemRequest,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    globalId: string;
    queryId: typeof ITEM_DETAIL_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  }) => Promise<unknown> = (request) =>
    invoke("read_library_core_item_detail", { request }),
): Promise<FeedItem | null> {
  assertFriendsReaderEnabled();
  const rawRequest = closedRecord(request, FRIEND_LOCATION_ITEM_REQUEST_KEYS);
  const rawOwner =
    rawRequest?.owner && typeof rawRequest.owner === "object"
      ? rawRequest.owner
      : null;
  const socialOwner = closedRecord(
    rawOwner,
    FRIEND_LOCATION_SOCIAL_OWNER_KEYS,
  );
  const rssOwner = closedRecord(rawOwner, FRIEND_LOCATION_RSS_OWNER_KEYS);
  const owner: LibraryFriendsLocationOwner | null =
    socialOwner?.kind === "social" &&
    parseFriendSources([
      {
        platform: socialOwner.platform,
        authorId: socialOwner.authorId,
      },
    ]) !== null
      ? {
          kind: "social",
          platform: socialOwner.platform as string,
          authorId: socialOwner.authorId as string,
        }
      : rssOwner?.kind === "rss" && parseRssFeedUrls([rssOwner.feedUrl]) !== null
        ? { kind: "rss", feedUrl: rssOwner.feedUrl as string }
        : null;
  const expectedSource = parseNativeSourceToken(rawRequest?.sourceToken);
  if (
    !rawRequest ||
    !owner ||
    !isLibraryCoreEntityId(rawRequest.globalId) ||
    !safeInteger(rawRequest.publishedAt) ||
    !safeInteger(rawRequest.effectiveAt) ||
    !safeInteger(rawRequest.referenceTimeMs) ||
    !expectedSource
  ) {
    throw new Error("Library Core Friends location request is invalid");
  }
  const before = await getSource();
  if (!sourceMatches(before, expectedSource)) {
    throw new Error("Library Core Friends location source is stale");
  }
  const response = parseResponse(
    await readNative({
      globalId: rawRequest.globalId,
      queryId: ITEM_DETAIL_QUERY_ID,
      schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    }),
    rawRequest.globalId,
  );
  if (!sameSelectedSource(response.source, expectedSource)) {
    throw new Error("Library Core Friends location generation changed");
  }
  const after = await getSource();
  if (!sourceMatches(after, expectedSource)) {
    throw new Error("Library Core Friends location source changed during read");
  }
  if (response.item === null) return null;
  const item = reconstructFeedItem(response.item) as unknown as FeedItem;
  const ownerMatches =
    owner.kind === "social"
      ? item.platform === owner.platform && item.author.id === owner.authorId
      : item.platform === "rss" && item.rssSource?.feedUrl === owner.feedUrl;
  const effectiveAt = item.timeRange?.startsAt ?? item.publishedAt;
  if (
    !ownerMatches ||
    item.publishedAt !== rawRequest.publishedAt ||
    effectiveAt !== rawRequest.effectiveAt ||
    item.userState.hidden ||
    !isLocationItemVisibleInTimeMode(
      item,
      "current",
      rawRequest.referenceTimeMs,
    ) ||
    extractLocationFromItem(item) === null
  ) {
    throw new Error("Library Core Friends location item is inconsistent");
  }
  return item;
}

/** Read one bounded Friends timeline page without hydrating the corpus. */
export async function readLibraryCorePersonTimeline(
  request: LibraryPersonTimelineRequest,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> = getLibraryCoreProjectionSource,
  readNative: (request: {
    queryId: typeof PERSON_TIMELINE_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
    sources: readonly LibraryFriendsSource[];
    limit: number;
    cursor: string | null;
  }) => Promise<unknown> = (nativeRequest) =>
    invoke("read_library_core_person_timeline", { request: nativeRequest }),
): Promise<LibraryPersonTimelinePage> {
  assertFriendsReaderEnabled();
  const sources = parseFriendSources(request.sources);
  const limit = request.limit ?? DEFAULT_PERSON_TIMELINE_LIMIT;
  const cursor = request.cursor ?? null;
  if (
    !sources ||
    sources.length === 0 ||
    !safeInteger(limit) ||
    limit < 1 ||
    limit > MAXIMUM_PERSON_TIMELINE_LIMIT ||
    !(
      cursor === null ||
      canonicalUnpaddedBase64Url(
        cursor,
        MAXIMUM_PERSON_TIMELINE_CURSOR_BYTES,
      )
    )
  ) {
    throw new Error("Library Core person timeline request is invalid");
  }
  const nativeRequest = {
    queryId: PERSON_TIMELINE_QUERY_ID,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    sources,
    limit,
    cursor,
  } as const;
  const requestBytes = jsonByteLength(nativeRequest);
  if (
    requestBytes === null ||
    requestBytes > MAXIMUM_FRIEND_REQUEST_BYTES
  ) {
    throw new Error("Library Core person timeline request exceeds its byte bound");
  }
  const before = await getSource();
  const response = parsePersonTimelineResponse(
    await readNative(nativeRequest),
    limit,
    cursor,
    sources,
  );
  if (!sourceMatches(before, response.source)) {
    throw new Error("Library Core person timeline source is stale");
  }
  const after = await getSource();
  if (!sourceMatches(after, response.source)) {
    throw new Error("Library Core person timeline source changed during read");
  }
  return {
    items: response.rows.map(feedCardToItem),
    totalCount: response.totalCount,
    nextCursor: response.nextCursor,
  };
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
  const dailyWindows = parseAnalyticsWindows(
    request.dailyWindows,
    LIBRARY_CORE_SAVED_ANALYTICS_DAILY_WINDOW_COUNT,
  );
  const hourlyWindows = parseAnalyticsWindows(
    request.hourlyWindows,
    LIBRARY_CORE_SAVED_ANALYTICS_HOURLY_WINDOW_COUNT,
    LIBRARY_CORE_SAVED_ANALYTICS_REQUEST_SCHEMA.repeatedWindowAllowance.hourly > 0,
  );
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
