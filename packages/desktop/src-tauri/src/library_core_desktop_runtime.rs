//! Freed Desktop native Library routing during the SQLite-only cutover.
//!
//! Final product reads enter the normalized native core through closed typed
//! commands. The legacy commands in this module remain only until the one-time
//! migration and caller cut remove them. They are not part of the final
//! Library contract.

#[cfg(test)]
use freed_library_core::upsert_item;
use freed_library_core::{
    accept_normalized_operation_transaction_v1, normalized_primary_mutation_context_v1,
    load_or_create_normalized_actor_id_v2,
    LibraryCoreBackupChunk as NativeLibraryCoreBackupChunk,
    LibraryCoreBackupOperationGuard, LibraryCoreBackupReceipt, LibraryCoreBackupRecord,
    LibraryCoreStore, LibraryCoreStoreStatus, NormalizedMutationContextV1,
    NormalizedMutationReceiptV1,
};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::library_core_actor_enrollment::{
    countersign_pwa_actor_enrollment_request, prepare_follower_actor_enrollment_request,
    sign_library_core_operation_digest, EnrollmentAuthority, PlatformActorKeyStore,
};
use super::library_core_authority_genesis::{
    load_established_authority_key_pair, PlatformAuthorityKeyStore,
};
use super::library_core_journal::{
    FollowerIntentEnqueueReceipt, FollowerIntentOutboxCandidate,
    FollowerIntentPublicationReceipt, FollowerOverlayReplayReceipt, FollowerResultImportCursor,
    FollowerResultImportReceipt, FollowerRuntimeStatus, IntentResultOutboxEntry,
    LibraryCoreJournal, StoredFollowerActorEnrollment, StoredFollowerActorRequest,
    VerifiedFollowerIntentPublication, VerifiedFollowerIntentResult, VerifiedFollowerResultSegment,
};
const BACKUP_DIRECTORY: &str = "library-backups";
const JOURNAL_DIRECTORY: &str = "library-core";
const JOURNAL_FILE: &str = "library-core.sqlite";
const NORMALIZED_LIBRARY_DIRECTORY: &str = "library-sqlite";
const MAX_BACKUP_CHUNK_BYTES: usize = 1_048_576;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryStatus {
    active: bool,
    revision: i64,
    expected_item_count: i64,
    imported_item_count: i64,
    source_generation: i64,
    source_revision: i64,
    source_digest: String,
}

