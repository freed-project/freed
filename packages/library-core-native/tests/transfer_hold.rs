#![cfg(not(feature = "library-transfer-acceptance"))]
use freed_library_core::*;
use rusqlite::Connection;
struct NoKeys;
impl ActorKeyStore for NoKeys {
    fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
        panic!("key read before denial")
    }
    fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
        panic!("key write before denial")
    }
}
impl AuthorityKeyStore for NoKeys {
    fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
        panic!("authority key read before denial")
    }
    fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
        panic!("authority key write before denial")
    }
}
#[test]
fn direct_lifecycle_calls_refuse_before_schema_or_keys() {
    let mut db = Connection::open_in_memory().unwrap();
    let before: i64 = db
        .query_row("PRAGMA schema_version", [], |r| r.get(0))
        .unwrap();
    let failures = [
        prepare_target_handoff_readiness_v1(&mut db, &NoKeys, &NoKeys, 0).unwrap_err(),
        begin_source_handoff_v1(&mut db, b"", "", &NoKeys, 0).unwrap_err(),
        archive_consumer_epoch_recovery_v1(&mut db, &NoKeys, 0).unwrap_err(),
        prepare_consumer_recovery_v1(&mut db, "", &NoKeys, 0).unwrap_err(),
        prepare_source_handoff_authorization_v1(&mut db, "", b"", "", "").unwrap_err(),
    ];
    assert!(failures.iter().all(|e| e == LIBRARY_TRANSFER_UNAVAILABLE));
    assert_eq!(
        db.query_row::<i64, _, _>("PRAGMA schema_version", [], |r| r.get(0))
            .unwrap(),
        before
    );
    assert_eq!(
        db.query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        0
    );
    assert!(db.is_autocommit());
}
fn fixture() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE library_meta(singleton_id INTEGER,library_id TEXT,authority_epoch TEXT); CREATE TABLE library_checkpoint_stages(stage_id TEXT,library_id TEXT,authority_epoch TEXT); INSERT INTO library_checkpoint_stages VALUES('stage','library','epoch');").unwrap();
    db
}
#[test]
fn empty_bootstrap_and_accepted_epoch_refresh_remain_admissible() {
    let db = fixture();
    assert!(require_checkpoint_transfer_capability(&db, "stage").is_ok());
    db.execute_batch("INSERT INTO library_meta VALUES(1,'library','epoch');")
        .unwrap();
    assert!(require_checkpoint_transfer_capability(&db, "stage").is_ok());
    // Old enrollment is deliberately irrelevant: accepted Library authority governs refresh.
    db.execute_batch(
        "CREATE TABLE old_enrollment(epoch TEXT);INSERT INTO old_enrollment VALUES('predecessor');",
    )
    .unwrap();
    assert!(require_checkpoint_transfer_capability(&db, "stage").is_ok());
}
#[test]
fn direct_checkpoint_activation_refuses_changed_authority_and_rolls_back() {
    let mut db = fixture();
    db.execute_batch("INSERT INTO library_meta VALUES(1,'library','old');")
        .unwrap();
    let before: i64 = db
        .query_row("PRAGMA schema_version", [], |r| r.get(0))
        .unwrap();
    let e = replace_with_normalized_checkpoint_stage_v2(&mut db, "stage")
        .unwrap_err()
        .to_string();
    assert!(e.contains(LIBRARY_TRANSFER_UNAVAILABLE));
    assert_eq!(
        db.query_row::<String, _, _>("SELECT authority_epoch FROM library_meta", [], |r| r.get(0))
            .unwrap(),
        "old"
    );
    assert_eq!(
        db.query_row::<i64, _, _>("PRAGMA schema_version", [], |r| r.get(0))
            .unwrap(),
        before
    );
    assert!(db.is_autocommit());
    db.execute_batch("UPDATE library_meta SET authority_epoch='epoch',library_id='other';")
        .unwrap();
    assert_eq!(
        require_checkpoint_transfer_capability(&db, "stage").unwrap_err(),
        LIBRARY_TRANSFER_UNAVAILABLE
    );
}
