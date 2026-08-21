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

  it("pages normalized feed rows through the bounded named query", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize();
    database.exec(`
      INSERT INTO library_meta
        (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
      VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 1000);
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, content_text,
         hidden, saved, archived, updated_at)
      VALUES
        ('item-2', 'saved', 'article', 200, 200, 'author-1', 'ada', 'Ada', 'newer', 0, 1, 0, 200),
        ('item-1', 'rss', 'article', 100, 100, 'author-2', 'grace', 'Grace', 'older', 0, 0, 0, 100),
        ('hidden', 'saved', 'post', 300, 300, 'author-3', 'hidden', 'Hidden', 'nope', 1, 0, 0, 300);
      INSERT INTO library_feed_item_tags (global_id, tag) VALUES ('item-2', 'favorite');
      INSERT INTO library_feed_item_media (global_id, ordinal, source_url, media_type)
      VALUES ('item-2', 0, 'https://example.com/image', 'image');
    `);
    const request = {
      cancellationId: "cancel-1",
      cursor: null,
      limit: 1,
      queryId: "feed_page_v1" as const,
      readerSessionId: "reader-1",
      schemaVersion: 1 as const,
    };
    const first = engine.queryFeedPage(request);
    expect(first.totalCount).toBe(2);
    expect(first.rows.map((row) => row.globalId)).toEqual(["item-2"]);
    expect(first.rows[0]?.tags).toEqual(["favorite"]);
    expect(first.rows[0]?.mediaUrls).toEqual(["https://example.com/image"]);
    expect(first.nextCursor).not.toBeNull();
    const second = engine.queryFeedPage({ ...request, cursor: first.nextCursor });
    expect(second.rows.map((row) => row.globalId)).toEqual(["item-1"]);
    expect(second.nextCursor).toBeNull();
  });
});
