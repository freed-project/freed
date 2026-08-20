use crate::{
    upsert_item, FollowerOverlayReplayReceipt, LibraryCoreJournal, VerifiedFollowerAnchor,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

const LIBRARY_DIRECTORY: &str = "library-core";
const LIBRARY_FILE: &str = "library-core.sqlite";
const BACKUP_DIRECTORY: &str = "library-backups";
const BACKUP_LOCK_FILE: &str = "backup.lock";
const MAX_ITEM_BYTES: usize = 4 * 1_024 * 1_024;
const MAX_SHELL_BYTES: usize = 16 * 1_024 * 1_024;
const MAX_IMPORT_BATCH: usize = 1_000;
const MAX_IMPORT_PAGE_BYTES: usize = 2_097_152;
const MAXIMUM_ITEM_COUNT: i64 = 1_000_000;
const RETAINED_BACKUP_COUNT: i64 = 24;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCoreBackupReceipt {
    pub backup_id: String,
    pub file_name: String,
    pub created_at_ms: i64,
    pub revision: i64,
    pub item_count: i64,
    pub reason: String,
    pub byte_length: u64,
    pub sha256: String,
    pub retention_pending: bool,
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
}

pub struct LibraryCoreBackupOperationGuard {
    _lock: fslock::LockFile,
}

impl LibraryCoreBackupOperationGuard {
    pub fn acquire(root: impl AsRef<Path>) -> LibraryCoreStoreResult<Self> {
        let library_directory = root.as_ref().join(LIBRARY_DIRECTORY);
        create_private_directory(&library_directory)?;
        Ok(Self {
            _lock: acquire_backup_lock(&library_directory)?,
        })
    }
}

impl LibraryCoreStore {
    pub fn open(root: impl AsRef<Path>) -> LibraryCoreStoreResult<Self> {
        let root = root.as_ref().to_path_buf();
        create_private_directory(&root.join(LIBRARY_DIRECTORY))?;
        drop(
            LibraryCoreJournal::open(&database_path(&root))
                .map_err(|error| LibraryCoreStoreError(error.to_string()))?,
        );
        Ok(Self { root })
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

    pub fn create_backup(
        &self,
        created_at_ms: i64,
        reason: &str,
    ) -> LibraryCoreStoreResult<LibraryCoreBackupReceipt> {
        self.create_backup_with_hooks(
            created_at_ms,
            reason,
            |connection, destination| {
                connection.execute("VACUUM INTO ?1;", [destination.to_string_lossy().as_ref()])?;
                Ok(())
            },
            || Ok(()),
        )
    }

    #[cfg(test)]
    fn create_backup_with_after_copy<F>(
        &self,
        created_at_ms: i64,
        reason: &str,
        mut after_copy: F,
    ) -> LibraryCoreStoreResult<LibraryCoreBackupReceipt>
    where
        F: FnMut() -> LibraryCoreStoreResult<()>,
    {
        self.create_backup_with_hooks(
            created_at_ms,
            reason,
            |connection, destination| {
                connection.execute("VACUUM INTO ?1;", [destination.to_string_lossy().as_ref()])?;
                Ok(())
            },
            &mut after_copy,
        )
    }

    fn create_backup_with_hooks<C, F>(
        &self,
        created_at_ms: i64,
        reason: &str,
        mut copy_backup: C,
        mut after_copy: F,
    ) -> LibraryCoreStoreResult<LibraryCoreBackupReceipt>
    where
        C: FnMut(&Connection, &Path) -> LibraryCoreStoreResult<()>,
        F: FnMut() -> LibraryCoreStoreResult<()>,
    {
        if created_at_ms < 0 {
            return Err(LibraryCoreStoreError(
                "invalid SQLite Library backup time".into(),
            ));
        }
        if reason != "auto" && reason != "manual" {
            return Err(LibraryCoreStoreError(
                "invalid SQLite Library backup reason".into(),
            ));
        }
        let backup_directory = self.root.join(BACKUP_DIRECTORY);
        create_private_directory(&backup_directory)?;
        let _backup_lock = LibraryCoreBackupOperationGuard::acquire(&self.root)?;
        let backup_id = format!("sqlite-{created_at_ms}");
        let file_name = format!("{backup_id}.sqlite");
        let destination = backup_directory.join(&file_name);
        if destination.exists() {
            return Err(LibraryCoreStoreError(
                "SQLite Library backup already exists".into(),
            ));
        }
        let connection = self.connect()?;
        require_active(&connection)?;
        if let Err(error) = copy_backup(&connection, &destination) {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
        let prepared = (|| -> LibraryCoreStoreResult<(i64, i64, u64, String)> {
            after_copy()?;
            let check = Connection::open(&destination)?;
            require_integrity(&check).map_err(|error| {
                LibraryCoreStoreError(format!("SQLite Library backup integrity failed: {error}"))
            })?;
            let (revision, item_count) = check.query_row(
                "SELECT
                   (SELECT revision FROM library_core_desktop_state WHERE singletonId = 1),
                   (SELECT COUNT(*) FROM library_core_feed_items WHERE deletedAt IS NULL);",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )?;
            let byte_length = fs::metadata(&destination)?.len();
            let sha256 = sha256_file(&destination)?;
            Ok((revision, item_count, byte_length, sha256))
        })();
        let (revision, item_count, byte_length, sha256) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                let _ = fs::remove_file(&destination);
                return Err(error);
            }
        };
        let byte_length_i64 = match i64::try_from(byte_length) {
            Ok(value) => value,
            Err(_) => {
                let _ = fs::remove_file(&destination);
                return Err(LibraryCoreStoreError("backup is too large".into()));
            }
        };
        let inserted = connection.execute(
            "INSERT INTO library_core_desktop_backups (
               backupId, createdAtMs, revision, itemCount, reason, fileName, byteLength, sha256
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);",
            params![
                backup_id,
                created_at_ms,
                revision,
                item_count,
                reason,
                file_name,
                byte_length_i64,
                sha256,
            ],
        );
        match inserted {
            Ok(1) => {}
            Ok(_) => {
                let _ = fs::remove_file(&destination);
                return Err(LibraryCoreStoreError(
                    "SQLite Library backup metadata was not stored".into(),
                ));
            }
            Err(error) => {
                let _ = fs::remove_file(&destination);
                return Err(error.into());
            }
        }
        let expired = (|| -> rusqlite::Result<Vec<String>> {
            let mut statement = connection.prepare(
                "SELECT fileName FROM library_core_desktop_backups
                 WHERE backupId != ?1
                 ORDER BY createdAtMs DESC, backupId DESC LIMIT -1 OFFSET ?2;",
            )?;
            let files = statement
                .query_map(params![backup_id, RETAINED_BACKUP_COUNT - 1], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(files)
        })();
        let mut retention_pending = expired.is_err();
        for expired_file in expired.unwrap_or_default() {
            match fs::remove_file(backup_directory.join(&expired_file)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => {
                    retention_pending = true;
                    continue;
                }
            }
            if connection
                .execute(
                    "DELETE FROM library_core_desktop_backups WHERE fileName = ?1;",
                    [&expired_file],
                )
                .is_err()
            {
                retention_pending = true;
            }
        }
        Ok(LibraryCoreBackupReceipt {
            backup_id,
            file_name,
            created_at_ms,
            revision,
            item_count,
            reason: reason.to_string(),
            byte_length,
            sha256,
            retention_pending,
        })
    }

    fn connect(&self) -> LibraryCoreStoreResult<Connection> {
        let connection = Connection::open(database_path(&self.root))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA trusted_schema = OFF;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(connection)
    }
}

fn database_path(root: &Path) -> PathBuf {
    root.join(LIBRARY_DIRECTORY).join(LIBRARY_FILE)
}

fn acquire_backup_lock(directory: &Path) -> LibraryCoreStoreResult<fslock::LockFile> {
    let mut lock = fslock::LockFile::open(&directory.join(BACKUP_LOCK_FILE))?;
    if !lock.try_lock_with_pid()? {
        return Err(LibraryCoreStoreError(
            "SQLite Library backup operation is already in progress".into(),
        ));
    }
    Ok(lock)
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

fn require_active(connection: &Connection) -> LibraryCoreStoreResult<()> {
    let active = connection
        .query_row(
            "SELECT active FROM library_core_desktop_state WHERE singletonId = 1;",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if active != Some(1) {
        return Err(LibraryCoreStoreError("SQLite Library is not active".into()));
    }
    Ok(())
}

fn require_integrity(connection: &Connection) -> LibraryCoreStoreResult<()> {
    let integrity =
        connection.query_row("PRAGMA integrity_check;", [], |row| row.get::<_, String>(0))?;
    if integrity != "ok" {
        return Err(LibraryCoreStoreError(integrity));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> LibraryCoreStoreResult<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1_024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(crate::lower_hex(&digest.finalize()))
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
    fn backup_receipt_binds_exact_closed_bytes_and_library_counts() {
        let (directory, store) = active_store();
        let receipt = store.create_backup(200, "manual").expect("create backup");
        assert_eq!(receipt.backup_id, "sqlite-200");
        assert_eq!(receipt.revision, 1);
        assert_eq!(receipt.item_count, 1);
        assert!(receipt.byte_length > 0);
        assert_eq!(receipt.sha256.len(), 64);
        let path = directory
            .path()
            .join(BACKUP_DIRECTORY)
            .join(receipt.file_name);
        assert_eq!(sha256_file(&path).expect("hash backup"), receipt.sha256);
        let check = Connection::open(path).expect("open closed backup");
        require_integrity(&check).expect("backup integrity");
    }

    #[test]
    fn backup_metadata_uses_the_revision_captured_in_the_closed_bytes() {
        let (directory, store) = active_store();
        let source_path = database_path(directory.path());
        let receipt = store
            .create_backup_with_after_copy(210, "manual", || {
                let source = Connection::open(&source_path)?;
                source.execute(
                    "UPDATE library_core_desktop_state SET revision = 2 WHERE singletonId = 1;",
                    [],
                )?;
                Ok(())
            })
            .expect("create backup across source revision advance");
        assert_eq!(receipt.revision, 1);
        let connection = store.connect().expect("open source");
        let (stored_revision, live_revision): (i64, i64) = connection
            .query_row(
                "SELECT
                   (SELECT revision FROM library_core_desktop_backups WHERE backupId = ?1),
                   (SELECT revision FROM library_core_desktop_state WHERE singletonId = 1);",
                [&receipt.backup_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read exact backup identity");
        assert_eq!(stored_revision, receipt.revision);
        assert_eq!(live_revision, 2);
    }

    #[test]
    fn retention_failure_keeps_metadata_visible_for_a_later_retry() {
        let (directory, store) = active_store();
        let backup_directory = directory.path().join(BACKUP_DIRECTORY);
        create_private_directory(&backup_directory).expect("create backup directory");
        let connection = store.connect().expect("open source");
        for index in 1..=RETAINED_BACKUP_COUNT {
            let file_name = if index == 1 {
                "blocked.sqlite".to_string()
            } else {
                format!("existing-{index}.sqlite")
            };
            if index == 1 {
                fs::create_dir(backup_directory.join(&file_name))
                    .expect("create unlink-resistant entry");
            } else {
                File::create(backup_directory.join(&file_name)).expect("create existing backup");
            }
            connection
                .execute(
                    "INSERT INTO library_core_desktop_backups (
                       backupId, createdAtMs, revision, itemCount, reason,
                       fileName, byteLength, sha256
                     ) VALUES (?1, ?2, 1, 1, 'auto', ?3, 1, ?4);",
                    params![
                        format!("existing-{index}"),
                        index,
                        file_name,
                        "0".repeat(64)
                    ],
                )
                .expect("insert existing backup metadata");
        }
        drop(connection);
        let receipt = store.create_backup(500, "auto").expect("create backup");
        assert!(receipt.retention_pending);
        let connection = store.connect().expect("reopen source");
        let blocked_is_tracked: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_core_desktop_backups WHERE fileName = 'blocked.sqlite'
                 );",
                [],
                |row| row.get(0),
            )
            .expect("read retained metadata");
        assert!(blocked_is_tracked);
    }

    #[test]
    fn a_backdated_new_backup_is_never_pruned_by_its_own_retention_pass() {
        let (directory, store) = active_store();
        let backup_directory = directory.path().join(BACKUP_DIRECTORY);
        create_private_directory(&backup_directory).expect("create backup directory");
        let connection = store.connect().expect("open source");
        for index in 0..RETAINED_BACKUP_COUNT {
            let file_name = format!("existing-{index}.sqlite");
            File::create(backup_directory.join(&file_name)).expect("create existing backup");
            connection
                .execute(
                    "INSERT INTO library_core_desktop_backups (
                       backupId, createdAtMs, revision, itemCount, reason,
                       fileName, byteLength, sha256
                     ) VALUES (?1, ?2, 1, 1, 'auto', ?3, 1, ?4);",
                    params![
                        format!("existing-{index}"),
                        1_000 + index,
                        file_name,
                        "0".repeat(64)
                    ],
                )
                .expect("insert existing backup metadata");
        }
        drop(connection);
        let receipt = store
            .create_backup(1, "auto")
            .expect("create backdated backup");
        assert!(!receipt.retention_pending);
        assert!(backup_directory.join(&receipt.file_name).is_file());
        let connection = store.connect().expect("reopen source");
        let new_is_tracked: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_core_desktop_backups WHERE backupId = ?1
                 );",
                [&receipt.backup_id],
                |row| row.get(0),
            )
            .expect("read new metadata");
        assert!(new_is_tracked);
    }

    #[test]
    fn invalid_backup_time_creates_no_orphan_file() {
        let (directory, store) = active_store();
        let error = store
            .create_backup(-1, "manual")
            .expect_err("reject invalid time");
        assert_eq!(error.to_string(), "invalid SQLite Library backup time");
        assert!(!directory.path().join(BACKUP_DIRECTORY).exists());
    }

    #[test]
    fn failed_backup_copy_removes_its_partial_destination() {
        let (directory, store) = active_store();
        let error = store
            .create_backup_with_hooks(
                400,
                "manual",
                |_, destination| {
                    File::create(destination)?;
                    Err(LibraryCoreStoreError("forced copy failure".into()))
                },
                || Ok(()),
            )
            .expect_err("reject failed copy");
        assert_eq!(error.to_string(), "forced copy failure");
        assert!(!directory
            .path()
            .join(BACKUP_DIRECTORY)
            .join("sqlite-400.sqlite")
            .exists());
    }

    #[test]
    fn independent_backup_handles_cannot_share_destination_ownership() {
        let (directory, store) = active_store();
        let backup_directory = directory.path().join(BACKUP_DIRECTORY);
        create_private_directory(&backup_directory).expect("create backup directory");
        let held_lock =
            LibraryCoreBackupOperationGuard::acquire(directory.path()).expect("hold backup lock");
        let error = store
            .create_backup(500, "manual")
            .expect_err("refuse concurrent backup");
        assert_eq!(
            error.to_string(),
            "SQLite Library backup operation is already in progress"
        );
        assert!(!backup_directory.join("sqlite-500.sqlite").exists());
        drop(held_lock);
        assert!(store.create_backup(500, "manual").is_ok());
    }

    #[test]
    fn status_and_backup_receipts_have_bounded_stable_json_shapes() {
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
        let backup = store.create_backup(300, "auto").expect("create backup");
        let serialized = serde_json::to_value(&backup).expect("serialize backup");
        assert_eq!(serialized["backupId"], "sqlite-300");
        assert_eq!(serialized["revision"], 1);
        assert_eq!(serialized["itemCount"], 1);
        assert_eq!(serialized["reason"], "auto");
        assert_eq!(serialized["sha256"], backup.sha256);
        assert_eq!(serialized["retentionPending"], false);
        assert!(serialized["byteLength"]
            .as_u64()
            .is_some_and(|value| value > 0));
    }
}
