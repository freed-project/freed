import { rejectPwaAnnotationBuilding } from "./library-core-annotation-storage";
import { requireLibraryTransferCapability } from "./library-transfer-capability";
import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION, LIBRARY_CORE_LOCAL_SCHEMA_SHA256,
  LIBRARY_CORE_LOCAL_SCHEMA_SQL, LIBRARY_CORE_LOCAL_SCHEMA_CATALOG,
  LIBRARY_CORE_SQLITE_APPLICATION_ID, LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION, LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256, LIBRARY_CORE_ANNOTATION_SCHEMA_CATALOG,
} from "@freed/shared/library-core";

type StorageIdentity = Readonly<{ schemaVersion: 4 | 5; schemaSha256: typeof LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[number] }> | Readonly<{
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
      (version !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION && version !== LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION && version !== 4 && version !== 5)) {
    throw new Error("PWA Library SQLite version identity is unsupported");
  }
  rejectPwaAnnotationBuilding(database);
  const identity: StorageIdentity = version === 4 || version === 5
    ? { schemaVersion: version, schemaSha256: LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[version === 4 ? 0 : 1] }
    : version === LIBRARY_CORE_LOCAL_STORAGE_SCHEMA_VERSION
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
    if (version === LIBRARY_CORE_SQLITE_SCHEMA_VERSION || version === 4) {
      if (declarations.length !== 0) throw new Error("PWA Library has an unversioned recovery catalog");
    } else if (declarations.length !== 1 || declarations[0]?.[0] !== object.type || declarations[0]?.[1] !== object.sql) {
      throw new Error("PWA Library recovery catalog does not match this build");
    }
  }
  for (const object of LIBRARY_CORE_ANNOTATION_SCHEMA_CATALOG) {
    const declarations=database.exec({sql:"SELECT type,sql FROM sqlite_schema WHERE name=?1;",bind:[object.name],rowMode:"array",returnValue:"resultRows"});
    if (version===4 || version===5) {
      if (declarations.length!==1 || declarations[0]?.[0]!==object.type || declarations[0]?.[1]!==object.sql) throw new Error("PWA Library annotation catalog does not match this build");
    } else if (declarations.length!==0) throw new Error("PWA Library has an unversioned annotation catalog");
  }
  if (version===4 || version===5) {
    const ready=database.selectValue("SELECT phase='ready' AND catalog_version=?1 AND catalog_sha256=?2 AND origin_sha256=CASE origin_version WHEN 1 THEN ?3 WHEN 2 THEN ?4 END FROM library_local_annotation_migration WHERE singleton_id=1;",[version,identity.schemaSha256,LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,LIBRARY_CORE_LOCAL_SCHEMA_SHA256]);
    if (ready!==1) throw new Error("PWA Library annotation receipt does not match this build");
  }
  return Object.freeze(identity);
}

/** Called only inside the FULL transaction that records recovery. The caller
 * owns rollback, including these schema changes and its lifecycle record. */
export function migratePwaLibraryRecoverySchema(
  database: Database,
  capi: Pick<Sqlite3Static["capi"], "sqlite3_get_autocommit" | "sqlite3_txn_state">,
): void {
  requireLibraryTransferCapability();
  if (!database.pointer || capi.sqlite3_get_autocommit(database.pointer) !== 0 ||
      capi.sqlite3_txn_state(database.pointer, "main") !== 2 ||
      scalar(database, "PRAGMA synchronous;") !== 2 || scalar(database, "PRAGMA foreign_keys;") !== 1) {
    throw new Error("PWA Library recovery requires an owned FULL transaction");
  }
  const identity = readPwaLibraryStorageIdentity(database);
  if (identity.schemaVersion===5) return;
  if (identity.schemaVersion===4) {
    database.exec(LIBRARY_CORE_LOCAL_SCHEMA_SQL);
    database.exec({sql:"UPDATE library_storage_meta SET schema_version=5,schema_sha256=?1 WHERE singleton_id=1 AND schema_version=4 AND schema_sha256=?2;",bind:[LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[1],LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[0]]});
    if (scalar(database,"SELECT changes();")!==1) throw new Error("Annotation recovery migration source changed");
    database.exec({sql:"UPDATE library_local_annotation_migration SET catalog_version=5,catalog_sha256=?1 WHERE singleton_id=1 AND phase='ready' AND catalog_version=4 AND catalog_sha256=?2;",bind:[LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[1],LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[0]]});
    if (scalar(database,"SELECT changes();")!==1) throw new Error("Annotation recovery receipt changed");
    database.exec("PRAGMA user_version=5;");
    readPwaLibraryStorageIdentity(database);
    return;
  }
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
