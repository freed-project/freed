//! Freed Desktop key-store adapter for native Library Core authority epochs.

use crate::library_core_platform_key::{load_platform_key, store_platform_key, PlatformKeyVault};
use freed_library_core::{AuthorityKeyStore, LibraryCoreJournal};

pub(super) use freed_library_core::{NativeSqliteSourceSnapshot, PersistedCloudAuthorityHint};

const AUTHORITY_VAULT: PlatformKeyVault = PlatformKeyVault {
    account: "authority-current",
    envelope_format: "freed_library_core_authority_key_v1",
    description: "authority signing",
};

pub(crate) struct PlatformAuthorityKeyStore;

impl AuthorityKeyStore for PlatformAuthorityKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String> {
        load_platform_key(&AUTHORITY_VAULT, library_id)
    }

    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String> {
        store_platform_key(&AUTHORITY_VAULT, library_id, bytes)
    }
}

pub(super) fn load_established_authority_key_pair(
    library_id: &str,
) -> Result<ring::signature::Ed25519KeyPair, String> {
    freed_library_core::load_established_authority_key_pair(&PlatformAuthorityKeyStore, library_id)
}

pub(super) fn establish_or_transition_sqlite_authority(
    journal: &mut LibraryCoreJournal,
    snapshot: &NativeSqliteSourceSnapshot,
    installation_witness: &str,
    persisted_hint: Option<&PersistedCloudAuthorityHint>,
    accepted_at_ms: i64,
) -> Result<freed_library_core::EstablishedSqliteAuthority, String> {
    freed_library_core::establish_or_transition_sqlite_authority(
        journal,
        snapshot,
        installation_witness,
        persisted_hint,
        accepted_at_ms,
        &PlatformAuthorityKeyStore,
    )
}

pub(super) fn reassign_writer_epoch(
    journal: &mut LibraryCoreJournal,
    library_id: &str,
    canonical_source_control_json: &str,
    target_writer_id: &str,
    accepted_at_ms: i64,
) -> Result<freed_library_core::WriterEpochReassignment, String> {
    freed_library_core::reassign_writer_epoch(
        journal,
        library_id,
        canonical_source_control_json,
        target_writer_id,
        accepted_at_ms,
        &PlatformAuthorityKeyStore,
    )
}
