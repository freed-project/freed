//! Fail-closed recovery for the legacy device-local media vault.
//!
//! The legacy renderer manifest is read directly from `media-vault/manifest.json`.
//! No renderer helper participates because the legacy helper intentionally turns
//! read and parse failures into an empty manifest. Recovery must preserve those
//! failures as evidence instead.

use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
#[cfg(windows)]
use std::fs::OpenOptions;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::marker::PhantomData;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::path::{Component, Path, PathBuf};
#[cfg(unix)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(unix)]
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const LEGACY_VAULT_DIRECTORY: &str = "media-vault";
const LEGACY_MANIFEST_FILE: &str = "manifest.json";
const RECOVERY_DIRECTORY: &str = "media-vault-reconciliation-v1";
const BLOB_DIRECTORY: &str = "media-blobs-v1";
const SOURCE_MANIFEST_DIRECTORY: &str = "source-manifests";
const LOGICAL_BACKUP_DIRECTORY: &str = "logical-backups";
const RECEIPT_DIRECTORY: &str = "receipts";
const STAGING_DIRECTORY: &str = "staging";
const MANIFEST_VERSION: u8 = 1;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_MANIFEST_BYTES: u64 = 268_435_456;
const MAX_MANIFEST_ENTRIES: usize = 1_000_000;
const MAX_BLOB_BYTES: u64 = 67_108_864_000_000;
const STREAM_BUFFER_BYTES: usize = 1_048_576;
const MAX_PATH_BYTES: usize = 8_192;
const MAX_ID_BYTES: usize = 4_096;
const MAX_TEXT_BYTES: usize = 65_536;
const MAX_OWNER_HANDLES: usize = 10_000;
const BLOB_DIGEST_PREFIX: &[u8] = b"freed.library-core.v1/digest-bytes/blob-content\0";
const SOURCE_MANIFEST_DIGEST_PREFIX: &[u8] =
    b"freed.library-core.v1/digest-bytes/media-vault-source-manifest\0";
const LOGICAL_BACKUP_FORMAT: &str = "freed_legacy_media_vault_logical_backup_v1";
const RECEIPT_FORMAT: &str = "freed_legacy_media_vault_reconciliation_receipt_v1";

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum MediaVaultProvider {
    Facebook,
    Instagram,
}

impl MediaVaultProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Facebook => "facebook",
            Self::Instagram => "instagram",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MediaVaultMediaType {
    Image,
    Video,
    Unknown,
}

impl MediaVaultMediaType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MediaVaultImportSource {
    MetaExport,
    ProfileBackfill,
    Continuous,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MediaVaultRosterSource {
    CapturedItem,
    FacebookGroup,
    MetaExport,
    ProfileBackfill,
}

#[derive(Debug)]
struct OptionalField<T>(Option<T>);

impl<T> Default for OptionalField<T> {
    fn default() -> Self {
        Self(None)
    }
}

impl<'de, T> Deserialize<'de> for OptionalField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        T::deserialize(deserializer).map(|value| Self(Some(value)))
    }
}

#[derive(Debug)]
struct ClosedMap<T>(BTreeMap<String, T>);

