import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SQL,
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
  LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_OPERATION_IDS,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  type LibraryCoreSqliteWorkerStatus,
  decodeLibraryCoreFeedPageCursorV1,
  decodeLibraryCoreChangeFeedCursorV1,
  encodeLibraryCoreChangeFeedCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  parseLibraryCoreChangeFeedRequestV1,
  parseLibraryCoreChangeFeedResponseV1,
  parseLibraryCoreFacetSummaryRequestV1,
  parseLibraryCoreFacetSummaryResponseV1,
  parseLibraryCorePreferencesSnapshotRequestV1,
  parseLibraryCorePreferencesSnapshotResponseV1,
  parseLibraryCoreItemDetailRequestV1,
  parseLibraryCoreItemDetailResponseV1,
  parseLibraryCoreItemReaderBodyRequestV1,
  parseLibraryCoreItemReaderBodyResponseV1,
  decodeLibraryCoreItemScanCursorV1,
  encodeLibraryCoreItemScanCursorV1,
  parseLibraryCoreItemScanRequestV1,
  parseLibraryCoreItemScanResponseV1,
  parseLibraryCorePersonDetailRequestV1,
  parseLibraryCorePersonDetailResponseV1,
  parseLibraryCoreAccountDetailRequestV1,
  parseLibraryCoreAccountDetailResponseV1,
  decodeLibraryCoreIdentityPageCursorV1,
  encodeLibraryCoreIdentityPageCursorV1,
  parseLibraryCoreAccountGraphPageRequestV1,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageRequestV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedGraphPageRequestV1,
  parseLibraryCoreRssFeedGraphPageResponseV1,
  encodeLibraryCoreCanonicalBase64,
  assertLibraryCoreNormalizedCheckpointPageBytesV2,
  createLibraryCoreMediaBlobDigestStateV1,
  decodeLibraryCoreCanonicalValue,
  decodeLibraryCoreContentChunkBytesV1,
  digestLibraryCoreMediaBlobBytesV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  LibraryCoreSha256,
  libraryCoreNormalizedCheckpointSqlitePayloadV2,
  parseLibraryCoreNormalizedCheckpointStageIdV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreFeedCardV1,
  type LibraryCoreChangeFeedRequestV1,
  type LibraryCoreChangeFeedResponseV1,
  type LibraryCoreFeedPageRequestV1,
  type LibraryCoreFeedPageResponseV1,
  type LibraryCoreFacetSummaryRequestV1,
  type LibraryCoreFacetSummaryResponseV1,
  type LibraryCorePreferencesSnapshotRequestV1,
  type LibraryCorePreferencesSnapshotResponseV1,
  type LibraryCoreItemDetailRequestV1,
  type LibraryCoreItemDetailResponseV1,
  type LibraryCoreItemReaderBodyRequestV1,
  type LibraryCoreItemReaderBodyResponseV1,
  type LibraryCoreItemScanRequestV1,
  type LibraryCoreItemScanResponseV1,
  type LibraryCorePersonDetailRequestV1,
  type LibraryCorePersonDetailResponseV1,
  type LibraryCoreAccountDetailRequestV1,
  type LibraryCoreAccountDetailResponseV1,
  type LibraryCoreAccountGraphPageRequestV1,
  type LibraryCoreAccountGraphPageResponseV1,
  type LibraryCorePersonGraphPageRequestV1,
  type LibraryCorePersonGraphPageResponseV1,
  type LibraryCoreRssFeedGraphPageRequestV1,
  type LibraryCoreRssFeedGraphPageResponseV1,
  type LibraryCoreSqliteQueryRequest,
  type LibraryCoreSqliteQueryResponseFor,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
} from "@freed/shared/library-core";

const stagedRecordDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-bytes/staged-checkpoint-record\u0000",
  (character) => character.charCodeAt(0),
);
const checkpointDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-records/normalized-checkpoint\u0000",
  (character) => character.charCodeAt(0),
);

function lengthBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(length), false);
  return bytes;
}

function validateCheckpointHeader(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): void {
  if (
    record.registryKey !== "00_checkpoint_header" ||
    record.primaryKey !== "checkpoint"
  ) {
    throw new Error("normalized checkpoint header identity is invalid");
  }
  const libraryId = record.payload.libraryId;
  const authorityEpoch = record.payload.authorityEpoch;
  const sourceRevision = record.payload.sourceRevision;
  if (
    typeof libraryId !== "string" ||
    typeof authorityEpoch !== "string" ||
    !Number.isSafeInteger(sourceRevision) ||
    record.payload.schemaVersion !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION ||
    record.payload.checkpointId !==
      `${libraryId}:${authorityEpoch}:${String(sourceRevision)}`
  ) {
    throw new Error("normalized checkpoint header version identity is invalid");
  }
}

function safeInteger(value: SqlValue | undefined, label: string): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new Error(`${label} is not a safe SQLite integer`);
  }
  return number;
}

function text(value: SqlValue | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} is not SQLite text`);
  }
  return value;
}

function nullableText(
  value: SqlValue | undefined,
  label: string,
): string | null {
  return value === null ? null : text(value, label);
}

function nullableInteger(
  value: SqlValue | undefined,
  label: string,
  allowNegativeOne = false,
): number | null {
  if (value === null) return null;
  const integer = safeInteger(value, label);
  if (integer < 0 && !(allowNegativeOne && integer === -1)) {
    throw new Error(`${label} is negative`);
  }
  return integer;
}

function nullableBoolean(
  value: SqlValue | undefined,
  label: string,
): boolean | null {
  if (value === null) return null;
  const integer = safeInteger(value, label);
  if (integer !== 0 && integer !== 1)
    throw new Error(`${label} is not boolean`);
  return integer === 1;
}

function requiredBoolean(
  value: SqlValue | undefined,
  label: string,
): boolean {
  const parsed = nullableBoolean(value, label);
  if (parsed === null) throw new Error(`${label} is null`);
  return parsed;
}

function stringArray(
  value: SqlValue | undefined,
  label: string,
): readonly string[] {
  const parsed = JSON.parse(text(value, label)) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${label} is not a text array`);
  }
  return Object.freeze(parsed);
}

