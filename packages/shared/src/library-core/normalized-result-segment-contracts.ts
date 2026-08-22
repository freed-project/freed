import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
  parseLibraryCoreFollowerResultEnvelopeV1,
  type LibraryCoreFollowerResultEnvelopeV1,
} from "./follower-result-contracts.js";
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

export const LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_FORMAT =
  "freed_normalized_result_segment_v2" as const;
export const LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_RECORD_LIMIT = 128;
export const LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_CANONICAL_BYTE_LIMIT =
  1_048_576;

interface LibraryCoreNormalizedResultSegmentCommonV2 {
  readonly actor_id: LibraryCoreOperationInstanceId;
  readonly canonical_result_bytes: number;
  readonly first_result_sequence: number;
  readonly format: typeof LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_FORMAT;
  readonly last_result_sequence: number;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly previous_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly protocol: "normalized_result_segments_v2";
  readonly protocol_version: 2;
  readonly result_count: number;
  readonly storage_epoch_id: LibraryCoreOperationInstanceId;
}

export interface LibraryCoreNormalizedResultSegmentBodyV2
  extends LibraryCoreNormalizedResultSegmentCommonV2 {
  readonly kind: "normalized_result_segment_body";
  readonly results: readonly LibraryCoreFollowerResultEnvelopeV1[];
}

export interface LibraryCoreNormalizedResultSegmentHeaderV2
  extends LibraryCoreNormalizedResultSegmentCommonV2 {
  readonly kind: "normalized_result_segment_header";
  readonly segment_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreNormalizedResultHeadV2 {
  readonly actor_id: LibraryCoreOperationInstanceId;
  readonly latest_segment: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly latest_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly next_result_sequence: number;
  readonly protocol: "normalized_result_head_v2";
  readonly protocol_version: 2;
  readonly storage_epoch_id: LibraryCoreOperationInstanceId;
}

export type LibraryCoreNormalizedResultSegmentRecordV2 =
  | LibraryCoreNormalizedResultSegmentHeaderV2
  | LibraryCoreFollowerResultEnvelopeV1;

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
  return value as Record<string, unknown>;
}

function identifier(
  value: unknown,
  label: string,
): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nullableDigest(
  value: unknown,
  label: string,
): LibraryCoreLowercaseHex64 | null {
  return value === null ? null : digest(value, label);
}

const BODY_KEYS = [
  "actor_id",
  "canonical_result_bytes",
  "first_result_sequence",
  "format",
  "kind",
  "last_result_sequence",
  "library_id",
  "previous_segment_digest",
  "protocol",
  "protocol_version",
  "result_count",
  "results",
  "storage_epoch_id",
] as const;
const HEADER_KEYS = [
  ...BODY_KEYS.filter((key) => key !== "results"),
  "segment_digest",
] as const;
const HEAD_KEYS = [
  "actor_id",
  "latest_segment",
  "latest_segment_digest",
  "library_id",
  "next_result_sequence",
  "protocol",
  "protocol_version",
  "storage_epoch_id",
] as const;

function commonFields(
  input: Record<string, unknown>,
  label: string,
): LibraryCoreNormalizedResultSegmentCommonV2 {
  if (
    input.format !== LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_FORMAT ||
    input.protocol !== "normalized_result_segments_v2" ||
    input.protocol_version !== 2
  ) {
    throw new TypeError(`${label} uses an unsupported protocol`);
  }
  const first = positiveInteger(
    input.first_result_sequence,
    `${label} first result sequence`,
  );
  const last = positiveInteger(
    input.last_result_sequence,
    `${label} last result sequence`,
  );
  const count = positiveInteger(input.result_count, `${label} result count`);
  const bytes = positiveInteger(
    input.canonical_result_bytes,
    `${label} canonical result bytes`,
  );
  const previous = nullableDigest(
    input.previous_segment_digest,
    `${label} previous segment digest`,
  );
  if (
    last !== first + count - 1 ||
    count > LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_RECORD_LIMIT ||
    bytes > LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_CANONICAL_BYTE_LIMIT ||
    (first === 1) !== (previous === null)
  ) {
    throw new RangeError(`${label} sequence or byte bounds are invalid`);
  }
  return Object.freeze({
    actor_id: identifier(input.actor_id, `${label} actor`),
    canonical_result_bytes: bytes,
    first_result_sequence: first,
    format: LIBRARY_CORE_NORMALIZED_RESULT_SEGMENT_FORMAT,
    last_result_sequence: last,
    library_id: identifier(input.library_id, `${label} Library`),
    previous_segment_digest: previous,
    protocol: "normalized_result_segments_v2",
    protocol_version: 2,
    result_count: count,
    storage_epoch_id: identifier(
      input.storage_epoch_id,
      `${label} storage epoch`,
    ),
  });
}

