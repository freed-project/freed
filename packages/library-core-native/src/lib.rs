//! Runtime-neutral native authority for Freed Library Core.
//!
//! This crate owns the signed SQLite journal, its verifiers, authority epochs,
//! actor enrollment, and deterministic product projection. Hosts supply an
//! explicit database path, key stores, and signed timestamps. It has no Tauri,
//! Google Drive, provider, or Automerge dependency.

mod library_core_actor_enrollment;
mod library_core_authority_genesis;
#[cfg_attr(not(test), allow(dead_code))]
mod library_core_canonical;
#[cfg_attr(not(test), allow(dead_code))]
mod library_core_ed25519;
mod library_core_hash;
#[cfg_attr(not(test), allow(dead_code))]
mod library_core_journal;
mod library_core_process_lease;
mod library_core_store;
mod product_projection;

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
pub use library_core_store::{
    BeginLibraryCoreImport, FinalizeLibraryCoreImportReceipt, LibraryCoreBackupOperationGuard,
    LibraryCoreBackupReceipt, LibraryCoreCheckpointReference, LibraryCoreImportItem,
    LibraryCoreStore, LibraryCoreStoreError, LibraryCoreStoreResult, LibraryCoreStoreStatus,
};
pub use product_projection::upsert_item;