impl From<LibraryCoreStoreStatus> for DesktopLibraryStatus {
    fn from(status: LibraryCoreStoreStatus) -> Self {
        Self {
            active: status.active,
            revision: status.revision,
            expected_item_count: status.expected_item_count,
            imported_item_count: status.imported_item_count,
            source_generation: status.source_generation,
            source_revision: status.source_revision,
            source_digest: status.source_digest,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopNormalizedLibraryCloudIdentity {
    #[serde(flatten)]
    checkpoint: freed_library_core::NormalizedCheckpointExportDescriptorV2,
    local_actor_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AcceptPwaActorEnrollmentRequest {
    canonical_request_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AcceptPwaIntentRequest {
    canonical_envelope_json: Vec<String>,
    committed_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadPwaIntentResultOutboxRequest {
    library_id: String,
    epoch_id: String,
    limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AcknowledgePwaIntentResultOutboxRequest {
    result_operation_ids: Vec<String>,
    acknowledged_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReassignNormalizedWriterEpochRequest {
    canonical_source_control_json: String,
    target_writer_id: String,
    installation_witness: String,
    accepted_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ListActorEnrollmentsRequest {
    library_id: String,
    epoch_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SetCloudWriterAdmissionRequest {
    local_writer_id: String,
    active_writer_id: String,
    storage_epoch: String,
    control_revision: String,
    verified_at_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CloudWriterAdmissionStatus {
    configured: bool,
    allowed: bool,
    local_writer_id: Option<String>,
    active_writer_id: Option<String>,
    storage_epoch: Option<String>,
    control_revision: Option<String>,
    verified_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct DesktopLibraryCausalTip {
    actor_id: String,
    sequence: i64,
    operation_id: String,
    chain_digest: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct DesktopLibraryAcceptedAuthority {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    authority_key_id: String,
    authority_public_key: String,
    observed_frontier: Vec<DesktopLibraryCausalTip>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct DesktopLibraryActorEnrollment {
    actor_id: String,
    actor_public_key: String,
    enrollment_operation_id: String,
    enrollment_certificate_digest: String,
    canonical_enrollment_certificate_json: String,
    actor_chain_genesis: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct DesktopLibraryActorCheckpointState {
    actor_id: String,
    accepted_sequence: i64,
    accepted_operation_id: Option<String>,
    accepted_chain_digest: String,
    enrollment_certificate_digest: String,
    retired: bool,
    retirement_certificate_digest: Option<String>,
    canonical_enrollment_certificate_json: String,
}


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerOverlayReplayReceipt {
    transaction_count: i64,
    operation_count: i64,
    materialized_row_count: i64,
    revision_advanced: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PrepareFollowerActorRequest {
    created_at_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerActorRequest {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    enrollment_request_digest: String,
    canonical_enrollment_request_json: String,
    created_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct InstallFollowerActorEnrollmentRequest {
    canonical_enrollment_certificate_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerActorEnrollment {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    enrollment_certificate_digest: String,
    actor_chain_genesis: String,
    enrolled_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SignFollowerOperationRequest {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    operation_signing_body_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SignNormalizedOperationRequest {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    operation_signing_body_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CommitNormalizedTransactionRequest {
    library_id: String,
    canonical_envelope_json: Vec<String>,
    committed_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EnqueueFollowerIntentRequest {
    canonical_envelope_json: Vec<String>,
    enqueued_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RecordNormalizedFollowerIntentPublicationRequest {
    transaction_id: String,
    transaction_digest: String,
    actor_id: String,
    published_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerOperationSignature {
    actor_id: String,
    operation_signing_body_digest: String,
    signature: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryOperationSignature {
    actor_id: String,
    operation_signing_body_digest: String,
    signature: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopNormalizedMutationReceipt {
    transaction_id: String,
    transaction_digest: String,
    actor_id: String,
    member_count: usize,
    first_counter: i64,
    last_counter: i64,
    committed_operation_id: String,
    committed_chain_digest: String,
    previous_revision: i64,
    committed_revision: i64,
    committed_at: i64,
    follower_result_digest: String,
    follower_result_sequence: i64,
    canonical_follower_result_json: String,
    invalidations: Vec<freed_library_core::NormalizedMutationInvalidationV1>,
}

impl TryFrom<NormalizedMutationReceiptV1> for DesktopNormalizedMutationReceipt {
    type Error = String;

    fn try_from(receipt: NormalizedMutationReceiptV1) -> Result<Self, Self::Error> {
        Ok(Self {
            transaction_id: receipt.transaction_id,
            transaction_digest: receipt.transaction_digest,
            actor_id: receipt.actor_id,
            member_count: receipt.member_count,
            first_counter: receipt.first_counter,
            last_counter: receipt.last_counter,
            committed_operation_id: receipt.committed_operation_id,
            committed_chain_digest: receipt.committed_chain_digest,
            previous_revision: receipt.previous_revision,
            committed_revision: receipt.committed_revision,
            committed_at: receipt.committed_at,
            follower_result_digest: receipt.follower_result_digest,
            follower_result_sequence: receipt.follower_result_sequence,
            canonical_follower_result_json: String::from_utf8(receipt.canonical_follower_result)
                .map_err(|_| "normalized mutation result is not canonical UTF-8".to_string())?,
            invalidations: receipt.invalidations,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerIntentReceipt {
    transaction_id: String,
    first_intent_sequence: i64,
    last_intent_sequence: i64,
    operation_count: i64,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerIntentContext {
    authority: DesktopLibraryAcceptedAuthority,
    actor_id: String,
    actor_public_key: String,
    next_intent_sequence: i64,
    previous_operation_id: Option<String>,
    previous_chain_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerRuntimeStatus {
    state: &'static str,
    library_id: Option<String>,
    epoch_id: Option<String>,
    actor_id: Option<String>,
    checkpoint_generation: Option<i64>,
    remote_ingest_sequence: Option<i64>,
    pending_intent_count: i64,
    published_intent_count: i64,
    imported_result_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadFollowerIntentOutboxRequest {
    maximum_operations: usize,
    maximum_canonical_envelope_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerIntentOutboxEntry {
    operation_id: String,
    intent_sequence: i64,
    canonical_envelope_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerIntentOutboxCandidate {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    schema_version: i64,
    first_intent_sequence: i64,
    last_intent_sequence: i64,
    previous_segment_digest: Option<String>,
    canonical_envelope_bytes: i64,
    transaction_count: i64,
    entries: Vec<DesktopLibraryFollowerIntentOutboxEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RecordFollowerIntentPublicationRequest {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    first_intent_sequence: i64,
    last_intent_sequence: i64,
    previous_segment_digest: Option<String>,
    published_segment_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerIntentPublicationReceipt {
    first_intent_sequence: i64,
    last_intent_sequence: i64,
    operation_count: i64,
    published_segment_digest: String,
    status: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadFollowerResultImportCursorRequest {
    library_id: String,
    epoch_id: String,
    actor_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerResultImportCursor {
    next_result_sequence: i64,
    latest_segment_digest: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AppendFollowerIntentResultRequest {
    result_operation_id: String,
    result_sequence: i64,
    intent_operation_id: String,
    intent_sequence: i64,
    status: String,
    provider_receipt_digest: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AppendFollowerResultSegmentRequest {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    first_result_sequence: i64,
    last_result_sequence: i64,
    previous_segment_digest: Option<String>,
    segment_digest: String,
    entries: Vec<AppendFollowerIntentResultRequest>,
    imported_at_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFollowerResultImportReceipt {
    first_result_sequence: i64,
    last_result_sequence: i64,
    result_count: i64,
    segment_digest: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopNormalizedWriterEpochReassignment {
    authority: DesktopLibraryAcceptedAuthority,
    canonical_epoch_certificate_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryFacetSummary {
    archived_count: i64,
    sample_item_count: i64,
    saved_archived_count: i64,
    saved_count: i64,
    saved_platform_count: i64,
    tags: Vec<String>,
    total_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopBackupSummary {
    backup_id: String,
    file_name: String,
    created_at_ms: i64,
    revision: i64,
    item_count: i64,
    reason: String,
    byte_length: u64,
    sha256: String,
}

impl From<LibraryCoreBackupReceipt> for DesktopBackupSummary {
    fn from(receipt: LibraryCoreBackupReceipt) -> Self {
        Self {
            backup_id: receipt.backup_id,
            file_name: receipt.file_name,
            created_at_ms: receipt.created_at_ms,
            revision: receipt.revision,
            item_count: receipt.item_count,
            reason: receipt.reason,
            byte_length: receipt.byte_length,
            sha256: receipt.sha256,
        }
    }
}

impl From<LibraryCoreBackupRecord> for DesktopBackupSummary {
    fn from(record: LibraryCoreBackupRecord) -> Self {
        Self {
            backup_id: record.backup_id,
            file_name: record.file_name,
            created_at_ms: record.created_at_ms,
            revision: record.revision,
            item_count: record.item_count,
            reason: record.reason,
            byte_length: record.byte_length,
            sha256: record.sha256,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadDesktopBackupChunkRequest {
    backup_id: String,
    offset: u64,
    limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopBackupChunk {
    backup_id: String,
    bytes: Vec<u8>,
    next_offset: Option<u64>,
    offset: u64,
    sha256: String,
    total_byte_length: u64,
}

impl From<NativeLibraryCoreBackupChunk> for DesktopBackupChunk {
    fn from(chunk: NativeLibraryCoreBackupChunk) -> Self {
        Self {
            backup_id: chunk.backup_id,
            bytes: chunk.bytes,
            next_offset: chunk.next_offset,
            offset: chunk.offset,
            sha256: chunk.sha256,
            total_byte_length: chunk.total_byte_length,
        }
    }
}

fn app_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn journal_path(root: &Path) -> PathBuf {
    root.join(JOURNAL_DIRECTORY).join(JOURNAL_FILE)
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(path)?;
        }
        Err(error) => return Err(error),
    }

    let directory = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Library Core storage root is not a physical directory",
        ));
    }
    if metadata.permissions().mode() & 0o7777 != 0o700 {
        directory.set_permissions(fs::Permissions::from_mode(0o700))?;
    }
    if directory.metadata()?.permissions().mode() & 0o7777 != 0o700 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Library Core storage root is not private",
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

fn open_database_at(root: &Path) -> Result<Connection, String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding.connect().map_err(|error| error.to_string());
    }
    create_private_directory(&root.join(JOURNAL_DIRECTORY)).map_err(|error| error.to_string())?;
    let path = journal_path(root);
    drop(LibraryCoreJournal::open(&path).map_err(|error| error.to_string())?);
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA trusted_schema = OFF;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn open_journal_at(root: &Path) -> Result<LibraryCoreJournal, String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding.open_journal().map_err(|error| error.to_string());
    }
    LibraryCoreJournal::open(&journal_path(root)).map_err(|error| error.to_string())
}

fn open_store_at(root: &Path) -> Result<LibraryCoreStore, String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding.store().cloned().map_err(|error| error.to_string());
    }
    LibraryCoreStore::open(root).map_err(|error| error.to_string())
}

fn open_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    open_database_at(&app_root(app)?)
}

fn open_normalized_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding
            .connect_normalized()
            .map_err(|error| error.to_string());
    }
    let directory = app_root(app)?.join(NORMALIZED_LIBRARY_DIRECTORY);
    create_private_directory(&directory).map_err(|error| error.to_string())?;
    let connection = Connection::open_with_flags(
        directory.join(JOURNAL_FILE),
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_EXRESCODE,
    )
    .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA trusted_schema = OFF;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|error| error.to_string())?;
    freed_library_core::install_normalized_schema_v1(&connection)
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn open_selected_normalized_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding
            .connect_selected_normalized()
            .map_err(|error| error.to_string());
    }
    let _ = app;
    Err("normalized SQLite authority selection is unavailable on this host".into())
}

#[cfg(unix)]
pub(super) fn complete_normalized_desktop_cutover_if_ready() -> Result<bool, String> {
    let binding = freed_library_core::desktop_binding().map_err(|error| error.to_string())?;
    if binding
        .normalized_authority_is_selected_v1()
        .map_err(|error| error.to_string())?
    {
        return Ok(false);
    }
    let mut source = binding.connect().map_err(|error| error.to_string())?;
    let source_state: Option<(i64, i64, i64, Option<i64>)> = source
        .query_row(
            "SELECT active, expectedItemCount, importedItemCount, activatedAtMs
             FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((active, expected_items, imported_items, activated_at)) = source_state else {
        return Ok(false);
    };
    if active == 0 && activated_at.is_none() {
        return Ok(false);
    }
    if active != 1 || activated_at.is_none() || expected_items != imported_items {
        return Err("historical Library is not a complete migration source".to_owned());
    }
    let mut target = binding
        .connect_normalized()
        .map_err(|error| error.to_string())?;
    let installation_witness = crate::get_desktop_installation_witness()?;
    let accepted_at = i64::try_from(crate::unix_millis_now())
        .map_err(|_| "Desktop cutover time is invalid".to_owned())?;
    let prepared = freed_library_core::prepare_normalized_desktop_cutover_v1(
        &mut source,
        &mut target,
        &installation_witness,
        &PlatformActorKeyStore,
        &PlatformAuthorityKeyStore,
        accepted_at,
    )
    .map_err(|error| error.to_string())?;
    binding
        .publish_normalized_authority_selection_v1(&prepared)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(unix)]
#[tauri::command]
pub(super) fn ensure_fresh_normalized_desktop_library(
    legacy_data_absent: bool,
) -> Result<bool, String> {
    let binding = freed_library_core::desktop_binding().map_err(|error| error.to_string())?;
    if binding
        .normalized_authority_is_selected_v1()
        .map_err(|error| error.to_string())?
    {
        return Ok(true);
    }
    if !legacy_data_absent {
        return Ok(false);
    }
    let source = binding.connect().map_err(|error| error.to_string())?;
    let source_state: Option<i64> = source
        .query_row(
            "SELECT singletonId FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if source_state.is_some() {
        return Ok(false);
    }
    let mut tables = source
        .prepare(
            "SELECT name FROM sqlite_schema
             WHERE type = 'table' AND name LIKE 'library_core_%'
             ORDER BY name;",
        )
        .map_err(|error| error.to_string())?;
    let table_names = tables
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(tables);
    for table_name in table_names {
        if table_name == "library_core_meta" {
            continue;
        }
        if !table_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err("historical Library table identity is invalid".into());
        }
        let occupied: i64 = source
            .query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM \"{table_name}\" LIMIT 1);"),
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if occupied != 0 {
            return Ok(false);
        }
    }
    drop(source);
    let mut target = binding
        .connect_normalized()
        .map_err(|error| error.to_string())?;
    let installation_witness = crate::get_desktop_installation_witness()?;
    let accepted_at = i64::try_from(crate::unix_millis_now())
        .map_err(|_| "Desktop fresh Library time is invalid".to_owned())?;
    let prepared = freed_library_core::prepare_fresh_normalized_desktop_library_v1(
        &mut target,
        &installation_witness,
        &PlatformActorKeyStore,
        &PlatformAuthorityKeyStore,
        accepted_at,
    )
    .map_err(|error| error.to_string())?;
    binding
        .publish_normalized_authority_selection_v1(&prepared)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub(super) fn query_normalized_library(
    app: tauri::AppHandle,
    request: Value,
) -> Result<Value, String> {
    let mut connection = open_normalized_database(&app)?;
    freed_library_core::query_normalized_json_v1(&mut connection, request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn describe_normalized_library_checkpoint(
    app: tauri::AppHandle,
) -> Result<freed_library_core::NormalizedCheckpointExportDescriptorV2, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::describe_normalized_checkpoint_export_v2(&connection)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn describe_normalized_library_cloud_identity(
    app: tauri::AppHandle,
    installation_witness: String,
) -> Result<DesktopNormalizedLibraryCloudIdentity, String> {
    let connection = open_selected_normalized_database(&app)?;
    let checkpoint = freed_library_core::describe_normalized_checkpoint_export_v2(&connection)
        .map_err(|error| error.to_string())?;
    let local_actor_id = load_or_create_normalized_actor_id_v2(
        &checkpoint.library_id,
        &installation_witness,
        &PlatformActorKeyStore,
    )?;
    Ok(DesktopNormalizedLibraryCloudIdentity {
        checkpoint,
        local_actor_id,
    })
}

#[tauri::command]
pub(super) fn read_normalized_library_checkpoint_page(
    app: tauri::AppHandle,
    request: freed_library_core::PinnedNormalizedCheckpointExportRequestV2,
) -> Result<freed_library_core::NormalizedCheckpointExportPageV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::export_pinned_normalized_checkpoint_page_v2(&mut connection, &request)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AppendNormalizedLibraryCheckpointPageRequest {
    stage_id: String,
    records: Vec<freed_library_core::NormalizedCheckpointRecordV2>,
}

#[tauri::command]
pub(super) fn begin_normalized_library_checkpoint_import(
    app: tauri::AppHandle,
    request: freed_library_core::BeginNormalizedCheckpointStageV2,
) -> Result<freed_library_core::NormalizedCheckpointStageStatusV2, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::begin_normalized_checkpoint_stage_v2(&connection, &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn append_normalized_library_checkpoint_import_page(
    app: tauri::AppHandle,
    request: AppendNormalizedLibraryCheckpointPageRequest,
) -> Result<freed_library_core::NormalizedCheckpointStageStatusV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::append_normalized_checkpoint_stage_page_v2(
        &mut connection,
        &request.stage_id,
        &request.records,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn activate_normalized_library_checkpoint_import(
    app: tauri::AppHandle,
    request: ActivateNormalizedLibraryCheckpointImportRequest,
) -> Result<freed_library_core::NormalizedCheckpointActivationReceiptV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    match request.follower_receipt {
        Some(receipt) => freed_library_core::replace_with_normalized_follower_checkpoint_stage_v2(
            &mut connection,
            &request.stage_id,
            &receipt,
        ),
        None => freed_library_core::replace_with_normalized_checkpoint_stage_v2(
            &mut connection,
            &request.stage_id,
        ),
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn normalized_library_follower_runtime_status(
    app: tauri::AppHandle,
) -> Result<freed_library_core::NormalizedFollowerRuntimeStatusV2, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::normalized_follower_runtime_status_v2(&connection)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn prepare_normalized_library_follower_actor_request(
    app: tauri::AppHandle,
    created_at: i64,
) -> Result<freed_library_core::NormalizedFollowerActorRequestV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    let installation_witness = crate::get_desktop_installation_witness()?;
    freed_library_core::prepare_normalized_follower_actor_request_v2(
        &mut connection,
        &installation_witness,
        &PlatformActorKeyStore,
        created_at,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn install_normalized_library_follower_actor_enrollment(
    app: tauri::AppHandle,
    canonical_enrollment_certificate_json: String,
) -> Result<freed_library_core::NormalizedFollowerActorEnrollmentV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::install_normalized_follower_actor_enrollment_v2(
        &mut connection,
        canonical_enrollment_certificate_json.as_bytes(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn countersign_normalized_library_follower_actor_request(
    app: tauri::AppHandle,
    canonical_enrollment_request_json: String,
    accepted_at: i64,
) -> Result<freed_library_core::NormalizedFollowerActorEnrollmentV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::countersign_normalized_follower_actor_request_v2(
        &mut connection,
        canonical_enrollment_request_json.as_bytes(),
        &PlatformAuthorityKeyStore,
        accepted_at,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn normalized_library_follower_mutation_context(
    app: tauri::AppHandle,
) -> Result<NormalizedMutationContextV1, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::normalized_follower_mutation_context_v1(&connection)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn sign_normalized_library_follower_operation(
    app: tauri::AppHandle,
    request: SignNormalizedOperationRequest,
) -> Result<DesktopLibraryOperationSignature, String> {
    let connection = open_selected_normalized_database(&app)?;
    let context = freed_library_core::normalized_follower_mutation_context_v1(&connection)
        .map_err(|error| error.to_string())?;
    if request.library_id != context.library_id
        || request.epoch_id != context.epoch_id
        || request.actor_id != context.actor_id
        || request.actor_public_key != context.actor_public_key
    {
        return Err("normalized follower signer context changed".into());
    }
    let signature = sign_library_core_operation_digest(
        &PlatformActorKeyStore,
        &context.library_id,
        &context.actor_public_key,
        &request.operation_signing_body_digest,
    )?;
    Ok(DesktopLibraryOperationSignature {
        actor_id: context.actor_id,
        operation_signing_body_digest: request.operation_signing_body_digest,
        signature,
    })
}

#[tauri::command]
pub(super) fn enqueue_normalized_library_follower_intent(
    app: tauri::AppHandle,
    request: EnqueueFollowerIntentRequest,
) -> Result<freed_library_core::NormalizedFollowerIntentCommitReceiptV1, String> {
    use freed_library_core::sqlite_contract_generated::{
        CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES, OPERATION_TRANSACTION_MAXIMUM_BYTES,
        OPERATION_TRANSACTION_MAXIMUM_MEMBERS,
    };
    if request.enqueued_at_ms < 0
        || request.canonical_envelope_json.is_empty()
        || request.canonical_envelope_json.len() > OPERATION_TRANSACTION_MAXIMUM_MEMBERS
        || request.canonical_envelope_json.iter().any(|member| {
            member.is_empty() || member.len() > CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES
        })
        || request
            .canonical_envelope_json
            .iter()
            .try_fold(0_usize, |total, member| total.checked_add(member.len()))
            .is_none_or(|total| total > OPERATION_TRANSACTION_MAXIMUM_BYTES)
    {
        return Err("normalized follower intent exceeds its closed bounds".into());
    }
    let mut connection = open_selected_normalized_database(&app)?;
    let canonical = request
        .canonical_envelope_json
        .into_iter()
        .map(String::into_bytes)
        .collect::<Vec<_>>();
    freed_library_core::enqueue_normalized_follower_intent_v1(
        &mut connection,
        &canonical,
        request.enqueued_at_ms,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn read_normalized_library_follower_intent_page(
    app: tauri::AppHandle,
    request: freed_library_core::NormalizedFollowerIntentPageRequestV1,
) -> Result<freed_library_core::NormalizedFollowerIntentPageV1, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::export_normalized_follower_intent_page_v1(&connection, &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn record_normalized_library_follower_intent_publication(
    app: tauri::AppHandle,
    request: RecordNormalizedFollowerIntentPublicationRequest,
) -> Result<freed_library_core::NormalizedFollowerIntentPublicationReceiptV1, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::record_normalized_follower_intent_publication_v1(
        &mut connection,
        &request.transaction_id,
        &request.transaction_digest,
        &request.actor_id,
        request.published_at,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn record_normalized_library_follower_intent_transport_publication(
    app: tauri::AppHandle,
    publication: freed_library_core::NormalizedFollowerIntentTransportPublicationV2,
) -> Result<freed_library_core::NormalizedFollowerIntentTransportPublicationReceiptV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::record_normalized_follower_intent_transport_publication_v2(
        &mut connection,
        &publication,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn ingest_normalized_library_follower_intent_page(
    app: tauri::AppHandle,
    page: freed_library_core::NormalizedFollowerIntentStagePageV1,
    received_at: i64,
) -> Result<freed_library_core::NormalizedFollowerIntentStageReceiptV1, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    let context =
        normalized_primary_mutation_context_v1(&connection).map_err(|error| error.to_string())?;
    let authority_key_pair = load_established_authority_key_pair(&context.library_id)?;
    freed_library_core::ingest_normalized_follower_intent_page_v1(
        &mut connection,
        &page,
        &authority_key_pair,
        received_at,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn read_normalized_library_follower_result_page(
    app: tauri::AppHandle,
    request: freed_library_core::NormalizedFollowerResultPageRequestV1,
) -> Result<freed_library_core::NormalizedFollowerResultPageV1, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::export_normalized_follower_result_page_v1(&connection, &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn import_normalized_library_follower_result_page(
    app: tauri::AppHandle,
    records: Vec<freed_library_core::NormalizedFollowerResultRecordV1>,
    received_at: i64,
) -> Result<freed_library_core::NormalizedFollowerResultImportReceiptV1, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::import_normalized_follower_result_page_v1(
        &mut connection,
        &records,
        received_at,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn import_normalized_library_follower_result_transport_segment(
    app: tauri::AppHandle,
    publication: freed_library_core::NormalizedFollowerResultTransportImportV2,
) -> Result<freed_library_core::NormalizedFollowerResultTransportImportReceiptV2, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    freed_library_core::import_normalized_follower_result_transport_segment_v2(
        &mut connection,
        &publication,
    )
    .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ActivateNormalizedLibraryCheckpointImportRequest {
    stage_id: String,
    follower_receipt: Option<freed_library_core::NormalizedFollowerCheckpointReceiptV2>,
}

#[tauri::command]
pub(super) fn reassign_normalized_library_writer_epoch(
    app: tauri::AppHandle,
    request: ReassignNormalizedWriterEpochRequest,
) -> Result<DesktopNormalizedWriterEpochReassignment, String> {
    let mut connection = open_selected_normalized_database(&app)?;
    let reassigned = freed_library_core::reassign_normalized_writer_epoch_v2(
        &mut connection,
        &request.canonical_source_control_json,
        &request.target_writer_id,
        &request.installation_witness,
        &PlatformActorKeyStore,
        &PlatformAuthorityKeyStore,
        request.accepted_at_ms,
    )
    .map_err(|error| error.to_string())?;
    Ok(DesktopNormalizedWriterEpochReassignment {
        authority: DesktopLibraryAcceptedAuthority {
            library_id: reassigned.authority.library_id,
            epoch: reassigned.authority.epoch,
            epoch_id: reassigned.authority.epoch_id,
            authority_key_id: reassigned.authority.authority_key_id,
            authority_public_key: reassigned.authority.authority_public_key,
            observed_frontier: reassigned
                .authority
                .observed_frontier
                .into_iter()
                .map(|tip| DesktopLibraryCausalTip {
                    actor_id: tip.actor_id,
                    sequence: tip.sequence,
                    operation_id: tip.operation_id,
                    chain_digest: tip.chain_digest,
                })
                .collect(),
        },
        canonical_epoch_certificate_json: reassigned.canonical_certificate_json,
    })
}

/// Read the exact admitted Primary actor tip for one normalized transaction.
#[tauri::command]
pub(super) fn normalized_library_primary_mutation_context(
    app: tauri::AppHandle,
) -> Result<NormalizedMutationContextV1, String> {
    let connection = open_selected_normalized_database(&app)?;
    normalized_primary_mutation_context_v1(&connection).map_err(|error| error.to_string())
}

/// Sign one finalized normalized operation with the native Primary actor key.
#[tauri::command]
pub(super) fn sign_normalized_library_operation(
    app: tauri::AppHandle,
    request: SignNormalizedOperationRequest,
) -> Result<DesktopLibraryOperationSignature, String> {
    let connection = open_selected_normalized_database(&app)?;
    let context =
        normalized_primary_mutation_context_v1(&connection).map_err(|error| error.to_string())?;
    if request.library_id != context.library_id
        || request.epoch_id != context.epoch_id
        || request.actor_id != context.actor_id
        || request.actor_public_key != context.actor_public_key
    {
        return Err("normalized mutation signer context changed".into());
    }
    let signature = sign_library_core_operation_digest(
        &PlatformActorKeyStore,
        &context.library_id,
        &context.actor_public_key,
        &request.operation_signing_body_digest,
    )?;
    Ok(DesktopLibraryOperationSignature {
        actor_id: context.actor_id,
        operation_signing_body_digest: request.operation_signing_body_digest,
        signature,
    })
}

/// Verify and commit one complete Primary transaction into normalized SQLite.
#[tauri::command]
pub(super) fn commit_normalized_library_transaction(
    app: tauri::AppHandle,
    request: CommitNormalizedTransactionRequest,
) -> Result<DesktopNormalizedMutationReceipt, String> {
    use freed_library_core::sqlite_contract_generated::{
        CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES, OPERATION_TRANSACTION_MAXIMUM_BYTES,
        OPERATION_TRANSACTION_MAXIMUM_MEMBERS,
    };

    if request.committed_at_ms < 0
        || request.canonical_envelope_json.is_empty()
        || request.canonical_envelope_json.len() > OPERATION_TRANSACTION_MAXIMUM_MEMBERS
        || request.canonical_envelope_json.iter().any(|member| {
            member.is_empty() || member.len() > CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES
        })
        || request
            .canonical_envelope_json
            .iter()
            .try_fold(0_usize, |total, member| total.checked_add(member.len()))
            .is_none_or(|total| total > OPERATION_TRANSACTION_MAXIMUM_BYTES)
    {
        return Err("normalized mutation transaction exceeds its closed bounds".into());
    }
    let mut connection = open_selected_normalized_database(&app)?;
    let context =
        normalized_primary_mutation_context_v1(&connection).map_err(|error| error.to_string())?;
    if request.library_id != context.library_id {
        return Err("normalized mutation Library identity changed".into());
    }
    let authority_key_pair = load_established_authority_key_pair(&context.library_id)?;
    let canonical_envelopes = request
        .canonical_envelope_json
        .into_iter()
        .map(String::into_bytes)
        .collect::<Vec<_>>();
    accept_normalized_operation_transaction_v1(
        &mut connection,
        &canonical_envelopes,
        &authority_key_pair,
        request.committed_at_ms,
    )
    .map_err(|error| error.to_string())?
    .try_into()
}

fn scope_action_sql(program_id: &str) -> Result<&'static str, String> {
    freed_library_core::sqlite_contract_generated::SQLITE_SCOPE_ACTION_PROGRAMS
        .iter()
        .find_map(|(id, sql)| (*id == program_id).then_some(*sql))
        .ok_or_else(|| format!("missing scope action program {program_id}"))
}

fn validate_scope_action_stage_id(stage_id: &str) -> bool {
    !stage_id.is_empty() && stage_id.len() <= 255
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScopeActionStageStatus {
    member_count: i64,
    stage_id: String,
    state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScopeActionStagePage {
    entity_ids: Vec<String>,
    next_ordinal: i64,
    stage_id: String,
}

#[tauri::command]
pub(super) fn begin_normalized_scope_action(
    app: tauri::AppHandle,
    stage_id: String,
    action_kind: String,
    request_digest: String,
    created_at: i64,
) -> Result<ScopeActionStageStatus, String> {
    if !validate_scope_action_stage_id(&stage_id)
        || !matches!(action_kind.as_str(), "archive" | "read")
        || !validate_hex_digest(&request_digest)
        || created_at < 0
    {
        return Err("normalized scope action identity is invalid".into());
    }
    let connection = open_normalized_database(&app)?;
    connection
        .execute(
            scope_action_sql("create")?,
            params![stage_id, action_kind, request_digest, created_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(ScopeActionStageStatus {
        member_count: 0,
        stage_id,
        state: "staging".into(),
    })
}

#[tauri::command]
pub(super) fn freeze_normalized_rss_feed_scope(
    app: tauri::AppHandle,
    stage_id: String,
    action_kind: String,
    request_digest: String,
    created_at: i64,
) -> Result<ScopeActionStageStatus, String> {
    if !validate_scope_action_stage_id(&stage_id)
        || !matches!(
            action_kind.as_str(),
            "rss_feeds_heal_untitled_frozen"
                | "rss_feeds_remove_keep_items"
                | "rss_feeds_remove_with_items"
        )
        || !validate_hex_digest(&request_digest)
        || created_at < 0
    {
        return Err("normalized RSS Feed scope identity is invalid".into());
    }
    let mut connection = open_normalized_database(&app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let existing = transaction
        .query_row(scope_action_sql("status")?, params![stage_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some((stored_action, stored_digest, state, member_count, stored_created_at)) = existing {
        if stored_action != action_kind
            || stored_digest != request_digest
            || state != "ready"
            || stored_created_at != created_at
        {
            return Err("normalized RSS Feed scope replay changed identity".into());
        }
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(ScopeActionStageStatus {
            member_count,
            stage_id,
            state,
        });
    }
    transaction
        .execute(
            scope_action_sql("create")?,
            params![stage_id, action_kind, request_digest, created_at],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            scope_action_sql("freezeRssFeeds")?,
            params![stage_id, action_kind],
        )
        .map_err(|error| error.to_string())?;
    let member_count = transaction
        .query_row(
            "SELECT count(*) FROM library_device_scope_action_members WHERE action_id = ?1;",
            params![stage_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE library_device_scope_actions SET member_count = ?2 WHERE action_id = ?1;",
            params![stage_id, member_count],
        )
        .map_err(|error| error.to_string())?;
    if transaction
        .execute(
            scope_action_sql("finalize")?,
            params![stage_id, member_count],
        )
        .map_err(|error| error.to_string())?
        != 1
    {
        return Err("normalized RSS Feed scope could not finalize".into());
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(ScopeActionStageStatus {
        member_count,
        stage_id,
        state: "ready".into(),
    })
}

#[tauri::command]
pub(super) fn append_normalized_scope_action(
    app: tauri::AppHandle,
    stage_id: String,
    expected_ordinal: i64,
    entity_ids: Vec<String>,
) -> Result<ScopeActionStageStatus, String> {
    if !validate_scope_action_stage_id(&stage_id)
        || expected_ordinal < 0
        || entity_ids.is_empty()
        || entity_ids.len() > 256
        || entity_ids.iter().any(|id| id.is_empty() || id.len() > 4096)
    {
        return Err("normalized scope action append is invalid".into());
    }
    let mut connection = open_normalized_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let status: (String, i64) = transaction
        .query_row(scope_action_sql("status")?, params![stage_id], |row| {
            Ok((row.get(2)?, row.get(3)?))
        })
        .map_err(|error| error.to_string())?;
    if status.0 != "staging" || status.1 != expected_ordinal {
        return Err("normalized scope action append fence is stale".into());
    }
    let ids_json = serde_json::to_string(&entity_ids).map_err(|error| error.to_string())?;
    transaction
        .execute(
            scope_action_sql("append")?,
            params![stage_id, expected_ordinal, ids_json],
        )
        .map_err(|error| error.to_string())?;
    let member_count = expected_ordinal
        .checked_add(i64::try_from(entity_ids.len()).map_err(|error| error.to_string())?)
        .ok_or_else(|| "normalized scope action count overflow".to_string())?;
    transaction
        .execute(
            "UPDATE library_device_scope_actions SET member_count = ?2 WHERE action_id = ?1;",
            params![stage_id, member_count],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(ScopeActionStageStatus {
        member_count,
        stage_id,
        state: "staging".into(),
    })
}

#[tauri::command]
pub(super) fn finalize_normalized_scope_action(
    app: tauri::AppHandle,
    stage_id: String,
    expected_member_count: i64,
) -> Result<ScopeActionStageStatus, String> {
    if !validate_scope_action_stage_id(&stage_id) || expected_member_count < 0 {
        return Err("normalized scope action final count is invalid".into());
    }
    let connection = open_normalized_database(&app)?;
    let changed = connection
        .execute(
            scope_action_sql("finalize")?,
            params![stage_id, expected_member_count],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err("normalized scope action could not finalize".into());
    }
    Ok(ScopeActionStageStatus {
        member_count: expected_member_count,
        stage_id,
        state: "ready".into(),
    })
}

#[tauri::command]
pub(super) fn page_normalized_scope_action(
    app: tauri::AppHandle,
    stage_id: String,
    after_ordinal: i64,
) -> Result<ScopeActionStagePage, String> {
    if !validate_scope_action_stage_id(&stage_id) || after_ordinal < -1 {
        return Err("normalized scope action page cursor is invalid".into());
    }
    let connection = open_normalized_database(&app)?;
    let mut statement = connection
        .prepare(scope_action_sql("page")?)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![stage_id, after_ordinal, 1_000_i64], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut next_ordinal = after_ordinal;
    let mut entity_ids = Vec::new();
    for row in rows {
        let (ordinal, entity_id) = row.map_err(|error| error.to_string())?;
        next_ordinal = ordinal;
        entity_ids.push(entity_id);
    }
    Ok(ScopeActionStagePage {
        entity_ids,
        next_ordinal,
        stage_id,
    })
}

#[tauri::command]
pub(super) fn close_normalized_scope_action(
    app: tauri::AppHandle,
    stage_id: String,
) -> Result<(), String> {
    if !validate_scope_action_stage_id(&stage_id) {
        return Err("normalized scope action identity is invalid".into());
    }
    let connection = open_normalized_database(&app)?;
    connection
        .execute(scope_action_sql("delete")?, params![stage_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn require_active(connection: &Connection) -> Result<(), String> {
    let active = connection
        .query_row(
            "SELECT active FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if active != Some(1) {
        return Err("SQLite Library is not active".into());
    }
    Ok(())
}

#[tauri::command]
pub(super) fn sqlite_library_status(
    app: tauri::AppHandle,
) -> Result<Option<DesktopLibraryStatus>, String> {
    let status: Option<DesktopLibraryStatus> = open_store_at(&app_root(&app)?)?
        .status()
        .map_err(|error| error.to_string())?
        .map(Into::into);
    if let Some(status) = &status {
        log::info!(
            "[library-core] SQLite Library status active={} revision={} items={}/{}",
            status.active,
            status.revision,
            status.imported_item_count,
            status.expected_item_count
        );
    }
    Ok(status)
}

#[tauri::command]
pub(super) fn recover_sqlite_library_follower_overlay(
    app: tauri::AppHandle,
) -> Result<DesktopLibraryFollowerOverlayReplayReceipt, String> {
    let replay = replay_sqlite_library_follower_overlay_at(&app_root(&app)?)?;
    Ok(DesktopLibraryFollowerOverlayReplayReceipt {
        transaction_count: replay.transaction_count,
        operation_count: replay.operation_count,
        materialized_row_count: replay.materialized_row_count,
        revision_advanced: replay.revision_advanced,
    })
}

fn replay_sqlite_library_follower_overlay_at(
    root: &Path,
) -> Result<FollowerOverlayReplayReceipt, String> {
    let mut journal = open_journal_at(root)?;
    journal
        .replay_pending_follower_overlay()
        .map_err(|error| format!("SQLite Library refused follower overlay replay: {error}"))
}

fn follower_actor_request_response(
    request: StoredFollowerActorRequest,
) -> DesktopLibraryFollowerActorRequest {
    DesktopLibraryFollowerActorRequest {
        library_id: request.library_id,
        epoch_id: request.epoch_id,
        actor_id: request.actor_id,
        actor_public_key: request.actor_public_key,
        enrollment_request_digest: request.enrollment_request_digest,
        canonical_enrollment_request_json: request.canonical_enrollment_request_json,
        created_at_ms: request.created_at_ms,
    }
}

/// Prepare one stable actor proof for the active follower anchor.
///
/// The exact request is committed before it is returned. A response-loss retry
/// returns those same bytes rather than signing a second request with a new
/// timestamp. No authority signature, writer admission, or provider I/O is
/// available on this path.
#[tauri::command]
pub(super) fn prepare_sqlite_library_follower_actor_request(
    app: tauri::AppHandle,
    request: PrepareFollowerActorRequest,
) -> Result<DesktopLibraryFollowerActorRequest, String> {
    if request.created_at_ms < 0 {
        return Err("SQLite Library follower actor request time is invalid".into());
    }
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    let anchor = journal
        .follower_anchor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "SQLite Library has no verified follower anchor".to_string())?;
    if let Some(existing) = journal
        .follower_actor_request(&anchor.authority.library_id, &anchor.authority.epoch_id)
        .map_err(|error| error.to_string())?
    {
        return Ok(follower_actor_request_response(existing));
    }
    let installation_witness = crate::get_desktop_installation_witness()?;
    let prepared = prepare_follower_actor_enrollment_request(
        &EnrollmentAuthority {
            library_id: anchor.authority.library_id.clone(),
            epoch: anchor.authority.epoch,
            epoch_id: anchor.authority.epoch_id.clone(),
            authority_key_id: anchor.authority.authority_key_id,
            installation_witness,
        },
        &PlatformActorKeyStore,
        request.created_at_ms,
    )?;
    let stored = journal
        .store_follower_actor_request(&StoredFollowerActorRequest {
            library_id: anchor.authority.library_id,
            epoch_id: anchor.authority.epoch_id,
            actor_id: prepared.actor_id,
            actor_public_key: prepared.actor_public_key,
            enrollment_request_digest: prepared.enrollment_request_digest,
            canonical_enrollment_request_json: prepared.canonical_enrollment_request_json,
            created_at_ms: request.created_at_ms,
        })
        .map_err(|error| format!("SQLite Library could not store follower actor: {error}"))?;
    Ok(follower_actor_request_response(stored))
}

fn follower_actor_enrollment_response(
    enrollment: StoredFollowerActorEnrollment,
) -> DesktopLibraryFollowerActorEnrollment {
    DesktopLibraryFollowerActorEnrollment {
        library_id: enrollment.library_id,
        epoch_id: enrollment.epoch_id,
        actor_id: enrollment.actor_id,
        actor_public_key: enrollment.actor_public_key,
        enrollment_certificate_digest: enrollment.enrollment_certificate_digest,
        actor_chain_genesis: enrollment.actor_chain_genesis,
        enrolled_at_ms: enrollment.enrolled_at_ms,
    }
}

/// Verify and install the exact authority-countersigned follower certificate.
///
/// Successful verification initializes only the isolated follower intent
/// chain. It never enrolls the actor into the canonical writer journal.
#[tauri::command]
pub(super) fn install_sqlite_library_follower_actor_enrollment(
    app: tauri::AppHandle,
    request: InstallFollowerActorEnrollmentRequest,
) -> Result<DesktopLibraryFollowerActorEnrollment, String> {
    if request.canonical_enrollment_certificate_json.is_empty()
        || request.canonical_enrollment_certificate_json.len() > 65_536
    {
        return Err("SQLite Library follower enrollment certificate size is invalid".into());
    }
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    let enrollment = journal
        .verify_and_install_follower_actor(request.canonical_enrollment_certificate_json.as_bytes())
        .map_err(|error| format!("SQLite Library refused follower enrollment: {error}"))?;
    Ok(follower_actor_enrollment_response(enrollment))
}

/// Sign one finalized follower operation body digest with the native actor key.
///
/// The caller still has to submit the complete canonical transaction to the
/// native outbox, where sequence, chain, schema, and operation semantics are
/// reverified before anything becomes durable.
#[tauri::command]
pub(super) fn sign_sqlite_library_follower_operation(
    app: tauri::AppHandle,
    request: SignFollowerOperationRequest,
) -> Result<DesktopLibraryFollowerOperationSignature, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let journal = open_journal_at(&root)?;
    let enrollment = journal
        .follower_actor_enrollment(&request.library_id, &request.epoch_id, &request.actor_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "SQLite Library follower actor is not enrolled".to_string())?;
    let signature = sign_library_core_operation_digest(
        &PlatformActorKeyStore,
        &request.library_id,
        &enrollment.actor_public_key,
        &request.operation_signing_body_digest,
    )?;
    Ok(DesktopLibraryFollowerOperationSignature {
        actor_id: request.actor_id,
        operation_signing_body_digest: request.operation_signing_body_digest,
        signature,
    })
}

fn follower_intent_receipt_response(
    receipt: FollowerIntentEnqueueReceipt,
) -> DesktopLibraryFollowerIntentReceipt {
    DesktopLibraryFollowerIntentReceipt {
        transaction_id: receipt.transaction_id,
        first_intent_sequence: receipt.first_intent_sequence,
        last_intent_sequence: receipt.last_intent_sequence,
        operation_count: receipt.operation_count,
        status: receipt.status,
    }
}

/// Verify and atomically enqueue one complete signed follower transaction.
///
/// Canonical operation semantics, signatures, actor sequence, actor chain,
/// transaction boundaries, and causal tips are checked again in native code.
#[tauri::command]
pub(super) fn enqueue_sqlite_library_follower_intent(
    app: tauri::AppHandle,
    request: EnqueueFollowerIntentRequest,
) -> Result<DesktopLibraryFollowerIntentReceipt, String> {
    if request.canonical_envelope_json.is_empty()
        || request.canonical_envelope_json.len() > 1_000
        || request.enqueued_at_ms < 0
    {
        return Err("SQLite Library follower intent request is invalid".into());
    }
    let canonical_envelopes = request
        .canonical_envelope_json
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    let receipt = journal
        .verify_and_enqueue_follower_intent(&canonical_envelopes, request.enqueued_at_ms)
        .map_err(|error| format!("SQLite Library refused follower intent: {error}"))?;
    Ok(follower_intent_receipt_response(receipt))
}

/// Read the exact native actor tip used to assemble the next follower intent.
#[tauri::command]
pub(super) fn sqlite_library_follower_intent_context(
    app: tauri::AppHandle,
) -> Result<Option<DesktopLibraryFollowerIntentContext>, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let journal = open_journal_at(&root)?;
    let Some(anchor) = journal
        .follower_anchor()
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let Some(actor) = journal
        .active_follower_actor_state()
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    Ok(Some(DesktopLibraryFollowerIntentContext {
        authority: DesktopLibraryAcceptedAuthority {
            library_id: anchor.authority.library_id,
            epoch: anchor.authority.epoch,
            epoch_id: anchor.authority.epoch_id,
            authority_key_id: anchor.authority.authority_key_id,
            authority_public_key: anchor.authority.authority_public_key,
            observed_frontier: anchor
                .authority
                .observed_frontier
                .into_iter()
                .map(|tip| DesktopLibraryCausalTip {
                    actor_id: tip.actor_id,
                    sequence: tip.sequence,
                    operation_id: tip.operation_id,
                    chain_digest: tip.chain_digest,
                })
                .collect(),
        },
        actor_id: actor.actor_id,
        actor_public_key: actor.actor_public_key,
        next_intent_sequence: actor.next_sequence,
        previous_operation_id: actor.previous_operation_id,
        previous_chain_digest: actor.previous_chain_digest,
    }))
}

/// Report the local follower checkpoint, enrollment, outbox, and result state
/// without reading or mutating any cloud transport.
#[tauri::command]
pub(super) fn sqlite_library_follower_runtime_status(
    app: tauri::AppHandle,
) -> Result<DesktopLibraryFollowerRuntimeStatus, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let journal = open_journal_at(&root)?;
    let FollowerRuntimeStatus {
        state,
        library_id,
        epoch_id,
        actor_id,
        checkpoint_generation,
        remote_ingest_sequence,
        pending_intent_count,
        published_intent_count,
        imported_result_count,
    } = journal
        .follower_runtime_status()
        .map_err(|error| format!("SQLite Library refused follower diagnostics: {error}"))?;
    Ok(DesktopLibraryFollowerRuntimeStatus {
        state,
        library_id,
        epoch_id,
        actor_id,
        checkpoint_generation,
        remote_ingest_sequence,
        pending_intent_count,
        published_intent_count,
        imported_result_count,
    })
}

fn follower_intent_outbox_response(
    candidate: FollowerIntentOutboxCandidate,
) -> DesktopLibraryFollowerIntentOutboxCandidate {
    DesktopLibraryFollowerIntentOutboxCandidate {
        library_id: candidate.library_id,
        epoch_id: candidate.epoch_id,
        actor_id: candidate.actor_id,
        schema_version: candidate.schema_version,
        first_intent_sequence: candidate.first_intent_sequence,
        last_intent_sequence: candidate.last_intent_sequence,
        previous_segment_digest: candidate.previous_segment_digest,
        canonical_envelope_bytes: candidate.canonical_envelope_bytes,
        transaction_count: candidate.transaction_count,
        entries: candidate
            .entries
            .into_iter()
            .map(|entry| DesktopLibraryFollowerIntentOutboxEntry {
                operation_id: entry.operation_id,
                intent_sequence: entry.intent_sequence,
                canonical_envelope_json: entry.canonical_envelope_json,
            })
            .collect(),
    }
}

/// Read one bounded, transaction-complete follower intent publication candidate.
#[tauri::command]
pub(super) fn read_sqlite_library_follower_intent_outbox_candidate(
    app: tauri::AppHandle,
    request: ReadFollowerIntentOutboxRequest,
) -> Result<Option<DesktopLibraryFollowerIntentOutboxCandidate>, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let journal = open_journal_at(&root)?;
    journal
        .follower_intent_outbox_candidate(
            request.maximum_operations,
            request.maximum_canonical_envelope_bytes,
        )
        .map(|candidate| candidate.map(follower_intent_outbox_response))
        .map_err(|error| format!("SQLite Library refused follower outbox read: {error}"))
}

fn follower_intent_publication_response(
    receipt: FollowerIntentPublicationReceipt,
) -> DesktopLibraryFollowerIntentPublicationReceipt {
    DesktopLibraryFollowerIntentPublicationReceipt {
        first_intent_sequence: receipt.first_intent_sequence,
        last_intent_sequence: receipt.last_intent_sequence,
        operation_count: receipt.operation_count,
        published_segment_digest: receipt.published_segment_digest,
        status: receipt.status,
    }
}

/// Record publication only after the immutable segment and exact actor head
/// readback have been verified by the bounded cloud adapter.
#[tauri::command]
pub(super) fn record_sqlite_library_follower_intent_publication(
    app: tauri::AppHandle,
    request: RecordFollowerIntentPublicationRequest,
) -> Result<DesktopLibraryFollowerIntentPublicationReceipt, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    journal
        .record_follower_intent_publication(&VerifiedFollowerIntentPublication {
            library_id: request.library_id,
            epoch_id: request.epoch_id,
            actor_id: request.actor_id,
            first_intent_sequence: request.first_intent_sequence,
            last_intent_sequence: request.last_intent_sequence,
            previous_segment_digest: request.previous_segment_digest,
            published_segment_digest: request.published_segment_digest,
        })
        .map(follower_intent_publication_response)
        .map_err(|error| format!("SQLite Library refused follower publication: {error}"))
}

/// Read the exact durable cursor for one follower actor result chain.
#[tauri::command]
pub(super) fn read_sqlite_library_follower_result_import_cursor(
    app: tauri::AppHandle,
    request: ReadFollowerResultImportCursorRequest,
) -> Result<Option<DesktopLibraryFollowerResultImportCursor>, String> {
    if !validate_hex_digest(&request.library_id)
        || !validate_hex_digest(&request.epoch_id)
        || !validate_hex_digest(&request.actor_id)
    {
        return Err("SQLite Library follower result cursor identity is invalid".into());
    }
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let journal = open_journal_at(&root)?;
    journal
        .follower_result_import_cursor(&request.library_id, &request.epoch_id, &request.actor_id)
        .map(|cursor| {
            cursor.map(
                |FollowerResultImportCursor {
                     next_result_sequence,
                     latest_segment_digest,
                 }| DesktopLibraryFollowerResultImportCursor {
                    next_result_sequence,
                    latest_segment_digest,
                },
            )
        })
        .map_err(|error| format!("SQLite Library refused follower result cursor: {error}"))
}

fn follower_result_import_response(
    receipt: FollowerResultImportReceipt,
) -> DesktopLibraryFollowerResultImportReceipt {
    DesktopLibraryFollowerResultImportReceipt {
        first_result_sequence: receipt.first_result_sequence,
        last_result_sequence: receipt.last_result_sequence,
        result_count: receipt.result_count,
        segment_digest: receipt.segment_digest,
        status: receipt.status,
    }
}

/// Append one already verified immutable result segment to the durable follower
/// receipt chain. The journal rechecks its actor, sequence, intent references,
/// replay identity, and previous segment digest before advancing the cursor.
#[tauri::command]
pub(super) fn append_sqlite_library_follower_result_segment(
    app: tauri::AppHandle,
    request: AppendFollowerResultSegmentRequest,
) -> Result<DesktopLibraryFollowerResultImportReceipt, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    journal
        .append_follower_result_segment(&VerifiedFollowerResultSegment {
            library_id: request.library_id,
            epoch_id: request.epoch_id,
            actor_id: request.actor_id,
            first_result_sequence: request.first_result_sequence,
            last_result_sequence: request.last_result_sequence,
            previous_segment_digest: request.previous_segment_digest,
            segment_digest: request.segment_digest,
            entries: request
                .entries
                .into_iter()
                .map(|entry| VerifiedFollowerIntentResult {
                    result_operation_id: entry.result_operation_id,
                    result_sequence: entry.result_sequence,
                    intent_operation_id: entry.intent_operation_id,
                    intent_sequence: entry.intent_sequence,
                    status: entry.status,
                    provider_receipt_digest: entry.provider_receipt_digest,
                })
                .collect(),
            imported_at_ms: request.imported_at_ms,
        })
        .map(follower_result_import_response)
        .map_err(|error| format!("SQLite Library refused follower result segment: {error}"))
}

fn writer_admission_status(connection: &Connection) -> Result<CloudWriterAdmissionStatus, String> {
    let stored = connection
        .query_row(
            "SELECT localWriterId, activeWriterId, storageEpoch,
                    controlRevision, verifiedAtMs
             FROM library_core_cloud_writer_admission WHERE singletonId = 1;",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(match stored {
        None => CloudWriterAdmissionStatus {
            configured: false,
            allowed: false,
            local_writer_id: None,
            active_writer_id: None,
            storage_epoch: None,
            control_revision: None,
            verified_at_ms: None,
        },
        Some((local, active, epoch, revision, verified_at_ms)) => CloudWriterAdmissionStatus {
            configured: true,
            allowed: local == active,
            local_writer_id: Some(local),
            active_writer_id: Some(active),
            storage_epoch: Some(epoch),
            control_revision: Some(revision),
            verified_at_ms: Some(verified_at_ms),
        },
    })
}

#[cfg(test)]
fn require_writer_admission(connection: &Connection) -> Result<(), String> {
    let status = writer_admission_status(connection)?;
    if status.allowed {
        Ok(())
    } else if status.configured {
        Err("Another Freed Desktop currently owns writes for this Library".into())
    } else {
        Err(
            "Freed Desktop has not established write authority for this Library. Restart Freed Desktop or reconnect its Library sync provider."
                .into(),
        )
    }
}

#[cfg(test)]
const LOCAL_ONLY_CONTROL_REVISION_PREFIX: &str = "local-only-primary-v1:";

#[cfg(test)]
fn establish_local_only_writer_admission(
    connection: &mut Connection,
    library_id: &str,
    epoch: i64,
    epoch_id: &str,
    actor_id: &str,
    transition_certificate_digest: &str,
    verified_at_ms: i64,
) -> Result<CloudWriterAdmissionStatus, String> {
    if !validate_hex_digest(library_id)
        || epoch != 1
        || !validate_hex_digest(epoch_id)
        || !validate_hex_digest(actor_id)
        || !validate_hex_digest(transition_certificate_digest)
        || verified_at_ms < 0
    {
        return Err("SQLite Library local-only writer admission is invalid".into());
    }
    let control_revision =
        format!("{LOCAL_ONLY_CONTROL_REVISION_PREFIX}{transition_certificate_digest}");
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let existing = writer_admission_status(&transaction)?;
    if existing.configured {
        if existing.allowed
            && existing.local_writer_id.as_deref() == Some(actor_id)
            && existing.active_writer_id.as_deref() == Some(actor_id)
            && existing.storage_epoch.as_deref() == Some(epoch_id)
            && existing.control_revision.as_deref() == Some(control_revision.as_str())
        {
            transaction.commit().map_err(|error| error.to_string())?;
            return Ok(existing);
        }
        return Err("SQLite Library already has a different durable writer admission".into());
    }
    let authority_and_actor_match = transaction
        .query_row(
            "SELECT EXISTS (
               SELECT 1
               FROM library_core_active_authority AS active
               JOIN library_core_actors AS actor
                 ON actor.libraryId = active.libraryId
                AND actor.epoch = active.epoch
                AND actor.epochId = active.epochId
               WHERE active.libraryId = ?1
                 AND active.epoch = ?2
                 AND active.epochId = ?3
                 AND active.transitionCertificateDigest = ?4
                 AND actor.actorId = ?5
             );",
            params![
                library_id,
                epoch,
                epoch_id,
                transition_certificate_digest,
                actor_id,
            ],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if !authority_and_actor_match {
        return Err("SQLite Library local-only writer does not match accepted authority".into());
    }
    let has_follower_anchor = transaction
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM library_core_follower_anchor LIMIT 1);",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if has_follower_anchor {
        return Err("SQLite Library follower cannot become a local-only writer".into());
    }
    transaction
        .execute(
            "INSERT INTO library_core_cloud_writer_admission (
               singletonId, localWriterId, activeWriterId, storageEpoch,
               controlRevision, verifiedAtMs
             ) VALUES (1, ?1, ?1, ?2, ?3, ?4);",
            params![actor_id, epoch_id, control_revision, verified_at_ms],
        )
        .map_err(|error| error.to_string())?;
    let status = writer_admission_status(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(status)
}

#[tauri::command]
pub(super) fn set_sqlite_library_cloud_writer_admission(
    app: tauri::AppHandle,
    request: SetCloudWriterAdmissionRequest,
) -> Result<CloudWriterAdmissionStatus, String> {
    if !validate_hex_digest(&request.local_writer_id)
        || !validate_hex_digest(&request.active_writer_id)
        || !validate_hex_digest(&request.storage_epoch)
        || request.control_revision.is_empty()
        || request.control_revision.len() > 512
        || request.verified_at_ms < 0
    {
        return Err("SQLite Library cloud writer admission is invalid".into());
    }
    let mut connection = open_database(&app)?;
    require_active(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO library_core_cloud_writer_admission (
               singletonId, localWriterId, activeWriterId, storageEpoch,
               controlRevision, verifiedAtMs
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(singletonId) DO UPDATE SET
               localWriterId = excluded.localWriterId,
               activeWriterId = excluded.activeWriterId,
               storageEpoch = excluded.storageEpoch,
               controlRevision = excluded.controlRevision,
               verifiedAtMs = excluded.verifiedAtMs;",
            params![
                request.local_writer_id,
                request.active_writer_id,
                request.storage_epoch,
                request.control_revision,
                request.verified_at_ms,
            ],
        )
        .map_err(|error| error.to_string())?;
    let status = writer_admission_status(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(status)
}

#[tauri::command]
pub(super) fn sqlite_library_cloud_writer_admission_status(
    app: tauri::AppHandle,
) -> Result<CloudWriterAdmissionStatus, String> {
    let connection = open_database(&app)?;
    require_active(&connection)?;
    writer_admission_status(&connection)
}

/// Countersign and atomically enroll one PWA actor under the active epoch.
#[tauri::command]
pub(super) fn accept_pwa_actor_enrollment_request(
    app: tauri::AppHandle,
    request: AcceptPwaActorEnrollmentRequest,
) -> Result<DesktopLibraryActorEnrollment, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    let actor = countersign_pwa_actor_enrollment_request(
        &mut journal,
        request.canonical_request_json.as_bytes(),
    )?;
    Ok(DesktopLibraryActorEnrollment {
        actor_id: actor.actor_id,
        actor_public_key: actor.actor_public_key,
        enrollment_operation_id: actor.enrollment_operation_id,
        enrollment_certificate_digest: actor.enrollment_certificate_digest,
        canonical_enrollment_certificate_json: actor.canonical_enrollment_certificate_json,
        actor_chain_genesis: actor.actor_chain_genesis,
    })
}

/// Verify and commit one complete signed PWA intent transaction.
#[tauri::command]
pub(super) fn accept_pwa_intent_transaction(
    app: tauri::AppHandle,
    request: AcceptPwaIntentRequest,
) -> Result<Vec<IntentResultOutboxEntry>, String> {
    if request.canonical_envelope_json.is_empty()
        || request.canonical_envelope_json.len() > 1_000
        || request.committed_at_ms < 0
    {
        return Err("SQLite Library PWA intent request is invalid".into());
    }
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let canonical_envelopes = request
        .canonical_envelope_json
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let mut journal = open_journal_at(&root)?;
    journal
        .accept_operation_transaction(&canonical_envelopes, request.committed_at_ms)
        .map_err(|error| error.to_string())
}

/// Read a bounded page of durable PWA acceptance/provider result receipts.
#[tauri::command]
pub(super) fn read_pwa_intent_result_outbox(
    app: tauri::AppHandle,
    request: ReadPwaIntentResultOutboxRequest,
) -> Result<Vec<IntentResultOutboxEntry>, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let journal = open_journal_at(&root)?;
    journal
        .pending_intent_results(&request.library_id, &request.epoch_id, request.limit)
        .map_err(|error| error.to_string())
}

/// Mark only receipts whose exact immutable result segment is cloud-visible.
#[tauri::command]
pub(super) fn acknowledge_pwa_intent_result_outbox(
    app: tauri::AppHandle,
    request: AcknowledgePwaIntentResultOutboxRequest,
) -> Result<(), String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    journal
        .acknowledge_intent_results(&request.result_operation_ids, request.acknowledged_at_ms)
        .map_err(|error| error.to_string())
}

/// Read the deterministic actor set used by the next portable checkpoint.
#[tauri::command]
pub(super) fn list_sqlite_library_actor_enrollments(
    app: tauri::AppHandle,
    request: ListActorEnrollmentsRequest,
) -> Result<Vec<DesktopLibraryActorCheckpointState>, String> {
    if !validate_hex_digest(&request.library_id) || !validate_hex_digest(&request.epoch_id) {
        return Err("SQLite Library actor checkpoint request is invalid".into());
    }
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let journal = open_journal_at(&root)?;
    journal
        .actor_states(&request.library_id, &request.epoch_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|actor| {
            let accepted_sequence = actor
                .next_sequence
                .checked_sub(1)
                .ok_or_else(|| "SQLite Library actor sequence is invalid".to_string())?;
            Ok(DesktopLibraryActorCheckpointState {
                actor_id: actor.actor_id,
                accepted_sequence,
                accepted_operation_id: actor.previous_operation_id,
                accepted_chain_digest: actor.previous_chain_digest,
                enrollment_certificate_digest: actor.enrollment_certificate_digest,
                retired: false,
                retirement_certificate_digest: None,
                canonical_enrollment_certificate_json: actor.canonical_enrollment_certificate_json,
            })
        })
        .collect()
}

#[tauri::command]
pub(super) fn read_sqlite_library_facet_summary(
    app: tauri::AppHandle,
) -> Result<DesktopLibraryFacetSummary, String> {
    const MAXIMUM_TAGS: usize = 4_096;
    const MAXIMUM_TAG_BYTES: usize = 1_024;

    let connection = open_database(&app)?;
    require_active(&connection)?;
    let (
        total_count,
        archived_count,
        sample_item_count,
        saved_count,
        saved_archived_count,
        saved_platform_count,
    ): (i64, i64, i64, i64, i64, i64) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(archived = 1), 0),
                    COALESCE(SUM(sampleData = 1), 0),
                    COALESCE(SUM(saved = 1), 0),
                    COALESCE(SUM(saved = 1 AND archived = 1), 0),
                    COUNT(DISTINCT CASE WHEN saved = 1 THEN platform END)
             FROM library_core_feed_items
             WHERE deletedAt IS NULL;",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT tag.value
             FROM library_core_feed_items AS item,
                  json_each(json_extract(item.payloadJson, '$.userState.tags')) AS tag
             WHERE item.deletedAt IS NULL AND typeof(tag.value) = 'text'
             LIMIT 4097;",
        )
        .map_err(|error| error.to_string())?;
    let tags = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if tags.len() > MAXIMUM_TAGS || tags.iter().any(|tag| tag.len() > MAXIMUM_TAG_BYTES) {
        return Err("SQLite Library facet tags exceed their bound".into());
    }
    Ok(DesktopLibraryFacetSummary {
        archived_count,
        sample_item_count,
        saved_archived_count,
        saved_count,
        saved_platform_count,
        tags,
        total_count,
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1_024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(crate::library_core_hash::lower_hex(&digest.finalize()))
}

#[tauri::command]
pub(super) fn create_sqlite_library_backup(
    app: tauri::AppHandle,
    created_at_ms: i64,
    reason: String,
) -> Result<DesktopBackupSummary, String> {
    log::info!("[library-core] creating SQLite Library backup reason={reason}");
    create_sqlite_library_backup_at(&app_root(&app)?, created_at_ms, &reason)
}

fn create_sqlite_library_backup_at(
    root: &Path,
    created_at_ms: i64,
    reason: &str,
) -> Result<DesktopBackupSummary, String> {
    let receipt = open_store_at(root)?
        .create_backup(created_at_ms, reason)
        .map_err(|error| error.to_string())?;
    log::info!(
        "[library-core] created SQLite Library backup items={} bytes={}",
        receipt.item_count,
        receipt.byte_length
    );
    if receipt.retention_pending {
        log::warn!(
            "[library-core] SQLite Library backup committed; retention cleanup remains pending"
        );
    }
    Ok(receipt.into())
}

fn acquire_sqlite_library_backup_operation(
    root: &Path,
) -> Result<LibraryCoreBackupOperationGuard, String> {
    LibraryCoreBackupOperationGuard::acquire(root).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn list_sqlite_library_backups(
    app: tauri::AppHandle,
) -> Result<Vec<DesktopBackupSummary>, String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding
            .store()
            .map_err(|error| error.to_string())?
            .list_bound_backups()
            .map(|records| records.into_iter().map(Into::into).collect())
            .map_err(|error| error.to_string());
    }
    let root = app_root(&app)?;
    let _backup_operation = acquire_sqlite_library_backup_operation(&root)?;
    let backup_directory = root.join(BACKUP_DIRECTORY);
    let connection = open_database(&app)?;
    require_active(&connection)?;
    let mut statement = connection
        .prepare(
            "SELECT backupId, fileName, createdAtMs, revision, itemCount, reason, byteLength, sha256
             FROM library_core_desktop_backups
             ORDER BY createdAtMs DESC, backupId DESC;",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(DesktopBackupSummary {
                backup_id: row.get(0)?,
                file_name: row.get(1)?,
                created_at_ms: row.get(2)?,
                revision: row.get(3)?,
                item_count: row.get(4)?,
                reason: row.get(5)?,
                byte_length: row.get::<_, i64>(6)? as u64,
                sha256: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let summaries = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(summaries
        .into_iter()
        .filter(|summary| backup_directory.join(&summary.file_name).is_file())
        .collect())
}

/// Read one verified, closed backup in bounded chunks for off-device archival.
#[tauri::command]
pub(super) fn read_sqlite_library_backup_chunk(
    app: tauri::AppHandle,
    request: ReadDesktopBackupChunkRequest,
) -> Result<DesktopBackupChunk, String> {
    read_sqlite_library_backup_chunk_at(&app_root(&app)?, request)
}

fn read_sqlite_library_backup_chunk_at(
    root: &Path,
    request: ReadDesktopBackupChunkRequest,
) -> Result<DesktopBackupChunk, String> {
    if request.backup_id.is_empty()
        || request.backup_id.len() > 128
        || request.limit == 0
        || request.limit > MAX_BACKUP_CHUNK_BYTES
    {
        return Err("invalid SQLite Library backup chunk request".into());
    }
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding
            .store()
            .map_err(|error| error.to_string())?
            .read_bound_backup_chunk(&request.backup_id, request.offset, request.limit)
            .map(Into::into)
            .map_err(|error| error.to_string());
    }
    let _backup_operation = acquire_sqlite_library_backup_operation(root)?;
    let connection = open_database_at(root)?;
    require_active(&connection)?;
    let summary = connection
        .query_row(
            "SELECT backupId, fileName, createdAtMs, revision, itemCount, reason, byteLength, sha256
             FROM library_core_desktop_backups WHERE backupId = ?1;",
            [&request.backup_id],
            |row| {
                Ok(DesktopBackupSummary {
                    backup_id: row.get(0)?,
                    file_name: row.get(1)?,
                    created_at_ms: row.get(2)?,
                    revision: row.get(3)?,
                    item_count: row.get(4)?,
                    reason: row.get(5)?,
                    byte_length: row.get::<_, i64>(6)? as u64,
                    sha256: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "SQLite Library backup does not exist".to_string())?;
    let expected_file_name = format!("{}.sqlite", summary.backup_id);
    if summary.file_name != expected_file_name || request.offset > summary.byte_length {
        return Err("SQLite Library backup metadata is invalid".into());
    }
    let path = root.join(BACKUP_DIRECTORY).join(&summary.file_name);
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() != summary.byte_length {
        return Err("SQLite Library backup bytes do not match metadata".into());
    }
    let remaining = summary.byte_length - request.offset;
    let byte_count = remaining.min(request.limit as u64) as usize;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(request.offset))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0_u8; byte_count];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    let consumed = request
        .offset
        .checked_add(byte_count as u64)
        .ok_or_else(|| "SQLite Library backup offset overflowed".to_string())?;
    Ok(DesktopBackupChunk {
        backup_id: summary.backup_id,
        bytes,
        next_offset: (consumed < summary.byte_length).then_some(consumed),
        offset: request.offset,
        sha256: summary.sha256,
        total_byte_length: summary.byte_length,
    })
}

#[tauri::command]
pub(super) fn restore_sqlite_library_backup(
    app: tauri::AppHandle,
    backup_id: String,
) -> Result<DesktopBackupSummary, String> {
    restore_sqlite_library_backup_at(&app_root(&app)?, &backup_id)
}

fn restore_sqlite_library_backup_at(
    root: &Path,
    backup_id: &str,
) -> Result<DesktopBackupSummary, String> {
    if backup_id.is_empty() || backup_id.len() > 256 {
        return Err("invalid SQLite Library backup identity".into());
    }
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding
            .store()
            .map_err(|error| error.to_string())?
            .restore_bound_backup(backup_id)
            .map(Into::into)
            .map_err(|error| error.to_string());
    }
    let _backup_operation = acquire_sqlite_library_backup_operation(root)?;
    let database_path = journal_path(root);
    let backup_directory = root.join(BACKUP_DIRECTORY);
    let connection = open_database_at(root)?;
    require_active(&connection)?;
    let retained_summaries = {
        let mut statement = connection
            .prepare(
                "SELECT backupId, fileName, createdAtMs, revision, itemCount, reason, byteLength, sha256
                 FROM library_core_desktop_backups;",
            )
            .map_err(|error| error.to_string())?;
        let summaries = statement
            .query_map([], |row| {
                Ok(DesktopBackupSummary {
                    backup_id: row.get(0)?,
                    file_name: row.get(1)?,
                    created_at_ms: row.get(2)?,
                    revision: row.get(3)?,
                    item_count: row.get(4)?,
                    reason: row.get(5)?,
                    byte_length: row.get::<_, i64>(6)? as u64,
                    sha256: row.get(7)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        summaries
    };
    let summary = connection
        .query_row(
            "SELECT backupId, fileName, createdAtMs, revision, itemCount, reason, byteLength, sha256
             FROM library_core_desktop_backups WHERE backupId = ?1;",
            [backup_id],
            |row| {
                Ok(DesktopBackupSummary {
                    backup_id: row.get(0)?,
                    file_name: row.get(1)?,
                    created_at_ms: row.get(2)?,
                    revision: row.get(3)?,
                    item_count: row.get(4)?,
                    reason: row.get(5)?,
                    byte_length: row.get::<_, i64>(6)? as u64,
                    sha256: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "SQLite Library backup not found".to_string())?;
    drop(connection);

    let backup_path = backup_directory.join(&summary.file_name);
    if !backup_path.is_file() || sha256_file(&backup_path)? != summary.sha256 {
        return Err("SQLite Library backup bytes do not match their recorded digest".into());
    }
    let check = Connection::open(&backup_path).map_err(|error| error.to_string())?;
    let integrity: String = check
        .query_row("PRAGMA integrity_check;", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let active: i64 = check
        .query_row(
            "SELECT active FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    drop(check);
    if integrity != "ok" || active != 1 {
        return Err("SQLite Library backup failed integrity or activation verification".into());
    }

    let staging = database_path.with_extension("sqlite.restore-staging");
    let rollback = database_path.with_extension("sqlite.pre-restore");
    let _ = fs::remove_file(&staging);
    let _ = fs::remove_file(&rollback);
    fs::copy(&backup_path, &staging).map_err(|error| error.to_string())?;
    if sha256_file(&staging)? != summary.sha256 {
        let _ = fs::remove_file(&staging);
        return Err("SQLite Library restore staging copy changed bytes".into());
    }
    let _ = fs::remove_file(format!("{}-wal", database_path.display()));
    let _ = fs::remove_file(format!("{}-shm", database_path.display()));
    fs::rename(&database_path, &rollback).map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(&staging, &database_path) {
        let _ = fs::rename(&rollback, &database_path);
        return Err(error.to_string());
    }
    if let Err(error) = LibraryCoreJournal::open(&database_path) {
        let _ = fs::remove_file(&database_path);
        let _ = fs::rename(&rollback, &database_path);
        return Err(format!(
            "restored SQLite Library failed catalog verification: {error}"
        ));
    }
    let restored = Connection::open(&database_path).map_err(|error| error.to_string())?;
    for retained in retained_summaries {
        restored
            .execute(
                "INSERT OR REPLACE INTO library_core_desktop_backups (
                   backupId, createdAtMs, revision, itemCount, reason, fileName, byteLength, sha256
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);",
                params![
                    retained.backup_id,
                    retained.created_at_ms,
                    retained.revision,
                    retained.item_count,
                    retained.reason,
                    retained.file_name,
                    i64::try_from(retained.byte_length).map_err(|_| "backup is too large")?,
                    retained.sha256,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    drop(restored);
    let _ = fs::remove_file(&rollback);
    Ok(summary)
}

#[tauri::command]
pub(super) fn clear_sqlite_library_backups(app: tauri::AppHandle) -> Result<(), String> {
    let root = app_root(&app)?;
    clear_sqlite_library_backups_at(&root)
}

fn clear_sqlite_library_backups_at(root: &Path) -> Result<(), String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding
            .store()
            .map_err(|error| error.to_string())?
            .clear_bound_backups()
            .map_err(|error| error.to_string());
    }
    let _backup_operation = acquire_sqlite_library_backup_operation(root)?;
    let backup_directory = root.join(BACKUP_DIRECTORY);
    let connection = open_database_at(root)?;
    connection
        .execute("DELETE FROM library_core_desktop_backups;", [])
        .map_err(|error| error.to_string())?;
    if backup_directory.is_dir() {
        for entry in fs::read_dir(&backup_directory).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.is_file() {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(super) fn clear_sqlite_library(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(unix)]
    if let Ok(binding) = freed_library_core::desktop_binding() {
        return binding
            .store()
            .map_err(|error| error.to_string())?
            .clear_bound_all()
            .map_err(|error| error.to_string());
    }
    let root = app_root(&app)?;
    let _backup_operation = acquire_sqlite_library_backup_operation(&root)?;
    let path = journal_path(&root);
    for candidate in [
        path.clone(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        match fs::remove_file(&candidate) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    let backups = root.join(BACKUP_DIRECTORY);
    match fs::remove_dir_all(backups) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("freed-{label}-{}-{nonce}", std::process::id()))
    }

    fn install_test_active_authority_and_actor(connection: &Connection) {
        connection
            .execute(
                "INSERT INTO library_core_authority_epochs (
                   libraryId, epoch, epochId, transitionCertificateDigest,
                   canonicalTransitionCertificateJson, authorityKeyId,
                   authorityPublicKey, acceptedAtMs
                 ) VALUES (?1, 1, ?2, ?3, '{}', ?4, ?5, 100);",
                params![
                    "1".repeat(64),
                    "2".repeat(64),
                    "3".repeat(64),
                    "4".repeat(64),
                    "5".repeat(64),
                ],
            )
            .expect("insert authority epoch");
        connection
            .execute(
                "INSERT INTO library_core_active_authority (
                   libraryId, epoch, epochId, transitionCertificateDigest
                 ) VALUES (?1, 1, ?2, ?3);",
                params!["1".repeat(64), "2".repeat(64), "3".repeat(64)],
            )
            .expect("activate authority epoch");
        connection
            .execute(
                "INSERT INTO library_core_actors (
                   libraryId, epoch, epochId, actorId, actorPublicKey,
                   enrollmentOperationId, enrollmentCertificateDigest,
                   canonicalEnrollmentCertificateJson, actorChainGenesis,
                   nextSequence, previousOperationId, previousChainDigest,
                   enrolledAtMs
                 ) VALUES (?1, 1, ?2, ?3, ?4, 'enroll:test', ?5, '{}',
                           ?6, 1, NULL, ?6, 100);",
                params![
                    "1".repeat(64),
                    "2".repeat(64),
                    "6".repeat(64),
                    "7".repeat(64),
                    "8".repeat(64),
                    "9".repeat(64),
                ],
            )
            .expect("insert enrolled actor");
    }

    #[test]
    fn database_path_stays_under_the_private_library_directory() {
        let root = temporary_root("sqlite-library-private-root");
        fs::create_dir_all(&root).expect("create temporary root");
        let connection = open_database_at(&root).expect("open Library database");
        drop(connection);

        let path = journal_path(&root);
        assert_eq!(
            path,
            root.join(JOURNAL_DIRECTORY).join(JOURNAL_FILE),
            "the sole Desktop runtime must own the canonical database path",
        );
        assert!(path.is_file());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(path.parent().expect("Library directory"))
                .expect("Library directory metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }

        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[cfg(unix)]
    #[test]
    fn existing_library_directory_is_corrected_to_private_mode() {
        use std::os::unix::fs::PermissionsExt;

        let root = temporary_root("sqlite-library-existing-permissions");
        let directory = root.join(JOURNAL_DIRECTORY);
        fs::create_dir_all(&directory).expect("create existing Library directory");
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o755))
            .expect("make existing Library directory permissive");

        let connection = open_database_at(&root).expect("open Library database");
        drop(connection);

        let mode = fs::metadata(&directory)
            .expect("Library directory metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[cfg(unix)]
    #[test]
    fn library_directory_symlink_is_rejected_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let root = temporary_root("sqlite-library-symlink-root");
        let target = temporary_root("sqlite-library-symlink-target");
        fs::create_dir_all(&root).expect("create temporary root");
        fs::create_dir_all(&target).expect("create symlink target");
        let sentinel = target.join("sentinel");
        fs::write(&sentinel, b"unchanged").expect("write target sentinel");
        symlink(&target, root.join(JOURNAL_DIRECTORY)).expect("link Library directory");

        let error = open_database_at(&root).expect_err("symlink must be rejected");
        assert!(!error.is_empty());
        assert_eq!(
            fs::read(&sentinel).expect("read target sentinel"),
            b"unchanged"
        );
        assert!(!target.join(JOURNAL_FILE).exists());

        fs::remove_dir_all(root).expect("remove temporary root");
        fs::remove_dir_all(target).expect("remove symlink target");
    }

    #[test]
    fn missing_cloud_writer_admission_is_not_write_authority() {
        let root = temporary_root("sqlite-writer-admission-absent");
        fs::create_dir_all(&root).expect("create temporary root");
        let connection = open_database_at(&root).expect("open Library database");

        let status = writer_admission_status(&connection).expect("read missing admission");

        assert!(!status.configured);
        assert!(!status.allowed);
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn explicit_local_only_admission_is_writable_and_exactly_replayable() {
        let root = temporary_root("sqlite-local-only-writer");
        fs::create_dir_all(&root).expect("create temporary root");
        let mut connection = open_database_at(&root).expect("open Library database");
        install_test_active_authority_and_actor(&connection);

        let first = establish_local_only_writer_admission(
            &mut connection,
            &"1".repeat(64),
            1,
            &"2".repeat(64),
            &"6".repeat(64),
            &"3".repeat(64),
            200,
        )
        .expect("establish local-only writer");
        assert!(first.configured);
        assert!(first.allowed);
        assert_eq!(
            first.control_revision,
            Some(format!(
                "{LOCAL_ONLY_CONTROL_REVISION_PREFIX}{}",
                "3".repeat(64)
            ))
        );
        require_writer_admission(&connection).expect("local-only writer is admitted");

        let replay = establish_local_only_writer_admission(
            &mut connection,
            &"1".repeat(64),
            1,
            &"2".repeat(64),
            &"6".repeat(64),
            &"3".repeat(64),
            300,
        )
        .expect("replay local-only writer");
        assert_eq!(replay.verified_at_ms, Some(200));

        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn local_only_admission_never_overwrites_cloud_writer_authority() {
        let root = temporary_root("sqlite-local-only-cloud-conflict");
        fs::create_dir_all(&root).expect("create temporary root");
        let mut connection = open_database_at(&root).expect("open Library database");
        install_test_active_authority_and_actor(&connection);
        connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?2, ?3, 'etag-cloud', 150);",
                params!["6".repeat(64), "a".repeat(64), "2".repeat(64)],
            )
            .expect("insert cloud writer admission");

        let error = establish_local_only_writer_admission(
            &mut connection,
            &"1".repeat(64),
            1,
            &"2".repeat(64),
            &"6".repeat(64),
            &"3".repeat(64),
            200,
        )
        .expect_err("cloud writer authority stays intact");
        assert!(
            error.contains("different durable writer admission"),
            "{error}"
        );
        let status = writer_admission_status(&connection).expect("read cloud admission");
        assert_eq!(status.active_writer_id, Some("a".repeat(64)));
        assert_eq!(status.control_revision.as_deref(), Some("etag-cloud"));

        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn follower_anchor_blocks_local_only_writer_admission() {
        let root = temporary_root("sqlite-local-only-follower-conflict");
        fs::create_dir_all(&root).expect("create temporary root");
        let mut connection = open_database_at(&root).expect("open Library database");
        install_test_active_authority_and_actor(&connection);
        connection
            .execute(
                "INSERT INTO library_core_follower_anchor (
                   singletonId, libraryId, epoch, epochId, authorityKeyId,
                   authorityPublicKey, observedFrontierJson, manifestObjectKey,
                   manifestContentDigest, generation, remoteIngestSequence,
                   remoteMaterializedDigest, writerId, controlRevision,
                   installedAtMs
                 ) VALUES (1, ?1, 1, ?2, ?3, ?4, '[]', 'checkpoint:test',
                           ?5, 0, 0, ?6, ?7, 'etag-follower', 150);",
                params![
                    "1".repeat(64),
                    "2".repeat(64),
                    "4".repeat(64),
                    "5".repeat(64),
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(64),
                ],
            )
            .expect("insert follower anchor");

        let error = establish_local_only_writer_admission(
            &mut connection,
            &"1".repeat(64),
            1,
            &"2".repeat(64),
            &"6".repeat(64),
            &"3".repeat(64),
            200,
        )
        .expect_err("follower cannot become local-only writer");
        assert!(error.contains("follower cannot become"), "{error}");
        assert!(
            !writer_admission_status(&connection)
                .expect("read absent writer admission")
                .configured
        );

        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn retired_cloud_writer_is_rejected_before_row_or_revision_changes() {
        let root = temporary_root("sqlite-retired-writer");
        fs::create_dir_all(&root).expect("create temporary root");
        let mut connection = open_database_at(&root).expect("open Library database");
        connection
            .execute(
                "INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration, sourceRevision,
                   sourceDigest, expectedItemCount, importedItemCount, shellJson,
                   startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 7, 1, 1, ?1, 1, 1, '{}', 100, 200);",
                ["a".repeat(64)],
            )
            .expect("insert active Desktop state");
        let transaction = connection.transaction().expect("begin item insert");
        upsert_item(
            &transaction,
            r#"{"globalId":"rss:test","userState":{"saved":false}}"#,
            300,
        )
        .expect("insert item");
        transaction.commit().expect("commit item");
        connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?2, ?3, 'etag-2', 400);",
                params!["1".repeat(64), "2".repeat(64), "3".repeat(64)],
            )
            .expect("record retired writer");

        let transaction = connection.transaction().expect("begin rejected mutation");
        let error = require_writer_admission(&transaction).expect_err("retired writer rejected");
        assert!(error.contains("Another Freed Desktop"), "{error}");
        drop(transaction);

        let (saved, revision): (i64, i64) = connection
            .query_row(
                "SELECT item.saved, state.revision
                 FROM library_core_feed_items AS item
                 CROSS JOIN library_core_desktop_state AS state
                 WHERE item.globalId = 'rss:test' AND state.singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read unchanged state");
        assert_eq!((saved, revision), (0, 7));
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    fn seed_active_import_test_library(root: &Path) {
        let mut connection = open_database_at(root).expect("open Library database");
        connection
            .execute(
                "INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration, sourceRevision,
                   sourceDigest, expectedItemCount, importedItemCount, shellJson,
                   startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 7, 1, 2, ?1, 1, 1, '{}', 100, 200);",
                ["a".repeat(64)],
            )
            .expect("insert active Desktop state");
        let transaction = connection.transaction().expect("begin item insert");
        upsert_item(
            &transaction,
            r#"{"globalId":"rss:old","platform":"rss","userState":{"saved":true}}"#,
            250,
        )
        .expect("insert old item");
        transaction.commit().expect("commit old item");
    }

    #[test]
    fn backup_restore_and_clear_honor_the_shared_operation_lock() {
        let root = temporary_root("sqlite-backup-operation-lock");
        fs::create_dir_all(&root).expect("create temporary root");
        seed_active_import_test_library(&root);
        let backup = create_sqlite_library_backup_at(&root, 400, "manual").expect("create backup");
        let held = LibraryCoreBackupOperationGuard::acquire(&root).expect("hold backup lock");
        let restore_error = restore_sqlite_library_backup_at(&root, &backup.backup_id)
            .expect_err("refuse concurrent restore");
        assert_eq!(
            restore_error,
            "SQLite Library backup operation is already in progress"
        );
        let clear_error =
            clear_sqlite_library_backups_at(&root).expect_err("refuse concurrent backup clear");
        assert_eq!(
            clear_error,
            "SQLite Library backup operation is already in progress"
        );
        assert!(root
            .join(BACKUP_DIRECTORY)
            .join(&backup.file_name)
            .is_file());
        drop(held);
        clear_sqlite_library_backups_at(&root).expect("clear after lock release");
        assert!(!root.join(BACKUP_DIRECTORY).join(&backup.file_name).exists());
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn sqlite_backup_restores_the_exact_active_library() {
        let root = temporary_root("sqlite-backup-restore");
        fs::create_dir_all(&root).expect("create temporary root");
        let mut connection = open_database_at(&root).expect("open Library database");
        connection
            .execute(
                "INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration, sourceRevision,
                   sourceDigest, expectedItemCount, importedItemCount, shellJson,
                   startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 7, 3, 9, ?1, 1, 1, '{}', 100, 200);",
                ["a".repeat(64)],
            )
            .expect("insert active Desktop state");
        let transaction = connection.transaction().expect("begin item insert");
        upsert_item(
            &transaction,
            r#"{"globalId":"rss:test","platform":"rss","contentType":"article","publishedAt":100,"capturedAt":101,"userState":{"hidden":false,"saved":false,"archived":false}}"#,
            300,
        )
        .expect("insert test item");
        transaction.commit().expect("commit test item");
        drop(connection);

        let backup =
            create_sqlite_library_backup_at(&root, 400, "manual").expect("create SQLite backup");
        assert_eq!(backup.item_count, 1);
        assert_eq!(backup.revision, 7);
        assert!(root
            .join(BACKUP_DIRECTORY)
            .join(&backup.file_name)
            .is_file());
        let mut offset = 0_u64;
        let mut copied = Vec::new();
        loop {
            let chunk = read_sqlite_library_backup_chunk_at(
                &root,
                ReadDesktopBackupChunkRequest {
                    backup_id: backup.backup_id.clone(),
                    offset,
                    limit: 127,
                },
            )
            .expect("read bounded backup chunk");
            assert_eq!(chunk.offset, offset);
            assert_eq!(chunk.total_byte_length, backup.byte_length);
            assert_eq!(chunk.sha256, backup.sha256);
            copied.extend_from_slice(&chunk.bytes);
            let Some(next_offset) = chunk.next_offset else {
                break;
            };
            assert!(next_offset > offset);
            offset = next_offset;
        }
        assert_eq!(copied.len() as u64, backup.byte_length);
        assert_eq!(
            crate::library_core_hash::lower_hex(&Sha256::digest(&copied)),
            backup.sha256,
        );

        let connection = open_database_at(&root).expect("reopen Library database");
        connection
            .execute(
                "UPDATE library_core_feed_items SET saved = 1 WHERE globalId = 'rss:test';",
                [],
            )
            .expect("mutate live Library after backup");
        connection
            .execute(
                "UPDATE library_core_desktop_state SET revision = 8 WHERE singletonId = 1;",
                [],
            )
            .expect("advance live Library revision");
        drop(connection);

        let later_backup =
            create_sqlite_library_backup_at(&root, 500, "auto").expect("create later backup");
        assert_eq!(later_backup.revision, 8);

        restore_sqlite_library_backup_at(&root, &backup.backup_id).expect("restore SQLite backup");
        let restored = open_database_at(&root).expect("open restored Library database");
        let saved: i64 = restored
            .query_row(
                "SELECT saved FROM library_core_feed_items WHERE globalId = 'rss:test';",
                [],
                |row| row.get(0),
            )
            .expect("read restored item");
        assert_eq!(saved, 0);
        let retained_backups: i64 = restored
            .query_row(
                "SELECT COUNT(*) FROM library_core_desktop_backups WHERE backupId = ?1;",
                [&backup.backup_id],
                |row| row.get(0),
            )
            .expect("read retained backup registry");
        assert_eq!(retained_backups, 1);
        let retained_later_revision: i64 = restored
            .query_row(
                "SELECT revision FROM library_core_desktop_backups WHERE backupId = ?1;",
                [&later_backup.backup_id],
                |row| row.get(0),
            )
            .expect("read retained later backup revision");
        assert_eq!(retained_later_revision, 8);
        drop(restored);
        fs::remove_dir_all(root).expect("remove temporary root");
    }
}
