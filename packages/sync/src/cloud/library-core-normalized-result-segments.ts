import {
  LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_CANONICAL_BYTE_LIMIT,
  LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_RECORD_LIMIT,
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  libraryCoreNormalizedResultSegmentRecordIdentityV2,
  normalizedResultSegmentBodyFromRecordsV2,
  normalizedResultSegmentHeaderFromBodyV2,
  parseLibraryCoreFollowerResultEnvelopeV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedResultSegmentBodyV2,
  parseLibraryCoreNormalizedResultSegmentHeaderV2,
  parseLibraryCoreNormalizedResultSegmentRecordV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreFollowerResultEnvelopeV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedResultSegmentBodyV2,
  type LibraryCoreNormalizedResultSegmentHeaderV2,
} from "@freed/shared/library-core";
import type {
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
} from "./library-core-immutable-publication.js";
import {
  decodeLibraryCoreWireObjectV1,
  encodeLibraryCoreWireObjectV1,
} from "./library-core-wire-object.js";

const WIRE_RECORD_COUNT_LIMIT =
  LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_RECORD_LIMIT + 1;
const WIRE_DECODED_BYTE_LIMIT =
  16 +
  WIRE_RECORD_COUNT_LIMIT * 4 +
  LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES +
  LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_CANONICAL_BYTE_LIMIT;

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

async function sha256(
  bytes: Uint8Array,
  subtle: SubtleCrypto,
): Promise<LibraryCoreLowercaseHex64> {
  const value = await subtle.digest("SHA-256", exactBuffer(bytes));
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("") as LibraryCoreLowercaseHex64;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function resultFromCanonicalBytes(
  bytes: Uint8Array,
): LibraryCoreFollowerResultEnvelopeV1 {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES
  ) {
    throw new RangeError("normalized result record exceeds its byte bound");
  }
  const envelope = parseLibraryCoreFollowerResultEnvelopeV1(
    decodeLibraryCoreCanonicalValue(bytes, {
      maximumBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
    }),
  );
  const restored = encodeLibraryCoreCanonicalValue(
    envelope as unknown as LibraryCoreCanonicalValue,
    { maximumBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES },
  );
  if (!equal(bytes, restored)) {
    throw new TypeError("normalized result record is not exact canonical JSON");
  }
  return envelope;
}

export interface PreparedLibraryCoreNormalizedResultSegmentV2 {
  readonly body: LibraryCoreNormalizedResultSegmentBodyV2;
  readonly header: LibraryCoreNormalizedResultSegmentHeaderV2;
  readonly object: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}

export async function prepareLibraryCoreNormalizedResultSegmentV2(input: {
  readonly actorId: string;
  readonly canonicalResults: readonly Uint8Array[];
  readonly libraryId: string;
  readonly previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly storageEpochId: string;
  readonly subtle: SubtleCrypto;
}): Promise<PreparedLibraryCoreNormalizedResultSegmentV2> {
  if (
    input.canonicalResults.length < 1 ||
    input.canonicalResults.length >
      LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_RECORD_LIMIT
  ) {
    throw new RangeError("normalized result segment record count is invalid");
  }
  const results = input.canonicalResults.map(resultFromCanonicalBytes);
  const canonicalResultBytes = input.canonicalResults.reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  const body = parseLibraryCoreNormalizedResultSegmentBodyV2({
    actor_id: input.actorId,
    canonical_result_bytes: canonicalResultBytes,
    first_result_sequence: results[0]!.result_sequence,
    format: "freed_normalized_result_segment_v2",
    kind: "normalized_result_segment_body",
    last_result_sequence: results.at(-1)!.result_sequence,
    library_id: input.libraryId,
    previous_segment_digest: input.previousSegmentDigest,
    protocol: "normalized_result_segments_v2",
    protocol_version: 2,
    result_count: results.length,
    results,
    storage_epoch_id: input.storageEpochId,
  });
  const segmentDigest = await sha256(
    encodeLibraryCoreDigestInput(
      "normalized-result-segment-body-v2",
      body as unknown as LibraryCoreCanonicalValue,
    ),
    input.subtle,
  );
  const header = normalizedResultSegmentHeaderFromBodyV2(body, segmentDigest);
  const source = await encodeLibraryCoreWireObjectV1(
    [header, ...results] as unknown as readonly LibraryCoreCanonicalValue[],
    {
      kind: "results",
      maximumDecodedBytes: WIRE_DECODED_BYTE_LIMIT,
      maximumRecordBytes:
        LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
      maximumRecords: WIRE_RECORD_COUNT_LIMIT,
      recordIdentity(value) {
        return libraryCoreNormalizedResultSegmentRecordIdentityV2(
          parseLibraryCoreNormalizedResultSegmentRecordV2(value),
        );
      },
    },
  );
  const storedDigest = await sha256(source, input.subtle);
  return Object.freeze({
    body,
    header,
    object: Object.freeze({
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        byteLength: source.byteLength,
        contentDigest: storedDigest,
        objectKey: createLibraryCoreImmutableObjectKey({
          actorId: input.actorId,
          digest: storedDigest,
          epochId: input.storageEpochId,
          firstSequence: header.first_result_sequence,
          kind: "result_segment",
          lastSequence: header.last_result_sequence,
          libraryId: input.libraryId,
        }),
      }),
      source,
    }),
  });
}

