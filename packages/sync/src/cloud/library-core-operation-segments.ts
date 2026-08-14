import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  isLibraryCoreOperationInstanceId,
  LIBRARY_CORE_OPERATION_SEGMENT_CANONICAL_BYTE_LIMIT,
  LIBRARY_CORE_OPERATION_SEGMENT_ENTRY_LIMIT,
  libraryCoreOperationSegmentRecordIdentityV1,
  operationSegmentBodyFromRecordsV1,
  operationSegmentHeaderFromBodyV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreOperationSegmentBodyV1,
  parseLibraryCoreOperationSegmentHeaderV1,
  parseLibraryCoreOperationSegmentRecordV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationSegmentBodyV1,
  type LibraryCoreOperationSegmentEntryV1,
  type LibraryCoreOperationSegmentHeaderV1,
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
const OPERATION_SEGMENT_DECODED_BYTE_LIMIT = 5_000_000;
const OPERATION_SEGMENT_RECORD_BYTE_LIMIT = 1_048_576;
const OPERATION_SEGMENT_RECORD_LIMIT = 1_001;
const MAX_TRANSPORT_OBJECT_ID_BYTES = 1_024;

export interface LibraryCoreOperationOutboxEntryV1 {
  readonly canonicalEnvelopeJson: string;
  readonly ingestSequence: number;
  readonly operationId: string;
}

export interface PrepareLibraryCoreOperationSegmentRequestV1 {
  readonly baseFrontierDigest: LibraryCoreLowercaseHex64;
  readonly entries: readonly LibraryCoreOperationOutboxEntryV1[];
  readonly epoch: number;
  readonly epochId: string;
  readonly libraryId: string;
  readonly previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly resultFrontierDigest: LibraryCoreLowercaseHex64;
  readonly schemaVersion: number;
  readonly subtle: SubtleCrypto;
}

export interface PreparedLibraryCoreOperationSegmentV1 {
  readonly body: LibraryCoreOperationSegmentBodyV1;
  readonly header: LibraryCoreOperationSegmentHeaderV1;
  readonly object: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}

