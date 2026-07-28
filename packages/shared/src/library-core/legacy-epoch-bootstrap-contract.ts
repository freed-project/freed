/**
 * Pure, runtime-neutral contract for the one-time legacy epoch bootstrap.
 *
 * The synchronized bootstrap record names an epoch and an immutable Automerge
 * source frontier. It is not owner authority. A current legacy writer can
 * create synchronized values, so another installation may use the record only
 * as TOFU read-only state until a separate authenticated pairing completes.
 *
 * This module validates closed values and classifies durable readback state.
 * It does not generate identities, authorize an owner action, read storage,
 * write storage, activate Library Core, or perform platform cryptography.
 */

declare const lowercaseHex64Brand: unique symbol;
declare const operationIdBrand: unique symbol;

export type LibraryCoreLowercaseHex64 = string & {
  readonly [lowercaseHex64Brand]: true;
};

export type LegacyEpochBootstrapOperationId = string & {
  readonly [operationIdBrand]: true;
};

export const LEGACY_EPOCH_BOOTSTRAP_MAX_HEADS = 65;
export const LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES = 65;
export const LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX =
  "libraryCoreLegacyBootstrapRecord:";

export const LEGACY_EPOCH_BOOTSTRAP_DOMAINS = Object.freeze({
  automergeHeads: "automerge-heads",
  record: "legacy-epoch-bootstrap-record",
  control: "legacy-library-control",
  preparedOperation: "legacy-epoch-bootstrap-prepared",
  receipt: "legacy-epoch-bootstrap-receipt",
} as const);

export type LegacyEpochBootstrapDigestDomain =
  (typeof LEGACY_EPOCH_BOOTSTRAP_DOMAINS)[keyof typeof LEGACY_EPOCH_BOOTSTRAP_DOMAINS];

export interface LegacyEpochBootstrapVerificationDependencies {
  /**
   * Computes D(domain, value) with the Library Core canonical codec.
   */
  readonly digest: (
    domain: LegacyEpochBootstrapDigestDomain,
    value: Readonly<Record<string, unknown>>,
  ) => string;
  /**
   * Proves ancestry through the immutable Automerge change graph.
   * Comparing only head arrays does not establish reachability.
   */
  readonly isAutomergeFrontierReachable: (input: {
    readonly ancestorHeads: readonly LibraryCoreLowercaseHex64[];
    readonly descendantHeads: readonly LibraryCoreLowercaseHex64[];
  }) => boolean;
}

export type LegacyAutomergeSchemaVersion = 0 | 1;

export interface LegacyAutomergeHeadsBody {
  readonly heads: readonly LibraryCoreLowercaseHex64[];
}

export interface LegacyEpochBootstrapRecordBodyV1 {
  readonly format: "freed_legacy_epoch_bootstrap_record_v1";
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly creator_installation_id: LibraryCoreLowercaseHex64;
  readonly active_epoch: 1;
  readonly active_epoch_id: LibraryCoreLowercaseHex64;
  readonly active_engine: "automerge_legacy";
  readonly schema_version: LegacyAutomergeSchemaVersion;
  readonly replication_protocol: "automerge_blob_v1";
  readonly source_heads_body: LegacyAutomergeHeadsBody;
  readonly source_heads_digest: LibraryCoreLowercaseHex64;
  readonly bootstrap_operation_id: LegacyEpochBootstrapOperationId;
  readonly trust_model: "tofu_read_only_until_authenticated_pairing";
  readonly migration_claim_pointer: null;
}

export interface LegacyEpochBootstrapRecordV1 {
  readonly record_body: LegacyEpochBootstrapRecordBodyV1;
  readonly record_digest: LibraryCoreLowercaseHex64;
}

export interface LegacyEpochBootstrapRecordOccurrence {
  readonly root_key: string;
  readonly conflict_value: LegacyEpochBootstrapRecordV1;
}

export interface LegacyEpochBootstrapRecordScanV1 {
  readonly format: "freed_legacy_epoch_bootstrap_scan_v1";
  readonly scan_complete: boolean;
  readonly history_scan_complete: boolean;
  readonly overflow: boolean;
  readonly reserved_root_key_count: number;
  readonly occurrence_count: number;
  readonly occurrences: readonly LegacyEpochBootstrapRecordOccurrence[];
  readonly historical_root_key_count: number;
  readonly historical_root_keys: readonly string[];
}

export type LegacyLibraryControlAccess =
  "creator_local_owner_confirmed" | "adopter_tofu_read_only";

export interface LegacyLibraryControlV1 {
  readonly format: "freed_library_control_v1";
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly installation_id: LibraryCoreLowercaseHex64;
  readonly active_epoch: 1;
  readonly active_epoch_id: LibraryCoreLowercaseHex64;
  readonly active_engine: "automerge_legacy";
  readonly schema_version: LegacyAutomergeSchemaVersion;
  readonly replication_protocol: "automerge_blob_v1";
  readonly frontier_digest: LibraryCoreLowercaseHex64;
  readonly bootstrap_record_digest: LibraryCoreLowercaseHex64;
  readonly updated_by_operation_id: LegacyEpochBootstrapOperationId;
  readonly migration_claim_pointer: null;
  readonly storage_generation: number;
  readonly local_access: LegacyLibraryControlAccess;
}

export interface LegacyEpochBootstrapPreparedBodyV1 {
  readonly format: "freed_legacy_epoch_bootstrap_prepared_v1";
  readonly phase: "prepared";
  readonly bootstrap_operation_id: LegacyEpochBootstrapOperationId;
  readonly creator_installation_id: LibraryCoreLowercaseHex64;
  readonly source_storage_generation: number;
  readonly target_storage_generation: number;
  readonly source_save_revision: number;
  readonly candidate_save_revision: number;
  readonly source_binary_digest: LibraryCoreLowercaseHex64;
  readonly candidate_binary_digest: LibraryCoreLowercaseHex64;
  readonly source_heads_digest: LibraryCoreLowercaseHex64;
  readonly candidate_heads_body: LegacyAutomergeHeadsBody;
  readonly candidate_heads_digest: LibraryCoreLowercaseHex64;
  readonly record: LegacyEpochBootstrapRecordV1;
  readonly record_digest: LibraryCoreLowercaseHex64;
  readonly record_root_key: string;
  readonly candidate_control: LegacyLibraryControlV1;
  readonly candidate_control_digest: LibraryCoreLowercaseHex64;
}

export interface LegacyEpochBootstrapPreparedOperationV1 {
  readonly prepared_body: LegacyEpochBootstrapPreparedBodyV1;
  readonly prepared_digest: LibraryCoreLowercaseHex64;
}

