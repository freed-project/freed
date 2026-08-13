import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  isLibraryCoreLowercaseHex64,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";
import type {
  FeedItemCaptureUpsertTransactionMemberBodyV1,
  FeedItemReadAssignmentTransactionMemberBodyV1,
  FeedItemRemoveTransactionMemberBodyV1,
  FeedItemUserStateAssignmentTransactionMemberBodyV1,
  RssFeedRemoveTransactionMemberBodyV1,
  RssFeedUpsertTransactionMemberBodyV1,
  PreferencesLeafAssignmentTransactionMemberBodyV1,
  LibraryCoreOperationDigestDependencies,
  LibraryCoreTransactionMemberConstruction,
} from "./operation-envelope-contracts.js";
import { isLibraryCoreTransactionMemberConstruction } from "./operation-envelope-contracts.js";

const ASSEMBLED_LIBRARY_CORE_TRANSACTIONS = new WeakSet<object>();

export interface LibraryCoreTransactionBodyV1 {
  readonly transaction_id: LibraryCoreOperationInstanceId;
  readonly transaction_member_count: number;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly initial_previous_actor_operation_id: LibraryCoreOperationInstanceId | null;
  readonly initial_previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_member_digests: readonly LibraryCoreLowercaseHex64[];
}

export interface FeedItemReadAssignmentSigningBodyV1 extends FeedItemReadAssignmentTransactionMemberBodyV1 {
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
}

export interface FeedItemCaptureUpsertSigningBodyV1 extends FeedItemCaptureUpsertTransactionMemberBodyV1 {
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
}

export interface FeedItemUserStateAssignmentSigningBodyV1 extends FeedItemUserStateAssignmentTransactionMemberBodyV1 {
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
}

export interface FeedItemRemoveSigningBodyV1 extends FeedItemRemoveTransactionMemberBodyV1 {
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
}

export interface RssFeedUpsertSigningBodyV1 extends RssFeedUpsertTransactionMemberBodyV1 {
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
}

export interface RssFeedRemoveSigningBodyV1 extends RssFeedRemoveTransactionMemberBodyV1 {
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
}

export interface PreferencesLeafAssignmentSigningBodyV1 extends PreferencesLeafAssignmentTransactionMemberBodyV1 {
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
}

export type LibraryCoreOperationSigningBodyV1 =
  | FeedItemCaptureUpsertSigningBodyV1
  | FeedItemReadAssignmentSigningBodyV1
  | FeedItemUserStateAssignmentSigningBodyV1
  | FeedItemRemoveSigningBodyV1
  | RssFeedUpsertSigningBodyV1
  | RssFeedRemoveSigningBodyV1
  | PreferencesLeafAssignmentSigningBodyV1;

