use crate::library_core_journal::actor_capability::parse_stored_capability;
use crate::library_core_journal::operation_verifier::{
    verify_operation_transaction, OperationIdentity,
};
use crate::library_core_journal::{
    validate_transaction, ActorState, JournalError, JournalResult, VerifiedOperationTransaction,
};
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{SqliteMutationProgram, SQLITE_MUTATION_PROGRAMS};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

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
}

fn actor_state_at(
    connection: &Connection,
    identity: &OperationIdentity,
) -> JournalResult<ActorState> {
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
                    actor.chain_genesis_digest
             FROM library_actors AS actor
             JOIN library_authority_epochs AS epoch
               ON epoch.epoch_id = actor.authority_epoch_id
             JOIN library_actor_capabilities AS capability
               ON capability.actor_id = actor.actor_id
              AND capability.retired_at IS NULL
             WHERE actor.actor_id = ?1
               AND actor.authority_epoch_id = ?2
               AND epoch.library_id = ?3
               AND actor.retired_at IS NULL;",
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
                ))
            },
        )
        .optional()?
        .ok_or_else(|| JournalError::ActorNotFound {
            actor_id: identity.actor_id.clone(),
        })?;
    let mut statement = connection.prepare(
        "SELECT mutation_id FROM library_actor_capability_mutations
         WHERE capability_id = (
           SELECT capability_id FROM library_actor_capabilities
           WHERE actor_id = ?1 AND retired_at IS NULL
         )
         ORDER BY mutation_id;",
    )?;
    let allowed_operation_types = statement
        .query_map([&identity.actor_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let capability = parse_stored_capability(
        row.11,
        row.12,
        serde_json::to_string(&allowed_operation_types).map_err(|_| {
            JournalError::InvalidVerifiedInput {
                field: "actor_capability",
            }
        })?,
        row.13,
        row.14,
        row.15,
        connection.query_row(
            "SELECT issuance_identity FROM library_actor_capabilities
             WHERE actor_id = ?1 AND retired_at IS NULL;",
            [&identity.actor_id],
            |row| row.get(0),
        )?,
        connection.query_row(
            "SELECT retirement_identity FROM library_actor_capabilities
             WHERE actor_id = ?1 AND retired_at IS NULL;",
            [&identity.actor_id],
            |row| row.get(0),
        )?,
        row.16,
        row.17,
        i64::from(row.18.is_some()),
        row.19,
    )
    .map_err(|field| JournalError::InvalidVerifiedInput { field })?;
    let next_sequence = row
        .8
        .checked_add(1)
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or(JournalError::InvalidVerifiedInput {
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
    })
}

fn require_writer_admission(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
) -> Result<(), NormalizedSqliteError> {
    let admitted: i64 = transaction.query_row(
        "SELECT count(*)
         FROM library_writer_admission AS admission
         JOIN library_active_authority AS active ON active.active_key = 'active'
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         WHERE admission.singleton_id = 1
           AND admission.local_writer_id = admission.active_writer_id
           AND admission.active_writer_id = active.writer_id
           AND admission.observed_manifest_generation = active.accepted_manifest_generation
           AND active.library_id = ?1
           AND active.epoch_id = ?2
           AND epoch.epoch_number = ?3;",
        params![verified.library_id, verified.epoch_id, verified.epoch],
        |row| row.get(0),
    )?;
    if admitted != 1 {
        return Err(JournalError::StaleAuthority {
            library_id: verified.library_id.clone(),
        }
        .into());
    }
    Ok(())
}

fn stored_receipt(
    transaction: &Transaction<'_>,
    verified: &VerifiedOperationTransaction,
) -> Result<Option<NormalizedMutationReceiptV1>, NormalizedSqliteError> {
    let receipt = transaction
        .query_row(
            "SELECT transaction_digest, actor_id, member_count, first_counter,
                    last_counter, committed_operation_id, committed_chain_digest,
                    previous_revision, committed_revision, committed_at
             FROM library_transactions WHERE transaction_id = ?1;",
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
                })
            },
        )
        .optional()?;
    if let Some(receipt) = &receipt {
        if receipt.transaction_digest != verified.transaction_digest
            || receipt.actor_id != verified.actor_id
            || receipt.member_count != verified.members.len()
        {
            return Err(JournalError::TransactionReplayConflict {
                transaction_id: verified.transaction_id.clone(),
            }
            .into());
        }
    }
    Ok(receipt)
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
                return Err(JournalError::UnknownCausalTip {
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
    let current_operation_id = transaction
        .query_row(program.current_clock_sql, [&member.entity_id], |row| {
            row.get::<_, String>(0)
        })
        .optional()?;
    if current_read_at.is_some() != current_operation_id.is_some() {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized read field clock is inconsistent",
        ));
    }
    let wins = current_read_at.is_none_or(|current| {
        read_at < current
            || (read_at == current
                && current_operation_id
                    .as_deref()
                    .is_none_or(|operation| member.operation_id.as_str() < operation))
    });
    if wins {
        transaction.execute(
            program.materialize_sql,
            params![read_at, committed_at, member.entity_id],
        )?;
        transaction.execute(
            program.field_clock_sql,
            params![
                member.entity_id,
                verified.actor_id,
                member.actor_sequence,
                member.operation_id,
                committed_at,
            ],
        )?;
    }
    Ok(())
}

