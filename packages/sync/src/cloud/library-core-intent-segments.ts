import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  intentSegmentBodyFromRecordsV1,
  intentSegmentHeaderFromBodyV1,
  isLibraryCoreOperationInstanceId,
  LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT,
  LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT,
  libraryCoreIntentSegmentRecordIdentityV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreIntentSegmentBodyV1,
  parseLibraryCoreIntentSegmentEntryV1,
  parseLibraryCoreIntentSegmentHeaderV1,
  parseLibraryCoreIntentSegmentRecordV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreIntentSegmentBodyV1,
  type LibraryCoreIntentSegmentEntryV1,
  type LibraryCoreIntentSegmentHeaderV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import type {
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
} from "./library-core-immutable-publication.js";
import {
  decodeLibraryCoreWireObjectV1,
  encodeLibraryCoreWireObjectV1,
} from "./library-core-wire-object.js";

const textEncoder = new TextEncoder();
const INTENT_SEGMENT_DECODED_BYTE_LIMIT = 5_000_000;
const INTENT_SEGMENT_RECORD_BYTE_LIMIT = 1_048_576;
const INTENT_SEGMENT_RECORD_LIMIT = 1_001;

export interface LibraryCoreIntentOutboxEntryV1 {
  readonly canonicalEnvelopeJson: string;
  readonly intentSequence: number;
  readonly operationId: string;
}

export interface PrepareLibraryCoreIntentSegmentRequestV1 {
  readonly actorId: string;
  readonly entries: readonly LibraryCoreIntentOutboxEntryV1[];
  readonly epochId: string;
  readonly libraryId: string;
  readonly previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly schemaVersion: number;
  readonly subtle: SubtleCrypto;
}

export interface PreparedLibraryCoreIntentSegmentV1 {
  readonly body: LibraryCoreIntentSegmentBodyV1;
  readonly header: LibraryCoreIntentSegmentHeaderV1;
  readonly object: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}

