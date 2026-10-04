import { requireLibraryTransferCapability } from "./library-transfer-capability";
import type { CAPI, Database, PreparedStatement } from "@sqlite.org/sqlite-wasm";
import {
  decodeLibraryCoreCanonicalBase64, decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalBase64, encodeLibraryCoreCanonicalValue,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, LibraryCoreSha256, sha256LowerHex,
  type LibraryCoreCanonicalValue,
} from "@freed/shared/library-core";
import { readPwaLibraryStorageIdentity } from "./library-core-recovery-schema";

// Order is part of the native archive commitment, independent of SQL collation.
const tables = [
  "library_follower_actor_request", "library_intent_actors", "library_intent_transactions",
  "library_intent_members", "library_intent_results", "library_intent_result_cursors",
  "library_intent_transport_heads", "library_intent_transport_segments",
  "library_result_transport_heads", "library_result_transport_segments",
  "library_optimistic_fields", "library_local_change_state", "library_local_invalidations",
] as const;
const rowLimit = 2_097_152;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const canonical = (value: LibraryCoreCanonicalValue, maximumBytes: number) =>
  encodeLibraryCoreCanonicalValue(value, { maximumBytes });

/** Preserve SQLite values without routing int64 or arbitrary text through JS strings. */
export function encodePwaRecoveryRow(statement: PreparedStatement, capi: CAPI): Uint8Array {
  if (statement.columnCount > 256) throw new Error("consumer recovery columns exceed their bound");
  const cells: string[][] = [];
  let sourceBytes = 0;
  for (let index = 0; index < statement.columnCount; index++) {
    const type = capi.sqlite3_column_type(statement, index);
    if (type === capi.SQLITE_NULL) cells.push(["null"]);
    else if (type === capi.SQLITE_INTEGER) cells.push(["integer", statement.get(index, capi.SQLITE_TEXT) as string]);
    else if (type === capi.SQLITE_FLOAT) {
      const bits = new DataView(new ArrayBuffer(8));
      bits.setFloat64(0, statement.getFloat(index)!, false);
      cells.push(["real", bits.getBigUint64(0, false).toString(16).padStart(16, "0")]);
    } else if (type === capi.SQLITE_TEXT || type === capi.SQLITE_BLOB) {
      sourceBytes += capi.sqlite3_column_bytes(statement, index);
      if (sourceBytes > rowLimit) throw new Error("consumer recovery row exceeds its bound");
      cells.push([type === capi.SQLITE_TEXT ? "text" : "blob",
        encodeLibraryCoreCanonicalBase64(statement.getBlob(index) ?? new Uint8Array())]);
    } else throw new Error("consumer recovery SQLite type is invalid");
  }
  return canonical(cells, rowLimit);
}

function requireTransaction(db: Database, capi: CAPI, admitStorage?: () => void): void {
  if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer) !== 0 ||
      capi.sqlite3_txn_state(db.pointer, "main") !== 2 ||
      db.selectValue("PRAGMA synchronous;") !== 2 || db.selectValue("PRAGMA foreign_keys;") !== 1) {
    throw new Error("consumer archive requires an owned FULL transaction");
  }
  if (admitStorage) admitStorage();
  else if (readPwaLibraryStorageIdentity(db).schemaVersion !== 2) throw new Error("consumer archive requires local schema 2");
}
function layout(db: Database, table: typeof tables[number]) {
  const info = db.exec({ sql: `PRAGMA table_info(${table});`, rowMode: "array", returnValue: "resultRows" });
  if (info.length === 0 || info.length > 256) throw new Error("consumer archive columns are invalid");
  const names = info.map(row => {
    if (typeof row[1] !== "string" || /[^a-z0-9_]/.test(row[1])) throw new Error("consumer archive column is invalid");
    return row[1];
  });
  const keys = info.filter(row => typeof row[5] === "number" && row[5] > 0).sort((a, b) => Number(a[5]) - Number(b[5]));
  if (!keys.length) throw new Error("consumer archive table has no stable key");
  return { names, columns: utf8.decode(canonical(names, 16_384)),
    sql: `SELECT * FROM ${table} ORDER BY ${keys.map(row => `"${row[1]}"`).join(",")};` };
}
function textCell(bytes: Uint8Array, index: number): string | null {
  if (index < 0) return null;
  const cells = decodeLibraryCoreCanonicalValue(bytes, { maximumBytes: rowLimit });
  const cell = Array.isArray(cells) ? cells[index] : null;
  if (!Array.isArray(cell) || cell.length !== 2 || cell[0] !== "text" || typeof cell[1] !== "string") {
    throw new Error("consumer archive text cell is invalid");
  }
  return utf8.decode(decodeLibraryCoreCanonicalBase64(cell[1]));
}
function countState(state: string | null, counts: number[]): void {
  if (state === null) return;
  if (state === "pending") counts[0] = counts[0]! + 1;
  else if (state === "published") counts[1] = counts[1]! + 1;
  else if (state !== "accepted" && state !== "rejected") throw new Error("consumer archive intent state is invalid");
}
function commitRow(digest: LibraryCoreSha256, table: string, ordinal: number, columns: string, rowDigest: string, transaction: string | null) {
  const bytes = canonical([table, ordinal, columns, rowDigest, transaction], 16_384);
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength), false);
  digest.update(length).update(bytes);
}
function metadata(db: Database, id: string) {
  const rows = db.exec({ sql: `SELECT row_count, archive_digest, pending_intent_count, published_intent_count
    FROM library_local_recovery_archives WHERE recovery_id = ?1 AND schema_sha256 = ?2;`,
    bind: [id, LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256], rowMode: "array", returnValue: "resultRows" });
  if (rows.length !== 1) throw new Error("consumer archive identity is missing");
  return rows[0]!;
}

