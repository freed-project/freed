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
pub use product_projection::upsert_item;
