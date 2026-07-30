//! Receipt-bound readers for externally reconstructed Automerge rows.
//!
//! Reconstruction writers emit bounded JSONL row runs plus fixed-width and
//! payload spools. These readers make a complete verification pass before any
//! row reaches a consumer, then make a second pass while rechecking the exact
//! prefix receipt. Consumers may stage rows inside an uncommitted transaction
//! and commit only after this function returns successfully.

use crate::automerge_external_change_rows::{ExternalChangeRowLimits, ExternalChangeRowSummary};
use crate::automerge_external_common::{is_lower_sha256, lower_hex};
use crate::automerge_external_document_run::ExternalVerifiedDocumentLayout;
use crate::automerge_external_operation_rows::{
    ExternalOperationRowLimits, ExternalOperationRowSummary, ObjectReference, OperationKey,
    OperationScalar,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::fmt;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};

const CHANGE_ROW_SCHEMA_VERSION: u32 = 1;
const OPERATION_ROW_SCHEMA_VERSION: u32 = 1;
const DEPENDENCY_INDEX_BYTES: u64 = 8;
const SUCCESSOR_ID_BYTES: u64 = 16;
const MAX_SUPPORTED_ACTION: u64 = 7;
const HASH_BUFFER_BYTES: usize = 64 * 1024;
const PAYLOAD_COPY_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalRowRunLimits {
    pub max_run_bytes: u64,
    pub max_line_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalVerifiedChangeRow {
    pub index: u64,
    pub actor_index: u64,
    pub sequence: u64,
    pub max_operation: u64,
    pub timestamp: i64,
    pub message: Option<String>,
    pub dependencies: Vec<u64>,
    pub extra_payload_offset: u64,
    pub extra_byte_length: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalVerifiedOperationId {
    pub actor_index: u64,
    pub counter: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalVerifiedOperationRow {
    pub index: u64,
    pub id: ExternalVerifiedOperationId,
    pub object: ObjectReference,
    pub key: OperationKey,
    pub insert: bool,
    pub action: u64,
    pub value: OperationScalar,
    pub successors: Vec<ExternalVerifiedOperationId>,
    pub expand: bool,
    pub mark_name: Option<String>,
}

/// Exact payload range attached to one verified external row.
///
/// The reader exposes no arbitrary seek. A consumer can therefore stream only
/// the bytes named by the current receipt-bound row into its uncommitted
/// destination transaction. The enclosing row reader rehashes the complete
/// spool after consumption, so callers commit only after it returns success.
pub(super) struct ExternalVerifiedPayloadReader<'a> {
    file: &'a mut File,
    offset: u64,
    byte_length: u64,
}

impl ExternalVerifiedPayloadReader<'_> {
    fn new(file: &mut File, offset: u64, byte_length: u64) -> ExternalVerifiedPayloadReader<'_> {
        ExternalVerifiedPayloadReader {
            file,
            offset,
            byte_length,
        }
    }

    pub(super) fn byte_length(&self) -> u64 {
        self.byte_length
    }

    /// Streams the exact row-owned payload through a fixed 64 KiB buffer.
    pub(super) fn copy_to(&mut self, output: &mut impl Write) -> RowRunResult<u64> {
        self.file.seek(SeekFrom::Start(self.offset))?;
        let mut remaining = self.byte_length;
        let mut copied = 0_u64;
        let mut buffer = [0_u8; PAYLOAD_COPY_BUFFER_BYTES];
        while remaining > 0 {
            let read_limit = usize::try_from(remaining.min(buffer.len() as u64))
                .map_err(|_| ExternalRowRunError::RangeOverflow)?;
            self.file.read_exact(&mut buffer[..read_limit])?;
            output.write_all(&buffer[..read_limit])?;
            remaining -= read_limit as u64;
            copied = copied
                .checked_add(read_limit as u64)
                .ok_or(ExternalRowRunError::RangeOverflow)?;
        }
        Ok(copied)
    }
}

#[derive(Debug)]
pub(super) enum ExternalRowRunError {
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidLimits,
    InvalidSource,
    InvalidSummary,
    RunTooLarge,
    LineTooLarge,
    Truncated,
    ContractMismatch,
    RecordOrder,
    InvalidActor,
    InvalidOperation,
    InvalidDependency,
    InvalidSuccessor,
    InvalidPayloadRange,
    SpoolMismatch,
    RangeOverflow,
}

