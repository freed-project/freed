//! Bounded primitive-column decoding for external-memory Automerge migration.
//!
//! One exact verified column range becomes one deterministic append-only token
//! run. The decoder never retains the column, expanded run, or output in
//! memory. Composite value and grouped columns are joined by later slices. No
//! command or production caller activates this module.

use crate::automerge_external_common::lower_hex;
use crate::automerge_external_decoder::{verify_source_identity, AutomergeExternalDecoderError};
use crate::automerge_external_document::DocumentColumnType;
use flate2::read::DeflateDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom, Take, Write};

pub(super) const COLUMN_TOKEN_SCHEMA_VERSION: u32 = 1;
const COLUMN_INPUT_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalColumnInput {
    pub offset: u64,
    pub byte_length: u64,
    pub column_type: DocumentColumnType,
    pub deflated: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalColumnDecodeLimits {
    pub max_token_count: u64,
    pub max_decoded_column_bytes: u64,
    pub max_string_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExternalColumnDecodeSummary {
    pub token_count: u64,
    pub decoded_byte_length: u64,
    pub token_run_prefix_byte_length: u64,
    pub token_run_prefix_sha256: String,
}

#[derive(Debug)]
pub(super) enum ExternalColumnDecodeError {
    Io(std::io::Error),
    Decoder(AutomergeExternalDecoderError),
    InvalidLimits,
    InvalidRange,
    UnsupportedRawValueColumn,
    InvalidUnsignedLeb128,
    InvalidSignedLeb128,
    InvalidRleRun,
    TokenCountLimit,
    DecodedByteLimit,
    StringByteLimit,
    InvalidUtf8,
    DeltaOverflow,
    InvalidCompressedColumn,
}

impl From<std::io::Error> for ExternalColumnDecodeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<AutomergeExternalDecoderError> for ExternalColumnDecodeError {
    fn from(error: AutomergeExternalDecoderError) -> Self {
        Self::Decoder(error)
    }
}

impl fmt::Display for ExternalColumnDecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge column I/O failed: {error}"),
            Self::Decoder(error) => error.fmt(formatter),
            Self::InvalidLimits => formatter.write_str("Automerge column limits are invalid"),
            Self::InvalidRange => formatter.write_str("Automerge column range is invalid"),
            Self::UnsupportedRawValueColumn => {
                formatter.write_str("Automerge raw value column requires paired metadata")
            }
            Self::InvalidUnsignedLeb128 => {
                formatter.write_str("Automerge column contains invalid unsigned LEB128")
            }
            Self::InvalidSignedLeb128 => {
                formatter.write_str("Automerge column contains invalid signed LEB128")
            }
            Self::InvalidRleRun => formatter.write_str("Automerge column contains invalid RLE"),
            Self::TokenCountLimit => {
                formatter.write_str("Automerge column exceeds the admitted token count")
            }
            Self::DecodedByteLimit => {
                formatter.write_str("Automerge column exceeds the admitted decoded bytes")
            }
            Self::StringByteLimit => {
                formatter.write_str("Automerge string exceeds the admitted byte length")
            }
            Self::InvalidUtf8 => formatter.write_str("Automerge string is not valid UTF-8"),
            Self::DeltaOverflow => formatter.write_str("Automerge delta column overflows i64"),
            Self::InvalidCompressedColumn => {
                formatter.write_str("Automerge compressed column is invalid")
            }
        }
    }
}

impl std::error::Error for ExternalColumnDecodeError {}

type ColumnResult<T> = Result<T, ExternalColumnDecodeError>;

enum ColumnStream {
    Plain(BufReader<Take<File>>),
    Deflated(DeflateDecoder<BufReader<Take<File>>>),
}

impl ColumnStream {
    fn compressed_input_consumed(&self) -> Option<u64> {
        match self {
            Self::Plain(_) => None,
            Self::Deflated(decoder) => Some(decoder.total_in()),
        }
    }

