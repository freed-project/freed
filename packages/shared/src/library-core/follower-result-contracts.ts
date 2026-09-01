import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import type { LibraryCoreEd25519VerificationInput } from "./ed25519-verification.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
} from "./protocol-scalars.js";
import { sha256LowerHex } from "./sha256.js";

export const LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES = 131_072;
export const LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_MEMBERS = 1_000;
export const LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_REPLACEMENT_FIELDS = 4_000;

export const LIBRARY_CORE_FOLLOWER_RESULT_REJECTION_REASONS = [
  "actor_retired",
  "capability_denied",
  "epoch_stale",
  "precondition_failed",
  "target_missing",
  "target_tombstoned",
] as const;

export type LibraryCoreFollowerResultStatusV1 =
  "accepted" | "already_applied" | "rejected";

export type LibraryCoreFollowerResultRejectionReasonV1 =
  (typeof LIBRARY_CORE_FOLLOWER_RESULT_REJECTION_REASONS)[number];

export interface LibraryCoreFollowerResultReplacementFieldV1 {
  readonly boolean_value: boolean | null;
  readonly entity_id: string;
  readonly entity_type: "FeedItem";
  readonly field_path:
    | "archived"
    | "archived_at"
    | "liked"
    | "liked_at"
    | "read_at"
    | "saved"
    | "saved_at";
  readonly integer_value: number | null;
  readonly real_value: number | null;
  readonly text_value: string | null;
  readonly value_type: "boolean" | "integer" | "null";
}

export interface LibraryCoreFollowerResultBodyV1 {
  readonly actor_id: string;
  readonly authoritative_source_revision: number;
  readonly authority_key_id: string;
  readonly canonical_operation_ids: readonly string[];
  readonly epoch: number;
  readonly epoch_id: string;
  readonly format: "freed_follower_result_v1";
  readonly intent_epoch: number;
  readonly intent_epoch_id: string;
  readonly library_id: string;
  readonly original_result_digest: string | null;
  readonly previous_result_digest: string | null;
  readonly receipt_ids: readonly string[];
  readonly rejection_reason: LibraryCoreFollowerResultRejectionReasonV1 | null;
  readonly replacement_fields: readonly LibraryCoreFollowerResultReplacementFieldV1[];
  readonly resolved_at_ms: number;
  readonly result_sequence: number;
  readonly schema_version: 1;
  readonly status: LibraryCoreFollowerResultStatusV1;
  readonly transaction_digest: string;
  readonly transaction_id: string;
}

export interface LibraryCoreFollowerResultEnvelopeV1 extends LibraryCoreFollowerResultBodyV1 {
  readonly result_body_digest: string;
  readonly signature: string;
  readonly signature_algorithm: "ed25519";
}

export interface LibraryCoreFollowerResultVerificationAuthorityV1 {
  readonly authorityKeyId: string;
  readonly authorityPublicKey: string;
  readonly epoch: number;
  readonly epochId: string;
  readonly libraryId: string;
}

export interface LibraryCoreVerifiedFollowerResultV1 {
  readonly canonicalBytes: Uint8Array;
  readonly envelope: LibraryCoreFollowerResultEnvelopeV1;
  readonly resultDigest: string;
}

export interface LibraryCoreFollowerResultVerifierV1 {
  readonly verifySignature: (
    input: LibraryCoreEd25519VerificationInput,
  ) => Promise<boolean>;
}

const BODY_FIELDS = [
  "actor_id",
  "authoritative_source_revision",
  "authority_key_id",
  "canonical_operation_ids",
  "epoch",
  "epoch_id",
  "format",
  "intent_epoch",
  "intent_epoch_id",
  "library_id",
  "original_result_digest",
  "previous_result_digest",
  "receipt_ids",
  "rejection_reason",
  "replacement_fields",
  "resolved_at_ms",
  "result_sequence",
  "schema_version",
  "status",
  "transaction_digest",
  "transaction_id",
] as const;
const ENVELOPE_FIELDS = [
  ...BODY_FIELDS,
  "result_body_digest",
  "signature",
  "signature_algorithm",
] as const;
const REPLACEMENT_FIELDS = [
  "boolean_value",
  "entity_id",
  "entity_type",
  "field_path",
  "integer_value",
  "real_value",
  "text_value",
  "value_type",
] as const;
const REGISTERED_FIELD_PATHS = new Set([
  "archived",
  "archived_at",
  "liked",
  "liked_at",
  "read_at",
  "saved",
  "saved_at",
]);