export interface LibraryCoreOperationSegmentImportReceiptV1 {
  readonly firstIngestSequence: number;
  readonly importedOperationCount: number;
  readonly lastIngestSequence: number;
  readonly resultFrontierDigest: LibraryCoreLowercaseHex64;
  readonly segmentDigest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreOperationSegmentImportWriterV1 {
  appendOperationSegment(input: {
    readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
    readonly header: LibraryCoreOperationSegmentHeaderV1;
    readonly reference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCoreOperationSegmentImportReceiptV1>;
}

export interface ImportLibraryCoreOperationSegmentRequestV1 {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly expectedBaseFrontierDigest: LibraryCoreLowercaseHex64;
  readonly expectedFirstIngestSequence: number;
  readonly expectedPreviousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly libraryId: string;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly writer: LibraryCoreOperationSegmentImportWriterV1;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
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
  return lowerHex(await subtle.digest("SHA-256", exactArrayBuffer(bytes)));
}

async function segmentBodyDigest(
  body: LibraryCoreOperationSegmentBodyV1,
  subtle: SubtleCrypto,
): Promise<LibraryCoreLowercaseHex64> {
  return sha256(
    encodeLibraryCoreDigestInput(
      "operation-segment-body",
      body as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_OPERATION_SEGMENT_CANONICAL_BYTE_LIMIT },
    ),
    subtle,
  );
}

function assertSafePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function canonicalEntry(
  source: LibraryCoreOperationOutboxEntryV1,
  canonicalEnvelopeBytes: Uint8Array,
): LibraryCoreOperationSegmentEntryV1 {
  assertSafePositive(source.ingestSequence, "outbox ingestSequence");
  if (!isLibraryCoreOperationInstanceId(source.operationId)) {
    throw new TypeError("outbox operationId is invalid");
  }
  const canonicalEnvelope = decodeLibraryCoreCanonicalValue(
    canonicalEnvelopeBytes,
    { maximumBytes: OPERATION_SEGMENT_RECORD_BYTE_LIMIT },
  );
  return parseLibraryCoreOperationSegmentRecordV1({
    canonical_envelope: canonicalEnvelope,
    ingest_sequence: source.ingestSequence,
    kind: "operation_segment_entry",
    operation_id: source.operationId,
  }) as LibraryCoreOperationSegmentEntryV1;
}

export async function prepareLibraryCoreOperationSegmentV1(
  request: PrepareLibraryCoreOperationSegmentRequestV1,
): Promise<PreparedLibraryCoreOperationSegmentV1> {
  if (
    !Array.isArray(request.entries) ||
    request.entries.length === 0 ||
    request.entries.length > LIBRARY_CORE_OPERATION_SEGMENT_ENTRY_LIMIT
  ) {
    throw new TypeError(
      `operation segment requires 1 through ${LIBRARY_CORE_OPERATION_SEGMENT_ENTRY_LIMIT.toLocaleString()} outbox entries`,
    );
  }
  const entries: LibraryCoreOperationSegmentEntryV1[] = [];
  let canonicalEnvelopeBytes = 0;
  for (const source of request.entries) {
    if (
      typeof source.canonicalEnvelopeJson !== "string" ||
      source.canonicalEnvelopeJson.length === 0 ||
      source.canonicalEnvelopeJson.length > OPERATION_SEGMENT_RECORD_BYTE_LIMIT
    ) {
      throw new TypeError(
        "outbox canonicalEnvelopeJson must be bounded nonempty text",
      );
    }
    const encodedEnvelope = textEncoder.encode(source.canonicalEnvelopeJson);
    canonicalEnvelopeBytes += encodedEnvelope.byteLength;
    if (
      encodedEnvelope.byteLength > OPERATION_SEGMENT_RECORD_BYTE_LIMIT ||
      canonicalEnvelopeBytes >
        LIBRARY_CORE_OPERATION_SEGMENT_CANONICAL_BYTE_LIMIT
    ) {
      throw new RangeError(
        "operation segment canonical envelope bytes exceed their bound",
      );
    }
    entries.push(canonicalEntry(source, encodedEnvelope));
  }
  const frozenEntries = Object.freeze(entries);
  const first = entries[0]!;
  const last = entries.at(-1)!;
  const body = parseLibraryCoreOperationSegmentBodyV1({
    base_frontier_digest: request.baseFrontierDigest,
    canonical_envelope_bytes: canonicalEnvelopeBytes,
    entries: frozenEntries,
    epoch: request.epoch,
    epoch_id: request.epochId,
    first_ingest_sequence: first.ingest_sequence,
    format: "freed_operation_segment_v1",
    kind: "operation_segment_body",
    last_ingest_sequence: last.ingest_sequence,
    library_id: request.libraryId,
    operation_count: entries.length,
    previous_segment_digest: request.previousSegmentDigest,
    protocol: "op_segments_v1",
    protocol_version: 1,
    result_frontier_digest: request.resultFrontierDigest,
    schema_version: request.schemaVersion,
  });
  const header = operationSegmentHeaderFromBodyV1(
    body,
    await segmentBodyDigest(body, request.subtle),
  );
  const source = await encodeLibraryCoreWireObjectV1(
    [header, ...entries] as unknown as readonly LibraryCoreCanonicalValue[],
    {
      kind: "operations",
      maximumDecodedBytes: OPERATION_SEGMENT_DECODED_BYTE_LIMIT,
      maximumRecordBytes: OPERATION_SEGMENT_RECORD_BYTE_LIMIT,
      maximumRecords: OPERATION_SEGMENT_RECORD_LIMIT,
      recordIdentity(value) {
        return libraryCoreOperationSegmentRecordIdentityV1(
          parseLibraryCoreOperationSegmentRecordV1(value),
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
          digest: storedDigest,
          epochId: header.epoch_id,
          firstSequence: header.first_ingest_sequence,
          kind: "operation_segment",
          lastSequence: header.last_ingest_sequence,
          libraryId: header.library_id,
        }),
      }),
      source,
    }),
  });
}