export interface LibraryCoreIntentSegmentImportReceiptV1 {
  readonly actorId: string;
  readonly firstIntentSequence: number;
  readonly importedOperationCount: number;
  readonly lastIntentSequence: number;
  readonly segmentDigest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreIntentSegmentImportWriterV1 {
  appendIntentSegment(input: {
    readonly entries: readonly LibraryCoreIntentSegmentEntryV1[];
    readonly header: LibraryCoreIntentSegmentHeaderV1;
    readonly reference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCoreIntentSegmentImportReceiptV1>;
}

export interface ImportLibraryCoreIntentSegmentRequestV1 {
  readonly actorId: string;
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly expectedFirstIntentSequence: number;
  readonly expectedPreviousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly libraryId: string;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly writer: LibraryCoreIntentSegmentImportWriterV1;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function lowerHex(bytes: ArrayBuffer): LibraryCoreLowercaseHex64 {
  let output = "";
  for (const value of new Uint8Array(bytes)) {
    output += value.toString(16).padStart(2, "0");
  }
  return output as LibraryCoreLowercaseHex64;
}

async function sha256(
  bytes: Uint8Array,
  subtle: SubtleCrypto,
): Promise<LibraryCoreLowercaseHex64> {
  return lowerHex(await subtle.digest("SHA-256", exactBuffer(bytes)));
}

async function bodyDigest(
  body: LibraryCoreIntentSegmentBodyV1,
  subtle: SubtleCrypto,
): Promise<LibraryCoreLowercaseHex64> {
  return sha256(
    encodeLibraryCoreDigestInput(
      "intent-segment-body",
      body as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT },
    ),
    subtle,
  );
}

function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function canonicalEntry(
  source: LibraryCoreIntentOutboxEntryV1,
  bytes: Uint8Array,
): LibraryCoreIntentSegmentEntryV1 {
  positive(source.intentSequence, "intent outbox sequence");
  if (!isLibraryCoreOperationInstanceId(source.operationId)) {
    throw new TypeError("intent outbox operationId is invalid");
  }
  return parseLibraryCoreIntentSegmentEntryV1({
    canonical_envelope: decodeLibraryCoreCanonicalValue(bytes, {
      maximumBytes: INTENT_SEGMENT_RECORD_BYTE_LIMIT,
    }),
    intent_sequence: source.intentSequence,
    kind: "intent_segment_entry",
    operation_id: source.operationId,
  });
}

export async function prepareLibraryCoreIntentSegmentV1(
  request: PrepareLibraryCoreIntentSegmentRequestV1,
): Promise<PreparedLibraryCoreIntentSegmentV1> {
  if (
    !Array.isArray(request.entries) ||
    request.entries.length === 0 ||
    request.entries.length > LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT
  ) {
    throw new TypeError(
      `intent segment requires 1 through ${LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT.toLocaleString()} outbox entries`,
    );
  }
  const entries: LibraryCoreIntentSegmentEntryV1[] = [];
  let canonicalBytes = 0;
  for (const source of request.entries) {
    if (
      typeof source.canonicalEnvelopeJson !== "string" ||
      source.canonicalEnvelopeJson.length === 0
    ) {
      throw new TypeError(
        "intent outbox canonicalEnvelopeJson must be bounded nonempty text",
      );
    }
    const bytes = textEncoder.encode(source.canonicalEnvelopeJson);
    canonicalBytes += bytes.byteLength;
    if (
      bytes.byteLength > INTENT_SEGMENT_RECORD_BYTE_LIMIT ||
      canonicalBytes > LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT
    ) {
      throw new RangeError(
        "intent segment canonical envelope bytes exceed their bound",
      );
    }
    entries.push(canonicalEntry(source, bytes));
  }
  const first = entries[0]!;
  const last = entries.at(-1)!;
  const body = parseLibraryCoreIntentSegmentBodyV1({
    actor_id: request.actorId,
    canonical_envelope_bytes: canonicalBytes,
    entries,
    epoch_id: request.epochId,
    first_intent_sequence: first.intent_sequence,
    format: "freed_intent_segment_v1",
    kind: "intent_segment_body",
    last_intent_sequence: last.intent_sequence,
    library_id: request.libraryId,
    operation_count: entries.length,
    previous_segment_digest: request.previousSegmentDigest,
    protocol: "intent_segments_v1",
    protocol_version: 1,
    schema_version: request.schemaVersion,
  });
  const header = intentSegmentHeaderFromBodyV1(
    body,
    await bodyDigest(body, request.subtle),
  );
  const source = await encodeLibraryCoreWireObjectV1(
    [header, ...entries] as unknown as readonly LibraryCoreCanonicalValue[],
    {
      kind: "intents",
      maximumDecodedBytes: INTENT_SEGMENT_DECODED_BYTE_LIMIT,
      maximumRecordBytes: INTENT_SEGMENT_RECORD_BYTE_LIMIT,
      maximumRecords: INTENT_SEGMENT_RECORD_LIMIT,
      recordIdentity(value) {
        return libraryCoreIntentSegmentRecordIdentityV1(
          parseLibraryCoreIntentSegmentRecordV1(value),
        );
      },
    },
  );
  const storedDigest = await sha256(source, request.subtle);
  return Object.freeze({
    body,
    header,
    object: Object.freeze({
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        byteLength: source.byteLength,
        contentDigest: storedDigest,
        objectKey: createLibraryCoreImmutableObjectKey({
          actorId: header.actor_id,
          digest: storedDigest,
          firstSequence: header.first_intent_sequence,
          kind: "intent_segment",
          lastSequence: header.last_intent_sequence,
          libraryId: header.library_id,
        }),
      }),
      source,
    }),
  });
}

export async function importLibraryCoreIntentSegmentV1(
  request: ImportLibraryCoreIntentSegmentRequestV1,
): Promise<LibraryCoreIntentSegmentImportReceiptV1> {
  positive(request.expectedFirstIntentSequence, "expectedFirstIntentSequence");
  const reference = parseLibraryCoreImmutableObjectReferenceV1(
    request.reference,
  );
  const bytes = await request.adapter.readImmutable(reference);
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== reference.descriptor.byteLength ||
    (await sha256(bytes, request.subtle)) !== reference.descriptor.contentDigest
  ) {
    throw new Error("intent segment bytes do not match their descriptor");
  }
  const records = await decodeLibraryCoreWireObjectV1(bytes, {
    kind: "intents",
    maximumDecodedBytes: INTENT_SEGMENT_DECODED_BYTE_LIMIT,
    maximumRecordBytes: INTENT_SEGMENT_RECORD_BYTE_LIMIT,
    maximumRecords: INTENT_SEGMENT_RECORD_LIMIT,
    recordIdentity(value) {
      return libraryCoreIntentSegmentRecordIdentityV1(
        parseLibraryCoreIntentSegmentRecordV1(value),
      );
    },
  });
  const header = parseLibraryCoreIntentSegmentHeaderV1(records[0]);
  const entries = Object.freeze(
    records.slice(1).map((record) => {
      const parsed = parseLibraryCoreIntentSegmentRecordV1(record);
      if (parsed.kind !== "intent_segment_entry") {
        throw new TypeError("intent segment contains a misplaced header");
      }
      return parsed;
    }),
  );
  const body = intentSegmentBodyFromRecordsV1(header, entries);
  if (
    (await bodyDigest(body, request.subtle)) !== header.segment_digest ||
    header.library_id !== request.libraryId ||
    header.epoch_id !== request.storageEpoch ||
    header.actor_id !== request.actorId ||
    header.previous_segment_digest !== request.expectedPreviousSegmentDigest ||
    header.first_intent_sequence !== request.expectedFirstIntentSequence
  ) {
    throw new TypeError(
      "intent segment does not extend the expected actor head",
    );
  }
  const expectedKey = createLibraryCoreImmutableObjectKey({
    actorId: header.actor_id,
    digest: reference.descriptor.contentDigest,
    firstSequence: header.first_intent_sequence,
    kind: "intent_segment",
    lastSequence: header.last_intent_sequence,
    libraryId: header.library_id,
  });
  if (reference.descriptor.objectKey !== expectedKey) {
    throw new TypeError(
      "intent segment object key does not match its verified body",
    );
  }
  const receipt = await request.writer.appendIntentSegment({
    entries,
    header,
    reference,
  });
  if (
    receipt.actorId !== header.actor_id ||
    receipt.firstIntentSequence !== header.first_intent_sequence ||
    receipt.lastIntentSequence !== header.last_intent_sequence ||
    receipt.importedOperationCount !== header.operation_count ||
    receipt.segmentDigest !== header.segment_digest
  ) {
    throw new TypeError(
      "intent segment import receipt does not match the verified segment",
    );
  }
  return Object.freeze(receipt);
}
