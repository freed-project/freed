import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
} from "./protocol-scalars.js";
import {
  LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES,
  LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_MAXIMUM_UTF8_BYTES,
  LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_PREFIX,
  LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_SUFFIX,
} from "./sqlite-contract.generated.js";

export const LIBRARY_CORE_SELECTIVE_CONTENT_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_CONTENT_HYDRATION_POLICIES = Object.freeze([
  "metadata_only",
  "stream_on_demand",
  "partial_cache",
  "complete_cache",
  "pinned_offline",
  "excluded",
] as const);
export const LIBRARY_CORE_CONTENT_HYDRATION_STATES = Object.freeze([
  "metadata_only",
  "streamable",
  "partially_cached",
  "fully_cached",
  "pinned_offline",
  "excluded",
  "unavailable",
  "corrupt",
] as const);

export type LibraryCoreContentHydrationPolicyV1 =
  (typeof LIBRARY_CORE_CONTENT_HYDRATION_POLICIES)[number];
export type LibraryCoreContentHydrationStateV1 =
  (typeof LIBRARY_CORE_CONTENT_HYDRATION_STATES)[number];

export interface LibraryCoreContentPolicyMutationV1 {
  readonly contentDigest: string;
  readonly policy: LibraryCoreContentHydrationPolicyV1;
  readonly schemaVersion: 1;
  readonly updatedAt: number;
}

export interface LibraryCoreContentPolicyMutationReceiptV1 {
  readonly changed: boolean;
  readonly contentDigest: string;
  readonly contentRevision: number;
  readonly policy: LibraryCoreContentHydrationPolicyV1;
  readonly schemaVersion: 1;
  readonly updatedAt: number;
}

