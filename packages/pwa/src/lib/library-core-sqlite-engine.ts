import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SQL,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  type LibraryCoreSqliteWorkerStatus,
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
