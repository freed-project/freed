/** Annotation-specific local upgrade. Canonical schema/protocol identities stay unchanged. */
import type { CAPI, Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_ANNOTATION_SCHEMA_SQL, LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256,
  LIBRARY_CORE_ANNOTATION_COVERAGE_SQL, LIBRARY_CORE_NORMALIZED_SCHEMA_SQL,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256, LIBRARY_CORE_LOCAL_SCHEMA_SQL,
  LIBRARY_CORE_LOCAL_SCHEMA_SHA256, LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION, LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
} from "@freed/shared/library-core";

const PAGE_BYTES = 1_048_576;
const MAXIMUM_PAGES = 4;
const MAXIMUM_TIME_MS = 250;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const PIN_SQL = `SELECT json_object('library',(SELECT library_id FROM library_meta WHERE singleton_id=1),
  'authority',(SELECT authority_epoch FROM library_meta WHERE singleton_id=1),
  'activeAuthority',(SELECT epoch_id FROM library_active_authority WHERE library_id=(SELECT library_id FROM library_meta WHERE singleton_id=1)),
  'generation',(SELECT generation_id FROM library_materialization_generation WHERE singleton_id=1),
  'canonical',(SELECT source_revision FROM library_meta WHERE singleton_id=1),
  'change',(SELECT revision FROM library_change_state WHERE singleton_id=1),
  'local',(SELECT sequence FROM library_local_change_state WHERE singleton_id=1));`;
function scalar(db: Database, sql: string, bind: SqlValue[] = []): SqlValue {
  const rows = db.exec({ sql, bind, rowMode: 0, returnValue: "resultRows" });
  if (rows.length !== 1) throw new Error("Annotation storage scalar is missing");
  return rows[0] as SqlValue;
}
function digest(version: number): string {
  switch (version) {
    case 1: return LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256;
    case 2: return LIBRARY_CORE_LOCAL_SCHEMA_SHA256;
    case 4: return LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[0];
    case 5: return LIBRARY_CORE_ANNOTATION_SCHEMA_SHA256[1];
    default: throw new Error("Annotation storage version is unsupported");
  }
}
function catalog(db: Database): string {
  const statement = db.prepare("SELECT name,type,substr(sql,1,262145) FROM sqlite_schema WHERE sql IS NOT NULL AND substr(name,1,7) <> 'sqlite_' ORDER BY name LIMIT 1025;");
  const rows: SqlValue[][] = [];
  let bytes = 0;
  try {
    while (statement.step()) {
      const row = statement.get([]) as SqlValue[];
      if (row.some(value => typeof value !== "string")) throw new Error("Annotation catalog row is invalid");
      const size = row.reduce<number>((sum,value) => sum+encoder.encode(value as string).byteLength,0);
      bytes += size;
      if (size>262144 || bytes>PAGE_BYTES || rows.length>=1024) throw new Error("Annotation catalog exceeds verification bound");
      rows.push(row);
    }
  } finally { statement.finalize(); }
  return JSON.stringify(rows);
}

/** The caller supplies a fresh in-memory DB, never a second persistent Library. */
export function verifyPwaAnnotationCatalog(db: Database, reference: Database): number {
  const version = Number(scalar(db,"PRAGMA user_version;"));
  const hash = digest(version);
  if (scalar(db,"PRAGMA application_id;") !== LIBRARY_CORE_SQLITE_APPLICATION_ID ||
      scalar(db,"SELECT contract_version=?1 AND schema_version=?2 AND protocol_version=?3 AND schema_sha256=?4 FROM library_storage_meta WHERE singleton_id=1;",
        [LIBRARY_CORE_SQLITE_CONTRACT_VERSION,version,LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,hash]) !== 1) throw new Error("Annotation storage identity mismatch");
  reference.exec(LIBRARY_CORE_NORMALIZED_SCHEMA_SQL);
  if (version===2 || version===5) reference.exec(LIBRARY_CORE_LOCAL_SCHEMA_SQL);
  if (version===4 || version===5) reference.exec(LIBRARY_CORE_ANNOTATION_SCHEMA_SQL);
  if (catalog(db)!==catalog(reference)) throw new Error("Annotation storage catalog mismatch");
  if (version===4 || version===5) {
    if (scalar(db,`SELECT catalog_version=?1 AND catalog_sha256=?2 AND origin_sha256=CASE origin_version WHEN 1 THEN ?3 WHEN 2 THEN ?4 END
      FROM library_local_annotation_migration WHERE singleton_id=1;`,[version,hash,LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,LIBRARY_CORE_LOCAL_SCHEMA_SHA256]) !== 1) throw new Error("Annotation migration receipt mismatch");
  }
  return version;
}

