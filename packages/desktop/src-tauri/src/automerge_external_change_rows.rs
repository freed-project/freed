//! Bounded reconstruction of Automerge document change rows.
//!
//! This layer joins verified primitive and scalar token runs without
//! loading the change table or dependency graph into memory. Dependencies are
//! written as fixed-width little-endian indices in a separate spool.

use crate::automerge_external_column::{
    ExternalColumnDecodeSession, ExternalColumnDecodeSummary, ExternalColumnInput,
};
use crate::automerge_external_common::{lower_hex, ExternalHashingWriter};
use crate::automerge_external_document_run::{
    ExternalDocumentLayoutRunError, ExternalVerifiedDocumentLayout,
};
use crate::automerge_external_token_run::{
    ExternalColumnTokenRunError, ExternalColumnTokenRunLimits, ExternalColumnTokenRunReader,
    ExternalColumnTokenValue,
};
use crate::automerge_external_value::ExternalValueDecodeSummary;
use crate::automerge_external_value_run::{
    ExternalScalarValue, ExternalValueTokenRunError, ExternalValueTokenRunLimits,
    ExternalValueTokenRunReader,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::Write;

const CHANGE_ROW_SCHEMA_VERSION: u32 = 1;
pub(super) const ACTOR_SPECIFICATION: u32 = 1;
pub(super) const SEQUENCE_SPECIFICATION: u32 = 3;
pub(super) const MAX_OPERATION_SPECIFICATION: u32 = 19;
pub(super) const TIMESTAMP_SPECIFICATION: u32 = 35;
pub(super) const MESSAGE_SPECIFICATION: u32 = 53;
pub(super) const DEPENDENCY_COUNT_SPECIFICATION: u32 = 64;
pub(super) const DEPENDENCY_INDEX_SPECIFICATION: u32 = 67;
pub(super) const EXTRA_METADATA_SPECIFICATION: u32 = 86;
pub(super) const EXTRA_RAW_SPECIFICATION: u32 = 87;
const DEPENDENCY_INDEX_BYTES: u64 = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalChangeRowLimits {
    pub max_change_count: u64,
    pub max_dependencies_per_change: u64,
    pub max_total_dependencies: u64,
    pub max_message_bytes: u64,
    pub max_primitive_run_bytes: u64,
    pub max_scalar_run_bytes: u64,
    pub max_line_bytes: usize,
}

pub(super) struct ExternalPrimitiveChangeColumn<'a> {
    pub summary: &'a ExternalColumnDecodeSummary,
    pub run: &'a mut File,
}

pub(super) struct ExternalScalarChangeColumn<'a> {
    pub summary: &'a ExternalValueDecodeSummary,
    pub run: &'a mut File,
    pub payload_spool: &'a mut File,
}

pub(super) struct ExternalChangeColumns<'a> {
    pub actor: ExternalPrimitiveChangeColumn<'a>,
    pub sequence: ExternalPrimitiveChangeColumn<'a>,
    pub max_operation: ExternalPrimitiveChangeColumn<'a>,
    pub timestamp: ExternalPrimitiveChangeColumn<'a>,
    pub message: Option<ExternalPrimitiveChangeColumn<'a>>,
    pub dependency_count: ExternalPrimitiveChangeColumn<'a>,
    pub dependency_index: Option<ExternalPrimitiveChangeColumn<'a>>,
    pub extra: ExternalScalarChangeColumn<'a>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ExternalChangeRowSummary {
    pub change_count: u64,
    pub dependency_count: u64,
    pub dependency_spool_byte_length: u64,
    pub dependency_spool_sha256: String,
    pub extra_payload_spool_byte_length: u64,
    pub extra_payload_spool_sha256: String,
    pub row_run_prefix_byte_length: u64,
    pub row_run_prefix_sha256: String,
}

#[derive(Debug)]
pub(super) enum ExternalChangeRowError {
    Io(std::io::Error),
    ColumnRun(ExternalColumnTokenRunError),
    ValueRun(ExternalValueTokenRunError),
    LayoutRun(ExternalDocumentLayoutRunError),
    InvalidLimits,
    InvalidActorCount,
    InvalidColumnContract,
    ChangeCountLimit,
    DependencyCountLimit,
    TotalDependencyLimit,
    MessageByteLimit,
    RowCountMismatch,
    MissingDependencyColumn,
    UnexpectedDependencyColumn,
    InvalidActor,
    InvalidUnsigned,
    InvalidTimestamp,
    InvalidMessage,
    InvalidDependency,
    InvalidExtra,
    RangeOverflow,
}

impl From<std::io::Error> for ExternalChangeRowError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<ExternalColumnTokenRunError> for ExternalChangeRowError {
    fn from(error: ExternalColumnTokenRunError) -> Self {
        Self::ColumnRun(error)
    }
}

impl From<ExternalValueTokenRunError> for ExternalChangeRowError {
    fn from(error: ExternalValueTokenRunError) -> Self {
        Self::ValueRun(error)
    }
}

impl From<ExternalDocumentLayoutRunError> for ExternalChangeRowError {
    fn from(error: ExternalDocumentLayoutRunError) -> Self {
        Self::LayoutRun(error)
    }
}

