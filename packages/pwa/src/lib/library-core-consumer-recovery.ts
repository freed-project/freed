import type { CAPI, Database } from "@sqlite.org/sqlite-wasm";
import {
  decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalValue,
  parseLibraryCoreConsumerRecoveryPlanV1, parseLibraryCoreConsumerRecoveryStatusV1,
  type LibraryCoreConsumerRecoveryPlanV1, type LibraryCoreConsumerRecoveryStatusV1,
  isLibraryCoreLowercaseHex64, isLibraryCoreNonnegativeSafeInteger, parseLibraryCoreStoreFollowerActorRequestV2,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, sha256LowerHex,
  verifyLibraryCoreEd25519WithWebCrypto, verifyLibraryCoreHandoffCertificateV1,
  type LibraryCoreCanonicalValue, type LibraryCoreFollowerActorEnrollmentContextV2,
  type LibraryCoreStoreFollowerActorRequestV2,
} from "@freed/shared/library-core";
import { archivePwaFollowerRowsWithStorageAdmission, verifyPwaRecoveryArchiveWithStorageAdmission } from "./library-core-recovery-archive";
import { migratePwaLibraryRecoverySchema, readPwaLibraryStorageIdentity } from "./library-core-recovery-schema";
import { verifyPwaFollowerActorRequest } from "./library-core-follower-request-proof";

type Authority = LibraryCoreFollowerActorEnrollmentContextV2["authority"];
const canonical = (value: unknown, maximumBytes = 16_384) =>
  encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue, { maximumBytes });
