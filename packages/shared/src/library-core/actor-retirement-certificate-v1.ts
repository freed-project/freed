import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_ACTOR_RETIREMENT_FORMAT_V1 =
  "freed_library_core_actor_retirement_v1" as const;

export const LIBRARY_CORE_ACTOR_RETIREMENT_REASONS_V1 = Object.freeze([
  "device_removed",
  "key_compromised",
  "role_reassigned",
  "user_requested",
] as const);

export type LibraryCoreActorRetirementReasonV1 =
  (typeof LIBRARY_CORE_ACTOR_RETIREMENT_REASONS_V1)[number];

export interface LibraryCoreActorRetirementAuthorityV1 {
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly authority_key_id: LibraryCoreLowercaseHex64;
  readonly authority_public_key: LibraryCoreEd25519PublicKeyHex;
}

export interface LibraryCoreActorRetirementTargetV1 {
  readonly actor_id: LibraryCoreLowercaseHex64;
  readonly capability_id: LibraryCoreLowercaseHex64;
  readonly capability_certificate_digest: LibraryCoreLowercaseHex64;
  readonly retirement_identity: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreActorRetirementBodyV1 extends LibraryCoreActorRetirementTargetV1 {
  readonly format: typeof LIBRARY_CORE_ACTOR_RETIREMENT_FORMAT_V1;
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly authority_key_id: LibraryCoreLowercaseHex64;
  readonly reason: LibraryCoreActorRetirementReasonV1;
  readonly retired_at_ms: number;
  readonly signature_algorithm: "ed25519";
}

export interface LibraryCoreActorRetirementCertificateV1 {
  readonly retirement_body: LibraryCoreActorRetirementBodyV1;
  readonly retirement_body_digest: LibraryCoreLowercaseHex64;
  readonly certificate_digest: LibraryCoreLowercaseHex64;
  readonly authority_signature: LibraryCoreEd25519SignatureHex;
}

export interface LibraryCoreActorRetirementDependenciesV1 {
  readonly digest: (domain: LibraryCoreDigestDomain, value: unknown) => unknown;
  readonly signAuthority: (input: Uint8Array) => Promise<unknown>;
}

export interface LibraryCoreActorRetirementVerificationDependenciesV1 {
  readonly digest: (domain: LibraryCoreDigestDomain, value: unknown) => unknown;
  readonly verifySignature: (input: {
    readonly publicKeyHex: LibraryCoreEd25519PublicKeyHex;
    readonly signatureHex: LibraryCoreEd25519SignatureHex;
    readonly message: Uint8Array;
  }) => Promise<boolean>;
}

const CLOSED_VERIFICATIONS = new WeakSet<object>();

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
  return value as Readonly<Record<string, unknown>>;
}

