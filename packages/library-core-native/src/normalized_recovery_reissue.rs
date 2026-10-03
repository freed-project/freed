//! Explicit fresh assignments from verified archived intents. Original envelopes
//! stay immutable. The installation-local link and new intent share one commit.
use crate::library_core_actor_enrollment::{load_actor_key_pair, ActorKeyStore};
use crate::library_core_canonical::{encode_canonical_value, encode_operation_signature_input};
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::normalized_follower::{
    enqueue_normalized_follower_intent_in_transaction_v1, normalized_follower_mutation_context_v1,
};
use crate::normalized_operation::VerifiedOperation;
use crate::normalized_operation_verifier::digest_hex;
use crate::normalized_recovery_input::{
    inspect_archived_intent_for_review, ArchivedIntentOutcomeV1,
};
use crate::NormalizedMutationContextV1;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{Ed25519KeyPair, KeyPair};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryReissueRequestV1 {
    pub schema_version: u32,
    pub recovery_id: String,
    pub archive_digest: String,
    pub transaction_id: String,
    pub transaction_digest: String,
    pub reviewed_generation_id: String,
    pub reviewed_revision: i64,
    pub reviewed_local_sequence: i64,
    pub member_count: usize,
}

/// Receipt of local durable submission, never a claim of Primary acceptance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryReissueReceiptV1 {
    pub schema_version: u32,
    pub recovery_id: String,
    pub original_transaction_id: String,
    pub replacement_transaction_id: String,
    pub replacement_transaction_digest: String,
    pub replacement_epoch_id: String,
    pub replacement_actor_id: String,
    pub first_counter: i64,
    pub last_counter: i64,
    pub member_count: usize,
    pub created_at: i64,
}

fn valid_request(request: &RecoveryReissueRequestV1) -> bool {
    request.schema_version == 1
        && is_lower_sha256(&request.recovery_id)
        && is_lower_sha256(&request.archive_digest)
        && is_lower_sha256(&request.transaction_digest)
        && is_lower_sha256(&request.reviewed_generation_id)
        && !request.transaction_id.is_empty()
        && request.transaction_id.len() <= 255
        && (0..=MAX_SAFE_INTEGER).contains(&request.reviewed_revision)
        && (0..=MAX_SAFE_INTEGER).contains(&request.reviewed_local_sequence)
        && (1..=1000).contains(&request.member_count)
}

