import {
  LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
  LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES,
} from "./operation-envelope-finalization.js";

export const LIBRARY_CORE_FOLLOWER_INTENT_MEMBER_LIMIT = 1_000;

export interface LibraryCoreFollowerIntentCommitV1 {
  readonly envelopeBytes: readonly Uint8Array[];
}

export interface LibraryCoreFollowerIntentCommitResultV1 {
  readonly actorId: string;
  readonly firstCounter: number;
  readonly lastCounter: number;
  readonly memberCount: number;
  readonly optimisticFieldCount: number;
  readonly state: "pending" | "published";
  readonly transactionId: string;
}

/**
 * Snapshot one complete signed follower transaction before it crosses an
 * asynchronous worker or SQLite boundary.
 */
export function parseLibraryCoreFollowerIntentCommitV1(
  value: unknown,
): LibraryCoreFollowerIntentCommitV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("follower intent commit must be a closed record");
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== 1 || names[0] !== "envelopeBytes") {
    throw new TypeError("follower intent commit has an invalid field set");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "envelopeBytes");
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor) ||
    !Array.isArray(descriptor.value) ||
    descriptor.value.length === 0 ||
    descriptor.value.length > LIBRARY_CORE_FOLLOWER_INTENT_MEMBER_LIMIT
  ) {
    throw new TypeError("follower intent envelopes must be a bounded dense array");
  }
  const snapshots: Uint8Array[] = [];
  let totalBytes = 0;
  for (let index = 0; index < descriptor.value.length; index += 1) {
    const member = Object.getOwnPropertyDescriptor(descriptor.value, String(index));
    if (
      member === undefined ||
      !member.enumerable ||
      !("value" in member) ||
      !(member.value instanceof Uint8Array)
    ) {
      throw new TypeError("follower intent envelopes must contain Uint8Array values");
    }
    const snapshot = new Uint8Array(member.value);
    if (
      snapshot.byteLength === 0 ||
      snapshot.byteLength > LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES
    ) {
      throw new RangeError("one follower intent envelope exceeds 131,072 bytes");
    }
    totalBytes += snapshot.byteLength;
    if (totalBytes > LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES) {
      throw new RangeError("follower intent transaction exceeds 4,194,304 bytes");
    }
    snapshots.push(snapshot);
  }
  return Object.freeze({ envelopeBytes: Object.freeze(snapshots) });
}

