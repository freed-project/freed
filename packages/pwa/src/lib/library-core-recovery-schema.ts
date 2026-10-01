import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION, LIBRARY_CORE_LOCAL_SCHEMA_SHA256,
  LIBRARY_CORE_LOCAL_SCHEMA_SQL, LIBRARY_CORE_LOCAL_SCHEMA_CATALOG,
  LIBRARY_CORE_SQLITE_APPLICATION_ID, LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION, LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
} from "@freed/shared/library-core";

type StorageIdentity = Readonly<{
  schemaVersion: typeof LIBRARY_CORE_SQLITE_SCHEMA_VERSION;
  schemaSha256: typeof LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256;
}> | Readonly<{
  schemaVersion: typeof LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION;
  schemaSha256: typeof LIBRARY_CORE_LOCAL_SCHEMA_SHA256;
}>;

function scalar(database: Database, sql: string): unknown {
  const rows = database.exec({ sql, rowMode: 0, returnValue: "resultRows" });
  if (rows.length !== 1) throw new Error("PWA Library storage scalar is missing");
  return rows[0];
}

/** Read physical identity separately from the unchanged logical checkpoint schema. */
export function readPwaLibraryStorageIdentity(database: Database): StorageIdentity {
  const version = scalar(database, "PRAGMA user_version;");
  if (scalar(database, "PRAGMA application_id;") !== LIBRARY_CORE_SQLITE_APPLICATION_ID ||
      (version !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION && version !== LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION)) {
    throw new Error("PWA Library SQLite version identity is unsupported");
  }
  const identity: StorageIdentity = version === LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION
    ? { schemaVersion: LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION, schemaSha256: LIBRARY_CORE_LOCAL_SCHEMA_SHA256 }
    : { schemaVersion: LIBRARY_CORE_SQLITE_SCHEMA_VERSION, schemaSha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256 };
  const rows = database.exec({
    sql: "SELECT contract_version, schema_version, protocol_version, schema_sha256 FROM library_storage_meta WHERE singleton_id = 1;",
    rowMode: "array", returnValue: "resultRows",
  });
  const row = rows[0];
  if (rows.length !== 1 || row?.[0] !== LIBRARY_CORE_SQLITE_CONTRACT_VERSION ||
      row[1] !== identity.schemaVersion || row[2] !== LIBRARY_CORE_SQLITE_PROTOCOL_VERSION || row[3] !== identity.schemaSha256) {
    throw new Error("PWA Library SQLite storage identity does not match this build");
  }
  for (const object of LIBRARY_CORE_LOCAL_SCHEMA_CATALOG) {
    const declarations = database.exec({
      sql: "SELECT type, sql FROM sqlite_schema WHERE name = ?1;", bind: [object.name],
      rowMode: "array", returnValue: "resultRows",
    });
    if (version === LIBRARY_CORE_SQLITE_SCHEMA_VERSION) {
      if (declarations.length !== 0) throw new Error("PWA Library has an unversioned recovery catalog");
    } else if (declarations.length !== 1 || declarations[0]?.[0] !== object.type || declarations[0]?.[1] !== object.sql) {
      throw new Error("PWA Library recovery catalog does not match this build");
    }
  }
  return Object.freeze(identity);
}

/** Called only inside the FULL transaction that records recovery. The caller
 * owns rollback, including these schema changes and its lifecycle record. */
export function migratePwaLibraryRecoverySchema(
  database: Database,
  capi: Pick<Sqlite3Static["capi"], "sqlite3_get_autocommit" | "sqlite3_txn_state">,
): void {
  if (!database.pointer || capi.sqlite3_get_autocommit(database.pointer) !== 0 ||
      capi.sqlite3_txn_state(database.pointer, "main") !== 2 ||
      scalar(database, "PRAGMA synchronous;") !== 2 || scalar(database, "PRAGMA foreign_keys;") !== 1) {
    throw new Error("PWA Library recovery requires an owned FULL transaction");
  }
  const identity = readPwaLibraryStorageIdentity(database);
  if (identity.schemaVersion === LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION) return;
  database.exec(LIBRARY_CORE_LOCAL_SCHEMA_SQL);
  database.exec({
    sql: `UPDATE library_storage_meta SET schema_version = ?1, schema_sha256 = ?2
          WHERE singleton_id = 1 AND schema_version = ?3 AND schema_sha256 = ?4;`,
    bind: [LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION, LIBRARY_CORE_LOCAL_SCHEMA_SHA256,
      LIBRARY_CORE_SQLITE_SCHEMA_VERSION, LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256],
  });
  if (scalar(database, "SELECT changes();") !== 1) throw new Error("PWA Library migration source changed");
  database.exec(`PRAGMA user_version = ${LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION};`);
  readPwaLibraryStorageIdentity(database);
}
