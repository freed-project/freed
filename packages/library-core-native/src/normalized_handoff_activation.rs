//! Final local activation after authenticated native remote verification.
use crate::library_core_actor_enrollment::{load_actor_key_pair, ActorKeyStore};
use crate::library_core_hash::lower_hex;
use crate::normalized_authority_credentials::AuthorityKeyStore;
use crate::normalized_handoff_checkpoint::HandoffVerificationPlanV1;
use ring::signature::{Ed25519KeyPair, KeyPair};
use rusqlite::{params, Connection};
use zeroize::Zeroizing;

/// The trusted native host calls this only with its completed remote verifier's
/// plan and revision. Never expose these arguments as a renderer attestation.
/// Key promotion precedes SQLite admission. A crash or SQL failure after key
/// promotion leaves cas_pending durable and can safely retry the same key.
pub fn activate_target_handoff_after_remote_verification_v1(
    connection: &mut Connection,
    plan: &HandoffVerificationPlanV1,
    verified_revision: &str,
    actor_store: &dyn ActorKeyStore,
    pending_store: &dyn AuthorityKeyStore,
    current_store: &dyn AuthorityKeyStore,
    activated_at_ms: u64,
) -> Result<crate::NativeHandoffStatusV1, String> {
    if plan.source_stage_id.is_some()
        || !connection.is_autocommit()
        || activated_at_ms > 9_007_199_254_740_991
    {
        return Err("handoff activation time or transaction is invalid".into());
    }
    let synchronous: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if synchronous < 2 {
        return Err("handoff activation requires full SQLite durability".into());
    }
    plan.verify_control_read(
        &crate::normalized_handoff_certificate::canonical_handoff_bytes(&plan.proposal.control)?,
        verified_revision,
    )?;
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
    let phase: String = tx
        .query_row(
            "SELECT phase FROM library_local_handoff WHERE singleton_id = 1;",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "handoff activation receipt is missing")?;
    if phase == "active" {
        // A committed retry must not compare the original checkpoint with a
        // Library that has since accepted writes, or restore revoked admission.
        let (proposal, revision) =
            verify_active_target(&tx, &plan.proposal.handoff_id, actor_store, current_store)?;
        if proposal != plan.canonical_proposal || revision != verified_revision {
            return Err("active handoff does not match the verified activation".into());
        }
        tx.commit().map_err(|e| e.to_string())?;
        return crate::read_native_handoff_status_v1(connection)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "active handoff receipt is missing".into());
    }
    crate::normalized_handoff_certificate::verify_staged_handoff_export_v1(
        &tx,
        &plan.proposal.handoff_id,
    )?;
    crate::normalized_handoff_certificate::require_handoff_control_file_v1(
        &tx,
        &plan.proposal.control_file_id,
    )?;
    let (proposal, updated): (Vec<u8>, u64) = tx.query_row(
        "SELECT canonical_activation, updated_at FROM library_local_handoff WHERE singleton_id = 1
         AND phase = 'cas_pending' AND observed_control_revision IS NULL;", [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| "target activation no longer owns its pending proposal")?;
    if proposal != plan.canonical_proposal || activated_at_ms < updated {
        return Err("handoff activation proposal or time changed".into());
    }
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&tx)
        .map_err(|e| e.to_string())?;
    crate::normalized_handoff_certificate::validate_handoff_activation_control_v1(
        &plan.proposal.control,
        &snapshot,
    )?;
    if crate::normalized_import::selected_checkpoint_digest_v2(&tx).map_err(|e| e.to_string())?
        != plan.proposal.successor_checkpoint_digest
    {
        return Err("handoff checkpoint changed after remote verification".into());
    }
    let (authority_public, actor_public): (String, String) = tx.query_row(
        "SELECT epoch.authority_public_key, actor.public_key
         FROM library_authority_epochs AS epoch JOIN library_actors AS actor
          ON actor.authority_epoch_id = epoch.epoch_id AND actor.actor_kind = 'desktop' AND actor.retired_at IS NULL
         WHERE epoch.library_id = ?1 AND epoch.epoch_id = ?2 AND actor.actor_id = ?3;",
        params![snapshot.library_id, snapshot.authority_epoch, snapshot.writer_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| "staged successor keys are missing")?;
    let actor = load_actor_key_pair(actor_store, &snapshot.library_id)?;
    let pending = Zeroizing::new(
        pending_store
            .load(&snapshot.library_id)?
            .ok_or("pending authority key is missing")?,
    );
    let pending_key =
        Ed25519KeyPair::from_pkcs8(&pending).map_err(|_| "pending authority key is invalid")?;
    if lower_hex(actor.public_key().as_ref()) != actor_public
        || lower_hex(pending_key.public_key().as_ref()) != authority_public
    {
        return Err("handoff activation requires its original signing keys".into());
    }
    let existing = current_store
        .load(&snapshot.library_id)?
        .map(Zeroizing::new);
    let already_promoted = existing
        .as_ref()
        .is_some_and(|bytes| bytes.as_slice() == pending.as_slice());
    if let Some(bytes) = existing.as_ref().filter(|_| !already_promoted) {
        let key =
            Ed25519KeyPair::from_pkcs8(bytes).map_err(|_| "current authority key is invalid")?;
        let known: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_authority_epochs WHERE library_id = ?1 AND authority_public_key = ?2);",
            params![snapshot.library_id, lower_hex(key.public_key().as_ref())], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        if !known {
            return Err("handoff refuses to overwrite an unrelated authority key".into());
        }
    }
    if !already_promoted {
        current_store.store(&snapshot.library_id, &pending)?;
    }
    let readback = Zeroizing::new(
        current_store
            .load(&snapshot.library_id)?
            .ok_or("promoted authority key readback is missing")?,
    );
    if readback.as_slice() != pending.as_slice() {
        return Err("promoted authority key readback changed".into());
    }
    crate::normalized_consumer_recovery::archive_promoted_consumer_in_transaction(
        &tx,
        &plan.proposal.handoff_id,
        activated_at_ms,
    )?;
    tx.execute(
        "INSERT INTO library_writer_admission
        (singleton_id, local_writer_id, active_writer_id, observed_manifest_generation, observed_at)
        VALUES (1, 'primary:desktop', 'primary:desktop', 0, ?1);",
        [activated_at_ms],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO library_local_cloud_writer_admission
        (singleton_id, local_writer_id, active_writer_id, authority_epoch_id, control_revision, verified_at)
        VALUES (1, ?1, ?1, ?2, ?3, ?4);",
        params![snapshot.writer_id, snapshot.authority_epoch, verified_revision, activated_at_ms]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE library_local_handoff SET phase = 'active', observed_control_revision = ?1, updated_at = ?2
        WHERE singleton_id = 1;", params![verified_revision, activated_at_ms]).map_err(|e| e.to_string())?;
    crate::normalized_mutation::normalized_primary_mutation_context_v1(&tx)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::read_native_handoff_status_v1(connection)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "activated handoff receipt is missing".into())
}

