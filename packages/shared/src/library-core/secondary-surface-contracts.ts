import type { LibraryMapLocationCandidate } from "../location.js";
import type { ContentType, FeedItem, MediaType, Platform, RelationshipStatus } from "../types.js";
import {
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreEntityId,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_MAP_MARKERS_QUERY_ID = "map_markers_v1" as const;
export const LIBRARY_CORE_MAP_MARKERS_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_MAP_MARKERS_DEFAULT_LIMIT = 500;
export const LIBRARY_CORE_MAP_MARKERS_MAXIMUM_LIMIT = 1_000;
export const LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID =
  "story_wall_candidates_v1" as const;
export const LIBRARY_CORE_STORY_WALL_CANDIDATES_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_STORY_WALL_CANDIDATES_DEFAULT_LIMIT = 100;
export const LIBRARY_CORE_STORY_WALL_CANDIDATES_MAXIMUM_LIMIT = 250;
export const LIBRARY_CORE_SECONDARY_SURFACE_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;
export const LIBRARY_CORE_SECONDARY_SURFACE_SOURCE_IDENTITY =
  LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY;
export const LIBRARY_CORE_MAP_MARKERS_NESTED_BOUNDS = Object.freeze({});
export const LIBRARY_CORE_STORY_WALL_CANDIDATES_NESTED_BOUNDS = Object.freeze({
  mediaTypes: Object.freeze({ maximumItems: 8, maximumUtf8BytesPerItem: 64 }),
  mediaUrls: Object.freeze({ maximumItems: 8, maximumUtf8BytesPerItem: 8_192 }),
});

const REQUEST_KEYS = Object.freeze([
  "cancellationId",
  "limit",
  "queryId",
  "readerSessionId",
  "schemaVersion",
] as const);
const RESPONSE_KEYS = Object.freeze([
  "hasMore",
  "queryId",
  "rows",
  "schemaVersion",
  "source",
] as const);
const MAP_ROW_KEYS = Object.freeze([
  "authorAvatarUrl",
  "authorDisplayName",
  "authorHandle",
  "authorId",
  "capturedAt",
  "contentText",
  "contentType",
  "globalId",
  "linkedAccountId",
  "friendAvatarUrl",
  "friendName",
  "friendPersonId",
  "friendRelationshipStatus",
  "locationLat",
  "locationLng",
  "locationName",
  "locationUrl",
  "platform",
  "publishedAt",
  "sourceUrl",
  "timeRangeEndsAt",
  "timeRangeStartsAt",
] as const);
const STORY_ROW_KEYS = Object.freeze([
  "authorDisplayName",
  "authorHandle",
  "authorId",
  "capturedAt",
  "contentText",
  "globalId",
  "locationName",
  "mediaTypes",
  "mediaUrls",
  "platform",
  "publishedAt",
  "sourceUrl",
] as const);
const PLATFORMS = new Set<Platform>([
  "x",
  "rss",
  "youtube",
  "reddit",
  "mastodon",
  "github",
  "facebook",
  "instagram",
  "linkedin",
  "substack",
  "medium",
  "saved",
]);
const CONTENT_TYPES = new Set<ContentType>([
  "post",
  "story",
  "article",
  "video",
  "podcast",
]);
const RELATIONSHIP_STATUSES = new Set<RelationshipStatus>([
  "connection",
  "friend",
]);
const MEDIA_TYPES = new Set<MediaType | "unknown">(["image", "video", "link", "unknown"]);
const textEncoder = new TextEncoder();

export const LIBRARY_CORE_MAP_MARKERS_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_map_markers_request_v1",
  schemaVersion: LIBRARY_CORE_MAP_MARKERS_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_MAP_MARKERS_QUERY_ID,
  canonicalKeys: REQUEST_KEYS,
  defaultLimit: LIBRARY_CORE_MAP_MARKERS_DEFAULT_LIMIT,
  maximumLimit: LIBRARY_CORE_MAP_MARKERS_MAXIMUM_LIMIT,
});