impl<'de, T> Deserialize<'de> for ClosedMap<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ClosedMapVisitor<T>(PhantomData<T>);

        impl<'de, T> Visitor<'de> for ClosedMapVisitor<T>
        where
            T: Deserialize<'de>,
        {
            type Value = ClosedMap<T>;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an object with unique string keys")
            }

            fn visit_map<A>(self, mut access: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut values = BTreeMap::new();
                while let Some((key, value)) = access.next_entry::<String, T>()? {
                    if values.insert(key.clone(), value).is_some() {
                        return Err(de::Error::custom(format!(
                            "duplicate media vault map key {key:?}"
                        )));
                    }
                    if values.len() > MAX_MANIFEST_ENTRIES {
                        return Err(de::Error::custom(
                            "media vault map exceeds the v1 entry limit",
                        ));
                    }
                }
                Ok(ClosedMap(values))
            }
        }

        deserializer.deserialize_map(ClosedMapVisitor(PhantomData))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyProviderStateV1 {
    enabled: bool,
    #[serde(default)]
    last_success_at: OptionalField<u64>,
    #[serde(default)]
    last_error: OptionalField<String>,
    owner_handles: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyProvidersV1 {
    facebook: LegacyProviderStateV1,
    instagram: LegacyProviderStateV1,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyMediaVaultEntryV1 {
    id: String,
    provider: MediaVaultProvider,
    #[serde(default)]
    source_url: OptionalField<String>,
    #[serde(default)]
    post_id: OptionalField<String>,
    #[serde(default)]
    media_url: OptionalField<String>,
    #[serde(default)]
    media_type: OptionalField<MediaVaultMediaType>,
    local_path: String,
    byte_size: u64,
    content_hash: String,
    captured_at: u64,
    import_source: MediaVaultImportSource,
    #[serde(default)]
    original_path: OptionalField<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyMediaVaultFailureV1 {
    id: String,
    provider: MediaVaultProvider,
    #[serde(default)]
    media_url: OptionalField<String>,
    #[serde(default)]
    source_url: OptionalField<String>,
    #[serde(default)]
    post_id: OptionalField<String>,
    message: String,
    failed_at: u64,
    retry_count: u64,
    #[serde(default)]
    next_retry_at: OptionalField<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyMediaVaultRosterEntryV1 {
    id: String,
    provider: MediaVaultProvider,
    #[serde(default)]
    external_id: OptionalField<String>,
    #[serde(default)]
    handle: OptionalField<String>,
    #[serde(default)]
    display_name: OptionalField<String>,
    #[serde(default)]
    profile_url: OptionalField<String>,
    #[serde(default)]
    group_id: OptionalField<String>,
    #[serde(default)]
    group_name: OptionalField<String>,
    #[serde(default)]
    group_url: OptionalField<String>,
    first_seen_at: u64,
    last_seen_at: u64,
    source: MediaVaultRosterSource,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyMediaVaultManifestV1 {
    version: u8,
    providers: LegacyProvidersV1,
    entries: ClosedMap<LegacyMediaVaultEntryV1>,
    failures: ClosedMap<LegacyMediaVaultFailureV1>,
    roster: ClosedMap<LegacyMediaVaultRosterEntryV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum QuarantineReason {
    Missing,
    Ambiguous,
    LegacyFnvTagged,
    DigestMismatch,
    LengthMismatch,
    Symlinked,
    OutOfRoot,
    Unreadable,
    NotRegularFile,
    ExceedsV1BlobLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogicalBackupEntryV1 {
    entry_id: String,
    provider: String,
    source_local_path: String,
    declared_byte_length: u64,
    declared_content_hash: String,
    media_type: Option<String>,
    disposition: String,
    actual_blob_content_digest: Option<String>,
    actual_raw_sha256: Option<String>,
    actual_byte_length: Option<u64>,
    quarantine_reasons: Vec<QuarantineReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogicalBackupV1 {
    format: String,
    source_manifest_digest: String,
    source_manifest_byte_length: u64,
    entries: Vec<LogicalBackupEntryV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReconciliationReceiptV1 {
    format: String,
    source_manifest_digest: String,
    source_manifest_byte_length: u64,
    logical_backup_sha256: String,
    attempted_entry_count: u64,
    admitted_entry_count: u64,
    quarantined_entry_count: u64,
    preserved_blob_count: u64,
    completed_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileIdentity {
    stable_id: String,
    byte_length: u64,
    modified_marker: String,
}

#[derive(Debug)]
enum NoFollowOpenError {
    Missing,
    Symlinked,
    OutOfRoot,
    NotRegular,
    Unreadable(String),
}

#[derive(Debug)]
struct OpenedVaultFile {
    file: File,
    identity: FileIdentity,
}

#[derive(Debug)]
enum CaptureBlobError {
    SourceChanged,
    SourceUnreadable,
    ExceedsV1BlobLimit,
    Store(String),
}

struct PinnedVaultRoot {
    path: PathBuf,
    directory: File,
    identity: FileIdentity,
}

#[derive(Debug)]
struct CapturedBlob {
    blob_content_digest: String,
    raw_sha256: String,
    byte_length: u64,
    source_identity: FileIdentity,
}

struct SourceObservation {
    relative_path: PathBuf,
    identity: FileIdentity,
}

struct ReconciledEntries {
    entries: Vec<LogicalBackupEntryV1>,
    source_observations: Vec<SourceObservation>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FaultPoint {
    BlobCopy,
    BackupCommit,
    ReceiptResponseLoss,
}

#[cfg(not(test))]
type FaultPoint = ();

struct CachedProductionReconciliation {
    app_root: PathBuf,
    result: Result<(), String>,
}

static PRODUCTION_RECONCILIATION: OnceLock<Mutex<Option<CachedProductionReconciliation>>> =
    OnceLock::new();

fn lower_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn sha256(bytes: &[u8]) -> String {
    lower_hex(&Sha256::digest(bytes))
}

fn domain_digest(prefix: &[u8], bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prefix);
    hasher.update(bytes);
    lower_hex(&hasher.finalize())
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn bounded_text(value: &str, maximum_bytes: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.is_empty()) && value.len() <= maximum_bytes && !value.contains('\0')
}

fn safe_integer(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}

fn validate_optional_text(
    value: &OptionalField<String>,
    maximum_bytes: usize,
) -> Result<(), String> {
    if value
        .0
        .as_deref()
        .is_some_and(|text| !bounded_text(text, maximum_bytes, true))
    {
        return Err("legacy media vault optional text is outside its v1 bound".into());
    }
    Ok(())
}

fn validate_provider_state(state: &LegacyProviderStateV1) -> Result<(), String> {
    let _ = state.enabled;
    if state
        .last_success_at
        .0
        .is_some_and(|value| !safe_integer(value))
        || state.owner_handles.len() > MAX_OWNER_HANDLES
        || state
            .owner_handles
            .iter()
            .any(|value| !bounded_text(value, MAX_ID_BYTES, true))
    {
        return Err("legacy media vault provider state is outside its v1 bound".into());
    }
    validate_optional_text(&state.last_error, MAX_TEXT_BYTES)
}

fn validate_manifest(manifest: &LegacyMediaVaultManifestV1) -> Result<(), String> {
    if manifest.version != MANIFEST_VERSION {
        return Err("legacy media vault manifest version is not the closed v1 format".into());
    }
    validate_provider_state(&manifest.providers.facebook)?;
    validate_provider_state(&manifest.providers.instagram)?;
    if manifest.entries.0.len() > MAX_MANIFEST_ENTRIES
        || manifest.failures.0.len() > MAX_MANIFEST_ENTRIES
        || manifest.roster.0.len() > MAX_MANIFEST_ENTRIES
    {
        return Err("legacy media vault manifest exceeds the v1 entry limit".into());
    }

    for (key, entry) in &manifest.entries.0 {
        if key != &entry.id
            || !bounded_text(key, MAX_ID_BYTES, false)
            || !bounded_text(&entry.local_path, MAX_PATH_BYTES, false)
            || !bounded_text(&entry.content_hash, 128, false)
            || !safe_integer(entry.byte_size)
            || !safe_integer(entry.captured_at)
        {
            return Err("legacy media vault entry violates the closed v1 schema".into());
        }
        validate_optional_text(&entry.source_url, MAX_TEXT_BYTES)?;
        validate_optional_text(&entry.post_id, MAX_ID_BYTES)?;
        validate_optional_text(&entry.media_url, MAX_TEXT_BYTES)?;
        validate_optional_text(&entry.original_path, MAX_PATH_BYTES)?;
        let _ = entry.import_source;
    }

    for (key, failure) in &manifest.failures.0 {
        if key != &failure.id
            || !bounded_text(key, MAX_ID_BYTES, false)
            || !bounded_text(&failure.message, MAX_TEXT_BYTES, true)
            || !safe_integer(failure.failed_at)
            || !safe_integer(failure.retry_count)
            || failure
                .next_retry_at
                .0
                .is_some_and(|value| !safe_integer(value))
        {
            return Err("legacy media vault failure violates the closed v1 schema".into());
        }
        validate_optional_text(&failure.media_url, MAX_TEXT_BYTES)?;
        validate_optional_text(&failure.source_url, MAX_TEXT_BYTES)?;
        validate_optional_text(&failure.post_id, MAX_ID_BYTES)?;
        let _ = failure.provider;
    }

    for (key, roster) in &manifest.roster.0 {
        if key != &roster.id
            || !bounded_text(key, MAX_ID_BYTES, false)
            || !safe_integer(roster.first_seen_at)
            || !safe_integer(roster.last_seen_at)
        {
            return Err("legacy media vault roster violates the closed v1 schema".into());
        }
        validate_optional_text(&roster.external_id, MAX_ID_BYTES)?;
        validate_optional_text(&roster.handle, MAX_ID_BYTES)?;
        validate_optional_text(&roster.display_name, MAX_TEXT_BYTES)?;
        validate_optional_text(&roster.profile_url, MAX_TEXT_BYTES)?;
        validate_optional_text(&roster.group_id, MAX_ID_BYTES)?;
        validate_optional_text(&roster.group_name, MAX_TEXT_BYTES)?;
        validate_optional_text(&roster.group_url, MAX_TEXT_BYTES)?;
        let _ = (roster.provider, roster.source);
    }
    Ok(())
}

fn parse_manifest(bytes: &[u8]) -> Result<LegacyMediaVaultManifestV1, String> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let manifest = LegacyMediaVaultManifestV1::deserialize(&mut deserializer)
        .map_err(|error| format!("legacy media vault manifest is corrupt: {error}"))?;
    deserializer
        .end()
        .map_err(|error| format!("legacy media vault manifest has trailing data: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[cfg(unix)]
fn identity_from_metadata(metadata: &fs::Metadata) -> FileIdentity {
    use std::os::unix::fs::MetadataExt;

    FileIdentity {
        stable_id: format!("{}:{}", metadata.dev(), metadata.ino()),
        byte_length: metadata.len(),
        modified_marker: format!(
            "{}:{}:{}:{}",
            metadata.mtime(),
            metadata.mtime_nsec(),
            metadata.ctime(),
            metadata.ctime_nsec()
        ),
    }
}

#[cfg(windows)]
fn identity_from_metadata(metadata: &fs::Metadata) -> FileIdentity {
    use std::os::windows::fs::MetadataExt;

    FileIdentity {
        stable_id: format!(
            "{}:{}",
            metadata.volume_serial_number().unwrap_or_default(),
            metadata.file_index().unwrap_or_default()
        ),
        byte_length: metadata.file_size(),
        modified_marker: metadata.last_write_time().to_string(),
    }
}

#[cfg(not(any(unix, windows)))]
fn identity_from_metadata(metadata: &fs::Metadata) -> FileIdentity {
    let modified_marker = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| format!("{}:{}", value.as_secs(), value.subsec_nanos()))
        .unwrap_or_else(|| "unknown".to_string());
    FileIdentity {
        stable_id: format!("len:{}:{modified_marker}", metadata.len()),
        byte_length: metadata.len(),
        modified_marker,
    }
}

#[cfg(unix)]
fn open_root_no_follow(path: &Path) -> Result<File, String> {
    use std::ffi::CString;
    use std::os::fd::FromRawFd;
    use std::os::unix::ffi::OsStrExt;

    let encoded = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| "legacy media vault root contains NUL".to_string())?;
    let descriptor = unsafe {
        libc::open(
            encoded.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW,
        )
    };
    if descriptor < 0 {
        return Err(format!(
            "legacy media vault root cannot be opened without following links: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(windows)]
fn open_root_no_follow(path: &Path) -> Result<File, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || !metadata.is_dir() {
        return Err("legacy media vault root is not an ordinary directory".into());
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|error| error.to_string())?;
    let opened = file.metadata().map_err(|error| error.to_string())?;
    if opened.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || !opened.is_dir() {
        return Err("legacy media vault root changed while opening".into());
    }
    Ok(file)
}

#[cfg(not(any(unix, windows)))]
fn open_root_no_follow(_path: &Path) -> Result<File, String> {
    Err("legacy media vault reconciliation has no no-follow adapter for this platform".into())
}

#[cfg(unix)]
fn classify_openat_failure(
    directory_descriptor: i32,
    name: &std::ffi::CStr,
    expected_directory: bool,
) -> NoFollowOpenError {
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ENOENT) {
        return NoFollowOpenError::Missing;
    }
    if error.raw_os_error() == Some(libc::ELOOP) {
        return NoFollowOpenError::Symlinked;
    }

    let mut status = std::mem::MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            directory_descriptor,
            name.as_ptr(),
            status.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result == 0 {
        let status = unsafe { status.assume_init() };
        if status.st_mode & libc::S_IFMT == libc::S_IFLNK {
            return NoFollowOpenError::Symlinked;
        }
        let file_type = status.st_mode & libc::S_IFMT;
        if (expected_directory && file_type != libc::S_IFDIR)
            || (!expected_directory && file_type != libc::S_IFREG)
        {
            return NoFollowOpenError::NotRegular;
        }
    }
    NoFollowOpenError::Unreadable(error.to_string())
}

#[cfg(unix)]
fn open_relative_no_follow(
    root: &PinnedVaultRoot,
    relative: &Path,
) -> Result<OpenedVaultFile, NoFollowOpenError> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    let components: Vec<_> = relative.components().collect();
    if components.is_empty()
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(NoFollowOpenError::OutOfRoot);
    }

    let mut opened_directories = Vec::<File>::new();
    let mut current_descriptor = root.directory.as_raw_fd();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err(NoFollowOpenError::OutOfRoot);
        };
        let encoded = CString::new(name.as_bytes()).map_err(|_| NoFollowOpenError::OutOfRoot)?;
        let is_final = index + 1 == components.len();
        let flags = if is_final {
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW
        } else {
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW
        };
        let descriptor = unsafe { libc::openat(current_descriptor, encoded.as_ptr(), flags) };
        if descriptor < 0 {
            return Err(classify_openat_failure(
                current_descriptor,
                &encoded,
                !is_final,
            ));
        }
        let opened = unsafe { File::from_raw_fd(descriptor) };
        let metadata = opened
            .metadata()
            .map_err(|error| NoFollowOpenError::Unreadable(error.to_string()))?;
        let identity = identity_from_metadata(&metadata);
        let root_device = root
            .identity
            .stable_id
            .split(':')
            .next()
            .unwrap_or_default();
        let opened_device = identity.stable_id.split(':').next().unwrap_or_default();
        if opened_device != root_device {
            return Err(NoFollowOpenError::OutOfRoot);
        }
        if is_final {
            if !metadata.is_file() {
                return Err(NoFollowOpenError::NotRegular);
            }
            return Ok(OpenedVaultFile {
                file: opened,
                identity,
            });
        }
        if !metadata.is_dir() {
            return Err(NoFollowOpenError::NotRegular);
        }
        opened_directories.push(opened);
        current_descriptor = opened_directories
            .last()
            .expect("opened directory remains owned")
            .as_raw_fd();
    }
    Err(NoFollowOpenError::OutOfRoot)
}

#[cfg(windows)]
fn open_relative_no_follow(
    root: &PinnedVaultRoot,
    relative: &Path,
) -> Result<OpenedVaultFile, NoFollowOpenError> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    let mut candidate = root.path.clone();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(NoFollowOpenError::OutOfRoot);
        };
        candidate.push(name);
        let metadata = fs::symlink_metadata(&candidate).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                NoFollowOpenError::Missing
            } else {
                NoFollowOpenError::Unreadable(error.to_string())
            }
        })?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(NoFollowOpenError::Symlinked);
        }
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(&candidate)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                NoFollowOpenError::Missing
            } else {
                NoFollowOpenError::Unreadable(error.to_string())
            }
        })?;
    let metadata = file
        .metadata()
        .map_err(|error| NoFollowOpenError::Unreadable(error.to_string()))?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(NoFollowOpenError::Symlinked);
    }
    if !metadata.is_file() {
        return Err(NoFollowOpenError::NotRegular);
    }
    let canonical_root = root
        .path
        .canonicalize()
        .map_err(|error| NoFollowOpenError::Unreadable(error.to_string()))?;
    let canonical_file = candidate
        .canonicalize()
        .map_err(|error| NoFollowOpenError::Unreadable(error.to_string()))?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err(NoFollowOpenError::OutOfRoot);
    }
    Ok(OpenedVaultFile {
        identity: identity_from_metadata(&metadata),
        file,
    })
}

#[cfg(not(any(unix, windows)))]
fn open_relative_no_follow(
    _root: &PinnedVaultRoot,
    _relative: &Path,
) -> Result<OpenedVaultFile, NoFollowOpenError> {
    Err(NoFollowOpenError::Unreadable(
        "no no-follow adapter is available".into(),
    ))
}

impl PinnedVaultRoot {
    #[cfg(any(test, not(unix)))]
    fn open(path: PathBuf) -> Result<Self, String> {
        let directory = open_root_no_follow(&path)?;
        let metadata = directory.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_dir() {
            return Err("legacy media vault root is not a directory".into());
        }
        Ok(Self {
            path,
            identity: identity_from_metadata(&metadata),
            directory,
        })
    }

    fn open_relative(&self, relative: &Path) -> Result<OpenedVaultFile, NoFollowOpenError> {
        open_relative_no_follow(self, relative)
    }

    #[cfg(not(unix))]
    fn verify_path_identity(&self) -> Result<(), String> {
        let reopened = open_root_no_follow(&self.path)?;
        let metadata = reopened.metadata().map_err(|error| error.to_string())?;
        let current = identity_from_metadata(&metadata);
        if current.stable_id != self.identity.stable_id {
            return Err("legacy media vault root changed during reconciliation".into());
        }
        Ok(())
    }

    #[cfg(unix)]
    fn verify_path_identity(&self) -> Result<(), String> {
        let metadata = self
            .directory
            .metadata()
            .map_err(|error| error.to_string())?;
        if identity_from_metadata(&metadata).stable_id != self.identity.stable_id {
            return Err("legacy media vault root descriptor changed during reconciliation".into());
        }
        Ok(())
    }
}

