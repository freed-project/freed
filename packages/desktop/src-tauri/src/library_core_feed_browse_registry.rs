//! Durable selection registry for immutable feed browse generations.
//!
//! Materialization and selection stay separate. A complete browse database is
//! sealed first, then registered with its logical query identity and physical
//! file digest. Reader selection is an exact, replayable transaction with one
//! rollback generation. No production entry point opens this registry yet.

use crate::library_core_feed_browse_store::{
    ExistingFeedBrowseGeneration, FeedBrowseGenerationBinding, FeedBrowseGenerationStore,
    FeedBrowseStoreError, PublishedFeedBrowseGeneration,
};
use crate::sqlite_registry_file::{self, SqliteRegistryFileError, SqliteRegistrySpec};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::ffi::CString;
use std::fmt;
#[cfg(unix)]
use std::fs::{File, OpenOptions};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
#[cfg(not(unix))]
use std::time::SystemTime;

const REGISTRY_APPLICATION_ID: i64 = 1_178_751_537;
const REGISTRY_SCHEMA_VERSION: i64 = 1;
const REGISTRY_SCHEMA_SQL: &str =
    include_str!("../../../shared/src/library-core/feed-browse-generation-registry-v1.sql");
const REGISTRY_SPEC: SqliteRegistrySpec = SqliteRegistrySpec {
    application_id: REGISTRY_APPLICATION_ID,
    schema_version: REGISTRY_SCHEMA_VERSION,
    schema_sql: REGISTRY_SCHEMA_SQL,
};
const QUERY_ID: &str = "feed_browse_page_v1";
const MAX_TRANSITION_ID_BYTES: usize = 128;
const MAXIMUM_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug)]
pub(super) enum FeedBrowseGenerationRegistryError {
    Sql(rusqlite::Error),
    Io(std::io::Error),
    Store(FeedBrowseStoreError),
    InvalidRegistryIdentity { field: &'static str },
    InvalidGeneration { field: &'static str },
    GenerationConflict,
    TransitionConflict,
    StaleCurrentGeneration,
    MissingRollbackGeneration,
    AlreadySelectedGeneration,
    NoSelectedGeneration,
}

impl From<rusqlite::Error> for FeedBrowseGenerationRegistryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<std::io::Error> for FeedBrowseGenerationRegistryError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<FeedBrowseStoreError> for FeedBrowseGenerationRegistryError {
    fn from(error: FeedBrowseStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<SqliteRegistryFileError> for FeedBrowseGenerationRegistryError {
    fn from(error: SqliteRegistryFileError) -> Self {
        match error {
            SqliteRegistryFileError::Sql(error) => Self::Sql(error),
            SqliteRegistryFileError::Io(error) => Self::Io(error),
            SqliteRegistryFileError::InvalidIdentity(field) => {
                Self::InvalidRegistryIdentity { field }
            }
        }
    }
}

impl fmt::Display for FeedBrowseGenerationRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::Store(error) => write!(formatter, "feed browse store error: {error}"),
            Self::InvalidRegistryIdentity { field } => {
                write!(formatter, "invalid feed browse generation registry {field}")
            }
            Self::InvalidGeneration { field } => {
                write!(formatter, "invalid feed browse generation {field}")
            }
            Self::GenerationConflict => {
                formatter.write_str("feed browse generation registration conflicts")
            }
            Self::TransitionConflict => {
                formatter.write_str("feed browse generation transition conflicts")
            }
            Self::StaleCurrentGeneration => {
                formatter.write_str("feed browse reader generation changed")
            }
            Self::MissingRollbackGeneration => {
                formatter.write_str("feed browse reader has no exact rollback generation")
            }
            Self::AlreadySelectedGeneration => {
                formatter.write_str("feed browse generation is already selected")
            }
            Self::NoSelectedGeneration => {
                formatter.write_str("feed browse reader has no selected generation")
            }
        }
    }
}

impl std::error::Error for FeedBrowseGenerationRegistryError {}

type RegistryResult<T> = Result<T, FeedBrowseGenerationRegistryError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RegisteredFeedBrowseGeneration {
    pub(super) binding: FeedBrowseGenerationBinding,
    pub(super) file_digest: String,
    pub(super) file_name: String,
    pub(super) byte_length: u64,
    pub(super) registered_sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FeedBrowseReaderState {
    current_generation_id: Option<String>,
    rollback_generation_id: Option<String>,
    transition_sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FeedBrowseGenerationReaderSelection {
    pub(super) generation: RegisteredFeedBrowseGeneration,
    pub(super) transition_sequence: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeedBrowseGenerationTransitionKind {
    Select,
    Rollback,
}

impl FeedBrowseGenerationTransitionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::Rollback => "rollback",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FeedBrowseGenerationTransition {
    transition_id: String,
    transition_digest: String,
    kind: FeedBrowseGenerationTransitionKind,
    expected_current_generation_id: Option<String>,
    selected_generation_id: String,
    previous_generation_id: Option<String>,
    committed_rollback_generation_id: Option<String>,
    committed_sequence: i64,
}

impl FeedBrowseGenerationTransition {
    pub(super) fn committed_sequence(&self) -> i64 {
        self.committed_sequence
    }
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct UnixFileIdentity {
    device_id: u64,
    inode_id: u64,
}

#[cfg(unix)]
struct UnixPruneCandidate {
    file_name: CString,
    file: File,
    identity: UnixFileIdentity,
}

pub(super) struct FeedBrowseGenerationRegistry {
    connection: Connection,
    generation_root: PathBuf,
    #[cfg(unix)]
    generation_root_handle: File,
    #[cfg(unix)]
    generation_root_identity: UnixFileIdentity,
    #[cfg(not(unix))]
    generation_root_created_at: SystemTime,
}

impl FeedBrowseGenerationRegistry {
    pub(super) fn read_selected_generation(
        path: &Path,
    ) -> RegistryResult<FeedBrowseGenerationReaderSelection> {
        let connection = sqlite_registry_file::open_read_only(path, REGISTRY_SPEC)?;
        let state = validate_reader_state(connection.query_row(
            "SELECT currentGenerationId, rollbackGenerationId, transitionSequence
             FROM feed_browse_reader_state WHERE singleton = 1;",
            [],
            read_reader_state,
        )?)?;
        let generation_id = state
            .current_generation_id
            .as_deref()
            .ok_or(FeedBrowseGenerationRegistryError::NoSelectedGeneration)?;
        let generation = read_registered_generation_by_id(&connection, generation_id)?.ok_or(
            FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
                field: "selected_generation",
            },
        )?;
        sqlite_registry_file::verify(&connection, REGISTRY_SPEC)?;
        Ok(FeedBrowseGenerationReaderSelection {
            generation,
            transition_sequence: state.transition_sequence,
        })
    }

    pub(super) fn open(path: &Path, generation_root: &Path) -> RegistryResult<Self> {
        if !generation_root.is_absolute() || generation_root.file_name().is_none() {
            return Err(FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
                field: "generation_root",
            });
        }
        let metadata = std::fs::symlink_metadata(generation_root)?;
        let canonical_generation_root = std::fs::canonicalize(generation_root)?;
        if !metadata.file_type().is_dir()
            || metadata.file_type().is_symlink()
            || canonical_generation_root != generation_root
        {
            return Err(FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
                field: "generation_root",
            });
        }
        #[cfg(unix)]
        let (generation_root_handle, generation_root_identity) =
            open_pinned_generation_root(&canonical_generation_root)?;
        #[cfg(not(unix))]
        let generation_root_created_at = metadata.created()?;
        let connection = sqlite_registry_file::open_or_create(path, REGISTRY_SPEC)?;
        Ok(Self {
            connection,
            generation_root: canonical_generation_root,
            #[cfg(unix)]
            generation_root_handle,
            #[cfg(unix)]
            generation_root_identity,
            #[cfg(not(unix))]
            generation_root_created_at,
        })
    }

    pub(super) fn register(
        &mut self,
        published: &PublishedFeedBrowseGeneration,
    ) -> RegistryResult<RegisteredFeedBrowseGeneration> {
        let candidate = self.validate_published_generation(published)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = find_registered_generation(
            &transaction,
            &candidate.binding.generation_id,
            &candidate.file_digest,
            &candidate.file_name,
        )? {
            if same_generation_without_sequence(&existing, &candidate) {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(FeedBrowseGenerationRegistryError::GenerationConflict);
        }
        let registered_sequence = transaction.query_row(
            "UPDATE feed_browse_generation_meta
             SET integerValue = integerValue + 1
             WHERE key = 'registrationSequence'
             RETURNING integerValue;",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        let binding = &candidate.binding;
        transaction.execute(
            "INSERT INTO feed_browse_generations (
               generationId, fileDigest, fileName, queryId, sourceDocumentId,
               sourceHeadsDigest, sourceHeadCount, transitionSequence,
               projectionRevision, filterJson, rankingClockMs,
               recommendationOrderSchemaVersion, totalRows, byteLength,
               registeredSequence
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
             );",
            params![
                binding.generation_id,
                candidate.file_digest,
                candidate.file_name,
                QUERY_ID,
                binding.source_document_id,
                binding.source_heads_digest,
                binding.source_head_count,
                binding.transition_sequence,
                binding.projection_revision,
                binding.filter_json,
                binding.ranking_clock_ms,
                binding.recommendation_order_schema_version,
                binding.total_rows,
                candidate.byte_length as i64,
                registered_sequence,
            ],
        )?;
        transaction.commit()?;
        Ok(RegisteredFeedBrowseGeneration {
            registered_sequence,
            ..candidate
        })
    }

    pub(super) fn select(
        &mut self,
        transition_id: &str,
        expected_current_generation_id: Option<&str>,
        selected_generation_id: &str,
    ) -> RegistryResult<FeedBrowseGenerationTransition> {
        self.transition(
            FeedBrowseGenerationTransitionKind::Select,
            transition_id,
            expected_current_generation_id,
            selected_generation_id,
        )
    }

    pub(super) fn rollback(
        &mut self,
        transition_id: &str,
        expected_current_generation_id: Option<&str>,
        selected_generation_id: &str,
    ) -> RegistryResult<FeedBrowseGenerationTransition> {
        self.transition(
            FeedBrowseGenerationTransitionKind::Rollback,
            transition_id,
            expected_current_generation_id,
            selected_generation_id,
        )
    }

    /// Retain only the selected generation, its exact rollback generation, and
    /// the latest replayable transition. Browse generations are derived state,
    /// so revisiting a feed must not retain one full SQLite file per ranking
    /// clock or source revision.
    pub(super) fn prune_unselected_generations(&mut self) -> RegistryResult<usize> {
        self.prune_unselected_generations_with_hook(|| Ok(()))
    }

    fn prune_unselected_generations_with_hook<F>(
        &mut self,
        after_snapshot: F,
    ) -> RegistryResult<usize>
    where
        F: FnOnce() -> RegistryResult<()>,
    {
        // Selection uses an IMMEDIATE transaction too. Taking the write lock
        // before reading reader state prevents a concurrent selection from
        // turning one of this prune's stale candidates into current authority.
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state = validate_reader_state(transaction.query_row(
            "SELECT currentGenerationId, rollbackGenerationId, transitionSequence
             FROM feed_browse_reader_state WHERE singleton = 1;",
            [],
            read_reader_state,
        )?)?;
        let mut statement = transaction.prepare(
            "SELECT generationId, fileName
             FROM feed_browse_generations
             ORDER BY registeredSequence;",
        )?;
        let candidates = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        after_snapshot()?;

        #[cfg(unix)]
        validate_unix_generation_root_identity(
            &self.generation_root,
            &self.generation_root_handle,
            self.generation_root_identity,
        )?;
        #[cfg(not(unix))]
        validate_non_unix_generation_root_identity(
            &self.generation_root,
            self.generation_root_created_at,
        )?;

        #[cfg(unix)]
        let mut removable_files = Vec::new();
        #[cfg(not(unix))]
        let mut removable_paths = Vec::new();
        for (generation_id, file_name) in &candidates {
            if state.current_generation_id.as_deref() == Some(generation_id.as_str())
                || state.rollback_generation_id.as_deref() == Some(generation_id.as_str())
            {
                continue;
            }
            validate_stored_file_name(file_name)?;
            #[cfg(unix)]
            if let Some(candidate) =
                open_unix_prune_candidate(&self.generation_root_handle, file_name)?
            {
                removable_files.push(candidate);
            }
            #[cfg(not(unix))]
            {
                validate_non_unix_generation_root_identity(
                    &self.generation_root,
                    self.generation_root_created_at,
                )?;
                let path = self.generation_root.join(file_name);
                match std::fs::symlink_metadata(&path) {
                    Ok(metadata)
                        if metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
                    {
                        if std::fs::canonicalize(&path)? != path {
                            return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
                                field: "prune_path",
                            });
                        }
                        removable_paths.push(path);
                    }
                    Ok(_) => {
                        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
                            field: "prune_file_type",
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        #[cfg(unix)]
        let removed = unlink_unix_prune_candidates(
            &self.generation_root,
            &self.generation_root_handle,
            self.generation_root_identity,
            removable_files,
        )?;
        #[cfg(not(unix))]
        let mut removed = 0;
        #[cfg(not(unix))]
        for path in removable_paths {
            validate_non_unix_generation_root_identity(
                &self.generation_root,
                self.generation_root_created_at,
            )?;
            std::fs::remove_file(path)?;
            removed += 1;
        }
        #[cfg(unix)]
        if removed > 0 {
            self.generation_root_handle.sync_all()?;
        }

        transaction.execute(
            "DELETE FROM feed_browse_generation_transitions
             WHERE committedSequence < ?1;",
            [state.transition_sequence],
        )?;
        for (generation_id, _) in candidates {
            if state.current_generation_id.as_deref() == Some(generation_id.as_str())
                || state.rollback_generation_id.as_deref() == Some(generation_id.as_str())
            {
                continue;
            }
            transaction.execute(
                "DELETE FROM feed_browse_generations WHERE generationId = ?1;",
                [generation_id],
            )?;
        }
        transaction.commit()?;
        Ok(removed)
    }

    fn transition(
        &mut self,
        kind: FeedBrowseGenerationTransitionKind,
        transition_id: &str,
        expected_current_generation_id: Option<&str>,
        selected_generation_id: &str,
    ) -> RegistryResult<FeedBrowseGenerationTransition> {
        validate_transition_id(transition_id)?;
        validate_digest(selected_generation_id, "selected_generation_id")?;
        if let Some(expected) = expected_current_generation_id {
            validate_digest(expected, "expected_current_generation_id")?;
        }
        let transition_digest = digest_transition(
            kind,
            transition_id,
            expected_current_generation_id,
            selected_generation_id,
        );
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = read_transition(&transaction, transition_id)? {
            if existing.transition_digest == transition_digest {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(FeedBrowseGenerationRegistryError::TransitionConflict);
        }
        if !transaction.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM feed_browse_generations WHERE generationId = ?1
             );",
            [selected_generation_id],
            |row| row.get::<_, bool>(0),
        )? {
            return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
                field: "unregistered_selection",
            });
        }
        let prior = validate_reader_state(transaction.query_row(
            "SELECT currentGenerationId, rollbackGenerationId, transitionSequence
             FROM feed_browse_reader_state WHERE singleton = 1;",
            [],
            read_reader_state,
        )?)?;
        if prior.current_generation_id.as_deref() != expected_current_generation_id {
            return Err(FeedBrowseGenerationRegistryError::StaleCurrentGeneration);
        }
        if prior.current_generation_id.as_deref() == Some(selected_generation_id) {
            return Err(FeedBrowseGenerationRegistryError::AlreadySelectedGeneration);
        }
        if kind == FeedBrowseGenerationTransitionKind::Rollback
            && prior.rollback_generation_id.as_deref() != Some(selected_generation_id)
        {
            return Err(FeedBrowseGenerationRegistryError::MissingRollbackGeneration);
        }
        let committed_sequence = prior
            .transition_sequence
            .checked_add(1)
            .ok_or(FeedBrowseGenerationRegistryError::TransitionConflict)?;
        let committed_rollback_generation_id = prior.current_generation_id.clone();
        if transaction.execute(
            "UPDATE feed_browse_reader_state
             SET currentGenerationId = ?1,
                 rollbackGenerationId = ?2,
                 transitionSequence = ?3
             WHERE singleton = 1 AND transitionSequence = ?4;",
            params![
                selected_generation_id,
                committed_rollback_generation_id,
                committed_sequence,
                prior.transition_sequence,
            ],
        )? != 1
        {
            return Err(FeedBrowseGenerationRegistryError::TransitionConflict);
        }
        transaction.execute(
            "INSERT INTO feed_browse_generation_transitions (
               transitionId, transitionDigest, transitionKind,
               expectedCurrentGenerationId, selectedGenerationId,
               previousGenerationId, committedRollbackGenerationId,
               committedSequence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);",
            params![
                transition_id,
                transition_digest,
                kind.as_str(),
                expected_current_generation_id,
                selected_generation_id,
                prior.current_generation_id,
                committed_rollback_generation_id,
                committed_sequence,
            ],
        )?;
        let committed = FeedBrowseGenerationTransition {
            transition_id: transition_id.to_owned(),
            transition_digest,
            kind,
            expected_current_generation_id: expected_current_generation_id.map(str::to_owned),
            selected_generation_id: selected_generation_id.to_owned(),
            previous_generation_id: prior.current_generation_id,
            committed_rollback_generation_id,
            committed_sequence,
        };
        transaction.commit()?;
        Ok(committed)
    }

    fn validate_published_generation(
        &self,
        published: &PublishedFeedBrowseGeneration,
    ) -> RegistryResult<RegisteredFeedBrowseGeneration> {
        if !published.path.is_absolute() || published.path.parent() != Some(&self.generation_root) {
            return Err(FeedBrowseGenerationRegistryError::InvalidGeneration { field: "path" });
        }
        let file_name = validate_file_name(&published.path)?;
        let inspected =
            match FeedBrowseGenerationStore::inspect_existing(&published.path, &published.binding)?
            {
                ExistingFeedBrowseGeneration::Sealed(inspected) => inspected,
                _ => {
                    return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
                        field: "sealed_generation",
                    })
                }
            };
        if inspected != *published {
            return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
                field: "publication_receipt",
            });
        }
        validate_binding(&published.binding)?;
        validate_digest(&published.file_digest, "file_digest")?;
        if published.byte_length == 0 || published.byte_length > i64::MAX as u64 {
            return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
                field: "byte_length",
            });
        }
        Ok(RegisteredFeedBrowseGeneration {
            binding: published.binding.clone(),
            file_digest: published.file_digest.clone(),
            file_name,
            byte_length: published.byte_length,
            registered_sequence: 0,
        })
    }
}

