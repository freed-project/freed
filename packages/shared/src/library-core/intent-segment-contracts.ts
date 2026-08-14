import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreImmutableObjectReferenceV1,
} from "./immutable-transport-contracts.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_INTENT_SEGMENT_FORMAT =
  "freed_intent_segment_v1" as const;
export const LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT = 1_000;
export const LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT = 4_000_000;

export interface LibraryCoreIntentSegmentEntryV1 {
  readonly canonical_envelope: Readonly<
    Record<string, LibraryCoreCanonicalValue>
  >;
  readonly intent_sequence: number;
  readonly kind: "intent_segment_entry";
  readonly operation_id: LibraryCoreOperationInstanceId;
}

interface LibraryCoreIntentSegmentCommonV1 {
  readonly actor_id: LibraryCoreOperationInstanceId;
  readonly canonical_envelope_bytes: number;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly first_intent_sequence: number;
  readonly format: typeof LIBRARY_CORE_INTENT_SEGMENT_FORMAT;
  readonly last_intent_sequence: number;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly operation_count: number;
  readonly previous_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly protocol: "intent_segments_v1";
  readonly protocol_version: 1;
  readonly schema_version: number;
}

export interface LibraryCoreIntentSegmentBodyV1 extends LibraryCoreIntentSegmentCommonV1 {
  readonly entries: readonly LibraryCoreIntentSegmentEntryV1[];
  readonly kind: "intent_segment_body";
}

