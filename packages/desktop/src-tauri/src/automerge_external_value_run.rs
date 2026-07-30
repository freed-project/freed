//! Verified bounded readers for derived Automerge scalar token runs.
//!
//! Higher-layer row assembly consumes scalar descriptors through this one
//! contract. The reader binds each occurrence to its exact source columns,
//! validates the payload-spool layout, and rejects scratch-run mutation,
//! truncation, or trailing records.

use crate::automerge_external_column::ExternalColumnInput;
use crate::automerge_external_common::lower_hex;
use crate::automerge_external_value::{ExternalValueDecodeSummary, VALUE_TOKEN_SCHEMA_VERSION};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Take};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalValueTokenRunLimits {
    pub max_run_bytes: u64,
    pub max_line_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum ExternalScalarValue {
    Null,
    Boolean(bool),
    Unsigned(String),
    Signed(String),
    Counter(String),
    Timestamp(String),
    Float {
        little_endian_bits: String,
    },
    String {
        payload_offset: u64,
        byte_length: u64,
    },
    Bytes {
        payload_offset: u64,
        byte_length: u64,
    },
    Unknown {
        type_code: u8,
        payload_offset: u64,
        byte_length: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalValueToken {
    pub index: u64,
    pub value: ExternalScalarValue,
}

#[derive(Debug)]
pub(super) enum ExternalValueTokenRunError {
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidLimits,
    RunTooLarge,
    LineTooLarge,
    Truncated,
    ContractMismatch,
    TokenOrder,
    InvalidScalar,
    PayloadLayout,
    RangeOverflow,
}

impl From<std::io::Error> for ExternalValueTokenRunError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ExternalValueTokenRunError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl fmt::Display for ExternalValueTokenRunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge value token run I/O failed: {error}"),
            Self::Json(error) => {
                write!(
                    formatter,
                    "Automerge value token run JSON is invalid: {error}"
                )
            }
            Self::InvalidLimits => {
                formatter.write_str("Automerge value token run limits are invalid")
            }
            Self::RunTooLarge => {
                formatter.write_str("Automerge value token run exceeds the admitted bytes")
            }
            Self::LineTooLarge => {
                formatter.write_str("Automerge value token line exceeds the admitted bytes")
            }
            Self::Truncated => formatter.write_str("Automerge value token run is truncated"),
            Self::ContractMismatch => {
                formatter.write_str("Automerge value token run does not match its contract")
            }
            Self::TokenOrder => formatter.write_str("Automerge value tokens are not contiguous"),
            Self::InvalidScalar => {
                formatter.write_str("Automerge value token contains a noncanonical scalar")
            }
            Self::PayloadLayout => {
                formatter.write_str("Automerge value token payload layout is invalid")
            }
            Self::RangeOverflow => formatter.write_str("Automerge value token range overflows"),
        }
    }
}

impl std::error::Error for ExternalValueTokenRunError {}

type ValueRunResult<T> = Result<T, ExternalValueTokenRunError>;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ValueRecord {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: String,
        #[serde(rename = "metadataOffset")]
        metadata_offset: u64,
        #[serde(rename = "metadataByteLength")]
        metadata_byte_length: u64,
        #[serde(rename = "rawOffset")]
        raw_offset: Option<u64>,
        #[serde(rename = "rawByteLength")]
        raw_byte_length: Option<u64>,
        #[serde(rename = "rawDeflated")]
        raw_deflated: bool,
    },
    Value {
        index: u64,
        value: ScalarValueRecord,
    },
    Complete {
        summary: ExternalValueDecodeSummary,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ScalarValueRecord {
    Null,
    Boolean {
        value: bool,
    },
    Unsigned {
        value: String,
    },
    Signed {
        value: String,
    },
    Counter {
        value: String,
    },
    Timestamp {
        value: String,
    },
    Float {
        #[serde(rename = "littleEndianBits")]
        little_endian_bits: String,
    },
    String {
        #[serde(rename = "payloadOffset")]
        payload_offset: u64,
        #[serde(rename = "byteLength")]
        byte_length: u64,
    },
    Bytes {
        #[serde(rename = "payloadOffset")]
        payload_offset: u64,
        #[serde(rename = "byteLength")]
        byte_length: u64,
    },
    Unknown {
        #[serde(rename = "typeCode")]
        type_code: u8,
        #[serde(rename = "payloadOffset")]
        payload_offset: u64,
        #[serde(rename = "byteLength")]
        byte_length: u64,
    },
}

pub(super) struct ExternalValueTokenRunReader<'a> {
    reader: BufReader<Take<&'a mut File>>,
    expected_summary: ExternalValueDecodeSummary,
    prefix_hasher: Sha256,
    prefix_byte_length: u64,
    next_index: u64,
    next_payload_offset: u64,
    maximum_line_bytes: usize,
    complete: bool,
}

