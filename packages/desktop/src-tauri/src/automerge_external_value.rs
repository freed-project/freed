//! Bounded value-column joining for external-memory Automerge migration.
//!
//! Automerge stores scalar metadata separately from raw value bytes. This
//! dormant layer consumes a verified metadata token run, streams the paired raw
//! column, and writes deterministic scalar descriptors plus a bounded payload
//! spool. It never retains the document or a complete raw column in memory. No
//! command or production caller activates this module.

use crate::automerge_external_column::{
    ExternalColumnDecodeError, ExternalColumnDecodeSession, ExternalColumnDecodeSummary,
    ExternalColumnInput, COLUMN_TOKEN_SCHEMA_VERSION,
};
use crate::automerge_external_common::lower_hex;
use crate::automerge_external_decoder::AutomergeExternalDecoderError;
use crate::automerge_external_document::DocumentColumnType;
use flate2::read::DeflateDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Take, Write};

const VALUE_TOKEN_SCHEMA_VERSION: u32 = 1;
const RAW_INPUT_BUFFER_BYTES: usize = 64 * 1024;
const RAW_COPY_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalValueDecodeLimits {
    pub max_value_count: u64,
    pub max_decoded_raw_bytes: u64,
    pub max_string_bytes: u64,
    pub max_metadata_run_bytes: u64,
    pub max_metadata_line_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExternalValueDecodeSummary {
    pub value_count: u64,
    pub decoded_raw_byte_length: u64,
    pub payload_spool_byte_length: u64,
    pub payload_spool_sha256: String,
}

#[derive(Debug)]
pub(super) enum ExternalValueDecodeError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Column(ExternalColumnDecodeError),
    Decoder(AutomergeExternalDecoderError),
    InvalidLimits,
    InvalidMetadataInput,
    InvalidRawInput,
    MetadataRunTooLarge,
    MetadataLineTooLarge,
    MetadataRunTruncated,
    MetadataContractMismatch,
    MetadataTokenOrder,
    InvalidMetadataToken,
    ValueCountLimit,
    MissingRawColumn,
    InvalidRawColumn,
    DecodedRawByteLimit,
    StringByteLimit,
    InvalidUnsignedLeb128,
    InvalidSignedLeb128,
    InvalidFloat,
    InvalidUtf8,
    UnexpectedRawBytes,
    InvalidCompressedColumn,
    RangeOverflow,
}

impl From<std::io::Error> for ExternalValueDecodeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ExternalValueDecodeError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<ExternalColumnDecodeError> for ExternalValueDecodeError {
    fn from(error: ExternalColumnDecodeError) -> Self {
        Self::Column(error)
    }
}

impl From<AutomergeExternalDecoderError> for ExternalValueDecodeError {
    fn from(error: AutomergeExternalDecoderError) -> Self {
        Self::Decoder(error)
    }
}

impl fmt::Display for ExternalValueDecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge value I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "Automerge metadata JSON is invalid: {error}"),
            Self::Column(error) => error.fmt(formatter),
            Self::Decoder(error) => error.fmt(formatter),
            Self::InvalidLimits => formatter.write_str("Automerge value limits are invalid"),
            Self::InvalidMetadataInput => {
                formatter.write_str("Automerge value metadata input is invalid")
            }
            Self::InvalidRawInput => formatter.write_str("Automerge raw value input is invalid"),
            Self::MetadataRunTooLarge => {
                formatter.write_str("Automerge metadata run exceeds the admitted bytes")
            }
            Self::MetadataLineTooLarge => {
                formatter.write_str("Automerge metadata line exceeds the admitted bytes")
            }
            Self::MetadataRunTruncated => {
                formatter.write_str("Automerge metadata run is truncated")
            }
            Self::MetadataContractMismatch => {
                formatter.write_str("Automerge metadata run does not match its contract")
            }
            Self::MetadataTokenOrder => {
                formatter.write_str("Automerge metadata tokens are not contiguous")
            }
            Self::InvalidMetadataToken => {
                formatter.write_str("Automerge value metadata token is invalid")
            }
            Self::ValueCountLimit => {
                formatter.write_str("Automerge values exceed the admitted count")
            }
            Self::MissingRawColumn => {
                formatter.write_str("Automerge value metadata requires a raw column")
            }
            Self::InvalidRawColumn => formatter.write_str("Automerge raw value column is invalid"),
            Self::DecodedRawByteLimit => {
                formatter.write_str("Automerge raw values exceed the admitted decoded bytes")
            }
            Self::StringByteLimit => {
                formatter.write_str("Automerge string exceeds the admitted byte length")
            }
            Self::InvalidUnsignedLeb128 => {
                formatter.write_str("Automerge value contains invalid unsigned LEB128")
            }
            Self::InvalidSignedLeb128 => {
                formatter.write_str("Automerge value contains invalid signed LEB128")
            }
            Self::InvalidFloat => formatter.write_str("Automerge float metadata is invalid"),
            Self::InvalidUtf8 => formatter.write_str("Automerge value is not valid UTF-8"),
            Self::UnexpectedRawBytes => {
                formatter.write_str("Automerge raw value column has unexpected bytes")
            }
            Self::InvalidCompressedColumn => {
                formatter.write_str("Automerge compressed raw value column is invalid")
            }
            Self::RangeOverflow => formatter.write_str("Automerge value range overflows"),
        }
    }
}

