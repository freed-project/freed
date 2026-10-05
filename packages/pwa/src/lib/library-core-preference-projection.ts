// Dormant: imported only by contract tests until the complete local lifecycle is ready.
import type { CAPI, Database, Sqlite3Static, SqlValue } from "@sqlite.org/sqlite-wasm";
import { preparePwaConsumerRecoveryWithStorageAdmission, commitPwaConsumerRecoveryWithLocalProjection, readPwaExistingConsumerRecoveryStatus } from "./library-core-consumer-recovery";
import type { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import { readPwaLibraryStorageIdentity, migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
import {
  type LibraryCoreNormalizedOperationImportPageV2,
  type LibraryCoreNormalizedResultTransportImportV2,
  parseLibraryCoreFollowerResultApplyV1, type LibraryCoreFollowerResultApplyV1,
  type LibraryCoreStoreFollowerActorRequestV2,
  type LibraryCoreInstallFollowerActorEnrollmentV2,
  parseLibraryCoreActivateNormalizedCheckpointStageV2, type LibraryCoreActivateNormalizedCheckpointStageV2,
  decodeLibraryCoreCanonicalValue, parseLibraryCoreFollowerResultEnvelopeV1,
  verifyLibraryCoreHistoricalOperationTransactionV1,
  verifyLibraryCoreFollowerResultV1,
  verifyLibraryCoreEd25519WithWebCrypto,
  encodeLibraryCoreDigestInput, sha256LowerHex,
  parseLibraryCoreVisiblePreferenceSourceV1, LIBRARY_CORE_PENDING_PREFERENCE_QUERY_PROGRAMS,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS, coerceLibraryCoreGeneratedSqliteQueryRow,
  parseLibraryCoreVisiblePreferenceScopeRequestV1, parseLibraryCoreVisiblePreferenceScopeResponseV1, parseLibraryCoreVisiblePreferenceValueV1, parseLibraryCoreFeedPageSourceV1, parseLibraryCorePreferenceValueRequestV1, libraryCorePreferenceSelectionJsonV1, createLibraryCorePreferenceValueResponseV1, isLibraryCoreBinary64V1,
  type LibraryCorePreferenceNodeV1, type LibraryCoreVisiblePreferenceSourceV1,
  type LibraryCoreCanonicalValue, type LibraryCoreVerifiedOperationEnvelopeV1, type LibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerIntentCommitResultV1,
  LIBRARY_CORE_PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,
  LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SHA256,
  LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SQL,
  LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_CATALOG,
  LIBRARY_CORE_LOCAL_SCHEMA_CATALOG,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS,
} from "@freed/shared/library-core";

function scalar(db: Database, sql: string): unknown {
  const rows = db.exec({ sql, rowMode: 0, returnValue: "resultRows" });
  if (rows.length !== 1) throw new Error("Pending preference storage scalar is missing");
  return rows[0];
}

function verifyStorage(db: Database): void {
  const rows = db.exec({ sql: "SELECT contract_version,schema_version,protocol_version,schema_sha256 FROM library_storage_meta WHERE singleton_id=1;",
    rowMode: "array", returnValue: "resultRows" });
  if (scalar(db, "PRAGMA application_id;") !== LIBRARY_CORE_SQLITE_APPLICATION_ID ||
      scalar(db, "PRAGMA user_version;") !== LIBRARY_CORE_PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION ||
      rows.length !== 1 || rows[0]?.[0] !== LIBRARY_CORE_SQLITE_CONTRACT_VERSION ||
      rows[0]?.[1] !== LIBRARY_CORE_PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION ||
      rows[0]?.[2] !== LIBRARY_CORE_SQLITE_PROTOCOL_VERSION || rows[0]?.[3] !== LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SHA256) {
    throw new Error("Pending preference storage identity changed");
  }
  for (const object of [...LIBRARY_CORE_LOCAL_SCHEMA_CATALOG, ...LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_CATALOG]) {
    const declarations = db.exec({ sql: "SELECT type,sql FROM sqlite_schema WHERE name=?1;", bind: [object.name], rowMode: "array", returnValue: "resultRows" });
    if (declarations.length !== 1 || declarations[0]?.[0] !== object.type || declarations[0]?.[1] !== object.sql) {
      throw new Error("Pending preference storage catalog changed");
    }
  }
}

/** Caller owns the IMMEDIATE transaction and rollback of DDL, cursor and identity. */
export function migratePwaPendingPreferenceProjection(
  db: Database,
  capi: Pick<Sqlite3Static["capi"], "sqlite3_get_autocommit" | "sqlite3_txn_state">,
  engine: Pick<PwaLibraryCoreSqliteEngine, "followerMutationContext" | "consumerRecoveryStatus">,
): void {
  if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer) !== 0 ||
      capi.sqlite3_txn_state(db.pointer, "main") !== 2 ||
      scalar(db, "PRAGMA synchronous;") !== 2 || scalar(db, "PRAGMA foreign_keys;") !== 1) {
    throw new Error("Pending preference migration requires an owned FULL transaction");
  }
  if (scalar(db, "PRAGMA user_version;") === LIBRARY_CORE_PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION) {
    verifyStorage(db);
    const context = engine.followerMutationContext();
    const rows = db.exec({ sql: "SELECT actor_id,target_counter FROM library_local_preference_projection WHERE singleton_id=1;", rowMode: "array", returnValue: "resultRows" });
    if (rows.length !== 1 || rows[0]?.[0] !== context.actor_id ||
        !Number.isSafeInteger(rows[0]?.[1]) || Number(rows[0]?.[1]) > context.next_actor_sequence - 1) {
      throw new Error("Pending preference migration actor changed");
    }
    return;
  }
  readPwaLibraryStorageIdentity(db);
  const context = engine.followerMutationContext();
  const recovery = engine.consumerRecoveryStatus();
  if (recovery.state !== "none" && recovery.state !== "following") {
    throw new Error("Pending preference migration requires completed consumer recovery");
  }
  migratePwaLibraryRecoverySchema(db, capi);
  const source = readPwaLibraryStorageIdentity(db);
  db.exec(LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SQL);
  db.exec({ sql: `INSERT INTO library_local_preference_projection
    (singleton_id,actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest)
    SELECT 1,actor_id,0,?2,NULL,chain_genesis_digest FROM library_actors WHERE actor_id=?1;`,
    bind: [context.actor_id, context.next_actor_sequence - 1] });
  if (scalar(db, "SELECT changes();") !== 1) throw new Error("Pending preference migration actor is missing");
  db.exec({ sql: "UPDATE library_storage_meta SET schema_version=?1,schema_sha256=?2 WHERE singleton_id=1 AND schema_version=?3 AND schema_sha256=?4;",
    bind: [LIBRARY_CORE_PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION, LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SHA256, source.schemaVersion, source.schemaSha256] });
  if (scalar(db, "SELECT changes();") !== 1) throw new Error("Pending preference migration source changed");
  db.exec(`PRAGMA user_version=${LIBRARY_CORE_PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION};`);
  verifyStorage(db);
}

