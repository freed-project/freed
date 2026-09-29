//! Device-local recovery archive. Archival never re-signs or submits old edits.
use crate::library_core_actor_enrollment::{load_actor_key_pair, ActorKeyStore};
use crate::library_core_canonical::encode_canonical_value;
use crate::library_core_hash::lower_hex;
use crate::normalized_handoff_certificate::{canonical_handoff_bytes, HandoffPredecessorV1};
use crate::normalized_handoff_writer_certificate::{
    verify_writer_handoff_certificate_v1, WriterHandoffCertificateV1,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::signature::KeyPair;
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension};
use serde_json::json;
use sha2::{Digest, Sha256};

/// Persist an exact archive and the consumer lifecycle in one FULL transaction.
/// Active local rows remain intact until a later explicit recovery commit.
/// Returning an archive ID is not permission to replay its old signed intents.
pub fn archive_consumer_epoch_recovery_v1(
    connection: &mut Connection,
    actor_store: &dyn ActorKeyStore,
    created_at: u64,
) -> Result<String, String> {
    if !connection.is_autocommit() || created_at > 9_007_199_254_740_991 {
        return Err("consumer recovery transaction or timestamp is invalid".into());
    }
    let durability: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if durability < 2 {
        return Err("consumer recovery requires full SQLite durability".into());
    }
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
    let (library, old_epoch, actor, actor_public, request_digest): (String, String, String, String, String) = tx.query_row(
        "SELECT library_id, authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest FROM library_follower_actor_request WHERE singleton_id = 1;", [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).map_err(|_| "consumer recovery requires the previous enrollment")?;
    let (new_epoch, certificate_json, certificate_digest): (String, String, String) = tx.query_row(
        "SELECT epoch.epoch_id, epoch.canonical_transition_certificate, epoch.transition_certificate_digest
         FROM library_meta AS meta JOIN library_authority_epochs AS epoch ON epoch.epoch_id = meta.authority_epoch
         JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1 AND receipt.authority_epoch_id = epoch.epoch_id
         WHERE meta.singleton_id = 1 AND meta.library_id = ?1 AND receipt.library_id = ?1;", [&library],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|_| "consumer recovery requires the accepted successor checkpoint")?;
    if new_epoch == old_epoch {
        return Err("consumer enrollment has not changed authority".into());
    }
    let certificate: WriterHandoffCertificateV1 = serde_json::from_str(&certificate_json)
        .map_err(|_| "consumer successor proof is invalid")?;
    if canonical_handoff_bytes(&certificate)? != certificate_json.as_bytes()
        || certificate.epoch_id != new_epoch
        || crate::normalized_writer_certificate::digest_value(
            "epoch-transition-certificate",
            &serde_json::to_value(&certificate).map_err(|e| e.to_string())?,
        )? != certificate_digest
    {
        return Err("consumer successor proof identity changed".into());
    }
    let grant = &certificate.certificate_body.handoff_authorization;
    if grant.body.readiness.body.predecessor_epoch_id != old_epoch {
        return Err("consumer recovery requires the direct authorized successor".into());
    }
    let (number, digest, key): (u64, String, String) = tx.query_row(
        "SELECT epoch_number, transition_certificate_digest, authority_public_key FROM library_authority_epochs WHERE library_id = ?1 AND epoch_id = ?2;",
        params![library, old_epoch], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|_| "consumer predecessor proof is missing")?;
    verify_writer_handoff_certificate_v1(
        &certificate,
        &HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &old_epoch,
            epoch: number,
            certificate_digest: &digest,
            authority_public_key: &key,
            writer_id: &grant.body.source_control.writer_id,
        },
        &grant.body.readiness.body.target_actor_public_key,
    )?;
    let actor_key = load_actor_key_pair(actor_store, &library)?;
    if lower_hex(actor_key.public_key().as_ref()) != actor_public {
        return Err("consumer recovery requires the original actor key".into());
    }
    let identity = canonical_handoff_bytes(&json!({"library": library, "oldEpoch": old_epoch,
        "newEpoch": new_epoch, "actor": actor, "request": request_digest}))?;
    let recovery_id = lower_hex(&Sha256::digest(identity));
    let version: u32 = tx
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version == crate::sqlite_contract_generated::NATIVE_STORAGE_SCHEMA_VERSION {
        let matching: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'consumer' AND phase = 'recovery' AND handoff_id = ?1 AND library_id = ?2 AND predecessor_epoch_id = ?3 AND successor_epoch_id = ?4 AND canonical_authorization = ?5);",
            params![grant.body.readiness.handoff_id, library, old_epoch, new_epoch, canonical_handoff_bytes(grant)?], |r| r.get(0)).map_err(|e| e.to_string())?;
        if matching {
            let existing: Option<String> = tx
            .query_row(
                "SELECT recovery_id FROM library_local_recovery_archives WHERE recovery_id = ?1 AND library_id = ?2 AND predecessor_epoch_id = ?3 AND successor_epoch_id = ?4 AND actor_id = ?5 AND schema_sha256 = ?6;",
                params![recovery_id, library, old_epoch, new_epoch, actor, crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
            if let Some(id) = existing {
                verify_archive(&tx, &id)?;
                tx.commit().map_err(|e| e.to_string())?;
                return Ok(id);
            }
            return Err("consumer recovery archive is missing".into());
        }
        let cancelled_target: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'target' AND phase = 'cancelled');", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if cancelled_target {
            if !crate::normalized_handoff_cancellation::verify_cancelled_target_history_v1(&tx)? {
                return Err("canceled target has no accepted successor".into());
            }
            let removed = tx.execute("DELETE FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'target' AND phase = 'cancelled' AND library_id = ?1 AND predecessor_epoch_id = ?2 AND updated_at <= ?3;",
                params![library, old_epoch, created_at]).map_err(|e| e.to_string())?;
            if removed != 1 {
                return Err("canceled target changed before archival".into());
            }
        } else {
            let previous = completed_consumer_cycle_before_current(&tx)?
                .ok_or("consumer recovery cannot replace another lifecycle fence")?;
            // The prior archive belongs to the previous actor incarnation. Its live
            // rows have legitimately changed, but every archived byte must still verify.
            verify_archive_contents(&tx, &previous, false)?;
            let removed = tx
                .execute(
                    "DELETE FROM library_local_handoff WHERE singleton_id = 1
             AND installation_role = 'consumer' AND phase = 'following'
             AND library_id = ?1 AND successor_epoch_id = ?2 AND updated_at <= ?3;",
                    params![library, old_epoch, created_at],
                )
                .map_err(|e| e.to_string())?;
            if removed != 1 {
                return Err("consumer completed lifecycle changed before archival".into());
            }
        }
    }
    crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO library_local_handoff (singleton_id, handoff_id, library_id, installation_role, phase,
        predecessor_epoch_id, successor_epoch_id, target_writer_id, target_authority_public_key,
        canonical_readiness, canonical_authorization_body, canonical_authorization, expected_control_revision, created_at, updated_at)
        VALUES (1, ?1, ?2, 'consumer', 'recovery', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11);",
        params![grant.body.readiness.handoff_id, library, old_epoch, new_epoch, certificate.certificate_body.target_writer_id,
            certificate.certificate_body.target_authority_public_key, canonical_handoff_bytes(&grant.body.readiness)?,
            canonical_handoff_bytes(&grant.body)?, canonical_handoff_bytes(grant)?, grant.body.source_control_revision, created_at]).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO library_local_recovery_archives (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8);",
        params![
            recovery_id,
            library,
            old_epoch,
            new_epoch,
            actor,
            crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256,
            "0".repeat(64),
            created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    archive_live_follower_rows(&tx, &recovery_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(recovery_id)
}

/// Stream one immutable copy inside the caller's lifecycle transaction. Both
/// ordinary recovery and promotion must preserve the same complete local state.
fn archive_live_follower_rows(
    tx: &rusqlite::Transaction<'_>,
    recovery_id: &str,
) -> Result<(), String> {
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut intent_counts = [0u64; 2];
    for table in crate::normalized_import::RETAINED_FOLLOWER_TABLES {
        let mut metadata = tx
            .prepare(&format!("PRAGMA table_info({table});"))
            .map_err(|e| e.to_string())?;
        let columns = metadata
            .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, u32>(5)?)))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        let mut keys = columns
            .iter()
            .filter(|(_, order)| *order > 0)
            .collect::<Vec<_>>();
        keys.sort_by_key(|(_, order)| *order);
        if keys.is_empty() {
            return Err("consumer recovery table has no stable key".into());
        }
        let order = keys
            .iter()
            .map(|(name, _)| format!("\"{name}\""))
            .collect::<Vec<_>>()
            .join(",");
        let names = columns.iter().map(|(name, _)| name).collect::<Vec<_>>();
        let columns_json = String::from_utf8(
            encode_canonical_value(&json!(names), 16_384)
                .map_err(|_| "consumer recovery column names exceed their bound")?,
        )
        .map_err(|e| e.to_string())?;
        let mut statement = tx
            .prepare(&format!("SELECT * FROM {table} ORDER BY {order};"))
            .map_err(|e| e.to_string())?;
        let mut rows = statement.query([]).map_err(|e| e.to_string())?;
        let mut ordinal = 0u64;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            if *table == "library_intent_transactions" {
                let state_index = columns
                    .iter()
                    .position(|(name, _)| name == "state")
                    .ok_or("consumer archive intent state column is missing")?;
                count_intent_state(
                    &row.get::<_, String>(state_index)
                        .map_err(|e| e.to_string())?,
                    &mut intent_counts,
                )?;
            }
            let bytes = encode_recovery_row(row, columns.len())?;
            let row_digest = lower_hex(&Sha256::digest(&bytes));
            let transaction_id: Option<String> = columns
                .iter()
                .position(|(name, _)| name == "transaction_id")
                .map(|index| row.get(index))
                .transpose()
                .map_err(|e| e.to_string())?;
            let commitment = canonical_handoff_bytes(&json!([
                table,
                ordinal,
                columns_json,
                row_digest,
                transaction_id
            ]))?;
            digest.update((commitment.len() as u64).to_be_bytes());
            digest.update(commitment);
            tx.execute(
                "INSERT INTO library_local_recovery_rows (recovery_id, table_key, row_ordinal, columns_json, canonical_row, row_digest, transaction_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
                params![recovery_id, table, ordinal, columns_json, bytes, row_digest, transaction_id],
            )
            .map_err(|e| e.to_string())?;
            ordinal += 1;
            total += 1;
        }
    }
    tx.execute("UPDATE library_local_recovery_archives SET row_count = ?2, archive_digest = ?3, pending_intent_count = ?4, published_intent_count = ?5 WHERE recovery_id = ?1;",
        params![recovery_id, total, lower_hex(&digest.finalize()), intent_counts[0], intent_counts[1]]).map_err(|e| e.to_string())?;
    verify_archive(tx, recovery_id)?;
    Ok(())
}