function digest(
  dependency: LibraryCoreActorRetirementDependenciesV1["digest"],
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

function snapshotAuthority(
  value: LibraryCoreActorRetirementAuthorityV1,
  digestDependency: LibraryCoreActorRetirementDependenciesV1["digest"],
): LibraryCoreActorRetirementAuthorityV1 {
  const record = closedRecord(
    value,
    [
      "library_id",
      "epoch",
      "epoch_id",
      "authority_key_id",
      "authority_public_key",
    ],
    "actor retirement authority",
  );
  if (
    !isLibraryCoreLowercaseHex64(record.library_id) ||
    !isLibraryCoreNonnegativeSafeInteger(record.epoch) ||
    record.epoch === 0 ||
    !isLibraryCoreLowercaseHex64(record.epoch_id) ||
    !isLibraryCoreLowercaseHex64(record.authority_key_id) ||
    !isLibraryCoreEd25519PublicKeyHex(record.authority_public_key) ||
    digest(digestDependency, "authority-key", {
      signature_algorithm: "ed25519",
      authority_public_key: record.authority_public_key,
    }) !== record.authority_key_id
  ) {
    throw new TypeError("actor retirement authority is invalid");
  }
  return Object.freeze({
    library_id: record.library_id,
    epoch: record.epoch,
    epoch_id: record.epoch_id,
    authority_key_id: record.authority_key_id,
    authority_public_key: record.authority_public_key,
  });
}

function snapshotTarget(
  value: LibraryCoreActorRetirementTargetV1,
): LibraryCoreActorRetirementTargetV1 {
  const record = closedRecord(
    value,
    [
      "actor_id",
      "capability_id",
      "capability_certificate_digest",
      "retirement_identity",
    ],
    "actor retirement target",
  );
  if (
    !isLibraryCoreLowercaseHex64(record.actor_id) ||
    !isLibraryCoreLowercaseHex64(record.capability_id) ||
    !isLibraryCoreLowercaseHex64(record.capability_certificate_digest) ||
    !isLibraryCoreLowercaseHex64(record.retirement_identity) ||
    record.capability_id !== record.capability_certificate_digest
  ) {
    throw new TypeError("actor retirement target is invalid");
  }
  return Object.freeze({
    actor_id: record.actor_id,
    capability_id: record.capability_id,
    capability_certificate_digest: record.capability_certificate_digest,
    retirement_identity: record.retirement_identity,
  });
}

function reason(value: unknown): LibraryCoreActorRetirementReasonV1 {
  if (
    typeof value !== "string" ||
    !LIBRARY_CORE_ACTOR_RETIREMENT_REASONS_V1.includes(
      value as LibraryCoreActorRetirementReasonV1,
    )
  ) {
    throw new TypeError("actor retirement reason is invalid");
  }
  return value as LibraryCoreActorRetirementReasonV1;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const a = encodeLibraryCoreCanonicalValue(left as LibraryCoreCanonicalValue);
  const b = encodeLibraryCoreCanonicalValue(right as LibraryCoreCanonicalValue);
  return (
    a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index])
  );
}

function constructBody(
  authority: LibraryCoreActorRetirementAuthorityV1,
  target: LibraryCoreActorRetirementTargetV1,
  selectedReason: LibraryCoreActorRetirementReasonV1,
  retiredAtMs: number,
): LibraryCoreActorRetirementBodyV1 {
  if (!isLibraryCoreNonnegativeSafeInteger(retiredAtMs)) {
    throw new TypeError("actor retirement time is invalid");
  }
  return Object.freeze({
    format: LIBRARY_CORE_ACTOR_RETIREMENT_FORMAT_V1,
    library_id: authority.library_id,
    epoch: authority.epoch,
    epoch_id: authority.epoch_id,
    authority_key_id: authority.authority_key_id,
    actor_id: target.actor_id,
    capability_id: target.capability_id,
    capability_certificate_digest: target.capability_certificate_digest,
    retirement_identity: target.retirement_identity,
    reason: selectedReason,
    retired_at_ms: retiredAtMs,
    signature_algorithm: "ed25519",
  });
}

export async function constructLibraryCoreActorRetirementCertificateV1(
  authorityInput: LibraryCoreActorRetirementAuthorityV1,
  targetInput: LibraryCoreActorRetirementTargetV1,
  selectedReason: LibraryCoreActorRetirementReasonV1,
  retiredAtMs: number,
  dependencies: LibraryCoreActorRetirementDependenciesV1,
): Promise<LibraryCoreActorRetirementCertificateV1> {
  if (
    typeof dependencies.digest !== "function" ||
    typeof dependencies.signAuthority !== "function"
  ) {
    throw new TypeError("actor retirement dependencies must be callable");
  }
  const authority = snapshotAuthority(authorityInput, dependencies.digest);
  const target = snapshotTarget(targetInput);
  const retirementBody = constructBody(
    authority,
    target,
    reason(selectedReason),
    retiredAtMs,
  );
  const retirementBodyDigest = digest(
    dependencies.digest,
    "actor-retirement-body",
    retirementBody,
  );
  const certificateDigest = digest(
    dependencies.digest,
    "actor-retirement-certificate",
    {
      retirement_body: retirementBody,
      retirement_body_digest: retirementBodyDigest,
    },
  );
  const authoritySignature = await dependencies.signAuthority(
    encodeLibraryCoreSignatureInput("actor-retirement-authority", {
      certificate_digest: certificateDigest,
    }),
  );
  if (!isLibraryCoreEd25519SignatureHex(authoritySignature)) {
    throw new TypeError("actor retirement authority signature is invalid");
  }
  return Object.freeze({
    retirement_body: retirementBody,
    retirement_body_digest: retirementBodyDigest,
    certificate_digest: certificateDigest,
    authority_signature: authoritySignature,
  });
}