export interface LibraryCoreNormalizedResultSegmentImportWriterV2 {
  appendNormalizedResultSegment(input: Readonly<{
    canonicalResults: readonly Uint8Array[];
    header: LibraryCoreNormalizedResultSegmentHeaderV2;
    reference: LibraryCoreImmutableObjectReferenceV1;
    results: readonly LibraryCoreFollowerResultEnvelopeV1[];
  }>): Promise<void>;
}

export async function importLibraryCoreNormalizedResultSegmentV2(input: {
  readonly actorId: string;
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly expectedFirstResultSequence: number;
  readonly expectedPreviousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly libraryId: string;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpochId: string;
  readonly subtle: SubtleCrypto;
  readonly writer: LibraryCoreNormalizedResultSegmentImportWriterV2;
}): Promise<void> {
  const reference = parseLibraryCoreImmutableObjectReferenceV1(input.reference);
  const bytes = await input.adapter.readImmutable(reference);
  if (
    bytes.byteLength !== reference.descriptor.byteLength ||
    (await sha256(bytes, input.subtle)) !== reference.descriptor.contentDigest
  ) {
    throw new Error("normalized result bytes do not match their descriptor");
  }
  const records = await decodeLibraryCoreWireObjectV1(bytes, {
    kind: "results",
    maximumDecodedBytes: WIRE_DECODED_BYTE_LIMIT,
    maximumRecordBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
    maximumRecords: WIRE_RECORD_COUNT_LIMIT,
    recordIdentity(value) {
      return libraryCoreNormalizedResultSegmentRecordIdentityV2(
        parseLibraryCoreNormalizedResultSegmentRecordV2(value),
      );
    },
  });
  const header = parseLibraryCoreNormalizedResultSegmentHeaderV2(records[0]);
  const results = records
    .slice(1)
    .map(parseLibraryCoreFollowerResultEnvelopeV1);
  const body = normalizedResultSegmentBodyFromRecordsV2(header, results);
  const segmentDigest = await sha256(
    encodeLibraryCoreDigestInput(
      "normalized-result-segment-body-v2",
      body as unknown as LibraryCoreCanonicalValue,
    ),
    input.subtle,
  );
  if (
    segmentDigest !== header.segment_digest ||
    header.actor_id !== input.actorId ||
    header.library_id !== input.libraryId ||
    header.storage_epoch_id !== input.storageEpochId ||
    header.first_result_sequence !== input.expectedFirstResultSequence ||
    header.previous_segment_digest !== input.expectedPreviousSegmentDigest
  ) {
    throw new Error("normalized result authority or segment chain changed");
  }
  const canonicalResults = results.map((result) =>
    encodeLibraryCoreCanonicalValue(
      result as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES },
    ),
  );
  await input.writer.appendNormalizedResultSegment({
    canonicalResults: Object.freeze(canonicalResults),
    header,
    reference,
    results: Object.freeze(results),
  });
}