/// Read only the pinned review source, including local optimistic changes.
pub(crate) fn recovery_review_source(
    connection: &Connection,
) -> Result<(String, i64, i64), String> {
    let source: (String, i64, i64, i64) = connection.query_row(
        "SELECT generation.generation_id, meta.source_revision, changes.revision, local.sequence
         FROM library_materialization_generation AS generation
         JOIN library_meta AS meta ON meta.singleton_id = generation.singleton_id
         JOIN library_change_state AS changes ON changes.singleton_id = generation.singleton_id
         JOIN library_local_change_state AS local ON local.singleton_id = generation.singleton_id
         WHERE generation.singleton_id = 1;",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).map_err(|e| e.to_string())?;
    if !is_lower_sha256(&source.0)
        || source.1 != source.2
        || !(0..=MAX_SAFE_INTEGER).contains(&source.1)
        || !(0..=MAX_SAFE_INTEGER).contains(&source.3)
    {
        return Err("recovery review source is invalid".into());
    }
    Ok((source.0, source.1, source.3))
}

/// Read a bounded durable replacement receipt after the caller verifies the
/// archive and original transaction. The link does not prove Primary acceptance.
pub(crate) fn read_recovery_reissue_receipt(
    connection: &Connection,
    request: &RecoveryReissueRequestV1,
) -> Result<Option<RecoveryReissueReceiptV1>, String> {
    let prior = connection
        .query_row(
            "SELECT archive_digest, original_transaction_digest, replacement_transaction_id,
                replacement_transaction_digest, replacement_epoch_id, replacement_actor_id,
                first_counter, last_counter, member_count, created_at
         FROM library_local_recovery_reissues
         WHERE recovery_id = ?1 AND original_transaction_id = ?2;",
            params![request.recovery_id, request.transaction_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    RecoveryReissueReceiptV1 {
                        schema_version: 1,
                        recovery_id: request.recovery_id.clone(),
                        original_transaction_id: request.transaction_id.clone(),
                        replacement_transaction_id: r.get(2)?,
                        replacement_transaction_digest: r.get(3)?,
                        replacement_epoch_id: r.get(4)?,
                        replacement_actor_id: r.get(5)?,
                        first_counter: r.get(6)?,
                        last_counter: r.get(7)?,
                        member_count: r.get(8)?,
                        created_at: r.get(9)?,
                    },
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match prior {
        Some((stored_archive, stored_original, receipt)) => {
            if stored_archive != request.archive_digest
                || stored_original != request.transaction_digest
                || receipt.member_count != request.member_count
            {
                return Err("recovery replacement link conflicts with the archive".into());
            }
            Ok(Some(receipt))
        }
        None => Ok(None),
    }
}

pub fn reapply_archived_assignments_v1(
    connection: &mut Connection,
    request: &RecoveryReissueRequestV1,
    key_store: &dyn ActorKeyStore,
    now: i64,
) -> Result<RecoveryReissueReceiptV1, String> {
    crate::require_library_transfer_capability()?;
    reapply_archived_transaction(
        connection,
        request,
        now,
        Replacement::Assignments(key_store),
    )
}

/// Submit a complete explicitly edited replacement using the existing signed
/// operation protocol. Native verification and the archive link share one commit.
pub fn reapply_archived_editor_transaction_v1(
    connection: &mut Connection,
    request: &RecoveryReissueRequestV1,
    canonical_envelopes: &[Vec<u8>],
    now: i64,
) -> Result<RecoveryReissueReceiptV1, String> {
    crate::require_library_transfer_capability()?;
    if canonical_envelopes.len() > 1000
        || canonical_envelopes.iter().any(|v| v.len() > 131072)
        || canonical_envelopes.iter().map(Vec::len).sum::<usize>() > 4194304
    {
        return Err("recovery editor transaction exceeds its bounds".into());
    }
    reapply_archived_transaction(
        connection,
        request,
        now,
        Replacement::Editor(canonical_envelopes),
    )
}

enum Replacement<'a> {
    Assignments(&'a dyn ActorKeyStore),
    Editor(&'a [Vec<u8>]),
}

fn reapply_archived_transaction(
    connection: &mut Connection,
    request: &RecoveryReissueRequestV1,
    now: i64,
    replacement: Replacement<'_>,
) -> Result<RecoveryReissueReceiptV1, String> {
    if !valid_request(request) || !(0..=MAX_SAFE_INTEGER).contains(&now) {
        return Err("recovery reapplication request is invalid".into());
    }
    let durability: u32 = connection
        .pragma_query_value(None, "synchronous", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if durability < 2 {
        return Err("recovery reapplication requires full SQLite durability".into());
    }
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    // Validates the physical catalog, selected Library, archived identity and
    // signatures again. Local 'published' or 'rejected' flags are not evidence.
    let (original, outcome) =
        inspect_archived_intent_for_review(&tx, &request.recovery_id, &request.transaction_id)?;
    let archive_digest: String = tx
        .query_row(
            "SELECT archive_digest FROM library_local_recovery_archives WHERE recovery_id = ?1;",
            [&request.recovery_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if archive_digest != request.archive_digest
        || original.transaction_digest != request.transaction_digest
        || original.members.len() != request.member_count
    {
        return Err("recovery reapplication archive identity changed".into());
    }
    if let Some(receipt) = read_recovery_reissue_receipt(&tx, request)? {
        // A response-loss retry can outlive a key, enrollment or source revision.
        // It returns the first durable identity without signing or allocating again.
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(receipt);
    }
    if matches!(outcome, ArchivedIntentOutcomeV1::ConfirmedAccepted { .. }) {
        return Err("recovery edit was already accepted; reapplication refused".into());
    }
    let source = recovery_review_source(&tx)?;
    if source
        != (
            request.reviewed_generation_id.clone(),
            request.reviewed_revision,
            request.reviewed_local_sequence,
        )
    {
        return Err(
            "RECOVERY_REVIEW_STALE: review the current Library before applying again".into(),
        );
    }
    crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&tx)
        .map_err(|e| e.to_string())?;
    let context = normalized_follower_mutation_context_v1(&tx).map_err(|e| e.to_string())?;
    // Historical archives are independent of the current consumer lifecycle.
    // A former Primary uses verified demotion plus normal successor enrollment;
    // other consumers retain the completed archive reenrollment receipt.
    let demoted = crate::normalized_source_handoff::source_consumer_incarnation_v1(
        &tx,
        &context.library_id,
        &context.epoch_id,
    )?
    .is_some();
    let reenrolled = if demoted {
        true
    } else {
        let current_recovery = crate::read_consumer_recovery_summary_v1(&tx)?
            .filter(|recovery| {
                recovery.state == "following"
                    && recovery.library_id == context.library_id
                    && recovery.successor_epoch_id == context.epoch_id
            })
            .ok_or("recovery reapplication requires the current enrolled consumer")?;
        tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_local_recovery_archives AS archive
             WHERE recovery_id = ?1 AND library_id = ?2 AND successor_epoch_id = ?3
              AND reenrollment_committed_at IS NOT NULL
              AND json_extract(CAST(reenrollment_receipt AS TEXT), '$.actorId') = ?4);",
            params![
                current_recovery.recovery_id,
                context.library_id,
                context.epoch_id,
                context.actor_id
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    if !reenrolled || context.actor_id == original.actor_id || context.epoch_id == original.epoch_id
    {
        return Err("recovery reapplication requires the enrolled successor actor".into());
    }
    let (transaction_id, envelopes) = match replacement {
        Replacement::Assignments(key_store) => {
            for member in &original.members {
                assignment_payload(member, now)?;
                if member.operation_type != original.members[0].operation_type {
                    return Err("recovery cannot split or mix an archived transaction".into());
                }
                let present: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_feed_items WHERE global_id = ?1);",
                        [&member.entity_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if !present {
                    return Err(
                        "recovery target is no longer present; use its original editor".into(),
                    );
                }
            }
            let key = load_actor_key_pair(key_store, &context.library_id)?;
            if lower_hex(key.public_key().as_ref()) != context.actor_public_key {
                return Err("recovery actor signing key does not match enrollment".into());
            }
            let mut random = [0_u8; 16];
            SystemRandom::new()
                .fill(&mut random)
                .map_err(|_| "recovery identity randomness unavailable")?;
            let transaction_id = format!("recovery:{}", lower_hex(&random));
            let envelopes =
                sign_fresh_assignments(&context, &original.members, &transaction_id, now, &key)?;
            (transaction_id, envelopes)
        }
        Replacement::Editor(envelopes) => {
            let (edited, _) =
                crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
                    envelopes,
                    |identity| crate::normalized_mutation::actor_state_at(&tx, identity),
                )
                .map_err(|e| format!("recovery editor signature verification failed: {e}"))?;
            if edited.actor_id != context.actor_id
                || edited.epoch_id != context.epoch_id
                || edited.library_id != context.library_id
                || edited.transaction_id == original.transaction_id
                || edited.members.len() != original.members.len()
                || edited
                    .members
                    .iter()
                    .zip(&original.members)
                    .any(|(new, old)| {
                        new.operation_type != old.operation_type
                            || new.entity_type != old.entity_type
                            || new.entity_id != old.entity_id
                    })
            {
                return Err(
                    "recovery editor must preserve the complete ordered operation and target set"
                        .into(),
                );
            }
            for (member, archived) in edited.members.iter().zip(&original.members) {
                if member.operation_type == "preferences_leaf_assignment" {
                    let old: Value = serde_json::from_str(
                        archived
                            .structured_payload_json
                            .as_deref()
                            .ok_or("verified preference patch missing")?,
                    )
                    .map_err(|e| e.to_string())?;
                    let new: Value = serde_json::from_str(
                        member
                            .structured_payload_json
                            .as_deref()
                            .ok_or("verified preference patch missing")?,
                    )
                    .map_err(|e| e.to_string())?;
                    if !same_preference_assignment_scope(&old, &new) {
                        return Err(
                            "recovery must preserve the original preference assignment paths"
                                .into(),
                        );
                    }
                }
                // Check the original event identity, not its editable time or text.
                // A checkpoint may retain the event without its acceptance receipt.
                if member.operation_type == "person_reach_out_append" {
                    let present: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_person_reach_outs WHERE person_id = ?1 AND reach_out_id = ?2);",
                        params![archived.entity_id, archived.operation_id], |row| row.get(0),
                    ).map_err(|error| error.to_string())?;
                    if present {
                        return Err("recovery reach-out event is already present".into());
                    }
                }
                if matches!(
                    member.operation_type.as_str(),
                    "person_upsert" | "friend_replace"
                ) {
                    let deleted: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_tombstones WHERE entity_type = 'person' AND entity_id = ?1);",
                        [&member.entity_id], |row| row.get(0),
                    ).map_err(|error| error.to_string())?;
                    if deleted {
                        return Err("recovery cannot recreate a deleted person".into());
                    }
                }
                if member.operation_type == "account_upsert" {
                    let deleted: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_tombstones WHERE entity_type = 'account' AND entity_id = ?1);",
                        [&member.entity_id], |row| row.get(0),
                    ).map_err(|error| error.to_string())?;
                    if deleted {
                        return Err("recovery cannot recreate a deleted account".into());
                    }
                }
                if member.operation_type == "friend_replace" {
                    // The verified payload contains at most 64 selected accounts. Check
                    // inside this write transaction so deletion cannot race admission.
                    let deleted: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM json_each(?1, '$.accounts') AS selected JOIN library_tombstones AS deleted ON deleted.entity_type = 'account' AND deleted.entity_id = json_extract(selected.value, '$.id'));",
                        [member.person_json.as_deref().ok_or("verified Friend payload missing")?],
                        |row| row.get(0),
                    ).map_err(|error| error.to_string())?;
                    if deleted {
                        return Err("recovery cannot recreate a deleted account".into());
                    }
                }
                if member.operation_type == "feed_item_capture_upsert" {
                    let deleted: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_tombstones WHERE entity_type = 'feed_item' AND entity_id = ?1);",
                        [&member.entity_id], |row| row.get(0),
                    ).map_err(|error| error.to_string())?;
                    if deleted {
                        return Err("recovery cannot recreate a deleted item".into());
                    }
                }
                if member.operation_type == "rss_feed_upsert" {
                    let deleted: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_tombstones WHERE entity_type = 'rss_feed' AND entity_id = ?1);",
                        [&member.entity_id], |row| row.get(0),
                    ).map_err(|error| error.to_string())?;
                    if deleted {
                        return Err("recovery cannot recreate a deleted subscription".into());
                    }
                }
            }
            (edited.transaction_id, envelopes.to_vec())
        }
    };
    let already_stored: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM library_intent_transactions WHERE transaction_id = ?1);",
            [&transaction_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if already_stored {
        return Err("recovery cannot attach an existing unlinked intent".into());
    }
    let committed = enqueue_normalized_follower_intent_in_transaction_v1(&tx, &envelopes, now)
        .map_err(|e| e.to_string())?;
    let replacement_digest: String = tx
        .query_row(
            "SELECT transaction_digest FROM library_intent_transactions WHERE transaction_id = ?1;",
            [&transaction_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let receipt = RecoveryReissueReceiptV1 {
        schema_version: 1,
        recovery_id: request.recovery_id.clone(),
        original_transaction_id: original.transaction_id,
        replacement_transaction_id: transaction_id,
        replacement_transaction_digest: replacement_digest,
        replacement_epoch_id: context.epoch_id,
        replacement_actor_id: context.actor_id,
        first_counter: committed.first_counter,
        last_counter: committed.last_counter,
        member_count: committed.member_count,
        created_at: now,
    };
    tx.execute(
        "INSERT INTO library_local_recovery_reissues VALUES
         (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15);",
        params![
            receipt.recovery_id,
            receipt.original_transaction_id,
            request.archive_digest,
            request.transaction_digest,
            receipt.replacement_transaction_id,
            receipt.replacement_transaction_digest,
            receipt.replacement_epoch_id,
            receipt.replacement_actor_id,
            receipt.first_counter,
            receipt.last_counter,
            receipt.member_count,
            request.reviewed_generation_id,
            request.reviewed_revision,
            request.reviewed_local_sequence,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(receipt)
}

// Objects merge child paths. Arrays and scalars replace the complete value at
// their path, so array elements are values rather than independent assignments.
fn same_preference_assignment_scope(original: &Value, replacement: &Value) -> bool {
    let old_number = crate::normalized_preference_policy::is_binary64_wrapper(original);
    let new_number = crate::normalized_preference_policy::is_binary64_wrapper(replacement);
    if old_number || new_number {
        return (!original.is_object() || old_number) && (!replacement.is_object() || new_number);
    }
    match (original, replacement) {
        (Value::Object(old), Value::Object(new)) => {
            old.len() == new.len()
                && old.iter().all(|(key, value)| {
                    new.get(key)
                        .is_some_and(|next| same_preference_assignment_scope(value, next))
                })
        }
        (Value::Object(_), _) | (_, Value::Object(_)) => false,
        _ => true,
    }
}

fn assignment_payload(member: &VerifiedOperation, now: i64) -> Result<Value, String> {
    if member.entity_type != "FeedItem" {
        return Err("this archived edit requires its original editor".into());
    }
    match member.operation_type.as_str() {
        "feed_item_read_assignment" if member.read_at_ms.is_some() => {
            Ok(json!({"read_at_ms": now}))
        }
        "feed_item_saved_assignment"
        | "feed_item_archive_assignment"
        | "feed_item_like_assignment" => Ok(
            json!({"assigned": member.assigned.ok_or("archived assignment is incomplete")?, "assigned_at_ms": now}),
        ),
        _ => Err("this archived edit requires its original editor".into()),
    }
}

/// Construction uses the registered payload, member, transaction, chain and
/// signature domains in their non-circular order. Enqueue independently verifies
/// all resulting canonical bytes before persistence. Shared vectors prove parity.
fn sign_fresh_assignments(
    context: &NormalizedMutationContextV1,
    originals: &[VerifiedOperation],
    transaction_id: &str,
    now: i64,
    key: &Ed25519KeyPair,
) -> Result<Vec<Vec<u8>>, String> {
    if originals.is_empty()
        || originals.len() > 1000
        || context.next_counter < 1
        || context
            .next_counter
            .checked_add(originals.len() as i64)
            .is_none_or(|end| end > MAX_SAFE_INTEGER)
        || !(0..=MAX_SAFE_INTEGER).contains(&now)
    {
        return Err("recovery assignment transaction exceeds its bounds".into());
    }
    let digest =
        |domain, value: &Value, index| digest_hex(domain, value, index).map_err(|e| e.to_string());
    let mut bodies = Vec::with_capacity(originals.len());
    let mut member_digests = Vec::with_capacity(originals.len());
    let frontier: Vec<_> = context
        .observed_frontier
        .iter()
        .map(|tip| {
            json!({
                "actor_id": tip.actor_id, "sequence": tip.sequence,
                "operation_id": tip.operation_id, "chain_digest": tip.chain_digest,
            })
        })
        .collect();
    for (index, original) in originals.iter().enumerate() {
        let payload = assignment_payload(original, now)?;
        let payload_digest = digest(
            "operation-payload",
            &json!({
                "schema_version": 1, "operation_type": original.operation_type, "payload": payload,
            }),
            index,
        )?;
        let body = json!({
            "operation_id": format!("{transaction_id}:{index}"), "library_id": context.library_id,
            "epoch": context.epoch, "epoch_id": context.epoch_id, "schema_version": 1,
            "actor_id": context.actor_id, "actor_sequence": context.next_counter + index as i64,
            "previous_actor_operation_id": if index == 0 { context.previous_operation_id.clone() }
                else { Some(format!("{transaction_id}:{}", index - 1)) },
            "causal_frontier": frontier, "hlc_wall_ms": now, "hlc_counter": 0,
            "transaction_id": transaction_id, "transaction_member_index": index,
            "transaction_member_count": originals.len(), "operation_type": original.operation_type,
            "entity_type": "FeedItem", "entity_id": original.entity_id, "payload": payload,
            "payload_digest": payload_digest, "blob_references": [], "created_at_ms": now,
            "signature_algorithm": "ed25519",
        });
        member_digests.push(digest("transaction-member", &body, index)?);
        bodies.push(body);
    }
    let transaction_digest = digest(
        "transaction",
        &json!({
            "transaction_id": transaction_id, "transaction_member_count": originals.len(), "actor_id": context.actor_id,
            "initial_previous_actor_operation_id": context.previous_operation_id,
            "initial_previous_actor_chain_digest": context.previous_chain_digest,
            "transaction_member_digests": member_digests,
        }),
        0,
    )?;
    let mut previous = context.previous_chain_digest.clone();
    let mut total = 0_usize;
    let mut prepared = Vec::with_capacity(bodies.len());
    for (index, mut body) in bodies.into_iter().enumerate() {
        let chain = digest(
            "actor-chain",
            &json!({
                "previous_actor_chain_digest": previous, "transaction_member_digest": member_digests[index],
                "transaction_digest": transaction_digest,
            }),
            index,
        )?;
        body["previous_actor_chain_digest"] = json!(previous);
        body["actor_chain_digest"] = json!(chain);
        body["transaction_digest"] = json!(transaction_digest);
        let signing_digest = digest("operation-signing-body", &body, index)?;
        let message = encode_operation_signature_input(
            &json!({"operation_signing_body_digest": signing_digest}),
            131072,
        )
        .map_err(|_| "recovery signature input exceeds its bound")?;
        // Signature width is fixed. Close the full byte budget before any signing.
        body["signature"] = json!("0".repeat(128));
        let bytes = encode_canonical_value(&body, 131072)
            .map_err(|_| "recovery envelope exceeds its bound")?;
        total = total
            .checked_add(bytes.len())
            .ok_or("recovery envelope byte count overflow")?;
        if total > 4_194_304 {
            return Err("recovery envelopes exceed the transaction byte bound".into());
        }
        prepared.push((body, message));
        previous = chain;
    }
    prepared
        .into_iter()
        .map(|(mut body, message)| {
            body["signature"] = json!(lower_hex(key.sign(&message).as_ref()));
            encode_canonical_value(&body, 131072)
                .map_err(|_| "recovery signed envelope exceeds its bound".into())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    struct KeyStore(Vec<u8>);
    impl ActorKeyStore for KeyStore {
        fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }
        fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
            panic!("reapplication must never create a key")
        }
    }
    struct NoKeyAccess;
    impl ActorKeyStore for NoKeyAccess {
        fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
            panic!("retry must not access signing keys")
        }
        fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
            panic!("retry must not create signing keys")
        }
    }

    fn certified_original_fixture() -> (
        Connection,
        Ed25519KeyPair,
        crate::normalized_operation::VerifiedActorEnrollment,
    ) {
        let (mut db, _, original) = crate::normalized_mutation::tests::fixture();
        struct AuthorityStore(Vec<u8>);
        impl crate::normalized_authority_credentials::AuthorityKeyStore for AuthorityStore {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(self.0.clone()))
            }
            fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
                panic!("fixture key exists")
            }
        }
        let authority_keys = AuthorityStore(
            Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                .unwrap()
                .as_ref()
                .to_vec(),
        );
        let actor_keys = KeyStore(
            Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                .unwrap()
                .as_ref()
                .to_vec(),
        );
        let authority_key = Ed25519KeyPair::from_pkcs8(&authority_keys.0).unwrap();
        let public_key = lower_hex(authority_key.public_key().as_ref());
        let authority_key_id = digest_hex(
            "authority-key",
            &json!({"signature_algorithm":"ed25519", "authority_public_key":public_key}),
            0,
        )
        .unwrap();
        db.execute(
            "UPDATE library_authority_epochs SET authority_key_id=?1,authority_public_key=?2;",
            params![authority_key_id, public_key],
        )
        .unwrap();
        let authority = crate::normalized_authority::NormalizedAuthorityStateV2 {
            library_id: original.library_id,
            epoch: original.epoch,
            epoch_id: original.epoch_id,
            authority_key_id,
            authority_public_key: public_key,
            observed_frontier: vec![],
        };
        let request = crate::library_core_actor_enrollment::prepare_normalized_follower_actor_enrollment_request_v2(&authority,&"7".repeat(64),&actor_keys,800).unwrap();
        db.execute(
            "INSERT INTO library_materialization_generation VALUES (1, ?1);",
            [&"f".repeat(64)],
        )
        .unwrap();
        let response =
            crate::normalized_follower::countersign_normalized_follower_actor_request_v2(
                &mut db,
                request.canonical_enrollment_request_json.as_bytes(),
                &authority_keys,
                800,
            )
            .unwrap();
        let enrollment = crate::normalized_enrollment_verifier::verify_actor_enrollment(
            response.canonical_enrollment_certificate_json.as_bytes(),
            &authority,
        )
        .unwrap();
        // The recovery fixture owns an isolated source revision; enrollment was
        // independently verified and installed through the production boundary.
        db.execute_batch("UPDATE library_meta SET source_revision=0; UPDATE library_change_state SET revision=0; DELETE FROM library_materialization_generation;").unwrap();
        (
            db,
            Ed25519KeyPair::from_pkcs8(&actor_keys.0).unwrap(),
            enrollment,
        )
    }

    // Synthetic admitted successor state isolates reapplication. The handoff
    // lifecycle suite separately proves predecessor authorization and reenrollment.
    fn fixture(
        operation: &str,
        accepted: bool,
    ) -> (Connection, RecoveryReissueRequestV1, KeyStore) {
        fixture_with_original_certificate(operation, accepted, false)
    }

    fn fixture_with_original_certificate(
        operation: &str,
        accepted: bool,
        certified: bool,
    ) -> (Connection, RecoveryReissueRequestV1, KeyStore) {
        let (mut db, old_key, old_actor) = if certified {
            certified_original_fixture()
        } else {
            crate::normalized_mutation::tests::fixture()
        };
        let large_payload = (operation == "feed_item_annotations_replace").then(|| json!({"assigned_at_ms":900,"tags":[],
            "highlights":[{"text":"\"".repeat(43000),"note":null,"textBlobDigest":null,"createdAt":900}]}));
        let entities = if operation == "preferences_leaf_assignment" {
            vec![("preferences", 900), ("preferences", 901)]
        } else if operation == "friend_replace" {
            vec![("rss:item:1", 900)]
        } else if large_payload.is_some() {
            vec![
                ("rss:item:1", 900),
                ("rss:item:2", 901),
                ("rss:item:3", 902),
                ("rss:item:4", 903),
            ]
        } else {
            vec![("rss:item:1", 900), ("rss:item:2", 901)]
        };
        let envelopes = crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload(
            &old_key,
            &old_actor,
            "archived:reissue",
            1,
            None,
            &old_actor.actor_chain_genesis,
            &entities,
            operation, large_payload.as_ref(),
        );
        let (original, _) =
            crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
                &envelopes,
                |identity| crate::normalized_mutation::actor_state_at(&db, identity),
            )
            .unwrap();
        if accepted {
            crate::normalized_mutation::accept_normalized_operation_transaction_v1(
                &mut db, &envelopes, &old_key, 1000,
            )
            .unwrap();
        }
        let member_count = original.members.len();
        let last = original.members.last().unwrap();
        db.execute(
            "INSERT INTO library_intent_actors VALUES (?1, ?4, ?2, ?3);",
            params![
                original.actor_id,
                last.operation_id,
                last.actor_chain_digest,
                member_count + 1
            ],
        )
        .unwrap();
        db.execute("INSERT INTO library_intent_transactions VALUES (?1, ?2, ?3, ?4, ?5, ?11, 1, ?11, NULL, ?6, ?7, ?8, ?9, ?10, 'pending', 1000, NULL, NULL);",
            params![original.transaction_id, original.transaction_digest, original.actor_id, original.epoch, original.epoch_id,
                old_actor.actor_chain_genesis, last.operation_id, last.actor_chain_digest, original.canonical_envelope_bytes, b"{}", member_count]).unwrap();
        for (index, member) in original.members.iter().enumerate() {
            db.execute("INSERT INTO library_intent_members VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
                params![original.transaction_id, original.actor_id, index, member.operation_id, member.actor_sequence,
                    member.operation_type, member.entity_type, member.entity_id, member.canonical_envelope_json.as_bytes(), member.member_digest]).unwrap();
        }
        let recovery = "a".repeat(64);
        let successor = "b".repeat(64);
        let actor = "c".repeat(64);
        let capability = "d".repeat(64);
        let request_digest = "e".repeat(64);
        let generation = "f".repeat(64);
        let key_bytes = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let key = Ed25519KeyPair::from_pkcs8(key_bytes.as_ref()).unwrap();
        let public_key = lower_hex(key.public_key().as_ref());
        let tx = db.transaction().unwrap();
        crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).unwrap();
        tx.execute("INSERT INTO library_local_recovery_archives (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at,
            reenrollment_committed_at, reenrollment_receipt, reenrollment_digest, reenrollment_installation_witness)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?9, ?7, 1000, 1100, ?8, ?7, ?7);",
            params![recovery, original.library_id, original.epoch_id, successor, original.actor_id,
                crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256, generation,
                serde_json::to_vec(&json!({"actorId": actor, "enrollmentRequestDigest": request_digest})).unwrap(), member_count + 1]).unwrap();
        for table in ["library_intent_transactions", "library_intent_members"] {
            let mut statement = tx.prepare(&format!("PRAGMA table_info({table});")).unwrap();
            let names = statement
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            let order = if table == "library_intent_members" {
                "member_index"
            } else {
                "transaction_id"
            };
            let mut statement = tx
                .prepare(&format!("SELECT * FROM {table} ORDER BY {order};"))
                .unwrap();
            let mut rows = statement.query([]).unwrap();
            let mut ordinal = 0;
            while let Some(row) = rows.next().unwrap() {
                let bytes =
                    crate::normalized_consumer_recovery::encode_recovery_row(row, names.len())
                        .unwrap();
                tx.execute(
                    "INSERT INTO library_local_recovery_rows VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
                    params![
                        recovery,
                        table,
                        ordinal,
                        original.transaction_id,
                        serde_json::to_string(&names).unwrap(),
                        bytes,
                        lower_hex(&Sha256::digest(&bytes))
                    ],
                )
                .unwrap();
                ordinal += 1;
            }
        }
        tx.execute_batch("DELETE FROM library_intent_members; DELETE FROM library_intent_transactions; DELETE FROM library_intent_actors;").unwrap();
        tx.execute("INSERT INTO library_authority_epochs SELECT ?1, library_id, 2, authority_key_id, authority_public_key,
            ?2, '{}', 1, checkpoint_frontier_digest, materialized_state_digest, 1100 FROM library_authority_epochs WHERE epoch_id = ?3;",
            params![successor, generation, original.epoch_id]).unwrap();
        tx.execute(
            "UPDATE library_active_authority SET epoch_id = ?1, accepted_manifest_generation = 1;",
            [&successor],
        )
        .unwrap();
        tx.execute(
            "UPDATE library_meta SET authority_epoch = ?1;",
            [&successor],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO library_materialization_generation VALUES (1, ?1);",
            [&generation],
        )
        .unwrap();
        tx.execute("INSERT INTO library_actors SELECT ?1, ?2, actor_kind, ?3, enrollment_operation_id, ?4, canonical_enrollment_certificate,
            chain_genesis_digest, 0, NULL, chain_genesis_digest, NULL, 1100, 1100 FROM library_actors WHERE actor_id = ?5;",
            params![actor, successor, public_key, capability, original.actor_id]).unwrap();
        tx.execute("INSERT INTO library_actor_capabilities (capability_id, actor_id, certificate_version, actor_class, scope_mode, issuance_identity, retirement_identity, certificate_digest, canonical_certificate, issued_at)
            VALUES (?1, ?2, 2, 'editor', 'library_wide', ?3, ?3, ?1, '{}', 1100);", params![capability, actor, generation]).unwrap();
        tx.execute("INSERT INTO library_actor_capability_mutations SELECT ?1, mutation_id FROM library_actor_capability_mutations WHERE capability_id = ?2;",
            params![capability, old_actor.enrollment_certificate_digest]).unwrap();
        tx.execute("INSERT INTO library_follower_actor_request VALUES (1, ?1, ?2, ?3, ?4, ?5, '{}', 1100, ?6, '{}', ?7, 1100);",
            params![original.library_id, successor, actor, public_key, request_digest, capability, old_actor.actor_chain_genesis]).unwrap();
        tx.execute(
            "INSERT INTO library_intent_actors VALUES (?1, 1, NULL, ?2);",
            params![actor, old_actor.actor_chain_genesis],
        )
        .unwrap();
        tx.execute("INSERT INTO library_local_handoff (singleton_id, handoff_id, library_id, installation_role, phase, predecessor_epoch_id, successor_epoch_id, target_writer_id,
            target_authority_public_key, canonical_readiness, canonical_authorization_body, expected_control_revision, created_at, updated_at)
            VALUES (1, ?1, ?2, 'consumer', 'following', ?3, ?4, ?5, ?6, X'7B7D', X'7B7D', 'fixture', 1000, 1100);",
            params![recovery, original.library_id, original.epoch_id, successor, actor, public_key]).unwrap();
        bind_fixture_recovery_receipt(&tx, &recovery);
        tx.commit().unwrap();
        (
            db,
            RecoveryReissueRequestV1 {
                schema_version: 1,
                recovery_id: recovery,
                archive_digest: generation.clone(),
                transaction_id: original.transaction_id,
                transaction_digest: original.transaction_digest,
                reviewed_generation_id: generation,
                reviewed_revision: i64::from(accepted),
                reviewed_local_sequence: 0,
                member_count,
            },
            KeyStore(key_bytes.as_ref().to_vec()),
        )
    }

    fn bind_fixture_recovery_receipt(db: &Connection, archive: &str) {
        let (library, epoch): (String, String) = db
            .query_row(
                "SELECT library_id, authority_epoch FROM library_meta;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let request = crate::normalized_follower::actor_request(db, &library, &epoch)
            .unwrap()
            .unwrap();
        let bytes = crate::library_core_canonical::encode_canonical_value(
            &serde_json::to_value(request).unwrap(),
            131_072,
        )
        .unwrap();
        db.execute("UPDATE library_local_recovery_archives SET reenrollment_receipt = ?2, reenrollment_digest = ?3 WHERE recovery_id = ?1;", params![archive, bytes, lower_hex(&Sha256::digest(&bytes))]).unwrap();
    }

    // Synthetic admitted third epoch. Preserve the second epoch's signed pending
    // intents exactly; lifecycle signature/CAS proof belongs to the handoff suite.
    fn advance_fixture(db: &mut Connection) -> String {
        let archive = "3".repeat(64);
        let epoch = "4".repeat(64);
        let actor = "5".repeat(64);
        let capability = "6".repeat(64);
        let digest = "7".repeat(64);
        let prior = normalized_follower_mutation_context_v1(db).unwrap();
        let tx = db.transaction().unwrap();
        tx.execute("INSERT INTO library_local_recovery_archives (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at, reenrollment_committed_at, reenrollment_receipt, reenrollment_digest, reenrollment_installation_witness)
            SELECT ?1, library_id, successor_epoch_id, ?2, ?3, schema_sha256, 0, ?4, 3000, 3100, ?5, ?4, ?4 FROM library_local_recovery_archives LIMIT 1;",
            params![archive, epoch, prior.actor_id, digest, serde_json::to_vec(&json!({"actorId":actor,"enrollmentRequestDigest":digest})).unwrap()]).unwrap();
        for table in ["library_intent_transactions", "library_intent_members"] {
            let names = tx
                .prepare(&format!("PRAGMA table_info({table});"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            let mut statement = tx
                .prepare(&format!(
                    "SELECT * FROM {table} ORDER BY {};",
                    if table == "library_intent_members" {
                        "transaction_id, member_index"
                    } else {
                        "transaction_id"
                    }
                ))
                .unwrap();
            let mut rows = statement.query([]).unwrap();
            let mut ordinal = 0;
            while let Some(row) = rows.next().unwrap() {
                let bytes =
                    crate::normalized_consumer_recovery::encode_recovery_row(row, names.len())
                        .unwrap();
                let id: String = row.get(0).unwrap();
                tx.execute(
                    "INSERT INTO library_local_recovery_rows VALUES (?1,?2,?3,?4,?5,?6,?7);",
                    params![
                        archive,
                        table,
                        ordinal,
                        id,
                        serde_json::to_string(&names).unwrap(),
                        bytes,
                        lower_hex(&Sha256::digest(&bytes))
                    ],
                )
                .unwrap();
                ordinal += 1;
            }
        }
        tx.execute("UPDATE library_local_recovery_archives SET row_count = (SELECT count(*) FROM library_local_recovery_rows WHERE recovery_id = ?1) WHERE recovery_id = ?1;", [&archive]).unwrap();
        tx.execute("INSERT INTO library_authority_epochs SELECT ?1, library_id, 3, authority_key_id, authority_public_key, ?2, '{}', 1, checkpoint_frontier_digest, materialized_state_digest, 3100 FROM library_authority_epochs WHERE epoch_id = ?3;", params![epoch,digest,prior.epoch_id]).unwrap();
        tx.execute("INSERT INTO library_actors SELECT ?1, ?2, actor_kind, public_key, enrollment_operation_id, ?3, canonical_enrollment_certificate, chain_genesis_digest, 0, NULL, chain_genesis_digest, NULL, 3100, 3100 FROM library_actors WHERE actor_id = ?4;",params![actor,epoch,capability,prior.actor_id]).unwrap();
        tx.execute("INSERT INTO library_actor_capabilities (capability_id, actor_id, certificate_version, actor_class, scope_mode, issuance_identity, retirement_identity, certificate_digest, canonical_certificate, issued_at) SELECT ?1, ?2, certificate_version, actor_class, scope_mode, issuance_identity, retirement_identity, ?1, canonical_certificate, 3100 FROM library_actor_capabilities WHERE actor_id = ?3;",params![capability,actor,prior.actor_id]).unwrap();
        tx.execute("INSERT INTO library_actor_capability_mutations SELECT ?1, mutation_id FROM library_actor_capability_mutations WHERE capability_id = (SELECT enrollment_certificate_digest FROM library_actors WHERE actor_id = ?2);",params![capability,prior.actor_id]).unwrap();
        tx.execute(
            "UPDATE library_active_authority SET epoch_id = ?1;",
            [&epoch],
        )
        .unwrap();
        tx.execute("UPDATE library_meta SET authority_epoch = ?1;", [&epoch])
            .unwrap();
        tx.execute("UPDATE library_follower_actor_request SET authority_epoch_id = ?1, actor_id = ?2, enrollment_request_digest = ?3, enrollment_certificate_digest = ?4;", params![epoch,actor,digest,capability]).unwrap();
        tx.execute_batch("DELETE FROM library_optimistic_fields; DELETE FROM library_intent_members; DELETE FROM library_intent_transactions; DELETE FROM library_intent_actors;").unwrap();
        tx.execute(
            "INSERT INTO library_intent_actors SELECT ?1,1,NULL,chain_genesis_digest FROM library_actors WHERE actor_id = ?1;",
            params![actor],
        )
        .unwrap();
        tx.execute("UPDATE library_local_handoff SET handoff_id = ?1, predecessor_epoch_id = ?2, successor_epoch_id = ?3, updated_at = 3100;",params![archive,prior.epoch_id,epoch]).unwrap();
        bind_fixture_recovery_receipt(&tx, &archive);
        tx.commit().unwrap();
        archive
    }

    #[test]
    fn older_archives_use_current_admission_and_never_fork_an_existing_replacement() {
        let (mut db, mut request, keys) = fixture("feed_item_saved_assignment", false);
        advance_fixture(&mut db);
        db.execute("UPDATE library_local_handoff SET phase = 'recovery';", [])
            .unwrap();
        assert!(reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 3200).is_err());
        db.execute("UPDATE library_local_handoff SET phase = 'following';", [])
            .unwrap();
        let fresh = reapply_archived_assignments_v1(&mut db, &request, &keys, 3201).unwrap();
        assert_eq!(fresh.replacement_epoch_id, "4".repeat(64));
        assert_eq!(fresh.replacement_actor_id, "5".repeat(64));

        let (mut db, original, keys) = fixture("feed_item_saved_assignment", false);
        let first = reapply_archived_assignments_v1(&mut db, &original, &keys, 2000).unwrap();
        let second_archive = advance_fixture(&mut db);
        assert_eq!(
            reapply_archived_assignments_v1(&mut db, &original, &NoKeyAccess, 3200).unwrap(),
            first
        );
        let review = crate::normalized_query::query_normalized_json_v1(&mut db, json!({"queryId":"recovery_intent_review_v1","schemaVersion":1,
            "recoveryId":second_archive,"transactionId":first.replacement_transaction_id,"cursor":null,"limit":8,"cancellationId":"review-cancel","readerSessionId":"review-reader"})).unwrap();
        request = RecoveryReissueRequestV1 {
            schema_version: 1,
            recovery_id: second_archive,
            archive_digest: review["archiveDigest"].as_str().unwrap().into(),
            transaction_id: first.replacement_transaction_id,
            transaction_digest: first.replacement_transaction_digest,
            reviewed_generation_id: review["source"]["generationId"].as_str().unwrap().into(),
            reviewed_revision: review["source"]["projectionRevision"].as_i64().unwrap(),
            reviewed_local_sequence: review["source"]["transitionSequence"].as_i64().unwrap(),
            member_count: 2,
        };
        let second = reapply_archived_assignments_v1(&mut db, &request, &keys, 3201).unwrap();
        assert_ne!(second.replacement_transaction_id, original.transaction_id);
        assert_eq!(
            reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 3202).unwrap(),
            second
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_local_recovery_reissues;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_intent_transactions;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }

    fn editor_envelopes(
        db: &Connection,
        keys: &KeyStore,
        operation: &str,
        entities: &[(&str, i64)],
    ) -> Vec<Vec<u8>> {
        editor_envelopes_with_payload(db, keys, operation, entities, None)
    }

    fn editor_envelopes_with_payload(
        db: &Connection,
        keys: &KeyStore,
        operation: &str,
        entities: &[(&str, i64)],
        payload: Option<&Value>,
    ) -> Vec<Vec<u8>> {
        let context = normalized_follower_mutation_context_v1(db).unwrap();
        let state = crate::normalized_mutation::actor_state_at(
            db,
            &crate::normalized_operation_verifier::OperationIdentity {
                library_id: context.library_id,
                epoch_id: context.epoch_id,
                actor_id: context.actor_id,
            },
        )
        .unwrap();
        let enrollment = crate::normalized_operation::VerifiedActorEnrollment {
            library_id: state.library_id,
            epoch: state.epoch,
            epoch_id: state.epoch_id,
            actor_id: state.actor_id,
            actor_public_key: state.actor_public_key,
            enrollment_operation_id: state.enrollment_operation_id,
            enrollment_certificate_digest: state.enrollment_certificate_digest,
            canonical_enrollment_certificate_json: state.canonical_enrollment_certificate_json,
            actor_chain_genesis: state.actor_chain_genesis,
            enrolled_at_ms: 1100,
            capability: state.capability,
        };
        crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload(
            &Ed25519KeyPair::from_pkcs8(&keys.0).unwrap(),
            &enrollment,
            "editor:replacement",
            context.next_counter,
            context.previous_operation_id.as_deref(),
            &context.previous_chain_digest,
            entities,
            operation,
            payload,
        )
    }

    #[test]
    fn capture_recovery_refuses_tombstones_before_writes_and_preserves_exact_retry() {
        let (mut db, request, keys) = fixture("feed_item_capture_upsert", false);
        let frames = editor_envelopes(
            &db,
            &keys,
            "feed_item_capture_upsert",
            &[("rss:item:1", 2000), ("rss:item:2", 2000)],
        );
        let deleted = "INSERT INTO library_tombstones VALUES ('feed_item','rss:item:2','test-actor',1,'test:delete',1500);";
        db.execute(deleted, []).unwrap();
        assert!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                .unwrap_err()
                .contains("deleted item")
        );
        for table in [
            "library_intent_transactions",
            "library_intent_members",
            "library_local_recovery_reissues",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
        // Reset only this synthetic fixture to model a never-created target.
        db.execute(
            "DELETE FROM library_tombstones WHERE entity_type='feed_item';",
            [],
        )
        .unwrap();
        db.execute("DELETE FROM library_feed_items;", []).unwrap();
        let receipt =
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000).unwrap();
        db.execute(deleted, []).unwrap();
        assert_eq!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2001).unwrap(),
            receipt
        );
    }

    #[test]
    fn rss_recovery_distinguishes_absence_and_refuses_tombstones_before_writes() {
        let (mut db, request, keys) = fixture("rss_feed_upsert", false);
        let query = json!({"queryId":"recovery_intent_review_v1", "schemaVersion":1,
            "recoveryId":request.recovery_id, "transactionId":request.transaction_id,
            "cursor":null, "limit":16, "readerSessionId":"rss-review", "cancellationId":"rss-cancel"});
        let first = crate::query_normalized_json_v1(&mut db, query.clone()).unwrap();
        assert_eq!(first["rows"][0]["rssFeedState"], "absent");
        db.execute("INSERT INTO library_rss_feeds (url,title,enabled,track_unread,updated_at) VALUES ('rss:item:1','Current',0,1,1500);", []).unwrap();
        let actor = normalized_follower_mutation_context_v1(&db)
            .unwrap()
            .actor_id;
        let deleted = "INSERT INTO library_tombstones VALUES ('rss_feed','rss:item:2',?1,1,'test:delete',1500);";
        db.execute(deleted, [&actor]).unwrap();
        let state = crate::query_normalized_json_v1(&mut db, query).unwrap();
        assert_eq!(state["rows"][0]["rssFeedState"], "present");
        assert_eq!(state["rows"][1]["rssFeedState"], "deleted");
        let frames = editor_envelopes(
            &db,
            &keys,
            "rss_feed_upsert",
            &[("rss:item:1", 2000), ("rss:item:2", 2000)],
        );
        assert!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                .unwrap_err()
                .contains("deleted subscription")
        );
        for table in [
            "library_intent_transactions",
            "library_intent_members",
            "library_local_recovery_reissues",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
        // Fixture reset models the separate never-created case, never a product restore.
        db.execute(
            "DELETE FROM library_tombstones WHERE entity_type='rss_feed';",
            [],
        )
        .unwrap();
        let receipt =
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000).unwrap();
        db.execute(deleted, [&actor]).unwrap();
        assert_eq!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2001).unwrap(),
            receipt
        );
    }

    #[test]
    fn person_recovery_distinguishes_absence_and_refuses_tombstones_before_writes() {
        for operation in ["person_upsert", "friend_replace"] {
            let (mut db, request, keys) = fixture(operation, false);
            let query = json!({"queryId":"recovery_intent_review_v1", "schemaVersion":1,
            "recoveryId":request.recovery_id, "transactionId":request.transaction_id,
            "cursor":null, "limit":16, "readerSessionId":"rss-review", "cancellationId":"rss-cancel"});
            let first = crate::query_normalized_json_v1(&mut db, query.clone()).unwrap();
            assert_eq!(first["rows"][0]["personState"], "absent");
            db.execute("INSERT INTO library_persons (id,name,relationship_status,care_level,created_at,updated_at) VALUES ('rss:item:1','Current','friend',3,1000,1500);", []).unwrap();
            let actor = normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .actor_id;
            let deleted = "INSERT INTO library_tombstones VALUES ('person','rss:item:1',?1,1,'test:delete',1500);";
            let present = crate::query_normalized_json_v1(&mut db, query.clone()).unwrap();
            assert_eq!(present["rows"][0]["personState"], "present");
            db.execute(deleted, [&actor]).unwrap();
            let state = crate::query_normalized_json_v1(&mut db, query).unwrap();
            assert_eq!(state["rows"][0]["personState"], "deleted");
            let frames = editor_envelopes(
                &db,
                &keys,
                operation,
                &[("rss:item:1", 2000), ("rss:item:2", 2000)][..request.member_count],
            );
            assert!(
                reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                    .unwrap_err()
                    .contains("deleted person")
            );
            for table in [
                "library_intent_transactions",
                "library_intent_members",
                "library_local_recovery_reissues",
            ] {
                assert_eq!(
                    db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
            }
            assert_eq!(
                normalized_follower_mutation_context_v1(&db)
                    .unwrap()
                    .next_counter,
                1
            );
            // Fixture reset models the separate never-created case, never a product restore.
            db.execute(
                "DELETE FROM library_tombstones WHERE entity_type='person';",
                [],
            )
            .unwrap();
            let receipt =
                reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000).unwrap();
            db.execute(deleted, [&actor]).unwrap();
            assert_eq!(
                reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2001).unwrap(),
                receipt
            );
        }
    }

    #[test]
    fn friend_recovery_account_order_matches_the_shared_binary_vector() {
        let vector: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/friend-account-order-vector-v1.json"
        ))
        .unwrap();
        let (mut db, request, keys) = fixture("friend_replace", false);
        let frames = |ids: &Value| {
            let accounts: Vec<Value> = ids.as_array().unwrap().iter().map(|id| json!({
                "id":id,"personId":"rss:item:1","kind":"social","provider":"instagram","externalId":"selected","discoveredFrom":"manual_entry","firstSeenAt":1000,"lastSeenAt":2000,"createdAt":1000,"updatedAt":2000
            })).collect();
            let payload = json!({"accounts":accounts,"person":{"id":"rss:item:1","name":"Selected","relationshipStatus":"friend","careLevel":3,"createdAt":1000,"updatedAt":2000}});
            editor_envelopes_with_payload(
                &db,
                &keys,
                "friend_replace",
                &[("rss:item:1", 2000)],
                Some(&payload),
            )
        };
        let locale = frames(&vector["invalidLocaleOrder"]);
        let utf16 = frames(&vector["invalidUtf16Order"]);
        let binary = frames(&vector["binaryOrder"]);
        for invalid in [locale, utf16] {
            assert!(
                reapply_archived_editor_transaction_v1(&mut db, &request, &invalid, 2000)
                    .unwrap_err()
                    .contains("signature verification failed")
            );
            assert_eq!(
                normalized_follower_mutation_context_v1(&db)
                    .unwrap()
                    .next_counter,
                1
            );
            assert_eq!(
                db.query_row(
                    "SELECT count(*) FROM library_local_recovery_reissues",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
        }
        assert_eq!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &binary, 2000)
                .unwrap()
                .member_count,
            1
        );
    }

    #[test]
    fn friend_recovery_refuses_selected_deleted_accounts_and_preserves_exact_retry() {
        let (mut db, request, keys) =
            fixture_with_original_certificate("friend_replace", false, true);
        let actor = normalized_follower_mutation_context_v1(&db)
            .unwrap()
            .actor_id;
        let payload = json!({
            "person": {"id":"rss:item:1", "name":"Recovered", "relationshipStatus":"friend", "careLevel":3, "createdAt":1000, "updatedAt":2000},
            "accounts": [{"id":"account:selected", "personId":"rss:item:1", "kind":"social", "provider":"instagram", "externalId":"selected", "discoveredFrom":"manual_entry", "firstSeenAt":1000, "lastSeenAt":2000, "createdAt":1000, "updatedAt":2000}]
        });
        let frames = editor_envelopes_with_payload(
            &db,
            &keys,
            "friend_replace",
            &[("rss:item:1", 2000)],
            Some(&payload),
        );
        let deleted = "INSERT INTO library_tombstones VALUES ('account','account:selected',?1,1,'test:delete',1500);";
        db.execute(deleted, [&actor]).unwrap();
        assert!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                .unwrap_err()
                .contains("deleted account")
        );
        for table in [
            "library_intent_transactions",
            "library_intent_members",
            "library_local_recovery_reissues",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
        // Separate fixture state: the selected account has never been deleted.
        db.execute(
            "DELETE FROM library_tombstones WHERE entity_type='account';",
            [],
        )
        .unwrap();
        // An unrelated deletion must not block the selected complete set.
        db.execute("INSERT INTO library_tombstones VALUES ('account','account:other',?1,1,'test:other',1500);", [&actor]).unwrap();
        let receipt =
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000).unwrap();
        db.execute(deleted, [&actor]).unwrap();
        assert_eq!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2001).unwrap(),
            receipt
        );
    }

    #[test]
    fn follower_fresh_preference_policy_rejects_authenticated_unsupported_fields() {
        let (mut db, _, keys) =
            fixture_with_original_certificate("preferences_leaf_assignment", false, true);
        let payload = json!({"updates":{"display":{"markReadOnScroll":false}}});
        let frames = editor_envelopes_with_payload(
            &db,
            &keys,
            "preferences_leaf_assignment",
            &[("preferences", 2000)],
            Some(&payload),
        );
        assert!(
            crate::enqueue_normalized_follower_intent_v1(&mut db, &frames, 2000)
                .unwrap_err()
                .to_string()
                .contains("unsupported fields")
        );
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_intent_transactions",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn preference_recovery_preserves_assignment_paths_before_atomic_enqueue() {
        let (mut db, request, keys) =
            fixture_with_original_certificate("preferences_leaf_assignment", false, true);
        let targets = [("preferences", 2000), ("preferences", 2000)];
        let before: Vec<(Vec<u8>, String)> = db.prepare("SELECT canonical_row,row_digest FROM library_local_recovery_rows ORDER BY table_key,row_ordinal").unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?))).unwrap().collect::<Result<_,_>>().unwrap();
        for payload in [
            json!({"updates":{"ai":{"autoSummarize":false}}}),
            json!({"updates":{"ai":{"autoSummarize":false},"display":{"archivePruneDays":30,"showEngagementCounts":false}}}),
            json!({"updates":{"ai":{"autoSummarize":false},"display":null}}),
        ] {
            let frames = editor_envelopes_with_payload(
                &db,
                &keys,
                "preferences_leaf_assignment",
                &targets,
                Some(&payload),
            );
            assert!(
                reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                    .unwrap_err()
                    .contains("assignment paths")
            );
            assert_eq!(
                normalized_follower_mutation_context_v1(&db)
                    .unwrap()
                    .next_counter,
                1
            );
            for table in [
                "library_intent_transactions",
                "library_intent_members",
                "library_local_recovery_reissues",
            ] {
                assert_eq!(
                    db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
            }
        }
        let payload =
            json!({"updates":{"ai":{"autoSummarize":false},"display":{"archivePruneDays":30}}});
        let frames = editor_envelopes_with_payload(
            &db,
            &keys,
            "preferences_leaf_assignment",
            &targets,
            Some(&payload),
        );
        let receipt =
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000).unwrap();
        assert_eq!(receipt.member_count, 2);
        assert_eq!(
            reapply_archived_editor_transaction_v1(
                &mut db,
                &request,
                &[b"invalid retry bytes".to_vec()],
                2001
            )
            .unwrap(),
            receipt
        );
        let after: Vec<(Vec<u8>, String)> = db.prepare("SELECT canonical_row,row_digest FROM library_local_recovery_rows ORDER BY table_key,row_ordinal").unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?))).unwrap().collect::<Result<_,_>>().unwrap();
        assert_eq!(before, after);
        let fractional = json!({"weights":{"topics":{"alpha":{"bits":"3fc0000000000000","codec":"ieee754_binary64_hex_v1"}}}});
        let integral = json!({"weights":{"topics":{"alpha":2}}});
        assert!(same_preference_assignment_scope(&fractional, &integral));
        assert!(same_preference_assignment_scope(&integral, &fractional));
        assert!(same_preference_assignment_scope(
            &json!({"display":{"filters":[1,2]}}),
            &json!({"display":{"filters":[{"other":"value"}]}})
        ));
        assert!(!same_preference_assignment_scope(
            &json!({"display":{"a.b":true}}),
            &json!({"display":{"a":{"b":true}}})
        ));
    }

    #[test]
    fn editor_recovery_preserves_member_scope_and_commits_link_with_signed_intent() {
        // Root edits, account edits and removals share the recovery write boundary.
        // A future family-specific enqueue path must not bypass its atomic link.
        for operation in [
            "feed_item_remove",
            "person_upsert",
            "friend_replace",
            "person_reach_out_append",
            "person_remove_and_accounts",
            "account_upsert",
            "account_person_assignment",
            "account_remove",
        ] {
            check_editor_recovery_atomicity(operation);
        }
    }

    fn check_editor_recovery_atomicity(operation: &str) {
        let (mut db, request, keys) = fixture(operation, false);
        let archive_bytes = |db: &Connection| {
            db.prepare("SELECT canonical_row, row_digest FROM library_local_recovery_rows ORDER BY recovery_id, table_key, row_ordinal")
                .unwrap().query_map([], |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, String>(1)?)))
                .unwrap().collect::<Result<Vec<_>, _>>().unwrap()
        };
        let original_archive = archive_bytes(&db);
        let targets = &[("rss:item:1", 2000), ("rss:item:2", 2000)][..request.member_count];
        let bad_scopes = if operation == "friend_replace" {
            vec![
                (operation, vec![("rss:item:2", 2000)]),
                ("person_upsert", targets.to_vec()),
            ]
        } else {
            vec![
                (operation, vec![("rss:item:1", 2000)]),
                (operation, vec![("rss:item:2", 2000), ("rss:item:1", 2000)]),
                (
                    "feed_item_read_assignment",
                    vec![("rss:item:1", 2000), ("rss:item:2", 2000)],
                ),
            ]
        };
        for (kind, targets) in bad_scopes {
            let frames = editor_envelopes(&db, &keys, kind, &targets);
            assert!(
                reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                    .unwrap_err()
                    .contains("complete ordered")
            );
        }
        let frames = editor_envelopes(&db, &keys, operation, targets);
        if operation == "account_upsert" {
            let actor = normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .actor_id;
            db.execute("INSERT INTO library_tombstones VALUES ('account','rss:item:1',?1,1,'test:deleted',1500);", [&actor]).unwrap();
            assert!(
                reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                    .unwrap_err()
                    .contains("deleted account")
            );
            assert_eq!(
                normalized_follower_mutation_context_v1(&db)
                    .unwrap()
                    .next_counter,
                1
            );
            for table in [
                "library_intent_transactions",
                "library_intent_members",
                "library_local_recovery_reissues",
            ] {
                assert_eq!(
                    db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
            }
            assert_eq!(archive_bytes(&db), original_archive);
            // Separate fixture state models an Account without deletion history.
            db.execute(
                "DELETE FROM library_tombstones WHERE entity_type='account';",
                [],
            )
            .unwrap();
        }
        if operation == "person_reach_out_append" {
            let (original, _) = inspect_archived_intent_for_review(
                &db,
                &request.recovery_id,
                &request.transaction_id,
            )
            .unwrap();
            let member = &original.members[1];
            // A retained second member must refuse the entire two-member action.
            // Changed text still represents the same historical event identity.
            db.execute("INSERT OR IGNORE INTO library_persons (id,name,relationship_status,care_level,created_at,updated_at) VALUES (?1,'Reach-out target','friend',3,1000,1000);", [&member.entity_id]).unwrap();
            db.execute("INSERT INTO library_person_reach_outs VALUES (?1,?2,900,NULL,'Changed retained text');", params![member.entity_id, member.operation_id]).unwrap();
            assert!(
                reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                    .unwrap_err()
                    .contains("event is already present")
            );
            assert_eq!(
                normalized_follower_mutation_context_v1(&db)
                    .unwrap()
                    .next_counter,
                1
            );
            for table in [
                "library_intent_transactions",
                "library_intent_members",
                "library_local_recovery_reissues",
            ] {
                assert_eq!(
                    db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
            }
            assert_eq!(archive_bytes(&db), original_archive);
            db.execute("DELETE FROM library_person_reach_outs;", [])
                .unwrap();
        }
        let mut corrupt = frames.clone();
        corrupt[0][0] = b'[';
        assert!(reapply_archived_editor_transaction_v1(&mut db, &request, &corrupt, 2000).is_err());
        db.execute_batch("CREATE TEMP TRIGGER fail_editor_link BEFORE INSERT ON library_local_recovery_reissues BEGIN SELECT RAISE(ABORT,'editor link fault'); END;").unwrap();
        assert!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000)
                .unwrap_err()
                .contains("editor link fault")
        );
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
        for table in [
            "library_intent_transactions",
            "library_intent_members",
            "library_optimistic_fields",
            "library_local_recovery_reissues",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0,
                "{operation}: {table} survived rollback"
            );
        }
        assert_eq!(
            archive_bytes(&db),
            original_archive,
            "{operation}: failure changed archive"
        );
        db.execute_batch("DROP TRIGGER fail_editor_link;").unwrap();
        let receipt =
            reapply_archived_editor_transaction_v1(&mut db, &request, &frames, 2000).unwrap();
        assert_eq!(receipt.replacement_transaction_id, "editor:replacement");
        if operation == "account_upsert" {
            let actor = normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .actor_id;
            db.execute("INSERT INTO library_tombstones VALUES ('account','rss:item:1',?1,1,'test:later-delete',3000);", [&actor]).unwrap();
        }

        if operation == "person_reach_out_append" {
            let (original, _) = inspect_archived_intent_for_review(
                &db,
                &request.recovery_id,
                &request.transaction_id,
            )
            .unwrap();
            let member = &original.members[1];
            db.execute(
                "INSERT INTO library_person_reach_outs VALUES (?1,?2,900,NULL,NULL);",
                params![member.entity_id, member.operation_id],
            )
            .unwrap();
        }

        // A durable link wins even when a retry arrives after the signing material
        // or actor is no longer usable. The command never signs on behalf of editors.
        assert_eq!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &corrupt, 2001).unwrap(),
            receipt
        );
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            targets.len() as i64 + 1
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_local_recovery_reissues;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            archive_bytes(&db),
            original_archive,
            "{operation}: replacement changed archive"
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM library_intent_members", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            targets.len() as i64
        );
        let (mut other, request, keys) = fixture(operation, false);
        let frames = editor_envelopes(&other, &keys, operation, targets);
        crate::enqueue_normalized_follower_intent_v1(&mut other, &frames, 2000).unwrap();
        // Refresh the review source after the ordinary, deliberately unlinked enqueue.
        let mut request = request;
        request.reviewed_local_sequence = recovery_review_source(&other).unwrap().2;
        assert!(
            reapply_archived_editor_transaction_v1(&mut other, &request, &frames, 2001)
                .unwrap_err()
                .contains("existing unlinked")
        );
    }

    #[test]
    fn follower_enqueue_rejects_invalid_program_scope_before_intent_or_counter_writes() {
        let (mut db, request, keys) = fixture("friend_replace", false);
        let oversized = editor_envelopes(
            &db,
            &keys,
            "friend_replace",
            &[("rss:item:1", 2000), ("rss:item:2", 2000)],
        );
        assert!(
            crate::enqueue_normalized_follower_intent_v1(&mut db, &oversized, 2000)
                .unwrap_err()
                .to_string()
                .contains("registered mutation program")
        );
        for table in [
            "library_intent_transactions",
            "library_intent_members",
            "library_optimistic_fields",
            "library_local_recovery_reissues",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
        let valid = editor_envelopes(&db, &keys, "friend_replace", &[("rss:item:1", 2000)]);
        let receipt =
            reapply_archived_editor_transaction_v1(&mut db, &request, &valid, 2000).unwrap();
        assert_eq!(receipt.member_count, 1);
        assert_eq!(
            reapply_archived_editor_transaction_v1(&mut db, &request, &oversized, 2001).unwrap(),
            receipt
        );

        // Each signature is valid, but two different mutation families cannot
        // be materialized as one registered transaction by either runtime.
        let (mut mixed_db, mixed_request, mixed_keys) = fixture("feed_item_read_assignment", false);
        let (mut original, _) = inspect_archived_intent_for_review(
            &mixed_db,
            &mixed_request.recovery_id,
            &mixed_request.transaction_id,
        )
        .unwrap();
        original.members[1].operation_type = "feed_item_saved_assignment".into();
        original.members[1].assigned = Some(true);
        let context = normalized_follower_mutation_context_v1(&mixed_db).unwrap();
        let mixed = sign_fresh_assignments(
            &context,
            &original.members,
            "mixed:replacement",
            2000,
            &Ed25519KeyPair::from_pkcs8(&mixed_keys.0).unwrap(),
        )
        .unwrap();
        assert!(
            crate::enqueue_normalized_follower_intent_v1(&mut mixed_db, &mixed, 2000)
                .unwrap_err()
                .to_string()
                .contains("registered mutation program")
        );
        assert_eq!(
            normalized_follower_mutation_context_v1(&mixed_db)
                .unwrap()
                .next_counter,
            1
        );
        for table in [
            "library_intent_transactions",
            "library_intent_members",
            "library_optimistic_fields",
            "library_local_recovery_reissues",
        ] {
            assert_eq!(
                mixed_db
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }

    #[test]
    fn editor_payload_pages_bound_escaped_signed_members_without_truncation() {
        let (mut db, request, _) = fixture("feed_item_annotations_replace", false);
        let mut query = json!({"queryId":"recovery_intent_review_v1","schemaVersion":1,"recoveryId":request.recovery_id,
            "transactionId":request.transaction_id,"includeOriginal":true,"cursor":null,"limit":16,"readerSessionId":"large-reader","cancellationId":"large-cancel"});
        let mut seen = 0usize;
        loop {
            let page =
                crate::normalized_query::query_normalized_json_v1(&mut db, query.clone()).unwrap();
            assert!(serde_json::to_vec(&page).unwrap().len() <= 524288);
            let rows = page["rows"].as_array().unwrap();
            assert!(!rows.is_empty() && rows.len() < 4);
            for row in rows {
                assert_eq!(row["memberIndex"], seen);
                let raw = row["originalEnvelopeJson"].as_str().unwrap();
                let envelope: Value = serde_json::from_str(raw).unwrap();
                assert_eq!(
                    envelope["payload"]["highlights"][0]["text"],
                    "\"".repeat(43000)
                );
                seen += 1;
            }
            if page["nextCursor"].is_null() {
                break;
            }
            query["cursor"] = page["nextCursor"].clone();
        }
        assert_eq!(seen, 4);
    }

    #[test]
    fn demoted_source_recovers_old_edits_only_with_current_consumer_selection() {
        fn demote(db: &Connection) {
            let tx = db.unchecked_transaction().unwrap();
            tx.pragma_update(None, "defer_foreign_keys", true).unwrap();
            let db = &*tx;
            use crate::normalized_handoff_certificate::*;
            // Keep this reapplication fixture synthetic, but authenticate its
            // source consent with the same production signers as a real transfer.
            // The lifecycle suite separately proves atomic adoption and enrollment.
            let old = Ed25519KeyPair::from_seed_unchecked(&[19; 32]).unwrap();
            let actor = Ed25519KeyPair::from_seed_unchecked(&[31; 32]).unwrap();
            let target = Ed25519KeyPair::from_seed_unchecked(&[32; 32]).unwrap();
            let actor_public = lower_hex(actor.public_key().as_ref());
            let old_public = lower_hex(old.public_key().as_ref());
            let library = "1".repeat(64);
            let epoch = "2".repeat(64);
            let digest = "8".repeat(64);
            let writer = "6".repeat(64);
            let predecessor = HandoffPredecessorV1 {
                library_id: &library,
                epoch_id: &epoch,
                epoch: 1,
                certificate_digest: &digest,
                authority_public_key: &old_public,
                writer_id: &writer,
            };
            let readiness = sign_handoff_readiness_v1(
                HandoffReadinessBodyV1 {
                    format: "freed_library_handoff_readiness_v1".into(),
                    library_id: library.clone(),
                    predecessor_epoch_id: epoch.clone(),
                    predecessor_certificate_digest: digest.clone(),
                    target_actor_id: "7".repeat(64),
                    target_actor_public_key: actor_public.clone(),
                    target_authority_public_key: lower_hex(target.public_key().as_ref()),
                    native_storage_version: 2,
                    checkpoint_schema_version: 1,
                    replication_protocol_version: 2,
                    created_at_ms: 100,
                },
                &actor,
                &target,
            )
            .unwrap();
            let content = "f".repeat(64);
            let control = HandoffSourceControlV1 {
                schema_version: 1,
                protocol_version: 1,
                library_id: library.clone(),
                storage_epoch: epoch.clone(),
                writer_id: writer.clone(),
                active_transport: "google_drive_app_data_v1".into(),
                generation: 1,
                causal_frontier_digest: "9".repeat(64),
                manifest: HandoffObjectReferenceV1 {
                    descriptor: HandoffObjectDescriptorV1 {
                        object_key: format!(
                            "freed-v2-manifest~{library}~e{epoch}~g1~{content}.json"
                        ),
                        content_digest: content.clone(),
                        byte_length: 1200,
                    },
                    transport_object_id: "manifest".into(),
                },
            };
            let grant = sign_handoff_authorization_for_test_v1(
                HandoffAuthorizationBodyV1 {
                    format: "freed_library_handoff_authorization_v1".into(),
                    readiness,
                    predecessor_authority_public_key: old_public.clone(),
                    successor_epoch: 2,
                    final_source_revision: 0,
                    final_checkpoint_digest: "a".repeat(64),
                    source_control: control.clone(),
                    source_control_revision: "\"fixture\"".into(),
                    source_control_file_id: "control".into(),
                },
                &predecessor,
                &actor_public,
                &old,
            )
            .unwrap();
            let current = crate::normalized_authority::NormalizedAuthorityStateV2 {
                library_id: library.clone(),
                epoch: 1,
                epoch_id: epoch.clone(),
                authority_key_id: crate::normalized_writer_certificate::authority_key_id(
                    &old_public,
                )
                .unwrap(),
                authority_public_key: old_public,
                observed_frontier: Vec::new(),
            };
            let next = crate::normalized_handoff_writer_certificate::prepare_writer_handoff_certificate_v1(
                &current, &writer, &digest, &canonical_handoff_bytes(&grant).unwrap(), &actor_public, &target,
            ).unwrap();
            let mut final_control = control;
            final_control.storage_epoch = next.authority.epoch_id.clone();
            final_control.writer_id = grant.body.readiness.body.target_actor_id.clone();
            final_control.manifest.descriptor.object_key = format!(
                "freed-v2-manifest~{library}~e{}~g1~{content}.json",
                next.authority.epoch_id
            );
            let adoption = json!({"format":"freed_library_source_adoption_v1","stage_id":"fixture-stage",
            "activation": HandoffActivationProposalV1 {
                format: "freed_library_handoff_activation_proposal_v1".into(), handoff_id: grant.body.readiness.handoff_id.clone(),
                control_file_id: "control".into(), expected_control_revision: "\"fixture\"".into(),
                successor_checkpoint_digest: "a".repeat(64), control: final_control,
            }});
            db.execute("UPDATE library_authority_epochs SET epoch_id=?1,authority_key_id=?2,authority_public_key=?3,transition_certificate_digest=?4,canonical_transition_certificate=?5 WHERE epoch_id=?6;",
                params![next.authority.epoch_id,next.authority.authority_key_id,next.authority.authority_public_key,next.transition_certificate_digest,next.canonical_certificate_json,"b".repeat(64)]).unwrap();
            for (table, column) in [
                ("library_meta", "authority_epoch"),
                ("library_active_authority", "epoch_id"),
                ("library_actors", "authority_epoch_id"),
                ("library_follower_actor_request", "authority_epoch_id"),
                ("library_local_recovery_archives", "successor_epoch_id"),
                ("library_local_handoff", "successor_epoch_id"),
            ] {
                db.execute(
                    &format!("UPDATE {table} SET {column}=?1 WHERE {column}=?2;"),
                    params![next.authority.epoch_id, "b".repeat(64)],
                )
                .unwrap();
            }
            db.execute("INSERT INTO library_actors SELECT ?1, authority_epoch_id, 'desktop', ?2, 'fixture:handoff-target', enrollment_certificate_digest, canonical_enrollment_certificate, chain_genesis_digest, 0, NULL, chain_genesis_digest, NULL, 1100, 1100 FROM library_actors WHERE actor_id=?3;",
                params![grant.body.readiness.body.target_actor_id,actor_public,"c".repeat(64)]).unwrap();
            db.execute(
                "UPDATE library_active_authority SET writer_id=?1;",
                [&grant.body.readiness.body.target_actor_id],
            )
            .unwrap();
            db.execute("UPDATE library_local_handoff SET handoff_id=?1,target_writer_id=?2,target_authority_public_key=?3,canonical_readiness=?4,canonical_authorization_body=?5,canonical_authorization=?6,canonical_activation=?7;",
                params![grant.body.readiness.handoff_id,grant.body.readiness.body.target_actor_id,grant.body.readiness.body.target_authority_public_key,
                    canonical_handoff_bytes(&grant.body.readiness).unwrap(),canonical_handoff_bytes(&grant.body).unwrap(),canonical_handoff_bytes(&grant).unwrap(),canonical_handoff_bytes(&adoption).unwrap()]).unwrap();
            db.execute(
                "UPDATE library_local_handoff SET expected_control_revision=?1;",
                [&grant.body.source_control_revision],
            )
            .unwrap();
            db.execute_batch(
                "UPDATE library_local_handoff SET installation_role = 'source', phase = 'demoted', observed_control_revision = 'after';
                DELETE FROM library_writer_admission;
                DELETE FROM library_local_cloud_writer_admission;
                INSERT INTO library_follower_checkpoint_receipt
                SELECT 1, library_id, successor_epoch_id, target_writer_id, 1, 0,
                 printf('%064d', 0), 'checkpoint', 'transport', printf('%064d', 0), 'revision', 1100
                FROM library_local_handoff;
                UPDATE library_local_recovery_archives SET reenrollment_receipt = NULL, reenrollment_digest = NULL, reenrollment_installation_witness = NULL, reenrollment_committed_at = NULL;",
            )
            .unwrap();
            assert!(crate::read_consumer_recovery_summary_v1(db)
                .unwrap()
                .is_none());
            tx.commit().unwrap();
        }
        for fault in [
            "UPDATE library_local_handoff SET canonical_authorization=X'7B7D';",
            "UPDATE library_local_handoff SET canonical_activation=X'7B7D';",
            "UPDATE library_authority_epochs SET canonical_transition_certificate='{}' WHERE epoch_id=(SELECT successor_epoch_id FROM library_local_handoff);",
            "DELETE FROM library_follower_checkpoint_receipt;",
            "INSERT INTO library_writer_admission VALUES (1, 'stale-writer', 'stale-writer', 1, 1200);",
            "UPDATE library_follower_checkpoint_receipt SET writer_actor_id = (SELECT actor_id FROM library_actors WHERE authority_epoch_id = (SELECT predecessor_epoch_id FROM library_local_handoff) LIMIT 1);",
            "UPDATE library_follower_checkpoint_receipt SET authority_epoch_id = (SELECT predecessor_epoch_id FROM library_local_handoff);",
            "UPDATE library_local_handoff SET phase = 'authorized';",
            "UPDATE library_follower_actor_request SET enrollment_certificate_digest = NULL, canonical_enrollment_certificate = NULL, actor_chain_genesis = NULL, enrolled_at = NULL;",
            "UPDATE library_actors SET retired_at = 1200 WHERE actor_id = (SELECT actor_id FROM library_follower_actor_request);",
        ] {
            let (mut db, request, _) = fixture("feed_item_read_assignment", false);
            demote(&db);
            db.execute_batch(fault).unwrap();
            assert!(reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2000).is_err(), "{fault}");
            for table in ["library_intent_transactions", "library_intent_members", "library_local_recovery_reissues"] {
                assert_eq!(db.query_row(&format!("SELECT count(*) FROM {table};"), [], |r| r.get::<_, u64>(0)).unwrap(), 0);
            }
            assert_eq!(db.query_row("SELECT next_counter FROM library_intent_actors;", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        }
        let (mut db, request, key) = fixture("feed_item_read_assignment", false);
        demote(&db);
        let receipt = reapply_archived_assignments_v1(&mut db, &request, &key, 2000).unwrap();
        assert_eq!(receipt.member_count, request.member_count);
        // A final link survives later enrollment loss without signing again.
        db.execute_batch(
            "UPDATE library_follower_actor_request SET enrollment_certificate_digest = NULL, canonical_enrollment_certificate = NULL, actor_chain_genesis = NULL, enrolled_at = NULL;",
        )
        .unwrap();
        assert_eq!(
            reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2001).unwrap(),
            receipt
        );
    }

    #[test]
    fn recovery_reissue_rejects_weakened_durability_without_allocating() {
        for mode in ["OFF", "NORMAL"] {
            let (mut db, request, _) = fixture("feed_item_read_assignment", false);
            db.pragma_update(None, "synchronous", mode).unwrap();
            assert!(
                reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2000)
                    .unwrap_err()
                    .contains("full SQLite durability")
            );
            assert_eq!(
                db.query_row("SELECT next_counter FROM library_intent_actors", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap(),
                1
            );
            assert_eq!(
                db.query_row(
                    "SELECT count(*) FROM library_local_recovery_reissues",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
        }
    }

    #[test]
    fn recovery_reissue_sqlite_full_rolls_back_link_intent_and_counter() {
        let (db, request, keys) = fixture("feed_item_read_assignment", false);
        let root = tempfile::tempdir().unwrap();
        let mut disk = Connection::open(root.path().join("full.sqlite")).unwrap();
        rusqlite::backup::Backup::new(&db, &mut disk)
            .unwrap()
            .run_to_completion(128, std::time::Duration::ZERO, None)
            .unwrap();
        // Small physical pages force signed envelopes to allocate overflow pages.
        disk.execute_batch(
            "PRAGMA page_size=512; VACUUM; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
        )
        .unwrap();
        let pages: u64 = disk
            .pragma_query_value(None, "page_count", |r| r.get(0))
            .unwrap();
        disk.pragma_update(None, "max_page_count", pages).unwrap();
        let error = reapply_archived_assignments_v1(&mut disk, &request, &keys, 2000).unwrap_err();
        assert!(error.contains("database or disk is full"), "{error}");
        assert_eq!(
            disk.query_row("SELECT next_counter FROM library_intent_actors", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            1
        );
        for table in [
            "library_local_recovery_reissues",
            "library_intent_transactions",
            "library_intent_members",
        ] {
            assert_eq!(
                disk.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        disk.pragma_update(None, "max_page_count", pages + 1000)
            .unwrap();
        let receipt = reapply_archived_assignments_v1(&mut disk, &request, &keys, 2001).unwrap();
        assert_eq!(
            reapply_archived_assignments_v1(&mut disk, &request, &NoKeyAccess, 2002).unwrap(),
            receipt
        );
        assert_eq!(
            disk.query_row("SELECT next_counter FROM library_intent_actors", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            3
        );
    }

    // Runs only when invoked by the parent below, against its synthetic fixture.
    #[cfg(unix)]
    #[test]
    fn recovery_reissue_crash_child() {
        let Ok(root) = std::env::var("FREED_REISSUE_CRASH_ROOT") else {
            return;
        };
        let root = std::path::Path::new(&root);
        let request: RecoveryReissueRequestV1 =
            serde_json::from_slice(&std::fs::read(root.join("request.json")).unwrap()).unwrap();
        let keys = KeyStore(std::fs::read(root.join("synthetic-key")).unwrap());
        let mut db =
            crate::open_normalized_sqlite_database_v1(&root.join("consumer.sqlite"), false)
                .unwrap();
        if std::env::var("FREED_REISSUE_CRASH_POINT").unwrap() == "before_commit" {
            db.commit_hook(Some(|| {
                unsafe {
                    libc::raise(libc::SIGKILL);
                }
                unreachable!()
            }));
        }
        let receipt = reapply_archived_assignments_v1(&mut db, &request, &keys, 2000).unwrap();
        std::fs::write(
            root.join("receipt.json"),
            serde_json::to_vec(&receipt).unwrap(),
        )
        .unwrap();
        unsafe {
            libc::raise(libc::SIGKILL);
        }
        unreachable!()
    }

    #[cfg(unix)]
    #[test]
    fn recovery_reissue_survives_sigkill_at_commit_and_response_loss() {
        use std::os::unix::process::ExitStatusExt;
        for point in ["before_commit", "after_commit"] {
            let root = tempfile::tempdir().unwrap();
            let (db, request, keys) = fixture("feed_item_read_assignment", false);
            let writer_admission_count: i64 = db
                .query_row("SELECT count(*) FROM library_writer_admission", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let archive_digest: String = db
                .query_row(
                    "SELECT archive_digest FROM library_local_recovery_archives",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let archive_bytes = |db: &Connection| -> Vec<Vec<u8>> {
                db.prepare("SELECT canonical_row FROM library_local_recovery_rows ORDER BY table_key,row_ordinal").unwrap()
                    .query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
            };
            let archived = archive_bytes(&db);
            let path = root.path().join("consumer.sqlite");
            let mut disk = Connection::open(&path).unwrap();
            rusqlite::backup::Backup::new(&db, &mut disk)
                .unwrap()
                .run_to_completion(128, std::time::Duration::ZERO, None)
                .unwrap();
            drop(disk);
            std::fs::write(
                root.path().join("request.json"),
                serde_json::to_vec(&request).unwrap(),
            )
            .unwrap();
            std::fs::write(root.path().join("synthetic-key"), &keys.0).unwrap();
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "normalized_recovery_reissue::tests::recovery_reissue_crash_child",
                    "--nocapture",
                ])
                .env("FREED_REISSUE_CRASH_ROOT", root.path())
                .env("FREED_REISSUE_CRASH_POINT", point)
                .status()
                .unwrap();
            assert_eq!(status.signal(), Some(libc::SIGKILL));
            let mut disk = crate::open_normalized_sqlite_database_v1(&path, false).unwrap();
            assert_eq!(
                disk.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "ok"
            );
            let committed = point == "after_commit";
            assert_eq!(
                disk.query_row(
                    "SELECT count(*) FROM library_local_recovery_reissues",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                i64::from(committed)
            );
            assert_eq!(
                disk.query_row("SELECT next_counter FROM library_intent_actors", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap(),
                if committed { 3 } else { 1 }
            );
            let receipt = if committed {
                let expected: RecoveryReissueReceiptV1 = serde_json::from_slice(
                    &std::fs::read(root.path().join("receipt.json")).unwrap(),
                )
                .unwrap();
                assert_eq!(
                    reapply_archived_assignments_v1(&mut disk, &request, &NoKeyAccess, 2001)
                        .unwrap(),
                    expected
                );
                expected
            } else {
                reapply_archived_assignments_v1(&mut disk, &request, &keys, 2001).unwrap()
            };
            assert_eq!(
                reapply_archived_assignments_v1(&mut disk, &request, &NoKeyAccess, 2002).unwrap(),
                receipt
            );
            assert_eq!(
                disk.query_row("SELECT next_counter FROM library_intent_actors", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap(),
                3
            );
            assert_eq!(
                disk.query_row(
                    "SELECT count(*) FROM library_intent_transactions",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                1
            );
            assert_eq!(
                disk.query_row("SELECT count(*) FROM library_intent_members", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                2
            );
            assert_eq!(
                disk.query_row("SELECT count(*) FROM library_writer_admission", [], |r| r
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
                writer_admission_count
            );
            assert_eq!(
                disk.query_row(
                    "SELECT archive_digest FROM library_local_recovery_archives",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                archive_digest
            );
            assert_eq!(archive_bytes(&disk), archived);
        }
    }

    #[test]
    fn recovery_reissue_is_atomic_and_retry_never_signs_or_allocates_again() {
        let (mut db, request, keys) = fixture("feed_item_read_assignment", false);
        let archive_rows = |db: &Connection| {
            db.prepare("SELECT canonical_row FROM library_local_recovery_rows ORDER BY table_key, row_ordinal;").unwrap()
            .query_map([], |r| r.get::<_, Vec<u8>>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
        };
        let archived = archive_rows(&db);
        let mut stale = request.clone();
        stale.reviewed_revision += 1;
        assert!(
            reapply_archived_assignments_v1(&mut db, &stale, &NoKeyAccess, 2000)
                .unwrap_err()
                .contains("REVIEW_STALE")
        );
        db.execute_batch("CREATE TEMP TRIGGER fail_recovery_link BEFORE INSERT ON library_local_recovery_reissues BEGIN SELECT RAISE(ABORT, 'link fault'); END;").unwrap();
        assert!(
            reapply_archived_assignments_v1(&mut db, &request, &keys, 2000)
                .unwrap_err()
                .contains("link fault")
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_intent_transactions;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
        db.execute_batch("DROP TRIGGER fail_recovery_link;")
            .unwrap();
        let receipt = reapply_archived_assignments_v1(&mut db, &request, &keys, 2001).unwrap();
        let review_request = json!({"queryId": "recovery_intent_review_v1", "schemaVersion": 1,
            "recoveryId": request.recovery_id, "transactionId": request.transaction_id,
            "limit": 1, "cursor": null, "readerSessionId": "reissue-reader", "cancellationId": "reissue-cancel"});
        let review =
            crate::normalized_query::query_normalized_json_v1(&mut db, review_request.clone())
                .unwrap();
        assert_eq!(review["replacement"], json!(receipt));
        assert_eq!(review["outcome"], json!({"state": "unresolved"}));

        assert_ne!(receipt.replacement_transaction_id, request.transaction_id);
        assert_eq!((receipt.first_counter, receipt.last_counter), (1, 2));
        let overlay_times: Vec<i64> = db
            .prepare("SELECT integer_value FROM library_optimistic_fields ORDER BY member_index;")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(overlay_times, [2001, 2001]);
        // A later revision and actor retirement must not regenerate this edit.
        db.execute_batch("UPDATE library_meta SET source_revision = 1; UPDATE library_change_state SET revision = 1;").unwrap();
        db.execute(
            "UPDATE library_actors SET retired_at = 2002 WHERE actor_id = ?1;",
            [&receipt.replacement_actor_id],
        )
        .unwrap();
        assert_eq!(
            reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2003).unwrap(),
            receipt
        );
        assert_eq!(
            db.query_row("SELECT next_counter FROM library_intent_actors;", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(archive_rows(&db), archived);
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("consumer.sqlite");
        let mut disk = Connection::open(&path).unwrap();
        rusqlite::backup::Backup::new(&db, &mut disk)
            .unwrap()
            .run_to_completion(128, std::time::Duration::ZERO, None)
            .unwrap();
        drop(disk);
        let mut disk = crate::open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert_eq!(
            reapply_archived_assignments_v1(&mut disk, &request, &NoKeyAccess, 2004).unwrap(),
            receipt
        );
        let review =
            crate::normalized_query::query_normalized_json_v1(&mut disk, review_request.clone())
                .unwrap();
        assert_eq!(review["replacement"], json!(receipt));
        disk.execute(
            "UPDATE library_local_recovery_reissues SET original_transaction_digest = ?1;",
            ["0".repeat(64)],
        )
        .unwrap();
        assert!(
            crate::normalized_query::query_normalized_json_v1(&mut disk, review_request)
                .unwrap_err()
                .to_string()
                .contains("conflicts with the archive")
        );
    }

    #[test]
    fn recovery_refuses_accepted_unsupported_stale_missing_and_wrong_key_inputs() {
        let (mut db, request, _) = fixture("feed_item_read_assignment", true);
        assert!(
            reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2000)
                .unwrap_err()
                .contains("already accepted")
        );
        let (mut db, request, _) = fixture("feed_item_remove", false);
        assert!(
            reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2000)
                .unwrap_err()
                .contains("original editor")
        );
        let (mut db, request, _) = fixture("feed_item_saved_assignment", false);
        let mut wrong = request.clone();
        wrong.archive_digest = "0".repeat(64);
        assert!(
            reapply_archived_assignments_v1(&mut db, &wrong, &NoKeyAccess, 2000)
                .unwrap_err()
                .contains("identity changed")
        );
        wrong = request.clone();
        wrong.member_count = 1;
        assert!(
            reapply_archived_assignments_v1(&mut db, &wrong, &NoKeyAccess, 2000)
                .unwrap_err()
                .contains("identity changed")
        );
        db.execute("UPDATE library_local_change_state SET sequence = 1;", [])
            .unwrap();
        assert!(
            reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2000)
                .unwrap_err()
                .contains("REVIEW_STALE")
        );
        db.execute("UPDATE library_local_change_state SET sequence = 0;", [])
            .unwrap();
        let wrong_key = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        assert!(reapply_archived_assignments_v1(
            &mut db,
            &request,
            &KeyStore(wrong_key.as_ref().to_vec()),
            2000
        )
        .unwrap_err()
        .contains("does not match enrollment"));
        db.execute(
            "DELETE FROM library_feed_items WHERE global_id = 'rss:item:2';",
            [],
        )
        .unwrap();
        assert!(
            reapply_archived_assignments_v1(&mut db, &request, &NoKeyAccess, 2000)
                .unwrap_err()
                .contains("no longer present")
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM library_local_recovery_reissues;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            normalized_follower_mutation_context_v1(&db)
                .unwrap()
                .next_counter,
            1
        );
    }

    #[test]
    fn fresh_assignment_bytes_match_the_shared_typescript_signer() {
        let (db, key, actor) = crate::normalized_mutation::tests::fixture();
        let envelopes =
            crate::normalized_operation_test_fixtures::tests::signed_envelopes(&key, &actor);
        let (mut original, _) =
            crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
                &envelopes,
                |identity| crate::normalized_mutation::actor_state_at(&db, identity),
            )
            .unwrap();
        let context = NormalizedMutationContextV1 {
            library_id: "1".repeat(64),
            epoch: 2,
            epoch_id: "2".repeat(64),
            actor_id: "3".repeat(64),
            actor_public_key: lower_hex(key.public_key().as_ref()),
            next_counter: 7,
            previous_operation_id: Some("previous:6".into()),
            previous_chain_digest: "6".repeat(64),
            observed_frontier: vec![crate::NormalizedMutationCausalTipV1 {
                actor_id: "4".repeat(64),
                sequence: 2,
                operation_id: "frontier:2".into(),
                chain_digest: "5".repeat(64),
            }],
        };
        original.members[0].entity_id = "rss:é:😀".into();
        let mut actual = Vec::new();
        for operation in [
            "feed_item_read_assignment",
            "feed_item_saved_assignment",
            "feed_item_archive_assignment",
            "feed_item_like_assignment",
        ] {
            for (index, member) in original.members.iter_mut().enumerate() {
                member.operation_type = operation.into();
                member.assigned = Some(index == 0);
            }
            let envelopes =
                sign_fresh_assignments(&context, &original.members, "recovery:parity", 5000, &key)
                    .unwrap();
            actual.push(
                envelopes
                    .iter()
                    .map(|bytes| lower_hex(&Sha256::digest(bytes)))
                    .collect::<Vec<_>>(),
            );
        }
        let vector: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/recovery-assignment-vectors-v1.json"
        ))
        .unwrap();
        assert_eq!(json!(actual), vector["envelopeSha256"]);
    }
}