impl From<std::io::Error> for ExternalRowRunError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ExternalRowRunError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl fmt::Display for ExternalRowRunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge row run I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "Automerge row run JSON is invalid: {error}"),
            Self::InvalidLimits => formatter.write_str("Automerge row run limits are invalid"),
            Self::InvalidSource => formatter.write_str("Automerge row run source is invalid"),
            Self::InvalidSummary => formatter.write_str("Automerge row run summary is invalid"),
            Self::RunTooLarge => formatter.write_str("Automerge row run exceeds admitted bytes"),
            Self::LineTooLarge => formatter.write_str("Automerge row line exceeds admitted bytes"),
            Self::Truncated => formatter.write_str("Automerge row run is truncated"),
            Self::ContractMismatch => {
                formatter.write_str("Automerge row run does not match its receipt")
            }
            Self::RecordOrder => formatter.write_str("Automerge row records are not contiguous"),
            Self::InvalidActor => formatter.write_str("Automerge row actor is invalid"),
            Self::InvalidOperation => formatter.write_str("Automerge operation row is invalid"),
            Self::InvalidDependency => formatter.write_str("Automerge dependency row is invalid"),
            Self::InvalidSuccessor => formatter.write_str("Automerge successor row is invalid"),
            Self::InvalidPayloadRange => {
                formatter.write_str("Automerge row payload range is invalid")
            }
            Self::SpoolMismatch => {
                formatter.write_str("Automerge row spool does not match receipt")
            }
            Self::RangeOverflow => formatter.write_str("Automerge row range overflows"),
        }
    }
}

impl std::error::Error for ExternalRowRunError {}

#[derive(Debug)]
pub(super) enum ExternalRowRunConsumeError<E> {
    Run(ExternalRowRunError),
    Consumer(E),
}

impl<E: fmt::Display> fmt::Display for ExternalRowRunConsumeError<E> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Run(error) => error.fmt(formatter),
            Self::Consumer(error) => write!(formatter, "Automerge row consumer failed: {error}"),
        }
    }
}

impl<E: fmt::Debug + fmt::Display> std::error::Error for ExternalRowRunConsumeError<E> {}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum StoredChangeRecord {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: String,
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
        message: Option<String>,
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
        summary: ExternalChangeRowSummary,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum StoredOperationRecord {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: String,
        #[serde(rename = "actorCount")]
        actor_count: u64,
    },
    Operation {
        index: u64,
        #[serde(rename = "idActorIndex")]
        id_actor_index: u64,
        #[serde(rename = "idCounter")]
        id_counter: u64,
        object: ObjectReference,
        key: OperationKey,
        insert: bool,
        action: u64,
        value: OperationScalar,
        #[serde(rename = "successorByteOffset")]
        successor_byte_offset: u64,
        #[serde(rename = "successorCount")]
        successor_count: u64,
        expand: bool,
        #[serde(rename = "markName")]
        mark_name: Option<String>,
    },
    Complete {
        summary: ExternalOperationRowSummary,
    },
}

type RowRunResult<T> = Result<T, ExternalRowRunError>;

