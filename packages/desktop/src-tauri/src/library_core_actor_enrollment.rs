//! Freed Desktop key-store adapter for native Library Core actor enrollment.

use crate::library_core_authority_genesis::PlatformAuthorityKeyStore;
use crate::library_core_platform_key::{load_platform_key, store_platform_key, PlatformKeyVault};
use freed_library_core::{ActorKeyStore, LibraryCoreJournal};

pub(super) use freed_library_core::{
    enroll_desktop_actor, prepare_follower_actor_enrollment_request,
    sign_library_core_operation_digest, EnrollmentAuthority,
};

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

pub(super) fn countersign_pwa_actor_enrollment_request(
    journal: &mut LibraryCoreJournal,
    canonical_request: &[u8],
) -> Result<freed_library_core::ActorState, String> {
    freed_library_core::countersign_actor_enrollment_request(
        journal,
        canonical_request,
        &PlatformAuthorityKeyStore,
    )
}
