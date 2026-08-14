import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  isLibraryCoreOperationInstanceId,
  libraryCoreResultSegmentRecordIdentityV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreIntentResultEntryV1,
  parseLibraryCoreResultSegmentBodyV1,
  parseLibraryCoreResultSegmentHeaderV1,
  parseLibraryCoreResultSegmentRecordV1,
  resultSegmentBodyFromRecordsV1,
  resultSegmentHeaderFromBodyV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreIntentResultEntryV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreResultSegmentBodyV1,
  type LibraryCoreResultSegmentHeaderV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
} from "./library-core-immutable-publication.js";
import {
  decodeLibraryCoreWireObjectV1,
  encodeLibraryCoreWireObjectV1,
} from "./library-core-wire-object.js";

const MAX_DECODED_BYTES = 5_000_000;
const MAX_RECORD_BYTES = 1_048_576;
const MAX_RECORDS = 1_001;

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

async function sha256(bytes: Uint8Array, subtle: SubtleCrypto): Promise<LibraryCoreLowercaseHex64> {
  const digest = await subtle.digest("SHA-256", exactBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") as LibraryCoreLowercaseHex64;
}

export interface LibraryCoreResultOutboxEntryV1 {
  readonly actorId: string;
  readonly intentOperationId: string;
  readonly intentSequence: number;
  readonly providerReceiptDigest: string | null;
  readonly resultOperationId: string;
  readonly resultSequence: number;
  readonly status: "accepted" | "provider_completed" | "provider_failed";
}

export async function prepareLibraryCoreResultSegmentV1(input: {
  readonly actorId: string;
  readonly entries: readonly LibraryCoreResultOutboxEntryV1[];
  readonly epochId: string;
  readonly libraryId: string;
  readonly previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly subtle: SubtleCrypto;
}): Promise<Readonly<{
  body: LibraryCoreResultSegmentBodyV1;
  header: LibraryCoreResultSegmentHeaderV1;
  object: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}>> {
  if (input.entries.length < 1 || input.entries.length > 1_000) {
    throw new RangeError("result segment requires 1 through 1,000 entries");
  }
  const entries = input.entries.map((entry) => parseLibraryCoreIntentResultEntryV1({
    actor_id: entry.actorId,
    intent_operation_id: entry.intentOperationId,
    intent_sequence: entry.intentSequence,
    kind: "result_segment_entry",
    provider_receipt_digest: entry.providerReceiptDigest,
    result_operation_id: entry.resultOperationId,
    result_sequence: entry.resultSequence,
    status: entry.status,
  }));
  if (!isLibraryCoreOperationInstanceId(input.actorId)) throw new TypeError("result actorId is invalid");
  const canonicalEntryBytes = entries.reduce((total, entry) => total + encodeLibraryCoreCanonicalValue(entry as unknown as LibraryCoreCanonicalValue).byteLength, 0);
  const body = parseLibraryCoreResultSegmentBodyV1({
    actor_id: input.actorId,
    canonical_entry_bytes: canonicalEntryBytes,
    entries,
    epoch_id: input.epochId,
    first_result_sequence: entries[0]!.result_sequence,
    format: "freed_result_segment_v1",
    kind: "result_segment_body",
    last_result_sequence: entries.at(-1)!.result_sequence,
    library_id: input.libraryId,
    previous_segment_digest: input.previousSegmentDigest,
    protocol: "result_segments_v1",
    protocol_version: 1,
    result_count: entries.length,
    schema_version: 1,
  });
  const bodyDigest = await sha256(encodeLibraryCoreDigestInput("result-segment-body", body as unknown as LibraryCoreCanonicalValue), input.subtle);
  const header = resultSegmentHeaderFromBodyV1(body, bodyDigest);
  const source = await encodeLibraryCoreWireObjectV1([header, ...entries] as unknown as readonly LibraryCoreCanonicalValue[], {
    kind: "results",
    maximumDecodedBytes: MAX_DECODED_BYTES,
    maximumRecordBytes: MAX_RECORD_BYTES,
    maximumRecords: MAX_RECORDS,
    recordIdentity(value) {
      return libraryCoreResultSegmentRecordIdentityV1(parseLibraryCoreResultSegmentRecordV1(value));
    },
  });
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
          epochId: input.epochId,
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

export async function importLibraryCoreResultSegmentV1(input: {
  readonly actorId: string;
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly expectedFirstResultSequence: number;
  readonly expectedPreviousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly libraryId: string;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly writer: Readonly<{
    appendResultSegment(args: Readonly<{
      entries: readonly LibraryCoreIntentResultEntryV1[];
      header: LibraryCoreResultSegmentHeaderV1;
      reference: LibraryCoreImmutableObjectReferenceV1;
    }>): Promise<void>;
  }>;
}): Promise<void> {
  const reference = parseLibraryCoreImmutableObjectReferenceV1(input.reference);
  const bytes = await input.adapter.readImmutable(reference);
  if (bytes.byteLength !== reference.descriptor.byteLength || await sha256(bytes, input.subtle) !== reference.descriptor.contentDigest) {
    throw new Error("result segment bytes do not match their descriptor");
  }
  const records = await decodeLibraryCoreWireObjectV1(bytes, {
    kind: "results",
    maximumDecodedBytes: MAX_DECODED_BYTES,
    maximumRecordBytes: MAX_RECORD_BYTES,
    maximumRecords: MAX_RECORDS,
    recordIdentity(value) {
      return libraryCoreResultSegmentRecordIdentityV1(parseLibraryCoreResultSegmentRecordV1(value));
    },
  });
  const header = parseLibraryCoreResultSegmentHeaderV1(records[0]);
  const entries = records.slice(1).map(parseLibraryCoreIntentResultEntryV1);
  const body = resultSegmentBodyFromRecordsV1(header, entries);
  const digest = await sha256(encodeLibraryCoreDigestInput("result-segment-body", body as unknown as LibraryCoreCanonicalValue), input.subtle);
  if (
    digest !== header.segment_digest || header.actor_id !== input.actorId ||
    header.library_id !== input.libraryId || header.epoch_id !== input.storageEpoch ||
    header.first_result_sequence !== input.expectedFirstResultSequence ||
    header.previous_segment_digest !== input.expectedPreviousSegmentDigest
  ) {
    throw new Error("result segment authority or chain does not match the expected head");
  }
  await input.writer.appendResultSegment({ entries, header, reference });
}
