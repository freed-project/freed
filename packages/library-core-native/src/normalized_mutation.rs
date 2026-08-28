use crate::library_core_actor_capability::parse_normalized_stored_capability;
use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_error::{LibraryCoreError, LibraryCoreResult};
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::library_core_journal::validate_transaction;
use crate::normalized_operation::{ActorState, VerifiedOperationTransaction};
#[cfg(test)]
use crate::normalized_operation_verifier::verify_operation_transaction;
use crate::normalized_operation_verifier::{
    operation_admission_verdict, verify_operation_transaction_for_resolution,
    OperationAdmissionVerdict, OperationIdentity,
};
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{
    SqliteMutationProgram, CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
    FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS, OPERATION_TRANSACTION_MAXIMUM_BYTES,
    OPERATION_TRANSACTION_MAXIMUM_MEMBERS, SQLITE_MUTATION_PROGRAMS,
};
use ring::signature::{Ed25519KeyPair, KeyPair};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
type FeedItemUserStateRow = (
    i64,
    Option<i64>,
    i64,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedMutationReceiptV1 {
    pub transaction_id: String,
    pub transaction_digest: String,
    pub actor_id: String,
    pub member_count: usize,
    pub first_counter: i64,
    pub last_counter: i64,
    pub committed_operation_id: String,
    pub committed_chain_digest: String,
    pub previous_revision: i64,
    pub committed_revision: i64,
    pub committed_at: i64,
    pub follower_result_digest: String,
    pub follower_result_sequence: i64,
    pub canonical_follower_result: Vec<u8>,
    pub invalidations: Vec<NormalizedMutationInvalidationV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedMutationInvalidationV1 {
    pub ordinal: i64,
    pub topic: String,
    pub entity_id: Option<String>,
    pub reset_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedMutationContextV1 {
    pub library_id: String,
    pub epoch: i64,
    pub epoch_id: String,
    pub actor_id: String,
    pub actor_public_key: String,
    pub next_counter: i64,
    pub previous_operation_id: Option<String>,
    pub previous_chain_digest: String,
    pub observed_frontier: Vec<NormalizedMutationCausalTipV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedMutationCausalTipV1 {
    pub actor_id: String,
    pub sequence: i64,
    pub operation_id: String,
    pub chain_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NormalizedFollowerResultReceiptV1 {
    pub transaction_id: String,
    pub transaction_digest: String,
    pub actor_id: String,
    pub status: &'static str,
    pub follower_result_digest: String,
    pub follower_result_sequence: i64,
    pub canonical_follower_result: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NormalizedMutationResolutionV1 {
    Accepted(NormalizedMutationReceiptV1),
    FollowerResult(NormalizedFollowerResultReceiptV1),
}

pub(crate) fn actor_state_at(
    connection: &Connection,
    identity: &OperationIdentity,
) -> LibraryCoreResult<ActorState> {
    type ActorRow = (
        String,
        i64,
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        String,
        i64,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        i64,
        Option<i64>,
        Option<String>,
        String,
        Option<i64>,
        String,
        Option<String>,
        Option<String>,
    );
    let row: ActorRow = connection
        .query_row(
            "SELECT epoch.library_id, epoch.epoch_number, actor.authority_epoch_id,
                    actor.actor_id, actor.public_key, actor.enrollment_operation_id,
                    actor.enrollment_certificate_digest,
                    actor.canonical_enrollment_certificate,
                    actor.accepted_counter, actor.accepted_operation_id,
                    actor.accepted_chain_digest, capability.certificate_version,
                    capability.actor_class, capability.scope_mode,
                    capability.scope_kind, capability.scope_id,
                    capability.certificate_digest, capability.issued_at,
                    capability.retired_at, capability.retirement_certificate_digest,
                    actor.chain_genesis_digest, actor.retired_at,
                    capability.capability_id, capability.issuance_identity,
                    capability.retirement_identity
             FROM library_actors AS actor
             JOIN library_authority_epochs AS epoch
               ON epoch.epoch_id = actor.authority_epoch_id
             JOIN library_actor_capabilities AS capability
               ON capability.capability_id = (
                 SELECT candidate.capability_id
                 FROM library_actor_capabilities AS candidate
                 WHERE candidate.actor_id = actor.actor_id
                 ORDER BY (candidate.retired_at IS NULL) DESC,
                          candidate.issued_at DESC,
                          candidate.capability_id
                 LIMIT 1
               )
             WHERE actor.actor_id = ?1
               AND actor.authority_epoch_id = ?2
               AND epoch.library_id = ?3;",
            params![identity.actor_id, identity.epoch_id, identity.library_id],
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
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                    row.get(14)?,
                    row.get(15)?,
                    row.get(16)?,
                    row.get(17)?,
                    row.get(18)?,
                    row.get(19)?,
                    row.get(20)?,
                    row.get(21)?,
                    row.get(22)?,
                    row.get(23)?,
                    row.get(24)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| LibraryCoreError::ActorNotFound {
            actor_id: identity.actor_id.clone(),
        })?;
    let mut statement = connection.prepare(
        "SELECT mutation_id FROM library_actor_capability_mutations
         WHERE capability_id = ?1
         ORDER BY mutation_id;",
    )?;
    let allowed_operation_types = statement
        .query_map([&row.22], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let capability = parse_normalized_stored_capability(
        row.11,
        row.12,
        serde_json::to_string(&allowed_operation_types).map_err(|_| {
            LibraryCoreError::InvalidVerifiedInput {
                field: "actor_capability",
            }
        })?,
        row.13,
        row.14,
        row.15,
        row.23,
        row.24,
        row.16,
        row.17,
        i64::from(row.18.is_some()),
        row.19,
    )
    .map_err(|field| LibraryCoreError::InvalidVerifiedInput { field })?;
    let next_sequence = row
        .8
        .checked_add(1)
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or(LibraryCoreError::InvalidVerifiedInput {
            field: "actor_sequence",
        })?;
    Ok(ActorState {
        library_id: row.0,
        epoch: row.1,
        epoch_id: row.2,
        actor_id: row.3,
        actor_public_key: row.4,
        enrollment_operation_id: row.5,
        enrollment_certificate_digest: row.6,
        canonical_enrollment_certificate_json: row.7,
        actor_chain_genesis: row.20,
        next_sequence,
        previous_operation_id: row.9,
        previous_chain_digest: row.10,
        capability,
        retired: row.21.is_some(),
    })
}

fn admitted_authority_epoch(
    transaction: &Transaction<'_>,
    library_id: &str,
) -> Result<(i64, String), NormalizedSqliteError> {
    transaction
        .query_row(
            "SELECT epoch.epoch_number, epoch.epoch_id
         FROM library_writer_admission AS admission
         JOIN library_active_authority AS active ON active.active_key = 'active'
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         WHERE admission.singleton_id = 1
           AND admission.local_writer_id = admission.active_writer_id
           AND admission.active_writer_id = active.writer_id
           AND admission.observed_manifest_generation = active.accepted_manifest_generation
           AND active.library_id = ?1;",
            [library_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| {
            LibraryCoreError::StaleAuthority {
                library_id: library_id.to_owned(),
            }
            .into()
        })
}

const FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES: usize = 131_072;
const FOLLOWER_RESULT_PAGE_MAXIMUM_RECORDS: usize = 128;
const FOLLOWER_RESULT_PAGE_MAXIMUM_RESPONSE_BYTES: usize = 1_048_576;
const FOLLOWER_RESULT_PAGE_SQL: &str = "SELECT transaction_id, transaction_digest, actor_id,
            authority_epoch_id, intent_epoch_id, result_sequence,
            previous_result_digest, result_digest, status, rejection_reason,
            original_result_digest, authoritative_source_revision,
            canonical_result, enqueued_at
     FROM library_follower_result_outbox
     WHERE actor_id = ?1 AND result_sequence > ?2
     ORDER BY result_sequence
     LIMIT ?3;";
const FOLLOWER_RESULT_REJECTION_REASONS: &[&str] = &[
    "actor_retired",
    "capability_denied",
    "epoch_stale",
    "precondition_failed",
    "target_missing",
    "target_tombstoned",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerResultCursorV1 {
    pub actor_id: String,
    pub result_sequence: i64,
    pub result_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerResultPageRequestV1 {
    pub actor_id: String,
    pub after: Option<NormalizedFollowerResultCursorV1>,
    pub maximum_records: usize,
    pub maximum_response_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerResultRecordV1 {
    pub transaction_id: String,
    pub transaction_digest: String,
    pub actor_id: String,
    pub authority_epoch_id: String,
    pub intent_epoch_id: String,
    pub result_sequence: i64,
    pub previous_result_digest: Option<String>,
    pub result_digest: String,
    pub status: String,
    pub rejection_reason: Option<String>,
    pub original_result_digest: Option<String>,
    pub authoritative_source_revision: i64,
    pub canonical_result_json: String,
    pub enqueued_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerResultPageV1 {
    pub records: Vec<NormalizedFollowerResultRecordV1>,
    pub next_cursor: Option<NormalizedFollowerResultCursorV1>,
    pub done: bool,
    pub canonical_record_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentStageRecordV1 {
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
pub struct NormalizedFollowerIntentStagePageV1 {
    pub records: Vec<NormalizedFollowerIntentStageRecordV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerIntentStageReceiptV1 {
    pub exact_retries: usize,
    pub pending_transactions: usize,
    pub resolved_records: usize,
    pub resolved_transactions: usize,
    pub staged_records: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPrimaryFollowerActorTransportStateV1 {
    pub actor_id: String,
    pub library_id: String,
    pub storage_epoch_id: String,
    pub next_actor_counter: i64,
}

pub fn normalized_primary_follower_actor_transport_state_v1(
    connection: &Connection,
    actor_id: &str,
) -> Result<NormalizedPrimaryFollowerActorTransportStateV1, NormalizedSqliteError> {
    if !is_lower_sha256(actor_id) {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized Primary follower actor identity is invalid",
        ));
    }
    let state = connection
        .query_row(
            "SELECT actor.actor_id, meta.library_id, active.epoch_id,
                    MAX(actor.accepted_counter + 1, COALESCE((
                      SELECT MAX(member.actor_counter) + 1
                      FROM library_primary_intent_stage_members AS member
                      WHERE member.actor_id = actor.actor_id
                    ), actor.accepted_counter + 1))
             FROM library_meta AS meta
             JOIN library_active_authority AS active
               ON active.library_id = meta.library_id
             JOIN library_actors AS actor
              ON actor.authority_epoch_id = active.epoch_id
              AND actor.actor_id = ?1
              AND actor.actor_id <> active.writer_id
              AND actor.retired_at IS NULL
             WHERE meta.singleton_id = 1;",
            [actor_id],
            |row| {
                Ok(NormalizedPrimaryFollowerActorTransportStateV1 {
                    actor_id: row.get(0)?,
                    library_id: row.get(1)?,
                    storage_epoch_id: row.get(2)?,
                    next_actor_counter: row.get(3)?,
                })
            },
        )
        .optional()?
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized Primary follower actor is not enrolled",
        ))?;
    if !(1..=MAX_SAFE_INTEGER).contains(&state.next_actor_counter) {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized Primary follower actor counter is invalid",
        ));
    }
    Ok(state)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FollowerResultOutcome<'a> {
    Accepted,
    AlreadyApplied { original_result_digest: &'a str },
    Rejected { reason: &'a str },
}

struct FollowerResultProjection {
    operation_ids: Vec<String>,
    receipt_ids: Vec<String>,
    replacement_fields: Vec<Value>,
}

impl<'a> FollowerResultOutcome<'a> {
    const fn status(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::AlreadyApplied { .. } => "already_applied",
            Self::Rejected { .. } => "rejected",
        }
    }

    const fn rejection_reason(self) -> Option<&'a str> {
        match self {
            Self::Rejected { reason } => Some(reason),
            _ => None,
        }
    }

    const fn original_result_digest(self) -> Option<&'a str> {
        match self {
            Self::AlreadyApplied {
                original_result_digest,
            } => Some(original_result_digest),
            _ => None,
        }
    }
}

fn follower_result_digest(domain: &str, value: &Value) -> Result<String, NormalizedSqliteError> {
    let input =
        encode_operation_digest_input(domain, value, FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES)
            .map_err(|_| {
                NormalizedSqliteError::InvalidRequest(
                    "normalized follower result digest is invalid",
                )
            })?;
    Ok(lower_hex(&Sha256::digest(input)))
}

fn active_result_authority(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    authority_key_pair: &Ed25519KeyPair,
) -> Result<(String, i64, String), NormalizedSqliteError> {
    let (authority_key_id, authority_public_key, epoch_number, epoch_id): (
        String,
        String,
        i64,
        String,
    ) = transaction
        .query_row(
            "SELECT epoch.authority_key_id, epoch.authority_public_key,
                    epoch.epoch_number, epoch.epoch_id
             FROM library_active_authority AS active
             JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
             WHERE active.active_key = 'active'
               AND active.library_id = ?1;",
            [&verified.library_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized follower result authority is not active",
        ))?;
    if authority_public_key != lower_hex(authority_key_pair.public_key().as_ref()) {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result signing key is not active",
        ));
    }
    let expected_key_id = follower_result_digest(
        "authority-key",
        &json!({
            "authority_public_key": authority_public_key,
            "signature_algorithm": "ed25519",
        }),
    )?;
    if expected_key_id != authority_key_id {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result authority key identity is invalid",
        ));
    }
    Ok((authority_key_id, epoch_number, epoch_id))
}

fn follower_result_replacement_fields(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
) -> Result<Vec<Value>, NormalizedSqliteError> {
    let mut identities = BTreeSet::new();
    for member in &verified.members {
        extend_replacement_identities(&mut identities, &member.operation_type, &member.entity_id);
    }
    follower_result_replacement_fields_for_identities(transaction, identities, true)
}

fn extend_replacement_identities(
    identities: &mut BTreeSet<(String, &'static str)>,
    operation_type: &str,
    entity_id: &str,
) {
    let paths: &[&'static str] = match operation_type {
        "feed_item_read_assignment" => &["read_at"],
        "feed_item_saved_assignment" | "feed_item_archive_assignment" => {
            &["archived", "archived_at", "saved", "saved_at"]
        }
        "feed_item_like_assignment" => &["liked", "liked_at"],
        _ => &[],
    };
    for path in paths {
        identities.insert((entity_id.to_owned(), *path));
    }
}

fn follower_result_replacement_fields_for_identities(
    transaction: &Transaction<'_>,
    identities: BTreeSet<(String, &'static str)>,
    require_existing: bool,
) -> Result<Vec<Value>, NormalizedSqliteError> {
    let mut replacements = Vec::with_capacity(identities.len());
    for (entity_id, field_path) in identities {
        let row: Option<FeedItemUserStateRow> = transaction
            .query_row(
                "SELECT saved, saved_at, archived, archived_at, liked, liked_at, read_at
                 FROM library_feed_items WHERE global_id = ?1;",
                [&entity_id],
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
        let Some(row) = row else {
            if require_existing {
                return Err(NormalizedSqliteError::InvalidRequest(
                    "normalized follower result replacement target is absent",
                ));
            }
            continue;
        };
        let (value_type, boolean_value, integer_value) = match field_path {
            "saved" => ("boolean", Some(row.0 != 0), None),
            "saved_at" => (
                if row.1.is_some() { "integer" } else { "null" },
                None,
                row.1,
            ),
            "archived" => ("boolean", Some(row.2 != 0), None),
            "archived_at" => (
                if row.3.is_some() { "integer" } else { "null" },
                None,
                row.3,
            ),
            "liked" => (
                "boolean",
                Some(
                    row.4.ok_or(NormalizedSqliteError::InvalidRequest(
                        "normalized follower result liked state is absent",
                    ))? != 0,
                ),
                None,
            ),
            "liked_at" => (
                if row.5.is_some() { "integer" } else { "null" },
                None,
                row.5,
            ),
            "read_at" => (
                if row.6.is_some() { "integer" } else { "null" },
                None,
                row.6,
            ),
            _ => unreachable!("replacement paths are closed above"),
        };
        replacements.push(json!({
            "boolean_value": boolean_value,
            "entity_id": entity_id,
            "entity_type": "FeedItem",
            "field_path": field_path,
            "integer_value": integer_value,
            "real_value": null,
            "text_value": null,
            "value_type": value_type,
        }));
    }
    Ok(replacements)
}

fn stored_follower_result(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    expected_status: &str,
) -> Result<Option<(i64, String, Vec<u8>)>, NormalizedSqliteError> {
    let stored = transaction
        .query_row(
            "SELECT transaction_digest, actor_id, status, result_sequence,
                    result_digest, canonical_result
             FROM library_follower_result_outbox WHERE transaction_id = ?1;",
            [&verified.transaction_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((transaction_digest, actor_id, status, sequence, digest, bytes)) = stored else {
        return Ok(None);
    };
    if transaction_digest != verified.transaction_digest
        || actor_id != verified.actor_id
        || status != expected_status
    {
        return Err(LibraryCoreError::TransactionReplayConflict {
            transaction_id: verified.transaction_id.clone(),
        }
        .into());
    }
    Ok(Some((sequence, digest, bytes)))
}

fn require_original_accepted_result(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    original_result_digest: &str,
) -> Result<String, NormalizedSqliteError> {
    let original: Option<(String, String, String)> = transaction
        .query_row(
            "SELECT transaction_id, actor_id, status
             FROM library_follower_result_outbox
             WHERE result_digest = ?1;",
            [original_result_digest],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((transaction_id, actor_id, status)) = original else {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized already-applied result has no original accepted result",
        ));
    };
    if actor_id != verified.actor_id || status != "accepted" {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized already-applied result has no original accepted result",
        ));
    }
    Ok(transaction_id)
}

fn original_accepted_result_projection(
    transaction: &Transaction<'_>,
    original_transaction_id: &str,
) -> Result<FollowerResultProjection, NormalizedSqliteError> {
    let mut statement = transaction.prepare(
        "SELECT operation_id, envelope_digest, mutation_id, entity_id
         FROM library_operations
         WHERE transaction_id = ?1 ORDER BY member_index;",
    )?;
    let rows = statement
        .query_map([original_transaction_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.is_empty() {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized already-applied result has no original operations",
        ));
    }
    let mut identities = BTreeSet::new();
    let mut operation_ids = Vec::with_capacity(rows.len());
    let mut receipt_ids = Vec::with_capacity(rows.len());
    for (operation_id, envelope_digest, mutation_id, entity_id) in rows {
        extend_replacement_identities(&mut identities, &mutation_id, &entity_id);
        operation_ids.push(operation_id);
        receipt_ids.push(envelope_digest);
    }
    Ok(FollowerResultProjection {
        operation_ids,
        receipt_ids,
        replacement_fields: follower_result_replacement_fields_for_identities(
            transaction,
            identities,
            true,
        )?,
    })
}

fn current_result_projection(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    outcome: FollowerResultOutcome<'_>,
) -> Result<FollowerResultProjection, NormalizedSqliteError> {
    match outcome {
        FollowerResultOutcome::Accepted => Ok(FollowerResultProjection {
            operation_ids: verified
                .members
                .iter()
                .map(|member| member.operation_id.clone())
                .collect(),
            receipt_ids: verified
                .members
                .iter()
                .map(|member| member.envelope_digest.clone())
                .collect(),
            replacement_fields: follower_result_replacement_fields(transaction, verified)?,
        }),
        FollowerResultOutcome::Rejected { .. } => {
            let mut identities = BTreeSet::new();
            for member in &verified.members {
                extend_replacement_identities(
                    &mut identities,
                    &member.operation_type,
                    &member.entity_id,
                );
            }
            Ok(FollowerResultProjection {
                operation_ids: Vec::new(),
                receipt_ids: Vec::new(),
                replacement_fields: follower_result_replacement_fields_for_identities(
                    transaction,
                    identities,
                    false,
                )?,
            })
        }
        FollowerResultOutcome::AlreadyApplied {
            original_result_digest,
        } => {
            let original_transaction_id =
                require_original_accepted_result(transaction, verified, original_result_digest)?;
            original_accepted_result_projection(transaction, &original_transaction_id)
        }
    }
}

fn persist_follower_result_outcome(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    authority_key_pair: &Ed25519KeyPair,
    authoritative_source_revision: i64,
    resolved_at: i64,
    outcome: FollowerResultOutcome<'_>,
) -> Result<(i64, String, Vec<u8>), NormalizedSqliteError> {
    if !(0..=MAX_SAFE_INTEGER).contains(&authoritative_source_revision)
        || !(0..=MAX_SAFE_INTEGER).contains(&resolved_at)
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result time or revision is invalid",
        ));
    }
    if outcome
        .rejection_reason()
        .is_some_and(|reason| !FOLLOWER_RESULT_REJECTION_REASONS.contains(&reason))
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result rejection reason is invalid",
        ));
    }
    let (authority_key_id, epoch_number, epoch_id) =
        active_result_authority(transaction, verified, authority_key_pair)?;
    let stale_epoch = outcome.rejection_reason() == Some("epoch_stale");
    if stale_epoch {
        if epoch_number <= verified.epoch || epoch_id == verified.epoch_id {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized stale-epoch result has no newer active authority",
            ));
        }
    } else if epoch_number != verified.epoch || epoch_id != verified.epoch_id {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result intent epoch is not active",
        ));
    }
    if let Some(stored) = stored_follower_result(transaction, verified, outcome.status())? {
        return Ok(stored);
    }
    let projection = current_result_projection(transaction, verified, outcome)?;
    transaction.execute(
        "INSERT OR IGNORE INTO library_follower_result_cursors
         (actor_id, next_result_sequence, previous_result_digest)
         VALUES (?1, 1, NULL);",
        [&verified.actor_id],
    )?;
    let (result_sequence, previous_result_digest): (i64, Option<String>) = transaction.query_row(
        "SELECT next_result_sequence, previous_result_digest
         FROM library_follower_result_cursors WHERE actor_id = ?1;",
        [&verified.actor_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let body = json!({
        "actor_id": verified.actor_id,
        "authoritative_source_revision": authoritative_source_revision,
        "authority_key_id": authority_key_id,
        "canonical_operation_ids": projection.operation_ids,
        "epoch": epoch_number,
        "epoch_id": epoch_id,
        "format": "freed_follower_result_v1",
        "intent_epoch": verified.epoch,
        "intent_epoch_id": verified.epoch_id,
        "library_id": verified.library_id,
        "original_result_digest": outcome.original_result_digest(),
        "previous_result_digest": previous_result_digest,
        "receipt_ids": projection.receipt_ids,
        "rejection_reason": outcome.rejection_reason(),
        "replacement_fields": projection.replacement_fields,
        "resolved_at_ms": resolved_at,
        "result_sequence": result_sequence,
        "schema_version": 1,
        "status": outcome.status(),
        "transaction_digest": verified.transaction_digest,
        "transaction_id": verified.transaction_id,
    });
    let result_digest = follower_result_digest("follower-result-body", &body)?;
    let signature_input = encode_signature_input(
        "follower-result-envelope",
        &json!({ "result_body_digest": result_digest }),
        FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
    )
    .map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized follower result signature is invalid")
    })?;
    let mut envelope = body
        .as_object()
        .cloned()
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized follower result body is invalid",
        ))?;
    envelope.insert("result_body_digest".to_string(), json!(result_digest));
    envelope.insert(
        "signature".to_string(),
        json!(lower_hex(
            authority_key_pair.sign(&signature_input).as_ref()
        )),
    );
    envelope.insert("signature_algorithm".to_string(), json!("ed25519"));
    let canonical_result = encode_canonical_value(
        &Value::Object(envelope),
        FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
    )
    .map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized follower result exceeds its wire bound")
    })?;
    transaction.execute(
        "INSERT INTO library_follower_result_outbox
         (transaction_id, transaction_digest, actor_id,
          authority_epoch_id, intent_epoch_id, result_sequence,
          previous_result_digest, result_digest, status, rejection_reason,
          original_result_digest, authoritative_source_revision,
          canonical_result, enqueued_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14);",
        params![
            verified.transaction_id,
            verified.transaction_digest,
            verified.actor_id,
            epoch_id,
            verified.epoch_id,
            result_sequence,
            previous_result_digest,
            result_digest,
            outcome.status(),
            outcome.rejection_reason(),
            outcome.original_result_digest(),
            authoritative_source_revision,
            canonical_result,
            resolved_at,
        ],
    )?;
    let cursor_updated = transaction.execute(
        "UPDATE library_follower_result_cursors
         SET next_result_sequence = ?2, previous_result_digest = ?3
         WHERE actor_id = ?1 AND next_result_sequence = ?4
           AND previous_result_digest IS ?5;",
        params![
            verified.actor_id,
            result_sequence + 1,
            result_digest,
            result_sequence,
            previous_result_digest,
        ],
    )?;
    if cursor_updated != 1 {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result cursor changed concurrently",
        ));
    }
    Ok((result_sequence, result_digest, canonical_result))
}

