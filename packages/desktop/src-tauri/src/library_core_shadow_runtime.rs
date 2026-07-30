//! Production-located compatibility bridge into immutable SQLite generations.
//!
//! Automerge remains authoritative. The renderer worker pins one exact durable
//! document revision and emits bounded `FeedItemRow` batches. This module
//! serializes one active rebuild, commits each batch with a replay receipt, and
//! selects only a complete immutable generation.

use crate::projection_coordinator::{
    apply_projection_batch, begin_or_resume_projection, finalize_and_open_projection,
    ProjectionCoordinatorError,
};
use crate::projection_generation_registry::{
    ProjectionGenerationReaderSelection, ProjectionGenerationRegistry,
    ProjectionGenerationRegistryError,
};
use crate::shadow_store::{FeedItemRow, ProjectionRebuildState, ProjectionSourceV1};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const SHADOW_ROOT_DIRECTORY: &str = "library-core-shadow-v1";
const GENERATION_DIRECTORY: &str = "generations";
const REGISTRY_FILE: &str = "registry.sqlite";
const MAXIMUM_ROWS: usize = 250_000;
const MAXIMUM_BATCH_ROWS: usize = 1_000;
const MAXIMUM_BATCH_BYTES: usize = 4 * 1_048_576;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug)]
enum ShadowRuntimeError {
    Coordinator(ProjectionCoordinatorError),
    Registry(ProjectionGenerationRegistryError),
    Io(std::io::Error),
    InvalidInput(&'static str),
    ActiveProjectionMismatch,
    IncompleteProjection,
    AmbiguousPublication,
    ActiveProjectionDuringReset,
    StatePoisoned,
}

impl From<ProjectionCoordinatorError> for ShadowRuntimeError {
    fn from(error: ProjectionCoordinatorError) -> Self {
        Self::Coordinator(error)
    }
}

impl From<ProjectionGenerationRegistryError> for ShadowRuntimeError {
    fn from(error: ProjectionGenerationRegistryError) -> Self {
        Self::Registry(error)
    }
}

impl From<std::io::Error> for ShadowRuntimeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for ShadowRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Coordinator(error) => write!(formatter, "{error}"),
            Self::Registry(error) => write!(formatter, "{error}"),
            Self::Io(error) => write!(formatter, "SQLite shadow path error: {error}"),
            Self::InvalidInput(field) => write!(formatter, "invalid SQLite shadow {field}"),
            Self::ActiveProjectionMismatch => {
                formatter.write_str("SQLite shadow request does not match the active projection")
            }
            Self::IncompleteProjection => {
                formatter.write_str("SQLite shadow projection is not complete")
            }
            Self::AmbiguousPublication => {
                formatter.write_str("SQLite shadow staging and generation both exist")
            }
            Self::ActiveProjectionDuringReset => {
                formatter.write_str("SQLite shadow projection is active during factory reset")
            }
            Self::StatePoisoned => {
                formatter.write_str("SQLite shadow runtime state is unavailable")
            }
        }
    }
}

impl std::error::Error for ShadowRuntimeError {}