#[cfg(unix)]
fn open_pinned_vault_root(app_root: &Path) -> Result<Option<PinnedVaultRoot>, String> {
    use std::ffi::CString;

    let app_directory = match freed_library_core::desktop_binding() {
        Ok(binding) => File::from(
            binding
                .duplicate_app_root_descriptor()
                .map_err(|error| error.to_string())?,
        ),
        Err(_) => open_root_no_follow(app_root)?,
    };
    let encoded = CString::new(LEGACY_VAULT_DIRECTORY)
        .map_err(|_| "legacy media vault root name contains NUL".to_string())?;
    let descriptor = unsafe {
        libc::openat(
            app_directory.as_raw_fd(),
            encoded.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW,
        )
    };
    if descriptor < 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok(None);
        }
        if matches!(error.raw_os_error(), Some(code) if code == libc::ELOOP || code == libc::ENOTDIR)
        {
            return Err("legacy media vault root is not an ordinary directory".into());
        }
        return Err(format!(
            "legacy media vault root cannot be opened without following links: {error}"
        ));
    }
    let directory = unsafe { File::from_raw_fd(descriptor) };
    let metadata = directory.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err("legacy media vault root is not a directory".into());
    }
    Ok(Some(PinnedVaultRoot {
        path: app_root.join(LEGACY_VAULT_DIRECTORY),
        identity: identity_from_metadata(&metadata),
        directory,
    }))
}

