//! This desktop installation's own actor, enrolled under its own authority.
//!
//! With a genesis epoch installed, the journal will accept an actor, but only
//! against a canonical enrollment certificate that binds an actor key to that
//! exact authority state. Nothing produced one, so `verify_and_enroll_actor`
//! had no caller and no operation could be signed or committed.
//!
//! This mints the certificate. The actor key signs a proof of possession over
//! the enrollment body; the authority key countersigns the certificate. Both
//! live in the platform credential vault under separate accounts, because the
//! authority admits actors and the actor writes operations, and one key doing
//! both would make an actor able to admit itself.
//!
//! Automerge stays authoritative. Enrolling an actor writes no operation,
//! changes no active engine, and emits no provider traffic.
//!
//! Like the genesis epoch, the certificate is a pure function of the library,
//! the two keys, and the authority state, apart from `created_at_ms`. That one
//! wall-clock field is inside the signed body, so a rebuilt certificate would
//! not match a stored one and would be refused as a conflict rather than
//! recognized as a replay. An already-enrolled actor is therefore returned
//! from storage without rebuilding anything.

use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::library_core_authority_genesis::load_established_authority_key_pair;
use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_journal::{ActorState, LibraryCoreJournal};
use crate::library_core_platform_key::{load_platform_key, store_platform_key, PlatformKeyVault};
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const SIGNATURE_ALGORITHM: &str = "ed25519";
const OPERATION_TYPE: &str = "actor_enrolled";
const SCHEMA_VERSION: i64 = 1;
const MAX_CERTIFICATE_BYTES: usize = 64 * 1_024;

/// The actor signing key is its own vault account. The authority key admits
/// actors; this key writes operations. One key doing both would let an actor
/// admit itself.
const ACTOR_VAULT: PlatformKeyVault = PlatformKeyVault {
    account: "actor-current",
    envelope_format: "freed_library_core_actor_key_v1",
    description: "actor signing",
};

/// The authority state an enrollment must bind to, exactly as the journal
/// holds it. The verifier compares every field, including the frontier.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct EnrollmentAuthority {
    pub(crate) library_id: String,
    pub(crate) epoch: i64,
    pub(crate) epoch_id: String,
    pub(crate) authority_key_id: String,
    /// The Desktop installation witness: a digest of the machine identifier
    /// and the user, produced by `get_desktop_installation_witness`.
    ///
    /// Installation identity is bound to this rather than to the local epoch
    /// key. Two Desktops holding the same Automerge Library mint different
    /// local keys, so deriving identity from the key would make one machine
    /// look like several installations and would survive nothing, while the
    /// witness is stable for the machine and does not depend on anything the
    /// app minted for itself.
    pub(crate) installation_witness: String,
}

fn digest_value(domain: &str, value: &Value) -> Result<String, String> {
    let input = encode_operation_digest_input(domain, value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| format!("Library Core {domain} digest input is invalid"))?;
    Ok(lower_hex(&Sha256::digest(input)))
}

/// Which installation of this library the actor belongs to.
///
/// Bound to the Desktop installation witness, not to any key this process
/// minted. A witness is derived from the machine and the user, so it survives
/// a discarded local epoch and it distinguishes two real Desktops holding the
/// same Library, which is what installation identity has to mean.
fn installation_incarnation(authority: &EnrollmentAuthority) -> Result<String, String> {
    if !is_lower_sha256(&authority.installation_witness) {
        return Err("Library Core installation witness is invalid".to_string());
    }
    digest_value(
        "installation-incarnation",
        &json!({
            "library_id": authority.library_id,
            "installation_witness": authority.installation_witness,
            "signature_algorithm": SIGNATURE_ALGORITHM,
        }),
    )
}

/// Which incarnation of the actor this is.
///
/// Derived rather than random on purpose. One installation holds one actor key
/// at a time, so a random value would add no distinguishing power, and
/// deriving keeps the enrollment body a pure function of the stored keys. A
/// future rotation that needs two incarnations under one key would store an
/// explicit nonce instead.
fn actor_incarnation_nonce(
    installation_incarnation: &str,
    actor_public_key: &str,
) -> Result<String, String> {
    digest_value(
        "actor-incarnation-nonce",
        &json!({
            "installation_incarnation": installation_incarnation,
            "actor_public_key": actor_public_key,
            "signature_algorithm": SIGNATURE_ALGORITHM,
        }),
    )
}

