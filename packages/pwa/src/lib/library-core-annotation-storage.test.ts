import { afterEach, beforeAll, describe, expect, it } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SQL, LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_LOCAL_SCHEMA_SQL, LIBRARY_CORE_LOCAL_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION, LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
} from "@freed/shared/library-core";
import {
  pwaAnnotationPending, rejectPwaAnnotationBuilding, resumePwaAnnotationUpgrade,
  verifyPwaAnnotationCatalog,
} from "./library-core-annotation-storage";

describe("annotation-specific local SQLite-WASM upgrade", () => {
  let sqlite: Sqlite3Static;
  const databases: Database[] = [];
  beforeAll(async () => { sqlite = await sqlite3InitModule(); });
  afterEach(() => { for (const db of databases.splice(0)) if (db.pointer) db.close(); });
  function open(): Database {
    const db = new sqlite.oo1.DB(":memory:", "c");
    databases.push(db);
    return db;
  }
  function fixture(version: 1 | 2): Database {
    const db = open();
    db.exec(LIBRARY_CORE_NORMALIZED_SCHEMA_SQL);
    if (version === 2) db.exec(LIBRARY_CORE_LOCAL_SCHEMA_SQL);
    db.exec({ sql: "INSERT INTO library_storage_meta VALUES(1,?1,?2,?3,?4);", bind: [
      LIBRARY_CORE_SQLITE_CONTRACT_VERSION, version, LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      version === 1 ? LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256 : LIBRARY_CORE_LOCAL_SCHEMA_SHA256,
    ] });
    db.exec(`PRAGMA user_version=${version};`);
    return db;
  }
  function resume(db: Database): boolean {
    return resumePwaAnnotationUpgrade(db, sqlite.capi, () => new sqlite.oo1.DB(":memory:", "c"));
  }
  function reopen(db: Database): Database {
    // Synthetic SQLite filesystem proof, not installed OPFS acceptance.
    const path = `/annotation-upgrade-${crypto.randomUUID()}.sqlite`;
    sqlite.capi.sqlite3_js_posix_create_file(path, sqlite.capi.sqlite3_js_db_export(db.pointer!));
    db.close();
    const reopened = new sqlite.oo1.DB(path, "w");
    databases.push(reopened);
    return reopened;
  }
  it.each([1, 2] as const)("upgrades source %i and reopens the exact ready catalog", source => {
    let db = fixture(source);
    expect(resume(db)).toBe(true);
    expect(pwaAnnotationPending(db, "unrelated")).toBe(false);
    db = reopen(db);
    const reference = open();
    expect(verifyPwaAnnotationCatalog(db, reference)).toBe(source === 1 ? 4 : 5);
    expect(resume(db)).toBe(true);
    expect(db.selectValue("SELECT origin_version FROM library_local_annotation_migration;")).toBe(source);
  });
  it("rejects an unknown catalog and dormant version without writes", () => {
    const db = fixture(1);
    db.exec("CREATE TABLE unexpected(x);");
    const before = db.selectValue("SELECT total_changes();");
    expect(() => resume(db)).toThrow("catalog mismatch");
    expect(db.selectValue("SELECT total_changes();")).toBe(before);
    db.exec("DROP TABLE unexpected; PRAGMA user_version=3;");
    expect(() => resume(db)).toThrow("unsupported");
    expect(db.selectValue("SELECT total_changes();")).toBe(before);
  });
  it("refuses building reads after reopen and resumes with the original pin", () => {
    let db = fixture(1);
    expect(resume(db)).toBe(true);
    db.exec("UPDATE library_local_annotation_migration SET phase='building';");
    db = reopen(db);
    expect(() => rejectPwaAnnotationBuilding(db)).toThrow("BUILDING");
    expect(() => pwaAnnotationPending(db, "unrelated")).toThrow("BUILDING");
    expect(resume(db)).toBe(true);
    expect(pwaAnnotationPending(db, "unrelated")).toBe(false);
  });
});
