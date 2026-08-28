//! Freed Desktop native Library routing during the SQLite-only cutover.
//!
//! Final product reads enter the normalized native core through closed typed
//! commands. The legacy commands in this module remain only until the one-time
//! migration and caller cut remove them. They are not part of the final
//! Library contract.

use freed_library_core::{
    accept_normalized_operation_transaction_v1, load_or_create_normalized_actor_id_v2,
    normalized_primary_mutation_context_v1, LibraryCoreStore, LibraryCoreStoreStatus,
    NormalizedMutationContextV1, NormalizedMutationReceiptV1,
};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::library_core_actor_enrollment::{
    countersign_pwa_actor_enrollment_request, sign_library_core_operation_digest,
    PlatformActorKeyStore,
};
use super::library_core_authority_genesis::{
    load_established_authority_key_pair, PlatformAuthorityKeyStore,
};
use super::library_core_journal::{IntentResultOutboxEntry, LibraryCoreJournal};
const SNAPSHOT_DIRECTORY: &str = "library-snapshots";
const JOURNAL_DIRECTORY: &str = "library-core";
const JOURNAL_FILE: &str = "library-core.sqlite";
const NORMALIZED_LIBRARY_DIRECTORY: &str = "library-sqlite";

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
    historical_data_absent: bool,
) -> Result<bool, String> {
    let binding = freed_library_core::desktop_binding().map_err(|error| error.to_string())?;
    if binding
        .normalized_authority_is_selected_v1()
        .map_err(|error| error.to_string())?
    {
        return Ok(true);
    }
    if !historical_data_absent {
        return Ok(false);
    }
    if binding.historical_source_is_present_v1() {
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
    }
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
pub(super) fn mutate_normalized_device_graph_layout(
    app: tauri::AppHandle,
    mutation: freed_library_core::DeviceGraphLayoutMutationV1,
) -> Result<freed_library_core::DeviceGraphLayoutMutationResultV1, String> {
    let mut connection = open_normalized_database(&app)?;
    freed_library_core::mutate_device_graph_layout_v1(&mut connection, &mutation)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn mutate_normalized_device_contacts(
    app: tauri::AppHandle,
    mutation: freed_library_core::DeviceContactSyncMutationV1,
) -> Result<freed_library_core::DeviceContactMutationReceiptV1, String> {
    let mut connection = open_normalized_database(&app)?;
    freed_library_core::mutate_device_contact_sync_v1(&mut connection, &mutation)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn query_normalized_device_contact_status(
    app: tauri::AppHandle,
    request: freed_library_core::DeviceContactStatusRequestV1,
) -> Result<freed_library_core::DeviceContactStatusResponseV1, String> {
    let connection = open_normalized_database(&app)?;
    freed_library_core::query_device_contact_status_v1(&connection, &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn query_normalized_device_contact_match_page(
    app: tauri::AppHandle,
    request: freed_library_core::DeviceContactMatchPageRequestV1,
) -> Result<freed_library_core::DeviceContactMatchPageResponseV1, String> {
    let connection = open_normalized_database(&app)?;
    freed_library_core::query_device_contact_match_page_v1(&connection, &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn query_normalized_device_contact_suggestion_page(
    app: tauri::AppHandle,
    request: freed_library_core::DeviceContactSuggestionPageRequestV1,
) -> Result<freed_library_core::DeviceContactSuggestionPageResponseV1, String> {
    let connection = open_normalized_database(&app)?;
    freed_library_core::query_device_contact_suggestion_page_v1(&connection, &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn query_normalized_device_contact_unmatched_page(
    app: tauri::AppHandle,
    request: freed_library_core::DeviceContactUnmatchedPageRequestV1,
) -> Result<freed_library_core::DeviceContactUnmatchedPageResponseV1, String> {
    let connection = open_normalized_database(&app)?;
    freed_library_core::query_device_contact_unmatched_page_v1(&connection, &request)
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
pub(super) fn normalized_library_follower_transport_context(
    app: tauri::AppHandle,
) -> Result<freed_library_core::NormalizedFollowerTransportContextV2, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::normalized_follower_transport_context_v2(&connection)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn page_normalized_library_follower_transport(
    app: tauri::AppHandle,
    page: freed_library_core::NormalizedFollowerTransportPageRequestV2,
) -> Result<freed_library_core::NormalizedFollowerTransportPageV2, String> {
    let connection = open_selected_normalized_database(&app)?;
    freed_library_core::page_normalized_follower_transport_v2(&connection, &page)
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

fn writer_admission_status(connection: &Connection) -> Result<CloudWriterAdmissionStatus, String> {
    let stored = connection
        .query_row(
            "SELECT local_writer_id, active_writer_id, authority_epoch_id,
                    control_revision, verified_at
             FROM library_local_cloud_writer_admission WHERE singleton_id = 1;",
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
    let mut connection = open_selected_normalized_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO library_local_cloud_writer_admission (
               singleton_id, local_writer_id, active_writer_id,
               authority_epoch_id, control_revision, verified_at
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(singleton_id) DO UPDATE SET
               local_writer_id = excluded.local_writer_id,
               active_writer_id = excluded.active_writer_id,
               authority_epoch_id = excluded.authority_epoch_id,
               control_revision = excluded.control_revision,
               verified_at = excluded.verified_at;",
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
    let connection = open_selected_normalized_database(&app)?;
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

#[cfg(not(unix))]
fn normalized_snapshot_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_root(app)?.join(SNAPSHOT_DIRECTORY))
}

fn normalized_snapshot_reason(
    reason: &str,
) -> Result<freed_library_core::NormalizedLocalSnapshotReasonV1, String> {
    match reason {
        "auto" => Ok(freed_library_core::NormalizedLocalSnapshotReasonV1::Auto),
        "manual" => Ok(freed_library_core::NormalizedLocalSnapshotReasonV1::Manual),
        _ => Err("normalized local snapshot reason is invalid".into()),
    }
}

#[tauri::command]
pub(super) fn create_normalized_local_snapshot(
    _app: tauri::AppHandle,
    created_at_ms: u64,
    reason: String,
) -> Result<freed_library_core::NormalizedLocalSnapshotSummaryV1, String> {
    #[cfg(unix)]
    return freed_library_core::desktop_binding()
        .map_err(|error| error.to_string())?
        .create_normalized_local_snapshot_v1(created_at_ms, normalized_snapshot_reason(&reason)?)
        .map_err(|error| error.to_string());
    #[cfg(not(unix))]
    let mut connection = open_selected_normalized_database(&_app)?;
    #[cfg(not(unix))]
    freed_library_core::create_normalized_local_snapshot_v1(
        &mut connection,
        &normalized_snapshot_root(&_app)?,
        created_at_ms,
        normalized_snapshot_reason(&reason)?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn list_normalized_local_snapshots(
    _app: tauri::AppHandle,
) -> Result<Vec<freed_library_core::NormalizedLocalSnapshotSummaryV1>, String> {
    #[cfg(unix)]
    return freed_library_core::desktop_binding()
        .map_err(|error| error.to_string())?
        .list_normalized_local_snapshots_v1()
        .map_err(|error| error.to_string());
    #[cfg(not(unix))]
    freed_library_core::list_normalized_local_snapshots_v1(&normalized_snapshot_root(&_app)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn restore_normalized_local_snapshot(
    _app: tauri::AppHandle,
    snapshot_id: String,
    operation_id: String,
    restored_at_ms: u64,
) -> Result<freed_library_core::NormalizedLocalSnapshotSummaryV1, String> {
    let installation_witness = crate::get_desktop_installation_witness()?;
    #[cfg(unix)]
    return freed_library_core::desktop_binding()
        .map_err(|error| error.to_string())?
        .restore_normalized_local_snapshot_v1(
            &snapshot_id,
            &installation_witness,
            &PlatformActorKeyStore,
            &PlatformAuthorityKeyStore,
            &operation_id,
            restored_at_ms,
        )
        .map_err(|error| error.to_string());
    #[cfg(not(unix))]
    let mut connection = open_selected_normalized_database(&_app)?;
    #[cfg(not(unix))]
    freed_library_core::restore_normalized_local_snapshot_v1(
        &mut connection,
        &normalized_snapshot_root(&_app)?,
        &snapshot_id,
        &installation_witness,
        &PlatformActorKeyStore,
        &PlatformAuthorityKeyStore,
        &operation_id,
        restored_at_ms,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn clear_normalized_local_snapshots(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(unix)]
    return freed_library_core::desktop_binding()
        .map_err(|error| error.to_string())?
        .clear_normalized_local_snapshots_v1()
        .map_err(|error| error.to_string());
    #[cfg(not(unix))]
    freed_library_core::clear_normalized_local_snapshots_v1(&normalized_snapshot_root(&_app)?)
        .map_err(|error| error.to_string())
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
    let snapshots = root.join(SNAPSHOT_DIRECTORY);
    match fs::remove_dir_all(snapshots) {
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
    fn cloud_writer_admission_is_device_local_normalized_sqlite_state() {
        let connection = Connection::open_in_memory().expect("open normalized SQLite");
        freed_library_core::install_normalized_schema_v1(&connection)
            .expect("install normalized schema");

        let status = writer_admission_status(&connection).expect("read missing admission");
        assert!(!status.configured);
        assert!(!status.allowed);
        connection
            .execute(
                "INSERT INTO library_local_cloud_writer_admission (
                   singleton_id, local_writer_id, active_writer_id,
                   authority_epoch_id, control_revision, verified_at
                 ) VALUES (1, ?1, ?2, ?3, 'etag-2', 400);",
                params!["1".repeat(64), "2".repeat(64), "3".repeat(64)],
            )
            .expect("record normalized cloud writer admission");
        let status = writer_admission_status(&connection).expect("read admission");
        assert!(status.configured);
        assert!(!status.allowed);
        assert_eq!(
            status.storage_epoch.as_deref(),
            Some("3333333333333333333333333333333333333333333333333333333333333333")
        );
        assert_eq!(status.control_revision.as_deref(), Some("etag-2"));
    }
}