fn serialized_follower_result_page_bytes(
    page: &NormalizedFollowerResultPageV1,
) -> Result<usize, NormalizedSqliteError> {
    serde_json::to_vec(page)
        .map(|bytes| bytes.len())
        .map_err(|error| {
            NormalizedSqliteError::Transport(format!(
                "normalized follower result page encoding failed: {error}"
            ))
        })
}

pub fn export_normalized_follower_result_page_v1(
    connection: &Connection,
    request: &NormalizedFollowerResultPageRequestV1,
) -> Result<NormalizedFollowerResultPageV1, NormalizedSqliteError> {
    if request.actor_id.is_empty() || request.actor_id.len() > 255 {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result actorId is invalid",
        ));
    }
    if request.maximum_records == 0
        || request.maximum_records > FOLLOWER_RESULT_PAGE_MAXIMUM_RECORDS
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result maximumRecords is outside its bound",
        ));
    }
    if request.maximum_response_bytes == 0
        || request.maximum_response_bytes > FOLLOWER_RESULT_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result maximumResponseBytes is outside its bound",
        ));
    }
    let (after_sequence, after_digest) = match request.after.as_ref() {
        Some(cursor)
            if cursor.actor_id == request.actor_id
                && (1..=MAX_SAFE_INTEGER).contains(&cursor.result_sequence)
                && is_lower_sha256(&cursor.result_digest) =>
        {
            (cursor.result_sequence, Some(cursor.result_digest.as_str()))
        }
        Some(_) => {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized follower result cursor is invalid",
            ));
        }
        None => (0, None),
    };
    if let Some(expected_digest) = after_digest {
        let stored_digest = connection
            .query_row(
                "SELECT result_digest FROM library_follower_result_outbox
                 WHERE actor_id = ?1 AND result_sequence = ?2;",
                params![request.actor_id, after_sequence],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if stored_digest.as_deref() != Some(expected_digest) {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized follower result cursor does not name a stored result",
            ));
        }
    }
    let fetch_limit = request.maximum_records.saturating_add(1);
    let mut statement = connection.prepare(FOLLOWER_RESULT_PAGE_SQL)?;
    let mut rows = statement.query(params![
        request.actor_id,
        after_sequence,
        i64::try_from(fetch_limit).map_err(|_| NormalizedSqliteError::InvalidRequest(
            "normalized follower result maximumRecords is invalid"
        ))?,
    ])?;
    let mut page = NormalizedFollowerResultPageV1 {
        records: Vec::with_capacity(request.maximum_records),
        next_cursor: request.after.clone(),
        done: true,
        canonical_record_bytes: 0,
    };
    let mut expected_sequence = after_sequence + 1;
    let mut expected_previous_digest = after_digest.map(str::to_owned);
    while let Some(row) = rows.next()? {
        if page.records.len() == request.maximum_records {
            break;
        }
        let canonical_result: Vec<u8> = row.get(12)?;
        if canonical_result.is_empty()
            || canonical_result.len() > FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES
        {
            return Err(NormalizedSqliteError::Transport(
                "normalized follower result record exceeds its exact byte bound".into(),
            ));
        }
        let record = NormalizedFollowerResultRecordV1 {
            transaction_id: row.get(0)?,
            transaction_digest: row.get(1)?,
            actor_id: row.get(2)?,
            authority_epoch_id: row.get(3)?,
            intent_epoch_id: row.get(4)?,
            result_sequence: row.get(5)?,
            previous_result_digest: row.get(6)?,
            result_digest: row.get(7)?,
            status: row.get(8)?,
            rejection_reason: row.get(9)?,
            original_result_digest: row.get(10)?,
            authoritative_source_revision: row.get(11)?,
            canonical_result_json: String::from_utf8(canonical_result).map_err(|_| {
                NormalizedSqliteError::Transport(
                    "normalized follower result record is not canonical UTF-8 JSON".into(),
                )
            })?,
            enqueued_at: row.get(13)?,
        };
        if record.actor_id != request.actor_id
            || record.result_sequence != expected_sequence
            || record.previous_result_digest != expected_previous_digest
            || !is_lower_sha256(&record.transaction_digest)
            || !is_lower_sha256(&record.result_digest)
        {
            return Err(NormalizedSqliteError::Transport(
                "normalized follower result chain is not one contiguous actor range".into(),
            ));
        }
        let canonical_bytes = record.canonical_result_json.len();
        let cursor = NormalizedFollowerResultCursorV1 {
            actor_id: record.actor_id.clone(),
            result_sequence: record.result_sequence,
            result_digest: record.result_digest.clone(),
        };
        let previous_cursor = page.next_cursor.clone();
        page.records.push(record);
        page.next_cursor = Some(cursor.clone());
        page.canonical_record_bytes += canonical_bytes;
        page.done = false;
        if serialized_follower_result_page_bytes(&page)? > request.maximum_response_bytes {
            page.records.pop();
            page.next_cursor = previous_cursor;
            page.canonical_record_bytes -= canonical_bytes;
            break;
        }
        expected_sequence += 1;
        expected_previous_digest = Some(cursor.result_digest);
    }
    let next_sequence = page
        .next_cursor
        .as_ref()
        .map(|cursor| cursor.result_sequence)
        .unwrap_or(0);
    page.done = connection
        .query_row(
            "SELECT 1 FROM library_follower_result_outbox
             WHERE actor_id = ?1 AND result_sequence > ?2 LIMIT 1;",
            params![request.actor_id, next_sequence],
            |_| Ok(()),
        )
        .optional()?
        .is_none();
    if page.records.is_empty() && !page.done {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower result response bound cannot fit the next record",
        ));
    }
    if serialized_follower_result_page_bytes(&page)? > request.maximum_response_bytes {
        return Err(NormalizedSqliteError::Transport(
            "normalized follower result response exceeded its exact byte bound".into(),
        ));
    }
    Ok(page)
}

fn verify_staged_follower_intent_identity(
    connection: &Connection,
    transaction_id: &str,
    canonical_envelopes: &[Vec<u8>],
) -> Result<(), NormalizedSqliteError> {
    let (verified, _) =
        verify_operation_transaction_for_resolution(canonical_envelopes, |identity| {
            actor_state_at(connection, identity)
        })?;
    validate_transaction(&verified)?;
    type StagedTransactionIdentity = (String, String, i64, String, i64, i64, i64);
    let staged: StagedTransactionIdentity = connection.query_row(
        "SELECT transaction_digest, actor_id, intent_epoch, intent_epoch_id,
                member_count, first_counter, last_counter
         FROM library_primary_intent_stage_transactions
         WHERE transaction_id = ?1;",
        [transaction_id],
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
    )?;
    let first = verified
        .members
        .first()
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized follower intent transaction has no members",
        ))?;
    let last = verified
        .members
        .last()
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized follower intent transaction has no members",
        ))?;
    if verified.transaction_id != transaction_id
        || staged.0 != verified.transaction_digest
        || staged.1 != verified.actor_id
        || staged.2 != verified.epoch
        || staged.3 != verified.epoch_id
        || staged.4
            != i64::try_from(verified.members.len()).map_err(|_| {
                NormalizedSqliteError::InvalidRequest(
                    "normalized follower intent verified member count is invalid",
                )
            })?
        || staged.5 != first.actor_sequence
        || staged.6 != last.actor_sequence
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower intent typed transaction identity disagrees with signed bytes",
        ));
    }
    let mut statement = connection.prepare(
        "SELECT member_index, actor_counter, operation_id, canonical_member
         FROM library_primary_intent_stage_members
         WHERE transaction_id = ?1 ORDER BY member_index;",
    )?;
    let staged_members = statement
        .query_map([transaction_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if staged_members.len() != verified.members.len() {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower intent staged member set is incomplete",
        ));
    }
    for (index, (member_index, actor_counter, operation_id, canonical_member)) in
        staged_members.iter().enumerate()
    {
        let member = &verified.members[index];
        if *member_index
            != i64::try_from(index).map_err(|_| {
                NormalizedSqliteError::InvalidRequest(
                    "normalized follower intent verified member index is invalid",
                )
            })?
            || *actor_counter != member.actor_sequence
            || operation_id != &member.operation_id
            || canonical_member.as_slice() != member.canonical_envelope_json.as_bytes()
        {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized follower intent typed member identity disagrees with signed bytes",
            ));
        }
    }
    Ok(())
}

