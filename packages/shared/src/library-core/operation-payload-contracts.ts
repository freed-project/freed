import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";
import { stripDeviceLocalPreferenceUpdates } from "../preferences.js";
import type { UserPreferences } from "../types.js";

const FEED_ITEM_CAPTURE_MAXIMUM_BYTES = 1_048_576;
const RSS_FEED_UPSERT_MAXIMUM_BYTES = 65_536;
const PREFERENCES_PATCH_MAXIMUM_BYTES = 262_144;

export interface FeedItemCaptureUpsertPayloadV1 {
  readonly item: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface FeedItemReadAssignmentPayloadV1 {
  readonly read_at_ms: number;
}

export interface FeedItemRemovePayloadV1 {
  readonly removed_at_ms: number;
}

export interface RssFeedUpsertPayloadV1 {
  readonly feed: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface RssFeedRemovePayloadV1 {
  readonly removed_at_ms: number;
}

export interface PreferencesLeafAssignmentPayloadV1 {
  readonly updates: Readonly<Record<string, LibraryCoreCanonicalValue>>;
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
const RSS_FEED_UPSERT_KEYS = ["feed"] as const;
const RSS_FEED_REMOVE_KEYS = ["removed_at_ms"] as const;
const PREFERENCES_LEAF_ASSIGNMENT_KEYS = ["updates"] as const;
const USER_STATE_ASSIGNMENT_KEYS = ["assigned", "assigned_at_ms"] as const;

const RSS_FEED_KEYS = Object.freeze([
  "enabled",
  "folder",
  "imageUrl",
  "lastFetched",
  "pollInterval",
  "sampleDataFingerprint",
  "siteUrl",
  "title",
  "trackUnread",
  "url",
] as const);

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

function validateRssFeedUpsertPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<RssFeedUpsertPayloadV1> {
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
  if (keys.length !== 1 || keys[0] !== RSS_FEED_UPSERT_KEYS[0]) {
    return invalid("payload must contain only feed");
  }
  const feedDescriptor = Object.getOwnPropertyDescriptor(value, "feed");
  if (
    feedDescriptor === undefined ||
    !feedDescriptor.enumerable ||
    !("value" in feedDescriptor) ||
    typeof feedDescriptor.value !== "object" ||
    feedDescriptor.value === null ||
    Array.isArray(feedDescriptor.value)
  ) {
    return invalid("feed must be a plain canonical object");
  }
  try {
    const encoded = encodeLibraryCoreCanonicalValue(
      feedDescriptor.value as LibraryCoreCanonicalValue,
      { maximumBytes: RSS_FEED_UPSERT_MAXIMUM_BYTES },
    );
    const decoded = decodeLibraryCoreCanonicalValue(encoded, {
      maximumBytes: RSS_FEED_UPSERT_MAXIMUM_BYTES,
    });
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      return invalid("feed must be a plain canonical object");
    }
    const feed = decoded as Readonly<Record<string, LibraryCoreCanonicalValue>>;
    const feedKeys = Object.keys(feed);
    if (feedKeys.some((key) => !RSS_FEED_KEYS.includes(key as never))) {
      return invalid("feed contains an unsupported synchronized field");
    }
    if (
      typeof feed.url !== "string" ||
      feed.url.length === 0 ||
      feed.url.length > 4_096
    ) {
      return invalid("feed.url must be a bounded nonempty string");
    }
    if (
      typeof feed.title !== "string" ||
      feed.title.length > 4_096 ||
      typeof feed.enabled !== "boolean" ||
      typeof feed.trackUnread !== "boolean"
    ) {
      return invalid("feed requires title, enabled, and trackUnread");
    }
    for (const key of ["siteUrl", "imageUrl", "folder"] as const) {
      const candidate = feed[key];
      if (
        candidate !== undefined &&
        (typeof candidate !== "string" || candidate.length > 4_096)
      ) {
        return invalid(`feed.${key} must be a bounded string`);
      }
    }
    for (const key of ["lastFetched", "pollInterval"] as const) {
      const candidate = feed[key];
      if (
        candidate !== undefined &&
        !isLibraryCoreNonnegativeSafeInteger(candidate)
      ) {
        return invalid(`feed.${key} must be a nonnegative safe integer`);
      }
    }
    return { ok: true, value: Object.freeze({ feed }) };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "feed is not canonical",
    );
  }
}

function validateRssFeedRemovePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<RssFeedRemovePayloadV1> {
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
  if (keys.length !== 1 || keys[0] !== RSS_FEED_REMOVE_KEYS[0]) {
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
  return { ok: true, value: Object.freeze({ removed_at_ms: removedAt.value }) };
}

function validatePreferencesLeafAssignmentPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<PreferencesLeafAssignmentPayloadV1> {
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
    keys.length !== 1 ||
    keys[0] !== PREFERENCES_LEAF_ASSIGNMENT_KEYS[0]
  ) {
    return invalid("payload must contain only updates");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "updates");
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "object" ||
    descriptor.value === null ||
    Array.isArray(descriptor.value)
  ) {
    return invalid("updates must be a plain canonical object");
  }
  try {
    const encoded = encodeLibraryCoreCanonicalValue(
      descriptor.value as LibraryCoreCanonicalValue,
      { maximumBytes: PREFERENCES_PATCH_MAXIMUM_BYTES },
    );
    const updates = decodeLibraryCoreCanonicalValue(encoded, {
      maximumBytes: PREFERENCES_PATCH_MAXIMUM_BYTES,
    });
    if (typeof updates !== "object" || updates === null || Array.isArray(updates)) {
      return invalid("updates must be a plain canonical object");
    }
    if (Object.keys(updates).length === 0) {
      return invalid("updates must not be empty");
    }
    const synchronized = stripDeviceLocalPreferenceUpdates(
      updates as Partial<UserPreferences>,
    ) as unknown as LibraryCoreCanonicalValue;
    const synchronizedBytes = encodeLibraryCoreCanonicalValue(synchronized, {
      maximumBytes: PREFERENCES_PATCH_MAXIMUM_BYTES,
    });
    if (
      synchronizedBytes.byteLength !== encoded.byteLength ||
      synchronizedBytes.some((byte, index) => byte !== encoded[index])
    ) {
      return invalid("updates contain device-local or compatibility fields");
    }
    return {
      ok: true,
      value: Object.freeze({
        updates: updates as Readonly<
          Record<string, LibraryCoreCanonicalValue>
        >,
      }),
    };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "updates are not canonical",
    );
  }
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

