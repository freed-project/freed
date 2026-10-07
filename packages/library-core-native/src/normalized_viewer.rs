//! Installation-local edit denial. A checkpoint cannot grant or remove this policy.
use crate::{normalized_sqlite::NormalizedSqliteError, sqlite_contract_generated::*};
use rusqlite::Connection;

pub fn normalized_library_is_read_only_v1(db: &Connection) -> Result<bool, NormalizedSqliteError> {
    let version: u32 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == VIEWER_STORAGE_SCHEMA_VERSION {
        verify_policy(db)?;
        return Ok(true);
    }
    Ok(false)
}

/// Called only after verified source adoption, before its transaction commits.
/// Opening a database never performs this migration.
pub(crate) fn install_after_source_adoption(
    tx: &rusqlite::Transaction<'_>,
    handoff_id: &str,
    enabled_at: u64,
) -> Result<(), NormalizedSqliteError> {
    crate::require_library_transfer_capability().map_err(NormalizedSqliteError::Transport)?;
    let version: u32 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != ANNOTATION_RECOVERY_STORAGE_SCHEMA_VERSION {
        return Err(NormalizedSqliteError::InvalidRequest(
            "viewer adoption requires catalog 5",
        ));
    }
    crate::normalized_local_annotations::verify_catalog(tx, version)?;
    crate::normalized_local_annotations::require_ready(tx)?;
    let library: String = tx.query_row(
        "SELECT meta.library_id FROM library_meta AS meta
         JOIN library_local_handoff AS handoff ON handoff.library_id=meta.library_id
         WHERE meta.singleton_id=1 AND handoff.singleton_id=1
           AND handoff.handoff_id=?1 AND handoff.installation_role='source'
           AND handoff.phase='demoted' AND handoff.successor_epoch_id=meta.authority_epoch
           AND NOT EXISTS(SELECT 1 FROM library_writer_admission)
           AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission)
           AND NOT EXISTS(SELECT 1 FROM library_intent_transactions WHERE state IN ('pending','published'));",
        [handoff_id], |row| row.get(0),
    )?;
    tx.execute_batch(VIEWER_SCHEMA_EXTENSION_SQL)?;
    tx.execute(
        "INSERT INTO library_local_viewer_policy VALUES(1,?1,?2,?3);",
        rusqlite::params![library, handoff_id, enabled_at],
    )?;
    let changed = tx.execute(
        "UPDATE library_storage_meta SET schema_version=?1,schema_sha256=?2
        WHERE singleton_id=1 AND schema_version=?3 AND schema_sha256=?4;",
        rusqlite::params![
            VIEWER_STORAGE_SCHEMA_VERSION,
            VIEWER_SCHEMA_SHA256,
            ANNOTATION_RECOVERY_STORAGE_SCHEMA_VERSION,
            ANNOTATION_RECOVERY_SCHEMA_SHA256
        ],
    )?;
    if changed != 1 {
        return Err(NormalizedSqliteError::InvalidRequest(
            "viewer migration source changed",
        ));
    }
    tx.pragma_update(None, "user_version", VIEWER_STORAGE_SCHEMA_VERSION)?;
    crate::normalized_local_annotations::verify_catalog(tx, VIEWER_STORAGE_SCHEMA_VERSION)
}

pub(crate) fn require_editable(db: &Connection) -> Result<(), NormalizedSqliteError> {
    let version: u32 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == VIEWER_STORAGE_SCHEMA_VERSION {
        // Deny even if the receipt is damaged. Opening validates its exact catalog
        // and Library binding; missing policy must never restore edit admission.
        return Err(NormalizedSqliteError::InvalidRequest(
            "LOCAL_VIEWER_READ_ONLY",
        ));
    }
    Ok(())
}

