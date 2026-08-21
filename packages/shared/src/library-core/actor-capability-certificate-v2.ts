// Closed actor capability certificate construction and verification contract.
// Construction remains dormant in production. The PWA consumes verification
// only, so importing this module does not grant issuance or writer authority.
import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  constructLibraryCoreActorEnrollmentBodyV1,
  isLibraryCoreActorEnrollmentBodyConstructionV1,
  type LibraryCoreActorEnrollmentBodyConstructionV1,
  type LibraryCoreActorEnrollmentBodyV1,
} from "./actor-enrollment-contracts.js";
import {
  snapshotLibraryCoreCausalFrontier,
  type LibraryCoreCausalTipV1,
} from "./operation-envelope-contracts.js";
import {
  LIBRARY_CORE_CAPABILITY_OPERATION_IDS,
  LIBRARY_CORE_LEGACY_EDITOR_OPERATION_IDS,
  LIBRARY_CORE_PRIMARY_WRITER_OPERATION_IDS,
  LIBRARY_CORE_SCRAPER_OPERATION_IDS,
  type LibraryCoreCapabilityOperationId,
} from "./sqlite-contract.generated.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_ACTOR_CAPABILITY_FORMAT_V2 =
  "freed_library_core_actor_capability_v2" as const;

export const LIBRARY_CORE_ACTOR_CAPABILITY_OPERATION_TYPES_V2 =
  LIBRARY_CORE_CAPABILITY_OPERATION_IDS;

export type LibraryCoreActorCapabilityOperationTypeV2 =
  LibraryCoreCapabilityOperationId;

export const LIBRARY_CORE_LEGACY_EDITOR_OPERATION_TYPES_V1: readonly LibraryCoreActorCapabilityOperationTypeV2[] =
  LIBRARY_CORE_LEGACY_EDITOR_OPERATION_IDS;

export const LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2: readonly LibraryCoreActorCapabilityOperationTypeV2[] =
  LIBRARY_CORE_PRIMARY_WRITER_OPERATION_IDS;

export const LIBRARY_CORE_SCRAPER_OPERATION_TYPES_V2: readonly LibraryCoreActorCapabilityOperationTypeV2[] =
  LIBRARY_CORE_SCRAPER_OPERATION_IDS;

export type LibraryCoreActorClassV2 = "editor" | "scraper" | "agent";

export type LibraryCoreActorScopeV2 =
  | Readonly<{ readonly mode: "library_wide" }>
  | Readonly<{
      readonly mode: "bounded";
      readonly scope_kind: "provider" | "source";
      readonly scope_id: string;
    }>;

