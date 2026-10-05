//! Cooperative successor proof. Construction prepares bytes only; target writer
//! admission remains fenced until the cloud decision has been verified.
use crate::library_core_canonical::{decode_canonical_value, encode_canonical_value};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_hash::lower_hex;
use crate::normalized_authority::NormalizedAuthorityStateV2;
use crate::normalized_handoff_certificate::{
    verify_handoff_authorization_v1, HandoffAuthorizationV1, HandoffPredecessorV1,
};
use crate::normalized_writer_certificate::{
    authority_key_id, digest_value, epoch_signature_input, possession_signature_input,
    WriterEpochReassignment,
};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const FORMAT: &str = "freed_library_core_writer_epoch_handoff_v1";
const MAX_BYTES: usize = 16_384;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WriterHandoffBodyV1 {
    pub format: String,
    pub library_id: String,
    pub source_control: Value,
    pub target_epoch: i64,
    pub target_writer_id: String,
    pub target_authority_public_key: String,
    pub target_authority_key_id: String,
    pub signature_algorithm: String,
    pub handoff_authorization: HandoffAuthorizationV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WriterHandoffCertificateV1 {
    pub certificate_body: WriterHandoffBodyV1,
    pub epoch_id: String,
    pub epoch_signature: String,
    pub authority_key_possession_signature: String,
}

pub(crate) fn verify_writer_handoff_certificate_v1(
    certificate: &WriterHandoffCertificateV1,
    predecessor: &HandoffPredecessorV1<'_>,
    enrolled_actor_public_key: &str,
) -> Result<(), String> {
    let body = &certificate.certificate_body;
    let grant = &body.handoff_authorization;
    verify_handoff_authorization_v1(grant, predecessor, enrolled_actor_public_key)?;
    if body.format != FORMAT
        || body.signature_algorithm != "ed25519"
        || body.library_id != predecessor.library_id
        || u64::try_from(body.target_epoch).ok() != Some(grant.body.successor_epoch)
        || body.target_writer_id != grant.body.readiness.body.target_actor_id
        || body.target_authority_public_key != grant.body.readiness.body.target_authority_public_key
        || body.target_authority_key_id != authority_key_id(&body.target_authority_public_key)?
        || body.source_control
            != serde_json::to_value(&grant.body.source_control)
                .map_err(|error| error.to_string())?
    {
        return Err("successor certificate differs from predecessor consent".into());
    }
    let body_value = serde_json::to_value(body).map_err(|error| error.to_string())?;
    if certificate.epoch_id != digest_value("epoch-transition-certificate", &body_value)? {
        return Err("successor epoch digest is invalid".into());
    }
    for (input, signature) in [
        (
            epoch_signature_input(&certificate.epoch_id)?,
            &certificate.epoch_signature,
        ),
        (
            possession_signature_input(&certificate.epoch_id, &body.target_authority_key_id)?,
            &certificate.authority_key_possession_signature,
        ),
    ] {
        if !verify_library_core_ed25519(&body.target_authority_public_key, signature, &input)
            .map_err(|_| "successor signature is malformed")?
        {
            return Err("successor signature is invalid".into());
        }
    }
    encode_canonical_value(
        &serde_json::to_value(certificate).map_err(|error| error.to_string())?,
        MAX_BYTES,
    )
    .map_err(|_| "successor certificate exceeds its bound")?;
    Ok(())
}

/// Use an already loaded pending key. This function has no key-store or database
/// write access and cannot create a key, select an epoch or activate a writer.
pub(crate) fn prepare_writer_handoff_certificate_v1(
    current: &NormalizedAuthorityStateV2,
    predecessor_writer_id: &str,
    predecessor_certificate_digest: &str,
    canonical_authorization: &[u8],
    enrolled_actor_public_key: &str,
    pending_key: &Ed25519KeyPair,
) -> Result<WriterEpochReassignment, String> {
    let decoded = decode_canonical_value(canonical_authorization, MAX_BYTES)
        .map_err(|_| "successor consent is not bounded canonical data")?;
    let grant: HandoffAuthorizationV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "successor consent has an unsupported shape")?;
    if encode_canonical_value(
        &serde_json::to_value(&grant).map_err(|error| error.to_string())?,
        MAX_BYTES,
    )
    .map_err(|_| "successor consent encoding is invalid")?
        != canonical_authorization
    {
        return Err("successor consent bytes are not canonical".into());
    }
    let predecessor = HandoffPredecessorV1 {
        library_id: &current.library_id,
        epoch_id: &current.epoch_id,
        epoch: u64::try_from(current.epoch)
            .map_err(|_| "successor predecessor epoch is invalid")?,
        authority_public_key: &current.authority_public_key,
        certificate_digest: predecessor_certificate_digest,
        writer_id: predecessor_writer_id,
    };
    verify_handoff_authorization_v1(&grant, &predecessor, enrolled_actor_public_key)?;
    let public_key = lower_hex(pending_key.public_key().as_ref());
    if public_key != grant.body.readiness.body.target_authority_public_key
        || current.observed_frontier.len() > 1_000
    {
        return Err("successor key or predecessor frontier is invalid".into());
    }
    let body = WriterHandoffBodyV1 {
        format: FORMAT.into(),
        library_id: current.library_id.clone(),
        source_control: serde_json::to_value(&grant.body.source_control)
            .map_err(|error| error.to_string())?,
        target_epoch: i64::try_from(grant.body.successor_epoch)
            .map_err(|_| "successor epoch is invalid")?,
        target_writer_id: grant.body.readiness.body.target_actor_id.clone(),
        target_authority_key_id: authority_key_id(&public_key)?,
        target_authority_public_key: public_key,
        signature_algorithm: "ed25519".into(),
        handoff_authorization: grant,
    };
    let epoch_id = digest_value(
        "epoch-transition-certificate",
        &serde_json::to_value(&body).map_err(|error| error.to_string())?,
    )?;
    let certificate = WriterHandoffCertificateV1 {
        epoch_signature: lower_hex(
            pending_key
                .sign(&epoch_signature_input(&epoch_id)?)
                .as_ref(),
        ),
        authority_key_possession_signature: lower_hex(
            pending_key
                .sign(&possession_signature_input(
                    &epoch_id,
                    &body.target_authority_key_id,
                )?)
                .as_ref(),
        ),
        certificate_body: body,
        epoch_id: epoch_id.clone(),
    };
    verify_writer_handoff_certificate_v1(&certificate, &predecessor, enrolled_actor_public_key)?;
    let value = serde_json::to_value(&certificate).map_err(|error| error.to_string())?;
    let canonical = encode_canonical_value(&value, MAX_BYTES)
        .map_err(|_| "successor certificate exceeds its bound")?;
    Ok(WriterEpochReassignment {
        authority: NormalizedAuthorityStateV2 {
            library_id: current.library_id.clone(),
            epoch: certificate.certificate_body.target_epoch,
            epoch_id,
            authority_key_id: certificate.certificate_body.target_authority_key_id.clone(),
            authority_public_key: certificate
                .certificate_body
                .target_authority_public_key
                .clone(),
            observed_frontier: current.observed_frontier.clone(),
        },
        canonical_certificate_json: String::from_utf8(canonical)
            .map_err(|_| "successor certificate encoding is invalid")?,
        transition_certificate_digest: digest_value("epoch-transition-certificate", &value)?,
    })
}

