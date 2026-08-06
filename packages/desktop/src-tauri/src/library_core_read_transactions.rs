//! Signed read-assignment transactions, produced by this installation's actor.
//!
//! The journal has verified and committed read assignments for a while, but
//! only from envelopes tests hand-built. `verify_and_commit_read_transaction`
//! had no production caller because nothing could produce a canonical envelope:
//! it needs an enrolled actor's key, that actor's exact chain tip, per-member
//! digests, a transaction digest over all of them, and a signature over each
//! signing body. This produces them.
//!
//! Automerge stays authoritative. A committed read assignment here is shadow
//! state whose disagreement with the document is evidence, not truth. Nothing
//! reads it, no active engine changes, and no provider traffic is emitted.
//!
//! ## Why the envelopes are a pure function of the intent and the tip
//!
//! Every field is derived from the items being marked, the actor, and the
//! actor's current chain tip. Ed25519 is deterministic, so the same intent
//! against the same tip produces byte-identical envelopes and the same
//! transaction id. That is what makes retry safe in both directions:
//!
//! - A retry after a lost response replays the same transaction id, and the
//!   journal returns the stored receipt instead of writing again.
//! - A retry after a crash before the commit rebuilds the same bytes.
//! - A retry against a tip that has since moved produces a different
//!   transaction id and commits as new work, rather than colliding with the
//!   committed one or being silently dropped.

use crate::automerge_external_common::lower_hex;
use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_operation_signature_input,
};
use crate::library_core_journal::ActorState;
use ring::signature::Ed25519KeyPair;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const OPERATION_TYPE: &str = "feed_item_read_assignment";
// The verifier requires exactly this spelling, not the snake_case the
// operation type uses.
const ENTITY_TYPE: &str = "FeedItem";
const SIGNATURE_ALGORITHM: &str = "ed25519";
const SCHEMA_VERSION: i64 = 1;

/// The journal refuses a transaction with more members than this, and refuses
/// an empty one.
const MAX_TRANSACTION_MEMBERS: usize = 1_000;
const MAX_ENTITY_ID_BYTES: usize = 4_096;
const MAX_TRANSACTION_BYTES: usize = 4_194_304;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// One item to mark read, and when it was read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReadAssignmentIntent {
    pub(crate) entity_id: String,
    pub(crate) read_at_ms: i64,
}

fn invalid(what: &str) -> String {
    format!("Library Core read transaction {what} is invalid")
}

fn digest_value(domain: &str, value: &Value) -> Result<String, String> {
    let input = encode_operation_digest_input(domain, value, MAX_TRANSACTION_BYTES)
        .map_err(|_| invalid(domain))?;
    Ok(lower_hex(&Sha256::digest(input)))
}

fn validate_intents(intents: &[ReadAssignmentIntent]) -> Result<(), String> {
    if intents.is_empty() || intents.len() > MAX_TRANSACTION_MEMBERS {
        return Err(invalid("member count"));
    }
    for intent in intents {
        if intent.entity_id.is_empty() || intent.entity_id.len() > MAX_ENTITY_ID_BYTES {
            return Err(invalid("entity ID"));
        }
        if !(0..=MAX_SAFE_INTEGER).contains(&intent.read_at_ms) {
            return Err(invalid("read time"));
        }
    }
    Ok(())
}

/// Names the transaction from everything that makes it this transaction.
///
/// The actor's tip is part of it, so the same items marked read again after
/// the actor has written something else are new work with a new id, while a
/// retry against an unchanged tip replays the committed one.
fn transaction_id(actor: &ActorState, intents: &[ReadAssignmentIntent]) -> Result<String, String> {
    let members: Vec<Value> = intents
        .iter()
        .map(|intent| {
            json!({
                "entity_id": intent.entity_id,
                "read_at_ms": intent.read_at_ms,
            })
        })
        .collect();
    let digest = digest_value(
        "transaction",
        &json!({
            "operation_type": OPERATION_TYPE,
            "library_id": actor.library_id,
            "epoch_id": actor.epoch_id,
            "actor_id": actor.actor_id,
            "actor_sequence": actor.next_sequence,
            "previous_actor_chain_digest": actor.previous_chain_digest,
            "members": members,
        }),
    )?;
    Ok(format!("read:{digest}"))
}

