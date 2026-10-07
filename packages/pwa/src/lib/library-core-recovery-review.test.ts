import * as reviewBoundary from "./library-core-recovery-review";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static, type SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  assembleLibraryCoreTransactionV1, finalizeLibraryCoreTransactionV1, FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA, FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA, PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA, FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA, LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
  encodeLibraryCoreDigestInput, parseLibraryCoreReapplyConsumerIntentV1,
  decodeLibraryCoreCanonicalBase64, decodeLibraryCoreCanonicalValue, encodeLibraryCoreCanonicalBase64,
  encodeLibraryCoreCanonicalValue, parseLibraryCoreRecoveryIntentReviewRequestV1, sha256LowerHex,
  type LibraryCoreCanonicalValue,
} from "@freed/shared/library-core";
import fixture from "../../../shared/src/library-core/recovery-review-vector-v1.json";
import { migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";

// Native-produced signed archive and response. Partial query fixture, not an activated checkpoint.
describe("browser verified archive review", () => {
  let db: Database, sqlite: Sqlite3Static, engine: PwaLibraryCoreSqliteEngine;
  const request = (overrides: Record<string, unknown> = {}) => {
    const parsed = parseLibraryCoreRecoveryIntentReviewRequestV1({ ...fixture.request, ...overrides });
    if (!parsed.ok) throw new Error(parsed.error); return parsed.value;
  };
  beforeEach(async () => {
    sqlite = await sqlite3InitModule(); db = new sqlite.oo1.DB(":memory:", "c");
    engine = new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion, { capi: sqlite.capi }); engine.initialize();
    db.transaction("IMMEDIATE", () => migratePwaLibraryRecoverySchema(db, sqlite.capi));
    db.exec("PRAGMA foreign_keys = OFF;");
    for (const [table, { columns, rows }] of Object.entries(fixture.tables)) {
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
  });
  afterEach(() => { if (db.isOpen()) db.close(); });
  function alterMember(mutate: (member: Record<string, unknown>) => void) {
    const row = db.exec({ sql: "SELECT columns_json, canonical_row FROM library_local_recovery_rows WHERE table_key = 'library_intent_members' AND row_ordinal = 0;", rowMode: "array", returnValue: "resultRows" })[0]!;
    const columns: string[] = JSON.parse(row[0] as string);
    const cells = JSON.parse(JSON.stringify(decodeLibraryCoreCanonicalValue(row[1] as Uint8Array))) as string[][];
    const cell = cells[columns.indexOf("canonical_member")]!;
    const envelope = { ...decodeLibraryCoreCanonicalValue(decodeLibraryCoreCanonicalBase64(cell[1]!)) as Record<string, unknown> };
    mutate(envelope);
    cell[1] = encodeLibraryCoreCanonicalBase64(encodeLibraryCoreCanonicalValue(envelope as LibraryCoreCanonicalValue));
    const bytes = encodeLibraryCoreCanonicalValue(cells);
    db.exec({ sql: "UPDATE library_local_recovery_rows SET canonical_row = ?1, row_digest = ?2 WHERE table_key = 'library_intent_members' AND row_ordinal = 0;", bind: [bytes, sha256LowerHex(bytes)] });
  }
  it("matches native verified response, pages original bytes and closes its read snapshot", async () => {
    const changes = db.changes(true), first = await engine.queryWithVerification(request());
    expect(first).toEqual(fixture.response);
    expect((await engine.queryWithVerification(request({ cursor: first.nextCursor }))).rows[0]!.memberIndex).toBe(1);
    const original = await engine.queryWithVerification(request({ includeOriginal: true }));
    expect(JSON.parse(original.rows[0]!.originalEnvelopeJson!).transaction_id).toBe(request().transactionId);
    expect(db.changes(true)).toBe(changes);
    expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
    expect(() => request({ cursor: original.nextCursor })).toThrow(/cursor/i);
    db.exec("UPDATE library_local_change_state SET sequence = sequence + 1;");
    await expect(engine.queryWithVerification(request({ cursor: first.nextCursor }))).rejects.toThrow(/CURSOR_STALE/);
    expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
  });
  it("distinguishes a missing target from a deleted target without changing its archived outcome", async () => {
    const original = await engine.queryWithVerification(request());
    expect(original.rows[0]!.itemState).toBe("present");
    const entityId = original.rows[0]!.entityId;
    db.exec({ sql: "DELETE FROM library_feed_items WHERE global_id = ?1;", bind: [entityId] });
    const absent = await engine.queryWithVerification(request());
    expect(absent.rows[0]).toMatchObject({ itemPresent: false, itemState: "absent" });
    db.exec({ sql: "INSERT INTO library_tombstones VALUES ('feed_item', ?1, 'test-actor', 1, 'test-removal', 1);", bind: [entityId] });
    const deleted = await engine.queryWithVerification(request());
    expect(deleted.rows[0]).toMatchObject({ itemPresent: false, itemState: "deleted" });
    expect(deleted.outcome).toEqual(original.outcome);
    expect(deleted.transactionDigest).toBe(original.transactionDigest);
  });
  it("never treats published state as acceptance and rejects partial canonical receipts", async () => {
    db.exec("DELETE FROM library_receipts WHERE operation_id = (SELECT operation_id FROM library_receipts LIMIT 1);");
    await expect(engine.queryWithVerification(request())).rejects.toThrow(/incomplete canonical/);
    db.exec("DELETE FROM library_receipts;");
    expect((await engine.queryWithVerification(request())).outcome).toEqual({ state: "unresolved" });
  });
  it("rejects a changed original signature even when the archive row digest is recomputed", async () => {
    alterMember(member => { member.signature = "0".repeat(128); });
    await expect(engine.queryWithVerification(request())).rejects.toThrow(/signature/);
    expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
  });
  it("requires archived signed enrollment when the actor has moved to another epoch", async () => {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("DELETE FROM library_actors;");
    expect((await engine.queryWithVerification(request())).outcome).toEqual(fixture.response.outcome);
    db.exec("UPDATE library_local_recovery_rows SET canonical_row = X'5b5d' WHERE table_key = 'library_follower_actor_request';");
    await expect(engine.queryWithVerification(request())).rejects.toThrow(/integrity/);
  });
  it("refuses to borrow a transaction and preserves it for its owner", async () => {
    db.exec("BEGIN IMMEDIATE;");
    await expect(engine.queryWithVerification(request())).rejects.toThrow(/own transaction/);
    expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(0);
    db.exec("ROLLBACK;");
  });
  it("verifies original-authority rejection and refuses contradictory acceptance or changed signatures", async () => {
    const rejected = fixture.rejectedResult;
    const insertResult = (value: typeof rejected) => {
      const row: Record<string, unknown> = { transaction_id: value.transaction_id, actor_id: value.actor_id,
        authority_epoch_id: value.epoch_id, intent_epoch_id: value.intent_epoch_id, result_sequence: value.result_sequence,
        previous_result_digest: value.previous_result_digest, result_digest: value.result_body_digest, status: value.status,
        authoritative_source_revision: value.authoritative_source_revision,
        canonical_result: encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue), received_at: 2000 };
      const columns = db.exec({ sql: "PRAGMA table_info(library_intent_results);", rowMode: "array", returnValue: "resultRows" }).map(row => row[1] as string);
      const cells = columns.map(name => {
        const value = row[name];
        return value === null ? ["null"] : typeof value === "number" ? ["integer", String(value)] :
          value instanceof Uint8Array ? ["blob", encodeLibraryCoreCanonicalBase64(value)] :
          ["text", encodeLibraryCoreCanonicalBase64(new TextEncoder().encode(String(value)))];
      });
      const bytes = encodeLibraryCoreCanonicalValue(cells);
      db.exec({ sql: `INSERT OR REPLACE INTO library_local_recovery_rows
        (recovery_id, table_key, row_ordinal, transaction_id, columns_json, canonical_row, row_digest)
        VALUES (?1, 'library_intent_results', 0, ?2, ?3, ?4, ?5);`,
        bind: [request().recoveryId, request().transactionId, JSON.stringify(columns), bytes, sha256LowerHex(bytes)] });
    };
    insertResult(rejected);
    await expect(engine.queryWithVerification(request())).rejects.toThrow(/contradicts/);
    db.exec("DELETE FROM library_receipts;");
    expect((await engine.queryWithVerification(request())).outcome).toEqual({ state: "reported_rejected", reason: "target_missing", result_digest: rejected.result_body_digest });
    insertResult({ ...rejected, signature: "0".repeat(128) });
    await expect(engine.queryWithVerification(request())).rejects.toThrow(/signature/);
    expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
  });

  it("rolls back its reader after the monotonic verification budget expires", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(30_001);
    try {
      const changes = db.changes(true);
      await expect(engine.queryWithVerification(request())).rejects.toThrow(/deadline exceeded/);
      expect(db.changes(true)).toBe(changes);
      expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
    } finally { now.mockRestore(); }
  });

  async function successorReplacement(mode: "ordinary" | "accepted" | "reordered" | "rss" | "person" | "friend" | "capture" = "ordinary") {
    // Synthetic accepted successor ledger isolates mutation atomicity. Transfer proofs have separate coverage.
    const epoch = "b".repeat(64), actor = "e".repeat(64), genesis = "f".repeat(64), enrollmentDigest = "d".repeat(64);
    const keys = generateKeyPairSync("ed25519"), publicKey = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const library = db.selectValue("SELECT library_id FROM library_meta;") as string;
    if (mode !== "accepted") db.exec("DELETE FROM library_receipts;");
    db.exec({ sql: `INSERT INTO library_authority_epochs SELECT ?1, library_id, epoch_number + 1, authority_key_id,
      authority_public_key, transition_certificate_digest, canonical_transition_certificate, accepted_manifest_generation,
      checkpoint_frontier_digest, materialized_state_digest, accepted_at FROM library_authority_epochs LIMIT 1;`, bind: [epoch] });
    db.exec({ sql: "UPDATE library_meta SET authority_epoch = ?1;", bind: [epoch] });
    db.exec({ sql: `INSERT INTO library_active_authority VALUES ('active', ?1, ?2, ?3, 1, 3000);`, bind: [library, epoch, actor] });
    db.exec({ sql: `INSERT INTO library_actors VALUES (?1, ?2, 'pwa', ?3, 'successor-enrollment', ?4, '{}', ?5,
      0, NULL, ?5, NULL, 3000, 3000);`, bind: [actor, epoch, publicKey, enrollmentDigest, genesis] });
    db.exec({ sql: `INSERT INTO library_actor_capabilities (capability_id, actor_id, certificate_version, actor_class,
      scope_mode, issuance_identity, retirement_identity, certificate_digest, canonical_certificate, issued_at)
      VALUES (?1, ?2, 2, 'editor', 'library_wide', ?1, ?3, ?1, '{}', 3000);`, bind: [enrollmentDigest, actor, "c".repeat(64)] });
    db.exec({ sql: "INSERT INTO library_actor_capability_mutations VALUES (?1, ?2);", bind: [enrollmentDigest, mode === "capture" ? "feed_item_capture_upsert" : mode === "person" ? "person_upsert" : mode === "friend" ? "friend_replace" : mode === "rss" ? "rss_feed_upsert" : "feed_item_read_assignment"] });
    db.exec({ sql: `INSERT INTO library_follower_actor_request VALUES (1, ?1, ?2, ?3, ?4, ?5, '{}', 3000, ?5, '{}', ?6, 3000);`,
      bind: [library, epoch, actor, publicKey, enrollmentDigest, genesis] });
    const receipt = encodeLibraryCoreCanonicalValue({ libraryId: library, authorityEpochId: epoch, actorId: actor,
      actorPublicKey: publicKey, enrollmentRequestDigest: enrollmentDigest, canonicalEnrollmentRequestJson: '{}', createdAt: 3000 });
    db.exec({ sql: `UPDATE library_local_recovery_archives SET reenrollment_receipt = ?1, reenrollment_digest = ?2,
      reenrollment_committed_at = 3001, reenrollment_installation_witness = ?3;`, bind: [receipt, sha256LowerHex(receipt), "9".repeat(64)] });
    db.exec({ sql: `INSERT INTO library_local_handoff (singleton_id, handoff_id, library_id, installation_role, phase,
      predecessor_epoch_id, successor_epoch_id, target_writer_id, target_authority_public_key, canonical_readiness,
      canonical_authorization_body, expected_control_revision, created_at, updated_at)
      SELECT 1, ?1, library_id, 'consumer', 'following', predecessor_epoch_id, successor_epoch_id, ?2, ?3,
      X'7b7d', X'7b7d', 'control', 3000, 3001 FROM library_local_recovery_archives;`, bind: ["7".repeat(64), actor, publicKey] });
    db.exec({ sql: `INSERT INTO library_follower_checkpoint_receipt SELECT 1, library_id, authority_epoch, ?1, 1,
      source_revision, ?2, 'manifest', 'transport', ?2, 'control', 3000 FROM library_meta;`, bind: [actor, "6".repeat(64)] });
    const review = await engine.queryWithVerification(request({ includeOriginal: true, limit: 16 }));
    const context = engine.followerMutationContext();
    const digest = (domain: Parameters<typeof encodeLibraryCoreDigestInput>[0], value: unknown) => sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue));
    const selectedRows = mode === "reordered" ? [...review.rows].reverse() : review.rows;
    const members = selectedRows.map((row, index) => (mode === "capture" ? FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA : mode === "person" ? PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA : mode === "friend" ? FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA : mode === "rss" ? RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA : FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA).construct({
      actor_id: context.actor_id, actor_sequence: index + 1, causal_frontier: context.observed_frontier,
      created_at_ms: 4000, entity_id: row.entityId, epoch: context.epoch, epoch_id: context.epoch_id,
      hlc_counter: 0, hlc_wall_ms: 4000, library_id: context.library_id, operation_id: `replacement-member-${index}`,
      payload: mode === "capture" ? { item: { globalId: row.entityId, platform: "saved", contentType: "article", capturedAt: 4000, publishedAt: 4000, author: { id: "author", handle: "author", displayName: "Author" }, content: { text: "Recovered", mediaUrls: [], mediaTypes: [] }, topics: [], userState: { hidden: false, saved: true, archived: false, tags: [] } } } : mode === "person" || mode === "friend" ? { ...(mode === "friend" ? { accounts: [] } : {}), person: { id: row.entityId, name: "Recovered", relationshipStatus: "friend", careLevel: 3, createdAt: 1000, updatedAt: 4000 } } : mode === "rss" ? { feed: { url: row.entityId, title: "Recovered", enabled: false, trackUnread: true } } : { read_at_ms: 4000 }, previous_actor_operation_id: index ? `replacement-member-${index - 1}` : null,
      transaction_id: "replacement-edit", transaction_member_count: selectedRows.length, transaction_member_index: index,
    }, { digest }));
    const finalized = await finalizeLibraryCoreTransactionV1(assembleLibraryCoreTransactionV1(members, genesis, { digest }), {
      digest, signOperation: async bytes => sign(null, bytes, keys.privateKey).toString("hex"),
    });
    return parseLibraryCoreReapplyConsumerIntentV1({ review: { schemaVersion: 1, recoveryId: review.recoveryId,
      archiveDigest: review.archiveDigest, transactionId: review.transactionId, transactionDigest: review.transactionDigest,
      reviewedGenerationId: review.source.generationId, reviewedRevision: review.source.projectionRevision,
      reviewedLocalSequence: review.source.transitionSequence, memberCount: selectedRows.length },
      intent: { envelopeBytes: finalized.members.map(member => encodeLibraryCoreCanonicalValue(member.envelope as unknown as LibraryCoreCanonicalValue)) } });
  }
  it("uses indexed item state and refuses a tombstoned replacement before changing intent state", async () => {
    const input = await successorReplacement("capture");
    const target = (decodeLibraryCoreCanonicalValue(input.intent.envelopeBytes[0]!) as Record<string, unknown>).entity_id as string;
    const sql = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.recovery_intent_review_v1.variants.item_state.sql;
    expect(db.selectValue(sql, [target])).toBe("present");
    db.exec({ sql: "INSERT INTO library_tombstones VALUES ('feed_item',?1,?2,1,'test:deleted',1500);", bind: [target, "e".repeat(64)] });
    expect(db.selectValue(sql, [target])).toBe("deleted"); // Tombstone wins even if a contradictory live row exists.
    const plan = db.exec({ sql: "EXPLAIN QUERY PLAN " + sql, bind: [target], rowMode: "array", returnValue: "resultRows" }).flat().join(" ");
    expect(plan).toContain("SEARCH library_tombstones"); expect(plan).toContain("SEARCH library_feed_items");
    // Isolate the write guard with an already-verified original capture scope. Native tests
    // prove actual archived capture signatures; this boundary test still verifies fresh signatures.
    const inspect = reviewBoundary.inspectPwaRecoveryIntentInTransaction;
    const verifiedScope = vi.spyOn(reviewBoundary, "inspectPwaRecoveryIntentInTransaction").mockImplementation(async (...args) => {
      const original = await inspect(...args);
      return { ...original, verified: { ...original.verified, members: original.verified.members.map(member => ({ ...member,
        envelope: { ...member.envelope, operation_type: "feed_item_capture_upsert", entity_type: "FeedItem" } })) } } as typeof original;
    });
    try {
      await expect(engine.reapplyConsumerIntent(input)).rejects.toThrow("deleted item");
      for (const table of ["library_intent_transactions", "library_intent_members", "library_intent_actors", "library_local_recovery_reissues"])
        expect(db.selectValue(`SELECT count(*) FROM ${table};`)).toBe(0);
    } finally { verifiedScope.mockRestore(); }
  });
  it("uses indexed RSS state and refuses a tombstoned replacement before changing intent state", async () => {
    const input = await successorReplacement("rss");
    const target = (decodeLibraryCoreCanonicalValue(input.intent.envelopeBytes[0]!) as Record<string, unknown>).entity_id as string;
    const sql = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.recovery_intent_review_v1.variants.rss_context.sql;
    expect(db.selectValue(sql, [target])).toBe("absent");
    db.exec({ sql: "INSERT INTO library_rss_feeds (url,title,enabled,track_unread,updated_at) VALUES (?1,'Current',0,1,1500);", bind: [target] });
    expect(db.selectValue(sql, [target])).toBe("present");
    db.exec({ sql: "INSERT INTO library_tombstones VALUES ('rss_feed',?1,?2,1,'test:deleted',1500);", bind: [target, "e".repeat(64)] });
    expect(db.selectValue(sql, [target])).toBe("deleted"); // Tombstone wins even if a contradictory live row exists.
    const plan = db.exec({ sql: "EXPLAIN QUERY PLAN " + sql, bind: [target], rowMode: "array", returnValue: "resultRows" }).flat().join(" ");
    expect(plan).toContain("SEARCH library_tombstones"); expect(plan).toContain("SEARCH library_rss_feeds");
    // Isolate the write guard with an already-verified original RSS scope. Native tests
    // prove actual archived RSS signatures; this boundary test still verifies fresh signatures.
    const inspect = reviewBoundary.inspectPwaRecoveryIntentInTransaction;
    const verifiedScope = vi.spyOn(reviewBoundary, "inspectPwaRecoveryIntentInTransaction").mockImplementation(async (...args) => {
      const original = await inspect(...args);
      return { ...original, verified: { ...original.verified, members: original.verified.members.map(member => ({ ...member,
        envelope: { ...member.envelope, operation_type: "rss_feed_upsert", entity_type: "RssFeed" } })) } } as typeof original;
    });
    try {
      await expect(engine.reapplyConsumerIntent(input)).rejects.toThrow("deleted subscription");
      for (const table of ["library_intent_transactions", "library_intent_members", "library_intent_actors", "library_local_recovery_reissues"])
        expect(db.selectValue(`SELECT count(*) FROM ${table};`)).toBe(0);
    } finally { verifiedScope.mockRestore(); }
  });
  it.each(["person", "friend"] as const)("uses indexed Person state and refuses invalid %s recovery before writes", async mode => {
    const input = await successorReplacement(mode);
    const target = (decodeLibraryCoreCanonicalValue(input.intent.envelopeBytes[0]!) as Record<string, unknown>).entity_id as string;
    const sql = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.recovery_intent_review_v1.variants.person_context.sql;
    expect(db.selectValue(sql, [target])).toBe("absent");
    db.exec({ sql: "INSERT INTO library_persons (id,name,relationship_status,care_level,created_at,updated_at) VALUES (?1,'Current','friend',3,1000,1500);", bind: [target] });
    expect(db.selectValue(sql, [target])).toBe("present");
    db.exec({ sql: "INSERT INTO library_tombstones VALUES ('person',?1,?2,1,'test:deleted',1500);", bind: [target, "e".repeat(64)] });
    expect(db.selectValue(sql, [target])).toBe("deleted"); // Tombstone wins even if a contradictory live row exists.
    const plan = db.exec({ sql: "EXPLAIN QUERY PLAN " + sql, bind: [target], rowMode: "array", returnValue: "resultRows" }).flat().join(" ");
    expect(plan).toContain("SEARCH library_tombstones"); expect(plan).toContain("SEARCH library_persons");
    // Isolate the write guard with an already-verified original Person scope. Native tests
    // prove actual archived Person signatures; this boundary test still verifies fresh signatures.
    const inspect = reviewBoundary.inspectPwaRecoveryIntentInTransaction;
    const verifiedScope = vi.spyOn(reviewBoundary, "inspectPwaRecoveryIntentInTransaction").mockImplementation(async (...args) => {
      const original = await inspect(...args);
      return { ...original, verified: { ...original.verified, members: original.verified.members.map(member => ({ ...member,
        envelope: { ...member.envelope, operation_type: mode === "person" ? "person_upsert" : "friend_replace", entity_type: "Person" } })) } } as typeof original;
    });
    try {
      await expect(engine.reapplyConsumerIntent(input)).rejects.toThrow(mode === "friend" ? "exceeds its registered mutation program" : "deleted person");
      for (const table of ["library_intent_transactions", "library_intent_members", "library_intent_actors", "library_local_recovery_reissues"])
        expect(db.selectValue(`SELECT count(*) FROM ${table};`)).toBe(0);
      // Friend replacement permits one member; this fixture has two. Its bound must win.
      if (mode === "friend") return;
      db.exec({ sql: "DELETE FROM library_tombstones WHERE entity_type='person' AND entity_id=?1", bind: [target] });
      const receipt = await engine.reapplyConsumerIntent(input);
      db.exec({ sql: "INSERT INTO library_tombstones VALUES ('person',?1,?2,1,'test:later-delete',5000);", bind: [target, "e".repeat(64)] });
      expect(await engine.reapplyConsumerIntent(input)).toEqual(receipt);
    } finally { verifiedScope.mockRestore(); }
  });

  it("atomically links a fresh replacement and resolves response-loss retry after settlement and enrollment changes", async () => {
    const input = await successorReplacement();
    const original = db.exec({ sql: "SELECT * FROM library_local_recovery_rows;", rowMode: "array", returnValue: "resultRows" });
    db.exec(`CREATE TEMP TRIGGER fail_reissue_link BEFORE INSERT ON library_local_recovery_reissues
      BEGIN SELECT RAISE(ABORT, 'reissue link fault'); END;`);
    await expect(engine.reapplyConsumerIntent(input)).rejects.toThrow(/reissue link fault/);
    for (const table of ["library_intent_transactions", "library_intent_members", "library_intent_actors", "library_optimistic_fields", "library_local_recovery_reissues"]) {
      expect(db.selectValue(`SELECT count(*) FROM ${table};`)).toBe(0);
    }
    db.exec("DROP TRIGGER fail_reissue_link;");
    const receipt = await engine.reapplyConsumerIntent(input);
    expect(receipt).toMatchObject({ originalTransactionId: input.review.transactionId, replacementTransactionId: "replacement-edit", firstCounter: 1, lastCounter: 2, memberCount: 2 });
    expect(db.selectValue("SELECT next_counter FROM library_intent_actors;")).toBe(3);
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_reissues;")).toBe(1);
    expect(db.exec({ sql: "SELECT * FROM library_local_recovery_rows;", rowMode: "array", returnValue: "resultRows" })).toEqual(original);
    db.exec("UPDATE library_intent_transactions SET state = 'accepted', resolved_at = created_at + 1;");
    db.exec("DELETE FROM library_follower_actor_request;");
    db.exec("UPDATE library_local_change_state SET sequence = sequence + 1;");
    const changes = db.changes(true);
    expect(await engine.reapplyConsumerIntent(input)).toEqual(receipt);
    expect(db.changes(true)).toBe(changes);
    expect((await engine.queryWithVerification(request())).replacement).toEqual(receipt);
  });
  it("rejects stale review and refuses to attach a separately committed intent", async () => {
    const input = await successorReplacement();
    await expect(engine.reapplyConsumerIntent({ ...input, review: { ...input.review, reviewedLocalSequence: input.review.reviewedLocalSequence + 1 } })).rejects.toThrow(/RECOVERY_REVIEW_STALE/);
    expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(0);
    await engine.commitFollowerIntent(input.intent);
    const current = await engine.queryWithVerification(request());
    await expect(engine.reapplyConsumerIntent({ ...input, review: { ...input.review, reviewedLocalSequence: current.source.transitionSequence } })).rejects.toThrow(/unlinked intent/);
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_reissues;")).toBe(0);
  });

  it.each(["accepted", "reordered"] as const)("refuses %s recovery without writing a replacement", async mode => {
    const input = await successorReplacement(mode);
    await expect(engine.reapplyConsumerIntent(input)).rejects.toThrow(mode === "accepted" ? /already accepted/ : /complete ordered/);
    expect(db.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(0);
    expect(db.selectValue("SELECT count(*) FROM library_local_recovery_reissues;")).toBe(0);
    expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
  });

});
