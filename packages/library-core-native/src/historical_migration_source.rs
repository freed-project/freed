use rusqlite::{Connection, OpenFlags};
#[cfg(unix)]
use std::ffi::CString;
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
const HISTORICAL_APPLICATION_ID: i64 = 0x4652_4545;
const HISTORICAL_SCHEMA_VERSION: i64 = 12;
const HISTORICAL_REQUIRED_COLUMNS: [(&str, &[&str]); 5] = [
    (
        "library_core_desktop_state",
        &[
            "singletonId",
            "active",
            "revision",
            "sourceGeneration",
            "sourceRevision",
            "sourceDigest",
            "expectedItemCount",
            "importedItemCount",
            "shellJson",
            "activatedAtMs",
        ],
    ),
    (
        "library_core_feed_items",
        &["globalId", "payloadJson", "updatedAtMs", "deletedAt"],
    ),
    (
        "library_core_active_authority",
        &[
            "libraryId",
            "epoch",
            "epochId",
            "transitionCertificateDigest",
        ],
    ),
    (
        "library_core_authority_epochs",
        &[
            "libraryId",
            "epoch",
            "epochId",
            "authorityKeyId",
            "authorityPublicKey",
            "transitionCertificateDigest",
        ],
    ),
    (
        "library_core_authority_frontier",
        &[
            "libraryId",
            "epochId",
            "tipIndex",
            "actorId",
            "sequence",
            "operationId",
            "chainDigest",
        ],
    ),
];
pub(crate) type LibraryCoreStorageResult<T> = Result<T, LibraryCoreStorageError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryCoreStorageError(String);

impl std::fmt::Display for LibraryCoreStorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for LibraryCoreStorageError {}

impl From<String> for LibraryCoreStorageError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<rusqlite::Error> for LibraryCoreStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self(value.to_string())
    }
}

