//! Crash-resumable native spool for bounded Automerge snapshot migration.
//!
//! This module is deliberately dormant. It accepts the worker's fixed-size
//! snapshot chunks without decoding Automerge, durably acknowledges each
//! chunk, and verifies the completed source digest. No Tauri command or
//! production caller activates it yet.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub(super) const EXTERNAL_SNAPSHOT_CHUNK_BYTES: usize = 1024 * 1024;
const JOURNAL_SCHEMA_VERSION: u32 = 1;
const MAX_JOURNAL_LINE_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExternalSnapshotSource {
    pub schema_version: u32,
    pub storage_generation: String,
    pub storage_save_revision: u64,
    pub byte_length: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SpoolJournalRecord {
    Begin {
        journal_schema_version: u32,
        source: ExternalSnapshotSource,
    },
    Chunk {
        offset: u64,
        byte_length: u32,
        sha256: String,
    },
    Finalized {
        source_sha256: String,
    },
}

#[derive(Debug)]
pub(super) enum ExternalSnapshotSpoolError {
    Io(std::io::Error),
    InvalidRoot,
    InvalidSource,
    InvalidSessionId,
    InvalidSpoolFile,
    ConcurrentAccess,
    InvalidJournal,
    SourceMismatch,
    UnexpectedOffset,
    InvalidChunkLength,
    ChunkMismatch,
    IncompleteSource,
    AlreadyFinalized,
}

impl From<std::io::Error> for ExternalSnapshotSpoolError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for ExternalSnapshotSpoolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "snapshot spool I/O failed: {error}"),
            Self::InvalidRoot => {
                formatter.write_str("snapshot spool root is not a private canonical directory")
            }
            Self::InvalidSource => formatter.write_str("snapshot spool source identity is invalid"),
            Self::InvalidSessionId => formatter.write_str("snapshot spool session ID is invalid"),
            Self::InvalidSpoolFile => {
                formatter.write_str("snapshot spool path is not a private regular file")
            }
            Self::ConcurrentAccess => formatter.write_str("snapshot spool session is already open"),
            Self::InvalidJournal => {
                formatter.write_str("snapshot spool journal is malformed or inconsistent")
            }
            Self::SourceMismatch => {
                formatter.write_str("snapshot spool source identity does not match durable state")
            }
            Self::UnexpectedOffset => {
                formatter.write_str("snapshot spool chunk offset is not the next durable offset")
            }
            Self::InvalidChunkLength => {
                formatter.write_str("snapshot spool chunk length violates the fixed chunk contract")
            }
            Self::ChunkMismatch => {
                formatter.write_str("snapshot spool retry does not match the durable chunk")
            }
            Self::IncompleteSource => {
                formatter.write_str("snapshot spool cannot finalize an incomplete source")
            }
            Self::AlreadyFinalized => formatter.write_str("snapshot spool was already finalized"),
        }
    }
}

impl std::error::Error for ExternalSnapshotSpoolError {}

type SpoolResult<T> = Result<T, ExternalSnapshotSpoolError>;

#[derive(Clone, Debug, Eq, PartialEq)]
struct ChunkReceipt {
    offset: u64,
    byte_length: u32,
    sha256: String,
}

pub(super) struct ExternalSnapshotSpool {
    source: ExternalSnapshotSource,
    data: File,
    journal: File,
    receipts: Vec<ChunkReceipt>,
    committed_offset: u64,
    finalized_digest: Option<String>,
    #[cfg(test)]
    data_path: PathBuf,
    #[cfg(test)]
    journal_path: PathBuf,
}