/// The member body, which is every envelope field except the four that depend
/// on the chain and the signature.
///
/// `library_core_journal_operation_verifier` recomputes the member digest by
/// removing exactly those four keys, so this builds what remains and lets the
/// caller add them back.
#[allow(clippy::too_many_arguments)]
fn member_body(
    actor: &ActorState,
    transaction_id: &str,
    operation_id: &str,
    previous_actor_operation_id: Option<&str>,
    index: usize,
    member_count: usize,
    intent: &ReadAssignmentIntent,
    created_at_ms: i64,
) -> Result<Map<String, Value>, String> {
    let payload = json!({ "read_at_ms": intent.read_at_ms });
    let payload_digest = digest_value(
        "operation-payload",
        &json!({
            "schema_version": SCHEMA_VERSION,
            "operation_type": OPERATION_TYPE,
            "payload": payload,
        }),
    )?;
    let actor_sequence = actor
        .next_sequence
        .checked_add(index as i64)
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or_else(|| invalid("actor sequence"))?;

    let body = json!({
        "operation_id": operation_id,
        "library_id": actor.library_id,
        "epoch": actor.epoch,
        "epoch_id": actor.epoch_id,
        "schema_version": SCHEMA_VERSION,
        "actor_id": actor.actor_id,
        "actor_sequence": actor_sequence,
        "previous_actor_operation_id": previous_actor_operation_id,
        // This actor is the only writer of its own chain and observes no other
        // actor yet, so it depends on nothing outside its own sequence. The
        // journal refuses a tip it has not stored, so claiming one here would
        // fail closed rather than fabricate history.
        "causal_frontier": [],
        // Derived from the intent rather than read from a clock, so a rebuilt
        // envelope is byte-identical. The journal does not order operations by
        // this today; when it does, this needs persisted per-actor HLC state.
        "hlc_wall_ms": intent.read_at_ms,
        "hlc_counter": index as i64,
        "transaction_id": transaction_id,
        "transaction_member_index": index as i64,
        "transaction_member_count": member_count as i64,
        "operation_type": OPERATION_TYPE,
        "entity_type": ENTITY_TYPE,
        "entity_id": intent.entity_id,
        "payload": payload,
        "payload_digest": payload_digest,
        "blob_references": [],
        "created_at_ms": created_at_ms,
        "signature_algorithm": SIGNATURE_ALGORITHM,
    });
    body.as_object()
        .cloned()
        .ok_or_else(|| invalid("member body"))
}

