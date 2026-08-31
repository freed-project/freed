import { CONTENT_SIGNAL_KEYS } from "../content-signals.js";
import type { ContentSignal } from "../types.js";
import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";

/** Closed SQLite contract for one bounded Friends activity aggregate batch. */
export const LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID = "persons_graph_v1" as const;
export const LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES = 128;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_REQUEST_BYTES = 256 * 1_024;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_RESPONSE_BYTES = 2 * 1_048_576;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_SAMPLE_ITEMS = 5;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_LOCATION_CANDIDATES = 8;
export const LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_TEXT_BYTES = 4_096;

const REQUEST_KEYS = ["queryId", "recentWindow", "rssFeedUrls", "schemaVersion", "sources"] as const;
const RESPONSE_KEYS = ["queryId", "rss", "schemaVersion", "social", "source", "totalItemCount"] as const;
const WINDOW_KEYS = ["endMs", "startMs"] as const;
const SOURCE_KEYS = ["authorId", "platform"] as const;
const SAMPLE_KEYS = ["globalId", "publishedAt"] as const;
const LOCATION_KEYS = ["effectiveAt", "globalId", "publishedAt"] as const;
const SIGNAL_KEYS = ["count", "label"] as const;
const SOCIAL_KEYS = [
  "authorId", "avatarGlobalId", "avatarPublishedAt", "avatarUrl", "hasLocation",
  "itemCount", "latestActivityAt", "locationCandidateCount", "locationCandidates",
  "platform", "recentCount", "sampleItems", "signalCounts",
] as const;
const RSS_KEYS = [
  "avatarGlobalId", "avatarPublishedAt", "avatarUrl", "feedUrl", "hasLocation",
  "itemCount", "latestActivityAt", "locationCandidateCount", "locationCandidates", "sampleItems",
] as const;
const textEncoder = new TextEncoder();

export const LIBRARY_CORE_PERSONS_GRAPH_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_persons_graph_request_v1",
  schemaVersion: LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID,
  canonicalKeys: REQUEST_KEYS,
  recentWindowKeys: WINDOW_KEYS,
  sourceKeys: SOURCE_KEYS,
  maximumCombinedSources: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES,
  requiresNonEmptySources: false,
  maximumRequestBytes: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_REQUEST_BYTES,
});

export const LIBRARY_CORE_PERSONS_GRAPH_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_persons_graph_response_v1",
  schemaVersion: LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID,
  canonicalKeys: RESPONSE_KEYS,
  socialKeys: SOCIAL_KEYS,
  rssKeys: RSS_KEYS,
  maximumResponseBytes: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_PERSONS_GRAPH_PROJECTION = Object.freeze({
  projectionId: "library_core_persons_graph_activity_v1",
  sourceTable: "library_feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["platform", "authorId", "feedUrl"]),
});

export const LIBRARY_CORE_PERSONS_GRAPH_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_PERSONS_GRAPH_NESTED_BOUNDS = Object.freeze({
  social: Object.freeze({
    maximumItems: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES,
    maximumSampleItems: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_SAMPLE_ITEMS,
    maximumLocationCandidates: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_LOCATION_CANDIDATES,
    maximumSignalCounts: CONTENT_SIGNAL_KEYS.length,
  }),
  rss: Object.freeze({
    maximumItems: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES,
    maximumSampleItems: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_SAMPLE_ITEMS,
    maximumLocationCandidates: LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_LOCATION_CANDIDATES,
  }),
});

export const LIBRARY_CORE_PERSONS_GRAPH_SERIES_ORDER = Object.freeze({
  social: Object.freeze({ columns: Object.freeze(["platform", "authorId"]), direction: "asc", textCollation: "binary" }),
  rss: Object.freeze({ columns: Object.freeze(["feedUrl"]), direction: "asc", textCollation: "binary" }),
});

