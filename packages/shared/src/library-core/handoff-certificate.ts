import { parseLibraryCoreControlPointerV1 } from "./immutable-transport-contracts.js";
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

/** Authenticate only the immutable predecessor checkpoint reference. The target
 * key in the signed readiness proves possession, not local actor enrollment.
 * Callers must still import that predecessor and run ordinary successor admission.
 * This function performs no I/O and grants no selection or writer authority. */
async function verifyPredecessorRead(
  canonicalBytes: Uint8Array,
  predecessor: LibraryCoreHandoffPredecessorV1,
  verifier: { verifySignature(input: LibraryCoreEd25519VerificationInput): boolean | Promise<boolean> },
) {
  if (canonicalBytes.byteLength > bound) throw new Error("handoff certificate exceeds its bound");
  const snapshot = new Uint8Array(canonicalBytes);
  const decoded = record(decodeLibraryCoreCanonicalValue(snapshot, { maximumBytes: bound }),
    "certificate_body epoch_id epoch_signature authority_key_possession_signature");
  const body = record(decoded.certificate_body,
    "format library_id source_control target_epoch target_writer_id target_authority_public_key target_authority_key_id signature_algorithm handoff_authorization");
  const grant = record(body.handoff_authorization, "body authorization_digest predecessor_signature");
  const authorization = record(grant.body,
    "format readiness predecessor_authority_public_key successor_epoch final_source_revision final_checkpoint_digest source_control source_control_revision source_control_file_id");
  const readiness = record(authorization.readiness, "body handoff_id actor_signature authority_possession_signature");
  const ready = record(readiness.body,
    "format library_id predecessor_epoch_id predecessor_certificate_digest target_actor_id target_actor_public_key target_authority_public_key native_storage_version checkpoint_schema_version replication_protocol_version created_at_ms");
  // Verify the same canonical bytes and all five signatures. In particular the
  // locally trusted predecessor signs the manifest and the claimed target key.
  const proof = await verifyLibraryCoreHandoffCertificateV1(snapshot, predecessor,
    hex(ready.target_actor_public_key), verifier);
  const control = parseLibraryCoreControlPointerV1(authorization.source_control);
  const pointer = Object.freeze({ ...control, manifest: Object.freeze({ ...control.manifest,
    descriptor: Object.freeze({ ...control.manifest.descriptor }) }) });
  const reference = Object.freeze({ purpose: "predecessor_checkpoint_read" as const,
    pointer, controlRevision: string(authorization.source_control_revision),
    controlFileId: string(authorization.source_control_file_id),
    checkpointDigest: hex(authorization.final_checkpoint_digest),
    sourceRevision: proof.finalSourceRevision, successorEpochId: proof.epochId,
    authorizationDigest: hex(grant.authorization_digest) });
  return { reference, proof };
}


/** Authenticate one immutable checkpoint download reference without admitting it. */
export async function verifyLibraryCoreHandoffPredecessorCheckpointV1(
  canonicalBytes: Uint8Array,
  predecessor: LibraryCoreHandoffPredecessorV1,
  verifier: { verifySignature(input: LibraryCoreEd25519VerificationInput): boolean | Promise<boolean> },
) {
  return (await verifyPredecessorRead(canonicalBytes, predecessor, verifier)).reference;
}

/** Authenticate download references across missed transfers. This is read
 * permission only: each historical enrollment and checkpoint still needs
 * verification before the final checkpoint may replace selected state.
 * Snapshot the whole bounded chain before crypto yields to caller code. */
export async function verifyLibraryCoreHandoffChainReadsV1(
  certificates: readonly Uint8Array[],
  predecessor: LibraryCoreHandoffPredecessorV1,
  expectedSuccessorEpochId: string,
  verifier: { verifySignature(input: LibraryCoreEd25519VerificationInput): boolean | Promise<boolean> },
) {
  if (!Array.isArray(certificates) || certificates.length < 1 || certificates.length > 32) {
    throw new Error("handoff read chain must contain between one and 32 certificates");
  }
  hex(expectedSuccessorEpochId);
  let pin = { ...predecessor };
  const snapshots: Uint8Array[] = [];
  for (const bytes of certificates) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > bound) {
      throw new Error("handoff read chain certificate exceeds its bound");
    }
    snapshots.push(new Uint8Array(bytes));
  }
  const references: Awaited<ReturnType<typeof verifyLibraryCoreHandoffPredecessorCheckpointV1>>[] = [];
  let successor: Awaited<ReturnType<typeof verifyLibraryCoreHandoffCertificateV1>> | undefined;
  for (const bytes of snapshots) {
    const { reference, proof } = await verifyPredecessorRead(bytes, pin, verifier);
    references.push(reference);
    successor = proof;
    pin = { libraryId: proof.libraryId, epochId: proof.epochId, epoch: proof.epoch,
      certificateDigest: proof.certificateDigest, authorityPublicKey: proof.authorityPublicKey,
      writerId: proof.writerId };
  }
  requireEqual(pin.epochId, expectedSuccessorEpochId);
  if (!successor) throw new Error("handoff read chain is empty");
  return Object.freeze({ references: Object.freeze(references), successor });
}