export interface LibraryCoreContentStateRequestV1 {
  readonly contentDigest: string;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentAvailabilityV1 {
  readonly completeDigestVerifiedAt: number | null;
  readonly hydrationState: LibraryCoreContentHydrationStateV1;
  readonly lastAccessedAt: number;
  readonly storageKind: "content_vault" | "none" | "opfs";
  readonly updatedAt: number;
  readonly verifiedBytes: number;
}

export interface LibraryCoreContentStateV1 {
  readonly availability: LibraryCoreContentAvailabilityV1 | null;
  readonly byteLength: number;
  readonly contentDigest: string;
  readonly contentRevision: number;
  readonly mediaType: string;
  readonly policy: LibraryCoreContentHydrationPolicyV1;
  readonly policyUpdatedAt: number | null;
  readonly schemaVersion: 1;
}

export interface LibraryCoreVerifiedContentRangePublicationV1 {
  readonly byteLength: number;
  readonly contentDigest: string;
  readonly rangeContentDigest: string;
  readonly rangeIndex: number;
  readonly schemaVersion: 1;
  readonly storageKey: string;
  readonly storageKind: "content_vault" | "opfs";
  readonly verifiedAt: number;
}

export interface LibraryCoreVerifiedContentRangeReceiptV1 {
  readonly changed: boolean;
  readonly contentDigest: string;
  readonly contentRevision: number;
  readonly hydrationState: "partially_cached";
  readonly rangeIndex: number;
  readonly schemaVersion: 1;
  readonly verifiedBytes: number;
}

export interface LibraryCoreContentRangePublicationBeginV1 {
  readonly contentDigest: string;
  readonly publicationId: string;
  readonly rangeIndex: number;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentRangePublicationAppendV1 {
  readonly bytes: Uint8Array;
  readonly expectedOffset: number;
  readonly publicationId: string;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentRangePublicationFinalizeV1 {
  readonly publicationId: string;
  readonly schemaVersion: 1;
  readonly verifiedAt: number;
}

export interface LibraryCoreContentRangePublicationAbortV1 {
  readonly publicationId: string;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentRangePublicationStatusV1 {
  readonly contentDigest: string;
  readonly expectedByteLength: number;
  readonly expectedRangeContentDigest: string;
  readonly maximumAppendBytes: typeof LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES;
  readonly nextOffset: number;
  readonly publicationId: string;
  readonly rangeIndex: number;
  readonly schemaVersion: 1;
  readonly state: "staging";
}

export interface LibraryCoreContentRangePublicationAbortReceiptV1 {
  readonly publicationId: string;
  readonly removed: boolean;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentRangeReadRequestV1 {
  readonly accessedAt: number;
  readonly contentDigest: string;
  readonly maximumBytes: number;
  readonly rangeIndex: number;
  readonly rangeOffset: number;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentRangeReadResponseV1 {
  readonly bytes: Uint8Array;
  readonly contentDigest: string;
  readonly nextRangeOffset: number;
  readonly rangeComplete: boolean;
  readonly rangeIndex: number;
  readonly rangeOffset: number;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentCompletionRequestV1 {
  readonly contentDigest: string;
  readonly schemaVersion: 1;
  readonly verifiedAt: number;
}

export interface LibraryCoreContentCompletionReceiptV1 {
  readonly changed: boolean;
  readonly contentDigest: string;
  readonly contentRevision: number;
  readonly hydrationState: "fully_cached" | "pinned_offline";
  readonly schemaVersion: 1;
  readonly verifiedBytes: number;
}

export interface LibraryCoreContentEvictionRequestV1 {
  readonly contentDigest: string;
  readonly evictedAt: number;
  readonly expectedLastAccessedAt: number | null;
  readonly reason: "cache_pressure" | "excluded" | "explicit";
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentEvictionReceiptV1 {
  readonly changed: boolean;
  readonly contentDigest: string;
  readonly contentRevision: number;
  readonly evictedRanges: number;
  readonly releasedBytes: number;
  readonly schemaVersion: 1;
}

export interface LibraryCoreContentWorkSourceV1 {
  readonly contentRevision: number;
  readonly generationId: string;
  readonly sourceRevision: number;
  readonly transitionSequence: number;
}

export interface LibraryCoreHydrationCandidateCursorV1 {
  readonly contentDigest: string;
  readonly policyPriority: 0 | 1;
  readonly policyUpdatedAt: number;
  readonly rangeIndex: number;
}

export interface LibraryCoreHydrationCandidatePageRequestV1 {
  readonly after: LibraryCoreHydrationCandidateCursorV1 | null;
  readonly limit: number;
  readonly schemaVersion: 1;
  readonly source: LibraryCoreContentWorkSourceV1 | null;
}

export interface LibraryCoreHydrationCandidateV1 {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly cloudAvailabilityCommitment: string;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly policy: "complete_cache" | "pinned_offline";
  readonly policyPriority: 0 | 1;
  readonly policyUpdatedAt: number;
  readonly rangeContentDigest: string;
  readonly rangeIndex: number;
}

export interface LibraryCoreHydrationCandidatePageV1 {
  readonly next: LibraryCoreHydrationCandidateCursorV1 | null;
  readonly rows: readonly LibraryCoreHydrationCandidateV1[];
  readonly schemaVersion: 1;
  readonly source: LibraryCoreContentWorkSourceV1;
}

export interface LibraryCoreEvictionCandidateCursorV1 {
  readonly contentDigest: string;
  readonly lastAccessedAt: number;
  readonly policyPriority: 0 | 1 | 2 | 3;
}

export interface LibraryCoreEvictionCandidatePageRequestV1 {
  readonly after: LibraryCoreEvictionCandidateCursorV1 | null;
  readonly limit: number;
  readonly notAccessedAfter: number;
  readonly schemaVersion: 1;
  readonly source: LibraryCoreContentWorkSourceV1 | null;
}

export interface LibraryCoreEvictionCandidateV1 {
  readonly contentDigest: string;
  readonly hydrationState: LibraryCoreContentHydrationStateV1;
  readonly lastAccessedAt: number;
  readonly policy:
    "complete_cache" | "metadata_only" | "partial_cache" | "stream_on_demand";
  readonly policyPriority: 0 | 1 | 2 | 3;
  readonly verifiedBytes: number;
}

export interface LibraryCoreEvictionCandidatePageV1 {
  readonly next: LibraryCoreEvictionCandidateCursorV1 | null;
  readonly rows: readonly LibraryCoreEvictionCandidateV1[];
  readonly schemaVersion: 1;
  readonly source: LibraryCoreContentWorkSourceV1;
}

type ParseResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ error: string; ok: false }>;

function record(value: unknown): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !descriptors[key]?.enumerable ||
        !("value" in descriptors[key]),
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    Object.keys(value).map((key) => [key, descriptors[key]!.value]),
  );
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function validPolicy(
  value: unknown,
): value is LibraryCoreContentHydrationPolicyV1 {
  return LIBRARY_CORE_CONTENT_HYDRATION_POLICIES.includes(
    value as LibraryCoreContentHydrationPolicyV1,
  );
}

function validState(
  value: unknown,
): value is LibraryCoreContentHydrationStateV1 {
  return LIBRARY_CORE_CONTENT_HYDRATION_STATES.includes(
    value as LibraryCoreContentHydrationStateV1,
  );
}

export function createLibraryCoreContentRangeStorageKeyV1(
  contentDigest: string,
  rangeIndex: number,
  rangeContentDigest: string,
): string {
  if (
    !isLibraryCoreLowercaseHex64(contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(rangeIndex) ||
    !isLibraryCoreLowercaseHex64(rangeContentDigest)
  ) {
    throw new TypeError("content range storage identity is invalid");
  }
  const storageKey = `${LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_PREFIX}${contentDigest}-${rangeIndex.toLocaleString("en-US", { useGrouping: false })}-${rangeContentDigest}${LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_SUFFIX}`;
  if (
    new TextEncoder().encode(storageKey).length >
    LIBRARY_CORE_CONTENT_RANGE_STORAGE_KEY_MAXIMUM_UTF8_BYTES
  ) {
    throw new TypeError("content range storage key exceeds its bound");
  }
  return storageKey;
}

export function parseLibraryCoreContentPolicyMutationV1(
  value: unknown,
): ParseResult<LibraryCoreContentPolicyMutationV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "contentDigest",
      "policy",
      "schemaVersion",
      "updatedAt",
    ]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !validPolicy(candidate.policy) ||
    candidate.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.updatedAt)
  ) {
    return Object.freeze({
      error: "selective content policy mutation is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      contentDigest: candidate.contentDigest,
      policy: candidate.policy,
      schemaVersion: 1,
      updatedAt: candidate.updatedAt,
    }),
  });
}

export function parseLibraryCoreContentStateRequestV1(
  value: unknown,
): ParseResult<LibraryCoreContentStateRequestV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["contentDigest", "schemaVersion"]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "selective content state request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      contentDigest: candidate.contentDigest,
      schemaVersion: 1,
    }),
  });
}