#[allow(clippy::too_many_arguments)]
pub(super) fn with_verified_change_rows<E>(
    row_run: &mut File,
    dependency_spool: &mut File,
    extra_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalChangeRowSummary,
    row_limits: ExternalChangeRowLimits,
    run_limits: ExternalRowRunLimits,
    mut consumer: impl FnMut(&ExternalVerifiedChangeRow) -> Result<(), E>,
) -> Result<ExternalChangeRowSummary, ExternalRowRunConsumeError<E>> {
    with_verified_change_rows_and_payload(
        row_run,
        dependency_spool,
        extra_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |row, _payload| consumer(row),
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn with_verified_change_rows_and_payload<E>(
    row_run: &mut File,
    dependency_spool: &mut File,
    extra_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalChangeRowSummary,
    row_limits: ExternalChangeRowLimits,
    run_limits: ExternalRowRunLimits,
    mut consumer: impl FnMut(
        &ExternalVerifiedChangeRow,
        &mut ExternalVerifiedPayloadReader<'_>,
    ) -> Result<(), E>,
) -> Result<ExternalChangeRowSummary, ExternalRowRunConsumeError<E>> {
    validate_common_contract(
        row_run,
        source_byte_length,
        source_sha256,
        layout,
        run_limits,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    validate_change_summary(expected_summary, source_byte_length, row_limits)
        .map_err(ExternalRowRunConsumeError::Run)?;
    verify_file_receipt(
        dependency_spool,
        expected_summary.dependency_spool_byte_length,
        &expected_summary.dependency_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    verify_file_receipt(
        extra_payload_spool,
        expected_summary.extra_payload_spool_byte_length,
        &expected_summary.extra_payload_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;

    let first_summary = scan_change_rows(
        row_run,
        dependency_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        extra_payload_spool,
        |_, _| Ok::<(), Infallible>(()),
    )
    .map_err(|error| match error {
        ExternalRowRunConsumeError::Run(error) => ExternalRowRunConsumeError::Run(error),
        ExternalRowRunConsumeError::Consumer(error) => match error {},
    })?;
    let second_summary = scan_change_rows(
        row_run,
        dependency_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        extra_payload_spool,
        |row, payload| consumer(row, payload),
    )?;
    if first_summary != second_summary {
        return Err(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::ContractMismatch,
        ));
    }
    verify_file_receipt(
        dependency_spool,
        expected_summary.dependency_spool_byte_length,
        &expected_summary.dependency_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    verify_file_receipt(
        extra_payload_spool,
        expected_summary.extra_payload_spool_byte_length,
        &expected_summary.extra_payload_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    Ok(second_summary)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn with_verified_operation_rows<E>(
    row_run: &mut File,
    successor_spool: &mut File,
    value_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalOperationRowSummary,
    row_limits: ExternalOperationRowLimits,
    run_limits: ExternalRowRunLimits,
    mut consumer: impl FnMut(&ExternalVerifiedOperationRow) -> Result<(), E>,
) -> Result<ExternalOperationRowSummary, ExternalRowRunConsumeError<E>> {
    with_verified_operation_rows_and_payload(
        row_run,
        successor_spool,
        value_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |row, _payload| consumer(row),
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn with_verified_operation_rows_and_payload<E>(
    row_run: &mut File,
    successor_spool: &mut File,
    value_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalOperationRowSummary,
    row_limits: ExternalOperationRowLimits,
    run_limits: ExternalRowRunLimits,
    mut consumer: impl FnMut(
        &ExternalVerifiedOperationRow,
        &mut ExternalVerifiedPayloadReader<'_>,
    ) -> Result<(), E>,
) -> Result<ExternalOperationRowSummary, ExternalRowRunConsumeError<E>> {
    validate_common_contract(
        row_run,
        source_byte_length,
        source_sha256,
        layout,
        run_limits,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    validate_operation_summary(expected_summary, source_byte_length, row_limits)
        .map_err(ExternalRowRunConsumeError::Run)?;
    verify_file_receipt(
        successor_spool,
        expected_summary.successor_spool_byte_length,
        &expected_summary.successor_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    verify_file_receipt(
        value_payload_spool,
        expected_summary.value_payload_spool_byte_length,
        &expected_summary.value_payload_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;

    let first_summary = scan_operation_rows(
        row_run,
        successor_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        value_payload_spool,
        |_, _| Ok::<(), Infallible>(()),
    )
    .map_err(|error| match error {
        ExternalRowRunConsumeError::Run(error) => ExternalRowRunConsumeError::Run(error),
        ExternalRowRunConsumeError::Consumer(error) => match error {},
    })?;
    let second_summary = scan_operation_rows(
        row_run,
        successor_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        value_payload_spool,
        |row, payload| consumer(row, payload),
    )?;
    if first_summary != second_summary {
        return Err(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::ContractMismatch,
        ));
    }
    verify_file_receipt(
        successor_spool,
        expected_summary.successor_spool_byte_length,
        &expected_summary.successor_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    verify_file_receipt(
        value_payload_spool,
        expected_summary.value_payload_spool_byte_length,
        &expected_summary.value_payload_spool_sha256,
    )
    .map_err(ExternalRowRunConsumeError::Run)?;
    Ok(second_summary)
}

#[allow(clippy::too_many_arguments)]
fn scan_change_rows<E>(
    row_run: &mut File,
    dependency_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalChangeRowSummary,
    row_limits: ExternalChangeRowLimits,
    run_limits: ExternalRowRunLimits,
    extra_payload_spool: &mut File,
    mut consumer: impl FnMut(
        &ExternalVerifiedChangeRow,
        &mut ExternalVerifiedPayloadReader<'_>,
    ) -> Result<(), E>,
) -> Result<ExternalChangeRowSummary, ExternalRowRunConsumeError<E>> {
    row_run
        .seek(SeekFrom::Start(0))
        .map_err(ExternalRowRunError::from)
        .map_err(ExternalRowRunConsumeError::Run)?;
    let run_byte_length = row_run
        .metadata()
        .map_err(ExternalRowRunError::from)
        .map_err(ExternalRowRunConsumeError::Run)?
        .len();
    let mut reader = BufReader::new(row_run.take(run_byte_length));
    let (begin, line) = next_change_record(&mut reader, run_limits.max_line_bytes)
        .map_err(ExternalRowRunConsumeError::Run)?
        .ok_or(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::Truncated,
        ))?;
    let StoredChangeRecord::Begin {
        schema_version,
        source_byte_length: recorded_source_length,
        source_sha256: recorded_source_sha256,
        actor_count,
    } = begin
    else {
        return Err(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::ContractMismatch,
        ));
    };
    if schema_version != CHANGE_ROW_SCHEMA_VERSION
        || recorded_source_length != source_byte_length
        || recorded_source_sha256 != source_sha256
        || actor_count != layout.actor_count()
    {
        return Err(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::ContractMismatch,
        ));
    }
    let mut hasher = Sha256::new();
    let mut prefix_byte_length = 0_u64;
    hash_line(&mut hasher, &mut prefix_byte_length, &line)
        .map_err(ExternalRowRunConsumeError::Run)?;
    let mut next_index = 0_u64;
    let mut dependency_byte_offset = 0_u64;
    let mut extra_payload_end = 0_u64;
    loop {
        let (record, line) = next_change_record(&mut reader, run_limits.max_line_bytes)
            .map_err(ExternalRowRunConsumeError::Run)?
            .ok_or(ExternalRowRunConsumeError::Run(
                ExternalRowRunError::Truncated,
            ))?;
        match record {
            StoredChangeRecord::Change {
                index,
                actor_index,
                sequence,
                max_operation,
                timestamp,
                message,
                dependency_byte_offset: recorded_dependency_offset,
                dependency_count,
                extra_payload_offset,
                extra_byte_length,
            } => {
                if index != next_index {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::RecordOrder,
                    ));
                }
                if actor_index >= actor_count {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::InvalidActor,
                    ));
                }
                if message
                    .as_ref()
                    .is_some_and(|value| value.len() as u64 > row_limits.max_message_bytes)
                    || dependency_count > row_limits.max_dependencies_per_change
                    || recorded_dependency_offset != dependency_byte_offset
                    || extra_payload_offset != extra_payload_end
                {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::ContractMismatch,
                    ));
                }
                let dependencies = read_dependencies(
                    dependency_spool,
                    recorded_dependency_offset,
                    dependency_count,
                    index,
                )
                .map_err(ExternalRowRunConsumeError::Run)?;
                dependency_byte_offset = dependency_byte_offset
                    .checked_add(dependency_count.checked_mul(DEPENDENCY_INDEX_BYTES).ok_or(
                        ExternalRowRunConsumeError::Run(ExternalRowRunError::RangeOverflow),
                    )?)
                    .ok_or(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::RangeOverflow,
                    ))?;
                extra_payload_end = extra_payload_offset.checked_add(extra_byte_length).ok_or(
                    ExternalRowRunConsumeError::Run(ExternalRowRunError::RangeOverflow),
                )?;
                if extra_payload_end > expected_summary.extra_payload_spool_byte_length {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::InvalidPayloadRange,
                    ));
                }
                let row = ExternalVerifiedChangeRow {
                    index,
                    actor_index,
                    sequence,
                    max_operation,
                    timestamp,
                    message,
                    dependencies,
                    extra_payload_offset,
                    extra_byte_length,
                };
                hash_line(&mut hasher, &mut prefix_byte_length, &line)
                    .map_err(ExternalRowRunConsumeError::Run)?;
                let mut payload = ExternalVerifiedPayloadReader::new(
                    extra_payload_spool,
                    row.extra_payload_offset,
                    row.extra_byte_length,
                );
                consumer(&row, &mut payload).map_err(ExternalRowRunConsumeError::Consumer)?;
                next_index = next_index
                    .checked_add(1)
                    .ok_or(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::RangeOverflow,
                    ))?;
            }
            StoredChangeRecord::Complete { summary } => {
                let prefix_sha256 = lower_hex(&hasher.finalize());
                if summary != *expected_summary
                    || summary.change_count != next_index
                    || summary.dependency_spool_byte_length != dependency_byte_offset
                    || summary.extra_payload_spool_byte_length != extra_payload_end
                    || summary.row_run_prefix_byte_length != prefix_byte_length
                    || summary.row_run_prefix_sha256 != prefix_sha256
                    || next_change_record(&mut reader, run_limits.max_line_bytes)
                        .map_err(ExternalRowRunConsumeError::Run)?
                        .is_some()
                {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::ContractMismatch,
                    ));
                }
                return Ok(summary);
            }
            StoredChangeRecord::Begin { .. } => {
                return Err(ExternalRowRunConsumeError::Run(
                    ExternalRowRunError::ContractMismatch,
                ));
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn scan_operation_rows<E>(
    row_run: &mut File,
    successor_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalOperationRowSummary,
    row_limits: ExternalOperationRowLimits,
    run_limits: ExternalRowRunLimits,
    value_payload_spool: &mut File,
    mut consumer: impl FnMut(
        &ExternalVerifiedOperationRow,
        &mut ExternalVerifiedPayloadReader<'_>,
    ) -> Result<(), E>,
) -> Result<ExternalOperationRowSummary, ExternalRowRunConsumeError<E>> {
    row_run
        .seek(SeekFrom::Start(0))
        .map_err(ExternalRowRunError::from)
        .map_err(ExternalRowRunConsumeError::Run)?;
    let run_byte_length = row_run
        .metadata()
        .map_err(ExternalRowRunError::from)
        .map_err(ExternalRowRunConsumeError::Run)?
        .len();
    let mut reader = BufReader::new(row_run.take(run_byte_length));
    let (begin, line) = next_operation_record(&mut reader, run_limits.max_line_bytes)
        .map_err(ExternalRowRunConsumeError::Run)?
        .ok_or(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::Truncated,
        ))?;
    let StoredOperationRecord::Begin {
        schema_version,
        source_byte_length: recorded_source_length,
        source_sha256: recorded_source_sha256,
        actor_count,
    } = begin
    else {
        return Err(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::ContractMismatch,
        ));
    };
    if schema_version != OPERATION_ROW_SCHEMA_VERSION
        || recorded_source_length != source_byte_length
        || recorded_source_sha256 != source_sha256
        || actor_count != layout.actor_count()
    {
        return Err(ExternalRowRunConsumeError::Run(
            ExternalRowRunError::ContractMismatch,
        ));
    }
    let mut hasher = Sha256::new();
    let mut prefix_byte_length = 0_u64;
    hash_line(&mut hasher, &mut prefix_byte_length, &line)
        .map_err(ExternalRowRunConsumeError::Run)?;
    let mut next_index = 0_u64;
    let mut successor_byte_offset = 0_u64;
    let mut value_payload_end = 0_u64;
    loop {
        let (record, line) = next_operation_record(&mut reader, run_limits.max_line_bytes)
            .map_err(ExternalRowRunConsumeError::Run)?
            .ok_or(ExternalRowRunConsumeError::Run(
                ExternalRowRunError::Truncated,
            ))?;
        match record {
            StoredOperationRecord::Operation {
                index,
                id_actor_index,
                id_counter,
                object,
                key,
                insert,
                action,
                value,
                successor_byte_offset: recorded_successor_offset,
                successor_count,
                expand,
                mark_name,
            } => {
                if index != next_index {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::RecordOrder,
                    ));
                }
                validate_operation_identity(actor_count, id_actor_index, id_counter)
                    .map_err(ExternalRowRunConsumeError::Run)?;
                validate_object(actor_count, &object).map_err(ExternalRowRunConsumeError::Run)?;
                validate_key(actor_count, &key, row_limits.max_key_bytes)
                    .map_err(ExternalRowRunConsumeError::Run)?;
                let payload_range = scalar_payload_range(
                    &value,
                    value_payload_end,
                    expected_summary.value_payload_spool_byte_length,
                )
                .map_err(ExternalRowRunConsumeError::Run)?;
                value_payload_end = payload_range.0.checked_add(payload_range.1).ok_or(
                    ExternalRowRunConsumeError::Run(ExternalRowRunError::RangeOverflow),
                )?;
                if action > MAX_SUPPORTED_ACTION
                    || successor_count > row_limits.max_successors_per_operation
                    || recorded_successor_offset != successor_byte_offset
                    || mark_name
                        .as_ref()
                        .is_some_and(|name| name.len() as u64 > row_limits.max_mark_name_bytes)
                {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::InvalidOperation,
                    ));
                }
                let successors = read_successors(
                    successor_spool,
                    recorded_successor_offset,
                    successor_count,
                    layout,
                )
                .map_err(ExternalRowRunConsumeError::Run)?;
                successor_byte_offset = successor_byte_offset
                    .checked_add(successor_count.checked_mul(SUCCESSOR_ID_BYTES).ok_or(
                        ExternalRowRunConsumeError::Run(ExternalRowRunError::RangeOverflow),
                    )?)
                    .ok_or(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::RangeOverflow,
                    ))?;
                let row = ExternalVerifiedOperationRow {
                    index,
                    id: ExternalVerifiedOperationId {
                        actor_index: id_actor_index,
                        counter: id_counter,
                    },
                    object,
                    key,
                    insert,
                    action,
                    value,
                    successors,
                    expand,
                    mark_name,
                };
                hash_line(&mut hasher, &mut prefix_byte_length, &line)
                    .map_err(ExternalRowRunConsumeError::Run)?;
                let mut payload = ExternalVerifiedPayloadReader::new(
                    value_payload_spool,
                    payload_range.0,
                    payload_range.1,
                );
                consumer(&row, &mut payload).map_err(ExternalRowRunConsumeError::Consumer)?;
                next_index = next_index
                    .checked_add(1)
                    .ok_or(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::RangeOverflow,
                    ))?;
            }
            StoredOperationRecord::Complete { summary } => {
                let prefix_sha256 = lower_hex(&hasher.finalize());
                if summary != *expected_summary
                    || summary.operation_count != next_index
                    || summary.successor_spool_byte_length != successor_byte_offset
                    || summary.value_payload_spool_byte_length != value_payload_end
                    || summary.row_run_prefix_byte_length != prefix_byte_length
                    || summary.row_run_prefix_sha256 != prefix_sha256
                    || next_operation_record(&mut reader, run_limits.max_line_bytes)
                        .map_err(ExternalRowRunConsumeError::Run)?
                        .is_some()
                {
                    return Err(ExternalRowRunConsumeError::Run(
                        ExternalRowRunError::ContractMismatch,
                    ));
                }
                return Ok(summary);
            }
            StoredOperationRecord::Begin { .. } => {
                return Err(ExternalRowRunConsumeError::Run(
                    ExternalRowRunError::ContractMismatch,
                ));
            }
        }
    }
}