function record(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a closed record`);
  }
  const names = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    names.length !== expected.length ||
    names.some((name, index) => name !== expected[index])
  ) {
    throw new TypeError(`${label} has an invalid field set`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum = 4_096): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digestOrNull(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!isLibraryCoreLowercaseHex64(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_MEMBERS ||
    Object.keys(value).length !== value.length
  ) {
    throw new TypeError(`${label} must be a bounded dense array`);
  }
  const result = value.map((item, index) =>
    boundedString(item, `${label}[${index}]`, 255),
  );
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${label} contains a duplicate identity`);
  }
  return Object.freeze(result);
}

function replacementField(
  value: unknown,
): LibraryCoreFollowerResultReplacementFieldV1 {
  const input = record(value, REPLACEMENT_FIELDS, "follower replacement field");
  if (
    input.entity_type !== "FeedItem" ||
    !REGISTERED_FIELD_PATHS.has(String(input.field_path))
  ) {
    throw new TypeError("follower replacement field identity is invalid");
  }
  const valueType = input.value_type;
  if (
    valueType !== "boolean" &&
    valueType !== "integer" &&
    valueType !== "null"
  ) {
    throw new TypeError("follower replacement field value type is invalid");
  }
  const fieldPath = String(input.field_path);
  const expectsBoolean =
    fieldPath === "archived" || fieldPath === "liked" || fieldPath === "saved";
  if (
    (expectsBoolean && valueType !== "boolean") ||
    (!expectsBoolean && valueType !== "integer" && valueType !== "null")
  ) {
    throw new TypeError(
      "follower replacement field type disagrees with its path",
    );
  }
  const booleanValue = input.boolean_value;
  const integerValue = input.integer_value;
  if (
    (valueType === "boolean" && typeof booleanValue !== "boolean") ||
    (valueType !== "boolean" && booleanValue !== null) ||
    (valueType === "integer" &&
      !isLibraryCoreNonnegativeSafeInteger(integerValue)) ||
    (valueType !== "integer" && integerValue !== null) ||
    input.real_value !== null ||
    input.text_value !== null
  ) {
    throw new TypeError("follower replacement field typed value is invalid");
  }
  return Object.freeze({
    boolean_value: booleanValue as boolean | null,
    entity_id: boundedString(input.entity_id, "follower replacement entity ID"),
    entity_type: "FeedItem",
    field_path:
      fieldPath as LibraryCoreFollowerResultReplacementFieldV1["field_path"],
    integer_value: integerValue as number | null,
    real_value: null,
    text_value: null,
    value_type: valueType,
  });
}

