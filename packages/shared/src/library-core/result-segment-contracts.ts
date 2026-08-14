import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
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

export const LIBRARY_CORE_RESULT_SEGMENT_FORMAT =
  "freed_result_segment_v1" as const;
export const LIBRARY_CORE_RESULT_SEGMENT_ENTRY_LIMIT = 1_000;
export const LIBRARY_CORE_RESULT_SEGMENT_CANONICAL_BYTE_LIMIT = 4_000_000;

export type LibraryCoreIntentResultStatusV1 =
  | "accepted"
  | "provider_completed"
  | "provider_failed";

export interface LibraryCoreIntentResultEntryV1 {
  readonly actor_id: LibraryCoreOperationInstanceId;
  readonly intent_operation_id: LibraryCoreOperationInstanceId;
  readonly intent_sequence: number;
  readonly kind: "result_segment_entry";
  readonly provider_receipt_digest: LibraryCoreLowercaseHex64 | null;
  readonly result_operation_id: LibraryCoreOperationInstanceId;
  readonly result_sequence: number;
  readonly status: LibraryCoreIntentResultStatusV1;
}

interface LibraryCoreResultSegmentCommonV1 {
  readonly actor_id: LibraryCoreOperationInstanceId;
  readonly canonical_entry_bytes: number;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly first_result_sequence: number;
  readonly format: typeof LIBRARY_CORE_RESULT_SEGMENT_FORMAT;
  readonly last_result_sequence: number;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly previous_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly protocol: "result_segments_v1";
  readonly protocol_version: 1;
  readonly result_count: number;
  readonly schema_version: 1;
}

export interface LibraryCoreResultSegmentBodyV1
  extends LibraryCoreResultSegmentCommonV1 {
  readonly entries: readonly LibraryCoreIntentResultEntryV1[];
  readonly kind: "result_segment_body";
}

export interface LibraryCoreResultSegmentHeaderV1
  extends LibraryCoreResultSegmentCommonV1 {
  readonly kind: "result_segment_header";
  readonly segment_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreResultHeadV1 {
  readonly actor_id: LibraryCoreOperationInstanceId;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly latest_segment: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly latest_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly next_result_sequence: number;
  readonly protocol: "result_head_v1";
  readonly protocol_version: 1;
  readonly schema_version: 1;
}

export type LibraryCoreResultSegmentRecordV1 =
  | LibraryCoreResultSegmentHeaderV1
  | LibraryCoreIntentResultEntryV1;

function record(value: unknown, keys: readonly string[], label: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a closed record`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown, label: string): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${label} must be a bounded Library Core identifier`);
  }
  return value;
}

