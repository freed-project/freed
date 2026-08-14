import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_OPERATION_SEGMENT_FORMAT =
  "freed_operation_segment_v1" as const;
export const LIBRARY_CORE_OPERATION_SEGMENT_ENTRY_LIMIT = 1_000;
export const LIBRARY_CORE_OPERATION_SEGMENT_CANONICAL_BYTE_LIMIT = 4_000_000;

export interface LibraryCoreOperationSegmentEntryV1 {
  readonly canonical_envelope: Readonly<
    Record<string, LibraryCoreCanonicalValue>
  >;
  readonly ingest_sequence: number;
  readonly kind: "operation_segment_entry";
  readonly operation_id: LibraryCoreOperationInstanceId;
}

export interface LibraryCoreOperationSegmentBodyV1 {
  readonly base_frontier_digest: LibraryCoreLowercaseHex64;
  readonly canonical_envelope_bytes: number;
  readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
  readonly epoch: number;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly first_ingest_sequence: number;
  readonly format: typeof LIBRARY_CORE_OPERATION_SEGMENT_FORMAT;
  readonly kind: "operation_segment_body";
  readonly last_ingest_sequence: number;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly operation_count: number;
  readonly previous_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly protocol: "op_segments_v1";
  readonly protocol_version: 1;
  readonly result_frontier_digest: LibraryCoreLowercaseHex64;
  readonly schema_version: number;
}

export interface LibraryCoreOperationSegmentHeaderV1 {
  readonly base_frontier_digest: LibraryCoreLowercaseHex64;
  readonly canonical_envelope_bytes: number;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly first_ingest_sequence: number;
  readonly format: typeof LIBRARY_CORE_OPERATION_SEGMENT_FORMAT;
  readonly kind: "operation_segment_header";
  readonly last_ingest_sequence: number;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly operation_count: number;
  readonly previous_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly protocol: "op_segments_v1";
  readonly protocol_version: 1;
  readonly result_frontier_digest: LibraryCoreLowercaseHex64;
  readonly schema_version: number;
  readonly segment_digest: LibraryCoreLowercaseHex64;
}

export type LibraryCoreOperationSegmentRecordV1 =
  LibraryCoreOperationSegmentHeaderV1 | LibraryCoreOperationSegmentEntryV1;

const ENTRY_KEYS = [
  "canonical_envelope",
  "ingest_sequence",
  "kind",
  "operation_id",
] as const;
const BODY_KEYS = [
  "base_frontier_digest",
  "canonical_envelope_bytes",
  "entries",
  "epoch",
  "epoch_id",
  "first_ingest_sequence",
  "format",
  "kind",
  "last_ingest_sequence",
  "library_id",
  "operation_count",
  "previous_segment_digest",
  "protocol",
  "protocol_version",
  "result_frontier_digest",
  "schema_version",
] as const;
const HEADER_KEYS = [
  "base_frontier_digest",
  "canonical_envelope_bytes",
  "epoch",
  "epoch_id",
  "first_ingest_sequence",
  "format",
  "kind",
  "last_ingest_sequence",
  "library_id",
  "operation_count",
  "previous_segment_digest",
  "protocol",
  "protocol_version",
  "result_frontier_digest",
  "schema_version",
  "segment_digest",
] as const;

function closedRecord(
  value: unknown,
  keys: readonly string[],
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
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data value`);
    }
  }
  return value as Record<string, unknown>;
}

function denseArray(
  value: unknown,
  label: string,
  maximumItems: number,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximumItems
  ) {
    throw new RangeError(
      `${label} must contain 1 through ${maximumItems.toLocaleString()} entries`,
    );
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== value.length + 1 ||
    names[names.length - 1] !== "length" ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a dense undecorated array`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value === 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function operationId(
  value: unknown,
  label: string,
): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function nullableDigest(
  value: unknown,
  label: string,
): LibraryCoreLowercaseHex64 | null {
  return value === null ? null : digest(value, label);
}

function envelopeRecord(
  value: unknown,
): Readonly<Record<string, LibraryCoreCanonicalValue>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(
      "operation segment canonical_envelope must be a plain canonical record",
    );
  }
  encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue, {
    maximumBytes: LIBRARY_CORE_OPERATION_SEGMENT_CANONICAL_BYTE_LIMIT,
  });
  return value as Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export function parseLibraryCoreOperationSegmentEntryV1(
  value: unknown,
): LibraryCoreOperationSegmentEntryV1 {
  const record = closedRecord(value, ENTRY_KEYS, "operation segment entry");
  if (record.kind !== "operation_segment_entry") {
    throw new TypeError("operation segment entry kind is invalid");
  }
  const ingestSequence = positiveSafeInteger(
    record.ingest_sequence,
    "operation segment ingest_sequence",
  );
  const id = operationId(record.operation_id, "operation segment operation_id");
  const envelope = envelopeRecord(record.canonical_envelope);
  if (envelope.operation_id !== id) {
    throw new TypeError(
      "operation segment entry operation_id does not match its envelope",
    );
  }
  return Object.freeze({
    canonical_envelope: envelope,
    ingest_sequence: ingestSequence,
    kind: "operation_segment_entry",
    operation_id: id,
  });
}