/** Decode transport metadata only. Parsing never verifies signatures or grants
 * checkpoint admission; the receiving runtime must reconstruct its own proof. */
export function parseLibraryCorePredecessorCheckpointReadV1(value: unknown):
  Awaited<ReturnType<typeof verifyLibraryCoreHandoffPredecessorCheckpointV1>> | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("predecessor read must be a closed record");
  }
  const input = record(value as RecordValue,
    "purpose pointer controlRevision controlFileId checkpointDigest sourceRevision successorEpochId authorizationDigest");
  requireEqual(input.purpose, "predecessor_checkpoint_read");
  const control = parseLibraryCoreControlPointerV1(input.pointer);
  const controlRevision = string(input.controlRevision), controlFileId = string(input.controlFileId);
  if (controlFileId.length < 1 || controlFileId.length > 1024 || /[^A-Za-z0-9_-]/.test(controlFileId)) {
    throw new Error("handoff control file is invalid");
  }
  if (controlRevision.length > 1024 || new TextEncoder().encode(controlRevision).length > 1024 ||
      controlRevision.length < 2 || !controlRevision.startsWith('"') || !controlRevision.endsWith('"') ||
      /["\x00-\x1f\x7f]/.test(controlRevision.slice(1, -1))) throw new Error("handoff control revision is invalid");
  const pointer = Object.freeze({ ...control, manifest: Object.freeze({ ...control.manifest,
    descriptor: Object.freeze({ ...control.manifest.descriptor }) }) });
  return Object.freeze({ purpose: "predecessor_checkpoint_read" as const, pointer, controlRevision, controlFileId,
    checkpointDigest: hex(input.checkpointDigest), sourceRevision: integer(input.sourceRevision),
    successorEpochId: hex(input.successorEpochId), authorizationDigest: hex(input.authorizationDigest) });
}

/** Normalize direct and multi-transfer read responses. These are transport
 * references, never proof that a checkpoint may replace the selected Library. */
export function parseLibraryCorePredecessorCheckpointReadsV1(value: unknown):
  readonly NonNullable<ReturnType<typeof parseLibraryCorePredecessorCheckpointReadV1>>[] | null {
  if (value === null) return null;
  const inputs = Array.isArray(value) ? value : [value];
  if (inputs.length < 1 || inputs.length > 32 || Reflect.ownKeys(inputs).length !== inputs.length + 1) {
    throw new Error("predecessor read chain is outside its bound");
  }
  const references: NonNullable<ReturnType<typeof parseLibraryCorePredecessorCheckpointReadV1>>[] = [];
  const stages = new Set<string>();
  for (let index = 0; index < inputs.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(inputs, String(index));
    if (!entry || !("value" in entry)) throw new Error("predecessor read chain must be dense data");
    const reference = parseLibraryCorePredecessorCheckpointReadV1(entry.value);
    if (!reference || reference.pointer.storageEpoch === reference.successorEpochId ||
        stages.has(reference.pointer.manifest.descriptor.contentDigest)) {
      throw new Error("predecessor read chain contains an empty or repeated hop");
    }
    const previous = references.at(-1);
    if (previous && (previous.pointer.libraryId !== reference.pointer.libraryId ||
        previous.successorEpochId !== reference.pointer.storageEpoch || previous.sourceRevision > reference.sourceRevision)) {
      throw new Error("predecessor read chain is disconnected or regresses its source");
    }
    stages.add(reference.pointer.manifest.descriptor.contentDigest);
    references.push(reference);
  }
  return Object.freeze(references);
}
