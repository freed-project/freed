//! Device-local annotation edit exclusion. No canonical or checkpoint records.
use crate::{normalized_sqlite::NormalizedSqliteError, sqlite_contract_generated::*};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

pub(crate) const PAGE_ROWS: usize = 256;
pub(crate) const PAGE_BYTES: usize = 1_048_576;
const MAXIMUM_PAGES: usize = 4;
const MAXIMUM_TIME: Duration = Duration::from_millis(250);

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}
fn version(db: &Connection) -> Result<u32, NormalizedSqliteError> {
    Ok(db.pragma_query_value(None, "user_version", |row| row.get(0))?)
}
fn digest(value: u32) -> Result<&'static str, NormalizedSqliteError> {
    match value {
        1 => Ok(NORMALIZED_SCHEMA_SHA256),
        2 => Ok(NORMALIZED_NATIVE_SCHEMA_SHA256),
        4 => Ok(ANNOTATION_SCHEMA_SHA256),
        5 => Ok(ANNOTATION_RECOVERY_SCHEMA_SHA256),
        _ => Err(invalid("annotation storage version is unsupported")),
    }
}

/// This identity is pinned only while BUILDING; normal canonical changes remain legal when READY.
fn pin(db: &Connection) -> Result<String, NormalizedSqliteError> {
    Ok(db.query_row("SELECT json_object('library',(SELECT library_id FROM library_meta WHERE singleton_id=1),
      'authority',(SELECT authority_epoch FROM library_meta WHERE singleton_id=1),
      'activeAuthority',(SELECT epoch_id FROM library_active_authority WHERE library_id=(SELECT library_id FROM library_meta WHERE singleton_id=1)),
      'generation',(SELECT generation_id FROM library_materialization_generation WHERE singleton_id=1),
      'canonical',(SELECT source_revision FROM library_meta WHERE singleton_id=1),
      'change',(SELECT revision FROM library_change_state WHERE singleton_id=1),
      'local',(SELECT sequence FROM library_local_change_state WHERE singleton_id=1));", [], |row| row.get(0))?)
}

fn catalog(db: &Connection) -> Result<BTreeMap<String, (String, String)>, NormalizedSqliteError> {
    let mut statement = db.prepare("SELECT name,type,substr(sql,1,262145) FROM sqlite_schema WHERE sql IS NOT NULL AND substr(name,1,7) <> 'sqlite_' ORDER BY name LIMIT 1025;")?;
    let mut rows = statement.query([])?;
    let mut result = BTreeMap::new();
    let mut bytes = 0;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let kind: String = row.get(1)?;
        let sql: String = row.get(2)?;
        bytes += name.len() + kind.len() + sql.len();
        if sql.len() > 262144 || bytes > PAGE_BYTES || result.len() >= 1024 {
            return Err(invalid("annotation catalog exceeds verification bound"));
        }
        result.insert(name, (kind, sql));
    }
    Ok(result)
}

/// Compare the actual catalog, not only the caller-writable hash row. No repairs.
pub(crate) fn verify_catalog(db: &Connection, value: u32) -> Result<(), NormalizedSqliteError> {
    let expected_hash = digest(value)?;
    let matches: bool = db.query_row("SELECT contract_version=?1 AND schema_version=?2 AND protocol_version=?3 AND schema_sha256=?4 FROM library_storage_meta WHERE singleton_id=1;",
        params![SQLITE_CONTRACT_VERSION, value, SQLITE_PROTOCOL_VERSION, expected_hash], |row| row.get(0))?;
    let application: u32 = db.pragma_query_value(None, "application_id", |row| row.get(0))?;
    if !matches || application != SQLITE_APPLICATION_ID || version(db)? != value {
        return Err(invalid("annotation storage identity mismatch"));
    }
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(NORMALIZED_SCHEMA_SQL)?;
    if matches!(value, 2 | 5) {
        expected.execute_batch(NORMALIZED_NATIVE_SCHEMA_EXTENSION_SQL)?;
    }
    if matches!(value, 4 | 5) {
        expected.execute_batch(ANNOTATION_SCHEMA_EXTENSION_SQL)?;
    }
    if catalog(db)? != catalog(&expected)? {
        return Err(invalid("annotation storage catalog mismatch"));
    }
    if matches!(value, 4 | 5) {
        let receipt: bool = db.query_row("SELECT catalog_version=?1 AND catalog_sha256=?2 AND origin_sha256=CASE origin_version WHEN 1 THEN ?3 WHEN 2 THEN ?4 END FROM library_local_annotation_migration WHERE singleton_id=1;",
            params![value, expected_hash, NORMALIZED_SCHEMA_SHA256, NORMALIZED_NATIVE_SCHEMA_SHA256], |row| row.get(0))?;
        if !receipt {
            return Err(invalid("annotation migration receipt mismatch"));
        }
    }
    Ok(())
}