impl<'a> ExternalValueTokenRunReader<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn open(
        run: &'a mut File,
        payload_spool: &mut File,
        source_byte_length: u64,
        source_sha256: &str,
        metadata_input: ExternalColumnInput,
        raw_input: Option<ExternalColumnInput>,
        summary: &ExternalValueDecodeSummary,
        limits: ExternalValueTokenRunLimits,
    ) -> ValueRunResult<Self> {
        if limits.max_run_bytes == 0 || limits.max_line_bytes == 0 {
            return Err(ExternalValueTokenRunError::InvalidLimits);
        }
        let run_byte_length = run.metadata()?.len();
        if run_byte_length > limits.max_run_bytes {
            return Err(ExternalValueTokenRunError::RunTooLarge);
        }
        let metadata_end = metadata_input
            .offset
            .checked_add(metadata_input.byte_length)
            .ok_or(ExternalValueTokenRunError::RangeOverflow)?;
        if metadata_input.column_type
            != crate::automerge_external_document::DocumentColumnType::ValueMetadata
            || metadata_input.byte_length == 0
            || metadata_end > source_byte_length
            || raw_input.is_some_and(|input| {
                input.column_type != crate::automerge_external_document::DocumentColumnType::Value
                    || input.byte_length == 0
                    || input.offset != metadata_end
                    || input
                        .offset
                        .checked_add(input.byte_length)
                        .is_none_or(|end| end > source_byte_length)
            })
        {
            return Err(ExternalValueTokenRunError::ContractMismatch);
        }
        if raw_input.is_none() && summary.decoded_raw_byte_length != 0
            || raw_input.is_some_and(|input| {
                !input.deflated && summary.decoded_raw_byte_length != input.byte_length
            })
        {
            return Err(ExternalValueTokenRunError::ContractMismatch);
        }
        verify_payload_spool(payload_spool, summary)?;
        run.seek(SeekFrom::Start(0))?;
        let mut reader = BufReader::new(run.take(run_byte_length));
        let (record, line) = next_record(&mut reader, limits.max_line_bytes)?
            .ok_or(ExternalValueTokenRunError::Truncated)?;
        let ValueRecord::Begin {
            schema_version,
            source_byte_length: recorded_source_byte_length,
            source_sha256: recorded_source_sha256,
            metadata_offset,
            metadata_byte_length,
            raw_offset,
            raw_byte_length,
            raw_deflated,
        } = record
        else {
            return Err(ExternalValueTokenRunError::ContractMismatch);
        };
        if schema_version != VALUE_TOKEN_SCHEMA_VERSION
            || recorded_source_byte_length != source_byte_length
            || recorded_source_sha256 != source_sha256
            || metadata_offset != metadata_input.offset
            || metadata_byte_length != metadata_input.byte_length
            || raw_offset != raw_input.map(|input| input.offset)
            || raw_byte_length != raw_input.map(|input| input.byte_length)
            || raw_deflated != raw_input.is_some_and(|input| input.deflated)
        {
            return Err(ExternalValueTokenRunError::ContractMismatch);
        }
        let mut result = Self {
            reader,
            expected_summary: summary.clone(),
            prefix_hasher: Sha256::new(),
            prefix_byte_length: 0,
            next_index: 0,
            next_payload_offset: 0,
            maximum_line_bytes: limits.max_line_bytes,
            complete: false,
        };
        result.hash_line(&line)?;
        Ok(result)
    }

    pub(super) fn next_value(&mut self) -> ValueRunResult<Option<ExternalValueToken>> {
        if self.complete {
            return Ok(None);
        }
        let (record, line) = next_record(&mut self.reader, self.maximum_line_bytes)?
            .ok_or(ExternalValueTokenRunError::Truncated)?;
        match record {
            ValueRecord::Value { index, value } => {
                if index != self.next_index || index >= self.expected_summary.value_count {
                    return Err(ExternalValueTokenRunError::TokenOrder);
                }
                let value = self.validate_scalar(value)?;
                self.hash_line(&line)?;
                self.next_index = self
                    .next_index
                    .checked_add(1)
                    .ok_or(ExternalValueTokenRunError::RangeOverflow)?;
                Ok(Some(ExternalValueToken { index, value }))
            }
            ValueRecord::Complete { summary } => {
                let prefix_sha256 = lower_hex(&self.prefix_hasher.clone().finalize());
                if summary != self.expected_summary
                    || summary.value_count != self.next_index
                    || summary.payload_spool_byte_length != self.next_payload_offset
                    || summary.token_run_prefix_byte_length != self.prefix_byte_length
                    || summary.token_run_prefix_sha256 != prefix_sha256
                    || next_record(&mut self.reader, self.maximum_line_bytes)?.is_some()
                {
                    return Err(ExternalValueTokenRunError::ContractMismatch);
                }
                self.complete = true;
                Ok(None)
            }
            ValueRecord::Begin { .. } => Err(ExternalValueTokenRunError::ContractMismatch),
        }
    }

    fn validate_scalar(&mut self, value: ScalarValueRecord) -> ValueRunResult<ExternalScalarValue> {
        match value {
            ScalarValueRecord::Null => Ok(ExternalScalarValue::Null),
            ScalarValueRecord::Boolean { value } => Ok(ExternalScalarValue::Boolean(value)),
            ScalarValueRecord::Unsigned { value } => {
                validate_canonical_unsigned(&value)?;
                Ok(ExternalScalarValue::Unsigned(value))
            }
            ScalarValueRecord::Signed { value } => {
                validate_canonical_signed(&value)?;
                Ok(ExternalScalarValue::Signed(value))
            }
            ScalarValueRecord::Counter { value } => {
                validate_canonical_signed(&value)?;
                Ok(ExternalScalarValue::Counter(value))
            }
            ScalarValueRecord::Timestamp { value } => {
                validate_canonical_signed(&value)?;
                Ok(ExternalScalarValue::Timestamp(value))
            }
            ScalarValueRecord::Float { little_endian_bits } => {
                if little_endian_bits.len() != 16
                    || !little_endian_bits
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err(ExternalValueTokenRunError::InvalidScalar);
                }
                Ok(ExternalScalarValue::Float { little_endian_bits })
            }
            ScalarValueRecord::String {
                payload_offset,
                byte_length,
            } => {
                self.admit_payload(payload_offset, byte_length)?;
                Ok(ExternalScalarValue::String {
                    payload_offset,
                    byte_length,
                })
            }
            ScalarValueRecord::Bytes {
                payload_offset,
                byte_length,
            } => {
                self.admit_payload(payload_offset, byte_length)?;
                Ok(ExternalScalarValue::Bytes {
                    payload_offset,
                    byte_length,
                })
            }
            ScalarValueRecord::Unknown {
                type_code,
                payload_offset,
                byte_length,
            } => {
                if type_code < 10 {
                    return Err(ExternalValueTokenRunError::InvalidScalar);
                }
                self.admit_payload(payload_offset, byte_length)?;
                Ok(ExternalScalarValue::Unknown {
                    type_code,
                    payload_offset,
                    byte_length,
                })
            }
        }
    }

    fn admit_payload(&mut self, offset: u64, byte_length: u64) -> ValueRunResult<()> {
        let end = offset
            .checked_add(byte_length)
            .ok_or(ExternalValueTokenRunError::RangeOverflow)?;
        if offset != self.next_payload_offset
            || end > self.expected_summary.payload_spool_byte_length
        {
            return Err(ExternalValueTokenRunError::PayloadLayout);
        }
        self.next_payload_offset = end;
        Ok(())
    }

    fn hash_line(&mut self, line: &[u8]) -> ValueRunResult<()> {
        self.prefix_hasher.update(line);
        self.prefix_hasher.update(b"\n");
        self.prefix_byte_length = self
            .prefix_byte_length
            .checked_add(line.len() as u64)
            .and_then(|length| length.checked_add(1))
            .ok_or(ExternalValueTokenRunError::RangeOverflow)?;
        Ok(())
    }
}