function commonFields(
  record: Record<string, unknown>,
  label: string,
): Omit<LibraryCoreOperationSegmentHeaderV1, "kind" | "segment_digest"> {
  if (
    record.format !== LIBRARY_CORE_OPERATION_SEGMENT_FORMAT ||
    record.protocol !== "op_segments_v1" ||
    record.protocol_version !== 1
  ) {
    throw new TypeError(`${label} uses an unsupported protocol`);
  }
  const epoch = positiveSafeInteger(record.epoch, `${label} epoch`);
  const schemaVersion = positiveSafeInteger(
    record.schema_version,
    `${label} schema_version`,
  );
  const firstIngestSequence = positiveSafeInteger(
    record.first_ingest_sequence,
    `${label} first_ingest_sequence`,
  );
  const lastIngestSequence = positiveSafeInteger(
    record.last_ingest_sequence,
    `${label} last_ingest_sequence`,
  );
  const operationCount = positiveSafeInteger(
    record.operation_count,
    `${label} operation_count`,
  );
  const canonicalEnvelopeBytes = positiveSafeInteger(
    record.canonical_envelope_bytes,
    `${label} canonical_envelope_bytes`,
  );
  if (
    operationCount > LIBRARY_CORE_OPERATION_SEGMENT_ENTRY_LIMIT ||
    canonicalEnvelopeBytes >
      LIBRARY_CORE_OPERATION_SEGMENT_CANONICAL_BYTE_LIMIT ||
    lastIngestSequence - firstIngestSequence + 1 !== operationCount
  ) {
    throw new RangeError(`${label} sequence or byte bounds are invalid`);
  }
  return Object.freeze({
    base_frontier_digest: digest(
      record.base_frontier_digest,
      `${label} base_frontier_digest`,
    ),
    canonical_envelope_bytes: canonicalEnvelopeBytes,
    epoch,
    epoch_id: operationId(record.epoch_id, `${label} epoch_id`),
    first_ingest_sequence: firstIngestSequence,
    format: LIBRARY_CORE_OPERATION_SEGMENT_FORMAT,
    last_ingest_sequence: lastIngestSequence,
    library_id: operationId(record.library_id, `${label} library_id`),
    operation_count: operationCount,
    previous_segment_digest: nullableDigest(
      record.previous_segment_digest,
      `${label} previous_segment_digest`,
    ),
    protocol: "op_segments_v1",
    protocol_version: 1,
    result_frontier_digest: digest(
      record.result_frontier_digest,
      `${label} result_frontier_digest`,
    ),
    schema_version: schemaVersion,
  });
}