    fn is_deflated(&self) -> bool {
        matches!(self, Self::Deflated(_))
    }
}

impl Read for ColumnStream {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(reader) => reader.read(output),
            Self::Deflated(reader) => reader.read(output),
        }
    }
}

struct BoundedColumnReader {
    stream: ColumnStream,
    maximum_decoded_bytes: u64,
    decoded_bytes: u64,
    reached_end: bool,
}

impl BoundedColumnReader {
    fn new(
        source: &mut File,
        input: ExternalColumnInput,
        maximum_decoded_bytes: u64,
    ) -> ColumnResult<Self> {
        source.seek(SeekFrom::Start(input.offset))?;
        let clone = source.try_clone()?;
        let range = clone.take(input.byte_length);
        let buffered = BufReader::with_capacity(COLUMN_INPUT_BUFFER_BYTES, range);
        let stream = if input.deflated {
            ColumnStream::Deflated(DeflateDecoder::new(buffered))
        } else {
            ColumnStream::Plain(buffered)
        };
        Ok(Self {
            stream,
            maximum_decoded_bytes,
            decoded_bytes: 0,
            reached_end: false,
        })
    }

    fn read_byte_optional(&mut self) -> ColumnResult<Option<u8>> {
        let mut byte = [0_u8; 1];
        let deflated = self.stream.is_deflated();
        match self.stream.read(&mut byte) {
            Ok(0) => {
                self.reached_end = true;
                Ok(None)
            }
            Ok(1) => {
                self.record_decoded_bytes(1)?;
                Ok(Some(byte[0]))
            }
            Ok(_) => unreachable!("one-byte reads cannot return more than one byte"),
            Err(error) if deflated => {
                let _ = error;
                Err(ExternalColumnDecodeError::InvalidCompressedColumn)
            }
            Err(error) => Err(ExternalColumnDecodeError::Io(error)),
        }
    }

    fn read_exact(&mut self, bytes: &mut [u8]) -> ColumnResult<()> {
        let byte_length =
            u64::try_from(bytes.len()).map_err(|_| ExternalColumnDecodeError::DecodedByteLimit)?;
        if byte_length
            > self
                .maximum_decoded_bytes
                .saturating_sub(self.decoded_bytes)
        {
            return Err(ExternalColumnDecodeError::DecodedByteLimit);
        }
        if let Err(error) = self.stream.read_exact(bytes) {
            return Err(if self.stream.is_deflated() {
                let _ = error;
                ExternalColumnDecodeError::InvalidCompressedColumn
            } else {
                ExternalColumnDecodeError::Io(error)
            });
        }
        self.record_decoded_bytes(byte_length)
    }

    fn record_decoded_bytes(&mut self, byte_length: u64) -> ColumnResult<()> {
        self.decoded_bytes = self
            .decoded_bytes
            .checked_add(byte_length)
            .ok_or(ExternalColumnDecodeError::DecodedByteLimit)?;
        if self.decoded_bytes > self.maximum_decoded_bytes {
            return Err(ExternalColumnDecodeError::DecodedByteLimit);
        }
        Ok(())
    }

