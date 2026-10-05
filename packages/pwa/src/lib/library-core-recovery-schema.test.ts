import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { LIBRARY_CORE_LOCAL_SCHEMA_SHA256, LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256 } from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import { migratePwaLibraryRecoverySchema, readPwaLibraryStorageIdentity } from "./library-core-recovery-schema";

describe("browser local recovery storage identity", () => {
  let sqlite: Sqlite3Static, db: Database;
  beforeEach(async () => {
    sqlite = await sqlite3InitModule();
    db = new sqlite.oo1.DB(":memory:", "c");
    new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion).initialize();
    db.exec("UPDATE library_local_change_state SET sequence = 17 WHERE singleton_id = 1;");
  });
  afterEach(() => { if (db.isOpen()) db.close(); });
  const migrate = () => migratePwaLibraryRecoverySchema(db, sqlite.capi);
  const version = () => db.exec({ sql: "PRAGMA user_version;", rowMode: 0, returnValue: "resultRows" })[0];
  function archive() {
    db.exec({
      sql: `INSERT INTO library_local_recovery_archives
        (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 100);`,
      bind: ["1".repeat(64), "2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(64), LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, "6".repeat(64)],
    });
  }
  it("requires an owned durable transaction and rolls back a late lifecycle failure", () => {
    expect(migrate).toThrow(/owned FULL transaction/);
    expect(() => db.transaction("DEFERRED", migrate)).toThrow(/owned FULL transaction/);
    expect(() => db.transaction("IMMEDIATE", () => { migrate(); archive(); throw new Error("late lifecycle failure"); })).toThrow("late lifecycle failure");
    expect(version()).toBe(1);
    expect(readPwaLibraryStorageIdentity(db).schemaSha256).toBe(LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256);
    expect(db.exec({ sql: "SELECT name FROM sqlite_schema WHERE name = 'library_local_recovery_archives';", rowMode: 0, returnValue: "resultRows" })).toEqual([]);
    db.exec("PRAGMA synchronous = NORMAL;");
    expect(() => db.transaction("IMMEDIATE", migrate)).toThrow(/FULL/);
    expect(version()).toBe(1);
  });
  it("commits exact catalog and receipt together, reports physical2, and retries without writes", () => {
    db.transaction("IMMEDIATE", () => { migrate(); archive(); });
    const status = new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion).initialize();
    expect(status).toMatchObject({ schemaVersion: 2, schemaSha256: LIBRARY_CORE_LOCAL_SCHEMA_SHA256 });
    const changes = db.changes(true);
    db.transaction("IMMEDIATE", migrate);
    expect(db.changes(true)).toBe(changes);
    expect(db.exec({ sql: "SELECT sequence FROM library_local_change_state;", rowMode: 0, returnValue: "resultRows" })).toEqual([17]);
    expect(db.exec({ sql: "SELECT archive_digest FROM library_local_recovery_archives;", rowMode: 0, returnValue: "resultRows" })).toEqual(["6".repeat(64)]);
  });
  it("refuses altered metadata and index declarations without repairing either", () => {
    db.transaction("IMMEDIATE", migrate);
    db.exec("DROP INDEX library_local_recovery_enrollment;");
    expect(() => new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion).initialize()).toThrow(/catalog/);
    db.exec({ sql: "UPDATE library_storage_meta SET schema_sha256 = ?1;", bind: [LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256] });
    expect(() => readPwaLibraryStorageIdentity(db)).toThrow(/identity/);
    expect(version()).toBe(2);
  });
  it("refuses unversioned local tables and future versions", () => {
    db.exec("CREATE TABLE library_local_recovery_reissues (foreign_value TEXT);");
    expect(() => new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion).initialize()).toThrow(/unversioned/);
    expect(() => db.transaction("IMMEDIATE", migrate)).toThrow(/unversioned/);
    db.exec("PRAGMA user_version = 3;");
    expect(() => new PwaLibraryCoreSqliteEngine(db, sqlite.version.libVersion).initialize()).toThrow(/unsupported/);
  });
  it("rolls schema and version back when storage metadata cannot be updated", () => {
    db.exec("CREATE TRIGGER fail_migration BEFORE UPDATE ON library_storage_meta BEGIN SELECT RAISE(ABORT, 'metadata fault'); END;");
    expect(() => db.transaction("IMMEDIATE", migrate)).toThrow(/metadata fault/);
    expect(version()).toBe(1);
    expect(readPwaLibraryStorageIdentity(db).schemaSha256).toBe(LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256);
  });
});
