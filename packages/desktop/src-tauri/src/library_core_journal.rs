//! Dormant authoritative Library Core SQLite journal.
//!
//! The module is deliberately unreachable from production entry points. It
//! defines the crash-safe commit boundary that a later native canonical and
//! signature verifier may call. The verified input types are private to this
//! module so renderer IPC cannot manufacture authority by matching a Rust
//! struct's shape.

use rusqlite::config::DbConfig;
use rusqlite::{
    params, Connection, OptionalExtension, Result as SqlResult, Transaction, TransactionBehavior,
};
use std::fmt;
use std::path::Path;
use std::time::Duration;

#[path = "library_core_journal_authority.rs"]
mod authority;
#[path = "library_core_journal_enrollment_verifier.rs"]
mod enrollment_verifier;
#[path = "library_core_journal_operation_verifier.rs"]
mod operation_verifier;

const AUTHORITATIVE_SCHEMA_VERSION: i64 = 1;
// ASCII "FREE" in SQLite's 32-bit application_id header field.
const AUTHORITATIVE_APPLICATION_ID: i64 = 0x4652_4545;
const AUTHORITATIVE_SCHEMA_V1_SQL: &str =
    include_str!("../../../shared/src/library-core/authoritative-schema-v1.sql");
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const BASE_CACHE_KIB: i64 = -32 * 1024;
const MAX_TRANSACTION_MEMBERS: usize = 1_000;
const MAX_TRANSACTION_ENVELOPE_BYTES: usize = 4_194_304;
const MAX_CAUSAL_TIPS_PER_OPERATION: usize = 4_096;
const MAX_ENTITY_ID_BYTES: usize = 4_096;
const MAX_OPERATION_ID_BYTES: usize = 128;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_OUTBOX_PAGE_ENTRIES: usize = 256;
const MAX_OUTBOX_PAGE_BYTES: usize = 4_194_304;
const MAX_SCHEMA_CATALOG_ENTRIES: usize = 256;
const MAX_SCHEMA_CATALOG_IDENTIFIER_BYTES: i64 = 256;
const MAX_SCHEMA_CATALOG_BYTES: i64 = 1_048_576;
const OPERATION_OUTBOX_PAGE_SQL: &str = "
    SELECT operation.operationId, outbox.ingestSequence,
           outbox.enqueuedAtMs,
           length(CAST(operation.canonicalEnvelopeJson AS BLOB)),
           operation.canonicalEnvelopeJson
    FROM library_core_replication_outbox AS outbox
    JOIN library_core_operations AS operation
      ON operation.operationId = outbox.operationId
     AND operation.ingestSequence = outbox.ingestSequence
    WHERE outbox.acknowledgedAtMs IS NULL
      AND outbox.ingestSequence > ?1
    ORDER BY outbox.ingestSequence
    LIMIT ?2;";
const ENROLLMENT_OUTBOX_PAGE_SQL: &str = "
    SELECT actor.enrollmentOperationId, outbox.enqueuedAtMs,
           length(CAST(actor.canonicalEnrollmentCertificateJson AS BLOB)),
           actor.canonicalEnrollmentCertificateJson
    FROM library_core_actors AS actor
    JOIN library_core_actor_enrollment_outbox AS outbox
      ON outbox.enrollmentOperationId = actor.enrollmentOperationId
     AND outbox.acknowledgedAtMs IS NULL
    WHERE outbox.enqueuedAtMs > ?1
       OR (
         outbox.enqueuedAtMs = ?1
         AND outbox.enrollmentOperationId > ?2 COLLATE BINARY
       )
    ORDER BY outbox.enqueuedAtMs, outbox.enrollmentOperationId COLLATE BINARY
    LIMIT ?3;";

#[derive(Debug)]
enum JournalError {
    Sql(rusqlite::Error),
    UnsupportedSchemaVersion { expected: i64, actual: i64 },
    DatabaseIdentityMismatch { expected: i64, actual: i64 },
    UnversionedSchemaPresent,
    SchemaContractMismatch,
    InvalidVerifiedInput { field: &'static str },
    ActorEnrollmentConflict { actor_id: String },
    ActorNotFound { actor_id: String },
    AuthorityNotFound { library_id: String },
    StaleAuthority { library_id: String },
    StaleActorTip { actor_id: String },
    TransactionReplayConflict { transaction_id: String },
    UnknownCausalTip { operation_id: String },
    OperationVerification { index: usize, field: &'static str },
    EnrollmentVerification { field: &'static str },
}

impl From<rusqlite::Error> for JournalError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
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

impl std::error::Error for JournalError {}

type JournalResult<T> = std::result::Result<T, JournalError>;

#[derive(Debug, Clone, PartialEq)]
struct ActorState {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    enrollment_operation_id: String,
    enrollment_certificate_digest: String,
    canonical_enrollment_certificate_json: String,
    actor_chain_genesis: String,
    next_sequence: i64,
    previous_operation_id: Option<String>,
    previous_chain_digest: String,
}

#[derive(Debug, Clone)]
struct VerifiedActorEnrollment {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    enrollment_operation_id: String,
    enrollment_certificate_digest: String,
    canonical_enrollment_certificate_json: String,
    actor_chain_genesis: String,
    enrolled_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VerifiedCausalTip {
    actor_id: String,
    sequence: i64,
    operation_id: String,
    chain_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AcceptedAuthorityState {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    authority_key_id: String,
    authority_public_key: String,
    observed_frontier: Vec<VerifiedCausalTip>,
}

#[derive(Debug, Clone)]
struct VerifiedAuthorityEpoch {
    authority: AcceptedAuthorityState,
    transition_certificate_digest: String,
    canonical_transition_certificate_json: String,
    accepted_at_ms: i64,
}

#[derive(Debug, Clone)]
struct VerifiedReadAssignment {
    operation_id: String,
    actor_sequence: i64,
    previous_actor_operation_id: Option<String>,
    previous_actor_chain_digest: String,
    actor_chain_digest: String,
    member_digest: String,
    signing_body_digest: String,
    envelope_digest: String,
    entity_id: String,
    read_at_ms: i64,
    canonical_envelope_json: String,
    causal_tips: Vec<VerifiedCausalTip>,
}

#[derive(Debug, Clone)]
struct VerifiedReadTransaction {
    transaction_id: String,
    transaction_digest: String,
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    canonical_envelope_bytes: usize,
    members: Vec<VerifiedReadAssignment>,
}

#[derive(Debug, Clone, PartialEq)]
struct TransactionReceipt {
    transaction_id: String,
    transaction_digest: String,
    actor_id: String,
    member_count: usize,
    first_sequence: i64,
    last_sequence: i64,
    committed_operation_id: String,
    committed_chain_digest: String,
    first_ingest_sequence: i64,
    last_ingest_sequence: i64,
    previous_revision: i64,
    committed_revision: i64,
    committed_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
struct ReadState {
    entity_id: String,
    read_at_ms: i64,
    source_operation_id: String,
    source_actor_id: String,
    source_sequence: i64,
    source_chain_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OperationOutboxEntry {
    operation_id: String,
    ingest_sequence: i64,
    enqueued_at_ms: i64,
    canonical_envelope_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OperationOutboxPage {
    entries: Vec<OperationOutboxEntry>,
    next_after_ingest_sequence: Option<i64>,
    has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EnrollmentOutboxCursor {
    enqueued_at_ms: i64,
    enrollment_operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EnrollmentOutboxEntry {
    enrollment_operation_id: String,
    enqueued_at_ms: i64,
    canonical_enrollment_certificate_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EnrollmentOutboxPage {
    entries: Vec<EnrollmentOutboxEntry>,
    next_cursor: Option<EnrollmentOutboxCursor>,
    has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SchemaCatalogEntry {
    object_type: String,
    name: String,
    table_name: String,
    sql: String,
}

struct LibraryCoreJournal {
    connection: Connection,
}

fn is_lower_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_OPERATION_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn validate_actor_enrollment(enrollment: &VerifiedActorEnrollment) -> JournalResult<()> {
    if !is_lower_hex(&enrollment.library_id, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "library_id",
        });
    }
    if !(1..=MAX_SAFE_INTEGER).contains(&enrollment.epoch) {
        return Err(JournalError::InvalidVerifiedInput { field: "epoch" });
    }
    for (field, value) in [
        ("epoch_id", enrollment.epoch_id.as_str()),
        ("actor_id", enrollment.actor_id.as_str()),
        (
            "enrollment_certificate_digest",
            enrollment.enrollment_certificate_digest.as_str(),
        ),
        (
            "actor_chain_genesis",
            enrollment.actor_chain_genesis.as_str(),
        ),
    ] {
        if !is_lower_hex(value, 32) {
            return Err(JournalError::InvalidVerifiedInput { field });
        }
    }
    if !is_lower_hex(&enrollment.actor_public_key, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "actor_public_key",
        });
    }
    if !is_operation_id(&enrollment.enrollment_operation_id) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "enrollment_operation_id",
        });
    }
    if enrollment.canonical_enrollment_certificate_json.is_empty()
        || enrollment.canonical_enrollment_certificate_json.len() > MAX_TRANSACTION_ENVELOPE_BYTES
    {
        return Err(JournalError::InvalidVerifiedInput {
            field: "canonical_enrollment_certificate_json",
        });
    }
    if !(0..=MAX_SAFE_INTEGER).contains(&enrollment.enrolled_at_ms) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "enrolled_at_ms",
        });
    }
    Ok(())
}

fn validate_transaction(transaction: &VerifiedReadTransaction) -> JournalResult<()> {
    if !is_operation_id(&transaction.transaction_id) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "transaction_id",
        });
    }
    if !is_lower_hex(&transaction.transaction_digest, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "transaction_digest",
        });
    }
    if !is_lower_hex(&transaction.library_id, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "library_id",
        });
    }
    if !(1..=MAX_SAFE_INTEGER).contains(&transaction.epoch) {
        return Err(JournalError::InvalidVerifiedInput { field: "epoch" });
    }
    if !is_lower_hex(&transaction.epoch_id, 32) {
        return Err(JournalError::InvalidVerifiedInput { field: "epoch_id" });
    }
    if !is_lower_hex(&transaction.actor_id, 32) {
        return Err(JournalError::InvalidVerifiedInput { field: "actor_id" });
    }
    if transaction.members.is_empty() || transaction.members.len() > MAX_TRANSACTION_MEMBERS {
        return Err(JournalError::InvalidVerifiedInput { field: "members" });
    }
    if transaction.canonical_envelope_bytes == 0
        || transaction.canonical_envelope_bytes > MAX_TRANSACTION_ENVELOPE_BYTES
    {
        return Err(JournalError::InvalidVerifiedInput {
            field: "canonical_envelope_bytes",
        });
    }

    let mut measured_bytes = 0usize;
    for (index, member) in transaction.members.iter().enumerate() {
        if !is_operation_id(&member.operation_id) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "operation_id",
            });
        }
        let expected_sequence = transaction.members[0]
            .actor_sequence
            .checked_add(index as i64)
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "actor_sequence",
            })?;
        if !(1..MAX_SAFE_INTEGER).contains(&member.actor_sequence)
            || member.actor_sequence != expected_sequence
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "actor_sequence",
            });
        }
        if index > 0
            && member.previous_actor_operation_id.as_deref()
                != Some(transaction.members[index - 1].operation_id.as_str())
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "previous_actor_operation_id",
            });
        }
        for (field, value) in [
            (
                "previous_actor_chain_digest",
                member.previous_actor_chain_digest.as_str(),
            ),
            ("actor_chain_digest", member.actor_chain_digest.as_str()),
            ("member_digest", member.member_digest.as_str()),
            ("signing_body_digest", member.signing_body_digest.as_str()),
            ("envelope_digest", member.envelope_digest.as_str()),
        ] {
            if !is_lower_hex(value, 32) {
                return Err(JournalError::InvalidVerifiedInput { field });
            }
        }
        if index > 0
            && member.previous_actor_chain_digest
                != transaction.members[index - 1].actor_chain_digest
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "previous_actor_chain_digest",
            });
        }
        if member.entity_id.is_empty() || member.entity_id.len() > MAX_ENTITY_ID_BYTES {
            return Err(JournalError::InvalidVerifiedInput { field: "entity_id" });
        }
        if !(0..=MAX_SAFE_INTEGER).contains(&member.read_at_ms) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "read_at_ms",
            });
        }
        if member.canonical_envelope_json.is_empty() {
            return Err(JournalError::InvalidVerifiedInput {
                field: "canonical_envelope_json",
            });
        }
        measured_bytes = measured_bytes
            .checked_add(member.canonical_envelope_json.len())
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "canonical_envelope_bytes",
            })?;
        if member.causal_tips.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
            return Err(JournalError::InvalidVerifiedInput {
                field: "causal_tips",
            });
        }
        for tip in &member.causal_tips {
            if !is_lower_hex(&tip.actor_id, 32)
                || !(1..=MAX_SAFE_INTEGER).contains(&tip.sequence)
                || !is_operation_id(&tip.operation_id)
                || !is_lower_hex(&tip.chain_digest, 32)
            {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "causal_tip",
                });
            }
        }
    }
    if measured_bytes != transaction.canonical_envelope_bytes {
        return Err(JournalError::InvalidVerifiedInput {
            field: "canonical_envelope_bytes",
        });
    }
    Ok(())
}