export interface LibraryCoreActorCapabilityBodyV2 {
  readonly format: typeof LIBRARY_CORE_ACTOR_CAPABILITY_FORMAT_V2;
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly authority_key_id: LibraryCoreLowercaseHex64;
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly actor_public_key: LibraryCoreEd25519PublicKeyHex;
  readonly actor_class: LibraryCoreActorClassV2;
  readonly allowed_operation_types: readonly LibraryCoreActorCapabilityOperationTypeV2[];
  readonly scope: LibraryCoreActorScopeV2;
  readonly issuance_identity: LibraryCoreLowercaseHex64;
  readonly retirement_identity: LibraryCoreLowercaseHex64;
  readonly issued_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface LibraryCoreActorCapabilityCertificateBodyV2 {
  readonly actor_enrollment_body: LibraryCoreActorEnrollmentBodyV1;
  readonly enrollment_body_digest: LibraryCoreLowercaseHex64;
  readonly actor_proof: LibraryCoreEd25519SignatureHex;
  readonly actor_capability_body: LibraryCoreActorCapabilityBodyV2;
  readonly actor_capability_body_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreActorCapabilityCertificateV2 {
  readonly certificate_body: LibraryCoreActorCapabilityCertificateBodyV2;
  readonly certificate_digest: LibraryCoreLowercaseHex64;
  readonly authority_signature: LibraryCoreEd25519SignatureHex;
}

export interface LibraryCoreActorCapabilityCertificateConstructionV2 {
  readonly certificate: LibraryCoreActorCapabilityCertificateV2;
  readonly actor_chain_genesis: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreActorCapabilityCertificateInputV2 {
  readonly actor_class: LibraryCoreActorClassV2;
  readonly allowed_operation_types: readonly LibraryCoreActorCapabilityOperationTypeV2[];
  readonly scope: LibraryCoreActorScopeV2;
}

export interface LibraryCoreActorCapabilityCertificateDependenciesV2 {
  readonly signActorProof: (input: Uint8Array) => Promise<unknown>;
  readonly signAuthorityCertificate: (input: Uint8Array) => Promise<unknown>;
  readonly digest: (domain: LibraryCoreDigestDomain, value: unknown) => unknown;
}

export interface LibraryCoreActorCapabilityVerificationDependenciesV2 {
  readonly digest: (domain: LibraryCoreDigestDomain, value: unknown) => unknown;
  readonly verifySignature: (input: {
    readonly publicKeyHex: LibraryCoreEd25519PublicKeyHex;
    readonly signatureHex: LibraryCoreEd25519SignatureHex;
    readonly message: Uint8Array;
  }) => Promise<boolean>;
}

export interface LibraryCoreActorCapabilityAuthorityStateV2 {
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly authority_key_id: LibraryCoreLowercaseHex64;
  readonly authority_public_key: LibraryCoreEd25519PublicKeyHex;
  readonly observed_frontier: readonly LibraryCoreCausalTipV1[];
}

const CLOSED_CONSTRUCTIONS = new WeakSet<object>();
const CLOSED_VERIFICATIONS = new WeakSet<object>();
const textEncoder = new TextEncoder();

function digest(
  dependency: LibraryCoreActorCapabilityCertificateDependenciesV2["digest"],
  domain: LibraryCoreDigestDomain,
  value: unknown,
): LibraryCoreLowercaseHex64 {
  const result = dependency(domain, value);
  if (!isLibraryCoreLowercaseHex64(result)) {
    throw new TypeError(
      `${domain} digest dependency returned an invalid digest`,
    );
  }
  return result;
}

function signature(
  value: unknown,
  label: string,
): LibraryCoreEd25519SignatureHex {
  if (!isLibraryCoreEd25519SignatureHex(value)) {
    throw new TypeError(
      `${label} must be 128 lowercase hexadecimal characters`,
    );
  }
  return value;
}

function snapshotAllowedOperations(
  value: unknown,
  actorClass: LibraryCoreActorClassV2,
): readonly LibraryCoreActorCapabilityOperationTypeV2[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("allowed operation types must be a nonempty array");
  }
  const known = new Set<string>(
    LIBRARY_CORE_ACTOR_CAPABILITY_OPERATION_TYPES_V2,
  );
  const scraper = new Set<string>(LIBRARY_CORE_SCRAPER_OPERATION_TYPES_V2);
  const result: LibraryCoreActorCapabilityOperationTypeV2[] = [];
  let previous: string | undefined;
  for (const operation of value) {
    if (
      typeof operation !== "string" ||
      !known.has(operation) ||
      (previous !== undefined && previous >= operation)
    ) {
      throw new TypeError(
        "allowed operation types must be known, unique, and sorted",
      );
    }
    if (actorClass === "scraper" && !scraper.has(operation)) {
      throw new TypeError(
        "scraper capability includes a non-capture operation",
      );
    }
    result.push(operation as LibraryCoreActorCapabilityOperationTypeV2);
    previous = operation;
  }
  return Object.freeze(result);
}

function snapshotScope(value: unknown): LibraryCoreActorScopeV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("actor capability scope must be an explicit object");
  }
  const names = Object.getOwnPropertyNames(value);
  const record = value as Record<string, unknown>;
  if (
    names.length === 1 &&
    names[0] === "mode" &&
    record.mode === "library_wide"
  ) {
    return Object.freeze({ mode: "library_wide" });
  }
  if (
    names.length !== 3 ||
    !names.includes("mode") ||
    !names.includes("scope_kind") ||
    !names.includes("scope_id") ||
    record.mode !== "bounded" ||
    (record.scope_kind !== "provider" && record.scope_kind !== "source") ||
    typeof record.scope_id !== "string" ||
    textEncoder.encode(record.scope_id).byteLength === 0 ||
    textEncoder.encode(record.scope_id).byteLength > 4_096
  ) {
    throw new TypeError("actor capability scope is invalid");
  }
  return Object.freeze({
    mode: "bounded",
    scope_kind: record.scope_kind,
    scope_id: record.scope_id,
  });
}