pub fn accept_normalized_operation_transaction_v1(
    connection: &mut Connection,
    canonical_envelopes: &[Vec<u8>],
    committed_at: i64,
) -> Result<NormalizedMutationReceiptV1, NormalizedSqliteError> {
    if !(0..=MAX_SAFE_INTEGER).contains(&committed_at) {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized mutation commit time is invalid",
        ));
    }
    let verified = verify_operation_transaction(canonical_envelopes, |identity| {
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
    require_writer_admission(&transaction, &verified)?;
    let actor = actor_state_at(
        &transaction,
        &OperationIdentity {
            library_id: verified.library_id.clone(),
            epoch_id: verified.epoch_id.clone(),
            actor_id: verified.actor_id.clone(),
        },
    )?;
    if actor.capability != verified.actor_capability {
        return Err(JournalError::InvalidVerifiedInput {
            field: "actor_capability_changed",
        }
        .into());
    }
    if let Some(receipt) = stored_receipt(&transaction, &verified)? {
        transaction.commit()?;
        return Ok(receipt);
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
        return Err(JournalError::StaleActorTip {
            actor_id: verified.actor_id.clone(),
        }
        .into());
    }
    require_causal_tips(&transaction, &verified)?;
    for member in &verified.members {
        let exists: bool =
            transaction.query_row(program.target_exists_sql, [&member.entity_id], |row| {
                row.get(0)
            })?;
        if !exists {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized read mutation target does not exist",
            ));
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
        materialize_read_assignment(&transaction, &verified, member_index, committed_at, program)?;
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
        return Err(JournalError::StaleActorTip {
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
    };
    transaction.commit()?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_journal::actor_capability::legacy_editor_operation_types;
    use crate::library_core_journal::operation_verifier::tests::{enrollment, signed_envelopes};
    use crate::normalized_sqlite::install_normalized_schema_v1;
    use ring::rand::SystemRandom;
    use ring::signature::Ed25519KeyPair;

    fn fixture() -> (
        Connection,
        Ed25519KeyPair,
        crate::library_core_journal::VerifiedActorEnrollment,
    ) {
        let random = SystemRandom::new();
        let key_bytes = Ed25519KeyPair::generate_pkcs8(&random).expect("actor key bytes");
        let key_pair = Ed25519KeyPair::from_pkcs8(key_bytes.as_ref()).expect("actor key");
        let enrollment = enrollment(&key_pair);
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
                    "6".repeat(64),
                    "7".repeat(64),
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
                  scope_mode, certificate_digest, canonical_certificate, issued_at)
                 VALUES (?1, ?2, 1, 'legacy_editor', 'legacy_editor', ?1, '{}', 1000);",
                params![
                    enrollment.enrollment_certificate_digest,
                    enrollment.actor_id
                ],
            )
            .expect("capability");
        for operation in legacy_editor_operation_types() {
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

    #[test]
    fn signed_read_transaction_commits_every_normalized_effect_and_exact_retry() {
        let (mut connection, key_pair, enrollment) = fixture();
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &envelopes, 2_000)
                .expect("commit");
        assert_eq!(receipt.member_count, 2);
        assert_eq!(receipt.previous_revision, 0);
        assert_eq!(receipt.committed_revision, 1);
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
            accept_normalized_operation_transaction_v1(&mut connection, &envelopes, 2_001)
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
    }

    #[test]
    fn signature_failure_and_lost_writer_admission_cannot_mutate_or_replay() {
        let (mut connection, key_pair, enrollment) = fixture();
        let mut tampered = signed_envelopes(&key_pair, &enrollment);
        tampered[0][0] ^= 1;
        assert!(
            accept_normalized_operation_transaction_v1(&mut connection, &tampered, 2_000).is_err()
        );
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
        accept_normalized_operation_transaction_v1(&mut connection, &envelopes, 2_000)
            .expect("commit");
        connection
            .execute(
                "UPDATE library_writer_admission SET active_writer_id = 'writer-2';",
                [],
            )
            .expect("lose admission");
        let error = accept_normalized_operation_transaction_v1(&mut connection, &envelopes, 2_001)
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
}
