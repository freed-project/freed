use serde_json::Value;
use std::collections::HashSet;

const MAX_DIRECT_CANONICAL_BYTES: usize = 4_194_304;
const MAX_CANONICAL_NESTING_DEPTH: usize = 128;
const MAX_CANONICAL_NODES: usize = 65_536;
const OPERATION_DIGEST_DOMAINS: [&str; 13] = [
    "authority-key",
    "actor-public-key",
    "actor-id",
    "actor-enrollment-body",
    "actor-enrollment-certificate",
    "operation-payload",
    "operation-signing-body",
    "transaction-member",
    "transaction",
    "actor-chain-genesis",
    "actor-chain",
    "operation-envelope",
    "causal-frontier",
];
const SIGNATURE_DOMAINS: [&str; 3] = [
    "operation-envelope",
    "actor-enrollment-proof",
    "actor-enrollment-authority",
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
    InvalidUtf8,
    InvalidJson,
    DuplicateObjectName,
    NonCanonicalBytes,
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
    if maximum_bytes <= prefix.len() {
        return Err(CanonicalEncodingError::InvalidMaximumBytes);
    }
    let mut writer = BoundedWriter::new(maximum_bytes)?;
    writer.write(prefix.as_bytes())?;
    let mut node_count = 0;
    write_value(&mut writer, value, 0, &mut node_count)?;
    Ok(writer.bytes)
}

pub(crate) fn encode_signature_input(
    domain: &str,
    value: &Value,
    maximum_bytes: usize,
) -> Result<Vec<u8>, CanonicalEncodingError> {
    if !SIGNATURE_DOMAINS.contains(&domain) {
        return Err(CanonicalEncodingError::UnregisteredDomain);
    }
    let prefix = format!("freed.library-core.v1/signature/{domain}\0");
    if maximum_bytes <= prefix.len() {
        return Err(CanonicalEncodingError::InvalidMaximumBytes);
    }
    let mut writer = BoundedWriter::new(maximum_bytes)?;
    writer.write(prefix.as_bytes())?;
    let mut node_count = 0;
    write_value(&mut writer, value, 0, &mut node_count)?;
    Ok(writer.bytes)
}

pub(crate) fn encode_operation_signature_input(
    value: &Value,
    maximum_bytes: usize,
) -> Result<Vec<u8>, CanonicalEncodingError> {
    encode_signature_input("operation-envelope", value, maximum_bytes)
}

struct CanonicalJsonParser<'a> {
    source: &'a str,
    bytes: &'a [u8],
    index: usize,
    node_count: usize,
}

