import {
  decodeLibraryCoreCanonicalValue,
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

export const LIBRARY_CORE_PORTABLE_CHECKPOINT_FORMAT =
  "freed_logical_checkpoint_v1" as const;
export const LIBRARY_CORE_PORTABLE_CHECKPOINT_RECORD_LIMIT = 1_048_576;
export const LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS = [
  "accepted_frontier",
  "quarantined_frontier",
  "materialized_rows",
  "field_clocks",
  "relationships",
  "tombstones",
  "actor_states",
  "receipt_records",
  "blob_roots",
  "excluded_registry_keys",
] as const;

export type LibraryCorePortableCheckpointCollection =
  (typeof LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS)[number];

export interface LibraryCorePortableCheckpointCollectionCountsV1 {
  readonly accepted_frontier: number;
  readonly quarantined_frontier: number;
  readonly materialized_rows: number;
  readonly field_clocks: number;
  readonly relationships: number;
  readonly tombstones: number;
  readonly actor_states: number;
  readonly receipt_records: number;
  readonly blob_roots: number;
  readonly excluded_registry_keys: number;
}

export interface LibraryCorePortableCheckpointHeaderV1 {
  readonly kind: "logical_checkpoint_header";
  readonly format: typeof LIBRARY_CORE_PORTABLE_CHECKPOINT_FORMAT;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly schema_version: number;
  readonly field_registry_version: number;
  readonly canonical_codec_version: number;
  readonly anchor_kind: "accepted_authority" | "transition_candidate";
  readonly source_transition_digest: LibraryCoreLowercaseHex64 | null;
  readonly source_manifest_digest: LibraryCoreLowercaseHex64 | null;
  readonly transition_candidate_anchor: Readonly<
    Record<string, LibraryCoreCanonicalValue>
  > | null;
  readonly promoted_receipt_digests: readonly LibraryCoreLowercaseHex64[];
  readonly materializer_position: Readonly<{
    readonly frontier_digest: LibraryCoreLowercaseHex64;
    readonly ingest_sequence: number;
    readonly materialized_digest: LibraryCoreLowercaseHex64;
  }>;
  readonly collection_counts: LibraryCorePortableCheckpointCollectionCountsV1;
}

export interface LibraryCorePortableCheckpointEntryV1 {
  readonly kind: "logical_checkpoint_entry";
  readonly collection: LibraryCorePortableCheckpointCollection;
  readonly ordinal: number;
  readonly value: LibraryCoreCanonicalValue;
}

export type LibraryCorePortableCheckpointRecordV1 =
  LibraryCorePortableCheckpointHeaderV1 | LibraryCorePortableCheckpointEntryV1;

const HEADER_KEYS = [
  "anchor_kind",
  "canonical_codec_version",
  "collection_counts",
  "epoch",
  "epoch_id",
  "field_registry_version",
  "format",
  "kind",
  "library_id",
  "materializer_position",
  "promoted_receipt_digests",
  "schema_version",
  "source_manifest_digest",
  "source_transition_digest",
  "transition_candidate_anchor",
] as const;
const ENTRY_KEYS = ["collection", "kind", "ordinal", "value"] as const;
const MATERIALIZED_ROW_KEYS = ["primary_key", "registry_key", "row"] as const;
const FIELD_CLOCK_KEYS = [
  "actor_id",
  "entity_generation",
  "field_path",
  "hlc_counter",
  "hlc_wall_ms",
  "operation_id",
  "primary_key",
  "registry_key",
] as const;
const RELATIONSHIP_KEYS = [
  "actor_id",
  "entity_generation",
  "hlc_counter",
  "hlc_wall_ms",
  "left_primary_key",
  "left_registry_key",
  "operation_id",
  "relationship_type",
  "right_primary_key",
  "right_registry_key",
  "tombstoned",
] as const;
const TOMBSTONE_KEYS = [
  "actor_id",
  "entity_generation",
  "hlc_counter",
  "hlc_wall_ms",
  "operation_id",
  "primary_key",
  "registry_key",
] as const;
const ACTOR_STATE_KEYS = [
  "accepted_chain_digest",
  "accepted_operation_id",
  "accepted_sequence",
  "actor_id",
  "enrollment_certificate_digest",
  "retired",
  "retirement_certificate_digest",
] as const;
const RECEIPT_KEYS = [
  "authorization",
  "receipt_body",
  "receipt_digest",
  "receipt_id",
  "receipt_kind",
] as const;
const FRONTIER_KEYS = [
  "actor_id",
  "chain_digest",
  "operation_id",
  "sequence",
] as const;
const BLOB_ROOT_KEYS = [
  "byte_length",
  "content_digest",
  "field_path",
  "media_type",
  "primary_key",
  "registry_key",
] as const;
const MATERIALIZER_KEYS = [
  "frontier_digest",
  "ingest_sequence",
  "materialized_digest",
] as const;
const textEncoder = new TextEncoder();

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
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        `${label}.${key} must be an enumerable data property`,
      );
    }
  }
  return value as Record<string, unknown>;
}