export interface LegacyEpochBootstrapReceiptBodyV1 {
  readonly format: "freed_legacy_epoch_bootstrap_receipt_v1";
  readonly bootstrap_operation_id: LegacyEpochBootstrapOperationId;
  readonly prepared_digest: LibraryCoreLowercaseHex64;
  readonly record_digest: LibraryCoreLowercaseHex64;
  readonly creator_installation_id: LibraryCoreLowercaseHex64;
  readonly source_storage_generation: number;
  readonly committed_storage_generation: number;
  readonly source_save_revision: number;
  readonly committed_save_revision: number;
  readonly source_binary_digest: LibraryCoreLowercaseHex64;
  readonly committed_binary_digest: LibraryCoreLowercaseHex64;
  readonly source_heads_digest: LibraryCoreLowercaseHex64;
  readonly committed_heads_digest: LibraryCoreLowercaseHex64;
  readonly control_digest: LibraryCoreLowercaseHex64;
}

export interface LegacyEpochBootstrapReceiptV1 {
  readonly receipt_body: LegacyEpochBootstrapReceiptBodyV1;
  readonly receipt_digest: LibraryCoreLowercaseHex64;
}

export type LegacyEpochBootstrapValidationFailureCode =
  "invalid" | "incomplete" | "resource_limit" | "unsupported_newer";

export type LegacyEpochBootstrapValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly code: LegacyEpochBootstrapValidationFailureCode;
      readonly reason: string;
    };

export type LegacyEpochBootstrapState =
  | "absent"
  | "creator_prepared"
  | "creator_committed"
  | "adopter_record_unpinned"
  | "adopter_tofu_read_only"
  | "prepared_source_changed"
  | "record_history_violation"
  | "mismatched_or_corrupt"
  | "multiple_record_conflict"
  | "incomplete_scan"
  | "resource_limit_exceeded"
  | "unsupported_newer";

export interface LegacyEpochBootstrapStateInput {
  readonly local_installation_id: unknown;
  readonly automerge_heads_body: unknown;
  readonly automerge_heads_digest: unknown;
  readonly automerge_binary_digest: unknown;
  readonly save_revision: unknown;
  readonly storage_generation: unknown;
  readonly current_schema_version: unknown;
  readonly prepared_operation: unknown | null;
  readonly completion_receipt: unknown | null;
  readonly record_scan: unknown;
  readonly library_control: unknown | null;
}

const HEX_64 = /^[0-9a-f]{64}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const HEADS_KEYS = ["heads"] as const;
const RECORD_BODY_KEYS = [
  "format",
  "library_id",
  "creator_installation_id",
  "active_epoch",
  "active_epoch_id",
  "active_engine",
  "schema_version",
  "replication_protocol",
  "source_heads_body",
  "source_heads_digest",
  "bootstrap_operation_id",
  "trust_model",
  "migration_claim_pointer",
] as const;
const RECORD_KEYS = ["record_body", "record_digest"] as const;
const RECORD_OCCURRENCE_KEYS = ["root_key", "conflict_value"] as const;
const RECORD_SCAN_KEYS = [
  "format",
  "scan_complete",
  "history_scan_complete",
  "overflow",
  "reserved_root_key_count",
  "occurrence_count",
  "occurrences",
  "historical_root_key_count",
  "historical_root_keys",
] as const;
const CONTROL_KEYS = [
  "format",
  "library_id",
  "installation_id",
  "active_epoch",
  "active_epoch_id",
  "active_engine",
  "schema_version",
  "replication_protocol",
  "frontier_digest",
  "bootstrap_record_digest",
  "updated_by_operation_id",
  "migration_claim_pointer",
  "storage_generation",
  "local_access",
] as const;
const PREPARED_BODY_KEYS = [
  "format",
  "phase",
  "bootstrap_operation_id",
  "creator_installation_id",
  "source_storage_generation",
  "target_storage_generation",
  "source_save_revision",
  "candidate_save_revision",
  "source_binary_digest",
  "candidate_binary_digest",
  "source_heads_digest",
  "candidate_heads_body",
  "candidate_heads_digest",
  "record",
  "record_digest",
  "record_root_key",
  "candidate_control",
  "candidate_control_digest",
] as const;
const PREPARED_KEYS = ["prepared_body", "prepared_digest"] as const;
const RECEIPT_BODY_KEYS = [
  "format",
  "bootstrap_operation_id",
  "prepared_digest",
  "record_digest",
  "creator_installation_id",
  "source_storage_generation",
  "committed_storage_generation",
  "source_save_revision",
  "committed_save_revision",
  "source_binary_digest",
  "committed_binary_digest",
  "source_heads_digest",
  "committed_heads_digest",
  "control_digest",
] as const;
const RECEIPT_KEYS = ["receipt_body", "receipt_digest"] as const;
const STATE_INPUT_KEYS = [
  "local_installation_id",
  "automerge_heads_body",
  "automerge_heads_digest",
  "automerge_binary_digest",
  "save_revision",
  "storage_generation",
  "current_schema_version",
  "prepared_operation",
  "completion_receipt",
  "record_scan",
  "library_control",
] as const;

function success<T>(value: T): LegacyEpochBootstrapValidationResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure<T>(
  reason: string,
  code: LegacyEpochBootstrapValidationFailureCode = "invalid",
): LegacyEpochBootstrapValidationResult<T> {
  return Object.freeze({ ok: false, code, reason });
}

function safeValidation<T>(
  validate: () => LegacyEpochBootstrapValidationResult<T>,
  thrownReason: string,
): LegacyEpochBootstrapValidationResult<T> {
  try {
    return validate();
  } catch {
    return failure(thrownReason);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  try {
    const actualKeys = Object.keys(value);
    return (
      Object.getOwnPropertySymbols(value).length === 0 &&
      actualKeys.length === expectedKeys.length &&
      expectedKeys.every((key) =>
        Object.prototype.hasOwnProperty.call(value, key),
      )
    );
  } catch {
    return false;
  }
}

function snapshotExactObject(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(input) || !hasExactKeys(input, expectedKeys)) return null;
  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function snapshotArray(
  input: unknown,
  maximumLength: number,
): LegacyEpochBootstrapValidationResult<readonly unknown[]> {
  if (!Array.isArray(input)) return failure("value must be an array");
  const length = input.length;
  if (!Number.isSafeInteger(length) || length < 0) {
    return failure("array length must be a nonnegative safe integer");
  }
  if (length > maximumLength) {
    return failure(
      `array exceeds the ${maximumLength.toLocaleString()} member limit`,
      "resource_limit",
    );
  }
  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    snapshot[index] = input[index];
  }
  return success(Object.freeze(snapshot));
}