type RuntimeResult<T> = Result<T, ShadowRuntimeError>;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectionSourceInputV1 {
    schema_version: u8,
    document_id: String,
    heads_digest: String,
    head_count: u64,
    storage_revision: StorageRevisionInputV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StorageRevisionInputV1 {
    generation: u64,
    save_revision: u64,
}

impl ProjectionSourceInputV1 {
    fn validate(&self) -> RuntimeResult<ProjectionSourceV1> {
        if self.schema_version != 1 {
            return Err(ShadowRuntimeError::InvalidInput("source schema version"));
        }
        if self.document_id.is_empty() || self.document_id.len() > 4_096 {
            return Err(ShadowRuntimeError::InvalidInput("source document ID"));
        }
        if !is_lower_hex_digest(&self.heads_digest) {
            return Err(ShadowRuntimeError::InvalidInput("source heads digest"));
        }
        if self.head_count > MAXIMUM_SAFE_INTEGER
            || self.storage_revision.generation > MAXIMUM_SAFE_INTEGER
            || self.storage_revision.save_revision > MAXIMUM_SAFE_INTEGER
        {
            return Err(ShadowRuntimeError::InvalidInput("source revision"));
        }
        Ok(ProjectionSourceV1 {
            document_id: self.document_id.clone(),
            heads_digest: self.heads_digest.clone(),
            head_count: self.head_count as i64,
            storage_generation: self.storage_revision.generation as i64,
            storage_save_revision: self.storage_revision.save_revision as i64,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectionBatchInputV1 {
    session_id: String,
    source: ProjectionSourceInputV1,
    batch_index: u64,
    rows: Vec<FeedItemRow>,
    row_bytes: u64,
    projected_rows: u64,
    total_rows: u64,
    done: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ShadowProjectionStatus {
    source_key: String,
    selected: bool,
    complete: bool,
    next_batch_index: i64,
    projected_rows: usize,
    total_rows: usize,
    generation_id: Option<String>,
    transition_sequence: Option<i64>,
}

#[derive(Debug)]
struct RuntimePaths {
    generation_root: PathBuf,
    staging_path: PathBuf,
    destination_path: PathBuf,
    registry_path: PathBuf,
}

#[derive(Debug)]
struct ActiveProjection {
    session_id: String,
    source_key: String,
    source: ProjectionSourceV1,
    total_rows: usize,
    rebuild_id: String,
    transition_id: String,
    expected_current_generation_id: Option<String>,
    paths: RuntimePaths,
    state: ProjectionRebuildState,
}

#[derive(Default)]
pub(super) struct LibraryCoreShadowRuntimeState(Mutex<Option<ActiveProjection>>);

fn is_lower_hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn source_key(source: &ProjectionSourceV1, total_rows: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"freed-library-core-shadow-source-v1\0");
    hasher.update(source.document_id.as_bytes());
    hasher.update([0]);
    hasher.update(source.heads_digest.as_bytes());
    hasher.update(source.head_count.to_be_bytes());
    hasher.update(source.storage_generation.to_be_bytes());
    hasher.update(source.storage_save_revision.to_be_bytes());
    hasher.update((total_rows as u64).to_be_bytes());
    lower_hex(&hasher.finalize())
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> RuntimeResult<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
                return Err(ShadowRuntimeError::InvalidInput("directory"));
            }
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(ShadowRuntimeError::InvalidInput("directory permissions"));
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
        Ok(_) => Err(ShadowRuntimeError::InvalidInput("directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(path)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn runtime_paths(base: &Path, key: &str) -> RuntimeResult<RuntimePaths> {
    if !base.is_absolute() || !is_lower_hex_digest(key) {
        return Err(ShadowRuntimeError::InvalidInput("runtime path"));
    }
    let root = base.join(SHADOW_ROOT_DIRECTORY);
    create_private_directory(&root)?;
    let root = std::fs::canonicalize(root)?;
    let generation_root = root.join(GENERATION_DIRECTORY);
    create_private_directory(&generation_root)?;
    let generation_root = std::fs::canonicalize(generation_root)?;
    if generation_root.parent() != Some(root.as_path()) {
        return Err(ShadowRuntimeError::InvalidInput("generation directory"));
    }
    Ok(RuntimePaths {
        staging_path: generation_root.join(format!(".{key}.staging.sqlite")),
        destination_path: generation_root.join(format!("{key}.sqlite")),
        registry_path: root.join(REGISTRY_FILE),
        generation_root,
    })
}

fn current_selection(
    registry_path: &Path,
) -> RuntimeResult<Option<ProjectionGenerationReaderSelection>> {
    match std::fs::symlink_metadata(registry_path) {
        Ok(metadata) if metadata.file_type().is_file() => {}
        Ok(_) => return Err(ShadowRuntimeError::InvalidInput("registry file")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    match ProjectionGenerationRegistry::read_selected_generation(registry_path) {
        Ok(selection) => Ok(Some(selection)),
        Err(ProjectionGenerationRegistryError::NoSelectedGeneration) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn selection_matches(
    selection: &ProjectionGenerationReaderSelection,
    source: &ProjectionSourceV1,
    total_rows: usize,
) -> bool {
    let generation = &selection.generation;
    generation.source_document_id == source.document_id
        && generation.source_heads_digest == source.heads_digest
        && generation.source_head_count == source.head_count
        && generation.source_generation == source.storage_generation
        && generation.source_save_revision == source.storage_save_revision
        && generation.total_rows == total_rows
}

fn status_from_state(key: String, state: &ProjectionRebuildState) -> ShadowProjectionStatus {
    ShadowProjectionStatus {
        source_key: key,
        selected: false,
        complete: state.complete,
        next_batch_index: state.next_batch_index,
        projected_rows: state.projected_rows,
        total_rows: state.total_rows,
        generation_id: None,
        transition_sequence: None,
    }
}

fn status_from_selection(
    key: String,
    selection: &ProjectionGenerationReaderSelection,
) -> ShadowProjectionStatus {
    ShadowProjectionStatus {
        source_key: key,
        selected: true,
        complete: true,
        next_batch_index: selection.generation.projection_revision,
        projected_rows: selection.generation.total_rows,
        total_rows: selection.generation.total_rows,
        generation_id: Some(selection.generation.generation_id.clone()),
        transition_sequence: Some(selection.transition_sequence),
    }
}

fn begin_at_root(
    runtime: &LibraryCoreShadowRuntimeState,
    base: &Path,
    session_id: String,
    source_input: ProjectionSourceInputV1,
    total_rows: u64,
) -> RuntimeResult<ShadowProjectionStatus> {
    if session_id.is_empty() || session_id.len() > 128 || total_rows > MAXIMUM_ROWS as u64 {
        return Err(ShadowRuntimeError::InvalidInput("projection identity"));
    }
    let total_rows =
        usize::try_from(total_rows).map_err(|_| ShadowRuntimeError::InvalidInput("row count"))?;
    let source = source_input.validate()?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| ShadowRuntimeError::StatePoisoned)?;
    let key = source_key(&source, total_rows);
    let paths = runtime_paths(base, &key)?;
    let selected = current_selection(&paths.registry_path)?;
    if let Some(selection) = selected.as_ref() {
        if selection_matches(selection, &source, total_rows) {
            *guard = None;
            return Ok(status_from_selection(key, selection));
        }
    }
    let expected_current_generation_id = selected
        .as_ref()
        .map(|value| value.generation.generation_id.clone());
    let rebuild_id = format!("shadow-{key}");
    let transition_id = format!("select-{key}");
    let staging_exists = paths.staging_path.try_exists()?;
    let destination_exists = paths.destination_path.try_exists()?;
    if staging_exists && destination_exists {
        return Err(ShadowRuntimeError::AmbiguousPublication);
    }
    if !staging_exists && destination_exists {
        let read_session = finalize_and_open_projection(
            &paths.staging_path,
            &paths.destination_path,
            &paths.registry_path,
            &paths.generation_root,
            &rebuild_id,
            &source,
            total_rows,
            &transition_id,
            expected_current_generation_id.as_deref(),
        )?;
        let selection =
            ProjectionGenerationRegistry::read_selected_generation(&paths.registry_path)?;
        if read_session.generation_id() != selection.generation.generation_id {
            return Err(ShadowRuntimeError::InvalidInput("selected generation"));
        }
        *guard = None;
        return Ok(status_from_selection(key, &selection));
    }
    let state = begin_or_resume_projection(&paths.staging_path, &rebuild_id, &source, total_rows)?;
    let status = status_from_state(key.clone(), &state);
    *guard = Some(ActiveProjection {
        session_id,
        source_key: key,
        source,
        total_rows,
        rebuild_id,
        transition_id,
        expected_current_generation_id,
        paths,
        state,
    });
    Ok(status)
}

fn batch_digest(key: &str, batch: &ProjectionBatchInputV1) -> RuntimeResult<String> {
    let mut hasher = Sha256::new();
    hasher.update(b"freed-library-core-shadow-batch-v1\0");
    hasher.update(key.as_bytes());
    hasher.update(batch.batch_index.to_be_bytes());
    hasher.update(batch.row_bytes.to_be_bytes());
    hasher.update(batch.projected_rows.to_be_bytes());
    hasher.update(batch.total_rows.to_be_bytes());
    hasher.update([u8::from(batch.done)]);
    let mut writer = BoundedDigestWriter {
        hasher: &mut hasher,
        written: 0,
        maximum: MAXIMUM_BATCH_BYTES,
    };
    serde_json::to_writer(&mut writer, &batch.rows)
        .map_err(|_| ShadowRuntimeError::InvalidInput("batch rows"))?;
    Ok(lower_hex(&hasher.finalize()))
}

struct BoundedDigestWriter<'a> {
    hasher: &'a mut Sha256,
    written: usize,
    maximum: usize,
}

impl Write for BoundedDigestWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let next = self
            .written
            .checked_add(bytes.len())
            .ok_or_else(|| std::io::Error::other("SQLite shadow batch byte count overflow"))?;
        if next > self.maximum {
            return Err(std::io::Error::other(
                "SQLite shadow batch exceeds its byte limit",
            ));
        }
        self.hasher.update(bytes);
        self.written = next;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn apply_at_root(
    runtime: &LibraryCoreShadowRuntimeState,
    batch: ProjectionBatchInputV1,
) -> RuntimeResult<ShadowProjectionStatus> {
    if batch.rows.is_empty()
        || batch.rows.len() > MAXIMUM_BATCH_ROWS
        || batch.batch_index > MAXIMUM_SAFE_INTEGER
        || batch.projected_rows > MAXIMUM_SAFE_INTEGER
        || batch.total_rows > MAXIMUM_SAFE_INTEGER
        || batch.row_bytes == 0
        || batch.row_bytes > MAXIMUM_BATCH_BYTES as u64
    {
        return Err(ShadowRuntimeError::InvalidInput("projection batch"));
    }
    let total_rows = usize::try_from(batch.total_rows)
        .map_err(|_| ShadowRuntimeError::InvalidInput("row count"))?;
    let projected_rows = usize::try_from(batch.projected_rows)
        .map_err(|_| ShadowRuntimeError::InvalidInput("projected row count"))?;
    let source = batch.source.validate()?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| ShadowRuntimeError::StatePoisoned)?;
    let active = guard
        .as_mut()
        .ok_or(ShadowRuntimeError::ActiveProjectionMismatch)?;
    if active.session_id != batch.session_id
        || active.source != source
        || active.total_rows != total_rows
        || projected_rows > active.total_rows
    {
        return Err(ShadowRuntimeError::ActiveProjectionMismatch);
    }
    let digest = batch_digest(&active.source_key, &batch)?;
    let batch_id = format!("{}:{}", active.source_key, batch.batch_index);
    active.state = apply_projection_batch(
        &active.paths.staging_path,
        &active.rebuild_id,
        &active.source,
        active.total_rows,
        batch.batch_index as i64,
        &batch_id,
        &digest,
        projected_rows,
        batch.done,
        &batch.rows,
    )?;
    Ok(status_from_state(active.source_key.clone(), &active.state))
}

fn finalize_at_root(
    runtime: &LibraryCoreShadowRuntimeState,
    session_id: &str,
) -> RuntimeResult<ShadowProjectionStatus> {
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| ShadowRuntimeError::StatePoisoned)?;
    let active = guard
        .as_ref()
        .ok_or(ShadowRuntimeError::ActiveProjectionMismatch)?;
    if active.session_id != session_id {
        return Err(ShadowRuntimeError::ActiveProjectionMismatch);
    }
    if !active.state.complete {
        return Err(ShadowRuntimeError::IncompleteProjection);
    }
    let read_session = finalize_and_open_projection(
        &active.paths.staging_path,
        &active.paths.destination_path,
        &active.paths.registry_path,
        &active.paths.generation_root,
        &active.rebuild_id,
        &active.source,
        active.total_rows,
        &active.transition_id,
        active.expected_current_generation_id.as_deref(),
    )?;
    let selection =
        ProjectionGenerationRegistry::read_selected_generation(&active.paths.registry_path)?;
    if read_session.generation_id() != selection.generation.generation_id
        || !selection_matches(&selection, &active.source, active.total_rows)
    {
        return Err(ShadowRuntimeError::InvalidInput("selected generation"));
    }
    let status = status_from_selection(active.source_key.clone(), &selection);
    *guard = None;
    Ok(status)
}

pub(super) fn clear_library_core_shadow_runtime_in(
    runtime: &LibraryCoreShadowRuntimeState,
    base: &Path,
) -> Result<(), String> {
    if !base.is_absolute() {
        return Err(ShadowRuntimeError::InvalidInput("runtime path").to_string());
    }

    let guard = runtime
        .0
        .lock()
        .map_err(|_| ShadowRuntimeError::StatePoisoned.to_string())?;
    if guard.is_some() {
        return Err(ShadowRuntimeError::ActiveProjectionDuringReset.to_string());
    }

    let root = base.join(SHADOW_ROOT_DIRECTORY);
    let metadata = match std::fs::symlink_metadata(&root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(ShadowRuntimeError::Io(error).to_string()),
    };
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(ShadowRuntimeError::InvalidInput("runtime directory").to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(
                ShadowRuntimeError::InvalidInput("runtime directory permissions").to_string(),
            );
        }
    }

    std::fs::remove_dir_all(&root).map_err(|error| ShadowRuntimeError::Io(error).to_string())?;
    #[cfg(unix)]
    std::fs::File::open(base)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| ShadowRuntimeError::Io(error).to_string())?;
    drop(guard);
    Ok(())
}

#[tauri::command]
pub(super) fn begin_library_core_shadow_projection(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreShadowRuntimeState>,
    session_id: String,
    source: ProjectionSourceInputV1,
    total_rows: u64,
) -> Result<ShadowProjectionStatus, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    begin_at_root(&state, &base, session_id, source, total_rows).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn apply_library_core_shadow_projection_batch(
    state: tauri::State<'_, LibraryCoreShadowRuntimeState>,
    batch: ProjectionBatchInputV1,
) -> Result<ShadowProjectionStatus, String> {
    apply_at_root(&state, batch).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn finalize_library_core_shadow_projection(
    state: tauri::State<'_, LibraryCoreShadowRuntimeState>,
    session_id: String,
) -> Result<ShadowProjectionStatus, String> {
    finalize_at_root(&state, &session_id).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        base: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let base = std::fs::canonicalize(std::env::temp_dir())
                .expect("temp root")
                .join(format!(
                    "freed-library-core-shadow-runtime-{label}-{}-{nonce}",
                    std::process::id()
                ));
            std::fs::create_dir(&base).expect("fixture root");
            Self { base }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    fn source_input(revision: u64) -> ProjectionSourceInputV1 {
        ProjectionSourceInputV1 {
            schema_version: 1,
            document_id: "freed-doc".to_string(),
            heads_digest: lower_hex(&Sha256::digest(format!("heads-{revision}").as_bytes())),
            head_count: revision,
            storage_revision: StorageRevisionInputV1 {
                generation: 3,
                save_revision: revision,
            },
        }
    }

    fn row(global_id: &str, text: &str) -> FeedItemRow {
        FeedItemRow {
            global_id: global_id.to_string(),
            platform: Some("rss".to_string()),
            content_type: Some("article".to_string()),
            published_at: Some(1_700_000_000_000),
            captured_at: Some(1_700_000_001_000),
            author_id: None,
            author_display_name: Some("Author".to_string()),
            author_handle: None,
            source_url: Some(format!("https://example.test/{global_id}")),
            hidden: Some(0),
            saved: Some(0),
            archived: Some(0),
            read_at: None,
            archived_at: None,
            liked_at: None,
            tags: Some("[]".to_string()),
            content_blob: Some(format!(r#"{{"text":"{text}"}}"#)),
            preserved_blob: None,
            rest: "{}".to_string(),
        }
    }

    fn batch(
        session_id: &str,
        source: ProjectionSourceInputV1,
        batch_index: u64,
        rows: Vec<FeedItemRow>,
        projected_rows: u64,
        total_rows: u64,
        done: bool,
    ) -> ProjectionBatchInputV1 {
        ProjectionBatchInputV1 {
            session_id: session_id.to_string(),
            source,
            batch_index,
            row_bytes: 1_024,
            rows,
            projected_rows,
            total_rows,
            done,
        }
    }

    #[test]
    fn publishes_and_reopens_one_exact_generation() {
        let fixture = Fixture::new("publish-reopen");
        let runtime = LibraryCoreShadowRuntimeState::default();
        let source = source_input(7);
        let begun = begin_at_root(
            &runtime,
            &fixture.base,
            "session-1".to_string(),
            source.clone(),
            2,
        )
        .expect("begin");
        assert!(!begun.selected);
        assert_eq!(begun.projected_rows, 0);

        let applied = apply_at_root(
            &runtime,
            batch(
                "session-1",
                source.clone(),
                0,
                vec![row("item-1", "first"), row("item-2", "second")],
                2,
                2,
                true,
            ),
        )
        .expect("apply");
        assert!(applied.complete);

        let selected = finalize_at_root(&runtime, "session-1").expect("finalize");
        assert!(selected.selected);
        assert_eq!(selected.total_rows, 2);
        assert!(selected.generation_id.is_some());
        assert_eq!(selected.transition_sequence, Some(1));

        let reopened = begin_at_root(
            &LibraryCoreShadowRuntimeState::default(),
            &fixture.base,
            "session-2".to_string(),
            source,
            2,
        )
        .expect("reopen");
        assert!(reopened.selected);
        assert_eq!(reopened.generation_id, selected.generation_id);
    }

    #[test]
    fn preserves_previous_generation_as_rollback_selection() {
        let fixture = Fixture::new("rollback");
        let runtime = LibraryCoreShadowRuntimeState::default();
        let first_source = source_input(11);
        begin_at_root(
            &runtime,
            &fixture.base,
            "session-a".to_string(),
            first_source.clone(),
            1,
        )
        .expect("begin first");
        apply_at_root(
            &runtime,
            batch(
                "session-a",
                first_source,
                0,
                vec![row("item-1", "first")],
                1,
                1,
                true,
            ),
        )
        .expect("apply first");
        let first = finalize_at_root(&runtime, "session-a").expect("finalize first");

        let second_source = source_input(12);
        begin_at_root(
            &runtime,
            &fixture.base,
            "session-b".to_string(),
            second_source.clone(),
            1,
        )
        .expect("begin second");
        apply_at_root(
            &runtime,
            batch(
                "session-b",
                second_source.clone(),
                0,
                vec![row("item-1", "second")],
                1,
                1,
                true,
            ),
        )
        .expect("apply second");
        let second = finalize_at_root(&runtime, "session-b").expect("finalize second");
        assert_ne!(first.generation_id, second.generation_id);
        assert_eq!(second.transition_sequence, Some(2));

        let source = second_source.validate().expect("source");
        let key = source_key(&source, 1);
        let paths = runtime_paths(&fixture.base, &key).expect("paths");
        let connection = Connection::open(paths.registry_path).expect("registry");
        let rollback: Option<String> = connection
            .query_row(
                "SELECT rollbackGenerationId FROM projection_reader_state WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .expect("rollback");
        assert_eq!(rollback, first.generation_id);
    }

    #[test]
    fn changed_replay_fails_closed() {
        let fixture = Fixture::new("replay");
        let runtime = LibraryCoreShadowRuntimeState::default();
        let source = source_input(17);
        begin_at_root(
            &runtime,
            &fixture.base,
            "session".to_string(),
            source.clone(),
            2,
        )
        .expect("begin");
        apply_at_root(
            &runtime,
            batch(
                "session",
                source.clone(),
                0,
                vec![row("item-1", "original")],
                1,
                2,
                false,
            ),
        )
        .expect("first apply");
        let error = apply_at_root(
            &runtime,
            batch(
                "session",
                source,
                0,
                vec![row("item-1", "changed")],
                1,
                2,
                false,
            ),
        )
        .expect_err("changed replay must fail");
        assert!(error
            .to_string()
            .contains("does not match its durable state"));
    }

    #[test]
    fn native_batch_admission_does_not_trust_the_reported_row_bytes() {
        let fixture = Fixture::new("reported-bytes");
        let runtime = LibraryCoreShadowRuntimeState::default();
        let source = source_input(18);
        begin_at_root(
            &runtime,
            &fixture.base,
            "session".to_string(),
            source.clone(),
            1,
        )
        .expect("begin");
        let mut oversized = row("item-1", "ignored");
        oversized.content_blob = Some("\u{0000}".repeat(700_000));
        let error = apply_at_root(
            &runtime,
            batch("session", source, 0, vec![oversized], 1, 1, true),
        )
        .expect_err("actual encoded bytes must enforce the native limit");
        assert!(error
            .to_string()
            .contains("invalid SQLite shadow batch rows"));
    }

    #[test]
    fn native_rows_reject_unregistered_fields() {
        let mut encoded = serde_json::to_value(row("item-1", "private")).expect("encode row");
        encoded
            .as_object_mut()
            .expect("row object")
            .insert("futureField".to_string(), serde_json::json!(true));
        let error = serde_json::from_value::<FeedItemRow>(encoded)
            .expect_err("unknown row fields must fail closed");
        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn empty_projection_can_finalize_without_an_empty_batch() {
        let fixture = Fixture::new("empty");
        let runtime = LibraryCoreShadowRuntimeState::default();
        let begun = begin_at_root(
            &runtime,
            &fixture.base,
            "empty-session".to_string(),
            source_input(19),
            0,
        )
        .expect("begin");
        assert!(begun.complete);
        let selected = finalize_at_root(&runtime, "empty-session").expect("finalize");
        assert!(selected.selected);
        assert_eq!(selected.total_rows, 0);
    }

    #[test]
    fn factory_reset_removes_the_complete_shadow_runtime() {
        let fixture = Fixture::new("factory-reset");
        let runtime = LibraryCoreShadowRuntimeState::default();
        let source = source_input(23);
        begin_at_root(
            &runtime,
            &fixture.base,
            "reset-session".to_string(),
            source.clone(),
            1,
        )
        .expect("begin");
        apply_at_root(
            &runtime,
            batch(
                "reset-session",
                source,
                0,
                vec![row("item-1", "private")],
                1,
                1,
                true,
            ),
        )
        .expect("apply");
        finalize_at_root(&runtime, "reset-session").expect("finalize");

        let shadow_root = fixture.base.join(SHADOW_ROOT_DIRECTORY);
        assert!(shadow_root.exists());
        clear_library_core_shadow_runtime_in(&runtime, &fixture.base).expect("clear");
        assert!(!shadow_root.exists());
        clear_library_core_shadow_runtime_in(&runtime, &fixture.base).expect("idempotent clear");
    }

    #[test]
    fn factory_reset_refuses_to_race_an_active_projection() {
        let fixture = Fixture::new("factory-reset-active");
        let runtime = LibraryCoreShadowRuntimeState::default();
        begin_at_root(
            &runtime,
            &fixture.base,
            "active-session".to_string(),
            source_input(29),
            1,
        )
        .expect("begin");

        let error = clear_library_core_shadow_runtime_in(&runtime, &fixture.base)
            .expect_err("active projection must block reset");
        assert!(error.contains("active during factory reset"));
        assert!(fixture.base.join(SHADOW_ROOT_DIRECTORY).exists());
    }

    #[cfg(unix)]
    #[test]
    fn factory_reset_rejects_a_shadow_root_symlink() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("factory-reset-symlink");
        let target = fixture.base.join("private-target");
        std::fs::create_dir(&target).expect("target");
        std::fs::write(target.join("library.sqlite"), "private").expect("target content");
        symlink(&target, fixture.base.join(SHADOW_ROOT_DIRECTORY)).expect("shadow symlink");

        let error = clear_library_core_shadow_runtime_in(
            &LibraryCoreShadowRuntimeState::default(),
            &fixture.base,
        )
        .expect_err("symlink must fail closed");
        assert!(error.contains("invalid SQLite shadow runtime directory"));
        assert_eq!(
            std::fs::read_to_string(target.join("library.sqlite")).expect("target retained"),
            "private"
        );
    }
}
