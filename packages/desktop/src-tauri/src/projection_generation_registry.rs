//! Durable selection registry for immutable derived-shadow generations.
//!
//! Publication and selection are deliberately separate. The shadow publisher
//! seals one complete SQLite file without making it readable by production.
//! This registry then content-addresses that sealed file, records it exactly
//! once, and changes the current reader generation in one replayable
//! transaction. No production entry point opens this registry yet.

use crate::shadow_store::{publish_projection_file, PublishedProjectionGeneration};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

const REGISTRY_APPLICATION_ID: i64 = 1_179_079_217;
const REGISTRY_SCHEMA_VERSION: i64 = 1;
const REGISTRY_SCHEMA_SQL: &str =
    include_str!("../../../shared/src/library-core/projection-generation-registry-v1.sql");
const MAX_TRANSITION_ID_BYTES: usize = 128;
const HASH_BUFFER_BYTES: usize = 1024 * 1024;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
enum ProjectionGenerationRegistryError {
    Sql(rusqlite::Error),
    Io(std::io::Error),
    InvalidRegistryIdentity { field: &'static str },
    InvalidGeneration { field: &'static str },
    GenerationConflict,
    TransitionConflict,
    StaleCurrentGeneration,
    MissingRollbackGeneration,
    AlreadySelectedGeneration,
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
        }
    }
}

type RegistryResult<T> = Result<T, ProjectionGenerationRegistryError>;

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegisteredProjectionGeneration {
    generation_id: String,
    file_name: String,
    rebuild_id: String,
    source_document_id: String,
    source_heads_digest: String,
    source_head_count: i64,
    source_generation: i64,
    source_save_revision: i64,
    total_rows: usize,
    projection_revision: i64,
    byte_length: u64,
    registered_sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectionReaderState {
    current_generation_id: Option<String>,
    rollback_generation_id: Option<String>,
    transition_sequence: i64,
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
struct ProjectionGenerationTransition {
    transition_id: String,
    transition_digest: String,
    kind: ProjectionGenerationTransitionKind,
    expected_current_generation_id: Option<String>,
    selected_generation_id: String,
    previous_generation_id: Option<String>,
    committed_rollback_generation_id: Option<String>,
    committed_sequence: i64,
}

struct ProjectionGenerationRegistry {
    conn: Connection,
    generation_root: PathBuf,
}

impl ProjectionGenerationRegistry {
    fn open(path: &Path, generation_root: &Path) -> RegistryResult<Self> {
        if !path.is_absolute()
            || !generation_root.is_absolute()
            || path.file_name().is_none()
            || generation_root.file_name().is_none()
        {
            return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "paths",
            });
        }
        let created = create_registry_if_absent(path)?;
        if !created {
            let preflight = Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                    | OpenFlags::SQLITE_OPEN_NOFOLLOW,
            )?;
            verify_registry_integrity(&preflight)?;
            verify_registry_identity(&preflight)?;
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        #[cfg(target_os = "macos")]
        conn.pragma_update(None, "fullfsync", "ON")?;
        let registry = Self {
            conn,
            generation_root: generation_root.to_path_buf(),
        };
        verify_registry_identity(&registry.conn)?;
        registry.conn.pragma_update(None, "journal_mode", "WAL")?;
        verify_registry_integrity(&registry.conn)?;
        verify_registry_identity(&registry.conn)?;
        if created {
            sync_parent_directory(path)?;
        }
        Ok(registry)
    }

    fn register(
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

    fn select(
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

    fn rollback(
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
        if file_name.is_empty()
            || file_name.len() > 255
            || file_name == "."
            || file_name == ".."
            || file_name.contains(['/', '\\'])
        {
            return Err(ProjectionGenerationRegistryError::InvalidGeneration {
                field: "file_name",
            });
        }
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

fn create_registry_if_absent(path: &Path) -> RegistryResult<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let parent =
        path.parent()
            .ok_or(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "parent_directory",
            })?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(ProjectionGenerationRegistryError::InvalidRegistryIdentity { field: "file_name" })?;
    for _ in 0..16 {
        let staging = parent.join(format!(
            ".{file_name}.{:032x}.initializing",
            rand::random::<u128>()
        ));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = match options.open(&staging) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };
        drop(file);
        let result = initialize_and_publish_registry(&staging, path);
        if staging.exists() {
            std::fs::remove_file(&staging)?;
            sync_parent_directory(&staging)?;
        }
        return match result {
            Ok(()) => Ok(true),
            Err(ProjectionGenerationRegistryError::Io(error))
                if error.kind() == std::io::ErrorKind::AlreadyExists =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        };
    }
    Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
        field: "staging_path",
    })
}

fn initialize_and_publish_registry(staging: &Path, destination: &Path) -> RegistryResult<()> {
    let mut conn = Connection::open_with_flags(
        staging,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    #[cfg(target_os = "macos")]
    conn.pragma_update(None, "fullfsync", "ON")?;
    let transaction = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let application_id =
        transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
    let user_version =
        transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
    let object_count = transaction.query_row(
        "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%';",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if application_id != 0 || user_version != 0 || object_count != 0 {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "new_file",
        });
    }
    transaction.execute_batch(REGISTRY_SCHEMA_SQL)?;
    transaction.commit()?;
    verify_registry_integrity(&conn)?;
    verify_registry_identity(&conn)?;
    conn.close()
        .map_err(|(_, error)| ProjectionGenerationRegistryError::Sql(error))?;
    File::open(staging)?.sync_all()?;
    publish_projection_file(staging, destination)?;
    File::open(destination)?.sync_all()?;
    Ok(())
}

fn verify_registry_integrity(conn: &Connection) -> RegistryResult<()> {
    let quick_check =
        conn.query_row("PRAGMA quick_check(1);", [], |row| row.get::<_, String>(0))?;
    if quick_check != "ok" {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "integrity",
        });
    }
    let foreign_key_problem = conn
        .query_row("PRAGMA foreign_key_check;", [], |_| Ok(()))
        .optional()?;
    if foreign_key_problem.is_some() {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "foreign_keys",
        });
    }
    Ok(())
}

fn verify_registry_identity(conn: &Connection) -> RegistryResult<()> {
    let application_id =
        conn.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
    if application_id != REGISTRY_APPLICATION_ID {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "application_id",
        });
    }
    let user_version = conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
    if user_version != REGISTRY_SCHEMA_VERSION {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "schema_version",
        });
    }
    if registry_catalog(conn)? != expected_registry_catalog()? {
        return Err(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
            field: "schema_catalog",
        });
    }
    Ok(())
}

fn registry_catalog(conn: &Connection) -> RegistryResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '')
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name, tbl_name;",
    )?;
    let catalog = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(ProjectionGenerationRegistryError::from)?;
    Ok(catalog)
}

fn expected_registry_catalog() -> RegistryResult<Vec<(String, String, String, String)>> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(REGISTRY_SCHEMA_SQL)?;
    registry_catalog(&reference)
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
fn sync_parent_directory(path: &Path) -> RegistryResult<()> {
    let parent =
        path.parent()
            .ok_or(ProjectionGenerationRegistryError::InvalidRegistryIdentity {
                field: "parent_directory",
            })?;
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> RegistryResult<()> {
    Ok(())
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
