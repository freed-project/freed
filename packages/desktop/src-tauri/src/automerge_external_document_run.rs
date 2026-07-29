//! Receipt-bound reader for derived Automerge document layout runs.
//!
//! The writer proves the source bytes and emits one bounded JSONL record at a
//! time. This reader independently verifies the exact source and chunk
//! contract, record order, aggregate bounds, column layout, and prefix receipt
//! before returning a small branded catalog. The catalog contains only bounded
//! actor, head, and column metadata. It never contains the document body or
//! operation graph.

use crate::automerge_external_column::ExternalColumnInput;
use crate::automerge_external_common::{is_lower_sha256, lower_hex};
use crate::automerge_external_decoder::{AutomergeChunkDescriptor, AutomergeChunkKind};
use crate::automerge_external_document::{
    DocumentColumnSection, DocumentColumnType, ExternalDocumentLayoutLimits,
    ExternalDocumentLayoutSummary, DOCUMENT_LAYOUT_SCHEMA_VERSION,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalDocumentLayoutRunLimits {
    pub max_run_bytes: u64,
    pub max_line_bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct VerifiedColumn {
    specification: u32,
    input: ExternalColumnInput,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalVerifiedDocumentLayout {
    source_byte_length: u64,
    source_sha256: String,
    actor_ids: Vec<String>,
    heads: Vec<String>,
    change_columns: Vec<VerifiedColumn>,
    operation_columns: Vec<VerifiedColumn>,
    head_change_indices: Vec<u64>,
}

impl ExternalVerifiedDocumentLayout {
    pub(super) fn matches_source(&self, byte_length: u64, sha256: &str) -> bool {
        self.source_byte_length == byte_length && self.source_sha256 == sha256
    }

    pub(super) fn actor_count(&self) -> u64 {
        self.actor_ids.len() as u64
    }

    pub(super) fn actor_id(&self, index: usize) -> Option<&str> {
        self.actor_ids.get(index).map(String::as_str)
    }

    pub(super) fn head(&self, index: usize) -> Option<&str> {
        self.heads.get(index).map(String::as_str)
    }

    pub(super) fn head_count(&self) -> u64 {
        self.heads.len() as u64
    }

    pub(super) fn head_change_index(&self, index: usize) -> Option<u64> {
        self.head_change_indices.get(index).copied()
    }

    pub(super) fn change_column(
        &self,
        specification: u32,
    ) -> LayoutRunResult<Option<ExternalColumnInput>> {
        exact_column(&self.change_columns, specification)
    }

    pub(super) fn change_specifications(&self) -> impl Iterator<Item = u32> + '_ {
        self.change_columns
            .iter()
            .map(|column| normalized_specification(column.specification))
    }

    pub(super) fn operation_column(
        &self,
        specification: u32,
    ) -> LayoutRunResult<Option<ExternalColumnInput>> {
        exact_column(&self.operation_columns, specification)
    }

    pub(super) fn operation_specifications(&self) -> impl Iterator<Item = u32> + '_ {
        self.operation_columns
            .iter()
            .map(|column| normalized_specification(column.specification))
    }
}

#[derive(Debug)]
pub(super) enum ExternalDocumentLayoutRunError {
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidLimits,
    InvalidSummary,
    RunTooLarge,
    LineTooLarge,
    Truncated,
    ContractMismatch,
    RecordOrder,
    ActorEncoding,
    HeadEncoding,
    ColumnContract,
    AmbiguousColumn,
    RangeOverflow,
}

impl From<std::io::Error> for ExternalDocumentLayoutRunError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ExternalDocumentLayoutRunError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl fmt::Display for ExternalDocumentLayoutRunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge layout run I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "Automerge layout run JSON is invalid: {error}"),
            Self::InvalidLimits => formatter.write_str("Automerge layout run limits are invalid"),
            Self::InvalidSummary => {
                formatter.write_str("Automerge layout summary exceeds the admitted contract")
            }
            Self::RunTooLarge => {
                formatter.write_str("Automerge layout run exceeds the admitted bytes")
            }
            Self::LineTooLarge => {
                formatter.write_str("Automerge layout line exceeds the admitted bytes")
            }
            Self::Truncated => formatter.write_str("Automerge layout run is truncated"),
            Self::ContractMismatch => {
                formatter.write_str("Automerge layout run does not match its contract")
            }
            Self::RecordOrder => formatter.write_str("Automerge layout records are not contiguous"),
            Self::ActorEncoding => formatter.write_str("Automerge actor encoding is invalid"),
            Self::HeadEncoding => formatter.write_str("Automerge head encoding is invalid"),
            Self::ColumnContract => formatter.write_str("Automerge column layout is invalid"),
            Self::AmbiguousColumn => {
                formatter.write_str("Automerge layout contains an ambiguous column")
            }
            Self::RangeOverflow => formatter.write_str("Automerge layout range overflows"),
        }
    }
}