impl ExternalSnapshotSpool {
    pub(super) fn open(
        root: &Path,
        session_id: &str,
        source: ExternalSnapshotSource,
    ) -> SpoolResult<Self> {
        validate_source(&source)?;
        let root = prepare_private_root(root)?;
        let session_digest = digest_bytes(session_id.as_bytes());
        if session_id.trim().is_empty() {
            return Err(ExternalSnapshotSpoolError::InvalidSessionId);
        }
        let data_path = root.join(format!("{session_digest}.snapshot"));
        let journal_path = root.join(format!("{session_digest}.journal.jsonl"));
        let mut data = open_private_spool_file(&data_path)?;
        let mut journal = open_private_spool_file(&journal_path)?;
        lock_journal_file(&journal)?;

        let mut receipts = Vec::new();
        let mut committed_offset = 0_u64;
        let mut finalized_digest = None;
        if journal.metadata()?.len() == 0 {
            if data.metadata()?.len() != 0 {
                return Err(ExternalSnapshotSpoolError::InvalidJournal);
            }
            append_journal_record(
                &mut journal,
                &SpoolJournalRecord::Begin {
                    journal_schema_version: JOURNAL_SCHEMA_VERSION,
                    source: source.clone(),
                },
            )?;
        } else {
            let recovered = recover_journal(&mut data, &mut journal, &source)?;
            receipts = recovered.receipts;
            committed_offset = recovered.committed_offset;
            finalized_digest = recovered.finalized_digest;
        }

        data.seek(SeekFrom::Start(committed_offset))?;
        journal.seek(SeekFrom::End(0))?;
        Ok(Self {
            source,
            data,
            journal,
            receipts,
            committed_offset,
            finalized_digest,
            #[cfg(test)]
            data_path,
            #[cfg(test)]
            journal_path,
        })
    }

    pub(super) fn committed_offset(&self) -> u64 {
        self.committed_offset
    }

    pub(super) fn append_chunk(&mut self, offset: u64, bytes: &[u8]) -> SpoolResult<()> {
        if self.finalized_digest.is_some() {
            return Err(ExternalSnapshotSpoolError::AlreadyFinalized);
        }
        let expected_length = expected_chunk_length(&self.source, offset)?;
        if bytes.len() != expected_length {
            return Err(ExternalSnapshotSpoolError::InvalidChunkLength);
        }

        if offset < self.committed_offset {
            return self.verify_retry(offset, bytes);
        }
        if offset != self.committed_offset {
            return Err(ExternalSnapshotSpoolError::UnexpectedOffset);
        }

        self.data.seek(SeekFrom::Start(offset))?;
        self.data.write_all(bytes)?;
        self.data.sync_data()?;

        let receipt = ChunkReceipt {
            offset,
            byte_length: u32::try_from(bytes.len())
                .map_err(|_| ExternalSnapshotSpoolError::InvalidChunkLength)?,
            sha256: digest_bytes(bytes),
        };
        append_journal_record(
            &mut self.journal,
            &SpoolJournalRecord::Chunk {
                offset: receipt.offset,
                byte_length: receipt.byte_length,
                sha256: receipt.sha256.clone(),
            },
        )?;
        self.committed_offset += receipt.byte_length as u64;
        self.receipts.push(receipt);
        Ok(())
    }

    pub(super) fn finalize(&mut self) -> SpoolResult<String> {
        if let Some(digest) = &self.finalized_digest {
            return Ok(digest.clone());
        }
        if self.committed_offset != self.source.byte_length {
            return Err(ExternalSnapshotSpoolError::IncompleteSource);
        }

        let digest = digest_file(&mut self.data, self.source.byte_length)?;
        append_journal_record(
            &mut self.journal,
            &SpoolJournalRecord::Finalized {
                source_sha256: digest.clone(),
            },
        )?;
        self.finalized_digest = Some(digest.clone());
        Ok(digest)
    }

    fn verify_retry(&mut self, offset: u64, bytes: &[u8]) -> SpoolResult<()> {
        if !offset.is_multiple_of(EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64) {
            return Err(ExternalSnapshotSpoolError::UnexpectedOffset);
        }
        let index = usize::try_from(offset / EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64)
            .map_err(|_| ExternalSnapshotSpoolError::UnexpectedOffset)?;
        let receipt = self
            .receipts
            .get(index)
            .ok_or(ExternalSnapshotSpoolError::UnexpectedOffset)?;
        if receipt.offset != offset
            || receipt.byte_length as usize != bytes.len()
            || receipt.sha256 != digest_bytes(bytes)
        {
            return Err(ExternalSnapshotSpoolError::ChunkMismatch);
        }

        let mut durable = vec![0_u8; bytes.len()];
        self.data.seek(SeekFrom::Start(offset))?;
        self.data.read_exact(&mut durable)?;
        self.data.seek(SeekFrom::Start(self.committed_offset))?;
        if durable != bytes {
            return Err(ExternalSnapshotSpoolError::ChunkMismatch);
        }
        Ok(())
    }
}

struct RecoveredJournal {
    receipts: Vec<ChunkReceipt>,
    committed_offset: u64,
    finalized_digest: Option<String>,
}

