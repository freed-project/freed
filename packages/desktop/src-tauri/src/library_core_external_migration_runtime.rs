//! Bounded production bridge from one pinned Automerge export to SQLite.
//!
//! The worker streams one immutable source revision into the durable native
//! spool. Finalization runs the external-memory decoder on a blocking native
//! worker, selects one verified immutable SQLite generation, and leaves
//! Automerge as the only write and sync authority.

use crate::automerge_external_common::lower_hex;
use crate::automerge_external_pipeline::stage_external_snapshot;
use crate::automerge_external_spool::{ExternalSnapshotSource, ExternalSnapshotSpool};
use crate::library_core_shadow_runtime::{
    publish_external_projection_at_root, LibraryCoreShadowRuntimeState, ShadowProjectionStatus,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;

const MIGRATION_ROOT_DIRECTORY: &str = "library-core-external-migration-v1";
const SPOOL_DIRECTORY: &str = "spool";
const SCRATCH_DIRECTORY: &str = "scratch";
const MAXIMUM_SESSION_ID_BYTES: usize = 128;
const MAXIMUM_SOURCE_BYTES: u64 = 8 * 1_024 * 1_024 * 1_024;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

struct ActiveMigration {
    session_id: String,
    source: ExternalSnapshotSource,
    spool: ExternalSnapshotSpool,
}

#[derive(Clone, Default)]
pub(super) struct LibraryCoreExternalMigrationRuntimeState(Arc<Mutex<Option<ActiveMigration>>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExternalMigrationSpoolStatus {
    session_id: String,
    committed_offset: u64,
    byte_length: u64,
    complete: bool,
}

fn validate_session_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAXIMUM_SESSION_ID_BYTES
        || !value.bytes().enumerate().all(|(index, byte)| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => true,
            b'.' | b'_' | b':' | b'-' => index > 0,
            _ => false,
        })
    {
        return Err("invalid external migration session ID".to_string());
    }
    Ok(())
}

fn validate_source(source: &ExternalSnapshotSource) -> Result<(), String> {
    if source.schema_version != 1
        || source.byte_length == 0
        || source.byte_length > MAXIMUM_SOURCE_BYTES
        || source.storage_generation > MAXIMUM_SAFE_INTEGER
        || source.storage_save_revision > MAXIMUM_SAFE_INTEGER
    {
        return Err("invalid external migration source".to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn prepare_private_directory(path: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

    match std::fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.file_type().is_dir()
                && !metadata.file_type().is_symlink()
                && metadata.permissions().mode() & 0o077 == 0 => {}
        Ok(_) => return Err("external migration directory is not private".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = std::fs::DirBuilder::new();
            builder.mode(0o700);
            builder
                .create(path)
                .map_err(|error| format!("failed to create migration directory: {error}"))?;
        }
        Err(error) => return Err(format!("failed to inspect migration directory: {error}")),
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("failed to resolve migration directory: {error}"))?;
    if canonical != path {
        return Err("external migration directory is not canonical".to_string());
    }
    Ok(canonical)
}

#[cfg(not(unix))]
fn prepare_private_directory(path: &Path) -> Result<PathBuf, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Err("external migration directory is invalid".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(path)
                .map_err(|error| format!("failed to create migration directory: {error}"))?;
        }
        Err(error) => return Err(format!("failed to inspect migration directory: {error}")),
    }
    std::fs::canonicalize(path)
        .map_err(|error| format!("failed to resolve migration directory: {error}"))
}