const utf8 = new TextDecoder("utf-8", { fatal: true });
const encodeText = (value: string) => Uint8Array.from(new TextEncoder().encode(value));
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("consumer recovery text is unavailable");
  return value;
}
function integer(value: unknown): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) throw new Error("consumer recovery integer is invalid");
  return value;
}
function rows(db: Database, sql: string, bind: string[] = []) {
  return db.exec({ sql, bind, rowMode: "array", returnValue: "resultRows" });
}
function object(value: LibraryCoreCanonicalValue | undefined): Record<string, LibraryCoreCanonicalValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("consumer recovery record is invalid");
  return value as Record<string, LibraryCoreCanonicalValue>;
}
function selected(db: Database, authority: Authority) {
  const result = rows(db, `SELECT epoch.epoch_id, epoch.epoch_number, epoch.authority_key_id, epoch.authority_public_key,
    epoch.transition_certificate_digest, epoch.canonical_transition_certificate, receipt.writer_actor_id,
    meta.source_revision, receipt.checkpoint_digest, receipt.checkpoint_generation
    FROM library_meta AS meta JOIN library_authority_epochs AS epoch ON epoch.epoch_id = meta.authority_epoch
    JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1
      AND receipt.library_id = meta.library_id AND receipt.authority_epoch_id = epoch.epoch_id
    WHERE meta.singleton_id = 1 AND meta.library_id = ?1;`, [authority.library_id]);
  if (result.length !== 1 || result[0]![0] !== authority.epoch_id || result[0]![1] !== authority.epoch ||
      result[0]![2] !== authority.authority_key_id || result[0]![3] !== authority.authority_public_key) {
    throw new Error("consumer recovery accepted successor changed");
  }
  return result[0]!;
}
function candidate(db: Database, authority: Authority) {
  const current = selected(db, authority);
  const requests = rows(db, `SELECT library_id, authority_epoch_id, actor_id, actor_public_key,
    enrollment_request_digest, canonical_enrollment_request, created_at FROM library_follower_actor_request WHERE singleton_id = 1;`);
  if (requests.length !== 1 || requests[0]![0] !== authority.library_id || requests[0]![1] === authority.epoch_id) {
    throw new Error("consumer recovery requires the previous enrollment");
  }
  const old = requests[0]!;
  const history = rows(db, `SELECT epoch_number, transition_certificate_digest, authority_public_key
    FROM library_authority_epochs WHERE library_id = ?1 AND epoch_id = ?2;`, [authority.library_id, text(old[1])]);
  if (history.length !== 1) throw new Error("consumer recovery predecessor is missing");
  const certificate = object(decodeLibraryCoreCanonicalValue(encodeText(text(current[5])), { maximumBytes: 16_384 }));
  const body = object(certificate.certificate_body), grant = object(body.handoff_authorization);
  const grantBody = object(grant.body), readiness = object(grantBody.readiness), ready = object(readiness.body);
  if (ready.predecessor_epoch_id !== old[1]) throw new Error("consumer recovery requires the direct successor");
  const oldRequest = object(decodeLibraryCoreCanonicalValue(encodeText(text(old[5])), { maximumBytes: 65_536 }));
  const enrollment = object(object(oldRequest.certificate_body).actor_enrollment_body);
  const installation = text(enrollment.installation_incarnation);
  if (!isLibraryCoreLowercaseHex64(installation) || enrollment.actor_id !== old[2] || enrollment.actor_public_key !== old[3]) {
    throw new Error("consumer recovery original signing identity changed");
  }
  const id = sha256LowerHex(canonical({ library: authority.library_id, oldEpoch: old[1], newEpoch: authority.epoch_id,
    actor: old[2], request: old[4] }));
  return { id, old, current, history: history[0]!, installation, grant, grantBody, readiness, ready,
    snapshot: JSON.stringify([old, current, history]) };
}
async function verifySuccessor(value: ReturnType<typeof candidate>, authority: Authority, subtle: SubtleCrypto) {
  const control = object(value.grantBody.source_control);
  const proof = await verifyLibraryCoreHandoffCertificateV1(encodeText(text(value.current[5])), {
    libraryId: authority.library_id, epochId: text(value.old[1]), epoch: integer(value.history[0]),
    certificateDigest: text(value.history[1]), authorityPublicKey: text(value.history[2]), writerId: text(control.writerId),
  }, text(value.ready.target_actor_public_key), { verifySignature: input => verifyLibraryCoreEd25519WithWebCrypto(input, subtle) });
  if (proof.epochId !== authority.epoch_id || proof.epoch !== authority.epoch || proof.authorityKeyId !== authority.authority_key_id ||
      proof.authorityPublicKey !== authority.authority_public_key || proof.certificateDigest !== value.current[4] || proof.writerId !== value.current[6] || integer(value.current[7]) < proof.finalSourceRevision) {
    throw new Error("consumer recovery successor proof changed");
  }
  return proof;
}
function archivedRequest(db: Database, id: string) {
  const result = rows(db, `SELECT reenrollment_receipt, reenrollment_digest, reenrollment_committed_at, archive_digest,
    predecessor_epoch_id, successor_epoch_id, actor_id, reenrollment_installation_witness, created_at
    FROM library_local_recovery_archives WHERE recovery_id = ?1;`, [id]);
  if (result.length !== 1 || !(result[0]![0] instanceof Uint8Array)) throw new Error("consumer recovery prepared request is missing");
  const row = result[0]!;
  const bytes = row[0] as Uint8Array;
  if (sha256LowerHex(bytes) !== row[1]) throw new Error("consumer recovery prepared receipt changed");
  const request = object(decodeLibraryCoreCanonicalValue(bytes, { maximumBytes: 131_072 }));
  const fields = ["actorId", "actorPublicKey", "authorityEpochId", "canonicalEnrollmentRequestJson", "createdAt", "enrollmentRequestDigest", "libraryId"];
  if (JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(fields)) throw new Error("consumer recovery prepared receipt fields changed");
  return { row, request, input: { canonicalRequestBytes: encodeText(text(request.canonicalEnrollmentRequestJson)), createdAt: integer(request.createdAt) } };
}

export type PwaConsumerRecoveryPlan = LibraryCoreConsumerRecoveryPlanV1;
/** Read-only preparation data. It does not archive, replace an enrollment, or sign anything. */
export function readPwaConsumerRecoveryPlan(db: Database, authority: Authority): PwaConsumerRecoveryPlan {
  const value = candidate(db, authority);
  let preparedRequest: LibraryCoreStoreFollowerActorRequestV2 | null = null;
  if (readPwaLibraryStorageIdentity(db).schemaVersion === 2 &&
      db.selectValue("SELECT count(*) FROM library_local_recovery_archives WHERE recovery_id = ?1;", [value.id]) === 1) {
    preparedRequest = archivedRequest(db, value.id).input;
  }
  return parseLibraryCoreConsumerRecoveryPlanV1({ recoveryId: value.id, oldActorId: text(value.old[2]), actorPublicKey: text(value.old[3]),
    installationIncarnation: value.installation, predecessorEpochId: text(value.old[1]), authority, preparedRequest });
}

