import {
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  isLibraryCoreActorEnrollmentBodyConstructionV1,
  type LibraryCoreActorEnrollmentBodyConstructionV1,
  type LibraryCoreActorEnrollmentBodyV1,
} from "./actor-enrollment-contracts.js";
import {
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

const CLOSED_ACTOR_ENROLLMENT_CERTIFICATE = Symbol(
  "closed Library Core actor enrollment certificate",
);

export interface LibraryCoreActorEnrollmentCertificateBodyV1 {
  readonly actor_enrollment_body: LibraryCoreActorEnrollmentBodyV1;
  readonly enrollment_body_digest: LibraryCoreLowercaseHex64;
  readonly actor_proof: LibraryCoreEd25519SignatureHex;
}

export interface LibraryCoreActorEnrollmentCertificateV1 {
  readonly certificate_body: LibraryCoreActorEnrollmentCertificateBodyV1;
  readonly certificate_digest: LibraryCoreLowercaseHex64;
  readonly authority_signature: LibraryCoreEd25519SignatureHex;
}

export interface LibraryCoreActorEnrollmentCertificateConstructionV1 {
  readonly certificate: LibraryCoreActorEnrollmentCertificateV1;
  readonly actor_chain_genesis: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreActorEnrollmentCertificateDependencies {
  readonly signActorProof: (input: Uint8Array) => Promise<unknown>;
  readonly signAuthorityCertificate: (input: Uint8Array) => Promise<unknown>;
  readonly digest: (
    domain: "actor-enrollment-certificate" | "actor-chain-genesis",
    value: unknown,
  ) => unknown;
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
  dependencies: LibraryCoreActorEnrollmentCertificateDependencies,
  domain: "actor-enrollment-certificate" | "actor-chain-genesis",
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

export function isLibraryCoreActorEnrollmentCertificateConstructionV1(
  value: unknown,
): value is LibraryCoreActorEnrollmentCertificateConstructionV1 {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  const brand = Object.getOwnPropertyDescriptor(
    value,
    CLOSED_ACTOR_ENROLLMENT_CERTIFICATE,
  );
  const candidate =
    value as Partial<LibraryCoreActorEnrollmentCertificateConstructionV1>;
  return (
    brand !== undefined &&
    !brand.enumerable &&
    !brand.configurable &&
    !brand.writable &&
    brand.value === true &&
    typeof candidate.certificate === "object" &&
    candidate.certificate !== null &&
    Object.isFrozen(candidate.certificate) &&
    isLibraryCoreLowercaseHex64(candidate.actor_chain_genesis)
  );
}

/**
 * Prove actor-key possession, bind the enrollment body to one authority
 * signature, and derive the actor-chain genesis commitment.
 *
 * This construction does not verify either signature, commit enrollment,
 * persist authority state, expose private key material, or grant writer
 * authority.
 */
export async function constructLibraryCoreActorEnrollmentCertificateV1(
  bodyConstruction: LibraryCoreActorEnrollmentBodyConstructionV1,
  dependencies: LibraryCoreActorEnrollmentCertificateDependencies,
): Promise<LibraryCoreActorEnrollmentCertificateConstructionV1> {
  if (!isLibraryCoreActorEnrollmentBodyConstructionV1(bodyConstruction)) {
    throw new TypeError(
      "actor enrollment body must come from the closed construction contract",
    );
  }
  const actorProofInput = encodeLibraryCoreSignatureInput(
    "actor-enrollment-proof",
    {
      enrollment_body_digest: bodyConstruction.enrollment_body_digest,
    },
  );
  const actorProof = requireSignature(
    await dependencies.signActorProof(actorProofInput),
    "actor proof",
  );
  const certificateBody = Object.freeze({
    actor_enrollment_body: bodyConstruction.body,
    enrollment_body_digest: bodyConstruction.enrollment_body_digest,
    actor_proof: actorProof,
  }) satisfies LibraryCoreActorEnrollmentCertificateBodyV1;
  const certificateDigest = digest(
    dependencies,
    "actor-enrollment-certificate",
    certificateBody,
  );
  const authoritySignatureInput = encodeLibraryCoreSignatureInput(
    "actor-enrollment-authority",
    {
      certificate_digest: certificateDigest,
    },
  );
  const authoritySignature = requireSignature(
    await dependencies.signAuthorityCertificate(authoritySignatureInput),
    "authority signature",
  );
  const certificate = Object.freeze({
    certificate_body: certificateBody,
    certificate_digest: certificateDigest,
    authority_signature: authoritySignature,
  }) satisfies LibraryCoreActorEnrollmentCertificateV1;
  const actorChainGenesis = digest(dependencies, "actor-chain-genesis", {
    enrollment_certificate_digest: certificateDigest,
    actor_id: bodyConstruction.body.actor_id,
    epoch_id: bodyConstruction.body.epoch_id,
  } satisfies LibraryCoreCanonicalValue);

  return Object.freeze(
    Object.defineProperty(
      {
        certificate,
        actor_chain_genesis: actorChainGenesis,
      },
      CLOSED_ACTOR_ENROLLMENT_CERTIFICATE,
      {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      },
    ),
  );
}
