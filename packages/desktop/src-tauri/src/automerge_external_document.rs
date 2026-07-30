//! Bounded layout decoder for verified Automerge document chunks.
//!
//! This dormant layer records the exact actor table, head set, raw change and
//! operation column ranges, and optional head indexes without loading a
//! document chunk. Later decoders consume the immutable JSONL output one record
//! at a time. No command or production caller activates this module.

use crate::automerge_external_common::{lower_hex, ExternalHashingWriter};
use crate::automerge_external_decoder::{
    read_canonical_uleb128_value, verify_chunk, verify_source_identity, AutomergeChunkDescriptor,
    AutomergeChunkKind, AutomergeExternalDecoderError,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

pub(super) const DOCUMENT_LAYOUT_SCHEMA_VERSION: u32 = 1;
const CHANGE_HASH_BYTES: u64 = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalDocumentLayoutLimits {
    pub max_actor_count: u64,
    pub max_actor_byte_length: u64,
    pub max_total_actor_bytes: u64,
    pub max_head_count: u64,
    pub max_columns_per_section: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DocumentColumnSection {
    Changes,
    Operations,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DocumentColumnType {
    Group,
    Actor,
    Integer,
    DeltaInteger,
    Boolean,
    String,
    ValueMetadata,
    Value,
}

impl DocumentColumnType {
    pub(super) fn from_spec(specification: u32) -> Self {
        match specification & 0b111 {
            0 => Self::Group,
            1 => Self::Actor,
            2 => Self::Integer,
            3 => Self::DeltaInteger,
            4 => Self::Boolean,
            5 => Self::String,
            6 => Self::ValueMetadata,
            7 => Self::Value,
            _ => unreachable!("three bits cover every column type"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExternalDocumentLayoutSummary {
    pub actor_count: u64,
    pub total_actor_bytes: u64,
    pub head_count: u64,
    pub change_column_count: u64,
    pub change_column_bytes: u64,
    pub operation_column_count: u64,
    pub operation_column_bytes: u64,
    pub head_index_count: u64,
    pub document_data_byte_length: u64,
    pub layout_run_prefix_byte_length: u64,
    pub layout_run_prefix_sha256: String,
}

#[derive(Debug)]
pub(super) enum ExternalDocumentLayoutError {
    Io(std::io::Error),
    Decoder(AutomergeExternalDecoderError),
    NotDocumentChunk,
    DescriptorMismatch,
    InvalidLimits,
    ActorCountLimit,
    ActorByteLengthLimit,
    TotalActorBytesLimit,
    HeadCountLimit,
    ColumnCountLimit,
    ColumnSpecificationOverflow,
    ColumnOrder,
    RangeOverflow,
    TruncatedDocument,
    TrailingDocumentBytes,
}

impl From<std::io::Error> for ExternalDocumentLayoutError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<AutomergeExternalDecoderError> for ExternalDocumentLayoutError {
    fn from(error: AutomergeExternalDecoderError) -> Self {
        Self::Decoder(error)
    }
}

impl fmt::Display for ExternalDocumentLayoutError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge document layout I/O failed: {error}"),
            Self::Decoder(error) => error.fmt(formatter),
            Self::NotDocumentChunk => {
                formatter.write_str("Automerge chunk is not a document chunk")
            }
            Self::DescriptorMismatch => {
                formatter.write_str("Automerge document descriptor no longer matches")
            }
            Self::InvalidLimits => formatter.write_str("Automerge document limits are invalid"),
            Self::ActorCountLimit => {
                formatter.write_str("Automerge document exceeds the admitted actor count")
            }
            Self::ActorByteLengthLimit => {
                formatter.write_str("Automerge actor exceeds the admitted byte length")
            }
            Self::TotalActorBytesLimit => {
                formatter.write_str("Automerge actors exceed the admitted total bytes")
            }
            Self::HeadCountLimit => {
                formatter.write_str("Automerge document exceeds the admitted head count")
            }
            Self::ColumnCountLimit => {
                formatter.write_str("Automerge document exceeds the admitted column count")
            }
            Self::ColumnSpecificationOverflow => {
                formatter.write_str("Automerge column specification exceeds u32")
            }
            Self::ColumnOrder => {
                formatter.write_str("Automerge columns are not in normalized order")
            }
            Self::RangeOverflow => formatter.write_str("Automerge document range overflows"),
            Self::TruncatedDocument => formatter.write_str("Automerge document is truncated"),
            Self::TrailingDocumentBytes => {
                formatter.write_str("Automerge document has unexpected trailing bytes")
            }
        }
    }
}

impl std::error::Error for ExternalDocumentLayoutError {}

type LayoutResult<T> = Result<T, ExternalDocumentLayoutError>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RawColumnDirectory {
    count: u64,
    metadata_offset: u64,
    metadata_byte_length: u64,
    data_byte_length: u64,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum LayoutRecord<'a> {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: &'a str,
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
        actor_id: &'a str,
    },
    Head {
        index: u64,
        hash: &'a str,
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
        summary: &'a ExternalDocumentLayoutSummary,
    },
}

/// Write one deterministic external-memory layout index for a verified
/// Automerge document chunk.
///
/// The caller writes into a private temporary file and publishes only after
/// this function returns successfully.
pub(super) fn write_verified_document_layout(
    source: &mut File,
    expected_source_byte_length: u64,
    expected_source_sha256: &str,
    descriptor: &AutomergeChunkDescriptor,
    limits: ExternalDocumentLayoutLimits,
    output: &mut impl Write,
) -> LayoutResult<ExternalDocumentLayoutSummary> {
    validate_limits(limits)?;
    if descriptor.kind != AutomergeChunkKind::Document {
        return Err(ExternalDocumentLayoutError::NotDocumentChunk);
    }
    verify_source_identity(source, expected_source_byte_length, expected_source_sha256)?;
    let current_descriptor = verify_chunk(
        source,
        descriptor.ordinal,
        descriptor.offset,
        expected_source_byte_length,
        limits.max_actor_byte_length.max(1),
    )?;
    if &current_descriptor != descriptor {
        return Err(ExternalDocumentLayoutError::DescriptorMismatch);
    }

    let data_start = descriptor
        .offset
        .checked_add(u64::from(descriptor.header_byte_length))
        .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;
    let data_end = data_start
        .checked_add(descriptor.data_byte_length)
        .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;

    let mut hashed_output = ExternalHashingWriter::new(output);
    write_record(
        &mut hashed_output,
        &LayoutRecord::Begin {
            schema_version: DOCUMENT_LAYOUT_SCHEMA_VERSION,
            source_byte_length: expected_source_byte_length,
            source_sha256: expected_source_sha256,
            chunk_ordinal: descriptor.ordinal,
            chunk_offset: descriptor.offset,
        },
    )?;

    source.seek(SeekFrom::Start(data_start))?;
    let actor_count =
        read_bounded_count(source, data_end, limits.max_actor_count, CountKind::Actor)?;
    let mut total_actor_bytes = 0_u64;
    for index in 0..actor_count {
        let actor_byte_length = read_document_uleb128(source, data_end)?;
        if actor_byte_length > limits.max_actor_byte_length {
            return Err(ExternalDocumentLayoutError::ActorByteLengthLimit);
        }
        total_actor_bytes = total_actor_bytes
            .checked_add(actor_byte_length)
            .ok_or(ExternalDocumentLayoutError::TotalActorBytesLimit)?;
        if total_actor_bytes > limits.max_total_actor_bytes {
            return Err(ExternalDocumentLayoutError::TotalActorBytesLimit);
        }
        let actor_bytes = read_bounded_bytes(source, data_end, actor_byte_length)?;
        let actor_id = lower_hex(&actor_bytes);
        write_record(
            &mut hashed_output,
            &LayoutRecord::Actor {
                index,
                byte_length: actor_byte_length,
                actor_id: &actor_id,
            },
        )?;
    }

    let head_count = read_bounded_count(source, data_end, limits.max_head_count, CountKind::Head)?;
    for index in 0..head_count {
        let mut hash = [0_u8; CHANGE_HASH_BYTES as usize];
        read_exact_or_truncated(source, data_end, &mut hash)?;
        let hash = lower_hex(&hash);
        write_record(
            &mut hashed_output,
            &LayoutRecord::Head { index, hash: &hash },
        )?;
    }

    let change_directory =
        scan_raw_column_directory(source, data_end, limits.max_columns_per_section)?;
    let operation_directory =
        scan_raw_column_directory(source, data_end, limits.max_columns_per_section)?;
    let change_data_offset = source.stream_position()?;
    let operation_data_offset = change_data_offset
        .checked_add(change_directory.data_byte_length)
        .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;
    let suffix_offset = operation_data_offset
        .checked_add(operation_directory.data_byte_length)
        .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;
    if suffix_offset > data_end {
        return Err(ExternalDocumentLayoutError::TruncatedDocument);
    }

    emit_raw_columns(
        source,
        data_end,
        change_directory,
        change_data_offset,
        DocumentColumnSection::Changes,
        &mut hashed_output,
    )?;
    emit_raw_columns(
        source,
        data_end,
        operation_directory,
        operation_data_offset,
        DocumentColumnSection::Operations,
        &mut hashed_output,
    )?;

    source.seek(SeekFrom::Start(suffix_offset))?;
    let head_index_count = if suffix_offset == data_end {
        0
    } else {
        for head_index in 0..head_count {
            let change_index = read_document_uleb128(source, data_end)?;
            write_record(
                &mut hashed_output,
                &LayoutRecord::HeadIndex {
                    head_index,
                    change_index,
                },
            )?;
        }
        head_count
    };
    if source.stream_position()? != data_end {
        return Err(ExternalDocumentLayoutError::TrailingDocumentBytes);
    }

    let (layout_run_prefix_byte_length, layout_run_prefix_sha256) = hashed_output.finish();
    let summary = ExternalDocumentLayoutSummary {
        actor_count,
        total_actor_bytes,
        head_count,
        change_column_count: change_directory.count,
        change_column_bytes: change_directory.data_byte_length,
        operation_column_count: operation_directory.count,
        operation_column_bytes: operation_directory.data_byte_length,
        head_index_count,
        document_data_byte_length: descriptor.data_byte_length,
        layout_run_prefix_byte_length,
        layout_run_prefix_sha256,
    };
    verify_source_identity(source, expected_source_byte_length, expected_source_sha256)?;
    write_record(output, &LayoutRecord::Complete { summary: &summary })?;
    verify_source_identity(source, expected_source_byte_length, expected_source_sha256)?;
    Ok(summary)
}

fn validate_limits(limits: ExternalDocumentLayoutLimits) -> LayoutResult<()> {
    if limits.max_actor_count == 0
        || limits.max_actor_byte_length == 0
        || limits.max_total_actor_bytes == 0
        || limits.max_head_count == 0
        || limits.max_columns_per_section == 0
    {
        return Err(ExternalDocumentLayoutError::InvalidLimits);
    }
    Ok(())
}

enum CountKind {
    Actor,
    Head,
}

fn read_bounded_count(
    source: &mut File,
    data_end: u64,
    maximum: u64,
    kind: CountKind,
) -> LayoutResult<u64> {
    let count = read_document_uleb128(source, data_end)?;
    if count > maximum {
        return Err(match kind {
            CountKind::Actor => ExternalDocumentLayoutError::ActorCountLimit,
            CountKind::Head => ExternalDocumentLayoutError::HeadCountLimit,
        });
    }
    Ok(count)
}

fn scan_raw_column_directory(
    source: &mut File,
    data_end: u64,
    maximum_columns: u64,
) -> LayoutResult<RawColumnDirectory> {
    let metadata_offset = source.stream_position()?;
    let count = read_document_uleb128(source, data_end)?;
    if count > maximum_columns {
        return Err(ExternalDocumentLayoutError::ColumnCountLimit);
    }
    let mut previous_normalized = None;
    let mut data_byte_length = 0_u64;
    for _ in 0..count {
        let raw_specification = read_document_uleb128(source, data_end)?;
        let specification = u32::try_from(raw_specification)
            .map_err(|_| ExternalDocumentLayoutError::ColumnSpecificationOverflow)?;
        let normalized = specification & !0b1000;
        if previous_normalized.is_some_and(|previous| normalized < previous) {
            return Err(ExternalDocumentLayoutError::ColumnOrder);
        }
        previous_normalized = Some(normalized);
        let byte_length = read_document_uleb128(source, data_end)?;
        data_byte_length = data_byte_length
            .checked_add(byte_length)
            .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;
    }
    let metadata_end = source.stream_position()?;
    Ok(RawColumnDirectory {
        count,
        metadata_offset,
        metadata_byte_length: metadata_end
            .checked_sub(metadata_offset)
            .ok_or(ExternalDocumentLayoutError::RangeOverflow)?,
        data_byte_length,
    })
}

fn emit_raw_columns(
    source: &mut File,
    data_end: u64,
    directory: RawColumnDirectory,
    data_offset: u64,
    section: DocumentColumnSection,
    output: &mut impl Write,
) -> LayoutResult<()> {
    source.seek(SeekFrom::Start(directory.metadata_offset))?;
    let count = read_document_uleb128(source, data_end)?;
    if count != directory.count {
        return Err(ExternalDocumentLayoutError::DescriptorMismatch);
    }
    let mut relative_offset = 0_u64;
    for index in 0..count {
        let raw_specification = read_document_uleb128(source, data_end)?;
        let specification = u32::try_from(raw_specification)
            .map_err(|_| ExternalDocumentLayoutError::ColumnSpecificationOverflow)?;
        let byte_length = read_document_uleb128(source, data_end)?;
        let offset = data_offset
            .checked_add(relative_offset)
            .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;
        write_record(
            output,
            &LayoutRecord::Column {
                section,
                index,
                specification,
                column_id: specification >> 4,
                column_type: DocumentColumnType::from_spec(specification),
                deflated: specification & 0b1000 != 0,
                offset,
                byte_length,
            },
        )?;
        relative_offset = relative_offset
            .checked_add(byte_length)
            .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;
    }
    let metadata_end = directory
        .metadata_offset
        .checked_add(directory.metadata_byte_length)
        .ok_or(ExternalDocumentLayoutError::RangeOverflow)?;
    if source.stream_position()? != metadata_end || relative_offset != directory.data_byte_length {
        return Err(ExternalDocumentLayoutError::DescriptorMismatch);
    }
    Ok(())
}

fn read_document_uleb128(source: &mut File, data_end: u64) -> LayoutResult<u64> {
    let position = source.stream_position()?;
    let remaining = data_end
        .checked_sub(position)
        .ok_or(ExternalDocumentLayoutError::TruncatedDocument)?;
    if remaining == 0 {
        return Err(ExternalDocumentLayoutError::TruncatedDocument);
    }
    let mut bounded = source.take(remaining);
    read_canonical_uleb128_value(&mut bounded).map_err(ExternalDocumentLayoutError::from)
}

fn read_bounded_bytes(source: &mut File, data_end: u64, byte_length: u64) -> LayoutResult<Vec<u8>> {
    let position = source.stream_position()?;
    if byte_length
        > data_end
            .checked_sub(position)
            .ok_or(ExternalDocumentLayoutError::TruncatedDocument)?
    {
        return Err(ExternalDocumentLayoutError::TruncatedDocument);
    }
    let length =
        usize::try_from(byte_length).map_err(|_| ExternalDocumentLayoutError::RangeOverflow)?;
    let mut bytes = vec![0_u8; length];
    read_exact_or_truncated(source, data_end, &mut bytes)?;
    Ok(bytes)
}

fn read_exact_or_truncated(source: &mut File, data_end: u64, bytes: &mut [u8]) -> LayoutResult<()> {
    let position = source.stream_position()?;
    let byte_length =
        u64::try_from(bytes.len()).map_err(|_| ExternalDocumentLayoutError::RangeOverflow)?;
    if byte_length
        > data_end
            .checked_sub(position)
            .ok_or(ExternalDocumentLayoutError::TruncatedDocument)?
    {
        return Err(ExternalDocumentLayoutError::TruncatedDocument);
    }
    match source.read_exact(bytes) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            Err(ExternalDocumentLayoutError::TruncatedDocument)
        }
        Err(error) => Err(ExternalDocumentLayoutError::Io(error)),
    }
}

fn write_record(output: &mut impl Write, record: &LayoutRecord<'_>) -> LayoutResult<()> {
    serde_json::to_writer(&mut *output, record)
        .map_err(|error| ExternalDocumentLayoutError::Io(std::io::Error::other(error)))?;
    output.write_all(b"\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automerge_external_common::{decode_test_hex, OFFICIAL_NONEMPTY_DOCUMENT_HEX};
    use crate::automerge_external_decoder::verify_chunk;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tempfile::NamedTempFile;

    // Generated by the exact installed @automerge/automerge 2.2.9 package.
    // It contains one actor, one head, two maps, one nested item, strings, and
    // an integer so both metadata and operation column directories are real.
    fn limits() -> ExternalDocumentLayoutLimits {
        ExternalDocumentLayoutLimits {
            max_actor_count: 1_024,
            max_actor_byte_length: 1_024,
            max_total_actor_bytes: 1024 * 1024,
            max_head_count: 1_024,
            max_columns_per_section: 128,
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

    fn rewrite_document_checksum(bytes: &mut [u8]) {
        let data_length = bytes.len() - 11;
        assert!(data_length < 16_384);
        bytes[9] = (data_length as u8 & 0x7f) | 0x80;
        bytes[10] = (data_length >> 7) as u8;
        let mut hasher = Sha256::new();
        hasher.update([0]);
        hasher.update(&bytes[9..11]);
        hasher.update(&bytes[11..]);
        bytes[4..8].copy_from_slice(&hasher.finalize()[..4]);
    }

    fn descriptor_for(bytes: &[u8]) -> AutomergeChunkDescriptor {
        let mut file = fixture(bytes);
        verify_chunk(file.as_file_mut(), 0, 0, bytes.len() as u64, 1024 * 1024).unwrap()
    }

    #[test]
    fn indexes_official_document_layout_without_loading_the_chunk() {
        let bytes = decode_test_hex(OFFICIAL_NONEMPTY_DOCUMENT_HEX);
        let mut file = fixture(&bytes);
        let descriptor =
            verify_chunk(file.as_file_mut(), 0, 0, bytes.len() as u64, 1024 * 1024).unwrap();
        let mut output = Vec::new();

        let summary = write_verified_document_layout(
            file.as_file_mut(),
            bytes.len() as u64,
            &digest(&bytes),
            &descriptor,
            limits(),
            &mut output,
        )
        .unwrap();

        assert_eq!(summary.actor_count, 1);
        assert_eq!(summary.total_actor_bytes, 16);
        assert_eq!(summary.head_count, 1);
        assert_eq!(summary.change_column_count, 6);
        assert_eq!(summary.change_column_bytes, 16);
        assert_eq!(summary.operation_column_count, 10);
        assert_eq!(summary.operation_column_bytes, 103);
        assert_eq!(summary.head_index_count, 1);
        assert_eq!(summary.document_data_byte_length, 206);
        let complete_start = output[..output.len() - 1]
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap();
        assert_eq!(summary.layout_run_prefix_byte_length, complete_start as u64);
        assert_eq!(
            summary.layout_run_prefix_sha256,
            digest(&output[..complete_start])
        );
        let output = String::from_utf8(output).unwrap();
        assert!(output.contains("\"actorId\":\"0123456789abcdef0123456789abcdef\""));
        assert!(output.contains(
            "\"hash\":\"96207f2939ac71a4b5c386ca6ecab557b10e884156d293eefa67adef6b3e6876\""
        ));
        assert!(output.contains("\"section\":\"changes\""));
        assert!(output.contains("\"section\":\"operations\""));
        assert!(output.contains(
            "\"section\":\"changes\",\"index\":0,\"specification\":1,\"columnId\":0,\"columnType\":\"actor\",\"deflated\":false,\"offset\":97,\"byteLength\":2"
        ));
        assert!(output.contains(
            "\"section\":\"operations\",\"index\":9,\"specification\":128,\"columnId\":8,\"columnType\":\"group\",\"deflated\":false,\"offset\":214,\"byteLength\":2"
        ));
        assert!(output.contains("{\"type\":\"head_index\",\"headIndex\":0,\"changeIndex\":0}"));
        assert!(output.contains("\"headIndexCount\":1,\"documentDataByteLength\":206,"));
        assert!(output.ends_with("}}\n"));
    }

    #[test]
    fn rejects_limits_bad_order_truncation_and_trailing_suffix() {
        let bytes = decode_test_hex(OFFICIAL_NONEMPTY_DOCUMENT_HEX);
        let descriptor = descriptor_for(&bytes);

        let mut actor_limited = fixture(&bytes);
        assert!(matches!(
            write_verified_document_layout(
                actor_limited.as_file_mut(),
                bytes.len() as u64,
                &digest(&bytes),
                &descriptor,
                ExternalDocumentLayoutLimits {
                    max_actor_count: 1,
                    max_actor_byte_length: 15,
                    ..limits()
                },
                &mut Vec::new(),
            ),
            Err(ExternalDocumentLayoutError::ActorByteLengthLimit)
        ));

        let mut bad_order_bytes = bytes.clone();
        // The second change-column specification follows specification 1.
        // Lowering it to zero makes normalized column order descend.
        bad_order_bytes[65] = 0;
        rewrite_document_checksum(&mut bad_order_bytes);
        let bad_order_descriptor = descriptor_for(&bad_order_bytes);
        let mut bad_order = fixture(&bad_order_bytes);
        assert!(matches!(
            write_verified_document_layout(
                bad_order.as_file_mut(),
                bad_order_bytes.len() as u64,
                &digest(&bad_order_bytes),
                &bad_order_descriptor,
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalDocumentLayoutError::ColumnOrder)
        ));

        let mut truncated_bytes = bytes.clone();
        // Inflate the last change-column length while keeping the chunk itself
        // valid. The declared data ranges now exceed the verified document.
        truncated_bytes[74] = 127;
        rewrite_document_checksum(&mut truncated_bytes);
        let truncated_descriptor = descriptor_for(&truncated_bytes);
        let mut truncated = fixture(&truncated_bytes);
        assert!(matches!(
            write_verified_document_layout(
                truncated.as_file_mut(),
                truncated_bytes.len() as u64,
                &digest(&truncated_bytes),
                &truncated_descriptor,
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalDocumentLayoutError::TruncatedDocument)
        ));

        let mut trailing_bytes = bytes;
        trailing_bytes.push(0);
        rewrite_document_checksum(&mut trailing_bytes);
        let trailing_descriptor = descriptor_for(&trailing_bytes);
        let mut trailing = fixture(&trailing_bytes);
        assert!(matches!(
            write_verified_document_layout(
                trailing.as_file_mut(),
                trailing_bytes.len() as u64,
                &digest(&trailing_bytes),
                &trailing_descriptor,
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalDocumentLayoutError::TrailingDocumentBytes)
        ));
    }
}
