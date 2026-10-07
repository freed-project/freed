//! Cooperative cancellation for dedicated, read-only query connections.
use rusqlite::Connection;
use std::{
    cell::RefCell,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

thread_local! {
    static CURRENT: RefCell<Option<Arc<NormalizedQueryControl>>> = const { RefCell::new(None) };
}

pub struct NormalizedQueryControl {
    cancelled: AtomicBool,
    deadline: Instant,
}
impl NormalizedQueryControl {
    pub fn new(deadline: Instant) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            deadline,
        }
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
    pub fn check(&self) -> Result<(), &'static str> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("QUERY_CANCELLED")
        } else if Instant::now() >= self.deadline {
            Err("QUERY_DEADLINE")
        } else {
            Ok(())
        }
    }
}

/// Used between bounded CPU verification units as well as SQLite VM work.
/// Writers never install a query scope and cannot inherit its cancellation.
pub(crate) fn check_current_query() -> Result<(), &'static str> {
    CURRENT.with(|current| {
        current
            .borrow()
            .as_ref()
            .map_or(Ok(()), |control| control.check())
    })
}

struct QueryScope;
impl Drop for QueryScope {
    fn drop(&mut self) {
        CURRENT.with(|current| *current.borrow_mut() = None);
    }
}

pub fn query_normalized_json_with_control_v1(
    connection: Connection,
    request: serde_json::Value,
    control: Arc<NormalizedQueryControl>,
) -> Result<serde_json::Value, String> {
    run_controlled_read(connection, control, |connection| {
        crate::query_normalized_json_v1(connection, request).map_err(|error| error.to_string())
    })
}

pub(crate) fn query_with_content_control(
    connection: Connection, request: serde_json::Value, control: Arc<NormalizedQueryControl>,
    read: &crate::annotation_text::RangeReader<'_>,
) -> Result<serde_json::Value, String> {
    run_controlled_read(connection, control, |connection| {
        crate::normalized_query::query_normalized_json_with_content(connection, request, Some(read)).map_err(|error| error.to_string())
    })
}

/// A fresh logical-state commitment, not an installed checkpoint receipt.
/// Device-local queues, recovery archives and content caches are excluded by
/// the existing logical exporter. This receipt grants no writer authority.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedReplicaAuditV1 {
    pub format: String,
    pub snapshot: crate::NormalizedCheckpointExportDescriptorV2,
    pub checkpoint_digest: String,
}

/// Audit a dedicated replica reader at one snapshot without exporting records
/// to the host. The host owns registration, deadline and cancellation admission.
pub fn audit_normalized_replica_with_control_v1(
    connection: Connection,
    control: Arc<NormalizedQueryControl>,
) -> Result<NormalizedReplicaAuditV1, String> {
    run_controlled_read(connection, control, |connection| {
        let snapshot = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let descriptor = crate::describe_normalized_checkpoint_export_v2(&snapshot)
            .map_err(|error| error.to_string())?;
        let checkpoint_digest = crate::normalized_import::selected_checkpoint_digest_v2(&snapshot)
            .map_err(|error| error.to_string())?;
        check_current_query()?;
        snapshot.commit().map_err(|error| error.to_string())?;
        Ok(NormalizedReplicaAuditV1 {
            format: "freed_normalized_replica_audit_v1".into(),
            snapshot: descriptor,
            checkpoint_digest,
        })
    })
}