fn recover_journal(
    data: &mut File,
    journal: &mut File,
    expected_source: &ExternalSnapshotSource,
) -> SpoolResult<RecoveredJournal> {
    journal.seek(SeekFrom::Start(0))?;
    let mut reader = BufReader::new(journal.try_clone()?);
    let maximum_records = expected_source
        .byte_length
        .div_ceil(EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64)
        .saturating_add(2);
    let mut records_seen = 0_u64;
    let mut valid_journal_bytes = 0_u64;
    let mut line = Vec::with_capacity(512);
    let mut receipts = Vec::new();
    let mut committed_offset = 0_u64;
    let mut finalized_digest = None;

    loop {
        line.clear();
        let read = reader
            .by_ref()
            .take((MAX_JOURNAL_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if read == 0 {
            break;
        }
        if line.len() > MAX_JOURNAL_LINE_BYTES {
            return Err(ExternalSnapshotSpoolError::InvalidJournal);
        }
        if line.last() != Some(&b'\n') {
            break;
        }
        valid_journal_bytes += read as u64;
        records_seen += 1;
        if records_seen > maximum_records {
            return Err(ExternalSnapshotSpoolError::InvalidJournal);
        }
        let record: SpoolJournalRecord = serde_json::from_slice(&line)
            .map_err(|_| ExternalSnapshotSpoolError::InvalidJournal)?;

        match record {
            SpoolJournalRecord::Begin {
                journal_schema_version,
                source,
            } if records_seen == 1 => {
                if journal_schema_version != JOURNAL_SCHEMA_VERSION {
                    return Err(ExternalSnapshotSpoolError::InvalidJournal);
                }
                if source != *expected_source {
                    return Err(ExternalSnapshotSpoolError::SourceMismatch);
                }
            }
            SpoolJournalRecord::Chunk {
                offset,
                byte_length,
                sha256,
            } if records_seen > 1 && finalized_digest.is_none() => {
                let expected = expected_chunk_length(expected_source, offset)?;
                if offset != committed_offset
                    || byte_length as usize != expected
                    || !is_lower_sha256(&sha256)
                {
                    return Err(ExternalSnapshotSpoolError::InvalidJournal);
                }
                receipts.push(ChunkReceipt {
                    offset,
                    byte_length,
                    sha256,
                });
                committed_offset += byte_length as u64;
            }
            SpoolJournalRecord::Finalized { source_sha256 }
                if records_seen > 1
                    && finalized_digest.is_none()
                    && committed_offset == expected_source.byte_length
                    && is_lower_sha256(&source_sha256) =>
            {
                finalized_digest = Some(source_sha256);
            }
            _ => return Err(ExternalSnapshotSpoolError::InvalidJournal),
        }
    }

    if records_seen == 0 {
        return Err(ExternalSnapshotSpoolError::InvalidJournal);
    }
    journal.set_len(valid_journal_bytes)?;
    journal.sync_data()?;

    let data_length = data.metadata()?.len();
    if data_length < committed_offset {
        return Err(ExternalSnapshotSpoolError::InvalidJournal);
    }
    if data_length > committed_offset {
        data.set_len(committed_offset)?;
        data.sync_data()?;
    }
    verify_durable_receipts(data, &receipts)?;
    if let Some(expected_digest) = &finalized_digest {
        if digest_file(data, expected_source.byte_length)? != *expected_digest {
            return Err(ExternalSnapshotSpoolError::InvalidJournal);
        }
    }

    Ok(RecoveredJournal {
        receipts,
        committed_offset,
        finalized_digest,
    })
}

fn verify_durable_receipts(data: &mut File, receipts: &[ChunkReceipt]) -> SpoolResult<()> {
    let mut buffer = vec![0_u8; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
    for receipt in receipts {
        let length = receipt.byte_length as usize;
        data.seek(SeekFrom::Start(receipt.offset))?;
        data.read_exact(&mut buffer[..length])?;
        if digest_bytes(&buffer[..length]) != receipt.sha256 {
            return Err(ExternalSnapshotSpoolError::ChunkMismatch);
        }
    }
    Ok(())
}

fn expected_chunk_length(source: &ExternalSnapshotSource, offset: u64) -> SpoolResult<usize> {
    if offset >= source.byte_length || !offset.is_multiple_of(EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64)
    {
        return Err(ExternalSnapshotSpoolError::UnexpectedOffset);
    }
    let remaining = source.byte_length - offset;
    usize::try_from(remaining.min(EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64))
        .map_err(|_| ExternalSnapshotSpoolError::InvalidChunkLength)
}

fn validate_source(source: &ExternalSnapshotSource) -> SpoolResult<()> {
    if source.schema_version != 1
        || source.storage_generation.trim().is_empty()
        || source.byte_length == 0
    {
        return Err(ExternalSnapshotSpoolError::InvalidSource);
    }
    Ok(())
}

fn prepare_private_root(root: &Path) -> SpoolResult<PathBuf> {
    if !root.is_absolute() {
        return Err(ExternalSnapshotSpoolError::InvalidRoot);
    }
    let existed = root.exists();
    if !existed {
        std::fs::create_dir_all(root)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    let canonical = root.canonicalize()?;
    let metadata = std::fs::symlink_metadata(root)?;
    if canonical != root || !metadata.file_type().is_dir() {
        return Err(ExternalSnapshotSpoolError::InvalidRoot);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
            return Err(ExternalSnapshotSpoolError::InvalidRoot);
        }
    }
    Ok(canonical)
}

fn open_private_spool_file(path: &Path) -> SpoolResult<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(0);
    }
    let file = options.open(path)?;
    let opened = file.metadata()?;
    let linked = std::fs::symlink_metadata(path)?;
    if !opened.is_file() || !linked.file_type().is_file() {
        return Err(ExternalSnapshotSpoolError::InvalidSpoolFile);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != linked.dev()
            || opened.ino() != linked.ino()
            || opened.nlink() != 1
            || opened.uid() != unsafe { libc::geteuid() }
            || opened.mode() & 0o077 != 0
        {
            return Err(ExternalSnapshotSpoolError::InvalidSpoolFile);
        }
    }
    Ok(file)
}

#[cfg(unix)]
fn lock_journal_file(file: &File) -> SpoolResult<()> {
    use std::os::fd::AsRawFd;

    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            Err(ExternalSnapshotSpoolError::ConcurrentAccess)
        } else {
            Err(ExternalSnapshotSpoolError::Io(error))
        }
    }
}

