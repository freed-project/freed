//! Durable selection registry for immutable derived-shadow generations.
//!
//! Publication and selection are deliberately separate. The shadow publisher
//! seals one complete SQLite file without making it readable by production.
//! This registry then content-addresses that sealed file, records it exactly
//! once, and changes the current reader generation in one replayable
//! transaction. The startup migration bridge publishes through this registry,
//! but Automerge remains the product reader and authority.

use crate::shadow_store::PublishedProjectionGeneration;
use crate::sqlite_registry_file::{self, SqliteRegistryFileError, SqliteRegistrySpec};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

const REGISTRY_APPLICATION_ID: i64 = 1_179_079_217;
const REGISTRY_SCHEMA_VERSION: i64 = 1;
const REGISTRY_SCHEMA_SQL: &str =
    include_str!("../../../shared/src/library-core/projection-generation-registry-v1.sql");
const REGISTRY_SPEC: SqliteRegistrySpec = SqliteRegistrySpec {
    application_id: REGISTRY_APPLICATION_ID,
    schema_version: REGISTRY_SCHEMA_VERSION,
    schema_sql: REGISTRY_SCHEMA_SQL,
};
const MAX_TRANSITION_ID_BYTES: usize = 128;
const HASH_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub(super) enum ProjectionGenerationRegistryError {
    Sql(rusqlite::Error),
    Io(std::io::Error),
    InvalidRegistryIdentity { field: &'static str },
    InvalidGeneration { field: &'static str },
    GenerationConflict,
    TransitionConflict,
    StaleCurrentGeneration,
    MissingRollbackGeneration,
    AlreadySelectedGeneration,
    NoSelectedGeneration,
}

impl From<rusqlite::Error> for ProjectionGenerationRegistryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<std::io::Error> for ProjectionGenerationRegistryError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<SqliteRegistryFileError> for ProjectionGenerationRegistryError {
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

impl fmt::Display for ProjectionGenerationRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::InvalidRegistryIdentity { field } => {
                write!(formatter, "invalid projection generation registry {field}")
            }
            Self::InvalidGeneration { field } => {
                write!(formatter, "invalid projection generation {field}")
            }
            Self::GenerationConflict => {
                formatter.write_str("projection generation registration conflicts")
            }
            Self::TransitionConflict => {
                formatter.write_str("projection generation transition conflicts")
            }
            Self::StaleCurrentGeneration => {
                formatter.write_str("projection reader generation changed")
            }
            Self::MissingRollbackGeneration => {
                formatter.write_str("projection reader has no exact rollback generation")
            }
            Self::AlreadySelectedGeneration => {
                formatter.write_str("projection generation is already selected")
            }
            Self::NoSelectedGeneration => {
                formatter.write_str("projection reader has no selected generation")
            }
        }
    }
}

impl std::error::Error for ProjectionGenerationRegistryError {}

