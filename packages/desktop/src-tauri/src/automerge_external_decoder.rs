//! Bounded framing verifier for immutable Automerge migration snapshots.
//!
//! Automerge 2.2.9 stores a document as concatenated binary chunks. The
//! upstream loader parses each complete chunk into memory and reconstructs a
//! complete change graph. Library Core cannot use that path because the source
//! may be larger than available memory. This dormant module verifies only the
//! outer framing and checksums, then emits one deterministic JSONL descriptor
//! at a time. Later slices consume those descriptors to create bounded change
//! and object runs. No command or production caller activates this module.

use crate::automerge_external_common::{is_lower_sha256, lower_hex};
use flate2::read::DeflateDecoder;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

const AUTOMERGE_MAGIC: [u8; 4] = [0x85, 0x6f, 0x4a, 0x83];
const STREAM_BUFFER_BYTES: usize = 64 * 1024;
const SOURCE_DIGEST_BUFFER_BYTES: usize = 1024 * 1024;
const INDEX_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ExternalDecoderLimits {
    pub max_chunk_count: u64,
    pub max_decompressed_chunk_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum AutomergeChunkKind {
    Document,
    Change,
    CompressedChange,
}

impl AutomergeChunkKind {
    fn from_wire(value: u8) -> Result<Self, AutomergeExternalDecoderError> {
        match value {
            0 => Ok(Self::Document),
            1 => Ok(Self::Change),
            2 => Ok(Self::CompressedChange),
            other => Err(AutomergeExternalDecoderError::UnknownChunkType(other)),
        }
    }

    fn wire_type(self) -> u8 {
        match self {
            Self::Document => 0,
            Self::Change => 1,
            Self::CompressedChange => 2,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AutomergeChunkDescriptor {
    pub ordinal: u64,
    pub kind: AutomergeChunkKind,
    pub offset: u64,
    pub header_byte_length: u8,
    pub data_byte_length: u64,
    pub decoded_byte_length: u64,
    pub checksum: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AutomergeChunkIndexSummary {
    pub chunk_count: u64,
    pub document_chunk_count: u64,
    pub change_chunk_count: u64,
    pub compressed_change_chunk_count: u64,
    pub indexed_byte_length: u64,
}

#[derive(Debug)]
pub(super) enum AutomergeExternalDecoderError {
    Io(std::io::Error),
    InvalidSourceIdentity,
    SourceLengthMismatch,
    SourceDigestMismatch,
    InvalidMagic { offset: u64 },
    UnknownChunkType(u8),
    InvalidLengthEncoding,
    ChunkLengthOverflow,
    TruncatedChunk,
    ChecksumMismatch { ordinal: u64 },
    InvalidCompressedChunk { ordinal: u64 },
    ChunkCountLimit,
    DecompressedChunkLimit { ordinal: u64 },
}

impl From<std::io::Error> for AutomergeExternalDecoderError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for AutomergeExternalDecoderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Automerge external decoder I/O failed: {error}"),
            Self::InvalidSourceIdentity => {
                formatter.write_str("Automerge source identity is invalid")
            }
            Self::SourceLengthMismatch => {
                formatter.write_str("Automerge source byte length does not match")
            }
            Self::SourceDigestMismatch => {
                formatter.write_str("Automerge source digest does not match")
            }
            Self::InvalidMagic { offset } => {
                write!(
                    formatter,
                    "Automerge chunk at offset {offset} has invalid magic"
                )
            }
            Self::UnknownChunkType(kind) => {
                write!(formatter, "Automerge chunk type {kind} is unsupported")
            }
            Self::InvalidLengthEncoding => {
                formatter.write_str("Automerge chunk length is not canonical ULEB128")
            }
            Self::ChunkLengthOverflow => {
                formatter.write_str("Automerge chunk length overflows the source range")
            }
            Self::TruncatedChunk => formatter.write_str("Automerge chunk is truncated"),
            Self::ChecksumMismatch { ordinal } => {
                write!(
                    formatter,
                    "Automerge chunk {ordinal} checksum does not match"
                )
            }
            Self::InvalidCompressedChunk { ordinal } => {
                write!(formatter, "Automerge compressed chunk {ordinal} is invalid")
            }
            Self::ChunkCountLimit => {
                formatter.write_str("Automerge source exceeds the admitted chunk count")
            }
            Self::DecompressedChunkLimit { ordinal } => write!(
                formatter,
                "Automerge compressed chunk {ordinal} exceeds the admitted decoded length"
            ),
        }
    }
}

impl std::error::Error for AutomergeExternalDecoderError {}

type DecoderResult<T> = Result<T, AutomergeExternalDecoderError>;

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum IndexRecord<'a> {
    Begin {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "automergeFormat")]
        automerge_format: &'static str,
        #[serde(rename = "sourceByteLength")]
        source_byte_length: u64,
        #[serde(rename = "sourceSha256")]
        source_sha256: &'a str,
    },
    Chunk {
        descriptor: &'a AutomergeChunkDescriptor,
    },
    Complete {
        summary: &'a AutomergeChunkIndexSummary,
    },
}

