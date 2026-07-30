//! Shared file lifecycle for small, durable SQLite control registries.
//!
//! Domain registries retain their own schemas, rows, and transition rules.
//! This module owns the security and durability-sensitive file shell so every
//! registry gets the same no-follow opens, atomic initialization, exact schema
//! catalog check, integrity verification, and full-sync configuration.

use crate::shadow_store::publish_projection_file;
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::path::Path;
use std::time::Duration;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub(super) enum SqliteRegistryFileError {
    Sql(rusqlite::Error),
    Io(std::io::Error),
    InvalidIdentity(&'static str),
}

impl From<rusqlite::Error> for SqliteRegistryFileError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<std::io::Error> for SqliteRegistryFileError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for SqliteRegistryFileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::InvalidIdentity(field) => write!(formatter, "invalid registry {field}"),
        }
    }
}

impl std::error::Error for SqliteRegistryFileError {}

pub(super) type RegistryFileResult<T> = Result<T, SqliteRegistryFileError>;

#[derive(Debug, Clone, Copy)]
pub(super) struct SqliteRegistrySpec {
    pub(super) application_id: i64,
    pub(super) schema_version: i64,
    pub(super) schema_sql: &'static str,
}

pub(super) fn open_read_only(
    path: &Path,
    spec: SqliteRegistrySpec,
) -> RegistryFileResult<Connection> {
    validate_absolute_file_path(path)?;
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_EXRESCODE,
    )?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    verify(&connection, spec)?;
    Ok(connection)
}

pub(super) fn open_or_create(
    path: &Path,
    spec: SqliteRegistrySpec,
) -> RegistryFileResult<Connection> {
    validate_absolute_file_path(path)?;
    let created = create_if_absent(path, spec)?;
    if !created {
        drop(open_read_only(path, spec)?);
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_EXRESCODE,
    )?;
    configure_writable(&connection)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    verify(&connection, spec)?;
    if created {
        sync_parent_directory(path)?;
    }
    Ok(connection)
}

pub(super) fn verify(connection: &Connection, spec: SqliteRegistrySpec) -> RegistryFileResult<()> {
    let quick_check =
        connection.query_row("PRAGMA quick_check(1);", [], |row| row.get::<_, String>(0))?;
    if quick_check != "ok" {
        return Err(SqliteRegistryFileError::InvalidIdentity("integrity"));
    }
    if connection
        .query_row("PRAGMA foreign_key_check;", [], |_| Ok(()))
        .optional()?
        .is_some()
    {
        return Err(SqliteRegistryFileError::InvalidIdentity("foreign_keys"));
    }
    let application_id =
        connection.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
    if application_id != spec.application_id {
        return Err(SqliteRegistryFileError::InvalidIdentity("application_id"));
    }
    let schema_version =
        connection.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
    if schema_version != spec.schema_version {
        return Err(SqliteRegistryFileError::InvalidIdentity("schema_version"));
    }
    if schema_catalog(connection)? != expected_schema_catalog(spec)? {
        return Err(SqliteRegistryFileError::InvalidIdentity("schema_catalog"));
    }
    Ok(())
}

fn create_if_absent(path: &Path, spec: SqliteRegistrySpec) -> RegistryFileResult<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let parent = path
        .parent()
        .ok_or(SqliteRegistryFileError::InvalidIdentity("parent_directory"))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(SqliteRegistryFileError::InvalidIdentity("file_name"))?;
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
        let result = initialize_and_publish(&staging, path, spec);
        if staging.exists() {
            std::fs::remove_file(&staging)?;
            sync_parent_directory(&staging)?;
        }
        return match result {
            Ok(()) => Ok(true),
            Err(SqliteRegistryFileError::Io(error))
                if error.kind() == std::io::ErrorKind::AlreadyExists =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        };
    }
    Err(SqliteRegistryFileError::InvalidIdentity("staging_path"))
}

fn initialize_and_publish(
    staging: &Path,
    destination: &Path,
    spec: SqliteRegistrySpec,
) -> RegistryFileResult<()> {
    let mut connection = Connection::open_with_flags(
        staging,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_EXRESCODE,
    )?;
    configure_writable(&connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let application_id =
        transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
    let schema_version =
        transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
    let object_count = transaction.query_row(
        "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%';",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if application_id != 0 || schema_version != 0 || object_count != 0 {
        return Err(SqliteRegistryFileError::InvalidIdentity("new_file"));
    }
    transaction.execute_batch(spec.schema_sql)?;
    transaction.commit()?;
    verify(&connection, spec)?;
    connection
        .close()
        .map_err(|(_, error)| SqliteRegistryFileError::Sql(error))?;
    File::open(staging)?.sync_all()?;
    publish_projection_file(staging, destination)?;
    File::open(destination)?.sync_all()?;
    Ok(())
}

fn configure_writable(connection: &Connection) -> RegistryFileResult<()> {
    connection.busy_timeout(BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    #[cfg(target_os = "macos")]
    connection.pragma_update(None, "fullfsync", "ON")?;
    Ok(())
}

fn schema_catalog(
    connection: &Connection,
) -> RegistryFileResult<Vec<(String, String, String, String)>> {
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '')
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name, tbl_name;",
    )?;
    let catalog = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(catalog)
}

fn expected_schema_catalog(
    spec: SqliteRegistrySpec,
) -> RegistryFileResult<Vec<(String, String, String, String)>> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(spec.schema_sql)?;
    schema_catalog(&reference)
}

fn validate_absolute_file_path(path: &Path) -> RegistryFileResult<()> {
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(SqliteRegistryFileError::InvalidIdentity("path"));
    }
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> RegistryFileResult<()> {
    let parent = path
        .parent()
        .ok_or(SqliteRegistryFileError::InvalidIdentity("parent_directory"))?;
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> RegistryFileResult<()> {
    Ok(())
}
