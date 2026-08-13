import {
  FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_PAYLOAD_SCHEMA,
  FEED_ITEM_REMOVE_PAYLOAD_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_PAYLOAD_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA,
  RSS_FEED_UPSERT_PAYLOAD_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA,
  PERSON_UPSERT_PAYLOAD_SCHEMA,
  type FeedItemCaptureUpsertPayloadV1,
  type FeedItemUserStateAssignmentOperationTypeV1,
  type RssFeedUpsertPayloadV1,
  type PreferencesLeafAssignmentPayloadV1,
  type PersonUpsertPayloadV1,
} from "./operation-payload-contracts.js";
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

export type FeedItemUserStateAssignmentTransactionMemberInputV1 =
  FeedItemReadAssignmentTransactionMemberInputV1;
export type FeedItemCaptureUpsertTransactionMemberInputV1 =
  FeedItemReadAssignmentTransactionMemberInputV1;
export type FeedItemRemoveTransactionMemberInputV1 =
  FeedItemReadAssignmentTransactionMemberInputV1;
export type RssFeedUpsertTransactionMemberInputV1 =
  FeedItemReadAssignmentTransactionMemberInputV1;
export type RssFeedRemoveTransactionMemberInputV1 =
  FeedItemReadAssignmentTransactionMemberInputV1;
export type PreferencesLeafAssignmentTransactionMemberInputV1 =
  FeedItemReadAssignmentTransactionMemberInputV1;
export type PersonUpsertTransactionMemberInputV1 =
  FeedItemReadAssignmentTransactionMemberInputV1;

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

