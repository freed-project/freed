//! Dormant Tauri writer boundary for query-specific SQLite browse generations.
//!
//! Automerge remains authoritative. These commands only stage one worker-
//! authenticated generation at a time. No product caller selects or reads it.

use crate::library_core_feed_browse_store::{
    ExistingFeedBrowseGeneration, FeedBrowseGenerationBinding, FeedBrowseGenerationProgress,
    FeedBrowseGenerationState, FeedBrowseGenerationStore, FeedBrowseProjectedRow,
    PublishedFeedBrowseGeneration,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const ROOT_DIRECTORY: &str = "library-core-feed-browse-v1";
const GENERATION_DIRECTORY: &str = "generations";
const MAXIMUM_SESSION_ID_BYTES: usize = 128;

#[derive(Debug)]
enum BrowseRuntimeError {
    Io(std::io::Error),
    Store(crate::library_core_feed_browse_store::FeedBrowseStoreError),
    Invalid(&'static str),
    ActiveMismatch,
    StatePoisoned,
}

impl From<std::io::Error> for BrowseRuntimeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<crate::library_core_feed_browse_store::FeedBrowseStoreError> for BrowseRuntimeError {
    fn from(error: crate::library_core_feed_browse_store::FeedBrowseStoreError) -> Self {
        Self::Store(error)
    }
}

impl fmt::Display for BrowseRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "browse generation path error: {error}"),
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Invalid(field) => write!(formatter, "invalid browse generation {field}"),
            Self::ActiveMismatch => {
                formatter.write_str("browse request does not match the active generation")
            }
            Self::StatePoisoned => {
                formatter.write_str("browse generation runtime state is unavailable")
            }
        }
    }
}

type RuntimeResult<T> = Result<T, BrowseRuntimeError>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BrowseGenerationBatchInputV1 {
    session_id: String,
    batch_index: i64,
    rows: Vec<FeedBrowseProjectedRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowseGenerationStatusV1 {
    generation_id: String,
    next_batch_index: i64,
    written_rows: i64,
    total_rows: i64,
    complete: bool,
    sealed_file_digest: Option<String>,
    sealed_byte_length: Option<u64>,
}

struct ActiveGeneration {
    session_id: String,
    binding: FeedBrowseGenerationBinding,
    path: PathBuf,
    store: FeedBrowseGenerationStore,
}

#[derive(Default)]
pub(super) struct LibraryCoreFeedBrowseRuntimeState(Mutex<Option<ActiveGeneration>>);

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> RuntimeResult<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.file_type().is_dir()
                || metadata.file_type().is_symlink()
                || metadata.permissions().mode() & 0o077 != 0
            {
                return Err(BrowseRuntimeError::Invalid("directory"));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = std::fs::DirBuilder::new();
            builder.mode(0o700);
            builder.create(path)?;
        }
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> RuntimeResult<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(BrowseRuntimeError::Invalid("directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(path)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn generation_path(base: &Path, generation_id: &str) -> RuntimeResult<PathBuf> {
    if !base.is_absolute() || !is_lower_sha256(generation_id) {
        return Err(BrowseRuntimeError::Invalid("path"));
    }
    let canonical_base = std::fs::canonicalize(base)?;
    let root = canonical_base.join(ROOT_DIRECTORY);
    create_private_directory(&root)?;
    let root = std::fs::canonicalize(root)?;
    if root.parent() != Some(canonical_base.as_path()) {
        return Err(BrowseRuntimeError::Invalid("root"));
    }
    let generations = root.join(GENERATION_DIRECTORY);
    create_private_directory(&generations)?;
    let generations = std::fs::canonicalize(generations)?;
    if generations.parent() != Some(root.as_path()) {
        return Err(BrowseRuntimeError::Invalid("generation directory"));
    }
    Ok(generations.join(format!("{generation_id}.sqlite")))
}

fn validate_session_id(value: &str) -> RuntimeResult<()> {
    if value.is_empty() || value.len() > MAXIMUM_SESSION_ID_BYTES {
        return Err(BrowseRuntimeError::Invalid("session ID"));
    }
    Ok(())
}

fn status(
    generation_id: String,
    progress: FeedBrowseGenerationProgress,
    published: Option<&PublishedFeedBrowseGeneration>,
) -> BrowseGenerationStatusV1 {
    BrowseGenerationStatusV1 {
        generation_id,
        next_batch_index: progress.next_batch_index,
        written_rows: progress.written_rows,
        total_rows: progress.total_rows,
        complete: progress.complete,
        sealed_file_digest: published.map(|receipt| receipt.file_digest.clone()),
        sealed_byte_length: published.map(|receipt| receipt.byte_length),
    }
}

fn begin_at_root(
    runtime: &LibraryCoreFeedBrowseRuntimeState,
    base: &Path,
    session_id: String,
    binding: FeedBrowseGenerationBinding,
) -> RuntimeResult<BrowseGenerationStatusV1> {
    validate_session_id(&session_id)?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| BrowseRuntimeError::StatePoisoned)?;
    if let Some(active) = guard.as_ref() {
        if active.session_id != session_id || active.binding != binding {
            return Err(BrowseRuntimeError::ActiveMismatch);
        }
        return Ok(status(
            active.binding.generation_id.clone(),
            active.store.progress()?,
            None,
        ));
    }
    let path = generation_path(base, &binding.generation_id)?;
    if path.try_exists()? {
        match FeedBrowseGenerationStore::inspect_existing(&path, &binding)? {
            ExistingFeedBrowseGeneration::Sealed(published) => {
                return Ok(status(
                    binding.generation_id,
                    published.progress.clone(),
                    Some(&published),
                ));
            }
            ExistingFeedBrowseGeneration::CompleteUnsealed(_) => {
                let mut store = FeedBrowseGenerationStore::open(&path)?;
                if store.begin(&binding)? != FeedBrowseGenerationState::Complete {
                    return Err(BrowseRuntimeError::Invalid("completed state"));
                }
                let published = store.seal(&path, &binding)?;
                return Ok(status(
                    binding.generation_id,
                    published.progress.clone(),
                    Some(&published),
                ));
            }
            ExistingFeedBrowseGeneration::Empty | ExistingFeedBrowseGeneration::Staging(_) => {}
        }
    }
    let mut store = FeedBrowseGenerationStore::open(&path)?;
    let state = store.begin(&binding)?;
    let progress = store.progress()?;
    let complete = state == FeedBrowseGenerationState::Complete;
    if complete {
        let published = store.seal(&path, &binding)?;
        Ok(status(
            binding.generation_id,
            published.progress.clone(),
            Some(&published),
        ))
    } else {
        *guard = Some(ActiveGeneration {
            session_id,
            binding: binding.clone(),
            path,
            store,
        });
        Ok(status(binding.generation_id, progress, None))
    }
}

fn append_at_root(
    runtime: &LibraryCoreFeedBrowseRuntimeState,
    batch: BrowseGenerationBatchInputV1,
) -> RuntimeResult<BrowseGenerationStatusV1> {
    validate_session_id(&batch.session_id)?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| BrowseRuntimeError::StatePoisoned)?;
    let active = guard.as_mut().ok_or(BrowseRuntimeError::ActiveMismatch)?;
    if active.session_id != batch.session_id {
        return Err(BrowseRuntimeError::ActiveMismatch);
    }
    active.store.append_page(batch.batch_index, &batch.rows)?;
    Ok(status(
        active.binding.generation_id.clone(),
        active.store.progress()?,
        None,
    ))
}

