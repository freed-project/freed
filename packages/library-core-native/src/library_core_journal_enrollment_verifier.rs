//! Native actor-enrollment verification for the dormant authoritative journal.
//!
//! Accepted authority state remains private and must eventually come from the
//! signed storage-epoch transition. This module proves that a canonical
//! certificate binds one actor key to that exact authority state before the
//! sealed enrollment input can enter SQLite.

#[cfg(test)]
use super::VerifiedAuthorityEpoch;
use super::{
    is_lower_hex, is_operation_id, AcceptedAuthorityState, JournalError, JournalResult,
    VerifiedActorEnrollment, VerifiedCausalTip, MAX_CAUSAL_TIPS_PER_OPERATION, MAX_SAFE_INTEGER,
    MAX_TRANSACTION_ENVELOPE_BYTES,
};
use crate::library_core_canonical::{
    decode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const CERTIFICATE_KEYS: [&str; 3] = [
    "certificate_body",
    "certificate_digest",
    "authority_signature",
];
const CERTIFICATE_BODY_V1_KEYS: [&str; 3] = [
    "actor_enrollment_body",
    "enrollment_body_digest",
    "actor_proof",
];
const CERTIFICATE_BODY_V2_KEYS: [&str; 5] = [
    "actor_enrollment_body",
    "enrollment_body_digest",
    "actor_proof",
    "actor_capability_body",
    "actor_capability_body_digest",
];
const CAPABILITY_BODY_V2_KEYS: [&str; 14] = [
    "format",
    "library_id",
    "epoch",
    "epoch_id",
    "authority_key_id",
    "actor_id",
    "actor_public_key",
    "actor_class",
    "allowed_operation_types",
    "scope",
    "issuance_identity",
    "retirement_identity",
    "issued_at_ms",
    "signature_algorithm",
];
const LIBRARY_WIDE_SCOPE_KEYS: [&str; 1] = ["mode"];
const BOUNDED_SCOPE_KEYS: [&str; 3] = ["mode", "scope_kind", "scope_id"];
const ENROLLMENT_BODY_KEYS: [&str; 15] = [
    "operation_id",
    "operation_type",
    "library_id",
    "epoch",
    "epoch_id",
    "schema_version",
    "authority_key_id",
    "installation_incarnation",
    "actor_incarnation_nonce",
    "actor_id",
    "actor_public_key",
    "actor_public_key_fingerprint",
    "observed_frontier",
    "created_at_ms",
    "signature_algorithm",
];
const CAUSAL_TIP_KEYS: [&str; 4] = ["actor_id", "sequence", "operation_id", "chain_digest"];

fn invalid(field: &'static str) -> JournalError {
    JournalError::EnrollmentVerification { field }
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
    field: &'static str,
) -> JournalResult<&'a Map<String, Value>> {
    let object = value.as_object().ok_or_else(|| invalid(field))?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid(field));
    }
    Ok(object)
}

fn required_string(object: &Map<String, Value>, key: &'static str) -> JournalResult<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid(key))
}

fn safe_integer(object: &Map<String, Value>, key: &'static str) -> JournalResult<i64> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
        .ok_or_else(|| invalid(key))
}

fn positive_safe_integer(object: &Map<String, Value>, key: &'static str) -> JournalResult<i64> {
    safe_integer(object, key).and_then(|value| {
        if value == 0 {
            Err(invalid(key))
        } else {
            Ok(value)
        }
    })
}

fn require_literal(
    object: &Map<String, Value>,
    key: &'static str,
    expected: &str,
) -> JournalResult<()> {
    if object.get(key).and_then(Value::as_str) != Some(expected) {
        return Err(invalid(key));
    }
    Ok(())
}

fn require_integer_literal(
    object: &Map<String, Value>,
    key: &'static str,
    expected: i64,
) -> JournalResult<()> {
    if object.get(key).and_then(Value::as_i64) != Some(expected) {
        return Err(invalid(key));
    }
    Ok(())
}

fn require_hex(value: &str, bytes: usize, field: &'static str) -> JournalResult<()> {
    if !is_lower_hex(value, bytes) {
        return Err(invalid(field));
    }
    Ok(())
}

fn digest_hex(domain: &str, value: &Value) -> JournalResult<String> {
    let input = encode_operation_digest_input(domain, value, MAX_TRANSACTION_ENVELOPE_BYTES)
        .map_err(|_| invalid("digest_input"))?;
    let bytes = Sha256::digest(input);
    let mut encoded = String::with_capacity(64);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(encoded)
}

