import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import { CONTENT_SIGNAL_KEYS } from "@freed/shared";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SQL,
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
  LIBRARY_CORE_SQLITE_LOCAL_MUTATION_PROGRAMS,
  LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
  LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_OPERATION_IDS,
  LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  type LibraryCoreSqliteWorkerStatus,
  type LibraryCoreCanonicalValue,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerIntentPageRequestV1,
  type LibraryCoreFollowerIntentPageResponseV1,
  type LibraryCoreFollowerIntentPublicationReceiptV1,
  type LibraryCoreFollowerIntentPublicationV1,
  type LibraryCoreFollowerResultApplyReceiptV1,
  type LibraryCoreFollowerResultApplyV1,
  type LibraryCoreAcceptedActorStateV1,
  encodeLibraryCoreDigestInput,
  parseLibraryCoreFollowerIntentCommitV1,
  parseLibraryCoreFollowerIntentPageRequestV1,
  parseLibraryCoreFollowerIntentPageResponseV1,
  parseLibraryCoreFollowerIntentPublicationV1,
  parseLibraryCoreFollowerResultApplyV1,
  parseLibraryCoreFollowerResultEnvelopeV1,
  sha256LowerHex,
  verifyLibraryCoreEd25519WithWebCrypto,
  verifyLibraryCoreOperationTransactionV1,
  verifyLibraryCoreFollowerResultV1,
  decodeLibraryCoreFeedPageCursorV1,
  decodeLibraryCoreFeedBrowsePageCursorV2,
  decodeLibraryCoreChangeFeedCursorV1,
  encodeLibraryCoreChangeFeedCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedBrowsePageCursorV2,
  libraryCoreFeedBrowseBindingDigestV3,
  libraryCoreFeedBrowseFilterDigestV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  parseLibraryCoreFeedBrowsePageRequestV3,
  parseLibraryCoreFeedBrowsePageResponseV3,
  parseLibraryCoreChangeFeedRequestV1,
  parseLibraryCoreChangeFeedResponseV1,
  parseLibraryCoreFacetSummaryRequestV1,
  parseLibraryCoreFacetSummaryResponseV1,
  parseLibraryCoreSavedAnalyticsRequestV2,
  parseLibraryCoreSavedAnalyticsResponseV2,
  decodeLibraryCoreSavedFeedPageCursorV2,
  encodeLibraryCoreSavedFeedPageCursorV2,
  parseLibraryCoreSavedFeedCardV1,
  parseLibraryCoreSavedFeedPageRequestV2,
  parseLibraryCoreSavedFeedPageResponseV2,
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
  decodeLibraryCoreContentFetchPageCursorV1,
  encodeLibraryCoreContentFetchPageCursorV1,
  parseLibraryCoreContentFetchPageRequestV1,
  parseLibraryCoreContentFetchPageResponseV1,
  decodeLibraryCoreProviderMediaPageCursorV1,
  encodeLibraryCoreProviderMediaPageCursorV1,
  libraryCoreProviderMediaBindingDigestV1,
  parseLibraryCoreProviderMediaPageRequestV1,
  parseLibraryCoreProviderMediaPageResponseV1,
  parseLibraryCorePersonDetailRequestV1,
  parseLibraryCorePersonDetailResponseV1,
  decodeLibraryCorePersonTimelineCursorV1,
  encodeLibraryCorePersonTimelineCursorV1,
  libraryCorePersonTimelinePersonDigestV1,
  parseLibraryCorePersonTimelineRequestV1,
  parseLibraryCorePersonTimelineResponseV1,
  parseLibraryCoreMapMarkersRequestV1,
  parseLibraryCoreMapMarkersResponseV1,
  parseLibraryCoreStoryWallCandidatesRequestV1,
  parseLibraryCoreStoryWallCandidatesResponseV1,
  parseLibraryCoreAccountDetailRequestV1,
  parseLibraryCoreAccountDetailResponseV1,
  parseLibraryCoreRssFeedDetailRequestV1,
  parseLibraryCoreRssFeedDetailResponseV1,
  decodeLibraryCoreAccountTimelineCursorV1,
  encodeLibraryCoreAccountTimelineCursorV1,
  libraryCoreAccountTimelineAccountDigestV1,
  parseLibraryCoreAccountTimelineRequestV1,
  parseLibraryCoreAccountTimelineResponseV1,
  decodeLibraryCoreSearchPageCursorV1,
  encodeLibraryCoreSearchPageCursorV1,
  libraryCoreSearchPageRequestDigestV1,
  parseLibraryCoreSearchPageRequestV1,
  parseLibraryCoreSearchPageResponseV1,
  scoreLibraryCoreSearchFieldsWithBudgetV1,
  tokenizeLibraryCoreSearchTextV1,
  isLibraryCoreEntityId,
  decodeLibraryCoreIdentityPageCursorV1,
  encodeLibraryCoreIdentityPageCursorV1,
  parseLibraryCoreAccountGraphPageRequestV1,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageRequestV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedGraphPageRequestV1,
  parseLibraryCoreRssFeedGraphPageResponseV1,
  parseLibraryCorePersonsGraphRequestV1,
  parseLibraryCorePersonsGraphResponseV1,
  parseLibraryCoreDeviceGraphLayoutMutationV1,
  parseLibraryCoreDeviceGraphLayoutMutationResultV1,
  digestLibraryCoreScopeActionRequestV1,
  parseLibraryCoreScopeActionRequestV1,
  type LibraryCoreScopeActionRequestV1,
  type LibraryCoreScopeActionStagePageV1,
  type LibraryCoreScopeActionStageStatusV1,
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
  type LibraryCoreFeedBrowsePageRequestV3,
  type LibraryCoreFeedBrowsePageResponseV3,
  type LibraryCoreFacetSummaryRequestV1,
  type LibraryCoreFacetSummaryResponseV1,
  type LibraryCoreSavedAnalyticsRequestV2,
  type LibraryCoreSavedAnalyticsResponseV2,
  type LibraryCoreSavedFeedCardV1,
  type LibraryCoreSavedFeedPageRequestV2,
  type LibraryCoreSavedFeedPageResponseV2,
  type LibraryCorePreferencesSnapshotRequestV1,
  type LibraryCorePreferencesSnapshotResponseV1,
  type LibraryCoreItemDetailRequestV1,
  type LibraryCoreItemDetailResponseV1,
  type LibraryCoreItemReaderBodyRequestV1,
  type LibraryCoreItemReaderBodyResponseV1,
  type LibraryCoreItemScanRequestV1,
  type LibraryCoreItemScanResponseV1,
  type LibraryCoreContentFetchPageRequestV1,
  type LibraryCoreContentFetchPageResponseV1,
  type LibraryCoreProviderMediaPageRequestV1,
  type LibraryCoreProviderMediaPageResponseV1,
  type LibraryCoreProviderMediaRowV1,
  type LibraryCorePersonDetailRequestV1,
  type LibraryCorePersonDetailResponseV1,
  type LibraryCorePersonTimelineRequestV1,
  type LibraryCorePersonTimelineResponseV1,
  type LibraryCoreMapMarkerV1,
  type LibraryCoreMapMarkersRequestV1,
  type LibraryCoreMapMarkersResponseV1,
  type LibraryCoreStoryWallCandidateV1,
  type LibraryCoreStoryWallCandidatesRequestV1,
  type LibraryCoreStoryWallCandidatesResponseV1,
  type LibraryCoreAccountDetailRequestV1,
  type LibraryCoreAccountDetailResponseV1,
  type LibraryCoreRssFeedDetailRequestV1,
  type LibraryCoreRssFeedDetailResponseV1,
  type LibraryCoreAccountTimelineRequestV1,
  type LibraryCoreAccountTimelineResponseV1,
  type LibraryCoreSearchFieldV1,
  type LibraryCoreSearchPageRequestV1,
  type LibraryCoreSearchPageResponseV1,
  type LibraryCoreAccountGraphPageRequestV1,
  type LibraryCoreAccountGraphPageResponseV1,
  type LibraryCorePersonGraphPageRequestV1,
  type LibraryCorePersonGraphPageResponseV1,
  type LibraryCoreRssFeedGraphPageRequestV1,
  type LibraryCoreRssFeedGraphPageResponseV1,
  type LibraryCorePersonsGraphRequestV1,
  type LibraryCorePersonsGraphResponseV1,
  type LibraryCoreDeviceGraphLayoutMutationV1,
  type LibraryCoreDeviceGraphLayoutMutationResultV1,
  type LibraryCoreSqliteQueryRequest,
  type LibraryCoreSqliteQueryResponseFor,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreSqliteMutationProgramId,
} from "@freed/shared/library-core";

type LibraryCoreSqliteMutationProgram =
  (typeof LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS)[LibraryCoreSqliteMutationProgramId];

const stagedRecordDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-bytes/staged-checkpoint-record\u0000",
  (character) => character.charCodeAt(0),
);
const checkpointDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-records/normalized-checkpoint\u0000",
  (character) => character.charCodeAt(0),
);
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

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

