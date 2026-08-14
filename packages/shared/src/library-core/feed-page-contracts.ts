import {
  isLibraryCoreEntityId,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEntityId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";
import type {
  ContentSignal,
  ContentType,
  FeedItem,
  MediaType,
  Platform,
} from "../types.js";

export const LIBRARY_CORE_FEED_PAGE_QUERY_ID = "feed_page_v1";
export const LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION = 1;
export const LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT = 64;
export const LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT = 128;
export const LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES = 2 * 1_048_576;
export const LIBRARY_CORE_FEED_PAGE_MAXIMUM_CURSOR_BYTES = 5_540;

export const LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS = Object.freeze({
  mediaUrls: Object.freeze({
    maximumItems: 8,
    maximumUnicodeScalarsPerItem: 2_048,
    maximumUtf8BytesPerItem: 8_192,
  }),
  mediaTypes: Object.freeze({
    maximumItems: 8,
    maximumUnicodeScalarsPerItem: 16,
    maximumUtf8BytesPerItem: 64,
  }),
  tags: Object.freeze({
    maximumItems: 32,
    maximumUnicodeScalarsPerItem: 256,
    maximumUtf8BytesPerItem: 1_024,
  }),
  contentSignalTags: Object.freeze({
    maximumItems: 32,
    maximumUnicodeScalarsPerItem: 64,
    maximumUtf8BytesPerItem: 256,
  }),
});

export const LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_feed_page_request_v1",
  schemaVersion: LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FEED_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "cancellationId",
    "cursor",
    "limit",
    "queryId",
    "readerSessionId",
    "schemaVersion",
  ]),
  cursorCodec: "library_core_feed_page_cursor_v1",
  defaultLimit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  filterContract: "visible_nonhidden_nonarchived_only_v1",
  maximumLimit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  maximumCursorBytes: LIBRARY_CORE_FEED_PAGE_MAXIMUM_CURSOR_BYTES,
});

export const LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_feed_page_response_v1",
  schemaVersion: LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_FEED_PAGE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "schemaVersion",
    "source",
    "totalCount",
  ]),
  maximumRows: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_FEED_PAGE_PROJECTION = Object.freeze({
  projectionId: "library_core_feed_card_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["sortAt", "globalId"]),
  selectedFields: Object.freeze([
    "globalId",
    "platform",
    "contentType",
    "publishedAt",
    "capturedAt",
    "authorId",
    "authorDisplayName",
    "authorHandle",
    "authorAvatarUrl",
    "sourceUrl",
    "readAt",
    "saved",
    "archived",
    "liked",
    "likedAt",
    "likedSyncedAt",
    "contentText",
    "mediaUrls",
    "mediaTypes",
    "linkPreviewTitle",
    "tags",
    "engagementLikes",
    "engagementComments",
    "locationName",
    "readingTimeMinutes",
    "contentSignalTags",
    "eventStartsAt",
    "eventConfidenceBasisPoints",
  ]),
});

export const LIBRARY_CORE_FEED_PAGE_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

const FEED_CARD_KEYS = [
  "archived",
  "authorAvatarUrl",
  "authorDisplayName",
  "authorHandle",
  "authorId",
  "capturedAt",
  "contentSignalTags",
  "contentText",
  "contentType",
  "engagementComments",
  "engagementLikes",
  "eventConfidenceBasisPoints",
  "eventStartsAt",
  "globalId",
  "liked",
  "likedAt",
  "likedSyncedAt",
  "linkPreviewTitle",
  "locationName",
  "mediaTypes",
  "mediaUrls",
  "platform",
  "publishedAt",
  "readAt",
  "readingTimeMinutes",
  "saved",
  "sourceUrl",
  "tags",
] as const;

const REQUEST_KEYS = LIBRARY_CORE_FEED_PAGE_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS = LIBRARY_CORE_FEED_PAGE_RESPONSE_SCHEMA.canonicalKeys;
const SOURCE_KEYS = [
  "generationId",
  "projectionRevision",
  "transitionSequence",
] as const;

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUE = new Map(
  Array.from(BASE64URL_ALPHABET, (character, index) => [character, index]),
);
const CURSOR_VERSION = 1;
const CURSOR_FIXED_BYTES = 59;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