/// Verify one finalized source and stream its deterministic chunk index.
///
/// `index` receives a complete JSONL index only when the final `complete`
/// record is present. A caller persists it through a private temporary file,
/// syncs it, and publishes it immutably after this function returns.
pub(super) fn write_verified_chunk_index(
    source: &mut File,
    expected_source_byte_length: u64,
    expected_source_sha256: &str,
    limits: ExternalDecoderLimits,
    index: &mut impl Write,
) -> DecoderResult<AutomergeChunkIndexSummary> {
    if expected_source_byte_length == 0
        || !is_lower_sha256(expected_source_sha256)
        || limits.max_chunk_count == 0
        || limits.max_decompressed_chunk_bytes == 0
    {
        return Err(AutomergeExternalDecoderError::InvalidSourceIdentity);
    }
    if source.metadata()?.len() != expected_source_byte_length {
        return Err(AutomergeExternalDecoderError::SourceLengthMismatch);
    }
    if digest_source(source, expected_source_byte_length)? != expected_source_sha256 {
        return Err(AutomergeExternalDecoderError::SourceDigestMismatch);
    }

    write_index_record(
        index,
        &IndexRecord::Begin {
            schema_version: INDEX_SCHEMA_VERSION,
            automerge_format: "automerge_2_2_binary",
            source_byte_length: expected_source_byte_length,
            source_sha256: expected_source_sha256,
        },
    )?;

    let mut summary = AutomergeChunkIndexSummary {
        chunk_count: 0,
        document_chunk_count: 0,
        change_chunk_count: 0,
        compressed_change_chunk_count: 0,
        indexed_byte_length: 0,
    };
    let mut offset = 0_u64;
    while offset < expected_source_byte_length {
        if summary.chunk_count >= limits.max_chunk_count {
            return Err(AutomergeExternalDecoderError::ChunkCountLimit);
        }
        let descriptor = verify_chunk(
            source,
            summary.chunk_count,
            offset,
            expected_source_byte_length,
            limits.max_decompressed_chunk_bytes,
        )?;
        let chunk_byte_length = u64::from(descriptor.header_byte_length)
            .checked_add(descriptor.data_byte_length)
            .ok_or(AutomergeExternalDecoderError::ChunkLengthOverflow)?;
        offset = offset
            .checked_add(chunk_byte_length)
            .ok_or(AutomergeExternalDecoderError::ChunkLengthOverflow)?;
        summary.chunk_count += 1;
        summary.indexed_byte_length = offset;
        match descriptor.kind {
            AutomergeChunkKind::Document => summary.document_chunk_count += 1,
            AutomergeChunkKind::Change => summary.change_chunk_count += 1,
            AutomergeChunkKind::CompressedChange => summary.compressed_change_chunk_count += 1,
        }
        write_index_record(
            index,
            &IndexRecord::Chunk {
                descriptor: &descriptor,
            },
        )?;
    }
    if offset != expected_source_byte_length {
        return Err(AutomergeExternalDecoderError::TruncatedChunk);
    }
    if source.metadata()?.len() != expected_source_byte_length
        || digest_source(source, expected_source_byte_length)? != expected_source_sha256
    {
        return Err(AutomergeExternalDecoderError::SourceDigestMismatch);
    }
    write_index_record(index, &IndexRecord::Complete { summary: &summary })?;
    if source.metadata()?.len() != expected_source_byte_length
        || digest_source(source, expected_source_byte_length)? != expected_source_sha256
    {
        return Err(AutomergeExternalDecoderError::SourceDigestMismatch);
    }
    Ok(summary)
}