fn runtime_paths(base: &Path, session_id: &str) -> Result<(PathBuf, PathBuf), String> {
    validate_session_id(session_id)?;
    let base = std::fs::canonicalize(base)
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    let root = prepare_private_directory(&base.join(MIGRATION_ROOT_DIRECTORY))?;
    if root.parent() != Some(base.as_path()) {
        return Err("external migration root escaped app data".to_string());
    }
    let spool = prepare_private_directory(&root.join(SPOOL_DIRECTORY))?;
    let scratch = prepare_private_directory(&root.join(SCRATCH_DIRECTORY))?;
    if spool.parent() != Some(root.as_path()) || scratch.parent() != Some(root.as_path()) {
        return Err("external migration child directory escaped its root".to_string());
    }
    let key = lower_hex(&Sha256::digest(session_id.as_bytes()));
    Ok((spool, scratch.join(format!("{key}.sqlite"))))
}

fn remove_private_regular_file(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() && !metadata.file_type().is_symlink() => {
            std::fs::remove_file(path)
                .map_err(|error| format!("failed to remove external migration file: {error}"))
        }
        Ok(_) => Err("external migration cleanup path is not a regular file".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to inspect external migration cleanup path: {error}"
        )),
    }
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn session_file_paths(
    base: &Path,
    session_id: &str,
) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let (spool_root, scratch_path) = runtime_paths(base, session_id)?;
    let key = lower_hex(&Sha256::digest(session_id.as_bytes()));
    let spool_data = spool_root.join(format!("{key}.snapshot"));
    let spool_journal = spool_root.join(format!("{key}.journal.jsonl"));
    Ok((spool_root, spool_data, spool_journal, scratch_path))
}

fn remove_scratch_files(scratch_path: &Path) -> Result<(), String> {
    for path in [
        sqlite_sidecar_path(scratch_path, "-wal"),
        sqlite_sidecar_path(scratch_path, "-shm"),
        sqlite_sidecar_path(scratch_path, "-journal"),
        scratch_path.to_path_buf(),
    ] {
        remove_private_regular_file(&path)?;
    }
    Ok(())
}

fn complete_at_root(
    runtime: &LibraryCoreExternalMigrationRuntimeState,
    base: &Path,
    session_id: &str,
) -> Result<(), String> {
    validate_session_id(session_id)?;
    let guard = runtime
        .0
        .lock()
        .map_err(|_| "external migration runtime state is unavailable".to_string())?;
    if guard.is_some() {
        return Err("external migration is active during completion".to_string());
    }

    let (spool_root, spool_data, spool_journal, scratch_path) =
        session_file_paths(base, session_id)?;
    // Keep the replayable source pair intact until all scratch state is gone.
    // If the process dies between the two final unlinks, begin_at_root treats
    // the one-file remainder as a completed-cleanup tail and starts fresh.
    remove_scratch_files(&scratch_path)?;
    remove_private_regular_file(&spool_data)?;
    remove_private_regular_file(&spool_journal)?;
    #[cfg(unix)]
    for directory in [
        spool_root.as_path(),
        scratch_path
            .parent()
            .ok_or_else(|| "external migration scratch root is invalid".to_string())?,
    ] {
        std::fs::File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("failed to sync external migration cleanup: {error}"))?;
    }
    drop(guard);
    Ok(())
}

fn recover_interrupted_completion(
    base: &Path,
    session_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let (spool_root, spool_data, spool_journal, scratch_path) =
        session_file_paths(base, session_id)?;
    let data_exists = spool_data
        .try_exists()
        .map_err(|error| format!("failed to inspect external migration source: {error}"))?;
    let journal_exists = spool_journal
        .try_exists()
        .map_err(|error| format!("failed to inspect external migration journal: {error}"))?;

    if data_exists != journal_exists {
        remove_scratch_files(&scratch_path)?;
        remove_private_regular_file(&spool_data)?;
        remove_private_regular_file(&spool_journal)?;
    } else if !data_exists {
        remove_scratch_files(&scratch_path)?;
    }
    Ok((spool_root, scratch_path))
}

fn status(active: &ActiveMigration) -> ExternalMigrationSpoolStatus {
    let committed_offset = active.spool.committed_offset();
    ExternalMigrationSpoolStatus {
        session_id: active.session_id.clone(),
        committed_offset,
        byte_length: active.source.byte_length,
        complete: committed_offset == active.source.byte_length,
    }
}

