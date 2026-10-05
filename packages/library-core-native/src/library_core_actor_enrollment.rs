//! Actor enrollment under one exact Library Core authority epoch.
//!
//! With a genesis epoch installed, the journal will accept an actor, but only
//! against a canonical enrollment certificate that binds an actor key to that
//! exact authority state. Nothing produced one, so `verify_and_enroll_actor`
//! had no caller and no operation could be signed or committed.
//!
//! This mints the certificate. The actor key signs a proof of possession over
//! the enrollment body; the authority key countersigns the certificate. Both
//! live in separate host-supplied credential stores, because the authority
//! admits actors and the actor writes operations, and one key doing both would
//! make an actor able to admit itself.
//!
//! Enrolling an actor changes neither cloud writer admission nor the active
//! Library authority epoch. It writes no content operation and emits no
//! provider traffic.
//!
//! Like the genesis epoch, the certificate is a pure function of the library,
//! the two keys, and the authority state, apart from `created_at_ms`. That one
//! wall-clock field is inside the signed body, so a rebuilt certificate would
//! not match a stored one and would be refused as a conflict rather than
//! recognized as a replay. An already-enrolled actor is therefore returned
//! from storage without rebuilding anything.

use crate::library_core_actor_capability::primary_writer_operation_types;
use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_operation_signature_input,
    encode_signature_input,
};
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::normalized_authority::NormalizedAuthorityStateV2;
use crate::normalized_authority_credentials::{
    load_established_authority_key_pair, AuthorityKeyStore,
};
use crate::normalized_enrollment_verifier::verify_actor_enrollment as verify_actor_enrollment_certificate;
use crate::normalized_operation::VerifiedActorEnrollment;
use crate::sqlite_contract_generated::OPERATION_TRANSACTION_MAXIMUM_MEMBERS;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const SIGNATURE_ALGORITHM: &str = "ed25519";
const OPERATION_TYPE: &str = "actor_enrolled";
const SCHEMA_VERSION: i64 = 1;
const MAX_CERTIFICATE_BYTES: usize = 64 * 1_024;

/// The authority state an enrollment must bind to, exactly as the journal
/// holds it. The verifier compares every field, including the frontier.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnrollmentAuthority {
    pub library_id: String,
    pub epoch: i64,
    pub epoch_id: String,
    pub authority_key_id: String,
    /// The host installation witness. The Freed Desktop adapter supplies the
    /// existing digest of its machine identifier and user.
    ///
    /// Installation identity is bound to this rather than to the local epoch
    /// key. Two hosts holding the same Library mint different local keys, so
    /// deriving identity from the key would make one machine
    /// look like several installations and would survive nothing, while the
    /// witness is stable for the machine and does not depend on anything the
    /// app minted for itself.
    pub installation_witness: String,
}

fn digest_value(domain: &str, value: &Value) -> Result<String, String> {
    let input = encode_operation_digest_input(domain, value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| format!("Library Core {domain} digest input is invalid"))?;
    Ok(lower_hex(&Sha256::digest(input)))
}