fn validate_common_contract(
    row_run: &File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    limits: ExternalRowRunLimits,
) -> RowRunResult<()> {
    if source_byte_length == 0
        || !is_lower_sha256(source_sha256)
        || !layout.matches_source(source_byte_length, source_sha256)
    {
        return Err(ExternalRowRunError::InvalidSource);
    }
    if limits.max_run_bytes == 0 || limits.max_line_bytes == 0 {
        return Err(ExternalRowRunError::InvalidLimits);
    }
    if row_run.metadata()?.len() > limits.max_run_bytes {
        return Err(ExternalRowRunError::RunTooLarge);
    }
    Ok(())
}

fn validate_change_summary(
    summary: &ExternalChangeRowSummary,
    source_byte_length: u64,
    limits: ExternalChangeRowLimits,
) -> RowRunResult<()> {
    if limits.max_change_count == 0
        || limits.max_dependencies_per_change == 0
        || limits.max_total_dependencies == 0
        || limits.max_message_bytes == 0
        || limits.max_line_bytes == 0
        || summary.change_count > limits.max_change_count
        || summary.dependency_count > limits.max_total_dependencies
        || summary.dependency_spool_byte_length
            != summary
                .dependency_count
                .checked_mul(DEPENDENCY_INDEX_BYTES)
                .ok_or(ExternalRowRunError::RangeOverflow)?
        || summary.extra_payload_spool_byte_length > source_byte_length
        || !valid_receipt(
            summary.dependency_spool_byte_length,
            &summary.dependency_spool_sha256,
        )
        || !valid_receipt(
            summary.extra_payload_spool_byte_length,
            &summary.extra_payload_spool_sha256,
        )
        || !valid_receipt(
            summary.row_run_prefix_byte_length,
            &summary.row_run_prefix_sha256,
        )
    {
        return Err(ExternalRowRunError::InvalidSummary);
    }
    Ok(())
}

