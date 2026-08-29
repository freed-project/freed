use crate::library_core_actor_enrollment::{
    prepare_normalized_primary_actor_enrollment_v2, ActorKeyStore,
};
use crate::library_core_canonical::{decode_canonical_value, encode_canonical_value};
use crate::library_core_hash::lower_hex;
use crate::normalized_authority_credentials::AuthorityKeyStore;
use crate::normalized_checkpoint::NormalizedCheckpointRecordV2;
use crate::normalized_import::{
    restore_normalized_checkpoint_stage_v1, NormalizedCheckpointDigestAccumulatorV2,
    NormalizedRestoreTransitionV1,
};
use crate::normalized_operation::VerifiedActorEnrollment;
use crate::normalized_sqlite::{
    append_normalized_checkpoint_stage_page_v2, begin_normalized_checkpoint_stage_v2,
    describe_normalized_checkpoint_export_v2, export_pinned_normalized_checkpoint_page_v2,
    BeginNormalizedCheckpointStageV2, NormalizedCheckpointExportDescriptorV2,
    NormalizedCheckpointExportRequestV2, NormalizedSqliteError,
    PinnedNormalizedCheckpointExportRequestV2,
};
use crate::normalized_writer_certificate::{
    prepare_writer_epoch_reassignment, WriterEpochReassignment,
};
use crate::sqlite_contract_generated::{
    CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES, CHECKPOINT_PAGE_MAXIMUM_RECORDS,
    CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES, NORMALIZED_CHECKPOINT_FORMAT,
    SQLITE_PROTOCOL_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::ffi::{CStr, CString};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;

const SNAPSHOT_FORMAT: &str = "freed_normalized_local_snapshot_v1";
const SNAPSHOT_FILE_SUFFIX: &str = ".freed-snapshot";
const SNAPSHOT_PENDING_FILE: &str = ".normalized-snapshot.pending";
const SNAPSHOT_RECORDS_PENDING_FILE: &str = ".normalized-snapshot-records.pending";
const SNAPSHOT_LOCK_FILE: &str = ".normalized-snapshot.lock";
const SNAPSHOT_MANIFEST_MAXIMUM_BYTES: usize = 65_536;
const SNAPSHOT_RETENTION_COUNT: usize = 24;
const SNAPSHOT_MAXIMUM_RECORDS: usize = 10_000_000;
const SNAPSHOT_ID_DIGEST_DOMAIN: &[u8] =
    b"freed.library-core.v1/digest-value/normalized-local-snapshot\0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NormalizedLocalSnapshotReasonV1 {
    Auto,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedLocalSnapshotSummaryV1 {
    pub snapshot_id: String,
    pub created_at_ms: u64,
    pub reason: NormalizedLocalSnapshotReasonV1,
    pub library_id: String,
    pub authority_epoch: String,
    pub source_revision: u64,
    pub item_count: usize,
    pub record_count: usize,
    pub canonical_record_bytes: u64,
    pub archive_byte_length: u64,
    pub checkpoint_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedLocalSnapshotIdentityV1 {
    format: String,
    protocol_version: u32,
    created_at_ms: u64,
    reason: NormalizedLocalSnapshotReasonV1,
    checkpoint: NormalizedCheckpointExportDescriptorV2,
    checkpoint_digest: String,
    canonical_record_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedLocalSnapshotManifestV1 {
    snapshot_id: String,
    #[serde(flatten)]
    identity: NormalizedLocalSnapshotIdentityV1,
}

#[derive(Debug)]
struct SnapshotArchive {
    manifest: NormalizedLocalSnapshotManifestV1,
    file_name: String,
    byte_length: u64,
}

struct SnapshotOperationGuard {
    #[cfg(unix)]
    lock: File,
    #[cfg(windows)]
    _lock: fslock::LockFile,
}

#[cfg(unix)]
impl Drop for SnapshotOperationGuard {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.lock.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

struct SnapshotDirectory {
    #[cfg(unix)]
    directory: File,
    #[cfg(windows)]
    path: PathBuf,
}

fn snapshot_error(message: impl Into<String>) -> NormalizedSqliteError {
    NormalizedSqliteError::Transport(message.into())
}

impl SnapshotDirectory {
    #[cfg(unix)]
    fn from_descriptor(descriptor: RawFd) -> Result<Self, NormalizedSqliteError> {
        if descriptor < 0 {
            return Err(snapshot_error(
                "normalized snapshot directory descriptor is invalid",
            ));
        }
        let duplicated = unsafe { libc::fcntl(descriptor, libc::F_DUPFD_CLOEXEC, 0) };
        if duplicated < 0 {
            return Err(snapshot_error(std::io::Error::last_os_error().to_string()));
        }
        let directory = unsafe { File::from_raw_fd(duplicated) };
        let metadata = directory
            .metadata()
            .map_err(|error| snapshot_error(error.to_string()))?;
        if !metadata.is_dir()
            || metadata.permissions().mode() & 0o7777 != 0o700
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(snapshot_error(
                "normalized snapshot directory descriptor is not private",
            ));
        }
        Ok(Self { directory })
    }

    fn open_or_create(path: &Path) -> Result<Self, NormalizedSqliteError> {
        ensure_snapshot_directory(path)?;
        #[cfg(unix)]
        {
            let directory = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
                .open(path)
                .map_err(|error| snapshot_error(error.to_string()))?;
            Self::from_descriptor(directory.as_raw_fd())
        }
        #[cfg(windows)]
        {
            let path = fs::canonicalize(path).map_err(|error| snapshot_error(error.to_string()))?;
            Ok(Self { path })
        }
    }

    #[cfg(unix)]
    fn leaf(name: &str) -> Result<CString, NormalizedSqliteError> {
        if name.is_empty()
            || name.len() > 255
            || matches!(name, "." | "..")
            || name.as_bytes().contains(&b'/')
        {
            return Err(snapshot_error("normalized snapshot file name is invalid"));
        }
        CString::new(name).map_err(|_| snapshot_error("normalized snapshot file name is invalid"))
    }

    #[cfg(windows)]
    fn leaf(name: &str) -> Result<&str, NormalizedSqliteError> {
        if name.is_empty()
            || name.len() > 255
            || matches!(name, "." | "..")
            || name
                .as_bytes()
                .iter()
                .any(|byte| matches!(byte, b'/' | b'\\'))
        {
            return Err(snapshot_error("normalized snapshot file name is invalid"));
        }
        Ok(name)
    }

    fn open_private_file_optional(
        &self,
        name: &str,
    ) -> Result<Option<File>, NormalizedSqliteError> {
        let name = Self::leaf(name)?;
        #[cfg(unix)]
        {
            let descriptor = unsafe {
                libc::openat(
                    self.directory.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                )
            };
            if descriptor < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::NotFound {
                    return Ok(None);
                }
                return Err(snapshot_error(error.to_string()));
            }
            let file = unsafe { File::from_raw_fd(descriptor) };
            let metadata = file
                .metadata()
                .map_err(|error| snapshot_error(error.to_string()))?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.mode() & 0o777 != 0o600
                || metadata.nlink() != 1
                || metadata.uid() != unsafe { libc::geteuid() }
            {
                return Err(snapshot_error("normalized snapshot file is not private"));
            }
            Ok(Some(file))
        }
        #[cfg(windows)]
        {
            let path = self.path.join(name);
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(snapshot_error(error.to_string())),
            };
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(snapshot_error("normalized snapshot file is not private"));
            }
            OpenOptions::new()
                .read(true)
                .open(path)
                .map(Some)
                .map_err(|error| snapshot_error(error.to_string()))
        }
    }

    fn open_private_file(&self, name: &str) -> Result<File, NormalizedSqliteError> {
        self.open_private_file_optional(name)?
            .ok_or_else(|| snapshot_error("normalized snapshot file does not exist"))
    }

    fn create_private_file(&self, name: &str) -> Result<File, NormalizedSqliteError> {
        let name = Self::leaf(name)?;
        #[cfg(unix)]
        {
            let descriptor = unsafe {
                libc::openat(
                    self.directory.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_CLOEXEC
                        | libc::O_NOFOLLOW,
                    0o600,
                )
            };
            if descriptor < 0 {
                return Err(snapshot_error(std::io::Error::last_os_error().to_string()));
            }
            Ok(unsafe { File::from_raw_fd(descriptor) })
        }
        #[cfg(windows)]
        {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.path.join(name))
                .map_err(|error| snapshot_error(error.to_string()))
        }
    }

    #[cfg(unix)]
    fn open_lock_file(&self) -> Result<File, NormalizedSqliteError> {
        let name = Self::leaf(SNAPSHOT_LOCK_FILE)?;
        let descriptor = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if descriptor < 0 {
            return Err(snapshot_error(std::io::Error::last_os_error().to_string()));
        }
        let file = unsafe { File::from_raw_fd(descriptor) };
        let metadata = file
            .metadata()
            .map_err(|error| snapshot_error(error.to_string()))?;
        if !metadata.is_file()
            || metadata.mode() & 0o777 != 0o600
            || metadata.nlink() != 1
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(snapshot_error("normalized snapshot lock is not private"));
        }
        Ok(file)
    }

    fn remove_file(&self, name: &str) -> Result<bool, NormalizedSqliteError> {
        let name = Self::leaf(name)?;
        #[cfg(unix)]
        {
            if unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) } == 0 {
                return Ok(true);
            }
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(false);
            }
            Err(snapshot_error(error.to_string()))
        }
        #[cfg(windows)]
        {
            match fs::remove_file(self.path.join(name)) {
                Ok(()) => Ok(true),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(snapshot_error(error.to_string())),
            }
        }
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), NormalizedSqliteError> {
        let from = Self::leaf(from)?;
        let to = Self::leaf(to)?;
        #[cfg(unix)]
        {
            if unsafe {
                libc::renameat(
                    self.directory.as_raw_fd(),
                    from.as_ptr(),
                    self.directory.as_raw_fd(),
                    to.as_ptr(),
                )
            } < 0
            {
                return Err(snapshot_error(std::io::Error::last_os_error().to_string()));
            }
            Ok(())
        }
        #[cfg(windows)]
        {
            fs::rename(self.path.join(from), self.path.join(to))
                .map_err(|error| snapshot_error(error.to_string()))
        }
    }

    fn names(&self) -> Result<Vec<String>, NormalizedSqliteError> {
        #[cfg(unix)]
        {
            let duplicated =
                unsafe { libc::fcntl(self.directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
            if duplicated < 0 {
                return Err(snapshot_error(std::io::Error::last_os_error().to_string()));
            }
            if unsafe { libc::lseek(duplicated, 0, libc::SEEK_SET) } < 0 {
                unsafe {
                    libc::close(duplicated);
                }
                return Err(snapshot_error(std::io::Error::last_os_error().to_string()));
            }
            let directory = unsafe { libc::fdopendir(duplicated) };
            if directory.is_null() {
                unsafe {
                    libc::close(duplicated);
                }
                return Err(snapshot_error(std::io::Error::last_os_error().to_string()));
            }
            let mut names = Vec::new();
            loop {
                let entry = unsafe { libc::readdir(directory) };
                if entry.is_null() {
                    break;
                }
                let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
                let Ok(name) = name.to_str() else {
                    continue;
                };
                if !matches!(name, "." | "..") {
                    names.push(name.to_owned());
                }
            }
            unsafe {
                libc::closedir(directory);
            }
            Ok(names)
        }
        #[cfg(windows)]
        {
            Ok(fs::read_dir(&self.path)
                .map_err(|error| snapshot_error(error.to_string()))?
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect::<Vec<_>>())
        }
    }

    fn sync(&self) -> Result<(), NormalizedSqliteError> {
        #[cfg(unix)]
        {
            self.directory
                .sync_all()
                .map_err(|error| snapshot_error(error.to_string()))
        }
        #[cfg(windows)]
        {
            Ok(())
        }
    }
}

#[cfg(unix)]
fn path_for_bound_directory(descriptor: RawFd) -> Result<SnapshotDirectory, NormalizedSqliteError> {
    SnapshotDirectory::from_descriptor(descriptor)
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn ensure_snapshot_directory(path: &Path) -> Result<(), NormalizedSqliteError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(snapshot_error(
                    "normalized snapshot root is not a directory",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path).map_err(|error| snapshot_error(error.to_string()))?;
        }
        Err(error) => return Err(snapshot_error(error.to_string())),
    }
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| snapshot_error(error.to_string()))?;
    let metadata = fs::symlink_metadata(path).map_err(|error| snapshot_error(error.to_string()))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(snapshot_error("normalized snapshot root is not private"));
    }
    #[cfg(unix)]
    if metadata.permissions().mode() & 0o7777 != 0o700 {
        return Err(snapshot_error("normalized snapshot root is not private"));
    }
    Ok(())
}

