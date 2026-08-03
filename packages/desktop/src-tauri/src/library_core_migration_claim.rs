//! Device-key-backed admission claim for one exact legacy Automerge source.
//!
//! The claim is local, immutable evidence. It does not activate Library Core,
//! grant cloud authority, retire Automerge, or synchronize private key bytes.

use crate::automerge_external_common::{is_lower_sha256, lower_hex};
use crate::automerge_external_spool::ExternalSnapshotSource;
use crate::library_core_canonical::{
    decode_canonical_value, encode_canonical_value, encode_operation_digest_input,
    encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_platform_key::{
    clear_platform_key, load_platform_key, store_platform_key, PlatformKeyVault,
};
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CLAIM_FORMAT: &str = "freed_local_automerge_migration_claim_v1";
const CLAIM_MODE: &str = "local";
const SOURCE_KIND: &str = "automerge_indexeddb_v3";
const SIGNATURE_ALGORITHM: &str = "ed25519";
const CLAIM_DIRECTORY: &str = "claims";
const MAXIMUM_CLAIM_BYTES: usize = 16 * 1_024;
const MAXIMUM_INSTALLATION_ID_BYTES: usize = 128;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LocalMigrationClaimBodyV1 {
    format: String,
    claim_mode: String,
    source_kind: String,
    source_installation_id: String,
    source_storage_generation: u64,
    source_save_revision: u64,
    source_byte_length: u64,
    source_sha256: String,
    source_public_key: String,
    source_key_id: String,
    signature_algorithm: String,
    claim_nonce: String,
    claimed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LocalMigrationClaimV1 {
    claim_body: LocalMigrationClaimBodyV1,
    claim_digest: String,
    source_key_signature: String,
}

pub(super) trait MigrationClaimKeyStore {
    fn load(&self, installation_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store(&self, installation_id: &str, bytes: &[u8]) -> Result<(), String>;
}

pub(super) struct PlatformMigrationClaimKeyStore;

/// The vault account holding this installation's migration signing key.
///
/// The account and envelope format are the same strings this module used
/// before the vault plumbing moved to `library_core_platform_key`, so an
/// already-stored key still reads back.
const MIGRATION_CLAIM_VAULT: PlatformKeyVault = PlatformKeyVault {
    account: "migration-source-current",
    envelope_format: "freed_library_core_migration_key_v1",
    description: "migration signing",
};

impl MigrationClaimKeyStore for PlatformMigrationClaimKeyStore {
    fn load(&self, installation_id: &str) -> Result<Option<Vec<u8>>, String> {
        validate_installation_id(installation_id)?;
        load_platform_key(&MIGRATION_CLAIM_VAULT, installation_id)
    }

    fn store(&self, installation_id: &str, bytes: &[u8]) -> Result<(), String> {
        validate_installation_id(installation_id)?;
        store_platform_key(&MIGRATION_CLAIM_VAULT, installation_id, bytes)
    }
}

#[cfg_attr(test, allow(dead_code))]
pub(super) fn clear_platform_migration_claim_key() -> Result<(), String> {
    clear_platform_key(&MIGRATION_CLAIM_VAULT)
}

fn validate_installation_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAXIMUM_INSTALLATION_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err("invalid Library Core source installation ID".to_string());
    }
    Ok(())
}

fn digest_value(domain: &str, value: &Value) -> Result<String, String> {
    let input = encode_operation_digest_input(domain, value, MAXIMUM_CLAIM_BYTES)
        .map_err(|_| "Library Core migration claim digest input is invalid".to_string())?;
    Ok(lower_hex(&Sha256::digest(input)))
}

fn load_or_create_key_pair(
    store: &dyn MigrationClaimKeyStore,
    installation_id: &str,
) -> Result<Ed25519KeyPair, String> {
    if let Some(bytes) = store.load(installation_id)? {
        return Ed25519KeyPair::from_pkcs8(&bytes)
            .map_err(|_| "Library Core migration signing key is corrupt".to_string());
    }

    let generated = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
        .map_err(|_| "Library Core could not generate a migration signing key".to_string())?;
    store.store(installation_id, generated.as_ref())?;
    let readback = store
        .load(installation_id)?
        .ok_or_else(|| "Library Core migration signing key readback is missing".to_string())?;
    if readback.as_slice() != generated.as_ref() {
        return Err("Library Core migration signing key readback changed".to_string());
    }
    Ed25519KeyPair::from_pkcs8(&readback)
        .map_err(|_| "Library Core migration signing key readback is corrupt".to_string())
}

fn current_time_ms() -> Result<u64, String> {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Library Core migration claim clock is invalid".to_string())?
        .as_millis();
    u64::try_from(milliseconds)
        .map_err(|_| "Library Core migration claim clock exceeds its range".to_string())
}

fn create_claim(
    source: &ExternalSnapshotSource,
    source_sha256: &str,
    key_pair: &Ed25519KeyPair,
) -> Result<LocalMigrationClaimV1, String> {
    validate_installation_id(&source.source_installation_id)?;
    if !is_lower_sha256(source_sha256) {
        return Err("Library Core migration source digest is invalid".to_string());
    }
    let source_public_key = lower_hex(key_pair.public_key().as_ref());
    let source_key_id = digest_value(
        "legacy-source-admission-key",
        &json!({
            "source_public_key": source_public_key,
            "signature_algorithm": SIGNATURE_ALGORITHM,
        }),
    )?;
    let mut nonce = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "Library Core could not generate a migration claim nonce".to_string())?;
    let claim_body = LocalMigrationClaimBodyV1 {
        format: CLAIM_FORMAT.to_string(),
        claim_mode: CLAIM_MODE.to_string(),
        source_kind: SOURCE_KIND.to_string(),
        source_installation_id: source.source_installation_id.clone(),
        source_storage_generation: source.storage_generation,
        source_save_revision: source.storage_save_revision,
        source_byte_length: source.byte_length,
        source_sha256: source_sha256.to_string(),
        source_public_key,
        source_key_id,
        signature_algorithm: SIGNATURE_ALGORITHM.to_string(),
        claim_nonce: lower_hex(&nonce),
        claimed_at_ms: current_time_ms()?,
    };
    let claim_body_value = serde_json::to_value(&claim_body)
        .map_err(|_| "Library Core migration claim body is invalid".to_string())?;
    let claim_digest = digest_value("legacy-source-admission-claim", &claim_body_value)?;
    let signature_input = encode_signature_input(
        "legacy-source-admission-claim-key",
        &json!({ "legacy_source_admission_claim_digest": claim_digest }),
        MAXIMUM_CLAIM_BYTES,
    )
    .map_err(|_| "Library Core migration claim signature input is invalid".to_string())?;
    let source_key_signature = lower_hex(key_pair.sign(&signature_input).as_ref());
    Ok(LocalMigrationClaimV1 {
        claim_body,
        claim_digest,
        source_key_signature,
    })
}