function assertTransportObjectId(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > MAX_TRANSPORT_OBJECT_ID_BYTES
  ) {
    throw new TypeError(
      "operation segment transportObjectId must be bounded nonempty text",
    );
  }
}

export async function importLibraryCoreOperationSegmentV1(
  request: ImportLibraryCoreOperationSegmentRequestV1,
): Promise<LibraryCoreOperationSegmentImportReceiptV1> {
  assertSafePositive(
    request.expectedFirstIngestSequence,
    "expectedFirstIngestSequence",
  );
  const reference = parseLibraryCoreImmutableObjectReferenceV1(
    request.reference,
  );
  assertTransportObjectId(reference.transportObjectId);
  const bytes = await request.adapter.readImmutable(reference);
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("operation segment reader must return a Uint8Array");
  }
  if (
    bytes.byteLength !== reference.descriptor.byteLength ||
    (await sha256(bytes, request.subtle)) !== reference.descriptor.contentDigest
  ) {
    throw new Error(
      "operation segment stored bytes do not match their descriptor",
    );
  }
  const records = await decodeLibraryCoreWireObjectV1(bytes, {
    kind: "operations",
    maximumDecodedBytes: OPERATION_SEGMENT_DECODED_BYTE_LIMIT,
    maximumRecordBytes: OPERATION_SEGMENT_RECORD_BYTE_LIMIT,
    maximumRecords: OPERATION_SEGMENT_RECORD_LIMIT,
    recordIdentity(value) {
      return libraryCoreOperationSegmentRecordIdentityV1(
        parseLibraryCoreOperationSegmentRecordV1(value),
      );
    },
  });
  const header = parseLibraryCoreOperationSegmentHeaderV1(records[0]);
  const entries = Object.freeze(
    records.slice(1).map((record) => {
      const parsed = parseLibraryCoreOperationSegmentRecordV1(record);
      if (parsed.kind !== "operation_segment_entry") {
        throw new TypeError(
          "operation segment contains a repeated or misplaced header",
        );
      }
      return parsed;
    }),
  );
  const body = operationSegmentBodyFromRecordsV1(header, entries);
  if (
    (await segmentBodyDigest(body, request.subtle)) !== header.segment_digest ||
    header.library_id !== request.libraryId ||
    header.epoch_id !== request.storageEpoch ||
    header.base_frontier_digest !== request.expectedBaseFrontierDigest ||
    header.previous_segment_digest !== request.expectedPreviousSegmentDigest ||
    header.first_ingest_sequence !== request.expectedFirstIngestSequence
  ) {
    throw new TypeError(
      "operation segment does not extend the expected checkpoint tail",
    );
  }
  const expectedKey = createLibraryCoreImmutableObjectKey({
    digest: reference.descriptor.contentDigest,
    epochId: header.epoch_id,
    firstSequence: header.first_ingest_sequence,
    kind: "operation_segment",
    lastSequence: header.last_ingest_sequence,
    libraryId: header.library_id,
  });
  if (reference.descriptor.objectKey !== expectedKey) {
    throw new TypeError(
      "operation segment object key does not match its verified body",
    );
  }
  const receipt = await request.writer.appendOperationSegment({
    entries,
    header,
    reference,
  });
  if (
    receipt.firstIngestSequence !== header.first_ingest_sequence ||
    receipt.lastIngestSequence !== header.last_ingest_sequence ||
    receipt.importedOperationCount !== header.operation_count ||
    receipt.resultFrontierDigest !== header.result_frontier_digest ||
    receipt.segmentDigest !== header.segment_digest
  ) {
    throw new TypeError(
      "operation segment import receipt does not match the verified segment",
    );
  }
  return Object.freeze(receipt);
}
