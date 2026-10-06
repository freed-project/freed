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
    let mut statement = db.prepare("SELECT name,type,substr(sql,1,262145) FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 1025;")?;
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
        1 | 2 => Ok(()),
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
                let bytes: i64 = tx.query_row("SELECT coalesce(length(canonical_result),0) FROM library_intent_results WHERE transaction_id=?1;", [id], |r|r.get(0)).optional()?.unwrap_or(0);
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
            assert!(
                install_normalized_schema_v1(&db).is_err(),
                "old opener must refuse unknown physical version"
            );
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
        db.execute_batch("DROP TABLE unexpected; PRAGMA user_version=3;")
            .unwrap();
        assert!(resume(&mut db)
            .unwrap_err()
            .to_string()
            .contains("unsupported"));
        assert_eq!(db.total_changes(), before);
    }
}