function actorClass(value: unknown): LibraryCoreActorClassV2 {
  if (value !== "editor" && value !== "scraper" && value !== "agent") {
    throw new TypeError("actor class is invalid");
  }
  return value;
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== keys.length ||
    keys.some((key) => !names.includes(key)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} has an invalid field set`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys)
    snapshot[key] = (value as Record<string, unknown>)[key];
  return Object.freeze(snapshot);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = encodeLibraryCoreCanonicalValue(
    left as LibraryCoreCanonicalValue,
  );
  const rightBytes = encodeLibraryCoreCanonicalValue(
    right as LibraryCoreCanonicalValue,
  );
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((byte, index) => byte === rightBytes[index])
  );
}

function snapshotAuthorityState(
  value: unknown,
  digestDependency: LibraryCoreActorCapabilityVerificationDependenciesV2["digest"],
): LibraryCoreActorCapabilityAuthorityStateV2 {
  const record = closedRecord(
    value,
    [
      "library_id",
      "epoch",
      "epoch_id",
      "authority_key_id",
      "authority_public_key",
      "observed_frontier",
    ],
    "accepted authority state",
  );
  if (
    !isLibraryCoreLowercaseHex64(record.library_id) ||
    !isLibraryCoreNonnegativeSafeInteger(record.epoch) ||
    record.epoch === 0 ||
    !isLibraryCoreLowercaseHex64(record.epoch_id) ||
    !isLibraryCoreLowercaseHex64(record.authority_key_id) ||
    !isLibraryCoreEd25519PublicKeyHex(record.authority_public_key)
  ) {
    throw new TypeError("accepted authority state is invalid");
  }
  const expectedAuthorityKeyId = digest(digestDependency, "authority-key", {
    signature_algorithm: "ed25519",
    authority_public_key: record.authority_public_key,
  });
  if (record.authority_key_id !== expectedAuthorityKeyId) {
    throw new TypeError(
      "accepted authority state key ID does not match its public key",
    );
  }
  return Object.freeze({
    library_id: record.library_id,
    epoch: record.epoch,
    epoch_id: record.epoch_id,
    authority_key_id: record.authority_key_id,
    authority_public_key: record.authority_public_key,
    observed_frontier: snapshotLibraryCoreCausalFrontier(
      record.observed_frontier,
      "accepted authority state.observed_frontier",
    ),
  });
}

function constructCapabilityBody(
  enrollment: LibraryCoreActorEnrollmentBodyConstructionV1,
  input: LibraryCoreActorCapabilityCertificateInputV2,
  digestDependency: LibraryCoreActorCapabilityCertificateDependenciesV2["digest"],
): LibraryCoreActorCapabilityBodyV2 {
  const selectedClass = actorClass(input.actor_class);
  const operations = snapshotAllowedOperations(
    input.allowed_operation_types,
    selectedClass,
  );
  const scope = snapshotScope(input.scope);
  const body = enrollment.body;
  const issuanceIdentity = digest(
    digestDependency,
    "actor-capability-issuance",
    {
      library_id: body.library_id,
      epoch_id: body.epoch_id,
      authority_key_id: body.authority_key_id,
      actor_id: body.actor_id,
      enrollment_body_digest: enrollment.enrollment_body_digest,
    },
  );
  const retirementIdentity = digest(
    digestDependency,
    "actor-capability-retirement",
    {
      library_id: body.library_id,
      epoch_id: body.epoch_id,
      actor_id: body.actor_id,
      issuance_identity: issuanceIdentity,
    },
  );
  return Object.freeze({
    format: LIBRARY_CORE_ACTOR_CAPABILITY_FORMAT_V2,
    library_id: body.library_id,
    epoch: body.epoch,
    epoch_id: body.epoch_id,
    authority_key_id: body.authority_key_id,
    actor_id: body.actor_id,
    actor_public_key: body.actor_public_key,
    actor_class: selectedClass,
    allowed_operation_types: operations,
    scope,
    issuance_identity: issuanceIdentity,
    retirement_identity: retirementIdentity,
    issued_at_ms: body.created_at_ms,
    signature_algorithm: "ed25519",
  });
}

export function isLibraryCoreActorCapabilityCertificateConstructionV2(
  value: unknown,
): value is LibraryCoreActorCapabilityCertificateConstructionV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.isFrozen(value) &&
    CLOSED_CONSTRUCTIONS.has(value)
  );
}

export async function constructLibraryCoreActorCapabilityCertificateV2(
  enrollment: LibraryCoreActorEnrollmentBodyConstructionV1,
  input: LibraryCoreActorCapabilityCertificateInputV2,
  dependencies: LibraryCoreActorCapabilityCertificateDependenciesV2,
): Promise<LibraryCoreActorCapabilityCertificateConstructionV2> {
  if (!isLibraryCoreActorEnrollmentBodyConstructionV1(enrollment)) {
    throw new TypeError(
      "actor enrollment body must use the closed v1 contract",
    );
  }
  const signActorProof = dependencies.signActorProof;
  const signAuthorityCertificate = dependencies.signAuthorityCertificate;
  const digestDependency = dependencies.digest;
  if (
    typeof signActorProof !== "function" ||
    typeof signAuthorityCertificate !== "function" ||
    typeof digestDependency !== "function"
  ) {
    throw new TypeError("actor capability dependencies must be callable");
  }
  const capabilityBody = constructCapabilityBody(
    enrollment,
    input,
    digestDependency,
  );
  const actorProof = signature(
    await signActorProof(
      encodeLibraryCoreSignatureInput("actor-enrollment-proof", {
        enrollment_body_digest: enrollment.enrollment_body_digest,
      }),
    ),
    "actor proof",
  );
  const capabilityBodyDigest = digest(
    digestDependency,
    "actor-capability-body",
    capabilityBody,
  );
  const certificateBody = Object.freeze({
    actor_enrollment_body: enrollment.body,
    enrollment_body_digest: enrollment.enrollment_body_digest,
    actor_proof: actorProof,
    actor_capability_body: capabilityBody,
    actor_capability_body_digest: capabilityBodyDigest,
  }) satisfies LibraryCoreActorCapabilityCertificateBodyV2;
  const certificateDigest = digest(
    digestDependency,
    "actor-capability-certificate",
    certificateBody,
  );
  const authoritySignature = signature(
    await signAuthorityCertificate(
      encodeLibraryCoreSignatureInput("actor-capability-authority", {
        certificate_digest: certificateDigest,
      }),
    ),
    "authority signature",
  );
  const certificate = Object.freeze({
    certificate_body: certificateBody,
    certificate_digest: certificateDigest,
    authority_signature: authoritySignature,
  }) satisfies LibraryCoreActorCapabilityCertificateV2;
  const actorChainGenesis = digest(digestDependency, "actor-chain-genesis", {
    enrollment_certificate_digest: certificateDigest,
    actor_id: enrollment.body.actor_id,
    epoch_id: enrollment.body.epoch_id,
  });
  const result = Object.freeze({
    certificate,
    actor_chain_genesis: actorChainGenesis,
  });
  CLOSED_CONSTRUCTIONS.add(result);
  return result;
}

export interface LibraryCoreVerifiedActorCapabilityCertificateV2 {
  readonly certificate: LibraryCoreActorCapabilityCertificateV2;
  readonly authority_state: LibraryCoreActorCapabilityAuthorityStateV2;
  readonly actor_chain_genesis: LibraryCoreLowercaseHex64;
}

export function isLibraryCoreVerifiedActorCapabilityCertificateV2(
  value: unknown,
): value is LibraryCoreVerifiedActorCapabilityCertificateV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.isFrozen(value) &&
    CLOSED_VERIFICATIONS.has(value)
  );
}

export async function verifyLibraryCoreActorCapabilityCertificateV2(
  canonicalCertificate: Uint8Array,
  acceptedAuthority: LibraryCoreActorCapabilityAuthorityStateV2,
  dependencies: LibraryCoreActorCapabilityVerificationDependenciesV2,
): Promise<LibraryCoreVerifiedActorCapabilityCertificateV2> {
  const digestDependency = dependencies.digest;
  const verifySignature = dependencies.verifySignature;
  if (
    typeof digestDependency !== "function" ||
    typeof verifySignature !== "function"
  ) {
    throw new TypeError(
      "actor capability verification dependencies must be callable",
    );
  }
  const authorityState = snapshotAuthorityState(
    acceptedAuthority,
    digestDependency,
  );
  const decoded = decodeLibraryCoreCanonicalValue(canonicalCertificate);
  const certificate = closedRecord(
    decoded,
    ["certificate_body", "certificate_digest", "authority_signature"],
    "actor capability certificate",
  );
  const body = closedRecord(
    certificate.certificate_body,
    [
      "actor_enrollment_body",
      "enrollment_body_digest",
      "actor_proof",
      "actor_capability_body",
      "actor_capability_body_digest",
    ],
    "actor capability certificate body",
  );
  const enrollmentBody = closedRecord(
    body.actor_enrollment_body,
    [
      "operation_id",
      "operation_type",
      "library_id",
      "epoch",
      "epoch_id",
      "schema_version",
      "authority_key_id",
      "installation_incarnation",
      "actor_incarnation_nonce",
      "actor_id",
      "actor_public_key",
      "actor_public_key_fingerprint",
      "observed_frontier",
      "created_at_ms",
      "signature_algorithm",
    ],
    "actor enrollment body",
  );
  const derivedEnrollment = constructLibraryCoreActorEnrollmentBodyV1(
    {
      operation_id: enrollmentBody.operation_id,
      library_id: enrollmentBody.library_id,
      epoch: enrollmentBody.epoch,
      epoch_id: enrollmentBody.epoch_id,
      authority_key_id: enrollmentBody.authority_key_id,
      installation_incarnation: enrollmentBody.installation_incarnation,
      actor_incarnation_nonce: enrollmentBody.actor_incarnation_nonce,
      actor_public_key: enrollmentBody.actor_public_key,
      observed_frontier: enrollmentBody.observed_frontier,
      created_at_ms: enrollmentBody.created_at_ms,
    },
    { digest: digestDependency },
  );
  if (!canonicalEqual(enrollmentBody, derivedEnrollment.body)) {
    throw new TypeError("actor capability enrollment body changed");
  }
  const expectedAuthorityKeyId = digest(digestDependency, "authority-key", {
    signature_algorithm: "ed25519",
    authority_public_key: authorityState.authority_public_key,
  });
  if (
    !isLibraryCoreLowercaseHex64(enrollmentBody.library_id) ||
    !isLibraryCoreLowercaseHex64(enrollmentBody.epoch_id) ||
    !isLibraryCoreLowercaseHex64(enrollmentBody.authority_key_id) ||
    !isLibraryCoreLowercaseHex64(enrollmentBody.actor_id) ||
    !isLibraryCoreEd25519PublicKeyHex(enrollmentBody.actor_public_key) ||
    enrollmentBody.operation_type !== "actor_enrolled" ||
    enrollmentBody.signature_algorithm !== "ed25519" ||
    enrollmentBody.epoch !== authorityState.epoch ||
    enrollmentBody.library_id !== authorityState.library_id ||
    enrollmentBody.epoch_id !== authorityState.epoch_id ||
    enrollmentBody.authority_key_id !== authorityState.authority_key_id ||
    authorityState.authority_key_id !== expectedAuthorityKeyId ||
    !canonicalEqual(
      derivedEnrollment.body.observed_frontier,
      authorityState.observed_frontier,
    )
  ) {
    throw new TypeError("actor capability does not match accepted authority");
  }
  const enrollmentBodyDigest = derivedEnrollment.enrollment_body_digest;
  if (body.enrollment_body_digest !== enrollmentBodyDigest) {
    throw new TypeError("actor capability enrollment body digest changed");
  }
  const capabilityInput = closedRecord(
    body.actor_capability_body,
    [
      "format",
      "library_id",
      "epoch",
      "epoch_id",
      "authority_key_id",
      "actor_id",
      "actor_public_key",
      "actor_class",
      "allowed_operation_types",
      "scope",
      "issuance_identity",
      "retirement_identity",
      "issued_at_ms",
      "signature_algorithm",
    ],
    "actor capability body",
  );
  const selectedClass = actorClass(capabilityInput.actor_class);
  const expectedCapability = constructCapabilityBody(
    derivedEnrollment,
    {
      actor_class: selectedClass,
      allowed_operation_types: snapshotAllowedOperations(
        capabilityInput.allowed_operation_types,
        selectedClass,
      ),
      scope: snapshotScope(capabilityInput.scope),
    },
    digestDependency,
  );
  if (!canonicalEqual(capabilityInput, expectedCapability)) {
    throw new TypeError("actor capability body changed");
  }
  const capabilityBodyDigest = digest(
    digestDependency,
    "actor-capability-body",
    expectedCapability,
  );
  if (body.actor_capability_body_digest !== capabilityBodyDigest) {
    throw new TypeError("actor capability body digest changed");
  }
  const actorProof = signature(body.actor_proof, "actor proof");
  if (
    (await verifySignature({
      publicKeyHex: enrollmentBody.actor_public_key,
      signatureHex: actorProof,
      message: encodeLibraryCoreSignatureInput("actor-enrollment-proof", {
        enrollment_body_digest: enrollmentBodyDigest,
      }),
    })) !== true
  ) {
    throw new TypeError("actor capability proof signature is invalid");
  }
  const certificateBody = Object.freeze({
    actor_enrollment_body: derivedEnrollment.body,
    enrollment_body_digest: enrollmentBodyDigest,
    actor_proof: actorProof,
    actor_capability_body: expectedCapability,
    actor_capability_body_digest: capabilityBodyDigest,
  });
  const certificateDigest = digest(
    digestDependency,
    "actor-capability-certificate",
    certificateBody,
  );
  if (certificate.certificate_digest !== certificateDigest) {
    throw new TypeError("actor capability certificate digest changed");
  }
  const authoritySignature = signature(
    certificate.authority_signature,
    "authority signature",
  );
  if (
    (await verifySignature({
      publicKeyHex: authorityState.authority_public_key,
      signatureHex: authoritySignature,
      message: encodeLibraryCoreSignatureInput("actor-capability-authority", {
        certificate_digest: certificateDigest,
      }),
    })) !== true
  ) {
    throw new TypeError("actor capability authority signature is invalid");
  }
  const typedCertificate = Object.freeze({
    certificate_body: certificateBody,
    certificate_digest: certificateDigest,
    authority_signature: authoritySignature,
  }) as unknown as LibraryCoreActorCapabilityCertificateV2;
  const result = Object.freeze({
    certificate: typedCertificate,
    authority_state: authorityState,
    actor_chain_genesis: digest(digestDependency, "actor-chain-genesis", {
      enrollment_certificate_digest: certificateDigest,
      actor_id: enrollmentBody.actor_id,
      epoch_id: enrollmentBody.epoch_id,
    }),
  });
  CLOSED_VERIFICATIONS.add(result);
  return result;
}