export interface FeedItemCaptureUpsertTransactionMemberBodyV1 {
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
  readonly operation_type: "feed_item_capture_upsert";
  readonly entity_type: "FeedItem";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: FeedItemCaptureUpsertPayloadV1;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface FeedItemUserStateAssignmentTransactionMemberBodyV1 {
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
  readonly operation_type: FeedItemUserStateAssignmentOperationTypeV1;
  readonly entity_type: "FeedItem";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: Readonly<{
    assigned: boolean;
    assigned_at_ms: number;
  }>;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface FeedItemRemoveTransactionMemberBodyV1 {
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
  readonly operation_type: "feed_item_remove";
  readonly entity_type: "FeedItem";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: Readonly<{ removed_at_ms: number }>;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface RssFeedUpsertTransactionMemberBodyV1 {
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
  readonly operation_type: "rss_feed_upsert";
  readonly entity_type: "RssFeed";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: RssFeedUpsertPayloadV1;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface RssFeedRemoveTransactionMemberBodyV1 {
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
  readonly operation_type:
    "rss_feed_remove_keep_items" | "rss_feed_remove_with_items";
  readonly entity_type: "RssFeed";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: Readonly<{ removed_at_ms: number }>;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface PreferencesLeafAssignmentTransactionMemberBodyV1 {
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
  readonly operation_type: "preferences_leaf_assignment";
  readonly entity_type: "UserPreferences";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: PreferencesLeafAssignmentPayloadV1;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface PersonUpsertTransactionMemberBodyV1 {
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
  readonly operation_type: "person_upsert";
  readonly entity_type: "Person";
  readonly entity_id: LibraryCoreEntityId;
  readonly payload: PersonUpsertPayloadV1;
  readonly payload_digest: LibraryCoreLowercaseHex64;
  readonly blob_references: readonly [];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export type LibraryCoreTransactionMemberBodyV1 =
  | FeedItemCaptureUpsertTransactionMemberBodyV1
  | FeedItemReadAssignmentTransactionMemberBodyV1
  | FeedItemUserStateAssignmentTransactionMemberBodyV1
  | FeedItemRemoveTransactionMemberBodyV1
  | RssFeedUpsertTransactionMemberBodyV1
  | RssFeedRemoveTransactionMemberBodyV1
  | PreferencesLeafAssignmentTransactionMemberBodyV1
  | PersonUpsertTransactionMemberBodyV1;

export interface LibraryCoreTransactionMemberConstruction<
  Body = LibraryCoreTransactionMemberBodyV1,
> {
  readonly body: Body;
  readonly member_digest: LibraryCoreLowercaseHex64;
}

export type LibraryCoreConstructionDigestDomain =
  | "authority-key"
  | "actor-public-key"
  | "actor-id"
  | "actor-enrollment-body"
  | "actor-enrollment-certificate"
  | "epoch-transition-certificate"
  | "actor-chain-genesis"
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

export function snapshotLibraryCoreCausalFrontier(
  value: unknown,
  label = "causal_frontier",
): readonly LibraryCoreCausalTipV1[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
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
      `${label} exceeds ${LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS.toLocaleString()} tips`,
    );
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== length + 1 ||
    names[names.length - 1] !== "length" ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a dense undecorated array`);
  }

  const snapshot: LibraryCoreCausalTipV1[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} requires enumerable data elements`);
    }
    const tipLabel = `${label}[${index.toLocaleString()}]`;
    const record = requirePlainClosedRecord(
      descriptor.value,
      CAUSAL_TIP_KEYS,
      tipLabel,
    );
    const sequence = requireNonnegativeSafeInteger(
      readDataProperty(record, "sequence", tipLabel),
      `${tipLabel}.sequence`,
    );
    if (sequence === 0) {
      throw new TypeError("causal frontier tips must have positive sequence");
    }
    snapshot.push(
      Object.freeze({
        actor_id: requireHex64(
          readDataProperty(record, "actor_id", tipLabel),
          `${tipLabel}.actor_id`,
        ),
        sequence,
        operation_id: requireOperationId(
          readDataProperty(record, "operation_id", tipLabel),
          `${tipLabel}.operation_id`,
        ),
        chain_digest: requireHex64(
          readDataProperty(record, "chain_digest", tipLabel),
          `${tipLabel}.chain_digest`,
        ),
      }),
    );
  }

  for (let index = 1; index < snapshot.length; index += 1) {
    if (compareCausalTips(snapshot[index - 1], snapshot[index]) >= 0) {
      throw new TypeError(
        `${label} must be strictly sorted with no duplicate tips`,
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

function constructEntityTransactionMember(
  input: FeedItemReadAssignmentTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
  spec:
    | {
        readonly operationType: "feed_item_capture_upsert";
        readonly validatePayload: typeof FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate;
        readonly entityType: "FeedItem";
      }
    | {
        readonly operationType: "feed_item_read_assignment";
        readonly validatePayload: typeof FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA.validate;
        readonly entityType: "FeedItem";
      }
    | {
        readonly operationType: FeedItemUserStateAssignmentOperationTypeV1;
        readonly validatePayload: typeof FEED_ITEM_SAVED_ASSIGNMENT_PAYLOAD_SCHEMA.validate;
        readonly entityType: "FeedItem";
      }
    | {
        readonly operationType: "feed_item_remove";
        readonly validatePayload: typeof FEED_ITEM_REMOVE_PAYLOAD_SCHEMA.validate;
        readonly entityType: "FeedItem";
      }
    | {
        readonly operationType: "rss_feed_upsert";
        readonly validatePayload: typeof RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate;
        readonly entityType: "RssFeed";
      }
    | {
        readonly operationType:
          "rss_feed_remove_keep_items" | "rss_feed_remove_with_items";
        readonly validatePayload: typeof RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA.validate;
        readonly entityType: "RssFeed";
      }
    | {
        readonly operationType: "preferences_leaf_assignment";
        readonly validatePayload: typeof PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA.validate;
        readonly entityType: "UserPreferences";
      }
    | {
        readonly operationType: "person_upsert";
        readonly validatePayload: typeof PERSON_UPSERT_PAYLOAD_SCHEMA.validate;
        readonly entityType: "Person";
      },
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
  const payloadResult = spec.validatePayload(
    readDataProperty(record, "payload", "transaction member input"),
  );
  if (!payloadResult.ok) {
    throw new TypeError(payloadResult.reason);
  }
  const payloadDigest = digestValue("operation-payload", {
    schema_version: 1,
    operation_type: spec.operationType,
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
    causal_frontier: snapshotLibraryCoreCausalFrontier(
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
    operation_type: spec.operationType,
    entity_type: spec.entityType,
    entity_id: entityCandidate,
    payload: payloadResult.value,
    payload_digest: payloadDigest,
    blob_references: EMPTY_BLOB_REFERENCES,
    created_at_ms: requireNonnegativeSafeInteger(
      readDataProperty(record, "created_at_ms", "transaction member input"),
      "created_at_ms",
    ),
    signature_algorithm: "ed25519",
  }) as LibraryCoreTransactionMemberBodyV1;
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

function constructFeedItemReadAssignmentTransactionMember(
  input: FeedItemReadAssignmentTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreTransactionMemberConstruction<FeedItemReadAssignmentTransactionMemberBodyV1> {
  return constructEntityTransactionMember(input, dependencies, {
    operationType: "feed_item_read_assignment",
    validatePayload: FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA.validate,
    entityType: "FeedItem",
  }) as LibraryCoreTransactionMemberConstruction<FeedItemReadAssignmentTransactionMemberBodyV1>;
}

function constructFeedItemCaptureUpsertTransactionMember(
  input: FeedItemCaptureUpsertTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreTransactionMemberConstruction<FeedItemCaptureUpsertTransactionMemberBodyV1> {
  const construction = constructEntityTransactionMember(input, dependencies, {
    operationType: "feed_item_capture_upsert",
    validatePayload: FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA.validate,
    entityType: "FeedItem",
  }) as LibraryCoreTransactionMemberConstruction<FeedItemCaptureUpsertTransactionMemberBodyV1>;
  if (construction.body.payload.item.globalId !== construction.body.entity_id) {
    throw new TypeError("capture item identity must equal entity_id");
  }
  return construction;
}

function constructFeedItemUserStateAssignmentTransactionMember(
  input: FeedItemUserStateAssignmentTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
  operationType: FeedItemUserStateAssignmentOperationTypeV1,
): LibraryCoreTransactionMemberConstruction<FeedItemUserStateAssignmentTransactionMemberBodyV1> {
  return constructEntityTransactionMember(input, dependencies, {
    operationType,
    validatePayload:
      operationType === "feed_item_saved_assignment"
        ? FEED_ITEM_SAVED_ASSIGNMENT_PAYLOAD_SCHEMA.validate
        : operationType === "feed_item_archive_assignment"
          ? FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA.validate
          : FEED_ITEM_LIKE_ASSIGNMENT_PAYLOAD_SCHEMA.validate,
    entityType: "FeedItem",
  }) as LibraryCoreTransactionMemberConstruction<FeedItemUserStateAssignmentTransactionMemberBodyV1>;
}

function constructFeedItemRemoveTransactionMember(
  input: FeedItemRemoveTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreTransactionMemberConstruction<FeedItemRemoveTransactionMemberBodyV1> {
  return constructEntityTransactionMember(input, dependencies, {
    operationType: "feed_item_remove",
    validatePayload: FEED_ITEM_REMOVE_PAYLOAD_SCHEMA.validate,
    entityType: "FeedItem",
  }) as LibraryCoreTransactionMemberConstruction<FeedItemRemoveTransactionMemberBodyV1>;
}

function constructRssFeedUpsertTransactionMember(
  input: RssFeedUpsertTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreTransactionMemberConstruction<RssFeedUpsertTransactionMemberBodyV1> {
  const construction = constructEntityTransactionMember(input, dependencies, {
    operationType: "rss_feed_upsert",
    validatePayload: RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate,
    entityType: "RssFeed",
  }) as LibraryCoreTransactionMemberConstruction<RssFeedUpsertTransactionMemberBodyV1>;
  if (construction.body.payload.feed.url !== construction.body.entity_id) {
    throw new TypeError("RSS feed URL must equal entity_id");
  }
  return construction;
}

function constructRssFeedRemoveTransactionMember(
  input: RssFeedRemoveTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
  operationType: "rss_feed_remove_keep_items" | "rss_feed_remove_with_items",
): LibraryCoreTransactionMemberConstruction<RssFeedRemoveTransactionMemberBodyV1> {
  return constructEntityTransactionMember(input, dependencies, {
    operationType,
    validatePayload:
      operationType === "rss_feed_remove_keep_items"
        ? RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA.validate
        : RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA.validate,
    entityType: "RssFeed",
  }) as LibraryCoreTransactionMemberConstruction<RssFeedRemoveTransactionMemberBodyV1>;
}

function constructPreferencesLeafAssignmentTransactionMember(
  input: PreferencesLeafAssignmentTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreTransactionMemberConstruction<PreferencesLeafAssignmentTransactionMemberBodyV1> {
  return constructEntityTransactionMember(input, dependencies, {
    operationType: "preferences_leaf_assignment",
    validatePayload: PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA.validate,
    entityType: "UserPreferences",
  }) as LibraryCoreTransactionMemberConstruction<PreferencesLeafAssignmentTransactionMemberBodyV1>;
}

function constructPersonUpsertTransactionMember(
  input: PersonUpsertTransactionMemberInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreTransactionMemberConstruction<PersonUpsertTransactionMemberBodyV1> {
  const construction = constructEntityTransactionMember(input, dependencies, {
    operationType: "person_upsert",
    validatePayload: PERSON_UPSERT_PAYLOAD_SCHEMA.validate,
    entityType: "Person",
  }) as LibraryCoreTransactionMemberConstruction<PersonUpsertTransactionMemberBodyV1>;
  if (construction.body.payload.person.id !== construction.body.entity_id) {
    throw new TypeError("Person ID must equal entity_id");
  }
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

export const FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA = Object.freeze(
  {
    schemaId: "feed_item_capture_upsert_transaction_member_v1",
    schemaVersion: 1,
    operationType: "feed_item_capture_upsert",
    entityType: "FeedItem",
    maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
    construct: constructFeedItemCaptureUpsertTransactionMember,
  },
) satisfies LibraryCoreTransactionMemberSchema<
  FeedItemCaptureUpsertTransactionMemberInputV1,
  FeedItemCaptureUpsertTransactionMemberBodyV1
>;

function userStateAssignmentTransactionMemberSchema(
  operationType: FeedItemUserStateAssignmentOperationTypeV1,
) {
  return Object.freeze({
    schemaId: `${operationType}_transaction_member_v1`,
    schemaVersion: 1 as const,
    operationType,
    entityType: "FeedItem" as const,
    maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
    construct: (
      input: FeedItemUserStateAssignmentTransactionMemberInputV1,
      dependencies: LibraryCoreOperationDigestDependencies,
    ) =>
      constructFeedItemUserStateAssignmentTransactionMember(
        input,
        dependencies,
        operationType,
      ),
  });
}

export const FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA =
  userStateAssignmentTransactionMemberSchema("feed_item_saved_assignment");
export const FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA =
  userStateAssignmentTransactionMemberSchema("feed_item_archive_assignment");
export const FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA =
  userStateAssignmentTransactionMemberSchema("feed_item_like_assignment");

export const FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA = Object.freeze({
  schemaId: "feed_item_remove_transaction_member_v1",
  schemaVersion: 1,
  operationType: "feed_item_remove",
  entityType: "FeedItem",
  maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
  construct: constructFeedItemRemoveTransactionMember,
}) satisfies LibraryCoreTransactionMemberSchema<
  FeedItemRemoveTransactionMemberInputV1,
  FeedItemRemoveTransactionMemberBodyV1
>;

export const RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA = Object.freeze({
  schemaId: "rss_feed_upsert_transaction_member_v1",
  schemaVersion: 1,
  operationType: "rss_feed_upsert",
  entityType: "RssFeed",
  maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
  construct: constructRssFeedUpsertTransactionMember,
}) satisfies LibraryCoreTransactionMemberSchema<
  RssFeedUpsertTransactionMemberInputV1,
  RssFeedUpsertTransactionMemberBodyV1
>;

function rssFeedRemoveTransactionMemberSchema(
  operationType: "rss_feed_remove_keep_items" | "rss_feed_remove_with_items",
) {
  return Object.freeze({
    schemaId: `${operationType}_transaction_member_v1`,
    schemaVersion: 1 as const,
    operationType,
    entityType: "RssFeed" as const,
    maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
    construct: (
      input: RssFeedRemoveTransactionMemberInputV1,
      dependencies: LibraryCoreOperationDigestDependencies,
    ) =>
      constructRssFeedRemoveTransactionMember(
        input,
        dependencies,
        operationType,
      ),
  });
}

export const RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA =
  rssFeedRemoveTransactionMemberSchema("rss_feed_remove_keep_items");
export const RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA =
  rssFeedRemoveTransactionMemberSchema("rss_feed_remove_with_items");

export const PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA =
  Object.freeze({
    schemaId: "preferences_leaf_assignment_transaction_member_v1",
    schemaVersion: 1,
    operationType: "preferences_leaf_assignment",
    entityType: "UserPreferences",
    maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
    construct: constructPreferencesLeafAssignmentTransactionMember,
  }) satisfies LibraryCoreTransactionMemberSchema<
    PreferencesLeafAssignmentTransactionMemberInputV1,
    PreferencesLeafAssignmentTransactionMemberBodyV1
  >;

export const PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA = Object.freeze({
  schemaId: "person_upsert_transaction_member_v1",
  schemaVersion: 1,
  operationType: "person_upsert",
  entityType: "Person",
  maximumCausalFrontierTips: LIBRARY_CORE_MAX_CAUSAL_FRONTIER_TIPS,
  construct: constructPersonUpsertTransactionMember,
}) satisfies LibraryCoreTransactionMemberSchema<
  PersonUpsertTransactionMemberInputV1,
  PersonUpsertTransactionMemberBodyV1
>;