type RegistryResult<T> = Result<T, ProjectionGenerationRegistryError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RegisteredProjectionGeneration {
    pub(super) generation_id: String,
    pub(super) file_name: String,
    pub(super) rebuild_id: String,
    pub(super) source_document_id: String,
    pub(super) source_heads_digest: String,
    pub(super) source_head_count: i64,
    pub(super) source_generation: i64,
    pub(super) source_save_revision: i64,
    pub(super) total_rows: usize,
    pub(super) projection_revision: i64,
    pub(super) byte_length: u64,
    pub(super) registered_sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectionReaderState {
    current_generation_id: Option<String>,
    rollback_generation_id: Option<String>,
    transition_sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectionGenerationReaderSelection {
    pub(super) generation: RegisteredProjectionGeneration,
    pub(super) transition_sequence: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectionGenerationTransitionKind {
    Select,
    Rollback,
}

impl ProjectionGenerationTransitionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::Rollback => "rollback",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectionGenerationTransition {
    transition_id: String,
    transition_digest: String,
    kind: ProjectionGenerationTransitionKind,
    expected_current_generation_id: Option<String>,
    selected_generation_id: String,
    previous_generation_id: Option<String>,
    committed_rollback_generation_id: Option<String>,
    committed_sequence: i64,
}

pub(super) struct ProjectionGenerationRegistry {
    conn: Connection,
    generation_root: PathBuf,
}

impl ProjectionGenerationRegistry {
    pub(super) fn read_selected_generation(
        path: &Path,
    ) -> RegistryResult<ProjectionGenerationReaderSelection> {
        let conn = sqlite_registry_file::open_read_only(path, REGISTRY_SPEC)?;
        let state = validate_reader_state(conn.query_row(
            "SELECT currentGenerationId, rollbackGenerationId, transitionSequence
             FROM projection_reader_state WHERE singleton = 1;",
            [],
            read_reader_state,
        )?)?;
        let generation_id = state
            .current_generation_id
            .as_deref()
            .ok_or(ProjectionGenerationRegistryError::NoSelectedGeneration)?;
        let generation = read_registered_generation_by_id(&conn, generation_id)?.ok_or(
            ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "selected_generation",
            },
        )?;
        sqlite_registry_file::verify(&conn, REGISTRY_SPEC)?;
        Ok(ProjectionGenerationReaderSelection {
            generation,
            transition_sequence: state.transition_sequence,
        })
    }

    pub(super) fn open(path: &Path, generation_root: &Path) -> RegistryResult<Self> {
        if !generation_root.is_absolute() || generation_root.file_name().is_none() {
            return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "generation_root",
            });
        }
        let conn = sqlite_registry_file::open_or_create(path, REGISTRY_SPEC)?;
        let registry = Self {
            conn,
            generation_root: generation_root.to_path_buf(),
        };
        Ok(registry)
    }

    pub(super) fn register(
        &mut self,
        published: &PublishedProjectionGeneration,
    ) -> RegistryResult<RegisteredProjectionGeneration> {
        let file_name = self.validate_published_generation(published)?;
        let generation_id = digest_file(&published.path)?;
        let byte_length = std::fs::metadata(&published.path)?.len();
        if byte_length != published.byte_length {
            return Err(ProjectionGenerationRegistryError::InvalidGeneration {
                field: "byte_length",
            });
        }
        let candidate = RegisteredProjectionGeneration {
            generation_id,
            file_name,
            rebuild_id: published.rebuild_id.clone(),
            source_document_id: published.source.document_id.clone(),
            source_heads_digest: published.source.heads_digest.clone(),
            source_head_count: published.source.head_count,
            source_generation: published.source.storage_generation,
            source_save_revision: published.source.storage_save_revision,
            total_rows: published.total_rows,
            projection_revision: published.projection_revision,
            byte_length,
            registered_sequence: 0,
        };
        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = find_registered_generation(
            &transaction,
            &candidate.generation_id,
            &candidate.file_name,
            &candidate.rebuild_id,
        )?;
        if let Some(existing) = existing {
            if same_generation_without_sequence(&existing, &candidate) {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(ProjectionGenerationRegistryError::GenerationConflict);
        }
        let registered_sequence = transaction.query_row(
            "UPDATE projection_generation_meta
             SET integerValue = integerValue + 1
             WHERE key = 'registrationSequence'
             RETURNING integerValue;",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        transaction.execute(
            "INSERT INTO projection_generations (
               generationId, fileName, rebuildId, sourceDocumentId,
               sourceHeadsDigest, sourceHeadCount, sourceGeneration,
               sourceSaveRevision, totalRows, projectionRevision, byteLength,
               registeredSequence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12);",
            params![
                candidate.generation_id,
                candidate.file_name,
                candidate.rebuild_id,
                candidate.source_document_id,
                candidate.source_heads_digest,
                candidate.source_head_count,
                candidate.source_generation,
                candidate.source_save_revision,
                candidate.total_rows as i64,
                candidate.projection_revision,
                candidate.byte_length as i64,
                registered_sequence,
            ],
        )?;
        let registered = RegisteredProjectionGeneration {
            registered_sequence,
            ..candidate
        };
        transaction.commit()?;
        Ok(registered)
    }

    fn reader_state(&self) -> RegistryResult<ProjectionReaderState> {
        let state = self
            .conn
            .query_row(
                "SELECT currentGenerationId, rollbackGenerationId, transitionSequence
                 FROM projection_reader_state WHERE singleton = 1;",
                [],
                read_reader_state,
            )
            .map_err(ProjectionGenerationRegistryError::from)?;
        validate_reader_state(state)
    }

    /// Retains only the selected generation, its exact rollback generation,
    /// and the latest replayable transition. This derived registry is not an
    /// audit authority, so old receipts must not grow with every source save.
    pub(super) fn prune_unselected_generations(&mut self) -> RegistryResult<usize> {
        let state = self.reader_state()?;
        let mut statement = self.conn.prepare(
            "SELECT generationId, fileName
             FROM projection_generations
             ORDER BY registeredSequence;",
        )?;
        let candidates = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        let mut removed = 0;
        for (generation_id, file_name) in &candidates {
            if state.current_generation_id.as_deref() == Some(generation_id.as_str())
                || state.rollback_generation_id.as_deref() == Some(generation_id.as_str())
            {
                continue;
            }
            validate_generation_file_name(file_name)?;
            let path = self.generation_root.join(file_name);
            match std::fs::symlink_metadata(&path) {
                Ok(metadata)
                    if metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
                {
                    std::fs::remove_file(&path)?;
                    removed += 1;
                }
                Ok(_) => {
                    return Err(ProjectionGenerationRegistryError::InvalidGeneration {
                        field: "prune_file_type",
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        #[cfg(unix)]
        if removed > 0 {
            File::open(&self.generation_root)?.sync_all()?;
        }

        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "DELETE FROM projection_generation_transitions
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
                "DELETE FROM projection_generations WHERE generationId = ?1;",
                [generation_id],
            )?;
        }
        transaction.commit()?;
        Ok(removed)
    }

    pub(super) fn select(
        &mut self,
        transition_id: &str,
        expected_current_generation_id: Option<&str>,
        selected_generation_id: &str,
    ) -> RegistryResult<ProjectionGenerationTransition> {
        self.transition(
            ProjectionGenerationTransitionKind::Select,
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
    ) -> RegistryResult<ProjectionGenerationTransition> {
        self.transition(
            ProjectionGenerationTransitionKind::Rollback,
            transition_id,
            expected_current_generation_id,
            selected_generation_id,
        )
    }

    fn transition(
        &mut self,
        kind: ProjectionGenerationTransitionKind,
        transition_id: &str,
        expected_current_generation_id: Option<&str>,
        selected_generation_id: &str,
    ) -> RegistryResult<ProjectionGenerationTransition> {
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
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = read_transition(&transaction, transition_id)? {
            if existing.transition_digest == transition_digest {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(ProjectionGenerationRegistryError::TransitionConflict);
        }
        let selected_exists = transaction.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM projection_generations WHERE generationId = ?1
             );",
            [selected_generation_id],
            |row| row.get::<_, bool>(0),
        )?;
        if !selected_exists {
            return Err(ProjectionGenerationRegistryError::InvalidGeneration {
                field: "unregistered_selection",
            });
        }
        let prior = validate_reader_state(transaction.query_row(
            "SELECT currentGenerationId, rollbackGenerationId, transitionSequence
             FROM projection_reader_state WHERE singleton = 1;",
            [],
            read_reader_state,
        )?)?;
        if prior.current_generation_id.as_deref() != expected_current_generation_id {
            return Err(ProjectionGenerationRegistryError::StaleCurrentGeneration);
        }
        if prior.current_generation_id.as_deref() == Some(selected_generation_id) {
            return Err(ProjectionGenerationRegistryError::AlreadySelectedGeneration);
        }
        if kind == ProjectionGenerationTransitionKind::Rollback
            && prior.rollback_generation_id.as_deref() != Some(selected_generation_id)
        {
            return Err(ProjectionGenerationRegistryError::MissingRollbackGeneration);
        }
        let committed_sequence = prior
            .transition_sequence
            .checked_add(1)
            .ok_or(ProjectionGenerationRegistryError::TransitionConflict)?;
        let committed_rollback_generation_id = prior.current_generation_id.clone();
        let updated = transaction.execute(
            "UPDATE projection_reader_state
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
        )?;
        if updated != 1 {
            return Err(ProjectionGenerationRegistryError::TransitionConflict);
        }
        transaction.execute(
            "INSERT INTO projection_generation_transitions (
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
        let committed = ProjectionGenerationTransition {
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
        published: &PublishedProjectionGeneration,
    ) -> RegistryResult<String> {
        if !published.path.is_absolute() || published.path.parent() != Some(&self.generation_root) {
            return Err(ProjectionGenerationRegistryError::InvalidGeneration { field: "path" });
        }
        let file_name = published
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(ProjectionGenerationRegistryError::InvalidGeneration { field: "file_name" })?;
        validate_generation_file_name(file_name)?;
        let metadata = std::fs::symlink_metadata(&published.path)?;
        if !metadata.file_type().is_file() || metadata.len() == 0 {
            return Err(ProjectionGenerationRegistryError::InvalidGeneration {
                field: "file_type",
            });
        }
        validate_digest(&published.source.heads_digest, "source_heads_digest")?;
        if published.rebuild_id.is_empty()
            || published.rebuild_id.len() > MAX_TRANSITION_ID_BYTES
            || published.source.document_id.is_empty()
            || published.source.document_id.len() > 4_096
            || published.source.head_count < 0
            || published.source.storage_generation < 0
            || published.source.storage_save_revision < 0
            || published.projection_revision < 0
            || published.total_rows > 250_000
            || published.byte_length == 0
            || published.byte_length > i64::MAX as u64
        {
            return Err(ProjectionGenerationRegistryError::InvalidGeneration { field: "receipt" });
        }
        Ok(file_name.to_owned())
    }
}

fn validate_generation_file_name(file_name: &str) -> RegistryResult<()> {
    if file_name.is_empty()
        || file_name.len() > 255
        || file_name == "."
        || file_name == ".."
        || file_name.contains(['/', '\\'])
    {
        return Err(ProjectionGenerationRegistryError::InvalidGeneration { field: "file_name" });
    }
    Ok(())
}

fn validate_transition_id(transition_id: &str) -> RegistryResult<()> {
    if transition_id.is_empty() || transition_id.len() > MAX_TRANSITION_ID_BYTES {
        return Err(ProjectionGenerationRegistryError::TransitionConflict);
    }
    Ok(())
}

fn validate_reader_state(state: ProjectionReaderState) -> RegistryResult<ProjectionReaderState> {
    if state.transition_sequence < 0
        || state.current_generation_id == state.rollback_generation_id
            && state.current_generation_id.is_some()
    {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "reader_state",
        });
    }
    if let Some(current) = state.current_generation_id.as_deref() {
        validate_digest(current, "current_generation_id").map_err(|_| {
            ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "reader_state",
            }
        })?;
    }
    if let Some(rollback) = state.rollback_generation_id.as_deref() {
        validate_digest(rollback, "rollback_generation_id").map_err(|_| {
            ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "reader_state",
            }
        })?;
    }
    Ok(state)
}

fn validate_digest(value: &str, field: &'static str) -> RegistryResult<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ProjectionGenerationRegistryError::InvalidGeneration { field });
    }
    Ok(())
}