fn actor_public_key_fingerprint(actor_public_key: &str) -> Result<String, String> {
    digest_value(
        "actor-public-key",
        &json!({
            "signature_algorithm": SIGNATURE_ALGORITHM,
            "actor_public_key": actor_public_key,
        }),
    )
}

fn actor_id(
    library_id: &str,
    installation_incarnation: &str,
    actor_public_key: &str,
    actor_incarnation_nonce: &str,
) -> Result<String, String> {
    digest_value(
        "actor-id",
        &json!({
            "library_id": library_id,
            "installation_incarnation": installation_incarnation,
            "signature_algorithm": SIGNATURE_ALGORITHM,
            "actor_public_key": actor_public_key,
            "actor_incarnation_nonce": actor_incarnation_nonce,
        }),
    )
}

/// Everything about the actor that does not depend on the clock.
///
/// Computed before deciding whether to enroll, because the actor id is what
/// tells us whether this actor already exists.
#[derive(Clone, Debug, Eq, PartialEq)]
struct ActorIdentity {
    actor_id: String,
    actor_public_key: String,
    actor_public_key_fingerprint: String,
    installation_incarnation: String,
    actor_incarnation_nonce: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedActorEnrollmentRequest {
    pub(crate) actor_id: String,
    pub(crate) actor_public_key: String,
    pub(crate) enrollment_request_digest: String,
    pub(crate) canonical_enrollment_request_json: String,
}

fn actor_identity(
    authority: &EnrollmentAuthority,
    key_pair: &Ed25519KeyPair,
) -> Result<ActorIdentity, String> {
    let actor_public_key = lower_hex(key_pair.public_key().as_ref());
    let installation_incarnation = installation_incarnation(authority)?;
    let actor_incarnation_nonce =
        actor_incarnation_nonce(&installation_incarnation, &actor_public_key)?;
    Ok(ActorIdentity {
        actor_id: actor_id(
            &authority.library_id,
            &installation_incarnation,
            &actor_public_key,
            &actor_incarnation_nonce,
        )?,
        actor_public_key_fingerprint: actor_public_key_fingerprint(&actor_public_key)?,
        actor_public_key,
        installation_incarnation,
        actor_incarnation_nonce,
    })
}

/// Build the canonical certificate the journal's verifier expects.
///
/// The shape is fixed by `library_core_journal_enrollment_verifier`, which
/// rejects any object with an unexpected or missing key, so this is written to
/// match it exactly rather than to be convenient.
fn build_certificate_body(
    authority: &EnrollmentAuthority,
    identity: &ActorIdentity,
    actor_key_pair: &Ed25519KeyPair,
    created_at_ms: i64,
) -> Result<(Value, String), String> {
    if created_at_ms < 0 {
        return Err("Library Core enrollment time is invalid".to_string());
    }
    let enrollment_body = json!({
        "operation_id": format!("actor-enrolled:{}", identity.actor_id),
        "operation_type": OPERATION_TYPE,
        "library_id": authority.library_id,
        "epoch": authority.epoch,
        "epoch_id": authority.epoch_id,
        "schema_version": SCHEMA_VERSION,
        "authority_key_id": authority.authority_key_id,
        "installation_incarnation": identity.installation_incarnation,
        "actor_incarnation_nonce": identity.actor_incarnation_nonce,
        "actor_id": identity.actor_id,
        "actor_public_key": identity.actor_public_key,
        "actor_public_key_fingerprint": identity.actor_public_key_fingerprint,
        // The genesis epoch observes nothing, and the verifier requires this
        // to equal the authority's frontier exactly.
        "observed_frontier": [],
        "created_at_ms": created_at_ms,
        "signature_algorithm": SIGNATURE_ALGORITHM,
    });

    let enrollment_body_digest = digest_value("actor-enrollment-body", &enrollment_body)?;
    let actor_proof_input = encode_signature_input(
        "actor-enrollment-proof",
        &json!({ "enrollment_body_digest": enrollment_body_digest }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core actor proof input is invalid".to_string())?;

    let certificate_body = json!({
        "actor_enrollment_body": enrollment_body,
        "enrollment_body_digest": enrollment_body_digest,
        "actor_proof": lower_hex(actor_key_pair.sign(&actor_proof_input).as_ref()),
    });

    let certificate_digest = digest_value("actor-enrollment-certificate", &certificate_body)?;
    Ok((certificate_body, certificate_digest))
}

fn build_certificate(
    authority: &EnrollmentAuthority,
    identity: &ActorIdentity,
    actor_key_pair: &Ed25519KeyPair,
    authority_key_pair: &Ed25519KeyPair,
    created_at_ms: i64,
) -> Result<Vec<u8>, String> {
    let (certificate_body, certificate_digest) =
        build_certificate_body(authority, identity, actor_key_pair, created_at_ms)?;
    let authority_signature_input = encode_signature_input(
        "actor-enrollment-authority",
        &json!({ "certificate_digest": certificate_digest }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core enrollment authority signature input is invalid".to_string())?;

    let certificate = json!({
        "certificate_body": certificate_body,
        "certificate_digest": certificate_digest,
        "authority_signature": lower_hex(
            authority_key_pair.sign(&authority_signature_input).as_ref(),
        ),
    });

    encode_canonical_value(&certificate, MAX_CERTIFICATE_BYTES)
        .map_err(|_| "Library Core enrollment certificate is not canonically encodable".to_string())
}

/// Mint or replay the proof-only request for a non-authoritative follower.
///
/// The actor key never leaves the platform vault. This request proves key
/// possession only. It cannot enroll itself, grant writer admission, or make a
/// canonical change until the remote authority countersigns it.
pub(crate) fn prepare_follower_actor_enrollment_request(
    authority: &EnrollmentAuthority,
    actor_store: &dyn ActorKeyStore,
    created_at_ms: i64,
) -> Result<PreparedActorEnrollmentRequest, String> {
    let actor_key_pair = load_or_create_actor_key_pair(actor_store, &authority.library_id)?;
    let identity = actor_identity(authority, &actor_key_pair)?;
    let (certificate_body, certificate_digest) =
        build_certificate_body(authority, &identity, &actor_key_pair, created_at_ms)?;
    let request = json!({
        "certificate_body": certificate_body,
        "certificate_digest": certificate_digest,
    });
    let canonical = encode_canonical_value(&request, MAX_CERTIFICATE_BYTES)
        .map_err(|_| "Library Core actor enrollment request is not canonical".to_string())?;
    let canonical_enrollment_request_json = String::from_utf8(canonical)
        .map_err(|_| "Library Core actor enrollment request is not UTF-8".to_string())?;
    Ok(PreparedActorEnrollmentRequest {
        actor_id: identity.actor_id,
        actor_public_key: identity.actor_public_key,
        enrollment_request_digest: certificate_digest,
        canonical_enrollment_request_json,
    })
}

/// Where the actor signing key is kept. Production is the platform vault;
/// tests substitute memory so they never touch the real credential store.
pub(crate) trait ActorKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String>;
}

pub(crate) struct PlatformActorKeyStore;

impl ActorKeyStore for PlatformActorKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String> {
        load_platform_key(&ACTOR_VAULT, library_id)
    }

    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String> {
        store_platform_key(&ACTOR_VAULT, library_id, bytes)
    }
}

fn load_or_create_actor_key_pair(
    store: &dyn ActorKeyStore,
    library_id: &str,
) -> Result<Ed25519KeyPair, String> {
    if let Some(bytes) = store.load(library_id)? {
        return Ed25519KeyPair::from_pkcs8(&bytes)
            .map_err(|_| "Library Core actor signing key is corrupt".to_string());
    }

    let generated = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
        .map_err(|_| "Library Core could not generate an actor signing key".to_string())?;
    store.store(library_id, generated.as_ref())?;
    // Read back before signing. A store that accepted the write but kept
    // something else would enroll an actor whose key nobody can reproduce
    // after the next restart, stranding its whole operation chain.
    let readback = store
        .load(library_id)?
        .ok_or_else(|| "Library Core actor signing key readback is missing".to_string())?;
    if readback.as_slice() != generated.as_ref() {
        return Err("Library Core actor signing key readback changed".to_string());
    }
    Ed25519KeyPair::from_pkcs8(&readback)
        .map_err(|_| "Library Core actor signing key readback is corrupt".to_string())
}

fn enroll_with_key_pairs(
    journal: &mut LibraryCoreJournal,
    authority: &EnrollmentAuthority,
    actor_key_pair: &Ed25519KeyPair,
    authority_key_pair: &Ed25519KeyPair,
    created_at_ms: i64,
) -> Result<ActorState, String> {
    let identity = actor_identity(authority, actor_key_pair)?;

    // Check before minting. `created_at_ms` is inside the signed body, so a
    // rebuilt certificate for an already-enrolled actor would carry a
    // different digest and be refused as a conflict.
    if let Some(existing) = journal
        .actor_state(
            &authority.library_id,
            &authority.epoch_id,
            &identity.actor_id,
        )
        .map_err(|error| format!("Library Core could not read actor state: {error}"))?
    {
        return Ok(existing);
    }

    let certificate = build_certificate(
        authority,
        &identity,
        actor_key_pair,
        authority_key_pair,
        created_at_ms,
    )?;
    journal
        .verify_and_enroll_actor(&certificate, &authority.library_id)
        .map_err(|error| format!("Library Core could not enroll its actor: {error}"))
}

/// Enroll this installation's actor under its active authority epoch.
pub(crate) fn enroll_desktop_actor(
    journal: &mut LibraryCoreJournal,
    authority: &EnrollmentAuthority,
    actor_store: &dyn ActorKeyStore,
    authority_key_pair: &Ed25519KeyPair,
    created_at_ms: i64,
) -> Result<ActorState, String> {
    let actor_key_pair = load_or_create_actor_key_pair(actor_store, &authority.library_id)?;
    enroll_with_key_pairs(
        journal,
        authority,
        &actor_key_pair,
        authority_key_pair,
        created_at_ms,
    )
}

/// Verify and countersign one canonical proof-only PWA enrollment request.
///
/// The request supplies only the PWA actor proof. The designated Desktop loads
/// its platform authority key, adds the authority signature, and asks the
/// journal to reverify the complete certificate against the current epoch in
/// the same transaction that enrolls the actor.
pub(crate) fn countersign_pwa_actor_enrollment_request(
    journal: &mut LibraryCoreJournal,
    canonical_request: &[u8],
) -> Result<ActorState, String> {
    if canonical_request.is_empty() || canonical_request.len() > MAX_CERTIFICATE_BYTES {
        return Err("Library Core actor enrollment request size is invalid".to_string());
    }
    let request: Value = serde_json::from_slice(canonical_request)
        .map_err(|_| "Library Core actor enrollment request is invalid JSON".to_string())?;
    let request_object = request
        .as_object()
        .ok_or_else(|| "Library Core actor enrollment request must be an object".to_string())?;
    if request_object.len() != 2
        || !request_object.contains_key("certificate_body")
        || !request_object.contains_key("certificate_digest")
    {
        return Err("Library Core actor enrollment request has an invalid field set".to_string());
    }
    let canonical = encode_canonical_value(&request, MAX_CERTIFICATE_BYTES).map_err(|_| {
        "Library Core actor enrollment request is not canonically encodable".to_string()
    })?;
    if canonical != canonical_request {
        return Err("Library Core actor enrollment request is not canonical".to_string());
    }
    let library_id = request
        .get("certificate_body")
        .and_then(Value::as_object)
        .and_then(|body| body.get("actor_enrollment_body"))
        .and_then(Value::as_object)
        .and_then(|body| body.get("library_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "Library Core actor enrollment request has no Library identity".to_string()
        })?;
    let certificate_digest = request
        .get("certificate_digest")
        .and_then(Value::as_str)
        .filter(|digest| is_lower_sha256(digest))
        .ok_or_else(|| "Library Core actor enrollment request digest is invalid".to_string())?;
    let authority_key_pair = load_established_authority_key_pair(library_id)?;
    let authority_signature_input = encode_signature_input(
        "actor-enrollment-authority",
        &json!({ "certificate_digest": certificate_digest }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core enrollment authority signature input is invalid".to_string())?;
    let certificate = json!({
        "certificate_body": request
            .get("certificate_body")
            .ok_or_else(|| "Library Core actor enrollment request body is missing".to_string())?,
        "certificate_digest": certificate_digest,
        "authority_signature": lower_hex(
            authority_key_pair.sign(&authority_signature_input).as_ref(),
        ),
    });
    let canonical_certificate = encode_canonical_value(&certificate, MAX_CERTIFICATE_BYTES)
        .map_err(|_| {
            "Library Core actor enrollment certificate is not canonically encodable".to_string()
        })?;
    journal
        .verify_and_enroll_actor(&canonical_certificate, library_id)
        .map_err(|error| format!("Library Core could not enroll PWA actor: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_authority_genesis::{
        establish_with_key_pair_for_test, LegacySourceRevision,
    };
    use tempfile::tempdir;

    #[derive(Default)]
    struct MemoryActorKeyStore {
        stored: std::cell::RefCell<Option<Vec<u8>>>,
        substitute_on_readback: Option<Vec<u8>>,
    }

    impl ActorKeyStore for MemoryActorKeyStore {
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

    fn authority_key_pair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[7_u8; 32]).unwrap()
    }

    fn actor_key_pair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).unwrap()
    }

    fn other_actor_key_pair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[13_u8; 32]).unwrap()
    }

    fn revision() -> LegacySourceRevision {
        LegacySourceRevision {
            document_id: "freed-library-document-1".to_string(),
            heads_digest: "a".repeat(64),
            head_count: 2,
            storage_generation: 7,
            storage_save_revision: 11,
        }
    }

    /// A journal with a real genesis epoch installed, and the authority state
    /// as the enrollment verifier will see it.
    fn journal_with_authority() -> (tempfile::TempDir, LibraryCoreJournal, EnrollmentAuthority) {
        let directory = tempdir().unwrap();
        let mut journal =
            LibraryCoreJournal::open(&directory.path().join("library-core.sqlite")).unwrap();
        let accepted = establish_with_key_pair_for_test(
            &mut journal,
            &revision(),
            &authority_key_pair(),
            1_700,
        )
        .unwrap();
        let authority = EnrollmentAuthority {
            library_id: accepted.library_id,
            epoch: accepted.epoch,
            epoch_id: accepted.epoch_id,
            authority_key_id: accepted.authority_key_id,
            installation_witness: "c".repeat(64),
        };
        (directory, journal, authority)
    }

    #[test]
    fn enrolls_one_actor_under_the_installed_genesis_epoch() {
        let (_directory, mut journal, authority) = journal_with_authority();

        let actor = enroll_with_key_pairs(
            &mut journal,
            &authority,
            &actor_key_pair(),
            &authority_key_pair(),
            2_000,
        )
        .unwrap();

        assert_eq!(actor.library_id, authority.library_id);
        assert_eq!(actor.epoch, 1);
        assert_eq!(actor.epoch_id, authority.epoch_id);
        assert_eq!(actor.next_sequence, 1, "a fresh actor has written nothing");
        assert_eq!(actor.previous_operation_id, None);
        assert_eq!(
            actor.actor_public_key,
            lower_hex(actor_key_pair().public_key().as_ref())
        );
    }

    /// The wall clock moves between runs. Enrollment must still converge, or
    /// every restart would collide with its own previous certificate.
    #[test]
    fn re_enrolling_at_a_later_time_returns_the_stored_actor() {
        let (_directory, mut journal, authority) = journal_with_authority();

        let first = enroll_with_key_pairs(
            &mut journal,
            &authority,
            &actor_key_pair(),
            &authority_key_pair(),
            2_000,
        )
        .unwrap();
        let second = enroll_with_key_pairs(
            &mut journal,
            &authority,
            &actor_key_pair(),
            &authority_key_pair(),
            9_999,
        )
        .unwrap();

        assert_eq!(first, second);
        let actors: i64 = journal
            .connection_for_test()
            .query_row("SELECT COUNT(*) FROM library_core_actors;", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(actors, 1, "replay must not enroll a second actor");
    }

    #[test]
    fn a_different_actor_key_is_a_different_actor() {
        let (_directory, mut journal, authority) = journal_with_authority();

        let first = enroll_with_key_pairs(
            &mut journal,
            &authority,
            &actor_key_pair(),
            &authority_key_pair(),
            2_000,
        )
        .unwrap();
        let second = enroll_with_key_pairs(
            &mut journal,
            &authority,
            &other_actor_key_pair(),
            &authority_key_pair(),
            2_000,
        )
        .unwrap();

        assert_ne!(first.actor_id, second.actor_id);
    }

    /// The authority admits actors. An actor that countersigned its own
    /// enrollment would be admitting itself.
    #[test]
    fn an_enrollment_the_authority_did_not_countersign_is_refused() {
        let (_directory, mut journal, authority) = journal_with_authority();

        let error = enroll_with_key_pairs(
            &mut journal,
            &authority,
            &actor_key_pair(),
            // The actor key standing in for the authority key.
            &actor_key_pair(),
            2_000,
        )
        .unwrap_err();

        assert!(error.contains("could not enroll its actor"), "{error}");
        let actors: i64 = journal
            .connection_for_test()
            .query_row("SELECT COUNT(*) FROM library_core_actors;", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(actors, 0, "a refused enrollment must write nothing");
    }

    #[test]
    fn an_enrollment_bound_to_the_wrong_authority_state_is_refused() {
        let (_directory, mut journal, authority) = journal_with_authority();

        for wrong in [
            EnrollmentAuthority {
                epoch: 2,
                ..authority.clone()
            },
            EnrollmentAuthority {
                epoch_id: "f".repeat(64),
                ..authority.clone()
            },
            EnrollmentAuthority {
                authority_key_id: "e".repeat(64),
                ..authority.clone()
            },
        ] {
            let error = enroll_with_key_pairs(
                &mut journal,
                &wrong,
                &actor_key_pair(),
                &authority_key_pair(),
                2_000,
            )
            .unwrap_err();
            assert!(error.contains("could not enroll its actor"), "{error}");
        }
    }

    #[test]
    fn an_actor_key_is_minted_once_and_reused_afterwards() {
        let store = MemoryActorKeyStore::default();

        let first = load_or_create_actor_key_pair(&store, "library-a").unwrap();
        let minted = store.stored.borrow().clone();
        let second = load_or_create_actor_key_pair(&store, "library-a").unwrap();

        assert_eq!(
            lower_hex(first.public_key().as_ref()),
            lower_hex(second.public_key().as_ref())
        );
        assert_eq!(*store.stored.borrow(), minted);
    }

    #[test]
    fn follower_request_proves_actor_possession_without_granting_authority() {
        let (_directory, _journal, authority) = journal_with_authority();
        let store = MemoryActorKeyStore::default();

        let prepared =
            prepare_follower_actor_enrollment_request(&authority, &store, 2_000).unwrap();
        let value: Value =
            serde_json::from_str(&prepared.canonical_enrollment_request_json).unwrap();

        assert_eq!(
            value.get("certificate_digest").and_then(Value::as_str),
            Some(prepared.enrollment_request_digest.as_str())
        );
        assert!(value.get("certificate_body").is_some());
        assert!(value.get("authority_signature").is_none());
        assert!(is_lower_sha256(&prepared.actor_public_key));
        assert!(is_lower_sha256(&prepared.actor_id));
    }

    #[test]
    fn an_actor_key_that_does_not_read_back_is_refused_before_it_signs_anything() {
        let store = MemoryActorKeyStore {
            substitute_on_readback: Some(vec![3_u8; 32]),
            ..MemoryActorKeyStore::default()
        };

        let error = load_or_create_actor_key_pair(&store, "library-a").unwrap_err();

        assert!(error.contains("readback changed"), "{error}");
    }

    #[test]
    fn the_whole_path_enrolls_through_the_key_store() {
        let (_directory, mut journal, authority) = journal_with_authority();
        let store = MemoryActorKeyStore::default();

        let actor = enroll_desktop_actor(
            &mut journal,
            &authority,
            &store,
            &authority_key_pair(),
            2_000,
        )
        .unwrap();

        assert!(store.stored.borrow().is_some(), "the key must be persisted");
        // A second call reloads the same key, so it lands on the same actor.
        let again = enroll_desktop_actor(
            &mut journal,
            &authority,
            &store,
            &authority_key_pair(),
            5_000,
        )
        .unwrap();
        assert_eq!(actor, again);
    }

    #[test]
    fn the_derived_identity_is_stable_and_separates_installations() {
        let (_directory, _journal, authority) = journal_with_authority();
        let identity = actor_identity(&authority, &actor_key_pair()).unwrap();

        assert_eq!(
            identity,
            actor_identity(&authority, &actor_key_pair()).unwrap()
        );
        assert_eq!(
            identity.actor_public_key_fingerprint,
            actor_public_key_fingerprint(&identity.actor_public_key).unwrap()
        );

        // A different machine means a different installation, so the same
        // actor key must not resolve to the same actor.
        let other_installation = EnrollmentAuthority {
            installation_witness: "d".repeat(64),
            ..authority.clone()
        };

        // A different local epoch key on the SAME machine must NOT change
        // installation identity. That was the defect: the local key is
        // disposable, so identity derived from it could not survive one.
        let same_machine_new_key = EnrollmentAuthority {
            authority_key_id: "e".repeat(64),
            ..authority.clone()
        };
        assert_eq!(
            identity.installation_incarnation,
            actor_identity(&same_machine_new_key, &actor_key_pair())
                .unwrap()
                .installation_incarnation
        );
        let other = actor_identity(&other_installation, &actor_key_pair()).unwrap();
        assert_ne!(
            identity.installation_incarnation,
            other.installation_incarnation
        );
        assert_ne!(
            identity.actor_incarnation_nonce,
            other.actor_incarnation_nonce
        );
        assert_ne!(identity.actor_id, other.actor_id);
    }
}
