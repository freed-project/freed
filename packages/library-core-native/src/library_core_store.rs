use crate::{
    upsert_item, FollowerOverlayReplayReceipt, LibraryCoreJournal, VerifiedFollowerAnchor,
};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::sync::Arc;

#[cfg(unix)]
use crate::library_core_bound_sqlite_vfs::BoundSqliteDatabase;

const LIBRARY_DIRECTORY: &str = "library-core";
const LIBRARY_FILE: &str = "library-core.sqlite";
const RESET_LOCK_FILE: &str = "migration-reset.lock";
const MAX_ITEM_BYTES: usize = 4 * 1_024 * 1_024;
const MAX_SHELL_BYTES: usize = 16 * 1_024 * 1_024;
const MAX_IMPORT_BATCH: usize = 1_000;
const MAX_IMPORT_PAGE_BYTES: usize = 2_097_152;
const MAXIMUM_ITEM_COUNT: i64 = 1_000_000;

pub type LibraryCoreStoreResult<T> = Result<T, LibraryCoreStoreError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryCoreStoreError(String);

impl std::fmt::Display for LibraryCoreStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for LibraryCoreStoreError {}

impl From<String> for LibraryCoreStoreError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<rusqlite::Error> for LibraryCoreStoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self(value.to_string())
    }
}

