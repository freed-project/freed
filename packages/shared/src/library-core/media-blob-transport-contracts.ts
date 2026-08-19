import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import { LibraryCoreSha256 } from "./sha256.js";

const ID = "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}";
const DIGEST = "[0-9a-f]{64}";
const MEDIA_BLOB_OBJECT_KEY_PATTERN = new RegExp(
  `^freed-v2-blob~${ID}~${DIGEST}$`,
);
const textEncoder = new TextEncoder();
const blobContentDigestPrefix = textEncoder.encode(
  "freed.library-core.v1/digest-bytes/blob-content\u0000",
);

export const LIBRARY_CORE_MEDIA_BLOB_BYTE_LIMIT = 67_108_864_000_000;

/**
 * A media blob is not an ordinary immutable wire object.
 *
 * Its digest is domain-separated over raw bytes, and an empty byte stream is
 * valid. Keeping a distinct descriptor prevents callers from accidentally
 * treating a blob digest as the ordinary stored-byte SHA-256 contract.
 */
export interface LibraryCoreMediaBlobDescriptorV1 {
  readonly objectKey: string;
  readonly blobContentDigest: LibraryCoreLowercaseHex64;
  readonly byteLength: number;
}

export interface LibraryCoreMediaBlobReferenceV1 {
  readonly descriptor: LibraryCoreMediaBlobDescriptorV1;
  readonly transportObjectId: string;
}

function ownEnumerableDataRecord(
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
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        `${label}.${key} must be an enumerable data property`,
      );
    }
  }
  return value as Record<string, unknown>;
}

export function createLibraryCoreMediaBlobObjectKey(input: {
  readonly libraryId: string;
  readonly blobContentDigest: string;
}): string {
  if (!isLibraryCoreOperationInstanceId(input.libraryId)) {
    throw new TypeError("libraryId must be a bounded Library Core identifier");
  }
  if (!isLibraryCoreLowercaseHex64(input.blobContentDigest)) {
    throw new TypeError(
      "blobContentDigest must be a lowercase SHA-256 digest",
    );
  }
  return `freed-v2-blob~${input.libraryId}~${input.blobContentDigest}`;
}

export function isLibraryCoreMediaBlobObjectKey(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    !value.includes("/") &&
    !value.includes("..") &&
    !value.includes(".sqlite") &&
    !value.includes(".wal") &&
    !value.includes(".shm") &&
    !value.includes(".journal") &&
    MEDIA_BLOB_OBJECT_KEY_PATTERN.test(value)
  );
}

export function parseLibraryCoreMediaBlobDescriptorV1(
  value: unknown,
): LibraryCoreMediaBlobDescriptorV1 {
  const record = ownEnumerableDataRecord(
    value,
    ["objectKey", "blobContentDigest", "byteLength"],
    "media blob descriptor",
  );
  if (!isLibraryCoreMediaBlobObjectKey(record.objectKey)) {
    throw new TypeError("media blob descriptor has an invalid objectKey");
  }
  if (!isLibraryCoreLowercaseHex64(record.blobContentDigest)) {
    throw new TypeError(
      "media blob descriptor blobContentDigest must be a lowercase SHA-256 digest",
    );
  }
  if (
    !isLibraryCoreNonnegativeSafeInteger(record.byteLength) ||
    record.byteLength > LIBRARY_CORE_MEDIA_BLOB_BYTE_LIMIT
  ) {
    throw new TypeError(
      `media blob descriptor byteLength must be a nonnegative safe integer no greater than ${LIBRARY_CORE_MEDIA_BLOB_BYTE_LIMIT.toLocaleString()}`,
    );
  }
  const embeddedDigest = record.objectKey.slice(
    record.objectKey.lastIndexOf("~") + 1,
  );
  if (embeddedDigest !== record.blobContentDigest) {
    throw new TypeError(
      "media blob descriptor blobContentDigest does not match objectKey",
    );
  }
  return Object.freeze({
    objectKey: record.objectKey,
    blobContentDigest: record.blobContentDigest,
    byteLength: record.byteLength,
  });
}

export function parseLibraryCoreMediaBlobReferenceV1(
  value: unknown,
): LibraryCoreMediaBlobReferenceV1 {
  const record = ownEnumerableDataRecord(
    value,
    ["descriptor", "transportObjectId"],
    "media blob reference",
  );
  if (
    typeof record.transportObjectId !== "string" ||
    record.transportObjectId.length === 0 ||
    textEncoder.encode(record.transportObjectId).byteLength > 1_024
  ) {
    throw new TypeError(
      "media blob reference transportObjectId must be bounded nonempty text",
    );
  }
  return Object.freeze({
    descriptor: parseLibraryCoreMediaBlobDescriptorV1(record.descriptor),
    transportObjectId: record.transportObjectId,
  });
}

/** Create an incremental DB("blob-content", raw_bytes) digest state. */
export function createLibraryCoreMediaBlobDigestStateV1(): LibraryCoreSha256 {
  return new LibraryCoreSha256().update(blobContentDigestPrefix);
}

/** Compute DB("blob-content", raw_bytes) for one already-bounded byte array. */
export function digestLibraryCoreMediaBlobBytesV1(
  bytes: Uint8Array,
): LibraryCoreLowercaseHex64 {
  return createLibraryCoreMediaBlobDigestStateV1()
    .update(bytes)
    .digestLowerHex();
}