fn finalize_at_root(
    runtime: &LibraryCoreFeedBrowseRuntimeState,
    session_id: &str,
) -> RuntimeResult<BrowseGenerationStatusV1> {
    validate_session_id(session_id)?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| BrowseRuntimeError::StatePoisoned)?;
    {
        let active = guard.as_mut().ok_or(BrowseRuntimeError::ActiveMismatch)?;
        if active.session_id != session_id {
            return Err(BrowseRuntimeError::ActiveMismatch);
        }
        active.store.finalize()?;
    }
    let active = guard.take().expect("active generation was just validated");
    let published = active.store.seal(&active.path, &active.binding)?;
    Ok(status(
        active.binding.generation_id,
        published.progress.clone(),
        Some(&published),
    ))
}

fn cancel_at_root(
    runtime: &LibraryCoreFeedBrowseRuntimeState,
    session_id: &str,
) -> RuntimeResult<BrowseGenerationStatusV1> {
    validate_session_id(session_id)?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| BrowseRuntimeError::StatePoisoned)?;
    let active = guard.as_ref().ok_or(BrowseRuntimeError::ActiveMismatch)?;
    if active.session_id != session_id {
        return Err(BrowseRuntimeError::ActiveMismatch);
    }
    let status = status(
        active.binding.generation_id.clone(),
        active.store.progress()?,
        None,
    );
    *guard = None;
    Ok(status)
}

pub(super) fn clear_library_core_feed_browse_runtime_in(
    runtime: &LibraryCoreFeedBrowseRuntimeState,
    base: &Path,
) -> Result<(), String> {
    if !base.is_absolute() {
        return Err(BrowseRuntimeError::Invalid("path").to_string());
    }
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| BrowseRuntimeError::StatePoisoned.to_string())?;
    *guard = None;
    let root = base.join(ROOT_DIRECTORY);
    match std::fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
            std::fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
        }
        Ok(_) => return Err(BrowseRuntimeError::Invalid("root").to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    }
    drop(guard);
    Ok(())
}