fn validate_file_name(path: &Path) -> RegistryResult<String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(FeedBrowseGenerationRegistryError::InvalidGeneration { field: "file_name" })?;
    if file_name.is_empty()
        || file_name.len() > 255
        || file_name == "."
        || file_name == ".."
        || file_name.contains(['/', '\\'])
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration { field: "file_name" });
    }
    Ok(file_name.to_owned())
}

fn validate_stored_file_name(file_name: &str) -> RegistryResult<()> {
    let path = Path::new(file_name);
    if path.components().count() != 1
        || path.file_name().and_then(|value| value.to_str()) != Some(file_name)
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration { field: "file_name" });
    }
    validate_file_name(path).map(|_| ())
}

#[cfg(unix)]
fn unix_file_identity(metadata: &std::fs::Metadata) -> UnixFileIdentity {
    UnixFileIdentity {
        device_id: metadata.dev(),
        inode_id: metadata.ino(),
    }
}

#[cfg(unix)]
fn open_pinned_generation_root(path: &Path) -> RegistryResult<(File, UnixFileIdentity)> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW);
    let handle = options.open(path)?;
    let metadata = handle.metadata()?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
            field: "generation_root",
        });
    }
    let identity = unix_file_identity(&metadata);
    Ok((handle, identity))
}