impl std::error::Error for ExternalDocumentLayoutRunError {}

type LayoutRunResult<T> = Result<T, ExternalDocumentLayoutRunError>;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum StoredLayoutRecord {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: String,
        #[serde(rename = "chunkOrdinal")]
        chunk_ordinal: u64,
        #[serde(rename = "chunkOffset")]
        chunk_offset: u64,
    },
    Actor {
        index: u64,
        #[serde(rename = "byteLength")]
        byte_length: u64,
        #[serde(rename = "actorId")]
        actor_id: String,
    },
    Head {
        index: u64,
        hash: String,
    },
    Column {
        section: DocumentColumnSection,
        index: u64,
        specification: u32,
        #[serde(rename = "columnId")]
        column_id: u32,
        #[serde(rename = "columnType")]
        column_type: DocumentColumnType,
        deflated: bool,
        offset: u64,
        #[serde(rename = "byteLength")]
        byte_length: u64,
    },
    HeadIndex {
        #[serde(rename = "headIndex")]
        head_index: u64,
        #[serde(rename = "changeIndex")]
        change_index: u64,
    },
    Complete {
        summary: ExternalDocumentLayoutSummary,
    },
}

/// Read and verify one complete derived document-layout run.
///
/// The returned value is provenance-branded by private fields. Higher joins
/// can obtain only column inputs that were present in this exact verified run.
#[allow(clippy::too_many_arguments)]
pub(super) fn read_verified_document_layout(
    run: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    descriptor: &AutomergeChunkDescriptor,
    expected_summary: &ExternalDocumentLayoutSummary,
    layout_limits: ExternalDocumentLayoutLimits,
    run_limits: ExternalDocumentLayoutRunLimits,
) -> LayoutRunResult<ExternalVerifiedDocumentLayout> {
    validate_contract(
        source_byte_length,
        source_sha256,
        descriptor,
        expected_summary,
        layout_limits,
        run_limits,
    )?;
    let run_byte_length = run.metadata()?.len();
    if run_byte_length > run_limits.max_run_bytes {
        return Err(ExternalDocumentLayoutRunError::RunTooLarge);
    }
    run.seek(SeekFrom::Start(0))?;
    let mut reader = BufReader::new(run.take(run_byte_length));
    let (record, line) = next_record(&mut reader, run_limits.max_line_bytes)?
        .ok_or(ExternalDocumentLayoutRunError::Truncated)?;
    let StoredLayoutRecord::Begin {
        schema_version,
        source_byte_length: recorded_source_byte_length,
        source_sha256: recorded_source_sha256,
        chunk_ordinal,
        chunk_offset,
    } = record
    else {
        return Err(ExternalDocumentLayoutRunError::ContractMismatch);
    };
    if schema_version != DOCUMENT_LAYOUT_SCHEMA_VERSION
        || recorded_source_byte_length != source_byte_length
        || recorded_source_sha256 != source_sha256
        || chunk_ordinal != descriptor.ordinal
        || chunk_offset != descriptor.offset
    {
        return Err(ExternalDocumentLayoutRunError::ContractMismatch);
    }

    let actor_capacity = usize::try_from(expected_summary.actor_count)
        .map_err(|_| ExternalDocumentLayoutRunError::InvalidSummary)?;
    let head_capacity = usize::try_from(expected_summary.head_count)
        .map_err(|_| ExternalDocumentLayoutRunError::InvalidSummary)?;
    let change_capacity = usize::try_from(expected_summary.change_column_count)
        .map_err(|_| ExternalDocumentLayoutRunError::InvalidSummary)?;
    let operation_capacity = usize::try_from(expected_summary.operation_column_count)
        .map_err(|_| ExternalDocumentLayoutRunError::InvalidSummary)?;
    let head_index_capacity = usize::try_from(expected_summary.head_index_count)
        .map_err(|_| ExternalDocumentLayoutRunError::InvalidSummary)?;
    let mut actor_ids = Vec::with_capacity(actor_capacity);
    let mut heads = Vec::with_capacity(head_capacity);
    let mut change_columns = Vec::with_capacity(change_capacity);
    let mut operation_columns = Vec::with_capacity(operation_capacity);
    let mut head_change_indices = Vec::with_capacity(head_index_capacity);
    let mut actor_bytes = 0_u64;
    let mut change_bytes = 0_u64;
    let mut operation_bytes = 0_u64;
    let mut change_end = None;
    let mut operation_end = None;
    let mut previous_change_specification = None;
    let mut previous_operation_specification = None;
    let data_start = descriptor
        .offset
        .checked_add(u64::from(descriptor.header_byte_length))
        .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?;
    let data_end = data_start
        .checked_add(descriptor.data_byte_length)
        .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?;
    let mut prefix_hasher = Sha256::new();
    let mut prefix_byte_length = 0_u64;
    hash_line(&mut prefix_hasher, &mut prefix_byte_length, &line)?;

    loop {
        let (record, line) = next_record(&mut reader, run_limits.max_line_bytes)?
            .ok_or(ExternalDocumentLayoutRunError::Truncated)?;
        match record {
            StoredLayoutRecord::Actor {
                index,
                byte_length,
                actor_id,
            } if actor_ids.len() < actor_capacity
                && heads.is_empty()
                && change_columns.is_empty()
                && operation_columns.is_empty()
                && head_change_indices.is_empty() =>
            {
                if index != actor_ids.len() as u64
                    || byte_length > layout_limits.max_actor_byte_length
                    || actor_id.len() as u64 != byte_length.saturating_mul(2)
                    || !is_lower_hex(&actor_id)
                {
                    return Err(ExternalDocumentLayoutRunError::ActorEncoding);
                }
                actor_bytes = actor_bytes
                    .checked_add(byte_length)
                    .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?;
                if actor_bytes > layout_limits.max_total_actor_bytes {
                    return Err(ExternalDocumentLayoutRunError::ActorEncoding);
                }
                actor_ids.push(actor_id);
                hash_line(&mut prefix_hasher, &mut prefix_byte_length, &line)?;
            }
            StoredLayoutRecord::Head { index, hash }
                if actor_ids.len() == actor_capacity
                    && heads.len() < head_capacity
                    && change_columns.is_empty()
                    && operation_columns.is_empty()
                    && head_change_indices.is_empty() =>
            {
                if index != heads.len() as u64 || !is_lower_sha256(&hash) {
                    return Err(ExternalDocumentLayoutRunError::HeadEncoding);
                }
                heads.push(hash);
                hash_line(&mut prefix_hasher, &mut prefix_byte_length, &line)?;
            }
            StoredLayoutRecord::Column {
                section: DocumentColumnSection::Changes,
                index,
                specification,
                column_id,
                column_type,
                deflated,
                offset,
                byte_length,
            } if actor_ids.len() == actor_capacity
                && heads.len() == head_capacity
                && change_columns.len() < change_capacity
                && operation_columns.is_empty()
                && head_change_indices.is_empty() =>
            {
                validate_column(
                    &mut previous_change_specification,
                    change_end,
                    data_start,
                    data_end,
                    index,
                    change_columns.len(),
                    specification,
                    column_id,
                    column_type,
                    deflated,
                    offset,
                    byte_length,
                )?;
                change_bytes = change_bytes
                    .checked_add(byte_length)
                    .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?;
                change_end = Some(
                    offset
                        .checked_add(byte_length)
                        .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?,
                );
                change_columns.push(VerifiedColumn {
                    specification,
                    input: ExternalColumnInput {
                        offset,
                        byte_length,
                        column_type,
                        deflated,
                    },
                });
                hash_line(&mut prefix_hasher, &mut prefix_byte_length, &line)?;
            }
            StoredLayoutRecord::Column {
                section: DocumentColumnSection::Operations,
                index,
                specification,
                column_id,
                column_type,
                deflated,
                offset,
                byte_length,
            } if actor_ids.len() == actor_capacity
                && heads.len() == head_capacity
                && change_columns.len() == change_capacity
                && operation_columns.len() < operation_capacity
                && head_change_indices.is_empty() =>
            {
                let minimum_offset = change_end.unwrap_or(data_start);
                validate_column(
                    &mut previous_operation_specification,
                    operation_end,
                    minimum_offset,
                    data_end,
                    index,
                    operation_columns.len(),
                    specification,
                    column_id,
                    column_type,
                    deflated,
                    offset,
                    byte_length,
                )?;
                operation_bytes = operation_bytes
                    .checked_add(byte_length)
                    .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?;
                operation_end = Some(
                    offset
                        .checked_add(byte_length)
                        .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?,
                );
                operation_columns.push(VerifiedColumn {
                    specification,
                    input: ExternalColumnInput {
                        offset,
                        byte_length,
                        column_type,
                        deflated,
                    },
                });
                hash_line(&mut prefix_hasher, &mut prefix_byte_length, &line)?;
            }
            StoredLayoutRecord::HeadIndex {
                head_index,
                change_index,
            } if actor_ids.len() == actor_capacity
                && heads.len() == head_capacity
                && change_columns.len() == change_capacity
                && operation_columns.len() == operation_capacity
                && head_change_indices.len() < head_index_capacity =>
            {
                if head_index != head_change_indices.len() as u64 {
                    return Err(ExternalDocumentLayoutRunError::RecordOrder);
                }
                head_change_indices.push(change_index);
                hash_line(&mut prefix_hasher, &mut prefix_byte_length, &line)?;
            }
            StoredLayoutRecord::Complete { summary } => {
                if actor_ids.len() != actor_capacity
                    || heads.len() != head_capacity
                    || change_columns.len() != change_capacity
                    || operation_columns.len() != operation_capacity
                    || head_change_indices.len() != head_index_capacity
                    || actor_bytes != expected_summary.total_actor_bytes
                    || change_bytes != expected_summary.change_column_bytes
                    || operation_bytes != expected_summary.operation_column_bytes
                    || summary != *expected_summary
                    || prefix_byte_length != summary.layout_run_prefix_byte_length
                    || lower_hex(&prefix_hasher.clone().finalize())
                        != summary.layout_run_prefix_sha256
                    || next_record(&mut reader, run_limits.max_line_bytes)?.is_some()
                {
                    return Err(ExternalDocumentLayoutRunError::ContractMismatch);
                }
                return Ok(ExternalVerifiedDocumentLayout {
                    source_byte_length,
                    source_sha256: source_sha256.to_owned(),
                    actor_ids,
                    heads,
                    change_columns,
                    operation_columns,
                    head_change_indices,
                });
            }
            _ => return Err(ExternalDocumentLayoutRunError::RecordOrder),
        }
    }
}

