import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import annotationBackfillFixture from "../../../shared/src/library-core/annotation-backfill-fixture-v1.sql?raw";
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
  function populate(db: Database): void {
    db.exec(annotationBackfillFixture);
    expect(db.exec({sql:"PRAGMA foreign_key_check;",returnValue:"resultRows"})).toEqual([]);
  }
  function finish(db: Database): void {
    for (let attempt=0;attempt<16;attempt++) if (resume(db)) return;
    throw new Error("Bounded synthetic backfill did not finish");
  }
  it("pages unfiltered populated history, pins revisions and resumes after reopen", () => {
    let db=fixture(1);
    populate(db);
    const before=db.selectValue("SELECT total_changes();");
    const now=vi.spyOn(performance,"now").mockReturnValueOnce(0).mockReturnValue(251);
    try { expect(resume(db)).toBe(false); } finally { now.mockRestore(); }
    expect(db.selectValue("SELECT total_changes();")).toBe(before);
    expect(resume(db)).toBe(false);
    const scanned=Number(db.selectValue("SELECT scanned_members FROM library_local_annotation_migration;"));
    expect(scanned).toBeGreaterThan(0);
    expect(scanned).toBeLessThanOrEqual(1024);
    db.exec("UPDATE library_meta SET source_revision=1;");
    const beforeDrift=db.selectValue("SELECT total_changes();");
    expect(()=>resume(db)).toThrow("source changed");
    expect(db.selectValue("SELECT total_changes();")).toBe(beforeDrift);
    db.exec("UPDATE library_meta SET source_revision=0;");
    db=reopen(db);
    finish(db);
    expect(db.selectValue("SELECT scanned_members FROM library_local_annotation_migration;")).toBe(1025);
    expect(db.selectValue("SELECT count(*) FROM library_local_annotation_unresolved;")).toBe(768);
    expect(pwaAnnotationPending(db,"item:257")).toBe(false);
    expect(pwaAnnotationPending(db,"item:258")).toBe(true);
  });
  it("rolls back a populated page failure and resumes the committed building receipt", () => {
    let db=fixture(1);
    populate(db);
    db.exec("UPDATE library_intent_members SET mutation_id='feed_item_annotations_replace';");
    let inserts=0;
    sqlite.capi.sqlite3_set_authorizer(db.pointer!,(_context,action,table)=>
      action===sqlite.capi.SQLITE_INSERT && table==="library_local_annotation_unresolved" && ++inserts===2
        ? sqlite.capi.SQLITE_DENY : sqlite.capi.SQLITE_OK,0);
    try { expect(()=>resume(db)).toThrow(); }
    finally { sqlite.capi.sqlite3_set_authorizer(db.pointer!,()=>sqlite.capi.SQLITE_OK,0); }
    expect(inserts).toBe(2);
    expect(db.selectValue("SELECT scanned_members FROM library_local_annotation_migration;")).toBe(0);
    expect(db.selectValue("SELECT count(*) FROM library_local_annotation_unresolved;")).toBe(0);
    expect(()=>rejectPwaAnnotationBuilding(db)).toThrow("BUILDING");
    db=reopen(db);
    finish(db);
    expect(db.selectValue("SELECT count(*) FROM library_local_annotation_unresolved;")).toBe(1025);
  });
  it("charges bounded result blobs against each aggregate page before parsing", () => {
    let db=fixture(1);
    populate(db);
    db.exec("UPDATE library_intent_members SET mutation_id='feed_item_annotations_replace';");
    // Deliberately unauthenticated identity-inconsistent result-shaped rows.
    // They must stay blocked; this tests migration byte accounting only.
    db.exec(`INSERT INTO library_intent_results
      SELECT transaction_id,actor_id,'epoch','epoch',first_counter,
        CASE WHEN first_counter=1 THEN NULL ELSE printf('%064d',first_counter-1) END,
        transaction_digest,'accepted',1,CAST(json_object('padding',printf('%0130000d',0)) AS BLOB),0
      FROM library_intent_transactions WHERE first_counter<=80;`);
    expect(resume(db)).toBe(false);
    const scanned=Number(db.selectValue("SELECT scanned_members FROM library_local_annotation_migration;"));
    expect(scanned).toBeGreaterThan(0);
    expect(scanned).toBeLessThanOrEqual(28); // At most seven 130KB blobs per page, four pages.
    db=reopen(db);
    finish(db);
    expect(db.selectValue("SELECT count(*) FROM library_local_annotation_unresolved;")).toBe(1025);
  });
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
    db.exec("DROP TABLE unexpected;");
    for (const [create, dropObject] of [
      ["CREATE TABLE sqliteX_unreviewed(x);", "DROP TABLE sqliteX_unreviewed;"],
      ["CREATE TRIGGER sqliteX_unreviewed_trigger AFTER UPDATE ON library_change_state BEGIN SELECT 1; END;", "DROP TRIGGER sqliteX_unreviewed_trigger;"],
    ]) {
      db.exec(create!);
      expect(() => resume(db)).toThrow("catalog mismatch");
      expect(db.selectValue("SELECT total_changes();")).toBe(before);
      db.exec(dropObject!);
    }
    db.exec("PRAGMA user_version=3;");
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