export const LIBRARY_CORE_MAP_MARKERS_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_map_markers_response_v1",
  schemaVersion: LIBRARY_CORE_MAP_MARKERS_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_MAP_MARKERS_QUERY_ID,
  canonicalKeys: RESPONSE_KEYS,
  maximumRows: LIBRARY_CORE_MAP_MARKERS_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_SECONDARY_SURFACE_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_MAP_MARKERS_PROJECTION = Object.freeze({
  projectionId: "library_core_map_marker_v1",
  sourceTable: "library_feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["publishedAt", "globalId"]),
  selectedFields: MAP_ROW_KEYS,
});

export const LIBRARY_CORE_STORY_WALL_CANDIDATES_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_story_wall_candidates_request_v1",
  schemaVersion: LIBRARY_CORE_STORY_WALL_CANDIDATES_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID,
  canonicalKeys: REQUEST_KEYS,
  defaultLimit: LIBRARY_CORE_STORY_WALL_CANDIDATES_DEFAULT_LIMIT,
  maximumLimit: LIBRARY_CORE_STORY_WALL_CANDIDATES_MAXIMUM_LIMIT,
});

export const LIBRARY_CORE_STORY_WALL_CANDIDATES_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_story_wall_candidates_response_v1",
  schemaVersion: LIBRARY_CORE_STORY_WALL_CANDIDATES_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID,
  canonicalKeys: RESPONSE_KEYS,
  maximumRows: LIBRARY_CORE_STORY_WALL_CANDIDATES_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_SECONDARY_SURFACE_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_STORY_WALL_CANDIDATES_PROJECTION = Object.freeze({
  projectionId: "library_core_story_wall_candidate_v1",
  sourceTable: "library_feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["publishedAt", "globalId"]),
  selectedFields: STORY_ROW_KEYS,
  nestedBounds: Object.freeze({ mediaItems: 8 }),
});

export interface LibraryCoreSecondarySurfaceRequestV1 {
  readonly cancellationId: string;
  readonly limit: number;
  readonly queryId:
    | typeof LIBRARY_CORE_MAP_MARKERS_QUERY_ID
    | typeof LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: 1;
}

export interface LibraryCoreMapMarkersRequestV1 extends LibraryCoreSecondarySurfaceRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_MAP_MARKERS_QUERY_ID;
}

export interface LibraryCoreStoryWallCandidatesRequestV1 extends LibraryCoreSecondarySurfaceRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID;
}

export interface LibraryCoreMapMarkerV1 {
  readonly authorAvatarUrl: string | null;
  readonly authorDisplayName: string;
  readonly authorHandle: string;
  readonly authorId: string;
  readonly capturedAt: number;
  readonly contentText: string | null;
  readonly contentType: ContentType;
  readonly globalId: string;
  readonly linkedAccountId: string | null;
  readonly friendAvatarUrl: string | null;
  readonly friendName: string | null;
  readonly friendPersonId: string | null;
  readonly friendRelationshipStatus: RelationshipStatus | null;
  readonly locationLat: number | null;
  readonly locationLng: number | null;
  readonly locationName: string | null;
  readonly locationUrl: string | null;
  readonly platform: Platform;
  readonly publishedAt: number;
  readonly sourceUrl: string | null;
  readonly timeRangeEndsAt: number | null;
  readonly timeRangeStartsAt: number | null;
}

export interface LibraryCoreStoryWallCandidateV1 {
  readonly authorDisplayName: string;
  readonly authorHandle: string;
  readonly authorId: string;
  readonly capturedAt: number;
  readonly contentText: string | null;
  readonly globalId: string;
  readonly locationName: string | null;
  readonly mediaTypes: readonly (MediaType | "unknown")[];
  readonly mediaUrls: readonly string[];
  readonly platform: Platform;
  readonly publishedAt: number;
  readonly sourceUrl: string | null;
}

export interface LibraryCoreMapMarkersResponseV1 {
  readonly hasMore: boolean;
  readonly queryId: typeof LIBRARY_CORE_MAP_MARKERS_QUERY_ID;
  readonly rows: readonly LibraryCoreMapMarkerV1[];
  readonly schemaVersion: 1;
  readonly source: LibraryCoreFeedPageSourceV1;
}

