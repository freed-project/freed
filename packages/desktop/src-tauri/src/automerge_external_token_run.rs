//! Verified bounded readers for derived Automerge column token runs.
//!
//! Every higher-layer join uses this one contract. The reader binds the run to
//! its exact source column and prefix receipt, enforces contiguous token
//! indexes, and rejects truncation or trailing records.

use crate::automerge_external_column::{
    ExternalColumnDecodeSummary, ExternalColumnInput, COLUMN_TOKEN_SCHEMA_VERSION,
};
use crate::automerge_external_common::lower_hex;
use crate::automerge_external_document::DocumentColumnType;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Take};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalColumnTokenRunLimits {
    pub max_run_bytes: u64,
    pub max_line_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum ExternalColumnTokenValue {
    Null,
    Unsigned(String),
    Signed(String),
    Boolean(bool),
    String(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalColumnToken {
    pub index: u64,
    pub value: ExternalColumnTokenValue,
}

#[derive(Debug)]
pub(super) enum ExternalColumnTokenRunError {
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidLimits,
    RunTooLarge,
    LineTooLarge,
    Truncated,
    ContractMismatch,
    TokenOrder,
    RangeOverflow,
}

impl From<std::io::Error> for ExternalColumnTokenRunError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ExternalColumnTokenRunError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl fmt::Display for ExternalColumnTokenRunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge token run I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "Automerge token run JSON is invalid: {error}"),
            Self::InvalidLimits => formatter.write_str("Automerge token run limits are invalid"),
            Self::RunTooLarge => {
                formatter.write_str("Automerge token run exceeds the admitted bytes")
            }
            Self::LineTooLarge => {
                formatter.write_str("Automerge token line exceeds the admitted bytes")
            }
            Self::Truncated => formatter.write_str("Automerge token run is truncated"),
            Self::ContractMismatch => {
                formatter.write_str("Automerge token run does not match its contract")
            }
            Self::TokenOrder => formatter.write_str("Automerge tokens are not contiguous"),
            Self::RangeOverflow => formatter.write_str("Automerge token run range overflows"),
        }
    }
}

impl std::error::Error for ExternalColumnTokenRunError {}

type TokenRunResult<T> = Result<T, ExternalColumnTokenRunError>;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ColumnRecord {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: String,
        offset: u64,
        #[serde(rename = "byteLength")]
        byte_length: u64,
        #[serde(rename = "columnType")]
        column_type: DocumentColumnType,
        deflated: bool,
    },
    Token {
        index: u64,
        token: ColumnTokenValue,
    },
    Complete {
        summary: ExternalColumnDecodeSummary,
    },
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum ColumnTokenValue {
    Null,
    Unsigned(String),
    Signed(String),
    Boolean(bool),
    String(String),
}

impl From<ColumnTokenValue> for ExternalColumnTokenValue {
    fn from(value: ColumnTokenValue) -> Self {
        match value {
            ColumnTokenValue::Null => Self::Null,
            ColumnTokenValue::Unsigned(value) => Self::Unsigned(value),
            ColumnTokenValue::Signed(value) => Self::Signed(value),
            ColumnTokenValue::Boolean(value) => Self::Boolean(value),
            ColumnTokenValue::String(value) => Self::String(value),
        }
    }
}

pub(super) struct ExternalColumnTokenRunReader<'a> {
    reader: BufReader<Take<&'a mut File>>,
    expected_summary: ExternalColumnDecodeSummary,
    prefix_hasher: Sha256,
    prefix_byte_length: u64,
    next_index: u64,
    maximum_line_bytes: usize,
    complete: bool,
}

