import type { LibraryCoreActorCapabilityAuthorityStateV2 } from "./actor-capability-certificate-v2.js";
import { snapshotLibraryCoreCausalFrontier } from "./operation-envelope-contracts.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

const MAXIMUM_ENROLLMENT_BYTES = 65_536;

export interface LibraryCoreFollowerActorRequestReceiptV2 {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorPublicKey: LibraryCoreEd25519PublicKeyHex;
  readonly canonicalRequestBytes: Uint8Array;
  readonly createdAt: number;
  readonly enrollmentRequestDigest: LibraryCoreLowercaseHex64;
  readonly state: "pending" | "enrolled";
}

export interface LibraryCoreFollowerActorEnrollmentContextV2 {
  readonly authority: LibraryCoreActorCapabilityAuthorityStateV2;
  readonly request: LibraryCoreFollowerActorRequestReceiptV2 | null;
  readonly schemaVersion: 2;
}

export interface LibraryCoreStoreFollowerActorRequestV2 {
  readonly canonicalRequestBytes: Uint8Array;
  readonly createdAt: number;
}

export interface LibraryCoreInstallFollowerActorEnrollmentV2 {
  readonly canonicalCertificateBytes: Uint8Array;
  readonly enrolledAt: number;
}

export interface LibraryCoreFollowerActorEnrollmentReceiptV2 {
  readonly actorChainGenesis: LibraryCoreLowercaseHex64;
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorPublicKey: LibraryCoreEd25519PublicKeyHex;
  readonly enrolledAt: number;
  readonly enrollmentCertificateDigest: LibraryCoreLowercaseHex64;
}

function closedRecord(
  value: unknown,
  expected: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedBytes(value: unknown, label: string): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 1 ||
    value.byteLength > MAXIMUM_ENROLLMENT_BYTES
  ) {
    throw new TypeError(`${label} bytes are invalid`);
  }
  return new Uint8Array(value);
}

function timestamp(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) {
    throw new TypeError(`${label} time is invalid`);
  }
  return value;
}

export function parseLibraryCoreStoreFollowerActorRequestV2(
  value: unknown,
): LibraryCoreStoreFollowerActorRequestV2 {
  const input = closedRecord(
    value,
    ["canonicalRequestBytes", "createdAt"],
    "follower actor request",
  );
  return Object.freeze({
    canonicalRequestBytes: boundedBytes(
      input.canonicalRequestBytes,
      "follower actor request",
    ),
    createdAt: timestamp(input.createdAt, "follower actor request"),
  });
}

export function parseLibraryCoreInstallFollowerActorEnrollmentV2(
  value: unknown,
): LibraryCoreInstallFollowerActorEnrollmentV2 {
  const input = closedRecord(
    value,
    ["canonicalCertificateBytes", "enrolledAt"],
    "follower actor enrollment",
  );
  return Object.freeze({
    canonicalCertificateBytes: boundedBytes(
      input.canonicalCertificateBytes,
      "follower actor enrollment",
    ),
    enrolledAt: timestamp(input.enrolledAt, "follower actor enrollment"),
  });
}

export function parseLibraryCoreFollowerActorRequestReceiptV2(
  value: unknown,
): LibraryCoreFollowerActorRequestReceiptV2 {
  const input = closedRecord(
    value,
    [
      "actorId",
      "actorPublicKey",
      "canonicalRequestBytes",
      "createdAt",
      "enrollmentRequestDigest",
      "state",
    ],
    "follower actor request receipt",
  );
  if (
    !isLibraryCoreLowercaseHex64(input.actorId) ||
    !isLibraryCoreEd25519PublicKeyHex(input.actorPublicKey) ||
    !isLibraryCoreLowercaseHex64(input.enrollmentRequestDigest) ||
    (input.state !== "pending" && input.state !== "enrolled")
  ) {
    throw new TypeError("follower actor request receipt identity is invalid");
  }
  return Object.freeze({
    actorId: input.actorId,
    actorPublicKey: input.actorPublicKey,
    canonicalRequestBytes: boundedBytes(
      input.canonicalRequestBytes,
      "follower actor request receipt",
    ),
    createdAt: timestamp(input.createdAt, "follower actor request receipt"),
    enrollmentRequestDigest: input.enrollmentRequestDigest,
    state: input.state,
  });
}

export function parseLibraryCoreFollowerActorEnrollmentContextV2(
  value: unknown,
): LibraryCoreFollowerActorEnrollmentContextV2 {
  const input = closedRecord(
    value,
    ["authority", "request", "schemaVersion"],
    "follower actor enrollment context",
  );
  const authority = closedRecord(
    input.authority,
    [
      "authority_key_id",
      "authority_public_key",
      "epoch",
      "epoch_id",
      "library_id",
      "observed_frontier",
    ],
    "follower actor enrollment authority",
  );
  if (
    input.schemaVersion !== 2 ||
    !isLibraryCoreLowercaseHex64(authority.authority_key_id) ||
    !isLibraryCoreEd25519PublicKeyHex(authority.authority_public_key) ||
    !isLibraryCoreNonnegativeSafeInteger(authority.epoch) ||
    authority.epoch < 1 ||
    !isLibraryCoreLowercaseHex64(authority.epoch_id) ||
    !isLibraryCoreLowercaseHex64(authority.library_id)
  ) {
    throw new TypeError("follower actor enrollment context is invalid");
  }
  const request =
    input.request === null
      ? null
      : parseLibraryCoreFollowerActorRequestReceiptV2(input.request);
  return Object.freeze({
    authority: Object.freeze({
      authority_key_id: authority.authority_key_id,
      authority_public_key: authority.authority_public_key,
      epoch: authority.epoch,
      epoch_id: authority.epoch_id,
      library_id: authority.library_id,
      observed_frontier: snapshotLibraryCoreCausalFrontier(
        authority.observed_frontier,
        "follower actor enrollment authority frontier",
      ),
    }),
    request,
    schemaVersion: 2,
  });
}

export function parseLibraryCoreFollowerActorEnrollmentReceiptV2(
  value: unknown,
): LibraryCoreFollowerActorEnrollmentReceiptV2 {
  const input = closedRecord(
    value,
    [
      "actorChainGenesis",
      "actorId",
      "actorPublicKey",
      "enrolledAt",
      "enrollmentCertificateDigest",
    ],
    "follower actor enrollment receipt",
  );
  if (
    !isLibraryCoreLowercaseHex64(input.actorChainGenesis) ||
    !isLibraryCoreLowercaseHex64(input.actorId) ||
    !isLibraryCoreEd25519PublicKeyHex(input.actorPublicKey) ||
    !isLibraryCoreLowercaseHex64(input.enrollmentCertificateDigest)
  ) {
    throw new TypeError("follower actor enrollment receipt is invalid");
  }
  return Object.freeze({
    actorChainGenesis: input.actorChainGenesis,
    actorId: input.actorId,
    actorPublicKey: input.actorPublicKey,
    enrolledAt: timestamp(input.enrolledAt, "follower actor enrollment"),
    enrollmentCertificateDigest: input.enrollmentCertificateDigest,
  });
}