function isLowercaseHex64(value: unknown): value is LibraryCoreLowercaseHex64 {
  return typeof value === "string" && HEX_64.test(value);
}

function isOperationId(
  value: unknown,
): value is LegacyEpochBootstrapOperationId {
  return typeof value === "string" && OPERATION_ID.test(value);
}

function isBootstrapRecordRootKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX) &&
    isLowercaseHex64(
      value.slice(LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX.length),
    )
  );
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}

function isSupportedLegacySchemaVersion(
  value: unknown,
): value is LegacyAutomergeSchemaVersion {
  return (value === 0 && !Object.is(value, -0)) || value === 1;
}

function compareLowercaseHexBytes(left: string, right: string): number {
  for (let index = 0; index < left.length; index += 2) {
    const leftByte = Number.parseInt(left.slice(index, index + 2), 16);
    const rightByte = Number.parseInt(right.slice(index, index + 2), 16);
    if (leftByte !== rightByte) return leftByte - rightByte;
  }
  return 0;
}

function safeDigest(
  dependencies: LegacyEpochBootstrapVerificationDependencies,
  domain: LegacyEpochBootstrapDigestDomain,
  value: Readonly<Record<string, unknown>>,
): LibraryCoreLowercaseHex64 | null {
  try {
    const digest = dependencies.digest(domain, value);
    return isLowercaseHex64(digest) ? digest : null;
  } catch {
    return null;
  }
}

function safeIsAutomergeFrontierReachable(
  dependencies: LegacyEpochBootstrapVerificationDependencies,
  ancestorHeads: readonly LibraryCoreLowercaseHex64[],
  descendantHeads: readonly LibraryCoreLowercaseHex64[],
): boolean {
  try {
    return (
      dependencies.isAutomergeFrontierReachable({
        ancestorHeads,
        descendantHeads,
      }) === true
    );
  } catch {
    return false;
  }
}

function isForwardFormat(
  value: unknown,
  prefix: string,
  currentVersion: number,
): boolean {
  if (typeof value !== "string" || !value.startsWith(prefix)) return false;
  const version = value.slice(prefix.length);
  return /^[1-9][0-9]*$/.test(version) && Number(version) > currentVersion;
}

function hasForwardFormat(
  input: unknown,
  nestedBodyKey: string | null,
  prefix: string,
  currentVersion: number,
): boolean {
  if (!isRecord(input)) return false;
  let body: unknown = input;
  if (nestedBodyKey !== null) {
    const bodyDescriptor = Object.getOwnPropertyDescriptor(
      input,
      nestedBodyKey,
    );
    if (bodyDescriptor === undefined || !("value" in bodyDescriptor)) {
      return false;
    }
    body = bodyDescriptor.value;
  }
  if (!isRecord(body)) return false;
  const formatDescriptor = Object.getOwnPropertyDescriptor(body, "format");
  return (
    formatDescriptor !== undefined &&
    "value" in formatDescriptor &&
    isForwardFormat(formatDescriptor.value, prefix, currentVersion)
  );
}

function validateHeadsBodyUnchecked(
  input: unknown,
): LegacyEpochBootstrapValidationResult<LegacyAutomergeHeadsBody> {
  const captured = snapshotExactObject(input, HEADS_KEYS);
  if (captured === null) {
    return failure("Automerge heads must be a closed { heads } object");
  }
  const headsResult = snapshotArray(
    captured.heads,
    LEGACY_EPOCH_BOOTSTRAP_MAX_HEADS,
  );
  if (!headsResult.ok) return headsResult;
  if (headsResult.value.length === 0) {
    return failure("a supported Freed document must have at least one head");
  }
  let previous: LibraryCoreLowercaseHex64 | null = null;
  const heads: LibraryCoreLowercaseHex64[] = [];
  for (const rawHead of headsResult.value) {
    if (!isLowercaseHex64(rawHead)) {
      return failure(
        "every Automerge head must be 64 lowercase hex characters",
      );
    }
    if (previous !== null && compareLowercaseHexBytes(previous, rawHead) >= 0) {
      return failure("Automerge heads must be unique and byte-sorted");
    }
    heads.push(rawHead);
    previous = rawHead;
  }
  return success(Object.freeze({ heads: Object.freeze(heads) }));
}

export function validateLegacyAutomergeHeadsBody(
  input: unknown,
): LegacyEpochBootstrapValidationResult<LegacyAutomergeHeadsBody> {
  return safeValidation(
    () => validateHeadsBodyUnchecked(input),
    "Automerge heads could not be read safely",
  );
}

