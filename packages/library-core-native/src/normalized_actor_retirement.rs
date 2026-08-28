use crate::library_core_canonical::{
    decode_canonical_value, encode_canonical_value, encode_operation_digest_input,
    encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::normalized_sqlite::NormalizedSqliteError;
use ring::signature::{Ed25519KeyPair, KeyPair};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const FORMAT: &str = "freed_library_core_actor_retirement_v1";
const SIGNATURE_ALGORITHM: &str = "ed25519";
const MAX_CERTIFICATE_BYTES: usize = 65_536;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const RETIREMENT_REASONS: &[&str] = &[
    "device_removed",
    "key_compromised",
    "role_reassigned",
    "user_requested",
];

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn digest_value(domain: &str, value: &Value) -> Result<String, NormalizedSqliteError> {
    let input = encode_operation_digest_input(domain, value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized actor retirement digest is invalid"))?;
    Ok(lower_hex(&Sha256::digest(input)))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedActorRetirementBodyV1 {
    pub format: String,
    pub library_id: String,
    pub epoch: i64,
    pub epoch_id: String,
    pub authority_key_id: String,
    pub actor_id: String,
    pub capability_id: String,
    pub capability_certificate_digest: String,
    pub retirement_identity: String,
    pub reason: String,
    pub retired_at_ms: i64,
    pub signature_algorithm: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedActorRetirementCertificateV1 {
    pub retirement_body: NormalizedActorRetirementBodyV1,
    pub retirement_body_digest: String,
    pub certificate_digest: String,
    pub authority_signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedActorRetirementReceiptV1 {
    pub actor_id: String,
    pub capability_id: String,
    pub retirement_identity: String,
    pub certificate_digest: String,
    pub canonical_certificate_json: String,
    pub retired_at_ms: i64,
    pub committed_revision: i64,
}

#[derive(Debug)]
struct ActiveRetirementTarget {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    authority_key_id: String,
    authority_public_key: String,
    actor_id: String,
    capability_id: String,
    capability_certificate_digest: String,
    retirement_identity: String,
    issued_at: i64,
    actor_created_at: i64,
    source_revision: i64,
    updated_at: i64,
}

fn authority_key_id(public_key: &str) -> Result<String, NormalizedSqliteError> {
    digest_value(
        "authority-key",
        &json!({
            "signature_algorithm": SIGNATURE_ALGORITHM,
            "authority_public_key": public_key,
        }),
    )
}

fn validate_body(body: &NormalizedActorRetirementBodyV1) -> Result<(), NormalizedSqliteError> {
    if body.format != FORMAT
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || !is_lower_sha256(&body.library_id)
        || !(1..=MAX_SAFE_INTEGER).contains(&body.epoch)
        || !is_lower_sha256(&body.epoch_id)
        || !is_lower_sha256(&body.authority_key_id)
        || !is_lower_sha256(&body.actor_id)
        || !is_lower_sha256(&body.capability_id)
        || body.capability_id != body.capability_certificate_digest
        || !is_lower_sha256(&body.retirement_identity)
        || !RETIREMENT_REASONS.contains(&body.reason.as_str())
        || !(0..=MAX_SAFE_INTEGER).contains(&body.retired_at_ms)
    {
        return Err(invalid("normalized actor retirement body is invalid"));
    }
    Ok(())
}

pub(crate) fn verify_normalized_actor_retirement_certificate_v1(
    canonical_certificate: &[u8],
    authority_public_key: &str,
) -> Result<NormalizedActorRetirementCertificateV1, NormalizedSqliteError> {
    if canonical_certificate.is_empty() || canonical_certificate.len() > MAX_CERTIFICATE_BYTES {
        return Err(invalid(
            "normalized actor retirement certificate size is invalid",
        ));
    }
    let decoded = decode_canonical_value(canonical_certificate, MAX_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized actor retirement certificate is not canonical"))?;
    let certificate: NormalizedActorRetirementCertificateV1 =
        serde_json::from_value(decoded.value().clone())
            .map_err(|_| invalid("normalized actor retirement certificate is invalid"))?;
    validate_body(&certificate.retirement_body)?;
    if authority_key_id(authority_public_key)? != certificate.retirement_body.authority_key_id {
        return Err(invalid("normalized actor retirement authority key changed"));
    }
    if decoded.canonical_bytes() != canonical_certificate {
        return Err(invalid(
            "normalized actor retirement certificate is not canonical",
        ));
    }
    let body_value = serde_json::to_value(&certificate.retirement_body)
        .map_err(|_| invalid("normalized actor retirement body is invalid"))?;
    let body_digest = digest_value("actor-retirement-body", &body_value)?;
    if certificate.retirement_body_digest != body_digest {
        return Err(invalid("normalized actor retirement body digest changed"));
    }
    let certificate_digest = digest_value(
        "actor-retirement-certificate",
        &json!({
            "retirement_body": certificate.retirement_body,
            "retirement_body_digest": body_digest,
        }),
    )?;
    if certificate.certificate_digest != certificate_digest {
        return Err(invalid(
            "normalized actor retirement certificate digest changed",
        ));
    }
    let signature_input = encode_signature_input(
        "actor-retirement-authority",
        &json!({ "certificate_digest": certificate_digest }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| invalid("normalized actor retirement signature input is invalid"))?;
    if !verify_library_core_ed25519(
        authority_public_key,
        &certificate.authority_signature,
        &signature_input,
    )
    .map_err(|_| invalid("normalized actor retirement signature is invalid"))?
    {
        return Err(invalid("normalized actor retirement signature is invalid"));
    }
    Ok(certificate)
}

fn create_certificate(
    target: &ActiveRetirementTarget,
    reason: &str,
    retired_at_ms: i64,
    authority_key_pair: &Ed25519KeyPair,
) -> Result<(NormalizedActorRetirementCertificateV1, String), NormalizedSqliteError> {
    let body = NormalizedActorRetirementBodyV1 {
        format: FORMAT.to_owned(),
        library_id: target.library_id.clone(),
        epoch: target.epoch,
        epoch_id: target.epoch_id.clone(),
        authority_key_id: target.authority_key_id.clone(),
        actor_id: target.actor_id.clone(),
        capability_id: target.capability_id.clone(),
        capability_certificate_digest: target.capability_certificate_digest.clone(),
        retirement_identity: target.retirement_identity.clone(),
        reason: reason.to_owned(),
        retired_at_ms,
        signature_algorithm: SIGNATURE_ALGORITHM.to_owned(),
    };
    validate_body(&body)?;
    let body_value = serde_json::to_value(&body)
        .map_err(|_| invalid("normalized actor retirement body is invalid"))?;
    let body_digest = digest_value("actor-retirement-body", &body_value)?;
    let certificate_digest = digest_value(
        "actor-retirement-certificate",
        &json!({
            "retirement_body": body,
            "retirement_body_digest": body_digest,
        }),
    )?;
    let signature_input = encode_signature_input(
        "actor-retirement-authority",
        &json!({ "certificate_digest": certificate_digest }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| invalid("normalized actor retirement signature input is invalid"))?;
    let certificate = NormalizedActorRetirementCertificateV1 {
        retirement_body: body,
        retirement_body_digest: body_digest,
        certificate_digest,
        authority_signature: lower_hex(authority_key_pair.sign(&signature_input).as_ref()),
    };
    let canonical = encode_canonical_value(
        &serde_json::to_value(&certificate)
            .map_err(|_| invalid("normalized actor retirement certificate is invalid"))?,
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| invalid("normalized actor retirement certificate is invalid"))?;
    let verified = verify_normalized_actor_retirement_certificate_v1(
        &canonical,
        &target.authority_public_key,
    )?;
    if verified != certificate {
        return Err(invalid("normalized actor retirement certificate changed"));
    }
    let canonical_json = String::from_utf8(canonical)
        .map_err(|_| invalid("normalized actor retirement certificate is not UTF-8"))?;
    Ok((certificate, canonical_json))
}

fn existing_retirement(
    transaction: &Transaction<'_>,
    actor_id: &str,
) -> Result<Option<(NormalizedActorRetirementReceiptV1, String, String)>, NormalizedSqliteError> {
    transaction
        .query_row(
            "SELECT retirement.capability_id, retirement.retirement_identity,
                    retirement.certificate_digest, retirement.canonical_certificate,
                    retirement.retired_at, retirement.committed_revision,
                    epoch.authority_public_key, retirement.reason
             FROM library_actor_retirements AS retirement
             JOIN library_active_authority AS active
               ON active.active_key = 'active'
              AND active.epoch_id = retirement.authority_epoch_id
             JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
             JOIN library_meta AS meta ON meta.singleton_id = 1
              AND meta.library_id = active.library_id
              AND meta.authority_epoch = active.epoch_id
             WHERE retirement.actor_id = ?1;",
            [actor_id],
            |row| {
                Ok((
                    NormalizedActorRetirementReceiptV1 {
                        actor_id: actor_id.to_owned(),
                        capability_id: row.get(0)?,
                        retirement_identity: row.get(1)?,
                        certificate_digest: row.get(2)?,
                        canonical_certificate_json: row.get(3)?,
                        retired_at_ms: row.get(4)?,
                        committed_revision: row.get(5)?,
                    },
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()
        .map_err(Into::into)
}

fn load_active_target(
    transaction: &Transaction<'_>,
    actor_id: &str,
) -> Result<ActiveRetirementTarget, NormalizedSqliteError> {
    transaction
        .query_row(
            "SELECT epoch.library_id, epoch.epoch_number, epoch.epoch_id,
                    epoch.authority_key_id, epoch.authority_public_key,
                    actor.actor_id, capability.capability_id,
                    capability.certificate_digest, capability.retirement_identity,
                    capability.issued_at, actor.created_at,
                    meta.source_revision, meta.updated_at
             FROM library_active_authority AS active
             JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
             JOIN library_writer_admission AS admission ON admission.singleton_id = 1
              AND admission.local_writer_id = admission.active_writer_id
              AND admission.active_writer_id = active.writer_id
              AND admission.observed_manifest_generation = active.accepted_manifest_generation
             JOIN library_meta AS meta ON meta.singleton_id = 1
              AND meta.library_id = active.library_id
              AND meta.authority_epoch = active.epoch_id
             JOIN library_actors AS actor ON actor.authority_epoch_id = active.epoch_id
              AND actor.actor_id = ?1 AND actor.retired_at IS NULL
              AND (actor.actor_kind <> 'desktop' OR EXISTS (
                SELECT 1 FROM library_actors AS replacement
                WHERE replacement.authority_epoch_id = active.epoch_id
                  AND replacement.actor_kind = 'desktop'
                  AND replacement.actor_id <> actor.actor_id
                  AND replacement.retired_at IS NULL
              ))
             JOIN library_actor_capabilities AS capability
              ON capability.actor_id = actor.actor_id
              AND capability.certificate_version = 2
              AND capability.retired_at IS NULL
             WHERE active.active_key = 'active';",
            [actor_id],
            |row| {
                Ok(ActiveRetirementTarget {
                    library_id: row.get(0)?,
                    epoch: row.get(1)?,
                    epoch_id: row.get(2)?,
                    authority_key_id: row.get(3)?,
                    authority_public_key: row.get(4)?,
                    actor_id: row.get(5)?,
                    capability_id: row.get(6)?,
                    capability_certificate_digest: row.get(7)?,
                    retirement_identity: row.get(8)?,
                    issued_at: row.get(9)?,
                    actor_created_at: row.get(10)?,
                    source_revision: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )
        .map_err(|_| invalid("normalized actor retirement target is not active"))
}

pub fn apply_normalized_actor_retirement_v1(
    connection: &mut Connection,
    actor_id: &str,
    reason: &str,
    retired_at_ms: i64,
    authority_key_pair: &Ed25519KeyPair,
) -> Result<NormalizedActorRetirementReceiptV1, NormalizedSqliteError> {
    if !is_lower_sha256(actor_id)
        || !RETIREMENT_REASONS.contains(&reason)
        || !(0..=MAX_SAFE_INTEGER).contains(&retired_at_ms)
    {
        return Err(invalid("normalized actor retirement request is invalid"));
    }
    let transaction = connection.transaction()?;
    if let Some((receipt, authority_public_key, stored_reason)) =
        existing_retirement(&transaction, actor_id)?
    {
        if receipt.retired_at_ms != retired_at_ms || stored_reason != reason {
            return Err(invalid("normalized actor retirement replay changed"));
        }
        let certificate = verify_normalized_actor_retirement_certificate_v1(
            receipt.canonical_certificate_json.as_bytes(),
            &authority_public_key,
        )?;
        if certificate.certificate_digest != receipt.certificate_digest
            || certificate.retirement_body.actor_id != receipt.actor_id
            || certificate.retirement_body.capability_id != receipt.capability_id
            || certificate.retirement_body.retirement_identity != receipt.retirement_identity
        {
            return Err(invalid("normalized actor retirement receipt changed"));
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    let target = load_active_target(&transaction, actor_id)?;
    if retired_at_ms < target.issued_at
        || retired_at_ms < target.actor_created_at
        || retired_at_ms < target.updated_at
        || lower_hex(authority_key_pair.public_key().as_ref()) != target.authority_public_key
        || authority_key_id(&target.authority_public_key)? != target.authority_key_id
    {
        return Err(invalid("normalized actor retirement authority changed"));
    }
    let (certificate, canonical_certificate_json) =
        create_certificate(&target, reason, retired_at_ms, authority_key_pair)?;
    let committed_revision = target
        .source_revision
        .checked_add(1)
        .ok_or_else(|| invalid("normalized actor retirement revision overflowed"))?;
    transaction.execute(
        "INSERT INTO library_actor_retirements
         (retirement_identity, actor_id, capability_id, authority_epoch_id,
          capability_certificate_digest, reason, retired_at,
          certificate_digest, canonical_certificate, committed_revision)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
        params![
            target.retirement_identity,
            target.actor_id,
            target.capability_id,
            target.epoch_id,
            target.capability_certificate_digest,
            reason,
            retired_at_ms,
            certificate.certificate_digest,
            canonical_certificate_json,
            committed_revision,
        ],
    )?;
    let capability_updated = transaction.execute(
        "UPDATE library_actor_capabilities
         SET retired_at = ?1, retirement_certificate_digest = ?2
         WHERE capability_id = ?3 AND actor_id = ?4
           AND retired_at IS NULL AND retirement_certificate_digest IS NULL;",
        params![
            retired_at_ms,
            certificate.certificate_digest,
            target.capability_id,
            target.actor_id,
        ],
    )?;
    let actor_updated = transaction.execute(
        "UPDATE library_actors SET retired_at = ?1, updated_at = ?1
         WHERE actor_id = ?2 AND authority_epoch_id = ?3 AND retired_at IS NULL;",
        params![retired_at_ms, target.actor_id, target.epoch_id],
    )?;
    let revision_updated = transaction.execute(
        "UPDATE library_change_state SET revision = ?1
         WHERE singleton_id = 1 AND revision = ?2;",
        params![committed_revision, target.source_revision],
    )?;
    let meta_updated = transaction.execute(
        "UPDATE library_meta SET source_revision = ?1, updated_at = ?2
         WHERE singleton_id = 1 AND source_revision = ?3;",
        params![committed_revision, retired_at_ms, target.source_revision],
    )?;
    transaction.execute(
        "INSERT INTO library_invalidations
         (revision, ordinal, topic, entity_id, reset_required)
         VALUES (?1, 0, 'actor_retirement', ?2, 1);",
        params![committed_revision, target.actor_id],
    )?;
    if capability_updated != 1 || actor_updated != 1 || revision_updated != 1 || meta_updated != 1 {
        return Err(invalid(
            "normalized actor retirement state changed concurrently",
        ));
    }
    let receipt = NormalizedActorRetirementReceiptV1 {
        actor_id: target.actor_id,
        capability_id: target.capability_id,
        retirement_identity: target.retirement_identity,
        certificate_digest: certificate.certificate_digest,
        canonical_certificate_json,
        retired_at_ms,
        committed_revision,
    };
    transaction.commit()?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_normalized_schema_v1;
    use ring::rand::SystemRandom;

    fn fixture() -> (Connection, Ed25519KeyPair, String) {
        let connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).expect("authority key");
        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).expect("authority pair");
        let public_key = lower_hex(key_pair.public_key().as_ref());
        let key_id = authority_key_id(&public_key).expect("authority key ID");
        let library_id = "1".repeat(64);
        let epoch_id = "2".repeat(64);
        let actor_id = "3".repeat(64);
        let capability_id = "4".repeat(64);
        let retirement_identity = "5".repeat(64);
        connection
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 0, ?6, ?7, 1);",
                params![
                    epoch_id,
                    library_id,
                    key_id,
                    public_key,
                    "6".repeat(64),
                    "7".repeat(64),
                    "8".repeat(64),
                ],
            )
            .expect("epoch");
        connection
            .execute(
                "INSERT INTO library_active_authority
                 (active_key, library_id, epoch_id, writer_id,
                  accepted_manifest_generation, activated_at)
                 VALUES ('active', ?1, ?2, 'writer', 0, 1);",
                params![library_id, epoch_id],
            )
            .expect("active authority");
        connection
            .execute(
                "INSERT INTO library_writer_admission
                 (singleton_id, local_writer_id, active_writer_id,
                  observed_manifest_generation, observed_at)
                 VALUES (1, 'writer', 'writer', 0, 1);",
                [],
            )
            .expect("writer admission");
        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch,
                  source_revision, updated_at)
                 VALUES (1, ?1, 1, ?2, 0, 1);",
                params![library_id, epoch_id],
            )
            .expect("metadata");
        connection
            .execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  retired_at, created_at, updated_at)
                 VALUES (?1, ?2, 'pwa', ?3, 'enroll', ?4, '{}', ?5,
                         0, NULL, ?5, NULL, 1, 1);",
                params![
                    actor_id,
                    epoch_id,
                    "9".repeat(64),
                    capability_id,
                    "a".repeat(64),
                ],
            )
            .expect("actor");
        connection
            .execute(
                "INSERT INTO library_actor_capabilities
                 (capability_id, actor_id, certificate_version, actor_class,
                  scope_mode, scope_kind, scope_id, issuance_identity,
                  retirement_identity, certificate_digest, canonical_certificate,
                  issued_at, retired_at, retirement_certificate_digest)
                 VALUES (?1, ?2, 2, 'editor', 'library_wide', NULL, NULL,
                         ?1, ?3, ?1, '{}', 1, NULL, NULL);",
                params![capability_id, actor_id, retirement_identity],
            )
            .expect("capability");
        connection
            .execute(
                "INSERT INTO library_actor_capability_mutations
                 (capability_id, mutation_id)
                 VALUES (?1, 'feed_item_saved_assignment');",
                [&capability_id],
            )
            .expect("capability mutation");
        (connection, key_pair, actor_id)
    }

    #[test]
    fn signed_retirement_is_atomic_replay_safe_and_checkpoint_visible() {
        let (mut connection, key_pair, actor_id) = fixture();
        let receipt = apply_normalized_actor_retirement_v1(
            &mut connection,
            &actor_id,
            "device_removed",
            10,
            &key_pair,
        )
        .expect("retirement");
        assert_eq!(receipt.actor_id, actor_id);
        assert_eq!(receipt.committed_revision, 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_checkpoint_export
                     WHERE registry_key = '93_actor_retirement';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("checkpoint record"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT actor.retired_at, capability.retired_at,
                            capability.retirement_certificate_digest,
                            meta.source_revision
                     FROM library_actors AS actor
                     JOIN library_actor_capabilities AS capability
                       ON capability.actor_id = actor.actor_id
                     JOIN library_meta AS meta ON meta.singleton_id = 1
                     WHERE actor.actor_id = ?1;",
                    [&actor_id],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .expect("retired state"),
            (10, 10, receipt.certificate_digest.clone(), 1)
        );
        let replay = apply_normalized_actor_retirement_v1(
            &mut connection,
            &actor_id,
            "device_removed",
            10,
            &key_pair,
        )
        .expect("exact replay");
        assert_eq!(replay, receipt);

        let page = crate::export_normalized_checkpoint_page_v2(
            &connection,
            &crate::NormalizedCheckpointExportRequestV2::default(),
        )
        .expect("checkpoint export");
        assert!(page.done);
        let mut restored = Connection::open_in_memory().expect("restored database");
        install_normalized_schema_v1(&restored).expect("restored schema");
        crate::begin_normalized_checkpoint_stage_v2(
            &restored,
            &crate::BeginNormalizedCheckpointStageV2 {
                stage_id: "retirement-restore".into(),
                library_id: "1".repeat(64),
                authority_epoch: "2".repeat(64),
                source_revision: 1,
                expected_record_count: page.records.len(),
                created_at: 10,
            },
        )
        .expect("restore stage");
        crate::append_normalized_checkpoint_stage_page_v2(
            &mut restored,
            "retirement-restore",
            &page.records,
        )
        .expect("restore records");
        crate::finalize_normalized_checkpoint_stage_v2(&mut restored, "retirement-restore")
            .expect("restore activation");
        let restored_retirement = restored
            .query_row(
                "SELECT canonical_certificate, certificate_digest, committed_revision
                 FROM library_actor_retirements WHERE actor_id = ?1;",
                [&actor_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("restored retirement");
        assert_eq!(
            restored_retirement,
            (
                receipt.canonical_certificate_json.clone(),
                receipt.certificate_digest.clone(),
                receipt.committed_revision,
            )
        );
        let changed = apply_normalized_actor_retirement_v1(
            &mut connection,
            &actor_id,
            "key_compromised",
            10,
            &key_pair,
        )
        .expect_err("changed replay");
        assert!(changed.to_string().contains("replay changed"));
    }

    #[test]
    fn retirement_verifier_rejects_changed_canonical_bytes() {
        let (mut connection, key_pair, actor_id) = fixture();
        let receipt = apply_normalized_actor_retirement_v1(
            &mut connection,
            &actor_id,
            "user_requested",
            10,
            &key_pair,
        )
        .expect("retirement");
        let altered = receipt
            .canonical_certificate_json
            .replace("user_requested", "role_reassigned");
        let error = verify_normalized_actor_retirement_certificate_v1(
            altered.as_bytes(),
            &lower_hex(key_pair.public_key().as_ref()),
        )
        .expect_err("tamper");
        assert!(error.to_string().contains("digest changed"));
    }
}