export function parseLibraryCoreFollowerResultEnvelopeV1(
  value: unknown,
): LibraryCoreFollowerResultEnvelopeV1 {
  const input = record(value, ENVELOPE_FIELDS, "follower result envelope");
  if (
    input.format !== "freed_follower_result_v1" ||
    input.schema_version !== 1 ||
    input.signature_algorithm !== "ed25519" ||
    !isLibraryCoreNonnegativeSafeInteger(input.epoch) ||
    !isLibraryCoreNonnegativeSafeInteger(input.intent_epoch) ||
    !isLibraryCoreNonnegativeSafeInteger(input.authoritative_source_revision) ||
    !isLibraryCoreNonnegativeSafeInteger(input.resolved_at_ms) ||
    !isLibraryCoreNonnegativeSafeInteger(input.result_sequence) ||
    input.result_sequence < 1 ||
    !isLibraryCoreLowercaseHex64(input.authority_key_id) ||
    !isLibraryCoreLowercaseHex64(input.transaction_digest) ||
    !isLibraryCoreLowercaseHex64(input.result_body_digest) ||
    !isLibraryCoreEd25519SignatureHex(input.signature)
  ) {
    throw new TypeError("follower result envelope scalar is invalid");
  }
  const status = input.status;
  if (
    status !== "accepted" &&
    status !== "rejected" &&
    status !== "already_applied"
  ) {
    throw new TypeError("follower result status is invalid");
  }
  const operationIds = stringArray(
    input.canonical_operation_ids,
    "canonical operation IDs",
  );
  const receiptIds = stringArray(input.receipt_ids, "receipt IDs");
  if (operationIds.length !== receiptIds.length) {
    throw new TypeError(
      "follower result operation and receipt counts disagree",
    );
  }
  const reason = input.rejection_reason;
  if (
    (status === "rejected" &&
      !LIBRARY_CORE_FOLLOWER_RESULT_REJECTION_REASONS.includes(
        reason as never,
      )) ||
    (status !== "rejected" && reason !== null)
  ) {
    throw new TypeError(
      "follower result rejection reason disagrees with status",
    );
  }
  const original = digestOrNull(
    input.original_result_digest,
    "original result digest",
  );
  if ((status === "already_applied") !== (original !== null)) {
    throw new TypeError("original result digest disagrees with status");
  }
  const epochId = boundedString(
    input.epoch_id,
    "follower result epoch ID",
    255,
  );
  const intentEpochId = boundedString(
    input.intent_epoch_id,
    "follower result intent epoch ID",
    255,
  );
  const staleEpoch = reason === "epoch_stale";
  if (
    staleEpoch
      ? input.intent_epoch >= input.epoch || intentEpochId === epochId
      : input.intent_epoch !== input.epoch || intentEpochId !== epochId
  ) {
    throw new TypeError("follower result intent and authority epochs disagree");
  }
  if (status === "rejected" && operationIds.length !== 0) {
    throw new TypeError(
      "rejected follower result cannot name canonical operations",
    );
  }
  if (
    !Array.isArray(input.replacement_fields) ||
    input.replacement_fields.length >
      LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_REPLACEMENT_FIELDS ||
    Object.keys(input.replacement_fields).length !==
      input.replacement_fields.length
  ) {
    throw new TypeError(
      "follower replacement fields must be a bounded dense array",
    );
  }
  const replacements = Object.freeze(
    input.replacement_fields.map(replacementField),
  );
  const identities = new Set<string>();
  for (const field of replacements) {
    const identity = `${field.entity_type}\u0000${field.entity_id}\u0000${field.field_path}`;
    if (identities.has(identity))
      throw new TypeError("follower replacement field identity is duplicated");
    identities.add(identity);
  }
  return Object.freeze({
    actor_id: boundedString(input.actor_id, "follower result actor ID", 255),
    authoritative_source_revision: input.authoritative_source_revision,
    authority_key_id: input.authority_key_id,
    canonical_operation_ids: operationIds,
    epoch: input.epoch,
    epoch_id: epochId,
    format: "freed_follower_result_v1",
    intent_epoch: input.intent_epoch,
    intent_epoch_id: intentEpochId,
    library_id: boundedString(
      input.library_id,
      "follower result Library ID",
      255,
    ),
    original_result_digest: original,
    previous_result_digest: digestOrNull(
      input.previous_result_digest,
      "previous result digest",
    ),
    receipt_ids: receiptIds,
    rejection_reason:
      reason as LibraryCoreFollowerResultRejectionReasonV1 | null,
    replacement_fields: replacements,
    resolved_at_ms: input.resolved_at_ms,
    result_body_digest: input.result_body_digest,
    result_sequence: input.result_sequence,
    schema_version: 1,
    signature: input.signature,
    signature_algorithm: "ed25519",
    status,
    transaction_digest: input.transaction_digest,
    transaction_id: boundedString(
      input.transaction_id,
      "follower result transaction ID",
      255,
    ),
  });
}

export function libraryCoreFollowerResultBodyV1(
  envelope: LibraryCoreFollowerResultEnvelopeV1,
): LibraryCoreFollowerResultBodyV1 {
  const body: Record<string, LibraryCoreCanonicalValue> = {};
  for (const field of BODY_FIELDS)
    body[field] = envelope[field] as LibraryCoreCanonicalValue;
  return body as unknown as LibraryCoreFollowerResultBodyV1;
}