/// Ordinary boundaries must invoke this before retry recognition or any read/write.
pub(crate) fn reject_building(db: &Connection) -> Result<(), NormalizedSqliteError> {
    match version(db)? {
        // The dormant preference adapter owns its exact v3 admission separately.
        // This phase guard must not activate it or replace the ordinary catalog gate.
        1 | 2 | 3 => Ok(()),
        4 | 5 => {
            let ready: bool = db.query_row("SELECT phase='ready' FROM library_local_annotation_migration WHERE singleton_id=1;", [], |row| row.get(0))?;
            if ready {
                Ok(())
            } else {
                Err(invalid("LOCAL_ANNOTATION_MIGRATION_BUILDING"))
            }
        }
        _ => Err(invalid("annotation storage version is unsupported")),
    }
}

pub(crate) fn require_ready(db: &Connection) -> Result<(), NormalizedSqliteError> {
    if !matches!(version(db)?, 4 | 5) {
        return Err(invalid("LOCAL_ANNOTATION_UPGRADE_REQUIRED"));
    }
    reject_building(db)
}

/// Startup-only path under the host's existing exclusive Library lease.
/// A bounded unfinished invocation leaves the receipt intact and exposes no DB.
pub(crate) fn open_owned(db: &mut Connection) -> Result<(), NormalizedSqliteError> {
    if version(db)? == 0 {
        crate::normalized_sqlite::install_normalized_schema_v1(db)?;
    }
    if !resume(db)? {
        return Err(invalid("LOCAL_ANNOTATION_UPGRADE_PENDING"));
    }
    crate::normalized_sqlite::configure_normalized_sqlite_connection(db)
}

/// Only this owned resumer may open a BUILDING catalog. Every committed page is bounded.
/// The host retains its ordinary exclusive Library ownership for the entire invocation.
pub(crate) fn resume(db: &mut Connection) -> Result<bool, NormalizedSqliteError> {
    if !db.is_autocommit() {
        return Err(invalid(
            "annotation upgrade requires an owned idle connection",
        ));
    }
    db.execute_batch("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;")?;
    let deadline = Instant::now() + MAXIMUM_TIME;
    let busy: u64 = db.pragma_query_value(None, "busy_timeout", |row| row.get(0))?;
    db.busy_timeout(Duration::from_millis(25))?;
    db.progress_handler(1000, Some(move || Instant::now() >= deadline));
    let result = resume_until(db, deadline);
    db.progress_handler(0, None::<fn() -> bool>);
    db.busy_timeout(Duration::from_millis(busy))?;
    match result {
        Err(NormalizedSqliteError::Sqlite(rusqlite::Error::SqliteFailure(code, _)))
            if matches!(
                code.code,
                rusqlite::ErrorCode::OperationInterrupted
                    | rusqlite::ErrorCode::DatabaseBusy
                    | rusqlite::ErrorCode::DatabaseLocked
            ) =>
        {
            Ok(false)
        }
        other => other,
    }
}