export function parseLibraryCoreContentPolicyMutationReceiptV1(
  value: unknown,
): ParseResult<LibraryCoreContentPolicyMutationReceiptV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "changed",
      "contentDigest",
      "contentRevision",
      "policy",
      "schemaVersion",
      "updatedAt",
    ]) ||
    typeof candidate.changed !== "boolean" ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.contentRevision) ||
    !validPolicy(candidate.policy) ||
    candidate.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.updatedAt)
  ) {
    return Object.freeze({
      error: "selective content policy receipt is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentPolicyMutationReceiptV1,
  });
}

export function parseLibraryCoreContentStateV1(
  value: unknown,
): ParseResult<LibraryCoreContentStateV1> {
  const candidate = record(value);
  const availability = candidate ? record(candidate.availability) : null;
  const availabilityValid =
    candidate?.availability === null ||
    (availability !== null &&
      exactKeys(availability, [
        "completeDigestVerifiedAt",
        "hydrationState",
        "lastAccessedAt",
        "storageKind",
        "updatedAt",
        "verifiedBytes",
      ]) &&
      (availability.completeDigestVerifiedAt === null ||
        isLibraryCoreNonnegativeSafeInteger(
          availability.completeDigestVerifiedAt,
        )) &&
      validState(availability.hydrationState) &&
      isLibraryCoreNonnegativeSafeInteger(availability.lastAccessedAt) &&
      ["content_vault", "none", "opfs"].includes(
        String(availability.storageKind),
      ) &&
      isLibraryCoreNonnegativeSafeInteger(availability.updatedAt) &&
      isLibraryCoreNonnegativeSafeInteger(availability.verifiedBytes));
  if (
    !candidate ||
    !exactKeys(candidate, [
      "availability",
      "byteLength",
      "contentDigest",
      "contentRevision",
      "mediaType",
      "policy",
      "policyUpdatedAt",
      "schemaVersion",
    ]) ||
    !availabilityValid ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.byteLength) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.contentRevision) ||
    typeof candidate.mediaType !== "string" ||
    candidate.mediaType.length === 0 ||
    new TextEncoder().encode(candidate.mediaType).length > 255 ||
    !validPolicy(candidate.policy) ||
    (candidate.policyUpdatedAt !== null &&
      !isLibraryCoreNonnegativeSafeInteger(candidate.policyUpdatedAt)) ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "selective content state is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...candidate,
      availability: availability ? Object.freeze(availability) : null,
    }) as unknown as LibraryCoreContentStateV1,
  });
}