#[cfg(not(unix))]
fn open_pinned_vault_root(app_root: &Path) -> Result<Option<PinnedVaultRoot>, String> {
    let vault_path = app_root.join(LEGACY_VAULT_DIRECTORY);
    let vault_metadata = match fs::symlink_metadata(&vault_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if vault_metadata.file_type().is_symlink() || !vault_metadata.is_dir() {
        return Err("legacy media vault root is not an ordinary directory".into());
    }
    PinnedVaultRoot::open(vault_path).map(Some)
}

fn read_opened_file_bounded(
    opened: &mut OpenedVaultFile,
    maximum_bytes: u64,
) -> Result<Vec<u8>, String> {
    if opened.identity.byte_length > maximum_bytes {
        return Err(format!(
            "legacy media vault manifest exceeds {} bytes",
            maximum_bytes
        ));
    }
    let capacity = usize::try_from(opened.identity.byte_length)
        .map_err(|_| "legacy media vault manifest is too large for this platform")?;
    let mut bytes = Vec::with_capacity(capacity);
    std::io::Read::by_ref(&mut opened.file)
        .take(maximum_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let after = opened.file.metadata().map_err(|error| error.to_string())?;
    let after_identity = identity_from_metadata(&after);
    if after_identity != opened.identity
        || bytes.len() as u64 != opened.identity.byte_length
        || bytes.len() as u64 > maximum_bytes
    {
        return Err("legacy media vault manifest changed while it was read".into());
    }
    Ok(bytes)
}

fn read_current_manifest(root: &PinnedVaultRoot) -> Result<Option<Vec<u8>>, String> {
    let mut opened = match root.open_relative(Path::new(LEGACY_MANIFEST_FILE)) {
        Ok(opened) => opened,
        Err(NoFollowOpenError::Missing) => {
            return Err("legacy media vault manifest.json is missing".into())
        }
        Err(NoFollowOpenError::Symlinked) => {
            return Err("legacy media vault manifest.json is a symbolic link".into())
        }
        Err(NoFollowOpenError::OutOfRoot) => {
            return Err("legacy media vault manifest resolved outside its exact root".into())
        }
        Err(NoFollowOpenError::NotRegular) => {
            return Err("legacy media vault manifest.json is not a regular file".into())
        }
        Err(NoFollowOpenError::Unreadable(error)) => {
            return Err(format!(
                "legacy media vault manifest cannot be read: {error}"
            ))
        }
    };
    read_opened_file_bounded(&mut opened, MAX_MANIFEST_BYTES).map(Some)
}

#[cfg(not(unix))]
fn ensure_plain_directory(path: &Path) -> Result<(), String> {
    match fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Library Core recovery path is not an ordinary directory: {}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(unix)]
#[derive(Clone)]
struct BoundRecoveryDirectory {
    directory: Arc<File>,
    diagnostic_path: PathBuf,
    device: u64,
    owner: u32,
}

#[cfg(unix)]
impl BoundRecoveryDirectory {
    fn from_owned_descriptor(
        descriptor: OwnedFd,
        diagnostic_path: PathBuf,
    ) -> Result<Self, String> {
        use std::os::unix::fs::MetadataExt;

        let directory = File::from(descriptor);
        let metadata = directory.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_dir() {
            return Err("Library Core recovery root is not a physical directory".into());
        }
        Ok(Self {
            directory: Arc::new(directory),
            diagnostic_path,
            device: metadata.dev(),
            owner: metadata.uid(),
        })
    }

    fn open_or_create_child(&self, name: &str) -> Result<Self, String> {
        use std::ffi::CString;
        use std::os::unix::fs::MetadataExt;

        if name.is_empty() || matches!(name, "." | "..") || name.as_bytes().contains(&b'/') {
            return Err("Library Core recovery directory leaf is invalid".into());
        }
        let encoded = CString::new(name)
            .map_err(|_| "Library Core recovery directory leaf contains NUL".to_string())?;
        let mut descriptor = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                encoded.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
        {
            if unsafe { libc::mkdirat(self.directory.as_raw_fd(), encoded.as_ptr(), 0o700) } < 0
                && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            descriptor = unsafe {
                libc::openat(
                    self.directory.as_raw_fd(),
                    encoded.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                )
            };
        }
        if descriptor < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let descriptor = unsafe { OwnedFd::from_raw_fd(descriptor) };
        let file = File::from(descriptor.try_clone().map_err(|error| error.to_string())?);
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_dir() || metadata.dev() != self.device || metadata.uid() != self.owner {
            return Err("Library Core recovery directory escaped its bound root".into());
        }
        if metadata.mode() & 0o7777 != 0o700 {
            if unsafe { libc::fchmod(descriptor.as_raw_fd(), 0o700) } < 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let corrected = file.metadata().map_err(|error| error.to_string())?;
            if corrected.dev() != metadata.dev()
                || corrected.ino() != metadata.ino()
                || corrected.uid() != self.owner
                || corrected.mode() & 0o7777 != 0o700
            {
                return Err("Library Core recovery directory is not private".into());
            }
        }
        Ok(Self {
            directory: Arc::new(file),
            diagnostic_path: self.diagnostic_path.join(name),
            device: self.device,
            owner: self.owner,
        })
    }

    fn artifact(&self, leaf: String) -> Result<RecoveryArtifact, String> {
        if leaf.is_empty() || matches!(leaf.as_str(), "." | "..") || leaf.as_bytes().contains(&b'/')
        {
            return Err("Library Core recovery artifact leaf is invalid".into());
        }
        Ok(RecoveryArtifact {
            directory: self.clone(),
            diagnostic_path: self.diagnostic_path.join(&leaf),
            leaf,
        })
    }

    fn sync(&self) -> Result<(), String> {
        self.directory.sync_all().map_err(|error| error.to_string())
    }
}

#[cfg(unix)]
#[derive(Clone)]
struct RecoveryArtifact {
    directory: BoundRecoveryDirectory,
    diagnostic_path: PathBuf,
    leaf: String,
}

#[cfg(not(unix))]
#[derive(Clone)]
struct RecoveryArtifact {
    diagnostic_path: PathBuf,
}

impl RecoveryArtifact {
    #[cfg(test)]
    fn diagnostic_path(&self) -> &Path {
        &self.diagnostic_path
    }

    #[cfg(unix)]
    fn open_existing(&self) -> Result<File, String> {
        use std::ffi::CString;
        use std::os::unix::fs::MetadataExt;

        let encoded = CString::new(self.leaf.as_bytes())
            .map_err(|_| "Library Core recovery artifact leaf contains NUL".to_string())?;
        let descriptor = unsafe {
            libc::openat(
                self.directory.directory.as_raw_fd(),
                encoded.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let file = unsafe { File::from_raw_fd(descriptor) };
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file()
            || metadata.dev() != self.directory.device
            || metadata.uid() != self.directory.owner
            || metadata.mode() & 0o7777 != 0o600
            || metadata.nlink() != 1
        {
            return Err(format!(
                "Library Core recovery artifact is not one private physical file: {}",
                self.diagnostic_path.display()
            ));
        }
        Ok(file)
    }

    #[cfg(not(unix))]
    fn open_existing(&self) -> Result<File, String> {
        let metadata =
            fs::symlink_metadata(&self.diagnostic_path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "Library Core recovery artifact is not an ordinary file: {}",
                self.diagnostic_path.display()
            ));
        }
        File::open(&self.diagnostic_path).map_err(|error| error.to_string())
    }

    fn read_bounded(&self, maximum_bytes: u64) -> Result<Vec<u8>, String> {
        let mut file = self.open_existing()?;
        let opened_identity =
            identity_from_metadata(&file.metadata().map_err(|error| error.to_string())?);
        if opened_identity.byte_length > maximum_bytes {
            return Err(format!(
                "Library Core recovery artifact exceeds its {} byte bound",
                maximum_bytes
            ));
        }
        let capacity = usize::try_from(opened_identity.byte_length)
            .map_err(|_| "Library Core recovery artifact is too large for this platform")?;
        let mut bytes = Vec::with_capacity(capacity);
        std::io::Read::by_ref(&mut file)
            .take(maximum_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        let final_identity =
            identity_from_metadata(&file.metadata().map_err(|error| error.to_string())?);
        if final_identity != opened_identity
            || bytes.len() as u64 != opened_identity.byte_length
            || bytes.len() as u64 > maximum_bytes
        {
            return Err("Library Core recovery artifact changed while it was read".into());
        }
        Ok(bytes)
    }

    fn write_once(&self, bytes: &[u8]) -> Result<(), String> {
        match self.read_bounded(bytes.len() as u64) {
            Ok(existing) => {
                if existing != bytes {
                    return Err(format!(
                        "Library Core recovery artifact conflicts with durable bytes: {}",
                        self.diagnostic_path.display()
                    ));
                }
                return Ok(());
            }
            Err(error) if !is_missing_artifact_error(&error) => return Err(error),
            Err(_) => {}
        }

        let mut temporary = StagedRecoveryFile::new(self)?;
        temporary
            .file_mut()
            .write_all(bytes)
            .and_then(|_| temporary.file_mut().sync_all())
            .map_err(|error| error.to_string())?;
        temporary.commit_noclobber(self)?;
        let readback = self.read_bounded(bytes.len() as u64)?;
        if readback != bytes {
            return Err(format!(
                "Library Core recovery artifact failed durable readback: {}",
                self.diagnostic_path.display()
            ));
        }
        Ok(())
    }
}

fn is_missing_artifact_error(error: &str) -> bool {
    error.contains("No such file") || error.contains("os error 2") || error.contains("cannot find")
}

#[cfg(unix)]
struct StagedRecoveryFile {
    directory: BoundRecoveryDirectory,
    file: File,
    leaf: String,
    temporary_exists: bool,
}

#[cfg(unix)]
impl StagedRecoveryFile {
    fn new(destination: &RecoveryArtifact) -> Result<Self, String> {
        use std::ffi::CString;

        static NEXT_TEMPORARY_ID: AtomicU64 = AtomicU64::new(1);
        for _ in 0..32 {
            let id = NEXT_TEMPORARY_ID.fetch_add(1, Ordering::Relaxed);
            let leaf = format!(".recovery-{}-{id}.tmp", std::process::id());
            let encoded = CString::new(leaf.as_bytes())
                .map_err(|_| "Library Core recovery temporary leaf contains NUL".to_string())?;
            let descriptor = unsafe {
                libc::openat(
                    destination.directory.directory.as_raw_fd(),
                    encoded.as_ptr(),
                    libc::O_RDWR
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_CLOEXEC
                        | libc::O_NOFOLLOW,
                    0o600,
                )
            };
            if descriptor >= 0 {
                return Ok(Self {
                    directory: destination.directory.clone(),
                    file: unsafe { File::from_raw_fd(descriptor) },
                    leaf,
                    temporary_exists: true,
                });
            }
            if std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        Err("Library Core recovery could not reserve a temporary file".into())
    }

    fn file_mut(&mut self) -> &mut File {
        &mut self.file
    }

    fn commit_noclobber(&mut self, destination: &RecoveryArtifact) -> Result<(), String> {
        use std::ffi::CString;

        let source = CString::new(self.leaf.as_bytes())
            .map_err(|_| "Library Core recovery temporary leaf contains NUL".to_string())?;
        let target = CString::new(destination.leaf.as_bytes())
            .map_err(|_| "Library Core recovery artifact leaf contains NUL".to_string())?;
        let result = unsafe {
            libc::linkat(
                self.directory.directory.as_raw_fd(),
                source.as_ptr(),
                destination.directory.directory.as_raw_fd(),
                target.as_ptr(),
                0,
            )
        };
        if result < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        self.unlink_temporary()?;
        destination.directory.sync()?;
        Ok(())
    }

    fn unlink_temporary(&mut self) -> Result<(), String> {
        use std::ffi::CString;

        let encoded = CString::new(self.leaf.as_bytes())
            .map_err(|_| "Library Core recovery temporary leaf contains NUL".to_string())?;
        if unsafe { libc::unlinkat(self.directory.directory.as_raw_fd(), encoded.as_ptr(), 0) } < 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        self.temporary_exists = false;
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for StagedRecoveryFile {
    fn drop(&mut self) {
        if self.temporary_exists {
            let _ = self.unlink_temporary();
        }
    }
}

#[cfg(not(unix))]
struct StagedRecoveryFile {
    file: Option<tempfile::NamedTempFile>,
}

#[cfg(not(unix))]
impl StagedRecoveryFile {
    fn new(destination: &RecoveryArtifact) -> Result<Self, String> {
        let parent = destination
            .diagnostic_path
            .parent()
            .ok_or_else(|| "Library Core recovery artifact has no parent".to_string())?;
        Ok(Self {
            file: Some(tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?),
        })
    }

    fn file_mut(&mut self) -> &mut File {
        self.file
            .as_mut()
            .expect("staged file remains owned")
            .as_file_mut()
    }

    fn commit_noclobber(&mut self, destination: &RecoveryArtifact) -> Result<(), String> {
        let temporary = self.file.take().expect("staged file remains owned");
        match temporary.persist_noclobber(&destination.diagnostic_path) {
            Ok(file) => file.sync_all().map_err(|error| error.to_string()),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error.error.to_string()),
        }
    }
}

struct RecoveryStore {
    #[cfg(unix)]
    blob_root: BoundRecoveryDirectory,
    #[cfg(not(unix))]
    blob_root: PathBuf,
    #[cfg(unix)]
    source_manifest_root: BoundRecoveryDirectory,
    #[cfg(not(unix))]
    source_manifest_root: PathBuf,
    #[cfg(unix)]
    logical_backup_root: BoundRecoveryDirectory,
    #[cfg(not(unix))]
    logical_backup_root: PathBuf,
    #[cfg(unix)]
    receipt_root: BoundRecoveryDirectory,
    #[cfg(not(unix))]
    receipt_root: PathBuf,
    #[cfg(unix)]
    staging_root: BoundRecoveryDirectory,
    #[cfg(not(unix))]
    staging_root: PathBuf,
}

impl RecoveryStore {
    #[cfg(unix)]
    fn open(app_root: &Path) -> Result<Self, String> {
        let library_core = match freed_library_core::desktop_binding() {
            Ok(binding) => BoundRecoveryDirectory::from_owned_descriptor(
                binding
                    .duplicate_library_root_descriptor()
                    .map_err(|error| error.to_string())?,
                app_root.join("library-core"),
            )?,
            Err(_) => {
                let app_directory = open_root_no_follow(app_root)?;
                let app = BoundRecoveryDirectory::from_owned_descriptor(
                    app_directory.into(),
                    app_root.to_path_buf(),
                )?;
                app.open_or_create_child("library-core")?
            }
        };
        let recovery_root = library_core.open_or_create_child(RECOVERY_DIRECTORY)?;
        let blob_root = library_core.open_or_create_child(BLOB_DIRECTORY)?;
        let source_manifest_root = recovery_root.open_or_create_child(SOURCE_MANIFEST_DIRECTORY)?;
        let logical_backup_root = recovery_root.open_or_create_child(LOGICAL_BACKUP_DIRECTORY)?;
        let receipt_root = recovery_root.open_or_create_child(RECEIPT_DIRECTORY)?;
        let staging_root = recovery_root.open_or_create_child(STAGING_DIRECTORY)?;
        library_core.sync()?;
        recovery_root.sync()?;
        Ok(Self {
            blob_root,
            source_manifest_root,
            logical_backup_root,
            receipt_root,
            staging_root,
        })
    }

    #[cfg(not(unix))]
    fn open(_app_root: &Path) -> Result<Self, String> {
        Err(
            "legacy media vault reconciliation requires descriptor-bound recovery storage on this platform"
                .into(),
        )
    }

    fn source_manifest(&self, digest: &str) -> Result<RecoveryArtifact, String> {
        self.artifact(&self.source_manifest_root, format!("{digest}.json"))
    }

    fn logical_backup(&self, digest: &str) -> Result<RecoveryArtifact, String> {
        self.artifact(&self.logical_backup_root, format!("{digest}.json"))
    }

    fn receipt(&self, digest: &str) -> Result<RecoveryArtifact, String> {
        self.artifact(&self.receipt_root, format!("{digest}.json"))
    }

    #[cfg(unix)]
    fn artifact(
        &self,
        directory: &BoundRecoveryDirectory,
        leaf: String,
    ) -> Result<RecoveryArtifact, String> {
        directory.artifact(leaf)
    }

    #[cfg(not(unix))]
    fn artifact(&self, directory: &Path, leaf: String) -> Result<RecoveryArtifact, String> {
        Ok(RecoveryArtifact {
            diagnostic_path: directory.join(leaf),
        })
    }

    fn blob(&self, digest: &str) -> Result<RecoveryArtifact, String> {
        if !is_lower_sha256(digest) {
            return Err("Library Core blob digest is invalid".into());
        }
        #[cfg(unix)]
        {
            let shard = self.blob_root.open_or_create_child(&digest[..2])?;
            self.blob_root.sync()?;
            shard.artifact(digest.to_string())
        }
        #[cfg(not(unix))]
        {
            let shard = self.blob_root.join(&digest[..2]);
            ensure_plain_directory(&shard)?;
            sync_directory(&self.blob_root)?;
            Ok(RecoveryArtifact {
                diagnostic_path: shard.join(digest),
            })
        }
    }

    fn staging_file(&self) -> Result<StagedRecoveryFile, String> {
        #[cfg(unix)]
        {
            let destination = self.staging_root.artifact("stage".to_string())?;
            StagedRecoveryFile::new(&destination)
        }
        #[cfg(not(unix))]
        {
            let destination = RecoveryArtifact {
                diagnostic_path: self.staging_root.join("stage"),
            };
            StagedRecoveryFile::new(&destination)
        }
    }

    #[cfg(test)]
    fn logical_backup_path(&self, digest: &str) -> PathBuf {
        self.logical_backup(digest)
            .expect("resolve logical backup artifact")
            .diagnostic_path()
            .to_path_buf()
    }

    #[cfg(test)]
    fn receipt_path(&self, digest: &str) -> PathBuf {
        self.receipt(digest)
            .expect("resolve receipt artifact")
            .diagnostic_path()
            .to_path_buf()
    }

    #[cfg(test)]
    fn blob_path(&self, digest: &str) -> Result<PathBuf, String> {
        Ok(self.blob(digest)?.diagnostic_path().to_path_buf())
    }

    #[cfg(all(test, unix))]
    fn receipt_root_path(&self) -> &Path {
        &self.receipt_root.diagnostic_path
    }

    #[cfg(all(test, not(unix)))]
    fn receipt_root_path(&self) -> &Path {
        &self.receipt_root
    }
}

fn verify_blob_file(
    artifact: &RecoveryArtifact,
    expected_digest: &str,
    expected_length: u64,
) -> Result<String, String> {
    let mut file = artifact.open_existing()?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if metadata.len() != expected_length {
        return Err("Library Core content-addressed blob length is corrupt".into());
    }
    let opened_identity =
        identity_from_metadata(&file.metadata().map_err(|error| error.to_string())?);
    let mut raw_digest = Sha256::new();
    let mut digest = Sha256::new();
    digest.update(BLOB_DIGEST_PREFIX);
    let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES];
    let mut total = 0_u64;
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or_else(|| "Library Core blob byte count overflowed".to_string())?;
        raw_digest.update(&buffer[..read]);
        digest.update(&buffer[..read]);
    }
    let final_identity =
        identity_from_metadata(&file.metadata().map_err(|error| error.to_string())?);
    if opened_identity != final_identity || total != expected_length {
        return Err("Library Core content-addressed blob changed while it was verified".into());
    }
    if lower_hex(&digest.finalize()) != expected_digest {
        return Err("Library Core content-addressed blob digest is corrupt".into());
    }
    Ok(lower_hex(&raw_digest.finalize()))
}

fn persist_captured_blob(
    store: &RecoveryStore,
    mut temporary: StagedRecoveryFile,
    captured: &CapturedBlob,
) -> Result<(), String> {
    let destination = store.blob(&captured.blob_content_digest)?;
    temporary.commit_noclobber(&destination)?;
    let _ = verify_blob_file(
        &destination,
        &captured.blob_content_digest,
        captured.byte_length,
    )?;
    Ok(())
}

fn capture_blob(
    store: &RecoveryStore,
    mut opened: OpenedVaultFile,
) -> Result<CapturedBlob, CaptureBlobError> {
    if opened.identity.byte_length > MAX_BLOB_BYTES {
        return Err(CaptureBlobError::ExceedsV1BlobLimit);
    }
    let mut temporary = store.staging_file().map_err(CaptureBlobError::Store)?;
    let mut raw_digest = Sha256::new();
    let mut blob_digest = Sha256::new();
    blob_digest.update(BLOB_DIGEST_PREFIX);
    let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES];
    let mut total = 0_u64;
    loop {
        let read = opened
            .file
            .read(&mut buffer)
            .map_err(|_| CaptureBlobError::SourceUnreadable)?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or(CaptureBlobError::ExceedsV1BlobLimit)?;
        if total > MAX_BLOB_BYTES {
            return Err(CaptureBlobError::ExceedsV1BlobLimit);
        }
        raw_digest.update(&buffer[..read]);
        blob_digest.update(&buffer[..read]);
        temporary
            .file_mut()
            .write_all(&buffer[..read])
            .map_err(|error| CaptureBlobError::Store(error.to_string()))?;
    }
    temporary
        .file_mut()
        .flush()
        .and_then(|_| temporary.file_mut().sync_all())
        .map_err(|error| CaptureBlobError::Store(error.to_string()))?;
    let final_metadata = opened
        .file
        .metadata()
        .map_err(|_| CaptureBlobError::SourceUnreadable)?;
    let final_identity = identity_from_metadata(&final_metadata);
    if final_identity != opened.identity || total != opened.identity.byte_length {
        return Err(CaptureBlobError::SourceChanged);
    }
    let captured = CapturedBlob {
        blob_content_digest: lower_hex(&blob_digest.finalize()),
        raw_sha256: lower_hex(&raw_digest.finalize()),
        byte_length: total,
        source_identity: final_identity,
    };
    persist_captured_blob(store, temporary, &captured).map_err(CaptureBlobError::Store)?;
    Ok(captured)
}

fn normalize_entry_relative_path(
    vault_root: &Path,
    entry: &LegacyMediaVaultEntryV1,
) -> Result<PathBuf, QuarantineReason> {
    let raw = Path::new(&entry.local_path);
    let relative = if raw.is_absolute() {
        raw.strip_prefix(vault_root)
            .map_err(|_| QuarantineReason::OutOfRoot)?
    } else {
        raw
    };
    let components: Vec<_> = relative.components().collect();
    if components.len() != 2
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(QuarantineReason::OutOfRoot);
    }
    let Component::Normal(provider) = components[0] else {
        return Err(QuarantineReason::OutOfRoot);
    };
    if provider.to_string_lossy() != entry.provider.as_str() {
        return Err(QuarantineReason::OutOfRoot);
    }
    Ok(relative.to_path_buf())
}

fn normalized_relative_key(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn push_reason(reasons: &mut Vec<QuarantineReason>, reason: QuarantineReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}

fn reason_for_open_failure(error: NoFollowOpenError) -> QuarantineReason {
    match error {
        NoFollowOpenError::Missing => QuarantineReason::Missing,
        NoFollowOpenError::Symlinked => QuarantineReason::Symlinked,
        NoFollowOpenError::OutOfRoot => QuarantineReason::OutOfRoot,
        NoFollowOpenError::NotRegular => QuarantineReason::NotRegularFile,
        NoFollowOpenError::Unreadable(message) => {
            let _ = message;
            QuarantineReason::Unreadable
        }
    }
}

fn checked_count(value: usize) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| "media vault entry count overflowed".to_string())
}