function validateHeadsCommitment(
  bodyInput: unknown,
  digestInput: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<{
  readonly body: LegacyAutomergeHeadsBody;
  readonly digest: LibraryCoreLowercaseHex64;
}> {
  const bodyResult = validateLegacyAutomergeHeadsBody(bodyInput);
  if (!bodyResult.ok) return bodyResult;
  if (!isLowercaseHex64(digestInput)) {
    return failure(
      "Automerge heads digest must be 64 lowercase hex characters",
    );
  }
  const expectedDigest = safeDigest(
    dependencies,
    LEGACY_EPOCH_BOOTSTRAP_DOMAINS.automergeHeads,
    bodyResult.value as unknown as Readonly<Record<string, unknown>>,
  );
  if (expectedDigest === null || expectedDigest !== digestInput) {
    return failure("Automerge heads digest does not match its body");
  }
  return success(
    Object.freeze({ body: bodyResult.value, digest: digestInput }),
  );
}

function validateRecordUnchecked(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapRecordV1> {
  if (
    hasForwardFormat(
      input,
      "record_body",
      "freed_legacy_epoch_bootstrap_record_v",
      1,
    )
  ) {
    return failure("bootstrap record uses a newer format", "unsupported_newer");
  }
  const captured = snapshotExactObject(input, RECORD_KEYS);
  if (captured === null) {
    return failure("bootstrap record has missing or unknown fields");
  }
  const body = snapshotExactObject(captured.record_body, RECORD_BODY_KEYS);
  if (body === null) {
    return failure("bootstrap record body has missing or unknown fields");
  }
  if (body.format !== "freed_legacy_epoch_bootstrap_record_v1") {
    return failure("bootstrap record format is not v1");
  }
  if (
    !isLowercaseHex64(body.library_id) ||
    !isLowercaseHex64(body.creator_installation_id) ||
    !isLowercaseHex64(body.active_epoch_id)
  ) {
    return failure("bootstrap identities must be 64 lowercase hex characters");
  }
  if (
    new Set([
      body.library_id,
      body.creator_installation_id,
      body.active_epoch_id,
    ]).size !== 3
  ) {
    return failure("bootstrap identities must be pairwise distinct");
  }
  if (body.active_epoch !== 1) {
    return typeof body.active_epoch === "number" && body.active_epoch > 1
      ? failure("bootstrap record uses a newer epoch", "unsupported_newer")
      : failure("bootstrap active_epoch must be exactly 1");
  }
  if (body.active_engine !== "automerge_legacy") {
    return isForwardFormat(body.active_engine, "library_core_v", 0)
      ? failure("bootstrap record uses a newer engine", "unsupported_newer")
      : failure("bootstrap engine must be automerge_legacy");
  }
  if (!isSupportedLegacySchemaVersion(body.schema_version)) {
    return typeof body.schema_version === "number" && body.schema_version > 1
      ? failure("bootstrap record uses a newer schema", "unsupported_newer")
      : failure("bootstrap schema version must be zero or one");
  }
  if (body.replication_protocol !== "automerge_blob_v1") {
    return isForwardFormat(body.replication_protocol, "op_segments_v", 0)
      ? failure("bootstrap record uses a newer protocol", "unsupported_newer")
      : failure("bootstrap protocol must be automerge_blob_v1");
  }
  const sourceHeads = validateHeadsCommitment(
    body.source_heads_body,
    body.source_heads_digest,
    dependencies,
  );
  if (!sourceHeads.ok) return sourceHeads;
  if (!isOperationId(body.bootstrap_operation_id)) {
    return failure("bootstrap operation ID is invalid");
  }
  if (body.trust_model !== "tofu_read_only_until_authenticated_pairing") {
    return failure("bootstrap trust model must remain TOFU read-only");
  }
  if (body.migration_claim_pointer !== null) {
    return failure("bootstrap migration claim pointer must be null");
  }
  if (!isLowercaseHex64(captured.record_digest)) {
    return failure(
      "bootstrap record digest must be 64 lowercase hex characters",
    );
  }

  const recordBody = Object.freeze({
    format: body.format,
    library_id: body.library_id,
    creator_installation_id: body.creator_installation_id,
    active_epoch: 1,
    active_epoch_id: body.active_epoch_id,
    active_engine: "automerge_legacy",
    schema_version: body.schema_version,
    replication_protocol: "automerge_blob_v1",
    source_heads_body: sourceHeads.value.body,
    source_heads_digest: sourceHeads.value.digest,
    bootstrap_operation_id: body.bootstrap_operation_id,
    trust_model: "tofu_read_only_until_authenticated_pairing",
    migration_claim_pointer: null,
  }) as LegacyEpochBootstrapRecordBodyV1;
  const expectedDigest = safeDigest(
    dependencies,
    LEGACY_EPOCH_BOOTSTRAP_DOMAINS.record,
    recordBody as unknown as Readonly<Record<string, unknown>>,
  );
  if (expectedDigest === null || expectedDigest !== captured.record_digest) {
    return failure("bootstrap record digest does not match its body");
  }
  return success(
    Object.freeze({
      record_body: recordBody,
      record_digest: captured.record_digest,
    }),
  );
}

export function validateLegacyEpochBootstrapRecord(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapRecordV1> {
  return safeValidation(
    () => validateRecordUnchecked(input, dependencies),
    "bootstrap record could not be read safely",
  );
}

function validateControlUnchecked(
  input: unknown,
): LegacyEpochBootstrapValidationResult<LegacyLibraryControlV1> {
  if (hasForwardFormat(input, null, "freed_library_control_v", 1)) {
    return failure("library control uses a newer format", "unsupported_newer");
  }
  const body = snapshotExactObject(input, CONTROL_KEYS);
  if (body === null) {
    return failure("library control has missing or unknown fields");
  }
  if (body.format !== "freed_library_control_v1") {
    return failure("library control format is not v1");
  }
  if (
    !isLowercaseHex64(body.library_id) ||
    !isLowercaseHex64(body.installation_id) ||
    !isLowercaseHex64(body.active_epoch_id)
  ) {
    return failure("library control identities must be lowercase hex");
  }
  if (
    new Set([body.library_id, body.installation_id, body.active_epoch_id])
      .size !== 3
  ) {
    return failure("library control identities must be pairwise distinct");
  }
  if (body.active_epoch !== 1) {
    return typeof body.active_epoch === "number" && body.active_epoch > 1
      ? failure("library control uses a newer epoch", "unsupported_newer")
      : failure("library control active_epoch must be exactly 1");
  }
  if (body.active_engine !== "automerge_legacy") {
    return isForwardFormat(body.active_engine, "library_core_v", 0)
      ? failure("library control uses a newer engine", "unsupported_newer")
      : failure("library control engine must be automerge_legacy");
  }
  if (!isSupportedLegacySchemaVersion(body.schema_version)) {
    return typeof body.schema_version === "number" && body.schema_version > 1
      ? failure("library control uses a newer schema", "unsupported_newer")
      : failure("library control schema must be zero or one");
  }
  if (body.replication_protocol !== "automerge_blob_v1") {
    return isForwardFormat(body.replication_protocol, "op_segments_v", 0)
      ? failure("library control uses a newer protocol", "unsupported_newer")
      : failure("library control protocol must be automerge_blob_v1");
  }
  if (
    !isLowercaseHex64(body.frontier_digest) ||
    !isLowercaseHex64(body.bootstrap_record_digest)
  ) {
    return failure("library control digests must be lowercase hex");
  }
  if (!isOperationId(body.updated_by_operation_id)) {
    return failure("library control operation ID is invalid");
  }
  if (body.migration_claim_pointer !== null) {
    return failure("library control migration claim pointer must be null");
  }
  if (!isNonnegativeSafeInteger(body.storage_generation)) {
    return failure("library control storage generation is invalid");
  }
  if (
    body.local_access !== "creator_local_owner_confirmed" &&
    body.local_access !== "adopter_tofu_read_only"
  ) {
    return failure("library control local access mode is invalid");
  }
  return success(
    Object.freeze({ ...body }) as unknown as LegacyLibraryControlV1,
  );
}

export function validateLegacyLibraryControlV1(
  input: unknown,
): LegacyEpochBootstrapValidationResult<LegacyLibraryControlV1> {
  return safeValidation(
    () => validateControlUnchecked(input),
    "library control could not be read safely",
  );
}

function controlMatchesRecord(
  control: LegacyLibraryControlV1,
  record: LegacyEpochBootstrapRecordV1,
  localInstallationId: LibraryCoreLowercaseHex64,
  currentHeadsDigest: LibraryCoreLowercaseHex64,
  currentSchemaVersion: LegacyAutomergeSchemaVersion,
  currentStorageGeneration: number,
): boolean {
  const body = record.record_body;
  return (
    control.library_id === body.library_id &&
    control.installation_id === localInstallationId &&
    control.active_epoch === body.active_epoch &&
    control.active_epoch_id === body.active_epoch_id &&
    control.active_engine === body.active_engine &&
    control.schema_version === currentSchemaVersion &&
    control.replication_protocol === body.replication_protocol &&
    control.frontier_digest === currentHeadsDigest &&
    control.bootstrap_record_digest === record.record_digest &&
    control.migration_claim_pointer === null &&
    control.storage_generation === currentStorageGeneration
  );
}

function validatePreparedUnchecked(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapPreparedOperationV1> {
  if (
    hasForwardFormat(
      input,
      "prepared_body",
      "freed_legacy_epoch_bootstrap_prepared_v",
      1,
    )
  ) {
    return failure(
      "prepared operation uses a newer format",
      "unsupported_newer",
    );
  }
  const captured = snapshotExactObject(input, PREPARED_KEYS);
  if (captured === null) {
    return failure("prepared operation has missing or unknown fields");
  }
  const body = snapshotExactObject(captured.prepared_body, PREPARED_BODY_KEYS);
  if (body === null) {
    return failure("prepared body has missing or unknown fields");
  }
  if (
    body.format !== "freed_legacy_epoch_bootstrap_prepared_v1" ||
    body.phase !== "prepared"
  ) {
    return failure("prepared operation format or phase is invalid");
  }
  if (
    !isOperationId(body.bootstrap_operation_id) ||
    !isLowercaseHex64(body.creator_installation_id)
  ) {
    return failure("prepared operation identity is invalid");
  }
  const sourceStorageGeneration = body.source_storage_generation;
  const targetStorageGeneration = body.target_storage_generation;
  const sourceSaveRevision = body.source_save_revision;
  const candidateSaveRevision = body.candidate_save_revision;
  if (
    !isNonnegativeSafeInteger(sourceStorageGeneration) ||
    !isNonnegativeSafeInteger(targetStorageGeneration) ||
    !isNonnegativeSafeInteger(sourceSaveRevision) ||
    !isNonnegativeSafeInteger(candidateSaveRevision)
  ) {
    return failure("prepared operation revisions must be safe integers");
  }
  if (
    sourceStorageGeneration !== targetStorageGeneration ||
    candidateSaveRevision !== sourceSaveRevision + 1
  ) {
    return failure(
      "prepared operation generation or revision fence is invalid",
    );
  }
  const sourceBinaryDigest = body.source_binary_digest;
  const candidateBinaryDigest = body.candidate_binary_digest;
  const sourceHeadsDigest = body.source_heads_digest;
  const candidateHeadsDigest = body.candidate_heads_digest;
  const recordDigest = body.record_digest;
  const candidateControlDigest = body.candidate_control_digest;
  const preparedDigest = captured.prepared_digest;
  if (
    !isLowercaseHex64(sourceBinaryDigest) ||
    !isLowercaseHex64(candidateBinaryDigest) ||
    !isLowercaseHex64(sourceHeadsDigest) ||
    !isLowercaseHex64(candidateHeadsDigest) ||
    !isLowercaseHex64(recordDigest) ||
    !isLowercaseHex64(candidateControlDigest) ||
    !isLowercaseHex64(preparedDigest)
  ) {
    return failure("prepared operation digest is invalid");
  }
  if (
    sourceBinaryDigest === candidateBinaryDigest ||
    sourceHeadsDigest === candidateHeadsDigest
  ) {
    return failure("prepared candidate must differ from its exact source");
  }

  const recordResult = validateLegacyEpochBootstrapRecord(
    body.record,
    dependencies,
  );
  if (!recordResult.ok) return recordResult;
  const candidateHeads = validateHeadsCommitment(
    body.candidate_heads_body,
    candidateHeadsDigest,
    dependencies,
  );
  if (!candidateHeads.ok) return candidateHeads;
  if (
    !safeIsAutomergeFrontierReachable(
      dependencies,
      recordResult.value.record_body.source_heads_body.heads,
      candidateHeads.value.body.heads,
    )
  ) {
    return failure(
      "prepared candidate frontier does not descend from its exact source",
    );
  }
  const controlResult = validateLegacyLibraryControlV1(body.candidate_control);
  if (!controlResult.ok) return controlResult;
  const record = recordResult.value;
  const control = controlResult.value;
  if (
    body.bootstrap_operation_id !== record.record_body.bootstrap_operation_id ||
    body.creator_installation_id !==
      record.record_body.creator_installation_id ||
    sourceHeadsDigest !== record.record_body.source_heads_digest ||
    recordDigest !== record.record_digest ||
    body.record_root_key !==
      `${LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX}${record.record_digest}` ||
    control.local_access !== "creator_local_owner_confirmed" ||
    control.updated_by_operation_id !== body.bootstrap_operation_id ||
    !controlMatchesRecord(
      control,
      record,
      body.creator_installation_id,
      candidateHeads.value.digest,
      record.record_body.schema_version,
      targetStorageGeneration,
    )
  ) {
    return failure(
      "prepared operation members do not describe one transaction",
    );
  }
  const expectedControlDigest = safeDigest(
    dependencies,
    LEGACY_EPOCH_BOOTSTRAP_DOMAINS.control,
    control as unknown as Readonly<Record<string, unknown>>,
  );
  if (
    expectedControlDigest === null ||
    expectedControlDigest !== candidateControlDigest
  ) {
    return failure("prepared control digest does not match its body");
  }

  const preparedBody = Object.freeze({
    ...body,
    candidate_heads_body: candidateHeads.value.body,
    record,
    candidate_control: control,
  }) as unknown as LegacyEpochBootstrapPreparedBodyV1;
  const expectedPreparedDigest = safeDigest(
    dependencies,
    LEGACY_EPOCH_BOOTSTRAP_DOMAINS.preparedOperation,
    preparedBody as unknown as Readonly<Record<string, unknown>>,
  );
  if (
    expectedPreparedDigest === null ||
    expectedPreparedDigest !== preparedDigest
  ) {
    return failure("prepared digest does not match its body");
  }
  return success(
    Object.freeze({
      prepared_body: preparedBody,
      prepared_digest: preparedDigest,
    }),
  );
}

export function validateLegacyEpochBootstrapPreparedOperation(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapPreparedOperationV1> {
  return safeValidation(
    () => validatePreparedUnchecked(input, dependencies),
    "prepared operation could not be read safely",
  );
}

function validateReceiptUnchecked(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapReceiptV1> {
  if (
    hasForwardFormat(
      input,
      "receipt_body",
      "freed_legacy_epoch_bootstrap_receipt_v",
      1,
    )
  ) {
    return failure(
      "bootstrap receipt uses a newer format",
      "unsupported_newer",
    );
  }
  const captured = snapshotExactObject(input, RECEIPT_KEYS);
  if (captured === null) {
    return failure("bootstrap receipt has missing or unknown fields");
  }
  const body = snapshotExactObject(captured.receipt_body, RECEIPT_BODY_KEYS);
  if (body === null) {
    return failure("bootstrap receipt body has missing or unknown fields");
  }
  if (body.format !== "freed_legacy_epoch_bootstrap_receipt_v1") {
    return failure("bootstrap receipt format is not v1");
  }
  if (
    !isOperationId(body.bootstrap_operation_id) ||
    !isLowercaseHex64(body.creator_installation_id)
  ) {
    return failure("bootstrap receipt identity is invalid");
  }
  const sourceStorageGeneration = body.source_storage_generation;
  const committedStorageGeneration = body.committed_storage_generation;
  const sourceSaveRevision = body.source_save_revision;
  const committedSaveRevision = body.committed_save_revision;
  if (
    !isNonnegativeSafeInteger(sourceStorageGeneration) ||
    !isNonnegativeSafeInteger(committedStorageGeneration) ||
    !isNonnegativeSafeInteger(sourceSaveRevision) ||
    !isNonnegativeSafeInteger(committedSaveRevision)
  ) {
    return failure("bootstrap receipt revisions must be safe integers");
  }
  if (
    sourceStorageGeneration !== committedStorageGeneration ||
    committedSaveRevision !== sourceSaveRevision + 1
  ) {
    return failure("bootstrap receipt generation or revision fence is invalid");
  }
  const preparedDigest = body.prepared_digest;
  const recordDigest = body.record_digest;
  const sourceBinaryDigest = body.source_binary_digest;
  const committedBinaryDigest = body.committed_binary_digest;
  const sourceHeadsDigest = body.source_heads_digest;
  const committedHeadsDigest = body.committed_heads_digest;
  const controlDigest = body.control_digest;
  const receiptDigest = captured.receipt_digest;
  if (
    !isLowercaseHex64(preparedDigest) ||
    !isLowercaseHex64(recordDigest) ||
    !isLowercaseHex64(sourceBinaryDigest) ||
    !isLowercaseHex64(committedBinaryDigest) ||
    !isLowercaseHex64(sourceHeadsDigest) ||
    !isLowercaseHex64(committedHeadsDigest) ||
    !isLowercaseHex64(controlDigest) ||
    !isLowercaseHex64(receiptDigest)
  ) {
    return failure("bootstrap receipt digest is invalid");
  }
  if (
    sourceBinaryDigest === committedBinaryDigest ||
    sourceHeadsDigest === committedHeadsDigest
  ) {
    return failure("bootstrap receipt must describe a changed document");
  }
  const receiptBody = Object.freeze({
    ...body,
  }) as unknown as LegacyEpochBootstrapReceiptBodyV1;
  const expectedDigest = safeDigest(
    dependencies,
    LEGACY_EPOCH_BOOTSTRAP_DOMAINS.receipt,
    receiptBody as unknown as Readonly<Record<string, unknown>>,
  );
  if (expectedDigest === null || expectedDigest !== receiptDigest) {
    return failure("bootstrap receipt digest does not match its body");
  }
  return success(
    Object.freeze({
      receipt_body: receiptBody,
      receipt_digest: receiptDigest,
    }),
  );
}

export function validateLegacyEpochBootstrapReceipt(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapReceiptV1> {
  return safeValidation(
    () => validateReceiptUnchecked(input, dependencies),
    "bootstrap receipt could not be read safely",
  );
}

function validateScanUnchecked(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapRecordScanV1> {
  if (hasForwardFormat(input, null, "freed_legacy_epoch_bootstrap_scan_v", 1)) {
    return failure("bootstrap scan uses a newer format", "unsupported_newer");
  }
  const body = snapshotExactObject(input, RECORD_SCAN_KEYS);
  if (body === null) {
    return failure("bootstrap record scan has missing or unknown fields");
  }
  if (body.format !== "freed_legacy_epoch_bootstrap_scan_v1") {
    return failure("bootstrap scan format is not v1");
  }
  if (
    typeof body.scan_complete !== "boolean" ||
    typeof body.history_scan_complete !== "boolean" ||
    typeof body.overflow !== "boolean" ||
    !isNonnegativeSafeInteger(body.reserved_root_key_count) ||
    !isNonnegativeSafeInteger(body.occurrence_count) ||
    !isNonnegativeSafeInteger(body.historical_root_key_count)
  ) {
    return failure("bootstrap scan metadata is invalid");
  }
  if (body.overflow) {
    return failure(
      "bootstrap scan exceeded its closed bounds",
      "resource_limit",
    );
  }
  if (!body.scan_complete || !body.history_scan_complete) {
    return failure(
      "bootstrap current or historical namespace scan is incomplete",
      "incomplete",
    );
  }
  if (
    body.reserved_root_key_count >
      LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES ||
    body.occurrence_count > LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES ||
    body.historical_root_key_count >
      LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES
  ) {
    return failure("bootstrap scan count exceeds its bound", "resource_limit");
  }
  const occurrenceInputs = snapshotArray(
    body.occurrences,
    LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES,
  );
  if (!occurrenceInputs.ok) return occurrenceInputs;
  if (occurrenceInputs.value.length !== body.occurrence_count) {
    return failure("bootstrap scan occurrence count is inconsistent");
  }
  const historicalRootInputs = snapshotArray(
    body.historical_root_keys,
    LEGACY_EPOCH_BOOTSTRAP_MAX_RECORD_OCCURRENCES,
  );
  if (!historicalRootInputs.ok) return historicalRootInputs;
  if (historicalRootInputs.value.length !== body.historical_root_key_count) {
    return failure("bootstrap historical root count is inconsistent");
  }

  const historicalRootKeys: string[] = [];
  let previousHistoricalRoot: string | null = null;
  for (const historicalRoot of historicalRootInputs.value) {
    if (!isBootstrapRecordRootKey(historicalRoot)) {
      return failure("bootstrap historical root is invalid");
    }
    if (
      previousHistoricalRoot !== null &&
      previousHistoricalRoot >= historicalRoot
    ) {
      return failure(
        "bootstrap historical roots must be unique and byte-sorted",
      );
    }
    historicalRootKeys.push(historicalRoot);
    previousHistoricalRoot = historicalRoot;
  }

  const occurrences: LegacyEpochBootstrapRecordOccurrence[] = [];
  const rootKeys = new Set<string>();
  for (const occurrenceInput of occurrenceInputs.value) {
    const occurrence = snapshotExactObject(
      occurrenceInput,
      RECORD_OCCURRENCE_KEYS,
    );
    if (occurrence === null || typeof occurrence.root_key !== "string") {
      return failure("bootstrap record occurrence is invalid");
    }
    const recordResult = validateLegacyEpochBootstrapRecord(
      occurrence.conflict_value,
      dependencies,
    );
    if (!recordResult.ok) return recordResult;
    const expectedRoot = `${LEGACY_EPOCH_BOOTSTRAP_RECORD_ROOT_PREFIX}${recordResult.value.record_digest}`;
    if (occurrence.root_key !== expectedRoot) {
      return failure("bootstrap record root does not match its digest");
    }
    rootKeys.add(occurrence.root_key);
    occurrences.push(
      Object.freeze({
        root_key: occurrence.root_key,
        conflict_value: recordResult.value,
      }),
    );
  }
  if (rootKeys.size !== body.reserved_root_key_count) {
    return failure("bootstrap scan root count is inconsistent");
  }
  return success(
    Object.freeze({
      format: "freed_legacy_epoch_bootstrap_scan_v1",
      scan_complete: true,
      history_scan_complete: true,
      overflow: false,
      reserved_root_key_count: body.reserved_root_key_count,
      occurrence_count: body.occurrence_count,
      occurrences: Object.freeze(occurrences),
      historical_root_key_count: body.historical_root_key_count,
      historical_root_keys: Object.freeze(historicalRootKeys),
    }),
  );
}

export function validateLegacyEpochBootstrapRecordScan(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapValidationResult<LegacyEpochBootstrapRecordScanV1> {
  return safeValidation(
    () => validateScanUnchecked(input, dependencies),
    "bootstrap record scan could not be read safely",
  );
}

function recordsStructurallyEqual(
  left: LegacyEpochBootstrapRecordV1,
  right: LegacyEpochBootstrapRecordV1,
): boolean {
  const leftBody = left.record_body;
  const rightBody = right.record_body;
  return (
    left.record_digest === right.record_digest &&
    leftBody.format === rightBody.format &&
    leftBody.library_id === rightBody.library_id &&
    leftBody.creator_installation_id === rightBody.creator_installation_id &&
    leftBody.active_epoch === rightBody.active_epoch &&
    leftBody.active_epoch_id === rightBody.active_epoch_id &&
    leftBody.active_engine === rightBody.active_engine &&
    leftBody.schema_version === rightBody.schema_version &&
    leftBody.replication_protocol === rightBody.replication_protocol &&
    leftBody.source_heads_digest === rightBody.source_heads_digest &&
    leftBody.bootstrap_operation_id === rightBody.bootstrap_operation_id &&
    leftBody.trust_model === rightBody.trust_model &&
    leftBody.migration_claim_pointer === rightBody.migration_claim_pointer &&
    leftBody.source_heads_body.heads.length ===
      rightBody.source_heads_body.heads.length &&
    leftBody.source_heads_body.heads.every(
      (head, index) => head === rightBody.source_heads_body.heads[index],
    )
  );
}

function mapFailureToState(
  result: Exclude<LegacyEpochBootstrapValidationResult<unknown>, { ok: true }>,
): LegacyEpochBootstrapState {
  if (result.code === "resource_limit") return "resource_limit_exceeded";
  if (result.code === "incomplete") return "incomplete_scan";
  if (result.code === "unsupported_newer") return "unsupported_newer";
  return "mismatched_or_corrupt";
}

function preparedMatchesCurrentSource(
  prepared: LegacyEpochBootstrapPreparedOperationV1,
  input: {
    readonly localInstallationId: LibraryCoreLowercaseHex64;
    readonly heads: LegacyAutomergeHeadsBody;
    readonly headsDigest: LibraryCoreLowercaseHex64;
    readonly binaryDigest: LibraryCoreLowercaseHex64;
    readonly saveRevision: number;
    readonly storageGeneration: number;
    readonly schemaVersion: LegacyAutomergeSchemaVersion;
  },
): boolean {
  const body = prepared.prepared_body;
  const record = body.record.record_body;
  return (
    body.creator_installation_id === input.localInstallationId &&
    body.source_storage_generation === input.storageGeneration &&
    body.target_storage_generation === input.storageGeneration &&
    body.source_save_revision === input.saveRevision &&
    body.source_binary_digest === input.binaryDigest &&
    body.source_heads_digest === input.headsDigest &&
    record.source_heads_digest === input.headsDigest &&
    record.schema_version === input.schemaVersion &&
    record.source_heads_body.heads.length === input.heads.heads.length &&
    record.source_heads_body.heads.every(
      (head, index) => head === input.heads.heads[index],
    )
  );
}

function receiptMatchesPrepared(
  receipt: LegacyEpochBootstrapReceiptV1,
  prepared: LegacyEpochBootstrapPreparedOperationV1,
): boolean {
  const receiptBody = receipt.receipt_body;
  const preparedBody = prepared.prepared_body;
  return (
    receiptBody.bootstrap_operation_id ===
      preparedBody.bootstrap_operation_id &&
    receiptBody.prepared_digest === prepared.prepared_digest &&
    receiptBody.record_digest === preparedBody.record_digest &&
    receiptBody.creator_installation_id ===
      preparedBody.creator_installation_id &&
    receiptBody.source_storage_generation ===
      preparedBody.source_storage_generation &&
    receiptBody.committed_storage_generation ===
      preparedBody.target_storage_generation &&
    receiptBody.source_save_revision === preparedBody.source_save_revision &&
    receiptBody.committed_save_revision ===
      preparedBody.candidate_save_revision &&
    receiptBody.source_binary_digest === preparedBody.source_binary_digest &&
    receiptBody.committed_binary_digest ===
      preparedBody.candidate_binary_digest &&
    receiptBody.source_heads_digest === preparedBody.source_heads_digest &&
    receiptBody.committed_heads_digest ===
      preparedBody.candidate_heads_digest &&
    receiptBody.control_digest === preparedBody.candidate_control_digest
  );
}

/**
 * Classifies one closed readback snapshot. It never grants portable authority.
 *
 * A future production caller must obtain `prepared_operation` only from the
 * registered local bootstrap journal while holding its transaction boundary.
 * This function proves correspondence and atomic readback, not human identity.
 */
export function classifyLegacyEpochBootstrapState(
  input: unknown,
  dependencies: LegacyEpochBootstrapVerificationDependencies,
): LegacyEpochBootstrapState {
  try {
    const captured = snapshotExactObject(input, STATE_INPUT_KEYS);
    if (captured === null) return "mismatched_or_corrupt";
    if (!isLowercaseHex64(captured.local_installation_id)) {
      return "mismatched_or_corrupt";
    }
    if (!isLowercaseHex64(captured.automerge_binary_digest)) {
      return "mismatched_or_corrupt";
    }
    if (
      !isNonnegativeSafeInteger(captured.save_revision) ||
      !isNonnegativeSafeInteger(captured.storage_generation)
    ) {
      return "mismatched_or_corrupt";
    }
    if (!isSupportedLegacySchemaVersion(captured.current_schema_version)) {
      return typeof captured.current_schema_version === "number" &&
        captured.current_schema_version > 1
        ? "unsupported_newer"
        : "mismatched_or_corrupt";
    }

    const headsResult = validateHeadsCommitment(
      captured.automerge_heads_body,
      captured.automerge_heads_digest,
      dependencies,
    );
    if (!headsResult.ok) return mapFailureToState(headsResult);
    const scanResult = validateLegacyEpochBootstrapRecordScan(
      captured.record_scan,
      dependencies,
    );
    if (!scanResult.ok) return mapFailureToState(scanResult);

    let prepared: LegacyEpochBootstrapPreparedOperationV1 | null = null;
    if (captured.prepared_operation !== null) {
      const preparedResult = validateLegacyEpochBootstrapPreparedOperation(
        captured.prepared_operation,
        dependencies,
      );
      if (!preparedResult.ok) return mapFailureToState(preparedResult);
      prepared = preparedResult.value;
    }

    let receipt: LegacyEpochBootstrapReceiptV1 | null = null;
    if (captured.completion_receipt !== null) {
      const receiptResult = validateLegacyEpochBootstrapReceipt(
        captured.completion_receipt,
        dependencies,
      );
      if (!receiptResult.ok) return mapFailureToState(receiptResult);
      receipt = receiptResult.value;
    }

    let control: LegacyLibraryControlV1 | null = null;
    if (captured.library_control !== null) {
      const controlResult = validateLegacyLibraryControlV1(
        captured.library_control,
      );
      if (!controlResult.ok) return mapFailureToState(controlResult);
      control = controlResult.value;
    }

    const scan = scanResult.value;
    const currentRootKeys = new Set(
      scan.occurrences.map((occurrence) => occurrence.root_key),
    );
    if (
      scan.historical_root_key_count !== scan.reserved_root_key_count ||
      scan.historical_root_keys.some(
        (historicalRoot) => !currentRootKeys.has(historicalRoot),
      )
    ) {
      return "record_history_violation";
    }
    const firstRecord = scan.occurrences[0]?.conflict_value ?? null;
    if (
      firstRecord !== null &&
      scan.occurrences
        .slice(1)
        .some(
          (occurrence) =>
            !recordsStructurallyEqual(firstRecord, occurrence.conflict_value),
        )
    ) {
      return "multiple_record_conflict";
    }

    const current = {
      localInstallationId: captured.local_installation_id,
      heads: headsResult.value.body,
      headsDigest: headsResult.value.digest,
      binaryDigest: captured.automerge_binary_digest,
      saveRevision: captured.save_revision,
      storageGeneration: captured.storage_generation,
      schemaVersion: captured.current_schema_version,
    };

    if (firstRecord === null) {
      if (control !== null || receipt !== null) return "mismatched_or_corrupt";
      if (prepared === null) return "absent";
      return preparedMatchesCurrentSource(prepared, current)
        ? "creator_prepared"
        : "prepared_source_changed";
    }

    if (
      firstRecord.record_body.schema_version > current.schemaVersion ||
      !safeIsAutomergeFrontierReachable(
        dependencies,
        firstRecord.record_body.source_heads_body.heads,
        current.heads.heads,
      )
    ) {
      return "mismatched_or_corrupt";
    }

    if (prepared === null) {
      if (receipt !== null) return "mismatched_or_corrupt";
      if (control === null) return "adopter_record_unpinned";
      return control.local_access === "adopter_tofu_read_only" &&
        controlMatchesRecord(
          control,
          firstRecord,
          current.localInstallationId,
          current.headsDigest,
          current.schemaVersion,
          current.storageGeneration,
        )
        ? "adopter_tofu_read_only"
        : "mismatched_or_corrupt";
    }

    if (control === null || receipt === null) {
      return "mismatched_or_corrupt";
    }
    const preparedBody = prepared.prepared_body;
    if (
      preparedBody.creator_installation_id !== current.localInstallationId ||
      !recordsStructurallyEqual(preparedBody.record, firstRecord) ||
      !receiptMatchesPrepared(receipt, prepared) ||
      control.local_access !== "creator_local_owner_confirmed" ||
      !controlMatchesRecord(
        control,
        firstRecord,
        current.localInstallationId,
        current.headsDigest,
        current.schemaVersion,
        current.storageGeneration,
      ) ||
      current.storageGeneration !== preparedBody.target_storage_generation ||
      current.saveRevision < preparedBody.candidate_save_revision ||
      !safeIsAutomergeFrontierReachable(
        dependencies,
        preparedBody.candidate_heads_body.heads,
        current.heads.heads,
      )
    ) {
      return "mismatched_or_corrupt";
    }
    if (
      current.saveRevision === preparedBody.candidate_save_revision &&
      (current.binaryDigest !== preparedBody.candidate_binary_digest ||
        current.headsDigest !== preparedBody.candidate_heads_digest ||
        safeDigest(
          dependencies,
          LEGACY_EPOCH_BOOTSTRAP_DOMAINS.control,
          control as unknown as Readonly<Record<string, unknown>>,
        ) !== preparedBody.candidate_control_digest)
    ) {
      return "mismatched_or_corrupt";
    }
    return "creator_committed";
  } catch {
    return "mismatched_or_corrupt";
  }
}