export function parseLibraryCoreVerifiedContentRangePublicationV1(
  value: unknown,
): ParseResult<LibraryCoreVerifiedContentRangePublicationV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "byteLength",
      "contentDigest",
      "rangeContentDigest",
      "rangeIndex",
      "schemaVersion",
      "storageKey",
      "storageKind",
      "verifiedAt",
    ]) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.byteLength) ||
    candidate.byteLength < 1 ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreLowercaseHex64(candidate.rangeContentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeIndex) ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.storageKey !== "string" ||
    candidate.storageKey.length === 0 ||
    new TextEncoder().encode(candidate.storageKey).length > 1_024 ||
    !["content_vault", "opfs"].includes(String(candidate.storageKind)) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.verifiedAt)
  ) {
    return Object.freeze({
      error: "verified content range publication is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreVerifiedContentRangePublicationV1,
  });
}

export function parseLibraryCoreVerifiedContentRangeReceiptV1(
  value: unknown,
): ParseResult<LibraryCoreVerifiedContentRangeReceiptV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "changed",
      "contentDigest",
      "contentRevision",
      "hydrationState",
      "rangeIndex",
      "schemaVersion",
      "verifiedBytes",
    ]) ||
    typeof candidate.changed !== "boolean" ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.contentRevision) ||
    candidate.hydrationState !== "partially_cached" ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeIndex) ||
    candidate.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.verifiedBytes)
  ) {
    return Object.freeze({
      error: "verified content range receipt is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreVerifiedContentRangeReceiptV1,
  });
}

export function parseLibraryCoreContentRangePublicationBeginV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangePublicationBeginV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "contentDigest",
      "publicationId",
      "rangeIndex",
      "schemaVersion",
    ]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreLowercaseHex64(candidate.publicationId) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeIndex) ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "content range publication begin request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentRangePublicationBeginV1,
  });
}

export function parseLibraryCoreContentRangeReadRequestV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangeReadRequestV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "accessedAt",
      "contentDigest",
      "maximumBytes",
      "rangeIndex",
      "rangeOffset",
      "schemaVersion",
    ]) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.accessedAt) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.maximumBytes) ||
    candidate.maximumBytes < 1 ||
    candidate.maximumBytes > LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeIndex) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeOffset) ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "content range read request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentRangeReadRequestV1,
  });
}