/// Pin succession to this replica's accepted predecessor, never to keys supplied
/// by the incoming checkpoint. The caller must still preserve local edit state.
pub(crate) fn verify_writer_handoff_against_local_v1(
    connection: &rusqlite::Connection,
    canonical: &[u8],
) -> Result<WriterHandoffCertificateV1, String> {
    let decoded = decode_canonical_value(canonical, MAX_BYTES)
        .map_err(|_| "successor proof is not bounded canonical data")?;
    let certificate: WriterHandoffCertificateV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "successor proof has an unsupported shape")?;
    if encode_canonical_value(
        &serde_json::to_value(&certificate).map_err(|e| e.to_string())?,
        MAX_BYTES,
    )
    .map_err(|_| "successor proof encoding is invalid")?
        != canonical
    {
        return Err("successor proof bytes are not canonical".into());
    }
    let (library, epoch_id, epoch, digest, key, writer): (String, String, u64, String, String, String) = connection.query_row(
        "SELECT meta.library_id, old.epoch_id, old.epoch_number, old.transition_certificate_digest,
                old.authority_public_key, (SELECT actor_id FROM library_actors WHERE authority_epoch_id = old.epoch_id AND actor_kind = 'desktop' AND retired_at IS NULL)
         FROM library_meta AS meta JOIN library_active_authority AS active
           ON active.library_id = meta.library_id AND active.epoch_id = meta.authority_epoch
         JOIN library_authority_epochs AS old ON old.epoch_id = active.epoch_id
         WHERE meta.singleton_id = 1 AND active.active_key = 'active'
           AND (SELECT count(*) FROM library_actors WHERE authority_epoch_id = old.epoch_id AND actor_kind = 'desktop' AND retired_at IS NULL) = 1;", [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    ).map_err(|_| "successor proof requires the accepted predecessor")?;
    let actor_key: String = connection.query_row(
        "SELECT public_key FROM library_actors WHERE actor_id = ?1 AND authority_epoch_id = ?2 AND retired_at IS NULL;",
        rusqlite::params![certificate.certificate_body.target_writer_id, epoch_id], |r| r.get(0),
    ).map_err(|_| "successor target is not enrolled in the accepted predecessor")?;
    verify_writer_handoff_certificate_v1(
        &certificate,
        &HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &epoch_id,
            epoch,
            certificate_digest: &digest,
            authority_public_key: &key,
            writer_id: &writer,
        },
        &actor_key,
    )?;
    Ok(certificate)
}

/// Read-proof adapter. The readiness key is authenticated by predecessor
/// consent, but is not evidence of local target enrollment or writer admission.
fn verify_predecessor_checkpoint_read(
    canonical: &[u8],
    predecessor: &HandoffPredecessorV1<'_>,
) -> Result<Value, String> {
    verify_predecessor_checkpoint_reads(&[canonical], predecessor, None)?
        .pop()
        .ok_or_else(|| "predecessor read chain is empty".into())
}

/// Authenticate historical download references only. A verified chain does not
/// establish historical target enrollment or authorize checkpoint selection.
pub(crate) fn verify_predecessor_checkpoint_reads(
    certificates: &[&[u8]],
    predecessor: &HandoffPredecessorV1<'_>,
    expected_successor: Option<&str>,
) -> Result<Vec<Value>, String> {
    if certificates.is_empty()
        || certificates.len() > 32
        || certificates.iter().any(|bytes| bytes.len() > MAX_BYTES)
    {
        return Err("predecessor read chain exceeds its bounds".into());
    }
    if expected_successor.is_some_and(|epoch| !crate::library_core_hash::is_lower_sha256(epoch)) {
        return Err("predecessor read chain target is invalid".into());
    }
    let mut pin = (
        predecessor.library_id.to_owned(),
        predecessor.epoch_id.to_owned(),
        predecessor.epoch,
        predecessor.certificate_digest.to_owned(),
        predecessor.authority_public_key.to_owned(),
        predecessor.writer_id.to_owned(),
    );
    let mut references = Vec::with_capacity(certificates.len());
    for canonical in certificates {
        let (reference, certificate) = verify_predecessor_read_proof(
            canonical,
            &HandoffPredecessorV1 {
                library_id: &pin.0,
                epoch_id: &pin.1,
                epoch: pin.2,
                certificate_digest: &pin.3,
                authority_public_key: &pin.4,
                writer_id: &pin.5,
            },
        )?;
        let digest = digest_value(
            "epoch-transition-certificate",
            &serde_json::to_value(&certificate).map_err(|e| e.to_string())?,
        )?;
        let body = certificate.certificate_body;
        pin = (
            body.library_id,
            certificate.epoch_id,
            u64::try_from(body.target_epoch).map_err(|_| "successor epoch is invalid")?,
            digest,
            body.target_authority_public_key,
            body.target_writer_id,
        );
        references.push(reference);
    }
    if expected_successor.is_some_and(|epoch| epoch != pin.1) {
        return Err("predecessor read chain does not reach the selected successor".into());
    }
    Ok(references)
}

fn verify_predecessor_read_proof(
    canonical: &[u8],
    predecessor: &HandoffPredecessorV1<'_>,
) -> Result<(Value, WriterHandoffCertificateV1), String> {
    let decoded = decode_canonical_value(canonical, MAX_BYTES)
        .map_err(|_| "predecessor read proof is not bounded canonical data")?;
    let value = decoded.into_value();
    if encode_canonical_value(&value, MAX_BYTES)
        .map_err(|_| "predecessor read proof encoding is invalid")?
        != canonical
    {
        return Err("predecessor read proof bytes are not canonical".into());
    }
    let certificate: WriterHandoffCertificateV1 = serde_json::from_value(value)
        .map_err(|_| "predecessor read proof has an unsupported shape")?;
    let grant = &certificate.certificate_body.handoff_authorization;
    verify_writer_handoff_certificate_v1(
        &certificate,
        predecessor,
        &grant.body.readiness.body.target_actor_public_key,
    )?;
    let reference = serde_json::json!({
        "purpose": "predecessor_checkpoint_read", "pointer": grant.body.source_control,
        "controlRevision": grant.body.source_control_revision,
        "controlFileId": grant.body.source_control_file_id,
        "checkpointDigest": grant.body.final_checkpoint_digest,
        "sourceRevision": grant.body.final_source_revision,
        "successorEpochId": certificate.epoch_id,
        "authorizationDigest": grant.authorization_digest,
    });
    Ok((reference, certificate))
}

