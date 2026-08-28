use std::fs;
use std::io::Read;
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::library_core_bound_root::LibraryCoreBoundRoot;
use crate::library_core_bound_sqlite_vfs::BoundSqliteDatabase;
use crate::library_core_canonical::encode_canonical_value;
use crate::library_core_content_vault::LibraryCoreContentVault;
use crate::normalized_sqlite::{
    configure_normalized_sqlite_connection, normalized_sqlite_open_flags,
};
use crate::{
    page_eviction_candidates_v1, page_hydration_candidates_v1,
    publish_content_range_from_reader_v1, set_content_policy_v1, ActorKeyStore, AuthorityKeyStore,
    ContentCompletionReceiptV1, ContentCompletionRequestV1, ContentEvictionReceiptV1,
    ContentEvictionRequestV1, ContentHydrationPolicyV1, ContentPolicyMutationReceiptV1,
    ContentPolicyMutationV1, ContentRangePublicationRequestV1, ContentRangeReadRequestV1,
    ContentRangeReadResponseV1, EvictionCandidatePageRequestV1, EvictionCandidatePageV1,
    HydrationCandidatePageRequestV1, HydrationCandidatePageV1, LibraryCoreJournal,
    LibraryCoreProcessLease, LibraryCoreStore, LibraryCoreStoreError,
    NormalizedDesktopAuthorityPreparedV1, NormalizedLocalSnapshotReasonV1,
    NormalizedLocalSnapshotSummaryV1, ProcessLeaseIdentity, VerifiedContentRangeReceiptV1,
};

const LIBRARY_DIRECTORY: &str = "library-core";
const NORMALIZED_LIBRARY_DIRECTORY: &str = "library-sqlite";
const CONTENT_VAULT_DIRECTORY: &str = "library-content-vault";
const SNAPSHOT_DIRECTORY: &str = "library-snapshots";
const AUTHORITY_SELECTION_FILE: &str = "library-authority-selection-v1.json";
const AUTHORITY_SELECTION_MAXIMUM_BYTES: usize = 16_384;
const FACTORY_RESET_PENDING_FILE: &str = "library-factory-reset-pending-v1.json";
const HISTORICAL_IMPORT_RETIRED_FILE: &str = "library-historical-import-retired-v1.json";
const CONTROL_FILE_MAXIMUM_BYTES: usize = 1_024;
const FACTORY_RESET_PENDING_BYTES: &[u8] =
    br#"{"format":"freed_desktop_library_factory_reset_pending_v1"}"#;
const HISTORICAL_IMPORT_RETIRED_BYTES: &[u8] =
    br#"{"format":"freed_desktop_historical_import_retired_v1","reason":"factory_reset"}"#;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopAuthoritySelectionV1 {
    format: String,
    library_id: String,
}