impl fmt::Display for ExternalChangeRowError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge change row I/O failed: {error}"),
            Self::ColumnRun(error) => error.fmt(formatter),
            Self::ValueRun(error) => error.fmt(formatter),
            Self::LayoutRun(error) => error.fmt(formatter),
            Self::InvalidLimits => formatter.write_str("Automerge change row limits are invalid"),
            Self::InvalidActorCount => {
                formatter.write_str("Automerge change actor count is invalid")
            }
            Self::InvalidColumnContract => {
                formatter.write_str("Automerge change columns do not match the required schema")
            }
            Self::ChangeCountLimit => {
                formatter.write_str("Automerge changes exceed the admitted count")
            }
            Self::DependencyCountLimit => {
                formatter.write_str("Automerge change dependencies exceed the admitted row count")
            }
            Self::TotalDependencyLimit => {
                formatter.write_str("Automerge change dependencies exceed the admitted total")
            }
            Self::MessageByteLimit => {
                formatter.write_str("Automerge change message exceeds the admitted bytes")
            }
            Self::RowCountMismatch => {
                formatter.write_str("Automerge change column row counts do not agree")
            }
            Self::MissingDependencyColumn => {
                formatter.write_str("Automerge dependency values are missing")
            }
            Self::UnexpectedDependencyColumn => {
                formatter.write_str("Automerge dependency values are unexpectedly present")
            }
            Self::InvalidActor => formatter.write_str("Automerge change actor is invalid"),
            Self::InvalidUnsigned => {
                formatter.write_str("Automerge change unsigned value is invalid")
            }
            Self::InvalidTimestamp => formatter.write_str("Automerge change timestamp is invalid"),
            Self::InvalidMessage => formatter.write_str("Automerge change message is invalid"),
            Self::InvalidDependency => {
                formatter.write_str("Automerge change dependency is invalid")
            }
            Self::InvalidExtra => formatter.write_str("Automerge change extra value is invalid"),
            Self::RangeOverflow => formatter.write_str("Automerge change row range overflows"),
        }
    }
}

impl std::error::Error for ExternalChangeRowError {}

type ChangeResult<T> = Result<T, ExternalChangeRowError>;

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ChangeRowRecord<'a> {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: &'a str,
        #[serde(rename = "actorCount")]
        actor_count: u64,
    },
    Change {
        index: u64,
        #[serde(rename = "actorIndex")]
        actor_index: u64,
        sequence: u64,
        #[serde(rename = "maxOperation")]
        max_operation: u64,
        timestamp: i64,
        message: Option<&'a str>,
        #[serde(rename = "dependencyByteOffset")]
        dependency_byte_offset: u64,
        #[serde(rename = "dependencyCount")]
        dependency_count: u64,
        #[serde(rename = "extraPayloadOffset")]
        extra_payload_offset: u64,
        #[serde(rename = "extraByteLength")]
        extra_byte_length: u64,
    },
    Complete {
        summary: &'a ExternalChangeRowSummary,
    },
}

/// Join one exact set of verified Automerge change columns.
///
/// The column specifications must come from a verified document-layout reader.
/// The caller keeps both output files private until the enclosing verified
/// source session returns successfully.
pub(super) fn write_external_change_rows(
    session: &mut ExternalColumnDecodeSession<'_>,
    layout: &ExternalVerifiedDocumentLayout,
    columns: ExternalChangeColumns<'_>,
    limits: ExternalChangeRowLimits,
    dependency_spool: &mut impl Write,
    output: &mut impl Write,
) -> ChangeResult<ExternalChangeRowSummary> {
    session.with_source_context(|_, source_byte_length, source_sha256| {
        write_external_change_rows_in_session(
            source_byte_length,
            source_sha256,
            layout,
            columns,
            limits,
            dependency_spool,
            output,
        )
    })
}

