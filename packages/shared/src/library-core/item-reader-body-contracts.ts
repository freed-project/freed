import {
  decodeLibraryCoreCanonicalBase64,
  encodeLibraryCoreCanonicalBase64,
} from "./canonical-base64.js";
import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreLowercaseHex64 } from "./protocol-scalars.js";

export const LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID =
  "item_reader_body_v1" as const;
export const LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_GLOBAL_ID_UTF8_BYTES = 2_048;
export const LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RANGE_BYTES = 256 * 1_024;
export const LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES = 512 * 1_024;

export const LIBRARY_CORE_ITEM_READER_BODY_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_item_reader_body_request_v1",
  schemaVersion: LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID,
  canonicalKeys: Object.freeze([
    "bodyKind",
    "globalId",
    "limitBytes",
    "offsetBytes",
    "queryId",
    "schemaVersion",
  ]),
  maximumGlobalIdUtf8Bytes:
    LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_GLOBAL_ID_UTF8_BYTES,
  maximumRangeBytes: LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RANGE_BYTES,
});

export const LIBRARY_CORE_ITEM_READER_BODY_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_item_reader_body_response_v1",
  schemaVersion: LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID,
  canonicalKeys: Object.freeze(["body", "queryId", "schemaVersion", "source"]),
  bodyKeys: Object.freeze([
    "blobDigest",
    "bytesBase64",
    "contentLength",
    "endOffset",
    "startOffset",
    "storage",
  ]),
  nullableBody: true,
  maximumRows: 6,
  maximumResponseBytes: LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_ITEM_READER_BODY_PROJECTION = Object.freeze({
  projectionId: "library_core_item_reader_body_range_v1",
  sourceTable: "feed_items_and_blob_chunks",
  fullContentAllowed: true,
  orderedColumns: Object.freeze(["chunkIndex"]),
});

export const LIBRARY_CORE_ITEM_READER_BODY_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_ITEM_READER_BODY_NESTED_BOUNDS = Object.freeze({
  bytes: Object.freeze({
    maximumItems: 1,
    maximumDecodedBytesPerItem:
      LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RANGE_BYTES,
    encoding: "canonical_base64",
  }),
});

export type LibraryCoreItemReaderBodyKindV1 = "content" | "preserved";
export type LibraryCoreItemReaderBodyStorageV1 = "blob" | "inline";

export interface LibraryCoreItemReaderBodyRequestV1 {
  readonly bodyKind: LibraryCoreItemReaderBodyKindV1;
  readonly globalId: string;
  readonly limitBytes: number;
  readonly offsetBytes: number;
  readonly queryId: typeof LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION;
}

export interface LibraryCoreItemReaderBodyRangeV1 {
  readonly blobDigest: string | null;
  readonly bytesBase64: string;
  readonly contentLength: number;
  readonly endOffset: number;
  readonly startOffset: number;
  readonly storage: LibraryCoreItemReaderBodyStorageV1;
}

export interface LibraryCoreItemReaderBodyResponseV1 {
  readonly body: LibraryCoreItemReaderBodyRangeV1 | null;
  readonly queryId: typeof LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS = LIBRARY_CORE_ITEM_READER_BODY_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_ITEM_READER_BODY_RESPONSE_SCHEMA.canonicalKeys;
const BODY_KEYS = LIBRARY_CORE_ITEM_READER_BODY_RESPONSE_SCHEMA.bodyKeys;
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

export function parseLibraryCoreItemReaderBodyRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemReaderBodyRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION ||
    !["content", "preserved"].includes(String(record.bodyKind)) ||
    typeof record.globalId !== "string" ||
    record.globalId.length === 0 ||
    textEncoder.encode(record.globalId).byteLength >
      LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_GLOBAL_ID_UTF8_BYTES ||
    !Number.isSafeInteger(record.offsetBytes) ||
    (record.offsetBytes as number) < 0 ||
    !Number.isSafeInteger(record.limitBytes) ||
    (record.limitBytes as number) < 1 ||
    (record.limitBytes as number) >
      LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RANGE_BYTES
  ) {
    return failure("item reader body request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      bodyKind: record.bodyKind as LibraryCoreItemReaderBodyKindV1,
      globalId: record.globalId,
      limitBytes: record.limitBytes as number,
      offsetBytes: record.offsetBytes as number,
      queryId: LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID,
      schemaVersion: LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION,
    }),
  });
}

export function parseLibraryCoreItemReaderBodyResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemReaderBodyResponseV1> {
  const request = parseLibraryCoreItemReaderBodyRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION
  ) {
    return failure("item reader body response is invalid");
  }
  let body: LibraryCoreItemReaderBodyRangeV1 | null = null;
  if (record.body !== null) {
    const candidate = closedRecord(record.body, BODY_KEYS);
    if (
      !candidate ||
      !["blob", "inline"].includes(String(candidate.storage)) ||
      (candidate.blobDigest !== null &&
        (typeof candidate.blobDigest !== "string" ||
          !isLibraryCoreLowercaseHex64(candidate.blobDigest))) ||
      (candidate.storage === "blob") !== (candidate.blobDigest !== null) ||
      typeof candidate.bytesBase64 !== "string" ||
      !Number.isSafeInteger(candidate.contentLength) ||
      (candidate.contentLength as number) < 0 ||
      !Number.isSafeInteger(candidate.startOffset) ||
      candidate.startOffset !== request.value.offsetBytes ||
      !Number.isSafeInteger(candidate.endOffset)
    ) {
      return failure("item reader body range is invalid");
    }
    let bytes: Uint8Array;
    try {
      bytes = decodeLibraryCoreCanonicalBase64(candidate.bytesBase64);
    } catch {
      return failure("item reader body bytes are invalid");
    }
    if (
      bytes.byteLength > request.value.limitBytes ||
      candidate.endOffset !== request.value.offsetBytes + bytes.byteLength ||
      (candidate.endOffset as number) > (candidate.contentLength as number)
    ) {
      return failure("item reader body byte range is inconsistent");
    }
    body = Object.freeze({
      blobDigest: candidate.blobDigest as string | null,
      bytesBase64: encodeLibraryCoreCanonicalBase64(bytes),
      contentLength: candidate.contentLength as number,
      endOffset: candidate.endOffset as number,
      startOffset: candidate.startOffset as number,
      storage: candidate.storage as LibraryCoreItemReaderBodyStorageV1,
    });
  }
  const response = Object.freeze({
    body,
    queryId: LIBRARY_CORE_ITEM_READER_BODY_QUERY_ID,
    schemaVersion: LIBRARY_CORE_ITEM_READER_BODY_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("item reader body response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