pub fn ingest_normalized_follower_intent_page_v1(
    connection: &mut Connection,
    page: &NormalizedFollowerIntentStagePageV1,
    authority_key_pair: &Ed25519KeyPair,
    received_at: i64,
) -> Result<NormalizedFollowerIntentStageReceiptV1, NormalizedSqliteError> {
    if page.records.is_empty() || page.records.len() > FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower intent stage page is outside its record bound",
        ));
    }
    if !(0..=MAX_SAFE_INTEGER).contains(&received_at) {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized follower intent receive time is invalid",
        ));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut touched_transactions = BTreeSet::new();
    let mut exact_retries = 0_usize;
    let mut resolved_records = 0_usize;
    let mut staged_records = 0_usize;
    for record in &page.records {
        let canonical = record.canonical_envelope_json.as_bytes();
        if record.actor_id.is_empty()
            || record.actor_id.len() > 255
            || record.intent_epoch_id.is_empty()
            || record.intent_epoch_id.len() > 255
            || record.operation_id.is_empty()
            || record.operation_id.len() > 255
            || record.transaction_id.is_empty()
            || record.transaction_id.len() > 255
            || !is_lower_sha256(&record.transaction_digest)
            || !(1..=MAX_SAFE_INTEGER).contains(&record.intent_epoch)
            || !(1..=MAX_SAFE_INTEGER).contains(&record.actor_counter)
            || record.member_count == 0
            || record.member_count > OPERATION_TRANSACTION_MAXIMUM_MEMBERS
            || record.member_index >= record.member_count
            || canonical.is_empty()
            || canonical.len() > CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES
            || (record.state != "pending" && record.state != "published")
        {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized follower intent stage record is invalid",
            ));
        }
        let member_index = i64::try_from(record.member_index).map_err(|_| {
            NormalizedSqliteError::InvalidRequest(
                "normalized follower intent member index is invalid",
            )
        })?;
        let member_count = i64::try_from(record.member_count).map_err(|_| {
            NormalizedSqliteError::InvalidRequest(
                "normalized follower intent member count is invalid",
            )
        })?;
        let first_counter = record
            .actor_counter
            .checked_sub(member_index)
            .filter(|value| *value >= 1)
            .ok_or(NormalizedSqliteError::InvalidRequest(
                "normalized follower intent counter and member index disagree",
            ))?;
        let last_counter = first_counter
            .checked_add(member_count - 1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(NormalizedSqliteError::InvalidRequest(
                "normalized follower intent counter range is invalid",
            ))?;
        let resolved = transaction
            .query_row(
                "SELECT transaction_digest, actor_id
                 FROM library_follower_result_outbox WHERE transaction_id = ?1;",
                [&record.transaction_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((digest, actor_id)) = resolved {
            if digest != record.transaction_digest || actor_id != record.actor_id {
                return Err(NormalizedSqliteError::InvalidRequest(
                    "normalized follower intent resolved identity was reused",
                ));
            }
            resolved_records += 1;
            continue;
        }
        transaction.execute(
            "INSERT OR IGNORE INTO library_primary_intent_stage_transactions
             (transaction_id, transaction_digest, actor_id, intent_epoch,
              intent_epoch_id, member_count, first_counter, last_counter,
              received_count, canonical_member_bytes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, ?9);",
            params![
                record.transaction_id,
                record.transaction_digest,
                record.actor_id,
                record.intent_epoch,
                record.intent_epoch_id,
                member_count,
                first_counter,
                last_counter,
                received_at,
            ],
        )?;
        type StagedTransactionIdentity = (String, String, i64, String, i64, i64, i64);
        let stored: StagedTransactionIdentity = transaction.query_row(
            "SELECT transaction_digest, actor_id, intent_epoch, intent_epoch_id,
                    member_count, first_counter, last_counter
             FROM library_primary_intent_stage_transactions
             WHERE transaction_id = ?1;",
            [&record.transaction_id],
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
        )?;
        if stored
            != (
                record.transaction_digest.clone(),
                record.actor_id.clone(),
                record.intent_epoch,
                record.intent_epoch_id.clone(),
                member_count,
                first_counter,
                last_counter,
            )
        {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized follower intent transaction identity was reused",
            ));
        }
        let existing = transaction
            .query_row(
                "SELECT actor_id, actor_counter, operation_id, canonical_member
                 FROM library_primary_intent_stage_members
                 WHERE transaction_id = ?1 AND member_index = ?2;",
                params![record.transaction_id, member_index],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )
            .optional()?;
        if let Some((actor_id, actor_counter, operation_id, stored_canonical)) = existing {
            if actor_id != record.actor_id
                || actor_counter != record.actor_counter
                || operation_id != record.operation_id
                || stored_canonical != canonical
            {
                return Err(NormalizedSqliteError::InvalidRequest(
                    "normalized follower intent member identity was reused",
                ));
            }
            exact_retries += 1;
            touched_transactions.insert(record.transaction_id.clone());
            continue;
        }
        transaction.execute(
            "INSERT INTO library_primary_intent_stage_members
             (transaction_id, actor_id, member_index, actor_counter,
              operation_id, canonical_member)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            params![
                record.transaction_id,
                record.actor_id,
                member_index,
                record.actor_counter,
                record.operation_id,
                canonical,
            ],
        )?;
        let canonical_bytes = i64::try_from(canonical.len()).map_err(|_| {
            NormalizedSqliteError::InvalidRequest(
                "normalized follower intent member byte length is invalid",
            )
        })?;
        let updated = transaction.execute(
            "UPDATE library_primary_intent_stage_transactions
             SET received_count = received_count + 1,
                 canonical_member_bytes = canonical_member_bytes + ?2,
                 updated_at = ?3
             WHERE transaction_id = ?1
               AND received_count < member_count
               AND canonical_member_bytes + ?2 <= ?4;",
            params![
                record.transaction_id,
                canonical_bytes,
                received_at,
                i64::try_from(OPERATION_TRANSACTION_MAXIMUM_BYTES).map_err(|_| {
                    NormalizedSqliteError::InvalidRequest(
                        "normalized follower intent transaction byte bound is invalid",
                    )
                })?,
            ],
        )?;
        if updated != 1 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized follower intent transaction exceeds its member or byte bound",
            ));
        }
        staged_records += 1;
        touched_transactions.insert(record.transaction_id.clone());
    }
    transaction.commit()?;

    let mut resolved_transactions = 0_usize;
    let mut pending_transactions = 0_usize;
    for transaction_id in touched_transactions {
        let complete = connection
            .query_row(
                "SELECT received_count = member_count
                 FROM library_primary_intent_stage_transactions
                 WHERE transaction_id = ?1;",
                [&transaction_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if complete != Some(true) {
            pending_transactions += usize::from(complete.is_some());
            continue;
        }
        let canonical_envelopes = {
            let mut statement = connection.prepare(
                "SELECT canonical_member
                 FROM library_primary_intent_stage_members
                 WHERE transaction_id = ?1 ORDER BY member_index;",
            )?;
            let members = statement
                .query_map([&transaction_id], |row| row.get::<_, Vec<u8>>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            members
        };
        verify_staged_follower_intent_identity(connection, &transaction_id, &canonical_envelopes)?;
        resolve_normalized_operation_transaction_v1(
            connection,
            &canonical_envelopes,
            authority_key_pair,
            received_at,
        )?;
        let deleted = connection.execute(
            "DELETE FROM library_primary_intent_stage_transactions
             WHERE transaction_id = ?1;",
            [&transaction_id],
        )?;
        if deleted != 1 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized follower intent resolved staging cleanup failed",
            ));
        }
        resolved_transactions += 1;
    }
    Ok(NormalizedFollowerIntentStageReceiptV1 {
        exact_retries,
        pending_transactions,
        resolved_records,
        resolved_transactions,
        staged_records,
    })
}

fn stored_receipt(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
) -> Result<Option<NormalizedMutationReceiptV1>, NormalizedSqliteError> {
    let receipt = transaction
        .query_row(
            "SELECT txn.transaction_digest, txn.actor_id, txn.member_count, txn.first_counter,
                    txn.last_counter, txn.committed_operation_id, txn.committed_chain_digest,
                    txn.previous_revision, txn.committed_revision, txn.committed_at,
                    result.result_digest, result.result_sequence, result.canonical_result
             FROM library_transactions AS txn
             JOIN library_follower_result_outbox AS result
               ON result.transaction_id = txn.transaction_id
             WHERE txn.transaction_id = ?1;",
            [&verified.transaction_id],
            |row| {
                Ok(NormalizedMutationReceiptV1 {
                    transaction_id: verified.transaction_id.clone(),
                    transaction_digest: row.get(0)?,
                    actor_id: row.get(1)?,
                    member_count: usize::try_from(row.get::<_, i64>(2)?)
                        .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(2, 0))?,
                    first_counter: row.get(3)?,
                    last_counter: row.get(4)?,
                    committed_operation_id: row.get(5)?,
                    committed_chain_digest: row.get(6)?,
                    previous_revision: row.get(7)?,
                    committed_revision: row.get(8)?,
                    committed_at: row.get(9)?,
                    follower_result_digest: row.get(10)?,
                    follower_result_sequence: row.get(11)?,
                    canonical_follower_result: row.get(12)?,
                    invalidations: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut receipt) = receipt else {
        return Ok(None);
    };
    if receipt.transaction_digest != verified.transaction_digest
        || receipt.actor_id != verified.actor_id
        || receipt.member_count != verified.members.len()
    {
        return Err(LibraryCoreError::TransactionReplayConflict {
            transaction_id: verified.transaction_id.clone(),
        }
        .into());
    }
    receipt.invalidations = invalidations_at(transaction, receipt.committed_revision)?;
    Ok(Some(receipt))
}

fn invalidations_at(
    connection: &Connection,
    revision: i64,
) -> Result<Vec<NormalizedMutationInvalidationV1>, NormalizedSqliteError> {
    let mut statement = connection.prepare(
        "SELECT ordinal, topic, entity_id, reset_required
         FROM library_invalidations
         WHERE revision = ?1
         ORDER BY ordinal;",
    )?;
    let invalidations = statement
        .query_map([revision], |row| {
            Ok(NormalizedMutationInvalidationV1 {
                ordinal: row.get(0)?,
                topic: row.get(1)?,
                entity_id: row.get(2)?,
                reset_required: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if invalidations.len() > 256 {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized mutation invalidation count is invalid",
        ));
    }
    Ok(invalidations)
}

fn require_causal_tips(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
) -> Result<(), NormalizedSqliteError> {
    for member in &verified.members {
        for tip in &member.causal_tips {
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_operations
                   WHERE actor_id = ?1 AND actor_counter = ?2
                     AND operation_id = ?3 AND actor_chain_digest = ?4
                   UNION ALL
                   SELECT 1 FROM library_authority_frontier
                   WHERE actor_id = ?1 AND accepted_counter = ?2
                     AND accepted_operation_id = ?3 AND accepted_chain_digest = ?4
                 );",
                params![
                    tip.actor_id,
                    tip.sequence,
                    tip.operation_id,
                    tip.chain_digest
                ],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(LibraryCoreError::UnknownCausalTip {
                    operation_id: member.operation_id.clone(),
                }
                .into());
            }
        }
    }
    Ok(())
}

fn materialize_read_assignment(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    committed_at: i64,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let read_at = member
        .read_at_ms
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized read mutation payload is missing",
        ))?;
    let current_read_at: Option<i64> = transaction
        .query_row(program.current_value_sql, [&member.entity_id], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized read mutation target does not exist",
        ))?;
    let current_clock = transaction
        .query_row(program.clock_read_sql, [&member.entity_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    if current_read_at.is_some() != current_clock.is_some()
        || current_read_at
            .zip(current_clock.as_ref().map(|clock| clock.0))
            .is_some_and(|(current, clock_source_at)| current != clock_source_at)
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized read field clock is inconsistent",
        ));
    }
    let wins = current_read_at.is_none_or(|current| {
        read_at < current
            || (read_at == current
                && current_clock
                    .as_ref()
                    .map(|clock| clock.1.as_str())
                    .is_none_or(|operation| member.operation_id.as_str() < operation))
    });
    if wins {
        let updated = transaction.execute(
            program.materialize_sql,
            params![read_at, read_at, committed_at, member.entity_id],
        )?;
        if updated != 1 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized read mutation target changed",
            ));
        }
        transaction.execute(
            program.clock_write_sql,
            params![
                member.entity_id,
                verified.actor_id,
                member.actor_sequence,
                member.operation_id,
                read_at,
            ],
        )?;
    }
    Ok(())
}

fn materialize_boolean_assignment(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    committed_at: i64,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let assigned = member
        .assigned
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized assignment payload is missing",
        ))?;
    let assigned_at = member
        .assigned_at_ms
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized assignment payload is missing",
        ))?;
    let current_clock = transaction
        .query_row(program.clock_read_sql, [&member.entity_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    let wins = current_clock.as_ref().is_none_or(|clock| {
        assigned_at > clock.0
            || (assigned_at == clock.0 && member.operation_id.as_str() < clock.1.as_str())
    });
    if wins {
        let updated = transaction.execute(
            program.materialize_sql,
            params![
                i64::from(assigned),
                assigned_at,
                committed_at,
                member.entity_id,
            ],
        )?;
        if updated != 1 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized assignment target changed",
            ));
        }
        transaction.execute(
            program.clock_write_sql,
            params![
                member.entity_id,
                verified.actor_id,
                member.actor_sequence,
                member.operation_id,
                assigned_at,
            ],
        )?;
    }
    Ok(())
}

fn materialize_sync_receipt(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    committed_at: i64,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let synced_at = member
        .synced_at_ms
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized sync receipt payload is missing",
        ))?;
    let current_clock = transaction
        .query_row(program.clock_read_sql, [&member.entity_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    let wins = current_clock.as_ref().is_none_or(|clock| {
        synced_at > clock.0
            || (synced_at == clock.0 && member.operation_id.as_str() < clock.1.as_str())
    });
    if wins {
        let updated = transaction.execute(
            program.materialize_sql,
            params![synced_at, committed_at, member.entity_id],
        )?;
        if updated != 1 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized sync receipt target changed",
            ));
        }
        transaction.execute(
            program.clock_write_sql,
            params![
                member.entity_id,
                verified.actor_id,
                member.actor_sequence,
                member.operation_id,
                synced_at,
            ],
        )?;
    }
    Ok(())
}

fn materialize_text_assignment(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    committed_at: i64,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let payload: Value = serde_json::from_str(member.rss_feed_json.as_deref().ok_or(
        NormalizedSqliteError::InvalidRequest("normalized text assignment payload is missing"),
    )?)
    .map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized text assignment payload is invalid")
    })?;
    let title = payload.get("title").and_then(Value::as_str).ok_or(
        NormalizedSqliteError::InvalidRequest("normalized text assignment payload is invalid"),
    )?;
    let assigned_at = payload
        .get("assigned_at_ms")
        .and_then(Value::as_i64)
        .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized text assignment payload is invalid",
        ))?;
    let current_clock = transaction
        .query_row(program.clock_read_sql, [&member.entity_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    let wins = current_clock.as_ref().is_none_or(|clock| {
        assigned_at > clock.0
            || (assigned_at == clock.0 && member.operation_id.as_str() < clock.1.as_str())
    });
    if wins {
        let updated = transaction.execute(
            program.materialize_sql,
            params![title, committed_at, member.entity_id],
        )?;
        if updated != 1 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized text assignment target changed",
            ));
        }
        transaction.execute(
            program.clock_write_sql,
            params![
                member.entity_id,
                verified.actor_id,
                member.actor_sequence,
                member.operation_id,
                assigned_at,
            ],
        )?;
    }
    Ok(())
}

fn materialize_nullable_text_assignment(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    committed_at: i64,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let payload: Value = serde_json::from_str(member.account_json.as_deref().ok_or(
        NormalizedSqliteError::InvalidRequest(
            "normalized nullable text assignment payload is missing",
        ),
    )?)
    .map_err(|_| {
        NormalizedSqliteError::InvalidRequest(
            "normalized nullable text assignment payload is invalid",
        )
    })?;
    let person_id = match payload.get("person_id") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.as_str()),
        _ => {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized nullable text assignment payload is invalid",
            ));
        }
    };
    let assigned_at = payload
        .get("assigned_at_ms")
        .and_then(Value::as_i64)
        .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized nullable text assignment payload is invalid",
        ))?;
    let current_clock = transaction
        .query_row(program.clock_read_sql, [&member.entity_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    let wins = current_clock.as_ref().is_none_or(|clock| {
        assigned_at > clock.0
            || (assigned_at == clock.0 && member.operation_id.as_str() < clock.1.as_str())
    });
    if wins {
        let updated = transaction.execute(
            program.materialize_sql,
            params![person_id, committed_at, member.entity_id],
        )?;
        if updated != 1 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized nullable text assignment target changed",
            ));
        }
        transaction.execute(
            program.clock_write_sql,
            params![
                member.entity_id,
                verified.actor_id,
                member.actor_sequence,
                member.operation_id,
                assigned_at,
            ],
        )?;
    }
    Ok(())
}

fn materialize_remove(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let removed_at = member
        .removed_at_ms
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized removal payload is missing",
        ))?;
    let current_clock = transaction
        .query_row(program.clock_read_sql, [&member.entity_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    let wins = current_clock.as_ref().is_none_or(|clock| {
        removed_at > clock.0
            || (removed_at == clock.0 && member.operation_id.as_str() < clock.1.as_str())
    });
    if wins {
        for sql in program.dependent_delete_sql {
            transaction.execute(sql, [&member.entity_id])?;
        }
        transaction.execute(program.materialize_sql, [&member.entity_id])?;
        transaction.execute(
            program.clock_write_sql,
            params![
                member.entity_id,
                verified.actor_id,
                member.actor_sequence,
                member.operation_id,
                removed_at,
            ],
        )?;
    }
    Ok(())
}

fn materialize_person_reach_out_append(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let payload: Value = serde_json::from_str(member.person_json.as_deref().ok_or(
        NormalizedSqliteError::InvalidRequest("normalized Person reach-out payload is missing"),
    )?)
    .map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized Person reach-out payload is invalid")
    })?;
    let logged_at = payload
        .get("logged_at_ms")
        .and_then(Value::as_i64)
        .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized Person reach-out payload is invalid",
        ))?;
    let channel = match payload.get("channel") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.as_str()),
        _ => {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized Person reach-out payload is invalid",
            ));
        }
    };
    let notes = match payload.get("notes") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.as_str()),
        _ => {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized Person reach-out payload is invalid",
            ));
        }
    };
    transaction.execute(
        program.materialize_sql,
        params![
            member.entity_id,
            member.operation_id,
            logged_at,
            channel,
            notes
        ],
    )?;
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, [&member.entity_id])?;
    }
    Ok(())
}

fn materialize_friend_replace(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    let member = &verified.members[member_index];
    let payload_json =
        member
            .person_json
            .as_deref()
            .ok_or(NormalizedSqliteError::InvalidRequest(
                "normalized Friend payload is missing",
            ))?;
    let payload: Value = serde_json::from_str(payload_json).map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized Friend payload is invalid")
    })?;
    let person = payload
        .get("person")
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized Friend Person payload is missing",
        ))?;
    let accounts = payload.get("accounts").and_then(Value::as_array).ok_or(
        NormalizedSqliteError::InvalidRequest("normalized Friend Account payload is missing"),
    )?;
    let person_json = serde_json::to_string(person).map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized Friend Person payload is invalid")
    })?;
    let changed = transaction.execute(
        program.materialize_sql,
        params![member.entity_id, payload_json],
    )?;
    if changed == 0 {
        return Ok(());
    }

    let person_program = SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|candidate| candidate.mutation_id == "person_upsert")
        .copied()
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized Person materializer is not registered",
        ))?;
    for sql in person_program.dependent_delete_sql {
        transaction.execute(sql, [&member.entity_id])?;
    }
    for sql in person_program.dependent_insert_sql {
        transaction.execute(sql, params![member.entity_id, person_json])?;
    }
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, params![member.entity_id, payload_json])?;
    }

    let account_program = SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|candidate| candidate.mutation_id == "account_upsert")
        .copied()
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized Account materializer is not registered",
        ))?;
    for account in accounts {
        let account_id = account.get("id").and_then(Value::as_str).ok_or(
            NormalizedSqliteError::InvalidRequest("normalized Friend Account identity is invalid"),
        )?;
        let account_json = serde_json::to_string(account).map_err(|_| {
            NormalizedSqliteError::InvalidRequest("normalized Friend Account payload is invalid")
        })?;
        let account_changed = transaction.execute(
            account_program.materialize_sql,
            params![account_id, account_json],
        )?;
        if account_changed == 0 {
            continue;
        }
        for sql in account_program.dependent_delete_sql {
            transaction.execute(sql, [account_id])?;
        }
        for sql in account_program.dependent_insert_sql {
            transaction.execute(sql, params![account_id, account_json])?;
        }
    }
    Ok(())
}