function bytes(value: SqlValue | undefined, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${label} is not a SQLite blob`);
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

function nullableFiniteNumber(
  value: SqlValue | undefined,
  label: string,
): number | null {
  if (value === null) return null;
  const number = typeof value === "bigint" ? Number(value) : value;
  if (
    typeof number !== "number" ||
    !Number.isFinite(number) ||
    Math.abs(number) > 1_000_000_000
  ) {
    throw new Error(`${label} is not a bounded SQLite number`);
  }
  return number;
}

function sqliteMutationProgram(
  operationType: string,
): LibraryCoreSqliteMutationProgram {
  if (!Object.hasOwn(LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, operationType)) {
    throw new TypeError(
      `SQLite mutation materializer is not registered for ${operationType}`,
    );
  }
  return LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS[
    operationType as LibraryCoreSqliteMutationProgramId
  ];
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

function requiredBoolean(value: SqlValue | undefined, label: string): boolean {
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

function savedFeedCardFromSqliteRow(
  row: Record<string, SqlValue>,
): LibraryCoreSavedFeedCardV1 {
  const parsed = parseLibraryCoreSavedFeedCardV1({
    ...feedCardFromSqliteRow(row),
    savedAt: nullableInteger(row.savedAt, "saved feed saved time"),
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function searchScoreFromSqliteRow(
  row: Record<string, SqlValue>,
  queryTerms: readonly string[],
): number {
  const fields: LibraryCoreSearchFieldV1[] = [];
  let termCount = 0;
  const collect = (value: string, weight: number, maximumTerms = 368) => {
    if (termCount >= maximumTerms || value.length === 0) return;
    const terms = tokenizeLibraryCoreSearchTextV1(
      value,
      maximumTerms - termCount,
    );
    if (terms.length === 0) return;
    fields.push(Object.freeze({ terms, weight }));
    termCount += terms.length;
  };
  const nullableSearchText = (key: string) =>
    row[key] === null ? "" : text(row[key], `search ${key}`);
  const joined = (key: string) =>
    stringArray(row[key], `search ${key}`).join(" ");
  collect(nullableSearchText("linkPreviewTitle"), 4);
  collect(
    `${joined("searchTopicsJson")} ${joined("contentSignalTagsJson")}`,
    3,
  );
  collect(
    [
      nullableSearchText("searchEventTitle"),
      nullableSearchText("searchEventLocation"),
      nullableSearchText("searchEventEvidence"),
      nullableSearchText("locationName"),
    ].join(" "),
    3,
  );
  collect(joined("tagsJson"), 3);
  collect(nullableSearchText("authorDisplayName"), 3);
  collect(nullableSearchText("authorHandle"), 3);
  collect(nullableSearchText("authorId"), 3);
  collect(nullableSearchText("searchContentText"), 2);
  collect(nullableSearchText("searchLinkDescription"), 2);
  collect(nullableSearchText("searchRssFeedTitle"), 2);
  collect(joined("searchHighlightsJson"), 2);
  collect(nullableSearchText("searchPreservedText"), 1);
  collect(nullableSearchText("searchAccountAliases"), 3, 384);
  return scoreLibraryCoreSearchFieldsWithBudgetV1(fields, queryTerms, 65_536)
    .score;
}

export class PwaLibraryCoreSqliteEngine {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #sqliteVersion: string;
  readonly #subtle: SubtleCrypto;
  #connectionGeneration = 0;

  constructor(
    database: Database,
    sqliteVersion: string,
    dependencies: Readonly<{
      now?: () => number;
      subtle?: SubtleCrypto;
    }> = {},
  ) {
    this.#database = database;
    this.#now = dependencies.now ?? Date.now;
    this.#sqliteVersion = sqliteVersion;
    this.#subtle = dependencies.subtle ?? crypto.subtle;
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
               expected_record_count, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6);`,
      bind: [
        stage.stageId,
        stage.libraryId,
        stage.authorityEpoch,
        stage.sourceRevision,
        stage.expectedRecordCount,
        stage.createdAt,
      ],
    });
    const matches = this.#database.exec({
      sql: `SELECT library_id = ?2 AND authority_epoch = ?3 AND source_revision = ?4
                   AND expected_record_count = ?5 AND created_at = ?6
            FROM library_checkpoint_stages WHERE stage_id = ?1;`,
      bind: [
        stage.stageId,
        stage.libraryId,
        stage.authorityEpoch,
        stage.sourceRevision,
        stage.expectedRecordCount,
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
                     expected_record_count, staged_canonical_bytes
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
      if (recordCount !== expectedRecordCount) {
        throw new Error(
          "normalized checkpoint record count does not match its stage",
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

  mutateDeviceGraphLayout(
    input: LibraryCoreDeviceGraphLayoutMutationV1,
  ): LibraryCoreDeviceGraphLayoutMutationResultV1 {
    const parsed = parseLibraryCoreDeviceGraphLayoutMutationV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const mutation = parsed.value;
    const program =
      LIBRARY_CORE_SQLITE_LOCAL_MUTATION_PROGRAMS[mutation.mutationId];
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const targetExists = safeInteger(
        this.#database.exec({
          sql: program.targetExistsSql,
          bind: [mutation.entityId],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "device graph layout target existence",
      );
      if (targetExists !== 1) {
        throw new Error("device graph layout target is unavailable");
      }
      this.#database.exec({
        sql: program.sql,
        bind:
          "graphX" in mutation
            ? [
                mutation.entityId,
                mutation.graphX,
                mutation.graphY,
                mutation.updatedAt,
              ]
            : [mutation.entityId],
      });
      const changed = safeInteger(
        this.#database.exec({
          sql: "SELECT changes();",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "device graph layout mutation row count",
      );
      if (changed > program.maximumRows) {
        throw new Error("device graph layout mutation exceeded its row bound");
      }
      if (changed === 1) {
        this.#database.exec({
          sql: `UPDATE library_device_graph_layout_state
                SET revision = revision + 1
                WHERE singleton_id = 1 AND revision < 9007199254740991;`,
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "device graph layout revision change",
          ) !== 1
        ) {
          throw new Error("device graph layout revision cannot advance");
        }
      }
      const layoutRevision = safeInteger(
        this.#database.exec({
          sql: "SELECT revision FROM library_device_graph_layout_state WHERE singleton_id = 1;",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "device graph layout revision",
      );
      const result = parseLibraryCoreDeviceGraphLayoutMutationResultV1({
        changed: changed === 1,
        layoutRevision,
        mutationId: mutation.mutationId,
        schemaVersion: 1,
      });
      if (!result.ok) throw new Error(result.error);
      this.#database.exec("COMMIT;");
      return result.value;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  async commitFollowerIntent(
    input: LibraryCoreFollowerIntentCommitV1,
  ): Promise<LibraryCoreFollowerIntentCommitResultV1> {
    const commit = parseLibraryCoreFollowerIntentCommitV1(input);
    const firstCandidate = decodeLibraryCoreCanonicalValue(
      commit.envelopeBytes[0]!,
    );
    if (
      firstCandidate === null ||
      typeof firstCandidate !== "object" ||
      Array.isArray(firstCandidate)
    ) {
      throw new TypeError("follower intent envelope is not a canonical record");
    }
    const firstRecord = firstCandidate as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    if (
      typeof firstRecord.transaction_id !== "string" ||
      typeof firstRecord.actor_id !== "string"
    ) {
      throw new TypeError("follower intent envelope identity is invalid");
    }
    const exactRetry = this.#followerIntentRetry(
      firstRecord.transaction_id,
      commit.envelopeBytes,
    );
    if (exactRetry !== null) return exactRetry;

    const actorRows = this.#database.exec({
      sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                   a.actor_id, a.public_key,
                   COALESCE(i.next_counter, a.accepted_counter + 1),
                   COALESCE(i.previous_operation_id, a.accepted_operation_id),
                   COALESCE(i.previous_chain_digest, a.accepted_chain_digest)
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            JOIN library_actors AS a ON a.actor_id = ?1
              AND a.authority_epoch_id = e.epoch_id AND a.retired_at IS NULL
            LEFT JOIN library_intent_actors AS i ON i.actor_id = a.actor_id
            WHERE m.singleton_id = 1;`,
      bind: [firstRecord.actor_id],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (actorRows.length !== 1) {
      throw new Error(
        "follower intent actor is unavailable in the active epoch",
      );
    }
    const actor = actorRows[0]!;
    const actorState = Object.freeze({
      actor_id: text(actor[3], "follower intent actor ID"),
      actor_public_key: text(actor[4], "follower intent actor public key"),
      epoch: safeInteger(actor[1], "follower intent epoch"),
      epoch_id: text(actor[2], "follower intent epoch ID"),
      library_id: text(actor[0], "follower intent Library ID"),
      next_actor_sequence: safeInteger(
        actor[5],
        "follower intent next counter",
      ),
      previous_actor_operation_id: nullableText(
        actor[6],
        "follower intent previous operation",
      ),
      previous_actor_chain_digest: text(
        actor[7],
        "follower intent previous chain digest",
      ),
    }) as LibraryCoreAcceptedActorStateV1;
    const verified = await verifyLibraryCoreOperationTransactionV1(
      commit.envelopeBytes,
      actorState,
      {
        digest: (domain, value) =>
          sha256LowerHex(
            encodeLibraryCoreDigestInput(
              domain,
              value as LibraryCoreCanonicalValue,
            ),
          ),
        verifySignature: (verification) =>
          verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
      },
    );
    const transactionProgram = sqliteMutationProgram(
      verified.members[0]!.envelope.operation_type,
    );
    if (
      verified.members.length > transactionProgram.maximumMembers ||
      verified.members.some(
        (member) =>
          member.envelope.operation_type !==
            verified.members[0]!.envelope.operation_type ||
          member.envelope.entity_type !== transactionProgram.entityType,
      )
    ) {
      throw new TypeError(
        "follower intent transaction exceeds its registered mutation program",
      );
    }
    const effects = verified.members.flatMap((member) => {
      const envelope = member.envelope;
      const payload = envelope.payload as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      const effect = (
        fieldPath: string,
        valueType: "boolean" | "integer" | "null",
        value: boolean | number | null,
      ) => ({
        createdAt: envelope.created_at_ms,
        entityId: envelope.entity_id,
        entityType: envelope.entity_type,
        fieldPath,
        value,
        valueType,
      });
      if (envelope.operation_type === "feed_item_read_assignment") {
        return [effect("read_at", "integer", payload.read_at_ms as number)];
      }
      if (envelope.operation_type === "feed_item_saved_assignment") {
        return payload.assigned === true
          ? [
              effect("saved", "boolean", true),
              effect("saved_at", "integer", payload.assigned_at_ms as number),
              effect("archived", "boolean", false),
              effect("archived_at", "null", null),
            ]
          : [
              effect("saved", "boolean", false),
              effect("saved_at", "null", null),
            ];
      }
      if (envelope.operation_type === "feed_item_archive_assignment") {
        return payload.assigned === true
          ? [
              effect("archived", "boolean", true),
              effect(
                "archived_at",
                "integer",
                payload.assigned_at_ms as number,
              ),
              effect("saved", "boolean", false),
              effect("saved_at", "null", null),
            ]
          : [
              effect("archived", "boolean", false),
              effect("archived_at", "null", null),
            ];
      }
      if (envelope.operation_type === "feed_item_like_assignment") {
        return [
          effect("liked", "boolean", payload.assigned as boolean),
          effect(
            "liked_at",
            payload.assigned === true ? "integer" : "null",
            payload.assigned === true
              ? (payload.assigned_at_ms as number)
              : null,
          ),
        ];
      }
      if (
        Object.hasOwn(
          LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
          envelope.operation_type,
        )
      ) {
        return [];
      }
      throw new TypeError(
        `follower optimistic materialization does not support ${envelope.operation_type}`,
      );
    });
    const canonicalTransaction = encodeLibraryCoreCanonicalValue(
      verified.transaction_body as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: 131_072 },
    );
    const committedAt = this.#now();
    if (!Number.isSafeInteger(committedAt) || committedAt < 0) {
      throw new Error("follower intent clock is invalid");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const retryInsideTransaction = this.#followerIntentRetry(
        verified.transaction_body.transaction_id,
        commit.envelopeBytes,
      );
      if (retryInsideTransaction !== null) {
        this.#database.exec("COMMIT;");
        return retryInsideTransaction;
      }
      const current = this.#database.exec({
        sql: `SELECT a.accepted_counter, a.accepted_operation_id,
                     a.accepted_chain_digest, i.next_counter,
                     i.previous_operation_id, i.previous_chain_digest,
                     m.library_id, e.epoch_number, e.epoch_id, a.public_key
              FROM library_meta AS m
              JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
              JOIN library_active_authority AS active
                ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
              JOIN library_actors AS a ON a.actor_id = ?1
                AND a.authority_epoch_id = e.epoch_id
              LEFT JOIN library_intent_actors AS i ON i.actor_id = a.actor_id
              WHERE a.actor_id = ?1 AND a.retired_at IS NULL;`,
        bind: [actorState.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (current.length !== 1) {
        throw new Error("follower intent actor changed during verification");
      }
      const tip = current[0]!;
      if (
        text(tip[6], "current follower Library ID") !== actorState.library_id ||
        safeInteger(tip[7], "current follower epoch") !== actorState.epoch ||
        text(tip[8], "current follower epoch ID") !== actorState.epoch_id ||
        text(tip[9], "current follower actor public key") !==
          actorState.actor_public_key
      ) {
        throw new Error(
          "follower intent authority changed during verification",
        );
      }
      const nextCounter =
        tip[3] === null
          ? safeInteger(tip[0], "follower actor accepted counter") + 1
          : safeInteger(tip[3], "follower actor local next counter");
      const previousOperation =
        tip[3] === null
          ? nullableText(tip[1], "follower actor accepted operation")
          : nullableText(tip[4], "follower actor local operation");
      const previousDigest =
        tip[3] === null
          ? text(tip[2], "follower actor accepted digest")
          : text(tip[5], "follower actor local digest");
      if (
        nextCounter !== actorState.next_actor_sequence ||
        previousOperation !== actorState.previous_actor_operation_id ||
        previousDigest !== actorState.previous_actor_chain_digest
      ) {
        throw new Error(
          "follower intent actor tip changed during verification",
        );
      }
      for (const member of verified.members) {
        const envelope = member.envelope;
        const allowed = safeInteger(
          this.#database.exec({
            sql: `SELECT count(*)
                  FROM library_actor_capabilities AS c
                  JOIN library_actor_capability_mutations AS m
                    ON m.capability_id = c.capability_id
                  WHERE c.actor_id = ?1 AND c.retired_at IS NULL
                    AND m.mutation_id = ?2
                    AND (c.scope_mode <> 'bounded'
                      OR (c.scope_kind = ?3 AND c.scope_id = ?4));`,
            bind: [
              envelope.actor_id,
              envelope.operation_type,
              envelope.entity_type,
              envelope.entity_id,
            ],
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower intent capability count",
        );
        if (allowed < 1) {
          throw new Error(
            `follower actor capability denies ${envelope.operation_type}`,
          );
        }
        const program =
          LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS[
            envelope.operation_type as keyof typeof LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS
          ];
        if (!program) {
          throw new Error(
            `follower intent mutation program is absent for ${envelope.operation_type}`,
          );
        }
        const targetExists = safeInteger(
          this.#database.exec({
            sql: program.targetExistsSql,
            bind: program.targetExistsSql.includes("?1")
              ? [envelope.entity_id]
              : [],
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower optimistic target count",
        );
        if (program.requiresExistingTarget && targetExists !== 1) {
          throw new Error("follower optimistic target is unavailable");
        }
      }
      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_intent_actors
                (actor_id, next_counter, previous_operation_id, previous_chain_digest)
              VALUES (?1, ?2, ?3, ?4);`,
        bind: [
          actorState.actor_id,
          actorState.next_actor_sequence,
          actorState.previous_actor_operation_id,
          actorState.previous_actor_chain_digest,
        ],
      });
      const firstEnvelope = verified.members[0]!.envelope;
      const lastEnvelope = verified.members.at(-1)!.envelope;
      this.#database.exec({
        sql: `INSERT INTO library_intent_transactions
                (transaction_id, transaction_digest, actor_id, member_count,
                 intent_epoch, intent_epoch_id, first_counter, last_counter,
                 previous_operation_id,
                 previous_chain_digest, ending_operation_id,
                 ending_chain_digest, canonical_member_bytes,
                 canonical_transaction, state, created_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                      ?13, ?14, 'pending', ?15);`,
        bind: [
          verified.transaction_body.transaction_id,
          verified.transaction_digest,
          actorState.actor_id,
          verified.members.length,
          firstEnvelope.epoch,
          firstEnvelope.epoch_id,
          firstEnvelope.actor_sequence,
          lastEnvelope.actor_sequence,
          firstEnvelope.previous_actor_operation_id,
          firstEnvelope.previous_actor_chain_digest,
          lastEnvelope.operation_id,
          lastEnvelope.actor_chain_digest,
          verified.canonical_envelope_bytes,
          canonicalTransaction,
          committedAt,
        ],
      });
      verified.members.forEach((member, memberIndex) => {
        const envelope = member.envelope;
        this.#database.exec({
          sql: `INSERT INTO library_intent_members
                  (transaction_id, actor_id, member_index, operation_id, actor_counter,
                   mutation_id, entity_type, entity_id, canonical_member,
                   member_digest)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);`,
          bind: [
            verified.transaction_body.transaction_id,
            actorState.actor_id,
            memberIndex,
            envelope.operation_id,
            envelope.actor_sequence,
            envelope.operation_type,
            envelope.entity_type,
            envelope.entity_id,
            commit.envelopeBytes[memberIndex]!,
            member.member_digest,
          ],
        });
      });
      for (const effect of effects) {
        this.#database.exec({
          sql: `INSERT INTO library_optimistic_fields
                  (transaction_id, entity_type, entity_id, field_path,
                   value_type, boolean_value, integer_value, real_value,
                   text_value, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8);`,
          bind: [
            verified.transaction_body.transaction_id,
            effect.entityType,
            effect.entityId,
            effect.fieldPath,
            effect.valueType,
            effect.valueType === "boolean"
              ? effect.value === true
                ? 1
                : 0
              : null,
            effect.valueType === "integer" ? effect.value : null,
            effect.createdAt,
          ],
        });
      }
      this.#database.exec({
        sql: `UPDATE library_intent_actors
              SET next_counter = ?2, previous_operation_id = ?3,
                  previous_chain_digest = ?4
              WHERE actor_id = ?1 AND next_counter = ?5
                AND previous_operation_id IS ?6
                AND previous_chain_digest = ?7;`,
        bind: [
          actorState.actor_id,
          lastEnvelope.actor_sequence + 1,
          lastEnvelope.operation_id,
          lastEnvelope.actor_chain_digest,
          actorState.next_actor_sequence,
          actorState.previous_actor_operation_id,
          actorState.previous_actor_chain_digest,
        ],
      });
      if (
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower intent actor tip update",
        ) !== 1
      ) {
        throw new Error("follower intent actor tip compare-and-swap failed");
      }
      this.#database.exec("COMMIT;");
      return Object.freeze({
        actorId: actorState.actor_id,
        firstCounter: firstEnvelope.actor_sequence,
        lastCounter: lastEnvelope.actor_sequence,
        memberCount: verified.members.length,
        optimisticFieldCount: effects.length,
        state: "pending",
        transactionId: verified.transaction_body.transaction_id,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  pageFollowerIntents(
    input: LibraryCoreFollowerIntentPageRequestV1,
  ): LibraryCoreFollowerIntentPageResponseV1 {
    const request = parseLibraryCoreFollowerIntentPageRequestV1(input);
    if (request.cursor !== null) {
      const cursorRows = this.#database.exec({
        sql: `SELECT operation_id, transaction_id
              FROM library_intent_members
              WHERE actor_id = ?1 AND actor_counter = ?2;`,
        bind: [request.actorId, request.cursor.actorCounter],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        cursorRows.length !== 1 ||
        text(cursorRows[0]![0], "follower intent cursor operation") !==
          request.cursor.operationId ||
        text(cursorRows[0]![1], "follower intent cursor transaction") !==
          request.cursor.transactionId
      ) {
        throw new Error(
          "follower intent page cursor does not name a stored member",
        );
      }
    }
    const rows = this.#database.exec({
      sql: `SELECT member.actor_counter, member.operation_id,
                   member.transaction_id, member.member_index,
                   member.canonical_member, intent.transaction_digest,
                   intent.intent_epoch, intent.intent_epoch_id,
                   intent.member_count, intent.state
            FROM library_intent_members AS member
            JOIN library_intent_transactions AS intent
              ON intent.transaction_id = member.transaction_id
             AND intent.actor_id = member.actor_id
            WHERE member.actor_id = ?1
              AND member.actor_counter > ?2
              AND intent.state IN ('pending', 'published')
            ORDER BY member.actor_counter
            LIMIT ?3;`,
      bind: [
        request.actorId,
        request.cursor?.actorCounter ?? 0,
        request.limit + 1,
      ],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const records: Array<
      LibraryCoreFollowerIntentPageResponseV1["records"][number]
    > = [];
    let stoppedForBytes = false;
    for (const row of rows.slice(0, request.limit)) {
      const state = text(row[9], "follower intent state");
      if (state !== "pending" && state !== "published") {
        throw new Error("follower intent page contains a resolved transaction");
      }
      const candidate = Object.freeze({
        actorCounter: safeInteger(row[0], "follower intent actor counter"),
        actorId: request.actorId,
        canonicalEnvelopeJson: strictUtf8Decoder.decode(
          bytes(row[4], "follower intent canonical member"),
        ),
        intentEpoch: safeInteger(row[6], "follower intent epoch"),
        intentEpochId: text(row[7], "follower intent epoch ID"),
        memberCount: safeInteger(row[8], "follower intent member count"),
        memberIndex: safeInteger(row[3], "follower intent member index"),
        operationId: text(row[1], "follower intent operation ID"),
        state,
        transactionDigest: text(row[5], "follower intent transaction digest"),
        transactionId: text(row[2], "follower intent transaction ID"),
      });
      const candidateRecords = [...records, candidate];
      const candidateResponse = {
        actorId: request.actorId,
        done: false,
        nextCursor: {
          actorCounter: candidate.actorCounter,
          operationId: candidate.operationId,
          transactionId: candidate.transactionId,
        },
        records: candidateRecords,
        schemaVersion: 1,
      };
      if (
        textEncoder.encode(JSON.stringify(candidateResponse)).byteLength >
        LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES
      ) {
        if (records.length === 0) {
          throw new Error(
            "one follower intent record exceeds the page boundary",
          );
        }
        stoppedForBytes = true;
        break;
      }
      records.push(candidate);
    }
    const last = records.at(-1);
    return parseLibraryCoreFollowerIntentPageResponseV1({
      actorId: request.actorId,
      done:
        !stoppedForBytes &&
        rows.length <= request.limit &&
        records.length === rows.length,
      nextCursor:
        last === undefined
          ? null
          : {
              actorCounter: last.actorCounter,
              operationId: last.operationId,
              transactionId: last.transactionId,
            },
      records,
      schemaVersion: 1,
    });
  }

  publishFollowerIntent(
    input: LibraryCoreFollowerIntentPublicationV1,
  ): LibraryCoreFollowerIntentPublicationReceiptV1 {
    const publication = parseLibraryCoreFollowerIntentPublicationV1(input);
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.#database.exec({
        sql: `SELECT actor_id, transaction_digest, state, published_at, created_at
              FROM library_intent_transactions WHERE transaction_id = ?1;`,
        bind: [publication.transactionId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (rows.length !== 1) {
        throw new Error("follower intent publication transaction is missing");
      }
      const row = rows[0]!;
      if (
        text(row[0], "follower intent publication actor") !==
          publication.actorId ||
        text(row[1], "follower intent publication digest") !==
          publication.transactionDigest
      ) {
        throw new Error("follower intent publication identity was reused");
      }
      const state = text(row[2], "follower intent publication state");
      const storedPublishedAt = nullableInteger(
        row[3],
        "follower intent publication time",
      );
      const createdAt = safeInteger(
        row[4],
        "follower intent publication creation time",
      );
      if (publication.publishedAt < createdAt) {
        throw new Error("follower intent publication predates its transaction");
      }
      if (state === "published") {
        if (storedPublishedAt !== publication.publishedAt) {
          throw new Error("follower intent publication identity was reused");
        }
      } else if (state === "pending" && storedPublishedAt === null) {
        this.#database.exec({
          sql: `UPDATE library_intent_transactions
                SET state = 'published', published_at = ?2
                WHERE transaction_id = ?1 AND state = 'pending'
                  AND published_at IS NULL;`,
          bind: [publication.transactionId, publication.publishedAt],
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "follower intent publication change",
          ) !== 1
        ) {
          throw new Error("follower intent publication changed concurrently");
        }
      } else {
        throw new Error("resolved follower intent cannot be published");
      }
      this.#database.exec("COMMIT;");
      return Object.freeze({
        actorId: publication.actorId,
        publishedAt: publication.publishedAt,
        state: "published",
        transactionId: publication.transactionId,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #materializeAcceptedFollowerIntent(
    transactionId: string,
    resolvedAt: number,
  ): void {
    const rows = this.#database.exec({
      sql: `SELECT canonical_member FROM library_intent_members
            WHERE transaction_id = ?1 ORDER BY member_index;`,
      bind: [transactionId],
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (rows.length === 0) {
      throw new Error("accepted follower intent has no stored members");
    }
    for (const value of rows) {
      const decoded = decodeLibraryCoreCanonicalValue(
        bytes(value, "accepted follower intent canonical member"),
      );
      if (
        decoded === null ||
        typeof decoded !== "object" ||
        Array.isArray(decoded)
      ) {
        throw new Error("accepted follower intent member is not canonical");
      }
      const envelope = decoded as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      const canonicalText = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): string => {
        if (typeof value !== "string") {
          throw new Error(`${label} is invalid`);
        }
        return value;
      };
      const canonicalSafeInteger = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): number => {
        if (typeof value !== "number" || !Number.isSafeInteger(value)) {
          throw new Error(`${label} is invalid`);
        }
        return value;
      };
      const operationType = canonicalText(
        envelope.operation_type,
        "accepted follower operation type",
      );
      const entityType = canonicalText(
        envelope.entity_type,
        "accepted follower entity type",
      );
      const entityId = canonicalText(
        envelope.entity_id,
        "accepted follower entity ID",
      );
      const actorId = canonicalText(
        envelope.actor_id,
        "accepted follower actor ID",
      );
      const actorSequence = canonicalSafeInteger(
        envelope.actor_sequence,
        "accepted follower actor sequence",
      );
      const operationId = canonicalText(
        envelope.operation_id,
        "accepted follower operation ID",
      );
      if (
        actorSequence < 1 ||
        envelope.payload === null ||
        typeof envelope.payload !== "object" ||
        Array.isArray(envelope.payload)
      ) {
        throw new Error("accepted follower intent materializer is unavailable");
      }
      const program = sqliteMutationProgram(operationType);
      if (entityType !== program.entityType) {
        throw new Error("accepted follower intent entity type is invalid");
      }
      const payload = envelope.payload as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      const objectJson = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): string => {
        if (
          value === null ||
          typeof value !== "object" ||
          Array.isArray(value)
        ) {
          throw new Error(`accepted follower ${label} payload is invalid`);
        }
        return JSON.stringify(value);
      };
      const requiredInteger = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): number => {
        if (
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0
        ) {
          throw new Error(`accepted follower ${label} is invalid`);
        }
        return value;
      };
      const changed = (): number =>
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "accepted follower materialization change",
        );
      const clockWins = (sourceAt: number): boolean => {
        const clock = this.#database.exec({
          sql: program.clockReadSql,
          bind: [entityId],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (clock.length === 0) return true;
        if (clock.length !== 1) {
          throw new Error("accepted follower intent field clock is invalid");
        }
        const currentAt = safeInteger(clock[0]![0], "field clock time");
        const currentOperation = text(clock[0]![1], "field clock operation ID");
        return (
          sourceAt > currentAt ||
          (sourceAt === currentAt && operationId < currentOperation)
        );
      };
      const writeClock = (sourceAt: number): void => {
        this.#database.exec({
          sql: program.clockWriteSql,
          bind: [entityId, actorId, actorSequence, operationId, sourceAt],
        });
      };

      if (
        program.payloadKind === "account_upsert" ||
        program.payloadKind === "feed_item_capture_upsert" ||
        program.payloadKind === "person_upsert" ||
        program.payloadKind === "rss_feed_upsert"
      ) {
        const property =
          program.payloadKind === "account_upsert"
            ? "account"
            : program.payloadKind === "feed_item_capture_upsert"
              ? "item"
              : program.payloadKind === "person_upsert"
                ? "person"
                : "feed";
        const recordJson = objectJson(payload[property], property);
        this.#database.exec({
          sql: program.materializeSql,
          bind:
            program.payloadKind === "account_upsert" ||
            program.payloadKind === "person_upsert"
              ? [entityId, recordJson]
              : [entityId, recordJson, resolvedAt],
        });
        if (changed() !== 0) {
          for (const sql of program.dependentDeleteSql) {
            this.#database.exec({ sql, bind: [entityId] });
          }
          for (const sql of program.dependentInsertSql) {
            this.#database.exec({
              sql,
              bind: [entityId, recordJson],
            });
          }
        }
        continue;
      }

      if (program.payloadKind === "preferences_leaf_assignment") {
        const patchJson = objectJson(payload.updates, "preference patch");
        const bounds = this.#database.exec({
          sql: `SELECT count(*),
                       coalesce(max(length(CAST(fullkey AS BLOB)) + 2), 0),
                       coalesce(max(CASE WHEN type = 'text'
                                         THEN length(CAST(atom AS BLOB))
                                         ELSE 0 END), 0)
                FROM json_tree(?1) WHERE fullkey <> '$';`,
          bind: [patchJson],
          rowMode: "array",
          returnValue: "resultRows",
        });
        const nodeCount = safeInteger(
          bounds[0]?.[0],
          "preference patch node count",
        );
        if (
          bounds.length !== 1 ||
          nodeCount < 1 ||
          nodeCount > 512 ||
          safeInteger(bounds[0]![1], "preference patch path bytes") > 4_096 ||
          safeInteger(bounds[0]![2], "preference patch text bytes") > 8_192
        ) {
          throw new Error("accepted follower preference patch exceeds bounds");
        }
        for (const sql of program.dependentDeleteSql) {
          this.#database.exec({ sql, bind: [patchJson] });
        }
        this.#database.exec({
          sql: program.materializeSql,
          bind: [patchJson, resolvedAt],
        });
        continue;
      }

      if (program.payloadKind === "person_reach_out_append") {
        const loggedAt = requiredInteger(
          payload.logged_at_ms,
          "reach-out time",
        );
        const channel = payload.channel;
        const notes = payload.notes;
        if (
          (channel !== null && typeof channel !== "string") ||
          (notes !== null && typeof notes !== "string")
        ) {
          throw new Error("accepted follower reach-out payload is invalid");
        }
        this.#database.exec({
          sql: program.materializeSql,
          bind: [entityId, operationId, loggedAt, channel, notes],
        });
        for (const sql of program.dependentDeleteSql) {
          this.#database.exec({ sql, bind: [entityId] });
        }
        continue;
      }

      if (program.payloadKind === "remove") {
        const removedAt = requiredInteger(
          payload.removed_at_ms,
          "removal time",
        );
        if (clockWins(removedAt)) {
          for (const sql of program.dependentDeleteSql) {
            this.#database.exec({ sql, bind: [entityId] });
          }
          this.#database.exec({
            sql: program.materializeSql,
            bind: [entityId],
          });
          writeClock(removedAt);
        }
        continue;
      }

      if (
        program.payloadKind === "text_assignment" ||
        program.payloadKind === "nullable_text_assignment"
      ) {
        const assignedAt = requiredInteger(
          payload.assigned_at_ms,
          "assignment time",
        );
        const assignedValue =
          program.payloadKind === "text_assignment"
            ? payload.title
            : payload.person_id;
        if (
          (program.payloadKind === "text_assignment" &&
            typeof assignedValue !== "string") ||
          (program.payloadKind === "nullable_text_assignment" &&
            assignedValue !== null &&
            typeof assignedValue !== "string")
        ) {
          throw new Error("accepted follower assignment payload is invalid");
        }
        if (clockWins(assignedAt)) {
          this.#database.exec({
            sql: program.materializeSql,
            bind: [assignedValue as SqlValue, resolvedAt, entityId],
          });
          if (changed() !== 1) {
            throw new Error("accepted follower assignment target changed");
          }
          writeClock(assignedAt);
        }
        continue;
      }

      throw new Error("accepted follower intent materializer is unavailable");
    }
  }

  async applyFollowerResult(
    input: LibraryCoreFollowerResultApplyV1,
  ): Promise<LibraryCoreFollowerResultApplyReceiptV1> {
    const apply = parseLibraryCoreFollowerResultApplyV1(input);
    const candidate = parseLibraryCoreFollowerResultEnvelopeV1(
      decodeLibraryCoreCanonicalValue(apply.canonicalResultBytes, {
        maximumBytes: 131_072,
      }),
    );
    const exactRetry = this.#followerResultRetry(
      candidate.transaction_id,
      apply.canonicalResultBytes,
    );
    if (exactRetry !== null) return exactRetry;

    const authorityRows = this.#database.exec({
      sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                   e.authority_key_id, e.authority_public_key
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            WHERE m.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (authorityRows.length !== 1) {
      throw new Error("follower result active authority is unavailable");
    }
    const authorityRow = authorityRows[0]!;
    const authority = Object.freeze({
      authorityKeyId: text(authorityRow[3], "follower result authority key ID"),
      authorityPublicKey: text(
        authorityRow[4],
        "follower result authority public key",
      ),
      epoch: safeInteger(authorityRow[1], "follower result epoch"),
      epochId: text(authorityRow[2], "follower result epoch ID"),
      libraryId: text(authorityRow[0], "follower result Library ID"),
    });
    const verified = await verifyLibraryCoreFollowerResultV1(
      apply.canonicalResultBytes,
      authority,
      {
        verifySignature: (verification) =>
          verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
      },
    );
    const receivedAt = this.#now();
    if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
      throw new Error("follower result clock is invalid");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const retryInsideTransaction = this.#followerResultRetry(
        verified.envelope.transaction_id,
        verified.canonicalBytes,
      );
      if (retryInsideTransaction !== null) {
        this.#database.exec("COMMIT;");
        return retryInsideTransaction;
      }
      const currentAuthority = this.#database.exec({
        sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                     e.authority_key_id, e.authority_public_key,
                     m.source_revision, changes.revision
              FROM library_meta AS m
              JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
              JOIN library_active_authority AS active
                ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
              JOIN library_change_state AS changes ON changes.singleton_id = m.singleton_id
              WHERE m.singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (currentAuthority.length !== 1) {
        throw new Error(
          "follower result authority changed during verification",
        );
      }
      const current = currentAuthority[0]!;
      if (
        text(current[0], "current result Library ID") !== authority.libraryId ||
        safeInteger(current[1], "current result epoch") !== authority.epoch ||
        text(current[2], "current result epoch ID") !== authority.epochId ||
        text(current[3], "current result key ID") !==
          authority.authorityKeyId ||
        text(current[4], "current result public key") !==
          authority.authorityPublicKey
      ) {
        throw new Error(
          "follower result authority changed during verification",
        );
      }
      const sourceRevision = safeInteger(
        current[5],
        "current result source revision",
      );
      if (
        sourceRevision !==
        safeInteger(current[6], "current result change revision")
      ) {
        throw new Error("follower result source revisions disagree");
      }
      const envelope = verified.envelope;
      const transactions = this.#database.exec({
        sql: `SELECT transaction_digest, actor_id, member_count, state, created_at,
                     intent_epoch, intent_epoch_id
              FROM library_intent_transactions WHERE transaction_id = ?1;`,
        bind: [envelope.transaction_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (transactions.length !== 1) {
        throw new Error("follower result intent transaction is unavailable");
      }
      const transaction = transactions[0]!;
      const memberCount = safeInteger(
        transaction[2],
        "follower result intent member count",
      );
      if (
        text(transaction[0], "follower result transaction digest") !==
          envelope.transaction_digest ||
        text(transaction[1], "follower result actor ID") !==
          envelope.actor_id ||
        safeInteger(transaction[5], "follower result intent epoch") !==
          envelope.intent_epoch ||
        text(transaction[6], "follower result intent epoch ID") !==
          envelope.intent_epoch_id ||
        !["pending", "published"].includes(
          text(transaction[3], "follower result intent state"),
        ) ||
        envelope.resolved_at_ms <
          safeInteger(transaction[4], "follower result intent creation time")
      ) {
        throw new Error("follower result does not match its pending intent");
      }
      if (
        envelope.status === "accepted" &&
        (envelope.canonical_operation_ids.length !== memberCount ||
          envelope.receipt_ids.length !== memberCount)
      ) {
        throw new Error("accepted follower result is incomplete");
      }

      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_intent_result_cursors
                (actor_id, next_result_sequence, previous_result_digest)
              VALUES (?1, 1, NULL);`,
        bind: [envelope.actor_id],
      });
      const cursorRows = this.#database.exec({
        sql: `SELECT next_result_sequence, previous_result_digest
              FROM library_intent_result_cursors WHERE actor_id = ?1;`,
        bind: [envelope.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        cursorRows.length !== 1 ||
        safeInteger(cursorRows[0]![0], "follower result next sequence") !==
          envelope.result_sequence ||
        nullableText(
          cursorRows[0]![1],
          "follower result previous cursor digest",
        ) !== envelope.previous_result_digest
      ) {
        throw new Error("follower result cursor is not contiguous");
      }

      const optimisticRows = this.#database.exec({
        sql: `SELECT entity_type, entity_id, field_path
              FROM library_optimistic_fields
              WHERE transaction_id = ?1
              ORDER BY entity_type COLLATE BINARY,
                       entity_id COLLATE BINARY, field_path COLLATE BINARY;`,
        bind: [envelope.transaction_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const replacements = [...envelope.replacement_fields].sort(
        (left, right) => {
          const leftKey = `${left.entity_type}\u0000${left.entity_id}\u0000${left.field_path}`;
          const rightKey = `${right.entity_type}\u0000${right.entity_id}\u0000${right.field_path}`;
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        },
      );
      if (
        optimisticRows.length !== replacements.length ||
        optimisticRows.some((row, index) => {
          const replacement = replacements[index]!;
          return (
            text(row[0], "optimistic entity type") !==
              replacement.entity_type ||
            text(row[1], "optimistic entity ID") !== replacement.entity_id ||
            text(row[2], "optimistic field path") !== replacement.field_path
          );
        })
      ) {
        throw new Error("follower result replacement projection is incomplete");
      }

      const canonicalColumns = Object.freeze({
        archived: "archived",
        archived_at: "archived_at",
        liked: "liked",
        liked_at: "liked_at",
        read_at: "read_at",
        saved: "saved",
        saved_at: "saved_at",
      } as const);

      if (envelope.authoritative_source_revision === sourceRevision) {
        for (const field of replacements) {
          const expected =
            field.value_type === "boolean"
              ? field.boolean_value === true
                ? 1
                : 0
              : field.value_type === "integer"
                ? field.integer_value
                : null;
          const values = this.#database.exec({
            sql: `SELECT ${canonicalColumns[field.field_path]}
                  FROM library_feed_items WHERE global_id = ?1;`,
            bind: [field.entity_id],
            rowMode: 0,
            returnValue: "resultRows",
          });
          if (values.length !== 1 || values[0] !== expected) {
            throw new Error(
              "follower result replacement disagrees with its source revision",
            );
          }
        }
      }

      const isExactNextSourceRevision =
        sourceRevision < Number.MAX_SAFE_INTEGER &&
        envelope.authoritative_source_revision === sourceRevision + 1;
      if (isExactNextSourceRevision) {
        if (
          envelope.status === "accepted" &&
          envelope.replacement_fields.length === 0
        ) {
          this.#materializeAcceptedFollowerIntent(
            envelope.transaction_id,
            envelope.resolved_at_ms,
          );
        }
        for (const field of replacements) {
          const value =
            field.value_type === "boolean"
              ? field.boolean_value === true
                ? 1
                : 0
              : field.value_type === "integer"
                ? field.integer_value
                : null;
          this.#database.exec({
            sql: `UPDATE library_feed_items
                  SET ${canonicalColumns[field.field_path]} = ?2
                  WHERE global_id = ?1;`,
            bind: [field.entity_id, value],
          });
          if (
            safeInteger(
              this.#database.exec({
                sql: "SELECT changes();",
                rowMode: 0,
                returnValue: "resultRows",
              })[0],
              "follower result canonical field update",
            ) !== 1
          ) {
            throw new Error("follower result canonical target is unavailable");
          }
        }
        this.#database.exec({
          sql: `UPDATE library_meta
                SET source_revision = ?1, updated_at = ?2
                WHERE singleton_id = 1 AND source_revision = ?3;`,
          bind: [
            envelope.authoritative_source_revision,
            envelope.resolved_at_ms,
            sourceRevision,
          ],
        });
        this.#database.exec({
          sql: `UPDATE library_change_state SET revision = ?1
                WHERE singleton_id = 1 AND revision = ?2;`,
          bind: [envelope.authoritative_source_revision, sourceRevision],
        });
        const invalidations = this.#database.exec({
          sql: `SELECT mutation_id, entity_id FROM library_intent_members
                WHERE transaction_id = ?1 ORDER BY member_index;`,
          bind: [envelope.transaction_id],
          rowMode: "array",
          returnValue: "resultRows",
        });
        invalidations.forEach((row, ordinal) => {
          const program = sqliteMutationProgram(
            text(row[0], "follower invalidation mutation ID"),
          );
          this.#database.exec({
            sql: `INSERT INTO library_invalidations
                    (revision, ordinal, topic, entity_id, reset_required)
                  VALUES (?1, ?2, ?3, ?4, 0);`,
            bind: [
              envelope.authoritative_source_revision,
              ordinal,
              program.invalidationTopic,
              text(row[1], "follower invalidation entity ID"),
            ],
          });
        });
      }

      this.#database.exec({
        sql: `DELETE FROM library_optimistic_fields WHERE transaction_id = ?1;`,
        bind: [envelope.transaction_id],
      });
      this.#database.exec({
        sql: `INSERT INTO library_intent_results
                (transaction_id, actor_id, authority_epoch_id, intent_epoch_id,
                 result_sequence,
                 previous_result_digest, result_digest, status,
                 authoritative_source_revision, canonical_result, received_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);`,
        bind: [
          envelope.transaction_id,
          envelope.actor_id,
          envelope.epoch_id,
          envelope.intent_epoch_id,
          envelope.result_sequence,
          envelope.previous_result_digest,
          verified.resultDigest,
          envelope.status,
          envelope.authoritative_source_revision,
          verified.canonicalBytes,
          receivedAt,
        ],
      });
      this.#database.exec({
        sql: `UPDATE library_intent_transactions
              SET state = ?2, resolved_at = ?3
              WHERE transaction_id = ?1 AND state IN ('pending', 'published');`,
        bind: [
          envelope.transaction_id,
          envelope.status === "rejected" ? "rejected" : "accepted",
          envelope.resolved_at_ms,
        ],
      });
      this.#database.exec({
        sql: `UPDATE library_intent_result_cursors
              SET next_result_sequence = ?2, previous_result_digest = ?3
              WHERE actor_id = ?1 AND next_result_sequence = ?4
                AND previous_result_digest IS ?5;`,
        bind: [
          envelope.actor_id,
          envelope.result_sequence + 1,
          verified.resultDigest,
          envelope.result_sequence,
          envelope.previous_result_digest,
        ],
      });
      if (
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower result cursor update",
        ) !== 1
      ) {
        throw new Error("follower result cursor compare-and-swap failed");
      }
      this.#database.exec("COMMIT;");
      return Object.freeze({
        actorId: envelope.actor_id,
        resultDigest: verified.resultDigest,
        resultSequence: envelope.result_sequence,
        sourceRevision: Math.max(
          sourceRevision,
          envelope.authoritative_source_revision,
        ),
        status: envelope.status,
        transactionId: envelope.transaction_id,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #followerResultRetry(
    transactionId: string,
    canonicalBytes: Uint8Array,
  ): LibraryCoreFollowerResultApplyReceiptV1 | null {
    const rows = this.#database.exec({
      sql: `SELECT actor_id, result_sequence, result_digest, status,
                   authoritative_source_revision, canonical_result
            FROM library_intent_results WHERE transaction_id = ?1;`,
      bind: [transactionId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length === 0) return null;
    const row = rows[0]!;
    const stored = row[5];
    if (
      !(stored instanceof Uint8Array) ||
      stored.byteLength !== canonicalBytes.byteLength ||
      !stored.every((byte, index) => byte === canonicalBytes[index])
    ) {
      throw new Error("follower result identity was reused with changed bytes");
    }
    const sourceRevision = safeInteger(
      this.#database.exec({
        sql: "SELECT source_revision FROM library_meta WHERE singleton_id = 1;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "follower result retry source revision",
    );
    return Object.freeze({
      actorId: text(row[0], "stored follower result actor"),
      resultDigest: text(row[2], "stored follower result digest"),
      resultSequence: safeInteger(row[1], "stored follower result sequence"),
      sourceRevision,
      status: text(row[3], "stored follower result status") as
        "accepted" | "already_applied" | "rejected",
      transactionId,
    });
  }

  #followerIntentRetry(
    transactionId: string,
    envelopeBytes: readonly Uint8Array[],
  ): LibraryCoreFollowerIntentCommitResultV1 | null {
    const transactions = this.#database.exec({
      sql: `SELECT actor_id, member_count, first_counter, last_counter, state
            FROM library_intent_transactions WHERE transaction_id = ?1;`,
      bind: [transactionId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (transactions.length === 0) return null;
    const transaction = transactions[0]!;
    const memberCount = safeInteger(
      transaction[1],
      "stored intent member count",
    );
    const members = this.#database.exec({
      sql: `SELECT canonical_member FROM library_intent_members
            WHERE transaction_id = ?1 ORDER BY member_index;`,
      bind: [transactionId],
      rowMode: 0,
      returnValue: "resultRows",
    });
    const exact =
      memberCount === envelopeBytes.length &&
      members.length === envelopeBytes.length &&
      members.every((value, index) => {
        const stored = value instanceof Uint8Array ? value : null;
        const received = envelopeBytes[index]!;
        return (
          stored !== null &&
          stored.byteLength === received.byteLength &&
          stored.every((byte, byteIndex) => byte === received[byteIndex])
        );
      });
    if (!exact) {
      throw new Error("follower intent identity was reused with changed bytes");
    }
    const optimisticFieldCount = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*) FROM library_optimistic_fields
              WHERE transaction_id = ?1;`,
        bind: [transactionId],
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "stored optimistic field count",
    );
    const state = text(transaction[4], "stored intent state");
    if (state !== "pending" && state !== "published") {
      throw new Error("resolved follower intent cannot be recommitted");
    }
    return Object.freeze({
      actorId: text(transaction[0], "stored intent actor"),
      firstCounter: safeInteger(transaction[2], "stored intent first counter"),
      lastCounter: safeInteger(transaction[3], "stored intent last counter"),
      memberCount,
      optimisticFieldCount,
      state,
      transactionId,
    });
  }

  beginScopeAction(
    stageId: string,
    input: LibraryCoreScopeActionRequestV1,
    createdAt: number,
  ): LibraryCoreScopeActionStageStatusV1 {
    const request = parseLibraryCoreScopeActionRequestV1(input);
    if (
      stageId.length < 1 ||
      stageId.length > 255 ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0
    ) {
      throw new Error("Library scope action stage identity is invalid");
    }
    const digest = digestLibraryCoreScopeActionRequestV1(request);
    this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.create,
      bind: [stageId, request.action, digest, createdAt],
    });
    return Object.freeze({ memberCount: 0, stageId, state: "staging" });
  }

  appendScopeAction(
    stageId: string,
    expectedOrdinal: number,
    entityIds: readonly string[],
  ): LibraryCoreScopeActionStageStatusV1 {
    if (
      !Number.isSafeInteger(expectedOrdinal) ||
      expectedOrdinal < 0 ||
      entityIds.length < 1 ||
      entityIds.length > 256 ||
      entityIds.some((id) => !id || new TextEncoder().encode(id).length > 4_096)
    ) {
      throw new Error("Library scope action append is invalid");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const status = this.#database.exec({
        sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.status,
        bind: [stageId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        status.length !== 1 ||
        text(status[0]?.[2], "scope action state") !== "staging" ||
        safeInteger(status[0]?.[3], "scope action member count") !==
          expectedOrdinal
      ) {
        throw new Error("Library scope action append fence is stale");
      }
      this.#database.exec({
        sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.append,
        bind: [stageId, expectedOrdinal, JSON.stringify(entityIds)],
      });
      const memberCount = expectedOrdinal + entityIds.length;
      this.#database.exec({
        sql: "UPDATE library_device_scope_actions SET member_count = ?2 WHERE action_id = ?1;",
        bind: [stageId, memberCount],
      });
      this.#database.exec("COMMIT;");
      return Object.freeze({ memberCount, stageId, state: "staging" });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  finalizeScopeAction(
    stageId: string,
    expectedMemberCount: number,
  ): LibraryCoreScopeActionStageStatusV1 {
    if (!Number.isSafeInteger(expectedMemberCount) || expectedMemberCount < 0) {
      throw new Error("Library scope action final count is invalid");
    }
    this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.finalize,
      bind: [stageId, expectedMemberCount],
    });
    const status = this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.status,
      bind: [stageId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (
      status.length !== 1 ||
      text(status[0]?.[2], "scope action state") !== "ready" ||
      safeInteger(status[0]?.[3], "scope action member count") !==
        expectedMemberCount
    ) {
      throw new Error("Library scope action could not finalize");
    }
    return Object.freeze({
      memberCount: expectedMemberCount,
      stageId,
      state: "ready",
    });
  }

  pageScopeAction(
    stageId: string,
    afterOrdinal: number,
  ): LibraryCoreScopeActionStagePageV1 {
    if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < -1) {
      throw new Error("Library scope action page cursor is invalid");
    }
    const rows = this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.page,
      bind: [stageId, afterOrdinal, 1_000],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const entityIds = rows.map((row) => text(row[1], "scope action entity ID"));
    return Object.freeze({
      entityIds: Object.freeze(entityIds),
      nextOrdinal:
        rows.length === 0
          ? afterOrdinal
          : safeInteger(rows.at(-1)?.[0], "scope action ordinal"),
      stageId,
    });
  }

  closeScopeAction(stageId: string): void {
    this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.delete,
      bind: [stageId],
    });
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
      case "account_timeline_v1":
        return this.#queryAccountTimeline(
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
      case "feed_browse_page_v3":
        return this.#queryFeedBrowsePage(
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
      case "content_fetch_claim_v1":
        return this.#queryContentFetchPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "provider_media_page_v1":
        return this.#queryProviderMediaPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "map_markers_v1":
        return this.#queryMapMarkers(
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
      case "person_timeline_v1":
        return this.#queryPersonTimeline(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "persons_graph_v1":
        return this.#queryPersonsGraph(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "rss_feed_detail_v1":
        return this.#queryRssFeedDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "rss_feed_graph_page_v1":
        return this.#queryRssFeedGraphPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "saved_analytics_v2":
        return this.#querySavedAnalytics(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "saved_feed_page_v2":
        return this.#querySavedFeedPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "search_page_v1":
        return this.#querySearchPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "story_wall_candidates_v1":
        return this.#queryStoryWallCandidates(
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

  #queryGraphSource(): {
    readonly generationId: string;
    readonly layoutRevision: number;
    readonly sourceRevision: number;
  } {
    const source = this.#querySource();
    const rows = this.#database.exec({
      sql: "SELECT revision FROM library_device_graph_layout_state WHERE singleton_id = 1;",
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA Library SQLite has no device graph layout state");
    }
    return Object.freeze({
      ...source,
      layoutRevision: safeInteger(rows[0], "device graph layout revision"),
    });
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

  #queryRssFeedDetail(
    input: LibraryCoreRssFeedDetailRequestV1,
  ): LibraryCoreRssFeedDetailResponseV1 {
    const request = parseLibraryCoreRssFeedDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.rss_feed_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.url],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite RSS Feed detail exceeded its row bound",
      );
    }
    const row = rows[0];
    const feed =
      row === undefined
        ? null
        : {
            enabled: requiredBoolean(row.enabled, "RSS Feed enabled"),
            folder: nullableText(row.folder, "RSS Feed folder"),
            imageUrl: nullableText(row.imageUrl, "RSS Feed image URL"),
            lastFetched: nullableInteger(
              row.lastFetched,
              "RSS Feed last fetched",
            ),
            pollInterval: nullableInteger(
              row.pollInterval,
              "RSS Feed poll interval",
            ),
            sampleBatchId: nullableText(
              row.sampleBatchId,
              "RSS Feed sample batch",
            ),
            sampleGeneratedAt: nullableInteger(
              row.sampleGeneratedAt,
              "RSS Feed sample generation time",
            ),
            sampleGeneratorVersion: nullableInteger(
              row.sampleGeneratorVersion,
              "RSS Feed sample generator version",
            ),
            siteUrl: nullableText(row.siteUrl, "RSS Feed site URL"),
            title: text(row.title, "RSS Feed title"),
            trackUnread: requiredBoolean(
              row.trackUnread,
              "RSS Feed track unread",
            ),
            updatedAt: safeInteger(row.updatedAt, "RSS Feed update time"),
            url: text(row.url, "RSS Feed URL"),
          };
    const response = {
      feed,
      queryId: "rss_feed_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreRssFeedDetailResponseV1(
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
    const { generationId, layoutRevision, sourceRevision } =
      this.#queryGraphSource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.layoutRevision !== layoutRevision ||
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
      graphPinned: requiredBoolean(
        row.graphPinned,
        "Person graph pinned state",
      ),
      graphUpdatedAt: nullableInteger(
        row.graphUpdatedAt,
        "Person graph position update",
      ),
      graphX: nullableFiniteNumber(row.graphX, "Person graph x position"),
      graphY: nullableFiniteNumber(row.graphY, "Person graph y position"),
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
      layoutRevision,
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreIdentityPageCursorV1({
              entityId: last.id,
              generationId,
              layoutRevision,
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
    const { generationId, layoutRevision, sourceRevision } =
      this.#queryGraphSource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.layoutRevision !== layoutRevision ||
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
      activityCount: safeInteger(
        row.activityCount,
        "Account graph activity count",
      ),
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
      graphPinned: requiredBoolean(
        row.graphPinned,
        "Account graph pinned state",
      ),
      graphUpdatedAt: nullableInteger(
        row.graphUpdatedAt,
        "Account graph position update",
      ),
      graphX: nullableFiniteNumber(row.graphX, "Account graph x position"),
      graphY: nullableFiniteNumber(row.graphY, "Account graph y position"),
      handle: nullableText(row.handle, "Account graph handle"),
      id: text(row.id, "Account graph identity"),
      kind: text(row.kind, "Account graph kind"),
      lastSeenAt: safeInteger(row.lastSeenAt, "Account graph last seen"),
      latestActivityAt: nullableInteger(
        row.latestActivityAt,
        "Account graph latest activity",
      ),
      personId: nullableText(row.personId, "Account graph Person identity"),
      provider: text(row.provider, "Account graph provider"),
      updatedAt: safeInteger(row.updatedAt, "Account graph update time"),
    }));
    const last = rows.at(-1);
    const response = {
      layoutRevision,
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreIdentityPageCursorV1({
              entityId: last.id,
              generationId,
              layoutRevision,
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
    const { generationId, layoutRevision, sourceRevision } =
      this.#queryGraphSource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.layoutRevision !== layoutRevision ||
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
      activityCount: safeInteger(
        row.activityCount,
        "RSS feed graph activity count",
      ),
      enabled: requiredBoolean(row.enabled, "RSS feed graph enabled"),
      imageUrl: nullableText(row.imageUrl, "RSS feed graph image URL"),
      latestActivityAt: nullableInteger(
        row.latestActivityAt,
        "RSS feed graph latest activity",
      ),
      title: text(row.title, "RSS feed graph title"),
      updatedAt: safeInteger(row.updatedAt, "RSS feed graph update time"),
      url: text(row.url, "RSS feed graph URL"),
    }));
    const last = rows.at(-1);
    const response = {
      layoutRevision,
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreIdentityPageCursorV1({
              entityId: last.url,
              generationId,
              layoutRevision,
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

  #queryPersonsGraph(
    input: LibraryCorePersonsGraphRequestV1,
  ): LibraryCorePersonsGraphResponseV1 {
    const request = parseLibraryCorePersonsGraphRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.persons_graph_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        JSON.stringify(request.value.sources),
        JSON.stringify(request.value.rssFeedUrls),
        request.value.recentWindow.startMs,
        request.value.recentWindow.endMs,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    const expectedRows =
      request.value.sources.length + request.value.rssFeedUrls.length;
    if (
      rawRows.length !== expectedRows ||
      rawRows.length > program.maximumScanRows
    ) {
      throw new Error("PWA Library SQLite persons graph row count is invalid");
    }
    const parseArray = (
      value: SqlValue | undefined,
      label: string,
    ): unknown[] => {
      const parsed = JSON.parse(text(value, label)) as unknown;
      if (!Array.isArray(parsed)) throw new Error(`${label} is not an array`);
      return parsed;
    };
    const social = request.value.sources.map((source, index) => {
      const row = rawRows[index]!;
      if (
        row.kind !== "social" ||
        row.platform !== source.platform ||
        row.authorId !== source.authorId ||
        row.feedUrl !== null
      ) {
        throw new Error(
          "PWA Library SQLite persons graph social order is invalid",
        );
      }
      const samples = parseArray(row.sampleItemsJson, "persons graph samples");
      const locations = parseArray(
        row.locationCandidatesJson,
        "persons graph locations",
      );
      const sparseSignals = parseArray(
        row.signalCountsJson,
        "persons graph signals",
      );
      const signalCounts = CONTENT_SIGNAL_KEYS.map((label) => {
        const matches = sparseSignals.filter(
          (value) =>
            value !== null &&
            typeof value === "object" &&
            Object.getPrototypeOf(value) === Object.prototype &&
            (value as Record<string, unknown>).label === label,
        );
        if (matches.length > 1) {
          throw new Error(
            "PWA Library SQLite persons graph signal is duplicated",
          );
        }
        const count = matches.length
          ? (matches[0] as Record<string, unknown>).count
          : 0;
        if (typeof count !== "number") {
          throw new Error(
            "PWA Library SQLite persons graph signal count is invalid",
          );
        }
        return { count, label };
      });
      return {
        authorId: source.authorId,
        avatarGlobalId: nullableText(
          row.avatarGlobalId,
          "persons graph avatar item",
        ),
        avatarPublishedAt: nullableInteger(
          row.avatarPublishedAt,
          "persons graph avatar time",
        ),
        avatarUrl: nullableText(row.avatarUrl, "persons graph avatar URL"),
        hasLocation: locations.length > 0,
        itemCount: safeInteger(row.itemCount, "persons graph item count"),
        latestActivityAt: safeInteger(
          row.latestActivityAt,
          "persons graph latest activity",
        ),
        locationCandidateCount: locations.length,
        locationCandidates: locations,
        platform: source.platform,
        recentCount: safeInteger(row.recentCount, "persons graph recent count"),
        sampleItems: samples,
        signalCounts,
      };
    });
    const rss = request.value.rssFeedUrls.map((feedUrl, rssIndex) => {
      const row = rawRows[request.value.sources.length + rssIndex]!;
      if (
        row.kind !== "rss" ||
        row.feedUrl !== feedUrl ||
        row.platform !== null ||
        row.authorId !== null
      ) {
        throw new Error(
          "PWA Library SQLite persons graph RSS order is invalid",
        );
      }
      const samples = parseArray(
        row.sampleItemsJson,
        "persons graph RSS samples",
      );
      const locations = parseArray(
        row.locationCandidatesJson,
        "persons graph RSS locations",
      );
      return {
        avatarGlobalId: nullableText(
          row.avatarGlobalId,
          "persons graph RSS avatar item",
        ),
        avatarPublishedAt: nullableInteger(
          row.avatarPublishedAt,
          "persons graph RSS avatar time",
        ),
        avatarUrl: nullableText(row.avatarUrl, "persons graph RSS avatar URL"),
        feedUrl,
        hasLocation: locations.length > 0,
        itemCount: safeInteger(row.itemCount, "persons graph RSS item count"),
        latestActivityAt: safeInteger(
          row.latestActivityAt,
          "persons graph RSS latest activity",
        ),
        locationCandidateCount: locations.length,
        locationCandidates: locations,
        sampleItems: samples,
      };
    });
    const totalRows = this.#database.exec({
      sql: program.countSql,
      rowMode: 0,
      returnValue: "resultRows",
    });
    const response = {
      queryId: "persons_graph_v1" as const,
      rss,
      schemaVersion: 1 as const,
      social,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalItemCount: safeInteger(
        totalRows[0],
        "persons graph total item count",
      ),
    };
    const parsed = parseLibraryCorePersonsGraphResponseV1(
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

  #querySavedAnalytics(
    input: LibraryCoreSavedAnalyticsRequestV2,
  ): LibraryCoreSavedAnalyticsResponseV2 {
    const request = parseLibraryCoreSavedAnalyticsRequestV2(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.saved_analytics_v2;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [
        JSON.stringify(request.value.dailyWindows),
        JSON.stringify(request.value.hourlyWindows),
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length !== program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite saved analytics returned an invalid row count",
      );
    }
    const row = rows[0]!;
    const response = {
      contentMix: JSON.parse(
        text(row.contentMixJson, "saved content mix"),
      ) as unknown,
      dailyCounts: JSON.parse(
        text(row.dailyCountsJson, "saved daily counts"),
      ) as unknown,
      hourlyCounts: JSON.parse(
        text(row.hourlyCountsJson, "saved hourly counts"),
      ) as unknown,
      latestSavedAt: nullableInteger(row.latestSavedAt, "latest saved time"),
      queryId: "saved_analytics_v2" as const,
      schemaVersion: 2 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      sourceCounts: JSON.parse(
        text(row.sourceCountsJson, "saved source counts"),
      ) as unknown,
      totalCount: safeInteger(row.totalCount, "saved total count"),
    };
    const parsed = parseLibraryCoreSavedAnalyticsResponseV2(response);
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
    const cards = rows.slice(0, request.value.limit).map((row) => {
      const hiddenState = safeInteger(row.hidden, "hidden state");
      const rssFeedUrl = nullableText(row.rssFeedUrl, "RSS feed URL");
      const sampleBatchId = nullableText(row.sampleBatchId, "sample batch ID");
      const sampleGeneratedAt =
        row.sampleGeneratedAt === null
          ? null
          : safeInteger(row.sampleGeneratedAt, "sample generation time");
      const sampleGeneratorVersion =
        row.sampleGeneratorVersion === null
          ? null
          : safeInteger(row.sampleGeneratorVersion, "sample generator version");
      if (
        ![0, 1].includes(hiddenState) ||
        (sampleBatchId === null) !== (sampleGeneratedAt === null) ||
        (sampleBatchId === null) !== (sampleGeneratorVersion === null)
      ) {
        throw new Error("PWA Library SQLite sample provenance is incomplete");
      }
      return {
        ...feedCardFromSqliteRow(row),
        hidden: hiddenState === 1,
        rssSource:
          rssFeedUrl === null
            ? null
            : {
                feedTitle: text(row.rssFeedTitle, "RSS feed title"),
                feedUrl: rssFeedUrl,
                siteUrl: text(row.rssSiteUrl, "RSS site URL"),
              },
        sampleDataFingerprint:
          sampleBatchId === null
            ? null
            : {
                batchId: sampleBatchId,
                generatedAt: sampleGeneratedAt!,
                generatorVersion: sampleGeneratorVersion!,
                marker: "freed.sample-data.v1" as const,
              },
      };
    });
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

  #queryContentFetchPage(
    input: LibraryCoreContentFetchPageRequestV1,
  ): LibraryCoreContentFetchPageResponseV1 {
    const request = parseLibraryCoreContentFetchPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreContentFetchPageCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite content fetch cursor is stale");
      }
      afterPublishedAt = cursor.value.publishedAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.content_fetch_claim_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [afterPublishedAt, afterGlobalId, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite content fetch exceeded its row bound",
      );
    }
    const hasMore = rows.length > request.value.limit;
    const candidates = rows.slice(0, request.value.limit).map((row) => ({
      capturedAt: safeInteger(row.capturedAt, "content fetch capture time"),
      globalId: text(row.globalId, "content fetch global ID"),
      linkUrl: text(row.linkUrl, "content fetch URL"),
      publishedAt: safeInteger(
        row.publishedAt,
        "content fetch publication time",
      ),
    }));
    const last = candidates.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreContentFetchPageCursorV1({
              generationId: generationId as never,
              globalId: last.globalId as never,
              projectionRevision: sourceRevision,
              publishedAt: last.publishedAt,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "content_fetch_claim_v1" as const,
      rows: candidates,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreContentFetchPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryProviderMediaPage(
    input: LibraryCoreProviderMediaPageRequestV1,
  ): LibraryCoreProviderMediaPageResponseV1 {
    const request = parseLibraryCoreProviderMediaPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const filterDigest = libraryCoreProviderMediaBindingDigestV1(
      request.value.provider,
      request.value.savedOnly,
    );
    let afterGlobalId: string | null = null;
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreProviderMediaPageCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.filterDigest !== filterDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite provider media cursor is stale");
      }
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.provider_media_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.provider,
        request.value.savedOnly ? 1 : 0,
        afterGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite provider media query exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreProviderMediaRowV1[] = rawRows
      .slice(0, request.value.limit)
      .map((row) => {
        const card = feedCardFromSqliteRow(row);
        const groupId = nullableText(row.fbGroupId, "provider media group ID");
        return {
          ...card,
          fbGroup:
            groupId === null
              ? null
              : {
                  id: groupId,
                  name:
                    nullableText(
                      row.fbGroupName,
                      "provider media group name",
                    ) ?? "",
                  url:
                    nullableText(row.fbGroupUrl, "provider media group URL") ??
                    "",
                },
          linkUrl: nullableText(row.linkUrl, "provider media link URL"),
        };
      });
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreProviderMediaPageCursorV1({
              filterDigest,
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "provider_media_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreProviderMediaPageResponseV1(
      response,
      request.value,
    );
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

  #queryFeedBrowsePage(
    input: LibraryCoreFeedBrowsePageRequestV3,
  ): LibraryCoreFeedBrowsePageResponseV3 {
    const request = parseLibraryCoreFeedBrowsePageRequestV3(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const filterDigest = libraryCoreFeedBrowseBindingDigestV3(
      request.value.filter,
      request.value.identityMode,
    );
    let cursorPriority: number | null = null;
    let cursorPublishedAt: number | null = null;
    let cursorGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreFeedBrowsePageCursorV2(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite browse cursor is stale");
      }
      cursorPriority = cursor.value.priority;
      cursorPublishedAt = cursor.value.publishedAt;
      cursorGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.feed_browse_page_v3;
    const filterBindings: SqlValue[] = [
      request.value.filter.archivedOnly ? 1 : 0,
      request.value.filter.showHidden ? 1 : 0,
      request.value.filter.platform,
      request.value.filter.authorId,
      request.value.filter.feedUrl,
      request.value.filter.socialContentFilter,
      request.value.filter.savedOnly ? 1 : 0,
      JSON.stringify(request.value.filter.tags),
      JSON.stringify(request.value.filter.signals),
      request.value.identityMode,
    ];
    const rawRows = this.#database.exec({
      sql:
        request.value.direction === "previous"
          ? program.reverseSql
          : program.sql,
      bind: [
        ...filterBindings,
        cursorPriority,
        cursorPublishedAt,
        cursorGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite browse query exceeded its row bound");
    }
    const hasMoreInDirection = rawRows.length > request.value.limit;
    const selectedRows = rawRows.slice(0, request.value.limit);
    if (request.value.direction === "previous") selectedRows.reverse();
    const rows = selectedRows.map((row) => ({
      card: feedCardFromSqliteRow(row),
      priority: safeInteger(row.browsePriority, "browse priority"),
    }));
    if (rows.some((row) => row.priority < 0 || row.priority > 100)) {
      throw new Error("PWA Library SQLite browse priority is invalid");
    }
    const edge = (row: (typeof rows)[number] | undefined) =>
      row
        ? {
            cursor: encodeLibraryCoreFeedBrowsePageCursorV2({
              filterDigest,
              generationId: generationId as never,
              globalId: row.card.globalId,
              priority: row.priority,
              projectionRevision: sourceRevision,
              publishedAt: row.card.publishedAt ?? 0,
              transitionSequence: sourceRevision,
            }),
            order: {
              globalId: row.card.globalId,
              priority: row.priority,
              publishedAt: row.card.publishedAt ?? 0,
            },
          }
        : null;
    const nextAvailable =
      request.value.direction === "next" ? hasMoreInDirection : rows.length > 0;
    const previousAvailable =
      request.value.direction === "previous"
        ? hasMoreInDirection
        : request.value.cursor !== null && rows.length > 0;
    const next = nextAvailable ? edge(rows.at(-1)) : null;
    const previous = previousAvailable ? edge(rows[0]) : null;
    const response = {
      filter: request.value.filter,
      friendsPredicateSchemaVersion:
        request.value.friendsPredicateSchemaVersion,
      identityMode: request.value.identityMode,
      nextCursor: next?.cursor ?? null,
      nextOrder: next?.order ?? null,
      previousCursor: previous?.cursor ?? null,
      previousOrder: previous?.order ?? null,
      queryId: "feed_browse_page_v3" as const,
      rankingClockMs: request.value.rankingClockMs,
      recommendationOrderSchemaVersion:
        request.value.recommendationOrderSchemaVersion,
      rows: rows.map((row) => row.card),
      schemaVersion: 3 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: filterBindings,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "browse total count",
      ),
    };
    const parsed = parseLibraryCoreFeedBrowsePageResponseV3(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #querySavedFeedPage(
    input: LibraryCoreSavedFeedPageRequestV2,
  ): LibraryCoreSavedFeedPageResponseV2 {
    const request = parseLibraryCoreSavedFeedPageRequestV2(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const filterDigest = libraryCoreFeedBrowseFilterDigestV1(
      request.value.filter,
    );
    let cursorSortGroup: number | null = null;
    let cursorSortPrimary: number | null = null;
    let cursorSortSecondary: number | null = null;
    let cursorGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreSavedFeedPageCursorV2(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.sourceRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite saved cursor is stale");
      }
      cursorSortGroup = cursor.value.sortGroup;
      cursorSortPrimary = cursor.value.sortPrimary;
      cursorSortSecondary = cursor.value.sortSecondary;
      cursorGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.saved_feed_page_v2;
    const variant = program.variants[request.value.sortMode];
    const filterBindings: SqlValue[] = [
      request.value.filter.archivedOnly ? 1 : 0,
      request.value.filter.platform,
      request.value.filter.authorId,
      request.value.filter.feedUrl,
      request.value.filter.socialContentFilter,
      JSON.stringify(request.value.filter.tags),
      JSON.stringify(request.value.filter.signals),
    ];
    const rawRows = this.#database.exec({
      sql:
        request.value.direction === "previous"
          ? variant.reverseSql
          : variant.sql,
      bind: [
        ...filterBindings,
        cursorSortGroup,
        cursorSortPrimary,
        cursorSortSecondary,
        cursorGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite saved query exceeded its row bound");
    }
    const hasMoreInDirection = rawRows.length > request.value.limit;
    const selectedRows = rawRows.slice(0, request.value.limit);
    if (request.value.direction === "previous") selectedRows.reverse();
    const rows = selectedRows.map((row) => ({
      card: savedFeedCardFromSqliteRow(row),
      sortGroup: safeInteger(row.sortGroup, "saved sort group"),
      sortPrimary: safeInteger(row.sortPrimary, "saved primary sort"),
      sortSecondary: safeInteger(row.sortSecondary, "saved secondary sort"),
    }));
    if (
      rows.some(
        (row) =>
          row.sortGroup < 0 ||
          row.sortGroup > 100 ||
          row.sortPrimary < 0 ||
          row.sortSecondary < 0,
      )
    ) {
      throw new Error("PWA Library SQLite saved order is invalid");
    }
    const edge = (row: (typeof rows)[number] | undefined) =>
      row
        ? {
            cursor: encodeLibraryCoreSavedFeedPageCursorV2({
              filterDigest,
              generationId: generationId as never,
              globalId: row.card.globalId,
              sortGroup: row.sortGroup,
              sortMode: request.value.sortMode,
              sortPrimary: row.sortPrimary,
              sortSecondary: row.sortSecondary,
              sourceRevision,
            }),
            order: {
              globalId: row.card.globalId,
              sortGroup: row.sortGroup,
              sortPrimary: row.sortPrimary,
              sortSecondary: row.sortSecondary,
            },
          }
        : null;
    const nextAvailable =
      request.value.direction === "next" ? hasMoreInDirection : rows.length > 0;
    const previousAvailable =
      request.value.direction === "previous"
        ? hasMoreInDirection
        : request.value.cursor !== null && rows.length > 0;
    const next = nextAvailable ? edge(rows.at(-1)) : null;
    const previous = previousAvailable ? edge(rows[0]) : null;
    const response = {
      filter: request.value.filter,
      nextCursor: next?.cursor ?? null,
      nextOrder: next?.order ?? null,
      previousCursor: previous?.cursor ?? null,
      previousOrder: previous?.order ?? null,
      queryId: "saved_feed_page_v2" as const,
      rows: rows.map((row) => row.card),
      schemaVersion: 2 as const,
      sortMode: request.value.sortMode,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: filterBindings,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "saved total count",
      ),
    };
    const parsed = parseLibraryCoreSavedFeedPageResponseV2(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #querySearchPage(
    input: LibraryCoreSearchPageRequestV1,
  ): LibraryCoreSearchPageResponseV1 {
    const request = parseLibraryCoreSearchPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const searchDigest = libraryCoreSearchPageRequestDigestV1(request.value);
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreSearchPageCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.searchDigest !== searchDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite search cursor is stale");
      }
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.search_page_v1;
    const filter = request.value.filter;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        filter.archivedOnly ? 1 : 0,
        filter.showHidden ? 1 : 0,
        filter.platform,
        filter.authorId,
        filter.feedUrl,
        filter.socialContentFilter,
        filter.savedOnly ? 1 : 0,
        JSON.stringify(filter.tags),
        JSON.stringify(filter.signals),
        request.value.identityMode,
        afterGlobalId,
        program.maximumScanRows,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite search exceeded its scan bound");
    }
    const queryTerms = tokenizeLibraryCoreSearchTextV1(request.value.query, 32);
    const rows: LibraryCoreSearchPageResponseV1["rows"][number][] = [];
    let scannedRows = 0;
    let lastScanned: Record<string, SqlValue> | undefined;
    for (const row of rawRows) {
      scannedRows += 1;
      lastScanned = row;
      const score = searchScoreFromSqliteRow(row, queryTerms);
      if (score > 0) {
        rows.push({
          card: feedCardFromSqliteRow(row),
          priority: safeInteger(row.searchPriority, "search priority"),
          score,
        });
      }
      if (rows.length === request.value.limit) break;
    }
    const nextCursor =
      (rows.length === request.value.limit ||
        scannedRows === program.maximumScanRows) &&
      lastScanned
        ? (() => {
            const globalId = text(lastScanned.globalId, "search scan edge");
            if (!isLibraryCoreEntityId(globalId)) {
              throw new Error(
                "PWA Library SQLite search returned an invalid entity identity",
              );
            }
            return encodeLibraryCoreSearchPageCursorV1({
              generationId: generationId as never,
              globalId,
              projectionRevision: sourceRevision,
              searchDigest,
              sortAt: 0,
              transitionSequence: sourceRevision,
            });
          })()
        : null;
    const response = {
      nextCursor,
      queryId: "search_page_v1" as const,
      rows,
      scannedRows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreSearchPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountTimeline(
    input: LibraryCoreAccountTimelineRequestV1,
  ): LibraryCoreAccountTimelineResponseV1 {
    const request = parseLibraryCoreAccountTimelineRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const accountDigest = libraryCoreAccountTimelineAccountDigestV1(
      request.value.accountId,
    );
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreAccountTimelineCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.accountDigest !== accountDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite account timeline cursor is stale");
      }
      afterPublishedAt = cursor.value.sortAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_timeline_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.accountId,
        afterPublishedAt,
        afterGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite account timeline exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreFeedCardV1[] = rawRows
      .slice(0, request.value.limit)
      .map(feedCardFromSqliteRow);
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last?.publishedAt !== null && last !== undefined
          ? encodeLibraryCoreAccountTimelineCursorV1({
              accountDigest,
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              sortAt: last.publishedAt,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "account_timeline_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: [request.value.accountId],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "account timeline total count",
      ),
    };
    const parsed = parseLibraryCoreAccountTimelineResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPersonTimeline(
    input: LibraryCorePersonTimelineRequestV1,
  ): LibraryCorePersonTimelineResponseV1 {
    const request = parseLibraryCorePersonTimelineRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const personDigest = libraryCorePersonTimelinePersonDigestV1(
      request.value.personId,
    );
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCorePersonTimelineCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.personDigest !== personDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite person timeline cursor is stale");
      }
      afterPublishedAt = cursor.value.sortAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.person_timeline_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.personId,
        afterPublishedAt,
        afterGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite person timeline exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreFeedCardV1[] = rawRows
      .slice(0, request.value.limit)
      .map(feedCardFromSqliteRow);
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last?.publishedAt !== null && last !== undefined
          ? encodeLibraryCorePersonTimelineCursorV1({
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              sortAt: last.publishedAt,
              personDigest,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "person_timeline_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: [request.value.personId],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "person timeline total count",
      ),
    };
    const parsed = parseLibraryCorePersonTimelineResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryMapMarkers(
    input: LibraryCoreMapMarkersRequestV1,
  ): LibraryCoreMapMarkersResponseV1 {
    const request = parseLibraryCoreMapMarkersRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.map_markers_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite map query exceeded its row bound");
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreMapMarkerV1[] = rawRows
      .slice(0, request.value.limit)
      .map((row) => ({
        authorAvatarUrl: nullableText(row.authorAvatarUrl, "map author avatar"),
        authorDisplayName: text(
          row.authorDisplayName,
          "map author display name",
        ),
        authorHandle: text(row.authorHandle, "map author handle"),
        authorId: text(row.authorId, "map author identity"),
        capturedAt: safeInteger(row.capturedAt, "map captured time"),
        contentText: nullableText(row.contentText, "map content text"),
        contentType: text(row.contentType, "map content type") as never,
        globalId: text(row.globalId, "map item identity"),
        locationLat: row.locationLat === null ? null : Number(row.locationLat),
        locationLng: row.locationLng === null ? null : Number(row.locationLng),
        locationName: nullableText(row.locationName, "map location name"),
        locationUrl: nullableText(row.locationUrl, "map location URL"),
        platform: text(row.platform, "map platform") as never,
        publishedAt: safeInteger(row.publishedAt, "map published time"),
        sourceUrl: nullableText(row.sourceUrl, "map source URL"),
        timeRangeEndsAt: nullableInteger(row.timeRangeEndsAt, "map range end"),
        timeRangeStartsAt: nullableInteger(
          row.timeRangeStartsAt,
          "map range start",
        ),
      }));
    const response = {
      hasMore,
      queryId: "map_markers_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreMapMarkersResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryStoryWallCandidates(
    input: LibraryCoreStoryWallCandidatesRequestV1,
  ): LibraryCoreStoryWallCandidatesResponseV1 {
    const request = parseLibraryCoreStoryWallCandidatesRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.story_wall_candidates_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Story Wall query exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreStoryWallCandidateV1[] = rawRows
      .slice(0, request.value.limit)
      .map((row) => ({
        authorDisplayName: text(
          row.authorDisplayName,
          "Story Wall author display name",
        ),
        authorHandle: text(row.authorHandle, "Story Wall author handle"),
        authorId: text(row.authorId, "Story Wall author identity"),
        capturedAt: safeInteger(row.capturedAt, "Story Wall captured time"),
        contentText: nullableText(row.contentText, "Story Wall caption"),
        globalId: text(row.globalId, "Story Wall item identity"),
        locationName: nullableText(row.locationName, "Story Wall location"),
        mediaTypes: stringArray(
          row.mediaTypesJson,
          "Story Wall media types",
        ) as never,
        mediaUrls: stringArray(row.mediaUrlsJson, "Story Wall media URLs"),
        platform: text(row.platform, "Story Wall platform") as never,
        publishedAt: safeInteger(row.publishedAt, "Story Wall published time"),
        sourceUrl: nullableText(row.sourceUrl, "Story Wall source URL"),
      }));
    const response = {
      hasMore,
      queryId: "story_wall_candidates_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreStoryWallCandidatesResponseV1(
      response,
      request.value,
    );
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