#[cfg(unix)]
fn open_unix_file_at(root: &File, file_name: &CString) -> RegistryResult<Option<File>> {
    let descriptor = unsafe {
        libc::openat(
            root.as_raw_fd(),
            file_name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
        )
    };
    if descriptor >= 0 {
        return Ok(Some(unsafe { File::from_raw_fd(descriptor) }));
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::NotFound {
        return Ok(None);
    }
    Err(error.into())
}

#[cfg(unix)]
fn open_unix_prune_candidate(
    root: &File,
    file_name: &str,
) -> RegistryResult<Option<UnixPruneCandidate>> {
    let file_name = CString::new(file_name)
        .map_err(|_| FeedBrowseGenerationRegistryError::InvalidGeneration { field: "file_name" })?;
    let Some(file) = open_unix_file_at(root, &file_name)? else {
        return Ok(None);
    };
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
            field: "prune_file_type",
        });
    }
    let identity = unix_file_identity(&metadata);
    Ok(Some(UnixPruneCandidate {
        file_name,
        file,
        identity,
    }))
}

#[cfg(unix)]
fn validate_unix_generation_root_identity(
    path: &Path,
    handle: &File,
    expected: UnixFileIdentity,
) -> RegistryResult<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    let canonical_root = std::fs::canonicalize(path)?;
    if !metadata.file_type().is_dir()
        || metadata.file_type().is_symlink()
        || canonical_root != path
        || unix_file_identity(&metadata) != expected
        || unix_file_identity(&handle.metadata()?) != expected
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
            field: "prune_generation_root",
        });
    }
    Ok(())
}

