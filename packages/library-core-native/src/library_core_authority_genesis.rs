//! Signed authority establishment for the native SQLite Library.
//!
//! A fresh active SQLite Library receives one signed native genesis. Its
//! certificate commits the opaque Library ID, authority key, native engine,
//! operation-segment replication protocol, logical-checkpoint format, and one
//! exact captured SQLite source manifest. The journal commit is idempotent, so
//! response loss and restart return the same authority instead of minting a
//! second head.
//!
//! Older installations may already contain the retired certificate format
//! that named `automerge_legacy` and `automerge_blob_v1`. Those signed bytes
//! remain immutable historical evidence. One separately stored, authority
//! signed forward correction references the old certificate digest and binds
//! the same Library ID, epoch, key lineage, actors, cloud namespace, intents,
//! results, and checkpoints to the native protocol fields.
//!
//! Authority discovery always reads the accepted journal state and the
//! persisted cloud identity fence before deriving a fresh identity. Multiple
//! active Libraries, missing persisted authority, mismatched epochs, missing
//! keys, and competing protocol corrections fail closed. This module never
//! opens Automerge bytes and never synthesizes an Automerge head from SQLite.

use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::library_core_journal::{
    AcceptedAuthorityState, LibraryCoreJournal, VerifiedAuthorityEpoch,
    VerifiedAuthorityProtocolTransition,
};
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
const NATIVE_GENESIS_FORMAT: &str = "freed_library_core_native_sqlite_genesis_v1";
const NATIVE_PROTOCOL_TRANSITION_FORMAT: &str =
    "freed_library_core_native_sqlite_protocol_transition_v1";
const NATIVE_SOURCE_MANIFEST_FORMAT: &str = "freed_library_core_sqlite_source_manifest_v1";
const NATIVE_PROTOCOL_RECEIPT_FORMAT: &str = "freed_library_core_native_authority_protocol_v1";
const NATIVE_ACTIVE_ENGINE: &str = "library_core_v1";
const NATIVE_SCHEMA_VERSION: i64 = 11;
const NATIVE_REPLICATION_PROTOCOL: &str = "op_segments_v1";
const NATIVE_CHECKPOINT_FORMAT: &str = "freed_logical_checkpoint_v1";
const MAX_SAFE_INTEGER_U64: u64 = 9_007_199_254_740_991;

/// The authority signing key is a separate vault account from the migration
/// signing key. One compromised or cleared key must not stand in for the other.
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

/// One exact materialized SQLite revision used as the immutable predecessor
/// manifest for authority establishment. It contains identities and digests,
/// never SQLite, WAL, SHM, or Automerge bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeSqliteSourceSnapshot {
    pub source_digest: String,
    pub source_generation: u64,
    pub source_revision: u64,
    pub sqlite_revision: u64,
    pub item_count: u64,
    pub materialized_digest: String,
}

