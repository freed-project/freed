import {
  LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
  LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT,
  LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_RECORD_LIMIT,
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  libraryCoreNormalizedIntentSegmentRecordIdentityV2,
  normalizedIntentSegmentBodyFromRecordsV2,
  normalizedIntentSegmentHeaderFromBodyV2,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedIntentEnvelopeRecordV2,
  parseLibraryCoreNormalizedIntentSegmentBodyV2,
  parseLibraryCoreNormalizedIntentSegmentHeaderV2,
  parseLibraryCoreNormalizedIntentSegmentRecordV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedIntentEnvelopeRecordV2,
  type LibraryCoreNormalizedIntentSegmentBodyV2,
  type LibraryCoreNormalizedIntentSegmentHeaderV2,
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
  LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_RECORD_LIMIT + 1;
const WIRE_DECODED_BYTE_LIMIT =
  16 +
  WIRE_RECORD_COUNT_LIMIT * 4 +
  LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES +
  LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT;

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

function envelopeFromCanonicalBytes(
  bytes: Uint8Array,
): LibraryCoreNormalizedIntentEnvelopeRecordV2 {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES
  ) {
    throw new RangeError("normalized intent record exceeds its byte bound");
  }
  const envelope = parseLibraryCoreNormalizedIntentEnvelopeRecordV2(
    decodeLibraryCoreCanonicalValue(bytes, {
      maximumBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
    }),
  );
  const restored = encodeLibraryCoreCanonicalValue(
    envelope as LibraryCoreCanonicalValue,
    { maximumBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES },
  );
  if (!equal(bytes, restored)) {
    throw new TypeError("normalized intent record is not exact canonical JSON");
  }
  return envelope;
}

export interface PreparedLibraryCoreNormalizedIntentSegmentV2 {
  readonly body: LibraryCoreNormalizedIntentSegmentBodyV2;
  readonly header: LibraryCoreNormalizedIntentSegmentHeaderV2;
  readonly object: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}

export async function prepareLibraryCoreNormalizedIntentSegmentV2(input: {
  readonly actorId: string;
  readonly canonicalEnvelopes: readonly Uint8Array[];
  readonly libraryId: string;
  readonly previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly storageEpochId: string;
  readonly subtle: SubtleCrypto;
}): Promise<PreparedLibraryCoreNormalizedIntentSegmentV2> {
  if (
    input.canonicalEnvelopes.length < 1 ||
    input.canonicalEnvelopes.length >
      LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_RECORD_LIMIT
  ) {
    throw new RangeError("normalized intent segment record count is invalid");
  }
  const envelopes = input.canonicalEnvelopes.map(envelopeFromCanonicalBytes);
  const canonicalEnvelopeBytes = input.canonicalEnvelopes.reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  const body = parseLibraryCoreNormalizedIntentSegmentBodyV2({
    actor_id: input.actorId,
    canonical_envelope_bytes: canonicalEnvelopeBytes,
    envelopes,
    first_actor_counter: envelopes[0]!.actor_sequence,
    format: "freed_normalized_intent_segment_v2",
    kind: "normalized_intent_segment_body",
    last_actor_counter: envelopes.at(-1)!.actor_sequence,
    library_id: input.libraryId,
    previous_segment_digest: input.previousSegmentDigest,
    protocol: "normalized_intent_segments_v2",
    protocol_version: 2,
    record_count: envelopes.length,
    storage_epoch_id: input.storageEpochId,
  });
  const segmentDigest = await sha256(
    encodeLibraryCoreDigestInput(
      "normalized-intent-segment-body-v2",
      body as unknown as LibraryCoreCanonicalValue,
    ),
    input.subtle,
  );
  const header = normalizedIntentSegmentHeaderFromBodyV2(body, segmentDigest);
  const source = await encodeLibraryCoreWireObjectV1(
    [header, ...envelopes] as unknown as readonly LibraryCoreCanonicalValue[],
    {
      kind: "intents",
      maximumDecodedBytes: WIRE_DECODED_BYTE_LIMIT,
      maximumRecordBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
      maximumRecords: WIRE_RECORD_COUNT_LIMIT,
      recordIdentity(value) {
        return libraryCoreNormalizedIntentSegmentRecordIdentityV2(
          parseLibraryCoreNormalizedIntentSegmentRecordV2(value),
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
          firstSequence: header.first_actor_counter,
          kind: "intent_segment",
          lastSequence: header.last_actor_counter,
          libraryId: input.libraryId,
        }),
      }),
      source,
    }),
  });
}

export interface LibraryCoreNormalizedIntentSegmentImportWriterV2 {
  stageNormalizedIntentSegment(input: Readonly<{
    canonicalEnvelopes: readonly Uint8Array[];
    envelopes: readonly LibraryCoreNormalizedIntentEnvelopeRecordV2[];
    header: LibraryCoreNormalizedIntentSegmentHeaderV2;
    reference: LibraryCoreImmutableObjectReferenceV1;
  }>): Promise<void>;
}

export async function importLibraryCoreNormalizedIntentSegmentV2(input: {
  readonly actorId: string;
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly expectedFirstActorCounter: number;
  readonly expectedPreviousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly libraryId: string;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpochId: string;
  readonly subtle: SubtleCrypto;
  readonly writer: LibraryCoreNormalizedIntentSegmentImportWriterV2;
}): Promise<void> {
  const reference = parseLibraryCoreImmutableObjectReferenceV1(input.reference);
  const bytes = await input.adapter.readImmutable(reference);
  if (
    bytes.byteLength !== reference.descriptor.byteLength ||
    (await sha256(bytes, input.subtle)) !== reference.descriptor.contentDigest
  ) {
    throw new Error("normalized intent bytes do not match their descriptor");
  }
  const records = await decodeLibraryCoreWireObjectV1(bytes, {
    kind: "intents",
    maximumDecodedBytes: WIRE_DECODED_BYTE_LIMIT,
    maximumRecordBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
    maximumRecords: WIRE_RECORD_COUNT_LIMIT,
    recordIdentity(value) {
      return libraryCoreNormalizedIntentSegmentRecordIdentityV2(
        parseLibraryCoreNormalizedIntentSegmentRecordV2(value),
      );
    },
  });
  const header = parseLibraryCoreNormalizedIntentSegmentHeaderV2(records[0]);
  const envelopes = records
    .slice(1)
    .map(parseLibraryCoreNormalizedIntentEnvelopeRecordV2);
  const body = normalizedIntentSegmentBodyFromRecordsV2(header, envelopes);
  const segmentDigest = await sha256(
    encodeLibraryCoreDigestInput(
      "normalized-intent-segment-body-v2",
      body as unknown as LibraryCoreCanonicalValue,
    ),
    input.subtle,
  );
  if (
    segmentDigest !== header.segment_digest ||
    header.actor_id !== input.actorId ||
    header.library_id !== input.libraryId ||
    header.storage_epoch_id !== input.storageEpochId ||
    header.first_actor_counter !== input.expectedFirstActorCounter ||
    header.previous_segment_digest !== input.expectedPreviousSegmentDigest
  ) {
    throw new Error("normalized intent authority or segment chain changed");
  }
  const canonicalEnvelopes = envelopes.map((envelope) =>
    encodeLibraryCoreCanonicalValue(envelope as LibraryCoreCanonicalValue, {
      maximumBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
    }),
  );
  await input.writer.stageNormalizedIntentSegment({
    canonicalEnvelopes: Object.freeze(canonicalEnvelopes),
    envelopes: Object.freeze(envelopes),
    header,
    reference,
  });
}