fn validate_operation_summary(
    summary: &ExternalOperationRowSummary,
    source_byte_length: u64,
    limits: ExternalOperationRowLimits,
) -> RowRunResult<()> {
    if limits.max_operation_count == 0
        || limits.max_successors_per_operation == 0
        || limits.max_total_successors == 0
        || limits.max_key_bytes == 0
        || limits.max_mark_name_bytes == 0
        || limits.max_line_bytes == 0
        || summary.operation_count > limits.max_operation_count
        || summary.successor_count > limits.max_total_successors
        || summary.successor_spool_byte_length
            != summary
                .successor_count
                .checked_mul(SUCCESSOR_ID_BYTES)
                .ok_or(ExternalRowRunError::RangeOverflow)?
        || summary.value_payload_spool_byte_length > source_byte_length
        || !valid_receipt(
            summary.successor_spool_byte_length,
            &summary.successor_spool_sha256,
        )
        || !valid_receipt(
            summary.value_payload_spool_byte_length,
            &summary.value_payload_spool_sha256,
        )
        || !valid_receipt(
            summary.row_run_prefix_byte_length,
            &summary.row_run_prefix_sha256,
        )
    {
        return Err(ExternalRowRunError::InvalidSummary);
    }
    Ok(())
}

fn valid_receipt(byte_length: u64, sha256: &str) -> bool {
    is_lower_sha256(sha256) && (byte_length > 0 || sha256 == lower_hex(&Sha256::digest([])))
}