#[cfg(not(unix))]
fn lock_journal_file(_file: &File) -> SpoolResult<()> {
    // Windows opens both session files with share_mode(0), which holds the
    // equivalent process-lifetime exclusion. Other targets are not currently
    // supported Freed Desktop hosts.
    Ok(())
}

fn append_journal_record(journal: &mut File, record: &SpoolJournalRecord) -> SpoolResult<()> {
    let encoded =
        serde_json::to_vec(record).map_err(|_| ExternalSnapshotSpoolError::InvalidJournal)?;
    if encoded.len() + 1 > MAX_JOURNAL_LINE_BYTES {
        return Err(ExternalSnapshotSpoolError::InvalidJournal);
    }
    journal.seek(SeekFrom::End(0))?;
    journal.write_all(&encoded)?;
    journal.write_all(b"\n")?;
    journal.sync_data()?;
    Ok(())
}

fn digest_file(file: &mut File, expected_length: u64) -> SpoolResult<String> {
    file.seek(SeekFrom::Start(0))?;
    let mut hasher = Sha256::new();
    let mut remaining = expected_length;
    let mut buffer = vec![0_u8; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
    while remaining > 0 {
        let requested = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| ExternalSnapshotSpoolError::InvalidSource)?;
        file.read_exact(&mut buffer[..requested])?;
        hasher.update(&buffer[..requested]);
        remaining -= requested as u64;
    }
    Ok(lower_hex(&hasher.finalize()))
}

