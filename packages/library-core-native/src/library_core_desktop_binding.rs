use std::fs;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::OnceLock;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::library_core_bound_root::LibraryCoreBoundRoot;
use crate::library_core_bound_sqlite_vfs::BoundSqliteDatabase;
use crate::library_core_canonical::encode_canonical_value;
use crate::{
    install_normalized_schema_v1, LibraryCoreJournal, LibraryCoreProcessLease, LibraryCoreStore,
    LibraryCoreStoreError, ProcessLeaseIdentity,
};

const LIBRARY_DIRECTORY: &str = "library-core";
const NORMALIZED_LIBRARY_DIRECTORY: &str = "library-sqlite";
const AUTHORITY_SELECTION_FILE: &str = "library-authority-selection-v1.json";
const AUTHORITY_SELECTION_MAXIMUM_BYTES: usize = 16_384;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopAuthoritySelectionV1 {
    format: String,
    library_id: String,
    epoch_id: String,
    transition_certificate_digest: String,
    normalized_product_digest: String,
    selected_at: u64,
}

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
    app_root: LibraryCoreBoundRoot,
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
            app_root,
        })
    }

    pub fn connect(&self) -> Result<Connection, LibraryCoreStoreError> {
        self.require_legacy_authority()?;
        self.store.connect()
    }

    /// Opens Freed Desktop's final normalized SQLite authority.
    pub fn connect_normalized(&self) -> Result<Connection, LibraryCoreStoreError> {
        self.authority_selection()?;
        let connection = self
            .normalized_database
            .open(normalized_open_flags(false))?;
        configure_normalized_connection(&connection)?;
        Ok(connection)
    }

    pub fn open_journal(&self) -> Result<LibraryCoreJournal, LibraryCoreStoreError> {
        self.require_legacy_authority()?;
        self.store.open_bound_journal()
    }

    pub fn store(&self) -> Result<&LibraryCoreStore, LibraryCoreStoreError> {
        self.require_legacy_authority()?;
        Ok(&self.store)
    }

    fn require_legacy_authority(&self) -> Result<(), LibraryCoreStoreError> {
        if self.authority_selection()?.is_some() {
            return Err(LibraryCoreStoreError::from(
                "historical Desktop Library authority is retired".to_string(),
            ));
        }
        Ok(())
    }

    fn authority_selection(
        &self,
    ) -> Result<Option<DesktopAuthoritySelectionV1>, LibraryCoreStoreError> {
        let Some(bytes) = self.app_root.read_bounded_private_file(
            AUTHORITY_SELECTION_FILE,
            AUTHORITY_SELECTION_MAXIMUM_BYTES,
        )?
        else {
            return Ok(None);
        };
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
            LibraryCoreStoreError::from("Desktop authority selection is invalid JSON".to_string())
        })?;
        let canonical =
            encode_canonical_value(&value, AUTHORITY_SELECTION_MAXIMUM_BYTES).map_err(|_| {
                LibraryCoreStoreError::from(
                    "Desktop authority selection is not canonical".to_string(),
                )
            })?;
        if canonical != bytes {
            return Err(LibraryCoreStoreError::from(
                "Desktop authority selection is not canonical".to_string(),
            ));
        }
        let selection: DesktopAuthoritySelectionV1 =
            serde_json::from_value(value).map_err(|_| {
                LibraryCoreStoreError::from(
                    "Desktop authority selection has an invalid field set".to_string(),
                )
            })?;
        self.verify_authority_selection(&selection)?;
        Ok(Some(selection))
    }

    fn verify_authority_selection(
        &self,
        selection: &DesktopAuthoritySelectionV1,
    ) -> Result<(), LibraryCoreStoreError> {
        let valid_digest = |value: &str| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        };
        if selection.format != "freed_desktop_sqlite_authority_selection_v1"
            || !valid_digest(&selection.library_id)
            || !valid_digest(&selection.epoch_id)
            || !valid_digest(&selection.transition_certificate_digest)
            || !valid_digest(&selection.normalized_product_digest)
            || selection.selected_at > 9_007_199_254_740_991
        {
            return Err(LibraryCoreStoreError::from(
                "Desktop authority selection identity is invalid".to_string(),
            ));
        }
        let connection = self
            .normalized_database
            .open(normalized_open_flags(false))?;
        configure_normalized_connection(&connection)?;
        let matches: i64 = connection.query_row(
            "SELECT count(*)
             FROM library_active_authority AS active
             JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
             JOIN library_meta AS meta ON meta.singleton_id = 1
             JOIN library_materialization_generation AS generation ON generation.singleton_id = 1
             WHERE active.active_key = 'active'
               AND active.library_id = ?1
               AND active.epoch_id = ?2
               AND epoch.transition_certificate_digest = ?3
               AND epoch.materialized_state_digest = ?4
               AND generation.generation_id = ?4
               AND epoch.accepted_at = ?5
               AND meta.library_id = active.library_id
               AND meta.authority_epoch = active.epoch_id;",
            rusqlite::params![
                &selection.library_id,
                &selection.epoch_id,
                &selection.transition_certificate_digest,
                &selection.normalized_product_digest,
                i64::try_from(selection.selected_at).map_err(|_| {
                    LibraryCoreStoreError::from(
                        "Desktop authority selection time is invalid".to_string(),
                    )
                })?,
            ],
            |row| row.get(0),
        )?;
        if matches != 1 {
            return Err(LibraryCoreStoreError::from(
                "Desktop authority selection does not match normalized SQLite".to_string(),
            ));
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn write_authority_selection(
        &self,
        selection: &DesktopAuthoritySelectionV1,
    ) -> Result<(), LibraryCoreStoreError> {
        if let Some(existing) = self.authority_selection()? {
            if existing == *selection {
                return Ok(());
            }
            return Err(LibraryCoreStoreError::from(
                "Desktop authority selection already names another epoch".to_string(),
            ));
        }
        self.verify_authority_selection(selection)?;
        let value = serde_json::to_value(selection).map_err(|_| {
            LibraryCoreStoreError::from("Desktop authority selection is invalid".to_string())
        })?;
        let canonical =
            encode_canonical_value(&value, AUTHORITY_SELECTION_MAXIMUM_BYTES).map_err(|_| {
                LibraryCoreStoreError::from(
                    "Desktop authority selection cannot be canonicalized".to_string(),
                )
            })?;
        self.app_root.write_new_private_file_atomically(
            AUTHORITY_SELECTION_FILE,
            ".library-authority-selection-v1.pending",
            &canonical,
            AUTHORITY_SELECTION_MAXIMUM_BYTES,
        )?;
        if self.authority_selection()?.as_ref() != Some(selection) {
            return Err(LibraryCoreStoreError::from(
                "Desktop authority selection did not read back exactly".to_string(),
            ));
        }
        Ok(())
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

    #[test]
    fn verified_selector_fences_every_historical_opening_path() {
        let fixture = tempfile::TempDir::new().expect("create Desktop selector fixture");
        let app_root = fixture.path().join("app-data");
        fs::create_dir(&app_root).expect("create app root");
        fs::set_permissions(&app_root, fs::Permissions::from_mode(0o700))
            .expect("set app root permissions");
        let binding = LibraryCoreDesktopBinding::open(&app_root, TEST_IDENTITY)
            .expect("open Desktop binding");
        let normalized = binding
            .connect_normalized()
            .expect("open normalized database");
        normalized
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES (?1, ?2, 4, ?3, ?4, ?5, '{}', 0, ?6, ?7, 400);",
                rusqlite::params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(64),
                    "d".repeat(64),
                    "e".repeat(64),
                    "f".repeat(64),
                    "1".repeat(64),
                ],
            )
            .expect("insert authority epoch");
        normalized
            .execute(
                "INSERT INTO library_active_authority
                 (active_key, library_id, epoch_id, writer_id,
                  accepted_manifest_generation, activated_at)
                 VALUES ('active', ?1, ?2, 'primary:desktop', 0, 400);",
                rusqlite::params!["b".repeat(64), "a".repeat(64)],
            )
            .expect("insert active authority");
        normalized
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch,
                  source_revision, updated_at)
                 VALUES (1, ?1, 1, ?2, 0, 400);",
                rusqlite::params!["b".repeat(64), "a".repeat(64)],
            )
            .expect("insert meta");
        normalized
            .execute(
                "INSERT INTO library_materialization_generation
                 (singleton_id, generation_id) VALUES (1, ?1);",
                ["1".repeat(64)],
            )
            .expect("insert generation");
        drop(normalized);
        let selection = DesktopAuthoritySelectionV1 {
            format: "freed_desktop_sqlite_authority_selection_v1".to_owned(),
            library_id: "b".repeat(64),
            epoch_id: "a".repeat(64),
            transition_certificate_digest: "e".repeat(64),
            normalized_product_digest: "1".repeat(64),
            selected_at: 400,
        };
        binding
            .write_authority_selection(&selection)
            .expect("write selector");
        binding
            .write_authority_selection(&selection)
            .expect("replay exact selector");

        assert!(binding.connect().is_err());
        assert!(binding.open_journal().is_err());
        assert!(binding.store().is_err());
        drop(
            binding
                .connect_normalized()
                .expect("selected normalized database remains available"),
        );
    }
}
