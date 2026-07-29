//! Bounded reconstruction of Automerge document operation rows.
//!
//! This dormant layer joins receipt-bound primitive and scalar token runs
//! without retaining the operation table, value payloads, or successor graph.
//! Successor operation IDs are written to a fixed-width spool. No command or
//! production caller activates this module.

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

const OPERATION_ROW_SCHEMA_VERSION: u32 = 1;
const OBJECT_ACTOR_SPECIFICATION: u32 = 1;
const OBJECT_COUNTER_SPECIFICATION: u32 = 2;
const KEY_ACTOR_SPECIFICATION: u32 = 17;
const KEY_COUNTER_SPECIFICATION: u32 = 19;
const KEY_STRING_SPECIFICATION: u32 = 21;
const ID_ACTOR_SPECIFICATION: u32 = 33;
const ID_COUNTER_SPECIFICATION: u32 = 35;
const INSERT_SPECIFICATION: u32 = 52;
const ACTION_SPECIFICATION: u32 = 66;
const VALUE_METADATA_SPECIFICATION: u32 = 86;
const VALUE_RAW_SPECIFICATION: u32 = 87;
const SUCCESSOR_COUNT_SPECIFICATION: u32 = 128;
const SUCCESSOR_ACTOR_SPECIFICATION: u32 = 129;
const SUCCESSOR_COUNTER_SPECIFICATION: u32 = 131;
const EXPAND_SPECIFICATION: u32 = 148;
const MARK_NAME_SPECIFICATION: u32 = 165;
const SUCCESSOR_ID_BYTES: u64 = 16;
const MAX_SUPPORTED_ACTION: u64 = 7;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalOperationRowLimits {
    pub max_operation_count: u64,
    pub max_successors_per_operation: u64,
    pub max_total_successors: u64,
    pub max_key_bytes: u64,
    pub max_mark_name_bytes: u64,
    pub max_primitive_run_bytes: u64,
    pub max_scalar_run_bytes: u64,
    pub max_line_bytes: usize,
}

pub(super) struct ExternalPrimitiveOperationColumn<'a> {
    pub summary: &'a ExternalColumnDecodeSummary,
    pub run: &'a mut File,
}

pub(super) struct ExternalScalarOperationColumn<'a> {
    pub summary: &'a ExternalValueDecodeSummary,
    pub run: &'a mut File,
    pub payload_spool: &'a mut File,
}

#[derive(Default)]
pub(super) struct ExternalOperationColumns<'a> {
    pub object_actor: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub object_counter: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub key_actor: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub key_counter: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub key_string: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub id_actor: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub id_counter: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub insert: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub action: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub value: Option<ExternalScalarOperationColumn<'a>>,
    pub successor_count: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub successor_actor: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub successor_counter: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub expand: Option<ExternalPrimitiveOperationColumn<'a>>,
    pub mark_name: Option<ExternalPrimitiveOperationColumn<'a>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ExternalOperationRowSummary {
    pub operation_count: u64,
    pub successor_count: u64,
    pub successor_spool_byte_length: u64,
    pub successor_spool_sha256: String,
    pub value_payload_spool_byte_length: u64,
    pub value_payload_spool_sha256: String,
    pub row_run_prefix_byte_length: u64,
    pub row_run_prefix_sha256: String,
}

#[derive(Debug)]
pub(super) enum ExternalOperationRowError {
    Io(std::io::Error),
    ColumnRun(ExternalColumnTokenRunError),
    ValueRun(ExternalValueTokenRunError),
    LayoutRun(ExternalDocumentLayoutRunError),
    InvalidLimits,
    InvalidActorCount,
    InvalidColumnContract,
    OperationCountLimit,
    SuccessorCountLimit,
    TotalSuccessorLimit,
    KeyByteLimit,
    MarkNameByteLimit,
    RowCountMismatch,
    InvalidOperationId,
    InvalidObject,
    InvalidKey,
    InvalidBoolean,
    InvalidAction,
    InvalidSuccessor,
    InvalidMarkName,
    MissingSuccessorColumns,
    UnexpectedSuccessorColumns,
    RangeOverflow,
}

impl From<std::io::Error> for ExternalOperationRowError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<ExternalColumnTokenRunError> for ExternalOperationRowError {
    fn from(error: ExternalColumnTokenRunError) -> Self {
        Self::ColumnRun(error)
    }
}

impl From<ExternalValueTokenRunError> for ExternalOperationRowError {
    fn from(error: ExternalValueTokenRunError) -> Self {
        Self::ValueRun(error)
    }
}

impl From<ExternalDocumentLayoutRunError> for ExternalOperationRowError {
    fn from(error: ExternalDocumentLayoutRunError) -> Self {
        Self::LayoutRun(error)
    }
}

impl fmt::Display for ExternalOperationRowError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge operation row I/O failed: {error}"),
            Self::ColumnRun(error) => error.fmt(formatter),
            Self::ValueRun(error) => error.fmt(formatter),
            Self::LayoutRun(error) => error.fmt(formatter),
            Self::InvalidLimits => {
                formatter.write_str("Automerge operation row limits are invalid")
            }
            Self::InvalidActorCount => {
                formatter.write_str("Automerge operation actor count is invalid")
            }
            Self::InvalidColumnContract => {
                formatter.write_str("Automerge operation columns do not match the required schema")
            }
            Self::OperationCountLimit => {
                formatter.write_str("Automerge operations exceed the admitted count")
            }
            Self::SuccessorCountLimit => {
                formatter.write_str("Automerge successors exceed the admitted row count")
            }
            Self::TotalSuccessorLimit => {
                formatter.write_str("Automerge successors exceed the admitted total")
            }
            Self::KeyByteLimit => formatter.write_str("Automerge key exceeds the admitted bytes"),
            Self::MarkNameByteLimit => {
                formatter.write_str("Automerge mark name exceeds the admitted bytes")
            }
            Self::RowCountMismatch => {
                formatter.write_str("Automerge operation column row counts do not agree")
            }
            Self::InvalidOperationId => formatter.write_str("Automerge operation ID is invalid"),
            Self::InvalidObject => formatter.write_str("Automerge object ID is invalid"),
            Self::InvalidKey => formatter.write_str("Automerge operation key is invalid"),
            Self::InvalidBoolean => formatter.write_str("Automerge boolean is invalid"),
            Self::InvalidAction => formatter.write_str("Automerge action is unsupported"),
            Self::InvalidSuccessor => formatter.write_str("Automerge successor ID is invalid"),
            Self::InvalidMarkName => formatter.write_str("Automerge mark name is invalid"),
            Self::MissingSuccessorColumns => {
                formatter.write_str("Automerge successor values are missing")
            }
            Self::UnexpectedSuccessorColumns => {
                formatter.write_str("Automerge successor values are unexpectedly present")
            }
            Self::RangeOverflow => formatter.write_str("Automerge operation row range overflows"),
        }
    }
}