fn materialize_member(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    member_index: usize,
    committed_at: i64,
    program: SqliteMutationProgram,
) -> Result<(), NormalizedSqliteError> {
    match program.payload_kind {
        "read_at" => {
            materialize_read_assignment(transaction, verified, member_index, committed_at, program)
        }
        "boolean_assignment" => materialize_boolean_assignment(
            transaction,
            verified,
            member_index,
            committed_at,
            program,
        ),
        "sync_receipt" => {
            materialize_sync_receipt(transaction, verified, member_index, committed_at, program)
        }
        "text_assignment" => {
            materialize_text_assignment(transaction, verified, member_index, committed_at, program)
        }
        "nullable_text_assignment" => materialize_nullable_text_assignment(
            transaction,
            verified,
            member_index,
            committed_at,
            program,
        ),
        "person_reach_out_append" => {
            materialize_person_reach_out_append(transaction, verified, member_index, program)
        }
        "friend_replace" => {
            materialize_friend_replace(transaction, verified, member_index, program)
        }
        "remove" => materialize_remove(transaction, verified, member_index, program),
        "account_upsert" => {
            let member = &verified.members[member_index];
            let account =
                member
                    .account_json
                    .as_deref()
                    .ok_or(NormalizedSqliteError::InvalidRequest(
                        "normalized Account payload is missing",
                    ))?;
            let changed =
                transaction.execute(program.materialize_sql, params![member.entity_id, account])?;
            if changed != 0 {
                for sql in program.dependent_delete_sql {
                    transaction.execute(sql, [&member.entity_id])?;
                }
                for sql in program.dependent_insert_sql {
                    transaction.execute(sql, params![member.entity_id, account])?;
                }
            }
            Ok(())
        }
        "feed_item_capture_upsert" => {
            let member = &verified.members[member_index];
            let item = member
                .item_json
                .as_deref()
                .ok_or(NormalizedSqliteError::InvalidRequest(
                    "normalized FeedItem capture payload is missing",
                ))?;
            let changed = transaction.execute(
                program.materialize_sql,
                params![member.entity_id, item, committed_at],
            )?;
            if changed != 0 {
                for sql in program.dependent_delete_sql {
                    transaction.execute(sql, [&member.entity_id])?;
                }
                for sql in program.dependent_insert_sql {
                    transaction.execute(sql, params![member.entity_id, item])?;
                }
            }
            Ok(())
        }
        "person_upsert" => {
            let member = &verified.members[member_index];
            let person =
                member
                    .person_json
                    .as_deref()
                    .ok_or(NormalizedSqliteError::InvalidRequest(
                        "normalized Person payload is missing",
                    ))?;
            let changed =
                transaction.execute(program.materialize_sql, params![member.entity_id, person])?;
            if changed != 0 {
                for sql in program.dependent_delete_sql {
                    transaction.execute(sql, [&member.entity_id])?;
                }
                for sql in program.dependent_insert_sql {
                    transaction.execute(sql, params![member.entity_id, person])?;
                }
            }
            Ok(())
        }
        "preferences_leaf_assignment" => {
            let member = &verified.members[member_index];
            let patch = member.preferences_patch_json.as_deref().ok_or(
                NormalizedSqliteError::InvalidRequest("normalized preference patch is missing"),
            )?;
            let (node_count, maximum_path_bytes, maximum_text_bytes): (i64, i64, i64) = transaction
                .query_row(
                    "SELECT count(*),
                            coalesce(max(length(CAST(fullkey AS BLOB)) + 2), 0),
                            coalesce(max(CASE WHEN type = 'text'
                                              THEN length(CAST(atom AS BLOB))
                                              ELSE 0 END), 0)
                     FROM json_tree(?1) WHERE fullkey <> '$';",
                    [patch],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
            if !(1..=512).contains(&node_count)
                || maximum_path_bytes > 4_096
                || maximum_text_bytes > 8_192
            {
                return Err(NormalizedSqliteError::InvalidRequest(
                    "normalized preference patch exceeds node bounds",
                ));
            }
            for sql in program.dependent_delete_sql {
                transaction.execute(sql, [patch])?;
            }
            transaction.execute(program.materialize_sql, params![patch, committed_at])?;
            Ok(())
        }
        "rss_feed_upsert" => {
            let member = &verified.members[member_index];
            let feed =
                member
                    .rss_feed_json
                    .as_deref()
                    .ok_or(NormalizedSqliteError::InvalidRequest(
                        "normalized RSS feed payload is missing",
                    ))?;
            transaction.execute(
                program.materialize_sql,
                params![member.entity_id, feed, committed_at],
            )?;
            Ok(())
        }
        _ => Err(NormalizedSqliteError::InvalidRequest(
            "normalized mutation payload kind is not registered",
        )),
    }
}

fn persist_rejected_resolution(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
    authority_key_pair: &Ed25519KeyPair,
    resolved_at: i64,
    reason: &'static str,
) -> Result<NormalizedFollowerResultReceiptV1, NormalizedSqliteError> {
    let source_revision: i64 = transaction.query_row(
        "SELECT revision FROM library_change_state WHERE singleton_id = 1;",
        [],
        |row| row.get(0),
    )?;
    let (sequence, digest, canonical) = persist_follower_result_outcome(
        transaction,
        verified,
        authority_key_pair,
        source_revision,
        resolved_at,
        FollowerResultOutcome::Rejected { reason },
    )?;
    Ok(NormalizedFollowerResultReceiptV1 {
        transaction_id: verified.transaction_id.clone(),
        transaction_digest: verified.transaction_digest.clone(),
        actor_id: verified.actor_id.clone(),
        status: "rejected",
        follower_result_digest: digest,
        follower_result_sequence: sequence,
        canonical_follower_result: canonical,
    })
}

/// Read the exact Primary actor and causal frontier used to assemble the next
/// normalized transaction. The context is available only while this process is
/// the admitted writer for the active authority epoch.
pub fn normalized_primary_mutation_context_v1(
    connection: &Connection,
) -> Result<NormalizedMutationContextV1, NormalizedSqliteError> {
    type ContextRow = (
        String,
        i64,
        String,
        String,
        String,
        i64,
        Option<String>,
        String,
    );
    let mut statement = connection.prepare(
        "SELECT epoch.library_id, epoch.epoch_number, epoch.epoch_id,
                actor.actor_id, actor.public_key, actor.accepted_counter,
                actor.accepted_operation_id, actor.accepted_chain_digest
         FROM library_writer_admission AS admission
         JOIN library_active_authority AS active ON active.active_key = 'active'
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         JOIN library_actors AS actor ON actor.authority_epoch_id = epoch.epoch_id
         WHERE admission.singleton_id = 1
           AND admission.local_writer_id = admission.active_writer_id
           AND admission.active_writer_id = active.writer_id
           AND admission.observed_manifest_generation = active.accepted_manifest_generation
           AND actor.actor_kind = 'desktop'
           AND actor.retired_at IS NULL
         ORDER BY actor.actor_id
         LIMIT 2;",
    )?;
    let rows = statement
        .query_map([], |row| {
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
        })?
        .collect::<rusqlite::Result<Vec<ContextRow>>>()?;
    let [row] = rows.as_slice() else {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized Primary mutation context is unavailable",
        ));
    };
    let next_counter = row
        .5
        .checked_add(1)
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized Primary actor counter is exhausted",
        ))?;
    let mut frontier_statement = connection.prepare(
        "SELECT actor_id, accepted_counter, accepted_operation_id, accepted_chain_digest
         FROM library_authority_frontier
         WHERE epoch_id = ?1
         ORDER BY ordinal;",
    )?;
    let observed_frontier = frontier_statement
        .query_map([&row.2], |frontier| {
            Ok(NormalizedMutationCausalTipV1 {
                actor_id: frontier.get(0)?,
                sequence: frontier.get(1)?,
                operation_id: frontier.get(2)?,
                chain_digest: frontier.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(NormalizedMutationContextV1 {
        library_id: row.0.clone(),
        epoch: row.1,
        epoch_id: row.2.clone(),
        actor_id: row.3.clone(),
        actor_public_key: row.4.clone(),
        next_counter,
        previous_operation_id: row.6.clone(),
        previous_chain_digest: row.7.clone(),
        observed_frontier,
    })
}

pub(crate) fn resolve_normalized_operation_transaction_v1(
    connection: &mut Connection,
    canonical_envelopes: &[Vec<u8>],
    authority_key_pair: &Ed25519KeyPair,
    committed_at: i64,
) -> Result<NormalizedMutationResolutionV1, NormalizedSqliteError> {
    if !(0..=MAX_SAFE_INTEGER).contains(&committed_at) {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized mutation commit time is invalid",
        ));
    }
    let (verified, _initial_verdict) =
        verify_operation_transaction_for_resolution(canonical_envelopes, |identity| {
            actor_state_at(connection, identity)
        })?;
    validate_transaction(&verified)?;
    let program = SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|program| program.mutation_id == verified.members[0].operation_type)
        .copied()
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized mutation materializer is not registered",
        ))?;
    if verified.members.len() > program.maximum_members
        || verified.members.iter().any(|member| {
            member.operation_type != program.mutation_id
                || member.entity_type != program.entity_type
        })
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized mutation materializer is not registered",
        ));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (active_epoch, active_epoch_id) =
        admitted_authority_epoch(&transaction, &verified.library_id)?;
    let actor = actor_state_at(
        &transaction,
        &OperationIdentity {
            library_id: verified.library_id.clone(),
            epoch_id: verified.epoch_id.clone(),
            actor_id: verified.actor_id.clone(),
        },
    )?;
    if actor.capability != verified.actor_capability {
        return Err(LibraryCoreError::InvalidVerifiedInput {
            field: "actor_capability_changed",
        }
        .into());
    }
    if let Some(receipt) = stored_receipt(&transaction, &verified)? {
        transaction.commit()?;
        return Ok(NormalizedMutationResolutionV1::Accepted(receipt));
    }
    if active_epoch != verified.epoch || active_epoch_id != verified.epoch_id {
        if active_epoch <= verified.epoch || active_epoch_id == verified.epoch_id {
            return Err(LibraryCoreError::StaleAuthority {
                library_id: verified.library_id,
            }
            .into());
        }
        let receipt = persist_rejected_resolution(
            &transaction,
            &verified,
            authority_key_pair,
            committed_at,
            "epoch_stale",
        )?;
        transaction.commit()?;
        return Ok(NormalizedMutationResolutionV1::FollowerResult(receipt));
    }
    let current_verdict = operation_admission_verdict(&actor, &verified);
    let rejection_reason = match current_verdict {
        OperationAdmissionVerdict::Admissible => None,
        OperationAdmissionVerdict::ActorRetired => Some("actor_retired"),
        OperationAdmissionVerdict::CapabilityDenied { .. } => Some("capability_denied"),
    };
    if let Some(reason) = rejection_reason {
        let receipt = persist_rejected_resolution(
            &transaction,
            &verified,
            authority_key_pair,
            committed_at,
            reason,
        )?;
        transaction.commit()?;
        return Ok(NormalizedMutationResolutionV1::FollowerResult(receipt));
    }
    let first = &verified.members[0];
    let last = verified
        .members
        .last()
        .expect("verified members are nonempty");
    if actor.next_sequence != first.actor_sequence
        || actor.previous_operation_id != first.previous_actor_operation_id
        || actor.previous_chain_digest != first.previous_actor_chain_digest
    {
        let receipt = persist_rejected_resolution(
            &transaction,
            &verified,
            authority_key_pair,
            committed_at,
            "precondition_failed",
        )?;
        transaction.commit()?;
        return Ok(NormalizedMutationResolutionV1::FollowerResult(receipt));
    }
    require_causal_tips(&transaction, &verified)?;
    for member in &verified.members {
        if !program.requires_existing_target {
            continue;
        }
        let exists: bool =
            transaction.query_row(program.target_exists_sql, [&member.entity_id], |row| {
                row.get(0)
            })?;
        if !exists {
            let tombstoned: bool = transaction.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_tombstones
                   WHERE entity_type = ?1 AND entity_id = ?2
                 );",
                params![program.invalidation_topic, member.entity_id],
                |row| row.get(0),
            )?;
            let reason = if tombstoned {
                "target_tombstoned"
            } else {
                "target_missing"
            };
            let receipt = persist_rejected_resolution(
                &transaction,
                &verified,
                authority_key_pair,
                committed_at,
                reason,
            )?;
            transaction.commit()?;
            return Ok(NormalizedMutationResolutionV1::FollowerResult(receipt));
        }
    }
    let previous_revision: i64 = transaction.query_row(
        "SELECT revision FROM library_change_state WHERE singleton_id = 1;",
        [],
        |row| row.get(0),
    )?;
    let committed_revision = previous_revision
        .checked_add(1)
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized mutation revision is exhausted",
        ))?;
    transaction.execute(
        "INSERT INTO library_transactions
         (transaction_id, transaction_digest, library_id, authority_epoch,
          actor_id, member_count, first_counter, last_counter,
          previous_operation_id, previous_chain_digest,
          committed_operation_id, committed_chain_digest,
          canonical_member_bytes, previous_revision, committed_revision, committed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16);",
        params![
            verified.transaction_id,
            verified.transaction_digest,
            verified.library_id,
            verified.epoch_id,
            verified.actor_id,
            i64::try_from(verified.members.len()).expect("bounded members"),
            first.actor_sequence,
            last.actor_sequence,
            first.previous_actor_operation_id,
            first.previous_actor_chain_digest,
            last.operation_id,
            last.actor_chain_digest,
            i64::try_from(verified.canonical_envelope_bytes).expect("bounded bytes"),
            previous_revision,
            committed_revision,
            committed_at,
        ],
    )?;
    for (member_index, member) in verified.members.iter().enumerate() {
        transaction.execute(
            "INSERT INTO library_operations
             (operation_id, transaction_id, member_index, member_count,
              actor_id, actor_counter, previous_actor_operation_id,
              previous_actor_chain_digest, actor_chain_digest, member_digest,
              envelope_digest, mutation_id, entity_type, entity_id,
              canonical_envelope, committed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16);",
            params![
                member.operation_id,
                verified.transaction_id,
                i64::try_from(member_index).expect("bounded member index"),
                i64::try_from(verified.members.len()).expect("bounded members"),
                verified.actor_id,
                member.actor_sequence,
                member.previous_actor_operation_id,
                member.previous_actor_chain_digest,
                member.actor_chain_digest,
                member.member_digest,
                member.envelope_digest,
                member.operation_type,
                member.entity_type,
                member.entity_id,
                member.canonical_envelope_json.as_bytes(),
                committed_at,
            ],
        )?;
        for (tip_index, tip) in member.causal_tips.iter().enumerate() {
            transaction.execute(
                "INSERT INTO library_operation_causal_tips
                 (operation_id, tip_index, actor_id, actor_counter,
                  tip_operation_id, chain_digest)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
                params![
                    member.operation_id,
                    i64::try_from(tip_index).expect("bounded tip index"),
                    tip.actor_id,
                    tip.sequence,
                    tip.operation_id,
                    tip.chain_digest,
                ],
            )?;
        }
        materialize_member(&transaction, &verified, member_index, committed_at, program)?;
        transaction.execute(
            "INSERT INTO library_replication_outbox
             (operation_id, actor_id, actor_counter, enqueued_at)
             VALUES (?1, ?2, ?3, ?4);",
            params![
                member.operation_id,
                verified.actor_id,
                member.actor_sequence,
                committed_at,
            ],
        )?;
        let result_text = format!(
            "{{\"committedRevision\":{committed_revision},\"operationId\":{}}}",
            serde_json::to_string(&member.operation_id).expect("operation ID serializes")
        );
        transaction.execute(
            "INSERT INTO library_receipts
             (actor_id, operation_id, status, digest, result_text, accepted_at)
             VALUES (?1, ?2, 'accepted', ?3, ?4, ?5);",
            params![
                verified.actor_id,
                member.operation_id,
                member.envelope_digest,
                result_text,
                committed_at,
            ],
        )?;
        transaction.execute(
            "INSERT INTO library_invalidations
             (revision, ordinal, topic, entity_id, reset_required)
             VALUES (?1, ?2, ?3, ?4, 0);",
            params![
                committed_revision,
                i64::try_from(member_index).expect("bounded invalidation index"),
                program.invalidation_topic,
                member.entity_id,
            ],
        )?;
        if member.operation_type == "friend_replace" {
            transaction.execute(
                "INSERT INTO library_invalidations
                 (revision, ordinal, topic, entity_id, reset_required)
                 VALUES (?1, ?2, 'account', NULL, 1);",
                params![
                    committed_revision,
                    i64::try_from(verified.members.len() + member_index)
                        .expect("bounded Friend invalidation index"),
                ],
            )?;
        }
    }
    let actor_updated = transaction.execute(
        "UPDATE library_actors
         SET accepted_counter = ?1, accepted_operation_id = ?2,
             accepted_chain_digest = ?3, updated_at = ?4
         WHERE actor_id = ?5 AND authority_epoch_id = ?6
           AND accepted_counter = ?7
           AND accepted_operation_id IS ?8
           AND accepted_chain_digest = ?9;",
        params![
            last.actor_sequence,
            last.operation_id,
            last.actor_chain_digest,
            committed_at,
            verified.actor_id,
            verified.epoch_id,
            actor.next_sequence - 1,
            actor.previous_operation_id,
            actor.previous_chain_digest,
        ],
    )?;
    if actor_updated != 1 {
        return Err(LibraryCoreError::StaleActorTip {
            actor_id: verified.actor_id.clone(),
        }
        .into());
    }
    let revision_updated = transaction.execute(
        "UPDATE library_change_state SET revision = ?1
         WHERE singleton_id = 1 AND revision = ?2;",
        params![committed_revision, previous_revision],
    )?;
    let meta_updated = transaction.execute(
        "UPDATE library_meta SET source_revision = ?1, updated_at = ?2
         WHERE singleton_id = 1 AND source_revision = ?3;",
        params![committed_revision, committed_at, previous_revision],
    )?;
    if revision_updated != 1 || meta_updated != 1 {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized mutation revision changed concurrently",
        ));
    }
    let (follower_result_sequence, follower_result_digest, canonical_follower_result) =
        persist_follower_result_outcome(
            &transaction,
            &verified,
            authority_key_pair,
            committed_revision,
            committed_at,
            FollowerResultOutcome::Accepted,
        )?;
    let receipt = NormalizedMutationReceiptV1 {
        transaction_id: verified.transaction_id,
        transaction_digest: verified.transaction_digest,
        actor_id: verified.actor_id,
        member_count: verified.members.len(),
        first_counter: first.actor_sequence,
        last_counter: last.actor_sequence,
        committed_operation_id: last.operation_id.clone(),
        committed_chain_digest: last.actor_chain_digest.clone(),
        previous_revision,
        committed_revision,
        committed_at,
        follower_result_digest,
        follower_result_sequence,
        canonical_follower_result,
        invalidations: invalidations_at(&transaction, committed_revision)?,
    };
    transaction.commit()?;
    Ok(NormalizedMutationResolutionV1::Accepted(receipt))
}

