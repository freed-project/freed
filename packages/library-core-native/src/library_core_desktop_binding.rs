use std::fs;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::OnceLock;

use rusqlite::{Connection, OpenFlags};

use crate::library_core_bound_root::LibraryCoreBoundRoot;
use crate::library_core_bound_sqlite_vfs::BoundSqliteDatabase;
use crate::{
    install_normalized_schema_v1, LibraryCoreJournal, LibraryCoreProcessLease, LibraryCoreStore,
    LibraryCoreStoreError, ProcessLeaseIdentity,
};

const LIBRARY_DIRECTORY: &str = "library-core";
const NORMALIZED_LIBRARY_DIRECTORY: &str = "library-sqlite";

fn normalized_open_flags(create: bool) -> OpenFlags {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_NO_MUTEX
        | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
        | OpenFlags::SQLITE_OPEN_NOFOLLOW
        | OpenFlags::SQLITE_OPEN_EXRESCODE;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    flags
}

fn configure_normalized_connection(connection: &Connection) -> Result<(), LibraryCoreStoreError> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA trusted_schema = OFF;
         PRAGMA busy_timeout = 5000;",
    )?;
    install_normalized_schema_v1(connection)
        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    Ok(())
}

/// Freed Desktop's descriptor-bound Library Core process binding.
///
/// The app-data pathname is consumed once. Every later SQLite, WAL, SHM,
/// journal, lease, and backup operation resolves from held directory handles.
pub struct LibraryCoreDesktopBinding {
    store: LibraryCoreStore,
    normalized_database: BoundSqliteDatabase,
    _lease: LibraryCoreProcessLease,
    _normalized_lease: LibraryCoreProcessLease,
    _library_root: LibraryCoreBoundRoot,
    _normalized_root: LibraryCoreBoundRoot,
    _app_root: LibraryCoreBoundRoot,
}

static DESKTOP_BINDING: OnceLock<LibraryCoreDesktopBinding> = OnceLock::new();

pub fn install_desktop_binding(
    binding: LibraryCoreDesktopBinding,
) -> Result<(), LibraryCoreStoreError> {
    DESKTOP_BINDING.set(binding).map_err(|_| {
        LibraryCoreStoreError::from("Desktop Library Core binding already installed".to_string())
    })
}

pub fn desktop_binding() -> Result<&'static LibraryCoreDesktopBinding, LibraryCoreStoreError> {
    DESKTOP_BINDING.get().ok_or_else(|| {
        LibraryCoreStoreError::from("Desktop Library Core binding is absent".to_string())
    })
}

impl LibraryCoreDesktopBinding {
    pub fn open(
        app_root: &Path,
        identity: ProcessLeaseIdentity<'static>,
    ) -> Result<Self, LibraryCoreStoreError> {
        Self::open_with_after_lease(app_root, identity, || {})
    }

    fn open_with_after_lease<F>(
        app_root: &Path,
        identity: ProcessLeaseIdentity<'static>,
        after_lease: F,
    ) -> Result<Self, LibraryCoreStoreError>
    where
        F: FnOnce(),
    {
        let app_parent = app_root.parent().ok_or_else(|| {
            LibraryCoreStoreError::from("Desktop Library Core app root has no parent".to_string())
        })?;
        let app_leaf = app_root
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                LibraryCoreStoreError::from(
                    "Desktop Library Core app root leaf is invalid".to_string(),
                )
            })?;
        fs::create_dir_all(app_parent)?;
        let descriptor = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(app_parent)?;
        let app_parent = LibraryCoreBoundRoot::from_inherited_descriptor(descriptor.as_raw_fd())?;
        let app_directory = app_parent.open_or_create_private_directory(app_leaf)?;
        let app_root = LibraryCoreBoundRoot::from_inherited_descriptor(app_directory.as_raw_fd())?;
        let library_directory = app_root.open_or_create_private_directory(LIBRARY_DIRECTORY)?;
        let library_root =
            LibraryCoreBoundRoot::from_inherited_descriptor(library_directory.as_raw_fd())?;
        let lease = LibraryCoreProcessLease::acquire_bound(&library_root, identity)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        after_lease();
        let normalized_directory =
            app_root.open_or_create_private_directory(NORMALIZED_LIBRARY_DIRECTORY)?;
        let normalized_root =
            LibraryCoreBoundRoot::from_inherited_descriptor(normalized_directory.as_raw_fd())?;
        let normalized_lease = LibraryCoreProcessLease::acquire_bound(&normalized_root, identity)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        let normalized_database =
            BoundSqliteDatabase::from_directory(normalized_directory.try_clone()?)?;
        let normalized_connection = normalized_database.open(normalized_open_flags(true))?;
        configure_normalized_connection(&normalized_connection)?;
        drop(normalized_connection);
        let backup_directory = app_root.open_or_create_private_directory("library-backups")?;
        let store = LibraryCoreStore::open_bound_directories(library_directory, backup_directory)?;
        Ok(Self {
            store,
            normalized_database,
            _lease: lease,
            _normalized_lease: normalized_lease,
            _library_root: library_root,
            _normalized_root: normalized_root,
            _app_root: app_root,
        })
    }

    pub fn connect(&self) -> Result<Connection, LibraryCoreStoreError> {
        self.store.connect()
    }

    /// Opens Freed Desktop's final normalized SQLite authority.
    pub fn connect_normalized(&self) -> Result<Connection, LibraryCoreStoreError> {
        let connection = self
            .normalized_database
            .open(normalized_open_flags(false))?;
        configure_normalized_connection(&connection)?;
        Ok(connection)
    }

    pub fn open_journal(&self) -> Result<LibraryCoreJournal, LibraryCoreStoreError> {
        self.store.open_bound_journal()
    }

    pub fn store(&self) -> &LibraryCoreStore {
        &self.store
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    const TEST_IDENTITY: ProcessLeaseIdentity<'static> =
        ProcessLeaseIdentity::new("desktop-binding-test", "1");

    #[test]
    fn library_replacement_after_lease_cannot_split_sqlite_from_the_lock() {
        let fixture = tempfile::TempDir::new().expect("create Desktop binding fixture");
        let app_root = fixture.path().join("app-data");
        fs::create_dir(&app_root).expect("create app root");
        fs::set_permissions(&app_root, fs::Permissions::from_mode(0o700))
            .expect("set app root permissions");
        let visible_library = app_root.join(LIBRARY_DIRECTORY);
        let moved_library = app_root.join("moved-library-core");
        let replacement = visible_library.clone();
        let moved = moved_library.clone();
        let binding =
            LibraryCoreDesktopBinding::open_with_after_lease(&app_root, TEST_IDENTITY, move || {
                fs::rename(&replacement, &moved).expect("move leased Library directory");
                fs::create_dir(&replacement).expect("create replacement Library directory");
                fs::set_permissions(&replacement, fs::Permissions::from_mode(0o700))
                    .expect("set replacement permissions");
                fs::write(replacement.join("sentinel"), b"replacement")
                    .expect("write replacement sentinel");
            })
            .expect("open bound Desktop authority");
        drop(binding.connect().expect("open bound Desktop database"));
        assert!(moved_library.join("library-core.sqlite").is_file());
        assert_eq!(
            fs::read(visible_library.join("sentinel")).expect("replacement sentinel"),
            b"replacement"
        );
        assert!(!visible_library.join("library-core.sqlite").exists());
        assert!(app_root
            .join(NORMALIZED_LIBRARY_DIRECTORY)
            .join("library-core.sqlite")
            .is_file());
        drop(
            binding
                .connect_normalized()
                .expect("open normalized Desktop database"),
        );
    }
}