export interface LibraryCoreStoryWallCandidatesResponseV1 {
  readonly hasMore: boolean;
  readonly queryId: typeof LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID;
  readonly rows: readonly LibraryCoreStoryWallCandidateV1[];
  readonly schemaVersion: 1;
  readonly source: LibraryCoreFeedPageSourceV1;
}

/** Convert one compact normalized Map row into the shared visible-card model. */
export function libraryCoreMapMarkerToItemV1(
  row: LibraryCoreMapMarkerV1,
): FeedItem {
  const hasCoordinates = row.locationLat !== null && row.locationLng !== null;
  return {
    globalId: row.globalId,
    platform: row.platform,
    contentType: row.contentType,
    capturedAt: row.capturedAt,
    publishedAt: row.publishedAt,
    author: {
      id: row.authorId,
      handle: row.authorHandle,
      displayName: row.authorDisplayName,
      ...(row.authorAvatarUrl ? { avatarUrl: row.authorAvatarUrl } : {}),
    },
    content: {
      ...(row.contentText ? { text: row.contentText } : {}),
      mediaUrls: [],
      mediaTypes: [],
    },
    location: {
      name: row.locationName ?? "",
      ...(hasCoordinates
        ? { coordinates: { lat: row.locationLat!, lng: row.locationLng! } }
        : {}),
      ...(row.locationUrl ? { url: row.locationUrl } : {}),
      source: "text_extraction",
    },
    ...(row.timeRangeStartsAt !== null
      ? {
          timeRange: {
            startsAt: row.timeRangeStartsAt,
            ...(row.timeRangeEndsAt !== null
              ? { endsAt: row.timeRangeEndsAt }
              : {}),
            kind: "event" as const,
          },
        }
      : {}),
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
  };
}

/** Convert one joined Map row into the complete bounded location read model. */
export function libraryCoreMapMarkerToLocationCandidateV1(
  row: LibraryCoreMapMarkerV1,
): LibraryMapLocationCandidate {
  return Object.freeze({
    accountId: row.linkedAccountId,
    item: libraryCoreMapMarkerToItemV1(row),
    friend: row.friendPersonId === null
      ? null
      : Object.freeze({
          id: row.friendPersonId,
          name: row.friendName!,
          relationshipStatus: row.friendRelationshipStatus!,
          ...(row.friendAvatarUrl ? { avatarUrl: row.friendAvatarUrl } : {}),
        }),
  });
}

/** Convert one compact normalized Story Wall row into its visible-card model. */
export function libraryCoreStoryWallCandidateToItemV1(
  row: LibraryCoreStoryWallCandidateV1,
): FeedItem {
  return {
    globalId: row.globalId,
    platform: row.platform,
    contentType: "post",
    capturedAt: row.capturedAt,
    publishedAt: row.publishedAt,
    author: {
      id: row.authorId,
      handle: row.authorHandle,
      displayName: row.authorDisplayName,
    },
    content: {
      ...(row.contentText ? { text: row.contentText } : {}),
      mediaUrls: [...row.mediaUrls],
      mediaTypes: row.mediaTypes.map((value): MediaType =>
        value === "unknown" ? "link" : value,
      ),
    },
    ...(row.locationName
      ? {
          location: {
            name: row.locationName,
            source: "text_extraction" as const,
          },
        }
      : {}),
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
  };
}

