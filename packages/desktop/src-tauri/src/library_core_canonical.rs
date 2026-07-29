use serde_json::Value;

const MAX_DIRECT_CANONICAL_BYTES: usize = 4_194_304;
const MAX_CANONICAL_NESTING_DEPTH: usize = 128;
const MAX_CANONICAL_NODES: usize = 65_536;
const OPERATION_DIGEST_DOMAINS: [&str; 8] = [
    "operation-payload",
    "operation-signing-body",
    "transaction-member",
    "transaction",
    "actor-chain-genesis",
    "actor-chain",
    "operation-envelope",
    "causal-frontier",
];
const SAFE_INTEGER_MAX: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CanonicalEncodingError {
    InvalidMaximumBytes,
    MaximumBytesExceeded,
    MaximumDepthExceeded,
    MaximumNodesExceeded,
    UnsupportedNumber,
    UnregisteredDomain,
    JsonStringEncoding,
}

struct BoundedWriter {
    bytes: Vec<u8>,
    maximum_bytes: usize,
}

impl BoundedWriter {
    fn new(maximum_bytes: usize) -> Result<Self, CanonicalEncodingError> {
        if maximum_bytes == 0 || maximum_bytes > MAX_DIRECT_CANONICAL_BYTES {
            return Err(CanonicalEncodingError::InvalidMaximumBytes);
        }
        Ok(Self {
            bytes: Vec::with_capacity(maximum_bytes.min(1_024)),
            maximum_bytes,
        })
    }

    fn write(&mut self, value: &[u8]) -> Result<(), CanonicalEncodingError> {
        let next_length = self
            .bytes
            .len()
            .checked_add(value.len())
            .ok_or(CanonicalEncodingError::MaximumBytesExceeded)?;
        if next_length > self.maximum_bytes {
            return Err(CanonicalEncodingError::MaximumBytesExceeded);
        }
        self.bytes.extend_from_slice(value);
        Ok(())
    }
}

fn compare_utf16(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn write_string(writer: &mut BoundedWriter, value: &str) -> Result<(), CanonicalEncodingError> {
    let encoded =
        serde_json::to_string(value).map_err(|_| CanonicalEncodingError::JsonStringEncoding)?;
    writer.write(encoded.as_bytes())
}

fn write_value(
    writer: &mut BoundedWriter,
    value: &Value,
    depth: usize,
    node_count: &mut usize,
) -> Result<(), CanonicalEncodingError> {
    *node_count = node_count
        .checked_add(1)
        .ok_or(CanonicalEncodingError::MaximumNodesExceeded)?;
    if *node_count > MAX_CANONICAL_NODES {
        return Err(CanonicalEncodingError::MaximumNodesExceeded);
    }
    if depth > MAX_CANONICAL_NESTING_DEPTH {
        return Err(CanonicalEncodingError::MaximumDepthExceeded);
    }
    match value {
        Value::Null => writer.write(b"null"),
        Value::Bool(value) => writer.write(if *value { b"true" } else { b"false" }),
        Value::String(value) => write_string(writer, value),
        Value::Number(value) => {
            if let Some(integer) = value.as_i64() {
                if integer.unsigned_abs() > SAFE_INTEGER_MAX {
                    return Err(CanonicalEncodingError::UnsupportedNumber);
                }
                writer.write(integer.to_string().as_bytes())
            } else if let Some(integer) = value.as_u64() {
                if integer > SAFE_INTEGER_MAX {
                    return Err(CanonicalEncodingError::UnsupportedNumber);
                }
                writer.write(integer.to_string().as_bytes())
            } else {
                Err(CanonicalEncodingError::UnsupportedNumber)
            }
        }
        Value::Array(values) => {
            writer.write(b"[")?;
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    writer.write(b",")?;
                }
                write_value(writer, value, depth + 1, node_count)?;
            }
            writer.write(b"]")
        }
        Value::Object(values) => {
            let mut keys: Vec<&str> = values.keys().map(String::as_str).collect();
            keys.sort_unstable_by(|left, right| compare_utf16(left, right));
            writer.write(b"{")?;
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    writer.write(b",")?;
                }
                write_string(writer, key)?;
                writer.write(b":")?;
                write_value(writer, &values[key], depth + 1, node_count)?;
            }
            writer.write(b"}")
        }
    }
}

pub(crate) fn encode_canonical_value(
    value: &Value,
    maximum_bytes: usize,
) -> Result<Vec<u8>, CanonicalEncodingError> {
    let mut writer = BoundedWriter::new(maximum_bytes)?;
    let mut node_count = 0;
    write_value(&mut writer, value, 0, &mut node_count)?;
    Ok(writer.bytes)
}