fn acquire_snapshot_operation(
    snapshot_root: &SnapshotDirectory,
) -> Result<SnapshotOperationGuard, NormalizedSqliteError> {
    #[cfg(unix)]
    {
        let lock = snapshot_root.open_lock_file()?;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::WouldBlock {
                return Err(snapshot_error(
                    "another normalized snapshot operation is already active",
                ));
            }
            return Err(snapshot_error(error.to_string()));
        }
        Ok(SnapshotOperationGuard { lock })
    }
    #[cfg(windows)]
    {
        let mut lock = fslock::LockFile::open(snapshot_root.path.join(SNAPSHOT_LOCK_FILE))
            .map_err(|error| snapshot_error(error.to_string()))?;
        if !lock
            .try_lock()
            .map_err(|error| snapshot_error(error.to_string()))?
        {
            return Err(snapshot_error(
                "another normalized snapshot operation is already active",
            ));
        }
        Ok(SnapshotOperationGuard { _lock: lock })
    }
}

fn canonical_record(
    record: &NormalizedCheckpointRecordV2,
) -> Result<Vec<u8>, NormalizedSqliteError> {
    encode_canonical_value(
        &serde_json::to_value(record)
            .map_err(|_| snapshot_error("normalized snapshot record is invalid"))?,
        CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
    )
    .map_err(|_| snapshot_error("normalized snapshot record exceeds its bound"))
}