fn serialize_json<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|error| error.to_string())
}

fn parse_closed_json<T>(bytes: &[u8], label: &str) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let parsed = T::deserialize(&mut deserializer)
        .map_err(|error| format!("{label} is corrupt: {error}"))?;
    deserializer
        .end()
        .map_err(|error| format!("{label} has trailing data: {error}"))?;
    Ok(parsed)
}

fn verify_logical_backup(
    store: &RecoveryStore,
    source_manifest_bytes: &[u8],
    source_manifest: &LegacyMediaVaultManifestV1,
    source_manifest_digest: &str,
    receipt: &ReconciliationReceiptV1,
) -> Result<LogicalBackupV1, String> {
    if receipt.format != RECEIPT_FORMAT
        || receipt.source_manifest_digest != source_manifest_digest
        || receipt.source_manifest_byte_length != source_manifest_bytes.len() as u64
        || !safe_integer(receipt.completed_at_ms)
        || receipt.attempted_entry_count
            != receipt
                .admitted_entry_count
                .checked_add(receipt.quarantined_entry_count)
                .ok_or_else(|| "media vault receipt count overflowed".to_string())?
    {
        return Err("legacy media vault reconciliation receipt is inconsistent".into());
    }
    let source_copy = store
        .source_manifest(source_manifest_digest)?
        .read_bounded(MAX_MANIFEST_BYTES)?;
    if source_copy != source_manifest_bytes
        || domain_digest(SOURCE_MANIFEST_DIGEST_PREFIX, &source_copy) != source_manifest_digest
    {
        return Err("legacy media vault source-manifest backup is inconsistent".into());
    }
    let backup_bytes = store
        .logical_backup(source_manifest_digest)?
        .read_bounded(MAX_MANIFEST_BYTES.saturating_mul(4))?;
    if sha256(&backup_bytes) != receipt.logical_backup_sha256 {
        return Err("legacy media vault logical backup digest is corrupt".into());
    }
    let backup: LogicalBackupV1 =
        parse_closed_json(&backup_bytes, "legacy media vault logical backup")?;
    if backup.format != LOGICAL_BACKUP_FORMAT
        || backup.source_manifest_digest != source_manifest_digest
        || backup.source_manifest_byte_length != source_manifest_bytes.len() as u64
        || checked_count(backup.entries.len())? != receipt.attempted_entry_count
        || backup.entries.len() != source_manifest.entries.0.len()
    {
        return Err("legacy media vault logical backup is inconsistent".into());
    }
    let admitted = backup
        .entries
        .iter()
        .filter(|entry| entry.disposition == "admitted")
        .count();
    let quarantined = backup
        .entries
        .iter()
        .filter(|entry| entry.disposition == "quarantined")
        .count();
    if checked_count(admitted)? != receipt.admitted_entry_count
        || checked_count(quarantined)? != receipt.quarantined_entry_count
        || admitted + quarantined != backup.entries.len()
    {
        return Err("legacy media vault logical backup disposition count is corrupt".into());
    }
    let mut blob_digests = BTreeSet::new();
    for (entry, (source_id, source_entry)) in backup.entries.iter().zip(&source_manifest.entries.0)
    {
        if entry.entry_id.is_empty()
            || entry.entry_id.as_str() != source_id.as_str()
            || entry.provider.as_str() != source_entry.provider.as_str()
            || entry.source_local_path.as_str() != source_entry.local_path.as_str()
            || entry.declared_byte_length != source_entry.byte_size
            || entry.declared_content_hash.as_str() != source_entry.content_hash.as_str()
            || entry.media_type.as_deref()
                != source_entry
                    .media_type
                    .0
                    .as_ref()
                    .map(|value| value.as_str())
            || entry.provider != "facebook" && entry.provider != "instagram"
            || entry.disposition == "admitted" && !entry.quarantine_reasons.is_empty()
            || entry.disposition == "quarantined" && entry.quarantine_reasons.is_empty()
        {
            return Err("legacy media vault logical backup entry is inconsistent".into());
        }
        match (
            &entry.actual_blob_content_digest,
            &entry.actual_raw_sha256,
            entry.actual_byte_length,
        ) {
            (Some(blob_digest), Some(raw_digest), Some(byte_length)) => {
                if !is_lower_sha256(blob_digest)
                    || !is_lower_sha256(raw_digest)
                    || byte_length > MAX_BLOB_BYTES
                {
                    return Err(
                        "legacy media vault logical backup blob reference is invalid".into(),
                    );
                }
                let blob = store.blob(blob_digest)?;
                let verified_raw_digest = verify_blob_file(&blob, blob_digest, byte_length)
                    .map_err(|error| {
                        format!("legacy media vault logical backup blob is corrupt: {error}")
                    })?;
                if &verified_raw_digest != raw_digest {
                    return Err(
                        "legacy media vault logical backup raw blob digest is corrupt".into(),
                    );
                }
                blob_digests.insert(blob_digest.clone());
            }
            (None, None, None) => {
                if entry.disposition != "quarantined" {
                    return Err("admitted legacy media vault entry has no preserved blob".into());
                }
            }
            _ => {
                return Err("legacy media vault logical backup has a partial blob reference".into())
            }
        }
    }
    if checked_count(blob_digests.len())? != receipt.preserved_blob_count {
        return Err("legacy media vault receipt blob count is inconsistent".into());
    }
    Ok(backup)
}

fn read_existing_receipt(
    store: &RecoveryStore,
    source_manifest_bytes: &[u8],
    source_manifest: &LegacyMediaVaultManifestV1,
    source_manifest_digest: &str,
) -> Result<Option<ReconciliationReceiptV1>, String> {
    let receipt = store.receipt(source_manifest_digest)?;
    let bytes = match receipt.read_bounded(1_048_576) {
        Ok(bytes) => bytes,
        Err(error) if is_missing_artifact_error(&error) => return Ok(None),
        Err(error) => return Err(error),
    };
    let receipt: ReconciliationReceiptV1 =
        parse_closed_json(&bytes, "legacy media vault reconciliation receipt")?;
    verify_logical_backup(
        store,
        source_manifest_bytes,
        source_manifest,
        source_manifest_digest,
        &receipt,
    )?;
    Ok(Some(receipt))
}

