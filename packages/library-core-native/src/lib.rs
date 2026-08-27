//! Runtime-neutral native authority for Freed Library Core.
//!
//! This crate owns the signed SQLite journal, its verifiers, authority epochs,
//! actor enrollment, and deterministic product projection. Hosts supply an
//! explicit database path, key stores, and signed timestamps. It has no Tauri,
//! Google Drive, provider, or Automerge dependency.

mod device_graph_layout;
mod library_core_actor_enrollment;
mod library_core_authority_genesis;
#[cfg(unix)]
mod library_core_bound_root;
#[cfg(unix)]
mod library_core_bound_sqlite_vfs;
#[cfg_attr(not(test), allow(dead_code))]
mod library_core_canonical;
#[cfg(unix)]
mod library_core_content_vault;
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
mod normalized_follower;
mod normalized_import;
#[cfg_attr(not(test), allow(dead_code))]
mod normalized_migration;
#[cfg_attr(not(test), allow(dead_code))]
mod normalized_mutation;
mod normalized_query;
mod normalized_sqlite;
mod normalized_writer_reassignment;
mod product_projection;
mod selective_content;
pub mod sqlite_contract_generated;

pub use device_graph_layout::{
    mutate_device_graph_layout_v1, DeviceGraphLayoutError, DeviceGraphLayoutMutationResultV1,
    DeviceGraphLayoutMutationV1,
};
pub use library_core_actor_enrollment::{
    countersign_actor_enrollment_request, countersign_actor_enrollment_request_bytes,
    enroll_desktop_actor, load_or_create_normalized_actor_id_v2,
    prepare_follower_actor_enrollment_request,
    prepare_normalized_follower_actor_enrollment_request_v2, sign_library_core_operation_digest,
    ActorKeyStore, EnrollmentAuthority, PreparedActorEnrollmentRequest,
};
pub use library_core_authority_genesis::{
    establish_or_transition_sqlite_authority, load_established_authority_key_pair,
    prepare_writer_epoch_reassignment, AuthorityKeyStore, EstablishedSqliteAuthority,
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
pub use library_core_sidecar::run_library_authority_sidecar;
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
pub use normalized_follower::{
    countersign_normalized_follower_actor_request_v2, enqueue_normalized_follower_intent_v1,
    export_normalized_follower_intent_page_v1, import_normalized_follower_result_page_v1,
    import_normalized_follower_result_transport_segment_v2,
    install_normalized_follower_actor_enrollment_v2, normalized_follower_mutation_context_v1,
    normalized_follower_runtime_status_v2, prepare_normalized_follower_actor_request_v2,
    record_normalized_follower_intent_publication_v1,
    record_normalized_follower_intent_transport_publication_v2,
    NormalizedFollowerActorEnrollmentV2, NormalizedFollowerActorRequestV2,
    NormalizedFollowerIntentCommitReceiptV1, NormalizedFollowerIntentCursorV1,
    NormalizedFollowerIntentPageRecordV1, NormalizedFollowerIntentPageRequestV1,
    NormalizedFollowerIntentPageV1, NormalizedFollowerIntentPublicationReceiptV1,
    NormalizedFollowerIntentTransportPublicationReceiptV2,
    NormalizedFollowerIntentTransportPublicationV2, NormalizedFollowerResultImportReceiptV1,
    NormalizedFollowerResultTransportImportReceiptV2, NormalizedFollowerResultTransportImportV2,
    NormalizedFollowerRuntimeStatusV2,
};
pub use normalized_import::{
    finalize_normalized_checkpoint_stage_v2, normalized_checkpoint_digest_v2,
    replace_with_normalized_checkpoint_stage_v2,
    replace_with_normalized_follower_checkpoint_stage_v2, NormalizedCheckpointActivationReceiptV2,
    NormalizedFollowerCheckpointReceiptV2,
};
pub use normalized_migration::{
    prepare_fresh_normalized_desktop_library_v1, prepare_normalized_desktop_cutover_v1,
    NormalizedDesktopAuthorityPreparedV1,
};
pub use normalized_mutation::{
    accept_normalized_operation_transaction_v1, export_normalized_follower_result_page_v1,
    ingest_normalized_follower_intent_page_v1, normalized_primary_mutation_context_v1,
    NormalizedFollowerIntentStagePageV1, NormalizedFollowerIntentStageReceiptV1,
    NormalizedFollowerIntentStageRecordV1, NormalizedFollowerResultCursorV1,
    NormalizedFollowerResultPageRequestV1, NormalizedFollowerResultPageV1,
    NormalizedFollowerResultRecordV1, NormalizedMutationCausalTipV1, NormalizedMutationContextV1,
    NormalizedMutationInvalidationV1, NormalizedMutationReceiptV1,
};
pub use normalized_query::{
    query_normalized_json_v1, query_normalized_v1, NormalizedAccountDetailRequestV1,
    NormalizedAccountDetailResponseV1, NormalizedAccountDetailV1,
    NormalizedAccountGraphPageRequestV1, NormalizedAccountGraphPageResponseV1,
    NormalizedAccountGraphRowV1, NormalizedChangeFeedRequestV1, NormalizedChangeFeedResponseV1,
    NormalizedChangeFeedRowV1, NormalizedFacetSummaryRequestV1, NormalizedFacetSummaryResponseV1,
    NormalizedFacetSummaryV1, NormalizedFeedBrowseEdgeOrderV3, NormalizedFeedBrowseFilterV1,
    NormalizedFeedBrowsePageRequestV3, NormalizedFeedBrowsePageResponseV3, NormalizedFeedCardV1,
    NormalizedFeedPageRequestV1, NormalizedFeedPageResponseV1, NormalizedFeedPageSourceV1,
    NormalizedItemScanRequestV1, NormalizedItemScanResponseV1, NormalizedMapMarkerV1,
    NormalizedMapMarkersRequestV1, NormalizedMapMarkersResponseV1, NormalizedPersonDetailRequestV1,
    NormalizedPersonDetailResponseV1, NormalizedPersonDetailV1, NormalizedPersonGraphPageRequestV1,
    NormalizedPersonGraphPageResponseV1, NormalizedPersonGraphRowV1, NormalizedPersonReachOutV1,
    NormalizedPersonTimelineRequestV1, NormalizedPersonTimelineResponseV1,
    NormalizedQueryRequestV1, NormalizedQueryResponseV1, NormalizedRssFeedPageRequestV1,
    NormalizedRssFeedPageResponseV1, NormalizedRssFeedPageRowV1, NormalizedSavedAnalyticsCountV2,
    NormalizedSavedAnalyticsRequestV2, NormalizedSavedAnalyticsResponseV2,
    NormalizedSavedAnalyticsWindowV2, NormalizedSavedFeedCardV2, NormalizedSavedFeedEdgeOrderV2,
    NormalizedSavedFeedPageRequestV2, NormalizedSavedFeedPageResponseV2,
    NormalizedStoryWallCandidateV1, NormalizedStoryWallCandidatesRequestV1,
    NormalizedStoryWallCandidatesResponseV1,
};
pub use normalized_sqlite::{
    append_normalized_checkpoint_stage_page_v2, begin_normalized_checkpoint_stage_v2,
    describe_normalized_checkpoint_export_v2, export_normalized_checkpoint_page_v2,
    export_pinned_normalized_checkpoint_page_v2, install_normalized_schema_v1,
    BeginNormalizedCheckpointStageV2, NormalizedCheckpointCursorV2,
    NormalizedCheckpointExportDescriptorV2, NormalizedCheckpointExportPageV2,
    NormalizedCheckpointExportRequestV2, NormalizedCheckpointStageStatusV2, NormalizedSqliteError,
    PinnedNormalizedCheckpointExportRequestV2,
};
pub use normalized_writer_reassignment::reassign_normalized_writer_epoch_v2;
pub use product_projection::upsert_item;
pub use selective_content::{
    get_content_state_v1, page_eviction_candidates_v1, page_hydration_candidates_v1,
    publish_content_range_from_reader_v1, register_verified_content_range_v1,
    set_content_policy_v1, ContentAvailabilityV1, ContentCompletionReceiptV1,
    ContentCompletionRequestV1, ContentEvictionReceiptV1, ContentEvictionRequestV1,
    ContentHydrationPolicyV1, ContentHydrationStateV1, ContentPolicyMutationReceiptV1,
    ContentPolicyMutationV1, ContentRangePublicationRequestV1, ContentRangeReadRequestV1,
    ContentRangeReadResponseV1, ContentStateRequestV1, ContentStateV1, ContentWorkSourceV1,
    DurableContentRangeObjectV1, EvictionCandidateCursorV1, EvictionCandidatePageRequestV1,
    EvictionCandidatePageV1, EvictionCandidateV1, HydrationCandidateCursorV1,
    HydrationCandidatePageRequestV1, HydrationCandidatePageV1, HydrationCandidateV1,
    SelectiveContentError, VerifiedContentRangePublicationV1, VerifiedContentRangeReceiptV1,
};
