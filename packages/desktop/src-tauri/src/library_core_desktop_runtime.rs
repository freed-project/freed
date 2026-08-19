//! Direct Freed Desktop Library storage.
//!
//! This is intentionally simpler than the replacement replication protocol.
//! SQLite owns the local Desktop Library after one explicit import. Automerge
//! is retained only as the cold source file that can be restored if the import
//! is rejected. Normal startup, reads, and writes do not open it.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
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
    establish_genesis_epoch, legacy_library_id, load_established_authority_key_pair,
    reassign_writer_epoch, LegacySourceRevision,
};
use super::library_core_journal::{
    AcceptedAuthorityState, FollowerIntentEnqueueReceipt, FollowerIntentOutboxCandidate,
    FollowerIntentPublicationReceipt, FollowerOverlayReplayReceipt, FollowerResultImportCursor,
    FollowerResultImportReceipt, FollowerRuntimeStatus, IntentResultOutboxEntry,
    LibraryCoreJournal, StoredFollowerActorEnrollment, StoredFollowerActorRequest,
    VerifiedCausalTip, VerifiedFollowerAnchor, VerifiedFollowerCheckpointActor,
    VerifiedFollowerIntentPublication, VerifiedFollowerIntentResult, VerifiedFollowerResultSegment,
};
use super::library_core_journal_runtime::journal_path;

