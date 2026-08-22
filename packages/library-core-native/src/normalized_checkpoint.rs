use crate::library_core_canonical::encode_canonical_value;
use crate::library_core_hash::lower_hex;
use crate::sqlite_contract_generated::{
    CheckpointRecordKind, CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES, CONTENT_CHUNK_BYTES,
    NORMALIZED_CHECKPOINT_FORMAT, SQLITE_PROTOCOL_VERSION,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const BLOB_CONTENT_DIGEST_PREFIX: &[u8] = b"freed.library-core.v1/digest-bytes/blob-content\0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentRecordError(String);

impl std::fmt::Display for ContentRecordError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ContentRecordError {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedCheckpointRecordV2 {
    pub format: String,
    pub protocol_version: u32,
    pub registry_key: String,
    pub primary_key: Value,
    pub payload: Value,
}

fn binary64_wrapper(value: f64) -> Value {
    json!({
        "bits": format!("{:016x}", value.to_bits()),
        "codec": "ieee754_binary64_hex_v1",
    })
}

fn decode_binary64_wrapper(value: &Value) -> Result<f64, ContentRecordError> {
    let object = value.as_object().ok_or_else(|| {
        ContentRecordError("checkpoint fractional wrapper must be an object".into())
    })?;
    if object.len() != 2
        || object.get("codec").and_then(Value::as_str) != Some("ieee754_binary64_hex_v1")
    {
        return Err(ContentRecordError(
            "checkpoint fractional wrapper identity is invalid".into(),
        ));
    }
    let bits = object
        .get("bits")
        .and_then(Value::as_str)
        .filter(|bits| {
            bits.len() == 16
                && bits
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
        .and_then(|bits| u64::from_str_radix(bits, 16).ok())
        .ok_or_else(|| {
            ContentRecordError("checkpoint fractional wrapper bits are invalid".into())
        })?;
    let decoded = f64::from_bits(bits);
    if !decoded.is_finite() {
        return Err(ContentRecordError(
            "checkpoint fractional wrapper must be finite".into(),
        ));
    }
    Ok(decoded)
}

pub(crate) fn encode_fractional_payload(
    registry_key: &str,
    payload: &mut Value,
) -> Result<(), ContentRecordError> {
    let kind = CheckpointRecordKind::from_registry_key(registry_key).ok_or_else(|| {
        ContentRecordError("normalized checkpoint registry key is unsupported".into())
    })?;
    let object = payload.as_object_mut().ok_or_else(|| {
        ContentRecordError("normalized checkpoint payload must be an object".into())
    })?;
    for field in kind.fractional_fields() {
        let Some(value) = object.get_mut(*field) else {
            continue;
        };
        if value.is_null() || value.as_i64().is_some() || value.as_u64().is_some() {
            continue;
        }
        if let Some(number) = value.as_f64() {
            if !number.is_finite() {
                return Err(ContentRecordError(
                    "checkpoint fractional value must be finite".into(),
                ));
            }
            *value = binary64_wrapper(number);
        } else {
            decode_binary64_wrapper(value)?;
        }
    }
    Ok(())
}

pub(crate) fn decode_fractional_payload(
    registry_key: &str,
    payload: &mut Value,
) -> Result<(), ContentRecordError> {
    let kind = CheckpointRecordKind::from_registry_key(registry_key).ok_or_else(|| {
        ContentRecordError("normalized checkpoint registry key is unsupported".into())
    })?;
    let object = payload.as_object_mut().ok_or_else(|| {
        ContentRecordError("normalized checkpoint payload must be an object".into())
    })?;
    for field in kind.fractional_fields() {
        let Some(value) = object.get_mut(*field) else {
            continue;
        };
        if value.is_null() || value.as_i64().is_some() || value.as_u64().is_some() {
            continue;
        }
        let decoded = decode_binary64_wrapper(value)?;
        *value =
            Value::Number(serde_json::Number::from_f64(decoded).ok_or_else(|| {
                ContentRecordError("checkpoint fractional value is invalid".into())
            })?);
    }
    Ok(())
}

pub(crate) fn blob_digest(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(BLOB_CONTENT_DIGEST_PREFIX);
    digest.update(bytes);
    lower_hex(&digest.finalize())
}

pub(crate) fn checked_record(
    registry_key: &str,
    primary_key: Value,
    payload: Value,
) -> Result<NormalizedCheckpointRecordV2, ContentRecordError> {
    let kind = CheckpointRecordKind::from_registry_key(registry_key).ok_or_else(|| {
        ContentRecordError("normalized checkpoint registry key is unsupported".into())
    })?;
    let payload_object = payload.as_object().ok_or_else(|| {
        ContentRecordError("normalized checkpoint payload must be an object".into())
    })?;
    let mut actual_fields: Vec<&str> = payload_object.keys().map(String::as_str).collect();
    actual_fields.sort_unstable();
    if actual_fields != kind.payload_fields() {
        return Err(ContentRecordError(
            "normalized checkpoint payload has unknown or missing fields".into(),
        ));
    }
    let record = NormalizedCheckpointRecordV2 {
        format: NORMALIZED_CHECKPOINT_FORMAT.into(),
        protocol_version: SQLITE_PROTOCOL_VERSION,
        registry_key: registry_key.into(),
        primary_key,
        payload,
    };
    let value = serde_json::to_value(&record)
        .map_err(|error| ContentRecordError(format!("record encoding failed: {error}")))?;
    encode_canonical_value(&value, CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES).map_err(|error| {
        ContentRecordError(format!(
            "normalized checkpoint record {registry_key} is not canonical within its byte bound: {error:?}"
        ))
    })?;
    Ok(record)
}

pub fn split_content_records_v1(
    bytes: &[u8],
    media_type: &str,
) -> Result<Vec<NormalizedCheckpointRecordV2>, ContentRecordError> {
    if media_type.is_empty() || media_type.len() > 255 {
        return Err(ContentRecordError(
            "content media type must be bounded nonempty text".into(),
        ));
    }
    let content_digest = blob_digest(bytes);
    let chunk_count = bytes.len().div_ceil(CONTENT_CHUNK_BYTES);
    let mut records = Vec::with_capacity(chunk_count + 1);
    records.push(checked_record(
        "b0_blob_descriptor",
        json!(content_digest),
        json!({
            "blobContentDigest": content_digest,
            "byteLength": bytes.len(),
            "chunkBytes": CONTENT_CHUNK_BYTES,
            "chunkCount": chunk_count,
            "cloudAvailabilityCommitment": null,
            "encoding": null,
            "mediaType": media_type,
            "rangeCount": 0,
            "rangeGranularity": null,
            "rangeIndexRootDigest": null,
            "renditionId": null,
            "storageLayout": "inline_chunks",
        }),
    )?);
    for (chunk_index, chunk) in bytes.chunks(CONTENT_CHUNK_BYTES).enumerate() {
        records.push(checked_record(
            "b1_content_chunk",
            json!([content_digest, chunk_index]),
            json!({
                "blobContentDigest": content_digest,
                "byteLength": chunk.len(),
                "bytesBase64": BASE64.encode(chunk),
                "chunkContentDigest": blob_digest(chunk),
                "chunkIndex": chunk_index,
            }),
        )?);
    }
    Ok(records)
}

pub fn reassemble_content_records_v1(
    records: &[NormalizedCheckpointRecordV2],
) -> Result<Vec<u8>, ContentRecordError> {
    let descriptor = records
        .iter()
        .find(|record| record.registry_key == "b0_blob_descriptor")
        .ok_or_else(|| ContentRecordError("content descriptor record is missing".into()))?;
    if descriptor.format != NORMALIZED_CHECKPOINT_FORMAT
        || descriptor.protocol_version != SQLITE_PROTOCOL_VERSION
    {
        return Err(ContentRecordError(
            "content descriptor version identity is invalid".into(),
        ));
    }
    let expected_digest = descriptor
        .payload
        .get("blobContentDigest")
        .and_then(Value::as_str)
        .ok_or_else(|| ContentRecordError("content descriptor digest is invalid".into()))?;
    let expected_bytes = descriptor
        .payload
        .get("byteLength")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| ContentRecordError("content descriptor byte length is invalid".into()))?;
    let expected_chunks = descriptor
        .payload
        .get("chunkCount")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| ContentRecordError("content descriptor chunk count is invalid".into()))?;
    let mut chunks: Vec<&NormalizedCheckpointRecordV2> = records
        .iter()
        .filter(|record| record.registry_key == "b1_content_chunk")
        .collect();
    chunks.sort_by_key(|record| {
        record
            .payload
            .get("chunkIndex")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX)
    });
    if chunks.len() != expected_chunks {
        return Err(ContentRecordError("content chunk set is incomplete".into()));
    }
    let mut output = Vec::with_capacity(expected_bytes);
    for (chunk_index, record) in chunks.into_iter().enumerate() {
        if record.format != NORMALIZED_CHECKPOINT_FORMAT
            || record.protocol_version != SQLITE_PROTOCOL_VERSION
            || record
                .payload
                .get("blobContentDigest")
                .and_then(Value::as_str)
                != Some(expected_digest)
            || record.payload.get("chunkIndex").and_then(Value::as_u64) != Some(chunk_index as u64)
        {
            return Err(ContentRecordError(
                "content chunk identity is invalid".into(),
            ));
        }
        let encoded = record
            .payload
            .get("bytesBase64")
            .and_then(Value::as_str)
            .ok_or_else(|| ContentRecordError("content chunk bytes are missing".into()))?;
        let chunk = BASE64
            .decode(encoded)
            .map_err(|_| ContentRecordError("content chunk base64 is invalid".into()))?;
        let expected_chunk_digest = blob_digest(&chunk);
        if BASE64.encode(&chunk) != encoded
            || record.payload.get("byteLength").and_then(Value::as_u64) != Some(chunk.len() as u64)
            || record
                .payload
                .get("chunkContentDigest")
                .and_then(Value::as_str)
                != Some(expected_chunk_digest.as_str())
        {
            return Err(ContentRecordError("content chunk bytes are invalid".into()));
        }
        output.extend_from_slice(&chunk);
    }
    if output.len() != expected_bytes || blob_digest(&output) != expected_digest {
        return Err(ContentRecordError(
            "reassembled content digest is invalid".into(),
        ));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_and_reassembles_a_maximum_legal_item_without_an_oversized_record() {
        let bytes: Vec<u8> = (0..4_194_304)
            .map(|index| ((index * 31 + 17) % 251) as u8)
            .collect();
        let records = split_content_records_v1(&bytes, "application/json").expect("split");
        assert_eq!(records.len(), 65);
        assert!(records.iter().all(|record| {
            let value = serde_json::to_value(record).expect("record value");
            encode_canonical_value(&value, CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES).is_ok()
        }));
        assert!(records
            .iter()
            .all(|record| record.registry_key != "00_library_shell"));
        assert_eq!(
            reassemble_content_records_v1(&records).expect("reassemble"),
            bytes
        );
    }

    #[test]
    fn rejects_missing_content_chunks() {
        let mut records = split_content_records_v1(&vec![7; CONTENT_CHUNK_BYTES + 1], "text/plain")
            .expect("split");
        records.pop();
        assert!(reassemble_content_records_v1(&records).is_err());
    }
}