impl<'a> ExternalColumnTokenRunReader<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn open(
        run: &'a mut File,
        source_byte_length: u64,
        source_sha256: &str,
        input: ExternalColumnInput,
        summary: &ExternalColumnDecodeSummary,
        limits: ExternalColumnTokenRunLimits,
    ) -> TokenRunResult<Self> {
        if limits.max_run_bytes == 0 || limits.max_line_bytes == 0 {
            return Err(ExternalColumnTokenRunError::InvalidLimits);
        }
        let run_byte_length = run.metadata()?.len();
        if run_byte_length > limits.max_run_bytes {
            return Err(ExternalColumnTokenRunError::RunTooLarge);
        }
        run.seek(SeekFrom::Start(0))?;
        let mut reader = BufReader::new(run.take(run_byte_length));
        let (record, line) = next_record(&mut reader, limits.max_line_bytes)?
            .ok_or(ExternalColumnTokenRunError::Truncated)?;
        let ColumnRecord::Begin {
            schema_version,
            source_byte_length: recorded_source_byte_length,
            source_sha256: recorded_source_sha256,
            offset,
            byte_length,
            column_type,
            deflated,
        } = record
        else {
            return Err(ExternalColumnTokenRunError::ContractMismatch);
        };
        if schema_version != COLUMN_TOKEN_SCHEMA_VERSION
            || recorded_source_byte_length != source_byte_length
            || recorded_source_sha256 != source_sha256
            || offset != input.offset
            || byte_length != input.byte_length
            || column_type != input.column_type
            || deflated != input.deflated
        {
            return Err(ExternalColumnTokenRunError::ContractMismatch);
        }
        let mut result = Self {
            reader,
            expected_summary: summary.clone(),
            prefix_hasher: Sha256::new(),
            prefix_byte_length: 0,
            next_index: 0,
            maximum_line_bytes: limits.max_line_bytes,
            complete: false,
        };
        result.hash_line(&line)?;
        Ok(result)
    }

    pub(super) fn next_token(&mut self) -> TokenRunResult<Option<ExternalColumnToken>> {
        if self.complete {
            return Ok(None);
        }
        let (record, line) = next_record(&mut self.reader, self.maximum_line_bytes)?
            .ok_or(ExternalColumnTokenRunError::Truncated)?;
        match record {
            ColumnRecord::Token { index, token } => {
                if index != self.next_index {
                    return Err(ExternalColumnTokenRunError::TokenOrder);
                }
                self.hash_line(&line)?;
                self.next_index = self
                    .next_index
                    .checked_add(1)
                    .ok_or(ExternalColumnTokenRunError::RangeOverflow)?;
                Ok(Some(ExternalColumnToken {
                    index,
                    value: token.into(),
                }))
            }
            ColumnRecord::Complete { summary } => {
                let prefix_sha256 = lower_hex(&self.prefix_hasher.clone().finalize());
                if summary != self.expected_summary
                    || summary.token_count != self.next_index
                    || summary.token_run_prefix_byte_length != self.prefix_byte_length
                    || summary.token_run_prefix_sha256 != prefix_sha256
                    || next_record(&mut self.reader, self.maximum_line_bytes)?.is_some()
                {
                    return Err(ExternalColumnTokenRunError::ContractMismatch);
                }
                self.complete = true;
                Ok(None)
            }
            ColumnRecord::Begin { .. } => Err(ExternalColumnTokenRunError::ContractMismatch),
        }
    }

    fn hash_line(&mut self, line: &[u8]) -> TokenRunResult<()> {
        self.prefix_hasher.update(line);
        self.prefix_hasher.update(b"\n");
        self.prefix_byte_length = self
            .prefix_byte_length
            .checked_add(line.len() as u64)
            .and_then(|length| length.checked_add(1))
            .ok_or(ExternalColumnTokenRunError::RangeOverflow)?;
        Ok(())
    }
}

fn next_record(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> TokenRunResult<Option<(ColumnRecord, Vec<u8>)>> {
    let Some(line) = read_bounded_line(reader, maximum_line_bytes)? else {
        return Ok(None);
    };
    let record = serde_json::from_slice(&line)?;
    Ok(Some((record, line)))
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> TokenRunResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(ExternalColumnTokenRunError::Truncated)
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if line
                .len()
                .checked_add(newline)
                .is_none_or(|length| length > maximum_line_bytes)
            {
                return Err(ExternalColumnTokenRunError::LineTooLarge);
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
            return Err(ExternalColumnTokenRunError::LineTooLarge);
        }
        let consumed = available.len();
        line.extend_from_slice(available);
        reader.consume(consumed);
    }
}