/** Dormant successor preparation preserves original rows and derived effects until explicit commit. */
export async function preparePwaProjectedConsumerRecovery(
  db: Database, capi: CAPI, engine: PwaLibraryCoreSqliteEngine,
  recoveryId: string, input: LibraryCoreStoreFollowerActorRequestV2, subtle: SubtleCrypto = crypto.subtle,
): Promise<void> {
  const admitStorage = () => { requireDurability(db); verifyStorage(db); };
  admitStorage();
  await preparePwaConsumerRecoveryWithStorageAdmission(db, capi, subtle,
    engine.followerActorEnrollmentContext().authority, recoveryId, input, admitStorage);
}

/** Dormant successor cleanup; exact retries preserve the new actor's effects. */
export async function commitPwaProjectedConsumerRecovery(
  db: Database, capi: CAPI, engine: PwaLibraryCoreSqliteEngine,
  recoveryId: string, committedAt: number, subtle: SubtleCrypto = crypto.subtle,
): Promise<void> {
  requireDurability(db);
  verifyStorage(db);
  const authority = engine.followerActorEnrollmentContext().authority;
  let hadNodes = false;
  await commitPwaConsumerRecoveryWithLocalProjection(db,capi,subtle,authority,recoveryId,committedAt,{
    before() {
      requireDurability(db);
      verifyStorage(db);
      hadNodes = scalar(db,"SELECT EXISTS(SELECT 1 FROM library_local_preference_nodes);") === 1;
    },
    admitArchiveStorage() { verifyStorage(db); },
    after(fresh) {
      const recovery = readPwaExistingConsumerRecoveryStatus(db,authority);
      if (recovery.state !== "following") throw new Error("Projected recovery requires a committed successor request");
      if (!fresh) return;
      if (scalar(db,`SELECT NOT EXISTS(SELECT 1 FROM library_local_preference_nodes)
          AND NOT EXISTS(SELECT 1 FROM library_local_preference_projection);`) !== 1) {
        throw new Error("Projected recovery retained old actor state");
      }
      if (hadNodes) db.exec(LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS.pending_preferences_removed_v1);
    },
  });
}

/** Dormant enrollment adapter. Derived state joins the verified enrollment commit. */
export async function installPwaProjectedFollowerEnrollment(
  db: Database,
  capi: Pick<Sqlite3Static["capi"], "sqlite3_get_autocommit" | "sqlite3_txn_state">,
  engine: PwaLibraryCoreSqliteEngine,
  input: LibraryCoreInstallFollowerActorEnrollmentV2,
) {
  requireDurability(db);
  verifyStorage(db);
  return engine.installFollowerActorEnrollmentWithLocalProjection(input, () => {
    if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer) !== 0 ||
        capi.sqlite3_txn_state(db.pointer, "main") !== 2) {
      throw new Error("Projected enrollment requires an owned write transaction");
    }
    requireDurability(db);
    verifyStorage(db);
    const recovery = readPwaExistingConsumerRecoveryStatus(db, engine.followerActorEnrollmentContext().authority);
    if (recovery.state !== "none" && recovery.state !== "following") {
      throw new Error("Projected enrollment requires completed consumer recovery");
    }
    const context = engine.followerMutationContext();
    const existing = rows(db, `SELECT actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest
      FROM library_local_preference_projection WHERE singleton_id=1;`);
    if (existing.length !== 0) {
      const cursor = existing[0]!;
      if (existing.length !== 1 || cursor[0] !== context.actor_id || cursor[1] !== cursor[2] ||
          cursor[2] !== context.next_actor_sequence - 1 || cursor[3] !== context.previous_actor_operation_id ||
          cursor[4] !== context.previous_actor_chain_digest) {
        throw new Error("Projected enrollment cursor is not ready for this actor");
      }
      return;
    }
    const genesis = text(one(db, "SELECT chain_genesis_digest FROM library_actors WHERE actor_id=?1;", [context.actor_id])[0]);
    if (scalar(db, `SELECT NOT EXISTS(SELECT 1 FROM library_intent_transactions)
        AND NOT EXISTS(SELECT 1 FROM library_local_preference_nodes);`) !== 1 ||
        context.next_actor_sequence !== 1 || context.previous_actor_operation_id !== null ||
        context.previous_actor_chain_digest !== genesis) {
      throw new Error("Projected enrollment cannot discard local edit history");
    }
    db.exec({sql: `INSERT INTO library_local_preference_projection
      (singleton_id,actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest)
      VALUES(1,?1,0,0,NULL,?2);`, bind:[context.actor_id,genesis]});
  });
}

type ProjectionEngine = Pick<PwaLibraryCoreSqliteEngine, "followerMutationContext">;
function rows(db: Database, sql: string, bind: SqlValue[] = []): SqlValue[][] {
  return db.exec({ sql, bind, rowMode: "array", returnValue: "resultRows" });
}
function one(db: Database, sql: string, bind: SqlValue[] = []): SqlValue[] {
  const result = rows(db, sql, bind);
  if (result.length !== 1) throw new Error("Pending preference source is missing or ambiguous");
  return result[0]!;
}
function integer(value: SqlValue | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Pending preference integer is invalid");
  return value;
}
function text(value: SqlValue | undefined): string {
  if (typeof value !== "string") throw new Error("Pending preference text is invalid");
  return value;
}
function blob(value: SqlValue | undefined): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("Pending preference bytes are invalid");
  return value;
}
function snapshot(db: Database, engine: ProjectionEngine) {
  verifyStorage(db);
  const context = engine.followerMutationContext();
  const cursor = one(db, "SELECT actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest FROM library_local_preference_projection WHERE singleton_id=1;");
  if (cursor[0] !== context.actor_id || integer(cursor[2]) !== context.next_actor_sequence - 1) {
    throw new Error("Pending preference projection source changed");
  }
  const authority = one(db, `SELECT m.library_id,e.epoch_number,e.epoch_id,e.authority_key_id,e.authority_public_key,m.source_revision
    FROM library_meta m JOIN library_authority_epochs e ON e.epoch_id=m.authority_epoch
    JOIN library_active_authority a ON a.library_id=m.library_id AND a.epoch_id=e.epoch_id WHERE m.singleton_id=1;`);
  return { context, cursor, authority };
}
function requireDurability(db: Database): void {
  if (scalar(db, "PRAGMA synchronous;") !== 2 || scalar(db, "PRAGMA foreign_keys;") !== 1) {
    throw new Error("Pending preference backfill requires FULL durability and foreign keys");
  }
}

function insertPreferenceEffects(db:Database,members:readonly LibraryCoreVerifiedOperationEnvelopeV1[]):void {
  for (const member of members) {
      const e = member.envelope;
      if (e.operation_type !== "preferences_leaf_assignment") continue;
      const payload = e.payload as { readonly updates: LibraryCoreCanonicalValue };
      db.exec({ sql: `INSERT INTO library_local_preference_nodes(transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,boolean_value,integer_value,real_value,text_value,updated_at)
        SELECT ?1,?2,?3,?4,fullkey,CASE type WHEN 'object' THEN 'object' WHEN 'array' THEN 'array' ELSE 'value' END,
        CASE WHEN type IN ('true','false') THEN 'boolean' WHEN type IN ('integer','array') THEN 'integer' WHEN type='real' THEN 'real' WHEN type='text' THEN 'text' ELSE 'null' END,
        CASE WHEN type IN ('true','false') THEN atom END,CASE WHEN type='integer' THEN atom WHEN type='array' THEN json_array_length(value) END,
        CASE WHEN type='real' THEN atom END,CASE WHEN type='text' THEN atom END,?5 FROM json_tree(?6) WHERE fullkey<>'$';`,
        bind: [e.transaction_id,e.transaction_member_index,e.actor_id,e.actor_sequence,e.created_at_ms,JSON.stringify(payload.updates)] });
    }
  if (members.some(member=>member.envelope.operation_type==="preferences_leaf_assignment")) {
    db.exec(LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS.pending_preferences_added_v1);
  }
}