export function parseLibraryCoreNormalizedResultSegmentBodyV2(
  value: unknown,
): LibraryCoreNormalizedResultSegmentBodyV2 {
  const input = closedRecord(value, BODY_KEYS, "normalized result body");
  if (
    input.kind !== "normalized_result_segment_body" ||
    !Array.isArray(input.results)
  ) {
    throw new TypeError("normalized result body is invalid");
  }
  const common = commonFields(input, "normalized result body");
  if (input.results.length !== common.result_count) {
    throw new TypeError("normalized result count changed");
  }
  const results = Object.freeze(
    input.results.map(parseLibraryCoreFollowerResultEnvelopeV1),
  );
  let previousResultDigest = results[0]?.previous_result_digest ?? null;
  let canonicalBytes = 0;
  for (const [index, result] of results.entries()) {
    if (
      result.actor_id !== common.actor_id ||
      result.library_id !== common.library_id ||
      result.epoch_id !== common.storage_epoch_id ||
      result.result_sequence !== common.first_result_sequence + index ||
      result.previous_result_digest !== previousResultDigest
    ) {
      throw new TypeError("normalized result records cross an identity boundary");
    }
    const bytes = encodeLibraryCoreCanonicalValue(
      result as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES },
    );
    canonicalBytes += bytes.byteLength;
    previousResultDigest = result.result_body_digest;
  }
  if (canonicalBytes !== common.canonical_result_bytes) {
    throw new TypeError("normalized result byte count changed");
  }
  return Object.freeze({
    ...common,
    kind: "normalized_result_segment_body",
    results,
  });
}

export function parseLibraryCoreNormalizedResultSegmentHeaderV2(
  value: unknown,
): LibraryCoreNormalizedResultSegmentHeaderV2 {
  const input = closedRecord(value, HEADER_KEYS, "normalized result header");
  if (input.kind !== "normalized_result_segment_header") {
    throw new TypeError("normalized result header kind is invalid");
  }
  return Object.freeze({
    ...commonFields(input, "normalized result header"),
    kind: "normalized_result_segment_header",
    segment_digest: digest(
      input.segment_digest,
      "normalized result segment digest",
    ),
  });
}

export function normalizedResultSegmentBodyFromRecordsV2(
  headerInput: LibraryCoreNormalizedResultSegmentHeaderV2,
  results: readonly LibraryCoreFollowerResultEnvelopeV1[],
): LibraryCoreNormalizedResultSegmentBodyV2 {
  const header = parseLibraryCoreNormalizedResultSegmentHeaderV2(headerInput);
  return parseLibraryCoreNormalizedResultSegmentBodyV2({
    actor_id: header.actor_id,
    canonical_result_bytes: header.canonical_result_bytes,
    first_result_sequence: header.first_result_sequence,
    format: header.format,
    kind: "normalized_result_segment_body",
    last_result_sequence: header.last_result_sequence,
    library_id: header.library_id,
    previous_segment_digest: header.previous_segment_digest,
    protocol: header.protocol,
    protocol_version: header.protocol_version,
    result_count: header.result_count,
    results,
    storage_epoch_id: header.storage_epoch_id,
  });
}