impl std::error::Error for ExternalValueDecodeError {}

type ValueResult<T> = Result<T, ExternalValueDecodeError>;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum MetadataRecord {
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
        token: MetadataToken,
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
enum MetadataToken {
    Null,
    Unsigned(String),
    Signed,
    Boolean,
    String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum ScalarDescriptor<'a> {
    Null,
    Boolean {
        value: bool,
    },
    Unsigned {
        value: &'a str,
    },
    Signed {
        value: &'a str,
    },
    Counter {
        value: &'a str,
    },
    Timestamp {
        value: &'a str,
    },
    Float {
        #[serde(rename = "littleEndianBits")]
        little_endian_bits: &'a str,
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

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ValueRecord<'a> {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: &'a str,
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
        value: ScalarDescriptor<'a>,
    },
    Complete {
        summary: &'a ExternalValueDecodeSummary,
    },
}

enum RawStream {
    Plain(BufReader<Take<File>>),
    Deflated(DeflateDecoder<BufReader<Take<File>>>),
}

impl RawStream {
    fn is_deflated(&self) -> bool {
        matches!(self, Self::Deflated(_))
    }

    fn compressed_input_consumed(&self) -> Option<u64> {
        match self {
            Self::Plain(_) => None,
            Self::Deflated(decoder) => Some(decoder.total_in()),
        }
    }
}

impl Read for RawStream {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(reader) => reader.read(output),
            Self::Deflated(reader) => reader.read(output),
        }
    }
}

struct RawValueReader {
    stream: RawStream,
    maximum_decoded_bytes: u64,
    decoded_bytes: u64,
}

impl RawValueReader {
    fn new(
        source: &mut File,
        input: ExternalColumnInput,
        maximum_decoded_bytes: u64,
    ) -> ValueResult<Self> {
        source.seek(SeekFrom::Start(input.offset))?;
        let clone = source.try_clone()?;
        let range = clone.take(input.byte_length);
        let buffered = BufReader::with_capacity(RAW_INPUT_BUFFER_BYTES, range);
        let stream = if input.deflated {
            RawStream::Deflated(DeflateDecoder::new(buffered))
        } else {
            RawStream::Plain(buffered)
        };
        Ok(Self {
            stream,
            maximum_decoded_bytes,
            decoded_bytes: 0,
        })
    }

    fn read_exact_bytes(&mut self, bytes: &mut [u8]) -> ValueResult<()> {
        let byte_length =
            u64::try_from(bytes.len()).map_err(|_| ExternalValueDecodeError::RangeOverflow)?;
        self.admit(byte_length)?;
        if let Err(error) = self.stream.read_exact(bytes) {
            return Err(if self.stream.is_deflated() {
                let _ = error;
                ExternalValueDecodeError::InvalidCompressedColumn
            } else {
                ExternalValueDecodeError::InvalidRawColumn
            });
        }
        self.decoded_bytes += byte_length;
        Ok(())
    }

    fn copy_exact(
        &mut self,
        byte_length: u64,
        payload_spool: &mut impl Write,
        payload_hasher: &mut Sha256,
    ) -> ValueResult<()> {
        self.admit(byte_length)?;
        let mut remaining = byte_length;
        let mut buffer = [0_u8; RAW_COPY_BUFFER_BYTES];
        while remaining > 0 {
            let take = usize::try_from(remaining.min(buffer.len() as u64))
                .map_err(|_| ExternalValueDecodeError::RangeOverflow)?;
            if let Err(error) = self.stream.read_exact(&mut buffer[..take]) {
                return Err(if self.stream.is_deflated() {
                    let _ = error;
                    ExternalValueDecodeError::InvalidCompressedColumn
                } else {
                    ExternalValueDecodeError::InvalidRawColumn
                });
            }
            payload_spool.write_all(&buffer[..take])?;
            payload_hasher.update(&buffer[..take]);
            remaining -= take as u64;
        }
        self.decoded_bytes += byte_length;
        Ok(())
    }

    fn admit(&self, byte_length: u64) -> ValueResult<()> {
        if self
            .decoded_bytes
            .checked_add(byte_length)
            .is_none_or(|next| next > self.maximum_decoded_bytes)
        {
            return Err(ExternalValueDecodeError::DecodedRawByteLimit);
        }
        Ok(())
    }

    fn finish(mut self, expected_input_bytes: u64) -> ValueResult<u64> {
        let mut byte = [0_u8; 1];
        match self.stream.read(&mut byte) {
            Ok(0) => {}
            Ok(_) => return Err(ExternalValueDecodeError::UnexpectedRawBytes),
            Err(error) if self.stream.is_deflated() => {
                let _ = error;
                return Err(ExternalValueDecodeError::InvalidCompressedColumn);
            }
            Err(error) => return Err(ExternalValueDecodeError::Io(error)),
        }
        if self
            .stream
            .compressed_input_consumed()
            .is_some_and(|consumed| consumed != expected_input_bytes)
        {
            return Err(ExternalValueDecodeError::InvalidCompressedColumn);
        }
        Ok(self.decoded_bytes)
    }
}

