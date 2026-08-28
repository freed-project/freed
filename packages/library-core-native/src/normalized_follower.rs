use crate::normalized_sqlite::NormalizedSqliteError;
use crate::{
    countersign_actor_enrollment_request_bytes,
    library_core_actor_enrollment::{
        prepare_normalized_follower_actor_enrollment_request_v2, ActorKeyStore,
    },
    library_core_canonical::{
        encode_canonical_value, encode_operation_digest_input, encode_signature_input,
    },
    library_core_ed25519::verify_library_core_ed25519,
    library_core_hash::lower_hex,
    normalized_authority_credentials::AuthorityKeyStore,
    normalized_enrollment_verifier::verify_actor_enrollment as verify_actor_enrollment_certificate,
    normalized_mutation::{
        actor_state_at, NormalizedFollowerResultRecordV1, NormalizedMutationCausalTipV1,
    },
    normalized_operation::VerifiedActorEnrollment,
    normalized_operation_verifier::verify_operation_transaction,
    normalized_primary_mutation_context_v1,
    normalized_writer_reassignment::current_authority,
    NormalizedMutationContextV1,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const FOLLOWER_INTENT_MAXIMUM_MEMBERS: usize = 1_000;
const FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS: usize = 128;
const FOLLOWER_INTENT_PAGE_MAXIMUM_RESPONSE_BYTES: usize = 1_048_576;

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerRuntimeStatusV2 {
    pub state: &'static str,
    pub library_id: Option<String>,
    pub authority_epoch_id: Option<String>,
    pub actor_id: Option<String>,
    pub checkpoint_generation: Option<u64>,
    pub source_revision: Option<u64>,
    pub pending_intent_count: u64,
    pub published_intent_count: u64,
    pub imported_result_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerTransportContextV2 {
    pub actor_id: String,
    pub library_id: String,
    pub next_intent_actor_counter: i64,
    pub next_result_sequence: i64,
    pub previous_intent_segment_digest: Option<String>,
    pub previous_result_segment_digest: Option<String>,
    pub schema_version: u8,
    pub storage_epoch_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerTransportPageRequestV2 {
    pub actor_id: String,
    pub first_actor_counter: i64,
    pub limit: usize,
    pub schema_version: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerTransportPageV2 {
    pub actor_id: String,
    pub canonical_envelopes: Vec<Vec<u8>>,
    pub done: bool,
    pub first_actor_counter: i64,
    pub last_actor_counter: Option<i64>,
    pub schema_version: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerActorRequestV2 {
    pub library_id: String,
    pub authority_epoch_id: String,
    pub actor_id: String,
    pub actor_public_key: String,
    pub enrollment_request_digest: String,
    pub canonical_enrollment_request_json: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerActorEnrollmentV2 {
    pub library_id: String,
    pub authority_epoch_id: String,
    pub actor_id: String,
    pub actor_public_key: String,
    pub enrollment_certificate_digest: String,
    pub canonical_enrollment_certificate_json: String,
    pub actor_chain_genesis: String,
    pub enrolled_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentCommitReceiptV1 {
    pub transaction_id: String,
    pub actor_id: String,
    pub first_counter: i64,
    pub last_counter: i64,
    pub member_count: usize,
    pub optimistic_field_count: usize,
    pub state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentCursorV1 {
    pub actor_counter: i64,
    pub operation_id: String,
    pub transaction_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentPageRequestV1 {
    pub actor_id: String,
    pub cursor: Option<NormalizedFollowerIntentCursorV1>,
    pub maximum_records: usize,
    pub maximum_response_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentPageRecordV1 {
    pub actor_counter: i64,
    pub actor_id: String,
    pub canonical_envelope_json: String,
    pub intent_epoch: i64,
    pub intent_epoch_id: String,
    pub member_count: usize,
    pub member_index: usize,
    pub operation_id: String,
    pub state: String,
    pub transaction_digest: String,
    pub transaction_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentPageV1 {
    pub actor_id: String,
    pub done: bool,
    pub next_cursor: Option<NormalizedFollowerIntentCursorV1>,
    pub records: Vec<NormalizedFollowerIntentPageRecordV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentPublicationReceiptV1 {
    pub actor_id: String,
    pub published_at: i64,
    pub state: &'static str,
    pub transaction_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentTransportPublicationV2 {
    pub actor_id: String,
    pub first_actor_counter: i64,
    pub last_actor_counter: i64,
    pub library_id: String,
    pub object_key: String,
    pub previous_segment_digest: Option<String>,
    pub published_at: i64,
    pub semantic_segment_digest: String,
    pub stored_segment_digest: String,
    pub storage_epoch_id: String,
    pub transport_object_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentTransportPublicationReceiptV2 {
    pub actor_id: String,
    pub first_actor_counter: i64,
    pub last_actor_counter: i64,
    pub newly_published_transaction_count: usize,
    pub next_actor_counter: i64,
    pub published_at: i64,
    pub semantic_segment_digest: String,
    pub stored_segment_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerResultImportReceiptV1 {
    pub actor_id: String,
    pub first_result_sequence: i64,
    pub last_result_sequence: i64,
    pub result_count: usize,
    pub accepted_transaction_count: usize,
    pub rejected_transaction_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerResultTransportImportV2 {
    pub actor_id: String,
    pub library_id: String,
    pub object_key: String,
    pub previous_segment_digest: Option<String>,
    pub received_at: i64,
    pub records: Vec<NormalizedFollowerResultRecordV1>,
    pub semantic_segment_digest: String,
    pub stored_segment_digest: String,
    pub storage_epoch_id: String,
    pub transport_object_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerResultTransportImportReceiptV2 {
    pub accepted_transaction_count: usize,
    pub actor_id: String,
    pub first_result_sequence: i64,
    pub last_result_sequence: i64,
    pub next_result_sequence: i64,
    pub received_at: i64,
    pub rejected_transaction_count: usize,
    pub result_count: usize,
    pub semantic_segment_digest: String,
    pub stored_segment_digest: String,
}

fn actor_request(
    connection: &Connection,
    library_id: &str,
    authority_epoch_id: &str,
) -> Result<Option<NormalizedFollowerActorRequestV2>, NormalizedSqliteError> {
    connection
        .query_row(
            "SELECT library_id, authority_epoch_id, actor_id, actor_public_key,
                    enrollment_request_digest, canonical_enrollment_request,
                    created_at
             FROM library_follower_actor_request
             WHERE singleton_id = 1 AND library_id = ?1
               AND authority_epoch_id = ?2;",
            params![library_id, authority_epoch_id],
            |row| {
                let created_at = u64::try_from(row.get::<_, i64>(6)?)
                    .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(6, i64::MAX))?;
                Ok(NormalizedFollowerActorRequestV2 {
                    library_id: row.get(0)?,
                    authority_epoch_id: row.get(1)?,
                    actor_id: row.get(2)?,
                    actor_public_key: row.get(3)?,
                    enrollment_request_digest: row.get(4)?,
                    canonical_enrollment_request_json: row.get(5)?,
                    created_at,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

pub fn prepare_normalized_follower_actor_request_v2(
    connection: &mut Connection,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    created_at: i64,
) -> Result<NormalizedFollowerActorRequestV2, NormalizedSqliteError> {
    if created_at < 0 {
        return Err(invalid("normalized follower actor request time is invalid"));
    }
    let (authority, _, _, _) = current_authority(connection)?;
    let receipt_matches: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM library_follower_checkpoint_receipt
           WHERE singleton_id = 1 AND library_id = ?1
             AND authority_epoch_id = ?2
         );",
        params![authority.library_id, authority.epoch_id],
        |row| row.get(0),
    )?;
    if !receipt_matches {
        return Err(invalid("normalized follower checkpoint is unavailable"));
    }
    if let Some(existing) = actor_request(connection, &authority.library_id, &authority.epoch_id)? {
        return Ok(existing);
    }
    let prepared = prepare_normalized_follower_actor_enrollment_request_v2(
        &authority,
        installation_witness,
        actor_store,
        created_at,
    )
    .map_err(|_| invalid("normalized follower actor request is invalid"))?;
    let request = NormalizedFollowerActorRequestV2 {
        library_id: authority.library_id.clone(),
        authority_epoch_id: authority.epoch_id.clone(),
        actor_id: prepared.actor_id,
        actor_public_key: prepared.actor_public_key,
        enrollment_request_digest: prepared.enrollment_request_digest,
        canonical_enrollment_request_json: prepared.canonical_enrollment_request_json,
        created_at: u64::try_from(created_at)
            .map_err(|_| invalid("normalized follower actor request time is invalid"))?,
    };
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (current, _, _, _) = current_authority(&transaction)?;
    if current != authority {
        return Err(invalid(
            "normalized authority changed during follower actor preparation",
        ));
    }
    transaction.execute(
        "INSERT INTO library_follower_actor_request
         (singleton_id, library_id, authority_epoch_id, actor_id,
          actor_public_key, enrollment_request_digest,
          canonical_enrollment_request, created_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        params![
            request.library_id,
            request.authority_epoch_id,
            request.actor_id,
            request.actor_public_key,
            request.enrollment_request_digest,
            request.canonical_enrollment_request_json,
            request.created_at,
        ],
    )?;
    transaction.commit()?;
    Ok(request)
}

fn install_verified_actor(
    transaction: &Transaction<'_>,
    enrollment: &VerifiedActorEnrollment,
) -> Result<bool, NormalizedSqliteError> {
    type StoredActorIdentity = (String, String, String, String, String, String, Option<i64>);
    let existing: Option<StoredActorIdentity> = transaction
        .query_row(
            "SELECT authority_epoch_id, public_key, enrollment_operation_id,
                        enrollment_certificate_digest, canonical_enrollment_certificate,
                        chain_genesis_digest, retired_at
                 FROM library_actors WHERE actor_id = ?1;",
            [&enrollment.actor_id],
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
        .optional()?;
    let inserted = if let Some(existing) = existing {
        if existing
            != (
                enrollment.epoch_id.clone(),
                enrollment.actor_public_key.clone(),
                enrollment.enrollment_operation_id.clone(),
                enrollment.enrollment_certificate_digest.clone(),
                enrollment.canonical_enrollment_certificate_json.clone(),
                enrollment.actor_chain_genesis.clone(),
                None,
            )
        {
            return Err(invalid("normalized follower actor replay changed"));
        }
        false
    } else {
        transaction.execute(
            "INSERT INTO library_actors
             (actor_id, authority_epoch_id, actor_kind, public_key,
              enrollment_operation_id, enrollment_certificate_digest,
              canonical_enrollment_certificate, chain_genesis_digest,
              accepted_counter, accepted_operation_id, accepted_chain_digest,
              created_at, updated_at)
             VALUES (?1, ?2, 'pwa', ?3, ?4, ?5, ?6, ?7,
                     0, NULL, ?7, ?8, ?8);",
            params![
                enrollment.actor_id,
                enrollment.epoch_id,
                enrollment.actor_public_key,
                enrollment.enrollment_operation_id,
                enrollment.enrollment_certificate_digest,
                enrollment.canonical_enrollment_certificate_json,
                enrollment.actor_chain_genesis,
                enrollment.enrolled_at_ms,
            ],
        )?;
        true
    };
    let (scope_mode, scope_kind, scope_id) = enrollment.capability.stored_scope();
    let capability_id = &enrollment.capability.capability_certificate_digest;
    transaction.execute(
        "INSERT OR IGNORE INTO library_actor_capabilities
         (capability_id, actor_id, certificate_version, actor_class,
          scope_mode, scope_kind, scope_id, issuance_identity,
          retirement_identity, certificate_digest, canonical_certificate,
          issued_at, retired_at, retirement_certificate_digest)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?1, ?10, ?11, NULL, NULL);",
        params![
            capability_id,
            enrollment.actor_id,
            enrollment.capability.certificate_version,
            enrollment.capability.actor_class,
            scope_mode,
            scope_kind,
            scope_id,
            enrollment.capability.issuance_identity,
            enrollment.capability.retirement_identity,
            enrollment.canonical_enrollment_certificate_json,
            enrollment.capability.issued_at_ms,
        ],
    )?;
    let capability_matches: bool = transaction.query_row(
        "SELECT actor_id = ?2 AND certificate_version = ?3
                AND actor_class = ?4 AND scope_mode = ?5
                AND scope_kind IS ?6 AND scope_id IS ?7
                AND issuance_identity IS ?8 AND retirement_identity IS ?9
                AND canonical_certificate = ?10 AND retired_at IS NULL
         FROM library_actor_capabilities WHERE capability_id = ?1;",
        params![
            capability_id,
            enrollment.actor_id,
            enrollment.capability.certificate_version,
            enrollment.capability.actor_class,
            scope_mode,
            scope_kind,
            scope_id,
            enrollment.capability.issuance_identity,
            enrollment.capability.retirement_identity,
            enrollment.canonical_enrollment_certificate_json,
        ],
        |row| row.get(0),
    )?;
    if !capability_matches {
        return Err(invalid("normalized follower capability replay changed"));
    }
    for mutation_id in &enrollment.capability.allowed_operation_types {
        transaction.execute(
            "INSERT OR IGNORE INTO library_actor_capability_mutations
             (capability_id, mutation_id) VALUES (?1, ?2);",
            params![capability_id, mutation_id],
        )?;
    }
    let mutation_count: i64 = transaction.query_row(
        "SELECT count(*) FROM library_actor_capability_mutations
         WHERE capability_id = ?1;",
        [capability_id],
        |row| row.get(0),
    )?;
    if usize::try_from(mutation_count).ok()
        != Some(enrollment.capability.allowed_operation_types.len())
    {
        return Err(invalid(
            "normalized follower capability mutation set changed",
        ));
    }
    Ok(inserted)
}

fn enrollment_response(
    enrollment: &VerifiedActorEnrollment,
) -> Result<NormalizedFollowerActorEnrollmentV2, NormalizedSqliteError> {
    Ok(NormalizedFollowerActorEnrollmentV2 {
        library_id: enrollment.library_id.clone(),
        authority_epoch_id: enrollment.epoch_id.clone(),
        actor_id: enrollment.actor_id.clone(),
        actor_public_key: enrollment.actor_public_key.clone(),
        enrollment_certificate_digest: enrollment.enrollment_certificate_digest.clone(),
        canonical_enrollment_certificate_json: enrollment
            .canonical_enrollment_certificate_json
            .clone(),
        actor_chain_genesis: enrollment.actor_chain_genesis.clone(),
        enrolled_at: u64::try_from(enrollment.enrolled_at_ms)
            .map_err(|_| invalid("normalized follower enrollment time is invalid"))?,
    })
}

pub fn install_normalized_follower_actor_enrollment_v2(
    connection: &mut Connection,
    canonical_enrollment_certificate: &[u8],
) -> Result<NormalizedFollowerActorEnrollmentV2, NormalizedSqliteError> {
    let (authority, _, _, _) = current_authority(connection)?;
    let enrollment =
        verify_actor_enrollment_certificate(canonical_enrollment_certificate, &authority)
            .map_err(|_| invalid("normalized follower enrollment certificate is invalid"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let request = actor_request(&transaction, &authority.library_id, &authority.epoch_id)?
        .ok_or(invalid("normalized follower actor request is missing"))?;
    if request.actor_id != enrollment.actor_id
        || request.actor_public_key != enrollment.actor_public_key
        || request.enrollment_request_digest != enrollment.enrollment_certificate_digest
    {
        return Err(invalid(
            "normalized follower enrollment does not match its request",
        ));
    }
    install_verified_actor(&transaction, &enrollment)?;
    transaction.execute(
        "INSERT OR IGNORE INTO library_intent_actors
         (actor_id, next_counter, previous_operation_id, previous_chain_digest)
         VALUES (?1, 1, NULL, ?2);",
        params![enrollment.actor_id, enrollment.actor_chain_genesis],
    )?;
    let updated = transaction.execute(
        "UPDATE library_follower_actor_request
         SET enrollment_certificate_digest = ?1,
             canonical_enrollment_certificate = ?2,
             actor_chain_genesis = ?3, enrolled_at = ?4
         WHERE singleton_id = 1
           AND enrollment_certificate_digest IS NULL;",
        params![
            enrollment.enrollment_certificate_digest,
            enrollment.canonical_enrollment_certificate_json,
            enrollment.actor_chain_genesis,
            enrollment.enrolled_at_ms,
        ],
    )?;
    if updated == 0 {
        let matches: bool = transaction.query_row(
            "SELECT enrollment_certificate_digest = ?1
                    AND canonical_enrollment_certificate = ?2
                    AND actor_chain_genesis = ?3 AND enrolled_at = ?4
             FROM library_follower_actor_request WHERE singleton_id = 1;",
            params![
                enrollment.enrollment_certificate_digest,
                enrollment.canonical_enrollment_certificate_json,
                enrollment.actor_chain_genesis,
                enrollment.enrolled_at_ms,
            ],
            |row| row.get(0),
        )?;
        if !matches {
            return Err(invalid("normalized follower enrollment replay changed"));
        }
    }
    transaction.commit()?;
    enrollment_response(&enrollment)
}

pub fn countersign_normalized_follower_actor_request_v2(
    connection: &mut Connection,
    canonical_enrollment_request: &[u8],
    authority_store: &dyn AuthorityKeyStore,
    accepted_at: i64,
) -> Result<NormalizedFollowerActorEnrollmentV2, NormalizedSqliteError> {
    if accepted_at < 0 {
        return Err(invalid("normalized follower enrollment time is invalid"));
    }
    normalized_primary_mutation_context_v1(connection)?;
    let (authority, _, _, _) = current_authority(connection)?;
    let canonical_certificate =
        countersign_actor_enrollment_request_bytes(canonical_enrollment_request, authority_store)
            .map_err(|_| invalid("normalized follower actor countersignature failed"))?;
    let enrollment = verify_actor_enrollment_certificate(&canonical_certificate, &authority)
        .map_err(|_| invalid("normalized follower enrollment request is invalid"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let inserted = install_verified_actor(&transaction, &enrollment)?;
    if inserted {
        let previous_revision: i64 = transaction.query_row(
            "SELECT revision FROM library_change_state WHERE singleton_id = 1;",
            [],
            |row| row.get(0),
        )?;
        let committed_revision = previous_revision.checked_add(1).ok_or(invalid(
            "normalized follower enrollment revision is invalid",
        ))?;
        let meta_updated = transaction.execute(
            "UPDATE library_meta SET source_revision = ?1, updated_at = ?2
             WHERE singleton_id = 1 AND source_revision = ?3;",
            params![committed_revision, accepted_at, previous_revision],
        )?;
        let state_updated = transaction.execute(
            "UPDATE library_change_state SET revision = ?1
             WHERE singleton_id = 1 AND revision = ?2;",
            params![committed_revision, previous_revision],
        )?;
        if meta_updated != 1 || state_updated != 1 {
            return Err(invalid(
                "normalized follower enrollment authority changed concurrently",
            ));
        }
        transaction.execute(
            "INSERT INTO library_invalidations
             (revision, ordinal, topic, entity_id, reset_required)
             VALUES (?1, 0, 'authority', ?2, 0);",
            params![committed_revision, enrollment.actor_id],
        )?;
    }
    transaction.commit()?;
    enrollment_response(&enrollment)
}

fn active_follower_actor(
    connection: &Connection,
) -> Result<(String, String, String), NormalizedSqliteError> {
    connection
        .query_row(
            "SELECT request.actor_id, actor.public_key, request.authority_epoch_id
             FROM library_follower_actor_request AS request
             JOIN library_actors AS actor ON actor.actor_id = request.actor_id
             JOIN library_intent_actors AS intent ON intent.actor_id = actor.actor_id
             JOIN library_active_authority AS active
               ON active.epoch_id = request.authority_epoch_id
             WHERE request.singleton_id = 1
               AND request.enrollment_certificate_digest IS NOT NULL
               AND actor.authority_epoch_id = request.authority_epoch_id
               AND actor.retired_at IS NULL;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(invalid("normalized follower actor is not active"))
}

pub fn normalized_follower_mutation_context_v1(
    connection: &Connection,
) -> Result<NormalizedMutationContextV1, NormalizedSqliteError> {
    let (authority, _, _, _) = current_authority(connection)?;
    let (actor_id, actor_public_key, epoch_id) = active_follower_actor(connection)?;
    if epoch_id != authority.epoch_id {
        return Err(invalid("normalized follower actor epoch is stale"));
    }
    let (next_counter, previous_operation_id, previous_chain_digest): (
        i64,
        Option<String>,
        String,
    ) = connection.query_row(
        "SELECT next_counter, previous_operation_id, previous_chain_digest
         FROM library_intent_actors WHERE actor_id = ?1;",
        [&actor_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if !(1..=MAX_SAFE_INTEGER).contains(&next_counter) {
        return Err(invalid("normalized follower actor counter is exhausted"));
    }
    let mut statement = connection.prepare(
        "SELECT actor_id, accepted_counter, accepted_operation_id,
                accepted_chain_digest
         FROM library_authority_frontier
         WHERE epoch_id = ?1 ORDER BY ordinal LIMIT 1000;",
    )?;
    let observed_frontier = statement
        .query_map([&authority.epoch_id], |row| {
            Ok(NormalizedMutationCausalTipV1 {
                actor_id: row.get(0)?,
                sequence: row.get(1)?,
                operation_id: row.get(2)?,
                chain_digest: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(NormalizedMutationContextV1 {
        library_id: authority.library_id,
        epoch: authority.epoch,
        epoch_id: authority.epoch_id,
        actor_id,
        actor_public_key,
        next_counter,
        previous_operation_id,
        previous_chain_digest,
        observed_frontier,
    })
}

pub fn normalized_follower_transport_context_v2(
    connection: &Connection,
) -> Result<NormalizedFollowerTransportContextV2, NormalizedSqliteError> {
    let context = connection
        .query_row(
            "SELECT request.actor_id, meta.library_id, epoch.epoch_id,
                    COALESCE(intent_head.next_actor_counter, 1),
                    intent_head.latest_segment_digest,
                    COALESCE(result_head.next_result_sequence, 1),
                    result_head.latest_segment_digest
             FROM library_meta AS meta
             JOIN library_authority_epochs AS epoch
               ON epoch.epoch_id = meta.authority_epoch
             JOIN library_active_authority AS active
               ON active.library_id = meta.library_id
              AND active.epoch_id = epoch.epoch_id
             JOIN library_follower_actor_request AS request
               ON request.singleton_id = 1
              AND request.library_id = meta.library_id
              AND request.authority_epoch_id = epoch.epoch_id
              AND request.enrollment_certificate_digest IS NOT NULL
             JOIN library_intent_actors AS actor
               ON actor.actor_id = request.actor_id
             LEFT JOIN library_intent_transport_heads AS intent_head
               ON intent_head.actor_id = request.actor_id
             LEFT JOIN library_result_transport_heads AS result_head
               ON result_head.actor_id = request.actor_id
             WHERE meta.singleton_id = 1;",
            [],
            |row| {
                Ok(NormalizedFollowerTransportContextV2 {
                    actor_id: row.get(0)?,
                    library_id: row.get(1)?,
                    storage_epoch_id: row.get(2)?,
                    next_intent_actor_counter: row.get(3)?,
                    previous_intent_segment_digest: row.get(4)?,
                    next_result_sequence: row.get(5)?,
                    previous_result_segment_digest: row.get(6)?,
                    schema_version: 2,
                })
            },
        )
        .optional()?
        .ok_or(invalid(
            "normalized follower transport context is unavailable",
        ))?;
    if !(1..=MAX_SAFE_INTEGER).contains(&context.next_intent_actor_counter)
        || !(1..=MAX_SAFE_INTEGER).contains(&context.next_result_sequence)
        || (context.next_intent_actor_counter == 1)
            != context.previous_intent_segment_digest.is_none()
        || (context.next_result_sequence == 1) != context.previous_result_segment_digest.is_none()
    {
        return Err(invalid("normalized follower transport frontier is invalid"));
    }
    Ok(context)
}

pub fn page_normalized_follower_transport_v2(
    connection: &Connection,
    request: &NormalizedFollowerTransportPageRequestV2,
) -> Result<NormalizedFollowerTransportPageV2, NormalizedSqliteError> {
    if request.actor_id.len() != 64
        || !(1..=MAX_SAFE_INTEGER).contains(&request.first_actor_counter)
        || request.limit == 0
        || request.limit > FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS
        || request.schema_version != 2
    {
        return Err(invalid(
            "normalized follower transport page request is invalid",
        ));
    }
    let mut statement = connection.prepare(
        "SELECT member.actor_counter, member.canonical_member
         FROM library_intent_members AS member
         JOIN library_intent_transactions AS intent
           ON intent.transaction_id = member.transaction_id
          AND intent.actor_id = member.actor_id
         WHERE member.actor_id = ?1 AND member.actor_counter >= ?2
           AND intent.state IN ('pending', 'published')
         ORDER BY member.actor_counter
         LIMIT ?3;",
    )?;
    let fetch_limit = request.limit.saturating_add(1);
    let rows = statement
        .query_map(
            params![
                request.actor_id,
                request.first_actor_counter,
                i64::try_from(fetch_limit)
                    .map_err(|_| invalid("normalized follower transport limit is invalid"))?,
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?)),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut canonical_envelopes = Vec::with_capacity(request.limit.min(rows.len()));
    let mut canonical_bytes = 0_usize;
    let mut stopped_for_bytes = false;
    for (index, (counter, canonical)) in rows.iter().take(request.limit).enumerate() {
        let expected_counter = request
            .first_actor_counter
            .checked_add(
                i64::try_from(index)
                    .map_err(|_| invalid("normalized follower transport index is invalid"))?,
            )
            .ok_or(invalid(
                "normalized follower transport counter is exhausted",
            ))?;
        if *counter != expected_counter {
            return Err(invalid("normalized follower transport chain has a gap"));
        }
        let next_bytes = canonical_bytes.checked_add(canonical.len()).ok_or(invalid(
            "normalized follower transport byte count overflowed",
        ))?;
        if next_bytes > FOLLOWER_INTENT_PAGE_MAXIMUM_RESPONSE_BYTES {
            stopped_for_bytes = true;
            break;
        }
        canonical_envelopes.push(canonical.clone());
        canonical_bytes = next_bytes;
    }
    if canonical_envelopes.is_empty() && stopped_for_bytes {
        return Err(invalid(
            "normalized follower transport byte bound cannot fit one record",
        ));
    }
    let last_actor_counter = if canonical_envelopes.is_empty() {
        None
    } else {
        Some(
            request
                .first_actor_counter
                .checked_add(
                    i64::try_from(canonical_envelopes.len() - 1)
                        .map_err(|_| invalid("normalized follower transport page is invalid"))?,
                )
                .ok_or(invalid(
                    "normalized follower transport counter is exhausted",
                ))?,
        )
    };
    Ok(NormalizedFollowerTransportPageV2 {
        actor_id: request.actor_id.clone(),
        canonical_envelopes,
        done: !stopped_for_bytes && rows.len() <= request.limit,
        first_actor_counter: request.first_actor_counter,
        last_actor_counter,
        schema_version: 2,
    })
}

pub fn enqueue_normalized_follower_intent_v1(
    connection: &mut Connection,
    canonical_envelopes: &[Vec<u8>],
    enqueued_at: i64,
) -> Result<NormalizedFollowerIntentCommitReceiptV1, NormalizedSqliteError> {
    if canonical_envelopes.is_empty()
        || canonical_envelopes.len() > FOLLOWER_INTENT_MAXIMUM_MEMBERS
        || !(0..=MAX_SAFE_INTEGER).contains(&enqueued_at)
    {
        return Err(invalid("normalized follower intent request is invalid"));
    }
    let expected = normalized_follower_mutation_context_v1(connection)?;
    let verified = verify_operation_transaction(canonical_envelopes, |identity| {
        let mut actor = actor_state_at(connection, identity)?;
        actor.next_sequence = expected.next_counter;
        actor.previous_operation_id = expected.previous_operation_id.clone();
        actor.previous_chain_digest = expected.previous_chain_digest.clone();
        Ok(actor)
    })
    .map_err(|_| invalid("normalized follower intent verification failed"))?;
    if verified.library_id != expected.library_id
        || verified.epoch != expected.epoch
        || verified.epoch_id != expected.epoch_id
        || verified.actor_id != expected.actor_id
    {
        return Err(invalid("normalized follower intent authority changed"));
    }
    let first = verified
        .members
        .first()
        .ok_or(invalid("normalized follower intent has no first member"))?;
    let last = verified
        .members
        .last()
        .ok_or(invalid("normalized follower intent has no last member"))?;
    let receipt = |state| NormalizedFollowerIntentCommitReceiptV1 {
        transaction_id: verified.transaction_id.clone(),
        actor_id: verified.actor_id.clone(),
        first_counter: first.actor_sequence,
        last_counter: last.actor_sequence,
        member_count: verified.members.len(),
        optimistic_field_count: 0,
        state,
    };
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<(String, String, i64, i64, i64)> = transaction
        .query_row(
            "SELECT transaction_digest, actor_id, first_counter, last_counter,
                    member_count
             FROM library_intent_transactions WHERE transaction_id = ?1;",
            [&verified.transaction_id],
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
        .optional()?;
    if let Some(stored) = existing {
        if stored
            != (
                verified.transaction_digest.clone(),
                verified.actor_id.clone(),
                first.actor_sequence,
                last.actor_sequence,
                i64::try_from(verified.members.len())
                    .map_err(|_| invalid("normalized follower member count is invalid"))?,
            )
        {
            return Err(invalid(
                "normalized follower transaction identity was reused",
            ));
        }
        for (index, member) in verified.members.iter().enumerate() {
            let exact: bool = transaction.query_row(
                "SELECT canonical_member = ?3 AND operation_id = ?4
                 FROM library_intent_members
                 WHERE transaction_id = ?1 AND member_index = ?2;",
                params![
                    verified.transaction_id,
                    i64::try_from(index)
                        .map_err(|_| invalid("normalized follower member index is invalid"))?,
                    member.canonical_envelope_json.as_bytes(),
                    member.operation_id,
                ],
                |row| row.get(0),
            )?;
            if !exact {
                return Err(invalid("normalized follower transaction replay changed"));
            }
        }
        transaction.commit()?;
        return Ok(receipt("pending"));
    }
    let canonical_transaction = encode_canonical_value(
        &json!({
            "actor_id": verified.actor_id,
            "member_count": verified.members.len(),
            "transaction_digest": verified.transaction_digest,
            "transaction_id": verified.transaction_id,
        }),
        131_072,
    )
    .map_err(|_| invalid("normalized follower transaction identity is invalid"))?;
    transaction.execute(
        "INSERT INTO library_intent_transactions
         (transaction_id, transaction_digest, actor_id, intent_epoch,
          intent_epoch_id, member_count, first_counter, last_counter,
          previous_operation_id, previous_chain_digest, ending_operation_id,
          ending_chain_digest, canonical_member_bytes, canonical_transaction,
          state, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                 ?13, ?14, 'pending', ?15);",
        params![
            verified.transaction_id,
            verified.transaction_digest,
            verified.actor_id,
            verified.epoch,
            verified.epoch_id,
            i64::try_from(verified.members.len())
                .map_err(|_| invalid("normalized follower member count is invalid"))?,
            first.actor_sequence,
            last.actor_sequence,
            first.previous_actor_operation_id,
            first.previous_actor_chain_digest,
            last.operation_id,
            last.actor_chain_digest,
            i64::try_from(verified.canonical_envelope_bytes)
                .map_err(|_| invalid("normalized follower transaction bytes are invalid"))?,
            canonical_transaction,
            enqueued_at,
        ],
    )?;
    for (index, member) in verified.members.iter().enumerate() {
        transaction.execute(
            "INSERT INTO library_intent_members
             (transaction_id, actor_id, member_index, operation_id,
              actor_counter, mutation_id, entity_type, entity_id,
              canonical_member, member_digest)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
            params![
                verified.transaction_id,
                verified.actor_id,
                i64::try_from(index)
                    .map_err(|_| invalid("normalized follower member index is invalid"))?,
                member.operation_id,
                member.actor_sequence,
                member.operation_type,
                member.entity_type,
                member.entity_id,
                member.canonical_envelope_json.as_bytes(),
                member.member_digest,
            ],
        )?;
    }
    let updated = transaction.execute(
        "UPDATE library_intent_actors
         SET next_counter = ?2, previous_operation_id = ?3,
             previous_chain_digest = ?4
         WHERE actor_id = ?1 AND next_counter = ?5
           AND previous_operation_id IS ?6 AND previous_chain_digest = ?7;",
        params![
            verified.actor_id,
            last.actor_sequence + 1,
            last.operation_id,
            last.actor_chain_digest,
            first.actor_sequence,
            first.previous_actor_operation_id,
            first.previous_actor_chain_digest,
        ],
    )?;
    if updated != 1 {
        return Err(invalid(
            "normalized follower actor tip changed concurrently",
        ));
    }
    transaction.commit()?;
    Ok(receipt("pending"))
}

fn serialized_intent_page_bytes(
    page: &NormalizedFollowerIntentPageV1,
) -> Result<usize, NormalizedSqliteError> {
    serde_json::to_vec(page)
        .map(|bytes| bytes.len())
        .map_err(|_| invalid("normalized follower intent page is not encodable"))
}

pub fn export_normalized_follower_intent_page_v1(
    connection: &Connection,
    request: &NormalizedFollowerIntentPageRequestV1,
) -> Result<NormalizedFollowerIntentPageV1, NormalizedSqliteError> {
    if request.actor_id.is_empty()
        || request.actor_id.len() > 255
        || request.maximum_records == 0
        || request.maximum_records > FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS
        || request.maximum_response_bytes == 0
        || request.maximum_response_bytes > FOLLOWER_INTENT_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized follower intent page request is invalid",
        ));
    }
    let after_counter = if let Some(cursor) = request.cursor.as_ref() {
        if cursor.actor_counter < 1
            || cursor.operation_id.is_empty()
            || cursor.transaction_id.is_empty()
        {
            return Err(invalid("normalized follower intent cursor is invalid"));
        }
        let exact: Option<bool> = connection
            .query_row(
                "SELECT operation_id = ?3 AND transaction_id = ?4
                 FROM library_intent_members
                 WHERE actor_id = ?1 AND actor_counter = ?2;",
                params![
                    request.actor_id,
                    cursor.actor_counter,
                    cursor.operation_id,
                    cursor.transaction_id,
                ],
                |row| row.get(0),
            )
            .optional()?;
        if exact != Some(true) {
            return Err(invalid("normalized follower intent cursor is stale"));
        }
        cursor.actor_counter
    } else {
        0
    };
    let fetch_limit = request.maximum_records.saturating_add(1);
    let mut statement = connection.prepare(
        "SELECT member.actor_counter, member.actor_id, member.canonical_member,
                intent.intent_epoch, intent.intent_epoch_id, intent.member_count,
                member.member_index, member.operation_id, intent.state,
                intent.transaction_digest, intent.transaction_id
         FROM library_intent_members AS member
         JOIN library_intent_transactions AS intent
           ON intent.transaction_id = member.transaction_id
          AND intent.actor_id = member.actor_id
         WHERE member.actor_id = ?1 AND member.actor_counter > ?2
           AND intent.state IN ('pending', 'published')
         ORDER BY member.actor_counter, member.operation_id, member.transaction_id
         LIMIT ?3;",
    )?;
    let mut rows = statement.query(params![
        request.actor_id,
        after_counter,
        i64::try_from(fetch_limit)
            .map_err(|_| invalid("normalized follower intent page limit is invalid"))?,
    ])?;
    let mut page = NormalizedFollowerIntentPageV1 {
        actor_id: request.actor_id.clone(),
        done: true,
        next_cursor: request.cursor.clone(),
        records: Vec::with_capacity(request.maximum_records),
    };
    while let Some(row) = rows.next()? {
        if page.records.len() == request.maximum_records {
            page.done = false;
            break;
        }
        let canonical: Vec<u8> = row.get(2)?;
        let record = NormalizedFollowerIntentPageRecordV1 {
            actor_counter: row.get(0)?,
            actor_id: row.get(1)?,
            canonical_envelope_json: String::from_utf8(canonical)
                .map_err(|_| invalid("normalized follower intent is not UTF-8"))?,
            intent_epoch: row.get(3)?,
            intent_epoch_id: row.get(4)?,
            member_count: usize::try_from(row.get::<_, i64>(5)?)
                .map_err(|_| invalid("normalized follower member count is invalid"))?,
            member_index: usize::try_from(row.get::<_, i64>(6)?)
                .map_err(|_| invalid("normalized follower member index is invalid"))?,
            operation_id: row.get(7)?,
            state: row.get(8)?,
            transaction_digest: row.get(9)?,
            transaction_id: row.get(10)?,
        };
        let previous_cursor = page.next_cursor.clone();
        page.next_cursor = Some(NormalizedFollowerIntentCursorV1 {
            actor_counter: record.actor_counter,
            operation_id: record.operation_id.clone(),
            transaction_id: record.transaction_id.clone(),
        });
        page.records.push(record);
        if serialized_intent_page_bytes(&page)? > request.maximum_response_bytes {
            page.records.pop();
            page.next_cursor = previous_cursor;
            page.done = false;
            break;
        }
    }
    if page.records.is_empty() && !page.done {
        return Err(invalid(
            "normalized follower intent response bound cannot fit the next record",
        ));
    }
    if page.done {
        let last_counter = page
            .next_cursor
            .as_ref()
            .map(|cursor| cursor.actor_counter)
            .unwrap_or(after_counter);
        page.done = connection
            .query_row(
                "SELECT 1 FROM library_intent_members AS member
                 JOIN library_intent_transactions AS intent
                   ON intent.transaction_id = member.transaction_id
                  AND intent.actor_id = member.actor_id
                 WHERE member.actor_id = ?1 AND member.actor_counter > ?2
                   AND intent.state IN ('pending', 'published') LIMIT 1;",
                params![request.actor_id, last_counter],
                |_| Ok(()),
            )
            .optional()?
            .is_none();
    }
    Ok(page)
}

pub fn record_normalized_follower_intent_publication_v1(
    connection: &mut Connection,
    transaction_id: &str,
    transaction_digest: &str,
    actor_id: &str,
    published_at: i64,
) -> Result<NormalizedFollowerIntentPublicationReceiptV1, NormalizedSqliteError> {
    if transaction_id.is_empty()
        || transaction_id.len() > 255
        || actor_id.is_empty()
        || actor_id.len() > 255
        || transaction_digest.len() != 64
        || !(0..=MAX_SAFE_INTEGER).contains(&published_at)
    {
        return Err(invalid("normalized follower publication is invalid"));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let stored: (String, String, String, i64, Option<i64>) = transaction.query_row(
        "SELECT transaction_digest, actor_id, state, created_at, published_at
         FROM library_intent_transactions WHERE transaction_id = ?1;",
        [transaction_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )?;
    if stored.0 != transaction_digest || stored.1 != actor_id || published_at < stored.3 {
        return Err(invalid("normalized follower publication identity changed"));
    }
    if stored.2 == "pending" {
        transaction.execute(
            "UPDATE library_intent_transactions
             SET state = 'published', published_at = ?2
             WHERE transaction_id = ?1 AND state = 'pending';",
            params![transaction_id, published_at],
        )?;
    } else if stored.2 != "published" || stored.4 != Some(published_at) {
        return Err(invalid("normalized follower publication replay changed"));
    }
    transaction.commit()?;
    Ok(NormalizedFollowerIntentPublicationReceiptV1 {
        actor_id: actor_id.to_owned(),
        published_at,
        state: "published",
        transaction_id: transaction_id.to_owned(),
    })
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

pub fn record_normalized_follower_intent_transport_publication_v2(
    connection: &mut Connection,
    publication: &NormalizedFollowerIntentTransportPublicationV2,
) -> Result<NormalizedFollowerIntentTransportPublicationReceiptV2, NormalizedSqliteError> {
    let bounded_text = |value: &str, maximum: usize| !value.is_empty() && value.len() <= maximum;
    if !bounded_text(&publication.actor_id, 255)
        || !bounded_text(&publication.library_id, 255)
        || !bounded_text(&publication.storage_epoch_id, 255)
        || !bounded_text(&publication.object_key, 1_024)
        || !bounded_text(&publication.transport_object_id, 1_024)
        || !is_lower_sha256(&publication.semantic_segment_digest)
        || !is_lower_sha256(&publication.stored_segment_digest)
        || publication
            .previous_segment_digest
            .as_deref()
            .is_some_and(|value| !is_lower_sha256(value))
        || !(1..=MAX_SAFE_INTEGER).contains(&publication.first_actor_counter)
        || publication.last_actor_counter < publication.first_actor_counter
        || publication.last_actor_counter > MAX_SAFE_INTEGER
        || !(0..=MAX_SAFE_INTEGER).contains(&publication.published_at)
        || (publication.first_actor_counter == 1) != publication.previous_segment_digest.is_none()
    {
        return Err(invalid(
            "normalized follower intent transport publication is invalid",
        ));
    }
    let (authority, _, _, _) = current_authority(connection)?;
    let (active_actor_id, _, active_epoch_id) = active_follower_actor(connection)?;
    if authority.library_id != publication.library_id
        || authority.epoch_id != publication.storage_epoch_id
        || active_epoch_id != publication.storage_epoch_id
        || active_actor_id != publication.actor_id
    {
        return Err(invalid(
            "normalized follower intent transport authority changed",
        ));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute(
        "INSERT OR IGNORE INTO library_intent_transport_heads
         (actor_id, library_id, storage_epoch_id, next_actor_counter,
          latest_segment_digest)
         VALUES (?1, ?2, ?3, 1, NULL);",
        params![
            publication.actor_id,
            publication.library_id,
            publication.storage_epoch_id,
        ],
    )?;
    let head: (String, String, i64, Option<String>) = transaction.query_row(
        "SELECT library_id, storage_epoch_id, next_actor_counter,
                latest_segment_digest
         FROM library_intent_transport_heads WHERE actor_id = ?1;",
        [&publication.actor_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    if head.0 != publication.library_id || head.1 != publication.storage_epoch_id {
        return Err(invalid(
            "normalized follower intent transport head identity changed",
        ));
    }
    type StoredSegment = (
        i64,
        Option<String>,
        String,
        String,
        String,
        String,
        i64,
        i64,
    );
    let existing: Option<StoredSegment> = transaction
        .query_row(
            "SELECT last_actor_counter, previous_segment_digest,
                    semantic_segment_digest, stored_segment_digest, object_key,
                    transport_object_id, published_at,
                    published_transaction_count
             FROM library_intent_transport_segments
             WHERE actor_id = ?1 AND first_actor_counter = ?2;",
            params![publication.actor_id, publication.first_actor_counter],
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
        .optional()?;
    if let Some(existing) = existing {
        if existing.0 != publication.last_actor_counter
            || existing.1 != publication.previous_segment_digest
            || existing.2 != publication.semantic_segment_digest
            || existing.3 != publication.stored_segment_digest
            || existing.4 != publication.object_key
            || existing.5 != publication.transport_object_id
            || existing.6 != publication.published_at
        {
            return Err(invalid(
                "normalized follower intent transport publication replay changed",
            ));
        }
        transaction.commit()?;
        return Ok(NormalizedFollowerIntentTransportPublicationReceiptV2 {
            actor_id: publication.actor_id.clone(),
            first_actor_counter: publication.first_actor_counter,
            last_actor_counter: publication.last_actor_counter,
            newly_published_transaction_count: usize::try_from(existing.7)
                .map_err(|_| invalid("normalized follower intent transport receipt is invalid"))?,
            next_actor_counter: publication.last_actor_counter + 1,
            published_at: publication.published_at,
            semantic_segment_digest: publication.semantic_segment_digest.clone(),
            stored_segment_digest: publication.stored_segment_digest.clone(),
        });
    }
    if head.2 != publication.first_actor_counter || head.3 != publication.previous_segment_digest {
        return Err(invalid(
            "normalized follower intent transport publication does not extend its head",
        ));
    }
    let expected_records = publication
        .last_actor_counter
        .checked_sub(publication.first_actor_counter)
        .and_then(|value| value.checked_add(1))
        .ok_or(invalid(
            "normalized follower intent transport range is invalid",
        ))?;
    let stored_records: i64 = transaction.query_row(
        "SELECT count(*)
         FROM library_intent_members AS member
         JOIN library_intent_transactions AS intent
           ON intent.transaction_id = member.transaction_id
          AND intent.actor_id = member.actor_id
         WHERE member.actor_id = ?1
           AND member.actor_counter BETWEEN ?2 AND ?3
           AND intent.state IN ('pending', 'published');",
        params![
            publication.actor_id,
            publication.first_actor_counter,
            publication.last_actor_counter,
        ],
        |row| row.get(0),
    )?;
    if stored_records != expected_records {
        return Err(invalid(
            "normalized follower intent transport range is not fully durable",
        ));
    }
    let publishable: (i64, Option<i64>) = transaction.query_row(
        "SELECT count(*), max(created_at)
         FROM library_intent_transactions
         WHERE actor_id = ?1 AND state = 'pending'
           AND last_counter <= ?2;",
        params![publication.actor_id, publication.last_actor_counter],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if publishable
        .1
        .is_some_and(|created_at| publication.published_at < created_at)
    {
        return Err(invalid(
            "normalized follower intent transport publication predates its transaction",
        ));
    }
    transaction.execute(
        "INSERT INTO library_intent_transport_segments
         (actor_id, first_actor_counter, last_actor_counter,
          previous_segment_digest, semantic_segment_digest,
          stored_segment_digest, object_key, transport_object_id, published_at,
          published_transaction_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
        params![
            publication.actor_id,
            publication.first_actor_counter,
            publication.last_actor_counter,
            publication.previous_segment_digest,
            publication.semantic_segment_digest,
            publication.stored_segment_digest,
            publication.object_key,
            publication.transport_object_id,
            publication.published_at,
            publishable.0,
        ],
    )?;
    let published_transactions = transaction.execute(
        "UPDATE library_intent_transactions
         SET state = 'published', published_at = ?3
         WHERE actor_id = ?1 AND state = 'pending' AND last_counter <= ?2;",
        params![
            publication.actor_id,
            publication.last_actor_counter,
            publication.published_at,
        ],
    )?;
    if i64::try_from(published_transactions).ok() != Some(publishable.0) {
        return Err(invalid(
            "normalized follower intent transport publication count changed",
        ));
    }
    let next_actor_counter = publication.last_actor_counter + 1;
    let head_updated = transaction.execute(
        "UPDATE library_intent_transport_heads
         SET next_actor_counter = ?2, latest_segment_digest = ?3
         WHERE actor_id = ?1 AND next_actor_counter = ?4
           AND latest_segment_digest IS ?5;",
        params![
            publication.actor_id,
            next_actor_counter,
            publication.stored_segment_digest,
            publication.first_actor_counter,
            publication.previous_segment_digest,
        ],
    )?;
    if head_updated != 1 {
        return Err(invalid(
            "normalized follower intent transport head changed concurrently",
        ));
    }
    transaction.commit()?;
    Ok(NormalizedFollowerIntentTransportPublicationReceiptV2 {
        actor_id: publication.actor_id.clone(),
        first_actor_counter: publication.first_actor_counter,
        last_actor_counter: publication.last_actor_counter,
        newly_published_transaction_count: published_transactions,
        next_actor_counter,
        published_at: publication.published_at,
        semantic_segment_digest: publication.semantic_segment_digest.clone(),
        stored_segment_digest: publication.stored_segment_digest.clone(),
    })
}

fn import_normalized_follower_result_page_in_transaction_v1(
    transaction: &Transaction<'_>,
    records: &[NormalizedFollowerResultRecordV1],
    received_at: i64,
) -> Result<NormalizedFollowerResultImportReceiptV1, NormalizedSqliteError> {
    if records.is_empty() || records.len() > 128 || !(0..=MAX_SAFE_INTEGER).contains(&received_at) {
        return Err(invalid("normalized follower result page is invalid"));
    }
    let (active_actor_id, _, _) = active_follower_actor(transaction)?;
    let (current_authority, _, _, _) = current_authority(transaction)?;
    if records
        .iter()
        .any(|record| record.actor_id != active_actor_id)
    {
        return Err(invalid("normalized follower result actor is invalid"));
    }
    transaction.execute(
        "INSERT OR IGNORE INTO library_intent_result_cursors
         (actor_id, next_result_sequence, previous_result_digest)
         VALUES (?1, 1, NULL);",
        [&active_actor_id],
    )?;
    let (mut next_sequence, mut previous_digest): (i64, Option<String>) = transaction.query_row(
        "SELECT next_result_sequence, previous_result_digest
         FROM library_intent_result_cursors WHERE actor_id = ?1;",
        [&active_actor_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let first_result_sequence = records[0].result_sequence;
    let mut accepted_transaction_count = 0_usize;
    let mut rejected_transaction_count = 0_usize;
    for record in records {
        if record.result_sequence < next_sequence {
            let exact: Option<bool> = transaction
                .query_row(
                    "SELECT result_digest = ?3 AND canonical_result = ?4
                     FROM library_intent_results
                     WHERE actor_id = ?1 AND result_sequence = ?2;",
                    params![
                        active_actor_id,
                        record.result_sequence,
                        record.result_digest,
                        record.canonical_result_json.as_bytes(),
                    ],
                    |row| row.get(0),
                )
                .optional()?;
            if exact != Some(true) {
                return Err(invalid("normalized follower result replay changed"));
            }
            continue;
        }
        if record.result_sequence != next_sequence
            || record.previous_result_digest != previous_digest
            || record.canonical_result_json.is_empty()
            || record.canonical_result_json.len() > 131_072
        {
            return Err(invalid(
                "normalized follower result chain is not contiguous",
            ));
        }
        let value: Value = serde_json::from_str(&record.canonical_result_json)
            .map_err(|_| invalid("normalized follower result JSON is invalid"))?;
        let object = value
            .as_object()
            .ok_or(invalid("normalized follower result must be an object"))?;
        const RESULT_FIELDS: &[&str] = &[
            "actor_id",
            "authoritative_source_revision",
            "authority_key_id",
            "canonical_operation_ids",
            "epoch",
            "epoch_id",
            "format",
            "intent_epoch",
            "intent_epoch_id",
            "library_id",
            "original_result_digest",
            "previous_result_digest",
            "receipt_ids",
            "rejection_reason",
            "replacement_fields",
            "resolved_at_ms",
            "result_body_digest",
            "result_sequence",
            "schema_version",
            "signature",
            "signature_algorithm",
            "status",
            "transaction_digest",
            "transaction_id",
        ];
        if object.len() != RESULT_FIELDS.len()
            || !RESULT_FIELDS
                .iter()
                .all(|field| object.contains_key(*field))
            || encode_canonical_value(&value, 131_072)
                .map_err(|_| invalid("normalized follower result is not canonical"))?
                != record.canonical_result_json.as_bytes()
        {
            return Err(invalid("normalized follower result field set is invalid"));
        }
        let text = |field: &'static str| {
            object
                .get(field)
                .and_then(Value::as_str)
                .ok_or(invalid("normalized follower result text field is invalid"))
        };
        let integer = |field: &'static str| {
            object.get(field).and_then(Value::as_i64).ok_or(invalid(
                "normalized follower result integer field is invalid",
            ))
        };
        if text("format")? != "freed_follower_result_v1"
            || integer("schema_version")? != 1
            || text("signature_algorithm")? != "ed25519"
            || text("actor_id")? != record.actor_id
            || text("transaction_id")? != record.transaction_id
            || text("transaction_digest")? != record.transaction_digest
            || text("epoch_id")? != record.authority_epoch_id
            || text("intent_epoch_id")? != record.intent_epoch_id
            || integer("result_sequence")? != record.result_sequence
            || integer("authoritative_source_revision")? != record.authoritative_source_revision
            || text("status")? != record.status
            || text("library_id")? != current_authority.library_id
            || object.get("previous_result_digest")
                != Some(
                    &record
                        .previous_result_digest
                        .as_ref()
                        .map_or(Value::Null, |digest| Value::String(digest.clone())),
                )
        {
            return Err(invalid("normalized follower result typed identity changed"));
        }
        let rejection_reason = object
            .get("rejection_reason")
            .and_then(|value| value.as_str().map(str::to_owned));
        let original_result_digest = object
            .get("original_result_digest")
            .and_then(|value| value.as_str().map(str::to_owned));
        if rejection_reason != record.rejection_reason
            || original_result_digest != record.original_result_digest
        {
            return Err(invalid("normalized follower result outcome changed"));
        }
        let (authority_key_id, authority_public_key, epoch_number, library_id): (
            String,
            String,
            i64,
            String,
        ) = transaction.query_row(
            "SELECT authority_key_id, authority_public_key, epoch_number, library_id
             FROM library_authority_epochs WHERE epoch_id = ?1;",
            [&record.authority_epoch_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        if text("authority_key_id")? != authority_key_id
            || integer("epoch")? != epoch_number
            || library_id != current_authority.library_id
        {
            return Err(invalid("normalized follower result authority key changed"));
        }
        let mut body = object.clone();
        let signature = body
            .remove("signature")
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or(invalid("normalized follower result signature is invalid"))?;
        body.remove("signature_algorithm");
        let claimed_digest = body
            .remove("result_body_digest")
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or(invalid("normalized follower result digest is invalid"))?;
        let digest_input =
            encode_operation_digest_input("follower-result-body", &Value::Object(body), 131_072)
                .map_err(|_| invalid("normalized follower result digest input is invalid"))?;
        let computed_digest = lower_hex(&Sha256::digest(digest_input));
        if claimed_digest != computed_digest || record.result_digest != computed_digest {
            return Err(invalid("normalized follower result digest changed"));
        }
        let signature_input = encode_signature_input(
            "follower-result-envelope",
            &json!({ "result_body_digest": computed_digest }),
            131_072,
        )
        .map_err(|_| invalid("normalized follower result signature input is invalid"))?;
        if !verify_library_core_ed25519(&authority_public_key, &signature, &signature_input)
            .map_err(|_| invalid("normalized follower result signature encoding is invalid"))?
        {
            return Err(invalid("normalized follower result signature is invalid"));
        }
        let intent: (String, String, String) = transaction.query_row(
            "SELECT transaction_digest, actor_id, intent_epoch_id
             FROM library_intent_transactions WHERE transaction_id = ?1;",
            [&record.transaction_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        if intent
            != (
                record.transaction_digest.clone(),
                record.actor_id.clone(),
                record.intent_epoch_id.clone(),
            )
        {
            return Err(invalid("normalized follower result intent changed"));
        }
        transaction.execute(
            "INSERT INTO library_intent_results
             (transaction_id, actor_id, authority_epoch_id, intent_epoch_id,
              result_sequence, previous_result_digest, result_digest, status,
              authoritative_source_revision, canonical_result, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);",
            params![
                record.transaction_id,
                record.actor_id,
                record.authority_epoch_id,
                record.intent_epoch_id,
                record.result_sequence,
                record.previous_result_digest,
                record.result_digest,
                record.status,
                record.authoritative_source_revision,
                record.canonical_result_json.as_bytes(),
                received_at,
            ],
        )?;
        let resolved_state = if record.status == "rejected" {
            rejected_transaction_count += 1;
            "rejected"
        } else {
            accepted_transaction_count += 1;
            "accepted"
        };
        transaction.execute(
            "UPDATE library_intent_transactions
             SET state = ?2, resolved_at = ?3 WHERE transaction_id = ?1;",
            params![record.transaction_id, resolved_state, received_at],
        )?;
        transaction.execute(
            "DELETE FROM library_optimistic_fields WHERE transaction_id = ?1;",
            [&record.transaction_id],
        )?;
        next_sequence += 1;
        previous_digest = Some(record.result_digest.clone());
    }
    let cursor_updated = transaction.execute(
        "UPDATE library_intent_result_cursors
         SET next_result_sequence = ?2, previous_result_digest = ?3
         WHERE actor_id = ?1;",
        params![active_actor_id, next_sequence, previous_digest],
    )?;
    if cursor_updated != 1 {
        return Err(invalid("normalized follower result cursor is missing"));
    }
    Ok(NormalizedFollowerResultImportReceiptV1 {
        actor_id: active_actor_id,
        first_result_sequence,
        last_result_sequence: records
            .last()
            .ok_or(invalid("normalized follower result page is empty"))?
            .result_sequence,
        result_count: records.len(),
        accepted_transaction_count,
        rejected_transaction_count,
    })
}

pub fn import_normalized_follower_result_page_v1(
    connection: &mut Connection,
    records: &[NormalizedFollowerResultRecordV1],
    received_at: i64,
) -> Result<NormalizedFollowerResultImportReceiptV1, NormalizedSqliteError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let receipt = import_normalized_follower_result_page_in_transaction_v1(
        &transaction,
        records,
        received_at,
    )?;
    transaction.commit()?;
    Ok(receipt)
}

fn normalized_result_segment_digest_v2(
    publication: &NormalizedFollowerResultTransportImportV2,
) -> Result<String, NormalizedSqliteError> {
    let first = publication
        .records
        .first()
        .ok_or(invalid("normalized follower result segment is empty"))?;
    let last = publication
        .records
        .last()
        .ok_or(invalid("normalized follower result segment is empty"))?;
    let mut results = Vec::with_capacity(publication.records.len());
    let mut canonical_result_bytes = 0_usize;
    for record in &publication.records {
        canonical_result_bytes = canonical_result_bytes
            .checked_add(record.canonical_result_json.len())
            .ok_or(invalid("normalized follower result segment is too large"))?;
        let value: Value = serde_json::from_str(&record.canonical_result_json)
            .map_err(|_| invalid("normalized follower result JSON is invalid"))?;
        if encode_canonical_value(&value, 131_072)
            .map_err(|_| invalid("normalized follower result is not canonical"))?
            != record.canonical_result_json.as_bytes()
        {
            return Err(invalid("normalized follower result is not canonical"));
        }
        results.push(value);
    }
    if canonical_result_bytes > 1_048_576 {
        return Err(invalid("normalized follower result segment is too large"));
    }
    let body = json!({
        "actor_id": publication.actor_id,
        "canonical_result_bytes": canonical_result_bytes,
        "first_result_sequence": first.result_sequence,
        "format": "freed_normalized_result_segment_v2",
        "kind": "normalized_result_segment_body",
        "last_result_sequence": last.result_sequence,
        "library_id": publication.library_id,
        "previous_segment_digest": publication.previous_segment_digest,
        "protocol": "normalized_result_segments_v2",
        "protocol_version": 2,
        "result_count": publication.records.len(),
        "results": results,
        "storage_epoch_id": publication.storage_epoch_id,
    });
    let digest_input =
        encode_operation_digest_input("normalized-result-segment-body-v2", &body, 1_114_112)
            .map_err(|_| invalid("normalized follower result segment digest input is invalid"))?;
    Ok(lower_hex(&Sha256::digest(digest_input)))
}

pub fn import_normalized_follower_result_transport_segment_v2(
    connection: &mut Connection,
    publication: &NormalizedFollowerResultTransportImportV2,
) -> Result<NormalizedFollowerResultTransportImportReceiptV2, NormalizedSqliteError> {
    let bounded_text = |value: &str, maximum: usize| !value.is_empty() && value.len() <= maximum;
    let first_result_sequence = publication
        .records
        .first()
        .map(|record| record.result_sequence)
        .ok_or(invalid(
            "normalized follower result transport segment is empty",
        ))?;
    let last_result_sequence = publication
        .records
        .last()
        .map(|record| record.result_sequence)
        .ok_or(invalid(
            "normalized follower result transport segment is empty",
        ))?;
    if publication.records.len() > 128
        || !bounded_text(&publication.actor_id, 255)
        || !bounded_text(&publication.library_id, 255)
        || !bounded_text(&publication.storage_epoch_id, 255)
        || !bounded_text(&publication.object_key, 1_024)
        || !bounded_text(&publication.transport_object_id, 1_024)
        || !is_lower_sha256(&publication.semantic_segment_digest)
        || !is_lower_sha256(&publication.stored_segment_digest)
        || publication
            .previous_segment_digest
            .as_deref()
            .is_some_and(|value| !is_lower_sha256(value))
        || !(0..=MAX_SAFE_INTEGER).contains(&publication.received_at)
        || (first_result_sequence == 1) != publication.previous_segment_digest.is_none()
        || publication
            .records
            .iter()
            .any(|record| record.actor_id != publication.actor_id)
    {
        return Err(invalid(
            "normalized follower result transport segment is invalid",
        ));
    }
    let computed_semantic_digest = normalized_result_segment_digest_v2(publication)?;
    if computed_semantic_digest != publication.semantic_segment_digest {
        return Err(invalid(
            "normalized follower result transport semantic digest changed",
        ));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (active_actor_id, _, active_epoch_id) = active_follower_actor(&transaction)?;
    let (authority, _, _, _) = current_authority(&transaction)?;
    if active_actor_id != publication.actor_id
        || active_epoch_id != publication.storage_epoch_id
        || authority.library_id != publication.library_id
        || authority.epoch_id != publication.storage_epoch_id
    {
        return Err(invalid(
            "normalized follower result transport authority changed",
        ));
    }
    transaction.execute(
        "INSERT OR IGNORE INTO library_result_transport_heads
         (actor_id, library_id, storage_epoch_id, next_result_sequence,
          latest_segment_digest)
         VALUES (?1, ?2, ?3, 1, NULL);",
        params![
            publication.actor_id,
            publication.library_id,
            publication.storage_epoch_id,
        ],
    )?;
    let head: (String, String, i64, Option<String>) = transaction.query_row(
        "SELECT library_id, storage_epoch_id, next_result_sequence,
                latest_segment_digest
         FROM library_result_transport_heads WHERE actor_id = ?1;",
        [&publication.actor_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    if head.0 != publication.library_id || head.1 != publication.storage_epoch_id {
        return Err(invalid(
            "normalized follower result transport head identity changed",
        ));
    }
    type StoredSegment = (
        i64,
        Option<String>,
        String,
        String,
        String,
        String,
        i64,
        i64,
        i64,
        i64,
    );
    let existing: Option<StoredSegment> = transaction
        .query_row(
            "SELECT last_result_sequence, previous_segment_digest,
                    semantic_segment_digest, stored_segment_digest, object_key,
                    transport_object_id, received_at, result_count,
                    accepted_transaction_count, rejected_transaction_count
             FROM library_result_transport_segments
             WHERE actor_id = ?1 AND first_result_sequence = ?2;",
            params![publication.actor_id, first_result_sequence],
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
                    row.get(8)?,
                    row.get(9)?,
                ))
            },
        )
        .optional()?;
    if let Some(existing) = existing {
        if existing.0 != last_result_sequence
            || existing.1 != publication.previous_segment_digest
            || existing.2 != publication.semantic_segment_digest
            || existing.3 != publication.stored_segment_digest
            || existing.4 != publication.object_key
            || existing.5 != publication.transport_object_id
            || existing.6 != publication.received_at
            || usize::try_from(existing.7).ok() != Some(publication.records.len())
        {
            return Err(invalid(
                "normalized follower result transport replay changed",
            ));
        }
        transaction.commit()?;
        return Ok(NormalizedFollowerResultTransportImportReceiptV2 {
            accepted_transaction_count: usize::try_from(existing.8)
                .map_err(|_| invalid("normalized follower result transport receipt is invalid"))?,
            actor_id: publication.actor_id.clone(),
            first_result_sequence,
            last_result_sequence,
            next_result_sequence: last_result_sequence + 1,
            received_at: publication.received_at,
            rejected_transaction_count: usize::try_from(existing.9)
                .map_err(|_| invalid("normalized follower result transport receipt is invalid"))?,
            result_count: publication.records.len(),
            semantic_segment_digest: publication.semantic_segment_digest.clone(),
            stored_segment_digest: publication.stored_segment_digest.clone(),
        });
    }
    if head.2 != first_result_sequence || head.3 != publication.previous_segment_digest {
        return Err(invalid(
            "normalized follower result transport segment does not extend its head",
        ));
    }
    let receipt = import_normalized_follower_result_page_in_transaction_v1(
        &transaction,
        &publication.records,
        publication.received_at,
    )?;
    if receipt.first_result_sequence != first_result_sequence
        || receipt.last_result_sequence != last_result_sequence
        || receipt.result_count != publication.records.len()
    {
        return Err(invalid(
            "normalized follower result transport import receipt changed",
        ));
    }
    transaction.execute(
        "INSERT INTO library_result_transport_segments
         (actor_id, first_result_sequence, last_result_sequence,
          previous_segment_digest, semantic_segment_digest,
          stored_segment_digest, object_key, transport_object_id, received_at,
          result_count, accepted_transaction_count, rejected_transaction_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12);",
        params![
            publication.actor_id,
            first_result_sequence,
            last_result_sequence,
            publication.previous_segment_digest,
            publication.semantic_segment_digest,
            publication.stored_segment_digest,
            publication.object_key,
            publication.transport_object_id,
            publication.received_at,
            receipt.result_count,
            receipt.accepted_transaction_count,
            receipt.rejected_transaction_count,
        ],
    )?;
    let next_result_sequence = last_result_sequence + 1;
    let updated = transaction.execute(
        "UPDATE library_result_transport_heads
         SET next_result_sequence = ?2, latest_segment_digest = ?3
         WHERE actor_id = ?1 AND next_result_sequence = ?4
           AND latest_segment_digest IS ?5;",
        params![
            publication.actor_id,
            next_result_sequence,
            publication.stored_segment_digest,
            first_result_sequence,
            publication.previous_segment_digest,
        ],
    )?;
    if updated != 1 {
        return Err(invalid(
            "normalized follower result transport head changed concurrently",
        ));
    }
    transaction.commit()?;
    Ok(NormalizedFollowerResultTransportImportReceiptV2 {
        accepted_transaction_count: receipt.accepted_transaction_count,
        actor_id: receipt.actor_id,
        first_result_sequence,
        last_result_sequence,
        next_result_sequence,
        received_at: publication.received_at,
        rejected_transaction_count: receipt.rejected_transaction_count,
        result_count: receipt.result_count,
        semantic_segment_digest: publication.semantic_segment_digest.clone(),
        stored_segment_digest: publication.stored_segment_digest.clone(),
    })
}

pub fn normalized_follower_runtime_status_v2(
    connection: &Connection,
) -> Result<NormalizedFollowerRuntimeStatusV2, NormalizedSqliteError> {
    let receipt: Option<(String, String, i64, i64)> = connection
        .query_row(
            "SELECT library_id, authority_epoch_id, checkpoint_generation,
                    source_revision
             FROM library_follower_checkpoint_receipt WHERE singleton_id = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((library_id, authority_epoch_id, generation, revision)) = receipt else {
        return Ok(NormalizedFollowerRuntimeStatusV2 {
            state: "awaiting_checkpoint",
            library_id: None,
            authority_epoch_id: None,
            actor_id: None,
            checkpoint_generation: None,
            source_revision: None,
            pending_intent_count: 0,
            published_intent_count: 0,
            imported_result_count: 0,
        });
    };
    let generation = u64::try_from(generation)
        .map_err(|_| invalid("normalized follower checkpoint generation is invalid"))?;
    let revision = u64::try_from(revision)
        .map_err(|_| invalid("normalized follower source revision is invalid"))?;
    let actor: Option<(String, bool)> = connection
        .query_row(
            "SELECT actor_id, enrollment_certificate_digest IS NOT NULL
             FROM library_follower_actor_request
             WHERE singleton_id = 1 AND library_id = ?1
               AND authority_epoch_id = ?2;",
            [&library_id, &authority_epoch_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (state, actor_id) = match actor {
        None => ("awaiting_enrollment", None),
        Some((actor_id, false)) => ("enrollment_pending", Some(actor_id)),
        Some((actor_id, true)) => {
            let active: bool = connection.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_intent_actors AS intent
                   JOIN library_actors AS actor ON actor.actor_id = intent.actor_id
                   WHERE intent.actor_id = ?1 AND actor.authority_epoch_id = ?2
                     AND actor.retired_at IS NULL
                 );",
                [&actor_id, &authority_epoch_id],
                |row| row.get(0),
            )?;
            if !active {
                return Err(invalid("normalized follower enrollment is incomplete"));
            }
            ("active", Some(actor_id))
        }
    };
    let (pending, published, imported): (i64, i64, i64) = connection.query_row(
        "SELECT
           (SELECT count(*) FROM library_intent_transactions WHERE state = 'pending'),
           (SELECT count(*) FROM library_intent_transactions WHERE state = 'published'),
           (SELECT count(*) FROM library_intent_results);",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    Ok(NormalizedFollowerRuntimeStatusV2 {
        state,
        library_id: Some(library_id),
        authority_epoch_id: Some(authority_epoch_id),
        actor_id,
        checkpoint_generation: Some(generation),
        source_revision: Some(revision),
        pending_intent_count: u64::try_from(pending)
            .map_err(|_| invalid("normalized follower pending count is invalid"))?,
        published_intent_count: u64::try_from(published)
            .map_err(|_| invalid("normalized follower published count is invalid"))?,
        imported_result_count: u64::try_from(imported)
            .map_err(|_| invalid("normalized follower result count is invalid"))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_operation_test_fixtures::tests::signed_envelopes;
    use crate::{
        describe_normalized_checkpoint_export_v2, install_normalized_schema_v1,
        prepare_fresh_normalized_desktop_library_v1,
    };
    use ring::signature::Ed25519KeyPair;
    use rusqlite::params;
    use std::cell::RefCell;

    #[derive(Default)]
    struct MemoryKeyStore(RefCell<Option<Vec<u8>>>);

    impl ActorKeyStore for MemoryKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(self.0.borrow().clone())
        }

        fn store(&self, _library_id: &str, bytes: &[u8]) -> Result<(), String> {
            self.0.replace(Some(bytes.to_vec()));
            Ok(())
        }
    }

    impl AuthorityKeyStore for MemoryKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(self.0.borrow().clone())
        }

        fn store(&self, _library_id: &str, bytes: &[u8]) -> Result<(), String> {
            self.0.replace(Some(bytes.to_vec()));
            Ok(())
        }
    }

    #[test]
    fn normalized_follower_enrollment_is_v2_replayable_and_initializes_intents() {
        let authority_store = MemoryKeyStore::default();
        let primary_actor_store = MemoryKeyStore::default();
        let follower_actor_store = MemoryKeyStore::default();
        let mut connection = Connection::open_in_memory().expect("open");
        install_normalized_schema_v1(&connection).expect("schema");
        prepare_fresh_normalized_desktop_library_v1(
            &mut connection,
            &"1".repeat(64),
            &primary_actor_store,
            &authority_store,
            1_000,
        )
        .expect("primary genesis");
        let checkpoint =
            describe_normalized_checkpoint_export_v2(&connection).expect("checkpoint identity");
        connection
            .execute(
                "INSERT INTO library_follower_checkpoint_receipt
                 (singleton_id, library_id, authority_epoch_id, writer_actor_id,
                  checkpoint_generation, source_revision, checkpoint_digest,
                  manifest_object_key, manifest_transport_object_id,
                  manifest_content_digest, control_revision, installed_at)
                 VALUES (1, ?1, ?2, ?3, 0, 0, ?4,
                         'manifest', 'object', ?4, 'revision', 1000);",
                params![
                    checkpoint.library_id,
                    checkpoint.authority_epoch,
                    checkpoint.writer_id,
                    "2".repeat(64),
                ],
            )
            .expect("follower checkpoint receipt");
        let request = prepare_normalized_follower_actor_request_v2(
            &mut connection,
            &"3".repeat(64),
            &follower_actor_store,
            2_000,
        )
        .expect("follower request");
        let accepted = countersign_normalized_follower_actor_request_v2(
            &mut connection,
            request.canonical_enrollment_request_json.as_bytes(),
            &authority_store,
            2_100,
        )
        .expect("countersign follower");
        assert_eq!(accepted.actor_id, request.actor_id);
        assert_eq!(
            crate::normalized_primary_follower_actor_transport_state_v1(
                &connection,
                &accepted.actor_id,
            )
            .expect("Primary follower transport frontier")
            .next_actor_counter,
            1,
        );
        let installed = install_normalized_follower_actor_enrollment_v2(
            &mut connection,
            accepted.canonical_enrollment_certificate_json.as_bytes(),
        )
        .expect("install follower");
        assert_eq!(installed, accepted);
        assert_eq!(
            normalized_follower_runtime_status_v2(&connection)
                .expect("active follower")
                .state,
            "active"
        );
        let actor_key_pair = Ed25519KeyPair::from_pkcs8(
            follower_actor_store
                .0
                .borrow()
                .as_deref()
                .expect("follower actor key"),
        )
        .expect("decode follower actor key");
        let (authority, _, _, _) = current_authority(&connection).expect("current authority");
        let verified = verify_actor_enrollment_certificate(
            accepted.canonical_enrollment_certificate_json.as_bytes(),
            &authority,
        )
        .expect("verified follower enrollment");
        let envelopes = signed_envelopes(&actor_key_pair, &verified);
        let intent = enqueue_normalized_follower_intent_v1(&mut connection, &envelopes, 2_200)
            .expect("enqueue follower intent");
        assert_eq!(intent.first_counter, 1);
        assert_eq!(intent.last_counter, 2);
        let transport_context = normalized_follower_transport_context_v2(&connection)
            .expect("follower transport context");
        assert_eq!(transport_context.actor_id, accepted.actor_id);
        assert_eq!(transport_context.next_intent_actor_counter, 1);
        assert_eq!(transport_context.next_result_sequence, 1);
        assert_eq!(transport_context.previous_intent_segment_digest, None);
        assert_eq!(transport_context.previous_result_segment_digest, None);
        let transport_page = page_normalized_follower_transport_v2(
            &connection,
            &NormalizedFollowerTransportPageRequestV2 {
                actor_id: accepted.actor_id.clone(),
                first_actor_counter: 1,
                limit: 128,
                schema_version: 2,
            },
        )
        .expect("page follower transport");
        assert_eq!(transport_page.canonical_envelopes, envelopes);
        assert_eq!(transport_page.last_actor_counter, Some(2));
        assert!(transport_page.done);
        let page = export_normalized_follower_intent_page_v1(
            &connection,
            &NormalizedFollowerIntentPageRequestV1 {
                actor_id: accepted.actor_id.clone(),
                cursor: None,
                maximum_records: 128,
                maximum_response_bytes: 1_048_576,
            },
        )
        .expect("export follower intent page");
        assert_eq!(page.records.len(), 2);
        assert!(page.done);
        let first_publication = record_normalized_follower_intent_transport_publication_v2(
            &mut connection,
            &NormalizedFollowerIntentTransportPublicationV2 {
                actor_id: accepted.actor_id.clone(),
                first_actor_counter: 1,
                last_actor_counter: 1,
                library_id: accepted.library_id.clone(),
                object_key: "intent-segment-1".into(),
                previous_segment_digest: None,
                published_at: 2_300,
                semantic_segment_digest: "4".repeat(64),
                stored_segment_digest: "5".repeat(64),
                storage_epoch_id: accepted.authority_epoch_id.clone(),
                transport_object_id: "transport-1".into(),
            },
        )
        .expect("publish first follower intent page");
        assert_eq!(first_publication.newly_published_transaction_count, 0);
        assert_eq!(first_publication.next_actor_counter, 2);
        let advanced_context = normalized_follower_transport_context_v2(&connection)
            .expect("advanced follower transport context");
        assert_eq!(advanced_context.next_intent_actor_counter, 2);
        assert_eq!(
            advanced_context.previous_intent_segment_digest,
            Some("5".repeat(64))
        );
        let still_pending: String = connection
            .query_row(
                "SELECT state FROM library_intent_transactions WHERE transaction_id = ?1;",
                [&intent.transaction_id],
                |row| row.get(0),
            )
            .expect("split transaction state");
        assert_eq!(still_pending, "pending");
        let second_publication = record_normalized_follower_intent_transport_publication_v2(
            &mut connection,
            &NormalizedFollowerIntentTransportPublicationV2 {
                actor_id: accepted.actor_id.clone(),
                first_actor_counter: 2,
                last_actor_counter: 2,
                library_id: accepted.library_id.clone(),
                object_key: "intent-segment-2".into(),
                previous_segment_digest: Some("5".repeat(64)),
                published_at: 2_301,
                semantic_segment_digest: "6".repeat(64),
                stored_segment_digest: "7".repeat(64),
                storage_epoch_id: accepted.authority_epoch_id.clone(),
                transport_object_id: "transport-2".into(),
            },
        )
        .expect("publish final follower intent page");
        assert_eq!(second_publication.newly_published_transaction_count, 1);
        assert_eq!(second_publication.next_actor_counter, 3);
        assert_eq!(
            record_normalized_follower_intent_transport_publication_v2(
                &mut connection,
                &NormalizedFollowerIntentTransportPublicationV2 {
                    actor_id: accepted.actor_id.clone(),
                    first_actor_counter: 2,
                    last_actor_counter: 2,
                    library_id: accepted.library_id.clone(),
                    object_key: "intent-segment-2".into(),
                    previous_segment_digest: Some("5".repeat(64)),
                    published_at: 2_301,
                    semantic_segment_digest: "6".repeat(64),
                    stored_segment_digest: "7".repeat(64),
                    storage_epoch_id: accepted.authority_epoch_id.clone(),
                    transport_object_id: "transport-2".into(),
                },
            )
            .expect("exact publication replay"),
            second_publication
        );
        let staged = crate::NormalizedFollowerIntentStagePageV1 {
            records: page
                .records
                .iter()
                .map(|record| crate::NormalizedFollowerIntentStageRecordV1 {
                    actor_counter: record.actor_counter,
                    actor_id: record.actor_id.clone(),
                    canonical_envelope_json: record.canonical_envelope_json.clone(),
                    intent_epoch: record.intent_epoch,
                    intent_epoch_id: record.intent_epoch_id.clone(),
                    member_count: record.member_count,
                    member_index: record.member_index,
                    operation_id: record.operation_id.clone(),
                    state: record.state.clone(),
                    transaction_digest: record.transaction_digest.clone(),
                    transaction_id: record.transaction_id.clone(),
                })
                .collect(),
        };
        let authority_key_pair =
            crate::load_established_authority_key_pair(&authority_store, &accepted.library_id)
                .expect("load authority key");
        let staged_receipt = crate::ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &staged,
            &authority_key_pair,
            2_400,
        )
        .expect("Primary resolves follower intent");
        assert_eq!(staged_receipt.resolved_transactions, 1);
        let results = crate::export_normalized_follower_result_page_v1(
            &connection,
            &crate::NormalizedFollowerResultPageRequestV1 {
                actor_id: accepted.actor_id.clone(),
                after: None,
                maximum_records: 128,
                maximum_response_bytes: 1_048_576,
            },
        )
        .expect("export signed follower result");
        assert_eq!(results.records.len(), 1);
        let mut result_publication = NormalizedFollowerResultTransportImportV2 {
            actor_id: accepted.actor_id.clone(),
            library_id: accepted.library_id.clone(),
            object_key: "result-object-1".into(),
            previous_segment_digest: None,
            received_at: 2_500,
            records: results.records.clone(),
            semantic_segment_digest: "8".repeat(64),
            stored_segment_digest: "9".repeat(64),
            storage_epoch_id: accepted.authority_epoch_id.clone(),
            transport_object_id: "result-transport-1".into(),
        };
        result_publication.semantic_segment_digest =
            normalized_result_segment_digest_v2(&result_publication)
                .expect("compute result segment digest");
        let imported = import_normalized_follower_result_transport_segment_v2(
            &mut connection,
            &result_publication,
        )
        .expect("import follower result transport segment");
        assert_eq!(imported.result_count, 1);
        assert_eq!(
            import_normalized_follower_result_transport_segment_v2(
                &mut connection,
                &result_publication,
            )
            .expect("exact result segment replay"),
            imported
        );
        let mut changed_result_publication = result_publication.clone();
        changed_result_publication.transport_object_id = "changed-result-transport".into();
        assert!(import_normalized_follower_result_transport_segment_v2(
            &mut connection,
            &changed_result_publication,
        )
        .is_err());
        assert_eq!(
            normalized_follower_runtime_status_v2(&connection)
                .expect("resolved follower")
                .imported_result_count,
            1
        );
        let replay = countersign_normalized_follower_actor_request_v2(
            &mut connection,
            request.canonical_enrollment_request_json.as_bytes(),
            &authority_store,
            3_000,
        )
        .expect("countersign replay");
        assert_eq!(replay, accepted);
        assert_eq!(
            connection
                .query_row(
                    "SELECT revision FROM library_change_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("enrollment revision"),
            1
        );
    }

    #[test]
    fn status_advances_only_through_checkpoint_request_and_verified_enrollment() {
        let connection = Connection::open_in_memory().expect("open");
        install_normalized_schema_v1(&connection).expect("schema");
        assert_eq!(
            normalized_follower_runtime_status_v2(&connection)
                .expect("empty status")
                .state,
            "awaiting_checkpoint"
        );
        let digest = "a".repeat(64);
        let writer = "b".repeat(64);
        let follower = "c".repeat(64);
        connection
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES ('epoch-1', 'library-1', 1, ?1, ?1, ?1, '{}', 0, ?1, ?1, 1);",
                [&digest],
            )
            .expect("epoch");
        connection
            .execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  created_at, updated_at)
                 VALUES (?1, 'epoch-1', 'desktop', ?1, 'enroll-writer', ?2,
                         '{}', ?2, 0, NULL, ?2, 1, 1);",
                params![writer, digest],
            )
            .expect("writer actor");
        connection
            .execute(
                "INSERT INTO library_follower_checkpoint_receipt
                 (singleton_id, library_id, authority_epoch_id, writer_actor_id,
                  checkpoint_generation, source_revision, checkpoint_digest,
                  manifest_object_key, manifest_transport_object_id,
                  manifest_content_digest, control_revision, installed_at)
                 VALUES (1, 'library-1', 'epoch-1', ?1, 4, 7, ?2,
                         'manifest', 'object', ?2, 'revision', 2);",
                params![writer, digest],
            )
            .expect("checkpoint receipt");
        assert_eq!(
            normalized_follower_runtime_status_v2(&connection)
                .expect("checkpoint status")
                .state,
            "awaiting_enrollment"
        );
        connection
            .execute(
                "INSERT INTO library_follower_actor_request
                 (singleton_id, library_id, authority_epoch_id, actor_id,
                  actor_public_key, enrollment_request_digest,
                  canonical_enrollment_request, created_at)
                 VALUES (1, 'library-1', 'epoch-1', ?1, ?1, ?2, '{}', 3);",
                params![follower, digest],
            )
            .expect("actor request");
        assert_eq!(
            normalized_follower_runtime_status_v2(&connection)
                .expect("pending status")
                .state,
            "enrollment_pending"
        );
        connection
            .execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  created_at, updated_at)
                 VALUES (?1, 'epoch-1', 'pwa', ?1, 'enroll-follower', ?2,
                         '{}', ?2, 0, NULL, ?2, 3, 3);",
                params![follower, digest],
            )
            .expect("follower actor");
        connection
            .execute(
                "INSERT INTO library_intent_actors
                 (actor_id, next_counter, previous_operation_id,
                  previous_chain_digest) VALUES (?1, 1, NULL, ?2);",
                params![follower, digest],
            )
            .expect("intent actor");
        connection
            .execute(
                "UPDATE library_follower_actor_request
                 SET enrollment_certificate_digest = ?1,
                     canonical_enrollment_certificate = '{}',
                     actor_chain_genesis = ?1, enrolled_at = 3
                 WHERE singleton_id = 1;",
                [&digest],
            )
            .expect("verified enrollment");
        let active = normalized_follower_runtime_status_v2(&connection).expect("active status");
        assert_eq!(active.state, "active");
        assert_eq!(active.actor_id.as_deref(), Some(follower.as_str()));
        assert_eq!(active.checkpoint_generation, Some(4));
        assert_eq!(active.source_revision, Some(7));
    }
}