function positive(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value === 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nullableDigest(value: unknown, label: string): LibraryCoreLowercaseHex64 | null {
  if (value === null) return null;
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function digest(value: unknown, label: string): LibraryCoreLowercaseHex64 {
  const parsed = nullableDigest(value, label);
  if (parsed === null) throw new TypeError(`${label} must not be null`);
  return parsed;
}

const ENTRY_KEYS = [
  "actor_id", "intent_operation_id", "intent_sequence", "kind",
  "provider_receipt_digest", "result_operation_id", "result_sequence", "status",
] as const;

export function parseLibraryCoreIntentResultEntryV1(
  value: unknown,
): LibraryCoreIntentResultEntryV1 {
  const source = record(value, ENTRY_KEYS, "intent result entry");
  if (source.kind !== "result_segment_entry") {
    throw new TypeError("intent result entry kind is invalid");
  }
  const status = source.status;
  if (status !== "accepted" && status !== "provider_completed" && status !== "provider_failed") {
    throw new TypeError("intent result status is invalid");
  }
  const providerReceiptDigest = nullableDigest(
    source.provider_receipt_digest,
    "provider_receipt_digest",
  );
  if ((status === "accepted") !== (providerReceiptDigest === null)) {
    throw new TypeError("only a provider result may carry a provider receipt");
  }
  return Object.freeze({
    actor_id: id(source.actor_id, "actor_id"),
    intent_operation_id: id(source.intent_operation_id, "intent_operation_id"),
    intent_sequence: positive(source.intent_sequence, "intent_sequence"),
    kind: "result_segment_entry",
    provider_receipt_digest: providerReceiptDigest,
    result_operation_id: id(source.result_operation_id, "result_operation_id"),
    result_sequence: positive(source.result_sequence, "result_sequence"),
    status,
  });
}

const BODY_KEYS = [
  "actor_id", "canonical_entry_bytes", "entries", "epoch_id",
  "first_result_sequence", "format", "kind", "last_result_sequence",
  "library_id", "previous_segment_digest", "protocol", "protocol_version",
  "result_count", "schema_version",
] as const;
const HEADER_KEYS: readonly string[] = [
  ...BODY_KEYS.filter((key) => key !== "entries"),
  "segment_digest",
];

function common(source: Record<string, unknown>, label: string): LibraryCoreResultSegmentCommonV1 {
  if (
    source.format !== LIBRARY_CORE_RESULT_SEGMENT_FORMAT ||
    source.protocol !== "result_segments_v1" ||
    source.protocol_version !== 1 || source.schema_version !== 1
  ) {
    throw new TypeError(`${label} uses an unsupported protocol`);
  }
  const first = positive(source.first_result_sequence, "first_result_sequence");
  const last = positive(source.last_result_sequence, "last_result_sequence");
  const count = positive(source.result_count, "result_count");
  const bytes = positive(source.canonical_entry_bytes, "canonical_entry_bytes");
  if (last - first + 1 !== count || count > LIBRARY_CORE_RESULT_SEGMENT_ENTRY_LIMIT || bytes > LIBRARY_CORE_RESULT_SEGMENT_CANONICAL_BYTE_LIMIT) {
    throw new RangeError(`${label} exceeds its sequence or byte bounds`);
  }
  return {
    actor_id: id(source.actor_id, "actor_id"),
    canonical_entry_bytes: bytes,
    epoch_id: id(source.epoch_id, "epoch_id"),
    first_result_sequence: first,
    format: LIBRARY_CORE_RESULT_SEGMENT_FORMAT,
    last_result_sequence: last,
    library_id: id(source.library_id, "library_id"),
    previous_segment_digest: nullableDigest(source.previous_segment_digest, "previous_segment_digest"),
    protocol: "result_segments_v1",
    protocol_version: 1,
    result_count: count,
    schema_version: 1,
  };
}

export function parseLibraryCoreResultSegmentBodyV1(value: unknown): LibraryCoreResultSegmentBodyV1 {
  const source = record(value, BODY_KEYS, "result segment body");
  if (source.kind !== "result_segment_body" || !Array.isArray(source.entries)) {
    throw new TypeError("result segment body is invalid");
  }
  const fields = common(source, "result segment body");
  const entries = source.entries.map(parseLibraryCoreIntentResultEntryV1);
  if (entries.length !== fields.result_count) throw new TypeError("result segment count is invalid");
  let bytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    bytes += encodeLibraryCoreCanonicalValue(entry as unknown as LibraryCoreCanonicalValue).byteLength;
    if (entry.actor_id !== fields.actor_id || entry.result_sequence !== fields.first_result_sequence + index) {
      throw new TypeError("result segment entries are not one contiguous actor range");
    }
  }
  if (bytes !== fields.canonical_entry_bytes) throw new TypeError("result segment byte count is invalid");
  return Object.freeze({ ...fields, entries: Object.freeze(entries), kind: "result_segment_body" });
}

export function resultSegmentHeaderFromBodyV1(
  body: LibraryCoreResultSegmentBodyV1,
  segmentDigest: LibraryCoreLowercaseHex64,
): LibraryCoreResultSegmentHeaderV1 {
  if (!isLibraryCoreLowercaseHex64(segmentDigest)) throw new TypeError("segment digest is invalid");
  const { entries: _entries, ...fields } = body;
  return Object.freeze({ ...fields, kind: "result_segment_header", segment_digest: segmentDigest });
}

export function parseLibraryCoreResultSegmentHeaderV1(value: unknown): LibraryCoreResultSegmentHeaderV1 {
  const source = record(value, HEADER_KEYS, "result segment header");
  if (source.kind !== "result_segment_header") throw new TypeError("result segment header kind is invalid");
  return Object.freeze({ ...common(source, "result segment header"), kind: "result_segment_header", segment_digest: digest(source.segment_digest, "segment_digest") });
}

export function parseLibraryCoreResultHeadV1(value: unknown): LibraryCoreResultHeadV1 {
  const source = record(value, ["actor_id", "epoch_id", "latest_segment", "latest_segment_digest", "library_id", "next_result_sequence", "protocol", "protocol_version", "schema_version"], "result head");
  if (source.protocol !== "result_head_v1" || source.protocol_version !== 1 || source.schema_version !== 1) throw new TypeError("result head protocol is invalid");
  const latest = source.latest_segment === null ? null : parseLibraryCoreImmutableObjectReferenceV1(source.latest_segment);
  const latestDigest = nullableDigest(source.latest_segment_digest, "latest_segment_digest");
  if ((latest === null) !== (latestDigest === null) || (latest && latest.descriptor.contentDigest !== latestDigest)) throw new TypeError("result head segment identity is invalid");
  return Object.freeze({
    actor_id: id(source.actor_id, "actor_id"), epoch_id: id(source.epoch_id, "epoch_id"),
    latest_segment: latest, latest_segment_digest: latestDigest,
    library_id: id(source.library_id, "library_id"),
    next_result_sequence: positive(source.next_result_sequence, "next_result_sequence"),
    protocol: "result_head_v1", protocol_version: 1, schema_version: 1,
  });
}

export function parseLibraryCoreResultSegmentRecordV1(value: unknown): LibraryCoreResultSegmentRecordV1 {
  const kind = (value as { kind?: unknown } | null)?.kind;
  return kind === "result_segment_header"
    ? parseLibraryCoreResultSegmentHeaderV1(value)
    : parseLibraryCoreIntentResultEntryV1(value);
}

export function resultSegmentBodyFromRecordsV1(
  header: LibraryCoreResultSegmentHeaderV1,
  entries: readonly LibraryCoreIntentResultEntryV1[],
): LibraryCoreResultSegmentBodyV1 {
  const { segment_digest: _segmentDigest, ...fields } = header;
  return parseLibraryCoreResultSegmentBodyV1({
    ...fields,
    entries,
    kind: "result_segment_body",
  });
}

export function libraryCoreResultSegmentRecordIdentityV1(recordValue: LibraryCoreResultSegmentRecordV1): string {
  return recordValue.kind === "result_segment_header"
    ? `header:${recordValue.segment_digest}`
    : `result:${recordValue.actor_id}:${recordValue.result_sequence}:${recordValue.result_operation_id}`;
}