fn reconcile_entries(
    root: &PinnedVaultRoot,
    store: &RecoveryStore,
    manifest: &LegacyMediaVaultManifestV1,
    fault: Option<FaultPoint>,
) -> Result<ReconciledEntries, String> {
    #[cfg(not(test))]
    let _ = fault;
    struct PreparedEntry<'a> {
        id: &'a str,
        entry: &'a LegacyMediaVaultEntryV1,
        relative_path: Option<PathBuf>,
        reasons: Vec<QuarantineReason>,
    }

    let mut prepared = Vec::with_capacity(manifest.entries.0.len());
    let mut relative_path_counts = BTreeMap::<String, usize>::new();
    for (id, entry) in &manifest.entries.0 {
        let (relative_path, reasons) = match normalize_entry_relative_path(&root.path, entry) {
            Ok(path) => {
                *relative_path_counts
                    .entry(normalized_relative_key(&path))
                    .or_default() += 1;
                (Some(path), Vec::new())
            }
            Err(reason) => (None, vec![reason]),
        };
        prepared.push(PreparedEntry {
            id,
            entry,
            relative_path,
            reasons,
        });
    }
    for prepared_entry in &mut prepared {
        if prepared_entry.relative_path.as_ref().is_some_and(|path| {
            relative_path_counts
                .get(&normalized_relative_key(path))
                .copied()
                .unwrap_or_default()
                > 1
        }) {
            push_reason(&mut prepared_entry.reasons, QuarantineReason::Ambiguous);
        }
    }

    let mut outcomes = Vec::with_capacity(prepared.len());
    let mut source_observations = Vec::with_capacity(prepared.len());
    let mut first_blob_observed = false;
    for prepared_entry in prepared {
        let entry = prepared_entry.entry;
        let mut reasons = prepared_entry.reasons;
        let mut captured = None;
        if entry.content_hash.starts_with("fnv1a-") {
            push_reason(&mut reasons, QuarantineReason::LegacyFnvTagged);
        } else if !is_lower_sha256(&entry.content_hash) {
            push_reason(&mut reasons, QuarantineReason::DigestMismatch);
        }
        if entry.byte_size > MAX_BLOB_BYTES {
            push_reason(&mut reasons, QuarantineReason::ExceedsV1BlobLimit);
        }

        if let Some(relative_path) = prepared_entry.relative_path {
            match root.open_relative(&relative_path) {
                Ok(opened) if opened.identity.byte_length > MAX_BLOB_BYTES => {
                    push_reason(&mut reasons, QuarantineReason::ExceedsV1BlobLimit);
                }
                Ok(opened) => match capture_blob(store, opened) {
                    Ok(value) => {
                        if value.byte_length != entry.byte_size {
                            push_reason(&mut reasons, QuarantineReason::LengthMismatch);
                        }
                        if is_lower_sha256(&entry.content_hash)
                            && value.raw_sha256 != entry.content_hash
                        {
                            push_reason(&mut reasons, QuarantineReason::DigestMismatch);
                        }
                        source_observations.push(SourceObservation {
                            relative_path,
                            identity: value.source_identity.clone(),
                        });
                        captured = Some(value);
                        if !first_blob_observed {
                            first_blob_observed = true;
                            #[cfg(test)]
                            if fault == Some(FaultPoint::BlobCopy) {
                                return Err("injected crash after durable blob".into());
                            }
                        }
                    }
                    Err(CaptureBlobError::SourceChanged) => {
                        push_reason(&mut reasons, QuarantineReason::Ambiguous);
                    }
                    Err(CaptureBlobError::ExceedsV1BlobLimit) => {
                        push_reason(&mut reasons, QuarantineReason::ExceedsV1BlobLimit);
                    }
                    Err(CaptureBlobError::SourceUnreadable) => {
                        push_reason(&mut reasons, QuarantineReason::Unreadable);
                    }
                    Err(CaptureBlobError::Store(error)) => {
                        return Err(format!(
                            "Library Core media recovery store failed closed: {error}"
                        ));
                    }
                },
                Err(error) => push_reason(&mut reasons, reason_for_open_failure(error)),
            }
        }
        reasons.sort();
        let disposition = if reasons.is_empty() {
            "admitted"
        } else {
            "quarantined"
        };
        outcomes.push(LogicalBackupEntryV1 {
            entry_id: prepared_entry.id.to_string(),
            provider: entry.provider.as_str().to_string(),
            source_local_path: entry.local_path.clone(),
            declared_byte_length: entry.byte_size,
            declared_content_hash: entry.content_hash.clone(),
            media_type: entry
                .media_type
                .0
                .as_ref()
                .map(|value| value.as_str().to_string()),
            disposition: disposition.to_string(),
            actual_blob_content_digest: captured
                .as_ref()
                .map(|value| value.blob_content_digest.clone()),
            actual_raw_sha256: captured.as_ref().map(|value| value.raw_sha256.clone()),
            actual_byte_length: captured.as_ref().map(|value| value.byte_length),
            quarantine_reasons: reasons,
        });
    }
    Ok(ReconciledEntries {
        entries: outcomes,
        source_observations,
    })
}

fn verify_source_observations(
    root: &PinnedVaultRoot,
    observations: &[SourceObservation],
) -> Result<(), String> {
    for observation in observations {
        let reopened = root
            .open_relative(&observation.relative_path)
            .map_err(|_| "legacy media vault source changed before reconciliation commit")?;
        if reopened.identity != observation.identity {
            return Err("legacy media vault source changed before reconciliation commit".into());
        }
    }
    Ok(())
}

fn current_time_ms() -> Result<u64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before the Unix epoch".to_string())?;
    u64::try_from(duration.as_millis()).map_err(|_| "system clock exceeds the v1 range".to_string())
}

fn reconcile_legacy_media_vault_at_with_fault(
    app_root: &Path,
    fault: Option<FaultPoint>,
) -> Result<Option<ReconciliationReceiptV1>, String> {
    let Some(root) = open_pinned_vault_root(app_root)? else {
        return Ok(None);
    };
    let source_manifest_bytes = match read_current_manifest(&root)? {
        Some(bytes) => bytes,
        None => return Ok(None),
    };
    let manifest = parse_manifest(&source_manifest_bytes)?;
    let source_manifest_digest =
        domain_digest(SOURCE_MANIFEST_DIGEST_PREFIX, &source_manifest_bytes);
    let store = RecoveryStore::open(app_root)?;
    if let Some(receipt) = read_existing_receipt(
        &store,
        &source_manifest_bytes,
        &manifest,
        &source_manifest_digest,
    )? {
        root.verify_path_identity()?;
        return Ok(Some(receipt));
    }

    store
        .source_manifest(&source_manifest_digest)?
        .write_once(&source_manifest_bytes)?;
    let ReconciledEntries {
        entries,
        source_observations,
    } = reconcile_entries(&root, &store, &manifest, fault)?;
    let logical_backup = LogicalBackupV1 {
        format: LOGICAL_BACKUP_FORMAT.to_string(),
        source_manifest_digest: source_manifest_digest.clone(),
        source_manifest_byte_length: source_manifest_bytes.len() as u64,
        entries,
    };
    let logical_backup_bytes = serialize_json(&logical_backup)?;
    let logical_backup_sha256 = sha256(&logical_backup_bytes);
    store
        .logical_backup(&source_manifest_digest)?
        .write_once(&logical_backup_bytes)?;
    #[cfg(test)]
    if fault == Some(FaultPoint::BackupCommit) {
        return Err("injected crash after durable logical backup".into());
    }

    root.verify_path_identity()?;
    let final_manifest_bytes = read_current_manifest(&root)?.ok_or_else(|| {
        "legacy media vault manifest disappeared during reconciliation".to_string()
    })?;
    if final_manifest_bytes != source_manifest_bytes
        || domain_digest(SOURCE_MANIFEST_DIGEST_PREFIX, &final_manifest_bytes)
            != source_manifest_digest
    {
        return Err("legacy media vault manifest changed before reconciliation commit".into());
    }
    verify_source_observations(&root, &source_observations)?;

    let admitted_entry_count = logical_backup
        .entries
        .iter()
        .filter(|entry| entry.disposition == "admitted")
        .count();
    let quarantined_entry_count = logical_backup.entries.len() - admitted_entry_count;
    let preserved_blob_count = logical_backup
        .entries
        .iter()
        .filter_map(|entry| entry.actual_blob_content_digest.as_ref())
        .collect::<BTreeSet<_>>()
        .len();
    let receipt = ReconciliationReceiptV1 {
        format: RECEIPT_FORMAT.to_string(),
        source_manifest_digest: source_manifest_digest.clone(),
        source_manifest_byte_length: source_manifest_bytes.len() as u64,
        logical_backup_sha256,
        attempted_entry_count: checked_count(logical_backup.entries.len())?,
        admitted_entry_count: checked_count(admitted_entry_count)?,
        quarantined_entry_count: checked_count(quarantined_entry_count)?,
        preserved_blob_count: checked_count(preserved_blob_count)?,
        completed_at_ms: current_time_ms()?,
    };
    let receipt_bytes = serialize_json(&receipt)?;
    store
        .receipt(&source_manifest_digest)?
        .write_once(&receipt_bytes)?;
    #[cfg(test)]
    if fault == Some(FaultPoint::ReceiptResponseLoss) {
        return Err("injected lost response after durable receipt".into());
    }

    let verified = read_existing_receipt(
        &store,
        &source_manifest_bytes,
        &manifest,
        &source_manifest_digest,
    )?
    .ok_or_else(|| "legacy media vault reconciliation receipt disappeared".to_string())?;
    if verified != receipt {
        return Err("legacy media vault reconciliation receipt readback changed".into());
    }
    Ok(Some(receipt))
}

fn reconcile_legacy_media_vault_at(
    app_root: &Path,
) -> Result<Option<ReconciliationReceiptV1>, String> {
    reconcile_legacy_media_vault_at_with_fault(app_root, None)
}

