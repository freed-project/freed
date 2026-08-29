import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";
import { sanitizeUserPreferenceWrite } from "../sync-write-policy.js";
import {
  sanitizeAccountWrite,
  sanitizeFeedItemWrite,
  sanitizePersonWrite,
} from "../sync-write-policy.js";
import type {
  Account,
  ContentSignal,
  ContentSignals,
  EventCandidate,
  FeedItem,
  Highlight,
  Person,
  UserPreferences,
} from "../types.js";
import { CONTENT_SIGNAL_KEYS } from "../content-signals.js";

// Operation envelopes and normalized checkpoint records share the 131,072-byte
// logical-record ceiling. Keep metadata payloads below that ceiling so the
// closed envelope and checkpoint wrappers always have room. Long-form content
// belongs in content-addressed blob chunks, never in a larger metadata record.
const FEED_ITEM_CAPTURE_MAXIMUM_BYTES = 98_304;
const RSS_FEED_UPSERT_MAXIMUM_BYTES = 65_536;
const PREFERENCES_PATCH_MAXIMUM_BYTES = 262_144;
const PREFERENCES_PATCH_MAXIMUM_NODES = 512;
const PREFERENCE_PATH_MAXIMUM_UTF8_BYTES = 4_096;
const PREFERENCE_TEXT_MAXIMUM_UTF8_BYTES = 8_192;
const PERSON_UPSERT_MAXIMUM_BYTES = 65_536;
const ACCOUNT_UPSERT_MAXIMUM_BYTES = 65_536;
const FRIEND_REPLACE_MAXIMUM_BYTES = 98_304;
export const FRIEND_REPLACE_MAXIMUM_ACCOUNTS = 64;
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

export interface FeedItemAnnotationsReplacePayloadV1 {
  readonly assigned_at_ms: number;
  readonly highlights: readonly Readonly<{
    createdAt: number;
    note: string | null;
    text: string | null;
    textBlobDigest: string | null;
  }>[];
  readonly tags: readonly string[];
}

export interface FeedItemAnalysisReplacePayloadV1 {
  readonly assigned_at_ms: number;
  readonly content_signals: Readonly<{
    inferred_at_ms: number;
    method: "rules" | "ai" | "manual";
    scores: readonly Readonly<{
      score_basis_points: number;
      signal: ContentSignal;
      tagged: boolean;
    }>[];
    version: number;
  }> | null;
  readonly event_candidate: Readonly<{
    confidence_basis_points: number;
    detected_at_ms: number;
    ends_at_ms: number | null;
    evidence: string | null;
    evidence_blob_digest: string | null;
    location_name: string | null;
    location_url: string | null;
    method: "rules" | "ai" | "manual";
    starts_at_ms: number | null;
    timezone: string | null;
    title: string | null;
    version: number;
  }> | null;
}

export interface FeedItemReadAssignmentPayloadV1 {
  readonly read_at_ms: number;
}

export interface FeedItemPriorityAssignmentPayloadV1 {
  readonly assigned_at_ms: number;
  readonly priority_basis_points: number;
}

export interface FeedItemSyncReceiptPayloadV1 {
  readonly synced_at_ms: number;
}

export type FeedItemSyncReceiptOperationTypeV1 =
  "feed_item_like_sync_receipt" | "feed_item_seen_sync_receipt";

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

