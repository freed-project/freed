//! Old-Primary adoption. A proposal is not proof of the remote winner.
use crate::library_core_canonical::decode_canonical_value;
use crate::normalized_handoff_certificate::{
    canonical_handoff_bytes, HandoffActivationProposalV1, HandoffSourceControlV1,
};
use crate::normalized_handoff_checkpoint::HandoffVerificationPlanV1;
use crate::normalized_import::{record_from_canonical, NormalizedCheckpointDigestAccumulatorV2};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceProposal {
    format: String,
    stage_id: String,
    activation: HandoffActivationProposalV1,
}

/// Reads staged records without selecting them. No authority or local role changes.
pub fn source_handoff_verification_plan_v1(
    connection: &mut Connection,
    handoff_id: &str,
    stage_id: &str,
    canonical_control: &[u8],
) -> Result<HandoffVerificationPlanV1, String> {
    crate::require_library_transfer_capability()?;
    if !crate::library_core_hash::is_lower_sha256(handoff_id)
        || stage_id.is_empty()
        || stage_id.len() > 255
    {
        return Err("source adoption identity is invalid".into());
    }
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let plan = source_plan_in_snapshot(&tx, handoff_id, stage_id, canonical_control)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(plan)
}

fn source_plan_in_snapshot(
    connection: &Connection,
    handoff_id: &str,
    stage_id: &str,
    canonical_control: &[u8],
) -> Result<HandoffVerificationPlanV1, String> {
    crate::normalized_sqlite::install_normalized_schema_v1(connection)
        .map_err(|e| e.to_string())?;
    let (authorization, body, readiness, library, predecessor, expected_revision): (Vec<u8>, Vec<u8>, Vec<u8>, String, String, String) = connection.query_row(
        "SELECT canonical_authorization, canonical_authorization_body, canonical_readiness, library_id, predecessor_epoch_id, expected_control_revision
         FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'authorized' AND handoff_id = ?1
          AND successor_epoch_id IS NULL AND canonical_activation IS NULL AND observed_control_revision IS NULL
          AND NOT EXISTS(SELECT 1 FROM library_writer_admission) AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);", [handoff_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    ).map_err(|_| "source adoption requires its durable signed authorization and closed writer admission")?;
    let (stage_library, successor, revision, count, bytes): (String, String, u64, u64, u64) = connection.query_row(
        "SELECT library_id, authority_epoch, source_revision, expected_record_count, staged_canonical_bytes FROM library_checkpoint_stages
         WHERE stage_id = ?1 AND staged_record_count = expected_record_count;", [stage_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).map_err(|_| "source adoption requires a complete staged successor")?;
    if stage_library != library || successor == predecessor || count == 0 {
        return Err("source staged Library or epoch changed".into());
    }
    let epoch_bytes: Vec<u8> = connection.query_row(
        "SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id = ?1 AND registry_key = '01_authority_epoch'
         AND json_extract(record_canonical, '$.primaryKey') = ?2;", params![stage_id, successor], |r| r.get(0),
    ).map_err(|_| "source successor certificate is missing")?;
    let epoch = record_from_canonical(&epoch_bytes).map_err(|e| e.to_string())?;
    let (certificate, _) =
        crate::normalized_handoff_writer_certificate::verify_staged_writer_handoff_against_local(
            connection,
            stage_id,
            epoch.payload["canonicalTransitionCertificate"]
                .as_str()
                .ok_or("successor certificate is missing")?
                .as_bytes(),
        )?;
    // Consent belongs to the first transition, even when the verified winner
    // is a later descendant. Never overwrite the original target identity.
    let chain = crate::normalized_handoff_writer_certificate::load_handoff_certificate_chain(
        connection,
        Some(stage_id),
        &predecessor,
        &successor,
    )?;
    let first: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
        serde_json::from_slice(chain.first().ok_or("source successor chain is empty")?)
            .map_err(|_| "source first successor certificate is invalid")?;
    let grant = &first.certificate_body.handoff_authorization;
    if certificate.epoch_id != successor
        || canonical_handoff_bytes(grant)? != authorization
        || canonical_handoff_bytes(&grant.body)? != body
        || canonical_handoff_bytes(&grant.body.readiness)? != readiness
        || grant.body.readiness.handoff_id != handoff_id
        || grant.body.source_control_revision != expected_revision
        || grant.body.readiness.body.predecessor_epoch_id != predecessor
        || revision < grant.body.final_source_revision
        || crate::normalized_import::selected_checkpoint_digest_v2(connection)
            .map_err(|e| e.to_string())?
            != grant.body.final_checkpoint_digest
    {
        return Err("staged successor differs from the source's frozen consent or frontier".into());
    }
    let exact_local: bool = connection.query_row("SELECT target_writer_id = ?1 AND target_authority_public_key = ?2 FROM library_local_handoff WHERE singleton_id = 1;", params![first.certificate_body.target_writer_id, first.certificate_body.target_authority_public_key], |r| r.get(0)).map_err(|e| e.to_string())?;
    let orphaned_history: bool = connection.query_row("SELECT NOT EXISTS(SELECT 1 FROM library_follower_actor_request) AND (EXISTS(SELECT 1 FROM library_intent_transactions) OR EXISTS(SELECT 1 FROM library_intent_actors));", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !exact_local || orphaned_history {
        return Err("source identity or retained consumer history requires recovery".into());
    }
    let control: HandoffSourceControlV1 = serde_json::from_value(
        decode_canonical_value(canonical_control, 16384)
            .map_err(|_| "source adoption control is not bounded canonical data")?
            .into_value(),
    )
    .map_err(|_| "source adoption control shape is invalid")?;
    if canonical_handoff_bytes(&control)? != canonical_control
        || control.library_id != library
        || control.storage_epoch != successor
        || control.writer_id != certificate.certificate_body.target_writer_id
        || control.generation > 9_007_199_254_740_991
    {
        return Err("source adoption control identity changed".into());
    }
    // Frontier equality with materialized rows is checked again in the commit.
    let descriptor = crate::normalized_sqlite::NormalizedCheckpointExportDescriptorV2 {
        format: "freed_normalized_checkpoint_export_v2".into(),
        protocol_version: 2,
        library_id: library,
        authority_epoch: successor,
        writer_id: control.writer_id.clone(),
        source_revision: revision,
        causal_frontier_digest: control.causal_frontier_digest.clone(),
        record_count: usize::try_from(count).map_err(|_| "record count exceeds host")?,
        item_count: 0,
    };
    crate::normalized_handoff_certificate::validate_handoff_consumer_control_v1(
        &control,
        &descriptor,
    )?;
    let mut accumulator = NormalizedCheckpointDigestAccumulatorV2::new();
    let mut stmt = connection.prepare("SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id = ?1 ORDER BY registry_key, primary_key_canonical;").map_err(|e| e.to_string())?;
    let mut rows = stmt.query([stage_id]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let canonical: Vec<u8> = row.get(0).map_err(|e| e.to_string())?;
        accumulator
            .push(&record_from_canonical(&canonical).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    let (digest, actual_count, actual_bytes) = accumulator.finish();
    if actual_count != count || actual_bytes != bytes {
        return Err("source staged checkpoint counters changed".into());
    }
    let proposal = HandoffActivationProposalV1 {
        format: "freed_library_handoff_activation_proposal_v1".into(),
        handoff_id: handoff_id.into(),
        control_file_id: grant.body.source_control_file_id.clone(),
        expected_control_revision: expected_revision,
        successor_checkpoint_digest: digest,
        control,
    };
    let source = SourceProposal {
        format: "freed_library_source_adoption_v1".into(),
        stage_id: stage_id.into(),
        activation: proposal,
    };
    let canonical_proposal = canonical_handoff_bytes(&source)?;
    Ok(HandoffVerificationPlanV1 {
        expected_control: canonical_control.to_vec(),
        expected_records: count,
        canonical_proposal,
        proposal: source.activation,
        source_stage_id: Some(stage_id.into()),
    })
}

/// Exact response-loss retry. This never downloads, signs, imports or grants a writer.
pub fn recover_demoted_source_handoff_v1(
    connection: &mut Connection,
    handoff_id: &str,
    stage_id: &str,
    canonical_control: &[u8],
) -> Result<Option<crate::NativeHandoffStatusV1>, String> {
    recover_demoted_source_handoff_with_access_v2(connection, handoff_id, stage_id, canonical_control, false)
}

/// Exact retry additionally binds the installation-local access choice.
pub fn recover_demoted_source_handoff_with_access_v2(
    connection: &mut Connection,
    handoff_id: &str,
    stage_id: &str,
    canonical_control: &[u8],
    read_only: bool,
) -> Result<Option<crate::NativeHandoffStatusV1>, String> {
    let status = crate::read_native_handoff_status_v1(connection).map_err(|e| e.to_string())?;
    let Some(status) = status.filter(|s| {
        s.installation_role == crate::HandoffInstallationRoleV1::Source
            && s.phase == crate::HandoffPhaseV1::Demoted
    }) else {
        return Ok(None);
    };
    let bytes = status
        .canonical_activation
        .as_ref()
        .ok_or("source demotion receipt is missing")?;
    let receipt: SourceProposal = serde_json::from_value(
        decode_canonical_value(bytes.as_bytes(), 32768)
            .map_err(|_| "source demotion receipt is invalid")?
            .into_value(),
    )
    .map_err(|_| "source demotion receipt shape is invalid")?;
    if canonical_handoff_bytes(&receipt)? != bytes.as_bytes()
        || receipt.format != "freed_library_source_adoption_v1"
        || receipt.stage_id != stage_id
        || receipt.activation.handoff_id != handoff_id
        || status.handoff_id != handoff_id
        || canonical_handoff_bytes(&receipt.activation.control)? != canonical_control
    {
        return Err("source adoption retry differs from its committed receipt".into());
    }
    verify_demoted_source_selection(connection)?;
    if crate::normalized_viewer::normalized_library_is_read_only_v1(connection).map_err(|e| e.to_string())? != read_only {
        return Err("source adoption retry changed its local access choice".into());
    }
    if read_only {
        let same_handoff: bool = connection.query_row(
            "SELECT source_handoff_id=?1 FROM library_local_viewer_policy WHERE singleton_id=1;",
            [handoff_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !same_handoff {
            return Err("source adoption retry changed its viewer policy receipt".into());
        }
    }
    Ok(Some(status))
}

pub(crate) fn verify_demoted_source_selection(connection: &Connection) -> Result<(), String> {
    if connection.is_autocommit() {
        let snapshot = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        verify_demoted_source_in_snapshot(&snapshot)?;
        return snapshot.commit().map_err(|e| e.to_string());
    }
    verify_demoted_source_in_snapshot(connection)
}

fn verify_demoted_source_in_snapshot(connection: &Connection) -> Result<(), String> {
    let valid: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff AS handoff JOIN library_meta AS meta
          ON meta.library_id = handoff.library_id AND meta.authority_epoch = handoff.successor_epoch_id
         JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1
          AND receipt.library_id = meta.library_id AND receipt.authority_epoch_id = meta.authority_epoch
          AND receipt.writer_actor_id = json_extract(CAST(handoff.canonical_activation AS TEXT), '$.activation.control.writerId')
         WHERE handoff.singleton_id = 1 AND handoff.installation_role = 'source' AND handoff.phase = 'demoted')
         AND NOT EXISTS(SELECT 1 FROM library_writer_admission) AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);", [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if !valid {
        return Err("source demotion is not backed by its consumer selection".into());
    }
    verify_demoted_source_consent(connection)
}

/// Verify retained consent against its original adopted epoch, independently of
/// a later selected epoch. This grants neither checkpoint nor edit admission.
pub(crate) fn verify_demoted_source_consent(connection: &Connection) -> Result<(), String> {
    struct RetainedConsent {
        id: String,
        library: String,
        old_epoch: String,
        new_epoch: String,
        authorization: Vec<u8>,
        body: Vec<u8>,
        readiness: Vec<u8>,
        adoption: Vec<u8>,
        revision: String,
        target: String,
        target_key: String,
    }
    let RetainedConsent { id, library, old_epoch, new_epoch, authorization, body, readiness, adoption, revision, target, target_key } = connection.query_row(
        "SELECT handoff_id,library_id,predecessor_epoch_id,successor_epoch_id,canonical_authorization,
                canonical_authorization_body,canonical_readiness,canonical_activation,expected_control_revision,target_writer_id,target_authority_public_key
         FROM library_local_handoff WHERE singleton_id=1 AND installation_role='source' AND phase='demoted';",
        [], |r| Ok(RetainedConsent { id: r.get(0)?, library: r.get(1)?, old_epoch: r.get(2)?, new_epoch: r.get(3)?,
            authorization: r.get(4)?, body: r.get(5)?, readiness: r.get(6)?, adoption: r.get(7)?, revision: r.get(8)?,
            target: r.get(9)?, target_key: r.get(10)? }),
    ).map_err(|e| e.to_string())?;
    let grant: crate::normalized_handoff_certificate::HandoffAuthorizationV1 =
        serde_json::from_value(
            decode_canonical_value(&authorization, 16_384)
                .map_err(|_| "source consent is invalid")?
                .into_value(),
        )
        .map_err(|_| "source consent shape is invalid")?;
    let ready = &grant.body.readiness;
    if canonical_handoff_bytes(&grant)? != authorization
        || canonical_handoff_bytes(&grant.body)? != body
        || canonical_handoff_bytes(ready)? != readiness
        || ready.handoff_id != id
        || ready.body.library_id != library
        || ready.body.predecessor_epoch_id != old_epoch
        || ready.body.target_actor_id != target
        || ready.body.target_authority_public_key != target_key
        || grant.body.source_control_revision != revision
    {
        return Err("source demotion consent records disagree".into());
    }
    let chain = crate::normalized_handoff_writer_certificate::load_handoff_certificate_chain(
        connection, None, &old_epoch, &new_epoch,
    )?;
    // Historical enrollment was checked in the installing transaction. On
    // restart, authenticate the retained chain against the original local
    // consent, not a predecessor key supplied by the newly imported checkpoint.
    crate::normalized_handoff_writer_certificate::verify_predecessor_checkpoint_reads(
        &chain.iter().map(Vec::as_slice).collect::<Vec<_>>(),
        &crate::normalized_handoff_certificate::HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &old_epoch,
            epoch: grant
                .body
                .successor_epoch
                .checked_sub(1)
                .ok_or("source predecessor epoch is invalid")?,
            certificate_digest: &ready.body.predecessor_certificate_digest,
            authority_public_key: &grant.body.predecessor_authority_public_key,
            writer_id: &grant.body.source_control.writer_id,
        },
        Some(&new_epoch),
    )?;
    let first: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
        serde_json::from_slice(chain.first().ok_or("source chain is empty")?)
            .map_err(|_| "source first certificate is invalid")?;
    let last: crate::normalized_handoff_writer_certificate::WriterHandoffCertificateV1 =
        serde_json::from_slice(chain.last().ok_or("source chain is empty")?)
            .map_err(|_| "source final certificate is invalid")?;
    let receipt: SourceProposal = serde_json::from_value(
        decode_canonical_value(&adoption, 32_768)
            .map_err(|_| "source adoption receipt is invalid")?
            .into_value(),
    )
    .map_err(|_| "source adoption receipt shape is invalid")?;
    if canonical_handoff_bytes(&first.certificate_body.handoff_authorization)? != authorization
        || canonical_handoff_bytes(&receipt)? != adoption
        || receipt.format != "freed_library_source_adoption_v1"
        || receipt.stage_id.is_empty()
        || receipt.stage_id.len() > 255
        || receipt.activation.handoff_id != id
        || receipt.activation.control.library_id != library
        || receipt.activation.control.storage_epoch != new_epoch
        || receipt.activation.control.writer_id != last.certificate_body.target_writer_id
        || receipt.activation.expected_control_revision != revision
        || receipt.activation.control_file_id != grant.body.source_control_file_id
    {
        return Err("source demotion differs from its original consent or final winner".into());
    }
    let selected: bool = connection.query_row(
        "SELECT epoch_number=?3 AND authority_key_id=?4 AND authority_public_key=?5 AND transition_certificate_digest=?6
         FROM library_authority_epochs WHERE library_id=?1 AND epoch_id=?2;",
        params![library,new_epoch,last.certificate_body.target_epoch,last.certificate_body.target_authority_key_id,
            last.certificate_body.target_authority_public_key,crate::normalized_writer_certificate::digest_value("epoch-transition-certificate", &serde_json::to_value(&last).map_err(|e| e.to_string())?)?],
        |r|r.get(0),
    ).map_err(|e|e.to_string())?;
    if !selected {
        return Err("source selected successor authority changed".into());
    }
    Ok(())
}

/// Trusted native host only: its bounded remote verifier must have completed.
/// The stage, consent, local role and follower receipt commit together or not at all.
pub fn adopt_source_handoff_after_remote_verification_v1(
    connection: &mut Connection,
    plan: &HandoffVerificationPlanV1,
    verified_revision: &str,
    adopted_at: u64,
) -> Result<crate::NativeHandoffStatusV1, String> {
    adopt_source_handoff_with_access_after_remote_verification_v2(connection, plan, verified_revision, adopted_at, false)
}

/// The viewer restriction commits with demotion, never in a later settings write.
pub fn adopt_source_handoff_with_access_after_remote_verification_v2(
    connection: &mut Connection,
    plan: &HandoffVerificationPlanV1,
    verified_revision: &str,
    adopted_at: u64,
    read_only: bool,
) -> Result<crate::NativeHandoffStatusV1, String> {
    crate::require_library_transfer_capability()?;
    let stage = plan
        .source_stage_id
        .as_deref()
        .ok_or("target verification cannot demote a source")?;
    if !connection.is_autocommit() || adopted_at > 9_007_199_254_740_991 {
        return Err("source adoption transaction or time is invalid".into());
    }
    if connection
        .pragma_query_value::<u32, _>(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?
        < 2
    {
        return Err("source adoption requires full SQLite durability".into());
    }
    plan.verify_control_read(&plan.expected_control, verified_revision)?;
    if let Some(status) = recover_demoted_source_handoff_with_access_v2(
        connection,
        &plan.proposal.handoff_id,
        stage,
        &plan.expected_control,
        read_only,
    )? {
        return Ok(status);
    }
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current = source_plan_in_snapshot(
        &tx,
        &plan.proposal.handoff_id,
        stage,
        &plan.expected_control,
    )?;
    if current.canonical_proposal != plan.canonical_proposal
        || current.expected_records != plan.expected_records
    {
        return Err("source adoption plan changed after remote verification".into());
    }
    let control = &plan.proposal.control;
    let changed = tx.execute("UPDATE library_local_handoff SET phase = 'demoted', successor_epoch_id = ?1,
        canonical_activation = ?2, observed_control_revision = ?3, updated_at = ?4
        WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'authorized' AND updated_at <= ?4;",
        params![control.storage_epoch, plan.canonical_proposal, verified_revision, adopted_at]).map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("source adoption time or lifecycle changed".into());
    }
    let receipt = crate::normalized_import::NormalizedFollowerCheckpointReceiptV2 {
        checkpoint_generation: control.generation,
        writer_actor_id: control.writer_id.clone(),
        manifest_object_key: control.manifest.descriptor.object_key.clone(),
        manifest_transport_object_id: control.manifest.transport_object_id.clone(),
        manifest_content_digest: control.manifest.descriptor.content_digest.clone(),
        control_revision: verified_revision.into(),
        installed_at: adopted_at,
    };
    let installed =
        crate::normalized_import::install_normalized_checkpoint_stage_in_transaction_v2(
            &tx,
            stage,
            true,
            Some(&receipt),
            None,
        )
        .map_err(|e| e.to_string())?;
    if installed.checkpoint_digest != plan.proposal.successor_checkpoint_digest
        || installed.record_count as u64 != plan.expected_records
    {
        return Err("installed source checkpoint differs from remote verification".into());
    }
    let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&tx)
        .map_err(|e| e.to_string())?;
    crate::normalized_handoff_certificate::validate_handoff_consumer_control_v1(
        control, &snapshot,
    )?;
    verify_demoted_source_selection(&tx)?;
    if read_only {
        crate::normalized_viewer::install_after_source_adoption(&tx, &plan.proposal.handoff_id, adopted_at)
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    crate::read_native_handoff_status_v1(connection)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "source demotion receipt is missing".into())
}

/// Preserve a completed source fence before an atomic return-target preparation.
/// Current consumer selection and the immutable successor certificate must agree
/// with the exact local consent and adoption receipt. This grants no admission.
/// Keep the completed source proof before the same transaction replaces its fence
/// with a new target preparation. The ledger grants no writer admission.
pub(crate) fn retain_demoted_source_for_return(
    tx: &rusqlite::Transaction<'_>,
    created_at: u64,
) -> Result<(), String> {
    verify_demoted_source_selection(tx)?;
    retain_verified_source_history(tx, created_at)
}

pub(crate) fn retain_demoted_viewer_for_recovery(
    tx: &rusqlite::Transaction<'_>,
    created_at: u64,
) -> Result<(), String> {
    if !crate::normalized_consumer_recovery::verify_demoted_viewer_successor_checkpoint(tx)? {
        return Err("viewer recovery requires a verified later successor".into());
    }
    retain_verified_source_history(tx, created_at)
}

fn retain_verified_source_history(
    tx: &rusqlite::Transaction<'_>,
    created_at: u64,
) -> Result<(), String> {
    let (id, library, old_epoch, new_epoch, authorization, adoption, completed):
        (String, String, String, String, Vec<u8>, Vec<u8>, u64) = tx.query_row(
        "SELECT handoff_id, library_id, predecessor_epoch_id, successor_epoch_id,
                canonical_authorization, canonical_activation, updated_at
         FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'demoted';",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
    ).map_err(|e| e.to_string())?;
    if created_at <= completed {
        return Err("return target readiness requires a later local creation time".into());
    }
    tx.execute(
        "INSERT INTO library_local_source_demotions (handoff_id, library_id, predecessor_epoch_id, successor_epoch_id, canonical_authorization, canonical_adoption, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        params![id, library, old_epoch, new_epoch, authorization, adoption, completed],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Source consumer identity uses this transfer as its new incarnation, retaining
/// the existing installation key instead of colliding with its old writer actor.
pub(crate) fn source_consumer_incarnation_v1(
    connection: &Connection,
    library: &str,
    epoch: &str,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    crate::normalized_local_annotations::reject_building(connection)
        .map_err(|error| error.to_string())?;
    if matches!(version, 1 | 4) {
        return Ok(None);
    }
    let id = connection.query_row("SELECT handoff_id FROM library_local_handoff WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'demoted' AND library_id = ?1 AND successor_epoch_id = ?2;", params![library, epoch], |r| r.get::<_, String>(0)).optional().map_err(|e| e.to_string())?;
    if id.is_some() {
        verify_demoted_source_selection(connection)?;
    }
    Ok(id)
}