/** One authenticated whole transaction per step; no write lock spans WebCrypto. */
export async function backfillPwaPendingPreferenceProjection(
  db: Database, engine: ProjectionEngine, subtle: SubtleCrypto = crypto.subtle,
): Promise<boolean> {
  requireDurability(db);
  const input = db.transaction(() => {
    const source = snapshot(db, engine);
    const { context, cursor } = source;
    if (cursor[1] === cursor[2]) {
      if (cursor[3] !== context.previous_actor_operation_id || cursor[4] !== context.previous_actor_chain_digest) {
        throw new Error("Pending preference projection tip changed");
      }
      return { source, pending: null };
    }
    const id = text(one(db, "SELECT transaction_id FROM library_intent_members WHERE actor_id=?1 AND actor_counter=?2;", [context.actor_id, integer(cursor[1]) + 1])[0]);
    const metadata = one(db, "SELECT transaction_digest,first_counter,last_counter,member_count,canonical_member_bytes,state FROM library_intent_transactions WHERE transaction_id=?1 AND actor_id=?2;", [id, context.actor_id]);
    const count = integer(metadata[3]), size = integer(metadata[4]);
    if (integer(metadata[1]) !== integer(cursor[1]) + 1 || integer(metadata[2]) > integer(cursor[2]) || count < 1 || count > 1000 || size < 1 || size > 4_194_304) {
      throw new Error("Pending preference transaction bounds changed");
    }
    const lengths = rows(db, "SELECT length(canonical_member) FROM library_intent_members WHERE transaction_id=?1 ORDER BY member_index LIMIT 1001;", [id]);
    if (lengths.length !== count || lengths.some(r => integer(r[0]) < 1 || integer(r[0]) > 4_194_304) || lengths.reduce((n,r) => n + integer(r[0]),0) !== size) {
      throw new Error("Pending preference transaction bytes changed");
    }
    const envelopes = rows(db, "SELECT canonical_member FROM library_intent_members WHERE transaction_id=?1 ORDER BY member_index LIMIT 1000;", [id]).map(r => blob(r[0]));
    const resultLengths = rows(db, "SELECT length(canonical_result) FROM library_intent_results WHERE transaction_id=?1;", [id]);
    const unresolved = metadata[5] === "pending" || metadata[5] === "published";
    if (unresolved ? resultLengths.length !== 0 : resultLengths.length !== 1 || integer(resultLengths[0]?.[0]) < 1 || integer(resultLengths[0]?.[0]) > 131_072) {
      throw new Error("Pending preference result bounds or state changed");
    }
    const result = unresolved ? null : one(db, `SELECT authority_epoch_id,intent_epoch_id,result_sequence,previous_result_digest,result_digest,status,authoritative_source_revision,canonical_result,actor_id
      FROM library_intent_results WHERE transaction_id=?1;`, [id]);
    return { source, pending: { id, metadata, envelopes, result } };
  });
  if (!input.pending) return true;
  const { source, pending } = input;
  const { context, cursor, authority } = source;
  const verified = await verifyLibraryCoreHistoricalOperationTransactionV1(pending.envelopes, {
    library_id: context.library_id, epoch: context.epoch, epoch_id: context.epoch_id,
    actor_id: context.actor_id, actor_public_key: context.actor_public_key,
    next_actor_sequence: integer(cursor[1]) + 1,
    previous_actor_operation_id: cursor[3], previous_actor_chain_digest: cursor[4],
  }, {
    digest: (domain,value) => sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue)),
    verifySignature: input => verifyLibraryCoreEd25519WithWebCrypto(input, subtle),
  });
  const first = verified.members[0]!.envelope, last = verified.members[verified.members.length - 1]!.envelope;
  if (first.transaction_id !== pending.id || verified.transaction_digest !== pending.metadata[0] ||
      first.actor_sequence !== pending.metadata[1] || last.actor_sequence !== pending.metadata[2] ||
      verified.canonical_envelope_bytes !== pending.metadata[4]) throw new Error("Pending preference transaction identity changed");
  let visible = true;
  if (pending.result) {
    const r = pending.result;
    const result = await verifyLibraryCoreFollowerResultV1(blob(r[7]), {
      libraryId: text(authority[0]), epoch: integer(authority[1]), epochId: text(authority[2]),
      authorityKeyId: text(authority[3]), authorityPublicKey: text(authority[4]),
    }, { verifySignature: input => verifyLibraryCoreEd25519WithWebCrypto(input, subtle) });
    const e = result.envelope;
    if (e.transaction_id !== pending.id || e.transaction_digest !== verified.transaction_digest || e.actor_id !== context.actor_id ||
        e.epoch_id !== r[0] || e.intent_epoch !== context.epoch || e.intent_epoch_id !== context.epoch_id || e.intent_epoch_id !== r[1] || e.result_sequence !== r[2] ||
        e.previous_result_digest !== r[3] || e.result_body_digest !== r[4] || e.status !== r[5] || e.authoritative_source_revision !== r[6] || e.actor_id !== r[8] ||
        (pending.metadata[5] === "rejected" ? e.status !== "rejected" : pending.metadata[5] !== "accepted" || !["accepted", "already_applied"].includes(e.status))) {
      throw new Error("Pending preference signed result identity changed");
    }
    visible = e.status !== "rejected" && !(e.epoch_id === authority[2] && e.authoritative_source_revision <= integer(authority[5]));
  }
  return db.transaction("IMMEDIATE", () => {
    requireDurability(db);
    if (JSON.stringify(snapshot(db, engine)) !== JSON.stringify(source)) throw new Error("Pending preference source changed during verification");
    const current = one(db, "SELECT transaction_digest,first_counter,last_counter,member_count,canonical_member_bytes,state FROM library_intent_transactions WHERE transaction_id=?1 AND actor_id=?2;", [pending.id, context.actor_id]);
    if (JSON.stringify(current) !== JSON.stringify(pending.metadata)) throw new Error("Pending preference transaction changed during verification");
    const memberBounds = one(db, "SELECT count(*),coalesce(sum(length(canonical_member)),0) FROM library_intent_members WHERE transaction_id=?1;", [pending.id]);
    if (memberBounds[0] !== pending.metadata[3] || memberBounds[1] !== pending.metadata[4]) {
      throw new Error("Pending preference member bounds changed during verification");
    }
    for (let i=0;i<pending.envelopes.length;i++) {
      if (one(db, "SELECT canonical_member=?3 FROM library_intent_members WHERE transaction_id=?1 AND member_index=?2;", [pending.id,i,pending.envelopes[i]!])[0] !== 1) {
        throw new Error("Pending preference envelope changed during verification");
      }
    }
    if (pending.result) {
      const r = pending.result;
      if (one(db, `SELECT authority_epoch_id=?2 AND intent_epoch_id=?3 AND result_sequence=?4 AND previous_result_digest IS ?5 AND result_digest=?6 AND status=?7 AND authoritative_source_revision=?8 AND canonical_result=?9 AND actor_id=?10
        FROM library_intent_results WHERE transaction_id=?1;`, [pending.id,...r])[0] !== 1) throw new Error("Pending preference result changed during verification");
    } else if (rows(db, "SELECT 1 FROM library_intent_results WHERE transaction_id=?1;", [pending.id]).length !== 0) {
      throw new Error("Pending preference result arrived during verification");
    }
    if (visible) insertPreferenceEffects(db,verified.members);
    if (last.actor_sequence === cursor[2] && (last.operation_id !== context.previous_actor_operation_id || last.actor_chain_digest !== context.previous_actor_chain_digest)) {
      throw new Error("Pending preference projection final tip changed");
    }
    db.exec({ sql: "UPDATE library_local_preference_projection SET last_counter=?1,previous_operation_id=?2,previous_chain_digest=?3 WHERE singleton_id=1 AND last_counter=?4 AND actor_id=?5;",
      bind: [last.actor_sequence,last.operation_id,last.actor_chain_digest,cursor[1]!,context.actor_id] });
    if (scalar(db, "SELECT changes();") !== 1) throw new Error("Pending preference projection cursor changed");
    return last.actor_sequence === cursor[2];
  });
}

