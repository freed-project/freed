import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

const FEED_ITEM_CAPTURE_MAXIMUM_BYTES = 1_048_576;

export interface FeedItemCaptureUpsertPayloadV1 {
  readonly item: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface FeedItemReadAssignmentPayloadV1 {
  readonly read_at_ms: number;
}

export interface FeedItemRemovePayloadV1 {
  readonly removed_at_ms: number;
}

export const FEED_ITEM_USER_STATE_ASSIGNMENT_FIELDS = Object.freeze([
  "saved",
  "archived",
  "liked",
] as const);

export type FeedItemUserStateAssignmentFieldV1 =
  (typeof FEED_ITEM_USER_STATE_ASSIGNMENT_FIELDS)[number];

export type FeedItemUserStateAssignmentOperationTypeV1 =
  | "feed_item_saved_assignment"
  | "feed_item_archive_assignment"
  | "feed_item_like_assignment";

export interface FeedItemUserStateAssignmentPayloadV1 {
  readonly assigned: boolean;
  readonly assigned_at_ms: number;
}

export type LibraryCorePayloadValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly code: "invalid";
      readonly reason: string;
    };

export interface LibraryCoreOperationPayloadSchema<
  OperationType extends string,
  Payload,
> {
  readonly schemaId: string;
  readonly schemaVersion: 1;
  readonly operationType: OperationType;
  readonly canonicalKeys: readonly string[];
  readonly validate: (
    value: unknown,
  ) => LibraryCorePayloadValidationResult<Payload>;
}

const READ_ASSIGNMENT_KEYS = ["read_at_ms"] as const;
const FEED_ITEM_CAPTURE_UPSERT_KEYS = ["item"] as const;
const FEED_ITEM_REMOVE_KEYS = ["removed_at_ms"] as const;
const USER_STATE_ASSIGNMENT_KEYS = ["assigned", "assigned_at_ms"] as const;

function invalid<T>(reason: string): LibraryCorePayloadValidationResult<T> {
  return { ok: false, code: "invalid", reason };
}

function validateFeedItemReadAssignmentPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemReadAssignmentPayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid("payload must be a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return invalid("payload may not contain symbol keys");
  }

  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== READ_ASSIGNMENT_KEYS[0]) {
    return invalid("payload must contain only read_at_ms");
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, "read_at_ms");
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    return invalid("read_at_ms must be an enumerable data property");
  }
  if (!isLibraryCoreNonnegativeSafeInteger(descriptor.value)) {
    return invalid("read_at_ms must be a nonnegative safe integer");
  }

  return {
    ok: true,
    value: Object.freeze({ read_at_ms: descriptor.value }),
  };
}

function validateFeedItemCaptureUpsertPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemCaptureUpsertPayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid("payload must be a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return invalid("payload may not contain symbol keys");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== FEED_ITEM_CAPTURE_UPSERT_KEYS[0]) {
    return invalid("payload must contain only item");
  }
  const itemDescriptor = Object.getOwnPropertyDescriptor(value, "item");
  if (
    itemDescriptor === undefined ||
    !itemDescriptor.enumerable ||
    !("value" in itemDescriptor) ||
    typeof itemDescriptor.value !== "object" ||
    itemDescriptor.value === null ||
    Array.isArray(itemDescriptor.value)
  ) {
    return invalid("item must be a plain canonical object");
  }
  try {
    const encoded = encodeLibraryCoreCanonicalValue(
      itemDescriptor.value as LibraryCoreCanonicalValue,
      { maximumBytes: FEED_ITEM_CAPTURE_MAXIMUM_BYTES },
    );
    const item = decodeLibraryCoreCanonicalValue(encoded, {
      maximumBytes: FEED_ITEM_CAPTURE_MAXIMUM_BYTES,
    });
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return invalid("item must be a plain canonical object");
    }
    const canonicalItem = item as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    const globalId = canonicalItem.globalId;
    if (
      typeof globalId !== "string" ||
      globalId.length === 0 ||
      globalId.length > 4_096
    ) {
      return invalid("item.globalId must be a bounded nonempty string");
    }
    return {
      ok: true,
      value: Object.freeze({
        item: canonicalItem,
      }),
    };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "item is not canonical",
    );
  }
}

function validateFeedItemRemovePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemRemovePayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid("payload must be a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return invalid("payload may not contain symbol keys");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== FEED_ITEM_REMOVE_KEYS[0]) {
    return invalid("payload must contain only removed_at_ms");
  }
  const removedAt = Object.getOwnPropertyDescriptor(value, "removed_at_ms");
  if (
    removedAt === undefined ||
    !removedAt.enumerable ||
    !("value" in removedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(removedAt.value)
  ) {
    return invalid("removed_at_ms must be a nonnegative safe integer");
  }
  return {
    ok: true,
    value: Object.freeze({ removed_at_ms: removedAt.value }),
  };
}

function validateFeedItemUserStateAssignmentPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemUserStateAssignmentPayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid("payload must be a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return invalid("payload may not contain symbol keys");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (
    keys.length !== USER_STATE_ASSIGNMENT_KEYS.length ||
    USER_STATE_ASSIGNMENT_KEYS.some((key) => !keys.includes(key))
  ) {
    return invalid("payload must contain only assigned and assigned_at_ms");
  }
  const assigned = Object.getOwnPropertyDescriptor(value, "assigned");
  const assignedAt = Object.getOwnPropertyDescriptor(value, "assigned_at_ms");
  if (
    assigned === undefined ||
    !assigned.enumerable ||
    !("value" in assigned) ||
    typeof assigned.value !== "boolean"
  ) {
    return invalid("assigned must be a boolean");
  }
  if (
    assignedAt === undefined ||
    !assignedAt.enumerable ||
    !("value" in assignedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(assignedAt.value)
  ) {
    return invalid("assigned_at_ms must be a nonnegative safe integer");
  }
  return {
    ok: true,
    value: Object.freeze({
      assigned: assigned.value,
      assigned_at_ms: assignedAt.value,
    }),
  };
}

/**
 * Closed payload syntax only. This schema does not grant write authority,
 * materialize state, or schedule a provider-visible action.
 */
export const FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "feed_item_read_assignment_payload_v1",
  schemaVersion: 1,
  operationType: "feed_item_read_assignment",
  canonicalKeys: READ_ASSIGNMENT_KEYS,
  validate: validateFeedItemReadAssignmentPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "feed_item_read_assignment",
  FeedItemReadAssignmentPayloadV1
>;

export const FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "feed_item_capture_upsert_payload_v1",
  schemaVersion: 1,
  operationType: "feed_item_capture_upsert",
  canonicalKeys: FEED_ITEM_CAPTURE_UPSERT_KEYS,
  validate: validateFeedItemCaptureUpsertPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "feed_item_capture_upsert",
  FeedItemCaptureUpsertPayloadV1
>;

export const FEED_ITEM_REMOVE_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "feed_item_remove_payload_v1",
  schemaVersion: 1,
  operationType: "feed_item_remove",
  canonicalKeys: FEED_ITEM_REMOVE_KEYS,
  validate: validateFeedItemRemovePayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "feed_item_remove",
  FeedItemRemovePayloadV1
>;

/** Closed payload for idempotent local PWA user-state assignments. */
function userStateAssignmentPayloadSchema(
  operationType: FeedItemUserStateAssignmentOperationTypeV1,
) {
  return Object.freeze({
    schemaId: `${operationType}_payload_v1`,
    schemaVersion: 1 as const,
    operationType,
    canonicalKeys: USER_STATE_ASSIGNMENT_KEYS,
    validate: validateFeedItemUserStateAssignmentPayload,
  });
}

export const FEED_ITEM_SAVED_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateAssignmentPayloadSchema("feed_item_saved_assignment");
export const FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateAssignmentPayloadSchema("feed_item_archive_assignment");
export const FEED_ITEM_LIKE_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateAssignmentPayloadSchema("feed_item_like_assignment");
