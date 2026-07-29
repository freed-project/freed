//! Native verification boundary for canonical Library Core operation envelopes.
//!
//! This module is private to the dormant authoritative journal. It reconstructs
//! every protocol digest and actor-chain link, verifies every Ed25519 signature,
//! and only then creates the sealed journal input type. No renderer value can
//! enter the authoritative log by merely matching a Rust struct's shape.

use super::{
    ActorState, JournalError, JournalResult, VerifiedCausalTip, VerifiedReadAssignment,
    VerifiedReadTransaction, MAX_CAUSAL_TIPS_PER_OPERATION, MAX_ENTITY_ID_BYTES,
    MAX_OPERATION_ID_BYTES, MAX_SAFE_INTEGER, MAX_TRANSACTION_ENVELOPE_BYTES,
    MAX_TRANSACTION_MEMBERS,
};
use crate::library_core_canonical::{
    decode_canonical_value, encode_operation_digest_input, encode_operation_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const ENVELOPE_KEYS: [&str; 26] = [
    "operation_id",
    "library_id",
    "epoch",
    "epoch_id",
    "schema_version",
    "actor_id",
    "actor_sequence",
    "previous_actor_operation_id",
    "causal_frontier",
    "hlc_wall_ms",
    "hlc_counter",
    "transaction_id",
    "transaction_member_index",
    "transaction_member_count",
    "operation_type",
    "entity_type",
    "entity_id",
    "payload",
    "payload_digest",
    "blob_references",
    "created_at_ms",
    "signature_algorithm",
    "previous_actor_chain_digest",
    "actor_chain_digest",
    "transaction_digest",
    "signature",
];
const CAUSAL_TIP_KEYS: [&str; 4] = ["actor_id", "sequence", "operation_id", "chain_digest"];
const PAYLOAD_KEYS: [&str; 1] = ["read_at_ms"];

#[derive(Debug, Clone)]
pub(super) struct OperationIdentity {
    pub(super) library_id: String,
    pub(super) epoch_id: String,
    pub(super) actor_id: String,
}

#[derive(Debug)]
struct ParsedEnvelope {
    value: Value,
    operation_id: String,
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    actor_sequence: i64,
    previous_actor_operation_id: Option<String>,
    causal_tips: Vec<VerifiedCausalTip>,
    transaction_id: String,
    transaction_member_index: i64,
    transaction_member_count: i64,
    entity_id: String,
    read_at_ms: i64,
    previous_actor_chain_digest: String,
    actor_chain_digest: String,
    transaction_digest: String,
    signature: String,
    member_digest: String,
    canonical_json: String,
}

fn invalid(index: usize, field: &'static str) -> JournalError {
    JournalError::OperationVerification { index, field }
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
    index: usize,
    field: &'static str,
) -> JournalResult<&'a Map<String, Value>> {
    let object = value.as_object().ok_or_else(|| invalid(index, field))?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid(index, field));
    }
    Ok(object)
}

fn required_string(
    object: &Map<String, Value>,
    key: &'static str,
    index: usize,
) -> JournalResult<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid(index, key))
}

fn safe_integer(
    object: &Map<String, Value>,
    key: &'static str,
    index: usize,
) -> JournalResult<i64> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
        .ok_or_else(|| invalid(index, key))
}

fn positive_safe_integer(
    object: &Map<String, Value>,
    key: &'static str,
    index: usize,
) -> JournalResult<i64> {
    safe_integer(object, key, index).and_then(|value| {
        if value == 0 {
            Err(invalid(index, key))
        } else {
            Ok(value)
        }
    })
}

fn require_literal(
    object: &Map<String, Value>,
    key: &'static str,
    expected: &str,
    index: usize,
) -> JournalResult<()> {
    if object.get(key).and_then(Value::as_str) != Some(expected) {
        return Err(invalid(index, key));
    }
    Ok(())
}

fn require_integer_literal(
    object: &Map<String, Value>,
    key: &'static str,
    expected: i64,
    index: usize,
) -> JournalResult<()> {
    if object.get(key).and_then(Value::as_i64) != Some(expected) {
        return Err(invalid(index, key));
    }
    Ok(())
}

fn require_hex(value: &str, bytes: usize, index: usize, field: &'static str) -> JournalResult<()> {
    if value.len() != bytes * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid(index, field));
    }
    Ok(())
}

