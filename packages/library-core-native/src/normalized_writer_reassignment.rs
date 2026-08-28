use crate::library_core_actor_capability::ActorCapabilityScope;
use crate::library_core_actor_enrollment::{
    prepare_normalized_primary_actor_enrollment_v2, ActorKeyStore,
};
use crate::library_core_authority_genesis::{
    prepare_writer_epoch_reassignment, AuthorityKeyStore, WriterEpochReassignment,
};
use crate::normalized_authority::{NormalizedAuthorityStateV2, NormalizedCausalTipV1};
use crate::normalized_sqlite::{describe_normalized_checkpoint_export_v2, NormalizedSqliteError};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::BTreeMap;

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn source_control_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.as_object()?.get(field)?.as_str()
}

pub(crate) fn current_authority(
    connection: &Connection,
) -> Result<(NormalizedAuthorityStateV2, String, String, i64), NormalizedSqliteError> {
    let (
        library_id,
        epoch,
        epoch_id,
        authority_key_id,
        authority_public_key,
        certificate,
        generation,
        manifest_generation,
    ): (String, i64, String, String, String, String, String, i64) = connection.query_row(
        "SELECT epoch.library_id, epoch.epoch_number, epoch.epoch_id,
                epoch.authority_key_id, epoch.authority_public_key,
                epoch.canonical_transition_certificate,
                generation.generation_id, active.accepted_manifest_generation
         FROM library_active_authority AS active
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         JOIN library_meta AS meta
           ON meta.singleton_id = 1
          AND meta.library_id = active.library_id
          AND meta.authority_epoch = active.epoch_id
         JOIN library_materialization_generation AS generation
           ON generation.singleton_id = meta.singleton_id
         WHERE active.active_key = 'active';",
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
    )?;
    let mut frontier = BTreeMap::<String, NormalizedCausalTipV1>::new();
    let mut statement = connection.prepare(
        "SELECT actor_id, accepted_counter, accepted_operation_id, accepted_chain_digest
         FROM library_authority_frontier WHERE epoch_id = ?1 ORDER BY actor_id;",
    )?;
    let rows = statement.query_map([&epoch_id], |row| {
        Ok(NormalizedCausalTipV1 {
            actor_id: row.get(0)?,
            sequence: row.get(1)?,
            operation_id: row.get(2)?,
            chain_digest: row.get(3)?,
        })
    })?;
    for row in rows {
        let tip = row?;
        frontier.insert(tip.actor_id.clone(), tip);
    }
    drop(statement);
    let mut statement = connection.prepare(
        "SELECT actor_id, accepted_counter, accepted_operation_id, accepted_chain_digest
         FROM library_actors
         WHERE authority_epoch_id = ?1 AND retired_at IS NULL AND accepted_counter > 0
         ORDER BY actor_id;",
    )?;
    let rows = statement.query_map([&epoch_id], |row| {
        Ok(NormalizedCausalTipV1 {
            actor_id: row.get(0)?,
            sequence: row.get(1)?,
            operation_id: row.get(2)?,
            chain_digest: row.get(3)?,
        })
    })?;
    for row in rows {
        let tip = row?;
        frontier.insert(tip.actor_id.clone(), tip);
    }
    Ok((
        NormalizedAuthorityStateV2 {
            library_id,
            epoch,
            epoch_id,
            authority_key_id,
            authority_public_key,
            observed_frontier: frontier.into_values().collect(),
        },
        certificate,
        generation,
        manifest_generation,
    ))
}

