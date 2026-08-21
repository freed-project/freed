import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";
import { stripDeviceLocalPreferenceUpdates } from "../preferences.js";
import {
  sanitizeAccountWrite,
  sanitizePersonWrite,
} from "../sync-write-policy.js";
import type { Account, Person, UserPreferences } from "../types.js";

const FEED_ITEM_CAPTURE_MAXIMUM_BYTES = 1_048_576;
const RSS_FEED_UPSERT_MAXIMUM_BYTES = 65_536;
const PREFERENCES_PATCH_MAXIMUM_BYTES = 262_144;
const PREFERENCES_PATCH_MAXIMUM_NODES = 512;
const PREFERENCE_PATH_MAXIMUM_UTF8_BYTES = 4_096;
const PREFERENCE_TEXT_MAXIMUM_UTF8_BYTES = 8_192;
const PERSON_UPSERT_MAXIMUM_BYTES = 262_144;
const ACCOUNT_UPSERT_MAXIMUM_BYTES = 262_144;
const ACCOUNT_PROVIDERS = Object.freeze([
  "x",
  "rss",
  "youtube",
  "reddit",
  "mastodon",
  "github",
  "facebook",
  "instagram",
  "linkedin",
  "substack",
  "medium",
  "saved",
  "google_contacts",
  "manual_contact",
  "macos_contacts",
  "ios_contacts",
  "android_contacts",
  "web_contact",
] as const);

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

export interface RssFeedTitleAssignmentPayloadV1 {
  readonly assigned_at_ms: number;
  readonly title: string;
}

export interface RssFeedRemovePayloadV1 {
  readonly removed_at_ms: number;
}

