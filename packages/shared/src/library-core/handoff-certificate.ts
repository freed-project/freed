import {
  decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput, encodeLibraryCoreSignatureInput,
  type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain, type LibraryCoreSignatureDomain,
} from "./canonical-codec.js";
import type { LibraryCoreEd25519VerificationInput } from "./ed25519-verification.js";
import { isLibraryCoreEd25519PublicKeyHex, isLibraryCoreEd25519SignatureHex } from "./protocol-scalars.js";
import { sha256LowerHex } from "./sha256.js";

export interface LibraryCoreHandoffPredecessorV1 {
  readonly libraryId: string;
  readonly epochId: string;
  readonly epoch: number;
  readonly certificateDigest: string;
  readonly authorityPublicKey: string;
  readonly writerId: string;
}

const bound = 16_384;
type RecordValue = { [key: string]: LibraryCoreCanonicalValue };
function record(value: LibraryCoreCanonicalValue | undefined, fields: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("handoff object is invalid");
  const expected = fields.split(" ").sort();
  if (Object.keys(value).sort().join(" ") !== expected.join(" ")) throw new Error("handoff object fields are invalid");
  return value as RecordValue;
}
function string(value: LibraryCoreCanonicalValue | undefined): string {
  if (typeof value !== "string") throw new Error("handoff string is invalid");
  return value;
}
function hex(value: LibraryCoreCanonicalValue | undefined): string {
  const result = string(value);
  if (result.length !== 64 || !/^[a-f0-9]{64}$/.test(result)) throw new Error("handoff identity is invalid");
  return result;
}
function integer(value: LibraryCoreCanonicalValue | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("handoff integer is invalid");
  return value;
}
function requireEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error("handoff does not match the pinned predecessor or consent");
}
function canonical(value: LibraryCoreCanonicalValue): Uint8Array {
  return encodeLibraryCoreCanonicalValue(value, { maximumBytes: bound });
}
function equalCanonical(left: LibraryCoreCanonicalValue, right: LibraryCoreCanonicalValue): void {
  const a = canonical(left), b = canonical(right);
  if (a.length !== b.length || a.some((byte, index) => byte !== b[index])) throw new Error("handoff canonical bytes differ");
}
function digest(domain: LibraryCoreDigestDomain, value: LibraryCoreCanonicalValue): string {
  return sha256LowerHex(encodeLibraryCoreDigestInput(domain, value, { maximumBytes: bound }));
}

/** Verify a direct successor against locally trusted predecessor and enrollment.
 * No storage selection, enrollment or writer admission is implied by this proof. */