type TransactionControl = Pick<Sqlite3Static["capi"], "sqlite3_get_autocommit" | "sqlite3_txn_state">;

function requireReadyProjection(db: Database, engine: ProjectionEngine): void {
  requireDurability(db);
  const {context, cursor} = snapshot(db, engine);
  if (cursor[1] !== cursor[2] || cursor[3] !== context.previous_actor_operation_id ||
      cursor[4] !== context.previous_actor_chain_digest) {
    throw new Error("Projected operation import requires completed backfill");
  }
}

const pendingPreferenceResultEvidence = `SELECT i.transaction_digest AS intent_digest,
  i.actor_id AS intent_actor_id,i.intent_epoch_id AS intent_epoch,i.state AS intent_state,r.*
  FROM library_intent_transactions i JOIN library_intent_results r USING(transaction_id)
  WHERE EXISTS(SELECT 1 FROM library_local_preference_nodes n WHERE n.transaction_id=i.transaction_id)`;

/** Caller has authenticated the exact retained result set before any writes. */
function settleCoveredPreferenceEffects(db: Database): void {
  let after = "";
  while (true) {
    const next = rows(db, `SELECT i.transaction_id FROM library_intent_transactions i JOIN library_intent_results r USING(transaction_id)
      JOIN library_meta m ON m.singleton_id=1 WHERE i.transaction_id>?1
      AND (r.status='rejected' OR (r.status IN ('accepted','already_applied') AND r.authority_epoch_id=m.authority_epoch AND r.authoritative_source_revision<=m.source_revision))
      AND EXISTS(SELECT 1 FROM library_local_preference_nodes n WHERE n.transaction_id=i.transaction_id)
      ORDER BY i.transaction_id LIMIT 1;`, [after]);
    if (!next.length) break;
    after = text(next[0]![0]);
    db.exec({sql:"DELETE FROM library_local_preference_nodes WHERE transaction_id=?1;",bind:[after]});
    if (scalar(db,"SELECT changes();") === 0) throw new Error("Preference settlement did not advance");
    db.exec(LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS.pending_preferences_removed_v1);
  }
}

async function prepareCanonicalPreferenceSettlement(
  db: Database, engine: ProjectionEngine, capi: TransactionControl,
) {
  // Authenticate one bounded receipt at a time outside the write transaction.
  // The source fence runs before materialization, then SQLite preserves the
  // verified set in the main database, avoiding both a JavaScript receipt array
  // and a potentially memory-backed TEMP table. Creation and removal share the
  // canonical transaction, so rollback cannot leave a persistent proof cache.
  const source = snapshot(db, engine);
  const proof = await preparePwaPreferenceCheckpointVerification(db, engine);
  const identity = (context: typeof source.context) => {
    return Object.fromEntries(Object.entries(context).filter(([field]) => field !== "observed_frontier"));
  };
  return {
    beforeMaterialize(): void {
      proof.assertUnchanged(capi);
      db.exec(`CREATE TABLE main.canonical_verified_preference_results AS ${pendingPreferenceResultEvidence};`);
    },
    afterMaterialize(): void {
      requireReadyProjection(db, engine);
      const current = snapshot(db, engine);
      if (JSON.stringify(identity(current.context)) !== JSON.stringify(identity(source.context)) ||
          JSON.stringify(current.cursor) !== JSON.stringify(source.cursor) ||
          JSON.stringify(current.authority.slice(0,5)) !== JSON.stringify(source.authority.slice(0,5)) ||
          integer(current.authority[5]) < integer(source.authority[5])) {
        throw new Error("Canonical import changed preference projection continuity");
      }
      if (scalar(db, `SELECT EXISTS(SELECT * FROM main.canonical_verified_preference_results EXCEPT ${pendingPreferenceResultEvidence})
          OR EXISTS(${pendingPreferenceResultEvidence} EXCEPT SELECT * FROM main.canonical_verified_preference_results);`) !== 0) {
        throw new Error("Canonical import changed verified preference result evidence");
      }
      settleCoveredPreferenceEffects(db);
      db.exec("DROP TABLE main.canonical_verified_preference_results;");
    },
  };
}

/** Dormant ordinary sync adapter. Each canonical commit settles all newly covered local results. */
export async function importPwaProjectedOperationPage(
  db: Database, engine: PwaLibraryCoreSqliteEngine, input: LibraryCoreNormalizedOperationImportPageV2,
  capi: TransactionControl,
) {
  requireReadyProjection(db, engine);
  return engine.importNormalizedOperationPageWithLocalProjection(input,
    () => prepareCanonicalPreferenceSettlement(db, engine, capi));
}

/** Settle a retained local acceptance inside its canonical operation commit. */
export async function catchUpPwaProjectedAcceptedResult(
  db: Database, engine: PwaLibraryCoreSqliteEngine, input: LibraryCoreFollowerResultApplyV1,
  capi: TransactionControl,
): Promise<void> {
  requireReadyProjection(db, engine);
  await engine.catchUpFollowerResultWithLocalProjection(input,
    () => prepareCanonicalPreferenceSettlement(db, engine, capi));
}

