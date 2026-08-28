//! Signed writer reassignment certificates for normalized SQLite authority.

use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_hash::{is_lower_sha256, lower_hex};
use crate::normalized_authority::NormalizedAuthorityStateV2;
use crate::normalized_authority_credentials::{
    load_or_create_authority_key_pair, AuthorityKeyStore,
};
use ring::signature::KeyPair;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const FORMAT: &str = "freed_library_core_writer_epoch_reassignment_v1";
const SIGNATURE_ALGORITHM: &str = "ed25519";
const MAX_CERTIFICATE_BYTES: usize = 16 * 1_024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WriterEpochReassignmentBodyV1 {
    pub(crate) format: String,
    pub(crate) library_id: String,
    pub(crate) source_control: Value,
    pub(crate) target_epoch: i64,
    pub(crate) target_writer_id: String,
    pub(crate) target_authority_public_key: String,
    pub(crate) target_authority_key_id: String,
    pub(crate) signature_algorithm: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WriterEpochReassignmentCertificateV1 {
    pub(crate) certificate_body: WriterEpochReassignmentBodyV1,
    pub(crate) epoch_id: String,
    pub(crate) epoch_signature: String,
    pub(crate) authority_key_possession_signature: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WriterEpochReassignment {
    pub authority: NormalizedAuthorityStateV2,
    pub canonical_certificate_json: String,
    pub transition_certificate_digest: String,
}

fn digest_value(domain: &str, value: &Value) -> Result<String, String> {
    let input = encode_operation_digest_input(domain, value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| format!("Library Core {domain} digest input is invalid"))?;
    Ok(lower_hex(&Sha256::digest(input)))
}

fn authority_key_id(authority_public_key: &str) -> Result<String, String> {
    digest_value(
        "authority-key",
        &json!({
            "authority_public_key": authority_public_key,
            "signature_algorithm": SIGNATURE_ALGORITHM,
        }),
    )
}

fn epoch_signature_input(epoch_id: &str) -> Result<Vec<u8>, String> {
    encode_signature_input(
        "epoch-transition-certificate",
        &json!({ "certificate_digest": epoch_id }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core epoch signature input is invalid".to_string())
}

fn possession_signature_input(epoch_id: &str, key_id: &str) -> Result<Vec<u8>, String> {
    encode_signature_input(
        "authority-key-possession",
        &json!({
            "certificate_digest": epoch_id,
            "target_authority_key_id": key_id,
        }),
        MAX_CERTIFICATE_BYTES,
    )
    .map_err(|_| "Library Core authority possession signature input is invalid".to_string())
}

fn validate_source_control(source_control: &Value, library_id: &str) -> Result<(), String> {
    let object = source_control
        .as_object()
        .ok_or_else(|| "Library Core source control is not an object".to_string())?;
    let source_library = object
        .get("libraryId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control library is missing".to_string())?;
    let source_epoch = object
        .get("storageEpoch")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control epoch is missing".to_string())?;
    let source_writer = object
        .get("writerId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control writer is missing".to_string())?;
    let source_frontier = object
        .get("causalFrontierDigest")
        .and_then(Value::as_str)
        .ok_or_else(|| "Library Core source control frontier is missing".to_string())?;
    let generation = object
        .get("generation")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Library Core source control generation is missing".to_string())?;
    if source_library != library_id
        || !is_lower_sha256(source_epoch)
        || !is_lower_sha256(source_writer)
        || !is_lower_sha256(source_frontier)
        || generation < 0
    {
        return Err("Library Core source control tuple is invalid".to_string());
    }
    Ok(())
}

pub(crate) fn verify_writer_reassignment_certificate(
    certificate: &WriterEpochReassignmentCertificateV1,
) -> Result<(), String> {
    let body = &certificate.certificate_body;
    if body.format != FORMAT
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || !is_lower_sha256(&body.library_id)
        || !is_lower_sha256(&body.target_writer_id)
        || !is_lower_sha256(&body.target_authority_public_key)
        || body.target_authority_key_id != authority_key_id(&body.target_authority_public_key)?
        || body.target_epoch < 1
    {
        return Err("Library Core writer reassignment certificate is invalid".to_string());
    }
    validate_source_control(&body.source_control, &body.library_id)?;
    let body_value = serde_json::to_value(body)
        .map_err(|_| "Library Core writer reassignment body is invalid".to_string())?;
    if certificate.epoch_id != digest_value("epoch-transition-certificate", &body_value)? {
        return Err("Library Core writer reassignment epoch digest is invalid".to_string());
    }
    for (input, signature, label) in [
        (
            epoch_signature_input(&certificate.epoch_id)?,
            &certificate.epoch_signature,
            "epoch",
        ),
        (
            possession_signature_input(&certificate.epoch_id, &body.target_authority_key_id)?,
            &certificate.authority_key_possession_signature,
            "authority possession",
        ),
    ] {
        if !verify_library_core_ed25519(&body.target_authority_public_key, signature, &input)
            .map_err(|_| {
                format!("Library Core writer reassignment {label} signature is malformed")
            })?
        {
            return Err(format!(
                "Library Core writer reassignment {label} signature is invalid"
            ));
        }
    }
    Ok(())
}

pub fn prepare_writer_epoch_reassignment(
    current: &NormalizedAuthorityStateV2,
    current_canonical_transition_certificate: &str,
    canonical_source_control_json: &str,
    target_writer_id: &str,
    store: &dyn AuthorityKeyStore,
) -> Result<WriterEpochReassignment, String> {
    if !is_lower_sha256(&current.library_id)
        || !is_lower_sha256(target_writer_id)
        || canonical_source_control_json.len() > MAX_CERTIFICATE_BYTES
    {
        return Err("Library Core writer reassignment request is invalid".to_string());
    }
    let source_control: Value = serde_json::from_str(canonical_source_control_json)
        .map_err(|_| "Library Core source control JSON is invalid".to_string())?;
    validate_source_control(&source_control, &current.library_id)?;
    let canonical_source = encode_canonical_value(&source_control, MAX_CERTIFICATE_BYTES)
        .map_err(|_| "Library Core source control is not canonically encodable".to_string())?;
    if canonical_source.as_slice() != canonical_source_control_json.as_bytes() {
        return Err("Library Core source control JSON is not canonical".to_string());
    }

    if let Ok(existing) = serde_json::from_str::<WriterEpochReassignmentCertificateV1>(
        current_canonical_transition_certificate,
    ) {
        if existing.certificate_body.source_control == source_control
            && existing.certificate_body.target_writer_id == target_writer_id
        {
            verify_writer_reassignment_certificate(&existing)?;
            return Ok(WriterEpochReassignment {
                authority: current.clone(),
                canonical_certificate_json: current_canonical_transition_certificate.to_owned(),
                transition_certificate_digest: digest_value(
                    "epoch-transition-certificate",
                    &serde_json::to_value(&existing).map_err(|_| {
                        "Library Core writer reassignment certificate is invalid".to_string()
                    })?,
                )?,
            });
        }
    }

    let target_epoch = current
        .epoch
        .checked_add(1)
        .ok_or_else(|| "Library Core authority epoch is exhausted".to_string())?;
    let key_pair = load_or_create_authority_key_pair(store, &current.library_id)?;
    let public_key = lower_hex(key_pair.public_key().as_ref());
    let key_id = authority_key_id(&public_key)?;
    let body = WriterEpochReassignmentBodyV1 {
        format: FORMAT.to_string(),
        library_id: current.library_id.clone(),
        source_control,
        target_epoch,
        target_writer_id: target_writer_id.to_string(),
        target_authority_public_key: public_key.clone(),
        target_authority_key_id: key_id.clone(),
        signature_algorithm: SIGNATURE_ALGORITHM.to_string(),
    };
    let body_value = serde_json::to_value(&body)
        .map_err(|_| "Library Core writer reassignment body is invalid".to_string())?;
    let epoch_id = digest_value("epoch-transition-certificate", &body_value)?;
    let certificate = WriterEpochReassignmentCertificateV1 {
        epoch_signature: lower_hex(key_pair.sign(&epoch_signature_input(&epoch_id)?).as_ref()),
        authority_key_possession_signature: lower_hex(
            key_pair
                .sign(&possession_signature_input(&epoch_id, &key_id)?)
                .as_ref(),
        ),
        certificate_body: body,
        epoch_id: epoch_id.clone(),
    };
    verify_writer_reassignment_certificate(&certificate)?;
    let certificate_value = serde_json::to_value(&certificate)
        .map_err(|_| "Library Core writer reassignment certificate is invalid".to_string())?;
    let canonical = encode_canonical_value(&certificate_value, MAX_CERTIFICATE_BYTES)
        .map_err(|_| "Library Core writer reassignment certificate is not canonical".to_string())?;
    let canonical_certificate_json = String::from_utf8(canonical)
        .map_err(|_| "Library Core writer reassignment certificate is not UTF-8".to_string())?;
    let transition_certificate_digest =
        digest_value("epoch-transition-certificate", &certificate_value)?;
    Ok(WriterEpochReassignment {
        authority: NormalizedAuthorityStateV2 {
            library_id: current.library_id.clone(),
            epoch: target_epoch,
            epoch_id,
            authority_key_id: key_id,
            authority_public_key: public_key,
            observed_frontier: current.observed_frontier.clone(),
        },
        canonical_certificate_json,
        transition_certificate_digest,
    })
}