#[tauri::command]
pub(super) fn begin_library_core_feed_browse_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreFeedBrowseRuntimeState>,
    session_id: String,
    binding: FeedBrowseGenerationBinding,
) -> Result<BrowseGenerationStatusV1, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    begin_at_root(&state, &base, session_id, binding).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn append_library_core_feed_browse_generation_page(
    state: tauri::State<'_, LibraryCoreFeedBrowseRuntimeState>,
    batch: BrowseGenerationBatchInputV1,
) -> Result<BrowseGenerationStatusV1, String> {
    append_at_root(&state, batch).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn finalize_library_core_feed_browse_generation(
    state: tauri::State<'_, LibraryCoreFeedBrowseRuntimeState>,
    session_id: String,
) -> Result<BrowseGenerationStatusV1, String> {
    finalize_at_root(&state, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn cancel_library_core_feed_browse_generation(
    state: tauri::State<'_, LibraryCoreFeedBrowseRuntimeState>,
    session_id: String,
) -> Result<BrowseGenerationStatusV1, String> {
    cancel_at_root(&state, &session_id).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(total_rows: i64) -> FeedBrowseGenerationBinding {
        FeedBrowseGenerationBinding {
            generation_id: "a".repeat(64),
            source_document_id: "library-1".to_string(),
            source_heads_digest: "b".repeat(64),
            source_head_count: 2,
            transition_sequence: 7,
            projection_revision: 11,
            filter_json: r#"{"schemaVersion":1}"#.to_string(),
            ranking_clock_ms: 1_780_000_000_000,
            recommendation_order_schema_version: 1,
            total_rows,
        }
    }

    fn row(id: &str) -> FeedBrowseProjectedRow {
        FeedBrowseProjectedRow {
            priority: 50,
            published_at: 1_700_000_000_000,
            source_sequence: 0,
            global_id: id.to_string(),
            card_json: format!(r#"{{"globalId":"{id}"}}"#),
        }
    }

    fn sidecar(path: &Path, suffix: &str) -> PathBuf {
        let mut value = path.as_os_str().to_os_string();
        value.push(suffix);
        PathBuf::from(value)
    }

    #[test]
    fn stages_replays_and_clears_one_generation() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        let runtime = LibraryCoreFeedBrowseRuntimeState::default();
        let status =
            begin_at_root(&runtime, &base, "session-1".to_string(), binding(1)).expect("begin");
        assert_eq!(status.next_batch_index, 0);
        assert_eq!(status.written_rows, 0);
        assert_eq!(status.total_rows, 1);
        assert!(!status.complete);
        let batch = BrowseGenerationBatchInputV1 {
            session_id: "session-1".to_string(),
            batch_index: 0,
            rows: vec![row("rss:item-1")],
        };
        let appended = append_at_root(&runtime, batch).expect("append");
        assert_eq!(appended.next_batch_index, 1);
        assert_eq!(appended.written_rows, 1);
        assert_eq!(appended.total_rows, 1);
        assert!(!appended.complete);

        let retried =
            begin_at_root(&runtime, &base, "session-1".to_string(), binding(1)).expect("retry");
        assert_eq!(retried.next_batch_index, 1);
        assert_eq!(retried.written_rows, 1);
        assert_eq!(retried.total_rows, 1);
        assert!(!retried.complete);

        let finalized = finalize_at_root(&runtime, "session-1").expect("finalize");
        assert_eq!(finalized.next_batch_index, 1);
        assert_eq!(finalized.written_rows, 1);
        assert_eq!(finalized.total_rows, 1);
        assert!(finalized.complete);
        let sealed_digest = finalized.sealed_file_digest.clone().expect("sealed digest");
        let sealed_length = finalized.sealed_byte_length.expect("sealed length");
        assert!(is_lower_sha256(&sealed_digest));
        assert!(sealed_length > 0);
        let sealed_path = generation_path(&base, &binding(1).generation_id).expect("path");
        let sealed_bytes = std::fs::read(&sealed_path).expect("sealed bytes");
        assert_eq!(sealed_bytes.len() as u64, sealed_length);
        assert!(!sidecar(&sealed_path, "-wal").exists());
        assert!(!sidecar(&sealed_path, "-shm").exists());

        let replayed =
            begin_at_root(&runtime, &base, "session-1".to_string(), binding(1)).expect("replay");
        assert_eq!(replayed.next_batch_index, 1);
        assert_eq!(replayed.written_rows, 1);
        assert_eq!(replayed.total_rows, 1);
        assert!(replayed.complete);
        assert_eq!(
            replayed.sealed_file_digest.as_deref(),
            Some(sealed_digest.as_str())
        );
        assert_eq!(replayed.sealed_byte_length, Some(sealed_length));
        assert_eq!(
            std::fs::read(&sealed_path).expect("replayed bytes"),
            sealed_bytes,
            "a completed replay must not mutate the sealed SQLite file"
        );
        assert!(
            append_at_root(
                &runtime,
                BrowseGenerationBatchInputV1 {
                    session_id: "session-1".to_string(),
                    batch_index: 0,
                    rows: vec![row("rss:item-1")],
                },
            )
            .is_err(),
            "a complete generation is not reopened for writes"
        );
        clear_library_core_feed_browse_runtime_in(&runtime, &base).expect("clear");
        assert!(!base.join(ROOT_DIRECTORY).exists());
    }

    #[test]
    fn recovers_a_completed_generation_when_the_seal_response_was_lost() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        let identity = binding(1);
        let path = generation_path(&base, &identity.generation_id).expect("path");
        {
            let mut store = FeedBrowseGenerationStore::open(&path).expect("store");
            store.begin(&identity).expect("begin");
            store.append_page(0, &[row("rss:item-1")]).expect("append");
            store.finalize().expect("finalize before lost response");
        }
        assert!(matches!(
            FeedBrowseGenerationStore::inspect_existing(&path, &identity)
                .expect("inspect unsealed"),
            ExistingFeedBrowseGeneration::CompleteUnsealed(_)
        ));

        let runtime = LibraryCoreFeedBrowseRuntimeState::default();
        let recovered =
            begin_at_root(&runtime, &base, "session-2".to_string(), identity).expect("recover");
        assert!(recovered.complete);
        assert!(recovered.sealed_file_digest.is_some());
        assert!(recovered.sealed_byte_length.is_some());
        assert!(
            runtime
                .0
                .lock()
                .expect("runtime lock")
                .as_ref()
                .is_none()
        );
    }

    #[test]
    fn rejects_cross_session_writes_and_quiesces_active_reset() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        let runtime = LibraryCoreFeedBrowseRuntimeState::default();
        begin_at_root(&runtime, &base, "session-1".to_string(), binding(1)).expect("begin");
        assert!(matches!(
            append_at_root(
                &runtime,
                BrowseGenerationBatchInputV1 {
                    session_id: "session-2".to_string(),
                    batch_index: 0,
                    rows: vec![row("rss:item-1")],
                },
            ),
            Err(BrowseRuntimeError::ActiveMismatch)
        ));
        let mut changed_binding = binding(1);
        changed_binding.projection_revision += 1;
        assert!(matches!(
            begin_at_root(&runtime, &base, "session-1".to_string(), changed_binding),
            Err(BrowseRuntimeError::ActiveMismatch)
        ));
        clear_library_core_feed_browse_runtime_in(&runtime, &base).expect("active reset");
        assert!(!base.join(ROOT_DIRECTORY).exists());
        assert!(matches!(
            finalize_at_root(&runtime, "session-1"),
            Err(BrowseRuntimeError::ActiveMismatch)
        ));
    }

    #[test]
    fn exact_page_replay_returns_unchanged_progress() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        let runtime = LibraryCoreFeedBrowseRuntimeState::default();
        begin_at_root(&runtime, &base, "session-1".to_string(), binding(1)).expect("begin");
        let first = append_at_root(
            &runtime,
            BrowseGenerationBatchInputV1 {
                session_id: "session-1".to_string(),
                batch_index: 0,
                rows: vec![row("rss:item-1")],
            },
        )
        .expect("first append");
        let replay = append_at_root(
            &runtime,
            BrowseGenerationBatchInputV1 {
                session_id: "session-1".to_string(),
                batch_index: 0,
                rows: vec![row("rss:item-1")],
            },
        )
        .expect("exact replay");
        assert_eq!(replay.next_batch_index, first.next_batch_index);
        assert_eq!(replay.written_rows, first.written_rows);
        assert_eq!(replay.total_rows, first.total_rows);
        assert_eq!(replay.complete, first.complete);
        let cancelled = cancel_at_root(&runtime, "session-1").expect("cancel");
        assert_eq!(cancelled.next_batch_index, 1);
        assert_eq!(cancelled.written_rows, 1);
        assert!(!cancelled.complete);
        assert!(matches!(
            cancel_at_root(&runtime, "session-1"),
            Err(BrowseRuntimeError::ActiveMismatch)
        ));
    }
}