fn canonical_manifest(
    manifest: &NormalizedLocalSnapshotManifestV1,
) -> Result<Vec<u8>, NormalizedSqliteError> {
    encode_canonical_value(
        &serde_json::to_value(manifest)
            .map_err(|_| snapshot_error("normalized snapshot manifest is invalid"))?,
        SNAPSHOT_MANIFEST_MAXIMUM_BYTES,
    )
    .map_err(|_| snapshot_error("normalized snapshot manifest exceeds its bound"))
}

fn snapshot_id(
    identity: &NormalizedLocalSnapshotIdentityV1,
) -> Result<String, NormalizedSqliteError> {
    let canonical = encode_canonical_value(
        &serde_json::to_value(identity)
            .map_err(|_| snapshot_error("normalized snapshot identity is invalid"))?,
        SNAPSHOT_MANIFEST_MAXIMUM_BYTES,
    )
    .map_err(|_| snapshot_error("normalized snapshot identity exceeds its bound"))?;
    let mut digest = Sha256::new();
    digest.update(SNAPSHOT_ID_DIGEST_DOMAIN);
    digest.update(canonical);
    Ok(lower_hex(&digest.finalize()))
}

fn validate_manifest(
    manifest: &NormalizedLocalSnapshotManifestV1,
) -> Result<(), NormalizedSqliteError> {
    let checkpoint = &manifest.identity.checkpoint;
    if manifest.identity.format != SNAPSHOT_FORMAT
        || manifest.identity.protocol_version != SQLITE_PROTOCOL_VERSION
        || checkpoint.format
            != crate::sqlite_contract_generated::NORMALIZED_CHECKPOINT_EXPORT_FORMAT
        || checkpoint.protocol_version != SQLITE_PROTOCOL_VERSION
        || checkpoint.record_count == 0
        || checkpoint.record_count > SNAPSHOT_MAXIMUM_RECORDS
        || !valid_digest(&checkpoint.library_id)
        || !valid_digest(&checkpoint.authority_epoch)
        || !valid_digest(&checkpoint.writer_id)
        || !valid_digest(&checkpoint.causal_frontier_digest)
        || !valid_digest(&manifest.identity.checkpoint_digest)
        || manifest.identity.canonical_record_bytes == 0
        || snapshot_id(&manifest.identity)? != manifest.snapshot_id
    {
        return Err(snapshot_error(
            "normalized snapshot manifest identity is invalid",
        ));
    }
    Ok(())
}