export function rejectPwaAnnotationBuilding(db: Database): void {
  const version = Number(scalar(db,"PRAGMA user_version;"));
  // Dormant preference v3 retains its own exact catalog gate, as on native.
  // This phase guard neither activates v3 nor admits it to ordinary startup.
  if (version !== 3) digest(version);
  if ((version===4 || version===5) && scalar(db,"SELECT phase='ready' FROM library_local_annotation_migration WHERE singleton_id=1;") !== 1) throw new Error("LOCAL_ANNOTATION_MIGRATION_BUILDING");
}
export function requirePwaAnnotationReady(db: Database): void {
  if (![4,5].includes(Number(scalar(db,"PRAGMA user_version;")))) throw new Error("LOCAL_ANNOTATION_UPGRADE_REQUIRED");
  rejectPwaAnnotationBuilding(db);
}
export function pwaAnnotationPending(db: Database, entityId: string): boolean {
  requirePwaAnnotationReady(db);
  if (!entityId || encoder.encode(entityId).byteLength>2048) throw new Error("Annotation identity exceeds bound");
  return scalar(db,"SELECT EXISTS(SELECT 1 FROM library_local_annotation_unresolved WHERE entity_id=?1);",[entityId])===1;
}

/** Exclusive worker ownership is retained across every invocation and restart.
 * SQL progress and a page budget bound work; OPFS OS I/O remains cooperative.
 */
