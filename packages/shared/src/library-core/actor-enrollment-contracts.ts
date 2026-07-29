import {
  snapshotLibraryCoreCausalFrontier,
  type LibraryCoreCausalTipV1,
  type LibraryCoreOperationDigestDependencies,
} from "./operation-envelope-contracts.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

const CLOSED_ACTOR_ENROLLMENT_BODIES = new WeakSet<object>();

const INPUT_KEYS = [
  "operation_id",
  "library_id",
  "epoch",
  "epoch_id",
  "authority_key_id",
  "installation_incarnation",
  "actor_incarnation_nonce",
  "actor_public_key",
  "observed_frontier",
  "created_at_ms",
] as const;

export interface LibraryCoreActorEnrollmentBodyInputV1 {
  readonly operation_id: unknown;
  readonly library_id: unknown;
  readonly epoch: unknown;
  readonly epoch_id: unknown;
  readonly authority_key_id: unknown;
  readonly installation_incarnation: unknown;
  readonly actor_incarnation_nonce: unknown;
  readonly actor_public_key: unknown;
  readonly observed_frontier: unknown;
  readonly created_at_ms: unknown;
}

export interface LibraryCoreActorEnrollmentBodyV1 {
  readonly operation_id: LibraryCoreOperationInstanceId;
  readonly operation_type: "actor_enrolled";
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly schema_version: 1;
  readonly authority_key_id: LibraryCoreLowercaseHex64;
  readonly installation_incarnation: LibraryCoreLowercaseHex64;
  readonly actor_incarnation_nonce: LibraryCoreLowercaseHex64;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly actor_public_key: LibraryCoreEd25519PublicKeyHex;
  readonly actor_public_key_fingerprint: LibraryCoreLowercaseHex64;
  readonly observed_frontier: readonly LibraryCoreCausalTipV1[];
  readonly created_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface LibraryCoreActorEnrollmentBodyConstructionV1 {
  readonly body: LibraryCoreActorEnrollmentBodyV1;
  readonly enrollment_body_digest: LibraryCoreLowercaseHex64;
}

function requireClosedInput(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("actor enrollment input must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("actor enrollment input must be a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("actor enrollment input may not contain symbol keys");
  }
  const keys = Object.getOwnPropertyNames(value);
  if (
    keys.length !== INPUT_KEYS.length ||
    INPUT_KEYS.some((key) => !keys.includes(key))
  ) {
    throw new TypeError("actor enrollment input has an invalid field set");
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        `actor enrollment input.${key} must be an enumerable data property`,
      );
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
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

function digest(
  digestValue: LibraryCoreOperationDigestDependencies["digest"],
  domain: "actor-public-key" | "actor-id" | "actor-enrollment-body",
  value: unknown,
): LibraryCoreLowercaseHex64 {
  const result = digestValue(domain, value);
  if (!isLibraryCoreLowercaseHex64(result)) {
    throw new TypeError(
      `${domain} digest dependency returned an invalid digest`,
    );
  }
  return result;
}

export function isLibraryCoreActorEnrollmentBodyConstructionV1(
  value: unknown,
): value is LibraryCoreActorEnrollmentBodyConstructionV1 {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  const candidate =
    value as Partial<LibraryCoreActorEnrollmentBodyConstructionV1>;
  return (
    CLOSED_ACTOR_ENROLLMENT_BODIES.has(value) &&
    typeof candidate.body === "object" &&
    candidate.body !== null &&
    Object.isFrozen(candidate.body) &&
    isLibraryCoreLowercaseHex64(candidate.enrollment_body_digest)
  );
}

/**
 * Construct the self-reference-free actor enrollment body and digest.
 *
 * This does not prove key possession, sign an enrollment certificate, enroll
 * an actor, mutate authority state, or grant operation-writing authority.
 */
export function constructLibraryCoreActorEnrollmentBodyV1(
  input: LibraryCoreActorEnrollmentBodyInputV1,
  dependencies: LibraryCoreOperationDigestDependencies,
): LibraryCoreActorEnrollmentBodyConstructionV1 {
  const record = requireClosedInput(input);
  const digestValue = dependencies.digest;
  if (typeof digestValue !== "function") {
    throw new TypeError("actor enrollment digest dependency must be callable");
  }
  const actorPublicKeyCandidate = record.actor_public_key;
  if (!isLibraryCoreEd25519PublicKeyHex(actorPublicKeyCandidate)) {
    throw new TypeError(
      "actor_public_key must be 64 lowercase hexadecimal characters",
    );
  }
  const libraryId = requireHex64(record.library_id, "library_id");
  const installationIncarnation = requireHex64(
    record.installation_incarnation,
    "installation_incarnation",
  );
  const actorIncarnationNonce = requireHex64(
    record.actor_incarnation_nonce,
    "actor_incarnation_nonce",
  );
  const epochCandidate = record.epoch;
  if (
    !isLibraryCoreNonnegativeSafeInteger(epochCandidate) ||
    epochCandidate === 0
  ) {
    throw new TypeError("epoch must be a positive safe integer");
  }
  const createdAtCandidate = record.created_at_ms;
  if (!isLibraryCoreNonnegativeSafeInteger(createdAtCandidate)) {
    throw new TypeError("created_at_ms must be a nonnegative safe integer");
  }
  const operationIdCandidate = record.operation_id;
  if (!isLibraryCoreOperationInstanceId(operationIdCandidate)) {
    throw new TypeError("operation_id must use the bounded operation-ID codec");
  }

  const actorPublicKeyFingerprint = digest(digestValue, "actor-public-key", {
    signature_algorithm: "ed25519",
    actor_public_key: actorPublicKeyCandidate,
  });
  const actorId = digest(digestValue, "actor-id", {
    library_id: libraryId,
    installation_incarnation: installationIncarnation,
    signature_algorithm: "ed25519",
    actor_public_key: actorPublicKeyCandidate,
    actor_incarnation_nonce: actorIncarnationNonce,
  });
  const body = Object.freeze({
    operation_id: operationIdCandidate,
    operation_type: "actor_enrolled",
    library_id: libraryId,
    epoch: epochCandidate,
    epoch_id: requireHex64(record.epoch_id, "epoch_id"),
    schema_version: 1,
    authority_key_id: requireHex64(record.authority_key_id, "authority_key_id"),
    installation_incarnation: installationIncarnation,
    actor_incarnation_nonce: actorIncarnationNonce,
    actor_id: actorId,
    actor_public_key: actorPublicKeyCandidate,
    actor_public_key_fingerprint: actorPublicKeyFingerprint,
    observed_frontier: snapshotLibraryCoreCausalFrontier(
      record.observed_frontier,
      "observed_frontier",
    ),
    created_at_ms: createdAtCandidate,
    signature_algorithm: "ed25519",
  }) satisfies LibraryCoreActorEnrollmentBodyV1;
  const enrollmentBodyDigest = digest(
    digestValue,
    "actor-enrollment-body",
    body,
  );

  const construction = Object.freeze({
    body,
    enrollment_body_digest: enrollmentBodyDigest,
  });
  CLOSED_ACTOR_ENROLLMENT_BODIES.add(construction);
  return construction;
}