    fn finish(mut self, expected_input_bytes: u64) -> ColumnResult<u64> {
        if !self.reached_end && self.read_byte_optional()?.is_some() {
            return Err(ExternalColumnDecodeError::InvalidRleRun);
        }
        if self
            .stream
            .compressed_input_consumed()
            .is_some_and(|consumed| consumed != expected_input_bytes)
        {
            return Err(ExternalColumnDecodeError::InvalidCompressedColumn);
        }
        Ok(self.decoded_bytes)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
enum ColumnTokenValue<'a> {
    Null,
    Unsigned(&'a str),
    Signed(&'a str),
    Boolean(bool),
    String(&'a str),
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ColumnRecord<'a> {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: &'a str,
        offset: u64,
        #[serde(rename = "byteLength")]
        byte_length: u64,
        #[serde(rename = "columnType")]
        column_type: DocumentColumnType,
        deflated: bool,
    },
    Token {
        index: u64,
        token: ColumnTokenValue<'a>,
    },
    Complete {
        summary: &'a ExternalColumnDecodeSummary,
    },
}

/// Hold one exact source identity across a bounded batch of column decodes.
///
/// The caller writes every column run to private temporary files inside
/// `action`. Nothing is publishable unless the closure and the final complete
/// source verification both succeed. This avoids a corpus-sized digest pass
/// for every individual column.
pub(super) fn with_verified_column_decode_session<T, E>(
    source: &mut File,
    expected_source_byte_length: u64,
    expected_source_sha256: &str,
    action: impl FnOnce(&mut ExternalColumnDecodeSession<'_>) -> Result<T, E>,
) -> Result<T, E>
where
    E: From<AutomergeExternalDecoderError>,
{
    verify_source_identity(source, expected_source_byte_length, expected_source_sha256)
        .map_err(E::from)?;
    let result = {
        let mut session = ExternalColumnDecodeSession {
            source,
            source_byte_length: expected_source_byte_length,
            source_sha256: expected_source_sha256.to_owned(),
        };
        action(&mut session)
    };
    verify_source_identity(source, expected_source_byte_length, expected_source_sha256)
        .map_err(E::from)?;
    result
}

pub(super) struct ExternalColumnDecodeSession<'a> {
    source: &'a mut File,
    source_byte_length: u64,
    source_sha256: String,
}

impl ExternalColumnDecodeSession<'_> {
    /// Borrow the already verified source for one higher-layer join.
    ///
    /// The outer session still performs the mandatory complete source
    /// verification after every higher-layer operation returns.
    pub(super) fn with_source_context<T, E>(
        &mut self,
        action: impl FnOnce(&mut File, u64, &str) -> Result<T, E>,
    ) -> Result<T, E> {
        action(self.source, self.source_byte_length, &self.source_sha256)
    }

    /// Decode one exact primitive Automerge column into an unpublished bounded
    /// token run.
    pub(super) fn write_decoded_column_tokens(
        &mut self,
        input: ExternalColumnInput,
        limits: ExternalColumnDecodeLimits,
        output: &mut impl Write,
    ) -> ColumnResult<ExternalColumnDecodeSummary> {
        validate_input(self.source_byte_length, input, limits)?;
        if input.column_type == DocumentColumnType::Value {
            return Err(ExternalColumnDecodeError::UnsupportedRawValueColumn);
        }
        let mut hashed_output = HashingWriter::new(output);
        write_record(
            &mut hashed_output,
            &ColumnRecord::Begin {
                schema_version: COLUMN_TOKEN_SCHEMA_VERSION,
                source_byte_length: self.source_byte_length,
                source_sha256: &self.source_sha256,
                offset: input.offset,
                byte_length: input.byte_length,
                column_type: input.column_type,
                deflated: input.deflated,
            },
        )?;

        let mut reader =
            BoundedColumnReader::new(self.source, input, limits.max_decoded_column_bytes)?;
        let mut token_count = 0_u64;
        match input.column_type {
            DocumentColumnType::Group
            | DocumentColumnType::Actor
            | DocumentColumnType::Integer
            | DocumentColumnType::ValueMetadata => decode_rle(
                &mut reader,
                limits.max_token_count,
                &mut token_count,
                read_unsigned_required,
                |index, value, output| {
                    if let Some(value) = value {
                        let value = value.to_string();
                        write_record(
                            output,
                            &ColumnRecord::Token {
                                index,
                                token: ColumnTokenValue::Unsigned(&value),
                            },
                        )
                    } else {
                        write_null(index, output)
                    }
                },
                &mut hashed_output,
            )?,
            DocumentColumnType::DeltaInteger => {
                let mut absolute = 0_i64;
                decode_rle(
                    &mut reader,
                    limits.max_token_count,
                    &mut token_count,
                    read_signed_required,
                    |index, value, output| {
                        if let Some(delta) = value {
                            absolute = absolute
                                .checked_add(*delta)
                                .ok_or(ExternalColumnDecodeError::DeltaOverflow)?;
                            let value = absolute.to_string();
                            write_record(
                                output,
                                &ColumnRecord::Token {
                                    index,
                                    token: ColumnTokenValue::Signed(&value),
                                },
                            )
                        } else {
                            write_null(index, output)
                        }
                    },
                    &mut hashed_output,
                )?;
            }
            DocumentColumnType::Boolean => {
                decode_booleans(
                    &mut reader,
                    limits.max_token_count,
                    &mut token_count,
                    &mut hashed_output,
                )?;
            }
            DocumentColumnType::String => decode_rle(
                &mut reader,
                limits.max_token_count,
                &mut token_count,
                |reader| read_string(reader, limits.max_string_bytes),
                |index, value, output| {
                    if let Some(value) = value {
                        write_record(
                            output,
                            &ColumnRecord::Token {
                                index,
                                token: ColumnTokenValue::String(value),
                            },
                        )
                    } else {
                        write_null(index, output)
                    }
                },
                &mut hashed_output,
            )?,
            DocumentColumnType::Value => unreachable!("raw values returned before decoding"),
        }
        let decoded_byte_length = reader.finish(input.byte_length)?;
        let (token_run_prefix_byte_length, token_run_prefix_sha256) = hashed_output.finish();
        let summary = ExternalColumnDecodeSummary {
            token_count,
            decoded_byte_length,
            token_run_prefix_byte_length,
            token_run_prefix_sha256,
        };
        write_record(output, &ColumnRecord::Complete { summary: &summary })?;
        Ok(summary)
    }
}

struct HashingWriter<'a, W: Write> {
    output: &'a mut W,
    hasher: Sha256,
    byte_length: u64,
}

impl<'a, W: Write> HashingWriter<'a, W> {
    fn new(output: &'a mut W) -> Self {
        Self {
            output,
            hasher: Sha256::new(),
            byte_length: 0,
        }
    }

