//! Freed Desktop key-store adapter for native Library Core authority epochs.

use crate::library_core_platform_key::{load_platform_key, store_platform_key, PlatformKeyVault};
use freed_library_core::AuthorityKeyStore;

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
