//! Runtime-neutral native authority for Freed Library Core.
//!
//! This crate owns the signed SQLite journal, its verifiers, authority epochs,
//! actor enrollment, and deterministic product projection. Hosts supply an
//! explicit database path, key stores, and signed timestamps. It has no Tauri,
//! Google Drive, provider, or Automerge dependency.

mod library_core_actor_enrollment;
mod library_core_authority_genesis;
#[cfg(unix)]
mod library_core_bound_root;
#[cfg(unix)]
mod library_core_bound_sqlite_vfs;
#[cfg_attr(not(test), allow(dead_code))]
mod library_core_canonical;
#[cfg(unix)]
mod library_core_desktop_binding;
#[cfg_attr(not(test), allow(dead_code))]
mod library_core_ed25519;
mod library_core_hash;
#[cfg_attr(not(test), allow(dead_code))]
mod library_core_journal;
mod library_core_process_lease;
#[cfg(unix)]
mod library_core_sidecar;
mod library_core_store;
mod normalized_checkpoint;
mod normalized_import;
mod normalized_mutation;
mod normalized_query;
mod normalized_sqlite;
mod product_projection;
pub mod sqlite_contract_generated;

pub use library_core_actor_enrollment::{
    countersign_actor_enrollment_request, enroll_desktop_actor,
    prepare_follower_actor_enrollment_request, sign_follower_operation_digest, ActorKeyStore,
    EnrollmentAuthority, PreparedActorEnrollmentRequest,
};
pub use library_core_authority_genesis::{
    establish_or_transition_sqlite_authority, load_established_authority_key_pair,
    reassign_writer_epoch, AuthorityKeyStore, EstablishedSqliteAuthority,
    NativeSqliteSourceSnapshot, PersistedCloudAuthorityHint, SqliteAuthorityProtocolReceipt,
    WriterEpochReassignment,
};
#[cfg(unix)]
pub use library_core_desktop_binding::{
    desktop_binding, install_desktop_binding, LibraryCoreDesktopBinding,
};
pub use library_core_hash::lower_hex;
pub use library_core_journal::{
    AcceptedAuthorityState, ActorState, FollowerIntentEnqueueReceipt,
    FollowerIntentOutboxCandidate, FollowerIntentOutboxEntry, FollowerIntentPublicationReceipt,
    FollowerOverlayReplayReceipt, FollowerResultImportCursor, FollowerResultImportReceipt,
    FollowerRuntimeStatus, IntentResultOutboxEntry, JournalError, JournalRuntimeStatus,
    LibraryCoreJournal, StoredFollowerActorEnrollment, StoredFollowerActorRequest,
    VerifiedCausalTip, VerifiedFollowerAnchor, VerifiedFollowerCheckpointActor,
    VerifiedFollowerIntentPublication, VerifiedFollowerIntentResult, VerifiedFollowerResultSegment,
};
pub use library_core_process_lease::{
    LibraryCoreProcessLease, LibraryCoreProcessLeaseError, ProcessLeaseClock, ProcessLeaseIdentity,
};
#[cfg(unix)]
pub use library_core_sidecar::{run_library_authority_sidecar, LibraryCoreSidecarAuthority};
pub use library_core_store::{
    BeginLibraryCoreImport, FinalizeLibraryCoreImportReceipt, LibraryCoreBackupChunk,
    LibraryCoreBackupOperationGuard, LibraryCoreBackupReceipt, LibraryCoreBackupRecord,
    LibraryCoreCheckpointReference, LibraryCoreImportItem, LibraryCoreStore, LibraryCoreStoreError,
    LibraryCoreStoreResult, LibraryCoreStoreStatus,
};
pub use normalized_checkpoint::{
    reassemble_content_records_v1, split_content_records_v1, ContentRecordError,
    NormalizedCheckpointRecordV2,
};
pub use normalized_import::{
    finalize_normalized_checkpoint_stage_v2, normalized_checkpoint_digest_v2,
    NormalizedCheckpointActivationReceiptV2,
};
pub use normalized_mutation::{
    accept_normalized_operation_transaction_v1, NormalizedMutationReceiptV1,
};
pub use normalized_query::{
    query_normalized_v1, NormalizedFacetSummaryRequestV1, NormalizedFacetSummaryResponseV1,
    NormalizedFacetSummaryV1, NormalizedFeedCardV1, NormalizedFeedPageRequestV1,
    NormalizedFeedPageResponseV1, NormalizedFeedPageSourceV1, NormalizedItemScanRequestV1,
    NormalizedItemScanResponseV1, NormalizedQueryRequestV1, NormalizedQueryResponseV1,
};
pub use normalized_sqlite::{
    append_normalized_checkpoint_stage_page_v2, begin_normalized_checkpoint_stage_v2,
    export_normalized_checkpoint_page_v2, install_normalized_schema_v1,
    BeginNormalizedCheckpointStageV2, NormalizedCheckpointCursorV2,
    NormalizedCheckpointExportPageV2, NormalizedCheckpointExportRequestV2,
    NormalizedCheckpointStageStatusV2, NormalizedSqliteError,
};
pub use product_projection::upsert_item;