pub(super) fn verify_chunk(
    source: &mut File,
    ordinal: u64,
    offset: u64,
    source_byte_length: u64,
    max_decompressed_chunk_bytes: u64,
) -> DecoderResult<AutomergeChunkDescriptor> {
    source.seek(SeekFrom::Start(offset))?;
    let mut fixed_header = [0_u8; 9];
    read_exact_or_truncated(source, &mut fixed_header)?;
    if fixed_header[..4] != AUTOMERGE_MAGIC {
        return Err(AutomergeExternalDecoderError::InvalidMagic { offset });
    }
    let expected_checksum = [
        fixed_header[4],
        fixed_header[5],
        fixed_header[6],
        fixed_header[7],
    ];
    let kind = AutomergeChunkKind::from_wire(fixed_header[8])?;
    let (data_byte_length, encoded_length) = read_canonical_uleb128(source)?;
    let header_byte_length = u8::try_from(9 + encoded_length.len())
        .map_err(|_| AutomergeExternalDecoderError::InvalidLengthEncoding)?;
    let data_offset = offset
        .checked_add(u64::from(header_byte_length))
        .ok_or(AutomergeExternalDecoderError::ChunkLengthOverflow)?;
    let data_end = data_offset
        .checked_add(data_byte_length)
        .ok_or(AutomergeExternalDecoderError::ChunkLengthOverflow)?;
    if data_end > source_byte_length {
        return Err(AutomergeExternalDecoderError::TruncatedChunk);
    }

    let decoded_byte_length = match kind {
        AutomergeChunkKind::Document | AutomergeChunkKind::Change => {
            let actual = hash_uncompressed_chunk(
                source,
                kind.wire_type(),
                encoded_length.as_slice(),
                data_offset,
                data_byte_length,
            )?;
            if actual != expected_checksum {
                return Err(AutomergeExternalDecoderError::ChecksumMismatch { ordinal });
            }
            data_byte_length
        }
        AutomergeChunkKind::CompressedChange => {
            let decoded_length = measure_deflated_change(
                source,
                ordinal,
                data_offset,
                data_byte_length,
                max_decompressed_chunk_bytes,
            )?;
            let actual = hash_deflated_change(
                source,
                ordinal,
                data_offset,
                data_byte_length,
                decoded_length,
            )?;
            if actual != expected_checksum {
                return Err(AutomergeExternalDecoderError::ChecksumMismatch { ordinal });
            }
            decoded_length
        }
    };
    source.seek(SeekFrom::Start(data_end))?;

    Ok(AutomergeChunkDescriptor {
        ordinal,
        kind,
        offset,
        header_byte_length,
        data_byte_length,
        decoded_byte_length,
        checksum: lower_hex(&expected_checksum),
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct EncodedUleb128 {
    bytes: [u8; 10],
    length: u8,
}

impl EncodedUleb128 {
    fn len(self) -> usize {
        self.length as usize
    }

    fn as_slice(&self) -> &[u8] {
        &self.bytes[..self.length as usize]
    }
}

fn read_canonical_uleb128(source: &mut impl Read) -> DecoderResult<(u64, EncodedUleb128)> {
    let mut encoded = EncodedUleb128 {
        bytes: [0; 10],
        length: 0,
    };
    let mut value = 0_u64;
    for index in 0..10_u32 {
        let mut one = [0_u8; 1];
        read_exact_or_truncated(source, &mut one)?;
        let byte = one[0];
        encoded.bytes[index as usize] = byte;
        encoded.length += 1;
        let payload = u64::from(byte & 0x7f);
        if index == 9 && payload > 1 {
            return Err(AutomergeExternalDecoderError::InvalidLengthEncoding);
        }
        value |= payload << (index * 7);
        if byte & 0x80 == 0 {
            if encode_uleb128(value) != encoded {
                return Err(AutomergeExternalDecoderError::InvalidLengthEncoding);
            }
            return Ok((value, encoded));
        }
    }
    Err(AutomergeExternalDecoderError::InvalidLengthEncoding)
}

pub(super) fn read_canonical_uleb128_value(source: &mut impl Read) -> DecoderResult<u64> {
    read_canonical_uleb128(source).map(|(value, _)| value)
}

fn encode_uleb128(mut value: u64) -> EncodedUleb128 {
    let mut encoded = EncodedUleb128 {
        bytes: [0; 10],
        length: 0,
    };
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        encoded.bytes[encoded.length as usize] = byte;
        encoded.length += 1;
        if value == 0 {
            return encoded;
        }
    }
}

fn hash_uncompressed_chunk(
    source: &mut File,
    wire_type: u8,
    encoded_length: &[u8],
    data_offset: u64,
    data_byte_length: u64,
) -> DecoderResult<[u8; 4]> {
    source.seek(SeekFrom::Start(data_offset))?;
    let mut hasher = Sha256::new();
    hasher.update([wire_type]);
    hasher.update(encoded_length);
    hash_exact_bytes(source, data_byte_length, &mut hasher)?;
    Ok(first_four(hasher.finalize()))
}

fn measure_deflated_change(
    source: &mut File,
    ordinal: u64,
    data_offset: u64,
    data_byte_length: u64,
    maximum: u64,
) -> DecoderResult<u64> {
    source.seek(SeekFrom::Start(data_offset))?;
    let limited = Read::by_ref(source).take(data_byte_length);
    let mut decoder = DeflateDecoder::new(limited);
    let mut buffer = [0_u8; STREAM_BUFFER_BYTES];
    let mut decoded = 0_u64;
    loop {
        let read = decoder
            .read(&mut buffer)
            .map_err(|_| AutomergeExternalDecoderError::InvalidCompressedChunk { ordinal })?;
        if read == 0 {
            break;
        }
        decoded = decoded
            .checked_add(read as u64)
            .ok_or(AutomergeExternalDecoderError::DecompressedChunkLimit { ordinal })?;
        if decoded > maximum {
            return Err(AutomergeExternalDecoderError::DecompressedChunkLimit { ordinal });
        }
    }
    if decoder.total_in() != data_byte_length {
        return Err(AutomergeExternalDecoderError::InvalidCompressedChunk { ordinal });
    }
    Ok(decoded)
}

fn hash_deflated_change(
    source: &mut File,
    ordinal: u64,
    data_offset: u64,
    data_byte_length: u64,
    decoded_byte_length: u64,
) -> DecoderResult<[u8; 4]> {
    source.seek(SeekFrom::Start(data_offset))?;
    let limited = Read::by_ref(source).take(data_byte_length);
    let mut decoder = DeflateDecoder::new(limited);
    let mut hasher = Sha256::new();
    hasher.update([AutomergeChunkKind::Change.wire_type()]);
    hasher.update(encode_uleb128(decoded_byte_length).as_slice());
    let mut buffer = [0_u8; STREAM_BUFFER_BYTES];
    let mut decoded = 0_u64;
    loop {
        let read = decoder
            .read(&mut buffer)
            .map_err(|_| AutomergeExternalDecoderError::InvalidCompressedChunk { ordinal })?;
        if read == 0 {
            break;
        }
        decoded = decoded
            .checked_add(read as u64)
            .ok_or(AutomergeExternalDecoderError::InvalidCompressedChunk { ordinal })?;
        hasher.update(&buffer[..read]);
    }
    if decoder.total_in() != data_byte_length || decoded != decoded_byte_length {
        return Err(AutomergeExternalDecoderError::InvalidCompressedChunk { ordinal });
    }
    Ok(first_four(hasher.finalize()))
}

fn hash_exact_bytes(
    source: &mut File,
    mut remaining: u64,
    hasher: &mut Sha256,
) -> DecoderResult<()> {
    let mut buffer = [0_u8; STREAM_BUFFER_BYTES];
    while remaining > 0 {
        let requested = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| AutomergeExternalDecoderError::ChunkLengthOverflow)?;
        source.read_exact(&mut buffer[..requested])?;
        hasher.update(&buffer[..requested]);
        remaining -= requested as u64;
    }
    Ok(())
}

fn read_exact_or_truncated(source: &mut impl Read, bytes: &mut [u8]) -> DecoderResult<()> {
    match source.read_exact(bytes) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            Err(AutomergeExternalDecoderError::TruncatedChunk)
        }
        Err(error) => Err(AutomergeExternalDecoderError::Io(error)),
    }
}