/** Dormant segment receipt import; canonical operation catch-up remains explicit. */
export async function storePwaProjectedResultTransport(
  db: Database, engine: PwaLibraryCoreSqliteEngine,
  input: LibraryCoreNormalizedResultTransportImportV2, capi: TransactionControl,
) {
  return engine.storeFollowerResultTransportWithLocalProjection(input,async bytes=>{
    const settlements: Awaited<ReturnType<typeof preparePwaPendingPreferenceSettlement>>[]=[];
    for (const result of bytes) settlements.push(await preparePwaPendingPreferenceSettlement(db,engine,result));
    return ()=>{
      requireDurability(db);
      const source=snapshot(db,engine),c=source.context,cursor=source.cursor;
      if(cursor[1]!==cursor[2] || cursor[3]!==c.previous_actor_operation_id || cursor[4]!==c.previous_actor_chain_digest) {
        throw new Error("Projected result transport requires completed backfill");
      }
      for(const settlement of settlements) settlement.commit(capi);
    };
  });
}

/** Dormant receipt import. Accepted canonical operations still require catch-up. */
export async function storePwaProjectedFollowerResult(
  db: Database, engine: PwaLibraryCoreSqliteEngine, input: LibraryCoreFollowerResultApplyV1,
  capi: TransactionControl,
) {
  const request = parseLibraryCoreFollowerResultApplyV1(input);
  const prepared = await engine.prepareFollowerResultTransaction(request);
  const settlement = await preparePwaPendingPreferenceSettlement(db,engine,request.canonicalResultBytes);
  return db.transaction("IMMEDIATE",()=>{
    requireDurability(db);
    const source=snapshot(db,engine), c=source.context, cursor=source.cursor;
    if (cursor[1]!==cursor[2] || cursor[3]!==c.previous_actor_operation_id || cursor[4]!==c.previous_actor_chain_digest) {
      throw new Error("Projected result import requires completed backfill");
    }
    const receipt=prepared.commit(capi);
    settlement.commit(capi);
    return receipt;
  });
}

/** Verify before import; the closure owns its bytes and rechecks the imported receipt at commit. */
export async function preparePwaPendingPreferenceSettlement(
  db: Database, engine: ProjectionEngine, canonicalResultBytes: Uint8Array, subtle: SubtleCrypto = crypto.subtle,
): Promise<Readonly<{ commit(capi: TransactionControl): boolean }>> {
  if (canonicalResultBytes.byteLength < 1 || canonicalResultBytes.byteLength > 131_072) {
    throw new Error("Pending preference settlement result exceeds its bound");
  }
  requireDurability(db);
  const bytes = Uint8Array.from(canonicalResultBytes);
  const source = db.transaction(() => snapshot(db,engine)), a=source.authority;
  const verified = await verifyLibraryCoreFollowerResultV1(bytes, {
    libraryId:text(a[0]),epoch:integer(a[1]),epochId:text(a[2]),authorityKeyId:text(a[3]),authorityPublicKey:text(a[4]),
  },{verifySignature:input=>verifyLibraryCoreEd25519WithWebCrypto(input,subtle)});
  const e=verified.envelope;
  if (e.actor_id!==source.context.actor_id || e.intent_epoch_id!==source.context.epoch_id || e.intent_epoch!==source.context.epoch) {
    throw new Error("Pending preference settlement actor changed");
  }
  // Canonical catch-up may advance frontier/revision in the caller's transaction.
  // Local actor continuity and authority identity must remain exact.
  const localIdentity = (context: typeof source.context) => {
    return Object.fromEntries(Object.entries(context).filter(([field]) => field !== "observed_frontier"));
  };
  return Object.freeze({ commit(capi: TransactionControl): boolean {
    if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer)!==0 || capi.sqlite3_txn_state(db.pointer,"main")!==2) {
      throw new Error("Pending preference settlement requires an owned write transaction");
    }
    requireDurability(db);
    const current=snapshot(db,engine);
    if (JSON.stringify(localIdentity(current.context))!==JSON.stringify(localIdentity(source.context)) ||
        JSON.stringify(current.cursor)!==JSON.stringify(source.cursor) ||
        JSON.stringify(current.authority.slice(0,5))!==JSON.stringify(a.slice(0,5)) || integer(current.authority[5])<integer(a[5])) {
      throw new Error("Pending preference settlement source changed during verification");
    }
    assertSettlementEvidence(db,e,bytes);
    if (e.status!=="rejected" && !(e.epoch_id===current.authority[2] && e.authoritative_source_revision<=integer(current.authority[5]))) return false;
    db.exec({sql:"DELETE FROM library_local_preference_nodes WHERE transaction_id=?1 AND actor_id=?2;",bind:[e.transaction_id,e.actor_id]});
    if (scalar(db,"SELECT changes();")===0) return false;
    db.exec(LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS.pending_preferences_removed_v1);
    return true;
  }});
}

function assertSettlementEvidence(db:Database,e:ReturnType<typeof parseLibraryCoreFollowerResultEnvelopeV1>,bytes:Uint8Array):void {
    const intent=one(db,"SELECT transaction_digest,actor_id,intent_epoch_id,state FROM library_intent_transactions WHERE transaction_id=?1;",[e.transaction_id]);
    if (intent[0]!==e.transaction_digest || intent[1]!==e.actor_id || intent[2]!==e.intent_epoch_id || intent[3] !== (e.status==="rejected"?"rejected":"accepted") ||
        one(db,"SELECT canonical_result=?2 AND result_digest=?3 AND status=?4 AND actor_id=?5 AND authority_epoch_id=?6 AND intent_epoch_id=?7 AND result_sequence=?8 AND previous_result_digest IS ?9 AND authoritative_source_revision=?10 FROM library_intent_results WHERE transaction_id=?1;",
          [e.transaction_id,bytes,e.result_body_digest,e.status,e.actor_id,e.epoch_id,e.intent_epoch_id,e.result_sequence,e.previous_result_digest,e.authoritative_source_revision])[0]!==1) {
      throw new Error("Pending preference settlement evidence changed during verification");
    }
}

/**
 * Authenticate one bounded result at a time before checkpoint activation.
 * No write lock spans WebCrypto and no journal-sized receipt array is retained.
 * The returned check must run first inside the checkpoint's write transaction.
 */
