import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";

describe("PWA Library Core SQLite engine", () => {
  let sqlite3: Sqlite3Static;
  let database: Database;

  beforeEach(async () => {
    sqlite3 = await sqlite3InitModule();
    database = new sqlite3.oo1.DB(":memory:", "c");
  });

  afterEach(() => {
    if (database.isOpen()) database.close();
  });

  it("installs and verifies the exact generated normalized schema", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    const status = engine.initialize();
    expect(status.schemaVersion).toBe(LIBRARY_CORE_SQLITE_SCHEMA_VERSION);
    expect(status.schemaSha256).toBe(LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256);
    expect(status.connectionGeneration).toBe(1);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM sqlite_schema WHERE name = 'library_feed_items';",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([1]);
  });

  it("fails closed when durable schema identity is changed", () => {
    const first = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    first.initialize();
    database.exec("UPDATE library_storage_meta SET schema_sha256 = lower(hex(randomblob(32)));");
    const second = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    expect(() => second.initialize()).toThrow(/does not match this build/);
  });
});