fn write_external_change_rows_in_session(
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    columns: ExternalChangeColumns<'_>,
    limits: ExternalChangeRowLimits,
    dependency_spool: &mut impl Write,
    output: &mut impl Write,
) -> ChangeResult<ExternalChangeRowSummary> {
    validate_limits(limits)?;
    let layout_inputs = validate_layout(layout, source_byte_length, source_sha256)?;

    let ExternalChangeColumns {
        actor,
        sequence,
        max_operation,
        timestamp,
        message,
        dependency_count,
        dependency_index,
        extra,
    } = columns;
    let actor_count = layout.actor_count();
    let LayoutInputs {
        actor: actor_input,
        sequence: sequence_input,
        max_operation: max_operation_input,
        timestamp: timestamp_input,
        message: message_input,
        dependency_count: dependency_count_input,
        dependency_index: dependency_index_input,
        extra_metadata: extra_metadata_input,
        extra_raw: extra_raw_input,
    } = layout_inputs;
    if message.is_some() != message_input.is_some()
        || dependency_index.is_some() != dependency_index_input.is_some()
    {
        return Err(ExternalChangeRowError::InvalidColumnContract);
    }

    let primitive_limits = ExternalColumnTokenRunLimits {
        max_run_bytes: limits.max_primitive_run_bytes,
        max_line_bytes: limits.max_line_bytes,
    };
    let scalar_limits = ExternalValueTokenRunLimits {
        max_run_bytes: limits.max_scalar_run_bytes,
        max_line_bytes: limits.max_line_bytes,
    };
    let mut actors = ExternalColumnTokenRunReader::open(
        actor.run,
        source_byte_length,
        source_sha256,
        actor_input,
        actor.summary,
        primitive_limits,
    )?;
    let mut sequences = ExternalColumnTokenRunReader::open(
        sequence.run,
        source_byte_length,
        source_sha256,
        sequence_input,
        sequence.summary,
        primitive_limits,
    )?;
    let mut max_operations = ExternalColumnTokenRunReader::open(
        max_operation.run,
        source_byte_length,
        source_sha256,
        max_operation_input,
        max_operation.summary,
        primitive_limits,
    )?;
    let mut timestamps = ExternalColumnTokenRunReader::open(
        timestamp.run,
        source_byte_length,
        source_sha256,
        timestamp_input,
        timestamp.summary,
        primitive_limits,
    )?;
    let mut messages = message
        .zip(message_input)
        .map(|(column, input)| {
            ExternalColumnTokenRunReader::open(
                column.run,
                source_byte_length,
                source_sha256,
                input,
                column.summary,
                primitive_limits,
            )
        })
        .transpose()?;
    let mut dependency_counts = ExternalColumnTokenRunReader::open(
        dependency_count.run,
        source_byte_length,
        source_sha256,
        dependency_count_input,
        dependency_count.summary,
        primitive_limits,
    )?;
    let mut dependency_indices = dependency_index
        .zip(dependency_index_input)
        .map(|(column, input)| {
            ExternalColumnTokenRunReader::open(
                column.run,
                source_byte_length,
                source_sha256,
                input,
                column.summary,
                primitive_limits,
            )
        })
        .transpose()?;
    let mut extras = ExternalValueTokenRunReader::open(
        extra.run,
        extra.payload_spool,
        source_byte_length,
        source_sha256,
        extra_metadata_input,
        extra_raw_input,
        extra.summary,
        scalar_limits,
    )?;
    let extra_payload_receipt = extra.summary.clone();

    let mut hashed_output = ExternalHashingWriter::new(output);
    write_record(
        &mut hashed_output,
        &ChangeRowRecord::Begin {
            schema_version: CHANGE_ROW_SCHEMA_VERSION,
            source_byte_length,
            source_sha256,
            actor_count,
        },
    )?;

    let mut change_count = 0_u64;
    let mut total_dependency_count = 0_u64;
    let mut dependency_spool_byte_length = 0_u64;
    let mut dependency_hasher = Sha256::new();

    while let Some(actor_token) = actors.next_token()? {
        if change_count >= limits.max_change_count {
            return Err(ExternalChangeRowError::ChangeCountLimit);
        }
        let actor_index = required_unsigned(actor_token.value)?;
        if actor_index >= actor_count {
            return Err(ExternalChangeRowError::InvalidActor);
        }
        let sequence = required_nonnegative_delta(next_required(&mut sequences)?)?;
        let max_operation = required_nonnegative_delta(next_required(&mut max_operations)?)?;
        let timestamp = required_timestamp(next_required(&mut timestamps)?)?;
        let message = next_message(messages.as_mut())?;
        if message
            .as_ref()
            .is_some_and(|value| value.len() as u64 > limits.max_message_bytes)
        {
            return Err(ExternalChangeRowError::MessageByteLimit);
        }
        let row_dependency_count = required_unsigned(next_required(&mut dependency_counts)?)?;
        if row_dependency_count > limits.max_dependencies_per_change {
            return Err(ExternalChangeRowError::DependencyCountLimit);
        }
        total_dependency_count = total_dependency_count
            .checked_add(row_dependency_count)
            .ok_or(ExternalChangeRowError::RangeOverflow)?;
        if total_dependency_count > limits.max_total_dependencies {
            return Err(ExternalChangeRowError::TotalDependencyLimit);
        }
        let dependency_byte_offset = dependency_spool_byte_length;
        for _ in 0..row_dependency_count {
            let dependency = dependency_indices
                .as_mut()
                .ok_or(ExternalChangeRowError::MissingDependencyColumn)
                .and_then(next_required)
                .and_then(required_nonnegative_delta)?;
            if dependency >= change_count {
                return Err(ExternalChangeRowError::InvalidDependency);
            }
            let bytes = dependency.to_le_bytes();
            dependency_spool.write_all(&bytes)?;
            dependency_hasher.update(bytes);
            dependency_spool_byte_length = dependency_spool_byte_length
                .checked_add(DEPENDENCY_INDEX_BYTES)
                .ok_or(ExternalChangeRowError::RangeOverflow)?;
        }
        let extra_value = extras
            .next_value()?
            .ok_or(ExternalChangeRowError::RowCountMismatch)?;
        let (extra_payload_offset, extra_byte_length) = match extra_value.value {
            ExternalScalarValue::Bytes {
                payload_offset,
                byte_length,
            } => (payload_offset, byte_length),
            _ => return Err(ExternalChangeRowError::InvalidExtra),
        };
        write_record(
            &mut hashed_output,
            &ChangeRowRecord::Change {
                index: change_count,
                actor_index,
                sequence,
                max_operation,
                timestamp,
                message: message.as_deref(),
                dependency_byte_offset,
                dependency_count: row_dependency_count,
                extra_payload_offset,
                extra_byte_length,
            },
        )?;
        change_count = change_count
            .checked_add(1)
            .ok_or(ExternalChangeRowError::RangeOverflow)?;
    }

    if sequences.next_token()?.is_some()
        || max_operations.next_token()?.is_some()
        || timestamps.next_token()?.is_some()
        || dependency_counts.next_token()?.is_some()
        || extras.next_value()?.is_some()
        || messages
            .as_mut()
            .map(|reader| reader.next_token())
            .transpose()?
            .flatten()
            .is_some()
    {
        return Err(ExternalChangeRowError::RowCountMismatch);
    }
    if dependency_indices
        .as_mut()
        .map(|reader| reader.next_token())
        .transpose()?
        .flatten()
        .is_some()
    {
        return Err(ExternalChangeRowError::UnexpectedDependencyColumn);
    }
    if total_dependency_count == 0 && dependency_indices.is_some() {
        return Err(ExternalChangeRowError::UnexpectedDependencyColumn);
    }
    if total_dependency_count > 0 && dependency_indices.is_none() {
        return Err(ExternalChangeRowError::MissingDependencyColumn);
    }

    let (row_run_prefix_byte_length, row_run_prefix_sha256) = hashed_output.finish();
    let summary = ExternalChangeRowSummary {
        change_count,
        dependency_count: total_dependency_count,
        dependency_spool_byte_length,
        dependency_spool_sha256: lower_hex(&dependency_hasher.finalize()),
        extra_payload_spool_byte_length: extra_payload_receipt.payload_spool_byte_length,
        extra_payload_spool_sha256: extra_payload_receipt.payload_spool_sha256,
        row_run_prefix_byte_length,
        row_run_prefix_sha256,
    };
    write_record(output, &ChangeRowRecord::Complete { summary: &summary })?;
    Ok(summary)
}