export interface LibraryCorePersonsGraphWindowV1 { readonly startMs: number; readonly endMs: number; }
export interface LibraryCorePersonsGraphSourceV1 { readonly platform: string; readonly authorId: string; }
export interface LibraryCorePersonsGraphRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID;
  readonly recentWindow: LibraryCorePersonsGraphWindowV1;
  readonly rssFeedUrls: readonly string[];
  readonly schemaVersion: typeof LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION;
  readonly sources: readonly LibraryCorePersonsGraphSourceV1[];
}
export interface LibraryCorePersonsGraphSampleItemV1 { readonly globalId: string; readonly publishedAt: number; }
export interface LibraryCorePersonsGraphLocationCandidateV1 { readonly effectiveAt: number; readonly globalId: string; readonly publishedAt: number; }
export interface LibraryCorePersonsGraphSignalCountV1 { readonly count: number; readonly label: ContentSignal; }
export interface LibraryCorePersonsGraphSocialV1 extends LibraryCorePersonsGraphSourceV1 {
  readonly avatarGlobalId: string | null;
  readonly avatarPublishedAt: number | null;
  readonly avatarUrl: string | null;
  readonly hasLocation: boolean;
  readonly itemCount: number;
  readonly latestActivityAt: number;
  readonly locationCandidateCount: number;
  readonly locationCandidates: readonly LibraryCorePersonsGraphLocationCandidateV1[];
  readonly recentCount: number;
  readonly sampleItems: readonly LibraryCorePersonsGraphSampleItemV1[];
  readonly signalCounts: readonly LibraryCorePersonsGraphSignalCountV1[];
}
export interface LibraryCorePersonsGraphRssV1 {
  readonly avatarGlobalId: string | null;
  readonly avatarPublishedAt: number | null;
  readonly avatarUrl: string | null;
  readonly feedUrl: string;
  readonly hasLocation: boolean;
  readonly itemCount: number;
  readonly latestActivityAt: number;
  readonly locationCandidateCount: number;
  readonly locationCandidates: readonly LibraryCorePersonsGraphLocationCandidateV1[];
  readonly sampleItems: readonly LibraryCorePersonsGraphSampleItemV1[];
}
export interface LibraryCorePersonsGraphResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID;
  readonly rss: readonly LibraryCorePersonsGraphRssV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION;
  readonly social: readonly LibraryCorePersonsGraphSocialV1[];
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalItemCount: number;
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> { return Object.freeze({ ok: false, error }); }
function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}
function safeCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && textEncoder.encode(value).byteLength <= LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_TEXT_BYTES;
}
function nullableText(value: unknown): value is string | null { return value === null || boundedText(value); }
function nullableDisplayText(value: unknown): value is string | null { return value === null || (typeof value === "string" && textEncoder.encode(value).byteLength <= LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_TEXT_BYTES); }
function nullableCount(value: unknown): value is number | null { return value === null || safeCount(value); }
function parseSample(value: unknown): LibraryCorePersonsGraphSampleItemV1 | null {
  const record = closedRecord(value, SAMPLE_KEYS);
  return record && boundedText(record.globalId) && safeCount(record.publishedAt)
    ? Object.freeze({ globalId: record.globalId, publishedAt: record.publishedAt }) : null;
}
function parseLocation(value: unknown): LibraryCorePersonsGraphLocationCandidateV1 | null {
  const record = closedRecord(value, LOCATION_KEYS);
  return record && safeCount(record.effectiveAt) && boundedText(record.globalId) && safeCount(record.publishedAt)
    ? Object.freeze({ effectiveAt: record.effectiveAt, globalId: record.globalId, publishedAt: record.publishedAt }) : null;
}
function parseSamples(value: unknown): readonly LibraryCorePersonsGraphSampleItemV1[] | null {
  if (!Array.isArray(value) || value.length > LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_SAMPLE_ITEMS) return null;
  const parsed = value.map(parseSample);
  return parsed.some((row) => row === null) ? null : Object.freeze(parsed as LibraryCorePersonsGraphSampleItemV1[]);
}
function parseLocations(value: unknown): readonly LibraryCorePersonsGraphLocationCandidateV1[] | null {
  if (!Array.isArray(value) || value.length > LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_LOCATION_CANDIDATES) return null;
  const parsed = value.map(parseLocation);
  return parsed.some((row) => row === null) ? null : Object.freeze(parsed as LibraryCorePersonsGraphLocationCandidateV1[]);
}
function parseSignals(value: unknown): readonly LibraryCorePersonsGraphSignalCountV1[] | null {
  if (!Array.isArray(value) || value.length !== CONTENT_SIGNAL_KEYS.length) return null;
  const rows: LibraryCorePersonsGraphSignalCountV1[] = [];
  for (let index = 0; index < CONTENT_SIGNAL_KEYS.length; index += 1) {
    const record = closedRecord(value[index], SIGNAL_KEYS);
    const label = CONTENT_SIGNAL_KEYS[index]!;
    if (!record || record.label !== label || !safeCount(record.count)) return null;
    rows.push(Object.freeze({ count: record.count, label }));
  }
  return Object.freeze(rows);
}

export function parseLibraryCorePersonsGraphRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCorePersonsGraphRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  const window = closedRecord(record?.recentWindow, WINDOW_KEYS);
  if (!record || !window || record.queryId !== LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID || record.schemaVersion !== LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION || !safeCount(window.startMs) || !safeCount(window.endMs) || window.endMs < window.startMs || !Array.isArray(record.sources) || !Array.isArray(record.rssFeedUrls) || record.sources.length + record.rssFeedUrls.length > LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES) return failure("persons graph request is invalid");
  const sources: LibraryCorePersonsGraphSourceV1[] = [];
  const sourceKeys = new Set<string>();
  for (const value of record.sources) {
    const source = closedRecord(value, SOURCE_KEYS);
    if (!source || !boundedText(source.platform) || !boundedText(source.authorId)) return failure("persons graph source is invalid");
    const key = JSON.stringify([source.platform, source.authorId]);
    if (sourceKeys.has(key)) return failure("persons graph source is duplicated");
    sourceKeys.add(key);
    sources.push(Object.freeze({ platform: source.platform, authorId: source.authorId }));
  }
  const rssFeedUrls: string[] = [];
  const rssKeys = new Set<string>();
  for (const value of record.rssFeedUrls) {
    if (!boundedText(value) || rssKeys.has(value)) return failure("persons graph RSS source is invalid");
    rssKeys.add(value);
    rssFeedUrls.push(value);
  }
  const request = Object.freeze({
    queryId: LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID,
    recentWindow: Object.freeze({ startMs: window.startMs, endMs: window.endMs }),
    rssFeedUrls: Object.freeze(rssFeedUrls),
    schemaVersion: LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION,
    sources: Object.freeze(sources),
  });
  if (textEncoder.encode(JSON.stringify(request)).byteLength > LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_REQUEST_BYTES) return failure("persons graph request exceeds its byte bound");
  return Object.freeze({ ok: true, value: request });
}

