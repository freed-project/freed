//! Freed Desktop path and identity adapter for the native process lease.

use std::path::{Path, PathBuf};

#[cfg(not(feature = "isolated-preview-data-root"))]
const FREED_DESKTOP_IDENTIFIER: &str = "wtf.freed.desktop";
#[cfg(feature = "isolated-preview-data-root")]
const FREED_DESKTOP_IDENTIFIER: &str = "wtf.freed.desktop.sqlite-native-preview";
const LIBRARY_CORE_DIRECTORY: &str = "library-core";
const DESKTOP_IDENTITY: freed_library_core::ProcessLeaseIdentity<'static> =
    freed_library_core::ProcessLeaseIdentity::new(
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
    );

/// Resolve the same pre-Tauri data root used by Tauri's path resolver.
pub fn freed_desktop_library_core_data_root() -> std::io::Result<PathBuf> {
    dirs::data_dir()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "operating system data directory is unavailable",
            )
        })
        .and_then(|root| {
            Ok(root
                .join(preview_identifier()?)
                .join(LIBRARY_CORE_DIRECTORY))
        })
}

fn preview_identifier() -> std::io::Result<String> {
    #[cfg(feature = "isolated-preview-data-root")]
    if let Some(config) = option_env!("TAURI_CONFIG") {
        return identifier_from_preview_config(config);
    }
    Ok(FREED_DESKTOP_IDENTIFIER.to_owned())
}

#[cfg(feature = "isolated-preview-data-root")]
fn identifier_from_preview_config(config: &str) -> std::io::Result<String> {
    let config: serde_json::Value = serde_json::from_str(config).map_err(|error| {
        std::io::Error::other(format!("Invalid compiled preview config: {error}"))
    })?;
    let Some(identifier) = config.get("identifier").and_then(serde_json::Value::as_str) else {
        return Ok(FREED_DESKTOP_IDENTIFIER.to_owned());
    };
    let allowed = identifier == FREED_DESKTOP_IDENTIFIER
        || identifier
            .strip_prefix("wtf.freed.desktop.preview.")
            .is_some_and(|suffix| !suffix.is_empty());
    if !allowed
        || identifier.len() > 128
        || !identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
    {
        return Err(std::io::Error::other(
            "Isolated preview refuses a non-preview identifier",
        ));
    }
    Ok(identifier.to_owned())
}

/// Desktop-owned lease wrapper held for the complete Tauri process lifetime.
pub struct LibraryCoreProcessLease {
    #[cfg(unix)]
    installed: bool,
    #[cfg(not(unix))]
    _lease: freed_library_core::LibraryCoreProcessLease,
}

impl LibraryCoreProcessLease {
    pub fn acquire(
        requested_data_root: &Path,
    ) -> Result<Self, freed_library_core::LibraryCoreProcessLeaseError> {
        #[cfg(unix)]
        {
            let app_root = requested_data_root.parent().ok_or_else(|| {
                binding_error(
                    requested_data_root,
                    "Freed Desktop Library Core data root has no app root",
                )
            })?;
            let binding =
                freed_library_core::LibraryCoreDesktopBinding::open(app_root, DESKTOP_IDENTITY)
                    .map_err(|error| binding_error(app_root, &error.to_string()))?;
            freed_library_core::install_desktop_binding(binding)
                .map_err(|error| binding_error(app_root, &error.to_string()))?;
            Ok(Self { installed: true })
        }
        #[cfg(not(unix))]
        {
            let app_root = requested_data_root.parent().ok_or_else(|| {
                freed_library_core::LibraryCoreProcessLeaseError::Storage {
                    operation: "bind",
                    path: requested_data_root.to_path_buf(),
                    source: std::io::Error::other(
                        "Freed Desktop Library Core data root has no app root",
                    ),
                }
            })?;
            let lease =
                freed_library_core::LibraryCoreProcessLease::acquire(app_root, DESKTOP_IDENTITY)?;
            // Same pre-Tauri app root and normalized path used by the runtime.
            // Keep this lease alive through every bounded slice and after READY.
            let database = app_root.join("library-sqlite").join("library-core.sqlite");
            freed_library_core::initialize_owned_normalized_sqlite_database_with_observer_v1(
                &database,
                false,
                || {
                    #[cfg(all(test, windows))]
                    tests::pause_committed_annotation_slice(&database);
                },
            )
            .map_err(|error| {
                freed_library_core::LibraryCoreProcessLeaseError::Storage {
                    operation: "annotation startup",
                    path: database,
                    source: std::io::Error::other(error.to_string()),
                }
            })?;
            Ok(Self { _lease: lease })
        }
    }

    pub fn owns_lock(&self) -> bool {
        #[cfg(unix)]
        {
            self.installed
        }
        #[cfg(not(unix))]
        {
            self._lease.owns_lock()
        }
    }
}