    fn finish(self) -> (u64, String) {
        (self.byte_length, lower_hex(&self.hasher.finalize()))
    }
}

impl<W: Write> Write for HashingWriter<'_, W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let written = self.output.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        self.byte_length = self
            .byte_length
            .checked_add(written as u64)
            .ok_or_else(|| std::io::Error::other("Automerge token run length overflows"))?;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.output.flush()
    }
}

fn validate_input(
    source_byte_length: u64,
    input: ExternalColumnInput,
    limits: ExternalColumnDecodeLimits,
) -> ColumnResult<()> {
    if input.byte_length == 0
        || input
            .offset
            .checked_add(input.byte_length)
            .is_none_or(|end| end > source_byte_length)
    {
        return Err(ExternalColumnDecodeError::InvalidRange);
    }
    if limits.max_token_count == 0
        || limits.max_decoded_column_bytes == 0
        || limits.max_string_bytes == 0
    {
        return Err(ExternalColumnDecodeError::InvalidLimits);
    }
    Ok(())
}

fn decode_rle<T, Decode, Emit>(
    reader: &mut BoundedColumnReader,
    maximum_tokens: u64,
    token_count: &mut u64,
    mut decode_value: Decode,
    mut emit: Emit,
    output: &mut impl Write,
) -> ColumnResult<()>
where
    Decode: FnMut(&mut BoundedColumnReader) -> ColumnResult<T>,
    Emit: FnMut(u64, Option<&T>, &mut dyn Write) -> ColumnResult<()>,
{
    while let Some(count) = read_signed_optional(reader)? {
        if count > 0 {
            let run_length =
                u64::try_from(count).map_err(|_| ExternalColumnDecodeError::InvalidRleRun)?;
            admit_tokens(*token_count, run_length, maximum_tokens)?;
            let value = decode_value(reader)?;
            for _ in 0..run_length {
                emit(*token_count, Some(&value), output)?;
                *token_count += 1;
            }
        } else if count < 0 {
            let run_length = count
                .checked_abs()
                .and_then(|value| u64::try_from(value).ok())
                .ok_or(ExternalColumnDecodeError::InvalidRleRun)?;
            admit_tokens(*token_count, run_length, maximum_tokens)?;
            for _ in 0..run_length {
                let value = decode_value(reader)?;
                emit(*token_count, Some(&value), output)?;
                *token_count += 1;
            }
        } else {
            let run_length = read_unsigned_required(reader)?;
            if run_length == 0 {
                return Err(ExternalColumnDecodeError::InvalidRleRun);
            }
            admit_tokens(*token_count, run_length, maximum_tokens)?;
            for _ in 0..run_length {
                emit(*token_count, None, output)?;
                *token_count += 1;
            }
        }
    }
    Ok(())
}