#[cfg(unix)]
fn unlink_unix_prune_candidates(
    generation_root: &Path,
    root: &File,
    root_identity: UnixFileIdentity,
    candidates: Vec<UnixPruneCandidate>,
) -> RegistryResult<usize> {
    let mut removed = 0;
    for candidate in candidates {
        validate_unix_generation_root_identity(generation_root, root, root_identity)?;
        let Some(current) = open_unix_file_at(root, &candidate.file_name)? else {
            continue;
        };
        if unix_file_identity(&candidate.file.metadata()?) != candidate.identity
            || unix_file_identity(&current.metadata()?) != candidate.identity
        {
            return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
                field: "prune_file_identity",
            });
        }
        let result = unsafe { libc::unlinkat(root.as_raw_fd(), candidate.file_name.as_ptr(), 0) };
        if result == 0 {
            removed += 1;
            continue;
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(error.into());
        }
    }
    Ok(removed)
}

#[cfg(not(unix))]
fn validate_non_unix_generation_root_identity(
    path: &Path,
    expected_created_at: SystemTime,
) -> RegistryResult<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    let canonical_root = std::fs::canonicalize(path)?;
    if !metadata.file_type().is_dir()
        || metadata.file_type().is_symlink()
        || canonical_root != path
        || metadata.created()? != expected_created_at
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration {
            field: "prune_generation_root",
        });
    }
    Ok(())
}