function success<T>(value: T): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): LibraryCoreFeedPageParseResult<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return failure(`${label} must be one plain record`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) return failure(`${label} has unknown or missing fields`);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return failure(`${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return success(snapshot);
}

function boundedString(
  value: unknown,
  maximumBytes: number,
  nullable = false,
): value is string | null {
  return (
    (nullable && value === null) ||
    (typeof value === "string" && textEncoder.encode(value).byteLength <= maximumBytes)
  );
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum);
}

function parseRequest(
  value: unknown,
  queryId: LibraryCoreSecondarySurfaceRequestV1["queryId"],
  maximumLimit: number,
): LibraryCoreFeedPageParseResult<LibraryCoreSecondarySurfaceRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS, "request");
  if (!record.ok) return record;
  const input = record.value;
  if (
    input.queryId !== queryId ||
    input.schemaVersion !== 1 ||
    !isLibraryCoreOperationInstanceId(input.readerSessionId) ||
    !isLibraryCoreOperationInstanceId(input.cancellationId) ||
    !isLibraryCoreNonnegativeSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > maximumLimit
  ) return failure("request identity or bounds are invalid");
  return success(Object.freeze({
    cancellationId: input.cancellationId,
    limit: input.limit,
    queryId,
    readerSessionId: input.readerSessionId,
    schemaVersion: 1,
  }));
}

export function parseLibraryCoreMapMarkersRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreMapMarkersRequestV1> {
  return parseRequest(value, LIBRARY_CORE_MAP_MARKERS_QUERY_ID, LIBRARY_CORE_MAP_MARKERS_MAXIMUM_LIMIT) as LibraryCoreFeedPageParseResult<LibraryCoreMapMarkersRequestV1>;
}

export function parseLibraryCoreStoryWallCandidatesRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreStoryWallCandidatesRequestV1> {
  return parseRequest(value, LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID, LIBRARY_CORE_STORY_WALL_CANDIDATES_MAXIMUM_LIMIT) as LibraryCoreFeedPageParseResult<LibraryCoreStoryWallCandidatesRequestV1>;
}

function parseMapRow(value: unknown): LibraryCoreFeedPageParseResult<LibraryCoreMapMarkerV1> {
  const record = closedRecord(value, MAP_ROW_KEYS, "map row");
  if (!record.ok) return record;
  const row = record.value;
  if (
    !isLibraryCoreEntityId(row.globalId) ||
    !PLATFORMS.has(row.platform as Platform) ||
    !CONTENT_TYPES.has(row.contentType as ContentType) ||
    !boundedString(row.authorId, 4_096) ||
    !boundedString(row.authorHandle, 1_024) ||
    !boundedString(row.authorDisplayName, 2_048) ||
    !boundedString(row.authorAvatarUrl, 8_192, true) ||
    !boundedString(row.friendPersonId, 4_096, true) ||
    !boundedString(row.friendName, 2_048, true) ||
    !boundedString(row.friendAvatarUrl, 8_192, true) ||
    !boundedString(row.linkedAccountId, 4_096, true) ||
    !boundedString(row.contentText, 8_192, true) ||
    !boundedString(row.sourceUrl, 8_192, true) ||
    !boundedString(row.locationName, 2_048, true) ||
    !boundedString(row.locationUrl, 8_192, true) ||
    !finiteCoordinate(row.locationLat, -90, 90) ||
    !finiteCoordinate(row.locationLng, -180, 180) ||
    !isLibraryCoreNonnegativeSafeInteger(row.capturedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(row.publishedAt) ||
    !(row.timeRangeStartsAt === null || isLibraryCoreNonnegativeSafeInteger(row.timeRangeStartsAt)) ||
    !(row.timeRangeEndsAt === null || isLibraryCoreNonnegativeSafeInteger(row.timeRangeEndsAt)) ||
    ((row.locationLat === null) !== (row.locationLng === null)) ||
    (row.locationLat === null && row.locationName === null)
  ) return failure("map row is invalid or unbounded");
  const hasFriend = row.friendPersonId !== null;
  if (
    (hasFriend && (
      row.friendName === null ||
      row.friendRelationshipStatus === null ||
      !RELATIONSHIP_STATUSES.has(row.friendRelationshipStatus as RelationshipStatus)
    )) ||
    (!hasFriend && (
      row.friendName !== null ||
      row.friendAvatarUrl !== null ||
      row.friendRelationshipStatus !== null
    ))
  ) return failure("map row Friend identity is incomplete");
  return success(Object.freeze(row as unknown as LibraryCoreMapMarkerV1));
}

function parseStoryRow(value: unknown): LibraryCoreFeedPageParseResult<LibraryCoreStoryWallCandidateV1> {
  const record = closedRecord(value, STORY_ROW_KEYS, "story row");
  if (!record.ok) return record;
  const row = record.value;
  if (
    !isLibraryCoreEntityId(row.globalId) ||
    !PLATFORMS.has(row.platform as Platform) ||
    !boundedString(row.authorId, 4_096) ||
    !boundedString(row.authorHandle, 1_024) ||
    !boundedString(row.authorDisplayName, 2_048) ||
    !boundedString(row.contentText, 8_192, true) ||
    !boundedString(row.sourceUrl, 8_192, true) ||
    !boundedString(row.locationName, 2_048, true) ||
    !isLibraryCoreNonnegativeSafeInteger(row.capturedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(row.publishedAt) ||
    !Array.isArray(row.mediaUrls) ||
    !Array.isArray(row.mediaTypes) ||
    row.mediaUrls.length < 1 ||
    row.mediaUrls.length > 8 ||
    row.mediaTypes.length !== row.mediaUrls.length ||
    row.mediaUrls.some((entry) => !boundedString(entry, 8_192)) ||
    row.mediaTypes.some((entry) => !MEDIA_TYPES.has(entry as MediaType | "unknown"))
  ) return failure("story row is invalid or unbounded");
  return success(Object.freeze({ ...row, mediaTypes: Object.freeze([...row.mediaTypes]), mediaUrls: Object.freeze([...row.mediaUrls]) } as unknown as LibraryCoreStoryWallCandidateV1));
}

function parseResponse<Row, Response>(
  value: unknown,
  requestValue: unknown,
  queryId: LibraryCoreSecondarySurfaceRequestV1["queryId"],
  maximumLimit: number,
  parseRow: (value: unknown) => LibraryCoreFeedPageParseResult<Row>,
): LibraryCoreFeedPageParseResult<Response> {
  const request = parseRequest(requestValue, queryId, maximumLimit);
  if (!request.ok) return failure(request.error);
  const record = closedRecord(value, RESPONSE_KEYS, "response");
  if (!record.ok) return record as LibraryCoreFeedPageParseResult<Response>;
  const input = record.value;
  if (
    input.queryId !== queryId || input.schemaVersion !== 1 ||
    typeof input.hasMore !== "boolean" ||
    !Array.isArray(input.rows) || input.rows.length > request.value.limit
  ) return failure("response identity or bounds are invalid");
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return failure(source.error);
  const rows: Row[] = [];
  for (const rowValue of input.rows) {
    const row = parseRow(rowValue);
    if (!row.ok) return failure(row.error);
    rows.push(row.value);
  }
  const response = Object.freeze({
    hasMore: input.hasMore,
    queryId,
    rows: Object.freeze(rows),
    schemaVersion: 1,
    source: source.value,
  });
  if (textEncoder.encode(JSON.stringify(response)).byteLength > LIBRARY_CORE_SECONDARY_SURFACE_MAXIMUM_RESPONSE_BYTES) {
    return failure("response exceeds its byte bound");
  }
  return success(response as Response);
}

export function parseLibraryCoreMapMarkersResponseV1(value: unknown, request: unknown) {
  return parseResponse<LibraryCoreMapMarkerV1, LibraryCoreMapMarkersResponseV1>(value, request, LIBRARY_CORE_MAP_MARKERS_QUERY_ID, LIBRARY_CORE_MAP_MARKERS_MAXIMUM_LIMIT, parseMapRow);
}

export function parseLibraryCoreStoryWallCandidatesResponseV1(value: unknown, request: unknown) {
  return parseResponse<LibraryCoreStoryWallCandidateV1, LibraryCoreStoryWallCandidatesResponseV1>(value, request, LIBRARY_CORE_STORY_WALL_CANDIDATES_QUERY_ID, LIBRARY_CORE_STORY_WALL_CANDIDATES_MAXIMUM_LIMIT, parseStoryRow);
}