export async function preparePwaPreferenceCheckpointVerification(
  db:Database,engine:ProjectionEngine,subtle:SubtleCrypto=crypto.subtle,
):Promise<Readonly<{assertUnchanged(capi:TransactionControl):void}>> {
  requireDurability(db);
  const pointer=db.pointer;
  if (!pointer) throw new Error("Preference checkpoint database is closed");
  const version=()=>["SELECT total_changes();","PRAGMA main.data_version;","PRAGMA main.schema_version;","PRAGMA temp.schema_version;"]
    .map(sql=>integer(one(db,sql)[0]));
  const initial=db.transaction(()=>{
    const source=snapshot(db,engine), c=source.context;
    if (one(db,"SELECT EXISTS(SELECT 1 FROM library_local_preference_nodes WHERE actor_id<>?1);",[c.actor_id])[0]!==0) {
      throw new Error("Preference checkpoint projection contains another actor");
    }
    if (source.cursor[1]!==source.cursor[2] || source.cursor[3]!==c.previous_actor_operation_id || source.cursor[4]!==c.previous_actor_chain_digest) {
      throw new Error("Pending preference backfill is incomplete");
    }
    return {source,version:version()};
  });
  const assertVersion=()=>{
    if (db.pointer!==pointer || JSON.stringify(version())!==JSON.stringify(initial.version)) {
      throw new Error("Preference checkpoint database changed during verification");
    }
  };
  let after="";
  while (true) {
    const next=db.transaction(()=>{
      assertVersion();
      const candidates=rows(db,`SELECT i.transaction_id,length(r.canonical_result)
        FROM library_intent_transactions i JOIN library_intent_results r USING(transaction_id)
        WHERE i.transaction_id>?1 AND i.actor_id=?2
          AND EXISTS(SELECT 1 FROM library_local_preference_nodes n WHERE n.transaction_id=i.transaction_id)
        ORDER BY i.transaction_id LIMIT 1;`,[after,initial.source.context.actor_id]);
      if (!candidates.length) return null;
      const id=text(candidates[0]![0]), size=integer(candidates[0]![1]);
      if (size<1 || size>131072) throw new Error("Preference checkpoint result exceeds its byte bound");
      return {id,bytes:Uint8Array.from(blob(one(db,"SELECT canonical_result FROM library_intent_results WHERE transaction_id=?1;",[id])[0]))};
    });
    if (!next) break;
    const a=initial.source.authority;
    const verified=await verifyLibraryCoreFollowerResultV1(next.bytes,{
      libraryId:text(a[0]),epoch:integer(a[1]),epochId:text(a[2]),authorityKeyId:text(a[3]),authorityPublicKey:text(a[4]),
    },{verifySignature:input=>verifyLibraryCoreEd25519WithWebCrypto(input,subtle)});
    db.transaction(()=>{
      assertVersion();
      const e=verified.envelope,c=initial.source.context;
      if (e.transaction_id!==next.id || e.actor_id!==c.actor_id || e.intent_epoch_id!==c.epoch_id || e.intent_epoch!==c.epoch) {
        throw new Error("Preference checkpoint result identity changed");
      }
      assertSettlementEvidence(db,e,next.bytes);
    });
    after=next.id;
  }
  return Object.freeze({assertUnchanged(capi:TransactionControl):void {
    if (!db.pointer || capi.sqlite3_get_autocommit(db.pointer)!==0 || capi.sqlite3_txn_state(db.pointer,"main")!==2) {
      throw new Error("Preference checkpoint proof requires an owned write transaction");
    }
    assertVersion();
    requireDurability(db);
    if (JSON.stringify(snapshot(db,engine))!==JSON.stringify(initial.source)) {
      throw new Error("Preference checkpoint source changed during verification");
    }
  }});
}

/** Standalone reconciliation wrapper; result import uses the prepared commit directly. */
export async function settlePwaPendingPreferenceProjection(
  db: Database, engine: ProjectionEngine, transactionId: string, capi: TransactionControl, subtle: SubtleCrypto = crypto.subtle,
): Promise<boolean> {
  if (transactionId.length < 1 || transactionId.length > 255) throw new Error("Pending preference settlement identity is invalid");
  const bytes = db.transaction(() => {
    const length=integer(one(db,"SELECT length(canonical_result) FROM library_intent_results WHERE transaction_id=?1;",[transactionId])[0]);
    if (length<1 || length>131_072) throw new Error("Pending preference settlement result exceeds its bound");
    return blob(one(db,"SELECT canonical_result FROM library_intent_results WHERE transaction_id=?1;",[transactionId])[0]);
  });
  if (parseLibraryCoreFollowerResultEnvelopeV1(decodeLibraryCoreCanonicalValue(bytes)).transaction_id!==transactionId) {
    throw new Error("Pending preference settlement transaction identity changed");
  }
  const prepared=await preparePwaPendingPreferenceSettlement(db,engine,bytes,subtle);
  return db.transaction("IMMEDIATE",()=>prepared.commit(capi));
}

/** Dormant adapter: existing verified enqueue and preference effects share one write transaction. */
export async function enqueuePwaProjectedFollowerIntent(
  db:Database,
  engine:Pick<PwaLibraryCoreSqliteEngine,"followerMutationContext"|"prepareFollowerIntentTransaction"|"followerActorEnrollmentContext">,
  input:LibraryCoreFollowerIntentCommitV1, capi:TransactionControl,
):Promise<LibraryCoreFollowerIntentCommitResultV1> {
  const prepared=await engine.prepareFollowerIntentTransaction(input);
  return db.transaction("IMMEDIATE",()=>{
    requireDurability(db);
    const source=snapshot(db,engine), c=source.context, cursor=source.cursor;
    if (cursor[1]!==cursor[2] || cursor[3]!==c.previous_actor_operation_id || cursor[4]!==c.previous_actor_chain_digest) {
      throw new Error("Pending preference backfill is incomplete");
    }
    const receipt=prepared.commit(capi,()=>{
      verifyStorage(db);
      const recovery=readPwaExistingConsumerRecoveryStatus(db,engine.followerActorEnrollmentContext().authority);
      if (recovery.state!=="none" && recovery.state!=="following") throw new Error("Follower intent requires completed consumer recovery");
    });
    if (receipt.lastCounter<=integer(cursor[1])) return receipt;
    const verified=prepared.verified;
    if (!verified || receipt.actorId!==c.actor_id || receipt.firstCounter!==integer(cursor[1])+1) {
      throw new Error("Projected intent sequence changed");
    }
    const last=verified.members[verified.members.length-1]!.envelope;
    if (receipt.lastCounter!==last.actor_sequence) throw new Error("Projected intent tip changed");
    insertPreferenceEffects(db,verified.members);
    db.exec({sql:"UPDATE library_local_preference_projection SET last_counter=?1,target_counter=?1,previous_operation_id=?2,previous_chain_digest=?3 WHERE singleton_id=1 AND actor_id=?4 AND last_counter=?5 AND target_counter=?5;",
      bind:[last.actor_sequence,last.operation_id,last.actor_chain_digest,c.actor_id,cursor[1]!]});
    if (scalar(db,"SELECT changes();")!==1) throw new Error("Projected intent cursor changed");
    return receipt;
  });
}

/** Pin reads to a complete local projection as well as the canonical generation. */
function visibleSourceInTransaction(db:Database,engine:ProjectionEngine) {
  const ready=snapshot(db,engine);
  const value=one(db,LIBRARY_CORE_PENDING_PREFERENCE_QUERY_PROGRAMS.source_v1);
  const parsed=parseLibraryCoreVisiblePreferenceSourceV1({generationId:value[0],sourceRevision:value[1],localSequence:value[2],actorId:value[3],actorCounter:value[4]});
  if (!parsed.ok) throw new Error(parsed.error);
  if (parsed.value.actorId!==ready.context.actor_id || parsed.value.actorCounter!==ready.context.next_actor_sequence-1) throw new Error("Visible preference source changed");
  return parsed.value;
}

export function readPwaVisiblePreferenceSource(db:Database,engine:ProjectionEngine) {
  return db.transaction(()=>visibleSourceInTransaction(db,engine));
}

function checkedVisibleSource(db:Database,engine:ProjectionEngine,expected:LibraryCoreVisiblePreferenceSourceV1) {
  const checked=parseLibraryCoreVisiblePreferenceSourceV1(expected);
  if (!checked.ok) throw new Error(checked.error);
  const source=visibleSourceInTransaction(db,engine);
  if (JSON.stringify(source)!==JSON.stringify(checked.value)) throw new Error("CURSOR_STALE");
  return source;
}