export interface LibraryCoreSigningMemberV1 {
  readonly member_digest: LibraryCoreLowercaseHex64;
  readonly signing_body: LibraryCoreOperationSigningBodyV1;
  readonly signing_body_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreAssembledTransactionV1 {
  readonly transaction_body: LibraryCoreTransactionBodyV1;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
  readonly members: readonly LibraryCoreSigningMemberV1[];
  readonly canonical_member_bytes: number;
}

export function isLibraryCoreAssembledTransactionV1(
  value: unknown,
): value is LibraryCoreAssembledTransactionV1 {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  return ASSEMBLED_LIBRARY_CORE_TRANSACTIONS.has(value);
}

function requireDigest(
  value: unknown,
  label: string,
): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters`);
  }
  return value;
}

function snapshotDenseConstructionArray(
  value: readonly LibraryCoreTransactionMemberConstruction[],
): readonly LibraryCoreTransactionMemberConstruction[] {
  if (!Array.isArray(value)) {
    throw new TypeError("transaction members must be an array");
  }
  const names = Object.getOwnPropertyNames(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable ||
    !("value" in lengthDescriptor)
  ) {
    throw new TypeError("transaction members require an own length");
  }
  const length = lengthDescriptor.value as number;
  if (
    names.length !== length + 1 ||
    names[names.length - 1] !== "length" ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(
      "transaction members must be a dense undecorated array",
    );
  }
  const snapshot: LibraryCoreTransactionMemberConstruction[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        "transaction members require enumerable data elements",
      );
    }
    snapshot.push(descriptor.value as LibraryCoreTransactionMemberConstruction);
  }
  return Object.freeze(snapshot);
}

function digest(
  digestValue: LibraryCoreOperationDigestDependencies["digest"],
  domain: "transaction" | "actor-chain" | "operation-signing-body",
  value: LibraryCoreCanonicalValue,
): LibraryCoreLowercaseHex64 {
  return requireDigest(
    digestValue(domain, value),
    `${domain} digest dependency result`,
  );
}

/**
 * Assemble already constructed members into one exact v1 transaction and
 * derive its actor-chain links and signing bodies.
 *
 * This is construction only. It does not sign, verify inbound bytes, persist,
 * materialize, enqueue replication, or grant runtime authority.
 */
export function assembleLibraryCoreTransactionV1(
  members: readonly LibraryCoreTransactionMemberConstruction[],
  initialPreviousActorChainDigest: unknown,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreAssembledTransactionV1 {
  const digestValue = dependencies.digest;
  if (typeof digestValue !== "function") {
    throw new TypeError("transaction digest dependency must be callable");
  }
  const memberSnapshot = snapshotDenseConstructionArray(members);
  if (memberSnapshot.length === 0 || memberSnapshot.length > 1_000) {
    throw new RangeError(
      "a transaction must contain between 1 and 1,000 members",
    );
  }
  const initialChainDigest = requireDigest(
    initialPreviousActorChainDigest,
    "initial previous actor chain digest",
  );
  if (!isLibraryCoreTransactionMemberConstruction(memberSnapshot[0])) {
    throw new TypeError(
      "transaction members must come from a closed member construction schema",
    );
  }
  const first = memberSnapshot[0].body;
  const memberDigests: LibraryCoreLowercaseHex64[] = [];
  const operationIds = new Set<string>();
  let canonicalMemberBytes = 0;

  for (let index = 0; index < memberSnapshot.length; index += 1) {
    const construction = memberSnapshot[index];
    if (!isLibraryCoreTransactionMemberConstruction(construction)) {
      throw new TypeError(
        "transaction members must come from a closed member construction schema",
      );
    }
    const member = construction.body;
    if (
      member.library_id !== first.library_id ||
      member.epoch !== first.epoch ||
      member.epoch_id !== first.epoch_id ||
      member.schema_version !== first.schema_version ||
      member.actor_id !== first.actor_id ||
      member.transaction_id !== first.transaction_id ||
      member.transaction_member_count !== memberSnapshot.length ||
      member.transaction_member_index !== index
    ) {
      throw new TypeError(
        "transaction members must share one identity and contiguous index set",
      );
    }
    const expectedSequence = first.actor_sequence + index;
    if (
      !Number.isSafeInteger(expectedSequence) ||
      member.actor_sequence !== expectedSequence
    ) {
      throw new TypeError("transaction actor sequences must be contiguous");
    }
    if (
      index > 0 &&
      member.previous_actor_operation_id !==
        memberSnapshot[index - 1].body.operation_id
    ) {
      throw new TypeError(
        "each transaction member must name the previous member operation",
      );
    }
    if (operationIds.has(member.operation_id)) {
      throw new TypeError("transaction operation IDs must be unique");
    }
    operationIds.add(member.operation_id);
    memberDigests.push(construction.member_digest);
    canonicalMemberBytes += encodeLibraryCoreCanonicalValue(
      member as unknown as LibraryCoreCanonicalValue,
    ).byteLength;
    if (canonicalMemberBytes > 4_194_304) {
      throw new RangeError(
        "transaction canonical member bytes exceed 4,194,304",
      );
    }
  }

  const transactionBody = Object.freeze({
    transaction_id: first.transaction_id,
    transaction_member_count: memberSnapshot.length,
    actor_id: first.actor_id,
    initial_previous_actor_operation_id: first.previous_actor_operation_id,
    initial_previous_actor_chain_digest: initialChainDigest,
    transaction_member_digests: Object.freeze(memberDigests),
  }) satisfies LibraryCoreTransactionBodyV1;
  const transactionDigest = digest(
    digestValue,
    "transaction",
    transactionBody as unknown as LibraryCoreCanonicalValue,
  );

  const signingMembers: LibraryCoreSigningMemberV1[] = [];
  let previousChainDigest = initialChainDigest;
  for (let index = 0; index < memberSnapshot.length; index += 1) {
    const construction = memberSnapshot[index];
    const actorChainDigest = digest(digestValue, "actor-chain", {
      previous_actor_chain_digest: previousChainDigest,
      transaction_member_digest: construction.member_digest,
      transaction_digest: transactionDigest,
    });
    const signingBody = Object.freeze({
      ...construction.body,
      previous_actor_chain_digest: previousChainDigest,
      actor_chain_digest: actorChainDigest,
      transaction_digest: transactionDigest,
    }) as LibraryCoreOperationSigningBodyV1;
    const signingBodyDigest = digest(
      digestValue,
      "operation-signing-body",
      signingBody as unknown as LibraryCoreCanonicalValue,
    );
    signingMembers.push(
      Object.freeze({
        member_digest: construction.member_digest,
        signing_body: signingBody,
        signing_body_digest: signingBodyDigest,
      }),
    );
    previousChainDigest = actorChainDigest;
  }

  const assembled = Object.freeze({
    transaction_body: transactionBody,
    transaction_digest: transactionDigest,
    members: Object.freeze(signingMembers),
    canonical_member_bytes: canonicalMemberBytes,
  });
  ASSEMBLED_LIBRARY_CORE_TRANSACTIONS.add(assembled);
  return assembled;
}