impl LibraryCoreJournal {
    fn open(path: &Path) -> JournalResult<Self> {
        let connection = Connection::open(path)?;
        let mut journal = Self { connection };
        journal.configure()?;
        journal.migrate()?;
        Ok(journal)
    }

    fn open_in_memory() -> JournalResult<Self> {
        let connection = Connection::open_in_memory()?;
        let mut journal = Self { connection };
        journal.configure()?;
        journal.migrate()?;
        Ok(journal)
    }

    fn configure(&self) -> JournalResult<()> {
        self.connection
            .set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
        self.connection
            .set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
        self.connection.pragma_update(None, "journal_mode", "WAL")?;
        // Unlike the rebuildable shadow projection, this log is authoritative.
        // A successful commit must survive process loss and power loss.
        self.connection.pragma_update(None, "synchronous", "FULL")?;
        self.connection.pragma_update(None, "foreign_keys", "ON")?;
        self.connection.busy_timeout(BUSY_TIMEOUT)?;
        self.connection
            .pragma_update(None, "cache_size", BASE_CACHE_KIB)?;
        self.connection.pragma_update(None, "mmap_size", 0)?;
        self.connection.pragma_update(None, "temp_store", "FILE")?;
        self.connection
            .pragma_update(None, "cell_size_check", "ON")?;
        Ok(())
    }

