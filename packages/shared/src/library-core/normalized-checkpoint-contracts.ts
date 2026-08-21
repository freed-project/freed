import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  decodeLibraryCoreCanonicalBase64,
  encodeLibraryCoreCanonicalBase64,
} from "./canonical-base64.js";
import {
  createLibraryCoreMediaBlobDigestStateV1,
  digestLibraryCoreMediaBlobBytesV1,
} from "./media-blob-transport-contracts.js";
import {
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY,
  LIBRARY_CORE_CHECKPOINT_FRACTIONAL_FIELDS,
  LIBRARY_CORE_CONTENT_CHUNK_BYTES,
  LIBRARY_CORE_NORMALIZED_CHECKPOINT_FORMAT,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  type LibraryCoreCheckpointRegistryKey,
} from "./sqlite-contract.generated.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import { LibraryCoreSha256 } from "./sha256.js";

export type LibraryCoreNormalizedCheckpointPrimaryKeyV2 =
  | string
  | readonly [string, number]
  | readonly [string, string]
  | readonly [string, string, string]
  | readonly [string, string, string, string]
  | readonly [string, string, string, string, string];

export interface LibraryCoreNormalizedCheckpointRecordV2 {
  readonly format: typeof LIBRARY_CORE_NORMALIZED_CHECKPOINT_FORMAT;
  readonly protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
  readonly registryKey: LibraryCoreCheckpointRegistryKey;
  readonly primaryKey: LibraryCoreNormalizedCheckpointPrimaryKeyV2;
  readonly payload: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface LibraryCoreContentDescriptorPayloadV1 {
  readonly blobContentDigest: LibraryCoreLowercaseHex64;
  readonly byteLength: number;
  readonly chunkBytes: typeof LIBRARY_CORE_CONTENT_CHUNK_BYTES;
  readonly chunkCount: number;
  readonly mediaType: string;
}

export interface LibraryCoreContentChunkPayloadV1 {
  readonly blobContentDigest: LibraryCoreLowercaseHex64;
  readonly byteLength: number;
  readonly bytesBase64: string;
  readonly chunkContentDigest: LibraryCoreLowercaseHex64;
  readonly chunkIndex: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const binary64Buffer = new ArrayBuffer(8);
const binary64View = new DataView(binary64Buffer);
const checkpointDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-records/normalized-checkpoint\u0000",
  (character) => character.charCodeAt(0),
);

function encodeBinary64(value: number): Readonly<Record<string, string>> {
  if (!Number.isFinite(value)) {
    throw new TypeError("checkpoint fractional value must be finite");
  }
  binary64View.setFloat64(0, value, false);
  return Object.freeze({
    bits: `${binary64View.getUint32(0, false).toString(16).padStart(8, "0")}${binary64View.getUint32(4, false).toString(16).padStart(8, "0")}`,
    codec: "ieee754_binary64_hex_v1",
  });
}

function decodeBinary64(value: unknown): number {
  const wrapper = ownClosedRecord(
    value,
    ["bits", "codec"],
    "checkpoint fractional wrapper",
  );
  if (
    wrapper.codec !== "ieee754_binary64_hex_v1" ||
    typeof wrapper.bits !== "string" ||
    !/^[0-9a-f]{16}$/.test(wrapper.bits)
  ) {
    throw new TypeError("checkpoint fractional wrapper identity is invalid");
  }
  binary64View.setUint32(
    0,
    Number.parseInt(wrapper.bits.slice(0, 8), 16),
    false,
  );
  binary64View.setUint32(4, Number.parseInt(wrapper.bits.slice(8), 16), false);
  const decoded = binary64View.getFloat64(0, false);
  if (!Number.isFinite(decoded)) {
    throw new TypeError("checkpoint fractional wrapper must be finite");
  }
  return decoded;
}

function encodeFractionalPayload(
  registryKey: LibraryCoreCheckpointRegistryKey,
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const fields =
    (
      LIBRARY_CORE_CHECKPOINT_FRACTIONAL_FIELDS as Partial<
        Record<LibraryCoreCheckpointRegistryKey, readonly string[]>
      >
    )[registryKey] ?? [];
  if (fields.length === 0) return payload;
  const output = { ...payload };
  for (const field of fields) {
    const value = output[field];
    if (value === null || value === undefined || Number.isSafeInteger(value))
      continue;
    if (typeof value === "number") {
      output[field] = encodeBinary64(value);
    } else {
      decodeBinary64(value);
    }
  }
  return output;
}
function ownClosedRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a plain closed record`);
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  return value as Record<string, unknown>;
}

function canonicalPayload(
  value: unknown,
  expectedFields: readonly string[],
): Readonly<Record<string, LibraryCoreCanonicalValue>> {
  const closed = ownClosedRecord(
    value,
    expectedFields,
    "normalized checkpoint payload",
  );
  return decodeLibraryCoreCanonicalValue(
    encodeLibraryCoreCanonicalValue(closed as LibraryCoreCanonicalValue, {
      maximumBytes: LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
    }),
  ) as Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

function registryEntry(registryKey: string) {
  const entry = LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY.find(
    (candidate) => candidate.registryKey === registryKey,
  );
  if (entry === undefined || registryKey.includes("shell")) {
    throw new TypeError("normalized checkpoint registry key is unsupported");
  }
  return entry;
}

function boundedPrimaryKey(
  value: unknown,
  codec: (typeof LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY)[number]["primaryKey"],
): LibraryCoreNormalizedCheckpointPrimaryKeyV2 {
  const snapshot = decodeLibraryCoreCanonicalValue(
    encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue, {
      maximumBytes: 4_096,
    }),
  );
  if (codec === "singleton" && snapshot === "checkpoint") return snapshot;
  if (codec === "text" && typeof snapshot === "string" && snapshot.length > 0) {
    return snapshot;
  }
  if (codec === "digest" && isLibraryCoreLowercaseHex64(snapshot)) {
    return snapshot;
  }
  if (
    Array.isArray(snapshot) &&
    snapshot.length >= 2 &&
    snapshot.length <= 5 &&
    snapshot.every(
      (part) =>
        (typeof part === "string" && part.length > 0) ||
        isLibraryCoreNonnegativeSafeInteger(part),
    )
  ) {
    const valid =
      (codec === "chunk" &&
        snapshot.length === 2 &&
        isLibraryCoreLowercaseHex64(snapshot[0]) &&
        isLibraryCoreNonnegativeSafeInteger(snapshot[1])) ||
      (codec === "ordinal" &&
        snapshot.length === 2 &&
        typeof snapshot[0] === "string" &&
        isLibraryCoreNonnegativeSafeInteger(snapshot[1])) ||
      (codec === "pair" &&
        snapshot.length === 2 &&
        snapshot.every((part) => typeof part === "string")) ||
      (codec === "entity" &&
        snapshot.length === 2 &&
        snapshot.every((part) => typeof part === "string")) ||
      (codec === "receipt" &&
        snapshot.length === 2 &&
        snapshot.every((part) => typeof part === "string")) ||
      (codec === "field" &&
        snapshot.length === 3 &&
        snapshot.every((part) => typeof part === "string")) ||
      (codec === "relationship" &&
        snapshot.length === 5 &&
        snapshot.every((part) => typeof part === "string"));
    if (valid) {
      return snapshot as unknown as LibraryCoreNormalizedCheckpointPrimaryKeyV2;
    }
  }
  throw new TypeError("normalized checkpoint primary key is invalid");
}

export function createLibraryCoreNormalizedCheckpointRecordV2(input: {
  readonly registryKey: LibraryCoreCheckpointRegistryKey;
  readonly primaryKey: LibraryCoreNormalizedCheckpointPrimaryKeyV2;
  readonly payload: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}): LibraryCoreNormalizedCheckpointRecordV2 {
  const entry = registryEntry(input.registryKey);
  const record = Object.freeze({
    format: LIBRARY_CORE_NORMALIZED_CHECKPOINT_FORMAT,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    registryKey: input.registryKey,
    primaryKey: boundedPrimaryKey(input.primaryKey, entry.primaryKey),
    payload: canonicalPayload(
      encodeFractionalPayload(input.registryKey, input.payload),
      entry.fields,
    ),
  });
  encodeLibraryCoreCanonicalValue(record, {
    maximumBytes: LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  });
  return record;
}

export function parseLibraryCoreNormalizedCheckpointRecordV2(
  value: unknown,
): LibraryCoreNormalizedCheckpointRecordV2 {
  const record = ownClosedRecord(
    value,
    ["format", "payload", "primaryKey", "protocolVersion", "registryKey"],
    "normalized checkpoint record",
  );
  if (
    record.format !== LIBRARY_CORE_NORMALIZED_CHECKPOINT_FORMAT ||
    record.protocolVersion !== LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
    typeof record.registryKey !== "string"
  ) {
    throw new TypeError("normalized checkpoint version identity is invalid");
  }
  return createLibraryCoreNormalizedCheckpointRecordV2({
    registryKey: registryEntry(record.registryKey).registryKey,
    primaryKey:
      record.primaryKey as LibraryCoreNormalizedCheckpointPrimaryKeyV2,
    payload: record.payload as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >,
  });
}

export function encodeLibraryCoreNormalizedCheckpointRecordV2(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): Uint8Array {
  return Uint8Array.from(
    encodeLibraryCoreCanonicalValue(
      parseLibraryCoreNormalizedCheckpointRecordV2(
        record,
      ) as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES },
    ),
  );
}

export function libraryCoreNormalizedCheckpointSqlitePayloadV2(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): Readonly<Record<string, LibraryCoreCanonicalValue>> {
  const parsed = parseLibraryCoreNormalizedCheckpointRecordV2(record);
  const payload = { ...parsed.payload };
  const fields =
    (
      LIBRARY_CORE_CHECKPOINT_FRACTIONAL_FIELDS as Partial<
        Record<LibraryCoreCheckpointRegistryKey, readonly string[]>
      >
    )[parsed.registryKey] ?? [];
  for (const field of fields) {
    const value = payload[field];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      payload[field] = decodeBinary64(value);
    }
  }
  return Object.freeze(payload);
}

export function decodeLibraryCoreContentChunkBytesV1(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): Uint8Array {
  const parsed = parseLibraryCoreNormalizedCheckpointRecordV2(record);
  if (parsed.registryKey !== "b1_content_chunk") {
    throw new TypeError("normalized checkpoint record is not a content chunk");
  }
  const bytesBase64 = parsed.payload.bytesBase64;
  const byteLength = parsed.payload.byteLength;
  const chunkContentDigest = parsed.payload.chunkContentDigest;
  if (
    typeof bytesBase64 !== "string" ||
    !isLibraryCoreNonnegativeSafeInteger(byteLength) ||
    !isLibraryCoreLowercaseHex64(chunkContentDigest)
  ) {
    throw new TypeError("content chunk payload is invalid");
  }
  const bytes = decodeLibraryCoreCanonicalBase64(bytesBase64);
  if (
    bytes.byteLength !== byteLength ||
    digestLibraryCoreMediaBlobBytesV1(bytes) !== chunkContentDigest
  ) {
    throw new TypeError("content chunk bytes do not match their descriptor");
  }
  return bytes;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function canonicalLengthBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(length), false);
  return bytes;
}

export function digestLibraryCoreNormalizedCheckpointRecordsV2(
  records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
): LibraryCoreLowercaseHex64 {
  const encoded = records.map((record) => {
    const parsed = parseLibraryCoreNormalizedCheckpointRecordV2(record);
    return {
      canonical: encodeLibraryCoreNormalizedCheckpointRecordV2(parsed),
      primaryKey: encodeLibraryCoreCanonicalValue(parsed.primaryKey, {
        maximumBytes: 4_096,
      }),
      registryKey: parsed.registryKey,
    };
  });
  encoded.sort((left, right) =>
    left.registryKey === right.registryKey
      ? compareBytes(left.primaryKey, right.primaryKey)
      : left.registryKey < right.registryKey
        ? -1
        : 1,
  );
  for (let index = 1; index < encoded.length; index += 1) {
    const previous = encoded[index - 1]!;
    const current = encoded[index]!;
    if (
      previous.registryKey === current.registryKey &&
      compareBytes(previous.primaryKey, current.primaryKey) === 0
    ) {
      throw new TypeError("checkpoint record identity is duplicated");
    }
  }
  const digest = new LibraryCoreSha256().update(checkpointDigestPrefix);
  for (const record of encoded) {
    digest.update(canonicalLengthBytes(record.canonical.byteLength));
    digest.update(record.canonical);
  }
  return digest.digestLowerHex();
}

export function libraryCoreNormalizedCheckpointRecordIdentityV2(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): string {
  const parsed = parseLibraryCoreNormalizedCheckpointRecordV2(record);
  return `${parsed.registryKey}:${textDecoder.decode(
    encodeLibraryCoreCanonicalValue(parsed.primaryKey),
  )}`;
}

export function splitLibraryCoreContentV1(input: {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}): readonly LibraryCoreNormalizedCheckpointRecordV2[] {
  if (!(input.bytes instanceof Uint8Array)) {
    throw new TypeError("content bytes must be a Uint8Array");
  }
  if (
    input.mediaType.length === 0 ||
    textEncoder.encode(input.mediaType).byteLength > 255
  ) {
    throw new TypeError("content mediaType must be bounded nonempty text");
  }
  const digest = digestLibraryCoreMediaBlobBytesV1(input.bytes);
  const chunkCount = Math.ceil(
    input.bytes.byteLength / LIBRARY_CORE_CONTENT_CHUNK_BYTES,
  );
  const records: LibraryCoreNormalizedCheckpointRecordV2[] = [
    createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "b0_blob_descriptor",
      primaryKey: digest,
      payload: {
        blobContentDigest: digest,
        byteLength: input.bytes.byteLength,
        chunkBytes: LIBRARY_CORE_CONTENT_CHUNK_BYTES,
        chunkCount,
        mediaType: input.mediaType,
      },
    }),
  ];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunk = input.bytes.slice(
      chunkIndex * LIBRARY_CORE_CONTENT_CHUNK_BYTES,
      (chunkIndex + 1) * LIBRARY_CORE_CONTENT_CHUNK_BYTES,
    );
    records.push(
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "b1_content_chunk",
        primaryKey: [digest, chunkIndex],
        payload: {
          blobContentDigest: digest,
          byteLength: chunk.byteLength,
          bytesBase64: encodeLibraryCoreCanonicalBase64(chunk),
          chunkContentDigest: digestLibraryCoreMediaBlobBytesV1(chunk),
          chunkIndex,
        },
      }),
    );
  }
  return Object.freeze(records);
}

export function reassembleLibraryCoreContentV1(
  records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
): Uint8Array {
  const parsed = records.map(parseLibraryCoreNormalizedCheckpointRecordV2);
  const descriptorRecord = parsed.find(
    (record) => record.registryKey === "b0_blob_descriptor",
  );
  if (descriptorRecord === undefined) {
    throw new TypeError("content descriptor record is missing");
  }
  const descriptor = ownClosedRecord(
    descriptorRecord.payload,
    [
      "blobContentDigest",
      "byteLength",
      "chunkBytes",
      "chunkCount",
      "mediaType",
    ],
    "content descriptor",
  );
  if (
    !isLibraryCoreLowercaseHex64(descriptor.blobContentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(descriptor.byteLength) ||
    descriptor.chunkBytes !== LIBRARY_CORE_CONTENT_CHUNK_BYTES ||
    !isLibraryCoreNonnegativeSafeInteger(descriptor.chunkCount)
  ) {
    throw new TypeError("content descriptor is invalid");
  }
  const chunks = parsed
    .filter((record) => record.registryKey === "b1_content_chunk")
    .sort((left, right) => {
      const leftIndex = left.primaryKey[1];
      const rightIndex = right.primaryKey[1];
      return Number(leftIndex) - Number(rightIndex);
    });
  if (chunks.length !== descriptor.chunkCount) {
    throw new TypeError("content chunk set is incomplete");
  }
  const output = new Uint8Array(descriptor.byteLength);
  const wholeDigest = createLibraryCoreMediaBlobDigestStateV1();
  let offset = 0;
  chunks.forEach((record, chunkIndex) => {
    const payload = ownClosedRecord(
      record.payload,
      [
        "blobContentDigest",
        "byteLength",
        "bytesBase64",
        "chunkContentDigest",
        "chunkIndex",
      ],
      "content chunk",
    );
    if (
      payload.blobContentDigest !== descriptor.blobContentDigest ||
      payload.chunkIndex !== chunkIndex ||
      !isLibraryCoreLowercaseHex64(payload.chunkContentDigest) ||
      typeof payload.bytesBase64 !== "string"
    ) {
      throw new TypeError("content chunk identity is invalid");
    }
    const bytes = decodeLibraryCoreCanonicalBase64(payload.bytesBase64);
    if (
      bytes.byteLength !== payload.byteLength ||
      digestLibraryCoreMediaBlobBytesV1(bytes) !== payload.chunkContentDigest ||
      offset + bytes.byteLength > output.byteLength
    ) {
      throw new TypeError("content chunk bytes are invalid");
    }
    output.set(bytes, offset);
    wholeDigest.update(bytes);
    offset += bytes.byteLength;
  });
  if (
    offset !== output.byteLength ||
    wholeDigest.digestLowerHex() !== descriptor.blobContentDigest
  ) {
    throw new TypeError("reassembled content digest is invalid");
  }
  return output;
}
