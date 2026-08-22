//! Freed Desktop import surface for the runtime-neutral native journal.

pub(super) use freed_library_core::{
    FollowerIntentEnqueueReceipt, FollowerIntentOutboxCandidate,
    FollowerIntentPublicationReceipt, FollowerOverlayReplayReceipt, FollowerResultImportCursor,
    FollowerResultImportReceipt, FollowerRuntimeStatus, IntentResultOutboxEntry,
    LibraryCoreJournal, StoredFollowerActorEnrollment, StoredFollowerActorRequest,
    VerifiedFollowerIntentPublication, VerifiedFollowerIntentResult, VerifiedFollowerResultSegment,
};