    fn migrate(&mut self) -> JournalResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior =
            transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        let prior_application_id =
            transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
        if !(0..=AUTHORITATIVE_SCHEMA_VERSION).contains(&prior) {
            return Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual: prior,
            });
        }
        if (prior == 0 && prior_application_id != 0)
            || (prior > 0 && prior_application_id != AUTHORITATIVE_APPLICATION_ID)
        {
            return Err(JournalError::DatabaseIdentityMismatch {
                expected: AUTHORITATIVE_APPLICATION_ID,
                actual: prior_application_id,
            });
        }
        let has_unversioned_tables = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%');",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if prior == 0 && has_unversioned_tables {
            return Err(JournalError::UnversionedSchemaPresent);
        }
        if prior == 0 {
            transaction.execute_batch(AUTHORITATIVE_SCHEMA_V1_SQL)?;
        }
        let actual =
            transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        let actual_application_id =
            transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
        if actual != AUTHORITATIVE_SCHEMA_VERSION {
            return Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual,
            });
        }
        if actual_application_id != AUTHORITATIVE_APPLICATION_ID {
            return Err(JournalError::DatabaseIdentityMismatch {
                expected: AUTHORITATIVE_APPLICATION_ID,
                actual: actual_application_id,
            });
        }
        Self::verify_schema_contract(&transaction)?;
        transaction.commit()?;
        Ok(())
    }

    fn schema_catalog(connection: &Connection) -> JournalResult<Vec<SchemaCatalogEntry>> {
        let mut statement = connection.prepare(
            "SELECT
               length(CAST(type AS BLOB)),
               length(CAST(name AS BLOB)),
               length(CAST(tbl_name AS BLOB)),
               length(CAST(sql AS BLOB)),
               type, name, tbl_name, sql
             FROM sqlite_schema
             WHERE type IN ('table', 'index', 'trigger', 'view')
               AND name NOT LIKE 'sqlite_%'
             ORDER BY type COLLATE BINARY, name COLLATE BINARY,
                      tbl_name COLLATE BINARY
             LIMIT ?1;",
        )?;
        let mut rows = statement.query(params![MAX_SCHEMA_CATALOG_ENTRIES as i64 + 1])?;
        let mut entries = Vec::new();
        let mut retained_bytes = 0i64;
        while let Some(row) = rows.next()? {
            if entries.len() == MAX_SCHEMA_CATALOG_ENTRIES {
                return Err(JournalError::SchemaContractMismatch);
            }
            let type_bytes: Option<i64> = row.get(0)?;
            let name_bytes: Option<i64> = row.get(1)?;
            let table_name_bytes: Option<i64> = row.get(2)?;
            let sql_bytes: Option<i64> = row.get(3)?;
            let (type_bytes, name_bytes, table_name_bytes, sql_bytes) =
                match (type_bytes, name_bytes, table_name_bytes, sql_bytes) {
                    (
                        Some(type_bytes),
                        Some(name_bytes),
                        Some(table_name_bytes),
                        Some(sql_bytes),
                    ) if (1..=16).contains(&type_bytes)
                        && (1..=MAX_SCHEMA_CATALOG_IDENTIFIER_BYTES).contains(&name_bytes)
                        && (1..=MAX_SCHEMA_CATALOG_IDENTIFIER_BYTES)
                            .contains(&table_name_bytes)
                        && (1..=MAX_SCHEMA_CATALOG_BYTES).contains(&sql_bytes) =>
                    {
                        (type_bytes, name_bytes, table_name_bytes, sql_bytes)
                    }
                    _ => return Err(JournalError::SchemaContractMismatch),
                };
            retained_bytes = retained_bytes
                .checked_add(type_bytes)
                .and_then(|bytes| bytes.checked_add(name_bytes))
                .and_then(|bytes| bytes.checked_add(table_name_bytes))
                .and_then(|bytes| bytes.checked_add(sql_bytes))
                .filter(|bytes| *bytes <= MAX_SCHEMA_CATALOG_BYTES)
                .ok_or(JournalError::SchemaContractMismatch)?;
            entries.push(SchemaCatalogEntry {
                object_type: row.get(4)?,
                name: row.get(5)?,
                table_name: row.get(6)?,
                sql: row.get(7)?,
            });
        }
        Ok(entries)
    }

    fn verify_schema_contract(connection: &Connection) -> JournalResult<()> {
        let reference = Connection::open_in_memory()?;
        reference.execute_batch(AUTHORITATIVE_SCHEMA_V1_SQL)?;
        let expected = Self::schema_catalog(&reference)?;
        let actual = Self::schema_catalog(connection)?;
        if actual != expected {
            return Err(JournalError::SchemaContractMismatch);
        }
        Ok(())
    }

    fn actor_state_in(
        transaction: &Transaction<'_>,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> SqlResult<Option<ActorState>> {
        transaction
            .query_row(
                "SELECT libraryId, epoch, epochId, actorId, actorPublicKey, \
                 enrollmentOperationId, enrollmentCertificateDigest,
                 canonicalEnrollmentCertificateJson, actorChainGenesis,
                 nextSequence, previousOperationId, previousChainDigest
                 FROM library_core_actors \
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![library_id, epoch_id, actor_id],
                |row| {
                    Ok(ActorState {
                        library_id: row.get(0)?,
                        epoch: row.get(1)?,
                        epoch_id: row.get(2)?,
                        actor_id: row.get(3)?,
                        actor_public_key: row.get(4)?,
                        enrollment_operation_id: row.get(5)?,
                        enrollment_certificate_digest: row.get(6)?,
                        canonical_enrollment_certificate_json: row.get(7)?,
                        actor_chain_genesis: row.get(8)?,
                        next_sequence: row.get(9)?,
                        previous_operation_id: row.get(10)?,
                        previous_chain_digest: row.get(11)?,
                    })
                },
            )
            .optional()
    }

    fn actor_state(
        &self,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<ActorState>> {
        Ok(self
            .connection
            .query_row(
                "SELECT libraryId, epoch, epochId, actorId, actorPublicKey, \
                 enrollmentOperationId, enrollmentCertificateDigest,
                 canonicalEnrollmentCertificateJson, actorChainGenesis,
                 nextSequence, previousOperationId, previousChainDigest
                 FROM library_core_actors
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![library_id, epoch_id, actor_id],
                |row| {
                    Ok(ActorState {
                        library_id: row.get(0)?,
                        epoch: row.get(1)?,
                        epoch_id: row.get(2)?,
                        actor_id: row.get(3)?,
                        actor_public_key: row.get(4)?,
                        enrollment_operation_id: row.get(5)?,
                        enrollment_certificate_digest: row.get(6)?,
                        canonical_enrollment_certificate_json: row.get(7)?,
                        actor_chain_genesis: row.get(8)?,
                        next_sequence: row.get(9)?,
                        previous_operation_id: row.get(10)?,
                        previous_chain_digest: row.get(11)?,
                    })
                },
            )
            .optional()?)
    }

    fn verify_read_transaction(
        &self,
        canonical_envelopes: &[Vec<u8>],
    ) -> JournalResult<VerifiedReadTransaction> {
        operation_verifier::verify_read_transaction(canonical_envelopes, |identity| {
            self.actor_state(&identity.library_id, &identity.epoch_id, &identity.actor_id)?
                .ok_or_else(|| JournalError::ActorNotFound {
                    actor_id: identity.actor_id.clone(),
                })
        })
    }

    fn verify_and_commit_read_transaction(
        &mut self,
        canonical_envelopes: &[Vec<u8>],
        committed_at_ms: i64,
    ) -> JournalResult<TransactionReceipt> {
        let verified = self.verify_read_transaction(canonical_envelopes)?;
        self.commit_read_transaction(&verified, committed_at_ms)
    }

    fn enroll_actor_in(
        transaction: &Transaction<'_>,
        enrollment: &VerifiedActorEnrollment,
    ) -> JournalResult<ActorState> {
        if let Some(existing) = Self::actor_state_in(
            transaction,
            &enrollment.library_id,
            &enrollment.epoch_id,
            &enrollment.actor_id,
        )? {
            if Self::actor_matches_enrollment(&existing, enrollment) {
                return Ok(existing);
            }
            return Err(JournalError::ActorEnrollmentConflict {
                actor_id: enrollment.actor_id.clone(),
            });
        }
        transaction.execute(
            "INSERT INTO library_core_actors (
               libraryId, epoch, epochId, actorId, actorPublicKey,
               enrollmentOperationId, enrollmentCertificateDigest,
               canonicalEnrollmentCertificateJson, actorChainGenesis,
               nextSequence, previousOperationId, previousChainDigest,
               enrolledAtMs
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, NULL, ?9, ?10
             );",
            params![
                enrollment.library_id,
                enrollment.epoch,
                enrollment.epoch_id,
                enrollment.actor_id,
                enrollment.actor_public_key,
                enrollment.enrollment_operation_id,
                enrollment.enrollment_certificate_digest,
                enrollment.canonical_enrollment_certificate_json,
                enrollment.actor_chain_genesis,
                enrollment.enrolled_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO library_core_actor_enrollment_outbox (
               enrollmentOperationId, enqueuedAtMs, acknowledgedAtMs
             ) VALUES (?1, ?2, NULL);",
            params![
                enrollment.enrollment_operation_id,
                enrollment.enrolled_at_ms,
            ],
        )?;
        let state = Self::actor_state_in(
            transaction,
            &enrollment.library_id,
            &enrollment.epoch_id,
            &enrollment.actor_id,
        )?
        .ok_or_else(|| JournalError::ActorNotFound {
            actor_id: enrollment.actor_id.clone(),
        })?;
        Ok(state)
    }

    fn actor_matches_enrollment(
        existing: &ActorState,
        enrollment: &VerifiedActorEnrollment,
    ) -> bool {
        existing.epoch == enrollment.epoch
            && existing.actor_public_key == enrollment.actor_public_key
            && existing.enrollment_operation_id == enrollment.enrollment_operation_id
            && existing.enrollment_certificate_digest == enrollment.enrollment_certificate_digest
            && existing.canonical_enrollment_certificate_json
                == enrollment.canonical_enrollment_certificate_json
            && existing.actor_chain_genesis == enrollment.actor_chain_genesis
    }

    fn enroll_actor_under_authority(
        &mut self,
        enrollment: &VerifiedActorEnrollment,
        expected_authority: &AcceptedAuthorityState,
    ) -> JournalResult<ActorState> {
        validate_actor_enrollment(enrollment)?;
        if enrollment.library_id != expected_authority.library_id
            || enrollment.epoch != expected_authority.epoch
            || enrollment.epoch_id != expected_authority.epoch_id
        {
            return Err(JournalError::StaleAuthority {
                library_id: enrollment.library_id.clone(),
            });
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = Self::actor_state_in(
            &transaction,
            &enrollment.library_id,
            &enrollment.epoch_id,
            &enrollment.actor_id,
        )? {
            if Self::actor_matches_enrollment(&existing, enrollment) {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(JournalError::ActorEnrollmentConflict {
                actor_id: enrollment.actor_id.clone(),
            });
        }
        authority::require_active_authority(&transaction, expected_authority)?;
        let state = Self::enroll_actor_in(&transaction, enrollment)?;
        transaction.commit()?;
        Ok(state)
    }

    #[cfg(test)]
    fn enroll_actor(&mut self, enrollment: &VerifiedActorEnrollment) -> JournalResult<ActorState> {
        let authority = authority::active_authority(&self.connection, &enrollment.library_id)?
            .ok_or_else(|| JournalError::AuthorityNotFound {
                library_id: enrollment.library_id.clone(),
            })?;
        self.enroll_actor_under_authority(enrollment, &authority)
    }

    fn verify_actor_enrollment(
        &self,
        canonical_certificate: &[u8],
        authority: &AcceptedAuthorityState,
    ) -> JournalResult<VerifiedActorEnrollment> {
        enrollment_verifier::verify_actor_enrollment(canonical_certificate, authority)
    }

    fn verify_and_enroll_actor(
        &mut self,
        canonical_certificate: &[u8],
        library_id: &str,
    ) -> JournalResult<ActorState> {
        let authority =
            authority::active_authority(&self.connection, library_id)?.ok_or_else(|| {
                JournalError::AuthorityNotFound {
                    library_id: library_id.to_owned(),
                }
            })?;
        let enrollment = self.verify_actor_enrollment(canonical_certificate, &authority)?;
        self.enroll_actor_under_authority(&enrollment, &authority)
    }

    #[cfg(test)]
    fn install_fixture_authority(
        &mut self,
        library_id: &str,
        epoch: i64,
        epoch_id: &str,
    ) -> JournalResult<AcceptedAuthorityState> {
        self.install_authority_epoch(&VerifiedAuthorityEpoch {
            authority: AcceptedAuthorityState {
                library_id: library_id.to_owned(),
                epoch,
                epoch_id: epoch_id.to_owned(),
                authority_key_id: "a".repeat(64),
                authority_public_key: "b".repeat(64),
                observed_frontier: Vec::new(),
            },
            transition_certificate_digest: format!("{epoch:064x}"),
            canonical_transition_certificate_json: format!(
                "{{\"transition\":\"fixture-{epoch}\"}}"
            ),
            accepted_at_ms: 900,
        })
    }

    fn transaction_receipt_in(
        transaction: &Transaction<'_>,
        transaction_id: &str,
    ) -> SqlResult<Option<TransactionReceipt>> {
        transaction
            .query_row(
                "SELECT transactionId, transactionDigest, actorId, memberCount,
                 firstSequence, lastSequence, committedOperationId,
                 committedChainDigest, firstIngestSequence,
                 lastIngestSequence, previousRevision, committedRevision,
                 committedAtMs
                 FROM library_core_transactions WHERE transactionId = ?1;",
                params![transaction_id],
                |row| {
                    Ok(TransactionReceipt {
                        transaction_id: row.get(0)?,
                        transaction_digest: row.get(1)?,
                        actor_id: row.get(2)?,
                        member_count: row.get::<_, i64>(3)? as usize,
                        first_sequence: row.get(4)?,
                        last_sequence: row.get(5)?,
                        committed_operation_id: row.get(6)?,
                        committed_chain_digest: row.get(7)?,
                        first_ingest_sequence: row.get(8)?,
                        last_ingest_sequence: row.get(9)?,
                        previous_revision: row.get(10)?,
                        committed_revision: row.get(11)?,
                        committed_at_ms: row.get(12)?,
                    })
                },
            )
            .optional()
    }

    fn causal_tip_exists(
        transaction: &Transaction<'_>,
        tip: &VerifiedCausalTip,
    ) -> SqlResult<bool> {
        transaction.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM library_core_operations
               WHERE actorId = ?1 AND actorSequence = ?2
                 AND operationId = ?3 AND actorChainDigest = ?4
             );",
            params![
                tip.actor_id,
                tip.sequence,
                tip.operation_id,
                tip.chain_digest
            ],
            |row| row.get(0),
        )
    }

    fn projection_revision_in(transaction: &Transaction<'_>) -> SqlResult<i64> {
        transaction.query_row(
            "SELECT integerValue FROM library_core_meta
             WHERE key = 'projectionRevision';",
            [],
            |row| row.get(0),
        )
    }

    fn meta_integer_in(transaction: &Transaction<'_>, key: &str) -> SqlResult<i64> {
        transaction.query_row(
            "SELECT integerValue FROM library_core_meta WHERE key = ?1;",
            params![key],
            |row| row.get(0),
        )
    }

    fn commit_read_transaction(
        &mut self,
        verified: &VerifiedReadTransaction,
        committed_at_ms: i64,
    ) -> JournalResult<TransactionReceipt> {
        validate_transaction(verified)?;
        if !(0..=MAX_SAFE_INTEGER).contains(&committed_at_ms) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "committed_at_ms",
            });
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(receipt) = Self::transaction_receipt_in(&transaction, &verified.transaction_id)?
        {
            if receipt.transaction_digest == verified.transaction_digest
                && receipt.actor_id == verified.actor_id
                && receipt.member_count == verified.members.len()
            {
                transaction.commit()?;
                return Ok(receipt);
            }
            return Err(JournalError::TransactionReplayConflict {
                transaction_id: verified.transaction_id.clone(),
            });
        }
        authority::require_active_epoch(
            &transaction,
            &verified.library_id,
            verified.epoch,
            &verified.epoch_id,
        )?;
        let actor = Self::actor_state_in(
            &transaction,
            &verified.library_id,
            &verified.epoch_id,
            &verified.actor_id,
        )?
        .ok_or_else(|| JournalError::ActorNotFound {
            actor_id: verified.actor_id.clone(),
        })?;
        let first = &verified.members[0];
        if actor.epoch != verified.epoch
            || actor.next_sequence != first.actor_sequence
            || actor.previous_operation_id != first.previous_actor_operation_id
            || actor.previous_chain_digest != first.previous_actor_chain_digest
        {
            return Err(JournalError::StaleActorTip {
                actor_id: verified.actor_id.clone(),
            });
        }
        for member in &verified.members {
            for tip in &member.causal_tips {
                if !Self::causal_tip_exists(&transaction, tip)? {
                    return Err(JournalError::UnknownCausalTip {
                        operation_id: member.operation_id.clone(),
                    });
                }
            }
        }
        let previous_revision = Self::projection_revision_in(&transaction)?;
        let committed_revision =
            previous_revision
                .checked_add(1)
                .ok_or(JournalError::InvalidVerifiedInput {
                    field: "projection_revision",
                })?;
        if committed_revision > MAX_SAFE_INTEGER {
            return Err(JournalError::InvalidVerifiedInput {
                field: "projection_revision",
            });
        }
        let last = verified
            .members
            .last()
            .ok_or(JournalError::InvalidVerifiedInput { field: "members" })?;
        let first_ingest_sequence = Self::meta_integer_in(&transaction, "nextIngestSequence")?;
        if !(1..=MAX_SAFE_INTEGER).contains(&first_ingest_sequence) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "next_ingest_sequence",
            });
        }
        let last_ingest_sequence = first_ingest_sequence
            .checked_add(verified.members.len() as i64 - 1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "ingest_sequence",
            })?;
        let prior_materializer_sequence =
            Self::meta_integer_in(&transaction, "materializerIngestSequence")?;
        if prior_materializer_sequence != first_ingest_sequence - 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "materializer_ingest_sequence",
            });
        }
        transaction.execute(
            "INSERT INTO library_core_transactions (
               transactionId, transactionDigest, libraryId, epoch, epochId,
               actorId, memberCount, firstSequence, lastSequence,
               previousOperationId, previousChainDigest, committedOperationId,
               committedChainDigest, canonicalEnvelopeBytes,
               firstIngestSequence, lastIngestSequence, previousRevision,
               committedRevision, committedAtMs
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
               ?14, ?15, ?16, ?17, ?18, ?19
             );",
            params![
                verified.transaction_id,
                verified.transaction_digest,
                verified.library_id,
                verified.epoch,
                verified.epoch_id,
                verified.actor_id,
                verified.members.len() as i64,
                first.actor_sequence,
                last.actor_sequence,
                first.previous_actor_operation_id,
                first.previous_actor_chain_digest,
                last.operation_id,
                last.actor_chain_digest,
                verified.canonical_envelope_bytes as i64,
                first_ingest_sequence,
                last_ingest_sequence,
                previous_revision,
                committed_revision,
                committed_at_ms,
            ],
        )?;

        for (index, member) in verified.members.iter().enumerate() {
            transaction.execute(
                "INSERT INTO library_core_operations (
                   operationId, transactionId, transactionMemberIndex,
                   transactionMemberCount, libraryId, epoch, epochId, actorId,
                   actorSequence, ingestSequence, previousActorOperationId,
                   previousActorChainDigest, actorChainDigest,
                   transactionDigest, memberDigest, signingBodyDigest,
                   envelopeDigest, operationType, entityType, entityId,
                   canonicalEnvelopeJson, committedAtMs
                 ) VALUES (
                   ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                   ?13, ?14, ?15, ?16, ?17, 'feed_item_read_assignment',
                   'FeedItem', ?18, ?19, ?20
                 );",
                params![
                    member.operation_id,
                    verified.transaction_id,
                    index as i64,
                    verified.members.len() as i64,
                    verified.library_id,
                    verified.epoch,
                    verified.epoch_id,
                    verified.actor_id,
                    member.actor_sequence,
                    first_ingest_sequence + index as i64,
                    member.previous_actor_operation_id,
                    member.previous_actor_chain_digest,
                    member.actor_chain_digest,
                    verified.transaction_digest,
                    member.member_digest,
                    member.signing_body_digest,
                    member.envelope_digest,
                    member.entity_id,
                    member.canonical_envelope_json,
                    committed_at_ms,
                ],
            )?;
            for (tip_index, tip) in member.causal_tips.iter().enumerate() {
                transaction.execute(
                    "INSERT INTO library_core_operation_causal_tips (
                       operationId, tipIndex, actorId, sequence,
                       tipOperationId, chainDigest
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
                    params![
                        member.operation_id,
                        tip_index as i64,
                        tip.actor_id,
                        tip.sequence,
                        tip.operation_id,
                        tip.chain_digest,
                    ],
                )?;
            }
            transaction.execute(
                "INSERT INTO library_core_feed_item_read_state (
                   entityId, readAtMs, sourceOperationId, sourceActorId,
                   sourceSequence, sourceChainDigest
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(entityId) DO UPDATE SET
                   readAtMs = excluded.readAtMs,
                   sourceOperationId = excluded.sourceOperationId,
                   sourceActorId = excluded.sourceActorId,
                   sourceSequence = excluded.sourceSequence,
                   sourceChainDigest = excluded.sourceChainDigest
                 WHERE excluded.readAtMs < library_core_feed_item_read_state.readAtMs
                    OR (
                      excluded.readAtMs = library_core_feed_item_read_state.readAtMs
                      AND excluded.sourceOperationId
                        < library_core_feed_item_read_state.sourceOperationId
                    );",
                params![
                    member.entity_id,
                    member.read_at_ms,
                    member.operation_id,
                    verified.actor_id,
                    member.actor_sequence,
                    member.actor_chain_digest,
                ],
            )?;
            transaction.execute(
                "INSERT INTO library_core_replication_outbox (
                   operationId, ingestSequence, enqueuedAtMs, acknowledgedAtMs
                 ) VALUES (?1, ?2, ?3, NULL);",
                params![
                    member.operation_id,
                    first_ingest_sequence + index as i64,
                    committed_at_ms
                ],
            )?;
        }
        let updated = transaction.execute(
            "UPDATE library_core_actors
             SET nextSequence = ?1, previousOperationId = ?2,
                 previousChainDigest = ?3
             WHERE libraryId = ?4 AND epochId = ?5 AND actorId = ?6
               AND nextSequence = ?7
               AND previousOperationId IS ?8
               AND previousChainDigest = ?9;",
            params![
                last.actor_sequence + 1,
                last.operation_id,
                last.actor_chain_digest,
                verified.library_id,
                verified.epoch_id,
                verified.actor_id,
                actor.next_sequence,
                actor.previous_operation_id,
                actor.previous_chain_digest,
            ],
        )?;
        if updated != 1 {
            return Err(JournalError::StaleActorTip {
                actor_id: verified.actor_id.clone(),
            });
        }
        let next_ingest_sequence = last_ingest_sequence
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "next_ingest_sequence",
            })?;
        let ingest_updated = transaction.execute(
            "UPDATE library_core_meta SET integerValue = ?1
             WHERE key = 'nextIngestSequence' AND integerValue = ?2;",
            params![next_ingest_sequence, first_ingest_sequence],
        )?;
        if ingest_updated != 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "next_ingest_sequence",
            });
        }
        let materializer_updated = transaction.execute(
            "UPDATE library_core_meta SET integerValue = ?1
             WHERE key = 'materializerIngestSequence' AND integerValue = ?2;",
            params![last_ingest_sequence, prior_materializer_sequence],
        )?;
        if materializer_updated != 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "materializer_ingest_sequence",
            });
        }
        let revision_updated = transaction.execute(
            "UPDATE library_core_meta SET integerValue = ?1
             WHERE key = 'projectionRevision' AND integerValue = ?2;",
            params![committed_revision, previous_revision],
        )?;
        if revision_updated != 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "projection_revision",
            });
        }
        let receipt = TransactionReceipt {
            transaction_id: verified.transaction_id.clone(),
            transaction_digest: verified.transaction_digest.clone(),
            actor_id: verified.actor_id.clone(),
            member_count: verified.members.len(),
            first_sequence: first.actor_sequence,
            last_sequence: last.actor_sequence,
            committed_operation_id: last.operation_id.clone(),
            committed_chain_digest: last.actor_chain_digest.clone(),
            first_ingest_sequence,
            last_ingest_sequence,
            previous_revision,
            committed_revision,
            committed_at_ms,
        };
        transaction.commit()?;
        Ok(receipt)
    }

    fn read_state(&self, entity_id: &str) -> JournalResult<Option<ReadState>> {
        Ok(self
            .connection
            .query_row(
                "SELECT entityId, readAtMs, sourceOperationId, sourceActorId,
                 sourceSequence, sourceChainDigest
                 FROM library_core_feed_item_read_state WHERE entityId = ?1;",
                params![entity_id],
                |row| {
                    Ok(ReadState {
                        entity_id: row.get(0)?,
                        read_at_ms: row.get(1)?,
                        source_operation_id: row.get(2)?,
                        source_actor_id: row.get(3)?,
                        source_sequence: row.get(4)?,
                        source_chain_digest: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    fn operation_outbox_page(
        &self,
        after_ingest_sequence: i64,
        maximum_entries: usize,
    ) -> JournalResult<OperationOutboxPage> {
        self.operation_outbox_page_with_budget(
            after_ingest_sequence,
            maximum_entries,
            MAX_OUTBOX_PAGE_BYTES,
        )
    }

    fn operation_outbox_page_with_budget(
        &self,
        after_ingest_sequence: i64,
        maximum_entries: usize,
        maximum_bytes: usize,
    ) -> JournalResult<OperationOutboxPage> {
        if !(0..=MAX_SAFE_INTEGER).contains(&after_ingest_sequence) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_after_ingest_sequence",
            });
        }
        if maximum_entries == 0 || maximum_entries > MAX_OUTBOX_PAGE_ENTRIES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_entries",
            });
        }
        if maximum_bytes == 0 || maximum_bytes > MAX_OUTBOX_PAGE_BYTES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_bytes",
            });
        }

        let row_limit =
            maximum_entries
                .checked_add(1)
                .ok_or(JournalError::InvalidVerifiedInput {
                    field: "outbox_maximum_entries",
                })?;
        let mut statement = self.connection.prepare(OPERATION_OUTBOX_PAGE_SQL)?;
        let mut rows = statement.query(params![after_ingest_sequence, row_limit as i64])?;
        let mut entries = Vec::with_capacity(maximum_entries);
        let mut retained_bytes = 0usize;
        let mut has_more = false;

        while let Some(row) = rows.next()? {
            if entries.len() == maximum_entries {
                has_more = true;
                break;
            }
            let entry_bytes: i64 = row.get(3)?;
            if !(1..=MAX_OUTBOX_PAGE_BYTES as i64).contains(&entry_bytes) {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            let entry_bytes = entry_bytes as usize;
            if entries.is_empty() && entry_bytes > maximum_bytes {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            if retained_bytes
                .checked_add(entry_bytes)
                .is_none_or(|next| next > maximum_bytes)
            {
                has_more = true;
                break;
            }
            let canonical_envelope_json: String = row.get(4)?;
            if canonical_envelope_json.len() != entry_bytes {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            retained_bytes += entry_bytes;
            entries.push(OperationOutboxEntry {
                operation_id: row.get(0)?,
                ingest_sequence: row.get(1)?,
                enqueued_at_ms: row.get(2)?,
                canonical_envelope_json,
            });
        }

        let next_after_ingest_sequence = entries.last().map(|entry| entry.ingest_sequence);
        Ok(OperationOutboxPage {
            entries,
            next_after_ingest_sequence,
            has_more,
        })
    }

    fn enrollment_outbox_page(
        &self,
        after: Option<&EnrollmentOutboxCursor>,
        maximum_entries: usize,
    ) -> JournalResult<EnrollmentOutboxPage> {
        self.enrollment_outbox_page_with_budget(after, maximum_entries, MAX_OUTBOX_PAGE_BYTES)
    }

    fn enrollment_outbox_page_with_budget(
        &self,
        after: Option<&EnrollmentOutboxCursor>,
        maximum_entries: usize,
        maximum_bytes: usize,
    ) -> JournalResult<EnrollmentOutboxPage> {
        if maximum_entries == 0 || maximum_entries > MAX_OUTBOX_PAGE_ENTRIES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_entries",
            });
        }
        if maximum_bytes == 0 || maximum_bytes > MAX_OUTBOX_PAGE_BYTES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_bytes",
            });
        }
        let (after_ms, after_id) = match after {
            Some(cursor)
                if (0..=MAX_SAFE_INTEGER).contains(&cursor.enqueued_at_ms)
                    && is_operation_id(&cursor.enrollment_operation_id) =>
            {
                (
                    cursor.enqueued_at_ms,
                    cursor.enrollment_operation_id.as_str(),
                )
            }
            Some(_) => {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "enrollment_outbox_cursor",
                });
            }
            None => (-1, ""),
        };
        let row_limit =
            maximum_entries
                .checked_add(1)
                .ok_or(JournalError::InvalidVerifiedInput {
                    field: "outbox_maximum_entries",
                })?;
        let mut statement = self.connection.prepare(ENROLLMENT_OUTBOX_PAGE_SQL)?;
        let mut rows = statement.query(params![after_ms, after_id, row_limit as i64])?;
        let mut entries = Vec::with_capacity(maximum_entries);
        let mut retained_bytes = 0usize;
        let mut has_more = false;

        while let Some(row) = rows.next()? {
            if entries.len() == maximum_entries {
                has_more = true;
                break;
            }
            let entry_bytes: i64 = row.get(2)?;
            if !(1..=MAX_OUTBOX_PAGE_BYTES as i64).contains(&entry_bytes) {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            let entry_bytes = entry_bytes as usize;
            if entries.is_empty() && entry_bytes > maximum_bytes {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            if retained_bytes
                .checked_add(entry_bytes)
                .is_none_or(|next| next > maximum_bytes)
            {
                has_more = true;
                break;
            }
            let canonical_enrollment_certificate_json: String = row.get(3)?;
            if canonical_enrollment_certificate_json.len() != entry_bytes {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            entries.push(EnrollmentOutboxEntry {
                enrollment_operation_id: row.get(0)?,
                enqueued_at_ms: row.get(1)?,
                canonical_enrollment_certificate_json,
            });
            retained_bytes += entry_bytes;
        }

        let next_cursor = entries.last().map(|entry| EnrollmentOutboxCursor {
            enqueued_at_ms: entry.enqueued_at_ms,
            enrollment_operation_id: entry.enrollment_operation_id.clone(),
        });
        Ok(EnrollmentOutboxPage {
            entries,
            next_cursor,
            has_more,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(byte: &str) -> String {
        byte.repeat(64)
    }

    fn actor() -> VerifiedActorEnrollment {
        VerifiedActorEnrollment {
            library_id: digest("1"),
            epoch: 1,
            epoch_id: digest("2"),
            actor_id: digest("3"),
            actor_public_key: digest("4"),
            enrollment_operation_id: "op:actor:enroll:fixture".to_string(),
            enrollment_certificate_digest: digest("5"),
            canonical_enrollment_certificate_json: "{\"certificate\":\"fixture\"}".to_string(),
            actor_chain_genesis: digest("6"),
            enrolled_at_ms: 1_000,
        }
    }

    fn actor_variant(hex_digit: &str, operation_suffix: &str) -> VerifiedActorEnrollment {
        VerifiedActorEnrollment {
            actor_id: digest(hex_digit),
            actor_public_key: digest(if hex_digit == "f" { "e" } else { "f" }),
            enrollment_operation_id: format!("op:actor:enroll:{operation_suffix}"),
            enrollment_certificate_digest: digest(hex_digit),
            canonical_enrollment_certificate_json: format!(
                "{{\"certificate\":\"{operation_suffix}\"}}"
            ),
            actor_chain_genesis: digest(if hex_digit == "b" { "a" } else { "b" }),
            ..actor()
        }
    }

    fn install_actor_authority(journal: &mut LibraryCoreJournal) {
        let enrollment = actor();
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
    }

    fn transaction(
        transaction_id: &str,
        first_sequence: i64,
        previous_operation_id: Option<&str>,
        previous_chain_digest: &str,
        reads: &[(&str, i64)],
    ) -> VerifiedReadTransaction {
        let enrollment = actor();
        let transaction_digest = digest("7");
        let mut previous_operation = previous_operation_id.map(str::to_string);
        let mut previous_chain = previous_chain_digest.to_string();
        let mut members = Vec::new();
        for (index, (entity_id, read_at_ms)) in reads.iter().enumerate() {
            let operation_id = format!("{transaction_id}:member:{index}");
            let actor_chain_digest = format!("{:064x}", first_sequence + index as i64 + 100);
            let canonical_envelope_json = format!("{{\"operation_id\":\"{operation_id}\"}}");
            members.push(VerifiedReadAssignment {
                operation_id: operation_id.clone(),
                actor_sequence: first_sequence + index as i64,
                previous_actor_operation_id: previous_operation.clone(),
                previous_actor_chain_digest: previous_chain,
                actor_chain_digest: actor_chain_digest.clone(),
                member_digest: format!("{:064x}", first_sequence + index as i64 + 150),
                signing_body_digest: format!("{:064x}", first_sequence + index as i64 + 175),
                envelope_digest: format!("{:064x}", first_sequence + index as i64 + 200),
                entity_id: (*entity_id).to_string(),
                read_at_ms: *read_at_ms,
                canonical_envelope_json,
                causal_tips: Vec::new(),
            });
            previous_operation = Some(operation_id);
            previous_chain = actor_chain_digest;
        }
        let canonical_envelope_bytes = members
            .iter()
            .map(|member| member.canonical_envelope_json.len())
            .sum();
        VerifiedReadTransaction {
            transaction_id: transaction_id.to_string(),
            transaction_digest,
            library_id: enrollment.library_id,
            epoch: enrollment.epoch,
            epoch_id: enrollment.epoch_id,
            actor_id: enrollment.actor_id,
            canonical_envelope_bytes,
            members,
        }
    }

    #[test]
    fn configures_full_durability_and_exact_schema() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let journal = LibraryCoreJournal::open(&directory.path().join("library-core.sqlite"))
            .expect("open journal");
        let journal_mode: String = journal
            .connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal mode");
        let synchronous: i64 = journal
            .connection
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .expect("synchronous");
        let foreign_keys: i64 = journal
            .connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("foreign keys");
        let version: i64 = journal
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user version");
        let application_id: i64 = journal
            .connection
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .expect("application ID");
        let cell_size_check: i64 = journal
            .connection
            .pragma_query_value(None, "cell_size_check", |row| row.get(0))
            .expect("cell-size check");
        let defensive = journal
            .connection
            .db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
            .expect("defensive mode");
        let trusted_schema = journal
            .connection
            .db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA)
            .expect("trusted schema");
        assert_eq!(journal_mode, "wal");
        assert_eq!(synchronous, 2);
        assert_eq!(foreign_keys, 1);
        assert_eq!(version, AUTHORITATIVE_SCHEMA_VERSION);
        assert_eq!(application_id, AUTHORITATIVE_APPLICATION_ID);
        assert_eq!(cell_size_check, 1);
        assert!(defensive);
        assert!(!trusted_schema);
    }

    #[test]
    fn opening_rejects_a_mismatched_database_identity() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let journal = LibraryCoreJournal::open(&path).expect("create journal");
        drop(journal);
        let connection = Connection::open(&path).expect("open raw database");
        connection
            .pragma_update(None, "application_id", 0)
            .expect("remove authoritative database identity");
        drop(connection);

        match LibraryCoreJournal::open(&path) {
            Err(JournalError::DatabaseIdentityMismatch { expected, actual }) => {
                assert_eq!(expected, AUTHORITATIVE_APPLICATION_ID);
                assert_eq!(actual, 0);
            }
            Err(error) => panic!("unexpected database identity error: {error}"),
            Ok(_) => panic!("mismatched database identity must fail closed"),
        }
    }

    #[test]
    fn opening_rejects_a_foreign_blank_database_before_schema_creation() {
        const FOREIGN_APPLICATION_ID: i64 = 0x1234_5678;

        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let connection = Connection::open(&path).expect("create raw database");
        connection
            .pragma_update(None, "application_id", FOREIGN_APPLICATION_ID)
            .expect("set foreign database identity");
        drop(connection);

        match LibraryCoreJournal::open(&path) {
            Err(JournalError::DatabaseIdentityMismatch { expected, actual }) => {
                assert_eq!(expected, AUTHORITATIVE_APPLICATION_ID);
                assert_eq!(actual, FOREIGN_APPLICATION_ID);
            }
            Err(error) => panic!("unexpected database identity error: {error}"),
            Ok(_) => panic!("foreign blank database must fail closed"),
        }

        let connection = Connection::open(&path).expect("reopen raw database");
        let schema_object_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%';",
                [],
                |row| row.get(0),
            )
            .expect("count schema objects");
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user version");
        assert_eq!(schema_object_count, 0);
        assert_eq!(version, 0);
    }

    #[test]
    fn opening_rejects_missing_or_unregistered_schema_objects() {
        for mutation in [
            "DROP INDEX library_core_replication_outbox_order;",
            "CREATE TABLE unregistered_authority_state (id TEXT PRIMARY KEY) STRICT;",
        ] {
            let directory = tempfile::tempdir().expect("temporary directory");
            let path = directory.path().join("library-core.sqlite");
            let journal = LibraryCoreJournal::open(&path).expect("create journal");
            drop(journal);
            let connection = Connection::open(&path).expect("open raw database");
            connection
                .execute_batch(mutation)
                .expect("mutate schema without changing user version");
            drop(connection);

            match LibraryCoreJournal::open(&path) {
                Err(JournalError::SchemaContractMismatch) => {}
                Err(error) => panic!("unexpected schema error: {error}"),
                Ok(_) => panic!("schema mutation must fail closed: {mutation}"),
            }
        }
    }

    #[test]
    fn enrollment_and_response_loss_retry_are_idempotent() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        let first = journal.enroll_actor(&enrollment).expect("enroll actor");
        let retry = journal.enroll_actor(&enrollment).expect("retry enrollment");
        assert_eq!(first, retry);

        let verified = transaction(
            "tx:read:one",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900), ("rss:item:2", 901)],
        );
        let receipt = journal
            .commit_read_transaction(&verified, 1_100)
            .expect("commit transaction");
        let replay = journal
            .commit_read_transaction(&verified, 9_999)
            .expect("response-loss retry");
        assert_eq!(receipt, replay);
        assert_eq!(receipt.first_ingest_sequence, 1);
        assert_eq!(receipt.last_ingest_sequence, 2);
        assert_eq!(receipt.previous_revision, 0);
        assert_eq!(receipt.committed_revision, 1);
        let late_enrollment_retry = journal
            .enroll_actor(&enrollment)
            .expect("enrollment retry after actor progress");
        assert_eq!(late_enrollment_retry.next_sequence, 3);
        assert_eq!(
            late_enrollment_retry.previous_operation_id.as_deref(),
            Some("tx:read:one:member:1")
        );

        let counts: (i64, i64, i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'projectionRevision'),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'nextIngestSequence'),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'materializerIngestSequence');",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("counts");
        assert_eq!(counts, (1, 2, 2, 1, 1, 3, 2));
        let ingest_sequences: Vec<i64> = {
            let mut statement = journal
                .connection
                .prepare(
                    "SELECT ingestSequence FROM library_core_operations
                     ORDER BY ingestSequence;",
                )
                .expect("prepare ingest query");
            statement
                .query_map([], |row| row.get(0))
                .expect("query ingest sequences")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect ingest sequences")
        };
        assert_eq!(ingest_sequences, vec![1, 2]);
        let queued_envelopes: Vec<String> = {
            let mut statement = journal
                .connection
                .prepare(
                    "SELECT operation.canonicalEnvelopeJson
                     FROM library_core_replication_outbox AS outbox
                     JOIN library_core_operations AS operation
                       ON operation.operationId = outbox.operationId
                     ORDER BY operation.ingestSequence;",
                )
                .expect("prepare outbox join");
            statement
                .query_map([], |row| row.get(0))
                .expect("query queued envelopes")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect queued envelopes")
        };
        assert_eq!(
            queued_envelopes,
            verified
                .members
                .iter()
                .map(|member| member.canonical_envelope_json.clone())
                .collect::<Vec<_>>()
        );
        let queued_enrollment: String = journal
            .connection
            .query_row(
                "SELECT actor.canonicalEnrollmentCertificateJson
                 FROM library_core_actor_enrollment_outbox AS outbox
                 JOIN library_core_actors AS actor
                   ON actor.enrollmentOperationId = outbox.enrollmentOperationId;",
                [],
                |row| row.get(0),
            )
            .expect("queued enrollment certificate");
        assert_eq!(
            queued_enrollment,
            enrollment.canonical_enrollment_certificate_json
        );
    }

    #[test]
    fn operation_outbox_pages_by_ingest_sequence_and_byte_budget() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let verified = transaction(
            "tx:read:outbox-page",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[
                ("rss:item:outbox-1", 901),
                ("rss:item:outbox-2", 902),
                ("rss:item:outbox-3", 903),
            ],
        );
        journal
            .commit_read_transaction(&verified, 1_100)
            .expect("commit transaction");

        let first = journal
            .operation_outbox_page(0, 2)
            .expect("first operation page");
        assert_eq!(first.entries.len(), 2);
        assert_eq!(
            first
                .entries
                .iter()
                .map(|entry| entry.ingest_sequence)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(
            first
                .entries
                .iter()
                .map(|entry| entry.canonical_envelope_json.as_str())
                .collect::<Vec<_>>(),
            verified.members[..2]
                .iter()
                .map(|member| member.canonical_envelope_json.as_str())
                .collect::<Vec<_>>()
        );
        assert_eq!(first.next_after_ingest_sequence, Some(2));
        assert!(first.has_more);

        let second = journal
            .operation_outbox_page(
                first.next_after_ingest_sequence.expect("first page cursor"),
                2,
            )
            .expect("second operation page");
        assert_eq!(second.entries.len(), 1);
        assert_eq!(second.entries[0].ingest_sequence, 3);
        assert_eq!(second.next_after_ingest_sequence, Some(3));
        assert!(!second.has_more);

        let first_entry_bytes = verified.members[0].canonical_envelope_json.len();
        let byte_bounded = journal
            .operation_outbox_page_with_budget(0, 3, first_entry_bytes)
            .expect("byte-bounded operation page");
        assert_eq!(byte_bounded.entries.len(), 1);
        assert_eq!(byte_bounded.next_after_ingest_sequence, Some(1));
        assert!(byte_bounded.has_more);
    }

    #[test]
    fn enrollment_outbox_keyset_preserves_equal_timestamps() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let first_actor = actor_variant("8", "page-a");
        let second_actor = actor_variant("9", "page-b");
        journal
            .enroll_actor(&first_actor)
            .expect("enroll first actor");
        journal
            .enroll_actor(&second_actor)
            .expect("enroll second actor");

        let first = journal
            .enrollment_outbox_page(None, 1)
            .expect("first enrollment page");
        assert_eq!(first.entries.len(), 1);
        assert_eq!(
            first.entries[0].canonical_enrollment_certificate_json,
            first_actor.canonical_enrollment_certificate_json
        );
        assert!(first.has_more);

        let second = journal
            .enrollment_outbox_page(first.next_cursor.as_ref(), 1)
            .expect("second enrollment page");
        assert_eq!(second.entries.len(), 1);
        assert_eq!(
            second.entries[0].canonical_enrollment_certificate_json,
            second_actor.canonical_enrollment_certificate_json
        );
        assert!(!second.has_more);

        let byte_bounded = journal
            .enrollment_outbox_page_with_budget(
                None,
                2,
                first_actor.canonical_enrollment_certificate_json.len(),
            )
            .expect("byte-bounded enrollment page");
        assert_eq!(byte_bounded.entries.len(), 1);
        assert!(byte_bounded.has_more);
    }

    #[test]
    fn outbox_queries_use_index_order_without_temporary_sorts() {
        let journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        for (sql, params, expected_index) in [
            (
                OPERATION_OUTBOX_PAGE_SQL,
                vec![rusqlite::types::Value::Integer(0), 2.into()],
                "library_core_replication_outbox_order",
            ),
            (
                ENROLLMENT_OUTBOX_PAGE_SQL,
                vec![
                    rusqlite::types::Value::Integer(-1),
                    rusqlite::types::Value::Text(String::new()),
                    2.into(),
                ],
                "library_core_actor_enrollment_outbox_order",
            ),
        ] {
            let mut statement = journal
                .connection
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare query plan");
            let details = statement
                .query_map(rusqlite::params_from_iter(params), |row| {
                    row.get::<_, String>(3)
                })
                .expect("query plan")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect query plan");
            assert!(
                details
                    .iter()
                    .all(|detail| !detail.contains("USE TEMP B-TREE")),
                "outbox keyset query must not sort an unbounded table: {details:?}"
            );
            assert!(
                details.iter().any(|detail| detail.contains(expected_index)),
                "outbox keyset query must use {expected_index}: {details:?}"
            );
        }
    }

    #[test]
    fn response_loss_retry_returns_the_exact_receipt_after_reopen() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let enrollment = actor();
        let verified = transaction(
            "tx:read:reopen-retry",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:reopen", 900)],
        );
        let receipt = {
            let mut journal = LibraryCoreJournal::open(&path).expect("open journal");
            install_actor_authority(&mut journal);
            journal.enroll_actor(&enrollment).expect("enroll actor");
            journal
                .commit_read_transaction(&verified, 1_100)
                .expect("commit transaction")
        };

        let mut reopened = LibraryCoreJournal::open(&path).expect("reopen journal");
        let retry = reopened
            .commit_read_transaction(&verified, 9_999)
            .expect("response-loss retry after reopen");
        assert_eq!(retry, receipt);
        assert_eq!(retry.first_ingest_sequence, 1);
        assert_eq!(retry.last_ingest_sequence, 1);
        let counts: (i64, i64, i64) = reopened
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("row counts");
        assert_eq!(counts, (1, 1, 1));
    }

    #[test]
    fn authority_epoch_change_fences_uncommitted_old_epoch_operations() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let verified = transaction(
            "tx:read:stale-epoch",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:stale", 900)],
        );

        journal
            .install_fixture_authority(&enrollment.library_id, 2, &digest("9"))
            .expect("advance authority epoch");
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::StaleAuthority { .. })
        ));
        let counts: (i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'projectionRevision');",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("old epoch counts");
        assert_eq!(counts, (0, 0, 0));
    }

    #[test]
    fn commit_is_atomic_across_journal_projection_outbox_tip_and_receipt() {
        let mut enrollment_journal =
            LibraryCoreJournal::open_in_memory().expect("open enrollment journal");
        install_actor_authority(&mut enrollment_journal);
        enrollment_journal
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_enrollment_outbox
                 BEFORE INSERT ON library_core_actor_enrollment_outbox
                 BEGIN
                   SELECT RAISE(ABORT, 'injected enrollment outbox failure');
                 END;",
            )
            .expect("install enrollment failpoint");
        assert!(matches!(
            enrollment_journal.enroll_actor(&actor()),
            Err(JournalError::Sql(_))
        ));
        let enrollment_rows: i64 = enrollment_journal
            .connection
            .query_row("SELECT COUNT(*) FROM library_core_actors;", [], |row| {
                row.get(0)
            })
            .expect("enrollment row count");
        assert_eq!(enrollment_rows, 0);

        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_second_outbox
                 BEFORE INSERT ON library_core_replication_outbox
                 WHEN (SELECT COUNT(*) FROM library_core_replication_outbox) = 1
                 BEGIN
                   SELECT RAISE(ABORT, 'injected outbox failure');
                 END;",
            )
            .expect("install failpoint");
        let verified = transaction(
            "tx:read:rollback",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900), ("rss:item:2", 901)],
        );
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::Sql(_))
        ));

        for table in [
            "library_core_transactions",
            "library_core_operations",
            "library_core_feed_item_read_state",
            "library_core_replication_outbox",
        ] {
            let count: i64 = journal
                .connection
                .query_row(&format!("SELECT COUNT(*) FROM {table};"), [], |row| {
                    row.get(0)
                })
                .expect("table count");
            assert_eq!(count, 0, "{table} must roll back");
        }
        let state = journal
            .connection
            .query_row(
                "SELECT nextSequence, previousOperationId, previousChainDigest
                 FROM library_core_actors WHERE actorId = ?1;",
                params![enrollment.actor_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("actor state");
        assert_eq!(state, (1, None, enrollment.actor_chain_genesis));
    }

    #[test]
    fn failure_after_actor_tip_update_rolls_back_every_authoritative_write() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_projection_revision
                 BEFORE UPDATE ON library_core_meta
                 WHEN OLD.key = 'projectionRevision'
                 BEGIN
                   SELECT RAISE(ABORT, 'injected projection revision failure');
                 END;",
            )
            .expect("install late failpoint");
        let verified = transaction(
            "tx:read:late-rollback",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:late-rollback", 900)],
        );
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::Sql(_))
        ));

        let counts: (i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_feed_item_read_state),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'projectionRevision');",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("post-rollback counts");
        assert_eq!(counts, (0, 0, 0, 0, 0));
        let state = journal
            .connection
            .query_row(
                "SELECT nextSequence, previousOperationId, previousChainDigest
                 FROM library_core_actors WHERE actorId = ?1;",
                params![enrollment.actor_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("actor state");
        assert_eq!(state, (1, None, enrollment.actor_chain_genesis));
    }

    #[test]
    fn monotone_read_projection_survives_later_and_equal_assignments() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let first = transaction(
            "tx:read:first",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900)],
        );
        journal
            .commit_read_transaction(&first, 1_100)
            .expect("first read");
        let first_member = &first.members[0];

        let later = transaction(
            "tx:read:later",
            2,
            Some(&first_member.operation_id),
            &first_member.actor_chain_digest,
            &[("rss:item:1", 950)],
        );
        journal
            .commit_read_transaction(&later, 1_200)
            .expect("later read");
        let state = journal
            .read_state("rss:item:1")
            .expect("read state")
            .expect("materialized row");
        assert_eq!(state.read_at_ms, 900);
        assert_eq!(state.source_operation_id, first_member.operation_id);

        let earlier = transaction(
            "tx:read:earlier",
            3,
            Some(&later.members[0].operation_id),
            &later.members[0].actor_chain_digest,
            &[("rss:item:1", 800)],
        );
        journal
            .commit_read_transaction(&earlier, 1_300)
            .expect("earlier read");
        assert_eq!(
            journal
                .read_state("rss:item:1")
                .expect("read state")
                .expect("materialized row")
                .read_at_ms,
            800
        );
    }

    #[test]
    fn stale_tips_replays_and_unknown_causal_tips_fail_closed() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let first = transaction(
            "tx:read:first",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900)],
        );
        journal
            .commit_read_transaction(&first, 1_100)
            .expect("first transaction");

        let conflicting_replay = VerifiedReadTransaction {
            transaction_digest: digest("8"),
            ..first.clone()
        };
        assert!(matches!(
            journal.commit_read_transaction(&conflicting_replay, 1_200),
            Err(JournalError::TransactionReplayConflict { .. })
        ));
        assert!(matches!(
            journal.commit_read_transaction(
                &transaction(
                    "tx:read:stale",
                    1,
                    None,
                    &enrollment.actor_chain_genesis,
                    &[("rss:item:2", 901)],
                ),
                1_200,
            ),
            Err(JournalError::StaleActorTip { .. })
        ));

        let first_member = &first.members[0];
        let mut unknown = transaction(
            "tx:read:unknown-causal",
            2,
            Some(&first_member.operation_id),
            &first_member.actor_chain_digest,
            &[("rss:item:2", 901)],
        );
        unknown.members[0].causal_tips.push(VerifiedCausalTip {
            actor_id: digest("9"),
            sequence: 1,
            operation_id: "op:missing".to_string(),
            chain_digest: digest("a"),
        });
        assert!(matches!(
            journal.commit_read_transaction(&unknown, 1_200),
            Err(JournalError::UnknownCausalTip { .. })
        ));
        unknown.members[0].causal_tips[0] = VerifiedCausalTip {
            actor_id: enrollment.actor_id,
            sequence: 1,
            operation_id: first_member.operation_id.clone(),
            chain_digest: first_member.actor_chain_digest.clone(),
        };
        journal
            .commit_read_transaction(&unknown, 1_200)
            .expect("known exact causal tip");
    }

    #[test]
    fn actor_sequence_restarts_are_scoped_to_the_authority_epoch() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let first_enrollment = actor();
        journal
            .enroll_actor(&first_enrollment)
            .expect("enroll first epoch actor");
        journal
            .commit_read_transaction(
                &transaction(
                    "tx:read:epoch-one",
                    1,
                    None,
                    &first_enrollment.actor_chain_genesis,
                    &[("rss:item:epoch-one", 900)],
                ),
                1_100,
            )
            .expect("commit first epoch operation");

        let second_enrollment = VerifiedActorEnrollment {
            epoch: 2,
            epoch_id: digest("8"),
            enrollment_operation_id: "op:actor:enroll:epoch-two".to_string(),
            enrollment_certificate_digest: digest("9"),
            actor_chain_genesis: digest("a"),
            enrolled_at_ms: 1_200,
            ..first_enrollment
        };
        journal
            .install_fixture_authority(
                &second_enrollment.library_id,
                second_enrollment.epoch,
                &second_enrollment.epoch_id,
            )
            .expect("install second authority epoch");
        journal
            .enroll_actor(&second_enrollment)
            .expect("enroll same actor in second epoch");
        let second_transaction = VerifiedReadTransaction {
            epoch: second_enrollment.epoch,
            epoch_id: second_enrollment.epoch_id.clone(),
            ..transaction(
                "tx:read:epoch-two",
                1,
                None,
                &second_enrollment.actor_chain_genesis,
                &[("rss:item:epoch-two", 901)],
            )
        };
        journal
            .commit_read_transaction(&second_transaction, 1_300)
            .expect("commit second epoch sequence one");

        let sequences: Vec<(i64, String, i64)> = {
            let mut statement = journal
                .connection
                .prepare(
                    "SELECT epoch, epochId, actorSequence
                     FROM library_core_operations
                     WHERE actorId = ?1
                     ORDER BY epoch;",
                )
                .expect("prepare actor sequence query");
            statement
                .query_map(params![second_enrollment.actor_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .expect("query actor sequences")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect actor sequences")
        };
        assert_eq!(
            sequences,
            vec![(1, digest("2"), 1), (2, second_enrollment.epoch_id, 1)]
        );
    }

    #[test]
    fn rejects_cross_runtime_unsafe_integers_before_sqlite() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let mut enrollment = actor();
        enrollment.enrolled_at_ms = MAX_SAFE_INTEGER + 1;
        assert!(matches!(
            journal.enroll_actor(&enrollment),
            Err(JournalError::InvalidVerifiedInput {
                field: "enrolled_at_ms"
            })
        ));

        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let mut verified = transaction(
            "tx:read:unsafe",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900)],
        );
        verified.members[0].read_at_ms = MAX_SAFE_INTEGER + 1;
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::InvalidVerifiedInput {
                field: "read_at_ms"
            })
        ));
    }

    #[test]
    fn opening_rejects_unversioned_or_future_schema() {
        let mut unversioned = LibraryCoreJournal {
            connection: Connection::open_in_memory().expect("connection"),
        };
        unversioned
            .configure()
            .expect("configure unversioned connection");
        unversioned
            .connection
            .execute_batch("CREATE TABLE unexpected (id INTEGER) STRICT;")
            .expect("unversioned table");
        assert!(matches!(
            unversioned.migrate(),
            Err(JournalError::UnversionedSchemaPresent)
        ));

        let mut future = LibraryCoreJournal {
            connection: Connection::open_in_memory().expect("connection"),
        };
        future.configure().expect("configure future connection");
        future
            .connection
            .pragma_update(None, "user_version", 99)
            .expect("future version");
        assert!(matches!(
            future.migrate(),
            Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual: 99
            })
        ));
    }
}