/** Bounded lifecycle metadata for UI and retry routing, not full archive verification. */
export function readPwaConsumerRecoveryStatus(db: Database, authority: Authority): LibraryCoreConsumerRecoveryStatusV1 {
  const active = rows(db, `SELECT authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest,
    canonical_enrollment_request, created_at FROM library_follower_actor_request WHERE singleton_id = 1 AND library_id = ?1;`, [authority.library_id]);
  if (active.length === 0) return { state: "none" };
  if (active.length !== 1) throw new Error("consumer recovery enrollment is ambiguous");
  if (active[0]![0] !== authority.epoch_id) {
    const plan = readPwaConsumerRecoveryPlan(db, authority);
    const counts = plan.preparedRequest
      ? rows(db, "SELECT pending_intent_count, published_intent_count FROM library_local_recovery_archives WHERE recovery_id = ?1;", [plan.recoveryId])
      : rows(db, "SELECT count(*) FILTER (WHERE state = 'pending'), count(*) FILTER (WHERE state = 'published') FROM library_intent_transactions;");
    if (counts.length !== 1) throw new Error("consumer recovery counts are unavailable");
    return parseLibraryCoreConsumerRecoveryStatusV1({ state: plan.preparedRequest ? "prepared" : "required", plan,
      pendingIntentCount: counts[0]![0], publishedIntentCount: counts[0]![1] });
  }
  if (readPwaLibraryStorageIdentity(db).schemaVersion === 1) return { state: "none" };
  return readPwaExistingConsumerRecoveryStatus(db,authority);
}

/** Storage version is checked by the caller; retained recovery proofs stay mandatory. */
export function readPwaExistingConsumerRecoveryStatus(db:Database,authority:Authority):LibraryCoreConsumerRecoveryStatusV1 {
  const active=rows(db,`SELECT authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest,
    canonical_enrollment_request, created_at FROM library_follower_actor_request WHERE singleton_id=1 AND library_id=?1;`,[authority.library_id]);
  if (active.length!==1 || active[0]![0]!==authority.epoch_id) throw new Error("consumer recovery enrollment is unavailable");
  const fences = rows(db, "SELECT phase FROM library_local_handoff WHERE singleton_id = 1;");
  if (fences.length === 0) return { state: "none" };
  const archive = rows(db, `SELECT archive.recovery_id, archive.pending_intent_count, archive.published_intent_count
    FROM library_local_handoff AS handoff JOIN library_local_recovery_archives AS archive
      ON archive.library_id = handoff.library_id AND archive.predecessor_epoch_id = handoff.predecessor_epoch_id
      AND archive.successor_epoch_id = handoff.successor_epoch_id
    WHERE handoff.singleton_id = 1 AND handoff.installation_role = 'consumer' AND handoff.phase = 'following'
      AND archive.reenrollment_committed_at IS NOT NULL AND archive.reenrollment_committed_at <= handoff.updated_at
      AND archive.library_id = ?1 AND archive.successor_epoch_id = ?2 LIMIT 2;`, [authority.library_id, authority.epoch_id]);
  if (archive.length !== 1) throw new Error("consumer recovery committed lifecycle is ambiguous");
  const id = text(archive[0]![0]), retained = archivedRequest(db, id), request = retained.request;
  if (JSON.stringify(active[0]) !== JSON.stringify([request.authorityEpochId, request.actorId, request.actorPublicKey,
    request.enrollmentRequestDigest, request.canonicalEnrollmentRequestJson, request.createdAt]) || request.libraryId !== authority.library_id) {
    throw new Error("consumer recovery installed request differs from its receipt");
  }
  selected(db, authority);
  return parseLibraryCoreConsumerRecoveryStatusV1({ state: "following", plan: {
    recoveryId: id, oldActorId: retained.row[6], actorPublicKey: request.actorPublicKey,
    installationIncarnation: retained.row[7], predecessorEpochId: retained.row[4], authority, preparedRequest: retained.input,
  }, pendingIntentCount: archive[0]![1], publishedIntentCount: archive[0]![2] });
}

