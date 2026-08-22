import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreImmutableObjectReferenceV1,
} from "./immutable-transport-contracts.js";
import { LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES } from "./operation-envelope-finalization.js";
import { LIBRARY_CORE_OPERATION_REGISTRY } from "./operation-registry.js";
import {
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_FORMAT =
  "freed_normalized_intent_segment_v2" as const;
export const LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_RECORD_LIMIT = 128;
export const LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT =
  1_048_576;

export interface LibraryCoreNormalizedIntentEnvelopeRecordV2
  extends Readonly<Record<string, LibraryCoreCanonicalValue>> {
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly actor_sequence: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly operation_id: LibraryCoreOperationInstanceId;
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly previous_actor_operation_id: LibraryCoreOperationInstanceId | null;
  readonly schema_version: 1;
  readonly signature: LibraryCoreEd25519SignatureHex;
  readonly signature_algorithm: "ed25519";
  readonly transaction_digest: LibraryCoreLowercaseHex64;
  readonly transaction_id: LibraryCoreOperationInstanceId;
  readonly transaction_member_count: number;
  readonly transaction_member_index: number;
}

interface LibraryCoreNormalizedIntentSegmentCommonV2 {
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly canonical_envelope_bytes: number;
  readonly first_actor_counter: number;
  readonly format: typeof LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_FORMAT;
  readonly last_actor_counter: number;
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly previous_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly protocol: "normalized_intent_segments_v2";
  readonly protocol_version: 2;
  readonly record_count: number;
  readonly storage_epoch_id: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreNormalizedIntentSegmentBodyV2
  extends LibraryCoreNormalizedIntentSegmentCommonV2 {
  readonly envelopes: readonly LibraryCoreNormalizedIntentEnvelopeRecordV2[];
  readonly kind: "normalized_intent_segment_body";
}

export interface LibraryCoreNormalizedIntentSegmentHeaderV2
  extends LibraryCoreNormalizedIntentSegmentCommonV2 {
  readonly kind: "normalized_intent_segment_header";
  readonly segment_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreNormalizedIntentHeadV2 {
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly latest_segment: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly latest_segment_digest: LibraryCoreLowercaseHex64 | null;
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly next_actor_counter: number;
  readonly protocol: "normalized_intent_head_v2";
  readonly protocol_version: 2;
  readonly storage_epoch_id: LibraryCoreLowercaseHex64;
}

export type LibraryCoreNormalizedIntentSegmentRecordV2 =
  | LibraryCoreNormalizedIntentSegmentHeaderV2
  | LibraryCoreNormalizedIntentEnvelopeRecordV2;

const ENVELOPE_KEYS = [
  "operation_id",
  "library_id",
  "epoch",
  "epoch_id",
  "schema_version",
  "actor_id",
  "actor_sequence",
  "previous_actor_operation_id",
  "causal_frontier",
  "hlc_wall_ms",
  "hlc_counter",
  "transaction_id",
  "transaction_member_index",
  "transaction_member_count",
  "operation_type",
  "entity_type",
  "entity_id",
  "payload",
  "payload_digest",
  "blob_references",
  "created_at_ms",
  "signature_algorithm",
  "previous_actor_chain_digest",
  "actor_chain_digest",
  "transaction_digest",
  "signature",
] as const;
const BODY_KEYS = [
  "actor_id",
  "canonical_envelope_bytes",
  "envelopes",
  "first_actor_counter",
  "format",
  "kind",
  "last_actor_counter",
  "library_id",
  "previous_segment_digest",
  "protocol",
  "protocol_version",
  "record_count",
  "storage_epoch_id",
] as const;
const HEADER_KEYS = [
  ...BODY_KEYS.filter((key) => key !== "envelopes"),
  "segment_digest",
] as const;
const HEAD_KEYS = [
  "actor_id",
  "latest_segment",
  "latest_segment_digest",
  "library_id",
  "next_actor_counter",
  "protocol",
  "protocol_version",
  "storage_epoch_id",
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
  return value as Record<string, unknown>;
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

function operationId(
  value: unknown,
  label: string,
): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function parseLibraryCoreNormalizedIntentEnvelopeRecordV2(
  value: unknown,
): LibraryCoreNormalizedIntentEnvelopeRecordV2 {
  const input = closedRecord(value, ENVELOPE_KEYS, "normalized intent envelope");
  const actorSequence = positiveInteger(
    input.actor_sequence,
    "normalized intent actor sequence",
  );
  const previousOperation =
    input.previous_actor_operation_id === null
      ? null
      : operationId(
          input.previous_actor_operation_id,
          "normalized intent previous operation",
        );
  const memberCount = positiveInteger(
    input.transaction_member_count,
    "normalized intent transaction member count",
  );
  if (
    input.schema_version !== 1 ||
    input.signature_algorithm !== "ed25519" ||
    !isLibraryCoreEd25519SignatureHex(input.signature) ||
    !isLibraryCoreNonnegativeSafeInteger(input.transaction_member_index) ||
    input.transaction_member_index >= memberCount ||
    memberCount > 1_000 ||
    (actorSequence === 1) !== (previousOperation === null) ||
    typeof input.operation_type !== "string" ||
    !Object.hasOwn(LIBRARY_CORE_OPERATION_REGISTRY, input.operation_type)
  ) {
    throw new TypeError("normalized intent envelope scalar is invalid");
  }
  encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue, {
    maximumBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
  });
  return Object.freeze({
    ...(input as Record<string, LibraryCoreCanonicalValue>),
    actor_chain_digest: digest(
      input.actor_chain_digest,
      "normalized intent actor chain digest",
    ),
    actor_id: digest(input.actor_id, "normalized intent actor"),
    actor_sequence: actorSequence,
    epoch_id: digest(input.epoch_id, "normalized intent epoch"),
    library_id: digest(input.library_id, "normalized intent Library"),
    operation_id: operationId(
      input.operation_id,
      "normalized intent operation",
    ),
    previous_actor_chain_digest: digest(
      input.previous_actor_chain_digest,
      "normalized intent previous actor chain digest",
    ),
    previous_actor_operation_id: previousOperation,
    schema_version: 1,
    signature: input.signature,
    signature_algorithm: "ed25519",
    transaction_digest: digest(
      input.transaction_digest,
      "normalized intent transaction digest",
    ),
    transaction_id: operationId(
      input.transaction_id,
      "normalized intent transaction",
    ),
    transaction_member_count: memberCount,
    transaction_member_index: input.transaction_member_index,
  });
}

function commonFields(
  input: Record<string, unknown>,
  label: string,
): LibraryCoreNormalizedIntentSegmentCommonV2 {
  if (
    input.format !== LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_FORMAT ||
    input.protocol !== "normalized_intent_segments_v2" ||
    input.protocol_version !== 2
  ) {
    throw new TypeError(`${label} uses an unsupported protocol`);
  }
  const first = positiveInteger(
    input.first_actor_counter,
    `${label} first actor counter`,
  );
  const last = positiveInteger(
    input.last_actor_counter,
    `${label} last actor counter`,
  );
  const count = positiveInteger(input.record_count, `${label} record count`);
  const bytes = positiveInteger(
    input.canonical_envelope_bytes,
    `${label} canonical envelope bytes`,
  );
  const previous = nullableDigest(
    input.previous_segment_digest,
    `${label} previous segment digest`,
  );
  if (
    last !== first + count - 1 ||
    count > LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_RECORD_LIMIT ||
    bytes > LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT ||
    (first === 1) !== (previous === null)
  ) {
    throw new RangeError(`${label} sequence or byte bounds are invalid`);
  }
  return Object.freeze({
    actor_id: digest(input.actor_id, `${label} actor`),
    canonical_envelope_bytes: bytes,
    first_actor_counter: first,
    format: LIBRARY_CORE_NORMALIZED_INTENT_SEGMENT_FORMAT,
    last_actor_counter: last,
    library_id: digest(input.library_id, `${label} Library`),
    previous_segment_digest: previous,
    protocol: "normalized_intent_segments_v2",
    protocol_version: 2,
    record_count: count,
    storage_epoch_id: digest(input.storage_epoch_id, `${label} storage epoch`),
  });
}

export function parseLibraryCoreNormalizedIntentSegmentBodyV2(
  value: unknown,
): LibraryCoreNormalizedIntentSegmentBodyV2 {
  const input = closedRecord(value, BODY_KEYS, "normalized intent body");
  if (
    input.kind !== "normalized_intent_segment_body" ||
    !Array.isArray(input.envelopes)
  ) {
    throw new TypeError("normalized intent body is invalid");
  }
  const common = commonFields(input, "normalized intent body");
  if (input.envelopes.length !== common.record_count) {
    throw new TypeError("normalized intent count changed");
  }
  const envelopes = Object.freeze(
    input.envelopes.map(parseLibraryCoreNormalizedIntentEnvelopeRecordV2),
  );
  let canonicalBytes = 0;
  for (const [index, envelope] of envelopes.entries()) {
    if (
      envelope.actor_id !== common.actor_id ||
      envelope.library_id !== common.library_id ||
      envelope.epoch_id !== common.storage_epoch_id ||
      envelope.actor_sequence !== common.first_actor_counter + index
    ) {
      throw new TypeError("normalized intents cross an identity boundary");
    }
    if (index > 0) {
      const previous = envelopes[index - 1]!;
      if (
        envelope.previous_actor_operation_id !== previous.operation_id ||
        envelope.previous_actor_chain_digest !== previous.actor_chain_digest
      ) {
        throw new TypeError("normalized intent actor chain is not contiguous");
      }
      if (envelope.transaction_id === previous.transaction_id) {
        if (
          envelope.transaction_digest !== previous.transaction_digest ||
          envelope.transaction_member_count !==
            previous.transaction_member_count ||
          envelope.transaction_member_index !==
            previous.transaction_member_index + 1
        ) {
          throw new TypeError("normalized intent transaction slice changed");
        }
      } else if (
        previous.transaction_member_index !==
          previous.transaction_member_count - 1 ||
        envelope.transaction_member_index !== 0
      ) {
        throw new TypeError("normalized intent transaction boundary changed");
      }
    }
    canonicalBytes += encodeLibraryCoreCanonicalValue(
      envelope as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES },
    ).byteLength;
  }
  if (canonicalBytes !== common.canonical_envelope_bytes) {
    throw new TypeError("normalized intent byte count changed");
  }
  return Object.freeze({
    ...common,
    envelopes,
    kind: "normalized_intent_segment_body",
  });
}

export function parseLibraryCoreNormalizedIntentSegmentHeaderV2(
  value: unknown,
): LibraryCoreNormalizedIntentSegmentHeaderV2 {
  const input = closedRecord(value, HEADER_KEYS, "normalized intent header");
  if (input.kind !== "normalized_intent_segment_header") {
    throw new TypeError("normalized intent header kind is invalid");
  }
  return Object.freeze({
    ...commonFields(input, "normalized intent header"),
    kind: "normalized_intent_segment_header",
    segment_digest: digest(
      input.segment_digest,
      "normalized intent segment digest",
    ),
  });
}

export function normalizedIntentSegmentBodyFromRecordsV2(
  headerInput: LibraryCoreNormalizedIntentSegmentHeaderV2,
  envelopes: readonly LibraryCoreNormalizedIntentEnvelopeRecordV2[],
): LibraryCoreNormalizedIntentSegmentBodyV2 {
  const header = parseLibraryCoreNormalizedIntentSegmentHeaderV2(headerInput);
  return parseLibraryCoreNormalizedIntentSegmentBodyV2({
    actor_id: header.actor_id,
    canonical_envelope_bytes: header.canonical_envelope_bytes,
    envelopes,
    first_actor_counter: header.first_actor_counter,
    format: header.format,
    kind: "normalized_intent_segment_body",
    last_actor_counter: header.last_actor_counter,
    library_id: header.library_id,
    previous_segment_digest: header.previous_segment_digest,
    protocol: header.protocol,
    protocol_version: header.protocol_version,
    record_count: header.record_count,
    storage_epoch_id: header.storage_epoch_id,
  });
}

export function normalizedIntentSegmentHeaderFromBodyV2(
  bodyInput: LibraryCoreNormalizedIntentSegmentBodyV2,
  segmentDigest: unknown,
): LibraryCoreNormalizedIntentSegmentHeaderV2 {
  const body = parseLibraryCoreNormalizedIntentSegmentBodyV2(bodyInput);
  return parseLibraryCoreNormalizedIntentSegmentHeaderV2({
    actor_id: body.actor_id,
    canonical_envelope_bytes: body.canonical_envelope_bytes,
    first_actor_counter: body.first_actor_counter,
    format: body.format,
    kind: "normalized_intent_segment_header",
    last_actor_counter: body.last_actor_counter,
    library_id: body.library_id,
    previous_segment_digest: body.previous_segment_digest,
    protocol: body.protocol,
    protocol_version: body.protocol_version,
    record_count: body.record_count,
    segment_digest: segmentDigest,
    storage_epoch_id: body.storage_epoch_id,
  });
}

export function parseLibraryCoreNormalizedIntentHeadV2(
  value: unknown,
): LibraryCoreNormalizedIntentHeadV2 {
  const input = closedRecord(value, HEAD_KEYS, "normalized intent head");
  if (
    input.protocol !== "normalized_intent_head_v2" ||
    input.protocol_version !== 2
  ) {
    throw new TypeError("normalized intent head protocol is invalid");
  }
  const actorId = digest(input.actor_id, "normalized intent head actor");
  const libraryId = digest(input.library_id, "normalized intent head Library");
  const storageEpochId = digest(
    input.storage_epoch_id,
    "normalized intent head storage epoch",
  );
  const nextCounter = positiveInteger(
    input.next_actor_counter,
    "normalized intent head next actor counter",
  );
  const latest =
    input.latest_segment === null
      ? null
      : parseLibraryCoreImmutableObjectReferenceV1(input.latest_segment);
  const latestDigest = nullableDigest(
    input.latest_segment_digest,
    "normalized intent head digest",
  );
  if ((latest === null) !== (latestDigest === null)) {
    throw new TypeError("normalized intent head segment identity is invalid");
  }
  if (latest !== null && latestDigest !== null) {
    const range = /~s([0-9]+)-([0-9]+)~/.exec(
      latest.descriptor.objectKey,
    );
    const firstCounter = Number(range?.[1] ?? Number.NaN);
    const lastCounter = Number(range?.[2] ?? Number.NaN);
    if (
      latest.descriptor.contentDigest !== latestDigest ||
      !isLibraryCoreNonnegativeSafeInteger(firstCounter) ||
      !isLibraryCoreNonnegativeSafeInteger(lastCounter) ||
      firstCounter < 1 ||
      lastCounter + 1 !== nextCounter ||
      latest.descriptor.objectKey !==
        createLibraryCoreImmutableObjectKey({
          actorId,
          digest: latestDigest,
          epochId: storageEpochId,
          firstSequence: firstCounter,
          kind: "intent_segment",
          lastSequence: lastCounter,
          libraryId,
        })
    ) {
      throw new TypeError("normalized intent head object identity is invalid");
    }
  } else if (nextCounter !== 1) {
    throw new TypeError("empty normalized intent head must start at counter 1");
  }
  return Object.freeze({
    actor_id: actorId,
    latest_segment: latest,
    latest_segment_digest: latestDigest,
    library_id: libraryId,
    next_actor_counter: nextCounter,
    protocol: "normalized_intent_head_v2",
    protocol_version: 2,
    storage_epoch_id: storageEpochId,
  });
}

export function parseLibraryCoreNormalizedIntentSegmentRecordV2(
  value: unknown,
): LibraryCoreNormalizedIntentSegmentRecordV2 {
  return (value as { kind?: unknown } | null)?.kind ===
    "normalized_intent_segment_header"
    ? parseLibraryCoreNormalizedIntentSegmentHeaderV2(value)
    : parseLibraryCoreNormalizedIntentEnvelopeRecordV2(value);
}

export function libraryCoreNormalizedIntentSegmentRecordIdentityV2(
  record: LibraryCoreNormalizedIntentSegmentRecordV2,
): string {
  return "kind" in record
    ? "header"
    : `intent:${record.actor_sequence.toLocaleString("en-US", {
        useGrouping: false,
      })}:${record.operation_id}`;
}
