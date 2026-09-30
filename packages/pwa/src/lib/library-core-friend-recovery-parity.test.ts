import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import sqlite3InitModule, { type Database, type SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  decodeLibraryCoreCanonicalBase64, decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalBase64,
  encodeLibraryCoreCanonicalValue, encodeLibraryCoreDigestInput, encodeLibraryCoreOperationSignatureInput,
  sha256LowerHex, constructLibraryCoreActorEnrollmentBodyV1, constructLibraryCoreActorEnrollmentCertificateV1,
  constructLibraryCoreArchivedFriendMemberV1, assembleLibraryCoreArchivedFriendV1,
  constructLibraryCoreHistoricalPreferencesMemberV1, assembleLibraryCoreHistoricalPreferencesV1,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA, ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA, FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA, assembleLibraryCoreTransactionV1, finalizeLibraryCoreTransactionV1,
  parseLibraryCoreRecoveryIntentReviewRequestV1, parseLibraryCoreReapplyConsumerIntentV1, type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain,
} from "@freed/shared/library-core";
import vector from "../../../shared/src/library-core/friend-recovery-native-vector-v1.json";
import { migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";

// Native Friend vector plus generated certified historical Friend and Account
// and reach-out archives. Successor admission is synthetic; this does not prove cloud handoff
// or OPFS durability.
it.each(["native", "historical PWA", "Account upsert", "Reach-out", "Preferences", "Historical preferences"] as const)("verifies %s recovery signatures, refuses unsafe replacements and resolves exact retry", async mode => {
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB(":memory:", "c");
  try {
    const engine = new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion, { capi: sqlite.capi });
    engine.initialize();
    db.transaction("IMMEDIATE", () => migratePwaLibraryRecoverySchema(db, sqlite.capi));
    db.exec("PRAGMA foreign_keys = OFF;");
    for (const [table, { columns, rows }] of Object.entries(vector.tables)) {
      for (const cells of rows) {
        const values: SqlValue[] = cells.map(([kind, value]) => {
          if (kind === "null") return null;
          if (kind === "integer") return Number(value);
          if (kind === "text") return new TextDecoder().decode(decodeLibraryCoreCanonicalBase64(value!));
          if (kind === "blob") return decodeLibraryCoreCanonicalBase64(value!);
          throw new Error("Unsupported fixture cell");
        });
        db.exec({ sql: `INSERT OR REPLACE INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")});`, bind: values });
      }
    }
    db.exec("PRAGMA foreign_keys = ON;");
    // Native fixture admission and browser checkpoint admission use different
    // local receipts. Supply the synthetic accepted browser checkpoint explicitly.
    db.exec({ sql: `INSERT INTO library_follower_checkpoint_receipt SELECT 1, library_id, authority_epoch, ?1, 1,
      source_revision, ?2, 'manifest', 'transport', ?2, 'control', 1100 FROM library_meta;`,
      bind: [vector.receipt.replacementActorId, "6".repeat(64)] });
    const alternate: { value?: ReturnType<typeof parseLibraryCoreReapplyConsumerIntentV1> } = {};
    const historical = mode !== "native" ? await seedRecoveryEdit(db, engine, mode, alternate) : null;
    if (mode === "Historical preferences") {
      expect(historical).toBeNull();
      expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(0);
      expect(db.selectValue("SELECT count(*) FROM library_local_recovery_reissues;")).toBe(0);
      expect(engine.followerMutationContext().next_actor_sequence).toBe(1);
      return;
    }
    const input = historical ?? parseLibraryCoreReapplyConsumerIntentV1({ review: vector.review,
      intent: { envelopeBytes: vector.envelopes.map(value => new Uint8Array(new TextEncoder().encode(value))) } });
    const archive = () => db.exec({ sql: "SELECT * FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;", rowMode: "array", returnValue: "resultRows" });
    const original = archive();
    const retainedEvent = () => db.exec("INSERT INTO library_person_reach_outs VALUES ('rss:item:1','historical:member',1000,NULL,'Changed retained text');");
    const tombstone = () => db.exec({ sql: "INSERT INTO library_tombstones VALUES ('account','account:selected',?1,1,'test:delete',1500);", bind: [vector.receipt.replacementActorId] });
    if (mode === "Reach-out") retainedEvent(); else if (mode !== "Preferences") tombstone();
    await expect(engine.reapplyConsumerIntent(mode === "Preferences" ? alternate.value! : input)).rejects.toThrow(mode === "Preferences" ? "assignment paths" : mode === "Reach-out" ? "event is already present" : "deleted account");
    for (const table of ["library_intent_transactions", "library_intent_members", "library_local_recovery_reissues"])
      expect(db.selectValue(`SELECT count(*) FROM ${table};`)).toBe(0);
    expect(engine.followerMutationContext().next_actor_sequence).toBe(1);
    expect(archive()).toEqual(original);
    // Fixture reset models a selected account with no deletion history.
    db.exec("DELETE FROM library_tombstones WHERE entity_type='account'; DELETE FROM library_person_reach_outs;");
    const receipt = await engine.reapplyConsumerIntent(input);
    if (!historical) expect(receipt).toEqual({ ...vector.receipt, createdAt: receipt.createdAt });
    else {
      expect(receipt.replacementTransactionId).toBe("historical:replacement");
      const stored = db.selectValue("SELECT canonical_member FROM library_intent_members;") as Uint8Array;
      const envelope = decodeLibraryCoreCanonicalValue(stored) as unknown as { payload: { accounts: { id: string }[] } };
      if (mode === "historical PWA") expect(envelope.payload.accounts.map(account => account.id)).toEqual(["account:A", "account:a", "account:selected"]);
      else if (mode === "Preferences") expect(envelope.payload).toEqual({ updates: { ai: { autoSummarize: false }, display: { archivePruneDays: 30 }, weights: { topics: { alpha: 2 } } } });
      else if (mode === "Reach-out") expect(envelope.payload).toEqual({ channel: null, logged_at_ms: 1000, notes: "Recovered history" });
      else expect(envelope.payload).toMatchObject({ account: { id: "account:selected", updatedAt: 2000 } });
    }
    if (mode === "Reach-out") retainedEvent(); else tombstone();
    db.exec("UPDATE library_meta SET source_revision=source_revision+1; UPDATE library_change_state SET revision=revision+1;");
    expect(await engine.reapplyConsumerIntent(input)).toEqual(receipt);
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_reissues;")).toBe(1);
    expect(archive()).toEqual(original);
  } finally { db.close(); }
});