export interface PreferencesLeafAssignmentPayloadV1 {
  readonly updates: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface PersonUpsertPayloadV1 {
  readonly person: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface PersonRemovePayloadV1 {
  readonly removed_at_ms: number;
}

export interface AccountUpsertPayloadV1 {
  readonly account: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface AccountRemovePayloadV1 {
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
const RSS_FEED_UPSERT_KEYS = ["feed"] as const;
const RSS_FEED_TITLE_ASSIGNMENT_KEYS = ["assigned_at_ms", "title"] as const;
const RSS_FEED_REMOVE_KEYS = ["removed_at_ms"] as const;
const PREFERENCES_LEAF_ASSIGNMENT_KEYS = ["updates"] as const;
const PERSON_UPSERT_KEYS = ["person"] as const;
const PERSON_REMOVE_KEYS = ["removed_at_ms"] as const;
const ACCOUNT_UPSERT_KEYS = ["account"] as const;
const ACCOUNT_REMOVE_KEYS = ["removed_at_ms"] as const;
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
    const fingerprint = feed.sampleDataFingerprint;
    if (fingerprint !== undefined) {
      if (
        typeof fingerprint !== "object" ||
        fingerprint === null ||
        Array.isArray(fingerprint)
      ) {
        return invalid("feed.sampleDataFingerprint is invalid");
      }
      const record = fingerprint as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      if (
        Object.keys(record).length !== 4 ||
        record.marker !== "freed.sample-data.v1" ||
        typeof record.batchId !== "string" ||
        !isLibraryCoreNonnegativeSafeInteger(record.generatedAt) ||
        !isLibraryCoreNonnegativeSafeInteger(record.generatorVersion)
      ) {
        return invalid("feed.sampleDataFingerprint is invalid");
      }
    }
    return { ok: true, value: Object.freeze({ feed }) };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "feed is not canonical",
    );
  }
}

function validateRssFeedTitleAssignmentPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<RssFeedTitleAssignmentPayloadV1> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return invalid("payload must be a plain object");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (
    keys.length !== RSS_FEED_TITLE_ASSIGNMENT_KEYS.length ||
    RSS_FEED_TITLE_ASSIGNMENT_KEYS.some((key) => !keys.includes(key))
  ) {
    return invalid("payload must contain only assigned_at_ms and title");
  }
  const assignedAt = Object.getOwnPropertyDescriptor(value, "assigned_at_ms");
  const title = Object.getOwnPropertyDescriptor(value, "title");
  if (
    assignedAt === undefined ||
    !assignedAt.enumerable ||
    !("value" in assignedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(assignedAt.value)
  ) {
    return invalid("assigned_at_ms must be a nonnegative safe integer");
  }
  if (
    title === undefined ||
    !title.enumerable ||
    !("value" in title) ||
    typeof title.value !== "string" ||
    new TextEncoder().encode(title.value).byteLength > 4_096
  ) {
    return invalid("title must be a bounded string");
  }
  return {
    ok: true,
    value: Object.freeze({
      assigned_at_ms: assignedAt.value,
      title: title.value,
    }),
  };
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
  if (keys.length !== 1 || keys[0] !== PREFERENCES_LEAF_ASSIGNMENT_KEYS[0]) {
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
    if (
      typeof updates !== "object" ||
      updates === null ||
      Array.isArray(updates)
    ) {
      return invalid("updates must be a plain canonical object");
    }
    if (Object.keys(updates).length === 0) {
      return invalid("updates must not be empty");
    }
    const textEncoder = new TextEncoder();
    let nodeCount = 0;
    const visit = (node: LibraryCoreCanonicalValue, path: string): boolean => {
      nodeCount += 1;
      if (
        nodeCount > PREFERENCES_PATCH_MAXIMUM_NODES ||
        textEncoder.encode(path).byteLength >
          PREFERENCE_PATH_MAXIMUM_UTF8_BYTES ||
        (typeof node === "string" &&
          textEncoder.encode(node).byteLength >
            PREFERENCE_TEXT_MAXIMUM_UTF8_BYTES)
      ) {
        return false;
      }
      if (Array.isArray(node)) {
        return node.every((child, index) => visit(child, `${path}[${index}]`));
      }
      if (typeof node === "object" && node !== null) {
        return Object.entries(node).every(([key, child]) =>
          visit(child, `${path}.${JSON.stringify(key)}`),
        );
      }
      return true;
    };
    if (
      !Object.entries(updates).every(([key, child]) =>
        visit(child, `$.${JSON.stringify(key)}`),
      )
    ) {
      return invalid("updates exceed normalized preference node bounds");
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
        updates: updates as Readonly<Record<string, LibraryCoreCanonicalValue>>,
      }),
    };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "updates are not canonical",
    );
  }
}

function validatePersonUpsertPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<PersonUpsertPayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== PERSON_UPSERT_KEYS[0]) {
    return invalid("payload must contain only person");
  }
  const candidate = (value as { person?: unknown }).person;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return invalid("person must be a plain canonical object");
  }
  try {
    const encoded = encodeLibraryCoreCanonicalValue(
      candidate as LibraryCoreCanonicalValue,
      {
        maximumBytes: PERSON_UPSERT_MAXIMUM_BYTES,
      },
    );
    const decoded = decodeLibraryCoreCanonicalValue(encoded, {
      maximumBytes: PERSON_UPSERT_MAXIMUM_BYTES,
    });
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      return invalid("person must be a plain canonical object");
    }
    const person = decoded as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    if (
      typeof person.id !== "string" ||
      person.id.length === 0 ||
      person.id.length > 4_096
    ) {
      return invalid("person.id must be a bounded nonempty string");
    }
    if (typeof person.name !== "string" || person.name.length > 16_384) {
      return invalid("person.name must be a bounded string");
    }
    if (
      (person.relationshipStatus !== "connection" &&
        person.relationshipStatus !== "friend") ||
      !Number.isSafeInteger(person.careLevel) ||
      (person.careLevel as number) < 1 ||
      (person.careLevel as number) > 5 ||
      !Number.isSafeInteger(person.createdAt) ||
      (person.createdAt as number) < 0 ||
      !Number.isSafeInteger(person.updatedAt) ||
      (person.updatedAt as number) < 0
    ) {
      return invalid("person has invalid required fields");
    }
    for (const key of ["avatarUrl", "bio", "notes"] as const) {
      const field = person[key];
      if (
        field !== undefined &&
        (typeof field !== "string" ||
          field.length > PERSON_UPSERT_MAXIMUM_BYTES)
      ) {
        return invalid(`person.${key} must be a bounded string`);
      }
    }
    if (
      person.reachOutIntervalDays !== undefined &&
      (!Number.isSafeInteger(person.reachOutIntervalDays) ||
        (person.reachOutIntervalDays as number) < 0)
    ) {
      return invalid("person.reachOutIntervalDays must be nonnegative");
    }
    if (
      person.tags !== undefined &&
      (!Array.isArray(person.tags) ||
        person.tags.length > 4_096 ||
        person.tags.some(
          (tag) => typeof tag !== "string" || tag.length > 4_096,
        ))
    ) {
      return invalid("person.tags must be bounded strings");
    }
    if (person.reachOutLog !== undefined) {
      if (
        !Array.isArray(person.reachOutLog) ||
        person.reachOutLog.length > 20
      ) {
        return invalid("person.reachOutLog must be a bounded array");
      }
      const channels = new Set([
        "phone",
        "text",
        "email",
        "in_person",
        "other",
      ]);
      for (const entry of person.reachOutLog) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          Array.isArray(entry) ||
          Object.keys(entry).some(
            (key) => !["loggedAt", "channel", "notes"].includes(key),
          ) ||
          !Number.isSafeInteger(entry.loggedAt) ||
          (entry.loggedAt as number) < 0 ||
          (entry.channel !== undefined &&
            (typeof entry.channel !== "string" ||
              !channels.has(entry.channel))) ||
          (entry.notes !== undefined && typeof entry.notes !== "string")
        ) {
          return invalid("person.reachOutLog contains an invalid entry");
        }
      }
    }
    if (person.sampleDataFingerprint !== undefined) {
      const fingerprint = person.sampleDataFingerprint;
      if (
        typeof fingerprint !== "object" ||
        fingerprint === null ||
        Array.isArray(fingerprint)
      ) {
        return invalid("person.sampleDataFingerprint is invalid");
      }
      const fields = fingerprint as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      if (
        Object.keys(fields).length !== 4 ||
        !["marker", "batchId", "generatedAt", "generatorVersion"].every((key) =>
          Object.prototype.hasOwnProperty.call(fields, key),
        ) ||
        fields.marker !== "freed.sample-data.v1" ||
        typeof fields.batchId !== "string" ||
        !Number.isSafeInteger(fields.generatedAt) ||
        (fields.generatedAt as number) < 0 ||
        !Number.isSafeInteger(fields.generatorVersion) ||
        (fields.generatorVersion as number) < 0
      ) {
        return invalid("person.sampleDataFingerprint is invalid");
      }
    }
    const sanitized = sanitizePersonWrite(person as unknown as Partial<Person>);
    const sanitizedBytes = encodeLibraryCoreCanonicalValue(
      sanitized as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: PERSON_UPSERT_MAXIMUM_BYTES },
    );
    if (
      sanitizedBytes.byteLength !== encoded.byteLength ||
      sanitizedBytes.some((byte, index) => byte !== encoded[index])
    ) {
      return invalid("person contains device-local or unsupported fields");
    }
    return { ok: true, value: Object.freeze({ person }) };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "person is not canonical",
    );
  }
}

function validatePersonRemovePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<PersonRemovePayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== PERSON_REMOVE_KEYS[0]) {
    return invalid("payload must contain only removed_at_ms");
  }
  const removedAtMs = (value as { removed_at_ms?: unknown }).removed_at_ms;
  if (!isLibraryCoreNonnegativeSafeInteger(removedAtMs)) {
    return invalid("removed_at_ms must be a nonnegative safe integer");
  }
  return { ok: true, value: Object.freeze({ removed_at_ms: removedAtMs }) };
}

function validateAccountUpsertPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<AccountUpsertPayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== ACCOUNT_UPSERT_KEYS[0]) {
    return invalid("payload must contain only account");
  }
  const candidate = (value as { account?: unknown }).account;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return invalid("account must be a plain canonical object");
  }
  try {
    const encoded = encodeLibraryCoreCanonicalValue(
      candidate as LibraryCoreCanonicalValue,
      { maximumBytes: ACCOUNT_UPSERT_MAXIMUM_BYTES },
    );
    const decoded = decodeLibraryCoreCanonicalValue(encoded, {
      maximumBytes: ACCOUNT_UPSERT_MAXIMUM_BYTES,
    });
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      return invalid("account must be a plain canonical object");
    }
    const account = decoded as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    const boundedString = (field: LibraryCoreCanonicalValue | undefined) =>
      field === undefined ||
      (typeof field === "string" && field.length <= ACCOUNT_UPSERT_MAXIMUM_BYTES);
    if (
      typeof account.id !== "string" ||
      account.id.length === 0 ||
      account.id.length > 4_096 ||
      (account.kind !== "social" && account.kind !== "contact") ||
      typeof account.provider !== "string" ||
      !ACCOUNT_PROVIDERS.includes(
        account.provider as (typeof ACCOUNT_PROVIDERS)[number],
      ) ||
      typeof account.externalId !== "string" ||
      account.externalId.length === 0 ||
      account.externalId.length > 16_384 ||
      !["captured_item", "story_author", "contact_import", "manual_entry", "follow_roster"].includes(
        account.discoveredFrom as string,
      ) ||
      !Number.isSafeInteger(account.firstSeenAt) ||
      (account.firstSeenAt as number) < 0 ||
      !Number.isSafeInteger(account.lastSeenAt) ||
      (account.lastSeenAt as number) < 0 ||
      !Number.isSafeInteger(account.createdAt) ||
      (account.createdAt as number) < 0 ||
      !Number.isSafeInteger(account.updatedAt) ||
      (account.updatedAt as number) < 0
    ) {
      return invalid("account has invalid required fields");
    }
    for (const key of [
      "personId",
      "handle",
      "displayName",
      "avatarUrl",
      "profileUrl",
      "email",
      "phone",
      "address",
    ] as const) {
      if (!boundedString(account[key])) {
        return invalid(`account.${key} must be a bounded string`);
      }
    }
    for (const key of ["importedAt", "followRosterSyncedAt"] as const) {
      const field = account[key];
      if (
        field !== undefined &&
        (!Number.isSafeInteger(field) || (field as number) < 0)
      ) {
        return invalid(`account.${key} must be nonnegative`);
      }
    }
    if (
      account.followRosterActive !== undefined &&
      typeof account.followRosterActive !== "boolean"
    ) {
      return invalid("account.followRosterActive must be boolean");
    }
    if (
      account.followRosterRoles !== undefined &&
      (!Array.isArray(account.followRosterRoles) ||
        account.followRosterRoles.length > 3 ||
        account.followRosterRoles.some(
          (role) =>
            role !== "follower" &&
            role !== "following" &&
            role !== "subscription",
        ))
    ) {
      return invalid("account.followRosterRoles is invalid");
    }
    if (account.sampleDataFingerprint !== undefined) {
      const fingerprint = account.sampleDataFingerprint;
      if (
        typeof fingerprint !== "object" ||
        fingerprint === null ||
        Array.isArray(fingerprint)
      ) {
        return invalid("account.sampleDataFingerprint is invalid");
      }
      const fields = fingerprint as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      if (
        Object.keys(fields).length !== 4 ||
        !["marker", "batchId", "generatedAt", "generatorVersion"].every((key) =>
          Object.prototype.hasOwnProperty.call(fields, key),
        ) ||
        fields.marker !== "freed.sample-data.v1" ||
        typeof fields.batchId !== "string" ||
        !Number.isSafeInteger(fields.generatedAt) ||
        (fields.generatedAt as number) < 0 ||
        !Number.isSafeInteger(fields.generatorVersion) ||
        (fields.generatorVersion as number) < 0
      ) {
        return invalid("account.sampleDataFingerprint is invalid");
      }
    }
    const sanitized = sanitizeAccountWrite(
      account as unknown as Partial<Account>,
    );
    const sanitizedBytes = encodeLibraryCoreCanonicalValue(
      sanitized as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: ACCOUNT_UPSERT_MAXIMUM_BYTES },
    );
    if (
      sanitizedBytes.byteLength !== encoded.byteLength ||
      sanitizedBytes.some((byte, index) => byte !== encoded[index])
    ) {
      return invalid("account contains device-local or unsupported fields");
    }
    return { ok: true, value: Object.freeze({ account }) };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "account is not canonical",
    );
  }
}

function validateAccountRemovePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<AccountRemovePayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== ACCOUNT_REMOVE_KEYS[0]) {
    return invalid("payload must contain only removed_at_ms");
  }
  const removedAtMs = (value as { removed_at_ms?: unknown }).removed_at_ms;
  if (!isLibraryCoreNonnegativeSafeInteger(removedAtMs)) {
    return invalid("removed_at_ms must be a nonnegative safe integer");
  }
  return { ok: true, value: Object.freeze({ removed_at_ms: removedAtMs }) };
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

export const RSS_FEED_TITLE_ASSIGNMENT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "rss_feed_title_assignment_payload_v1",
  schemaVersion: 1,
  operationType: "rss_feed_title_assignment",
  canonicalKeys: RSS_FEED_TITLE_ASSIGNMENT_KEYS,
  validate: validateRssFeedTitleAssignmentPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "rss_feed_title_assignment",
  RssFeedTitleAssignmentPayloadV1
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

export const PERSON_UPSERT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "person_upsert_payload_v1",
  schemaVersion: 1,
  operationType: "person_upsert",
  canonicalKeys: PERSON_UPSERT_KEYS,
  validate: validatePersonUpsertPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "person_upsert",
  PersonUpsertPayloadV1
>;

export const PERSON_REMOVE_AND_ACCOUNTS_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "person_remove_and_accounts_payload_v1",
  schemaVersion: 1,
  operationType: "person_remove_and_accounts",
  canonicalKeys: PERSON_REMOVE_KEYS,
  validate: validatePersonRemovePayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "person_remove_and_accounts",
  PersonRemovePayloadV1
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

export const ACCOUNT_UPSERT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "account_upsert_payload_v1",
  schemaVersion: 1,
  operationType: "account_upsert",
  canonicalKeys: ACCOUNT_UPSERT_KEYS,
  validate: validateAccountUpsertPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "account_upsert",
  AccountUpsertPayloadV1
>;

export const ACCOUNT_REMOVE_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "account_remove_payload_v1",
  schemaVersion: 1,
  operationType: "account_remove",
  canonicalKeys: ACCOUNT_REMOVE_KEYS,
  validate: validateAccountRemovePayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "account_remove",
  AccountRemovePayloadV1
>;

export const FEED_ITEM_SAVED_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateAssignmentPayloadSchema("feed_item_saved_assignment");
export const FEED_ITEM_ARCHIVE_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateAssignmentPayloadSchema("feed_item_archive_assignment");
export const FEED_ITEM_LIKE_ASSIGNMENT_PAYLOAD_SCHEMA =
  userStateAssignmentPayloadSchema("feed_item_like_assignment");