pub fn reassign_normalized_writer_epoch_v2(
    connection: &mut Connection,
    canonical_source_control_json: &str,
    target_writer_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    accepted_at: i64,
) -> Result<WriterEpochReassignment, NormalizedSqliteError> {
    if !valid_sha256(target_writer_id) || !valid_sha256(installation_witness) || accepted_at < 0 {
        return Err(invalid("normalized writer reassignment request is invalid"));
    }
    let source_control: Value = serde_json::from_str(canonical_source_control_json)
        .map_err(|_| invalid("normalized writer source control is invalid"))?;
    let (current, current_certificate, generation, manifest_generation) =
        current_authority(connection)?;
    let prepared = prepare_writer_epoch_reassignment(
        &current,
        &current_certificate,
        canonical_source_control_json,
        target_writer_id,
        authority_store,
    )
    .map_err(|_| invalid("normalized writer reassignment certificate is invalid"))?;
    if prepared.authority.epoch_id == current.epoch_id {
        let selected_actor: Option<String> = connection
            .query_row(
                "SELECT actor_id FROM library_actors
                 WHERE authority_epoch_id = ?1 AND actor_kind = 'desktop'
                   AND retired_at IS NULL;",
                [&current.epoch_id],
                |row| row.get(0),
            )
            .optional()?;
        if selected_actor.as_deref() != Some(target_writer_id) {
            return Err(invalid(
                "normalized writer reassignment replay is incomplete",
            ));
        }
        return Ok(prepared);
    }
    let snapshot = describe_normalized_checkpoint_export_v2(connection)?;
    if source_control_field(&source_control, "libraryId") != Some(snapshot.library_id.as_str())
        || source_control_field(&source_control, "storageEpoch")
            != Some(snapshot.authority_epoch.as_str())
        || source_control_field(&source_control, "writerId") != Some(snapshot.writer_id.as_str())
        || source_control_field(&source_control, "causalFrontierDigest")
            != Some(snapshot.causal_frontier_digest.as_str())
    {
        return Err(invalid(
            "normalized writer source control does not match local authority",
        ));
    }
    let enrollment = prepare_normalized_primary_actor_enrollment_v2(
        &prepared.authority,
        installation_witness,
        actor_store,
        authority_store,
        accepted_at,
    )
    .map_err(|_| invalid("normalized target writer enrollment failed"))?;
    if enrollment.actor_id != target_writer_id {
        return Err(invalid(
            "normalized target writer does not match this installation",
        ));
    }
    let (scope_mode, scope_kind, scope_id) = match &enrollment.capability.scope {
        ActorCapabilityScope::LibraryWide => {
            ("library_wide", Option::<&str>::None, Option::<&str>::None)
        }
        _ => return Err(invalid("normalized target writer capability is invalid")),
    };

    let transaction = connection.transaction()?;
    if describe_normalized_checkpoint_export_v2(&transaction)? != snapshot {
        return Err(invalid(
            "normalized Library changed during writer reassignment",
        ));
    }
    let existing_epoch: Option<String> = transaction
        .query_row(
            "SELECT canonical_transition_certificate FROM library_authority_epochs
             WHERE epoch_id = ?1;",
            [&prepared.authority.epoch_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(certificate) = existing_epoch {
        if certificate != prepared.canonical_certificate_json {
            return Err(invalid("normalized writer reassignment replay changed"));
        }
    } else {
        transaction.execute(
            "INSERT INTO library_authority_epochs
             (epoch_id, library_id, epoch_number, authority_key_id,
              authority_public_key, transition_certificate_digest,
              canonical_transition_certificate, accepted_manifest_generation,
              checkpoint_frontier_digest, materialized_state_digest, accepted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10);",
            params![
                prepared.authority.epoch_id,
                prepared.authority.library_id,
                prepared.authority.epoch,
                prepared.authority.authority_key_id,
                prepared.authority.authority_public_key,
                prepared.transition_certificate_digest,
                prepared.canonical_certificate_json,
                snapshot.causal_frontier_digest,
                generation,
                accepted_at,
            ],
        )?;
        if prepared.authority.observed_frontier.len() > 1_000 {
            return Err(invalid("normalized writer frontier exceeds its bound"));
        }
        for (ordinal, tip) in prepared.authority.observed_frontier.iter().enumerate() {
            transaction.execute(
                "INSERT INTO library_authority_frontier
                 (epoch_id, ordinal, actor_id, accepted_counter,
                  accepted_operation_id, accepted_chain_digest)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
                params![
                    prepared.authority.epoch_id,
                    i64::try_from(ordinal)
                        .map_err(|_| invalid("normalized writer frontier is invalid"))?,
                    tip.actor_id,
                    tip.sequence,
                    tip.operation_id,
                    tip.chain_digest,
                ],
            )?;
        }
        let updated = transaction.execute(
            "UPDATE library_active_authority
             SET epoch_id = ?1, writer_id = 'primary:desktop',
                 accepted_manifest_generation = 0, activated_at = ?2
             WHERE active_key = 'active' AND library_id = ?3 AND epoch_id = ?4;",
            params![
                prepared.authority.epoch_id,
                accepted_at,
                prepared.authority.library_id,
                current.epoch_id,
            ],
        )?;
        if updated != 1 {
            return Err(invalid(
                "normalized active authority changed during reassignment",
            ));
        }
        let admission_generation: Option<i64> = transaction
            .query_row(
                "SELECT observed_manifest_generation FROM library_writer_admission
                 WHERE singleton_id = 1;",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match admission_generation {
            Some(generation) if generation == manifest_generation => {
                transaction.execute(
                    "UPDATE library_writer_admission
                     SET local_writer_id = 'primary:desktop',
                         active_writer_id = 'primary:desktop',
                         observed_manifest_generation = 0, observed_at = ?1
                     WHERE singleton_id = 1;",
                    [accepted_at],
                )?;
            }
            None => {
                transaction.execute(
                    "INSERT INTO library_writer_admission
                     (singleton_id, local_writer_id, active_writer_id,
                      observed_manifest_generation, observed_at)
                     VALUES (1, 'primary:desktop', 'primary:desktop', 0, ?1);",
                    [accepted_at],
                )?;
            }
            Some(_) => {
                return Err(invalid(
                    "normalized writer admission changed during reassignment",
                ));
            }
        }
        let updated = transaction.execute(
            "UPDATE library_meta SET authority_epoch = ?1, updated_at = ?2
             WHERE singleton_id = 1 AND authority_epoch = ?3;",
            params![prepared.authority.epoch_id, accepted_at, current.epoch_id],
        )?;
        if updated != 1 {
            return Err(invalid(
                "normalized Library metadata changed during reassignment",
            ));
        }
        transaction.execute(
            "DELETE FROM library_actor_capabilities WHERE actor_id = ?1;",
            [&enrollment.actor_id],
        )?;
        let actor_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_actors WHERE actor_id = ?1);",
            [&enrollment.actor_id],
            |row| row.get(0),
        )?;
        if actor_exists {
            let updated = transaction.execute(
                "UPDATE library_actors
                 SET authority_epoch_id = ?2, actor_kind = 'desktop', public_key = ?3,
                     enrollment_operation_id = ?4, enrollment_certificate_digest = ?5,
                     canonical_enrollment_certificate = ?6, chain_genesis_digest = ?7,
                     accepted_counter = 0, accepted_operation_id = NULL,
                     accepted_chain_digest = ?7, retired_at = NULL,
                     created_at = ?8, updated_at = ?8
                 WHERE actor_id = ?1;",
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
            if updated != 1 {
                return Err(invalid(
                    "normalized target writer changed during reassignment",
                ));
            }
        } else {
            let inserted = transaction.execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  created_at, updated_at)
                 VALUES (?1, ?2, 'desktop', ?3, ?4, ?5, ?6, ?7, 0, NULL, ?7, ?8, ?8);",
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
            if inserted != 1 {
                return Err(invalid("normalized target writer was not enrolled"));
            }
        }
        let inserted = transaction.execute(
            "INSERT INTO library_actor_capabilities
             (capability_id, actor_id, certificate_version, actor_class,
              scope_mode, scope_kind, scope_id, issuance_identity,
              retirement_identity, certificate_digest, canonical_certificate,
              issued_at, retired_at, retirement_certificate_digest)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?1, ?10, ?11, NULL, NULL);",
            params![
                enrollment.capability.capability_certificate_digest,
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
        if inserted != 1 {
            return Err(invalid(
                "normalized target writer capability was not installed",
            ));
        }
        for mutation_id in &enrollment.capability.allowed_operation_types {
            transaction.execute(
                "INSERT INTO library_actor_capability_mutations
                 (capability_id, mutation_id) VALUES (?1, ?2);",
                params![
                    enrollment.capability.capability_certificate_digest,
                    mutation_id
                ],
            )?;
        }
    }
    let selected: (String, String, String) = transaction.query_row(
        "SELECT active.epoch_id, actor.actor_id, epoch.canonical_transition_certificate
         FROM library_active_authority AS active
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         JOIN library_actors AS actor
           ON actor.authority_epoch_id = active.epoch_id
          AND actor.actor_kind = 'desktop' AND actor.retired_at IS NULL
         WHERE active.active_key = 'active';",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if selected.0 != prepared.authority.epoch_id
        || selected.1 != target_writer_id
        || selected.2 != prepared.canonical_certificate_json
    {
        return Err(invalid("normalized writer reassignment is incomplete"));
    }
    transaction.commit()?;
    Ok(prepared)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_actor_enrollment::prepare_normalized_primary_actor_enrollment_v2;
    use crate::{install_normalized_schema_v1, prepare_fresh_normalized_desktop_library_v1};
    use ring::rand::SystemRandom;
    use ring::signature::Ed25519KeyPair;
    use serde_json::json;

    struct TestAuthorityKeyStore(Vec<u8>);

    impl AuthorityKeyStore for TestAuthorityKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }

        fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
            Err("test store is read only".to_owned())
        }
    }

    struct TestActorKeyStore(Vec<u8>);

    impl ActorKeyStore for TestActorKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }

        fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
            Err("test store is read only".to_owned())
        }
    }

    fn generated_key() -> Vec<u8> {
        Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
            .expect("generate key")
            .as_ref()
            .to_vec()
    }

    #[test]
    fn normalized_writer_reassignment_is_one_exact_replayable_epoch_transition() {
        let authority_store = TestAuthorityKeyStore(generated_key());
        let remote_actor_store = TestActorKeyStore(generated_key());
        let local_actor_store = TestActorKeyStore(generated_key());
        let remote_witness = "7".repeat(64);
        let local_witness = "8".repeat(64);
        let mut connection = Connection::open_in_memory().expect("open database");
        install_normalized_schema_v1(&connection).expect("install schema");
        prepare_fresh_normalized_desktop_library_v1(
            &mut connection,
            &remote_witness,
            &remote_actor_store,
            &authority_store,
            1_000,
        )
        .expect("prepare remote authority");

        let source = describe_normalized_checkpoint_export_v2(&connection)
            .expect("describe source checkpoint");
        let (current, _, _, _) = current_authority(&connection).expect("read authority");
        let local_enrollment = prepare_normalized_primary_actor_enrollment_v2(
            &current,
            &local_witness,
            &local_actor_store,
            &authority_store,
            2_000,
        )
        .expect("prepare local identity");
        assert_ne!(source.writer_id, local_enrollment.actor_id);
        let source_control = serde_json::to_string(&json!({
            "causalFrontierDigest": source.causal_frontier_digest,
            "generation": 4,
            "libraryId": source.library_id,
            "storageEpoch": source.authority_epoch,
            "writerId": source.writer_id,
        }))
        .expect("canonical source control");
        connection
            .execute("DELETE FROM library_writer_admission;", [])
            .expect("model an imported checkpoint without device admission");

        let first = reassign_normalized_writer_epoch_v2(
            &mut connection,
            &source_control,
            &local_enrollment.actor_id,
            &local_witness,
            &local_actor_store,
            &authority_store,
            2_000,
        )
        .expect("reassign normalized writer");
        let selected = describe_normalized_checkpoint_export_v2(&connection)
            .expect("describe reassigned checkpoint");
        assert_eq!(selected.writer_id, local_enrollment.actor_id);
        assert_eq!(selected.authority_epoch, first.authority.epoch_id);
        assert_ne!(selected.authority_epoch, source.authority_epoch);
        assert_eq!(
            connection
                .query_row(
                    "SELECT local_writer_id, active_writer_id,
                            observed_manifest_generation
                     FROM library_writer_admission WHERE singleton_id = 1;",
                    [],
                    |row| Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    )),
                )
                .expect("imported writer admission"),
            ("primary:desktop".into(), "primary:desktop".into(), 0)
        );
        assert_ne!(
            selected.causal_frontier_digest,
            source.causal_frontier_digest
        );
        let carried_frontier: String = connection
            .query_row(
                "SELECT checkpoint_frontier_digest FROM library_authority_epochs
                 WHERE epoch_id = ?1;",
                [&selected.authority_epoch],
                |row| row.get(0),
            )
            .expect("read carried frontier");
        assert_eq!(carried_frontier, source.causal_frontier_digest);

        let replay = reassign_normalized_writer_epoch_v2(
            &mut connection,
            &source_control,
            &local_enrollment.actor_id,
            &local_witness,
            &local_actor_store,
            &authority_store,
            3_000,
        )
        .expect("replay normalized writer reassignment");
        assert_eq!(replay.authority, first.authority);
        assert_eq!(
            replay.canonical_certificate_json,
            first.canonical_certificate_json
        );
        assert_eq!(
            replay.transition_certificate_digest,
            first.transition_certificate_digest
        );
    }
}