const BACKUP_DIRECTORY: &str = "library-backups";
const MAX_IMPORT_BATCH: usize = 1_000;
const MAX_ITEM_BYTES: usize = 4 * 1024 * 1024;
const MAX_SHELL_BYTES: usize = 16 * 1024 * 1024;
const MAX_IDS: usize = 10_000;
const MAX_BACKUP_CHUNK_BYTES: usize = 1_048_576;
const MAX_SEARCH_PAGE_SIZE: usize = 32;
const MAX_SEARCH_QUERY_BYTES: usize = 1_024;
const MAX_SEARCH_QUERY_TERMS: usize = 32;
const MAX_SEARCH_TERMS_PER_ITEM: usize = 384;
const SEARCH_PRESERVED_TEXT_LIMIT: usize = 1_200;

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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct InstallFollowerAnchorRequest {
    authority: DesktopLibraryAcceptedAuthority,
    manifest_object_key: String,
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
pub(super) struct DesktopLibraryFollowerAnchor {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    manifest_content_digest: String,
    generation: i64,
    remote_ingest_sequence: i64,
    remote_materialized_digest: String,
    writer_id: String,
    control_revision: String,
    checkpoint_actor: Option<DesktopLibraryFollowerCheckpointActor>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SearchItemsRequest {
    query: String,
    after_global_id: Option<String>,
    limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScoredDesktopLibraryItem {
    item_json: String,
    score: f64,
    #[serde(skip)]
    global_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopLibrarySearchPage {
    matches: Vec<ScoredDesktopLibraryItem>,
    next_after_global_id: Option<String>,
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

fn app_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn open_database_at(root: &Path) -> Result<Connection, String> {
    fs::create_dir_all(root.join("library-core")).map_err(|error| error.to_string())?;
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

fn open_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    open_database_at(&app_root(app)?)
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

fn integer_at(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_i64()
}

fn boolean_at(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool().map(i64::from)
}

pub(crate) fn upsert_item(
    transaction: &Transaction<'_>,
    item_json: &str,
    updated_at_ms: i64,
) -> Result<(), String> {
    let item = validate_json_object(item_json, MAX_ITEM_BYTES)?;
    let global_id = string_at(&item, &["globalId"])
        .filter(|value| !value.is_empty() && value.len() <= 4_096)
        .ok_or_else(|| "feed item globalId is missing or invalid".to_string())?;
    transaction
        .execute(
            "INSERT INTO library_core_feed_items (
               globalId, platform, contentType, publishedAt, capturedAt,
               authorId, authorDisplayName, authorHandle, sourceUrl,
               hidden, saved, archived, readAt, archivedAt, liked, likedAt,
               likedSyncedAt, seenSyncedAt, feedUrl, sampleData, deletedAt,
               payloadJson, updatedAtMs
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
               ?14, ?15, ?16, ?17, ?18, ?19, ?20, NULL, ?21, ?22
             )
             ON CONFLICT(globalId) DO UPDATE SET
               platform = excluded.platform,
               contentType = excluded.contentType,
               publishedAt = excluded.publishedAt,
               capturedAt = excluded.capturedAt,
               authorId = excluded.authorId,
               authorDisplayName = excluded.authorDisplayName,
               authorHandle = excluded.authorHandle,
               sourceUrl = excluded.sourceUrl,
               hidden = excluded.hidden,
               saved = excluded.saved,
               archived = excluded.archived,
               readAt = excluded.readAt,
               archivedAt = excluded.archivedAt,
               liked = excluded.liked,
               likedAt = excluded.likedAt,
               likedSyncedAt = excluded.likedSyncedAt,
               seenSyncedAt = excluded.seenSyncedAt,
               feedUrl = excluded.feedUrl,
               sampleData = excluded.sampleData,
               deletedAt = NULL,
               payloadJson = excluded.payloadJson,
               updatedAtMs = excluded.updatedAtMs;",
            params![
                global_id,
                string_at(&item, &["platform"]),
                string_at(&item, &["contentType"]),
                integer_at(&item, &["publishedAt"]),
                integer_at(&item, &["capturedAt"]),
                string_at(&item, &["author", "id"]),
                string_at(&item, &["author", "displayName"]),
                string_at(&item, &["author", "handle"]),
                string_at(&item, &["sourceUrl"]),
                boolean_at(&item, &["userState", "hidden"]),
                boolean_at(&item, &["userState", "saved"]),
                boolean_at(&item, &["userState", "archived"]),
                integer_at(&item, &["userState", "readAt"]),
                integer_at(&item, &["userState", "archivedAt"]),
                boolean_at(&item, &["userState", "liked"]),
                integer_at(&item, &["userState", "likedAt"]),
                integer_at(&item, &["userState", "likedSyncedAt"]),
                integer_at(&item, &["userState", "seenSyncedAt"]),
                string_at(&item, &["rssSource", "feedUrl"]),
                i64::from(item.get("sampleDataFingerprint").is_some()),
                item_json,
                updated_at_ms,
            ],
        )
        .map_err(|error| error.to_string())?;
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
    let connection = open_database(&app)?;
    let status = connection
        .query_row(
            "SELECT active, revision, expectedItemCount, importedItemCount,
                    sourceGeneration, sourceRevision, sourceDigest
             FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| {
                Ok(DesktopLibraryStatus {
                    active: row.get::<_, i64>(0)? == 1,
                    revision: row.get(1)?,
                    expected_item_count: row.get(2)?,
                    imported_item_count: row.get(3)?,
                    source_generation: row.get(4)?,
                    source_revision: row.get(5)?,
                    source_digest: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
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
    if !validate_hex_digest(&request.source_digest)
        || !(0..=1_000_000).contains(&request.expected_item_count)
        || request.source_generation < 0
        || request.source_revision < 0
        || request.started_at_ms < 0
    {
        return Err("invalid SQLite Library import identity".into());
    }
    validate_json_object(&request.shell_json, MAX_SHELL_BYTES)?;
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM library_core_feed_items;", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO library_core_desktop_state (
               singletonId, active, revision, sourceGeneration, sourceRevision,
               sourceDigest, expectedItemCount, importedItemCount, shellJson,
               startedAtMs, activatedAtMs
             ) VALUES (1, 0, 0, ?1, ?2, ?3, ?4, 0, ?5, ?6, NULL)
             ON CONFLICT(singletonId) DO UPDATE SET
               active = 0,
               revision = 0,
               sourceGeneration = excluded.sourceGeneration,
               sourceRevision = excluded.sourceRevision,
               sourceDigest = excluded.sourceDigest,
               expectedItemCount = excluded.expectedItemCount,
               importedItemCount = 0,
               shellJson = excluded.shellJson,
               startedAtMs = excluded.startedAtMs,
               activatedAtMs = NULL;",
            params![
                request.source_generation,
                request.source_revision,
                request.source_digest,
                request.expected_item_count,
                request.shell_json,
                request.started_at_ms,
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn append_sqlite_library_import(
    app: tauri::AppHandle,
    request: AppendImportRequest,
) -> Result<i64, String> {
    if request.items_base64.is_empty() || request.items_base64.len() > MAX_IMPORT_BATCH {
        return Err("SQLite Library import batch must contain 1 through 1,000 items".into());
    }
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for encoded in &request.items_base64 {
        let item = decode_base64_json(encoded)?;
        upsert_item(&transaction, &item, request.updated_at_ms)?;
    }
    let count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM library_core_feed_items WHERE deletedAt IS NULL;",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE library_core_desktop_state SET importedItemCount = ?1
             WHERE singletonId = 1 AND active = 0;",
            [count],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(count)
}

#[tauri::command]
pub(super) fn finalize_sqlite_library_import(
    app: tauri::AppHandle,
    activated_at_ms: i64,
) -> Result<DesktopLibraryStatus, String> {
    let mut connection = open_database(&app)?;
    let (expected, imported): (i64, i64) = connection
        .query_row(
            "SELECT expectedItemCount, importedItemCount
             FROM library_core_desktop_state WHERE singletonId = 1 AND active = 0;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let actual: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM library_core_feed_items WHERE deletedAt IS NULL;",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if expected != imported || expected != actual {
        return Err(format!(
            "SQLite Library import count mismatch: expected {expected}, imported {imported}, actual {actual}"
        ));
    }
    let integrity: String = connection
        .query_row("PRAGMA integrity_check;", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err(format!(
            "SQLite Library integrity check failed: {integrity}"
        ));
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE library_core_desktop_state
             SET active = 1, activatedAtMs = ?1, revision = 1
             WHERE singletonId = 1 AND active = 0;",
            [activated_at_ms],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    let root = app_root(&app)?;
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
    let replay: FollowerOverlayReplayReceipt = journal
        .replay_pending_follower_overlay()
        .map_err(|error| format!("SQLite Library refused follower overlay replay: {error}"))?;
    if replay.transaction_count > 0 {
        log::info!(
            "[library-core] replayed {} pending follower transactions, {} operations, {} materialized rows, revision advanced={}",
            replay.transaction_count,
            replay.operation_count,
            replay.materialized_row_count,
            replay.revision_advanced
        );
    }
    sqlite_library_status(app)?.ok_or_else(|| "SQLite Library activation disappeared".into())
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
#[tauri::command]
pub(super) fn read_sqlite_library_sync_descriptor(
    app: tauri::AppHandle,
) -> Result<DesktopLibrarySyncDescriptor, String> {
    let mut connection = open_database(&app)?;
    require_active(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let (revision, source_digest, shell_json): (i64, String, String) = transaction
        .query_row(
            "SELECT revision, sourceDigest, shellJson
             FROM library_core_desktop_state WHERE singletonId = 1 AND active = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
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
    Ok(DesktopLibrarySyncDescriptor {
        revision,
        item_count,
        source_digest,
        shell_json,
        materialized_digest,
    })
}

/// Persist one authenticated remote checkpoint as a non-authoritative follower.
///
/// This command never writes the active authority epoch or cloud-writer
/// admission. It can make the imported materialization usable by the follower
/// runtime, but it cannot turn this installation into a canonical writer.
#[tauri::command]
pub(super) fn install_sqlite_library_follower_anchor(
    app: tauri::AppHandle,
    request: InstallFollowerAnchorRequest,
) -> Result<DesktopLibraryFollowerAnchor, String> {
    let root = app_root(&app)?;
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    drop(connection);
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
    let anchor = journal
        .install_follower_anchor(&VerifiedFollowerAnchor {
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
            manifest_content_digest: request.manifest_content_digest,
            generation: request.generation,
            remote_ingest_sequence: request.remote_ingest_sequence,
            remote_materialized_digest: request.remote_materialized_digest,
            writer_id: request.writer_id,
            control_revision: request.control_revision,
            checkpoint_actor: request.checkpoint_actor.map(|actor| {
                VerifiedFollowerCheckpointActor {
                    actor_id: actor.actor_id,
                    accepted_sequence: actor.accepted_sequence,
                    accepted_operation_id: actor.accepted_operation_id,
                    accepted_chain_digest: actor.accepted_chain_digest,
                    enrollment_certificate_digest: actor.enrollment_certificate_digest,
                }
            }),
            installed_at_ms: request.installed_at_ms,
        })
        .map_err(|error| format!("SQLite Library could not install follower anchor: {error}"))?;
    Ok(DesktopLibraryFollowerAnchor {
        library_id: anchor.authority.library_id,
        epoch: anchor.authority.epoch,
        epoch_id: anchor.authority.epoch_id,
        manifest_content_digest: anchor.manifest_content_digest,
        generation: anchor.generation,
        remote_ingest_sequence: anchor.remote_ingest_sequence,
        remote_materialized_digest: anchor.remote_materialized_digest,
        writer_id: anchor.writer_id,
        control_revision: anchor.control_revision,
        checkpoint_actor: anchor.checkpoint_actor.map(|actor| {
            DesktopLibraryFollowerCheckpointActor {
                actor_id: actor.actor_id,
                accepted_sequence: actor.accepted_sequence,
                accepted_operation_id: actor.accepted_operation_id,
                accepted_chain_digest: actor.accepted_chain_digest,
                enrollment_certificate_digest: actor.enrollment_certificate_digest,
            }
        }),
    })
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    if !validate_hex_digest(&request.installation_witness) || request.accepted_at_ms < 0 {
        return Err("SQLite Library authority bootstrap request is invalid".into());
    }
    let root = app_root(&app)?;
    let path = journal_path(&root);
    let connection = open_database_at(&root)?;
    require_active(&connection)?;
    let (source_generation, source_revision, source_digest): (i64, i64, String) = connection
        .query_row(
            "SELECT sourceGeneration, sourceRevision, sourceDigest
             FROM library_core_desktop_state WHERE singletonId = 1 AND active = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;
    drop(connection);
    let source_generation = u64::try_from(source_generation)
        .map_err(|_| "SQLite Library source generation is invalid")?;
    let source_revision =
        u64::try_from(source_revision).map_err(|_| "SQLite Library source revision is invalid")?;
    if !validate_hex_digest(&source_digest) {
        return Err("SQLite Library source digest is invalid".into());
    }

    let mut journal = LibraryCoreJournal::open(&path).map_err(|error| error.to_string())?;
    let revision = LegacySourceRevision {
        document_id: format!("freed-sqlite-{source_digest}"),
        heads_digest: source_digest,
        head_count: 1,
        storage_generation: source_generation,
        storage_save_revision: source_revision,
    };
    let library_id = legacy_library_id(&revision.document_id)?;
    let authority = match journal
        .active_authority_epoch(&library_id)
        .map_err(|error| error.to_string())?
    {
        Some(active) => active.authority,
        None => establish_genesis_epoch(&mut journal, &revision, request.accepted_at_ms)?,
    };
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
            allowed: true,
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
    if writer_admission_status(connection)?.allowed {
        Ok(())
    } else {
        Err("Another Freed Desktop currently owns writes for this Library".into())
    }
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let mut journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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
    let journal =
        LibraryCoreJournal::open(&journal_path(&root)).map_err(|error| error.to_string())?;
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

fn search_terms(value: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || matches!(character, '_' | '@' | '#') {
            current.push(character);
        } else if !current.is_empty() {
            if !terms.contains(&current) {
                terms.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
        }
    }
    if !current.is_empty() && !terms.contains(&current) {
        terms.push(current);
    }
    terms
}

fn bounded_edit_distance(left: &str, right: &str, maximum: usize) -> usize {
    let left = left.chars().collect::<Vec<_>>();
    let right = right.chars().collect::<Vec<_>>();
    if left.len().abs_diff(right.len()) > maximum {
        return maximum + 1;
    }
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    for (left_index, left_character) in left.iter().enumerate() {
        let mut current = vec![left_index + 1];
        let mut row_minimum = left_index + 1;
        for (right_index, right_character) in right.iter().enumerate() {
            let value = std::cmp::min(
                std::cmp::min(current[right_index] + 1, previous[right_index + 1] + 1),
                previous[right_index] + usize::from(left_character != right_character),
            );
            current.push(value);
            row_minimum = row_minimum.min(value);
        }
        if row_minimum > maximum {
            return maximum + 1;
        }
        previous = current;
    }
    previous[right.len()]
}

fn search_term_score(query: &str, candidate: &str, weight: f64) -> f64 {
    if candidate == query {
        return weight * 4.0;
    }
    if candidate.starts_with(query) {
        return weight * 3.0;
    }
    if query.chars().count() < 4 {
        return 0.0;
    }
    let maximum = std::cmp::max(1, query.chars().count() / 5);
    let distance = bounded_edit_distance(query, candidate, maximum);
    if distance <= maximum {
        weight * 2.0 - distance as f64 / 10.0
    } else {
        0.0
    }
}

fn collect_search_field(value: Option<&str>, weight: f64, fields: &mut Vec<(String, f64)>) {
    if fields.len() >= MAX_SEARCH_TERMS_PER_ITEM {
        return;
    }
    if let Some(value) = value {
        for term in search_terms(value) {
            if fields.len() >= MAX_SEARCH_TERMS_PER_ITEM {
                break;
            }
            fields.push((term, weight));
        }
    }
}

fn collect_search_array(item: &Value, path: &[&str], weight: f64, fields: &mut Vec<(String, f64)>) {
    let mut value = item;
    for key in path {
        let Some(next) = value.get(*key) else {
            return;
        };
        value = next;
    }
    if let Some(values) = value.as_array() {
        for value in values {
            collect_search_field(value.as_str(), weight, fields);
        }
    }
}

fn search_item_score(item: &Value, query_terms: &[String]) -> f64 {
    let mut fields = Vec::new();
    collect_search_field(
        string_at(item, &["content", "linkPreview", "title"]),
        4.0,
        &mut fields,
    );
    for path in [
        &["eventCandidate", "title"][..],
        &["eventCandidate", "locationName"][..],
        &["eventCandidate", "evidence"][..],
        &["location", "name"][..],
    ] {
        collect_search_field(string_at(item, path), 3.0, &mut fields);
    }
    collect_search_array(item, &["topics"], 3.0, &mut fields);
    collect_search_array(item, &["contentSignals", "tags"], 3.0, &mut fields);
    collect_search_array(item, &["userState", "tags"], 3.0, &mut fields);
    collect_search_field(
        string_at(item, &["author", "displayName"]),
        3.0,
        &mut fields,
    );
    collect_search_field(string_at(item, &["author", "handle"]), 3.0, &mut fields);
    collect_search_field(string_at(item, &["author", "id"]), 3.0, &mut fields);
    collect_search_field(string_at(item, &["content", "text"]), 2.0, &mut fields);
    collect_search_field(
        string_at(item, &["content", "linkPreview", "description"]),
        2.0,
        &mut fields,
    );
    collect_search_field(
        string_at(item, &["rssSource", "feedTitle"]),
        2.0,
        &mut fields,
    );
    collect_search_field(
        string_at(item, &["preservedContent", "text"]),
        1.0,
        &mut fields,
    );
    if let Some(highlights) = item
        .pointer("/userState/highlights")
        .and_then(Value::as_array)
    {
        for highlight in highlights {
            collect_search_field(string_at(highlight, &["text"]), 2.0, &mut fields);
            collect_search_field(string_at(highlight, &["note"]), 2.0, &mut fields);
        }
    }

    let mut total = 0.0;
    for query in query_terms {
        let best = fields
            .iter()
            .map(|(candidate, weight)| search_term_score(query, candidate, *weight))
            .fold(0.0_f64, f64::max);
        if best == 0.0 {
            return 0.0;
        }
        total += best;
    }
    total
}

fn strip_large_search_payload(item: &mut Value) {
    let Some(preserved) = item
        .get_mut("preservedContent")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    preserved.remove("html");
    if let Some(text) = preserved.get("text").and_then(Value::as_str) {
        let bounded = text
            .chars()
            .take(SEARCH_PRESERVED_TEXT_LIMIT)
            .collect::<String>();
        preserved.insert("text".into(), Value::String(bounded));
    }
}

/// Search the active SQLite Library without copying its corpus into WebKit.
#[tauri::command]
pub(super) fn search_sqlite_library_items(
    app: tauri::AppHandle,
    request: SearchItemsRequest,
) -> Result<DesktopLibrarySearchPage, String> {
    let connection = open_database(&app)?;
    require_active(&connection)?;
    search_sqlite_library_items_at(&connection, request)
}

fn search_sqlite_library_items_at(
    connection: &Connection,
    request: SearchItemsRequest,
) -> Result<DesktopLibrarySearchPage, String> {
    if request.query.len() > MAX_SEARCH_QUERY_BYTES {
        return Err("SQLite Library search query is too large".into());
    }
    let query_terms = search_terms(&request.query)
        .into_iter()
        .take(MAX_SEARCH_QUERY_TERMS)
        .collect::<Vec<_>>();
    if query_terms.is_empty() {
        return Ok(DesktopLibrarySearchPage {
            matches: Vec::new(),
            next_after_global_id: None,
        });
    }
    if request
        .after_global_id
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.len() > 4_096)
    {
        return Err("SQLite Library search cursor is invalid".into());
    }
    let limit = request.limit.clamp(1, MAX_SEARCH_PAGE_SIZE);
    let mut statement = connection
        .prepare(
            "SELECT payloadJson FROM library_core_feed_items
             WHERE deletedAt IS NULL
               AND (?1 IS NULL OR globalId COLLATE BINARY > ?1)
             ORDER BY globalId COLLATE BINARY ASC;",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([request.after_global_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut matches = Vec::with_capacity(limit);
    let mut next_after_global_id = None;
    for row in rows {
        let item_json = row.map_err(|error| error.to_string())?;
        let mut item = validate_json_object(&item_json, MAX_ITEM_BYTES)?;
        let score = search_item_score(&item, &query_terms);
        if score <= 0.0 {
            continue;
        }
        let global_id = string_at(&item, &["globalId"])
            .ok_or_else(|| "SQLite Library search item has no identity".to_string())?
            .to_string();
        strip_large_search_payload(&mut item);
        let item_json = serde_json::to_string(&item).map_err(|error| error.to_string())?;
        matches.push(ScoredDesktopLibraryItem {
            item_json,
            score,
            global_id,
        });
        if matches.len() == limit {
            next_after_global_id = matches.last().map(|item| item.global_id.clone());
            break;
        }
    }
    Ok(DesktopLibrarySearchPage {
        matches,
        next_after_global_id,
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
    if reason != "auto" && reason != "manual" {
        return Err("invalid SQLite Library backup reason".into());
    }
    let backup_directory = root.join(BACKUP_DIRECTORY);
    fs::create_dir_all(&backup_directory).map_err(|error| error.to_string())?;
    let backup_id = format!("sqlite-{created_at_ms}");
    let file_name = format!("{backup_id}.sqlite");
    let destination = backup_directory.join(&file_name);
    if destination.exists() {
        return Err("SQLite Library backup already exists".into());
    }
    let connection = open_database_at(root)?;
    require_active(&connection)?;
    connection
        .execute("VACUUM INTO ?1;", [destination.to_string_lossy().as_ref()])
        .map_err(|error| error.to_string())?;
    let check = Connection::open(&destination).map_err(|error| error.to_string())?;
    let integrity: String = check
        .query_row("PRAGMA integrity_check;", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        let _ = fs::remove_file(&destination);
        return Err(format!(
            "SQLite Library backup integrity failed: {integrity}"
        ));
    }
    let (revision, item_count): (i64, i64) = check
        .query_row(
            "SELECT
               (SELECT revision FROM library_core_desktop_state WHERE singletonId = 1),
               (SELECT COUNT(*) FROM library_core_feed_items WHERE deletedAt IS NULL);",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let byte_length = fs::metadata(&destination)
        .map_err(|error| error.to_string())?
        .len();
    let sha256 = sha256_file(&destination)?;
    drop(check);
    connection
        .execute(
            "INSERT INTO library_core_desktop_backups (
               backupId, createdAtMs, revision, itemCount, reason, fileName, byteLength, sha256
             ) SELECT ?1, ?2, revision, ?3, ?4, ?5, ?6, ?7
               FROM library_core_desktop_state WHERE singletonId = 1;",
            params![
                backup_id,
                created_at_ms,
                item_count,
                reason,
                file_name,
                i64::try_from(byte_length).map_err(|_| "backup is too large")?,
                sha256,
            ],
        )
        .map_err(|error| error.to_string())?;

    let mut statement = connection
        .prepare(
            "SELECT fileName FROM library_core_desktop_backups
             ORDER BY createdAtMs DESC, backupId DESC LIMIT -1 OFFSET 24;",
        )
        .map_err(|error| error.to_string())?;
    let expired = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    for expired_file in expired {
        let _ = fs::remove_file(backup_directory.join(&expired_file));
        connection
            .execute(
                "DELETE FROM library_core_desktop_backups WHERE fileName = ?1;",
                [expired_file],
            )
            .map_err(|error| error.to_string())?;
    }

    log::info!(
        "[library-core] created SQLite Library backup items={} bytes={}",
        item_count,
        byte_length
    );
    Ok(DesktopBackupSummary {
        backup_id,
        file_name,
        created_at_ms,
        revision,
        item_count,
        reason: reason.to_string(),
        byte_length,
        sha256,
    })
}

#[tauri::command]
pub(super) fn list_sqlite_library_backups(
    app: tauri::AppHandle,
) -> Result<Vec<DesktopBackupSummary>, String> {
    let root = app_root(&app)?;
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
    let backup_directory = root.join(BACKUP_DIRECTORY);
    let connection = open_database(&app)?;
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

    #[test]
    fn native_search_scores_fields_and_strips_large_reader_content() {
        let mut title_match = serde_json::json!({
            "globalId": "rss:title",
            "content": {
                "text": "ordinary words",
                "linkPreview": { "title": "SQLite architecture" }
            },
            "author": { "id": "one", "displayName": "Author", "handle": "author" },
            "topics": [],
            "userState": { "tags": [], "highlights": [] },
            "preservedContent": { "html": "<p>large</p>", "text": "x".repeat(2_000) }
        });
        let text_match = serde_json::json!({
            "globalId": "rss:text",
            "content": { "text": "sqlite architecture" },
            "author": { "id": "two", "displayName": "Author", "handle": "author" },
            "topics": [],
            "userState": { "tags": [], "highlights": [] }
        });
        let query = search_terms("sqlte architecture");
        let title_score = search_item_score(&title_match, &query);
        let text_score = search_item_score(&text_match, &query);
        assert!(title_score > text_score);
        assert!(title_score > 0.0, "one-character typo remains searchable");

        strip_large_search_payload(&mut title_match);
        assert!(title_match.pointer("/preservedContent/html").is_none());
        assert_eq!(
            title_match
                .pointer("/preservedContent/text")
                .and_then(Value::as_str)
                .expect("bounded preserved text")
                .chars()
                .count(),
            SEARCH_PRESERVED_TEXT_LIMIT,
        );
    }

    #[test]
    fn native_search_streams_the_complete_corpus_in_bounded_pages() {
        let root = temporary_root("sqlite-native-search");
        fs::create_dir_all(&root).expect("create temporary root");
        let mut connection = open_database_at(&root).expect("open Library database");
        connection
            .execute(
                "INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration, sourceRevision,
                   sourceDigest, expectedItemCount, importedItemCount, shellJson,
                   startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 1, 1, 1, ?1, 125, 125, '{}', 100, 200);",
                ["b".repeat(64)],
            )
            .expect("insert active Desktop state");
        let transaction = connection.transaction().expect("begin item insert");
        for index in 0..125 {
            let item = serde_json::json!({
                "globalId": format!("rss:{index:03}"),
                "platform": "rss",
                "contentType": "article",
                "content": { "text": format!("bounded sqlite search item {index}") },
                "author": { "id": "one", "displayName": "Author", "handle": "author" },
                "topics": [],
                "userState": { "hidden": false, "saved": false, "archived": false, "tags": [], "highlights": [] },
                "preservedContent": { "html": "<p>large</p>", "text": "x".repeat(2_000) }
            });
            upsert_item(&transaction, &item.to_string(), 300).expect("insert searchable item");
        }
        transaction.commit().expect("commit searchable items");

        let mut after_global_id = None;
        let mut seen = Vec::new();
        loop {
            let page = search_sqlite_library_items_at(
                &connection,
                SearchItemsRequest {
                    query: "sqlite search".into(),
                    after_global_id: after_global_id.clone(),
                    limit: 32,
                },
            )
            .expect("search SQLite Library");
            assert!(page.matches.len() <= MAX_SEARCH_PAGE_SIZE);
            for result in page.matches {
                let item: Value =
                    serde_json::from_str(&result.item_json).expect("decode search item");
                assert!(item.pointer("/preservedContent/html").is_none());
                assert_eq!(
                    item.pointer("/preservedContent/text")
                        .and_then(Value::as_str)
                        .expect("bounded preserved text")
                        .chars()
                        .count(),
                    SEARCH_PRESERVED_TEXT_LIMIT,
                );
                seen.push(result.global_id);
            }
            let Some(next) = page.next_after_global_id else {
                break;
            };
            assert_ne!(Some(&next), after_global_id.as_ref());
            after_global_id = Some(next);
        }
        assert_eq!(seen.len(), 125);
        assert!(seen.windows(2).all(|pair| pair[0] < pair[1]));
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