pub(crate) fn verify_policy(db: &Connection) -> Result<(), NormalizedSqliteError> {
    let valid: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_viewer_policy AS policy
         JOIN library_meta AS meta ON meta.singleton_id=1 AND meta.library_id=policy.library_id
         WHERE policy.singleton_id=1)
         AND NOT EXISTS(SELECT 1 FROM library_writer_admission)
         AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);",
        [],
        |row| row.get(0),
    )?;
    if !valid {
        return Err(NormalizedSqliteError::InvalidRequest(
            "LOCAL_VIEWER_POLICY_INVALID",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Synthetic catalog fixture only. This does not fabricate transfer proof or
    // expose an activation entry point in the product.
    fn fixture(path: &std::path::Path) -> Connection {
        let db = Connection::open(path).unwrap();
        crate::normalized_sqlite::install_normalized_schema_v1(&db).unwrap();
        db.execute_batch(NORMALIZED_NATIVE_SCHEMA_EXTENSION_SQL)
            .unwrap();
        db.execute_batch(ANNOTATION_SCHEMA_EXTENSION_SQL).unwrap();
        db.execute_batch(VIEWER_SCHEMA_EXTENSION_SQL).unwrap();
        db.execute(
            "INSERT INTO library_meta VALUES(1,?1,1,?2,0,0);",
            [&"a".repeat(64), &"c".repeat(64)],
        )
        .unwrap();
        db.execute("INSERT INTO library_local_annotation_migration VALUES(1,2,?1,5,?2,'ready','{}',NULL,NULL,0);",
            [NORMALIZED_NATIVE_SCHEMA_SHA256, ANNOTATION_RECOVERY_SCHEMA_SHA256]).unwrap();
        db.execute(
            "INSERT INTO library_local_viewer_policy VALUES(1,?1,?2,1);",
            [&"a".repeat(64), &"b".repeat(64)],
        )
        .unwrap();
        db.execute(
            "UPDATE library_storage_meta SET schema_version=6,schema_sha256=?1;",
            [VIEWER_SCHEMA_SHA256],
        )
        .unwrap();
        db.pragma_update(None, "user_version", VIEWER_STORAGE_SCHEMA_VERSION)
            .unwrap();
        db
    }

    #[test]
    fn viewer_reopens_with_unchanged_annotation_receipt_and_denies_native_edit_paths() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("viewer.sqlite");
        let db = fixture(&path);
        crate::normalized_sqlite::install_normalized_schema_v1(&db).unwrap();
        drop(db);
        let mut db = Connection::open(&path).unwrap();
        crate::normalized_sqlite::install_normalized_schema_v1(&db).unwrap();
        assert!(normalized_library_is_read_only_v1(&db).unwrap());
        assert!(crate::normalized_consumer_recovery::read_consumer_recovery_summary_v1(&db)
            .unwrap()
            .is_none());
        assert_eq!(
            db.query_row(
                "SELECT catalog_version FROM library_local_annotation_migration;",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
            5
        );
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        for result in [
            crate::normalized_follower::normalized_follower_signing_context_v1(&tx).map(|_| ()),
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&tx).map(|_| ()),
            crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&tx),
            crate::normalized_follower::page_normalized_follower_transport_v2(
                &tx,
                &crate::NormalizedFollowerTransportPageRequestV2 {
                    actor_id: "d".repeat(64),
                    first_actor_counter: 1,
                    limit: 128,
                    schema_version: 2,
                },
            )
            .map(|_| ()),
            crate::normalized_follower::export_normalized_follower_intent_page_v1(
                &tx,
                &crate::NormalizedFollowerIntentPageRequestV1 {
                    actor_id: "d".repeat(64),
                    cursor: None,
                    maximum_records: 1,
                    maximum_response_bytes: 1_048_576,
                },
            )
            .map(|_| ()),
        ] {
            assert!(matches!(
                result,
                Err(NormalizedSqliteError::InvalidRequest(
                    "LOCAL_VIEWER_READ_ONLY"
                ))
            ));
        }
        tx.rollback().unwrap();
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_intent_transactions;",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn viewer_open_refuses_missing_foreign_or_writer_policy_state() {
        for mutation in [
            "DELETE FROM library_local_viewer_policy;",
            "UPDATE library_local_viewer_policy SET library_id=printf('%064d',1);",
            "INSERT INTO library_writer_admission VALUES(1,'writer','writer',0,0);",
            "UPDATE library_local_annotation_migration SET catalog_sha256=printf('%064d',1);",
            "ALTER TABLE library_local_viewer_policy ADD COLUMN extra TEXT;",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let db = fixture(&directory.path().join("viewer.sqlite"));
            db.execute_batch(mutation).unwrap();
            assert!(
                crate::normalized_sqlite::install_normalized_schema_v1(&db).is_err(),
                "{mutation}"
            );
            assert!(require_editable(&db).is_err());
        }
    }

    #[test]
    fn viewer_version_denies_edits_even_without_a_policy_receipt() {
        let db = Connection::open_in_memory().unwrap();
        db.pragma_update(None, "user_version", VIEWER_STORAGE_SCHEMA_VERSION)
            .unwrap();
        assert!(matches!(
            require_editable(&db),
            Err(NormalizedSqliteError::InvalidRequest(
                "LOCAL_VIEWER_READ_ONLY"
            ))
        ));
        assert!(verify_policy(&db).is_err());
    }
}