export function parseLibraryCoreContentRangeReadResponseV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangeReadResponseV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "bytes",
      "contentDigest",
      "nextRangeOffset",
      "rangeComplete",
      "rangeIndex",
      "rangeOffset",
      "schemaVersion",
    ]) ||
    !(candidate.bytes instanceof Uint8Array) ||
    candidate.bytes.byteLength < 1 ||
    candidate.bytes.byteLength >
      LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.nextRangeOffset) ||
    typeof candidate.rangeComplete !== "boolean" ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeIndex) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeOffset) ||
    candidate.nextRangeOffset !==
      candidate.rangeOffset + candidate.bytes.byteLength ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "content range read response is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...candidate,
      bytes: candidate.bytes.slice(),
    }) as unknown as LibraryCoreContentRangeReadResponseV1,
  });
}

export function parseLibraryCoreContentCompletionRequestV1(
  value: unknown,
): ParseResult<LibraryCoreContentCompletionRequestV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["contentDigest", "schemaVersion", "verifiedAt"]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    candidate.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.verifiedAt)
  ) {
    return Object.freeze({
      error: "content completion request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentCompletionRequestV1,
  });
}

export function parseLibraryCoreContentCompletionReceiptV1(
  value: unknown,
): ParseResult<LibraryCoreContentCompletionReceiptV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "changed",
      "contentDigest",
      "contentRevision",
      "hydrationState",
      "schemaVersion",
      "verifiedBytes",
    ]) ||
    typeof candidate.changed !== "boolean" ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.contentRevision) ||
    !["fully_cached", "pinned_offline"].includes(
      String(candidate.hydrationState),
    ) ||
    candidate.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.verifiedBytes)
  ) {
    return Object.freeze({
      error: "content completion receipt is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentCompletionReceiptV1,
  });
}

export function parseLibraryCoreContentEvictionRequestV1(
  value: unknown,
): ParseResult<LibraryCoreContentEvictionRequestV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "contentDigest",
      "evictedAt",
      "expectedLastAccessedAt",
      "reason",
      "schemaVersion",
    ]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.evictedAt) ||
    (candidate.expectedLastAccessedAt !== null &&
      !isLibraryCoreNonnegativeSafeInteger(candidate.expectedLastAccessedAt)) ||
    !["cache_pressure", "excluded", "explicit"].includes(
      String(candidate.reason),
    ) ||
    (candidate.reason === "cache_pressure") !==
      (candidate.expectedLastAccessedAt !== null) ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "content eviction request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentEvictionRequestV1,
  });
}

export function parseLibraryCoreContentEvictionReceiptV1(
  value: unknown,
): ParseResult<LibraryCoreContentEvictionReceiptV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "changed",
      "contentDigest",
      "contentRevision",
      "evictedRanges",
      "releasedBytes",
      "schemaVersion",
    ]) ||
    typeof candidate.changed !== "boolean" ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.contentRevision) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.evictedRanges) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.releasedBytes) ||
    candidate.schemaVersion !== 1 ||
    candidate.changed !== candidate.evictedRanges > 0
  ) {
    return Object.freeze({
      error: "content eviction receipt is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentEvictionReceiptV1,
  });
}

function parseContentWorkSource(
  value: unknown,
): LibraryCoreContentWorkSourceV1 | null {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "contentRevision",
      "generationId",
      "sourceRevision",
      "transitionSequence",
    ]) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.contentRevision) ||
    !isLibraryCoreLowercaseHex64(candidate.generationId) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.sourceRevision) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.transitionSequence)
  ) {
    return null;
  }
  return Object.freeze(candidate) as unknown as LibraryCoreContentWorkSourceV1;
}