pub fn accept_normalized_operation_transaction_v1(
    connection: &mut Connection,
    canonical_envelopes: &[Vec<u8>],
    authority_key_pair: &Ed25519KeyPair,
    committed_at: i64,
) -> Result<NormalizedMutationReceiptV1, NormalizedSqliteError> {
    match resolve_normalized_operation_transaction_v1(
        connection,
        canonical_envelopes,
        authority_key_pair,
        committed_at,
    )? {
        NormalizedMutationResolutionV1::Accepted(receipt) => Ok(receipt),
        NormalizedMutationResolutionV1::FollowerResult(_) => Err(
            NormalizedSqliteError::InvalidRequest("normalized mutation was rejected"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_actor_capability::primary_writer_operation_types;
    use crate::library_core_journal::operation_tests::tests::{
        enrollment, signed_envelopes, signed_envelopes_from_tip,
        signed_envelopes_from_tip_with_payload,
    };
    use crate::normalized_sqlite::install_normalized_schema_v1;
    use ring::signature::Ed25519KeyPair;

    type FeedState = (
        i64,
        Option<i64>,
        i64,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
    );

    fn fixture() -> (
        Connection,
        Ed25519KeyPair,
        crate::normalized_operation::VerifiedActorEnrollment,
    ) {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[19_u8; 32]).expect("actor key");
        let enrollment = enrollment(&key_pair);
        let authority_public_key = lower_hex(key_pair.public_key().as_ref());
        let authority_key_id = follower_result_digest(
            "authority-key",
            &json!({
                "authority_public_key": authority_public_key,
                "signature_algorithm": "ed25519",
            }),
        )
        .expect("authority key ID");
        let connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch,
                  source_revision, updated_at)
                 VALUES (1, ?1, 1, ?2, 0, 1000);",
                params![enrollment.library_id, enrollment.epoch_id],
            )
            .expect("meta");
        connection
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', 0, ?7, ?8, 1000);",
                params![
                    enrollment.epoch_id,
                    enrollment.library_id,
                    enrollment.epoch,
                    authority_key_id,
                    authority_public_key,
                    "8".repeat(64),
                    "9".repeat(64),
                    "a".repeat(64),
                ],
            )
            .expect("authority");
        connection
            .execute(
                "INSERT INTO library_active_authority
                 (active_key, library_id, epoch_id, writer_id,
                  accepted_manifest_generation, activated_at)
                 VALUES ('active', ?1, ?2, 'writer-1', 0, 1000);",
                params![enrollment.library_id, enrollment.epoch_id],
            )
            .expect("active authority");
        connection
            .execute(
                "INSERT INTO library_writer_admission
                 (singleton_id, local_writer_id, active_writer_id,
                  observed_manifest_generation, observed_at)
                 VALUES (1, 'writer-1', 'writer-1', 0, 1000);",
                [],
            )
            .expect("writer admission");
        connection
            .execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  created_at, updated_at)
                 VALUES (?1, ?2, 'desktop', ?3, ?4, ?5, ?6, ?7,
                         0, NULL, ?7, 1000, 1000);",
                params![
                    enrollment.actor_id,
                    enrollment.epoch_id,
                    enrollment.actor_public_key,
                    enrollment.enrollment_operation_id,
                    enrollment.enrollment_certificate_digest,
                    enrollment.canonical_enrollment_certificate_json,
                    enrollment.actor_chain_genesis,
                ],
            )
            .expect("actor");
        connection
            .execute(
                "INSERT INTO library_actor_capabilities
                 (capability_id, actor_id, certificate_version, actor_class,
                  scope_mode, issuance_identity, retirement_identity,
                  certificate_digest, canonical_certificate, issued_at)
                 VALUES (?1, ?2, 2, 'editor', 'library_wide', ?3, ?4, ?1, '{}', 1000);",
                params![
                    enrollment.enrollment_certificate_digest,
                    enrollment.actor_id,
                    "b".repeat(64),
                    "c".repeat(64),
                ],
            )
            .expect("capability");
        for operation in primary_writer_operation_types() {
            connection
                .execute(
                    "INSERT INTO library_actor_capability_mutations
                     (capability_id, mutation_id) VALUES (?1, ?2);",
                    params![enrollment.enrollment_certificate_digest, operation],
                )
                .expect("capability mutation");
        }
        connection
            .execute_batch(
                "INSERT INTO library_feed_items
                 (global_id, platform, content_type, captured_at, published_at,
                  author_id, author_handle, author_display_name,
                  hidden, saved, archived, updated_at)
                 VALUES
                   ('rss:item:1', 'rss', 'article', 800, 700, 'author-1', 'ada', 'Ada', 0, 0, 0, 800),
                   ('rss:item:2', 'rss', 'article', 801, 701, 'author-1', 'ada', 'Ada', 0, 0, 0, 801);",
            )
            .expect("items");
        (connection, key_pair, enrollment)
    }

    fn stage_records(envelopes: &[Vec<u8>]) -> Vec<NormalizedFollowerIntentStageRecordV1> {
        envelopes
            .iter()
            .map(|bytes| {
                let envelope: Value = serde_json::from_slice(bytes).expect("signed envelope JSON");
                NormalizedFollowerIntentStageRecordV1 {
                    actor_counter: envelope["actor_sequence"].as_i64().expect("actor sequence"),
                    actor_id: envelope["actor_id"].as_str().expect("actor ID").to_owned(),
                    canonical_envelope_json: String::from_utf8(bytes.clone())
                        .expect("canonical UTF-8"),
                    intent_epoch: envelope["epoch"].as_i64().expect("intent epoch"),
                    intent_epoch_id: envelope["epoch_id"]
                        .as_str()
                        .expect("intent epoch ID")
                        .to_owned(),
                    member_count: envelope["transaction_member_count"]
                        .as_u64()
                        .and_then(|value| usize::try_from(value).ok())
                        .expect("member count"),
                    member_index: envelope["transaction_member_index"]
                        .as_u64()
                        .and_then(|value| usize::try_from(value).ok())
                        .expect("member index"),
                    operation_id: envelope["operation_id"]
                        .as_str()
                        .expect("operation ID")
                        .to_owned(),
                    state: "pending".into(),
                    transaction_digest: envelope["transaction_digest"]
                        .as_str()
                        .expect("transaction digest")
                        .to_owned(),
                    transaction_id: envelope["transaction_id"]
                        .as_str()
                        .expect("transaction ID")
                        .to_owned(),
                }
            })
            .collect()
    }

    #[test]
    fn primary_context_tracks_the_exact_normalized_actor_tip() {
        let (mut connection, key_pair, enrollment) = fixture();
        let initial =
            normalized_primary_mutation_context_v1(&connection).expect("initial Primary context");
        assert_eq!(initial.library_id, enrollment.library_id);
        assert_eq!(initial.epoch, enrollment.epoch);
        assert_eq!(initial.epoch_id, enrollment.epoch_id);
        assert_eq!(initial.actor_id, enrollment.actor_id);
        assert_eq!(initial.actor_public_key, enrollment.actor_public_key);
        assert_eq!(initial.next_counter, 1);
        assert_eq!(initial.previous_operation_id, None);
        assert_eq!(
            initial.previous_chain_digest,
            enrollment.actor_chain_genesis
        );
        assert!(initial.observed_frontier.is_empty());

        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let receipt = accept_normalized_operation_transaction_v1(
            &mut connection,
            &envelopes,
            &key_pair,
            2_000,
        )
        .expect("accepted normalized transaction");
        let advanced =
            normalized_primary_mutation_context_v1(&connection).expect("advanced Primary context");
        assert_eq!(advanced.next_counter, receipt.last_counter + 1);
        assert_eq!(
            advanced.previous_operation_id.as_deref(),
            Some(receipt.committed_operation_id.as_str())
        );
        assert_eq!(
            advanced.previous_chain_digest,
            receipt.committed_chain_digest
        );
        assert!(advanced.observed_frontier.is_empty());
    }

    #[test]
    fn follower_intent_pages_stage_exact_members_then_resolve_only_when_complete() {
        let (mut connection, key_pair, enrollment) = fixture();
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let records = stage_records(&envelopes);
        let initial_transport =
            normalized_primary_follower_actor_transport_state_v1(&connection, &enrollment.actor_id)
                .expect("initial follower transport frontier");
        assert_eq!(initial_transport.library_id, enrollment.library_id);
        assert_eq!(initial_transport.storage_epoch_id, enrollment.epoch_id);
        assert_eq!(initial_transport.next_actor_counter, 1);
        let first = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 {
                records: vec![records[0].clone()],
            },
            &key_pair,
            2_000,
        )
        .expect("stage first member");
        assert_eq!(
            first,
            NormalizedFollowerIntentStageReceiptV1 {
                exact_retries: 0,
                pending_transactions: 1,
                resolved_records: 0,
                resolved_transactions: 0,
                staged_records: 1,
            }
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .expect("no early authority transaction"),
            0
        );
        assert_eq!(
            normalized_primary_follower_actor_transport_state_v1(
                &connection,
                &enrollment.actor_id,
            )
            .expect("staged follower transport frontier")
            .next_actor_counter,
            records[0].actor_counter + 1,
            "a response-loss retry resumes after the exact staged member",
        );
        let retry = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 {
                records: vec![records[0].clone()],
            },
            &key_pair,
            2_001,
        )
        .expect("retry first member");
        assert_eq!(retry.exact_retries, 1);
        assert_eq!(retry.pending_transactions, 1);

        let mut changed = records[0].clone();
        changed.canonical_envelope_json.push(' ');
        let error = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 {
                records: vec![changed],
            },
            &key_pair,
            2_002,
        )
        .expect_err("changed member identity");
        assert!(error.to_string().contains("member identity was reused"));

        let completed = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 {
                records: vec![records[1].clone()],
            },
            &key_pair,
            2_003,
        )
        .expect("complete and resolve transaction");
        assert_eq!(completed.staged_records, 1);
        assert_eq!(completed.resolved_transactions, 1);
        assert_eq!(completed.pending_transactions, 0);
        assert_eq!(
            normalized_primary_follower_actor_transport_state_v1(
                &connection,
                &enrollment.actor_id,
            )
            .expect("committed follower transport frontier")
            .next_actor_counter,
            records[1].actor_counter + 1,
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .expect("one authority transaction"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_primary_intent_stage_transactions;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("staging cleanup"),
            0
        );
        let replay = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 { records },
            &key_pair,
            2_004,
        )
        .expect("resolved response-loss replay");
        assert_eq!(replay.resolved_records, 2);
        assert_eq!(replay.staged_records, 0);
        assert_eq!(replay.resolved_transactions, 0);
    }

    #[test]
    fn follower_intent_staging_rejects_typed_aliases_before_authority_admission() {
        let (mut connection, key_pair, enrollment) = fixture();
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let mut records = stage_records(&envelopes);
        records[1].operation_id = "typed-operation-alias".into();
        let error = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 { records },
            &key_pair,
            2_000,
        )
        .expect_err("typed identity alias");
        assert!(error
            .to_string()
            .contains("typed member identity disagrees with signed bytes"));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .expect("no aliased authority transaction"),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .expect("unchanged authority revision"),
            0
        );
    }

    #[test]
    fn complete_follower_intent_staging_survives_a_late_authority_fault() {
        let (mut connection, key_pair, enrollment) = fixture();
        let records = stage_records(&signed_envelopes(&key_pair, &enrollment));
        connection
            .execute_batch(
                "CREATE TRIGGER fail_staged_authority_operation
                 BEFORE INSERT ON library_operations
                 BEGIN SELECT RAISE(ABORT, 'injected staged authority fault'); END;",
            )
            .expect("fault trigger");
        let error = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 {
                records: records.clone(),
            },
            &key_pair,
            2_000,
        )
        .expect_err("late authority fault");
        assert!(error
            .to_string()
            .contains("injected staged authority fault"));
        assert_eq!(
            connection
                .query_row(
                    "SELECT received_count, member_count
                     FROM library_primary_intent_stage_transactions;",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .expect("complete staged transaction"),
            (2, 2)
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .expect("rolled back authority transaction"),
            0
        );
        connection
            .execute_batch("DROP TRIGGER fail_staged_authority_operation;")
            .expect("remove fault trigger");
        let resumed = ingest_normalized_follower_intent_page_v1(
            &mut connection,
            &NormalizedFollowerIntentStagePageV1 { records },
            &key_pair,
            2_001,
        )
        .expect("resume complete transaction");
        assert_eq!(resumed.exact_retries, 2);
        assert_eq!(resumed.resolved_transactions, 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_primary_intent_stage_transactions;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("resumed staging cleanup"),
            0
        );
    }

    #[test]
    fn signed_read_transaction_commits_every_normalized_effect_and_exact_retry() {
        let (mut connection, key_pair, enrollment) = fixture();
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let receipt = accept_normalized_operation_transaction_v1(
            &mut connection,
            &envelopes,
            &key_pair,
            2_000,
        )
        .expect("commit");
        assert_eq!(receipt.member_count, 2);
        assert_eq!(receipt.previous_revision, 0);
        assert_eq!(receipt.committed_revision, 1);
        assert_eq!(receipt.follower_result_sequence, 1);
        assert_eq!(
            receipt.invalidations,
            vec![
                NormalizedMutationInvalidationV1 {
                    ordinal: 0,
                    topic: "feed_item".into(),
                    entity_id: Some("rss:item:1".into()),
                    reset_required: false,
                },
                NormalizedMutationInvalidationV1 {
                    ordinal: 1,
                    topic: "feed_item".into(),
                    entity_id: Some("rss:item:2".into()),
                    reset_required: false,
                },
            ]
        );
        assert!(receipt.canonical_follower_result.len() <= 131_072);
        let native_vector: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/follower-result-native-vector-v1.json"
        ))
        .expect("shared native result vector");
        assert_eq!(native_vector["schema_version"], 1);
        assert_eq!(
            native_vector["authority_public_key"],
            lower_hex(key_pair.public_key().as_ref())
        );
        assert_eq!(
            encode_canonical_value(
                &native_vector["canonical_result"],
                FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
            )
            .expect("shared native result bytes"),
            receipt.canonical_follower_result
        );
        let follower_result: Value =
            serde_json::from_slice(&receipt.canonical_follower_result).expect("follower result");
        assert_eq!(
            follower_result["result_body_digest"],
            receipt.follower_result_digest
        );
        assert_eq!(follower_result["status"], "accepted");
        assert_eq!(follower_result["authoritative_source_revision"], 1);
        assert_eq!(
            follower_result["replacement_fields"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let mut follower_body = follower_result.as_object().unwrap().clone();
        let signature = follower_body
            .remove("signature")
            .and_then(|value| value.as_str().map(str::to_owned))
            .expect("result signature");
        follower_body.remove("signature_algorithm");
        follower_body.remove("result_body_digest");
        assert_eq!(
            follower_result_digest("follower-result-body", &Value::Object(follower_body))
                .expect("body digest"),
            receipt.follower_result_digest
        );
        let signature_input = encode_signature_input(
            "follower-result-envelope",
            &json!({ "result_body_digest": receipt.follower_result_digest }),
            FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
        )
        .expect("signature input");
        assert!(crate::library_core_ed25519::verify_library_core_ed25519(
            &lower_hex(key_pair.public_key().as_ref()),
            &signature,
            &signature_input,
        )
        .expect("signature encoding"));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_operations;", [], |row| row
                    .get::<_, i64>(0),)
                .expect("operations"),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_replication_outbox;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("outbox"),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_receipts;", [], |row| row
                    .get::<_, i64>(0),)
                .expect("receipts"),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_invalidations WHERE revision = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("invalidations"),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT read_at FROM library_feed_items WHERE global_id = 'rss:item:1';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("read state"),
            900
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT accepted_counter FROM library_actors WHERE actor_id = ?1;",
                    [&enrollment.actor_id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("actor counter"),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| row
                    .get::<_, i64>(
                    0
                ),)
                .expect("revision"),
            1
        );
        assert_eq!(
            accept_normalized_operation_transaction_v1(
                &mut connection,
                &envelopes,
                &key_pair,
                2_001
            )
            .expect("exact retry"),
            receipt
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| row
                    .get::<_, i64>(
                    0
                ),)
                .expect("transactions"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_follower_result_outbox;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("follower result outbox"),
            1
        );
    }

    #[test]
    fn late_follower_result_cursor_failure_rolls_back_the_entire_authority_commit() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_follower_result_cursor
                 BEFORE UPDATE ON library_follower_result_cursors
                 BEGIN
                   SELECT RAISE(ABORT, 'late follower result fault');
                 END;",
            )
            .expect("fault trigger");
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let error = accept_normalized_operation_transaction_v1(
            &mut connection,
            &envelopes,
            &key_pair,
            2_000,
        )
        .expect_err("late result fault");
        assert!(error.to_string().contains("late follower result fault"));
        for table in [
            "library_transactions",
            "library_operations",
            "library_receipts",
            "library_replication_outbox",
            "library_follower_result_outbox",
            "library_follower_result_cursors",
        ] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT count(*) FROM {table};"), [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .expect("rolled back table"),
                0,
                "{table}"
            );
        }
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("rolled back revision"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT read_at FROM library_feed_items WHERE global_id = 'rss:item:1';",
                    [],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .expect("rolled back projection"),
            None
        );
    }

    #[test]
    fn follower_result_outbox_models_every_closed_outcome_without_a_fake_commit() {
        let (mut connection, key_pair, enrollment) = fixture();
        let accepted = accept_normalized_operation_transaction_v1(
            &mut connection,
            &signed_envelopes(&key_pair, &enrollment),
            &key_pair,
            2_000,
        )
        .expect("accepted result");
        connection
            .execute(
                "INSERT INTO library_follower_result_outbox
                 (transaction_id, transaction_digest, actor_id,
                  authority_epoch_id, intent_epoch_id, result_sequence,
                  previous_result_digest, result_digest, status, rejection_reason,
                  original_result_digest, authoritative_source_revision,
                  canonical_result, enqueued_at)
                 VALUES ('already-applied-transaction', ?1, ?2, ?3, ?3,
                         2, ?4, ?5, 'already_applied', NULL, ?4, 1, x'7b7d', 2100);",
                params![
                    "b".repeat(64),
                    enrollment.actor_id,
                    enrollment.epoch_id,
                    accepted.follower_result_digest,
                    "d".repeat(64),
                ],
            )
            .expect("already applied result without accepted transaction row");
        connection
            .execute(
                "INSERT INTO library_follower_result_outbox
                 (transaction_id, transaction_digest, actor_id,
                  authority_epoch_id, intent_epoch_id, result_sequence,
                  previous_result_digest, result_digest, status, rejection_reason,
                  original_result_digest, authoritative_source_revision,
                  canonical_result, enqueued_at)
                 VALUES ('rejected-transaction', ?1, ?2, ?3, ?3,
                         3, ?4, ?5, 'rejected', 'target_missing', NULL, 1, x'7b7d', 2200);",
                params![
                    "c".repeat(64),
                    enrollment.actor_id,
                    enrollment.epoch_id,
                    "d".repeat(64),
                    "e".repeat(64),
                ],
            )
            .expect("rejected result without accepted transaction row");
        let outcomes: String = connection
            .query_row(
                "SELECT group_concat(status || ':' || coalesce(rejection_reason, 'none'), ',')
                 FROM (SELECT status, rejection_reason
                       FROM library_follower_result_outbox
                       ORDER BY result_sequence);",
                [],
                |row| row.get(0),
            )
            .expect("typed result outcomes");
        assert_eq!(
            outcomes,
            "accepted:none,already_applied:none,rejected:target_missing"
        );
        let invalid = connection.execute(
            "INSERT INTO library_follower_result_outbox
             (transaction_id, transaction_digest, actor_id,
              authority_epoch_id, intent_epoch_id, result_sequence,
              previous_result_digest, result_digest, status, rejection_reason,
              original_result_digest, authoritative_source_revision,
              canonical_result, enqueued_at)
             VALUES ('invalid-rejection', ?1, ?2, ?3, ?3, 4, ?4, ?5,
                     'rejected', NULL, NULL, 1, x'7b7d', 2300);",
            params![
                "f".repeat(64),
                enrollment.actor_id,
                enrollment.epoch_id,
                "e".repeat(64),
                "1".repeat(64),
            ],
        );
        assert!(invalid.is_err());
    }

    #[test]
    fn follower_result_pages_are_actor_bound_contiguous_and_exactly_byte_bounded() {
        let (mut connection, key_pair, enrollment) = fixture();
        let accepted = accept_normalized_operation_transaction_v1(
            &mut connection,
            &signed_envelopes(&key_pair, &enrollment),
            &key_pair,
            2_000,
        )
        .expect("accepted result");
        let maximum_canonical_result = format!("\"{}\"", "a".repeat(131_070));
        assert_eq!(maximum_canonical_result.len(), 131_072);
        connection
            .execute(
                "INSERT INTO library_follower_result_outbox
                 (transaction_id, transaction_digest, actor_id,
                  authority_epoch_id, intent_epoch_id, result_sequence,
                  previous_result_digest, result_digest, status, rejection_reason,
                  original_result_digest, authoritative_source_revision,
                  canonical_result, enqueued_at)
                 VALUES ('already-applied-page', ?1, ?2, ?3, ?3,
                         2, ?4, ?5, 'already_applied', NULL, ?4, 1, ?6, 2100);",
                params![
                    "b".repeat(64),
                    enrollment.actor_id,
                    enrollment.epoch_id,
                    accepted.follower_result_digest,
                    "d".repeat(64),
                    maximum_canonical_result.as_bytes(),
                ],
            )
            .expect("maximum result");
        connection
            .execute(
                "INSERT INTO library_follower_result_outbox
                 (transaction_id, transaction_digest, actor_id,
                  authority_epoch_id, intent_epoch_id, result_sequence,
                  previous_result_digest, result_digest, status, rejection_reason,
                  original_result_digest, authoritative_source_revision,
                  canonical_result, enqueued_at)
                 VALUES ('rejected-page', ?1, ?2, ?3, ?3,
                         3, ?4, ?5, 'rejected', 'target_missing', NULL, 1, x'7b7d', 2200);",
                params![
                    "c".repeat(64),
                    enrollment.actor_id,
                    enrollment.epoch_id,
                    "d".repeat(64),
                    "e".repeat(64),
                ],
            )
            .expect("rejected result");
        connection
            .execute(
                "UPDATE library_follower_result_cursors
                 SET next_result_sequence = 4, previous_result_digest = ?2
                 WHERE actor_id = ?1;",
                params![enrollment.actor_id, "e".repeat(64)],
            )
            .expect("result cursor");

        let first = export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: enrollment.actor_id.clone(),
                after: None,
                maximum_records: 1,
                maximum_response_bytes: FOLLOWER_RESULT_PAGE_MAXIMUM_RESPONSE_BYTES,
            },
        )
        .expect("first page");
        assert_eq!(first.records.len(), 1);
        assert!(!first.done);
        assert_eq!(
            first.records[0].canonical_result_json.as_bytes(),
            accepted.canonical_follower_result
        );
        let exact_first_page_bytes = serialized_follower_result_page_bytes(&first).unwrap();

        let byte_limited = export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: enrollment.actor_id.clone(),
                after: None,
                maximum_records: FOLLOWER_RESULT_PAGE_MAXIMUM_RECORDS,
                maximum_response_bytes: exact_first_page_bytes,
            },
        )
        .expect("exact first-page bound");
        assert_eq!(byte_limited.records.len(), 1);
        assert!(!byte_limited.done);
        assert_eq!(
            serialized_follower_result_page_bytes(&byte_limited).unwrap(),
            exact_first_page_bytes
        );
        assert!(export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: enrollment.actor_id.clone(),
                after: None,
                maximum_records: FOLLOWER_RESULT_PAGE_MAXIMUM_RECORDS,
                maximum_response_bytes: exact_first_page_bytes - 1,
            },
        )
        .is_err());

        let second = export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: enrollment.actor_id.clone(),
                after: first.next_cursor.clone(),
                maximum_records: 1,
                maximum_response_bytes: FOLLOWER_RESULT_PAGE_MAXIMUM_RESPONSE_BYTES,
            },
        )
        .expect("maximum record page");
        assert_eq!(second.records.len(), 1);
        assert_eq!(second.canonical_record_bytes, 131_072);
        assert_eq!(
            second.records[0].canonical_result_json,
            maximum_canonical_result
        );
        assert!(!second.done);

        let third = export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: enrollment.actor_id.clone(),
                after: second.next_cursor.clone(),
                maximum_records: 1,
                maximum_response_bytes: FOLLOWER_RESULT_PAGE_MAXIMUM_RESPONSE_BYTES,
            },
        )
        .expect("final page");
        assert_eq!(third.records.len(), 1);
        assert_eq!(third.records[0].result_sequence, 3);
        assert!(third.done);

        let mut wrong_chain_cursor = first.next_cursor.unwrap();
        wrong_chain_cursor.result_digest = "f".repeat(64);
        assert!(export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: enrollment.actor_id.clone(),
                after: Some(wrong_chain_cursor),
                maximum_records: 1,
                maximum_response_bytes: FOLLOWER_RESULT_PAGE_MAXIMUM_RESPONSE_BYTES,
            },
        )
        .is_err());
        assert!(export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: enrollment.actor_id.clone(),
                after: Some(NormalizedFollowerResultCursorV1 {
                    actor_id: enrollment.actor_id.clone(),
                    result_sequence: 4,
                    result_digest: "1".repeat(64),
                }),
                maximum_records: 1,
                maximum_response_bytes: FOLLOWER_RESULT_PAGE_MAXIMUM_RESPONSE_BYTES,
            },
        )
        .is_err());
    }

    #[test]
    fn follower_result_page_uses_actor_sequence_keyset_index_without_a_sort() {
        let (connection, _key_pair, enrollment) = fixture();
        let mut statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {FOLLOWER_RESULT_PAGE_SQL}"))
            .expect("query plan");
        let plan = statement
            .query_map(params![enrollment.actor_id, 0, 129], |row| {
                row.get::<_, String>(3)
            })
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("query plan details");
        assert!(plan.iter().any(|detail| {
            detail.contains("SEARCH library_follower_result_outbox USING INDEX")
        }));
        assert!(plan.iter().all(|detail| !detail.contains("SCAN")));
        assert!(plan
            .iter()
            .all(|detail| !detail.contains("USE TEMP B-TREE")));
    }

    #[test]
    fn native_outcome_producer_signs_rejection_and_already_applied_without_product_writes() {
        let (mut connection, key_pair, enrollment) = fixture();
        let accepted = accept_normalized_operation_transaction_v1(
            &mut connection,
            &signed_envelopes(&key_pair, &enrollment),
            &key_pair,
            2_000,
        )
        .expect("accepted result");
        let already_envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:already-applied",
            accepted.last_counter + 1,
            Some(&accepted.committed_operation_id),
            &accepted.committed_chain_digest,
            &[("rss:item:1", 900), ("rss:item:2", 901)],
            "feed_item_read_assignment",
        );
        let already_verified = verify_operation_transaction(&already_envelopes, |identity| {
            actor_state_at(&connection, identity)
        })
        .expect("already-applied transaction verification");
        let already = {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("already-applied transaction");
            let result = persist_follower_result_outcome(
                &transaction,
                &already_verified,
                &key_pair,
                accepted.committed_revision,
                2_100,
                FollowerResultOutcome::AlreadyApplied {
                    original_result_digest: &accepted.follower_result_digest,
                },
            )
            .expect("already-applied result");
            transaction.commit().expect("already-applied commit");
            result
        };
        let already_json: Value =
            serde_json::from_slice(&already.2).expect("already-applied canonical result");
        let accepted_json: Value = serde_json::from_slice(&accepted.canonical_follower_result)
            .expect("accepted canonical result");
        assert_eq!(already_json["status"], "already_applied");
        assert_eq!(
            already_json["original_result_digest"],
            accepted.follower_result_digest
        );
        assert_eq!(
            already_json["canonical_operation_ids"],
            accepted_json["canonical_operation_ids"]
        );
        assert_eq!(already_json["receipt_ids"], accepted_json["receipt_ids"]);
        assert_eq!(
            already_json["replacement_fields"],
            accepted_json["replacement_fields"]
        );

        let rejected_envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rejected",
            accepted.last_counter + 1,
            Some(&accepted.committed_operation_id),
            &accepted.committed_chain_digest,
            &[("rss:item:missing", 902)],
            "feed_item_read_assignment",
        );
        let rejected = match resolve_normalized_operation_transaction_v1(
            &mut connection,
            &rejected_envelopes,
            &key_pair,
            2_200,
        )
        .expect("rejected result")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("missing target cannot be accepted")
            }
        };
        let rejected_json: Value = serde_json::from_slice(&rejected.canonical_follower_result)
            .expect("rejected canonical result");
        assert_eq!(rejected_json["status"], "rejected");
        assert_eq!(rejected_json["rejection_reason"], "target_missing");
        assert_eq!(rejected_json["canonical_operation_ids"], json!([]));
        assert_eq!(rejected_json["receipt_ids"], json!([]));
        assert_eq!(rejected_json["replacement_fields"], json!([]));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted transactions only"),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_operations;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted operations only"),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted revision only"),
            accepted.committed_revision
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT next_result_sequence FROM library_follower_result_cursors
                     WHERE actor_id = ?1;",
                    [&enrollment.actor_id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("result cursor"),
            4
        );

        let retry = match resolve_normalized_operation_transaction_v1(
            &mut connection,
            &rejected_envelopes,
            &key_pair,
            9_999,
        )
        .expect("exact rejected retry")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("missing target retry cannot be accepted")
            }
        };
        assert_eq!(retry, rejected);
        assert_eq!(
            connection
                .query_row(
                    "SELECT next_result_sequence FROM library_follower_result_cursors
                     WHERE actor_id = ?1;",
                    [&enrollment.actor_id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("unchanged result cursor"),
            4
        );
    }

    #[test]
    fn resolver_distinguishes_a_tombstone_from_a_never_seen_target() {
        let (mut connection, key_pair, enrollment) = fixture();
        let removal_envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:remove-before-rejection",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 1_900)],
            "feed_item_remove",
        );
        let removal = accept_normalized_operation_transaction_v1(
            &mut connection,
            &removal_envelopes,
            &key_pair,
            2_000,
        )
        .expect("accepted removal");
        let stale_target_envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:read-tombstone",
            removal.last_counter + 1,
            Some(&removal.committed_operation_id),
            &removal.committed_chain_digest,
            &[("rss:item:1", 2_050)],
            "feed_item_read_assignment",
        );
        let rejection = match resolve_normalized_operation_transaction_v1(
            &mut connection,
            &stale_target_envelopes,
            &key_pair,
            2_100,
        )
        .expect("tombstone rejection")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("a tombstoned target cannot be accepted")
            }
        };
        let canonical: Value = serde_json::from_slice(&rejection.canonical_follower_result)
            .expect("canonical tombstone rejection");
        assert_eq!(canonical["rejection_reason"], "target_tombstoned");
        assert_eq!(canonical["authoritative_source_revision"], 1);
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted transaction count"),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT accepted_counter FROM library_actors;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted actor tip"),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted source revision"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_follower_result_outbox;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("accepted plus rejected results"),
            2
        );
    }

    #[test]
    fn resolver_signs_a_stale_actor_tip_as_a_precondition_failure() {
        let (mut connection, key_pair, enrollment) = fixture();
        let accepted = accept_normalized_operation_transaction_v1(
            &mut connection,
            &signed_envelopes(&key_pair, &enrollment),
            &key_pair,
            2_000,
        )
        .expect("accepted transaction");
        let stale_fork = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:stale-fork",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 2_050)],
            "feed_item_read_assignment",
        );
        let rejection = match resolve_normalized_operation_transaction_v1(
            &mut connection,
            &stale_fork,
            &key_pair,
            2_100,
        )
        .expect("precondition rejection")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("a stale actor fork cannot be accepted")
            }
        };
        let canonical: Value = serde_json::from_slice(&rejection.canonical_follower_result)
            .expect("canonical precondition rejection");
        assert_eq!(canonical["rejection_reason"], "precondition_failed");
        assert_eq!(canonical["authoritative_source_revision"], 1);
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted transaction count"),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT accepted_counter FROM library_actors;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted actor counter"),
            accepted.last_counter
        );
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("accepted revision"),
            accepted.committed_revision
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_follower_result_outbox;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("accepted plus rejected results"),
            2
        );
    }

    #[test]
    fn resolver_signs_actor_and_capability_policy_rejections_without_accepting() {
        let (mut retired_connection, retired_key_pair, retired_enrollment) = fixture();
        let retired_envelopes = signed_envelopes(&retired_key_pair, &retired_enrollment);
        retired_connection
            .execute(
                "UPDATE library_actors SET retired_at = 1500, updated_at = 1500
                 WHERE actor_id = ?1;",
                [&retired_enrollment.actor_id],
            )
            .expect("retire actor");
        let retired_receipt = match resolve_normalized_operation_transaction_v1(
            &mut retired_connection,
            &retired_envelopes,
            &retired_key_pair,
            2_000,
        )
        .expect("actor retirement rejection")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("a retired actor cannot be accepted")
            }
        };
        let retired_result: Value =
            serde_json::from_slice(&retired_receipt.canonical_follower_result)
                .expect("canonical retired result");
        assert_eq!(retired_result["rejection_reason"], "actor_retired");
        assert_eq!(retired_result["authoritative_source_revision"], 0);
        assert_eq!(
            retired_result["replacement_fields"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let retired_retry = match resolve_normalized_operation_transaction_v1(
            &mut retired_connection,
            &retired_envelopes,
            &retired_key_pair,
            2_100,
        )
        .expect("retired exact retry")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("a retired actor retry cannot be accepted")
            }
        };
        assert_eq!(retired_retry, retired_receipt);
        assert_eq!(
            retired_connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("no retired transaction"),
            0
        );
        assert_eq!(
            retired_connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("unchanged retired revision"),
            0
        );
        assert_eq!(
            retired_connection
                .query_row(
                    "SELECT count(*) FROM library_follower_result_outbox;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("one retired result"),
            1
        );

        let (mut denied_connection, denied_key_pair, denied_enrollment) = fixture();
        let denied_envelopes = signed_envelopes(&denied_key_pair, &denied_enrollment);
        denied_connection
            .execute(
                "UPDATE library_actor_capabilities
                 SET retired_at = 1500, retirement_certificate_digest = ?2
                 WHERE capability_id = ?1;",
                params![
                    denied_enrollment.enrollment_certificate_digest,
                    "f".repeat(64)
                ],
            )
            .expect("retire capability");
        let denied_receipt = match resolve_normalized_operation_transaction_v1(
            &mut denied_connection,
            &denied_envelopes,
            &denied_key_pair,
            2_000,
        )
        .expect("capability rejection")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("a denied capability cannot be accepted")
            }
        };
        let denied_result: Value =
            serde_json::from_slice(&denied_receipt.canonical_follower_result)
                .expect("canonical capability result");
        assert_eq!(denied_result["rejection_reason"], "capability_denied");
        assert_eq!(denied_result["authoritative_source_revision"], 0);
        assert_eq!(
            denied_result["replacement_fields"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            denied_connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("no denied transaction"),
            0
        );
        assert_eq!(
            denied_connection
                .query_row("SELECT accepted_counter FROM library_actors;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("unchanged denied actor tip"),
            0
        );
        assert_eq!(
            denied_connection
                .query_row(
                    "SELECT read_at FROM library_feed_items WHERE global_id = 'rss:item:1';",
                    [],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .expect("unchanged denied item"),
            None
        );
        assert_eq!(
            denied_connection
                .query_row(
                    "SELECT count(*) FROM library_follower_result_outbox;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("one capability result"),
            1
        );
    }

    #[test]
    fn resolver_signs_a_stale_intent_epoch_with_the_current_authority() {
        let (mut connection, key_pair, enrollment) = fixture();
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let current_epoch_id = "4".repeat(64);
        connection
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 SELECT ?1, library_id, 2, authority_key_id,
                        authority_public_key, ?2, '{}', 1, ?3, ?4, 1500
                 FROM library_authority_epochs WHERE epoch_id = ?5;",
                params![
                    current_epoch_id,
                    "d".repeat(64),
                    "e".repeat(64),
                    "f".repeat(64),
                    enrollment.epoch_id,
                ],
            )
            .expect("new authority epoch");
        connection
            .execute(
                "UPDATE library_active_authority
                 SET epoch_id = ?1, accepted_manifest_generation = 1,
                     activated_at = 1500;",
                [&current_epoch_id],
            )
            .expect("activate new epoch");
        connection
            .execute(
                "UPDATE library_writer_admission
                 SET observed_manifest_generation = 1, observed_at = 1500;",
                [],
            )
            .expect("admit current writer");
        connection
            .execute(
                "UPDATE library_meta
                 SET authority_epoch = ?1, updated_at = 1500;",
                [&current_epoch_id],
            )
            .expect("advance Library epoch");

        let receipt = match resolve_normalized_operation_transaction_v1(
            &mut connection,
            &envelopes,
            &key_pair,
            2_000,
        )
        .expect("stale epoch rejection")
        {
            NormalizedMutationResolutionV1::FollowerResult(receipt) => receipt,
            NormalizedMutationResolutionV1::Accepted(_) => {
                panic!("an old epoch intent cannot be accepted")
            }
        };
        let result: Value = serde_json::from_slice(&receipt.canonical_follower_result)
            .expect("canonical stale epoch result");
        assert_eq!(result["rejection_reason"], "epoch_stale");
        assert_eq!(result["epoch"], 2);
        assert_eq!(result["epoch_id"], current_epoch_id);
        assert_eq!(result["intent_epoch"], 1);
        assert_eq!(result["intent_epoch_id"], enrollment.epoch_id);
        assert_eq!(result["authoritative_source_revision"], 0);
        assert_eq!(result["replacement_fields"].as_array().unwrap().len(), 2);
        assert_eq!(
            connection
                .query_row(
                    "SELECT authority_epoch_id, intent_epoch_id
                     FROM library_follower_result_outbox;",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .expect("stored result epochs"),
            (current_epoch_id, enrollment.epoch_id)
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("no stale epoch transaction"),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("unchanged stale epoch revision"),
            0
        );
    }

    #[test]
    fn signature_failure_and_lost_writer_admission_cannot_mutate_or_replay() {
        let (mut connection, key_pair, enrollment) = fixture();
        let mut tampered = signed_envelopes(&key_pair, &enrollment);
        tampered[0][0] ^= 1;
        assert!(accept_normalized_operation_transaction_v1(
            &mut connection,
            &tampered,
            &key_pair,
            2_000
        )
        .is_err());
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| row
                    .get::<_, i64>(
                    0
                ),)
                .expect("transactions"),
            0
        );
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        accept_normalized_operation_transaction_v1(&mut connection, &envelopes, &key_pair, 2_000)
            .expect("commit");
        connection
            .execute(
                "UPDATE library_writer_admission SET active_writer_id = 'writer-2';",
                [],
            )
            .expect("lose admission");
        let error = accept_normalized_operation_transaction_v1(
            &mut connection,
            &envelopes,
            &key_pair,
            2_001,
        )
        .expect_err("replay without admission");
        assert!(error.to_string().contains("active authority is stale"));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| row
                    .get::<_, i64>(
                    0
                ),)
                .expect("transactions"),
            1
        );
    }

    #[test]
    fn signed_state_assignments_use_generated_sql_and_one_coupled_saved_archive_clock() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute(
                "UPDATE library_feed_items SET liked_synced_at = 700
                 WHERE global_id = 'rss:item:1';",
                [],
            )
            .expect("install prior like receipt");

        let save = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:save:first",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 1_000)],
            "feed_item_saved_assignment",
        );
        let save_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &save, &key_pair, 2_000)
                .expect("save");

        let archive = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:archive:newer",
            2,
            Some(&save_receipt.committed_operation_id),
            &save_receipt.committed_chain_digest,
            &[("rss:item:1", 1_100)],
            "feed_item_archive_assignment",
        );
        let archive_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &archive, &key_pair, 2_100)
                .expect("archive");

        let stale_save = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:save:older",
            3,
            Some(&archive_receipt.committed_operation_id),
            &archive_receipt.committed_chain_digest,
            &[("rss:item:1", 1_050)],
            "feed_item_saved_assignment",
        );
        let stale_save_receipt = accept_normalized_operation_transaction_v1(
            &mut connection,
            &stale_save,
            &key_pair,
            2_200,
        )
        .expect("journal stale save without changing projection");

        let like = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:like:newer",
            4,
            Some(&stale_save_receipt.committed_operation_id),
            &stale_save_receipt.committed_chain_digest,
            &[("rss:item:1", 1_200)],
            "feed_item_like_assignment",
        );
        accept_normalized_operation_transaction_v1(&mut connection, &like, &key_pair, 2_300)
            .expect("like");

        let state: FeedState = connection
            .query_row(
                "SELECT saved, saved_at, archived, archived_at,
                            liked, liked_at, liked_synced_at
                     FROM library_feed_items WHERE global_id = 'rss:item:1';",
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
            .expect("state");
        assert_eq!(state, (0, None, 1, Some(1_100), Some(1), Some(1_200), None));
        assert_eq!(
            connection
                .query_row(
                    "SELECT updated_at FROM library_field_clocks
                     WHERE entity_id = 'rss:item:1'
                       AND field_path = 'saved_archive_state';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("coupled state clock"),
            1_100
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("journaled transactions"),
            4
        );
    }

    #[test]
    fn signed_provider_sync_receipts_materialize_only_the_named_timestamp() {
        let (mut connection, key_pair, enrollment) = fixture();
        let like = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:receipt:like-state",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 1_000)],
            "feed_item_like_assignment",
        );
        let like_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &like, &key_pair, 1_000)
                .expect("like item");
        let confirm_like = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:receipt:liked",
            2,
            Some(&like_receipt.committed_operation_id),
            &like_receipt.committed_chain_digest,
            &[("rss:item:1", 1_100)],
            "feed_item_like_sync_receipt",
        );
        let confirmed_like = accept_normalized_operation_transaction_v1(
            &mut connection,
            &confirm_like,
            &key_pair,
            1_100,
        )
        .expect("confirm like delivery");
        let confirm_seen = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:receipt:seen",
            3,
            Some(&confirmed_like.committed_operation_id),
            &confirmed_like.committed_chain_digest,
            &[("rss:item:1", 1_200)],
            "feed_item_seen_sync_receipt",
        );
        accept_normalized_operation_transaction_v1(
            &mut connection,
            &confirm_seen,
            &key_pair,
            1_200,
        )
        .expect("confirm seen delivery");

        assert_eq!(
            connection
                .query_row(
                    "SELECT liked, liked_at, liked_synced_at, seen_synced_at
                     FROM library_feed_items WHERE global_id = 'rss:item:1';",
                    [],
                    |row| Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?
                    )),
                )
                .expect("provider receipt projection"),
            (1, 1_000, 1_100, 1_200)
        );
    }

    #[test]
    fn signed_feed_item_capture_materializes_normalized_rows_and_preserves_user_state() {
        let (mut connection, key_pair, enrollment) = fixture();
        let first_payload = serde_json::json!({
            "item": {
                "globalId": "saved:capture:1",
                "platform": "saved",
                "contentType": "article",
                "capturedAt": 900,
                "publishedAt": 800,
                "author": {
                    "id": "author:ada",
                    "handle": "ada",
                    "displayName": "Ada Lovelace",
                    "avatarUrl": "https://example.com/ada.jpg"
                },
                "content": {
                    "text": "First bounded body",
                    "mediaUrls": ["https://example.com/one.jpg"],
                    "mediaTypes": ["image"],
                    "linkPreview": {
                        "url": "https://example.com/article",
                        "title": "Analytical Engine"
                    }
                },
                "engagement": { "likes": 10, "comments": 2 },
                "location": {
                    "name": "London",
                    "coordinates": {
                        "lat": { "bits": "4049800000000000", "codec": "ieee754_binary64_hex_v1" },
                        "lng": { "bits": "c000000000000000", "codec": "ieee754_binary64_hex_v1" }
                    },
                    "source": "explicit"
                },
                "topics": ["computing", "history"],
                "userState": { "hidden": false, "saved": false, "archived": false, "tags": [] },
                "sourceUrl": "https://example.com/source"
            }
        });
        let first = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:capture:first",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("saved:capture:1", 1_000)],
            "feed_item_capture_upsert",
            Some(&first_payload),
        );
        let first_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &first, &key_pair, 2_000)
                .expect("capture FeedItem");
        assert_eq!(
            connection
                .query_row(
                    "SELECT platform, content_type, content_text, author_display_name,
                            location_lat, location_lng, saved, updated_at
                     FROM library_feed_items WHERE global_id = 'saved:capture:1';",
                    [],
                    |row| Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, f64>(4)?,
                        row.get::<_, f64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    )),
                )
                .expect("normalized FeedItem"),
            (
                "saved".to_owned(),
                "article".to_owned(),
                "First bounded body".to_owned(),
                "Ada Lovelace".to_owned(),
                51.0,
                -2.0,
                0,
                2_000,
            )
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT
                       (SELECT count(*) FROM library_feed_item_media WHERE global_id = 'saved:capture:1') +
                       (SELECT count(*) FROM library_feed_item_topics WHERE global_id = 'saved:capture:1');",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("normalized children"),
            3
        );

        let save = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:capture:save",
            2,
            Some(&first_receipt.committed_operation_id),
            &first_receipt.committed_chain_digest,
            &[("saved:capture:1", 2_100)],
            "feed_item_saved_assignment",
        );
        let save_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &save, &key_pair, 2_100)
                .expect("save captured FeedItem");
        connection
            .execute(
                "INSERT INTO library_feed_item_tags (global_id, tag)
                 VALUES ('saved:capture:1', 'personal');",
                [],
            )
            .expect("user tag");

        let second_payload = serde_json::json!({
            "item": {
                "globalId": "saved:capture:1",
                "platform": "saved",
                "contentType": "article",
                "capturedAt": 1_100,
                "publishedAt": 800,
                "author": { "id": "author:ada", "handle": "ada", "displayName": "Ada Lovelace" },
                "content": {
                    "text": "Refreshed bounded body",
                    "mediaUrls": ["https://example.com/two.mp4"],
                    "mediaTypes": ["video"]
                },
                "topics": ["computing"],
                "userState": { "hidden": true, "saved": false, "archived": true, "tags": [] }
            }
        });
        let second = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:capture:refresh",
            3,
            Some(&save_receipt.committed_operation_id),
            &save_receipt.committed_chain_digest,
            &[("saved:capture:1", 2_200)],
            "feed_item_capture_upsert",
            Some(&second_payload),
        );
        accept_normalized_operation_transaction_v1(&mut connection, &second, &key_pair, 2_200)
            .expect("refresh captured FeedItem");
        assert_eq!(
            connection
                .query_row(
                    "SELECT content_text, hidden, saved, archived,
                            (SELECT count(*) FROM library_feed_item_media WHERE global_id = item.global_id),
                            (SELECT count(*) FROM library_feed_item_topics WHERE global_id = item.global_id),
                            (SELECT count(*) FROM library_feed_item_tags WHERE global_id = item.global_id)
                     FROM library_feed_items AS item WHERE global_id = 'saved:capture:1';",
                    [],
                    |row| Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    )),
                )
                .expect("refreshed normalized FeedItem"),
            ("Refreshed bounded body".to_owned(), 0, 1, 0, 1, 1, 1)
        );
    }

    #[test]
    fn signed_feed_item_removal_cascades_children_and_keeps_the_winning_tombstone() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute_batch(
                "INSERT INTO library_feed_item_tags (global_id, tag)
                   VALUES ('rss:item:1', 'delete-me');
                 INSERT INTO library_feed_item_media
                   (global_id, ordinal, source_url, media_type)
                   VALUES ('rss:item:1', 0, 'https://example.com/media', 'image');",
            )
            .expect("children");

        let removal = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:remove:newer",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 1_100)],
            "feed_item_remove",
        );
        let removal_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &removal, &key_pair, 2_000)
                .expect("remove");
        let stale_removal = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:remove:older",
            2,
            Some(&removal_receipt.committed_operation_id),
            &removal_receipt.committed_chain_digest,
            &[("rss:item:1", 1_000)],
            "feed_item_remove",
        );
        accept_normalized_operation_transaction_v1(
            &mut connection,
            &stale_removal,
            &key_pair,
            2_100,
        )
        .expect("journal stale removal");

        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_feed_items WHERE global_id = 'rss:item:1';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("item count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT
                       (SELECT count(*) FROM library_feed_item_tags WHERE global_id = 'rss:item:1') +
                       (SELECT count(*) FROM library_feed_item_media WHERE global_id = 'rss:item:1');",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("child count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT deleted_at, operation_id FROM library_tombstones
                     WHERE entity_type = 'feed_item' AND entity_id = 'rss:item:1';",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )
                .expect("tombstone"),
            (1_100, "tx:remove:newer:member:0".to_owned())
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_transactions;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("journaled transactions"),
            2
        );
    }

    #[test]
    fn signed_entity_removals_apply_declared_relationship_deletes_and_tombstones() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute_batch(
                "INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES ('person-1', 'Ada', 'friend', 5, 900, 1000);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, display_name,
                    first_seen_at, last_seen_at, discovered_from, created_at, updated_at)
                   VALUES
                     ('account-linked', 'person-1', 'social', 'x', 'linked', 'Linked', 900, 1000, 'capture', 900, 1000),
                     ('account-direct', NULL, 'social', 'x', 'direct', 'Direct', 900, 1000, 'capture', 900, 1000);
                 INSERT INTO library_rss_feeds
                   (url, title, enabled, track_unread, updated_at)
                   VALUES
                     ('feed:keep', 'Keep', 1, 1, 1000),
                     ('feed:remove', 'Remove', 1, 1, 1000);
                 UPDATE library_feed_items SET rss_feed_url = 'feed:keep'
                   WHERE global_id = 'rss:item:1';
                 UPDATE library_feed_items SET rss_feed_url = 'feed:remove'
                   WHERE global_id = 'rss:item:2';",
            )
            .expect("removal fixtures");

        let account = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:account:remove",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("account-direct", 1_100)],
            "account_remove",
        );
        let account_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &account, &key_pair, 2_000)
                .expect("remove account");
        let person = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:remove",
            2,
            Some(&account_receipt.committed_operation_id),
            &account_receipt.committed_chain_digest,
            &[("person-1", 1_200)],
            "person_remove_and_accounts",
        );
        let person_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &person, &key_pair, 2_100)
                .expect("remove person and accounts");
        let keep_feed = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:feed:keep-items",
            3,
            Some(&person_receipt.committed_operation_id),
            &person_receipt.committed_chain_digest,
            &[("feed:keep", 1_300)],
            "rss_feed_remove_keep_items",
        );
        let keep_receipt = accept_normalized_operation_transaction_v1(
            &mut connection,
            &keep_feed,
            &key_pair,
            2_200,
        )
        .expect("remove feed and keep items");
        let remove_feed = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:feed:remove-items",
            4,
            Some(&keep_receipt.committed_operation_id),
            &keep_receipt.committed_chain_digest,
            &[("feed:remove", 1_400)],
            "rss_feed_remove_with_items",
        );
        accept_normalized_operation_transaction_v1(&mut connection, &remove_feed, &key_pair, 2_300)
            .expect("remove feed and items");

        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_accounts;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("remaining accounts"),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_persons;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("remaining persons"),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_rss_feeds;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("remaining feeds"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_feed_items WHERE global_id = 'rss:item:1';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("retained feed item"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_feed_items WHERE global_id = 'rss:item:2';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("removed feed item"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_tombstones
                     WHERE entity_type IN ('account', 'person', 'rss_feed');",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("entity tombstones"),
            4
        );
        assert_eq!(
            connection
                .query_row("SELECT revision FROM library_change_state;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("revision"),
            4
        );
    }

    #[test]
    fn signed_person_detach_removal_preserves_linked_accounts() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute_batch(
                "INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES ('person:detach', 'Ada', 'friend', 5, 900, 1000);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, display_name,
                    first_seen_at, last_seen_at, discovered_from, created_at, updated_at)
                   VALUES ('account:detach', 'person:detach', 'social', 'x',
                           'detach', 'Detached', 900, 1000, 'capture', 900, 1000);",
            )
            .expect("detach fixtures");
        let remove = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:detach",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("person:detach", 1_100)],
            "person_remove_detach_accounts",
        );
        accept_normalized_operation_transaction_v1(&mut connection, &remove, &key_pair, 2_000)
            .expect("remove Person and detach Accounts");

        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_persons WHERE id = 'person:detach';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("Person count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT person_id FROM library_accounts WHERE id = 'account:detach';",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .expect("detached Account"),
            None
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT deleted_at FROM library_tombstones
                     WHERE entity_type = 'person' AND entity_id = 'person:detach';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("Person tombstone"),
            1_100
        );
    }

    #[test]
    fn signed_rss_feed_upsert_materializes_normalized_columns_without_resurrection() {
        let (mut connection, key_pair, enrollment) = fixture();
        let upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss:upsert",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("feed:new", 1_000)],
            "rss_feed_upsert",
        );
        let upsert_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &upsert, &key_pair, 2_000)
                .expect("upsert RSS feed");
        assert_eq!(
            connection
                .query_row(
                    "SELECT title, enabled, track_unread, updated_at
                     FROM library_rss_feeds WHERE url = 'feed:new';",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .expect("normalized RSS feed"),
            ("Verified feed".to_owned(), 1, 1, 2_000)
        );

        let remove = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss:remove",
            2,
            Some(&upsert_receipt.committed_operation_id),
            &upsert_receipt.committed_chain_digest,
            &[("feed:new", 1_100)],
            "rss_feed_remove_keep_items",
        );
        let remove_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &remove, &key_pair, 2_100)
                .expect("remove RSS feed");
        let replay_upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss:upsert-after-remove",
            3,
            Some(&remove_receipt.committed_operation_id),
            &remove_receipt.committed_chain_digest,
            &[("feed:new", 1_200)],
            "rss_feed_upsert",
        );
        accept_normalized_operation_transaction_v1(
            &mut connection,
            &replay_upsert,
            &key_pair,
            2_200,
        )
        .expect("journal blocked resurrection");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_rss_feeds WHERE url = 'feed:new';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("RSS feed count"),
            0
        );
    }

    #[test]
    fn signed_rss_feed_title_assignment_uses_a_deterministic_field_clock() {
        let (mut connection, key_pair, enrollment) = fixture();
        let upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss:title:upsert",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("feed:title", 1_000)],
            "rss_feed_upsert",
        );
        let upsert_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &upsert, &key_pair, 2_000)
                .expect("upsert RSS feed");
        let rename = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss:title:rename",
            2,
            Some(&upsert_receipt.committed_operation_id),
            &upsert_receipt.committed_chain_digest,
            &[("feed:title", 1_200)],
            "rss_feed_title_assignment",
        );
        let rename_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &rename, &key_pair, 2_100)
                .expect("rename RSS feed");
        let stale = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss:title:stale",
            3,
            Some(&rename_receipt.committed_operation_id),
            &rename_receipt.committed_chain_digest,
            &[("feed:title", 1_100)],
            "rss_feed_title_assignment",
        );
        accept_normalized_operation_transaction_v1(&mut connection, &stale, &key_pair, 2_200)
            .expect("journal stale RSS title");
        assert_eq!(
            connection
                .query_row(
                    "SELECT feed.title, feed.updated_at, clock.updated_at
                     FROM library_rss_feeds AS feed
                     JOIN library_field_clocks AS clock
                       ON clock.entity_type = 'rss_feed'
                      AND clock.entity_id = feed.url
                      AND clock.field_path = 'title'
                     WHERE feed.url = 'feed:title';",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .expect("renamed RSS feed"),
            ("Renamed feed".to_owned(), 2_100, 1_200)
        );
    }

    #[test]
    fn signed_account_upsert_materializes_root_and_follow_roles_without_resurrection() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute(
                "INSERT INTO library_persons (
                   id, name, relationship_status, care_level, created_at, updated_at
                 ) VALUES ('person:verified', 'Verified Person', 'friend', 3, 1, 1);",
                [],
            )
            .expect("insert Account owner");
        let upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:account:upsert",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("account:new", 1_000)],
            "account_upsert",
        );
        let upsert_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &upsert, &key_pair, 2_000)
                .expect("upsert Account");
        assert_eq!(
            connection
                .query_row(
                    "SELECT person_id, provider, external_id, handle, display_name,
                            follow_roster_active, sample_batch_id, updated_at
                     FROM library_accounts WHERE id = 'account:new';",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, i64>(7)?,
                        ))
                    },
                )
                .expect("normalized Account"),
            (
                "person:verified".to_owned(),
                "instagram".to_owned(),
                "verified".to_owned(),
                "verified_account".to_owned(),
                "Verified Account".to_owned(),
                1,
                "batch:verified".to_owned(),
                1_000,
            )
        );
        assert_eq!(
            connection
                .prepare(
                    "SELECT role FROM library_account_follow_roles
                     WHERE account_id = 'account:new' ORDER BY role;",
                )
                .expect("prepare Account role query")
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query Account roles")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("collect Account roles"),
            vec!["follower".to_owned(), "following".to_owned()]
        );

        let remove = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:account:remove",
            2,
            Some(&upsert_receipt.committed_operation_id),
            &upsert_receipt.committed_chain_digest,
            &[("account:new", 1_100)],
            "account_remove",
        );
        let remove_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &remove, &key_pair, 2_100)
                .expect("remove Account");
        let blocked_upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:account:upsert-after-remove",
            3,
            Some(&remove_receipt.committed_operation_id),
            &remove_receipt.committed_chain_digest,
            &[("account:new", 1_200)],
            "account_upsert",
        );
        accept_normalized_operation_transaction_v1(
            &mut connection,
            &blocked_upsert,
            &key_pair,
            2_200,
        )
        .expect("journal blocked Account resurrection");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_accounts WHERE id = 'account:new';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("Account count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_account_follow_roles
                     WHERE account_id = 'account:new';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("Account role count"),
            0
        );
    }

    #[test]
    fn signed_account_person_assignment_converges_and_preserves_foreign_keys() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute_batch(
                "INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                 VALUES
                   ('person:verified', 'Verified Person', 'friend', 3, 1, 1),
                   ('person:other', 'Other Person', 'friend', 2, 1, 1);",
            )
            .expect("insert Account owners");
        let upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:account:person:upsert",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("account:person", 1_000)],
            "account_upsert",
        );
        let upsert_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &upsert, &key_pair, 2_000)
                .expect("upsert Account");
        let assignment_payload = serde_json::json!({
            "assigned_at_ms": 1_200,
            "person_id": "person:other"
        });
        let assignment = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:account:person:assign",
            2,
            Some(&upsert_receipt.committed_operation_id),
            &upsert_receipt.committed_chain_digest,
            &[("account:person", 1_200)],
            "account_person_assignment",
            Some(&assignment_payload),
        );
        let assignment_receipt = accept_normalized_operation_transaction_v1(
            &mut connection,
            &assignment,
            &key_pair,
            2_100,
        )
        .expect("assign Account owner");
        let stale_detach_payload = serde_json::json!({
            "assigned_at_ms": 1_100,
            "person_id": null
        });
        let stale_detach = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:account:person:stale-detach",
            3,
            Some(&assignment_receipt.committed_operation_id),
            &assignment_receipt.committed_chain_digest,
            &[("account:person", 1_100)],
            "account_person_assignment",
            Some(&stale_detach_payload),
        );
        accept_normalized_operation_transaction_v1(
            &mut connection,
            &stale_detach,
            &key_pair,
            2_200,
        )
        .expect("journal stale Account owner assignment");
        assert_eq!(
            connection
                .query_row(
                    "SELECT account.person_id, account.updated_at, clock.updated_at
                     FROM library_accounts AS account
                     JOIN library_field_clocks AS clock
                       ON clock.entity_type = 'account'
                      AND clock.entity_id = account.id
                      AND clock.field_path = 'person_id'
                     WHERE account.id = 'account:person';",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .expect("assigned Account owner"),
            ("person:other".to_owned(), 2_100, 1_200)
        );
    }

    #[test]
    fn signed_friend_replace_atomically_resolves_the_complete_linked_account_set() {
        let (mut connection, key_pair, enrollment) = fixture();
        connection
            .execute_batch(
                "INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                 VALUES ('person:friend', 'Before', 'friend', 3, 100, 100);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, display_name,
                    first_seen_at, last_seen_at, discovered_from, created_at, updated_at)
                 VALUES
                   ('account:keep', 'person:friend', 'social', 'instagram', 'keep', 'Keep',
                    100, 200, 'captured_item', 100, 200),
                   ('account:remove', 'person:friend', 'social', 'facebook', 'remove', 'Remove',
                    100, 200, 'captured_item', 100, 200),
                   ('contact:old', 'person:friend', 'contact', 'web_contact', 'old', 'Old',
                    100, 200, 'contact_import', 100, 200);",
            )
            .expect("seed Friend graph");
        let payload = json!({
            "accounts": [
                {
                    "id": "account:keep",
                    "personId": "person:friend",
                    "kind": "social",
                    "provider": "instagram",
                    "externalId": "keep",
                    "displayName": "Kept and updated",
                    "firstSeenAt": 100,
                    "lastSeenAt": 300,
                    "discoveredFrom": "captured_item",
                    "createdAt": 100,
                    "updatedAt": 300
                },
                {
                    "id": "contact:new",
                    "personId": "person:friend",
                    "kind": "contact",
                    "provider": "web_contact",
                    "externalId": "new",
                    "displayName": "New Contact",
                    "firstSeenAt": 300,
                    "lastSeenAt": 300,
                    "discoveredFrom": "contact_import",
                    "createdAt": 300,
                    "updatedAt": 300
                }
            ],
            "person": {
                "id": "person:friend",
                "name": "After",
                "relationshipStatus": "friend",
                "careLevel": 5,
                "tags": ["family"],
                "createdAt": 100,
                "updatedAt": 300
            }
        });
        let envelopes = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:friend:replace",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("person:friend", 300)],
            "friend_replace",
            Some(&payload),
        );
        let receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &envelopes, &key_pair, 400)
                .expect("replace Friend");

        assert_eq!(
            connection
                .query_row(
                    "SELECT name, care_level FROM library_persons WHERE id = 'person:friend';",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .expect("Friend Person"),
            ("After".to_owned(), 5)
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT display_name, last_seen_at FROM library_accounts
                     WHERE id = 'account:keep' AND person_id = 'person:friend';",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .expect("kept Account"),
            ("Kept and updated".to_owned(), 300)
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT person_id FROM library_accounts WHERE id = 'account:remove';",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .expect("detached social Account"),
            None
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_accounts
                     WHERE id = 'contact:old' OR
                           (id = 'contact:new' AND person_id = 'person:friend');",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("replaced contact Account"),
            1
        );
        assert_eq!(
            receipt.invalidations,
            vec![
                NormalizedMutationInvalidationV1 {
                    ordinal: 0,
                    topic: "person".to_owned(),
                    entity_id: Some("person:friend".to_owned()),
                    reset_required: false,
                },
                NormalizedMutationInvalidationV1 {
                    ordinal: 1,
                    topic: "account".to_owned(),
                    entity_id: None,
                    reset_required: true,
                },
            ]
        );
    }

    #[test]
    fn signed_person_upsert_materializes_root_and_child_sets_without_resurrection() {
        let (mut connection, key_pair, enrollment) = fixture();
        let upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:upsert",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("person:new", 1_000)],
            "person_upsert",
        );
        let upsert_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &upsert, &key_pair, 2_000)
                .expect("upsert Person");
        assert_eq!(
            connection
                .query_row(
                    "SELECT name, relationship_status, care_level,
                            reach_out_interval_days, notes, sample_batch_id, updated_at
                     FROM library_persons WHERE id = 'person:new';",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                )
                .expect("normalized Person"),
            (
                "Verified Person".to_owned(),
                "friend".to_owned(),
                3,
                30,
                "Keep in touch".to_owned(),
                "batch:verified".to_owned(),
                1_000,
            )
        );
        assert_eq!(
            connection
                .prepare(
                    "SELECT tag FROM library_person_tags
                     WHERE person_id = 'person:new' ORDER BY tag;",
                )
                .expect("prepare Person tag query")
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query Person tags")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("collect Person tags"),
            vec!["friend".to_owned(), "local".to_owned()]
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_person_reach_outs
                     WHERE person_id = 'person:new';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("separate reach-out relation"),
            0
        );

        let remove = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:remove",
            2,
            Some(&upsert_receipt.committed_operation_id),
            &upsert_receipt.committed_chain_digest,
            &[("person:new", 1_100)],
            "person_remove_and_accounts",
        );
        let remove_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &remove, &key_pair, 2_100)
                .expect("remove Person");
        let blocked_upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:upsert-after-remove",
            3,
            Some(&remove_receipt.committed_operation_id),
            &remove_receipt.committed_chain_digest,
            &[("person:new", 1_200)],
            "person_upsert",
        );
        accept_normalized_operation_transaction_v1(
            &mut connection,
            &blocked_upsert,
            &key_pair,
            2_200,
        )
        .expect("journal blocked Person resurrection");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_persons WHERE id = 'person:new';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("Person count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT (SELECT count(*) FROM library_person_tags
                               WHERE person_id = 'person:new') +
                            (SELECT count(*) FROM library_person_reach_outs
                               WHERE person_id = 'person:new');",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("Person child count"),
            0
        );
    }

    #[test]
    fn signed_person_reach_out_append_uses_stable_ids_and_keeps_latest_twenty() {
        let (mut connection, key_pair, enrollment) = fixture();
        let upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:reach-out:upsert",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("person:reach-out", 1_000)],
            "person_upsert",
        );
        let upsert_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &upsert, &key_pair, 2_000)
                .expect("upsert Person");
        let entities = (0..21)
            .map(|index| ("person:reach-out", 1_000 + index))
            .collect::<Vec<_>>();
        let reaches = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:reach-out:append",
            2,
            Some(&upsert_receipt.committed_operation_id),
            &upsert_receipt.committed_chain_digest,
            &entities,
            "person_reach_out_append",
        );
        accept_normalized_operation_transaction_v1(&mut connection, &reaches, &key_pair, 2_100)
            .expect("append reach-out events");

        let rows = connection
            .prepare(
                "SELECT reach_out_id, logged_at, channel, notes
                 FROM library_person_reach_outs
                 WHERE person_id = 'person:reach-out'
                 ORDER BY logged_at ASC, reach_out_id ASC;",
            )
            .expect("prepare reach-out query")
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .expect("query reach-outs")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect reach-outs");
        assert_eq!(rows.len(), 20);
        assert_eq!(rows.first().expect("oldest retained").1, 1_001);
        assert_eq!(rows.last().expect("newest retained").1, 1_020);
        assert!(rows.iter().all(|row| {
            row.0.starts_with("tx:person:reach-out:append:member:")
                && row.2 == "text"
                && row.3 == "Hello"
        }));
    }

    #[test]
    fn signed_preference_patch_preserves_empty_containers_and_deep_merge_semantics() {
        let (mut connection, key_pair, enrollment) = fixture();
        let initial_payload = serde_json::json!({
            "updates": {
                "ai": { "autoSummarize": true },
                "display": { "archivePruneDays": 14 },
                "storyWall": { "includedPlatforms": ["x", "rss"] },
                "ulysses": {
                    "allowedPaths": { "x": [] },
                    "blockedPlatforms": ["x", "facebook"]
                },
                "weights": { "topics": {} }
            }
        });
        let initial = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:preferences:initial",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("preferences", 1_000)],
            "preferences_leaf_assignment",
            Some(&initial_payload),
        );
        let initial_receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &initial, &key_pair, 2_000)
                .expect("initial preference patch");
        assert_eq!(
            connection
                .query_row(
                    "SELECT integer_value FROM library_preferences
                     WHERE path = 'a:$.storyWall.includedPlatforms';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("array marker"),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT value_type FROM library_preferences
                     WHERE path = 'o:$.weights.topics';",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("empty object marker"),
            "null"
        );

        let replacement_payload = serde_json::json!({
            "updates": {
                "display": { "archivePruneDays": 30 },
                "storyWall": { "includedPlatforms": [] }
            }
        });
        let replacement = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:preferences:replacement",
            2,
            Some(&initial_receipt.committed_operation_id),
            &initial_receipt.committed_chain_digest,
            &[("preferences", 1_100)],
            "preferences_leaf_assignment",
            Some(&replacement_payload),
        );
        accept_normalized_operation_transaction_v1(&mut connection, &replacement, &key_pair, 2_100)
            .expect("replacement preference patch");
        assert_eq!(
            connection
                .query_row(
                    "SELECT integer_value FROM library_preferences
                     WHERE path = 'a:$.storyWall.includedPlatforms';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("empty array marker"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_preferences
                     WHERE substr(path, 3) LIKE '$.storyWall.includedPlatforms[%';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("array descendants"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT boolean_value FROM library_preferences
                     WHERE path = 'v:$.ai.autoSummarize';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("preserved sibling"),
            1
        );
    }
}
