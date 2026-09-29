import {
  constructLibraryCoreActorCapabilityRequestV2, constructLibraryCoreActorEnrollmentBodyV1,
  decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalValue, encodeLibraryCoreDigestInput,
  isLibraryCoreEd25519SignatureHex, LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
  parseLibraryCoreStoreFollowerActorRequestV2, sha256LowerHex, verifyLibraryCoreEd25519WithWebCrypto,
  type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain,
  type LibraryCoreFollowerActorEnrollmentContextV2, type LibraryCoreStoreFollowerActorRequestV2,
} from "@freed/shared/library-core";

function record(value: LibraryCoreCanonicalValue | undefined): Record<string, LibraryCoreCanonicalValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PWA follower actor request body is invalid");
  return value as Record<string, LibraryCoreCanonicalValue>;
}
const digest = (domain: LibraryCoreDigestDomain, value: unknown) =>
  sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue));

/** Reconstruct the closed shared protocol, verify its actor proof, then compare every byte. */
export async function verifyPwaFollowerActorRequest(
  input: LibraryCoreStoreFollowerActorRequestV2,
  authority: LibraryCoreFollowerActorEnrollmentContextV2["authority"],
  subtle: SubtleCrypto,
) {
  const request = parseLibraryCoreStoreFollowerActorRequestV2(input);
  const decoded = record(decodeLibraryCoreCanonicalValue(request.canonicalRequestBytes, { maximumBytes: 65_536 }));
  const body = record(decoded.certificate_body), original = record(body.actor_enrollment_body);
  const enrollment = constructLibraryCoreActorEnrollmentBodyV1({
    actor_incarnation_nonce: original.actor_incarnation_nonce,
    actor_public_key: original.actor_public_key,
    authority_key_id: original.authority_key_id,
    created_at_ms: original.created_at_ms,
    epoch: original.epoch,
    epoch_id: original.epoch_id,
    installation_incarnation: original.installation_incarnation,
    library_id: original.library_id,
    observed_frontier: original.observed_frontier,
    operation_id: original.operation_id,
  }, { digest });
  const derived = enrollment.body;
  if (derived.library_id !== authority.library_id || derived.epoch_id !== authority.epoch_id ||
      derived.epoch !== authority.epoch || derived.authority_key_id !== authority.authority_key_id ||
      derived.created_at_ms !== request.createdAt) throw new Error("PWA follower actor request authority changed");
  const signature = body.actor_proof;
  if (!isLibraryCoreEd25519SignatureHex(signature)) throw new Error("PWA follower actor request proof is invalid");
  const expected = await constructLibraryCoreActorCapabilityRequestV2(enrollment, {
    actor_class: "editor", allowed_operation_types: LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
    allowed_query_ids: [], scope: { mode: "library_wide" },
  }, { digest, signActorProof: async message => {
    if (!await verifyLibraryCoreEd25519WithWebCrypto({ message, publicKeyHex: derived.actor_public_key, signatureHex: signature }, subtle)) {
      throw new Error("PWA follower actor request proof is invalid");
    }
    return signature;
  } });
  const canonical = encodeLibraryCoreCanonicalValue(expected.request as unknown as LibraryCoreCanonicalValue, { maximumBytes: 65_536 });
  if (canonical.length !== request.canonicalRequestBytes.length || canonical.some((byte, index) => byte !== request.canonicalRequestBytes[index])) {
    throw new Error("PWA follower actor request differs from its closed proof");
  }
  return { request, enrollment: derived, requestDigest: expected.request.certificate_digest };
}