fn read_manifest_from<R: BufRead>(
    reader: &mut R,
) -> Result<NormalizedLocalSnapshotManifestV1, NormalizedSqliteError> {
    let mut bytes = Vec::new();
    reader
        .take((SNAPSHOT_MANIFEST_MAXIMUM_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|error| snapshot_error(error.to_string()))?;
    if bytes.last() != Some(&b'\n') || bytes.len() <= 1 {
        return Err(snapshot_error(
            "normalized snapshot manifest line is incomplete",
        ));
    }
    bytes.pop();
    let decoded = decode_canonical_value(&bytes, SNAPSHOT_MANIFEST_MAXIMUM_BYTES)
        .map_err(|_| snapshot_error("normalized snapshot manifest is not canonical"))?;
    if decoded.canonical_bytes() != bytes.as_slice() {
        return Err(snapshot_error("normalized snapshot manifest bytes changed"));
    }
    let manifest: NormalizedLocalSnapshotManifestV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| snapshot_error("normalized snapshot manifest field set is invalid"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn archive_summary(archive: &SnapshotArchive) -> NormalizedLocalSnapshotSummaryV1 {
    let descriptor = &archive.manifest.identity.checkpoint;
    NormalizedLocalSnapshotSummaryV1 {
        snapshot_id: archive.manifest.snapshot_id.clone(),
        created_at_ms: archive.manifest.identity.created_at_ms,
        reason: archive.manifest.identity.reason,
        library_id: descriptor.library_id.clone(),
        authority_epoch: descriptor.authority_epoch.clone(),
        source_revision: descriptor.source_revision,
        item_count: descriptor.item_count,
        record_count: descriptor.record_count,
        canonical_record_bytes: archive.manifest.identity.canonical_record_bytes,
        archive_byte_length: archive.byte_length,
        checkpoint_digest: archive.manifest.identity.checkpoint_digest.clone(),
    }
}

fn archive_from_name(
    snapshot_root: &SnapshotDirectory,
    file_name: String,
) -> Result<SnapshotArchive, NormalizedSqliteError> {
    let file = snapshot_root.open_private_file(&file_name)?;
    let byte_length = file
        .metadata()
        .map_err(|error| snapshot_error(error.to_string()))?
        .len();
    let mut reader = BufReader::new(file);
    let manifest = read_manifest_from(&mut reader)?;
    let expected_name = format!("{}{}", manifest.snapshot_id, SNAPSHOT_FILE_SUFFIX);
    if file_name != expected_name {
        return Err(snapshot_error("normalized snapshot file name is invalid"));
    }
    Ok(SnapshotArchive {
        manifest,
        file_name,
        byte_length,
    })
}

fn list_archives(
    snapshot_root: &SnapshotDirectory,
) -> Result<Vec<SnapshotArchive>, NormalizedSqliteError> {
    let mut archives = Vec::new();
    for name in snapshot_root.names()? {
        if !name.ends_with(SNAPSHOT_FILE_SUFFIX) {
            continue;
        }
        archives.push(archive_from_name(snapshot_root, name)?);
    }
    archives.sort_by(|left, right| {
        right
            .manifest
            .identity
            .created_at_ms
            .cmp(&left.manifest.identity.created_at_ms)
            .then_with(|| right.manifest.snapshot_id.cmp(&left.manifest.snapshot_id))
    });
    Ok(archives)
}

pub fn create_normalized_local_snapshot_v1(
    connection: &mut Connection,
    snapshot_root: &Path,
    created_at_ms: u64,
    reason: NormalizedLocalSnapshotReasonV1,
) -> Result<NormalizedLocalSnapshotSummaryV1, NormalizedSqliteError> {
    let snapshot_root = SnapshotDirectory::open_or_create(snapshot_root)?;
    create_normalized_local_snapshot_in_v1(connection, &snapshot_root, created_at_ms, reason)
}

fn create_normalized_local_snapshot_in_v1(
    connection: &mut Connection,
    snapshot_root: &SnapshotDirectory,
    created_at_ms: u64,
    reason: NormalizedLocalSnapshotReasonV1,
) -> Result<NormalizedLocalSnapshotSummaryV1, NormalizedSqliteError> {
    let _operation = acquire_snapshot_operation(snapshot_root)?;
    snapshot_root.remove_file(SNAPSHOT_RECORDS_PENDING_FILE)?;
    snapshot_root.remove_file(SNAPSHOT_PENDING_FILE)?;

    let descriptor = describe_normalized_checkpoint_export_v2(connection)?;
    let records_file = snapshot_root.create_private_file(SNAPSHOT_RECORDS_PENDING_FILE)?;
    let mut records_writer = BufWriter::new(records_file);
    let mut cursor = None;
    let mut accumulator = NormalizedCheckpointDigestAccumulatorV2::new();
    loop {
        let page = export_pinned_normalized_checkpoint_page_v2(
            connection,
            &PinnedNormalizedCheckpointExportRequestV2 {
                snapshot: descriptor.clone(),
                page: NormalizedCheckpointExportRequestV2 {
                    after: cursor,
                    ..NormalizedCheckpointExportRequestV2::default()
                },
            },
        )?;
        for record in &page.records {
            accumulator.push(record)?;
            records_writer
                .write_all(&canonical_record(record)?)
                .and_then(|_| records_writer.write_all(b"\n"))
                .map_err(|error| snapshot_error(error.to_string()))?;
        }
        cursor = page.next_cursor;
        if page.done {
            break;
        }
        if cursor.is_none() {
            return Err(snapshot_error("normalized snapshot export lost its cursor"));
        }
    }
    records_writer
        .flush()
        .and_then(|_| records_writer.get_ref().sync_all())
        .map_err(|error| snapshot_error(error.to_string()))?;
    drop(records_writer);
    let (checkpoint_digest, record_count, canonical_record_bytes) = accumulator.finish();
    if usize::try_from(record_count).ok() != Some(descriptor.record_count) {
        return Err(snapshot_error(
            "normalized snapshot export record count changed",
        ));
    }
    let identity = NormalizedLocalSnapshotIdentityV1 {
        format: SNAPSHOT_FORMAT.into(),
        protocol_version: SQLITE_PROTOCOL_VERSION,
        created_at_ms,
        reason,
        checkpoint: descriptor,
        checkpoint_digest,
        canonical_record_bytes,
    };
    let manifest = NormalizedLocalSnapshotManifestV1 {
        snapshot_id: snapshot_id(&identity)?,
        identity,
    };
    let final_name = format!("{}{}", manifest.snapshot_id, SNAPSHOT_FILE_SUFFIX);
    if snapshot_root
        .open_private_file_optional(&final_name)?
        .is_some()
    {
        let existing = archive_from_name(snapshot_root, final_name.clone())?;
        if existing.manifest == manifest {
            snapshot_root.remove_file(SNAPSHOT_RECORDS_PENDING_FILE)?;
            return Ok(archive_summary(&existing));
        }
        return Err(snapshot_error(
            "normalized snapshot identity replay changed",
        ));
    }

    let archive_file = snapshot_root.create_private_file(SNAPSHOT_PENDING_FILE)?;
    let mut archive_writer = BufWriter::new(archive_file);
    archive_writer
        .write_all(&canonical_manifest(&manifest)?)
        .and_then(|_| archive_writer.write_all(b"\n"))
        .map_err(|error| snapshot_error(error.to_string()))?;
    let mut records_reader = snapshot_root.open_private_file(SNAPSHOT_RECORDS_PENDING_FILE)?;
    std::io::copy(&mut records_reader, &mut archive_writer)
        .map_err(|error| snapshot_error(error.to_string()))?;
    archive_writer
        .flush()
        .and_then(|_| archive_writer.get_ref().sync_all())
        .map_err(|error| snapshot_error(error.to_string()))?;
    drop(archive_writer);
    snapshot_root.rename(SNAPSHOT_PENDING_FILE, &final_name)?;
    snapshot_root.sync()?;
    snapshot_root.remove_file(SNAPSHOT_RECORDS_PENDING_FILE)?;

    let mut archives = list_archives(snapshot_root)?;
    if archives.len() > SNAPSHOT_RETENTION_COUNT {
        for expired in archives.drain(SNAPSHOT_RETENTION_COUNT..) {
            snapshot_root.remove_file(&expired.file_name)?;
        }
    }
    snapshot_root.sync()?;
    archive_from_name(snapshot_root, final_name).map(|archive| archive_summary(&archive))
}

pub fn list_normalized_local_snapshots_v1(
    snapshot_root: &Path,
) -> Result<Vec<NormalizedLocalSnapshotSummaryV1>, NormalizedSqliteError> {
    let snapshot_root = SnapshotDirectory::open_or_create(snapshot_root)?;
    let _operation = acquire_snapshot_operation(&snapshot_root)?;
    list_archives(&snapshot_root).map(|archives| {
        archives
            .iter()
            .map(archive_summary)
            .collect::<Vec<NormalizedLocalSnapshotSummaryV1>>()
    })
}

fn read_record_line<R: BufRead>(
    reader: &mut R,
) -> Result<Option<NormalizedCheckpointRecordV2>, NormalizedSqliteError> {
    let mut bytes = Vec::new();
    let read = reader
        .take((CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|error| snapshot_error(error.to_string()))?;
    if read == 0 {
        return Ok(None);
    }
    if bytes.last() != Some(&b'\n') || bytes.len() <= 1 {
        return Err(snapshot_error(
            "normalized snapshot record line is incomplete",
        ));
    }
    bytes.pop();
    let decoded = decode_canonical_value(&bytes, CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES)
        .map_err(|_| snapshot_error("normalized snapshot record is not canonical"))?;
    if decoded.canonical_bytes() != bytes.as_slice() {
        return Err(snapshot_error("normalized snapshot record bytes changed"));
    }
    let record: NormalizedCheckpointRecordV2 = serde_json::from_value(decoded.into_value())
        .map_err(|_| snapshot_error("normalized snapshot record field set is invalid"))?;
    if record.format != NORMALIZED_CHECKPOINT_FORMAT
        || record.protocol_version != SQLITE_PROTOCOL_VERSION
    {
        return Err(snapshot_error(
            "normalized snapshot record identity is invalid",
        ));
    }
    Ok(Some(record))
}

fn verify_archive_records(
    snapshot_root: &SnapshotDirectory,
    archive: &SnapshotArchive,
) -> Result<(), NormalizedSqliteError> {
    let file = snapshot_root.open_private_file(&archive.file_name)?;
    let mut reader = BufReader::new(file);
    if read_manifest_from(&mut reader)? != archive.manifest {
        return Err(snapshot_error("normalized snapshot manifest changed"));
    }
    let mut accumulator = NormalizedCheckpointDigestAccumulatorV2::new();
    while let Some(record) = read_record_line(&mut reader)? {
        accumulator.push(&record)?;
    }
    let (digest, records, canonical_bytes) = accumulator.finish();
    if digest != archive.manifest.identity.checkpoint_digest
        || usize::try_from(records).ok() != Some(archive.manifest.identity.checkpoint.record_count)
        || canonical_bytes != archive.manifest.identity.canonical_record_bytes
    {
        return Err(snapshot_error(
            "normalized snapshot record commitment is invalid",
        ));
    }
    Ok(())
}

fn canonical_source_control(
    current: &NormalizedCheckpointExportDescriptorV2,
    manifest: &NormalizedLocalSnapshotManifestV1,
    operation_id: &str,
    restored_at_ms: u64,
) -> Result<String, NormalizedSqliteError> {
    let value = json!({
        "causalFrontierDigest": current.causal_frontier_digest,
        "generation": 0,
        "libraryId": current.library_id,
        "restore": {
            "snapshotId": manifest.snapshot_id,
            "checkpointDigest": manifest.identity.checkpoint_digest,
            "createdAtMs": manifest.identity.created_at_ms,
            "operationId": operation_id,
            "restoredAtMs": restored_at_ms,
            "sourceAuthorityEpoch": manifest.identity.checkpoint.authority_epoch,
            "sourceRevision": manifest.identity.checkpoint.source_revision,
        },
        "storageEpoch": current.authority_epoch,
        "writerId": current.writer_id,
    });
    let canonical = encode_canonical_value(&value, 16 * 1_024)
        .map_err(|_| snapshot_error("normalized restore source control is invalid"))?;
    String::from_utf8(canonical)
        .map_err(|_| snapshot_error("normalized restore source control is not UTF-8"))
}

fn prepare_restore_transition(
    connection: &Connection,
    archive: &SnapshotArchive,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    operation_id: &str,
    restored_at_ms: u64,
) -> Result<NormalizedRestoreTransitionV1, NormalizedSqliteError> {
    let current_descriptor = describe_normalized_checkpoint_export_v2(connection)?;
    if current_descriptor.library_id != archive.manifest.identity.checkpoint.library_id {
        return Err(snapshot_error(
            "normalized snapshot belongs to another Library",
        ));
    }
    let (current_authority, current_certificate, generation, manifest_generation) =
        crate::normalized_writer_reassignment::current_authority(connection)?;
    let source_control = canonical_source_control(
        &current_descriptor,
        &archive.manifest,
        operation_id,
        restored_at_ms,
    )?;
    let reassignment: WriterEpochReassignment = prepare_writer_epoch_reassignment(
        &current_authority,
        &current_certificate,
        &source_control,
        &current_descriptor.writer_id,
        authority_store,
    )
    .map_err(|error| snapshot_error(error.to_string()))?;
    if reassignment.authority.epoch_id == current_authority.epoch_id {
        return Err(snapshot_error(
            "normalized restore cannot replay an active epoch",
        ));
    }
    let enrollment: VerifiedActorEnrollment = prepare_normalized_primary_actor_enrollment_v2(
        &reassignment.authority,
        installation_witness,
        actor_store,
        authority_store,
        i64::try_from(restored_at_ms)
            .map_err(|_| snapshot_error("normalized restore time is invalid"))?,
    )
    .map_err(|error| snapshot_error(error.to_string()))?;
    if enrollment.actor_id != current_descriptor.writer_id {
        return Err(snapshot_error(
            "normalized restore writer is not this installation",
        ));
    }
    let target_source_revision = current_descriptor
        .source_revision
        .checked_add(1)
        .ok_or_else(|| snapshot_error("normalized restore revision is exhausted"))?;
    Ok(NormalizedRestoreTransitionV1 {
        operation_id: operation_id.to_owned(),
        snapshot_id: archive.manifest.snapshot_id.clone(),
        checkpoint_digest: archive.manifest.identity.checkpoint_digest.clone(),
        source_checkpoint: archive.manifest.identity.checkpoint.clone(),
        expected_current_checkpoint: current_descriptor,
        source_control,
        reassignment,
        enrollment,
        prior_generation: generation,
        prior_manifest_generation: manifest_generation,
        restored_at_ms,
        target_source_revision,
    })
}

fn is_exact_restore_replay(
    connection: &Connection,
    writer_id: &str,
    archive: &SnapshotArchive,
    operation_id: &str,
    restored_at_ms: u64,
) -> Result<bool, NormalizedSqliteError> {
    let receipt = connection
        .query_row(
            "SELECT status, result_text
             FROM library_receipts
             WHERE actor_id = ?1 AND operation_id = ?2;",
            params![writer_id, operation_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    let Some((status, result_text)) = receipt else {
        return Ok(false);
    };
    if status != "restored" {
        return Err(snapshot_error(
            "normalized snapshot restore operation identity was already used",
        ));
    }
    let result_text = result_text.ok_or_else(|| {
        snapshot_error("normalized snapshot restore receipt has no committed result")
    })?;
    let result: Value = serde_json::from_str(&result_text)
        .map_err(|_| snapshot_error("normalized snapshot restore receipt is invalid"))?;
    let exact = result.get("format").and_then(Value::as_str)
        == Some("freed_normalized_restore_receipt_v1")
        && result.get("operationId").and_then(Value::as_str) == Some(operation_id)
        && result.get("snapshotId").and_then(Value::as_str)
            == Some(archive.manifest.snapshot_id.as_str())
        && result.get("checkpointDigest").and_then(Value::as_str)
            == Some(archive.manifest.identity.checkpoint_digest.as_str())
        && result.get("restoredAtMs").and_then(Value::as_u64) == Some(restored_at_ms);
    if !exact {
        return Err(snapshot_error(
            "normalized snapshot restore replay changed its committed request",
        ));
    }
    Ok(true)
}

fn append_archive_to_stage(
    connection: &mut Connection,
    snapshot_root: &SnapshotDirectory,
    archive: &SnapshotArchive,
    stage_id: &str,
) -> Result<(), NormalizedSqliteError> {
    let file = snapshot_root.open_private_file(&archive.file_name)?;
    let mut reader = BufReader::new(file);
    if read_manifest_from(&mut reader)? != archive.manifest {
        return Err(snapshot_error("normalized snapshot manifest changed"));
    }
    let mut page = Vec::with_capacity(CHECKPOINT_PAGE_MAXIMUM_RECORDS);
    let mut page_bytes = 0usize;
    while let Some(record) = read_record_line(&mut reader)? {
        let record_bytes = canonical_record(&record)?.len();
        if !page.is_empty()
            && (page.len() == CHECKPOINT_PAGE_MAXIMUM_RECORDS
                || page_bytes + record_bytes > CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES)
        {
            append_normalized_checkpoint_stage_page_v2(connection, stage_id, &page)?;
            page.clear();
            page_bytes = 0;
        }
        page_bytes = page_bytes
            .checked_add(record_bytes)
            .ok_or_else(|| snapshot_error("normalized restore page bytes overflowed"))?;
        page.push(record);
    }
    if !page.is_empty() {
        append_normalized_checkpoint_stage_page_v2(connection, stage_id, &page)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn restore_normalized_local_snapshot_v1(
    connection: &mut Connection,
    snapshot_root: &Path,
    snapshot_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    operation_id: &str,
    restored_at_ms: u64,
) -> Result<NormalizedLocalSnapshotSummaryV1, NormalizedSqliteError> {
    let snapshot_root = SnapshotDirectory::open_or_create(snapshot_root)?;
    restore_normalized_local_snapshot_in_v1(
        connection,
        &snapshot_root,
        snapshot_id,
        installation_witness,
        actor_store,
        authority_store,
        operation_id,
        restored_at_ms,
    )
}

#[allow(clippy::too_many_arguments)]
fn restore_normalized_local_snapshot_in_v1(
    connection: &mut Connection,
    snapshot_root: &SnapshotDirectory,
    snapshot_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    operation_id: &str,
    restored_at_ms: u64,
) -> Result<NormalizedLocalSnapshotSummaryV1, NormalizedSqliteError> {
    if !valid_digest(snapshot_id)
        || !valid_digest(installation_witness)
        || operation_id.is_empty()
        || operation_id.len() > 255
    {
        return Err(snapshot_error(
            "normalized snapshot restore identity is invalid",
        ));
    }
    let _operation = acquire_snapshot_operation(snapshot_root)?;
    let archive = archive_from_name(
        snapshot_root,
        format!("{snapshot_id}{SNAPSHOT_FILE_SUFFIX}"),
    )?;
    verify_archive_records(snapshot_root, &archive)?;
    let current = describe_normalized_checkpoint_export_v2(connection)?;
    if is_exact_restore_replay(
        connection,
        &current.writer_id,
        &archive,
        operation_id,
        restored_at_ms,
    )? {
        return Ok(archive_summary(&archive));
    }
    let transition = prepare_restore_transition(
        connection,
        &archive,
        installation_witness,
        actor_store,
        authority_store,
        operation_id,
        restored_at_ms,
    )?;
    let stage_id = format!(
        "local-restore:{}:{}",
        archive.manifest.snapshot_id, transition.reassignment.authority.epoch_id
    );
    begin_normalized_checkpoint_stage_v2(
        connection,
        &BeginNormalizedCheckpointStageV2 {
            stage_id: stage_id.clone(),
            library_id: archive.manifest.identity.checkpoint.library_id.clone(),
            authority_epoch: archive.manifest.identity.checkpoint.authority_epoch.clone(),
            source_revision: archive.manifest.identity.checkpoint.source_revision,
            expected_record_count: archive.manifest.identity.checkpoint.record_count,
            created_at: restored_at_ms,
        },
    )?;
    append_archive_to_stage(connection, snapshot_root, &archive, &stage_id)?;
    restore_normalized_checkpoint_stage_v1(connection, &stage_id, &transition)?;
    Ok(archive_summary(&archive))
}

pub fn clear_normalized_local_snapshots_v1(
    snapshot_root: &Path,
) -> Result<(), NormalizedSqliteError> {
    let snapshot_root = SnapshotDirectory::open_or_create(snapshot_root)?;
    clear_normalized_local_snapshots_in_v1(&snapshot_root)
}

fn clear_normalized_local_snapshots_in_v1(
    snapshot_root: &SnapshotDirectory,
) -> Result<(), NormalizedSqliteError> {
    let _operation = acquire_snapshot_operation(snapshot_root)?;
    for archive in list_archives(snapshot_root)? {
        snapshot_root.remove_file(&archive.file_name)?;
    }
    snapshot_root.remove_file(SNAPSHOT_PENDING_FILE)?;
    snapshot_root.remove_file(SNAPSHOT_RECORDS_PENDING_FILE)?;
    snapshot_root.sync()
}

#[cfg(unix)]
pub(crate) fn create_normalized_local_snapshot_bound_v1(
    connection: &mut Connection,
    snapshot_directory: RawFd,
    created_at_ms: u64,
    reason: NormalizedLocalSnapshotReasonV1,
) -> Result<NormalizedLocalSnapshotSummaryV1, NormalizedSqliteError> {
    let directory = path_for_bound_directory(snapshot_directory)?;
    create_normalized_local_snapshot_in_v1(connection, &directory, created_at_ms, reason)
}

#[cfg(unix)]
pub(crate) fn list_normalized_local_snapshots_bound_v1(
    snapshot_directory: RawFd,
) -> Result<Vec<NormalizedLocalSnapshotSummaryV1>, NormalizedSqliteError> {
    let directory = path_for_bound_directory(snapshot_directory)?;
    let _operation = acquire_snapshot_operation(&directory)?;
    list_archives(&directory).map(|archives| archives.iter().map(archive_summary).collect())
}

#[allow(clippy::too_many_arguments)]
#[cfg(unix)]
pub(crate) fn restore_normalized_local_snapshot_bound_v1(
    connection: &mut Connection,
    snapshot_directory: RawFd,
    snapshot_id: &str,
    installation_witness: &str,
    actor_store: &dyn ActorKeyStore,
    authority_store: &dyn AuthorityKeyStore,
    operation_id: &str,
    restored_at_ms: u64,
) -> Result<NormalizedLocalSnapshotSummaryV1, NormalizedSqliteError> {
    let directory = path_for_bound_directory(snapshot_directory)?;
    restore_normalized_local_snapshot_in_v1(
        connection,
        &directory,
        snapshot_id,
        installation_witness,
        actor_store,
        authority_store,
        operation_id,
        restored_at_ms,
    )
}

pub(crate) fn clear_normalized_local_snapshots_bound_v1(
    snapshot_directory: RawFd,
) -> Result<(), NormalizedSqliteError> {
    let directory = path_for_bound_directory(snapshot_directory)?;
    clear_normalized_local_snapshots_in_v1(&directory)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::{install_normalized_schema_v1, prepare_fresh_normalized_desktop_library_v1};
    use ring::rand::SystemRandom;
    use ring::signature::Ed25519KeyPair;
    use tempfile::tempdir;

    struct TestKeyStore(Vec<u8>);

    impl ActorKeyStore for TestKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }

        fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
            Err("test key store is read only".into())
        }
    }

    impl AuthorityKeyStore for TestKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }

        fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
            Err("test key store is read only".into())
        }
    }

    fn key_store() -> TestKeyStore {
        TestKeyStore(
            Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                .expect("generate key")
                .as_ref()
                .to_vec(),
        )
    }

    #[test]
    fn local_snapshot_is_canonical_records_and_not_a_sqlite_copy() {
        let actor = key_store();
        let authority = key_store();
        let witness = "7".repeat(64);
        let mut connection = Connection::open_in_memory().expect("open database");
        install_normalized_schema_v1(&connection).expect("install schema");
        prepare_fresh_normalized_desktop_library_v1(
            &mut connection,
            &witness,
            &actor,
            &authority,
            1_000,
        )
        .expect("prepare Library");
        let directory = tempdir().expect("snapshot root");
        let summary = create_normalized_local_snapshot_v1(
            &mut connection,
            directory.path(),
            2_000,
            NormalizedLocalSnapshotReasonV1::Manual,
        )
        .expect("create snapshot");
        let path = directory
            .path()
            .join(format!("{}{}", summary.snapshot_id, SNAPSHOT_FILE_SUFFIX));
        let mut prefix = [0_u8; 16];
        File::open(&path)
            .expect("open snapshot")
            .read_exact(&mut prefix)
            .expect("read prefix");
        assert_ne!(&prefix, b"SQLite format 3\0");
        assert_eq!(
            list_normalized_local_snapshots_v1(directory.path()).unwrap(),
            vec![summary]
        );
    }

    #[test]
    fn bound_snapshot_directory_never_reopens_its_authority_path() {
        let actor = key_store();
        let authority = key_store();
        let witness = "6".repeat(64);
        let mut connection = Connection::open_in_memory().expect("open database");
        install_normalized_schema_v1(&connection).expect("install schema");
        prepare_fresh_normalized_desktop_library_v1(
            &mut connection,
            &witness,
            &actor,
            &authority,
            1_000,
        )
        .expect("prepare Library");
        let directory = tempdir().expect("snapshot root");
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))
            .expect("make snapshot root private");
        let descriptor = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(directory.path())
            .expect("open snapshot directory");
        let summary = create_normalized_local_snapshot_bound_v1(
            &mut connection,
            descriptor.as_raw_fd(),
            2_000,
            NormalizedLocalSnapshotReasonV1::Auto,
        )
        .expect("create bound snapshot");
        assert_eq!(
            list_normalized_local_snapshots_bound_v1(descriptor.as_raw_fd())
                .expect("list bound snapshots"),
            vec![summary]
        );
    }

    #[test]
    fn changed_snapshot_record_fails_before_restore() {
        let actor = key_store();
        let authority = key_store();
        let witness = "8".repeat(64);
        let mut connection = Connection::open_in_memory().expect("open database");
        install_normalized_schema_v1(&connection).expect("install schema");
        prepare_fresh_normalized_desktop_library_v1(
            &mut connection,
            &witness,
            &actor,
            &authority,
            1_000,
        )
        .expect("prepare Library");
        let directory = tempdir().expect("snapshot root");
        let summary = create_normalized_local_snapshot_v1(
            &mut connection,
            directory.path(),
            2_000,
            NormalizedLocalSnapshotReasonV1::Manual,
        )
        .expect("create snapshot");
        let path = directory
            .path()
            .join(format!("{}{}", summary.snapshot_id, SNAPSHOT_FILE_SUFFIX));
        let mut bytes = fs::read(&path).expect("read snapshot");
        let last = bytes.len() - 2;
        bytes[last] ^= 1;
        fs::write(&path, bytes).expect("change snapshot");
        let before = describe_normalized_checkpoint_export_v2(&connection).expect("before");
        let error = restore_normalized_local_snapshot_v1(
            &mut connection,
            directory.path(),
            &summary.snapshot_id,
            &witness,
            &actor,
            &authority,
            "local-snapshot-restore:changed-archive",
            3_000,
        )
        .expect_err("reject changed archive");
        assert!(
            error.to_string().contains("canonical") || error.to_string().contains("commitment")
        );
        assert_eq!(
            describe_normalized_checkpoint_export_v2(&connection).unwrap(),
            before
        );
    }

    #[test]
    fn restore_moves_older_records_into_one_signed_successor_epoch() {
        let actor = key_store();
        let authority = key_store();
        let witness = "9".repeat(64);
        let mut connection = Connection::open_in_memory().expect("open database");
        install_normalized_schema_v1(&connection).expect("install schema");
        prepare_fresh_normalized_desktop_library_v1(
            &mut connection,
            &witness,
            &actor,
            &authority,
            1_000,
        )
        .expect("prepare Library");
        connection
            .execute(
                "INSERT INTO library_preferences
                 (path, value_type, text_value, updated_at)
                 VALUES ('v:$.display.theme', 'text', 'before', 1_100);",
                [],
            )
            .expect("insert snapshot value");
        let directory = tempdir().expect("snapshot root");
        let summary = create_normalized_local_snapshot_v1(
            &mut connection,
            directory.path(),
            2_000,
            NormalizedLocalSnapshotReasonV1::Manual,
        )
        .expect("create snapshot");
        connection
            .execute_batch(
                "UPDATE library_preferences
                   SET text_value = 'after', updated_at = 2_100
                 WHERE path = 'v:$.display.theme';
                 UPDATE library_meta
                   SET source_revision = 1, updated_at = 2_100
                 WHERE singleton_id = 1;
                 UPDATE library_change_state SET revision = 1 WHERE singleton_id = 1;
                 INSERT INTO library_invalidations
                   (revision, ordinal, topic, entity_id, reset_required)
                 VALUES (1, 0, 'preferences', NULL, 0);",
            )
            .expect("advance current Library");
        let current = describe_normalized_checkpoint_export_v2(&connection).expect("current");
        assert_eq!(current.source_revision, 1);

        let operation_id = "local-snapshot-restore:response-loss";
        restore_normalized_local_snapshot_v1(
            &mut connection,
            directory.path(),
            &summary.snapshot_id,
            &witness,
            &actor,
            &authority,
            operation_id,
            3_000,
        )
        .expect("restore snapshot");
        let restored = describe_normalized_checkpoint_export_v2(&connection).expect("restored");
        assert_eq!(restored.library_id, current.library_id);
        assert_ne!(restored.authority_epoch, current.authority_epoch);
        assert_eq!(restored.source_revision, 2);
        assert_eq!(
            connection
                .query_row(
                    "SELECT text_value FROM library_preferences
                     WHERE path = 'v:$.display.theme';",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("restored value"),
            "before"
        );
        let receipt: (String, String) = connection
            .query_row(
                "SELECT status, result_text FROM library_receipts
                 WHERE operation_id = ?1;",
                [operation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("restore receipt");
        assert_eq!(receipt.0, "restored");
        assert!(receipt.1.contains(&summary.snapshot_id));

        restore_normalized_local_snapshot_v1(
            &mut connection,
            directory.path(),
            &summary.snapshot_id,
            &witness,
            &actor,
            &authority,
            operation_id,
            3_000,
        )
        .expect("replay restore response");
        assert_eq!(
            describe_normalized_checkpoint_export_v2(&connection).expect("replayed descriptor"),
            restored
        );

        let changed_replay = restore_normalized_local_snapshot_v1(
            &mut connection,
            directory.path(),
            &summary.snapshot_id,
            &witness,
            &actor,
            &authority,
            operation_id,
            3_001,
        )
        .expect_err("reject changed restore replay");
        assert!(changed_replay
            .to_string()
            .contains("changed its committed request"));
    }
}