/** Retire only a completed prior cycle, in the transaction that creates its successor archive. */
function retireCompletedConsumerCycle(db: Database, capi: CAPI, before: ReturnType<typeof candidate>, createdAt: number, admitStorage?: () => void) {
  const archives = rows(db, `SELECT archive.recovery_id FROM library_local_handoff AS handoff
    JOIN library_local_recovery_archives AS archive ON archive.library_id = handoff.library_id
      AND archive.predecessor_epoch_id = handoff.predecessor_epoch_id
      AND archive.successor_epoch_id = handoff.successor_epoch_id
      AND archive.reenrollment_committed_at IS NOT NULL
      AND archive.reenrollment_committed_at <= handoff.updated_at
    WHERE handoff.singleton_id = 1 AND handoff.installation_role = 'consumer' AND handoff.phase = 'following'
      AND handoff.library_id = ?1 AND handoff.successor_epoch_id = ?2
      AND handoff.successor_epoch_id != ?3 LIMIT 2;`,
    [text(before.old[0]), text(before.old[1]), text(before.current[0])]);
  if (archives.length !== 1) throw new Error("consumer recovery cannot replace another lifecycle fence");
  const id = text(archives[0]![0]), retained = archivedRequest(db, id), request = retained.request;
  if (JSON.stringify(before.old) !== JSON.stringify([request.libraryId, request.authorityEpochId,
    request.actorId, request.actorPublicKey, request.enrollmentRequestDigest, request.canonicalEnrollmentRequestJson, request.createdAt])) {
    throw new Error("previous consumer recovery receipt differs from the retained actor");
  }
  // Previous live rows have changed legitimately. Historical archive bytes must not have.
  verifyPwaRecoveryArchiveWithStorageAdmission(db, capi, id, false, admitStorage);
  db.exec({ sql: `DELETE FROM library_local_handoff WHERE singleton_id = 1
    AND installation_role = 'consumer' AND phase = 'following'
    AND library_id = ?1 AND successor_epoch_id = ?2 AND updated_at <= ?3;`,
    bind: [text(before.old[0]), text(before.old[1]), createdAt] });
  if (db.changes() !== 1) throw new Error("consumer completed lifecycle changed before archival");
}

/** Persist the archive and exact replacement request together, without clearing active slots. */
export async function preparePwaConsumerRecovery(db: Database, capi: CAPI, subtle: SubtleCrypto, authority: Authority,
  recoveryId: string, input: LibraryCoreStoreFollowerActorRequestV2): Promise<void> {
  return preparePwaConsumerRecoveryWithStorageAdmission(db, capi, subtle, authority, recoveryId, input);
}