/// Read a bounded certificate path backwards from durable rows, then return it
/// in verification order. Discovery is not authentication; every returned hop
/// must still be verified against the locally pinned predecessor.
pub(crate) fn load_handoff_certificate_chain(
    connection: &rusqlite::Connection,
    stage: Option<&str>,
    predecessor_epoch: &str,
    successor_epoch: &str,
) -> Result<Vec<Vec<u8>>, String> {
    if connection.is_autocommit() || predecessor_epoch == successor_epoch {
        return Err(
            "handoff chain discovery requires an owned transaction and changed epoch".into(),
        );
    }
    let mut cursor = successor_epoch.to_owned();
    let mut certificates = Vec::new();
    while cursor != predecessor_epoch {
        if certificates.len() == 32 {
            return Err("handoff certificate path exceeds its bound".into());
        }
        let canonical: Vec<u8> = if let Some(stage) = stage {
            let identity = encode_canonical_value(&Value::String(cursor.clone()), 4096)
                .map_err(|_| "handoff epoch identity is invalid")?;
            let bytes: Vec<u8> = connection.query_row(
                "SELECT CASE WHEN length(record_canonical)<=?3 THEN record_canonical ELSE NULL END
                 FROM library_checkpoint_stage_records WHERE stage_id=?1 AND registry_key='01_authority_epoch' AND primary_key_canonical=?2;",
                rusqlite::params![stage, identity, crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES], |r| r.get(0),
            ).map_err(|_| "handoff chain authority record is missing or oversized")?;
            let row = crate::normalized_import::record_from_canonical(&bytes)
                .map_err(|e| e.to_string())?;
            let text = row.payload["canonicalTransitionCertificate"]
                .as_str()
                .ok_or("handoff chain certificate is missing")?;
            if text.len() > MAX_BYTES {
                return Err("handoff chain certificate exceeds its bound".into());
            }
            text.as_bytes().to_vec()
        } else {
            let text: String = connection.query_row(
                "SELECT CASE WHEN length(CAST(canonical_transition_certificate AS BLOB))<=?2 THEN canonical_transition_certificate ELSE NULL END
                 FROM library_authority_epochs WHERE epoch_id=?1;",
                rusqlite::params![cursor, MAX_BYTES], |r| r.get(0),
            ).map_err(|_| "handoff chain certificate is missing or oversized")?;
            text.into_bytes()
        };
        let value = decode_canonical_value(&canonical, MAX_BYTES)
            .map_err(|_| "handoff chain certificate bytes are invalid")?
            .into_value();
        if encode_canonical_value(&value, MAX_BYTES)
            .map_err(|_| "handoff chain encoding is invalid")?
            != canonical
        {
            return Err("handoff chain bytes are not canonical".into());
        }
        let certificate: WriterHandoffCertificateV1 = serde_json::from_value(value)
            .map_err(|_| "handoff chain certificate shape is unsupported")?;
        if certificate.epoch_id != cursor {
            return Err("handoff chain record identity changed".into());
        }
        cursor = certificate
            .certificate_body
            .handoff_authorization
            .body
            .readiness
            .body
            .predecessor_epoch_id;
        certificates.push(canonical);
    }
    certificates.reverse();
    Ok(certificates)
}

/// Verify an immutable historical checkpoint without selecting it. The caller
/// must authenticate `reference` from the accepted authority chain first and
/// keep this transaction through its later enrollment and admission checks.
fn verify_staged_predecessor_contents(
    connection: &rusqlite::Connection,
    stage_id: &str,
    reference: &Value,
) -> Result<(), String> {
    if connection.is_autocommit() || stage_id.is_empty() || stage_id.len() > 255 {
        return Err(
            "historical checkpoint verification requires an owned transaction and stage".into(),
        );
    }
    let pointer: crate::normalized_handoff_certificate::HandoffSourceControlV1 =
        serde_json::from_value(reference["pointer"].clone()).map_err(|e| e.to_string())?;
    let revision = reference["sourceRevision"]
        .as_u64()
        .ok_or("historical source revision is invalid")?;
    let expected_digest = reference["checkpointDigest"]
        .as_str()
        .ok_or("historical checkpoint digest is missing")?;
    if !crate::library_core_hash::is_lower_sha256(expected_digest) {
        return Err("historical checkpoint digest is invalid".into());
    }
    let stage: (String, String, u64, u64, u64) = connection.query_row(
        "SELECT library_id,authority_epoch,source_revision,expected_record_count,staged_canonical_bytes
         FROM library_checkpoint_stages WHERE stage_id=?1 AND staged_record_count=expected_record_count;",
        [stage_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
    ).map_err(|_| "historical checkpoint stage is incomplete")?;
    if stage.0 != pointer.library_id || stage.1 != pointer.storage_epoch || stage.2 != revision {
        return Err("historical checkpoint identity differs from signed consent".into());
    }
    let mut digest = crate::normalized_import::NormalizedCheckpointDigestAccumulatorV2::new();
    let mut statement = connection.prepare(
        "SELECT CASE WHEN length(record_canonical)<=?2 THEN record_canonical ELSE NULL END
         FROM library_checkpoint_stage_records WHERE stage_id=?1 ORDER BY registry_key,primary_key_canonical;",
    ).map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(rusqlite::params![
            stage_id,
            crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES
        ])
        .map_err(|e| e.to_string())?;
    let mut header = false;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let canonical: Vec<u8> = row
            .get(0)
            .map_err(|_| "historical checkpoint record exceeds its bound")?;
        let record = crate::normalized_import::record_from_canonical(&canonical)
            .map_err(|e| e.to_string())?;
        if encode_canonical_value(
            &serde_json::to_value(&record).map_err(|e| e.to_string())?,
            crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        )
        .map_err(|_| "historical checkpoint record encoding is invalid")?
            != canonical
        {
            return Err("historical checkpoint record bytes are not canonical".into());
        }
        if record.registry_key == "00_checkpoint_header" {
            if header
                || record.payload["libraryId"].as_str() != Some(pointer.library_id.as_str())
                || record.payload["authorityEpoch"].as_str() != Some(pointer.storage_epoch.as_str())
                || record.payload["sourceRevision"].as_u64() != Some(revision)
            {
                return Err("historical checkpoint header differs from signed consent".into());
            }
            header = true;
        }
        digest.push(&record).map_err(|e| e.to_string())?;
    }
    let (actual_digest, records, bytes) = digest.finish();
    if !header || actual_digest != expected_digest || records != stage.3 || bytes != stage.4 {
        return Err("historical checkpoint contents differ from signed consent".into());
    }
    Ok(())
}

