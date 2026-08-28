use crate::library_core_journal::LibraryCoreJournal;
use rusqlite::{Connection, OpenFlags};
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
    ) -> LibraryCoreStorageResult<Self> {
        let database = BoundSqliteDatabase::from_directory(library_directory.try_clone()?)?;
        let bound = Arc::new(BoundStoreRoot {
            library_directory,
            database,
        });
        drop(
            LibraryCoreJournal::open_bound(&bound.database)
                .map_err(|error| LibraryCoreStorageError(error.to_string()))?,
        );
        Ok(Self {
            root: PathBuf::from("."),
            bound: Some(bound),
        })
    }

    pub(crate) fn connect(&self) -> LibraryCoreStorageResult<Connection> {
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
    pub(crate) fn open_bound_journal(&self) -> LibraryCoreStorageResult<LibraryCoreJournal> {
        let bound = self.require_bound()?;
        LibraryCoreJournal::open_bound(&bound.database)
            .map_err(|error| LibraryCoreStorageError(error.to_string()))
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