fn validate_binding(binding: &FeedBrowseGenerationBinding) -> RegistryResult<()> {
    validate_digest(&binding.generation_id, "generation_id")?;
    validate_digest(&binding.source_heads_digest, "source_heads_digest")?;
    if binding.source_document_id.is_empty()
        || binding.source_document_id.len() > 4_096
        || binding.source_head_count < 0
        || binding.source_head_count > MAXIMUM_SAFE_INTEGER
        || binding.transition_sequence < 0
        || binding.transition_sequence > MAXIMUM_SAFE_INTEGER
        || binding.projection_revision < 0
        || binding.projection_revision > MAXIMUM_SAFE_INTEGER
        || binding.filter_json.len() < 2
        || binding.filter_json.len() > 1_048_576
        || binding.ranking_clock_ms < 0
        || binding.ranking_clock_ms > MAXIMUM_SAFE_INTEGER
        || binding.recommendation_order_schema_version <= 0
        || binding.recommendation_order_schema_version > MAXIMUM_SAFE_INTEGER
        || binding.total_rows < 0
        || binding.total_rows > 250_000
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration { field: "binding" });
    }
    Ok(())
}

fn validate_transition_id(transition_id: &str) -> RegistryResult<()> {
    if transition_id.is_empty() || transition_id.len() > MAX_TRANSITION_ID_BYTES {
        return Err(FeedBrowseGenerationRegistryError::TransitionConflict);
    }
    Ok(())
}

fn validate_digest(value: &str, field: &'static str) -> RegistryResult<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidGeneration { field });
    }
    Ok(())
}

fn validate_reader_state(state: FeedBrowseReaderState) -> RegistryResult<FeedBrowseReaderState> {
    if state.transition_sequence < 0
        || state.current_generation_id == state.rollback_generation_id
            && state.current_generation_id.is_some()
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
            field: "reader_state",
        });
    }
    for generation_id in [
        state.current_generation_id.as_deref(),
        state.rollback_generation_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        validate_digest(generation_id, "reader_state").map_err(|_| {
            FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
                field: "reader_state",
            }
        })?;
    }
    Ok(state)
}

fn read_registered_generation(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<RegisteredFeedBrowseGeneration> {
    if row.get::<_, String>(3)? != QUERY_ID {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let byte_length = row.get::<_, i64>(13)?;
    Ok(RegisteredFeedBrowseGeneration {
        binding: FeedBrowseGenerationBinding {
            generation_id: row.get(0)?,
            source_document_id: row.get(4)?,
            source_heads_digest: row.get(5)?,
            source_head_count: row.get(6)?,
            transition_sequence: row.get(7)?,
            projection_revision: row.get(8)?,
            filter_json: row.get(9)?,
            ranking_clock_ms: row.get(10)?,
            recommendation_order_schema_version: row.get(11)?,
            total_rows: row.get(12)?,
        },
        file_digest: row.get(1)?,
        file_name: row.get(2)?,
        byte_length: u64::try_from(byte_length)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(13, byte_length))?,
        registered_sequence: row.get(14)?,
    })
}

const GENERATION_SELECT: &str =
    "SELECT generationId, fileDigest, fileName, queryId, sourceDocumentId,
            sourceHeadsDigest, sourceHeadCount, transitionSequence,
            projectionRevision, filterJson, rankingClockMs,
            recommendationOrderSchemaVersion, totalRows, byteLength,
            registeredSequence
     FROM feed_browse_generations";

fn read_registered_generation_by_id(
    connection: &Connection,
    generation_id: &str,
) -> RegistryResult<Option<RegisteredFeedBrowseGeneration>> {
    validate_digest(generation_id, "generation_id")?;
    let generation = connection
        .query_row(
            &format!("{GENERATION_SELECT} WHERE generationId = ?1;"),
            [generation_id],
            read_registered_generation,
        )
        .optional()?;
    generation.map(validate_registered_generation).transpose()
}

fn find_registered_generation(
    connection: &Connection,
    generation_id: &str,
    file_digest: &str,
    file_name: &str,
) -> RegistryResult<Option<RegisteredFeedBrowseGeneration>> {
    let mut statement = connection.prepare(&format!(
        "{GENERATION_SELECT}
         WHERE generationId = ?1 OR fileDigest = ?2 OR fileName = ?3
         ORDER BY registeredSequence
         LIMIT 2;"
    ))?;
    let rows = statement
        .query_map(
            params![generation_id, file_digest, file_name],
            read_registered_generation,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.len() > 1 {
        return Err(FeedBrowseGenerationRegistryError::GenerationConflict);
    }
    rows.into_iter()
        .next()
        .map(validate_registered_generation)
        .transpose()
}

fn validate_registered_generation(
    generation: RegisteredFeedBrowseGeneration,
) -> RegistryResult<RegisteredFeedBrowseGeneration> {
    validate_binding(&generation.binding).map_err(|_| {
        FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
            field: "selected_generation",
        }
    })?;
    validate_digest(&generation.file_digest, "file_digest").map_err(|_| {
        FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
            field: "selected_generation",
        }
    })?;
    if generation.file_name.is_empty()
        || generation.file_name.len() > 255
        || generation.file_name.contains(['/', '\\'])
        || generation.byte_length == 0
        || generation.registered_sequence <= 0
    {
        return Err(FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
            field: "selected_generation",
        });
    }
    Ok(generation)
}