/// Identity loaded from the renderer's bounded native JSON store before the
/// bootstrap command is allowed to derive any fresh Library identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistedCloudAuthorityHint {
    pub library_id: String,
    pub storage_epoch: String,
    pub writer_id: String,
    pub source_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteAuthorityProtocolReceipt {
    pub format: String,
    pub active_engine: String,
    pub schema_version: i64,
    pub replication_protocol: String,
    pub checkpoint_format: String,
    pub transition_certificate_digest: String,
    pub native_protocol_certificate_digest: String,
    pub prior_transition_certificate_digest: Option<String>,
    pub source_manifest_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EstablishedSqliteAuthority {
    pub authority: AcceptedAuthorityState,
    pub protocol: SqliteAuthorityProtocolReceipt,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeSqliteSourceManifestV1 {
    format: String,
    library_id: String,
    source_digest: String,
    source_generation: u64,
    source_revision: u64,
    sqlite_revision: u64,
    item_count: u64,
    materialized_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeGenesisCertificateBodyV1 {
    format: String,
    library_id: String,
    epoch: i64,
    active_engine: String,
    schema_version: i64,
    replication_protocol: String,
    checkpoint_format: String,
    signature_algorithm: String,
    authority_public_key: String,
    authority_key_id: String,
    source_manifest: NativeSqliteSourceManifestV1,
    source_manifest_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeGenesisCertificateV1 {
    certificate_body: NativeGenesisCertificateBodyV1,
    epoch_id: String,
    epoch_signature: String,
    authority_key_possession_signature: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeProtocolTransitionBodyV1 {
    format: String,
    library_id: String,
    epoch: i64,
    epoch_id: String,
    active_engine: String,
    schema_version: i64,
    replication_protocol: String,
    checkpoint_format: String,
    signature_algorithm: String,
    authority_public_key: String,
    authority_key_id: String,
    prior_transition_certificate_digest: String,
    source_manifest: NativeSqliteSourceManifestV1,
    source_manifest_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeProtocolTransitionCertificateV1 {
    certificate_body: NativeProtocolTransitionBodyV1,
    protocol_transition_id: String,
    transition_signature: String,
    authority_key_possession_signature: String,
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

const WRITER_REASSIGNMENT_FORMAT: &str = "freed_library_core_writer_epoch_reassignment_v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct WriterEpochReassignmentBodyV1 {
    format: String,
    library_id: String,
    source_control: Value,
    target_epoch: i64,
    target_writer_id: String,
    target_authority_public_key: String,
    target_authority_key_id: String,
    signature_algorithm: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct WriterEpochReassignmentCertificateV1 {
    certificate_body: WriterEpochReassignmentBodyV1,
    epoch_id: String,
    epoch_signature: String,
    authority_key_possession_signature: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WriterEpochReassignment {
    pub authority: AcceptedAuthorityState,
    pub canonical_certificate_json: String,
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

fn native_library_id(source_digest: &str, installation_witness: &str) -> Result<String, String> {
    if !is_lower_sha256(source_digest) || !is_lower_sha256(installation_witness) {
        return Err("Library Core native Library identity input is invalid".to_string());
    }
    digest_value(
        "native-sqlite-library-identity",
        &json!({
            "installation_witness": installation_witness,
            "source_digest": source_digest,
        }),
    )
}

fn validate_native_snapshot(snapshot: &NativeSqliteSourceSnapshot) -> Result<(), String> {
    if !is_lower_sha256(&snapshot.source_digest)
        || !is_lower_sha256(&snapshot.materialized_digest)
        || snapshot.source_generation > MAX_SAFE_INTEGER_U64
        || snapshot.source_revision > MAX_SAFE_INTEGER_U64
        || snapshot.sqlite_revision > MAX_SAFE_INTEGER_U64
        || snapshot.item_count > 1_000_000
    {
        return Err("Library Core native SQLite source snapshot is invalid".to_string());
    }
    Ok(())
}

fn native_source_manifest(
    library_id: &str,
    snapshot: &NativeSqliteSourceSnapshot,
) -> Result<(NativeSqliteSourceManifestV1, String), String> {
    if !is_lower_sha256(library_id) {
        return Err("Library Core native Library ID is invalid".to_string());
    }
    validate_native_snapshot(snapshot)?;
    let manifest = NativeSqliteSourceManifestV1 {
        format: NATIVE_SOURCE_MANIFEST_FORMAT.to_string(),
        library_id: library_id.to_string(),
        source_digest: snapshot.source_digest.clone(),
        source_generation: snapshot.source_generation,
        source_revision: snapshot.source_revision,
        sqlite_revision: snapshot.sqlite_revision,
        item_count: snapshot.item_count,
        materialized_digest: snapshot.materialized_digest.clone(),
    };
    let value = serde_json::to_value(&manifest)
        .map_err(|_| "Library Core native source manifest is invalid".to_string())?;
    let digest = digest_value("native-sqlite-source-manifest", &value)?;
    Ok((manifest, digest))
}

fn verify_native_source_manifest(
    manifest: &NativeSqliteSourceManifestV1,
    expected_digest: &str,
) -> Result<(), String> {
    if manifest.format != NATIVE_SOURCE_MANIFEST_FORMAT
        || !is_lower_sha256(&manifest.library_id)
        || !is_lower_sha256(&manifest.source_digest)
        || !is_lower_sha256(&manifest.materialized_digest)
        || manifest.source_generation > MAX_SAFE_INTEGER_U64
        || manifest.source_revision > MAX_SAFE_INTEGER_U64
        || manifest.sqlite_revision > MAX_SAFE_INTEGER_U64
        || manifest.item_count > 1_000_000
    {
        return Err("Library Core native source manifest is invalid".to_string());
    }
    let value = serde_json::to_value(manifest)
        .map_err(|_| "Library Core native source manifest is invalid".to_string())?;
    if expected_digest != digest_value("native-sqlite-source-manifest", &value)? {
        return Err("Library Core native source manifest digest is invalid".to_string());
    }
    Ok(())
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

#[cfg(test)]
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

fn verify_signatures(
    certificate_digest: &str,
    authority_public_key: &str,
    authority_key_id: &str,
    transition_signature: &str,
    possession_signature: &str,
    label: &str,
) -> Result<(), String> {
    for (input, signature, what) in [
        (
            epoch_signature_input(certificate_digest)?,
            transition_signature,
            "transition",
        ),
        (
            possession_signature_input(certificate_digest, authority_key_id)?,
            possession_signature,
            "authority key possession",
        ),
    ] {
        let verified = verify_library_core_ed25519(authority_public_key, signature, &input)
            .map_err(|_| format!("Library Core {label} {what} signature is malformed"))?;
        if !verified {
            return Err(format!("Library Core {label} {what} signature is invalid"));
        }
    }
    Ok(())
}

fn build_native_genesis_certificate(
    library_id: &str,
    snapshot: &NativeSqliteSourceSnapshot,
    key_pair: &Ed25519KeyPair,
) -> Result<NativeGenesisCertificateV1, String> {
    let authority_public_key = lower_hex(key_pair.public_key().as_ref());
    let authority_key_id = authority_key_id(&authority_public_key)?;
    let (source_manifest, source_manifest_digest) = native_source_manifest(library_id, snapshot)?;
    let certificate_body = NativeGenesisCertificateBodyV1 {
        format: NATIVE_GENESIS_FORMAT.to_string(),
        library_id: library_id.to_string(),
        epoch: GENESIS_EPOCH,
        active_engine: NATIVE_ACTIVE_ENGINE.to_string(),
        schema_version: NATIVE_SCHEMA_VERSION,
        replication_protocol: NATIVE_REPLICATION_PROTOCOL.to_string(),
        checkpoint_format: NATIVE_CHECKPOINT_FORMAT.to_string(),
        signature_algorithm: SIGNATURE_ALGORITHM.to_string(),
        authority_public_key,
        authority_key_id: authority_key_id.clone(),
        source_manifest,
        source_manifest_digest,
    };
    let body_value = serde_json::to_value(&certificate_body)
        .map_err(|_| "Library Core native genesis body is invalid".to_string())?;
    let epoch_id = digest_value("epoch-transition-certificate", &body_value)?;
    Ok(NativeGenesisCertificateV1 {
        epoch_signature: lower_hex(key_pair.sign(&epoch_signature_input(&epoch_id)?).as_ref()),
        authority_key_possession_signature: lower_hex(
            key_pair
                .sign(&possession_signature_input(&epoch_id, &authority_key_id)?)
                .as_ref(),
        ),
        certificate_body,
        epoch_id,
    })
}

fn verify_native_genesis_certificate(
    certificate: &NativeGenesisCertificateV1,
) -> Result<(), String> {
    let body = &certificate.certificate_body;
    if body.format != NATIVE_GENESIS_FORMAT
        || body.epoch != GENESIS_EPOCH
        || body.active_engine != NATIVE_ACTIVE_ENGINE
        || body.schema_version != NATIVE_SCHEMA_VERSION
        || body.replication_protocol != NATIVE_REPLICATION_PROTOCOL
        || body.checkpoint_format != NATIVE_CHECKPOINT_FORMAT
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || !is_lower_sha256(&body.library_id)
        || !is_lower_sha256(&body.authority_public_key)
        || body.authority_key_id != authority_key_id(&body.authority_public_key)?
        || body.source_manifest.library_id != body.library_id
    {
        return Err("Library Core native genesis certificate is invalid".to_string());
    }
    verify_native_source_manifest(&body.source_manifest, &body.source_manifest_digest)?;
    let body_value = serde_json::to_value(body)
        .map_err(|_| "Library Core native genesis body is invalid".to_string())?;
    if certificate.epoch_id != digest_value("epoch-transition-certificate", &body_value)? {
        return Err("Library Core native genesis epoch digest is invalid".to_string());
    }
    verify_signatures(
        &certificate.epoch_id,
        &body.authority_public_key,
        &body.authority_key_id,
        &certificate.epoch_signature,
        &certificate.authority_key_possession_signature,
        "native genesis",
    )
}

fn build_native_protocol_transition(
    source: &VerifiedAuthorityEpoch,
    snapshot: &NativeSqliteSourceSnapshot,
    key_pair: &Ed25519KeyPair,
) -> Result<NativeProtocolTransitionCertificateV1, String> {
    let public_key = lower_hex(key_pair.public_key().as_ref());
    if public_key != source.authority.authority_public_key
        || authority_key_id(&public_key)? != source.authority.authority_key_id
    {
        return Err("Library Core legacy authority key lineage is unavailable".to_string());
    }
    let (source_manifest, source_manifest_digest) =
        native_source_manifest(&source.authority.library_id, snapshot)?;
    let certificate_body = NativeProtocolTransitionBodyV1 {
        format: NATIVE_PROTOCOL_TRANSITION_FORMAT.to_string(),
        library_id: source.authority.library_id.clone(),
        epoch: source.authority.epoch,
        epoch_id: source.authority.epoch_id.clone(),
        active_engine: NATIVE_ACTIVE_ENGINE.to_string(),
        schema_version: NATIVE_SCHEMA_VERSION,
        replication_protocol: NATIVE_REPLICATION_PROTOCOL.to_string(),
        checkpoint_format: NATIVE_CHECKPOINT_FORMAT.to_string(),
        signature_algorithm: SIGNATURE_ALGORITHM.to_string(),
        authority_public_key: public_key,
        authority_key_id: source.authority.authority_key_id.clone(),
        prior_transition_certificate_digest: source.transition_certificate_digest.clone(),
        source_manifest,
        source_manifest_digest,
    };
    let body_value = serde_json::to_value(&certificate_body)
        .map_err(|_| "Library Core native protocol transition body is invalid".to_string())?;
    let protocol_transition_id = digest_value("epoch-transition-certificate", &body_value)?;
    Ok(NativeProtocolTransitionCertificateV1 {
        transition_signature: lower_hex(
            key_pair
                .sign(&epoch_signature_input(&protocol_transition_id)?)
                .as_ref(),
        ),
        authority_key_possession_signature: lower_hex(
            key_pair
                .sign(&possession_signature_input(
                    &protocol_transition_id,
                    &certificate_body.authority_key_id,
                )?)
                .as_ref(),
        ),
        certificate_body,
        protocol_transition_id,
    })
}

fn verify_native_protocol_transition(
    certificate: &NativeProtocolTransitionCertificateV1,
    source: &VerifiedAuthorityEpoch,
) -> Result<(), String> {
    let body = &certificate.certificate_body;
    if body.format != NATIVE_PROTOCOL_TRANSITION_FORMAT
        || body.library_id != source.authority.library_id
        || body.epoch != source.authority.epoch
        || body.epoch_id != source.authority.epoch_id
        || body.active_engine != NATIVE_ACTIVE_ENGINE
        || body.schema_version != NATIVE_SCHEMA_VERSION
        || body.replication_protocol != NATIVE_REPLICATION_PROTOCOL
        || body.checkpoint_format != NATIVE_CHECKPOINT_FORMAT
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || body.authority_public_key != source.authority.authority_public_key
        || body.authority_key_id != source.authority.authority_key_id
        || body.prior_transition_certificate_digest != source.transition_certificate_digest
        || body.source_manifest.library_id != body.library_id
    {
        return Err("Library Core native protocol transition is invalid".to_string());
    }
    verify_native_source_manifest(&body.source_manifest, &body.source_manifest_digest)?;
    let body_value = serde_json::to_value(body)
        .map_err(|_| "Library Core native protocol transition body is invalid".to_string())?;
    if certificate.protocol_transition_id
        != digest_value("epoch-transition-certificate", &body_value)?
    {
        return Err("Library Core native protocol transition digest is invalid".to_string());
    }
    verify_signatures(
        &certificate.protocol_transition_id,
        &body.authority_public_key,
        &body.authority_key_id,
        &certificate.transition_signature,
        &certificate.authority_key_possession_signature,
        "native protocol transition",
    )
}

/// Host-supplied storage for the authority signing key. The reusable core has
/// no default credential backend, so a missing store remains an explicit error.
pub trait AuthorityKeyStore {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store(&self, library_id: &str, bytes: &[u8]) -> Result<(), String>;
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

fn load_authority_key_pair(
    store: &dyn AuthorityKeyStore,
    library_id: &str,
) -> Result<Ed25519KeyPair, String> {
    let bytes = store
        .load(library_id)?
        .ok_or_else(|| "Library Core has no established authority signing key".to_string())?;
    Ed25519KeyPair::from_pkcs8(&bytes)
        .map_err(|_| "Library Core authority signing key is corrupt".to_string())
}

fn canonical_certificate<T: Serialize>(
    certificate: &T,
    label: &str,
) -> Result<(Value, String), String> {
    let value = serde_json::to_value(certificate)
        .map_err(|_| format!("Library Core {label} certificate is invalid"))?;
    let canonical = encode_canonical_value(&value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| format!("Library Core {label} certificate is not canonical"))?;
    let canonical_json = String::from_utf8(canonical)
        .map_err(|_| format!("Library Core {label} certificate is not UTF-8"))?;
    Ok((value, canonical_json))
}

fn require_canonical_certificate<T>(canonical_json: &str, label: &str) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    if canonical_json.is_empty() || canonical_json.len() > MAX_CERTIFICATE_BYTES {
        return Err(format!("Library Core {label} certificate size is invalid"));
    }
    let parsed: T = serde_json::from_str(canonical_json)
        .map_err(|_| format!("Library Core {label} certificate is invalid"))?;
    let (_, canonical) = canonical_certificate(&parsed, label)?;
    if canonical != canonical_json {
        return Err(format!("Library Core {label} certificate is not canonical"));
    }
    Ok(parsed)
}

fn verify_legacy_epoch_record(
    record: &VerifiedAuthorityEpoch,
) -> Result<GenesisEpochCertificateV1, String> {
    let certificate: GenesisEpochCertificateV1 = require_canonical_certificate(
        &record.canonical_transition_certificate_json,
        "legacy genesis",
    )?;
    verify_certificate(&certificate)?;
    let (value, _) = canonical_certificate(&certificate, "legacy genesis")?;
    let body = &certificate.certificate_body;
    if record.authority.library_id != body.library_id
        || record.authority.epoch != body.epoch
        || record.authority.epoch_id != certificate.epoch_id
        || record.authority.authority_key_id != body.authority_key_id
        || record.authority.authority_public_key != body.authority_public_key
        || record.transition_certificate_digest
            != digest_value("epoch-transition-certificate", &value)?
    {
        return Err("Library Core stored legacy authority certificate is inconsistent".to_string());
    }
    Ok(certificate)
}

fn require_source_lineage(
    manifest: &NativeSqliteSourceManifestV1,
    snapshot: &NativeSqliteSourceSnapshot,
) -> Result<(), String> {
    if manifest.source_digest != snapshot.source_digest
        || manifest.source_generation != snapshot.source_generation
        || manifest.source_revision != snapshot.source_revision
    {
        return Err("Library Core SQLite source lineage conflicts with accepted authority".into());
    }
    Ok(())
}

fn require_legacy_sqlite_source_lineage(
    certificate: &GenesisEpochCertificateV1,
    snapshot: &NativeSqliteSourceSnapshot,
) -> Result<(), String> {
    let source = &certificate.certificate_body;
    if source.source_document_id != format!("freed-sqlite-{}", snapshot.source_digest)
        || source.source_heads_digest != snapshot.source_digest
        || source.source_head_count != 1
        || source.source_storage_generation != snapshot.source_generation
        || source.source_save_revision != snapshot.source_revision
    {
        return Err("Library Core SQLite source lineage conflicts with legacy authority".into());
    }
    Ok(())
}

fn verify_native_epoch_record(
    record: &VerifiedAuthorityEpoch,
) -> Result<NativeGenesisCertificateV1, String> {
    let certificate: NativeGenesisCertificateV1 = require_canonical_certificate(
        &record.canonical_transition_certificate_json,
        "native genesis",
    )?;
    verify_native_genesis_certificate(&certificate)?;
    let (value, _) = canonical_certificate(&certificate, "native genesis")?;
    let body = &certificate.certificate_body;
    if record.authority.library_id != body.library_id
        || record.authority.epoch != body.epoch
        || record.authority.epoch_id != certificate.epoch_id
        || record.authority.authority_key_id != body.authority_key_id
        || record.authority.authority_public_key != body.authority_public_key
        || record.transition_certificate_digest
            != digest_value("epoch-transition-certificate", &value)?
    {
        return Err("Library Core stored native authority certificate is inconsistent".to_string());
    }
    Ok(certificate)
}

fn verify_writer_epoch_record(record: &VerifiedAuthorityEpoch) -> Result<(), String> {
    let certificate: WriterEpochReassignmentCertificateV1 = require_canonical_certificate(
        &record.canonical_transition_certificate_json,
        "writer reassignment",
    )?;
    verify_writer_reassignment_certificate(&certificate)?;
    let (value, _) = canonical_certificate(&certificate, "writer reassignment")?;
    let body = &certificate.certificate_body;
    if record.authority.library_id != body.library_id
        || record.authority.epoch != body.target_epoch
        || record.authority.epoch_id != certificate.epoch_id
        || record.authority.authority_key_id != body.target_authority_key_id
        || record.authority.authority_public_key != body.target_authority_public_key
        || record.transition_certificate_digest
            != digest_value("epoch-transition-certificate", &value)?
    {
        return Err("Library Core stored writer authority certificate is inconsistent".to_string());
    }
    Ok(())
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

fn stored_certificate_format(canonical_json: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(canonical_json)
        .map_err(|_| "Library Core stored authority certificate is invalid".to_string())?;
    value
        .get("certificate_body")
        .and_then(Value::as_object)
        .and_then(|body| body.get("format"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Library Core stored authority certificate format is missing".to_string())
}

fn establish_native_with_store(
    journal: &mut LibraryCoreJournal,
    snapshot: &NativeSqliteSourceSnapshot,
    installation_witness: &str,
    accepted_at_ms: i64,
    store: &dyn AuthorityKeyStore,
) -> Result<EstablishedSqliteAuthority, String> {
    validate_native_snapshot(snapshot)?;
    if accepted_at_ms < 0 {
        return Err("Library Core native genesis acceptance time is invalid".to_string());
    }
    let library_id = native_library_id(&snapshot.source_digest, installation_witness)?;
    let key_pair = load_or_create_authority_key_pair(store, &library_id)?;
    let certificate = build_native_genesis_certificate(&library_id, snapshot, &key_pair)?;
    verify_native_genesis_certificate(&certificate)?;
    let (certificate_value, canonical_json) =
        canonical_certificate(&certificate, "native genesis")?;
    let transition_certificate_digest =
        digest_value("epoch-transition-certificate", &certificate_value)?;
    let source_manifest_digest = certificate.certificate_body.source_manifest_digest.clone();
    let authority = journal
        .install_authority_epoch(&VerifiedAuthorityEpoch {
            authority: AcceptedAuthorityState {
                library_id,
                epoch: GENESIS_EPOCH,
                epoch_id: certificate.epoch_id,
                authority_key_id: certificate.certificate_body.authority_key_id,
                authority_public_key: certificate.certificate_body.authority_public_key,
                observed_frontier: Vec::new(),
            },
            transition_certificate_digest: transition_certificate_digest.clone(),
            canonical_transition_certificate_json: canonical_json,
            accepted_at_ms,
        })
        .map_err(|error| format!("Library Core could not install native genesis: {error}"))?;
    Ok(EstablishedSqliteAuthority {
        authority,
        protocol: SqliteAuthorityProtocolReceipt {
            format: NATIVE_PROTOCOL_RECEIPT_FORMAT.to_string(),
            active_engine: NATIVE_ACTIVE_ENGINE.to_string(),
            schema_version: NATIVE_SCHEMA_VERSION,
            replication_protocol: NATIVE_REPLICATION_PROTOCOL.to_string(),
            checkpoint_format: NATIVE_CHECKPOINT_FORMAT.to_string(),
            transition_certificate_digest: transition_certificate_digest.clone(),
            native_protocol_certificate_digest: transition_certificate_digest,
            prior_transition_certificate_digest: None,
            source_manifest_digest,
        },
    })
}

fn verify_stored_protocol_transition(
    stored: &VerifiedAuthorityProtocolTransition,
    source: &VerifiedAuthorityEpoch,
) -> Result<NativeProtocolTransitionCertificateV1, String> {
    let certificate: NativeProtocolTransitionCertificateV1 = require_canonical_certificate(
        &stored.canonical_protocol_transition_certificate_json,
        "native protocol transition",
    )?;
    verify_native_protocol_transition(&certificate, source)?;
    let (value, _) = canonical_certificate(&certificate, "native protocol transition")?;
    if stored.library_id != source.authority.library_id
        || stored.source_epoch != source.authority.epoch
        || stored.source_epoch_id != source.authority.epoch_id
        || stored.source_transition_certificate_digest != source.transition_certificate_digest
        || stored.protocol_transition_certificate_digest
            != digest_value("epoch-transition-certificate", &value)?
        || stored.source_manifest_digest != certificate.certificate_body.source_manifest_digest
    {
        return Err("Library Core stored native protocol transition is inconsistent".to_string());
    }
    Ok(certificate)
}

fn establish_or_load_legacy_protocol_transition(
    journal: &mut LibraryCoreJournal,
    source: &VerifiedAuthorityEpoch,
    snapshot: &NativeSqliteSourceSnapshot,
    key_pair: &Ed25519KeyPair,
    accepted_at_ms: i64,
) -> Result<VerifiedAuthorityProtocolTransition, String> {
    let legacy = verify_legacy_epoch_record(source)?;
    require_legacy_sqlite_source_lineage(&legacy, snapshot)?;
    if let Some(stored) = journal
        .authority_protocol_transition(&source.authority.library_id)
        .map_err(|error| error.to_string())?
    {
        let certificate = verify_stored_protocol_transition(&stored, source)?;
        require_source_lineage(&certificate.certificate_body.source_manifest, snapshot)?;
        return Ok(stored);
    }
    let certificate = build_native_protocol_transition(source, snapshot, key_pair)?;
    verify_native_protocol_transition(&certificate, source)?;
    let source_manifest_digest = certificate.certificate_body.source_manifest_digest.clone();
    let (value, canonical_json) =
        canonical_certificate(&certificate, "native protocol transition")?;
    let transition = VerifiedAuthorityProtocolTransition {
        library_id: source.authority.library_id.clone(),
        source_epoch: source.authority.epoch,
        source_epoch_id: source.authority.epoch_id.clone(),
        source_transition_certificate_digest: source.transition_certificate_digest.clone(),
        protocol_transition_certificate_digest: digest_value(
            "epoch-transition-certificate",
            &value,
        )?,
        canonical_protocol_transition_certificate_json: canonical_json,
        source_manifest_digest,
        accepted_at_ms,
    };
    let stored = journal
        .install_authority_protocol_transition(&transition)
        .map_err(|error| {
            format!("Library Core could not install native protocol transition: {error}")
        })?;
    verify_stored_protocol_transition(&stored, source)?;
    Ok(stored)
}

fn reconcile_persisted_hint(
    hint: &PersistedCloudAuthorityHint,
    snapshot: &NativeSqliteSourceSnapshot,
    active: &AcceptedAuthorityState,
) -> Result<(), String> {
    if !is_lower_sha256(&hint.library_id)
        || !is_lower_sha256(&hint.storage_epoch)
        || !is_lower_sha256(&hint.writer_id)
        || !is_lower_sha256(&hint.source_digest)
    {
        return Err("Library Core persisted cloud identity is invalid".to_string());
    }
    if hint.source_digest != snapshot.source_digest
        || hint.library_id != active.library_id
        || hint.storage_epoch != active.epoch_id
    {
        return Err(
            "Library Core persisted cloud identity conflicts with accepted authority".to_string(),
        );
    }
    // writer_id names the writer from the last verified cloud control tuple.
    // It may intentionally name another host on a restored or stale copy.
    // The cloud conductor compares it with the local actor and installs the
    // resulting read-only admission fence. It is not journal authority identity.
    Ok(())
}

fn establish_or_transition_with_store(
    journal: &mut LibraryCoreJournal,
    snapshot: &NativeSqliteSourceSnapshot,
    installation_witness: &str,
    persisted_hint: Option<&PersistedCloudAuthorityHint>,
    accepted_at_ms: i64,
    store: &dyn AuthorityKeyStore,
) -> Result<EstablishedSqliteAuthority, String> {
    validate_native_snapshot(snapshot)?;
    if !is_lower_sha256(installation_witness) || accepted_at_ms < 0 {
        return Err("Library Core native authority request is invalid".to_string());
    }

    // Authority is loaded before a new identity can be derived. A database
    // containing two active Libraries has no safe automatic winner.
    let Some(active) = journal
        .sole_active_authority_epoch()
        .map_err(|error| format!("Library Core could not resolve accepted authority: {error}"))?
    else {
        if persisted_hint.is_some() {
            return Err(
                "Library Core persisted cloud identity has no accepted journal authority"
                    .to_string(),
            );
        }
        return establish_native_with_store(
            journal,
            snapshot,
            installation_witness,
            accepted_at_ms,
            store,
        );
    };

    if let Some(hint) = persisted_hint {
        reconcile_persisted_hint(hint, snapshot, &active.authority)?;
    }
    let key_pair = load_authority_key_pair(store, &active.authority.library_id)?;
    let key_public = lower_hex(key_pair.public_key().as_ref());
    if key_public != active.authority.authority_public_key
        || authority_key_id(&key_public)? != active.authority.authority_key_id
    {
        return Err("Library Core active authority key lineage conflicts".to_string());
    }

    let genesis = journal
        .authority_epoch(&active.authority.library_id, GENESIS_EPOCH)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Library Core active authority has no genesis certificate".to_string())?;
    if active.authority.epoch > GENESIS_EPOCH {
        verify_writer_epoch_record(&active)?;
    }
    match stored_certificate_format(&genesis.canonical_transition_certificate_json)?.as_str() {
        NATIVE_GENESIS_FORMAT => {
            let certificate = verify_native_epoch_record(&genesis)?;
            require_source_lineage(&certificate.certificate_body.source_manifest, snapshot)?;
            if journal
                .authority_protocol_transition(&active.authority.library_id)
                .map_err(|error| error.to_string())?
                .is_some()
            {
                return Err(
                    "Library Core native authority has a competing protocol transition".to_string(),
                );
            }
            Ok(EstablishedSqliteAuthority {
                authority: active.authority,
                protocol: SqliteAuthorityProtocolReceipt {
                    format: NATIVE_PROTOCOL_RECEIPT_FORMAT.to_string(),
                    active_engine: NATIVE_ACTIVE_ENGINE.to_string(),
                    schema_version: NATIVE_SCHEMA_VERSION,
                    replication_protocol: NATIVE_REPLICATION_PROTOCOL.to_string(),
                    checkpoint_format: NATIVE_CHECKPOINT_FORMAT.to_string(),
                    transition_certificate_digest: active.transition_certificate_digest,
                    native_protocol_certificate_digest: genesis.transition_certificate_digest,
                    prior_transition_certificate_digest: None,
                    source_manifest_digest: certificate.certificate_body.source_manifest_digest,
                },
            })
        }
        CERTIFICATE_FORMAT => {
            let transition = establish_or_load_legacy_protocol_transition(
                journal,
                &genesis,
                snapshot,
                &key_pair,
                accepted_at_ms,
            )?;
            let accepted_transition_digest = if active.authority.epoch == GENESIS_EPOCH {
                transition.protocol_transition_certificate_digest.clone()
            } else {
                active.transition_certificate_digest
            };
            Ok(EstablishedSqliteAuthority {
                authority: active.authority,
                protocol: SqliteAuthorityProtocolReceipt {
                    format: NATIVE_PROTOCOL_RECEIPT_FORMAT.to_string(),
                    active_engine: NATIVE_ACTIVE_ENGINE.to_string(),
                    schema_version: NATIVE_SCHEMA_VERSION,
                    replication_protocol: NATIVE_REPLICATION_PROTOCOL.to_string(),
                    checkpoint_format: NATIVE_CHECKPOINT_FORMAT.to_string(),
                    transition_certificate_digest: accepted_transition_digest,
                    native_protocol_certificate_digest: transition
                        .protocol_transition_certificate_digest,
                    prior_transition_certificate_digest: Some(
                        genesis.transition_certificate_digest,
                    ),
                    source_manifest_digest: transition.source_manifest_digest,
                },
            })
        }
        _ => Err("Library Core authority genesis format is unsupported".to_string()),
    }
}

/// Establish native SQLite authority or apply the one historical legacy
/// protocol correction. No Automerge bytes are loaded on either path.
pub fn establish_or_transition_sqlite_authority(
    journal: &mut LibraryCoreJournal,
    snapshot: &NativeSqliteSourceSnapshot,
    installation_witness: &str,
    persisted_hint: Option<&PersistedCloudAuthorityHint>,
    accepted_at_ms: i64,
    store: &dyn AuthorityKeyStore,
) -> Result<EstablishedSqliteAuthority, String> {
    establish_or_transition_with_store(
        journal,
        snapshot,
        installation_witness,
        persisted_hint,
        accepted_at_ms,
        store,
    )
}

#[cfg(test)]
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

fn validate_source_control(source_control: &Value, library_id: &str) -> Result<(), String> {
    let object = source_control
        .as_object()
        .ok_or_else(|| "Library Core source control is not an object".to_string())?;
    let source_library = object
        .get("libraryId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control library is missing".to_string())?;
    let source_epoch = object
        .get("storageEpoch")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control epoch is missing".to_string())?;
    let source_writer = object
        .get("writerId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control writer is missing".to_string())?;
    let source_frontier = object
        .get("causalFrontierDigest")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control frontier is missing".to_string())?;
    let generation = object
        .get("generation")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Library Core source control generation is missing".to_string())?;
    if source_library != library_id
        || !is_lower_sha256(source_epoch)
        || !is_lower_sha256(source_writer)
        || !is_lower_sha256(source_frontier)
        || generation < 0
    {
        return Err("Library Core source control tuple is invalid".to_string());
    }
    Ok(())
}

fn verify_writer_reassignment_certificate(
    certificate: &WriterEpochReassignmentCertificateV1,
) -> Result<(), String> {
    let body = &certificate.certificate_body;
    if body.format != WRITER_REASSIGNMENT_FORMAT
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || !is_lower_sha256(&body.library_id)
        || !is_lower_sha256(&body.target_writer_id)
        || !is_lower_sha256(&body.target_authority_public_key)
        || body.target_authority_key_id != authority_key_id(&body.target_authority_public_key)?
        || body.target_epoch < 1
    {
        return Err("Library Core writer reassignment certificate is invalid".to_string());
    }
    validate_source_control(&body.source_control, &body.library_id)?;
    let body_value = serde_json::to_value(body)
        .map_err(|_| "Library Core writer reassignment body is invalid".to_string())?;
    if certificate.epoch_id != digest_value("epoch-transition-certificate", &body_value)? {
        return Err("Library Core writer reassignment epoch digest is invalid".to_string());
    }
    for (input, signature, label) in [
        (
            epoch_signature_input(&certificate.epoch_id)?,
            &certificate.epoch_signature,
            "epoch",
        ),
        (
            possession_signature_input(&certificate.epoch_id, &body.target_authority_key_id)?,
            &certificate.authority_key_possession_signature,
            "authority possession",
        ),
    ] {
        if !verify_library_core_ed25519(&body.target_authority_public_key, signature, &input)
            .map_err(|_| {
                format!("Library Core writer reassignment {label} signature is malformed")
            })?
        {
            return Err(format!(
                "Library Core writer reassignment {label} signature is invalid"
            ));
        }
    }
    Ok(())
}

/// Install or replay one explicit writer-ownership epoch bound to the exact
/// cloud control tuple that the caller will replace with compare-and-swap.
pub fn reassign_writer_epoch(
    journal: &mut LibraryCoreJournal,
    library_id: &str,
    canonical_source_control_json: &str,
    target_writer_id: &str,
    accepted_at_ms: i64,
    store: &dyn AuthorityKeyStore,
) -> Result<WriterEpochReassignment, String> {
    if !is_lower_sha256(library_id)
        || !is_lower_sha256(target_writer_id)
        || accepted_at_ms < 0
        || canonical_source_control_json.len() > MAX_CERTIFICATE_BYTES
    {
        return Err("Library Core writer reassignment request is invalid".to_string());
    }
    let source_control: Value = serde_json::from_str(canonical_source_control_json)
        .map_err(|_| "Library Core source control JSON is invalid".to_string())?;
    validate_source_control(&source_control, library_id)?;
    let canonical_source = encode_canonical_value(&source_control, MAX_CERTIFICATE_BYTES)
        .map_err(|_| "Library Core source control is not canonically encodable".to_string())?;
    if canonical_source.as_slice() != canonical_source_control_json.as_bytes() {
        return Err("Library Core source control JSON is not canonical".to_string());
    }

    let current = journal
        .active_authority_epoch(library_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Library Core has no active authority to reassign".to_string())?;
    if let Ok(existing) = serde_json::from_str::<WriterEpochReassignmentCertificateV1>(
        &current.canonical_transition_certificate_json,
    ) {
        if existing.certificate_body.source_control == source_control
            && existing.certificate_body.target_writer_id == target_writer_id
        {
            verify_writer_reassignment_certificate(&existing)?;
            return Ok(WriterEpochReassignment {
                authority: current.authority,
                canonical_certificate_json: current.canonical_transition_certificate_json,
            });
        }
    }

    let target_epoch = current
        .authority
        .epoch
        .checked_add(1)
        .ok_or_else(|| "Library Core authority epoch is exhausted".to_string())?;
    let key_pair = load_or_create_authority_key_pair(store, library_id)?;
    let public_key = lower_hex(key_pair.public_key().as_ref());
    let key_id = authority_key_id(&public_key)?;
    let body = WriterEpochReassignmentBodyV1 {
        format: WRITER_REASSIGNMENT_FORMAT.to_string(),
        library_id: library_id.to_string(),
        source_control,
        target_epoch,
        target_writer_id: target_writer_id.to_string(),
        target_authority_public_key: public_key.clone(),
        target_authority_key_id: key_id.clone(),
        signature_algorithm: SIGNATURE_ALGORITHM.to_string(),
    };
    let body_value = serde_json::to_value(&body)
        .map_err(|_| "Library Core writer reassignment body is invalid".to_string())?;
    let epoch_id = digest_value("epoch-transition-certificate", &body_value)?;
    let certificate = WriterEpochReassignmentCertificateV1 {
        epoch_signature: lower_hex(key_pair.sign(&epoch_signature_input(&epoch_id)?).as_ref()),
        authority_key_possession_signature: lower_hex(
            key_pair
                .sign(&possession_signature_input(&epoch_id, &key_id)?)
                .as_ref(),
        ),
        certificate_body: body,
        epoch_id: epoch_id.clone(),
    };
    verify_writer_reassignment_certificate(&certificate)?;
    let certificate_value = serde_json::to_value(&certificate)
        .map_err(|_| "Library Core writer reassignment certificate is invalid".to_string())?;
    let canonical = encode_canonical_value(&certificate_value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| "Library Core writer reassignment certificate is not canonical".to_string())?;
    let canonical_certificate_json = String::from_utf8(canonical)
        .map_err(|_| "Library Core writer reassignment certificate is not UTF-8".to_string())?;
    let transition_certificate_digest =
        digest_value("epoch-transition-certificate", &certificate_value)?;
    let authority = journal
        .install_authority_epoch(&VerifiedAuthorityEpoch {
            authority: AcceptedAuthorityState {
                library_id: library_id.to_string(),
                epoch: target_epoch,
                epoch_id,
                authority_key_id: key_id,
                authority_public_key: public_key,
                observed_frontier: current.authority.observed_frontier,
            },
            transition_certificate_digest,
            canonical_transition_certificate_json: canonical_certificate_json.clone(),
            accepted_at_ms,
        })
        .map_err(|error| format!("Library Core could not install writer epoch: {error}"))?;
    Ok(WriterEpochReassignment {
        authority,
        canonical_certificate_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
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
        // A fixed seed keeps the tests deterministic. A production host mints
        // its key in the injected credential store and never sees a seed.
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

    fn native_snapshot() -> NativeSqliteSourceSnapshot {
        NativeSqliteSourceSnapshot {
            source_digest: "1".repeat(64),
            source_generation: 7,
            source_revision: 11,
            sqlite_revision: 19,
            item_count: 19_000,
            materialized_digest: "2".repeat(64),
        }
    }

    fn synthetic_sqlite_legacy_revision() -> LegacySourceRevision {
        let snapshot = native_snapshot();
        LegacySourceRevision {
            document_id: format!("freed-sqlite-{}", snapshot.source_digest),
            heads_digest: snapshot.source_digest,
            head_count: 1,
            storage_generation: snapshot.source_generation,
            storage_save_revision: snapshot.source_revision,
        }
    }

    fn generated_key_store() -> (Ed25519KeyPair, MemoryKeyStore) {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let store = MemoryKeyStore::default();
        store.stored.replace(Some(pkcs8.as_ref().to_vec()));
        (key_pair, store)
    }

    #[test]
    fn fresh_sqlite_library_emits_native_genesis_and_checkpoint_protocol() {
        let (_directory, mut journal) = open_journal();
        let store = MemoryKeyStore::default();

        let established = establish_or_transition_with_store(
            &mut journal,
            &native_snapshot(),
            &"3".repeat(64),
            None,
            2_000,
            &store,
        )
        .unwrap();

        assert_eq!(established.authority.epoch, 1);
        assert_eq!(established.protocol.active_engine, "library_core_v1");
        assert_eq!(established.protocol.schema_version, 11);
        assert_eq!(established.protocol.replication_protocol, "op_segments_v1");
        assert_eq!(
            established.protocol.checkpoint_format,
            "freed_logical_checkpoint_v1"
        );
        assert_eq!(
            established.protocol.transition_certificate_digest,
            established.protocol.native_protocol_certificate_digest
        );
        assert!(established
            .protocol
            .prior_transition_certificate_digest
            .is_none());
        let stored = journal
            .active_authority_epoch(&established.authority.library_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            stored_certificate_format(&stored.canonical_transition_certificate_json).unwrap(),
            NATIVE_GENESIS_FORMAT
        );
        assert!(!stored
            .canonical_transition_certificate_json
            .contains("automerge"));
        assert_eq!(
            journal
                .connection_for_test()
                .query_row(
                    "SELECT COUNT(*) FROM library_core_native_authority_protocol;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn fresh_native_genesis_replays_after_response_loss_and_restart() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("library-core.sqlite");
        let store = MemoryKeyStore::default();
        let first = {
            let mut journal = LibraryCoreJournal::open(&path).unwrap();
            establish_or_transition_with_store(
                &mut journal,
                &native_snapshot(),
                &"3".repeat(64),
                None,
                2_000,
                &store,
            )
            .unwrap()
        };
        let second = {
            let mut reopened = LibraryCoreJournal::open(&path).unwrap();
            let replay = establish_or_transition_with_store(
                &mut reopened,
                &native_snapshot(),
                &"3".repeat(64),
                None,
                9_000,
                &store,
            )
            .unwrap();
            let count = reopened
                .connection_for_test()
                .query_row(
                    "SELECT COUNT(*) FROM library_core_authority_epochs;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            assert_eq!(count, 1);
            replay
        };
        assert_eq!(first, second);
    }

    #[test]
    fn native_genesis_refuses_a_replaced_sqlite_source_after_restart() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("library-core.sqlite");
        let store = MemoryKeyStore::default();
        {
            let mut journal = LibraryCoreJournal::open(&path).unwrap();
            establish_or_transition_with_store(
                &mut journal,
                &native_snapshot(),
                &"3".repeat(64),
                None,
                2_000,
                &store,
            )
            .unwrap();
        }
        let mut reopened = LibraryCoreJournal::open(&path).unwrap();
        let error = establish_or_transition_with_store(
            &mut reopened,
            &NativeSqliteSourceSnapshot {
                source_digest: "a".repeat(64),
                ..native_snapshot()
            },
            &"3".repeat(64),
            None,
            9_000,
            &store,
        )
        .unwrap_err();

        assert!(error.contains("source lineage conflicts"), "{error}");
    }

    fn seed_legacy_replication_state(
        journal: &LibraryCoreJournal,
        authority: &AcceptedAuthorityState,
    ) {
        let actor_id = "4".repeat(64);
        let actor_public_key = "5".repeat(64);
        let actor_chain = "6".repeat(64);
        let enrollment_digest = "7".repeat(64);
        let intent_segment = "8".repeat(64);
        let result_segment = "9".repeat(64);
        let connection = journal.connection_for_test();
        connection
            .execute(
                "INSERT INTO library_core_actors (
                   libraryId, epoch, epochId, actorId, actorPublicKey,
                   enrollmentOperationId, enrollmentCertificateDigest,
                   canonicalEnrollmentCertificateJson, actorChainGenesis,
                   nextSequence, previousOperationId, previousChainDigest,
                   enrolledAtMs
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'actor-enrollment-1', ?6,
                           '{}', ?7, 1, NULL, ?7, 1000);",
                params![
                    authority.library_id,
                    authority.epoch,
                    authority.epoch_id,
                    actor_id,
                    actor_public_key,
                    enrollment_digest,
                    actor_chain,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?1, ?2, 'control-revision-1', 1000);",
                params![actor_id, authority.epoch_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_follower_anchor (
                   singletonId, libraryId, epoch, epochId, authorityKeyId,
                   authorityPublicKey, observedFrontierJson,
                   manifestObjectKey, manifestContentDigest, generation,
                   remoteIngestSequence, remoteMaterializedDigest, writerId,
                   controlRevision, installedAtMs, manifestTransportObjectId
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, '[]', 'manifest-object-1',
                           ?6, 4, 19, ?7, ?8, 'control-revision-1', 1000,
                           'drive-manifest-1');",
                params![
                    authority.library_id,
                    authority.epoch,
                    authority.epoch_id,
                    authority.authority_key_id,
                    authority.authority_public_key,
                    "a".repeat(64),
                    "b".repeat(64),
                    actor_id,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_follower_actor (
                   libraryId, epochId, actorId, actorPublicKey,
                   actorChainGenesis, enrollmentRequestDigest,
                   canonicalEnrollmentRequestJson,
                   enrollmentCertificateDigest,
                   canonicalEnrollmentCertificateJson, createdAtMs, enrolledAtMs
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7, '{}', 900, 1000);",
                params![
                    authority.library_id,
                    authority.epoch_id,
                    actor_id,
                    actor_public_key,
                    actor_chain,
                    "c".repeat(64),
                    enrollment_digest,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_follower_intent_actor (
                   libraryId, epochId, actorId, nextIntentSequence,
                   latestOperationId, latestActorChainDigest,
                   publishedThroughIntentSequence,
                   latestPublishedSegmentDigest, nextResultSequence,
                   latestResultSegmentDigest
                 ) VALUES (?1, ?2, ?3, 2, 'intent-1', ?4, 1, ?5, 2, ?6);",
                params![
                    authority.library_id,
                    authority.epoch_id,
                    actor_id,
                    actor_chain,
                    intent_segment,
                    result_segment,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_follower_intent_transaction (
                   transactionId, transactionDigest, libraryId, epochId,
                   actorId, firstIntentSequence, lastIntentSequence,
                   operationCount, canonicalEnvelopeBytes, enqueuedAtMs
                 ) VALUES ('intent-transaction-1', ?1, ?2, ?3, ?4,
                           1, 1, 1, 2, 1000);",
                params![
                    "d".repeat(64),
                    authority.library_id,
                    authority.epoch_id,
                    actor_id,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_follower_intent_operation (
                   operationId, transactionId, transactionMemberIndex,
                   libraryId, epochId, actorId, intentSequence,
                   actorChainDigest, canonicalEnvelopeJson, envelopeDigest,
                   publishedSegmentDigest
                 ) VALUES ('intent-1', 'intent-transaction-1', 0, ?1, ?2,
                           ?3, 1, ?4, '{}', ?5, ?6);",
                params![
                    authority.library_id,
                    authority.epoch_id,
                    actor_id,
                    actor_chain,
                    "e".repeat(64),
                    intent_segment,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_follower_intent_result (
                   resultOperationId, libraryId, epochId, actorId,
                   resultSequence, intentOperationId, intentSequence, status,
                   providerReceiptDigest, segmentDigest, importedAtMs
                 ) VALUES ('result-1', ?1, ?2, ?3, 1, 'intent-1', 1,
                           'accepted', NULL, ?4, 1100);",
                params![
                    authority.library_id,
                    authority.epoch_id,
                    actor_id,
                    result_segment,
                ],
            )
            .unwrap();
    }

    #[test]
    fn legacy_protocol_transition_preserves_every_epoch_scoped_record() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("library-core.sqlite");
        let (key_pair, store) = generated_key_store();
        let (legacy, prior_digest, first) = {
            let mut journal = LibraryCoreJournal::open(&path).unwrap();
            let legacy = establish_with_key_pair(
                &mut journal,
                &synthetic_sqlite_legacy_revision(),
                &key_pair,
                1_700,
            )
            .unwrap();
            let prior_digest = journal
                .active_authority_epoch(&legacy.library_id)
                .unwrap()
                .unwrap()
                .transition_certificate_digest;
            seed_legacy_replication_state(&journal, &legacy);
            let hint = PersistedCloudAuthorityHint {
                library_id: legacy.library_id.clone(),
                storage_epoch: legacy.epoch_id.clone(),
                writer_id: "4".repeat(64),
                source_digest: native_snapshot().source_digest,
            };
            let transitioned = establish_or_transition_with_store(
                &mut journal,
                &native_snapshot(),
                &"3".repeat(64),
                Some(&hint),
                2_000,
                &store,
            )
            .unwrap();
            (legacy, prior_digest, transitioned)
        };

        assert_eq!(first.authority, legacy);
        assert_eq!(
            first.protocol.prior_transition_certificate_digest,
            Some(prior_digest.clone())
        );
        assert_ne!(
            first.protocol.native_protocol_certificate_digest,
            prior_digest
        );

        let mut reopened = LibraryCoreJournal::open(&path).unwrap();
        let hint = PersistedCloudAuthorityHint {
            library_id: legacy.library_id.clone(),
            storage_epoch: legacy.epoch_id.clone(),
            writer_id: "4".repeat(64),
            source_digest: native_snapshot().source_digest,
        };
        let replay = establish_or_transition_with_store(
            &mut reopened,
            &NativeSqliteSourceSnapshot {
                sqlite_revision: 20,
                materialized_digest: "f".repeat(64),
                ..native_snapshot()
            },
            &"3".repeat(64),
            Some(&hint),
            9_000,
            &store,
        )
        .unwrap();
        assert_eq!(replay, first);
        let preserved: (i64, i64, i64, i64, i64, String, String) = reopened
            .connection_for_test()
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_authority_epochs),
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_follower_anchor),
                   (SELECT COUNT(*) FROM library_core_follower_intent_operation),
                   (SELECT COUNT(*) FROM library_core_follower_intent_result),
                   (SELECT manifestObjectKey FROM library_core_follower_anchor),
                   (SELECT controlRevision FROM library_core_cloud_writer_admission);",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            preserved,
            (
                1,
                1,
                1,
                1,
                1,
                "manifest-object-1".to_string(),
                "control-revision-1".to_string(),
            )
        );
        let transition_count = reopened
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_native_authority_protocol;",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(transition_count, 1);
    }

    #[test]
    fn legacy_protocol_transition_refuses_an_unrelated_sqlite_source() {
        let (_directory, mut journal) = open_journal();
        let (key_pair, store) = generated_key_store();
        let authority =
            establish_with_key_pair(&mut journal, &revision(), &key_pair, 1_700).unwrap();

        let error = establish_or_transition_with_store(
            &mut journal,
            &native_snapshot(),
            &"3".repeat(64),
            None,
            2_000,
            &store,
        )
        .unwrap_err();

        assert!(error.contains("legacy authority"), "{error}");
        assert!(journal
            .authority_protocol_transition(&authority.library_id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn persisted_identity_conflict_and_split_heads_fail_closed() {
        let (_directory, mut journal) = open_journal();
        let (key_pair, store) = generated_key_store();
        let authority =
            establish_with_key_pair(&mut journal, &revision(), &key_pair, 1_700).unwrap();
        let conflict = PersistedCloudAuthorityHint {
            library_id: "a".repeat(64),
            storage_epoch: authority.epoch_id.clone(),
            writer_id: "4".repeat(64),
            source_digest: native_snapshot().source_digest,
        };
        let error = establish_or_transition_with_store(
            &mut journal,
            &native_snapshot(),
            &"3".repeat(64),
            Some(&conflict),
            2_000,
            &store,
        )
        .unwrap_err();
        assert!(
            error.contains("conflicts with accepted authority"),
            "{error}"
        );
        assert!(journal
            .authority_protocol_transition(&authority.library_id)
            .unwrap()
            .is_none());

        let other = LegacySourceRevision {
            document_id: "freed-library-document-2".to_string(),
            ..revision()
        };
        establish_with_key_pair(&mut journal, &other, &key_pair, 1_800).unwrap();
        let error = establish_or_transition_with_store(
            &mut journal,
            &native_snapshot(),
            &"3".repeat(64),
            None,
            2_000,
            &store,
        )
        .unwrap_err();
        assert!(error.contains("more than one local authority"), "{error}");
    }
}