export interface LibraryCoreFeedPageCursorV1 {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly transitionSequence: number;
  readonly projectionRevision: number;
  readonly sortAt: number;
  readonly globalId: LibraryCoreEntityId;
}

export interface LibraryCoreFeedPageRequestV1 {
  readonly cancellationId: LibraryCoreOperationInstanceId;
  readonly cursor: string | null;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_FEED_PAGE_QUERY_ID;
  readonly readerSessionId: LibraryCoreOperationInstanceId;
  readonly schemaVersion: typeof LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION;
}

export interface LibraryCoreFeedPageSourceV1 {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly projectionRevision: number;
  readonly transitionSequence: number;
}

export interface LibraryCoreFeedCardV1 {
  readonly archived: boolean | null;
  readonly authorAvatarUrl: string | null;
  readonly authorDisplayName: string | null;
  readonly authorHandle: string | null;
  readonly authorId: string | null;
  readonly capturedAt: number | null;
  readonly contentSignalTags: readonly string[];
  readonly contentText: string | null;
  readonly contentType: string | null;
  readonly engagementComments: number | null;
  readonly engagementLikes: number | null;
  readonly eventConfidenceBasisPoints: number | null;
  readonly eventStartsAt: number | null;
  readonly globalId: LibraryCoreEntityId;
  readonly liked: boolean | null;
  readonly likedAt: number | null;
  readonly likedSyncedAt: number | null;
  readonly linkPreviewTitle: string | null;
  readonly locationName: string | null;
  readonly mediaTypes: readonly string[];
  readonly mediaUrls: readonly string[];
  readonly platform: string | null;
  readonly publishedAt: number | null;
  readonly readAt: number | null;
  readonly readingTimeMinutes: number | null;
  readonly saved: boolean | null;
  readonly sourceUrl: string | null;
  readonly tags: readonly string[];
}

export interface LibraryCoreFeedPageResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_FEED_PAGE_QUERY_ID;
  readonly rows: readonly LibraryCoreFeedCardV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

const FEED_CARD_PLATFORMS = new Set<Platform>([
  "x", "rss", "youtube", "reddit", "mastodon", "github", "facebook",
  "instagram", "linkedin", "substack", "medium", "saved",
]);
const FEED_CARD_CONTENT_TYPES = new Set<ContentType>([
  "post", "story", "article", "video", "podcast",
]);
const FEED_CARD_MEDIA_TYPES = new Set<MediaType>(["image", "video", "link"]);

/** Reconstruct the bounded product card represented by one portable feed row. */
export function libraryCoreFeedCardToItemV1(card: LibraryCoreFeedCardV1): FeedItem {
  const platform = FEED_CARD_PLATFORMS.has(card.platform as Platform)
    ? (card.platform as Platform) : "saved";
  const contentType = FEED_CARD_CONTENT_TYPES.has(card.contentType as ContentType)
    ? (card.contentType as ContentType) : "post";
  const publishedAt = card.publishedAt ?? 0;
  const capturedAt = card.capturedAt ?? publishedAt;
  return {
    globalId: card.globalId,
    platform,
    contentType,
    capturedAt,
    publishedAt,
    author: {
      id: card.authorId ?? "",
      handle: card.authorHandle ?? "",
      displayName: card.authorDisplayName ?? card.authorHandle ?? "",
      ...(card.authorAvatarUrl ? { avatarUrl: card.authorAvatarUrl } : {}),
    },
    content: {
      ...(card.contentText ? { text: card.contentText } : {}),
      mediaUrls: [...card.mediaUrls],
      mediaTypes: card.mediaTypes.filter(
        (value): value is MediaType => FEED_CARD_MEDIA_TYPES.has(value as MediaType),
      ),
      ...(card.linkPreviewTitle && card.sourceUrl
        ? { linkPreview: { url: card.sourceUrl, title: card.linkPreviewTitle } }
        : {}),
    },
    ...(card.engagementLikes !== null || card.engagementComments !== null
      ? { engagement: {
          ...(card.engagementLikes !== null ? { likes: card.engagementLikes } : {}),
          ...(card.engagementComments !== null ? { comments: card.engagementComments } : {}),
        } }
      : {}),
    ...(card.locationName
      ? { location: { name: card.locationName, source: "text_extraction" as const } }
      : {}),
    userState: {
      hidden: false,
      ...(card.readAt !== null ? { readAt: card.readAt } : {}),
      saved: card.saved === true,
      archived: card.archived === true,
      tags: [...card.tags],
      ...(card.liked !== null ? { liked: card.liked } : {}),
      ...(card.likedAt !== null ? { likedAt: card.likedAt } : {}),
      ...(card.likedSyncedAt !== null ? { likedSyncedAt: card.likedSyncedAt } : {}),
    },
    topics: [],
    ...(card.contentSignalTags.length > 0
      ? { contentSignals: {
          version: 1,
          method: "rules" as const,
          inferredAt: capturedAt,
          scores: {},
          tags: [...card.contentSignalTags] as ContentSignal[],
        } }
      : {}),
    ...(card.eventStartsAt !== null
      ? { eventCandidate: {
          version: 1,
          method: "rules" as const,
          detectedAt: capturedAt,
          confidence: (card.eventConfidenceBasisPoints ?? 0) / 10_000,
          startsAt: card.eventStartsAt,
          ...(card.locationName ? { locationName: card.locationName } : {}),
        } }
      : {}),
    ...(card.sourceUrl ? { sourceUrl: card.sourceUrl } : {}),
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function projectedBoundedString(
  value: unknown,
  maximumScalars: number,
): string | null {
  if (typeof value !== "string") return null;
  let scalarCount = 0;
  let output = "";
  for (const scalar of value) {
    if (scalarCount >= maximumScalars) break;
    output += scalar;
    scalarCount += 1;
  }
  return output;
}

function projectedBoundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumScalars: number,
): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const output: string[] = [];
  for (const entry of value) {
    if (output.length >= maximumItems) break;
    const bounded = projectedBoundedString(entry, maximumScalars);
    if (bounded !== null) output.push(bounded);
  }
  return Object.freeze(output);
}

function projectedSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function projectedLikeSyncTimestamp(value: unknown): number | null {
  return value === -1 ? -1 : projectedSafeInteger(value);
}

function projectedBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Match the compact SQLite feed-card projection without retaining full content
 * or preserved reader bodies. The function touches one item at a time so a
 * browser materializer can keep its working set independent of corpus size.
 */
export function projectLibraryCoreFeedCardV1(
  item: FeedItem,
): LibraryCoreFeedCardV1 {
  const raw = recordValue(item);
  const author = recordValue(raw?.author);
  const content = recordValue(raw?.content);
  const userState = recordValue(raw?.userState);
  const engagement = recordValue(raw?.engagement);
  const location = recordValue(raw?.location);
  const preserved = recordValue(raw?.preservedContent);
  const contentSignals = recordValue(raw?.contentSignals);
  const eventCandidate = recordValue(raw?.eventCandidate);
  const linkPreview = recordValue(content?.linkPreview);
  const confidence = eventCandidate?.confidence;
  const projected = {
    archived: projectedBoolean(userState?.archived),
    authorAvatarUrl: projectedBoundedString(author?.avatarUrl, 2_048),
    authorDisplayName: projectedBoundedString(author?.displayName, 512),
    authorHandle: projectedBoundedString(author?.handle, 256),
    authorId: projectedBoundedString(author?.id, 4_096),
    capturedAt: projectedSafeInteger(raw?.capturedAt),
    contentSignalTags: projectedBoundedStringArray(
      contentSignals?.tags,
      32,
      64,
    ),
    contentText: projectedBoundedString(content?.text, 1_500),
    contentType: projectedBoundedString(raw?.contentType, 128),
    engagementComments: projectedSafeInteger(engagement?.comments),
    engagementLikes: projectedSafeInteger(engagement?.likes),
    eventConfidenceBasisPoints:
      typeof confidence === "number" &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1
        ? Math.round(confidence * 10_000)
        : null,
    eventStartsAt: projectedSafeInteger(eventCandidate?.startsAt),
    globalId: raw?.globalId,
    liked: projectedBoolean(userState?.liked),
    likedAt: projectedSafeInteger(userState?.likedAt),
    likedSyncedAt: projectedLikeSyncTimestamp(userState?.likedSyncedAt),
    linkPreviewTitle: projectedBoundedString(linkPreview?.title, 512),
    locationName: projectedBoundedString(location?.name, 512),
    mediaTypes: projectedBoundedStringArray(content?.mediaTypes, 8, 16),
    mediaUrls: projectedBoundedStringArray(content?.mediaUrls, 8, 2_048),
    platform: projectedBoundedString(raw?.platform, 64),
    publishedAt: projectedSafeInteger(raw?.publishedAt),
    readAt: projectedSafeInteger(userState?.readAt),
    readingTimeMinutes: projectedSafeInteger(preserved?.readingTime),
    saved: projectedBoolean(userState?.saved),
    sourceUrl: projectedBoundedString(raw?.sourceUrl, 2_048),
    tags: projectedBoundedStringArray(userState?.tags, 32, 256),
  };
  const parsed = parseLibraryCoreFeedCardV1(projected);
  if (!parsed.ok) {
    throw new TypeError(parsed.error);
  }
  return parsed.value;
}

