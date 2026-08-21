import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  createLibraryCoreNormalizedCheckpointRecordV2,
  digestLibraryCoreNormalizedCheckpointRecordsV2,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  splitLibraryCoreContentV1,
  type LibraryCoreNormalizedCheckpointRecordV2,
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

  function checkpointHeader(): LibraryCoreNormalizedCheckpointRecordV2 {
    return createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint",
      payload: {
        authorityEpoch: "epoch-1",
        checkpointId: "library-1:epoch-1:7",
        createdAtMs: 1_000,
        libraryId: "library-1",
        schemaVersion: 1,
        sourceRevision: 7,
      },
    });
  }

  function stageRecords(
    engine: PwaLibraryCoreSqliteEngine,
    records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
    stageId: string,
    expectedCheckpointDigest = digestLibraryCoreNormalizedCheckpointRecordsV2(
      records,
    ),
  ): void {
    engine.beginNormalizedCheckpointStage({
      authorityEpoch: "epoch-1",
      createdAt: 1_000,
      expectedCheckpointDigest,
      expectedRecordCount: records.length,
      libraryId: "library-1",
      sourceRevision: 7,
      stageId,
    });
    let page: LibraryCoreNormalizedCheckpointRecordV2[] = [];
    let pageBytes = 0;
    for (const record of records) {
      const recordBytes =
        encodeLibraryCoreNormalizedCheckpointRecordV2(record).byteLength;
      if (
        page.length > 0 &&
        (page.length === 128 ||
          pageBytes + recordBytes >
            LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES)
      ) {
        engine.appendNormalizedCheckpointStagePage({ records: page, stageId });
        page = [];
        pageBytes = 0;
      }
      page.push(record);
      pageBytes += recordBytes;
    }
    if (page.length > 0) {
      engine.appendNormalizedCheckpointStagePage({ records: page, stageId });
    }
  }

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
    const first = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    first.initialize();
    database.exec(
      "UPDATE library_storage_meta SET schema_sha256 = lower(hex(randomblob(32)));",
    );
    const second = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    expect(() => second.initialize()).toThrow(/does not match this build/);
  });

  it("pages normalized feed rows through the bounded named query", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
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
    const second = engine.queryFeedPage({
      ...request,
      cursor: first.nextCursor,
    });
    expect(second.rows.map((row) => row.globalId)).toEqual(["item-1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("stages bounded normalized records idempotently and rejects changed replay", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const header = checkpointHeader();
    const stage = {
      authorityEpoch: "epoch-1",
      createdAt: 1_000,
      expectedCheckpointDigest: digestLibraryCoreNormalizedCheckpointRecordsV2([
        header,
      ]),
      expectedRecordCount: 1,
      libraryId: "library-1",
      sourceRevision: 7,
      stageId: "stage-1",
    };
    expect(engine.beginNormalizedCheckpointStage(stage)).toMatchObject({
      complete: false,
      stagedRecordCount: 0,
    });
    const complete = engine.appendNormalizedCheckpointStagePage({
      records: [header],
      stageId: stage.stageId,
    });
    expect(complete.complete).toBe(true);
    expect(complete.stagedRecordCount).toBe(1);
    expect(complete.stagedCanonicalBytes).toBeGreaterThan(0);
    expect(
      engine.appendNormalizedCheckpointStagePage({
        records: [header],
        stageId: stage.stageId,
      }),
    ).toEqual(complete);
    const changed = createLibraryCoreNormalizedCheckpointRecordV2({
      ...header,
      payload: { ...header.payload, createdAtMs: 1_001 },
    });
    expect(() =>
      engine.appendNormalizedCheckpointStagePage({
        records: [changed],
        stageId: stage.stageId,
      }),
    ).toThrow(/replay changed its bytes/);
    expect(engine.beginNormalizedCheckpointStage(stage)).toEqual(complete);
    expect(() =>
      engine.beginNormalizedCheckpointStage({ ...stage, sourceRevision: 8 }),
    ).toThrow(/replay changed its identity/);
    expect(
      engine.activateNormalizedCheckpointStage(stage.stageId),
    ).toMatchObject({
      checkpointDigest: stage.expectedCheckpointDigest,
      libraryId: stage.libraryId,
      recordCount: 1,
      sourceRevision: stage.sourceRevision,
    });
    expect(
      database.exec({
        sql: "SELECT library_id FROM library_meta;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual(["library-1"]);
  });

  it("rolls back browser activation on digest mismatch and unresolved references", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const header = checkpointHeader();
    stageRecords(engine, [header], "bad-digest", "a".repeat(64) as never);
    expect(() =>
      engine.activateNormalizedCheckpointStage("bad-digest"),
    ).toThrow(/digest does not match/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_meta;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
    const orphan = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "13_feed_item_tag",
      primaryKey: ["missing-item", "favorite"],
      payload: { tag: "favorite" },
    });
    stageRecords(engine, [header, orphan], "orphan");
    expect(() => engine.activateNormalizedCheckpointStage("orphan")).toThrow(
      /unresolved foreign reference/,
    );
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_feed_item_tags;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it("activates a multi-page content blob losslessly without a large SQLite row", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const original = Uint8Array.from(
      { length: 4_194_304 },
      (_, index) => (index * 31 + 17) % 251,
    );
    const content = splitLibraryCoreContentV1({
      bytes: original,
      mediaType: "application/octet-stream",
    });
    const records = [checkpointHeader(), ...content];
    stageRecords(engine, records, "large-content");
    const receipt = engine.activateNormalizedCheckpointStage("large-content");
    expect(receipt.recordCount).toBe(records.length);
    expect(
      database.exec({
        sql: `SELECT count(*), sum(length(bytes)), max(length(bytes))
              FROM library_blob_chunks;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[64, original.byteLength, 65_536]]);
  });
});
