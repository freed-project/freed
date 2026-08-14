import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  constructLibraryCoreActorEnrollmentBodyV1,
  type LibraryCoreActorEnrollmentBodyV1,
} from "./actor-enrollment-contracts.js";
import type { LibraryCoreActorEnrollmentCertificateV1 } from "./actor-enrollment-certificate.js";
import {
  snapshotLibraryCoreCausalFrontier,
  type LibraryCoreCausalTipV1,
  type LibraryCoreConstructionDigestDomain,
} from "./operation-envelope-contracts.js";
import {
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

const VERIFIED_ACTOR_ENROLLMENT_CERTIFICATES = new WeakSet<object>();

const CERTIFICATE_KEYS = [
  "certificate_body",
  "certificate_digest",
  "authority_signature",
] as const;
const CERTIFICATE_BODY_KEYS = [
  "actor_enrollment_body",
  "enrollment_body_digest",
  "actor_proof",
] as const;
const AUTHORITY_STATE_KEYS = [
  "library_id",
  "epoch",
  "epoch_id",
  "authority_key_id",
  "authority_public_key",
  "observed_frontier",
] as const;

export interface LibraryCoreAcceptedAuthorityStateV1 {
  readonly library_id: LibraryCoreLowercaseHex64;
  readonly epoch: number;
  readonly epoch_id: LibraryCoreLowercaseHex64;
  readonly authority_key_id: LibraryCoreLowercaseHex64;
  readonly authority_public_key: LibraryCoreEd25519PublicKeyHex;
  readonly observed_frontier: readonly LibraryCoreCausalTipV1[];
}

export interface LibraryCoreVerifiedActorEnrollmentCertificateV1 {
  readonly certificate: LibraryCoreActorEnrollmentCertificateV1;
  readonly actor_chain_genesis: LibraryCoreLowercaseHex64;
  readonly authority_state: LibraryCoreAcceptedAuthorityStateV1;
}

export interface LibraryCoreActorEnrollmentVerificationDependencies {
  readonly digest: (
    domain: LibraryCoreConstructionDigestDomain,
    value: unknown,
  ) => unknown;
  readonly verifySignature: (input: {
    readonly publicKeyHex: LibraryCoreEd25519PublicKeyHex;
    readonly signatureHex: LibraryCoreEd25519SignatureHex;
    readonly message: Uint8Array;
  }) => Promise<boolean>;
}

function requireClosedRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  label: string,
): Readonly<Record<Keys[number], unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} may not contain symbol keys`);
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== keys.length ||
    keys.some((key) => !names.includes(key))
  ) {
    throw new TypeError(`${label} has an invalid field set`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        `${label}.${key} must be an enumerable data property`,
      );
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot) as Readonly<Record<Keys[number], unknown>>;
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

function requirePublicKey(
  value: unknown,
  label: string,
): LibraryCoreEd25519PublicKeyHex {
  if (!isLibraryCoreEd25519PublicKeyHex(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters`);
  }
  return value;
}

