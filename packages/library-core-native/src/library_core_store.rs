use crate::{
    upsert_item, FollowerOverlayReplayReceipt, LibraryCoreJournal, VerifiedFollowerAnchor,
};
use rusqlite::{
    backup::Backup, params, Connection, OpenFlags, OptionalExtension, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
#[cfg(unix)]
use std::os::unix::fs::{FileExt, MetadataExt};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::sync::Arc;
#[cfg(unix)]
use std::time::Duration;

#[cfg(all(unix, test))]
use crate::library_core_bound_root::LibraryCoreBoundRoot;
#[cfg(unix)]
use crate::library_core_bound_sqlite_vfs::BoundSqliteDatabase;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCoreBackupRecord {
    pub backup_id: String,
    pub file_name: String,
    pub created_at_ms: i64,
    pub revision: i64,
    pub item_count: i64,
    pub reason: String,
    pub byte_length: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCoreBackupChunk {
    pub backup_id: String,
    pub bytes: Vec<u8>,
    pub next_offset: Option<u64>,
    pub offset: u64,
    pub sha256: String,
    pub total_byte_length: u64,
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
    backup_directory: OwnedFd,
    database: BoundSqliteDatabase,
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
        Ok(Self {
            root,
            #[cfg(unix)]
            bound: None,
        })
    }

    #[cfg(unix)]
    #[cfg(test)]
    pub(crate) fn open_bound(root: &LibraryCoreBoundRoot) -> LibraryCoreStoreResult<Self> {
        let library_directory = root.open_or_create_private_directory(LIBRARY_DIRECTORY)?;
        let backup_directory = root.open_or_create_private_directory(BACKUP_DIRECTORY)?;
        Self::open_bound_directories(library_directory, backup_directory)
    }

    #[cfg(unix)]
    pub(crate) fn open_bound_directories(
        library_directory: OwnedFd,
        backup_directory: OwnedFd,
    ) -> LibraryCoreStoreResult<Self> {
        let database = BoundSqliteDatabase::from_directory(library_directory.try_clone()?)?;
        let bound = Arc::new(BoundStoreRoot {
            library_directory,
            backup_directory,
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

    pub fn create_backup(
        &self,
        created_at_ms: i64,
        reason: &str,
    ) -> LibraryCoreStoreResult<LibraryCoreBackupReceipt> {
        #[cfg(unix)]
        if self.bound.is_some() {
            return self.create_bound_backup(created_at_ms, reason);
        }
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
        let expired = (|| -> rusqlite::Result<Vec<(String, i64, String)>> {
            let mut statement = connection.prepare(
                "SELECT backupId, createdAtMs, fileName FROM library_core_desktop_backups
                 WHERE backupId != ?1
                 ORDER BY createdAtMs DESC, backupId DESC LIMIT -1 OFFSET ?2;",
            )?;
            let files = statement
                .query_map(params![backup_id, RETAINED_BACKUP_COUNT - 1], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(files)
        })();
        let mut retention_pending = expired.is_err();
        for (expired_id, expired_at_ms, expired_file) in expired.unwrap_or_default() {
            if !valid_internal_backup_metadata(&expired_id, expired_at_ms, &expired_file) {
                retention_pending = true;
                continue;
            }
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
    pub fn list_bound_backups(&self) -> LibraryCoreStoreResult<Vec<LibraryCoreBackupRecord>> {
        let bound = self.require_bound()?;
        let _backup_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), BACKUP_LOCK_FILE)?;
        let connection = self.connect()?;
        require_active(&connection)?;
        let records = query_backup_records(&connection, None)?;
        records
            .into_iter()
            .map(|record| {
                if !valid_internal_backup_metadata(
                    &record.backup_id,
                    record.created_at_ms,
                    &record.file_name,
                ) {
                    return Err(LibraryCoreStoreError(
                        "SQLite Library backup metadata is invalid".into(),
                    ));
                }
                let file = open_existing_private_file_at(
                    bound.backup_directory.as_raw_fd(),
                    &record.file_name,
                )?;
                if file.metadata()?.len() != record.byte_length {
                    return Err(LibraryCoreStoreError(
                        "SQLite Library backup bytes do not match metadata".into(),
                    ));
                }
                Ok(record)
            })
            .collect()
    }

    #[cfg(unix)]
    pub fn read_bound_backup_chunk(
        &self,
        backup_id: &str,
        offset: u64,
        limit: usize,
    ) -> LibraryCoreStoreResult<LibraryCoreBackupChunk> {
        if backup_id.is_empty() || backup_id.len() > 128 || limit == 0 {
            return Err(LibraryCoreStoreError(
                "invalid SQLite Library backup chunk request".into(),
            ));
        }
        let bound = self.require_bound()?;
        let _backup_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), BACKUP_LOCK_FILE)?;
        let connection = self.connect()?;
        require_active(&connection)?;
        let record = query_backup_records(&connection, Some(backup_id))?
            .into_iter()
            .next()
            .ok_or_else(|| LibraryCoreStoreError("SQLite Library backup does not exist".into()))?;
        if !valid_internal_backup_metadata(
            &record.backup_id,
            record.created_at_ms,
            &record.file_name,
        ) || offset > record.byte_length
        {
            return Err(LibraryCoreStoreError(
                "SQLite Library backup metadata is invalid".into(),
            ));
        }
        let file =
            open_existing_private_file_at(bound.backup_directory.as_raw_fd(), &record.file_name)?;
        if file.metadata()?.len() != record.byte_length {
            return Err(LibraryCoreStoreError(
                "SQLite Library backup bytes do not match metadata".into(),
            ));
        }
        let byte_count = (record.byte_length - offset).min(limit as u64) as usize;
        let mut bytes = vec![0_u8; byte_count];
        read_exact_at(&file, &mut bytes, offset)?;
        let consumed = offset.checked_add(byte_count as u64).ok_or_else(|| {
            LibraryCoreStoreError("SQLite Library backup offset overflowed".into())
        })?;
        Ok(LibraryCoreBackupChunk {
            backup_id: record.backup_id,
            bytes,
            next_offset: (consumed < record.byte_length).then_some(consumed),
            offset,
            sha256: record.sha256,
            total_byte_length: record.byte_length,
        })
    }

    #[cfg(unix)]
    pub fn restore_bound_backup(
        &self,
        backup_id: &str,
    ) -> LibraryCoreStoreResult<LibraryCoreBackupRecord> {
        if backup_id.is_empty() || backup_id.len() > 256 {
            return Err(LibraryCoreStoreError(
                "invalid SQLite Library backup identity".into(),
            ));
        }
        let bound = self.require_bound()?;
        let _backup_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), BACKUP_LOCK_FILE)?;
        let connection = self.connect()?;
        require_active(&connection)?;
        let retained = query_backup_records(&connection, None)?;
        let record = retained
            .iter()
            .find(|record| record.backup_id == backup_id)
            .cloned()
            .ok_or_else(|| LibraryCoreStoreError("SQLite Library backup not found".into()))?;
        if !valid_internal_backup_metadata(
            &record.backup_id,
            record.created_at_ms,
            &record.file_name,
        ) {
            return Err(LibraryCoreStoreError(
                "SQLite Library backup metadata is invalid".into(),
            ));
        }
        drop(connection);
        let source =
            open_existing_private_file_at(bound.backup_directory.as_raw_fd(), &record.file_name)?;
        if source.metadata()?.len() != record.byte_length
            || sha256_open_file(&source)? != record.sha256
        {
            return Err(LibraryCoreStoreError(
                "SQLite Library backup bytes do not match their recorded digest".into(),
            ));
        }
        let check = Connection::open_with_flags(
            descriptor_immutable_uri(source.as_raw_fd()),
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                | OpenFlags::SQLITE_OPEN_EXRESCODE,
        )?;
        require_integrity(&check).map_err(|error| {
            LibraryCoreStoreError(format!("SQLite Library backup integrity failed: {error}"))
        })?;
        require_active(&check)?;
        drop(check);

        let staging_name = "library-core.sqlite.restore-staging";
        let rollback_name = "library-core.sqlite.pre-restore";
        let _ = unlink_file_at(bound.library_directory.as_raw_fd(), staging_name);
        let _ = unlink_file_at(bound.library_directory.as_raw_fd(), rollback_name);
        let staging = open_new_private_file_at(bound.library_directory.as_raw_fd(), staging_name)?;
        copy_exact_file(&source, &staging, record.byte_length)?;
        staging.sync_all()?;
        if sha256_open_file(&staging)? != record.sha256 {
            drop(staging);
            let _ = unlink_file_at(bound.library_directory.as_raw_fd(), staging_name);
            return Err(LibraryCoreStoreError(
                "SQLite Library restore staging copy changed bytes".into(),
            ));
        }
        drop(staging);
        let directory = bound.library_directory.as_raw_fd();
        let _ = unlink_file_at(directory, "library-core.sqlite-wal");
        let _ = unlink_file_at(directory, "library-core.sqlite-shm");
        rename_file_at(directory, LIBRARY_FILE, directory, rollback_name)?;
        if let Err(error) = rename_file_at(directory, staging_name, directory, LIBRARY_FILE) {
            let _ = rename_file_at(directory, rollback_name, directory, LIBRARY_FILE);
            return Err(error.into());
        }
        let restored = match LibraryCoreJournal::open_bound(&bound.database) {
            Ok(journal) => journal,
            Err(error) => {
                let _ = unlink_file_at(directory, LIBRARY_FILE);
                let _ = rename_file_at(directory, rollback_name, directory, LIBRARY_FILE);
                return Err(LibraryCoreStoreError(format!(
                    "restored SQLite Library failed catalog verification: {error}"
                )));
            }
        };
        drop(restored);
        let restored = self.connect()?;
        for retained_record in retained {
            restored.execute(
                "INSERT OR REPLACE INTO library_core_desktop_backups (
                   backupId, createdAtMs, revision, itemCount, reason, fileName, byteLength, sha256
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);",
                params![
                    retained_record.backup_id,
                    retained_record.created_at_ms,
                    retained_record.revision,
                    retained_record.item_count,
                    retained_record.reason,
                    retained_record.file_name,
                    i64::try_from(retained_record.byte_length)
                        .map_err(|_| LibraryCoreStoreError("backup is too large".into()))?,
                    retained_record.sha256,
                ],
            )?;
        }
        drop(restored);
        unlink_file_at(directory, rollback_name)?;
        Ok(record)
    }

    #[cfg(unix)]
    pub fn clear_bound_backups(&self) -> LibraryCoreStoreResult<()> {
        let bound = self.require_bound()?;
        let _backup_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), BACKUP_LOCK_FILE)?;
        self.clear_bound_backups_locked(bound)
    }

    #[cfg(unix)]
    fn clear_bound_backups_locked(&self, bound: &BoundStoreRoot) -> LibraryCoreStoreResult<()> {
        let connection = self.connect()?;
        let records = query_backup_records(&connection, None)?;
        for record in &records {
            if !valid_internal_backup_metadata(
                &record.backup_id,
                record.created_at_ms,
                &record.file_name,
            ) {
                return Err(LibraryCoreStoreError(
                    "SQLite Library backup metadata is invalid".into(),
                ));
            }
        }
        for record in &records {
            match unlink_file_at(bound.backup_directory.as_raw_fd(), &record.file_name) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        connection.execute("DELETE FROM library_core_desktop_backups;", [])?;
        Ok(())
    }

    #[cfg(unix)]
    pub fn clear_bound_library(&self) -> LibraryCoreStoreResult<()> {
        let bound = self.require_bound()?;
        let _backup_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), BACKUP_LOCK_FILE)?;
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
        self.clear_bound_all_with_hook(|| Ok(()))
    }

    #[cfg(unix)]
    fn clear_bound_all_with_hook<F>(&self, after_backups: F) -> LibraryCoreStoreResult<()>
    where
        F: FnOnce() -> LibraryCoreStoreResult<()>,
    {
        let bound = self.require_bound()?;
        let _backup_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), BACKUP_LOCK_FILE)?;
        self.clear_bound_backups_locked(bound)?;
        after_backups()?;
        self.clear_bound_library_locked(bound)
    }

    #[cfg(unix)]
    fn require_bound(&self) -> LibraryCoreStoreResult<&BoundStoreRoot> {
        self.bound
            .as_deref()
            .ok_or_else(|| LibraryCoreStoreError("descriptor-bound Library root is absent".into()))
    }

    #[cfg(unix)]
    fn create_bound_backup(
        &self,
        created_at_ms: i64,
        reason: &str,
    ) -> LibraryCoreStoreResult<LibraryCoreBackupReceipt> {
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
        let bound = self.bound.as_ref().ok_or_else(|| {
            LibraryCoreStoreError("descriptor-bound backup root is absent".into())
        })?;
        let _backup_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), BACKUP_LOCK_FILE)?;
        let backup_id = format!("sqlite-{created_at_ms}");
        let file_name = format!("{backup_id}.sqlite");
        let destination_file =
            open_new_private_file_at(bound.backup_directory.as_raw_fd(), &file_name)?;
        let destination_path = descriptor_file_path(destination_file.as_raw_fd());
        let connection = self.connect()?;
        require_active(&connection)?;

        let prepared = (|| -> LibraryCoreStoreResult<(i64, i64, u64, String)> {
            let mut destination = Connection::open_with_flags(
                &destination_path,
                OpenFlags::SQLITE_OPEN_READ_WRITE
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                    | OpenFlags::SQLITE_OPEN_EXRESCODE,
            )?;
            destination.execute_batch(
                "PRAGMA journal_mode = OFF;
                 PRAGMA locking_mode = EXCLUSIVE;",
            )?;
            let backup = Backup::new(&connection, &mut destination)?;
            backup.run_to_completion(100, Duration::from_millis(1), None)?;
            drop(backup);
            drop(destination);
            destination_file.sync_all()?;
            let check = Connection::open_with_flags(
                descriptor_immutable_uri(destination_file.as_raw_fd()),
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_URI
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                    | OpenFlags::SQLITE_OPEN_EXRESCODE,
            )?;
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
            drop(check);
            let byte_length = destination_file.metadata()?.len();
            let sha256 = sha256_open_file(&destination_file)?;
            Ok((revision, item_count, byte_length, sha256))
        })();
        let (revision, item_count, byte_length, sha256) = match prepared {
            Ok(value) => value,
            Err(error) => {
                drop(destination_file);
                let _ = unlink_file_at(bound.backup_directory.as_raw_fd(), &file_name);
                return Err(error);
            }
        };
        let byte_length_i64 = match i64::try_from(byte_length) {
            Ok(value) => value,
            Err(_) => {
                drop(destination_file);
                let _ = unlink_file_at(bound.backup_directory.as_raw_fd(), &file_name);
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
        if !matches!(inserted, Ok(1)) {
            drop(destination_file);
            let _ = unlink_file_at(bound.backup_directory.as_raw_fd(), &file_name);
            return match inserted {
                Ok(_) => Err(LibraryCoreStoreError(
                    "SQLite Library backup metadata was not stored".into(),
                )),
                Err(error) => Err(error.into()),
            };
        }
        let expired = (|| -> rusqlite::Result<Vec<(String, i64, String)>> {
            let mut statement = connection.prepare(
                "SELECT backupId, createdAtMs, fileName FROM library_core_desktop_backups
                 WHERE backupId != ?1
                 ORDER BY createdAtMs DESC, backupId DESC LIMIT -1 OFFSET ?2;",
            )?;
            let files = statement
                .query_map(params![backup_id, RETAINED_BACKUP_COUNT - 1], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(files)
        })();
        let mut retention_pending = expired.is_err();
        for (expired_id, expired_at_ms, expired_file) in expired.unwrap_or_default() {
            if !valid_internal_backup_metadata(&expired_id, expired_at_ms, &expired_file) {
                retention_pending = true;
                continue;
            }
            if unlink_file_at(bound.backup_directory.as_raw_fd(), &expired_file).is_err() {
                retention_pending = true;
                continue;
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
        drop(destination_file);
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
}

fn database_path(root: &Path) -> PathBuf {
    root.join(LIBRARY_DIRECTORY).join(LIBRARY_FILE)
}

fn valid_internal_backup_file_name(name: &str) -> bool {
    let Some(identifier) = name
        .strip_prefix("sqlite-")
        .and_then(|value| value.strip_suffix(".sqlite"))
    else {
        return false;
    };
    let Ok(created_at_ms) = identifier.parse::<i64>() else {
        return false;
    };
    created_at_ms >= 0 && format!("sqlite-{created_at_ms}.sqlite") == name
}

fn valid_internal_backup_metadata(backup_id: &str, created_at_ms: i64, file_name: &str) -> bool {
    created_at_ms >= 0
        && backup_id == format!("sqlite-{created_at_ms}")
        && file_name == format!("{backup_id}.sqlite")
        && valid_internal_backup_file_name(file_name)
}

fn query_backup_records(
    connection: &Connection,
    backup_id: Option<&str>,
) -> LibraryCoreStoreResult<Vec<LibraryCoreBackupRecord>> {
    let select =
        "SELECT backupId, fileName, createdAtMs, revision, itemCount, reason, byteLength, sha256
                  FROM library_core_desktop_backups";
    let map_row = |row: &rusqlite::Row<'_>| {
        let byte_length = row.get::<_, i64>(6)?;
        if byte_length < 0 {
            return Err(rusqlite::Error::IntegralValueOutOfRange(6, byte_length));
        }
        Ok(LibraryCoreBackupRecord {
            backup_id: row.get(0)?,
            file_name: row.get(1)?,
            created_at_ms: row.get(2)?,
            revision: row.get(3)?,
            item_count: row.get(4)?,
            reason: row.get(5)?,
            byte_length: byte_length as u64,
            sha256: row.get(7)?,
        })
    };
    let records = if let Some(backup_id) = backup_id {
        let mut statement = connection.prepare(&format!("{select} WHERE backupId = ?1;"))?;
        let records = statement
            .query_map([backup_id], map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        records
    } else {
        let mut statement = connection.prepare(&format!(
            "{select} ORDER BY createdAtMs DESC, backupId DESC;"
        ))?;
        let records = statement
            .query_map([], map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        records
    };
    Ok(records)
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
                    "SQLite Library backup operation is already in progress".into(),
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
fn open_new_private_file_at(parent: RawFd, name: &str) -> LibraryCoreStoreResult<File> {
    let name = std::ffi::CString::new(name)
        .map_err(|_| LibraryCoreStoreError("invalid bound backup name".into()))?;
    let descriptor = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            0o600,
        )
    };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn open_existing_private_file_at(parent: RawFd, name: &str) -> LibraryCoreStoreResult<File> {
    if !valid_internal_backup_file_name(name) {
        return Err(LibraryCoreStoreError(
            "invalid descriptor-bound backup name".into(),
        ));
    }
    let name = std::ffi::CString::new(name)
        .map_err(|_| LibraryCoreStoreError("invalid bound backup name".into()))?;
    let descriptor = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
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
            "descriptor-bound backup file is not private".into(),
        ));
    }
    Ok(file)
}

#[cfg(unix)]
fn unlink_file_at(parent: RawFd, name: &str) -> std::io::Result<()> {
    let name = std::ffi::CString::new(name)
        .map_err(|_| std::io::Error::other("invalid bound backup name"))?;
    if unsafe { libc::unlinkat(parent, name.as_ptr(), 0) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(unix)]
fn rename_file_at(
    source_parent: RawFd,
    source: &str,
    destination_parent: RawFd,
    destination: &str,
) -> std::io::Result<()> {
    let source = std::ffi::CString::new(source)
        .map_err(|_| std::io::Error::other("invalid bound source name"))?;
    let destination = std::ffi::CString::new(destination)
        .map_err(|_| std::io::Error::other("invalid bound destination name"))?;
    if unsafe {
        libc::renameat(
            source_parent,
            source.as_ptr(),
            destination_parent,
            destination.as_ptr(),
        )
    } < 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(unix)]
fn read_exact_at(file: &File, bytes: &mut [u8], mut offset: u64) -> LibraryCoreStoreResult<()> {
    let mut consumed = 0usize;
    while consumed < bytes.len() {
        let count = file.read_at(&mut bytes[consumed..], offset)?;
        if count == 0 {
            return Err(LibraryCoreStoreError(
                "descriptor-bound file ended early".into(),
            ));
        }
        consumed += count;
        offset += count as u64;
    }
    Ok(())
}

#[cfg(unix)]
fn copy_exact_file(source: &File, destination: &File, length: u64) -> LibraryCoreStoreResult<()> {
    let mut buffer = vec![0_u8; 64 * 1_024];
    let mut offset = 0_u64;
    while offset < length {
        let count = (length - offset).min(buffer.len() as u64) as usize;
        read_exact_at(source, &mut buffer[..count], offset)?;
        destination.write_all_at(&buffer[..count], offset)?;
        offset += count as u64;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn descriptor_file_path(descriptor: RawFd) -> PathBuf {
    Path::new("/dev/fd").join(descriptor.to_string())
}

#[cfg(unix)]
fn descriptor_immutable_uri(descriptor: RawFd) -> String {
    format!(
        "file:{}?immutable=1",
        descriptor_file_path(descriptor).display()
    )
}

#[cfg(target_os = "linux")]
fn descriptor_file_path(descriptor: RawFd) -> PathBuf {
    Path::new("/proc/self/fd").join(descriptor.to_string())
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn descriptor_file_path(descriptor: RawFd) -> PathBuf {
    Path::new("/dev/fd").join(descriptor.to_string())
}

#[cfg(unix)]
fn sha256_open_file(file: &File) -> LibraryCoreStoreResult<String> {
    let length = file.metadata()?.len();
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1_024];
    let mut offset = 0u64;
    while offset < length {
        let remaining = (length - offset).min(buffer.len() as u64) as usize;
        let count = file.read_at(&mut buffer[..remaining], offset)?;
        if count == 0 {
            return Err(LibraryCoreStoreError(
                "descriptor-bound backup ended early".into(),
            ));
        }
        digest.update(&buffer[..count]);
        offset += count as u64;
    }
    Ok(crate::lower_hex(&digest.finalize()))
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
    #[cfg(unix)]
    use std::os::fd::AsRawFd;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::process::Command;

    use super::*;

    #[cfg(unix)]
    const BOUND_RETENTION_HELPER_ROOT: &str = "FREED_BOUND_RETENTION_HELPER_ROOT";
    #[cfg(unix)]
    const BOUND_RETENTION_HELPER_CASE: &str = "FREED_BOUND_RETENTION_HELPER_CASE";

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

    #[cfg(unix)]
    fn active_bound_store(root: &Path) -> LibraryCoreStore {
        fs::create_dir(root).expect("create bound store root");
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))
            .expect("set bound store root permissions");
        let descriptor = File::open(root).expect("open bound store root");
        let bound_root = LibraryCoreBoundRoot::from_inherited_descriptor(descriptor.as_raw_fd())
            .expect("bind store root");
        let store = LibraryCoreStore::open_bound(&bound_root).expect("open bound store");
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
            .expect("begin bound import");
        store
            .append_import_page(&[LibraryCoreImportItem {
                item_json: r#"{"globalId":"item-1"}"#.into(),
                updated_at_ms: 101,
            }])
            .expect("append bound import");
        store
            .finalize_import(102, None)
            .expect("finalize bound import");
        store
    }

    #[cfg(unix)]
    #[test]
    fn bound_backup_lifecycle_stays_on_original_inodes_after_root_replacement() {
        let fixture = tempfile::TempDir::new().expect("create bound backup fixture");
        let visible = fixture.path().join("data");
        let moved = fixture.path().join("moved-data");
        let store = active_bound_store(&visible);
        fs::rename(&visible, &moved).expect("move bound root");
        fs::create_dir(&visible).expect("create replacement root");
        fs::set_permissions(&visible, fs::Permissions::from_mode(0o700))
            .expect("set replacement permissions");
        fs::write(visible.join("sentinel"), b"replacement").expect("write replacement sentinel");

        let created = store
            .create_backup(1_000, "manual")
            .expect("create bound backup");
        let records = store.list_bound_backups().expect("list bound backups");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].backup_id, created.backup_id);
        let chunk = store
            .read_bound_backup_chunk(&created.backup_id, 0, 4_096)
            .expect("read bound backup");
        assert!(!chunk.bytes.is_empty());
        store
            .restore_bound_backup(&created.backup_id)
            .expect("restore bound backup");
        assert!(store.status().expect("read restored status").is_some());
        assert!(moved
            .join(BACKUP_DIRECTORY)
            .join(&created.file_name)
            .is_file());
        assert_eq!(
            fs::read(visible.join("sentinel")).expect("replacement sentinel"),
            b"replacement"
        );
        assert!(!visible.join(LIBRARY_DIRECTORY).exists());
    }

    #[cfg(unix)]
    #[test]
    fn bound_clear_all_holds_one_lock_across_backup_and_library_removal() {
        let fixture = tempfile::TempDir::new().expect("create bound clear fixture");
        let root = fixture.path().join("data");
        let store = active_bound_store(&root);
        let backup = store
            .create_backup(1_000, "manual")
            .expect("create bound backup");

        store
            .clear_bound_all_with_hook(|| {
                let error = store
                    .create_backup(1_001, "manual")
                    .expect_err("refuse backup during clear-all");
                assert_eq!(
                    error.to_string(),
                    "SQLite Library backup operation is already in progress"
                );
                Ok(())
            })
            .expect("clear bound Library and backups");

        assert!(!root.join(BACKUP_DIRECTORY).join(backup.file_name).exists());
        assert!(!root.join(LIBRARY_DIRECTORY).join(LIBRARY_FILE).exists());
    }

    #[cfg(unix)]
    #[test]
    fn bound_backup_clear_keeps_metadata_until_every_file_is_removed() {
        let fixture = tempfile::TempDir::new().expect("create bound clear retry fixture");
        let root = fixture.path().join("data");
        let store = active_bound_store(&root);
        let backup = store
            .create_backup(1_000, "manual")
            .expect("create bound backup");
        let backup_path = root.join(BACKUP_DIRECTORY).join(&backup.file_name);
        fs::remove_file(&backup_path).expect("remove backup fixture file");
        fs::create_dir(&backup_path).expect("install unlink-resistant backup entry");

        store
            .clear_bound_backups()
            .expect_err("surface failed backup removal");
        let connection = store.connect().expect("read retained backup metadata");
        let tracked: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_core_desktop_backups WHERE backupId = ?1
                 );",
                [&backup.backup_id],
                |row| row.get(0),
            )
            .expect("read retained metadata");
        assert!(tracked);
        drop(connection);

        fs::remove_dir(&backup_path).expect("remove blocking directory");
        File::create(&backup_path).expect("restore removable backup entry");
        store.clear_bound_backups().expect("retry backup clear");
        let connection = store.connect().expect("read cleared backup metadata");
        let tracked: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_core_desktop_backups WHERE backupId = ?1
                 );",
                [&backup.backup_id],
                |row| row.get(0),
            )
            .expect("read cleared metadata");
        assert!(!tracked);
        assert!(!backup_path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn bound_backup_final_leaf_symlink_is_rejected_without_touching_target() {
        let fixture = tempfile::TempDir::new().expect("create backup symlink fixture");
        let root = fixture.path().join("data");
        let store = active_bound_store(&root);
        let target = fixture.path().join("target");
        fs::write(&target, b"unchanged").expect("write target");
        std::os::unix::fs::symlink(
            &target,
            root.join(BACKUP_DIRECTORY).join("sqlite-1000.sqlite"),
        )
        .expect("install backup symlink");
        assert!(store.create_backup(1_000, "manual").is_err());
        assert_eq!(fs::read(target).expect("read target"), b"unchanged");
    }

    #[test]
    fn backup_file_names_accept_only_exact_internal_leaves() {
        assert!(valid_internal_backup_file_name("sqlite-0.sqlite"));
        assert!(valid_internal_backup_file_name(
            "sqlite-9223372036854775807.sqlite"
        ));
        assert!(valid_internal_backup_metadata(
            "sqlite-17",
            17,
            "sqlite-17.sqlite"
        ));
        assert!(!valid_internal_backup_metadata(
            "different-id",
            17,
            "sqlite-17.sqlite"
        ));
        for invalid in [
            "../library-core.sqlite",
            "/tmp/sqlite-1.sqlite",
            "nested/sqlite-1.sqlite",
            "not-a-backup.sqlite",
            "sqlite--1.sqlite",
            "sqlite-9223372036854775808.sqlite",
            "sqlite-01.sqlite",
            "sqlite-1.sqlite.bak",
        ] {
            assert!(
                !valid_internal_backup_file_name(invalid),
                "accepted invalid backup leaf {invalid:?}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn bound_retention_tamper_helper() {
        let Ok(root_value) = std::env::var(BOUND_RETENTION_HELPER_ROOT) else {
            return;
        };
        let case = std::env::var(BOUND_RETENTION_HELPER_CASE).expect("retention helper case");
        let root = PathBuf::from(root_value);
        let fixture = root.parent().expect("fixture directory");
        let external_sentinel = fixture.join("external-sentinel");
        let parent_sentinel = root.join(LIBRARY_FILE);
        let nested_directory = root.join(BACKUP_DIRECTORY).join("nested");
        let nested_sentinel = nested_directory.join("sentinel");
        fs::create_dir_all(&nested_directory).expect("create nested sentinel directory");
        fs::set_permissions(
            root.join(BACKUP_DIRECTORY),
            fs::Permissions::from_mode(0o700),
        )
        .expect("set backup directory permissions");
        fs::write(&external_sentinel, b"external").expect("write external sentinel");
        fs::write(&parent_sentinel, b"parent").expect("write parent sentinel");
        fs::write(&nested_sentinel, b"nested").expect("write nested sentinel");
        let tampered_file_name = match case.as_str() {
            "parent" => "../library-core.sqlite".to_string(),
            "absolute" => external_sentinel.to_string_lossy().into_owned(),
            "nested" => "nested/sentinel".to_string(),
            "malformed" => "not-a-backup.sqlite".to_string(),
            "negative" => "sqlite--1.sqlite".to_string(),
            "oversized" => "sqlite-9223372036854775808.sqlite".to_string(),
            _ => panic!("unknown retention helper case"),
        };

        let descriptor = File::open(&root).expect("open bound root");
        let bound_root = LibraryCoreBoundRoot::from_inherited_descriptor(descriptor.as_raw_fd())
            .expect("bind root");
        let store = LibraryCoreStore::open_bound(&bound_root).expect("open bound store");
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
                item_json: r#"{"globalId":"item-1"}"#.into(),
                updated_at_ms: 101,
            }])
            .expect("append import");
        store.finalize_import(102, None).expect("finalize import");
        let connection = store.connect().expect("open source");
        connection
            .execute(
                "INSERT INTO library_core_desktop_backups (
                   backupId, createdAtMs, revision, itemCount, reason,
                   fileName, byteLength, sha256
                 ) VALUES ('tampered', 1, 1, 1, 'auto', ?1, 1, ?2);",
                params![tampered_file_name, "0".repeat(64)],
            )
            .expect("insert tampered metadata");
        for created_at_ms in 2..=RETAINED_BACKUP_COUNT {
            connection
                .execute(
                    "INSERT INTO library_core_desktop_backups (
                       backupId, createdAtMs, revision, itemCount, reason,
                       fileName, byteLength, sha256
                     ) VALUES (?1, ?2, 1, 1, 'auto', ?3, 1, ?4);",
                    params![
                        format!("sqlite-{created_at_ms}"),
                        created_at_ms,
                        format!("sqlite-{created_at_ms}.sqlite"),
                        "0".repeat(64)
                    ],
                )
                .expect("insert retained metadata");
        }
        drop(connection);

        let receipt = store.create_backup(1_000, "auto").expect("create backup");
        assert!(receipt.retention_pending);
        assert!(store.status().expect("read live status").is_some());
        let connection = store.connect().expect("reopen source");
        let tampered_is_tracked: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_core_desktop_backups WHERE backupId = 'tampered'
                 );",
                [],
                |row| row.get(0),
            )
            .expect("read tampered metadata");
        assert!(tampered_is_tracked);
        assert!(root.join(LIBRARY_DIRECTORY).join(LIBRARY_FILE).is_file());
        assert_eq!(
            fs::read(&external_sentinel).expect("external sentinel"),
            b"external"
        );
        assert_eq!(
            fs::read(&parent_sentinel).expect("parent sentinel"),
            b"parent"
        );
        assert_eq!(
            fs::read(&nested_sentinel).expect("nested sentinel"),
            b"nested"
        );
    }

    #[cfg(unix)]
    #[test]
    fn tampered_bound_retention_metadata_cannot_delete_any_path() {
        for case in [
            "parent",
            "absolute",
            "nested",
            "malformed",
            "negative",
            "oversized",
        ] {
            let fixture = tempfile::TempDir::new().expect("create retention fixture");
            let root = fixture.path().join("data");
            fs::create_dir(&root).expect("create bound root");
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .expect("set bound root permissions");
            let status = Command::new(std::env::current_exe().expect("current test executable"))
                .arg("--exact")
                .arg("library_core_store::tests::bound_retention_tamper_helper")
                .arg("--nocapture")
                .env(BOUND_RETENTION_HELPER_ROOT, &root)
                .env(BOUND_RETENTION_HELPER_CASE, case)
                .status()
                .expect("run retention helper");
            assert!(status.success(), "retention helper failed for {case}");
        }
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
                "sqlite-1.sqlite".to_string()
            } else {
                format!("sqlite-{index}.sqlite")
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
                   SELECT 1 FROM library_core_desktop_backups WHERE fileName = 'sqlite-1.sqlite'
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
            let backup_time = 1_000 + index;
            let file_name = format!("sqlite-{backup_time}.sqlite");
            File::create(backup_directory.join(&file_name)).expect("create existing backup");
            connection
                .execute(
                    "INSERT INTO library_core_desktop_backups (
                       backupId, createdAtMs, revision, itemCount, reason,
                       fileName, byteLength, sha256
                     ) VALUES (?1, ?2, 1, 1, 'auto', ?3, 1, ?4);",
                    params![
                        format!("sqlite-{backup_time}"),
                        backup_time,
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