export interface FriendReplacePayloadV1 {
  readonly accounts: readonly Readonly<
    Record<string, LibraryCoreCanonicalValue>
  >[];
  readonly person: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface PersonReachOutAppendPayloadV1 {
  readonly channel: "phone" | "text" | "email" | "in_person" | "other" | null;
  readonly logged_at_ms: number;
  readonly notes: string | null;
}

export interface PersonRemovePayloadV1 {
  readonly removed_at_ms: number;
}

export interface AccountUpsertPayloadV1 {
  readonly account: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

export interface AccountPersonAssignmentPayloadV1 {
  readonly assigned_at_ms: number;
  readonly person_id: string | null;
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
const PRIORITY_ASSIGNMENT_KEYS = [
  "assigned_at_ms",
  "priority_basis_points",
] as const;
const SYNC_RECEIPT_KEYS = ["synced_at_ms"] as const;
const FEED_ITEM_CAPTURE_UPSERT_KEYS = ["item"] as const;
const FEED_ITEM_ANALYSIS_REPLACE_KEYS = [
  "assigned_at_ms",
  "content_signals",
  "event_candidate",
] as const;
const FEED_ITEM_ANNOTATIONS_REPLACE_KEYS = [
  "assigned_at_ms",
  "highlights",
  "tags",
] as const;
const FEED_ITEM_REMOVE_KEYS = ["removed_at_ms"] as const;
const RSS_FEED_UPSERT_KEYS = ["feed"] as const;
const RSS_FEED_TITLE_ASSIGNMENT_KEYS = ["assigned_at_ms", "title"] as const;
const RSS_FEED_REMOVE_KEYS = ["removed_at_ms"] as const;
const PREFERENCES_LEAF_ASSIGNMENT_KEYS = ["updates"] as const;
const PERSON_UPSERT_KEYS = ["person"] as const;
const FRIEND_REPLACE_KEYS = ["accounts", "person"] as const;
const PERSON_REACH_OUT_APPEND_KEYS = [
  "channel",
  "logged_at_ms",
  "notes",
] as const;
const PERSON_REMOVE_KEYS = ["removed_at_ms"] as const;
const ACCOUNT_UPSERT_KEYS = ["account"] as const;
const ACCOUNT_REMOVE_KEYS = ["removed_at_ms"] as const;
const ACCOUNT_PERSON_ASSIGNMENT_KEYS = ["assigned_at_ms", "person_id"] as const;
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

function isCanonicalObject(
  value: unknown,
): value is Readonly<Record<string, LibraryCoreCanonicalValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function validateFeedItemSyncReceiptPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemSyncReceiptPayloadV1> {
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
  if (keys.length !== 1 || keys[0] !== SYNC_RECEIPT_KEYS[0]) {
    return invalid("payload must contain only synced_at_ms");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "synced_at_ms");
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor) ||
    !isLibraryCoreNonnegativeSafeInteger(descriptor.value)
  ) {
    return invalid("synced_at_ms must be a nonnegative safe integer");
  }
  return {
    ok: true,
    value: Object.freeze({ synced_at_ms: descriptor.value }),
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
    const author = canonicalItem.author;
    const content = canonicalItem.content;
    const userState = canonicalItem.userState;
    const topics = canonicalItem.topics;
    if (
      !isCanonicalObject(author) ||
      !isCanonicalObject(content) ||
      !isCanonicalObject(userState)
    ) {
      return invalid(
        "item must match the closed normalized FeedItem capture shape",
      );
    }
    if (
      typeof canonicalItem.platform !== "string" ||
      canonicalItem.platform.length === 0 ||
      typeof canonicalItem.contentType !== "string" ||
      canonicalItem.contentType.length === 0 ||
      !isLibraryCoreNonnegativeSafeInteger(canonicalItem.capturedAt) ||
      !isLibraryCoreNonnegativeSafeInteger(canonicalItem.publishedAt) ||
      typeof author.id !== "string" ||
      typeof author.handle !== "string" ||
      typeof author.displayName !== "string" ||
      !Array.isArray(content.mediaUrls) ||
      !Array.isArray(content.mediaTypes) ||
      content.mediaUrls.length > 32 ||
      content.mediaTypes.length !== content.mediaUrls.length ||
      content.mediaUrls.some(
        (entry) => typeof entry !== "string" || entry.length === 0,
      ) ||
      content.mediaTypes.some((entry) => typeof entry !== "string") ||
      !Array.isArray(topics) ||
      topics.length > 64 ||
      topics.some((entry) => typeof entry !== "string" || entry.length === 0) ||
      typeof userState.hidden !== "boolean" ||
      typeof userState.saved !== "boolean" ||
      typeof userState.archived !== "boolean" ||
      !Array.isArray(userState.tags) ||
      userState.tags.length !== 0 ||
      Object.hasOwn(userState, "highlights") ||
      Object.hasOwn(canonicalItem, "contentSignals") ||
      Object.hasOwn(canonicalItem, "eventCandidate")
    ) {
      return invalid(
        "item must match the closed normalized FeedItem capture shape",
      );
    }
    if (
      (typeof content.text === "string" &&
        new TextEncoder().encode(content.text).byteLength > 65_536) ||
      (isCanonicalObject(canonicalItem.preservedContent) &&
        typeof canonicalItem.preservedContent.text === "string" &&
        new TextEncoder().encode(canonicalItem.preservedContent.text)
          .byteLength > 65_536)
    ) {
      return invalid("large FeedItem bodies require a content descriptor");
    }
    const synchronizedItem = sanitizeFeedItemWrite(
      canonicalItem as unknown as Partial<FeedItem>,
    ) as LibraryCoreCanonicalValue;
    const synchronizedEncoded = encodeLibraryCoreCanonicalValue(
      synchronizedItem,
      { maximumBytes: FEED_ITEM_CAPTURE_MAXIMUM_BYTES },
    );
    if (
      synchronizedEncoded.byteLength !== encoded.byteLength ||
      synchronizedEncoded.some((byte, index) => byte !== encoded[index])
    ) {
      return invalid("item contains a noncanonical or producer-owned field");
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

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function canonicalizeFeedItemTagsV1(
  input: readonly string[],
): readonly string[] {
  const encoder = new TextEncoder();
  const unique = new Set<string>();
  for (const tag of input) {
    if (
      typeof tag !== "string" ||
      tag.length === 0 ||
      encoder.encode(tag).byteLength > 512
    ) {
      throw new TypeError("each tag must be a bounded nonempty string");
    }
    unique.add(tag);
  }
  if (unique.size > 64) {
    throw new RangeError("a FeedItem may contain at most 64 tags");
  }
  return Object.freeze([...unique].sort(compareUtf8));
}

export function canonicalizeFeedItemHighlightsV1(
  input: readonly Highlight[],
): FeedItemAnnotationsReplacePayloadV1["highlights"] {
  if (input.length > 64) {
    throw new RangeError("a FeedItem may contain at most 64 highlights");
  }
  const encoder = new TextEncoder();
  return Object.freeze(
    input.map((highlight) => {
      if (
        !isLibraryCoreNonnegativeSafeInteger(highlight.createdAt) ||
        typeof highlight.text !== "string" ||
        highlight.text.length === 0 ||
        encoder.encode(highlight.text).byteLength > 65_536 ||
        (highlight.note !== undefined &&
          (typeof highlight.note !== "string" ||
            encoder.encode(highlight.note).byteLength > 8_192))
      ) {
        throw new TypeError("FeedItem highlight is invalid or too large");
      }
      return Object.freeze({
        createdAt: highlight.createdAt,
        note: highlight.note ?? null,
        text: highlight.text,
        textBlobDigest: null,
      });
    }),
  );
}

export function canonicalizeFeedItemAnalysisV1(
  contentSignals: ContentSignals | undefined,
  eventCandidate: EventCandidate | undefined,
): Readonly<
  Pick<FeedItemAnalysisReplacePayloadV1, "content_signals" | "event_candidate">
> {
  const encoder = new TextEncoder();
  const boundedOptionalText = (
    value: string | undefined,
    maximumBytes: number,
    label: string,
  ): string | null => {
    if (value === undefined) return null;
    if (encoder.encode(value).byteLength > maximumBytes) {
      throw new RangeError(`${label} requires a content descriptor`);
    }
    return value;
  };
  if (contentSignals) {
    const taggedSignals = new Set<ContentSignal>();
    for (const signal of contentSignals.tags) {
      if (
        !CONTENT_SIGNAL_KEYS.includes(signal) ||
        taggedSignals.has(signal) ||
        contentSignals.scores[signal] === undefined
      ) {
        throw new TypeError(
          "each content signal tag must be unique and have a score",
        );
      }
      taggedSignals.add(signal);
    }
  }
  const normalizedSignals = contentSignals
    ? Object.freeze({
        inferred_at_ms: contentSignals.inferredAt,
        method: contentSignals.method,
        scores: Object.freeze(
          CONTENT_SIGNAL_KEYS.flatMap((signal) => {
            const score = contentSignals.scores[signal];
            if (score === undefined) return [];
            if (!Number.isFinite(score) || score < 0 || score > 1) {
              throw new TypeError(
                "content signal score must be between 0 and 1",
              );
            }
            return [
              Object.freeze({
                score_basis_points: Math.round(score * 10_000),
                signal,
                tagged: contentSignals.tags.includes(signal),
              }),
            ];
          }),
        ),
        version: contentSignals.version,
      })
    : null;
  if (
    normalizedSignals !== null &&
    (!isLibraryCoreNonnegativeSafeInteger(normalizedSignals.version) ||
      !isLibraryCoreNonnegativeSafeInteger(normalizedSignals.inferred_at_ms))
  ) {
    throw new TypeError("content signal metadata is invalid");
  }
  const normalizedEvent = eventCandidate
    ? Object.freeze({
        confidence_basis_points: Math.round(eventCandidate.confidence * 10_000),
        detected_at_ms: eventCandidate.detectedAt,
        ends_at_ms: eventCandidate.endsAt ?? null,
        evidence: boundedOptionalText(
          eventCandidate.evidence,
          65_536,
          "event evidence",
        ),
        evidence_blob_digest: null,
        location_name: boundedOptionalText(
          eventCandidate.locationName,
          4_096,
          "event location",
        ),
        location_url: boundedOptionalText(
          eventCandidate.locationUrl,
          8_192,
          "event location URL",
        ),
        method: eventCandidate.method,
        starts_at_ms: eventCandidate.startsAt ?? null,
        timezone: boundedOptionalText(
          eventCandidate.timezone,
          512,
          "event timezone",
        ),
        title: boundedOptionalText(eventCandidate.title, 4_096, "event title"),
        version: eventCandidate.version,
      })
    : null;
  if (
    normalizedEvent !== null &&
    (!isLibraryCoreNonnegativeSafeInteger(normalizedEvent.version) ||
      !isLibraryCoreNonnegativeSafeInteger(normalizedEvent.detected_at_ms) ||
      !Number.isFinite(eventCandidate?.confidence) ||
      normalizedEvent.confidence_basis_points < 0 ||
      normalizedEvent.confidence_basis_points > 10_000 ||
      ![normalizedEvent.starts_at_ms, normalizedEvent.ends_at_ms].every(
        (value) => value === null || isLibraryCoreNonnegativeSafeInteger(value),
      ))
  ) {
    throw new TypeError("event candidate metadata is invalid");
  }
  return Object.freeze({
    content_signals: normalizedSignals,
    event_candidate: normalizedEvent,
  });
}

function validateFeedItemAnalysisReplacePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemAnalysisReplacePayloadV1> {
  if (!isCanonicalObject(value))
    return invalid("payload must be a plain object");
  const keys = Object.getOwnPropertyNames(value);
  if (
    keys.length !== FEED_ITEM_ANALYSIS_REPLACE_KEYS.length ||
    FEED_ITEM_ANALYSIS_REPLACE_KEYS.some((key) => !keys.includes(key))
  ) {
    return invalid(
      "payload must contain only assigned_at_ms, content_signals, and event_candidate",
    );
  }
  if (!isLibraryCoreNonnegativeSafeInteger(value.assigned_at_ms)) {
    return invalid("assigned_at_ms must be a nonnegative safe integer");
  }
  const contentSignals = value.content_signals;
  if (contentSignals !== null) {
    if (
      !isCanonicalObject(contentSignals) ||
      Object.keys(contentSignals).sort().join(",") !==
        "inferred_at_ms,method,scores,version" ||
      !isLibraryCoreNonnegativeSafeInteger(contentSignals.version) ||
      !isLibraryCoreNonnegativeSafeInteger(contentSignals.inferred_at_ms) ||
      !["rules", "ai", "manual"].includes(String(contentSignals.method)) ||
      !Array.isArray(contentSignals.scores) ||
      contentSignals.scores.length > CONTENT_SIGNAL_KEYS.length
    ) {
      return invalid("content_signals must use the closed normalized shape");
    }
    let previousSignalIndex = -1;
    for (const score of contentSignals.scores) {
      if (
        !isCanonicalObject(score) ||
        Object.keys(score).sort().join(",") !==
          "score_basis_points,signal,tagged" ||
        typeof score.signal !== "string" ||
        typeof score.tagged !== "boolean" ||
        !isLibraryCoreNonnegativeSafeInteger(score.score_basis_points) ||
        score.score_basis_points > 10_000
      ) {
        return invalid("content signal score is invalid");
      }
      const signalIndex = CONTENT_SIGNAL_KEYS.indexOf(
        score.signal as ContentSignal,
      );
      if (signalIndex <= previousSignalIndex) {
        return invalid("content signal scores must be ordered and unique");
      }
      previousSignalIndex = signalIndex;
    }
  }
  const eventCandidate = value.event_candidate;
  if (eventCandidate !== null) {
    if (
      !isCanonicalObject(eventCandidate) ||
      Object.keys(eventCandidate).sort().join(",") !==
        "confidence_basis_points,detected_at_ms,ends_at_ms,evidence,evidence_blob_digest,location_name,location_url,method,starts_at_ms,timezone,title,version" ||
      !isLibraryCoreNonnegativeSafeInteger(eventCandidate.version) ||
      !isLibraryCoreNonnegativeSafeInteger(eventCandidate.detected_at_ms) ||
      !isLibraryCoreNonnegativeSafeInteger(
        eventCandidate.confidence_basis_points,
      ) ||
      eventCandidate.confidence_basis_points > 10_000 ||
      !["rules", "ai", "manual"].includes(String(eventCandidate.method))
    ) {
      return invalid("event_candidate must use the closed normalized shape");
    }
    for (const field of ["starts_at_ms", "ends_at_ms"] as const) {
      const fieldValue = eventCandidate[field];
      if (
        fieldValue !== null &&
        !isLibraryCoreNonnegativeSafeInteger(fieldValue)
      ) {
        return invalid(`${field} must be null or a nonnegative safe integer`);
      }
    }
    const encoder = new TextEncoder();
    for (const [field, maximum] of [
      ["title", 4_096],
      ["timezone", 512],
      ["location_name", 4_096],
      ["location_url", 8_192],
      ["evidence", 65_536],
    ] as const) {
      const fieldValue = eventCandidate[field];
      if (
        fieldValue !== null &&
        (typeof fieldValue !== "string" ||
          encoder.encode(fieldValue).byteLength > maximum)
      ) {
        return invalid(`${field} exceeds its bound`);
      }
    }
    if (
      eventCandidate.evidence_blob_digest !== null &&
      (typeof eventCandidate.evidence_blob_digest !== "string" ||
        !/^[0-9a-f]{64}$/.test(eventCandidate.evidence_blob_digest))
    ) {
      return invalid("event evidence descriptor is invalid");
    }
    if (
      eventCandidate.evidence !== null &&
      eventCandidate.evidence_blob_digest !== null
    ) {
      return invalid("event evidence must be inline or content addressed");
    }
  }
  try {
    const encoded = encodeLibraryCoreCanonicalValue(
      value as LibraryCoreCanonicalValue,
      { maximumBytes: 98_304 },
    );
    const decoded = decodeLibraryCoreCanonicalValue(encoded, {
      maximumBytes: 98_304,
    }) as unknown as FeedItemAnalysisReplacePayloadV1;
    return { ok: true, value: decoded };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "analysis payload is invalid",
    );
  }
}

function validateFeedItemPriorityAssignmentPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemPriorityAssignmentPayloadV1> {
  if (!isCanonicalObject(value))
    return invalid("payload must be a plain object");
  const keys = Object.getOwnPropertyNames(value);
  if (
    keys.length !== PRIORITY_ASSIGNMENT_KEYS.length ||
    PRIORITY_ASSIGNMENT_KEYS.some((key) => !keys.includes(key)) ||
    !isLibraryCoreNonnegativeSafeInteger(value.assigned_at_ms) ||
    !isLibraryCoreNonnegativeSafeInteger(value.priority_basis_points) ||
    value.priority_basis_points > 10_000
  ) {
    return invalid(
      "priority payload must contain a bounded score and assignment time",
    );
  }
  return {
    ok: true,
    value: Object.freeze({
      assigned_at_ms: value.assigned_at_ms,
      priority_basis_points: value.priority_basis_points,
    }),
  };
}

function validateFeedItemAnnotationsReplacePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FeedItemAnnotationsReplacePayloadV1> {
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
    keys.length !== FEED_ITEM_ANNOTATIONS_REPLACE_KEYS.length ||
    FEED_ITEM_ANNOTATIONS_REPLACE_KEYS.some((key) => !keys.includes(key))
  ) {
    return invalid(
      "payload must contain only assigned_at_ms, highlights, and tags",
    );
  }
  const assignedAt = Object.getOwnPropertyDescriptor(value, "assigned_at_ms");
  const tagsDescriptor = Object.getOwnPropertyDescriptor(value, "tags");
  const highlightsDescriptor = Object.getOwnPropertyDescriptor(
    value,
    "highlights",
  );
  if (
    assignedAt === undefined ||
    !assignedAt.enumerable ||
    !("value" in assignedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(assignedAt.value)
  ) {
    return invalid("assigned_at_ms must be a nonnegative safe integer");
  }
  if (
    tagsDescriptor === undefined ||
    !tagsDescriptor.enumerable ||
    !("value" in tagsDescriptor) ||
    !Array.isArray(tagsDescriptor.value) ||
    tagsDescriptor.value.length > 64
  ) {
    return invalid("tags must be an array containing at most 64 values");
  }
  const tags: string[] = [];
  const encoder = new TextEncoder();
  for (const tag of tagsDescriptor.value) {
    if (
      typeof tag !== "string" ||
      tag.length === 0 ||
      encoder.encode(tag).byteLength > 512
    ) {
      return invalid("each tag must be a bounded nonempty string");
    }
    if (tags.length > 0 && compareUtf8(tags[tags.length - 1]!, tag) >= 0) {
      return invalid("tags must be strictly binary sorted with no duplicates");
    }
    tags.push(tag);
  }
  if (
    highlightsDescriptor === undefined ||
    !highlightsDescriptor.enumerable ||
    !("value" in highlightsDescriptor) ||
    !Array.isArray(highlightsDescriptor.value) ||
    highlightsDescriptor.value.length > 64
  ) {
    return invalid("highlights must be an array containing at most 64 values");
  }
  const highlights: FeedItemAnnotationsReplacePayloadV1["highlights"][number][] =
    [];
  for (const highlight of highlightsDescriptor.value) {
    const highlightPrototype =
      typeof highlight === "object" && highlight !== null
        ? Object.getPrototypeOf(highlight)
        : undefined;
    if (
      typeof highlight !== "object" ||
      highlight === null ||
      Array.isArray(highlight) ||
      (highlightPrototype !== Object.prototype &&
        highlightPrototype !== null) ||
      Object.getOwnPropertyNames(highlight).sort().join(",") !==
        "createdAt,note,text,textBlobDigest"
    ) {
      return invalid("each highlight must use the closed normalized shape");
    }
    const record = highlight as Record<string, unknown>;
    const text = record.text;
    const textBlobDigest = record.textBlobDigest;
    if (
      !isLibraryCoreNonnegativeSafeInteger(record.createdAt) ||
      (record.note !== null &&
        (typeof record.note !== "string" ||
          encoder.encode(record.note).byteLength > 8_192)) ||
      (text !== null &&
        (typeof text !== "string" ||
          text.length === 0 ||
          encoder.encode(text).byteLength > 65_536)) ||
      (textBlobDigest !== null &&
        (typeof textBlobDigest !== "string" ||
          !/^[0-9a-f]{64}$/.test(textBlobDigest))) ||
      (text === null) === (textBlobDigest === null)
    ) {
      return invalid("highlight content or descriptor is invalid");
    }
    highlights.push(
      Object.freeze({
        createdAt: record.createdAt as number,
        note: record.note as string | null,
        text: text as string | null,
        textBlobDigest: textBlobDigest as string | null,
      }),
    );
  }
  try {
    encodeLibraryCoreCanonicalValue(
      {
        assigned_at_ms: assignedAt.value,
        highlights,
        tags,
      },
      { maximumBytes: 98_304 },
    );
  } catch (error) {
    return invalid(
      error instanceof Error
        ? error.message
        : "annotation payload exceeds its bound",
    );
  }
  return {
    ok: true,
    value: Object.freeze({
      assigned_at_ms: assignedAt.value,
      highlights: Object.freeze(highlights),
      tags: Object.freeze(tags),
    }),
  };
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
    const synchronized = sanitizeUserPreferenceWrite(
      updates as Partial<UserPreferences>,
    ) as unknown as LibraryCoreCanonicalValue;
    const synchronizedBytes = encodeLibraryCoreCanonicalValue(synchronized, {
      maximumBytes: PREFERENCES_PATCH_MAXIMUM_BYTES,
    });
    if (
      synchronizedBytes.byteLength !== encoded.byteLength ||
      synchronizedBytes.some((byte, index) => byte !== encoded[index])
    ) {
      return invalid("updates contain unsupported fields");
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
    if (Object.prototype.hasOwnProperty.call(person, "reachOutLog")) {
      return invalid(
        "person.reachOutLog must use person_reach_out_append operations",
      );
    }
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
          new TextEncoder().encode(field).byteLength >
            PERSON_UPSERT_MAXIMUM_BYTES)
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

function validateFriendReplacePayload(
  value: unknown,
): LibraryCorePayloadValidationResult<FriendReplacePayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (
    keys.length !== FRIEND_REPLACE_KEYS.length ||
    keys.some((key, index) => key !== FRIEND_REPLACE_KEYS[index])
  ) {
    return invalid("payload must contain only accounts and person");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const personResult = validatePersonUpsertPayload({ person: record.person });
  if (!personResult.ok) return invalid(personResult.reason);
  if (
    !Array.isArray(record.accounts) ||
    record.accounts.length > FRIEND_REPLACE_MAXIMUM_ACCOUNTS
  ) {
    return invalid("accounts must be a bounded array");
  }
  const accounts: Readonly<Record<string, LibraryCoreCanonicalValue>>[] = [];
  const accountIds = new Set<string>();
  let priorAccountId: string | null = null;
  let contactCount = 0;
  for (const candidate of record.accounts) {
    const accountResult = validateAccountUpsertPayload({ account: candidate });
    if (!accountResult.ok) return invalid(accountResult.reason);
    const account = accountResult.value.account;
    const accountId = account.id as string;
    if (
      account.personId !== personResult.value.person.id ||
      accountIds.has(accountId) ||
      (priorAccountId !== null && priorAccountId.localeCompare(accountId) >= 0)
    ) {
      return invalid(
        "accounts must be unique, sorted by ID, and linked to the Person",
      );
    }
    if (account.kind === "contact" && ++contactCount > 1) {
      return invalid("a Friend may contain at most one contact Account");
    }
    accountIds.add(accountId);
    priorAccountId = accountId;
    accounts.push(account);
  }
  try {
    encodeLibraryCoreCanonicalValue(
      { accounts, person: personResult.value.person },
      { maximumBytes: FRIEND_REPLACE_MAXIMUM_BYTES },
    );
  } catch (error) {
    return invalid(
      error instanceof Error
        ? error.message
        : "Friend payload is not canonical",
    );
  }
  return {
    ok: true,
    value: Object.freeze({
      accounts: Object.freeze(accounts),
      person: personResult.value.person,
    }),
  };
}

function validatePersonReachOutAppendPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<PersonReachOutAppendPayloadV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload must be a plain object");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.getOwnPropertyNames(record);
  if (
    keys.length !== PERSON_REACH_OUT_APPEND_KEYS.length ||
    keys.some((key, index) => key !== PERSON_REACH_OUT_APPEND_KEYS[index])
  ) {
    return invalid(
      "payload must contain only channel, logged_at_ms, and notes",
    );
  }
  const channels = new Set(["phone", "text", "email", "in_person", "other"]);
  if (
    record.channel !== null &&
    (typeof record.channel !== "string" || !channels.has(record.channel))
  ) {
    return invalid("channel must be null or a supported channel");
  }
  if (!isLibraryCoreNonnegativeSafeInteger(record.logged_at_ms)) {
    return invalid("logged_at_ms must be a nonnegative safe integer");
  }
  if (
    record.notes !== null &&
    (typeof record.notes !== "string" ||
      new TextEncoder().encode(record.notes).byteLength > 65_536)
  ) {
    return invalid("notes must be null or a bounded string");
  }
  return {
    ok: true,
    value: Object.freeze({
      channel: record.channel as PersonReachOutAppendPayloadV1["channel"],
      logged_at_ms: record.logged_at_ms,
      notes: record.notes as string | null,
    }),
  };
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
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      return invalid("account must be a plain canonical object");
    }
    const account = decoded as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    const boundedString = (field: LibraryCoreCanonicalValue | undefined) =>
      field === undefined ||
      (typeof field === "string" &&
        new TextEncoder().encode(field).byteLength <=
          ACCOUNT_UPSERT_MAXIMUM_BYTES);
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
      ![
        "captured_item",
        "story_author",
        "contact_import",
        "manual_entry",
        "follow_roster",
      ].includes(account.discoveredFrom as string) ||
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

function validateAccountPersonAssignmentPayload(
  value: unknown,
): LibraryCorePayloadValidationResult<AccountPersonAssignmentPayloadV1> {
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
    keys.length !== ACCOUNT_PERSON_ASSIGNMENT_KEYS.length ||
    ACCOUNT_PERSON_ASSIGNMENT_KEYS.some((key) => !keys.includes(key))
  ) {
    return invalid("payload must contain only assigned_at_ms and person_id");
  }
  const assignedAt = Object.getOwnPropertyDescriptor(value, "assigned_at_ms");
  const personId = Object.getOwnPropertyDescriptor(value, "person_id");
  if (
    assignedAt === undefined ||
    !assignedAt.enumerable ||
    !("value" in assignedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(assignedAt.value)
  ) {
    return invalid("assigned_at_ms must be a nonnegative safe integer");
  }
  if (
    personId === undefined ||
    !personId.enumerable ||
    !("value" in personId) ||
    (personId.value !== null &&
      (typeof personId.value !== "string" ||
        personId.value.length === 0 ||
        new TextEncoder().encode(personId.value).byteLength > 4_096))
  ) {
    return invalid("person_id must be null or a bounded nonempty string");
  }
  return {
    ok: true,
    value: Object.freeze({
      assigned_at_ms: assignedAt.value,
      person_id: personId.value,
    }),
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

function feedItemSyncReceiptPayloadSchema(
  operationType: FeedItemSyncReceiptOperationTypeV1,
) {
  return Object.freeze({
    schemaId: `${operationType}_payload_v1`,
    schemaVersion: 1 as const,
    operationType,
    canonicalKeys: SYNC_RECEIPT_KEYS,
    validate: validateFeedItemSyncReceiptPayload,
  });
}

export const FEED_ITEM_LIKE_SYNC_RECEIPT_PAYLOAD_SCHEMA =
  feedItemSyncReceiptPayloadSchema("feed_item_like_sync_receipt");
export const FEED_ITEM_SEEN_SYNC_RECEIPT_PAYLOAD_SCHEMA =
  feedItemSyncReceiptPayloadSchema("feed_item_seen_sync_receipt");

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

export const FEED_ITEM_ANALYSIS_REPLACE_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "feed_item_analysis_replace_payload_v1",
  schemaVersion: 1,
  operationType: "feed_item_analysis_replace",
  canonicalKeys: FEED_ITEM_ANALYSIS_REPLACE_KEYS,
  validate: validateFeedItemAnalysisReplacePayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "feed_item_analysis_replace",
  FeedItemAnalysisReplacePayloadV1
>;

export const FEED_ITEM_PRIORITY_ASSIGNMENT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "feed_item_priority_assignment_payload_v1",
  schemaVersion: 1,
  operationType: "feed_item_priority_assignment",
  canonicalKeys: PRIORITY_ASSIGNMENT_KEYS,
  validate: validateFeedItemPriorityAssignmentPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "feed_item_priority_assignment",
  FeedItemPriorityAssignmentPayloadV1
>;

export const FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "feed_item_annotations_replace_payload_v1",
  schemaVersion: 1,
  operationType: "feed_item_annotations_replace",
  canonicalKeys: FEED_ITEM_ANNOTATIONS_REPLACE_KEYS,
  validate: validateFeedItemAnnotationsReplacePayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "feed_item_annotations_replace",
  FeedItemAnnotationsReplacePayloadV1
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

export const FRIEND_REPLACE_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "friend_replace_payload_v1",
  schemaVersion: 1,
  operationType: "friend_replace",
  canonicalKeys: FRIEND_REPLACE_KEYS,
  validate: validateFriendReplacePayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "friend_replace",
  FriendReplacePayloadV1
>;

export const PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "person_reach_out_append_payload_v1",
  schemaVersion: 1,
  operationType: "person_reach_out_append",
  canonicalKeys: PERSON_REACH_OUT_APPEND_KEYS,
  validate: validatePersonReachOutAppendPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "person_reach_out_append",
  PersonReachOutAppendPayloadV1
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

export const PERSON_REMOVE_DETACH_ACCOUNTS_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "person_remove_detach_accounts_payload_v1",
  schemaVersion: 1,
  operationType: "person_remove_detach_accounts",
  canonicalKeys: PERSON_REMOVE_KEYS,
  validate: validatePersonRemovePayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "person_remove_detach_accounts",
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

export const ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_SCHEMA = Object.freeze({
  schemaId: "account_person_assignment_payload_v1",
  schemaVersion: 1,
  operationType: "account_person_assignment",
  canonicalKeys: ACCOUNT_PERSON_ASSIGNMENT_KEYS,
  validate: validateAccountPersonAssignmentPayload,
}) satisfies LibraryCoreOperationPayloadSchema<
  "account_person_assignment",
  AccountPersonAssignmentPayloadV1
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