/// Verify enrollment from the signed historical snapshot, not a current actor
/// row whose epoch and certificate may have been replaced by promotion.
fn verify_historical_handoff_target(
    connection: &rusqlite::Connection,
    stage: &str,
    canonical: &[u8],
    predecessor: &HandoffPredecessorV1<'_>,
) -> Result<WriterHandoffCertificateV1, String> {
    let (reference, certificate) = verify_predecessor_read_proof(canonical, predecessor)?;
    verify_staged_predecessor_contents(connection, stage, &reference)?;
    let body = &certificate.certificate_body;
    let identity = encode_canonical_value(&Value::String(body.target_writer_id.clone()), 4096)
        .map_err(|_| "historical target identity is invalid")?;
    let bytes: Vec<u8> = connection.query_row(
        "SELECT CASE WHEN length(record_canonical)<=?3 THEN record_canonical ELSE NULL END FROM library_checkpoint_stage_records
         WHERE stage_id=?1 AND registry_key='90_actor_state' AND primary_key_canonical=?2;",
        rusqlite::params![stage, identity, crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES],
        |r| r.get(0),
    ).map_err(|_| "historical target enrollment is missing or oversized")?;
    let actor =
        crate::normalized_import::record_from_canonical(&bytes).map_err(|e| e.to_string())?;
    let fields = &actor.payload;
    let key = &body
        .handoff_authorization
        .body
        .readiness
        .body
        .target_actor_public_key;
    if actor.primary_key.as_str() != Some(body.target_writer_id.as_str())
        || fields["authorityEpochId"].as_str() != Some(predecessor.epoch_id)
        || fields["publicKey"].as_str() != Some(key.as_str())
        || fields["actorKind"].as_str() != Some("pwa")
        || fields.get("retiredAt") != Some(&Value::Null)
    {
        return Err("historical target is not an active predecessor consumer".into());
    }
    let enrollment_bytes = fields["canonicalEnrollmentCertificate"]
        .as_str()
        .ok_or("historical target certificate is missing")?
        .as_bytes();
    let decoded = decode_canonical_value(enrollment_bytes, 65536)
        .map_err(|_| "historical target certificate is invalid")?
        .into_value();
    let frontier = crate::normalized_enrollment_verifier::parse_causal_tips(
        decoded
            .pointer("/certificate_body/actor_enrollment_body/observed_frontier")
            .ok_or("historical target frontier is missing")?,
    )
    .map_err(|e| e.to_string())?;
    let authority = NormalizedAuthorityStateV2 {
        library_id: predecessor.library_id.into(),
        epoch_id: predecessor.epoch_id.into(),
        epoch: i64::try_from(predecessor.epoch).map_err(|_| "historical epoch is invalid")?,
        authority_key_id: authority_key_id(predecessor.authority_public_key)?,
        authority_public_key: predecessor.authority_public_key.into(),
        observed_frontier: frontier,
    };
    let enrollment = crate::normalized_enrollment_verifier::verify_actor_enrollment(
        enrollment_bytes,
        &authority,
    )
    .map_err(|e| format!("historical target enrollment is invalid: {e}"))?;
    if enrollment.actor_id != body.target_writer_id
        || enrollment.actor_public_key != *key
        || fields["enrollmentCertificateDigest"].as_str()
            != Some(enrollment.enrollment_certificate_digest.as_str())
        || fields["chainGenesisDigest"].as_str() != Some(enrollment.actor_chain_genesis.as_str())
        || fields["enrollmentOperationId"].as_str()
            != Some(enrollment.enrollment_operation_id.as_str())
    {
        return Err("historical target row differs from its verified enrollment".into());
    }
    Ok(certificate)
}

struct HistoricalChain {
    certificates: Vec<Vec<u8>>,
    references: Vec<Value>,
    library: String,
    epoch: String,
    number: u64,
    digest: String,
    key: String,
    writer: String,
}

/// Bind every read to the selected local authority and the complete final stage.
/// A direct transfer keeps its established missing-enrollment catch-up path.
fn staged_historical_chain(
    connection: &rusqlite::Connection,
    stage_id: &str,
) -> Result<Option<HistoricalChain>, String> {
    use rusqlite::OptionalExtension;
    if connection.is_autocommit() || stage_id.is_empty() || stage_id.len() > 255 {
        return Err("historical chain binding requires an owned transaction and stage".into());
    }
    let selected: Option<(String, String)> = connection
        .query_row(
            "SELECT library_id,authority_epoch FROM library_meta WHERE singleton_id=1;",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((library, epoch)) = selected else {
        return Ok(None);
    };
    let stage: (String,String,u64) = connection.query_row(
        "SELECT library_id,authority_epoch,source_revision FROM library_checkpoint_stages WHERE stage_id=?1 AND staged_record_count=expected_record_count;",
        [stage_id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).map_err(|_|"historical chain successor stage is incomplete")?;
    if stage.0 != library {
        return Err("historical chain changes the selected Library".into());
    }
    if stage.1 == epoch {
        return Ok(None);
    }
    let certificates =
        load_handoff_certificate_chain(connection, Some(stage_id), &epoch, &stage.1)?;
    if certificates.len() == 1 {
        return Ok(None);
    }
    let (number,digest,key,writer,revision): (u64,String,String,String,u64) = connection.query_row(
        "SELECT old.epoch_number,old.transition_certificate_digest,old.authority_public_key,actor.actor_id,meta.source_revision
         FROM library_meta meta JOIN library_active_authority active ON active.library_id=meta.library_id AND active.epoch_id=meta.authority_epoch
         JOIN library_authority_epochs old ON old.epoch_id=active.epoch_id JOIN library_actors actor ON actor.authority_epoch_id=old.epoch_id
         WHERE meta.singleton_id=1 AND active.active_key='active' AND actor.actor_kind='desktop' AND actor.retired_at IS NULL
         AND (SELECT count(*) FROM library_actors WHERE authority_epoch_id=old.epoch_id AND actor_kind='desktop' AND retired_at IS NULL)=1;",
        [], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
    ).map_err(|_|"historical chain requires one accepted local authority")?;
    let incompatible: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_follower_actor_request WHERE singleton_id=1 AND (library_id!=?1 OR authority_epoch_id!=?2));",
        rusqlite::params![library,epoch], |r|r.get(0),
    ).map_err(|e|e.to_string())?;
    if incompatible {
        return Err("finish consumer recovery before another authority chain".into());
    }
    let references = verify_predecessor_checkpoint_reads(
        &certificates.iter().map(Vec::as_slice).collect::<Vec<_>>(),
        &HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &epoch,
            epoch: number,
            certificate_digest: &digest,
            authority_public_key: &key,
            writer_id: &writer,
        },
        Some(&stage.1),
    )?;
    let mut previous = revision;
    for reference in &references {
        let revision = reference["sourceRevision"]
            .as_u64()
            .ok_or("historical source revision is invalid")?;
        if revision < previous || revision > stage.2 {
            return Err("historical checkpoints regress the selected source".into());
        }
        previous = revision;
    }
    Ok(Some(HistoricalChain {
        certificates,
        references,
        library,
        epoch,
        number,
        digest,
        key,
        writer,
    }))
}

/// The importer calls this before replacing any rows, inside its write transaction.
/// Historical stages use the existing manifest-content-digest stage identity.
pub(crate) fn verify_staged_writer_handoff_against_local(
    connection: &rusqlite::Connection,
    stage_id: &str,
    canonical: &[u8],
) -> Result<(WriterHandoffCertificateV1, Vec<String>), String> {
    let Some(mut chain) = staged_historical_chain(connection, stage_id)? else {
        return verify_writer_handoff_against_local_v1(connection, canonical)
            .map(|certificate| (certificate, Vec::new()));
    };
    if chain.certificates.last().map(Vec::as_slice) != Some(canonical) {
        return Err("historical chain final certificate changed".into());
    }
    let mut last = None;
    let mut consumed_stages = Vec::new();
    for (certificate, reference) in chain.certificates.iter().zip(&chain.references) {
        let historical_stage = reference
            .pointer("/pointer/manifest/descriptor/contentDigest")
            .and_then(Value::as_str)
            .ok_or("historical manifest identity is missing")?;
        if historical_stage == stage_id {
            return Err("historical stage aliases the successor".into());
        }
        let verified = verify_historical_handoff_target(
            connection,
            historical_stage,
            certificate,
            &HandoffPredecessorV1 {
                library_id: &chain.library,
                epoch_id: &chain.epoch,
                epoch: chain.number,
                certificate_digest: &chain.digest,
                authority_public_key: &chain.key,
                writer_id: &chain.writer,
            },
        )?;
        chain.digest = digest_value(
            "epoch-transition-certificate",
            &serde_json::to_value(&verified).map_err(|e| e.to_string())?,
        )?;
        chain.epoch = verified.epoch_id.clone();
        chain.number = u64::try_from(verified.certificate_body.target_epoch)
            .map_err(|_| "historical successor epoch is invalid")?;
        chain.key = verified
            .certificate_body
            .target_authority_public_key
            .clone();
        chain.writer = verified.certificate_body.target_writer_id.clone();
        consumed_stages.push(historical_stage.to_owned());
        last = Some(verified);
    }
    last.map(|certificate| (certificate, consumed_stages))
        .ok_or_else(|| "historical authority chain is empty".into())
}