fn require_operation_id(value: &str, index: usize, field: &'static str) -> JournalResult<()> {
    if value.is_empty()
        || value.len() > MAX_OPERATION_ID_BYTES
        || !value.bytes().enumerate().all(|(offset, byte)| {
            byte.is_ascii_alphanumeric()
                || (offset > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
    {
        return Err(invalid(index, field));
    }
    Ok(())
}

fn digest_hex(domain: &str, value: &Value, index: usize) -> JournalResult<String> {
    let input = encode_operation_digest_input(domain, value, MAX_TRANSACTION_ENVELOPE_BYTES)
        .map_err(|_| invalid(index, "digest_input"))?;
    let bytes = Sha256::digest(input);
    let mut encoded = String::with_capacity(64);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(encoded)
}

fn parse_causal_tips(value: &Value, index: usize) -> JournalResult<Vec<VerifiedCausalTip>> {
    let tips = value
        .as_array()
        .ok_or_else(|| invalid(index, "causal_frontier"))?;
    if tips.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
        return Err(invalid(index, "causal_frontier"));
    }
    let mut parsed = Vec::with_capacity(tips.len());
    let mut previous: Option<(String, i64, String, String)> = None;
    for tip in tips {
        let object = exact_object(tip, &CAUSAL_TIP_KEYS, index, "causal_frontier")?;
        let actor_id = required_string(object, "actor_id", index)?;
        let sequence = positive_safe_integer(object, "sequence", index)?;
        let operation_id = required_string(object, "operation_id", index)?;
        let chain_digest = required_string(object, "chain_digest", index)?;
        require_hex(&actor_id, 32, index, "causal_frontier")?;
        require_operation_id(&operation_id, index, "causal_frontier")?;
        require_hex(&chain_digest, 32, index, "causal_frontier")?;
        let key = (
            actor_id.clone(),
            sequence,
            operation_id.clone(),
            chain_digest.clone(),
        );
        if previous.as_ref().is_some_and(|prior| prior >= &key) {
            return Err(invalid(index, "causal_frontier"));
        }
        previous = Some(key);
        parsed.push(VerifiedCausalTip {
            actor_id,
            sequence,
            operation_id,
            chain_digest,
        });
    }
    Ok(parsed)
}

fn parse_envelope(bytes: &[u8], index: usize) -> JournalResult<ParsedEnvelope> {
    let decoded = decode_canonical_value(bytes, MAX_TRANSACTION_ENVELOPE_BYTES)
        .map_err(|_| invalid(index, "canonical_envelope"))?;
    let value = decoded.into_value();
    let object = exact_object(&value, &ENVELOPE_KEYS, index, "field_set")?;

    require_integer_literal(object, "schema_version", 1, index)?;
    require_literal(object, "operation_type", "feed_item_read_assignment", index)?;
    require_literal(object, "entity_type", "FeedItem", index)?;
    require_literal(object, "signature_algorithm", "ed25519", index)?;
    if object
        .get("blob_references")
        .and_then(Value::as_array)
        .is_none_or(|references| !references.is_empty())
    {
        return Err(invalid(index, "blob_references"));
    }

    let operation_id = required_string(object, "operation_id", index)?;
    let library_id = required_string(object, "library_id", index)?;
    let epoch = positive_safe_integer(object, "epoch", index)?;
    let epoch_id = required_string(object, "epoch_id", index)?;
    let actor_id = required_string(object, "actor_id", index)?;
    let actor_sequence = positive_safe_integer(object, "actor_sequence", index)?;
    let previous_actor_operation_id = match object.get("previous_actor_operation_id") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => {
            require_operation_id(value, index, "previous_actor_operation_id")?;
            Some(value.clone())
        }
        _ => return Err(invalid(index, "previous_actor_operation_id")),
    };
    if (actor_sequence == 1) != previous_actor_operation_id.is_none() {
        return Err(invalid(index, "previous_actor_operation_id"));
    }
    let causal_tips = parse_causal_tips(
        object
            .get("causal_frontier")
            .ok_or_else(|| invalid(index, "causal_frontier"))?,
        index,
    )?;
    safe_integer(object, "hlc_wall_ms", index)?;
    safe_integer(object, "hlc_counter", index)?;
    let transaction_id = required_string(object, "transaction_id", index)?;
    let transaction_member_index = safe_integer(object, "transaction_member_index", index)?;
    let transaction_member_count =
        positive_safe_integer(object, "transaction_member_count", index)?;
    if transaction_member_count > MAX_TRANSACTION_MEMBERS as i64
        || transaction_member_index >= transaction_member_count
    {
        return Err(invalid(index, "transaction_member_index"));
    }
    let entity_id = required_string(object, "entity_id", index)?;
    if entity_id.is_empty() || entity_id.len() > MAX_ENTITY_ID_BYTES {
        return Err(invalid(index, "entity_id"));
    }
    let payload = object
        .get("payload")
        .ok_or_else(|| invalid(index, "payload"))?;
    let payload_object = exact_object(payload, &PAYLOAD_KEYS, index, "payload")?;
    let read_at_ms = safe_integer(payload_object, "read_at_ms", index)?;
    let payload_digest = required_string(object, "payload_digest", index)?;
    let expected_payload_digest = digest_hex(
        "operation-payload",
        &json!({
            "schema_version": 1,
            "operation_type": "feed_item_read_assignment",
            "payload": payload,
        }),
        index,
    )?;
    if payload_digest != expected_payload_digest {
        return Err(invalid(index, "payload_digest"));
    }
    safe_integer(object, "created_at_ms", index)?;
    let previous_actor_chain_digest =
        required_string(object, "previous_actor_chain_digest", index)?;
    let actor_chain_digest = required_string(object, "actor_chain_digest", index)?;
    let transaction_digest = required_string(object, "transaction_digest", index)?;
    let signature = required_string(object, "signature", index)?;

    require_operation_id(&operation_id, index, "operation_id")?;
    require_operation_id(&transaction_id, index, "transaction_id")?;
    require_hex(&library_id, 32, index, "library_id")?;
    require_hex(&epoch_id, 32, index, "epoch_id")?;
    require_hex(&actor_id, 32, index, "actor_id")?;
    require_hex(&payload_digest, 32, index, "payload_digest")?;
    require_hex(
        &previous_actor_chain_digest,
        32,
        index,
        "previous_actor_chain_digest",
    )?;
    require_hex(&actor_chain_digest, 32, index, "actor_chain_digest")?;
    require_hex(&transaction_digest, 32, index, "transaction_digest")?;
    require_hex(&signature, 64, index, "signature")?;

    let mut member_body = object.clone();
    for key in [
        "previous_actor_chain_digest",
        "actor_chain_digest",
        "transaction_digest",
        "signature",
    ] {
        member_body.remove(key);
    }
    let member_body = Value::Object(member_body);
    let member_digest = digest_hex("transaction-member", &member_body, index)?;

    Ok(ParsedEnvelope {
        value,
        operation_id,
        library_id,
        epoch,
        epoch_id,
        actor_id,
        actor_sequence,
        previous_actor_operation_id,
        causal_tips,
        transaction_id,
        transaction_member_index,
        transaction_member_count,
        entity_id,
        read_at_ms,
        previous_actor_chain_digest,
        actor_chain_digest,
        transaction_digest,
        signature,
        member_digest,
        canonical_json: std::str::from_utf8(bytes)
            .expect("canonical decoder proved UTF-8")
            .to_owned(),
    })
}

pub(super) fn verify_read_transaction<F>(
    canonical_envelopes: &[Vec<u8>],
    actor_lookup: F,
) -> JournalResult<VerifiedReadTransaction>
where
    F: FnOnce(&OperationIdentity) -> JournalResult<ActorState>,
{
    if canonical_envelopes.is_empty() || canonical_envelopes.len() > MAX_TRANSACTION_MEMBERS {
        return Err(invalid(0, "transaction_members"));
    }
    let total_bytes = canonical_envelopes
        .iter()
        .try_fold(0usize, |total, envelope| total.checked_add(envelope.len()))
        .filter(|total| *total > 0 && *total <= MAX_TRANSACTION_ENVELOPE_BYTES)
        .ok_or_else(|| invalid(0, "canonical_envelope_bytes"))?;

    let mut parsed = Vec::with_capacity(canonical_envelopes.len());
    parsed.push(parse_envelope(&canonical_envelopes[0], 0)?);
    let actor = {
        let first = &parsed[0];
        let actor = actor_lookup(&OperationIdentity {
            library_id: first.library_id.clone(),
            epoch_id: first.epoch_id.clone(),
            actor_id: first.actor_id.clone(),
        })?;
        if actor.library_id != first.library_id
            || actor.epoch != first.epoch
            || actor.epoch_id != first.epoch_id
            || actor.actor_id != first.actor_id
        {
            return Err(invalid(0, "enrolled_actor_identity"));
        }
        actor
    };
    for (index, bytes) in canonical_envelopes.iter().enumerate().skip(1) {
        parsed.push(parse_envelope(bytes, index)?);
    }

    let first = &parsed[0];
    let mut operation_ids = HashSet::with_capacity(parsed.len());
    for (index, member) in parsed.iter().enumerate() {
        let expected_sequence = first
            .actor_sequence
            .checked_add(index as i64)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid(index, "actor_sequence"))?;
        if member.library_id != first.library_id
            || member.epoch != first.epoch
            || member.epoch_id != first.epoch_id
            || member.actor_id != first.actor_id
            || member.transaction_id != first.transaction_id
            || member.transaction_member_count != parsed.len() as i64
            || member.transaction_member_index != index as i64
            || member.actor_sequence != expected_sequence
        {
            return Err(invalid(index, "transaction_identity"));
        }
        if index > 0
            && member.previous_actor_operation_id.as_deref()
                != Some(parsed[index - 1].operation_id.as_str())
        {
            return Err(invalid(index, "previous_actor_operation_id"));
        }
        if !operation_ids.insert(member.operation_id.as_str()) {
            return Err(invalid(index, "operation_id"));
        }
    }

    let member_digests: Vec<Value> = parsed
        .iter()
        .map(|member| Value::String(member.member_digest.clone()))
        .collect();
    let transaction_body = json!({
        "transaction_id": first.transaction_id,
        "transaction_member_count": parsed.len() as i64,
        "actor_id": first.actor_id,
        "initial_previous_actor_operation_id": first.previous_actor_operation_id,
        "initial_previous_actor_chain_digest": first.previous_actor_chain_digest,
        "transaction_member_digests": member_digests,
    });
    let transaction_digest = digest_hex("transaction", &transaction_body, 0)?;

    let mut previous_chain_digest = first.previous_actor_chain_digest.clone();
    let mut verified_members = Vec::with_capacity(parsed.len());
    for (index, member) in parsed.iter().enumerate() {
        if member.previous_actor_chain_digest != previous_chain_digest
            || member.transaction_digest != transaction_digest
        {
            return Err(invalid(index, "transaction_chain"));
        }
        let actor_chain_digest = digest_hex(
            "actor-chain",
            &json!({
                "previous_actor_chain_digest": previous_chain_digest,
                "transaction_member_digest": member.member_digest,
                "transaction_digest": transaction_digest,
            }),
            index,
        )?;
        if member.actor_chain_digest != actor_chain_digest {
            return Err(invalid(index, "actor_chain_digest"));
        }

        let mut signing_body = member
            .value
            .as_object()
            .expect("parser proved object")
            .clone();
        signing_body.remove("signature");
        let signing_body = Value::Object(signing_body);
        let signing_body_digest = digest_hex("operation-signing-body", &signing_body, index)?;
        let signature_input = encode_operation_signature_input(
            &json!({ "operation_signing_body_digest": signing_body_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .map_err(|_| invalid(index, "signature_input"))?;
        if !verify_library_core_ed25519(
            &actor.actor_public_key,
            &member.signature,
            &signature_input,
        )
        .map_err(|_| invalid(index, "signature"))?
        {
            return Err(invalid(index, "signature"));
        }
        let envelope_digest = digest_hex("operation-envelope", &member.value, index)?;
        verified_members.push(VerifiedReadAssignment {
            operation_id: member.operation_id.clone(),
            actor_sequence: member.actor_sequence,
            previous_actor_operation_id: member.previous_actor_operation_id.clone(),
            previous_actor_chain_digest: member.previous_actor_chain_digest.clone(),
            actor_chain_digest: actor_chain_digest.clone(),
            member_digest: member.member_digest.clone(),
            signing_body_digest,
            envelope_digest,
            entity_id: member.entity_id.clone(),
            read_at_ms: member.read_at_ms,
            canonical_envelope_json: member.canonical_json.clone(),
            causal_tips: member.causal_tips.clone(),
        });
        previous_chain_digest = actor_chain_digest;
    }

    Ok(VerifiedReadTransaction {
        transaction_id: first.transaction_id.clone(),
        transaction_digest,
        library_id: first.library_id.clone(),
        epoch: first.epoch,
        epoch_id: first.epoch_id.clone(),
        actor_id: first.actor_id.clone(),
        canonical_envelope_bytes: total_bytes,
        members: verified_members,
    })
}

#[cfg(test)]
mod tests {
    use super::super::{LibraryCoreJournal, VerifiedActorEnrollment};
    use super::*;
    use crate::library_core_canonical::encode_canonical_value;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn hex(bytes: &[u8]) -> String {
        let mut encoded = String::with_capacity(bytes.len() * 2);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in bytes {
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
        encoded
    }

    fn signed_envelopes(
        key_pair: &Ed25519KeyPair,
        enrollment: &VerifiedActorEnrollment,
    ) -> Vec<Vec<u8>> {
        let entities = [("rss:item:1", 900_i64), ("rss:item:2", 901_i64)];
        signed_envelopes_from_tip(
            key_pair,
            enrollment,
            "tx:read:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &entities,
        )
    }

    fn signed_envelopes_from_tip(
        key_pair: &Ed25519KeyPair,
        enrollment: &VerifiedActorEnrollment,
        transaction_id: &str,
        first_sequence: i64,
        previous_operation_id: Option<&str>,
        previous_chain_digest: &str,
        entities: &[(&str, i64)],
    ) -> Vec<Vec<u8>> {
        let mut member_bodies = Vec::new();
        let mut member_digests = Vec::new();
        for (index, (entity_id, read_at_ms)) in entities.iter().enumerate() {
            let payload = json!({ "read_at_ms": read_at_ms });
            let payload_digest = digest_hex(
                "operation-payload",
                &json!({
                    "schema_version": 1,
                    "operation_type": "feed_item_read_assignment",
                    "payload": payload,
                }),
                index,
            )
            .expect("payload digest");
            let body = json!({
                "operation_id": format!("{transaction_id}:member:{index}"),
                "library_id": enrollment.library_id,
                "epoch": enrollment.epoch,
                "epoch_id": enrollment.epoch_id,
                "schema_version": 1,
                "actor_id": enrollment.actor_id,
                "actor_sequence": first_sequence + index as i64,
                "previous_actor_operation_id": if index == 0 {
                    previous_operation_id
                        .map(|value| Value::String(value.to_owned()))
                        .unwrap_or(Value::Null)
                } else {
                    Value::String(format!("{transaction_id}:member:{}", index - 1))
                },
                "causal_frontier": [],
                "hlc_wall_ms": 1_000 + index as i64,
                "hlc_counter": 0,
                "transaction_id": transaction_id,
                "transaction_member_index": index as i64,
                "transaction_member_count": entities.len() as i64,
                "operation_type": "feed_item_read_assignment",
                "entity_type": "FeedItem",
                "entity_id": entity_id,
                "payload": payload,
                "payload_digest": payload_digest,
                "blob_references": [],
                "created_at_ms": 1_000 + index as i64,
                "signature_algorithm": "ed25519",
            });
            member_digests
                .push(digest_hex("transaction-member", &body, index).expect("member digest"));
            member_bodies.push(body);
        }
        let transaction_digest = digest_hex(
            "transaction",
            &json!({
                "transaction_id": transaction_id,
                "transaction_member_count": entities.len() as i64,
                "actor_id": enrollment.actor_id,
                "initial_previous_actor_operation_id": previous_operation_id
                    .map(|value| Value::String(value.to_owned()))
                    .unwrap_or(Value::Null),
                "initial_previous_actor_chain_digest": previous_chain_digest,
                "transaction_member_digests": member_digests,
            }),
            0,
        )
        .expect("transaction digest");

        let mut previous_chain = previous_chain_digest.to_owned();
        member_bodies
            .into_iter()
            .enumerate()
            .map(|(index, body)| {
                let actor_chain_digest = digest_hex(
                    "actor-chain",
                    &json!({
                        "previous_actor_chain_digest": previous_chain,
                        "transaction_member_digest": member_digests[index],
                        "transaction_digest": transaction_digest,
                    }),
                    index,
                )
                .expect("actor chain digest");
                let mut signing_body = body.as_object().expect("body object").clone();
                signing_body.insert(
                    "previous_actor_chain_digest".to_owned(),
                    Value::String(previous_chain.clone()),
                );
                signing_body.insert(
                    "actor_chain_digest".to_owned(),
                    Value::String(actor_chain_digest.clone()),
                );
                signing_body.insert(
                    "transaction_digest".to_owned(),
                    Value::String(transaction_digest.clone()),
                );
                let signing_body = Value::Object(signing_body);
                let signing_body_digest =
                    digest_hex("operation-signing-body", &signing_body, index)
                        .expect("signing body digest");
                let message = encode_operation_signature_input(
                    &json!({ "operation_signing_body_digest": signing_body_digest }),
                    MAX_TRANSACTION_ENVELOPE_BYTES,
                )
                .expect("signature input");
                let signature = hex(key_pair.sign(&message).as_ref());
                let mut envelope = signing_body.as_object().expect("signing body").clone();
                envelope.insert("signature".to_owned(), Value::String(signature));
                previous_chain = actor_chain_digest;
                encode_canonical_value(&Value::Object(envelope), MAX_TRANSACTION_ENVELOPE_BYTES)
                    .expect("canonical envelope")
            })
            .collect()
    }

    fn enrollment(key_pair: &Ed25519KeyPair) -> VerifiedActorEnrollment {
        VerifiedActorEnrollment {
            library_id: "1".repeat(64),
            epoch: 1,
            epoch_id: "2".repeat(64),
            actor_id: "3".repeat(64),
            actor_public_key: hex(key_pair.public_key().as_ref()),
            enrollment_operation_id: "op:actor:enroll:native-verifier".to_owned(),
            enrollment_certificate_digest: "4".repeat(64),
            canonical_enrollment_certificate_json: "{\"certificate\":\"fixture\"}".to_owned(),
            actor_chain_genesis: "5".repeat(64),
            enrolled_at_ms: 1_000,
        }
    }

    #[test]
    fn verifies_signatures_and_only_then_commits_the_sealed_transaction() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[7_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal.enroll_actor(&enrollment).expect("enroll actor");

        let receipt = journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("verify and commit");
        let retry = journal
            .verify_and_commit_read_transaction(&envelopes, 9_999)
            .expect("verify exact response-loss retry after actor tip advance");
        assert_eq!(retry, receipt);
        assert_eq!(receipt.member_count, 2);
        assert_eq!(
            journal
                .read_state("rss:item:1")
                .expect("read state")
                .expect("materialized read")
                .read_at_ms,
            900
        );

        let rows: (i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (1, 2, 2));
    }

    #[test]
    fn verified_stale_fork_fails_at_the_atomic_actor_tip_check() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[10_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let first = signed_envelopes(&key_pair, &enrollment);
        let stale_fork = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:read:stale-native-fork",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:stale-fork", 902)],
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .verify_and_commit_read_transaction(&first, 1_500)
            .expect("commit first transaction");

        assert!(matches!(
            journal.verify_and_commit_read_transaction(&stale_fork, 1_600),
            Err(JournalError::StaleActorTip { actor_id })
                if actor_id == enrollment.actor_id
        ));
        let transaction_rows: i64 = journal
            .connection
            .query_row(
                "SELECT COUNT(*) FROM library_core_transactions;",
                [],
                |row| row.get(0),
            )
            .expect("transaction row count");
        assert_eq!(transaction_rows, 1);
    }

    #[test]
    fn rejects_tampering_before_any_authoritative_row_is_written() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[8_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let mut envelopes = signed_envelopes(&key_pair, &enrollment);
        let mut value = decode_canonical_value(&envelopes[1], MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("decode fixture")
            .value()
            .clone();
        let signature = value
            .get("signature")
            .and_then(Value::as_str)
            .expect("signature");
        let replacement = if signature.ends_with('0') { '1' } else { '0' };
        value["signature"] = Value::String(format!(
            "{}{replacement}",
            &signature[..signature.len() - 1]
        ));
        envelopes[1] =
            encode_canonical_value(&value, MAX_TRANSACTION_ENVELOPE_BYTES).expect("encode tamper");

        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        assert!(matches!(
            journal.verify_and_commit_read_transaction(&envelopes, 1_500),
            Err(JournalError::OperationVerification {
                index: 1,
                field: "signature"
            })
        ));
        let rows: i64 = journal
            .connection
            .query_row("SELECT COUNT(*) FROM library_core_operations;", [], |row| {
                row.get(0)
            })
            .expect("row count");
        assert_eq!(rows, 0);
    }

    #[test]
    fn rejects_noncanonical_duplicate_fields_and_incomplete_transactions() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[9_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal.enroll_actor(&enrollment).expect("enroll actor");

        assert!(matches!(
            journal.verify_read_transaction(&envelopes[..1]),
            Err(JournalError::OperationVerification {
                index: 0,
                field: "transaction_identity"
            })
        ));
        assert!(matches!(
            journal.verify_read_transaction(&[
                br#"{"operation_id":"first","operation_id":"second"}"#.to_vec()
            ]),
            Err(JournalError::OperationVerification {
                index: 0,
                field: "canonical_envelope"
            })
        ));
    }
}
