import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  createLibraryCoreNormalizedCheckpointRecordV2,
  decodeLibraryCoreCanonicalBase64,
  digestLibraryCoreNormalizedCheckpointRecordsV2,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  isLibraryCoreOperationInstanceId,
  splitLibraryCoreContentV1,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreOperationInstanceId,
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

  function operationId(value: string): LibraryCoreOperationInstanceId {
    if (!isLibraryCoreOperationInstanceId(value)) {
      throw new TypeError("invalid test operation instance ID");
    }
    return value;
  }

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

  function authorityRecords(): LibraryCoreNormalizedCheckpointRecordV2[] {
    return [
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "01_authority_epoch",
        primaryKey: "epoch-1",
        payload: {
          acceptedAt: 400,
          acceptedManifestGeneration: 7,
          authorityKeyId: "a".repeat(64),
          authorityPublicKey: "b".repeat(64),
          canonicalTransitionCertificate: "{}",
          checkpointFrontierDigest: "c".repeat(64),
          epochNumber: 1,
          libraryId: "library-1",
          materializedStateDigest: "d".repeat(64),
          transitionCertificateDigest: "e".repeat(64),
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "02_authority_frontier",
        primaryKey: ["epoch-1", 0],
        payload: {
          acceptedChainDigest: "3".repeat(64),
          acceptedCounter: 2,
          acceptedOperationId: "operation-2",
          actorId: "actor-1",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "03_active_authority",
        primaryKey: "active",
        payload: {
          acceptedManifestGeneration: 7,
          activatedAt: 400,
          activeKey: "active",
          epochId: "epoch-1",
          libraryId: "library-1",
          writerId: "writer-1",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "90_actor_state",
        primaryKey: "actor-1",
        payload: {
          acceptedChainDigest: "3".repeat(64),
          acceptedCounter: 2,
          acceptedOperationId: "operation-2",
          actorKind: "desktop",
          authorityEpochId: "epoch-1",
          canonicalEnrollmentCertificate: "{}",
          chainGenesisDigest: "2".repeat(64),
          createdAt: 500,
          enrollmentCertificateDigest: "1".repeat(64),
          enrollmentOperationId: "enroll-1",
          publicKey: "f".repeat(64),
          retiredAt: null,
          updatedAt: 1_000,
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "91_actor_capability",
        primaryKey: "capability-1",
        payload: {
          actorClass: "editor",
          actorId: "actor-1",
          canonicalCertificate: "{}",
          certificateDigest: "4".repeat(64),
          certificateVersion: 2,
          issuanceIdentity: "5".repeat(64),
          issuedAt: 500,
          retiredAt: null,
          retirementCertificateDigest: null,
          retirementIdentity: "6".repeat(64),
          scopeId: null,
          scopeKind: null,
          scopeMode: "library_wide",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "92_actor_capability_mutation",
        primaryKey: ["capability-1", "feed_item_read_assignment"],
        payload: { mutationId: "feed_item_read_assignment" },
      }),
    ];
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
        sql: "PRAGMA application_id;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([LIBRARY_CORE_SQLITE_APPLICATION_ID]);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM sqlite_schema WHERE name = 'library_feed_items';",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([1]);
    for (const table of [
      "library_authority_epochs",
      "library_active_authority",
      "library_actor_capabilities",
      "library_transactions",
      "library_operations",
      "library_replication_outbox",
      "library_invalidations",
      "library_intent_transactions",
      "library_intent_members",
      "library_intent_results",
      "library_optimistic_fields",
    ]) {
      expect(
        database.exec({
          sql: "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1;",
          bind: [table],
          rowMode: 0,
          returnValue: "resultRows",
        }),
      ).toEqual([1]);
    }
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

  it("refuses a foreign SQLite application identity before creating tables", () => {
    database.exec("PRAGMA application_id = 7;");
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    expect(() => engine.initialize()).toThrow(/identity is foreign/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM sqlite_schema WHERE type = 'table';",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
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
    const blobDigest = "7".repeat(64);
    const firstChunk = new Uint8Array(65_536).fill(11);
    const secondChunk = Uint8Array.from([21, 22, 23, 24, 25, 26, 27, 28]);
    database.exec({
      sql: `INSERT INTO library_blobs
              (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
            VALUES (?1, ?2, 65536, 2, 'text/plain');`,
      bind: [blobDigest, firstChunk.byteLength + secondChunk.byteLength],
    });
    database.exec({
      sql: `INSERT INTO library_blob_chunks
              (content_digest, chunk_index, chunk_digest, bytes)
            VALUES (?1, 0, ?2, ?3), (?1, 1, ?4, ?5);`,
      bind: [
        blobDigest,
        "8".repeat(64),
        firstChunk,
        "9".repeat(64),
        secondChunk,
      ],
    });
    database.exec({
      sql: `UPDATE library_feed_items
            SET preserved_text_blob_digest = ?1
            WHERE global_id = 'item-2';`,
      bind: [blobDigest],
    });
    const request = {
      cancellationId: operationId("cancel-1"),
      cursor: null,
      limit: 1,
      queryId: "feed_page_v1" as const,
      readerSessionId: operationId("reader-1"),
      schemaVersion: 1 as const,
    };
    const first = engine.query(request);
    expect(first.totalCount).toBe(2);
    expect(first.rows.map((row) => row.globalId)).toEqual(["item-2"]);
    expect(first.rows[0]?.tags).toEqual(["favorite"]);
    expect(first.rows[0]?.mediaUrls).toEqual(["https://example.com/image"]);
    expect(first.nextCursor).not.toBeNull();
    const second = engine.query({
      ...request,
      cursor: first.nextCursor,
    });
    expect(second.rows.map((row) => row.globalId)).toEqual(["item-1"]);
    expect(second.nextCursor).toBeNull();
    expect(
      engine.query({
        globalId: "item-2",
        queryId: "item_detail_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      item: {
        card: { contentText: "newer", globalId: "item-2" },
        contentBody: { blobDigest: null, storage: "inline" },
        preservedBody: { blobDigest, storage: "blob" },
      },
      queryId: "item_detail_v1",
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        globalId: "missing",
        queryId: "item_detail_v1",
        schemaVersion: 1,
      }).item,
    ).toBeNull();
    const inlineBody = engine.query({
      bodyKind: "content",
      globalId: "item-2",
      limitBytes: 3,
      offsetBytes: 1,
      queryId: "item_reader_body_v1",
      schemaVersion: 1,
    }).body;
    expect(inlineBody).toMatchObject({
      blobDigest: null,
      contentLength: 5,
      endOffset: 4,
      startOffset: 1,
      storage: "inline",
    });
    expect(
      new TextDecoder().decode(
        decodeLibraryCoreCanonicalBase64(inlineBody?.bytesBase64 ?? ""),
      ),
    ).toBe("ewe");
    const blobBody = engine.query({
      bodyKind: "preserved",
      globalId: "item-2",
      limitBytes: 6,
      offsetBytes: 65_534,
      queryId: "item_reader_body_v1",
      schemaVersion: 1,
    }).body;
    expect(blobBody).toMatchObject({
      blobDigest,
      contentLength: 65_544,
      endOffset: 65_540,
      startOffset: 65_534,
      storage: "blob",
    });
    expect(
      decodeLibraryCoreCanonicalBase64(blobBody?.bytesBase64 ?? ""),
    ).toEqual(Uint8Array.from([11, 11, 21, 22, 23, 24]));
    expect(
      engine.query({
        bodyKind: "preserved",
        globalId: "missing",
        limitBytes: 1,
        offsetBytes: 0,
        queryId: "item_reader_body_v1",
        schemaVersion: 1,
      }).body,
    ).toBeNull();
    expect(() =>
      engine.query({
        bodyKind: "content",
        globalId: "item-2",
        limitBytes: 1,
        offsetBytes: 6,
        queryId: "item_reader_body_v1",
        schemaVersion: 1,
      }),
    ).toThrow(/offset exceeds content length/);
    expect(
      engine.query({
        queryId: "library_facet_summary_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      queryId: "library_facet_summary_v1",
      source: { projectionRevision: 7 },
      summary: {
        archivedCount: 0,
        sampleItemCount: 0,
        savedArchivedCount: 0,
        savedCount: 1,
        savedPlatformCount: 1,
        tags: ["favorite"],
        totalCount: 3,
      },
    });
    database.exec(`
      INSERT INTO library_preferences
        (path, value_type, boolean_value, integer_value, real_value, text_value, updated_at)
      VALUES
        ('😀', 'boolean', 1, NULL, NULL, NULL, 1),
        ('alpha', 'integer', NULL, 3, NULL, NULL, 2),
        ('real-value', 'real', NULL, NULL, 0.5, NULL, 3),
        ('text-value', 'text', NULL, NULL, NULL, 'neon', 4),
        ('', 'null', NULL, NULL, NULL, NULL, 5);
    `);
    expect(
      engine.query({
        queryId: "preferences_snapshot_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      queryId: "preferences_snapshot_v1",
      rows: [
        { integerValue: 3, path: "alpha", valueType: "integer" },
        { path: "real-value", realValue: 0.5, valueType: "real" },
        { path: "text-value", textValue: "neon", valueType: "text" },
        { path: "\ue000", valueType: "null" },
        { booleanValue: true, path: "😀", valueType: "boolean" },
      ],
      source: { projectionRevision: 7 },
    });
  });

  it("stages bounded normalized records idempotently and rejects changed replay", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const header = checkpointHeader();
    const records = [header, ...authorityRecords()];
    const stage = {
      authorityEpoch: "epoch-1",
      createdAt: 1_000,
      expectedCheckpointDigest:
        digestLibraryCoreNormalizedCheckpointRecordsV2(records),
      expectedRecordCount: records.length,
      libraryId: "library-1",
      sourceRevision: 7,
      stageId: "stage-1",
    };
    expect(engine.beginNormalizedCheckpointStage(stage)).toMatchObject({
      complete: false,
      stagedRecordCount: 0,
    });
    const complete = engine.appendNormalizedCheckpointStagePage({
      records,
      stageId: stage.stageId,
    });
    expect(complete.complete).toBe(true);
    expect(complete.stagedRecordCount).toBe(records.length);
    expect(complete.stagedCanonicalBytes).toBeGreaterThan(0);
    expect(
      engine.appendNormalizedCheckpointStagePage({
        records,
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
      recordCount: records.length,
      sourceRevision: stage.sourceRevision,
    });
    expect(
      database.exec({
        sql: "SELECT library_id FROM library_meta;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual(["library-1"]);
    expect(
      database.exec({
        sql: "SELECT revision FROM library_change_state;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([7]);
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

  it("refuses browser activation without accepted authority", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const records = [checkpointHeader()];
    stageRecords(engine, records, "missing-authority");
    expect(() =>
      engine.activateNormalizedCheckpointStage("missing-authority"),
    ).toThrow(/active authority/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_meta;",
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
    const records = [checkpointHeader(), ...authorityRecords(), ...content];
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