fn digest_file(path: &Path) -> RegistryResult<String> {
    let before = std::fs::symlink_metadata(path)?;
    if !before.file_type().is_file() {
        return Err(ProjectionGenerationRegistryError::InvalidGeneration { field: "file_type" });
    }
    let mut file = File::open(path)?;
    let opened = file.metadata()?;
    if !opened.is_file() || !same_file_generation(&before, &opened) {
        return Err(ProjectionGenerationRegistryError::InvalidGeneration {
            field: "file_generation",
        });
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER_BYTES];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let after = std::fs::symlink_metadata(path)?;
    if !after.file_type().is_file() || !same_file_generation(&opened, &after) {
        return Err(ProjectionGenerationRegistryError::InvalidGeneration {
            field: "file_generation",
        });
    }
    Ok(lower_hex(&hasher.finalize()))
}

#[cfg(unix)]
fn same_file_generation(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.mode() == right.mode()
        && left.nlink() == right.nlink()
        && left.uid() == right.uid()
        && left.gid() == right.gid()
        && left.size() == right.size()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(not(unix))]
fn same_file_generation(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
        && left.created().ok() == right.created().ok()
}

fn digest_transition(
    kind: ProjectionGenerationTransitionKind,
    transition_id: &str,
    expected_current_generation_id: Option<&str>,
    selected_generation_id: &str,
) -> String {
    let mut hasher = Sha256::new();
    for field in [
        "freed.projection-generation-transition.v1",
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

fn read_registered_generation(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<RegisteredProjectionGeneration> {
    let total_rows = row.get::<_, i64>(8)?;
    let byte_length = row.get::<_, i64>(10)?;
    Ok(RegisteredProjectionGeneration {
        generation_id: row.get(0)?,
        file_name: row.get(1)?,
        rebuild_id: row.get(2)?,
        source_document_id: row.get(3)?,
        source_heads_digest: row.get(4)?,
        source_head_count: row.get(5)?,
        source_generation: row.get(6)?,
        source_save_revision: row.get(7)?,
        total_rows: usize::try_from(total_rows)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(8, total_rows))?,
        projection_revision: row.get(9)?,
        byte_length: u64::try_from(byte_length)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(10, byte_length))?,
        registered_sequence: row.get(11)?,
    })
}

fn read_registered_generation_by_id(
    conn: &Connection,
    generation_id: &str,
) -> RegistryResult<Option<RegisteredProjectionGeneration>> {
    validate_digest(generation_id, "generation_id")?;
    let generation = conn
        .query_row(
            "SELECT generationId, fileName, rebuildId, sourceDocumentId,
                    sourceHeadsDigest, sourceHeadCount, sourceGeneration,
                    sourceSaveRevision, totalRows, projectionRevision, byteLength,
                    registeredSequence
             FROM projection_generations
             WHERE generationId = ?1;",
            params![generation_id],
            read_registered_generation,
        )
        .optional()?;
    generation.map(validate_registered_generation).transpose()
}

fn validate_registered_generation(
    generation: RegisteredProjectionGeneration,
) -> RegistryResult<RegisteredProjectionGeneration> {
    validate_digest(&generation.generation_id, "generation_id")?;
    validate_digest(&generation.source_heads_digest, "source_heads_digest")?;
    if generation.file_name.is_empty()
        || generation.file_name.len() > 255
        || generation.file_name == "."
        || generation.file_name == ".."
        || generation.file_name.contains(['/', '\\'])
        || generation.rebuild_id.is_empty()
        || generation.rebuild_id.len() > MAX_TRANSITION_ID_BYTES
        || generation.source_document_id.is_empty()
        || generation.source_document_id.len() > 4_096
        || generation.source_head_count < 0
        || generation.source_generation < 0
        || generation.source_save_revision < 0
        || generation.total_rows > 250_000
        || generation.projection_revision < 0
        || generation.byte_length == 0
        || generation.registered_sequence <= 0
    {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "selected_generation",
        });
    }
    Ok(generation)
}