fn digest_source(source: &mut File, mut remaining: u64) -> DecoderResult<String> {
    source.seek(SeekFrom::Start(0))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; SOURCE_DIGEST_BUFFER_BYTES];
    while remaining > 0 {
        let requested = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| AutomergeExternalDecoderError::SourceLengthMismatch)?;
        source.read_exact(&mut buffer[..requested])?;
        hasher.update(&buffer[..requested]);
        remaining -= requested as u64;
    }
    Ok(lower_hex(&hasher.finalize()))
}

pub(super) fn verify_source_identity(
    source: &mut File,
    expected_source_byte_length: u64,
    expected_source_sha256: &str,
) -> DecoderResult<()> {
    if expected_source_byte_length == 0 || !is_lower_sha256(expected_source_sha256) {
        return Err(AutomergeExternalDecoderError::InvalidSourceIdentity);
    }
    if source.metadata()?.len() != expected_source_byte_length {
        return Err(AutomergeExternalDecoderError::SourceLengthMismatch);
    }
    if digest_source(source, expected_source_byte_length)? != expected_source_sha256 {
        return Err(AutomergeExternalDecoderError::SourceDigestMismatch);
    }
    Ok(())
}

fn first_four(digest: impl AsRef<[u8]>) -> [u8; 4] {
    let bytes = digest.as_ref();
    [bytes[0], bytes[1], bytes[2], bytes[3]]
}

