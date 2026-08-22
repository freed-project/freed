import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
} from "./protocol-scalars.js";

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
  readonly storageKey: string | null;
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
        "storageKey",
        "storageKind",
        "updatedAt",
        "verifiedBytes",
      ]) &&
      (availability.completeDigestVerifiedAt === null ||
        isLibraryCoreNonnegativeSafeInteger(
          availability.completeDigestVerifiedAt,
        )) &&
      validState(availability.hydrationState) &&
      (availability.storageKey === null ||
        (typeof availability.storageKey === "string" &&
          new TextEncoder().encode(availability.storageKey).length <= 1_024)) &&
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
