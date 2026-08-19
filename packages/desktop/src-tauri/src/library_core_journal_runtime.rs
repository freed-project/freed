//! Runtime ownership of the Library Core journal.
//!
//! The journal, its verifiers and its one materializer have been merged and
//! tested for some time, but nothing outside their own modules referenced
//! them. Every `LibraryCoreJournal::open` call site sat inside `#[cfg(test)]`,
//! so no installation has ever held a journal database.
//!
//! This module is the first production owner. It resolves the database path,
//! opens the journal into Tauri managed state, and reports what it found.
//!
//! The Desktop SQLite runtime now owns the product rows in this database.
//! Opening and inspecting the journal still grants no signed replication
//! authority, which remains a later activation boundary.
//!
//! This module deliberately establishes nothing. An earlier revision minted a
//! local authority key and enrolled an actor here at startup, which the
//! contract forbids: startup absence never chooses a creator, and a key the
//! app creates and signs proves only that the app possesses the key it just
//! created. Choosing a creator is an explicit owner action, and it belongs to
//! the legacy epoch bootstrap, not to opening a file.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;

use super::library_core_journal::{JournalRuntimeStatus, LibraryCoreJournal};

/// Directory holding the authoritative database, under the app data root.
const JOURNAL_DIRECTORY: &str = "library-core";

/// The database file itself.
const JOURNAL_FILE: &str = "library-core.sqlite";

#[derive(Debug)]
pub(super) enum JournalRuntimeError {
    /// The app data root could not be resolved or created.
    Storage(std::io::Error),
    /// The journal refused to open. Reported verbatim rather than flattened,
    /// because a schema or integrity refusal is the interesting case.
    Journal(String),
    /// Managed state was poisoned by a panic on another thread.
    StatePoisoned,
}

impl std::fmt::Display for JournalRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Storage(error) => write!(formatter, "journal storage unavailable: {error}"),
            Self::Journal(detail) => write!(formatter, "journal refused to open: {detail}"),
            Self::StatePoisoned => write!(formatter, "journal state was poisoned by a panic"),
        }
    }
}

impl From<std::io::Error> for JournalRuntimeError {
    fn from(error: std::io::Error) -> Self {
        Self::Storage(error)
    }
}

type RuntimeResult<T> = Result<T, JournalRuntimeError>;

/// The opened journal, or nothing if it has not been opened yet.
#[derive(Default)]
pub(super) struct LibraryCoreJournalRuntimeState(Mutex<Option<LibraryCoreJournal>>);

/// Where the journal lives beneath an app data root.
pub(super) fn journal_path(base: &Path) -> PathBuf {
    base.join(JOURNAL_DIRECTORY).join(JOURNAL_FILE)
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

/// Opens the journal beneath `base`, replacing any previously held handle.
///
/// Idempotent by construction: a second call reopens the same file and reports
/// the same counts. It never creates actors, operations or authority, so a
/// repeated open cannot advance state.
pub(super) fn open_at_root(
    state: &LibraryCoreJournalRuntimeState,
    base: &Path,
) -> RuntimeResult<JournalRuntimeStatus> {
    let directory = base.join(JOURNAL_DIRECTORY);
    create_private_directory(&directory)?;

    let path = journal_path(base);
    let journal = LibraryCoreJournal::open(&path)
        .map_err(|error| JournalRuntimeError::Journal(error.to_string()))?;
    let status = journal
        .runtime_status()
        .map_err(|error| JournalRuntimeError::Journal(error.to_string()))?;

    let mut held = state
        .0
        .lock()
        .map_err(|_| JournalRuntimeError::StatePoisoned)?;
    *held = Some(journal);
    Ok(status)
}

/// Reports the currently held journal, or `None` if it has not been opened.
pub(super) fn status_of(
    state: &LibraryCoreJournalRuntimeState,
) -> RuntimeResult<Option<JournalRuntimeStatus>> {
    let held = state
        .0
        .lock()
        .map_err(|_| JournalRuntimeError::StatePoisoned)?;
    match held.as_ref() {
        None => Ok(None),
        Some(journal) => journal
            .runtime_status()
            .map(Some)
            .map_err(|error| JournalRuntimeError::Journal(error.to_string())),
    }
}

#[tauri::command]
pub(super) fn open_library_core_journal(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreJournalRuntimeState>,
) -> Result<JournalRuntimeStatus, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    open_at_root(&state, &base).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn library_core_journal_status(
    state: tauri::State<'_, LibraryCoreJournalRuntimeState>,
) -> Result<Option<JournalRuntimeStatus>, String> {
    status_of(&state).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn base() -> TempDir {
        TempDir::new().expect("create app data root")
    }

    #[test]
    fn opening_creates_the_database_under_a_private_directory() {
        let root = base();
        let state = LibraryCoreJournalRuntimeState::default();

        assert!(status_of(&state).expect("status before open").is_none());

        let status = open_at_root(&state, root.path()).expect("open journal");
        assert_eq!(status.schema_version, 10);
        assert_eq!(status.materializer_ingest_sequence, 0);
        assert_eq!(status.actors, 0);
        assert_eq!(status.operations, 0);
        assert_eq!(status.read_state, 0);
        assert_eq!(status.unacknowledged_outbox, 0);

        let path = journal_path(root.path());
        assert!(path.exists(), "journal database must exist after opening");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(path.parent().expect("journal directory"))
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700, "journal directory must not be world readable");
        }
    }

    #[test]
    fn opening_twice_is_idempotent_and_reports_the_same_state() {
        let root = base();
        let state = LibraryCoreJournalRuntimeState::default();

        let first = open_at_root(&state, root.path()).expect("first open");
        let second = open_at_root(&state, root.path()).expect("second open");
        assert_eq!(first, second);

        // Reopening must not have advanced anything. An open that enrolled an
        // actor or wrote an operation would show here.
        assert_eq!(second.actors, 0);
        assert_eq!(second.operations, 0);
    }

    #[test]
    fn status_reflects_the_open_journal_without_reopening_it() {
        let root = base();
        let state = LibraryCoreJournalRuntimeState::default();

        let opened = open_at_root(&state, root.path()).expect("open journal");
        let reported = status_of(&state)
            .expect("status after open")
            .expect("journal is held");
        assert_eq!(opened, reported);
    }

    #[test]
    fn a_fresh_root_starts_empty_so_no_installation_inherits_a_journal() {
        // The reason schema v1 is free to change: nothing has ever created one
        // of these outside a test. A fresh root must therefore always start at
        // zero, and this asserts that rather than leaving it as an argument.
        let root = base();
        let state = LibraryCoreJournalRuntimeState::default();
        assert!(!journal_path(root.path()).exists());

        let status = open_at_root(&state, root.path()).expect("open journal");
        assert_eq!(
            (status.actors, status.operations, status.read_state),
            (0, 0, 0)
        );
    }
}
