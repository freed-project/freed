//! A disposable local epoch so the shadow journal will accept shadow writes.
//!
//! NOT canonical authority, and it can never become canonical authority. The
//! contract is explicit: the legacy bootstrap record deliberately carries no
//! authority key, signature, or proof of owner consent, because a key created
//! and signed by the same app process proves only that the app possesses the
//! key it just created. It authenticates neither the owner nor another
//! installation. The real Library Core authority key stays unprovisioned until
//! a user-present or authenticated authority-holder protocol exists.
//!
//! What this is for: `library_core_authority_epochs` requires an epoch row
//! before the journal will accept an actor or an operation, and the shadow
//! slice needs to write shadow operations. This fills that slot with a local,
//! never-replicated value that is thrown away at the real bootstrap.
//!
//! Three rules follow, and each is load-bearing:
//!
//! 1. Nothing may call this from startup. Startup absence never chooses a
//!    creator. An earlier revision did exactly that and had to be reverted.
//! 2. Nothing may treat the key or the epoch id as cloud authority, as a
//!    writer epoch, or as input to a future authenticated transition.
//! 3. Installation identity never comes from this key. It comes from the
//!    Desktop installation witness, which is derived from the machine and the
//!    user rather than from something the app just minted.
//!
//! Automerge stays authoritative throughout.

use crate::automerge_external_common::{is_lower_sha256, lower_hex};
use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_journal::{
    AcceptedAuthorityState, LibraryCoreJournal, VerifiedAuthorityEpoch,
};
use crate::library_core_platform_key::{load_platform_key, store_platform_key, PlatformKeyVault};
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CERTIFICATE_FORMAT: &str = "freed_library_core_genesis_epoch_certificate_v1";
const SIGNATURE_ALGORITHM: &str = "ed25519";
const SOURCE_KIND: &str = "automerge_legacy";
const REPLICATION_PROTOCOL: &str = "automerge_blob_v1";
const TRUST_MODEL: &str = "tofu_read_only_until_authenticated_pairing";
const GENESIS_EPOCH: i64 = 1;
const MAX_CERTIFICATE_BYTES: usize = 16 * 1_024;
const MAX_DOCUMENT_ID_BYTES: usize = 4_096;

/// The authority signing key is a separate vault account from the migration
/// signing key. One compromised or cleared key must not stand in for the other.
const AUTHORITY_VAULT: PlatformKeyVault = PlatformKeyVault {
    account: "authority-current",
    envelope_format: "freed_library_core_authority_key_v1",
    description: "authority signing",
};

