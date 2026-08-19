//! Process-lifetime exclusion for one Library Core data root.
//!
//! SQLite coordinates database handles, but it does not decide which Freed
//! process is allowed to act as the Library runtime. Desktop and a future
//! headless service must acquire this lease before opening the database. The
//! kernel-backed lock is the exclusion primitive. The PID stored in the lock
//! file exists only to make a refusal attributable.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PROCESS_LEASE_FILE: &str = "process.lock";
const PROCESS_REFUSAL_DIAGNOSTIC_FILE: &str = "process-last-refusal.json";
const MAX_PROCESS_REFUSAL_DIAGNOSTIC_BYTES: usize = 64 * 1024;
const FREED_DESKTOP_IDENTIFIER: &str = "wtf.freed.desktop";
const LIBRARY_CORE_DIRECTORY: &str = "library-core";

/// Resolve the exact Library Core data root used by Freed Desktop.
///
/// Tauri 2.11.5's desktop `PathResolver::app_data_dir` is implemented as
/// `dirs::data_dir().join(config.identifier)`. This function uses that same
/// pinned crate and formula before Tauri starts. That Tauri desktop method has
/// no platform-specific branch, so macOS, Windows, and Linux share the same
/// formula. The test below also resolves the real checked-in Tauri context
/// through `App::path().app_data_dir()` and requires both results to match on
/// every native test platform.
pub fn freed_desktop_library_core_data_root() -> std::io::Result<PathBuf> {
    dirs::data_dir()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "operating system data directory is unavailable",
            )
        })
        .map(|root| {
            root.join(FREED_DESKTOP_IDENTIFIER)
                .join(LIBRARY_CORE_DIRECTORY)
        })
}

#[derive(Debug)]
pub enum LibraryCoreProcessLeaseError {
    Storage {
        operation: &'static str,
        path: PathBuf,
        source: std::io::Error,
    },
    Held {
        data_root: PathBuf,
        lock_path: PathBuf,
        requester_pid: u32,
        holder_pid: Option<u32>,
        diagnostic_path: PathBuf,
        diagnostic_error: Option<String>,
    },
}

impl std::fmt::Display for LibraryCoreProcessLeaseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Storage {
                operation,
                path,
                source,
            } => write!(
                formatter,
                "Library Core process lease {operation} failed at {}: {source}",
                path.display()
            ),
            Self::Held {
                data_root,
                lock_path,
                requester_pid,
                holder_pid,
                diagnostic_path,
                diagnostic_error,
            } => write!(
                formatter,
                "Library Core data root {} is already leased: requester_pid={requester_pid} holder_pid={} lock_path={} diagnostic_path={} diagnostic_status={}",
                data_root.display(),
                holder_pid
                    .map(|pid| pid.to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                lock_path.display(),
                diagnostic_path.display(),
                diagnostic_error
                    .as_deref()
                    .map(|detail| format!("failed:{detail}"))
                    .unwrap_or_else(|| "persisted".to_string())
            ),
        }
    }
}

impl std::error::Error for LibraryCoreProcessLeaseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Storage { source, .. } => Some(source),
            Self::Held { .. } => None,
        }
    }
}

/// One exclusive OS-backed lease held until this value is dropped.
///
/// Freed Desktop's native entry point holds this value across the complete
/// Tauri run. A future headless runtime can hold the same value in its process
/// root. The lock file is not deleted on exit because replacing a locked inode
/// would allow split holders. Clean unlock truncates the diagnostic PID, while
/// process termination lets the operating system release the lock and leaves a
/// stale PID that the next successful holder atomically replaces.
pub struct LibraryCoreProcessLease {
    lock: fslock::LockFile,
}

