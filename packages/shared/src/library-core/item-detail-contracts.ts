import {
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreLowercaseHex64 } from "./protocol-scalars.js";

export const LIBRARY_CORE_ITEM_DETAIL_QUERY_ID = "item_detail_v1" as const;
export const LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES = 2_048;
export const LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES = 2 * 1_048_576;

export const LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_item_detail_request_v1",
  schemaVersion: LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze(["globalId", "queryId", "schemaVersion"]),
  requiresNonEmptyGlobalId: true,
  maximumGlobalIdUtf8Bytes:
    LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
});

export const LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_item_detail_response_v1",
  schemaVersion: LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze(["item", "queryId", "schemaVersion", "source"]),
  itemKeys: Object.freeze([
    "card",
    "contentBody",
    "mediaBlobDigests",
    "preservedBody",
  ]),
  bodyLocatorKeys: Object.freeze(["blobDigest", "storage"]),
  nullableItem: true,
  maximumRows: 1,
  maximumResponseBytes: LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_ITEM_DETAIL_PROJECTION = Object.freeze({
  projectionId: "library_core_item_detail_metadata_v1",
  sourceTable: "feed_items",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["globalId"]),
});

export const LIBRARY_CORE_ITEM_DETAIL_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS = Object.freeze({
  globalId: Object.freeze({
    maximumItems: 1,
    maximumUnicodeScalarsPerItem:
      LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
    maximumUtf8BytesPerItem:
      LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
  }),
  bodyLocators: Object.freeze({
    maximumItems: 2,
    maximumDigestUtf8BytesPerItem: 64,
  }),
  mediaBlobDigests: Object.freeze({
    maximumItems: 8,
    maximumDigestUtf8BytesPerItem: 64,
  }),
});

export type LibraryCoreItemBodyStorageV1 = "blob" | "inline" | "none";

export interface LibraryCoreItemBodyLocatorV1 {
  readonly blobDigest: string | null;
  readonly storage: LibraryCoreItemBodyStorageV1;
}

export interface LibraryCoreItemDetailV1 {
  readonly card: LibraryCoreFeedCardV1;
  readonly contentBody: LibraryCoreItemBodyLocatorV1;
  readonly mediaBlobDigests: readonly (string | null)[];
  readonly preservedBody: LibraryCoreItemBodyLocatorV1;
}

export interface LibraryCoreItemDetailRequestV1 {
  readonly globalId: string;
  readonly queryId: typeof LIBRARY_CORE_ITEM_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION;
}

export interface LibraryCoreItemDetailResponseV1 {
  readonly item: LibraryCoreItemDetailV1 | null;
  readonly queryId: typeof LIBRARY_CORE_ITEM_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS = LIBRARY_CORE_ITEM_DETAIL_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS = LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA.canonicalKeys;
const ITEM_KEYS = LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA.itemKeys;
const LOCATOR_KEYS = LIBRARY_CORE_ITEM_DETAIL_RESPONSE_SCHEMA.bodyLocatorKeys;
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

function parseBodyLocator(value: unknown): LibraryCoreItemBodyLocatorV1 | null {
  const record = closedRecord(value, LOCATOR_KEYS);
  if (
    !record ||
    !["blob", "inline", "none"].includes(String(record.storage)) ||
    (record.blobDigest !== null &&
      (typeof record.blobDigest !== "string" ||
        !isLibraryCoreLowercaseHex64(record.blobDigest))) ||
    (record.storage === "blob") !== (record.blobDigest !== null)
  ) {
    return null;
  }
  return Object.freeze({
    blobDigest: record.blobDigest as string | null,
    storage: record.storage as LibraryCoreItemBodyStorageV1,
  });
}

export function parseLibraryCoreItemDetailRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemDetailRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_ITEM_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION ||
    typeof record.globalId !== "string" ||
    record.globalId.length === 0 ||
    textEncoder.encode(record.globalId).byteLength >
      LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES
  ) {
    return failure("item detail request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      globalId: record.globalId,
      queryId: LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
      schemaVersion: LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
    }),
  });
}

export function parseLibraryCoreItemDetailResponseV1(
  value: unknown,
  requestValue?: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemDetailResponseV1> {
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  const request =
    requestValue === undefined
      ? null
      : parseLibraryCoreItemDetailRequestV1(requestValue);
  if (
    !record ||
    !source.ok ||
    (request !== null && !request.ok) ||
    record.queryId !== LIBRARY_CORE_ITEM_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION
  ) {
    return failure("item detail response is invalid");
  }
  let item: LibraryCoreItemDetailV1 | null = null;
  if (record.item !== null) {
    const itemRecord = closedRecord(record.item, ITEM_KEYS);
    const card = parseLibraryCoreFeedCardV1(itemRecord?.card);
    const contentBody = parseBodyLocator(itemRecord?.contentBody);
    const mediaBlobDigests = itemRecord?.mediaBlobDigests;
    const preservedBody = parseBodyLocator(itemRecord?.preservedBody);
    if (
      !itemRecord ||
      !card.ok ||
      !contentBody ||
      !Array.isArray(mediaBlobDigests) ||
      mediaBlobDigests.length >
        LIBRARY_CORE_ITEM_DETAIL_NESTED_BOUNDS.mediaBlobDigests.maximumItems ||
      mediaBlobDigests.some(
        (digest) => digest !== null && !isLibraryCoreLowercaseHex64(digest),
      ) ||
      mediaBlobDigests.length !== card.value.mediaUrls.length ||
      !preservedBody ||
      (request?.ok && card.value.globalId !== request.value.globalId)
    ) {
      return failure("item detail row is invalid");
    }
    item = Object.freeze({
      card: card.value,
      contentBody,
      mediaBlobDigests: Object.freeze([...mediaBlobDigests]),
      preservedBody,
    });
  }
  const response = Object.freeze({
    item,
    queryId: LIBRARY_CORE_ITEM_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_ITEM_DETAIL_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_ITEM_DETAIL_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("item detail response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