pub(super) fn reconcile_legacy_media_vault_once(app_root: &Path) -> Result<(), String> {
    let state = PRODUCTION_RECONCILIATION.get_or_init(|| Mutex::new(None));
    let mut guard = state
        .lock()
        .map_err(|_| "legacy media vault reconciliation lock is poisoned".to_string())?;
    if let Some(cached) = guard.as_ref() {
        if cached.app_root == app_root {
            return cached.result.clone();
        }
    }
    let result = reconcile_legacy_media_vault_at(app_root).map(|receipt| {
        if let Some(receipt) = receipt {
            let manifest_tail = &receipt.source_manifest_digest
                [receipt.source_manifest_digest.len().saturating_sub(8)..];
            if receipt.quarantined_entry_count == 0 {
                log::info!(
                    "[library-core] legacy media vault reconciled entries={} blobs={} manifest=...{}",
                    receipt.admitted_entry_count,
                    receipt.preserved_blob_count,
                    manifest_tail
                );
            } else {
                log::warn!(
                    "[library-core] legacy media vault reconciled with quarantine admitted={} quarantined={} blobs={} manifest=...{}",
                    receipt.admitted_entry_count,
                    receipt.quarantined_entry_count,
                    receipt.preserved_blob_count,
                    manifest_tail
                );
            }
        }
    });
    *guard = Some(CachedProductionReconciliation {
        app_root: app_root.to_path_buf(),
        result: result.clone(),
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::io::Write;
    use tempfile::TempDir;

    fn fixture_root() -> TempDir {
        tempfile::tempdir().expect("create fixture root")
    }

    fn vault_root(root: &TempDir) -> PathBuf {
        root.path().join(LEGACY_VAULT_DIRECTORY)
    }

    fn provider_dir(root: &TempDir, provider: &str) -> PathBuf {
        let path = vault_root(root).join(provider);
        fs::create_dir_all(&path).expect("create provider directory");
        path
    }

    fn raw_sha256(bytes: &[u8]) -> String {
        lower_hex(&Sha256::digest(bytes))
    }

    fn entry(id: &str, provider: &str, path: &Path, bytes: &[u8]) -> Value {
        json!({
            "id": id,
            "provider": provider,
            "localPath": path.to_string_lossy(),
            "byteSize": bytes.len(),
            "contentHash": raw_sha256(bytes),
            "capturedAt": 1,
            "importSource": "meta_export",
            "mediaType": "image"
        })
    }

    fn manifest(entries: Vec<(&str, Value)>) -> Value {
        let mut entry_map = serde_json::Map::new();
        for (id, value) in entries {
            entry_map.insert(id.to_string(), value);
        }
        json!({
            "version": 1,
            "providers": {
                "facebook": { "enabled": false, "ownerHandles": [] },
                "instagram": { "enabled": false, "ownerHandles": [] }
            },
            "entries": entry_map,
            "failures": {},
            "roster": {}
        })
    }

    fn write_manifest(root: &TempDir, value: &Value) -> Vec<u8> {
        fs::create_dir_all(vault_root(root)).expect("create vault root");
        let bytes = serde_json::to_vec(value).expect("serialize fixture manifest");
        fs::write(vault_root(root).join(LEGACY_MANIFEST_FILE), &bytes)
            .expect("write fixture manifest");
        bytes
    }

    fn read_backup(root: &TempDir, receipt: &ReconciliationReceiptV1) -> LogicalBackupV1 {
        let store = RecoveryStore::open(root.path()).expect("open recovery store");
        let bytes = fs::read(store.logical_backup_path(&receipt.source_manifest_digest))
            .expect("read logical backup");
        parse_closed_json(&bytes, "test logical backup").expect("parse logical backup")
    }

    fn reasons_for<'a>(backup: &'a LogicalBackupV1, id: &str) -> &'a [QuarantineReason] {
        &backup
            .entries
            .iter()
            .find(|entry| entry.entry_id == id)
            .expect("find backup entry")
            .quarantine_reasons
    }

    #[test]
    fn empty_manifest_and_zero_byte_blob_are_valid() {
        let empty_root = fixture_root();
        write_manifest(&empty_root, &manifest(Vec::new()));
        let empty_receipt = reconcile_legacy_media_vault_at(empty_root.path())
            .expect("reconcile empty manifest")
            .expect("empty manifest has receipt");
        assert_eq!(empty_receipt.attempted_entry_count, 0);
        assert_eq!(empty_receipt.admitted_entry_count, 0);
        assert_eq!(empty_receipt.quarantined_entry_count, 0);

        let zero_root = fixture_root();
        let zero_path = provider_dir(&zero_root, "facebook").join("empty.bin");
        fs::write(&zero_path, []).expect("write empty blob");
        write_manifest(
            &zero_root,
            &manifest(vec![(
                "facebook:empty",
                entry("facebook:empty", "facebook", &zero_path, &[]),
            )]),
        );
        let zero_receipt = reconcile_legacy_media_vault_at(zero_root.path())
            .expect("reconcile empty blob")
            .expect("zero-byte manifest has receipt");
        assert_eq!(zero_receipt.admitted_entry_count, 1);
        assert_eq!(zero_receipt.quarantined_entry_count, 0);
        assert_eq!(zero_receipt.preserved_blob_count, 1);
        let backup = read_backup(&zero_root, &zero_receipt);
        let digest = backup.entries[0]
            .actual_blob_content_digest
            .as_ref()
            .expect("zero-byte blob digest");
        assert_eq!(
            digest,
            &domain_digest(BLOB_DIGEST_PREFIX, &[]),
            "empty content keeps a valid domain-separated identity"
        );
    }

    #[test]
    fn corrupt_and_nonclosed_manifests_fail_instead_of_becoming_empty() {
        let corrupt_root = fixture_root();
        fs::create_dir_all(vault_root(&corrupt_root)).expect("create corrupt vault");
        fs::write(
            vault_root(&corrupt_root).join(LEGACY_MANIFEST_FILE),
            b"{not-json",
        )
        .expect("write corrupt manifest");
        assert!(reconcile_legacy_media_vault_at(corrupt_root.path())
            .expect_err("corrupt manifest must fail")
            .contains("manifest is corrupt"));

        let malicious_root = fixture_root();
        let mut value = manifest(Vec::new());
        value
            .as_object_mut()
            .expect("manifest object")
            .insert("unknownAuthority".into(), json!(true));
        write_manifest(&malicious_root, &value);
        assert!(reconcile_legacy_media_vault_at(malicious_root.path())
            .expect_err("unknown manifest field must fail")
            .contains("unknown field"));

        let null_root = fixture_root();
        let path = provider_dir(&null_root, "facebook").join("null.jpg");
        fs::write(&path, b"null").expect("write null fixture");
        let mut invalid = entry("facebook:null", "facebook", &path, b"null");
        invalid
            .as_object_mut()
            .expect("entry object")
            .insert("sourceUrl".into(), Value::Null);
        write_manifest(&null_root, &manifest(vec![("facebook:null", invalid)]));
        assert!(reconcile_legacy_media_vault_at(null_root.path())
            .expect_err("null optional field must fail")
            .contains("manifest is corrupt"));

        let duplicate_root = fixture_root();
        fs::create_dir_all(vault_root(&duplicate_root)).expect("create duplicate-key vault");
        fs::write(
            vault_root(&duplicate_root).join(LEGACY_MANIFEST_FILE),
            br#"{"version":1,"providers":{"facebook":{"enabled":false,"ownerHandles":[]},"instagram":{"enabled":false,"ownerHandles":[]}},"entries":{},"entries":{},"failures":{},"roster":{}}"#,
        )
        .expect("write duplicate-key manifest");
        assert!(reconcile_legacy_media_vault_at(duplicate_root.path())
            .expect_err("duplicate manifest field must fail")
            .contains("duplicate field"));
    }

    #[test]
    fn missing_manifest_fails_for_every_existing_vault_root() {
        let absent_root = fixture_root();
        assert_eq!(
            reconcile_legacy_media_vault_at(absent_root.path()).expect("absent root has no source"),
            None
        );

        let empty_root = fixture_root();
        fs::create_dir_all(vault_root(&empty_root)).expect("create empty vault");
        assert!(reconcile_legacy_media_vault_at(empty_root.path())
            .expect_err("existing empty root without manifest must fail")
            .contains("manifest.json is missing"));

        let populated_root = fixture_root();
        fs::create_dir_all(vault_root(&populated_root)).expect("create populated vault");
        fs::write(vault_root(&populated_root).join("orphan.bin"), b"orphan").expect("write orphan");
        assert!(reconcile_legacy_media_vault_at(populated_root.path())
            .expect_err("populated root without manifest must fail")
            .contains("manifest.json is missing"));
    }

    #[cfg(unix)]
    #[test]
    fn malicious_paths_and_corrupt_entries_are_quarantined_without_following_links() {
        use std::os::unix::fs::symlink;

        let root = fixture_root();
        let facebook = provider_dir(&root, "facebook");
        let fnv_bytes = b"legacy fnv bytes";
        let fnv_path = facebook.join("fnv.jpg");
        fs::write(&fnv_path, fnv_bytes).expect("write FNV fixture");
        let mut fnv_entry = entry("facebook:fnv", "facebook", &fnv_path, fnv_bytes);
        fnv_entry
            .as_object_mut()
            .expect("FNV entry")
            .insert("contentHash".into(), json!("fnv1a-12345678-16"));

        let digest_bytes = b"digest mismatch";
        let digest_path = facebook.join("digest.jpg");
        fs::write(&digest_path, digest_bytes).expect("write digest fixture");
        let mut digest_entry = entry("facebook:digest", "facebook", &digest_path, digest_bytes);
        digest_entry
            .as_object_mut()
            .expect("digest entry")
            .insert("contentHash".into(), json!("0".repeat(64)));

        let length_bytes = b"length mismatch";
        let length_path = facebook.join("length.jpg");
        fs::write(&length_path, length_bytes).expect("write length fixture");
        let mut length_entry = entry("facebook:length", "facebook", &length_path, length_bytes);
        length_entry
            .as_object_mut()
            .expect("length entry")
            .insert("byteSize".into(), json!(1));

        let duplicate_bytes = b"duplicate path";
        let duplicate_path = facebook.join("duplicate.jpg");
        fs::write(&duplicate_path, duplicate_bytes).expect("write duplicate fixture");

        let outside = root.path().join("outside.jpg");
        fs::write(&outside, b"outside secret").expect("write outside target");
        let linked = facebook.join("linked.jpg");
        symlink(&outside, &linked).expect("create malicious symlink");

        let missing = facebook.join("missing.jpg");
        let entries = vec![
            ("facebook:fnv", fnv_entry),
            ("facebook:digest", digest_entry),
            ("facebook:length", length_entry),
            (
                "facebook:duplicate-a",
                entry(
                    "facebook:duplicate-a",
                    "facebook",
                    &duplicate_path,
                    duplicate_bytes,
                ),
            ),
            (
                "facebook:duplicate-b",
                entry(
                    "facebook:duplicate-b",
                    "facebook",
                    &duplicate_path,
                    duplicate_bytes,
                ),
            ),
            (
                "facebook:symlink",
                entry("facebook:symlink", "facebook", &linked, b"outside secret"),
            ),
            (
                "facebook:outside",
                entry("facebook:outside", "facebook", &outside, b"outside secret"),
            ),
            (
                "facebook:missing",
                entry("facebook:missing", "facebook", &missing, b"missing"),
            ),
        ];
        write_manifest(&root, &manifest(entries));
        let receipt = reconcile_legacy_media_vault_at(root.path())
            .expect("reconcile quarantine fixture")
            .expect("quarantine fixture has receipt");
        assert_eq!(receipt.attempted_entry_count, 8);
        assert_eq!(receipt.admitted_entry_count, 0);
        assert_eq!(receipt.quarantined_entry_count, 8);
        let backup = read_backup(&root, &receipt);
        assert!(reasons_for(&backup, "facebook:fnv").contains(&QuarantineReason::LegacyFnvTagged));
        assert!(reasons_for(&backup, "facebook:digest").contains(&QuarantineReason::DigestMismatch));
        assert!(reasons_for(&backup, "facebook:length").contains(&QuarantineReason::LengthMismatch));
        assert!(reasons_for(&backup, "facebook:duplicate-a").contains(&QuarantineReason::Ambiguous));
        assert!(reasons_for(&backup, "facebook:duplicate-b").contains(&QuarantineReason::Ambiguous));
        assert!(reasons_for(&backup, "facebook:symlink").contains(&QuarantineReason::Symlinked));
        assert!(reasons_for(&backup, "facebook:outside").contains(&QuarantineReason::OutOfRoot));
        assert!(reasons_for(&backup, "facebook:missing").contains(&QuarantineReason::Missing));
        assert_eq!(
            fs::read(&outside).expect("outside target remains"),
            b"outside secret"
        );
        assert!(fnv_path.exists());
        assert!(digest_path.exists());
        assert!(length_path.exists());
        assert!(duplicate_path.exists());
    }

    #[test]
    fn large_blob_is_streamed_to_the_domain_separated_content_address() {
        let root = fixture_root();
        let path = provider_dir(&root, "instagram").join("large.mp4");
        let mut file = File::create(&path).expect("create large fixture");
        let block: Vec<u8> = (0..65_536).map(|index| (index % 251) as u8).collect();
        let target_length = STREAM_BUFFER_BYTES * 3 + 17;
        let mut raw_digest = Sha256::new();
        let mut blob_digest = Sha256::new();
        blob_digest.update(BLOB_DIGEST_PREFIX);
        let mut written = 0;
        while written < target_length {
            let count = (target_length - written).min(block.len());
            file.write_all(&block[..count]).expect("write large block");
            raw_digest.update(&block[..count]);
            blob_digest.update(&block[..count]);
            written += count;
        }
        file.sync_all().expect("sync large fixture");
        drop(file);
        let expected_raw = lower_hex(&raw_digest.finalize());
        let expected_blob = lower_hex(&blob_digest.finalize());
        let value = json!({
            "id": "instagram:large",
            "provider": "instagram",
            "localPath": path.to_string_lossy(),
            "byteSize": target_length,
            "contentHash": expected_raw,
            "capturedAt": 1,
            "importSource": "meta_export",
            "mediaType": "video"
        });
        write_manifest(&root, &manifest(vec![("instagram:large", value)]));
        let receipt = reconcile_legacy_media_vault_at(root.path())
            .expect("reconcile large fixture")
            .expect("large fixture has receipt");
        assert_eq!(receipt.admitted_entry_count, 1);
        let store = RecoveryStore::open(root.path()).expect("open store");
        let blob_path = store.blob_path(&expected_blob).expect("resolve blob path");
        assert_eq!(
            fs::metadata(blob_path).expect("large blob metadata").len(),
            target_length as u64
        );
        assert!(path.exists(), "legacy large file remains in place");
    }

    #[test]
    fn restart_and_crash_recovery_are_idempotent() {
        for fault in [FaultPoint::BlobCopy, FaultPoint::BackupCommit] {
            let root = fixture_root();
            let bytes = b"crash recovery";
            let path = provider_dir(&root, "facebook").join("crash.jpg");
            fs::write(&path, bytes).expect("write crash fixture");
            write_manifest(
                &root,
                &manifest(vec![(
                    "facebook:crash",
                    entry("facebook:crash", "facebook", &path, bytes),
                )]),
            );
            assert!(reconcile_legacy_media_vault_at_with_fault(root.path(), Some(fault)).is_err());
            assert!(path.exists(), "legacy file survives injected crash");
            let resumed = reconcile_legacy_media_vault_at(root.path())
                .expect("resume reconciliation")
                .expect("resumed receipt");
            let replayed = reconcile_legacy_media_vault_at(root.path())
                .expect("restart reconciliation")
                .expect("replayed receipt");
            assert_eq!(resumed, replayed);
            assert_eq!(resumed.admitted_entry_count, 1);
        }
    }

    #[test]
    fn lost_response_returns_the_exact_durable_receipt_on_retry() {
        let root = fixture_root();
        let bytes = b"lost response";
        let path = provider_dir(&root, "instagram").join("lost.jpg");
        fs::write(&path, bytes).expect("write lost-response fixture");
        let manifest_bytes = write_manifest(
            &root,
            &manifest(vec![(
                "instagram:lost",
                entry("instagram:lost", "instagram", &path, bytes),
            )]),
        );
        assert!(reconcile_legacy_media_vault_at_with_fault(
            root.path(),
            Some(FaultPoint::ReceiptResponseLoss)
        )
        .expect_err("lost response is injected")
        .contains("lost response"));
        let source_digest = domain_digest(SOURCE_MANIFEST_DIGEST_PREFIX, &manifest_bytes);
        let store = RecoveryStore::open(root.path()).expect("open recovery store");
        let durable_bytes =
            fs::read(store.receipt_path(&source_digest)).expect("read durable receipt");
        let durable: ReconciliationReceiptV1 =
            parse_closed_json(&durable_bytes, "durable receipt").expect("parse durable receipt");
        let retried = reconcile_legacy_media_vault_at(root.path())
            .expect("retry after lost response")
            .expect("retry receipt");
        assert_eq!(retried, durable);
        assert!(path.exists(), "legacy file survives response loss");
    }

    #[test]
    fn corrupt_content_address_fails_closed_before_and_after_receipt() {
        for corrupt_before_reconciliation in [true, false] {
            let root = fixture_root();
            let bytes = b"durable proof";
            let path = provider_dir(&root, "facebook").join("durable.jpg");
            fs::write(&path, bytes).expect("write durable fixture");
            write_manifest(
                &root,
                &manifest(vec![(
                    "facebook:durable",
                    entry("facebook:durable", "facebook", &path, bytes),
                )]),
            );
            let blob_digest = domain_digest(BLOB_DIGEST_PREFIX, bytes);
            let store = RecoveryStore::open(root.path()).expect("open recovery store");
            let blob_path = store.blob_path(&blob_digest).expect("resolve blob path");

            if corrupt_before_reconciliation {
                fs::write(&blob_path, b"broken bytes!").expect("write corrupt collision");
                let error = reconcile_legacy_media_vault_at(root.path())
                    .expect_err("corrupt existing content address must fail");
                assert!(error.contains("store failed closed"));
                assert!(fs::read_dir(store.receipt_root_path())
                    .expect("read receipt directory")
                    .next()
                    .is_none());
            } else {
                reconcile_legacy_media_vault_at(root.path())
                    .expect("create reconciliation receipt")
                    .expect("fixture has a receipt");
                fs::write(&blob_path, b"broken bytes!").expect("corrupt durable blob");
                assert!(reconcile_legacy_media_vault_at(root.path())
                    .expect_err("same-length blob corruption must fail on replay")
                    .contains("blob is corrupt"));
            }
            assert!(path.exists(), "legacy file survives store corruption");
        }
    }

    #[cfg(unix)]
    #[test]
    fn source_path_replacement_is_rejected_before_receipt_commit() {
        let root = fixture_root();
        let path = provider_dir(&root, "facebook").join("replace.jpg");
        fs::write(&path, b"original bytes").expect("write original source");
        let pinned = PinnedVaultRoot::open(vault_root(&root)).expect("pin vault root");
        let relative_path = PathBuf::from("facebook/replace.jpg");
        let opened = pinned
            .open_relative(&relative_path)
            .expect("open original source");
        let observation = SourceObservation {
            relative_path,
            identity: opened.identity,
        };
        drop(opened.file);

        let replacement = provider_dir(&root, "facebook").join("replacement.tmp");
        fs::write(&replacement, b"replacement bytes").expect("write replacement source");
        fs::rename(replacement, &path).expect("replace source path");

        assert!(verify_source_observations(&pinned, &[observation])
            .expect_err("source replacement must block receipt commit")
            .contains("changed before reconciliation commit"));
        assert_eq!(
            fs::read(path).expect("replacement source remains"),
            b"replacement bytes"
        );
    }

    #[cfg(unix)]
    #[test]
    fn recovery_artifacts_stay_bound_to_the_open_library_directory() {
        use std::os::unix::fs::PermissionsExt;

        let root = fixture_root();
        let store = RecoveryStore::open(root.path()).expect("open recovery store");
        let visible_library = root.path().join("library-core");
        let moved_library = root.path().join("moved-library-core");
        fs::rename(&visible_library, &moved_library).expect("move bound Library directory");
        fs::create_dir(&visible_library).expect("create replacement Library directory");
        fs::set_permissions(&visible_library, fs::Permissions::from_mode(0o700))
            .expect("make replacement Library private");
        fs::write(visible_library.join("sentinel"), b"replacement")
            .expect("write replacement sentinel");

        let digest = "a".repeat(64);
        store
            .receipt(&digest)
            .expect("resolve bound receipt")
            .write_once(b"bound receipt")
            .expect("write through bound receipt directory");

        assert_eq!(
            fs::read(
                moved_library
                    .join(RECOVERY_DIRECTORY)
                    .join(RECEIPT_DIRECTORY)
                    .join(format!("{digest}.json")),
            )
            .expect("read receipt from moved authority directory"),
            b"bound receipt"
        );
        assert_eq!(
            fs::read(visible_library.join("sentinel")).expect("read replacement sentinel"),
            b"replacement"
        );
        assert!(!visible_library.join(RECOVERY_DIRECTORY).exists());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_artifact_symlinks_and_hardlinks_fail_closed() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        for use_hardlink in [false, true] {
            let root = fixture_root();
            let store = RecoveryStore::open(root.path()).expect("open recovery store");
            let digest = if use_hardlink {
                "b".repeat(64)
            } else {
                "c".repeat(64)
            };
            let receipt = store.receipt(&digest).expect("resolve receipt artifact");
            let outside = root.path().join(if use_hardlink {
                "hardlink-target"
            } else {
                "symlink-target"
            });
            fs::write(&outside, b"outside bytes").expect("write outside target");
            fs::set_permissions(&outside, fs::Permissions::from_mode(0o600))
                .expect("make outside target private");
            if use_hardlink {
                fs::hard_link(&outside, receipt.diagnostic_path())
                    .expect("install hardlink artifact");
            } else {
                symlink(&outside, receipt.diagnostic_path()).expect("install symlink artifact");
            }

            receipt
                .write_once(b"replacement bytes")
                .expect_err("linked artifact must fail closed");
            assert_eq!(
                fs::read(&outside).expect("read outside target"),
                b"outside bytes"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn legacy_vault_root_replacement_cannot_redirect_manifest_reads() {
        let root = fixture_root();
        let original_manifest = write_manifest(&root, &manifest(Vec::new()));
        let pinned = open_pinned_vault_root(root.path())
            .expect("open bound legacy vault")
            .expect("legacy vault exists");
        let moved_vault = root.path().join("moved-media-vault");
        fs::rename(vault_root(&root), &moved_vault).expect("move bound legacy vault");
        fs::create_dir(vault_root(&root)).expect("create replacement legacy vault");
        fs::write(
            vault_root(&root).join(LEGACY_MANIFEST_FILE),
            b"replacement manifest",
        )
        .expect("write replacement manifest");

        assert_eq!(
            read_current_manifest(&pinned)
                .expect("read bound original manifest")
                .expect("manifest remains present"),
            original_manifest
        );
        pinned
            .verify_path_identity()
            .expect("bound legacy root identity remains stable");
        assert_eq!(
            fs::read(vault_root(&root).join(LEGACY_MANIFEST_FILE))
                .expect("read replacement manifest"),
            b"replacement manifest"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_manifest_and_vault_roots_fail_closed() {
        use std::os::unix::fs::symlink;

        let manifest_root = fixture_root();
        fs::create_dir_all(vault_root(&manifest_root)).expect("create vault");
        let outside_manifest = manifest_root.path().join("outside-manifest.json");
        fs::write(
            &outside_manifest,
            serde_json::to_vec(&manifest(Vec::new())).unwrap(),
        )
        .expect("write outside manifest");
        symlink(
            &outside_manifest,
            vault_root(&manifest_root).join(LEGACY_MANIFEST_FILE),
        )
        .expect("link manifest");
        assert!(reconcile_legacy_media_vault_at(manifest_root.path())
            .expect_err("symlink manifest must fail")
            .contains("symbolic link"));

        let provider_link_root = fixture_root();
        fs::create_dir_all(vault_root(&provider_link_root)).expect("create linked-provider vault");
        let outside_provider = provider_link_root.path().join("outside-provider");
        fs::create_dir_all(&outside_provider).expect("create outside provider directory");
        let outside_file = outside_provider.join("outside.jpg");
        fs::write(&outside_file, b"outside provider bytes").expect("write outside provider file");
        symlink(
            &outside_provider,
            vault_root(&provider_link_root).join("facebook"),
        )
        .expect("link provider directory");
        let linked_entry_path = vault_root(&provider_link_root)
            .join("facebook")
            .join("outside.jpg");
        write_manifest(
            &provider_link_root,
            &manifest(vec![(
                "facebook:linked-provider",
                entry(
                    "facebook:linked-provider",
                    "facebook",
                    &linked_entry_path,
                    b"outside provider bytes",
                ),
            )]),
        );
        let linked_provider_receipt = reconcile_legacy_media_vault_at(provider_link_root.path())
            .expect("linked provider is quarantined")
            .expect("linked provider fixture has receipt");
        let linked_provider_backup = read_backup(&provider_link_root, &linked_provider_receipt);
        assert!(
            reasons_for(&linked_provider_backup, "facebook:linked-provider")
                .contains(&QuarantineReason::Symlinked)
        );
        assert_eq!(linked_provider_receipt.preserved_blob_count, 0);
        assert_eq!(
            fs::read(outside_file).expect("outside provider file remains"),
            b"outside provider bytes"
        );

        let root_link = fixture_root();
        let outside_vault = root_link.path().join("outside-vault");
        fs::create_dir_all(&outside_vault).expect("create outside vault");
        symlink(&outside_vault, vault_root(&root_link)).expect("link vault root");
        assert!(reconcile_legacy_media_vault_at(root_link.path())
            .expect_err("symlink root must fail")
            .contains("not an ordinary directory"));
    }
}