fn validate_limits(limits: ExternalChangeRowLimits) -> ChangeResult<()> {
    if limits.max_change_count == 0
        || limits.max_dependencies_per_change == 0
        || limits.max_total_dependencies == 0
        || limits.max_message_bytes == 0
        || limits.max_primitive_run_bytes == 0
        || limits.max_scalar_run_bytes == 0
        || limits.max_line_bytes == 0
    {
        return Err(ExternalChangeRowError::InvalidLimits);
    }
    Ok(())
}

struct LayoutInputs {
    actor: ExternalColumnInput,
    sequence: ExternalColumnInput,
    max_operation: ExternalColumnInput,
    timestamp: ExternalColumnInput,
    message: Option<ExternalColumnInput>,
    dependency_count: ExternalColumnInput,
    dependency_index: Option<ExternalColumnInput>,
    extra_metadata: ExternalColumnInput,
    extra_raw: Option<ExternalColumnInput>,
}

fn validate_layout(
    layout: &ExternalVerifiedDocumentLayout,
    source_byte_length: u64,
    source_sha256: &str,
) -> ChangeResult<LayoutInputs> {
    if !layout.matches_source(source_byte_length, source_sha256) {
        return Err(ExternalChangeRowError::InvalidColumnContract);
    }
    if layout.actor_count() == 0 {
        return Err(ExternalChangeRowError::InvalidActorCount);
    }
    const ALLOWED_SPECIFICATIONS: [u32; 9] = [
        ACTOR_SPECIFICATION,
        SEQUENCE_SPECIFICATION,
        MAX_OPERATION_SPECIFICATION,
        TIMESTAMP_SPECIFICATION,
        MESSAGE_SPECIFICATION,
        DEPENDENCY_COUNT_SPECIFICATION,
        DEPENDENCY_INDEX_SPECIFICATION,
        EXTRA_METADATA_SPECIFICATION,
        EXTRA_RAW_SPECIFICATION,
    ];
    if layout
        .change_specifications()
        .any(|specification| !ALLOWED_SPECIFICATIONS.contains(&specification))
    {
        return Err(ExternalChangeRowError::InvalidColumnContract);
    }
    let required = |specification| {
        layout
            .change_column(specification)
            .map_err(ExternalChangeRowError::from)?
            .ok_or(ExternalChangeRowError::InvalidColumnContract)
    };
    Ok(LayoutInputs {
        actor: required(ACTOR_SPECIFICATION)?,
        sequence: required(SEQUENCE_SPECIFICATION)?,
        max_operation: required(MAX_OPERATION_SPECIFICATION)?,
        timestamp: required(TIMESTAMP_SPECIFICATION)?,
        message: layout.change_column(MESSAGE_SPECIFICATION)?,
        dependency_count: required(DEPENDENCY_COUNT_SPECIFICATION)?,
        dependency_index: layout.change_column(DEPENDENCY_INDEX_SPECIFICATION)?,
        extra_metadata: required(EXTRA_METADATA_SPECIFICATION)?,
        extra_raw: layout.change_column(EXTRA_RAW_SPECIFICATION)?,
    })
}

fn next_required(
    reader: &mut ExternalColumnTokenRunReader<'_>,
) -> ChangeResult<ExternalColumnTokenValue> {
    reader
        .next_token()?
        .map(|token| token.value)
        .ok_or(ExternalChangeRowError::RowCountMismatch)
}

fn required_unsigned(value: ExternalColumnTokenValue) -> ChangeResult<u64> {
    match value {
        ExternalColumnTokenValue::Unsigned(value) => value
            .parse::<u64>()
            .map_err(|_| ExternalChangeRowError::InvalidUnsigned),
        _ => Err(ExternalChangeRowError::InvalidUnsigned),
    }
}

fn required_nonnegative_delta(value: ExternalColumnTokenValue) -> ChangeResult<u64> {
    match value {
        ExternalColumnTokenValue::Signed(value) => value
            .parse::<i64>()
            .ok()
            .and_then(|value| u64::try_from(value).ok())
            .ok_or(ExternalChangeRowError::InvalidUnsigned),
        _ => Err(ExternalChangeRowError::InvalidUnsigned),
    }
}

fn required_timestamp(value: ExternalColumnTokenValue) -> ChangeResult<i64> {
    match value {
        ExternalColumnTokenValue::Signed(value) => value
            .parse::<i64>()
            .map_err(|_| ExternalChangeRowError::InvalidTimestamp),
        _ => Err(ExternalChangeRowError::InvalidTimestamp),
    }
}

fn next_message(
    reader: Option<&mut ExternalColumnTokenRunReader<'_>>,
) -> ChangeResult<Option<String>> {
    let Some(reader) = reader else {
        return Ok(None);
    };
    match next_required(reader)? {
        ExternalColumnTokenValue::Null => Ok(None),
        ExternalColumnTokenValue::String(value) => Ok(Some(value)),
        _ => Err(ExternalChangeRowError::InvalidMessage),
    }
}