fn validate_claim(
    claim: &LocalMigrationClaimV1,
    source: &ExternalSnapshotSource,
    source_sha256: &str,
    expected_public_key: &str,
) -> Result<(), String> {
    let body = &claim.claim_body;
    validate_installation_id(&body.source_installation_id)?;
    if body.format != CLAIM_FORMAT
        || body.claim_mode != CLAIM_MODE
        || body.source_kind != SOURCE_KIND
        || body.source_installation_id != source.source_installation_id
        || body.source_storage_generation != source.storage_generation
        || body.source_save_revision != source.storage_save_revision
        || body.source_byte_length != source.byte_length
        || body.source_sha256 != source_sha256
        || body.source_public_key != expected_public_key
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || !is_lower_sha256(&body.source_public_key)
        || !is_lower_sha256(&body.source_key_id)
        || !is_lower_sha256(&body.claim_nonce)
        || !is_lower_sha256(&claim.claim_digest)
        || claim.source_key_signature.len() != 128
        || !claim
            .source_key_signature
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("Library Core migration claim is malformed or mismatched".to_string());
    }
    let expected_key_id = digest_value(
        "legacy-source-admission-key",
        &json!({
            "source_public_key": body.source_public_key,
            "signature_algorithm": SIGNATURE_ALGORITHM,
        }),
    )?;
    let body_value = serde_json::to_value(body)
        .map_err(|_| "Library Core migration claim body is invalid".to_string())?;
    let expected_claim_digest = digest_value("legacy-source-admission-claim", &body_value)?;
    if body.source_key_id != expected_key_id || claim.claim_digest != expected_claim_digest {
        return Err("Library Core migration claim digest does not match".to_string());
    }
    let signature_input = encode_signature_input(
        "legacy-source-admission-claim-key",
        &json!({ "legacy_source_admission_claim_digest": claim.claim_digest }),
        MAXIMUM_CLAIM_BYTES,
    )
    .map_err(|_| "Library Core migration claim signature input is invalid".to_string())?;
    if !verify_library_core_ed25519(
        &body.source_public_key,
        &claim.source_key_signature,
        &signature_input,
    )
    .map_err(|_| "Library Core migration claim signature encoding is invalid".to_string())?
    {
        return Err("Library Core migration claim signature is invalid".to_string());
    }
    Ok(())
}