export function normalizedResultSegmentHeaderFromBodyV2(
  bodyInput: LibraryCoreNormalizedResultSegmentBodyV2,
  segmentDigest: unknown,
): LibraryCoreNormalizedResultSegmentHeaderV2 {
  const body = parseLibraryCoreNormalizedResultSegmentBodyV2(bodyInput);
  return parseLibraryCoreNormalizedResultSegmentHeaderV2({
    actor_id: body.actor_id,
    canonical_result_bytes: body.canonical_result_bytes,
    first_result_sequence: body.first_result_sequence,
    format: body.format,
    kind: "normalized_result_segment_header",
    last_result_sequence: body.last_result_sequence,
    library_id: body.library_id,
    previous_segment_digest: body.previous_segment_digest,
    protocol: body.protocol,
    protocol_version: body.protocol_version,
    result_count: body.result_count,
    segment_digest: segmentDigest,
    storage_epoch_id: body.storage_epoch_id,
  });
}

export function parseLibraryCoreNormalizedResultHeadV2(
  value: unknown,
): LibraryCoreNormalizedResultHeadV2 {
  const input = closedRecord(value, HEAD_KEYS, "normalized result head");
  if (
    input.protocol !== "normalized_result_head_v2" ||
    input.protocol_version !== 2
  ) {
    throw new TypeError("normalized result head protocol is invalid");
  }
  const actorId = identifier(input.actor_id, "normalized result head actor");
  const libraryId = identifier(
    input.library_id,
    "normalized result head Library",
  );
  const storageEpochId = identifier(
    input.storage_epoch_id,
    "normalized result head storage epoch",
  );
  const nextSequence = positiveInteger(
    input.next_result_sequence,
    "normalized next result sequence",
  );
  const latest =
    input.latest_segment === null
      ? null
      : parseLibraryCoreImmutableObjectReferenceV1(input.latest_segment);
  const latestDigest = nullableDigest(
    input.latest_segment_digest,
    "normalized result head digest",
  );
  if ((latest === null) !== (latestDigest === null)) {
    throw new TypeError("normalized result head segment identity is invalid");
  }
  if (latest !== null && latestDigest !== null) {
    const range = /~s([0-9]+)-([0-9]+)~/.exec(
      latest.descriptor.objectKey,
    );
    const firstSequence = Number(range?.[1] ?? Number.NaN);
    const lastSequence = Number(range?.[2] ?? Number.NaN);
    if (
      latest.descriptor.contentDigest !== latestDigest ||
      !isLibraryCoreNonnegativeSafeInteger(firstSequence) ||
      !isLibraryCoreNonnegativeSafeInteger(lastSequence) ||
      firstSequence < 1 ||
      lastSequence + 1 !== nextSequence ||
      latest.descriptor.objectKey !==
        createLibraryCoreImmutableObjectKey({
          actorId,
          digest: latestDigest,
          epochId: storageEpochId,
          firstSequence,
          kind: "result_segment",
          lastSequence,
          libraryId,
        })
    ) {
      throw new TypeError("normalized result head object identity is invalid");
    }
  } else if (nextSequence !== 1) {
    throw new TypeError("empty normalized result head must start at sequence 1");
  }
  return Object.freeze({
    actor_id: actorId,
    latest_segment: latest,
    latest_segment_digest: latestDigest,
    library_id: libraryId,
    next_result_sequence: nextSequence,
    protocol: "normalized_result_head_v2",
    protocol_version: 2,
    storage_epoch_id: storageEpochId,
  });
}

export function parseLibraryCoreNormalizedResultSegmentRecordV2(
  value: unknown,
): LibraryCoreNormalizedResultSegmentRecordV2 {
  return (value as { kind?: unknown } | null)?.kind ===
    "normalized_result_segment_header"
    ? parseLibraryCoreNormalizedResultSegmentHeaderV2(value)
    : parseLibraryCoreFollowerResultEnvelopeV1(value);
}

export function libraryCoreNormalizedResultSegmentRecordIdentityV2(
  record: LibraryCoreNormalizedResultSegmentRecordV2,
): string {
  return "kind" in record
    ? "header"
    : `result:${record.result_sequence.toLocaleString("en-US", {
        useGrouping: false,
      })}:${record.result_body_digest}`;
}