// Tier 1: exercise original enrollment and signatures through SQLite reissue
// without substituting a verified scope. Historical Friend storage is seeded
// directly because ordinary enqueue must reject the old locale-based order.
async function seedRecoveryEdit(db: Database, engine: PwaLibraryCoreSqliteEngine, mode: "historical PWA" | "Account upsert" | "Reach-out" | "Preferences" | "Historical preferences", alternate: { value?: ReturnType<typeof parseLibraryCoreReapplyConsumerIntentV1> }) {
  const accountUpsert = mode === "Account upsert", reachOut = mode === "Reach-out", preferences = mode === "Preferences" || mode === "Historical preferences";
  if (reachOut) db.exec("INSERT OR IGNORE INTO library_persons (id,name,relationship_status,care_level,created_at,updated_at) VALUES ('rss:item:1','Reach-out target','friend',3,1000,1000);");
  const digest = (domain: LibraryCoreDigestDomain, value: unknown) =>
    sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue));
  const canonical = (value: unknown) => encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue);
  const json = (value: unknown) => new TextDecoder().decode(canonical(value));
  const actorKeys = generateKeyPairSync("ed25519"), authorityKeys = generateKeyPairSync("ed25519");
  const publicKey = actorKeys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const authorityPublicKey = authorityKeys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const authorityKeyId = digest("authority-key", { signature_algorithm: "ed25519", authority_public_key: authorityPublicKey });
  const archive = db.exec({ sql: "SELECT library_id, predecessor_epoch_id, actor_id FROM library_local_recovery_archives;", rowMode: "array", returnValue: "resultRows" })[0]!;
  const body = constructLibraryCoreActorEnrollmentBodyV1({ operation_id: "historical:enrollment", library_id: archive[0],
    epoch: 1, epoch_id: archive[1], authority_key_id: authorityKeyId, installation_incarnation: "3".repeat(64),
    actor_incarnation_nonce: "4".repeat(64), actor_public_key: publicKey, observed_frontier: [], created_at_ms: 1000 }, { digest });
  const certificate = await constructLibraryCoreActorEnrollmentCertificateV1(body, { digest,
    signActorProof: async bytes => sign(null, bytes, actorKeys.privateKey).toString("hex"),
    signAuthorityCertificate: async bytes => sign(null, bytes, authorityKeys.privateKey).toString("hex") });
  const person = { id: "rss:item:1", name: "Historical Friend", careLevel: 3, relationshipStatus: "friend", createdAt: 1000, updatedAt: 1000 };
  const accounts = ["account:a", "account:A", "account:selected"].map(id => ({ id, personId: person.id, kind: "social",
    provider: "instagram", externalId: id, discoveredFrom: "manual_entry", firstSeenAt: 1000, lastSeenAt: 1000, createdAt: 1000, updatedAt: 1000 }));
  const memberInput = { operation_id: "historical:member", library_id: archive[0], epoch: 1, epoch_id: archive[1],
    actor_id: body.body.actor_id, actor_sequence: 1, previous_actor_operation_id: null, causal_frontier: [],
    hlc_wall_ms: 1000, hlc_counter: 0, transaction_id: vector.review.transactionId, transaction_member_index: 0,
    transaction_member_count: 1, entity_id: person.id, payload: { accounts, person }, created_at_ms: 1000 };
  const reachOutPayload = { channel: null, logged_at_ms: 1000, notes: "Recovered history" };
  const preferencePayload = mode === "Historical preferences" ? { updates: { display: { markReadOnScroll: false } } } : { updates: { ai: { autoSummarize: true }, display: { archivePruneDays: 14 }, weights: { topics: { alpha: { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" } } } } };
  const historical = mode === "Historical preferences"
    ? assembleLibraryCoreHistoricalPreferencesV1([constructLibraryCoreHistoricalPreferencesMemberV1({ ...memberInput,
      entity_id: "preferences", payload: preferencePayload }, { digest })], certificate.actor_chain_genesis, { digest })
    : preferences
    ? assembleLibraryCoreTransactionV1([PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({ ...memberInput,
      entity_id: "preferences", payload: preferencePayload }, { digest })], certificate.actor_chain_genesis, { digest })
    : reachOut
    ? assembleLibraryCoreTransactionV1([PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA.construct({ ...memberInput,
      payload: reachOutPayload }, { digest })], certificate.actor_chain_genesis, { digest })
    : accountUpsert
    ? assembleLibraryCoreTransactionV1([ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct({ ...memberInput,
      entity_id: "account:selected", payload: { account: accounts[2] } }, { digest })], certificate.actor_chain_genesis, { digest })
    : assembleLibraryCoreArchivedFriendV1([constructLibraryCoreArchivedFriendMemberV1(memberInput, { digest })], certificate.actor_chain_genesis, { digest });
  const signed = { ...historical.members[0]!.signing_body, signature: sign(null,
    encodeLibraryCoreOperationSignatureInput({ operation_signing_body_digest: historical.members[0]!.signing_body_digest }), actorKeys.privateKey).toString("hex") };
  const originalBytes = canonical(signed);
  // Replace only fixture identities before the immutable archive snapshot.
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec({ sql: "UPDATE library_authority_epochs SET authority_key_id=?1,authority_public_key=?2 WHERE epoch_id=?3;", bind: [authorityKeyId, authorityPublicKey, archive[1]!] });
  db.exec({ sql: `UPDATE library_actors SET actor_id=?1,public_key=?2,canonical_enrollment_certificate=?3,
    enrollment_certificate_digest=?4,chain_genesis_digest=?5,accepted_chain_digest=?5 WHERE actor_id=?6;`,
    bind: [body.body.actor_id, publicKey, json(certificate.certificate), certificate.certificate.certificate_digest, certificate.actor_chain_genesis, archive[2]!] });
  db.exec({ sql: "UPDATE library_actor_capabilities SET actor_id=?1 WHERE actor_id=?2;", bind: [body.body.actor_id, archive[2]!] });
  db.exec({ sql: "UPDATE library_local_recovery_archives SET actor_id=?1;", bind: [body.body.actor_id] });
  const rows = db.exec({ sql: "SELECT table_key,columns_json,canonical_row FROM library_local_recovery_rows;", rowMode: "array", returnValue: "resultRows" });
  for (const row of rows) {
    const columns: string[] = JSON.parse(row[1] as string);
    const cells = JSON.parse(json(decodeLibraryCoreCanonicalValue(row[2] as Uint8Array))) as string[][];
    const set = (name: string, kind: string, value: string) => { cells[columns.indexOf(name)] = [kind, value]; };
    const text = (name: string, value: string) => set(name, "text", encodeLibraryCoreCanonicalBase64(new TextEncoder().encode(value)));
    text("actor_id", body.body.actor_id);
    if (row[0] === "library_intent_transactions") {
      text("transaction_digest", historical.transaction_digest);
      set("canonical_member_bytes", "integer", String(originalBytes.length));
      text("previous_chain_digest", signed.previous_actor_chain_digest);
      text("ending_operation_id", signed.operation_id);
      text("ending_chain_digest", signed.actor_chain_digest);
      set("canonical_transaction", "blob", encodeLibraryCoreCanonicalBase64(canonical({
        actor_id: signed.actor_id, member_count: 1, transaction_digest: historical.transaction_digest, transaction_id: signed.transaction_id,
      })));
    } else {
      set("canonical_member", "blob", encodeLibraryCoreCanonicalBase64(originalBytes));
      text("operation_id", signed.operation_id);
      text("mutation_id", signed.operation_type);
      text("entity_type", signed.entity_type);
      text("entity_id", signed.entity_id);
      text("member_digest", digest("operation-envelope", signed));
    }
    const bytes = canonical(cells);
    db.exec({ sql: "UPDATE library_local_recovery_rows SET canonical_row=?1,row_digest=?2 WHERE table_key=?3;", bind: [bytes, sha256LowerHex(bytes), row[0]!] });
  }
  // Keep the synthetic successor fixture's admitted actor identity, while using
  // the same retained key to sign this test's explicit fresh action.
  db.exec({ sql: "UPDATE library_actors SET public_key=?1 WHERE actor_id=?2;", bind: [publicKey, vector.receipt.replacementActorId] });
  db.exec({ sql: "UPDATE library_follower_actor_request SET actor_public_key=?1;", bind: [publicKey] });
  const receiptBytes = db.selectValue("SELECT reenrollment_receipt FROM library_local_recovery_archives;") as Uint8Array;
  const receipt = { ...decodeLibraryCoreCanonicalValue(receiptBytes) as Record<string, LibraryCoreCanonicalValue>, actorPublicKey: publicKey };
  const changedReceipt = canonical(receipt);
  db.exec({ sql: "UPDATE library_local_recovery_archives SET reenrollment_receipt=?1,reenrollment_digest=?2;", bind: [changedReceipt, sha256LowerHex(changedReceipt)] });
  db.exec("PRAGMA foreign_keys = ON;");
  expect(db.exec({ sql: "PRAGMA foreign_key_check;", rowMode: "array", returnValue: "resultRows" })).toEqual([]);
  const request = parseLibraryCoreRecoveryIntentReviewRequestV1({ queryId: "recovery_intent_review_v1", schemaVersion: 1,
    recoveryId: vector.review.recoveryId, transactionId: vector.review.transactionId,
    cursor: null, limit: 1, includeOriginal: true, cancellationId: "historical-review", readerSessionId: "historical-reader" });
  if (!request.ok) throw new Error(request.error);
  const reviewed = await engine.queryWithVerification(request.value);
  expect(reviewed.outcome).toEqual({ state: "unresolved" });
  expect(reviewed.rows[0]!.originalEnvelopeJson).toBe(json(signed));
  if (mode === "historical PWA") expect((JSON.parse(reviewed.rows[0]!.originalEnvelopeJson!) as { payload: { accounts: { id: string }[] } }).payload.accounts.map(account => account.id))
    .toEqual(["account:a", "account:A", "account:selected"]);
  if (mode === "Historical preferences") {
    expect(JSON.parse(reviewed.rows[0]!.originalEnvelopeJson!).payload).toEqual(preferencePayload);
    expect(() => PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({ ...memberInput,
      entity_id: "preferences", payload: preferencePayload }, { digest })).toThrow("unsupported fields");
    return null;
  }
  const context = engine.followerMutationContext();
  const replacement = (preferences ? PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA : reachOut ? PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA : accountUpsert ? ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA : FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA).construct({ ...memberInput,
    epoch: context.epoch, epoch_id: context.epoch_id, actor_id: context.actor_id,
    operation_id: "historical:replacement:member", transaction_id: "historical:replacement",
    entity_id: preferences ? "preferences" : accountUpsert ? "account:selected" : person.id,
    created_at_ms: 2000, hlc_wall_ms: 2000, payload: preferences ? { updates: { ai: { autoSummarize: false }, display: { archivePruneDays: 30 }, weights: { topics: { alpha: 2 } } } } : reachOut ? reachOutPayload : accountUpsert ? { account: { ...accounts[2], updatedAt: 2000 } } : { accounts: [accounts[1], accounts[0], accounts[2]], person: { ...person, updatedAt: 2000 } } }, { digest });
  const finalized = await finalizeLibraryCoreTransactionV1(assembleLibraryCoreTransactionV1([replacement], context.previous_actor_chain_digest, { digest }),
    { digest, signOperation: async bytes => sign(null, bytes, actorKeys.privateKey).toString("hex") });
  if (preferences) {
    const changed = PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({ ...memberInput,
      epoch: context.epoch, epoch_id: context.epoch_id, actor_id: context.actor_id,
      operation_id: "historical:replacement:member", transaction_id: "historical:replacement", entity_id: "preferences", created_at_ms: 2000, hlc_wall_ms: 2000,
      payload: { updates: { ai: { autoSummarize: false }, display: { archivePruneDays: 30, showEngagementCounts: false }, weights: { topics: { alpha: 2 } } } } }, { digest });
    const invalidScope = await finalizeLibraryCoreTransactionV1(assembleLibraryCoreTransactionV1([changed], context.previous_actor_chain_digest, { digest }),
      { digest, signOperation: async bytes => sign(null, bytes, actorKeys.privateKey).toString("hex") });
    alternate.value = parseLibraryCoreReapplyConsumerIntentV1({ review: { ...vector.review, transactionDigest: historical.transaction_digest }, intent: { envelopeBytes: invalidScope.members.map(member => canonical(member.envelope)) } });
  }
  return parseLibraryCoreReapplyConsumerIntentV1({ review: { ...vector.review, transactionDigest: historical.transaction_digest },
    intent: { envelopeBytes: finalized.members.map(member => canonical(member.envelope)) } });
}
