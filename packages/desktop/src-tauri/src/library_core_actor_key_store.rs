//! Freed Desktop operating-system key-store adapter for Library Core actors.

use crate::library_core_platform_key::{load_platform_key, store_platform_key, PlatformKeyVault};
use freed_library_core::ActorKeyStore;

pub(super) use freed_library_core::sign_library_core_operation_digest;

const ACTOR_VAULT: PlatformKeyVault = PlatformKeyVault {
    account: "actor-current",
    envelope_format: "freed_library_core_actor_key_v1",
    description: "actor signing",
};

pub(super) struct PlatformActorKeyStore;

impl ActorKeyStore for PlatformActorKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String> {
        load_platform_key(&ACTOR_VAULT, library_id)
    }

    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String> {
        store_platform_key(&ACTOR_VAULT, library_id, bytes)
    }
}