export interface LibraryCoreVerifiedActorRetirementCertificateV1 {
  readonly certificate: LibraryCoreActorRetirementCertificateV1;
  readonly authority: LibraryCoreActorRetirementAuthorityV1;
}

export function isLibraryCoreVerifiedActorRetirementCertificateV1(
  value: unknown,
): value is LibraryCoreVerifiedActorRetirementCertificateV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.isFrozen(value) &&
    CLOSED_VERIFICATIONS.has(value)
  );
}

export async function verifyLibraryCoreActorRetirementCertificateV1(
  canonicalCertificate: Uint8Array,
  acceptedAuthorityInput: LibraryCoreActorRetirementAuthorityV1,
  dependencies: LibraryCoreActorRetirementVerificationDependenciesV1,
): Promise<LibraryCoreVerifiedActorRetirementCertificateV1> {
  if (
    typeof dependencies.digest !== "function" ||
    typeof dependencies.verifySignature !== "function"
  ) {
    throw new TypeError(
      "actor retirement verification dependencies must be callable",
    );
  }
  const authority = snapshotAuthority(
    acceptedAuthorityInput,
    dependencies.digest,
  );
  const decoded = decodeLibraryCoreCanonicalValue(canonicalCertificate);
  const certificate = closedRecord(
    decoded,
    [
      "retirement_body",
      "retirement_body_digest",
      "certificate_digest",
      "authority_signature",
    ],
    "actor retirement certificate",
  );
  const body = closedRecord(
    certificate.retirement_body,
    [
      "format",
      "library_id",
      "epoch",
      "epoch_id",
      "authority_key_id",
      "actor_id",
      "capability_id",
      "capability_certificate_digest",
      "retirement_identity",
      "reason",
      "retired_at_ms",
      "signature_algorithm",
    ],
    "actor retirement body",
  );
  const target = snapshotTarget({
    actor_id: body.actor_id as LibraryCoreLowercaseHex64,
    capability_id: body.capability_id as LibraryCoreLowercaseHex64,
    capability_certificate_digest:
      body.capability_certificate_digest as LibraryCoreLowercaseHex64,
    retirement_identity: body.retirement_identity as LibraryCoreLowercaseHex64,
  });
  const expectedBody = constructBody(
    authority,
    target,
    reason(body.reason),
    body.retired_at_ms as number,
  );
  if (!canonicalEqual(body, expectedBody)) {
    throw new TypeError("actor retirement body changed");
  }
  const retirementBodyDigest = digest(
    dependencies.digest,
    "actor-retirement-body",
    expectedBody,
  );
  if (certificate.retirement_body_digest !== retirementBodyDigest) {
    throw new TypeError("actor retirement body digest changed");
  }
  const certificateDigest = digest(
    dependencies.digest,
    "actor-retirement-certificate",
    {
      retirement_body: expectedBody,
      retirement_body_digest: retirementBodyDigest,
    },
  );
  if (certificate.certificate_digest !== certificateDigest) {
    throw new TypeError("actor retirement certificate digest changed");
  }
  if (!isLibraryCoreEd25519SignatureHex(certificate.authority_signature)) {
    throw new TypeError("actor retirement authority signature is invalid");
  }
  if (
    !(await dependencies.verifySignature({
      publicKeyHex: authority.authority_public_key,
      signatureHex: certificate.authority_signature,
      message: encodeLibraryCoreSignatureInput("actor-retirement-authority", {
        certificate_digest: certificateDigest,
      }),
    }))
  ) {
    throw new TypeError("actor retirement authority signature is invalid");
  }
  const typedCertificate = Object.freeze({
    retirement_body: expectedBody,
    retirement_body_digest: retirementBodyDigest,
    certificate_digest: certificateDigest,
    authority_signature: certificate.authority_signature,
  }) as LibraryCoreActorRetirementCertificateV1;
  const result = Object.freeze({ certificate: typedCertificate, authority });
  CLOSED_VERIFICATIONS.add(result);
  return result;
}