impl From<std::io::Error> for LibraryCoreStorageError {
    fn from(value: std::io::Error) -> Self {
        Self(value.to_string())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct HistoricalMigrationSource {
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

impl HistoricalMigrationSource {
    #[cfg(unix)]
    pub(crate) fn open_bound_directory(
        library_directory: OwnedFd,
    ) -> LibraryCoreStorageResult<Option<Self>> {
        if !bound_database_is_present(library_directory.as_raw_fd())? {
            return Ok(None);
        }
        let database = BoundSqliteDatabase::from_directory(library_directory.try_clone()?)?;
        let bound = Arc::new(BoundStoreRoot {
            library_directory,
            database,
        });
        let source = Self {
            root: PathBuf::from("."),
            bound: Some(bound),
        };
        drop(source.connect()?);
        Ok(Some(source))
    }

    pub(crate) fn connect(&self) -> LibraryCoreStorageResult<Connection> {
        #[cfg(unix)]
        let connection = if let Some(bound) = &self.bound {
            bound.database.open(
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                    | OpenFlags::SQLITE_OPEN_NOFOLLOW
                    | OpenFlags::SQLITE_OPEN_EXRESCODE,
            )?
        } else {
            Connection::open_with_flags(
                database_path(&self.root),
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                    | OpenFlags::SQLITE_OPEN_NOFOLLOW
                    | OpenFlags::SQLITE_OPEN_EXRESCODE,
            )?
        };
        #[cfg(not(unix))]
        let connection = Connection::open_with_flags(
            database_path(&self.root),
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW
                | OpenFlags::SQLITE_OPEN_EXRESCODE,
        )?;
        connection.execute_batch(
            "PRAGMA query_only = ON;
             PRAGMA foreign_keys = ON;
             PRAGMA trusted_schema = OFF;
             PRAGMA busy_timeout = 5000;",
        )?;
        validate_historical_source(&connection)?;
        Ok(connection)
    }

    #[cfg(unix)]
    pub(crate) fn clear_bound_library(&self) -> LibraryCoreStorageResult<()> {
        let bound = self.require_bound()?;
        let _reset_lock =
            BoundFileLock::acquire(bound.library_directory.as_raw_fd(), RESET_LOCK_FILE)?;
        self.clear_bound_library_locked(bound)
    }

    #[cfg(unix)]
    fn clear_bound_library_locked(&self, bound: &BoundStoreRoot) -> LibraryCoreStorageResult<()> {
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
    pub(crate) fn clear_bound_all(&self) -> LibraryCoreStorageResult<()> {
        self.clear_bound_library()
    }

    #[cfg(unix)]
    fn require_bound(&self) -> LibraryCoreStorageResult<&BoundStoreRoot> {
        self.bound.as_deref().ok_or_else(|| {
            LibraryCoreStorageError("descriptor-bound Library root is absent".into())
        })
    }
}

#[cfg(unix)]
fn bound_database_is_present(directory: RawFd) -> LibraryCoreStorageResult<bool> {
    let leaf = CString::new(LIBRARY_FILE).map_err(|_| {
        LibraryCoreStorageError("historical Desktop database leaf is invalid".to_string())
    })?;
    let mut metadata = std::mem::MaybeUninit::<libc::stat>::zeroed();
    let result = unsafe {
        libc::fstatat(
            directory,
            leaf.as_ptr(),
            metadata.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result < 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok(false);
        }
        return Err(error.into());
    }
    let metadata = unsafe { metadata.assume_init() };
    if metadata.st_mode & libc::S_IFMT != libc::S_IFREG {
        return Err(LibraryCoreStorageError(
            "historical Desktop database is not a regular file".to_string(),
        ));
    }
    Ok(true)
}

fn validate_historical_source(connection: &Connection) -> LibraryCoreStorageResult<()> {
    let application_id: i64 =
        connection.query_row("PRAGMA application_id;", [], |row| row.get(0))?;
    let schema_version: i64 = connection.query_row("PRAGMA user_version;", [], |row| row.get(0))?;
    if application_id != HISTORICAL_APPLICATION_ID || schema_version != HISTORICAL_SCHEMA_VERSION {
        return Err(LibraryCoreStorageError(
            "historical Desktop migration source identity is unsupported".to_string(),
        ));
    }
    let quick_check: String =
        connection.query_row("PRAGMA quick_check(1);", [], |row| row.get(0))?;
    if quick_check != "ok" {
        return Err(LibraryCoreStorageError(
            "historical Desktop migration source is corrupt".to_string(),
        ));
    }
    for (table, required_columns) in HISTORICAL_REQUIRED_COLUMNS {
        let mut statement = connection.prepare("SELECT name FROM pragma_table_info(?1);")?;
        let columns = statement
            .query_map([table], |row| row.get::<_, String>(0))?
            .collect::<Result<std::collections::HashSet<_>, _>>()?;
        if required_columns
            .iter()
            .any(|column| !columns.contains(*column))
        {
            return Err(LibraryCoreStorageError(
                "historical Desktop migration source schema is incomplete".to_string(),
            ));
        }
    }
    Ok(())
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
    fn acquire(directory: RawFd, name: &str) -> LibraryCoreStorageResult<Self> {
        let file = open_private_lock_file_at(directory, name)?;
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::WouldBlock {
                return Err(LibraryCoreStorageError(
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
fn open_private_lock_file_at(parent: RawFd, name: &str) -> LibraryCoreStorageResult<File> {
    let name = std::ffi::CString::new(name)
        .map_err(|_| LibraryCoreStorageError("invalid bound lock name".into()))?;
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
        return Err(LibraryCoreStorageError(
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn create_source(root: &Path, application_id: i64, schema_version: i64, complete: bool) {
        std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
            .expect("make historical source private");
        let database_path = root.join(LIBRARY_FILE);
        let connection = Connection::open(&database_path).expect("create historical source");
        let desktop_columns = if complete {
            "singletonId, active, revision, sourceGeneration, sourceRevision, sourceDigest,
             expectedItemCount, importedItemCount, shellJson, activatedAtMs"
        } else {
            "singletonId, active"
        };
        connection
            .execute_batch(&format!(
                "PRAGMA application_id = {application_id};
                 PRAGMA user_version = {schema_version};
                 CREATE TABLE library_core_desktop_state ({desktop_columns});
                 CREATE TABLE library_core_feed_items
                   (globalId, payloadJson, updatedAtMs, deletedAt);
                 CREATE TABLE library_core_active_authority
                   (libraryId, epoch, epochId, transitionCertificateDigest);
                 CREATE TABLE library_core_authority_epochs
                   (libraryId, epoch, epochId, authorityKeyId, authorityPublicKey,
                    transitionCertificateDigest);
                 CREATE TABLE library_core_authority_frontier
                   (libraryId, epochId, tipIndex, actorId, sequence, operationId, chainDigest);"
            ))
            .expect("install historical source schema");
        drop(connection);
        std::fs::set_permissions(database_path, std::fs::Permissions::from_mode(0o600))
            .expect("make historical database private");
    }

    fn open_bound(root: &Path) -> LibraryCoreStorageResult<Option<HistoricalMigrationSource>> {
        let directory = File::open(root).expect("open historical source directory");
        HistoricalMigrationSource::open_bound_directory(directory.into())
    }

    #[test]
    fn exact_historical_source_is_read_only() {
        let fixture = tempfile::TempDir::new().expect("create historical source fixture");
        create_source(
            fixture.path(),
            HISTORICAL_APPLICATION_ID,
            HISTORICAL_SCHEMA_VERSION,
            true,
        );

        let source = open_bound(fixture.path())
            .expect("admit exact historical source")
            .expect("historical source is present");
        let connection = source.connect().expect("reopen exact historical source");
        assert_eq!(
            connection
                .query_row("PRAGMA query_only;", [], |row| row.get::<_, i64>(0))
                .expect("read query-only mode"),
            1
        );
        assert!(connection
            .execute("DELETE FROM library_core_feed_items;", [])
            .is_err());
    }

    #[test]
    fn changed_identity_or_incomplete_schema_is_rejected() {
        for (application_id, complete) in [
            (HISTORICAL_APPLICATION_ID + 1, true),
            (HISTORICAL_APPLICATION_ID, false),
        ] {
            let fixture = tempfile::TempDir::new().expect("create rejected source fixture");
            create_source(
                fixture.path(),
                application_id,
                HISTORICAL_SCHEMA_VERSION,
                complete,
            );
            assert!(open_bound(fixture.path()).is_err());
        }
    }
}