// Binding remains internal and is reconstructed from durable staging.
#[derive(Debug)]
struct StagedPredecessorRead {
    reference: Value,
    snapshot: String,
}

fn staged_predecessor_read(
    connection: &rusqlite::Connection,
    stage_id: &str,
) -> Result<Option<StagedPredecessorRead>, String> {
    use rusqlite::OptionalExtension;
    if connection.is_autocommit() {
        return Err("predecessor read binding requires an owned transaction".into());
    }
    if stage_id.is_empty() || stage_id.len() > 255 {
        return Err("predecessor read stage identity is invalid".into());
    }
    let stage: (String,String,u64,u64,u64) = connection.query_row(
        "SELECT library_id,authority_epoch,source_revision,expected_record_count,staged_canonical_bytes FROM library_checkpoint_stages WHERE stage_id=?1 AND staged_record_count=expected_record_count;", [stage_id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
    ).map_err(|_|"predecessor read stage is incomplete")?;
    let selected: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM library_meta WHERE singleton_id=1);",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !selected {
        return Ok(None);
    }
    let (library, epoch, number, digest, key, writer, revision): (String,String,u64,String,String,String,u64) = connection.query_row(
        "SELECT meta.library_id, epoch.epoch_id, epoch.epoch_number, epoch.transition_certificate_digest,
                epoch.authority_public_key, actor.actor_id, meta.source_revision
         FROM library_meta meta JOIN library_active_authority active ON active.library_id=meta.library_id AND active.epoch_id=meta.authority_epoch
         JOIN library_authority_epochs epoch ON epoch.epoch_id=active.epoch_id
         JOIN library_actors actor ON actor.authority_epoch_id=epoch.epoch_id
         WHERE meta.singleton_id=1 AND active.active_key='active' AND actor.actor_kind='desktop' AND actor.retired_at IS NULL
         AND (SELECT count(*) FROM library_actors WHERE authority_epoch_id=epoch.epoch_id AND actor_kind='desktop' AND retired_at IS NULL)=1;", [],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)),
    ).map_err(|e|format!("predecessor read requires one accepted authority: {e}"))?;
    if stage.0 != library {
        return Err("predecessor read Library changed".into());
    }
    if stage.1 == epoch {
        return Ok(None);
    }
    let request: Option<(String,String,String)> = connection.query_row(
        "SELECT library_id,authority_epoch_id,json_array(actor_id,actor_public_key,enrollment_request_digest,canonical_enrollment_request,created_at) FROM library_follower_actor_request WHERE singleton_id=1;", [],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).optional().map_err(|e|e.to_string())?;
    if request
        .as_ref()
        .is_some_and(|r| r.0 != library || r.1 != epoch)
    {
        return Err("finish consumer recovery before predecessor catch-up".into());
    }
    let record: Vec<u8> = connection.query_row(
        "SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id=?1 AND registry_key='01_authority_epoch' AND json_extract(record_canonical,'$.primaryKey')=?2 AND length(record_canonical)<=131072;",
        rusqlite::params![stage_id,stage.1], |r|r.get(0),
    ).map_err(|_|"predecessor read successor record is missing")?;
    let value = decode_canonical_value(&record, 131072)
        .map_err(|_| "successor record is not canonical data")?
        .into_value();
    let canonical = value["payload"]["canonicalTransitionCertificate"]
        .as_str()
        .ok_or("successor certificate is missing")?;
    let certificate: WriterHandoffCertificateV1 = serde_json::from_value(
        decode_canonical_value(canonical.as_bytes(), MAX_BYTES)
            .map_err(|_| "successor certificate is invalid")?
            .into_value(),
    )
    .map_err(|_| "successor certificate shape is invalid")?;
    let target: Option<(String, Option<u64>)> = connection
        .query_row(
            "SELECT authority_epoch_id,retired_at FROM library_actors WHERE actor_id=?1;",
            [&certificate.certificate_body.target_writer_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((target_epoch, retired)) = target {
        if target_epoch != epoch || retired.is_some() {
            return Err(
                "predecessor catch-up cannot replace a retired or conflicting target".into(),
            );
        }
        return Ok(None);
    }
    let reference = verify_predecessor_checkpoint_read(
        canonical.as_bytes(),
        &HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &epoch,
            epoch: number,
            certificate_digest: &digest,
            authority_public_key: &key,
            writer_id: &writer,
        },
    )?;
    let final_revision = reference["sourceRevision"]
        .as_u64()
        .ok_or("predecessor revision is invalid")?;
    if reference["successorEpochId"].as_str() != Some(stage.1.as_str())
        || final_revision < revision
        || final_revision > stage.2
    {
        return Err("predecessor checkpoint does not cover the selected source".into());
    }
    let snapshot =
        serde_json::json!({"stageId":stage_id,"stage":stage,"record":value,"request":request,
        "selected":[library,epoch,number.to_string(),digest,key,writer,revision.to_string()]})
        .to_string();
    Ok(Some(StagedPredecessorRead {
        reference,
        snapshot,
    }))
}

/// Return signed download metadata only. This never admits a checkpoint or writer.
pub fn prepare_normalized_predecessor_checkpoint_read_v1(
    connection: &mut rusqlite::Connection,
    successor_stage: &str,
) -> Result<Option<Value>, String> {
    crate::require_checkpoint_transfer_capability(connection, successor_stage)?;
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    if let Some(chain) = staged_historical_chain(&tx, successor_stage)? {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(Some(Value::Array(chain.references)));
    }
    let proof = staged_predecessor_read(&tx, successor_stage)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(proof.map(|p| p.reference))
}

/// Reconstruct the proof locally and recheck it in the import transaction.
/// A renderer-supplied download reference never authorizes selection.
pub fn activate_normalized_predecessor_checkpoint_v1(
    connection: &mut rusqlite::Connection,
    successor_stage: &str,
    predecessor_stage: &str,
    receipt: &crate::NormalizedFollowerCheckpointReceiptV2,
) -> Result<crate::NormalizedCheckpointActivationReceiptV2, String> {
    crate::require_library_transfer_capability()?;
    if predecessor_stage.is_empty() || predecessor_stage.len() > 255 {
        return Err("predecessor import stage identity is invalid".into());
    }
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let proof = staged_predecessor_read(&tx, successor_stage)?
        .ok_or("predecessor read is no longer required")?;
    tx.commit().map_err(|e| e.to_string())?;
    install_verified_predecessor_checkpoint(
        connection,
        successor_stage,
        predecessor_stage,
        &proof,
        receipt,
    )
}