pub(crate) fn encode_operation_digest_input(
    domain: &str,
    value: &Value,
    maximum_bytes: usize,
) -> Result<Vec<u8>, CanonicalEncodingError> {
    if !OPERATION_DIGEST_DOMAINS.contains(&domain) {
        return Err(CanonicalEncodingError::UnregisteredDomain);
    }
    let prefix = format!("freed.library-core.v1/digest/{domain}\0");
    let canonical_budget = maximum_bytes
        .checked_sub(prefix.len())
        .filter(|budget| *budget > 0)
        .ok_or(CanonicalEncodingError::InvalidMaximumBytes)?;
    let canonical = encode_canonical_value(value, canonical_budget)?;
    let mut result = Vec::with_capacity(prefix.len() + canonical.len());
    result.extend_from_slice(prefix.as_bytes());
    result.extend_from_slice(&canonical);
    Ok(result)
}

pub(crate) fn encode_operation_signature_input(
    value: &Value,
    maximum_bytes: usize,
) -> Result<Vec<u8>, CanonicalEncodingError> {
    let prefix = b"freed.library-core.v1/signature/operation-envelope\0";
    let canonical_budget = maximum_bytes
        .checked_sub(prefix.len())
        .filter(|budget| *budget > 0)
        .ok_or(CanonicalEncodingError::InvalidMaximumBytes)?;
    let canonical = encode_canonical_value(value, canonical_budget)?;
    let mut result = Vec::with_capacity(prefix.len() + canonical.len());
    result.extend_from_slice(prefix);
    result.extend_from_slice(&canonical);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use sha2::{Digest, Sha256};

    #[derive(Deserialize)]
    struct CanonicalVector {
        name: String,
        value: Value,
        canonical: String,
    }

    fn vectors() -> Vec<CanonicalVector> {
        serde_json::from_str(include_str!(
            "../../../shared/src/library-core/canonical-codec-vectors.json"
        ))
        .expect("cross-runtime canonical vectors must parse")
    }

    #[test]
    fn matches_cross_runtime_canonical_vectors() {
        for vector in vectors() {
            let encoded = encode_canonical_value(&vector.value, MAX_DIRECT_CANONICAL_BYTES)
                .unwrap_or_else(|error| panic!("{} failed: {error:?}", vector.name));
            assert_eq!(encoded, vector.canonical.as_bytes(), "{}", vector.name);
        }
    }

    #[test]
    fn builds_exact_domain_separated_inputs() {
        let value = serde_json::json!({
            "schema_version": 1,
            "operation_type": "person_upsert"
        });
        let digest_input =
            encode_operation_digest_input("operation-payload", &value, MAX_DIRECT_CANONICAL_BYTES)
                .expect("digest input");
        assert_eq!(
            digest_input,
            b"freed.library-core.v1/digest/operation-payload\0{\"operation_type\":\"person_upsert\",\"schema_version\":1}"
        );
        let digest_hex = Sha256::digest(&digest_input)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(
            digest_hex,
            "5192eab75edf78a8181905197adec6ae800e93ce7d568aaf4f1b6f2e98d28285"
        );

        let signature_input = encode_operation_signature_input(
            &serde_json::json!({
                "operation_signing_body_digest":
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }),
            MAX_DIRECT_CANONICAL_BYTES,
        )
        .expect("signature input");
        assert_eq!(
            signature_input,
            b"freed.library-core.v1/signature/operation-envelope\0{\"operation_signing_body_digest\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}"
        );
    }

    #[test]
    fn rejects_unsupported_numbers_limits_and_domains() {
        for value in [
            serde_json::json!(0.5),
            serde_json::json!(-0.0),
            serde_json::json!(9_007_199_254_740_992_u64),
        ] {
            assert_eq!(
                encode_canonical_value(&value, MAX_DIRECT_CANONICAL_BYTES),
                Err(CanonicalEncodingError::UnsupportedNumber)
            );
        }
        assert_eq!(
            encode_canonical_value(&serde_json::json!("12345"), 4),
            Err(CanonicalEncodingError::MaximumBytesExceeded)
        );
        assert_eq!(
            encode_operation_digest_input(
                "made-up-domain",
                &Value::Null,
                MAX_DIRECT_CANONICAL_BYTES
            ),
            Err(CanonicalEncodingError::UnregisteredDomain)
        );
        assert_eq!(
            encode_operation_signature_input(&Value::Null, 20),
            Err(CanonicalEncodingError::InvalidMaximumBytes)
        );
    }

    #[test]
    fn rejects_excessive_nesting() {
        let mut nested = Value::Null;
        for _ in 0..=MAX_CANONICAL_NESTING_DEPTH {
            nested = Value::Array(vec![nested]);
        }
        assert_eq!(
            encode_canonical_value(&nested, MAX_DIRECT_CANONICAL_BYTES),
            Err(CanonicalEncodingError::MaximumDepthExceeded)
        );
    }

    #[test]
    fn rejects_excessive_node_count() {
        let value = Value::Array(vec![Value::Null; MAX_CANONICAL_NODES]);
        assert_eq!(
            encode_canonical_value(&value, MAX_DIRECT_CANONICAL_BYTES),
            Err(CanonicalEncodingError::MaximumNodesExceeded)
        );
    }
}
