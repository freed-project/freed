//! Host-supplied authority key custody for normalized SQLite Libraries.

use crate::library_core_canonical::encode_operation_digest_input;
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use ring::rand::SystemRandom;
use ring::signature::Ed25519KeyPair;
use serde_json::json;
use sha2::{Digest, Sha256};

const MAX_IDENTITY_BYTES: usize = 64 * 1_024;

/// Host-supplied storage for the authority signing key. The reusable core has
/// no default credential backend, so a missing store remains an explicit error.
pub trait AuthorityKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String>;
}

pub(crate) fn normalized_native_library_id(
    source_digest: &str,
    installation_witness: &str,
) -> Result<String, String> {
    if !is_lower_sha256(source_digest) || !is_lower_sha256(installation_witness) {
        return Err("Library Core native Library identity input is invalid".to_string());
    }
    let input = encode_operation_digest_input(
        "native-sqlite-library-identity",
        &json!({
            "installation_witness": installation_witness,
            "source_digest": source_digest,
        }),
        MAX_IDENTITY_BYTES,
    )
    .map_err(|_| "Library Core native Library identity input is invalid".to_string())?;
    Ok(lower_hex(&Sha256::digest(input)))
}

pub(crate) fn load_or_create_authority_key_pair(
    store: &dyn AuthorityKeyStore,
    library_id: &str,
) -> Result<Ed25519KeyPair, String> {
    if let Some(bytes) = store.load(library_id)? {
        return Ed25519KeyPair::from_pkcs8(&bytes)
            .map_err(|_| "Library Core authority signing key is corrupt".to_string());
    }

    let generated = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
        .map_err(|_| "Library Core could not generate an authority signing key".to_string())?;
    store.store(library_id, generated.as_ref())?;
    let readback = store
        .load(library_id)?
        .ok_or_else(|| "Library Core authority signing key readback is missing".to_string())?;
    if readback.as_slice() != generated.as_ref() {
        return Err("Library Core authority signing key readback changed".to_string());
    }
    Ed25519KeyPair::from_pkcs8(&readback)
        .map_err(|_| "Library Core authority signing key readback is corrupt".to_string())
}

pub fn load_established_authority_key_pair(
    store: &dyn AuthorityKeyStore,
    library_id: &str,
) -> Result<Ed25519KeyPair, String> {
    let bytes = store
        .load(library_id)?
        .ok_or_else(|| "Library Core has no established authority signing key".to_string())?;
    Ed25519KeyPair::from_pkcs8(&bytes)
        .map_err(|_| "Library Core authority signing key is corrupt".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::KeyPair;
    use std::cell::RefCell;

    #[derive(Default)]
    struct MemoryKeyStore {
        stored: RefCell<Option<Vec<u8>>>,
        substitute_on_readback: Option<Vec<u8>>,
    }

    impl AuthorityKeyStore for MemoryKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            if let Some(substitute) = self.substitute_on_readback.as_ref() {
                if self.stored.borrow().is_some() {
                    return Ok(Some(substitute.clone()));
                }
            }
            Ok(self.stored.borrow().clone())
        }

        fn store(&self, _library_id: &str, bytes: &[u8]) -> Result<(), String> {
            self.stored.replace(Some(bytes.to_vec()));
            Ok(())
        }
    }

    #[test]
    fn authority_key_is_minted_once_and_reused() {
        let store = MemoryKeyStore::default();
        let first = load_or_create_authority_key_pair(&store, "library-a").unwrap();
        let minted = store.stored.borrow().clone();
        let second = load_or_create_authority_key_pair(&store, "library-a").unwrap();

        assert_eq!(first.public_key().as_ref(), second.public_key().as_ref());
        assert_eq!(*store.stored.borrow(), minted);
    }

    #[test]
    fn changed_key_readback_is_refused_before_signing() {
        let store = MemoryKeyStore {
            substitute_on_readback: Some(vec![9_u8; 32]),
            ..MemoryKeyStore::default()
        };
        let error = load_or_create_authority_key_pair(&store, "library-a").unwrap_err();
        assert!(error.contains("readback changed"), "{error}");
    }

    #[test]
    fn corrupt_stored_key_is_not_replaced() {
        let store = MemoryKeyStore::default();
        store.store("library-a", b"not a pkcs8 key").unwrap();
        let error = load_or_create_authority_key_pair(&store, "library-a").unwrap_err();

        assert!(error.contains("key is corrupt"), "{error}");
        assert_eq!(*store.stored.borrow(), Some(b"not a pkcs8 key".to_vec()));
    }
}