function parseHydrationCursor(
  value: unknown,
): LibraryCoreHydrationCandidateCursorV1 | null {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "contentDigest",
      "policyPriority",
      "policyUpdatedAt",
      "rangeIndex",
    ]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    ![0, 1].includes(Number(candidate.policyPriority)) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.policyUpdatedAt) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeIndex)
  ) {
    return null;
  }
  return Object.freeze(
    candidate,
  ) as unknown as LibraryCoreHydrationCandidateCursorV1;
}

function parseEvictionCursor(
  value: unknown,
): LibraryCoreEvictionCandidateCursorV1 | null {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "contentDigest",
      "lastAccessedAt",
      "policyPriority",
    ]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.lastAccessedAt) ||
    ![0, 1, 2, 3].includes(Number(candidate.policyPriority))
  ) {
    return null;
  }
  return Object.freeze(
    candidate,
  ) as unknown as LibraryCoreEvictionCandidateCursorV1;
}

export function parseLibraryCoreHydrationCandidatePageRequestV1(
  value: unknown,
): ParseResult<LibraryCoreHydrationCandidatePageRequestV1> {
  const candidate = record(value);
  const after =
    candidate?.after === null ? null : parseHydrationCursor(candidate?.after);
  const source =
    candidate?.source === null
      ? null
      : parseContentWorkSource(candidate?.source);
  if (
    !candidate ||
    !exactKeys(candidate, ["after", "limit", "schemaVersion", "source"]) ||
    (candidate.after !== null && after === null) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.limit) ||
    candidate.limit < 1 ||
    candidate.limit > 128 ||
    candidate.schemaVersion !== 1 ||
    (candidate.source !== null && source === null) ||
    (after !== null && source === null)
  ) {
    return Object.freeze({
      error: "hydration candidate page request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      after,
      limit: candidate.limit,
      schemaVersion: 1,
      source,
    }),
  }) as ParseResult<LibraryCoreHydrationCandidatePageRequestV1>;
}

export function parseLibraryCoreEvictionCandidatePageRequestV1(
  value: unknown,
): ParseResult<LibraryCoreEvictionCandidatePageRequestV1> {
  const candidate = record(value);
  const after =
    candidate?.after === null ? null : parseEvictionCursor(candidate?.after);
  const source =
    candidate?.source === null
      ? null
      : parseContentWorkSource(candidate?.source);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "after",
      "limit",
      "notAccessedAfter",
      "schemaVersion",
      "source",
    ]) ||
    (candidate.after !== null && after === null) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.limit) ||
    candidate.limit < 1 ||
    candidate.limit > 128 ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.notAccessedAfter) ||
    candidate.schemaVersion !== 1 ||
    (candidate.source !== null && source === null) ||
    (after !== null && source === null)
  ) {
    return Object.freeze({
      error: "eviction candidate page request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      after,
      limit: candidate.limit,
      notAccessedAfter: candidate.notAccessedAfter,
      schemaVersion: 1,
      source,
    }),
  }) as ParseResult<LibraryCoreEvictionCandidatePageRequestV1>;
}

function sameHydrationCursor(
  cursor: LibraryCoreHydrationCandidateCursorV1,
  row: LibraryCoreHydrationCandidateV1,
): boolean {
  return (
    cursor.contentDigest === row.contentDigest &&
    cursor.policyPriority === row.policyPriority &&
    cursor.policyUpdatedAt === row.policyUpdatedAt &&
    cursor.rangeIndex === row.rangeIndex
  );
}

function sameEvictionCursor(
  cursor: LibraryCoreEvictionCandidateCursorV1,
  row: LibraryCoreEvictionCandidateV1,
): boolean {
  return (
    cursor.contentDigest === row.contentDigest &&
    cursor.lastAccessedAt === row.lastAccessedAt &&
    cursor.policyPriority === row.policyPriority
  );
}