fn begin_at_root(
    runtime: &LibraryCoreExternalMigrationRuntimeState,
    base: &Path,
    session_id: String,
    source: ExternalSnapshotSource,
) -> Result<ExternalMigrationSpoolStatus, String> {
    validate_session_id(&session_id)?;
    validate_source(&source)?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| "external migration runtime state is unavailable".to_string())?;
    if let Some(active) = guard.as_ref() {
        if active.session_id != session_id || active.source != source {
            return Err("another external migration is active".to_string());
        }
        return Ok(status(active));
    }
    let (spool_root, _) = recover_interrupted_completion(base, &session_id)?;
    let spool = ExternalSnapshotSpool::open(&spool_root, &session_id, source.clone())
        .map_err(|error| error.to_string())?;
    let active = ActiveMigration {
        session_id,
        source,
        spool,
    };
    let current = status(&active);
    *guard = Some(active);
    Ok(current)
}

fn append_at_root(
    runtime: &LibraryCoreExternalMigrationRuntimeState,
    session_id: &str,
    offset: u64,
    bytes: &[u8],
) -> Result<ExternalMigrationSpoolStatus, String> {
    validate_session_id(session_id)?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| "external migration runtime state is unavailable".to_string())?;
    let active = guard
        .as_mut()
        .ok_or_else(|| "external migration is not active".to_string())?;
    if active.session_id != session_id {
        return Err("external migration session does not match".to_string());
    }
    active
        .spool
        .append_chunk(offset, bytes)
        .map_err(|error| error.to_string())?;
    Ok(status(active))
}

fn take_active(
    runtime: &LibraryCoreExternalMigrationRuntimeState,
    session_id: &str,
) -> Result<ActiveMigration, String> {
    validate_session_id(session_id)?;
    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| "external migration runtime state is unavailable".to_string())?;
    let active = guard
        .take()
        .ok_or_else(|| "external migration is not active".to_string())?;
    if active.session_id != session_id {
        *guard = Some(active);
        return Err("external migration session does not match".to_string());
    }
    Ok(active)
}

fn finalize_at_root(
    mut active: ActiveMigration,
    shadow_runtime: &LibraryCoreShadowRuntimeState,
    base: &Path,
    scratch_path: &Path,
) -> Result<ShadowProjectionStatus, String> {
    let source = active.source.clone();
    let source_sha256 = active.spool.finalize().map_err(|error| error.to_string())?;
    let source_file = active
        .spool
        .finalized_source_file()
        .map_err(|error| error.to_string())?;
    let storage_generation = i64::try_from(source.storage_generation)
        .map_err(|_| "external migration storage generation is invalid".to_string())?;
    let storage_save_revision = i64::try_from(source.storage_save_revision)
        .map_err(|_| "external migration save revision is invalid".to_string())?;
    let mut staged = stage_external_snapshot(
        source_file,
        source.byte_length,
        &source_sha256,
        storage_generation,
        storage_save_revision,
        scratch_path,
    )
    .map_err(|error| error.to_string())?;
    publish_external_projection_at_root(shadow_runtime, base, &mut staged)
        .map_err(|error| error.to_string())
}

pub(super) fn clear_library_core_external_migration_runtime_in(
    runtime: &LibraryCoreExternalMigrationRuntimeState,
    base: &Path,
) -> Result<(), String> {
    let guard = runtime
        .0
        .lock()
        .map_err(|_| "external migration runtime state is unavailable".to_string())?;
    if guard.is_some() {
        return Err("external migration is active during factory reset".to_string());
    }
    let root = base.join(MIGRATION_ROOT_DIRECTORY);
    match std::fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
            std::fs::remove_dir_all(&root)
                .map_err(|error| format!("failed to clear external migration state: {error}"))?;
        }
        Ok(_) => return Err("external migration directory is invalid".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "failed to inspect external migration state: {error}"
            ))
        }
    }
    Ok(())
}