fn decode_booleans(
    reader: &mut BoundedColumnReader,
    maximum_tokens: u64,
    token_count: &mut u64,
    output: &mut impl Write,
) -> ColumnResult<()> {
    let mut value = false;
    while let Some(run_length) = read_unsigned_optional(reader)? {
        admit_tokens(*token_count, run_length, maximum_tokens)?;
        for _ in 0..run_length {
            write_record(
                output,
                &ColumnRecord::Token {
                    index: *token_count,
                    token: ColumnTokenValue::Boolean(value),
                },
            )?;
            *token_count += 1;
        }
        value = !value;
    }
    Ok(())
}

fn admit_tokens(current: u64, additional: u64, maximum: u64) -> ColumnResult<()> {
    if current
        .checked_add(additional)
        .is_none_or(|next| next > maximum)
    {
        return Err(ExternalColumnDecodeError::TokenCountLimit);
    }
    Ok(())
}

fn read_string(
    reader: &mut BoundedColumnReader,
    maximum_string_bytes: u64,
) -> ColumnResult<String> {
    let byte_length = read_unsigned_required(reader)?;
    if byte_length > maximum_string_bytes {
        return Err(ExternalColumnDecodeError::StringByteLimit);
    }
    let length =
        usize::try_from(byte_length).map_err(|_| ExternalColumnDecodeError::StringByteLimit)?;
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes)?;
    String::from_utf8(bytes).map_err(|_| ExternalColumnDecodeError::InvalidUtf8)
}

fn read_unsigned_optional(reader: &mut BoundedColumnReader) -> ColumnResult<Option<u64>> {
    let Some(first) = reader.read_byte_optional()? else {
        return Ok(None);
    };
    let mut bytes = [0_u8; 10];
    bytes[0] = first;
    let mut length = 1_usize;
    let mut value = u64::from(first & 0x7f);
    let mut byte = first;
    while byte & 0x80 != 0 {
        if length == bytes.len() {
            return Err(ExternalColumnDecodeError::InvalidUnsignedLeb128);
        }
        byte = reader
            .read_byte_optional()?
            .ok_or(ExternalColumnDecodeError::InvalidUnsignedLeb128)?;
        bytes[length] = byte;
        if length == 9 && byte & 0x7f > 1 {
            return Err(ExternalColumnDecodeError::InvalidUnsignedLeb128);
        }
        value |= u64::from(byte & 0x7f) << (length * 7);
        length += 1;
    }
    if encode_unsigned_leb128(value).as_slice() != &bytes[..length] {
        return Err(ExternalColumnDecodeError::InvalidUnsignedLeb128);
    }
    Ok(Some(value))
}

fn read_unsigned_required(reader: &mut BoundedColumnReader) -> ColumnResult<u64> {
    read_unsigned_optional(reader)?.ok_or(ExternalColumnDecodeError::InvalidUnsignedLeb128)
}