export function parseLibraryCoreHydrationCandidatePageV1(
  value: unknown,
): ParseResult<LibraryCoreHydrationCandidatePageV1> {
  const candidate = record(value);
  const source = parseContentWorkSource(candidate?.source);
  const next =
    candidate?.next === null ? null : parseHydrationCursor(candidate?.next);
  const rows = Array.isArray(candidate?.rows)
    ? candidate.rows.map(record)
    : null;
  if (
    !candidate ||
    !exactKeys(candidate, ["next", "rows", "schemaVersion", "source"]) ||
    source === null ||
    (candidate.next !== null && next === null) ||
    rows === null ||
    rows.length > 128 ||
    candidate.schemaVersion !== 1 ||
    rows.some(
      (row) =>
        !row ||
        !exactKeys(row, [
          "byteLength",
          "byteOffset",
          "cloudAvailabilityCommitment",
          "contentDigest",
          "mediaType",
          "policy",
          "policyPriority",
          "policyUpdatedAt",
          "rangeContentDigest",
          "rangeIndex",
        ]) ||
        !isLibraryCoreNonnegativeSafeInteger(row.byteLength) ||
        row.byteLength < 1 ||
        !isLibraryCoreNonnegativeSafeInteger(row.byteOffset) ||
        row.byteOffset + row.byteLength > Number.MAX_SAFE_INTEGER ||
        !isLibraryCoreLowercaseHex64(row.cloudAvailabilityCommitment) ||
        !isLibraryCoreLowercaseHex64(row.contentDigest) ||
        typeof row.mediaType !== "string" ||
        row.mediaType.length === 0 ||
        new TextEncoder().encode(row.mediaType).length > 255 ||
        !["complete_cache", "pinned_offline"].includes(String(row.policy)) ||
        ![0, 1].includes(Number(row.policyPriority)) ||
        (row.policy === "pinned_offline" ? 0 : 1) !== row.policyPriority ||
        !isLibraryCoreNonnegativeSafeInteger(row.policyUpdatedAt) ||
        !isLibraryCoreLowercaseHex64(row.rangeContentDigest) ||
        !isLibraryCoreNonnegativeSafeInteger(row.rangeIndex),
    ) ||
    (next !== null &&
      (rows.length === 0 ||
        !sameHydrationCursor(
          next,
          rows.at(-1)! as unknown as LibraryCoreHydrationCandidateV1,
        )))
  ) {
    return Object.freeze({
      error: "hydration candidate page is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      next,
      rows: Object.freeze(
        rows.map((row) => Object.freeze(row!)),
      ) as unknown as readonly LibraryCoreHydrationCandidateV1[],
      schemaVersion: 1,
      source,
    }),
  }) as ParseResult<LibraryCoreHydrationCandidatePageV1>;
}

export function parseLibraryCoreEvictionCandidatePageV1(
  value: unknown,
): ParseResult<LibraryCoreEvictionCandidatePageV1> {
  const candidate = record(value);
  const source = parseContentWorkSource(candidate?.source);
  const next =
    candidate?.next === null ? null : parseEvictionCursor(candidate?.next);
  const rows = Array.isArray(candidate?.rows)
    ? candidate.rows.map(record)
    : null;
  const policies = [
    "metadata_only",
    "stream_on_demand",
    "partial_cache",
    "complete_cache",
  ];
  if (
    !candidate ||
    !exactKeys(candidate, ["next", "rows", "schemaVersion", "source"]) ||
    source === null ||
    (candidate.next !== null && next === null) ||
    rows === null ||
    rows.length > 128 ||
    candidate.schemaVersion !== 1 ||
    rows.some(
      (row) =>
        !row ||
        !exactKeys(row, [
          "contentDigest",
          "hydrationState",
          "lastAccessedAt",
          "policy",
          "policyPriority",
          "verifiedBytes",
        ]) ||
        !isLibraryCoreLowercaseHex64(row.contentDigest) ||
        !validState(row.hydrationState) ||
        !isLibraryCoreNonnegativeSafeInteger(row.lastAccessedAt) ||
        !policies.includes(String(row.policy)) ||
        policies.indexOf(String(row.policy)) !== row.policyPriority ||
        !isLibraryCoreNonnegativeSafeInteger(row.verifiedBytes) ||
        row.verifiedBytes < 1,
    ) ||
    (next !== null &&
      (rows.length === 0 ||
        !sameEvictionCursor(
          next,
          rows.at(-1)! as unknown as LibraryCoreEvictionCandidateV1,
        )))
  ) {
    return Object.freeze({
      error: "eviction candidate page is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      next,
      rows: Object.freeze(
        rows.map((row) => Object.freeze(row!)),
      ) as unknown as readonly LibraryCoreEvictionCandidateV1[],
      schemaVersion: 1,
      source,
    }),
  }) as ParseResult<LibraryCoreEvictionCandidatePageV1>;
}