/** Match `archived IS NOT 1 AND hidden IS NOT 1` in the native reader. */
export function isLibraryCoreVisibleFeedItemV1(item: FeedItem): boolean {
  const userState = recordValue(recordValue(item)?.userState);
  return userState?.archived !== true && userState?.hidden !== true;
}

export type LibraryCoreFeedPageParseResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

function success<T>(value: T): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function snapshotClosedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): LibraryCoreFeedPageParseResult<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return failure(`${label} must be one plain record`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return failure(`${label} has unknown or missing fields`);
  }

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

function countUnicodeScalarsAndUtf8Bytes(
  value: string,
): { scalars: number; utf8Bytes: number } | null {
  let scalars = 0;
  let utf8Bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    scalars += 1;
    if (codeUnit <= 0x7f) {
      utf8Bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      utf8Bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return null;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return null;
      utf8Bytes += 4;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return null;
    } else {
      utf8Bytes += 3;
    }
  }
  return { scalars, utf8Bytes };
}

function boundedString(
  value: unknown,
  maximumUnicodeScalars: number,
  maximumUtf8Bytes: number,
): value is string {
  if (typeof value !== "string") return false;
  const size = countUnicodeScalarsAndUtf8Bytes(value);
  return (
    size !== null &&
    size.scalars <= maximumUnicodeScalars &&
    size.utf8Bytes <= maximumUtf8Bytes
  );
}

function optionalBoundedString(
  value: unknown,
  maximumUnicodeScalars: number,
  maximumUtf8Bytes: number,
): value is string | null {
  return (
    value === null ||
    boundedString(value, maximumUnicodeScalars, maximumUtf8Bytes)
  );
}

function optionalNonnegativeSafeInteger(
  value: unknown,
): value is number | null {
  return value === null || isLibraryCoreNonnegativeSafeInteger(value);
}

function optionalLikeSyncTimestamp(value: unknown): value is number | null {
  return value === -1 || optionalNonnegativeSafeInteger(value);
}

function optionalBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function snapshotBoundedStringArray(
  value: unknown,
  bounds: {
    readonly maximumItems: number;
    readonly maximumUnicodeScalarsPerItem: number;
    readonly maximumUtf8BytesPerItem: number;
  },
): readonly string[] | null {
  if (!Array.isArray(value) || value.length > bounds.maximumItems) return null;
  const snapshot: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      !boundedString(
        descriptor.value,
        bounds.maximumUnicodeScalarsPerItem,
        bounds.maximumUtf8BytesPerItem,
      )
    ) {
      return null;
    }
    snapshot.push(descriptor.value);
  }
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" ||
          !/^(0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= value.length),
    )
  ) {
    return null;
  }
  return Object.freeze(snapshot);
}

function lowerHexToBytes(value: LibraryCoreLowercaseHex64): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToLowerHex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const packed =
      (bytes[index]! << 16) |
      ((bytes[index + 1] ?? 0) << 8) |
      (bytes[index + 2] ?? 0);
    output += BASE64URL_ALPHABET[(packed >>> 18) & 63];
    output += BASE64URL_ALPHABET[(packed >>> 12) & 63];
    if (remaining > 1) output += BASE64URL_ALPHABET[(packed >>> 6) & 63];
    if (remaining > 2) output += BASE64URL_ALPHABET[packed & 63];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length > LIBRARY_CORE_FEED_PAGE_MAXIMUM_CURSOR_BYTES ||
    value.length % 4 === 1
  ) {
    return null;
  }
  const outputLength = Math.floor((value.length * 6) / 8);
  const output = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let outputIndex = 0;
  for (const character of value) {
    const decoded = BASE64URL_VALUE.get(character);
    if (decoded === undefined) return null;
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outputIndex] = (buffer >>> bits) & 0xff;
      outputIndex += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) return null;
  if (outputIndex !== output.length || encodeBase64Url(output) !== value) {
    return null;
  }
  return output;
}