fn write_record(output: &mut impl Write, record: &ChangeRowRecord<'_>) -> ChangeResult<()> {
    serde_json::to_writer(&mut *output, record)
        .map_err(|error| ExternalChangeRowError::Io(std::io::Error::other(error)))?;
    output.write_all(b"\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automerge_external_column::{
        with_verified_column_decode_session, ExternalColumnDecodeLimits,
    };
    use crate::automerge_external_common::{decode_test_hex, OFFICIAL_NONEMPTY_DOCUMENT_HEX};
    use crate::automerge_external_decoder::verify_chunk;
    use crate::automerge_external_document::{
        write_verified_document_layout, ExternalDocumentLayoutLimits,
    };
    use crate::automerge_external_document_run::{
        read_verified_document_layout, ExternalDocumentLayoutRunLimits,
    };
    use crate::automerge_external_row_run::{
        with_verified_change_rows, with_verified_change_rows_and_payload,
        ExternalRowRunConsumeError, ExternalRowRunError, ExternalRowRunLimits,
    };
    use crate::automerge_external_sqlite_stage::{
        stage_verified_change_rows, stage_verified_change_rows_with_test_fault,
        ExternalSqliteStageError,
    };
    use crate::automerge_external_value::{write_decoded_value_tokens, ExternalValueDecodeLimits};
    use rusqlite::Connection;
    use std::convert::Infallible;
    use std::io::{Read, Seek, SeekFrom};
    use tempfile::NamedTempFile;

    const TWO_CHANGE_DOCUMENT_HEX: &str = "856f4a831499aa09008b0101100123456789abcdef0123456789abcdef012634b9788580400fabbe7706673be5d73cbcf82a063623b209eed1852c4d0f6d080102030213022307350e4003430256020815052102230234014202560257028001020200020102017ec791a9d306007e056669727374067365636f6e647e00017f0002077e016101620200020102020102140102020001";

    type FixtureReconstruction = (
        ExternalChangeRowSummary,
        Vec<u8>,
        Vec<u8>,
        Vec<u8>,
        ExternalVerifiedDocumentLayout,
    );
    type FixtureResult = Result<FixtureReconstruction, Box<dyn std::error::Error>>;

    fn digest(bytes: &[u8]) -> String {
        lower_hex(&Sha256::digest(bytes))
    }

    fn fixture(bytes: &[u8]) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(bytes).unwrap();
        file.as_file_mut().sync_all().unwrap();
        file
    }

    fn column_limits() -> ExternalColumnDecodeLimits {
        ExternalColumnDecodeLimits {
            max_token_count: 128,
            max_decoded_column_bytes: 4 * 1024,
            max_string_bytes: 1024,
        }
    }

    fn value_limits() -> ExternalValueDecodeLimits {
        ExternalValueDecodeLimits {
            max_value_count: 128,
            max_decoded_raw_bytes: 4 * 1024,
            max_string_bytes: 1024,
            max_metadata_run_bytes: 16 * 1024,
            max_metadata_line_bytes: 4 * 1024,
        }
    }

    fn layout_limits() -> ExternalDocumentLayoutLimits {
        ExternalDocumentLayoutLimits {
            max_actor_count: 1_024,
            max_actor_byte_length: 1_024,
            max_total_actor_bytes: 1024 * 1024,
            max_head_count: 1_024,
            max_columns_per_section: 128,
        }
    }

    fn layout_run_limits() -> ExternalDocumentLayoutRunLimits {
        ExternalDocumentLayoutRunLimits {
            max_run_bytes: 1024 * 1024,
            max_line_bytes: 16 * 1024,
        }
    }

    fn change_limits() -> ExternalChangeRowLimits {
        ExternalChangeRowLimits {
            max_change_count: 128,
            max_dependencies_per_change: 32,
            max_total_dependencies: 512,
            max_message_bytes: 1024,
            max_primitive_run_bytes: 16 * 1024,
            max_scalar_run_bytes: 16 * 1024,
            max_line_bytes: 4 * 1024,
        }
    }

    fn row_run_limits() -> ExternalRowRunLimits {
        ExternalRowRunLimits {
            max_run_bytes: 1024 * 1024,
            max_line_bytes: 16 * 1024,
        }
    }

    fn reconstruct(bytes: &[u8]) -> FixtureResult {
        let source_byte_length = bytes.len() as u64;
        let source_sha256 = digest(bytes);
        let mut source = fixture(bytes);
        let descriptor = verify_chunk(source.as_file_mut(), 0, 0, source_byte_length, 1024 * 1024)?;
        let mut layout_run = NamedTempFile::new().unwrap();
        let layout_summary = write_verified_document_layout(
            source.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &descriptor,
            layout_limits(),
            layout_run.as_file_mut(),
        )?;
        layout_run.as_file_mut().sync_all()?;
        let layout = read_verified_document_layout(
            layout_run.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &descriptor,
            &layout_summary,
            layout_limits(),
            layout_run_limits(),
        )?;
        let required = |specification| -> Result<ExternalColumnInput, Box<dyn std::error::Error>> {
            layout
                .change_column(specification)?
                .ok_or_else(|| format!("missing fixture column {specification}").into())
        };
        let actor_input = required(ACTOR_SPECIFICATION)?;
        let sequence_input = required(SEQUENCE_SPECIFICATION)?;
        let max_operation_input = required(MAX_OPERATION_SPECIFICATION)?;
        let timestamp_input = required(TIMESTAMP_SPECIFICATION)?;
        let message_input = layout.change_column(MESSAGE_SPECIFICATION)?;
        let dependency_count_input = required(DEPENDENCY_COUNT_SPECIFICATION)?;
        let dependency_index_input = layout.change_column(DEPENDENCY_INDEX_SPECIFICATION)?;
        let extra_metadata_input = required(EXTRA_METADATA_SPECIFICATION)?;
        let extra_raw_input = layout.change_column(EXTRA_RAW_SPECIFICATION)?;

        let mut actor_run = NamedTempFile::new().unwrap();
        let mut sequence_run = NamedTempFile::new().unwrap();
        let mut max_operation_run = NamedTempFile::new().unwrap();
        let mut timestamp_run = NamedTempFile::new().unwrap();
        let mut message_run = NamedTempFile::new().unwrap();
        let mut dependency_count_run = NamedTempFile::new().unwrap();
        let mut dependency_index_run = NamedTempFile::new().unwrap();
        let mut extra_metadata_run = NamedTempFile::new().unwrap();
        let mut extra_value_run = NamedTempFile::new().unwrap();
        let mut extra_payload = NamedTempFile::new().unwrap();
        let mut dependency_spool = Vec::new();
        let mut rows = Vec::new();

        let summary = with_verified_column_decode_session(
            source.as_file_mut(),
            source_byte_length,
            &source_sha256,
            |session| -> Result<ExternalChangeRowSummary, Box<dyn std::error::Error>> {
                let actor_summary = session.write_decoded_column_tokens(
                    actor_input,
                    column_limits(),
                    actor_run.as_file_mut(),
                )?;
                let sequence_summary = session.write_decoded_column_tokens(
                    sequence_input,
                    column_limits(),
                    sequence_run.as_file_mut(),
                )?;
                let max_operation_summary = session.write_decoded_column_tokens(
                    max_operation_input,
                    column_limits(),
                    max_operation_run.as_file_mut(),
                )?;
                let timestamp_summary = session.write_decoded_column_tokens(
                    timestamp_input,
                    column_limits(),
                    timestamp_run.as_file_mut(),
                )?;
                let message_summary = message_input
                    .map(|column| {
                        session.write_decoded_column_tokens(
                            column,
                            column_limits(),
                            message_run.as_file_mut(),
                        )
                    })
                    .transpose()?;
                let dependency_count_summary = session.write_decoded_column_tokens(
                    dependency_count_input,
                    column_limits(),
                    dependency_count_run.as_file_mut(),
                )?;
                let dependency_index_summary = dependency_index_input
                    .map(|column| {
                        session.write_decoded_column_tokens(
                            column,
                            column_limits(),
                            dependency_index_run.as_file_mut(),
                        )
                    })
                    .transpose()?;
                let extra_metadata_summary = session.write_decoded_column_tokens(
                    extra_metadata_input,
                    column_limits(),
                    extra_metadata_run.as_file_mut(),
                )?;
                let extra_summary = write_decoded_value_tokens(
                    session,
                    extra_metadata_input,
                    &extra_metadata_summary,
                    extra_metadata_run.as_file_mut(),
                    extra_raw_input,
                    value_limits(),
                    extra_payload.as_file_mut(),
                    extra_value_run.as_file_mut(),
                )?;
                let message = match (message_input, message_summary.as_ref()) {
                    (Some(_), Some(summary)) => Some(ExternalPrimitiveChangeColumn {
                        summary,
                        run: message_run.as_file_mut(),
                    }),
                    (None, None) => None,
                    _ => unreachable!("message input and summary are constructed together"),
                };
                let dependency_index =
                    match (dependency_index_input, dependency_index_summary.as_ref()) {
                        (Some(_), Some(summary)) => Some(ExternalPrimitiveChangeColumn {
                            summary,
                            run: dependency_index_run.as_file_mut(),
                        }),
                        (None, None) => None,
                        _ => {
                            unreachable!("dependency input and summary are constructed together")
                        }
                    };
                Ok(write_external_change_rows(
                    session,
                    &layout,
                    ExternalChangeColumns {
                        actor: ExternalPrimitiveChangeColumn {
                            summary: &actor_summary,
                            run: actor_run.as_file_mut(),
                        },
                        sequence: ExternalPrimitiveChangeColumn {
                            summary: &sequence_summary,
                            run: sequence_run.as_file_mut(),
                        },
                        max_operation: ExternalPrimitiveChangeColumn {
                            summary: &max_operation_summary,
                            run: max_operation_run.as_file_mut(),
                        },
                        timestamp: ExternalPrimitiveChangeColumn {
                            summary: &timestamp_summary,
                            run: timestamp_run.as_file_mut(),
                        },
                        message,
                        dependency_count: ExternalPrimitiveChangeColumn {
                            summary: &dependency_count_summary,
                            run: dependency_count_run.as_file_mut(),
                        },
                        dependency_index,
                        extra: ExternalScalarChangeColumn {
                            summary: &extra_summary,
                            run: extra_value_run.as_file_mut(),
                            payload_spool: extra_payload.as_file_mut(),
                        },
                    },
                    change_limits(),
                    &mut dependency_spool,
                    &mut rows,
                )?)
            },
        )?;
        extra_payload.as_file_mut().seek(SeekFrom::Start(0))?;
        let mut extra_payload_bytes = Vec::new();
        extra_payload
            .as_file_mut()
            .read_to_end(&mut extra_payload_bytes)?;
        Ok((summary, dependency_spool, extra_payload_bytes, rows, layout))
    }

    fn change_records(rows: &[u8]) -> Vec<serde_json::Value> {
        std::str::from_utf8(rows)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .filter(|record: &serde_json::Value| record["type"] == "change")
            .collect()
    }

    #[test]
    fn reconstructs_the_official_change_row_without_a_resident_dependency_graph() {
        let bytes = decode_test_hex(OFFICIAL_NONEMPTY_DOCUMENT_HEX);
        let (summary, dependency_spool, extra_payload, rows, _) = reconstruct(&bytes).unwrap();
        assert_eq!(summary.change_count, 1);
        assert_eq!(summary.dependency_count, 0);
        assert_eq!(summary.dependency_spool_byte_length, 0);
        assert!(dependency_spool.is_empty());
        assert_eq!(summary.dependency_spool_sha256, digest(&[]));
        assert_eq!(
            summary.extra_payload_spool_byte_length,
            extra_payload.len() as u64
        );
        assert_eq!(summary.extra_payload_spool_sha256, digest(&extra_payload));
        assert!(summary.row_run_prefix_byte_length > 0);
        assert_eq!(summary.row_run_prefix_sha256.len(), 64);
        let changes = change_records(&rows);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["actorIndex"], 0);
        assert_eq!(changes[0]["sequence"], 1);
        assert_eq!(changes[0]["maxOperation"], 7);
        assert_eq!(changes[0]["timestamp"], 1785347609_i64);
        assert_eq!(changes[0]["dependencyCount"], 0);
        assert_eq!(changes[0]["extraByteLength"], 0);
    }

    #[test]
    fn spools_dependencies_and_preserves_optional_messages_for_multiple_changes() {
        let bytes = decode_test_hex(TWO_CHANGE_DOCUMENT_HEX);
        let (summary, dependency_spool, _, rows, _) = reconstruct(&bytes).unwrap();

        assert_eq!(summary.change_count, 2);
        assert_eq!(summary.dependency_count, 1);
        assert_eq!(summary.dependency_spool_byte_length, 8);
        assert_eq!(dependency_spool, 0_u64.to_le_bytes());
        assert_eq!(summary.dependency_spool_sha256, digest(&dependency_spool));
        let changes = change_records(&rows);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0]["sequence"], 1);
        assert_eq!(changes[0]["message"], "first");
        assert_eq!(changes[0]["dependencyCount"], 0);
        assert_eq!(changes[1]["sequence"], 2);
        assert_eq!(changes[1]["message"], "second");
        assert_eq!(changes[1]["dependencyByteOffset"], 0);
        assert_eq!(changes[1]["dependencyCount"], 1);
    }

    #[test]
    fn verifies_complete_change_rows_and_rejects_a_changed_dependency_spool() {
        let bytes = decode_test_hex(TWO_CHANGE_DOCUMENT_HEX);
        let source_byte_length = bytes.len() as u64;
        let source_sha256 = digest(&bytes);
        let (summary, dependency_spool, extra_payload, rows, layout) = reconstruct(&bytes).unwrap();
        let mut row_file = fixture(&rows);
        let mut dependency_file = fixture(&dependency_spool);
        let mut extra_payload_file = fixture(&extra_payload);
        let mut verified = Vec::new();

        let read_summary = with_verified_change_rows(
            row_file.as_file_mut(),
            dependency_file.as_file_mut(),
            extra_payload_file.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &layout,
            &summary,
            change_limits(),
            row_run_limits(),
            |row| {
                verified.push(row.clone());
                Ok::<(), Infallible>(())
            },
        )
        .unwrap();

        assert_eq!(read_summary, summary);
        assert_eq!(verified.len(), 2);
        assert_eq!(verified[0].dependencies, Vec::<u64>::new());
        assert_eq!(verified[1].dependencies, vec![0]);

        let mut streamed_extra = Vec::new();
        let mut descriptor_bytes = 0_u64;
        with_verified_change_rows_and_payload(
            row_file.as_file_mut(),
            dependency_file.as_file_mut(),
            extra_payload_file.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &layout,
            &summary,
            change_limits(),
            row_run_limits(),
            |_row, payload| {
                descriptor_bytes += payload.byte_length();
                payload.copy_to(&mut streamed_extra)?;
                Ok::<(), ExternalRowRunError>(())
            },
        )
        .unwrap();
        assert_eq!(descriptor_bytes, summary.extra_payload_spool_byte_length);
        assert_eq!(streamed_extra, extra_payload);

        let first_line_end = rows.iter().position(|byte| *byte == b'\n').unwrap();
        let mut trailing_row_file = fixture(&rows);
        trailing_row_file
            .as_file_mut()
            .seek(SeekFrom::End(0))
            .unwrap();
        trailing_row_file
            .as_file_mut()
            .write_all(&rows[..=first_line_end])
            .unwrap();
        trailing_row_file.as_file_mut().sync_all().unwrap();
        let mut consumer_calls = 0_u64;
        assert!(matches!(
            with_verified_change_rows(
                trailing_row_file.as_file_mut(),
                dependency_file.as_file_mut(),
                extra_payload_file.as_file_mut(),
                source_byte_length,
                &source_sha256,
                &layout,
                &summary,
                change_limits(),
                row_run_limits(),
                |_| {
                    consumer_calls += 1;
                    Ok::<(), Infallible>(())
                }
            ),
            Err(ExternalRowRunConsumeError::Run(
                ExternalRowRunError::ContractMismatch
            ))
        ));
        assert_eq!(consumer_calls, 0);

        dependency_file
            .as_file_mut()
            .seek(SeekFrom::Start(0))
            .unwrap();
        dependency_file
            .as_file_mut()
            .write_all(&1_u64.to_le_bytes())
            .unwrap();
        dependency_file.as_file_mut().sync_all().unwrap();
        assert!(matches!(
            with_verified_change_rows(
                row_file.as_file_mut(),
                dependency_file.as_file_mut(),
                extra_payload_file.as_file_mut(),
                source_byte_length,
                &source_sha256,
                &layout,
                &summary,
                change_limits(),
                row_run_limits(),
                |_| Ok::<(), Infallible>(())
            ),
            Err(ExternalRowRunConsumeError::Run(
                ExternalRowRunError::SpoolMismatch
            ))
        ));
    }

    #[test]
    fn stages_verified_changes_atomically_and_rejects_incomplete_receipts() {
        let bytes = decode_test_hex(TWO_CHANGE_DOCUMENT_HEX);
        let source_byte_length = bytes.len() as u64;
        let source_sha256 = digest(&bytes);
        let (summary, dependency_spool, extra_payload, rows, layout) = reconstruct(&bytes).unwrap();
        let mut row_file = fixture(&rows);
        let mut dependency_file = fixture(&dependency_spool);
        let mut extra_payload_file = fixture(&extra_payload);
        let mut connection = Connection::open_in_memory().unwrap();

        let receipt = stage_verified_change_rows(
            &mut connection,
            row_file.as_file_mut(),
            dependency_file.as_file_mut(),
            extra_payload_file.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &layout,
            &summary,
            change_limits(),
            row_run_limits(),
        )
        .unwrap();
        assert_eq!(receipt.source_byte_length, source_byte_length);
        assert_eq!(receipt.source_sha256, source_sha256);
        assert_eq!(receipt.summary, summary);
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM external_changes;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            summary.change_count as i64
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM external_change_dependencies;",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            summary.dependency_count as i64
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM external_actors;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            layout.actor_count() as i64
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM external_heads;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            layout.head_count() as i64
        );
        let mut statement = connection
            .prepare("SELECT extraPayload FROM external_changes ORDER BY changeIndex;")
            .unwrap();
        let stored_payloads = statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .concat();
        assert_eq!(stored_payloads, extra_payload);
        drop(statement);

        let retried = stage_verified_change_rows(
            &mut connection,
            row_file.as_file_mut(),
            dependency_file.as_file_mut(),
            extra_payload_file.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &layout,
            &summary,
            change_limits(),
            row_run_limits(),
        )
        .unwrap();
        assert_eq!(retried, receipt);

        let mut interrupted_connection = Connection::open_in_memory().unwrap();
        assert!(matches!(
            stage_verified_change_rows_with_test_fault(
                &mut interrupted_connection,
                row_file.as_file_mut(),
                dependency_file.as_file_mut(),
                extra_payload_file.as_file_mut(),
                source_byte_length,
                &source_sha256,
                &layout,
                &summary,
                change_limits(),
                row_run_limits(),
                0,
            ),
            Err(ExternalSqliteStageError::ReceiptConflict)
        ));
        assert_eq!(
            interrupted_connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table';",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );

        let mut mixed_connection = Connection::open_in_memory().unwrap();
        stage_verified_change_rows(
            &mut mixed_connection,
            row_file.as_file_mut(),
            dependency_file.as_file_mut(),
            extra_payload_file.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &layout,
            &summary,
            change_limits(),
            row_run_limits(),
        )
        .unwrap();
        mixed_connection
            .execute(
                "INSERT INTO external_operation_stage_receipt (\
                 singleton, sourceByteLength, sourceSha256, operationCount, successorCount, \
                 successorSpoolByteLength, successorSpoolSha256, valuePayloadSpoolByteLength, \
                 valuePayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256) \
                 VALUES (1, ?1, ?2, 0, 0, 0, ?2, 0, ?2, 0, ?2);",
                rusqlite::params![source_byte_length as i64 + 1, source_sha256],
            )
            .unwrap();
        assert!(matches!(
            stage_verified_change_rows(
                &mut mixed_connection,
                row_file.as_file_mut(),
                dependency_file.as_file_mut(),
                extra_payload_file.as_file_mut(),
                source_byte_length,
                &source_sha256,
                &layout,
                &summary,
                change_limits(),
                row_run_limits(),
            ),
            Err(ExternalSqliteStageError::ReceiptConflict)
        ));
        mixed_connection
            .execute("DELETE FROM external_operation_stage_receipt;", [])
            .unwrap();
        mixed_connection
            .execute(
                "UPDATE external_actors \
                 SET actorId = 'ffffffffffffffffffffffffffffffff' \
                 WHERE actorIndex = 0;",
                [],
            )
            .unwrap();
        assert!(matches!(
            stage_verified_change_rows(
                &mut mixed_connection,
                row_file.as_file_mut(),
                dependency_file.as_file_mut(),
                extra_payload_file.as_file_mut(),
                source_byte_length,
                &source_sha256,
                &layout,
                &summary,
                change_limits(),
                row_run_limits(),
            ),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));

        connection
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .unwrap();
        connection
            .execute(
                "UPDATE external_changes SET actorIndex = 999 \
                 WHERE changeIndex = (SELECT MIN(changeIndex) FROM external_changes);",
                [],
            )
            .unwrap();
        assert!(matches!(
            stage_verified_change_rows(
                &mut connection,
                row_file.as_file_mut(),
                dependency_file.as_file_mut(),
                extra_payload_file.as_file_mut(),
                source_byte_length,
                &source_sha256,
                &layout,
                &summary,
                change_limits(),
                row_run_limits(),
            ),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }
}