/// One exact durable Automerge revision, as the worker already reports it.
///
/// The worker refuses to produce this unless the in-memory document's heads
/// equal the durable snapshot's heads, so a revision that reaches here is one
/// the document was actually saved at, not one that only existed in memory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LegacySourceRevision {
    pub(crate) document_id: String,
    pub(crate) heads_digest: String,
    pub(crate) head_count: u64,
    pub(crate) storage_generation: u64,
    pub(crate) storage_save_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct GenesisEpochCertificateBodyV1 {
    format: String,
    library_id: String,
    epoch: i64,
    active_engine: String,
    replication_protocol: String,
    trust_model: String,
    signature_algorithm: String,
    authority_public_key: String,
    authority_key_id: String,
    source_document_id: String,
    source_heads_digest: String,
    source_head_count: u64,
    source_storage_generation: u64,
    source_save_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct GenesisEpochCertificateV1 {
    certificate_body: GenesisEpochCertificateBodyV1,
    /// The body digest. It names the epoch, so an epoch identifier and the
    /// content it was minted from cannot disagree.
    epoch_id: String,
    epoch_signature: String,
    authority_key_possession_signature: String,
}

fn digest_value(domain: &str, value: &Value) -> Result<String, String> {
    let input = encode_operation_digest_input(domain, value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| format!("Library Core {domain} digest input is invalid"))?;
    Ok(lower_hex(&Sha256::digest(input)))
}

/// The library identity for a legacy Automerge document.
///
/// Derived from the document identity rather than minted at random, so two
/// installations that adopt the same legacy document agree on which library
/// they are talking about, and re-deriving it after a crash gives the same
/// answer.
fn legacy_library_id(document_id: &str) -> Result<String, String> {
    if document_id.is_empty() || document_id.len() > MAX_DOCUMENT_ID_BYTES {
        return Err("Library Core legacy document ID is invalid".to_string());
    }
    digest_value(
        "legacy-library-identity",
        &json!({
            "source_document_id": document_id,
            "source_kind": SOURCE_KIND,
        }),
    )
}

fn authority_key_id(authority_public_key: &str) -> Result<String, String> {
    digest_value(
        "authority-key",
        &json!({
            "authority_public_key": authority_public_key,
            "signature_algorithm": SIGNATURE_ALGORITHM,
        }),
    )
}

fn epoch_signature_input(epoch_id: &str) -> Result<Vec<u8>, String> {
    encode_signature_input(
        "epoch-transition-certificate",
        &json!({ "certificate_digest": epoch_id }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core epoch signature input is invalid".to_string())
}

fn possession_signature_input(epoch_id: &str, key_id: &str) -> Result<Vec<u8>, String> {
    encode_signature_input(
        "authority-key-possession",
        &json!({
            "certificate_digest": epoch_id,
            "target_authority_key_id": key_id,
        }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core authority possession signature input is invalid".to_string())
}

fn validate_revision(revision: &LegacySourceRevision) -> Result<(), String> {
    if revision.document_id.is_empty() || revision.document_id.len() > MAX_DOCUMENT_ID_BYTES {
        return Err("Library Core legacy document ID is invalid".to_string());
    }
    if !is_lower_sha256(&revision.heads_digest) {
        return Err("Library Core legacy heads digest is invalid".to_string());
    }
    // A revision with no heads is an uninitialized document, not a library
    // this installation can claim to be the origin of.
    if revision.head_count == 0 {
        return Err("Library Core legacy revision has no heads".to_string());
    }
    Ok(())
}

fn build_certificate(
    library_id: &str,
    revision: &LegacySourceRevision,
    key_pair: &Ed25519KeyPair,
) -> Result<GenesisEpochCertificateV1, String> {
    validate_revision(revision)?;
    let authority_public_key = lower_hex(key_pair.public_key().as_ref());
    let key_id = authority_key_id(&authority_public_key)?;
    let certificate_body = GenesisEpochCertificateBodyV1 {
        format: CERTIFICATE_FORMAT.to_string(),
        library_id: library_id.to_string(),
        epoch: GENESIS_EPOCH,
        active_engine: SOURCE_KIND.to_string(),
        replication_protocol: REPLICATION_PROTOCOL.to_string(),
        trust_model: TRUST_MODEL.to_string(),
        signature_algorithm: SIGNATURE_ALGORITHM.to_string(),
        authority_public_key,
        authority_key_id: key_id.clone(),
        source_document_id: revision.document_id.clone(),
        source_heads_digest: revision.heads_digest.clone(),
        source_head_count: revision.head_count,
        source_storage_generation: revision.storage_generation,
        source_save_revision: revision.storage_save_revision,
    };
    let body_value = serde_json::to_value(&certificate_body)
        .map_err(|_| "Library Core genesis certificate body is invalid".to_string())?;
    let epoch_id = digest_value("epoch-transition-certificate", &body_value)?;
    Ok(GenesisEpochCertificateV1 {
        epoch_signature: lower_hex(key_pair.sign(&epoch_signature_input(&epoch_id)?).as_ref()),
        authority_key_possession_signature: lower_hex(
            key_pair
                .sign(&possession_signature_input(&epoch_id, &key_id)?)
                .as_ref(),
        ),
        certificate_body,
        epoch_id,
    })
}

/// Verify a genesis certificate against nothing but itself and the closed
/// constants above.
///
/// Called on this installation's own freshly minted certificate before it is
/// installed, so a mistake in minting fails closed instead of being written
/// into the authority chain, and so the verification path is exercised on
/// every establishment rather than only by tests.
fn verify_certificate(certificate: &GenesisEpochCertificateV1) -> Result<(), String> {
    let body = &certificate.certificate_body;
    if body.format != CERTIFICATE_FORMAT
        || body.epoch != GENESIS_EPOCH
        || body.active_engine != SOURCE_KIND
        || body.replication_protocol != REPLICATION_PROTOCOL
        || body.trust_model != TRUST_MODEL
        || body.signature_algorithm != SIGNATURE_ALGORITHM
    {
        return Err("Library Core genesis certificate is not a genesis certificate".to_string());
    }
    validate_revision(&LegacySourceRevision {
        document_id: body.source_document_id.clone(),
        heads_digest: body.source_heads_digest.clone(),
        head_count: body.source_head_count,
        storage_generation: body.source_storage_generation,
        storage_save_revision: body.source_save_revision,
    })?;
    if body.library_id != legacy_library_id(&body.source_document_id)? {
        return Err(
            "Library Core genesis certificate library does not match its source".to_string(),
        );
    }
    if !is_lower_sha256(&body.authority_public_key)
        || body.authority_key_id != authority_key_id(&body.authority_public_key)?
    {
        return Err("Library Core genesis certificate authority key is invalid".to_string());
    }
    let body_value = serde_json::to_value(body)
        .map_err(|_| "Library Core genesis certificate body is invalid".to_string())?;
    if certificate.epoch_id != digest_value("epoch-transition-certificate", &body_value)? {
        return Err("Library Core genesis certificate epoch does not match its body".to_string());
    }
    for (input, signature, what) in [
        (
            epoch_signature_input(&certificate.epoch_id)?,
            &certificate.epoch_signature,
            "epoch",
        ),
        (
            possession_signature_input(&certificate.epoch_id, &body.authority_key_id)?,
            &certificate.authority_key_possession_signature,
            "authority key possession",
        ),
    ] {
        let verified = verify_library_core_ed25519(&body.authority_public_key, signature, &input)
            .map_err(|_| {
            format!("Library Core genesis certificate {what} signature is malformed")
        })?;
        if !verified {
            return Err(format!(
                "Library Core genesis certificate {what} signature is invalid"
            ));
        }
    }
    Ok(())
}

/// Where the authority signing key is kept. Production is the platform vault;
/// tests substitute memory so they never touch the real credential store.
trait AuthorityKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String>;
}

struct PlatformAuthorityKeyStore;

impl AuthorityKeyStore for PlatformAuthorityKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String> {
        load_platform_key(&AUTHORITY_VAULT, library_id)
    }

    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String> {
        store_platform_key(&AUTHORITY_VAULT, library_id, bytes)
    }
}

fn load_or_create_authority_key_pair(
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
    // Read the key back through the store before signing anything with it. A
    // store that accepted the write but kept something else would otherwise
    // produce an authority chain nobody can continue after the next restart.
    let readback = store
        .load(library_id)?
        .ok_or_else(|| "Library Core authority signing key readback is missing".to_string())?;
    if readback.as_slice() != generated.as_ref() {
        return Err("Library Core authority signing key readback changed".to_string());
    }
    Ed25519KeyPair::from_pkcs8(&readback)
        .map_err(|_| "Library Core authority signing key readback is corrupt".to_string())
}

/// Establish a genesis epoch with a caller-supplied key.
///
/// Test-only entry point for sibling modules that need a real installed epoch
/// without touching the platform credential vault.
#[cfg(test)]
pub(crate) fn establish_with_key_pair_for_test(
    journal: &mut LibraryCoreJournal,
    revision: &LegacySourceRevision,
    key_pair: &Ed25519KeyPair,
    accepted_at_ms: i64,
) -> Result<AcceptedAuthorityState, String> {
    establish_with_key_pair(journal, revision, key_pair, accepted_at_ms)
}

/// Load the authority key this installation already minted.
///
/// Deliberately never mints one. An authority key that did not sign the active
/// epoch cannot countersign anything the journal will accept, so a caller that
/// needs the key for enrollment must fail rather than quietly create a second
/// identity.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn load_established_authority_key_pair(
    library_id: &str,
) -> Result<Ed25519KeyPair, String> {
    let bytes = load_platform_key(&AUTHORITY_VAULT, library_id)?
        .ok_or_else(|| "Library Core has no established authority signing key".to_string())?;
    Ed25519KeyPair::from_pkcs8(&bytes)
        .map_err(|_| "Library Core authority signing key is corrupt".to_string())
}

fn establish_with_key_pair(
    journal: &mut LibraryCoreJournal,
    revision: &LegacySourceRevision,
    key_pair: &Ed25519KeyPair,
    accepted_at_ms: i64,
) -> Result<AcceptedAuthorityState, String> {
    validate_revision(revision)?;
    if accepted_at_ms < 0 {
        return Err("Library Core genesis acceptance time is invalid".to_string());
    }
    let library_id = legacy_library_id(&revision.document_id)?;
    let certificate = build_certificate(&library_id, revision, key_pair)?;
    verify_certificate(&certificate)?;

    let certificate_value = serde_json::to_value(&certificate)
        .map_err(|_| "Library Core genesis certificate is invalid".to_string())?;
    let canonical = encode_canonical_value(&certificate_value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| "Library Core genesis certificate is not canonically encodable".to_string())?;
    let canonical_transition_certificate_json = String::from_utf8(canonical)
        .map_err(|_| "Library Core genesis certificate is not valid UTF-8".to_string())?;
    let transition_certificate_digest =
        digest_value("epoch-transition-certificate", &certificate_value)?;

    journal
        .install_authority_epoch(&VerifiedAuthorityEpoch {
            authority: AcceptedAuthorityState {
                library_id,
                epoch: GENESIS_EPOCH,
                epoch_id: certificate.epoch_id.clone(),
                authority_key_id: certificate.certificate_body.authority_key_id.clone(),
                authority_public_key: certificate.certificate_body.authority_public_key.clone(),
                observed_frontier: Vec::new(),
            },
            transition_certificate_digest,
            canonical_transition_certificate_json,
            accepted_at_ms,
        })
        .map_err(|error| format!("Library Core could not install the genesis epoch: {error}"))
}

/// Establish the disposable local epoch for one exact legacy Automerge
/// revision, minting and storing the local key if needed.
///
/// Has no production caller and must not acquire one from startup. The real
/// creator choice is an explicit owner action in the legacy epoch bootstrap.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn establish_genesis_epoch(
    journal: &mut LibraryCoreJournal,
    revision: &LegacySourceRevision,
    accepted_at_ms: i64,
) -> Result<AcceptedAuthorityState, String> {
    validate_revision(revision)?;
    let library_id = legacy_library_id(&revision.document_id)?;
    let key_pair = load_or_create_authority_key_pair(&PlatformAuthorityKeyStore, &library_id)?;
    establish_with_key_pair(journal, revision, &key_pair, accepted_at_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn revision() -> LegacySourceRevision {
        LegacySourceRevision {
            document_id: "freed-library-document-1".to_string(),
            heads_digest: "a".repeat(64),
            head_count: 2,
            storage_generation: 7,
            storage_save_revision: 11,
        }
    }

    fn key_pair() -> Ed25519KeyPair {
        // A fixed seed keeps the tests deterministic. Production mints its key
        // in the platform vault and never sees a seed.
        Ed25519KeyPair::from_seed_unchecked(&[7_u8; 32]).unwrap()
    }

    fn other_key_pair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[9_u8; 32]).unwrap()
    }

    fn open_journal() -> (tempfile::TempDir, LibraryCoreJournal) {
        let directory = tempdir().unwrap();
        let path = directory.path().join("library-core.sqlite");
        let journal = LibraryCoreJournal::open(&path).unwrap();
        (directory, journal)
    }

    #[test]
    fn establishes_a_genesis_epoch_bound_to_one_exact_revision() {
        let (_directory, mut journal) = open_journal();

        let authority =
            establish_with_key_pair(&mut journal, &revision(), &key_pair(), 1_700).unwrap();

        assert_eq!(authority.epoch, 1);
        assert_eq!(
            authority.library_id,
            legacy_library_id(&revision().document_id).unwrap()
        );
        assert!(authority.observed_frontier.is_empty());
        assert_eq!(
            authority.authority_key_id,
            authority_key_id(&authority.authority_public_key).unwrap()
        );
    }

    /// Minting is a pure function of the library, the key, and the revision,
    /// so a caller that crashes after committing and retries converges.
    #[test]
    fn replaying_the_same_revision_returns_the_same_epoch_without_forking() {
        let (_directory, mut journal) = open_journal();

        let first = establish_with_key_pair(&mut journal, &revision(), &key_pair(), 1_700).unwrap();
        // A later acceptance time must not produce a different epoch: the
        // clock is not part of what the epoch identifies.
        let second =
            establish_with_key_pair(&mut journal, &revision(), &key_pair(), 9_900).unwrap();

        assert_eq!(first, second);
        let stored: i64 = journal
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_authority_epochs;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, 1, "replay must not write a second epoch");
    }

    /// The point of binding the certificate to a revision: a second attempt
    /// against a different revision is a different epoch, and the journal
    /// refuses it rather than silently re-pointing the library.
    #[test]
    fn a_different_revision_is_refused_once_a_genesis_epoch_exists() {
        let (_directory, mut journal) = open_journal();
        establish_with_key_pair(&mut journal, &revision(), &key_pair(), 1_700).unwrap();

        let moved = LegacySourceRevision {
            heads_digest: "b".repeat(64),
            storage_save_revision: 12,
            ..revision()
        };
        let error = establish_with_key_pair(&mut journal, &moved, &key_pair(), 1_800).unwrap_err();

        assert!(
            error.contains("could not install the genesis epoch"),
            "{error}"
        );
    }

    /// Same library, different authority key, is also a different epoch. It
    /// must not quietly replace the authority the library already accepted.
    #[test]
    fn a_different_authority_key_is_refused_once_a_genesis_epoch_exists() {
        let (_directory, mut journal) = open_journal();
        establish_with_key_pair(&mut journal, &revision(), &key_pair(), 1_700).unwrap();

        let error = establish_with_key_pair(&mut journal, &revision(), &other_key_pair(), 1_800)
            .unwrap_err();

        assert!(
            error.contains("could not install the genesis epoch"),
            "{error}"
        );
    }

    #[test]
    fn a_different_document_is_a_different_library() {
        let (_directory, mut journal) = open_journal();
        let first = establish_with_key_pair(&mut journal, &revision(), &key_pair(), 1_700).unwrap();

        let other_document = LegacySourceRevision {
            document_id: "freed-library-document-2".to_string(),
            ..revision()
        };
        let second =
            establish_with_key_pair(&mut journal, &other_document, &key_pair(), 1_700).unwrap();

        assert_ne!(first.library_id, second.library_id);
        assert_eq!(second.epoch, 1);
    }

    #[test]
    fn a_tampered_certificate_fails_verification_on_every_signed_field() {
        let library_id = legacy_library_id(&revision().document_id).unwrap();
        let valid = build_certificate(&library_id, &revision(), &key_pair()).unwrap();
        verify_certificate(&valid).expect("the freshly minted certificate must verify");

        let mut swapped_heads = valid.clone();
        swapped_heads.certificate_body.source_heads_digest = "b".repeat(64);
        assert!(verify_certificate(&swapped_heads).is_err());

        let mut swapped_revision = valid.clone();
        swapped_revision.certificate_body.source_save_revision = 12;
        assert!(verify_certificate(&swapped_revision).is_err());

        let mut swapped_library = valid.clone();
        swapped_library.certificate_body.library_id = "c".repeat(64);
        assert!(verify_certificate(&swapped_library).is_err());

        let mut swapped_trust = valid.clone();
        swapped_trust.certificate_body.trust_model = "fully_authenticated".to_string();
        assert!(verify_certificate(&swapped_trust).is_err());

        let mut swapped_epoch = valid.clone();
        swapped_epoch.certificate_body.epoch = 2;
        assert!(verify_certificate(&swapped_epoch).is_err());

        // Recomputing the epoch id after tampering does not help: the
        // signatures are over that id.
        let mut resealed = valid.clone();
        resealed.certificate_body.source_head_count = 3;
        let body_value = serde_json::to_value(&resealed.certificate_body).unwrap();
        resealed.epoch_id = digest_value("epoch-transition-certificate", &body_value).unwrap();
        assert!(verify_certificate(&resealed).is_err());

        // A signature from a key that is not the one named in the body.
        let mut foreign = valid.clone();
        foreign.epoch_signature = lower_hex(
            other_key_pair()
                .sign(&epoch_signature_input(&valid.epoch_id).unwrap())
                .as_ref(),
        );
        assert!(verify_certificate(&foreign).is_err());

        let mut foreign_possession = valid.clone();
        foreign_possession.authority_key_possession_signature = lower_hex(
            other_key_pair()
                .sign(
                    &possession_signature_input(
                        &valid.epoch_id,
                        &valid.certificate_body.authority_key_id,
                    )
                    .unwrap(),
                )
                .as_ref(),
        );
        assert!(verify_certificate(&foreign_possession).is_err());

        // The valid certificate still verifies, so the assertions above are
        // rejecting the tampering rather than a broken fixture.
        verify_certificate(&valid).unwrap();
    }

    /// Two separate rules, easy to conflate.
    ///
    /// The body's key id must be derived from the body's public key, and the
    /// possession signature must be over that same key id. The first alone
    /// would let a certificate signed for one key id be replayed under
    /// another, so the second is tested with a body that already satisfies
    /// the first.
    #[test]
    fn the_possession_signature_binds_the_named_authority_key() {
        let library_id = legacy_library_id(&revision().document_id).unwrap();
        let valid = build_certificate(&library_id, &revision(), &key_pair()).unwrap();

        // Rule one: a key id that does not derive from the public key.
        let mut relabelled = valid.clone();
        relabelled.certificate_body.authority_key_id =
            authority_key_id(&lower_hex(other_key_pair().public_key().as_ref())).unwrap();
        let error = verify_certificate(&relabelled).unwrap_err();
        assert!(error.contains("authority key is invalid"), "{error}");

        // Rule two: the right key, the right key id in the body, but the
        // possession signature computed over a different key id. If the
        // possession input did not carry the key id, this signature would be
        // byte-identical to the correct one and would verify.
        let mut mis_signed = valid.clone();
        mis_signed.authority_key_possession_signature = lower_hex(
            key_pair()
                .sign(&possession_signature_input(&valid.epoch_id, &"0".repeat(64)).unwrap())
                .as_ref(),
        );
        let error = verify_certificate(&mis_signed).unwrap_err();
        assert!(
            error.contains("authority key possession signature is invalid"),
            "{error}"
        );

        verify_certificate(&valid).unwrap();
    }

    #[test]
    fn a_revision_that_was_never_saved_is_refused() {
        let (_directory, mut journal) = open_journal();

        for broken in [
            LegacySourceRevision {
                head_count: 0,
                ..revision()
            },
            LegacySourceRevision {
                heads_digest: "not a digest".to_string(),
                ..revision()
            },
            LegacySourceRevision {
                document_id: String::new(),
                ..revision()
            },
        ] {
            assert!(
                establish_with_key_pair(&mut journal, &broken, &key_pair(), 1_700).is_err(),
                "{broken:?} must be refused"
            );
        }

        let stored: i64 = journal
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_authority_epochs;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, 0, "a refused revision must write nothing");
    }

    #[derive(Default)]
    struct MemoryKeyStore {
        stored: std::cell::RefCell<Option<Vec<u8>>>,
        /// Returns this instead of what was written, standing in for a store
        /// that accepts a write and keeps something else.
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
            *self.stored.borrow_mut() = Some(bytes.to_vec());
            Ok(())
        }
    }

    #[test]
    fn an_authority_key_is_minted_once_and_reused_afterwards() {
        let store = MemoryKeyStore::default();

        let first = load_or_create_authority_key_pair(&store, "library-a").unwrap();
        let minted = store.stored.borrow().clone();
        let second = load_or_create_authority_key_pair(&store, "library-a").unwrap();

        assert_eq!(
            lower_hex(first.public_key().as_ref()),
            lower_hex(second.public_key().as_ref()),
            "a second call must reuse the stored key, not mint a new one"
        );
        assert_eq!(
            *store.stored.borrow(),
            minted,
            "a second call must not overwrite the stored key"
        );
    }

    /// A store that keeps something other than what was written would produce
    /// an authority chain that no later restart could continue.
    #[test]
    fn a_key_that_does_not_read_back_is_refused_before_it_signs_anything() {
        let store = MemoryKeyStore {
            substitute_on_readback: Some(vec![9_u8; 32]),
            ..MemoryKeyStore::default()
        };

        let error = load_or_create_authority_key_pair(&store, "library-a").unwrap_err();

        assert!(error.contains("readback changed"), "{error}");
    }

    #[test]
    fn a_corrupt_stored_key_is_refused_rather_than_replaced() {
        let store = MemoryKeyStore::default();
        store.store("library-a", b"not a pkcs8 key").unwrap();

        let error = load_or_create_authority_key_pair(&store, "library-a").unwrap_err();

        assert!(error.contains("key is corrupt"), "{error}");
        // Refusing must not silently mint a replacement over the top of a key
        // that some other epoch may already have been signed with.
        assert_eq!(*store.stored.borrow(), Some(b"not a pkcs8 key".to_vec()));
    }

    #[test]
    fn the_stored_certificate_is_the_canonical_encoding_of_what_was_verified() {
        let (_directory, mut journal) = open_journal();
        establish_with_key_pair(&mut journal, &revision(), &key_pair(), 1_700).unwrap();

        let stored: String = journal
            .connection_for_test()
            .query_row(
                "SELECT canonicalTransitionCertificateJson
                 FROM library_core_authority_epochs;",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let parsed: GenesisEpochCertificateV1 = serde_json::from_str(&stored).unwrap();
        verify_certificate(&parsed).expect("the stored certificate must still verify");
        let library_id = legacy_library_id(&revision().document_id).unwrap();
        assert_eq!(
            parsed,
            build_certificate(&library_id, &revision(), &key_pair()).unwrap()
        );
    }
}
