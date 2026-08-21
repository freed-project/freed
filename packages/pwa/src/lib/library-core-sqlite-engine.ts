import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SQL,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  type LibraryCoreSqliteWorkerStatus,
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageRequestV1,
  type LibraryCoreFeedPageResponseV1,
} from "@freed/shared/library-core";

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

function nullableText(value: SqlValue | undefined, label: string): string | null {
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

function nullableBoolean(value: SqlValue | undefined, label: string): boolean | null {
  if (value === null) return null;
  const integer = safeInteger(value, label);
  if (integer !== 0 && integer !== 1) throw new Error(`${label} is not boolean`);
  return integer === 1;
}

function stringArray(value: SqlValue | undefined, label: string): readonly string[] {
  const parsed = JSON.parse(text(value, label)) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} is not a text array`);
  }
  return Object.freeze(parsed);
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
    if (userVersion === 0) {
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
      this.#database.exec(`PRAGMA user_version = ${LIBRARY_CORE_SQLITE_SCHEMA_VERSION};`);
    } else if (userVersion !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION) {
      throw new Error("PWA Library SQLite schema version is unsupported");
    }
    this.#verifyStorageIdentity();
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

  queryFeedPage(input: LibraryCoreFeedPageRequestV1): LibraryCoreFeedPageResponseV1 {
    const request = parseLibraryCoreFeedPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const sourceRow = this.#database.exec({
      sql: "SELECT library_id, source_revision FROM library_meta WHERE singleton_id = 1;",
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (sourceRow.length !== 1) {
      throw new Error("PWA Library SQLite has no active Library");
    }
    const generationId = text(sourceRow[0]![0], "Library identity");
    const sourceRevision = safeInteger(sourceRow[0]![1], "Library source revision");
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
      .map((row) => {
        const candidate = {
          archived: nullableBoolean(row.archived, "feed archived"),
          authorAvatarUrl: nullableText(row.authorAvatarUrl, "feed author avatar"),
          authorDisplayName: nullableText(row.authorDisplayName, "feed author display name"),
          authorHandle: nullableText(row.authorHandle, "feed author handle"),
          authorId: nullableText(row.authorId, "feed author identity"),
          capturedAt: nullableInteger(row.capturedAt, "feed captured time"),
          contentSignalTags: stringArray(row.contentSignalTagsJson, "feed signal tags"),
          contentText: nullableText(row.contentText, "feed content text"),
          contentType: nullableText(row.contentType, "feed content type"),
          engagementComments: nullableInteger(row.engagementComments, "feed comments"),
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
          readingTimeMinutes: nullableInteger(row.readingTimeMinutes, "feed reading time"),
          saved: nullableBoolean(row.saved, "feed saved"),
          sourceUrl: nullableText(row.sourceUrl, "feed source URL"),
          tags: stringArray(row.tagsJson, "feed tags"),
        };
        const parsed = parseLibraryCoreFeedCardV1(candidate);
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
      });
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
      throw new Error("PWA Library SQLite feed response exceeded its byte bound");
    }
    const parsed = parseLibraryCoreFeedPageResponseV1(response, request.value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
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
    const row = rows[0]!;
    if (
      safeInteger(row[0], "SQLite contract version") !==
        LIBRARY_CORE_SQLITE_CONTRACT_VERSION ||
      safeInteger(row[1], "SQLite schema version") !==
        LIBRARY_CORE_SQLITE_SCHEMA_VERSION ||
      safeInteger(row[2], "SQLite protocol version") !==
        LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
      text(row[3], "SQLite schema digest") !==
        LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256
    ) {
      throw new Error("PWA Library SQLite storage identity does not match this build");
    }
  }
}
