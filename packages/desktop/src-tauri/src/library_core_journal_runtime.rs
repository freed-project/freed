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
//! Automerge remains authoritative. Opening a database and counting rows
//! changes no user-visible behaviour and grants no write authority; it is the
//! call path the shadow slice needs before any operation can be written.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;

use super::library_core_actor_enrollment::{
    enroll_desktop_actor, EnrollmentAuthority, PlatformActorKeyStore,
};
use super::library_core_authority_genesis::{
    establish_genesis_epoch, load_established_authority_key_pair, LegacySourceRevision,
};
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

/// What the caller reports about the exact durable Automerge revision the
/// genesis epoch should be bound to.
///
/// These are the fields of the renderer's `LibraryCoreProjectionSourceV1`,
/// which the Automerge worker only produces when the in-memory document's
/// heads equal the durable snapshot's heads.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GenesisSourceRequest {
    document_id: String,
    heads_digest: String,
    head_count: u64,
    storage_generation: u64,
    storage_save_revision: u64,
}

/// What was established, for the caller to log. No key material, and no
/// certificates: those stay in the journal.
#[derive(Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GenesisAuthorityStatus {
    pub(super) library_id: String,
    pub(super) epoch: i64,
    pub(super) epoch_id: String,
    pub(super) authority_key_id: String,
    pub(super) actor_id: String,
    /// The sequence this actor's next operation would take. 1 means it has
    /// written nothing, which is the only value this path can produce.
    pub(super) next_sequence: i64,
}

/// Establishes this installation's Library Core identity against the held
/// journal: the genesis authority epoch, then its own enrolled actor.
///
/// One step, because an epoch with no actor can write nothing and an actor
/// cannot exist without an epoch. Both halves are idempotent, so a call that
/// fails after the epoch lands completes the actor on the next attempt.
///
/// Requires the journal to be open already, so a caller cannot establish
/// authority against a database that was never validated on open. Replaying
/// the same revision returns the same epoch and the same actor rather than
/// writing again.
pub(super) fn establish_genesis_at(
    state: &LibraryCoreJournalRuntimeState,
    request: &GenesisSourceRequest,
    accepted_at_ms: i64,
) -> RuntimeResult<GenesisAuthorityStatus> {
    let mut held = state
        .0
        .lock()
        .map_err(|_| JournalRuntimeError::StatePoisoned)?;
    let journal = held
        .as_mut()
        .ok_or_else(|| JournalRuntimeError::Journal("journal is not open".to_string()))?;

    let authority = establish_genesis_epoch(
        journal,
        &LegacySourceRevision {
            document_id: request.document_id.clone(),
            heads_digest: request.heads_digest.clone(),
            head_count: request.head_count,
            storage_generation: request.storage_generation,
            storage_save_revision: request.storage_save_revision,
        },
        accepted_at_ms,
    )
    .map_err(JournalRuntimeError::Journal)?;

    let enrollment_authority = EnrollmentAuthority {
        library_id: authority.library_id.clone(),
        epoch: authority.epoch,
        epoch_id: authority.epoch_id.clone(),
        authority_key_id: authority.authority_key_id.clone(),
    };
    // Loaded, never minted: the epoch above was signed by this exact key, and
    // a second authority identity could not countersign an enrollment the
    // journal would accept.
    let authority_key_pair = load_established_authority_key_pair(&authority.library_id)
        .map_err(JournalRuntimeError::Journal)?;
    let actor = enroll_desktop_actor(
        journal,
        &enrollment_authority,
        &PlatformActorKeyStore,
        &authority_key_pair,
        accepted_at_ms,
    )
    .map_err(JournalRuntimeError::Journal)?;

    Ok(GenesisAuthorityStatus {
        library_id: authority.library_id,
        epoch: authority.epoch,
        epoch_id: authority.epoch_id,
        authority_key_id: authority.authority_key_id,
        actor_id: actor.actor_id,
        next_sequence: actor.next_sequence,
    })
}

#[tauri::command]
pub(super) fn establish_library_core_genesis_authority(
    state: tauri::State<'_, LibraryCoreJournalRuntimeState>,
    source: GenesisSourceRequest,
) -> Result<GenesisAuthorityStatus, String> {
    let accepted_at_ms = i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "system clock is before the Unix epoch".to_string())?
            .as_millis(),
    )
    .map_err(|_| "system clock exceeds the supported range".to_string())?;
    establish_genesis_at(&state, &source, accepted_at_ms).map_err(|error| error.to_string())
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
        assert_eq!(status.schema_version, 1);
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

    /// Establishing authority against a database that never validated on open
    /// would be writing an authority chain into an unknown store.
    #[test]
    fn genesis_authority_is_refused_before_the_journal_is_open() {
        let state = LibraryCoreJournalRuntimeState::default();
        let request = GenesisSourceRequest {
            document_id: "freed-library-document-1".to_string(),
            heads_digest: "a".repeat(64),
            head_count: 2,
            storage_generation: 7,
            storage_save_revision: 11,
        };

        let error = establish_genesis_at(&state, &request, 1_700)
            .expect_err("authority must require an open journal");

        assert!(error.to_string().contains("journal is not open"), "{error}");
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