export async function verifyLibraryCoreFollowerResultV1(
  canonicalBytes: Uint8Array,
  authority: LibraryCoreFollowerResultVerificationAuthorityV1,
  verifier: LibraryCoreFollowerResultVerifierV1,
): Promise<LibraryCoreVerifiedFollowerResultV1> {
  const snapshot = new Uint8Array(canonicalBytes);
  const envelope = parseLibraryCoreFollowerResultEnvelopeV1(
    decodeLibraryCoreCanonicalValue(snapshot, {
      maximumBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
    }),
  );
  if (
    envelope.library_id !== authority.libraryId ||
    envelope.epoch !== authority.epoch ||
    envelope.epoch_id !== authority.epochId ||
    envelope.authority_key_id !== authority.authorityKeyId ||
    !isLibraryCoreEd25519PublicKeyHex(authority.authorityPublicKey)
  ) {
    throw new Error("follower result authority is not active");
  }
  const body = libraryCoreFollowerResultBodyV1(envelope);
  const resultDigest = sha256LowerHex(
    encodeLibraryCoreDigestInput(
      "follower-result-body",
      body as unknown as LibraryCoreCanonicalValue,
    ),
  );
  if (resultDigest !== envelope.result_body_digest)
    throw new Error("follower result digest is invalid");
  if (!isLibraryCoreEd25519SignatureHex(envelope.signature)) {
    throw new Error("follower result signature encoding is invalid");
  }
  const valid = await verifier.verifySignature({
    message: encodeLibraryCoreSignatureInput("follower-result-envelope", {
      result_body_digest: resultDigest,
    }),
    publicKeyHex: authority.authorityPublicKey,
    signatureHex: envelope.signature,
  });
  if (!valid) throw new Error("follower result authority signature is invalid");
  const restored = encodeLibraryCoreCanonicalValue(
    envelope as unknown as LibraryCoreCanonicalValue,
    { maximumBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES },
  );
  if (
    restored.byteLength !== snapshot.byteLength ||
    !restored.every((byte, index) => byte === snapshot[index])
  ) {
    throw new Error(
      "follower result canonical snapshot changed during verification",
    );
  }
  return Object.freeze({ canonicalBytes: snapshot, envelope, resultDigest });
}

export interface LibraryCoreFollowerResultApplyV1 {
  readonly canonicalResultBytes: Uint8Array;
}

export interface LibraryCoreFollowerResultApplyReceiptV1 {
  readonly actorId: string;
  readonly resultDigest: string;
  readonly resultSequence: number;
  readonly sourceRevision: number;
  readonly status: LibraryCoreFollowerResultStatusV1;
  readonly transactionId: string;
}

export function parseLibraryCoreFollowerResultApplyV1(
  value: unknown,
): LibraryCoreFollowerResultApplyV1 {
  const input = record(
    value,
    ["canonicalResultBytes"],
    "follower result apply request",
  );
  if (
    !(input.canonicalResultBytes instanceof Uint8Array) ||
    input.canonicalResultBytes.byteLength === 0 ||
    input.canonicalResultBytes.byteLength >
      LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES
  ) {
    throw new TypeError("follower result bytes are invalid");
  }
  return Object.freeze({
    canonicalResultBytes: new Uint8Array(input.canonicalResultBytes),
  });
}

export function parseLibraryCoreFollowerResultApplyReceiptV1(
  value: unknown,
): LibraryCoreFollowerResultApplyReceiptV1 {
  const input = record(
    value,
    [
      "actorId",
      "resultDigest",
      "resultSequence",
      "sourceRevision",
      "status",
      "transactionId",
    ],
    "follower result apply receipt",
  );
  if (
    !isLibraryCoreLowercaseHex64(input.actorId) ||
    !isLibraryCoreLowercaseHex64(input.resultDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(input.resultSequence) ||
    input.resultSequence < 1 ||
    !isLibraryCoreNonnegativeSafeInteger(input.sourceRevision) ||
    (input.status !== "accepted" &&
      input.status !== "already_applied" &&
      input.status !== "rejected") ||
    typeof input.transactionId !== "string"
  ) {
    throw new TypeError("follower result apply receipt is invalid");
  }
  return Object.freeze({
    actorId: input.actorId,
    resultDigest: input.resultDigest,
    resultSequence: input.resultSequence,
    sourceRevision: input.sourceRevision,
    status: input.status,
    transactionId: boundedString(
      input.transactionId,
      "follower result transaction ID",
      255,
    ),
  });
}