/** Internal schema admission hook; successor proof, fencing and archive transaction stay shared. */
export async function preparePwaConsumerRecoveryWithStorageAdmission(
  db: Database, capi: CAPI, subtle: SubtleCrypto, authority: Authority,
  recoveryId: string, input: LibraryCoreStoreFollowerActorRequestV2, admitStorage?: () => void,
): Promise<void> {
  if (!isLibraryCoreLowercaseHex64(recoveryId)) throw new Error("consumer recovery identity is invalid");
  input = parseLibraryCoreStoreFollowerActorRequestV2(input);
  const before = candidate(db, authority);
  if (before.id !== recoveryId) throw new Error("consumer recovery identity changed");
  const proof = await verifySuccessor(before, authority, subtle);
  const verified = await verifyPwaFollowerActorRequest(input, authority, subtle);
  const enrollment = verified.enrollment;
  if (enrollment.actor_incarnation_nonce !== recoveryId || enrollment.actor_id === before.old[2] ||
      enrollment.actor_public_key !== before.old[3] || enrollment.installation_incarnation !== before.installation) {
    throw new Error("consumer recovery requires a new incarnation of its retained key");
  }
  const receipt = canonical({ libraryId: authority.library_id, authorityEpochId: authority.epoch_id,
    actorId: enrollment.actor_id, actorPublicKey: enrollment.actor_public_key,
    enrollmentRequestDigest: verified.requestDigest, canonicalEnrollmentRequestJson: utf8.decode(verified.request.canonicalRequestBytes),
    createdAt: verified.request.createdAt }, 131_072);
  if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer) !== 1) throw new Error("consumer recovery transaction is already active");
  db.transaction("IMMEDIATE", () => {
    if (candidate(db, authority).snapshot !== before.snapshot) throw new Error("consumer recovery changed during verification");
    if (admitStorage) admitStorage();
    else migratePwaLibraryRecoverySchema(db, capi);
    const fences = rows(db, "SELECT installation_role, phase, handoff_id FROM library_local_handoff WHERE singleton_id = 1;");
    if (fences.length) {
      if (fences.length === 1 && fences[0]![0] === "consumer" && fences[0]![1] === "following") {
        retireCompletedConsumerCycle(db, capi, before, verified.request.createdAt, admitStorage);
      } else {
        if (fences.length !== 1 || fences[0]![0] !== "consumer" || fences[0]![1] !== "recovery" || fences[0]![2] !== proof.handoffId) {
          throw new Error("consumer recovery cannot replace another lifecycle fence");
        }
        const retained = archivedRequest(db, recoveryId);
        if (retained.row[2] !== null || retained.row[1] !== sha256LowerHex(receipt) || retained.row[7] !== before.installation) {
          throw new Error("consumer recovery prepared replay changed");
        }
        verifyPwaRecoveryArchiveWithStorageAdmission(db, capi, recoveryId, true, admitStorage);
        return;
      }
    }
    db.exec({ sql: `INSERT INTO library_local_handoff (singleton_id, handoff_id, library_id, installation_role, phase,
      predecessor_epoch_id, successor_epoch_id, target_writer_id, target_authority_public_key, canonical_readiness,
      canonical_authorization_body, canonical_authorization, expected_control_revision, created_at, updated_at)
      VALUES (1, ?1, ?2, 'consumer', 'recovery', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11);`,
      bind: [proof.handoffId, authority.library_id, text(before.old[1]), authority.epoch_id, proof.writerId, proof.authorityPublicKey,
        canonical(before.readiness), canonical(before.grantBody), canonical(before.grant), text(before.grantBody.source_control_revision), verified.request.createdAt] });
    // Browsers retain the installation incarnation directly. That stable local
    // identity is the witness here; it is not synchronized or written to the key vault.
    db.exec({ sql: `INSERT INTO library_local_recovery_archives
      (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at,
       reenrollment_receipt, reenrollment_digest, reenrollment_installation_witness)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11);`,
      bind: [recoveryId, authority.library_id, text(before.old[1]), authority.epoch_id, text(before.old[2]),
        LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, "0".repeat(64), verified.request.createdAt, receipt, sha256LowerHex(receipt), before.installation] });
    archivePwaFollowerRowsWithStorageAdmission(db, capi, recoveryId, admitStorage);
    if (archivedRequest(db, recoveryId).row[1] !== sha256LowerHex(receipt)) throw new Error("consumer recovery receipt readback changed");
  });
}

/** Explicitly retire archived slots and install the persisted request in one transaction. */
export async function commitPwaConsumerRecovery(db: Database, capi: CAPI, subtle: SubtleCrypto, authority: Authority,
  recoveryId: string, committedAt: number): Promise<void> {
  return commitPwaConsumerRecoveryWithLocalProjection(db,capi,subtle,authority,recoveryId,committedAt);
}