export function encodeLibraryCoreFeedPageCursorV1(
  cursor: LibraryCoreFeedPageCursorV1,
): string {
  if (
    !isLibraryCoreLowercaseHex64(cursor.generationId) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.transitionSequence) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.projectionRevision) ||
    !isLibraryCoreNonnegativeSafeInteger(cursor.sortAt) ||
    !isLibraryCoreEntityId(cursor.globalId)
  ) {
    throw new TypeError("invalid Library Core feed-page cursor");
  }
  const globalId = textEncoder.encode(cursor.globalId);
  const bytes = new Uint8Array(CURSOR_FIXED_BYTES + globalId.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = CURSOR_VERSION;
  bytes.set(lowerHexToBytes(cursor.generationId), 1);
  view.setBigUint64(33, BigInt(cursor.transitionSequence), false);
  view.setBigUint64(41, BigInt(cursor.projectionRevision), false);
  view.setBigUint64(49, BigInt(cursor.sortAt), false);
  view.setUint16(57, globalId.length, false);
  bytes.set(globalId, CURSOR_FIXED_BYTES);
  return encodeBase64Url(bytes);
}

export function decodeLibraryCoreFeedPageCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedPageCursorV1> {
  if (typeof value !== "string") return failure("cursor must be a string");
  const bytes = decodeBase64Url(value);
  if (
    !bytes ||
    bytes.length < CURSOR_FIXED_BYTES ||
    bytes[0] !== CURSOR_VERSION
  ) {
    return failure("cursor has invalid encoding or version");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const globalIdLength = view.getUint16(57, false);
  if (bytes.length !== CURSOR_FIXED_BYTES + globalIdLength) {
    return failure("cursor length does not match its entity identity");
  }
  const generationId = bytesToLowerHex(bytes.subarray(1, 33));
  const transitionSequence = view.getBigUint64(33, false);
  const projectionRevision = view.getBigUint64(41, false);
  const sortAt = view.getBigUint64(49, false);
  if (
    transitionSequence > BigInt(Number.MAX_SAFE_INTEGER) ||
    projectionRevision > BigInt(Number.MAX_SAFE_INTEGER) ||
    sortAt > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return failure("cursor contains an unsafe integer");
  }
  let globalId: string;
  try {
    globalId = fatalTextDecoder.decode(bytes.subarray(CURSOR_FIXED_BYTES));
  } catch {
    return failure("cursor entity identity is not valid UTF-8");
  }
  if (
    !isLibraryCoreLowercaseHex64(generationId) ||
    !isLibraryCoreEntityId(globalId)
  ) {
    return failure("cursor identity is invalid");
  }
  return success(
    Object.freeze({
      generationId,
      transitionSequence: Number(transitionSequence),
      projectionRevision: Number(projectionRevision),
      sortAt: Number(sortAt),
      globalId,
    }),
  );
}

export function parseLibraryCoreFeedPageRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedPageRequestV1> {
  const record = snapshotClosedRecord(value, REQUEST_KEYS, "request");
  if (!record.ok) return record;
  const input = record.value;
  if (
    input.queryId !== LIBRARY_CORE_FEED_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(input.readerSessionId) ||
    !isLibraryCoreOperationInstanceId(input.cancellationId) ||
    !isLibraryCoreNonnegativeSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT
  ) {
    return failure("request identity or bounds are invalid");
  }
  if (input.cursor !== null && typeof input.cursor !== "string") {
    return failure("request cursor must be null or a string");
  }
  const cursorValue = input.cursor;
  if (cursorValue !== null) {
    const cursor = decodeLibraryCoreFeedPageCursorV1(cursorValue);
    if (!cursor.ok) return failure(cursor.error);
  }
  return success(
    Object.freeze({
      cancellationId: input.cancellationId,
      cursor: cursorValue,
      limit: input.limit,
      queryId: LIBRARY_CORE_FEED_PAGE_QUERY_ID,
      readerSessionId: input.readerSessionId,
      schemaVersion: LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION,
    }),
  );
}

export function parseLibraryCoreFeedPageSourceV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedPageSourceV1> {
  const record = snapshotClosedRecord(value, SOURCE_KEYS, "response.source");
  if (!record.ok) return record;
  const source = record.value;
  if (
    !isLibraryCoreLowercaseHex64(source.generationId) ||
    !isLibraryCoreNonnegativeSafeInteger(source.transitionSequence) ||
    !isLibraryCoreNonnegativeSafeInteger(source.projectionRevision)
  ) {
    return failure("response source identity is invalid");
  }
  return success(
    Object.freeze({
      generationId: source.generationId,
      projectionRevision: source.projectionRevision,
      transitionSequence: source.transitionSequence,
    }),
  );
}

export function parseLibraryCoreFeedCardV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedCardV1> {
  const record = snapshotClosedRecord(value, FEED_CARD_KEYS, "feed card");
  if (!record.ok) return record;
  const row = record.value;
  const mediaUrls = snapshotBoundedStringArray(
    row.mediaUrls,
    LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS.mediaUrls,
  );
  const mediaTypes = snapshotBoundedStringArray(
    row.mediaTypes,
    LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS.mediaTypes,
  );
  const tags = snapshotBoundedStringArray(
    row.tags,
    LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS.tags,
  );
  const contentSignalTags = snapshotBoundedStringArray(
    row.contentSignalTags,
    LIBRARY_CORE_FEED_PAGE_NESTED_BOUNDS.contentSignalTags,
  );
  if (
    !isLibraryCoreEntityId(row.globalId) ||
    !optionalBoundedString(row.platform, 64, 256) ||
    !optionalBoundedString(row.contentType, 128, 512) ||
    !optionalNonnegativeSafeInteger(row.publishedAt) ||
    !optionalNonnegativeSafeInteger(row.capturedAt) ||
    !optionalBoundedString(row.authorId, 4_096, 16_384) ||
    !optionalBoundedString(row.authorDisplayName, 512, 2_048) ||
    !optionalBoundedString(row.authorHandle, 256, 1_024) ||
    !optionalBoundedString(row.authorAvatarUrl, 2_048, 8_192) ||
    !optionalBoundedString(row.sourceUrl, 2_048, 8_192) ||
    !optionalNonnegativeSafeInteger(row.readAt) ||
    !optionalBoolean(row.saved) ||
    !optionalBoolean(row.archived) ||
    !optionalBoolean(row.liked) ||
    !optionalNonnegativeSafeInteger(row.likedAt) ||
    !optionalLikeSyncTimestamp(row.likedSyncedAt) ||
    !optionalBoundedString(row.contentText, 1_500, 6_000) ||
    !mediaUrls ||
    !mediaTypes ||
    !optionalBoundedString(row.linkPreviewTitle, 512, 2_048) ||
    !tags ||
    !optionalNonnegativeSafeInteger(row.engagementLikes) ||
    !optionalNonnegativeSafeInteger(row.engagementComments) ||
    !optionalBoundedString(row.locationName, 512, 2_048) ||
    !optionalNonnegativeSafeInteger(row.readingTimeMinutes) ||
    !contentSignalTags ||
    !optionalNonnegativeSafeInteger(row.eventStartsAt) ||
    !optionalNonnegativeSafeInteger(row.eventConfidenceBasisPoints) ||
    (row.eventConfidenceBasisPoints !== null &&
      (row.eventConfidenceBasisPoints < 0 ||
        row.eventConfidenceBasisPoints > 10_000))
  ) {
    return failure("feed card contains an invalid or unbounded field");
  }
  return success(
    Object.freeze({
      archived: row.archived,
      authorAvatarUrl: row.authorAvatarUrl,
      authorDisplayName: row.authorDisplayName,
      authorHandle: row.authorHandle,
      authorId: row.authorId,
      capturedAt: row.capturedAt,
      contentSignalTags,
      contentText: row.contentText,
      contentType: row.contentType,
      engagementComments: row.engagementComments,
      engagementLikes: row.engagementLikes,
      eventConfidenceBasisPoints: row.eventConfidenceBasisPoints,
      eventStartsAt: row.eventStartsAt,
      globalId: row.globalId,
      liked: row.liked,
      likedAt: row.likedAt,
      likedSyncedAt: row.likedSyncedAt,
      linkPreviewTitle: row.linkPreviewTitle,
      locationName: row.locationName,
      mediaTypes,
      mediaUrls,
      platform: row.platform,
      publishedAt: row.publishedAt,
      readAt: row.readAt,
      readingTimeMinutes: row.readingTimeMinutes,
      saved: row.saved,
      sourceUrl: row.sourceUrl,
      tags,
    }),
  );
}

export function parseLibraryCoreFeedPageResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFeedPageResponseV1> {
  const request = parseLibraryCoreFeedPageRequestV1(requestValue);
  if (!request.ok) {
    return failure(`response request is invalid: ${request.error}`);
  }
  const record = snapshotClosedRecord(value, RESPONSE_KEYS, "response");
  if (!record.ok) return record;
  const input = record.value;
  const inputRows = input.rows;
  if (
    input.queryId !== LIBRARY_CORE_FEED_PAGE_QUERY_ID ||
    input.schemaVersion !== LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION ||
    !isLibraryCoreNonnegativeSafeInteger(input.totalCount) ||
    !Array.isArray(inputRows) ||
    inputRows.length > request.value.limit
  ) {
    return failure("response identity or top-level bounds are invalid");
  }
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) return source;
  if (request.value.cursor !== null) {
    const requestCursor = decodeLibraryCoreFeedPageCursorV1(
      request.value.cursor,
    );
    if (
      !requestCursor.ok ||
      requestCursor.value.generationId !== source.value.generationId ||
      requestCursor.value.transitionSequence !==
        source.value.transitionSequence ||
      requestCursor.value.projectionRevision !== source.value.projectionRevision
    ) {
      return failure("response source does not match its request cursor");
    }
  }

  const rows: LibraryCoreFeedCardV1[] = [];
  let serializedRowsBytes = 0;
  for (let index = 0; index < inputRows.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      inputRows,
      String(index),
    );
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return failure("response rows must be one dense data array");
    }
    const parsed = parseLibraryCoreFeedCardV1(descriptor.value);
    if (!parsed.ok) return parsed;
    serializedRowsBytes += textEncoder.encode(
      JSON.stringify(parsed.value),
    ).length;
    if (index > 0) serializedRowsBytes += 1;
    if (serializedRowsBytes > LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES) {
      return failure("response exceeds the feed-page byte ceiling");
    }
    rows.push(parsed.value);
  }
  if (
    Reflect.ownKeys(inputRows).some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" ||
          !/^(0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= inputRows.length),
    )
  ) {
    return failure("response rows contain decorated or sparse entries");
  }

  if (input.totalCount < rows.length) {
    return failure("response total count is smaller than its returned rows");
  }
  if (input.nextCursor !== null && typeof input.nextCursor !== "string") {
    return failure("response next cursor must be null or a string");
  }
  const nextCursor = input.nextCursor;
  if (nextCursor !== null) {
    const cursor = decodeLibraryCoreFeedPageCursorV1(nextCursor);
    const finalRow = rows[rows.length - 1];
    if (
      !cursor.ok ||
      !finalRow ||
      cursor.value.generationId !== source.value.generationId ||
      cursor.value.transitionSequence !== source.value.transitionSequence ||
      cursor.value.projectionRevision !== source.value.projectionRevision ||
      cursor.value.globalId !== finalRow.globalId
    ) {
      return failure(
        "next cursor does not bind the response source and final row",
      );
    }
  }

  const response: LibraryCoreFeedPageResponseV1 = Object.freeze({
    nextCursor,
    queryId: LIBRARY_CORE_FEED_PAGE_QUERY_ID,
    rows: Object.freeze(rows),
    schemaVersion: LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION,
    source: source.value,
    totalCount: input.totalCount,
  });
  const emptyRowsEnvelopeBytes = textEncoder.encode(
    JSON.stringify({ ...response, rows: [] }),
  ).length;
  if (
    emptyRowsEnvelopeBytes + serializedRowsBytes >
    LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("response exceeds the feed-page byte ceiling");
  }
  return success(response);
}