fn parse_causal_tips(value: &Value) -> JournalResult<Vec<VerifiedCausalTip>> {
    let tips = value
        .as_array()
        .ok_or_else(|| invalid("observed_frontier"))?;
    if tips.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
        return Err(invalid("observed_frontier"));
    }
    let mut parsed = Vec::with_capacity(tips.len());
    let mut previous: Option<(String, i64, String, String)> = None;
    for tip in tips {
        let object = exact_object(tip, &CAUSAL_TIP_KEYS, "observed_frontier")?;
        let actor_id = required_string(object, "actor_id")?;
        let sequence = positive_safe_integer(object, "sequence")?;
        let operation_id = required_string(object, "operation_id")?;
        let chain_digest = required_string(object, "chain_digest")?;
        require_hex(&actor_id, 32, "observed_frontier")?;
        if !is_operation_id(&operation_id) {
            return Err(invalid("observed_frontier"));
        }
        require_hex(&chain_digest, 32, "observed_frontier")?;
        let key = (
            actor_id.clone(),
            sequence,
            operation_id.clone(),
            chain_digest.clone(),
        );
        if previous
            .as_ref()
            .is_some_and(|prior| prior.0 == actor_id || prior >= &key)
        {
            return Err(invalid("observed_frontier"));
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

fn validate_authority(authority: &AcceptedAuthorityState) -> JournalResult<()> {
    require_hex(&authority.library_id, 32, "authority.library_id")?;
    if !(1..=MAX_SAFE_INTEGER).contains(&authority.epoch) {
        return Err(invalid("authority.epoch"));
    }
    require_hex(&authority.epoch_id, 32, "authority.epoch_id")?;
    require_hex(
        &authority.authority_key_id,
        32,
        "authority.authority_key_id",
    )?;
    require_hex(
        &authority.authority_public_key,
        32,
        "authority.authority_public_key",
    )?;
    let expected_key_id = digest_hex(
        "authority-key",
        &json!({
            "signature_algorithm": "ed25519",
            "authority_public_key": authority.authority_public_key,
        }),
    )?;
    if authority.authority_key_id != expected_key_id
        || authority.observed_frontier.len() > MAX_CAUSAL_TIPS_PER_OPERATION
    {
        return Err(invalid("authority"));
    }
    for (index, tip) in authority.observed_frontier.iter().enumerate() {
        if !is_lower_hex(&tip.actor_id, 32)
            || !(1..=MAX_SAFE_INTEGER).contains(&tip.sequence)
            || !is_operation_id(&tip.operation_id)
            || !is_lower_hex(&tip.chain_digest, 32)
            || index > 0
                && (authority.observed_frontier[index - 1].actor_id == tip.actor_id
                    || (
                        authority.observed_frontier[index - 1].actor_id.as_str(),
                        authority.observed_frontier[index - 1].sequence,
                        authority.observed_frontier[index - 1].operation_id.as_str(),
                        authority.observed_frontier[index - 1].chain_digest.as_str(),
                    ) >= (
                        tip.actor_id.as_str(),
                        tip.sequence,
                        tip.operation_id.as_str(),
                        tip.chain_digest.as_str(),
                    ))
        {
            return Err(invalid("authority.observed_frontier"));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn verify_capability_body_v2(
    certificate_body: &Map<String, Value>,
    enrollment_body_digest: &str,
    library_id: &str,
    epoch: i64,
    epoch_id: &str,
    authority_key_id: &str,
    actor_id: &str,
    actor_public_key: &str,
    created_at_ms: i64,
) -> JournalResult<super::actor_capability::ActorCapabilityState> {
    let capability_value = certificate_body
        .get("actor_capability_body")
        .ok_or_else(|| invalid("actor_capability_body"))?;
    let capability = exact_object(
        capability_value,
        &CAPABILITY_BODY_V2_KEYS,
        "actor_capability_body",
    )?;
    require_literal(
        capability,
        "format",
        "freed_library_core_actor_capability_v2",
    )?;
    require_literal(capability, "signature_algorithm", "ed25519")?;
    if required_string(capability, "library_id")? != library_id
        || positive_safe_integer(capability, "epoch")? != epoch
        || required_string(capability, "epoch_id")? != epoch_id
        || required_string(capability, "authority_key_id")? != authority_key_id
        || required_string(capability, "actor_id")? != actor_id
        || required_string(capability, "actor_public_key")? != actor_public_key
        || safe_integer(capability, "issued_at_ms")? != created_at_ms
    {
        return Err(invalid("actor_capability_binding"));
    }
    let actor_class = required_string(capability, "actor_class")?;
    if !matches!(actor_class.as_str(), "editor" | "scraper" | "agent") {
        return Err(invalid("actor_class"));
    }
    let operations = capability
        .get("allowed_operation_types")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("allowed_operation_types"))?
        .iter()
        .map(|operation| {
            operation
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid("allowed_operation_types"))
        })
        .collect::<JournalResult<Vec<_>>>()?;
    super::actor_capability::validate_allowed_operation_types(&actor_class, &operations)
        .map_err(invalid)?;

    let scope_value = capability.get("scope").ok_or_else(|| invalid("scope"))?;
    let scope_object = scope_value.as_object().ok_or_else(|| invalid("scope"))?;
    let scope = match scope_object.get("mode").and_then(Value::as_str) {
        Some("library_wide") => {
            exact_object(scope_value, &LIBRARY_WIDE_SCOPE_KEYS, "scope")?;
            super::actor_capability::ActorCapabilityScope::LibraryWide
        }
        Some("bounded") => {
            let scope = exact_object(scope_value, &BOUNDED_SCOPE_KEYS, "scope")?;
            let kind = required_string(scope, "scope_kind")?;
            if !matches!(kind.as_str(), "provider" | "source") {
                return Err(invalid("scope_kind"));
            }
            let scope_id = required_string(scope, "scope_id")?;
            if scope_id.is_empty() || scope_id.len() > 4_096 {
                return Err(invalid("scope_id"));
            }
            super::actor_capability::ActorCapabilityScope::Bounded { kind, scope_id }
        }
        _ => return Err(invalid("scope")),
    };

    let issuance_identity = required_string(capability, "issuance_identity")?;
    let retirement_identity = required_string(capability, "retirement_identity")?;
    require_hex(&issuance_identity, 32, "issuance_identity")?;
    require_hex(&retirement_identity, 32, "retirement_identity")?;
    let expected_issuance = digest_hex(
        "actor-capability-issuance",
        &json!({
            "library_id": library_id,
            "epoch_id": epoch_id,
            "authority_key_id": authority_key_id,
            "actor_id": actor_id,
            "enrollment_body_digest": enrollment_body_digest,
        }),
    )?;
    let expected_retirement = digest_hex(
        "actor-capability-retirement",
        &json!({
            "library_id": library_id,
            "epoch_id": epoch_id,
            "actor_id": actor_id,
            "issuance_identity": expected_issuance,
        }),
    )?;
    if issuance_identity != expected_issuance || retirement_identity != expected_retirement {
        return Err(invalid("actor_capability_identity"));
    }
    let capability_body_digest = required_string(certificate_body, "actor_capability_body_digest")?;
    require_hex(&capability_body_digest, 32, "actor_capability_body_digest")?;
    if capability_body_digest != digest_hex("actor-capability-body", capability_value)? {
        return Err(invalid("actor_capability_body_digest"));
    }
    Ok(super::actor_capability::ActorCapabilityState {
        certificate_version: 2,
        actor_class,
        allowed_operation_types: operations,
        scope,
        issuance_identity: Some(issuance_identity),
        retirement_identity: Some(retirement_identity),
        capability_certificate_digest: String::new(),
        issued_at_ms: created_at_ms,
        retired: false,
        retirement_certificate_digest: None,
    })
}

pub(super) fn verify_actor_enrollment(
    canonical_certificate: &[u8],
    authority: &AcceptedAuthorityState,
) -> JournalResult<VerifiedActorEnrollment> {
    validate_authority(authority)?;
    let decoded = decode_canonical_value(canonical_certificate, MAX_TRANSACTION_ENVELOPE_BYTES)
        .map_err(|_| invalid("canonical_certificate"))?;
    let certificate = decoded.into_value();
    let certificate_object = exact_object(&certificate, &CERTIFICATE_KEYS, "certificate")?;
    let certificate_body = certificate_object
        .get("certificate_body")
        .ok_or_else(|| invalid("certificate_body"))?;
    let raw_certificate_body = certificate_body
        .as_object()
        .ok_or_else(|| invalid("certificate_body"))?;
    let certificate_version = if raw_certificate_body.len() == CERTIFICATE_BODY_V1_KEYS.len()
        && CERTIFICATE_BODY_V1_KEYS
            .iter()
            .all(|key| raw_certificate_body.contains_key(*key))
    {
        1
    } else if raw_certificate_body.len() == CERTIFICATE_BODY_V2_KEYS.len()
        && CERTIFICATE_BODY_V2_KEYS
            .iter()
            .all(|key| raw_certificate_body.contains_key(*key))
    {
        2
    } else {
        return Err(invalid("certificate_body"));
    };
    let certificate_body_object = raw_certificate_body;
    let actor_body = certificate_body_object
        .get("actor_enrollment_body")
        .ok_or_else(|| invalid("actor_enrollment_body"))?;
    let body = exact_object(actor_body, &ENROLLMENT_BODY_KEYS, "actor_enrollment_body")?;

    require_literal(body, "operation_type", "actor_enrolled")?;
    require_integer_literal(body, "schema_version", 1)?;
    require_literal(body, "signature_algorithm", "ed25519")?;
    let operation_id = required_string(body, "operation_id")?;
    if !is_operation_id(&operation_id) {
        return Err(invalid("operation_id"));
    }
    let library_id = required_string(body, "library_id")?;
    let epoch = positive_safe_integer(body, "epoch")?;
    let epoch_id = required_string(body, "epoch_id")?;
    let authority_key_id = required_string(body, "authority_key_id")?;
    let installation_incarnation = required_string(body, "installation_incarnation")?;
    let actor_incarnation_nonce = required_string(body, "actor_incarnation_nonce")?;
    let actor_id = required_string(body, "actor_id")?;
    let actor_public_key = required_string(body, "actor_public_key")?;
    let actor_public_key_fingerprint = required_string(body, "actor_public_key_fingerprint")?;
    let observed_frontier = parse_causal_tips(
        body.get("observed_frontier")
            .ok_or_else(|| invalid("observed_frontier"))?,
    )?;
    let created_at_ms = safe_integer(body, "created_at_ms")?;

    for (field, value) in [
        ("library_id", library_id.as_str()),
        ("epoch_id", epoch_id.as_str()),
        ("authority_key_id", authority_key_id.as_str()),
        (
            "installation_incarnation",
            installation_incarnation.as_str(),
        ),
        ("actor_incarnation_nonce", actor_incarnation_nonce.as_str()),
        ("actor_id", actor_id.as_str()),
        ("actor_public_key", actor_public_key.as_str()),
        (
            "actor_public_key_fingerprint",
            actor_public_key_fingerprint.as_str(),
        ),
    ] {
        require_hex(value, 32, field)?;
    }

    let expected_fingerprint = digest_hex(
        "actor-public-key",
        &json!({
            "signature_algorithm": "ed25519",
            "actor_public_key": actor_public_key,
        }),
    )?;
    let expected_actor_id = digest_hex(
        "actor-id",
        &json!({
            "library_id": library_id,
            "installation_incarnation": installation_incarnation,
            "signature_algorithm": "ed25519",
            "actor_public_key": actor_public_key,
            "actor_incarnation_nonce": actor_incarnation_nonce,
        }),
    )?;
    if actor_public_key_fingerprint != expected_fingerprint || actor_id != expected_actor_id {
        return Err(invalid("actor_identity"));
    }
    if library_id != authority.library_id
        || epoch != authority.epoch
        || epoch_id != authority.epoch_id
        || authority_key_id != authority.authority_key_id
        || observed_frontier != authority.observed_frontier
    {
        return Err(invalid("authority_binding"));
    }

    let enrollment_body_digest =
        required_string(certificate_body_object, "enrollment_body_digest")?;
    require_hex(&enrollment_body_digest, 32, "enrollment_body_digest")?;
    let expected_body_digest = digest_hex("actor-enrollment-body", actor_body)?;
    if enrollment_body_digest != expected_body_digest {
        return Err(invalid("enrollment_body_digest"));
    }
    let actor_proof = required_string(certificate_body_object, "actor_proof")?;
    require_hex(&actor_proof, 64, "actor_proof")?;
    let actor_proof_input = encode_signature_input(
        "actor-enrollment-proof",
        &json!({ "enrollment_body_digest": enrollment_body_digest }),
        MAX_TRANSACTION_ENVELOPE_BYTES,
    )
    .map_err(|_| invalid("actor_proof_input"))?;
    if !verify_library_core_ed25519(&actor_public_key, &actor_proof, &actor_proof_input)
        .map_err(|_| invalid("actor_proof"))?
    {
        return Err(invalid("actor_proof"));
    }

    let mut capability = if certificate_version == 1 {
        None
    } else {
        Some(verify_capability_body_v2(
            certificate_body_object,
            &enrollment_body_digest,
            &library_id,
            epoch,
            &epoch_id,
            &authority_key_id,
            &actor_id,
            &actor_public_key,
            created_at_ms,
        )?)
    };

    let certificate_digest = required_string(certificate_object, "certificate_digest")?;
    require_hex(&certificate_digest, 32, "certificate_digest")?;
    let certificate_digest_domain = if certificate_version == 1 {
        "actor-enrollment-certificate"
    } else {
        "actor-capability-certificate"
    };
    let expected_certificate_digest = digest_hex(certificate_digest_domain, certificate_body)?;
    if certificate_digest != expected_certificate_digest {
        return Err(invalid("certificate_digest"));
    }
    let authority_signature = required_string(certificate_object, "authority_signature")?;
    require_hex(&authority_signature, 64, "authority_signature")?;
    let authority_signature_domain = if certificate_version == 1 {
        "actor-enrollment-authority"
    } else {
        "actor-capability-authority"
    };
    let authority_signature_input = encode_signature_input(
        authority_signature_domain,
        &json!({ "certificate_digest": certificate_digest }),
        MAX_TRANSACTION_ENVELOPE_BYTES,
    )
    .map_err(|_| invalid("authority_signature_input"))?;
    if !verify_library_core_ed25519(
        &authority.authority_public_key,
        &authority_signature,
        &authority_signature_input,
    )
    .map_err(|_| invalid("authority_signature"))?
    {
        return Err(invalid("authority_signature"));
    }

    let actor_chain_genesis = digest_hex(
        "actor-chain-genesis",
        &json!({
            "enrollment_certificate_digest": certificate_digest,
            "actor_id": actor_id,
            "epoch_id": epoch_id,
        }),
    )?;
    let capability = capability.take().unwrap_or_else(|| {
        super::actor_capability::ActorCapabilityState::legacy_editor(
            certificate_digest.clone(),
            created_at_ms,
        )
    });
    let capability = if certificate_version == 2 {
        super::actor_capability::ActorCapabilityState {
            capability_certificate_digest: certificate_digest.clone(),
            ..capability
        }
    } else {
        capability
    };
    Ok(VerifiedActorEnrollment {
        library_id,
        epoch,
        epoch_id,
        actor_id,
        actor_public_key,
        enrollment_operation_id: operation_id,
        enrollment_certificate_digest: certificate_digest,
        canonical_enrollment_certificate_json: std::str::from_utf8(canonical_certificate)
            .expect("canonical decoder proved UTF-8")
            .to_owned(),
        actor_chain_genesis,
        enrolled_at_ms: created_at_ms,
        capability,
    })
}

#[cfg(test)]
mod tests {
    use super::super::LibraryCoreJournal;
    use super::*;
    use crate::library_core_canonical::encode_canonical_value;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn capability_vectors() -> Value {
        serde_json::from_str(include_str!(
            "../../shared/src/library-core/actor-capability-certificate-v2-vectors.json"
        ))
        .expect("cross-runtime actor capability vectors must parse")
    }

    fn vector_authority(vector: &Value) -> AcceptedAuthorityState {
        let authority = vector["authority_state"]
            .as_object()
            .expect("vector authority state");
        AcceptedAuthorityState {
            library_id: required_string(authority, "library_id").expect("library ID"),
            epoch: positive_safe_integer(authority, "epoch").expect("epoch"),
            epoch_id: required_string(authority, "epoch_id").expect("epoch ID"),
            authority_key_id: required_string(authority, "authority_key_id")
                .expect("authority key ID"),
            authority_public_key: required_string(authority, "authority_public_key")
                .expect("authority public key"),
            observed_frontier: Vec::new(),
        }
    }

    fn hex(bytes: &[u8]) -> String {
        let mut encoded = String::with_capacity(bytes.len() * 2);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in bytes {
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
        encoded
    }

    fn authority(key_pair: &Ed25519KeyPair) -> AcceptedAuthorityState {
        let public_key = hex(key_pair.public_key().as_ref());
        AcceptedAuthorityState {
            library_id: "1".repeat(64),
            epoch: 1,
            epoch_id: "2".repeat(64),
            authority_key_id: digest_hex(
                "authority-key",
                &json!({
                    "signature_algorithm": "ed25519",
                    "authority_public_key": public_key,
                }),
            )
            .expect("authority key ID"),
            authority_public_key: public_key,
            observed_frontier: Vec::new(),
        }
    }

    fn certificate(
        actor_key: &Ed25519KeyPair,
        authority_key: &Ed25519KeyPair,
        authority: &AcceptedAuthorityState,
    ) -> Vec<u8> {
        let actor_public_key = hex(actor_key.public_key().as_ref());
        let installation_incarnation = "3".repeat(64);
        let actor_incarnation_nonce = "4".repeat(64);
        let actor_public_key_fingerprint = digest_hex(
            "actor-public-key",
            &json!({
                "signature_algorithm": "ed25519",
                "actor_public_key": actor_public_key,
            }),
        )
        .expect("actor fingerprint");
        let actor_id = digest_hex(
            "actor-id",
            &json!({
                "library_id": authority.library_id,
                "installation_incarnation": installation_incarnation,
                "signature_algorithm": "ed25519",
                "actor_public_key": actor_public_key,
                "actor_incarnation_nonce": actor_incarnation_nonce,
            }),
        )
        .expect("actor ID");
        let actor_body = json!({
            "operation_id": "op:actor:enroll:native-verified",
            "operation_type": "actor_enrolled",
            "library_id": authority.library_id,
            "epoch": authority.epoch,
            "epoch_id": authority.epoch_id,
            "schema_version": 1,
            "authority_key_id": authority.authority_key_id,
            "installation_incarnation": installation_incarnation,
            "actor_incarnation_nonce": actor_incarnation_nonce,
            "actor_id": actor_id,
            "actor_public_key": actor_public_key,
            "actor_public_key_fingerprint": actor_public_key_fingerprint,
            "observed_frontier": [],
            "created_at_ms": 1_000,
            "signature_algorithm": "ed25519",
        });
        let enrollment_body_digest =
            digest_hex("actor-enrollment-body", &actor_body).expect("body digest");
        let actor_message = encode_signature_input(
            "actor-enrollment-proof",
            &json!({ "enrollment_body_digest": enrollment_body_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("actor proof input");
        let certificate_body = json!({
            "actor_enrollment_body": actor_body,
            "enrollment_body_digest": enrollment_body_digest,
            "actor_proof": hex(actor_key.sign(&actor_message).as_ref()),
        });
        let certificate_digest = digest_hex("actor-enrollment-certificate", &certificate_body)
            .expect("certificate digest");
        let authority_message = encode_signature_input(
            "actor-enrollment-authority",
            &json!({ "certificate_digest": certificate_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("authority signature input");
        encode_canonical_value(
            &json!({
                "certificate_body": certificate_body,
                "certificate_digest": certificate_digest,
                "authority_signature": hex(authority_key.sign(&authority_message).as_ref()),
            }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("canonical certificate")
    }

    fn install_authority(journal: &mut LibraryCoreJournal, authority: &AcceptedAuthorityState) {
        journal
            .install_authority_epoch(&VerifiedAuthorityEpoch {
                authority: authority.clone(),
                transition_certificate_digest: "8".repeat(64),
                canonical_transition_certificate_json:
                    "{\"transition\":\"native-enrollment-fixture\"}".to_owned(),
                accepted_at_ms: 900,
            })
            .expect("install authority epoch");
        journal
            .connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?1, ?2, 'fixture-admission', 1);",
                rusqlite::params!["8".repeat(64), authority.epoch_id],
            )
            .expect("install fixture writer admission");
    }

    #[test]
    fn verifies_both_signatures_before_enrolling_the_actor() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[10_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).expect("authority key");
        let authority = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &authority);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &authority);

        let actor = journal
            .verify_and_enroll_actor(&certificate, &authority.library_id)
            .expect("verify and enroll");
        assert_eq!(actor.actor_public_key, hex(actor_key.public_key().as_ref()));
        assert_eq!(actor.next_sequence, 1);
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (1, 1));
    }

    #[test]
    fn matches_and_enrolls_the_cross_runtime_v2_capability_vector() {
        let vectors = capability_vectors();
        assert_eq!(vectors["schema_version"], 1);
        assert_eq!(vectors["format"], "freed_library_core_actor_capability_v2");
        let vector = &vectors["vectors"][0];
        let authority = vector_authority(vector);
        let certificate =
            encode_canonical_value(&vector["certificate"], MAX_TRANSACTION_ENVELOPE_BYTES)
                .expect("canonical cross-runtime certificate");
        let verified = verify_actor_enrollment(&certificate, &authority)
            .expect("verify cross-runtime v2 capability");
        assert_eq!(
            verified.actor_id,
            vector["certificate"]["certificate_body"]["actor_enrollment_body"]["actor_id"]
        );
        assert_eq!(
            verified.enrollment_certificate_digest,
            vector["certificate"]["certificate_digest"]
        );
        assert_eq!(verified.actor_chain_genesis, vector["actor_chain_genesis"]);
        assert_eq!(verified.capability.certificate_version, 2);
        assert_eq!(verified.capability.actor_class, "agent");
        assert_eq!(
            verified.capability.allowed_operation_types,
            [
                "feed_item_read_assignment".to_owned(),
                "feed_item_saved_assignment".to_owned(),
            ]
        );
        assert!(matches!(
            verified.capability.scope,
            super::super::actor_capability::ActorCapabilityScope::LibraryWide
        ));

        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &authority);
        journal
            .verify_and_enroll_actor(&certificate, &authority.library_id)
            .expect("enroll v2 actor");
        let stored: (i64, String, String, String, String, String) = journal
            .connection
            .query_row(
                "SELECT certificateVersion, actorClass, allowedOperationTypesJson,
                        scopeMode, issuanceIdentity, retirementIdentity
                   FROM library_core_actor_capability_state
                  WHERE actorId = ?1;",
                [&verified.actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("stored capability");
        assert_eq!(stored.0, 2);
        assert_eq!(stored.1, "agent");
        assert_eq!(
            stored.2,
            "[\"feed_item_read_assignment\",\"feed_item_saved_assignment\"]"
        );
        assert_eq!(stored.3, "library_wide");
        assert_eq!(
            stored.4,
            vector["certificate"]["certificate_body"]["actor_capability_body"]["issuance_identity"]
        );
        assert_eq!(
            stored.5,
            vector["certificate"]["certificate_body"]["actor_capability_body"]
                ["retirement_identity"]
        );
    }

    #[test]
    fn enrollment_and_authority_frontiers_reject_two_tips_for_one_actor() {
        let actor_id = "1".repeat(64);
        let tips = json!([
            {
                "actor_id": actor_id,
                "sequence": 1,
                "operation_id": "op:frontier:one",
                "chain_digest": "2".repeat(64),
            },
            {
                "actor_id": actor_id,
                "sequence": 2,
                "operation_id": "op:frontier:two",
                "chain_digest": "3".repeat(64),
            }
        ]);
        assert!(matches!(
            parse_causal_tips(&tips),
            Err(JournalError::EnrollmentVerification {
                field: "observed_frontier"
            })
        ));

        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[14_u8; 32]).expect("authority key");
        let mut accepted = authority(&authority_key);
        accepted.observed_frontier = vec![
            VerifiedCausalTip {
                actor_id: actor_id.clone(),
                sequence: 1,
                operation_id: "op:frontier:one".to_owned(),
                chain_digest: "2".repeat(64),
            },
            VerifiedCausalTip {
                actor_id,
                sequence: 2,
                operation_id: "op:frontier:two".to_owned(),
                chain_digest: "3".repeat(64),
            },
        ];
        assert!(matches!(
            validate_authority(&accepted),
            Err(JournalError::EnrollmentVerification {
                field: "authority.observed_frontier"
            })
        ));
    }

    #[test]
    fn v2_capability_rejects_changed_scope_operations_and_stale_epoch() {
        let vectors = capability_vectors();
        let vector = &vectors["vectors"][0];
        let authority = vector_authority(vector);
        let mut changed = vector["certificate"].clone();
        changed["certificate_body"]["actor_capability_body"]["allowed_operation_types"] =
            json!(["feed_item_remove"]);
        let changed = encode_canonical_value(&changed, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("changed capability certificate");
        assert!(matches!(
            verify_actor_enrollment(&changed, &authority),
            Err(JournalError::EnrollmentVerification {
                field: "actor_capability_body_digest"
            })
        ));

        let mut missing_scope = vector["certificate"].clone();
        missing_scope["certificate_body"]["actor_capability_body"]
            .as_object_mut()
            .expect("capability body")
            .remove("scope");
        let missing_scope = encode_canonical_value(&missing_scope, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("missing scope certificate");
        assert!(matches!(
            verify_actor_enrollment(&missing_scope, &authority),
            Err(JournalError::EnrollmentVerification {
                field: "actor_capability_body"
            })
        ));

        let mut scraper_escape = vector["certificate"].clone();
        scraper_escape["certificate_body"]["actor_capability_body"]["actor_class"] =
            json!("scraper");
        let scraper_escape =
            encode_canonical_value(&scraper_escape, MAX_TRANSACTION_ENVELOPE_BYTES)
                .expect("scraper escape certificate");
        assert!(matches!(
            verify_actor_enrollment(&scraper_escape, &authority),
            Err(JournalError::EnrollmentVerification {
                field: "allowed_operation_types"
            })
        ));

        let certificate =
            encode_canonical_value(&vector["certificate"], MAX_TRANSACTION_ENVELOPE_BYTES)
                .expect("canonical certificate");
        let mut stale = authority.clone();
        stale.epoch += 1;
        assert!(matches!(
            verify_actor_enrollment(&certificate, &stale),
            Err(JournalError::EnrollmentVerification {
                field: "authority_binding"
            })
        ));
    }

    #[test]
    fn rejects_tampering_before_actor_or_outbox_persistence() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[12_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[13_u8; 32]).expect("authority key");
        let authority = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &authority);
        let mut value = decode_canonical_value(&certificate, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("decode certificate")
            .into_value();
        let proof = value["certificate_body"]["actor_proof"]
            .as_str()
            .expect("actor proof");
        let replacement = if proof.ends_with('0') { '1' } else { '0' };
        value["certificate_body"]["actor_proof"] =
            Value::String(format!("{}{replacement}", &proof[..proof.len() - 1]));
        let tampered =
            encode_canonical_value(&value, MAX_TRANSACTION_ENVELOPE_BYTES).expect("tamper");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &authority);

        assert!(matches!(
            journal.verify_and_enroll_actor(&tampered, &authority.library_id),
            Err(JournalError::EnrollmentVerification {
                field: "actor_proof"
            })
        ));
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("actor rows");
        assert_eq!(rows, (0, 0));

        let mut value = decode_canonical_value(&certificate, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("decode certificate")
            .into_value();
        let signature = value["authority_signature"]
            .as_str()
            .expect("authority signature");
        let replacement = if signature.ends_with('0') { '1' } else { '0' };
        value["authority_signature"] = Value::String(format!(
            "{}{replacement}",
            &signature[..signature.len() - 1]
        ));
        let tampered =
            encode_canonical_value(&value, MAX_TRANSACTION_ENVELOPE_BYTES).expect("tamper");

        assert!(matches!(
            journal.verify_and_enroll_actor(&tampered, &authority.library_id),
            Err(JournalError::EnrollmentVerification {
                field: "authority_signature"
            })
        ));
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("actor rows");
        assert_eq!(rows, (0, 0));
    }

    #[test]
    fn authority_epoch_change_fences_a_previously_verified_enrollment() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[16_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[17_u8; 32]).expect("authority key");
        let accepted = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &accepted);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &accepted);
        let verified = journal
            .verify_actor_enrollment(&certificate, &accepted)
            .expect("verify enrollment");
        let mut next = accepted.clone();
        next.epoch = 2;
        next.epoch_id = "9".repeat(64);
        journal
            .install_authority_epoch(&VerifiedAuthorityEpoch {
                authority: next,
                transition_certificate_digest: "7".repeat(64),
                canonical_transition_certificate_json: "{\"transition\":\"next-epoch-fixture\"}"
                    .to_owned(),
                accepted_at_ms: 1_100,
            })
            .expect("advance authority epoch");

        assert!(matches!(
            journal.enroll_actor_under_authority(&verified, &accepted, false),
            Err(JournalError::StaleAuthority { .. })
        ));
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (0, 0));
    }

    #[test]
    fn committed_enrollment_retry_survives_authority_epoch_advance() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[18_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[19_u8; 32]).expect("authority key");
        let accepted = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &accepted);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &accepted);
        let verified = journal
            .verify_actor_enrollment(&certificate, &accepted)
            .expect("verify enrollment");
        let first = journal
            .enroll_actor_under_authority(&verified, &accepted, false)
            .expect("enroll actor");

        let mut next = accepted.clone();
        next.epoch = 2;
        next.epoch_id = "9".repeat(64);
        journal
            .install_authority_epoch(&VerifiedAuthorityEpoch {
                authority: next,
                transition_certificate_digest: "7".repeat(64),
                canonical_transition_certificate_json: "{\"transition\":\"next-epoch-fixture\"}"
                    .to_owned(),
                accepted_at_ms: 1_100,
            })
            .expect("advance authority epoch");

        let retry = journal
            .enroll_actor_under_authority(&verified, &accepted, false)
            .expect("retry committed enrollment");
        assert_eq!(retry, first);
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (1, 1));
    }

    #[test]
    fn rejects_wrong_authority_and_duplicate_fields_before_signatures() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[14_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[15_u8; 32]).expect("authority key");
        let authority = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &authority);
        let mut wrong = authority.clone();
        wrong.epoch_id = "9".repeat(64);
        assert!(matches!(
            verify_actor_enrollment(&certificate, &wrong),
            Err(JournalError::EnrollmentVerification {
                field: "authority_binding"
            })
        ));
        assert!(matches!(
            verify_actor_enrollment(
                br#"{"certificate_body":{},"certificate_body":{}}"#,
                &authority
            ),
            Err(JournalError::EnrollmentVerification {
                field: "canonical_certificate"
            })
        ));
    }
}