/** Caller owns lifecycle admission, schema migration and rollback of every archive write. */
export function archivePwaFollowerRows(db: Database, capi: CAPI, recoveryId: string): void {
  archivePwaFollowerRowsWithStorageAdmission(db, capi, recoveryId);
}

/** Internal storage admission only; archive layout and commitment remain unchanged. */
export function archivePwaFollowerRowsWithStorageAdmission(
  db: Database, capi: CAPI, recoveryId: string, admitStorage?: () => void,
): void {
  requireLibraryTransferCapability();
  requireTransaction(db, capi, admitStorage);
  const old = metadata(db, recoveryId);
  if (old[0] !== 0 || old[1] !== "0".repeat(64)) {
    verifyPwaRecoveryArchiveWithStorageAdmission(db, capi, recoveryId, true, admitStorage);
    return;
  }
  if (db.selectValue("SELECT count(*) FROM library_local_recovery_rows WHERE recovery_id = ?1;", [recoveryId]) !== 0) {
    throw new Error("consumer archive has unfinished rows");
  }
  const digest = new LibraryCoreSha256(), counts = [0, 0];
  let total = 0;
  for (const table of tables) {
    const columns = layout(db, table), statement = db.prepare(columns.sql);
    let ordinal = 0;
    try {
      while (statement.step()) {
        const bytes = encodePwaRecoveryRow(statement, capi), rowDigest = sha256LowerHex(bytes);
        const transaction = textCell(bytes, columns.names.indexOf("transaction_id"));
        if (table === "library_intent_transactions") countState(textCell(bytes, columns.names.indexOf("state")), counts);
        commitRow(digest, table, ordinal, columns.columns, rowDigest, transaction);
        db.exec({ sql: `INSERT INTO library_local_recovery_rows
          (recovery_id, table_key, row_ordinal, columns_json, canonical_row, row_digest, transaction_id)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);`,
          bind: [recoveryId, table, ordinal, columns.columns, bytes, rowDigest, transaction] });
        ordinal++; total++;
      }
    } finally { statement.finalize(); }
  }
  db.exec({ sql: `UPDATE library_local_recovery_archives SET row_count = ?2, archive_digest = ?3,
    pending_intent_count = ?4, published_intent_count = ?5 WHERE recovery_id = ?1;`,
    bind: [recoveryId, total, digest.digestLowerHex(), counts[0]!, counts[1]!] });
  verifyPwaRecoveryArchiveWithStorageAdmission(db, capi, recoveryId, true, admitStorage);
}

/** Verify one row at a time; compare live rows only before explicit reenrollment. */
export function verifyPwaRecoveryArchive(db: Database, capi: CAPI, recoveryId: string, compareLive: boolean): void {
  verifyPwaRecoveryArchiveWithStorageAdmission(db,capi,recoveryId,compareLive);
}

/** Internal version admission hook; byte, digest and live-row checks stay identical. */
export function verifyPwaRecoveryArchiveWithStorageAdmission(
  db: Database, capi: CAPI, recoveryId: string, compareLive: boolean, admitStorage?: () => void,
): void {
  requireTransaction(db, capi, admitStorage);
  const expected = metadata(db, recoveryId), digest = new LibraryCoreSha256(), counts = [0, 0];
  let total = 0;
  for (const table of tables) {
    const columns = layout(db, table), live = compareLive ? db.prepare(columns.sql) : null;
    const stored = db.prepare(`SELECT row_ordinal, columns_json, canonical_row, row_digest, transaction_id
      FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = ?2 ORDER BY row_ordinal;`);
    stored.bind([recoveryId, table]);
    let ordinal = 0;
    try {
      while (stored.step()) {
        if (capi.sqlite3_column_bytes(stored, 2) > rowLimit) throw new Error("consumer archive row exceeds its bound");
        const bytes = stored.getBlob(2);
        if (!bytes || stored.get(0) !== ordinal || stored.get(1) !== columns.columns || sha256LowerHex(bytes) !== stored.get(3)) {
          throw new Error("consumer recovery archive row changed");
        }
        const transaction = textCell(bytes, columns.names.indexOf("transaction_id"));
        if (transaction !== stored.get(4)) throw new Error("consumer archive transaction index changed");
        if (table === "library_intent_transactions") countState(textCell(bytes, columns.names.indexOf("state")), counts);
        if (live) {
          if (!live.step()) throw new Error("consumer archive live rows changed");
          const current = encodePwaRecoveryRow(live, capi);
          if (current.length !== bytes.length || current.some((value, index) => value !== bytes[index])) throw new Error("consumer archive live rows changed");
        }
        commitRow(digest, table, ordinal, columns.columns, sha256LowerHex(bytes), transaction);
        ordinal++; total++;
      }
      if (live?.step()) throw new Error("consumer archive live rows changed");
    } finally { stored.finalize(); live?.finalize(); }
  }
  if (total !== expected[0] || digest.digestLowerHex() !== expected[1] || counts[0] !== expected[2] || counts[1] !== expected[3] ||
      db.selectValue("SELECT count(*) FROM library_local_recovery_rows WHERE recovery_id = ?1;", [recoveryId]) !== total) {
    throw new Error("consumer recovery archive is incomplete");
  }
}