fn same_generation_without_sequence(
    left: &RegisteredFeedBrowseGeneration,
    right: &RegisteredFeedBrowseGeneration,
) -> bool {
    left.binding == right.binding
        && left.file_digest == right.file_digest
        && left.file_name == right.file_name
        && left.byte_length == right.byte_length
}

fn read_reader_state(row: &rusqlite::Row<'_>) -> rusqlite::Result<FeedBrowseReaderState> {
    Ok(FeedBrowseReaderState {
        current_generation_id: row.get(0)?,
        rollback_generation_id: row.get(1)?,
        transition_sequence: row.get(2)?,
    })
}

fn read_transition(
    connection: &Connection,
    transition_id: &str,
) -> RegistryResult<Option<FeedBrowseGenerationTransition>> {
    connection
        .query_row(
            "SELECT transitionId, transitionDigest, transitionKind,
                    expectedCurrentGenerationId, selectedGenerationId,
                    previousGenerationId, committedRollbackGenerationId,
                    committedSequence
             FROM feed_browse_generation_transitions
             WHERE transitionId = ?1;",
            [transition_id],
            |row| {
                let kind = match row.get::<_, String>(2)?.as_str() {
                    "select" => FeedBrowseGenerationTransitionKind::Select,
                    "rollback" => FeedBrowseGenerationTransitionKind::Rollback,
                    _ => return Err(rusqlite::Error::InvalidQuery),
                };
                Ok(FeedBrowseGenerationTransition {
                    transition_id: row.get(0)?,
                    transition_digest: row.get(1)?,
                    kind,
                    expected_current_generation_id: row.get(3)?,
                    selected_generation_id: row.get(4)?,
                    previous_generation_id: row.get(5)?,
                    committed_rollback_generation_id: row.get(6)?,
                    committed_sequence: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn digest_transition(
    kind: FeedBrowseGenerationTransitionKind,
    transition_id: &str,
    expected_current_generation_id: Option<&str>,
    selected_generation_id: &str,
) -> String {
    let mut hasher = Sha256::new();
    for field in [
        "freed.feed-browse-generation-transition.v1",
        kind.as_str(),
        transition_id,
        expected_current_generation_id.unwrap_or(""),
        selected_generation_id,
    ] {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field.as_bytes());
    }
    lower_hex(&hasher.finalize())
}

fn lower_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        registry_path: PathBuf,
        generation_root: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::fs::canonicalize(std::env::temp_dir())
                .expect("resolve temp root")
                .join(format!(
                    "freed-feed-browse-registry-{label}-{}-{nonce}",
                    std::process::id()
                ));
            let generation_root = root.join("generations");
            std::fs::create_dir_all(&generation_root).expect("create fixture");
            Self {
                registry_path: root.join("registry.sqlite"),
                root,
                generation_root,
            }
        }

        fn binding(&self, suffix: i64) -> FeedBrowseGenerationBinding {
            FeedBrowseGenerationBinding {
                generation_id: format!("{suffix:064x}"),
                source_document_id: "document-a".to_owned(),
                source_heads_digest: format!("{:064x}", suffix + 10),
                source_head_count: suffix,
                transition_sequence: suffix,
                projection_revision: suffix,
                filter_json: format!("{{\"suffix\":{suffix}}}"),
                ranking_clock_ms: suffix,
                recommendation_order_schema_version: 1,
                total_rows: 0,
            }
        }

        fn published(
            &self,
            file_suffix: i64,
            binding: &FeedBrowseGenerationBinding,
        ) -> PublishedFeedBrowseGeneration {
            let path = self
                .generation_root
                .join(format!("generation-{file_suffix}.sqlite"));
            let mut store = FeedBrowseGenerationStore::open(&path).expect("open generation");
            store.begin(binding).expect("begin generation");
            store.finalize().expect("finalize generation");
            store.seal(&path, binding).expect("seal generation")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn sealed_registration_replays_and_conflicting_logical_identity_fails_closed() {
        let fixture = Fixture::new("register");
        let binding = fixture.binding(1);
        let published = fixture.published(1, &binding);
        let first = {
            let mut registry = FeedBrowseGenerationRegistry::open(
                &fixture.registry_path,
                &fixture.generation_root,
            )
            .expect("open registry");
            registry.register(&published).expect("register generation")
        };
        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("reopen registry");
        assert_eq!(
            registry.register(&published).expect("replay registration"),
            first
        );

        let mut conflicting_binding = binding.clone();
        conflicting_binding.filter_json = "{\"suffix\":999}".to_owned();
        let conflicting = fixture.published(2, &conflicting_binding);
        assert!(matches!(
            registry
                .register(&conflicting)
                .expect_err("changed logical identity must conflict"),
            FeedBrowseGenerationRegistryError::GenerationConflict
        ));
    }

    #[test]
    fn selection_rollback_and_response_loss_replay_are_atomic() {
        let fixture = Fixture::new("transition");
        let first_published = fixture.published(1, &fixture.binding(1));
        let second_published = fixture.published(2, &fixture.binding(2));
        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        let first = registry.register(&first_published).expect("register first");
        let second = registry
            .register(&second_published)
            .expect("register second");
        let select_first = registry
            .select("select-first", None, &first.binding.generation_id)
            .expect("select first");
        drop(registry);

        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("reopen registry");
        assert_eq!(
            registry
                .select("select-first", None, &first.binding.generation_id)
                .expect("replay selection"),
            select_first
        );
        registry
            .select(
                "select-second",
                Some(&first.binding.generation_id),
                &second.binding.generation_id,
            )
            .expect("select second");
        let rollback = registry
            .rollback(
                "rollback-first",
                Some(&second.binding.generation_id),
                &first.binding.generation_id,
            )
            .expect("rollback first");
        assert_eq!(rollback.committed_sequence, 3);
        assert_eq!(
            FeedBrowseGenerationRegistry::read_selected_generation(&fixture.registry_path)
                .expect("read selected"),
            FeedBrowseGenerationReaderSelection {
                generation: first,
                transition_sequence: 3,
            }
        );
    }

    #[test]
    fn pruning_repeated_selections_retains_only_current_and_exact_rollback() {
        let fixture = Fixture::new("prune");
        let published = [1, 2, 3, 4].map(|suffix| {
            let binding = fixture.binding(suffix);
            fixture.published(suffix, &binding)
        });
        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");

        let first = registry.register(&published[0]).expect("register first");
        registry
            .select("select-prune-first", None, &first.binding.generation_id)
            .expect("select first");
        assert_eq!(
            registry
                .prune_unselected_generations()
                .expect("prune first"),
            0
        );

        let second = registry.register(&published[1]).expect("register second");
        registry
            .select(
                "select-prune-second",
                Some(&first.binding.generation_id),
                &second.binding.generation_id,
            )
            .expect("select second");
        assert_eq!(
            registry
                .prune_unselected_generations()
                .expect("prune second"),
            0
        );

        let third = registry.register(&published[2]).expect("register third");
        registry
            .select(
                "select-prune-third",
                Some(&second.binding.generation_id),
                &third.binding.generation_id,
            )
            .expect("select third");
        assert_eq!(
            registry
                .prune_unselected_generations()
                .expect("prune third"),
            1
        );
        assert!(!published[0].path.exists());
        assert!(published[1].path.exists());
        assert!(published[2].path.exists());

        let fourth = registry.register(&published[3]).expect("register fourth");
        registry
            .select(
                "select-prune-fourth",
                Some(&third.binding.generation_id),
                &fourth.binding.generation_id,
            )
            .expect("select fourth");
        assert_eq!(
            registry
                .prune_unselected_generations()
                .expect("prune fourth"),
            1
        );
        assert!(!published[1].path.exists());
        assert!(published[2].path.exists());
        assert!(published[3].path.exists());

        registry
            .rollback(
                "rollback-pruned-third",
                Some(&fourth.binding.generation_id),
                &third.binding.generation_id,
            )
            .expect("rollback to exact retained generation");
        assert_eq!(
            registry
                .prune_unselected_generations()
                .expect("prune rollback"),
            0
        );
        assert_eq!(
            FeedBrowseGenerationRegistry::read_selected_generation(&fixture.registry_path)
                .expect("read rollback selection")
                .generation
                .binding
                .generation_id,
            third.binding.generation_id
        );
        assert_eq!(
            registry
                .connection
                .query_row("SELECT COUNT(*) FROM feed_browse_generations;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("count retained generations"),
            2
        );
        assert_eq!(
            registry
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM feed_browse_generation_transitions;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("count retained transitions"),
            1
        );
    }

    #[test]
    fn pruning_rejects_an_unexpected_file_type_before_removing_other_candidates() {
        let fixture = Fixture::new("prune-fail-closed");
        let published = [11, 12, 13, 14].map(|suffix| {
            let binding = fixture.binding(suffix);
            fixture.published(suffix, &binding)
        });
        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        let registered = published
            .iter()
            .map(|generation| registry.register(generation).expect("register generation"))
            .collect::<Vec<_>>();
        registry
            .select(
                "select-fail-closed-first",
                None,
                &registered[0].binding.generation_id,
            )
            .expect("select first");
        for index in 1..registered.len() {
            registry
                .select(
                    &format!("select-fail-closed-{}", index + 1),
                    Some(&registered[index - 1].binding.generation_id),
                    &registered[index].binding.generation_id,
                )
                .expect("select next");
        }

        std::fs::remove_file(&published[1].path).expect("remove stale file");
        std::fs::create_dir(&published[1].path).expect("replace stale file with directory");
        assert!(matches!(
            registry
                .prune_unselected_generations()
                .expect_err("unexpected file type must fail closed"),
            FeedBrowseGenerationRegistryError::InvalidGeneration {
                field: "prune_file_type"
            }
        ));
        assert!(
            published[0].path.exists(),
            "preflight must not remove an earlier candidate before rejecting a later one"
        );
        assert_eq!(
            registry
                .connection
                .query_row("SELECT COUNT(*) FROM feed_browse_generations;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("count unchanged generations"),
            4
        );
        assert_eq!(
            registry
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM feed_browse_generation_transitions;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("count unchanged transitions"),
            4
        );
    }

    #[test]
    fn pruning_holds_the_registry_write_lock_before_choosing_stale_candidates() {
        let fixture = Fixture::new("prune-selection-race");
        let published = [21, 22, 23].map(|suffix| {
            let binding = fixture.binding(suffix);
            fixture.published(suffix, &binding)
        });
        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        let registered = published
            .iter()
            .map(|generation| registry.register(generation).expect("register generation"))
            .collect::<Vec<_>>();
        registry
            .select(
                "select-race-first",
                None,
                &registered[0].binding.generation_id,
            )
            .expect("select first");
        registry
            .select(
                "select-race-second",
                Some(&registered[0].binding.generation_id),
                &registered[1].binding.generation_id,
            )
            .expect("select second");

        let mut concurrent =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open concurrent registry");
        concurrent
            .connection
            .busy_timeout(Duration::ZERO)
            .expect("disable busy retry");
        registry
            .prune_unselected_generations_with_hook(|| {
                assert!(
                    concurrent
                        .select(
                            "select-race-third",
                            Some(&registered[1].binding.generation_id),
                            &registered[2].binding.generation_id,
                        )
                        .is_err(),
                    "selection must not commit after prune chooses its candidates"
                );
                Ok(())
            })
            .expect("prune while selection is blocked");

        assert_eq!(
            FeedBrowseGenerationRegistry::read_selected_generation(&fixture.registry_path)
                .expect("read selected generation")
                .generation
                .binding
                .generation_id,
            registered[1].binding.generation_id
        );
        assert!(!published[2].path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn pruning_rejects_a_replaced_generation_root_without_touching_the_replacement() {
        let fixture = Fixture::new("prune-root-replacement");
        let published = [31, 32, 33].map(|suffix| {
            let binding = fixture.binding(suffix);
            fixture.published(suffix, &binding)
        });
        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        let registered = published
            .iter()
            .map(|generation| registry.register(generation).expect("register generation"))
            .collect::<Vec<_>>();
        registry
            .select(
                "select-root-replacement-first",
                None,
                &registered[0].binding.generation_id,
            )
            .expect("select first");
        registry
            .select(
                "select-root-replacement-second",
                Some(&registered[0].binding.generation_id),
                &registered[1].binding.generation_id,
            )
            .expect("select second");

        let retired_root = fixture.root.join("retired-generations");
        let replacement_path = fixture
            .generation_root
            .join(published[2].path.file_name().expect("file name"));
        assert!(matches!(
            registry
                .prune_unselected_generations_with_hook(|| {
                    std::fs::rename(&fixture.generation_root, &retired_root)?;
                    std::fs::create_dir(&fixture.generation_root)?;
                    std::fs::write(&replacement_path, b"replacement generation")?;
                    Ok(())
                })
                .expect_err("root replacement must fail closed"),
            FeedBrowseGenerationRegistryError::InvalidGeneration {
                field: "prune_generation_root"
            }
        ));
        assert_eq!(
            std::fs::read(&replacement_path).expect("read replacement generation"),
            b"replacement generation"
        );
        assert!(
            retired_root
                .join(published[2].path.file_name().expect("file name"))
                .exists(),
            "the pinned old root must also remain untouched after identity rejection"
        );
    }

    #[test]
    fn pruning_rejects_registry_file_names_outside_the_generation_root() {
        for file_name in [
            "../outside.sqlite",
            "/tmp/outside.sqlite",
            "nested/outside.sqlite",
            r"nested\outside.sqlite",
            ".",
            "..",
        ] {
            assert!(matches!(
                validate_stored_file_name(file_name)
                    .expect_err("escaping file name must fail closed"),
                FeedBrowseGenerationRegistryError::InvalidGeneration { field: "file_name" }
            ));
        }
        validate_stored_file_name("generation-31.sqlite").expect("single component file name");
    }

    #[test]
    fn foreign_registry_and_unsealed_generation_are_rejected_without_mutation() {
        let fixture = Fixture::new("fail-closed");
        {
            let connection =
                Connection::open(&fixture.registry_path).expect("create foreign registry");
            connection
                .pragma_update(None, "application_id", 7)
                .expect("set foreign identity");
        }
        let before = std::fs::read(&fixture.registry_path).expect("read foreign bytes");
        assert!(matches!(
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root,)
                .err()
                .expect("foreign registry must fail"),
            FeedBrowseGenerationRegistryError::InvalidRegistryIdentity {
                field: "application_id"
            }
        ));
        assert_eq!(
            std::fs::read(&fixture.registry_path).expect("read foreign after"),
            before
        );

        std::fs::remove_file(&fixture.registry_path).expect("remove foreign registry");
        let binding = fixture.binding(3);
        let path = fixture.generation_root.join("unsealed.sqlite");
        let mut store = FeedBrowseGenerationStore::open(&path).expect("open generation");
        store.begin(&binding).expect("begin generation");
        store.finalize().expect("finalize generation");
        let fake = PublishedFeedBrowseGeneration {
            path,
            binding,
            progress: store.progress().expect("progress"),
            byte_length: 1,
            file_digest: "a".repeat(64),
        };
        let mut registry =
            FeedBrowseGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        assert!(matches!(
            registry
                .register(&fake)
                .expect_err("unsealed generation must fail"),
            FeedBrowseGenerationRegistryError::InvalidGeneration {
                field: "sealed_generation"
            }
        ));
    }
}