fn read_signed_optional(reader: &mut BoundedColumnReader) -> ColumnResult<Option<i64>> {
    let Some(first) = reader.read_byte_optional()? else {
        return Ok(None);
    };
    let mut bytes = [0_u8; 10];
    bytes[0] = first;
    let mut length = 1_usize;
    let mut byte = first;
    let mut value = i128::from(byte & 0x7f);
    let mut shift = 7_u32;
    while byte & 0x80 != 0 {
        if length == bytes.len() {
            return Err(ExternalColumnDecodeError::InvalidSignedLeb128);
        }
        byte = reader
            .read_byte_optional()?
            .ok_or(ExternalColumnDecodeError::InvalidSignedLeb128)?;
        bytes[length] = byte;
        value |= i128::from(byte & 0x7f) << shift;
        shift += 7;
        length += 1;
    }
    if byte & 0x40 != 0 {
        value |= (!0_i128) << shift;
    }
    let value = i64::try_from(value).map_err(|_| ExternalColumnDecodeError::InvalidSignedLeb128)?;
    if encode_signed_leb128(value).as_slice() != &bytes[..length] {
        return Err(ExternalColumnDecodeError::InvalidSignedLeb128);
    }
    Ok(Some(value))
}

fn read_signed_required(reader: &mut BoundedColumnReader) -> ColumnResult<i64> {
    read_signed_optional(reader)?.ok_or(ExternalColumnDecodeError::InvalidSignedLeb128)
}

#[derive(Clone, Copy)]
struct EncodedLeb128 {
    bytes: [u8; 10],
    length: usize,
}

impl EncodedLeb128 {
    fn as_slice(&self) -> &[u8] {
        &self.bytes[..self.length]
    }
}