fn validate_contract(
    source_byte_length: u64,
    source_sha256: &str,
    descriptor: &AutomergeChunkDescriptor,
    summary: &ExternalDocumentLayoutSummary,
    layout_limits: ExternalDocumentLayoutLimits,
    run_limits: ExternalDocumentLayoutRunLimits,
) -> LayoutRunResult<()> {
    if run_limits.max_run_bytes == 0
        || run_limits.max_line_bytes == 0
        || layout_limits.max_actor_count == 0
        || layout_limits.max_actor_byte_length == 0
        || layout_limits.max_total_actor_bytes == 0
        || layout_limits.max_head_count == 0
        || layout_limits.max_columns_per_section == 0
    {
        return Err(ExternalDocumentLayoutRunError::InvalidLimits);
    }
    if source_byte_length == 0
        || !is_lower_sha256(source_sha256)
        || descriptor.kind != AutomergeChunkKind::Document
        || descriptor.data_byte_length != summary.document_data_byte_length
        || summary.actor_count > layout_limits.max_actor_count
        || summary.total_actor_bytes > layout_limits.max_total_actor_bytes
        || summary.head_count > layout_limits.max_head_count
        || summary.change_column_count > layout_limits.max_columns_per_section
        || summary.operation_column_count > layout_limits.max_columns_per_section
        || !matches!(summary.head_index_count, 0) && summary.head_index_count != summary.head_count
        || summary.layout_run_prefix_byte_length == 0
        || !is_lower_sha256(&summary.layout_run_prefix_sha256)
    {
        return Err(ExternalDocumentLayoutRunError::InvalidSummary);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_column(
    previous_specification: &mut Option<u32>,
    previous_end: Option<u64>,
    minimum_offset: u64,
    data_end: u64,
    index: u64,
    expected_index: usize,
    specification: u32,
    column_id: u32,
    column_type: DocumentColumnType,
    deflated: bool,
    offset: u64,
    byte_length: u64,
) -> LayoutRunResult<()> {
    let normalized = specification & !0b1000;
    if index != expected_index as u64
        || previous_specification.is_some_and(|previous| normalized < previous)
        || column_id != specification >> 4
        || column_type != DocumentColumnType::from_spec(specification)
        || deflated != (specification & 0b1000 != 0)
        || offset < minimum_offset
        || previous_end.is_some_and(|end| offset != end)
        || offset
            .checked_add(byte_length)
            .is_none_or(|end| end > data_end)
    {
        return Err(ExternalDocumentLayoutRunError::ColumnContract);
    }
    *previous_specification = Some(normalized);
    Ok(())
}

fn exact_column(
    columns: &[VerifiedColumn],
    specification: u32,
) -> LayoutRunResult<Option<ExternalColumnInput>> {
    let normalized = normalized_specification(specification);
    let mut matches = columns
        .iter()
        .filter(|column| normalized_specification(column.specification) == normalized);
    let result = matches.next().map(|column| column.input);
    if matches.next().is_some() {
        return Err(ExternalDocumentLayoutRunError::AmbiguousColumn);
    }
    Ok(result)
}

fn normalized_specification(specification: u32) -> u32 {
    specification & !0b1000
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn hash_line(hasher: &mut Sha256, byte_length: &mut u64, line: &[u8]) -> LayoutRunResult<()> {
    hasher.update(line);
    hasher.update(b"\n");
    *byte_length = byte_length
        .checked_add(line.len() as u64)
        .and_then(|length| length.checked_add(1))
        .ok_or(ExternalDocumentLayoutRunError::RangeOverflow)?;
    Ok(())
}

fn next_record(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> LayoutRunResult<Option<(StoredLayoutRecord, Vec<u8>)>> {
    let Some(line) = read_bounded_line(reader, maximum_line_bytes)? else {
        return Ok(None);
    };
    let record = serde_json::from_slice(&line)?;
    Ok(Some((record, line)))
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> LayoutRunResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(ExternalDocumentLayoutRunError::Truncated)
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if line
                .len()
                .checked_add(newline)
                .is_none_or(|length| length > maximum_line_bytes)
            {
                return Err(ExternalDocumentLayoutRunError::LineTooLarge);
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
            return Err(ExternalDocumentLayoutRunError::LineTooLarge);
        }
        let consumed = available.len();
        line.extend_from_slice(available);
        reader.consume(consumed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automerge_external_common::{decode_test_hex, OFFICIAL_NONEMPTY_DOCUMENT_HEX};
    use crate::automerge_external_decoder::verify_chunk;
    use crate::automerge_external_document::write_verified_document_layout;
    use std::io::{Seek, SeekFrom, Write};
    use tempfile::NamedTempFile;

    fn layout_limits() -> ExternalDocumentLayoutLimits {
        ExternalDocumentLayoutLimits {
            max_actor_count: 1_024,
            max_actor_byte_length: 1_024,
            max_total_actor_bytes: 1024 * 1024,
            max_head_count: 1_024,
            max_columns_per_section: 128,
        }
    }

    fn run_limits() -> ExternalDocumentLayoutRunLimits {
        ExternalDocumentLayoutRunLimits {
            max_run_bytes: 1024 * 1024,
            max_line_bytes: 16 * 1024,
        }
    }

    fn digest(bytes: &[u8]) -> String {
        lower_hex(&Sha256::digest(bytes))
    }

    fn fixture(bytes: &[u8]) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(bytes).unwrap();
        file.as_file_mut().sync_all().unwrap();
        file
    }

    fn build_layout() -> (
        Vec<u8>,
        AutomergeChunkDescriptor,
        ExternalDocumentLayoutSummary,
        NamedTempFile,
    ) {
        let bytes = decode_test_hex(OFFICIAL_NONEMPTY_DOCUMENT_HEX);
        let mut source = fixture(&bytes);
        let descriptor =
            verify_chunk(source.as_file_mut(), 0, 0, bytes.len() as u64, 1024 * 1024).unwrap();
        let mut run = NamedTempFile::new().unwrap();
        let summary = write_verified_document_layout(
            source.as_file_mut(),
            bytes.len() as u64,
            &digest(&bytes),
            &descriptor,
            layout_limits(),
            run.as_file_mut(),
        )
        .unwrap();
        run.as_file_mut().sync_all().unwrap();
        (bytes, descriptor, summary, run)
    }

    #[test]
    fn verifies_the_complete_layout_and_returns_only_bound_metadata() {
        let (bytes, descriptor, summary, mut run) = build_layout();
        let layout = read_verified_document_layout(
            run.as_file_mut(),
            bytes.len() as u64,
            &digest(&bytes),
            &descriptor,
            &summary,
            layout_limits(),
            run_limits(),
        )
        .unwrap();

        assert!(layout.matches_source(bytes.len() as u64, &digest(&bytes)));
        assert_eq!(layout.actor_count(), 1);
        assert_eq!(layout.actor_id(0), Some("0123456789abcdef0123456789abcdef"));
        assert_eq!(
            layout.head(0),
            Some("96207f2939ac71a4b5c386ca6ecab557b10e884156d293eefa67adef6b3e6876")
        );
        assert_eq!(layout.head_change_index(0), Some(0));
        assert_eq!(
            layout.change_column(1).unwrap(),
            Some(ExternalColumnInput {
                offset: 97,
                byte_length: 2,
                column_type: DocumentColumnType::Actor,
                deflated: false,
            })
        );
        assert_eq!(
            layout.operation_column(128).unwrap(),
            Some(ExternalColumnInput {
                offset: 214,
                byte_length: 2,
                column_type: DocumentColumnType::Group,
                deflated: false,
            })
        );
    }

    #[test]
    fn rejects_prefix_mutation_truncation_trailing_rows_and_contract_drift() {
        let (bytes, descriptor, summary, mut run) = build_layout();
        let original_run_bytes = std::fs::read(run.path()).unwrap();
        let mut run_bytes = original_run_bytes.clone();
        let actor = b"0123456789abcdef0123456789abcdef";
        let actor_start = run_bytes
            .windows(actor.len())
            .position(|window| window == actor)
            .unwrap();
        run_bytes[actor_start] = b'1';
        let mut mutated = fixture(&run_bytes);
        assert!(matches!(
            read_verified_document_layout(
                mutated.as_file_mut(),
                bytes.len() as u64,
                &digest(&bytes),
                &descriptor,
                &summary,
                layout_limits(),
                run_limits(),
            ),
            Err(ExternalDocumentLayoutRunError::ContractMismatch)
        ));

        run_bytes = original_run_bytes.clone();
        run_bytes.pop();
        let mut truncated = fixture(&run_bytes);
        assert!(matches!(
            read_verified_document_layout(
                truncated.as_file_mut(),
                bytes.len() as u64,
                &digest(&bytes),
                &descriptor,
                &summary,
                layout_limits(),
                run_limits(),
            ),
            Err(ExternalDocumentLayoutRunError::Truncated)
        ));

        run.as_file_mut().seek(SeekFrom::End(0)).unwrap();
        run.as_file_mut().write_all(b"{}\n").unwrap();
        run.as_file_mut().sync_all().unwrap();
        assert!(matches!(
            read_verified_document_layout(
                run.as_file_mut(),
                bytes.len() as u64,
                &digest(&bytes),
                &descriptor,
                &summary,
                layout_limits(),
                run_limits(),
            ),
            Err(ExternalDocumentLayoutRunError::ContractMismatch)
                | Err(ExternalDocumentLayoutRunError::Json(_))
        ));

        let mut wrong_summary = summary;
        wrong_summary.actor_count = 2;
        let mut wrong = fixture(&original_run_bytes);
        assert!(matches!(
            read_verified_document_layout(
                wrong.as_file_mut(),
                bytes.len() as u64,
                &digest(&bytes),
                &descriptor,
                &wrong_summary,
                layout_limits(),
                run_limits(),
            ),
            Err(ExternalDocumentLayoutRunError::RecordOrder)
                | Err(ExternalDocumentLayoutRunError::ContractMismatch)
        ));
    }

    #[test]
    fn resolves_columns_by_normalized_specification_after_deflate() {
        let input = ExternalColumnInput {
            offset: 100,
            byte_length: 20,
            column_type: DocumentColumnType::Actor,
            deflated: true,
        };
        let layout = ExternalVerifiedDocumentLayout {
            source_byte_length: 200,
            source_sha256: "0".repeat(64),
            actor_ids: Vec::new(),
            heads: Vec::new(),
            change_columns: vec![VerifiedColumn {
                specification: 1 | 0b1000,
                input,
            }],
            operation_columns: vec![VerifiedColumn {
                specification: 33 | 0b1000,
                input,
            }],
            head_change_indices: Vec::new(),
        };

        assert_eq!(layout.change_column(1).unwrap(), Some(input));
        assert_eq!(layout.operation_column(33).unwrap(), Some(input));
        assert_eq!(layout.change_specifications().collect::<Vec<_>>(), vec![1]);
        assert_eq!(
            layout.operation_specifications().collect::<Vec<_>>(),
            vec![33]
        );
    }
}