fn resume_until(db: &mut Connection, deadline: Instant) -> Result<bool, NormalizedSqliteError> {
    let initial = version(db)?;
    verify_catalog(db, initial)?;
    if Instant::now() >= deadline {
        return Ok(false);
    }
    if matches!(initial, 1 | 2) {
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        verify_catalog(&tx, initial)?;
        let target = if initial == 1 { 4 } else { 5 };
        let pinned = pin(&tx)?;
        tx.execute_batch(ANNOTATION_SCHEMA_EXTENSION_SQL)?;
        tx.execute("INSERT INTO library_local_annotation_migration VALUES(1,?1,?2,?3,?4,'building',?5,NULL,NULL,0);",
            params![initial, digest(initial)?, target, digest(target)?, pinned])?;
        let updated = tx.execute("UPDATE library_storage_meta SET schema_version=?1,schema_sha256=?2 WHERE singleton_id=1 AND schema_version=?3 AND schema_sha256=?4;",
            params![target, digest(target)?, initial, digest(initial)?])?;
        if updated != 1 {
            return Err(invalid("annotation migration source changed"));
        }
        tx.pragma_update(None, "user_version", target)?;
        tx.commit()?;
    }
    for _ in 0..MAXIMUM_PAGES {
        if Instant::now() >= deadline {
            return Ok(false);
        }
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (phase, pinned, after_id, after_index): (String,String,Option<String>,Option<i64>) = tx.query_row(
            "SELECT phase,pinned_identity,after_transaction_id,after_member_index FROM library_local_annotation_migration WHERE singleton_id=1;", [],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
        if phase == "ready" {
            return Ok(true);
        }
        if pinned != pin(&tx)? {
            return Err(invalid("annotation backfill source changed"));
        }
        // Page the unfiltered PK. No state/type predicate can skip unbounded history.
        let rows: Vec<(String, i64, Vec<u8>, Vec<u8>)> = {
            let mut statement = tx.prepare("SELECT transaction_id,member_index,substr(CAST(entity_id AS BLOB),1,2049),substr(CAST(mutation_id AS BLOB),1,129)
              FROM library_intent_members WHERE (transaction_id,member_index)>(?1,?2)
              ORDER BY transaction_id,member_index LIMIT ?3;")?;
            let rows = statement
                .query_map(
                    params![
                        after_id.as_deref().unwrap_or(""),
                        after_index.unwrap_or(-1),
                        PAGE_ROWS
                    ],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if rows.is_empty() {
            tx.execute("UPDATE library_local_annotation_migration SET phase='ready' WHERE singleton_id=1 AND phase='building';", [])?;
            tx.commit()?;
            return Ok(true);
        }
        // Charge the entire resident metadata page before parsing any result.
        let mut used: usize = rows
            .iter()
            .map(|(id, _, entity, kind)| id.len() + entity.len() + kind.len() + 32)
            .sum();
        if used > PAGE_BYTES {
            return Err(invalid("annotation metadata page exceeds bound"));
        }
        let mut count = 0;
        for (id, index, entity, kind) in &rows {
            if Instant::now() >= deadline {
                break;
            }
            if entity.len() > 2048 || kind.len() > 128 {
                return Err(invalid("annotation backfill metadata exceeds bound"));
            }
            let entity = std::str::from_utf8(entity)
                .map_err(|_| invalid("annotation backfill identity is invalid"))?;
            let kind = std::str::from_utf8(kind)
                .map_err(|_| invalid("annotation backfill mutation is invalid"))?;
            if kind == "feed_item_annotations_replace" {
                let bytes: i64 = tx.query_row("SELECT length(canonical_result) + CASE WHEN status='already_applied' THEN 262144 ELSE 0 END FROM library_intent_results WHERE transaction_id=?1;", [id], |r|r.get(0)).optional()?.unwrap_or(0);
                used += usize::try_from(bytes)
                    .map_err(|_| invalid("annotation result length is invalid"))?;
                if used > PAGE_BYTES {
                    break;
                }
                let covered: bool =
                    tx.query_row(ANNOTATION_COVERAGE_SQL, [id], |row| row.get(0))?;
                if !covered {
                    tx.execute(
                        "INSERT INTO library_local_annotation_unresolved VALUES(?1,?2,?3);",
                        params![entity, id, index],
                    )?;
                }
            }
            tx.execute("UPDATE library_local_annotation_migration SET after_transaction_id=?1,after_member_index=?2,scanned_members=scanned_members+1 WHERE singleton_id=1;",params![id,index])?;
            count += 1;
        }
        if count == 0 {
            return Ok(false);
        }
        tx.commit()?;
    }
    Ok(false)
}

pub(crate) fn pending(db: &Connection, entity: &str) -> Result<bool, NormalizedSqliteError> {
    require_ready(db)?;
    if entity.is_empty() || entity.len() > 2048 {
        return Err(invalid("annotation identity exceeds bound"));
    }
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_annotation_unresolved WHERE entity_id=?1);",
        [entity],
        |row| row.get(0),
    )?)
}

/// Runs after exact retry recognition, before any new durable mutation.
pub(crate) fn admit_members(
    db: &Connection,
    members: &[crate::normalized_operation::VerifiedOperation],
) -> Result<(), NormalizedSqliteError> {
    for member in members {
        if member.operation_type == "feed_item_annotations_replace"
            && pending(db, &member.entity_id)?
        {
            return Err(invalid("LOCAL_ANNOTATION_PENDING"));
        }
    }
    Ok(())
}

/// Marker and subscription invalidation share the caller's owned transaction.
pub(crate) fn insert_member(
    tx: &rusqlite::Transaction<'_>,
    transaction_id: &str,
    index: usize,
    member: &crate::normalized_operation::VerifiedOperation,
) -> Result<(), NormalizedSqliteError> {
    if member.operation_type != "feed_item_annotations_replace" {
        return Ok(());
    }
    require_ready(tx)?;
    tx.execute(
        "INSERT INTO library_local_annotation_unresolved VALUES(?1,?2,?3);",
        params![member.entity_id, transaction_id, index],
    )?;
    invalidate(tx, &member.entity_id, "optimistic_added")
}

fn invalidate(
    tx: &rusqlite::Transaction<'_>,
    entity: &str,
    reason: &str,
) -> Result<(), NormalizedSqliteError> {
    let changed = tx.execute(
        "UPDATE library_local_change_state SET sequence=sequence+1 WHERE singleton_id=1;",
        [],
    )?;
    if changed != 1 {
        return Err(invalid("annotation local sequence is missing"));
    }
    tx.execute(
        "INSERT INTO library_local_invalidations(sequence,topic,entity_id,reason)
        SELECT sequence,'feed_item',?1,?2 FROM library_local_change_state WHERE singleton_id=1;",
        params![entity, reason],
    )?;
    tx.execute("DELETE FROM library_local_invalidations WHERE sequence <= (SELECT sequence-4096 FROM library_local_change_state WHERE singleton_id=1);", [])?;
    Ok(())
}

/// All producers of library_intent_results verify authority signatures before
/// insertion. This predicate checks that retained evidence covers these exact
/// local members; JSON/digest equality alone is not signature verification.
pub(crate) fn retire_transaction(
    tx: &rusqlite::Transaction<'_>,
    transaction_id: &str,
) -> Result<(), NormalizedSqliteError> {
    match version(tx)? {
        1 | 2 | 3 => return Ok(()),
        _ => require_ready(tx)?,
    }
    let entities: Vec<String> = {
        let mut statement=tx.prepare("SELECT entity_id FROM library_local_annotation_unresolved WHERE transaction_id=?1 ORDER BY member_index LIMIT 257;")?;
        let rows = statement
            .query_map([transaction_id], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    if entities.is_empty() {
        return Ok(());
    }
    if entities.len() > 256 || entities.iter().any(|entity| entity.len() > 2048) {
        return Err(invalid("annotation retirement exceeds member bound"));
    }
    let result_bytes: i64 = tx
        .query_row(
            "SELECT length(canonical_result) FROM library_intent_results WHERE transaction_id=?1;",
            [transaction_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0);
    if !(0..=131072).contains(&result_bytes) {
        return Err(invalid("annotation retirement result exceeds bound"));
    }
    let covered: bool = tx.query_row(ANNOTATION_COVERAGE_SQL, [transaction_id], |r| r.get(0))?;
    if !covered {
        return Ok(());
    }
    tx.execute(
        "DELETE FROM library_local_annotation_unresolved WHERE transaction_id=?1;",
        [transaction_id],
    )?;
    for entity in entities {
        invalidate(tx, &entity, "optimistic_removed")?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct NormalizedAnnotationReconciliationPassV1 {
    identity: String,
    through: (String, i64),
    after: Option<(String, i64)>,
}

/// Runs one owner-invoked slice under a new IMMEDIATE transaction. The retained
/// pass cursor is only a scheduling hint; durable markers remain authoritative.
pub fn reconcile_normalized_annotation_slice_v1(
    connection: &mut Connection,
    pass: Option<NormalizedAnnotationReconciliationPassV1>,
) -> Result<Option<NormalizedAnnotationReconciliationPassV1>, NormalizedSqliteError> {
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    require_ready(&tx)?;
    let identity:Option<String>=tx.query_row("SELECT json_array(meta.library_id,meta.authority_epoch,generation.generation_id,active.epoch_id) FROM library_meta AS meta JOIN library_materialization_generation AS generation USING(singleton_id) JOIN library_active_authority AS active ON active.library_id=meta.library_id;",[],|row|row.get(0)).optional()?;
    let Some(identity) = identity else {
        return Ok(None);
    };
    let mut pass = match pass {
        Some(pass) if pass.identity == identity => pass,
        _ => {
            let through:Option<(String,i64)>=tx.query_row("SELECT transaction_id,member_index FROM library_local_annotation_unresolved INDEXED BY library_local_annotation_transaction ORDER BY transaction_id DESC,member_index DESC LIMIT 1;",[],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
            let Some(through) = through else {
                return Ok(None);
            };
            NormalizedAnnotationReconciliationPassV1 {
                identity,
                through,
                after: None,
            }
        }
    };
    let after = reconcile_page(
        &tx,
        pass.after.as_ref().map(|(id, index)| (id.as_str(), *index)),
        (&pass.through.0, pass.through.1),
    )?;
    tx.commit()?;
    match after {
        Some(after) => {
            pass.after = Some(after);
            Ok(Some(pass))
        }
        None => Ok(None),
    }
}

/// One device-local maintenance page. The caller retains the returned keyset
/// cursor and schedules another bounded transaction; this never scans settled
/// result history or makes an incomplete sweep look complete.
pub(crate) fn reconcile_page(
    tx: &rusqlite::Transaction<'_>,
    after: Option<(&str, i64)>,
    through: (&str, i64),
) -> Result<Option<(String, i64)>, NormalizedSqliteError> {
    require_ready(tx)?;
    let deadline = Instant::now() + MAXIMUM_TIME;
    let rows: Vec<(String, i64)> = {
        let mut statement=tx.prepare("SELECT transaction_id,member_index FROM library_local_annotation_unresolved INDEXED BY library_local_annotation_transaction WHERE (transaction_id,member_index)>(?1,?2) AND (transaction_id,member_index)<=(?3,?4) ORDER BY transaction_id,member_index LIMIT 256;")?;
        let (id, index) = after.unwrap_or(("", -1));
        let rows = statement
            .query_map(params![id, index, through.0, through.1], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    if rows.is_empty() {
        return Ok(None);
    }
    let mut used: usize = rows.iter().map(|(id, _)| id.len() + 16).sum();
    let mut cursor = after.map(|(id, index)| (id.to_owned(), index));
    let mut previous: Option<&str> = None;
    for (id, index) in &rows {
        if previous != Some(id.as_str()) {
            // Charge complete entity rows and all possible verified result bodies
            // before the common predicate decodes any JSON.
            let bytes:i64=tx.query_row("SELECT length(canonical_result) + CASE WHEN status='already_applied' THEN 262144 ELSE 0 END FROM library_intent_results WHERE transaction_id=?1;",[id],|row|row.get(0)).optional()?.unwrap_or(0);
            if !(0..=393216).contains(&bytes) {
                return Err(invalid("annotation maintenance result exceeds bound"));
            }
            let charge = usize::try_from(bytes)
                .map_err(|_| invalid("annotation result length is invalid"))?
                + 256 * 2048;
            if used + charge > PAGE_BYTES || (cursor.is_some() && Instant::now() >= deadline) {
                break;
            }
            used += charge;
            retire_transaction(tx, id)?;
            previous = Some(id);
        }
        cursor = Some((id.clone(), *index));
    }
    Ok(cursor)
}

/// The caller has authenticated checkpoint continuity and installed its receipt
/// in this same transaction. SQLite streams unresolved rows through its pager;
/// no full marker/result history is decoded into a host collection.
pub(crate) fn retire_checkpoint(
    tx: &rusqlite::Transaction<'_>,
) -> Result<(), NormalizedSqliteError> {
    if matches!(version(tx)?, 1 | 2 | 3) {
        return Ok(());
    }
    require_ready(tx)?;
    let predicate = ANNOTATION_COVERAGE_SQL
        .trim()
        .trim_end_matches(';')
        .replace("?1", "marker.transaction_id");
    let removed = tx.execute(
        &format!("DELETE FROM library_local_annotation_unresolved AS marker WHERE ({predicate});"),
        [],
    )?;
    if removed > 0 {
        tx.execute(
            "UPDATE library_local_change_state SET sequence=sequence+1 WHERE singleton_id=1;",
            [],
        )?;
        tx.execute("INSERT INTO library_local_invalidations(sequence,topic,entity_id,reason) SELECT local.sequence,'library',meta.library_id,'optimistic_removed' FROM library_local_change_state AS local JOIN library_meta AS meta USING(singleton_id);",[])?;
        tx.execute("DELETE FROM library_local_invalidations WHERE sequence <= (SELECT sequence-4096 FROM library_local_change_state WHERE singleton_id=1);",[])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_sqlite::install_normalized_schema_v1;

    fn fixture(path: &std::path::Path, source: u32) -> Connection {
        let db = Connection::open(path).unwrap();
        install_normalized_schema_v1(&db).unwrap();
        db.execute_batch("PRAGMA synchronous=FULL;").unwrap();
        if source == 2 {
            db.execute_batch(NORMALIZED_NATIVE_SCHEMA_EXTENSION_SQL)
                .unwrap();
            db.execute(
                "UPDATE library_storage_meta SET schema_version=2,schema_sha256=?1;",
                [NORMALIZED_NATIVE_SCHEMA_SHA256],
            )
            .unwrap();
            db.pragma_update(None, "user_version", 2).unwrap();
        }
        db
    }

    fn populate(db: &Connection) {
        db.execute_batch(include_str!(
            "../../shared/src/library-core/annotation-backfill-fixture-v1.sql"
        ))
        .unwrap();
        assert!(db
            .prepare("PRAGMA foreign_key_check;")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
    }

    #[test]
    fn annotation_path_owner_upgrades_both_sources_and_keeps_absent_storage_absent() {
        use crate::normalized_sqlite::{
            initialize_owned_normalized_sqlite_database_v1, open_normalized_sqlite_database_v1,
        };
        let dir = tempfile::tempdir().unwrap();
        for source in [1, 2] {
            let path = dir.path().join(format!("source-{source}.sqlite"));
            let db = fixture(&path, source);
            populate(&db);
            drop(db);
            let db = initialize_owned_normalized_sqlite_database_v1(&path, false)
                .unwrap()
                .unwrap();
            assert_eq!(version(&db).unwrap(), source + 3);
            assert_eq!(
                db.query_row(
                    "SELECT scanned_members FROM library_local_annotation_migration;",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
                1025
            );
            drop(db);
            let db = open_normalized_sqlite_database_v1(&path, false).unwrap();
            assert_eq!(db.total_changes(), 0, "ordinary READY open cannot backfill");
        }
        let absent = dir.path().join("absent").join("library.sqlite");
        assert!(
            initialize_owned_normalized_sqlite_database_v1(&absent, false)
                .unwrap()
                .is_none()
        );
        assert!(!absent.parent().unwrap().exists());
        let fresh = initialize_owned_normalized_sqlite_database_v1(&absent, true)
            .unwrap()
            .unwrap();
        assert_eq!(version(&fresh).unwrap(), 4);
        require_ready(&fresh).unwrap();
        assert_eq!(
            fresh
                .query_row(
                    "SELECT count(*) FROM library_active_authority;",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn annotation_ordinary_path_open_refuses_building_without_advancing() {
        use crate::normalized_sqlite::{
            initialize_owned_normalized_sqlite_database_v1, open_normalized_sqlite_database_v1,
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let mut db = fixture(&path, 1);
        populate(&db);
        assert!(!resume(&mut db).unwrap());
        let state = |db: &Connection| {
            db.query_row("SELECT pinned_identity,scanned_members,(SELECT count(*) FROM library_local_annotation_unresolved),catalog_version FROM library_local_annotation_migration;",[],|row|Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,row.get::<_,i64>(2)?,row.get::<_,i64>(3)?))).unwrap()
        };
        let before = state(&db);
        assert!(open_normalized_sqlite_database_v1(&path, false)
            .unwrap_err()
            .to_string()
            .contains("BUILDING"));
        assert_eq!(state(&db), before);
        drop(db);
        let reopened = initialize_owned_normalized_sqlite_database_v1(&path, false)
            .unwrap()
            .unwrap();
        assert_eq!(state(&reopened).0, before.0);
        require_ready(&reopened).unwrap();
    }

    #[test]
    fn annotation_continuation_refuses_oversized_result_without_writes() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = fixture(&dir.path().join("library.sqlite"), 1);
        populate(&db);
        while !resume(&mut db).unwrap() {}
        // Corruption fixture bypasses the normal producer/table size checks only
        // to prove the maintenance boundary refuses oversized stored evidence.
        db.execute_batch("PRAGMA ignore_check_constraints=ON;
          DELETE FROM library_local_annotation_unresolved WHERE entity_id<>'item:258';
          INSERT INTO library_intent_results SELECT transaction_id,actor_id,'epoch','epoch',first_counter,
          printf('%064d',first_counter-1),transaction_digest,'accepted',0,
          CAST(json_object('padding',printf('%0500000d',0)) AS BLOB),0
          FROM library_intent_transactions WHERE first_counter=258;
          PRAGMA ignore_check_constraints=OFF;").unwrap();
        let before = db.total_changes();
        assert!(reconcile_normalized_annotation_slice_v1(&mut db, None)
            .unwrap_err()
            .to_string()
            .contains("maintenance result exceeds bound"));
        assert_eq!(db.total_changes(), before);
        assert!(pending(&db, "item:258").unwrap());
    }

    #[test]
    fn annotation_continuation_passes_unresolved_prefix_and_restarts_for_new_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let mut db = fixture(&path, 1);
        populate(&db);
        while !resume(&mut db).unwrap() {}
        // Relational cursor fixture only. Signature verification is covered by
        // the separate signed follower/result/materialization tests.
        fn settle(db: &Connection, counter: i64) {
            db.execute("INSERT INTO library_intent_results
              SELECT transaction_id,actor_id,'epoch','epoch',first_counter,printf('%064d',first_counter-1),
                transaction_digest,'rejected',0,CAST(json_object(
                  'transaction_id',transaction_id,'transaction_digest',transaction_digest,
                  'library_id','library','actor_id',actor_id,'intent_epoch_id','epoch','epoch_id','epoch',
                  'status','rejected','result_body_digest',transaction_digest,'authoritative_source_revision',0) AS BLOB),0
              FROM library_intent_transactions WHERE first_counter=?1;",[counter]).unwrap();
        }
        settle(&db, 1025);
        let mut pass = None;
        let mut slices = 0;
        loop {
            pass = reconcile_normalized_annotation_slice_v1(&mut db, pass).unwrap();
            if pass.is_none() {
                break;
            }
            slices += 1;
            assert!(slices < 1100);
            if slices == 300 {
                settle(&db, 258);
            }
        }
        assert!(slices > 256);
        assert!(!pending(&db, "item:1025").unwrap());
        assert!(pending(&db, "item:258").unwrap());
        assert!(pending(&db, "item:600").unwrap());
        // The next dirty pass revisits evidence arriving behind the old cursor.
        let next = reconcile_normalized_annotation_slice_v1(&mut db, None).unwrap();
        assert!(!pending(&db, "item:258").unwrap());
        db.execute_batch(
            "UPDATE library_materialization_generation SET generation_id=printf('%064d',9);",
        )
        .unwrap();
        let reset = reconcile_normalized_annotation_slice_v1(&mut db, next)
            .unwrap()
            .unwrap();
        assert_eq!(reset.after.unwrap().0, "transaction:0259");
        drop(db);
        let mut reopened = Connection::open(&path).unwrap();
        let reopened_pass = reconcile_normalized_annotation_slice_v1(&mut reopened, None).unwrap();
        assert!(reopened_pass.is_some());
        assert!(!pending(&reopened, "item:1025").unwrap());
    }

    #[test]
    fn annotation_populated_pages_resume_with_pinned_identity_and_work_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let mut db = fixture(&path, 1);
        populate(&db);
        let before = db.total_changes();
        assert!(!resume_until(&mut db, Instant::now()).unwrap());
        assert_eq!(
            db.total_changes(),
            before,
            "expired budget cannot bootstrap"
        );
        assert!(
            !resume(&mut db).unwrap(),
            "1025 rows cannot finish in four 256-row pages"
        );
        let scanned: i64 = db
            .query_row(
                "SELECT scanned_members FROM library_local_annotation_migration;",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((1..=1024).contains(&scanned));
        db.execute_batch("UPDATE library_meta SET source_revision=1;")
            .unwrap();
        let before = db.total_changes();
        assert!(resume(&mut db)
            .unwrap_err()
            .to_string()
            .contains("source changed"));
        assert_eq!(db.total_changes(), before);
        db.execute_batch("UPDATE library_meta SET source_revision=0;")
            .unwrap();
        drop(db);
        let mut db = Connection::open(&path).unwrap();
        let mut ready = false;
        for _ in 0..16 {
            if resume(&mut db).unwrap() {
                ready = true;
                break;
            }
        }
        assert!(ready);
        let counts: (i64,i64) = db.query_row("SELECT (SELECT scanned_members FROM library_local_annotation_migration),(SELECT count(*) FROM library_local_annotation_unresolved);",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(counts, (1025, 768));
        assert!(!pending(&db, "item:257").unwrap());
        assert!(pending(&db, "item:258").unwrap());
    }

    #[test]
    fn annotation_backfill_charges_result_bytes_before_parsing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let mut db = fixture(&path, 1);
        populate(&db);
        // Synthetic unauthenticated result identities cannot retire markers.
        // These rows exercise aggregate accounting, not signature acceptance.
        db.execute_batch("UPDATE library_intent_members SET mutation_id='feed_item_annotations_replace';
          INSERT INTO library_intent_results SELECT transaction_id,actor_id,'epoch','epoch',first_counter,
          CASE WHEN first_counter=1 THEN NULL ELSE printf('%064d',first_counter-1) END,
          transaction_digest,'accepted',1,CAST(json_object('padding',printf('%0130000d',0)) AS BLOB),0
          FROM library_intent_transactions WHERE first_counter<=80;").unwrap();
        assert!(!resume(&mut db).unwrap());
        let scanned: i64 = db
            .query_row(
                "SELECT scanned_members FROM library_local_annotation_migration;",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((1..=28).contains(&scanned));
        drop(db);
        let mut db = Connection::open(&path).unwrap();
        let mut ready = false;
        for _ in 0..16 {
            // Completion here tests byte/page bounds, independently of host scheduling.
            // Expired-budget and source-pin cases exercise cooperative deadlines separately.
            if resume_until(&mut db, Instant::now() + Duration::from_secs(60)).unwrap() {
                ready = true;
                break;
            }
        }
        assert!(ready);
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_local_annotation_unresolved;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1025
        );
    }

    #[test]
    fn annotation_populated_page_failure_rolls_back_cursor_and_markers() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let mut db = fixture(&path, 1);
        populate(&db);
        // Every row is now an annotation so the injected second insert fails
        // after one marker and cursor update within the same page transaction.
        db.execute_batch(
            "UPDATE library_intent_members SET mutation_id='feed_item_annotations_replace';",
        )
        .unwrap();
        let inserts = Arc::new(AtomicUsize::new(0));
        let observed = inserts.clone();
        db.authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
            if matches!(
                ctx.action,
                rusqlite::hooks::AuthAction::Insert {
                    table_name: "library_local_annotation_unresolved"
                }
            ) && observed.fetch_add(1, Ordering::SeqCst) == 1
            {
                rusqlite::hooks::Authorization::Deny
            } else {
                rusqlite::hooks::Authorization::Allow
            }
        }));
        assert!(resume(&mut db).is_err());
        db.authorizer(
            None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>,
        );
        assert_eq!(inserts.load(Ordering::SeqCst), 2);
        assert_eq!(
            db.query_row(
                "SELECT scanned_members FROM library_local_annotation_migration;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_local_annotation_unresolved;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert!(reject_building(&db).is_err());
        drop(db);
        let mut db = Connection::open(&path).unwrap();
        let mut ready = false;
        for _ in 0..16 {
            if resume(&mut db).unwrap() {
                ready = true;
                break;
            }
        }
        assert!(ready);
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_local_annotation_unresolved;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1025
        );
    }

    #[test]
    #[cfg(feature = "library-transfer-acceptance")]
    fn annotation_ready_transfer_updates_current_receipt_and_preserves_origin() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let mut db = fixture(&path, 1);
        assert!(resume(&mut db).unwrap());
        {
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).unwrap();
            assert_eq!(version(&tx).unwrap(), 5);
            // Failure of the surrounding transfer must restore catalog and receipt.
        }
        verify_catalog(&db, 4).unwrap();
        db.execute_batch("UPDATE library_local_annotation_migration SET phase='building';")
            .unwrap();
        {
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            let before = tx.total_changes();
            assert!(
                crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx)
                    .unwrap_err()
                    .to_string()
                    .contains("BUILDING")
            );
            assert_eq!(tx.total_changes(), before);
        }
        db.execute_batch("UPDATE library_local_annotation_migration SET phase='ready';")
            .unwrap();
        {
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).unwrap();
            tx.commit().unwrap();
        }
        drop(db);
        let db = Connection::open(&path).unwrap();
        install_normalized_schema_v1(&db).unwrap();
        verify_catalog(&db, 5).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT origin_version FROM library_local_annotation_migration;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn annotation_upgrade_preserves_sources_and_reopens_exact_catalog() {
        for source in [1, 2] {
            let dir = tempfile::tempdir().unwrap();
            let file = dir.path().join("library.sqlite");
            let mut db = fixture(&file, source);
            assert!(resume(&mut db).unwrap());
            let target = if source == 1 { 4 } else { 5 };
            assert_eq!(version(&db).unwrap(), target);
            verify_catalog(&db, target).unwrap();
            assert!(!pending(&db, "unrelated").unwrap());
            drop(db);
            let mut db = Connection::open(&file).unwrap();
            verify_catalog(&db, target).unwrap();
            assert!(resume(&mut db).unwrap());
            install_normalized_schema_v1(&db).unwrap();
            // The immutable pre-upgrade opener admits exactly versions 1/2.
            assert!(![1, 2].contains(&version(&db).unwrap()));
        }
    }

    #[test]
    fn annotation_ready_failure_leaves_resumable_building_and_blocks_reads() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("library.sqlite");
        let mut db = fixture(&file, 1);
        db.authorizer(Some(|ctx: rusqlite::hooks::AuthContext<'_>| {
            match ctx.action {
                rusqlite::hooks::AuthAction::Update {
                    table_name: "library_local_annotation_migration",
                    column_name: "phase",
                } => rusqlite::hooks::Authorization::Deny,
                _ => rusqlite::hooks::Authorization::Allow,
            }
        }));
        assert!(resume(&mut db).is_err());
        db.authorizer(
            None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>,
        );
        assert_eq!(version(&db).unwrap(), 4);
        assert!(reject_building(&db)
            .unwrap_err()
            .to_string()
            .contains("BUILDING"));
        drop(db);
        let mut db = Connection::open(&file).unwrap();
        assert!(resume(&mut db).unwrap());
        require_ready(&db).unwrap();
    }

    #[test]
    fn annotation_upgrade_refuses_unknown_or_unversioned_catalog_without_writes() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("library.sqlite");
        let mut db = fixture(&file, 1);
        db.execute_batch("CREATE TABLE unexpected(x);").unwrap();
        let before = db.total_changes();
        assert!(resume(&mut db)
            .unwrap_err()
            .to_string()
            .contains("catalog mismatch"));
        assert_eq!(db.total_changes(), before);
        db.execute_batch("DROP TABLE unexpected;").unwrap();
        for (create, drop_object) in [
            ("CREATE TABLE sqliteX_unreviewed(x);", "DROP TABLE sqliteX_unreviewed;"),
            ("CREATE TRIGGER sqliteX_unreviewed_trigger AFTER UPDATE ON library_change_state BEGIN SELECT 1; END;", "DROP TRIGGER sqliteX_unreviewed_trigger;"),
        ] {
            db.execute_batch(create).unwrap();
            assert!(resume(&mut db).unwrap_err().to_string().contains("catalog mismatch"));
            assert_eq!(db.total_changes(), before);
            db.execute_batch(drop_object).unwrap();
        }
        db.execute_batch("PRAGMA user_version=3;").unwrap();
        assert!(resume(&mut db)
            .unwrap_err()
            .to_string()
            .contains("unsupported"));
        assert_eq!(db.total_changes(), before);
    }
}