/// Which installation of this library the actor belongs to.
///
/// Bound to the host installation witness, not to any key this process
/// minted. A witness is derived from the machine and the user, so it survives
/// a discarded local epoch and it distinguishes two real hosts holding the
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
/// recovery that needs another incarnation under the same key uses its durable
/// archive identity as an explicit nonce and persists the signed request.
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
pub struct PreparedActorEnrollmentRequest {
    pub actor_id: String,
    pub actor_public_key: String,
    pub enrollment_request_digest: String,
    pub canonical_enrollment_request_json: String,
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

pub fn prepare_normalized_follower_actor_enrollment_request_v2(
    authority: &NormalizedAuthorityStateV2,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    created_at_ms: i64,
) -> Result<PreparedActorEnrollmentRequest, String> {
    prepare_follower_request(
        authority,
        installation_witness,
        actor_store,
        created_at_ms,
        None,
    )
}

/// A recovery incarnation retains the existing key and binds a new actor ID to
/// the durable archive identity. It never creates or replaces a signing key.
pub(crate) fn prepare_recovery_actor_request(
    authority: &NormalizedAuthorityStateV2,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    created_at_ms: i64,
    recovery_id: &str,
) -> Result<PreparedActorEnrollmentRequest, String> {
    if !is_lower_sha256(recovery_id) {
        return Err("consumer recovery identity is invalid".into());
    }
    prepare_follower_request(
        authority,
        installation_witness,
        actor_store,
        created_at_ms,
        Some(recovery_id),
    )
}

pub(crate) fn recovery_actor_id(
    library_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    recovery_id: &str,
) -> Result<String, String> {
    if !is_lower_sha256(library_id) || !is_lower_sha256(recovery_id) {
        return Err("consumer recovery identity is invalid".into());
    }
    let key = load_actor_key_pair(actor_store, library_id)?;
    let installation = installation_incarnation(&EnrollmentAuthority {
        library_id: library_id.into(),
        epoch: 0,
        epoch_id: String::new(),
        authority_key_id: String::new(),
        installation_witness: installation_witness.into(),
    })?;
    actor_id(
        library_id,
        &installation,
        &lower_hex(key.public_key().as_ref()),
        recovery_id,
    )
}

fn prepare_follower_request(
    authority: &NormalizedAuthorityStateV2,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    created_at_ms: i64,
    recovery_id: Option<&str>,
) -> Result<PreparedActorEnrollmentRequest, String> {
    let enrollment_authority = EnrollmentAuthority {
        library_id: authority.library_id.clone(),
        epoch: authority.epoch,
        epoch_id: authority.epoch_id.clone(),
        authority_key_id: authority.authority_key_id.clone(),
        installation_witness: installation_witness.to_owned(),
    };
    let actor_key_pair = if recovery_id.is_some() {
        load_actor_key_pair(actor_store, &enrollment_authority.library_id)?
    } else {
        load_or_create_actor_key_pair(actor_store, &enrollment_authority.library_id)?
    };
    let mut identity = actor_identity(&enrollment_authority, &actor_key_pair)?;
    if let Some(nonce) = recovery_id {
        identity.actor_incarnation_nonce = nonce.to_owned();
        identity.actor_id = actor_id(
            &enrollment_authority.library_id,
            &identity.installation_incarnation,
            &identity.actor_public_key,
            nonce,
        )?;
    }
    if created_at_ms < 0 {
        return Err("Library Core enrollment time is invalid".to_owned());
    }
    let observed_frontier = authority
        .observed_frontier
        .iter()
        .map(|tip| {
            json!({
                "actor_id": tip.actor_id,
                "sequence": tip.sequence,
                "operation_id": tip.operation_id,
                "chain_digest": tip.chain_digest,
            })
        })
        .collect::<Vec<_>>();
    let actor_enrollment_body = json!({
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
        "observed_frontier": observed_frontier,
        "created_at_ms": created_at_ms,
        "signature_algorithm": SIGNATURE_ALGORITHM,
    });
    let enrollment_body_digest = digest_value("actor-enrollment-body", &actor_enrollment_body)?;
    let actor_proof_input = encode_signature_input(
        "actor-enrollment-proof",
        &json!({ "enrollment_body_digest": enrollment_body_digest }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core normalized actor proof input is invalid".to_owned())?;
    let actor_proof = lower_hex(actor_key_pair.sign(&actor_proof_input).as_ref());
    let issuance_identity = digest_value(
        "actor-capability-issuance",
        &json!({
            "library_id": authority.library_id,
            "epoch_id": authority.epoch_id,
            "authority_key_id": authority.authority_key_id,
            "actor_id": identity.actor_id,
            "enrollment_body_digest": enrollment_body_digest,
        }),
    )?;
    let retirement_identity = digest_value(
        "actor-capability-retirement",
        &json!({
            "library_id": authority.library_id,
            "epoch_id": authority.epoch_id,
            "actor_id": identity.actor_id,
            "issuance_identity": issuance_identity,
        }),
    )?;
    let allowed_operation_types = primary_writer_operation_types();
    let capability_body = json!({
        "format": "freed_library_core_actor_capability_v2",
        "library_id": authority.library_id,
        "epoch": authority.epoch,
        "epoch_id": authority.epoch_id,
        "authority_key_id": authority.authority_key_id,
        "actor_id": identity.actor_id,
        "actor_public_key": identity.actor_public_key,
        "actor_class": "editor",
        "allowed_operation_types": allowed_operation_types,
        "allowed_query_ids": [],
        "scope": { "mode": "library_wide" },
        "issuance_identity": issuance_identity,
        "retirement_identity": retirement_identity,
        "issued_at_ms": created_at_ms,
        "signature_algorithm": SIGNATURE_ALGORITHM,
    });
    let capability_body_digest = digest_value("actor-capability-body", &capability_body)?;
    let certificate_body = json!({
        "actor_enrollment_body": actor_enrollment_body,
        "enrollment_body_digest": enrollment_body_digest,
        "actor_proof": actor_proof,
        "actor_capability_body": capability_body,
        "actor_capability_body_digest": capability_body_digest,
    });
    let certificate_digest = digest_value("actor-capability-certificate", &certificate_body)?;
    let canonical = encode_canonical_value(
        &json!({
            "certificate_body": certificate_body,
            "certificate_digest": certificate_digest,
        }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core normalized actor request is invalid".to_owned())?;
    Ok(PreparedActorEnrollmentRequest {
        actor_id: identity.actor_id,
        actor_public_key: identity.actor_public_key,
        enrollment_request_digest: certificate_digest,
        canonical_enrollment_request_json: String::from_utf8(canonical)
            .map_err(|_| "Library Core normalized actor request is not UTF-8".to_owned())?,
    })
}

pub(crate) fn prepare_normalized_primary_actor_enrollment_v2(
    authority: &NormalizedAuthorityStateV2,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    created_at_ms: i64,
) -> Result<VerifiedActorEnrollment, String> {
    let request = prepare_normalized_follower_actor_enrollment_request_v2(
        authority,
        installation_witness,
        actor_store,
        created_at_ms,
    )?;
    let canonical = countersign_actor_enrollment_request_bytes(
        request.canonical_enrollment_request_json.as_bytes(),
        authority_store,
    )?;
    verify_actor_enrollment_certificate(&canonical, authority)
        .map_err(|error| format!("Library Core normalized actor certificate failed: {error}"))
}

/// Preserve an enrolled incarnation during cooperative promotion. The supplied
/// certificate only contributes its nonce; the native installation witness and
/// locally held key must independently derive the actor selected by consent.
pub(crate) fn prepare_selected_primary_actor_enrollment_v2(
    authority: &NormalizedAuthorityStateV2,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    created_at_ms: i64,
    selected_actor: &str,
    selected_certificate: &[u8],
) -> Result<VerifiedActorEnrollment, String> {
    let key = load_actor_key_pair(actor_store, &authority.library_id)?;
    let identity = actor_identity(
        &EnrollmentAuthority {
            library_id: authority.library_id.clone(),
            epoch: authority.epoch,
            epoch_id: authority.epoch_id.clone(),
            authority_key_id: authority.authority_key_id.clone(),
            installation_witness: installation_witness.into(),
        },
        &key,
    )?;
    let nonce = selected_actor_nonce(
        &identity,
        &authority.library_id,
        selected_actor,
        selected_certificate,
    )?;
    let request = prepare_follower_request(
        authority,
        installation_witness,
        actor_store,
        created_at_ms,
        nonce.as_deref(),
    )?;
    if request.actor_id != selected_actor || request.actor_public_key != identity.actor_public_key {
        return Err("selected actor signing identity changed".into());
    }
    let canonical = countersign_actor_enrollment_request_bytes(
        request.canonical_enrollment_request_json.as_bytes(),
        authority_store,
    )?;
    verify_actor_enrollment_certificate(&canonical, authority)
        .map_err(|error| format!("Library Core selected actor certificate failed: {error}"))
}

fn selected_actor_nonce(
    identity: &ActorIdentity,
    library_id: &str,
    selected_actor: &str,
    selected_certificate: &[u8],
) -> Result<Option<String>, String> {
    if identity.actor_id == selected_actor {
        Ok(None)
    } else {
        let value = crate::library_core_canonical::decode_canonical_value(
            selected_certificate,
            MAX_CERTIFICATE_BYTES,
        )
        .map_err(|_| "selected actor certificate is not canonical")?
        .into_value();
        let nonce = value
            .pointer("/certificate_body/actor_enrollment_body/actor_incarnation_nonce")
            .and_then(Value::as_str)
            .filter(|nonce| is_lower_sha256(nonce))
            .ok_or("selected actor incarnation is missing")?
            .to_owned();
        if actor_id(
            library_id,
            &identity.installation_incarnation,
            &identity.actor_public_key,
            &nonce,
        )? != selected_actor
        {
            return Err("selected actor does not belong to this installation and key".into());
        }
        Ok(Some(nonce))
    }
}

/// Resolve the locally enrolled incarnation, including an explicit recovery.
/// A replicated actor row alone cannot select a consumer's local identity.
/// This function supplies identity only and never grants writer admission.
pub fn load_normalized_local_actor_id_v2(
    connection: &rusqlite::Connection,
    library_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
) -> Result<String, String> {
    use rusqlite::OptionalExtension;
    if !is_lower_sha256(library_id) || !is_lower_sha256(installation_witness) {
        return Err("normalized local actor identity is invalid".into());
    }
    let request: Option<(String, String, String)> = connection
        .query_row(
            "SELECT actor_id, actor_public_key, canonical_enrollment_request
         FROM library_follower_actor_request WHERE singleton_id = 1 AND library_id = ?1;",
            [library_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let key = if request.is_some() {
        load_actor_key_pair(actor_store, library_id)?
    } else {
        load_or_create_actor_key_pair(actor_store, library_id)?
    };
    let identity = actor_identity(
        &EnrollmentAuthority {
            library_id: library_id.into(),
            epoch: 0,
            epoch_id: String::new(),
            authority_key_id: String::new(),
            installation_witness: installation_witness.into(),
        },
        &key,
    )?;
    let selected =
        if request.is_some() {
            request
        } else {
            let mut statement = connection.prepare(
            "SELECT actor.actor_id, actor.public_key, actor.canonical_enrollment_certificate
             FROM library_meta AS meta JOIN library_actors AS actor
              ON actor.authority_epoch_id = meta.authority_epoch AND actor.actor_kind = 'desktop'
             WHERE meta.singleton_id = 1 AND meta.library_id = ?1 AND actor.retired_at IS NULL
              AND actor.public_key = ?2 LIMIT 2;"
        ).map_err(|e| e.to_string())?;
            let mut candidates = statement
                .query_map(
                    rusqlite::params![library_id, identity.actor_public_key],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    },
                )
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?;
            if candidates.len() > 1 {
                return Err("normalized local writer identity is ambiguous".into());
            }
            candidates.pop()
        };
    if let Some((id, public, certificate)) = selected {
        if public != identity.actor_public_key {
            return Err("normalized local actor key differs from its enrollment".into());
        }
        selected_actor_nonce(&identity, library_id, &id, certificate.as_bytes())?;
        return Ok(id);
    }
    Ok(identity.actor_id)
}

/// Host-supplied storage for the actor signing key. The reusable core has no
/// default credential backend, so a missing store remains an explicit error.
pub trait ActorKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String>;
}

fn load_or_create_actor_key_pair(
    store: &dyn ActorKeyStore,
    library_id: &str,
) -> Result<Ed25519KeyPair, String> {
    if let Some(bytes) = store.load(library_id)? {
        let bytes = Zeroizing::new(bytes);
        return Ed25519KeyPair::from_pkcs8(&bytes)
            .map_err(|_| "Library Core actor signing key is corrupt".to_string());
    }

    let generated = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
        .map_err(|_| "Library Core could not generate an actor signing key".to_string())?;
    store.store(library_id, generated.as_ref())?;
    // Read back before signing. A store that accepted the write but kept
    // something else would enroll an actor whose key nobody can reproduce
    // after the next restart, stranding its whole operation chain.
    let readback = Zeroizing::new(
        store
            .load(library_id)?
            .ok_or_else(|| "Library Core actor signing key readback is missing".to_string())?,
    );
    if readback.as_slice() != generated.as_ref() {
        return Err("Library Core actor signing key readback changed".to_string());
    }
    Ed25519KeyPair::from_pkcs8(&readback)
        .map_err(|_| "Library Core actor signing key readback is corrupt".to_string())
}

/// Return this installation's stable actor identity for one normalized Library.
///
/// This may create the installation's actor key, but it does not enroll the
/// actor, change authority, admit a writer, or write Library content.
pub fn load_or_create_normalized_actor_id_v2(
    library_id: &str,
    installation_witness: &str,
    store: &dyn ActorKeyStore,
) -> Result<String, String> {
    if !is_lower_sha256(library_id) || !is_lower_sha256(installation_witness) {
        return Err("normalized Library actor identity is invalid".to_string());
    }
    let key_pair = load_or_create_actor_key_pair(store, library_id)?;
    actor_identity(
        &EnrollmentAuthority {
            library_id: library_id.to_string(),
            epoch: 0,
            epoch_id: String::new(),
            authority_key_id: String::new(),
            installation_witness: installation_witness.to_string(),
        },
        &key_pair,
    )
    .map(|identity| identity.actor_id)
}

pub(crate) fn load_actor_key_pair(
    store: &dyn ActorKeyStore,
    library_id: &str,
) -> Result<Ed25519KeyPair, String> {
    let bytes = Zeroizing::new(
        store
            .load(library_id)?
            .ok_or_else(|| "Library Core actor signing key is missing".to_string())?,
    );
    Ed25519KeyPair::from_pkcs8(&bytes)
        .map_err(|_| "Library Core actor signing key is corrupt".to_string())
}

/// Sign one already-canonicalized operation body digest for this Library actor.
///
/// The native key is opened only for its exact Library and must still match
/// the enrolled public key. The returned signature is domain-separated for a
/// Library Core operation envelope and grants no cloud publication by itself.
pub fn sign_library_core_operation_digest(
    store: &dyn ActorKeyStore,
    library_id: &str,
    expected_actor_public_key: &str,
    operation_signing_body_digest: &str,
) -> Result<String, String> {
    let signatures = sign_library_core_operation_digests(
        store,
        library_id,
        expected_actor_public_key,
        &[operation_signing_body_digest.to_string()],
    )?;
    signatures
        .into_iter()
        .next()
        .ok_or_else(|| "Library Core operation signing request is invalid".to_string())
}

/// Sign one bounded transaction after opening and verifying its actor key once.
pub fn sign_library_core_operation_digests(
    store: &dyn ActorKeyStore,
    library_id: &str,
    expected_actor_public_key: &str,
    operation_signing_body_digests: &[String],
) -> Result<Vec<String>, String> {
    if !is_lower_sha256(library_id)
        || !is_lower_sha256(expected_actor_public_key)
        || operation_signing_body_digests.is_empty()
        || operation_signing_body_digests.len() > OPERATION_TRANSACTION_MAXIMUM_MEMBERS
        || operation_signing_body_digests
            .iter()
            .any(|digest| !is_lower_sha256(digest))
    {
        return Err("Library Core operation signing request is invalid".to_string());
    }
    let key_pair = load_actor_key_pair(store, library_id)?;
    if lower_hex(key_pair.public_key().as_ref()) != expected_actor_public_key {
        return Err("Library Core actor signing key changed".to_string());
    }
    operation_signing_body_digests
        .iter()
        .map(|operation_signing_body_digest| {
            let input = encode_operation_signature_input(
                &json!({ "operation_signing_body_digest": operation_signing_body_digest }),
                MAX_CERTIFICATE_BYTES,
            )
            .map_err(|_| "Library Core operation signature input is invalid".to_string())?;
            Ok(lower_hex(key_pair.sign(&input).as_ref()))
        })
        .collect()
}

/// Verify and countersign one canonical proof-only PWA enrollment request.
///
/// The request supplies only the PWA actor proof. The designated authority host
/// loads its authority key, adds the authority signature, and asks the
/// journal to reverify the complete certificate against the current epoch in
/// the same transaction that enrolls the actor.
pub fn countersign_actor_enrollment_request_bytes(
    canonical_request: &[u8],
    authority_store: &dyn AuthorityKeyStore,
) -> Result<Vec<u8>, String> {
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
    let authority_key_pair = load_established_authority_key_pair(authority_store, library_id)?;
    let signature_domain = if request
        .get("certificate_body")
        .and_then(Value::as_object)
        .is_some_and(|body| body.contains_key("actor_capability_body"))
    {
        "actor-capability-authority"
    } else {
        "actor-enrollment-authority"
    };
    let authority_signature_input = encode_signature_input(
        signature_domain,
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
    encode_canonical_value(&certificate, MAX_CERTIFICATE_BYTES).map_err(|_| {
        "Library Core actor enrollment certificate is not canonically encodable".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn actor_key_pair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).unwrap()
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
        let authority = NormalizedAuthorityStateV2 {
            library_id: "a".repeat(64),
            epoch: 1,
            epoch_id: "b".repeat(64),
            authority_key_id: "c".repeat(64),
            authority_public_key: "d".repeat(64),
            observed_frontier: Vec::new(),
        };
        let store = MemoryActorKeyStore::default();

        let prepared = prepare_normalized_follower_actor_enrollment_request_v2(
            &authority,
            &"e".repeat(64),
            &store,
            2_000,
        )
        .unwrap();
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

        let digest = "9".repeat(64);
        let signature = sign_library_core_operation_digest(
            &store,
            &authority.library_id,
            &prepared.actor_public_key,
            &digest,
        )
        .unwrap();
        let signature_input = encode_operation_signature_input(
            &json!({ "operation_signing_body_digest": digest }),
            MAX_CERTIFICATE_BYTES,
        )
        .unwrap();
        assert!(crate::library_core_ed25519::verify_library_core_ed25519(
            &prepared.actor_public_key,
            &signature,
            &signature_input,
        )
        .unwrap());
    }

    #[test]
    fn one_verified_actor_key_signs_a_bounded_operation_batch() {
        let authority = NormalizedAuthorityStateV2 {
            library_id: "a".repeat(64),
            epoch: 1,
            epoch_id: "b".repeat(64),
            authority_key_id: "c".repeat(64),
            authority_public_key: "d".repeat(64),
            observed_frontier: Vec::new(),
        };
        let store = MemoryActorKeyStore::default();
        let prepared = prepare_normalized_follower_actor_enrollment_request_v2(
            &authority,
            &"e".repeat(64),
            &store,
            2_000,
        )
        .unwrap();
        let digests = vec!["1".repeat(64), "2".repeat(64), "3".repeat(64)];

        let signatures = sign_library_core_operation_digests(
            &store,
            &authority.library_id,
            &prepared.actor_public_key,
            &digests,
        )
        .unwrap();

        assert_eq!(signatures.len(), digests.len());
        for (digest, signature) in digests.iter().zip(signatures) {
            let signature_input = encode_operation_signature_input(
                &json!({ "operation_signing_body_digest": digest }),
                MAX_CERTIFICATE_BYTES,
            )
            .unwrap();
            assert!(crate::library_core_ed25519::verify_library_core_ed25519(
                &prepared.actor_public_key,
                &signature,
                &signature_input,
            )
            .unwrap());
        }
    }

    #[test]
    fn an_empty_or_oversized_operation_batch_is_refused_before_key_access() {
        let store = MemoryActorKeyStore::default();
        let oversized = vec!["1".repeat(64); OPERATION_TRANSACTION_MAXIMUM_MEMBERS + 1];

        for digests in [&[][..], oversized.as_slice()] {
            let error = sign_library_core_operation_digests(
                &store,
                &"a".repeat(64),
                &"b".repeat(64),
                digests,
            )
            .unwrap_err();
            assert_eq!(error, "Library Core operation signing request is invalid");
        }
        assert!(store.stored.borrow().is_none());
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
    fn normalized_actor_identity_is_stable_without_enrolling_or_changing_authority() {
        let store = MemoryActorKeyStore::default();
        let library_id = "a".repeat(64);
        let installation_witness = "b".repeat(64);

        let first =
            load_or_create_normalized_actor_id_v2(&library_id, &installation_witness, &store)
                .unwrap();
        let replay =
            load_or_create_normalized_actor_id_v2(&library_id, &installation_witness, &store)
                .unwrap();

        assert!(is_lower_sha256(&first));
        assert_eq!(first, replay);
    }

    #[test]
    fn the_derived_identity_is_stable_and_separates_installations() {
        let authority = EnrollmentAuthority {
            library_id: "a".repeat(64),
            epoch: 1,
            epoch_id: "b".repeat(64),
            authority_key_id: "c".repeat(64),
            installation_witness: "d".repeat(64),
        };
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
            installation_witness: "e".repeat(64),
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