fn verify_payload_spool(
    payload_spool: &mut File,
    summary: &ExternalValueDecodeSummary,
) -> ValueRunResult<()> {
    if payload_spool.metadata()?.len() != summary.payload_spool_byte_length {
        return Err(ExternalValueTokenRunError::PayloadLayout);
    }
    payload_spool.seek(SeekFrom::Start(0))?;
    let mut reader = payload_spool.take(summary.payload_spool_byte_length);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if lower_hex(&hasher.finalize()) != summary.payload_spool_sha256 {
        return Err(ExternalValueTokenRunError::PayloadLayout);
    }
    Ok(())
}

fn validate_canonical_unsigned(value: &str) -> ValueRunResult<()> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| ExternalValueTokenRunError::InvalidScalar)?;
    if parsed.to_string() != value {
        return Err(ExternalValueTokenRunError::InvalidScalar);
    }
    Ok(())
}

fn validate_canonical_signed(value: &str) -> ValueRunResult<()> {
    let parsed = value
        .parse::<i64>()
        .map_err(|_| ExternalValueTokenRunError::InvalidScalar)?;
    if parsed.to_string() != value {
        return Err(ExternalValueTokenRunError::InvalidScalar);
    }
    Ok(())
}

fn next_record(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> ValueRunResult<Option<(ValueRecord, Vec<u8>)>> {
    let Some(line) = read_bounded_line(reader, maximum_line_bytes)? else {
        return Ok(None);
    };
    let record = serde_json::from_slice(&line)?;
    Ok(Some((record, line)))
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> ValueRunResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(ExternalValueTokenRunError::Truncated)
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if line
                .len()
                .checked_add(newline)
                .is_none_or(|length| length > maximum_line_bytes)
            {
                return Err(ExternalValueTokenRunError::LineTooLarge);
            }
            line.extend_from_slice(&available[..newline]);
            reader.consume(newline + 1);
            return Ok(Some(line));
        }
        if line
            .len()
            .checked_add(available.len())
            .is_none_or(|length| length > maximum_line_bytes)
        {
            return Err(ExternalValueTokenRunError::LineTooLarge);
        }
        let consumed = available.len();
        line.extend_from_slice(available);
        reader.consume(consumed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automerge_external_document::DocumentColumnType;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn fixture(bytes: &[u8]) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(bytes).unwrap();
        file.as_file_mut().sync_all().unwrap();
        file
    }

    fn run_fixture(payload: &[u8]) -> (NamedTempFile, ExternalValueDecodeSummary) {
        let source_sha256 = "00".repeat(32);
        let begin = format!(
            "{{\"type\":\"begin\",\"schemaVersion\":1,\"sourceByteLength\":4,\"sourceSha256\":\"{source_sha256}\",\"metadataOffset\":0,\"metadataByteLength\":1,\"rawOffset\":1,\"rawByteLength\":3,\"rawDeflated\":false}}\n"
        );
        let value = format!(
            "{{\"type\":\"value\",\"index\":0,\"value\":{{\"kind\":\"bytes\",\"payloadOffset\":0,\"byteLength\":{}}}}}\n",
            payload.len()
        );
        let prefix = format!("{begin}{value}");
        let summary = ExternalValueDecodeSummary {
            value_count: 1,
            decoded_raw_byte_length: payload.len() as u64,
            payload_spool_byte_length: payload.len() as u64,
            payload_spool_sha256: lower_hex(&Sha256::digest(payload)),
            token_run_prefix_byte_length: prefix.len() as u64,
            token_run_prefix_sha256: lower_hex(&Sha256::digest(prefix.as_bytes())),
        };
        let complete = format!(
            "{{\"type\":\"complete\",\"summary\":{}}}\n",
            serde_json::to_string(&summary).unwrap()
        );
        (fixture(format!("{prefix}{complete}").as_bytes()), summary)
    }

    fn metadata_input() -> ExternalColumnInput {
        ExternalColumnInput {
            offset: 0,
            byte_length: 1,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        }
    }

    fn raw_input() -> ExternalColumnInput {
        ExternalColumnInput {
            offset: 1,
            byte_length: 3,
            column_type: DocumentColumnType::Value,
            deflated: false,
        }
    }

    fn limits() -> ExternalValueTokenRunLimits {
        ExternalValueTokenRunLimits {
            max_run_bytes: 16 * 1024,
            max_line_bytes: 4 * 1024,
        }
    }

    #[test]
    fn verifies_the_value_run_and_exact_payload_spool() {
        let payload = b"abc";
        let (mut run, summary) = run_fixture(payload);
        let mut payload_spool = fixture(payload);
        let mut reader = ExternalValueTokenRunReader::open(
            run.as_file_mut(),
            payload_spool.as_file_mut(),
            4,
            &"00".repeat(32),
            metadata_input(),
            Some(raw_input()),
            &summary,
            limits(),
        )
        .unwrap();
        assert_eq!(
            reader.next_value().unwrap().unwrap(),
            ExternalValueToken {
                index: 0,
                value: ExternalScalarValue::Bytes {
                    payload_offset: 0,
                    byte_length: 3,
                },
            }
        );
        assert!(reader.next_value().unwrap().is_none());

        let (mut run, summary) = run_fixture(payload);
        let mut changed_payload_spool = fixture(b"abd");
        assert!(matches!(
            ExternalValueTokenRunReader::open(
                run.as_file_mut(),
                changed_payload_spool.as_file_mut(),
                4,
                &"00".repeat(32),
                metadata_input(),
                Some(raw_input()),
                &summary,
                limits(),
            ),
            Err(ExternalValueTokenRunError::PayloadLayout)
        ));
    }
}