fn find_registered_generation(
    conn: &Connection,
    generation_id: &str,
    file_name: &str,
    rebuild_id: &str,
) -> RegistryResult<Option<RegisteredProjectionGeneration>> {
    let mut statement = conn.prepare(
        "SELECT generationId, fileName, rebuildId, sourceDocumentId,
                sourceHeadsDigest, sourceHeadCount, sourceGeneration,
                sourceSaveRevision, totalRows, projectionRevision, byteLength,
                registeredSequence
         FROM projection_generations
         WHERE generationId = ?1 OR fileName = ?2 OR rebuildId = ?3
         ORDER BY registeredSequence
         LIMIT 2;",
    )?;
    let rows = statement
        .query_map(
            params![generation_id, file_name, rebuild_id],
            read_registered_generation,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.len() > 1 {
        return Err(ProjectionGenerationRegistryError::GenerationConflict);
    }
    Ok(rows.into_iter().next())
}

fn same_generation_without_sequence(
    left: &RegisteredProjectionGeneration,
    right: &RegisteredProjectionGeneration,
) -> bool {
    left.generation_id == right.generation_id
        && left.file_name == right.file_name
        && left.rebuild_id == right.rebuild_id
        && left.source_document_id == right.source_document_id
        && left.source_heads_digest == right.source_heads_digest
        && left.source_head_count == right.source_head_count
        && left.source_generation == right.source_generation
        && left.source_save_revision == right.source_save_revision
        && left.total_rows == right.total_rows
        && left.projection_revision == right.projection_revision
        && left.byte_length == right.byte_length
}

fn read_reader_state(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectionReaderState> {
    Ok(ProjectionReaderState {
        current_generation_id: row.get(0)?,
        rollback_generation_id: row.get(1)?,
        transition_sequence: row.get(2)?,
    })
}

fn read_transition(
    conn: &Connection,
    transition_id: &str,
) -> RegistryResult<Option<ProjectionGenerationTransition>> {
    conn.query_row(
        "SELECT transitionId, transitionDigest, transitionKind,
                expectedCurrentGenerationId, selectedGenerationId,
                previousGenerationId, committedRollbackGenerationId,
                committedSequence
         FROM projection_generation_transitions
         WHERE transitionId = ?1;",
        [transition_id],
        |row| {
            let kind = match row.get::<_, String>(2)?.as_str() {
                "select" => ProjectionGenerationTransitionKind::Select,
                "rollback" => ProjectionGenerationTransitionKind::Rollback,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(ProjectionGenerationTransition {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shadow_store::{ProjectionSourceV1, PublishedProjectionGeneration};
    use std::time::{SystemTime, UNIX_EPOCH};

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
                    "freed-generation-registry-{label}-{}-{nonce}",
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

        fn published(&self, suffix: i64) -> PublishedProjectionGeneration {
            let path = self
                .generation_root
                .join(format!("generation-{suffix}.sqlite"));
            std::fs::write(&path, format!("immutable-generation-{suffix}\n"))
                .expect("write generation");
            PublishedProjectionGeneration {
                byte_length: std::fs::metadata(&path).expect("metadata").len(),
                path,
                rebuild_id: format!("rebuild-{suffix}"),
                source: ProjectionSourceV1 {
                    document_id: "document-a".to_owned(),
                    heads_digest: format!("{suffix:064x}"),
                    head_count: suffix,
                    storage_generation: suffix,
                    storage_save_revision: suffix,
                },
                total_rows: suffix as usize,
                projection_revision: suffix,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn registration_is_content_addressed_and_replays_after_reopen() {
        let fixture = Fixture::new("register");
        let published = fixture.published(1);
        let first = {
            let mut registry = ProjectionGenerationRegistry::open(
                &fixture.registry_path,
                &fixture.generation_root,
            )
            .expect("open registry");
            registry.register(&published).expect("register generation")
        };
        let second = {
            let mut registry = ProjectionGenerationRegistry::open(
                &fixture.registry_path,
                &fixture.generation_root,
            )
            .expect("reopen registry");
            registry.register(&published).expect("replay registration")
        };

        assert_eq!(first, second);
        assert_eq!(first.registered_sequence, 1);
        assert_eq!(first.byte_length, published.byte_length);
        assert_eq!(
            first.generation_id,
            digest_file(&published.path).expect("digest")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&fixture.registry_path)
                    .expect("registry metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn registration_rejects_changed_bytes_for_the_same_publication_identity() {
        let fixture = Fixture::new("changed");
        let mut published = fixture.published(2);
        let mut registry =
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        registry.register(&published).expect("register generation");
        std::fs::write(&published.path, "changed-immutable-generation\n")
            .expect("change generation fixture");
        published.byte_length = std::fs::metadata(&published.path).expect("metadata").len();

        assert!(matches!(
            registry
                .register(&published)
                .expect_err("changed bytes must conflict"),
            ProjectionGenerationRegistryError::GenerationConflict
        ));
    }

    #[test]
    fn selection_and_rollback_are_atomic_and_exactly_replayable() {
        let fixture = Fixture::new("transition");
        let first_published = fixture.published(3);
        let second_published = fixture.published(4);
        let mut registry =
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        let first = registry.register(&first_published).expect("register first");
        let second = registry
            .register(&second_published)
            .expect("register second");

        let select_first = registry
            .select("select-first", None, &first.generation_id)
            .expect("select first");
        assert_eq!(
            registry.reader_state().expect("first state"),
            ProjectionReaderState {
                current_generation_id: Some(first.generation_id.clone()),
                rollback_generation_id: None,
                transition_sequence: 1,
            }
        );
        drop(registry);
        let mut registry =
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("reopen after selection response loss");
        assert_eq!(
            registry
                .select("select-first", None, &first.generation_id)
                .expect("replay first"),
            select_first
        );
        assert!(matches!(
            registry
                .select("select-first", None, &second.generation_id)
                .expect_err("changed transition replay must conflict"),
            ProjectionGenerationRegistryError::TransitionConflict
        ));

        registry
            .select(
                "select-second",
                Some(&first.generation_id),
                &second.generation_id,
            )
            .expect("select second");
        let rollback = registry
            .rollback(
                "rollback-first",
                Some(&second.generation_id),
                &first.generation_id,
            )
            .expect("rollback");
        assert_eq!(rollback.committed_sequence, 3);
        assert_eq!(
            registry.reader_state().expect("rolled back state"),
            ProjectionReaderState {
                current_generation_id: Some(first.generation_id),
                rollback_generation_id: Some(second.generation_id),
                transition_sequence: 3,
            }
        );
    }

    #[test]
    fn pruning_retains_only_the_selected_and_exact_rollback_generation_files() {
        let fixture = Fixture::new("prune");
        let first_published = fixture.published(21);
        let second_published = fixture.published(22);
        let third_published = fixture.published(23);
        let mut registry =
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        let first = registry.register(&first_published).expect("register first");
        let second = registry
            .register(&second_published)
            .expect("register second");
        let third = registry.register(&third_published).expect("register third");
        registry
            .select("select-prune-first", None, &first.generation_id)
            .expect("select first");
        registry
            .select(
                "select-prune-second",
                Some(&first.generation_id),
                &second.generation_id,
            )
            .expect("select second");
        registry
            .select(
                "select-prune-third",
                Some(&second.generation_id),
                &third.generation_id,
            )
            .expect("select third");

        assert_eq!(
            registry
                .prune_unselected_generations()
                .expect("prune stale generation"),
            1
        );
        assert!(!first_published.path.exists());
        assert!(second_published.path.exists());
        assert!(third_published.path.exists());
        assert_eq!(
            registry
                .conn
                .query_row("SELECT COUNT(*) FROM projection_generations;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("count retained generations"),
            2
        );
        assert_eq!(
            registry
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM projection_generation_transitions;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("count retained transitions"),
            1
        );
        assert_eq!(
            registry
                .prune_unselected_generations()
                .expect("replay prune"),
            0
        );
    }

    #[test]
    fn transitions_reject_stale_current_and_nonrollback_targets() {
        let fixture = Fixture::new("stale");
        let first_published = fixture.published(5);
        let second_published = fixture.published(6);
        let mut registry =
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("open registry");
        let first = registry.register(&first_published).expect("register first");
        let second = registry
            .register(&second_published)
            .expect("register second");
        registry
            .select("select-first", None, &first.generation_id)
            .expect("select first");

        assert!(matches!(
            registry
                .select("stale", None, &second.generation_id)
                .expect_err("stale current must fail"),
            ProjectionGenerationRegistryError::StaleCurrentGeneration
        ));
        assert!(matches!(
            registry
                .rollback(
                    "wrong-rollback",
                    Some(&first.generation_id),
                    &second.generation_id,
                )
                .expect_err("unrecorded rollback must fail"),
            ProjectionGenerationRegistryError::MissingRollbackGeneration
        ));
    }

    #[test]
    fn existing_foreign_registry_is_rejected_without_writable_configuration() {
        let fixture = Fixture::new("foreign");
        {
            let conn = Connection::open(&fixture.registry_path).expect("create foreign database");
            conn.pragma_update(None, "application_id", 7)
                .expect("write foreign identity");
            conn.pragma_update(None, "user_version", 1)
                .expect("write foreign version");
        }
        let before = std::fs::read(&fixture.registry_path).expect("read foreign bytes");

        assert!(matches!(
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root,)
                .err()
                .expect("foreign registry must fail"),
            ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "application_id"
            }
        ));
        assert_eq!(
            std::fs::read(&fixture.registry_path).expect("read foreign bytes after"),
            before
        );
    }

    #[test]
    fn existing_empty_registry_is_never_blessed() {
        let fixture = Fixture::new("empty");
        File::create(&fixture.registry_path).expect("create empty registry");

        assert!(matches!(
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root,)
                .err()
                .expect("empty registry must fail"),
            ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "application_id"
            }
        ));
        assert_eq!(
            std::fs::metadata(&fixture.registry_path)
                .expect("empty registry metadata")
                .len(),
            0
        );
    }

    #[test]
    fn existing_registry_rejects_catalog_drift_before_selection() {
        let fixture = Fixture::new("catalog");
        drop(
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("create registry"),
        );
        {
            let conn = Connection::open(&fixture.registry_path).expect("open registry directly");
            conn.execute_batch("DROP INDEX projection_generation_registration_order;")
                .expect("drift catalog");
        }

        assert!(matches!(
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root,)
                .err()
                .expect("drifted registry must fail"),
            ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "schema_catalog"
            }
        ));
    }

    #[test]
    fn reader_state_rejects_constraint_bypassed_corruption() {
        let fixture = Fixture::new("reader-state");
        let registry =
            ProjectionGenerationRegistry::open(&fixture.registry_path, &fixture.generation_root)
                .expect("create registry");
        registry
            .conn
            .pragma_update(None, "ignore_check_constraints", "ON")
            .expect("disable fixture checks");
        registry
            .conn
            .execute(
                "UPDATE projection_reader_state SET transitionSequence = -1 WHERE singleton = 1;",
                [],
            )
            .expect("corrupt reader state");

        assert!(matches!(
            registry
                .reader_state()
                .expect_err("corrupt reader state must fail"),
            ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "reader_state"
            }
        ));
    }
}
