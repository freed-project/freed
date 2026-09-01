import {
  snapshotLibraryCoreCausalFrontier,
  type LibraryCoreCausalTipV1,
} from "./operation-envelope-contracts.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export interface LibraryCoreFollowerMutationContextV1 {
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly actor_public_key: LibraryCoreEd25519PublicKeyHex;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreOperationInstanceId;
  readonly library_id: LibraryCoreOperationInstanceId;
  readonly next_actor_sequence: number;
  readonly observed_frontier: readonly LibraryCoreCausalTipV1[];
  readonly previous_actor_chain_digest: LibraryCoreLowercaseHex64;
  readonly previous_actor_operation_id: LibraryCoreOperationInstanceId | null;
  readonly schema_version: 1;
}

const CONTEXT_KEYS = [
  "actor_id",
  "actor_public_key",
  "epoch",
  "epoch_id",
  "library_id",
  "next_actor_sequence",
  "observed_frontier",
  "previous_actor_chain_digest",
  "previous_actor_operation_id",
  "schema_version",
] as const;

function closedRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError("follower mutation context must be a closed record");
  }
  const actual = Object.keys(value).sort();
  const expected = [...CONTEXT_KEYS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("follower mutation context fields are invalid");
  }
  return value as Record<string, unknown>;
}

export function parseLibraryCoreFollowerMutationContextV1(
  value: unknown,
): LibraryCoreFollowerMutationContextV1 {
  const input = closedRecord(value);
  if (
    input.schema_version !== 1 ||
    !isLibraryCoreOperationInstanceId(input.library_id) ||
    !isLibraryCoreOperationInstanceId(input.epoch_id) ||
    !isLibraryCoreLowercaseHex64(input.actor_id) ||
    !isLibraryCoreEd25519PublicKeyHex(input.actor_public_key) ||
    !isLibraryCoreNonnegativeSafeInteger(input.epoch) ||
    input.epoch < 1 ||
    !isLibraryCoreNonnegativeSafeInteger(input.next_actor_sequence) ||
    input.next_actor_sequence < 1 ||
    !isLibraryCoreLowercaseHex64(input.previous_actor_chain_digest) ||
    (input.previous_actor_operation_id !== null &&
      !isLibraryCoreOperationInstanceId(input.previous_actor_operation_id))
  ) {
    throw new TypeError("follower mutation context identity is invalid");
  }
  if (
    (input.next_actor_sequence === 1) !==
    (input.previous_actor_operation_id === null)
  ) {
    throw new TypeError("follower mutation context actor tip is invalid");
  }
  return Object.freeze({
    actor_id: input.actor_id,
    actor_public_key: input.actor_public_key,
    epoch: input.epoch,
    epoch_id: input.epoch_id,
    library_id: input.library_id,
    next_actor_sequence: input.next_actor_sequence,
    observed_frontier: snapshotLibraryCoreCausalFrontier(
      input.observed_frontier,
      "follower mutation context frontier",
    ),
    previous_actor_chain_digest: input.previous_actor_chain_digest,
    previous_actor_operation_id: input.previous_actor_operation_id,
    schema_version: 1,
  });
}