impl LibraryCoreProcessLease {
    /// Acquire the sole process lease for an exact Library Core data root.
    pub fn acquire(requested_data_root: &Path) -> Result<Self, LibraryCoreProcessLeaseError> {
        create_private_directory(requested_data_root).map_err(|source| {
            LibraryCoreProcessLeaseError::Storage {
                operation: "data-root creation",
                path: requested_data_root.to_path_buf(),
                source,
            }
        })?;

        let data_root = std::fs::canonicalize(requested_data_root).map_err(|source| {
            LibraryCoreProcessLeaseError::Storage {
                operation: "data-root resolution",
                path: requested_data_root.to_path_buf(),
                source,
            }
        })?;
        let lock_path = data_root.join(PROCESS_LEASE_FILE);
        refuse_symbolic_lock_file(&lock_path)?;

        let mut lock = fslock::LockFile::open(&lock_path).map_err(|source| {
            LibraryCoreProcessLeaseError::Storage {
                operation: "lock-file open",
                path: lock_path.clone(),
                source,
            }
        })?;
        set_private_file_permissions(&lock_path).map_err(|source| {
            LibraryCoreProcessLeaseError::Storage {
                operation: "lock-file permission",
                path: lock_path.clone(),
                source,
            }
        })?;

        let owner_pid = std::process::id();
        let acquired =
            lock.try_lock_with_pid()
                .map_err(|source| LibraryCoreProcessLeaseError::Storage {
                    operation: "OS lock acquisition",
                    path: lock_path.clone(),
                    source,
                })?;
        if !acquired {
            let holder_pid = read_diagnostic_pid(&lock_path);
            let diagnostic_path = data_root.join(PROCESS_REFUSAL_DIAGNOSTIC_FILE);
            let diagnostic_error = persist_refusal_diagnostic(
                &diagnostic_path,
                &data_root,
                &lock_path,
                owner_pid,
                holder_pid,
            )
            .err()
            .map(|error| error.to_string());
            return Err(LibraryCoreProcessLeaseError::Held {
                data_root,
                lock_path: lock_path.clone(),
                requester_pid: owner_pid,
                holder_pid,
                diagnostic_path,
                diagnostic_error,
            });
        }

        Ok(Self { lock })
    }

    pub fn owns_lock(&self) -> bool {
        self.lock.owns_lock()
    }
}

fn read_diagnostic_pid(path: &Path) -> Option<u32> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessRefusalDiagnostic {
    format: &'static str,
    recorded_at_ms: u64,
    requester_pid: u32,
    holder_pid: Option<u32>,
    requester_executable: Option<String>,
    requester_package: &'static str,
    requester_version: &'static str,
    data_root: String,
    lock_path: String,
    reason: &'static str,
}

fn persist_refusal_diagnostic(
    diagnostic_path: &Path,
    data_root: &Path,
    lock_path: &Path,
    requester_pid: u32,
    holder_pid: Option<u32>,
) -> std::io::Result<()> {
    let recorded_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);
    let diagnostic = ProcessRefusalDiagnostic {
        format: "freed_library_core_process_lease_refusal_v1",
        recorded_at_ms,
        requester_pid,
        holder_pid,
        requester_executable: std::env::current_exe()
            .ok()
            .map(|path| path.display().to_string()),
        requester_package: env!("CARGO_PKG_NAME"),
        requester_version: env!("CARGO_PKG_VERSION"),
        data_root: data_root.display().to_string(),
        lock_path: lock_path.display().to_string(),
        reason: "data_root_already_leased",
    };
    let mut bytes = serde_json::to_vec(&diagnostic)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    bytes.push(b'\n');
    if bytes.len() > MAX_PROCESS_REFUSAL_DIAGNOSTIC_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "process refusal diagnostic exceeds its byte limit",
        ));
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(diagnostic_path)?;
    set_private_file_permissions(diagnostic_path)?;
    file.write_all(&bytes)?;
    file.sync_all()
}