function blobBytes(value: SqlValue | undefined, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${label} is not SQLite bytes`);
  }
  return value;
}

function feedCardFromSqliteRow(
  row: Record<string, SqlValue>,
): LibraryCoreFeedCardV1 {
  const candidate = {
    archived: nullableBoolean(row.archived, "feed archived"),
    authorAvatarUrl: nullableText(row.authorAvatarUrl, "feed author avatar"),
    authorDisplayName: nullableText(
      row.authorDisplayName,
      "feed author display name",
    ),
    authorHandle: nullableText(row.authorHandle, "feed author handle"),
    authorId: nullableText(row.authorId, "feed author identity"),
    capturedAt: nullableInteger(row.capturedAt, "feed captured time"),
    contentSignalTags: stringArray(
      row.contentSignalTagsJson,
      "feed signal tags",
    ),
    contentText: nullableText(row.contentText, "feed content text"),
    contentType: nullableText(row.contentType, "feed content type"),
    engagementComments: nullableInteger(
      row.engagementComments,
      "feed comments",
    ),
    engagementLikes: nullableInteger(row.engagementLikes, "feed likes"),
    eventConfidenceBasisPoints: nullableInteger(
      row.eventConfidenceBasisPoints,
      "feed event confidence",
    ),
    eventStartsAt: nullableInteger(row.eventStartsAt, "feed event start"),
    globalId: text(row.globalId, "feed item identity"),
    liked: nullableBoolean(row.liked, "feed liked"),
    likedAt: nullableInteger(row.likedAt, "feed liked time"),
    likedSyncedAt: nullableInteger(
      row.likedSyncedAt,
      "feed like sync time",
      true,
    ),
    linkPreviewTitle: nullableText(row.linkPreviewTitle, "feed link title"),
    locationName: nullableText(row.locationName, "feed location"),
    mediaTypes: stringArray(row.mediaTypesJson, "feed media types"),
    mediaUrls: stringArray(row.mediaUrlsJson, "feed media URLs"),
    platform: nullableText(row.platform, "feed platform"),
    publishedAt: nullableInteger(row.publishedAt, "feed published time"),
    readAt: nullableInteger(row.readAt, "feed read time"),
    readingTimeMinutes: nullableInteger(
      row.readingTimeMinutes,
      "feed reading time",
    ),
    saved: nullableBoolean(row.saved, "feed saved"),
    sourceUrl: nullableText(row.sourceUrl, "feed source URL"),
    tags: stringArray(row.tagsJson, "feed tags"),
  };
  const parsed = parseLibraryCoreFeedCardV1(candidate);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export class PwaLibraryCoreSqliteEngine {
  readonly #database: Database;
  readonly #sqliteVersion: string;
  #connectionGeneration = 0;

  constructor(database: Database, sqliteVersion: string) {
    this.#database = database;
    this.#sqliteVersion = sqliteVersion;
  }

  initialize(): LibraryCoreSqliteWorkerStatus {
    this.#database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY;",
    );
    const userVersion = safeInteger(
      this.#database.exec({
        sql: "PRAGMA user_version;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "SQLite user_version",
    );
    const applicationId = safeInteger(
      this.#database.exec({
        sql: "PRAGMA application_id;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "SQLite application_id",
    );
    if (userVersion === 0) {
      if (applicationId !== 0) {
        throw new Error("PWA Library SQLite application identity is foreign");
      }
      this.#database.exec(LIBRARY_CORE_NORMALIZED_SCHEMA_SQL);
      this.#database.exec({
        sql: `INSERT INTO library_storage_meta
              (singleton_id, contract_version, schema_version, protocol_version, schema_sha256)
              VALUES (1, ?1, ?2, ?3, ?4);`,
        bind: [
          LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
          LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
          LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
          LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
        ],
      });
      this.#database.exec(
        `PRAGMA user_version = ${LIBRARY_CORE_SQLITE_SCHEMA_VERSION};`,
      );
    } else if (userVersion !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION) {
      throw new Error("PWA Library SQLite schema version is unsupported");
    } else if (applicationId !== LIBRARY_CORE_SQLITE_APPLICATION_ID) {
      throw new Error("PWA Library SQLite application identity is unsupported");
    }
    this.#verifyStorageIdentity();
    for (const program of Object.values(
      LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS,
    )) {
      this.#database.prepare(program.sql).finalize();
    }
    const integrity = this.#database.exec({
      sql: "PRAGMA quick_check(1);",
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      throw new Error("PWA Library SQLite quick check failed");
    }
    this.#connectionGeneration += 1;
    return this.status();
  }

  status(): LibraryCoreSqliteWorkerStatus {
    if (this.#connectionGeneration === 0) {
      throw new Error("PWA Library SQLite is not initialized");
    }
    return Object.freeze({
      connectionGeneration: this.#connectionGeneration,
      contractVersion: LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
      engine: "sqlite-wasm-opfs-sahpool",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      schemaSha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
      schemaVersion: LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
      sqliteVersion: this.#sqliteVersion,
      storage: "opfs",
    });
  }

  beginNormalizedCheckpointStage(
    input: LibraryCoreBeginNormalizedCheckpointStageV2,
  ): LibraryCoreNormalizedCheckpointStageStatusV2 {
    const stage = parseLibraryCoreBeginNormalizedCheckpointStageV2(input);
    this.#database.exec({
      sql: `INSERT OR IGNORE INTO library_checkpoint_stages
              (stage_id, library_id, authority_epoch, source_revision,
               expected_record_count, expected_checkpoint_digest, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);`,
      bind: [
        stage.stageId,
        stage.libraryId,
        stage.authorityEpoch,
        stage.sourceRevision,
        stage.expectedRecordCount,
        stage.expectedCheckpointDigest,
        stage.createdAt,
      ],
    });
    const matches = this.#database.exec({
      sql: `SELECT library_id = ?2 AND authority_epoch = ?3 AND source_revision = ?4
                   AND expected_record_count = ?5 AND expected_checkpoint_digest = ?6
                   AND created_at = ?7
            FROM library_checkpoint_stages WHERE stage_id = ?1;`,
      bind: [
        stage.stageId,
        stage.libraryId,
        stage.authorityEpoch,
        stage.sourceRevision,
        stage.expectedRecordCount,
        stage.expectedCheckpointDigest,
        stage.createdAt,
      ],
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (
      matches.length !== 1 ||
      safeInteger(matches[0], "checkpoint stage replay") !== 1
    ) {
      throw new Error(
        "normalized checkpoint stage replay changed its identity",
      );
    }
    return this.#checkpointStageStatus(stage.stageId);
  }

  appendNormalizedCheckpointStagePage(
    input: LibraryCoreNormalizedCheckpointStagePageV2,
  ): LibraryCoreNormalizedCheckpointStageStatusV2 {
    const page = parseLibraryCoreNormalizedCheckpointStagePageV2(input);
    const records = page.records.map((record) => {
      const parsed = parseLibraryCoreNormalizedCheckpointRecordV2(record);
      const canonical = encodeLibraryCoreNormalizedCheckpointRecordV2(parsed);
      return {
        canonical,
        digest: new LibraryCoreSha256()
          .update(stagedRecordDigestPrefix)
          .update(canonical)
          .digestLowerHex(),
        primaryKey: encodeLibraryCoreCanonicalValue(parsed.primaryKey, {
          maximumBytes: 4_096,
        }),
        registryKey: parsed.registryKey,
      };
    });
    const pageBytes = records.reduce(
      (total, record) => total + record.canonical.byteLength,
      0,
    );
    assertLibraryCoreNormalizedCheckpointPageBytesV2(pageBytes);
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const expectedRows = this.#database.exec({
        sql: "SELECT expected_record_count FROM library_checkpoint_stages WHERE stage_id = ?1;",
        bind: [page.stageId],
        rowMode: 0,
        returnValue: "resultRows",
      });
      if (expectedRows.length !== 1) {
        throw new Error("normalized checkpoint stage does not exist");
      }
      const expectedRecordCount = safeInteger(
        expectedRows[0],
        "checkpoint expected record count",
      );
      for (const record of records) {
        this.#database.exec({
          sql: `INSERT OR IGNORE INTO library_checkpoint_stage_records
                  (stage_id, registry_key, primary_key_canonical, record_canonical, record_digest)
                VALUES (?1, ?2, ?3, ?4, ?5);`,
          bind: [
            page.stageId,
            record.registryKey,
            record.primaryKey,
            record.canonical,
            record.digest,
          ],
        });
        const replay = this.#database.exec({
          sql: `SELECT record_digest = ?4 AND record_canonical = ?5
                FROM library_checkpoint_stage_records
                WHERE stage_id = ?1 AND registry_key = ?2 AND primary_key_canonical = ?3;`,
          bind: [
            page.stageId,
            record.registryKey,
            record.primaryKey,
            record.digest,
            record.canonical,
          ],
          rowMode: 0,
          returnValue: "resultRows",
        });
        if (
          replay.length !== 1 ||
          safeInteger(replay[0], "checkpoint record replay") !== 1
        ) {
          throw new Error(
            "normalized checkpoint record replay changed its bytes",
          );
        }
      }
      const totals = this.#database.exec({
        sql: `SELECT count(*), coalesce(sum(length(record_canonical)), 0)
              FROM library_checkpoint_stage_records WHERE stage_id = ?1;`,
        bind: [page.stageId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const stagedRecordCount = safeInteger(
        totals[0]?.[0],
        "staged record count",
      );
      const stagedCanonicalBytes = safeInteger(
        totals[0]?.[1],
        "staged canonical bytes",
      );
      if (stagedRecordCount > expectedRecordCount) {
        throw new Error(
          "normalized checkpoint stage exceeds its expected record count",
        );
      }
      this.#database.exec({
        sql: `UPDATE library_checkpoint_stages
              SET staged_record_count = ?2, staged_canonical_bytes = ?3
              WHERE stage_id = ?1;`,
        bind: [page.stageId, stagedRecordCount, stagedCanonicalBytes],
      });
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
    return this.#checkpointStageStatus(page.stageId);
  }

  activateNormalizedCheckpointStage(
    input: string,
  ): LibraryCoreNormalizedCheckpointActivationReceiptV2 {
    const stageId = parseLibraryCoreNormalizedCheckpointStageIdV2(input);
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database.exec("PRAGMA defer_foreign_keys = ON;");
      const stages = this.#database.exec({
        sql: `SELECT library_id, authority_epoch, source_revision,
                     expected_record_count, staged_canonical_bytes,
                     expected_checkpoint_digest
              FROM library_checkpoint_stages
              WHERE stage_id = ?1 AND staged_record_count = expected_record_count;`,
        bind: [stageId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (stages.length !== 1) {
        throw new Error("normalized checkpoint stage is incomplete");
      }
      const stage = stages[0]!;
      const libraryId = text(stage[0], "checkpoint Library identity");
      const authorityEpoch = text(stage[1], "checkpoint authority epoch");
      const sourceRevision = safeInteger(
        stage[2],
        "checkpoint source revision",
      );
      const expectedRecordCount = safeInteger(
        stage[3],
        "checkpoint expected record count",
      );
      const canonicalBytes = safeInteger(
        stage[4],
        "checkpoint canonical bytes",
      );
      const expectedDigest = text(stage[5], "checkpoint digest");
      const existingRows = safeInteger(
        this.#database.exec({
          sql: `SELECT sum(row_count) FROM (
                  SELECT count(*) AS row_count FROM library_meta
                  UNION ALL SELECT count(*) FROM library_materialization_generation
                  UNION ALL SELECT count(*) FROM library_authority_epochs
                  UNION ALL SELECT count(*) FROM library_authority_frontier
                  UNION ALL SELECT count(*) FROM library_active_authority
                  UNION ALL SELECT count(*) FROM library_feed_items
                  UNION ALL SELECT count(*) FROM library_rss_feeds
                  UNION ALL SELECT count(*) FROM library_persons
                  UNION ALL SELECT count(*) FROM library_accounts
                  UNION ALL SELECT count(*) FROM library_preferences
                  UNION ALL SELECT count(*) FROM library_relationships
                  UNION ALL SELECT count(*) FROM library_field_clocks
                  UNION ALL SELECT count(*) FROM library_tombstones
                  UNION ALL SELECT count(*) FROM library_actors
                  UNION ALL SELECT count(*) FROM library_actor_capabilities
                  UNION ALL SELECT count(*) FROM library_actor_capability_mutations
                  UNION ALL SELECT count(*) FROM library_receipts
                  UNION ALL SELECT count(*) FROM library_blobs
                  UNION ALL SELECT count(*) FROM library_transactions
                  UNION ALL SELECT count(*) FROM library_invalidations
                  UNION ALL SELECT count(*) FROM library_intent_transactions
                );`,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "checkpoint activation target rows",
      );
      if (existingRows !== 0) {
        throw new Error("normalized checkpoint activation target is not empty");
      }
      const digest = new LibraryCoreSha256().update(checkpointDigestPrefix);
      const statement = this.#database.prepare(
        `SELECT record_canonical FROM library_checkpoint_stage_records
         WHERE stage_id = ?1 ORDER BY registry_key, primary_key_canonical;`,
      );
      let recordCount = 0;
      try {
        statement.bind([stageId]);
        while (statement.step()) {
          const canonical = Uint8Array.from(
            statement.getBlob(0) ??
              (() => {
                throw new Error(
                  "normalized checkpoint canonical record is missing",
                );
              })(),
          );
          digest.update(lengthBytes(canonical.byteLength));
          digest.update(canonical);
          const record = parseLibraryCoreNormalizedCheckpointRecordV2(
            decodeLibraryCoreCanonicalValue(canonical, {
              maximumBytes:
                LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
            }),
          );
          if (record.registryKey === "00_checkpoint_header") {
            validateCheckpointHeader(record);
          }
          const program =
            LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS[record.registryKey];
          const primaryKeyJson = JSON.stringify(record.primaryKey);
          const payloadJson = JSON.stringify(
            libraryCoreNormalizedCheckpointSqlitePayloadV2(record),
          );
          const bind: SqlValue[] = [primaryKeyJson, payloadJson];
          if (program.hasChunkBytes) {
            bind.push(decodeLibraryCoreContentChunkBytesV1(record));
          }
          this.#database.exec({ sql: program.sql, bind });
          const changes = safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "checkpoint import changes",
          );
          if (changes !== 1) {
            throw new Error(
              "checkpoint payload identity does not match its primary key",
            );
          }
          recordCount += 1;
        }
      } finally {
        statement.finalize();
      }
      const checkpointDigest = digest.digestLowerHex();
      if (
        recordCount !== expectedRecordCount ||
        checkpointDigest !== expectedDigest
      ) {
        throw new Error(
          "normalized checkpoint digest does not match its stage",
        );
      }
      const meta = this.#database.exec({
        sql: `SELECT library_id = ?1 AND authority_epoch = ?2 AND source_revision = ?3
              FROM library_meta WHERE singleton_id = 1;`,
        bind: [libraryId, authorityEpoch, sourceRevision],
        rowMode: 0,
        returnValue: "resultRows",
      });
      if (
        meta.length !== 1 ||
        safeInteger(meta[0], "checkpoint header match") !== 1
      ) {
        throw new Error("checkpoint header does not match its stage identity");
      }
      this.#database.exec({
        sql: `INSERT INTO library_materialization_generation
                (singleton_id, generation_id) VALUES (1, ?1);`,
        bind: [checkpointDigest],
      });
      this.#database.exec({
        sql: `UPDATE library_change_state SET revision = ?1
              WHERE singleton_id = 1 AND revision = 0;`,
        bind: [sourceRevision],
      });
      if (
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "checkpoint change revision activation",
        ) !== 1
      ) {
        throw new Error("checkpoint change revision could not be activated");
      }
      if (sourceRevision > 0) {
        this.#database.exec({
          sql: `INSERT INTO library_invalidations
                  (revision, ordinal, topic, entity_id, reset_required)
                VALUES (?1, 0, 'library', NULL, 1);`,
          bind: [sourceRevision],
        });
      }
      this.#verifyCheckpointContent();
      const foreignKeys = this.#database.exec({
        sql: "PRAGMA foreign_key_check;",
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (foreignKeys.length !== 0) {
        throw new Error(
          "normalized checkpoint has an unresolved foreign reference",
        );
      }
      this.#verifyCheckpointAuthority(libraryId, authorityEpoch);
      this.#database.exec({
        sql: "DELETE FROM library_checkpoint_stages WHERE stage_id = ?1;",
        bind: [stageId],
      });
      this.#database.exec("COMMIT;");
      return Object.freeze({
        authorityEpoch,
        canonicalBytes,
        checkpointDigest,
        libraryId,
        recordCount,
        sourceRevision,
        stageId,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  query<T extends LibraryCoreSqliteQueryRequest>(
    input: T,
  ): LibraryCoreSqliteQueryResponseFor<T> {
    switch (input.queryId) {
      case "account_detail_v1":
        return this.#queryAccountDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "account_graph_page_v1":
        return this.#queryAccountGraphPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "change_feed_v1":
        return this.#queryChangeFeed(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "library_facet_summary_v1":
        return this.#queryFacetSummary(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "feed_page_v1":
        return this.#queryFeedPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "item_detail_v1":
        return this.#queryItemDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "item_reader_body_v1":
        return this.#queryItemReaderBody(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "background_item_page_v1":
        return this.#queryItemScan(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "person_detail_v1":
        return this.#queryPersonDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "person_graph_page_v1":
        return this.#queryPersonGraphPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "rss_feed_graph_page_v1":
        return this.#queryRssFeedGraphPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "preferences_snapshot_v1":
        return this.#queryPreferencesSnapshot(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
    }
  }

  #querySource(): {
    readonly generationId: string;
    readonly sourceRevision: number;
  } {
    const rows = this.#database.exec({
      sql: `SELECT generation.generation_id, meta.source_revision, changes.revision
            FROM library_materialization_generation AS generation
            JOIN library_meta AS meta ON meta.singleton_id = generation.singleton_id
            JOIN library_change_state AS changes ON changes.singleton_id = generation.singleton_id
            WHERE generation.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA Library SQLite has no active materialization");
    }
    const generationId = text(rows[0]![0], "Library generation identity");
    const sourceRevision = safeInteger(rows[0]![1], "Library source revision");
    if (
      sourceRevision !== safeInteger(rows[0]![2], "Library change revision")
    ) {
      throw new Error("PWA Library SQLite change revisions disagree");
    }
    return Object.freeze({ generationId, sourceRevision });
  }

  #queryChangeFeed(
    input: LibraryCoreChangeFeedRequestV1,
  ): LibraryCoreChangeFeedResponseV1 {
    const request = parseLibraryCoreChangeFeedRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision: currentRevision } =
      this.#querySource();
    if (request.value.afterRevision > currentRevision) {
      throw new Error("PWA Library SQLite change-feed revision is ahead");
    }
    let upperRevision = currentRevision;
    let afterRevision = request.value.afterRevision;
    let afterOrdinal = 255;
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreChangeFeedCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.upperRevision > currentRevision
      ) {
        throw new Error("PWA Library SQLite change-feed cursor is stale");
      }
      upperRevision = cursor.value.upperRevision;
      afterRevision = cursor.value.revision;
      afterOrdinal = cursor.value.ordinal;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.change_feed_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        upperRevision,
        afterRevision,
        afterOrdinal,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite change feed exceeded its row bound");
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => {
      const resetRequired = nullableBoolean(
        row.resetRequired,
        "change-feed reset marker",
      );
      if (resetRequired === null) {
        throw new Error("change-feed reset marker is null");
      }
      return {
        entityId: nullableText(row.entityId, "change-feed entity identity"),
        ordinal: safeInteger(row.ordinal, "change-feed ordinal"),
        resetRequired,
        revision: safeInteger(row.revision, "change-feed revision"),
        topic: text(row.topic, "change-feed topic"),
      };
    });
    let previousRevision = afterRevision;
    for (const row of rows) {
      if (row.revision > previousRevision + 1 && !row.resetRequired) {
        throw new Error("PWA Library SQLite change feed has a revision gap");
      }
      previousRevision = row.revision;
    }
    const last = rows.at(-1);
    if (
      !hasMore &&
      request.value.afterRevision < upperRevision &&
      last?.revision !== upperRevision
    ) {
      throw new Error("PWA Library SQLite change feed is incomplete");
    }
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreChangeFeedCursorV1({
              afterRevision: request.value.afterRevision,
              generationId: generationId as never,
              ordinal: last.ordinal,
              revision: last.revision,
              upperRevision,
            })
          : null,
      queryId: "change_feed_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: upperRevision,
        transitionSequence: upperRevision,
      },
    };
    const parsed = parseLibraryCoreChangeFeedResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPreferencesSnapshot(
    input: LibraryCorePreferencesSnapshotRequestV1,
  ): LibraryCorePreferencesSnapshotResponseV1 {
    const request = parseLibraryCorePreferencesSnapshotRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.preferences_snapshot_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length >= program.maximumScanRows) {
      throw new Error("PWA Library SQLite preferences exceed their row bound");
    }
    const response = {
      queryId: "preferences_snapshot_v1" as const,
      rows: rawRows.map((row) => ({
        booleanValue:
          row.booleanValue === null
            ? null
            : nullableBoolean(row.booleanValue, "preference boolean"),
        integerValue: nullableInteger(row.integerValue, "preference integer"),
        path: text(row.path, "preference path"),
        realValue:
          row.realValue === null
            ? null
            : typeof row.realValue === "number" &&
                Number.isFinite(row.realValue)
              ? row.realValue
              : (() => {
                  throw new Error("preference real is invalid");
                })(),
        textValue: nullableText(row.textValue, "preference text"),
        updatedAt: safeInteger(row.updatedAt, "preference update time"),
        valueType: text(row.valueType, "preference value type"),
      })),
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCorePreferencesSnapshotResponseV1(response);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPersonDetail(
    input: LibraryCorePersonDetailRequestV1,
  ): LibraryCorePersonDetailResponseV1 {
    const request = parseLibraryCorePersonDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.person_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.personId],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite person detail exceeded its row bound",
      );
    }
    const row = rows[0];
    const person =
      row === undefined
        ? null
        : {
            avatarUrl: nullableText(row.avatarUrl, "Person avatar URL"),
            bio: nullableText(row.bio, "Person bio"),
            careLevel: safeInteger(row.careLevel, "Person care level"),
            createdAt: safeInteger(row.createdAt, "Person creation time"),
            id: text(row.id, "Person identity"),
            name: text(row.name, "Person name"),
            notes: nullableText(row.notes, "Person notes"),
            reachOutIntervalDays: nullableInteger(
              row.reachOutIntervalDays,
              "Person reach-out interval",
            ),
            reachOuts: JSON.parse(
              text(row.reachOutsJson, "Person reach-out rows"),
            ) as unknown,
            relationshipStatus: text(
              row.relationshipStatus,
              "Person relationship status",
            ),
            sampleBatchId: nullableText(
              row.sampleBatchId,
              "Person sample batch",
            ),
            sampleGeneratedAt: nullableInteger(
              row.sampleGeneratedAt,
              "Person sample generation time",
            ),
            sampleGeneratorVersion: nullableInteger(
              row.sampleGeneratorVersion,
              "Person sample generator version",
            ),
            tags: stringArray(row.tagsJson, "Person tags"),
            updatedAt: safeInteger(row.updatedAt, "Person update time"),
          };
    const response = {
      person,
      queryId: "person_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCorePersonDetailResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountDetail(
    input: LibraryCoreAccountDetailRequestV1,
  ): LibraryCoreAccountDetailResponseV1 {
    const request = parseLibraryCoreAccountDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.accountId],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite account detail exceeded its row bound",
      );
    }
    const row = rows[0];
    const account =
      row === undefined
        ? null
        : {
            address: nullableText(row.address, "Account address"),
            avatarUrl: nullableText(row.avatarUrl, "Account avatar URL"),
            createdAt: safeInteger(row.createdAt, "Account creation time"),
            discoveredFrom: text(
              row.discoveredFrom,
              "Account discovery source",
            ),
            displayName: nullableText(row.displayName, "Account display name"),
            email: nullableText(row.email, "Account email"),
            externalId: text(row.externalId, "Account external identity"),
            firstSeenAt: safeInteger(row.firstSeenAt, "Account first seen"),
            followRosterActive: nullableBoolean(
              row.followRosterActive,
              "Account follow-roster active",
            ),
            followRosterRoles: stringArray(
              row.followRosterRolesJson,
              "Account follow-roster roles",
            ),
            followRosterSyncedAt: nullableInteger(
              row.followRosterSyncedAt,
              "Account follow-roster sync time",
            ),
            handle: nullableText(row.handle, "Account handle"),
            id: text(row.id, "Account identity"),
            importedAt: nullableInteger(row.importedAt, "Account import time"),
            kind: text(row.kind, "Account kind"),
            lastSeenAt: safeInteger(row.lastSeenAt, "Account last seen"),
            personId: nullableText(row.personId, "Account Person identity"),
            phone: nullableText(row.phone, "Account phone"),
            profileUrl: nullableText(row.profileUrl, "Account profile URL"),
            provider: text(row.provider, "Account provider"),
            sampleBatchId: nullableText(
              row.sampleBatchId,
              "Account sample batch",
            ),
            sampleGeneratedAt: nullableInteger(
              row.sampleGeneratedAt,
              "Account sample generation time",
            ),
            sampleGeneratorVersion: nullableInteger(
              row.sampleGeneratorVersion,
              "Account sample generator version",
            ),
            updatedAt: safeInteger(row.updatedAt, "Account update time"),
          };
    const response = {
      account,
      queryId: "account_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreAccountDetailResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPersonGraphPage(
    input: LibraryCorePersonGraphPageRequestV1,
  ): LibraryCorePersonGraphPageResponseV1 {
    const request = parseLibraryCorePersonGraphPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision)
    ) {
      throw new Error("PWA Library SQLite Person graph cursor is stale");
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.person_graph_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        cursor?.ok ? cursor.value.entityId : null,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Person graph page exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => ({
      avatarUrl: nullableText(row.avatarUrl, "Person graph avatar URL"),
      careLevel: safeInteger(row.careLevel, "Person graph care level"),
      id: text(row.id, "Person graph identity"),
      lastReachOutAt: nullableInteger(
        row.lastReachOutAt,
        "Person graph last reach-out",
      ),
      name: text(row.name, "Person graph name"),
      reachOutIntervalDays: nullableInteger(
        row.reachOutIntervalDays,
        "Person graph reach-out interval",
      ),
      relationshipStatus: text(
        row.relationshipStatus,
        "Person graph relationship status",
      ),
      updatedAt: safeInteger(row.updatedAt, "Person graph update time"),
    }));
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreIdentityPageCursorV1({
              entityId: last.id,
              generationId,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "person_graph_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCorePersonGraphPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountGraphPage(
    input: LibraryCoreAccountGraphPageRequestV1,
  ): LibraryCoreAccountGraphPageResponseV1 {
    const request = parseLibraryCoreAccountGraphPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision)
    ) {
      throw new Error("PWA Library SQLite Account graph cursor is stale");
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_graph_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        cursor?.ok ? cursor.value.entityId : null,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Account graph page exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => ({
      avatarUrl: nullableText(row.avatarUrl, "Account graph avatar URL"),
      discoveredFrom: text(
        row.discoveredFrom,
        "Account graph discovery source",
      ),
      displayName: nullableText(row.displayName, "Account graph display name"),
      externalId: text(row.externalId, "Account graph external identity"),
      firstSeenAt: safeInteger(row.firstSeenAt, "Account graph first seen"),
      followRosterActive: nullableBoolean(
        row.followRosterActive,
        "Account graph follow-roster active",
      ),
      handle: nullableText(row.handle, "Account graph handle"),
      id: text(row.id, "Account graph identity"),
      kind: text(row.kind, "Account graph kind"),
      lastSeenAt: safeInteger(row.lastSeenAt, "Account graph last seen"),
      personId: nullableText(row.personId, "Account graph Person identity"),
      provider: text(row.provider, "Account graph provider"),
      updatedAt: safeInteger(row.updatedAt, "Account graph update time"),
    }));
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreIdentityPageCursorV1({
              entityId: last.id,
              generationId,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "account_graph_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreAccountGraphPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryRssFeedGraphPage(
    input: LibraryCoreRssFeedGraphPageRequestV1,
  ): LibraryCoreRssFeedGraphPageResponseV1 {
    const request = parseLibraryCoreRssFeedGraphPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision)
    ) {
      throw new Error("PWA Library SQLite RSS feed graph cursor is stale");
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.rss_feed_graph_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        cursor?.ok ? cursor.value.entityId : null,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite RSS feed graph page exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => ({
      enabled: requiredBoolean(row.enabled, "RSS feed graph enabled"),
      imageUrl: nullableText(row.imageUrl, "RSS feed graph image URL"),
      title: text(row.title, "RSS feed graph title"),
      updatedAt: safeInteger(row.updatedAt, "RSS feed graph update time"),
      url: text(row.url, "RSS feed graph URL"),
    }));
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreIdentityPageCursorV1({
              entityId: last.url,
              generationId,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "rss_feed_graph_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreRssFeedGraphPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFacetSummary(
    input: LibraryCoreFacetSummaryRequestV1,
  ): LibraryCoreFacetSummaryResponseV1 {
    const request = parseLibraryCoreFacetSummaryRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.library_facet_summary_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length !== program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite facet query returned an invalid row count",
      );
    }
    const row = rows[0]!;
    const response = {
      queryId: "library_facet_summary_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      summary: {
        archivedCount: safeInteger(row.archivedCount, "archived count"),
        sampleItemCount: safeInteger(row.sampleItemCount, "sample item count"),
        savedArchivedCount: safeInteger(
          row.savedArchivedCount,
          "saved archived count",
        ),
        savedCount: safeInteger(row.savedCount, "saved count"),
        savedPlatformCount: safeInteger(
          row.savedPlatformCount,
          "saved platform count",
        ),
        tags: stringArray(row.tagsJson, "facet tags"),
        totalCount: safeInteger(row.totalCount, "total count"),
      },
    };
    const parsed = parseLibraryCoreFacetSummaryResponseV1(response);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryItemDetail(
    input: LibraryCoreItemDetailRequestV1,
  ): LibraryCoreItemDetailResponseV1 {
    const request = parseLibraryCoreItemDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.item_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.globalId],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite item detail exceeded its row bound");
    }
    const row = rows[0];
    const response = {
      item:
        row === undefined
          ? null
          : {
              card: feedCardFromSqliteRow(row),
              contentBody: {
                blobDigest: nullableText(
                  row.contentBodyBlobDigest,
                  "content body digest",
                ),
                storage: text(row.contentBodyStorage, "content body storage"),
              },
              preservedBody: {
                blobDigest: nullableText(
                  row.preservedBodyBlobDigest,
                  "preserved body digest",
                ),
                storage: text(
                  row.preservedBodyStorage,
                  "preserved body storage",
                ),
              },
            },
      queryId: "item_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreItemDetailResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryItemReaderBody(
    input: LibraryCoreItemReaderBodyRequestV1,
  ): LibraryCoreItemReaderBodyResponseV1 {
    const request = parseLibraryCoreItemReaderBodyRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.item_reader_body_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.globalId,
        request.value.bodyKind,
        request.value.offsetBytes,
        request.value.limitBytes,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite reader body exceeded its row bound");
    }
    const metadata = rows[0];
    let body = null;
    if (metadata !== undefined) {
      if (safeInteger(metadata.chunkIndex, "reader metadata row") !== -1) {
        throw new Error("PWA Library SQLite reader metadata row is missing");
      }
      const storage = text(metadata.bodyStorage, "reader body storage");
      const contentLength = safeInteger(
        metadata.contentLength,
        "reader content length",
      );
      if (request.value.offsetBytes > contentLength) {
        throw new RangeError("reader body offset exceeds content length");
      }
      const endOffset = Math.min(
        contentLength,
        request.value.offsetBytes + request.value.limitBytes,
      );
      let range = new Uint8Array();
      if (request.value.offsetBytes < contentLength && storage === "inline") {
        const bytes = blobBytes(metadata.bytes, "inline reader body");
        if (bytes.byteLength !== contentLength) {
          throw new Error("inline reader body length is inconsistent");
        }
        range = bytes.slice(request.value.offsetBytes, endOffset);
      } else if (
        request.value.offsetBytes < contentLength &&
        storage === "blob"
      ) {
        const firstChunk = Math.floor(request.value.offsetBytes / 65_536);
        const lastChunk = Math.floor((endOffset - 1) / 65_536);
        const chunks = rows.slice(1);
        if (chunks.length !== lastChunk - firstChunk + 1) {
          throw new Error("reader body chunk range is incomplete");
        }
        const joined = new Uint8Array(
          chunks.reduce(
            (total, row) =>
              total + blobBytes(row.bytes, "reader body chunk").byteLength,
            0,
          ),
        );
        let writeOffset = 0;
        for (const [index, row] of chunks.entries()) {
          if (
            safeInteger(row.chunkIndex, "reader chunk index") !==
            firstChunk + index
          ) {
            throw new Error("reader body chunks are not contiguous");
          }
          const bytes = blobBytes(row.bytes, "reader body chunk");
          joined.set(bytes, writeOffset);
          writeOffset += bytes.byteLength;
        }
        const relativeStart = request.value.offsetBytes - firstChunk * 65_536;
        range = joined.slice(
          relativeStart,
          relativeStart + endOffset - request.value.offsetBytes,
        );
      }
      body = {
        blobDigest: nullableText(metadata.blobDigest, "reader body digest"),
        bytesBase64: encodeLibraryCoreCanonicalBase64(range),
        contentLength,
        endOffset: request.value.offsetBytes + range.byteLength,
        startOffset: request.value.offsetBytes,
        storage,
      };
    }
    const response = {
      body,
      queryId: "item_reader_body_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreItemReaderBodyResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryItemScan(
    input: LibraryCoreItemScanRequestV1,
  ): LibraryCoreItemScanResponseV1 {
    const request = parseLibraryCoreItemScanRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    let afterGlobalId: string | null = null;
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreItemScanCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite item scan cursor is stale");
      }
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.background_item_page_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [afterGlobalId, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite item scan exceeded its row bound");
    }
    const hasMore = rows.length > request.value.limit;
    const cards = rows
      .slice(0, request.value.limit)
      .map((row) => feedCardFromSqliteRow(row));
    const last = cards.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreItemScanCursorV1({
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "background_item_page_v1" as const,
      rows: cards,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreItemScanResponseV1(response, request.value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFeedPage(
    input: LibraryCoreFeedPageRequestV1,
  ): LibraryCoreFeedPageResponseV1 {
    const request = parseLibraryCoreFeedPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreFeedPageCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite feed cursor is stale");
      }
      afterPublishedAt = cursor.value.sortAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.feed_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [afterPublishedAt, afterGlobalId, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite feed query exceeded its row bound");
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreFeedCardV1[] = rawRows
      .slice(0, request.value.limit)
      .map(feedCardFromSqliteRow);
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last?.publishedAt !== null && last !== undefined
          ? encodeLibraryCoreFeedPageCursorV1({
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              sortAt: last.publishedAt,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "feed_page_v1",
      rows,
      schemaVersion: 1,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "feed total count",
      ),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(response)).byteLength;
    if (bytes > LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES) {
      throw new Error(
        "PWA Library SQLite feed response exceeded its byte bound",
      );
    }
    const parsed = parseLibraryCoreFeedPageResponseV1(response, request.value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #checkpointStageStatus(
    stageId: string,
  ): LibraryCoreNormalizedCheckpointStageStatusV2 {
    const rows = this.#database.exec({
      sql: `SELECT expected_record_count, staged_record_count, staged_canonical_bytes
            FROM library_checkpoint_stages WHERE stage_id = ?1;`,
      bind: [stageId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1)
      throw new Error("normalized checkpoint stage does not exist");
    const expectedRecordCount = safeInteger(
      rows[0]?.[0],
      "checkpoint expected record count",
    );
    const stagedRecordCount = safeInteger(
      rows[0]?.[1],
      "checkpoint staged record count",
    );
    return Object.freeze({
      complete: expectedRecordCount === stagedRecordCount,
      expectedRecordCount,
      stagedCanonicalBytes: safeInteger(
        rows[0]?.[2],
        "checkpoint staged canonical bytes",
      ),
      stagedRecordCount,
      stageId,
    });
  }

  #verifyCheckpointContent(): void {
    const descriptors = this.#database.prepare(
      "SELECT content_digest, byte_length, chunk_count FROM library_blobs ORDER BY content_digest;",
    );
    try {
      while (descriptors.step()) {
        const contentDigest = text(
          descriptors.get(0),
          "checkpoint content digest",
        );
        const expectedBytes = safeInteger(
          descriptors.get(1),
          "checkpoint content byte length",
        );
        const expectedChunks = safeInteger(
          descriptors.get(2),
          "checkpoint content chunk count",
        );
        const contentHash = createLibraryCoreMediaBlobDigestStateV1();
        const chunks = this.#database.prepare(
          `SELECT chunk_index, chunk_digest, bytes FROM library_blob_chunks
           WHERE content_digest = ?1 ORDER BY chunk_index;`,
        );
        let byteLength = 0;
        let chunkIndex = 0;
        try {
          chunks.bind([contentDigest]);
          while (chunks.step()) {
            if (
              safeInteger(chunks.get(0), "checkpoint content chunk index") !==
              chunkIndex
            ) {
              throw new Error("checkpoint content chunks are not contiguous");
            }
            const bytes = Uint8Array.from(
              chunks.getBlob(2) ??
                (() => {
                  throw new Error("checkpoint content chunk bytes are missing");
                })(),
            );
            if (
              text(chunks.get(1), "checkpoint content chunk digest") !==
              digestLibraryCoreMediaBlobBytesV1(bytes)
            ) {
              throw new Error("checkpoint content chunk digest is invalid");
            }
            byteLength += bytes.byteLength;
            if (!Number.isSafeInteger(byteLength)) {
              throw new Error("checkpoint content byte length overflowed");
            }
            contentHash.update(bytes);
            chunkIndex += 1;
          }
        } finally {
          chunks.finalize();
        }
        if (
          chunkIndex !== expectedChunks ||
          byteLength !== expectedBytes ||
          contentHash.digestLowerHex() !== contentDigest
        ) {
          throw new Error("checkpoint content descriptor is incomplete");
        }
      }
    } finally {
      descriptors.finalize();
    }
  }

  #verifyCheckpointAuthority(libraryId: string, authorityEpoch: string): void {
    const matches = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*)
              FROM library_active_authority AS active
              JOIN library_authority_epochs AS epoch
                ON epoch.epoch_id = active.epoch_id
              WHERE active.active_key = 'active'
                AND active.library_id = ?1
                AND active.epoch_id = ?2
                AND epoch.library_id = active.library_id
                AND epoch.accepted_manifest_generation = active.accepted_manifest_generation;`,
        bind: [libraryId, authorityEpoch],
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "checkpoint active authority",
    );
    if (matches !== 1) {
      throw new Error("checkpoint active authority does not match its header");
    }
    const actorWithoutCapability = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*)
              FROM library_actors AS actor
              WHERE actor.retired_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM library_actor_capabilities AS capability
                  WHERE capability.actor_id = actor.actor_id
                    AND capability.retired_at IS NULL
                );`,
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "checkpoint actors without capabilities",
    );
    if (actorWithoutCapability !== 0) {
      throw new Error(
        "checkpoint active actor does not have an active capability",
      );
    }
    const knownMutations = new Set<string>(LIBRARY_CORE_OPERATION_IDS);
    const mutations = this.#database.exec({
      sql: `SELECT DISTINCT mutation_id
            FROM library_actor_capability_mutations
            ORDER BY mutation_id;`,
      rowMode: 0,
      returnValue: "resultRows",
    });
    for (const mutation of mutations) {
      if (!knownMutations.has(text(mutation, "capability mutation"))) {
        throw new Error(
          "checkpoint actor capability names an unknown mutation",
        );
      }
    }
  }

  close(): void {
    this.#database.close();
  }

  #verifyStorageIdentity(): void {
    const rows = this.#database.exec({
      sql: `SELECT contract_version, schema_version, protocol_version, schema_sha256
            FROM library_storage_meta WHERE singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA Library SQLite storage identity is missing");
    }
    const applicationId = safeInteger(
      this.#database.exec({
        sql: "PRAGMA application_id;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "SQLite application identity",
    );
    const row = rows[0]!;
    if (
      applicationId !== LIBRARY_CORE_SQLITE_APPLICATION_ID ||
      safeInteger(row[0], "SQLite contract version") !==
        LIBRARY_CORE_SQLITE_CONTRACT_VERSION ||
      safeInteger(row[1], "SQLite schema version") !==
        LIBRARY_CORE_SQLITE_SCHEMA_VERSION ||
      safeInteger(row[2], "SQLite protocol version") !==
        LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
      text(row[3], "SQLite schema digest") !==
        LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256
    ) {
      throw new Error(
        "PWA Library SQLite storage identity does not match this build",
      );
    }
  }
}
