import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export interface FeedItemReadAssignmentPayloadV1 {
  readonly read_at_ms: number;
}

export const FEED_ITEM_USER_STATE_TOGGLE_KINDS = Object.freeze([
  "saved",
  "archived",
  "liked",
] as const);

export type FeedItemUserStateToggleKindV1 =
  (typeof FEED_ITEM_USER_STATE_TOGGLE_KINDS)[number];

export type FeedItemUserStateToggleOperationTypeV1 =
  | "feed_item_saved_assignment"
  | "feed_item_archive_assignment"
  | "feed_item_like_assignment";

export interface FeedItemUserStateTogglePayloadV1 {
  readonly toggled_at_ms: number;
  readonly toggle: FeedItemUserStateToggleKindV1;
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
const USER_STATE_TOGGLE_KEYS = ["toggle", "toggled_at_ms"] as const;

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

function validateFeedItemUserStateTogglePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemUserStateTogglePayloadV1> {
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
    keys.length !== USER_STATE_TOGGLE_KEYS.length ||
    USER_STATE_TOGGLE_KEYS.some((key) => !keys.includes(key))
  ) {
    return invalid("payload must contain only toggle and toggled_at_ms");
  }
  const toggle = Object.getOwnPropertyDescriptor(value, "toggle");
  const toggledAt = Object.getOwnPropertyDescriptor(value, "toggled_at_ms");
  if (
    toggle === undefined ||
    !toggle.enumerable ||
    !("value" in toggle) ||
    !FEED_ITEM_USER_STATE_TOGGLE_KINDS.includes(
      toggle.value as FeedItemUserStateToggleKindV1,
    )
  ) {
    return invalid("toggle must name a supported user-state field");
  }
  if (
    toggledAt === undefined ||
    !toggledAt.enumerable ||
    !("value" in toggledAt) ||
    !isLibraryCoreNonnegativeSafeInteger(toggledAt.value)
  ) {
    return invalid("toggled_at_ms must be a nonnegative safe integer");
  }
  return {
    ok: true,
    value: Object.freeze({
      toggle: toggle.value as FeedItemUserStateToggleKindV1,
      toggled_at_ms: toggledAt.value,
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

/** Closed payload for local PWA user-state toggles. Provider execution is separate. */
function userStateTogglePayloadSchema(
  operationType: FeedItemUserStateToggleOperationTypeV1,
) {
  return Object.freeze({
    schemaId: `${operationType}_payload_v1`,
    schemaVersion: 1 as const,
    operationType,
    canonicalKeys: USER_STATE_TOGGLE_KEYS,
    validate: validateFeedItemUserStateTogglePayload,
  });
}

export const FEED_ITEM_SAVED_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateTogglePayloadSchema("feed_item_saved_assignment");
export const FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateTogglePayloadSchema("feed_item_archive_assignment");
export const FEED_ITEM_LIKE_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateTogglePayloadSchema("feed_item_like_assignment");