#[cfg(test)]
pub(crate) fn check_staged_predecessor_read(
    connection: &mut rusqlite::Connection,
    stage_id: &str,
    expected: &crate::normalized_handoff_certificate::HandoffSourceControlV1,
) {
    assert!(staged_predecessor_read(connection, stage_id).is_err());
    let tx = connection.transaction().unwrap();
    let proof = staged_predecessor_read(&tx, stage_id).unwrap().unwrap();
    assert_eq!(
        proof.reference["pointer"],
        serde_json::to_value(expected).unwrap()
    );
    assert_eq!(
        staged_predecessor_read(&tx, stage_id)
            .unwrap()
            .unwrap()
            .snapshot,
        proof.snapshot
    );
    tx.execute(
        "UPDATE library_checkpoint_stages SET source_revision=source_revision+1 WHERE stage_id=?1;",
        [stage_id],
    )
    .unwrap();
    assert_ne!(
        staged_predecessor_read(&tx, stage_id)
            .unwrap()
            .unwrap()
            .snapshot,
        proof.snapshot
    );
    tx.execute(
        "UPDATE library_meta SET source_revision=?1;",
        [proof.reference["sourceRevision"].as_u64().unwrap() + 1],
    )
    .unwrap();
    assert!(staged_predecessor_read(&tx, stage_id)
        .unwrap_err()
        .contains("does not cover"));
    tx.rollback().unwrap();
}