impl<'a> CanonicalJsonParser<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            bytes: source.as_bytes(),
            index: 0,
            node_count: 0,
        }
    }

    fn parse(mut self) -> Result<Value, CanonicalEncodingError> {
        let value = self.parse_value(0)?;
        if self.index != self.bytes.len() {
            return Err(CanonicalEncodingError::InvalidJson);
        }
        Ok(value)
    }

    fn count_node(&mut self, depth: usize) -> Result<(), CanonicalEncodingError> {
        self.node_count = self
            .node_count
            .checked_add(1)
            .ok_or(CanonicalEncodingError::MaximumNodesExceeded)?;
        if self.node_count > MAX_CANONICAL_NODES {
            return Err(CanonicalEncodingError::MaximumNodesExceeded);
        }
        if depth > MAX_CANONICAL_NESTING_DEPTH {
            return Err(CanonicalEncodingError::MaximumDepthExceeded);
        }
        Ok(())
    }

    fn parse_value(&mut self, depth: usize) -> Result<Value, CanonicalEncodingError> {
        self.count_node(depth)?;
        match self.bytes.get(self.index).copied() {
            Some(b'"') => self.parse_string().map(Value::String),
            Some(b'[') => self.parse_array(depth),
            Some(b'{') => self.parse_object(depth),
            Some(b't') => {
                self.parse_keyword(b"true")?;
                Ok(Value::Bool(true))
            }
            Some(b'f') => {
                self.parse_keyword(b"false")?;
                Ok(Value::Bool(false))
            }
            Some(b'n') => {
                self.parse_keyword(b"null")?;
                Ok(Value::Null)
            }
            Some(b'-' | b'0'..=b'9') => self.parse_integer(),
            _ => Err(CanonicalEncodingError::InvalidJson),
        }
    }

    fn parse_keyword(&mut self, keyword: &[u8]) -> Result<(), CanonicalEncodingError> {
        if self
            .bytes
            .get(self.index..self.index.saturating_add(keyword.len()))
            != Some(keyword)
        {
            return Err(CanonicalEncodingError::InvalidJson);
        }
        self.index += keyword.len();
        Ok(())
    }

    fn parse_integer(&mut self) -> Result<Value, CanonicalEncodingError> {
        let start = self.index;
        if self.bytes.get(self.index) == Some(&b'-') {
            self.index += 1;
        }
        match self.bytes.get(self.index).copied() {
            Some(b'0') => {
                self.index += 1;
                if matches!(self.bytes.get(self.index), Some(b'0'..=b'9')) {
                    return Err(CanonicalEncodingError::InvalidJson);
                }
            }
            Some(b'1'..=b'9') => {
                self.index += 1;
                while matches!(self.bytes.get(self.index), Some(b'0'..=b'9')) {
                    self.index += 1;
                }
            }
            _ => return Err(CanonicalEncodingError::InvalidJson),
        }
        if matches!(self.bytes.get(self.index), Some(b'.' | b'e' | b'E')) {
            return Err(CanonicalEncodingError::UnsupportedNumber);
        }
        let lexeme = &self.source[start..self.index];
        if lexeme == "-0" {
            return Err(CanonicalEncodingError::UnsupportedNumber);
        }
        let integer = lexeme
            .parse::<i64>()
            .map_err(|_| CanonicalEncodingError::UnsupportedNumber)?;
        if integer.unsigned_abs() > SAFE_INTEGER_MAX {
            return Err(CanonicalEncodingError::UnsupportedNumber);
        }
        Ok(Value::Number(integer.into()))
    }

    fn parse_string(&mut self) -> Result<String, CanonicalEncodingError> {
        if self.bytes.get(self.index) != Some(&b'"') {
            return Err(CanonicalEncodingError::InvalidJson);
        }
        self.index += 1;
        let mut result = String::new();
        while let Some(byte) = self.bytes.get(self.index).copied() {
            match byte {
                b'"' => {
                    self.index += 1;
                    return Ok(result);
                }
                b'\\' => {
                    self.index += 1;
                    result.push_str(&self.parse_escape()?);
                }
                0x00..=0x1f => return Err(CanonicalEncodingError::InvalidJson),
                0x20..=0x7f => {
                    result.push(char::from(byte));
                    self.index += 1;
                }
                _ => {
                    let character = self.source[self.index..]
                        .chars()
                        .next()
                        .ok_or(CanonicalEncodingError::InvalidJson)?;
                    result.push(character);
                    self.index += character.len_utf8();
                }
            }
        }
        Err(CanonicalEncodingError::InvalidJson)
    }

    fn parse_escape(&mut self) -> Result<String, CanonicalEncodingError> {
        let escaped = self
            .bytes
            .get(self.index)
            .copied()
            .ok_or(CanonicalEncodingError::InvalidJson)?;
        self.index += 1;
        match escaped {
            b'"' => Ok("\"".to_owned()),
            b'\\' => Ok("\\".to_owned()),
            b'/' => Ok("/".to_owned()),
            b'b' => Ok("\u{0008}".to_owned()),
            b'f' => Ok("\u{000c}".to_owned()),
            b'n' => Ok("\n".to_owned()),
            b'r' => Ok("\r".to_owned()),
            b't' => Ok("\t".to_owned()),
            b'u' => self.parse_unicode_escape(),
            _ => Err(CanonicalEncodingError::InvalidJson),
        }
    }

    fn parse_unicode_escape(&mut self) -> Result<String, CanonicalEncodingError> {
        let high = self.parse_hex_code_unit()?;
        let scalar = if (0xd800..=0xdbff).contains(&high) {
            if self.bytes.get(self.index..self.index.saturating_add(2)) != Some(b"\\u") {
                return Err(CanonicalEncodingError::InvalidJson);
            }
            self.index += 2;
            let low = self.parse_hex_code_unit()?;
            if !(0xdc00..=0xdfff).contains(&low) {
                return Err(CanonicalEncodingError::InvalidJson);
            }
            0x10000 + ((u32::from(high) - 0xd800) << 10) + (u32::from(low) - 0xdc00)
        } else if (0xdc00..=0xdfff).contains(&high) {
            return Err(CanonicalEncodingError::InvalidJson);
        } else {
            u32::from(high)
        };
        char::from_u32(scalar)
            .map(|value| value.to_string())
            .ok_or(CanonicalEncodingError::InvalidJson)
    }

    fn parse_hex_code_unit(&mut self) -> Result<u16, CanonicalEncodingError> {
        let bytes = self
            .bytes
            .get(self.index..self.index.saturating_add(4))
            .ok_or(CanonicalEncodingError::InvalidJson)?;
        let mut value = 0_u16;
        for byte in bytes {
            let digit = match byte {
                b'0'..=b'9' => u16::from(*byte - b'0'),
                b'a'..=b'f' => u16::from(*byte - b'a' + 10),
                b'A'..=b'F' => u16::from(*byte - b'A' + 10),
                _ => return Err(CanonicalEncodingError::InvalidJson),
            };
            value = (value << 4) | digit;
        }
        self.index += 4;
        Ok(value)
    }

    fn parse_array(&mut self, depth: usize) -> Result<Value, CanonicalEncodingError> {
        self.index += 1;
        let mut values = Vec::new();
        if self.bytes.get(self.index) == Some(&b']') {
            self.index += 1;
            return Ok(Value::Array(values));
        }
        loop {
            values.push(self.parse_value(depth + 1)?);
            match self.bytes.get(self.index).copied() {
                Some(b']') => {
                    self.index += 1;
                    return Ok(Value::Array(values));
                }
                Some(b',') => self.index += 1,
                _ => return Err(CanonicalEncodingError::InvalidJson),
            }
        }
    }

    fn parse_object(&mut self, depth: usize) -> Result<Value, CanonicalEncodingError> {
        self.index += 1;
        let mut values = serde_json::Map::new();
        let mut names = HashSet::new();
        if self.bytes.get(self.index) == Some(&b'}') {
            self.index += 1;
            return Ok(Value::Object(values));
        }
        loop {
            let name = self.parse_string()?;
            if !names.insert(name.clone()) {
                return Err(CanonicalEncodingError::DuplicateObjectName);
            }
            if self.bytes.get(self.index) != Some(&b':') {
                return Err(CanonicalEncodingError::InvalidJson);
            }
            self.index += 1;
            values.insert(name, self.parse_value(depth + 1)?);
            match self.bytes.get(self.index).copied() {
                Some(b'}') => {
                    self.index += 1;
                    return Ok(Value::Object(values));
                }
                Some(b',') => self.index += 1,
                _ => return Err(CanonicalEncodingError::InvalidJson),
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecodedCanonicalValue {
    value: Value,
    canonical_bytes: Vec<u8>,
}

impl DecodedCanonicalValue {
    pub(crate) fn value(&self) -> &Value {
        &self.value
    }

    pub(crate) fn into_value(self) -> Value {
        self.value
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

pub(crate) fn decode_canonical_value(
    bytes: &[u8],
    maximum_bytes: usize,
) -> Result<DecodedCanonicalValue, CanonicalEncodingError> {
    if maximum_bytes == 0 || maximum_bytes > MAX_DIRECT_CANONICAL_BYTES {
        return Err(CanonicalEncodingError::InvalidMaximumBytes);
    }
    if bytes.len() > maximum_bytes {
        return Err(CanonicalEncodingError::MaximumBytesExceeded);
    }
    let source = std::str::from_utf8(bytes).map_err(|_| CanonicalEncodingError::InvalidUtf8)?;
    let value = CanonicalJsonParser::new(source).parse()?;
    if encode_canonical_value(&value, maximum_bytes)? != bytes {
        return Err(CanonicalEncodingError::NonCanonicalBytes);
    }
    Ok(DecodedCanonicalValue {
        value,
        canonical_bytes: bytes.to_vec(),
    })
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

    #[derive(Deserialize)]
    struct DecoderVector {
        name: String,
        input: String,
        accepted: bool,
    }

    fn vectors() -> Vec<CanonicalVector> {
        serde_json::from_str(include_str!(
            "../../../shared/src/library-core/canonical-codec-vectors.json"
        ))
        .expect("cross-runtime canonical vectors must parse")
    }

    fn decoder_vectors() -> Vec<DecoderVector> {
        serde_json::from_str(include_str!(
            "../../../shared/src/library-core/canonical-decoder-vectors.json"
        ))
        .expect("cross-runtime canonical decoder vectors must parse")
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
        let actor_public_key_input = encode_operation_digest_input(
            "actor-public-key",
            &serde_json::json!({
                "signature_algorithm": "ed25519",
                "actor_public_key":
                    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
            }),
            MAX_DIRECT_CANONICAL_BYTES,
        )
        .expect("actor public key digest input");
        assert_eq!(
            actor_public_key_input,
            b"freed.library-core.v1/digest/actor-public-key\0{\"actor_public_key\":\"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a\",\"signature_algorithm\":\"ed25519\"}"
        );
        let authority_key_input = encode_operation_digest_input(
            "authority-key",
            &serde_json::json!({
                "signature_algorithm": "ed25519",
                "authority_public_key":
                    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
            }),
            MAX_DIRECT_CANONICAL_BYTES,
        )
        .expect("authority key digest input");
        assert_eq!(
            authority_key_input,
            b"freed.library-core.v1/digest/authority-key\0{\"authority_public_key\":\"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a\",\"signature_algorithm\":\"ed25519\"}"
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
        let actor_proof_input = encode_signature_input(
            "actor-enrollment-proof",
            &serde_json::json!({
                "enrollment_body_digest":
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }),
            MAX_DIRECT_CANONICAL_BYTES,
        )
        .expect("actor proof input");
        assert_eq!(
            actor_proof_input,
            b"freed.library-core.v1/signature/actor-enrollment-proof\0{\"enrollment_body_digest\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}"
        );
        let certificate_digest_input = encode_operation_digest_input(
            "actor-enrollment-certificate",
            &serde_json::json!({
                "enrollment_body_digest":
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }),
            MAX_DIRECT_CANONICAL_BYTES,
        )
        .expect("actor enrollment certificate digest input");
        assert_eq!(
            certificate_digest_input,
            b"freed.library-core.v1/digest/actor-enrollment-certificate\0{\"enrollment_body_digest\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}"
        );
        let authority_signature_input = encode_signature_input(
            "actor-enrollment-authority",
            &serde_json::json!({
                "certificate_digest":
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }),
            MAX_DIRECT_CANONICAL_BYTES,
        )
        .expect("actor enrollment authority signature input");
        assert_eq!(
            authority_signature_input,
            b"freed.library-core.v1/signature/actor-enrollment-authority\0{\"certificate_digest\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}"
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
        assert_eq!(
            encode_signature_input("made-up-domain", &Value::Null, MAX_DIRECT_CANONICAL_BYTES),
            Err(CanonicalEncodingError::UnregisteredDomain)
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

    #[test]
    fn matches_cross_runtime_duplicate_preserving_decoder_vectors() {
        for vector in decoder_vectors() {
            let decoded =
                decode_canonical_value(vector.input.as_bytes(), MAX_DIRECT_CANONICAL_BYTES);
            assert_eq!(
                decoded.is_ok(),
                vector.accepted,
                "{} returned {decoded:?}",
                vector.name
            );
            if let Ok(decoded) = decoded {
                assert_eq!(decoded.canonical_bytes(), vector.input.as_bytes());
                assert_eq!(
                    encode_canonical_value(decoded.value(), MAX_DIRECT_CANONICAL_BYTES)
                        .expect("decoded value re-encodes"),
                    vector.input.as_bytes()
                );
            }
        }
    }

    #[test]
    fn decoder_rejects_invalid_utf8_and_inbound_limits() {
        assert_eq!(
            decode_canonical_value(&[0xc3, 0x28], MAX_DIRECT_CANONICAL_BYTES),
            Err(CanonicalEncodingError::InvalidUtf8)
        );
        assert_eq!(
            decode_canonical_value(br#""12345""#, 6),
            Err(CanonicalEncodingError::MaximumBytesExceeded)
        );

        let excessive_nodes = format!(
            "[{}]",
            std::iter::repeat_n("null", MAX_CANONICAL_NODES)
                .collect::<Vec<_>>()
                .join(",")
        );
        assert_eq!(
            decode_canonical_value(excessive_nodes.as_bytes(), MAX_DIRECT_CANONICAL_BYTES),
            Err(CanonicalEncodingError::MaximumNodesExceeded)
        );

        let excessive_depth = format!(
            "{}null{}",
            "[".repeat(MAX_CANONICAL_NESTING_DEPTH + 1),
            "]".repeat(MAX_CANONICAL_NESTING_DEPTH + 1)
        );
        assert_eq!(
            decode_canonical_value(excessive_depth.as_bytes(), MAX_DIRECT_CANONICAL_BYTES),
            Err(CanonicalEncodingError::MaximumDepthExceeded)
        );
    }
}
