import { FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";
import {
  isLibraryCoreEntityId,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEntityId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS = 4_096;

export interface LibraryCoreCausalTipV1 {
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly sequence: number;
  readonly operation_id: LibraryCoreOperationInstanceId;
  readonly chain_digest: LibraryCoreLowercaseHex64;
}

export interface FeedItemReadAssignmentTransactionMemberInputV1 {
  readonly operation_id: unknown;
  readonly library_id: unknown;
  readonly epoch: unknown;
  readonly epoch_id: unknown;
  readonly actor_id: unknown;
  readonly actor_sequence: unknown;
  readonly previous_actor_operation_id: unknown;
  readonly causal_frontier: unknown;
  readonly hlc_wall_ms: unknown;
  readonly hlc_counter: unknown;
  readonly transaction_id: unknown;
  readonly transaction_member_index: unknown;
  readonly transaction_member_count: unknown;
  readonly entity_id: unknown;
  readonly payload: unknown;
  readonly created_at_ms: unknown;
}

export interface FeedItemReadAssignmentTransactionMemberBodyV1 {
  readonly operation_id: LibraryCoreOperationInstanceId;
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly schema_version: 1;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly actor_sequence: number;
  readonly previous_actor_operation_id: LibraryCoreOperationInstanceId | null;
  readonly causal_frontier: readonly LibraryCoreCausalTipV1[];
  readonly hlc_wall_ms: number;
  readonly hlc_counter: number;
  readonly transaction_id: LibraryCoreOperationInstanceId;
  readonly transaction_member_index: number;
  readonly transaction_member_count: number;
  readonly operation_type: "feed_item_read_assignment";
  readonly entity_type: "FeedItem";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: Readonly<{ read_at_ms: number }>;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface LibraryCoreTransactionMemberConstruction<
  Body = FeedItemReadAssignmentTransactionMemberBodyV1,
> {
  readonly body: Body;
  readonly member_digest: LibraryCoreLowercaseHex64;
}

export type LibraryCoreConstructionDigestDomain =
  | "operation-payload"
  | "transaction-member"
  | "transaction"
  | "actor-chain"
  | "operation-signing-body";

export interface LibraryCoreOperationDigestDependencies {
  readonly digest: (
    domain: LibraryCoreConstructionDigestDomain,
    value: unknown,
  ) => unknown;
}

export interface LibraryCoreTransactionMemberSchemaDescriptor {
  readonly schemaId: string;
  readonly schemaVersion: 1;
  readonly operationType: string;
  readonly entityType: string;
  readonly maximumCausalFrontierTips: number;
}

export interface LibraryCoreTransactionMemberSchema<
  Input,
  Body,
> extends LibraryCoreTransactionMemberSchemaDescriptor {
  readonly construct: (
    input: Input,
    dependencies: LibraryCoreOperationDigestDependencies,
  ) => LibraryCoreTransactionMemberConstruction<Body>;
}

const INPUT_KEYS = [
  "operation_id",
  "library_id",
  "epoch",
  "epoch_id",
  "actor_id",
  "actor_sequence",
  "previous_actor_operation_id",
  "causal_frontier",
  "hlc_wall_ms",
  "hlc_counter",
  "transaction_id",
  "transaction_member_index",
  "transaction_member_count",
  "entity_id",
  "payload",
  "created_at_ms",
] as const;

const CAUSAL_TIP_KEYS = [
  "actor_id",
  "sequence",
  "operation_id",
  "chain_digest",
] as const;

const EMPTY_BLOB_REFERENCES = Object.freeze([]) as readonly [];
const CLOSED_TRANSACTION_MEMBERS = new WeakSet<object>();

export function isLibraryCoreTransactionMemberConstruction(
  value: unknown,
): value is LibraryCoreTransactionMemberConstruction {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  if (!CLOSED_TRANSACTION_MEMBERS.has(value)) {
    return false;
  }
  const candidate = value as Partial<LibraryCoreTransactionMemberConstruction>;
  return (
    typeof candidate.body === "object" &&
    candidate.body !== null &&
    Object.isFrozen(candidate.body) &&
    isLibraryCoreLowercaseHex64(candidate.member_digest)
  );
}

function requirePlainClosedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
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
  const actualKeys = Object.getOwnPropertyNames(value);
  if (
    actualKeys.length !== keys.length ||
    keys.some((key) => !actualKeys.includes(key))
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
  return Object.freeze(snapshot);
}

function readDataProperty(
  record: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new TypeError(`${label}.${key} must be an enumerable data property`);
  }
  return descriptor.value;
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

function requireOperationId(
  value: unknown,
  label: string,
): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${label} must use the bounded operation-ID codec`);
  }
  return value;
}

function requireNonnegativeSafeInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function compareCausalTips(
  left: LibraryCoreCausalTipV1,
  right: LibraryCoreCausalTipV1,
): number {
  if (left.actor_id !== right.actor_id) {
    return left.actor_id < right.actor_id ? -1 : 1;
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  if (left.operation_id !== right.operation_id) {
    return left.operation_id < right.operation_id ? -1 : 1;
  }
  if (left.chain_digest !== right.chain_digest) {
    return left.chain_digest < right.chain_digest ? -1 : 1;
  }
  return 0;
}

function snapshotCausalFrontier(
  value: unknown,
): readonly LibraryCoreCausalTipV1[] {
  if (!Array.isArray(value)) {
    throw new TypeError("causal_frontier must be an array");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError("causal_frontier requires an own array length");
  }
  const length = lengthDescriptor.value;
  if (length > LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS) {
    throw new RangeError(
      `causal_frontier exceeds ${LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS.toLocaleString()} tips`,
    );
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== length + 1 ||
    names[names.length - 1] !== "length" ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError("causal_frontier must be a dense undecorated array");
  }

  const snapshot: LibraryCoreCausalTipV1[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError("causal_frontier requires enumerable data elements");
    }
    const label = `causal_frontier[${index.toLocaleString()}]`;
    const record = requirePlainClosedRecord(
      descriptor.value,
      CAUSAL_TIP_KEYS,
      label,
    );
    const sequence = requireNonnegativeSafeInteger(
      readDataProperty(record, "sequence", label),
      `${label}.sequence`,
    );
    if (sequence === 0) {
      throw new TypeError("causal frontier tips must have positive sequence");
    }
    snapshot.push(
      Object.freeze({
        actor_id: requireHex64(
          readDataProperty(record, "actor_id", label),
          `${label}.actor_id`,
        ),
        sequence,
        operation_id: requireOperationId(
          readDataProperty(record, "operation_id", label),
          `${label}.operation_id`,
        ),
        chain_digest: requireHex64(
          readDataProperty(record, "chain_digest", label),
          `${label}.chain_digest`,
        ),
      }),
    );
  }

  for (let index = 1; index < snapshot.length; index += 1) {
    if (compareCausalTips(snapshot[index - 1], snapshot[index]) >= 0) {
      throw new TypeError(
        "causal_frontier must be strictly sorted with no duplicate tips",
      );
    }
    if (snapshot[index - 1].actor_id === snapshot[index].actor_id) {
      throw new TypeError(
        "causal_frontier may contain only one accepted tip per actor",
      );
    }
  }
  return Object.freeze(snapshot);
}

function constructFeedItemReadAssignmentTransactionMember(
  input: FeedItemReadAssignmentTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreTransactionMemberConstruction {
  const digestValue = dependencies.digest;
  if (typeof digestValue !== "function") {
    throw new TypeError("digest dependency must be callable");
  }
  const record = requirePlainClosedRecord(
    input,
    INPUT_KEYS,
    "transaction member input",
  );
  const actorSequence = requireNonnegativeSafeInteger(
    readDataProperty(record, "actor_sequence", "transaction member input"),
    "actor_sequence",
  );
  if (actorSequence === 0) {
    throw new TypeError("actor_sequence must be positive");
  }
  const previousCandidate = readDataProperty(
    record,
    "previous_actor_operation_id",
    "transaction member input",
  );
  const previousOperationId =
    previousCandidate === null
      ? null
      : requireOperationId(previousCandidate, "previous_actor_operation_id");
  if (
    (actorSequence === 1 && previousOperationId !== null) ||
    (actorSequence > 1 && previousOperationId === null)
  ) {
    throw new TypeError(
      "previous_actor_operation_id nullability must match actor_sequence",
    );
  }
  const memberCount = requireNonnegativeSafeInteger(
    readDataProperty(
      record,
      "transaction_member_count",
      "transaction member input",
    ),
    "transaction_member_count",
  );
  if (memberCount === 0 || memberCount > 1_000) {
    throw new RangeError(
      "transaction_member_count must be between 1 and 1,000",
    );
  }
  const memberIndex = requireNonnegativeSafeInteger(
    readDataProperty(
      record,
      "transaction_member_index",
      "transaction member input",
    ),
    "transaction_member_index",
  );
  if (memberIndex >= memberCount) {
    throw new RangeError(
      "transaction_member_index must be below transaction_member_count",
    );
  }
  const epoch = requireNonnegativeSafeInteger(
    readDataProperty(record, "epoch", "transaction member input"),
    "epoch",
  );
  if (epoch === 0) throw new TypeError("epoch must be positive");
  const entityCandidate = readDataProperty(
    record,
    "entity_id",
    "transaction member input",
  );
  if (!isLibraryCoreEntityId(entityCandidate)) {
    throw new TypeError("entity_id must use the bounded v1 entity-ID codec");
  }
  const payloadResult = FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA.validate(
    readDataProperty(record, "payload", "transaction member input"),
  );
  if (!payloadResult.ok) {
    throw new TypeError(payloadResult.reason);
  }
  const payloadDigest = digestValue("operation-payload", {
    schema_version: 1,
    operation_type: "feed_item_read_assignment",
    payload: payloadResult.value,
  });
  if (!isLibraryCoreLowercaseHex64(payloadDigest)) {
    throw new TypeError("digest dependency returned an invalid payload digest");
  }

  const body = Object.freeze({
    operation_id: requireOperationId(
      readDataProperty(record, "operation_id", "transaction member input"),
      "operation_id",
    ),
    library_id: requireHex64(
      readDataProperty(record, "library_id", "transaction member input"),
      "library_id",
    ),
    epoch,
    epoch_id: requireHex64(
      readDataProperty(record, "epoch_id", "transaction member input"),
      "epoch_id",
    ),
    schema_version: 1,
    actor_id: requireHex64(
      readDataProperty(record, "actor_id", "transaction member input"),
      "actor_id",
    ),
    actor_sequence: actorSequence,
    previous_actor_operation_id: previousOperationId,
    causal_frontier: snapshotCausalFrontier(
      readDataProperty(record, "causal_frontier", "transaction member input"),
    ),
    hlc_wall_ms: requireNonnegativeSafeInteger(
      readDataProperty(record, "hlc_wall_ms", "transaction member input"),
      "hlc_wall_ms",
    ),
    hlc_counter: requireNonnegativeSafeInteger(
      readDataProperty(record, "hlc_counter", "transaction member input"),
      "hlc_counter",
    ),
    transaction_id: requireOperationId(
      readDataProperty(record, "transaction_id", "transaction member input"),
      "transaction_id",
    ),
    transaction_member_index: memberIndex,
    transaction_member_count: memberCount,
    operation_type: "feed_item_read_assignment",
    entity_type: "FeedItem",
    entity_id: entityCandidate,
    payload: payloadResult.value,
    payload_digest: payloadDigest,
    blob_references: EMPTY_BLOB_REFERENCES,
    created_at_ms: requireNonnegativeSafeInteger(
      readDataProperty(record, "created_at_ms", "transaction member input"),
      "created_at_ms",
    ),
    signature_algorithm: "ed25519",
  }) satisfies FeedItemReadAssignmentTransactionMemberBodyV1;
  const memberDigest = digestValue("transaction-member", body);
  if (!isLibraryCoreLowercaseHex64(memberDigest)) {
    throw new TypeError("digest dependency returned an invalid member digest");
  }
  const construction = Object.freeze({
    body,
    member_digest: memberDigest,
  });
  CLOSED_TRANSACTION_MEMBERS.add(construction);
  return construction;
}

/**
 * Closed construction schema for the first dormant Library Core operation.
 *
 * This creates only the transaction-member body and its digest. It does not
 * validate received bytes, derive a transaction or actor chain, sign an
 * envelope, materialize a row, or grant runtime authority.
 */
export const FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA =
  Object.freeze({
    schemaId: "feed_item_read_assignment_transaction_member_v1",
    schemaVersion: 1,
    operationType: "feed_item_read_assignment",
    entityType: "FeedItem",
    maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
    construct: constructFeedItemReadAssignmentTransactionMember,
  }) satisfies LibraryCoreTransactionMemberSchema<
    FeedItemReadAssignmentTransactionMemberInputV1,
    FeedItemReadAssignmentTransactionMemberBodyV1
  >;
