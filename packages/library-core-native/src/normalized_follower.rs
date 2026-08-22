use crate::normalized_sqlite::NormalizedSqliteError;
use crate::{
    countersign_actor_enrollment_request_bytes,
    library_core_actor_enrollment::{
        prepare_normalized_follower_actor_enrollment_request_v2, ActorKeyStore,
    },
    library_core_authority_genesis::AuthorityKeyStore,
    library_core_journal::{verify_actor_enrollment_certificate, VerifiedActorEnrollment},
    normalized_primary_mutation_context_v1,
    normalized_writer_reassignment::current_authority,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

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
    use crate::{
        describe_normalized_checkpoint_export_v2, install_normalized_schema_v1,
        prepare_fresh_normalized_desktop_library_v1,
    };
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
