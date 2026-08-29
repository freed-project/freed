//! Native verification for normalized actor-enrollment certificates.
//!
//! This module proves that canonical certificate bytes bind one actor key and
//! capability to one accepted normalized authority state before the sealed
//! enrollment can enter SQLite.

use crate::library_core_canonical::{
    decode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_error::{LibraryCoreError, LibraryCoreResult};
use crate::normalized_authority::{NormalizedAuthorityStateV2, NormalizedCausalTipV1};
use crate::normalized_operation::VerifiedActorEnrollment;
use crate::normalized_protocol_limits::{
    is_lower_hex, is_operation_id, MAX_CAUSAL_TIPS_PER_OPERATION, MAX_SAFE_INTEGER,
    MAX_TRANSACTION_ENVELOPE_BYTES,
};
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
const CAPABILITY_BODY_V2_KEYS: [&str; 15] = [
    "format",
    "library_id",
    "epoch",
    "epoch_id",
    "authority_key_id",
    "actor_id",
    "actor_public_key",
    "actor_class",
    "allowed_operation_types",
    "allowed_query_ids",
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

fn invalid(field: &'static str) -> LibraryCoreError {
    LibraryCoreError::EnrollmentVerification { field }
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
    field: &'static str,
) -> LibraryCoreResult<&'a Map<String, Value>> {
    let object = value.as_object().ok_or_else(|| invalid(field))?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid(field));
    }
    Ok(object)
}

pub(crate) fn required_string(
    object: &Map<String, Value>,
    key: &'static str,
) -> LibraryCoreResult<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid(key))
}

fn safe_integer(object: &Map<String, Value>, key: &'static str) -> LibraryCoreResult<i64> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
        .ok_or_else(|| invalid(key))
}

pub(crate) fn positive_safe_integer(
    object: &Map<String, Value>,
    key: &'static str,
) -> LibraryCoreResult<i64> {
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
) -> LibraryCoreResult<()> {
    if object.get(key).and_then(Value::as_str) != Some(expected) {
        return Err(invalid(key));
    }
    Ok(())
}

fn require_integer_literal(
    object: &Map<String, Value>,
    key: &'static str,
    expected: i64,
) -> LibraryCoreResult<()> {
    if object.get(key).and_then(Value::as_i64) != Some(expected) {
        return Err(invalid(key));
    }
    Ok(())
}

fn require_hex(value: &str, bytes: usize, field: &'static str) -> LibraryCoreResult<()> {
    if !is_lower_hex(value, bytes) {
        return Err(invalid(field));
    }
    Ok(())
}

pub(crate) fn digest_hex(domain: &str, value: &Value) -> LibraryCoreResult<String> {
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

pub(crate) fn parse_causal_tips(value: &Value) -> LibraryCoreResult<Vec<NormalizedCausalTipV1>> {
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
        parsed.push(NormalizedCausalTipV1 {
            actor_id,
            sequence,
            operation_id,
            chain_digest,
        });
    }
    Ok(parsed)
}

pub(crate) fn validate_authority(authority: &NormalizedAuthorityStateV2) -> LibraryCoreResult<()> {
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
) -> LibraryCoreResult<crate::library_core_actor_capability::ActorCapabilityState> {
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
        .collect::<LibraryCoreResult<Vec<_>>>()?;
    crate::library_core_actor_capability::validate_allowed_operation_types(
        &actor_class,
        &operations,
    )
    .map_err(invalid)?;
    let query_ids = capability
        .get("allowed_query_ids")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("allowed_query_ids"))?
        .iter()
        .map(|query_id| {
            query_id
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid("allowed_query_ids"))
        })
        .collect::<LibraryCoreResult<Vec<_>>>()?;
    crate::library_core_actor_capability::validate_allowed_query_ids(&actor_class, &query_ids)
        .map_err(invalid)?;
    if operations.is_empty() && query_ids.is_empty() {
        return Err(invalid("capability_grants"));
    }

    let scope_value = capability.get("scope").ok_or_else(|| invalid("scope"))?;
    let scope_object = scope_value.as_object().ok_or_else(|| invalid("scope"))?;
    let scope = match scope_object.get("mode").and_then(Value::as_str) {
        Some("library_wide") => {
            exact_object(scope_value, &LIBRARY_WIDE_SCOPE_KEYS, "scope")?;
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide
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
            crate::library_core_actor_capability::ActorCapabilityScope::Bounded { kind, scope_id }
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
    Ok(crate::library_core_actor_capability::ActorCapabilityState {
        certificate_version: 2,
        actor_class,
        allowed_operation_types: operations,
        allowed_query_ids: query_ids,
        scope,
        issuance_identity: Some(issuance_identity),
        retirement_identity: Some(retirement_identity),
        capability_certificate_digest: String::new(),
        issued_at_ms: created_at_ms,
        retired: false,
        retirement_certificate_digest: None,
    })
}

pub(crate) fn verify_actor_enrollment(
    canonical_certificate: &[u8],
    authority: &NormalizedAuthorityStateV2,
) -> LibraryCoreResult<VerifiedActorEnrollment> {
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
        crate::library_core_actor_capability::ActorCapabilityState::historical_editor(
            certificate_digest.clone(),
            created_at_ms,
        )
    });
    let capability = if certificate_version == 2 {
        crate::library_core_actor_capability::ActorCapabilityState {
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
