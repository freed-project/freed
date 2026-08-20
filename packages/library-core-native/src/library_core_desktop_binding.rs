use std::fs;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::OnceLock;

use rusqlite::Connection;

use crate::library_core_bound_root::LibraryCoreBoundRoot;
use crate::{
    LibraryCoreJournal, LibraryCoreProcessLease, LibraryCoreStore, LibraryCoreStoreError,
    ProcessLeaseIdentity,
};

const LIBRARY_DIRECTORY: &str = "library-core";

/// Freed Desktop's one descriptor-bound Library Core authority handle.
///
/// The app-data pathname is consumed once. Every later SQLite, WAL, SHM,
/// journal, lease, and backup operation resolves from held directory handles.
pub struct LibraryCoreDesktopBinding {
    store: LibraryCoreStore,
    _lease: LibraryCoreProcessLease,
    _library_root: LibraryCoreBoundRoot,
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
        let backup_directory = app_root.open_or_create_private_directory("library-backups")?;
        let store = LibraryCoreStore::open_bound_directories(library_directory, backup_directory)?;
        Ok(Self {
            store,
            _lease: lease,
            _library_root: library_root,
            _app_root: app_root,
        })
    }

    pub fn connect(&self) -> Result<Connection, LibraryCoreStoreError> {
        self.store.connect()
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
    }
}