/// Freed Desktop's descriptor-bound Library Core process binding.
///
/// The app-data pathname is consumed once. Every later SQLite, WAL, SHM,
/// journal, lease, snapshot, and content operation resolves from held directory handles.
pub struct LibraryCoreDesktopBinding {
    content_vault: LibraryCoreContentVault,
    snapshot_directory: OwnedFd,
    historical_store: Option<LibraryCoreStore>,
    normalized_database: BoundSqliteDatabase,
    _historical_lease: Option<LibraryCoreProcessLease>,
    _normalized_lease: LibraryCoreProcessLease,
    _historical_root: Option<LibraryCoreBoundRoot>,
    _normalized_root: LibraryCoreBoundRoot,
    app_root: LibraryCoreBoundRoot,
    reset_gate: Mutex<()>,
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
        let historical_import_retired = exact_control_file_is_present(
            &app_root,
            HISTORICAL_IMPORT_RETIRED_FILE,
            HISTORICAL_IMPORT_RETIRED_BYTES,
        )?;
        let historical_directory = if historical_import_retired {
            None
        } else {
            app_root.open_private_directory_if_present(LIBRARY_DIRECTORY)?
        };
        let (historical_store, historical_lease, historical_root) =
            if let Some(historical_directory) = historical_directory {
                let historical_root = LibraryCoreBoundRoot::from_inherited_descriptor(
                    historical_directory.as_raw_fd(),
                )?;
                let historical_lease =
                    LibraryCoreProcessLease::acquire_bound(&historical_root, identity)
                        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
                after_lease();
                let historical_store =
                    LibraryCoreStore::open_bound_directory(historical_directory)?;
                (
                    Some(historical_store),
                    Some(historical_lease),
                    Some(historical_root),
                )
            } else {
                (None, None, None)
            };
        let normalized_directory =
            app_root.open_or_create_private_directory(NORMALIZED_LIBRARY_DIRECTORY)?;
        let normalized_root =
            LibraryCoreBoundRoot::from_inherited_descriptor(normalized_directory.as_raw_fd())?;
        let normalized_lease = LibraryCoreProcessLease::acquire_bound(&normalized_root, identity)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        let normalized_database =
            BoundSqliteDatabase::from_directory(normalized_directory.try_clone()?)?;
        let content_vault_directory =
            app_root.open_or_create_private_directory(CONTENT_VAULT_DIRECTORY)?;
        let content_vault = LibraryCoreContentVault::from_directory(content_vault_directory)?;
        let snapshot_directory = app_root.open_or_create_private_directory(SNAPSHOT_DIRECTORY)?;
        let binding = Self {
            content_vault,
            snapshot_directory,
            historical_store,
            normalized_database,
            _historical_lease: historical_lease,
            _normalized_lease: normalized_lease,
            _historical_root: historical_root,
            _normalized_root: normalized_root,
            app_root,
            reset_gate: Mutex::new(()),
        };
        if binding.factory_reset_is_pending_v1()? {
            binding.complete_pending_factory_reset_v1()?;
        }
        let mut normalized_connection = binding
            .normalized_database
            .open(normalized_sqlite_open_flags(true))?;
        configure_normalized_sqlite_connection(&normalized_connection)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        binding
            .content_vault
            .reconcile_v1(&mut normalized_connection)?;
        drop(normalized_connection);
        Ok(binding)
    }

    pub fn connect(&self) -> Result<Connection, LibraryCoreStoreError> {
        self.require_historical_source()?.connect()
    }

    /// Opens Freed Desktop's final normalized SQLite authority.
    pub fn connect_normalized(&self) -> Result<Connection, LibraryCoreStoreError> {
        self.require_factory_reset_complete_v1()?;
        self.authority_selection()?;
        let connection = self
            .normalized_database
            .open(normalized_sqlite_open_flags(false))?;
        configure_normalized_sqlite_connection(&connection)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        Ok(connection)
    }

    /// Opens normalized SQLite only after its authority selector is verified.
    pub fn connect_selected_normalized(&self) -> Result<Connection, LibraryCoreStoreError> {
        self.require_factory_reset_complete_v1()?;
        if self.authority_selection()?.is_none() {
            return Err(LibraryCoreStoreError::from(
                "normalized SQLite authority is not selected".to_string(),
            ));
        }
        let connection = self
            .normalized_database
            .open(normalized_sqlite_open_flags(false))?;
        configure_normalized_sqlite_connection(&connection)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        Ok(connection)
    }

    pub fn publish_content_range_from_reader_v1<R: Read>(
        &self,
        publication_id: &str,
        request: &ContentRangePublicationRequestV1,
        reader: &mut R,
    ) -> Result<VerifiedContentRangeReceiptV1, LibraryCoreStoreError> {
        let mut connection = self.connect_selected_normalized()?;
        let range_digest = connection
            .query_row(
                "SELECT range_digest FROM library_content_ranges
                 WHERE content_digest = ?1 COLLATE BINARY AND range_index = ?2;",
                rusqlite::params![request.content_digest, request.range_index],
                |row| row.get::<_, String>(0),
            )
            .map_err(LibraryCoreStoreError::from)?;
        let mut object = self.content_vault.create_range_object_v1(
            publication_id,
            &request.content_digest,
            request.range_index,
            &range_digest,
        )?;
        publish_content_range_from_reader_v1(&mut connection, request, reader, &mut object)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    pub fn read_content_range_v1(
        &self,
        request: &ContentRangeReadRequestV1,
    ) -> Result<ContentRangeReadResponseV1, LibraryCoreStoreError> {
        let connection = self.connect_selected_normalized()?;
        self.content_vault.read_range_v1(&connection, request)
    }

    pub fn verify_complete_content_v1(
        &self,
        request: &ContentCompletionRequestV1,
    ) -> Result<ContentCompletionReceiptV1, LibraryCoreStoreError> {
        let mut connection = self.connect_selected_normalized()?;
        self.content_vault
            .verify_complete_v1(&mut connection, request)
    }

    pub fn evict_content_v1(
        &self,
        request: &ContentEvictionRequestV1,
    ) -> Result<ContentEvictionReceiptV1, LibraryCoreStoreError> {
        let mut connection = self.connect_selected_normalized()?;
        self.content_vault.evict_v1(&mut connection, request)
    }

    pub fn page_hydration_candidates_v1(
        &self,
        request: &HydrationCandidatePageRequestV1,
    ) -> Result<HydrationCandidatePageV1, LibraryCoreStoreError> {
        let connection = self.connect_selected_normalized()?;
        page_hydration_candidates_v1(&connection, request)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    pub fn page_eviction_candidates_v1(
        &self,
        request: &EvictionCandidatePageRequestV1,
    ) -> Result<EvictionCandidatePageV1, LibraryCoreStoreError> {
        let connection = self.connect_selected_normalized()?;
        page_eviction_candidates_v1(&connection, request)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    pub fn mutate_content_policy_v1(
        &self,
        mutation: &ContentPolicyMutationV1,
    ) -> Result<ContentPolicyMutationReceiptV1, LibraryCoreStoreError> {
        let mut connection = self.connect_selected_normalized()?;
        let mut receipt = set_content_policy_v1(&mut connection, mutation)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        if mutation.policy == ContentHydrationPolicyV1::Excluded {
            receipt.content_revision = self
                .content_vault
                .evict_v1(
                    &mut connection,
                    &ContentEvictionRequestV1 {
                        content_digest: mutation.content_digest.clone(),
                        evicted_at: mutation.updated_at,
                        expected_last_accessed_at: None,
                        reason: "excluded".to_string(),
                        schema_version: 1,
                    },
                )?
                .content_revision;
        }
        Ok(receipt)
    }

    pub fn create_normalized_local_snapshot_v1(
        &self,
        created_at_ms: u64,
        reason: NormalizedLocalSnapshotReasonV1,
    ) -> Result<NormalizedLocalSnapshotSummaryV1, LibraryCoreStoreError> {
        let mut connection = self.connect_selected_normalized()?;
        crate::normalized_snapshot::create_normalized_local_snapshot_bound_v1(
            &mut connection,
            self.snapshot_directory.as_raw_fd(),
            created_at_ms,
            reason,
        )
        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    pub fn list_normalized_local_snapshots_v1(
        &self,
    ) -> Result<Vec<NormalizedLocalSnapshotSummaryV1>, LibraryCoreStoreError> {
        crate::normalized_snapshot::list_normalized_local_snapshots_bound_v1(
            self.snapshot_directory.as_raw_fd(),
        )
        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn restore_normalized_local_snapshot_v1(
        &self,
        snapshot_id: &str,
        installation_witness: &str,
        actor_store: &dyn ActorKeyStore,
        authority_store: &dyn AuthorityKeyStore,
        operation_id: &str,
        restored_at_ms: u64,
    ) -> Result<NormalizedLocalSnapshotSummaryV1, LibraryCoreStoreError> {
        let mut connection = self.connect_selected_normalized()?;
        crate::normalized_snapshot::restore_normalized_local_snapshot_bound_v1(
            &mut connection,
            self.snapshot_directory.as_raw_fd(),
            snapshot_id,
            installation_witness,
            actor_store,
            authority_store,
            operation_id,
            restored_at_ms,
        )
        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    pub fn clear_normalized_local_snapshots_v1(&self) -> Result<(), LibraryCoreStoreError> {
        crate::normalized_snapshot::clear_normalized_local_snapshots_bound_v1(
            self.snapshot_directory.as_raw_fd(),
        )
        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))
    }

    pub fn normalized_authority_is_selected_v1(&self) -> Result<bool, LibraryCoreStoreError> {
        self.require_factory_reset_complete_v1()?;
        Ok(self.authority_selection()?.is_some())
    }

    pub fn open_journal(&self) -> Result<LibraryCoreJournal, LibraryCoreStoreError> {
        self.require_historical_source()?.open_bound_journal()
    }

    pub fn store(&self) -> Result<&LibraryCoreStore, LibraryCoreStoreError> {
        self.require_historical_source()
    }

    pub fn historical_source_is_present_v1(&self) -> bool {
        self.historical_store.is_some()
            && self
                .historical_import_is_retired_v1()
                .is_ok_and(|retired| !retired)
    }

    fn require_historical_source(&self) -> Result<&LibraryCoreStore, LibraryCoreStoreError> {
        self.require_factory_reset_complete_v1()?;
        if self.historical_import_is_retired_v1()? {
            return Err(LibraryCoreStoreError::from(
                "historical Desktop migration source is retired".to_string(),
            ));
        }
        if self.authority_selection()?.is_some() {
            return Err(LibraryCoreStoreError::from(
                "historical Desktop migration source is fenced after SQLite selection".to_string(),
            ));
        }
        self.historical_store.as_ref().ok_or_else(|| {
            LibraryCoreStoreError::from("historical Desktop migration source is absent".to_string())
        })
    }

    pub fn reset_normalized_library_v1(&self) -> Result<(), LibraryCoreStoreError> {
        let _reset = self.reset_gate.lock().map_err(|_| {
            LibraryCoreStoreError::from("Desktop Library reset gate is poisoned".to_string())
        })?;
        self.app_root.write_new_private_file_atomically(
            FACTORY_RESET_PENDING_FILE,
            ".library-factory-reset-pending-v1.pending",
            FACTORY_RESET_PENDING_BYTES,
            CONTROL_FILE_MAXIMUM_BYTES,
        )?;
        self.complete_pending_factory_reset_v1()
    }

    fn complete_pending_factory_reset_v1(&self) -> Result<(), LibraryCoreStoreError> {
        if !self.factory_reset_is_pending_v1()? {
            return Err(LibraryCoreStoreError::from(
                "Desktop Library factory reset marker is absent".to_string(),
            ));
        }
        self.app_root
            .remove_private_file(AUTHORITY_SELECTION_FILE)?;
        if let Some(store) = &self.historical_store {
            store.clear_bound_all()?;
        }
        self.normalized_database.clear_files()?;
        self.content_vault.clear_all_v1()?;
        crate::normalized_snapshot::clear_normalized_local_snapshots_bound_v1(
            self.snapshot_directory.as_raw_fd(),
        )
        .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        self.app_root.write_new_private_file_atomically(
            HISTORICAL_IMPORT_RETIRED_FILE,
            ".library-historical-import-retired-v1.pending",
            HISTORICAL_IMPORT_RETIRED_BYTES,
            CONTROL_FILE_MAXIMUM_BYTES,
        )?;
        self.app_root
            .remove_private_file(FACTORY_RESET_PENDING_FILE)?;
        Ok(())
    }

    fn factory_reset_is_pending_v1(&self) -> Result<bool, LibraryCoreStoreError> {
        exact_control_file_is_present(
            &self.app_root,
            FACTORY_RESET_PENDING_FILE,
            FACTORY_RESET_PENDING_BYTES,
        )
    }

    fn historical_import_is_retired_v1(&self) -> Result<bool, LibraryCoreStoreError> {
        exact_control_file_is_present(
            &self.app_root,
            HISTORICAL_IMPORT_RETIRED_FILE,
            HISTORICAL_IMPORT_RETIRED_BYTES,
        )
    }

    fn require_factory_reset_complete_v1(&self) -> Result<(), LibraryCoreStoreError> {
        if self.factory_reset_is_pending_v1()? {
            return Err(LibraryCoreStoreError::from(
                "Desktop Library factory reset is pending".to_string(),
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
        {
            return Err(LibraryCoreStoreError::from(
                "Desktop authority selection identity is invalid".to_string(),
            ));
        }
        let connection = self
            .normalized_database
            .open(normalized_sqlite_open_flags(false))?;
        configure_normalized_sqlite_connection(&connection)
            .map_err(|error| LibraryCoreStoreError::from(error.to_string()))?;
        let matches: i64 = connection.query_row(
            "SELECT count(*)
             FROM library_active_authority AS active
             JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
             JOIN library_meta AS meta ON meta.singleton_id = 1
             JOIN library_materialization_generation AS generation ON generation.singleton_id = 1
             WHERE active.active_key = 'active'
               AND active.library_id = ?1
               AND meta.library_id = active.library_id
               AND meta.authority_epoch = active.epoch_id
               AND epoch.library_id = active.library_id
               AND epoch.materialized_state_digest = generation.generation_id;",
            [&selection.library_id],
            |row| row.get(0),
        )?;
        if matches != 1 {
            return Err(LibraryCoreStoreError::from(
                "Desktop authority selection does not match normalized SQLite".to_string(),
            ));
        }
        Ok(())
    }

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

    pub fn publish_normalized_authority_selection_v1(
        &self,
        prepared: &NormalizedDesktopAuthorityPreparedV1,
    ) -> Result<(), LibraryCoreStoreError> {
        if prepared.format != "freed_normalized_desktop_authority_prepared_v1"
            || prepared.primary_actor_id.is_empty()
        {
            return Err(LibraryCoreStoreError::from(
                "Desktop normalized cutover receipt is invalid".to_string(),
            ));
        }
        self.write_authority_selection(&DesktopAuthoritySelectionV1 {
            format: "freed_desktop_sqlite_authority_selection_v1".to_owned(),
            library_id: prepared.library_id.clone(),
        })
    }
}

fn exact_control_file_is_present(
    root: &LibraryCoreBoundRoot,
    name: &str,
    expected: &[u8],
) -> Result<bool, LibraryCoreStoreError> {
    let Some(bytes) = root.read_bounded_private_file(name, CONTROL_FILE_MAXIMUM_BYTES)? else {
        return Ok(false);
    };
    if bytes != expected {
        return Err(LibraryCoreStoreError::from(
            "Desktop Library control file has unexpected bytes".to_string(),
        ));
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::os::unix::fs::PermissionsExt;

    use sha2::{Digest, Sha256};

    use super::*;

    const TEST_IDENTITY: ProcessLeaseIdentity<'static> =
        ProcessLeaseIdentity::new("desktop-binding-test", "1");

    fn install_test_selected_authority(
        binding: &LibraryCoreDesktopBinding,
        library_id: &str,
        epoch_id: &str,
    ) {
        let normalized = binding
            .connect_normalized()
            .expect("open normalized test database");
        normalized
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 0, ?6, ?7, 400);",
                rusqlite::params![
                    epoch_id,
                    library_id,
                    "c".repeat(64),
                    "d".repeat(64),
                    "e".repeat(64),
                    "f".repeat(64),
                    "1".repeat(64),
                ],
            )
            .expect("insert test authority epoch");
        normalized
            .execute(
                "INSERT INTO library_active_authority
                 (active_key, library_id, epoch_id, writer_id,
                  accepted_manifest_generation, activated_at)
                 VALUES ('active', ?1, ?2, 'primary:desktop', 0, 400);",
                rusqlite::params![library_id, epoch_id],
            )
            .expect("insert active test authority");
        normalized
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch,
                  source_revision, updated_at)
                 VALUES (1, ?1, 1, ?2, 0, 400);",
                rusqlite::params![library_id, epoch_id],
            )
            .expect("insert test metadata");
        normalized
            .execute(
                "INSERT INTO library_materialization_generation
                 (singleton_id, generation_id) VALUES (1, ?1);",
                ["1".repeat(64)],
            )
            .expect("insert test generation");
        drop(normalized);
        binding
            .publish_normalized_authority_selection_v1(&NormalizedDesktopAuthorityPreparedV1 {
                format: "freed_normalized_desktop_authority_prepared_v1".to_owned(),
                library_id: library_id.to_owned(),
                epoch_id: epoch_id.to_owned(),
                transition_certificate_digest: "e".repeat(64),
                normalized_product_digest: "1".repeat(64),
                selected_at: 400,
                primary_actor_id: "primary-actor".to_owned(),
            })
            .expect("publish test authority selector");
    }

    #[test]
    fn library_replacement_after_lease_cannot_split_sqlite_from_the_lock() {
        let fixture = tempfile::TempDir::new().expect("create Desktop binding fixture");
        let app_root = fixture.path().join("app-data");
        fs::create_dir(&app_root).expect("create app root");
        fs::set_permissions(&app_root, fs::Permissions::from_mode(0o700))
            .expect("set app root permissions");
        let visible_library = app_root.join(LIBRARY_DIRECTORY);
        let moved_library = app_root.join("moved-library-core");
        fs::create_dir(&visible_library).expect("create historical Library directory");
        fs::set_permissions(&visible_library, fs::Permissions::from_mode(0o700))
            .expect("set historical Library permissions");
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
        assert!(binding.connect_selected_normalized().is_err());
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
        };
        let prepared = NormalizedDesktopAuthorityPreparedV1 {
            format: "freed_normalized_desktop_authority_prepared_v1".to_owned(),
            library_id: selection.library_id.clone(),
            epoch_id: "a".repeat(64),
            transition_certificate_digest: "e".repeat(64),
            normalized_product_digest: "1".repeat(64),
            selected_at: 400,
            primary_actor_id: "primary-actor".to_owned(),
        };
        binding
            .publish_normalized_authority_selection_v1(&prepared)
            .expect("publish selector from prepared receipt");
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
        drop(
            binding
                .connect_selected_normalized()
                .expect("selected authority opening remains available"),
        );
        let bytes = b"descriptor-bound content range".to_vec();
        let mut digest = Sha256::new();
        digest.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
        digest.update(&bytes);
        let content_digest = crate::lower_hex(&digest.finalize());
        let normalized = binding
            .connect_selected_normalized()
            .expect("open selected authority for content descriptor");
        normalized
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, storage_layout, chunk_bytes, chunk_count,
                    range_count, range_granularity, range_index_root_digest, rendition_id,
                    cloud_availability_commitment, media_type)
                 VALUES (?1, ?2, 'authenticated_ranges', 0, 0, 1, ?2, ?3,
                         'original', ?4, 'application/octet-stream');",
                rusqlite::params![
                    content_digest,
                    i64::try_from(bytes.len()).expect("range length"),
                    "7".repeat(64),
                    "8".repeat(64),
                ],
            )
            .expect("insert content descriptor");
        normalized
            .execute(
                "INSERT INTO library_content_ranges
                   (content_digest, range_index, byte_offset, byte_length, range_digest)
                 VALUES (?1, 0, 0, ?2, ?1);",
                rusqlite::params![
                    content_digest,
                    i64::try_from(bytes.len()).expect("range length")
                ],
            )
            .expect("insert content range");
        drop(normalized);
        let visible_vault = app_root.join(CONTENT_VAULT_DIRECTORY);
        let moved_vault = app_root.join("moved-library-content-vault");
        fs::rename(&visible_vault, &moved_vault).expect("move bound content vault");
        fs::create_dir(&visible_vault).expect("create replacement content vault");
        fs::set_permissions(&visible_vault, fs::Permissions::from_mode(0o700))
            .expect("set replacement vault permissions");
        fs::write(visible_vault.join("sentinel"), b"replacement")
            .expect("write replacement vault sentinel");
        let receipt = binding
            .publish_content_range_from_reader_v1(
                &"9".repeat(64),
                &ContentRangePublicationRequestV1 {
                    content_digest: content_digest.clone(),
                    range_index: 0,
                    schema_version: 1,
                    verified_at: 600,
                },
                &mut Cursor::new(bytes.clone()),
            )
            .expect("publish descriptor-bound content range");
        assert!(receipt.changed);
        let storage_key = binding
            .connect_selected_normalized()
            .expect("open selected authority for content proof")
            .query_row(
                "SELECT storage_key FROM library_device_content_ranges
                 WHERE content_digest = ?1 AND range_index = 0;",
                [&content_digest],
                |row| row.get::<_, String>(0),
            )
            .expect("registered content vault key");
        assert_eq!(
            storage_key,
            format!("range-{content_digest}-0-{content_digest}.bin")
        );
        let range_read = binding
            .read_content_range_v1(&ContentRangeReadRequestV1 {
                accessed_at: 600,
                content_digest: content_digest.clone(),
                maximum_bytes: 3,
                range_index: 0,
                range_offset: 1,
                schema_version: 1,
            })
            .expect("read descriptor-bound content range");
        assert_eq!(range_read.bytes, bytes[1..4]);
        assert_eq!(range_read.next_range_offset, 4);
        assert!(!range_read.range_complete);
        let completion = binding
            .verify_complete_content_v1(&ContentCompletionRequestV1 {
                content_digest: content_digest.clone(),
                schema_version: 1,
                verified_at: 601,
            })
            .expect("verify complete descriptor-bound content");
        assert_eq!(
            completion.hydration_state,
            crate::ContentHydrationStateV1::FullyCached
        );
        assert_eq!(
            completion.verified_bytes,
            i64::try_from(bytes.len()).expect("content bytes")
        );
        assert_eq!(
            fs::read(moved_vault.join(&storage_key)).expect("bound range bytes"),
            bytes
        );
        let mut changed_bytes = bytes.clone();
        changed_bytes[0] ^= 1;
        fs::write(moved_vault.join(&storage_key), changed_bytes)
            .expect("change cached range after completion");
        let error = binding
            .verify_complete_content_v1(&ContentCompletionRequestV1 {
                content_digest: content_digest.clone(),
                schema_version: 1,
                verified_at: 602,
            })
            .expect_err("changed complete content must fail");
        assert!(error
            .to_string()
            .contains("complete content digest is invalid"));
        assert_eq!(
            binding
                .connect_selected_normalized()
                .expect("open corrupt content state")
                .query_row(
                    "SELECT hydration_state FROM library_device_content_availability
                     WHERE content_digest = ?1;",
                    [&content_digest],
                    |row| row.get::<_, String>(0),
                )
                .expect("corrupt content state"),
            "corrupt"
        );
        assert!(!visible_vault.join(&storage_key).exists());
        assert_eq!(
            fs::read(visible_vault.join("sentinel")).expect("replacement vault sentinel"),
            b"replacement"
        );
        binding
            .mutate_content_policy_v1(&ContentPolicyMutationV1 {
                content_digest: content_digest.clone(),
                policy: ContentHydrationPolicyV1::PinnedOffline,
                schema_version: 1,
                updated_at: 603,
            })
            .expect("pin corrupt local bytes");
        let pinned_error = binding
            .evict_content_v1(&ContentEvictionRequestV1 {
                content_digest: content_digest.clone(),
                evicted_at: 604,
                expected_last_accessed_at: None,
                reason: "explicit".to_string(),
                schema_version: 1,
            })
            .expect_err("pinned content must resist eviction");
        assert!(pinned_error.to_string().contains("must be unpinned"));
        assert!(moved_vault.join(&storage_key).exists());
        let excluded = binding
            .mutate_content_policy_v1(&ContentPolicyMutationV1 {
                content_digest: content_digest.clone(),
                policy: ContentHydrationPolicyV1::Excluded,
                schema_version: 1,
                updated_at: 605,
            })
            .expect("exclude and evict local content");
        assert_eq!(excluded.policy, ContentHydrationPolicyV1::Excluded);
        assert!(!moved_vault.join(&storage_key).exists());
        assert_eq!(
            binding
                .connect_selected_normalized()
                .expect("open excluded content state")
                .query_row(
                    "SELECT count(*) FROM library_device_content_ranges
                     WHERE content_digest = ?1;",
                    [&content_digest],
                    |row| row.get::<_, i64>(0),
                )
                .expect("excluded content range count"),
            0
        );
        let normalized = binding
            .connect_selected_normalized()
            .expect("open selected authority for epoch advance");
        normalized
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES (?1, ?2, 5, ?3, ?4, ?5, '{}', 0, ?6, ?7, 500);",
                rusqlite::params![
                    "2".repeat(64),
                    "b".repeat(64),
                    "3".repeat(64),
                    "4".repeat(64),
                    "5".repeat(64),
                    "6".repeat(64),
                    "1".repeat(64),
                ],
            )
            .expect("insert next authority epoch");
        normalized
            .execute(
                "UPDATE library_active_authority SET epoch_id = ?1, activated_at = 500
                 WHERE active_key = 'active';",
                ["2".repeat(64)],
            )
            .expect("advance active authority");
        normalized
            .execute(
                "UPDATE library_meta SET authority_epoch = ?1, updated_at = 500
                 WHERE singleton_id = 1;",
                ["2".repeat(64)],
            )
            .expect("advance metadata authority");
        drop(normalized);
        drop(
            binding
                .connect_selected_normalized()
                .expect("stable selector accepts a verified authority advance"),
        );
    }

    #[test]
    fn fresh_binding_creates_only_the_normalized_sqlite_store() {
        let fixture = tempfile::TempDir::new().expect("create fresh Desktop fixture");
        let app_root = fixture.path().join("app-data");
        fs::create_dir(&app_root).expect("create app root");
        fs::set_permissions(&app_root, fs::Permissions::from_mode(0o700))
            .expect("set app root permissions");

        let binding = LibraryCoreDesktopBinding::open(&app_root, TEST_IDENTITY)
            .expect("open fresh Desktop binding");

        assert!(!binding.historical_source_is_present_v1());
        assert!(!app_root.join(LIBRARY_DIRECTORY).exists());
        assert!(binding.connect().is_err());
        assert!(app_root
            .join(NORMALIZED_LIBRARY_DIRECTORY)
            .join("library-core.sqlite")
            .is_file());
    }

    #[test]
    fn factory_reset_clears_bound_normalized_state_and_retires_historical_import() {
        let fixture = tempfile::TempDir::new().expect("create Desktop reset fixture");
        let app_root = fixture.path().join("app-data");
        fs::create_dir(&app_root).expect("create app root");
        fs::set_permissions(&app_root, fs::Permissions::from_mode(0o700))
            .expect("set app root permissions");
        let historical = app_root.join(LIBRARY_DIRECTORY);
        fs::create_dir(&historical).expect("create historical source");
        fs::set_permissions(&historical, fs::Permissions::from_mode(0o700))
            .expect("set historical source permissions");
        let binding = LibraryCoreDesktopBinding::open(&app_root, TEST_IDENTITY)
            .expect("open Desktop reset binding");
        install_test_selected_authority(&binding, &"b".repeat(64), &"a".repeat(64));

        let vault_file = app_root
            .join(CONTENT_VAULT_DIRECTORY)
            .join("range-reset.bin");
        fs::write(&vault_file, b"cached bytes").expect("write cached content");
        fs::set_permissions(&vault_file, fs::Permissions::from_mode(0o600))
            .expect("set cached content permissions");
        let snapshot_pending = app_root
            .join(SNAPSHOT_DIRECTORY)
            .join(".normalized-snapshot.pending");
        fs::write(&snapshot_pending, b"pending snapshot").expect("write pending snapshot");
        fs::set_permissions(&snapshot_pending, fs::Permissions::from_mode(0o600))
            .expect("set pending snapshot permissions");

        binding
            .reset_normalized_library_v1()
            .expect("reset normalized Library");

        assert!(!app_root.join(AUTHORITY_SELECTION_FILE).exists());
        assert!(!app_root.join(FACTORY_RESET_PENDING_FILE).exists());
        assert_eq!(
            fs::read(app_root.join(HISTORICAL_IMPORT_RETIRED_FILE))
                .expect("read historical retirement fence"),
            HISTORICAL_IMPORT_RETIRED_BYTES
        );
        assert!(!historical.join("library-core.sqlite").exists());
        assert!(!app_root
            .join(NORMALIZED_LIBRARY_DIRECTORY)
            .join("library-core.sqlite")
            .exists());
        assert!(!vault_file.exists());
        assert!(!snapshot_pending.exists());
        assert!(!binding.historical_source_is_present_v1());
        assert!(binding.connect().is_err());
        assert!(binding.connect_selected_normalized().is_err());

        drop(binding);
        let reopened = LibraryCoreDesktopBinding::open(&app_root, TEST_IDENTITY)
            .expect("reopen Desktop binding after reset");
        let fresh = reopened
            .connect_normalized()
            .expect("recreate fresh normalized SQLite after reset");
        assert_eq!(
            fresh
                .query_row(
                    "SELECT count(*) FROM library_active_authority;",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .expect("fresh authority count"),
            0
        );
    }

    #[test]
    fn pending_factory_reset_resumes_before_startup_can_reopen_authority() {
        let fixture = tempfile::TempDir::new().expect("create reset recovery fixture");
        let app_root = fixture.path().join("app-data");
        fs::create_dir(&app_root).expect("create app root");
        fs::set_permissions(&app_root, fs::Permissions::from_mode(0o700))
            .expect("set app root permissions");
        let binding = LibraryCoreDesktopBinding::open(&app_root, TEST_IDENTITY)
            .expect("open reset recovery binding");
        install_test_selected_authority(&binding, &"b".repeat(64), &"a".repeat(64));
        binding
            .app_root
            .write_new_private_file_atomically(
                FACTORY_RESET_PENDING_FILE,
                ".library-factory-reset-pending-v1.pending",
                FACTORY_RESET_PENDING_BYTES,
                CONTROL_FILE_MAXIMUM_BYTES,
            )
            .expect("persist interrupted reset marker");
        drop(binding);

        let reopened = LibraryCoreDesktopBinding::open(&app_root, TEST_IDENTITY)
            .expect("resume reset during Desktop binding startup");
        assert!(!app_root.join(FACTORY_RESET_PENDING_FILE).exists());
        assert!(app_root.join(HISTORICAL_IMPORT_RETIRED_FILE).is_file());
        assert!(!reopened
            .normalized_authority_is_selected_v1()
            .expect("read reset authority state"));
        assert!(reopened.connect_selected_normalized().is_err());
        assert_eq!(
            reopened
                .connect_normalized()
                .expect("open reset normalized SQLite")
                .query_row(
                    "SELECT count(*) FROM library_active_authority;",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .expect("reset authority count"),
            0
        );
    }

    #[test]
    fn factory_reset_stays_on_bound_directories_after_visible_path_replacement() {
        let fixture = tempfile::TempDir::new().expect("create reset path-swap fixture");
        let app_root = fixture.path().join("app-data");
        fs::create_dir(&app_root).expect("create app root");
        fs::set_permissions(&app_root, fs::Permissions::from_mode(0o700))
            .expect("set app root permissions");
        let historical = app_root.join(LIBRARY_DIRECTORY);
        fs::create_dir(&historical).expect("create historical source");
        fs::set_permissions(&historical, fs::Permissions::from_mode(0o700))
            .expect("set historical source permissions");
        let binding = LibraryCoreDesktopBinding::open(&app_root, TEST_IDENTITY)
            .expect("open path-swap reset binding");
        install_test_selected_authority(&binding, &"b".repeat(64), &"a".repeat(64));

        let vault_file = app_root
            .join(CONTENT_VAULT_DIRECTORY)
            .join("range-reset.bin");
        fs::write(&vault_file, b"cached bytes").expect("write cached content");
        fs::set_permissions(&vault_file, fs::Permissions::from_mode(0o600))
            .expect("set cached content permissions");
        let snapshot_pending = app_root
            .join(SNAPSHOT_DIRECTORY)
            .join(".normalized-snapshot.pending");
        fs::write(&snapshot_pending, b"pending snapshot").expect("write pending snapshot");
        fs::set_permissions(&snapshot_pending, fs::Permissions::from_mode(0o600))
            .expect("set pending snapshot permissions");

        for (visible_name, moved_name) in [
            (LIBRARY_DIRECTORY, "moved-library-core"),
            (NORMALIZED_LIBRARY_DIRECTORY, "moved-library-sqlite"),
            (CONTENT_VAULT_DIRECTORY, "moved-library-content-vault"),
            (SNAPSHOT_DIRECTORY, "moved-library-snapshots"),
        ] {
            fs::rename(app_root.join(visible_name), app_root.join(moved_name))
                .expect("move bound reset directory");
            let replacement = app_root.join(visible_name);
            fs::create_dir(&replacement).expect("create visible replacement directory");
            fs::set_permissions(&replacement, fs::Permissions::from_mode(0o700))
                .expect("set replacement directory permissions");
            let sentinel = replacement.join("sentinel");
            fs::write(&sentinel, b"replacement").expect("write replacement sentinel");
            fs::set_permissions(&sentinel, fs::Permissions::from_mode(0o600))
                .expect("set replacement sentinel permissions");
        }

        binding
            .reset_normalized_library_v1()
            .expect("reset through held directory descriptors");

        assert!(!app_root
            .join("moved-library-core")
            .join("library-core.sqlite")
            .exists());
        assert!(!app_root
            .join("moved-library-sqlite")
            .join("library-core.sqlite")
            .exists());
        assert!(!app_root
            .join("moved-library-content-vault")
            .join("range-reset.bin")
            .exists());
        assert!(!app_root
            .join("moved-library-snapshots")
            .join(".normalized-snapshot.pending")
            .exists());
        for visible_name in [
            LIBRARY_DIRECTORY,
            NORMALIZED_LIBRARY_DIRECTORY,
            CONTENT_VAULT_DIRECTORY,
            SNAPSHOT_DIRECTORY,
        ] {
            assert_eq!(
                fs::read(app_root.join(visible_name).join("sentinel"))
                    .expect("read replacement sentinel"),
                b"replacement"
            );
        }
    }
}