/** Internal storage adapter hook. Proof verification and archive checks stay shared. */
export async function commitPwaConsumerRecoveryWithLocalProjection(
  db: Database, capi: CAPI, subtle: SubtleCrypto, authority: Authority,
  recoveryId: string, committedAt: number,
  projection?: { before(): void; admitArchiveStorage(): void; after(fresh: boolean): void },
): Promise<void> {
  if (!isLibraryCoreLowercaseHex64(recoveryId) || !isLibraryCoreNonnegativeSafeInteger(committedAt)) throw new Error("consumer recovery commit identity is invalid");
  const before = archivedRequest(db, recoveryId);
  const verified = await verifyPwaFollowerActorRequest(before.input, authority, subtle);
  const enrollment = verified.enrollment, request = before.request;
  if (request.libraryId !== authority.library_id || request.authorityEpochId !== authority.epoch_id ||
      request.actorId !== enrollment.actor_id || request.actorPublicKey !== enrollment.actor_public_key ||
      request.enrollmentRequestDigest !== verified.requestDigest || enrollment.actor_incarnation_nonce !== recoveryId ||
      enrollment.installation_incarnation !== before.row[7] || verified.request.createdAt > committedAt) {
    throw new Error("consumer recovery prepared signing identity changed");
  }
  // On retry, the new request is already active. The persisted receipt is the exact result.
  const pending = before.row[2] === null;
  const old = pending ? candidate(db, authority) : null;
  if (old) {
    if (old.id !== recoveryId || enrollment.actor_public_key !== old.old[3] || enrollment.actor_id === old.old[2]) throw new Error("consumer recovery old actor changed");
    await verifySuccessor(old, authority, subtle);
  }
  if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer) !== 1) throw new Error("consumer recovery transaction is already active");
  db.transaction("IMMEDIATE", () => {
    projection?.before();
    selected(db, authority);
    const current = archivedRequest(db, recoveryId);
    if (JSON.stringify(current.row) !== JSON.stringify(before.row) || (old && candidate(db, authority).snapshot !== old.snapshot)) {
      throw new Error("consumer recovery changed before commit");
    }
    const fence = rows(db, `SELECT phase, updated_at FROM library_local_handoff
      WHERE singleton_id = 1 AND installation_role = 'consumer' AND library_id = ?1
        AND predecessor_epoch_id = ?2 AND successor_epoch_id = ?3;`,
      [authority.library_id, text(before.row[4]), authority.epoch_id]);
    if (fence.length !== 1 || fence[0]![0] !== (pending ? "recovery" : "following") || integer(fence[0]![1]) > committedAt) {
      throw new Error("consumer recovery lifecycle changed");
    }
    verifyPwaRecoveryArchiveWithStorageAdmission(db, capi, recoveryId, pending, projection?.admitArchiveStorage);
    if (pending) {
      db.exec(`DELETE FROM library_optimistic_fields;
        DELETE FROM library_result_transport_segments; DELETE FROM library_result_transport_heads;
        DELETE FROM library_intent_transport_segments; DELETE FROM library_intent_transport_heads;
        DELETE FROM library_intent_results; DELETE FROM library_intent_result_cursors;
        DELETE FROM library_intent_members; DELETE FROM library_intent_transactions;
        DELETE FROM library_intent_actors; DELETE FROM library_follower_actor_request;`);
      db.exec({ sql: `INSERT INTO library_follower_actor_request (singleton_id, library_id, authority_epoch_id, actor_id,
        actor_public_key, enrollment_request_digest, canonical_enrollment_request, created_at)
        VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7);`,
        bind: [authority.library_id, authority.epoch_id, enrollment.actor_id, enrollment.actor_public_key,
          verified.requestDigest, text(request.canonicalEnrollmentRequestJson), verified.request.createdAt] });
      db.exec({ sql: "UPDATE library_local_recovery_archives SET reenrollment_committed_at = ?2 WHERE recovery_id = ?1;", bind: [recoveryId, committedAt] });
      db.exec({ sql: "UPDATE library_local_handoff SET phase = 'following', updated_at = ?1 WHERE singleton_id = 1;", bind: [committedAt] });
    }
    const active = rows(db, `SELECT actor_id, actor_public_key, enrollment_request_digest, canonical_enrollment_request, created_at
      FROM library_follower_actor_request WHERE singleton_id = 1 AND library_id = ?1 AND authority_epoch_id = ?2;`, [authority.library_id, authority.epoch_id]);
    if (JSON.stringify(active) !== JSON.stringify([[enrollment.actor_id, enrollment.actor_public_key, verified.requestDigest,
      request.canonicalEnrollmentRequestJson, verified.request.createdAt]])) throw new Error("consumer recovery commit readback changed");
    projection?.after(pending);
  });
}