export function parseLibraryCoreContentRangePublicationAppendV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangePublicationAppendV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "bytes",
      "expectedOffset",
      "publicationId",
      "schemaVersion",
    ]) ||
    !(candidate.bytes instanceof Uint8Array) ||
    candidate.bytes.byteLength < 1 ||
    candidate.bytes.byteLength >
      LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.expectedOffset) ||
    !isLibraryCoreLowercaseHex64(candidate.publicationId) ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "content range publication append request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...candidate,
      bytes: candidate.bytes.slice(),
    }) as unknown as LibraryCoreContentRangePublicationAppendV1,
  });
}

export function parseLibraryCoreContentRangePublicationFinalizeV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangePublicationFinalizeV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["publicationId", "schemaVersion", "verifiedAt"]) ||
    !isLibraryCoreLowercaseHex64(candidate.publicationId) ||
    candidate.schemaVersion !== 1 ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.verifiedAt)
  ) {
    return Object.freeze({
      error: "content range publication finalize request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentRangePublicationFinalizeV1,
  });
}

export function parseLibraryCoreContentRangePublicationAbortV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangePublicationAbortV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["publicationId", "schemaVersion"]) ||
    !isLibraryCoreLowercaseHex64(candidate.publicationId) ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "content range publication abort request is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentRangePublicationAbortV1,
  });
}

export function parseLibraryCoreContentRangePublicationStatusV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangePublicationStatusV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "contentDigest",
      "expectedByteLength",
      "expectedRangeContentDigest",
      "maximumAppendBytes",
      "nextOffset",
      "publicationId",
      "rangeIndex",
      "schemaVersion",
      "state",
    ]) ||
    !isLibraryCoreLowercaseHex64(candidate.contentDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.expectedByteLength) ||
    candidate.expectedByteLength < 1 ||
    !isLibraryCoreLowercaseHex64(candidate.expectedRangeContentDigest) ||
    candidate.maximumAppendBytes !==
      LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.nextOffset) ||
    candidate.nextOffset > candidate.expectedByteLength ||
    !isLibraryCoreLowercaseHex64(candidate.publicationId) ||
    !isLibraryCoreNonnegativeSafeInteger(candidate.rangeIndex) ||
    candidate.schemaVersion !== 1 ||
    candidate.state !== "staging"
  ) {
    return Object.freeze({
      error: "content range publication status is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentRangePublicationStatusV1,
  });
}

export function parseLibraryCoreContentRangePublicationAbortReceiptV1(
  value: unknown,
): ParseResult<LibraryCoreContentRangePublicationAbortReceiptV1> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["publicationId", "removed", "schemaVersion"]) ||
    !isLibraryCoreLowercaseHex64(candidate.publicationId) ||
    typeof candidate.removed !== "boolean" ||
    candidate.schemaVersion !== 1
  ) {
    return Object.freeze({
      error: "content range publication abort receipt is invalid",
      ok: false,
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(
      candidate,
    ) as unknown as LibraryCoreContentRangePublicationAbortReceiptV1,
  });
}