fn verify_file_receipt(
    file: &mut File,
    expected_length: u64,
    expected_sha256: &str,
) -> RowRunResult<()> {
    if file.metadata()?.len() != expected_length || !is_lower_sha256(expected_sha256) {
        return Err(ExternalRowRunError::SpoolMismatch);
    }
    file.seek(SeekFrom::Start(0))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; HASH_BUFFER_BYTES];
    let mut remaining = expected_length;
    while remaining > 0 {
        let read_limit = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| ExternalRowRunError::RangeOverflow)?;
        let count = file.read(&mut buffer[..read_limit])?;
        if count == 0 {
            return Err(ExternalRowRunError::Truncated);
        }
        hasher.update(&buffer[..count]);
        remaining -= count as u64;
    }
    let mut trailing = [0_u8; 1];
    if file.read(&mut trailing)? != 0 || lower_hex(&hasher.finalize()) != expected_sha256 {
        return Err(ExternalRowRunError::SpoolMismatch);
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(())
}

fn read_dependencies(
    spool: &mut File,
    offset: u64,
    count: u64,
    change_index: u64,
) -> RowRunResult<Vec<u64>> {
    let capacity = usize::try_from(count).map_err(|_| ExternalRowRunError::RangeOverflow)?;
    let mut dependencies = Vec::with_capacity(capacity);
    spool.seek(SeekFrom::Start(offset))?;
    for _ in 0..count {
        let mut bytes = [0_u8; DEPENDENCY_INDEX_BYTES as usize];
        spool.read_exact(&mut bytes)?;
        let dependency = u64::from_le_bytes(bytes);
        if dependency >= change_index {
            return Err(ExternalRowRunError::InvalidDependency);
        }
        dependencies.push(dependency);
    }
    Ok(dependencies)
}