#[cfg(unix)]
fn binding_error(path: &Path, detail: &str) -> freed_library_core::LibraryCoreProcessLeaseError {
    freed_library_core::LibraryCoreProcessLeaseError::Storage {
        operation: "bind",
        path: path.to_path_buf(),
        source: std::io::Error::other(detail.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    pub(super) fn pause_committed_annotation_slice(database: &Path) {
        let Some(signal) = std::env::var_os("FREED_TEST_WINDOWS_ANNOTATION_PAUSE") else {
            return;
        };
        let db = rusqlite::Connection::open(database).unwrap();
        let version: u32 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        if !matches!(version, 4 | 5) {
            return;
        }
        let (phase, scanned): (String, i64) = db
            .query_row(
                "SELECT phase,scanned_members FROM library_local_annotation_migration",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        if phase != "building" || scanned == 0 {
            return;
        }
        drop(db);
        std::fs::write(signal, b"committed-building").unwrap();
        // Only this test binary pauses. The real wrapper still holds its lease.
        loop {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }

    #[cfg(windows)]
    mod windows_annotation {
        use super::*;
        use rusqlite::Connection;
        use std::{
            fs,
            process::{Child, Command},
            time::{Duration, Instant},
        };

        struct ChildOwner(Child);
        impl Drop for ChildOwner {
            fn drop(&mut self) {
                if self.0.try_wait().ok().flatten().is_none() {
                    let _ = self.0.kill();
                }
                let _ = self.0.wait();
            }
        }
        fn spawn(root: &Path, signal: &Path, pause: bool) -> ChildOwner {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "library_core_process_lease::tests::windows_annotation::wrapper_child",
                    "--nocapture",
                ])
                .env("FREED_TEST_WINDOWS_ANNOTATION_ROOT", root)
                .env("FREED_TEST_WINDOWS_ANNOTATION_SIGNAL", signal)
                .env_remove("FREED_TEST_WINDOWS_ANNOTATION_PAUSE");
            if pause {
                command.env("FREED_TEST_WINDOWS_ANNOTATION_PAUSE", signal);
            }
            ChildOwner(command.spawn().unwrap())
        }
        fn wait_signal(child: &mut ChildOwner, signal: &Path) {
            let deadline = Instant::now() + Duration::from_secs(30);
            while !signal.exists() {
                assert!(
                    child.0.try_wait().unwrap().is_none(),
                    "owner exited before its barrier"
                );
                assert!(Instant::now() < deadline, "owner did not reach its barrier");
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        fn state(db: &Connection) -> (String, String, i64, Vec<(String, String, i64)>) {
            let (pin, phase, scanned) = db.query_row(
                "SELECT pinned_identity,phase,scanned_members FROM library_local_annotation_migration", [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).unwrap();
            let markers = db.prepare("SELECT entity_id,transaction_id,member_index FROM library_local_annotation_unresolved ORDER BY entity_id,transaction_id,member_index")
                .unwrap().query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap().collect::<Result<Vec<_>, _>>().unwrap();
            (pin, phase, scanned, markers)
        }
        #[test]
        fn wrapper_child() {
            let Some(root) = std::env::var_os("FREED_TEST_WINDOWS_ANNOTATION_ROOT") else {
                return;
            };
            let _owner =
                LibraryCoreProcessLease::acquire(&Path::new(&root).join("library-core")).unwrap();
            assert!(_owner.owns_lock());
            fs::write(
                std::env::var_os("FREED_TEST_WINDOWS_ANNOTATION_SIGNAL").unwrap(),
                b"ready",
            )
            .unwrap();
            loop {
                std::thread::sleep(Duration::from_millis(25));
            }
        }
        #[test]
        fn wrapper_resumes_committed_building_after_kill_under_same_lease() {
            use freed_library_core::sqlite_contract_generated::{
                NORMALIZED_NATIVE_SCHEMA_EXTENSION_SQL, NORMALIZED_NATIVE_SCHEMA_SHA256,
            };
            for source in [1, 2] {
                let fixture = tempfile::tempdir().unwrap();
                let root = fixture.path().join("app");
                let path = root.join("library-sqlite/library-core.sqlite");
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                let db = Connection::open(&path).unwrap();
                freed_library_core::install_normalized_schema_v1(&db).unwrap();
                if source == 2 {
                    db.execute_batch(NORMALIZED_NATIVE_SCHEMA_EXTENSION_SQL)
                        .unwrap();
                    db.execute(
                        "UPDATE library_storage_meta SET schema_version=2,schema_sha256=?1",
                        [NORMALIZED_NATIVE_SCHEMA_SHA256],
                    )
                    .unwrap();
                    db.pragma_update(None, "user_version", 2).unwrap();
                }
                db.execute_batch(include_str!(
                    "../../../shared/src/library-core/annotation-backfill-fixture-v1.sql"
                ))
                .unwrap();
                drop(db);
                let signal = fixture.path().join("paused");
                let mut child = spawn(&root, &signal, true);
                wait_signal(&mut child, &signal);
                assert_eq!(fs::read(&signal).unwrap(), b"committed-building");
                let db = Connection::open(&path).unwrap();
                let before = state(&db);
                assert_eq!(before.1, "building");
                assert!(before.2 > 0 && before.2 < 1025);
                assert!(LibraryCoreProcessLease::acquire(&root.join("library-core")).is_err());
                assert!(
                    freed_library_core::open_normalized_sqlite_database_v1(&path, false).is_err()
                );
                assert_eq!(state(&db), before, "refused opens cannot advance migration");
                child.0.kill().unwrap();
                child.0.wait().unwrap();
                assert_eq!(
                    state(&db),
                    before,
                    "committed prefix survives process death"
                );
                drop(db);
                let owner = LibraryCoreProcessLease::acquire(&root.join("library-core")).unwrap();
                assert!(owner.owns_lock());
                assert!(LibraryCoreProcessLease::acquire(&root.join("library-core")).is_err());
                let db =
                    freed_library_core::open_normalized_sqlite_database_v1(&path, false).unwrap();
                assert_eq!(db.total_changes(), 0);
                let after = state(&db);
                assert_eq!(after.0, before.0);
                assert_eq!(after.1, "ready");
                assert_eq!(after.2, 1025);
                let mut expected: Vec<_> = (258..=1025)
                    .map(|n| (format!("item:{n}"), format!("transaction:{n:04}"), 0_i64))
                    .collect();
                expected.sort();
                assert_eq!(after.3, expected);
                assert!(before.3.iter().all(|marker| after.3.contains(marker)));
                assert_eq!(
                    db.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                        .unwrap(),
                    source + 3
                );
                drop(db);
                drop(owner);
            }
        }
        #[test]
        fn wrapper_absence_and_failure_release_preserve_storage() {
            let fixture = tempfile::tempdir().unwrap();
            let root = fixture.path().join("app");
            let path = root.join("library-sqlite/library-core.sqlite");
            let requested = root.join("library-core");
            let owner = LibraryCoreProcessLease::acquire(&requested).unwrap();
            assert!(!path.exists());
            assert!(!path.parent().unwrap().exists());
            drop(owner);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"not a SQLite database").unwrap();
            assert!(LibraryCoreProcessLease::acquire(&requested).is_err());
            assert_eq!(fs::read(&path).unwrap(), b"not a SQLite database");
            // Failed startup must release the very same app-root ownership lock.
            let lease =
                freed_library_core::LibraryCoreProcessLease::acquire(&root, DESKTOP_IDENTITY)
                    .unwrap();
            assert!(lease.owns_lock());
            drop(lease);
        }
    }

    #[test]
    #[cfg(not(feature = "isolated-preview-data-root"))]
    fn desktop_data_root_matches_tauri_path_resolution() {
        use tauri::Manager;

        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("build mock app from the checked-in Tauri context");
        let tauri_data_root = app
            .path()
            .app_data_dir()
            .expect("resolve Tauri app data root")
            .join(LIBRARY_CORE_DIRECTORY);
        assert_eq!(
            freed_desktop_library_core_data_root().expect("resolve pre-Tauri data root"),
            tauri_data_root
        );
    }

    #[test]
    #[cfg(feature = "isolated-preview-data-root")]
    fn isolated_preview_uses_a_closed_nonproduction_data_root() {
        assert_eq!(
            freed_desktop_library_core_data_root().expect("resolve preview data root"),
            dirs::data_dir()
                .expect("resolve operating system data directory")
                .join(preview_identifier().expect("compiled preview identifier"))
                .join(LIBRARY_CORE_DIRECTORY)
        );
    }
    #[test]
    #[cfg(feature = "isolated-preview-data-root")]
    fn preview_config_accepts_fresh_profiles_and_refuses_primary_or_path_injection() {
        assert_eq!(
            identifier_from_preview_config(
                r#"{"identifier":"wtf.freed.desktop.preview.gliclass20261002"}"#
            )
            .unwrap(),
            "wtf.freed.desktop.preview.gliclass20261002"
        );
        for identifier in [
            "wtf.freed.desktop",
            "other.app",
            "wtf.freed.desktop.preview.",
            "wtf.freed.desktop.preview../primary",
            "wtf.freed.desktop.preview.a/../../primary",
        ] {
            assert!(identifier_from_preview_config(
                &serde_json::json!({"identifier": identifier}).to_string()
            )
            .is_err());
        }
        assert!(identifier_from_preview_config("not-json").is_err());
    }
}