// Read-only verification shared by in-flight retries and fresh process recovery.
fn verify_active_target(
    connection: &Connection,
    handoff_id: &str,
    actor_store: &dyn ActorKeyStore,
    current_store: &dyn AuthorityKeyStore,
) -> Result<(Vec<u8>, String), String> {
    let (proposal, revision, library, epoch, actor_id): (Vec<u8>, String, String, String, String) = connection.query_row(
        "SELECT canonical_activation, observed_control_revision, library_id, successor_epoch_id, target_writer_id
         FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'target' AND phase = 'active' AND handoff_id = ?1;",
        [handoff_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).map_err(|_| "active handoff does not match this transfer")?;
    let context = crate::normalized_mutation::normalized_primary_mutation_context_v1(connection)
        .map_err(|e| e.to_string())?;
    if context.library_id != library || context.epoch_id != epoch || context.actor_id != actor_id {
        return Err("active handoff no longer owns the selected authority".into());
    }
    let authority_public: String = connection.query_row(
        "SELECT authority_public_key FROM library_authority_epochs WHERE library_id = ?1 AND epoch_id = ?2;",
        params![library, epoch], |r| r.get(0),
    ).map_err(|_| "active handoff authority is missing")?;
    let actor = load_actor_key_pair(actor_store, &library)?;
    let current = Zeroizing::new(
        current_store
            .load(&library)?
            .ok_or("active authority key is missing")?,
    );
    let key =
        Ed25519KeyPair::from_pkcs8(&current).map_err(|_| "active authority key is invalid")?;
    if lower_hex(key.public_key().as_ref()) != authority_public
        || lower_hex(actor.public_key().as_ref()) != context.actor_public_key
    {
        return Err("active handoff requires its original signing keys".into());
    }
    let decoded: crate::normalized_handoff_certificate::HandoffActivationProposalV1 =
        serde_json::from_slice(&proposal).map_err(|_| "active handoff proposal is invalid")?;
    if decoded.format != "freed_library_handoff_activation_proposal_v1"
        || decoded.handoff_id != handoff_id
        || decoded.control.library_id != library
        || decoded.control.storage_epoch != epoch
        || decoded.control.writer_id != actor_id
        || revision.len() < 3
        || revision.len() > 1024
        || !revision.starts_with('"')
        || !revision.ends_with('"')
        || revision.bytes().any(|b| b < 0x20 || b == 0x7f)
        || revision.as_bytes()[1..revision.len() - 1].contains(&b'"')
        || crate::normalized_handoff_certificate::canonical_handoff_bytes(&decoded)? != proposal
    {
        return Err("active handoff proposal identity changed".into());
    }
    crate::normalized_handoff_certificate::require_handoff_control_file_v1(
        connection,
        &decoded.control_file_id,
    )?;
    Ok((proposal, revision))
}

/// Recover only an already committed activation using device-local evidence.
/// This does not grant admission, promote keys, or authenticate a new cloud head.
/// A pending transfer must still complete native remote verification.
pub fn recover_active_target_handoff_v1(
    connection: &mut Connection,
    handoff_id: &str,
    actor_store: &dyn ActorKeyStore,
    current_store: &dyn AuthorityKeyStore,
) -> Result<crate::NativeHandoffStatusV1, String> {
    if !crate::library_core_hash::is_lower_sha256(handoff_id) || !connection.is_autocommit() {
        return Err("active handoff recovery input or transaction is invalid".into());
    }
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
    verify_active_target(&tx, handoff_id, actor_store, current_store)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::read_native_handoff_status_v1(connection)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "active handoff receipt is missing".into())
}
