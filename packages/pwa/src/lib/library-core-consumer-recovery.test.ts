import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static, type SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  parseLibraryCoreRecoveryIntentPageRequestV1,
  parseLibraryCoreRecoveryArchivePageRequestV1,
  constructLibraryCoreActorCapabilityRequestV2, constructLibraryCoreActorEnrollmentBodyV1,
  encodeLibraryCoreCanonicalValue, encodeLibraryCoreDigestInput,
  LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2, LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, sha256LowerHex,
  type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain,
} from "@freed/shared/library-core";
import chain from "../../../shared/src/library-core/handoff-chain-vectors-v1.json";
const vector = chain[0]!;
import { migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
import { archivePwaFollowerRows } from "./library-core-recovery-archive";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";

const digest = (domain: LibraryCoreDigestDomain, value: unknown) => sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue));
const hex = "6".repeat(64), installation = "7".repeat(64);
const certificate = JSON.parse(vector.canonicalCertificate);
const next = vector.expected, old = vector.predecessor;
const targetId: string = certificate.certificate_body.target_writer_id;
const revision: number = certificate.certificate_body.handoff_authorization.body.final_source_revision;

// Signed authority/enrollment proofs are real; pending intent bytes below test storage retention only.
describe("browser explicit consumer recovery", () => {
  let sqlite: Sqlite3Static, db: Database, engine: PwaLibraryCoreSqliteEngine;
  let keys: ReturnType<typeof generateKeyPairSync>, publicKey: string, actorId: string;
  function insert(table: string, row: Record<string, SqlValue>) {
    db.exec({ sql: `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")});`, bind: Object.values(row) });
  }
  async function request(epochId: string, epoch: number, keyId: string, nonce: string, at: number) {
    const body = constructLibraryCoreActorEnrollmentBodyV1({
      actor_incarnation_nonce: nonce, actor_public_key: publicKey, authority_key_id: keyId, created_at_ms: at,
      epoch, epoch_id: epochId, installation_incarnation: installation, library_id: old.libraryId,
      observed_frontier: [], operation_id: `enrollment-${nonce.slice(0, 16)}`,
    }, { digest });
    const signed = await constructLibraryCoreActorCapabilityRequestV2(body, {
      actor_class: "editor", allowed_operation_types: LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
      allowed_query_ids: [], scope: { mode: "library_wide" },
    }, { digest, signActorProof: async message => sign(null, message, keys.privateKey).toString("hex") });
    return { actorId: body.body.actor_id, digest: signed.request.certificate_digest,
      input: { canonicalRequestBytes: encodeLibraryCoreCanonicalValue(signed.request as unknown as LibraryCoreCanonicalValue), createdAt: at } };
  }
  beforeEach(async () => {
    sqlite = await sqlite3InitModule(); db = new sqlite.oo1.DB(":memory:", "c");
    engine = new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion, { capi: sqlite.capi }); engine.initialize();
    keys = generateKeyPairSync("ed25519");
    publicKey = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const original = await request(old.epochId, old.epoch, hex, "8".repeat(64), 1); actorId = original.actorId;
    for (const [id, number, keyId, key, certDigest, cert] of [
      [old.epochId, old.epoch, hex, old.authorityPublicKey, old.certificateDigest, "{}"],
      [next.epochId, old.epoch + 1, next.authorityKeyId, next.authorityPublicKey, next.certificateDigest, vector.canonicalCertificate],
    ] as const) insert("library_authority_epochs", { epoch_id: id, library_id: old.libraryId, epoch_number: number,
      authority_key_id: keyId, authority_public_key: key, transition_certificate_digest: certDigest,
      canonical_transition_certificate: cert, accepted_manifest_generation: 0, checkpoint_frontier_digest: hex,
      materialized_state_digest: hex, accepted_at: 1 });
    for (const [id, epoch, kind, key] of [[actorId, old.epochId, "pwa", publicKey], [targetId, next.epochId, "desktop", vector.enrolledActorPublicKey]]) {
      insert("library_actors", { actor_id: id!, authority_epoch_id: epoch!, actor_kind: kind!, public_key: key!,
        enrollment_operation_id: "enrollment", enrollment_certificate_digest: hex, canonical_enrollment_certificate: "{}",
        chain_genesis_digest: hex, accepted_counter: 0, accepted_operation_id: null, accepted_chain_digest: hex,
        retired_at: null, created_at: 1, updated_at: 1 });
    }
    insert("library_meta", { singleton_id: 1, library_id: old.libraryId, schema_version: 1, authority_epoch: next.epochId, source_revision: revision, updated_at: 2 });
    insert("library_active_authority", { active_key: "active", library_id: old.libraryId, epoch_id: next.epochId,
      writer_id: targetId, accepted_manifest_generation: 0, activated_at: 2 });
    insert("library_follower_checkpoint_receipt", { singleton_id: 1, library_id: old.libraryId, authority_epoch_id: next.epochId,
      writer_actor_id: targetId, checkpoint_generation: 0, source_revision: revision, checkpoint_digest: hex,
      manifest_object_key: "manifest", manifest_transport_object_id: "file", manifest_content_digest: hex, control_revision: '"revision"', installed_at: 2 });
    insert("library_follower_actor_request", { singleton_id: 1, library_id: old.libraryId, authority_epoch_id: old.epochId,
      actor_id: actorId, actor_public_key: publicKey, enrollment_request_digest: original.digest,
      canonical_enrollment_request: new TextDecoder().decode(original.input.canonicalRequestBytes), created_at: 1 });
    insert("library_intent_actors", { actor_id: actorId, next_counter: 2, previous_operation_id: "offline", previous_chain_digest: hex });
    insert("library_intent_transactions", { transaction_id: "offline-edit", transaction_digest: hex, actor_id: actorId,
      intent_epoch: old.epoch, intent_epoch_id: old.epochId, member_count: 1, first_counter: 1, last_counter: 1,
      previous_operation_id: null, previous_chain_digest: hex, ending_operation_id: "offline", ending_chain_digest: hex,
      canonical_member_bytes: 2, canonical_transaction: new Uint8Array([123, 125]), state: "pending", created_at: 1,
      published_at: null, resolved_at: null });
  });
  afterEach(() => { if (db.isOpen()) db.close(); });
  const oldSlots = () => db.exec({ sql: "SELECT * FROM library_follower_actor_request;", rowMode: "array", returnValue: "resultRows" });
  // Synthetic completed local ledger exercises reuse admission, not a second signed transfer.
  function priorCycle() {
    const priorId = "9".repeat(64), priorEpoch = "a".repeat(64);
    const live = db.exec({ sql: `SELECT library_id, authority_epoch_id, actor_id, actor_public_key,
      enrollment_request_digest, canonical_enrollment_request, created_at FROM library_follower_actor_request;`,
      rowMode: "array", returnValue: "resultRows" })[0]!;
    const receipt = encodeLibraryCoreCanonicalValue({ libraryId: live[0], authorityEpochId: live[1], actorId: live[2],
      actorPublicKey: live[3], enrollmentRequestDigest: live[4], canonicalEnrollmentRequestJson: live[5], createdAt: live[6] } as LibraryCoreCanonicalValue);
    db.transaction("IMMEDIATE", () => {
      migratePwaLibraryRecoverySchema(db, sqlite.capi);
      insert("library_local_handoff", { singleton_id: 1, handoff_id: priorId, library_id: old.libraryId,
        installation_role: "consumer", phase: "following", predecessor_epoch_id: priorEpoch, successor_epoch_id: old.epochId,
        target_writer_id: old.writerId, target_authority_public_key: old.authorityPublicKey,
        canonical_readiness: new Uint8Array([123, 125]), canonical_authorization_body: new Uint8Array([123, 125]),
        expected_control_revision: '"prior"', created_at: 1, updated_at: 2 });
      insert("library_local_recovery_archives", { recovery_id: priorId, library_id: old.libraryId,
        predecessor_epoch_id: priorEpoch, successor_epoch_id: old.epochId, actor_id: hex,
        schema_sha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, row_count: 0, archive_digest: "0".repeat(64),
        created_at: 1, reenrollment_committed_at: 2, reenrollment_receipt: receipt,
        reenrollment_digest: sha256LowerHex(receipt), reenrollment_installation_witness: installation });
      archivePwaFollowerRows(db, sqlite.capi, priorId);
    });
    return priorId;
  }
  it("reuses only a completed matching cycle and rolls back its retirement with failed archival", async () => {
    const priorId = priorCycle(), before = oldSlots(), plan = engine.consumerRecoveryPlan();
    const previousRows = db.exec({ sql: "SELECT * FROM library_local_recovery_rows;", rowMode: "array", returnValue: "resultRows" });
    const prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    db.exec("CREATE TEMP TRIGGER fail_next_archive BEFORE INSERT ON library_local_recovery_archives BEGIN SELECT RAISE(ABORT, 'next archive fault'); END;");
    await expect(engine.prepareConsumerRecovery(plan.recoveryId, prepared.input)).rejects.toThrow(/next archive fault/);
    expect(db.selectValue("SELECT phase FROM library_local_handoff;")).toBe("following");
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_archives;")).toBe(1);
    expect(oldSlots()).toEqual(before);
    db.exec("DROP TRIGGER fail_next_archive;");
    await engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    expect(db.selectValue("SELECT phase FROM library_local_handoff;")).toBe("recovery");
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_archives;")).toBe(2);
    expect(db.exec({ sql: "SELECT * FROM library_local_recovery_rows WHERE recovery_id = ?1;", bind: [priorId],
      rowMode: "array", returnValue: "resultRows" })).toEqual(previousRows);
    await engine.commitConsumerRecovery(plan.recoveryId, 11);
    expect(engine.consumerRecoveryStatus()).toMatchObject({ state: "following", plan: { recoveryId: plan.recoveryId } });
  });
  it.each(["receipt", "archive", "time", "unfinished"])("preserves a previous cycle when its %s proof fails", async failure => {
    priorCycle();
    const plan = engine.consumerRecoveryPlan();
    const prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    if (failure === "receipt") db.exec("UPDATE library_follower_actor_request SET created_at = 3;");
    if (failure === "archive") db.exec("UPDATE library_local_recovery_rows SET canonical_row = X'5b5d' WHERE table_key = 'library_intent_transactions';");
    if (failure === "time") db.exec("UPDATE library_local_handoff SET updated_at = 20;");
    if (failure === "unfinished") db.exec("UPDATE library_local_recovery_archives SET reenrollment_committed_at = NULL;");
    const before = oldSlots();
    await expect(engine.prepareConsumerRecovery(plan.recoveryId, prepared.input)).rejects.toThrow(/retained actor|archive row|lifecycle/);
    expect(db.selectValue("SELECT phase FROM library_local_handoff;")).toBe("following");
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_archives;")).toBe(1);
    expect(oldSlots()).toEqual(before);
  });
  it("pages archive metadata with lifecycle and source fencing without changing stored rows", async () => {
    const parse = (cursor: string | null = null) => {
      const value = parseLibraryCoreRecoveryArchivePageRequestV1({ queryId: "recovery_archive_page_v1", schemaVersion: 1,
        cancellationId: "archive-read", readerSessionId: "archive-reader", cursor, limit: 1 });
      if (!value.ok) throw new Error(value.error); return value.value;
    };
    expect(() => engine.query(parse())).toThrow(/storage version/);
    const plan = engine.consumerRecoveryPlan(), prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    await engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    insert("library_materialization_generation", { singleton_id: 1, generation_id: hex });
    db.exec({ sql: "UPDATE library_change_state SET revision = ?1;", bind: [revision] });
    db.exec({ sql: `INSERT INTO library_local_recovery_archives SELECT ?1, library_id, predecessor_epoch_id, successor_epoch_id,
      actor_id, schema_sha256, row_count, pending_intent_count, published_intent_count, archive_digest, created_at,
      reenrollment_committed_at, reenrollment_receipt, reenrollment_digest, reenrollment_installation_witness
      FROM library_local_recovery_archives WHERE recovery_id = ?2;`, bind: ["f".repeat(64), plan.recoveryId] });
    const changes = db.changes(true), first = engine.query(parse());
    expect(first.rows).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
    const second = engine.query(parse(first.nextCursor));
    expect(second.rows).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(first.rows[0]!.recoveryId < second.rows[0]!.recoveryId).toBe(true);
    expect(db.changes(true)).toBe(changes);
    db.exec("UPDATE library_local_handoff SET handoff_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';");
    expect(() => engine.query(parse(first.nextCursor))).toThrow(/CURSOR_STALE/);
    db.exec({sql:"UPDATE library_local_handoff SET handoff_id = ?1;",bind:[first.handoffId]});
    db.exec("UPDATE library_materialization_generation SET generation_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';");
    expect(() => engine.query(parse(first.nextCursor))).toThrow(/CURSOR_STALE/);
    db.exec({sql:"UPDATE library_materialization_generation SET generation_id = ?1;",bind:[hex]});
    db.exec("UPDATE library_local_recovery_archives SET library_id = 'other' WHERE recovery_id = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';");
    expect(() => engine.query(parse())).toThrow(/archive row is invalid/);
  });
  it("pages preserved transaction identities without treating metadata as verified edits", async () => {
    const plan = engine.consumerRecoveryPlan();
    const parse = (cursor: string | null = null) => {
      const value = parseLibraryCoreRecoveryIntentPageRequestV1({ queryId: "recovery_intent_page_v1", schemaVersion: 1,
        recoveryId: plan.recoveryId, cancellationId: "intent-read", readerSessionId: "intent-reader", cursor, limit: 1 });
      if (!value.ok) throw new Error(value.error); return value.value;
    };
    expect(() => engine.query(parse())).toThrow(/storage version/);
    const prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    await engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    insert("library_materialization_generation", { singleton_id: 1, generation_id: hex });
    db.exec({ sql: "UPDATE library_change_state SET revision = ?1;", bind: [revision] });
    // The index is discovery metadata. This second row is deliberately not a valid signed transaction.
    db.exec({ sql: `INSERT INTO library_local_recovery_rows SELECT recovery_id, table_key, row_ordinal + 1,
      'second-edit', columns_json, canonical_row, row_digest FROM library_local_recovery_rows
      WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';`, bind: [plan.recoveryId] });
    const changes = db.changes(true), first = engine.query(parse());
    expect(first.rows).toEqual([{ ordinal: 0, transactionId: "offline-edit" }]);
    expect(first.nextCursor).not.toBeNull();
    expect(engine.query(parse(first.nextCursor)).rows).toEqual([{ ordinal: 1, transactionId: "second-edit" }]);
    expect(db.changes(true)).toBe(changes);
    db.exec("UPDATE library_local_recovery_archives SET archive_digest = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';");
    expect(() => engine.query(parse(first.nextCursor))).toThrow(/CURSOR_STALE/);
    db.exec({ sql: "UPDATE library_local_recovery_archives SET archive_digest = ?1;", bind: [first.archiveDigest] });
    db.exec("UPDATE library_materialization_generation SET generation_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';");
    expect(() => engine.query(parse(first.nextCursor))).toThrow(/CURSOR_STALE/);
    db.exec({ sql: "UPDATE library_materialization_generation SET generation_id = ?1;", bind: [hex] });
    db.exec("UPDATE library_local_recovery_rows SET transaction_id = 'offline-edit' WHERE table_key = 'library_intent_transactions' AND row_ordinal = 1;");
    expect(() => engine.query(parse())).toThrow(/ordering or identity/);
    expect(() => db.exec("UPDATE library_local_recovery_rows SET transaction_id = '' WHERE table_key = 'library_intent_transactions' AND row_ordinal = 1;")).toThrow(/CHECK constraint/);
    db.exec("UPDATE library_local_recovery_archives SET library_id = 'another-library';");
    expect(() => engine.query(parse())).toThrow(/archive digest/);
  });
  it("archives before explicit slot retirement, resumes exact requests, and commits once after restart", async () => {
    const before = oldSlots(), plan = engine.consumerRecoveryPlan();
    expect(engine.consumerRecoveryStatus()).toMatchObject({ state: "required", pendingIntentCount: 1 });
    const prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    await engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    expect(oldSlots()).toEqual(before);
    expect(engine.consumerRecoveryStatus()).toMatchObject({ state: "prepared", plan: { preparedRequest: prepared.input } });
    expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(1);
    expect(db.selectValue("SELECT pending_intent_count FROM library_local_recovery_archives;")).toBe(1);
    const archive = db.exec({ sql: "SELECT * FROM library_local_recovery_rows ORDER BY table_key, row_ordinal;", rowMode: "array", returnValue: "resultRows" });
    const changed = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 11);
    await expect(engine.prepareConsumerRecovery(plan.recoveryId, changed.input)).rejects.toThrow(/replay changed/);

    const changes = db.changes(true);
    await engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    expect(db.changes(true)).toBe(changes);
    // Model the selected rows after a verified same-successor checkpoint refresh.
    // This checks recovery admission, not checkpoint transport or OPFS persistence.
    db.transaction("IMMEDIATE", () => {
      db.exec({ sql: "UPDATE library_meta SET source_revision = ?1;", bind: [revision + 1] });
      db.exec({ sql: `UPDATE library_follower_checkpoint_receipt SET source_revision = ?1,
        checkpoint_generation = checkpoint_generation + 1, checkpoint_digest = ?2;`,
        bind: [revision + 1, "b".repeat(64)] });
    });
    engine = new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion, { capi: sqlite.capi }); engine.initialize();
    expect(engine.consumerRecoveryPlan().preparedRequest).toEqual(prepared.input);
    const refreshedChanges = db.changes(true);
    await engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    expect(db.changes(true)).toBe(refreshedChanges);
    expect(db.exec({ sql: "SELECT * FROM library_local_recovery_rows ORDER BY table_key, row_ordinal;", rowMode: "array", returnValue: "resultRows" })).toEqual(archive);
    db.exec("CREATE TEMP TRIGGER fail_recovery_slot BEFORE INSERT ON library_follower_actor_request BEGIN SELECT RAISE(ABORT, 'slot fault'); END;");
    await expect(engine.commitConsumerRecovery(plan.recoveryId, 11)).rejects.toThrow(/slot fault/);
    expect(oldSlots()).toEqual(before);
    expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(1);
    db.exec("DROP TRIGGER fail_recovery_slot;");
    await engine.commitConsumerRecovery(plan.recoveryId, 11);
    expect(engine.followerActorEnrollmentContext().request?.actorId).toBe(prepared.actorId);
    expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(0);
    expect(db.exec({ sql: "SELECT * FROM library_local_recovery_rows ORDER BY table_key, row_ordinal;", rowMode: "array", returnValue: "resultRows" })).toEqual(archive);
    const committedChanges = db.changes(true);
    await engine.commitConsumerRecovery(plan.recoveryId, 12);
    expect(db.changes(true)).toBe(committedChanges);
    expect(engine.consumerRecoveryStatus()).toMatchObject({ state: "following", pendingIntentCount: 1, plan: { recoveryId: plan.recoveryId, oldActorId: actorId } });
    db.exec("UPDATE library_follower_actor_request SET created_at = 99;");
    expect(() => engine.consumerRecoveryStatus()).toThrow(/differs from its receipt/);
    expect(() => engine.followerMutationContext()).toThrow(/unavailable/);
  });
  it("completes recovery through two native-signed successors without overwriting the first archive", async () => {
    const first = engine.consumerRecoveryPlan();
    const enrolled = await request(next.epochId, old.epoch + 1, next.authorityKeyId, first.recoveryId, 10);
    await engine.prepareConsumerRecovery(first.recoveryId, enrolled.input);
    await engine.commitConsumerRecovery(first.recoveryId, 11);
    const historical = db.exec({ sql: "SELECT * FROM library_local_recovery_rows ORDER BY table_key, row_ordinal;", rowMode: "array", returnValue: "resultRows" });
    const second = chain[1]!, body = JSON.parse(second.canonicalCertificate).certificate_body;
    const writer: string = body.target_writer_id;
    // Install the already-verified fixture's selected rows. Checkpoint transport is tested separately.
    insert("library_authority_epochs", { epoch_id: second.expected.epochId, library_id: old.libraryId,
      epoch_number: second.predecessor.epoch + 1, authority_key_id: second.expected.authorityKeyId,
      authority_public_key: second.expected.authorityPublicKey, transition_certificate_digest: second.expected.certificateDigest,
      canonical_transition_certificate: second.canonicalCertificate, accepted_manifest_generation: 0,
      checkpoint_frontier_digest: hex, materialized_state_digest: hex, accepted_at: 20 });
    insert("library_actors", { actor_id: writer, authority_epoch_id: second.expected.epochId, actor_kind: "desktop",
      public_key: second.enrolledActorPublicKey, enrollment_operation_id: "return", enrollment_certificate_digest: hex,
      canonical_enrollment_certificate: "{}", chain_genesis_digest: hex, accepted_counter: 0,
      accepted_operation_id: null, accepted_chain_digest: hex, retired_at: null, created_at: 20, updated_at: 20 });
    db.exec({ sql: "UPDATE library_meta SET authority_epoch = ?1, source_revision = ?2;",
      bind: [second.expected.epochId, body.handoff_authorization.body.final_source_revision] });
    db.exec({ sql: "UPDATE library_active_authority SET epoch_id = ?1, writer_id = ?2;", bind: [second.expected.epochId, writer] });
    db.exec({ sql: "UPDATE library_follower_checkpoint_receipt SET authority_epoch_id = ?1, writer_actor_id = ?2;", bind: [second.expected.epochId, writer] });
    engine = new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion, { capi: sqlite.capi }); engine.initialize();
    // Match the selected checkpoint's materialization source before reading old archives.
    insert("library_materialization_generation", { singleton_id: 1, generation_id: hex });
    db.exec({ sql: "UPDATE library_change_state SET revision = ?1;", bind: [body.handoff_authorization.body.final_source_revision] });
    expect(engine.consumerRecoveryStatus().state).toBe("required");
    const archiveRequest = parseLibraryCoreRecoveryArchivePageRequestV1({ queryId: "recovery_archive_page_v1", schemaVersion: 1,
      cursor: null, limit: 8, cancellationId: "old-archive-read", readerSessionId: "old-archive-reader" });
    if (!archiveRequest.ok) throw new Error(archiveRequest.error);
    const beforeRead = db.changes(true);
    const archives = engine.query(archiveRequest.value);
    expect(archives.rows.map(row => row.recoveryId)).toEqual([first.recoveryId]);
    const intentRequest = parseLibraryCoreRecoveryIntentPageRequestV1({ queryId: "recovery_intent_page_v1", schemaVersion: 1,
      recoveryId: first.recoveryId, cursor: null, limit: 8, cancellationId: "old-intent-read", readerSessionId: "old-intent-reader" });
    if (!intentRequest.ok) throw new Error(intentRequest.error);
    expect(engine.query(intentRequest.value).rows).toHaveLength(1);
    expect(db.changes(true)).toBe(beforeRead);
    const following = engine.consumerRecoveryPlan();
    expect(following.recoveryId).not.toBe(first.recoveryId);
    expect(following.oldActorId).toBe(enrolled.actorId);
    const replacement = await request(second.expected.epochId, second.predecessor.epoch + 1,
      second.expected.authorityKeyId, following.recoveryId, 30);
    await engine.prepareConsumerRecovery(following.recoveryId, replacement.input);
    await engine.commitConsumerRecovery(following.recoveryId, 31);
    expect(engine.consumerRecoveryStatus()).toMatchObject({ state: "following", plan: { recoveryId: following.recoveryId } });
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_archives;")).toBe(2);
    expect(db.exec({ sql: "SELECT * FROM library_local_recovery_rows WHERE recovery_id = ?1 ORDER BY table_key, row_ordinal;",
      bind: [first.recoveryId], rowMode: "array", returnValue: "resultRows" })).toEqual(historical);
    const changes = db.changes(true);
    await engine.commitConsumerRecovery(following.recoveryId, 32);
    expect(db.changes(true)).toBe(changes);
  });
  it("rejects a trusted-state change during signature verification without archiving", async () => {
    const plan = engine.consumerRecoveryPlan();
    const prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    const pending = engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    db.exec("UPDATE library_follower_checkpoint_receipt SET checkpoint_generation = 1;");
    await expect(pending).rejects.toThrow(/changed during verification/);
    expect(db.selectValue("PRAGMA user_version;")).toBe(1);
    expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(1);
  });
  it("refuses a damaged archive before retiring any active slot", async () => {
    const plan = engine.consumerRecoveryPlan(), before = oldSlots();
    const prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    await engine.prepareConsumerRecovery(plan.recoveryId, prepared.input);
    db.exec("UPDATE library_local_recovery_rows SET canonical_row = X'5b5d' WHERE table_key = 'library_intent_transactions';");
    await expect(engine.commitConsumerRecovery(plan.recoveryId, 11)).rejects.toThrow(/archive row changed/);
    expect(oldSlots()).toEqual(before);
    expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(1);
  });
  it("rolls back schema and old slots when migration fails", async () => {
    const plan = engine.consumerRecoveryPlan(), before = oldSlots();
    const prepared = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    db.exec("CREATE TEMP TRIGGER fail_schema_identity BEFORE UPDATE ON library_storage_meta BEGIN SELECT RAISE(ABORT, 'migration fault'); END;");
    await expect(engine.prepareConsumerRecovery(plan.recoveryId, prepared.input)).rejects.toThrow(/migration fault/);
    expect(db.selectValue("PRAGMA user_version;")).toBe(1);
    expect(oldSlots()).toEqual(before);
    expect(db.selectValue("SELECT count(*) FROM sqlite_schema WHERE name = 'library_local_recovery_rows';")).toBe(0);
  });
  it("refuses a different key or nonce before archiving", async () => {
    const plan = engine.consumerRecoveryPlan(), before = oldSlots();
    const wrongNonce = await request(next.epochId, old.epoch + 1, next.authorityKeyId, "9".repeat(64), 10);
    await expect(engine.prepareConsumerRecovery(plan.recoveryId, wrongNonce.input)).rejects.toThrow(/incarnation/);
    keys = generateKeyPairSync("ed25519");
    publicKey = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const wrongKey = await request(next.epochId, old.epoch + 1, next.authorityKeyId, plan.recoveryId, 10);
    await expect(engine.prepareConsumerRecovery(plan.recoveryId, wrongKey.input)).rejects.toThrow(/retained key/);
    expect(oldSlots()).toEqual(before);
    expect(db.selectValue("PRAGMA user_version;")).toBe(1);
  });
});