/// Retire settled consumer slots only with verified target activation. The
/// existing signed handoff ID identifies this installation-local archive.
/// The caller owns the FULL activation transaction and its admission fence.
pub(crate) fn archive_promoted_consumer_in_transaction(
    tx: &rusqlite::Transaction<'_>,
    handoff_id: &str,
    created_at: u64,
) -> Result<(), String> {
    let (library, old_epoch, new_epoch, actor): (String, String, String, String) = tx.query_row(
        "SELECT handoff.library_id, handoff.predecessor_epoch_id, handoff.successor_epoch_id,
                handoff.target_writer_id
         FROM library_local_handoff AS handoff
         JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = handoff.library_id
          AND meta.authority_epoch = handoff.successor_epoch_id
         JOIN library_follower_actor_request AS request ON request.singleton_id = 1
          AND request.library_id = handoff.library_id AND request.authority_epoch_id = handoff.predecessor_epoch_id
          AND request.actor_id = handoff.target_writer_id
         JOIN library_actors AS actor ON actor.actor_id = request.actor_id
          AND actor.authority_epoch_id = meta.authority_epoch AND actor.public_key = request.actor_public_key
          AND actor.actor_kind = 'desktop' AND actor.retired_at IS NULL
         WHERE handoff.singleton_id = 1 AND handoff.handoff_id = ?1
          AND handoff.installation_role = 'target' AND handoff.phase = 'cas_pending';",
        [handoff_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|_| "promotion archive requires the retained enrolled consumer")?;
    let settled: bool = tx.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM library_intent_transactions WHERE state IN ('pending', 'published') OR actor_id != ?1 OR intent_epoch_id != ?2)
          AND NOT EXISTS(SELECT 1 FROM library_intent_actors WHERE actor_id != ?1)
          AND NOT EXISTS(SELECT 1 FROM library_optimistic_fields)
          AND NOT EXISTS(SELECT 1 FROM library_writer_admission)
          AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);",
        params![actor, old_epoch], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if !settled {
        return Err(
            "promotion archive requires settled consumer history and closed admission".into(),
        );
    }
    tx.execute(
        "INSERT INTO library_local_recovery_archives
         (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8);",
        params![handoff_id, library, old_epoch, new_epoch, actor,
            crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256, "0".repeat(64), created_at],
    ).map_err(|e| e.to_string())?;
    archive_live_follower_rows(tx, handoff_id)?;
    for table in crate::normalized_import::RETAINED_FOLLOWER_TABLES
        .iter()
        .rev()
    {
        // Keep query invalidation sequences monotonic across the role change.
        if matches!(
            *table,
            "library_local_change_state" | "library_local_invalidations"
        ) {
            continue;
        }
        tx.execute(&format!("DELETE FROM {table};"), [])
            .map_err(|e| e.to_string())?;
    }
    // The old checkpoint receipt is not authority for the newly active Primary.
    tx.execute("DELETE FROM library_follower_checkpoint_receipt;", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Prepare and durably retain a new incarnation's request without retiring any
/// old local rows. Publication and active-slot replacement require a later
/// explicit recovery commit. A retry returns the original signed bytes.
pub fn prepare_consumer_epoch_reenrollment_v1(
    connection: &mut Connection,
    recovery_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    created_at: u64,
) -> Result<crate::normalized_follower::NormalizedFollowerActorRequestV2, String> {
    use crate::library_core_hash::is_lower_sha256;
    use crate::normalized_follower::NormalizedFollowerActorRequestV2;
    if !connection.is_autocommit()
        || !is_lower_sha256(recovery_id)
        || !is_lower_sha256(installation_witness)
        || created_at > 9_007_199_254_740_991
    {
        return Err("consumer reenrollment identity, transaction or time is invalid".into());
    }
    let durability: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if durability < 2 {
        return Err("consumer reenrollment requires full SQLite durability".into());
    }
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
    let (authority, _, _, _) =
        crate::normalized_writer_reassignment::current_authority(&tx).map_err(|e| e.to_string())?;
    type Stored = (
        String,
        String,
        Option<Vec<u8>>,
        Option<String>,
        Option<String>,
    );
    let (old_actor, old_public, receipt, receipt_digest, witness): Stored = tx
        .query_row(
            "SELECT archive.actor_id, request.actor_public_key, archive.reenrollment_receipt,
                archive.reenrollment_digest, archive.reenrollment_installation_witness
         FROM library_local_recovery_archives AS archive
         JOIN library_local_handoff AS handoff ON handoff.singleton_id = 1
          AND handoff.installation_role = 'consumer' AND handoff.phase = 'recovery'
          AND handoff.library_id = archive.library_id
          AND handoff.predecessor_epoch_id = archive.predecessor_epoch_id
          AND handoff.successor_epoch_id = archive.successor_epoch_id
         JOIN library_follower_actor_request AS request ON request.singleton_id = 1
          AND request.library_id = archive.library_id
          AND request.authority_epoch_id = archive.predecessor_epoch_id
          AND request.actor_id = archive.actor_id
         JOIN library_follower_checkpoint_receipt AS checkpoint ON checkpoint.singleton_id = 1
          AND checkpoint.library_id = archive.library_id
          AND checkpoint.authority_epoch_id = archive.successor_epoch_id
         WHERE archive.recovery_id = ?1 AND archive.library_id = ?2
          AND archive.successor_epoch_id = ?3 AND archive.created_at <= ?4;",
            params![
                recovery_id,
                authority.library_id,
                authority.epoch_id,
                created_at
            ],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "consumer reenrollment requires its current archived recovery")?;
    verify_archive(&tx, recovery_id)?;
    let key = load_actor_key_pair(actor_store, &authority.library_id)?;
    if lower_hex(key.public_key().as_ref()) != old_public {
        return Err("consumer reenrollment requires its original actor key".into());
    }
    let expected_actor = crate::library_core_actor_enrollment::recovery_actor_id(
        &authority.library_id,
        installation_witness,
        actor_store,
        recovery_id,
    )?;
    if expected_actor == old_actor {
        return Err("consumer reenrollment must use a distinct actor incarnation".into());
    }
    if let Some(bytes) = receipt {
        if witness.as_deref() != Some(installation_witness)
            || receipt_digest.as_deref() != Some(lower_hex(&Sha256::digest(&bytes)).as_str())
        {
            return Err("consumer reenrollment receipt changed".into());
        }
        let value = crate::library_core_canonical::decode_canonical_value(&bytes, 131_072)
            .map_err(|_| "consumer reenrollment receipt is not canonical")?
            .into_value();
        let request: NormalizedFollowerActorRequestV2 = serde_json::from_value(value)
            .map_err(|_| "consumer reenrollment receipt is invalid")?;
        if request.library_id != authority.library_id
            || request.authority_epoch_id != authority.epoch_id
            || request.actor_id != expected_actor
            || request.actor_public_key != old_public
        {
            return Err("consumer reenrollment receipt identity changed".into());
        }
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(request);
    }
    let prepared = crate::library_core_actor_enrollment::prepare_recovery_actor_request(
        &authority,
        installation_witness,
        actor_store,
        created_at as i64,
        recovery_id,
    )?;
    let request = NormalizedFollowerActorRequestV2 {
        library_id: authority.library_id,
        authority_epoch_id: authority.epoch_id,
        actor_id: prepared.actor_id,
        actor_public_key: prepared.actor_public_key,
        enrollment_request_digest: prepared.enrollment_request_digest,
        canonical_enrollment_request_json: prepared.canonical_enrollment_request_json,
        created_at,
    };
    if request.actor_id != expected_actor || request.actor_public_key != old_public {
        return Err("consumer reenrollment signing identity changed".into());
    }
    let bytes = encode_canonical_value(
        &serde_json::to_value(&request).map_err(|e| e.to_string())?,
        131_072,
    )
    .map_err(|_| "consumer reenrollment receipt exceeds its bound")?;
    let digest = lower_hex(&Sha256::digest(&bytes));
    let changed = tx
        .execute(
            "UPDATE library_local_recovery_archives SET reenrollment_receipt = ?2,
        reenrollment_digest = ?3, reenrollment_installation_witness = ?4
        WHERE recovery_id = ?1 AND reenrollment_receipt IS NULL;",
            params![recovery_id, bytes, digest, installation_witness],
        )
        .map_err(|e| e.to_string())?;
    let readback: (Vec<u8>, String, String) = tx.query_row("SELECT reenrollment_receipt, reenrollment_digest, reenrollment_installation_witness FROM library_local_recovery_archives WHERE recovery_id = ?1;",
        [recovery_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?;
    if changed != 1 || readback != (bytes, digest, installation_witness.to_owned()) {
        return Err("consumer reenrollment receipt readback changed".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(request)
}

/// Retire the archived active slots and install the exact prepared request in
/// one transaction. Old signed edits remain archived, never relabeled or replayed.
pub fn commit_consumer_epoch_reenrollment_v1(
    connection: &mut Connection,
    recovery_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    committed_at: u64,
) -> Result<crate::normalized_follower::NormalizedFollowerActorRequestV2, String> {
    use crate::library_core_hash::is_lower_sha256;
    use crate::normalized_follower::NormalizedFollowerActorRequestV2;
    if !connection.is_autocommit()
        || !is_lower_sha256(recovery_id)
        || !is_lower_sha256(installation_witness)
        || committed_at > 9_007_199_254_740_991
    {
        return Err("consumer recovery commit identity, transaction or time is invalid".into());
    }
    let durability: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if durability < 2 {
        return Err("consumer recovery commit requires full SQLite durability".into());
    }
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
    let (authority, _, _, _) =
        crate::normalized_writer_reassignment::current_authority(&tx).map_err(|e| e.to_string())?;
    let (bytes, digest, witness, prior_commit, phase): (Vec<u8>, String, String, Option<u64>, String) = tx.query_row(
        "SELECT archive.reenrollment_receipt, archive.reenrollment_digest,
                archive.reenrollment_installation_witness, archive.reenrollment_committed_at, handoff.phase
         FROM library_local_recovery_archives AS archive
         JOIN library_local_handoff AS handoff ON handoff.singleton_id = 1
          AND handoff.installation_role = 'consumer' AND handoff.phase IN ('recovery', 'following')
          AND handoff.library_id = archive.library_id
          AND handoff.predecessor_epoch_id = archive.predecessor_epoch_id
          AND handoff.successor_epoch_id = archive.successor_epoch_id
         JOIN library_follower_checkpoint_receipt AS checkpoint ON checkpoint.singleton_id = 1
          AND checkpoint.library_id = archive.library_id AND checkpoint.authority_epoch_id = archive.successor_epoch_id
         WHERE archive.recovery_id = ?1 AND archive.library_id = ?2 AND archive.successor_epoch_id = ?3
          AND archive.created_at <= ?4 AND handoff.updated_at <= ?4;",
        params![recovery_id, authority.library_id, authority.epoch_id, committed_at],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).map_err(|_| "consumer recovery commit requires its prepared successor request")?;
    if witness != installation_witness || lower_hex(&Sha256::digest(&bytes)) != digest {
        return Err("consumer recovery prepared receipt changed".into());
    }
    let value = crate::library_core_canonical::decode_canonical_value(&bytes, 131_072)
        .map_err(|_| "consumer recovery prepared receipt is not canonical")?
        .into_value();
    let request: NormalizedFollowerActorRequestV2 = serde_json::from_value(value)
        .map_err(|_| "consumer recovery prepared receipt is invalid")?;
    let key = load_actor_key_pair(actor_store, &authority.library_id)?;
    if request.library_id != authority.library_id
        || request.authority_epoch_id != authority.epoch_id
        || request.actor_id
            != crate::library_core_actor_enrollment::recovery_actor_id(
                &authority.library_id,
                installation_witness,
                actor_store,
                recovery_id,
            )?
        || request.actor_public_key != lower_hex(key.public_key().as_ref())
        || request.created_at > committed_at
    {
        return Err("consumer recovery prepared signing identity changed".into());
    }
    verify_archive_contents(&tx, recovery_id, prior_commit.is_none())?;
    if prior_commit.is_none() {
        if phase != "recovery" {
            return Err("consumer recovery phase changed before commit".into());
        }
        // Overlay removals retain their normal local invalidations and monotonic
        // sequence. Canonical actors, Library rows and authority are untouched.
        tx.execute_batch(
            "DELETE FROM library_optimistic_fields;
            DELETE FROM library_result_transport_segments;
            DELETE FROM library_result_transport_heads;
            DELETE FROM library_intent_transport_segments;
            DELETE FROM library_intent_transport_heads;
            DELETE FROM library_intent_results;
            DELETE FROM library_intent_result_cursors;
            DELETE FROM library_intent_members;
            DELETE FROM library_intent_transactions;
            DELETE FROM library_intent_actors;
            DELETE FROM library_follower_actor_request;",
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO library_follower_actor_request
            (singleton_id, library_id, authority_epoch_id, actor_id, actor_public_key,
             enrollment_request_digest, canonical_enrollment_request, created_at)
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7);",
            params![
                request.library_id,
                request.authority_epoch_id,
                request.actor_id,
                request.actor_public_key,
                request.enrollment_request_digest,
                request.canonical_enrollment_request_json,
                request.created_at
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("UPDATE library_local_recovery_archives SET reenrollment_committed_at = ?2 WHERE recovery_id = ?1;",
            params![recovery_id, committed_at]).map_err(|e| e.to_string())?;
        tx.execute("UPDATE library_local_handoff SET phase = 'following', updated_at = ?1 WHERE singleton_id = 1;",
            [committed_at]).map_err(|e| e.to_string())?;
    } else if phase != "following" {
        return Err("consumer recovery committed phase changed".into());
    }
    let matches: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM library_follower_actor_request
        WHERE singleton_id = 1 AND library_id = ?1 AND authority_epoch_id = ?2 AND actor_id = ?3
         AND actor_public_key = ?4 AND enrollment_request_digest = ?5
         AND canonical_enrollment_request = ?6 AND created_at = ?7);",
            params![
                request.library_id,
                request.authority_epoch_id,
                request.actor_id,
                request.actor_public_key,
                request.enrollment_request_digest,
                request.canonical_enrollment_request_json,
                request.created_at
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let committed: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_recovery_archives
        WHERE recovery_id = ?1 AND reenrollment_receipt = ?2 AND reenrollment_digest = ?3
         AND reenrollment_installation_witness = ?4 AND reenrollment_committed_at = ?5);",
            params![
                recovery_id,
                bytes,
                digest,
                witness,
                prior_commit.unwrap_or(committed_at)
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !matches || !committed {
        return Err("consumer recovery commit readback changed".into());
    }
    crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&tx)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(request)
}

/// Host-facing preparation resumes the current receipt rather than creating a
/// second recovery after response loss. It never publishes the enrollment.
pub fn prepare_consumer_recovery_v1(
    connection: &mut Connection,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    created_at: u64,
) -> Result<ConsumerRecoverySummaryV1, String> {
    let existing = read_consumer_recovery_summary_v1(connection)?;
    if let Some(summary) = existing
        .as_ref()
        .filter(|summary| summary.state == "following")
    {
        return Ok(summary.clone());
    }
    let id = match existing {
        Some(summary) => summary.recovery_id,
        None => archive_consumer_epoch_recovery_v1(connection, actor_store, created_at)?,
    };
    prepare_consumer_epoch_reenrollment_v1(
        connection,
        &id,
        installation_witness,
        actor_store,
        created_at,
    )?;
    read_consumer_recovery_summary_v1(connection)?
        .ok_or_else(|| "prepared consumer recovery is missing".into())
}

fn count_intent_state(state: &str, counts: &mut [u64; 2]) -> Result<(), String> {
    match state {
        "pending" => counts[0] += 1,
        "published" => counts[1] += 1,
        "accepted" | "rejected" => (),
        _ => return Err("consumer archive intent state is invalid".into()),
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumerRecoverySummaryV1 {
    pub recovery_id: String,
    pub library_id: String,
    pub predecessor_epoch_id: String,
    pub successor_epoch_id: String,
    pub state: &'static str,
    pub archived_pending_edits: u64,
    pub archived_published_edits: u64,
}

/// Classify a completed consumer cycle after a later checkpoint was selected.
/// This bounded metadata read grants no authority and does not replace a fence.
/// The archival writer separately verifies the new successor certificate and
/// the full previous archive before changing the current lifecycle singleton.
fn completed_consumer_cycle_before_current(
    connection: &Connection,
) -> Result<Option<String>, String> {
    use crate::normalized_follower::NormalizedFollowerActorRequestV2;
    type CompletedCycle = (String, Vec<u8>, String, NormalizedFollowerActorRequestV2);
    let mut statement = connection.prepare(
        "SELECT archive.recovery_id, archive.reenrollment_receipt, archive.reenrollment_digest,
                request.library_id, request.authority_epoch_id, request.actor_id,
                request.actor_public_key, request.enrollment_request_digest,
                request.canonical_enrollment_request, request.created_at
         FROM library_local_handoff AS handoff
         JOIN library_local_recovery_archives AS archive
          ON archive.library_id = handoff.library_id
          AND archive.predecessor_epoch_id = handoff.predecessor_epoch_id
          AND archive.successor_epoch_id = handoff.successor_epoch_id
          AND archive.reenrollment_committed_at IS NOT NULL
          AND archive.reenrollment_committed_at <= handoff.updated_at
         JOIN library_follower_actor_request AS request ON request.singleton_id = 1
          AND request.library_id = handoff.library_id
          AND request.authority_epoch_id = handoff.successor_epoch_id
         JOIN library_meta AS meta ON meta.singleton_id = 1
          AND meta.library_id = handoff.library_id AND meta.authority_epoch != handoff.successor_epoch_id
         JOIN library_follower_checkpoint_receipt AS checkpoint ON checkpoint.singleton_id = 1
          AND checkpoint.library_id = meta.library_id AND checkpoint.authority_epoch_id = meta.authority_epoch
         WHERE handoff.singleton_id = 1 AND handoff.installation_role = 'consumer' AND handoff.phase = 'following'
         LIMIT 2;"
    ).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                NormalizedFollowerActorRequestV2 {
                    library_id: row.get(3)?,
                    authority_epoch_id: row.get(4)?,
                    actor_id: row.get(5)?,
                    actor_public_key: row.get(6)?,
                    enrollment_request_digest: row.get(7)?,
                    canonical_enrollment_request_json: row.get(8)?,
                    created_at: row.get(9)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<CompletedCycle>>>()
        .map_err(|e| e.to_string())?;
    let Some((id, bytes, digest, retained)) = rows.first() else {
        return Ok(None);
    };
    if rows.len() != 1 || bytes.len() > 131_072 || lower_hex(&Sha256::digest(bytes)) != *digest {
        return Err("previous consumer recovery receipt is ambiguous or changed".into());
    }
    let value = crate::library_core_canonical::decode_canonical_value(bytes, 131_072)
        .map_err(|_| "previous consumer recovery receipt is not canonical")?
        .into_value();
    let prepared: NormalizedFollowerActorRequestV2 = serde_json::from_value(value)
        .map_err(|_| "previous consumer recovery receipt is invalid")?;
    if prepared != *retained {
        return Err("previous consumer recovery receipt differs from the retained actor".into());
    }
    Ok(Some(id.clone()))
}

/// Locate completed recovery by its exact retained request, independently of
/// the current transfer role. This bounded metadata lookup grants no admission.
fn current_completed_recovery(
    connection: &Connection,
) -> Result<Option<ConsumerRecoverySummaryV1>, String> {
    let (library, epoch): (String, String) = connection
        .query_row(
            "SELECT library_id, authority_epoch FROM library_meta WHERE singleton_id = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let Some(request) = crate::normalized_follower::actor_request(connection, &library, &epoch)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let value = serde_json::to_value(&request).map_err(|e| e.to_string())?;
    let expected = encode_canonical_value(&value, 131_072)
        .map_err(|_| "current recovery request exceeds its canonical bound")?;
    let digest = lower_hex(&Sha256::digest(&expected));
    let mut statement = connection.prepare(
        "SELECT recovery_id, predecessor_epoch_id, pending_intent_count, published_intent_count,
                reenrollment_receipt, reenrollment_committed_at
         FROM library_local_recovery_archives
         WHERE library_id = ?1 AND successor_epoch_id = ?2 AND reenrollment_digest = ?3
         LIMIT 2;"
    ).map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![library, epoch, digest])
        .map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let receipt: Vec<u8> = row.get(4).map_err(|e| e.to_string())?;
    let committed: Option<u64> = row.get(5).map_err(|e| e.to_string())?;
    if receipt != expected || committed.is_none_or(|time| time < request.created_at) {
        return Err("current completed recovery receipt differs from the retained actor".into());
    }
    let summary = ConsumerRecoverySummaryV1 {
        recovery_id: row.get(0).map_err(|e| e.to_string())?,
        library_id: library,
        predecessor_epoch_id: row.get(1).map_err(|e| e.to_string())?,
        successor_epoch_id: epoch,
        state: "following",
        archived_pending_edits: row.get(2).map_err(|e| e.to_string())?,
        archived_published_edits: row.get(3).map_err(|e| e.to_string())?,
    };
    if rows.next().map_err(|e| e.to_string())?.is_some() {
        return Err("current completed recovery receipt is ambiguous".into());
    }
    Ok(Some(summary))
}

/// Fixed-size metadata from the selected installation's current recovery. Counts
/// describe the immutable archive, not acceptance or replay of any old edit.
pub fn read_consumer_recovery_summary_v1(
    connection: &Connection,
) -> Result<Option<ConsumerRecoverySummaryV1>, String> {
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version == crate::sqlite_contract_generated::SQLITE_SCHEMA_VERSION {
        return Ok(None);
    }
    if version != crate::sqlite_contract_generated::NATIVE_STORAGE_SCHEMA_VERSION {
        return Err("consumer recovery summary requires recognized native storage".into());
    }
    crate::normalized_sqlite::install_normalized_schema_v1(connection)
        .map_err(|e| e.to_string())?;
    let mut statement = connection.prepare(
        "SELECT archive.recovery_id, archive.library_id, archive.predecessor_epoch_id, archive.successor_epoch_id,
                archive.reenrollment_receipt IS NOT NULL, archive.reenrollment_committed_at IS NOT NULL,
                archive.pending_intent_count, archive.published_intent_count, handoff.phase
         FROM library_local_recovery_archives AS archive JOIN library_local_handoff AS handoff
          ON handoff.singleton_id = 1 AND handoff.installation_role = 'consumer'
          AND handoff.library_id = archive.library_id AND handoff.predecessor_epoch_id = archive.predecessor_epoch_id
          AND handoff.successor_epoch_id = archive.successor_epoch_id
         JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = archive.library_id
          AND meta.authority_epoch = archive.successor_epoch_id LIMIT 2;"
    ).map_err(|e| e.to_string())?;
    let mut rows = statement.query([]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        let consumer: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'consumer');",
            [], |r| r.get(0)).map_err(|e| e.to_string())?;
        return if consumer && completed_consumer_cycle_before_current(connection)?.is_none() {
            Err("consumer recovery summary is missing its current archive".into())
        } else {
            current_completed_recovery(connection)
        };
    };
    let prepared: bool = row.get(4).map_err(|e| e.to_string())?;
    let committed: bool = row.get(5).map_err(|e| e.to_string())?;
    let phase: String = row.get(8).map_err(|e| e.to_string())?;
    let state = match (prepared, committed, phase.as_str()) {
        (false, false, "recovery") => "archived",
        (true, false, "recovery") => "prepared",
        (true, true, "following") => "following",
        _ => return Err("consumer recovery summary lifecycle is inconsistent".into()),
    };
    let summary = ConsumerRecoverySummaryV1 {
        recovery_id: row.get(0).map_err(|e| e.to_string())?,
        library_id: row.get(1).map_err(|e| e.to_string())?,
        predecessor_epoch_id: row.get(2).map_err(|e| e.to_string())?,
        successor_epoch_id: row.get(3).map_err(|e| e.to_string())?,
        state,
        archived_pending_edits: row.get(6).map_err(|e| e.to_string())?,
        archived_published_edits: row.get(7).map_err(|e| e.to_string())?,
    };
    if rows.next().map_err(|e| e.to_string())?.is_some() {
        return Err("consumer recovery summary is ambiguous".into());
    }
    if state == "following" && current_completed_recovery(connection)?.as_ref() != Some(&summary) {
        return Err("consumer recovery summary differs from its committed receipt".into());
    }
    Ok(Some(summary))
}

pub(crate) fn encode_recovery_row(
    row: &rusqlite::Row<'_>,
    columns: usize,
) -> Result<Vec<u8>, String> {
    let mut values = Vec::with_capacity(columns);
    for index in 0..columns {
        values.push(match row.get_ref(index).map_err(|e| e.to_string())? {
            ValueRef::Null => json!(["null"]),
            ValueRef::Integer(value) => json!(["integer", value.to_string()]),
            ValueRef::Real(value) => json!(["real", format!("{:016x}", value.to_bits())]),
            ValueRef::Text(value) => json!(["text", STANDARD.encode(value)]),
            ValueRef::Blob(value) => json!(["blob", STANDARD.encode(value)]),
        });
    }
    encode_canonical_value(&json!(values), 2_097_152)
        .map_err(|_| "consumer recovery row exceeds its bound".into())
}

fn verify_archive(connection: &Connection, id: &str) -> Result<(), String> {
    verify_archive_contents(connection, id, true)
}

fn verify_archive_contents(
    connection: &Connection,
    id: &str,
    compare_live: bool,
) -> Result<(), String> {
    let (expected_count, expected_digest, pending, published): (u64, String, u64, u64) = connection.query_row(
        "SELECT row_count, archive_digest, pending_intent_count, published_intent_count FROM library_local_recovery_archives WHERE recovery_id = ?1;", [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(|e| e.to_string())?;
    let mut intent_counts = [0u64; 2];
    let mut digest = Sha256::new();
    let mut count = 0u64;
    for table in crate::normalized_import::RETAINED_FOLLOWER_TABLES {
        let mut metadata = connection
            .prepare(&format!("PRAGMA table_info({table});"))
            .map_err(|e| e.to_string())?;
        let layout = metadata
            .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, u32>(5)?)))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        let names = layout.iter().map(|(name, _)| name).collect::<Vec<_>>();
        let expected_columns = encode_canonical_value(&json!(names), 16_384)
            .map_err(|_| "consumer archive columns exceed their bound")?;
        let mut keys = layout
            .iter()
            .filter(|(_, ordinal)| *ordinal > 0)
            .collect::<Vec<_>>();
        keys.sort_by_key(|(_, ordinal)| *ordinal);
        if keys.is_empty() {
            return Err("consumer recovery table has no stable key".into());
        }
        let order = keys
            .iter()
            .map(|(name, _)| format!("\"{name}\""))
            .collect::<Vec<_>>()
            .join(",");
        let mut live_statement = connection
            .prepare(&format!("SELECT * FROM {table} ORDER BY {order};"))
            .map_err(|e| e.to_string())?;
        let mut live_rows = live_statement.query([]).map_err(|e| e.to_string())?;

        let mut statement = connection.prepare("SELECT row_ordinal, columns_json, canonical_row, row_digest, transaction_id FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = ?2 ORDER BY row_ordinal;").map_err(|e| e.to_string())?;
        let mut rows = statement
            .query(params![id, table])
            .map_err(|e| e.to_string())?;
        let mut ordinal = 0u64;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let stored_ordinal: u64 = row.get(0).map_err(|e| e.to_string())?;
            let columns: String = row.get(1).map_err(|e| e.to_string())?;
            let bytes: Vec<u8> = row.get(2).map_err(|e| e.to_string())?;
            let row_digest: String = row.get(3).map_err(|e| e.to_string())?;
            if stored_ordinal != ordinal || lower_hex(&Sha256::digest(&bytes)) != row_digest {
                return Err("consumer recovery archive row changed".into());
            }
            if *table == "library_intent_transactions" {
                let state_index = layout
                    .iter()
                    .position(|(name, _)| name == "state")
                    .ok_or("consumer archive intent state column is missing")?;
                let cells: Vec<Vec<String>> = serde_json::from_slice(&bytes)
                    .map_err(|_| "consumer archive intent row is invalid")?;
                let cell = cells
                    .get(state_index)
                    .filter(|cell| cell.len() == 2 && cell[0] == "text")
                    .ok_or("consumer archive intent state is invalid")?;
                let state = STANDARD
                    .decode(&cell[1])
                    .map_err(|_| "consumer archive intent state is invalid")?;
                count_intent_state(
                    std::str::from_utf8(&state)
                        .map_err(|_| "consumer archive intent state is invalid")?,
                    &mut intent_counts,
                )?;
            }
            if columns.as_bytes() != expected_columns {
                return Err("consumer recovery archive columns changed".into());
            }
            if compare_live {
                let live = live_rows
                    .next()
                    .map_err(|e| e.to_string())?
                    .ok_or("consumer recovery live rows changed after archival")?;
                if encode_recovery_row(live, layout.len())? != bytes {
                    return Err("consumer recovery live rows changed after archival".into());
                }
            }
            let transaction_id: Option<String> = row.get(4).map_err(|e| e.to_string())?;
            let cells: Vec<Vec<String>> =
                serde_json::from_slice(&bytes).map_err(|_| "consumer archive row is invalid")?;
            let expected_transaction = layout
                .iter()
                .position(|(name, _)| name == "transaction_id")
                .map(|index| {
                    let cell = cells
                        .get(index)
                        .filter(|cell| cell.len() == 2 && cell[0] == "text")
                        .ok_or("consumer archive transaction identity is invalid")?;
                    String::from_utf8(
                        STANDARD
                            .decode(&cell[1])
                            .map_err(|_| "consumer archive transaction identity is invalid")?,
                    )
                    .map_err(|_| "consumer archive transaction identity is invalid")
                })
                .transpose()?;
            if transaction_id != expected_transaction {
                return Err("consumer archive transaction index changed".into());
            }
            let commitment = canonical_handoff_bytes(&json!([
                table,
                ordinal,
                columns,
                row_digest,
                transaction_id
            ]))?;
            digest.update((commitment.len() as u64).to_be_bytes());
            digest.update(commitment);
            ordinal += 1;
            count += 1;
        }
        if compare_live && live_rows.next().map_err(|e| e.to_string())?.is_some() {
            return Err("consumer recovery live rows changed after archival".into());
        }
    }
    if count != expected_count
        || lower_hex(&digest.finalize()) != expected_digest
        || intent_counts != [pending, published]
    {
        return Err("consumer recovery archive is incomplete".into());
    }
    Ok(())
}

#[cfg(test)]
mod archive_parity_tests {
    use super::*;

    #[test]
    fn browser_archive_vector_preserves_sqlite_types_and_commitment() {
        let vector: serde_json::Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/recovery-archive-vectors-v1.json"
        ))
        .unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        let row = connection
            .query_row(vector["sql"].as_str().unwrap(), [], |row| {
                Ok(encode_recovery_row(row, 7).unwrap())
            })
            .unwrap();
        assert_eq!(row, vector["canonicalRow"].as_str().unwrap().as_bytes());
        let row_digest = lower_hex(&Sha256::digest(&row));
        assert_eq!(row_digest, vector["rowDigest"]);
        let commitment = canonical_handoff_bytes(&json!([
            "library_intent_members",
            0,
            vector["columnsJson"],
            row_digest,
            "transaction-1"
        ]))
        .unwrap();
        assert_eq!(
            commitment,
            vector["commitment"].as_str().unwrap().as_bytes()
        );
        let mut digest = Sha256::new();
        digest.update((commitment.len() as u64).to_be_bytes());
        digest.update(commitment);
        assert_eq!(lower_hex(&digest.finalize()), vector["archiveDigest"]);
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;")
            .unwrap();
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        crate::normalized_sqlite::install_normalized_schema_v1(&tx).unwrap();
        crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).unwrap();
        tx.execute("UPDATE library_local_change_state SET sequence = 17;", [])
            .unwrap();
        let id = "1".repeat(64);
        tx.execute("INSERT INTO library_local_recovery_archives
          (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 100);",
          params![id, "2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(64),
            crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256, "0".repeat(64)]).unwrap();
        archive_live_follower_rows(&tx, &id).unwrap();
        let (count, digest): (u64, String) = tx.query_row(
            "SELECT row_count, archive_digest FROM library_local_recovery_archives WHERE recovery_id = ?1;",
            [&id], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(count, 1);
        assert_eq!(digest, vector["emptyLibraryArchiveDigest"]);
        tx.commit().unwrap();
    }
}
