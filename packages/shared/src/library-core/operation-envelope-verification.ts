import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreOperationSignatureInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type LibraryCoreConstructionDigestDomain,
} from "./operation-envelope-contracts.js";
import {
  LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES,
  type LibraryCoreOperationEnvelopeV1,
} from "./operation-envelope-finalization.js";
import {
  assembleLibraryCoreTransactionV1,
  type LibraryCoreTransactionBodyV1,
} from "./operation-transaction-contracts.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

const VERIFIED_OPERATION_TRANSACTIONS = new WeakSet<object>();

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

const ACCEPTED_ACTOR_STATE_KEYS = [
  "library_id",
  "epoch",
  "epoch_id",
  "actor_id",
  "actor_public_key",
  "next_actor_sequence",
  "previous_actor_operation_id",
  "previous_actor_chain_digest",
] as const;

const textDecoder = new TextDecoder("utf-8", { fatal: true });

export interface LibraryCoreAcceptedActorStateV1 {
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly actor_public_key: LibraryCoreEd25519PublicKeyHex;
  readonly next_actor_sequence: number;
  readonly previous_actor_operation_id: LibraryCoreOperationInstanceId | null;
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreVerifiedOperationEnvelopeV1 {
  readonly envelope: LibraryCoreOperationEnvelopeV1;
  readonly member_digest: LibraryCoreLowercaseHex64;
  readonly signing_body_digest: LibraryCoreLowercaseHex64;
  readonly envelope_digest: LibraryCoreLowercaseHex64;
  readonly canonical_envelope_json: string;
  readonly canonical_envelope_bytes: number;
}

export interface LibraryCoreVerifiedOperationTransactionV1 {
  readonly transaction_body: LibraryCoreTransactionBodyV1;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
  readonly members: readonly LibraryCoreVerifiedOperationEnvelopeV1[];
  readonly canonical_envelope_bytes: number;
  readonly accepted_actor_state: LibraryCoreAcceptedActorStateV1;
}

export interface LibraryCoreOperationVerificationDependencies {
  readonly digest: (
    domain: LibraryCoreConstructionDigestDomain | "operation-envelope",
    value: unknown,
  ) => unknown;
  readonly verifySignature: (input: {
    readonly publicKeyHex: LibraryCoreEd25519PublicKeyHex;
    readonly signatureHex: LibraryCoreEd25519SignatureHex;
    readonly message: Uint8Array;
  }) => Promise<boolean>;
}

function requireClosedRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  label: string,
): Readonly<Record<Keys[number], unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} may not contain symbol keys`);
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== keys.length ||
    keys.some((key) => !names.includes(key))
  ) {
    throw new TypeError(`${label} has an invalid field set`);
  }
  const snapshot: Record<string, unknown> = {};
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
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot) as Readonly<Record<Keys[number], unknown>>;
}

function requireHex64(
  value: unknown,
  label: string,
): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters`);
  }
  return value;
}

