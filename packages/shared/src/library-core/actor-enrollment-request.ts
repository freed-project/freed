import {
  encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  isLibraryCoreActorEnrollmentBodyConstructionV1,
  type LibraryCoreActorEnrollmentBodyConstructionV1,
  type LibraryCoreActorEnrollmentBodyV1,
} from "./actor-enrollment-contracts.js";
import type { LibraryCoreActorEnrollmentCertificateV1 } from "./actor-enrollment-certificate.js";
import {
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

const CLOSED_REQUESTS = new WeakSet<object>();

export interface LibraryCoreActorEnrollmentRequestV1 {
  readonly certificate_body: Readonly<{
    readonly actor_enrollment_body: LibraryCoreActorEnrollmentBodyV1;
    readonly enrollment_body_digest: LibraryCoreLowercaseHex64;
    readonly actor_proof: LibraryCoreEd25519SignatureHex;
  }>;
  readonly certificate_digest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreActorEnrollmentRequestDependenciesV1 {
  readonly signActorProof: (input: Uint8Array) => Promise<unknown>;
  readonly digest: (
    domain: "actor-enrollment-certificate",
    value: unknown,
  ) => unknown;
}

export interface LibraryCoreActorEnrollmentCompletionDependenciesV1 {
  readonly signAuthorityCertificate: (input: Uint8Array) => Promise<unknown>;
}

function requireSignature(value: unknown, label: string): LibraryCoreEd25519SignatureHex {
  if (!isLibraryCoreEd25519SignatureHex(value)) {
    throw new TypeError(`${label} must be 128 lowercase hexadecimal characters`);
  }
  return value;
}

/** Create the proof-only immutable request that a Desktop authority may countersign. */
export async function constructLibraryCoreActorEnrollmentRequestV1(
  body: LibraryCoreActorEnrollmentBodyConstructionV1,
  dependencies: LibraryCoreActorEnrollmentRequestDependenciesV1,
): Promise<LibraryCoreActorEnrollmentRequestV1> {
  if (!isLibraryCoreActorEnrollmentBodyConstructionV1(body)) {
    throw new TypeError("actor enrollment body must come from the closed construction contract");
  }
  const actorProof = requireSignature(
    await dependencies.signActorProof(
      encodeLibraryCoreSignatureInput("actor-enrollment-proof", {
        enrollment_body_digest: body.enrollment_body_digest,
      }),
    ),
    "actor proof",
  );
  const certificateBody = Object.freeze({
    actor_enrollment_body: body.body,
    enrollment_body_digest: body.enrollment_body_digest,
    actor_proof: actorProof,
  });
  const certificateDigest = dependencies.digest(
    "actor-enrollment-certificate",
    certificateBody,
  );
  if (!isLibraryCoreLowercaseHex64(certificateDigest)) {
    throw new TypeError("actor enrollment request has an invalid digest");
  }
  const request = Object.freeze({
    certificate_body: certificateBody,
    certificate_digest: certificateDigest,
  });
  CLOSED_REQUESTS.add(request);
  return request;
}

/** Add only the designated Desktop authority signature to one verified request construction. */
export async function completeLibraryCoreActorEnrollmentRequestV1(
  request: LibraryCoreActorEnrollmentRequestV1,
  dependencies: LibraryCoreActorEnrollmentCompletionDependenciesV1,
): Promise<LibraryCoreActorEnrollmentCertificateV1> {
  if (!CLOSED_REQUESTS.has(request)) {
    throw new TypeError("actor enrollment request must come from the closed request contract");
  }
  const authoritySignature = requireSignature(
    await dependencies.signAuthorityCertificate(
      encodeLibraryCoreSignatureInput("actor-enrollment-authority", {
        certificate_digest: request.certificate_digest,
      }),
    ),
    "authority signature",
  );
  return Object.freeze({
    certificate_body: request.certificate_body,
    certificate_digest: request.certificate_digest,
    authority_signature: authoritySignature,
  }) as LibraryCoreActorEnrollmentCertificateV1;
}

/** Canonical request bytes contain no authority signature or private key material. */
export function actorEnrollmentRequestCanonicalValueV1(
  request: LibraryCoreActorEnrollmentRequestV1,
): LibraryCoreCanonicalValue {
  if (!CLOSED_REQUESTS.has(request)) {
    throw new TypeError("actor enrollment request must come from the closed request contract");
  }
  return request as unknown as LibraryCoreCanonicalValue;
}
