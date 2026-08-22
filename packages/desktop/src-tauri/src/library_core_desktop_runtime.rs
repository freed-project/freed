//! Freed Desktop native Library routing during the SQLite-only cutover.
//!
//! Final product reads enter the normalized native core through closed typed
//! commands. The legacy commands in this module remain only until the one-time
//! migration and caller cut remove them. They are not part of the final
//! Library contract.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use freed_library_core::{
    upsert_item, BeginLibraryCoreImport, LibraryCoreBackupChunk as NativeLibraryCoreBackupChunk,
    LibraryCoreBackupOperationGuard, LibraryCoreBackupReceipt, LibraryCoreBackupRecord,
    LibraryCoreCheckpointReference, LibraryCoreImportItem, LibraryCoreStore,
    LibraryCoreStoreStatus,
};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::library_core_actor_enrollment::{
    countersign_pwa_actor_enrollment_request, enroll_desktop_actor,
    prepare_follower_actor_enrollment_request, sign_follower_operation_digest, EnrollmentAuthority,
    PlatformActorKeyStore,
};
use super::library_core_authority_genesis::{
    establish_or_transition_sqlite_authority, load_established_authority_key_pair,
    reassign_writer_epoch, NativeSqliteSourceSnapshot, PersistedCloudAuthorityHint,
};
use super::library_core_journal::{
    AcceptedAuthorityState, FollowerIntentEnqueueReceipt, FollowerIntentOutboxCandidate,
    FollowerIntentPublicationReceipt, FollowerOverlayReplayReceipt, FollowerResultImportCursor,
    FollowerResultImportReceipt, FollowerRuntimeStatus, IntentResultOutboxEntry,
    LibraryCoreJournal, StoredFollowerActorEnrollment, StoredFollowerActorRequest,
    VerifiedCausalTip, VerifiedFollowerAnchor, VerifiedFollowerCheckpointActor,
    VerifiedFollowerIntentPublication, VerifiedFollowerIntentResult, VerifiedFollowerResultSegment,
};
const BACKUP_DIRECTORY: &str = "library-backups";
const JOURNAL_DIRECTORY: &str = "library-core";
const JOURNAL_FILE: &str = "library-core.sqlite";
const NORMALIZED_LIBRARY_DIRECTORY: &str = "library-sqlite";
const MAX_IMPORT_BATCH: usize = 1_000;
const MAX_IMPORT_PAGE_ENCODED_BYTES: usize = 3 * 1024 * 1024;
const MAX_ITEM_BYTES: usize = 4 * 1024 * 1024;
const MAX_SHELL_BYTES: usize = 16 * 1024 * 1024;
const MAX_IDS: usize = 10_000;
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
pub(super) struct DesktopLibraryShell {
    shell_json: String,
    revision: i64,
    item_count: i64,
    unread_count: i64,
    archivable_count: i64,
    counts_by_platform: std::collections::BTreeMap<String, i64>,
    unread_by_platform: std::collections::BTreeMap<String, i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibraryCounts {
    revision: i64,
    item_count: i64,
    unread_count: i64,
    archivable_count: i64,
    counts_by_platform: std::collections::BTreeMap<String, i64>,
    unread_by_platform: std::collections::BTreeMap<String, i64>,
    archivable_by_platform: std::collections::BTreeMap<String, i64>,
    feed_counts: std::collections::BTreeMap<String, i64>,
    unread_feed_counts: std::collections::BTreeMap<String, i64>,
    archivable_feed_counts: std::collections::BTreeMap<String, i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibrarySyncDescriptor {
    revision: i64,
    item_count: i64,
    source_digest: String,
    shell_json: String,
    materialized_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SyncPageRequest {
    revision: i64,
    offset: u32,
    limit: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibrarySyncPage {
    revision: i64,
    items_json: Vec<String>,
    next_offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BootstrapAuthorityRequest {
    installation_witness: String,
    accepted_at_ms: i64,
    revision: i64,
    item_count: i64,
    source_digest: String,
    materialized_digest: String,
    persisted_cloud_identity: Option<BootstrapPersistedCloudIdentity>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BootstrapPersistedCloudIdentity {
    library_id: String,
    storage_epoch: String,
    writer_id: String,
    source_digest: String,
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
pub(super) struct ReassignWriterEpochRequest {
    canonical_source_control_json: String,
    library_id: String,
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
pub(super) struct DesktopLibraryAuthorityBootstrap {
    authority: DesktopLibraryAcceptedAuthority,
    actor: DesktopLibraryActorEnrollment,
    protocol: DesktopLibraryAuthorityProtocol,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct DesktopLibraryAuthorityProtocol {
    format: String,
    active_engine: String,
    schema_version: i64,
    replication_protocol: String,
    checkpoint_format: String,
    transition_certificate_digest: String,
    native_protocol_certificate_digest: String,
    prior_transition_certificate_digest: Option<String>,
    source_manifest_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct InstallFollowerAnchorRequest {
    authority: DesktopLibraryAcceptedAuthority,
    manifest_object_key: String,
    manifest_transport_object_id: String,
    manifest_content_digest: String,
    generation: i64,
    remote_ingest_sequence: i64,
    remote_materialized_digest: String,
    writer_id: String,
    control_revision: String,
    checkpoint_actor: Option<DesktopLibraryFollowerCheckpointActor>,
    installed_at_ms: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(super) struct DesktopLibraryFollowerCheckpointActor {
    actor_id: String,
    accepted_sequence: i64,
    accepted_operation_id: Option<String>,
    accepted_chain_digest: String,
    enrollment_certificate_digest: String,
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
pub(super) struct EnqueueFollowerIntentRequest {
    canonical_envelope_json: Vec<String>,
    enqueued_at_ms: i64,
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
pub(super) struct DesktopLibraryWriterEpochReassignment {
    authority: DesktopLibraryAcceptedAuthority,
    actor: DesktopLibraryActorEnrollment,
    canonical_epoch_certificate_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BeginImportRequest {
    source_generation: i64,
    source_revision: i64,
    source_digest: String,
    source_checkpoint_object_key: Option<String>,
    source_checkpoint_content_digest: Option<String>,
    source_checkpoint_transport_object_id: Option<String>,
    expected_item_count: i64,
    shell_json: String,
    started_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AppendImportRequest {
    items_base64: Vec<String>,
    updated_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct UpsertItemsRequest {
    items_base64: Vec<String>,
    updated_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReplaceShellRequest {
    shell_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ItemMutationRequest {
    mutation: String,
    ids: Vec<String>,
    platform: Option<String>,
    feed_url: Option<String>,
    timestamp_ms: i64,
    max_age_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadItemsRequest {
    ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct QueryAuthorKey {
    platform: String,
    author_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct QueryItemsRequest {
    query: Option<String>,
    platform: Option<String>,
    author_id: Option<String>,
    feed_url: Option<String>,
    content_type: Option<String>,
    exclude_content_type: Option<String>,
    tags: Option<Vec<String>>,
    signals: Option<Vec<String>>,
    author_keys: Option<Vec<QueryAuthorKey>>,
    has_link_preview: Option<bool>,
    missing_preserved_text: Option<bool>,
    has_media: Option<bool>,
    location_candidate: Option<bool>,
    include_total_count: Option<bool>,
    saved: Option<bool>,
    archived: Option<bool>,
    show_hidden: bool,
    sort_mode: Option<String>,
    offset: u32,
    limit: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct QueryItemsResult {
    items_json: Vec<String>,
    next_offset: Option<u32>,
    total_count: i64,
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

const VISIBLE_LIBRARY_ITEMS_PAGE_SQL: &str = "SELECT payloadJson FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND hidden IS NOT 1
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND (?3 IS NULL OR platform = ?3)
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND (?8 IS NULL OR feedUrl = ?8)
     ORDER BY publishedAt DESC, capturedAt DESC, globalId ASC
     LIMIT ?9 OFFSET ?10;";

const ALL_LIBRARY_ITEMS_PAGE_SQL: &str = "SELECT payloadJson FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND (?3 IS NULL OR platform = ?3)
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND (?8 IS NULL OR feedUrl = ?8)
     ORDER BY publishedAt DESC, capturedAt DESC, globalId ASC
     LIMIT ?9 OFFSET ?10;";

const VISIBLE_LIBRARY_ITEMS_COUNT_SQL: &str = "SELECT COUNT(*) FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND hidden IS NOT 1
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND (?3 IS NULL OR platform = ?3)
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND (?8 IS NULL OR feedUrl = ?8);";

const ALL_LIBRARY_ITEMS_COUNT_SQL: &str = "SELECT COUNT(*) FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND (?3 IS NULL OR platform = ?3)
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND (?8 IS NULL OR feedUrl = ?8);";

const VISIBLE_AUTHOR_ITEMS_PAGE_SQL: &str = "SELECT payloadJson FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND hidden IS NOT 1
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND authorId = ?7
       AND (?8 IS NULL OR feedUrl = ?8)
     ORDER BY publishedAt DESC, capturedAt DESC, globalId ASC
     LIMIT ?9 OFFSET ?10;";

const ALL_AUTHOR_ITEMS_PAGE_SQL: &str = "SELECT payloadJson FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND authorId = ?7
       AND (?8 IS NULL OR feedUrl = ?8)
     ORDER BY publishedAt DESC, capturedAt DESC, globalId ASC
     LIMIT ?9 OFFSET ?10;";

const VISIBLE_FEED_ITEMS_PAGE_SQL: &str = "SELECT payloadJson FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND hidden IS NOT 1
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND feedUrl = ?8
     ORDER BY publishedAt DESC, capturedAt DESC, globalId ASC
     LIMIT ?9 OFFSET ?10;";

const ALL_FEED_ITEMS_PAGE_SQL: &str = "SELECT payloadJson FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND feedUrl = ?8
     ORDER BY publishedAt DESC, capturedAt DESC, globalId ASC
     LIMIT ?9 OFFSET ?10;";

const VISIBLE_AUTHOR_ITEMS_COUNT_SQL: &str = "SELECT COUNT(*) FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND hidden IS NOT 1
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND authorId = ?7
       AND (?8 IS NULL OR feedUrl = ?8);";

const ALL_AUTHOR_ITEMS_COUNT_SQL: &str = "SELECT COUNT(*) FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND authorId = ?7
       AND (?8 IS NULL OR feedUrl = ?8);";

const VISIBLE_FEED_ITEMS_COUNT_SQL: &str = "SELECT COUNT(*) FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND hidden IS NOT 1
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND feedUrl = ?8;";

const ALL_FEED_ITEMS_COUNT_SQL: &str = "SELECT COUNT(*) FROM library_core_feed_items
     WHERE deletedAt IS NULL
       AND (?1 = '' OR payloadJson LIKE ?2 ESCAPE '\\')
       AND platform = ?3
       AND (?4 IS NULL OR saved = ?4)
       AND (?5 IS NULL OR archived = ?5)
       AND (?7 IS NULL OR authorId = ?7)
       AND feedUrl = ?8;";

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

#[tauri::command]
pub(super) fn query_normalized_library(
    app: tauri::AppHandle,
    request: Value,
) -> Result<Value, String> {
    let mut connection = open_normalized_database(&app)?;
    freed_library_core::query_normalized_json_v1(&mut connection, request)
        .map_err(|error| error.to_string())
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

fn validate_json_object(value: &str, maximum_bytes: usize) -> Result<Value, String> {
    if value.len() < 2 || value.len() > maximum_bytes {
        return Err("JSON payload exceeds its storage bound".into());
    }
    let parsed: Value = serde_json::from_str(value).map_err(|error| error.to_string())?;
    if !parsed.is_object() {
        return Err("JSON payload must be an object".into());
    }
    Ok(parsed)
}

fn decode_base64_json(value: &str) -> Result<String, String> {
    let bytes = BASE64_STANDARD
        .decode(value)
        .map_err(|_| "SQLite Library item is not valid base64".to_string())?;
    if bytes.len() > MAX_ITEM_BYTES {
        return Err("JSON payload exceeds its storage bound".into());
    }
    String::from_utf8(bytes).map_err(|_| "SQLite Library item is not valid UTF-8".to_string())
}

#[cfg(test)]
fn string_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn hash_bounded_record(hasher: &mut Sha256, value: &str) -> Result<(), String> {
    let length = u64::try_from(value.len()).map_err(|_| "SQLite Library record is too large")?;
    hasher.update(length.to_be_bytes());
    hasher.update(value.as_bytes());
    Ok(())
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
pub(super) fn begin_sqlite_library_import(
    app: tauri::AppHandle,
    request: BeginImportRequest,
) -> Result<(), String> {
    begin_sqlite_library_import_at(&app_root(&app)?, request)
}

fn begin_sqlite_library_import_at(root: &Path, request: BeginImportRequest) -> Result<(), String> {
    let checkpoint_field_count = [
        request.source_checkpoint_object_key.is_some(),
        request.source_checkpoint_content_digest.is_some(),
        request.source_checkpoint_transport_object_id.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    if !validate_hex_digest(&request.source_digest)
        || !(0..=1_000_000).contains(&request.expected_item_count)
        || request.source_generation < 0
        || request.source_revision < 0
        || request.started_at_ms < 0
        || (checkpoint_field_count != 0 && checkpoint_field_count != 3)
        || request
            .source_checkpoint_object_key
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 4_096)
        || request
            .source_checkpoint_content_digest
            .as_ref()
            .is_some_and(|value| !validate_hex_digest(value))
        || request
            .source_checkpoint_transport_object_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 4_096)
    {
        return Err("invalid SQLite Library import identity".into());
    }
    let source_checkpoint = match (
        request.source_checkpoint_object_key,
        request.source_checkpoint_content_digest,
        request.source_checkpoint_transport_object_id,
    ) {
        (Some(object_key), Some(content_digest), Some(transport_object_id)) => {
            Some(LibraryCoreCheckpointReference {
                object_key,
                content_digest,
                transport_object_id,
            })
        }
        (None, None, None) => None,
        _ => return Err("invalid SQLite Library import identity".into()),
    };
    open_store_at(root)?
        .begin_import(BeginLibraryCoreImport {
            source_generation: request.source_generation,
            source_revision: request.source_revision,
            source_digest: request.source_digest,
            source_checkpoint,
            expected_item_count: request.expected_item_count,
            shell_json: request.shell_json,
            started_at_ms: request.started_at_ms,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn append_sqlite_library_import(
    app: tauri::AppHandle,
    request: AppendImportRequest,
) -> Result<i64, String> {
    append_sqlite_library_import_at(&app_root(&app)?, request)
}

fn append_sqlite_library_import_at(
    root: &Path,
    request: AppendImportRequest,
) -> Result<i64, String> {
    if request.items_base64.is_empty() || request.items_base64.len() > MAX_IMPORT_BATCH {
        return Err("SQLite Library import batch must contain 1 through 1,000 items".into());
    }
    let encoded_bytes = request
        .items_base64
        .iter()
        .try_fold(0usize, |total, item| {
            total
                .checked_add(item.len())
                .ok_or_else(|| "SQLite Library import page is too large".to_string())
        })?;
    if encoded_bytes > MAX_IMPORT_PAGE_ENCODED_BYTES {
        return Err("SQLite Library import page is too large".into());
    }
    if request.updated_at_ms < 0 {
        return Err("SQLite Library import time is invalid".into());
    }
    let items = request
        .items_base64
        .iter()
        .map(|encoded| {
            Ok(LibraryCoreImportItem {
                item_json: decode_base64_json(encoded)?,
                updated_at_ms: request.updated_at_ms,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    open_store_at(root)?
        .append_import_page(&items)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn finalize_sqlite_library_import(
    app: tauri::AppHandle,
    activated_at_ms: i64,
    follower_anchor: Option<InstallFollowerAnchorRequest>,
) -> Result<DesktopLibraryStatus, String> {
    let root = app_root(&app)?;
    let follower_anchor = follower_anchor.map(verified_follower_anchor);
    let receipt = finalize_sqlite_library_import_receipt_at(
        &root,
        activated_at_ms,
        follower_anchor.as_ref(),
    )?;
    if let Some(replay) = receipt.overlay_replay {
        if replay.transaction_count > 0 {
            log::info!(
                "[library-core] replayed {} pending follower transactions, {} operations, {} materialized rows, revision advanced={}",
                replay.transaction_count,
                replay.operation_count,
                replay.materialized_row_count,
                replay.revision_advanced
            );
        }
    } else if receipt.overlay_replay_pending {
        log::warn!(
            "[library-core] checkpoint activation committed; follower overlay recovery remains pending"
        );
    }
    Ok(receipt.status.into())
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

#[cfg(test)]
fn finalize_sqlite_library_import_at(
    root: &Path,
    activated_at_ms: i64,
    follower_anchor: Option<&VerifiedFollowerAnchor>,
) -> Result<(), String> {
    finalize_sqlite_library_import_receipt_at(root, activated_at_ms, follower_anchor)?;
    Ok(())
}

fn finalize_sqlite_library_import_receipt_at(
    root: &Path,
    activated_at_ms: i64,
    follower_anchor: Option<&VerifiedFollowerAnchor>,
) -> Result<freed_library_core::FinalizeLibraryCoreImportReceipt, String> {
    open_store_at(root)?
        .finalize_import(activated_at_ms, follower_anchor)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn read_sqlite_library_shell(
    app: tauri::AppHandle,
) -> Result<DesktopLibraryShell, String> {
    let connection = open_database(&app)?;
    require_active(&connection)?;
    let (shell_json, revision): (String, i64) = connection
        .query_row(
            "SELECT shellJson, revision FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let mut shell = validate_json_object(&shell_json, MAX_SHELL_BYTES)?;
    if let Some(object) = shell.as_object_mut() {
        object.remove("feedSourceOrderIds");
        object.remove("friends");
    }
    let shell_json = serde_json::to_string(&shell).map_err(|error| error.to_string())?;
    let (item_count, unread_count, archivable_count): (i64, i64, i64) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN readAt IS NULL THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN readAt IS NOT NULL AND saved IS NOT 1 THEN 1 ELSE 0 END), 0)
             FROM library_core_feed_items WHERE deletedAt IS NULL;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;
    let mut counts_by_platform = std::collections::BTreeMap::new();
    let mut unread_by_platform = std::collections::BTreeMap::new();
    let mut statement = connection
        .prepare(
            "SELECT COALESCE(platform, ''), COUNT(*),
                    COALESCE(SUM(CASE WHEN readAt IS NULL THEN 1 ELSE 0 END), 0)
             FROM library_core_feed_items WHERE deletedAt IS NULL
             GROUP BY platform ORDER BY platform;",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (platform, total, unread) = row.map_err(|error| error.to_string())?;
        if !platform.is_empty() {
            counts_by_platform.insert(platform.clone(), total);
            unread_by_platform.insert(platform, unread);
        }
    }
    Ok(DesktopLibraryShell {
        shell_json,
        revision,
        item_count,
        unread_count,
        archivable_count,
        counts_by_platform,
        unread_by_platform,
    })
}

#[tauri::command]
pub(super) fn read_sqlite_library_counts(
    app: tauri::AppHandle,
) -> Result<DesktopLibraryCounts, String> {
    let connection = open_database(&app)?;
    require_active(&connection)?;
    let revision = connection
        .query_row(
            "SELECT revision FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let (item_count, unread_count, archivable_count): (i64, i64, i64) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN readAt IS NULL THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN readAt IS NOT NULL AND saved IS NOT 1 THEN 1 ELSE 0 END), 0)
             FROM library_core_feed_items WHERE deletedAt IS NULL;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;
    let mut counts_by_platform = std::collections::BTreeMap::new();
    let mut unread_by_platform = std::collections::BTreeMap::new();
    let mut archivable_by_platform = std::collections::BTreeMap::new();
    let mut statement = connection
        .prepare(
            "SELECT COALESCE(platform, ''), COUNT(*),
                    COALESCE(SUM(CASE WHEN readAt IS NULL THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN readAt IS NOT NULL AND saved IS NOT 1 THEN 1 ELSE 0 END), 0)
             FROM library_core_feed_items WHERE deletedAt IS NULL
             GROUP BY platform ORDER BY platform;",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (platform, total, unread, archivable) = row.map_err(|error| error.to_string())?;
        if !platform.is_empty() {
            counts_by_platform.insert(platform.clone(), total);
            unread_by_platform.insert(platform.clone(), unread);
            archivable_by_platform.insert(platform, archivable);
        }
    }
    drop(statement);
    let mut feed_counts = std::collections::BTreeMap::new();
    let mut unread_feed_counts = std::collections::BTreeMap::new();
    let mut archivable_feed_counts = std::collections::BTreeMap::new();
    let mut statement = connection
        .prepare(
            "SELECT feedUrl, COUNT(*),
                    COALESCE(SUM(CASE WHEN readAt IS NULL THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN readAt IS NOT NULL AND saved IS NOT 1 THEN 1 ELSE 0 END), 0)
             FROM library_core_feed_items
             WHERE deletedAt IS NULL AND feedUrl IS NOT NULL
             GROUP BY feedUrl ORDER BY feedUrl;",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (feed_url, total, unread, archivable) = row.map_err(|error| error.to_string())?;
        feed_counts.insert(feed_url.clone(), total);
        unread_feed_counts.insert(feed_url.clone(), unread);
        archivable_feed_counts.insert(feed_url, archivable);
    }
    Ok(DesktopLibraryCounts {
        revision,
        item_count,
        unread_count,
        archivable_count,
        counts_by_platform,
        unread_by_platform,
        archivable_by_platform,
        feed_counts,
        unread_feed_counts,
        archivable_feed_counts,
    })
}

/// Describe one exact SQLite revision without retaining the corpus in memory.
fn read_sqlite_library_sync_snapshot(
    connection: &mut Connection,
) -> Result<(DesktopLibrarySyncDescriptor, u64, u64), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let (revision, source_generation, source_revision, source_digest, shell_json): (
        i64,
        i64,
        i64,
        String,
        String,
    ) = transaction
        .query_row(
            "SELECT revision, sourceGeneration, sourceRevision,
                    sourceDigest, shellJson
             FROM library_core_desktop_state WHERE singletonId = 1 AND active = 1;",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    hash_bounded_record(&mut hasher, &shell_json)?;
    let mut statement = transaction
        .prepare(
            "SELECT globalId, payloadJson FROM library_core_feed_items
             WHERE deletedAt IS NULL ORDER BY globalId ASC;",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut item_count = 0_i64;
    for row in rows {
        let (global_id, payload_json) = row.map_err(|error| error.to_string())?;
        hash_bounded_record(&mut hasher, &global_id)?;
        hash_bounded_record(&mut hasher, &payload_json)?;
        item_count += 1;
    }
    drop(statement);
    transaction.commit().map_err(|error| error.to_string())?;
    let materialized_digest = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let source_generation = u64::try_from(source_generation)
        .map_err(|_| "SQLite Library source generation is invalid")?;
    let source_revision =
        u64::try_from(source_revision).map_err(|_| "SQLite Library source revision is invalid")?;
    Ok((
        DesktopLibrarySyncDescriptor {
            revision,
            item_count,
            source_digest,
            shell_json,
            materialized_digest,
        },
        source_generation,
        source_revision,
    ))
}

/// Describe one exact SQLite revision without retaining the corpus in memory.
#[tauri::command]
pub(super) fn read_sqlite_library_sync_descriptor(
    app: tauri::AppHandle,
) -> Result<DesktopLibrarySyncDescriptor, String> {
    let mut connection = open_database(&app)?;
    require_active(&connection)?;
    read_sqlite_library_sync_snapshot(&mut connection).map(|snapshot| snapshot.0)
}

fn verified_follower_anchor(request: InstallFollowerAnchorRequest) -> VerifiedFollowerAnchor {
    VerifiedFollowerAnchor {
        authority: AcceptedAuthorityState {
            library_id: request.authority.library_id,
            epoch: request.authority.epoch,
            epoch_id: request.authority.epoch_id,
            authority_key_id: request.authority.authority_key_id,
            authority_public_key: request.authority.authority_public_key,
            observed_frontier: request
                .authority
                .observed_frontier
                .into_iter()
                .map(|tip| VerifiedCausalTip {
                    actor_id: tip.actor_id,
                    sequence: tip.sequence,
                    operation_id: tip.operation_id,
                    chain_digest: tip.chain_digest,
                })
                .collect(),
        },
        manifest_object_key: request.manifest_object_key,
        manifest_transport_object_id: request.manifest_transport_object_id,
        manifest_content_digest: request.manifest_content_digest,
        generation: request.generation,
        remote_ingest_sequence: request.remote_ingest_sequence,
        remote_materialized_digest: request.remote_materialized_digest,
        writer_id: request.writer_id,
        control_revision: request.control_revision,
        checkpoint_actor: request
            .checkpoint_actor
            .map(|actor| VerifiedFollowerCheckpointActor {
                actor_id: actor.actor_id,
                accepted_sequence: actor.accepted_sequence,
                accepted_operation_id: actor.accepted_operation_id,
                accepted_chain_digest: actor.accepted_chain_digest,
                enrollment_certificate_digest: actor.enrollment_certificate_digest,
            }),
        installed_at_ms: request.installed_at_ms,
    }
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
    let signature = sign_follower_operation_digest(
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

/// Establish the active SQLite Library's first signed authority and Desktop actor.
///
/// This is an explicit product action invoked only after the SQLite Library is
/// active. It is idempotent across response loss and restart. It never derives
/// authority from cloud file order, a timeout, or a renderer-generated key.
#[tauri::command]
pub(super) fn bootstrap_sqlite_library_authority(
    app: tauri::AppHandle,
    request: BootstrapAuthorityRequest,
) -> Result<DesktopLibraryAuthorityBootstrap, String> {
    if !validate_hex_digest(&request.installation_witness)
        || !validate_hex_digest(&request.source_digest)
        || !validate_hex_digest(&request.materialized_digest)
        || request.accepted_at_ms < 0
        || request.revision < 0
        || !(0..=1_000_000).contains(&request.item_count)
        || request
            .persisted_cloud_identity
            .as_ref()
            .is_some_and(|hint| {
                !validate_hex_digest(&hint.library_id)
                    || !validate_hex_digest(&hint.storage_epoch)
                    || !validate_hex_digest(&hint.writer_id)
                    || !validate_hex_digest(&hint.source_digest)
            })
    {
        return Err("SQLite Library authority bootstrap request is invalid".into());
    }
    let root = app_root(&app)?;
    let mut connection = open_database_at(&root)?;
    require_active(&connection)?;
    let (descriptor, source_generation, source_revision) =
        read_sqlite_library_sync_snapshot(&mut connection)?;
    drop(connection);
    if descriptor.revision != request.revision
        || descriptor.item_count != request.item_count
        || descriptor.source_digest != request.source_digest
        || descriptor.materialized_digest != request.materialized_digest
    {
        return Err("SQLite Library changed before authority bootstrap".into());
    }

    let mut journal = open_journal_at(&root)?;
    let snapshot = NativeSqliteSourceSnapshot {
        source_digest: descriptor.source_digest,
        source_generation,
        source_revision,
        sqlite_revision: u64::try_from(descriptor.revision)
            .map_err(|_| "SQLite Library revision is invalid")?,
        item_count: u64::try_from(descriptor.item_count)
            .map_err(|_| "SQLite Library item count is invalid")?,
        materialized_digest: descriptor.materialized_digest,
    };
    let persisted_hint = request
        .persisted_cloud_identity
        .map(|hint| PersistedCloudAuthorityHint {
            library_id: hint.library_id,
            storage_epoch: hint.storage_epoch,
            writer_id: hint.writer_id,
            source_digest: hint.source_digest,
        });
    let established = establish_or_transition_sqlite_authority(
        &mut journal,
        &snapshot,
        &request.installation_witness,
        persisted_hint.as_ref(),
        request.accepted_at_ms,
    )?;
    let authority = established.authority;
    let authority_key_pair = load_established_authority_key_pair(&authority.library_id)?;
    let actor = enroll_desktop_actor(
        &mut journal,
        &EnrollmentAuthority {
            library_id: authority.library_id.clone(),
            epoch: authority.epoch,
            epoch_id: authority.epoch_id.clone(),
            authority_key_id: authority.authority_key_id.clone(),
            installation_witness: request.installation_witness,
        },
        &PlatformActorKeyStore,
        &authority_key_pair,
        request.accepted_at_ms,
    )?;
    if persisted_hint.is_none() {
        let mut connection = open_database_at(&root)?;
        establish_local_only_writer_admission(
            &mut connection,
            &authority.library_id,
            authority.epoch,
            &authority.epoch_id,
            &actor.actor_id,
            &established.protocol.transition_certificate_digest,
            request.accepted_at_ms,
        )?;
    }

    Ok(DesktopLibraryAuthorityBootstrap {
        authority: DesktopLibraryAcceptedAuthority {
            library_id: authority.library_id,
            epoch: authority.epoch,
            epoch_id: authority.epoch_id,
            authority_key_id: authority.authority_key_id,
            authority_public_key: authority.authority_public_key,
            observed_frontier: authority
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
        actor: DesktopLibraryActorEnrollment {
            actor_id: actor.actor_id,
            actor_public_key: actor.actor_public_key,
            enrollment_operation_id: actor.enrollment_operation_id,
            enrollment_certificate_digest: actor.enrollment_certificate_digest,
            canonical_enrollment_certificate_json: actor.canonical_enrollment_certificate_json,
            actor_chain_genesis: actor.actor_chain_genesis,
        },
        protocol: DesktopLibraryAuthorityProtocol {
            format: established.protocol.format,
            active_engine: established.protocol.active_engine,
            schema_version: established.protocol.schema_version,
            replication_protocol: established.protocol.replication_protocol,
            checkpoint_format: established.protocol.checkpoint_format,
            transition_certificate_digest: established.protocol.transition_certificate_digest,
            native_protocol_certificate_digest: established
                .protocol
                .native_protocol_certificate_digest,
            prior_transition_certificate_digest: established
                .protocol
                .prior_transition_certificate_digest,
            source_manifest_digest: established.protocol.source_manifest_digest,
        },
    })
}

/// Reassign cloud writer ownership to this Desktop under one signed epoch.
/// The exact source control bytes are embedded in the certificate that the
/// renderer publishes with an exact compare-and-swap.
#[tauri::command]
pub(super) fn reassign_sqlite_library_writer_epoch(
    app: tauri::AppHandle,
    request: ReassignWriterEpochRequest,
) -> Result<DesktopLibraryWriterEpochReassignment, String> {
    if !validate_hex_digest(&request.library_id)
        || !validate_hex_digest(&request.target_writer_id)
        || !validate_hex_digest(&request.installation_witness)
        || request.accepted_at_ms < 0
    {
        return Err("SQLite Library writer reassignment request is invalid".into());
    }
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal = open_journal_at(&root)?;
    let reassigned = reassign_writer_epoch(
        &mut journal,
        &request.library_id,
        &request.canonical_source_control_json,
        &request.target_writer_id,
        request.accepted_at_ms,
    )?;
    let authority_key_pair = load_established_authority_key_pair(&request.library_id)?;
    let actor = enroll_desktop_actor(
        &mut journal,
        &EnrollmentAuthority {
            library_id: reassigned.authority.library_id.clone(),
            epoch: reassigned.authority.epoch,
            epoch_id: reassigned.authority.epoch_id.clone(),
            authority_key_id: reassigned.authority.authority_key_id.clone(),
            installation_witness: request.installation_witness,
        },
        &PlatformActorKeyStore,
        &authority_key_pair,
        request.accepted_at_ms,
    )?;
    if actor.actor_id != request.target_writer_id {
        return Err("SQLite Library target writer does not match this installation".into());
    }
    Ok(DesktopLibraryWriterEpochReassignment {
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
        actor: DesktopLibraryActorEnrollment {
            actor_id: actor.actor_id,
            actor_public_key: actor.actor_public_key,
            enrollment_operation_id: actor.enrollment_operation_id,
            enrollment_certificate_digest: actor.enrollment_certificate_digest,
            canonical_enrollment_certificate_json: actor.canonical_enrollment_certificate_json,
            actor_chain_genesis: actor.actor_chain_genesis,
        },
        canonical_epoch_certificate_json: reassigned.canonical_certificate_json,
    })
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

const LOCAL_ONLY_CONTROL_REVISION_PREFIX: &str = "local-only-primary-v1:";

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

/// Stream one bounded, revision-pinned page for immutable checkpoint export.
#[tauri::command]
pub(super) fn read_sqlite_library_sync_page(
    app: tauri::AppHandle,
    request: SyncPageRequest,
) -> Result<DesktopLibrarySyncPage, String> {
    if request.revision < 0 || request.limit == 0 || request.limit > 128 {
        return Err("invalid SQLite Library sync page request".into());
    }
    let mut connection = open_database(&app)?;
    require_active(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let current_revision: i64 = transaction
        .query_row(
            "SELECT revision FROM library_core_desktop_state
             WHERE singletonId = 1 AND active = 1;",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if current_revision != request.revision {
        return Err("SQLite Library changed during checkpoint export".into());
    }
    let mut statement = transaction
        .prepare(
            "SELECT payloadJson FROM library_core_feed_items
             WHERE deletedAt IS NULL ORDER BY globalId ASC LIMIT ?1 OFFSET ?2;",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![i64::from(request.limit + 1), i64::from(request.offset)],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    let mut items_json = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    let has_more = items_json.len() > request.limit as usize;
    if has_more {
        items_json.truncate(request.limit as usize);
    }
    let next_offset = if has_more {
        Some(
            request
                .offset
                .checked_add(request.limit)
                .ok_or("SQLite Library sync offset overflow")?,
        )
    } else {
        None
    };
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(DesktopLibrarySyncPage {
        revision: current_revision,
        items_json,
        next_offset,
    })
}

#[tauri::command]
pub(super) fn replace_sqlite_library_shell(
    app: tauri::AppHandle,
    request: ReplaceShellRequest,
) -> Result<(), String> {
    validate_json_object(&request.shell_json, MAX_SHELL_BYTES)?;
    let mut connection = open_database(&app)?;
    require_active(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    require_writer_admission(&transaction)?;
    transaction
        .execute(
            "UPDATE library_core_desktop_state
             SET shellJson = ?1, revision = revision + 1 WHERE singletonId = 1;",
            [request.shell_json],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn upsert_sqlite_library_items(
    app: tauri::AppHandle,
    request: UpsertItemsRequest,
) -> Result<(), String> {
    if request.items_base64.is_empty() || request.items_base64.len() > MAX_IMPORT_BATCH {
        return Err("SQLite Library write batch must contain 1 through 1,000 items".into());
    }
    let mut connection = open_database(&app)?;
    require_active(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    require_writer_admission(&transaction)?;
    for encoded in &request.items_base64 {
        let item = decode_base64_json(encoded)?;
        upsert_item(&transaction, &item, request.updated_at_ms)?;
    }
    transaction
        .execute(
            "UPDATE library_core_desktop_state SET revision = revision + 1 WHERE singletonId = 1;",
            [],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn mutate_sqlite_library_items(
    app: tauri::AppHandle,
    request: ItemMutationRequest,
) -> Result<i64, String> {
    if request.ids.len() > MAX_IDS {
        return Err("SQLite Library mutation contains too many item IDs".into());
    }
    let mut connection = open_database(&app)?;
    require_active(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    require_writer_admission(&transaction)?;
    let mut affected = 0_i64;
    let mut apply_to_id = |global_id: &str| -> Result<(), String> {
        let (set_clause, predicate, values): (&str, &str, Vec<i64>) = match request.mutation.as_str() {
            "mark_read" => (
                "readAt = COALESCE(readAt, ?2), payloadJson = json_set(payloadJson, '$.userState.readAt', COALESCE(readAt, ?2))",
                "",
                vec![request.timestamp_ms],
            ),
            "toggle_saved" => (
                "saved = CASE WHEN saved = 1 THEN 0 ELSE 1 END,
                 archived = CASE WHEN saved = 1 THEN archived ELSE 0 END,
                 archivedAt = CASE WHEN saved = 1 THEN archivedAt ELSE NULL END,
                 payloadJson = CASE WHEN saved = 1
                   THEN json_remove(json_set(payloadJson, '$.userState.saved', json('false')), '$.userState.savedAt')
                   ELSE json_remove(json_set(payloadJson,
                     '$.userState.saved', json('true'),
                     '$.userState.savedAt', ?2,
                     '$.userState.archived', json('false')), '$.userState.archivedAt')
                 END",
                "",
                vec![request.timestamp_ms],
            ),
            "toggle_archived" => (
                "archived = CASE WHEN archived = 1 THEN 0 ELSE 1 END,
                 archivedAt = CASE WHEN archived = 1 THEN NULL ELSE ?2 END,
                 payloadJson = CASE WHEN archived = 1
                   THEN json_remove(json_set(payloadJson, '$.userState.archived', json('false')), '$.userState.archivedAt')
                   ELSE json_set(payloadJson, '$.userState.archived', json('true'), '$.userState.archivedAt', ?2)
                 END",
                " AND saved IS NOT 1",
                vec![request.timestamp_ms],
            ),
            "archive" => (
                "archived = 1, archivedAt = COALESCE(archivedAt, ?2), payloadJson = json_set(payloadJson, '$.userState.archived', json('true'), '$.userState.archivedAt', COALESCE(archivedAt, ?2))",
                " AND archived IS NOT 1 AND hidden IS NOT 1 AND saved IS NOT 1 AND readAt IS NOT NULL",
                vec![request.timestamp_ms],
            ),
            "toggle_liked" => (
                "liked = CASE WHEN liked = 1 THEN 0 ELSE 1 END,
                 likedAt = CASE WHEN liked = 1 THEN NULL ELSE ?2 END,
                 likedSyncedAt = NULL,
                 payloadJson = CASE WHEN liked = 1
                   THEN json_remove(json_set(payloadJson, '$.userState.liked', json('false')), '$.userState.likedAt', '$.userState.likedSyncedAt')
                   ELSE json_remove(json_set(payloadJson, '$.userState.liked', json('true'), '$.userState.likedAt', ?2), '$.userState.likedSyncedAt')
                 END",
                "",
                vec![request.timestamp_ms],
            ),
            "confirm_liked" => (
                "likedSyncedAt = ?2, payloadJson = json_set(payloadJson, '$.userState.likedSyncedAt', ?2)",
                "",
                vec![request.timestamp_ms],
            ),
            "confirm_seen" => (
                "seenSyncedAt = ?2, payloadJson = json_set(payloadJson, '$.userState.seenSyncedAt', ?2)",
                "",
                vec![request.timestamp_ms],
            ),
            "delete" => ("deletedAt = ?2", "", vec![request.timestamp_ms]),
            _ => return Err("unsupported SQLite Library item mutation".into()),
        };
        let sql = format!(
            "UPDATE library_core_feed_items SET {set_clause}, updatedAtMs = ?{} WHERE globalId = ?1 AND deletedAt IS NULL{predicate};",
            values.len() + 2,
        );
        let mut parameters: Vec<&dyn rusqlite::ToSql> = vec![&global_id];
        for value in &values {
            parameters.push(value);
        }
        parameters.push(&request.timestamp_ms);
        affected += i64::try_from(
            transaction
                .execute(&sql, parameters.as_slice())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|_| "SQLite mutation affected too many rows")?;
        Ok(())
    };

    match request.mutation.as_str() {
        "mark_all_read" => {
            affected += i64::try_from(transaction
                .execute(
                    "UPDATE library_core_feed_items
                     SET readAt = COALESCE(readAt, ?1),
                         payloadJson = json_set(payloadJson, '$.userState.readAt', COALESCE(readAt, ?1)),
                         updatedAtMs = ?1
                     WHERE deletedAt IS NULL AND readAt IS NULL
                       AND (?2 IS NULL OR platform = ?2);",
                    params![request.timestamp_ms, request.platform],
                )
                .map_err(|error| error.to_string())?)
                .map_err(|_| "SQLite mutation affected too many rows")?;
        }
        "archive_all_read_unsaved" => {
            affected += i64::try_from(transaction
                .execute(
                    "UPDATE library_core_feed_items
                     SET archived = 1, archivedAt = COALESCE(archivedAt, ?1),
                         payloadJson = json_set(payloadJson, '$.userState.archived', json('true'), '$.userState.archivedAt', COALESCE(archivedAt, ?1)),
                         updatedAtMs = ?1
                     WHERE deletedAt IS NULL AND readAt IS NOT NULL AND saved IS NOT 1
                       AND archived IS NOT 1 AND hidden IS NOT 1
                       AND (?2 IS NULL OR platform = ?2)
                       AND (?3 IS NULL OR feedUrl = ?3);",
                    params![request.timestamp_ms, request.platform, request.feed_url],
                )
                .map_err(|error| error.to_string())?)
                .map_err(|_| "SQLite mutation affected too many rows")?;
        }
        "unarchive_saved" => {
            affected += i64::try_from(transaction
                .execute(
                    "UPDATE library_core_feed_items
                     SET archived = 0, archivedAt = NULL,
                         payloadJson = json_remove(json_set(payloadJson, '$.userState.archived', json('false')), '$.userState.archivedAt'),
                         updatedAtMs = ?1
                     WHERE deletedAt IS NULL AND saved = 1 AND archived = 1;",
                    [request.timestamp_ms],
                )
                .map_err(|error| error.to_string())?)
                .map_err(|_| "SQLite mutation affected too many rows")?;
        }
        "delete_all_archived" => {
            affected += i64::try_from(
                transaction
                    .execute(
                        "UPDATE library_core_feed_items SET deletedAt = ?1, updatedAtMs = ?1
                     WHERE deletedAt IS NULL AND archived = 1 AND saved IS NOT 1;",
                        [request.timestamp_ms],
                    )
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|_| "SQLite mutation affected too many rows")?;
        }
        "prune_archived" => {
            let cutoff = request.timestamp_ms - request.max_age_ms.unwrap_or(0).max(0);
            affected += i64::try_from(
                transaction
                    .execute(
                        "UPDATE library_core_feed_items SET deletedAt = ?1, updatedAtMs = ?1
                     WHERE deletedAt IS NULL AND archived = 1 AND saved IS NOT 1
                       AND archivedAt IS NOT NULL AND archivedAt <= ?2;",
                        params![request.timestamp_ms, cutoff],
                    )
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|_| "SQLite mutation affected too many rows")?;
        }
        "clear_sample" => {
            affected += i64::try_from(
                transaction
                    .execute(
                        "UPDATE library_core_feed_items SET deletedAt = ?1, updatedAtMs = ?1
                     WHERE deletedAt IS NULL AND sampleData = 1;",
                        [request.timestamp_ms],
                    )
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|_| "SQLite mutation affected too many rows")?;
        }
        "delete_rss" => {
            affected += i64::try_from(
                transaction
                    .execute(
                        "UPDATE library_core_feed_items SET deletedAt = ?1, updatedAtMs = ?1
                         WHERE deletedAt IS NULL AND platform = 'rss'
                           AND (?2 IS NULL OR feedUrl = ?2);",
                        params![request.timestamp_ms, request.feed_url],
                    )
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|_| "SQLite mutation affected too many rows")?;
        }
        _ => {
            for global_id in &request.ids {
                apply_to_id(global_id)?;
            }
        }
    }
    transaction
        .execute(
            "UPDATE library_core_desktop_state SET revision = revision + 1 WHERE singletonId = 1;",
            [],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(affected)
}

#[tauri::command]
pub(super) fn read_sqlite_library_items(
    app: tauri::AppHandle,
    request: ReadItemsRequest,
) -> Result<Vec<String>, String> {
    if request.ids.len() > MAX_IDS {
        return Err("SQLite Library read contains too many item IDs".into());
    }
    let connection = open_database(&app)?;
    require_active(&connection)?;
    let mut statement = connection
        .prepare(
            "SELECT payloadJson FROM library_core_feed_items
             WHERE globalId = ?1 AND deletedAt IS NULL;",
        )
        .map_err(|error| error.to_string())?;
    let mut result = Vec::with_capacity(request.ids.len());
    for global_id in request.ids {
        if let Some(payload) = statement
            .query_row([global_id], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|error| error.to_string())?
        {
            result.push(payload);
        }
    }
    Ok(result)
}

#[tauri::command]
pub(super) fn query_sqlite_library_items(
    app: tauri::AppHandle,
    request: QueryItemsRequest,
) -> Result<QueryItemsResult, String> {
    let encode_filter_set = |values: Option<&[String]>, label: &str| {
        let Some(values) = values else {
            return Ok(None);
        };
        if values.len() > 32 || values.iter().any(|value| value.len() > 8_192) {
            return Err(format!("SQLite Library {label} filter exceeds its bound"));
        }
        serde_json::to_string(values)
            .map(Some)
            .map_err(|error| error.to_string())
    };
    let tags_json = encode_filter_set(request.tags.as_deref(), "tag")?;
    let signals_json = encode_filter_set(request.signals.as_deref(), "signal")?;
    let author_keys = request.author_keys.unwrap_or_default();
    if author_keys.len() > 5_000
        || author_keys
            .iter()
            .any(|key| key.platform.len() > 8_192 || key.author_id.len() > 8_192)
    {
        return Err("SQLite Library author filter exceeds its bound".into());
    }
    let limit = request.limit.clamp(1, 128);
    let connection = open_database(&app)?;
    require_active(&connection)?;
    connection
        .execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS query_author_keys (
               platform TEXT NOT NULL,
               authorId TEXT NOT NULL,
               PRIMARY KEY (platform, authorId)
             ) WITHOUT ROWID;
             DELETE FROM query_author_keys;",
        )
        .map_err(|error| error.to_string())?;
    if !author_keys.is_empty() {
        let mut insert = connection
            .prepare(
                "INSERT OR IGNORE INTO query_author_keys (platform, authorId) VALUES (?1, ?2);",
            )
            .map_err(|error| error.to_string())?;
        for key in &author_keys {
            insert
                .execute(params![key.platform, key.author_id])
                .map_err(|error| error.to_string())?;
        }
    }
    let query = request.query.unwrap_or_default();
    let like = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    // Keep the visibility predicate literal. Hiding it behind an optional OR
    // prevents SQLite from proving either partial timeline index applies and
    // turns every OFFSET page into a full-table temporary sort.
    let has_platform = request.platform.is_some();
    let has_author = request.author_id.is_some();
    let has_feed = request.feed_url.is_some();
    let (page_sql, count_sql) = match (
        request.show_hidden,
        has_platform && has_author,
        has_platform && has_feed,
    ) {
        (true, _, true) => (ALL_FEED_ITEMS_PAGE_SQL, ALL_FEED_ITEMS_COUNT_SQL),
        (false, _, true) => (VISIBLE_FEED_ITEMS_PAGE_SQL, VISIBLE_FEED_ITEMS_COUNT_SQL),
        (true, true, false) => (ALL_AUTHOR_ITEMS_PAGE_SQL, ALL_AUTHOR_ITEMS_COUNT_SQL),
        (false, true, false) => (
            VISIBLE_AUTHOR_ITEMS_PAGE_SQL,
            VISIBLE_AUTHOR_ITEMS_COUNT_SQL,
        ),
        (true, false, false) => (ALL_LIBRARY_ITEMS_PAGE_SQL, ALL_LIBRARY_ITEMS_COUNT_SQL),
        (false, false, false) => (
            VISIBLE_LIBRARY_ITEMS_PAGE_SQL,
            VISIBLE_LIBRARY_ITEMS_COUNT_SQL,
        ),
    };
    let order_by = match request.sort_mode.as_deref() {
        None | Some("date_published") => {
            "publishedAt DESC, capturedAt DESC, globalId ASC"
        }
        Some("date_saved") => {
            "COALESCE(json_extract(payloadJson, '$.userState.savedAt'), capturedAt) DESC, globalId ASC"
        }
        Some("recommended") => {
            "COALESCE(json_extract(payloadJson, '$.priority'), -1.0e308) DESC, publishedAt DESC, globalId ASC"
        }
        Some("shortest_read") => {
            "CASE WHEN json_extract(payloadJson, '$.preservedContent.readingTime') IS NULL THEN 1 ELSE 0 END ASC, json_extract(payloadJson, '$.preservedContent.readingTime') ASC, COALESCE(json_extract(payloadJson, '$.userState.savedAt'), capturedAt) DESC, globalId ASC"
        }
        Some(_) => return Err("SQLite Library sort mode is invalid".into()),
    };
    let page_sql = page_sql.replace("publishedAt DESC, capturedAt DESC, globalId ASC", order_by);
    let exact_filter_sql = "
       AND (?11 IS NULL OR contentType = ?11)
       AND (?12 IS NULL OR contentType <> ?12)
       AND (?13 IS NULL OR EXISTS (
         SELECT 1 FROM json_each(json_extract(payloadJson, '$.userState.tags'))
         WHERE value IN (SELECT value FROM json_each(?13))
       ))
       AND (?14 IS NULL OR EXISTS (
         SELECT 1 FROM json_each(json_extract(payloadJson, '$.contentSignals.tags'))
         WHERE value IN (SELECT value FROM json_each(?14))
       ))
       AND (?15 = 0 OR EXISTS (
         SELECT 1 FROM query_author_keys
         WHERE query_author_keys.platform = library_core_feed_items.platform
           AND query_author_keys.authorId = library_core_feed_items.authorId
       ))
       AND (?16 IS NULL OR (json_extract(payloadJson, '$.content.linkPreview.url') IS NOT NULL) = ?16)
       AND (?17 IS NULL OR (
         json_extract(payloadJson, '$.preservedContent.text') IS NULL
         OR json_extract(payloadJson, '$.preservedContent.text') = ''
       ) = ?17)
       AND (?18 IS NULL OR (
         COALESCE(json_array_length(json_extract(payloadJson, '$.content.mediaUrls')), 0) > 0
       ) = ?18)
       AND (?19 IS NULL OR (
         json_extract(payloadJson, '$.location.coordinates') IS NOT NULL
         OR NULLIF(TRIM(COALESCE(json_extract(payloadJson, '$.location.name'), '')), '') IS NOT NULL
         OR NULLIF(TRIM(COALESCE(json_extract(payloadJson, '$.location.url'), '')), '') IS NOT NULL
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') LIKE '%📍%'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') LIKE '%🌍%'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') LIKE '%🌎%'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') LIKE '%🌏%'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') GLOB 'in [A-Z]*'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') GLOB 'at [A-Z]*'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') GLOB 'from [A-Z]*'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') GLOB '* in [A-Z]*'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') GLOB '* at [A-Z]*'
         OR COALESCE(json_extract(payloadJson, '$.content.text'), '') GLOB '* from [A-Z]*'
       ) = ?19)";
    let page_sql = page_sql.replace(
        "\n     ORDER BY",
        &format!("{exact_filter_sql}\n     ORDER BY"),
    );
    let count_sql = count_sql.replace(';', &format!("{exact_filter_sql};"));
    let mut statement = connection
        .prepare(&page_sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                query,
                like,
                request.platform,
                request.saved.map(i64::from),
                request.archived.map(i64::from),
                i64::from(request.show_hidden),
                request.author_id,
                request.feed_url,
                i64::from(limit + 1),
                i64::from(request.offset),
                request.content_type,
                request.exclude_content_type,
                tags_json,
                signals_json,
                i64::from(!author_keys.is_empty()),
                request.has_link_preview.map(i64::from),
                request.missing_preserved_text.map(i64::from),
                request.has_media.map(i64::from),
                request.location_candidate.map(i64::from),
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    let mut items_json = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    let has_more = items_json.len() > limit as usize;
    items_json.truncate(limit as usize);
    let total_count = if request.include_total_count.unwrap_or(true) {
        connection
            .query_row(
                &count_sql,
                params![
                    query,
                    like,
                    request.platform,
                    request.saved.map(i64::from),
                    request.archived.map(i64::from),
                    i64::from(request.show_hidden),
                    request.author_id,
                    request.feed_url,
                    i64::from(limit + 1),
                    i64::from(request.offset),
                    request.content_type,
                    request.exclude_content_type,
                    tags_json,
                    signals_json,
                    i64::from(!author_keys.is_empty()),
                    request.has_link_preview.map(i64::from),
                    request.missing_preserved_text.map(i64::from),
                    request.has_media.map(i64::from),
                    request.location_candidate.map(i64::from),
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?
    } else {
        -1
    };
    Ok(QueryItemsResult {
        next_offset: has_more.then_some(request.offset + limit),
        items_json,
        total_count,
    })
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
    fn json_items_require_a_bounded_identity() {
        let parsed = validate_json_object(r#"{"globalId":"rss:one"}"#, MAX_ITEM_BYTES)
            .expect("valid item object");
        assert_eq!(string_at(&parsed, &["globalId"]), Some("rss:one"));
        assert!(validate_json_object("[]", MAX_ITEM_BYTES).is_err());
    }

    #[test]
    fn base64_item_transport_preserves_non_bmp_and_escape_text() {
        let source = r#"{"globalId":"x:one","text":"Spain 🇪🇸 and Morocco 🇲🇦 with \\x text"}"#;
        let encoded = BASE64_STANDARD.encode(source.as_bytes());
        let decoded = decode_base64_json(&encoded).expect("decode item transport");
        assert_eq!(decoded, source);
        assert!(validate_json_object(&decoded, MAX_ITEM_BYTES).is_ok());
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
    fn library_item_pages_walk_timeline_indexes_without_temporary_sorts() {
        let root = temporary_root("sqlite-library-query-plan");
        fs::create_dir_all(&root).expect("create temporary root");
        let connection = open_database_at(&root).expect("open Library database");

        for (sql, expected_index, platform, author_id, feed_url) in [
            (
                VISIBLE_LIBRARY_ITEMS_PAGE_SQL,
                "library_core_feed_items_visible_timeline",
                None,
                None,
                None,
            ),
            (
                ALL_LIBRARY_ITEMS_PAGE_SQL,
                "library_core_feed_items_all_timeline",
                None,
                None,
                None,
            ),
            (
                VISIBLE_AUTHOR_ITEMS_PAGE_SQL,
                "library_core_feed_items_visible_author_timeline",
                Some("x"),
                Some("author:one"),
                None,
            ),
            (
                ALL_AUTHOR_ITEMS_PAGE_SQL,
                "library_core_feed_items_all_author_timeline",
                Some("x"),
                Some("author:one"),
                None,
            ),
            (
                VISIBLE_FEED_ITEMS_PAGE_SQL,
                "library_core_feed_items_visible_feed_timeline",
                Some("rss"),
                None,
                Some("https://feed.test/rss"),
            ),
            (
                ALL_FEED_ITEMS_PAGE_SQL,
                "library_core_feed_items_all_feed_timeline",
                Some("rss"),
                None,
                Some("https://feed.test/rss"),
            ),
        ] {
            let mut statement = connection
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare Library page plan");
            let details = statement
                .query_map(
                    params![
                        "",
                        "%%",
                        platform,
                        Option::<i64>::None,
                        Option::<i64>::None,
                        0_i64,
                        author_id,
                        feed_url,
                        129_i64,
                        0_i64,
                    ],
                    |row| row.get::<_, String>(3),
                )
                .expect("query Library page plan")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect Library page plan");
            assert!(
                details.iter().any(|detail| detail.contains(expected_index)),
                "Library paging must walk {expected_index}: {details:?}"
            );
            assert!(
                details
                    .iter()
                    .all(|detail| !detail.contains("USE TEMP B-TREE")),
                "Library paging must not rebuild a corpus-sized sort: {details:?}"
            );
        }

        for (sql, expected_index, platform, author_id, feed_url) in [
            (
                VISIBLE_AUTHOR_ITEMS_COUNT_SQL,
                "library_core_feed_items_visible_author_timeline",
                "x",
                Some("author:one"),
                None,
            ),
            (
                ALL_AUTHOR_ITEMS_COUNT_SQL,
                "library_core_feed_items_all_author_timeline",
                "x",
                Some("author:one"),
                None,
            ),
            (
                VISIBLE_FEED_ITEMS_COUNT_SQL,
                "library_core_feed_items_visible_feed_timeline",
                "rss",
                None,
                Some("https://feed.test/rss"),
            ),
            (
                ALL_FEED_ITEMS_COUNT_SQL,
                "library_core_feed_items_all_feed_timeline",
                "rss",
                None,
                Some("https://feed.test/rss"),
            ),
        ] {
            let mut statement = connection
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare Library count plan");
            let details = statement
                .query_map(
                    params![
                        "",
                        "%%",
                        platform,
                        Option::<i64>::None,
                        Option::<i64>::None,
                        0_i64,
                        author_id,
                        feed_url,
                    ],
                    |row| row.get::<_, String>(3),
                )
                .expect("query Library count plan")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect Library count plan");
            assert!(
                details.iter().any(|detail| detail.contains(expected_index)),
                "Library source counts must use {expected_index}: {details:?}"
            );
        }

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

    fn begin_staged_import(root: &Path, expected_item_count: i64) {
        begin_sqlite_library_import_at(
            root,
            BeginImportRequest {
                source_generation: 3,
                source_revision: 9,
                source_digest: "b".repeat(64),
                source_checkpoint_object_key: Some("checkpoints/3/manifest.json".to_string()),
                source_checkpoint_content_digest: Some("b".repeat(64)),
                source_checkpoint_transport_object_id: Some("drive-manifest-object-4".to_string()),
                expected_item_count,
                shell_json: r#"{"feeds":{}}"#.to_string(),
                started_at_ms: 300,
            },
        )
        .expect("begin staged import");
    }

    fn append_staged_import_item(root: &Path) {
        append_sqlite_library_import_at(
            root,
            AppendImportRequest {
                items_base64: vec![BASE64_STANDARD.encode(
                    r#"{"globalId":"rss:new","platform":"rss","userState":{"saved":false}}"#,
                )],
                updated_at_ms: 350,
            },
        )
        .expect("append staged item");
    }

    fn staged_import_follower_anchor(source_revision: i64) -> VerifiedFollowerAnchor {
        verified_follower_anchor(InstallFollowerAnchorRequest {
            authority: DesktopLibraryAcceptedAuthority {
                library_id: "c".repeat(64),
                epoch: 3,
                epoch_id: "d".repeat(64),
                authority_key_id: "e".repeat(64),
                authority_public_key: "f".repeat(64),
                observed_frontier: Vec::new(),
            },
            manifest_object_key: "checkpoints/3/manifest.json".to_string(),
            manifest_transport_object_id: "drive-manifest-object-4".to_string(),
            manifest_content_digest: "b".repeat(64),
            generation: 4,
            remote_ingest_sequence: source_revision,
            remote_materialized_digest: "1".repeat(64),
            writer_id: "2".repeat(64),
            control_revision: "drive-revision-4".to_string(),
            checkpoint_actor: None,
            installed_at_ms: 390,
        })
    }

    #[test]
    fn staged_import_items_require_an_active_import_identity() {
        let root = temporary_root("sqlite-staged-import-identity");
        fs::create_dir_all(&root).expect("create temporary root");
        drop(open_database_at(&root).expect("create Library database"));
        let error = append_sqlite_library_import_at(
            &root,
            AppendImportRequest {
                items_base64: vec![
                    BASE64_STANDARD.encode(r#"{"globalId":"rss:unbound","platform":"rss"}"#)
                ],
                updated_at_ms: 350,
            },
        )
        .expect_err("reject item without staged import identity");
        assert!(error.contains("no active staged import"), "{error}");
        let connection = open_database_at(&root).expect("reopen Library database");
        let staged_item_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM library_core_import_item_stage;",
                [],
                |row| row.get(0),
            )
            .expect("count rolled back staged items");
        assert_eq!(staged_item_count, 0);
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn staged_import_rejects_an_oversized_encoded_page_before_decoding() {
        let root = temporary_root("sqlite-staged-import-page-bound");
        fs::create_dir_all(&root).expect("create temporary root");
        begin_staged_import(&root, 1);
        let error = append_sqlite_library_import_at(
            &root,
            AppendImportRequest {
                items_base64: vec!["a".repeat(MAX_IMPORT_PAGE_ENCODED_BYTES + 1)],
                updated_at_ms: 350,
            },
        )
        .expect_err("reject oversized encoded page");
        assert_eq!(error, "SQLite Library import page is too large");
        let connection = open_database_at(&root).expect("reopen Library database");
        let staged_item_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM library_core_import_item_stage;",
                [],
                |row| row.get(0),
            )
            .expect("count staged items");
        assert_eq!(staged_item_count, 0);
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn backup_restore_and_clear_honor_the_shared_operation_lock() {
        let root = temporary_root("sqlite-backup-operation-lock");
        fs::create_dir_all(&root).expect("create temporary root");
        begin_staged_import(&root, 1);
        append_staged_import_item(&root);
        finalize_sqlite_library_import_at(&root, 360, None).expect("activate Library");
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
    fn staged_checkpoint_reference_must_be_complete() {
        let root = temporary_root("sqlite-staged-import-checkpoint-reference");
        fs::create_dir_all(&root).expect("create temporary root");
        let error = begin_sqlite_library_import_at(
            &root,
            BeginImportRequest {
                source_generation: 3,
                source_revision: 9,
                source_digest: "b".repeat(64),
                source_checkpoint_object_key: Some("manifest".to_string()),
                source_checkpoint_content_digest: None,
                source_checkpoint_transport_object_id: None,
                expected_item_count: 0,
                shell_json: "{}".to_string(),
                started_at_ms: 300,
            },
        )
        .expect_err("reject partial checkpoint reference");
        assert!(error.contains("invalid SQLite Library import identity"));
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn staged_import_keeps_the_previous_library_until_atomic_activation() {
        let root = temporary_root("sqlite-staged-import-activation");
        fs::create_dir_all(&root).expect("create temporary root");
        seed_active_import_test_library(&root);
        begin_staged_import(&root, 1);

        let connection = open_database_at(&root).expect("reopen during staged import");
        let active_state: (i64, i64) = connection
            .query_row(
                "SELECT active, revision FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read active state during import");
        assert_eq!(active_state, (1, 7));
        let old_item_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM library_core_feed_items WHERE globalId = 'rss:old';",
                [],
                |row| row.get(0),
            )
            .expect("read old item during import");
        assert_eq!(old_item_count, 1);
        drop(connection);

        append_staged_import_item(&root);
        finalize_sqlite_library_import_at(&root, 400, None).expect("activate staged import");

        let connection = open_database_at(&root).expect("open activated Library");
        let activated_state: (i64, i64, i64, i64, String) = connection
            .query_row(
                "SELECT active, revision, sourceGeneration, sourceRevision, sourceDigest
                 FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("read activated state");
        assert_eq!(activated_state, (1, 1, 3, 9, "b".repeat(64)));
        let item_ids = connection
            .prepare("SELECT globalId FROM library_core_feed_items ORDER BY globalId;")
            .expect("prepare activated item query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query activated items")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect activated items");
        assert_eq!(item_ids, vec!["rss:new"]);
        let staged_rows: i64 = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM library_core_import_stage)
                      + (SELECT COUNT(*) FROM library_core_import_item_stage);",
                [],
                |row| row.get(0),
            )
            .expect("count cleared staging rows");
        assert_eq!(staged_rows, 0);
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn incomplete_staged_import_cannot_damage_the_active_library() {
        let root = temporary_root("sqlite-staged-import-rejection");
        fs::create_dir_all(&root).expect("create temporary root");
        seed_active_import_test_library(&root);
        begin_staged_import(&root, 2);
        append_staged_import_item(&root);

        let error = finalize_sqlite_library_import_at(&root, 400, None)
            .expect_err("reject incomplete staged import");
        assert!(error.contains("import count mismatch"), "{error}");

        let connection = open_database_at(&root).expect("open preserved Library");
        let preserved: (i64, i64, i64) = connection
            .query_row(
                "SELECT state.active, state.revision,
                        EXISTS(SELECT 1 FROM library_core_feed_items WHERE globalId = 'rss:old')
                 FROM library_core_desktop_state AS state WHERE state.singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read preserved Library");
        assert_eq!(preserved, (1, 7, 1));
        let staged_item_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM library_core_import_item_stage;",
                [],
                |row| row.get(0),
            )
            .expect("read retryable staged item");
        assert_eq!(staged_item_count, 1);
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn staged_follower_import_activates_checkpoint_and_anchor_atomically() {
        let root = temporary_root("sqlite-staged-follower-activation");
        fs::create_dir_all(&root).expect("create temporary root");
        seed_active_import_test_library(&root);
        begin_staged_import(&root, 1);
        append_staged_import_item(&root);
        let anchor = staged_import_follower_anchor(9);

        finalize_sqlite_library_import_at(&root, 400, Some(&anchor))
            .expect("atomically activate follower checkpoint");

        let connection = open_database_at(&root).expect("open activated follower Library");
        let installed: (i64, i64, String, i64, String) = connection
            .query_row(
                "SELECT state.sourceGeneration, state.sourceRevision, state.sourceDigest,
                        anchor.remoteIngestSequence, anchor.manifestContentDigest
                 FROM library_core_desktop_state AS state
                 JOIN library_core_follower_anchor AS anchor ON anchor.singletonId = 1
                 WHERE state.singletonId = 1 AND state.active = 1;",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("read atomically installed checkpoint and anchor");
        assert_eq!(installed, (3, 9, "b".repeat(64), 9, "b".repeat(64)));
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn mismatched_follower_anchor_rolls_back_checkpoint_activation() {
        let root = temporary_root("sqlite-staged-follower-mismatch");
        fs::create_dir_all(&root).expect("create temporary root");
        seed_active_import_test_library(&root);
        begin_staged_import(&root, 1);
        append_staged_import_item(&root);
        let anchor = staged_import_follower_anchor(8);

        let error = finalize_sqlite_library_import_at(&root, 400, Some(&anchor))
            .expect_err("reject mismatched follower anchor");
        assert!(error.contains("does not match"), "{error}");

        let connection = open_database_at(&root).expect("open preserved Library");
        let preserved: (i64, i64, i64, i64) = connection
            .query_row(
                "SELECT state.sourceGeneration, state.sourceRevision,
                        EXISTS(SELECT 1 FROM library_core_feed_items WHERE globalId = 'rss:old'),
                        (SELECT COUNT(*) FROM library_core_follower_anchor)
                 FROM library_core_desktop_state AS state WHERE state.singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read rolled back follower activation");
        assert_eq!(preserved, (1, 2, 1, 0));
        drop(connection);
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn substituted_manifest_object_cannot_activate_a_follower_checkpoint() {
        let root = temporary_root("sqlite-staged-follower-object-substitution");
        fs::create_dir_all(&root).expect("create temporary root");
        seed_active_import_test_library(&root);
        begin_staged_import(&root, 1);
        append_staged_import_item(&root);
        let mut anchor = staged_import_follower_anchor(9);
        anchor.manifest_transport_object_id = "substituted-drive-object".to_string();

        let error = finalize_sqlite_library_import_at(&root, 400, Some(&anchor))
            .expect_err("reject substituted manifest transport object");
        assert!(error.contains("does not match"), "{error}");

        let connection = open_database_at(&root).expect("open preserved Library");
        let preserved: (i64, i64) = connection
            .query_row(
                "SELECT state.sourceRevision,
                        EXISTS(SELECT 1 FROM library_core_feed_items WHERE globalId = 'rss:old')
                 FROM library_core_desktop_state AS state WHERE state.singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read Library after object substitution rejection");
        assert_eq!(preserved, (2, 1));
        drop(connection);
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