export function parseLibraryCoreOperationSegmentBodyV1(
  value: unknown,
): LibraryCoreOperationSegmentBodyV1 {
  const record = closedRecord(value, BODY_KEYS, "operation segment body");
  if (record.kind !== "operation_segment_body") {
    throw new TypeError("operation segment body kind is invalid");
  }
  const common = commonFields(record, "operation segment body");
  const entries = denseArray(
    record.entries,
    "operation segment entries",
    LIBRARY_CORE_OPERATION_SEGMENT_ENTRY_LIMIT,
  ).map(parseLibraryCoreOperationSegmentEntryV1);
  let canonicalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.ingest_sequence !== common.first_ingest_sequence + index) {
      throw new TypeError(
        "operation segment entry sequences must be contiguous",
      );
    }
    const envelope = entry.canonical_envelope;
    if (
      envelope.library_id !== common.library_id ||
      envelope.epoch !== common.epoch ||
      envelope.epoch_id !== common.epoch_id
    ) {
      throw new TypeError(
        "operation segment envelope does not match its library and epoch",
      );
    }
    canonicalBytes += encodeLibraryCoreCanonicalValue(envelope).byteLength;
  }
  if (
    entries.length !== common.operation_count ||
    canonicalBytes !== common.canonical_envelope_bytes
  ) {
    throw new TypeError(
      "operation segment entries do not match the declared count and bytes",
    );
  }
  const body = Object.freeze({
    ...common,
    entries: Object.freeze(entries),
    kind: "operation_segment_body",
  });
  encodeLibraryCoreCanonicalValue(
    body as unknown as LibraryCoreCanonicalValue,
    { maximumBytes: LIBRARY_CORE_OPERATION_SEGMENT_CANONICAL_BYTE_LIMIT },
  );
  return body;
}

export function parseLibraryCoreOperationSegmentHeaderV1(
  value: unknown,
): LibraryCoreOperationSegmentHeaderV1 {
  const record = closedRecord(value, HEADER_KEYS, "operation segment header");
  if (record.kind !== "operation_segment_header") {
    throw new TypeError("operation segment header kind is invalid");
  }
  return Object.freeze({
    ...commonFields(record, "operation segment header"),
    kind: "operation_segment_header",
    segment_digest: digest(
      record.segment_digest,
      "operation segment header segment_digest",
    ),
  });
}

export function parseLibraryCoreOperationSegmentRecordV1(
  value: unknown,
): LibraryCoreOperationSegmentRecordV1 {
  const kind =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as { readonly kind?: unknown }).kind
      : null;
  return kind === "operation_segment_header"
    ? parseLibraryCoreOperationSegmentHeaderV1(value)
    : parseLibraryCoreOperationSegmentEntryV1(value);
}

export function libraryCoreOperationSegmentRecordIdentityV1(
  record: LibraryCoreOperationSegmentRecordV1,
): string {
  return record.kind === "operation_segment_header"
    ? "00:header"
    : `01:${String(record.ingest_sequence).padStart(16, "0")}`;
}

export function operationSegmentBodyFromRecordsV1(
  headerInput: LibraryCoreOperationSegmentHeaderV1,
  entriesInput: readonly LibraryCoreOperationSegmentEntryV1[],
): LibraryCoreOperationSegmentBodyV1 {
  const header = parseLibraryCoreOperationSegmentHeaderV1(headerInput);
  return parseLibraryCoreOperationSegmentBodyV1({
    base_frontier_digest: header.base_frontier_digest,
    canonical_envelope_bytes: header.canonical_envelope_bytes,
    entries: entriesInput,
    epoch: header.epoch,
    epoch_id: header.epoch_id,
    first_ingest_sequence: header.first_ingest_sequence,
    format: header.format,
    kind: "operation_segment_body",
    last_ingest_sequence: header.last_ingest_sequence,
    library_id: header.library_id,
    operation_count: header.operation_count,
    previous_segment_digest: header.previous_segment_digest,
    protocol: header.protocol,
    protocol_version: header.protocol_version,
    result_frontier_digest: header.result_frontier_digest,
    schema_version: header.schema_version,
  });
}

export function operationSegmentHeaderFromBodyV1(
  bodyInput: LibraryCoreOperationSegmentBodyV1,
  segmentDigest: LibraryCoreLowercaseHex64,
): LibraryCoreOperationSegmentHeaderV1 {
  const body = parseLibraryCoreOperationSegmentBodyV1(bodyInput);
  return parseLibraryCoreOperationSegmentHeaderV1({
    base_frontier_digest: body.base_frontier_digest,
    canonical_envelope_bytes: body.canonical_envelope_bytes,
    epoch: body.epoch,
    epoch_id: body.epoch_id,
    first_ingest_sequence: body.first_ingest_sequence,
    format: body.format,
    kind: "operation_segment_header",
    last_ingest_sequence: body.last_ingest_sequence,
    library_id: body.library_id,
    operation_count: body.operation_count,
    previous_segment_digest: body.previous_segment_digest,
    protocol: body.protocol,
    protocol_version: body.protocol_version,
    result_frontier_digest: body.result_frontier_digest,
    schema_version: body.schema_version,
    segment_digest: segmentDigest,
  });
}