function requireSignature(
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

function digest(
  dependencies: LibraryCoreActorEnrollmentVerificationDependencies,
  domain: LibraryCoreConstructionDigestDomain,
  value: unknown,
): LibraryCoreLowercaseHex64 {
  const result = dependencies.digest(domain, value);
  if (!isLibraryCoreLowercaseHex64(result)) {
    throw new TypeError(
      `${domain} digest dependency returned an invalid digest`,
    );
  }
  return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function requireCanonicalEquality(
  received: unknown,
  expected: unknown,
  label: string,
): void {
  const receivedBytes = encodeLibraryCoreCanonicalValue(
    received as LibraryCoreCanonicalValue,
  );
  const expectedBytes = encodeLibraryCoreCanonicalValue(
    expected as LibraryCoreCanonicalValue,
  );
  if (!bytesEqual(receivedBytes, expectedBytes)) {
    throw new TypeError(`${label} does not match its derived canonical value`);
  }
}

function snapshotAuthorityState(
  value: unknown,
  dependencies: LibraryCoreActorEnrollmentVerificationDependencies,
): LibraryCoreAcceptedAuthorityStateV1 {
  const record = requireClosedRecord(
    value,
    AUTHORITY_STATE_KEYS,
    "accepted authority state",
  );
  const authorityPublicKey = requirePublicKey(
    record.authority_public_key,
    "accepted authority state.authority_public_key",
  );
  const authorityKeyId = requireHex64(
    record.authority_key_id,
    "accepted authority state.authority_key_id",
  );
  const expectedAuthorityKeyId = digest(dependencies, "authority-key", {
    signature_algorithm: "ed25519",
    authority_public_key: authorityPublicKey,
  });
  if (authorityKeyId !== expectedAuthorityKeyId) {
    throw new TypeError(
      "accepted authority state key ID does not match its public key",
    );
  }
  if (
    !isLibraryCoreNonnegativeSafeInteger(record.epoch) ||
    record.epoch === 0
  ) {
    throw new TypeError("accepted authority state.epoch must be positive");
  }
  return Object.freeze({
    library_id: requireHex64(
      record.library_id,
      "accepted authority state.library_id",
    ),
    epoch: record.epoch,
    epoch_id: requireHex64(
      record.epoch_id,
      "accepted authority state.epoch_id",
    ),
    authority_key_id: authorityKeyId,
    authority_public_key: authorityPublicKey,
    observed_frontier: snapshotLibraryCoreCausalFrontier(
      record.observed_frontier,
      "accepted authority state.observed_frontier",
    ),
  });
}

function assertAuthorityBinding(
  body: LibraryCoreActorEnrollmentBodyV1,
  authority: LibraryCoreAcceptedAuthorityStateV1,
): void {
  if (
    body.library_id !== authority.library_id ||
    body.epoch !== authority.epoch ||
    body.epoch_id !== authority.epoch_id ||
    body.authority_key_id !== authority.authority_key_id
  ) {
    throw new TypeError(
      "actor enrollment body does not match accepted authority state",
    );
  }
  requireCanonicalEquality(
    body.observed_frontier,
    authority.observed_frontier,
    "actor enrollment observed frontier",
  );
}

export function isLibraryCoreVerifiedActorEnrollmentCertificateV1(
  value: unknown,
): value is LibraryCoreVerifiedActorEnrollmentCertificateV1 {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  return VERIFIED_ACTOR_ENROLLMENT_CERTIFICATES.has(value);
}

/**
 * Verify one canonical actor enrollment certificate against the exact accepted
 * authority state.
 *
 * This function validates cryptographic admission only. It does not commit the
 * certificate, allocate actor sequence, resolve retries or conflicts, persist
 * state, contact providers, or grant writer authority.
 */
export async function verifyLibraryCoreActorEnrollmentCertificateV1(
  certificateBytes: Uint8Array,
  acceptedAuthorityState: unknown,
  dependencies: LibraryCoreActorEnrollmentVerificationDependencies,
): Promise<LibraryCoreVerifiedActorEnrollmentCertificateV1> {
  const digestValue = dependencies.digest;
  const verifySignature = dependencies.verifySignature;
  if (
    typeof digestValue !== "function" ||
    typeof verifySignature !== "function"
  ) {
    throw new TypeError(
      "actor enrollment verification dependencies must be callable",
    );
  }
  const verificationDependencies = Object.freeze({
    digest: digestValue,
    verifySignature,
  }) satisfies LibraryCoreActorEnrollmentVerificationDependencies;
  const decoded = decodeLibraryCoreCanonicalValue(certificateBytes);
  const certificate = requireClosedRecord(
    decoded,
    CERTIFICATE_KEYS,
    "actor enrollment certificate",
  );
  const certificateBody = requireClosedRecord(
    certificate.certificate_body,
    CERTIFICATE_BODY_KEYS,
    "actor enrollment certificate body",
  );
  const receivedBody = requireClosedRecord(
    certificateBody.actor_enrollment_body,
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
  const derivedBody = constructLibraryCoreActorEnrollmentBodyV1(
    {
      operation_id: receivedBody.operation_id,
      library_id: receivedBody.library_id,
      epoch: receivedBody.epoch,
      epoch_id: receivedBody.epoch_id,
      authority_key_id: receivedBody.authority_key_id,
      installation_incarnation: receivedBody.installation_incarnation,
      actor_incarnation_nonce: receivedBody.actor_incarnation_nonce,
      actor_public_key: receivedBody.actor_public_key,
      observed_frontier: receivedBody.observed_frontier,
      created_at_ms: receivedBody.created_at_ms,
    },
    verificationDependencies,
  );
  requireCanonicalEquality(
    receivedBody,
    derivedBody.body,
    "actor enrollment body",
  );
  const authorityState = snapshotAuthorityState(
    acceptedAuthorityState,
    verificationDependencies,
  );
  assertAuthorityBinding(derivedBody.body, authorityState);

  const enrollmentBodyDigest = requireHex64(
    certificateBody.enrollment_body_digest,
    "actor enrollment certificate body.enrollment_body_digest",
  );
  if (enrollmentBodyDigest !== derivedBody.enrollment_body_digest) {
    throw new TypeError("actor enrollment body digest does not match its body");
  }
  const actorProof = requireSignature(
    certificateBody.actor_proof,
    "actor enrollment certificate body.actor_proof",
  );
  const actorProofValid = await verifySignature({
    publicKeyHex: derivedBody.body.actor_public_key,
    signatureHex: actorProof,
    message: encodeLibraryCoreSignatureInput("actor-enrollment-proof", {
      enrollment_body_digest: enrollmentBodyDigest,
    }),
  });
  if (actorProofValid !== true) {
    throw new TypeError("actor enrollment proof signature is invalid");
  }

  const certificateDigest = requireHex64(
    certificate.certificate_digest,
    "actor enrollment certificate.certificate_digest",
  );
  const expectedCertificateDigest = digest(
    verificationDependencies,
    "actor-enrollment-certificate",
    certificateBody,
  );
  if (certificateDigest !== expectedCertificateDigest) {
    throw new TypeError(
      "actor enrollment certificate digest does not match its body",
    );
  }
  const authoritySignature = requireSignature(
    certificate.authority_signature,
    "actor enrollment certificate.authority_signature",
  );
  const authoritySignatureValid = await verifySignature({
    publicKeyHex: authorityState.authority_public_key,
    signatureHex: authoritySignature,
    message: encodeLibraryCoreSignatureInput("actor-enrollment-authority", {
      certificate_digest: certificateDigest,
    }),
  });
  if (authoritySignatureValid !== true) {
    throw new TypeError("actor enrollment authority signature is invalid");
  }

  const actorChainGenesis = digest(
    verificationDependencies,
    "actor-chain-genesis",
    {
      enrollment_certificate_digest: certificateDigest,
      actor_id: derivedBody.body.actor_id,
      epoch_id: derivedBody.body.epoch_id,
    },
  );
  const verifiedCertificate = Object.freeze({
    certificate_body: Object.freeze({
      actor_enrollment_body: derivedBody.body,
      enrollment_body_digest: enrollmentBodyDigest,
      actor_proof: actorProof,
    }),
    certificate_digest: certificateDigest,
    authority_signature: authoritySignature,
  }) satisfies LibraryCoreActorEnrollmentCertificateV1;

  const verified = Object.freeze({
    certificate: verifiedCertificate,
    actor_chain_genesis: actorChainGenesis,
    authority_state: authorityState,
  });
  VERIFIED_ACTOR_ENROLLMENT_CERTIFICATES.add(verified);
  return verified;
}
