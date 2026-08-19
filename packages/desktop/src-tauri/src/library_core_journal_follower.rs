//! Durable state for a non-authoritative editable Freed Desktop follower.
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
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

const MAX_CONTROL_REVISION_BYTES: usize = 512;
const MAX_MANIFEST_OBJECT_KEY_BYTES: usize = 4_096;
const MAX_FRONTIER_BYTES: usize = 4_194_304;

fn invalid(field: &'static str) -> JournalError {
    JournalError::InvalidVerifiedInput { field }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedFollowerAnchor {
    pub(crate) authority: AcceptedAuthorityState,
    pub(crate) manifest_object_key: String,
    pub(crate) manifest_content_digest: String,
    pub(crate) generation: i64,
    pub(crate) remote_ingest_sequence: i64,
    pub(crate) remote_materialized_digest: String,
    pub(crate) writer_id: String,
    pub(crate) control_revision: String,
    pub(crate) installed_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredFollowerActorRequest {
    pub(crate) library_id: String,
    pub(crate) epoch_id: String,
    pub(crate) actor_id: String,
    pub(crate) actor_public_key: String,
    pub(crate) enrollment_request_digest: String,
    pub(crate) canonical_enrollment_request_json: String,
    pub(crate) created_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredFollowerActorEnrollment {
    pub(crate) library_id: String,
    pub(crate) epoch_id: String,
    pub(crate) actor_id: String,
    pub(crate) actor_public_key: String,
    pub(crate) enrollment_certificate_digest: String,
    pub(crate) canonical_enrollment_certificate_json: String,
    pub(crate) actor_chain_genesis: String,
    pub(crate) enrolled_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FollowerIntentEnqueueReceipt {
    pub(crate) transaction_id: String,
    pub(crate) first_intent_sequence: i64,
    pub(crate) last_intent_sequence: i64,
    pub(crate) operation_count: i64,
    pub(crate) status: &'static str,
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

fn validate(anchor: &VerifiedFollowerAnchor) -> JournalResult<String> {
    let authority = &anchor.authority;
    if !is_lower_hex(&authority.library_id, 32)
        || !(1..=MAX_SAFE_INTEGER).contains(&authority.epoch)
        || !is_lower_hex(&authority.epoch_id, 32)
        || !is_lower_hex(&authority.authority_key_id, 32)
        || !is_lower_hex(&authority.authority_public_key, 32)
        || anchor.manifest_object_key.is_empty()
        || anchor.manifest_object_key.len() > MAX_MANIFEST_OBJECT_KEY_BYTES
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

impl LibraryCoreJournal {
    pub(crate) fn follower_anchor(&self) -> JournalResult<Option<VerifiedFollowerAnchor>> {
        let stored = self
            .connection
            .query_row(
                "SELECT libraryId, epoch, epochId, authorityKeyId,
                        authorityPublicKey, observedFrontierJson,
                        manifestObjectKey, manifestContentDigest, generation,
                        remoteIngestSequence, remoteMaterializedDigest,
                        writerId, controlRevision, installedAtMs
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
                        row.get::<_, String>(7)?,
                        row.get::<_, i64>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, String>(11)?,
                        row.get::<_, String>(12)?,
                        row.get::<_, i64>(13)?,
                    ))
                },
            )
            .optional()?;
        let Some(stored) = stored else {
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
            manifest_content_digest: stored.7,
            generation: stored.8,
            remote_ingest_sequence: stored.9,
            remote_materialized_digest: stored.10,
            writer_id: stored.11,
            control_revision: stored.12,
            installed_at_ms: stored.13,
        };
        let canonical = validate(&anchor)?;
        if canonical != stored.5 {
            return Err(invalid("follower_anchor.observed_frontier"));
        }
        Ok(Some(anchor))
    }

    pub(crate) fn follower_actor_request(
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

    pub(crate) fn follower_actor_enrollment(
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

    pub(super) fn follower_actor_state(
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
                        intent.latestOperationId, intent.latestActorChainDigest
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
                   AND actor.enrollmentCertificateDigest IS NOT NULL;",
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
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn active_follower_actor_state(&self) -> JournalResult<Option<super::ActorState>> {
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

    pub(crate) fn store_follower_actor_request(
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
            if member.item_json.is_some()
                || member.rss_feed_json.is_some()
                || member.preferences_patch_json.is_some()
                || member.person_json.is_some()
                || member.account_json.is_some()
                || member.removed_at_ms.is_some()
                || (member.read_at_ms.is_none()
                    && !matches!(
                        member.operation_type.as_str(),
                        "feed_item_saved_assignment"
                            | "feed_item_archive_assignment"
                            | "feed_item_like_assignment"
                    ))
            {
                return Err(invalid("follower_intent.unsupported_materialization"));
            }
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
            materialized_rows += if let Some(read_at_ms) = member.read_at_ms {
                transaction.execute(
                    "UPDATE library_core_feed_items
                     SET readAt = ?1,
                         payloadJson = json_set(payloadJson, '$.userState.readAt', ?1),
                         updatedAtMs = ?2
                     WHERE globalId = ?3 AND deletedAt IS NULL
                       AND (readAt IS NULL OR ?1 < readAt);",
                    params![read_at_ms, enqueued_at_ms, member.entity_id],
                )?
            } else {
                let assigned = i64::from(member.assigned.expect("verified assignment"));
                let assigned_at_ms = member
                    .assigned_at_ms
                    .expect("verified assignment timestamp");
                match member.operation_type.as_str() {
                    "feed_item_saved_assignment" => transaction.execute(
                        "UPDATE library_core_feed_items SET
                           saved = ?1,
                           archived = CASE WHEN ?1 = 1 THEN 0 ELSE archived END,
                           archivedAt = CASE WHEN ?1 = 1 THEN NULL ELSE archivedAt END,
                           payloadJson = CASE WHEN ?1 = 0
                             THEN json_remove(json_set(payloadJson, '$.userState.saved', json('false')), '$.userState.savedAt')
                             ELSE json_remove(json_set(payloadJson,
                               '$.userState.saved', json('true'), '$.userState.savedAt', ?2,
                               '$.userState.archived', json('false')), '$.userState.archivedAt')
                           END,
                           updatedAtMs = ?3
                         WHERE globalId = ?4 AND deletedAt IS NULL
                           AND (saved IS NOT ?1 OR (?1 = 1 AND archived IS 1));",
                        params![assigned, assigned_at_ms, enqueued_at_ms, member.entity_id],
                    )?,
                    "feed_item_archive_assignment" => transaction.execute(
                        "UPDATE library_core_feed_items SET
                           archived = ?1,
                           archivedAt = CASE WHEN ?1 = 1 THEN ?2 ELSE NULL END,
                           payloadJson = CASE WHEN ?1 = 0
                             THEN json_remove(json_set(payloadJson, '$.userState.archived', json('false')), '$.userState.archivedAt')
                             ELSE json_set(payloadJson, '$.userState.archived', json('true'), '$.userState.archivedAt', ?2)
                           END,
                           updatedAtMs = ?3
                         WHERE globalId = ?4 AND deletedAt IS NULL
                           AND archived IS NOT ?1
                           AND (?1 = 0 OR saved IS NOT 1);",
                        params![assigned, assigned_at_ms, enqueued_at_ms, member.entity_id],
                    )?,
                    "feed_item_like_assignment" => transaction.execute(
                        "UPDATE library_core_feed_items SET
                           liked = ?1,
                           likedAt = CASE WHEN ?1 = 1 THEN ?2 ELSE NULL END,
                           likedSyncedAt = NULL,
                           payloadJson = CASE WHEN ?1 = 0
                             THEN json_remove(json_set(payloadJson, '$.userState.liked', json('false')), '$.userState.likedAt', '$.userState.likedSyncedAt')
                             ELSE json_remove(json_set(payloadJson, '$.userState.liked', json('true'), '$.userState.likedAt', ?2), '$.userState.likedSyncedAt')
                           END,
                           updatedAtMs = ?3
                         WHERE globalId = ?4 AND deletedAt IS NULL
                           AND liked IS NOT ?1;",
                        params![assigned, assigned_at_ms, enqueued_at_ms, member.entity_id],
                    )?,
                    _ => return Err(invalid("follower_intent.operation_type")),
                }
            };
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

    /// Install or advance one verified immutable-checkpoint anchor.
    ///
    /// A different Library is never adopted implicitly. An epoch transition is
    /// also refused while this follower has actor state, because dropping an
    /// unpublished intent chain would require an explicit user recovery choice.
    pub(crate) fn install_follower_anchor(
        &mut self,
        anchor: &VerifiedFollowerAnchor,
    ) -> JournalResult<VerifiedFollowerAnchor> {
        let observed_frontier_json = validate(anchor)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = transaction
            .query_row(
                "SELECT libraryId, epoch, epochId, manifestObjectKey,
                        manifestContentDigest, generation, remoteIngestSequence,
                        remoteMaterializedDigest, writerId
                 FROM library_core_follower_anchor WHERE singletonId = 1;",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                    ))
                },
            )
            .optional()?;

        if let Some(existing) = existing.as_ref() {
            if existing.0 != anchor.authority.library_id {
                return Err(invalid("follower_anchor.library_id"));
            }
            if anchor.authority.epoch < existing.1
                || (anchor.authority.epoch == existing.1 && anchor.authority.epoch_id != existing.2)
            {
                return Err(invalid("follower_anchor.epoch"));
            }
            if anchor.authority.epoch == existing.1 {
                if anchor.writer_id != existing.8
                    || anchor.generation < existing.5
                    || anchor.remote_ingest_sequence < existing.6
                {
                    return Err(invalid("follower_anchor.checkpoint_order"));
                }
                if anchor.generation == existing.5
                    && (anchor.manifest_object_key != existing.3
                        || anchor.manifest_content_digest != existing.4
                        || anchor.remote_ingest_sequence != existing.6
                        || anchor.remote_materialized_digest != existing.7)
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
                     manifestObjectKey = ?6, manifestContentDigest = ?7,
                     generation = ?8, remoteIngestSequence = ?9,
                     remoteMaterializedDigest = ?10, writerId = ?11,
                     controlRevision = ?12, installedAtMs = ?13
                 WHERE singletonId = 1;",
                params![
                    anchor.authority.epoch,
                    anchor.authority.epoch_id,
                    anchor.authority.authority_key_id,
                    anchor.authority.authority_public_key,
                    observed_frontier_json,
                    anchor.manifest_object_key,
                    anchor.manifest_content_digest,
                    anchor.generation,
                    anchor.remote_ingest_sequence,
                    anchor.remote_materialized_digest,
                    anchor.writer_id,
                    anchor.control_revision,
                    anchor.installed_at_ms,
                ],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO library_core_follower_anchor (
                   singletonId, libraryId, epoch, epochId, authorityKeyId,
                   authorityPublicKey, observedFrontierJson, manifestObjectKey,
                   manifestContentDigest, generation, remoteIngestSequence,
                   remoteMaterializedDigest, writerId, controlRevision,
                   installedAtMs
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                           ?11, ?12, ?13, ?14);",
                params![
                    anchor.authority.library_id,
                    anchor.authority.epoch,
                    anchor.authority.epoch_id,
                    anchor.authority.authority_key_id,
                    anchor.authority.authority_public_key,
                    observed_frontier_json,
                    anchor.manifest_object_key,
                    anchor.manifest_content_digest,
                    anchor.generation,
                    anchor.remote_ingest_sequence,
                    anchor.remote_materialized_digest,
                    anchor.writer_id,
                    anchor.control_revision,
                    anchor.installed_at_ms,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(anchor.clone())
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
            canonical_envelope_bytes: 2,
            members: vec![VerifiedOperation {
                operation_id: "operation-1".to_string(),
                actor_sequence: 1,
                previous_actor_operation_id: None,
                previous_actor_chain_digest: "0".repeat(64),
                actor_chain_digest: "1".repeat(64),
                member_digest: "2".repeat(64),
                signing_body_digest: "3".repeat(64),
                envelope_digest: "4".repeat(64),
                entity_id: "item-1".to_string(),
                entity_type: "feed_item".to_string(),
                operation_type: "feed_item_read_assigned".to_string(),
                item_json: None,
                rss_feed_json: None,
                preferences_patch_json: None,
                person_json: None,
                account_json: None,
                read_at_ms: Some(1),
                assigned: Some(true),
                assigned_at_ms: None,
                removed_at_ms: None,
                canonical_envelope_json: "{}".to_string(),
                causal_tips: Vec::new(),
            }],
        }
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
        assert_eq!(queued, 1);
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

        let stale = verified_intent("transaction-2");
        assert!(journal
            .enqueue_verified_follower_transaction(&stale, 3_000)
            .is_err());
    }
}