fn read_successors(
    spool: &mut File,
    offset: u64,
    count: u64,
    layout: &ExternalVerifiedDocumentLayout,
) -> RowRunResult<Vec<ExternalVerifiedOperationId>> {
    let capacity = usize::try_from(count).map_err(|_| ExternalRowRunError::RangeOverflow)?;
    let mut successors = Vec::with_capacity(capacity);
    let mut previous: Option<(u64, &str)> = None;
    spool.seek(SeekFrom::Start(offset))?;
    for _ in 0..count {
        let mut actor_bytes = [0_u8; 8];
        let mut counter_bytes = [0_u8; 8];
        spool.read_exact(&mut actor_bytes)?;
        spool.read_exact(&mut counter_bytes)?;
        let actor_index = u64::from_le_bytes(actor_bytes);
        let counter = u64::from_le_bytes(counter_bytes);
        let actor_id = usize::try_from(actor_index)
            .ok()
            .and_then(|index| layout.actor_id(index))
            .ok_or(ExternalRowRunError::InvalidSuccessor)?;
        if counter == 0
            || previous
                .as_ref()
                .is_some_and(|(previous_counter, previous_actor)| {
                    (*previous_counter, *previous_actor) >= (counter, actor_id)
                })
        {
            return Err(ExternalRowRunError::InvalidSuccessor);
        }
        previous = Some((counter, actor_id));
        successors.push(ExternalVerifiedOperationId {
            actor_index,
            counter,
        });
    }
    Ok(successors)
}

fn validate_operation_identity(
    actor_count: u64,
    actor_index: u64,
    counter: u64,
) -> RowRunResult<()> {
    if actor_index >= actor_count || counter == 0 {
        return Err(ExternalRowRunError::InvalidOperation);
    }
    Ok(())
}

fn validate_object(actor_count: u64, object: &ObjectReference) -> RowRunResult<()> {
    if let ObjectReference::Operation {
        actor_index,
        counter,
    } = object
    {
        if *actor_index >= actor_count || *counter == 0 {
            return Err(ExternalRowRunError::InvalidOperation);
        }
    }
    Ok(())
}