export function resumePwaAnnotationUpgrade(db: Database, capi: CAPI, openReference: () => Database): boolean {
  if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer)!==1) throw new Error("Annotation upgrade requires an owned idle connection");
  const deadline = performance.now()+MAXIMUM_TIME_MS;
  const busy = scalar(db,"PRAGMA busy_timeout;");
  db.exec("PRAGMA busy_timeout=25; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
  capi.sqlite3_progress_handler(db.pointer,1000,()=>performance.now()>=deadline ? 1 : 0,0);
  try {
    const reference = openReference();
    let version: number;
    try { version=verifyPwaAnnotationCatalog(db,reference); } finally { reference.close(); }
    if (performance.now()>=deadline) return false;
    if (version===1 || version===2) {
      db.transaction("IMMEDIATE",()=>{
        const lockedReference = openReference();
        try {
          if (verifyPwaAnnotationCatalog(db,lockedReference)!==version) throw new Error("Annotation migration source changed");
        } finally { lockedReference.close(); }
        const target = version===1 ? 4 : 5;
        const pinned = scalar(db,PIN_SQL);
        db.exec(LIBRARY_CORE_ANNOTATION_SCHEMA_SQL);
        db.exec({sql:"INSERT INTO library_local_annotation_migration VALUES(1,?1,?2,?3,?4,'building',?5,NULL,NULL,0);",bind:[version,digest(version),target,digest(target),pinned]});
        db.exec({sql:"UPDATE library_storage_meta SET schema_version=?1,schema_sha256=?2 WHERE singleton_id=1 AND schema_version=?3 AND schema_sha256=?4;",bind:[target,digest(target),version,digest(version)]});
        if (scalar(db,"SELECT changes();")!==1) throw new Error("Annotation migration source changed");
        db.exec(`PRAGMA user_version=${target};`);
      });
    }
    for (let page=0;page<MAXIMUM_PAGES && performance.now()<deadline;page++) {
      const ready = db.transaction("IMMEDIATE",()=>{
        const progress = db.exec({sql:"SELECT phase,pinned_identity,after_transaction_id,after_member_index FROM library_local_annotation_migration WHERE singleton_id=1;",rowMode:"array",returnValue:"resultRows"})[0];
        if (!progress) throw new Error("Annotation migration progress is missing");
        if (progress[0]==="ready") return true;
        if (progress[1]!==scalar(db,PIN_SQL)) throw new Error("Annotation backfill source changed");
        // LIMIT applies to unfiltered PK rows, before inspecting mutation or state.
        const rows = db.exec({sql:`SELECT transaction_id,member_index,substr(CAST(entity_id AS BLOB),1,2049),substr(CAST(mutation_id AS BLOB),1,129)
          FROM library_intent_members WHERE (transaction_id,member_index)>(?1,?2) ORDER BY transaction_id,member_index LIMIT 256;`,
          bind:[progress[2] ?? "",progress[3] ?? -1],rowMode:"array",returnValue:"resultRows"});
        if (!rows.length) {
          db.exec("UPDATE library_local_annotation_migration SET phase='ready' WHERE singleton_id=1 AND phase='building';");
          return true;
        }
        // All metadata remains resident while a result is verified.
        let used=rows.reduce((bytes,row)=>bytes+row.reduce<number>((sum,value)=>
          sum+(value instanceof Uint8Array ? value.byteLength : typeof value === "string" ? encoder.encode(value).byteLength : 0),32),0);
        if (used>PAGE_BYTES) throw new Error("Annotation metadata page exceeds bound");
        for (const row of rows) {
          if (performance.now()>=deadline) break;
          const [id,index,entityBytes,kindBytes]=row;
          if (typeof id!=="string" || typeof index!=="number" || !(entityBytes instanceof Uint8Array) || !(kindBytes instanceof Uint8Array) || entityBytes.byteLength>2048 || kindBytes.byteLength>128) throw new Error("Annotation backfill metadata exceeds bound");
          const entity=decoder.decode(entityBytes), kind=decoder.decode(kindBytes);
          if (kind==="feed_item_annotations_replace") {
            const lengths=db.exec({sql:"SELECT length(canonical_result) + CASE WHEN status='already_applied' THEN 262144 ELSE 0 END FROM library_intent_results WHERE transaction_id=?1;",bind:[id],rowMode:0,returnValue:"resultRows"});
            used+=Number(lengths[0] ?? 0);
            if (used>PAGE_BYTES) break;
            if (scalar(db,LIBRARY_CORE_ANNOTATION_COVERAGE_SQL,[id])!==1) db.exec({sql:"INSERT INTO library_local_annotation_unresolved VALUES(?1,?2,?3);",bind:[entity,id,index]});
          }
          db.exec({sql:"UPDATE library_local_annotation_migration SET after_transaction_id=?1,after_member_index=?2,scanned_members=scanned_members+1 WHERE singleton_id=1;",bind:[id,index]});
        }
        return false;
      });
      if (ready) return true;
    }
    return false;
  } catch (error) {
    if (performance.now()>=deadline && String(error).includes("interrupt")) return false;
    throw error;
  } finally {
    capi.sqlite3_progress_handler(db.pointer,0,0,0);
    db.exec(`PRAGMA busy_timeout=${Number(busy)};`);
  }
}

/** Caller owns the same write transaction as the durable intent member. */
export function insertPwaAnnotationMarker(db: Database, entity: string, transactionId: string, memberIndex: number): void {
  requirePwaAnnotationReady(db);
  db.exec({sql:"INSERT INTO library_local_annotation_unresolved VALUES(?1,?2,?3);",bind:[entity,transactionId,memberIndex]});
  invalidateAnnotation(db,entity,"optimistic_added");
}
function invalidateAnnotation(db: Database, entity: string, reason: "optimistic_added" | "optimistic_removed"): void {
  db.exec("UPDATE library_local_change_state SET sequence=sequence+1 WHERE singleton_id=1;");
  if (scalar(db,"SELECT changes();")!==1) throw new Error("Annotation local sequence is missing");
  db.exec({sql:"INSERT INTO library_local_invalidations(sequence,topic,entity_id,reason) SELECT sequence,'feed_item',?1,?2 FROM library_local_change_state WHERE singleton_id=1;",bind:[entity,reason]});
  db.exec("DELETE FROM library_local_invalidations WHERE sequence <= (SELECT sequence-4096 FROM library_local_change_state WHERE singleton_id=1);");
}

/** Result producers authenticate signatures before storage. SQL checks exact
 * local identity and coverage; matching digest fields do not verify signatures.
 */