/// Build the canonical envelopes for one read-assignment transaction.
///
/// Ordered the way the verifier recomputes: member digests first, then the
/// transaction digest over all of them, then the chain digests in sequence,
/// then the signature over each completed body.
pub(crate) fn build_read_transaction(
    actor: &ActorState,
    intents: &[ReadAssignmentIntent],
    actor_key_pair: &Ed25519KeyPair,
    created_at_ms: i64,
) -> Result<Vec<Vec<u8>>, String> {
    validate_intents(intents)?;
    if !(0..=MAX_SAFE_INTEGER).contains(&created_at_ms) {
        return Err(invalid("creation time"));
    }

    let transaction_id = transaction_id(actor, intents)?;
    let operation_ids: Vec<String> = (0..intents.len())
        .map(|index| format!("{transaction_id}:{index}"))
        .collect();

    let mut bodies = Vec::with_capacity(intents.len());
    let mut member_digests = Vec::with_capacity(intents.len());
    for (index, intent) in intents.iter().enumerate() {
        let previous_actor_operation_id = if index == 0 {
            actor.previous_operation_id.as_deref()
        } else {
            Some(operation_ids[index - 1].as_str())
        };
        let body = member_body(
            actor,
            &transaction_id,
            &operation_ids[index],
            previous_actor_operation_id,
            index,
            intents.len(),
            intent,
            created_at_ms,
        )?;
        member_digests.push(Value::String(digest_value(
            "transaction-member",
            &Value::Object(body.clone()),
        )?));
        bodies.push(body);
    }

    let transaction_digest = digest_value(
        "transaction",
        &json!({
            "transaction_id": transaction_id,
            "transaction_member_count": intents.len() as i64,
            "actor_id": actor.actor_id,
            "initial_previous_actor_operation_id": actor.previous_operation_id,
            "initial_previous_actor_chain_digest": actor.previous_chain_digest,
            "transaction_member_digests": member_digests,
        }),
    )?;

    let mut previous_chain_digest = actor.previous_chain_digest.clone();
    let mut envelopes = Vec::with_capacity(bodies.len());
    for (index, mut body) in bodies.into_iter().enumerate() {
        let member_digest = member_digests[index]
            .as_str()
            .ok_or_else(|| invalid("member digest"))?;
        let actor_chain_digest = digest_value(
            "actor-chain",
            &json!({
                "previous_actor_chain_digest": previous_chain_digest,
                "transaction_member_digest": member_digest,
                "transaction_digest": transaction_digest,
            }),
        )?;

        body.insert(
            "previous_actor_chain_digest".to_string(),
            Value::String(previous_chain_digest.clone()),
        );
        body.insert(
            "actor_chain_digest".to_string(),
            Value::String(actor_chain_digest.clone()),
        );
        body.insert(
            "transaction_digest".to_string(),
            Value::String(transaction_digest.clone()),
        );

        let signing_body = Value::Object(body.clone());
        let signing_body_digest = digest_value("operation-signing-body", &signing_body)?;
        let signature_input = encode_operation_signature_input(
            &json!({ "operation_signing_body_digest": signing_body_digest }),
            MAX_TRANSACTION_BYTES,
        )
        .map_err(|_| invalid("signature input"))?;
        body.insert(
            "signature".to_string(),
            Value::String(lower_hex(actor_key_pair.sign(&signature_input).as_ref())),
        );

        envelopes.push(
            encode_canonical_value(&Value::Object(body), MAX_TRANSACTION_BYTES)
                .map_err(|_| invalid("canonical envelope"))?,
        );
        previous_chain_digest = actor_chain_digest;
    }

    Ok(envelopes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::KeyPair;

    fn actor() -> ActorState {
        ActorState {
            library_id: "a".repeat(64),
            epoch: 1,
            epoch_id: "b".repeat(64),
            actor_id: "c".repeat(64),
            actor_public_key: lower_hex(actor_key_pair().public_key().as_ref()),
            enrollment_operation_id: "actor-enrolled:1".to_string(),
            enrollment_certificate_digest: "d".repeat(64),
            canonical_enrollment_certificate_json: "{}".to_string(),
            actor_chain_genesis: "e".repeat(64),
            next_sequence: 1,
            previous_operation_id: None,
            previous_chain_digest: "e".repeat(64),
        }
    }

    fn actor_key_pair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).unwrap()
    }

    fn intents() -> Vec<ReadAssignmentIntent> {
        vec![
            ReadAssignmentIntent {
                entity_id: "feed-item-a".to_string(),
                read_at_ms: 5_000,
            },
            ReadAssignmentIntent {
                entity_id: "feed-item-b".to_string(),
                read_at_ms: 5_000,
            },
        ]
    }

    /// Nothing in an envelope comes from a live clock or a random source, so
    /// the same inputs rebuild the same bytes. The bridge stores the bytes
    /// rather than relying on this, but a builder that was not deterministic
    /// would make the stored bytes unverifiable against their own inputs.
    #[test]
    fn the_same_inputs_build_byte_identical_envelopes() {
        let first = build_read_transaction(&actor(), &intents(), &actor_key_pair(), 6_000).unwrap();
        let second =
            build_read_transaction(&actor(), &intents(), &actor_key_pair(), 6_000).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.len(), 2);
    }

    /// Envelope identity includes the actor tip. This is exactly why a retry
    /// must replay stored bytes: once a commit advances the tip, rebuilding
    /// produces a different transaction.
    #[test]
    fn a_moved_actor_tip_builds_a_different_transaction() {
        let before =
            build_read_transaction(&actor(), &intents(), &actor_key_pair(), 6_000).unwrap();

        let advanced = ActorState {
            next_sequence: 3,
            previous_operation_id: Some("read:earlier:1".to_string()),
            previous_chain_digest: "f".repeat(64),
            ..actor()
        };
        let after =
            build_read_transaction(&advanced, &intents(), &actor_key_pair(), 6_000).unwrap();

        assert_ne!(before, after);
    }

    /// A different creation time changes signed bytes, which is the other
    /// reason a rebuilt retry cannot be an exact retry.
    #[test]
    fn a_different_creation_time_builds_different_envelopes() {
        let first = build_read_transaction(&actor(), &intents(), &actor_key_pair(), 6_000).unwrap();
        let second =
            build_read_transaction(&actor(), &intents(), &actor_key_pair(), 6_001).unwrap();

        assert_ne!(first, second);
    }

    #[test]
    fn an_empty_or_oversized_transaction_is_refused_before_signing() {
        assert!(build_read_transaction(&actor(), &[], &actor_key_pair(), 6_000).is_err());

        let too_many: Vec<ReadAssignmentIntent> = (0..=MAX_TRANSACTION_MEMBERS)
            .map(|index| ReadAssignmentIntent {
                entity_id: format!("feed-item-{index}"),
                read_at_ms: 5_000,
            })
            .collect();
        assert!(build_read_transaction(&actor(), &too_many, &actor_key_pair(), 6_000).is_err());
    }
}