impl std::error::Error for ExternalOperationRowError {}

type OperationResult<T> = Result<T, ExternalOperationRowError>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ObjectReference {
    Root,
    Operation {
        #[serde(rename = "actorIndex")]
        actor_index: u64,
        counter: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum OperationKey {
    Property {
        name: String,
    },
    Head,
    Element {
        #[serde(rename = "actorIndex")]
        actor_index: u64,
        counter: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum OperationScalar {
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

impl From<ExternalScalarValue> for OperationScalar {
    fn from(value: ExternalScalarValue) -> Self {
        match value {
            ExternalScalarValue::Null => Self::Null,
            ExternalScalarValue::Boolean(value) => Self::Boolean { value },
            ExternalScalarValue::Unsigned(value) => Self::Unsigned { value },
            ExternalScalarValue::Signed(value) => Self::Signed { value },
            ExternalScalarValue::Counter(value) => Self::Counter { value },
            ExternalScalarValue::Timestamp(value) => Self::Timestamp { value },
            ExternalScalarValue::Float { little_endian_bits } => Self::Float { little_endian_bits },
            ExternalScalarValue::String {
                payload_offset,
                byte_length,
            } => Self::String {
                payload_offset,
                byte_length,
            },
            ExternalScalarValue::Bytes {
                payload_offset,
                byte_length,
            } => Self::Bytes {
                payload_offset,
                byte_length,
            },
            ExternalScalarValue::Unknown {
                type_code,
                payload_offset,
                byte_length,
            } => Self::Unknown {
                type_code,
                payload_offset,
                byte_length,
            },
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OperationRowRecord<'a> {
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
    Operation {
        index: u64,
        #[serde(rename = "idActorIndex")]
        id_actor_index: u64,
        #[serde(rename = "idCounter")]
        id_counter: u64,
        object: &'a ObjectReference,
        key: &'a OperationKey,
        insert: bool,
        action: u64,
        value: &'a OperationScalar,
        #[serde(rename = "successorByteOffset")]
        successor_byte_offset: u64,
        #[serde(rename = "successorCount")]
        successor_count: u64,
        expand: bool,
        #[serde(rename = "markName")]
        mark_name: Option<&'a str>,
    },
    Complete {
        summary: &'a ExternalOperationRowSummary,
    },
}

/// Join one exact set of verified Automerge document operation columns.
///
/// Every column input is derived from the receipt-bound document layout. The
/// caller keeps both outputs private until the enclosing verified source
/// session returns successfully.
pub(super) fn write_external_operation_rows(
    session: &mut ExternalColumnDecodeSession<'_>,
    layout: &ExternalVerifiedDocumentLayout,
    columns: ExternalOperationColumns<'_>,
    limits: ExternalOperationRowLimits,
    successor_spool: &mut impl Write,
    output: &mut impl Write,
) -> OperationResult<ExternalOperationRowSummary> {
    session.with_source_context(|_, source_byte_length, source_sha256| {
        write_external_operation_rows_in_session(
            source_byte_length,
            source_sha256,
            layout,
            columns,
            limits,
            successor_spool,
            output,
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn write_external_operation_rows_in_session(
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    columns: ExternalOperationColumns<'_>,
    limits: ExternalOperationRowLimits,
    successor_spool: &mut impl Write,
    output: &mut impl Write,
) -> OperationResult<ExternalOperationRowSummary> {
    validate_limits(limits)?;
    let inputs = validate_layout(layout, source_byte_length, source_sha256)?;
    validate_column_presence(&columns, &inputs)?;
    let value_receipt = columns
        .value
        .as_ref()
        .map(|column| column.summary.clone())
        .ok_or(ExternalOperationRowError::InvalidColumnContract)?;

    let actor_count = layout.actor_count();
    if actor_count == 0 {
        return Err(ExternalOperationRowError::InvalidActorCount);
    }
    let primitive_limits = ExternalColumnTokenRunLimits {
        max_run_bytes: limits.max_primitive_run_bytes,
        max_line_bytes: limits.max_line_bytes,
    };
    let scalar_limits = ExternalValueTokenRunLimits {
        max_run_bytes: limits.max_scalar_run_bytes,
        max_line_bytes: limits.max_line_bytes,
    };

    let ExternalOperationColumns {
        object_actor,
        object_counter,
        key_actor,
        key_counter,
        key_string,
        id_actor,
        id_counter,
        insert,
        action,
        value,
        successor_count,
        successor_actor,
        successor_counter,
        expand,
        mark_name,
    } = columns;

    let mut object_actors = open_primitive(
        object_actor,
        inputs.object_actor,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut object_counters = open_primitive(
        object_counter,
        inputs.object_counter,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut key_actors = open_primitive(
        key_actor,
        inputs.key_actor,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut key_counters = open_primitive(
        key_counter,
        inputs.key_counter,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut key_strings = open_primitive(
        key_string,
        inputs.key_string,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut id_actors = open_primitive(
        id_actor,
        inputs.id_actor,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut id_counters = open_primitive(
        id_counter,
        inputs.id_counter,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut inserts = open_primitive(
        insert,
        inputs.insert,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut actions = open_primitive(
        action,
        inputs.action,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut successor_counts = open_primitive(
        successor_count,
        inputs.successor_count,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut successor_actors = open_primitive(
        successor_actor,
        inputs.successor_actor,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut successor_counters = open_primitive(
        successor_counter,
        inputs.successor_counter,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut expands = open_primitive(
        expand,
        inputs.expand,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut mark_names = open_primitive(
        mark_name,
        inputs.mark_name,
        source_byte_length,
        source_sha256,
        primitive_limits,
    )?;
    let mut values = match (value, inputs.value_metadata) {
        (Some(column), Some(metadata_input)) => Some(ExternalValueTokenRunReader::open(
            column.run,
            column.payload_spool,
            source_byte_length,
            source_sha256,
            metadata_input,
            inputs.value_raw,
            column.summary,
            scalar_limits,
        )?),
        (None, None) => None,
        _ => return Err(ExternalOperationRowError::InvalidColumnContract),
    };

    let mut hashed_output = ExternalHashingWriter::new(output);
    write_record(
        &mut hashed_output,
        &OperationRowRecord::Begin {
            schema_version: OPERATION_ROW_SCHEMA_VERSION,
            source_byte_length,
            source_sha256,
            actor_count,
        },
    )?;

    let mut operation_count = 0_u64;
    let mut total_successors = 0_u64;
    let mut successor_spool_byte_length = 0_u64;
    let mut successor_hasher = Sha256::new();

    while let Some(id_actor_value) = next_optional(&mut id_actors)? {
        if operation_count >= limits.max_operation_count {
            return Err(ExternalOperationRowError::OperationCountLimit);
        }
        let id_actor_index = required_actor(id_actor_value, actor_count)
            .map_err(|_| ExternalOperationRowError::InvalidOperationId)?;
        let id_counter = required_positive_delta(next_required_reader(&mut id_counters)?)
            .map_err(|_| ExternalOperationRowError::InvalidOperationId)?;
        let object = next_object(&mut object_actors, &mut object_counters, actor_count)?;
        let key = next_key(
            &mut key_actors,
            &mut key_counters,
            &mut key_strings,
            actor_count,
            limits.max_key_bytes,
        )?;
        let insert = required_boolean(next_required_reader(&mut inserts)?)?;
        let action =
            validate_document_action(required_unsigned(next_required_reader(&mut actions)?)?)?;
        let value = values
            .as_mut()
            .ok_or(ExternalOperationRowError::RowCountMismatch)?
            .next_value()?
            .ok_or(ExternalOperationRowError::RowCountMismatch)?;
        let value = OperationScalar::from(value.value);
        let row_successor_count = required_unsigned(next_required_reader(&mut successor_counts)?)?;
        if row_successor_count > limits.max_successors_per_operation {
            return Err(ExternalOperationRowError::SuccessorCountLimit);
        }
        total_successors = total_successors
            .checked_add(row_successor_count)
            .ok_or(ExternalOperationRowError::RangeOverflow)?;
        if total_successors > limits.max_total_successors {
            return Err(ExternalOperationRowError::TotalSuccessorLimit);
        }
        let successor_byte_offset = successor_spool_byte_length;
        let mut previous_successor: Option<(u64, &str)> = None;
        for _ in 0..row_successor_count {
            let actor_index = successor_actors
                .as_mut()
                .ok_or(ExternalOperationRowError::MissingSuccessorColumns)
                .and_then(next_required)
                .and_then(|value| {
                    required_actor(value, actor_count)
                        .map_err(|_| ExternalOperationRowError::InvalidSuccessor)
                })?;
            let counter = successor_counters
                .as_mut()
                .ok_or(ExternalOperationRowError::MissingSuccessorColumns)
                .and_then(next_required)
                .and_then(|value| {
                    required_positive_delta(value)
                        .map_err(|_| ExternalOperationRowError::InvalidSuccessor)
                })?;
            let actor_id = layout
                .actor_id(actor_index as usize)
                .ok_or(ExternalOperationRowError::InvalidSuccessor)?;
            if previous_successor
                .as_ref()
                .is_some_and(|(previous_counter, previous_actor)| {
                    (*previous_counter, *previous_actor) >= (counter, actor_id)
                })
            {
                return Err(ExternalOperationRowError::InvalidSuccessor);
            }
            previous_successor = Some((counter, actor_id));
            let actor_bytes = actor_index.to_le_bytes();
            let counter_bytes = counter.to_le_bytes();
            successor_spool.write_all(&actor_bytes)?;
            successor_spool.write_all(&counter_bytes)?;
            successor_hasher.update(actor_bytes);
            successor_hasher.update(counter_bytes);
            successor_spool_byte_length = successor_spool_byte_length
                .checked_add(SUCCESSOR_ID_BYTES)
                .ok_or(ExternalOperationRowError::RangeOverflow)?;
        }
        let expand = match expands.as_mut() {
            Some(reader) => required_boolean(next_required(reader)?)?,
            None => false,
        };
        let mark_name = next_optional_string(mark_names.as_mut())?;
        if mark_name
            .as_ref()
            .is_some_and(|name| name.len() as u64 > limits.max_mark_name_bytes)
        {
            return Err(ExternalOperationRowError::MarkNameByteLimit);
        }
        write_record(
            &mut hashed_output,
            &OperationRowRecord::Operation {
                index: operation_count,
                id_actor_index,
                id_counter,
                object: &object,
                key: &key,
                insert,
                action,
                value: &value,
                successor_byte_offset,
                successor_count: row_successor_count,
                expand,
                mark_name: mark_name.as_deref(),
            },
        )?;
        operation_count = operation_count
            .checked_add(1)
            .ok_or(ExternalOperationRowError::RangeOverflow)?;
    }

    finish_optional_readers([
        &mut object_actors,
        &mut object_counters,
        &mut key_actors,
        &mut key_counters,
        &mut key_strings,
        &mut id_counters,
        &mut inserts,
        &mut actions,
        &mut successor_counts,
        &mut expands,
        &mut mark_names,
    ])?;
    if values
        .as_mut()
        .map(ExternalValueTokenRunReader::next_value)
        .transpose()?
        .flatten()
        .is_some()
    {
        return Err(ExternalOperationRowError::RowCountMismatch);
    }
    if successor_actors
        .as_mut()
        .map(ExternalColumnTokenRunReader::next_token)
        .transpose()?
        .flatten()
        .is_some()
        || successor_counters
            .as_mut()
            .map(ExternalColumnTokenRunReader::next_token)
            .transpose()?
            .flatten()
            .is_some()
    {
        return Err(ExternalOperationRowError::UnexpectedSuccessorColumns);
    }
    if total_successors == 0 && (successor_actors.is_some() || successor_counters.is_some()) {
        return Err(ExternalOperationRowError::UnexpectedSuccessorColumns);
    }
    if total_successors > 0 && (successor_actors.is_none() || successor_counters.is_none()) {
        return Err(ExternalOperationRowError::MissingSuccessorColumns);
    }

    let (row_run_prefix_byte_length, row_run_prefix_sha256) = hashed_output.finish();
    let summary = ExternalOperationRowSummary {
        operation_count,
        successor_count: total_successors,
        successor_spool_byte_length,
        successor_spool_sha256: lower_hex(&successor_hasher.finalize()),
        value_payload_spool_byte_length: value_receipt.payload_spool_byte_length,
        value_payload_spool_sha256: value_receipt.payload_spool_sha256,
        row_run_prefix_byte_length,
        row_run_prefix_sha256,
    };
    write_record(output, &OperationRowRecord::Complete { summary: &summary })?;
    Ok(summary)
}

fn validate_limits(limits: ExternalOperationRowLimits) -> OperationResult<()> {
    if limits.max_operation_count == 0
        || limits.max_successors_per_operation == 0
        || limits.max_total_successors == 0
        || limits.max_key_bytes == 0
        || limits.max_mark_name_bytes == 0
        || limits.max_primitive_run_bytes == 0
        || limits.max_scalar_run_bytes == 0
        || limits.max_line_bytes == 0
    {
        return Err(ExternalOperationRowError::InvalidLimits);
    }
    Ok(())
}

fn validate_document_action(action: u64) -> OperationResult<u64> {
    // Document chunks omit delete-operation rows. Their operation IDs appear
    // only in predecessor successor lists. Accepting an explicit action 3 row
    // would turn malformed input into a different causal graph.
    if action == 3 || action > MAX_SUPPORTED_ACTION {
        return Err(ExternalOperationRowError::InvalidAction);
    }
    Ok(action)
}

#[derive(Default)]
struct LayoutInputs {
    object_actor: Option<ExternalColumnInput>,
    object_counter: Option<ExternalColumnInput>,
    key_actor: Option<ExternalColumnInput>,
    key_counter: Option<ExternalColumnInput>,
    key_string: Option<ExternalColumnInput>,
    id_actor: Option<ExternalColumnInput>,
    id_counter: Option<ExternalColumnInput>,
    insert: Option<ExternalColumnInput>,
    action: Option<ExternalColumnInput>,
    value_metadata: Option<ExternalColumnInput>,
    value_raw: Option<ExternalColumnInput>,
    successor_count: Option<ExternalColumnInput>,
    successor_actor: Option<ExternalColumnInput>,
    successor_counter: Option<ExternalColumnInput>,
    expand: Option<ExternalColumnInput>,
    mark_name: Option<ExternalColumnInput>,
}

fn validate_layout(
    layout: &ExternalVerifiedDocumentLayout,
    source_byte_length: u64,
    source_sha256: &str,
) -> OperationResult<LayoutInputs> {
    if !layout.matches_source(source_byte_length, source_sha256) {
        return Err(ExternalOperationRowError::InvalidColumnContract);
    }
    const ALLOWED_SPECIFICATIONS: [u32; 16] = [
        OBJECT_ACTOR_SPECIFICATION,
        OBJECT_COUNTER_SPECIFICATION,
        KEY_ACTOR_SPECIFICATION,
        KEY_COUNTER_SPECIFICATION,
        KEY_STRING_SPECIFICATION,
        ID_ACTOR_SPECIFICATION,
        ID_COUNTER_SPECIFICATION,
        INSERT_SPECIFICATION,
        ACTION_SPECIFICATION,
        VALUE_METADATA_SPECIFICATION,
        VALUE_RAW_SPECIFICATION,
        SUCCESSOR_COUNT_SPECIFICATION,
        SUCCESSOR_ACTOR_SPECIFICATION,
        SUCCESSOR_COUNTER_SPECIFICATION,
        EXPAND_SPECIFICATION,
        MARK_NAME_SPECIFICATION,
    ];
    if layout
        .operation_specifications()
        .any(|specification| !ALLOWED_SPECIFICATIONS.contains(&specification))
    {
        return Err(ExternalOperationRowError::InvalidColumnContract);
    }
    Ok(LayoutInputs {
        object_actor: layout.operation_column(OBJECT_ACTOR_SPECIFICATION)?,
        object_counter: layout.operation_column(OBJECT_COUNTER_SPECIFICATION)?,
        key_actor: layout.operation_column(KEY_ACTOR_SPECIFICATION)?,
        key_counter: layout.operation_column(KEY_COUNTER_SPECIFICATION)?,
        key_string: layout.operation_column(KEY_STRING_SPECIFICATION)?,
        id_actor: layout.operation_column(ID_ACTOR_SPECIFICATION)?,
        id_counter: layout.operation_column(ID_COUNTER_SPECIFICATION)?,
        insert: layout.operation_column(INSERT_SPECIFICATION)?,
        action: layout.operation_column(ACTION_SPECIFICATION)?,
        value_metadata: layout.operation_column(VALUE_METADATA_SPECIFICATION)?,
        value_raw: layout.operation_column(VALUE_RAW_SPECIFICATION)?,
        successor_count: layout.operation_column(SUCCESSOR_COUNT_SPECIFICATION)?,
        successor_actor: layout.operation_column(SUCCESSOR_ACTOR_SPECIFICATION)?,
        successor_counter: layout.operation_column(SUCCESSOR_COUNTER_SPECIFICATION)?,
        expand: layout.operation_column(EXPAND_SPECIFICATION)?,
        mark_name: layout.operation_column(MARK_NAME_SPECIFICATION)?,
    })
}

fn validate_column_presence(
    columns: &ExternalOperationColumns<'_>,
    inputs: &LayoutInputs,
) -> OperationResult<()> {
    let matches = [
        (
            columns.object_actor.is_some(),
            inputs.object_actor.is_some(),
        ),
        (
            columns.object_counter.is_some(),
            inputs.object_counter.is_some(),
        ),
        (columns.key_actor.is_some(), inputs.key_actor.is_some()),
        (columns.key_counter.is_some(), inputs.key_counter.is_some()),
        (columns.key_string.is_some(), inputs.key_string.is_some()),
        (columns.id_actor.is_some(), inputs.id_actor.is_some()),
        (columns.id_counter.is_some(), inputs.id_counter.is_some()),
        (columns.insert.is_some(), inputs.insert.is_some()),
        (columns.action.is_some(), inputs.action.is_some()),
        (columns.value.is_some(), inputs.value_metadata.is_some()),
        (
            columns.successor_count.is_some(),
            inputs.successor_count.is_some(),
        ),
        (
            columns.successor_actor.is_some(),
            inputs.successor_actor.is_some(),
        ),
        (
            columns.successor_counter.is_some(),
            inputs.successor_counter.is_some(),
        ),
        (columns.expand.is_some(), inputs.expand.is_some()),
        (columns.mark_name.is_some(), inputs.mark_name.is_some()),
    ];
    // `keyCounter` may exist without `keyActor` when every non-property key is
    // the list/text HEAD sentinel. `next_key` accepts only counter zero in that
    // shape and still rejects a positive element counter without an actor.
    if matches.into_iter().any(|(column, input)| column != input)
        || inputs.object_actor.is_some() != inputs.object_counter.is_some()
        || inputs.id_actor.is_some() != inputs.id_counter.is_some()
        || inputs.successor_actor.is_some() != inputs.successor_counter.is_some()
        || inputs.value_raw.is_some() && inputs.value_metadata.is_none()
        || inputs.id_actor.is_none()
        || inputs.insert.is_none()
        || inputs.action.is_none()
        || inputs.value_metadata.is_none()
        || inputs.successor_count.is_none()
    {
        return Err(ExternalOperationRowError::InvalidColumnContract);
    }
    Ok(())
}

fn open_primitive<'a>(
    column: Option<ExternalPrimitiveOperationColumn<'a>>,
    input: Option<ExternalColumnInput>,
    source_byte_length: u64,
    source_sha256: &str,
    limits: ExternalColumnTokenRunLimits,
) -> OperationResult<Option<ExternalColumnTokenRunReader<'a>>> {
    match (column, input) {
        (Some(column), Some(input)) => Ok(Some(ExternalColumnTokenRunReader::open(
            column.run,
            source_byte_length,
            source_sha256,
            input,
            column.summary,
            limits,
        )?)),
        (None, None) => Ok(None),
        _ => Err(ExternalOperationRowError::InvalidColumnContract),
    }
}

fn next_optional(
    reader: &mut Option<ExternalColumnTokenRunReader<'_>>,
) -> OperationResult<Option<ExternalColumnTokenValue>> {
    reader
        .as_mut()
        .ok_or(ExternalOperationRowError::RowCountMismatch)?
        .next_token()
        .map(|token| token.map(|token| token.value))
        .map_err(ExternalOperationRowError::from)
}

fn next_required(
    reader: &mut ExternalColumnTokenRunReader<'_>,
) -> OperationResult<ExternalColumnTokenValue> {
    reader
        .next_token()?
        .map(|token| token.value)
        .ok_or(ExternalOperationRowError::RowCountMismatch)
}

fn next_required_reader(
    reader: &mut Option<ExternalColumnTokenRunReader<'_>>,
) -> OperationResult<ExternalColumnTokenValue> {
    reader
        .as_mut()
        .ok_or(ExternalOperationRowError::RowCountMismatch)
        .and_then(next_required)
}

fn required_unsigned(value: ExternalColumnTokenValue) -> OperationResult<u64> {
    match value {
        ExternalColumnTokenValue::Unsigned(value) => value
            .parse::<u64>()
            .map_err(|_| ExternalOperationRowError::RangeOverflow),
        _ => Err(ExternalOperationRowError::RangeOverflow),
    }
}

fn required_positive_delta(value: ExternalColumnTokenValue) -> OperationResult<u64> {
    match value {
        ExternalColumnTokenValue::Signed(value) => value
            .parse::<i64>()
            .ok()
            .and_then(|value| u64::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or(ExternalOperationRowError::RangeOverflow),
        _ => Err(ExternalOperationRowError::RangeOverflow),
    }
}

fn required_actor(value: ExternalColumnTokenValue, actor_count: u64) -> OperationResult<u64> {
    let actor = required_unsigned(value)?;
    if actor >= actor_count {
        return Err(ExternalOperationRowError::RangeOverflow);
    }
    Ok(actor)
}

fn required_boolean(value: ExternalColumnTokenValue) -> OperationResult<bool> {
    match value {
        ExternalColumnTokenValue::Boolean(value) => Ok(value),
        _ => Err(ExternalOperationRowError::InvalidBoolean),
    }
}

fn next_object(
    actors: &mut Option<ExternalColumnTokenRunReader<'_>>,
    counters: &mut Option<ExternalColumnTokenRunReader<'_>>,
    actor_count: u64,
) -> OperationResult<ObjectReference> {
    match (actors.as_mut(), counters.as_mut()) {
        (None, None) => Ok(ObjectReference::Root),
        (Some(actors), Some(counters)) => {
            let actor = next_required(actors)?;
            let counter = next_required(counters)?;
            match (actor, counter) {
                (ExternalColumnTokenValue::Null, ExternalColumnTokenValue::Null) => {
                    Ok(ObjectReference::Root)
                }
                (actor, ExternalColumnTokenValue::Unsigned(counter)) => {
                    let actor_index = required_actor(actor, actor_count)
                        .map_err(|_| ExternalOperationRowError::InvalidObject)?;
                    let counter = counter
                        .parse::<u64>()
                        .ok()
                        .filter(|counter| *counter > 0)
                        .ok_or(ExternalOperationRowError::InvalidObject)?;
                    Ok(ObjectReference::Operation {
                        actor_index,
                        counter,
                    })
                }
                _ => Err(ExternalOperationRowError::InvalidObject),
            }
        }
        _ => Err(ExternalOperationRowError::InvalidColumnContract),
    }
}

fn next_key(
    actors: &mut Option<ExternalColumnTokenRunReader<'_>>,
    counters: &mut Option<ExternalColumnTokenRunReader<'_>>,
    strings: &mut Option<ExternalColumnTokenRunReader<'_>>,
    actor_count: u64,
    max_key_bytes: u64,
) -> OperationResult<OperationKey> {
    let string = strings
        .as_mut()
        .map(next_required)
        .transpose()?
        .unwrap_or(ExternalColumnTokenValue::Null);
    let actor = actors
        .as_mut()
        .map(next_required)
        .transpose()?
        .unwrap_or(ExternalColumnTokenValue::Null);
    let counter = counters
        .as_mut()
        .map(next_required)
        .transpose()?
        .unwrap_or(ExternalColumnTokenValue::Null);
    match (string, actor, counter) {
        (
            ExternalColumnTokenValue::String(name),
            ExternalColumnTokenValue::Null,
            ExternalColumnTokenValue::Null,
        ) => {
            if name.len() as u64 > max_key_bytes {
                return Err(ExternalOperationRowError::KeyByteLimit);
            }
            Ok(OperationKey::Property { name })
        }
        (
            ExternalColumnTokenValue::Null,
            ExternalColumnTokenValue::Null,
            ExternalColumnTokenValue::Signed(counter),
        ) if counter == "0" => Ok(OperationKey::Head),
        (ExternalColumnTokenValue::Null, actor, ExternalColumnTokenValue::Signed(counter)) => {
            let actor_index = required_actor(actor, actor_count)
                .map_err(|_| ExternalOperationRowError::InvalidKey)?;
            let counter = counter
                .parse::<i64>()
                .ok()
                .and_then(|counter| u64::try_from(counter).ok())
                .filter(|counter| *counter > 0)
                .ok_or(ExternalOperationRowError::InvalidKey)?;
            Ok(OperationKey::Element {
                actor_index,
                counter,
            })
        }
        _ => Err(ExternalOperationRowError::InvalidKey),
    }
}

fn next_optional_string(
    reader: Option<&mut ExternalColumnTokenRunReader<'_>>,
) -> OperationResult<Option<String>> {
    let Some(reader) = reader else {
        return Ok(None);
    };
    match next_required(reader)? {
        ExternalColumnTokenValue::Null => Ok(None),
        ExternalColumnTokenValue::String(value) => Ok(Some(value)),
        _ => Err(ExternalOperationRowError::InvalidMarkName),
    }
}

fn finish_optional_readers<const N: usize>(
    readers: [&mut Option<ExternalColumnTokenRunReader<'_>>; N],
) -> OperationResult<()> {
    for reader in readers {
        if reader
            .as_mut()
            .map(ExternalColumnTokenRunReader::next_token)
            .transpose()?
            .flatten()
            .is_some()
        {
            return Err(ExternalOperationRowError::RowCountMismatch);
        }
    }
    Ok(())
}

fn write_record(output: &mut impl Write, record: &OperationRowRecord<'_>) -> OperationResult<()> {
    serde_json::to_writer(&mut *output, record)
        .map_err(|error| ExternalOperationRowError::Io(std::io::Error::other(error)))?;
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
        with_verified_operation_rows, ExternalRowRunConsumeError, ExternalRowRunError,
        ExternalRowRunLimits,
    };
    use crate::automerge_external_value::{write_decoded_value_tokens, ExternalValueDecodeLimits};
    use std::convert::Infallible;
    use std::io::{Read, Seek, SeekFrom};
    use tempfile::NamedTempFile;

    // Generated by the repository-pinned @automerge/automerge 2.2.9 package.
    // It contains two changes, a list, two overwritten values, and therefore
    // real element keys plus non-empty successor columns.
    const SUCCESSOR_DOCUMENT_HEX: &str = "856f4a833cd6829c00d60101100123456789abcdef0123456789abcdef01235092c5ecc2ff265bd915e8ba6bac671b3f141423b1af249c1a7e117c95249208010203021303230735094003430256020e0104020411041306151021022307340442045606570e800107810102830103020002017e04027ee09da9d306007e036f6e650374776f7e00017f00020700030300000303020004020000037d0003007f056974656d7302057469746c65000306007a027f047e037e030101017f0205017d005666031666697273747365636f6e64617a627c00010001020002007e050101";

    // Generated by the repository-pinned @automerge/automerge 2.2.9 package.
    // The second change deletes both a map value and a list element. Automerge
    // correctly omits both delete rows while retaining their IDs as successors.
    const DELETION_DOCUMENT_HEX: &str = "856f4a83e0cb9fb000aa010110aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01b5b15f2d3c542e97e29c3d7045cd3308d6769ded9c86e30cb38273456f0be07f0701020302130323074003430256020d0104020513041509210223053402420556055702800104810102830103020002017e04027ea6d5a9d306007e00017f0002070002020000027e010300037f007d016c016d0161000104007c037e010203017e0200020102007e141601780200020102007e050101";

    struct DecodedPrimitive {
        summary: ExternalColumnDecodeSummary,
        run: NamedTempFile,
    }

    struct DecodedScalar {
        summary: ExternalValueDecodeSummary,
        run: NamedTempFile,
        payload: NamedTempFile,
    }

    type FixtureReconstruction = (
        ExternalOperationRowSummary,
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
            max_token_count: 256,
            max_decoded_column_bytes: 16 * 1024,
            max_string_bytes: 4 * 1024,
        }
    }

    fn value_limits() -> ExternalValueDecodeLimits {
        ExternalValueDecodeLimits {
            max_value_count: 256,
            max_decoded_raw_bytes: 16 * 1024,
            max_string_bytes: 4 * 1024,
            max_metadata_run_bytes: 64 * 1024,
            max_metadata_line_bytes: 8 * 1024,
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

    fn operation_limits() -> ExternalOperationRowLimits {
        ExternalOperationRowLimits {
            max_operation_count: 256,
            max_successors_per_operation: 64,
            max_total_successors: 1024,
            max_key_bytes: 4 * 1024,
            max_mark_name_bytes: 4 * 1024,
            max_primitive_run_bytes: 64 * 1024,
            max_scalar_run_bytes: 64 * 1024,
            max_line_bytes: 8 * 1024,
        }
    }

    fn row_run_limits() -> ExternalRowRunLimits {
        ExternalRowRunLimits {
            max_run_bytes: 1024 * 1024,
            max_line_bytes: 16 * 1024,
        }
    }

    fn decode_primitive(
        session: &mut ExternalColumnDecodeSession<'_>,
        input: Option<ExternalColumnInput>,
    ) -> Result<Option<DecodedPrimitive>, Box<dyn std::error::Error>> {
        input
            .map(|input| {
                let mut run = NamedTempFile::new()?;
                let summary = session.write_decoded_column_tokens(
                    input,
                    column_limits(),
                    run.as_file_mut(),
                )?;
                Ok(DecodedPrimitive { summary, run })
            })
            .transpose()
    }

    fn decode_scalar(
        session: &mut ExternalColumnDecodeSession<'_>,
        metadata_input: Option<ExternalColumnInput>,
        raw_input: Option<ExternalColumnInput>,
    ) -> Result<Option<DecodedScalar>, Box<dyn std::error::Error>> {
        let Some(metadata_input) = metadata_input else {
            return Ok(None);
        };
        let mut metadata_run = NamedTempFile::new()?;
        let metadata_summary = session.write_decoded_column_tokens(
            metadata_input,
            column_limits(),
            metadata_run.as_file_mut(),
        )?;
        let mut run = NamedTempFile::new()?;
        let mut payload = NamedTempFile::new()?;
        let summary = write_decoded_value_tokens(
            session,
            metadata_input,
            &metadata_summary,
            metadata_run.as_file_mut(),
            raw_input,
            value_limits(),
            payload.as_file_mut(),
            run.as_file_mut(),
        )?;
        Ok(Some(DecodedScalar {
            summary,
            run,
            payload,
        }))
    }

    fn primitive_column(
        decoded: &mut Option<DecodedPrimitive>,
    ) -> Option<ExternalPrimitiveOperationColumn<'_>> {
        decoded
            .as_mut()
            .map(|decoded| ExternalPrimitiveOperationColumn {
                summary: &decoded.summary,
                run: decoded.run.as_file_mut(),
            })
    }

    fn scalar_column(
        decoded: &mut Option<DecodedScalar>,
    ) -> Option<ExternalScalarOperationColumn<'_>> {
        decoded
            .as_mut()
            .map(|decoded| ExternalScalarOperationColumn {
                summary: &decoded.summary,
                run: decoded.run.as_file_mut(),
                payload_spool: decoded.payload.as_file_mut(),
            })
    }

    fn reconstruct_with_limits(bytes: &[u8], limits: ExternalOperationRowLimits) -> FixtureResult {
        let source_byte_length = bytes.len() as u64;
        let source_sha256 = digest(bytes);
        let mut source = fixture(bytes);
        let descriptor = verify_chunk(source.as_file_mut(), 0, 0, source_byte_length, 1024 * 1024)?;
        let mut layout_run = NamedTempFile::new()?;
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

        let input = |specification| layout.operation_column(specification);
        let object_actor_input = input(OBJECT_ACTOR_SPECIFICATION)?;
        let object_counter_input = input(OBJECT_COUNTER_SPECIFICATION)?;
        let key_actor_input = input(KEY_ACTOR_SPECIFICATION)?;
        let key_counter_input = input(KEY_COUNTER_SPECIFICATION)?;
        let key_string_input = input(KEY_STRING_SPECIFICATION)?;
        let id_actor_input = input(ID_ACTOR_SPECIFICATION)?;
        let id_counter_input = input(ID_COUNTER_SPECIFICATION)?;
        let insert_input = input(INSERT_SPECIFICATION)?;
        let action_input = input(ACTION_SPECIFICATION)?;
        let value_metadata_input = input(VALUE_METADATA_SPECIFICATION)?;
        let value_raw_input = input(VALUE_RAW_SPECIFICATION)?;
        let successor_count_input = input(SUCCESSOR_COUNT_SPECIFICATION)?;
        let successor_actor_input = input(SUCCESSOR_ACTOR_SPECIFICATION)?;
        let successor_counter_input = input(SUCCESSOR_COUNTER_SPECIFICATION)?;
        let expand_input = input(EXPAND_SPECIFICATION)?;
        let mark_name_input = input(MARK_NAME_SPECIFICATION)?;
        let mut successor_spool = Vec::new();
        let mut rows = Vec::new();
        let mut value_payload_spool = Vec::new();

        let summary = with_verified_column_decode_session(
            source.as_file_mut(),
            source_byte_length,
            &source_sha256,
            |session| -> Result<ExternalOperationRowSummary, Box<dyn std::error::Error>> {
                let mut object_actor = decode_primitive(session, object_actor_input)?;
                let mut object_counter = decode_primitive(session, object_counter_input)?;
                let mut key_actor = decode_primitive(session, key_actor_input)?;
                let mut key_counter = decode_primitive(session, key_counter_input)?;
                let mut key_string = decode_primitive(session, key_string_input)?;
                let mut id_actor = decode_primitive(session, id_actor_input)?;
                let mut id_counter = decode_primitive(session, id_counter_input)?;
                let mut insert = decode_primitive(session, insert_input)?;
                let mut action = decode_primitive(session, action_input)?;
                let mut value = decode_scalar(session, value_metadata_input, value_raw_input)?;
                let mut successor_count = decode_primitive(session, successor_count_input)?;
                let mut successor_actor = decode_primitive(session, successor_actor_input)?;
                let mut successor_counter = decode_primitive(session, successor_counter_input)?;
                let mut expand = decode_primitive(session, expand_input)?;
                let mut mark_name = decode_primitive(session, mark_name_input)?;

                let summary = write_external_operation_rows(
                    session,
                    &layout,
                    ExternalOperationColumns {
                        object_actor: primitive_column(&mut object_actor),
                        object_counter: primitive_column(&mut object_counter),
                        key_actor: primitive_column(&mut key_actor),
                        key_counter: primitive_column(&mut key_counter),
                        key_string: primitive_column(&mut key_string),
                        id_actor: primitive_column(&mut id_actor),
                        id_counter: primitive_column(&mut id_counter),
                        insert: primitive_column(&mut insert),
                        action: primitive_column(&mut action),
                        value: scalar_column(&mut value),
                        successor_count: primitive_column(&mut successor_count),
                        successor_actor: primitive_column(&mut successor_actor),
                        successor_counter: primitive_column(&mut successor_counter),
                        expand: primitive_column(&mut expand),
                        mark_name: primitive_column(&mut mark_name),
                    },
                    limits,
                    &mut successor_spool,
                    &mut rows,
                )?;
                let value = value
                    .as_mut()
                    .ok_or("fixture operation value column is missing")?;
                value.payload.as_file_mut().seek(SeekFrom::Start(0))?;
                value
                    .payload
                    .as_file_mut()
                    .read_to_end(&mut value_payload_spool)?;
                Ok(summary)
            },
        )?;
        Ok((summary, successor_spool, value_payload_spool, rows, layout))
    }

    fn reconstruct(bytes: &[u8]) -> FixtureResult {
        reconstruct_with_limits(bytes, operation_limits())
    }

    fn operation_records(rows: &[u8]) -> Vec<serde_json::Value> {
        std::str::from_utf8(rows)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .filter(|record: &serde_json::Value| record["type"] == "operation")
            .collect()
    }

    #[test]
    fn reconstructs_official_operation_rows_without_retaining_the_table() {
        let bytes = decode_test_hex(OFFICIAL_NONEMPTY_DOCUMENT_HEX);
        let (summary, successor_spool, _, rows, _) = reconstruct(&bytes).unwrap();
        assert_eq!(summary.operation_count, 7);
        assert_eq!(summary.successor_count, 0);
        assert_eq!(summary.successor_spool_byte_length, 0);
        assert_eq!(summary.successor_spool_sha256, digest(&[]));
        assert!(successor_spool.is_empty());
        assert!(summary.value_payload_spool_byte_length > 0);
        assert_eq!(summary.value_payload_spool_sha256.len(), 64);
        assert!(summary.row_run_prefix_byte_length > 0);
        assert_eq!(summary.row_run_prefix_sha256.len(), 64);

        let operations = operation_records(&rows);
        assert_eq!(operations.len(), 7);
        assert_eq!(operations[0]["idActorIndex"], 0);
        assert_eq!(operations[0]["idCounter"], 1);
        assert_eq!(operations[0]["object"]["kind"], "root");
        assert_eq!(operations[0]["key"]["kind"], "property");
        assert_eq!(operations[0]["key"]["name"], "items");
        assert_eq!(operations[0]["action"], 0);
        assert_eq!(operations[0]["successorCount"], 0);
    }

    #[test]
    fn spools_sorted_successors_and_preserves_element_keys() {
        let bytes = decode_test_hex(SUCCESSOR_DOCUMENT_HEX);
        let (summary, successor_spool, _, rows, _) = reconstruct(&bytes).unwrap();
        assert_eq!(summary.operation_count, 6);
        assert_eq!(summary.successor_count, 2);
        assert_eq!(summary.successor_spool_byte_length, 32);
        assert_eq!(summary.successor_spool_sha256, digest(&successor_spool));
        assert_eq!(successor_spool.len(), 32);

        let operations = operation_records(&rows);
        assert_eq!(operations.len(), 6);
        assert_eq!(
            operations
                .iter()
                .map(|operation| operation["successorCount"].as_u64().unwrap())
                .sum::<u64>(),
            2
        );
        assert!(operations
            .iter()
            .any(|operation| operation["key"]["kind"] == "element"));
        assert!(operations
            .iter()
            .any(|operation| operation["value"]["kind"] == "string"));
    }

    #[test]
    fn reconstructs_saved_deletions_from_successors_without_explicit_delete_rows() {
        let bytes = decode_test_hex(DELETION_DOCUMENT_HEX);
        let (summary, _, _, rows, _) = reconstruct(&bytes).unwrap();
        let operations = operation_records(&rows);

        assert_eq!(operations.len() as u64, summary.operation_count);
        assert_eq!(summary.successor_count, 2);
        assert_eq!(
            operations
                .iter()
                .map(|operation| operation["successorCount"].as_u64().unwrap())
                .sum::<u64>(),
            2
        );
        assert!(operations
            .iter()
            .all(|operation| operation["action"].as_u64() != Some(3)));
    }

    #[test]
    fn rejects_explicit_delete_rows_in_document_chunks() {
        assert!(matches!(
            validate_document_action(3),
            Err(ExternalOperationRowError::InvalidAction)
        ));
        assert_eq!(validate_document_action(MAX_SUPPORTED_ACTION).unwrap(), 7);
    }

    #[test]
    fn verifies_complete_operation_rows_and_rejects_a_changed_successor_spool() {
        let bytes = decode_test_hex(SUCCESSOR_DOCUMENT_HEX);
        let source_byte_length = bytes.len() as u64;
        let source_sha256 = digest(&bytes);
        let (summary, successor_spool, value_payload, rows, layout) = reconstruct(&bytes).unwrap();
        let mut row_file = fixture(&rows);
        let mut successor_file = fixture(&successor_spool);
        let mut value_payload_file = fixture(&value_payload);
        let mut verified = Vec::new();

        let read_summary = with_verified_operation_rows(
            row_file.as_file_mut(),
            successor_file.as_file_mut(),
            value_payload_file.as_file_mut(),
            source_byte_length,
            &source_sha256,
            &layout,
            &summary,
            operation_limits(),
            row_run_limits(),
            |row| {
                verified.push(row.clone());
                Ok::<(), Infallible>(())
            },
        )
        .unwrap();

        assert_eq!(read_summary, summary);
        assert_eq!(verified.len(), 6);
        assert_eq!(
            verified
                .iter()
                .map(|row| row.successors.len())
                .sum::<usize>(),
            2
        );

        successor_file
            .as_file_mut()
            .seek(SeekFrom::Start(0))
            .unwrap();
        successor_file
            .as_file_mut()
            .write_all(&1_u64.to_le_bytes())
            .unwrap();
        successor_file.as_file_mut().sync_all().unwrap();
        assert!(matches!(
            with_verified_operation_rows(
                row_file.as_file_mut(),
                successor_file.as_file_mut(),
                value_payload_file.as_file_mut(),
                source_byte_length,
                &source_sha256,
                &layout,
                &summary,
                operation_limits(),
                row_run_limits(),
                |_| Ok::<(), Infallible>(())
            ),
            Err(ExternalRowRunConsumeError::Run(
                ExternalRowRunError::SpoolMismatch
            ))
        ));
    }

    #[test]
    fn rejects_a_successor_total_above_the_admitted_bound() {
        let bytes = decode_test_hex(SUCCESSOR_DOCUMENT_HEX);
        let mut limits = operation_limits();
        limits.max_total_successors = 1;

        assert!(matches!(
            reconstruct_with_limits(&bytes, limits),
            Err(error)
                if error
                    .downcast_ref::<ExternalOperationRowError>()
                    .is_some_and(|error| matches!(
                        error,
                        ExternalOperationRowError::TotalSuccessorLimit
                    ))
        ));
    }
}