/// Join one decoded value-metadata run with its exact raw value column.
///
/// The caller must keep the metadata run, raw payload spool, and token run
/// private until the enclosing verified source session returns successfully.
#[allow(clippy::too_many_arguments)]
pub(super) fn write_decoded_value_tokens(
    session: &mut ExternalColumnDecodeSession<'_>,
    metadata_input: ExternalColumnInput,
    metadata_summary: &ExternalColumnDecodeSummary,
    metadata_run: &mut File,
    raw_input: Option<ExternalColumnInput>,
    limits: ExternalValueDecodeLimits,
    payload_spool: &mut impl Write,
    output: &mut impl Write,
) -> ValueResult<ExternalValueDecodeSummary> {
    session.with_source_context(|source, source_byte_length, source_sha256| {
        write_decoded_value_tokens_in_session(
            source,
            source_byte_length,
            source_sha256,
            metadata_input,
            metadata_summary,
            metadata_run,
            raw_input,
            limits,
            payload_spool,
            output,
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn write_decoded_value_tokens_in_session(
    source: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    metadata_input: ExternalColumnInput,
    metadata_summary: &ExternalColumnDecodeSummary,
    metadata_run: &mut File,
    raw_input: Option<ExternalColumnInput>,
    limits: ExternalValueDecodeLimits,
    payload_spool: &mut impl Write,
    output: &mut impl Write,
) -> ValueResult<ExternalValueDecodeSummary> {
    validate_inputs(
        source_byte_length,
        metadata_input,
        metadata_summary,
        raw_input,
        limits,
    )?;
    let metadata_run_byte_length = metadata_run.metadata()?.len();
    if metadata_run_byte_length > limits.max_metadata_run_bytes {
        return Err(ExternalValueDecodeError::MetadataRunTooLarge);
    }
    metadata_run.seek(SeekFrom::Start(0))?;
    let mut metadata_reader = BufReader::new(metadata_run.take(metadata_run_byte_length));

    let (begin, begin_line) =
        next_metadata_record(&mut metadata_reader, limits.max_metadata_line_bytes)?
            .ok_or(ExternalValueDecodeError::MetadataRunTruncated)?;
    let mut metadata_prefix_hasher = Sha256::new();
    let mut metadata_prefix_byte_length = 0_u64;
    hash_metadata_line(
        &begin_line,
        &mut metadata_prefix_hasher,
        &mut metadata_prefix_byte_length,
    )?;
    validate_metadata_begin(begin, source_byte_length, source_sha256, metadata_input)?;

    let mut raw_reader = raw_input
        .map(|input| RawValueReader::new(source, input, limits.max_decoded_raw_bytes))
        .transpose()?;
    write_record(
        output,
        &ValueRecord::Begin {
            schema_version: VALUE_TOKEN_SCHEMA_VERSION,
            source_byte_length,
            source_sha256,
            metadata_offset: metadata_input.offset,
            metadata_byte_length: metadata_input.byte_length,
            raw_offset: raw_input.map(|input| input.offset),
            raw_byte_length: raw_input.map(|input| input.byte_length),
            raw_deflated: raw_input.is_some_and(|input| input.deflated),
        },
    )?;

    let mut value_count = 0_u64;
    let mut payload_spool_byte_length = 0_u64;
    let mut payload_hasher = Sha256::new();
    loop {
        let (record, line) =
            next_metadata_record(&mut metadata_reader, limits.max_metadata_line_bytes)?
                .ok_or(ExternalValueDecodeError::MetadataRunTruncated)?;
        match record {
            MetadataRecord::Token { index, token } => {
                hash_metadata_line(
                    &line,
                    &mut metadata_prefix_hasher,
                    &mut metadata_prefix_byte_length,
                )?;
                if index != value_count {
                    return Err(ExternalValueDecodeError::MetadataTokenOrder);
                }
                if value_count >= limits.max_value_count {
                    return Err(ExternalValueDecodeError::ValueCountLimit);
                }
                let metadata = match token {
                    MetadataToken::Unsigned(value) => parse_canonical_metadata(&value)?,
                    MetadataToken::Null
                    | MetadataToken::Signed
                    | MetadataToken::Boolean
                    | MetadataToken::String => {
                        return Err(ExternalValueDecodeError::InvalidMetadataToken)
                    }
                };
                write_scalar(
                    value_count,
                    metadata,
                    raw_reader.as_mut(),
                    limits,
                    payload_spool,
                    &mut payload_hasher,
                    &mut payload_spool_byte_length,
                    output,
                )?;
                value_count += 1;
            }
            MetadataRecord::Complete { summary } => {
                let metadata_prefix_sha256 = lower_hex(&metadata_prefix_hasher.clone().finalize());
                if summary != *metadata_summary
                    || summary.token_count != value_count
                    || summary.token_run_prefix_byte_length != metadata_prefix_byte_length
                    || summary.token_run_prefix_sha256 != metadata_prefix_sha256
                {
                    return Err(ExternalValueDecodeError::MetadataContractMismatch);
                }
                break;
            }
            MetadataRecord::Begin { .. } => {
                return Err(ExternalValueDecodeError::MetadataContractMismatch)
            }
        }
    }
    if next_metadata_record(&mut metadata_reader, limits.max_metadata_line_bytes)?.is_some() {
        return Err(ExternalValueDecodeError::MetadataContractMismatch);
    }

    let decoded_raw_byte_length = match (raw_reader, raw_input) {
        (Some(reader), Some(input)) => reader.finish(input.byte_length)?,
        (None, None) => 0,
        _ => unreachable!("raw reader and input are constructed together"),
    };
    let summary = ExternalValueDecodeSummary {
        value_count,
        decoded_raw_byte_length,
        payload_spool_byte_length,
        payload_spool_sha256: lower_hex(&payload_hasher.finalize()),
    };
    write_record(output, &ValueRecord::Complete { summary: &summary })?;
    Ok(summary)
}

fn validate_inputs(
    source_byte_length: u64,
    metadata_input: ExternalColumnInput,
    metadata_summary: &ExternalColumnDecodeSummary,
    raw_input: Option<ExternalColumnInput>,
    limits: ExternalValueDecodeLimits,
) -> ValueResult<()> {
    if limits.max_value_count == 0
        || limits.max_decoded_raw_bytes == 0
        || limits.max_string_bytes == 0
        || limits.max_metadata_run_bytes == 0
        || limits.max_metadata_line_bytes == 0
    {
        return Err(ExternalValueDecodeError::InvalidLimits);
    }
    let metadata_end = metadata_input
        .offset
        .checked_add(metadata_input.byte_length)
        .ok_or(ExternalValueDecodeError::InvalidMetadataInput)?;
    if metadata_input.column_type != DocumentColumnType::ValueMetadata
        || metadata_input.byte_length == 0
        || metadata_end > source_byte_length
        || metadata_summary.token_count > limits.max_value_count
    {
        return Err(ExternalValueDecodeError::InvalidMetadataInput);
    }
    if raw_input.is_some_and(|input| {
        input.column_type != DocumentColumnType::Value
            || input.byte_length == 0
            || input.offset != metadata_end
            || input
                .offset
                .checked_add(input.byte_length)
                .is_none_or(|end| end > source_byte_length)
    }) {
        return Err(ExternalValueDecodeError::InvalidRawInput);
    }
    Ok(())
}

fn validate_metadata_begin(
    record: MetadataRecord,
    source_byte_length: u64,
    source_sha256: &str,
    metadata_input: ExternalColumnInput,
) -> ValueResult<()> {
    let MetadataRecord::Begin {
        schema_version,
        source_byte_length: recorded_source_byte_length,
        source_sha256: recorded_source_sha256,
        offset,
        byte_length,
        column_type,
        deflated,
    } = record
    else {
        return Err(ExternalValueDecodeError::MetadataContractMismatch);
    };
    if schema_version != COLUMN_TOKEN_SCHEMA_VERSION
        || recorded_source_byte_length != source_byte_length
        || recorded_source_sha256 != source_sha256
        || offset != metadata_input.offset
        || byte_length != metadata_input.byte_length
        || column_type != DocumentColumnType::ValueMetadata
        || deflated != metadata_input.deflated
    {
        return Err(ExternalValueDecodeError::MetadataContractMismatch);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn write_scalar(
    index: u64,
    metadata: u64,
    raw_reader: Option<&mut RawValueReader>,
    limits: ExternalValueDecodeLimits,
    payload_spool: &mut impl Write,
    payload_hasher: &mut Sha256,
    payload_spool_byte_length: &mut u64,
    output: &mut impl Write,
) -> ValueResult<()> {
    let type_code = (metadata & 0x0f) as u8;
    let byte_length = metadata >> 4;
    match type_code {
        0 if byte_length == 0 => write_value(output, index, ScalarDescriptor::Null),
        1 if byte_length == 0 => {
            write_value(output, index, ScalarDescriptor::Boolean { value: false })
        }
        2 if byte_length == 0 => {
            write_value(output, index, ScalarDescriptor::Boolean { value: true })
        }
        0..=2 => Err(ExternalValueDecodeError::InvalidMetadataToken),
        3 => {
            let bytes = read_small_raw(raw_reader, byte_length)?;
            let value = decode_unsigned(&bytes)?.to_string();
            write_value(output, index, ScalarDescriptor::Unsigned { value: &value })
        }
        4 => {
            let bytes = read_small_raw(raw_reader, byte_length)?;
            let value = decode_signed(&bytes)?.to_string();
            write_value(output, index, ScalarDescriptor::Signed { value: &value })
        }
        5 => {
            if byte_length != 8 {
                return Err(ExternalValueDecodeError::InvalidFloat);
            }
            let bytes = read_small_raw(raw_reader, byte_length)?;
            let bits = lower_hex(&bytes);
            write_value(
                output,
                index,
                ScalarDescriptor::Float {
                    little_endian_bits: &bits,
                },
            )
        }
        6 => write_string_value(
            index,
            byte_length,
            raw_reader,
            limits.max_string_bytes,
            payload_spool,
            payload_hasher,
            payload_spool_byte_length,
            output,
        ),
        7 => write_spooled_value(
            index,
            byte_length,
            raw_reader,
            payload_spool,
            payload_hasher,
            payload_spool_byte_length,
            None,
            output,
        ),
        8 => {
            let bytes = read_small_raw(raw_reader, byte_length)?;
            let value = decode_signed(&bytes)?.to_string();
            write_value(output, index, ScalarDescriptor::Counter { value: &value })
        }
        9 => {
            let bytes = read_small_raw(raw_reader, byte_length)?;
            let value = decode_signed(&bytes)?.to_string();
            write_value(output, index, ScalarDescriptor::Timestamp { value: &value })
        }
        type_code => write_spooled_value(
            index,
            byte_length,
            raw_reader,
            payload_spool,
            payload_hasher,
            payload_spool_byte_length,
            Some(type_code),
            output,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn write_string_value(
    index: u64,
    byte_length: u64,
    raw_reader: Option<&mut RawValueReader>,
    maximum_string_bytes: u64,
    payload_spool: &mut impl Write,
    payload_hasher: &mut Sha256,
    payload_spool_byte_length: &mut u64,
    output: &mut impl Write,
) -> ValueResult<()> {
    if byte_length > maximum_string_bytes {
        return Err(ExternalValueDecodeError::StringByteLimit);
    }
    let mut bytes = vec![
        0_u8;
        usize::try_from(byte_length)
            .map_err(|_| ExternalValueDecodeError::StringByteLimit)?
    ];
    if !bytes.is_empty() {
        raw_reader
            .ok_or(ExternalValueDecodeError::MissingRawColumn)?
            .read_exact_bytes(&mut bytes)?;
    }
    std::str::from_utf8(&bytes).map_err(|_| ExternalValueDecodeError::InvalidUtf8)?;
    let offset = *payload_spool_byte_length;
    write_payload(
        &bytes,
        payload_spool,
        payload_hasher,
        payload_spool_byte_length,
    )?;
    write_value(
        output,
        index,
        ScalarDescriptor::String {
            payload_offset: offset,
            byte_length,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn write_spooled_value(
    index: u64,
    byte_length: u64,
    raw_reader: Option<&mut RawValueReader>,
    payload_spool: &mut impl Write,
    payload_hasher: &mut Sha256,
    payload_spool_byte_length: &mut u64,
    unknown_type_code: Option<u8>,
    output: &mut impl Write,
) -> ValueResult<()> {
    let offset = *payload_spool_byte_length;
    if byte_length > 0 {
        raw_reader
            .ok_or(ExternalValueDecodeError::MissingRawColumn)?
            .copy_exact(byte_length, payload_spool, payload_hasher)?;
    }
    *payload_spool_byte_length = payload_spool_byte_length
        .checked_add(byte_length)
        .ok_or(ExternalValueDecodeError::RangeOverflow)?;
    let descriptor = if let Some(type_code) = unknown_type_code {
        ScalarDescriptor::Unknown {
            type_code,
            payload_offset: offset,
            byte_length,
        }
    } else {
        ScalarDescriptor::Bytes {
            payload_offset: offset,
            byte_length,
        }
    };
    write_value(output, index, descriptor)
}

fn write_payload(
    bytes: &[u8],
    payload_spool: &mut impl Write,
    payload_hasher: &mut Sha256,
    payload_spool_byte_length: &mut u64,
) -> ValueResult<()> {
    payload_spool.write_all(bytes)?;
    payload_hasher.update(bytes);
    *payload_spool_byte_length = payload_spool_byte_length
        .checked_add(bytes.len() as u64)
        .ok_or(ExternalValueDecodeError::RangeOverflow)?;
    Ok(())
}

fn read_small_raw(
    raw_reader: Option<&mut RawValueReader>,
    byte_length: u64,
) -> ValueResult<Vec<u8>> {
    if byte_length == 0 || byte_length > 10 {
        return Err(ExternalValueDecodeError::InvalidMetadataToken);
    }
    let mut bytes = vec![
        0_u8;
        usize::try_from(byte_length)
            .map_err(|_| ExternalValueDecodeError::RangeOverflow)?
    ];
    raw_reader
        .ok_or(ExternalValueDecodeError::MissingRawColumn)?
        .read_exact_bytes(&mut bytes)?;
    Ok(bytes)
}

fn decode_unsigned(bytes: &[u8]) -> ValueResult<u64> {
    let mut value = 0_u64;
    let mut shift = 0_u32;
    for (index, byte) in bytes.iter().copied().enumerate() {
        if index == 9 && byte & 0x7f > 1 {
            return Err(ExternalValueDecodeError::InvalidUnsignedLeb128);
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            if index + 1 != bytes.len() || encode_unsigned(value).as_slice() != bytes {
                return Err(ExternalValueDecodeError::InvalidUnsignedLeb128);
            }
            return Ok(value);
        }
        shift += 7;
    }
    Err(ExternalValueDecodeError::InvalidUnsignedLeb128)
}

fn decode_signed(bytes: &[u8]) -> ValueResult<i64> {
    let mut value = 0_i128;
    let mut shift = 0_u32;
    let mut final_byte = None;
    for (index, byte) in bytes.iter().copied().enumerate() {
        value |= i128::from(byte & 0x7f) << shift;
        shift += 7;
        if byte & 0x80 == 0 {
            if index + 1 != bytes.len() {
                return Err(ExternalValueDecodeError::InvalidSignedLeb128);
            }
            final_byte = Some(byte);
            break;
        }
    }
    let final_byte = final_byte.ok_or(ExternalValueDecodeError::InvalidSignedLeb128)?;
    if final_byte & 0x40 != 0 {
        value |= (!0_i128) << shift;
    }
    let value = i64::try_from(value).map_err(|_| ExternalValueDecodeError::InvalidSignedLeb128)?;
    if encode_signed(value).as_slice() != bytes {
        return Err(ExternalValueDecodeError::InvalidSignedLeb128);
    }
    Ok(value)
}

struct EncodedLeb128 {
    bytes: [u8; 10],
    length: usize,
}

impl EncodedLeb128 {
    fn as_slice(&self) -> &[u8] {
        &self.bytes[..self.length]
    }
}

fn encode_unsigned(mut value: u64) -> EncodedLeb128 {
    let mut encoded = EncodedLeb128 {
        bytes: [0; 10],
        length: 0,
    };
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        encoded.bytes[encoded.length] = byte;
        encoded.length += 1;
        if value == 0 {
            return encoded;
        }
    }
}

fn encode_signed(mut value: i64) -> EncodedLeb128 {
    let mut encoded = EncodedLeb128 {
        bytes: [0; 10],
        length: 0,
    };
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        encoded.bytes[encoded.length] = if done { byte } else { byte | 0x80 };
        encoded.length += 1;
        if done {
            return encoded;
        }
    }
}

fn next_metadata_record(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> ValueResult<Option<(MetadataRecord, Vec<u8>)>> {
    let Some(line) = read_bounded_line(reader, maximum_line_bytes)? else {
        return Ok(None);
    };
    let record = serde_json::from_slice(&line)?;
    Ok(Some((record, line)))
}

fn hash_metadata_line(line: &[u8], hasher: &mut Sha256, byte_length: &mut u64) -> ValueResult<()> {
    hasher.update(line);
    hasher.update(b"\n");
    *byte_length = byte_length
        .checked_add(line.len() as u64)
        .and_then(|length| length.checked_add(1))
        .ok_or(ExternalValueDecodeError::RangeOverflow)?;
    Ok(())
}

fn parse_canonical_metadata(value: &str) -> ValueResult<u64> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| ExternalValueDecodeError::InvalidMetadataToken)?;
    if parsed.to_string() != value {
        return Err(ExternalValueDecodeError::InvalidMetadataToken);
    }
    Ok(parsed)
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    maximum_line_bytes: usize,
) -> ValueResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(ExternalValueDecodeError::MetadataRunTruncated)
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            let take = newline + 1;
            if line
                .len()
                .checked_add(newline)
                .is_none_or(|length| length > maximum_line_bytes)
            {
                return Err(ExternalValueDecodeError::MetadataLineTooLarge);
            }
            line.extend_from_slice(&available[..newline]);
            reader.consume(take);
            return Ok(Some(line));
        }
        if line
            .len()
            .checked_add(available.len())
            .is_none_or(|length| length > maximum_line_bytes)
        {
            return Err(ExternalValueDecodeError::MetadataLineTooLarge);
        }
        let consumed = available.len();
        line.extend_from_slice(available);
        reader.consume(consumed);
    }
}

fn write_value(
    output: &mut impl Write,
    index: u64,
    value: ScalarDescriptor<'_>,
) -> ValueResult<()> {
    write_record(output, &ValueRecord::Value { index, value })
}

fn write_record(output: &mut impl Write, record: &ValueRecord<'_>) -> ValueResult<()> {
    serde_json::to_writer(&mut *output, record)
        .map_err(|error| ExternalValueDecodeError::Io(std::io::Error::other(error)))?;
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
    use flate2::{write::DeflateEncoder, Compression};
    use std::io::Write;
    use tempfile::NamedTempFile;

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
            max_decoded_column_bytes: 4096,
            max_string_bytes: 1024,
        }
    }

    fn value_limits() -> ExternalValueDecodeLimits {
        ExternalValueDecodeLimits {
            max_value_count: 128,
            max_decoded_raw_bytes: 4096,
            max_string_bytes: 1024,
            max_metadata_run_bytes: 64 * 1024,
            max_metadata_line_bytes: 1024,
        }
    }

    fn encode_metadata(values: &[u64]) -> Vec<u8> {
        let mut output = encode_signed(-(values.len() as i64)).as_slice().to_vec();
        for value in values {
            output.extend_from_slice(encode_unsigned(*value).as_slice());
        }
        output
    }

    fn decode_pair(
        source_bytes: &[u8],
        metadata_input: ExternalColumnInput,
        raw_input: Option<ExternalColumnInput>,
        limits: ExternalValueDecodeLimits,
    ) -> ValueResult<(String, Vec<u8>, ExternalValueDecodeSummary)> {
        let mut source = fixture(source_bytes);
        let mut metadata_run = NamedTempFile::new().unwrap();
        let mut output = Vec::new();
        let mut payload = Vec::new();
        let summary = with_verified_column_decode_session(
            source.as_file_mut(),
            source_bytes.len() as u64,
            &digest(source_bytes),
            |session| {
                let metadata_summary = session.write_decoded_column_tokens(
                    metadata_input,
                    column_limits(),
                    metadata_run.as_file_mut(),
                )?;
                write_decoded_value_tokens(
                    session,
                    metadata_input,
                    &metadata_summary,
                    metadata_run.as_file_mut(),
                    raw_input,
                    limits,
                    &mut payload,
                    &mut output,
                )
            },
        )?;
        Ok((String::from_utf8(output).unwrap(), payload, summary))
    }

    #[test]
    fn joins_every_scalar_family_without_retaining_raw_payloads() {
        let raw = [
            0x7f, // uint 127
            0x7e, // int -2
            0, 0, 0, 0, 0, 0, 0xf8, 0x3f, // float 1.5
            b'h', b'e', b'l', b'l', b'o', // string
            1, 2, 3,    // bytes
            0x7d, // counter -3
            0xfb, 0x00, // timestamp 123
            0xaa, 0xbb, // unknown
        ];
        let metadata = encode_metadata(&[
            0,
            1,
            2,
            (1 << 4) | 3,
            (1 << 4) | 4,
            (8 << 4) | 5,
            (5 << 4) | 6,
            (3 << 4) | 7,
            (1 << 4) | 8,
            (2 << 4) | 9,
            (2 << 4) | 10,
        ]);
        let mut source = metadata.clone();
        source.extend_from_slice(&raw);
        let metadata_input = ExternalColumnInput {
            offset: 0,
            byte_length: metadata.len() as u64,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        };
        let raw_input = ExternalColumnInput {
            offset: metadata.len() as u64,
            byte_length: raw.len() as u64,
            column_type: DocumentColumnType::Value,
            deflated: false,
        };

        let (output, payload, summary) =
            decode_pair(&source, metadata_input, Some(raw_input), value_limits()).unwrap();
        assert_eq!(summary.value_count, 11);
        assert_eq!(summary.decoded_raw_byte_length, raw.len() as u64);
        assert_eq!(payload, b"hello\x01\x02\x03\xaa\xbb");
        assert!(output.contains("\"kind\":\"null\""));
        assert!(output.contains("\"kind\":\"boolean\",\"value\":false"));
        assert!(output.contains("\"kind\":\"unsigned\",\"value\":\"127\""));
        assert!(output.contains("\"kind\":\"signed\",\"value\":\"-2\""));
        assert!(output.contains("\"littleEndianBits\":\"000000000000f83f\""));
        assert!(output.contains("\"kind\":\"counter\",\"value\":\"-3\""));
        assert!(output.contains("\"kind\":\"timestamp\",\"value\":\"123\""));
        assert!(output.contains("\"kind\":\"unknown\",\"typeCode\":10"));
    }

    #[test]
    fn handles_empty_payloads_and_the_official_automerge_document() {
        let empty_metadata = encode_metadata(&[0, 1, 2, 6, 7]);
        let empty_input = ExternalColumnInput {
            offset: 0,
            byte_length: empty_metadata.len() as u64,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        };
        let (empty_output, empty_payload, empty_summary) =
            decode_pair(&empty_metadata, empty_input, None, value_limits()).unwrap();
        assert_eq!(empty_summary.value_count, 5);
        assert_eq!(empty_summary.decoded_raw_byte_length, 0);
        assert!(empty_payload.is_empty());
        assert!(empty_output.contains("\"kind\":\"string\",\"payloadOffset\":0,\"byteLength\":0"));
        assert!(empty_output.contains("\"kind\":\"bytes\",\"payloadOffset\":0,\"byteLength\":0"));

        let official = decode_test_hex(OFFICIAL_NONEMPTY_DOCUMENT_HEX);
        let metadata_input = ExternalColumnInput {
            offset: 190,
            byte_length: 8,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        };
        let raw_input = ExternalColumnInput {
            offset: 198,
            byte_length: 16,
            column_type: DocumentColumnType::Value,
            deflated: false,
        };
        let (output, payload, summary) =
            decode_pair(&official, metadata_input, Some(raw_input), value_limits()).unwrap();
        assert_eq!(summary.value_count, 7);
        assert_eq!(summary.decoded_raw_byte_length, 16);
        assert_eq!(payload, b"alphaHellodark");
        assert_eq!(output.matches("\"type\":\"value\"").count(), 7);
    }

    #[test]
    fn rejects_noncanonical_trailing_bounded_and_malformed_inputs() {
        let metadata = encode_metadata(&[(2 << 4) | 3]);
        let mut source = metadata.clone();
        source.extend_from_slice(&[0x81, 0]);
        let metadata_input = ExternalColumnInput {
            offset: 0,
            byte_length: metadata.len() as u64,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        };
        let raw_input = ExternalColumnInput {
            offset: metadata.len() as u64,
            byte_length: 2,
            column_type: DocumentColumnType::Value,
            deflated: false,
        };
        assert!(matches!(
            decode_pair(&source, metadata_input, Some(raw_input), value_limits()),
            Err(ExternalValueDecodeError::InvalidUnsignedLeb128)
        ));
        assert!(matches!(
            decode_pair(
                &source,
                metadata_input,
                Some(ExternalColumnInput {
                    offset: raw_input.offset + 1,
                    byte_length: 1,
                    ..raw_input
                }),
                value_limits(),
            ),
            Err(ExternalValueDecodeError::InvalidRawInput)
        ));

        let metadata = encode_metadata(&[(1 << 4) | 3]);
        let mut trailing = metadata.clone();
        trailing.extend_from_slice(&[1, 2]);
        let metadata_input = ExternalColumnInput {
            offset: 0,
            byte_length: metadata.len() as u64,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        };
        let raw_input = ExternalColumnInput {
            offset: metadata.len() as u64,
            byte_length: 2,
            column_type: DocumentColumnType::Value,
            deflated: false,
        };
        assert!(matches!(
            decode_pair(&trailing, metadata_input, Some(raw_input), value_limits()),
            Err(ExternalValueDecodeError::UnexpectedRawBytes)
        ));

        let long_string_metadata = encode_metadata(&[(5 << 4) | 6]);
        let mut long_string = long_string_metadata.clone();
        long_string.extend_from_slice(b"hello");
        let mut limits = value_limits();
        limits.max_string_bytes = 4;
        assert!(matches!(
            decode_pair(
                &long_string,
                ExternalColumnInput {
                    offset: 0,
                    byte_length: long_string_metadata.len() as u64,
                    column_type: DocumentColumnType::ValueMetadata,
                    deflated: false,
                },
                Some(ExternalColumnInput {
                    offset: long_string_metadata.len() as u64,
                    byte_length: 5,
                    column_type: DocumentColumnType::Value,
                    deflated: false,
                }),
                limits,
            ),
            Err(ExternalValueDecodeError::StringByteLimit)
        ));
    }

    #[test]
    fn rejects_a_shape_preserving_metadata_run_mutation() {
        let metadata = encode_metadata(&[(5 << 4) | 6]);
        let mut source_bytes = metadata.clone();
        source_bytes.extend_from_slice(b"hello");
        let metadata_input = ExternalColumnInput {
            offset: 0,
            byte_length: metadata.len() as u64,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        };
        let raw_input = ExternalColumnInput {
            offset: metadata.len() as u64,
            byte_length: 5,
            column_type: DocumentColumnType::Value,
            deflated: false,
        };
        let mut source = fixture(&source_bytes);
        let mut metadata_run = NamedTempFile::new().unwrap();
        let result: ValueResult<ExternalValueDecodeSummary> = with_verified_column_decode_session(
            source.as_file_mut(),
            source_bytes.len() as u64,
            &digest(&source_bytes),
            |session| {
                let metadata_summary = session.write_decoded_column_tokens(
                    metadata_input,
                    column_limits(),
                    metadata_run.as_file_mut(),
                )?;
                let mut bytes = Vec::new();
                metadata_run.as_file_mut().seek(SeekFrom::Start(0))?;
                metadata_run.as_file_mut().read_to_end(&mut bytes)?;
                let needle = b"\"value\":\"86\"";
                let offset = bytes
                    .windows(needle.len())
                    .position(|window| window == needle)
                    .unwrap();
                bytes[offset + needle.len() - 2] = b'7';
                metadata_run.as_file_mut().set_len(0)?;
                metadata_run.as_file_mut().seek(SeekFrom::Start(0))?;
                metadata_run.as_file_mut().write_all(&bytes)?;
                metadata_run.as_file_mut().sync_all()?;
                write_decoded_value_tokens(
                    session,
                    metadata_input,
                    &metadata_summary,
                    metadata_run.as_file_mut(),
                    Some(raw_input),
                    value_limits(),
                    &mut Vec::new(),
                    &mut Vec::new(),
                )
            },
        );
        assert!(matches!(
            result,
            Err(ExternalValueDecodeError::MetadataContractMismatch)
        ));
    }

    #[test]
    fn streams_raw_deflate_and_rejects_trailing_compressed_input() {
        let metadata = encode_metadata(&[(5 << 4) | 6]);
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(b"hello").unwrap();
        let compressed = encoder.finish().unwrap();
        let mut source = metadata.clone();
        source.extend_from_slice(&compressed);
        let metadata_input = ExternalColumnInput {
            offset: 0,
            byte_length: metadata.len() as u64,
            column_type: DocumentColumnType::ValueMetadata,
            deflated: false,
        };
        let raw_input = ExternalColumnInput {
            offset: metadata.len() as u64,
            byte_length: compressed.len() as u64,
            column_type: DocumentColumnType::Value,
            deflated: true,
        };
        let (_, payload, summary) =
            decode_pair(&source, metadata_input, Some(raw_input), value_limits()).unwrap();
        assert_eq!(payload, b"hello");
        assert_eq!(summary.decoded_raw_byte_length, 5);

        let mut trailing = source;
        trailing.push(0);
        assert!(matches!(
            decode_pair(
                &trailing,
                metadata_input,
                Some(ExternalColumnInput {
                    byte_length: raw_input.byte_length + 1,
                    ..raw_input
                }),
                value_limits(),
            ),
            Err(ExternalValueDecodeError::InvalidCompressedColumn)
        ));
    }
}
