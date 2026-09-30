//! Closed handoff proofs. The lifecycle must persist authorization bytes before
//! calling the predecessor signer; these helpers never grant writer admission.

use crate::library_core_canonical::{
    decode_canonical_value, encode_canonical_value, encode_operation_digest_input,
    encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use ring::signature::{Ed25519KeyPair, KeyPair};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_BYTES: usize = 16_384;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const READY_FORMAT: &str = "freed_library_handoff_readiness_v1";
const GRANT_FORMAT: &str = "freed_library_handoff_authorization_v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HandoffReadinessBodyV1 {
    pub format: String,
    pub library_id: String,
    pub predecessor_epoch_id: String,
    pub predecessor_certificate_digest: String,
    pub target_actor_id: String,
    pub target_actor_public_key: String,
    pub target_authority_public_key: String,
    pub native_storage_version: u32,
    pub checkpoint_schema_version: u32,
    pub replication_protocol_version: u32,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HandoffReadinessV1 {
    pub body: HandoffReadinessBodyV1,
    pub handoff_id: String,
    pub actor_signature: String,
    pub authority_possession_signature: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HandoffObjectDescriptorV1 {
    pub object_key: String,
    pub content_digest: String,
    pub byte_length: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HandoffObjectReferenceV1 {
    pub descriptor: HandoffObjectDescriptorV1,
    pub transport_object_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HandoffSourceControlV1 {
    pub schema_version: u32,
    pub protocol_version: u32,
    pub library_id: String,
    pub storage_epoch: String,
    pub writer_id: String,
    pub active_transport: String,
    pub generation: u64,
    pub causal_frontier_digest: String,
    pub manifest: HandoffObjectReferenceV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HandoffAuthorizationBodyV1 {
    pub format: String,
    pub readiness: HandoffReadinessV1,
    pub predecessor_authority_public_key: String,
    pub successor_epoch: u64,
    pub final_source_revision: u64,
    pub final_checkpoint_digest: String,
    pub source_control: HandoffSourceControlV1,
    pub source_control_revision: String,
    pub source_control_file_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HandoffAuthorizationV1 {
    pub body: HandoffAuthorizationBodyV1,
    pub authorization_digest: String,
    pub predecessor_signature: String,
}

pub(crate) struct HandoffPredecessorV1<'a> {
    pub library_id: &'a str,
    pub epoch_id: &'a str,
    pub epoch: u64,
    pub certificate_digest: &'a str,
    pub authority_public_key: &'a str,
    pub writer_id: &'a str,
}

fn value<T: Serialize>(item: &T) -> Result<Value, String> {
    serde_json::to_value(item).map_err(|_| "handoff record cannot be encoded".into())
}

pub(crate) fn canonical_handoff_bytes<T: Serialize>(item: &T) -> Result<Vec<u8>, String> {
    encode_canonical_value(&value(item)?, MAX_BYTES)
        .map_err(|_| "handoff record exceeds its canonical bound".into())
}

pub(crate) fn digest<T: Serialize>(domain: &str, item: &T) -> Result<String, String> {
    let bytes = encode_operation_digest_input(domain, &value(item)?, MAX_BYTES)
        .map_err(|_| "handoff digest input is invalid")?;
    Ok(lower_hex(&Sha256::digest(bytes)))
}

pub(crate) fn signature_input(domain: &str, digest: &str) -> Result<Vec<u8>, String> {
    encode_signature_input(domain, &json!({"digest": digest}), MAX_BYTES)
        .map_err(|_| "handoff signature input is invalid".into())
}

pub(crate) fn verify_signature(
    domain: &str,
    digest: &str,
    key: &str,
    signature: &str,
) -> Result<(), String> {
    if !verify_library_core_ed25519(key, signature, &signature_input(domain, digest)?)
        .map_err(|_| "handoff signature is malformed")?
    {
        return Err("handoff signature is invalid".into());
    }
    Ok(())
}

fn validate_readiness(body: &HandoffReadinessBodyV1) -> Result<(), String> {
    if body.format != READY_FORMAT
        || body.native_storage_version != 2
        || body.checkpoint_schema_version != 1
        || body.replication_protocol_version != 2
        || body.created_at_ms > MAX_SAFE_INTEGER
        || [
            &body.library_id,
            &body.predecessor_epoch_id,
            &body.predecessor_certificate_digest,
            &body.target_actor_id,
            &body.target_actor_public_key,
            &body.target_authority_public_key,
        ]
        .iter()
        .any(|id| !is_lower_sha256(id))
    {
        return Err("handoff readiness identity or compatibility is invalid".into());
    }
    canonical_handoff_bytes(body)?;
    Ok(())
}

pub(crate) fn sign_handoff_readiness_v1(
    body: HandoffReadinessBodyV1,
    actor_key: &Ed25519KeyPair,
    authority_key: &Ed25519KeyPair,
) -> Result<HandoffReadinessV1, String> {
    validate_readiness(&body)?;
    if body.target_actor_public_key != lower_hex(actor_key.public_key().as_ref())
        || body.target_authority_public_key != lower_hex(authority_key.public_key().as_ref())
    {
        return Err("handoff readiness signing key does not match".into());
    }
    let handoff_id = digest("handoff-readiness-body", &body)?;
    let result = HandoffReadinessV1 {
        actor_signature: lower_hex(
            actor_key
                .sign(&signature_input("handoff-readiness-actor", &handoff_id)?)
                .as_ref(),
        ),
        authority_possession_signature: lower_hex(
            authority_key
                .sign(&signature_input(
                    "handoff-readiness-authority",
                    &handoff_id,
                )?)
                .as_ref(),
        ),
        body,
        handoff_id,
    };
    canonical_handoff_bytes(&result)?;
    Ok(result)
}

pub(crate) fn verify_handoff_readiness_v1(
    readiness: &HandoffReadinessV1,
    predecessor: &HandoffPredecessorV1<'_>,
    enrolled_actor_public_key: &str,
) -> Result<(), String> {
    let body = &readiness.body;
    validate_readiness(body)?;
    if body.library_id != predecessor.library_id
        || body.predecessor_epoch_id != predecessor.epoch_id
        || body.predecessor_certificate_digest != predecessor.certificate_digest
        || body.target_actor_public_key != enrolled_actor_public_key
        || readiness.handoff_id != digest("handoff-readiness-body", body)?
    {
        return Err("handoff readiness does not match the enrolled predecessor state".into());
    }
    verify_signature(
        "handoff-readiness-actor",
        &readiness.handoff_id,
        enrolled_actor_public_key,
        &readiness.actor_signature,
    )?;
    verify_signature(
        "handoff-readiness-authority",
        &readiness.handoff_id,
        &body.target_authority_public_key,
        &readiness.authority_possession_signature,
    )?;
    canonical_handoff_bytes(readiness)?;
    Ok(())
}

fn validate_authorization(
    body: &HandoffAuthorizationBodyV1,
    predecessor: &HandoffPredecessorV1<'_>,
    enrolled_actor_public_key: &str,
) -> Result<(), String> {
    verify_handoff_readiness_v1(&body.readiness, predecessor, enrolled_actor_public_key)?;
    let control = &body.source_control;
    let descriptor = &control.manifest.descriptor;
    let expected_key = format!(
        "freed-v2-manifest~{}~e{}~g{}~{}.json",
        control.library_id, control.storage_epoch, control.generation, descriptor.content_digest
    );
    let revision = &body.source_control_revision;
    if body.format != GRANT_FORMAT
        || predecessor.epoch == 0
        || predecessor.epoch >= MAX_SAFE_INTEGER
        || body.successor_epoch != predecessor.epoch + 1
        || body.final_source_revision > MAX_SAFE_INTEGER
        || !is_lower_sha256(&body.final_checkpoint_digest)
        || body.predecessor_authority_public_key != predecessor.authority_public_key
        || body.source_control_file_id.is_empty()
        || body.source_control_file_id.len() > 1024
        || !body
            .source_control_file_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || control.schema_version != 1
        || control.protocol_version != 1
        || control.library_id != predecessor.library_id
        || control.storage_epoch != predecessor.epoch_id
        || control.writer_id != predecessor.writer_id
        || control.active_transport != "google_drive_app_data_v1"
        || control.generation > MAX_SAFE_INTEGER
        || !is_lower_sha256(&control.causal_frontier_digest)
        || !is_lower_sha256(&descriptor.content_digest)
        || descriptor.object_key != expected_key
        || descriptor.byte_length == 0
        || descriptor.byte_length > MAX_SAFE_INTEGER
        || control.manifest.transport_object_id.is_empty()
        || control.manifest.transport_object_id.len() > 1024
        || revision.len() < 2
        || revision.len() > 1024
        || !revision.starts_with('"')
        || !revision.ends_with('"')
        || revision.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
        || revision.as_bytes()[1..revision.len() - 1].contains(&b'"')
    {
        return Err("handoff authorization does not match the exact predecessor".into());
    }
    canonical_handoff_bytes(body)?;
    Ok(())
}

/// Called only after the exact body and irreversible AUTHORIZED phase commit.
fn sign_handoff_authorization_v1(
    body: HandoffAuthorizationBodyV1,
    predecessor: &HandoffPredecessorV1<'_>,
    enrolled_actor_public_key: &str,
    predecessor_key: &Ed25519KeyPair,
) -> Result<HandoffAuthorizationV1, String> {
    validate_authorization(&body, predecessor, enrolled_actor_public_key)?;
    if lower_hex(predecessor_key.public_key().as_ref()) != predecessor.authority_public_key {
        return Err("handoff requires the established predecessor signing key".into());
    }
    let authorization_digest = digest("handoff-authorization-body", &body)?;
    let result = HandoffAuthorizationV1 {
        predecessor_signature: lower_hex(
            predecessor_key
                .sign(&signature_input(
                    "handoff-predecessor-authorization",
                    &authorization_digest,
                )?)
                .as_ref(),
        ),
        body,
        authorization_digest,
    };
    canonical_handoff_bytes(&result)?;
    Ok(result)
}

pub(crate) fn verify_handoff_authorization_v1(
    grant: &HandoffAuthorizationV1,
    predecessor: &HandoffPredecessorV1<'_>,
    enrolled_actor_public_key: &str,
) -> Result<(), String> {
    validate_authorization(&grant.body, predecessor, enrolled_actor_public_key)?;
    if grant.authorization_digest != digest("handoff-authorization-body", &grant.body)? {
        return Err("handoff authorization digest changed".into());
    }
    verify_signature(
        "handoff-predecessor-authorization",
        &grant.authorization_digest,
        predecessor.authority_public_key,
        &grant.predecessor_signature,
    )?;
    canonical_handoff_bytes(grant)?;
    Ok(())
}

/// Construct consent from the sealed native state. This is read-only preparation;
/// the authorization transaction revalidates these bytes before its durable cutoff.
pub fn prepare_source_handoff_authorization_v1(
    connection: &mut rusqlite::Connection,
    handoff_id: &str,
    canonical_control: &[u8],
    control_revision: &str,
    control_file_id: &str,
) -> Result<String, String> {
    let decoded = decode_canonical_value(canonical_control, MAX_BYTES)
        .map_err(|_| "handoff source control is not bounded canonical data")?;
    let control: HandoffSourceControlV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "handoff source control has an unsupported shape")?;
    if canonical_handoff_bytes(&control)? != canonical_control {
        return Err("handoff source control bytes are not canonical".into());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    crate::normalized_handoff::require_handoff_checkpoint_export_v1(&transaction, handoff_id)
        .map_err(|error| error.to_string())?;
    let (phase, readiness): (String, Vec<u8>) = transaction
        .query_row(
            "SELECT phase, canonical_readiness FROM library_local_handoff WHERE singleton_id = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if phase != "sealed" {
        return Err("authorized handoff must reuse its committed consent bytes".into());
    }
    let readiness: HandoffReadinessV1 =
        serde_json::from_slice(&readiness).map_err(|_| "handoff readiness is invalid")?;
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&transaction)
        .map_err(|error| error.to_string())?;
    let (epoch, certificate, public_key): (u64, String, String) = transaction
        .query_row(
            "SELECT epoch_number, transition_certificate_digest, authority_public_key
         FROM library_authority_epochs WHERE epoch_id = ?1 AND library_id = ?2;",
            rusqlite::params![snapshot.authority_epoch, snapshot.library_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "handoff predecessor authority is unavailable")?;
    let actor_public: String = transaction
        .query_row(
            "SELECT public_key FROM library_actors WHERE actor_id = ?1 AND authority_epoch_id = ?2
         AND actor_kind = 'pwa' AND retired_at IS NULL;",
            rusqlite::params![readiness.body.target_actor_id, snapshot.authority_epoch],
            |row| row.get(0),
        )
        .map_err(|_| "handoff target is no longer enrolled")?;
    let body = HandoffAuthorizationBodyV1 {
        format: GRANT_FORMAT.into(),
        readiness,
        predecessor_authority_public_key: public_key.clone(),
        successor_epoch: epoch.checked_add(1).ok_or("handoff epoch overflow")?,
        final_source_revision: snapshot.source_revision,
        final_checkpoint_digest: crate::normalized_import::selected_checkpoint_digest_v2(
            &transaction,
        )
        .map_err(|error| error.to_string())?,
        source_control: control,
        source_control_revision: control_revision.into(),
        source_control_file_id: control_file_id.into(),
    };
    validate_authorization(
        &body,
        &HandoffPredecessorV1 {
            library_id: &snapshot.library_id,
            epoch_id: &snapshot.authority_epoch,
            epoch,
            certificate_digest: &certificate,
            authority_public_key: &public_key,
            writer_id: &snapshot.writer_id,
        },
        &actor_public,
    )?;
    if body.source_control.causal_frontier_digest != snapshot.causal_frontier_digest {
        return Err("handoff source control does not name the sealed frontier".into());
    }
    let bytes = canonical_handoff_bytes(&body)?;
    transaction.commit().map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|_| "handoff consent encoding is invalid".into())
}

/// Commit consent separately from signing. The supplied cloud head is bound by
/// this consent, not proof of target activation; the target must still verify
/// its checkpoint and win CAS against that exact head.
pub fn authorize_source_handoff_v1(
    connection: &mut rusqlite::Connection,
    canonical_body: &[u8],
    authority_store: &dyn crate::normalized_authority_credentials::AuthorityKeyStore,
    authorized_at_ms: u64,
) -> Result<String, String> {
    if !connection.is_autocommit() || authorized_at_ms > MAX_SAFE_INTEGER {
        return Err("handoff authorization input or transaction is invalid".into());
    }
    let decoded = decode_canonical_value(canonical_body, MAX_BYTES)
        .map_err(|_| "handoff authorization is not bounded canonical data")?;
    let body: HandoffAuthorizationBodyV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "handoff authorization has an unsupported shape")?;
    if canonical_handoff_bytes(&body)? != canonical_body {
        return Err("handoff authorization bytes are not canonical".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if synchronous < 2 {
        return Err("handoff authorization requires full SQLite durability".into());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    crate::normalized_handoff::require_handoff_checkpoint_export_v1(
        &transaction,
        &body.readiness.handoff_id,
    )
    .map_err(|error| error.to_string())?;
    let (phase, readiness, stored_body, updated_at, matches): (
        String,
        Vec<u8>,
        Option<Vec<u8>>,
        u64,
        bool,
    ) = transaction
        .query_row(
            "SELECT phase, canonical_readiness, canonical_authorization_body, updated_at,
          target_writer_id = ?1 AND target_authority_public_key = ?2
         FROM library_local_handoff WHERE singleton_id = 1;",
            rusqlite::params![
                body.readiness.body.target_actor_id,
                body.readiness.body.target_authority_public_key
            ],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    if !matches || canonical_handoff_bytes(&body.readiness)? != readiness {
        return Err("handoff authorization changed the selected target".into());
    }
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&transaction)
        .map_err(|error| error.to_string())?;
    let (epoch, certificate, public_key): (u64, String, String) = transaction
        .query_row(
            "SELECT epoch_number, transition_certificate_digest, authority_public_key
         FROM library_authority_epochs WHERE epoch_id = ?1 AND library_id = ?2;",
            rusqlite::params![snapshot.authority_epoch, snapshot.library_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "handoff predecessor authority is unavailable")?;
    let actor_public: String = transaction
        .query_row(
            "SELECT public_key FROM library_actors WHERE actor_id = ?1
         AND authority_epoch_id = ?2 AND actor_kind = 'pwa' AND retired_at IS NULL;",
            rusqlite::params![
                body.readiness.body.target_actor_id,
                snapshot.authority_epoch
            ],
            |row| row.get(0),
        )
        .map_err(|_| "handoff target is no longer enrolled")?;
    validate_authorization(
        &body,
        &HandoffPredecessorV1 {
            library_id: &snapshot.library_id,
            epoch_id: &snapshot.authority_epoch,
            epoch,
            certificate_digest: &certificate,
            authority_public_key: &public_key,
            writer_id: &snapshot.writer_id,
        },
        &actor_public,
    )?;
    if body.final_checkpoint_digest
        != crate::normalized_import::selected_checkpoint_digest_v2(&transaction)
            .map_err(|error| error.to_string())?
        || body.final_source_revision != snapshot.source_revision
        || body.source_control.causal_frontier_digest != snapshot.causal_frontier_digest
    {
        return Err("handoff authorization changed the sealed frontier".into());
    }
    let key = crate::normalized_authority_credentials::load_established_authority_key_pair(
        authority_store,
        &snapshot.library_id,
    )?;
    if lower_hex(key.public_key().as_ref()) != public_key {
        return Err("handoff authorization requires the established predecessor key".into());
    }
    if phase == "authorized" {
        if stored_body.as_deref() != Some(canonical_body) {
            return Err("committed handoff authorization cannot be replaced".into());
        }
    } else {
        if stored_body.is_some() || authorized_at_ms < updated_at {
            return Err("handoff authorization conflicts with the sealed state".into());
        }
        let changed = transaction
            .execute(
                "UPDATE library_local_handoff SET phase = 'authorized',
             canonical_authorization_body = ?1, expected_control_revision = ?2, updated_at = ?3
             WHERE singleton_id = 1 AND phase = 'sealed' AND canonical_authorization_body IS NULL
              AND canonical_authorization IS NULL AND canonical_activation IS NULL
              AND successor_epoch_id IS NULL;",
                rusqlite::params![
                    canonical_body,
                    body.source_control_revision,
                    authorized_at_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("handoff authorization cutoff did not persist".into());
        }
    }
    // No signature exists before this commit. Failure below must leave the
    // irreversible cutoff intact, so retry can only finish the same consent.
    transaction.commit().map_err(|error| error.to_string())?;
    let grant = sign_persisted_handoff_authorization_v1(connection, &key)?;
    String::from_utf8(canonical_handoff_bytes(&grant)?)
        .map_err(|_| "handoff authorization encoding is invalid".into())
}

/// Sign only a previously committed authorization. Owning this transaction
/// prevents a caller from signing a fence it can subsequently roll back.
/// A crash after signature creation remains irreversibly AUTHORIZED; retry
/// reconstructs the exact signature and never restores predecessor admission.
pub(crate) fn sign_persisted_handoff_authorization_v1(
    connection: &mut rusqlite::Connection,
    predecessor_key: &Ed25519KeyPair,
) -> Result<HandoffAuthorizationV1, String> {
    if !connection.is_autocommit() {
        return Err("handoff authorization must commit before signing".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if synchronous < 2 {
        return Err("handoff signing requires full SQLite durability".into());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let version: u32 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version != crate::sqlite_contract_generated::NATIVE_STORAGE_SCHEMA_VERSION {
        return Err("handoff signing requires the durable native fence".into());
    }
    crate::normalized_sqlite::install_normalized_schema_v1(&transaction)
        .map_err(|error| error.to_string())?;
    let (body_bytes, readiness_bytes, stored_grant): (Vec<u8>, Vec<u8>, Option<Vec<u8>>) =
        transaction
            .query_row(
                "SELECT canonical_authorization_body, canonical_readiness, canonical_authorization
             FROM library_local_handoff
             WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'authorized';",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| "handoff has no committed predecessor authorization")?;
    let decoded = decode_canonical_value(&body_bytes, MAX_BYTES)
        .map_err(|_| "stored handoff authorization is not bounded canonical data")?;
    let body: HandoffAuthorizationBodyV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "stored handoff authorization has an unsupported shape")?;
    if canonical_handoff_bytes(&body.readiness)? != readiness_bytes {
        return Err("stored handoff readiness changed".into());
    }
    let (library, epoch_id, epoch, certificate, public_key, writer, revision): (
        String,
        String,
        u64,
        String,
        String,
        String,
        u64,
    ) = transaction
        .query_row(
            "SELECT active.library_id, active.epoch_id, epoch.epoch_number,
                    epoch.transition_certificate_digest, epoch.authority_public_key,
                    writer.actor_id, meta.source_revision
             FROM library_active_authority AS active
             JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
             JOIN library_meta AS meta ON meta.singleton_id = 1
                AND meta.library_id = active.library_id AND meta.authority_epoch = active.epoch_id
             JOIN library_actors AS writer ON writer.authority_epoch_id = active.epoch_id
                AND writer.actor_kind = 'desktop' AND writer.retired_at IS NULL
             JOIN library_local_handoff AS handoff ON handoff.singleton_id = 1
                AND handoff.library_id = active.library_id
                AND handoff.predecessor_epoch_id = active.epoch_id
             WHERE active.active_key = 'active'
               AND (SELECT count(*) FROM library_actors AS candidate
                    WHERE candidate.authority_epoch_id = active.epoch_id
                      AND candidate.actor_kind = 'desktop' AND candidate.retired_at IS NULL) = 1;",
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
        .map_err(|_| "handoff predecessor no longer matches local authority")?;
    let matches: bool = transaction
        .query_row(
            "SELECT handoff_id = ?1 AND target_writer_id = ?2
                AND target_authority_public_key = ?3 AND expected_control_revision = ?4
         FROM library_local_handoff WHERE singleton_id = 1;",
            rusqlite::params![
                body.readiness.handoff_id,
                body.readiness.body.target_actor_id,
                body.readiness.body.target_authority_public_key,
                body.source_control_revision
            ],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let frontier = crate::normalized_sqlite::checkpoint_frontier_digest_v2(&transaction, &epoch_id)
        .map_err(|error| error.to_string())?;
    if !matches
        || body.final_checkpoint_digest
            != crate::normalized_import::selected_checkpoint_digest_v2(&transaction)
                .map_err(|error| error.to_string())?
        || body.final_source_revision != revision
        || body.source_control.causal_frontier_digest != frontier
    {
        return Err("handoff authorization no longer matches the sealed state".into());
    }
    let actor_public_key: String = transaction
        .query_row(
            "SELECT public_key FROM library_actors
         WHERE actor_id = ?1 AND authority_epoch_id = ?2
           AND actor_kind = 'pwa' AND retired_at IS NULL;",
            rusqlite::params![body.readiness.body.target_actor_id, epoch_id],
            |row| row.get(0),
        )
        .map_err(|_| "handoff target is not an enrolled consumer actor")?;
    let predecessor = HandoffPredecessorV1 {
        library_id: &library,
        epoch_id: &epoch_id,
        epoch,
        certificate_digest: &certificate,
        authority_public_key: &public_key,
        writer_id: &writer,
    };
    let grant =
        sign_handoff_authorization_v1(body, &predecessor, &actor_public_key, predecessor_key)?;
    let bytes = canonical_handoff_bytes(&grant)?;
    if let Some(stored) = stored_grant {
        if stored != bytes {
            return Err("stored handoff authorization signature changed".into());
        }
    } else {
        let changed = transaction
            .execute(
                "UPDATE library_local_handoff SET canonical_authorization = ?1
             WHERE singleton_id = 1 AND phase = 'authorized'
               AND canonical_authorization_body = ?2 AND canonical_authorization IS NULL;",
                rusqlite::params![bytes, body_bytes],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("handoff authorization receipt did not persist".into());
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(grant)
}

/// The owner selects an enrolled target before this call. Persisting preparation
/// stops fresh provider work, while already admitted canonical work may drain.
/// No predecessor authorization is signed by this operation.
pub fn begin_source_handoff_v1(
    connection: &mut rusqlite::Connection,
    canonical_readiness: &[u8],
    selected_target_actor_id: &str,
    authority_store: &dyn crate::normalized_authority_credentials::AuthorityKeyStore,
    prepared_at_ms: u64,
) -> Result<String, String> {
    if prepared_at_ms > MAX_SAFE_INTEGER
        || !connection.is_autocommit()
        || !is_lower_sha256(selected_target_actor_id)
    {
        return Err("source handoff request is invalid".into());
    }
    let decoded = decode_canonical_value(canonical_readiness, MAX_BYTES)
        .map_err(|_| "target readiness is not bounded canonical data")?;
    let readiness: HandoffReadinessV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "target readiness has an unsupported shape")?;
    if readiness.body.target_actor_id != selected_target_actor_id {
        return Err("target readiness does not match the selected device".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if synchronous < 2 {
        return Err("source handoff requires full SQLite durability".into());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let version: u32 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if ![1, 2].contains(&version) {
        return Err("source handoff requires an existing Library".into());
    }
    crate::normalized_sqlite::install_normalized_schema_v1(&transaction)
        .map_err(|error| error.to_string())?;
    let context = crate::normalized_mutation::normalized_primary_mutation_context_v1(&transaction)
        .map_err(|_| "source handoff requires the admitted Primary")?;
    let (certificate, authority_public): (String, String) = transaction
        .query_row(
            "SELECT transition_certificate_digest, authority_public_key
         FROM library_authority_epochs WHERE epoch_id = ?1 AND library_id = ?2;",
            rusqlite::params![context.epoch_id, context.library_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "source handoff authority is unavailable")?;
    let actor_public: String = transaction
        .query_row(
            "SELECT public_key FROM library_actors WHERE actor_id = ?1
           AND authority_epoch_id = ?2 AND actor_kind = 'pwa' AND retired_at IS NULL;",
            rusqlite::params![selected_target_actor_id, context.epoch_id],
            |row| row.get(0),
        )
        .map_err(|_| "selected handoff target is not an enrolled consumer")?;
    let predecessor = HandoffPredecessorV1 {
        library_id: &context.library_id,
        epoch_id: &context.epoch_id,
        epoch: u64::try_from(context.epoch).map_err(|_| "source handoff epoch is invalid")?,
        certificate_digest: &certificate,
        authority_public_key: &authority_public,
        writer_id: &context.actor_id,
    };
    verify_handoff_readiness_v1(&readiness, &predecessor, &actor_public)?;
    let key = crate::normalized_authority_credentials::load_established_authority_key_pair(
        authority_store,
        &context.library_id,
    )?;
    if lower_hex(key.public_key().as_ref()) != authority_public {
        return Err("source handoff key does not match established authority".into());
    }
    if version == 2 {
        let cancelled: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_handoff_cancellations WHERE handoff_id = ?1);",
            [&readiness.handoff_id], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if cancelled {
            return Err("this handoff readiness was cancelled; prepare a new transfer".into());
        }

        let (role, phase, bytes, unsigned, identity_matches): (
            String,
            String,
            Vec<u8>,
            bool,
            bool,
        ) = transaction
            .query_row(
                "SELECT installation_role, phase, canonical_readiness,
                    canonical_authorization_body IS NULL AND canonical_authorization IS NULL
                    AND canonical_activation IS NULL AND successor_epoch_id IS NULL,
                    handoff_id = ?1 AND target_writer_id = ?2 AND target_authority_public_key = ?3
             FROM library_local_handoff WHERE singleton_id = 1;",
                rusqlite::params![
                    readiness.handoff_id,
                    selected_target_actor_id,
                    readiness.body.target_authority_public_key
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .map_err(|_| "source handoff recovery record is missing")?;
        if role == "source"
            && phase == "preparing"
            && unsigned
            && identity_matches
            && bytes == canonical_readiness
        {
            transaction.commit().map_err(|error| error.to_string())?;
            return Ok(readiness.handoff_id);
        }
        if role == "source" && phase == "cancelled" {
            crate::normalized_handoff::require_source_cancellation_ledger_v1(&transaction)
                .map_err(|error| error.to_string())?;
        }
        if !((role == "source" && phase == "cancelled" && unsigned)
            || (role == "target" && phase == "active"))
        {
            return Err(
                "another handoff is already in progress; resume its persisted state".into(),
            );
        }
        transaction
            .execute(
                "DELETE FROM library_local_handoff WHERE singleton_id = 1;",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    crate::normalized_sqlite::migrate_native_handoff_schema_v2(&transaction)
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO library_local_handoff
        (singleton_id, handoff_id, library_id, installation_role, phase,
         predecessor_epoch_id, target_writer_id, target_authority_public_key,
         canonical_readiness, created_at, updated_at)
        VALUES (1, ?1, ?2, 'source', 'preparing', ?3, ?4, ?5, ?6, ?7, ?7);",
            rusqlite::params![
                readiness.handoff_id,
                context.library_id,
                context.epoch_id,
                selected_target_actor_id,
                readiness.body.target_authority_public_key,
                canonical_readiness,
                prepared_at_ms
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(readiness.handoff_id)
}

/// Persist predecessor consent for this installation without granting authority.
/// Catch-up and cloud CAS remain separate, required activation steps.
pub fn accept_target_handoff_authorization_v1(
    connection: &mut rusqlite::Connection,
    canonical_authorization: &[u8],
    actor_store: &dyn crate::library_core_actor_enrollment::ActorKeyStore,
    pending_authority_store: &dyn crate::normalized_authority_credentials::AuthorityKeyStore,
    accepted_at_ms: u64,
) -> Result<String, String> {
    if !connection.is_autocommit() || accepted_at_ms > MAX_SAFE_INTEGER {
        return Err("target consent input or transaction is invalid".into());
    }
    let decoded = decode_canonical_value(canonical_authorization, MAX_BYTES)
        .map_err(|_| "target consent is not bounded canonical data")?;
    let grant: HandoffAuthorizationV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "target consent has an unsupported shape")?;
    if canonical_handoff_bytes(&grant)? != canonical_authorization {
        return Err("target consent bytes are not canonical".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if synchronous < 2 {
        return Err("target consent requires full SQLite durability".into());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&transaction)
        .map_err(|error| error.to_string())?;
    type StoredTargetConsent = (
        Vec<u8>,
        Option<Vec<u8>>,
        Option<Vec<u8>>,
        Option<String>,
        u64,
    );
    let (readiness, stored, stored_body, stored_revision, updated_at): StoredTargetConsent =
        transaction
            .query_row(
                "SELECT canonical_readiness, canonical_authorization, canonical_authorization_body,
                expected_control_revision, updated_at FROM library_local_handoff
         WHERE singleton_id = 1 AND installation_role = 'target' AND phase = 'preparing'
          AND handoff_id = ?1 AND library_id = ?2 AND predecessor_epoch_id = ?3
          AND target_writer_id = ?4 AND target_authority_public_key = ?5
          AND successor_epoch_id IS NULL AND canonical_activation IS NULL;",
                rusqlite::params![
                    grant.body.readiness.handoff_id,
                    grant.body.readiness.body.library_id,
                    grant.body.readiness.body.predecessor_epoch_id,
                    grant.body.readiness.body.target_actor_id,
                    grant.body.readiness.body.target_authority_public_key
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .map_err(|_| "target consent does not match this prepared installation")?;
    if readiness != canonical_handoff_bytes(&grant.body.readiness)? {
        return Err("target consent changed the persisted readiness".into());
    }
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&transaction)
        .map_err(|error| error.to_string())?;
    let (epoch, certificate, public_key): (u64, String, String) = transaction
        .query_row(
            "SELECT epoch_number, transition_certificate_digest, authority_public_key
         FROM library_authority_epochs WHERE epoch_id = ?1 AND library_id = ?2;",
            rusqlite::params![snapshot.authority_epoch, snapshot.library_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "target consent predecessor is unavailable")?;
    let actor_public: String = transaction
        .query_row(
            "SELECT actor.public_key FROM library_actors AS actor
         JOIN library_follower_actor_request AS request ON request.singleton_id = 1
          AND request.actor_id = actor.actor_id AND request.actor_public_key = actor.public_key
          AND request.authority_epoch_id = actor.authority_epoch_id
          AND request.enrollment_certificate_digest = actor.enrollment_certificate_digest
         JOIN library_intent_actors AS intent ON intent.actor_id = actor.actor_id
         WHERE actor.actor_id = ?1 AND actor.authority_epoch_id = ?2 AND request.library_id = ?3
          AND actor.actor_kind = 'pwa' AND actor.retired_at IS NULL;",
            rusqlite::params![
                grant.body.readiness.body.target_actor_id,
                snapshot.authority_epoch,
                snapshot.library_id
            ],
            |row| row.get(0),
        )
        .map_err(|_| "target consent requires this installation's enrolled actor")?;
    verify_handoff_authorization_v1(
        &grant,
        &HandoffPredecessorV1 {
            library_id: &snapshot.library_id,
            epoch_id: &snapshot.authority_epoch,
            epoch,
            certificate_digest: &certificate,
            authority_public_key: &public_key,
            writer_id: &snapshot.writer_id,
        },
        &actor_public,
    )?;
    if snapshot.source_revision > grant.body.final_source_revision
        || (snapshot.source_revision == grant.body.final_source_revision
            && (snapshot.causal_frontier_digest
                != grant.body.source_control.causal_frontier_digest
                || grant.body.final_checkpoint_digest
                    != crate::normalized_import::selected_checkpoint_digest_v2(&transaction)
                        .map_err(|error| error.to_string())?))
    {
        return Err("target consent would regress or replace its canonical frontier".into());
    }
    let actor_key = crate::library_core_actor_enrollment::load_actor_key_pair(
        actor_store,
        &snapshot.library_id,
    )?;
    let pending_key = crate::normalized_authority_credentials::load_established_authority_key_pair(
        pending_authority_store,
        &snapshot.library_id,
    )?;
    if lower_hex(actor_key.public_key().as_ref()) != actor_public
        || lower_hex(pending_key.public_key().as_ref())
            != grant.body.readiness.body.target_authority_public_key
    {
        return Err("target consent requires its original local signing keys".into());
    }
    let unavailable: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_writer_admission)
         OR EXISTS(SELECT 1 FROM library_local_cloud_writer_admission)
         OR EXISTS(SELECT 1 FROM library_intent_transactions WHERE state IN ('pending', 'published'))
         OR EXISTS(SELECT 1 FROM library_optimistic_fields);", [], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if unavailable {
        return Err("target consent requires a settled, fenced consumer".into());
    }
    if let Some(stored) = stored {
        if stored != canonical_authorization
            || stored_body.as_deref() != Some(canonical_handoff_bytes(&grant.body)?.as_slice())
            || stored_revision.as_deref() != Some(grant.body.source_control_revision.as_str())
        {
            return Err("accepted target consent cannot be replaced".into());
        }
    } else {
        if stored_body.is_some() || stored_revision.is_some() {
            return Err("target consent receipt is incomplete".into());
        }
        if accepted_at_ms < updated_at {
            return Err("target consent time precedes preparation".into());
        }
        transaction
            .execute(
                "UPDATE library_local_handoff SET canonical_authorization_body = ?1,
              canonical_authorization = ?2, expected_control_revision = ?3, updated_at = ?4
             WHERE singleton_id = 1;",
                rusqlite::params![
                    canonical_handoff_bytes(&grant.body)?,
                    canonical_authorization,
                    grant.body.source_control_revision,
                    accepted_at_ms
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(grant.body.readiness.handoff_id)
}

/// Select successor canonical rows while retaining the durable target fence.
/// This does not promote the pending key or grant canonical/provider admission.
pub fn stage_target_handoff_v1(
    connection: &mut rusqlite::Connection,
    handoff_id: &str,
    installation_witness: &str,
    actor_store: &dyn crate::library_core_actor_enrollment::ActorKeyStore,
    pending_authority_store: &dyn crate::normalized_authority_credentials::AuthorityKeyStore,
    staged_at_ms: u64,
) -> Result<crate::normalized_writer_certificate::WriterEpochReassignment, String> {
    use crate::normalized_writer_reassignment::{
        current_authority, install_prepared_writer_epoch_v2, WriterEpochAdmission,
        WriterEpochInstallation,
    };
    if !connection.is_autocommit()
        || staged_at_ms > MAX_SAFE_INTEGER
        || !is_lower_sha256(handoff_id)
        || !is_lower_sha256(installation_witness)
    {
        return Err("target staging input or transaction is invalid".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if synchronous < 2 {
        return Err("target staging requires full SQLite durability".into());
    }
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
    let (bytes, body, ready, phase, successor, updated): (
        Vec<u8>,
        Vec<u8>,
        Vec<u8>,
        String,
        Option<String>,
        u64,
    ) = tx
        .query_row(
            "SELECT canonical_authorization, canonical_authorization_body, canonical_readiness,
                phase, successor_epoch_id, updated_at FROM library_local_handoff
         WHERE singleton_id = 1 AND handoff_id = ?1 AND installation_role = 'target'
           AND phase IN ('preparing', 'cas_pending') AND canonical_activation IS NULL;",
            [handoff_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|_| "target staging requires accepted local consent")?;
    let grant: HandoffAuthorizationV1 = serde_json::from_value(
        decode_canonical_value(&bytes, MAX_BYTES)
            .map_err(|_| "target staging consent is invalid")?
            .into_value(),
    )
    .map_err(|_| "target staging consent shape is invalid")?;
    if canonical_handoff_bytes(&grant)? != bytes
        || canonical_handoff_bytes(&grant.body)? != body
        || canonical_handoff_bytes(&grant.body.readiness)? != ready
        || grant.body.readiness.handoff_id != handoff_id
    {
        return Err("target staging consent records disagree".into());
    }
    let readiness = &grant.body.readiness.body;
    let exact: bool = tx
        .query_row(
            "SELECT library_id = ?1 AND predecessor_epoch_id = ?2 AND target_writer_id = ?3
          AND target_authority_public_key = ?4 AND expected_control_revision = ?5
         FROM library_local_handoff WHERE singleton_id = 1;",
            rusqlite::params![
                readiness.library_id,
                readiness.predecessor_epoch_id,
                readiness.target_actor_id,
                readiness.target_authority_public_key,
                grant.body.source_control_revision
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let unavailable: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_writer_admission)
         OR EXISTS(SELECT 1 FROM library_local_cloud_writer_admission)
         OR EXISTS(SELECT 1 FROM library_intent_transactions WHERE state IN ('pending', 'published'))
         OR EXISTS(SELECT 1 FROM library_optimistic_fields);", [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if !exact || unavailable {
        return Err("target staging requires a settled, fenced consumer".into());
    }

    // Snapshot established bytes once. Enrollment helpers cannot create or replace
    // keys, even if a host credential store changes during the transaction.
    struct EstablishedKey(zeroize::Zeroizing<Vec<u8>>);
    impl crate::library_core_actor_enrollment::ActorKeyStore for EstablishedKey {
        fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.to_vec()))
        }
        fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
            Err("staging cannot replace an actor key".into())
        }
    }
    impl crate::normalized_authority_credentials::AuthorityKeyStore for EstablishedKey {
        fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.to_vec()))
        }
        fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
            Err("staging cannot replace an authority key".into())
        }
    }
    let actor = EstablishedKey(zeroize::Zeroizing::new(
        actor_store
            .load(&readiness.library_id)?
            .ok_or("target staging actor key is missing")?,
    ));
    let pending = EstablishedKey(zeroize::Zeroizing::new(
        pending_authority_store
            .load(&readiness.library_id)?
            .ok_or("target staging authority key is missing")?,
    ));
    let actor_key =
        crate::library_core_actor_enrollment::load_actor_key_pair(&actor, &readiness.library_id)?;
    let pending_key = crate::normalized_authority_credentials::load_established_authority_key_pair(
        &pending,
        &readiness.library_id,
    )?;
    if lower_hex(actor_key.public_key().as_ref()) != readiness.target_actor_public_key
        || lower_hex(pending_key.public_key().as_ref()) != readiness.target_authority_public_key
    {
        return Err("target staging requires its original local signing keys".into());
    }
    let (epoch, certificate, public): (u64, String, String) = tx
        .query_row(
            "SELECT epoch_number, transition_certificate_digest, authority_public_key
         FROM library_authority_epochs WHERE epoch_id = ?1 AND library_id = ?2;",
            rusqlite::params![readiness.predecessor_epoch_id, readiness.library_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "target staging predecessor is missing")?;
    let predecessor = HandoffPredecessorV1 {
        library_id: &readiness.library_id,
        epoch_id: &readiness.predecessor_epoch_id,
        epoch,
        certificate_digest: &certificate,
        authority_public_key: &public,
        writer_id: &grant.body.source_control.writer_id,
    };
    verify_handoff_authorization_v1(&grant, &predecessor, &readiness.target_actor_public_key)?;
    let (current, current_certificate, generation, manifest_generation) =
        current_authority(&tx).map_err(|e| e.to_string())?;
    let selected_actor_certificate: String = tx.query_row(
        "SELECT canonical_enrollment_certificate FROM library_actors WHERE actor_id = ?1 AND public_key = ?2;",
        rusqlite::params![readiness.target_actor_id, readiness.target_actor_public_key],
        |r| r.get(0),
    ).map_err(|_| "target staging enrolled actor is missing")?;
    if phase == "cas_pending" {
        let proof: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
            serde_json::from_value(
                decode_canonical_value(current_certificate.as_bytes(), MAX_BYTES)
                    .map_err(|_| "staged successor certificate is invalid")?
                    .into_value(),
            )
            .map_err(|_| "staged successor certificate shape is invalid")?;
        crate::normalized_handoff_writer_certificate::verify_writer_handoff_certificate_v1(
            &proof,
            &predecessor,
            &readiness.target_actor_public_key,
        )?;
        if successor.as_deref() != Some(current.epoch_id.as_str())
            || proof.epoch_id != current.epoch_id
            || proof.certificate_body.handoff_authorization != grant
            || current.authority_public_key != readiness.target_authority_public_key
        {
            return Err("staged successor differs from accepted consent".into());
        }
        let enrollment =
            crate::library_core_actor_enrollment::prepare_selected_primary_actor_enrollment_v2(
                &current,
                installation_witness,
                &actor,
                &pending,
                updated as i64,
                &readiness.target_actor_id,
                selected_actor_certificate.as_bytes(),
            )?;
        let selected = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&tx)
            .map_err(|e| e.to_string())?;
        if enrollment.actor_id != readiness.target_actor_id
            || selected.writer_id != readiness.target_actor_id
            || selected.source_revision != grant.body.final_source_revision
            || current.library_id != readiness.library_id
            || current.epoch != proof.certificate_body.target_epoch
            || current.authority_key_id != proof.certificate_body.target_authority_key_id
        {
            return Err("staged successor identity or revision changed".into());
        }
        let value = serde_json::to_value(&proof).map_err(|e| e.to_string())?;
        let result = crate::normalized_writer_certificate::WriterEpochReassignment {
            authority: current,
            canonical_certificate_json: current_certificate,
            transition_certificate_digest: crate::normalized_writer_certificate::digest_value(
                "epoch-transition-certificate",
                &value,
            )?,
        };
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(result);
    }
    if successor.is_some() || staged_at_ms < updated {
        return Err("target staging state or time is invalid".into());
    }
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&tx)
        .map_err(|e| e.to_string())?;
    if snapshot.library_id != readiness.library_id
        || snapshot.authority_epoch != readiness.predecessor_epoch_id
        || snapshot.writer_id != grant.body.source_control.writer_id
        || snapshot.source_revision != grant.body.final_source_revision
        || snapshot.causal_frontier_digest != grant.body.source_control.causal_frontier_digest
        || crate::normalized_import::selected_checkpoint_digest_v2(&tx)
            .map_err(|e| e.to_string())?
            != grant.body.final_checkpoint_digest
    {
        return Err("target staging requires the exact authorized checkpoint".into());
    }
    let prepared =
        crate::normalized_handoff_writer_certificate::prepare_writer_handoff_certificate_v1(
            &current,
            &snapshot.writer_id,
            &certificate,
            &bytes,
            &readiness.target_actor_public_key,
            &pending_key,
        )?;
    let enrollment =
        crate::library_core_actor_enrollment::prepare_selected_primary_actor_enrollment_v2(
            &prepared.authority,
            installation_witness,
            &actor,
            &pending,
            staged_at_ms as i64,
            &readiness.target_actor_id,
            selected_actor_certificate.as_bytes(),
        )?;
    if enrollment.actor_id != readiness.target_actor_id {
        return Err("target staging installation identity changed".into());
    }
    tx.execute(
        "UPDATE library_local_handoff SET phase = 'cas_pending', successor_epoch_id = ?1,
                updated_at = ?2 WHERE singleton_id = 1;",
        rusqlite::params![prepared.authority.epoch_id, staged_at_ms],
    )
    .map_err(|e| e.to_string())?;
    install_prepared_writer_epoch_v2(
        &tx,
        WriterEpochInstallation {
            current: &current,
            prepared: &prepared,
            enrollment: &enrollment,
            snapshot: &snapshot,
            generation: &generation,
            manifest_generation,
            accepted_at: staged_at_ms as i64,
            admission: WriterEpochAdmission::FencedHandoff,
        },
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(prepared)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HandoffActivationProposalV1 {
    pub format: String,
    pub handoff_id: String,
    pub control_file_id: String,
    pub expected_control_revision: String,
    pub successor_checkpoint_digest: String,
    pub control: HandoffSourceControlV1,
}

/// Persist the exact intended cloud head before any conditional update is sent.
/// The cloud locator and manifest are proposals, not evidence of publication.
/// Native activation must independently verify the winning remote objects.
pub fn prepare_target_handoff_activation_v1(
    connection: &mut rusqlite::Connection,
    handoff_id: &str,
    control_file_id: &str,
    canonical_control: &[u8],
    prepared_at_ms: u64,
) -> Result<String, String> {
    if !connection.is_autocommit()
        || prepared_at_ms > MAX_SAFE_INTEGER
        || !is_lower_sha256(handoff_id)
        || control_file_id.is_empty()
        || control_file_id.len() > 1024
        || !control_file_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("handoff activation proposal input is invalid".into());
    }
    let control: HandoffSourceControlV1 = serde_json::from_value(
        decode_canonical_value(canonical_control, MAX_BYTES)
            .map_err(|_| "activation control is not bounded canonical data")?
            .into_value(),
    )
    .map_err(|_| "activation control shape is invalid")?;
    if canonical_handoff_bytes(&control)? != canonical_control {
        return Err("activation control bytes are not canonical".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if synchronous < 2 {
        return Err("activation proposal requires full SQLite durability".into());
    }
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
    verify_staged_handoff_export_v1(&tx, handoff_id)?;
    require_handoff_control_file_v1(&tx, control_file_id)?;
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&tx)
        .map_err(|e| e.to_string())?;
    let (stored, revision, updated): (Option<Vec<u8>>, String, u64) = tx
        .query_row(
            "SELECT canonical_activation, expected_control_revision, updated_at
         FROM library_local_handoff WHERE singleton_id = 1;",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    validate_handoff_activation_control_v1(&control, &snapshot)?;
    let proposal = HandoffActivationProposalV1 {
        format: "freed_library_handoff_activation_proposal_v1".into(),
        handoff_id: handoff_id.into(),
        control_file_id: control_file_id.into(),
        expected_control_revision: revision,
        successor_checkpoint_digest: crate::normalized_import::selected_checkpoint_digest_v2(&tx)
            .map_err(|e| e.to_string())?,
        control,
    };
    let bytes = canonical_handoff_bytes(&proposal)?;
    if let Some(stored) = stored {
        if stored != bytes {
            return Err("committed activation proposal cannot be replaced".into());
        }
    } else {
        if prepared_at_ms < updated {
            return Err("activation proposal time precedes staging".into());
        }
        tx.execute(
            "UPDATE library_local_handoff SET canonical_activation = ?1, updated_at = ?2
                    WHERE singleton_id = 1;",
            rusqlite::params![bytes, prepared_at_ms],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "activation proposal encoding is invalid".into())
}

pub(crate) fn require_handoff_control_file_v1(
    connection: &rusqlite::Connection,
    file_id: &str,
) -> Result<(), String> {
    let bytes: Vec<u8> = connection
        .query_row(
            "SELECT canonical_authorization FROM library_local_handoff WHERE singleton_id = 1;",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let grant: HandoffAuthorizationV1 = serde_json::from_value(
        decode_canonical_value(&bytes, MAX_BYTES)
            .map_err(|_| "handoff consent encoding is invalid")?
            .into_value(),
    )
    .map_err(|_| "handoff consent shape is invalid")?;
    if grant.body.source_control_file_id != file_id {
        return Err("control file differs from predecessor authorization".into());
    }
    Ok(())
}

pub(crate) fn validate_handoff_activation_control_v1(
    control: &HandoffSourceControlV1,
    snapshot: &crate::normalized_sqlite::NormalizedCheckpointExportDescriptorV2,
) -> Result<(), String> {
    if control.generation != 0 {
        return Err("target activation requires generation zero".into());
    }
    validate_handoff_consumer_control_v1(control, snapshot)
}

pub(crate) fn validate_handoff_consumer_control_v1(
    control: &HandoffSourceControlV1,
    snapshot: &crate::normalized_sqlite::NormalizedCheckpointExportDescriptorV2,
) -> Result<(), String> {
    let descriptor = &control.manifest.descriptor;
    if control.schema_version != 1
        || control.protocol_version != 1
        || control.library_id != snapshot.library_id
        || control.storage_epoch != snapshot.authority_epoch
        || control.writer_id != snapshot.writer_id
        || control.generation > MAX_SAFE_INTEGER
        || !is_lower_sha256(&control.causal_frontier_digest)
        || control.active_transport != "google_drive_app_data_v1"
        || control.causal_frontier_digest != snapshot.causal_frontier_digest
        || !is_lower_sha256(&descriptor.content_digest)
        || descriptor.object_key
            != format!(
                "freed-v2-manifest~{}~e{}~g{}~{}.json",
                control.library_id,
                control.storage_epoch,
                control.generation,
                descriptor.content_digest
            )
        || descriptor.byte_length == 0
        || descriptor.byte_length > MAX_SAFE_INTEGER
        || control.manifest.transport_object_id.is_empty()
        || control.manifest.transport_object_id.len() > 1024
    {
        return Err("activation proposal does not match the staged successor".into());
    }
    Ok(())
}

/// Permit read-only export of an already staged successor. The signed proof,
/// persisted consent and selected canonical epoch must describe one transfer.
pub(crate) fn verify_staged_handoff_export_v1(
    connection: &rusqlite::Connection,
    handoff_id: &str,
) -> Result<(), String> {
    let (certificate, authorization, body, readiness, revision): (
        String,
        Vec<u8>,
        Vec<u8>,
        Vec<u8>,
        String,
    ) = connection
        .query_row(
            "SELECT epoch.canonical_transition_certificate, handoff.canonical_authorization,
                handoff.canonical_authorization_body, handoff.canonical_readiness,
                handoff.expected_control_revision
         FROM library_local_handoff AS handoff
         JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = handoff.library_id
          AND meta.authority_epoch = handoff.successor_epoch_id
         JOIN library_active_authority AS active ON active.active_key = 'active'
          AND active.library_id = meta.library_id AND active.epoch_id = meta.authority_epoch
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
          AND epoch.library_id = handoff.library_id
          AND epoch.authority_public_key = handoff.target_authority_public_key
         JOIN library_actors AS actor ON actor.actor_id = handoff.target_writer_id
          AND actor.authority_epoch_id = epoch.epoch_id AND actor.actor_kind = 'desktop'
          AND actor.retired_at IS NULL
         WHERE handoff.singleton_id = 1 AND handoff.handoff_id = ?1
          AND handoff.installation_role = 'target' AND handoff.phase = 'cas_pending'
          AND NOT EXISTS(SELECT 1 FROM library_writer_admission)
          AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);",
            [handoff_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "handoff export requires this fenced successor")?;
    let proof: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
        serde_json::from_value(
            decode_canonical_value(certificate.as_bytes(), MAX_BYTES)
                .map_err(|_| "handoff export certificate is invalid")?
                .into_value(),
        )
        .map_err(|_| "handoff export certificate shape is invalid")?;
    let grant = &proof.certificate_body.handoff_authorization;
    let ready = &grant.body.readiness;
    if canonical_handoff_bytes(&proof)? != certificate.as_bytes()
        || canonical_handoff_bytes(grant)? != authorization
        || canonical_handoff_bytes(&grant.body)? != body
        || canonical_handoff_bytes(ready)? != readiness
        || ready.handoff_id != handoff_id
        || grant.body.source_control_revision != revision
    {
        return Err("handoff export consent records disagree".into());
    }
    let exact: bool = connection
        .query_row(
            "SELECT predecessor_epoch_id = ?1 AND successor_epoch_id = ?2
          AND target_writer_id = ?3 AND target_authority_public_key = ?4
          AND EXISTS(SELECT 1 FROM library_authority_epochs WHERE epoch_id = ?2
           AND epoch_number = ?5 AND authority_key_id = ?6 AND transition_certificate_digest = ?7)
         FROM library_local_handoff WHERE singleton_id = 1;",
            rusqlite::params![
                ready.body.predecessor_epoch_id,
                proof.epoch_id,
                ready.body.target_actor_id,
                ready.body.target_authority_public_key,
                proof.certificate_body.target_epoch,
                proof.certificate_body.target_authority_key_id,
                crate::normalized_writer_certificate::digest_value(
                    "epoch-transition-certificate",
                    &serde_json::to_value(&proof).map_err(|e| e.to_string())?
                )?
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exact {
        return Err("handoff export identity differs from consent".into());
    }
    let (epoch, digest, public): (u64, String, String) = connection
        .query_row(
            "SELECT epoch_number, transition_certificate_digest, authority_public_key
         FROM library_authority_epochs WHERE epoch_id = ?1 AND library_id = ?2;",
            rusqlite::params![ready.body.predecessor_epoch_id, ready.body.library_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "handoff export predecessor is unavailable")?;
    crate::normalized_handoff_writer_certificate::verify_writer_handoff_certificate_v1(
        &proof,
        &HandoffPredecessorV1 {
            library_id: &ready.body.library_id,
            epoch_id: &ready.body.predecessor_epoch_id,
            epoch,
            certificate_digest: &digest,
            authority_public_key: &public,
            writer_id: &grant.body.source_control.writer_id,
        },
        &ready.body.target_actor_public_key,
    )?;
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(connection)
        .map_err(|e| e.to_string())?;
    if snapshot.library_id != ready.body.library_id
        || snapshot.authority_epoch != proof.epoch_id
        || snapshot.writer_id != ready.body.target_actor_id
        || snapshot.source_revision != grant.body.final_source_revision
    {
        return Err("handoff export successor identity or revision changed".into());
    }
    Ok(())
}

/// Check the imported logical digest before its transaction commits. A handoff
/// target may install only the checkpoint named by its accepted predecessor.
pub(crate) fn verify_handoff_checkpoint_install_v1(
    connection: &rusqlite::Connection,
    checkpoint_digest: &str,
    receipt: Option<&crate::normalized_import::NormalizedFollowerCheckpointReceiptV2>,
) -> Result<(), String> {
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version == 1 {
        return Ok(());
    }
    if version != 2 {
        return Err("handoff checkpoint storage is unsupported".into());
    }
    verify_existing_handoff_checkpoint_install_v1(connection, checkpoint_digest, receipt)
}

/// Version admission belongs to the platform adapter; lifecycle proof remains shared.
pub(crate) fn verify_existing_handoff_checkpoint_install_v1(
    connection: &rusqlite::Connection,
    checkpoint_digest: &str,
    receipt: Option<&crate::normalized_import::NormalizedFollowerCheckpointReceiptV2>,
) -> Result<(), String> {
    // Installing the local catalog does not start a transfer. Ordinary
    // checkpoint verification owns admission when no lifecycle fence exists.
    let has_handoff: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_handoff);",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !has_handoff {
        return Ok(());
    }
    let cancelled_target: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'target' AND phase = 'cancelled');",
        [], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if cancelled_target {
        if receipt.is_none() {
            return Err("canceled target checkpoint requires a consumer receipt".into());
        }
        crate::normalized_handoff_cancellation::verify_cancelled_target_history_v1(connection)?;
        return Ok(());
    }
    if crate::normalized_consumer_recovery::verify_completed_consumer_successor_checkpoint(
        connection, receipt,
    )? {
        return Ok(());
    }
    let demoted_source: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id=1 AND installation_role='source' AND phase='demoted');",
        [], |r|r.get(0),
    ).map_err(|e|e.to_string())?;
    if demoted_source {
        if receipt.is_none() {
            return Err("source adoption requires a follower receipt".into());
        }
        return crate::normalized_source_handoff::verify_demoted_source_selection(connection);
    }
    let consumer: Option<(String, Vec<u8>)> = connection.query_row(
        "SELECT epoch.canonical_transition_certificate, handoff.canonical_authorization
         FROM library_local_handoff AS handoff JOIN library_meta AS meta
           ON meta.singleton_id = 1 AND meta.library_id = handoff.library_id AND meta.authority_epoch = handoff.successor_epoch_id
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = meta.authority_epoch
         WHERE handoff.singleton_id = 1 AND ((handoff.installation_role = 'consumer' AND handoff.phase IN ('recovery', 'following'))
           OR (handoff.installation_role = 'source' AND handoff.phase = 'demoted'));",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional().map_err(|e| e.to_string())?;
    if let Some((certificate, authorization)) = consumer {
        if receipt.is_none() {
            return Err("consumer recovery import requires a follower receipt".into());
        }
        let certificate: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
            serde_json::from_str(&certificate)
                .map_err(|_| "consumer recovery successor proof is invalid")?;
        if canonical_handoff_bytes(&certificate.certificate_body.handoff_authorization)?
            != authorization
        {
            return Err("consumer recovery successor consent changed".into());
        }
        return Ok(());
    }
    let (bytes, body, readiness, handoff_id): (Vec<u8>, Vec<u8>, Vec<u8>, String) = connection.query_row(
        "SELECT canonical_authorization, canonical_authorization_body, canonical_readiness, handoff_id
         FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'target'
          AND phase = 'preparing' AND successor_epoch_id IS NULL AND canonical_activation IS NULL;",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|_| "checkpoint replacement requires accepted target handoff consent")?;
    let decoded =
        decode_canonical_value(&bytes, MAX_BYTES).map_err(|_| "handoff consent is invalid")?;
    let grant: HandoffAuthorizationV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "handoff consent shape is invalid")?;
    if canonical_handoff_bytes(&grant)? != bytes
        || canonical_handoff_bytes(&grant.body)? != body
        || canonical_handoff_bytes(&grant.body.readiness)? != readiness
        || grant.body.readiness.handoff_id != handoff_id
    {
        return Err("handoff checkpoint consent records disagree".into());
    }
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(connection)
        .map_err(|error| error.to_string())?;
    let (epoch, certificate, public_key): (u64, String, String) = connection
        .query_row(
            "SELECT epoch_number, transition_certificate_digest, authority_public_key
         FROM library_authority_epochs WHERE epoch_id = ?1 AND library_id = ?2;",
            rusqlite::params![snapshot.authority_epoch, snapshot.library_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "handoff checkpoint predecessor is missing")?;
    verify_handoff_authorization_v1(
        &grant,
        &HandoffPredecessorV1 {
            library_id: &snapshot.library_id,
            epoch_id: &snapshot.authority_epoch,
            epoch,
            certificate_digest: &certificate,
            authority_public_key: &public_key,
            writer_id: &snapshot.writer_id,
        },
        &grant.body.readiness.body.target_actor_public_key,
    )?;
    let receipt = receipt.ok_or("handoff checkpoint requires a consumer import receipt")?;
    let control = &grant.body.source_control;
    if snapshot.source_revision != grant.body.final_source_revision
        || snapshot.causal_frontier_digest != control.causal_frontier_digest
        || checkpoint_digest != grant.body.final_checkpoint_digest
        || receipt.checkpoint_generation != control.generation
        || receipt.writer_actor_id != control.writer_id
        || receipt.control_revision != grant.body.source_control_revision
        || receipt.manifest_object_key != control.manifest.descriptor.object_key
        || receipt.manifest_content_digest != control.manifest.descriptor.content_digest
        || receipt.manifest_transport_object_id != control.manifest.transport_object_id
    {
        return Err("imported checkpoint does not match signed handoff consent".into());
    }
    Ok(())
}

/// Prepare only an enrolled, settled consumer. The supplied authority store
/// must be the installation's separate handoff vault, never its current vault.
/// Retrying a committed preparation requires both established keys and returns
/// the original bytes, including the original creation time.
pub fn prepare_target_handoff_readiness_v1(
    connection: &mut rusqlite::Connection,
    actor_store: &dyn crate::library_core_actor_enrollment::ActorKeyStore,
    pending_authority_store: &dyn crate::normalized_authority_credentials::AuthorityKeyStore,
    created_at_ms: u64,
) -> Result<String, String> {
    if created_at_ms > MAX_SAFE_INTEGER || !connection.is_autocommit() {
        return Err("handoff readiness time or transaction is invalid".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if synchronous < 2 {
        return Err("handoff readiness requires full SQLite durability".into());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let version: u32 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if ![1, 2].contains(&version) {
        return Err("handoff readiness requires an existing Library".into());
    }
    crate::normalized_sqlite::install_normalized_schema_v1(&transaction)
        .map_err(|error| error.to_string())?;
    let unavailable: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_writer_admission)
             OR EXISTS(SELECT 1 FROM library_intent_transactions WHERE state IN ('pending', 'published'))
             OR EXISTS(SELECT 1 FROM library_optimistic_fields);",
        [], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if unavailable {
        return Err("handoff target must be a consumer with all edits settled".into());
    }
    let (library, epoch_id, epoch, certificate, old_public, writer, actor_id, actor_public): (
        String,
        String,
        u64,
        String,
        String,
        String,
        String,
        String,
    ) = transaction
        .query_row(
            "SELECT meta.library_id, meta.authority_epoch, epoch.epoch_number,
                epoch.transition_certificate_digest, epoch.authority_public_key,
                receipt.writer_actor_id, actor.actor_id, actor.public_key
         FROM library_meta AS meta
         JOIN library_active_authority AS active ON active.active_key = 'active'
           AND active.library_id = meta.library_id AND active.epoch_id = meta.authority_epoch
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1
           AND receipt.library_id = meta.library_id AND receipt.authority_epoch_id = active.epoch_id
         JOIN library_follower_actor_request AS request ON request.singleton_id = 1
           AND request.library_id = meta.library_id AND request.authority_epoch_id = active.epoch_id
           AND request.enrollment_certificate_digest IS NOT NULL
         JOIN library_actors AS actor ON actor.actor_id = request.actor_id
           AND actor.authority_epoch_id = active.epoch_id AND actor.actor_kind = 'pwa'
           AND actor.public_key = request.actor_public_key AND actor.retired_at IS NULL
           AND actor.enrollment_certificate_digest = request.enrollment_certificate_digest
         JOIN library_intent_actors AS intent ON intent.actor_id = actor.actor_id
         WHERE meta.singleton_id = 1;",
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
                    row.get(7)?,
                ))
            },
        )
        .map_err(|_| "handoff target has no accepted local consumer enrollment")?;
    let actor_key =
        crate::library_core_actor_enrollment::load_actor_key_pair(actor_store, &library)?;
    if lower_hex(actor_key.public_key().as_ref()) != actor_public {
        return Err("handoff target actor key does not match enrollment".into());
    }
    let predecessor = HandoffPredecessorV1 {
        library_id: &library,
        epoch_id: &epoch_id,
        epoch,
        certificate_digest: &certificate,
        authority_public_key: &old_public,
        writer_id: &writer,
    };
    let replace_cancelled = if version == 2 {
        let cancelled: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'target' AND phase = 'cancelled');",
            [], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if cancelled {
            crate::normalized_handoff_cancellation::require_cancelled_target_admission_v1(
                &transaction,
            )?;
            let updated_at: u64 = transaction
                .query_row(
                    "SELECT updated_at FROM library_local_handoff WHERE singleton_id = 1;",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if created_at_ms <= updated_at {
                return Err("new target readiness requires a later local creation time".into());
            }
        }
        cancelled
    } else {
        false
    };
    let replace_recovered = if version == 2 {
        let following: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'consumer' AND phase = 'following');",
            [], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if following {
            crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&transaction)
                .map_err(|e| e.to_string())?;
            let recovery = crate::read_consumer_recovery_summary_v1(&transaction)?
                .ok_or("recovered target is missing its committed recovery receipt")?;
            if recovery.state != "following"
                || recovery.library_id != library
                || recovery.successor_epoch_id != epoch_id
            {
                return Err("recovered target does not match the selected consumer".into());
            }
            let updated_at: u64 = transaction
                .query_row(
                    "SELECT updated_at FROM library_local_handoff WHERE singleton_id = 1;",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if created_at_ms <= updated_at {
                return Err("new target readiness requires a later local creation time".into());
            }
        }
        following
    } else {
        false
    };
    let replace_demoted = if version == 2 {
        let demoted: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'demoted');",
            [], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if demoted {
            crate::normalized_source_handoff::retain_demoted_source_for_return(
                &transaction,
                created_at_ms,
            )?;
        }
        demoted
    } else {
        false
    };
    let bytes = if version == 2 && !replace_cancelled && !replace_recovered && !replace_demoted {
        let (bytes, id, key): (Vec<u8>, String, String) = transaction
            .query_row(
                "SELECT canonical_readiness, handoff_id, target_authority_public_key
             FROM library_local_handoff WHERE singleton_id = 1
               AND installation_role = 'target' AND phase = 'preparing'
               AND library_id = ?1 AND predecessor_epoch_id = ?2 AND target_writer_id = ?3;",
                rusqlite::params![library, epoch_id, actor_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| "handoff target already has another persisted lifecycle")?;
        let decoded = decode_canonical_value(&bytes, MAX_BYTES)
            .map_err(|_| "stored handoff readiness is not bounded canonical data")?;
        let readiness: HandoffReadinessV1 = serde_json::from_value(decoded.into_value())
            .map_err(|_| "stored handoff readiness has an unsupported shape")?;
        verify_handoff_readiness_v1(&readiness, &predecessor, &actor_public)?;
        let pending_key =
            crate::normalized_authority_credentials::load_established_authority_key_pair(
                pending_authority_store,
                &library,
            )?;
        if readiness.handoff_id != id
            || readiness.body.target_actor_id != actor_id
            || readiness.body.target_authority_public_key != key
            || lower_hex(pending_key.public_key().as_ref()) != key
        {
            return Err("stored handoff readiness or authority key changed".into());
        }
        bytes
    } else {
        let key = if replace_cancelled {
            let key = crate::normalized_authority_credentials::load_established_authority_key_pair(
                pending_authority_store,
                &library,
            )?;
            let retained: String = transaction.query_row("SELECT target_authority_public_key FROM library_local_handoff WHERE singleton_id = 1;", [], |row| row.get(0)).map_err(|e| e.to_string())?;
            if lower_hex(key.public_key().as_ref()) != retained {
                return Err("canceled target authority key changed".into());
            }
            transaction
                .execute(
                    "DELETE FROM library_local_handoff WHERE singleton_id = 1;",
                    [],
                )
                .map_err(|e| e.to_string())?;
            key
        } else {
            crate::normalized_authority_credentials::load_or_create_authority_key_pair(
                pending_authority_store,
                &library,
            )?
        };
        if replace_demoted {
            transaction.execute("DELETE FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'demoted';", []).map_err(|e| e.to_string())?;
        }
        if replace_recovered {
            transaction.execute(
                "DELETE FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'consumer' AND phase = 'following';", [],
            ).map_err(|e| e.to_string())?;
        }
        let readiness = sign_handoff_readiness_v1(
            HandoffReadinessBodyV1 {
                format: READY_FORMAT.into(),
                library_id: library.clone(),
                predecessor_epoch_id: epoch_id.clone(),
                predecessor_certificate_digest: certificate,
                target_actor_id: actor_id.clone(),
                target_actor_public_key: actor_public,
                target_authority_public_key: lower_hex(key.public_key().as_ref()),
                native_storage_version: 2,
                checkpoint_schema_version: 1,
                replication_protocol_version: 2,
                created_at_ms,
            },
            &actor_key,
            &key,
        )?;
        if version == 2 {
            let retired: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM library_local_handoff_cancellations WHERE handoff_id = ?1);", [&readiness.handoff_id], |row| row.get(0)).map_err(|e| e.to_string())?;
            if retired {
                return Err("new readiness reuses a canceled transfer identity".into());
            }
        }
        let bytes = canonical_handoff_bytes(&readiness)?;
        crate::normalized_sqlite::migrate_native_handoff_schema_v2(&transaction)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO library_local_handoff
            (singleton_id, handoff_id, library_id, installation_role, phase,
             predecessor_epoch_id, target_writer_id, target_authority_public_key,
             canonical_readiness, created_at, updated_at)
            VALUES (1, ?1, ?2, 'target', 'preparing', ?3, ?4, ?5, ?6, ?7, ?7);",
                rusqlite::params![
                    readiness.handoff_id,
                    library,
                    epoch_id,
                    actor_id,
                    readiness.body.target_authority_public_key,
                    bytes,
                    created_at_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        bytes
    };
    transaction.commit().map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|_| "handoff readiness encoding is invalid".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handoff_requires_enrolled_target_and_pinned_predecessor_signatures() {
        let actor = Ed25519KeyPair::from_seed_unchecked(&[31; 32]).unwrap();
        let target = Ed25519KeyPair::from_seed_unchecked(&[32; 32]).unwrap();
        let old = Ed25519KeyPair::from_seed_unchecked(&[33; 32]).unwrap();
        let actor_public = lower_hex(actor.public_key().as_ref());
        let target_public = lower_hex(target.public_key().as_ref());
        let old_public = lower_hex(old.public_key().as_ref());
        let library = "a".repeat(64);
        let epoch = "b".repeat(64);
        let certificate = "c".repeat(64);
        let writer = "d".repeat(64);
        let predecessor = HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &epoch,
            epoch: 7,
            certificate_digest: &certificate,
            authority_public_key: &old_public,
            writer_id: &writer,
        };
        let readiness_body = HandoffReadinessBodyV1 {
            format: READY_FORMAT.into(),
            library_id: library.clone(),
            predecessor_epoch_id: epoch.clone(),
            predecessor_certificate_digest: certificate.clone(),
            target_actor_id: "e".repeat(64),
            target_actor_public_key: actor_public.clone(),
            target_authority_public_key: target_public.clone(),
            native_storage_version: 2,
            checkpoint_schema_version: 1,
            replication_protocol_version: 2,
            created_at_ms: 100,
        };
        let readiness = sign_handoff_readiness_v1(readiness_body.clone(), &actor, &target).unwrap();
        verify_handoff_readiness_v1(&readiness, &predecessor, &actor_public).unwrap();
        assert_eq!(
            readiness,
            sign_handoff_readiness_v1(readiness_body, &actor, &target).unwrap()
        );
        assert!(verify_handoff_readiness_v1(&readiness, &predecessor, &target_public).is_err());
        let mut substituted = readiness.clone();
        substituted.actor_signature = substituted.authority_possession_signature.clone();
        assert!(verify_handoff_readiness_v1(&substituted, &predecessor, &actor_public).is_err());
        substituted = readiness.clone();
        substituted.body.target_authority_public_key = old_public.clone();
        assert!(verify_handoff_readiness_v1(&substituted, &predecessor, &actor_public).is_err());

        let content = "f".repeat(64);
        let body = HandoffAuthorizationBodyV1 {
            format: GRANT_FORMAT.into(),
            readiness,
            predecessor_authority_public_key: old_public.clone(),
            successor_epoch: 8,
            final_source_revision: 42,
            final_checkpoint_digest: "8".repeat(64),
            source_control: HandoffSourceControlV1 {
                schema_version: 1,
                protocol_version: 1,
                library_id: library.clone(),
                storage_epoch: epoch.clone(),
                writer_id: writer.clone(),
                active_transport: "google_drive_app_data_v1".into(),
                generation: 9,
                causal_frontier_digest: "1".repeat(64),
                manifest: HandoffObjectReferenceV1 {
                    descriptor: HandoffObjectDescriptorV1 {
                        object_key: format!(
                            "freed-v2-manifest~{library}~e{epoch}~g9~{content}.json"
                        ),
                        content_digest: content,
                        byte_length: 1200,
                    },
                    transport_object_id: "manifest-object".into(),
                },
            },
            source_control_revision: "\"exact-etag\"".into(),
            source_control_file_id: "control-file".into(),
        };
        assert!(
            sign_handoff_authorization_v1(body.clone(), &predecessor, &actor_public, &target)
                .is_err()
        );
        let grant =
            sign_handoff_authorization_v1(body.clone(), &predecessor, &actor_public, &old).unwrap();
        verify_handoff_authorization_v1(&grant, &predecessor, &actor_public).unwrap();
        assert_eq!(
            grant,
            sign_handoff_authorization_v1(body, &predecessor, &actor_public, &old).unwrap()
        );

        // Recomputing an unsigned digest cannot authorize a changed frontier,
        // cloud comparison token, final revision, or successor epoch.
        for field in 0..4 {
            let mut changed = grant.clone();
            match field {
                0 => changed.body.source_control.causal_frontier_digest = "2".repeat(64),
                1 => changed.body.source_control_revision = "\"different-etag\"".into(),
                2 => changed.body.final_source_revision += 1,
                _ => changed.body.successor_epoch += 1,
            }
            changed.authorization_digest =
                digest("handoff-authorization-body", &changed.body).unwrap();
            assert!(
                verify_handoff_authorization_v1(&changed, &predecessor, &actor_public).is_err()
            );
        }
        let mut self_signed = grant.clone();
        self_signed.predecessor_signature = lower_hex(
            target
                .sign(
                    &signature_input(
                        "handoff-predecessor-authorization",
                        &self_signed.authorization_digest,
                    )
                    .unwrap(),
                )
                .as_ref(),
        );
        assert!(
            verify_handoff_authorization_v1(&self_signed, &predecessor, &actor_public).is_err()
        );
        // Successor certificates bind both grants: the predecessor's consent
        // and possession of the target key. Neither helper activates a writer.
        let current = crate::normalized_authority::NormalizedAuthorityStateV2 {
            library_id: library.clone(),
            epoch: predecessor.epoch as i64,
            epoch_id: epoch.clone(),
            authority_key_id: "0".repeat(64),
            authority_public_key: old_public.clone(),
            observed_frontier: Vec::new(),
        };
        let prepared =
            crate::normalized_handoff_writer_certificate::prepare_writer_handoff_certificate_v1(
                &current,
                &writer,
                &certificate,
                &canonical_handoff_bytes(&grant).unwrap(),
                &actor_public,
                &target,
            )
            .unwrap();
        assert_eq!(prepared.authority.epoch, current.epoch + 1);
        assert_eq!(prepared.authority.authority_public_key, target_public);
        assert_ne!(
            prepared.authority.epoch_id,
            prepared.transition_certificate_digest
        );
        let successor: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
            serde_json::from_str(&prepared.canonical_certificate_json).unwrap();
        crate::normalized_handoff_writer_certificate::verify_writer_handoff_certificate_v1(
            &successor,
            &predecessor,
            &actor_public,
        )
        .unwrap();
        assert!(
            serde_json::from_str::<
                crate::normalized_writer_certificate::WriterEpochReassignmentCertificateV1,
            >(&prepared.canonical_certificate_json,)
            .is_err(),
            "the predecessor format must not silently accept cooperative certificates"
        );
        assert_eq!(
            crate::normalized_handoff_writer_certificate::prepare_writer_handoff_certificate_v1(
                &current,
                &writer,
                &certificate,
                &canonical_handoff_bytes(&grant).unwrap(),
                &actor_public,
                &target,
            )
            .unwrap(),
            prepared
        );
        assert!(
            crate::normalized_handoff_writer_certificate::prepare_writer_handoff_certificate_v1(
                &current,
                &writer,
                &certificate,
                &canonical_handoff_bytes(&grant).unwrap(),
                &actor_public,
                &old,
            )
            .is_err()
        );
        assert!(
            crate::normalized_handoff_writer_certificate::prepare_writer_handoff_certificate_v1(
                &current,
                &writer,
                &certificate,
                &canonical_handoff_bytes(&self_signed).unwrap(),
                &actor_public,
                &target,
            )
            .is_err(),
            "target possession must not substitute for predecessor consent"
        );
        let mut changed_successor = successor.clone();
        changed_successor.certificate_body.target_writer_id = "0".repeat(64);
        assert!(
            crate::normalized_handoff_writer_certificate::verify_writer_handoff_certificate_v1(
                &changed_successor,
                &predecessor,
                &actor_public,
            )
            .is_err()
        );
        changed_successor = successor;
        changed_successor.authority_key_possession_signature = "0".repeat(128);
        assert!(
            crate::normalized_handoff_writer_certificate::verify_writer_handoff_certificate_v1(
                &changed_successor,
                &predecessor,
                &actor_public,
            )
            .is_err()
        );
        // Exercise the production signing boundary with a real file-backed
        // normalized database. The fence is committed separately from signing.
        use crate::normalized_sqlite::{
            migrate_native_handoff_schema_v2, open_normalized_sqlite_database_v1,
        };
        use rusqlite::params;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("handoff.sqlite");
        let mut database = open_normalized_sqlite_database_v1(&path, true).unwrap();
        database
            .execute(
                "INSERT INTO library_meta VALUES (1, ?1, 1, ?2, 42, 1);",
                params![library, epoch],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_authority_epochs VALUES
            (?1, ?2, 7, ?3, ?4, ?5, '{}', 9, ?3, ?3, 1);",
                params![epoch, library, "0".repeat(64), old_public, certificate],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_active_authority VALUES ('active', ?1, ?2, 'primary:desktop', 9, 1);",
                params![library, epoch],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_actors VALUES
            (?1, ?2, 'pwa', ?3, 'enrollment', ?4, '{}', ?4, 0, NULL, ?4, NULL, 1, 1);",
                params![
                    grant.body.readiness.body.target_actor_id,
                    epoch,
                    actor_public,
                    "0".repeat(64)
                ],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_actors VALUES
            (?1, ?2, 'desktop', ?3, 'primary-enrollment', ?4, '{}', ?4, 0, NULL, ?4, NULL, 1, 1);",
                params![writer, epoch, old_public, "0".repeat(64)],
            )
            .unwrap();
        let mut sealed_body = grant.body.clone();
        sealed_body.source_control.causal_frontier_digest =
            crate::normalized_sqlite::checkpoint_frontier_digest_v2(&database, &epoch).unwrap();
        sealed_body.final_checkpoint_digest = {
            let transaction = database.transaction().unwrap();
            let digest =
                crate::normalized_import::selected_checkpoint_digest_v2(&transaction).unwrap();
            transaction.commit().unwrap();
            digest
        };
        let grant =
            sign_handoff_authorization_v1(sealed_body, &predecessor, &actor_public, &old).unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old).is_err());
        let transaction = database.transaction().unwrap();
        migrate_native_handoff_schema_v2(&transaction).unwrap();
        transaction
            .execute(
                "INSERT INTO library_local_handoff
            (singleton_id, handoff_id, library_id, installation_role, phase,
             predecessor_epoch_id, target_writer_id, target_authority_public_key,
             canonical_readiness, canonical_authorization_body, expected_control_revision,
             created_at, updated_at)
            VALUES (1, ?1, ?2, 'source', 'authorized', ?3, ?4, ?5, ?6, ?7, ?8, 1, 1);",
                params![
                    grant.body.readiness.handoff_id,
                    library,
                    epoch,
                    grant.body.readiness.body.target_actor_id,
                    target_public,
                    canonical_handoff_bytes(&grant.body.readiness).unwrap(),
                    canonical_handoff_bytes(&grant.body).unwrap(),
                    grant.body.source_control_revision
                ],
            )
            .unwrap();
        transaction.commit().unwrap();
        database
            .pragma_update(None, "synchronous", "NORMAL")
            .unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old)
            .unwrap_err()
            .contains("full SQLite durability"));
        database.pragma_update(None, "synchronous", "FULL").unwrap();
        database.execute_batch("BEGIN IMMEDIATE;").unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old)
            .unwrap_err()
            .contains("commit before signing"));
        database.execute_batch("ROLLBACK;").unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &target).is_err());
        database
            .execute_batch(
                "CREATE TEMP TRIGGER reject_handoff_receipt
            BEFORE UPDATE OF canonical_authorization ON library_local_handoff
            BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;",
            )
            .unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old).is_err());
        let fenced: bool = database
            .query_row(
                "SELECT phase = 'authorized' AND canonical_authorization IS NULL
            FROM library_local_handoff;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(fenced);
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert_eq!(
            sign_persisted_handoff_authorization_v1(&mut database, &old).unwrap(),
            grant
        );
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert_eq!(
            sign_persisted_handoff_authorization_v1(&mut database, &old).unwrap(),
            grant
        );
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &target).is_err());
        database
            .execute(
                "UPDATE library_local_handoff SET canonical_authorization = ?1;",
                [b"{}".as_slice()],
            )
            .unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old).is_err());
        database
            .execute(
                "UPDATE library_local_handoff SET canonical_authorization = ?1;",
                [canonical_handoff_bytes(&grant).unwrap()],
            )
            .unwrap();
        database
            .execute(
                "UPDATE library_actors SET retired_at = 2 WHERE actor_id = ?1;",
                [&grant.body.readiness.body.target_actor_id],
            )
            .unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old).is_err());
        database
            .execute(
                "UPDATE library_actors SET retired_at = NULL WHERE actor_id = ?1;",
                [&grant.body.readiness.body.target_actor_id],
            )
            .unwrap();
        database
            .execute(
                "UPDATE library_local_handoff SET canonical_authorization_body = ?1;",
                [b"{\"format\":\"one\",\"format\":\"two\"}".as_slice()],
            )
            .unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old)
            .unwrap_err()
            .contains("canonical data"));
        database
            .execute(
                "UPDATE library_local_handoff SET canonical_authorization_body = ?1;",
                [canonical_handoff_bytes(&grant.body).unwrap()],
            )
            .unwrap();
        database
            .execute("UPDATE library_meta SET source_revision = 43;", [])
            .unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old).is_err());
        database
            .execute("UPDATE library_meta SET source_revision = 42;", [])
            .unwrap();
        database
            .execute("UPDATE library_local_handoff SET phase = 'sealed';", [])
            .unwrap();
        assert!(sign_persisted_handoff_authorization_v1(&mut database, &old).is_err());

        let wrong_pin = HandoffPredecessorV1 {
            authority_public_key: &target_public,
            ..predecessor
        };
        assert!(verify_handoff_authorization_v1(&grant, &wrong_pin, &actor_public).is_err());
        for revision in ["W/\"weak\"", "\"inner\"quote\"", "\"line\nfeed\""] {
            let mut invalid = grant.body.clone();
            invalid.source_control_revision = revision.into();
            assert!(
                sign_handoff_authorization_v1(invalid, &predecessor, &actor_public, &old).is_err()
            );
        }
        let mut unsupported = grant.body.clone();
        unsupported.readiness.body.native_storage_version = 1;
        assert!(
            sign_handoff_authorization_v1(unsupported, &predecessor, &actor_public, &old).is_err()
        );
        let mut unknown = value(&grant).unwrap();
        unknown["body"]["allow_unilateral_transfer"] = json!(true);
        assert!(serde_json::from_value::<HandoffAuthorizationV1>(unknown).is_err());
        assert!(canonical_handoff_bytes(&"x".repeat(MAX_BYTES)).is_err());
    }

    #[test]
    fn target_readiness_survives_restart_without_replacing_keys_or_pending_edits() {
        run_target_readiness_lifecycle(false, false);
        run_target_readiness_lifecycle(true, false);
        run_target_readiness_lifecycle(false, true);
    }

    fn exported_transport(
        database: &rusqlite::Connection,
        successor_control: &mut HandoffSourceControlV1,
    ) -> (Vec<u8>, Vec<Vec<u8>>) {
        let selected =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(database).unwrap();
        successor_control.storage_epoch = selected.authority_epoch.clone();
        successor_control.writer_id = selected.writer_id.clone();
        successor_control.causal_frontier_digest = selected.causal_frontier_digest.clone();
        use sha2::{Digest, Sha256};
        use std::io::Write;
        let hash = |bytes: &[u8]| lower_hex(&Sha256::digest(bytes));
        let mut request = crate::normalized_sqlite::NormalizedCheckpointExportRequestV2 {
            maximum_records: 3,
            ..Default::default()
        };
        let mut compressed_pages = Vec::new();
        let mut manifest_pages = Vec::new();
        loop {
            let page =
                crate::normalized_sqlite::export_normalized_checkpoint_page_v2(database, &request)
                    .unwrap();
            let index = compressed_pages.len();
            let mut frame = b"FRDV2FRM\x01\x01\x00\x00".to_vec();
            frame.extend_from_slice(&(page.records.len() as u32).to_be_bytes());
            for row in &page.records {
                let bytes = crate::library_core_canonical::encode_canonical_value(
                    &serde_json::to_value(row).unwrap(),
                    crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
                )
                .unwrap();
                frame.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
                frame.extend(bytes);
            }
            let identity = |row: &crate::normalized_checkpoint::NormalizedCheckpointRecordV2| {
                format!(
                    "{}:{}",
                    row.registry_key,
                    String::from_utf8(
                        crate::library_core_canonical::encode_canonical_value(
                            &row.primary_key,
                            4096
                        )
                        .unwrap()
                    )
                    .unwrap()
                )
            };
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            encoder.write_all(&frame).unwrap();
            let compressed = encoder.finish().unwrap();
            let digest = hash(&compressed);
            manifest_pages.push(serde_json::json!({
                "pageIndex": index, "recordCount": page.records.len(),
                "firstRecordIdentity": identity(page.records.first().unwrap()),
                "lastRecordIdentity": identity(page.records.last().unwrap()),
                "object": {"transportObjectId": format!("page-{index}"), "descriptor": {
                    "contentDigest": digest, "byteLength": compressed.len(),
                    "objectKey": format!("freed-v2-checkpoint~{}~e{}~g{}~p{}~{}.fpage.gz", selected.library_id, selected.authority_epoch, successor_control.generation, index, digest)
                }}
            }));
            compressed_pages.push(compressed);
            if page.done {
                break;
            }
            request.after = page.next_cursor;
        }
        assert!(compressed_pages.len() > 1);
        let manifest_bytes = crate::library_core_canonical::encode_canonical_value(
            &serde_json::json!({
                "causalFrontierDigest": selected.causal_frontier_digest,
                "datasetSchemaId": "library_core_normalized_checkpoint_v2", "generation": successor_control.generation,
                "kind": "checkpoint_manifest", "libraryId": selected.library_id,
                "storageEpoch": selected.authority_epoch, "protocolVersion": 1, "schemaVersion": 1,
                "totalRecordCount": selected.record_count, "pages": manifest_pages
            }),
            1_048_576,
        )
        .unwrap();
        successor_control.manifest.descriptor.content_digest = hash(&manifest_bytes);
        successor_control.manifest.descriptor.byte_length = manifest_bytes.len() as u64;
        successor_control.manifest.descriptor.object_key = format!(
            "freed-v2-manifest~{}~e{}~g{}~{}.json",
            selected.library_id,
            selected.authority_epoch,
            successor_control.generation,
            hash(&manifest_bytes)
        );
        (manifest_bytes, compressed_pages)
    }

    fn stage_copy(
        source: &rusqlite::Connection,
        target: &mut rusqlite::Connection,
        stage_id: &str,
        now: u64,
    ) {
        let selected =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(source).unwrap();
        crate::normalized_sqlite::begin_normalized_checkpoint_stage_v2(
            target,
            &crate::normalized_sqlite::BeginNormalizedCheckpointStageV2 {
                stage_id: stage_id.into(),
                library_id: selected.library_id,
                authority_epoch: selected.authority_epoch,
                source_revision: selected.source_revision,
                expected_record_count: selected.record_count,
                created_at: now,
            },
        )
        .unwrap();
        let mut request = crate::normalized_sqlite::NormalizedCheckpointExportRequestV2 {
            maximum_records: 3,
            ..Default::default()
        };
        loop {
            let page =
                crate::normalized_sqlite::export_normalized_checkpoint_page_v2(source, &request)
                    .unwrap();
            crate::normalized_sqlite::append_normalized_checkpoint_stage_page_v2(
                target,
                stage_id,
                &page.records,
            )
            .unwrap();
            if page.done {
                break;
            }
            request.after = page.next_cursor;
        }
    }

    fn run_target_readiness_lifecycle(recovered_incarnation: bool, cancelled_consumer: bool) {
        use crate::library_core_actor_enrollment::ActorKeyStore;
        use crate::normalized_authority_credentials::AuthorityKeyStore;
        use crate::normalized_sqlite::open_normalized_sqlite_database_v1;
        use rusqlite::params;
        use std::cell::{Cell, RefCell};
        #[derive(Default)]
        struct Store {
            bytes: RefCell<Option<Vec<u8>>>,
            writes: Cell<usize>,
        }
        impl AuthorityKeyStore for Store {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(self.bytes.borrow().clone())
            }
            fn store(&self, _: &str, bytes: &[u8]) -> Result<(), String> {
                self.bytes.replace(Some(bytes.to_vec()));
                self.writes.set(self.writes.get() + 1);
                Ok(())
            }
        }
        impl ActorKeyStore for Store {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(self.bytes.borrow().clone())
            }
            fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
                Err("actor key must not be replaced".into())
            }
        }
        let actor_bytes = Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new()).unwrap();
        let actor_key = Ed25519KeyPair::from_pkcs8(actor_bytes.as_ref()).unwrap();
        let actor_store = Store {
            bytes: RefCell::new(Some(actor_bytes.as_ref().to_vec())),
            writes: Cell::new(0),
        };
        let pending = Store::default();
        let source_key_bytes =
            Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new()).unwrap();
        let source_key = Ed25519KeyPair::from_pkcs8(source_key_bytes.as_ref()).unwrap();
        let source_store = Store {
            bytes: RefCell::new(Some(source_key_bytes.as_ref().to_vec())),
            writes: Cell::new(0),
        };

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("target.sqlite");
        let mut database = open_normalized_sqlite_database_v1(&path, true).unwrap();
        assert!(crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .is_none());
        let library = "a".repeat(64);
        let epoch = "b".repeat(64);
        let writer = "c".repeat(64);
        let installation_witness = "f".repeat(64);
        let initial_authority = crate::normalized_authority::NormalizedAuthorityStateV2 {
            library_id: library.clone(),
            epoch: 1,
            epoch_id: epoch.clone(),
            authority_key_id: crate::normalized_writer_certificate::authority_key_id(&lower_hex(
                source_key.public_key().as_ref(),
            ))
            .unwrap(),
            authority_public_key: lower_hex(source_key.public_key().as_ref()),
            observed_frontier: Vec::new(),
        };
        let actor_request = if recovered_incarnation {
            crate::library_core_actor_enrollment::prepare_recovery_actor_request(
                &initial_authority, &installation_witness, &actor_store, 1, &"7".repeat(64))
        } else {
            crate::library_core_actor_enrollment::prepare_normalized_follower_actor_enrollment_request_v2(
                &initial_authority, &installation_witness, &actor_store, 1)
        }.unwrap();
        let actor = actor_request.actor_id.clone();
        let offline_request = crate::library_core_actor_enrollment::prepare_recovery_actor_request(
            &initial_authority,
            &installation_witness,
            &actor_store,
            1,
            &"6".repeat(64),
        )
        .unwrap();
        let offline_actor = offline_request.actor_id.clone();
        let digest = "e".repeat(64);
        let actor_public = lower_hex(actor_key.public_key().as_ref());
        database
            .execute(
                "INSERT INTO library_materialization_generation VALUES (1, ?1);",
                [&digest],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_meta VALUES (1, ?1, 1, ?2, 0, 1);",
                params![library, epoch],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_authority_epochs VALUES
            (?1, ?2, 1, ?3, ?4, ?3, '{}', 1, ?3, ?3, 1);",
                params![
                    epoch,
                    library,
                    digest,
                    lower_hex(source_key.public_key().as_ref())
                ],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_active_authority VALUES
            ('active', ?1, ?2, 'primary:desktop', 1, 1);",
                params![library, epoch],
            )
            .unwrap();
        for (id, kind, key) in [
            (&writer, "desktop", &digest),
            (&actor, "pwa", &actor_public),
            (&offline_actor, "pwa", &actor_public),
        ] {
            database
                .execute(
                    "INSERT INTO library_actors VALUES
                (?1, ?2, ?3, ?4, ?1, ?5, '{}', ?5, 0, NULL, ?5, NULL, 1, 1);",
                    params![id, epoch, kind, key, digest],
                )
                .unwrap();
            database.execute("INSERT INTO library_actor_capabilities
                (capability_id, actor_id, certificate_version, actor_class, scope_mode, issuance_identity,
                 retirement_identity, certificate_digest, canonical_certificate, issued_at)
                VALUES (?1, ?1, 2, 'editor', 'library_wide', ?2, ?2, ?2, '{}', 1);",
                params![id, digest]).unwrap();
        }
        // Historical handoff verification must see a real authority-signed
        // enrollment, not the proof-only request used by the older fixture.
        let initial_certificate =
            crate::library_core_actor_enrollment::countersign_actor_enrollment_request_bytes(
                actor_request.canonical_enrollment_request_json.as_bytes(),
                &source_store,
            )
            .unwrap();
        let initial_enrollment = crate::normalized_enrollment_verifier::verify_actor_enrollment(
            &initial_certificate,
            &initial_authority,
        )
        .unwrap();
        database
            .execute(
                "UPDATE library_authority_epochs SET authority_key_id=?1 WHERE epoch_id=?2;",
                params![initial_authority.authority_key_id, epoch],
            )
            .unwrap();
        database.execute("UPDATE library_actors SET canonical_enrollment_certificate=?2,enrollment_operation_id=?3,enrollment_certificate_digest=?4,chain_genesis_digest=?5,accepted_chain_digest=?5 WHERE actor_id=?1;",
            params![actor,initial_enrollment.canonical_enrollment_certificate_json,initial_enrollment.enrollment_operation_id,
                initial_enrollment.enrollment_certificate_digest,initial_enrollment.actor_chain_genesis]).unwrap();
        let offline_certificate =
            crate::library_core_actor_enrollment::countersign_actor_enrollment_request_bytes(
                offline_request.canonical_enrollment_request_json.as_bytes(),
                &source_store,
            )
            .unwrap();
        let offline_enrollment = crate::normalized_enrollment_verifier::verify_actor_enrollment(
            &offline_certificate,
            &initial_authority,
        )
        .unwrap();
        database.execute("UPDATE library_actors SET canonical_enrollment_certificate=?2,enrollment_operation_id=?3,enrollment_certificate_digest=?4,chain_genesis_digest=?5,accepted_chain_digest=?5 WHERE actor_id=?1;",
            params![offline_actor,offline_enrollment.canonical_enrollment_certificate_json,offline_enrollment.enrollment_operation_id,
                offline_enrollment.enrollment_certificate_digest,offline_enrollment.actor_chain_genesis]).unwrap();
        database
            .execute(
                "INSERT INTO library_intent_actors VALUES (?1, 1, NULL, ?2);",
                params![actor, digest],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_follower_checkpoint_receipt VALUES
            (1, ?1, ?2, ?3, 1, 0, ?4, 'manifest', 'object', ?4, 'etag', 1);",
                params![library, epoch, writer, digest],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_follower_actor_request VALUES
            (1, ?1, ?2, ?3, ?4, ?5, '{}', 1, ?5, '{}', ?5, 1);",
                params![library, epoch, actor, actor_public, digest],
            )
            .unwrap();
        database.execute("UPDATE library_follower_actor_request SET canonical_enrollment_request=?1,enrollment_certificate_digest=?2,canonical_enrollment_certificate=?3,actor_chain_genesis=?4 WHERE singleton_id=1;",
            params![actor_request.canonical_enrollment_request_json,initial_enrollment.enrollment_certificate_digest,
                initial_enrollment.canonical_enrollment_certificate_json,initial_enrollment.actor_chain_genesis]).unwrap();
        database
            .execute(
                "UPDATE library_intent_actors SET previous_chain_digest=?1 WHERE actor_id=?2;",
                params![initial_enrollment.actor_chain_genesis, actor],
            )
            .unwrap();
        assert_eq!(
            crate::load_normalized_local_actor_id_v2(
                &database,
                &library,
                &installation_witness,
                &actor_store
            )
            .unwrap(),
            actor
        );
        assert!(crate::load_normalized_local_actor_id_v2(
            &database,
            &library,
            &"9".repeat(64),
            &actor_store
        )
        .is_err());
        database.execute("INSERT INTO library_intent_transactions VALUES
            ('pending', ?1, ?2, 1, ?3, 1, 1, 1, NULL, ?1, 'operation', ?1, 2, ?4, 'pending', 1, NULL, NULL);",
            params![digest, actor, epoch, b"{}".as_slice()]).unwrap();
        for state in ["pending", "published"] {
            database
                .execute(
                    "UPDATE library_intent_transactions SET state = ?1;",
                    [state],
                )
                .unwrap();
            assert!(
                prepare_target_handoff_readiness_v1(&mut database, &actor_store, &pending, 2)
                    .unwrap_err()
                    .contains("all edits settled")
            );
            assert!(pending.bytes.borrow().is_none());
            let bytes: Vec<u8> = database
                .query_row(
                    "SELECT canonical_transaction FROM library_intent_transactions;",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(bytes, b"{}");
        }
        database
            .execute(
                "UPDATE library_intent_transactions SET state = 'rejected', resolved_at = 2;",
                [],
            )
            .unwrap();
        let source_path = directory.path().join("source.sqlite");
        let mut source = rusqlite::Connection::open(&source_path).unwrap();
        rusqlite::backup::Backup::new(&database, &mut source)
            .unwrap()
            .run_to_completion(64, std::time::Duration::ZERO, None)
            .unwrap();
        source
            .execute("DELETE FROM library_follower_actor_request;", [])
            .unwrap();
        source
            .execute("DELETE FROM library_follower_checkpoint_receipt;", [])
            .unwrap();
        source
            .execute(
                "INSERT INTO library_writer_admission VALUES
            (1, 'primary:desktop', 'primary:desktop', 1, 1);",
                [],
            )
            .unwrap();
        database
            .execute_batch(
                "CREATE TEMP TRIGGER fail_handoff_migration BEFORE UPDATE ON library_storage_meta
            BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END;",
            )
            .unwrap();
        assert!(
            prepare_target_handoff_readiness_v1(&mut database, &actor_store, &pending, 3).is_err()
        );
        let version: u32 = database
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
        assert_eq!(pending.writes.get(), 1);
        let key_before = pending.bytes.borrow().clone();
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        let first =
            prepare_target_handoff_readiness_v1(&mut database, &actor_store, &pending, 4).unwrap();
        let target_status = crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .unwrap();
        assert_eq!(
            target_status.installation_role,
            crate::HandoffInstallationRoleV1::Target
        );
        assert_eq!(target_status.phase, crate::HandoffPhaseV1::Preparing);
        assert_eq!(target_status.canonical_readiness, first);
        assert!(
            begin_source_handoff_v1(&mut source, first.as_bytes(), &writer, &source_store, 5)
                .is_err()
        );
        let mut forged: HandoffReadinessV1 = serde_json::from_str(&first).unwrap();
        forged.body.target_authority_public_key = digest.clone();
        assert!(begin_source_handoff_v1(
            &mut source,
            &canonical_handoff_bytes(&forged).unwrap(),
            &actor,
            &source_store,
            5
        )
        .is_err());
        assert_eq!(
            source
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            1
        );
        let source_handoff =
            begin_source_handoff_v1(&mut source, first.as_bytes(), &actor, &source_store, 5)
                .unwrap();
        drop(source);
        let mut source = open_normalized_sqlite_database_v1(&source_path, false).unwrap();
        assert_eq!(
            begin_source_handoff_v1(&mut source, first.as_bytes(), &actor, &source_store, 6)
                .unwrap(),
            source_handoff
        );
        assert!(
            crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(&source)
                .is_err()
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&source).is_ok()
        );
        let unsigned: bool = source
            .query_row(
                "SELECT phase = 'preparing' AND canonical_authorization_body IS NULL
            AND canonical_authorization IS NULL AND created_at = 5 FROM library_local_handoff;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(unsigned);
        let mut replacement: HandoffReadinessV1 = serde_json::from_str(&first).unwrap();
        replacement.body.created_at_ms = 50;
        let pending_key =
            crate::normalized_authority_credentials::load_established_authority_key_pair(
                &pending, &library,
            )
            .unwrap();
        let replacement =
            sign_handoff_readiness_v1(replacement.body, &actor_key, &pending_key).unwrap();
        let replacement_bytes = canonical_handoff_bytes(&replacement).unwrap();
        assert!(
            begin_source_handoff_v1(&mut source, &replacement_bytes, &actor, &source_store, 7)
                .is_err()
        );
        let snapshot =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&source).unwrap();
        let mut stale = snapshot.clone();
        assert!(
            crate::normalized_handoff::require_handoff_checkpoint_export_v1(
                &source,
                &source_handoff,
            )
            .is_err()
        );
        stale.source_revision += 1;
        assert!(crate::normalized_handoff::seal_source_handoff_v1(
            &mut source,
            &source_handoff,
            &stale,
            7,
        )
        .is_err());
        source
            .execute_batch(
                "CREATE TEMP TRIGGER reject_seal_admission_removal
            BEFORE DELETE ON library_writer_admission
            BEGIN SELECT RAISE(ABORT, 'injected seal failure'); END;",
            )
            .unwrap();
        assert!(crate::normalized_handoff::seal_source_handoff_v1(
            &mut source,
            &source_handoff,
            &snapshot,
            7,
        )
        .is_err());
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&source).is_ok()
        );
        source
            .execute_batch("DROP TRIGGER reject_seal_admission_removal;")
            .unwrap();
        let observer = open_normalized_sqlite_database_v1(&source_path, false).unwrap();
        assert_eq!(
            crate::normalized_handoff::seal_source_handoff_v1(
                &mut source,
                &source_handoff,
                &snapshot,
                7,
            )
            .unwrap(),
            snapshot
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&observer).is_err()
        );
        assert_eq!(
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&observer).unwrap(),
            snapshot
        );
        let page = crate::normalized_sqlite::export_normalized_checkpoint_page_v2(
            &observer,
            &crate::normalized_sqlite::NormalizedCheckpointExportRequestV2::default(),
        )
        .unwrap();
        assert!(
            !page.records.is_empty(),
            "sealed source must remain exportable"
        );
        crate::normalized_handoff::require_handoff_checkpoint_export_v1(&observer, &source_handoff)
            .unwrap();
        assert!(
            crate::normalized_handoff::require_handoff_checkpoint_export_v1(
                &observer,
                &"f".repeat(64),
            )
            .is_err()
        );
        drop(source);
        let mut source = open_normalized_sqlite_database_v1(&source_path, false).unwrap();
        assert_eq!(
            crate::normalized_handoff::seal_source_handoff_v1(
                &mut source,
                &source_handoff,
                &snapshot,
                8,
            )
            .unwrap(),
            snapshot
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&source).is_err()
        );
        let missing_key = Store::default();
        assert!(crate::cancel_source_handoff_with_proof_v1(
            &mut source,
            &source_handoff,
            8,
            &missing_key
        )
        .is_err());
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut source)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::Sealed
        );
        assert_eq!(missing_key.writes.get(), 0);
        source.execute_batch("CREATE TEMP TRIGGER reject_cancellation_proof BEFORE UPDATE OF canonical_cancellation ON library_local_handoff_cancellations BEGIN SELECT RAISE(ABORT, 'injected cancellation proof failure'); END;").unwrap();
        assert!(crate::cancel_source_handoff_with_proof_v1(
            &mut source,
            &source_handoff,
            8,
            &source_store
        )
        .unwrap_err()
        .contains("injected cancellation proof failure"));
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut source)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::Sealed
        );
        let retained_count: i64 = source
            .query_row(
                "SELECT count(*) FROM library_local_handoff_cancellations;",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(retained_count, 0);
        source
            .execute_batch("DROP TRIGGER reject_cancellation_proof;")
            .unwrap();
        let cancellation = crate::cancel_source_handoff_with_proof_v1(
            &mut source,
            &source_handoff,
            8,
            &source_store,
        )
        .unwrap();
        let cancelled_target_path = directory.path().join("cancelled-target.sqlite");
        let mut cancelled_target = rusqlite::Connection::open(&cancelled_target_path).unwrap();
        rusqlite::backup::Backup::new(&database, &mut cancelled_target)
            .unwrap()
            .run_to_completion(64, std::time::Duration::ZERO, None)
            .unwrap();
        drop(cancelled_target);
        let mut cancelled_target =
            open_normalized_sqlite_database_v1(&cancelled_target_path, false).unwrap();
        let before_cancel =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&cancelled_target)
                .unwrap();
        let mut bad_cancellation: Value = serde_json::from_str(&cancellation).unwrap();
        bad_cancellation["predecessor_signature"] = Value::String("00".repeat(64));
        assert!(crate::accept_target_handoff_cancellation_v1(
            &mut cancelled_target,
            &canonical_handoff_bytes(&bad_cancellation).unwrap(),
            101
        )
        .is_err());
        cancelled_target.execute_batch("CREATE TEMP TRIGGER fail_target_cancel BEFORE UPDATE OF phase ON library_local_handoff BEGIN SELECT RAISE(ABORT, 'injected target cancellation failure'); END;").unwrap();
        assert!(crate::accept_target_handoff_cancellation_v1(
            &mut cancelled_target,
            cancellation.as_bytes(),
            101
        )
        .unwrap_err()
        .contains("injected target cancellation failure"));
        assert_eq!(
            cancelled_target
                .query_row(
                    "SELECT count(*) FROM library_local_handoff_cancellations;",
                    [],
                    |r| r.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
        cancelled_target
            .execute_batch("DROP TRIGGER fail_target_cancel;")
            .unwrap();
        assert_eq!(
            crate::accept_target_handoff_cancellation_v1(
                &mut cancelled_target,
                cancellation.as_bytes(),
                101
            )
            .unwrap(),
            source_handoff
        );
        crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&cancelled_target)
            .unwrap();
        assert!(
            crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(
                &cancelled_target
            )
            .is_err()
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&cancelled_target)
                .is_err()
        );
        assert_eq!(
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&cancelled_target)
                .unwrap(),
            before_cancel
        );
        drop(cancelled_target);
        let mut cancelled_target =
            open_normalized_sqlite_database_v1(&cancelled_target_path, false).unwrap();
        let before_retry = cancelled_target.total_changes();
        assert_eq!(
            crate::accept_target_handoff_cancellation_v1(
                &mut cancelled_target,
                cancellation.as_bytes(),
                0
            )
            .unwrap(),
            source_handoff
        );
        assert_eq!(cancelled_target.total_changes(), before_retry);
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut cancelled_target)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::Cancelled
        );
        let catchup =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&source).unwrap();
        let catchup_page = crate::normalized_sqlite::export_normalized_checkpoint_page_v2(
            &source,
            &crate::normalized_sqlite::NormalizedCheckpointExportRequestV2::default(),
        )
        .unwrap();
        assert!(catchup_page.done);
        crate::normalized_sqlite::begin_normalized_checkpoint_stage_v2(
            &cancelled_target,
            &crate::normalized_sqlite::BeginNormalizedCheckpointStageV2 {
                stage_id: "cancelled-target-catchup".into(),
                library_id: library.clone(),
                authority_epoch: epoch.clone(),
                source_revision: catchup.source_revision,
                expected_record_count: catchup_page.records.len(),
                created_at: 102,
            },
        )
        .unwrap();
        crate::normalized_sqlite::append_normalized_checkpoint_stage_page_v2(
            &mut cancelled_target,
            "cancelled-target-catchup",
            &catchup_page.records,
        )
        .unwrap();
        crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
            &mut cancelled_target,
            "cancelled-target-catchup",
            &crate::normalized_import::NormalizedFollowerCheckpointReceiptV2 {
                checkpoint_generation: 3,
                writer_actor_id: writer.clone(),
                manifest_object_key: "cancelled-catchup".into(),
                manifest_transport_object_id: "cancelled-catchup-file".into(),
                manifest_content_digest: "9".repeat(64),
                control_revision: "cancelled-catchup-head".into(),
                installed_at: 102,
            },
        )
        .unwrap();
        crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&cancelled_target)
            .unwrap();
        assert_eq!(
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&cancelled_target)
                .unwrap(),
            catchup
        );
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut cancelled_target)
                .unwrap()
                .unwrap()
                .canonical_cancellation
                .as_deref(),
            Some(cancellation.as_str())
        );
        cancelled_target
            .execute(
                "UPDATE library_actors SET retired_at = 103 WHERE actor_id = ?1;",
                [&actor],
            )
            .unwrap();
        assert!(
            crate::read_native_handoff_status_v1(&mut cancelled_target)
                .unwrap()
                .is_some(),
            "canonical retirement does not erase cancellation history"
        );
        assert!(
            crate::normalized_follower::normalized_follower_mutation_context_v1(&cancelled_target)
                .is_err(),
            "cancellation cannot restore retired actor rights"
        );
        cancelled_target
            .execute(
                "UPDATE library_actors SET retired_at = NULL WHERE actor_id = ?1;",
                [&actor],
            )
            .unwrap();
        assert!(prepare_target_handoff_readiness_v1(
            &mut cancelled_target,
            &actor_store,
            &pending,
            101
        )
        .is_err());
        assert!(prepare_target_handoff_readiness_v1(
            &mut cancelled_target,
            &actor_store,
            &missing_key,
            102
        )
        .is_err());
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut cancelled_target)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::Cancelled
        );
        let new_ready =
            prepare_target_handoff_readiness_v1(&mut cancelled_target, &actor_store, &pending, 102)
                .unwrap();
        assert_ne!(new_ready, first);
        assert_eq!(pending.writes.get(), 1);
        assert_eq!(cancelled_target.query_row("SELECT canonical_cancellation FROM library_local_handoff_cancellations WHERE handoff_id = ?1;", [&source_handoff], |r| r.get::<_, Vec<u8>>(0)).unwrap(), cancellation.as_bytes());
        assert!(
            crate::normalized_handoff::require_handoff_follower_edit_admission_v1(
                &cancelled_target
            )
            .is_err()
        );
        assert!(crate::accept_target_handoff_cancellation_v1(
            &mut cancelled_target,
            cancellation.as_bytes(),
            103
        )
        .is_err());
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut source)
                .unwrap()
                .unwrap()
                .canonical_cancellation
                .as_deref(),
            Some(cancellation.as_str())
        );
        drop(source);
        let mut source = open_normalized_sqlite_database_v1(&source_path, false).unwrap();
        assert_eq!(
            crate::cancel_source_handoff_with_proof_v1(
                &mut source,
                &source_handoff,
                99,
                &missing_key
            )
            .unwrap(),
            cancellation
        );
        assert_eq!(source_store.writes.get(), 0);
        let mut forged: Value = serde_json::from_str(&cancellation).unwrap();
        forged["predecessor_signature"] = Value::String("00".repeat(64));
        let forged = canonical_handoff_bytes(&forged).unwrap();
        source.execute("UPDATE library_local_handoff_cancellations SET canonical_cancellation = ?1 WHERE handoff_id = ?2;", params![forged, source_handoff]).unwrap();
        assert!(crate::cancel_source_handoff_with_proof_v1(
            &mut source,
            &source_handoff,
            100,
            &missing_key
        )
        .is_err());
        source.execute("UPDATE library_local_handoff_cancellations SET canonical_cancellation = ?1 WHERE handoff_id = ?2;", params![cancellation.as_bytes(), source_handoff]).unwrap();
        assert!(
            crate::normalized_handoff::require_handoff_checkpoint_export_v1(
                &source,
                &source_handoff,
            )
            .is_err()
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&source).is_ok()
        );
        drop(source);
        let mut source = open_normalized_sqlite_database_v1(&source_path, false).unwrap();
        let before_retry = source.total_changes();
        let error =
            begin_source_handoff_v1(&mut source, first.as_bytes(), &actor, &source_store, 9)
                .unwrap_err();
        assert!(error.contains("was cancelled"));
        assert_eq!(source.total_changes(), before_retry);
        assert_eq!(
            begin_source_handoff_v1(&mut source, &replacement_bytes, &actor, &source_store, 9)
                .unwrap(),
            replacement.handoff_id
        );
        let retained: (Vec<u8>, u64) = source.query_row(
            "SELECT canonical_readiness, cancelled_at FROM library_local_handoff_cancellations WHERE handoff_id = ?1;",
            [&source_handoff], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(retained, (first.as_bytes().to_vec(), 8));
        let retained_proof: Vec<u8> = source.query_row(
            "SELECT canonical_cancellation FROM library_local_handoff_cancellations WHERE handoff_id = ?1;",
            [&source_handoff], |row| row.get(0),
        ).unwrap();
        assert_eq!(retained_proof, cancellation.as_bytes());
        assert!(
            begin_source_handoff_v1(&mut source, first.as_bytes(), &actor, &source_store, 9)
                .unwrap_err()
                .contains("was cancelled")
        );
        let authorization = HandoffAuthorizationBodyV1 {
            format: GRANT_FORMAT.into(),
            readiness: replacement.clone(),
            predecessor_authority_public_key: lower_hex(source_key.public_key().as_ref()),
            successor_epoch: 2,
            final_source_revision: snapshot.source_revision,
            final_checkpoint_digest: {
                let transaction = source.transaction().unwrap();
                let digest =
                    crate::normalized_import::selected_checkpoint_digest_v2(&transaction).unwrap();
                transaction.commit().unwrap();
                digest
            },
            source_control: HandoffSourceControlV1 {
                schema_version: 1,
                protocol_version: 1,
                library_id: library.clone(),
                storage_epoch: epoch.clone(),
                writer_id: writer.clone(),
                active_transport: "google_drive_app_data_v1".into(),
                generation: 2,
                causal_frontier_digest: snapshot.causal_frontier_digest.clone(),
                manifest: HandoffObjectReferenceV1 {
                    descriptor: HandoffObjectDescriptorV1 {
                        object_key: format!(
                            "freed-v2-manifest~{library}~e{epoch}~g2~{digest}.json"
                        ),
                        content_digest: digest.clone(),
                        byte_length: 100,
                    },
                    transport_object_id: "final-checkpoint".into(),
                },
            },
            source_control_revision: "\"final-head\"".into(),
            source_control_file_id: "control-file".into(),
        };
        let authorization_bytes = canonical_handoff_bytes(&authorization).unwrap();
        assert!(
            authorize_source_handoff_v1(&mut source, &authorization_bytes, &source_store, 10)
                .is_err()
        );
        crate::normalized_handoff::seal_source_handoff_v1(
            &mut source,
            &replacement.handoff_id,
            &snapshot,
            10,
        )
        .unwrap();
        source
            .execute_batch("SAVEPOINT result_actor_fixture;")
            .unwrap();
        source.execute("INSERT INTO library_follower_result_outbox
            (transaction_id, transaction_digest, actor_id, authority_epoch_id, intent_epoch_id,
             result_sequence, previous_result_digest, result_digest, status, rejection_reason,
             original_result_digest, authoritative_source_revision, canonical_result, enqueued_at, acknowledged_at)
            VALUES ('fixture', ?1, ?2, ?3, ?3, 1, NULL, ?1, 'accepted', NULL, NULL, 0, X'7b7d', 1, NULL);",
            params!["9".repeat(64), actor, epoch]).unwrap();
        assert_eq!(
            crate::read_sealed_handoff_result_actors_v1(&source, &replacement.handoff_id, None)
                .unwrap(),
            vec![actor.clone()]
        );
        assert!(crate::read_sealed_handoff_result_actors_v1(
            &source,
            &replacement.handoff_id,
            Some(&actor)
        )
        .unwrap()
        .is_empty());
        assert!(
            crate::read_sealed_handoff_result_actors_v1(&source, &"0".repeat(64), None).is_err()
        );
        assert!(crate::read_sealed_handoff_result_actors_v1(
            &source,
            &replacement.handoff_id,
            Some("invalid")
        )
        .is_err());
        source
            .execute_batch("ROLLBACK TO result_actor_fixture; RELEASE result_actor_fixture;")
            .unwrap();
        let control_bytes = canonical_handoff_bytes(&authorization.source_control).unwrap();
        let prepared = prepare_source_handoff_authorization_v1(
            &mut source,
            &replacement.handoff_id,
            &control_bytes,
            &authorization.source_control_revision,
            &authorization.source_control_file_id,
        )
        .unwrap();
        assert_eq!(prepared.as_bytes(), authorization_bytes);
        let mut wrong_control = authorization.source_control.clone();
        wrong_control.causal_frontier_digest = "00".repeat(32);
        assert!(prepare_source_handoff_authorization_v1(
            &mut source,
            &replacement.handoff_id,
            &canonical_handoff_bytes(&wrong_control).unwrap(),
            &authorization.source_control_revision,
            &authorization.source_control_file_id,
        )
        .is_err());
        assert!(prepare_source_handoff_authorization_v1(
            &mut source,
            &replacement.handoff_id,
            &control_bytes,
            "weak-head",
            &authorization.source_control_file_id,
        )
        .is_err());
        let mut wrong_frontier = authorization.clone();
        wrong_frontier.final_source_revision += 1;
        assert!(authorize_source_handoff_v1(
            &mut source,
            &canonical_handoff_bytes(&wrong_frontier).unwrap(),
            &source_store,
            11,
        )
        .is_err());
        source
            .execute_batch(
                "CREATE TEMP TRIGGER reject_authorization_cutoff
            BEFORE UPDATE OF phase ON library_local_handoff WHEN NEW.phase = 'authorized'
            BEGIN SELECT RAISE(ABORT, 'injected cutoff failure'); END;",
            )
            .unwrap();
        assert!(
            authorize_source_handoff_v1(&mut source, &authorization_bytes, &source_store, 11)
                .is_err()
        );
        let still_sealed: bool = source
            .query_row(
                "SELECT phase = 'sealed' AND canonical_authorization_body IS NULL
             AND canonical_authorization IS NULL FROM library_local_handoff;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(still_sealed);
        source.execute_batch("DROP TRIGGER reject_authorization_cutoff;
            CREATE TEMP TRIGGER reject_signed_receipt BEFORE UPDATE OF canonical_authorization ON library_local_handoff
            BEGIN SELECT RAISE(ABORT, 'injected signature receipt failure'); END;").unwrap();
        assert!(
            authorize_source_handoff_v1(&mut source, &authorization_bytes, &source_store, 11)
                .is_err()
        );
        drop(source);
        let mut source = open_normalized_sqlite_database_v1(&source_path, false).unwrap();
        let cutoff_survived: bool = source
            .query_row(
                "SELECT phase = 'authorized' AND canonical_authorization_body = ?1
             AND canonical_authorization IS NULL FROM library_local_handoff;",
                [&authorization_bytes],
                |row| row.get(0),
            )
            .unwrap();
        assert!(cutoff_survived);
        let cutoff_status = crate::read_native_handoff_status_v1(&mut source)
            .unwrap()
            .unwrap();
        assert_eq!(
            cutoff_status.installation_role,
            crate::HandoffInstallationRoleV1::Source
        );
        assert_eq!(cutoff_status.phase, crate::HandoffPhaseV1::Authorized);
        assert_eq!(
            cutoff_status
                .canonical_authorization_body
                .as_deref()
                .map(str::as_bytes),
            Some(authorization_bytes.as_slice())
        );
        assert!(cutoff_status.canonical_authorization.is_none());
        assert!(prepare_source_handoff_authorization_v1(
            &mut source,
            &replacement.handoff_id,
            &control_bytes,
            &authorization.source_control_revision,
            &authorization.source_control_file_id,
        )
        .is_err());
        assert!(crate::normalized_handoff::cancel_source_handoff_v1(
            &mut source,
            &replacement.handoff_id,
            12,
        )
        .is_err());
        let signed =
            authorize_source_handoff_v1(&mut source, &authorization_bytes, &source_store, 12)
                .unwrap();
        let signed_status = crate::read_native_handoff_status_v1(&mut source)
            .unwrap()
            .unwrap();
        assert_eq!(
            signed_status.canonical_authorization.as_deref(),
            Some(signed.as_str())
        );
        assert_eq!(
            signed_status.expected_control_revision.as_deref(),
            Some("\"final-head\"")
        );
        assert_eq!(signed_status.updated_at_ms, 11);
        assert_eq!(
            authorize_source_handoff_v1(&mut source, &authorization_bytes, &source_store, 13)
                .unwrap(),
            signed
        );
        // This target prepared the first readiness, so the replacement transfer
        // signed by the same legitimate predecessor still cannot enroll it.
        assert!(accept_target_handoff_authorization_v1(
            &mut database,
            signed.as_bytes(),
            &actor_store,
            &pending,
            20,
        )
        .is_err());
        let mut target_body = authorization.clone();
        target_body.readiness = serde_json::from_str(&first).unwrap();
        let target_predecessor = HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &epoch,
            epoch: 1,
            certificate_digest: &digest,
            authority_public_key: &authorization.predecessor_authority_public_key,
            writer_id: &writer,
        };
        let target_grant = sign_handoff_authorization_v1(
            target_body.clone(),
            &target_predecessor,
            &actor_public,
            &source_key,
        )
        .unwrap();
        let target_bytes = canonical_handoff_bytes(&target_grant).unwrap();
        assert!(
            accept_target_handoff_authorization_v1(
                &mut cancelled_target,
                &target_bytes,
                &actor_store,
                &pending,
                103
            )
            .is_err(),
            "delayed valid authorization cannot revive canceled readiness"
        );

        let mut forged_grant = target_grant.clone();
        forged_grant.predecessor_signature = "00".repeat(64);
        assert!(accept_target_handoff_authorization_v1(
            &mut database,
            &canonical_handoff_bytes(&forged_grant).unwrap(),
            &actor_store,
            &pending,
            20,
        )
        .is_err());
        database
            .execute_batch(
                "CREATE TEMP TRIGGER refuse_target_consent
            BEFORE UPDATE OF canonical_authorization ON library_local_handoff
            BEGIN SELECT RAISE(ABORT, 'injected target receipt failure'); END;",
            )
            .unwrap();
        assert!(accept_target_handoff_authorization_v1(
            &mut database,
            &target_bytes,
            &actor_store,
            &pending,
            20,
        )
        .is_err());
        assert!(crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .unwrap()
            .canonical_authorization
            .is_none());
        database
            .execute_batch("DROP TRIGGER refuse_target_consent;")
            .unwrap();
        assert_eq!(
            accept_target_handoff_authorization_v1(
                &mut database,
                &target_bytes,
                &actor_store,
                &pending,
                20,
            )
            .unwrap(),
            target_grant.body.readiness.handoff_id
        );
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert_eq!(
            accept_target_handoff_authorization_v1(
                &mut database,
                &target_bytes,
                &actor_store,
                &pending,
                21,
            )
            .unwrap(),
            target_grant.body.readiness.handoff_id
        );
        let accepted = crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .unwrap();
        assert_eq!(accepted.phase, crate::HandoffPhaseV1::Preparing);
        assert_eq!(accepted.updated_at_ms, 20);
        assert_eq!(
            accepted
                .canonical_authorization
                .as_deref()
                .map(str::as_bytes),
            Some(target_bytes.as_slice())
        );
        assert!(accepted.successor_epoch_id.is_none());
        let target_receipt = crate::normalized_import::NormalizedFollowerCheckpointReceiptV2 {
            checkpoint_generation: target_grant.body.source_control.generation,
            writer_actor_id: target_grant.body.source_control.writer_id.clone(),
            manifest_object_key: target_grant
                .body
                .source_control
                .manifest
                .descriptor
                .object_key
                .clone(),
            manifest_transport_object_id: target_grant
                .body
                .source_control
                .manifest
                .transport_object_id
                .clone(),
            manifest_content_digest: target_grant
                .body
                .source_control
                .manifest
                .descriptor
                .content_digest
                .clone(),
            control_revision: target_grant.body.source_control_revision.clone(),
            installed_at: 21,
        };
        verify_handoff_checkpoint_install_v1(
            &database,
            &target_grant.body.final_checkpoint_digest,
            Some(&target_receipt),
        )
        .unwrap();
        assert!(verify_handoff_checkpoint_install_v1(
            &database,
            &"00".repeat(32),
            Some(&target_receipt)
        )
        .is_err());
        assert!(verify_handoff_checkpoint_install_v1(
            &database,
            &target_grant.body.final_checkpoint_digest,
            None
        )
        .is_err());
        assert!(verify_handoff_checkpoint_install_v1(
            &source,
            &target_grant.body.final_checkpoint_digest,
            Some(&target_receipt)
        )
        .is_err());

        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&database).is_err()
        );
        assert!(crate::require_normalized_provider_handoff_admission_v2(&database).is_err());
        target_body.source_control_revision = "\"other-valid-head\"".into();
        let conflicting = sign_handoff_authorization_v1(
            target_body,
            &target_predecessor,
            &actor_public,
            &source_key,
        )
        .unwrap();
        assert!(accept_target_handoff_authorization_v1(
            &mut database,
            &canonical_handoff_bytes(&conflicting).unwrap(),
            &actor_store,
            &pending,
            22,
        )
        .is_err());
        let mut changed = authorization;
        changed.source_control_revision = "\"different-head\"".into();
        assert!(authorize_source_handoff_v1(
            &mut source,
            &canonical_handoff_bytes(&changed).unwrap(),
            &source_store,
            14,
        )
        .is_err());
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&source).is_err()
        );
        assert_eq!(
            source_store.writes.get(),
            0,
            "source preparation must never mint or overwrite its key"
        );
        source
            .execute(
                "UPDATE library_local_handoff SET canonical_authorization = ?1;",
                [b"{} ".as_slice()],
            )
            .unwrap();
        assert!(crate::read_native_handoff_status_v1(&mut source).is_err());
        assert!(
            crate::normalized_handoff::cancel_source_handoff_v1(
                &mut source,
                &replacement.handoff_id,
                15,
            )
            .is_err(),
            "a corrupt receipt must not erase the authorization cutoff"
        );
        assert_eq!(*pending.bytes.borrow(), key_before);
        assert_eq!(pending.writes.get(), 1);
        assert!(
            crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&database)
                .is_err()
        );
        assert!(
            crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(&database)
                .is_err()
        );
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert_eq!(
            prepare_target_handoff_readiness_v1(&mut database, &actor_store, &pending, 99).unwrap(),
            first
        );
        pending.bytes.replace(None);
        assert!(accept_target_handoff_authorization_v1(
            &mut database,
            &target_bytes,
            &actor_store,
            &pending,
            100,
        )
        .is_err());
        assert!(
            prepare_target_handoff_readiness_v1(&mut database, &actor_store, &pending, 100)
                .is_err()
        );
        assert!(
            pending.bytes.borrow().is_none(),
            "a missing committed key must never be regenerated"
        );
        assert_eq!(pending.writes.get(), 1);
        let stored: Vec<u8> = database
            .query_row(
                "SELECT canonical_readiness FROM library_local_handoff;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, first.as_bytes());
        let count: i64 = database
            .query_row(
                "SELECT count(*) FROM library_intent_transactions;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "resolved intent history must remain intact");
        assert!(stage_target_handoff_v1(
            &mut database,
            &target_grant.body.readiness.handoff_id,
            &installation_witness,
            &actor_store,
            &pending,
            101
        )
        .is_err());
        assert!(pending.bytes.borrow().is_none());
        pending.bytes.replace(key_before.clone());
        assert!(stage_target_handoff_v1(
            &mut database,
            &target_grant.body.readiness.handoff_id,
            &"0".repeat(64),
            &actor_store,
            &pending,
            101
        )
        .is_err());
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut database)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::Preparing
        );
        database
            .execute_batch(
                "CREATE TRIGGER refuse_successor BEFORE UPDATE OF authority_epoch ON library_meta
            BEGIN SELECT RAISE(ABORT, 'injected successor write failure'); END;",
            )
            .unwrap();
        assert!(stage_target_handoff_v1(
            &mut database,
            &target_grant.body.readiness.handoff_id,
            &installation_witness,
            &actor_store,
            &pending,
            101
        )
        .is_err());
        let failed = crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .unwrap();
        assert_eq!(failed.phase, crate::HandoffPhaseV1::Preparing);
        assert!(failed.successor_epoch_id.is_none());
        assert_eq!(
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&database)
                .unwrap()
                .authority_epoch,
            epoch
        );
        database
            .execute_batch("DROP TRIGGER refuse_successor;")
            .unwrap();
        if recovered_incarnation {
            let original: String = database.query_row("SELECT canonical_enrollment_certificate FROM library_actors WHERE actor_id = ?1;", [&actor], |r| r.get(0)).unwrap();
            database.execute("UPDATE library_actors SET canonical_enrollment_certificate = '{}' WHERE actor_id = ?1;", [&actor]).unwrap();
            assert!(stage_target_handoff_v1(
                &mut database,
                &target_grant.body.readiness.handoff_id,
                &installation_witness,
                &actor_store,
                &pending,
                101
            )
            .unwrap_err()
            .contains("exact authorized checkpoint"));
            database.execute("UPDATE library_actors SET canonical_enrollment_certificate = ?2 WHERE actor_id = ?1;", params![actor, original]).unwrap();
        }
        let staged = stage_target_handoff_v1(
            &mut database,
            &target_grant.body.readiness.handoff_id,
            &installation_witness,
            &actor_store,
            &pending,
            101,
        )
        .unwrap();
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut database)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::CasPending
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&database).is_err()
        );
        assert!(
            crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(&database)
                .is_err()
        );
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        let verify_successor = |connection: &rusqlite::Connection, bytes: &[u8]| {
            crate::normalized_handoff_writer_certificate::verify_writer_handoff_against_local_v1(
                connection, bytes,
            )
        };
        assert_eq!(
            verify_successor(&source, staged.canonical_certificate_json.as_bytes())
                .unwrap()
                .epoch_id,
            staged.authority.epoch_id
        );
        assert!(verify_successor(&source, b"{}").is_err());
        let mut noncanonical = staged.canonical_certificate_json.as_bytes().to_vec();
        noncanonical.push(b' ');
        assert!(verify_successor(&source, &noncanonical).is_err());
        source
            .execute_batch("SAVEPOINT wrong_predecessor;")
            .unwrap();
        source.execute("UPDATE library_authority_epochs SET authority_public_key = ?1 WHERE epoch_id = ?2;",
            params!["0".repeat(64), epoch]).unwrap();
        assert!(verify_successor(&source, staged.canonical_certificate_json.as_bytes()).is_err());
        source
            .execute_batch("ROLLBACK TO wrong_predecessor; RELEASE wrong_predecessor;")
            .unwrap();
        // A read-only, not-yet-enrolled consumer imports the predecessor, then
        // follows its authorized successor through the real staged import path.
        let mut consumer = open_normalized_sqlite_database_v1(
            &directory.path().join("proof-consumer.sqlite"),
            true,
        )
        .unwrap();
        let stage_replica = |replica: &mut rusqlite::Connection,
                             origin: &rusqlite::Connection,
                             stage_id: &str| {
            let descriptor =
                crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(origin).unwrap();
            let page = crate::normalized_sqlite::export_normalized_checkpoint_page_v2(
                origin,
                &crate::normalized_sqlite::NormalizedCheckpointExportRequestV2::default(),
            )
            .unwrap();
            assert!(page.done);
            crate::normalized_sqlite::begin_normalized_checkpoint_stage_v2(
                replica,
                &crate::normalized_sqlite::BeginNormalizedCheckpointStageV2 {
                    stage_id: stage_id.into(),
                    library_id: descriptor.library_id.clone(),
                    authority_epoch: descriptor.authority_epoch.clone(),
                    source_revision: descriptor.source_revision,
                    expected_record_count: page.records.len(),
                    created_at: 100,
                },
            )
            .unwrap();
            crate::normalized_sqlite::append_normalized_checkpoint_stage_page_v2(
                replica,
                stage_id,
                &page.records,
            )
            .unwrap();
            crate::normalized_import::NormalizedFollowerCheckpointReceiptV2 {
                checkpoint_generation: 0,
                writer_actor_id: descriptor.writer_id,
                manifest_object_key: "fixture-manifest".into(),
                manifest_transport_object_id: "fixture-file".into(),
                manifest_content_digest: "9".repeat(64),
                control_revision: "fixture-head".into(),
                installed_at: 101,
            }
        };
        let old_receipt = stage_replica(&mut consumer, &source, "predecessor");
        crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
            &mut consumer,
            "predecessor",
            &old_receipt,
        )
        .unwrap();
        let prior =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&consumer).unwrap();
        // Carry the enrolled consumer's original local bytes into this replica.
        consumer
            .execute(
                "ATTACH DATABASE ?1 AS original_consumer;",
                [path.to_str().unwrap()],
            )
            .unwrap();
        for table in [
            "library_follower_actor_request",
            "library_intent_actors",
            "library_intent_transactions",
        ] {
            consumer
                .execute_batch(&format!(
                    "INSERT INTO {table} SELECT * FROM original_consumer.{table};"
                ))
                .unwrap();
        }
        consumer
            .execute_batch("DETACH DATABASE original_consumer;")
            .unwrap();
        consumer
            .execute_batch("BEGIN; PRAGMA defer_foreign_keys = ON;")
            .unwrap();
        consumer
            .execute(
                "UPDATE library_follower_actor_request SET actor_id = ?1, actor_public_key = ?2;",
                params![offline_actor, actor_public],
            )
            .unwrap();
        consumer
            .execute(
                "UPDATE library_intent_actors SET actor_id = ?1;",
                [&offline_actor],
            )
            .unwrap();
        consumer
            .execute(
                "UPDATE library_intent_transactions SET actor_id = ?1;",
                [&offline_actor],
            )
            .unwrap();

        consumer
            .execute(
                "UPDATE library_intent_transactions SET state = 'pending', resolved_at = NULL;",
                [],
            )
            .unwrap();
        consumer.execute("UPDATE library_follower_actor_request SET canonical_enrollment_request=?1,enrollment_request_digest=?2,enrollment_certificate_digest=?3,canonical_enrollment_certificate=?4,actor_chain_genesis=?5 WHERE singleton_id=1;",
            params![offline_request.canonical_enrollment_request_json,offline_request.enrollment_request_digest,
                offline_enrollment.enrollment_certificate_digest,offline_enrollment.canonical_enrollment_certificate_json,offline_enrollment.actor_chain_genesis]).unwrap();
        consumer
            .execute(
                "UPDATE library_intent_actors SET previous_chain_digest=?1 WHERE actor_id=?2;",
                params![offline_enrollment.actor_chain_genesis, offline_actor],
            )
            .unwrap();
        consumer.execute_batch("COMMIT;").unwrap();
        if !recovered_incarnation && !cancelled_consumer {
            // Keep one genuinely offline consumer and the exact first source
            // snapshot for the later two-transfer import acceptance below.
            for (origin, name) in [
                (&consumer, "missed-consumer.sqlite"),
                (&source, "missed-first-source.sqlite"),
            ] {
                let mut copy =
                    open_normalized_sqlite_database_v1(&directory.path().join(name), true).unwrap();
                rusqlite::backup::Backup::new(origin, &mut copy)
                    .unwrap()
                    .run_to_completion(64, std::time::Duration::ZERO, None)
                    .unwrap();
            }
        }
        let consumer_cancellation = if cancelled_consumer {
            // Model a prior canceled transfer on this separate consumer. Source
            // and target clocks are independent; the source proof predates its
            // later authorization of the other target used by this fixture.
            consumer
                .execute(
                    "UPDATE library_intent_transactions SET state = 'rejected', resolved_at = 2;",
                    [],
                )
                .unwrap();
            let consumer_pending_key = Store::default();
            let ready = prepare_target_handoff_readiness_v1(
                &mut consumer,
                &actor_store,
                &consumer_pending_key,
                75,
            )
            .unwrap();
            let ready: HandoffReadinessV1 = serde_json::from_str(&ready).unwrap();
            let body = json!({"format": "freed_library_handoff_cancellation_v1", "readiness": ready,
                "predecessor_authority_public_key": lower_hex(source_key.public_key().as_ref()), "cancelled_at_ms": 3});
            let proof_digest = super::digest("handoff-cancellation-body", &body).unwrap();
            let proof = canonical_handoff_bytes(&json!({"body": body, "cancellation_digest": proof_digest,
                "predecessor_signature": lower_hex(source_key.sign(&signature_input("handoff-predecessor-cancellation", &proof_digest).unwrap()).as_ref())})).unwrap();
            crate::accept_target_handoff_cancellation_v1(&mut consumer, &proof, 76).unwrap();
            consumer
                .execute(
                    "UPDATE library_intent_transactions SET state = 'pending', resolved_at = NULL;",
                    [],
                )
                .unwrap();
            Some((ready.handoff_id, proof))
        } else {
            None
        };
        let retained_intent: Vec<u8> = consumer.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id = 'pending';", [], |r| r.get(0)).unwrap();
        let retained_request: String = consumer.query_row("SELECT canonical_enrollment_request FROM library_follower_actor_request WHERE singleton_id = 1;", [], |r| r.get(0)).unwrap();
        let new_receipt = stage_replica(&mut consumer, &database, "successor");
        let saved_row: Vec<u8> = consumer.query_row("SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id = 'successor' AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?1;",
            [&staged.authority.epoch_id], |r| r.get(0)).unwrap();
        // Change the authority row while retaining a valid predecessor grant.
        // The import must bind row data to the proof, not just verify signatures.
        consumer.execute("UPDATE library_checkpoint_stage_records SET record_canonical = CAST(json_set(CAST(record_canonical AS TEXT), '$.payload.authorityPublicKey', ?1) AS BLOB)
            WHERE stage_id = 'successor' AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?2;",
            params!["0".repeat(64), staged.authority.epoch_id]).unwrap();
        let failure =
            crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut consumer,
                "successor",
                &new_receipt,
            );
        assert!(failure
            .unwrap_err()
            .to_string()
            .contains("rows differ from the verified proof"));
        assert_eq!(
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&consumer).unwrap(),
            prior
        );
        consumer.execute("UPDATE library_checkpoint_stage_records SET record_canonical = ?1 WHERE stage_id = 'successor' AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?2;",
            params![saved_row, staged.authority.epoch_id]).unwrap();
        if cancelled_consumer {
            // Retain another valid historical cancellation and refuse a signed
            // successor that contradicts it, even though it is not the current
            // canceled lifecycle identity.
            consumer.execute("INSERT INTO library_local_handoff_cancellations (handoff_id, library_id, predecessor_epoch_id, canonical_readiness, cancelled_at, canonical_cancellation) VALUES (?1, ?2, ?3, ?4, 8, ?5);",
                params![source_handoff, library, epoch, first.as_bytes(), cancellation.as_bytes()]).unwrap();
            assert!(
                crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                    &mut consumer,
                    "successor",
                    &new_receipt
                )
                .unwrap_err()
                .to_string()
                .contains("reuses locally canceled readiness")
            );
            assert_eq!(
                crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&consumer)
                    .unwrap(),
                prior
            );
            consumer
                .execute(
                    "DELETE FROM library_local_handoff_cancellations WHERE handoff_id = ?1;",
                    [&source_handoff],
                )
                .unwrap();
        }

        crate::normalized_preference_projection::check_projected_successor_checkpoint(
            &consumer,
            "successor",
            &new_receipt,
            &actor_store,
            &installation_witness,
        );
        crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
            &mut consumer,
            "successor",
            &new_receipt,
        )
        .unwrap();
        assert_eq!(
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&consumer)
                .unwrap()
                .authority_epoch,
            staged.authority.epoch_id
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&consumer).is_err()
        );
        drop(consumer);
        let mut consumer = open_normalized_sqlite_database_v1(
            &directory.path().join("proof-consumer.sqlite"),
            false,
        )
        .unwrap();
        if cancelled_consumer {
            assert!(crate::read_native_handoff_status_v1(&mut consumer)
                .unwrap()
                .is_some());
            assert!(
                crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&consumer)
                    .is_err()
            );
            assert!(
                crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(
                    &consumer
                )
                .is_err()
            );
        }
        let recovered: (Vec<u8>, String, String) = consumer.query_row(
            "SELECT canonical_transaction, intent_epoch_id, state FROM library_intent_transactions WHERE transaction_id = 'pending';", [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(
            recovered,
            (retained_intent, epoch.clone(), "pending".into())
        );
        let recovered_request: String = consumer.query_row("SELECT canonical_enrollment_request FROM library_follower_actor_request WHERE singleton_id = 1;", [], |r| r.get(0)).unwrap();
        assert_eq!(recovered_request, retained_request);
        let recovery_status =
            crate::normalized_follower::normalized_follower_runtime_status_v2(&consumer).unwrap();
        assert_eq!(recovery_status.state, "authority_recovery_required");
        assert_eq!(
            recovery_status.actor_id.as_deref(),
            Some(offline_actor.as_str())
        );
        assert_eq!(
            recovery_status.authority_epoch_id.as_deref(),
            Some(staged.authority.epoch_id.as_str())
        );
        assert_eq!(recovery_status.pending_intent_count, 1);

        assert!(
            crate::normalized_follower::normalized_follower_transport_context_v2(&consumer)
                .is_err()
        );
        assert!(
            crate::normalized_follower::prepare_normalized_follower_actor_request_v2(
                &mut consumer,
                &installation_witness,
                &actor_store,
                110
            )
            .unwrap_err()
            .to_string()
            .contains("authority recovery")
        );
        let refresh_receipt = stage_replica(&mut consumer, &database, "recovery-refresh");
        let historical_row: Vec<u8> = consumer.query_row("SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id = 'recovery-refresh' AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?1;",
            [&epoch], |r| r.get(0)).unwrap();
        for (field, replacement) in [
            ("authorityPublicKey", json!("0".repeat(64))),
            ("transitionCertificateDigest", json!("0".repeat(64))),
            ("epochNumber", json!(99)),
            ("libraryId", json!("0".repeat(64))),
        ] {
            let mut changed: Value = serde_json::from_slice(&historical_row).unwrap();
            changed["payload"][field] = replacement;
            let bytes =
                crate::library_core_canonical::encode_canonical_value(&changed, 131_072).unwrap();
            consumer.execute("UPDATE library_checkpoint_stage_records SET record_canonical = ?1 WHERE stage_id = 'recovery-refresh' AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?2;",
                params![bytes, epoch]).unwrap();
            assert!(
                crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                    &mut consumer,
                    "recovery-refresh",
                    &refresh_receipt
                )
                .unwrap_err()
                .to_string()
                .contains("changed the accepted authority"),
                "historical {field} must remain pinned"
            );
            assert_eq!(consumer.query_row("SELECT canonical_enrollment_request FROM library_follower_actor_request WHERE singleton_id = 1;", [], |row| row.get::<_, String>(0)).unwrap(), retained_request);
            consumer.execute("UPDATE library_checkpoint_stage_records SET record_canonical = ?1 WHERE stage_id = 'recovery-refresh' AND registry_key = '01_authority_epoch' AND json_extract(record_canonical, '$.primaryKey') = ?2;",
                params![historical_row, epoch]).unwrap();
        }

        crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
            &mut consumer,
            "recovery-refresh",
            &refresh_receipt,
        )
        .unwrap();
        let after_refresh =
            crate::normalized_follower::normalized_follower_runtime_status_v2(&consumer).unwrap();
        assert_eq!(after_refresh.state, "authority_recovery_required");
        assert_eq!(after_refresh.pending_intent_count, 1);
        assert_eq!(consumer.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id = 'pending';", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(), recovered.0);
        // This opaque member exercises archive hydration only. The resolver
        // must still reject these synthetic bytes as an unsigned operation.
        consumer.execute("INSERT INTO library_intent_members VALUES ('pending', ?1, 0, 'operation', 1, 'feed_item_read_assignment', 'FeedItem', 'rss:archived', X'7b7d', ?2);", params![offline_actor, digest]).unwrap();
        // Keep a retained row with no foreign-key dependents so both missing and
        // additional live rows can be exercised without changing signed intents.
        consumer.execute("INSERT INTO library_local_invalidations VALUES (9007199254740990, 'feed_item', 'recovery-sentinel', 'optimistic_added');", []).unwrap();
        let pre_archive =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&consumer).unwrap();
        if cancelled_consumer {
            consumer.execute_batch("CREATE TEMP TRIGGER refuse_cancelled_archive BEFORE INSERT ON library_local_recovery_archives BEGIN SELECT RAISE(ABORT, 'injected cancellation archive failure'); END;").unwrap();
            assert!(
                crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 119)
                    .unwrap_err()
                    .contains("injected cancellation archive failure")
            );
            assert_eq!(
                crate::read_native_handoff_status_v1(&mut consumer)
                    .unwrap()
                    .unwrap()
                    .phase,
                crate::HandoffPhaseV1::Cancelled
            );
            consumer
                .execute_batch("DROP TRIGGER refuse_cancelled_archive;")
                .unwrap();
        } else {
            consumer.execute_batch("CREATE TEMP TRIGGER refuse_recovery_migration AFTER UPDATE OF schema_version ON library_storage_meta WHEN NEW.schema_version = 2 BEGIN SELECT RAISE(ABORT, 'injected recovery migration failure'); END;").unwrap();
            assert!(
                crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 119)
                    .is_err()
            );
            assert_eq!(
                consumer
                    .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                    .unwrap(),
                1
            );
            consumer
                .execute_batch("DROP TRIGGER refuse_recovery_migration;")
                .unwrap();
        }
        let archive_id =
            crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 120).unwrap();
        if let Some((id, proof)) = &consumer_cancellation {
            let retained: Vec<u8> = consumer.query_row("SELECT canonical_cancellation FROM library_local_handoff_cancellations WHERE handoff_id = ?1;", [id], |r| r.get(0)).unwrap();
            assert_eq!(&retained, proof);
        }
        let archive_count: u64 = consumer
            .query_row(
                "SELECT row_count FROM library_local_recovery_archives WHERE recovery_id = ?1;",
                [&archive_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(archive_count >= 3);
        let page_request = json!({
            "queryId": "recovery_intent_page_v1", "schemaVersion": 1,
            "recoveryId": archive_id, "limit": 1, "cursor": null,
            "cancellationId": "cancel-recovery", "readerSessionId": "reader-recovery"
        });
        let archive_page =
            crate::normalized_query::query_normalized_json_v1(&mut consumer, page_request.clone())
                .unwrap();
        assert_eq!(
            archive_page["rows"],
            json!([{ "ordinal": 0, "transactionId": "pending" }])
        );
        assert!(archive_page["nextCursor"].is_null());
        // Additional index entries exercise pagination only. They are not signed
        // intents and are removed before full archive verification continues.
        consumer.execute("INSERT INTO library_local_recovery_rows (recovery_id, table_key, row_ordinal, transaction_id, columns_json, canonical_row, row_digest)
            SELECT recovery_id, table_key, 1, 'second', columns_json, canonical_row, row_digest FROM library_local_recovery_rows
            WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions' AND row_ordinal = 0;", [&archive_id]).unwrap();
        let first_page =
            crate::normalized_query::query_normalized_json_v1(&mut consumer, page_request.clone())
                .unwrap();
        let mut continuation = page_request.clone();
        continuation["cursor"] = first_page["nextCursor"].clone();
        assert!(continuation["cursor"].is_string());
        let second_page =
            crate::normalized_query::query_normalized_json_v1(&mut consumer, continuation.clone())
                .unwrap();
        assert_eq!(
            second_page["rows"],
            json!([{ "ordinal": 1, "transactionId": "second" }])
        );
        assert!(second_page["nextCursor"].is_null());
        let original_digest: String = consumer.query_row("SELECT archive_digest FROM library_local_recovery_archives WHERE recovery_id = ?1;", [&archive_id], |r| r.get(0)).unwrap();
        consumer.execute("UPDATE library_local_recovery_archives SET archive_digest = ?2 WHERE recovery_id = ?1;", params![archive_id, "0".repeat(64)]).unwrap();
        assert!(
            crate::normalized_query::query_normalized_json_v1(&mut consumer, continuation)
                .unwrap_err()
                .to_string()
                .contains("CURSOR_STALE")
        );
        consumer.execute("UPDATE library_local_recovery_archives SET archive_digest = ?2 WHERE recovery_id = ?1;", params![archive_id, original_digest]).unwrap();
        consumer.execute("DELETE FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions' AND row_ordinal = 1;", [&archive_id]).unwrap();
        let program = crate::sqlite_contract_generated::SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|p| p.query_id == "recovery_intent_page_v1")
            .unwrap();
        let plan = consumer
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
            .unwrap()
            .query_map(params![archive_id, -1, 65], |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(plan.iter().any(|line| line.contains("SEARCH")
            && line.contains("recovery_id=? AND table_key=? AND row_ordinal>?")));
        assert!(plan.iter().all(|line| !line.contains("TEMP B-TREE")));

        let archived_input = crate::normalized_recovery_input::load_archived_intent_input(
            &consumer,
            &archive_id,
            "pending",
        )
        .unwrap();
        assert_eq!(archived_input.transaction_id, "pending");
        assert_eq!(archived_input.transaction_digest, digest);
        assert_eq!(archived_input.actor_id, offline_actor);
        assert_eq!(archived_input.epoch_id, epoch);
        assert_eq!(archived_input.state, "pending");
        assert_eq!(archived_input.first_counter, 1);
        assert_eq!(archived_input.envelopes, vec![b"{}".to_vec()]);
        {
            let review = consumer.transaction().unwrap();
            assert!(
                crate::normalized_recovery_input::inspect_archived_intent_for_review(
                    &review,
                    &archive_id,
                    "pending"
                )
                .err()
                .unwrap()
                .contains("signature verification failed")
            );
            review.commit().unwrap();
        }

        let plan: Vec<String> = consumer.prepare("EXPLAIN QUERY PLAN SELECT canonical_row FROM library_local_recovery_rows INDEXED BY library_local_recovery_transaction_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_members' AND transaction_id = ?2 ORDER BY row_ordinal LIMIT 1001;").unwrap().query_map(params![archive_id, "pending"], |r| r.get(3)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert!(plan.iter().any(|line| line.contains("SEARCH")
            && line.contains("library_local_recovery_transaction_rows")
            && line.contains("recovery_id=? AND table_key=? AND transaction_id=?")));
        assert!(plan.iter().all(|line| !line.contains("TEMP B-TREE")));
        consumer.execute("UPDATE library_local_recovery_rows SET transaction_id = 'other' WHERE recovery_id = ?1 AND table_key = 'library_intent_members';", [&archive_id]).unwrap();
        assert!(
            crate::normalized_recovery_input::load_archived_intent_input(
                &consumer,
                &archive_id,
                "pending"
            )
            .unwrap_err()
            .contains("incomplete")
        );
        assert!(
            crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 121)
                .unwrap_err()
                .contains("transaction index changed")
        );
        consumer.execute("UPDATE library_local_recovery_rows SET transaction_id = 'pending' WHERE recovery_id = ?1 AND table_key = 'library_intent_members';", [&archive_id]).unwrap();

        let recovery_summary = crate::read_consumer_recovery_summary_v1(&consumer)
            .unwrap()
            .unwrap();
        assert_eq!(recovery_summary.state, "archived");
        assert_eq!(recovery_summary.archived_pending_edits, 1);
        assert_eq!(recovery_summary.archived_published_edits, 0);
        consumer.execute("UPDATE library_local_recovery_archives SET successor_epoch_id = ?2 WHERE recovery_id = ?1;", params![archive_id, "0".repeat(64)]).unwrap();
        assert!(crate::read_consumer_recovery_summary_v1(&consumer)
            .unwrap_err()
            .contains("missing its current archive"));
        consumer.execute("UPDATE library_local_recovery_archives SET successor_epoch_id = ?2 WHERE recovery_id = ?1;", params![archive_id, recovery_summary.successor_epoch_id]).unwrap();

        assert_eq!(
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&consumer).unwrap(),
            pre_archive
        );
        let (columns, archived): (String, Vec<u8>) = consumer.query_row("SELECT columns_json, canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions' AND row_ordinal = 0;", [&archive_id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        let columns: Vec<String> = serde_json::from_str(&columns).unwrap();
        let archived: Vec<Vec<String>> = serde_json::from_slice(&archived).unwrap();
        let index = columns
            .iter()
            .position(|name| name == "canonical_transaction")
            .unwrap();
        assert_eq!(
            archived[index],
            vec![
                "blob".to_string(),
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &recovered.0)
            ]
        );
        drop(consumer);
        let mut consumer = open_normalized_sqlite_database_v1(
            &directory.path().join("proof-consumer.sqlite"),
            false,
        )
        .unwrap();
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&consumer).is_err()
        );
        assert!(
            crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(&consumer)
                .is_err()
        );
        let archive_refresh = stage_replica(&mut consumer, &database, "archived-consumer-refresh");
        crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
            &mut consumer,
            "archived-consumer-refresh",
            &archive_refresh,
        )
        .unwrap();

        let archive_status = crate::read_native_handoff_status_v1(&mut consumer)
            .unwrap()
            .unwrap();
        assert_eq!(
            archive_status.installation_role,
            crate::HandoffInstallationRoleV1::Consumer
        );
        assert_eq!(archive_status.phase, crate::HandoffPhaseV1::Recovery);
        consumer
            .execute(
                "DELETE FROM library_local_invalidations WHERE sequence = 9007199254740990;",
                [],
            )
            .unwrap();
        assert!(
            crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 121)
                .unwrap_err()
                .contains("live rows changed")
        );
        consumer.execute("INSERT INTO library_local_invalidations VALUES (9007199254740990, 'feed_item', 'recovery-sentinel', 'optimistic_added');", []).unwrap();
        consumer.execute("INSERT INTO library_local_invalidations VALUES (9007199254740991, 'feed_item', 'new-recovery-row', 'optimistic_added');", []).unwrap();
        assert!(
            crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 121)
                .unwrap_err()
                .contains("live rows changed")
        );
        consumer
            .execute(
                "DELETE FROM library_local_invalidations WHERE sequence = 9007199254740991;",
                [],
            )
            .unwrap();
        consumer.execute("UPDATE library_intent_transactions SET canonical_transaction = X'5b5d' WHERE transaction_id = 'pending';", []).unwrap();
        assert!(
            crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 121)
                .unwrap_err()
                .contains("live rows changed")
        );
        consumer.execute("UPDATE library_intent_transactions SET canonical_transaction = ?1 WHERE transaction_id = 'pending';", [&recovered.0]).unwrap();

        assert_eq!(
            crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 121).unwrap(),
            archive_id
        );
        consumer.execute_batch("CREATE TEMP TRIGGER refuse_reenrollment AFTER UPDATE OF reenrollment_receipt ON library_local_recovery_archives BEGIN SELECT RAISE(ABORT, 'injected reenrollment failure'); END;").unwrap();
        assert!(crate::prepare_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            123
        )
        .is_err());
        assert!(consumer.query_row("SELECT reenrollment_receipt IS NULL FROM library_local_recovery_archives WHERE recovery_id = ?1;", [&archive_id], |r| r.get::<_, bool>(0)).unwrap());
        consumer
            .execute_batch("DROP TRIGGER refuse_reenrollment;")
            .unwrap();
        consumer.execute_batch("CREATE TEMP TRIGGER corrupt_reenrollment_readback AFTER UPDATE OF reenrollment_receipt ON library_local_recovery_archives BEGIN UPDATE library_local_recovery_archives SET reenrollment_digest = replace(hex(zeroblob(32)), '0', 'f') WHERE recovery_id = NEW.recovery_id; END;").unwrap();
        assert!(crate::prepare_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            123
        )
        .unwrap_err()
        .contains("readback changed"));
        assert!(consumer.query_row("SELECT reenrollment_receipt IS NULL FROM library_local_recovery_archives WHERE recovery_id = ?1;", [&archive_id], |r| r.get::<_, bool>(0)).unwrap());
        consumer
            .execute_batch("DROP TRIGGER corrupt_reenrollment_readback;")
            .unwrap();
        let next_request = crate::prepare_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            123,
        )
        .unwrap();
        assert_eq!(
            crate::prepare_consumer_recovery_v1(
                &mut consumer,
                &installation_witness,
                &actor_store,
                124
            )
            .unwrap()
            .state,
            "prepared"
        );
        assert_ne!(next_request.actor_id, offline_actor);
        assert_ne!(next_request.actor_id, actor);
        assert_eq!(next_request.actor_public_key, actor_public);
        let successor_authority =
            crate::normalized_writer_reassignment::current_authority(&consumer)
                .unwrap()
                .0;
        let next_certificate = crate::countersign_actor_enrollment_request_bytes(
            next_request.canonical_enrollment_request_json.as_bytes(),
            &pending,
        )
        .unwrap();
        let verified_next = crate::normalized_enrollment_verifier::verify_actor_enrollment(
            &next_certificate,
            &successor_authority,
        )
        .unwrap();
        assert_eq!(verified_next.actor_id, next_request.actor_id);
        assert_eq!(
            consumer
                .query_row(
                    "SELECT actor_id FROM library_follower_actor_request WHERE singleton_id = 1;",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            offline_actor
        );
        assert_eq!(consumer.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id = 'pending';", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(), recovered.0);
        assert!(!consumer
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM library_actors WHERE actor_id = ?1);",
                [&next_request.actor_id],
                |r| r.get::<_, bool>(0)
            )
            .unwrap());
        drop(consumer);
        let mut consumer = open_normalized_sqlite_database_v1(
            &directory.path().join("proof-consumer.sqlite"),
            false,
        )
        .unwrap();
        assert_eq!(
            crate::prepare_consumer_epoch_reenrollment_v1(
                &mut consumer,
                &archive_id,
                &installation_witness,
                &actor_store,
                124
            )
            .unwrap(),
            next_request
        );
        assert!(crate::prepare_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &"d".repeat(64),
            &actor_store,
            124
        )
        .is_err());
        assert!(crate::prepare_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &Store::default(),
            124
        )
        .is_err());
        assert_eq!(actor_store.writes.get(), 0);
        let saved_receipt: Vec<u8> = consumer.query_row("SELECT reenrollment_receipt FROM library_local_recovery_archives WHERE recovery_id = ?1;", [&archive_id], |r| r.get(0)).unwrap();
        consumer.execute("UPDATE library_local_recovery_archives SET reenrollment_receipt = X'00' WHERE recovery_id = ?1;", [&archive_id]).unwrap();
        assert!(crate::prepare_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            124
        )
        .unwrap_err()
        .contains("receipt changed"));
        consumer.execute("UPDATE library_local_recovery_archives SET reenrollment_receipt = ?2 WHERE recovery_id = ?1;", params![archive_id, saved_receipt]).unwrap();
        let archived_transaction: Vec<u8> = consumer.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get(0)).unwrap();
        consumer.execute("UPDATE library_local_recovery_rows SET canonical_row = X'00' WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id]).unwrap();
        assert!(
            crate::archive_consumer_epoch_recovery_v1(&mut consumer, &actor_store, 122).is_err()
        );
        assert_eq!(consumer.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id = 'pending';", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(), recovered.0);
        assert!(crate::commit_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            125
        )
        .is_err());
        consumer.execute("UPDATE library_local_recovery_rows SET canonical_row = ?2 WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", params![archive_id, archived_transaction]).unwrap();
        crate::normalized_preference_projection::check_projected_recovery_commit(
            &consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            &next_certificate,
        );
        let before_commit = crate::describe_normalized_checkpoint_export_v2(&consumer).unwrap();
        consumer.execute_batch("CREATE TEMP TRIGGER refuse_recovery_commit AFTER UPDATE OF phase ON library_local_handoff WHEN NEW.phase = 'following' BEGIN SELECT RAISE(ABORT, 'injected recovery commit failure'); END;").unwrap();
        assert!(crate::commit_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            125
        )
        .is_err());
        assert_eq!(
            consumer
                .query_row(
                    "SELECT actor_id FROM library_follower_actor_request WHERE singleton_id = 1;",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            offline_actor
        );
        assert_eq!(consumer.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id = 'pending';", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(), recovered.0);
        assert!(consumer.query_row("SELECT reenrollment_committed_at IS NULL FROM library_local_recovery_archives WHERE recovery_id = ?1;", [&archive_id], |r| r.get::<_, bool>(0)).unwrap());
        consumer
            .execute_batch("DROP TRIGGER refuse_recovery_commit;")
            .unwrap();
        assert_eq!(
            crate::commit_consumer_epoch_reenrollment_v1(
                &mut consumer,
                &archive_id,
                &installation_witness,
                &actor_store,
                125
            )
            .unwrap(),
            next_request
        );
        assert_eq!(
            crate::describe_normalized_checkpoint_export_v2(&consumer).unwrap(),
            before_commit
        );
        assert_eq!(
            consumer
                .query_row(
                    "SELECT count(*) FROM library_intent_transactions;",
                    [],
                    |r| r.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(consumer.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get::<_, Vec<u8>>(0)).unwrap(), archived_transaction);
        assert_eq!(
            crate::normalized_follower::normalized_follower_runtime_status_v2(&consumer)
                .unwrap()
                .state,
            "enrollment_pending"
        );
        assert!(
            crate::normalized_follower::normalized_follower_mutation_context_v1(&consumer).is_err()
        );
        drop(consumer);
        let mut consumer = open_normalized_sqlite_database_v1(
            &directory.path().join("proof-consumer.sqlite"),
            false,
        )
        .unwrap();
        assert_eq!(
            crate::commit_consumer_epoch_reenrollment_v1(
                &mut consumer,
                &archive_id,
                &installation_witness,
                &actor_store,
                126
            )
            .unwrap(),
            next_request
        );
        crate::normalized_follower::install_normalized_follower_actor_enrollment_v2(
            &mut consumer,
            &next_certificate,
        )
        .unwrap();
        assert_eq!(
            crate::normalized_follower::normalized_follower_runtime_status_v2(&consumer)
                .unwrap()
                .state,
            "active"
        );
        assert_eq!(
            crate::normalized_follower::normalized_follower_mutation_context_v1(&consumer)
                .unwrap()
                .actor_id,
            next_request.actor_id
        );
        assert_eq!(
            crate::load_normalized_local_actor_id_v2(
                &consumer,
                &library,
                &installation_witness,
                &actor_store
            )
            .unwrap(),
            next_request.actor_id
        );
        assert_eq!(
            crate::commit_consumer_epoch_reenrollment_v1(
                &mut consumer,
                &archive_id,
                &installation_witness,
                &actor_store,
                127
            )
            .unwrap(),
            next_request
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&consumer).is_err()
        );
        assert!(crate::require_normalized_provider_handoff_admission_v2(&consumer).is_err());
        let following_summary = crate::prepare_consumer_recovery_v1(
            &mut consumer,
            &installation_witness,
            &actor_store,
            128,
        )
        .unwrap();
        assert_eq!(following_summary.state, "following");
        assert_eq!(following_summary.archived_pending_edits, 1);
        consumer.execute("UPDATE library_local_recovery_archives SET pending_intent_count = 2 WHERE recovery_id = ?1;", [&archive_id]).unwrap();
        assert!(crate::commit_consumer_epoch_reenrollment_v1(
            &mut consumer,
            &archive_id,
            &installation_witness,
            &actor_store,
            129
        )
        .unwrap_err()
        .contains("archive is incomplete"));
        consumer.execute("UPDATE library_local_recovery_archives SET pending_intent_count = 1 WHERE recovery_id = ?1;", [&archive_id]).unwrap();
        // A recovered consumer can prepare and cancel a later transfer without
        // tying archive visibility to the singleton's current role.
        if !recovered_incarnation && !cancelled_consumer {
            let future_path = directory.path().join("recovered-target.sqlite");
            let mut future = open_normalized_sqlite_database_v1(&future_path, true).unwrap();
            rusqlite::backup::Backup::new(&consumer, &mut future)
                .unwrap()
                .run_to_completion(128, std::time::Duration::ZERO, None)
                .unwrap();
            let expected = crate::read_consumer_recovery_summary_v1(&future)
                .unwrap()
                .unwrap();
            let plan: String = future.query_row(
                "EXPLAIN QUERY PLAN SELECT recovery_id FROM library_local_recovery_archives WHERE library_id = ?1 AND successor_epoch_id = ?2 AND reenrollment_digest = ?3 LIMIT 2;",
                params![library, next_request.authority_epoch_id, "0".repeat(64)], |r| r.get(3),
            ).unwrap();
            assert!(
                plan.contains("USING INDEX library_local_recovery_enrollment"),
                "{plan}"
            );
            let future_pending = Store::default();
            future.execute_batch("CREATE TEMP TRIGGER refuse_recovered_readiness BEFORE INSERT ON library_local_handoff BEGIN SELECT RAISE(ABORT, 'injected recovered readiness failure'); END;").unwrap();
            assert!(prepare_target_handoff_readiness_v1(
                &mut future,
                &actor_store,
                &future_pending,
                2300
            )
            .unwrap_err()
            .contains("injected recovered readiness failure"));
            assert_eq!(
                crate::read_consumer_recovery_summary_v1(&future)
                    .unwrap()
                    .unwrap(),
                expected
            );
            assert_eq!(
                crate::read_native_handoff_status_v1(&mut future)
                    .unwrap()
                    .unwrap()
                    .phase,
                crate::HandoffPhaseV1::Following
            );
            future
                .execute_batch("DROP TRIGGER refuse_recovered_readiness;")
                .unwrap();
            let ready = prepare_target_handoff_readiness_v1(
                &mut future,
                &actor_store,
                &future_pending,
                2300,
            )
            .unwrap();
            assert_eq!(
                crate::read_consumer_recovery_summary_v1(&future)
                    .unwrap()
                    .unwrap(),
                expected
            );
            assert!(
                crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&future)
                    .is_err()
            );
            drop(future);
            let mut future = open_normalized_sqlite_database_v1(&future_path, false).unwrap();
            assert_eq!(
                prepare_target_handoff_readiness_v1(
                    &mut future,
                    &actor_store,
                    &future_pending,
                    2301
                )
                .unwrap(),
                ready
            );
            assert_eq!(
                crate::read_consumer_recovery_summary_v1(&future)
                    .unwrap()
                    .unwrap(),
                expected
            );
            future.execute("UPDATE library_local_recovery_archives SET reenrollment_receipt = X'00' WHERE recovery_id = ?1;", [&archive_id]).unwrap();
            assert!(crate::read_consumer_recovery_summary_v1(&future).is_err());
            future.execute("UPDATE library_local_recovery_archives SET reenrollment_receipt = ?2 WHERE recovery_id = ?1;", params![archive_id, saved_receipt]).unwrap();
            future.execute("INSERT INTO library_local_recovery_archives SELECT ?1, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, pending_intent_count, published_intent_count, archive_digest, created_at, reenrollment_committed_at, reenrollment_receipt, reenrollment_digest, reenrollment_installation_witness FROM library_local_recovery_archives WHERE recovery_id = ?2;", params!["0".repeat(64), archive_id]).unwrap();
            assert!(crate::read_consumer_recovery_summary_v1(&future)
                .unwrap_err()
                .contains("ambiguous"));
            future
                .execute(
                    "DELETE FROM library_local_recovery_archives WHERE recovery_id = ?1;",
                    ["0".repeat(64)],
                )
                .unwrap();
            let body = json!({
                "format": "freed_library_handoff_cancellation_v1",
                "readiness": serde_json::from_str::<Value>(&ready).unwrap(),
                "predecessor_authority_public_key": lower_hex(pending_key.public_key().as_ref()),
                "cancelled_at_ms": 2400
            });
            let proof_digest = super::digest("handoff-cancellation-body", &body).unwrap();
            let proof = canonical_handoff_bytes(&json!({
                "body": body, "cancellation_digest": proof_digest,
                "predecessor_signature": lower_hex(pending_key.sign(&signature_input("handoff-predecessor-cancellation", &proof_digest).unwrap()).as_ref())
            })).unwrap();
            crate::accept_target_handoff_cancellation_v1(&mut future, &proof, 2500).unwrap();
            crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&future).unwrap();
            assert_eq!(
                crate::read_consumer_recovery_summary_v1(&future)
                    .unwrap()
                    .unwrap(),
                expected
            );
            assert_eq!(future.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get::<_, Vec<u8>>(0)).unwrap(), archived_transaction);
            let envelopes = crate::normalized_operation_test_fixtures::tests::signed_envelopes(
                &actor_key,
                &verified_next,
            );
            let edit = crate::normalized_follower::enqueue_normalized_follower_intent_v1(
                &mut future,
                &envelopes,
                2501,
            )
            .unwrap();
            assert_eq!(edit.first_counter, 1);
            assert!(prepare_target_handoff_readiness_v1(
                &mut future,
                &actor_store,
                &future_pending,
                2502
            )
            .unwrap_err()
            .contains("all edits settled"));
        }
        let new_envelopes = crate::normalized_operation_test_fixtures::tests::signed_envelopes(
            &actor_key,
            &verified_next,
        );
        let new_edit = crate::normalized_follower::enqueue_normalized_follower_intent_v1(
            &mut consumer,
            &new_envelopes,
            2200,
        )
        .unwrap();
        assert_eq!(new_edit.first_counter, 1);
        assert_eq!(new_edit.last_counter, 2);
        assert_eq!(
            crate::commit_consumer_epoch_reenrollment_v1(
                &mut consumer,
                &archive_id,
                &installation_witness,
                &actor_store,
                2201
            )
            .unwrap(),
            next_request
        );
        assert_eq!(
            crate::normalized_follower::normalized_follower_runtime_status_v2(&consumer)
                .unwrap()
                .pending_intent_count,
            1
        );
        assert_eq!(
            crate::normalized_follower::normalized_follower_mutation_context_v1(&consumer)
                .unwrap()
                .next_counter,
            3
        );
        assert_eq!(consumer.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get::<_, Vec<u8>>(0)).unwrap(), archived_transaction);
        // Isolate a second consumer cycle from the remaining target-activation
        // assertions. The successor certificate is genuinely predecessor-signed;
        // selecting its checkpoint rows here is a fixture, not a cloud CAS claim.
        {
            let repeated_path = directory.path().join("repeated-consumer.sqlite");
            let mut repeated = open_normalized_sqlite_database_v1(&repeated_path, true).unwrap();
            rusqlite::backup::Backup::new(&consumer, &mut repeated)
                .unwrap()
                .run_to_completion(128, std::time::Duration::ZERO, None)
                .unwrap();
            let (current, _, _, _) =
                crate::normalized_writer_reassignment::current_authority(&repeated).unwrap();
            let (current_writer, current_digest): (String, String) = repeated.query_row(
                "SELECT active.writer_id, epoch.transition_certificate_digest FROM library_active_authority AS active
                 JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id;", [],
                |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            let third_key = Ed25519KeyPair::from_seed_unchecked(&[99; 32]).unwrap();
            let predecessor = HandoffPredecessorV1 {
                library_id: &library,
                epoch_id: &current.epoch_id,
                epoch: current.epoch as u64,
                certificate_digest: &current_digest,
                authority_public_key: &current.authority_public_key,
                writer_id: &current_writer,
            };
            let readiness = sign_handoff_readiness_v1(
                HandoffReadinessBodyV1 {
                    format: READY_FORMAT.into(),
                    library_id: library.clone(),
                    predecessor_epoch_id: current.epoch_id.clone(),
                    predecessor_certificate_digest: current_digest.clone(),
                    target_actor_id: next_request.actor_id.clone(),
                    target_actor_public_key: actor_public.clone(),
                    target_authority_public_key: lower_hex(third_key.public_key().as_ref()),
                    native_storage_version: 2,
                    checkpoint_schema_version: 1,
                    replication_protocol_version: 2,
                    created_at_ms: 2300,
                },
                &actor_key,
                &third_key,
            )
            .unwrap();
            let mut third_body = target_grant.body.clone();
            third_body.readiness = readiness;
            third_body.predecessor_authority_public_key = current.authority_public_key.clone();
            third_body.successor_epoch = current.epoch as u64 + 1;
            third_body.source_control.storage_epoch = current.epoch_id.clone();
            third_body.source_control.writer_id = current_writer.clone();
            third_body.source_control.manifest.descriptor.object_key = format!(
                "freed-v2-manifest~{library}~e{}~g{}~{}.json",
                current.epoch_id,
                third_body.source_control.generation,
                third_body.source_control.manifest.descriptor.content_digest
            );
            let third_grant = sign_handoff_authorization_v1(
                third_body,
                &predecessor,
                &actor_public,
                &pending_key,
            )
            .unwrap();
            let third = crate::normalized_handoff_writer_certificate::prepare_writer_handoff_certificate_v1(
                &current, &current_writer, &current_digest, &canonical_handoff_bytes(&third_grant).unwrap(), &actor_public, &third_key,
            ).unwrap();
            repeated.execute("INSERT INTO library_authority_epochs
                (epoch_id, library_id, epoch_number, authority_key_id, authority_public_key, transition_certificate_digest,
                 canonical_transition_certificate, accepted_manifest_generation, checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                SELECT ?1, library_id, ?2, ?3, ?4, ?5, ?6, accepted_manifest_generation,
                       checkpoint_frontier_digest, materialized_state_digest, 2301 FROM library_authority_epochs WHERE epoch_id = ?7;",
                params![third.authority.epoch_id, third.authority.epoch, third.authority.authority_key_id, third.authority.authority_public_key,
                    third.transition_certificate_digest, third.canonical_certificate_json, current.epoch_id]).unwrap();
            repeated
                .execute(
                    "UPDATE library_active_authority SET epoch_id = ?1, writer_id = ?2;",
                    params![
                        third.authority.epoch_id,
                        third_grant.body.readiness.body.target_actor_id
                    ],
                )
                .unwrap();
            repeated
                .execute(
                    "UPDATE library_meta SET authority_epoch = ?1;",
                    [&third.authority.epoch_id],
                )
                .unwrap();
            repeated.execute("UPDATE library_follower_checkpoint_receipt SET authority_epoch_id = ?1, writer_actor_id = ?2;",
                params![third.authority.epoch_id, third_grant.body.readiness.body.target_actor_id]).unwrap();
            let third_receipt = crate::NormalizedFollowerCheckpointReceiptV2 {
                writer_actor_id: third_grant.body.readiness.body.target_actor_id.clone(),
                ..new_receipt.clone()
            };
            verify_existing_handoff_checkpoint_install_v1(
                &repeated,
                "unused-consumer-digest",
                Some(&third_receipt),
            )
            .expect("a completed consumer cycle must admit its verified next successor checkpoint");
            assert!(verify_existing_handoff_checkpoint_install_v1(
                &repeated,
                "unused-consumer-digest",
                None
            )
            .is_err());
            assert!(verify_existing_handoff_checkpoint_install_v1(
                &repeated,
                "unused-consumer-digest",
                Some(&new_receipt)
            )
            .is_err());
            let previous_digest: String = repeated.query_row("SELECT archive_digest FROM library_local_recovery_archives WHERE recovery_id = ?1;", [&archive_id], |r| r.get(0)).unwrap();
            // A pre-existing local link has no FK to the active intent tables.
            repeated.execute("INSERT INTO library_local_recovery_reissues VALUES (?1, 'pending', ?2, ?3, 'retained:replacement', ?3, ?4, ?5, 1, 1, 1, ?3, 0, 0, 2000);",
                params![archive_id, previous_digest, "8".repeat(64), current.epoch_id, next_request.actor_id]).unwrap();
            assert!(crate::read_consumer_recovery_summary_v1(&repeated)
                .unwrap()
                .is_none());
            // Corrupt prior receipt bytes cannot turn a completed cycle into permission.
            let retained_digest: String = repeated.query_row("SELECT reenrollment_digest FROM library_local_recovery_archives WHERE recovery_id = ?1;", [&archive_id], |r| r.get(0)).unwrap();
            repeated.execute("UPDATE library_local_recovery_archives SET reenrollment_digest = ?1 WHERE recovery_id = ?2;", params!["0".repeat(64), archive_id]).unwrap();
            assert!(crate::read_consumer_recovery_summary_v1(&repeated).is_err());
            assert!(verify_existing_handoff_checkpoint_install_v1(
                &repeated,
                "unused-consumer-digest",
                Some(&third_receipt)
            )
            .is_err());
            assert!(
                crate::archive_consumer_epoch_recovery_v1(&mut repeated, &actor_store, 2302)
                    .is_err()
            );
            repeated.execute("UPDATE library_local_recovery_archives SET reenrollment_digest = ?1 WHERE recovery_id = ?2;", params![retained_digest, archive_id]).unwrap();
            for (role, phase) in [
                ("source", "authorized"),
                ("target", "cas_pending"),
                ("consumer", "recovery"),
            ] {
                repeated
                    .execute(
                        "UPDATE library_local_handoff SET installation_role = ?1, phase = ?2;",
                        params![role, phase],
                    )
                    .unwrap();
                assert!(crate::archive_consumer_epoch_recovery_v1(
                    &mut repeated,
                    &actor_store,
                    2302
                )
                .unwrap_err()
                .contains("cannot replace another lifecycle fence"));
                assert_eq!(
                    repeated
                        .query_row(
                            "SELECT count(*) FROM library_local_recovery_archives;",
                            [],
                            |r| r.get::<_, i64>(0)
                        )
                        .unwrap(),
                    1
                );
            }
            repeated.execute("UPDATE library_local_handoff SET installation_role = 'consumer', phase = 'following';", []).unwrap();
            // A failure after lifecycle replacement rolls back to the prior fence
            // and leaves both the old archive and the new pending edits untouched.
            repeated.execute_batch("CREATE TEMP TRIGGER fail_second_archive BEFORE INSERT ON library_local_recovery_rows
                BEGIN SELECT RAISE(ABORT, 'second archive fault'); END;").unwrap();
            assert!(
                crate::archive_consumer_epoch_recovery_v1(&mut repeated, &actor_store, 2302)
                    .unwrap_err()
                    .contains("second archive fault")
            );
            assert_eq!(
                repeated
                    .query_row("SELECT phase FROM library_local_handoff;", [], |r| r
                        .get::<_, String>(0))
                    .unwrap(),
                "following"
            );
            assert_eq!(
                repeated
                    .query_row(
                        "SELECT count(*) FROM library_local_recovery_archives;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                1
            );
            assert_eq!(
                repeated
                    .query_row(
                        "SELECT count(*) FROM library_intent_transactions;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                1
            );
            repeated
                .execute_batch("DROP TRIGGER fail_second_archive;")
                .unwrap();
            let second =
                crate::archive_consumer_epoch_recovery_v1(&mut repeated, &actor_store, 2303)
                    .unwrap();
            assert_ne!(second, archive_id);
            assert_eq!(
                crate::archive_consumer_epoch_recovery_v1(&mut repeated, &actor_store, 2304)
                    .unwrap(),
                second
            );
            assert_eq!(repeated.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get::<_, Vec<u8>>(0)).unwrap(), archived_transaction);
            assert_eq!(
                repeated
                    .query_row(
                        "SELECT replacement_transaction_id FROM library_local_recovery_reissues;",
                        [],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "retained:replacement"
            );
            let before_commit = crate::prepare_consumer_recovery_v1(
                &mut repeated,
                &installation_witness,
                &actor_store,
                2305,
            )
            .unwrap();
            assert_eq!(before_commit.recovery_id, second);
            assert_eq!(before_commit.state, "prepared");
            drop(repeated);
            let mut repeated = open_normalized_sqlite_database_v1(&repeated_path, false).unwrap();
            let third_request = crate::commit_consumer_epoch_reenrollment_v1(
                &mut repeated,
                &second,
                &installation_witness,
                &actor_store,
                2306,
            )
            .unwrap();
            assert_ne!(third_request.actor_id, next_request.actor_id);
            assert_eq!(third_request.authority_epoch_id, third.authority.epoch_id);
            assert_eq!(
                crate::read_consumer_recovery_summary_v1(&repeated)
                    .unwrap()
                    .unwrap()
                    .state,
                "following"
            );
            assert_eq!(
                repeated
                    .query_row(
                        "SELECT count(*) FROM library_local_recovery_archives;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                2
            );
            assert_eq!(
                repeated
                    .query_row(
                        "SELECT count(*) FROM library_local_recovery_reissues;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                1
            );
            let archive_request = json!({"queryId": "recovery_archive_page_v1", "schemaVersion": 1,
                "limit": 1, "cursor": null, "cancellationId": "archives-cancel", "readerSessionId": "archives-reader"});
            let first = crate::normalized_query::query_normalized_json_v1(
                &mut repeated,
                archive_request.clone(),
            )
            .unwrap();
            let mut next = archive_request.clone();
            next["cursor"] = first["nextCursor"].clone();
            assert!(next["cursor"].is_string());
            let last =
                crate::normalized_query::query_normalized_json_v1(&mut repeated, next.clone())
                    .unwrap();
            assert!(last["nextCursor"].is_null());
            let mut ids = [archive_id.clone(), second.clone()];
            ids.sort();
            assert_eq!(first["rows"][0]["recoveryId"], ids[0]);
            assert_eq!(last["rows"][0]["recoveryId"], ids[1]);
            let retained_handoff: String = repeated
                .query_row("SELECT handoff_id FROM library_local_handoff;", [], |r| {
                    r.get(0)
                })
                .unwrap();
            repeated
                .execute(
                    "UPDATE library_local_handoff SET handoff_id = ?1;",
                    ["9".repeat(64)],
                )
                .unwrap();
            assert!(
                crate::normalized_query::query_normalized_json_v1(&mut repeated, next)
                    .unwrap_err()
                    .to_string()
                    .contains("CURSOR_STALE")
            );
            repeated
                .execute(
                    "UPDATE library_local_handoff SET handoff_id = ?1;",
                    [retained_handoff],
                )
                .unwrap();
            let old_page = crate::normalized_query::query_normalized_json_v1(
                &mut repeated,
                page_request.clone(),
            )
            .unwrap();
            assert_eq!(old_page["rows"][0]["transactionId"], "pending");
            let program = crate::sqlite_contract_generated::SQLITE_QUERY_PROGRAMS
                .iter()
                .find(|p| p.query_id == "recovery_archive_page_v1")
                .unwrap();
            let plan = repeated
                .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
                .unwrap()
                .query_map(params!["", 65], |r| r.get::<_, String>(3))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            assert!(plan.iter().any(|line| line
                .contains("SEARCH library_local_recovery_archives")
                && line.contains("recovery_id>?")));
            assert!(plan.iter().all(|line| !line.contains("TEMP B-TREE")));
            // Discovery must not make the oldest malformed retention fixture trusted.
            repeated.execute("DELETE FROM library_local_recovery_reissues WHERE replacement_transaction_id = 'retained:replacement';", []).unwrap();
            let mut old_review = page_request.clone();
            old_review["queryId"] = json!("recovery_intent_review_v1");
            old_review["transactionId"] = json!("pending");
            assert!(crate::normalized_query::query_normalized_json_v1(
                &mut repeated,
                old_review.clone()
            )
            .unwrap_err()
            .to_string()
            .contains("signature verification failed"));
            // The second archive contains a real signed edit from the preceding
            // epoch. Its review remains valid after the second reenrollment.
            let mut second_page_request = page_request.clone();
            second_page_request["recoveryId"] = json!(second);
            let second_page = crate::normalized_query::query_normalized_json_v1(
                &mut repeated,
                second_page_request,
            )
            .unwrap();
            old_review["recoveryId"] = json!(second);
            old_review["transactionId"] = second_page["rows"][0]["transactionId"].clone();
            let verified_old = crate::normalized_query::query_normalized_json_v1(
                &mut repeated,
                old_review.clone(),
            )
            .unwrap();
            assert_eq!(verified_old["transactionId"], old_review["transactionId"]);
            assert_eq!(verified_old["recoveryId"], second);
            assert!(crate::require_normalized_provider_handoff_admission_v2(&repeated).is_err());
        }
        assert_eq!(
            crate::load_normalized_local_actor_id_v2(
                &database,
                &library,
                &installation_witness,
                &actor_store
            )
            .unwrap(),
            actor
        );
        database.execute_batch("CREATE TEMP TABLE saved_local_actor_request AS SELECT * FROM library_follower_actor_request; DELETE FROM library_follower_actor_request;").unwrap();
        assert_eq!(
            crate::load_normalized_local_actor_id_v2(
                &database,
                &library,
                &installation_witness,
                &actor_store
            )
            .unwrap(),
            actor
        );
        assert!(crate::load_normalized_local_actor_id_v2(
            &database,
            &library,
            &"9".repeat(64),
            &actor_store
        )
        .is_err());
        database.execute_batch("INSERT INTO library_follower_actor_request SELECT * FROM saved_local_actor_request; DROP TABLE saved_local_actor_request;").unwrap();
        let replay = stage_target_handoff_v1(
            &mut database,
            &target_grant.body.readiness.handoff_id,
            &installation_witness,
            &actor_store,
            &pending,
            102,
        )
        .unwrap();
        assert_eq!(
            replay.canonical_certificate_json,
            staged.canonical_certificate_json
        );
        assert_eq!(replay.authority, staged.authority);
        crate::normalized_handoff::require_handoff_checkpoint_export_v1(
            &database,
            &target_grant.body.readiness.handoff_id,
        )
        .expect("fenced successor is exportable without opening admission");
        assert!(
            crate::normalized_handoff::require_handoff_checkpoint_export_v1(
                &database,
                &"0".repeat(64),
            )
            .is_err()
        );
        database.execute("UPDATE library_authority_epochs SET canonical_transition_certificate = '{}' WHERE epoch_id = ?1;",
            [&staged.authority.epoch_id]).unwrap();
        assert!(
            crate::normalized_handoff::require_handoff_checkpoint_export_v1(
                &database,
                &target_grant.body.readiness.handoff_id,
            )
            .is_err(),
            "export must reverify the successor proof"
        );
        database.execute("UPDATE library_authority_epochs SET canonical_transition_certificate = ?1 WHERE epoch_id = ?2;",
            params![staged.canonical_certificate_json, staged.authority.epoch_id]).unwrap();

        assert!(stage_target_handoff_v1(
            &mut database,
            &target_grant.body.readiness.handoff_id,
            &"0".repeat(64),
            &actor_store,
            &pending,
            103
        )
        .is_err());
        pending.bytes.replace(None);
        assert!(stage_target_handoff_v1(
            &mut database,
            &target_grant.body.readiness.handoff_id,
            &installation_witness,
            &actor_store,
            &pending,
            103
        )
        .is_err());
        assert!(pending.bytes.borrow().is_none());
        assert_eq!(pending.writes.get(), 1);
        let selected =
            crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&database).unwrap();
        let mut successor_control = target_grant.body.source_control.clone();
        successor_control.storage_epoch = selected.authority_epoch.clone();
        successor_control.writer_id = selected.writer_id.clone();
        successor_control.generation = 0;
        successor_control.manifest.descriptor.object_key = format!(
            "freed-v2-manifest~{}~e{}~g0~{}.json",
            selected.library_id,
            selected.authority_epoch,
            successor_control.manifest.descriptor.content_digest
        );
        let id = &target_grant.body.readiness.handoff_id;
        // Enrollment without accepted operations carries the predecessor frontier.
        assert_eq!(
            successor_control.causal_frontier_digest,
            selected.causal_frontier_digest
        );
        successor_control.causal_frontier_digest = "0".repeat(64);
        assert!(
            prepare_target_handoff_activation_v1(
                &mut database,
                id,
                "control-file",
                &canonical_handoff_bytes(&successor_control).unwrap(),
                104
            )
            .is_err(),
            "a mismatched frontier cannot authorize successor activation"
        );
        successor_control.causal_frontier_digest = selected.causal_frontier_digest.clone();
        let (manifest_bytes, compressed_pages) =
            exported_transport(&database, &mut successor_control);
        use sha2::{Digest, Sha256};
        let hash = |bytes: &[u8]| lower_hex(&Sha256::digest(bytes));
        let control_bytes = canonical_handoff_bytes(&successor_control).unwrap();
        // The source may return after the successor has published later generations.
        let mut adoption_manifest: serde_json::Value =
            serde_json::from_slice(&manifest_bytes).unwrap();
        adoption_manifest["generation"] = json!(7);
        for page in adoption_manifest["pages"].as_array_mut().unwrap() {
            let key = page["object"]["descriptor"]["objectKey"]
                .as_str()
                .unwrap()
                .replace("~g0~", "~g7~");
            page["object"]["descriptor"]["objectKey"] = json!(key);
        }
        let adoption_manifest_bytes =
            crate::library_core_canonical::encode_canonical_value(&adoption_manifest, 1_048_576)
                .unwrap();
        let mut adoption_control = successor_control.clone();
        adoption_control.generation = 7;
        adoption_control.manifest.descriptor.content_digest = hash(&adoption_manifest_bytes);
        adoption_control.manifest.descriptor.byte_length = adoption_manifest_bytes.len() as u64;
        adoption_control.manifest.descriptor.object_key = format!(
            "freed-v2-manifest~{}~e{}~g7~{}.json",
            selected.library_id,
            selected.authority_epoch,
            hash(&adoption_manifest_bytes)
        );
        let adoption_control_bytes = canonical_handoff_bytes(&adoption_control).unwrap();
        // A separate source fixture preserves the unrelated rejection/fencing
        // scenarios above. Give it the exact signed grant used by this target.
        let adoption_path = directory.path().join("adopting-source.sqlite");
        let mut adopting = rusqlite::Connection::open(&adoption_path).unwrap();
        rusqlite::backup::Backup::new(&source, &mut adopting)
            .unwrap()
            .run_to_completion(64, std::time::Duration::ZERO, None)
            .unwrap();
        drop(adopting);
        let mut adopting = open_normalized_sqlite_database_v1(&adoption_path, false).unwrap();
        adopting.execute("UPDATE library_local_handoff SET handoff_id = ?1, canonical_readiness = ?2, canonical_authorization_body = ?3, canonical_authorization = ?4, expected_control_revision = ?5;",
            params![id, canonical_handoff_bytes(&target_grant.body.readiness).unwrap(), canonical_handoff_bytes(&target_grant.body).unwrap(), target_bytes, target_grant.body.source_control_revision]).unwrap();
        crate::normalized_sqlite::begin_normalized_checkpoint_stage_v2(
            &adopting,
            &crate::normalized_sqlite::BeginNormalizedCheckpointStageV2 {
                stage_id: "source-adoption".into(),
                library_id: selected.library_id.clone(),
                authority_epoch: selected.authority_epoch.clone(),
                source_revision: selected.source_revision,
                expected_record_count: selected.record_count,
                created_at: 105,
            },
        )
        .unwrap();
        let mut adoption_export = crate::normalized_sqlite::NormalizedCheckpointExportRequestV2 {
            maximum_records: 3,
            ..Default::default()
        };
        loop {
            let page = crate::normalized_sqlite::export_normalized_checkpoint_page_v2(
                &database,
                &adoption_export,
            )
            .unwrap();
            crate::normalized_sqlite::append_normalized_checkpoint_stage_page_v2(
                &mut adopting,
                "source-adoption",
                &page.records,
            )
            .unwrap();
            if page.done {
                break;
            }
            adoption_export.after = page.next_cursor;
        }
        assert!(
            crate::source_handoff_verification_plan_v1(
                &mut adopting,
                id,
                "source-adoption",
                &adoption_control_bytes
            )
            .is_err(),
            "orphaned target fixture history must not be erased by a source import"
        );
        // The initial source was cloned from the target fixture above. Build the
        // clean original-Primary case by removing only those synthetic local rows.
        // Production adoption never performs this cleanup.
        for table in crate::normalized_import::RETAINED_FOLLOWER_TABLES
            .iter()
            .rev()
        {
            adopting
                .execute(&format!("DELETE FROM {table};"), [])
                .unwrap();
        }
        let source_plan = crate::source_handoff_verification_plan_v1(
            &mut adopting,
            id,
            "source-adoption",
            &adoption_control_bytes,
        )
        .unwrap();
        source_plan
            .verify_control_read(&adoption_control_bytes, "\"source-winner\"")
            .unwrap();
        let source_pages = source_plan
            .verify_manifest(&adoption_manifest_bytes)
            .unwrap();
        let mut source_verifier = source_plan.checkpoint_verifier().unwrap();
        for (page, bytes) in source_pages.iter().zip(&compressed_pages) {
            page.verify_stored_bytes(bytes).unwrap();
            source_verifier
                .push_manifest_page(flate2::read::MultiGzDecoder::new(bytes.as_slice()), page)
                .unwrap();
        }
        source_verifier.finish().unwrap();
        assert!(crate::activate_target_handoff_after_remote_verification_v1(
            &mut adopting,
            &source_plan,
            "\"source-winner\"",
            &actor_store,
            &pending,
            &source_store,
            106
        )
        .is_err());
        let epoch_rows: Vec<(Vec<u8>, Vec<u8>)> = adopting.prepare("SELECT primary_key_canonical, record_canonical FROM library_checkpoint_stage_records WHERE stage_id = 'source-adoption' AND registry_key = '01_authority_epoch';").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        adopting.execute("UPDATE library_checkpoint_stage_records SET record_canonical = x'7b7d' WHERE stage_id = 'source-adoption' AND registry_key = '01_authority_epoch';", []).unwrap();
        assert!(crate::adopt_source_handoff_after_remote_verification_v1(
            &mut adopting,
            &source_plan,
            "\"source-winner\"",
            106
        )
        .is_err());
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut adopting)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::Authorized
        );
        for (key, bytes) in epoch_rows {
            adopting.execute("UPDATE library_checkpoint_stage_records SET record_canonical = ?1 WHERE stage_id = 'source-adoption' AND registry_key = '01_authority_epoch' AND primary_key_canonical = ?2;", params![bytes, key]).unwrap();
        }
        adopting.execute_batch("CREATE TRIGGER fail_source_receipt BEFORE INSERT ON library_follower_checkpoint_receipt BEGIN SELECT RAISE(ABORT, 'injected source receipt failure'); END;").unwrap();
        assert!(crate::adopt_source_handoff_after_remote_verification_v1(
            &mut adopting,
            &source_plan,
            "\"source-winner\"",
            106
        )
        .unwrap_err()
        .contains("injected source receipt failure"));
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut adopting)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::Authorized
        );
        {
            let tx = adopting.transaction().unwrap();
            assert_eq!(
                crate::normalized_import::selected_checkpoint_digest_v2(&tx).unwrap(),
                target_grant.body.final_checkpoint_digest
            );
        }
        adopting
            .execute_batch("DROP TRIGGER fail_source_receipt;")
            .unwrap();
        // Preserve the authorized source as if it stayed offline through the
        // target's later transfer. Its original consent must remain unchanged.
        let delayed_source_path = directory.path().join("delayed-source.sqlite");
        let mut delayed_source =
            open_normalized_sqlite_database_v1(&delayed_source_path, true).unwrap();
        rusqlite::backup::Backup::new(&adopting, &mut delayed_source)
            .unwrap()
            .run_to_completion(64, std::time::Duration::ZERO, None)
            .unwrap();
        drop(delayed_source);
        let demoted = crate::adopt_source_handoff_after_remote_verification_v1(
            &mut adopting,
            &source_plan,
            "\"source-winner\"",
            106,
        )
        .unwrap();
        assert_eq!(demoted.phase, crate::HandoffPhaseV1::Demoted);
        assert_eq!(
            demoted.successor_epoch_id.as_deref(),
            Some(selected.authority_epoch.as_str())
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&adopting).is_err()
        );
        assert!(crate::require_normalized_provider_handoff_admission_v2(&adopting).is_err());
        assert_eq!(
            adopting
                .query_row("SELECT count(*) FROM library_writer_admission", [], |r| r
                    .get::<_, u32>(
                    0
                ))
                .unwrap(),
            0
        );
        drop(adopting);
        let mut adopting = open_normalized_sqlite_database_v1(&adoption_path, false).unwrap();
        assert_eq!(
            crate::recover_demoted_source_handoff_v1(
                &mut adopting,
                id,
                "source-adoption",
                &adoption_control_bytes
            )
            .unwrap()
            .unwrap(),
            demoted
        );
        assert!(crate::recover_demoted_source_handoff_v1(
            &mut adopting,
            id,
            "different-stage",
            &adoption_control_bytes
        )
        .is_err());
        assert_eq!(
            crate::adopt_source_handoff_after_remote_verification_v1(
                &mut adopting,
                &source_plan,
                "\"source-winner\"",
                107
            )
            .unwrap(),
            demoted
        );
        assert!(
            crate::source_handoff_verification_plan_v1(
                &mut adopting,
                id,
                "source-adoption",
                &adoption_control_bytes
            )
            .is_err(),
            "the consumed stage cannot start a second adoption"
        );
        let former_source_actor_bytes =
            Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new()).unwrap();
        let former_source_actor_store = Store {
            bytes: RefCell::new(Some(former_source_actor_bytes.as_ref().to_vec())),
            writes: Cell::new(0),
        };
        let consumer_actor = crate::prepare_normalized_follower_actor_request_v2(
            &mut adopting,
            &installation_witness,
            &former_source_actor_store,
            108,
        )
        .unwrap();
        assert_eq!(
            consumer_actor.actor_id,
            crate::library_core_actor_enrollment::recovery_actor_id(
                &library,
                &installation_witness,
                &former_source_actor_store,
                id
            )
            .unwrap()
        );
        assert_ne!(consumer_actor.actor_id, actor);
        assert_eq!(
            crate::prepare_normalized_follower_actor_request_v2(
                &mut adopting,
                &installation_witness,
                &former_source_actor_store,
                109
            )
            .unwrap(),
            consumer_actor
        );
        assert!(
            crate::normalized_follower::normalized_follower_mutation_context_v1(&adopting).is_err(),
            "a prepared request is not an active enrollment"
        );
        assert!(crate::require_normalized_provider_handoff_admission_v2(&adopting).is_err());
        {
            let adoption_path = directory.path().join("return-target.sqlite");
            let mut return_copy = open_normalized_sqlite_database_v1(&adoption_path, true).unwrap();
            rusqlite::backup::Backup::new(&adopting, &mut return_copy)
                .unwrap()
                .run_to_completion(128, std::time::Duration::ZERO, None)
                .unwrap();
            drop(return_copy);
            let mut adopting = open_normalized_sqlite_database_v1(&adoption_path, false).unwrap();
            let return_pending = Store::default();
            assert!(prepare_target_handoff_readiness_v1(
                &mut adopting,
                &former_source_actor_store,
                &return_pending,
                110
            )
            .is_err());
            let successor_signer = Store {
                bytes: RefCell::new(key_before.clone()),
                writes: Cell::new(0),
            };
            let returned_certificate =
                crate::library_core_actor_enrollment::countersign_actor_enrollment_request_bytes(
                    consumer_actor.canonical_enrollment_request_json.as_bytes(),
                    &successor_signer,
                )
                .unwrap();
            crate::install_normalized_follower_actor_enrollment_v2(
                &mut adopting,
                &returned_certificate,
            )
            .unwrap();
            assert!(prepare_target_handoff_readiness_v1(
                &mut adopting,
                &former_source_actor_store,
                &return_pending,
                106
            )
            .is_err());
            let old_consent = demoted.canonical_authorization.as_ref().unwrap();
            adopting
                .execute(
                    "UPDATE library_local_handoff SET canonical_authorization = X'7B7D';",
                    [],
                )
                .unwrap();
            assert!(prepare_target_handoff_readiness_v1(
                &mut adopting,
                &former_source_actor_store,
                &return_pending,
                110
            )
            .is_err());
            adopting
                .execute(
                    "UPDATE library_local_handoff SET canonical_authorization = ?1;",
                    [old_consent.as_bytes()],
                )
                .unwrap();
            adopting.execute_batch("CREATE TEMP TRIGGER fail_return_prepare BEFORE INSERT ON library_local_handoff BEGIN SELECT RAISE(ABORT, 'injected return preparation failure'); END;").unwrap();
            assert!(prepare_target_handoff_readiness_v1(
                &mut adopting,
                &former_source_actor_store,
                &return_pending,
                110
            )
            .unwrap_err()
            .contains("injected return preparation failure"));
            assert_eq!(
                adopting
                    .query_row(
                        "SELECT count(*) FROM library_local_source_demotions;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                0
            );
            assert_eq!(
                crate::read_native_handoff_status_v1(&mut adopting)
                    .unwrap()
                    .unwrap()
                    .phase,
                crate::HandoffPhaseV1::Demoted
            );
            adopting
                .execute_batch("DROP TRIGGER fail_return_prepare;")
                .unwrap();
            let return_ready = prepare_target_handoff_readiness_v1(
                &mut adopting,
                &former_source_actor_store,
                &return_pending,
                110,
            )
            .unwrap();
            let retained: (Vec<u8>, Vec<u8>) = adopting.query_row("SELECT canonical_authorization, canonical_adoption FROM library_local_source_demotions WHERE handoff_id = ?1;", [id], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
            assert_eq!(retained.0, old_consent.as_bytes());
            assert_eq!(
                retained.1,
                demoted.canonical_activation.as_ref().unwrap().as_bytes()
            );
            assert!(
                crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&adopting)
                    .is_err()
            );
            assert!(crate::require_normalized_provider_handoff_admission_v2(&adopting).is_err());
            drop(adopting);
            let mut adopting = open_normalized_sqlite_database_v1(&adoption_path, false).unwrap();
            assert_eq!(
                prepare_target_handoff_readiness_v1(
                    &mut adopting,
                    &former_source_actor_store,
                    &return_pending,
                    111
                )
                .unwrap(),
                return_ready
            );
            assert_eq!(
                adopting
                    .query_row(
                        "SELECT count(*) FROM library_local_source_demotions;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                1
            );
            assert!(
                accept_target_handoff_authorization_v1(
                    &mut adopting,
                    old_consent.as_bytes(),
                    &former_source_actor_store,
                    &return_pending,
                    112,
                )
                .is_err(),
                "the previous transfer cannot authorize a return transfer"
            );
        }
        database.execute_batch("CREATE TRIGGER refuse_activation BEFORE UPDATE OF canonical_activation ON library_local_handoff
            BEGIN SELECT RAISE(ABORT, 'injected proposal failure'); END;").unwrap();
        assert!(prepare_target_handoff_activation_v1(
            &mut database,
            id,
            "control-file",
            &control_bytes,
            104
        )
        .is_err());
        assert!(crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .unwrap()
            .canonical_activation
            .is_none());
        database
            .execute_batch("DROP TRIGGER refuse_activation;")
            .unwrap();
        assert!(prepare_target_handoff_activation_v1(
            &mut database,
            id,
            "another-control-file",
            &control_bytes,
            104
        )
        .is_err());
        assert!(crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .unwrap()
            .canonical_activation
            .is_none());
        let proposal = prepare_target_handoff_activation_v1(
            &mut database,
            id,
            "control-file",
            &control_bytes,
            104,
        )
        .unwrap();
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert_eq!(
            prepare_target_handoff_activation_v1(
                &mut database,
                id,
                "control-file",
                &control_bytes,
                105
            )
            .unwrap(),
            proposal
        );
        assert!(prepare_target_handoff_activation_v1(
            &mut database,
            id,
            "other-file",
            &control_bytes,
            105
        )
        .is_err());
        let stored = crate::read_native_handoff_status_v1(&mut database)
            .unwrap()
            .unwrap();
        assert_eq!(stored.updated_at_ms, 104);
        assert_eq!(stored.phase, crate::HandoffPhaseV1::CasPending);
        assert!(stored.observed_control_revision.is_none());
        assert_eq!(
            stored.canonical_activation.as_deref(),
            Some(proposal.as_str())
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&database).is_err()
        );
        assert!(
            crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(&database)
                .is_err()
        );
        crate::normalized_handoff::require_handoff_checkpoint_export_v1(&database, id).unwrap();
        use crate::normalized_handoff_checkpoint::HandoffVerificationPlanV1;
        let plan = HandoffVerificationPlanV1::from_target(&mut database, id).unwrap();
        assert_eq!(plan.canonical_proposal, proposal.as_bytes());
        let pages = plan.verify_manifest(&manifest_bytes).unwrap();
        let mut verified = plan.checkpoint_verifier().unwrap();
        for (page, bytes) in pages.iter().zip(&compressed_pages) {
            page.verify_stored_bytes(bytes).unwrap();
            verified
                .push_manifest_page(flate2::read::MultiGzDecoder::new(bytes.as_slice()), page)
                .unwrap();
        }
        verified.finish().unwrap();
        let first = &pages[0];
        let mut corrupt = compressed_pages[0].clone();
        let end = corrupt.len() - 1;
        corrupt[end] ^= 1;
        assert!(first.verify_stored_bytes(&corrupt).is_err());
        // Even if a malicious manifest commits corrupt compressed bytes, gzip
        // integrity and frame validation independently refuse them.
        let mut verifier = plan.checkpoint_verifier().unwrap();
        assert!(verifier
            .push_manifest_page(flate2::read::MultiGzDecoder::new(corrupt.as_slice()), first)
            .is_err());
        assert!(verifier.finish().is_err());
        let mut concatenated = compressed_pages[0].clone();
        concatenated.extend_from_slice(&compressed_pages[0]);
        assert!(plan
            .checkpoint_verifier()
            .unwrap()
            .push_manifest_page(
                flate2::read::MultiGzDecoder::new(concatenated.as_slice()),
                first
            )
            .is_err());
        assert!(plan
            .checkpoint_verifier()
            .unwrap()
            .push_manifest_page(
                flate2::read::MultiGzDecoder::new(compressed_pages[1].as_slice()),
                first
            )
            .is_err());

        assert_eq!(plan.proposal.control_file_id, "control-file");
        plan.verify_control_read(&control_bytes, "\"winning-head\"")
            .unwrap();
        for revision in ["", "unquoted", "W/\"weak\"", "\"\"", "\"bad\nhead\""] {
            assert!(plan.verify_control_read(&control_bytes, revision).is_err());
        }
        assert!(plan.verify_control_read(b"{}", "\"winning-head\"").is_err());
        assert!(
            plan.checkpoint_verifier().unwrap().finish().is_err(),
            "a head read alone cannot prove checkpoint bytes"
        );
        assert!(HandoffVerificationPlanV1::from_target(&mut database, &"0".repeat(64)).is_err());
        let mut changed: HandoffActivationProposalV1 = serde_json::from_str(&proposal).unwrap();
        changed.control_file_id = "another-control-file".into();
        database
            .execute(
                "UPDATE library_local_handoff SET canonical_activation = ?1;",
                [canonical_handoff_bytes(&changed).unwrap()],
            )
            .unwrap();
        assert!(HandoffVerificationPlanV1::from_target(&mut database, id).is_err());
        changed.control_file_id = "control-file".into();
        changed.successor_checkpoint_digest = "0".repeat(64);
        database
            .execute(
                "UPDATE library_local_handoff SET canonical_activation = ?1;",
                [canonical_handoff_bytes(&changed).unwrap()],
            )
            .unwrap();
        assert!(HandoffVerificationPlanV1::from_target(&mut database, id).is_err());
        database
            .execute(
                "UPDATE library_local_handoff SET canonical_activation = ?1;",
                [proposal.as_bytes()],
            )
            .unwrap();
        assert_eq!(
            HandoffVerificationPlanV1::from_target(&mut database, id)
                .unwrap()
                .canonical_proposal,
            proposal.as_bytes()
        );
        use crate::activate_target_handoff_after_remote_verification_v1 as activate;
        assert!(crate::recover_active_target_handoff_v1(
            &mut database,
            &plan.proposal.handoff_id,
            &actor_store,
            &Store::default()
        )
        .is_err());

        let current = Store::default();
        assert!(activate(
            &mut database,
            &plan,
            "\"winning-head\"",
            &actor_store,
            &pending,
            &current,
            106
        )
        .is_err());
        assert!(
            current.bytes.borrow().is_none(),
            "missing pending key cannot be regenerated or promoted"
        );
        pending.bytes.replace(key_before);
        assert!(activate(
            &mut database,
            &plan,
            "weak-head",
            &actor_store,
            &pending,
            &current,
            106
        )
        .is_err());
        assert!(current.bytes.borrow().is_none());
        struct RefusePromotion;
        impl AuthorityKeyStore for RefusePromotion {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(None)
            }
            fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
                Err("key vault unavailable".into())
            }
        }
        assert!(activate(
            &mut database,
            &plan,
            "\"winning-head\"",
            &actor_store,
            &pending,
            &RefusePromotion,
            106
        )
        .is_err());
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut database)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::CasPending
        );
        let prior_local_sequence: u64 = database
            .query_row(
                "SELECT sequence FROM library_local_change_state WHERE singleton_id = 1;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let prior_intent_row = database
            .query_row("SELECT * FROM library_intent_transactions;", [], |row| {
                Ok(crate::normalized_consumer_recovery::encode_recovery_row(
                    row,
                    row.as_ref().column_count(),
                )
                .unwrap())
            })
            .unwrap();
        database.execute_batch("CREATE TRIGGER refuse_admission BEFORE INSERT ON library_local_cloud_writer_admission
            BEGIN SELECT RAISE(ABORT, 'injected activation admission failure'); END;").unwrap();
        assert!(activate(
            &mut database,
            &plan,
            "\"winning-head\"",
            &actor_store,
            &pending,
            &current,
            106
        )
        .is_err());
        assert_eq!(
            current.writes.get(),
            1,
            "key promotion may survive SQL rollback"
        );
        assert_eq!(
            current.bytes.borrow().as_ref(),
            pending.bytes.borrow().as_ref()
        );
        assert_eq!(
            crate::read_native_handoff_status_v1(&mut database)
                .unwrap()
                .unwrap()
                .phase,
            crate::HandoffPhaseV1::CasPending
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&database).is_err()
        );
        assert_eq!(
            database
                .query_row("SELECT count(*) FROM library_writer_admission;", [], |r| {
                    r.get::<_, u64>(0)
                })
                .unwrap(),
            0
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT count(*) FROM library_local_recovery_archives WHERE recovery_id = ?1;",
                    [id],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT count(*) FROM library_intent_transactions;",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT count(*) FROM library_follower_actor_request;",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            1
        );
        database
            .execute_batch("DROP TRIGGER refuse_admission;")
            .unwrap();
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        let active = activate(
            &mut database,
            &plan,
            "\"winning-head\"",
            &actor_store,
            &pending,
            &current,
            107,
        )
        .unwrap();
        assert_eq!(active.phase, crate::HandoffPhaseV1::Active);
        assert_eq!(
            database
                .query_row(
                    "SELECT sequence FROM library_local_change_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            prior_local_sequence
        );

        assert_eq!(database.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [id], |row| row.get::<_, Vec<u8>>(0)).unwrap(), prior_intent_row);
        assert_eq!(
            database
                .query_row(
                    "SELECT count(*) FROM library_follower_actor_request;",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT count(*) FROM library_follower_checkpoint_receipt;",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );

        assert_eq!(
            active.observed_control_revision.as_deref(),
            Some("\"winning-head\"")
        );
        assert_eq!(
            current.writes.get(),
            1,
            "retry must reuse the already promoted key"
        );
        assert_eq!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&database)
                .unwrap()
                .epoch_id,
            staged.authority.epoch_id
        );
        crate::normalized_handoff::require_normalized_provider_handoff_admission_v2(&database)
            .unwrap();
        // Exercise the recovered consumer against the activated Primary without
        // changing the later round-trip handoff's revision or actor frontier.
        if !recovered_incarnation && !cancelled_consumer {
            let mut primary = open_normalized_sqlite_database_v1(
                &directory.path().join("recovered-edit-primary.sqlite"),
                true,
            )
            .unwrap();
            rusqlite::backup::Backup::new(&database, &mut primary)
                .unwrap()
                .run_to_completion(128, std::time::Duration::ZERO, None)
                .unwrap();
            // Content fixture only. Authority, enrollment and intent acceptance
            // below all use production paths and genuine retained-key signatures.
            for item in ["rss:item:1", "rss:item:2"] {
                primary
                    .execute(
                        "INSERT INTO library_feed_items
                    (global_id, platform, content_type, captured_at, published_at, author_id,
                     author_handle, author_display_name, hidden, saved, archived, updated_at)
                    VALUES (?1, 'rss', 'article', 1, 1, 'author', 'author', 'Author', 0, 0, 0, 1);",
                        [item],
                    )
                    .unwrap();
            }
            let enrolled = crate::countersign_normalized_follower_actor_request_v2(
                &mut primary,
                next_request.canonical_enrollment_request_json.as_bytes(),
                &current,
                2201,
            )
            .unwrap();
            assert_eq!(enrolled.actor_id, next_request.actor_id);
            assert_eq!(
                enrolled.canonical_enrollment_certificate_json.as_bytes(),
                next_certificate
            );
            let before_edit = crate::describe_normalized_checkpoint_export_v2(&primary).unwrap();
            assert_eq!(
                crate::countersign_normalized_follower_actor_request_v2(
                    &mut primary,
                    next_request.canonical_enrollment_request_json.as_bytes(),
                    &current,
                    2202,
                )
                .unwrap(),
                enrolled
            );
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&primary).unwrap(),
                before_edit
            );
            // Establish the canonical baseline once, then deliver only bounded
            // operation pages for the recovered edit below.
            let incremental_path = directory.path().join("recovered-edit-incremental.sqlite");
            let mut incremental =
                open_normalized_sqlite_database_v1(&incremental_path, true).unwrap();
            rusqlite::backup::Backup::new(&consumer, &mut incremental)
                .unwrap()
                .run_to_completion(128, std::time::Duration::ZERO, None)
                .unwrap();
            let baseline_receipt =
                stage_replica(&mut incremental, &primary, "before-recovered-edit");
            crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut incremental,
                "before-recovered-edit",
                &baseline_receipt,
            )
            .unwrap();
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&incremental).unwrap(),
                before_edit
            );
            let page = crate::export_normalized_follower_intent_page_v1(
                &consumer,
                &crate::NormalizedFollowerIntentPageRequestV1 {
                    actor_id: next_request.actor_id.clone(),
                    cursor: None,
                    maximum_records: 128,
                    maximum_response_bytes: 1_048_576,
                },
            )
            .unwrap();
            assert_eq!(page.records.len(), 2);
            let input: crate::NormalizedFollowerIntentStagePageV1 =
                serde_json::from_value(json!({ "records": page.records })).unwrap();
            let accepted = crate::ingest_normalized_follower_intent_page_v1(
                &mut primary,
                &input,
                &pending_key,
                2203,
            )
            .unwrap();
            assert_eq!(accepted.resolved_transactions, 1);
            let after_edit = crate::describe_normalized_checkpoint_export_v2(&primary).unwrap();
            assert_eq!(after_edit.source_revision, before_edit.source_revision + 1);
            let values: Vec<i64> = primary
                .prepare("SELECT read_at FROM library_feed_items ORDER BY global_id;")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(values, vec![900, 901]);
            let retry = crate::ingest_normalized_follower_intent_page_v1(
                &mut primary,
                &input,
                &pending_key,
                2204,
            )
            .unwrap();
            assert_eq!(retry.resolved_records, 2);
            assert_eq!(retry.resolved_transactions, 0);
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&primary).unwrap(),
                after_edit
            );
            let results = crate::export_normalized_follower_result_page_v1(
                &primary,
                &crate::NormalizedFollowerResultPageRequestV1 {
                    actor_id: next_request.actor_id.clone(),
                    after: None,
                    maximum_records: 128,
                    maximum_response_bytes: 1_048_576,
                },
            )
            .unwrap();
            assert_eq!(results.records.len(), 1);
            assert_eq!(results.records[0].status, "accepted");
            crate::import_normalized_follower_result_page_v1(
                &mut incremental,
                &results.records,
                2205,
            )
            .unwrap();
            let operation_snapshot =
                crate::describe_normalized_operation_export_v2(&primary).unwrap();
            let mut after = None;
            let mut delivered_pages = 0;
            loop {
                let page = crate::export_normalized_operation_page_v2(
                    &primary,
                    &crate::NormalizedOperationExportRequestV2 {
                        snapshot: operation_snapshot.clone(),
                        after,
                        after_source_revision: i64::try_from(before_edit.source_revision).unwrap(),
                        maximum_records: 1,
                        maximum_response_bytes: 1_048_576,
                    },
                )
                .unwrap();
                let input = crate::NormalizedOperationImportPageV2 {
                    snapshot: operation_snapshot.clone(),
                    page: page.clone(),
                    received_at: 2206,
                };
                crate::import_normalized_operation_page_v2(&mut incremental, &input).unwrap();
                delivered_pages += 1;
                if !page.done {
                    assert_eq!(
                        crate::describe_normalized_checkpoint_export_v2(&incremental).unwrap(),
                        before_edit
                    );
                    assert_eq!(
                        incremental
                            .query_row(
                                "SELECT count(*) FROM library_optimistic_fields;",
                                [],
                                |row| row.get::<_, u64>(0)
                            )
                            .unwrap(),
                        2
                    );
                    // Reopen between partial pages and redeliver the same page.
                    drop(incremental);
                    incremental =
                        open_normalized_sqlite_database_v1(&incremental_path, false).unwrap();
                }
                crate::import_normalized_operation_page_v2(&mut incremental, &input).unwrap();
                if page.done {
                    break;
                }
                after = page.next_cursor;
            }
            assert_eq!(delivered_pages, 3);

            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&incremental).unwrap(),
                after_edit
            );
            assert_eq!(
                incremental
                    .query_row(
                        "SELECT count(*) FROM library_optimistic_fields;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                0
            );
            assert!(
                !crate::normalized_follower_runtime_status_v2(&incremental)
                    .unwrap()
                    .awaiting_canonical_changes
            );
            assert!(crate::require_normalized_provider_handoff_admission_v2(&incremental).is_err());
            assert_eq!(incremental.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get::<_, Vec<u8>>(0)).unwrap(), archived_transaction);

            let mut follower = open_normalized_sqlite_database_v1(
                &directory.path().join("recovered-edit-follower.sqlite"),
                true,
            )
            .unwrap();
            rusqlite::backup::Backup::new(&consumer, &mut follower)
                .unwrap()
                .run_to_completion(128, std::time::Duration::ZERO, None)
                .unwrap();
            crate::import_normalized_follower_result_page_v1(&mut follower, &results.records, 2205)
                .unwrap();
            assert!(
                crate::normalized_follower_runtime_status_v2(&follower)
                    .unwrap()
                    .awaiting_canonical_changes
            );
            assert_eq!(
                follower
                    .query_row(
                        "SELECT count(*) FROM library_optimistic_fields;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                2
            );
            let receipt = stage_replica(&mut follower, &primary, "accepted-recovered-edit");
            crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut follower,
                "accepted-recovered-edit",
                &receipt,
            )
            .unwrap();
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&follower).unwrap(),
                after_edit
            );
            assert!(
                !crate::normalized_follower_runtime_status_v2(&follower)
                    .unwrap()
                    .awaiting_canonical_changes
            );
            assert_eq!(
                follower
                    .query_row(
                        "SELECT count(*) FROM library_optimistic_fields;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                0
            );
            assert_eq!(follower.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get::<_, Vec<u8>>(0)).unwrap(), archived_transaction);
            crate::import_normalized_follower_result_page_v1(&mut follower, &results.records, 2206)
                .unwrap();
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&follower).unwrap(),
                after_edit
            );
            assert_eq!(consumer.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [&archive_id], |r| r.get::<_, Vec<u8>>(0)).unwrap(), archived_transaction);
        }
        let source_enrollment = crate::countersign_normalized_follower_actor_request_v2(
            &mut database,
            consumer_actor.canonical_enrollment_request_json.as_bytes(),
            &current,
            110,
        )
        .unwrap();
        crate::install_normalized_follower_actor_enrollment_v2(
            &mut adopting,
            source_enrollment
                .canonical_enrollment_certificate_json
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(
            crate::normalized_follower::normalized_follower_mutation_context_v1(&adopting)
                .unwrap()
                .actor_id,
            consumer_actor.actor_id
        );
        crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&adopting).unwrap();
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&adopting).is_err()
        );
        assert!(crate::require_normalized_provider_handoff_admission_v2(&adopting).is_err());
        // Reverse the two real installations after the successor accepted the
        // former source's enrollment. Preserve the original restart probes below.
        if !recovered_incarnation && !cancelled_consumer {
            // Earlier archive fixtures countersigned without committing on this
            // Primary. Commit that enrollment before its checkpoint is exported.
            let enrolled_consumer = crate::countersign_normalized_follower_actor_request_v2(
                &mut database,
                next_request.canonical_enrollment_request_json.as_bytes(),
                &current,
                2200,
            )
            .unwrap();
            assert_eq!(
                enrolled_consumer
                    .canonical_enrollment_certificate_json
                    .as_bytes(),
                next_certificate
            );
            let returning_path = directory.path().join("roundtrip-target.sqlite");
            let leaving_path = directory.path().join("roundtrip-source.sqlite");
            for (source, path) in [(&adopting, &returning_path), (&database, &leaving_path)] {
                let mut copy = open_normalized_sqlite_database_v1(path, true).unwrap();
                rusqlite::backup::Backup::new(source, &mut copy)
                    .unwrap()
                    .run_to_completion(64, std::time::Duration::ZERO, None)
                    .unwrap();
            }
            let mut returning = open_normalized_sqlite_database_v1(&returning_path, false).unwrap();
            let mut leaving = open_normalized_sqlite_database_v1(&leaving_path, false).unwrap();
            let return_pending = Store::default();
            let retained_old_authority = Store {
                bytes: RefCell::new(source_store.bytes.borrow().clone()),
                writes: Cell::new(0),
            };
            let readiness = prepare_target_handoff_readiness_v1(
                &mut returning,
                &former_source_actor_store,
                &return_pending,
                120,
            )
            .unwrap();
            let return_id = begin_source_handoff_v1(
                &mut leaving,
                readiness.as_bytes(),
                &consumer_actor.actor_id,
                &current,
                121,
            )
            .unwrap();
            let snapshot =
                crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&leaving)
                    .unwrap();
            crate::normalized_handoff::seal_source_handoff_v1(
                &mut leaving,
                &return_id,
                &snapshot,
                122,
            )
            .unwrap();
            let mut final_control = successor_control.clone();
            // The original source adopted generation 7 in the earlier fixture.
            final_control.generation = adoption_control.generation + 1;
            let (_final_manifest, _final_pages) = exported_transport(&leaving, &mut final_control);
            let body = prepare_source_handoff_authorization_v1(
                &mut leaving,
                &return_id,
                &canonical_handoff_bytes(&final_control).unwrap(),
                "\"return-final\"",
                "control-file",
            )
            .unwrap();
            let authorization =
                authorize_source_handoff_v1(&mut leaving, body.as_bytes(), &current, 123).unwrap();
            accept_target_handoff_authorization_v1(
                &mut returning,
                authorization.as_bytes(),
                &former_source_actor_store,
                &return_pending,
                124,
            )
            .unwrap();
            stage_copy(&leaving, &mut returning, "return-catchup", 125);
            let final_receipt = crate::normalized_import::NormalizedFollowerCheckpointReceiptV2 {
                checkpoint_generation: final_control.generation,
                writer_actor_id: final_control.writer_id.clone(),
                manifest_object_key: final_control.manifest.descriptor.object_key.clone(),
                manifest_transport_object_id: final_control.manifest.transport_object_id.clone(),
                manifest_content_digest: final_control.manifest.descriptor.content_digest.clone(),
                control_revision: "\"return-final\"".into(),
                installed_at: 125,
            };
            crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut returning,
                "return-catchup",
                &final_receipt,
            )
            .unwrap();
            let third = stage_target_handoff_v1(
                &mut returning,
                &return_id,
                &installation_witness,
                &former_source_actor_store,
                &return_pending,
                126,
            )
            .unwrap();
            assert_ne!(third.authority.epoch_id, staged.authority.epoch_id);

            assert!(crate::require_normalized_provider_handoff_admission_v2(&returning).is_err());
            assert!(crate::require_normalized_provider_handoff_admission_v2(&leaving).is_err());
            let mut third_control = final_control.clone();
            third_control.generation = 0;
            let (third_manifest, third_pages) = exported_transport(&returning, &mut third_control);
            let third_bytes = canonical_handoff_bytes(&third_control).unwrap();
            prepare_target_handoff_activation_v1(
                &mut returning,
                &return_id,
                "control-file",
                &third_bytes,
                127,
            )
            .unwrap();
            let return_plan =
                HandoffVerificationPlanV1::from_target(&mut returning, &return_id).unwrap();
            return_plan
                .verify_control_read(&third_bytes, "\"return-winner\"")
                .unwrap();
            let pages = return_plan.verify_manifest(&third_manifest).unwrap();
            let mut verifier = return_plan.checkpoint_verifier().unwrap();
            for (page, bytes) in pages.iter().zip(&third_pages) {
                page.verify_stored_bytes(bytes).unwrap();
                verifier
                    .push_manifest_page(flate2::read::MultiGzDecoder::new(bytes.as_slice()), page)
                    .unwrap();
            }
            verifier.finish().unwrap();
            let returned = activate(
                &mut returning,
                &return_plan,
                "\"return-winner\"",
                &former_source_actor_store,
                &return_pending,
                &retained_old_authority,
                128,
            )
            .unwrap();
            assert_eq!(returned.phase, crate::HandoffPhaseV1::Active);
            assert_eq!(retained_old_authority.writes.get(), 1);
            crate::require_normalized_provider_handoff_admission_v2(&returning).unwrap();
            assert!(crate::require_normalized_provider_handoff_admission_v2(&leaving).is_err());
            assert_eq!(
                returning
                    .query_row(
                        "SELECT count(*) FROM library_local_source_demotions;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                1
            );
            assert_eq!(
                returning
                    .query_row(
                        "SELECT count(*) FROM library_follower_actor_request;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                0
            );
            // This separate consumer missed both transfers. Download historical
            // checkpoints without selecting either intermediate state.
            let mut missed = open_normalized_sqlite_database_v1(
                &directory.path().join("missed-consumer.sqlite"),
                false,
            )
            .unwrap();
            let first_source = open_normalized_sqlite_database_v1(
                &directory.path().join("missed-first-source.sqlite"),
                false,
            )
            .unwrap();
            let mut delayed_source =
                open_normalized_sqlite_database_v1(&delayed_source_path, false).unwrap();
            let original_consent = crate::read_native_handoff_status_v1(&mut delayed_source)
                .unwrap()
                .unwrap()
                .canonical_authorization;
            stage_replica(&mut delayed_source, &returning, "delayed-source-successor");
            let delayed_reads = crate::prepare_normalized_predecessor_checkpoint_read_v1(
                &mut delayed_source,
                "delayed-source-successor",
            )
            .unwrap()
            .unwrap();
            let delayed_reads = delayed_reads.as_array().unwrap();
            assert_eq!(delayed_reads.len(), 2);
            for (reference, historical) in delayed_reads.iter().zip([&first_source, &leaving]) {
                let stage_id = reference
                    .pointer("/pointer/manifest/descriptor/contentDigest")
                    .unwrap()
                    .as_str()
                    .unwrap();
                stage_replica(&mut delayed_source, historical, stage_id);
            }
            let consent_body: Vec<u8> = delayed_source.query_row("SELECT canonical_authorization_body FROM library_local_handoff WHERE singleton_id=1;", [], |r|r.get(0)).unwrap();
            delayed_source.execute("UPDATE library_local_handoff SET canonical_authorization_body=x'7b7d' WHERE singleton_id=1;", []).unwrap();
            assert!(crate::source_handoff_verification_plan_v1(
                &mut delayed_source,
                id,
                "delayed-source-successor",
                &third_bytes
            )
            .is_err());
            delayed_source.execute("UPDATE library_local_handoff SET canonical_authorization_body=?1 WHERE singleton_id=1;", [&consent_body]).unwrap();
            let delayed_plan = crate::source_handoff_verification_plan_v1(
                &mut delayed_source,
                id,
                "delayed-source-successor",
                &third_bytes,
            )
            .expect("an offline source can verify its authorized successor's later winner");
            delayed_plan
                .verify_control_read(&third_bytes, "\"delayed-winner\"")
                .unwrap();
            let delayed_pages = delayed_plan.verify_manifest(&third_manifest).unwrap();
            let mut delayed_verifier = delayed_plan.checkpoint_verifier().unwrap();
            for (page, bytes) in delayed_pages.iter().zip(&third_pages) {
                page.verify_stored_bytes(bytes).unwrap();
                delayed_verifier
                    .push_manifest_page(flate2::read::MultiGzDecoder::new(bytes.as_slice()), page)
                    .unwrap();
            }
            delayed_verifier.finish().unwrap();
            let delayed_original =
                crate::describe_normalized_checkpoint_export_v2(&delayed_source).unwrap();
            let delayed_history = delayed_reads[1]
                .pointer("/pointer/manifest/descriptor/contentDigest")
                .unwrap()
                .as_str()
                .unwrap();
            delayed_source.execute_batch(&format!("CREATE TEMP TRIGGER fail_delayed_cleanup BEFORE DELETE ON library_checkpoint_stages WHEN OLD.stage_id='{delayed_history}' BEGIN SELECT RAISE(ABORT,'delayed cleanup fault'); END;")).unwrap();
            assert!(crate::adopt_source_handoff_after_remote_verification_v1(
                &mut delayed_source,
                &delayed_plan,
                "\"delayed-winner\"",
                2400
            )
            .is_err());
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&delayed_source).unwrap(),
                delayed_original
            );
            assert_eq!(
                crate::read_native_handoff_status_v1(&mut delayed_source)
                    .unwrap()
                    .unwrap()
                    .phase,
                crate::HandoffPhaseV1::Authorized
            );
            assert_eq!(
                delayed_source
                    .query_row(
                        "SELECT count(*) FROM library_checkpoint_stages WHERE stage_id=?1;",
                        [delayed_history],
                        |r| r.get::<_, u64>(0)
                    )
                    .unwrap(),
                1
            );
            delayed_source
                .execute_batch("DROP TRIGGER fail_delayed_cleanup;")
                .unwrap();
            let delayed = crate::adopt_source_handoff_after_remote_verification_v1(
                &mut delayed_source,
                &delayed_plan,
                "\"delayed-winner\"",
                2400,
            )
            .unwrap();
            assert_eq!(delayed.phase, crate::HandoffPhaseV1::Demoted);
            assert_eq!(
                delayed.successor_epoch_id.as_deref(),
                Some(third.authority.epoch_id.as_str())
            );
            assert_eq!(delayed.canonical_authorization, original_consent);
            assert!(
                crate::require_normalized_provider_handoff_admission_v2(&delayed_source).is_err()
            );
            drop(delayed_source);
            let mut delayed_source =
                open_normalized_sqlite_database_v1(&delayed_source_path, false).unwrap();
            assert_eq!(
                crate::recover_demoted_source_handoff_v1(
                    &mut delayed_source,
                    id,
                    "delayed-source-successor",
                    &third_bytes
                )
                .unwrap(),
                Some(delayed.clone())
            );
            crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&delayed_source)
                .unwrap();
            assert_eq!(
                crate::normalized_source_handoff::source_consumer_incarnation_v1(
                    &delayed_source,
                    &library,
                    &third.authority.epoch_id
                )
                .unwrap(),
                Some(id.to_owned())
            );
            {
                let tx = delayed_source.transaction().unwrap();
                crate::normalized_source_handoff::retain_demoted_source_for_return(&tx, 2401)
                    .unwrap();
                let retained: Vec<u8> = tx.query_row("SELECT canonical_authorization FROM library_local_source_demotions WHERE handoff_id=?1;",[id],|r|r.get(0)).unwrap();
                assert_eq!(retained, original_consent.as_ref().unwrap().as_bytes());
                // Probe retention without changing the source lifecycle.
                tx.rollback().unwrap();
            }
            let delayed_actor_bytes =
                Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new()).unwrap();
            let delayed_actor_store = Store {
                bytes: RefCell::new(Some(delayed_actor_bytes.as_ref().to_vec())),
                writes: Cell::new(0),
            };
            let delayed_request = crate::prepare_normalized_follower_actor_request_v2(
                &mut delayed_source,
                &installation_witness,
                &delayed_actor_store,
                2402,
            )
            .unwrap();
            assert_eq!(
                delayed_request,
                crate::prepare_normalized_follower_actor_request_v2(
                    &mut delayed_source,
                    &installation_witness,
                    &delayed_actor_store,
                    2403,
                )
                .unwrap()
            );
            let delayed_pending = Store::default();
            assert!(
                prepare_target_handoff_readiness_v1(
                    &mut delayed_source,
                    &delayed_actor_store,
                    &delayed_pending,
                    2404,
                )
                .is_err(),
                "later-winner adoption still requires explicit successor enrollment"
            );
            let delayed_enrollment =
                crate::library_core_actor_enrollment::countersign_actor_enrollment_request_bytes(
                    delayed_request.canonical_enrollment_request_json.as_bytes(),
                    &retained_old_authority,
                )
                .unwrap();
            crate::install_normalized_follower_actor_enrollment_v2(
                &mut delayed_source,
                &delayed_enrollment,
            )
            .unwrap();
            crate::normalized_follower::normalized_follower_mutation_context_v1(&delayed_source)
                .unwrap();
            let delayed_readiness = prepare_target_handoff_readiness_v1(
                &mut delayed_source,
                &delayed_actor_store,
                &delayed_pending,
                2405,
            )
            .unwrap();
            assert_eq!(
                prepare_target_handoff_readiness_v1(
                    &mut delayed_source,
                    &delayed_actor_store,
                    &delayed_pending,
                    2406,
                )
                .unwrap(),
                delayed_readiness
            );
            assert_eq!(delayed_actor_store.writes.get(), 0);
            assert!(
                crate::require_normalized_provider_handoff_admission_v2(&delayed_source).is_err()
            );
            let retained: Vec<u8> = delayed_source.query_row(
                "SELECT canonical_authorization FROM library_local_source_demotions WHERE handoff_id=?1;",
                [id], |r| r.get(0),
            ).unwrap();
            assert_eq!(retained, original_consent.as_ref().unwrap().as_bytes());
            let original = crate::describe_normalized_checkpoint_export_v2(&missed).unwrap();
            let original_intent: Vec<u8> = missed.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id='pending';",[],|r|r.get(0)).unwrap();
            let missed_receipt = stage_replica(&mut missed, &returning, "missed-successor");
            let reads = crate::prepare_normalized_predecessor_checkpoint_read_v1(
                &mut missed,
                "missed-successor",
            )
            .unwrap()
            .unwrap();
            let reads = reads.as_array().unwrap();
            assert_eq!(reads.len(), 2);
            let first_stage = reads[0]
                .pointer("/pointer/manifest/descriptor/contentDigest")
                .unwrap()
                .as_str()
                .unwrap();
            let second_stage = reads[1]
                .pointer("/pointer/manifest/descriptor/contentDigest")
                .unwrap()
                .as_str()
                .unwrap();
            stage_replica(&mut missed, &first_source, first_stage);
            assert!(crate::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut missed,
                "missed-successor",
                &missed_receipt
            )
            .is_err());
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&missed).unwrap(),
                original
            );
            assert_eq!(missed.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id='pending';",[],|r|r.get::<_,Vec<u8>>(0)).unwrap(),original_intent);
            assert_eq!(
                missed
                    .query_row(
                        "SELECT count(*) FROM library_checkpoint_stages WHERE stage_id=?1;",
                        [first_stage],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                1
            );
            stage_replica(&mut missed, &first_source, "unrelated-staging");
            stage_replica(&mut missed, &leaving, second_stage);
            missed.execute_batch(&format!("CREATE TEMP TRIGGER fail_historical_cleanup BEFORE DELETE ON library_checkpoint_stages WHEN OLD.stage_id='{second_stage}' BEGIN SELECT RAISE(ABORT,'historical cleanup fault'); END;")).unwrap();
            assert!(crate::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut missed,
                "missed-successor",
                &missed_receipt
            )
            .is_err());
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&missed).unwrap(),
                original
            );
            assert_eq!(
                missed
                    .query_row(
                        "SELECT count(*) FROM library_checkpoint_stages WHERE stage_id IN (?1,?2);",
                        rusqlite::params![first_stage, second_stage],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                2
            );
            assert_eq!(missed.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id='pending';",[],|r|r.get::<_,Vec<u8>>(0)).unwrap(),original_intent);
            missed
                .execute_batch("DROP TRIGGER fail_historical_cleanup;")
                .unwrap();
            crate::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut missed,
                "missed-successor",
                &missed_receipt,
            )
            .unwrap();
            assert_eq!(
                missed
                    .query_row(
                        "SELECT count(*) FROM library_checkpoint_stages WHERE stage_id IN (?1,?2);",
                        rusqlite::params![first_stage, second_stage],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                0
            );
            assert_eq!(missed.query_row("SELECT count(*) FROM library_checkpoint_stage_records WHERE stage_id IN (?1,?2);",rusqlite::params![first_stage,second_stage],|r|r.get::<_,i64>(0)).unwrap(),0);
            assert_eq!(missed.query_row("SELECT count(*) FROM library_checkpoint_stages WHERE stage_id='unrelated-staging';",[],|r|r.get::<_,i64>(0)).unwrap(),1);
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&missed)
                    .unwrap()
                    .authority_epoch,
                third.authority.epoch_id
            );
            assert_eq!(missed.query_row("SELECT authority_epoch_id FROM library_follower_actor_request WHERE singleton_id=1;",[],|r|r.get::<_,String>(0)).unwrap(),original.authority_epoch);
            assert_eq!(missed.query_row("SELECT canonical_transaction FROM library_intent_transactions WHERE transaction_id='pending';",[],|r|r.get::<_,Vec<u8>>(0)).unwrap(),original_intent);
            // Provider admission also requires native Primary authority. A
            // schema-1 consumer has no lifecycle fence until archival begins.
            assert_eq!(
                missed
                    .query_row("SELECT count(*) FROM library_writer_admission;", [], |r| {
                        r.get::<_, u64>(0)
                    })
                    .unwrap(),
                0
            );
            assert!(crate::normalized_primary_mutation_context_v1(&missed).is_err());
            let missed_archive =
                crate::archive_consumer_epoch_recovery_v1(&mut missed, &actor_store, 2400).unwrap();
            assert!(crate::require_normalized_provider_handoff_admission_v2(&missed).is_err());
            assert_eq!(missed.query_row("SELECT predecessor_epoch_id FROM library_local_recovery_archives WHERE recovery_id=?1;",[&missed_archive],|r|r.get::<_,String>(0)).unwrap(),original.authority_epoch);
            assert_eq!(
                missed
                    .query_row(
                        "SELECT count(*) FROM library_local_recovery_archives;",
                        [],
                        |r| r.get::<_, u64>(0)
                    )
                    .unwrap(),
                1
            );

            // A third installation follows this real second transfer through the
            // complete checkpoint importer, preserving its completed first archive.
            let mut repeated = open_normalized_sqlite_database_v1(
                &directory.path().join("roundtrip-consumer.sqlite"),
                true,
            )
            .unwrap();
            rusqlite::backup::Backup::new(&consumer, &mut repeated)
                .unwrap()
                .run_to_completion(64, std::time::Duration::ZERO, None)
                .unwrap();
            let archive_bytes = |db: &rusqlite::Connection| {
                db.prepare("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id=?1 ORDER BY table_key,row_ordinal;")
                    .unwrap().query_map([&archive_id], |row| row.get::<_,Vec<u8>>(0))
                    .unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
            };
            let prior_archive = archive_bytes(&repeated);
            // This consumer has not received the return target's enrollment yet.
            // Acquire that predecessor checkpoint before accepting its successor.
            assert!(
                verify_successor(&repeated, third.canonical_certificate_json.as_bytes())
                    .unwrap_err()
                    .contains("target is not enrolled")
            );
            stage_replica(&mut repeated, &returning, "roundtrip-read-proof");
            crate::normalized_handoff_writer_certificate::check_staged_predecessor_read(
                &mut repeated,
                "roundtrip-read-proof",
                &final_control,
            );
            stage_replica(&mut repeated, &leaving, "roundtrip-predecessor");
            crate::normalized_handoff_writer_certificate::check_install_verified_predecessor(
                &mut repeated,
                "roundtrip-read-proof",
                "roundtrip-predecessor",
            );
            let prior_checkpoint =
                crate::describe_normalized_checkpoint_export_v2(&repeated).unwrap();
            let prior_request: String = repeated.query_row(
                "SELECT canonical_enrollment_request FROM library_follower_actor_request WHERE singleton_id=1;", [], |row|row.get(0),
            ).unwrap();
            let next_receipt = stage_replica(&mut repeated, &returning, "roundtrip-successor");
            crate::normalized_preference_projection::check_migrated_repeated_successor(
                &repeated,
                "roundtrip-successor",
                &next_receipt,
                &actor_store,
                &installation_witness,
                &next_certificate,
                (&returning, &retained_old_authority),
            );
            repeated.execute_batch("CREATE TEMP TRIGGER refuse_second_successor AFTER INSERT ON library_follower_checkpoint_receipt BEGIN SELECT RAISE(ABORT,'injected second successor failure'); END;").unwrap();
            let error =
                crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                    &mut repeated,
                    "roundtrip-successor",
                    &next_receipt,
                )
                .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("injected second successor failure"),
                "{error}"
            );
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&repeated).unwrap(),
                prior_checkpoint
            );
            assert_eq!(archive_bytes(&repeated), prior_archive);
            repeated
                .execute_batch("DROP TRIGGER refuse_second_successor;")
                .unwrap();
            crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut repeated,
                "roundtrip-successor",
                &next_receipt,
            )
            .unwrap();
            assert_eq!(
                crate::describe_normalized_checkpoint_export_v2(&repeated).unwrap(),
                crate::describe_normalized_checkpoint_export_v2(&returning).unwrap()
            );
            assert_eq!(repeated.query_row("SELECT canonical_enrollment_request FROM library_follower_actor_request WHERE singleton_id=1;", [], |row|row.get::<_,String>(0)).unwrap(), prior_request);
            assert_eq!(archive_bytes(&repeated), prior_archive);
            assert!(crate::normalized_follower_mutation_context_v1(&repeated).is_err());
            assert!(crate::normalized_primary_mutation_context_v1(&repeated).is_err());
            assert!(crate::require_normalized_provider_handoff_admission_v2(&repeated).is_err());
            // A later same-successor refresh must not demand another recovery or
            // lose the historical epoch used to verify the retained enrollment.
            let refresh = stage_replica(&mut repeated, &returning, "roundtrip-refresh");
            crate::normalized_import::replace_with_normalized_follower_checkpoint_stage_v2(
                &mut repeated,
                "roundtrip-refresh",
                &refresh,
            )
            .unwrap();
            let next_archive =
                crate::archive_consumer_epoch_recovery_v1(&mut repeated, &actor_store, 2400)
                    .unwrap();
            assert_ne!(next_archive, archive_id);
            assert_eq!(
                crate::archive_consumer_epoch_recovery_v1(&mut repeated, &actor_store, 2401)
                    .unwrap(),
                next_archive
            );
            assert_eq!(archive_bytes(&repeated), prior_archive);
            let next_recovery = crate::prepare_consumer_epoch_reenrollment_v1(
                &mut repeated,
                &next_archive,
                &installation_witness,
                &actor_store,
                2402,
            )
            .unwrap();
            assert_eq!(next_recovery.authority_epoch_id, third.authority.epoch_id);
            assert_eq!(
                crate::prepare_consumer_epoch_reenrollment_v1(
                    &mut repeated,
                    &next_archive,
                    &installation_witness,
                    &actor_store,
                    2403,
                )
                .unwrap(),
                next_recovery
            );
            assert_eq!(archive_bytes(&repeated), prior_archive);
            let committed_recovery = crate::commit_consumer_epoch_reenrollment_v1(
                &mut repeated,
                &next_archive,
                &installation_witness,
                &actor_store,
                2404,
            )
            .unwrap();
            assert_eq!(committed_recovery, next_recovery);
            assert!(crate::normalized_follower_mutation_context_v1(&repeated).is_err());
            // Keep the published checkpoint immutable for the source-adoption
            // probes below; this copy advances independently for reenrollment.
            let mut reenrolling_primary = open_normalized_sqlite_database_v1(
                &directory
                    .path()
                    .join("roundtrip-reenrolling-primary.sqlite"),
                true,
            )
            .unwrap();
            rusqlite::backup::Backup::new(&returning, &mut reenrolling_primary)
                .unwrap()
                .run_to_completion(64, std::time::Duration::ZERO, None)
                .unwrap();
            let enrolled_again = crate::countersign_normalized_follower_actor_request_v2(
                &mut reenrolling_primary,
                next_recovery.canonical_enrollment_request_json.as_bytes(),
                &retained_old_authority,
                2405,
            )
            .unwrap();
            crate::install_normalized_follower_actor_enrollment_v2(
                &mut repeated,
                enrolled_again
                    .canonical_enrollment_certificate_json
                    .as_bytes(),
            )
            .unwrap();
            assert_eq!(
                crate::normalized_follower_mutation_context_v1(&repeated)
                    .unwrap()
                    .actor_id,
                next_recovery.actor_id
            );
            assert_ne!(next_recovery.actor_id, next_request.actor_id);
            assert_eq!(archive_bytes(&repeated), prior_archive);
            assert!(crate::normalized_primary_mutation_context_v1(&repeated).is_err());
            assert!(crate::require_normalized_provider_handoff_admission_v2(&repeated).is_err());
            stage_copy(&returning, &mut leaving, "return-adoption", 129);
            let adoption_plan = crate::source_handoff_verification_plan_v1(
                &mut leaving,
                &return_id,
                "return-adoption",
                &third_bytes,
            )
            .unwrap();
            adoption_plan
                .verify_control_read(&third_bytes, "\"return-winner\"")
                .unwrap();
            let pages = adoption_plan.verify_manifest(&third_manifest).unwrap();
            let mut verifier = adoption_plan.checkpoint_verifier().unwrap();
            for (page, bytes) in pages.iter().zip(&third_pages) {
                page.verify_stored_bytes(bytes).unwrap();
                verifier
                    .push_manifest_page(flate2::read::MultiGzDecoder::new(bytes.as_slice()), page)
                    .unwrap();
            }
            verifier.finish().unwrap();
            let demoted_again = crate::adopt_source_handoff_after_remote_verification_v1(
                &mut leaving,
                &adoption_plan,
                "\"return-winner\"",
                130,
            )
            .unwrap();
            assert_eq!(demoted_again.phase, crate::HandoffPhaseV1::Demoted);
            let canonical =
                crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&returning)
                    .unwrap();
            assert_eq!(
                crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&leaving)
                    .unwrap(),
                canonical
            );
            assert!(crate::require_normalized_provider_handoff_admission_v2(&leaving).is_err());
            let digest = |database: &mut rusqlite::Connection| {
                let tx = database.transaction().unwrap();
                let digest = crate::normalized_import::selected_checkpoint_digest_v2(&tx).unwrap();
                tx.commit().unwrap();
                digest
            };
            assert_eq!(digest(&mut returning), digest(&mut leaving));
            assert_eq!(leaving.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [id], |row| row.get::<_, Vec<u8>>(0)).unwrap(), prior_intent_row);
            let second_consumer = crate::prepare_normalized_follower_actor_request_v2(
                &mut leaving,
                &installation_witness,
                &actor_store,
                131,
            )
            .unwrap();
            assert_ne!(second_consumer.actor_id, actor);
            let second_enrollment = crate::countersign_normalized_follower_actor_request_v2(
                &mut returning,
                second_consumer.canonical_enrollment_request_json.as_bytes(),
                &retained_old_authority,
                132,
            )
            .unwrap();
            crate::install_normalized_follower_actor_enrollment_v2(
                &mut leaving,
                second_enrollment
                    .canonical_enrollment_certificate_json
                    .as_bytes(),
            )
            .unwrap();
            let authority = crate::normalized_writer_reassignment::current_authority(&leaving)
                .unwrap()
                .0;
            let verified = crate::normalized_enrollment_verifier::verify_actor_enrollment(
                second_enrollment
                    .canonical_enrollment_certificate_json
                    .as_bytes(),
                &authority,
            )
            .unwrap();
            let edits = crate::normalized_operation_test_fixtures::tests::signed_envelopes(
                &actor_key, &verified,
            );
            let committed = crate::normalized_follower::enqueue_normalized_follower_intent_v1(
                &mut leaving,
                &edits,
                133,
            )
            .unwrap();
            assert_eq!(committed.first_counter, 1);
            assert_eq!(committed.last_counter, 2);
            drop(leaving);
            let mut leaving = open_normalized_sqlite_database_v1(&leaving_path, false).unwrap();
            assert_eq!(
                crate::normalized_follower::enqueue_normalized_follower_intent_v1(
                    &mut leaving,
                    &edits,
                    134
                )
                .unwrap(),
                committed
            );
            assert_eq!(
                leaving
                    .query_row(
                        "SELECT count(*) FROM library_intent_transactions;",
                        [],
                        |row| row.get::<_, u64>(0)
                    )
                    .unwrap(),
                1
            );
            assert!(crate::require_normalized_provider_handoff_admission_v2(&leaving).is_err());
            assert_eq!(former_source_actor_store.writes.get(), 0);
            assert_eq!(actor_store.writes.get(), 0);
            drop(returning);
            let mut returning = open_normalized_sqlite_database_v1(&returning_path, false).unwrap();
            assert_eq!(
                crate::recover_active_target_handoff_v1(
                    &mut returning,
                    &return_id,
                    &former_source_actor_store,
                    &retained_old_authority
                )
                .unwrap(),
                returned
            );
        }
        // Simulate a later canonical revision: committed retry must use the
        // activation receipt and current authority, never the old checkpoint.
        database
            .execute(
                "UPDATE library_change_state SET revision = revision + 1 WHERE singleton_id = 1;",
                [],
            )
            .unwrap();
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        let recovered = crate::recover_active_target_handoff_v1(
            &mut database,
            &active.handoff_id,
            &actor_store,
            &current,
        )
        .unwrap();
        assert_eq!(
            recovered, active,
            "recovery only needs the durable receipt and established keys"
        );
        assert!(crate::recover_active_target_handoff_v1(
            &mut database,
            &"0".repeat(64),
            &actor_store,
            &current
        )
        .is_err());
        let no_pending = Store::default();
        let replay = activate(
            &mut database,
            &plan,
            "\"winning-head\"",
            &actor_store,
            &no_pending,
            &current,
            108,
        )
        .unwrap();
        assert_eq!(
            replay, active,
            "committed replay must not rewrite its receipt"
        );
        assert_eq!(current.writes.get(), 1);
        assert!(activate(
            &mut database,
            &plan,
            "\"different-head\"",
            &actor_store,
            &no_pending,
            &current,
            109
        )
        .is_err());
        let promoted = current.bytes.take();
        assert!(crate::recover_active_target_handoff_v1(
            &mut database,
            &active.handoff_id,
            &actor_store,
            &current
        )
        .is_err());

        assert!(activate(
            &mut database,
            &plan,
            "\"winning-head\"",
            &actor_store,
            &pending,
            &current,
            109
        )
        .is_err());
        assert!(
            current.bytes.borrow().is_none(),
            "replay must not restore a missing active key"
        );
        current.bytes.replace(promoted);
        database
            .execute("DELETE FROM library_writer_admission;", [])
            .unwrap();
        assert!(crate::recover_active_target_handoff_v1(
            &mut database,
            &active.handoff_id,
            &actor_store,
            &current
        )
        .is_err());

        assert!(activate(
            &mut database,
            &plan,
            "\"winning-head\"",
            &actor_store,
            &pending,
            &current,
            109
        )
        .is_err());
        assert_eq!(
            database
                .query_row("SELECT count(*) FROM library_writer_admission;", [], |r| {
                    r.get::<_, u64>(0)
                })
                .unwrap(),
            0,
            "committed replay must not recreate revoked admission"
        );
        assert!(
            crate::normalized_mutation::normalized_primary_mutation_context_v1(&source).is_err()
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT count(*) FROM library_intent_transactions;",
                    [],
                    |r| r.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(database.query_row("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions';", [id], |row| row.get::<_, Vec<u8>>(0)).unwrap(), prior_intent_row);
    }
}