#[tauri::command]
pub(super) fn begin_library_core_external_migration(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreExternalMigrationRuntimeState>,
    session_id: String,
    source: ExternalSnapshotSource,
) -> Result<ExternalMigrationSpoolStatus, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    begin_at_root(&state, &base, session_id, source)
}

#[tauri::command]
pub(super) fn append_library_core_external_migration_chunk(
    state: tauri::State<'_, LibraryCoreExternalMigrationRuntimeState>,
    session_id: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<ExternalMigrationSpoolStatus, String> {
    append_at_root(&state, &session_id, offset, &bytes)
}

#[tauri::command]
pub(super) async fn finalize_library_core_external_migration(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreExternalMigrationRuntimeState>,
    shadow_state: tauri::State<'_, LibraryCoreShadowRuntimeState>,
    session_id: String,
) -> Result<ShadowProjectionStatus, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let (_, scratch_path) = runtime_paths(&base, &session_id)?;
    let active = take_active(&state, &session_id)?;
    let shadow_runtime = (*shadow_state).clone();
    tauri::async_runtime::spawn_blocking(move || {
        finalize_at_root(active, &shadow_runtime, &base, &scratch_path)
    })
    .await
    .map_err(|error| format!("external migration worker failed: {error}"))?
}

#[tauri::command]
pub(super) fn complete_library_core_external_migration(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreExternalMigrationRuntimeState>,
    session_id: String,
) -> Result<(), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    complete_at_root(&state, &base, &session_id)
}