fn digest_bytes(bytes: &[u8]) -> String {
    lower_hex(&Sha256::digest(bytes))
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn lower_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;

    fn source(byte_length: u64) -> ExternalSnapshotSource {
        ExternalSnapshotSource {
            schema_version: 1,
            storage_generation: "generation-a".to_string(),
            storage_save_revision: 17,
            byte_length,
        }
    }

    fn temp_root() -> tempfile::TempDir {
        tempfile::tempdir().expect("temporary spool root")
    }

    #[test]
    fn appends_retries_finalizes_and_reopens_without_source_sized_reads() {
        let temporary = temp_root();
        let root = temporary.path().canonicalize().unwrap().join("spool");
        let first = vec![0x31; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
        let second = vec![0x52; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
        let final_chunk = vec![0x73; 19];
        let total = (first.len() + second.len() + final_chunk.len()) as u64;
        let expected_digest =
            digest_bytes(&[first.as_slice(), second.as_slice(), final_chunk.as_slice()].concat());

        let mut spool = ExternalSnapshotSpool::open(&root, "session-a", source(total)).unwrap();
        spool.append_chunk(0, &first).unwrap();
        spool.append_chunk(0, &first).unwrap();
        spool
            .append_chunk(EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64, &second)
            .unwrap();
        spool
            .append_chunk((EXTERNAL_SNAPSHOT_CHUNK_BYTES * 2) as u64, &final_chunk)
            .unwrap();
        assert_eq!(spool.finalize().unwrap(), expected_digest);
        drop(spool);

        let mut reopened = ExternalSnapshotSpool::open(&root, "session-a", source(total)).unwrap();
        assert_eq!(reopened.committed_offset(), total);
        assert_eq!(reopened.finalize().unwrap(), expected_digest);
    }

    #[test]
    fn truncates_unacknowledged_data_and_partial_journal_tails_after_crash() {
        let temporary = temp_root();
        let root = temporary.path().canonicalize().unwrap().join("spool");
        let first = vec![0x41; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
        let final_chunk = vec![0x42; 7];
        let total = (first.len() + final_chunk.len()) as u64;
        let mut spool = ExternalSnapshotSpool::open(&root, "session-crash", source(total)).unwrap();
        spool.append_chunk(0, &first).unwrap();
        let data_path = spool.data_path.clone();
        let journal_path = spool.journal_path.clone();
        drop(spool);

        let mut data = OpenOptions::new().append(true).open(&data_path).unwrap();
        data.write_all(&final_chunk).unwrap();
        data.sync_data().unwrap();
        let mut journal = OpenOptions::new().append(true).open(&journal_path).unwrap();
        journal.write_all(br#"{"type":"chunk","offset":"#).unwrap();
        journal.sync_data().unwrap();
        drop((data, journal));

        let mut recovered =
            ExternalSnapshotSpool::open(&root, "session-crash", source(total)).unwrap();
        assert_eq!(
            recovered.committed_offset(),
            EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64
        );
        assert_eq!(
            std::fs::metadata(&data_path).unwrap().len(),
            EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64
        );
        recovered
            .append_chunk(EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64, &final_chunk)
            .unwrap();
        recovered.finalize().unwrap();
    }

    #[test]
    fn rejects_source_changes_out_of_order_chunks_and_changed_retries() {
        let temporary = temp_root();
        let root = temporary.path().canonicalize().unwrap().join("spool");
        let first = vec![0x61; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
        let final_chunk = vec![0x62; 3];
        let total = (first.len() + final_chunk.len()) as u64;
        let mut spool =
            ExternalSnapshotSpool::open(&root, "session-conflict", source(total)).unwrap();
        assert!(matches!(
            spool.append_chunk(EXTERNAL_SNAPSHOT_CHUNK_BYTES as u64, &final_chunk),
            Err(ExternalSnapshotSpoolError::UnexpectedOffset)
        ));
        spool.append_chunk(0, &first).unwrap();
        let changed = vec![0x63; EXTERNAL_SNAPSHOT_CHUNK_BYTES];
        assert!(matches!(
            spool.append_chunk(0, &changed),
            Err(ExternalSnapshotSpoolError::ChunkMismatch)
        ));
        drop(spool);

        let mut changed_source = source(total);
        changed_source.storage_save_revision += 1;
        assert!(matches!(
            ExternalSnapshotSpool::open(&root, "session-conflict", changed_source),
            Err(ExternalSnapshotSpoolError::SourceMismatch)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn excludes_a_second_writer_but_releases_the_session_after_drop() {
        let temporary = temp_root();
        let root = temporary.path().canonicalize().unwrap().join("spool");
        let source = source(7);
        let spool =
            ExternalSnapshotSpool::open(&root, "session-exclusive", source.clone()).unwrap();
        assert!(matches!(
            ExternalSnapshotSpool::open(&root, "session-exclusive", source.clone()),
            Err(ExternalSnapshotSpoolError::ConcurrentAccess)
        ));
        drop(spool);
        ExternalSnapshotSpool::open(&root, "session-exclusive", source).unwrap();
    }
}