fn prepare_private_claim_directory(root: &Path) -> Result<PathBuf, String> {
    let path = root.join(CLAIM_DIRECTORY);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("Library Core migration claim directory is invalid".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&path).map_err(|_| {
                "Library Core could not create its migration claim directory".to_string()
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).map_err(
                    |_| "Library Core could not protect its migration claim directory".to_string(),
                )?;
            }
        }
        Err(_) => {
            return Err("Library Core could not inspect its migration claim directory".to_string())
        }
    }
    let canonical = std::fs::canonicalize(&path)
        .map_err(|_| "Library Core could not resolve its migration claim directory".to_string())?;
    if canonical != path {
        return Err("Library Core migration claim directory escaped its root".to_string());
    }
    validate_private_claim_metadata(&canonical, true)?;
    Ok(canonical)
}

fn validate_private_claim_metadata(path: &Path, directory: bool) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "Library Core could not inspect its migration claim storage".to_string())?;
    validate_private_claim_metadata_value(&metadata, directory)
}

fn validate_private_claim_metadata_value(
    metadata: &std::fs::Metadata,
    directory: bool,
) -> Result<(), String> {
    let expected_type = if directory {
        metadata.file_type().is_dir()
    } else {
        metadata.file_type().is_file()
    };
    if !expected_type || metadata.file_type().is_symlink() {
        return Err("Library Core migration claim storage type is invalid".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || (!directory && metadata.nlink() != 1)
        {
            return Err("Library Core migration claim storage is not private".to_string());
        }
    }
    Ok(())
}

fn open_new_private_file(path: &Path) -> Result<File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn open_existing_private_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|_| "Library Core could not open its migration claim".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "Library Core could not inspect its migration claim".to_string())?;
    validate_private_claim_metadata_value(&metadata, false)?;
    Ok(file)
}