export interface LibraryCoreIntentSegmentHeaderV1 extends LibraryCoreIntentSegmentCommonV1 {
  readonly kind: "intent_segment_header";
  readonly segment_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreIntentHeadV1 {
  readonly actor_id: LibraryCoreOperationInstanceId;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly latest_segment: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly latest_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly next_intent_sequence: number;
  readonly protocol: "intent_head_v1";
  readonly protocol_version: 1;
  readonly schema_version: 1;
}

export type LibraryCoreIntentSegmentRecordV1 =
  LibraryCoreIntentSegmentHeaderV1 | LibraryCoreIntentSegmentEntryV1;

const ENTRY_KEYS = [
  "canonical_envelope",
  "intent_sequence",
  "kind",
  "operation_id",
] as const;
const BODY_KEYS = [
  "actor_id",
  "canonical_envelope_bytes",
  "entries",
  "epoch_id",
  "first_intent_sequence",
  "format",
  "kind",
  "last_intent_sequence",
  "library_id",
  "operation_count",
  "previous_segment_digest",
  "protocol",
  "protocol_version",
  "schema_version",
] as const;
const HEADER_KEYS = [
  "actor_id",
  "canonical_envelope_bytes",
  "epoch_id",
  "first_intent_sequence",
  "format",
  "kind",
  "last_intent_sequence",
  "library_id",
  "operation_count",
  "previous_segment_digest",
  "protocol",
  "protocol_version",
  "schema_version",
  "segment_digest",
] as const;
const HEAD_KEYS = [
  "actor_id",
  "epoch_id",
  "latest_segment",
  "latest_segment_digest",
  "library_id",
  "next_intent_sequence",
  "protocol",
  "protocol_version",
  "schema_version",
] as const;

function closedRecord(
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

function identifier(
  value: unknown,
  label: string,
): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${label} must be a bounded Library Core identifier`);
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

function positiveInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value === 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function envelopeRecord(
  value: unknown,
): Readonly<Record<string, LibraryCoreCanonicalValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("intent canonical_envelope must be a plain record");
  }
  encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue, {
    maximumBytes: LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT,
  });
  return value as Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export function parseLibraryCoreIntentSegmentEntryV1(
  value: unknown,
): LibraryCoreIntentSegmentEntryV1 {
  const record = closedRecord(value, ENTRY_KEYS, "intent segment entry");
  if (record.kind !== "intent_segment_entry") {
    throw new TypeError("intent segment entry kind is invalid");
  }
  const envelope = envelopeRecord(record.canonical_envelope);
  const operationId = identifier(
    record.operation_id,
    "intent segment operation_id",
  );
  const sequence = positiveInteger(
    record.intent_sequence,
    "intent segment intent_sequence",
  );
  if (
    envelope.operation_id !== operationId ||
    envelope.actor_sequence !== sequence
  ) {
    throw new TypeError(
      "intent segment identity does not match its canonical envelope",
    );
  }
  return Object.freeze({
    canonical_envelope: envelope,
    intent_sequence: sequence,
    kind: "intent_segment_entry",
    operation_id: operationId,
  });
}

function commonFields(
  record: Record<string, unknown>,
  label: string,
): LibraryCoreIntentSegmentCommonV1 {
  if (
    record.format !== LIBRARY_CORE_INTENT_SEGMENT_FORMAT ||
    record.protocol !== "intent_segments_v1" ||
    record.protocol_version !== 1
  ) {
    throw new TypeError(`${label} uses an unsupported protocol`);
  }
  const first = positiveInteger(
    record.first_intent_sequence,
    `${label} first_intent_sequence`,
  );
  const last = positiveInteger(
    record.last_intent_sequence,
    `${label} last_intent_sequence`,
  );
  const count = positiveInteger(
    record.operation_count,
    `${label} operation_count`,
  );
  const bytes = positiveInteger(
    record.canonical_envelope_bytes,
    `${label} canonical_envelope_bytes`,
  );
  if (
    count > LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT ||
    bytes > LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT ||
    last - first + 1 !== count
  ) {
    throw new RangeError(`${label} sequence or byte bounds are invalid`);
  }
  const previousSegmentDigest = nullableDigest(
    record.previous_segment_digest,
    `${label} previous_segment_digest`,
  );
  if (
    (first === 1 && previousSegmentDigest !== null) ||
    (first > 1 && previousSegmentDigest === null)
  ) {
    throw new TypeError(
      `${label} previous segment nullability does not match its first sequence`,
    );
  }
  return Object.freeze({
    actor_id: identifier(record.actor_id, `${label} actor_id`),
    canonical_envelope_bytes: bytes,
    epoch_id: identifier(record.epoch_id, `${label} epoch_id`),
    first_intent_sequence: first,
    format: LIBRARY_CORE_INTENT_SEGMENT_FORMAT,
    last_intent_sequence: last,
    library_id: identifier(record.library_id, `${label} library_id`),
    operation_count: count,
    previous_segment_digest: previousSegmentDigest,
    protocol: "intent_segments_v1",
    protocol_version: 1,
    schema_version: positiveInteger(
      record.schema_version,
      `${label} schema_version`,
    ),
  });
}

export function parseLibraryCoreIntentSegmentBodyV1(
  value: unknown,
): LibraryCoreIntentSegmentBodyV1 {
  const record = closedRecord(value, BODY_KEYS, "intent segment body");
  if (record.kind !== "intent_segment_body") {
    throw new TypeError("intent segment body kind is invalid");
  }
  const common = commonFields(record, "intent segment body");
  if (!Array.isArray(record.entries)) {
    throw new TypeError("intent segment entries must be an array");
  }
  const entries = Object.freeze(
    record.entries.map(parseLibraryCoreIntentSegmentEntryV1),
  );
  let canonicalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (
      entry.intent_sequence !== common.first_intent_sequence + index ||
      entry.canonical_envelope.library_id !== common.library_id ||
      entry.canonical_envelope.epoch_id !== common.epoch_id ||
      entry.canonical_envelope.actor_id !== common.actor_id ||
      entry.canonical_envelope.schema_version !== common.schema_version
    ) {
      throw new TypeError(
        "intent segment entries are reordered or cross an identity boundary",
      );
    }
    canonicalBytes += encodeLibraryCoreCanonicalValue(
      entry.canonical_envelope as LibraryCoreCanonicalValue,
    ).byteLength;
  }
  for (let index = 0; index < entries.length;) {
    const envelope = entries[index]!.canonical_envelope;
    const transactionId = identifier(
      envelope.transaction_id,
      "intent envelope transaction_id",
    );
    const memberCount = positiveInteger(
      envelope.transaction_member_count,
      "intent envelope transaction_member_count",
    );
    if (memberCount > LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT) {
      throw new RangeError("intent transaction member count exceeds its bound");
    }
    for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
      const member = entries[index + memberIndex]?.canonical_envelope;
      if (
        member === undefined ||
        member.transaction_id !== transactionId ||
        member.transaction_member_count !== memberCount ||
        member.transaction_member_index !== memberIndex
      ) {
        throw new TypeError(
          "intent segment must contain complete contiguous transactions",
        );
      }
    }
    index += memberCount;
  }
  if (
    entries.length !== common.operation_count ||
    canonicalBytes !== common.canonical_envelope_bytes
  ) {
    throw new TypeError(
      "intent segment entries do not match the declared count and bytes",
    );
  }
  return Object.freeze({
    ...common,
    entries,
    kind: "intent_segment_body",
  });
}

export function parseLibraryCoreIntentSegmentHeaderV1(
  value: unknown,
): LibraryCoreIntentSegmentHeaderV1 {
  const record = closedRecord(value, HEADER_KEYS, "intent segment header");
  if (record.kind !== "intent_segment_header") {
    throw new TypeError("intent segment header kind is invalid");
  }
  return Object.freeze({
    ...commonFields(record, "intent segment header"),
    kind: "intent_segment_header",
    segment_digest: digest(
      record.segment_digest,
      "intent segment header segment_digest",
    ),
  });
}

export function parseLibraryCoreIntentSegmentRecordV1(
  value: unknown,
): LibraryCoreIntentSegmentRecordV1 {
  if (value === null || typeof value !== "object") {
    throw new TypeError("intent segment record must be an object");
  }
  return (value as { kind?: unknown }).kind === "intent_segment_header"
    ? parseLibraryCoreIntentSegmentHeaderV1(value)
    : parseLibraryCoreIntentSegmentEntryV1(value);
}

export function libraryCoreIntentSegmentRecordIdentityV1(
  record: LibraryCoreIntentSegmentRecordV1,
): string {
  return record.kind === "intent_segment_header"
    ? "header"
    : `intent:${record.intent_sequence.toLocaleString("en-US", {
        useGrouping: false,
      })}:${record.operation_id}`;
}

export function intentSegmentBodyFromRecordsV1(
  headerInput: LibraryCoreIntentSegmentHeaderV1,
  entriesInput: readonly LibraryCoreIntentSegmentEntryV1[],
): LibraryCoreIntentSegmentBodyV1 {
  const header = parseLibraryCoreIntentSegmentHeaderV1(headerInput);
  return parseLibraryCoreIntentSegmentBodyV1({
    actor_id: header.actor_id,
    canonical_envelope_bytes: header.canonical_envelope_bytes,
    entries: entriesInput,
    epoch_id: header.epoch_id,
    first_intent_sequence: header.first_intent_sequence,
    format: header.format,
    kind: "intent_segment_body",
    last_intent_sequence: header.last_intent_sequence,
    library_id: header.library_id,
    operation_count: header.operation_count,
    previous_segment_digest: header.previous_segment_digest,
    protocol: header.protocol,
    protocol_version: header.protocol_version,
    schema_version: header.schema_version,
  });
}

export function intentSegmentHeaderFromBodyV1(
  bodyInput: LibraryCoreIntentSegmentBodyV1,
  segmentDigest: unknown,
): LibraryCoreIntentSegmentHeaderV1 {
  const body = parseLibraryCoreIntentSegmentBodyV1(bodyInput);
  return parseLibraryCoreIntentSegmentHeaderV1({
    actor_id: body.actor_id,
    canonical_envelope_bytes: body.canonical_envelope_bytes,
    epoch_id: body.epoch_id,
    first_intent_sequence: body.first_intent_sequence,
    format: body.format,
    kind: "intent_segment_header",
    last_intent_sequence: body.last_intent_sequence,
    library_id: body.library_id,
    operation_count: body.operation_count,
    previous_segment_digest: body.previous_segment_digest,
    protocol: body.protocol,
    protocol_version: body.protocol_version,
    schema_version: body.schema_version,
    segment_digest: segmentDigest,
  });
}

export function parseLibraryCoreIntentHeadV1(
  value: unknown,
): LibraryCoreIntentHeadV1 {
  const record = closedRecord(value, HEAD_KEYS, "intent head");
  if (
    record.protocol !== "intent_head_v1" ||
    record.protocol_version !== 1 ||
    record.schema_version !== 1
  ) {
    throw new TypeError("intent head uses an unsupported protocol");
  }
  const libraryId = identifier(record.library_id, "intent head library_id");
  const epochId = identifier(record.epoch_id, "intent head epoch_id");
  const actorId = identifier(record.actor_id, "intent head actor_id");
  const nextSequence = positiveInteger(
    record.next_intent_sequence,
    "intent head next_intent_sequence",
  );
  const latestDigest = nullableDigest(
    record.latest_segment_digest,
    "intent head latest_segment_digest",
  );
  const latestReference =
    record.latest_segment === null
      ? null
      : parseLibraryCoreImmutableObjectReferenceV1(record.latest_segment);
  if ((latestReference === null) !== (latestDigest === null)) {
    throw new TypeError(
      "intent head latest segment reference and digest must share nullability",
    );
  }
  if (latestReference && latestDigest) {
    const sequenceMatch = /~s([0-9]+)-([0-9]+)~/.exec(
      latestReference.descriptor.objectKey,
    );
    const firstSequence = Number(sequenceMatch?.[1] ?? Number.NaN);
    const lastSequence = Number(sequenceMatch?.[2] ?? Number.NaN);
    if (
      !isLibraryCoreNonnegativeSafeInteger(firstSequence) ||
      !isLibraryCoreNonnegativeSafeInteger(lastSequence) ||
      firstSequence === 0 ||
      lastSequence + 1 !== nextSequence
    ) {
      throw new TypeError(
        "intent head latest segment does not end at the previous actor sequence",
      );
    }
    const expectedKey = createLibraryCoreImmutableObjectKey({
      actorId,
      digest: latestReference.descriptor.contentDigest,
      epochId,
      firstSequence,
      kind: "intent_segment",
      lastSequence,
      libraryId,
    });
    if (
      latestDigest !== latestReference.descriptor.contentDigest ||
      latestReference.descriptor.objectKey !== expectedKey
    ) {
      throw new TypeError(
        "intent head latest segment does not match its actor sequence",
      );
    }
  } else if (nextSequence !== 1) {
    throw new TypeError("an empty intent head must begin at sequence 1");
  }
  return Object.freeze({
    actor_id: actorId,
    epoch_id: epochId,
    latest_segment: latestReference,
    latest_segment_digest: latestDigest,
    library_id: libraryId,
    next_intent_sequence: nextSequence,
    protocol: "intent_head_v1",
    protocol_version: 1,
    schema_version: 1,
  });
}