fn run_controlled_read<T>(
    mut connection: Connection,
    control: Arc<NormalizedQueryControl>,
    read: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    control.check()?;
    if !connection.is_autocommit() {
        return Err(
            "controlled query requires a dedicated connection without a transaction".into(),
        );
    }
    CURRENT.with(|current| {
        let mut current = current.borrow_mut();
        if current.is_some() {
            return Err("nested controlled query is forbidden".to_owned());
        }
        *current = Some(Arc::clone(&control));
        Ok(())
    })?;
    let _scope = QueryScope;
    // This connection is owned by this read only. Dropping it releases its
    // snapshot and callback even on panic; no writer connection is interrupted.
    connection
        .pragma_update(None, "query_only", true)
        .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(|error| error.to_string())?;
    let progress = Arc::clone(&control);
    connection.progress_handler(1000, Some(move || progress.check().is_err()));
    let result = read(&mut connection);
    control.check()?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replica_audit_binds_current_snapshot_without_mutation_or_writer_admission() {
        let (mut connection, _, _) = crate::normalized_mutation::tests::fixture();
        connection
            .execute("DELETE FROM library_writer_admission", [])
            .unwrap();
        assert!(crate::normalized_primary_mutation_context_v1(&connection).is_err());
        let expected = {
            let tx = connection.transaction().unwrap();
            let descriptor = crate::describe_normalized_checkpoint_export_v2(&tx).unwrap();
            let digest = crate::normalized_import::selected_checkpoint_digest_v2(&tx).unwrap();
            tx.commit().unwrap();
            (descriptor, digest)
        };
        // Preserve an independent copy so the receipt can be compared against
        // the existing exporter, not a second audit of its own output.
        let mut preserved = Connection::open_in_memory().unwrap();
        rusqlite::backup::Backup::new(&connection, &mut preserved)
            .unwrap()
            .run_to_completion(128, Duration::ZERO, None)
            .unwrap();
        let control = Arc::new(NormalizedQueryControl::new(
            Instant::now() + Duration::from_secs(30),
        ));
        let receipt = audit_normalized_replica_with_control_v1(connection, control).unwrap();
        assert_eq!(receipt.snapshot, expected.0);
        assert_eq!(receipt.checkpoint_digest, expected.1);
        assert_eq!(receipt.format, "freed_normalized_replica_audit_v1");
        let cancelled = Arc::new(NormalizedQueryControl::new(
            Instant::now() + Duration::from_secs(30),
        ));
        cancelled.cancel();
        assert_eq!(
            audit_normalized_replica_with_control_v1(preserved, cancelled).unwrap_err(),
            "QUERY_CANCELLED"
        );
        assert_eq!(check_current_query(), Ok(()));
    }

    #[test]
    fn deadline_and_cancellation_interrupt_sql_and_release_the_read_scope() {
        for expired in [false, true] {
            let control = Arc::new(NormalizedQueryControl::new(if expired {
                Instant::now() - Duration::from_secs(1)
            } else {
                Instant::now() + Duration::from_secs(30)
            }));
            if !expired {
                control.cancel();
            }
            let error = run_controlled_read(
                Connection::open_in_memory().unwrap(),
                control,
                |_| -> Result<(), String> { panic!("stopped query must not execute") },
            )
            .unwrap_err();
            assert_eq!(
                error,
                if expired {
                    "QUERY_DEADLINE"
                } else {
                    "QUERY_CANCELLED"
                }
            );
        }
        let control = Arc::new(NormalizedQueryControl::new(
            Instant::now() + Duration::from_secs(30),
        ));
        let cancel = Arc::clone(&control);
        let error = run_controlled_read(Connection::open_in_memory().unwrap(), control, |connection| {
            cancel.cancel();
            assert_eq!(check_current_query(), Err("QUERY_CANCELLED"));
            let result = connection.query_row("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000) SELECT sum(x) FROM n", [], |row| row.get::<_, i64>(0));
            assert_eq!(result.as_ref().unwrap_err().sqlite_error_code(), Some(rusqlite::ErrorCode::OperationInterrupted));
            result.map_err(|error| error.to_string())
        }).unwrap_err();
        assert_eq!(error, "QUERY_CANCELLED");
        assert_eq!(check_current_query(), Ok(()));
        let control = Arc::new(NormalizedQueryControl::new(
            Instant::now() + Duration::from_secs(30),
        ));
        assert!(run_controlled_read(
            Connection::open_in_memory().unwrap(),
            control,
            |connection| {
                connection
                    .execute_batch("CREATE TABLE forbidden (id INTEGER)")
                    .map_err(|error| error.to_string())
            }
        )
        .is_err());
        assert_eq!(check_current_query(), Ok(()));
    }
}