export async function verifyLibraryCoreHandoffCertificateV1(
  canonicalBytes: Uint8Array,
  predecessor: LibraryCoreHandoffPredecessorV1,
  enrolledActorPublicKey: string,
  verifier: { verifySignature(input: LibraryCoreEd25519VerificationInput): boolean | Promise<boolean> },
) {
  if (canonicalBytes.byteLength > bound) throw new Error("handoff certificate exceeds its bound");
  const snapshot = new Uint8Array(canonicalBytes);
  const decoded = decodeLibraryCoreCanonicalValue(snapshot, { maximumBytes: bound });
  const encoded = canonical(decoded);
  if (snapshot.length !== encoded.length || snapshot.some((byte, index) => byte !== encoded[index])) throw new Error("handoff bytes are not canonical");
  const pin = { ...predecessor };
  for (const value of [pin.libraryId, pin.epochId, pin.certificateDigest, pin.authorityPublicKey, pin.writerId, enrolledActorPublicKey]) hex(value);
  if (integer(pin.epoch) < 1 || pin.epoch >= Number.MAX_SAFE_INTEGER) throw new Error("handoff predecessor epoch is invalid");
  const certificate = record(decoded, "certificate_body epoch_id epoch_signature authority_key_possession_signature");
  const body = record(certificate.certificate_body, "format library_id source_control target_epoch target_writer_id target_authority_public_key target_authority_key_id signature_algorithm handoff_authorization");
  const grant = record(body.handoff_authorization, "body authorization_digest predecessor_signature");
  const authorization = record(grant.body, "format readiness predecessor_authority_public_key successor_epoch final_source_revision final_checkpoint_digest source_control source_control_revision source_control_file_id");
  const readiness = record(authorization.readiness, "body handoff_id actor_signature authority_possession_signature");
  const ready = record(readiness.body, "format library_id predecessor_epoch_id predecessor_certificate_digest target_actor_id target_actor_public_key target_authority_public_key native_storage_version checkpoint_schema_version replication_protocol_version created_at_ms");
  requireEqual(ready.format, "freed_library_handoff_readiness_v1");
  requireEqual(ready.native_storage_version, 2);
  requireEqual(ready.checkpoint_schema_version, 1);
  requireEqual(ready.replication_protocol_version, 2);
  integer(ready.created_at_ms);
  requireEqual(hex(ready.library_id), pin.libraryId);
  requireEqual(hex(ready.predecessor_epoch_id), pin.epochId);
  requireEqual(hex(ready.predecessor_certificate_digest), pin.certificateDigest);
  requireEqual(hex(ready.target_actor_public_key), enrolledActorPublicKey);
  const targetActorId = hex(ready.target_actor_id);
  const targetPublicKey = hex(ready.target_authority_public_key);
  const handoffId = digest("handoff-readiness-body", ready);
  requireEqual(hex(readiness.handoff_id), handoffId);

  requireEqual(authorization.format, "freed_library_handoff_authorization_v1");
  requireEqual(integer(authorization.successor_epoch), pin.epoch + 1);
  const finalSourceRevision = integer(authorization.final_source_revision);
  hex(authorization.final_checkpoint_digest);
  requireEqual(hex(authorization.predecessor_authority_public_key), pin.authorityPublicKey);
  const fileId = string(authorization.source_control_file_id);
  if (fileId.length < 1 || fileId.length > 1024 || /[^A-Za-z0-9_-]/.test(fileId)) throw new Error("handoff control file is invalid");
  const revision = string(authorization.source_control_revision);
  const revisionBytes = new TextEncoder().encode(revision);
  if (revisionBytes.length < 2 || revisionBytes.length > 1024 || !revision.startsWith('"') || !revision.endsWith('"') || /["\x00-\x1f\x7f]/.test(revision.slice(1, -1))) throw new Error("handoff control revision is invalid");
  const control = record(authorization.source_control, "schemaVersion protocolVersion libraryId storageEpoch writerId activeTransport generation causalFrontierDigest manifest");
  requireEqual(control.schemaVersion, 1); requireEqual(control.protocolVersion, 1);
  requireEqual(hex(control.libraryId), pin.libraryId); requireEqual(hex(control.storageEpoch), pin.epochId);
  requireEqual(hex(control.writerId), pin.writerId); requireEqual(control.activeTransport, "google_drive_app_data_v1");
  const generation = integer(control.generation); hex(control.causalFrontierDigest);
  const manifest = record(control.manifest, "descriptor transportObjectId");
  const descriptor = record(manifest.descriptor, "objectKey contentDigest byteLength");
  const contentDigest = hex(descriptor.contentDigest);
  requireEqual(descriptor.objectKey, `freed-v2-manifest~${pin.libraryId}~e${pin.epochId}~g${generation}~${contentDigest}.json`);
  if (integer(descriptor.byteLength) === 0) throw new Error("handoff manifest length is invalid");
  const transportLength = new TextEncoder().encode(string(manifest.transportObjectId)).length;
  if (transportLength < 1 || transportLength > 1024) throw new Error("handoff manifest object is invalid");
  const authorizationDigest = digest("handoff-authorization-body", authorization);
  requireEqual(hex(grant.authorization_digest), authorizationDigest);
  requireEqual(body.format, "freed_library_core_writer_epoch_handoff_v1");
  requireEqual(body.signature_algorithm, "ed25519");
  requireEqual(hex(body.library_id), pin.libraryId);
  requireEqual(integer(body.target_epoch), pin.epoch + 1);
  requireEqual(hex(body.target_writer_id), targetActorId);
  requireEqual(hex(body.target_authority_public_key), targetPublicKey);
  const targetKeyId = digest("authority-key", { authority_public_key: targetPublicKey, signature_algorithm: "ed25519" });
  requireEqual(hex(body.target_authority_key_id), targetKeyId);
  equalCanonical(body.source_control!, control);
  const epochId = digest("epoch-transition-certificate", body);
  requireEqual(hex(certificate.epoch_id), epochId);
  const certificateDigest = digest("epoch-transition-certificate", certificate);

  // Build every message from the private decoded snapshot before yielding to
  // platform crypto. Caller mutations cannot change the bytes being verified.
  const checks: [LibraryCoreSignatureDomain, LibraryCoreCanonicalValue, string, LibraryCoreCanonicalValue | undefined][] = [
    ["handoff-readiness-actor", { digest: handoffId }, enrolledActorPublicKey, readiness.actor_signature],
    ["handoff-readiness-authority", { digest: handoffId }, targetPublicKey, readiness.authority_possession_signature],
    ["handoff-predecessor-authorization", { digest: authorizationDigest }, pin.authorityPublicKey, grant.predecessor_signature],
    ["epoch-transition-certificate", { certificate_digest: epochId }, targetPublicKey, certificate.epoch_signature],
    ["authority-key-possession", { certificate_digest: epochId, target_authority_key_id: targetKeyId }, targetPublicKey, certificate.authority_key_possession_signature],
  ];
  const inputs = checks.map(([domain, value, publicKeyHex, signature]) => {
    const signatureHex = string(signature);
    if (!isLibraryCoreEd25519PublicKeyHex(publicKeyHex) || !isLibraryCoreEd25519SignatureHex(signatureHex)) throw new Error("handoff signature encoding is invalid");
    return { publicKeyHex, signatureHex, message: encodeLibraryCoreSignatureInput(domain, value, { maximumBytes: bound }) };
  });
  for (const input of inputs) if (!await verifier.verifySignature(input)) throw new Error("handoff signature is invalid");
  return Object.freeze({ canonicalBytes: snapshot, handoffId, epochId, certificateDigest,
    libraryId: pin.libraryId, epoch: pin.epoch + 1, writerId: targetActorId, finalSourceRevision,
    authorityKeyId: targetKeyId, authorityPublicKey: targetPublicKey });
}
