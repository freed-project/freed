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
  FeedItemReadAssignmentTransactionMemberBodyV1,
  LibraryCoreOperationDigestDependencies,
  LibraryCoreTransactionMemberConstruction,
} from "./operation-envelope-contracts.js";
import { isLibraryCoreTransactionMemberConstruction } from "./operation-envelope-contracts.js";

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

export interface LibraryCoreSigningMemberV1 {
  readonly member_digest: LibraryCoreLowercaseHex64;
  readonly signing_body: FeedItemReadAssignmentSigningBodyV1;
  readonly signing_body_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreAssembledTransactionV1 {
  readonly transaction_body: LibraryCoreTransactionBodyV1;
  readonly transaction_digest: LibraryCoreLowercaseHex64;
  readonly members: readonly LibraryCoreSigningMemberV1[];
  readonly canonical_member_bytes: number;
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

function requireDenseConstructionArray(
  value: readonly LibraryCoreTransactionMemberConstruction[],
): void {
  if (!Array.isArray(value)) {
    throw new TypeError("transaction members must be an array");
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== value.length + 1 ||
    names[names.length - 1] !== "length" ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(
      "transaction members must be a dense undecorated array",
    );
  }
  for (let index = 0; index < value.length; index += 1) {
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
  }
}

function digest(
  dependencies: LibraryCoreOperationDigestDependencies,
  domain: "transaction" | "actor-chain" | "operation-signing-body",
  value: LibraryCoreCanonicalValue,
): LibraryCoreLowercaseHex64 {
  return requireDigest(
    dependencies.digest(domain, value),
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
  requireDenseConstructionArray(members);
  if (members.length === 0 || members.length > 1_000) {
    throw new RangeError(
      "a transaction must contain between 1 and 1,000 members",
    );
  }
  const initialChainDigest = requireDigest(
    initialPreviousActorChainDigest,
    "initial previous actor chain digest",
  );
  if (!isLibraryCoreTransactionMemberConstruction(members[0])) {
    throw new TypeError(
      "transaction members must come from a closed member construction schema",
    );
  }
  const first = members[0].body;
  const memberDigests: LibraryCoreLowercaseHex64[] = [];
  const operationIds = new Set<string>();
  let canonicalMemberBytes = 0;

  for (let index = 0; index < members.length; index += 1) {
    const construction = members[index];
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
      member.transaction_member_count !== members.length ||
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
        members[index - 1].body.operation_id
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
    transaction_member_count: members.length,
    actor_id: first.actor_id,
    initial_previous_actor_operation_id: first.previous_actor_operation_id,
    initial_previous_actor_chain_digest: initialChainDigest,
    transaction_member_digests: Object.freeze(memberDigests),
  }) satisfies LibraryCoreTransactionBodyV1;
  const transactionDigest = digest(
    dependencies,
    "transaction",
    transactionBody as unknown as LibraryCoreCanonicalValue,
  );

  const signingMembers: LibraryCoreSigningMemberV1[] = [];
  let previousChainDigest = initialChainDigest;
  for (let index = 0; index < members.length; index += 1) {
    const construction = members[index];
    const actorChainDigest = digest(dependencies, "actor-chain", {
      previous_actor_chain_digest: previousChainDigest,
      transaction_member_digest: construction.member_digest,
      transaction_digest: transactionDigest,
    });
    const signingBody = Object.freeze({
      ...construction.body,
      previous_actor_chain_digest: previousChainDigest,
      actor_chain_digest: actorChainDigest,
      transaction_digest: transactionDigest,
    }) satisfies FeedItemReadAssignmentSigningBodyV1;
    const signingBodyDigest = digest(
      dependencies,
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

  return Object.freeze({
    transaction_body: transactionBody,
    transaction_digest: transactionDigest,
    members: Object.freeze(signingMembers),
    canonical_member_bytes: canonicalMemberBytes,
  });
}
