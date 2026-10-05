import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, sha256LowerHex } from "@freed/shared/library-core";
import vector from "../../../shared/src/library-core/recovery-archive-vectors-v1.json";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import { migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
import { archivePwaFollowerRows, encodePwaRecoveryRow, verifyPwaRecoveryArchive } from "./library-core-recovery-archive";

// The lifecycle caller supplies verified successor/key admission separately.
describe("browser recovery archive storage", () => {
  let sqlite: Sqlite3Static, db: Database;
  const id = "1".repeat(64);
  beforeEach(async () => {
    sqlite = await sqlite3InitModule();
    db = new sqlite.oo1.DB(":memory:", "c");
    new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion).initialize();
    db.exec("UPDATE library_local_change_state SET sequence = 17;");
  });
  afterEach(() => { if (db.isOpen()) db.close(); });
  function start() {
    migratePwaLibraryRecoverySchema(db, sqlite.capi);
    db.exec({ sql: `INSERT INTO library_local_recovery_archives
      (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 100);`,
      bind: [id, "2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(64), LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, "0".repeat(64)] });
  }
  const archive = () => archivePwaFollowerRows(db, sqlite.capi, id);
  const verify = (live = true) => verifyPwaRecoveryArchive(db, sqlite.capi, id, live);
  it("preserves native int64, raw text, blob and floating point encodings", () => {
    const statement = db.prepare(vector.sql);
    try {
      expect(statement.step()).toBe(true);
      const bytes = encodePwaRecoveryRow(statement, sqlite.capi);
      expect(new TextDecoder().decode(bytes)).toBe(vector.canonicalRow);
      expect(sha256LowerHex(bytes)).toBe(vector.rowDigest);
    } finally { statement.finalize(); }
  });
  it("requires transaction ownership, atomically archives, and retries without writes", () => {
    expect(archive).toThrow(/owned FULL/);
    db.transaction("IMMEDIATE", () => { start(); archive(); });
    expect(db.selectValue("SELECT row_count FROM library_local_recovery_archives;")).toBe(1);
    expect(db.selectValue("SELECT archive_digest FROM library_local_recovery_archives;")).toBe(vector.emptyLibraryArchiveDigest);
    const changes = db.changes(true);
    db.transaction("IMMEDIATE", archive);
    expect(db.changes(true)).toBe(changes);
    expect(db.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(17);
    db.exec("UPDATE library_local_change_state SET sequence = 18;");
    expect(() => db.transaction("IMMEDIATE", archive)).toThrow(/live rows changed/);
    db.transaction("IMMEDIATE", () => verify(false));
  });
  it("retains pending and published transaction indexes and refuses changed live intents", () => {
    db.exec({ sql: `INSERT INTO library_authority_epochs
      (epoch_id, library_id, epoch_number, authority_key_id, authority_public_key, transition_certificate_digest,
       canonical_transition_certificate, accepted_manifest_generation, checkpoint_frontier_digest, materialized_state_digest, accepted_at)
      VALUES (?1, ?2, 1, ?3, ?3, ?3, '{}', 0, ?3, ?3, 0);`,
      bind: ["3".repeat(64), "2".repeat(64), "6".repeat(64)] });
    db.exec({ sql: `INSERT INTO library_actors
      (actor_id, authority_epoch_id, actor_kind, public_key, enrollment_operation_id, enrollment_certificate_digest,
       canonical_enrollment_certificate, chain_genesis_digest, accepted_counter, accepted_operation_id,
       accepted_chain_digest, retired_at, created_at, updated_at)
      VALUES (?1, ?2, 'pwa', ?3, 'enrollment', ?3, '{}', ?3, 0, NULL, ?3, NULL, 0, 0);`,
      bind: ["5".repeat(64), "3".repeat(64), "6".repeat(64)] });
    db.exec({ sql: `INSERT INTO library_intent_actors VALUES (?1, 3, 'operation-1', ?2);`,
      bind: ["5".repeat(64), "7".repeat(64)] });
    for (const [index, state] of ["pending", "published"].entries()) {
      db.exec({ sql: `INSERT INTO library_intent_transactions
        (transaction_id, transaction_digest, actor_id, intent_epoch, intent_epoch_id, member_count,
         first_counter, last_counter, previous_operation_id, previous_chain_digest,
         ending_operation_id, ending_chain_digest, canonical_member_bytes, canonical_transaction,
         state, created_at, published_at, resolved_at)
        VALUES (?1, ?2, ?3, 1, ?4, 1, ?5, ?5, CASE WHEN ?5 = 1 THEN NULL ELSE 'operation-0' END, ?6, ?7, ?8, 2, X'7b7d', ?9, 1, NULL, NULL);`,
        bind: [`transaction-${index}`, String(index + 1).repeat(64), "5".repeat(64), "3".repeat(64),
          index + 1, "6".repeat(64), `operation-${index}`, "7".repeat(64), state] });
    }
    db.transaction("IMMEDIATE", () => { start(); archive(); });
    expect(db.exec({ sql: "SELECT row_count, pending_intent_count, published_intent_count FROM library_local_recovery_archives;",
      rowMode: "array", returnValue: "resultRows" })).toEqual([[4, 1, 1]]);
    expect(db.exec({ sql: "SELECT transaction_id FROM library_local_recovery_rows WHERE transaction_id IS NOT NULL ORDER BY row_ordinal;",
      rowMode: 0, returnValue: "resultRows" })).toEqual(["transaction-0", "transaction-1"]);
    db.exec("UPDATE library_intent_transactions SET canonical_transaction = X'5b5d' WHERE transaction_id = 'transaction-0';");
    expect(() => db.transaction("IMMEDIATE", () => verify())).toThrow(/live rows changed/);
    db.transaction("IMMEDIATE", () => verify(false));
  });
  it("rolls archive, metadata and migration back on a late write failure", () => {
    expect(() => db.transaction("IMMEDIATE", () => {
      start();
      db.exec("CREATE TEMP TRIGGER archive_fault BEFORE UPDATE ON library_local_recovery_archives BEGIN SELECT RAISE(ABORT, 'archive fault'); END;");
      archive();
    })).toThrow(/archive fault/);
    expect(db.selectValue("PRAGMA user_version;")).toBe(1);
    expect(db.selectValue("SELECT count(*) FROM sqlite_schema WHERE name = 'library_local_recovery_rows';")).toBe(0);
    expect(db.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(17);
  });
  it("rejects damaged bytes, altered commitments and additional unregistered rows", () => {
    db.transaction("IMMEDIATE", () => { start(); archive(); });
    const mutations = [
      "UPDATE library_local_recovery_rows SET canonical_row = X'5b5d';",
      "UPDATE library_local_recovery_rows SET columns_json = '[]';",
      "UPDATE library_local_recovery_rows SET transaction_id = 'invented';",
      "UPDATE library_local_recovery_rows SET row_ordinal = 2;",
      "UPDATE library_local_recovery_archives SET row_count = 2;",
      "UPDATE library_local_recovery_archives SET pending_intent_count = 1;",
      "INSERT INTO library_local_recovery_rows SELECT recovery_id, 'unknown_table', 0, columns_json, canonical_row, row_digest, transaction_id FROM library_local_recovery_rows;",
    ];
    for (const sql of mutations) {
      expect(() => db.transaction("IMMEDIATE", () => { db.exec(sql); verify(false); })).toThrow();
      db.transaction("IMMEDIATE", () => verify());
    }
  });
  it("refuses oversized row bytes before copying them into an archive", () => {
    const statement = db.prepare("SELECT zeroblob(2097153);");
    try {
      statement.step();
      expect(() => encodePwaRecoveryRow(statement, sqlite.capi)).toThrow(/bound/);
    } finally { statement.finalize(); }
  });
});
