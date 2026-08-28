use crate::library_core_actor_capability::ActorCapabilityScope;
use crate::library_core_actor_enrollment::{
    prepare_normalized_primary_actor_enrollment_v2, ActorKeyStore,
};
use crate::library_core_canonical::{
    encode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_hash::lower_hex;
use crate::normalized_authority::{NormalizedAuthorityStateV2, NormalizedCausalTipV1};
use crate::normalized_authority_credentials::{
    load_or_create_authority_key_pair, normalized_native_library_id, AuthorityKeyStore,
};
use crate::normalized_checkpoint::blob_digest;
use crate::normalized_import::NormalizedCheckpointDigestAccumulatorV2;
use crate::normalized_sqlite::{
    export_normalized_checkpoint_page_v2, install_normalized_schema_v1,
    NormalizedCheckpointExportRequestV2, NormalizedSqliteError,
};
use crate::sqlite_contract_generated::{
    CONTENT_CHUNK_BYTES, NORMALIZED_CHECKPOINT_FORMAT, NORMALIZED_SCHEMA_SHA256,
    PREFERENCE_WRITE_POLICIES_JSON, SQLITE_CONTRACT_VERSION, SQLITE_MUTATION_PROGRAMS,
    SQLITE_PROTOCOL_VERSION, SQLITE_SCHEMA_VERSION,
};
use ring::signature::{Ed25519KeyPair, KeyPair};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const INLINE_CONTENT_MAXIMUM_BYTES: usize = 65_536;
const MAXIMUM_TAGS: usize = 4_096;
const MAXIMUM_HIGHLIGHTS: usize = 4_096;
const MAXIMUM_SIGNALS: usize = 256;
const MAXIMUM_REACH_OUTS: usize = 20;
const MAXIMUM_PREFERENCE_NODES: i64 = 512;
const MAXIMUM_PREFERENCE_PATH_BYTES: i64 = 4_096;
const MAXIMUM_PREFERENCE_TEXT_BYTES: i64 = 8_192;
const LEGACY_REACH_OUT_DIGEST_PREFIX: &[u8] =
    b"freed.library-core.v2/digest-bytes/legacy-reach-out\0";
const LEGACY_FRONTIER_DIGEST_PREFIX: &[u8] =
    b"freed.library-core.v2/digest-records/legacy-source-frontier\0";
const MAXIMUM_SOURCE_FRONTIER_TIPS: usize = 1_000;
const MAXIMUM_TRANSITION_CERTIFICATE_BYTES: usize = 65_536;
const SIGNATURE_ALGORITHM: &str = "ed25519";
const NORMALIZED_STORAGE_TRANSITION_FORMAT: &str =
    "freed_normalized_storage_transition_certificate_v1";
const NORMALIZED_FRESH_GENESIS_FORMAT: &str = "freed_normalized_fresh_genesis_certificate_v1";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct LegacyShellCountsV1 {
    rss_feeds: u64,
    persons: u64,
    accounts: u64,
    reach_outs: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedMigrationCandidateReceiptV1 {
    format: String,
    library_id: String,
    source_epoch: u64,
    source_epoch_id: String,
    source_transition_certificate_digest: String,
    source_authority_key_id: String,
    source_authority_public_key: String,
    source_document_digest: String,
    source_frontier_count: u64,
    source_frontier_digest: String,
    source_generation: u64,
    source_revision: u64,
    source_sqlite_revision: u64,
    live_feed_items: u64,
    excluded_deleted_feed_items: u64,
    rss_feeds: u64,
    persons: u64,
    accounts: u64,
    reach_outs: u64,
    normalized_record_count: u64,
    normalized_canonical_bytes: u64,
    normalized_product_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedDesktopAuthorityPreparedV1 {
    pub format: String,
    pub library_id: String,
    pub epoch_id: String,
    pub transition_certificate_digest: String,
    pub normalized_product_digest: String,
    pub selected_at: u64,
    pub primary_actor_id: String,
}

fn canonical_migration_candidate_v1(
    candidate: &NormalizedMigrationCandidateReceiptV1,
) -> Result<(String, String), NormalizedSqliteError> {
    let value = serde_json::to_value(candidate)
        .map_err(|_| invalid("normalized migration candidate receipt is invalid"))?;
    let canonical = encode_canonical_value(&value, MAXIMUM_TRANSITION_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized migration candidate receipt is invalid"))?;
    let mut digest = Sha256::new();
    digest.update(b"freed.library-core.v1/digest/migration-candidate-receipt\0");
    digest.update(&canonical);
    let digest = lower_hex(&digest.finalize());
    let canonical = String::from_utf8(canonical)
        .map_err(|_| invalid("normalized migration candidate receipt is not UTF-8"))?;
    Ok((canonical, digest))
}

fn load_normalized_migration_candidate_v1(
    target: &Connection,
) -> Result<Option<NormalizedMigrationCandidateReceiptV1>, NormalizedSqliteError> {
    let stored: Option<(String, String)> = target
        .query_row(
            "SELECT candidate_json, candidate_digest
             FROM library_storage_transition_plan WHERE singleton_id = 1;",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((canonical, digest)) = stored else {
        return Ok(None);
    };
    let candidate: NormalizedMigrationCandidateReceiptV1 = serde_json::from_str(&canonical)
        .map_err(|_| invalid("normalized migration candidate receipt is invalid JSON"))?;
    let (expected_canonical, expected_digest) = canonical_migration_candidate_v1(&candidate)?;
    if canonical != expected_canonical || digest != expected_digest {
        return Err(invalid("normalized migration candidate receipt changed"));
    }
    Ok(Some(candidate))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedStorageTransitionBodyV1 {
    format: String,
    library_id: String,
    epoch_number: u64,
    writer_id: String,
    authority_key_id: String,
    authority_public_key: String,
    signature_algorithm: String,
    sqlite_contract_version: u32,
    sqlite_schema_version: u32,
    sqlite_protocol_version: u32,
    normalized_schema_sha256: String,
    checkpoint_format: String,
    accepted_manifest_generation: u64,
    accepted_at: u64,
    migration_candidate: NormalizedMigrationCandidateReceiptV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedStorageTransitionCertificateV1 {
    certificate_body: NormalizedStorageTransitionBodyV1,
    epoch_id: String,
    epoch_signature: String,
    authority_key_possession_signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SignedNormalizedStorageTransitionV1 {
    epoch_id: String,
    transition_certificate_digest: String,
    canonical_transition_certificate: String,
    authority_key_id: String,
    authority_public_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedFreshGenesisBodyV1 {
    format: String,
    library_id: String,
    epoch_number: u64,
    writer_id: String,
    authority_key_id: String,
    authority_public_key: String,
    signature_algorithm: String,
    sqlite_contract_version: u32,
    sqlite_schema_version: u32,
    sqlite_protocol_version: u32,
    normalized_schema_sha256: String,
    checkpoint_format: String,
    normalized_product_digest: String,
    normalized_record_count: u64,
    normalized_canonical_bytes: u64,
    accepted_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedFreshGenesisCertificateV1 {
    certificate_body: NormalizedFreshGenesisBodyV1,
    epoch_id: String,
    epoch_signature: String,
    authority_key_possession_signature: String,
}

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn valid_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn transition_digest(domain: &str, value: &Value) -> Result<String, NormalizedSqliteError> {
    let input = encode_operation_digest_input(domain, value, MAXIMUM_TRANSITION_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized storage transition is invalid"))?;
    Ok(lower_hex(&Sha256::digest(input)))
}

fn transition_authority_key_id(
    authority_public_key: &str,
) -> Result<String, NormalizedSqliteError> {
    transition_digest(
        "authority-key",
        &serde_json::json!({
            "authority_public_key": authority_public_key,
            "signature_algorithm": SIGNATURE_ALGORITHM
        }),
    )
}

fn transition_signature_input(
    domain: &str,
    value: Value,
) -> Result<Vec<u8>, NormalizedSqliteError> {
    encode_signature_input(domain, &value, MAXIMUM_TRANSITION_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized storage transition signature input is invalid"))
}

fn sign_normalized_storage_transition_v1(
    candidate: &NormalizedMigrationCandidateReceiptV1,
    authority_store: &dyn AuthorityKeyStore,
    writer_id: &str,
    accepted_at: u64,
) -> Result<SignedNormalizedStorageTransitionV1, NormalizedSqliteError> {
    if candidate.format != "freed_normalized_migration_candidate_v1"
        || writer_id.is_empty()
        || writer_id.len() > 255
        || accepted_at > 9_007_199_254_740_991
    {
        return Err(invalid("normalized storage transition request is invalid"));
    }
    let key_bytes = authority_store
        .load(&candidate.library_id)
        .map_err(|_| invalid("normalized authority signing key cannot be loaded"))?
        .ok_or_else(|| invalid("normalized authority signing key is missing"))?;
    let key_pair = Ed25519KeyPair::from_pkcs8(&key_bytes)
        .map_err(|_| invalid("normalized authority signing key is corrupt"))?;
    let authority_public_key = lower_hex(key_pair.public_key().as_ref());
    let authority_key_id = transition_authority_key_id(&authority_public_key)?;
    if authority_public_key != candidate.source_authority_public_key
        || authority_key_id != candidate.source_authority_key_id
    {
        return Err(invalid("normalized authority key lineage is unavailable"));
    }
    let epoch_number = candidate
        .source_epoch
        .checked_add(1)
        .filter(|value| *value <= 9_007_199_254_740_991)
        .ok_or_else(|| invalid("normalized storage epoch is invalid"))?;
    let certificate_body = NormalizedStorageTransitionBodyV1 {
        format: NORMALIZED_STORAGE_TRANSITION_FORMAT.to_owned(),
        library_id: candidate.library_id.clone(),
        epoch_number,
        writer_id: writer_id.to_owned(),
        authority_key_id: authority_key_id.clone(),
        authority_public_key: authority_public_key.clone(),
        signature_algorithm: SIGNATURE_ALGORITHM.to_owned(),
        sqlite_contract_version: SQLITE_CONTRACT_VERSION,
        sqlite_schema_version: SQLITE_SCHEMA_VERSION,
        sqlite_protocol_version: SQLITE_PROTOCOL_VERSION,
        normalized_schema_sha256: NORMALIZED_SCHEMA_SHA256.to_owned(),
        checkpoint_format: NORMALIZED_CHECKPOINT_FORMAT.to_owned(),
        accepted_manifest_generation: 0,
        accepted_at,
        migration_candidate: candidate.clone(),
    };
    let body_value = serde_json::to_value(&certificate_body)
        .map_err(|_| invalid("normalized storage transition body is invalid"))?;
    let epoch_id = transition_digest("epoch-transition-certificate", &body_value)?;
    let epoch_signature_input = transition_signature_input(
        "epoch-transition-certificate",
        serde_json::json!({ "certificate_digest": epoch_id }),
    )?;
    let possession_signature_input = transition_signature_input(
        "authority-key-possession",
        serde_json::json!({
            "certificate_digest": epoch_id,
            "target_authority_key_id": authority_key_id
        }),
    )?;
    let certificate = NormalizedStorageTransitionCertificateV1 {
        certificate_body,
        epoch_id: epoch_id.clone(),
        epoch_signature: lower_hex(key_pair.sign(&epoch_signature_input).as_ref()),
        authority_key_possession_signature: lower_hex(
            key_pair.sign(&possession_signature_input).as_ref(),
        ),
    };
    if !verify_library_core_ed25519(
        &authority_public_key,
        &certificate.epoch_signature,
        &epoch_signature_input,
    )
    .map_err(|_| invalid("normalized storage transition signature is malformed"))?
        || !verify_library_core_ed25519(
            &authority_public_key,
            &certificate.authority_key_possession_signature,
            &possession_signature_input,
        )
        .map_err(|_| invalid("normalized authority possession signature is malformed"))?
    {
        return Err(invalid(
            "normalized storage transition signature is invalid",
        ));
    }
    let certificate_value = serde_json::to_value(&certificate)
        .map_err(|_| invalid("normalized storage transition certificate is invalid"))?;
    let canonical =
        encode_canonical_value(&certificate_value, MAXIMUM_TRANSITION_CERTIFICATE_BYTES)
            .map_err(|_| invalid("normalized storage transition certificate is not canonical"))?;
    let canonical_transition_certificate = String::from_utf8(canonical)
        .map_err(|_| invalid("normalized storage transition certificate is not UTF-8"))?;
    let transition_certificate_digest =
        transition_digest("epoch-transition-certificate", &certificate_value)?;
    Ok(SignedNormalizedStorageTransitionV1 {
        epoch_id,
        transition_certificate_digest,
        canonical_transition_certificate,
        authority_key_id,
        authority_public_key,
    })
}

fn verify_normalized_storage_transition_v1(
    candidate: &NormalizedMigrationCandidateReceiptV1,
    signed: &SignedNormalizedStorageTransitionV1,
) -> Result<NormalizedStorageTransitionCertificateV1, NormalizedSqliteError> {
    if signed.canonical_transition_certificate.is_empty()
        || signed.canonical_transition_certificate.len() > MAXIMUM_TRANSITION_CERTIFICATE_BYTES
        || !valid_sha256(&signed.epoch_id)
        || !valid_sha256(&signed.transition_certificate_digest)
        || !valid_sha256(&signed.authority_key_id)
        || !valid_sha256(&signed.authority_public_key)
    {
        return Err(invalid("normalized storage transition is invalid"));
    }
    let value: Value = serde_json::from_str(&signed.canonical_transition_certificate)
        .map_err(|_| invalid("normalized storage transition certificate is invalid JSON"))?;
    let canonical = encode_canonical_value(&value, MAXIMUM_TRANSITION_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized storage transition certificate is not canonical"))?;
    if canonical.as_slice() != signed.canonical_transition_certificate.as_bytes() {
        return Err(invalid(
            "normalized storage transition certificate is not canonical",
        ));
    }
    let certificate: NormalizedStorageTransitionCertificateV1 =
        serde_json::from_value(value.clone())
            .map_err(|_| invalid("normalized storage transition certificate is invalid"))?;
    let body = &certificate.certificate_body;
    let expected_epoch_number = candidate
        .source_epoch
        .checked_add(1)
        .ok_or_else(|| invalid("normalized storage epoch is invalid"))?;
    if body.format != NORMALIZED_STORAGE_TRANSITION_FORMAT
        || body.library_id != candidate.library_id
        || body.epoch_number != expected_epoch_number
        || body.writer_id.is_empty()
        || body.authority_key_id != candidate.source_authority_key_id
        || body.authority_public_key != candidate.source_authority_public_key
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || body.sqlite_contract_version != SQLITE_CONTRACT_VERSION
        || body.sqlite_schema_version != SQLITE_SCHEMA_VERSION
        || body.sqlite_protocol_version != SQLITE_PROTOCOL_VERSION
        || body.normalized_schema_sha256 != NORMALIZED_SCHEMA_SHA256
        || body.checkpoint_format != NORMALIZED_CHECKPOINT_FORMAT
        || body.accepted_manifest_generation != 0
        || body.accepted_at > 9_007_199_254_740_991
        || body.migration_candidate != *candidate
        || certificate.epoch_id != signed.epoch_id
        || body.authority_key_id != signed.authority_key_id
        || body.authority_public_key != signed.authority_public_key
    {
        return Err(invalid("normalized storage transition body is invalid"));
    }
    let body_value = serde_json::to_value(body)
        .map_err(|_| invalid("normalized storage transition body is invalid"))?;
    if transition_digest("epoch-transition-certificate", &body_value)? != certificate.epoch_id
        || transition_digest("epoch-transition-certificate", &value)?
            != signed.transition_certificate_digest
    {
        return Err(invalid("normalized storage transition digest is invalid"));
    }
    let epoch_input = transition_signature_input(
        "epoch-transition-certificate",
        serde_json::json!({ "certificate_digest": certificate.epoch_id }),
    )?;
    let possession_input = transition_signature_input(
        "authority-key-possession",
        serde_json::json!({
            "certificate_digest": certificate.epoch_id,
            "target_authority_key_id": body.authority_key_id
        }),
    )?;
    if !verify_library_core_ed25519(
        &body.authority_public_key,
        &certificate.epoch_signature,
        &epoch_input,
    )
    .map_err(|_| invalid("normalized storage transition signature is malformed"))?
        || !verify_library_core_ed25519(
            &body.authority_public_key,
            &certificate.authority_key_possession_signature,
            &possession_input,
        )
        .map_err(|_| invalid("normalized authority possession signature is malformed"))?
    {
        return Err(invalid(
            "normalized storage transition signature is invalid",
        ));
    }
    Ok(certificate)
}

fn sign_normalized_fresh_genesis_v1(
    body: NormalizedFreshGenesisBodyV1,
    authority_store: &dyn AuthorityKeyStore,
) -> Result<SignedNormalizedStorageTransitionV1, NormalizedSqliteError> {
    let key_pair = load_or_create_authority_key_pair(authority_store, &body.library_id)
        .map_err(|_| invalid("normalized fresh authority key is unavailable"))?;
    let authority_public_key = lower_hex(key_pair.public_key().as_ref());
    let authority_key_id = transition_authority_key_id(&authority_public_key)?;
    if body.format != NORMALIZED_FRESH_GENESIS_FORMAT
        || body.epoch_number != 1
        || body.writer_id != "primary:desktop"
        || body.authority_key_id != authority_key_id
        || body.authority_public_key != authority_public_key
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || body.sqlite_contract_version != SQLITE_CONTRACT_VERSION
        || body.sqlite_schema_version != SQLITE_SCHEMA_VERSION
        || body.sqlite_protocol_version != SQLITE_PROTOCOL_VERSION
        || body.normalized_schema_sha256 != NORMALIZED_SCHEMA_SHA256
        || body.checkpoint_format != NORMALIZED_CHECKPOINT_FORMAT
        || !valid_sha256(&body.normalized_product_digest)
        || body.accepted_at > 9_007_199_254_740_991
    {
        return Err(invalid("normalized fresh genesis body is invalid"));
    }
    let body_value = serde_json::to_value(&body)
        .map_err(|_| invalid("normalized fresh genesis body is invalid"))?;
    let epoch_id = transition_digest("epoch-transition-certificate", &body_value)?;
    let epoch_input = transition_signature_input(
        "epoch-transition-certificate",
        serde_json::json!({ "certificate_digest": epoch_id }),
    )?;
    let possession_input = transition_signature_input(
        "authority-key-possession",
        serde_json::json!({
            "certificate_digest": epoch_id,
            "target_authority_key_id": authority_key_id
        }),
    )?;
    let certificate = NormalizedFreshGenesisCertificateV1 {
        certificate_body: body,
        epoch_id: epoch_id.clone(),
        epoch_signature: lower_hex(key_pair.sign(&epoch_input).as_ref()),
        authority_key_possession_signature: lower_hex(key_pair.sign(&possession_input).as_ref()),
    };
    let value = serde_json::to_value(&certificate)
        .map_err(|_| invalid("normalized fresh genesis certificate is invalid"))?;
    let canonical = encode_canonical_value(&value, MAXIMUM_TRANSITION_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized fresh genesis certificate is not canonical"))?;
    let canonical_transition_certificate = String::from_utf8(canonical)
        .map_err(|_| invalid("normalized fresh genesis certificate is not UTF-8"))?;
    let signed = SignedNormalizedStorageTransitionV1 {
        epoch_id,
        transition_certificate_digest: transition_digest("epoch-transition-certificate", &value)?,
        canonical_transition_certificate,
        authority_key_id,
        authority_public_key,
    };
    verify_normalized_fresh_genesis_v1(&signed)?;
    Ok(signed)
}

fn verify_normalized_fresh_genesis_v1(
    signed: &SignedNormalizedStorageTransitionV1,
) -> Result<NormalizedFreshGenesisCertificateV1, NormalizedSqliteError> {
    if signed.canonical_transition_certificate.is_empty()
        || signed.canonical_transition_certificate.len() > MAXIMUM_TRANSITION_CERTIFICATE_BYTES
        || !valid_sha256(&signed.epoch_id)
        || !valid_sha256(&signed.transition_certificate_digest)
        || !valid_sha256(&signed.authority_key_id)
        || !valid_sha256(&signed.authority_public_key)
    {
        return Err(invalid("normalized fresh genesis is invalid"));
    }
    let value: Value = serde_json::from_str(&signed.canonical_transition_certificate)
        .map_err(|_| invalid("normalized fresh genesis certificate is invalid JSON"))?;
    let canonical = encode_canonical_value(&value, MAXIMUM_TRANSITION_CERTIFICATE_BYTES)
        .map_err(|_| invalid("normalized fresh genesis certificate is not canonical"))?;
    if canonical.as_slice() != signed.canonical_transition_certificate.as_bytes()
        || transition_digest("epoch-transition-certificate", &value)?
            != signed.transition_certificate_digest
    {
        return Err(invalid("normalized fresh genesis certificate changed"));
    }
    let certificate: NormalizedFreshGenesisCertificateV1 = serde_json::from_value(value)
        .map_err(|_| invalid("normalized fresh genesis certificate is invalid"))?;
    let body = &certificate.certificate_body;
    let body_value = serde_json::to_value(body)
        .map_err(|_| invalid("normalized fresh genesis body is invalid"))?;
    if body.format != NORMALIZED_FRESH_GENESIS_FORMAT
        || body.epoch_number != 1
        || body.writer_id != "primary:desktop"
        || body.signature_algorithm != SIGNATURE_ALGORITHM
        || body.sqlite_contract_version != SQLITE_CONTRACT_VERSION
        || body.sqlite_schema_version != SQLITE_SCHEMA_VERSION
        || body.sqlite_protocol_version != SQLITE_PROTOCOL_VERSION
        || body.normalized_schema_sha256 != NORMALIZED_SCHEMA_SHA256
        || body.checkpoint_format != NORMALIZED_CHECKPOINT_FORMAT
        || !valid_sha256(&body.library_id)
        || !valid_sha256(&body.normalized_product_digest)
        || body.authority_key_id != signed.authority_key_id
        || body.authority_public_key != signed.authority_public_key
        || transition_authority_key_id(&body.authority_public_key)? != body.authority_key_id
        || body.accepted_at > 9_007_199_254_740_991
        || certificate.epoch_id != signed.epoch_id
        || transition_digest("epoch-transition-certificate", &body_value)? != certificate.epoch_id
    {
        return Err(invalid("normalized fresh genesis body is invalid"));
    }
    let epoch_input = transition_signature_input(
        "epoch-transition-certificate",
        serde_json::json!({ "certificate_digest": certificate.epoch_id }),
    )?;
    let possession_input = transition_signature_input(
        "authority-key-possession",
        serde_json::json!({
            "certificate_digest": certificate.epoch_id,
            "target_authority_key_id": body.authority_key_id
        }),
    )?;
    if !verify_library_core_ed25519(
        &body.authority_public_key,
        &certificate.epoch_signature,
        &epoch_input,
    )
    .map_err(|_| invalid("normalized fresh genesis signature is malformed"))?
        || !verify_library_core_ed25519(
            &body.authority_public_key,
            &certificate.authority_key_possession_signature,
            &possession_input,
        )
        .map_err(|_| invalid("normalized fresh authority possession signature is malformed"))?
    {
        return Err(invalid("normalized fresh genesis signature is invalid"));
    }
    Ok(certificate)
}

fn object_mut<'a>(
    value: &'a mut Value,
    key: &str,
) -> Result<&'a mut serde_json::Map<String, Value>, NormalizedSqliteError> {
    value
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("legacy FeedItem has an invalid normalized object"))
}

fn take_large_text(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<Vec<u8>>, NormalizedSqliteError> {
    let Some(value) = object.get_mut(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let text = value
        .as_str()
        .ok_or_else(|| invalid("legacy FeedItem content field is not text"))?;
    if text.len() <= INLINE_CONTENT_MAXIMUM_BYTES {
        return Ok(None);
    }
    let bytes = text.as_bytes().to_vec();
    *value = Value::Null;
    Ok(Some(bytes))
}

fn insert_content_blob(
    transaction: &Transaction<'_>,
    bytes: &[u8],
    media_type: &str,
) -> Result<String, NormalizedSqliteError> {
    let content_digest = blob_digest(bytes);
    let chunk_count = bytes.len().div_ceil(CONTENT_CHUNK_BYTES);
    transaction.execute(
        "INSERT INTO library_blobs
         (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(content_digest) DO NOTHING;",
        params![
            content_digest,
            i64::try_from(bytes.len()).map_err(|_| invalid("legacy content is too large"))?,
            i64::try_from(CONTENT_CHUNK_BYTES)
                .map_err(|_| invalid("content chunk bound is invalid"))?,
            i64::try_from(chunk_count).map_err(|_| invalid("legacy content is too large"))?,
            media_type,
        ],
    )?;
    let descriptor: (i64, i64, i64, String) = transaction.query_row(
        "SELECT byte_length, chunk_bytes, chunk_count, media_type
         FROM library_blobs WHERE content_digest = ?1;",
        [&content_digest],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    if descriptor
        != (
            i64::try_from(bytes.len()).unwrap_or(-1),
            i64::try_from(CONTENT_CHUNK_BYTES).unwrap_or(-1),
            i64::try_from(chunk_count).unwrap_or(-1),
            media_type.to_string(),
        )
    {
        return Err(invalid(
            "content-addressed blob descriptor replay is inconsistent",
        ));
    }
    for (chunk_index, chunk) in bytes.chunks(CONTENT_CHUNK_BYTES).enumerate() {
        let chunk_digest = blob_digest(chunk);
        transaction.execute(
            "INSERT INTO library_blob_chunks
             (content_digest, chunk_index, chunk_digest, bytes)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(content_digest, chunk_index) DO NOTHING;",
            params![
                content_digest,
                i64::try_from(chunk_index)
                    .map_err(|_| invalid("legacy content has too many chunks"))?,
                chunk_digest,
                chunk,
            ],
        )?;
        let stored: (String, Vec<u8>) = transaction.query_row(
            "SELECT chunk_digest, bytes FROM library_blob_chunks
             WHERE content_digest = ?1 AND chunk_index = ?2;",
            params![
                content_digest,
                i64::try_from(chunk_index)
                    .map_err(|_| invalid("legacy content has too many chunks"))?,
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if stored.0 != chunk_digest || stored.1 != chunk {
            return Err(invalid(
                "content-addressed blob chunk replay is inconsistent",
            ));
        }
    }
    let stored_chunks: i64 = transaction.query_row(
        "SELECT count(*) FROM library_blob_chunks WHERE content_digest = ?1;",
        [&content_digest],
        |row| row.get(0),
    )?;
    if stored_chunks != i64::try_from(chunk_count).unwrap_or(-1) {
        return Err(invalid("content-addressed blob replay is inconsistent"));
    }
    Ok(content_digest)
}

fn bounded_array<'a>(
    value: Option<&'a Value>,
    maximum: usize,
    label: &'static str,
) -> Result<&'a [Value], NormalizedSqliteError> {
    match value {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(values)) if values.len() <= maximum => Ok(values),
        _ => Err(invalid(label)),
    }
}

fn mutation_program(
    mutation_id: &str,
) -> Result<&'static crate::sqlite_contract_generated::SqliteMutationProgram, NormalizedSqliteError>
{
    SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|program| program.mutation_id == mutation_id)
        .ok_or_else(|| invalid("normalized migration mutation program is missing"))
}

fn legacy_map<'a>(
    shell: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<&'a serde_json::Map<String, Value>>, NormalizedSqliteError> {
    match shell.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(value)) => Ok(Some(value)),
        _ => Err(invalid("legacy Library shell collection is invalid")),
    }
}

fn materialize_json_entity(
    transaction: &Transaction<'_>,
    mutation_id: &str,
    entity_id: &str,
    value: &Value,
    updated_at: i64,
) -> Result<(), NormalizedSqliteError> {
    if entity_id.is_empty() || entity_id.len() > 2_048 {
        return Err(invalid("legacy Library entity identity is invalid"));
    }
    let encoded = serde_json::to_string(value)
        .map_err(|_| invalid("legacy Library entity cannot be normalized"))?;
    if encoded.len() > INLINE_CONTENT_MAXIMUM_BYTES {
        return Err(invalid("legacy Library entity exceeds its metadata bound"));
    }
    let program = mutation_program(mutation_id)?;
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, [entity_id])?;
    }
    match mutation_id {
        "rss_feed_upsert" => {
            transaction.execute(
                program.materialize_sql,
                params![entity_id, encoded, updated_at],
            )?;
        }
        "person_upsert" | "account_upsert" => {
            transaction.execute(program.materialize_sql, params![entity_id, encoded])?;
        }
        _ => return Err(invalid("legacy Library entity program is unsupported")),
    }
    for sql in program.dependent_insert_sql {
        transaction.execute(sql, params![entity_id, encoded])?;
    }
    Ok(())
}

fn preference_policies() -> &'static serde_json::Map<String, Value> {
    static POLICIES: OnceLock<serde_json::Map<String, Value>> = OnceLock::new();
    POLICIES.get_or_init(|| {
        serde_json::from_str::<Value>(PREFERENCE_WRITE_POLICIES_JSON)
            .expect("generated preference write policies must be valid JSON")
            .as_object()
            .expect("generated preference write policies must be an object")
            .clone()
    })
}

fn policy(name: &str) -> &'static serde_json::Map<String, Value> {
    preference_policies()[name]
        .as_object()
        .unwrap_or_else(|| panic!("generated preference write policy {name} must be an object"))
}

fn sanitized_scalar_map(
    value: &Value,
    predicate: fn(&Value) -> bool,
) -> Result<Value, NormalizedSqliteError> {
    let source = value
        .as_object()
        .ok_or_else(|| invalid("legacy preference record is invalid"))?;
    if source.len() > 256 || source.values().any(|entry| !predicate(entry)) {
        return Err(invalid("legacy preference record is invalid"));
    }
    Ok(Value::Object(source.clone()))
}

fn sanitized_array(
    value: &Value,
    predicate: fn(&Value) -> bool,
) -> Result<Value, NormalizedSqliteError> {
    let source = value
        .as_array()
        .ok_or_else(|| invalid("legacy preference array is invalid"))?;
    if source.len() > 256 || source.iter().any(|entry| !predicate(entry)) {
        return Err(invalid("legacy preference array is invalid"));
    }
    Ok(Value::Array(source.clone()))
}

fn is_string(value: &Value) -> bool {
    value.as_str().is_some_and(|value| value.len() <= 8_192)
}

fn is_number(value: &Value) -> bool {
    value.as_i64().is_some() || value.as_u64().is_some() || value.as_f64().is_some()
}

fn is_true(value: &Value) -> bool {
    value == &Value::Bool(true)
}

fn sanitize_preference_nested(
    policy_name: &str,
    field: &str,
    value: &Value,
) -> Result<Option<Value>, NormalizedSqliteError> {
    let sanitized = match (policy_name, field) {
        ("user", "weights") => sanitize_preference_object("weights", value)?,
        ("user", "ulysses") => sanitize_preference_object("ulysses", value)?,
        ("user", "display") => sanitize_preference_object("display", value)?,
        ("user", "xCapture") => sanitize_preference_object("xCapture", value)?,
        ("user", "fbCapture") => sanitize_preference_object("facebookCapture", value)?,
        ("user", "friendSuggestions") => sanitize_preference_object("friendSuggestions", value)?,
        ("user", "ai") => sanitize_preference_object("ai", value)?,
        ("user", "storyWall") => sanitize_preference_object("storyWall", value)?,
        ("weights", "platforms" | "topics" | "authors") => sanitized_scalar_map(value, is_number)?,
        ("ulysses", "blockedPlatforms") => sanitized_array(value, is_string)?,
        ("ulysses", "allowedPaths") => {
            let source = value
                .as_object()
                .ok_or_else(|| invalid("legacy Ulysses path preferences are invalid"))?;
            if source.len() > 256 {
                return Err(invalid("legacy Ulysses path preferences are invalid"));
            }
            Value::Object(
                source
                    .iter()
                    .map(|(key, entry)| Ok((key.clone(), sanitized_array(entry, is_string)?)))
                    .collect::<Result<_, NormalizedSqliteError>>()?,
            )
        }
        ("display", "reading") => sanitize_preference_object("reading", value)?,
        ("xCapture", "whitelist" | "blacklist") => {
            let source = value
                .as_object()
                .ok_or_else(|| invalid("legacy X account preference map is invalid"))?;
            if source.len() > 256 {
                return Err(invalid("legacy X account preference map is invalid"));
            }
            Value::Object(
                source
                    .iter()
                    .map(|(key, entry)| {
                        Ok((key.clone(), sanitize_preference_object("xAccount", entry)?))
                    })
                    .collect::<Result<_, NormalizedSqliteError>>()?,
            )
        }
        ("facebookCapture", "excludedGroupIds") => sanitized_scalar_map(value, is_true)?,
        ("friendSuggestions", "dismissedSuggestionIds") => sanitized_array(value, is_string)?,
        ("storyWall", "selectedYears") => sanitized_array(value, is_number)?,
        (
            "storyWall",
            "includedPlatforms" | "includedAccountIds" | "featuredItemIds" | "hiddenItemIds",
        ) => sanitized_array(value, is_string)?,
        ("storyWall", "style") => sanitize_preference_object("storyWallStyle", value)?,
        ("storyWall", "publishTarget") => {
            sanitize_preference_object("storyWallPublishTarget", value)?
        }
        _ => return Err(invalid("generated nested preference policy is unsupported")),
    };
    if sanitized
        .as_object()
        .is_some_and(|object| object.is_empty())
    {
        Ok(None)
    } else {
        Ok(Some(sanitized))
    }
}

fn sanitize_preference_object(
    policy_name: &str,
    value: &Value,
) -> Result<Value, NormalizedSqliteError> {
    let source = value
        .as_object()
        .ok_or_else(|| invalid("legacy preferences are invalid"))?;
    let mut result = serde_json::Map::new();
    for (field, disposition) in policy(policy_name) {
        let Some(value) = source.get(field) else {
            continue;
        };
        match disposition.as_str() {
            Some("sync") => {
                result.insert(field.clone(), value.clone());
            }
            Some("nested") => {
                if let Some(value) = sanitize_preference_nested(policy_name, field, value)? {
                    result.insert(field.clone(), value);
                }
            }
            Some("device-local") => {}
            _ => return Err(invalid("generated preference disposition is invalid")),
        }
    }
    Ok(Value::Object(result))
}

fn migrate_legacy_preferences_v1(
    transaction: &Transaction<'_>,
    preferences: &Value,
    updated_at: i64,
) -> Result<(), NormalizedSqliteError> {
    let sanitized = sanitize_preference_object("user", preferences)?;
    let encoded = serde_json::to_string(&sanitized)
        .map_err(|_| invalid("legacy preferences cannot be normalized"))?;
    let bounds: (i64, i64, i64) = transaction.query_row(
        "SELECT count(*),
                COALESCE(max(length(CAST(fullkey AS BLOB))), 0),
                COALESCE(max(CASE type WHEN 'text' THEN length(CAST(atom AS BLOB)) ELSE 0 END), 0)
         FROM json_tree(?1) WHERE fullkey <> '$';",
        [&encoded],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if bounds.0 > MAXIMUM_PREFERENCE_NODES
        || bounds.1 > MAXIMUM_PREFERENCE_PATH_BYTES
        || bounds.2 > MAXIMUM_PREFERENCE_TEXT_BYTES
    {
        return Err(invalid(
            "legacy synchronized preferences exceed their bounds",
        ));
    }
    let program = mutation_program("preferences_leaf_assignment")?;
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, [&encoded])?;
    }
    transaction.execute(program.materialize_sql, params![encoded, updated_at])?;
    Ok(())
}

fn legacy_reach_out_id(
    person_id: &str,
    ordinal: usize,
    value: &Value,
) -> Result<String, NormalizedSqliteError> {
    let canonical = encode_canonical_value(value, INLINE_CONTENT_MAXIMUM_BYTES)
        .map_err(|_| invalid("legacy reach-out entry cannot be canonicalized"))?;
    let mut digest = Sha256::new();
    digest.update(LEGACY_REACH_OUT_DIGEST_PREFIX);
    digest.update(person_id.as_bytes());
    digest.update([0]);
    digest.update(ordinal.to_be_bytes());
    digest.update(canonical);
    Ok(lower_hex(&digest.finalize()))
}

/// Decomposes the historical shell into final normalized product tables. The
/// caller owns the single cutover transaction and source fence. This function
/// does not retain, hash, or copy the shell itself.
fn migrate_legacy_shell_v1(
    transaction: &Transaction<'_>,
    shell_json: &str,
    updated_at: i64,
) -> Result<LegacyShellCountsV1, NormalizedSqliteError> {
    if updated_at < 0 {
        return Err(invalid("legacy Library shell time is invalid"));
    }
    let shell: Value = serde_json::from_str(shell_json)
        .map_err(|_| invalid("legacy Library shell JSON is invalid"))?;
    let shell = shell
        .as_object()
        .ok_or_else(|| invalid("legacy Library shell is not an object"))?;

    let mut counts = LegacyShellCountsV1::default();
    if let Some(feeds) = legacy_map(shell, "feeds")? {
        for (url, feed) in feeds {
            if feed.get("url").and_then(Value::as_str) != Some(url) {
                return Err(invalid("legacy RSS feed identity does not match its key"));
            }
            materialize_json_entity(transaction, "rss_feed_upsert", url, feed, updated_at)?;
            counts.rss_feeds += 1;
        }
    }
    if let Some(persons) = legacy_map(shell, "persons")? {
        for (person_id, person) in persons {
            if person.get("id").and_then(Value::as_str) != Some(person_id) {
                return Err(invalid("legacy Person identity does not match its key"));
            }
            materialize_json_entity(transaction, "person_upsert", person_id, person, updated_at)?;
            counts.persons += 1;
            for (ordinal, reach_out) in bounded_array(
                person.get("reachOutLog"),
                MAXIMUM_REACH_OUTS,
                "legacy Person reach-out history exceeds its bound",
            )?
            .iter()
            .enumerate()
            {
                let reach_out = reach_out
                    .as_object()
                    .ok_or_else(|| invalid("legacy Person reach-out entry is invalid"))?;
                let reach_out_value = Value::Object(reach_out.clone());
                let reach_out_id = legacy_reach_out_id(person_id, ordinal, &reach_out_value)?;
                let logged_at = reach_out
                    .get("loggedAt")
                    .and_then(Value::as_i64)
                    .filter(|value| *value >= 0)
                    .ok_or_else(|| invalid("legacy Person reach-out time is invalid"))?;
                let channel = reach_out.get("channel").and_then(Value::as_str);
                if channel.is_some_and(|value| value.is_empty() || value.len() > 255) {
                    return Err(invalid("legacy Person reach-out channel is invalid"));
                }
                let notes = reach_out.get("notes").and_then(Value::as_str);
                if notes.is_some_and(|value| value.len() > INLINE_CONTENT_MAXIMUM_BYTES) {
                    return Err(invalid("legacy Person reach-out notes exceed their bound"));
                }
                transaction.execute(
                    mutation_program("person_reach_out_append")?.materialize_sql,
                    params![person_id, reach_out_id, logged_at, channel, notes],
                )?;
                counts.reach_outs += 1;
            }
        }
    }
    if let Some(accounts) = legacy_map(shell, "accounts")? {
        for (account_id, account) in accounts {
            if account.get("id").and_then(Value::as_str) != Some(account_id) {
                return Err(invalid("legacy Account identity does not match its key"));
            }
            materialize_json_entity(
                transaction,
                "account_upsert",
                account_id,
                account,
                updated_at,
            )?;
            counts.accounts += 1;
        }
    }
    if let Some(preferences) = shell.get("preferences").filter(|value| !value.is_null()) {
        migrate_legacy_preferences_v1(transaction, preferences, updated_at)?;
    }
    if legacy_map(shell, "friends")?.is_some_and(|friends| !friends.is_empty())
        && counts.persons == 0
        && counts.accounts == 0
    {
        return Err(invalid(
            "legacy Friend rows have no normalized Person or Account source",
        ));
    }
    Ok(counts)
}

fn unsigned_count(value: i64, label: &'static str) -> Result<u64, NormalizedSqliteError> {
    u64::try_from(value).map_err(|_| invalid(label))
}

fn normalized_product_digest(
    target: &Transaction<'_>,
    require_empty_authority: bool,
) -> Result<(String, u64, u64), NormalizedSqliteError> {
    let mut request = NormalizedCheckpointExportRequestV2::default();
    let mut accumulator = NormalizedCheckpointDigestAccumulatorV2::new();
    loop {
        let page = export_normalized_checkpoint_page_v2(target, &request)?;
        if page.records.is_empty() && !page.done {
            return Err(invalid("normalized migration export did not advance"));
        }
        for record in &page.records {
            if record.registry_key.as_str() < "10_feed_item" {
                if require_empty_authority {
                    return Err(invalid(
                        "normalized migration candidate contains authority records",
                    ));
                }
                continue;
            }
            if matches!(
                record.registry_key.as_str(),
                "90_actor_state"
                    | "91_actor_capability"
                    | "92_actor_capability_mutation"
                    | "a0_receipt"
            ) {
                continue;
            }
            accumulator.push(record)?;
        }
        if page.done {
            break;
        }
        request.after = page.next_cursor;
    }
    Ok(accumulator.finish())
}

fn legacy_source_frontier_digest(
    source: &Transaction<'_>,
    library_id: &str,
    epoch_id: &str,
) -> Result<(String, u64), NormalizedSqliteError> {
    let mut digest = Sha256::new();
    digest.update(LEGACY_FRONTIER_DIGEST_PREFIX);
    let mut statement = source.prepare(
        "SELECT tipIndex, actorId, sequence, operationId, chainDigest
         FROM library_core_authority_frontier
         WHERE libraryId = ?1 AND epochId = ?2
         ORDER BY tipIndex;",
    )?;
    let mut rows = statement.query(params![library_id, epoch_id])?;
    let mut count = 0_usize;
    while let Some(row) = rows.next()? {
        let tip_index: i64 = row.get(0)?;
        let actor_id: String = row.get(1)?;
        let sequence: i64 = row.get(2)?;
        let operation_id: String = row.get(3)?;
        let chain_digest: String = row.get(4)?;
        if tip_index != i64::try_from(count).map_err(|_| invalid("legacy frontier is invalid"))?
            || !valid_sha256(&actor_id)
            || sequence < 1
            || !valid_operation_id(&operation_id)
            || !valid_sha256(&chain_digest)
        {
            return Err(invalid("legacy frontier is invalid"));
        }
        count += 1;
        if count > MAXIMUM_SOURCE_FRONTIER_TIPS {
            return Err(invalid("legacy frontier exceeds its bound"));
        }
        let canonical = encode_canonical_value(
            &serde_json::json!({
                "actorId": actor_id,
                "chainDigest": chain_digest,
                "operationId": operation_id,
                "sequence": sequence,
                "tipIndex": tip_index
            }),
            16_384,
        )
        .map_err(|_| invalid("legacy frontier is invalid"))?;
        digest.update(
            u64::try_from(canonical.len())
                .map_err(|_| invalid("legacy frontier is invalid"))?
                .to_be_bytes(),
        );
        digest.update(canonical);
    }
    Ok((
        lower_hex(&digest.finalize()),
        u64::try_from(count).map_err(|_| invalid("legacy frontier is invalid"))?,
    ))
}

/// Builds one inert final-schema candidate from one immutable read snapshot of
/// the historical database. The returned receipt binds typed source authority
/// and normalized output only. It does not activate the candidate, select a
/// writer, sign a transition, hash the source shell, or modify the source.
fn migrate_legacy_snapshot_v1(
    source: &mut Connection,
    target: &mut Connection,
) -> Result<NormalizedMigrationCandidateReceiptV1, NormalizedSqliteError> {
    install_normalized_schema_v1(target)?;
    let existing_records: i64 = target.query_row(
        "SELECT count(*) FROM library_checkpoint_export;",
        [],
        |row| row.get(0),
    )?;
    if existing_records != 0 {
        return Err(invalid("normalized migration target is not empty"));
    }

    let source = source.transaction()?;
    let (
        active,
        source_sqlite_revision,
        source_generation,
        source_revision,
        source_document_digest,
        expected_item_count,
        imported_item_count,
        shell_json,
        activated_at,
    ): (i64, i64, i64, i64, String, i64, i64, String, Option<i64>) = source.query_row(
        "SELECT active, revision, sourceGeneration, sourceRevision, sourceDigest,
                expectedItemCount, importedItemCount, shellJson, activatedAtMs
         FROM library_core_desktop_state WHERE singletonId = 1;",
        [],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ))
        },
    )?;
    if active != 1 || activated_at.is_none() || expected_item_count != imported_item_count {
        return Err(invalid("legacy Library source is not fully active"));
    }
    let (
        library_id,
        source_epoch,
        source_epoch_id,
        source_transition_certificate_digest,
        source_authority_key_id,
        source_authority_public_key,
    ): (String, i64, String, String, String, String) = source.query_row(
        "SELECT active.libraryId, active.epoch, active.epochId,
                active.transitionCertificateDigest, epoch.authorityKeyId,
                epoch.authorityPublicKey
         FROM library_core_active_authority AS active
         JOIN library_core_authority_epochs AS epoch
           ON epoch.libraryId = active.libraryId
          AND epoch.epoch = active.epoch
          AND epoch.epochId = active.epochId
          AND epoch.transitionCertificateDigest = active.transitionCertificateDigest;",
        [],
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
    )?;
    if !valid_sha256(&library_id)
        || source_epoch < 1
        || !valid_sha256(&source_epoch_id)
        || !valid_sha256(&source_transition_certificate_digest)
        || !valid_sha256(&source_authority_key_id)
        || !valid_sha256(&source_authority_public_key)
        || !valid_sha256(&source_document_digest)
    {
        return Err(invalid("legacy Library authority identity is invalid"));
    }
    let (source_frontier_digest, source_frontier_count) =
        legacy_source_frontier_digest(&source, &library_id, &source_epoch_id)?;
    let (live_feed_items, deleted_feed_items): (i64, i64) = source.query_row(
        "SELECT
            count(*) FILTER (WHERE deletedAt IS NULL),
            count(*) FILTER (WHERE deletedAt IS NOT NULL)
         FROM library_core_feed_items;",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let target_transaction = target.transaction()?;
    let shell_counts = migrate_legacy_shell_v1(
        &target_transaction,
        &shell_json,
        activated_at.unwrap_or(source_sqlite_revision),
    )?;
    let migrated_items = {
        let mut statement = source.prepare(
            "SELECT globalId, payloadJson, updatedAtMs
             FROM library_core_feed_items
             WHERE deletedAt IS NULL ORDER BY globalId COLLATE BINARY;",
        )?;
        let mut rows = statement.query([])?;
        let mut migrated = 0_u64;
        while let Some(row) = rows.next()? {
            let global_id: String = row.get(0)?;
            let payload_json: String = row.get(1)?;
            let updated_at: i64 = row.get(2)?;
            migrate_legacy_feed_item_v1(
                &target_transaction,
                &global_id,
                &payload_json,
                updated_at,
            )?;
            migrated = migrated
                .checked_add(1)
                .ok_or_else(|| invalid("legacy FeedItem count is invalid"))?;
        }
        migrated
    };
    if migrated_items != unsigned_count(live_feed_items, "legacy FeedItem count is invalid")? {
        return Err(invalid("legacy FeedItem migration count is incomplete"));
    }

    let target_counts: (i64, i64, i64, i64, i64) = target_transaction.query_row(
        "SELECT
            (SELECT count(*) FROM library_feed_items),
            (SELECT count(*) FROM library_rss_feeds),
            (SELECT count(*) FROM library_persons),
            (SELECT count(*) FROM library_accounts),
            (SELECT count(*) FROM library_person_reach_outs);",
        [],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )?;
    let expected_counts = (
        migrated_items,
        shell_counts.rss_feeds,
        shell_counts.persons,
        shell_counts.accounts,
        shell_counts.reach_outs,
    );
    let actual_counts = (
        unsigned_count(target_counts.0, "normalized FeedItem count is invalid")?,
        unsigned_count(target_counts.1, "normalized RSS feed count is invalid")?,
        unsigned_count(target_counts.2, "normalized Person count is invalid")?,
        unsigned_count(target_counts.3, "normalized Account count is invalid")?,
        unsigned_count(target_counts.4, "normalized reach-out count is invalid")?,
    );
    if actual_counts != expected_counts {
        return Err(invalid("normalized migration root count is incomplete"));
    }
    let foreign_key_violation: Option<String> = target_transaction
        .query_row(
            "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1;",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(invalid("normalized migration foreign key closure failed"));
    }
    let (normalized_product_digest, normalized_record_count, normalized_canonical_bytes) =
        normalized_product_digest(&target_transaction, true)?;

    let receipt = NormalizedMigrationCandidateReceiptV1 {
        format: "freed_normalized_migration_candidate_v1".to_owned(),
        library_id,
        source_epoch: unsigned_count(source_epoch, "legacy source epoch is invalid")?,
        source_epoch_id,
        source_transition_certificate_digest,
        source_authority_key_id,
        source_authority_public_key,
        source_document_digest,
        source_frontier_count,
        source_frontier_digest,
        source_generation: unsigned_count(
            source_generation,
            "legacy source generation is invalid",
        )?,
        source_revision: unsigned_count(source_revision, "legacy source revision is invalid")?,
        source_sqlite_revision: unsigned_count(
            source_sqlite_revision,
            "legacy source SQLite revision is invalid",
        )?,
        live_feed_items: migrated_items,
        excluded_deleted_feed_items: unsigned_count(
            deleted_feed_items,
            "legacy deleted FeedItem count is invalid",
        )?,
        rss_feeds: shell_counts.rss_feeds,
        persons: shell_counts.persons,
        accounts: shell_counts.accounts,
        reach_outs: shell_counts.reach_outs,
        normalized_record_count,
        normalized_canonical_bytes,
        normalized_product_digest,
    };
    let (candidate_json, candidate_digest) = canonical_migration_candidate_v1(&receipt)?;
    target_transaction.execute(
        "INSERT INTO library_storage_transition_plan
         (singleton_id, candidate_json, candidate_digest,
          installation_witness, accepted_at, state, updated_at)
         VALUES (1, ?1, ?2, NULL, NULL, 'candidate', ?3);",
        params![
            candidate_json,
            candidate_digest,
            i64::try_from(receipt.source_sqlite_revision)
                .map_err(|_| invalid("legacy source SQLite revision is invalid"))?,
        ],
    )?;
    target_transaction.commit()?;
    source.commit()?;
    Ok(receipt)
}

/// Installs signed normalized authority into the inert candidate after
/// re-reading the exact old authority fence. This makes the target internally
/// complete, but does not select its file or retire the old writer. The host
/// performs that separate compare-and-swap while holding its writer barrier.
fn install_normalized_candidate_authority_v1(
    source: &mut Connection,
    target: &mut Connection,
    candidate: &NormalizedMigrationCandidateReceiptV1,
    signed: &SignedNormalizedStorageTransitionV1,
) -> Result<(), NormalizedSqliteError> {
    let certificate = verify_normalized_storage_transition_v1(candidate, signed)?;
    let source = source.transaction()?;
    let state: (i64, i64, i64, i64, String, i64, i64, Option<i64>) = source.query_row(
        "SELECT active, revision, sourceGeneration, sourceRevision, sourceDigest,
                expectedItemCount, importedItemCount, activatedAtMs
         FROM library_core_desktop_state WHERE singletonId = 1;",
        [],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        },
    )?;
    if state.0 != 1
        || state.7.is_none()
        || state.5 != state.6
        || unsigned_count(state.1, "legacy source SQLite revision is invalid")?
            != candidate.source_sqlite_revision
        || unsigned_count(state.2, "legacy source generation is invalid")?
            != candidate.source_generation
        || unsigned_count(state.3, "legacy source revision is invalid")?
            != candidate.source_revision
        || state.4 != candidate.source_document_digest
    {
        return Err(invalid("legacy Library source fence changed"));
    }
    let authority: (String, i64, String, String, String, String) = source.query_row(
        "SELECT active.libraryId, active.epoch, active.epochId,
                active.transitionCertificateDigest, epoch.authorityKeyId,
                epoch.authorityPublicKey
         FROM library_core_active_authority AS active
         JOIN library_core_authority_epochs AS epoch
           ON epoch.libraryId = active.libraryId
          AND epoch.epoch = active.epoch
          AND epoch.epochId = active.epochId
          AND epoch.transitionCertificateDigest = active.transitionCertificateDigest;",
        [],
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
    )?;
    if authority.0 != candidate.library_id
        || unsigned_count(authority.1, "legacy source epoch is invalid")? != candidate.source_epoch
        || authority.2 != candidate.source_epoch_id
        || authority.3 != candidate.source_transition_certificate_digest
        || authority.4 != candidate.source_authority_key_id
        || authority.5 != candidate.source_authority_public_key
    {
        return Err(invalid("legacy Library authority fence changed"));
    }
    let (source_frontier_digest, source_frontier_count) =
        legacy_source_frontier_digest(&source, &candidate.library_id, &candidate.source_epoch_id)?;
    if source_frontier_digest != candidate.source_frontier_digest
        || source_frontier_count != candidate.source_frontier_count
    {
        return Err(invalid("legacy Library frontier fence changed"));
    }
    let source_counts: (i64, i64) = source.query_row(
        "SELECT count(*) FILTER (WHERE deletedAt IS NULL),
                count(*) FILTER (WHERE deletedAt IS NOT NULL)
         FROM library_core_feed_items;",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if unsigned_count(source_counts.0, "legacy FeedItem count is invalid")?
        != candidate.live_feed_items
        || unsigned_count(source_counts.1, "legacy deleted FeedItem count is invalid")?
            != candidate.excluded_deleted_feed_items
    {
        return Err(invalid("legacy Library item fence changed"));
    }

    let target = target.transaction()?;
    let (product_digest, product_records, product_bytes) =
        normalized_product_digest(&target, false)?;
    if product_digest != candidate.normalized_product_digest
        || product_records != candidate.normalized_record_count
        || product_bytes != candidate.normalized_canonical_bytes
    {
        return Err(invalid("normalized migration candidate changed"));
    }
    let authority_rows: i64 = target.query_row(
        "SELECT (SELECT count(*) FROM library_meta)
              + (SELECT count(*) FROM library_materialization_generation)
              + (SELECT count(*) FROM library_authority_epochs)
              + (SELECT count(*) FROM library_authority_frontier)
              + (SELECT count(*) FROM library_active_authority)
              + (SELECT count(*) FROM library_writer_admission);",
        [],
        |row| row.get(0),
    )?;
    if authority_rows != 0 {
        let matching_authority: i64 = target.query_row(
            "SELECT count(*)
             FROM library_authority_epochs AS epoch
             JOIN library_active_authority AS active
               ON active.active_key = 'active' AND active.epoch_id = epoch.epoch_id
             JOIN library_writer_admission AS admission ON admission.singleton_id = 1
             JOIN library_meta AS meta ON meta.singleton_id = 1
             JOIN library_materialization_generation AS generation ON generation.singleton_id = 1
             WHERE epoch.epoch_id = ?1
               AND epoch.library_id = ?2
               AND epoch.transition_certificate_digest = ?3
               AND epoch.canonical_transition_certificate = ?4
               AND epoch.materialized_state_digest = ?5
               AND active.library_id = epoch.library_id
               AND active.writer_id = ?6
               AND admission.local_writer_id = active.writer_id
               AND admission.active_writer_id = active.writer_id
               AND meta.library_id = epoch.library_id
               AND meta.authority_epoch = epoch.epoch_id
               AND generation.generation_id = epoch.materialized_state_digest;",
            params![
                signed.epoch_id,
                candidate.library_id,
                signed.transition_certificate_digest,
                signed.canonical_transition_certificate,
                candidate.normalized_product_digest,
                certificate.certificate_body.writer_id,
            ],
            |row| row.get(0),
        )?;
        let frontier_rows: i64 = target.query_row(
            "SELECT count(*) FROM library_authority_frontier WHERE epoch_id = ?1;",
            [&signed.epoch_id],
            |row| row.get(0),
        )?;
        if matching_authority != 1
            || unsigned_count(frontier_rows, "normalized authority frontier is invalid")?
                != candidate.source_frontier_count
            || authority_rows
                != frontier_rows
                    .checked_add(5)
                    .ok_or_else(|| invalid("normalized authority row count is invalid"))?
        {
            return Err(invalid("normalized migration authority changed"));
        }
        target.commit()?;
        source.commit()?;
        return Ok(());
    }
    let body = &certificate.certificate_body;
    target.execute(
        "INSERT INTO library_authority_epochs
         (epoch_id, library_id, epoch_number, authority_key_id,
          authority_public_key, transition_certificate_digest,
          canonical_transition_certificate, accepted_manifest_generation,
          checkpoint_frontier_digest, materialized_state_digest, accepted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10);",
        params![
            signed.epoch_id,
            candidate.library_id,
            i64::try_from(body.epoch_number)
                .map_err(|_| invalid("normalized storage epoch is invalid"))?,
            signed.authority_key_id,
            signed.authority_public_key,
            signed.transition_certificate_digest,
            signed.canonical_transition_certificate,
            candidate.source_frontier_digest,
            candidate.normalized_product_digest,
            i64::try_from(body.accepted_at)
                .map_err(|_| invalid("normalized transition time is invalid"))?,
        ],
    )?;
    let mut frontier = source.prepare(
        "SELECT tipIndex, actorId, sequence, operationId, chainDigest
         FROM library_core_authority_frontier
         WHERE libraryId = ?1 AND epochId = ?2 ORDER BY tipIndex;",
    )?;
    let mut rows = frontier.query(params![candidate.library_id, candidate.source_epoch_id])?;
    let mut inserted_frontier = 0_u64;
    while let Some(row) = rows.next()? {
        target.execute(
            "INSERT INTO library_authority_frontier
             (epoch_id, ordinal, actor_id, accepted_counter,
              accepted_operation_id, accepted_chain_digest)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            params![
                signed.epoch_id,
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ],
        )?;
        inserted_frontier += 1;
    }
    drop(rows);
    drop(frontier);
    if inserted_frontier != candidate.source_frontier_count {
        return Err(invalid("normalized authority frontier is incomplete"));
    }
    target.execute(
        "INSERT INTO library_active_authority
         (active_key, library_id, epoch_id, writer_id,
          accepted_manifest_generation, activated_at)
         VALUES ('active', ?1, ?2, ?3, 0, ?4);",
        params![
            candidate.library_id,
            signed.epoch_id,
            body.writer_id,
            i64::try_from(body.accepted_at)
                .map_err(|_| invalid("normalized transition time is invalid"))?,
        ],
    )?;
    target.execute(
        "INSERT INTO library_writer_admission
         (singleton_id, local_writer_id, active_writer_id,
          observed_manifest_generation, observed_at)
         VALUES (1, ?1, ?1, 0, ?2);",
        params![
            body.writer_id,
            i64::try_from(body.accepted_at)
                .map_err(|_| invalid("normalized transition time is invalid"))?,
        ],
    )?;
    target.execute(
        "INSERT INTO library_meta
         (singleton_id, library_id, schema_version, authority_epoch,
          source_revision, updated_at)
         VALUES (1, ?1, ?2, ?3, 0, ?4);",
        params![
            candidate.library_id,
            i64::from(SQLITE_SCHEMA_VERSION),
            signed.epoch_id,
            i64::try_from(body.accepted_at)
                .map_err(|_| invalid("normalized transition time is invalid"))?,
        ],
    )?;
    target.execute(
        "INSERT INTO library_materialization_generation
         (singleton_id, generation_id) VALUES (1, ?1);",
        [&candidate.normalized_product_digest],
    )?;
    let foreign_key_violation: Option<String> = target
        .query_row(
            "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1;",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(invalid("normalized authority foreign key closure failed"));
    }
    target.commit()?;
    source.commit()?;
    Ok(())
}

fn install_normalized_primary_actor_v2(
    target: &mut Connection,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    created_at: i64,
) -> Result<String, NormalizedSqliteError> {
    if !valid_sha256(installation_witness) || created_at < 0 {
        return Err(invalid("normalized Primary actor request is invalid"));
    }
    let transaction = target.transaction()?;
    let (library_id, epoch, epoch_id, authority_key_id, authority_public_key): (
        String,
        i64,
        String,
        String,
        String,
    ) = transaction.query_row(
        "SELECT epoch.library_id, epoch.epoch_number, epoch.epoch_id,
                epoch.authority_key_id, epoch.authority_public_key
         FROM library_active_authority AS active
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         JOIN library_writer_admission AS admission ON admission.singleton_id = 1
         WHERE active.active_key = 'active'
           AND admission.local_writer_id = admission.active_writer_id
           AND admission.active_writer_id = active.writer_id
           AND admission.observed_manifest_generation = active.accepted_manifest_generation;",
        [],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )?;
    let mut statement = transaction.prepare(
        "SELECT actor_id, accepted_counter, accepted_operation_id, accepted_chain_digest
         FROM library_authority_frontier WHERE epoch_id = ?1 ORDER BY ordinal;",
    )?;
    let observed_frontier = statement
        .query_map([&epoch_id], |row| {
            Ok(NormalizedCausalTipV1 {
                actor_id: row.get(0)?,
                sequence: row.get(1)?,
                operation_id: row.get(2)?,
                chain_digest: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let authority = NormalizedAuthorityStateV2 {
        library_id,
        epoch,
        epoch_id: epoch_id.clone(),
        authority_key_id,
        authority_public_key,
        observed_frontier,
    };
    let enrollment = prepare_normalized_primary_actor_enrollment_v2(
        &authority,
        installation_witness,
        actor_store,
        authority_store,
        created_at,
    )
    .map_err(|_| invalid("normalized Primary actor enrollment failed"))?;
    if enrollment.library_id != authority.library_id
        || enrollment.epoch != authority.epoch
        || enrollment.epoch_id != authority.epoch_id
        || enrollment.capability.certificate_version != 2
        || enrollment.capability.actor_class != "editor"
        || enrollment.capability.retired
    {
        return Err(invalid("normalized Primary actor enrollment is invalid"));
    }
    let (scope_mode, scope_kind, scope_id) = match &enrollment.capability.scope {
        ActorCapabilityScope::LibraryWide => {
            ("library_wide", Option::<&str>::None, Option::<&str>::None)
        }
        _ => return Err(invalid("normalized Primary actor scope is invalid")),
    };
    let actor_rows: i64 = transaction.query_row(
        "SELECT count(*) FROM library_actors WHERE authority_epoch_id = ?1;",
        [&epoch_id],
        |row| row.get(0),
    )?;
    if actor_rows != 0 {
        let matching_actor: i64 = transaction.query_row(
            "SELECT count(*) FROM library_actors
             WHERE authority_epoch_id = ?1
               AND actor_id = ?2
               AND actor_kind = 'desktop'
               AND public_key = ?3
               AND enrollment_operation_id = ?4
               AND enrollment_certificate_digest = ?5
               AND canonical_enrollment_certificate = ?6
               AND chain_genesis_digest = ?7
               AND accepted_counter = 0
               AND accepted_operation_id IS NULL
               AND accepted_chain_digest = ?7
               AND created_at = ?8
               AND updated_at = ?8
               AND retired_at IS NULL;",
            params![
                enrollment.epoch_id,
                enrollment.actor_id,
                enrollment.actor_public_key,
                enrollment.enrollment_operation_id,
                enrollment.enrollment_certificate_digest,
                enrollment.canonical_enrollment_certificate_json,
                enrollment.actor_chain_genesis,
                enrollment.enrolled_at_ms,
            ],
            |row| row.get(0),
        )?;
        let matching_capability: i64 = transaction.query_row(
            "SELECT count(*) FROM library_actor_capabilities
             WHERE capability_id = ?1
               AND actor_id = ?2
               AND certificate_version = ?3
               AND actor_class = ?4
               AND scope_mode = ?5
               AND scope_kind IS ?6
               AND scope_id IS ?7
               AND issuance_identity IS ?8
               AND retirement_identity IS ?9
               AND certificate_digest = ?1
               AND canonical_certificate = ?10
               AND issued_at = ?11
               AND retired_at IS NULL
               AND retirement_certificate_digest IS NULL;",
            params![
                enrollment.capability.capability_certificate_digest,
                enrollment.actor_id,
                enrollment.capability.certificate_version,
                enrollment.capability.actor_class,
                scope_mode,
                scope_kind,
                scope_id,
                enrollment.capability.issuance_identity,
                enrollment.capability.retirement_identity,
                enrollment.canonical_enrollment_certificate_json,
                enrollment.capability.issued_at_ms,
            ],
            |row| row.get(0),
        )?;
        let stored_mutations: i64 = transaction.query_row(
            "SELECT count(*) FROM library_actor_capability_mutations
             WHERE capability_id = ?1;",
            [&enrollment.capability.capability_certificate_digest],
            |row| row.get(0),
        )?;
        let stored_queries: i64 = transaction.query_row(
            "SELECT count(*) FROM library_actor_capability_queries
             WHERE capability_id = ?1;",
            [&enrollment.capability.capability_certificate_digest],
            |row| row.get(0),
        )?;
        let mut matching_mutations = 0_i64;
        for mutation_id in &enrollment.capability.allowed_operation_types {
            matching_mutations += transaction.query_row(
                "SELECT count(*) FROM library_actor_capability_mutations
                 WHERE capability_id = ?1 AND mutation_id = ?2;",
                params![
                    enrollment.capability.capability_certificate_digest,
                    mutation_id
                ],
                |row| row.get::<_, i64>(0),
            )?;
        }
        let mut matching_queries = 0_i64;
        for query_id in &enrollment.capability.allowed_query_ids {
            matching_queries += transaction.query_row(
                "SELECT count(*) FROM library_actor_capability_queries
                 WHERE capability_id = ?1 AND query_id = ?2;",
                params![
                    enrollment.capability.capability_certificate_digest,
                    query_id
                ],
                |row| row.get::<_, i64>(0),
            )?;
        }
        if actor_rows != 1
            || matching_actor != 1
            || matching_capability != 1
            || stored_mutations
                != i64::try_from(enrollment.capability.allowed_operation_types.len())
                    .map_err(|_| invalid("normalized Primary actor capability is invalid"))?
            || matching_mutations != stored_mutations
            || stored_queries
                != i64::try_from(enrollment.capability.allowed_query_ids.len())
                    .map_err(|_| invalid("normalized Primary actor capability is invalid"))?
            || matching_queries != stored_queries
        {
            return Err(invalid("normalized Primary actor enrollment changed"));
        }
        let actor_id = enrollment.actor_id;
        transaction.commit()?;
        return Ok(actor_id);
    }
    transaction.execute(
        "INSERT INTO library_actors
         (actor_id, authority_epoch_id, actor_kind, public_key,
          enrollment_operation_id, enrollment_certificate_digest,
          canonical_enrollment_certificate, chain_genesis_digest,
          accepted_counter, accepted_operation_id, accepted_chain_digest,
          created_at, updated_at)
         VALUES (?1, ?2, 'desktop', ?3, ?4, ?5, ?6, ?7, 0, NULL, ?7, ?8, ?8);",
        params![
            enrollment.actor_id,
            enrollment.epoch_id,
            enrollment.actor_public_key,
            enrollment.enrollment_operation_id,
            enrollment.enrollment_certificate_digest,
            enrollment.canonical_enrollment_certificate_json,
            enrollment.actor_chain_genesis,
            enrollment.enrolled_at_ms,
        ],
    )?;
    transaction.execute(
        "INSERT INTO library_actor_capabilities
         (capability_id, actor_id, certificate_version, actor_class,
          scope_mode, scope_kind, scope_id, issuance_identity,
          retirement_identity, certificate_digest, canonical_certificate,
          issued_at, retired_at, retirement_certificate_digest)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL);",
        params![
            enrollment.capability.capability_certificate_digest,
            enrollment.actor_id,
            enrollment.capability.certificate_version,
            enrollment.capability.actor_class,
            scope_mode,
            scope_kind,
            scope_id,
            enrollment.capability.issuance_identity,
            enrollment.capability.retirement_identity,
            enrollment.capability.capability_certificate_digest,
            enrollment.canonical_enrollment_certificate_json,
            enrollment.capability.issued_at_ms,
        ],
    )?;
    for mutation_id in &enrollment.capability.allowed_operation_types {
        transaction.execute(
            "INSERT INTO library_actor_capability_mutations
             (capability_id, mutation_id) VALUES (?1, ?2);",
            params![
                enrollment.capability.capability_certificate_digest,
                mutation_id
            ],
        )?;
    }
    for query_id in &enrollment.capability.allowed_query_ids {
        transaction.execute(
            "INSERT INTO library_actor_capability_queries
             (capability_id, query_id) VALUES (?1, ?2);",
            params![
                enrollment.capability.capability_certificate_digest,
                query_id
            ],
        )?;
    }
    let actor_id = enrollment.actor_id;
    transaction.commit()?;
    Ok(actor_id)
}

fn bind_normalized_transition_identity_v1(
    target: &mut Connection,
    installation_witness: &str,
    requested_accepted_at: i64,
) -> Result<u64, NormalizedSqliteError> {
    if !valid_sha256(installation_witness) || requested_accepted_at < 0 {
        return Err(invalid("normalized transition identity is invalid"));
    }
    let transaction = target.transaction()?;
    let stored: (Option<String>, Option<i64>, String) = transaction.query_row(
        "SELECT installation_witness, accepted_at, state
         FROM library_storage_transition_plan WHERE singleton_id = 1;",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let accepted_at = match (stored.0, stored.1) {
        (None, None) if stored.2 == "candidate" => {
            transaction.execute(
                "UPDATE library_storage_transition_plan
                 SET installation_witness = ?1, accepted_at = ?2, updated_at = ?2
                 WHERE singleton_id = 1
                   AND installation_witness IS NULL
                   AND accepted_at IS NULL
                   AND state = 'candidate';",
                params![installation_witness, requested_accepted_at],
            )?;
            requested_accepted_at
        }
        (Some(stored_witness), Some(stored_accepted_at))
            if stored_witness == installation_witness =>
        {
            stored_accepted_at
        }
        _ => return Err(invalid("normalized transition identity changed")),
    };
    transaction.commit()?;
    unsigned_count(accepted_at, "normalized transition time is invalid")
}

fn advance_normalized_transition_plan_v1(
    target: &mut Connection,
    candidate: &NormalizedMigrationCandidateReceiptV1,
    installation_witness: &str,
    accepted_at: u64,
    completed_state: &str,
) -> Result<(), NormalizedSqliteError> {
    let allowed_prior = match completed_state {
        "authority_installed" => "candidate",
        "actor_installed" => "authority_installed",
        _ => return Err(invalid("normalized transition state is invalid")),
    };
    let accepted_at =
        i64::try_from(accepted_at).map_err(|_| invalid("normalized transition time is invalid"))?;
    let (_, candidate_digest) = canonical_migration_candidate_v1(candidate)?;
    let transaction = target.transaction()?;
    let stored_state: String = transaction.query_row(
        "SELECT state FROM library_storage_transition_plan
         WHERE singleton_id = 1
           AND candidate_digest = ?1
           AND installation_witness = ?2
           AND accepted_at = ?3;",
        params![candidate_digest, installation_witness, accepted_at],
        |row| row.get(0),
    )?;
    if stored_state == completed_state || stored_state == "actor_installed" {
        transaction.commit()?;
        return Ok(());
    }
    if stored_state != allowed_prior {
        return Err(invalid("normalized transition state changed"));
    }
    let changed = transaction.execute(
        "UPDATE library_storage_transition_plan
         SET state = ?1, updated_at = ?2
         WHERE singleton_id = 1
           AND candidate_digest = ?3
           AND installation_witness = ?4
           AND accepted_at = ?2
           AND state = ?5;",
        params![
            completed_state,
            accepted_at,
            candidate_digest,
            installation_witness,
            allowed_prior,
        ],
    )?;
    if changed != 1 {
        return Err(invalid("normalized transition state did not advance"));
    }
    transaction.commit()?;
    Ok(())
}

pub fn prepare_fresh_normalized_desktop_library_v1(
    target: &mut Connection,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    requested_accepted_at: i64,
) -> Result<NormalizedDesktopAuthorityPreparedV1, NormalizedSqliteError> {
    if !valid_sha256(installation_witness) || requested_accepted_at < 0 {
        return Err(invalid("normalized fresh Library identity is invalid"));
    }
    let inspection = target.transaction()?;
    let (product_digest, product_records, product_bytes) =
        normalized_product_digest(&inspection, false)?;
    let transition_rows: i64 = inspection.query_row(
        "SELECT count(*) FROM library_storage_transition_plan;",
        [],
        |row| row.get(0),
    )?;
    let authority_rows: i64 = inspection.query_row(
        "SELECT (SELECT count(*) FROM library_meta)
              + (SELECT count(*) FROM library_materialization_generation)
              + (SELECT count(*) FROM library_authority_epochs)
              + (SELECT count(*) FROM library_authority_frontier)
              + (SELECT count(*) FROM library_active_authority)
              + (SELECT count(*) FROM library_writer_admission);",
        [],
        |row| row.get(0),
    )?;
    inspection.commit()?;
    if transition_rows != 0 {
        return Err(invalid(
            "normalized fresh Library conflicts with a migration candidate",
        ));
    }
    let library_id = normalized_native_library_id(&product_digest, installation_witness)
        .map_err(|_| invalid("normalized fresh Library identity is invalid"))?;

    let signed = if authority_rows == 0 {
        let key_pair = load_or_create_authority_key_pair(authority_store, &library_id)
            .map_err(|_| invalid("normalized fresh authority key is unavailable"))?;
        let authority_public_key = lower_hex(key_pair.public_key().as_ref());
        let body = NormalizedFreshGenesisBodyV1 {
            format: NORMALIZED_FRESH_GENESIS_FORMAT.to_owned(),
            library_id: library_id.clone(),
            epoch_number: 1,
            writer_id: "primary:desktop".to_owned(),
            authority_key_id: transition_authority_key_id(&authority_public_key)?,
            authority_public_key,
            signature_algorithm: SIGNATURE_ALGORITHM.to_owned(),
            sqlite_contract_version: SQLITE_CONTRACT_VERSION,
            sqlite_schema_version: SQLITE_SCHEMA_VERSION,
            sqlite_protocol_version: SQLITE_PROTOCOL_VERSION,
            normalized_schema_sha256: NORMALIZED_SCHEMA_SHA256.to_owned(),
            checkpoint_format: NORMALIZED_CHECKPOINT_FORMAT.to_owned(),
            normalized_product_digest: product_digest.clone(),
            normalized_record_count: product_records,
            normalized_canonical_bytes: product_bytes,
            accepted_at: unsigned_count(
                requested_accepted_at,
                "normalized fresh Library time is invalid",
            )?,
        };
        let signed = sign_normalized_fresh_genesis_v1(body, authority_store)?;
        let certificate = verify_normalized_fresh_genesis_v1(&signed)?;
        let body = &certificate.certificate_body;
        let frontier_digest = transition_digest("causal-frontier", &serde_json::json!([]))?;
        let transaction = target.transaction()?;
        let (checked_digest, checked_records, checked_bytes) =
            normalized_product_digest(&transaction, true)?;
        if checked_digest != product_digest
            || checked_records != product_records
            || checked_bytes != product_bytes
        {
            return Err(invalid("normalized fresh Library changed before genesis"));
        }
        transaction.execute(
            "INSERT INTO library_authority_epochs
             (epoch_id, library_id, epoch_number, authority_key_id,
              authority_public_key, transition_certificate_digest,
              canonical_transition_certificate, accepted_manifest_generation,
              checkpoint_frontier_digest, materialized_state_digest, accepted_at)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9);",
            params![
                signed.epoch_id,
                body.library_id,
                signed.authority_key_id,
                signed.authority_public_key,
                signed.transition_certificate_digest,
                signed.canonical_transition_certificate,
                frontier_digest,
                body.normalized_product_digest,
                i64::try_from(body.accepted_at)
                    .map_err(|_| invalid("normalized fresh Library time is invalid"))?,
            ],
        )?;
        transaction.execute(
            "INSERT INTO library_active_authority
             (active_key, library_id, epoch_id, writer_id,
              accepted_manifest_generation, activated_at)
             VALUES ('active', ?1, ?2, 'primary:desktop', 0, ?3);",
            params![body.library_id, signed.epoch_id, body.accepted_at],
        )?;
        transaction.execute(
            "INSERT INTO library_writer_admission
             (singleton_id, local_writer_id, active_writer_id,
              observed_manifest_generation, observed_at)
             VALUES (1, 'primary:desktop', 'primary:desktop', 0, ?1);",
            [body.accepted_at],
        )?;
        transaction.execute(
            "INSERT INTO library_meta
             (singleton_id, library_id, schema_version, authority_epoch,
              source_revision, updated_at)
             VALUES (1, ?1, ?2, ?3, 0, ?4);",
            params![
                body.library_id,
                i64::from(SQLITE_SCHEMA_VERSION),
                signed.epoch_id,
                body.accepted_at,
            ],
        )?;
        transaction.execute(
            "INSERT INTO library_materialization_generation
             (singleton_id, generation_id) VALUES (1, ?1);",
            [&body.normalized_product_digest],
        )?;
        let violation: Option<String> = transaction
            .query_row(
                "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1;",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if violation.is_some() {
            return Err(invalid(
                "normalized fresh Library foreign key closure failed",
            ));
        }
        transaction.commit()?;
        signed
    } else {
        if authority_rows != 5 {
            return Err(invalid("normalized fresh Library authority is incomplete"));
        }
        let stored: (String, String, String, String, String, i64, String, i64) = target.query_row(
            "SELECT epoch.epoch_id, epoch.transition_certificate_digest,
                    epoch.canonical_transition_certificate, epoch.authority_key_id,
                    epoch.authority_public_key, epoch.accepted_at,
                    epoch.checkpoint_frontier_digest, meta.source_revision
             FROM library_authority_epochs AS epoch
             JOIN library_active_authority AS active
               ON active.active_key = 'active'
              AND active.library_id = epoch.library_id
              AND active.epoch_id = epoch.epoch_id
              AND active.writer_id = 'primary:desktop'
              AND active.accepted_manifest_generation = 0
              AND active.activated_at = epoch.accepted_at
             JOIN library_writer_admission AS admission
               ON admission.singleton_id = 1
              AND admission.local_writer_id = 'primary:desktop'
              AND admission.active_writer_id = 'primary:desktop'
              AND admission.observed_manifest_generation = 0
              AND admission.observed_at = epoch.accepted_at
             JOIN library_meta AS meta
               ON meta.singleton_id = 1
              AND meta.library_id = epoch.library_id
              AND meta.authority_epoch = epoch.epoch_id
             JOIN library_materialization_generation AS generation
               ON generation.singleton_id = 1
              AND generation.generation_id = epoch.materialized_state_digest
             WHERE epoch.library_id = ?1
               AND epoch.epoch_number = 1
               AND epoch.accepted_manifest_generation = 0
               AND epoch.materialized_state_digest = ?2;",
            params![library_id, product_digest],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )?;
        let signed = SignedNormalizedStorageTransitionV1 {
            epoch_id: stored.0,
            transition_certificate_digest: stored.1,
            canonical_transition_certificate: stored.2,
            authority_key_id: stored.3,
            authority_public_key: stored.4,
        };
        let certificate = verify_normalized_fresh_genesis_v1(&signed)?;
        let body = certificate.certificate_body;
        if body.library_id != library_id
            || body.normalized_product_digest != product_digest
            || body.normalized_record_count != product_records
            || body.normalized_canonical_bytes != product_bytes
            || i64::try_from(body.accepted_at).ok() != Some(stored.5)
            || stored.6 != transition_digest("causal-frontier", &serde_json::json!([]))?
            || stored.7 != 0
            || sign_normalized_fresh_genesis_v1(body, authority_store)? != signed
        {
            return Err(invalid("normalized fresh Library authority changed"));
        }
        signed
    };
    let certificate = verify_normalized_fresh_genesis_v1(&signed)?;
    let accepted_at = certificate.certificate_body.accepted_at;
    let primary_actor_id = install_normalized_primary_actor_v2(
        target,
        installation_witness,
        actor_store,
        authority_store,
        i64::try_from(accepted_at)
            .map_err(|_| invalid("normalized fresh Library time is invalid"))?,
    )?;
    Ok(NormalizedDesktopAuthorityPreparedV1 {
        format: "freed_normalized_desktop_authority_prepared_v1".to_owned(),
        library_id,
        epoch_id: signed.epoch_id,
        transition_certificate_digest: signed.transition_certificate_digest,
        normalized_product_digest: product_digest,
        selected_at: accepted_at,
        primary_actor_id,
    })
}

pub fn prepare_normalized_desktop_cutover_v1(
    source: &mut Connection,
    target: &mut Connection,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    requested_accepted_at: i64,
) -> Result<NormalizedDesktopAuthorityPreparedV1, NormalizedSqliteError> {
    let candidate = match load_normalized_migration_candidate_v1(target)? {
        Some(candidate) => candidate,
        None => migrate_legacy_snapshot_v1(source, target)?,
    };
    let accepted_at = bind_normalized_transition_identity_v1(
        target,
        installation_witness,
        requested_accepted_at,
    )?;
    let transition = sign_normalized_storage_transition_v1(
        &candidate,
        authority_store,
        "primary:desktop",
        accepted_at,
    )?;
    install_normalized_candidate_authority_v1(source, target, &candidate, &transition)?;
    advance_normalized_transition_plan_v1(
        target,
        &candidate,
        installation_witness,
        accepted_at,
        "authority_installed",
    )?;
    let primary_actor_id = install_normalized_primary_actor_v2(
        target,
        installation_witness,
        actor_store,
        authority_store,
        i64::try_from(accepted_at).map_err(|_| invalid("normalized transition time is invalid"))?,
    )?;
    advance_normalized_transition_plan_v1(
        target,
        &candidate,
        installation_witness,
        accepted_at,
        "actor_installed",
    )?;
    Ok(NormalizedDesktopAuthorityPreparedV1 {
        format: "freed_normalized_desktop_authority_prepared_v1".to_owned(),
        library_id: candidate.library_id,
        epoch_id: transition.epoch_id,
        transition_certificate_digest: transition.transition_certificate_digest,
        normalized_product_digest: candidate.normalized_product_digest,
        selected_at: accepted_at,
        primary_actor_id,
    })
}

/// Decomposes one historical FeedItem JSON row into final normalized product
/// tables. This is used only inside the one-epoch migration transaction. It
/// never writes a shell, whole-item JSON row, operation, receipt, or authority
/// record.
pub(crate) fn migrate_legacy_feed_item_v1(
    transaction: &Transaction<'_>,
    global_id: &str,
    payload_json: &str,
    updated_at: i64,
) -> Result<(), NormalizedSqliteError> {
    if global_id.is_empty() || global_id.len() > 2_048 || updated_at < 0 {
        return Err(invalid("legacy FeedItem row identity is invalid"));
    }
    let mut item: Value = serde_json::from_str(payload_json)
        .map_err(|_| invalid("legacy FeedItem JSON is invalid"))?;
    if item.get("globalId").and_then(Value::as_str) != Some(global_id) {
        return Err(invalid("legacy FeedItem identity does not match its row"));
    }

    let content_bytes = take_large_text(object_mut(&mut item, "content")?, "text")?;
    let preserved_bytes = match item.get_mut("preservedContent") {
        None | Some(Value::Null) => None,
        Some(value) => take_large_text(
            value
                .as_object_mut()
                .ok_or_else(|| invalid("legacy preserved content is invalid"))?,
            "text",
        )?,
    };
    let content_digest = content_bytes
        .as_deref()
        .map(|bytes| insert_content_blob(transaction, bytes, "text/plain; charset=utf-8"))
        .transpose()?;
    let preserved_digest = preserved_bytes
        .as_deref()
        .map(|bytes| insert_content_blob(transaction, bytes, "text/plain; charset=utf-8"))
        .transpose()?;

    let program = SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|program| program.mutation_id == "feed_item_capture_upsert")
        .ok_or_else(|| invalid("normalized FeedItem mutation program is missing"))?;
    let normalized_item = serde_json::to_string(&item)
        .map_err(|_| invalid("legacy FeedItem JSON cannot be normalized"))?;
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, [global_id])?;
    }
    transaction.execute(
        program.materialize_sql,
        params![global_id, normalized_item, updated_at],
    )?;
    for sql in program.dependent_insert_sql {
        transaction.execute(sql, params![global_id, normalized_item])?;
    }
    transaction.execute(
        "UPDATE library_feed_items
         SET content_text_blob_digest = ?2,
             preserved_text_blob_digest = ?3
         WHERE global_id = ?1;",
        params![global_id, content_digest, preserved_digest],
    )?;

    let user_state = item
        .get("userState")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("legacy FeedItem user state is invalid"))?;
    for tag in bounded_array(
        user_state.get("tags"),
        MAXIMUM_TAGS,
        "legacy FeedItem tag set exceeds its bound",
    )? {
        let tag = tag
            .as_str()
            .filter(|tag| !tag.is_empty() && tag.len() <= 2_048)
            .ok_or_else(|| invalid("legacy FeedItem tag is invalid"))?;
        transaction.execute(
            "INSERT OR IGNORE INTO library_feed_item_tags (global_id, tag) VALUES (?1, ?2);",
            params![global_id, tag],
        )?;
    }
    for (ordinal, highlight) in bounded_array(
        user_state.get("highlights"),
        MAXIMUM_HIGHLIGHTS,
        "legacy FeedItem highlight set exceeds its bound",
    )?
    .iter()
    .enumerate()
    {
        let highlight = highlight
            .as_object()
            .ok_or_else(|| invalid("legacy FeedItem highlight is invalid"))?;
        let text = highlight
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("legacy FeedItem highlight text is invalid"))?;
        let (inline_text, text_digest) = if text.len() > INLINE_CONTENT_MAXIMUM_BYTES {
            (
                None,
                Some(insert_content_blob(
                    transaction,
                    text.as_bytes(),
                    "text/plain; charset=utf-8",
                )?),
            )
        } else {
            (Some(text), None)
        };
        let note = highlight.get("note").and_then(Value::as_str);
        if note.is_some_and(|note| note.len() > INLINE_CONTENT_MAXIMUM_BYTES) {
            return Err(invalid(
                "legacy FeedItem highlight note exceeds its metadata bound",
            ));
        }
        let created_at = highlight
            .get("createdAt")
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
            .ok_or_else(|| invalid("legacy FeedItem highlight time is invalid"))?;
        transaction.execute(
            "INSERT INTO library_feed_item_highlights
             (global_id, ordinal, text_value, text_blob_digest, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            params![
                global_id,
                i64::try_from(ordinal)
                    .map_err(|_| invalid("legacy highlight ordinal is invalid"))?,
                inline_text,
                text_digest,
                note,
                created_at,
            ],
        )?;
    }

    if let Some(signals) = item.get("contentSignals").filter(|value| !value.is_null()) {
        let signals = signals
            .as_object()
            .ok_or_else(|| invalid("legacy FeedItem signals are invalid"))?;
        let version = signals
            .get("version")
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
            .ok_or_else(|| invalid("legacy FeedItem signal version is invalid"))?;
        let method = signals
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("legacy FeedItem signal method is invalid"))?;
        let inferred_at = signals
            .get("inferredAt")
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
            .ok_or_else(|| invalid("legacy FeedItem signal time is invalid"))?;
        transaction.execute(
            "INSERT INTO library_feed_item_signals (global_id, version, method, inferred_at)
             VALUES (?1, ?2, ?3, ?4);",
            params![global_id, version, method, inferred_at],
        )?;
        let scores = signals
            .get("scores")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("legacy FeedItem signal scores are invalid"))?;
        if scores.len() > MAXIMUM_SIGNALS {
            return Err(invalid("legacy FeedItem signal scores exceed their bound"));
        }
        let tags = bounded_array(
            signals.get("tags"),
            MAXIMUM_SIGNALS,
            "legacy FeedItem signal tags exceed their bound",
        )?;
        for (signal, score) in scores {
            if signal.is_empty() || signal.len() > 512 {
                return Err(invalid("legacy FeedItem signal identity is invalid"));
            }
            let score = score
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| invalid("legacy FeedItem signal score is invalid"))?;
            let tagged = tags.iter().any(|tag| tag.as_str() == Some(signal.as_str()));
            transaction.execute(
                "INSERT INTO library_feed_item_signal_scores (global_id, signal, score, tagged)
                 VALUES (?1, ?2, ?3, ?4);",
                params![global_id, signal, score, tagged],
            )?;
        }
    }

    if let Some(event) = item.get("eventCandidate").filter(|value| !value.is_null()) {
        let event = event
            .as_object()
            .ok_or_else(|| invalid("legacy FeedItem event candidate is invalid"))?;
        let evidence = event.get("evidence").and_then(Value::as_str);
        let (inline_evidence, evidence_digest) =
            if evidence.is_some_and(|text| text.len() > INLINE_CONTENT_MAXIMUM_BYTES) {
                (
                    None,
                    Some(insert_content_blob(
                        transaction,
                        evidence.unwrap_or_default().as_bytes(),
                        "text/plain; charset=utf-8",
                    )?),
                )
            } else {
                (evidence, None)
            };
        transaction.execute(
            "INSERT INTO library_feed_item_events
             (global_id, version, method, detected_at, confidence, title,
              starts_at, ends_at, timezone, location_name, location_url,
              evidence, evidence_blob_digest)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13);",
            params![
                global_id,
                event.get("version").and_then(Value::as_i64),
                event.get("method").and_then(Value::as_str),
                event.get("detectedAt").and_then(Value::as_i64),
                event.get("confidence").and_then(Value::as_f64),
                event.get("title").and_then(Value::as_str),
                event.get("startsAt").and_then(Value::as_i64),
                event.get("endsAt").and_then(Value::as_i64),
                event.get("timezone").and_then(Value::as_str),
                event.get("locationName").and_then(Value::as_str),
                event.get("locationUrl").and_then(Value::as_str),
                inline_evidence,
                evidence_digest,
            ],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_import::normalized_checkpoint_digest_v2;
    use crate::normalized_sqlite::NormalizedCheckpointExportRequestV2;
    use crate::{export_normalized_checkpoint_page_v2, install_normalized_schema_v1};
    use ring::rand::SystemRandom;
    use rusqlite::Connection;
    use serde_json::json;

    struct TestAuthorityKeyStore(Vec<u8>);

    impl AuthorityKeyStore for TestAuthorityKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }

        fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
            Err("test store is read only".to_owned())
        }
    }

    struct TestActorKeyStore(Vec<u8>);

    impl ActorKeyStore for TestActorKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }

        fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
            Err("test store is read only".to_owned())
        }
    }

    fn legacy_source_fixture() -> (Connection, Vec<u8>) {
        let authority_key_bytes = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let authority_key_pair = Ed25519KeyPair::from_pkcs8(authority_key_bytes.as_ref()).unwrap();
        let authority_public_key = lower_hex(authority_key_pair.public_key().as_ref());
        let authority_key_id = transition_authority_key_id(&authority_public_key).unwrap();
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE library_core_desktop_state (
                   singletonId INTEGER PRIMARY KEY,
                   active INTEGER NOT NULL,
                   revision INTEGER NOT NULL,
                   sourceGeneration INTEGER NOT NULL,
                   sourceRevision INTEGER NOT NULL,
                   sourceDigest TEXT NOT NULL,
                   expectedItemCount INTEGER NOT NULL,
                   importedItemCount INTEGER NOT NULL,
                   shellJson TEXT NOT NULL,
                   startedAtMs INTEGER NOT NULL,
                   activatedAtMs INTEGER
                 ) STRICT;
                 CREATE TABLE library_core_active_authority (
                   libraryId TEXT PRIMARY KEY,
                   epoch INTEGER NOT NULL,
                   epochId TEXT NOT NULL,
                   transitionCertificateDigest TEXT NOT NULL
                 ) STRICT;
                 CREATE TABLE library_core_authority_epochs (
                   libraryId TEXT NOT NULL,
                   epoch INTEGER NOT NULL,
                   epochId TEXT NOT NULL,
                   transitionCertificateDigest TEXT NOT NULL,
                   authorityKeyId TEXT NOT NULL,
                   authorityPublicKey TEXT NOT NULL,
                   PRIMARY KEY (libraryId, epochId)
                 ) STRICT;
                 CREATE TABLE library_core_authority_frontier (
                   libraryId TEXT NOT NULL,
                   epochId TEXT NOT NULL,
                   tipIndex INTEGER NOT NULL,
                   actorId TEXT NOT NULL,
                   sequence INTEGER NOT NULL,
                   operationId TEXT NOT NULL,
                   chainDigest TEXT NOT NULL,
                   PRIMARY KEY (libraryId, epochId, tipIndex)
                 ) STRICT;
                 CREATE TABLE library_core_feed_items (
                   globalId TEXT PRIMARY KEY,
                   deletedAt INTEGER,
                   payloadJson TEXT NOT NULL,
                   updatedAtMs INTEGER NOT NULL
                 ) STRICT;",
            )
            .unwrap();
        let shell = json!({
            "feeds": {
                "https://example.com/feed.xml": {
                    "url": "https://example.com/feed.xml",
                    "title": "Example",
                    "enabled": true,
                    "trackUnread": true
                }
            },
            "persons": {
                "person:ada": {
                    "id": "person:ada",
                    "name": "Ada",
                    "relationshipStatus": "friend",
                    "careLevel": 5,
                    "reachOutLog": [{"loggedAt": 40, "channel": "email"}],
                    "tags": ["friend"],
                    "createdAt": 10,
                    "updatedAt": 40
                }
            },
            "accounts": {
                "account:ada": {
                    "id": "account:ada",
                    "personId": "person:ada",
                    "kind": "social",
                    "provider": "x",
                    "externalId": "ada",
                    "firstSeenAt": 10,
                    "lastSeenAt": 40,
                    "discoveredFrom": "manual_entry",
                    "createdAt": 10,
                    "updatedAt": 40
                }
            },
            "preferences": {
                "display": {"showEngagementCounts": true, "themeId": "midnight"}
            }
        });
        connection
            .execute(
                "INSERT INTO library_core_desktop_state
                 (singletonId, active, revision, sourceGeneration, sourceRevision,
                  sourceDigest, expectedItemCount, importedItemCount, shellJson,
                  startedAtMs, activatedAtMs)
                 VALUES (1, 1, 9, 2, 7, ?1, 2, 2, ?2, 10, 50);",
                params!["a".repeat(64), shell.to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_authority_epochs
                 (libraryId, epoch, epochId, transitionCertificateDigest,
                  authorityKeyId, authorityPublicKey)
                 VALUES (?1, 3, ?2, ?3, ?4, ?5);",
                params![
                    "b".repeat(64),
                    "c".repeat(64),
                    "d".repeat(64),
                    authority_key_id,
                    authority_public_key
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_active_authority
                 (libraryId, epoch, epochId, transitionCertificateDigest)
                 VALUES (?1, 3, ?2, ?3);",
                params!["b".repeat(64), "c".repeat(64), "d".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO library_core_authority_frontier
                 (libraryId, epochId, tipIndex, actorId, sequence, operationId, chainDigest)
                 VALUES (?1, ?2, 0, ?3, 7, 'op:migration-source:7', ?4);",
                params![
                    "b".repeat(64),
                    "c".repeat(64),
                    "1".repeat(64),
                    "f".repeat(64)
                ],
            )
            .unwrap();
        let tags = (0..140)
            .map(|index| format!("migration-tag-{index:03}"))
            .collect::<Vec<_>>();
        let item = json!({
            "globalId": "rss:live",
            "platform": "rss",
            "contentType": "article",
            "capturedAt": 10,
            "publishedAt": 9,
            "author": {"id": "author", "handle": "ada", "displayName": "Ada"},
            "content": {"text": "Body", "mediaUrls": [], "mediaTypes": []},
            "userState": {"hidden": false, "saved": false, "archived": false, "tags": tags},
            "topics": []
        });
        connection
            .execute(
                "INSERT INTO library_core_feed_items
                 (globalId, deletedAt, payloadJson, updatedAtMs)
                 VALUES ('rss:live', NULL, ?1, 60),
                        ('rss:deleted', 55, ?2, 55);",
                params![
                    item.to_string(),
                    json!({"globalId": "rss:deleted"}).to_string()
                ],
            )
            .unwrap();
        (connection, authority_key_bytes.as_ref().to_vec())
    }

    #[test]
    fn migrates_one_fenced_snapshot_and_binds_only_normalized_product_records() {
        let (mut source, authority_key_bytes) = legacy_source_fixture();
        let mut target = Connection::open_in_memory().unwrap();
        let receipt = migrate_legacy_snapshot_v1(&mut source, &mut target).unwrap();

        assert_eq!(receipt.format, "freed_normalized_migration_candidate_v1");
        assert_eq!(receipt.library_id, "b".repeat(64));
        assert_eq!(receipt.source_epoch, 3);
        assert_eq!(receipt.source_generation, 2);
        assert_eq!(receipt.source_revision, 7);
        assert_eq!(receipt.source_sqlite_revision, 9);
        assert_eq!(receipt.source_frontier_count, 1);
        assert_eq!(receipt.source_frontier_digest.len(), 64);
        assert_eq!(receipt.source_authority_key_id.len(), 64);
        assert_eq!(receipt.source_authority_public_key.len(), 64);
        assert_eq!(receipt.live_feed_items, 1);
        assert_eq!(receipt.excluded_deleted_feed_items, 1);
        assert_eq!(
            (receipt.rss_feeds, receipt.persons, receipt.accounts),
            (1, 1, 1)
        );
        assert_eq!(receipt.reach_outs, 1);
        assert_eq!(receipt.normalized_product_digest.len(), 64);
        assert!(receipt.normalized_record_count > 5);
        assert_eq!(
            load_normalized_migration_candidate_v1(&target).unwrap(),
            Some(receipt.clone())
        );

        let mut request = NormalizedCheckpointExportRequestV2::default();
        let mut records = Vec::new();
        let mut page_count = 0;
        loop {
            let page = export_normalized_checkpoint_page_v2(&target, &request).unwrap();
            page_count += 1;
            assert!(page
                .records
                .iter()
                .all(|record| record.registry_key.as_str() >= "10_feed_item"));
            records.extend(page.records);
            if page.done {
                break;
            }
            request.after = page.next_cursor;
        }
        assert!(page_count > 1);
        assert!(records.len() > 128);
        assert_eq!(
            normalized_checkpoint_digest_v2(&records).unwrap(),
            receipt.normalized_product_digest
        );
        let transition = sign_normalized_storage_transition_v1(
            &receipt,
            &TestAuthorityKeyStore(authority_key_bytes.clone()),
            "primary:desktop",
            1_000,
        )
        .unwrap();
        assert_eq!(
            sign_normalized_storage_transition_v1(
                &receipt,
                &TestAuthorityKeyStore(authority_key_bytes.clone()),
                "primary:desktop",
                1_000,
            )
            .unwrap(),
            transition
        );
        assert_eq!(transition.epoch_id.len(), 64);
        assert_eq!(transition.transition_certificate_digest.len(), 64);
        let certificate: NormalizedStorageTransitionCertificateV1 =
            serde_json::from_str(&transition.canonical_transition_certificate).unwrap();
        assert_eq!(certificate.epoch_id, transition.epoch_id);
        assert_eq!(certificate.certificate_body.epoch_number, 4);
        assert_eq!(certificate.certificate_body.writer_id, "primary:desktop");
        assert_eq!(certificate.certificate_body.migration_candidate, receipt);
        assert_eq!(
            target
                .query_row("SELECT count(*) FROM library_meta;", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        install_normalized_candidate_authority_v1(&mut source, &mut target, &receipt, &transition)
            .unwrap();
        let actor_key_bytes = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let primary_actor_id = install_normalized_primary_actor_v2(
            &mut target,
            &"9".repeat(64),
            &TestActorKeyStore(actor_key_bytes.as_ref().to_vec()),
            &TestAuthorityKeyStore(authority_key_bytes),
            1_001,
        )
        .unwrap();
        assert_eq!(primary_actor_id.len(), 64);
        let primary_certificate: String = target
            .query_row(
                "SELECT canonical_enrollment_certificate FROM library_actors
                 WHERE actor_id = ?1;",
                [&primary_actor_id],
                |row| row.get(0),
            )
            .unwrap();
        let primary_certificate: Value = serde_json::from_str(&primary_certificate).unwrap();
        assert_eq!(
            primary_certificate["certificate_body"]["actor_enrollment_body"]["observed_frontier"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            primary_certificate["certificate_body"]["actor_capability_body"]
                ["allowed_operation_types"]
                .as_array()
                .unwrap()
                .len(),
            crate::library_core_actor_capability::primary_writer_operation_types().len()
        );
        assert_eq!(
            target
                .query_row(
                    "SELECT count(*) FROM library_actor_capability_mutations;",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            i64::try_from(
                crate::library_core_actor_capability::primary_writer_operation_types().len()
            )
            .unwrap()
        );
        let installed: (String, String, String, i64) = target
            .query_row(
                "SELECT active.library_id, active.epoch_id, active.writer_id,
                        meta.source_revision
                 FROM library_active_authority AS active
                 JOIN library_meta AS meta ON meta.singleton_id = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            installed,
            (
                receipt.library_id.clone(),
                transition.epoch_id.clone(),
                "primary:desktop".to_owned(),
                0
            )
        );
        assert_eq!(
            target
                .query_row(
                    "SELECT count(*) FROM library_authority_frontier;",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .unwrap(),
            1
        );
        assert!(migrate_legacy_snapshot_v1(&mut source, &mut target).is_err());
    }

    #[test]
    fn migration_candidate_receipt_survives_response_loss_and_rejects_tamper() {
        let (mut source, _) = legacy_source_fixture();
        let mut target = Connection::open_in_memory().unwrap();
        let receipt = migrate_legacy_snapshot_v1(&mut source, &mut target).unwrap();

        assert_eq!(
            load_normalized_migration_candidate_v1(&target).unwrap(),
            Some(receipt)
        );
        target
            .execute(
                "UPDATE library_storage_transition_plan
                 SET candidate_digest = ?1 WHERE singleton_id = 1;",
                ["0".repeat(64)],
            )
            .unwrap();
        assert!(load_normalized_migration_candidate_v1(&target).is_err());
    }

    #[test]
    fn changed_source_or_certificate_cannot_install_candidate_authority() {
        let (mut changed_source, key_bytes) = legacy_source_fixture();
        let mut changed_target = Connection::open_in_memory().unwrap();
        let candidate =
            migrate_legacy_snapshot_v1(&mut changed_source, &mut changed_target).unwrap();
        let signed = sign_normalized_storage_transition_v1(
            &candidate,
            &TestAuthorityKeyStore(key_bytes),
            "primary:desktop",
            1_000,
        )
        .unwrap();
        changed_source
            .execute(
                "UPDATE library_core_desktop_state SET revision = revision + 1
                 WHERE singletonId = 1;",
                [],
            )
            .unwrap();
        assert!(install_normalized_candidate_authority_v1(
            &mut changed_source,
            &mut changed_target,
            &candidate,
            &signed,
        )
        .is_err());
        assert_eq!(
            changed_target
                .query_row("SELECT count(*) FROM library_meta;", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );

        let (mut source, key_bytes) = legacy_source_fixture();
        let mut target = Connection::open_in_memory().unwrap();
        let candidate = migrate_legacy_snapshot_v1(&mut source, &mut target).unwrap();
        let mut signed = sign_normalized_storage_transition_v1(
            &candidate,
            &TestAuthorityKeyStore(key_bytes),
            "primary:desktop",
            1_000,
        )
        .unwrap();
        signed.canonical_transition_certificate = signed.canonical_transition_certificate.replacen(
            "primary:desktop",
            "primary:tampered",
            1,
        );
        assert!(install_normalized_candidate_authority_v1(
            &mut source,
            &mut target,
            &candidate,
            &signed,
        )
        .is_err());
        assert_eq!(
            target
                .query_row("SELECT count(*) FROM library_meta;", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn authority_and_primary_actor_installation_replay_only_exact_state() {
        let (mut source, authority_key_bytes) = legacy_source_fixture();
        let mut target = Connection::open_in_memory().unwrap();
        let candidate = migrate_legacy_snapshot_v1(&mut source, &mut target).unwrap();
        let transition = sign_normalized_storage_transition_v1(
            &candidate,
            &TestAuthorityKeyStore(authority_key_bytes.clone()),
            "primary:desktop",
            1_000,
        )
        .unwrap();
        install_normalized_candidate_authority_v1(
            &mut source,
            &mut target,
            &candidate,
            &transition,
        )
        .unwrap();
        install_normalized_candidate_authority_v1(
            &mut source,
            &mut target,
            &candidate,
            &transition,
        )
        .expect("replay exact normalized authority");

        let actor_key_bytes = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let actor_key_bytes = actor_key_bytes.as_ref().to_vec();
        let actor_id = install_normalized_primary_actor_v2(
            &mut target,
            &"9".repeat(64),
            &TestActorKeyStore(actor_key_bytes.clone()),
            &TestAuthorityKeyStore(authority_key_bytes.clone()),
            1_001,
        )
        .unwrap();
        assert_eq!(
            install_normalized_primary_actor_v2(
                &mut target,
                &"9".repeat(64),
                &TestActorKeyStore(actor_key_bytes.clone()),
                &TestAuthorityKeyStore(authority_key_bytes.clone()),
                1_001,
            )
            .expect("replay exact normalized Primary actor"),
            actor_id
        );

        target
            .execute(
                "DELETE FROM library_actor_capability_mutations
                 WHERE capability_id = (
                     SELECT capability_id FROM library_actor_capabilities WHERE actor_id = ?1
                 ) AND mutation_id = (
                     SELECT mutation_id FROM library_actor_capability_mutations
                     WHERE capability_id = (
                         SELECT capability_id FROM library_actor_capabilities WHERE actor_id = ?1
                     ) ORDER BY mutation_id LIMIT 1
                 );",
                [&actor_id],
            )
            .unwrap();
        assert!(install_normalized_primary_actor_v2(
            &mut target,
            &"9".repeat(64),
            &TestActorKeyStore(actor_key_bytes),
            &TestAuthorityKeyStore(authority_key_bytes),
            1_001,
        )
        .is_err());
    }

    #[test]
    fn fresh_desktop_library_starts_in_normalized_sqlite_without_a_migration_source() {
        let authority_key = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
            .unwrap()
            .as_ref()
            .to_vec();
        let actor_key = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
            .unwrap()
            .as_ref()
            .to_vec();
        let authority_store = TestAuthorityKeyStore(authority_key);
        let actor_store = TestActorKeyStore(actor_key);
        let mut target = Connection::open_in_memory().unwrap();
        install_normalized_schema_v1(&target).unwrap();
        let witness = "7".repeat(64);

        let prepared = prepare_fresh_normalized_desktop_library_v1(
            &mut target,
            &witness,
            &actor_store,
            &authority_store,
            1_000,
        )
        .unwrap();
        assert_eq!(prepared.selected_at, 1_000);
        assert!(!prepared.primary_actor_id.is_empty());
        let certificate: String = target
            .query_row(
                "SELECT canonical_transition_certificate FROM library_authority_epochs;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(certificate.contains(NORMALIZED_FRESH_GENESIS_FORMAT));
        assert_eq!(
            target
                .query_row(
                    "SELECT count(*) FROM library_storage_transition_plan;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            prepare_fresh_normalized_desktop_library_v1(
                &mut target,
                &witness,
                &actor_store,
                &authority_store,
                2_000,
            )
            .unwrap(),
            prepared
        );
        assert!(prepare_fresh_normalized_desktop_library_v1(
            &mut target,
            &"8".repeat(64),
            &actor_store,
            &authority_store,
            2_000,
        )
        .is_err());
    }

    #[test]
    fn cutover_preparation_pins_identity_and_replays_one_selector_receipt() {
        let (mut source, authority_key_bytes) = legacy_source_fixture();
        let mut target = Connection::open_in_memory().unwrap();
        migrate_legacy_snapshot_v1(&mut source, &mut target).unwrap();
        let actor_key_bytes = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let actor_key_bytes = actor_key_bytes.as_ref().to_vec();
        let witness = "9".repeat(64);

        let prepared = prepare_normalized_desktop_cutover_v1(
            &mut source,
            &mut target,
            &witness,
            &TestActorKeyStore(actor_key_bytes.clone()),
            &TestAuthorityKeyStore(authority_key_bytes.clone()),
            1_000,
        )
        .unwrap();
        assert_eq!(prepared.selected_at, 1_000);
        assert_eq!(
            prepared.format,
            "freed_normalized_desktop_authority_prepared_v1"
        );
        assert_eq!(
            target
                .query_row(
                    "SELECT state FROM library_storage_transition_plan
                     WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "actor_installed"
        );

        assert_eq!(
            prepare_normalized_desktop_cutover_v1(
                &mut source,
                &mut target,
                &witness,
                &TestActorKeyStore(actor_key_bytes.clone()),
                &TestAuthorityKeyStore(authority_key_bytes.clone()),
                2_000,
            )
            .expect("restart reuses the first accepted time"),
            prepared
        );
        assert!(prepare_normalized_desktop_cutover_v1(
            &mut source,
            &mut target,
            &"8".repeat(64),
            &TestActorKeyStore(actor_key_bytes),
            &TestAuthorityKeyStore(authority_key_bytes),
            2_000,
        )
        .is_err());
    }

    #[test]
    fn decomposes_the_historical_source_and_excludes_non_synchronized_preferences() {
        let mut connection = Connection::open_in_memory().unwrap();
        install_normalized_schema_v1(&connection).unwrap();
        let shell = json!({
            "feeds": {
                "https://example.com/feed.xml": {
                    "url": "https://example.com/feed.xml",
                    "title": "Example",
                    "siteUrl": "https://example.com",
                    "enabled": true,
                    "trackUnread": true,
                    "lastFetchError": "device only"
                }
            },
            "persons": {
                "person:ada": {
                    "id": "person:ada",
                    "name": "Ada",
                    "relationshipStatus": "friend",
                    "careLevel": 5,
                    "reachOutLog": [
                        {"loggedAt": 40, "channel": "email", "notes": "Sent notes"},
                        {"loggedAt": 30, "notes": "Met at the library"}
                    ],
                    "tags": ["mathematician", "friend"],
                    "graphX": 100,
                    "createdAt": 10,
                    "updatedAt": 40
                }
            },
            "accounts": {
                "account:ada": {
                    "id": "account:ada",
                    "personId": "person:ada",
                    "kind": "social",
                    "provider": "x",
                    "externalId": "ada",
                    "handle": "ada",
                    "firstSeenAt": 10,
                    "lastSeenAt": 40,
                    "discoveredFrom": "manual_entry",
                    "followRosterRoles": ["following"],
                    "graphPinned": true,
                    "createdAt": 10,
                    "updatedAt": 40
                }
            },
            "preferences": {
                "weights": {
                    "recency": 70,
                    "platforms": {"rss": 1.5},
                    "topics": {},
                    "authors": {}
                },
                "display": {
                    "themeId": "midnight",
                    "itemsPerPage": 500,
                    "showEngagementCounts": true,
                    "animationIntensity": "detailed",
                    "reading": {
                        "focusMode": true,
                        "focusIntensity": 0.8,
                        "markReadOnScroll": true,
                        "showReadInGrayscale": false,
                        "dualColumnMode": true
                    },
                    "archivePruneDays": 30
                },
                "sync": {
                    "cloudProvider": "google_drive",
                    "autoBackup": true,
                    "backupFrequency": "daily"
                },
                "ai": {
                    "provider": "ollama",
                    "model": "local",
                    "ollamaUrl": "http://localhost",
                    "autoSummarize": true,
                    "extractTopics": false
                }
            }
        });
        let transaction = connection.transaction().unwrap();
        migrate_legacy_shell_v1(&transaction, &shell.to_string(), 50).unwrap();
        transaction.commit().unwrap();

        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM library_rss_feeds WHERE url = 'https://example.com/feed.xml';",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "Example"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_person_reach_outs WHERE person_id = 'person:ada';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT person_id FROM library_accounts WHERE id = 'account:ada';",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "person:ada"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_account_follow_roles
                     WHERE account_id = 'account:ada' AND role = 'following';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        let preference_paths = connection
            .prepare("SELECT path FROM library_preferences ORDER BY path;")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(preference_paths.contains(&"v:$.display.showEngagementCounts".to_string()));
        assert!(preference_paths.contains(&"v:$.ai.autoSummarize".to_string()));
        assert!(preference_paths.contains(&"v:$.weights.platforms.rss".to_string()));
        for excluded in [
            "themeId",
            "itemsPerPage",
            "dualColumnMode",
            "cloudProvider",
            "autoBackup",
            "provider",
            "model",
            "ollamaUrl",
        ] {
            assert!(preference_paths.iter().all(|path| !path.contains(excluded)));
        }

        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library', 1, 'epoch', 1, 50);",
                [],
            )
            .unwrap();
        let page = export_normalized_checkpoint_page_v2(
            &connection,
            &NormalizedCheckpointExportRequestV2::default(),
        )
        .unwrap();
        assert!(page
            .records
            .iter()
            .all(|record| !record.registry_key.contains("shell")));
    }

    #[test]
    fn shell_migration_fails_if_an_account_references_a_missing_person() {
        let mut connection = Connection::open_in_memory().unwrap();
        install_normalized_schema_v1(&connection).unwrap();
        let shell = json!({
            "accounts": {
                "account:orphaned-link": {
                    "id": "account:orphaned-link",
                    "personId": "person:missing",
                    "kind": "social",
                    "provider": "x",
                    "externalId": "missing",
                    "firstSeenAt": 10,
                    "lastSeenAt": 10,
                    "discoveredFrom": "manual_entry",
                    "createdAt": 10,
                    "updatedAt": 10
                }
            }
        });
        let transaction = connection.transaction().unwrap();
        assert!(migrate_legacy_shell_v1(&transaction, &shell.to_string(), 10).is_err());
        transaction.rollback().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_accounts;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
    }

    #[test]
    fn decomposes_a_large_legacy_item_losslessly_without_a_shell_record() {
        let mut connection = Connection::open_in_memory().unwrap();
        install_normalized_schema_v1(&connection).unwrap();
        let body = "long-form ".repeat(300_000);
        let highlight = "highlight ".repeat(20_000);
        let evidence = "evidence ".repeat(20_000);
        let item = json!({
            "globalId": "rss:large",
            "platform": "rss",
            "contentType": "article",
            "capturedAt": 10,
            "publishedAt": 9,
            "author": {"id": "author", "handle": "author", "displayName": "Author"},
            "content": {"text": body, "mediaUrls": [], "mediaTypes": []},
            "userState": {
                "hidden": false,
                "saved": true,
                "archived": false,
                "tags": ["research"],
                "highlights": [{"text": highlight, "note": "Keep", "createdAt": 11}]
            },
            "topics": ["architecture"],
            "contentSignals": {
                "version": 1,
                "method": "manual",
                "inferredAt": 12,
                "scores": {"essay": 0.75},
                "tags": ["essay"]
            },
            "eventCandidate": {
                "version": 1,
                "method": "manual",
                "detectedAt": 13,
                "confidence": 0.9,
                "title": "Gathering",
                "evidence": evidence
            }
        });
        let payload_json = serde_json::to_string(&item).unwrap();
        assert!(payload_json.len() <= 4_194_304);
        let transaction = connection.transaction().unwrap();
        migrate_legacy_feed_item_v1(&transaction, "rss:large", &payload_json, 14).unwrap();
        transaction.commit().unwrap();

        let digests: (String, String, String) = connection
            .query_row(
                "SELECT item.content_text_blob_digest,
                        highlight.text_blob_digest,
                        event.evidence_blob_digest
                 FROM library_feed_items AS item
                 JOIN library_feed_item_highlights AS highlight USING (global_id)
                 JOIN library_feed_item_events AS event USING (global_id)
                 WHERE item.global_id = 'rss:large';",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        for (digest, expected) in [
            (digests.0, body.as_bytes()),
            (digests.1, highlight.as_bytes()),
            (digests.2, evidence.as_bytes()),
        ] {
            let mut statement = connection
                .prepare(
                    "SELECT bytes FROM library_blob_chunks
                     WHERE content_digest = ?1 ORDER BY chunk_index;",
                )
                .unwrap();
            let bytes = statement
                .query_map([digest], |row| row.get::<_, Vec<u8>>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
                .concat();
            assert_eq!(bytes, expected);
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_feed_item_tags WHERE global_id = 'rss:large';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT tagged FROM library_feed_item_signal_scores
                     WHERE global_id = 'rss:large' AND signal = 'essay';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library', 1, 'epoch', 1, 14);",
                [],
            )
            .unwrap();
        let page = export_normalized_checkpoint_page_v2(
            &connection,
            &NormalizedCheckpointExportRequestV2::default(),
        )
        .unwrap();
        assert!(page
            .records
            .iter()
            .all(|record| !record.registry_key.contains("shell")));
    }
}