fn refuse_symbolic_lock_file(path: &Path) -> Result<(), LibraryCoreProcessLeaseError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(source) => {
            return Err(LibraryCoreProcessLeaseError::Storage {
                operation: "lock-file inspection",
                path: path.to_path_buf(),
                source,
            })
        }
    };
    if metadata.file_type().is_symlink() {
        return Err(LibraryCoreProcessLeaseError::Storage {
            operation: "lock-file safety check",
            path: path.to_path_buf(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "symbolic lock files are forbidden",
            ),
        });
    }
    Ok(())
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;

    if path.exists() {
        return Ok(());
    }
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    const HELPER_TEST_NAME: &str = "library_core_process_lease::tests::lease_helper_process";
    const HELPER_ROOT_ENV: &str = "FREED_TEST_LIBRARY_CORE_LEASE_ROOT";
    const HELPER_OUTCOME_ENV: &str = "FREED_TEST_LIBRARY_CORE_LEASE_OUTCOME";
    const HELPER_RELEASE_ENV: &str = "FREED_TEST_LIBRARY_CORE_LEASE_RELEASE";

    struct HelperProcess {
        child: Child,
        outcome_path: PathBuf,
        release_path: PathBuf,
    }

    impl HelperProcess {
        fn spawn(data_root: &Path, control_root: &Path, name: &str) -> Self {
            std::fs::create_dir_all(control_root).expect("create helper control root");
            let outcome_path = control_root.join(format!("{name}.outcome"));
            let release_path = control_root.join(format!("{name}.release"));
            let child = Command::new(std::env::current_exe().expect("resolve test executable"))
                .arg("--exact")
                .arg(HELPER_TEST_NAME)
                .arg("--nocapture")
                .env(HELPER_ROOT_ENV, data_root)
                .env(HELPER_OUTCOME_ENV, &outcome_path)
                .env(HELPER_RELEASE_ENV, &release_path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn lease helper process");
            Self {
                child,
                outcome_path,
                release_path,
            }
        }

        fn wait_for_outcome(&mut self) -> String {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                if let Ok(outcome) = std::fs::read_to_string(&self.outcome_path) {
                    if outcome.ends_with('\n')
                        && (outcome.starts_with("acquired:") || outcome.starts_with("refused:"))
                    {
                        return outcome;
                    }
                }
                if let Some(status) = self.child.try_wait().expect("inspect helper process") {
                    panic!("lease helper exited before reporting an outcome: {status}");
                }
                assert!(
                    Instant::now() < deadline,
                    "lease helper did not report an outcome"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        fn release_and_wait(&mut self) {
            std::fs::write(&self.release_path, b"release\n").expect("signal helper release");
            let status = self.child.wait().expect("wait for released helper");
            assert!(status.success(), "released helper failed: {status}");
        }

        fn kill_and_wait(&mut self) {
            self.child.kill().expect("kill lease helper");
            let _ = self.child.wait().expect("wait for killed helper");
        }
    }

    impl Drop for HelperProcess {
        fn drop(&mut self) {
            if self.child.try_wait().ok().flatten().is_none() {
                let _ = self.child.kill();
                let _ = self.child.wait();
            }
        }
    }

    fn acquired_pid(outcome: &str) -> u32 {
        outcome
            .trim()
            .strip_prefix("acquired:")
            .expect("helper must acquire the lease")
            .parse::<u32>()
            .expect("helper must report its PID")
    }

    #[test]
    fn lease_helper_process() {
        let Some(data_root) = std::env::var_os(HELPER_ROOT_ENV).map(PathBuf::from) else {
            return;
        };
        let outcome_path = PathBuf::from(
            std::env::var_os(HELPER_OUTCOME_ENV).expect("helper outcome path is required"),
        );
        let release_path = PathBuf::from(
            std::env::var_os(HELPER_RELEASE_ENV).expect("helper release path is required"),
        );

        match LibraryCoreProcessLease::acquire(&data_root) {
            Ok(lease) => {
                std::fs::write(outcome_path, format!("acquired:{}\n", std::process::id()))
                    .expect("write acquired outcome");
                let deadline = Instant::now() + Duration::from_secs(20);
                while !release_path.exists() {
                    assert!(
                        Instant::now() < deadline,
                        "helper lease was not released in time"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                drop(lease);
            }
            Err(error) => {
                std::fs::write(outcome_path, format!("refused:{error}\n"))
                    .expect("write refused outcome");
            }
        }
    }

    #[test]
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
    fn two_processes_get_exactly_one_holder_with_attributable_refusal() {
        let temp = tempfile::tempdir().expect("create test root");
        let data_root = temp.path().join("library-core");
        let control_root = temp.path().join("control");

        let mut holder = HelperProcess::spawn(&data_root, &control_root, "holder");
        let holder_pid = acquired_pid(&holder.wait_for_outcome());
        let mut contender = HelperProcess::spawn(&data_root, &control_root, "contender");
        let refusal = contender.wait_for_outcome();
        let contender_status = contender.child.wait().expect("wait for refused contender");

        assert!(contender_status.success(), "contender helper failed");
        assert!(
            refusal.starts_with("refused:"),
            "second process must fail closed"
        );
        assert!(refusal.contains(&format!("holder_pid={holder_pid}")));
        assert!(refusal.contains(&data_root.canonicalize().unwrap().display().to_string()));
        assert!(refusal.contains(PROCESS_LEASE_FILE));
        let diagnostic_path = data_root.join(PROCESS_REFUSAL_DIAGNOSTIC_FILE);
        let diagnostic_raw = std::fs::read(&diagnostic_path).expect("read refusal diagnostic");
        assert!(diagnostic_raw.len() <= MAX_PROCESS_REFUSAL_DIAGNOSTIC_BYTES);
        let diagnostic: serde_json::Value =
            serde_json::from_slice(&diagnostic_raw).expect("parse refusal diagnostic");
        assert_eq!(
            diagnostic["format"],
            "freed_library_core_process_lease_refusal_v1"
        );
        assert_eq!(diagnostic["holderPid"], holder_pid);
        assert_ne!(diagnostic["requesterPid"], holder_pid);
        assert_eq!(diagnostic["reason"], "data_root_already_leased");
        assert_eq!(
            diagnostic["dataRoot"],
            data_root.canonicalize().unwrap().display().to_string()
        );
        assert_eq!(
            diagnostic["lockPath"],
            data_root
                .canonicalize()
                .unwrap()
                .join(PROCESS_LEASE_FILE)
                .display()
                .to_string()
        );
        assert_eq!(diagnostic["requesterPackage"], env!("CARGO_PKG_NAME"));
        assert!(diagnostic["requesterExecutable"].as_str().is_some());
        assert!(
            holder.child.try_wait().unwrap().is_none(),
            "holder must stay alive"
        );

        holder.release_and_wait();
    }

    #[test]
    fn repeated_refusals_overwrite_one_bounded_diagnostic() {
        let temp = tempfile::tempdir().expect("create test root");
        let data_root = temp.path().join("library-core");
        let control_root = temp.path().join("control");

        let mut holder = HelperProcess::spawn(&data_root, &control_root, "holder");
        acquired_pid(&holder.wait_for_outcome());

        let mut first = HelperProcess::spawn(&data_root, &control_root, "first-refusal");
        assert!(first.wait_for_outcome().starts_with("refused:"));
        assert!(first.child.wait().unwrap().success());
        let diagnostic_path = data_root.join(PROCESS_REFUSAL_DIAGNOSTIC_FILE);
        let first_diagnostic: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&diagnostic_path).expect("read first refusal diagnostic"),
        )
        .expect("parse first refusal diagnostic");

        let mut second = HelperProcess::spawn(&data_root, &control_root, "second-refusal");
        assert!(second.wait_for_outcome().starts_with("refused:"));
        assert!(second.child.wait().unwrap().success());
        let second_raw = std::fs::read(&diagnostic_path).expect("read second refusal diagnostic");
        assert!(second_raw.len() <= MAX_PROCESS_REFUSAL_DIAGNOSTIC_BYTES);
        let second_diagnostic: serde_json::Value =
            serde_json::from_slice(&second_raw).expect("parse second refusal diagnostic");
        assert_ne!(
            first_diagnostic["requesterPid"],
            second_diagnostic["requesterPid"]
        );

        let mut entries = std::fs::read_dir(&data_root)
            .expect("read data root")
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        entries.sort();
        assert_eq!(
            entries,
            vec![
                PROCESS_REFUSAL_DIAGNOSTIC_FILE.to_string(),
                PROCESS_LEASE_FILE.to_string(),
            ]
        );

        holder.release_and_wait();
    }

    #[test]
    fn clean_process_release_allows_the_next_holder() {
        let temp = tempfile::tempdir().expect("create test root");
        let data_root = temp.path().join("library-core");
        let control_root = temp.path().join("control");

        let mut first = HelperProcess::spawn(&data_root, &control_root, "first");
        acquired_pid(&first.wait_for_outcome());
        first.release_and_wait();
        assert_eq!(
            std::fs::read_to_string(data_root.join(PROCESS_LEASE_FILE))
                .expect("read released lock")
                .trim(),
            ""
        );

        let mut second = HelperProcess::spawn(&data_root, &control_root, "second");
        acquired_pid(&second.wait_for_outcome());
        second.release_and_wait();
    }

    #[test]
    fn killed_process_leaves_only_stale_diagnostics_and_the_os_releases_the_lock() {
        let temp = tempfile::tempdir().expect("create test root");
        let data_root = temp.path().join("library-core");
        let control_root = temp.path().join("control");

        let mut crashed = HelperProcess::spawn(&data_root, &control_root, "crashed");
        let crashed_pid = acquired_pid(&crashed.wait_for_outcome());
        crashed.kill_and_wait();
        assert_eq!(
            read_diagnostic_pid(&data_root.join(PROCESS_LEASE_FILE)),
            Some(crashed_pid),
            "a killed process may leave diagnostic text, but not an OS lock"
        );

        let mut recovered = HelperProcess::spawn(&data_root, &control_root, "recovered");
        let recovered_pid = acquired_pid(&recovered.wait_for_outcome());
        assert_ne!(recovered_pid, crashed_pid);
        assert_eq!(
            read_diagnostic_pid(&data_root.join(PROCESS_LEASE_FILE)),
            Some(recovered_pid),
            "the new holder must replace stale PID diagnostics"
        );
        recovered.release_and_wait();
    }

    #[test]
    fn lease_control_files_never_create_or_transport_sqlite_sidecars() {
        let temp = tempfile::tempdir().expect("create test root");
        let data_root = temp.path().join("library-core");
        let lease = LibraryCoreProcessLease::acquire(&data_root).expect("acquire lease");

        assert!(lease.owns_lock());
        let entries = std::fs::read_dir(&data_root)
            .expect("read data root")
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(entries, vec![PROCESS_LEASE_FILE.to_string()]);
        assert!(entries.iter().all(|name| {
            !name.ends_with(".sqlite")
                && !name.ends_with("-wal")
                && !name.ends_with("-shm")
                && !name.ends_with("-journal")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn lease_files_are_private() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().expect("create test root");
        let data_root = temp.path().join("library-core");
        let lease = LibraryCoreProcessLease::acquire(&data_root).expect("acquire lease");
        assert!(lease.owns_lock());
        let root_mode = std::fs::metadata(&data_root).unwrap().permissions().mode() & 0o777;
        let lock_mode = std::fs::metadata(data_root.join(PROCESS_LEASE_FILE))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(root_mode, 0o700);
        assert_eq!(lock_mode, 0o600);
    }
}