impl From<std::io::Error> for LibraryCoreStoreError {
    fn from(value: std::io::Error) -> Self {
        Self(value.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCoreStoreStatus {
    pub active: bool,
    pub revision: i64,
    pub expected_item_count: i64,
    pub imported_item_count: i64,
    pub source_generation: i64,
    pub source_revision: i64,
    pub source_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryCoreCheckpointReference {
    pub object_key: String,
    pub content_digest: String,
    pub transport_object_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginLibraryCoreImport {
    pub source_generation: i64,
    pub source_revision: i64,
    pub source_digest: String,
    pub source_checkpoint: Option<LibraryCoreCheckpointReference>,
    pub expected_item_count: i64,
    pub shell_json: String,
    pub started_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryCoreImportItem {
    pub item_json: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeLibraryCoreImportReceipt {
    pub status: LibraryCoreStoreStatus,
    pub overlay_replay: Option<FollowerOverlayReplayReceipt>,
    pub overlay_replay_pending: bool,
}

#[derive(Debug)]
struct StagedImport {
    source_generation: i64,
    source_revision: i64,
    source_digest: String,
    source_checkpoint_object_key: Option<String>,
    source_checkpoint_content_digest: Option<String>,
    source_checkpoint_transport_object_id: Option<String>,
    expected_item_count: i64,
    imported_item_count: i64,
    shell_json: String,
    started_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct LibraryCoreStore {
    root: PathBuf,
    #[cfg(unix)]
    bound: Option<Arc<BoundStoreRoot>>,
}

#[cfg(unix)]
#[derive(Debug)]
struct BoundStoreRoot {
    library_directory: OwnedFd,
    database: BoundSqliteDatabase,
}

impl LibraryCoreStore {
    pub fn open(root: impl AsRef<Path>) -> LibraryCoreStoreResult<Self> {
        let root = root.as_ref().to_path_buf();
        create_private_directory(&root.join(LIBRARY_DIRECTORY))?;
        drop(
            LibraryCoreJournal::open(&database_path(&root))
                .map_err(|error| LibraryCoreStoreError(error.to_string()))?,
        );
        Ok(Self {
            root,
            #[cfg(unix)]
            bound: None,
        })
    }

    #[cfg(unix)]
    pub(crate) fn open_bound_directory(library_directory: OwnedFd) -> LibraryCoreStoreResult<Self> {
        let database = BoundSqliteDatabase::from_directory(library_directory.try_clone()?)?;
        let bound = Arc::new(BoundStoreRoot {
            library_directory,
            database,
        });
        drop(
            LibraryCoreJournal::open_bound(&bound.database)
                .map_err(|error| LibraryCoreStoreError(error.to_string()))?,
        );
        Ok(Self {
            root: PathBuf::from("."),
            bound: Some(bound),
        })
    }

    pub fn status(&self) -> LibraryCoreStoreResult<Option<LibraryCoreStoreStatus>> {
        let connection = self.connect()?;
        connection
            .query_row(
                "SELECT active, revision, expectedItemCount, importedItemCount,
                        sourceGeneration, sourceRevision, sourceDigest
                 FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| {
                    Ok(LibraryCoreStoreStatus {
                        active: row.get::<_, i64>(0)? == 1,
                        revision: row.get(1)?,
                        expected_item_count: row.get(2)?,
                        imported_item_count: row.get(3)?,
                        source_generation: row.get(4)?,
                        source_revision: row.get(5)?,
                        source_digest: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn begin_import(&self, request: BeginLibraryCoreImport) -> LibraryCoreStoreResult<()> {
        if !valid_hex_digest(&request.source_digest)
            || !(0..=MAXIMUM_ITEM_COUNT).contains(&request.expected_item_count)
            || request.source_generation < 0
            || request.source_revision < 0
            || request.started_at_ms < 0
        {
            return Err(LibraryCoreStoreError(
                "invalid SQLite Library import identity".into(),
            ));
        }
        if let Some(reference) = &request.source_checkpoint {
            if reference.object_key.is_empty()
                || reference.object_key.len() > 4_096
                || !valid_hex_digest(&reference.content_digest)
                || reference.transport_object_id.is_empty()
                || reference.transport_object_id.len() > 4_096
            {
                return Err(LibraryCoreStoreError(
                    "invalid SQLite Library import identity".into(),
                ));
            }
        }
        validate_json_object(&request.shell_json, MAX_SHELL_BYTES)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM library_core_import_item_stage;", [])?;
        let checkpoint = request.source_checkpoint;
        transaction.execute(
            "INSERT INTO library_core_import_stage (
               singletonId, sourceGeneration, sourceRevision, sourceDigest,
               sourceCheckpointObjectKey, sourceCheckpointContentDigest,
               sourceCheckpointTransportObjectId, expectedItemCount,
               importedItemCount, shellJson, startedAtMs
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)
             ON CONFLICT(singletonId) DO UPDATE SET
               sourceGeneration = excluded.sourceGeneration,
               sourceRevision = excluded.sourceRevision,
               sourceDigest = excluded.sourceDigest,
               sourceCheckpointObjectKey = excluded.sourceCheckpointObjectKey,
               sourceCheckpointContentDigest = excluded.sourceCheckpointContentDigest,
               sourceCheckpointTransportObjectId = excluded.sourceCheckpointTransportObjectId,
               expectedItemCount = excluded.expectedItemCount,
               importedItemCount = 0,
               shellJson = excluded.shellJson,
               startedAtMs = excluded.startedAtMs;",
            params![
                request.source_generation,
                request.source_revision,
                request.source_digest,
                checkpoint.as_ref().map(|value| &value.object_key),
                checkpoint.as_ref().map(|value| &value.content_digest),
                checkpoint.as_ref().map(|value| &value.transport_object_id),
                request.expected_item_count,
                request.shell_json,
                request.started_at_ms,
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn append_import_page(
        &self,
        items: &[LibraryCoreImportItem],
    ) -> LibraryCoreStoreResult<i64> {
        if items.is_empty() || items.len() > MAX_IMPORT_BATCH {
            return Err(LibraryCoreStoreError(
                "SQLite Library import batch must contain 1 through 1,000 items".into(),
            ));
        }
        let page_bytes = items.iter().try_fold(0usize, |total, item| {
            total.checked_add(item.item_json.len()).ok_or_else(|| {
                LibraryCoreStoreError("SQLite Library import page is too large".into())
            })
        })?;
        if page_bytes > MAX_IMPORT_PAGE_BYTES {
            return Err(LibraryCoreStoreError(
                "SQLite Library import page is too large".into(),
            ));
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        for item in items {
            if item.updated_at_ms < 0 {
                return Err(LibraryCoreStoreError(
                    "SQLite Library import time is invalid".into(),
                ));
            }
            let parsed = validate_json_object(&item.item_json, MAX_ITEM_BYTES)?;
            let global_id = string_at(&parsed, &["globalId"])
                .filter(|value| !value.is_empty() && value.len() <= 4_096)
                .ok_or_else(|| {
                    LibraryCoreStoreError("feed item globalId is missing or invalid".into())
                })?;
            transaction.execute(
                "INSERT INTO library_core_import_item_stage (
                   globalId, itemJson, updatedAtMs
                 ) VALUES (?1, ?2, ?3)
                 ON CONFLICT(globalId) DO UPDATE SET
                   itemJson = excluded.itemJson,
                   updatedAtMs = excluded.updatedAtMs;",
                params![global_id, item.item_json, item.updated_at_ms],
            )?;
        }
        let count = transaction.query_row(
            "SELECT COUNT(*) FROM library_core_import_item_stage;",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        let expected_item_count = transaction
            .query_row(
                "SELECT expectedItemCount FROM library_core_import_stage WHERE singletonId = 1;",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| {
                LibraryCoreStoreError("SQLite Library has no active staged import".into())
            })?;
        if count > expected_item_count || count > MAXIMUM_ITEM_COUNT {
            return Err(LibraryCoreStoreError(
                "SQLite Library import exceeds its declared item count".into(),
            ));
        }
        let updated = transaction.execute(
            "UPDATE library_core_import_stage SET importedItemCount = ?1
             WHERE singletonId = 1;",
            [count],
        )?;
        if updated != 1 {
            return Err(LibraryCoreStoreError(
                "SQLite Library has no active staged import".into(),
            ));
        }
        transaction.commit()?;
        Ok(count)
    }

    pub fn finalize_import(
        &self,
        activated_at_ms: i64,
        follower_anchor: Option<&VerifiedFollowerAnchor>,
    ) -> LibraryCoreStoreResult<FinalizeLibraryCoreImportReceipt> {
        self.finalize_import_with_overlay_replay(activated_at_ms, follower_anchor, |journal| {
            journal
                .replay_pending_follower_overlay()
                .map_err(|error| LibraryCoreStoreError(error.to_string()))
        })
    }

    fn finalize_import_with_overlay_replay<F>(
        &self,
        activated_at_ms: i64,
        follower_anchor: Option<&VerifiedFollowerAnchor>,
        mut replay_overlay: F,
    ) -> LibraryCoreStoreResult<FinalizeLibraryCoreImportReceipt>
    where
        F: FnMut(&mut LibraryCoreJournal) -> LibraryCoreStoreResult<FollowerOverlayReplayReceipt>,
    {
        if activated_at_ms < 0 {
            return Err(LibraryCoreStoreError(
                "SQLite Library activation time is invalid".into(),
            ));
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let staged: StagedImport = transaction
            .query_row(
                "SELECT sourceGeneration, sourceRevision, sourceDigest,
                        sourceCheckpointObjectKey, sourceCheckpointContentDigest,
                        sourceCheckpointTransportObjectId,
                        expectedItemCount, importedItemCount, shellJson, startedAtMs
                 FROM library_core_import_stage WHERE singletonId = 1;",
                [],
                |row| {
                    Ok(StagedImport {
                        source_generation: row.get(0)?,
                        source_revision: row.get(1)?,
                        source_digest: row.get(2)?,
                        source_checkpoint_object_key: row.get(3)?,
                        source_checkpoint_content_digest: row.get(4)?,
                        source_checkpoint_transport_object_id: row.get(5)?,
                        expected_item_count: row.get(6)?,
                        imported_item_count: row.get(7)?,
                        shell_json: row.get(8)?,
                        started_at_ms: row.get(9)?,
                    })
                },
            )
            .map_err(|error| {
                LibraryCoreStoreError(format!(
                    "SQLite Library has no complete staged import: {error}"
                ))
            })?;
        let actual = transaction.query_row(
            "SELECT COUNT(*) FROM library_core_import_item_stage;",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        if staged.expected_item_count != staged.imported_item_count
            || staged.expected_item_count != actual
        {
            return Err(LibraryCoreStoreError(format!(
                "SQLite Library import count mismatch: expected {}, imported {}, actual {actual}",
                staged.expected_item_count, staged.imported_item_count
            )));
        }
        if let Err(error) = require_integrity(&transaction) {
            return Err(LibraryCoreStoreError(format!(
                "SQLite Library integrity check failed: {error}"
            )));
        }
        let mut status = LibraryCoreStoreStatus {
            active: true,
            revision: 1,
            expected_item_count: staged.expected_item_count,
            imported_item_count: staged.expected_item_count,
            source_generation: staged.source_generation,
            source_revision: staged.source_revision,
            source_digest: staged.source_digest.clone(),
        };
        transaction.execute("DELETE FROM library_core_feed_items;", [])?;
        {
            let mut statement = transaction.prepare(
                "SELECT itemJson, updatedAtMs
                 FROM library_core_import_item_stage
                 ORDER BY globalId COLLATE BINARY;",
            )?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let item_json = row.get::<_, String>(0)?;
                let updated_at_ms = row.get::<_, i64>(1)?;
                upsert_item(&transaction, &item_json, updated_at_ms)
                    .map_err(LibraryCoreStoreError)?;
            }
        }
        transaction.execute(
            "INSERT INTO library_core_desktop_state (
               singletonId, active, revision, sourceGeneration, sourceRevision,
               sourceDigest, expectedItemCount, importedItemCount, shellJson,
               startedAtMs, activatedAtMs
             ) VALUES (1, 1, 1, ?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)
             ON CONFLICT(singletonId) DO UPDATE SET
               active = 1,
               revision = 1,
               sourceGeneration = excluded.sourceGeneration,
               sourceRevision = excluded.sourceRevision,
               sourceDigest = excluded.sourceDigest,
               expectedItemCount = excluded.expectedItemCount,
               importedItemCount = excluded.importedItemCount,
               shellJson = excluded.shellJson,
               startedAtMs = excluded.startedAtMs,
               activatedAtMs = excluded.activatedAtMs;",
            params![
                staged.source_generation,
                staged.source_revision,
                staged.source_digest,
                staged.expected_item_count,
                staged.shell_json,
                staged.started_at_ms,
                activated_at_ms,
            ],
        )?;
        if let Some(anchor) = follower_anchor {
            if anchor.authority.epoch != staged.source_generation
                || anchor.remote_ingest_sequence != staged.source_revision
                || staged.source_checkpoint_object_key.as_deref()
                    != Some(anchor.manifest_object_key.as_str())
                || staged.source_checkpoint_content_digest.as_deref()
                    != Some(anchor.manifest_content_digest.as_str())
                || staged.source_checkpoint_transport_object_id.as_deref()
                    != Some(anchor.manifest_transport_object_id.as_str())
            {
                return Err(LibraryCoreStoreError(
                    "SQLite Library follower anchor does not match the staged checkpoint".into(),
                ));
            }
            LibraryCoreJournal::install_follower_anchor_in_transaction(&transaction, anchor)
                .map_err(|error| {
                    LibraryCoreStoreError(format!(
                        "SQLite Library could not atomically install follower anchor: {error}"
                    ))
                })?;
        }
        transaction.execute("DELETE FROM library_core_import_item_stage;", [])?;
        transaction.execute("DELETE FROM library_core_import_stage;", [])?;
        transaction.commit()?;

        #[cfg(unix)]
        let overlay_replay = if let Some(bound) = &self.bound {
            LibraryCoreJournal::open_bound(&bound.database)
                .ok()
                .and_then(|mut journal| replay_overlay(&mut journal).ok())
        } else {
            LibraryCoreJournal::open(&database_path(&self.root))
                .ok()
                .and_then(|mut journal| replay_overlay(&mut journal).ok())
        };
        #[cfg(not(unix))]
        let overlay_replay = LibraryCoreJournal::open(&database_path(&self.root))
            .ok()
            .and_then(|mut journal| replay_overlay(&mut journal).ok());
        let overlay_replay_pending = overlay_replay.is_none();
        if overlay_replay
            .as_ref()
            .is_some_and(|receipt| receipt.revision_advanced)
        {
            status.revision = 2;
        }
        Ok(FinalizeLibraryCoreImportReceipt {
            status,
            overlay_replay,
            overlay_replay_pending,
        })
    }

    pub(crate) fn connect(&self) -> LibraryCoreStoreResult<Connection> {
        #[cfg(unix)]
        let connection = if let Some(bound) = &self.bound {
            bound.database.open(
                OpenFlags::SQLITE_OPEN_READ_WRITE
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                    | OpenFlags::SQLITE_OPEN_NOFOLLOW
                    | OpenFlags::SQLITE_OPEN_EXRESCODE,
            )?
        } else {
            Connection::open(database_path(&self.root))?
        };
        #[cfg(not(unix))]
        let connection = Connection::open(database_path(&self.root))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA trusted_schema = OFF;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(connection)
    }

    #[cfg(unix)]
    pub(crate) fn open_bound_journal(&self) -> LibraryCoreStoreResult<LibraryCoreJournal> {
        let bound = self.require_bound()?;
        LibraryCoreJournal::open_bound(&bound.database)
            .map_err(|error| LibraryCoreStoreError(error.to_string()))
    }

    #[cfg(unix)]
    pub fn clear_bound_library(&self) -> LibraryCoreStoreResult<()> {
        let bound = self.require_bound()?;
        let _reset_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), RESET_LOCK_FILE)?;
        self.clear_bound_library_locked(bound)
    }

    #[cfg(unix)]
    fn clear_bound_library_locked(&self, bound: &BoundStoreRoot) -> LibraryCoreStoreResult<()> {
        for leaf in [
            LIBRARY_FILE,
            "library-core.sqlite-wal",
            "library-core.sqlite-shm",
            "library-core.sqlite-journal",
            "library-core.sqlite.restore-staging",
            "library-core.sqlite.pre-restore",
        ] {
            match unlink_file_at(bound.library_directory.as_raw_fd(), leaf) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    #[cfg(unix)]
    pub fn clear_bound_all(&self) -> LibraryCoreStoreResult<()> {
        self.clear_bound_library()
    }

    #[cfg(unix)]
    fn require_bound(&self) -> LibraryCoreStoreResult<&BoundStoreRoot> {
        self.bound
            .as_deref()
            .ok_or_else(|| LibraryCoreStoreError("descriptor-bound Library root is absent".into()))
    }
}

fn database_path(root: &Path) -> PathBuf {
    root.join(LIBRARY_DIRECTORY).join(LIBRARY_FILE)
}

#[cfg(unix)]
struct BoundFileLock {
    file: File,
}

#[cfg(unix)]
impl BoundFileLock {
    fn acquire(directory: RawFd, name: &str) -> LibraryCoreStoreResult<Self> {
        let file = open_private_lock_file_at(directory, name)?;
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::WouldBlock {
                return Err(LibraryCoreStoreError(
                    "SQLite Library reset is already in progress".into(),
                ));
            }
            return Err(error.into());
        }
        Ok(Self { file })
    }
}

#[cfg(unix)]
impl Drop for BoundFileLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[cfg(unix)]
fn open_private_lock_file_at(parent: RawFd, name: &str) -> LibraryCoreStoreResult<File> {
    let name = std::ffi::CString::new(name)
        .map_err(|_| LibraryCoreStoreError("invalid bound lock name".into()))?;
    let descriptor = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            0o600,
        )
    };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let file = unsafe { File::from_raw_fd(descriptor) };
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o7777 != 0o600
        || metadata.nlink() != 1
    {
        return Err(LibraryCoreStoreError(
            "descriptor-bound lock file is not private".into(),
        ));
    }
    Ok(file)
}

#[cfg(unix)]
fn unlink_file_at(parent: RawFd, name: &str) -> std::io::Result<()> {
    let name = std::ffi::CString::new(name)
        .map_err(|_| std::io::Error::other("invalid bound file name"))?;
    if unsafe { libc::unlinkat(parent, name.as_ptr(), 0) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;

    if path.exists() {
        return Ok(());
    }
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}

fn valid_hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_json_object(value: &str, maximum_bytes: usize) -> LibraryCoreStoreResult<Value> {
    if value.len() < 2 || value.len() > maximum_bytes {
        return Err(LibraryCoreStoreError(
            "JSON payload exceeds its storage bound".into(),
        ));
    }
    let parsed = serde_json::from_str::<Value>(value)
        .map_err(|error| LibraryCoreStoreError(error.to_string()))?;
    if !parsed.is_object() {
        return Err(LibraryCoreStoreError(
            "JSON payload must be an object".into(),
        ));
    }
    Ok(parsed)
}

fn string_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn require_integrity(connection: &Connection) -> LibraryCoreStoreResult<()> {
    let integrity =
        connection.query_row("PRAGMA integrity_check;", [], |row| row.get::<_, String>(0))?;
    if integrity != "ok" {
        return Err(LibraryCoreStoreError(integrity));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_store() -> (tempfile::TempDir, LibraryCoreStore) {
        let directory = tempfile::TempDir::new().expect("create store root");
        let store = LibraryCoreStore::open(directory.path()).expect("open store");
        store
            .begin_import(BeginLibraryCoreImport {
                source_generation: 7,
                source_revision: 11,
                source_digest: "ab".repeat(32),
                source_checkpoint: None,
                expected_item_count: 1,
                shell_json: "{}".into(),
                started_at_ms: 100,
            })
            .expect("begin import");
        store
            .append_import_page(&[LibraryCoreImportItem {
                item_json: r#"{"globalId":"item-1","platform":"rss","content":{"text":"hello"}}"#
                    .into(),
                updated_at_ms: 101,
            }])
            .expect("append import");
        store.finalize_import(102, None).expect("finalize import");
        (directory, store)
    }

    #[test]
    fn imports_into_a_fresh_store_and_returns_an_exact_status() {
        let (_directory, store) = active_store();
        assert_eq!(
            store.status().expect("read status"),
            Some(LibraryCoreStoreStatus {
                active: true,
                revision: 1,
                expected_item_count: 1,
                imported_item_count: 1,
                source_generation: 7,
                source_revision: 11,
                source_digest: "ab".repeat(32),
            })
        );
    }

    #[test]
    fn import_count_mismatch_never_activates_the_staged_generation() {
        let directory = tempfile::TempDir::new().expect("create store root");
        let store = LibraryCoreStore::open(directory.path()).expect("open store");
        store
            .begin_import(BeginLibraryCoreImport {
                source_generation: 1,
                source_revision: 2,
                source_digest: "cd".repeat(32),
                source_checkpoint: None,
                expected_item_count: 2,
                shell_json: "{}".into(),
                started_at_ms: 10,
            })
            .expect("begin import");
        store
            .append_import_page(&[LibraryCoreImportItem {
                item_json: r#"{"globalId":"item-1"}"#.into(),
                updated_at_ms: 11,
            }])
            .expect("append import");
        assert!(store.finalize_import(12, None).is_err());
        assert_eq!(store.status().expect("status"), None);
    }

    #[test]
    fn an_import_page_cannot_exceed_the_declared_item_count() {
        let directory = tempfile::TempDir::new().expect("create store root");
        let store = LibraryCoreStore::open(directory.path()).expect("open store");
        store
            .begin_import(BeginLibraryCoreImport {
                source_generation: 1,
                source_revision: 2,
                source_digest: "cd".repeat(32),
                source_checkpoint: None,
                expected_item_count: 1,
                shell_json: "{}".into(),
                started_at_ms: 10,
            })
            .expect("begin import");
        let error = store
            .append_import_page(&[
                LibraryCoreImportItem {
                    item_json: r#"{"globalId":"item-1"}"#.into(),
                    updated_at_ms: 11,
                },
                LibraryCoreImportItem {
                    item_json: r#"{"globalId":"item-2"}"#.into(),
                    updated_at_ms: 11,
                },
            ])
            .expect_err("reject oversized staged generation");
        assert_eq!(
            error.to_string(),
            "SQLite Library import exceeds its declared item count"
        );
        assert_eq!(
            store
                .append_import_page(&[LibraryCoreImportItem {
                    item_json: r#"{"globalId":"item-1"}"#.into(),
                    updated_at_ms: 12,
                }])
                .expect("append exact declared count"),
            1
        );
        assert!(store.finalize_import(13, None).is_ok());
    }

    #[test]
    fn an_import_page_has_one_aggregate_byte_bound() {
        let directory = tempfile::TempDir::new().expect("create store root");
        let store = LibraryCoreStore::open(directory.path()).expect("open store");
        store
            .begin_import(BeginLibraryCoreImport {
                source_generation: 1,
                source_revision: 2,
                source_digest: "cd".repeat(32),
                source_checkpoint: None,
                expected_item_count: 9,
                shell_json: "{}".into(),
                started_at_ms: 10,
            })
            .expect("begin import");
        let content = "x".repeat(4 * 1_024 * 1_024 - 128);
        let items = (0..9)
            .map(|index| LibraryCoreImportItem {
                item_json: format!(
                    r#"{{"globalId":"item-{index}","content":{{"text":"{content}"}}}}"#
                ),
                updated_at_ms: 11,
            })
            .collect::<Vec<_>>();
        let error = store
            .append_import_page(&items)
            .expect_err("reject aggregate page bytes");
        assert_eq!(error.to_string(), "SQLite Library import page is too large");
    }

    #[test]
    fn committed_activation_reports_pending_overlay_recovery_without_failing() {
        let directory = tempfile::TempDir::new().expect("create store root");
        let store = LibraryCoreStore::open(directory.path()).expect("open store");
        store
            .begin_import(BeginLibraryCoreImport {
                source_generation: 1,
                source_revision: 2,
                source_digest: "cd".repeat(32),
                source_checkpoint: None,
                expected_item_count: 1,
                shell_json: "{}".into(),
                started_at_ms: 10,
            })
            .expect("begin import");
        store
            .append_import_page(&[LibraryCoreImportItem {
                item_json: r#"{"globalId":"item-1"}"#.into(),
                updated_at_ms: 11,
            }])
            .expect("append import");
        let receipt = store
            .finalize_import_with_overlay_replay(12, None, |_| {
                Err(LibraryCoreStoreError("forced replay failure".into()))
            })
            .expect("activation remains successful");
        assert!(receipt.status.active);
        assert_eq!(receipt.overlay_replay, None);
        assert!(receipt.overlay_replay_pending);
        assert!(store.status().expect("status").is_some());
    }

    #[test]
    fn status_has_a_bounded_stable_json_shape() {
        let (_directory, store) = active_store();
        let status = store.status().expect("read status").expect("active status");
        assert_eq!(
            serde_json::to_value(status).expect("serialize status"),
            serde_json::json!({
                "active": true,
                "revision": 1,
                "expectedItemCount": 1,
                "importedItemCount": 1,
                "sourceGeneration": 7,
                "sourceRevision": 11,
                "sourceDigest": "ab".repeat(32),
            })
        );
    }
}