export function parseLibraryCorePersonsGraphResponseV1(value: unknown, request: LibraryCorePersonsGraphRequestV1): LibraryCoreFeedPageParseResult<LibraryCorePersonsGraphResponseV1> {
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (!record || !source.ok || record.queryId !== LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID || record.schemaVersion !== LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION || !safeCount(record.totalItemCount) || !Array.isArray(record.social) || !Array.isArray(record.rss) || record.social.length !== request.sources.length || record.rss.length !== request.rssFeedUrls.length) return failure("persons graph response is invalid");
  const social: LibraryCorePersonsGraphSocialV1[] = [];
  for (let index = 0; index < request.sources.length; index += 1) {
    const row = closedRecord(record.social[index], SOCIAL_KEYS);
    const expected = request.sources[index]!;
    const samples = parseSamples(row?.sampleItems);
    const locations = parseLocations(row?.locationCandidates);
    const signals = parseSignals(row?.signalCounts);
    if (!row || row.platform !== expected.platform || row.authorId !== expected.authorId || !safeCount(row.itemCount) || !safeCount(row.latestActivityAt) || !safeCount(row.recentCount) || typeof row.hasLocation !== "boolean" || !safeCount(row.locationCandidateCount) || row.locationCandidateCount !== locations?.length || row.hasLocation !== ((locations?.length ?? 0) > 0) || !nullableText(row.avatarGlobalId) || !nullableCount(row.avatarPublishedAt) || !nullableDisplayText(row.avatarUrl) || (row.avatarGlobalId === null) !== (row.avatarPublishedAt === null) || (row.avatarGlobalId === null) !== (row.avatarUrl === null) || !samples || !locations || !signals) return failure("persons graph social row is invalid");
    social.push(Object.freeze({ authorId: expected.authorId, avatarGlobalId: row.avatarGlobalId, avatarPublishedAt: row.avatarPublishedAt, avatarUrl: row.avatarUrl, hasLocation: row.hasLocation, itemCount: row.itemCount, latestActivityAt: row.latestActivityAt, locationCandidateCount: row.locationCandidateCount, locationCandidates: locations, platform: expected.platform, recentCount: row.recentCount, sampleItems: samples, signalCounts: signals }));
  }
  const rss: LibraryCorePersonsGraphRssV1[] = [];
  for (let index = 0; index < request.rssFeedUrls.length; index += 1) {
    const row = closedRecord(record.rss[index], RSS_KEYS);
    const expected = request.rssFeedUrls[index]!;
    const samples = parseSamples(row?.sampleItems);
    const locations = parseLocations(row?.locationCandidates);
    if (!row || row.feedUrl !== expected || !safeCount(row.itemCount) || !safeCount(row.latestActivityAt) || typeof row.hasLocation !== "boolean" || !safeCount(row.locationCandidateCount) || row.locationCandidateCount !== locations?.length || row.hasLocation !== ((locations?.length ?? 0) > 0) || !nullableText(row.avatarGlobalId) || !nullableCount(row.avatarPublishedAt) || !nullableDisplayText(row.avatarUrl) || (row.avatarGlobalId === null) !== (row.avatarPublishedAt === null) || (row.avatarGlobalId === null) !== (row.avatarUrl === null) || !samples || !locations) return failure("persons graph RSS row is invalid");
    rss.push(Object.freeze({ avatarGlobalId: row.avatarGlobalId, avatarPublishedAt: row.avatarPublishedAt, avatarUrl: row.avatarUrl, feedUrl: expected, hasLocation: row.hasLocation, itemCount: row.itemCount, latestActivityAt: row.latestActivityAt, locationCandidateCount: row.locationCandidateCount, locationCandidates: locations, sampleItems: samples }));
  }
  const response = Object.freeze({ queryId: LIBRARY_CORE_PERSONS_GRAPH_QUERY_ID, rss: Object.freeze(rss), schemaVersion: LIBRARY_CORE_PERSONS_GRAPH_SCHEMA_VERSION, social: Object.freeze(social), source: source.value, totalItemCount: record.totalItemCount });
  if (textEncoder.encode(JSON.stringify(response)).byteLength > LIBRARY_CORE_PERSONS_GRAPH_MAXIMUM_RESPONSE_BYTES) return failure("persons graph response exceeds its byte bound");
  return Object.freeze({ ok: true, value: response });
}