fn install_verified_predecessor_checkpoint(
    connection: &mut rusqlite::Connection,
    successor_stage: &str,
    predecessor_stage: &str,
    expected: &StagedPredecessorRead,
    receipt: &crate::NormalizedFollowerCheckpointReceiptV2,
) -> Result<crate::NormalizedCheckpointActivationReceiptV2, String> {
    if connection
        .pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))
        .map_err(|e| e.to_string())?
        < 2
        || connection
            .pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))
            .map_err(|e| e.to_string())?
            != 1
    {
        return Err("predecessor import requires FULL durability and foreign keys".into());
    }
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let proof = staged_predecessor_read(&tx, successor_stage)?
        .ok_or("predecessor read is no longer required")?;
    if proof.snapshot != expected.snapshot
        || proof.reference != expected.reference
        || predecessor_stage == successor_stage
    {
        return Err("predecessor read binding changed".into());
    }
    let pointer: crate::normalized_handoff_certificate::HandoffSourceControlV1 =
        serde_json::from_value(proof.reference["pointer"].clone()).map_err(|e| e.to_string())?;
    if receipt.checkpoint_generation != pointer.generation
        || receipt.writer_actor_id != pointer.writer_id
        || receipt.manifest_object_key != pointer.manifest.descriptor.object_key
        || receipt.manifest_transport_object_id != pointer.manifest.transport_object_id
        || receipt.manifest_content_digest != pointer.manifest.descriptor.content_digest
        || Some(receipt.control_revision.as_str()) != proof.reference["controlRevision"].as_str()
    {
        return Err("predecessor receipt differs from signed consent".into());
    }
    let stage: (String,String,u64)=tx.query_row(
        "SELECT library_id,authority_epoch,source_revision FROM library_checkpoint_stages WHERE stage_id=?1 AND staged_record_count=expected_record_count;",
        [predecessor_stage], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).map_err(|_|"predecessor stage is incomplete")?;
    if stage.0 != pointer.library_id
        || stage.1 != pointer.storage_epoch
        || Some(stage.2) != proof.reference["sourceRevision"].as_u64()
    {
        return Err("predecessor stage differs from signed consent".into());
    }
    let installed =
        crate::normalized_import::install_normalized_checkpoint_stage_in_transaction_v2(
            &tx,
            predecessor_stage,
            true,
            Some(receipt),
            None,
        )
        .map_err(|e| e.to_string())?;
    if Some(installed.checkpoint_digest.as_str()) != proof.reference["checkpointDigest"].as_str()
        || installed.library_id != pointer.library_id
        || installed.authority_epoch != pointer.storage_epoch
        || Some(installed.source_revision) != proof.reference["sourceRevision"].as_u64()
    {
        return Err("predecessor checkpoint digest differs from signed consent".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(installed)
}

#[cfg(test)]
pub(crate) fn check_install_verified_predecessor(
    connection: &mut rusqlite::Connection,
    successor_stage: &str,
    predecessor_stage: &str,
) {
    let tx = connection.transaction().unwrap();
    let proof = staged_predecessor_read(&tx, successor_stage)
        .unwrap()
        .unwrap();
    tx.commit().unwrap();
    let pointer: crate::normalized_handoff_certificate::HandoffSourceControlV1 =
        serde_json::from_value(proof.reference["pointer"].clone()).unwrap();
    let receipt = crate::NormalizedFollowerCheckpointReceiptV2 {
        checkpoint_generation: pointer.generation,
        writer_actor_id: pointer.writer_id,
        manifest_object_key: pointer.manifest.descriptor.object_key,
        manifest_transport_object_id: pointer.manifest.transport_object_id,
        manifest_content_digest: pointer.manifest.descriptor.content_digest,
        control_revision: proof.reference["controlRevision"].as_str().unwrap().into(),
        installed_at: 2400,
    };
    let before = crate::describe_normalized_checkpoint_export_v2(connection).unwrap();
    let members = |db: &rusqlite::Connection| {
        db.prepare("SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;")
            .unwrap()
            .query_map([], |r| r.get::<_, Vec<u8>>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    let old_members = members(connection);
    assert!(
        !old_members.is_empty(),
        "catch-up fixture must preserve signed members"
    );
    assert!(connection.query_row("SELECT count(*) FROM library_intent_transactions WHERE state IN ('pending','published');", [], |r|r.get::<_,i64>(0)).unwrap()>0);
    let mut wrong_receipt = receipt.clone();
    wrong_receipt.control_revision = "wrong".into();
    assert!(install_verified_predecessor_checkpoint(
        connection,
        successor_stage,
        predecessor_stage,
        &proof,
        &wrong_receipt
    )
    .unwrap_err()
    .contains("receipt differs"));
    let original: Vec<u8>=connection.query_row("SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id=?1 AND registry_key='00_checkpoint_header';",
        [predecessor_stage],|r|r.get(0)).unwrap();
    let mut changed = decode_canonical_value(&original, 131072)
        .unwrap()
        .into_value();
    let created = changed["payload"]["createdAtMs"].as_u64().unwrap();
    changed["payload"]["createdAtMs"] = serde_json::json!(created + 1);
    let altered = encode_canonical_value(&changed, 131072).unwrap();
    let delta = altered.len() as i64 - original.len() as i64;
    connection.execute("UPDATE library_checkpoint_stage_records SET record_canonical=?2 WHERE stage_id=?1 AND registry_key='00_checkpoint_header';",rusqlite::params![predecessor_stage,altered]).unwrap();
    connection.execute("UPDATE library_checkpoint_stages SET staged_canonical_bytes=staged_canonical_bytes+?2 WHERE stage_id=?1;",rusqlite::params![predecessor_stage,delta]).unwrap();
    assert!(install_verified_predecessor_checkpoint(
        connection,
        successor_stage,
        predecessor_stage,
        &proof,
        &receipt
    )
    .unwrap_err()
    .contains("digest differs from signed consent"));
    assert_eq!(
        crate::describe_normalized_checkpoint_export_v2(connection).unwrap(),
        before
    );
    assert_eq!(members(connection), old_members);
    connection.execute("UPDATE library_checkpoint_stage_records SET record_canonical=?2 WHERE stage_id=?1 AND registry_key='00_checkpoint_header';",rusqlite::params![predecessor_stage,original]).unwrap();
    connection.execute("UPDATE library_checkpoint_stages SET staged_canonical_bytes=staged_canonical_bytes-?2 WHERE stage_id=?1;",rusqlite::params![predecessor_stage,delta]).unwrap();
    assert_eq!(
        prepare_normalized_predecessor_checkpoint_read_v1(connection, successor_stage).unwrap(),
        Some(proof.reference.clone())
    );
    let installed = activate_normalized_predecessor_checkpoint_v1(
        connection,
        successor_stage,
        predecessor_stage,
        &receipt,
    )
    .unwrap();
    assert_eq!(
        installed.checkpoint_digest,
        proof.reference["checkpointDigest"].as_str().unwrap()
    );
    assert_eq!(members(connection), old_members);
}

#[cfg(test)]
mod parity_tests {
    use super::*;

    #[test]
    fn historical_checkpoint_verification_is_read_only_and_detects_changed_staging() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/native-handoff-catchup-vector-v1.json"
        ))
        .unwrap();
        let records: Vec<crate::normalized_checkpoint::NormalizedCheckpointRecordV2> =
            serde_json::from_value(fixture["predecessorRecords"].clone()).unwrap();
        let descriptor = &fixture["predecessor"];
        let (mut connection, _, _) = crate::normalized_mutation::tests::fixture();
        let before = crate::describe_normalized_checkpoint_export_v2(&connection).unwrap();
        crate::begin_normalized_checkpoint_stage_v2(
            &connection,
            &crate::BeginNormalizedCheckpointStageV2 {
                stage_id: "historical-proof".into(),
                library_id: descriptor["libraryId"].as_str().unwrap().into(),
                authority_epoch: descriptor["authorityEpoch"].as_str().unwrap().into(),
                source_revision: descriptor["sourceRevision"].as_u64().unwrap(),
                expected_record_count: records.len(),
                created_at: 1,
            },
        )
        .unwrap();
        for page in records.chunks(16) {
            crate::append_normalized_checkpoint_stage_page_v2(
                &mut connection,
                "historical-proof",
                page,
            )
            .unwrap();
        }
        let proof = &fixture["expectedReadProof"];
        let baseline = &fixture["baseline"];
        let authority = fixture["baselineRecords"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| {
                r["registryKey"] == "01_authority_epoch"
                    && r["primaryKey"] == baseline["authorityEpoch"]
            })
            .unwrap();
        let pin = HandoffPredecessorV1 {
            library_id: baseline["libraryId"].as_str().unwrap(),
            epoch_id: baseline["authorityEpoch"].as_str().unwrap(),
            epoch: authority["payload"]["epochNumber"].as_u64().unwrap(),
            certificate_digest: authority["payload"]["transitionCertificateDigest"]
                .as_str()
                .unwrap(),
            authority_public_key: authority["payload"]["authorityPublicKey"].as_str().unwrap(),
            writer_id: baseline["writerId"].as_str().unwrap(),
        };
        let certificate = fixture["canonicalCertificate"].as_str().unwrap().as_bytes();
        assert!(
            verify_staged_predecessor_contents(&connection, "historical-proof", proof).is_err()
        );
        let tx = connection.transaction().unwrap();
        let changes: u64 = tx
            .query_row("SELECT total_changes();", [], |r| r.get(0))
            .unwrap();
        verify_staged_predecessor_contents(&tx, "historical-proof", proof).unwrap();
        let verified =
            verify_historical_handoff_target(&tx, "historical-proof", certificate, &pin).unwrap();
        assert_eq!(
            verified.epoch_id,
            proof["successorEpochId"].as_str().unwrap()
        );
        assert_eq!(
            changes,
            tx.query_row("SELECT total_changes();", [], |r| r.get::<_, u64>(0))
                .unwrap()
        );
        assert_eq!(
            before,
            crate::describe_normalized_checkpoint_export_v2(&tx).unwrap()
        );
        tx.execute("UPDATE library_checkpoint_stages SET staged_canonical_bytes=staged_canonical_bytes+1 WHERE stage_id='historical-proof';", []).unwrap();
        assert!(verify_staged_predecessor_contents(&tx, "historical-proof", proof).is_err());
        tx.execute("UPDATE library_checkpoint_stages SET staged_canonical_bytes=staged_canonical_bytes-1 WHERE stage_id='historical-proof';", []).unwrap();
        let original: Vec<u8> = tx.query_row("SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id='historical-proof' AND registry_key='00_checkpoint_header';", [], |r| r.get(0)).unwrap();
        let mut spaced = vec![b' '];
        spaced.extend_from_slice(&original);
        tx.execute("UPDATE library_checkpoint_stage_records SET record_canonical=?1 WHERE stage_id='historical-proof' AND registry_key='00_checkpoint_header';", [&spaced]).unwrap();
        assert!(verify_staged_predecessor_contents(&tx, "historical-proof", proof).is_err());
        tx.execute("UPDATE library_checkpoint_stage_records SET record_canonical=x'7b7d' WHERE stage_id='historical-proof' AND registry_key='00_checkpoint_header';", []).unwrap();
        assert!(verify_staged_predecessor_contents(&tx, "historical-proof", proof).is_err());
        tx.rollback().unwrap();
        assert_eq!(
            before,
            crate::describe_normalized_checkpoint_export_v2(&connection).unwrap()
        );
    }

    #[test]
    fn missed_transfer_reads_require_the_complete_authenticated_chain() {
        let vectors: Vec<Value> = serde_json::from_str(include_str!(
            "../../shared/src/library-core/handoff-chain-vectors-v1.json"
        ))
        .unwrap();
        let pin = &vectors[0]["predecessor"];
        let predecessor = HandoffPredecessorV1 {
            library_id: pin["libraryId"].as_str().unwrap(),
            epoch_id: pin["epochId"].as_str().unwrap(),
            epoch: pin["epoch"].as_u64().unwrap(),
            certificate_digest: pin["certificateDigest"].as_str().unwrap(),
            authority_public_key: pin["authorityPublicKey"].as_str().unwrap(),
            writer_id: pin["writerId"].as_str().unwrap(),
        };
        let certificates: Vec<&[u8]> = vectors
            .iter()
            .map(|v| v["canonicalCertificate"].as_str().unwrap().as_bytes())
            .collect();
        let expected = vectors[1]["expected"]["epochId"].as_str().unwrap();
        let reads =
            verify_predecessor_checkpoint_reads(&certificates, &predecessor, Some(expected))
                .unwrap();
        for (read, vector) in reads.iter().zip(&vectors) {
            let certificate: Value =
                serde_json::from_str(vector["canonicalCertificate"].as_str().unwrap()).unwrap();
            let grant = &certificate["certificate_body"]["handoff_authorization"];
            assert_eq!(
                read,
                &serde_json::json!({
                    "purpose":"predecessor_checkpoint_read", "pointer":grant["body"]["source_control"],
                    "controlRevision":grant["body"]["source_control_revision"],
                    "controlFileId":grant["body"]["source_control_file_id"],
                    "checkpointDigest":grant["body"]["final_checkpoint_digest"],
                    "sourceRevision":grant["body"]["final_source_revision"],
                    "successorEpochId":vector["expected"]["epochId"],
                    "authorizationDigest":grant["authorization_digest"],
                })
            );
        }
        assert!(verify_predecessor_checkpoint_reads(
            &certificates[1..],
            &predecessor,
            Some(expected)
        )
        .is_err());
        assert!(verify_predecessor_checkpoint_reads(
            &certificates[..1],
            &predecessor,
            Some(expected)
        )
        .is_err());
        assert!(verify_predecessor_checkpoint_reads(&[], &predecessor, Some(expected)).is_err());
        assert!(verify_predecessor_checkpoint_reads(
            &vec![certificates[0]; 33],
            &predecessor,
            Some(expected)
        )
        .is_err());
        let mut corrupted = certificates[1].to_vec();
        let position = corrupted.len() - 4;
        corrupted[position] = if corrupted[position] == b'0' {
            b'1'
        } else {
            b'0'
        };
        assert!(verify_predecessor_checkpoint_reads(
            &[certificates[0], &corrupted],
            &predecessor,
            Some(expected)
        )
        .is_err());
    }

    #[test]
    fn shared_handoff_vector_matches_native_verification() {
        let vector: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/handoff-certificate-vectors-v1.json"
        ))
        .unwrap();
        let mut vectors: Vec<Value> = serde_json::from_str(include_str!(
            "../../shared/src/library-core/handoff-chain-vectors-v1.json"
        ))
        .unwrap();
        assert_eq!(
            vectors[0]["expected"]["epochId"],
            vectors[1]["predecessor"]["epochId"]
        );
        assert_eq!(
            vectors[0]["expected"]["certificateDigest"],
            vectors[1]["predecessor"]["certificateDigest"]
        );
        assert_eq!(
            vectors[0]["expected"]["authorityPublicKey"],
            vectors[1]["predecessor"]["authorityPublicKey"]
        );
        vectors.push(vector);
        vectors.push(
            serde_json::from_str(include_str!(
                "../../shared/src/library-core/recovered-enrollment-vector-v1.json"
            ))
            .unwrap(),
        );
        for vector in vectors {
            let pin = &vector["predecessor"];
            let predecessor = HandoffPredecessorV1 {
                library_id: pin["libraryId"].as_str().unwrap(),
                epoch_id: pin["epochId"].as_str().unwrap(),
                epoch: pin["epoch"].as_u64().unwrap(),
                certificate_digest: pin["certificateDigest"].as_str().unwrap(),
                authority_public_key: pin["authorityPublicKey"].as_str().unwrap(),
                writer_id: pin["writerId"].as_str().unwrap(),
            };
            let canonical = vector["canonicalCertificate"].as_str().unwrap().as_bytes();
            let value = decode_canonical_value(canonical, MAX_BYTES)
                .unwrap()
                .into_value();
            assert_eq!(
                encode_canonical_value(&value, MAX_BYTES).unwrap(),
                canonical
            );
            let certificate: WriterHandoffCertificateV1 =
                serde_json::from_value(value.clone()).unwrap();
            let actor = vector["enrolledActorPublicKey"].as_str().unwrap();
            verify_writer_handoff_certificate_v1(&certificate, &predecessor, actor).unwrap();
            let read = verify_predecessor_checkpoint_read(canonical, &predecessor).unwrap();
            let grant = &value["certificate_body"]["handoff_authorization"];
            assert_eq!(
                read,
                serde_json::json!({
                    "purpose":"predecessor_checkpoint_read", "pointer":grant["body"]["source_control"],
                    "controlRevision":grant["body"]["source_control_revision"],
                    "controlFileId":grant["body"]["source_control_file_id"],
                    "checkpointDigest":grant["body"]["final_checkpoint_digest"],
                    "sourceRevision":grant["body"]["final_source_revision"],
                    "successorEpochId":vector["expected"]["epochId"],
                    "authorizationDigest":grant["authorization_digest"],
                })
            );
            assert_eq!(
                certificate.epoch_id,
                vector["expected"]["epochId"].as_str().unwrap()
            );
            assert_eq!(
                digest_value("epoch-transition-certificate", &value).unwrap(),
                vector["expected"]["certificateDigest"].as_str().unwrap()
            );
            assert_eq!(
                certificate.certificate_body.target_authority_key_id,
                vector["expected"]["authorityKeyId"].as_str().unwrap()
            );
            assert_eq!(
                certificate.certificate_body.target_authority_public_key,
                vector["expected"]["authorityPublicKey"].as_str().unwrap()
            );
            for signature in 0..5 {
                let mut changed = certificate.clone();
                let target = match signature {
                    0 => {
                        &mut changed
                            .certificate_body
                            .handoff_authorization
                            .body
                            .readiness
                            .actor_signature
                    }
                    1 => {
                        &mut changed
                            .certificate_body
                            .handoff_authorization
                            .body
                            .readiness
                            .authority_possession_signature
                    }
                    2 => {
                        &mut changed
                            .certificate_body
                            .handoff_authorization
                            .predecessor_signature
                    }
                    3 => &mut changed.epoch_signature,
                    _ => &mut changed.authority_key_possession_signature,
                };
                *target = "00".repeat(64);
                let tampered =
                    encode_canonical_value(&serde_json::to_value(&changed).unwrap(), MAX_BYTES)
                        .unwrap();
                assert!(verify_predecessor_checkpoint_read(&tampered, &predecessor).is_err());
                assert!(
                    verify_writer_handoff_certificate_v1(&changed, &predecessor, actor).is_err()
                );
            }
        }
        // The browser catch-up fixture carries actual native checkpoint records,
        // not just a certificate paired with an unrelated synthetic state digest.
        let catchup: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/native-handoff-catchup-vector-v1.json"
        ))
        .unwrap();
        let baseline = &catchup["baseline"];
        let authority = &catchup["baselineRecords"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| {
                row["registryKey"] == "01_authority_epoch"
                    && row["primaryKey"] == baseline["authorityEpoch"]
            })
            .unwrap()["payload"];
        let pin = HandoffPredecessorV1 {
            library_id: baseline["libraryId"].as_str().unwrap(),
            epoch_id: baseline["authorityEpoch"].as_str().unwrap(),
            epoch: authority["epochNumber"].as_u64().unwrap(),
            certificate_digest: authority["transitionCertificateDigest"].as_str().unwrap(),
            authority_public_key: authority["authorityPublicKey"].as_str().unwrap(),
            writer_id: baseline["writerId"].as_str().unwrap(),
        };
        let proof = verify_predecessor_checkpoint_read(
            catchup["canonicalCertificate"].as_str().unwrap().as_bytes(),
            &pin,
        )
        .unwrap();
        assert_eq!(proof, catchup["expectedReadProof"]);
        let records: Vec<crate::normalized_checkpoint::NormalizedCheckpointRecordV2> =
            serde_json::from_value(catchup["predecessorRecords"].clone()).unwrap();
        assert_eq!(
            crate::normalized_import::normalized_checkpoint_digest_v2(&records).unwrap(),
            proof["checkpointDigest"].as_str().unwrap()
        );
    }
}