function requireSignature(
  value: unknown,
  label: string,
): LibraryCoreEd25519SignatureHex {
  if (!isLibraryCoreEd25519SignatureHex(value)) {
    throw new TypeError(
      `${label} must be 128 lowercase hexadecimal characters`,
    );
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value === 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function digest(
  digestValue: LibraryCoreOperationVerificationDependencies["digest"],
  domain: LibraryCoreConstructionDigestDomain | "operation-envelope",
  value: unknown,
): LibraryCoreLowercaseHex64 {
  const result = digestValue(domain, value);
  if (!isLibraryCoreLowercaseHex64(result)) {
    throw new TypeError(
      `${domain} digest dependency returned an invalid digest`,
    );
  }
  return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function requireCanonicalEquality(
  received: unknown,
  expected: unknown,
  label: string,
): void {
  const receivedBytes = encodeLibraryCoreCanonicalValue(
    received as LibraryCoreCanonicalValue,
  );
  const expectedBytes = encodeLibraryCoreCanonicalValue(
    expected as LibraryCoreCanonicalValue,
  );
  if (!bytesEqual(receivedBytes, expectedBytes)) {
    throw new TypeError(`${label} does not match its derived canonical value`);
  }
}

function snapshotAcceptedActorState(
  value: unknown,
): LibraryCoreAcceptedActorStateV1 {
  const record = requireClosedRecord(
    value,
    ACCEPTED_ACTOR_STATE_KEYS,
    "accepted actor state",
  );
  const nextSequence = requirePositiveSafeInteger(
    record.next_actor_sequence,
    "accepted actor state.next_actor_sequence",
  );
  const previousOperation =
    record.previous_actor_operation_id === null
      ? null
      : isLibraryCoreOperationInstanceId(record.previous_actor_operation_id)
        ? record.previous_actor_operation_id
        : undefined;
  if (previousOperation === undefined) {
    throw new TypeError(
      "accepted actor state.previous_actor_operation_id must use the bounded operation-ID codec or be null",
    );
  }
  if (
    (nextSequence === 1 && previousOperation !== null) ||
    (nextSequence > 1 && previousOperation === null)
  ) {
    throw new TypeError(
      "accepted actor state predecessor nullability must match next sequence",
    );
  }
  if (!isLibraryCoreEd25519PublicKeyHex(record.actor_public_key)) {
    throw new TypeError(
      "accepted actor state.actor_public_key must be 64 lowercase hexadecimal characters",
    );
  }
  return Object.freeze({
    library_id: requireHex64(
      record.library_id,
      "accepted actor state.library_id",
    ),
    epoch: requirePositiveSafeInteger(
      record.epoch,
      "accepted actor state.epoch",
    ),
    epoch_id: requireHex64(record.epoch_id, "accepted actor state.epoch_id"),
    actor_id: requireHex64(record.actor_id, "accepted actor state.actor_id"),
    actor_public_key: record.actor_public_key,
    next_actor_sequence: nextSequence,
    previous_actor_operation_id: previousOperation,
    previous_actor_chain_digest: requireHex64(
      record.previous_actor_chain_digest,
      "accepted actor state.previous_actor_chain_digest",
    ),
  });
}

function requireDenseEnvelopeBytes(
  value: readonly Uint8Array[],
): readonly Uint8Array[] {
  if (!Array.isArray(value)) {
    throw new TypeError("operation envelope bytes must be an array");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError("operation envelope bytes require an own array length");
  }
  const length = lengthDescriptor.value;
  if (length === 0 || length > 1_000) {
    throw new RangeError(
      "a verified transaction must contain between 1 and 1,000 envelopes",
    );
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== length + 1 ||
    names[names.length - 1] !== "length" ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(
      "operation envelope bytes must be a dense undecorated array",
    );
  }
  let total = 0;
  const snapshots: Uint8Array[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      !(descriptor.value instanceof Uint8Array)
    ) {
      throw new TypeError(
        "operation envelope bytes require enumerable Uint8Array data elements",
      );
    }
    const snapshot = new Uint8Array(descriptor.value);
    total += snapshot.byteLength;
    if (total > LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES) {
      throw new RangeError(
        "transaction canonical envelope bytes exceed 4,194,304",
      );
    }
    snapshots.push(snapshot);
  }
  return Object.freeze(snapshots);
}

function memberInputFromEnvelope(
  envelope: Readonly<Record<(typeof ENVELOPE_KEYS)[number], unknown>>,
): FeedItemReadAssignmentTransactionMemberInputV1 {
  return {
    operation_id: envelope.operation_id,
    library_id: envelope.library_id,
    epoch: envelope.epoch,
    epoch_id: envelope.epoch_id,
    actor_id: envelope.actor_id,
    actor_sequence: envelope.actor_sequence,
    previous_actor_operation_id: envelope.previous_actor_operation_id,
    causal_frontier: envelope.causal_frontier,
    hlc_wall_ms: envelope.hlc_wall_ms,
    hlc_counter: envelope.hlc_counter,
    transaction_id: envelope.transaction_id,
    transaction_member_index: envelope.transaction_member_index,
    transaction_member_count: envelope.transaction_member_count,
    entity_id: envelope.entity_id,
    payload: envelope.payload,
    created_at_ms: envelope.created_at_ms,
  };
}

export function isLibraryCoreVerifiedOperationTransactionV1(
  value: unknown,
): value is LibraryCoreVerifiedOperationTransactionV1 {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  return VERIFIED_OPERATION_TRANSACTIONS.has(value);
}

/**
 * Verify one complete canonical operation transaction against an exact
 * accepted actor tip.
 *
 * This is cryptographic and structural admission only. It does not prove the
 * causal frontier against current storage, resolve retries or conflicts,
 * recheck the actor tip atomically, persist, materialize, replicate, contact
 * providers, or grant runtime writer authority.
 */
export async function verifyLibraryCoreOperationTransactionV1(
  envelopeBytes: readonly Uint8Array[],
  acceptedActorState: unknown,
  dependencies: LibraryCoreOperationVerificationDependencies,
): Promise<LibraryCoreVerifiedOperationTransactionV1> {
  const digestValue = dependencies.digest;
  const verifySignature = dependencies.verifySignature;
  if (
    typeof digestValue !== "function" ||
    typeof verifySignature !== "function"
  ) {
    throw new TypeError("operation verification dependencies must be callable");
  }
  const digestDependencies = Object.freeze({ digest: digestValue });
  const actorState = snapshotAcceptedActorState(acceptedActorState);
  const byteSnapshots = requireDenseEnvelopeBytes(envelopeBytes);
  const decodedEnvelopes = byteSnapshots.map((bytes, index) =>
    requireClosedRecord(
      decodeLibraryCoreCanonicalValue(bytes),
      ENVELOPE_KEYS,
      `operation envelope[${index.toLocaleString()}]`,
    ),
  );
  const memberConstructions = decodedEnvelopes.map((envelope) => {
    const schema =
      envelope.operation_type === "feed_item_capture_upsert"
        ? FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA
        : envelope.operation_type === "feed_item_read_assignment"
          ? FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
          : envelope.operation_type === "feed_item_saved_assignment"
            ? FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
            : envelope.operation_type === "feed_item_archive_assignment"
              ? FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
              : envelope.operation_type === "feed_item_like_assignment"
                ? FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
                : envelope.operation_type === "feed_item_remove"
                  ? FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA
                  : envelope.operation_type === "rss_feed_upsert"
                    ? RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA
                    : envelope.operation_type === "rss_feed_remove_keep_items"
                      ? RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA
                      : envelope.operation_type === "rss_feed_remove_with_items"
                        ? RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA
                        : envelope.operation_type ===
                            "preferences_leaf_assignment"
                          ? PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
                          : envelope.operation_type === "person_upsert"
                            ? PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA
                            : envelope.operation_type ===
                                "person_remove_and_accounts"
                              ? PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA
                              : null;
    if (schema === null) {
      throw new TypeError(
        "operation envelope has an unsupported operation_type",
      );
    }
    return schema.construct(
      memberInputFromEnvelope(envelope),
      digestDependencies,
    );
  });
  const firstBody = memberConstructions[0].body;
  if (
    firstBody.library_id !== actorState.library_id ||
    firstBody.epoch !== actorState.epoch ||
    firstBody.epoch_id !== actorState.epoch_id ||
    firstBody.actor_id !== actorState.actor_id
  ) {
    throw new TypeError(
      "operation transaction does not match accepted actor identity",
    );
  }
  if (
    firstBody.actor_sequence !== actorState.next_actor_sequence ||
    firstBody.previous_actor_operation_id !==
      actorState.previous_actor_operation_id
  ) {
    throw new TypeError(
      "operation transaction does not extend accepted actor tip",
    );
  }

  const assembled = assembleLibraryCoreTransactionV1(
    memberConstructions,
    actorState.previous_actor_chain_digest,
    digestDependencies,
  );
  const signatures: LibraryCoreEd25519SignatureHex[] = [];
  for (let index = 0; index < decodedEnvelopes.length; index += 1) {
    const received = decodedEnvelopes[index];
    const expectedSigningBody = assembled.members[index].signing_body;
    const receivedSigningBody = Object.fromEntries(
      Object.entries(received).filter(([key]) => key !== "signature"),
    );
    requireCanonicalEquality(
      receivedSigningBody,
      expectedSigningBody,
      `operation envelope[${index.toLocaleString()}] signing body`,
    );
    signatures.push(
      requireSignature(
        received.signature,
        `operation envelope[${index.toLocaleString()}].signature`,
      ),
    );
  }

  for (let index = 0; index < assembled.members.length; index += 1) {
    const valid = await verifySignature({
      publicKeyHex: actorState.actor_public_key,
      signatureHex: signatures[index],
      message: encodeLibraryCoreOperationSignatureInput({
        operation_signing_body_digest:
          assembled.members[index].signing_body_digest,
      }),
    });
    if (valid !== true) {
      throw new TypeError(
        `operation envelope[${index.toLocaleString()}] signature is invalid`,
      );
    }
  }

  const verifiedMembers = assembled.members.map((member, index) => {
    const envelope = Object.freeze({
      ...member.signing_body,
      signature: signatures[index],
    }) as LibraryCoreOperationEnvelopeV1;
    return Object.freeze({
      envelope,
      member_digest: member.member_digest,
      signing_body_digest: member.signing_body_digest,
      envelope_digest: digest(digestValue, "operation-envelope", envelope),
      canonical_envelope_json: textDecoder.decode(byteSnapshots[index]),
      canonical_envelope_bytes: byteSnapshots[index].byteLength,
    });
  });
  const canonicalEnvelopeBytes = verifiedMembers.reduce(
    (total, member) => total + member.canonical_envelope_bytes,
    0,
  );

  const verified = Object.freeze({
    transaction_body: assembled.transaction_body,
    transaction_digest: assembled.transaction_digest,
    members: Object.freeze(verifiedMembers),
    canonical_envelope_bytes: canonicalEnvelopeBytes,
    accepted_actor_state: actorState,
  });
  VERIFIED_OPERATION_TRANSACTIONS.add(verified);
  return verified;
}