#[tauri::command]
pub(super) fn cancel_library_core_external_migration(
    state: tauri::State<'_, LibraryCoreExternalMigrationRuntimeState>,
    session_id: String,
) -> Result<(), String> {
    let _ = take_active(&state, &session_id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automerge_external_common::decode_test_hex;
    use crate::automerge_external_pipeline::FEED_ITEM_DOCUMENT_HEX;
    use crate::automerge_external_spool::EXTERNAL_SNAPSHOT_CHUNK_BYTES;
    use tempfile::tempdir;

    fn source() -> ExternalSnapshotSource {
        ExternalSnapshotSource {
            schema_version: 1,
            storage_generation: 7,
            storage_save_revision: 11,
            byte_length: EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64 + 3,
        }
    }

    #[test]
    fn resumes_the_exact_durable_spool_after_runtime_replacement() {
        let directory = tempdir().unwrap();
        let base = std::fs::canonicalize(directory.path()).unwrap();
        let runtime = LibraryCoreExternalMigrationRuntimeState::default();
        let session_id = "legacy-v1:7:11:1048579";

        let initial = begin_at_root(&runtime, &base, session_id.to_string(), source()).unwrap();
        assert_eq!(initial.committed_offset, 0);
        assert!(!initial.complete);
        let first = vec![7_u8; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
        let appended = append_at_root(&runtime, session_id, 0, &first).unwrap();
        assert_eq!(
            appended.committed_offset,
            EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64
        );
        assert!(!appended.complete);

        drop(take_active(&runtime, session_id).unwrap());
        let replacement = LibraryCoreExternalMigrationRuntimeState::default();
        let resumed = begin_at_root(&replacement, &base, session_id.to_string(), source()).unwrap();
        assert_eq!(
            resumed.committed_offset,
            EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64
        );
        assert!(!resumed.complete);
        let completed = append_at_root(
            &replacement,
            session_id,
            EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64,
            &[1, 2, 3],
        )
        .unwrap();
        assert_eq!(completed.committed_offset, source().byte_length);
        assert!(completed.complete);
    }

    #[test]
    fn factory_reset_blocks_on_a_live_migration_and_clears_only_after_cancel() {
        let directory = tempdir().unwrap();
        let base = std::fs::canonicalize(directory.path()).unwrap();
        let runtime = LibraryCoreExternalMigrationRuntimeState::default();
        let session_id = "legacy-v1:7:11:1048579";

        begin_at_root(&runtime, &base, session_id.to_string(), source()).unwrap();
        assert_eq!(
            clear_library_core_external_migration_runtime_in(&runtime, &base).unwrap_err(),
            "external migration is active during factory reset"
        );
        drop(take_active(&runtime, session_id).unwrap());
        clear_library_core_external_migration_runtime_in(&runtime, &base).unwrap();
        assert!(!base.join(MIGRATION_ROOT_DIRECTORY).exists());
    }

    #[test]
    fn interrupted_completion_tail_is_discarded_before_a_fresh_copy() {
        let directory = tempdir().unwrap();
        let base = std::fs::canonicalize(directory.path()).unwrap();
        let runtime = LibraryCoreExternalMigrationRuntimeState::default();
        let session_id = "legacy-v1:7:11:1048579";
        let (_, spool_data, spool_journal, scratch_path) =
            session_file_paths(&base, session_id).unwrap();
        std::fs::write(&spool_journal, "completed cleanup tail").unwrap();
        std::fs::write(&scratch_path, "stale scratch").unwrap();
        assert!(!spool_data.exists());

        let status = begin_at_root(&runtime, &base, session_id.to_string(), source()).unwrap();
        assert_eq!(status.committed_offset, 0);
        assert!(spool_data.exists());
        assert!(spool_journal.exists());
        assert!(!scratch_path.exists());
    }

    #[test]
    fn publishes_one_verified_generation_and_replays_lost_finalization() {
        let directory = tempdir().unwrap();
        let base = std::fs::canonicalize(directory.path()).unwrap();
        let runtime = LibraryCoreExternalMigrationRuntimeState::default();
        let shadow_runtime = LibraryCoreShadowRuntimeState::default();
        let session_id = "legacy-v1:7:11:fixture";
        let bytes = decode_test_hex(FEED_ITEM_DOCUMENT_HEX);
        let fixture_source = ExternalSnapshotSource {
            schema_version: 1,
            storage_generation: 7,
            storage_save_revision: 11,
            byte_length: bytes.len() as u64,
        };

        begin_at_root(
            &runtime,
            &base,
            session_id.to_string(),
            fixture_source.clone(),
        )
        .unwrap();
        let appended = append_at_root(&runtime, session_id, 0, &bytes).unwrap();
        assert!(appended.complete);
        let (_, scratch_path) = runtime_paths(&base, session_id).unwrap();
        let first = finalize_at_root(
            take_active(&runtime, session_id).unwrap(),
            &shadow_runtime,
            &base,
            &scratch_path,
        )
        .unwrap();
        let first_value = serde_json::to_value(&first).unwrap();
        assert_eq!(first_value["selected"], true);
        assert_eq!(first_value["complete"], true);
        assert_eq!(first_value["totalRows"], 1);

        begin_at_root(&runtime, &base, session_id.to_string(), fixture_source).unwrap();
        let replay = finalize_at_root(
            take_active(&runtime, session_id).unwrap(),
            &shadow_runtime,
            &base,
            &scratch_path,
        )
        .unwrap();
        let replay_value = serde_json::to_value(&replay).unwrap();
        assert_eq!(replay_value["generationId"], first_value["generationId"]);
        assert_eq!(
            replay_value["transitionSequence"],
            first_value["transitionSequence"]
        );
        assert_eq!(replay_value["sourceKey"], first_value["sourceKey"]);

        complete_at_root(&runtime, &base, session_id).unwrap();
        complete_at_root(&runtime, &base, session_id).unwrap();
        let (spool_root, scratch_path) = runtime_paths(&base, session_id).unwrap();
        let key = lower_hex(&Sha256::digest(session_id.as_bytes()));
        assert!(!spool_root.join(format!("{key}.snapshot")).exists());
        assert!(!spool_root.join(format!("{key}.journal.jsonl")).exists());
        assert!(!scratch_path.exists());
    }
}