fn validate_key(actor_count: u64, key: &OperationKey, max_key_bytes: u64) -> RowRunResult<()> {
    match key {
        OperationKey::Property { name } if name.len() as u64 <= max_key_bytes => Ok(()),
        OperationKey::Head => Ok(()),
        OperationKey::Element {
            actor_index,
            counter,
        } if *actor_index < actor_count && *counter > 0 => Ok(()),
        _ => Err(ExternalRowRunError::InvalidOperation),
    }
}

fn scalar_payload_range(
    value: &OperationScalar,
    expected_offset: u64,
    payload_byte_length: u64,
) -> RowRunResult<(u64, u64)> {
    let end = scalar_payload_end(value, expected_offset)?;
    if end > payload_byte_length {
        return Err(ExternalRowRunError::InvalidPayloadRange);
    }
    Ok((expected_offset, end - expected_offset))
}

fn scalar_payload_end(value: &OperationScalar, expected_offset: u64) -> RowRunResult<u64> {
    let range = match value {
        OperationScalar::String {
            payload_offset,
            byte_length,
        }
        | OperationScalar::Bytes {
            payload_offset,
            byte_length,
        }
        | OperationScalar::Unknown {
            payload_offset,
            byte_length,
            ..
        } => Some((*payload_offset, *byte_length)),
        _ => None,
    };
    match range {
        Some((offset, length)) if offset == expected_offset => offset
            .checked_add(length)
            .ok_or(ExternalRowRunError::RangeOverflow),
        Some(_) => Err(ExternalRowRunError::InvalidPayloadRange),
        None => Ok(expected_offset),
    }
}

fn hash_line(hasher: &mut Sha256, byte_length: &mut u64, line: &[u8]) -> RowRunResult<()> {
    hasher.update(line);
    hasher.update(b"\n");
    *byte_length = byte_length
        .checked_add(line.len() as u64)
        .and_then(|length| length.checked_add(1))
        .ok_or(ExternalRowRunError::RangeOverflow)?;
    Ok(())
}

fn next_change_record(
    reader: &mut impl BufRead,
    max_line_bytes: usize,
) -> RowRunResult<Option<(StoredChangeRecord, Vec<u8>)>> {
    let Some(line) = read_bounded_line(reader, max_line_bytes)? else {
        return Ok(None);
    };
    Ok(Some((serde_json::from_slice(&line)?, line)))
}

fn next_operation_record(
    reader: &mut impl BufRead,
    max_line_bytes: usize,
) -> RowRunResult<Option<(StoredOperationRecord, Vec<u8>)>> {
    let Some(line) = read_bounded_line(reader, max_line_bytes)? else {
        return Ok(None);
    };
    Ok(Some((serde_json::from_slice(&line)?, line)))
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    max_line_bytes: usize,
) -> RowRunResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(ExternalRowRunError::Truncated)
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if line
                .len()
                .checked_add(newline)
                .is_none_or(|length| length > max_line_bytes)
            {
                return Err(ExternalRowRunError::LineTooLarge);
            }
            line.extend_from_slice(&available[..newline]);
            reader.consume(newline + 1);
            return Ok(Some(line));
        }
        if line
            .len()
            .checked_add(available.len())
            .is_none_or(|length| length > max_line_bytes)
        {
            return Err(ExternalRowRunError::LineTooLarge);
        }
        let consumed = available.len();
        line.extend_from_slice(available);
        reader.consume(consumed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[derive(Default)]
    struct ChunkRecorder {
        bytes: Vec<u8>,
        maximum_write: usize,
    }

    impl Write for ChunkRecorder {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.maximum_write = self.maximum_write.max(bytes.len());
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn payload_reader_exposes_only_its_range_through_fixed_chunks() {
        let prefix = vec![0x11; 17];
        let payload = (0..(PAYLOAD_COPY_BUFFER_BYTES * 3 + 29))
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let suffix = vec![0x22; 19];
        let mut file = NamedTempFile::new().expect("payload spool");
        file.write_all(&prefix).expect("prefix");
        file.write_all(&payload).expect("payload");
        file.write_all(&suffix).expect("suffix");
        file.as_file_mut().sync_all().expect("sync");

        let mut reader = ExternalVerifiedPayloadReader::new(
            file.as_file_mut(),
            prefix.len() as u64,
            payload.len() as u64,
        );
        let mut output = ChunkRecorder::default();
        let copied = reader.copy_to(&mut output).expect("copy exact range");

        assert_eq!(reader.byte_length(), payload.len() as u64);
        assert_eq!(copied, payload.len() as u64);
        assert_eq!(output.bytes, payload);
        assert!(output.maximum_write <= PAYLOAD_COPY_BUFFER_BYTES);
    }
}
