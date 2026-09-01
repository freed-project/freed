//! Shared native errors for normalized SQLite authority and migration.

use std::fmt;

#[derive(Debug)]
pub enum LibraryCoreError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    UnsupportedSchemaVersion { expected: i64, actual: i64 },
    DatabaseIdentityMismatch { expected: i64, actual: i64 },
    UnversionedSchemaPresent,
    SchemaContractMismatch,
    InvalidVerifiedInput { field: &'static str },
    ActorEnrollmentConflict { actor_id: String },
    ActorNotFound { actor_id: String },
    AuthorityNotFound { library_id: String },
    AuthorityConflict,
    AuthorityProtocolConflict { library_id: String },
    StaleAuthority { library_id: String },
    StaleActorTip { actor_id: String },
    TransactionReplayConflict { transaction_id: String },
    UnknownCausalTip { operation_id: String },
    OperationVerification { index: usize, field: &'static str },
    EnrollmentVerification { field: &'static str },
}

impl From<rusqlite::Error> for LibraryCoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<std::io::Error> for LibraryCoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for LibraryCoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "filesystem error: {error}"),
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::UnsupportedSchemaVersion { expected, actual } => {
                write!(
                    formatter,
                    "unsupported schema version: expected {expected}, got {actual}"
                )
            }
            Self::DatabaseIdentityMismatch { expected, actual } => {
                write!(
                    formatter,
                    "authoritative database identity mismatch: expected {expected}, got {actual}"
                )
            }
            Self::UnversionedSchemaPresent => {
                formatter.write_str("unversioned authoritative schema is present")
            }
            Self::SchemaContractMismatch => {
                formatter.write_str("authoritative schema does not match its checked-in contract")
            }
            Self::InvalidVerifiedInput { field } => {
                write!(formatter, "invalid verified input field: {field}")
            }
            Self::ActorEnrollmentConflict { actor_id } => {
                write!(formatter, "actor enrollment conflicts for {actor_id}")
            }
            Self::ActorNotFound { actor_id } => write!(formatter, "actor not found: {actor_id}"),
            Self::AuthorityNotFound { library_id } => {
                write!(
                    formatter,
                    "active authority not found for library {library_id}"
                )
            }
            Self::AuthorityConflict => {
                formatter.write_str("more than one local authority is active")
            }
            Self::AuthorityProtocolConflict { library_id } => {
                write!(
                    formatter,
                    "native authority protocol conflicts for library {library_id}"
                )
            }
            Self::StaleAuthority { library_id } => {
                write!(
                    formatter,
                    "active authority is stale for library {library_id}"
                )
            }
            Self::StaleActorTip { actor_id } => {
                write!(formatter, "actor tip is stale: {actor_id}")
            }
            Self::TransactionReplayConflict { transaction_id } => {
                write!(formatter, "transaction replay conflicts: {transaction_id}")
            }
            Self::UnknownCausalTip { operation_id } => {
                write!(
                    formatter,
                    "operation has an unknown causal tip: {operation_id}"
                )
            }
            Self::OperationVerification { index, field } => {
                write!(
                    formatter,
                    "operation envelope {index} failed verification at {field}"
                )
            }
            Self::EnrollmentVerification { field } => {
                write!(
                    formatter,
                    "actor enrollment certificate failed verification at {field}"
                )
            }
        }
    }
}

impl std::error::Error for LibraryCoreError {}

pub type LibraryCoreResult<T> = std::result::Result<T, LibraryCoreError>;