export const RSS_FEED_UPSERT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "rss_feed_upsert_payload_v1",
  schemaVersion: 1,
  operationType: "rss_feed_upsert",
  canonicalKeys: RSS_FEED_UPSERT_KEYS,
  validate: validateRssFeedUpsertPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "rss_feed_upsert",
  RssFeedUpsertPayloadV1
>;

function rssFeedRemovePayloadSchema(
  operationType: "rss_feed_remove_keep_items" | "rss_feed_remove_with_items",
) {
  return Object.freeze({
    schemaId: `${operationType}_payload_v1`,
    schemaVersion: 1 as const,
    operationType,
    canonicalKeys: RSS_FEED_REMOVE_KEYS,
    validate: validateRssFeedRemovePayload,
  });
}

export const RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA =
  rssFeedRemovePayloadSchema("rss_feed_remove_keep_items");
export const RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA =
  rssFeedRemovePayloadSchema("rss_feed_remove_with_items");

export const PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "preferences_leaf_assignment_payload_v1",
  schemaVersion: 1,
  operationType: "preferences_leaf_assignment",
  canonicalKeys: PREFERENCES_LEAF_ASSIGNMENT_KEYS,
  validate: validatePreferencesLeafAssignmentPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "preferences_leaf_assignment",
  PreferencesLeafAssignmentPayloadV1
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