export function retirePwaAnnotationTransaction(db: Database, transactionId: string): void {
  const version=Number(scalar(db,"PRAGMA user_version;"));
  if (version===1 || version===2 || version===3) return;
  requirePwaAnnotationReady(db);
  const entities=db.exec({sql:"SELECT entity_id FROM library_local_annotation_unresolved WHERE transaction_id=?1 ORDER BY member_index LIMIT 257;",bind:[transactionId],rowMode:0,returnValue:"resultRows"});
  if (!entities.length) return;
  if (entities.length>256 || entities.some(entity=>typeof entity!=="string" || encoder.encode(entity).byteLength>2048)) throw new Error("Annotation retirement exceeds member bound");
  const resultBytes=Number(db.selectValue("SELECT length(canonical_result) FROM library_intent_results WHERE transaction_id=?1;",[transactionId]) ?? 0);
  if (!Number.isSafeInteger(resultBytes) || resultBytes<0 || resultBytes>131072) throw new Error("Annotation retirement result exceeds bound");
  if (scalar(db,LIBRARY_CORE_ANNOTATION_COVERAGE_SQL,[transactionId])!==1) return;
  db.exec({sql:"DELETE FROM library_local_annotation_unresolved WHERE transaction_id=?1;",bind:[transactionId]});
  for (const entity of entities) invalidateAnnotation(db,entity as string,"optimistic_removed");
}

/** Only after authenticated checkpoint continuity and receipt installation in
 * the caller's activation transaction. SQLite owns the bounded pager scan.
 */
/** One indexed unresolved-marker page; callers must retain and resume the cursor. */
export function reconcilePwaAnnotationPage(db: Database, after: readonly [string,number] | null, through: readonly [string,number]): readonly [string,number] | null {
  requirePwaAnnotationReady(db);
  const deadline=performance.now()+MAXIMUM_TIME_MS;
  const rows=db.exec({sql:"SELECT transaction_id,member_index FROM library_local_annotation_unresolved INDEXED BY library_local_annotation_transaction WHERE (transaction_id,member_index)>(?1,?2) AND (transaction_id,member_index)<=(?3,?4) ORDER BY transaction_id,member_index LIMIT 256;",bind:[...(after ?? ["",-1]),...through],rowMode:"array",returnValue:"resultRows"});
  if (!rows.length) return null;
  let used=rows.reduce((sum,row)=>sum+encoder.encode(String(row[0])).byteLength+16,0);
  let cursor=after;
  let previous:string|undefined;
  for (const row of rows) {
    const id=String(row[0]), index=Number(row[1]);
    if (id!==previous) {
      const bytes=Number(db.selectValue("SELECT length(canonical_result) + CASE WHEN status='already_applied' THEN 262144 ELSE 0 END FROM library_intent_results WHERE transaction_id=?1;",[id]) ?? 0);
      if (!Number.isSafeInteger(bytes) || bytes<0 || bytes>393216) throw new Error("Annotation maintenance result exceeds bound");
      const charge=bytes+256*2048;
      if (used+charge>PAGE_BYTES || (cursor && performance.now()>=deadline)) break;
      used+=charge;
      retirePwaAnnotationTransaction(db,id);
      previous=id;
    }
    cursor=[id,index];
  }
  return cursor;
}

export function retirePwaAnnotationCheckpoint(db: Database): void {
  const version=Number(scalar(db,"PRAGMA user_version;"));
  if (version===1 || version===2 || version===3) return;
  requirePwaAnnotationReady(db);
  const predicate=LIBRARY_CORE_ANNOTATION_COVERAGE_SQL.trim().replace(/;$/,"").replaceAll("?1","marker.transaction_id");
  db.exec(`DELETE FROM library_local_annotation_unresolved AS marker WHERE (${predicate});`);
  if (Number(scalar(db,"SELECT changes();"))>0) {
    db.exec("UPDATE library_local_change_state SET sequence=sequence+1 WHERE singleton_id=1;");
    db.exec("INSERT INTO library_local_invalidations(sequence,topic,entity_id,reason) SELECT local.sequence,'library',meta.library_id,'optimistic_removed' FROM library_local_change_state AS local JOIN library_meta AS meta USING(singleton_id);");
    db.exec("DELETE FROM library_local_invalidations WHERE sequence <= (SELECT sequence-4096 FROM library_local_change_state WHERE singleton_id=1);");
  }
}