function denseArray(
  value: unknown,
  label: string,
  maximumItems: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new RangeError(
      `${label} must be an array of no more than ${maximumItems.toLocaleString()} entries`,
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
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} entries must be enumerable data values`);
    }
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function boundedText(
  value: unknown,
  label: string,
  maximumBytes = 4_096,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > maximumBytes
  ) {
    throw new TypeError(`${label} must be bounded nonempty text`);
  }
  return value;
}

function asciiRegistryKey(value: unknown, label: string): string {
  const text = boundedText(value, label, 512);
  if (!/^[\x21-\x7e]+$/.test(text)) {
    throw new TypeError(`${label} must contain printable ASCII only`);
  }
  return text;
}

function digest(value: unknown, label: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function optionalDigest(
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
    throw new TypeError(`${label} must be a bounded Library Core identifier`);
  }
  return value;
}

function canonicalSnapshot(
  value: unknown,
  label: string,
): LibraryCoreCanonicalValue {
  try {
    const encoded = encodeLibraryCoreCanonicalValue(
      value as LibraryCoreCanonicalValue,
    );
    return decodeLibraryCoreCanonicalValue(encoded);
  } catch (error) {
    throw new TypeError(
      `${label} must be a bounded canonical value: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function canonicalRecordSnapshot(
  value: unknown,
  label: string,
): Readonly<Record<string, LibraryCoreCanonicalValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a canonical record`);
  }
  return canonicalSnapshot(value, label) as Readonly<
    Record<string, LibraryCoreCanonicalValue>
  >;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function compareCanonical(
  left: LibraryCoreCanonicalValue,
  right: LibraryCoreCanonicalValue,
): number {
  return compareBytes(
    encodeLibraryCoreCanonicalValue(left),
    encodeLibraryCoreCanonicalValue(right),
  );
}

function parseCounts(
  value: unknown,
): LibraryCorePortableCheckpointCollectionCountsV1 {
  const record = closedRecord(
    value,
    LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS,
    "portable checkpoint collection_counts",
  );
  let total = 1;
  const counts = {} as Record<LibraryCorePortableCheckpointCollection, number>;
  for (const collection of LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS) {
    const count = safeInteger(
      record[collection],
      `portable checkpoint collection_counts.${collection}`,
    );
    total += count;
    if (total > LIBRARY_CORE_PORTABLE_CHECKPOINT_RECORD_LIMIT) {
      throw new RangeError(
        `portable checkpoint exceeds ${LIBRARY_CORE_PORTABLE_CHECKPOINT_RECORD_LIMIT.toLocaleString()} records`,
      );
    }
    counts[collection] = count;
  }
  return Object.freeze(
    counts,
  ) as unknown as LibraryCorePortableCheckpointCollectionCountsV1;
}

function parseHeader(value: unknown): LibraryCorePortableCheckpointHeaderV1 {
  const record = closedRecord(value, HEADER_KEYS, "portable checkpoint header");
  if (
    record.kind !== "logical_checkpoint_header" ||
    record.format !== LIBRARY_CORE_PORTABLE_CHECKPOINT_FORMAT
  ) {
    throw new TypeError(
      "portable checkpoint header uses an unsupported format",
    );
  }
  if (
    record.anchor_kind !== "accepted_authority" &&
    record.anchor_kind !== "transition_candidate"
  ) {
    throw new TypeError("portable checkpoint anchor_kind is unsupported");
  }
  const sourceTransitionDigest = optionalDigest(
    record.source_transition_digest,
    "portable checkpoint source_transition_digest",
  );
  const sourceManifestDigest = optionalDigest(
    record.source_manifest_digest,
    "portable checkpoint source_manifest_digest",
  );
  const transitionCandidateAnchor =
    record.transition_candidate_anchor === null
      ? null
      : canonicalRecordSnapshot(
          record.transition_candidate_anchor,
          "portable checkpoint transition_candidate_anchor",
        );
  if (
    record.anchor_kind === "accepted_authority"
      ? sourceTransitionDigest === null ||
        sourceManifestDigest === null ||
        transitionCandidateAnchor !== null
      : sourceTransitionDigest !== null ||
        sourceManifestDigest !== null ||
        transitionCandidateAnchor === null
  ) {
    throw new TypeError(
      "portable checkpoint anchor fields do not match anchor_kind",
    );
  }
  const promotedReceiptValues = denseArray(
    record.promoted_receipt_digests,
    "portable checkpoint promoted_receipt_digests",
    LIBRARY_CORE_PORTABLE_CHECKPOINT_RECORD_LIMIT,
  );
  const promotedReceiptDigests = promotedReceiptValues.map((value, index) =>
    digest(
      value,
      `portable checkpoint promoted_receipt_digests[${index.toLocaleString()}]`,
    ),
  );
  for (let index = 1; index < promotedReceiptDigests.length; index += 1) {
    if (promotedReceiptDigests[index - 1]! >= promotedReceiptDigests[index]!) {
      throw new TypeError(
        "portable checkpoint promoted_receipt_digests must be unique and sorted",
      );
    }
  }
  if (
    record.anchor_kind === "transition_candidate" &&
    promotedReceiptDigests.length !== 0
  ) {
    throw new TypeError(
      "transition candidate checkpoints cannot promote receipts",
    );
  }
  const materializer = closedRecord(
    record.materializer_position,
    MATERIALIZER_KEYS,
    "portable checkpoint materializer_position",
  );
  return Object.freeze({
    anchor_kind: record.anchor_kind,
    canonical_codec_version: safeInteger(
      record.canonical_codec_version,
      "portable checkpoint canonical_codec_version",
    ),
    collection_counts: parseCounts(record.collection_counts),
    epoch: safeInteger(record.epoch, "portable checkpoint epoch"),
    epoch_id: operationId(record.epoch_id, "portable checkpoint epoch_id"),
    field_registry_version: safeInteger(
      record.field_registry_version,
      "portable checkpoint field_registry_version",
    ),
    format: LIBRARY_CORE_PORTABLE_CHECKPOINT_FORMAT,
    kind: "logical_checkpoint_header",
    library_id: operationId(
      record.library_id,
      "portable checkpoint library_id",
    ),
    materializer_position: Object.freeze({
      frontier_digest: digest(
        materializer.frontier_digest,
        "portable checkpoint materializer frontier_digest",
      ),
      ingest_sequence: safeInteger(
        materializer.ingest_sequence,
        "portable checkpoint materializer ingest_sequence",
      ),
      materialized_digest: digest(
        materializer.materialized_digest,
        "portable checkpoint materializer materialized_digest",
      ),
    }),
    promoted_receipt_digests: Object.freeze(promotedReceiptDigests),
    schema_version: safeInteger(
      record.schema_version,
      "portable checkpoint schema_version",
    ),
    source_manifest_digest: sourceManifestDigest,
    source_transition_digest: sourceTransitionDigest,
    transition_candidate_anchor: transitionCandidateAnchor,
  });
}

function parseMaterializedRow(value: unknown): LibraryCoreCanonicalValue {
  const record = closedRecord(
    value,
    MATERIALIZED_ROW_KEYS,
    "portable checkpoint materialized row",
  );
  return Object.freeze({
    primary_key: canonicalSnapshot(
      record.primary_key,
      "portable checkpoint materialized row primary_key",
    ),
    registry_key: asciiRegistryKey(
      record.registry_key,
      "portable checkpoint materialized row registry_key",
    ),
    row: canonicalRecordSnapshot(
      record.row,
      "portable checkpoint materialized row body",
    ),
  });
}

function parseClockLike(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, LibraryCoreCanonicalValue> {
  const record = closedRecord(value, expectedKeys, label);
  return {
    actor_id: digest(record.actor_id, `${label}.actor_id`),
    entity_generation: safeInteger(
      record.entity_generation,
      `${label}.entity_generation`,
    ),
    hlc_counter: safeInteger(record.hlc_counter, `${label}.hlc_counter`),
    hlc_wall_ms: safeInteger(record.hlc_wall_ms, `${label}.hlc_wall_ms`),
    operation_id: operationId(record.operation_id, `${label}.operation_id`),
    primary_key: canonicalSnapshot(record.primary_key, `${label}.primary_key`),
    registry_key: asciiRegistryKey(
      record.registry_key,
      `${label}.registry_key`,
    ),
  };
}

function parseFieldClock(value: unknown): LibraryCoreCanonicalValue {
  const record = closedRecord(
    value,
    FIELD_CLOCK_KEYS,
    "portable checkpoint field clock",
  );
  return Object.freeze({
    ...parseClockLike(
      record,
      FIELD_CLOCK_KEYS,
      "portable checkpoint field clock",
    ),
    field_path: boundedText(
      record.field_path,
      "portable checkpoint field clock field_path",
    ),
  });
}

function parseRelationship(value: unknown): LibraryCoreCanonicalValue {
  const label = "portable checkpoint relationship";
  const record = closedRecord(value, RELATIONSHIP_KEYS, label);
  if (typeof record.tombstoned !== "boolean") {
    throw new TypeError(`${label}.tombstoned must be boolean`);
  }
  return Object.freeze({
    actor_id: digest(record.actor_id, `${label}.actor_id`),
    entity_generation: safeInteger(
      record.entity_generation,
      `${label}.entity_generation`,
    ),
    hlc_counter: safeInteger(record.hlc_counter, `${label}.hlc_counter`),
    hlc_wall_ms: safeInteger(record.hlc_wall_ms, `${label}.hlc_wall_ms`),
    left_primary_key: canonicalSnapshot(
      record.left_primary_key,
      `${label}.left_primary_key`,
    ),
    left_registry_key: asciiRegistryKey(
      record.left_registry_key,
      `${label}.left_registry_key`,
    ),
    operation_id: operationId(record.operation_id, `${label}.operation_id`),
    relationship_type: asciiRegistryKey(
      record.relationship_type,
      `${label}.relationship_type`,
    ),
    right_primary_key: canonicalSnapshot(
      record.right_primary_key,
      `${label}.right_primary_key`,
    ),
    right_registry_key: asciiRegistryKey(
      record.right_registry_key,
      `${label}.right_registry_key`,
    ),
    tombstoned: record.tombstoned,
  });
}

function parseTombstone(value: unknown): LibraryCoreCanonicalValue {
  return Object.freeze(
    parseClockLike(value, TOMBSTONE_KEYS, "portable checkpoint tombstone"),
  );
}

function parseActorState(value: unknown): LibraryCoreCanonicalValue {
  const label = "portable checkpoint actor state";
  const record = closedRecord(value, ACTOR_STATE_KEYS, label);
  if (typeof record.retired !== "boolean") {
    throw new TypeError(`${label}.retired must be boolean`);
  }
  const acceptedSequence = safeInteger(
    record.accepted_sequence,
    `${label}.accepted_sequence`,
  );
  const acceptedOperationId =
    record.accepted_operation_id === null
      ? null
      : operationId(
          record.accepted_operation_id,
          `${label}.accepted_operation_id`,
        );
  const retirementCertificateDigest = optionalDigest(
    record.retirement_certificate_digest,
    `${label}.retirement_certificate_digest`,
  );
  if (
    (acceptedSequence === 0) !== (acceptedOperationId === null) ||
    record.retired !== (retirementCertificateDigest !== null)
  ) {
    throw new TypeError(`${label} has inconsistent nullable fields`);
  }
  return Object.freeze({
    accepted_chain_digest: digest(
      record.accepted_chain_digest,
      `${label}.accepted_chain_digest`,
    ),
    accepted_operation_id: acceptedOperationId,
    accepted_sequence: acceptedSequence,
    actor_id: digest(record.actor_id, `${label}.actor_id`),
    enrollment_certificate_digest: digest(
      record.enrollment_certificate_digest,
      `${label}.enrollment_certificate_digest`,
    ),
    retired: record.retired,
    retirement_certificate_digest: retirementCertificateDigest,
  });
}

function parseReceipt(value: unknown): LibraryCoreCanonicalValue {
  const label = "portable checkpoint receipt record";
  const record = closedRecord(value, RECEIPT_KEYS, label);
  return Object.freeze({
    authorization: canonicalRecordSnapshot(
      record.authorization,
      `${label}.authorization`,
    ),
    receipt_body: canonicalRecordSnapshot(
      record.receipt_body,
      `${label}.receipt_body`,
    ),
    receipt_digest: digest(record.receipt_digest, `${label}.receipt_digest`),
    receipt_id: operationId(record.receipt_id, `${label}.receipt_id`),
    receipt_kind: asciiRegistryKey(
      record.receipt_kind,
      `${label}.receipt_kind`,
    ),
  });
}

function parseFrontier(value: unknown): LibraryCoreCanonicalValue {
  const label = "portable checkpoint frontier tip";
  const record = closedRecord(value, FRONTIER_KEYS, label);
  const sequence = safeInteger(record.sequence, `${label}.sequence`);
  if (sequence === 0) {
    throw new TypeError(`${label}.sequence must be positive`);
  }
  return Object.freeze({
    actor_id: digest(record.actor_id, `${label}.actor_id`),
    chain_digest: digest(record.chain_digest, `${label}.chain_digest`),
    operation_id: operationId(record.operation_id, `${label}.operation_id`),
    sequence,
  });
}

function parseBlobRoot(value: unknown): LibraryCoreCanonicalValue {
  const label = "portable checkpoint blob root";
  const record = closedRecord(value, BLOB_ROOT_KEYS, label);
  return Object.freeze({
    byte_length: safeInteger(record.byte_length, `${label}.byte_length`),
    content_digest: digest(record.content_digest, `${label}.content_digest`),
    field_path: boundedText(record.field_path, `${label}.field_path`),
    media_type: boundedText(record.media_type, `${label}.media_type`, 256),
    primary_key: canonicalSnapshot(record.primary_key, `${label}.primary_key`),
    registry_key: asciiRegistryKey(
      record.registry_key,
      `${label}.registry_key`,
    ),
  });
}

function parseEntryValue(
  collection: LibraryCorePortableCheckpointCollection,
  value: unknown,
): LibraryCoreCanonicalValue {
  switch (collection) {
    case "accepted_frontier":
    case "quarantined_frontier":
      return parseFrontier(value);
    case "materialized_rows":
      return parseMaterializedRow(value);
    case "field_clocks":
      return parseFieldClock(value);
    case "relationships":
      return parseRelationship(value);
    case "tombstones":
      return parseTombstone(value);
    case "actor_states":
      return parseActorState(value);
    case "receipt_records":
      return parseReceipt(value);
    case "blob_roots":
      return parseBlobRoot(value);
    case "excluded_registry_keys":
      return asciiRegistryKey(
        value,
        "portable checkpoint excluded registry key",
      );
  }
}

function parseEntry(value: unknown): LibraryCorePortableCheckpointEntryV1 {
  const record = closedRecord(value, ENTRY_KEYS, "portable checkpoint entry");
  if (
    record.kind !== "logical_checkpoint_entry" ||
    typeof record.collection !== "string" ||
    !LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.includes(
      record.collection as LibraryCorePortableCheckpointCollection,
    )
  ) {
    throw new TypeError("portable checkpoint entry has an unsupported kind");
  }
  const ordinal = safeInteger(
    record.ordinal,
    "portable checkpoint entry ordinal",
  );
  if (ordinal >= LIBRARY_CORE_PORTABLE_CHECKPOINT_RECORD_LIMIT) {
    throw new RangeError("portable checkpoint entry ordinal exceeds its limit");
  }
  const collection =
    record.collection as LibraryCorePortableCheckpointCollection;
  return Object.freeze({
    collection,
    kind: "logical_checkpoint_entry",
    ordinal,
    value: parseEntryValue(collection, record.value),
  });
}

export function parseLibraryCorePortableCheckpointRecordV1(
  value: unknown,
): LibraryCorePortableCheckpointRecordV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("portable checkpoint record must be a closed record");
  }
  const kind = (value as { readonly kind?: unknown }).kind;
  if (kind === "logical_checkpoint_header") return parseHeader(value);
  if (kind === "logical_checkpoint_entry") return parseEntry(value);
  throw new TypeError("portable checkpoint record has an unsupported kind");
}

export function libraryCorePortableCheckpointRecordIdentityV1(
  record: LibraryCorePortableCheckpointRecordV1,
): string {
  if (record.kind === "logical_checkpoint_header") return "00:header";
  const collectionIndex =
    LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.indexOf(record.collection) + 1;
  return `${String(collectionIndex).padStart(2, "0")}:${record.ordinal
    .toString()
    .padStart(7, "0")}`;
}

function orderingValue(
  entry: LibraryCorePortableCheckpointEntryV1,
): LibraryCoreCanonicalValue {
  const value = entry.value;
  if (typeof value === "string") return value;
  const record = value as Readonly<Record<string, LibraryCoreCanonicalValue>>;
  switch (entry.collection) {
    case "accepted_frontier":
    case "quarantined_frontier":
      return [
        record.actor_id!,
        record.sequence!,
        record.operation_id!,
        record.chain_digest!,
      ];
    case "materialized_rows":
    case "tombstones":
      return [record.registry_key!, record.primary_key!];
    case "field_clocks":
      return [record.registry_key!, record.primary_key!, record.field_path!];
    case "relationships":
      return [
        record.relationship_type!,
        record.left_registry_key!,
        record.left_primary_key!,
        record.right_registry_key!,
        record.right_primary_key!,
      ];
    case "actor_states":
      return record.actor_id!;
    case "receipt_records":
      return [record.receipt_kind!, record.receipt_id!, record.receipt_digest!];
    case "blob_roots":
      return [
        record.content_digest!,
        record.registry_key!,
        record.primary_key!,
        record.field_path!,
      ];
    case "excluded_registry_keys":
      return value;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(
  left: LibraryCorePortableCheckpointEntryV1,
  right: LibraryCorePortableCheckpointEntryV1,
): number {
  if (
    left.collection === "accepted_frontier" ||
    left.collection === "quarantined_frontier"
  ) {
    const leftValue = left.value as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    const rightValue = right.value as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    return (
      compareText(
        leftValue.actor_id as string,
        rightValue.actor_id as string,
      ) ||
      (leftValue.sequence as number) - (rightValue.sequence as number) ||
      compareText(
        leftValue.operation_id as string,
        rightValue.operation_id as string,
      ) ||
      compareText(
        leftValue.chain_digest as string,
        rightValue.chain_digest as string,
      )
    );
  }
  return compareCanonical(orderingValue(left), orderingValue(right));
}

export interface LibraryCorePortableCheckpointVerificationV1 {
  readonly header: LibraryCorePortableCheckpointHeaderV1;
  readonly recordCount: number;
}

/**
 * Verify one portable checkpoint record stream without retaining its corpus.
 *
 * A receiving SQLite or IndexedDB adapter may stage each accepted record
 * immediately. Final selection remains forbidden until finish() proves every
 * declared collection count and deterministic order.
 */
export class LibraryCorePortableCheckpointStreamVerifierV1 {
  private header: LibraryCorePortableCheckpointHeaderV1 | null = null;
  private recordCount = 0;
  private collectionIndex = 0;
  private collectionOrdinal = 0;
  private previousEntry: LibraryCorePortableCheckpointEntryV1 | null = null;
  private finished = false;

  accept(input: unknown): LibraryCorePortableCheckpointRecordV1 {
    if (this.finished) {
      throw new Error("portable checkpoint verifier is already finished");
    }
    const record = parseLibraryCorePortableCheckpointRecordV1(input);
    if (this.recordCount === 0) {
      if (record.kind !== "logical_checkpoint_header") {
        throw new TypeError("portable checkpoint must begin with its header");
      }
      this.header = record;
      this.recordCount = 1;
      this.skipEmptyCollections();
      return record;
    }
    if (record.kind !== "logical_checkpoint_entry" || this.header === null) {
      throw new TypeError("portable checkpoint may contain only one header");
    }
    const expectedCollection =
      LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS[this.collectionIndex];
    if (
      expectedCollection === undefined ||
      record.collection !== expectedCollection ||
      record.ordinal !== this.collectionOrdinal
    ) {
      throw new TypeError(
        "portable checkpoint entries must follow declared collection order and contiguous ordinals",
      );
    }
    if (
      this.previousEntry !== null &&
      compareEntries(this.previousEntry, record) >= 0
    ) {
      throw new TypeError(
        `portable checkpoint ${record.collection} entries must be strictly sorted`,
      );
    }
    this.previousEntry = record;
    this.collectionOrdinal += 1;
    this.recordCount += 1;
    if (
      this.collectionOrdinal ===
      this.header.collection_counts[record.collection]
    ) {
      this.collectionIndex += 1;
      this.collectionOrdinal = 0;
      this.previousEntry = null;
      this.skipEmptyCollections();
    }
    return record;
  }

  finish(): LibraryCorePortableCheckpointVerificationV1 {
    if (this.finished) {
      throw new Error("portable checkpoint verifier is already finished");
    }
    this.finished = true;
    if (
      this.header === null ||
      this.collectionIndex !==
        LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.length
    ) {
      throw new TypeError(
        "portable checkpoint ended before every declared record",
      );
    }
    return Object.freeze({
      header: this.header,
      recordCount: this.recordCount,
    });
  }

  private skipEmptyCollections(): void {
    while (
      this.header !== null &&
      this.collectionIndex <
        LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.length &&
      this.header.collection_counts[
        LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS[this.collectionIndex]!
      ] === 0
    ) {
      this.collectionIndex += 1;
    }
  }
}