fn persist_and_verify_claim(
    root: &Path,
    claim: &LocalMigrationClaimV1,
    source: &ExternalSnapshotSource,
    source_sha256: &str,
    expected_public_key: &str,
) -> Result<LocalMigrationClaimV1, String> {
    let directory = prepare_private_claim_directory(root)?;
    let value = serde_json::to_value(claim)
        .map_err(|_| "Library Core migration claim is not serializable".to_string())?;
    let bytes = encode_canonical_value(&value, MAXIMUM_CLAIM_BYTES)
        .map_err(|_| "Library Core migration claim is not canonical".to_string())?;
    let path = directory.join(format!(
        "{}-{}.json",
        source_sha256, claim.claim_body.source_key_id
    ));
    match open_new_private_file(&path) {
        Ok(mut file) => {
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Library Core could not commit its migration claim".to_string())?;
            #[cfg(unix)]
            File::open(&directory)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| {
                    "Library Core could not commit its migration claim directory".to_string()
                })?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("Library Core could not create its migration claim".to_string()),
    }
    let mut readback = Vec::new();
    open_existing_private_file(&path)?
        .take((MAXIMUM_CLAIM_BYTES + 1) as u64)
        .read_to_end(&mut readback)
        .map_err(|_| "Library Core could not read back its migration claim".to_string())?;
    let decoded = decode_canonical_value(&readback, MAXIMUM_CLAIM_BYTES)
        .map_err(|_| "Library Core migration claim readback is not canonical".to_string())?;
    let persisted: LocalMigrationClaimV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "Library Core migration claim readback is malformed".to_string())?;
    validate_claim(&persisted, source, source_sha256, expected_public_key)?;
    Ok(persisted)
}

pub(super) fn authenticate_migration_source_with_store(
    root: &Path,
    source: &ExternalSnapshotSource,
    source_sha256: &str,
    store: &dyn MigrationClaimKeyStore,
) -> Result<LocalMigrationClaimV1, String> {
    let key_pair = load_or_create_key_pair(store, &source.source_installation_id)?;
    let source_public_key = lower_hex(key_pair.public_key().as_ref());
    let claim = create_claim(source, source_sha256, &key_pair)?;
    persist_and_verify_claim(root, &claim, source, source_sha256, &source_public_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use tempfile::tempdir;

    #[derive(Default)]
    struct MemoryKeyStore(RefCell<Option<Vec<u8>>>);

    impl MigrationClaimKeyStore for MemoryKeyStore {
        fn load(&self, _installation_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(self.0.borrow().clone())
        }

        fn store(&self, _installation_id: &str, bytes: &[u8]) -> Result<(), String> {
            *self.0.borrow_mut() = Some(bytes.to_vec());
            Ok(())
        }
    }

    fn source() -> ExternalSnapshotSource {
        ExternalSnapshotSource {
            schema_version: 1,
            storage_generation: 7,
            storage_save_revision: 11,
            byte_length: 1_024,
            source_installation_id: "desktop-installation-1".to_string(),
        }
    }

    #[test]
    fn signs_persists_and_reuses_one_exact_source_claim() {
        let directory = tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let store = MemoryKeyStore::default();
        let digest = "a".repeat(64);

        let first =
            authenticate_migration_source_with_store(&root, &source(), &digest, &store).unwrap();
        let second =
            authenticate_migration_source_with_store(&root, &source(), &digest, &store).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.claim_body.source_sha256, digest);
        assert_eq!(
            std::fs::read_dir(root.join(CLAIM_DIRECTORY))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn rejects_changed_source_identity_and_changed_claim_bytes() {
        let directory = tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let store = MemoryKeyStore::default();
        let digest = "b".repeat(64);
        let claim =
            authenticate_migration_source_with_store(&root, &source(), &digest, &store).unwrap();
        let path = root.join(CLAIM_DIRECTORY).join(format!(
            "{}-{}.json",
            digest, claim.claim_body.source_key_id
        ));
        let mut changed = std::fs::read(&path).unwrap();
        let last = changed.len() - 2;
        changed[last] = if changed[last] == b'0' { b'1' } else { b'0' };
        std::fs::write(&path, changed).unwrap();

        assert!(
            authenticate_migration_source_with_store(&root, &source(), &digest, &store,)
                .unwrap_err()
                .contains("canonical")
        );

        let mut other_source = source();
        other_source.storage_save_revision = 12;
        let key_pair =
            load_or_create_key_pair(&store, &other_source.source_installation_id).unwrap();
        let other_claim = create_claim(&other_source, &digest, &key_pair).unwrap();
        assert!(validate_claim(
            &other_claim,
            &source(),
            &digest,
            &lower_hex(key_pair.public_key().as_ref()),
        )
        .unwrap_err()
        .contains("mismatched"));
    }
}
