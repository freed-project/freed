//! Durable state for a non-authoritative editable Library follower.
//!
//! These rows are deliberately separate from the active authority epoch and
//! cloud-writer admission. Installing an authenticated checkpoint anchor can
//! therefore make local materialized data readable without granting this
//! installation permission to commit canonical operations, run provider
//! capture, or advance the cloud control pointer.

use super::{
    is_lower_hex, AcceptedAuthorityState, JournalError, JournalResult, LibraryCoreJournal,
    MAX_CAUSAL_TIPS_PER_OPERATION, MAX_SAFE_INTEGER,
};
use crate::library_core_canonical::encode_canonical_value;
use rusqlite::{params, OptionalExtension, Result as SqlResult, Transaction, TransactionBehavior};
use serde_json::{json, Value};

const MAX_CONTROL_REVISION_BYTES: usize = 512;
const MAX_MANIFEST_OBJECT_KEY_BYTES: usize = 4_096;
const MAX_FRONTIER_BYTES: usize = 4_194_304;

fn invalid(field: &'static str) -> JournalError {
    JournalError::InvalidVerifiedInput { field }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedFollowerCheckpointActor {
    pub actor_id: String,
    pub accepted_sequence: i64,
    pub accepted_operation_id: Option<String>,
    pub accepted_chain_digest: String,
    pub enrollment_certificate_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedFollowerAnchor {
    pub authority: AcceptedAuthorityState,
    pub manifest_object_key: String,
    pub manifest_transport_object_id: String,
    pub manifest_content_digest: String,
    pub generation: i64,
    pub remote_ingest_sequence: i64,
    pub remote_materialized_digest: String,
    pub writer_id: String,
    pub control_revision: String,
    pub checkpoint_actor: Option<VerifiedFollowerCheckpointActor>,
    pub installed_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredFollowerActorRequest {
    pub library_id: String,
    pub epoch_id: String,
    pub actor_id: String,
    pub actor_public_key: String,
    pub enrollment_request_digest: String,
    pub canonical_enrollment_request_json: String,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredFollowerActorEnrollment {
    pub library_id: String,
    pub epoch_id: String,
    pub actor_id: String,
    pub actor_public_key: String,
    pub enrollment_certificate_digest: String,
    pub canonical_enrollment_certificate_json: String,
    pub actor_chain_genesis: String,
    pub enrolled_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FollowerIntentEnqueueReceipt {
    pub transaction_id: String,
    pub first_intent_sequence: i64,
    pub last_intent_sequence: i64,
    pub operation_count: i64,
    pub status: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FollowerIntentOutboxEntry {
    pub operation_id: String,
    pub intent_sequence: i64,
    pub canonical_envelope_json: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FollowerIntentOutboxCandidate {
    pub library_id: String,
    pub epoch_id: String,
    pub actor_id: String,
    pub schema_version: i64,
    pub first_intent_sequence: i64,
    pub last_intent_sequence: i64,
    pub previous_segment_digest: Option<String>,
    pub canonical_envelope_bytes: i64,
    pub transaction_count: i64,
    pub entries: Vec<FollowerIntentOutboxEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedFollowerIntentPublication {
    pub library_id: String,
    pub epoch_id: String,
    pub actor_id: String,
    pub first_intent_sequence: i64,
    pub last_intent_sequence: i64,
    pub previous_segment_digest: Option<String>,
    pub published_segment_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FollowerIntentPublicationReceipt {
    pub first_intent_sequence: i64,
    pub last_intent_sequence: i64,
    pub operation_count: i64,
    pub published_segment_digest: String,
    pub status: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedFollowerIntentResult {
    pub result_operation_id: String,
    pub result_sequence: i64,
    pub intent_operation_id: String,
    pub intent_sequence: i64,
    pub status: String,
    pub provider_receipt_digest: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedFollowerResultSegment {
    pub library_id: String,
    pub epoch_id: String,
    pub actor_id: String,
    pub first_result_sequence: i64,
    pub last_result_sequence: i64,
    pub previous_segment_digest: Option<String>,
    pub segment_digest: String,
    pub entries: Vec<VerifiedFollowerIntentResult>,
    pub imported_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FollowerResultImportCursor {
    pub next_result_sequence: i64,
    pub latest_segment_digest: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FollowerResultImportReceipt {
    pub first_result_sequence: i64,
    pub last_result_sequence: i64,
    pub result_count: i64,
    pub segment_digest: String,
    pub status: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FollowerRuntimeStatus {
    pub state: &'static str,
    pub library_id: Option<String>,
    pub epoch_id: Option<String>,
    pub actor_id: Option<String>,
    pub checkpoint_generation: Option<i64>,
    pub remote_ingest_sequence: Option<i64>,
    pub pending_intent_count: i64,
    pub published_intent_count: i64,
    pub imported_result_count: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowerOverlayReplayReceipt {
    pub transaction_count: i64,
    pub operation_count: i64,
    pub materialized_row_count: i64,
    pub revision_advanced: bool,
}

fn canonical_frontier(authority: &AcceptedAuthorityState) -> JournalResult<String> {
    if authority.observed_frontier.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
        return Err(invalid("follower_anchor.observed_frontier"));
    }
    let mut previous: Option<(&str, i64, &str, &str)> = None;
    let mut values = Vec::with_capacity(authority.observed_frontier.len());
    for tip in &authority.observed_frontier {
        if !is_lower_hex(&tip.actor_id, 32)
            || !(1..=MAX_SAFE_INTEGER).contains(&tip.sequence)
            || tip.operation_id.is_empty()
            || tip.operation_id.len() > 128
            || !is_lower_hex(&tip.chain_digest, 32)
        {
            return Err(invalid("follower_anchor.observed_frontier"));
        }
        let current = (
            tip.actor_id.as_str(),
            tip.sequence,
            tip.operation_id.as_str(),
            tip.chain_digest.as_str(),
        );
        if previous.is_some_and(|prior| prior >= current) {
            return Err(invalid("follower_anchor.observed_frontier"));
        }
        previous = Some(current);
        values.push(json!({
            "actor_id": tip.actor_id,
            "sequence": tip.sequence,
            "operation_id": tip.operation_id,
            "chain_digest": tip.chain_digest,
        }));
    }
    let bytes = encode_canonical_value(&Value::Array(values), MAX_FRONTIER_BYTES)
        .map_err(|_| invalid("follower_anchor.observed_frontier"))?;
    String::from_utf8(bytes).map_err(|_| invalid("follower_anchor.observed_frontier"))
}

fn validate_checkpoint_actor(actor: &VerifiedFollowerCheckpointActor) -> JournalResult<()> {
    if !is_lower_hex(&actor.actor_id, 32)
        || !(0..=MAX_SAFE_INTEGER).contains(&actor.accepted_sequence)
        || (actor.accepted_sequence == 0) != actor.accepted_operation_id.is_none()
        || actor
            .accepted_operation_id
            .as_ref()
            .is_some_and(|operation_id| operation_id.is_empty() || operation_id.len() > 128)
        || !is_lower_hex(&actor.accepted_chain_digest, 32)
        || !is_lower_hex(&actor.enrollment_certificate_digest, 32)
    {
        return Err(invalid("follower_anchor.checkpoint_actor"));
    }
    Ok(())
}

fn validate(anchor: &VerifiedFollowerAnchor) -> JournalResult<String> {
    let authority = &anchor.authority;
    if !is_lower_hex(&authority.library_id, 32)
        || !(1..=MAX_SAFE_INTEGER).contains(&authority.epoch)
        || !is_lower_hex(&authority.epoch_id, 32)
        || !is_lower_hex(&authority.authority_key_id, 32)
        || !is_lower_hex(&authority.authority_public_key, 32)
        || anchor.manifest_object_key.is_empty()
        || anchor.manifest_object_key.len() > MAX_MANIFEST_OBJECT_KEY_BYTES
        || anchor.manifest_transport_object_id.is_empty()
        || anchor.manifest_transport_object_id.len() > MAX_MANIFEST_OBJECT_KEY_BYTES
        || !is_lower_hex(&anchor.manifest_content_digest, 32)
        || !(0..=MAX_SAFE_INTEGER).contains(&anchor.generation)
        || !(0..=MAX_SAFE_INTEGER).contains(&anchor.remote_ingest_sequence)
        || !is_lower_hex(&anchor.remote_materialized_digest, 32)
        || !is_lower_hex(&anchor.writer_id, 32)
        || anchor.control_revision.is_empty()
        || anchor.control_revision.len() > MAX_CONTROL_REVISION_BYTES
        || !(0..=MAX_SAFE_INTEGER).contains(&anchor.installed_at_ms)
    {
        return Err(invalid("follower_anchor"));
    }
    if let Some(actor) = &anchor.checkpoint_actor {
        validate_checkpoint_actor(actor)?;
    }
    canonical_frontier(authority)
}

fn parse_frontier(value: &str) -> JournalResult<Vec<super::VerifiedCausalTip>> {
    let parsed: Value =
        serde_json::from_str(value).map_err(|_| invalid("follower_anchor.observed_frontier"))?;
    let entries = parsed
        .as_array()
        .ok_or_else(|| invalid("follower_anchor.observed_frontier"))?;
    let mut tips = Vec::with_capacity(entries.len());
    for entry in entries {
        let object = entry
            .as_object()
            .filter(|object| {
                object.len() == 4
                    && object.contains_key("actor_id")
                    && object.contains_key("sequence")
                    && object.contains_key("operation_id")
                    && object.contains_key("chain_digest")
            })
            .ok_or_else(|| invalid("follower_anchor.observed_frontier"))?;
        tips.push(super::VerifiedCausalTip {
            actor_id: object
                .get("actor_id")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("follower_anchor.observed_frontier"))?
                .to_string(),
            sequence: object
                .get("sequence")
                .and_then(Value::as_i64)
                .ok_or_else(|| invalid("follower_anchor.observed_frontier"))?,
            operation_id: object
                .get("operation_id")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("follower_anchor.observed_frontier"))?
                .to_string(),
            chain_digest: object
                .get("chain_digest")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("follower_anchor.observed_frontier"))?
                .to_string(),
        });
    }
    Ok(tips)
}

fn checkpoint_actor_from_storage(
    actor_id: Option<String>,
    accepted_sequence: Option<i64>,
    accepted_operation_id: Option<String>,
    accepted_chain_digest: Option<String>,
    enrollment_certificate_digest: Option<String>,
) -> JournalResult<Option<VerifiedFollowerCheckpointActor>> {
    match (
        actor_id,
        accepted_sequence,
        accepted_operation_id,
        accepted_chain_digest,
        enrollment_certificate_digest,
    ) {
        (None, None, None, None, None) => Ok(None),
        (
            Some(actor_id),
            Some(accepted_sequence),
            accepted_operation_id,
            Some(accepted_chain_digest),
            Some(enrollment_certificate_digest),
        ) => {
            let actor = VerifiedFollowerCheckpointActor {
                actor_id,
                accepted_sequence,
                accepted_operation_id,
                accepted_chain_digest,
                enrollment_certificate_digest,
            };
            validate_checkpoint_actor(&actor)?;
            Ok(Some(actor))
        }
        _ => Err(invalid("follower_anchor.checkpoint_actor")),
    }
}

impl LibraryCoreJournal {
    pub fn follower_runtime_status(&self) -> JournalResult<FollowerRuntimeStatus> {
        let Some(anchor) = self.follower_anchor()? else {
            return Ok(FollowerRuntimeStatus {
                state: "awaiting_checkpoint",
                library_id: None,
                epoch_id: None,
                actor_id: None,
                checkpoint_generation: None,
                remote_ingest_sequence: None,
                pending_intent_count: 0,
                published_intent_count: 0,
                imported_result_count: 0,
            });
        };
        let actor = self
            .connection
            .query_row(
                "SELECT actor.actorId,
                        actor.enrollmentCertificateDigest IS NOT NULL,
                        intent.nextIntentSequence,
                        intent.publishedThroughIntentSequence,
                        intent.nextResultSequence
                 FROM library_core_follower_actor AS actor
                 LEFT JOIN library_core_follower_intent_actor AS intent
                   ON intent.libraryId = actor.libraryId
                  AND intent.epochId = actor.epochId
                  AND intent.actorId = actor.actorId
                 WHERE actor.libraryId = ?1 AND actor.epochId = ?2;",
                params![anchor.authority.library_id, anchor.authority.epoch_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, bool>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                    ))
                },
            )
            .optional()?;
        let common = |state, actor_id, pending, published, imported| FollowerRuntimeStatus {
            state,
            library_id: Some(anchor.authority.library_id.clone()),
            epoch_id: Some(anchor.authority.epoch_id.clone()),
            actor_id,
            checkpoint_generation: Some(anchor.generation),
            remote_ingest_sequence: Some(anchor.remote_ingest_sequence),
            pending_intent_count: pending,
            published_intent_count: published,
            imported_result_count: imported,
        };
        let Some((actor_id, enrolled, next_intent, published_through, next_result)) = actor else {
            return Ok(common("awaiting_enrollment", None, 0, 0, 0));
        };
        if !enrolled {
            if next_intent.is_some() || published_through.is_some() || next_result.is_some() {
                return Err(invalid("follower_status.unenrolled_intent_state"));
            }
            return Ok(common("enrollment_pending", Some(actor_id), 0, 0, 0));
        }
        let (next_intent, published_through, next_result) =
            match (next_intent, published_through, next_result) {
                (Some(next_intent), Some(published_through), Some(next_result)) => {
                    (next_intent, published_through, next_result)
                }
                _ => return Err(invalid("follower_status.enrolled_intent_state")),
            };
        let pending = next_intent
            .checked_sub(published_through + 1)
            .ok_or_else(|| invalid("follower_status.intent_tip"))?;
        let imported = next_result
            .checked_sub(1)
            .ok_or_else(|| invalid("follower_status.result_tip"))?;
        let stored_results: i64 = self.connection.query_row(
            "SELECT COUNT(*)
             FROM library_core_follower_intent_result
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
            params![
                anchor.authority.library_id,
                anchor.authority.epoch_id,
                actor_id
            ],
            |row| row.get(0),
        )?;
        if stored_results != imported {
            return Err(invalid("follower_status.result_count"));
        }
        Ok(common(
            "active",
            Some(actor_id),
            pending,
            published_through,
            imported,
        ))
    }

    pub fn follower_anchor(&self) -> JournalResult<Option<VerifiedFollowerAnchor>> {
        let stored = self
            .connection
            .query_row(
                "SELECT libraryId, epoch, epochId, authorityKeyId,
                        authorityPublicKey, observedFrontierJson,
                        manifestObjectKey, manifestTransportObjectId,
                        manifestContentDigest, generation,
                        remoteIngestSequence, remoteMaterializedDigest,
                        writerId, controlRevision, checkpointActorId,
                        checkpointAcceptedSequence,
                        checkpointAcceptedOperationId,
                        checkpointAcceptedChainDigest,
                        checkpointEnrollmentCertificateDigest, installedAtMs
                 FROM library_core_follower_anchor WHERE singletonId = 1;",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, i64>(10)?,
                        row.get::<_, String>(11)?,
                        row.get::<_, String>(12)?,
                        row.get::<_, String>(13)?,
                        row.get::<_, Option<String>>(14)?,
                        row.get::<_, Option<i64>>(15)?,
                        row.get::<_, Option<String>>(16)?,
                        row.get::<_, Option<String>>(17)?,
                        row.get::<_, Option<String>>(18)?,
                        row.get::<_, i64>(19)?,
                    ))
                },
            )
            .optional()?;
        let Some(stored) = stored else {
            return Ok(None);
        };
        let Some(manifest_transport_object_id) = stored.7 else {
            return Ok(None);
        };
        let anchor = VerifiedFollowerAnchor {
            authority: AcceptedAuthorityState {
                library_id: stored.0,
                epoch: stored.1,
                epoch_id: stored.2,
                authority_key_id: stored.3,
                authority_public_key: stored.4,
                observed_frontier: parse_frontier(&stored.5)?,
            },
            manifest_object_key: stored.6,
            manifest_transport_object_id,
            manifest_content_digest: stored.8,
            generation: stored.9,
            remote_ingest_sequence: stored.10,
            remote_materialized_digest: stored.11,
            writer_id: stored.12,
            control_revision: stored.13,
            checkpoint_actor: checkpoint_actor_from_storage(
                stored.14, stored.15, stored.16, stored.17, stored.18,
            )?,
            installed_at_ms: stored.19,
        };
        let canonical = validate(&anchor)?;
        if canonical != stored.5 {
            return Err(invalid("follower_anchor.observed_frontier"));
        }
        Ok(Some(anchor))
    }

    pub fn follower_actor_request(
        &self,
        library_id: &str,
        epoch_id: &str,
    ) -> JournalResult<Option<StoredFollowerActorRequest>> {
        self.connection
            .query_row(
                "SELECT libraryId, epochId, actorId, actorPublicKey,
                        enrollmentRequestDigest,
                        canonicalEnrollmentRequestJson, createdAtMs
                 FROM library_core_follower_actor
                 WHERE libraryId = ?1 AND epochId = ?2;",
                params![library_id, epoch_id],
                |row| {
                    Ok(StoredFollowerActorRequest {
                        library_id: row.get(0)?,
                        epoch_id: row.get(1)?,
                        actor_id: row.get(2)?,
                        actor_public_key: row.get(3)?,
                        enrollment_request_digest: row.get(4)?,
                        canonical_enrollment_request_json: row.get(5)?,
                        created_at_ms: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn follower_actor_enrollment(
        &self,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<StoredFollowerActorEnrollment>> {
        self.connection
            .query_row(
                "SELECT libraryId, epochId, actorId, actorPublicKey,
                        enrollmentCertificateDigest,
                        canonicalEnrollmentCertificateJson, actorChainGenesis,
                        enrolledAtMs
                 FROM library_core_follower_actor
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
                   AND enrollmentCertificateDigest IS NOT NULL;",
                params![library_id, epoch_id, actor_id],
                |row| {
                    Ok(StoredFollowerActorEnrollment {
                        library_id: row.get(0)?,
                        epoch_id: row.get(1)?,
                        actor_id: row.get(2)?,
                        actor_public_key: row.get(3)?,
                        enrollment_certificate_digest: row.get(4)?,
                        canonical_enrollment_certificate_json: row.get(5)?,
                        actor_chain_genesis: row.get(6)?,
                        enrolled_at_ms: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn follower_actor_state(
        &self,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<super::ActorState>> {
        self.connection
            .query_row(
                "SELECT actor.libraryId, anchor.epoch, actor.epochId,
                        actor.actorId, actor.actorPublicKey,
                        json_extract(actor.canonicalEnrollmentCertificateJson,
                                     '$.certificate_body.actor_enrollment_body.operation_id'),
                        actor.enrollmentCertificateDigest,
                        actor.canonicalEnrollmentCertificateJson,
                        actor.actorChainGenesis, intent.nextIntentSequence,
                        intent.latestOperationId, intent.latestActorChainDigest,
                        actor.enrolledAtMs
                 FROM library_core_follower_actor AS actor
                 JOIN library_core_follower_anchor AS anchor
                   ON anchor.libraryId = actor.libraryId
                  AND anchor.epochId = actor.epochId
                 JOIN library_core_follower_intent_actor AS intent
                   ON intent.libraryId = actor.libraryId
                  AND intent.epochId = actor.epochId
                  AND intent.actorId = actor.actorId
                 WHERE actor.libraryId = ?1 AND actor.epochId = ?2
                   AND actor.actorId = ?3
                   AND actor.enrollmentCertificateDigest IS NOT NULL
                   AND json_type(actor.canonicalEnrollmentCertificateJson,
                                 '$.certificate_body.actor_capability_body') IS NULL;",
                params![library_id, epoch_id, actor_id],
                |row| {
                    Ok(super::ActorState {
                        library_id: row.get(0)?,
                        epoch: row.get(1)?,
                        epoch_id: row.get(2)?,
                        actor_id: row.get(3)?,
                        actor_public_key: row.get(4)?,
                        enrollment_operation_id: row.get(5)?,
                        enrollment_certificate_digest: row.get(6)?,
                        canonical_enrollment_certificate_json: row.get(7)?,
                        actor_chain_genesis: row.get(8)?,
                        next_sequence: row.get(9)?,
                        previous_operation_id: row.get(10)?,
                        previous_chain_digest: row.get(11)?,
                        retired: false,
                        capability:
                            super::actor_capability::ActorCapabilityState::historical_editor(
                                row.get(6)?,
                                row.get(12)?,
                            ),
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn active_follower_actor_state(&self) -> JournalResult<Option<super::ActorState>> {
        let Some(anchor) = self.follower_anchor()? else {
            return Ok(None);
        };
        let actor_id = self
            .connection
            .query_row(
                "SELECT actorId FROM library_core_follower_actor
                 WHERE libraryId = ?1 AND epochId = ?2
                   AND enrollmentCertificateDigest IS NOT NULL;",
                params![anchor.authority.library_id, anchor.authority.epoch_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(actor_id) = actor_id else {
            return Ok(None);
        };
        self.follower_actor_state(
            &anchor.authority.library_id,
            &anchor.authority.epoch_id,
            &actor_id,
        )
    }

    pub fn store_follower_actor_request(
        &mut self,
        request: &StoredFollowerActorRequest,
    ) -> JournalResult<StoredFollowerActorRequest> {
        if !is_lower_hex(&request.library_id, 32)
            || !is_lower_hex(&request.epoch_id, 32)
            || !is_lower_hex(&request.actor_id, 32)
            || !is_lower_hex(&request.actor_public_key, 32)
            || !is_lower_hex(&request.enrollment_request_digest, 32)
            || request.canonical_enrollment_request_json.is_empty()
            || request.canonical_enrollment_request_json.len() > 65_536
            || !(0..=MAX_SAFE_INTEGER).contains(&request.created_at_ms)
        {
            return Err(invalid("follower_actor_request"));
        }
        let parsed: Value = serde_json::from_str(&request.canonical_enrollment_request_json)
            .map_err(|_| invalid("follower_actor_request.canonical_json"))?;
        let canonical = encode_canonical_value(&parsed, 65_536)
            .map_err(|_| invalid("follower_actor_request.canonical_json"))?;
        if canonical != request.canonical_enrollment_request_json.as_bytes() {
            return Err(invalid("follower_actor_request.canonical_json"));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let anchor_matches: bool = transaction.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM library_core_follower_anchor
               WHERE singletonId = 1 AND libraryId = ?1 AND epochId = ?2
             );",
            params![request.library_id, request.epoch_id],
            |row| row.get(0),
        )?;
        if !anchor_matches {
            return Err(invalid("follower_actor_request.anchor"));
        }
        let existing = transaction
            .query_row(
                "SELECT actorId, actorPublicKey, enrollmentRequestDigest,
                        canonicalEnrollmentRequestJson, createdAtMs
                 FROM library_core_follower_actor
                 WHERE libraryId = ?1 AND epochId = ?2;",
                params![request.library_id, request.epoch_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing
                != (
                    request.actor_id.clone(),
                    request.actor_public_key.clone(),
                    request.enrollment_request_digest.clone(),
                    request.canonical_enrollment_request_json.clone(),
                    request.created_at_ms,
                )
            {
                return Err(invalid("follower_actor_request.replay"));
            }
        } else {
            transaction.execute(
                "INSERT INTO library_core_follower_actor (
                   libraryId, epochId, actorId, actorPublicKey,
                   enrollmentRequestDigest, canonicalEnrollmentRequestJson,
                   createdAtMs
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
                params![
                    request.library_id,
                    request.epoch_id,
                    request.actor_id,
                    request.actor_public_key,
                    request.enrollment_request_digest,
                    request.canonical_enrollment_request_json,
                    request.created_at_ms,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(request.clone())
    }

    pub(super) fn install_verified_follower_actor_enrollment(
        &mut self,
        enrollment: &super::VerifiedActorEnrollment,
    ) -> JournalResult<StoredFollowerActorEnrollment> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let request = transaction
            .query_row(
                "SELECT actorPublicKey, enrollmentRequestDigest,
                        enrollmentCertificateDigest,
                        canonicalEnrollmentCertificateJson, actorChainGenesis,
                        enrolledAtMs
                 FROM library_core_follower_actor
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![
                    enrollment.library_id,
                    enrollment.epoch_id,
                    enrollment.actor_id
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| invalid("follower_actor_enrollment.request"))?;
        if request.0 != enrollment.actor_public_key
            || request.1 != enrollment.enrollment_certificate_digest
        {
            return Err(invalid("follower_actor_enrollment.request_binding"));
        }
        let existing = (request.2, request.3, request.4, request.5);
        let candidate = (
            Some(enrollment.enrollment_certificate_digest.clone()),
            Some(enrollment.canonical_enrollment_certificate_json.clone()),
            Some(enrollment.actor_chain_genesis.clone()),
            Some(enrollment.enrolled_at_ms),
        );
        if existing == (None, None, None, None) {
            transaction.execute(
                "UPDATE library_core_follower_actor
                 SET enrollmentCertificateDigest = ?1,
                     canonicalEnrollmentCertificateJson = ?2,
                     actorChainGenesis = ?3, enrolledAtMs = ?4
                 WHERE libraryId = ?5 AND epochId = ?6 AND actorId = ?7;",
                params![
                    enrollment.enrollment_certificate_digest,
                    enrollment.canonical_enrollment_certificate_json,
                    enrollment.actor_chain_genesis,
                    enrollment.enrolled_at_ms,
                    enrollment.library_id,
                    enrollment.epoch_id,
                    enrollment.actor_id,
                ],
            )?;
        } else if existing != candidate {
            return Err(invalid("follower_actor_enrollment.replay"));
        }
        transaction.execute(
            "INSERT OR IGNORE INTO library_core_follower_intent_actor (
               libraryId, epochId, actorId, nextIntentSequence,
               latestOperationId, latestActorChainDigest,
               publishedThroughIntentSequence, latestPublishedSegmentDigest,
               nextResultSequence, latestResultSegmentDigest
             ) VALUES (?1, ?2, ?3, 1, NULL, ?4, 0, NULL, 1, NULL);",
            params![
                enrollment.library_id,
                enrollment.epoch_id,
                enrollment.actor_id,
                enrollment.actor_chain_genesis,
            ],
        )?;
        let actor_chain_genesis: String = transaction.query_row(
            "SELECT latestActorChainDigest
             FROM library_core_follower_intent_actor
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
            params![
                enrollment.library_id,
                enrollment.epoch_id,
                enrollment.actor_id
            ],
            |row| row.get(0),
        )?;
        if actor_chain_genesis != enrollment.actor_chain_genesis {
            return Err(invalid("follower_actor_enrollment.intent_actor"));
        }
        transaction.commit()?;
        Ok(StoredFollowerActorEnrollment {
            library_id: enrollment.library_id.clone(),
            epoch_id: enrollment.epoch_id.clone(),
            actor_id: enrollment.actor_id.clone(),
            actor_public_key: enrollment.actor_public_key.clone(),
            enrollment_certificate_digest: enrollment.enrollment_certificate_digest.clone(),
            canonical_enrollment_certificate_json: enrollment
                .canonical_enrollment_certificate_json
                .clone(),
            actor_chain_genesis: enrollment.actor_chain_genesis.clone(),
            enrolled_at_ms: enrollment.enrolled_at_ms,
        })
    }

    pub(super) fn enqueue_verified_follower_transaction(
        &mut self,
        verified: &super::VerifiedOperationTransaction,
        enqueued_at_ms: i64,
    ) -> JournalResult<FollowerIntentEnqueueReceipt> {
        if !(0..=MAX_SAFE_INTEGER).contains(&enqueued_at_ms) {
            return Err(invalid("follower_intent.enqueued_at_ms"));
        }
        let first = verified
            .members
            .first()
            .ok_or_else(|| invalid("follower_intent.members"))?;
        let last = verified
            .members
            .last()
            .ok_or_else(|| invalid("follower_intent.members"))?;
        let operation_count = i64::try_from(verified.members.len())
            .map_err(|_| invalid("follower_intent.members"))?;
        let receipt = |status| FollowerIntentEnqueueReceipt {
            transaction_id: verified.transaction_id.clone(),
            first_intent_sequence: first.actor_sequence,
            last_intent_sequence: last.actor_sequence,
            operation_count,
            status,
        };
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = transaction
            .query_row(
                "SELECT transactionDigest, libraryId, epochId, actorId,
                        firstIntentSequence, lastIntentSequence, operationCount,
                        canonicalEnvelopeBytes
                 FROM library_core_follower_intent_transaction
                 WHERE transactionId = ?1;",
                [&verified.transaction_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing
                != (
                    verified.transaction_digest.clone(),
                    verified.library_id.clone(),
                    verified.epoch_id.clone(),
                    verified.actor_id.clone(),
                    first.actor_sequence,
                    last.actor_sequence,
                    operation_count,
                    verified.canonical_envelope_bytes as i64,
                )
            {
                return Err(invalid("follower_intent.transaction_replay"));
            }
            transaction.commit()?;
            return Ok(receipt("already_enqueued"));
        }
        let actor_tip = transaction
            .query_row(
                "SELECT nextIntentSequence, latestOperationId,
                        latestActorChainDigest
                 FROM library_core_follower_intent_actor
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![verified.library_id, verified.epoch_id, verified.actor_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| invalid("follower_intent.actor"))?;
        if actor_tip.0 != first.actor_sequence
            || actor_tip.1 != first.previous_actor_operation_id
            || actor_tip.2 != first.previous_actor_chain_digest
        {
            return Err(invalid("follower_intent.actor_tip"));
        }
        let frontier_json: String = transaction.query_row(
            "SELECT observedFrontierJson
             FROM library_core_follower_anchor
             WHERE singletonId = 1 AND libraryId = ?1 AND epochId = ?2;",
            params![verified.library_id, verified.epoch_id],
            |row| row.get(0),
        )?;
        let frontier = parse_frontier(&frontier_json)?;
        for (member_index, member) in verified.members.iter().enumerate() {
            for tip in &member.causal_tips {
                let in_anchor = frontier.iter().any(|candidate| candidate == tip);
                let in_current = verified.members[..member_index].iter().any(|candidate| {
                    candidate.operation_id == tip.operation_id
                        && candidate.actor_sequence == tip.sequence
                        && candidate.actor_chain_digest == tip.chain_digest
                        && verified.actor_id == tip.actor_id
                });
                let in_outbox = transaction.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM library_core_follower_intent_operation
                       WHERE operationId = ?1 AND actorId = ?2
                         AND intentSequence = ?3 AND actorChainDigest = ?4
                     );",
                    params![
                        tip.operation_id,
                        tip.actor_id,
                        tip.sequence,
                        tip.chain_digest
                    ],
                    |row| row.get::<_, bool>(0),
                )?;
                if !in_anchor && !in_current && !in_outbox {
                    return Err(invalid("follower_intent.causal_tip"));
                }
            }
        }
        transaction.execute(
            "INSERT INTO library_core_follower_intent_transaction (
               transactionId, transactionDigest, libraryId, epochId, actorId,
               firstIntentSequence, lastIntentSequence, operationCount,
               canonicalEnvelopeBytes, enqueuedAtMs
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
            params![
                verified.transaction_id,
                verified.transaction_digest,
                verified.library_id,
                verified.epoch_id,
                verified.actor_id,
                first.actor_sequence,
                last.actor_sequence,
                operation_count,
                verified.canonical_envelope_bytes as i64,
                enqueued_at_ms,
            ],
        )?;
        for (index, member) in verified.members.iter().enumerate() {
            transaction.execute(
                "INSERT INTO library_core_follower_intent_operation (
                   operationId, transactionId, transactionMemberIndex,
                   libraryId, epochId, actorId, intentSequence,
                   actorChainDigest, canonicalEnvelopeJson, envelopeDigest
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
                params![
                    member.operation_id,
                    verified.transaction_id,
                    index as i64,
                    verified.library_id,
                    verified.epoch_id,
                    verified.actor_id,
                    member.actor_sequence,
                    member.actor_chain_digest,
                    member.canonical_envelope_json,
                    member.envelope_digest,
                ],
            )?;
        }
        let mut materialized_rows = 0usize;
        for member in &verified.members {
            if member.entity_type == "FeedItem" && member.item_json.is_none() {
                let exists: bool = transaction.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM library_core_feed_items
                       WHERE globalId = ?1 AND deletedAt IS NULL
                     );",
                    [&member.entity_id],
                    |row| row.get(0),
                )?;
                if !exists {
                    return Err(invalid("follower_intent.entity"));
                }
            }
            materialized_rows +=
                Self::materialize_product_member(&transaction, member, enqueued_at_ms)?;
        }
        if materialized_rows > 0 {
            let updated = transaction.execute(
                "UPDATE library_core_desktop_state
                 SET revision = revision + 1
                 WHERE singletonId = 1 AND active = 1
                   AND revision < 9007199254740991;",
                [],
            )?;
            if updated != 1 {
                return Err(invalid("follower_intent.desktop_revision"));
            }
        }
        transaction.execute(
            "UPDATE library_core_follower_intent_actor
             SET nextIntentSequence = ?1, latestOperationId = ?2,
                 latestActorChainDigest = ?3
             WHERE libraryId = ?4 AND epochId = ?5 AND actorId = ?6;",
            params![
                last.actor_sequence + 1,
                last.operation_id,
                last.actor_chain_digest,
                verified.library_id,
                verified.epoch_id,
                verified.actor_id,
            ],
        )?;
        transaction.commit()?;
        Ok(receipt("enqueued"))
    }

    pub fn replay_pending_follower_overlay(
        &mut self,
    ) -> JournalResult<FollowerOverlayReplayReceipt> {
        self.replay_pending_follower_overlay_with(|journal, envelopes| {
            journal.verify_follower_operation_transaction(envelopes)
        })
    }

    fn replay_pending_follower_overlay_with<F>(
        &mut self,
        mut verify: F,
    ) -> JournalResult<FollowerOverlayReplayReceipt>
    where
        F: FnMut(
            &LibraryCoreJournal,
            &[Vec<u8>],
        ) -> JournalResult<super::VerifiedOperationTransaction>,
    {
        let Some(anchor) = self.follower_anchor()? else {
            return Ok(FollowerOverlayReplayReceipt {
                transaction_count: 0,
                operation_count: 0,
                materialized_row_count: 0,
                revision_advanced: false,
            });
        };
        let Some(actor) = self.active_follower_actor_state()? else {
            return Ok(FollowerOverlayReplayReceipt {
                transaction_count: 0,
                operation_count: 0,
                materialized_row_count: 0,
                revision_advanced: false,
            });
        };
        let checkpoint_accepted_sequence = match &anchor.checkpoint_actor {
            Some(checkpoint_actor)
                if checkpoint_actor.actor_id == actor.actor_id
                    && checkpoint_actor.enrollment_certificate_digest
                        == actor.enrollment_certificate_digest =>
            {
                if checkpoint_actor.accepted_sequence == 0 {
                    if checkpoint_actor.accepted_chain_digest != actor.actor_chain_genesis {
                        return Err(invalid("follower_overlay.checkpoint_actor_tip"));
                    }
                } else {
                    let local_tip = self
                        .connection
                        .query_row(
                            "SELECT operationId, actorChainDigest
                             FROM library_core_follower_intent_operation
                             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
                               AND intentSequence = ?4;",
                            params![
                                actor.library_id,
                                actor.epoch_id,
                                actor.actor_id,
                                checkpoint_actor.accepted_sequence,
                            ],
                            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                        )
                        .optional()?;
                    let Some((operation_id, chain_digest)) = local_tip else {
                        return Err(invalid("follower_overlay.checkpoint_actor_tip"));
                    };
                    if checkpoint_actor.accepted_operation_id.as_deref()
                        != Some(operation_id.as_str())
                        || checkpoint_actor.accepted_chain_digest != chain_digest
                    {
                        return Err(invalid("follower_overlay.checkpoint_actor_tip"));
                    }
                }
                checkpoint_actor.accepted_sequence
            }
            Some(_) => return Err(invalid("follower_overlay.checkpoint_actor")),
            None => 0,
        };
        let imported_source = self
            .connection
            .query_row(
                "SELECT sourceGeneration, sourceRevision
                 FROM library_core_desktop_state
                 WHERE singletonId = 1 AND active = 1;",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        if imported_source != Some((anchor.authority.epoch, anchor.remote_ingest_sequence)) {
            return Err(invalid("follower_overlay.checkpoint_anchor"));
        }
        let mut statement = self.connection.prepare(
            "SELECT intent_tx.transactionId, intent_tx.operationCount,
                    intent_tx.enqueuedAtMs, intent_tx.firstIntentSequence,
                    intent_tx.lastIntentSequence
             FROM library_core_follower_intent_transaction AS intent_tx
             WHERE intent_tx.libraryId = ?1
               AND intent_tx.epochId = ?2
               AND intent_tx.actorId = ?3
             ORDER BY intent_tx.firstIntentSequence;",
        )?;
        let candidates = statement
            .query_map(
                params![actor.library_id, actor.epoch_id, actor.actor_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )?
            .collect::<SqlResult<Vec<_>>>()?;
        drop(statement);

        let mut replay = Vec::new();
        for (
            transaction_id,
            operation_count,
            enqueued_at_ms,
            first_intent_sequence,
            last_intent_sequence,
        ) in candidates
        {
            if last_intent_sequence <= checkpoint_accepted_sequence {
                continue;
            }
            if first_intent_sequence <= checkpoint_accepted_sequence {
                return Err(invalid("follower_overlay.checkpoint_actor_split"));
            }
            let mut statement = self.connection.prepare(
                "SELECT canonicalEnvelopeJson
                 FROM library_core_follower_intent_operation
                 WHERE transactionId = ?1
                 ORDER BY transactionMemberIndex;",
            )?;
            let envelopes = statement
                .query_map([&transaction_id], |row| row.get::<_, String>(0))?
                .collect::<SqlResult<Vec<_>>>()?
                .into_iter()
                .map(String::into_bytes)
                .collect::<Vec<_>>();
            drop(statement);
            if i64::try_from(envelopes.len()).ok() != Some(operation_count) {
                return Err(invalid("follower_overlay.operation_count"));
            }
            let verified = verify(self, &envelopes)?;
            if verified.transaction_id != transaction_id {
                return Err(invalid("follower_overlay.transaction"));
            }
            replay.push((verified, enqueued_at_ms));
        }

        let transaction_count =
            i64::try_from(replay.len()).map_err(|_| invalid("follower_overlay.bounds"))?;
        let operation_count = replay.iter().try_fold(0i64, |total, (verified, _)| {
            let count = i64::try_from(verified.members.len())
                .map_err(|_| invalid("follower_overlay.bounds"))?;
            total
                .checked_add(count)
                .ok_or_else(|| invalid("follower_overlay.bounds"))
        })?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut materialized_rows = 0usize;
        for (verified, enqueued_at_ms) in &replay {
            for member in &verified.members {
                if member.entity_type == "FeedItem" && member.item_json.is_none() {
                    let exists: bool = transaction.query_row(
                        "SELECT EXISTS(
                           SELECT 1 FROM library_core_feed_items
                           WHERE globalId = ?1 AND deletedAt IS NULL
                         );",
                        [&member.entity_id],
                        |row| row.get(0),
                    )?;
                    if !exists {
                        return Err(invalid("follower_overlay.entity"));
                    }
                }
                materialized_rows +=
                    Self::materialize_product_member(&transaction, member, *enqueued_at_ms)?;
            }
        }
        let revision_advanced = materialized_rows > 0;
        if revision_advanced {
            let updated = transaction.execute(
                "UPDATE library_core_desktop_state
                 SET revision = revision + 1
                 WHERE singletonId = 1 AND active = 1
                   AND revision < 9007199254740991;",
                [],
            )?;
            if updated != 1 {
                return Err(invalid("follower_overlay.desktop_revision"));
            }
        }
        transaction.commit()?;
        Ok(FollowerOverlayReplayReceipt {
            transaction_count,
            operation_count,
            materialized_row_count: i64::try_from(materialized_rows)
                .map_err(|_| invalid("follower_overlay.bounds"))?,
            revision_advanced,
        })
    }

    pub fn follower_intent_outbox_candidate(
        &self,
        maximum_operations: usize,
        maximum_canonical_envelope_bytes: usize,
    ) -> JournalResult<Option<FollowerIntentOutboxCandidate>> {
        if maximum_operations == 0
            || maximum_operations > 1_000
            || maximum_canonical_envelope_bytes == 0
            || maximum_canonical_envelope_bytes > 4_194_304
        {
            return Err(invalid("follower_intent_candidate.bounds"));
        }
        let Some((
            library_id,
            epoch_id,
            actor_id,
            next_intent_sequence,
            published_through,
            previous_segment_digest,
        )) = self
            .connection
            .query_row(
                "SELECT libraryId, epochId, actorId, nextIntentSequence,
                        publishedThroughIntentSequence,
                        latestPublishedSegmentDigest
                 FROM library_core_follower_intent_actor
                 ORDER BY libraryId, epochId, actorId
                 LIMIT 1;",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(None);
        };
        let first_intent_sequence = published_through + 1;
        if first_intent_sequence == next_intent_sequence {
            return Ok(None);
        }
        if first_intent_sequence > next_intent_sequence {
            return Err(invalid("follower_intent_candidate.actor_tip"));
        }

        let mut statement = self.connection.prepare(
            "SELECT firstIntentSequence, lastIntentSequence, operationCount,
                    canonicalEnvelopeBytes
             FROM library_core_follower_intent_transaction
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
               AND firstIntentSequence >= ?4
             ORDER BY firstIntentSequence;",
        )?;
        let mut rows = statement.query(params![
            library_id,
            epoch_id,
            actor_id,
            first_intent_sequence
        ])?;
        let mut expected_sequence = first_intent_sequence;
        let mut operation_count = 0usize;
        let mut canonical_envelope_bytes = 0usize;
        let mut transaction_count = 0usize;
        let mut last_intent_sequence = 0i64;
        while let Some(row) = rows.next()? {
            let transaction_first = row.get::<_, i64>(0)?;
            let transaction_last = row.get::<_, i64>(1)?;
            let transaction_operations = usize::try_from(row.get::<_, i64>(2)?)
                .map_err(|_| invalid("follower_intent_candidate.transaction"))?;
            let transaction_bytes = usize::try_from(row.get::<_, i64>(3)?)
                .map_err(|_| invalid("follower_intent_candidate.transaction"))?;
            if transaction_first != expected_sequence
                || transaction_last
                    != transaction_first + i64::try_from(transaction_operations).unwrap_or(0) - 1
            {
                return Err(invalid("follower_intent_candidate.transaction_gap"));
            }
            if operation_count + transaction_operations > maximum_operations
                || canonical_envelope_bytes + transaction_bytes > maximum_canonical_envelope_bytes
            {
                if transaction_count == 0 {
                    return Err(invalid("follower_intent_candidate.transaction_bounds"));
                }
                break;
            }
            operation_count += transaction_operations;
            canonical_envelope_bytes += transaction_bytes;
            transaction_count += 1;
            last_intent_sequence = transaction_last;
            expected_sequence = transaction_last + 1;
        }
        drop(rows);
        drop(statement);
        if transaction_count == 0 || operation_count == 0 {
            return Err(invalid("follower_intent_candidate.transaction_missing"));
        }

        let mut statement = self.connection.prepare(
            "SELECT operationId, intentSequence, canonicalEnvelopeJson,
                    publishedSegmentDigest
             FROM library_core_follower_intent_operation
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
               AND intentSequence BETWEEN ?4 AND ?5
             ORDER BY intentSequence;",
        )?;
        let entries = statement
            .query_map(
                params![
                    library_id,
                    epoch_id,
                    actor_id,
                    first_intent_sequence,
                    last_intent_sequence
                ],
                |row| {
                    Ok((
                        FollowerIntentOutboxEntry {
                            operation_id: row.get(0)?,
                            intent_sequence: row.get(1)?,
                            canonical_envelope_json: row.get(2)?,
                        },
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )?
            .collect::<SqlResult<Vec<_>>>()?;
        if entries.len() != operation_count
            || entries
                .iter()
                .enumerate()
                .any(|(index, (entry, published))| {
                    entry.intent_sequence != first_intent_sequence + index as i64
                        || published.is_some()
                })
        {
            return Err(invalid("follower_intent_candidate.operations"));
        }
        Ok(Some(FollowerIntentOutboxCandidate {
            library_id,
            epoch_id,
            actor_id,
            schema_version: 1,
            first_intent_sequence,
            last_intent_sequence,
            previous_segment_digest,
            canonical_envelope_bytes: canonical_envelope_bytes as i64,
            transaction_count: transaction_count as i64,
            entries: entries.into_iter().map(|(entry, _)| entry).collect(),
        }))
    }

    pub fn record_follower_intent_publication(
        &mut self,
        publication: &VerifiedFollowerIntentPublication,
    ) -> JournalResult<FollowerIntentPublicationReceipt> {
        if !is_lower_hex(&publication.library_id, 32)
            || !is_lower_hex(&publication.epoch_id, 32)
            || !is_lower_hex(&publication.actor_id, 32)
            || !is_lower_hex(&publication.published_segment_digest, 32)
            || publication
                .previous_segment_digest
                .as_ref()
                .is_some_and(|digest| !is_lower_hex(digest, 32))
            || !(1..=MAX_SAFE_INTEGER).contains(&publication.first_intent_sequence)
            || publication.last_intent_sequence < publication.first_intent_sequence
            || publication.last_intent_sequence > MAX_SAFE_INTEGER
        {
            return Err(invalid("follower_intent_publication"));
        }
        let operation_count =
            publication.last_intent_sequence - publication.first_intent_sequence + 1;
        let receipt = |status| FollowerIntentPublicationReceipt {
            first_intent_sequence: publication.first_intent_sequence,
            last_intent_sequence: publication.last_intent_sequence,
            operation_count,
            published_segment_digest: publication.published_segment_digest.clone(),
            status,
        };
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (next_intent_sequence, published_through, latest_segment_digest) = transaction
            .query_row(
                "SELECT nextIntentSequence, publishedThroughIntentSequence,
                        latestPublishedSegmentDigest
                 FROM library_core_follower_intent_actor
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![
                    publication.library_id,
                    publication.epoch_id,
                    publication.actor_id
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| invalid("follower_intent_publication.actor"))?;
        let matching_operations: i64 = transaction.query_row(
            "SELECT COUNT(*)
             FROM library_core_follower_intent_operation
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
               AND intentSequence BETWEEN ?4 AND ?5
               AND publishedSegmentDigest = ?6;",
            params![
                publication.library_id,
                publication.epoch_id,
                publication.actor_id,
                publication.first_intent_sequence,
                publication.last_intent_sequence,
                publication.published_segment_digest,
            ],
            |row| row.get(0),
        )?;
        if publication.last_intent_sequence <= published_through {
            if matching_operations != operation_count {
                return Err(invalid("follower_intent_publication.replay"));
            }
            transaction.commit()?;
            return Ok(receipt("already_recorded"));
        }
        if publication.first_intent_sequence != published_through + 1
            || publication.last_intent_sequence >= next_intent_sequence
            || publication.previous_segment_digest != latest_segment_digest
        {
            return Err(invalid("follower_intent_publication.actor_tip"));
        }
        let (covered_transactions, covered_operations, minimum_first, maximum_last): (
            i64,
            i64,
            Option<i64>,
            Option<i64>,
        ) = transaction.query_row(
            "SELECT COUNT(*), COALESCE(SUM(operationCount), 0),
                    MIN(firstIntentSequence), MAX(lastIntentSequence)
             FROM library_core_follower_intent_transaction
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
               AND firstIntentSequence >= ?4 AND lastIntentSequence <= ?5;",
            params![
                publication.library_id,
                publication.epoch_id,
                publication.actor_id,
                publication.first_intent_sequence,
                publication.last_intent_sequence,
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        let crossing_transactions: i64 = transaction.query_row(
            "SELECT COUNT(*)
             FROM library_core_follower_intent_transaction
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
               AND firstIntentSequence <= ?5 AND lastIntentSequence >= ?4
               AND NOT (firstIntentSequence >= ?4 AND lastIntentSequence <= ?5);",
            params![
                publication.library_id,
                publication.epoch_id,
                publication.actor_id,
                publication.first_intent_sequence,
                publication.last_intent_sequence,
            ],
            |row| row.get(0),
        )?;
        if covered_transactions < 1
            || covered_operations != operation_count
            || minimum_first != Some(publication.first_intent_sequence)
            || maximum_last != Some(publication.last_intent_sequence)
            || crossing_transactions != 0
        {
            return Err(invalid("follower_intent_publication.transactions"));
        }
        let updated = transaction.execute(
            "UPDATE library_core_follower_intent_operation
             SET publishedSegmentDigest = ?1
             WHERE libraryId = ?2 AND epochId = ?3 AND actorId = ?4
               AND intentSequence BETWEEN ?5 AND ?6
               AND publishedSegmentDigest IS NULL;",
            params![
                publication.published_segment_digest,
                publication.library_id,
                publication.epoch_id,
                publication.actor_id,
                publication.first_intent_sequence,
                publication.last_intent_sequence,
            ],
        )?;
        if updated as i64 != operation_count {
            return Err(invalid("follower_intent_publication.operations"));
        }
        transaction.execute(
            "UPDATE library_core_follower_intent_actor
             SET publishedThroughIntentSequence = ?1,
                 latestPublishedSegmentDigest = ?2
             WHERE libraryId = ?3 AND epochId = ?4 AND actorId = ?5;",
            params![
                publication.last_intent_sequence,
                publication.published_segment_digest,
                publication.library_id,
                publication.epoch_id,
                publication.actor_id,
            ],
        )?;
        transaction.commit()?;
        Ok(receipt("recorded"))
    }

    pub fn follower_result_import_cursor(
        &self,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<FollowerResultImportCursor>> {
        self.connection
            .query_row(
                "SELECT nextResultSequence, latestResultSegmentDigest
                 FROM library_core_follower_intent_actor
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![library_id, epoch_id, actor_id],
                |row| {
                    Ok(FollowerResultImportCursor {
                        next_result_sequence: row.get(0)?,
                        latest_segment_digest: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn append_follower_result_segment(
        &mut self,
        segment: &VerifiedFollowerResultSegment,
    ) -> JournalResult<FollowerResultImportReceipt> {
        if !is_lower_hex(&segment.library_id, 32)
            || !is_lower_hex(&segment.epoch_id, 32)
            || !is_lower_hex(&segment.actor_id, 32)
            || !is_lower_hex(&segment.segment_digest, 32)
            || segment
                .previous_segment_digest
                .as_ref()
                .is_some_and(|digest| !is_lower_hex(digest, 32))
            || !(0..=MAX_SAFE_INTEGER).contains(&segment.imported_at_ms)
            || !(1..=MAX_SAFE_INTEGER).contains(&segment.first_result_sequence)
            || segment.last_result_sequence < segment.first_result_sequence
            || segment.last_result_sequence > MAX_SAFE_INTEGER
            || segment.entries.is_empty()
            || segment.entries.len() > 1_000
            || segment.last_result_sequence - segment.first_result_sequence + 1
                != segment.entries.len() as i64
        {
            return Err(invalid("follower_result_segment"));
        }
        for (index, entry) in segment.entries.iter().enumerate() {
            let valid_status = matches!(
                entry.status.as_str(),
                "accepted" | "provider_completed" | "provider_failed"
            );
            if entry.result_operation_id.is_empty()
                || entry.result_operation_id.len() > 128
                || entry.intent_operation_id.is_empty()
                || entry.intent_operation_id.len() > 128
                || entry.result_sequence != segment.first_result_sequence + index as i64
                || !(1..=MAX_SAFE_INTEGER).contains(&entry.intent_sequence)
                || !valid_status
                || entry
                    .provider_receipt_digest
                    .as_ref()
                    .is_some_and(|digest| !is_lower_hex(digest, 32))
                || ((entry.status == "accepted") != entry.provider_receipt_digest.is_none())
            {
                return Err(invalid("follower_result_segment.entries"));
            }
        }
        let result_count = segment.entries.len() as i64;
        let receipt = |status| FollowerResultImportReceipt {
            first_result_sequence: segment.first_result_sequence,
            last_result_sequence: segment.last_result_sequence,
            result_count,
            segment_digest: segment.segment_digest.clone(),
            status,
        };
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (next_result_sequence, latest_segment_digest) = transaction
            .query_row(
                "SELECT nextResultSequence, latestResultSegmentDigest
                 FROM library_core_follower_intent_actor
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![segment.library_id, segment.epoch_id, segment.actor_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .ok_or_else(|| invalid("follower_result_segment.actor"))?;
        let existing_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM library_core_follower_intent_result
             WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
               AND resultSequence BETWEEN ?4 AND ?5;",
            params![
                segment.library_id,
                segment.epoch_id,
                segment.actor_id,
                segment.first_result_sequence,
                segment.last_result_sequence,
            ],
            |row| row.get(0),
        )?;
        if existing_count > 0 {
            if existing_count != result_count
                || next_result_sequence <= segment.last_result_sequence
            {
                return Err(invalid("follower_result_segment.replay"));
            }
            for entry in &segment.entries {
                let stored = transaction.query_row(
                    "SELECT resultOperationId, intentOperationId, intentSequence,
                                status, providerReceiptDigest, segmentDigest
                         FROM library_core_follower_intent_result
                         WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
                           AND resultSequence = ?4;",
                    params![
                        segment.library_id,
                        segment.epoch_id,
                        segment.actor_id,
                        entry.result_sequence,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )?;
                if stored
                    != (
                        entry.result_operation_id.clone(),
                        entry.intent_operation_id.clone(),
                        entry.intent_sequence,
                        entry.status.clone(),
                        entry.provider_receipt_digest.clone(),
                        segment.segment_digest.clone(),
                    )
                {
                    return Err(invalid("follower_result_segment.replay"));
                }
            }
            transaction.commit()?;
            return Ok(receipt("already_imported"));
        }
        if segment.first_result_sequence != next_result_sequence
            || segment.previous_segment_digest != latest_segment_digest
        {
            return Err(invalid("follower_result_segment.actor_tip"));
        }
        for entry in &segment.entries {
            let intent_operation_id = transaction
                .query_row(
                    "SELECT operationId
                     FROM library_core_follower_intent_operation
                     WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3
                       AND intentSequence = ?4;",
                    params![
                        segment.library_id,
                        segment.epoch_id,
                        segment.actor_id,
                        entry.intent_sequence,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| invalid("follower_result_segment.intent"))?;
            if intent_operation_id != entry.intent_operation_id {
                return Err(invalid("follower_result_segment.intent"));
            }
            transaction.execute(
                "INSERT INTO library_core_follower_intent_result (
                   resultOperationId, libraryId, epochId, actorId,
                   resultSequence, intentOperationId, intentSequence, status,
                   providerReceiptDigest, segmentDigest, importedAtMs
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);",
                params![
                    entry.result_operation_id,
                    segment.library_id,
                    segment.epoch_id,
                    segment.actor_id,
                    entry.result_sequence,
                    entry.intent_operation_id,
                    entry.intent_sequence,
                    entry.status,
                    entry.provider_receipt_digest,
                    segment.segment_digest,
                    segment.imported_at_ms,
                ],
            )?;
        }
        transaction.execute(
            "UPDATE library_core_follower_intent_actor
             SET nextResultSequence = ?1, latestResultSegmentDigest = ?2
             WHERE libraryId = ?3 AND epochId = ?4 AND actorId = ?5;",
            params![
                segment.last_result_sequence + 1,
                segment.segment_digest,
                segment.library_id,
                segment.epoch_id,
                segment.actor_id,
            ],
        )?;
        transaction.commit()?;
        Ok(receipt("imported"))
    }

    /// Install or advance one verified immutable-checkpoint anchor.
    ///
    /// A different Library is never adopted implicitly. An epoch transition is
    /// also refused while this follower has actor state, because dropping an
    /// unpublished intent chain would require an explicit user recovery choice.
    pub(crate) fn install_follower_anchor(
        &mut self,
        anchor: &VerifiedFollowerAnchor,
    ) -> JournalResult<VerifiedFollowerAnchor> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        Self::install_follower_anchor_in_transaction(&transaction, anchor)?;
        transaction.commit()?;
        Ok(anchor.clone())
    }

    pub fn install_follower_anchor_in_transaction(
        transaction: &Transaction<'_>,
        anchor: &VerifiedFollowerAnchor,
    ) -> JournalResult<()> {
        let observed_frontier_json = validate(anchor)?;
        let checkpoint_actor_id = anchor
            .checkpoint_actor
            .as_ref()
            .map(|actor| actor.actor_id.as_str());
        let checkpoint_accepted_sequence = anchor
            .checkpoint_actor
            .as_ref()
            .map(|actor| actor.accepted_sequence);
        let checkpoint_accepted_operation_id = anchor
            .checkpoint_actor
            .as_ref()
            .and_then(|actor| actor.accepted_operation_id.as_deref());
        let checkpoint_accepted_chain_digest = anchor
            .checkpoint_actor
            .as_ref()
            .map(|actor| actor.accepted_chain_digest.as_str());
        let checkpoint_enrollment_certificate_digest = anchor
            .checkpoint_actor
            .as_ref()
            .map(|actor| actor.enrollment_certificate_digest.as_str());
        let existing = transaction
            .query_row(
                "SELECT libraryId, epoch, epochId, manifestObjectKey,
                        manifestTransportObjectId, manifestContentDigest,
                        generation, remoteIngestSequence,
                        remoteMaterializedDigest, writerId, checkpointActorId,
                        checkpointAcceptedSequence,
                        checkpointAcceptedOperationId,
                        checkpointAcceptedChainDigest,
                        checkpointEnrollmentCertificateDigest
                 FROM library_core_follower_anchor WHERE singletonId = 1;",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, Option<String>>(10)?,
                        row.get::<_, Option<i64>>(11)?,
                        row.get::<_, Option<String>>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, Option<String>>(14)?,
                    ))
                },
            )
            .optional()?;

        if let Some(existing) = existing.as_ref() {
            let existing_checkpoint_actor = checkpoint_actor_from_storage(
                existing.10.clone(),
                existing.11,
                existing.12.clone(),
                existing.13.clone(),
                existing.14.clone(),
            )?;
            if existing.0 != anchor.authority.library_id {
                return Err(invalid("follower_anchor.library_id"));
            }
            if anchor.authority.epoch < existing.1
                || (anchor.authority.epoch == existing.1 && anchor.authority.epoch_id != existing.2)
            {
                return Err(invalid("follower_anchor.epoch"));
            }
            if anchor.authority.epoch == existing.1 {
                if anchor.writer_id != existing.9
                    || anchor.generation < existing.6
                    || anchor.remote_ingest_sequence < existing.7
                {
                    return Err(invalid("follower_anchor.checkpoint_order"));
                }
                if anchor.generation == existing.6
                    && (anchor.manifest_object_key != existing.3
                        || existing.4.as_deref().is_some_and(|object_id| {
                            object_id != anchor.manifest_transport_object_id
                        })
                        || anchor.manifest_content_digest != existing.5
                        || anchor.remote_ingest_sequence != existing.7
                        || anchor.remote_materialized_digest != existing.8)
                {
                    return Err(invalid("follower_anchor.checkpoint_identity"));
                }
                match (&existing_checkpoint_actor, &anchor.checkpoint_actor) {
                    (None, _) => {}
                    (Some(_), None) => {
                        return Err(invalid("follower_anchor.checkpoint_actor_order"));
                    }
                    (Some(existing_actor), Some(next_actor)) => {
                        if next_actor.actor_id != existing_actor.actor_id
                            || next_actor.enrollment_certificate_digest
                                != existing_actor.enrollment_certificate_digest
                            || next_actor.accepted_sequence < existing_actor.accepted_sequence
                            || (next_actor.accepted_sequence == existing_actor.accepted_sequence
                                && next_actor != existing_actor)
                        {
                            return Err(invalid("follower_anchor.checkpoint_actor_order"));
                        }
                    }
                }
                if anchor.generation == existing.6
                    && anchor.checkpoint_actor != existing_checkpoint_actor
                {
                    return Err(invalid("follower_anchor.checkpoint_identity"));
                }
            } else {
                let actor_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM library_core_follower_actor;",
                    [],
                    |row| row.get(0),
                )?;
                if actor_count != 0 {
                    return Err(invalid("follower_anchor.pending_epoch_state"));
                }
            }
            transaction.execute(
                "UPDATE library_core_follower_anchor
                 SET epoch = ?1, epochId = ?2, authorityKeyId = ?3,
                     authorityPublicKey = ?4, observedFrontierJson = ?5,
                     manifestObjectKey = ?6, manifestTransportObjectId = ?7,
                     manifestContentDigest = ?8, generation = ?9,
                     remoteIngestSequence = ?10,
                     remoteMaterializedDigest = ?11, writerId = ?12,
                     controlRevision = ?13, checkpointActorId = ?14,
                     checkpointAcceptedSequence = ?15,
                     checkpointAcceptedOperationId = ?16,
                     checkpointAcceptedChainDigest = ?17,
                     checkpointEnrollmentCertificateDigest = ?18,
                     installedAtMs = ?19
                 WHERE singletonId = 1;",
                params![
                    anchor.authority.epoch,
                    anchor.authority.epoch_id,
                    anchor.authority.authority_key_id,
                    anchor.authority.authority_public_key,
                    observed_frontier_json,
                    anchor.manifest_object_key,
                    anchor.manifest_transport_object_id,
                    anchor.manifest_content_digest,
                    anchor.generation,
                    anchor.remote_ingest_sequence,
                    anchor.remote_materialized_digest,
                    anchor.writer_id,
                    anchor.control_revision,
                    checkpoint_actor_id,
                    checkpoint_accepted_sequence,
                    checkpoint_accepted_operation_id,
                    checkpoint_accepted_chain_digest,
                    checkpoint_enrollment_certificate_digest,
                    anchor.installed_at_ms,
                ],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO library_core_follower_anchor (
                   singletonId, libraryId, epoch, epochId, authorityKeyId,
                   authorityPublicKey, observedFrontierJson, manifestObjectKey,
                   manifestTransportObjectId, manifestContentDigest, generation, remoteIngestSequence,
                   remoteMaterializedDigest, writerId, controlRevision,
                   checkpointActorId, checkpointAcceptedSequence,
                   checkpointAcceptedOperationId,
                   checkpointAcceptedChainDigest,
                   checkpointEnrollmentCertificateDigest, installedAtMs
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                           ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20);",
                params![
                    anchor.authority.library_id,
                    anchor.authority.epoch,
                    anchor.authority.epoch_id,
                    anchor.authority.authority_key_id,
                    anchor.authority.authority_public_key,
                    observed_frontier_json,
                    anchor.manifest_object_key,
                    anchor.manifest_transport_object_id,
                    anchor.manifest_content_digest,
                    anchor.generation,
                    anchor.remote_ingest_sequence,
                    anchor.remote_materialized_digest,
                    anchor.writer_id,
                    anchor.control_revision,
                    checkpoint_actor_id,
                    checkpoint_accepted_sequence,
                    checkpoint_accepted_operation_id,
                    checkpoint_accepted_chain_digest,
                    checkpoint_enrollment_certificate_digest,
                    anchor.installed_at_ms,
                ],
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_journal::{
        VerifiedCausalTip, VerifiedOperation, VerifiedOperationTransaction,
    };

    fn anchor(generation: i64, ingest_sequence: i64) -> VerifiedFollowerAnchor {
        VerifiedFollowerAnchor {
            authority: AcceptedAuthorityState {
                library_id: "a".repeat(64),
                epoch: 3,
                epoch_id: "b".repeat(64),
                authority_key_id: "c".repeat(64),
                authority_public_key: "d".repeat(64),
                observed_frontier: vec![VerifiedCausalTip {
                    actor_id: "e".repeat(64),
                    sequence: 7,
                    operation_id: "operation-7".to_string(),
                    chain_digest: "f".repeat(64),
                }],
            },
            manifest_object_key: format!("manifest-{generation}"),
            manifest_transport_object_id: format!("drive-object-{generation}"),
            manifest_content_digest: if generation == 1 {
                "1".repeat(64)
            } else {
                "2".repeat(64)
            },
            generation,
            remote_ingest_sequence: ingest_sequence,
            remote_materialized_digest: if generation == 1 {
                "3".repeat(64)
            } else {
                "4".repeat(64)
            },
            writer_id: "5".repeat(64),
            control_revision: format!("revision-{generation}"),
            checkpoint_actor: None,
            installed_at_ms: 1_000 + generation,
        }
    }

    #[test]
    fn checkpoint_anchor_never_grants_writer_admission() {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        let installed = journal.install_follower_anchor(&anchor(1, 10)).unwrap();
        assert_eq!(installed.generation, 1);
        let writer_admission: i64 = journal
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_cloud_writer_admission;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let authority_epochs: i64 = journal
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_authority_epochs;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(writer_admission, 0);
        assert_eq!(authority_epochs, 0);
        assert_eq!(
            journal.follower_runtime_status().unwrap(),
            FollowerRuntimeStatus {
                state: "awaiting_enrollment",
                library_id: Some("a".repeat(64)),
                epoch_id: Some("b".repeat(64)),
                actor_id: None,
                checkpoint_generation: Some(1),
                remote_ingest_sequence: Some(10),
                pending_intent_count: 0,
                published_intent_count: 0,
                imported_result_count: 0,
            }
        );
    }

    #[test]
    fn checkpoint_anchor_advances_monotonically_and_rejects_changed_replay() {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        journal.install_follower_anchor(&anchor(1, 10)).unwrap();
        journal.install_follower_anchor(&anchor(2, 20)).unwrap();

        let mut stale = anchor(1, 10);
        stale.control_revision = "late-response".to_string();
        assert!(journal.install_follower_anchor(&stale).is_err());

        let mut changed_replay = anchor(2, 20);
        changed_replay.manifest_content_digest = "9".repeat(64);
        assert!(journal.install_follower_anchor(&changed_replay).is_err());
    }

    #[test]
    fn checkpoint_anchor_never_regresses_or_rewrites_an_actor_tip() {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        journal.install_follower_anchor(&anchor(1, 10)).unwrap();
        let mut accepted = anchor(2, 20);
        accepted.checkpoint_actor = Some(VerifiedFollowerCheckpointActor {
            actor_id: "6".repeat(64),
            accepted_sequence: 2,
            accepted_operation_id: Some("operation-2".to_string()),
            accepted_chain_digest: "5".repeat(64),
            enrollment_certificate_digest: "8".repeat(64),
        });
        journal.install_follower_anchor(&accepted).unwrap();

        let mut rewritten = accepted.clone();
        rewritten
            .checkpoint_actor
            .as_mut()
            .unwrap()
            .accepted_chain_digest = "9".repeat(64);
        assert!(journal.install_follower_anchor(&rewritten).is_err());

        let mut regressed = anchor(3, 30);
        regressed.checkpoint_actor = Some(VerifiedFollowerCheckpointActor {
            actor_id: "6".repeat(64),
            accepted_sequence: 1,
            accepted_operation_id: Some("operation-1".to_string()),
            accepted_chain_digest: "1".repeat(64),
            enrollment_certificate_digest: "8".repeat(64),
        });
        assert!(journal.install_follower_anchor(&regressed).is_err());
    }

    #[test]
    fn actor_request_is_durable_and_changed_response_loss_replay_is_refused() {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        let expected_anchor = anchor(1, 10);
        journal.install_follower_anchor(&expected_anchor).unwrap();
        assert_eq!(journal.follower_anchor().unwrap(), Some(expected_anchor));
        let request = StoredFollowerActorRequest {
            library_id: "a".repeat(64),
            epoch_id: "b".repeat(64),
            actor_id: "6".repeat(64),
            actor_public_key: "7".repeat(64),
            enrollment_request_digest: "8".repeat(64),
            canonical_enrollment_request_json: "{}".to_string(),
            created_at_ms: 2_000,
        };
        assert_eq!(
            journal.store_follower_actor_request(&request).unwrap(),
            request
        );
        assert_eq!(
            journal
                .follower_actor_request(&"a".repeat(64), &"b".repeat(64))
                .unwrap(),
            Some(request.clone())
        );
        assert_eq!(
            journal.follower_runtime_status().unwrap().state,
            "enrollment_pending"
        );

        let mut changed = request;
        changed.created_at_ms += 1;
        assert!(journal.store_follower_actor_request(&changed).is_err());
    }

    fn verified_intent(transaction_id: &str) -> VerifiedOperationTransaction {
        VerifiedOperationTransaction {
            transaction_id: transaction_id.to_string(),
            transaction_digest: "9".repeat(64),
            library_id: "a".repeat(64),
            epoch: 3,
            epoch_id: "b".repeat(64),
            actor_id: "6".repeat(64),
            actor_capability:
                super::super::actor_capability::ActorCapabilityState::historical_editor(
                    "5".repeat(64),
                    2_000,
                ),
            canonical_envelope_bytes: 4,
            members: vec![
                VerifiedOperation {
                    operation_id: "operation-1".to_string(),
                    actor_sequence: 1,
                    previous_actor_operation_id: None,
                    previous_actor_chain_digest: "0".repeat(64),
                    actor_chain_digest: "1".repeat(64),
                    member_digest: "2".repeat(64),
                    signing_body_digest: "3".repeat(64),
                    envelope_digest: "4".repeat(64),
                    entity_id: "item-1".to_string(),
                    entity_type: "FeedItem".to_string(),
                    operation_type: "feed_item_read_assignment".to_string(),
                    item_json: None,
                    rss_feed_json: None,
                    preferences_patch_json: None,
                    person_json: None,
                    account_json: None,
                    read_at_ms: Some(1),
                    assigned: None,
                    assigned_at_ms: None,
                    synced_at_ms: None,
                    removed_at_ms: None,
                    canonical_envelope_json: "{}".to_string(),
                    causal_tips: Vec::new(),
                },
                VerifiedOperation {
                    operation_id: "operation-2".to_string(),
                    actor_sequence: 2,
                    previous_actor_operation_id: Some("operation-1".to_string()),
                    previous_actor_chain_digest: "1".repeat(64),
                    actor_chain_digest: "5".repeat(64),
                    member_digest: "6".repeat(64),
                    signing_body_digest: "7".repeat(64),
                    envelope_digest: "8".repeat(64),
                    entity_id: "https://example.com/feed".to_string(),
                    entity_type: "RssFeed".to_string(),
                    operation_type: "rss_feed_upsert".to_string(),
                    item_json: None,
                    rss_feed_json: Some(
                        "{\"title\":\"Example\",\"url\":\"https://example.com/feed\"}".to_string(),
                    ),
                    preferences_patch_json: None,
                    person_json: None,
                    account_json: None,
                    read_at_ms: None,
                    assigned: None,
                    assigned_at_ms: None,
                    synced_at_ms: None,
                    removed_at_ms: None,
                    canonical_envelope_json: "{}".to_string(),
                    causal_tips: Vec::new(),
                },
            ],
        }
    }

    fn journal_with_enqueued_intent() -> LibraryCoreJournal {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        journal.install_follower_anchor(&anchor(1, 10)).unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 1, 3, 10, ?1, 1, 1, '{}', 1, 1);",
                ["d".repeat(64)],
            )
            .unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_feed_items (
                   globalId, payloadJson, updatedAtMs
                 ) VALUES ('item-1', '{\"globalId\":\"item-1\",\"userState\":{}}', 1);",
                [],
            )
            .unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_follower_actor (
                   libraryId, epochId, actorId, actorPublicKey,
                   actorChainGenesis, enrollmentRequestDigest,
                   canonicalEnrollmentRequestJson,
                   enrollmentCertificateDigest,
                   canonicalEnrollmentCertificateJson, createdAtMs,
                   enrolledAtMs
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?6, ?7, 1, 1);",
                params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "6".repeat(64),
                    "7".repeat(64),
                    "0".repeat(64),
                    "8".repeat(64),
                    r#"{"certificate_body":{"actor_enrollment_body":{"operation_id":"enroll"}}}"#,
                ],
            )
            .unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_follower_intent_actor (
                   libraryId, epochId, actorId, nextIntentSequence,
                   latestOperationId, latestActorChainDigest,
                   publishedThroughIntentSequence, latestPublishedSegmentDigest,
                   nextResultSequence, latestResultSegmentDigest
                 ) VALUES (?1, ?2, ?3, 1, NULL, ?4, 0, NULL, 1, NULL);",
                params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "6".repeat(64),
                    "0".repeat(64),
                ],
            )
            .unwrap();
        journal
            .enqueue_verified_follower_transaction(&verified_intent("transaction-1"), 2_000)
            .unwrap();
        journal
    }

    fn accepted_result_segment() -> VerifiedFollowerResultSegment {
        VerifiedFollowerResultSegment {
            library_id: "a".repeat(64),
            epoch_id: "b".repeat(64),
            actor_id: "6".repeat(64),
            first_result_sequence: 1,
            last_result_sequence: 1,
            previous_segment_digest: None,
            segment_digest: "d".repeat(64),
            entries: vec![VerifiedFollowerIntentResult {
                result_operation_id: "result-1".to_string(),
                result_sequence: 1,
                intent_operation_id: "operation-1".to_string(),
                intent_sequence: 1,
                status: "accepted".to_string(),
                provider_receipt_digest: None,
            }],
            imported_at_ms: 3_000,
        }
    }

    fn replace_projection_with_checkpoint_fixture(journal: &LibraryCoreJournal) {
        journal
            .connection_for_test()
            .execute_batch(
                r#"DELETE FROM library_core_feed_items;
                 INSERT INTO library_core_feed_items (
                   globalId, payloadJson, updatedAtMs
                 ) VALUES (
                   'item-1', '{"globalId":"item-1","userState":{}}', 10
                 );
                 UPDATE library_core_desktop_state
                 SET active = 1, revision = 1, shellJson = '{}',
                     expectedItemCount = 1, importedItemCount = 1;"#,
            )
            .unwrap();
    }

    #[test]
    fn checkpoint_import_replays_only_operations_beyond_checkpoint_actor_tip() {
        let mut journal = journal_with_enqueued_intent();
        replace_projection_with_checkpoint_fixture(&journal);

        let replay = journal
            .replay_pending_follower_overlay_with(|_, _| Ok(verified_intent("transaction-1")))
            .unwrap();
        assert_eq!(
            replay,
            FollowerOverlayReplayReceipt {
                transaction_count: 1,
                operation_count: 2,
                materialized_row_count: 2,
                revision_advanced: true,
            }
        );
        let (read_at, revision): (Option<i64>, i64) = journal
            .connection_for_test()
            .query_row(
                "SELECT item.readAt, state.revision
                 FROM library_core_feed_items AS item
                 CROSS JOIN library_core_desktop_state AS state
                 WHERE item.globalId = 'item-1';",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(read_at, Some(1));
        assert_eq!(revision, 2);

        journal
            .append_follower_result_segment(&accepted_result_segment())
            .unwrap();
        replace_projection_with_checkpoint_fixture(&journal);
        assert_eq!(
            journal
                .replay_pending_follower_overlay_with(|_, _| {
                    Ok(verified_intent("transaction-1"))
                })
                .unwrap()
                .transaction_count,
            1
        );

        let mut next_anchor = anchor(2, 20);
        next_anchor.checkpoint_actor = Some(VerifiedFollowerCheckpointActor {
            actor_id: "6".repeat(64),
            accepted_sequence: 2,
            accepted_operation_id: Some("operation-2".to_string()),
            accepted_chain_digest: "5".repeat(64),
            enrollment_certificate_digest: "8".repeat(64),
        });
        journal.install_follower_anchor(&next_anchor).unwrap();
        replace_projection_with_checkpoint_fixture(&journal);
        journal
            .connection_for_test()
            .execute(
                "UPDATE library_core_desktop_state SET sourceRevision = 20
                 WHERE singletonId = 1;",
                [],
            )
            .unwrap();
        assert_eq!(
            journal
                .replay_pending_follower_overlay_with(|_, _| {
                    panic!("checkpointed transactions must not be replayed")
                })
                .unwrap(),
            FollowerOverlayReplayReceipt {
                transaction_count: 0,
                operation_count: 0,
                materialized_row_count: 0,
                revision_advanced: false,
            }
        );
        let read_at: Option<i64> = journal
            .connection_for_test()
            .query_row(
                "SELECT readAt FROM library_core_feed_items
                 WHERE globalId = 'item-1';",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(read_at, None);
    }

    #[test]
    fn checkpoint_import_rejects_an_actor_tip_that_splits_a_transaction() {
        let mut journal = journal_with_enqueued_intent();
        let mut next_anchor = anchor(2, 20);
        next_anchor.checkpoint_actor = Some(VerifiedFollowerCheckpointActor {
            actor_id: "6".repeat(64),
            accepted_sequence: 1,
            accepted_operation_id: Some("operation-1".to_string()),
            accepted_chain_digest: "1".repeat(64),
            enrollment_certificate_digest: "8".repeat(64),
        });
        journal.install_follower_anchor(&next_anchor).unwrap();
        replace_projection_with_checkpoint_fixture(&journal);
        journal
            .connection_for_test()
            .execute(
                "UPDATE library_core_desktop_state SET sourceRevision = 20
                 WHERE singletonId = 1;",
                [],
            )
            .unwrap();

        assert!(matches!(
            journal.replay_pending_follower_overlay_with(|_, _| {
                panic!("split transactions must not be verified or replayed")
            }),
            Err(JournalError::InvalidVerifiedInput {
                field: "follower_overlay.checkpoint_actor_split"
            })
        ));
    }

    #[test]
    fn checkpoint_import_rejects_an_actor_tip_that_mismatches_the_local_chain() {
        let mut journal = journal_with_enqueued_intent();
        let mut next_anchor = anchor(2, 20);
        next_anchor.checkpoint_actor = Some(VerifiedFollowerCheckpointActor {
            actor_id: "6".repeat(64),
            accepted_sequence: 2,
            accepted_operation_id: Some("operation-2".to_string()),
            accepted_chain_digest: "9".repeat(64),
            enrollment_certificate_digest: "8".repeat(64),
        });
        journal.install_follower_anchor(&next_anchor).unwrap();
        replace_projection_with_checkpoint_fixture(&journal);
        journal
            .connection_for_test()
            .execute(
                "UPDATE library_core_desktop_state SET sourceRevision = 20
                 WHERE singletonId = 1;",
                [],
            )
            .unwrap();

        assert!(matches!(
            journal.replay_pending_follower_overlay_with(|_, _| {
                panic!("mismatched actor tips must not be verified or replayed")
            }),
            Err(JournalError::InvalidVerifiedInput {
                field: "follower_overlay.checkpoint_actor_tip"
            })
        ));
    }

    #[test]
    fn checkpoint_import_refuses_overlay_from_a_stale_anchor() {
        let mut journal = journal_with_enqueued_intent();
        replace_projection_with_checkpoint_fixture(&journal);
        journal
            .connection_for_test()
            .execute(
                "UPDATE library_core_desktop_state SET sourceRevision = 11
                 WHERE singletonId = 1;",
                [],
            )
            .unwrap();

        assert!(matches!(
            journal.replay_pending_follower_overlay_with(|_, _| {
                panic!("stale-anchor operations must not be verified or replayed")
            }),
            Err(JournalError::InvalidVerifiedInput {
                field: "follower_overlay.checkpoint_anchor"
            })
        ));
        let read_at: Option<i64> = journal
            .connection_for_test()
            .query_row(
                "SELECT readAt FROM library_core_feed_items
                 WHERE globalId = 'item-1';",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(read_at, None);
    }

    #[test]
    fn follower_outbox_publication_and_result_import_are_exact_and_replay_safe() {
        let mut journal = journal_with_enqueued_intent();
        assert_eq!(
            journal.follower_runtime_status().unwrap(),
            FollowerRuntimeStatus {
                state: "active",
                library_id: Some("a".repeat(64)),
                epoch_id: Some("b".repeat(64)),
                actor_id: Some("6".repeat(64)),
                checkpoint_generation: Some(1),
                remote_ingest_sequence: Some(10),
                pending_intent_count: 2,
                published_intent_count: 0,
                imported_result_count: 0,
            }
        );
        assert!(journal
            .follower_intent_outbox_candidate(1, 4_194_304)
            .is_err());
        let candidate = journal
            .follower_intent_outbox_candidate(1_000, 4_194_304)
            .unwrap()
            .unwrap();
        assert_eq!(candidate.first_intent_sequence, 1);
        assert_eq!(candidate.last_intent_sequence, 2);
        assert_eq!(candidate.transaction_count, 1);
        assert_eq!(candidate.entries.len(), 2);
        assert_eq!(candidate.previous_segment_digest, None);

        let publication = VerifiedFollowerIntentPublication {
            library_id: "a".repeat(64),
            epoch_id: "b".repeat(64),
            actor_id: "6".repeat(64),
            first_intent_sequence: 1,
            last_intent_sequence: 2,
            previous_segment_digest: None,
            published_segment_digest: "c".repeat(64),
        };
        assert_eq!(
            journal
                .record_follower_intent_publication(&publication)
                .unwrap()
                .status,
            "recorded"
        );
        assert_eq!(
            journal
                .record_follower_intent_publication(&publication)
                .unwrap()
                .status,
            "already_recorded"
        );
        assert!(journal
            .follower_intent_outbox_candidate(1_000, 4_194_304)
            .unwrap()
            .is_none());
        let published_status = journal.follower_runtime_status().unwrap();
        assert_eq!(published_status.pending_intent_count, 0);
        assert_eq!(published_status.published_intent_count, 2);

        assert_eq!(
            journal
                .follower_result_import_cursor(&"a".repeat(64), &"b".repeat(64), &"6".repeat(64),)
                .unwrap(),
            Some(FollowerResultImportCursor {
                next_result_sequence: 1,
                latest_segment_digest: None,
            })
        );
        let result_segment = accepted_result_segment();
        assert_eq!(
            journal
                .append_follower_result_segment(&result_segment)
                .unwrap()
                .status,
            "imported"
        );
        assert_eq!(
            journal
                .append_follower_result_segment(&result_segment)
                .unwrap()
                .status,
            "already_imported"
        );
        assert_eq!(
            journal
                .follower_runtime_status()
                .unwrap()
                .imported_result_count,
            1
        );
        let mut changed_replay = result_segment;
        changed_replay.segment_digest = "e".repeat(64);
        assert!(journal
            .append_follower_result_segment(&changed_replay)
            .is_err());
    }

    #[test]
    fn verified_intent_enqueue_is_atomic_monotone_and_idempotent() {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        journal.install_follower_anchor(&anchor(1, 10)).unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 1, 1, 1, ?1, 1, 1, '{}', 1, 1);",
                ["d".repeat(64)],
            )
            .unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_feed_items (
                   globalId, payloadJson, updatedAtMs
                 ) VALUES ('item-1', '{\"globalId\":\"item-1\",\"userState\":{}}', 1);",
                [],
            )
            .unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_follower_actor (
                   libraryId, epochId, actorId, actorPublicKey,
                   actorChainGenesis, enrollmentRequestDigest,
                   canonicalEnrollmentRequestJson,
                   enrollmentCertificateDigest,
                   canonicalEnrollmentCertificateJson, createdAtMs,
                   enrolledAtMs
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?6, '{}', 1, 1);",
                params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "6".repeat(64),
                    "7".repeat(64),
                    "0".repeat(64),
                    "8".repeat(64),
                ],
            )
            .unwrap();
        journal
            .connection_for_test()
            .execute(
                "INSERT INTO library_core_follower_intent_actor (
                   libraryId, epochId, actorId, nextIntentSequence,
                   latestOperationId, latestActorChainDigest,
                   publishedThroughIntentSequence, latestPublishedSegmentDigest,
                   nextResultSequence, latestResultSegmentDigest
                 ) VALUES (?1, ?2, ?3, 1, NULL, ?4, 0, NULL, 1, NULL);",
                params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "6".repeat(64),
                    "0".repeat(64),
                ],
            )
            .unwrap();

        let verified = verified_intent("transaction-1");
        assert_eq!(
            journal
                .enqueue_verified_follower_transaction(&verified, 2_000)
                .unwrap()
                .status,
            "enqueued"
        );
        assert_eq!(
            journal
                .enqueue_verified_follower_transaction(&verified, 9_000)
                .unwrap()
                .status,
            "already_enqueued"
        );
        let queued: i64 = journal
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_follower_intent_operation;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(queued, 2);
        let (read_at, revision): (i64, i64) = journal
            .connection_for_test()
            .query_row(
                "SELECT item.readAt, state.revision
                 FROM library_core_feed_items AS item
                 CROSS JOIN library_core_desktop_state AS state
                 WHERE item.globalId = 'item-1' AND state.singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((read_at, revision), (1, 2));
        let shell_json: String = journal
            .connection_for_test()
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let shell: serde_json::Value = serde_json::from_str(&shell_json).unwrap();
        assert_eq!(
            shell["feeds"]["https://example.com/feed"]["title"],
            "Example"
        );

        let stale = verified_intent("transaction-2");
        assert!(journal
            .enqueue_verified_follower_transaction(&stale, 3_000)
            .is_err());
    }
}