/** Dormant selected value reader. Canonical-only archive comparisons retain their existing route. */
export function readPwaVisiblePreferenceValue(db:Database,engine:ProjectionEngine,path:readonly string[],expected:LibraryCoreVisiblePreferenceSourceV1) {
  return db.transaction(()=>readVisibleValueInTransaction(db,path,checkedVisibleSource(db,engine,expected)));
}

/** One read transaction owns the whole selected scope and its local actor source. */
export function readPwaVisiblePreferenceScope(db:Database,engine:ProjectionEngine,paths:readonly (readonly string[])[],expected:LibraryCoreVisiblePreferenceSourceV1) {
  const checked=parseLibraryCoreVisiblePreferenceScopeRequestV1({paths,source:expected});
  if (!checked.ok) throw new Error(checked.error);
  return db.transaction(()=>{
    const source=checkedVisibleSource(db,engine,checked.value.source);
    const results:ReturnType<typeof readVisibleValueInTransaction>[]=[];
    let bytes=0;
    for (const path of checked.value.paths) {
      const value=readVisibleValueInTransaction(db,path,source);
      bytes+=new TextEncoder().encode(JSON.stringify(value)).length;
      if (bytes>2*1048576) throw new Error("Visible preference scope exceeds its byte bound");
      results.push(value);
    }
    const parsed=parseLibraryCoreVisiblePreferenceScopeResponseV1({results,source},checked.value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  });
}

function readVisibleValueInTransaction(db:Database,path:readonly string[],source:LibraryCoreVisiblePreferenceSourceV1) {
  const checked=parseLibraryCorePreferenceValueRequestV1({queryId:"preference_value_v1",schemaVersion:1,path,generationId:source.generationId,sourceRevision:source.sourceRevision});
  if (!checked.ok) throw new Error(checked.error);
  const request=checked.value, programs=LIBRARY_CORE_PENDING_PREFERENCE_QUERY_PROGRAMS;
  const canonical=LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.preference_value_v1;
    const selection=libraryCorePreferenceSelectionJsonV1(request);
    const selected=text(one(db,canonical.variants.selection_path.sql,[selection])[0]);
    if (new TextEncoder().encode(selected).length+2>4096) throw new Error("Preference selection path exceeds its bound");
    const ancestors=rows(db,programs.selection_ancestors_v1,[selection]).map(row=>text(row[0]));
    if (ancestors.length>=32) throw new Error("Preference ancestor path exceeds its bound");
    const barrier=(paths:readonly string[])=>paths.reduce((maximum,parent)=>{
      const found=rows(db,programs.replacement_barrier_v1,[source.actorId,parent]);
      return found.length ? Math.max(maximum,integer(found[0]![0])) : maximum;
    },0);
    const node=(value:Record<string,unknown>):LibraryCorePreferenceNodeV1=>{
      const parsed=coerceLibraryCoreGeneratedSqliteQueryRow("preference_value_v1",value);
      if (!parsed) throw new Error("Visible preference node is invalid");
      return parsed;
    };
    const pendingNode=(r:SqlValue[],base:string)=>node({path:(r[1]==="object"?"o:":r[1]==="array"?"a:":"v:")+"$._"+text(r[0]).slice(base.length),
      valueType:r[2],booleanValue:r[3],integerValue:r[4],realValue:r[5],textValue:r[6],updatedAt:r[7]});
    const canonicalRows=(sql:string,bind:SqlValue[])=>db.exec({sql,bind,rowMode:"object",returnValue:"resultRows"}).map(row=>node(row));
    const resolve=(fullkey:string,parents:readonly string[])=>{
      const minimum=barrier(parents);
      const pending=rows(db,programs.latest_node_v1,[source.actorId,fullkey]);
      if (pending.length && integer(pending[0]![2])>=minimum) {
        const r=pending[0]!;
        return {node:pendingNode(r.slice(3),fullkey),pending:r};
      }
      if (minimum>0) return {node:null,pending:null};
      const canonicalRoot=canonicalRows(canonical.sql,[fullkey]);
      if (canonicalRoot.length>1) throw new Error("Preference selection has conflicting roots");
      return {node:canonicalRoot[0]??null,pending:null};
    };
    const root=resolve(selected,ancestors);
    let resultRows:LibraryCorePreferenceNodeV1[]=root.node?[root.node]:[];
    if (root.node?.path.startsWith("a:")) {
      if (root.pending) {
        // Arrays replace their complete subtree. Object children at this root
        // indicate a corrupt projection and must not be silently omitted.
        if (rows(db,programs.array_nodes_v1,[root.pending[0]!,root.pending[1]!,selected+".",selected+"/"]).length) {
          throw new Error("Visible preference array has invalid object children");
        }
        resultRows.push(...rows(db,programs.array_nodes_v1,[root.pending[0]!,root.pending[1]!,selected+"[",selected+"\\"]).map(r=>pendingNode(r,selected)));
      } else {
        for (const prefix of ["a:","o:","v:"]) for (const [lower,upper] of [[".","/"],["[","\\"]]) {
          const remaining=513-resultRows.length;
          if (remaining>0) resultRows.push(...canonicalRows(canonical.variants.descendants.sql,[selected,prefix+selected+lower,prefix+selected+upper,remaining]));
        }
      }
    } else if (root.node?.path.startsWith("o:")) {
      const parents=[...ancestors,selected];
      const bits=resolve(selected+".bits",parents).node, codec=resolve(selected+".codec",parents).node;
      if (bits?.path.startsWith("v:") && codec?.path.startsWith("v:") && bits.valueType==="text" && codec.valueType==="text" &&
          isLibraryCoreBinary64V1({bits:bits.textValue,codec:codec.textValue})) {
        const minimum=barrier(parents);
        let extra=rows(db,programs.pending_object_extras_v1,[source.actorId,selected,minimum]).length>0;
        if (!extra && minimum===0) for (const prefix of ["a:","o:","v:"]) {
          if (rows(db,programs.canonical_object_extras_v1,[prefix,selected]).length) {extra=true;break;}
        }
        if (!extra) resultRows=[root.node,{...bits,path:"v:$._.bits"},{...codec,path:"v:$._.codec"}];
      }
    }
    const canonicalSource=parseLibraryCoreFeedPageSourceV1({generationId:source.generationId,projectionRevision:source.sourceRevision,transitionSequence:source.sourceRevision});
    if (!canonicalSource.ok) throw new Error(canonicalSource.error);
    const value=createLibraryCorePreferenceValueResponseV1(request,resultRows,canonicalSource.value);
    const parsed=parseLibraryCoreVisiblePreferenceValueV1({path:request.path,kind:value.kind,rows:value.rows,source},request.path,source);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
}

/** Preserve predecessor effects through a verified successor checkpoint, without settling or re-signing them. */
export async function replacePwaProjectedSuccessorCheckpoint(
  db: Database, engine: PwaLibraryCoreSqliteEngine, input: LibraryCoreActivateNormalizedCheckpointStageV2,
) {
  const activation = parseLibraryCoreActivateNormalizedCheckpointStageV2(input);
  if (!activation.replaceExisting || !activation.followerReceipt) throw new Error("Projected successor requires a consumer replacement");
  requireDurability(db);
  verifyStorage(db);
  await engine.verifyNormalizedCheckpointSuccessor(activation);
  const tables = ["library_local_preference_projection", "library_local_preference_nodes"];
  const requireRetainedTip = () => {
    if (scalar(db, `SELECT EXISTS(SELECT 1 FROM library_local_preference_projection p
      JOIN library_intent_actors a ON a.actor_id=p.actor_id
      JOIN library_follower_actor_request r ON r.actor_id=p.actor_id
      WHERE p.singleton_id=1 AND p.last_counter=p.target_counter AND p.target_counter=a.next_counter-1
        AND p.previous_operation_id IS a.previous_operation_id AND p.previous_chain_digest=a.previous_chain_digest)
      AND NOT EXISTS(SELECT 1 FROM library_local_preference_nodes n
        WHERE n.actor_id<>(SELECT actor_id FROM library_follower_actor_request WHERE singleton_id=1));`) !== 1) {
      throw new Error("Projected successor requires the retained completed actor tip");
    }
  };
  return engine.activateNormalizedCheckpointWithLocalProjection(activation, {
    beforeReplace() {
      requireDurability(db);
      verifyStorage(db);
      requireRetainedTip();
      if (one(db, `SELECT EXISTS(SELECT 1 FROM library_checkpoint_stages s
          JOIN library_meta m ON m.singleton_id=1 AND m.library_id=s.library_id
          JOIN library_follower_actor_request r ON r.singleton_id=1 AND r.library_id=s.library_id
          WHERE s.stage_id=?1 AND s.authority_epoch<>r.authority_epoch_id);`, [activation.stageId])[0] !== 1) {
        throw new Error("Projected successor requires a different enrollment epoch");
      }
      for (const table of tables) db.exec(`CREATE TABLE main.checkpoint_retained_${table} AS SELECT * FROM ${table};`);
    },
    afterReplace() {
      verifyStorage(db);
      for (const table of tables) {
        if (scalar(db, `SELECT count(*) FROM ${table};`) !== 0) throw new Error("Projected successor did not clear derived rows");
        db.exec(`INSERT INTO ${table} SELECT * FROM main.checkpoint_retained_${table};`);
        if (scalar(db, `SELECT EXISTS(SELECT * FROM ${table} EXCEPT SELECT * FROM main.checkpoint_retained_${table})
            OR EXISTS(SELECT * FROM main.checkpoint_retained_${table} EXCEPT SELECT * FROM ${table});`) !== 0) {
          throw new Error("Projected successor changed retained preference rows");
        }
        db.exec(`DROP TABLE main.checkpoint_retained_${table};`);
      }
      requireRetainedTip();
      // The old enrollment remains fenced by the existing epoch guard. Recovery
      // archives its original envelopes before any explicit new incarnation.
    },
  });
}

/** Same-epoch checkpoint adapter. All retained rows and settlement share activation rollback. */
export async function replacePwaProjectedCheckpoint(
  db:Database,engine:PwaLibraryCoreSqliteEngine,input:LibraryCoreActivateNormalizedCheckpointStageV2,
  capi:TransactionControl,subtle:SubtleCrypto=crypto.subtle,
) {
  const activation=parseLibraryCoreActivateNormalizedCheckpointStageV2(input);
  if (!activation.replaceExisting || !activation.followerReceipt) throw new Error("Projected checkpoint requires a consumer replacement");
  const proof=await preparePwaPreferenceCheckpointVerification(db,engine,subtle);
  const tables=["library_local_preference_projection","library_local_preference_nodes"];
  const resultRows=`SELECT i.transaction_digest AS intent_digest,i.actor_id AS intent_actor_id,
    i.intent_epoch_id AS intent_epoch,i.state AS intent_state,r.*
    FROM library_intent_transactions i JOIN library_intent_results r USING(transaction_id)
    WHERE EXISTS(SELECT 1 FROM library_local_preference_nodes n WHERE n.transaction_id=i.transaction_id)`;
  let before:ReturnType<typeof snapshot>;
  let sequence:number;
  return engine.activateNormalizedCheckpointWithLocalProjection(activation,{
    beforeReplace(){
      proof.assertUnchanged(capi);
      const lifecycle=readPwaExistingConsumerRecoveryStatus(db,engine.followerActorEnrollmentContext().authority);
      if (lifecycle.state!=="none" && lifecycle.state!=="following") throw new Error("Projected checkpoint requires completed consumer recovery");
      before=snapshot(db,engine);
      sequence=integer(one(db,"SELECT sequence FROM library_local_change_state;")[0]);
      if (one(db,`SELECT EXISTS(SELECT 1 FROM library_checkpoint_stages s JOIN library_meta m ON m.singleton_id=1
          WHERE s.stage_id=?1 AND s.library_id=m.library_id AND s.authority_epoch=m.authority_epoch AND s.source_revision>=m.source_revision);`,[activation.stageId])[0]!==1) {
        throw new Error("Projected checkpoint requires the selected epoch");
      }
      for (const table of tables) db.exec(`CREATE TABLE main.checkpoint_retained_${table} AS SELECT * FROM ${table};`);
      db.exec(`CREATE TABLE main.checkpoint_verified_preference_results AS ${resultRows};`);
    },
    afterReplace(){
      verifyStorage(db);
      for (const table of tables) {
        if (scalar(db,`SELECT count(*) FROM ${table};`)!==0) throw new Error("Projected checkpoint did not clear local rows");
        db.exec(`INSERT INTO ${table} SELECT * FROM main.checkpoint_retained_${table}; DROP TABLE main.checkpoint_retained_${table};`);
      }
      const current=snapshot(db,engine);
      const identity=(context:typeof current.context)=>Object.fromEntries(
        Object.entries(context).filter(([field]) => field !== "observed_frontier"),
      );
      if (JSON.stringify(identity(current.context))!==JSON.stringify(identity(before.context)) ||
          JSON.stringify(current.cursor)!==JSON.stringify(before.cursor) ||
          JSON.stringify(current.authority.slice(0,5))!==JSON.stringify(before.authority.slice(0,5)) ||
          integer(current.authority[5])<integer(before.authority[5]) || integer(one(db,"SELECT sequence FROM library_local_change_state;")[0])<sequence) {
        throw new Error("Projected checkpoint changed local continuity");
      }
      // The verifier's source fence precedes every importer write. This exact
      // set comparison ensures restoration retained the authenticated bytes and
      // typed evidence, including any effects of SQLite triggers during import.
      if (scalar(db,`SELECT EXISTS(SELECT * FROM checkpoint_verified_preference_results EXCEPT ${resultRows})
          OR EXISTS(${resultRows} EXCEPT SELECT * FROM checkpoint_verified_preference_results);`)!==0) {
        throw new Error("Projected checkpoint changed verified result evidence");
      }
      settleCoveredPreferenceEffects(db);
      db.exec("DROP TABLE main.checkpoint_verified_preference_results;");
    },
  });
}
