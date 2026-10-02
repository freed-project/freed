//! Source cancellation proof is committed with restored admission. A proof is
//! never returned for an authorization that has crossed the durable cutoff.

use crate::library_core_canonical::decode_canonical_value;
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::normalized_authority_credentials::{
    load_established_authority_key_pair, AuthorityKeyStore,
};
use crate::normalized_handoff_certificate::{
    canonical_handoff_bytes, digest, signature_input, verify_handoff_readiness_v1,
    verify_signature, HandoffPredecessorV1, HandoffReadinessV1,
};
use ring::signature::KeyPair;
use serde::{Deserialize, Serialize};

const MAX_BYTES: usize = 16_384;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HandoffCancellationBodyV1 {
    format: String,
    readiness: HandoffReadinessV1,
    predecessor_authority_public_key: String,
    cancelled_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HandoffCancellationV1 {
    body: HandoffCancellationBodyV1,
    cancellation_digest: String,
    predecessor_signature: String,
}

fn verify_cancellation(
    proof: &HandoffCancellationV1,
    readiness: &HandoffReadinessV1,
    predecessor: &HandoffPredecessorV1<'_>,
) -> Result<(), String> {
    if proof.body.format != "freed_library_handoff_cancellation_v1"
        || &proof.body.readiness != readiness
        || proof.body.cancelled_at_ms > MAX_SAFE_INTEGER
        || proof.body.predecessor_authority_public_key != predecessor.authority_public_key
        || proof.cancellation_digest != digest("handoff-cancellation-body", &proof.body)?
    {
        return Err("handoff cancellation identity is invalid".into());
    }
    verify_handoff_readiness_v1(
        readiness,
        predecessor,
        &readiness.body.target_actor_public_key,
    )?;
    verify_signature(
        "handoff-predecessor-cancellation",
        &proof.cancellation_digest,
        predecessor.authority_public_key,
        &proof.predecessor_signature,
    )?;
    canonical_handoff_bytes(proof)?;
    Ok(())
}

/// The transaction owns both restored source admission and its exact proof.
/// Key or signing failure rolls cancellation back. Retry never allocates a key.
pub fn cancel_source_handoff_with_proof_v1(
    connection: &mut rusqlite::Connection,
    handoff_id: &str,
    cancelled_at_ms: u64,
    authority_store: &dyn AuthorityKeyStore,
) -> Result<String, String> {
    crate::require_library_transfer_capability()?;
    if !connection.is_autocommit()
        || !is_lower_sha256(handoff_id)
        || cancelled_at_ms > MAX_SAFE_INTEGER
    {
        return Err("source cancellation input or transaction is invalid".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if synchronous < 2 {
        return Err("source cancellation requires full SQLite durability".into());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    crate::normalized_handoff::cancel_source_handoff_in_transaction_v1(
        &transaction,
        handoff_id,
        cancelled_at_ms,
    )
    .map_err(|error| error.to_string())?;
    let (library, epoch_id, readiness_bytes, original_time, stored): (String, String, Vec<u8>, u64, Option<Vec<u8>>) = transaction.query_row(
        "SELECT library_id, predecessor_epoch_id, canonical_readiness, cancelled_at, canonical_cancellation
         FROM library_local_handoff_cancellations WHERE handoff_id = ?1;",
        [handoff_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).map_err(|error| error.to_string())?;
    let readiness: HandoffReadinessV1 = serde_json::from_value(
        decode_canonical_value(&readiness_bytes, MAX_BYTES)
            .map_err(|_| "cancellation readiness is invalid")?
            .into_value(),
    )
    .map_err(|_| "cancellation readiness shape is invalid")?;
    if readiness.handoff_id != handoff_id
        || readiness.body.library_id != library
        || readiness.body.predecessor_epoch_id != epoch_id
        || canonical_handoff_bytes(&readiness)? != readiness_bytes
    {
        return Err("cancellation ledger identity is invalid".into());
    }
    let (epoch, certificate, public_key, writer): (u64, String, String, String) = transaction.query_row(
        "SELECT epoch.epoch_number, epoch.transition_certificate_digest, epoch.authority_public_key, active.writer_id
         FROM library_authority_epochs AS epoch JOIN library_active_authority AS active
           ON active.active_key = 'active' AND active.epoch_id = epoch.epoch_id AND active.library_id = epoch.library_id
         JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = active.library_id AND meta.authority_epoch = active.epoch_id
         WHERE epoch.epoch_id = ?1 AND epoch.library_id = ?2;",
        rusqlite::params![epoch_id, library], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|_| "cancellation predecessor is no longer selected")?;
    let predecessor = HandoffPredecessorV1 {
        library_id: &library,
        epoch_id: &epoch_id,
        epoch,
        certificate_digest: &certificate,
        authority_public_key: &public_key,
        writer_id: &writer,
    };
    let proof = if let Some(bytes) = stored {
        let proof: HandoffCancellationV1 = serde_json::from_value(
            decode_canonical_value(&bytes, MAX_BYTES)
                .map_err(|_| "stored cancellation is invalid")?
                .into_value(),
        )
        .map_err(|_| "stored cancellation shape is invalid")?;
        if canonical_handoff_bytes(&proof)? != bytes || proof.body.cancelled_at_ms != original_time
        {
            return Err("stored cancellation changed".into());
        }
        proof
    } else {
        let key = load_established_authority_key_pair(authority_store, &library)?;
        if lower_hex(key.public_key().as_ref()) != public_key {
            return Err("cancellation requires the established predecessor key".into());
        }
        let body = HandoffCancellationBodyV1 {
            format: "freed_library_handoff_cancellation_v1".into(),
            readiness: readiness.clone(),
            predecessor_authority_public_key: public_key.clone(),
            cancelled_at_ms: original_time,
        };
        let cancellation_digest = digest("handoff-cancellation-body", &body)?;
        let predecessor_signature = lower_hex(
            key.sign(&signature_input(
                "handoff-predecessor-cancellation",
                &cancellation_digest,
            )?)
            .as_ref(),
        );
        HandoffCancellationV1 {
            body,
            cancellation_digest,
            predecessor_signature,
        }
    };
    verify_cancellation(&proof, &readiness, &predecessor)?;
    let bytes = canonical_handoff_bytes(&proof)?;
    transaction.execute("UPDATE library_local_handoff_cancellations SET canonical_cancellation = ?1 WHERE handoff_id = ?2 AND canonical_cancellation IS NULL;",
        rusqlite::params![bytes, handoff_id]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|_| "cancellation encoding is invalid".into())
}

/// Verify the proof against the current installation without inferring authority
/// from the caller's key or from absence of a locally received authorization.
fn verify_target_context(
    connection: &rusqlite::Connection,
    proof: &HandoffCancellationV1,
) -> Result<(String, u64), String> {
    let readiness = &proof.body.readiness;
    let (phase, updated_at, stored_readiness): (String, u64, Vec<u8>) = connection.query_row(
        "SELECT handoff.phase, handoff.updated_at, handoff.canonical_readiness
         FROM library_local_handoff AS handoff
         JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = handoff.library_id
          AND meta.authority_epoch = handoff.predecessor_epoch_id
         JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1
          AND receipt.library_id = meta.library_id AND receipt.authority_epoch_id = meta.authority_epoch
         JOIN library_follower_actor_request AS request ON request.singleton_id = 1
          AND request.library_id = meta.library_id AND request.authority_epoch_id = meta.authority_epoch
          AND request.actor_id = handoff.target_writer_id
         JOIN library_actors AS actor ON actor.actor_id = request.actor_id
          AND actor.authority_epoch_id = request.authority_epoch_id AND actor.public_key = request.actor_public_key
          AND actor.enrollment_certificate_digest = request.enrollment_certificate_digest
          AND actor.actor_kind = 'pwa' AND (handoff.phase = 'cancelled' OR actor.retired_at IS NULL)
         JOIN library_intent_actors AS intent ON intent.actor_id = actor.actor_id
         WHERE handoff.singleton_id = 1 AND handoff.installation_role = 'target'
          AND handoff.phase IN ('preparing', 'cancelled') AND handoff.handoff_id = ?1
          AND handoff.library_id = ?2 AND handoff.predecessor_epoch_id = ?3
          AND handoff.target_writer_id = ?4 AND handoff.target_authority_public_key = ?5
          AND actor.public_key = ?6 AND handoff.canonical_authorization IS NULL
          AND handoff.canonical_authorization_body IS NULL AND handoff.canonical_activation IS NULL
          AND handoff.successor_epoch_id IS NULL AND handoff.expected_control_revision IS NULL
          AND handoff.observed_control_revision IS NULL
          AND NOT EXISTS(SELECT 1 FROM library_writer_admission)
          AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);",
        rusqlite::params![readiness.handoff_id, readiness.body.library_id, readiness.body.predecessor_epoch_id,
            readiness.body.target_actor_id, readiness.body.target_authority_public_key, readiness.body.target_actor_public_key],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|_| "cancellation does not match this unapproved target")?;
    if canonical_handoff_bytes(readiness)? != stored_readiness {
        return Err("cancellation changed this target's readiness".into());
    }
    let (epoch, certificate, public_key, writer): (u64, String, String, String) = connection.query_row(
        "SELECT epoch.epoch_number, epoch.transition_certificate_digest, epoch.authority_public_key, active.writer_id
         FROM library_authority_epochs AS epoch JOIN library_active_authority AS active
          ON active.active_key = 'active' AND active.library_id = epoch.library_id AND active.epoch_id = epoch.epoch_id
         WHERE epoch.library_id = ?1 AND epoch.epoch_id = ?2;",
        rusqlite::params![readiness.body.library_id, readiness.body.predecessor_epoch_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|_| "cancellation predecessor is not selected")?;
    verify_cancellation(
        proof,
        readiness,
        &HandoffPredecessorV1 {
            library_id: &readiness.body.library_id,
            epoch_id: &readiness.body.predecessor_epoch_id,
            epoch,
            certificate_digest: &certificate,
            authority_public_key: &public_key,
            writer_id: &writer,
        },
    )?;
    Ok((phase, updated_at))
}

fn decode_cancellation(bytes: &[u8]) -> Result<HandoffCancellationV1, String> {
    let proof: HandoffCancellationV1 = serde_json::from_value(
        decode_canonical_value(bytes, MAX_BYTES)
            .map_err(|_| "cancellation proof is not bounded canonical data")?
            .into_value(),
    )
    .map_err(|_| "cancellation proof shape is invalid")?;
    if canonical_handoff_bytes(&proof)? != bytes {
        return Err("cancellation proof encoding changed".into());
    }
    Ok(proof)
}

fn load_cancelled_target_proof(
    connection: &rusqlite::Connection,
) -> Result<HandoffCancellationV1, String> {
    let (bytes, time): (Vec<u8>, u64) = connection.query_row(
        "SELECT cancelled.canonical_cancellation, cancelled.cancelled_at
         FROM library_local_handoff_cancellations AS cancelled
         JOIN library_local_handoff AS current ON current.singleton_id = 1 AND current.installation_role = 'target'
          AND current.phase = 'cancelled' AND current.handoff_id = cancelled.handoff_id
          AND current.library_id = cancelled.library_id AND current.predecessor_epoch_id = cancelled.predecessor_epoch_id
          AND current.canonical_readiness = cancelled.canonical_readiness
          AND current.canonical_authorization IS NULL AND current.canonical_authorization_body IS NULL
          AND current.canonical_activation IS NULL AND current.successor_epoch_id IS NULL
          AND current.expected_control_revision IS NULL AND current.observed_control_revision IS NULL
          AND NOT EXISTS(SELECT 1 FROM library_writer_admission)
          AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| "canceled target has no retained cancellation proof")?;
    let proof = decode_cancellation(&bytes)?;
    if proof.body.cancelled_at_ms != time {
        return Err("target cancellation time changed".into());
    }
    Ok(proof)
}

pub(crate) fn require_cancelled_target_admission_v1(
    connection: &rusqlite::Connection,
) -> Result<(), String> {
    let proof = load_cancelled_target_proof(connection)?;
    let (phase, _) = verify_target_context(connection, &proof)?;
    if phase != "cancelled" {
        return Err("target cancellation is not committed".into());
    }
    Ok(())
}

/// Historical cancellation survives a direct successor checkpoint, but this
/// check does not permit old-epoch edits or replace explicit consumer recovery.
/// The boolean says whether the selected epoch has advanced from the canceled one.
pub(crate) fn verify_cancelled_target_history_v1(
    connection: &rusqlite::Connection,
) -> Result<bool, String> {
    let proof = load_cancelled_target_proof(connection)?;
    let readiness = &proof.body.readiness;
    let (library, selected): (String, String) = connection
        .query_row(
            "SELECT library_id, authority_epoch FROM library_meta WHERE singleton_id = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if library != readiness.body.library_id {
        return Err("canceled target Library changed".into());
    }
    if selected == readiness.body.predecessor_epoch_id {
        verify_target_context(connection, &proof)?;
        return Ok(false);
    }
    let retained_actor: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_follower_actor_request WHERE singleton_id = 1 AND library_id = ?1
         AND authority_epoch_id = ?2 AND actor_id = ?3 AND actor_public_key = ?4);",
        rusqlite::params![library, readiness.body.predecessor_epoch_id, readiness.body.target_actor_id, readiness.body.target_actor_public_key],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if !retained_actor {
        return Err("canceled target recovery enrollment changed".into());
    }
    let (epoch, certificate_digest, public_key): (u64, String, String) = connection.query_row(
        "SELECT epoch_number, transition_certificate_digest, authority_public_key FROM library_authority_epochs WHERE library_id = ?1 AND epoch_id = ?2;",
        rusqlite::params![library, readiness.body.predecessor_epoch_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|_| "canceled target predecessor proof is missing")?;
    let (_, _, selected_writer, _) =
        crate::normalized_sqlite::normalized_writer_identity(connection)
            .map_err(|_| "canceled target successor writer is not unique")?;
    type SelectedAuthority = (String, String, String, String, i64);
    let (bytes, stored_digest, selected_key, selected_key_id, selected_number): SelectedAuthority = connection.query_row(
        "SELECT epoch.canonical_transition_certificate, epoch.transition_certificate_digest, epoch.authority_public_key,
          epoch.authority_key_id, epoch.epoch_number
         FROM library_authority_epochs AS epoch JOIN library_active_authority AS active
          ON active.active_key = 'active' AND active.library_id = epoch.library_id AND active.epoch_id = epoch.epoch_id
         JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1
          AND receipt.library_id = active.library_id AND receipt.authority_epoch_id = active.epoch_id
          AND receipt.writer_actor_id = ?3
         WHERE epoch.library_id = ?1 AND epoch.epoch_id = ?2 AND length(CAST(epoch.canonical_transition_certificate AS BLOB)) <= 16384;",
        rusqlite::params![library, selected, selected_writer], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).map_err(|_| "canceled target successor receipt is unavailable")?;
    let certificate: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
        serde_json::from_str(&bytes).map_err(|_| "canceled target successor proof is invalid")?;
    let body = &certificate.certificate_body;
    let grant = &body.handoff_authorization;
    if canonical_handoff_bytes(&certificate)? != bytes.as_bytes()
        || certificate.epoch_id != selected
        || body.library_id != library
        || body.target_authority_public_key != selected_key
        || body.target_authority_key_id != selected_key_id
        || body.target_epoch != selected_number
        || body.target_writer_id != selected_writer
        || grant.body.readiness.body.predecessor_epoch_id != readiness.body.predecessor_epoch_id
        || crate::normalized_writer_certificate::digest_value(
            "epoch-transition-certificate",
            &serde_json::to_value(&certificate).map_err(|e| e.to_string())?,
        )? != stored_digest
    {
        return Err("canceled target requires the exact direct successor".into());
    }
    let cancelled_successor: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff_cancellations WHERE handoff_id = ?1);",
        [&grant.body.readiness.handoff_id], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if cancelled_successor {
        return Err("successor reuses locally canceled readiness".into());
    }
    let predecessor = HandoffPredecessorV1 {
        library_id: &library,
        epoch_id: &readiness.body.predecessor_epoch_id,
        epoch,
        certificate_digest: &certificate_digest,
        authority_public_key: &public_key,
        writer_id: &grant.body.source_control.writer_id,
    };
    verify_cancellation(&proof, readiness, &predecessor)?;
    crate::normalized_handoff_writer_certificate::verify_writer_handoff_certificate_v1(
        &certificate,
        &predecessor,
        &grant.body.readiness.body.target_actor_public_key,
    )?;
    Ok(true)
}

/// Return to consumer operation only after retaining the exact verified source
/// cancellation. The original actor, pending authority key and edits stay intact.
pub fn accept_target_handoff_cancellation_v1(
    connection: &mut rusqlite::Connection,
    canonical_cancellation: &[u8],
    applied_at_ms: u64,
) -> Result<String, String> {
    crate::require_library_transfer_capability()?;
    if !connection.is_autocommit() || applied_at_ms > MAX_SAFE_INTEGER {
        return Err("target cancellation input or transaction is invalid".into());
    }
    let proof = decode_cancellation(canonical_cancellation)?;
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if synchronous < 2 {
        return Err("target cancellation requires full SQLite durability".into());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&transaction)
        .map_err(|e| e.to_string())?;
    let (phase, updated_at) = verify_target_context(&transaction, &proof)?;
    let readiness = &proof.body.readiness;
    if phase == "cancelled" {
        require_cancelled_target_admission_v1(&transaction)?;
        let stored: Vec<u8> = transaction.query_row("SELECT canonical_cancellation FROM library_local_handoff_cancellations WHERE handoff_id = ?1;",
            [&readiness.handoff_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if stored != canonical_cancellation {
            return Err("committed target cancellation cannot be replaced".into());
        }
    } else {
        if applied_at_ms < updated_at {
            return Err("target cancellation time precedes preparation".into());
        }
        transaction.execute("INSERT INTO library_local_handoff_cancellations
            (handoff_id, library_id, predecessor_epoch_id, canonical_readiness, cancelled_at, canonical_cancellation)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            rusqlite::params![readiness.handoff_id, readiness.body.library_id, readiness.body.predecessor_epoch_id,
                canonical_handoff_bytes(readiness)?, proof.body.cancelled_at_ms, canonical_cancellation]).map_err(|e| e.to_string())?;
        transaction.execute("UPDATE library_local_handoff SET phase = 'cancelled', updated_at = ?1 WHERE singleton_id = 1;",
            [applied_at_ms]).map_err(|e| e.to_string())?;
        require_cancelled_target_admission_v1(&transaction)?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(readiness.handoff_id.clone())
}