fn encode_unsigned_leb128(mut value: u64) -> EncodedLeb128 {
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

fn encode_signed_leb128(mut value: i64) -> EncodedLeb128 {
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

fn write_null(index: u64, output: &mut dyn Write) -> ColumnResult<()> {
    write_record(
        output,
        &ColumnRecord::Token {
            index,
            token: ColumnTokenValue::Null,
        },
    )
}

fn write_record(output: &mut dyn Write, record: &ColumnRecord<'_>) -> ColumnResult<()> {
    serde_json::to_writer(&mut *output, record)
        .map_err(|error| ExternalColumnDecodeError::Io(std::io::Error::other(error)))?;
    output.write_all(b"\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automerge_external_common::{
        decode_test_hex, lower_hex, OFFICIAL_NONEMPTY_DOCUMENT_HEX,
    };
    use flate2::{write::DeflateEncoder, Compression};
    use sha2::{Digest, Sha256};
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

    fn limits() -> ExternalColumnDecodeLimits {
        ExternalColumnDecodeLimits {
            max_token_count: 64,
            max_decoded_column_bytes: 1024,
            max_string_bytes: 128,
        }
    }

    fn input(bytes: &[u8], column_type: DocumentColumnType) -> ExternalColumnInput {
        ExternalColumnInput {
            offset: 0,
            byte_length: bytes.len() as u64,
            column_type,
            deflated: false,
        }
    }

    fn write_tokens(
        file: &mut File,
        bytes: &[u8],
        column_input: ExternalColumnInput,
        decode_limits: ExternalColumnDecodeLimits,
        output: &mut impl Write,
    ) -> ColumnResult<ExternalColumnDecodeSummary> {
        with_verified_column_decode_session(file, bytes.len() as u64, &digest(bytes), |session| {
            session.write_decoded_column_tokens(column_input, decode_limits, output)
        })
    }

    fn decode(
        bytes: &[u8],
        column_type: DocumentColumnType,
    ) -> (String, ExternalColumnDecodeSummary) {
        let mut file = fixture(bytes);
        let mut output = Vec::new();
        let summary = write_tokens(
            file.as_file_mut(),
            bytes,
            input(bytes, column_type),
            limits(),
            &mut output,
        )
        .unwrap();
        (String::from_utf8(output).unwrap(), summary)
    }

    #[test]
    fn decodes_unsigned_delta_boolean_and_string_columns() {
        let (unsigned, summary) = decode(&[2, 7, 0x7e, 1, 2, 0, 2], DocumentColumnType::Integer);
        assert_eq!(summary.token_count, 6);
        assert_eq!(summary.decoded_byte_length, 7);
        assert!(summary.token_run_prefix_byte_length > 0);
        assert_eq!(summary.token_run_prefix_sha256.len(), 64);
        assert_eq!(unsigned.matches("\"kind\":\"unsigned\"").count(), 4);
        assert_eq!(unsigned.matches("\"kind\":\"null\"").count(), 2);
        assert!(unsigned.contains("\"value\":\"7\""));

        let (delta, _) = decode(&[3, 1], DocumentColumnType::DeltaInteger);
        assert!(delta.contains("\"value\":\"1\""));
        assert!(delta.contains("\"value\":\"2\""));
        assert!(delta.contains("\"value\":\"3\""));

        let (booleans, _) = decode(&[2, 3, 1], DocumentColumnType::Boolean);
        assert_eq!(booleans.matches("\"value\":false").count(), 3);
        assert_eq!(booleans.matches("\"value\":true").count(), 3);

        let (strings, _) = decode(
            &[1, 5, b'h', b'e', b'l', b'l', b'o'],
            DocumentColumnType::String,
        );
        assert!(strings.contains("\"kind\":\"string\",\"value\":\"hello\""));
    }

    #[test]
    fn decodes_real_columns_from_the_official_automerge_document() {
        let bytes = decode_test_hex(OFFICIAL_NONEMPTY_DOCUMENT_HEX);
        let mut file = fixture(&bytes);
        let mut actor_output = Vec::new();
        let mut sequence_output = Vec::new();
        let mut key_output = Vec::new();

        with_verified_column_decode_session(
            file.as_file_mut(),
            bytes.len() as u64,
            &digest(&bytes),
            |session| {
                session.write_decoded_column_tokens(
                    ExternalColumnInput {
                        offset: 97,
                        byte_length: 2,
                        column_type: DocumentColumnType::Actor,
                        deflated: false,
                    },
                    limits(),
                    &mut actor_output,
                )?;
                session.write_decoded_column_tokens(
                    ExternalColumnInput {
                        offset: 99,
                        byte_length: 2,
                        column_type: DocumentColumnType::DeltaInteger,
                        deflated: false,
                    },
                    limits(),
                    &mut sequence_output,
                )?;
                session.write_decoded_column_tokens(
                    ExternalColumnInput {
                        offset: 125,
                        byte_length: 50,
                        column_type: DocumentColumnType::String,
                        deflated: false,
                    },
                    limits(),
                    &mut key_output,
                )?;
                Ok::<(), ExternalColumnDecodeError>(())
            },
        )
        .unwrap();

        assert!(String::from_utf8(actor_output)
            .unwrap()
            .contains("\"kind\":\"unsigned\",\"value\":\"0\""));
        assert!(String::from_utf8(sequence_output)
            .unwrap()
            .contains("\"kind\":\"signed\",\"value\":\"1\""));
        let keys = String::from_utf8(key_output).unwrap();
        for expected in [
            "items",
            "preferences",
            "alpha",
            "createdAt",
            "id",
            "title",
            "theme",
        ] {
            assert!(keys.contains(&format!("\"value\":\"{expected}\"")));
        }
    }

    #[test]
    fn streams_deflated_columns_and_rejects_trailing_compressed_input() {
        let plain = [3, 9];
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&plain).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut file = fixture(&compressed);
        let mut output = Vec::new();
        let summary = write_tokens(
            file.as_file_mut(),
            &compressed,
            ExternalColumnInput {
                deflated: true,
                ..input(&compressed, DocumentColumnType::Actor)
            },
            limits(),
            &mut output,
        )
        .unwrap();
        assert_eq!(summary.token_count, 3);
        assert_eq!(summary.decoded_byte_length, 2);

        let mut trailing = compressed;
        trailing.push(0);
        let mut trailing_file = fixture(&trailing);
        assert!(matches!(
            write_tokens(
                trailing_file.as_file_mut(),
                &trailing,
                ExternalColumnInput {
                    deflated: true,
                    ..input(&trailing, DocumentColumnType::Actor)
                },
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalColumnDecodeError::InvalidCompressedColumn)
        ));
    }

    #[test]
    fn rejects_noncanonical_runs_limits_invalid_utf8_and_raw_values() {
        let noncanonical_unsigned = [1, 0x81, 0];
        let mut noncanonical = fixture(&noncanonical_unsigned);
        assert!(matches!(
            write_tokens(
                noncanonical.as_file_mut(),
                &noncanonical_unsigned,
                input(&noncanonical_unsigned, DocumentColumnType::Integer),
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalColumnDecodeError::InvalidUnsignedLeb128)
        ));

        let excessive_run = [0xc1, 0x00, 1];
        let mut excessive = fixture(&excessive_run);
        assert!(matches!(
            write_tokens(
                excessive.as_file_mut(),
                &excessive_run,
                input(&excessive_run, DocumentColumnType::Integer),
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalColumnDecodeError::TokenCountLimit)
        ));

        let invalid_utf8 = [1, 1, 0xff];
        let mut invalid = fixture(&invalid_utf8);
        assert!(matches!(
            write_tokens(
                invalid.as_file_mut(),
                &invalid_utf8,
                input(&invalid_utf8, DocumentColumnType::String),
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalColumnDecodeError::InvalidUtf8)
        ));

        let raw = [1];
        let mut raw_file = fixture(&raw);
        assert!(matches!(
            write_tokens(
                raw_file.as_file_mut(),
                &raw,
                input(&raw, DocumentColumnType::Value),
                limits(),
                &mut Vec::new(),
            ),
            Err(ExternalColumnDecodeError::UnsupportedRawValueColumn)
        ));
    }

    #[test]
    fn one_session_decodes_multiple_ranges_and_rejects_source_replacement() {
        let first = [1, 7];
        let second = [2];
        let bytes = [first.as_slice(), second.as_slice()].concat();
        let mut file = fixture(&bytes);
        let replacement_handle = file.as_file().try_clone().unwrap();
        let mut first_output = Vec::new();
        let mut second_output = Vec::new();

        let result = with_verified_column_decode_session(
            file.as_file_mut(),
            bytes.len() as u64,
            &digest(&bytes),
            |session| {
                session.write_decoded_column_tokens(
                    ExternalColumnInput {
                        offset: 0,
                        byte_length: first.len() as u64,
                        column_type: DocumentColumnType::Integer,
                        deflated: false,
                    },
                    limits(),
                    &mut first_output,
                )?;
                session.write_decoded_column_tokens(
                    ExternalColumnInput {
                        offset: first.len() as u64,
                        byte_length: second.len() as u64,
                        column_type: DocumentColumnType::Boolean,
                        deflated: false,
                    },
                    limits(),
                    &mut second_output,
                )?;
                let mut replacement = replacement_handle.try_clone().unwrap();
                replacement.seek(SeekFrom::Start(0)).unwrap();
                replacement.write_all(&[1, 8, 2]).unwrap();
                replacement.sync_data().unwrap();
                Ok(())
            },
        );

        assert!(matches!(
            result,
            Err(ExternalColumnDecodeError::Decoder(
                AutomergeExternalDecoderError::SourceDigestMismatch
            ))
        ));
        assert!(String::from_utf8(first_output)
            .unwrap()
            .contains("\"value\":\"7\""));
        assert_eq!(
            String::from_utf8(second_output)
                .unwrap()
                .matches("\"value\":false")
                .count(),
            2
        );
    }
}