fn write_index_record(index: &mut impl Write, record: &IndexRecord<'_>) -> DecoderResult<()> {
    serde_json::to_writer(&mut *index, record)
        .map_err(|error| AutomergeExternalDecoderError::Io(std::io::Error::other(error)))?;
    index.write_all(b"\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, Write};
    use tempfile::NamedTempFile;

    // Generated through the exact installed @automerge/automerge 2.2.9
    // implementation. The compressed fixture is a valid change chunk whose
    // 4,152-byte decoded body is raw-DEFLATE encoded to 87 bytes.
    const EMPTY_DOCUMENT_HEX: &str = "856f4a83b81a9544000400000000";
    const COMPRESSED_CHANGE_HEX: &str = "856f4a83307f50e102576310c8f2de35457999c38c5d920d2b7a4a5d3318196f7d5b71998d81814d94cd84d189298c25bc41a180a99ea524b5a284b19eb1bead81a562148c8251300a46c1281805a360148c8251300a46c1281805c31ed4330000";

    fn limits() -> ExternalDecoderLimits {
        ExternalDecoderLimits {
            max_chunk_count: 16,
            max_decompressed_chunk_bytes: 8 * 1024 * 1024,
        }
    }

    fn fixture_file(bytes: &[u8]) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(bytes).unwrap();
        file.as_file_mut().sync_all().unwrap();
        file
    }

    fn digest(bytes: &[u8]) -> String {
        lower_hex(&Sha256::digest(bytes))
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        assert!(value.len().is_multiple_of(2));
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let high = (pair[0] as char).to_digit(16).unwrap();
                let low = (pair[1] as char).to_digit(16).unwrap();
                ((high << 4) | low) as u8
            })
            .collect()
    }

    fn synthetic_chunk(kind: u8, data: &[u8]) -> Vec<u8> {
        let encoded_length = encode_uleb128(data.len() as u64);
        let mut hasher = Sha256::new();
        hasher.update([kind]);
        hasher.update(encoded_length.as_slice());
        hasher.update(data);
        let checksum = first_four(hasher.finalize());
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&AUTOMERGE_MAGIC);
        chunk.extend_from_slice(&checksum);
        chunk.push(kind);
        chunk.extend_from_slice(encoded_length.as_slice());
        chunk.extend_from_slice(data);
        chunk
    }

    #[test]
    fn indexes_official_document_change_and_compressed_change_frames() {
        let empty = decode_hex(EMPTY_DOCUMENT_HEX);
        let change = synthetic_chunk(1, b"bounded change body");
        let compressed = decode_hex(COMPRESSED_CHANGE_HEX);
        let source = [empty, change, compressed].concat();
        let mut file = fixture_file(&source);
        let mut index = Vec::new();

        let summary = write_verified_chunk_index(
            file.as_file_mut(),
            source.len() as u64,
            &digest(&source),
            limits(),
            &mut index,
        )
        .unwrap();

        assert_eq!(
            summary,
            AutomergeChunkIndexSummary {
                chunk_count: 3,
                document_chunk_count: 1,
                change_chunk_count: 1,
                compressed_change_chunk_count: 1,
                indexed_byte_length: source.len() as u64,
            }
        );
        let lines = String::from_utf8(index).unwrap();
        assert!(lines.contains("\"automergeFormat\":\"automerge_2_2_binary\""));
        assert!(lines.contains("\"kind\":\"document\""));
        assert!(lines.contains("\"kind\":\"change\""));
        assert!(lines.contains("\"kind\":\"compressed_change\""));
        assert!(lines.contains("\"decodedByteLength\":4152"));
        assert!(lines.ends_with(&format!("\"indexedByteLength\":{}}}}}\n", source.len())));
    }

    #[test]
    fn rejects_source_identity_framing_checksum_and_limit_failures() {
        let valid = decode_hex(EMPTY_DOCUMENT_HEX);

        let mut wrong_length = fixture_file(&valid);
        assert!(matches!(
            write_verified_chunk_index(
                wrong_length.as_file_mut(),
                valid.len() as u64 + 1,
                &digest(&valid),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::SourceLengthMismatch)
        ));

        let mut wrong_digest = fixture_file(&valid);
        assert!(matches!(
            write_verified_chunk_index(
                wrong_digest.as_file_mut(),
                valid.len() as u64,
                &"0".repeat(64),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::SourceDigestMismatch)
        ));

        let mut bad_magic_bytes = valid.clone();
        bad_magic_bytes[0] ^= 0xff;
        let mut bad_magic = fixture_file(&bad_magic_bytes);
        assert!(matches!(
            write_verified_chunk_index(
                bad_magic.as_file_mut(),
                bad_magic_bytes.len() as u64,
                &digest(&bad_magic_bytes),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::InvalidMagic { offset: 0 })
        ));

        let mut bad_checksum_bytes = valid.clone();
        bad_checksum_bytes[4] ^= 0xff;
        let mut bad_checksum = fixture_file(&bad_checksum_bytes);
        assert!(matches!(
            write_verified_chunk_index(
                bad_checksum.as_file_mut(),
                bad_checksum_bytes.len() as u64,
                &digest(&bad_checksum_bytes),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::ChecksumMismatch { ordinal: 0 })
        ));

        let mut overlong = valid.clone();
        overlong.splice(9..10, [0x84, 0x00]);
        let mut overlong_file = fixture_file(&overlong);
        assert!(matches!(
            write_verified_chunk_index(
                overlong_file.as_file_mut(),
                overlong.len() as u64,
                &digest(&overlong),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::InvalidLengthEncoding)
        ));

        let truncated = &valid[..valid.len() - 1];
        let mut truncated_file = fixture_file(truncated);
        assert!(matches!(
            write_verified_chunk_index(
                truncated_file.as_file_mut(),
                truncated.len() as u64,
                &digest(truncated),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::TruncatedChunk)
        ));

        let compressed = decode_hex(COMPRESSED_CHANGE_HEX);
        let mut compressed_file = fixture_file(&compressed);
        assert!(matches!(
            write_verified_chunk_index(
                compressed_file.as_file_mut(),
                compressed.len() as u64,
                &digest(&compressed),
                ExternalDecoderLimits {
                    max_chunk_count: 1,
                    max_decompressed_chunk_bytes: 4_151,
                },
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::DecompressedChunkLimit { ordinal: 0 })
        ));

        let two = [valid.clone(), valid].concat();
        let mut limited_file = fixture_file(&two);
        assert!(matches!(
            write_verified_chunk_index(
                limited_file.as_file_mut(),
                two.len() as u64,
                &digest(&two),
                ExternalDecoderLimits {
                    max_chunk_count: 1,
                    max_decompressed_chunk_bytes: 1,
                },
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::ChunkCountLimit)
        ));
    }

    #[test]
    fn rejects_compressed_trailing_data_and_unknown_chunk_types() {
        let compressed = decode_hex(COMPRESSED_CHANGE_HEX);
        let mut with_trailing = compressed.clone();
        let encoded_length_offset = 9;
        let original_length = with_trailing[encoded_length_offset];
        assert!(original_length < 0x80);
        with_trailing[encoded_length_offset] = original_length + 1;
        with_trailing.push(0);
        let mut trailing_file = fixture_file(&with_trailing);
        assert!(matches!(
            write_verified_chunk_index(
                trailing_file.as_file_mut(),
                with_trailing.len() as u64,
                &digest(&with_trailing),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::InvalidCompressedChunk { ordinal: 0 })
        ));

        let mut unknown = synthetic_chunk(1, b"x");
        unknown[8] = 3;
        let mut unknown_file = fixture_file(&unknown);
        assert!(matches!(
            write_verified_chunk_index(
                unknown_file.as_file_mut(),
                unknown.len() as u64,
                &digest(&unknown),
                limits(),
                &mut Vec::new(),
            ),
            Err(AutomergeExternalDecoderError::UnknownChunkType(3))
        ));
    }

    #[test]
    fn rejects_a_valid_same_length_source_replacement_during_indexing() {
        struct MutatingWriter {
            source: File,
            replacement: Vec<u8>,
            mutated: bool,
            output: Vec<u8>,
        }

        impl Write for MutatingWriter {
            fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
                if !self.mutated {
                    self.source.seek(SeekFrom::Start(0))?;
                    self.source.write_all(&self.replacement)?;
                    self.source.sync_data()?;
                    self.mutated = true;
                }
                self.output.extend_from_slice(buffer);
                Ok(buffer.len())
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let original = decode_hex(EMPTY_DOCUMENT_HEX);
        let replacement = synthetic_chunk(0, &[0, 0, 0, 1]);
        assert_eq!(original.len(), replacement.len());
        let mut file = fixture_file(&original);
        let mut index = MutatingWriter {
            source: file.as_file().try_clone().unwrap(),
            replacement,
            mutated: false,
            output: Vec::new(),
        };

        assert!(matches!(
            write_verified_chunk_index(
                file.as_file_mut(),
                original.len() as u64,
                &digest(&original),
                limits(),
                &mut index,
            ),
            Err(AutomergeExternalDecoderError::SourceDigestMismatch)
        ));
        assert!(!String::from_utf8(index.output)
            .unwrap()
            .contains("\"type\":\"complete\""));
    }
}
