//! Atomic SQLite staging for receipt-bound Automerge rows.
//!
//! This dormant layer copies verified rows and their exact payload bytes into a
//! scratch SQLite database without allocating a source-sized value buffer. The
//! complete row and companion-spool receipts are rechecked before the staging
//! transaction commits. No command or production caller opens this store.

use crate::automerge_external_change_rows::{ExternalChangeRowLimits, ExternalChangeRowSummary};
use crate::automerge_external_document_run::ExternalVerifiedDocumentLayout;
use crate::automerge_external_operation_rows::{
    ExternalOperationRowLimits, ExternalOperationRowSummary, ObjectReference, OperationKey,
    OperationScalar,
};
use crate::automerge_external_row_run::{
    with_verified_change_rows_and_payload, with_verified_operation_rows_and_payload,
    ExternalRowRunConsumeError, ExternalRowRunError, ExternalRowRunLimits,
    ExternalVerifiedChangeRow, ExternalVerifiedOperationRow, ExternalVerifiedPayloadReader,
};
use rusqlite::blob::ZeroBlob;
use rusqlite::{
    params, Connection, DatabaseName, OptionalExtension, Transaction, TransactionBehavior,
};
use std::fmt;
use std::fs::File;

const STAGE_APPLICATION_ID: i64 = 0x4652_4f53;
const STAGE_SCHEMA_VERSION: i64 = 4;

const STAGE_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS external_layout_stage_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sourceByteLength INTEGER NOT NULL CHECK (sourceByteLength >= 0),
  sourceSha256 TEXT NOT NULL CHECK (
    length(sourceSha256) = 64 AND sourceSha256 = lower(sourceSha256)
  ),
  actorCount INTEGER NOT NULL CHECK (actorCount >= 0),
  headCount INTEGER NOT NULL CHECK (headCount >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS external_actors (
  actorIndex INTEGER PRIMARY KEY CHECK (actorIndex >= 0),
  actorId TEXT NOT NULL UNIQUE CHECK (length(actorId) > 0 AND actorId = lower(actorId))
) STRICT;

CREATE TABLE IF NOT EXISTS external_heads (
  headIndex INTEGER PRIMARY KEY CHECK (headIndex >= 0),
  changeIndex INTEGER NOT NULL UNIQUE CHECK (changeIndex >= 0),
  hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64 AND hash = lower(hash))
) STRICT;

CREATE TABLE IF NOT EXISTS external_change_stage_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sourceByteLength INTEGER NOT NULL CHECK (sourceByteLength >= 0),
  sourceSha256 TEXT NOT NULL CHECK (
    length(sourceSha256) = 64 AND sourceSha256 = lower(sourceSha256)
  ),
  changeCount INTEGER NOT NULL CHECK (changeCount >= 0),
  dependencyCount INTEGER NOT NULL CHECK (dependencyCount >= 0),
  dependencySpoolByteLength INTEGER NOT NULL CHECK (dependencySpoolByteLength >= 0),
  dependencySpoolSha256 TEXT NOT NULL CHECK (
    length(dependencySpoolSha256) = 64 AND dependencySpoolSha256 = lower(dependencySpoolSha256)
  ),
  extraPayloadSpoolByteLength INTEGER NOT NULL CHECK (extraPayloadSpoolByteLength >= 0),
  extraPayloadSpoolSha256 TEXT NOT NULL CHECK (
    length(extraPayloadSpoolSha256) = 64 AND extraPayloadSpoolSha256 = lower(extraPayloadSpoolSha256)
  ),
  rowRunPrefixByteLength INTEGER NOT NULL CHECK (rowRunPrefixByteLength >= 0),
  rowRunPrefixSha256 TEXT NOT NULL CHECK (
    length(rowRunPrefixSha256) = 64 AND rowRunPrefixSha256 = lower(rowRunPrefixSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_changes (
  changeIndex INTEGER PRIMARY KEY CHECK (changeIndex >= 0),
  actorIndex INTEGER NOT NULL REFERENCES external_actors(actorIndex) CHECK (actorIndex >= 0),
  sequence BLOB NOT NULL CHECK (length(sequence) = 8),
  maxOperation BLOB NOT NULL CHECK (length(maxOperation) = 8),
  timestamp INTEGER NOT NULL,
  message TEXT,
  extraPayload BLOB NOT NULL,
  UNIQUE (actorIndex, sequence)
) STRICT;

CREATE TABLE IF NOT EXISTS external_change_dependencies (
  changeIndex INTEGER NOT NULL REFERENCES external_changes(changeIndex) ON DELETE CASCADE,
  dependencyOrdinal INTEGER NOT NULL CHECK (dependencyOrdinal >= 0),
  dependencyIndex INTEGER NOT NULL REFERENCES external_changes(changeIndex)
    CHECK (dependencyIndex >= 0),
  PRIMARY KEY (changeIndex, dependencyOrdinal),
  UNIQUE (changeIndex, dependencyIndex)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS external_changes_actor_max_operation
  ON external_changes(actorIndex, maxOperation);

CREATE TABLE IF NOT EXISTS external_operation_stage_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sourceByteLength INTEGER NOT NULL CHECK (sourceByteLength >= 0),
  sourceSha256 TEXT NOT NULL CHECK (
    length(sourceSha256) = 64 AND sourceSha256 = lower(sourceSha256)
  ),
  operationCount INTEGER NOT NULL CHECK (operationCount >= 0),
  successorCount INTEGER NOT NULL CHECK (successorCount >= 0),
  successorSpoolByteLength INTEGER NOT NULL CHECK (successorSpoolByteLength >= 0),
  successorSpoolSha256 TEXT NOT NULL CHECK (
    length(successorSpoolSha256) = 64 AND successorSpoolSha256 = lower(successorSpoolSha256)
  ),
  valuePayloadSpoolByteLength INTEGER NOT NULL CHECK (valuePayloadSpoolByteLength >= 0),
  valuePayloadSpoolSha256 TEXT NOT NULL CHECK (
    length(valuePayloadSpoolSha256) = 64 AND valuePayloadSpoolSha256 = lower(valuePayloadSpoolSha256)
  ),
  rowRunPrefixByteLength INTEGER NOT NULL CHECK (rowRunPrefixByteLength >= 0),
  rowRunPrefixSha256 TEXT NOT NULL CHECK (
    length(rowRunPrefixSha256) = 64 AND rowRunPrefixSha256 = lower(rowRunPrefixSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_operations (
  operationIndex INTEGER PRIMARY KEY CHECK (operationIndex >= 0),
  idActorIndex INTEGER NOT NULL REFERENCES external_actors(actorIndex) CHECK (idActorIndex >= 0),
  idCounter BLOB NOT NULL CHECK (length(idCounter) = 8),
  objectKind TEXT NOT NULL CHECK (objectKind IN ('root', 'operation')),
  objectActorIndex INTEGER CHECK (objectActorIndex IS NULL OR objectActorIndex >= 0),
  objectCounter BLOB CHECK (objectCounter IS NULL OR length(objectCounter) = 8),
  keyKind TEXT NOT NULL CHECK (keyKind IN ('property', 'head', 'element')),
  keyName TEXT,
  keyActorIndex INTEGER CHECK (keyActorIndex IS NULL OR keyActorIndex >= 0),
  keyCounter BLOB CHECK (keyCounter IS NULL OR length(keyCounter) = 8),
  insertFlag INTEGER NOT NULL CHECK (insertFlag IN (0, 1)),
  action INTEGER NOT NULL CHECK (action BETWEEN 0 AND 7),
  valueKind TEXT NOT NULL CHECK (
    valueKind IN ('null', 'boolean', 'unsigned', 'signed', 'counter',
                  'timestamp', 'float', 'string', 'bytes', 'unknown')
  ),
  valueText TEXT,
  valueTypeCode INTEGER CHECK (valueTypeCode IS NULL OR valueTypeCode BETWEEN 0 AND 255),
  valuePayload BLOB NOT NULL,
  expandFlag INTEGER NOT NULL CHECK (expandFlag IN (0, 1)),
  markName TEXT,
  UNIQUE (idActorIndex, idCounter),
  FOREIGN KEY (objectActorIndex, objectCounter)
    REFERENCES external_operations(idActorIndex, idCounter)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (keyActorIndex, keyCounter)
    REFERENCES external_operations(idActorIndex, idCounter)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (objectKind = 'root' AND objectActorIndex IS NULL AND objectCounter IS NULL) OR
    (objectKind = 'operation' AND objectActorIndex IS NOT NULL AND objectCounter IS NOT NULL)
  ),
  CHECK (
    (keyKind = 'property' AND keyName IS NOT NULL AND keyActorIndex IS NULL AND keyCounter IS NULL) OR
    (keyKind = 'head' AND keyName IS NULL AND keyActorIndex IS NULL AND keyCounter IS NULL) OR
    (keyKind = 'element' AND keyName IS NULL AND keyActorIndex IS NOT NULL AND keyCounter IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_operation_successors (
  operationIndex INTEGER NOT NULL REFERENCES external_operations(operationIndex) ON DELETE CASCADE,
  successorOrdinal INTEGER NOT NULL CHECK (successorOrdinal >= 0),
  actorIndex INTEGER NOT NULL CHECK (actorIndex >= 0),
  counter BLOB NOT NULL CHECK (length(counter) = 8),
  PRIMARY KEY (operationIndex, successorOrdinal),
  UNIQUE (operationIndex, actorIndex, counter),
  FOREIGN KEY (actorIndex, counter)
    REFERENCES external_operations(idActorIndex, idCounter)
    DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS external_operations_object
  ON external_operations(objectKind, objectActorIndex, objectCounter, keyKind, keyName);
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalChangeStageReceipt {
    pub source_byte_length: u64,
    pub source_sha256: String,
    pub summary: ExternalChangeRowSummary,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ExternalLayoutStageReceipt {
    source_byte_length: u64,
    source_sha256: String,
    actor_count: u64,
    head_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalOperationStageReceipt {
    pub source_byte_length: u64,
    pub source_sha256: String,
    pub summary: ExternalOperationRowSummary,
}

#[derive(Debug)]
pub(super) enum ExternalSqliteStageError {
    Sql(rusqlite::Error),
    RowRun(ExternalRowRunError),
    InvalidDatabaseIdentity,
    SchemaContractMismatch,
    IncompleteStage,
    ReceiptConflict,
    RangeOverflow,
    PayloadTooLarge,
}

impl From<rusqlite::Error> for ExternalSqliteStageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<ExternalRowRunError> for ExternalSqliteStageError {
    fn from(error: ExternalRowRunError) -> Self {
        Self::RowRun(error)
    }
}

impl fmt::Display for ExternalSqliteStageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(formatter, "Automerge SQLite stage SQL failed: {error}"),
            Self::RowRun(error) => error.fmt(formatter),
            Self::InvalidDatabaseIdentity => {
                formatter.write_str("Automerge SQLite stage database identity is invalid")
            }
            Self::SchemaContractMismatch => {
                formatter.write_str("Automerge SQLite stage schema contract is invalid")
            }
            Self::IncompleteStage => formatter.write_str("Automerge SQLite stage is incomplete"),
            Self::ReceiptConflict => {
                formatter.write_str("Automerge SQLite stage receipt conflicts with this source")
            }
            Self::RangeOverflow => formatter.write_str("Automerge SQLite stage range overflows"),
            Self::PayloadTooLarge => {
                formatter.write_str("Automerge payload exceeds SQLite blob limits")
            }
        }
    }
}

impl std::error::Error for ExternalSqliteStageError {}

type StageResult<T> = Result<T, ExternalSqliteStageError>;

#[allow(clippy::too_many_arguments)]
pub(super) fn stage_verified_change_rows(
    connection: &mut Connection,
    row_run: &mut File,
    dependency_spool: &mut File,
    extra_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalChangeRowSummary,
    row_limits: ExternalChangeRowLimits,
    run_limits: ExternalRowRunLimits,
) -> StageResult<ExternalChangeStageReceipt> {
    stage_verified_change_rows_with_after_stage(
        connection,
        row_run,
        dependency_spool,
        extra_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |_row| Ok(()),
    )
}

#[allow(clippy::too_many_arguments)]
fn stage_verified_change_rows_with_after_stage(
    connection: &mut Connection,
    row_run: &mut File,
    dependency_spool: &mut File,
    extra_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalChangeRowSummary,
    row_limits: ExternalChangeRowLimits,
    run_limits: ExternalRowRunLimits,
    mut after_stage: impl FnMut(&ExternalVerifiedChangeRow) -> StageResult<()>,
) -> StageResult<ExternalChangeStageReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    stage_or_validate_layout(&transaction, source_byte_length, source_sha256, layout)?;

    if let Some(operation_receipt) = read_operation_receipt(&transaction)? {
        require_stage_source_identity(
            operation_receipt.source_byte_length,
            &operation_receipt.source_sha256,
            source_byte_length,
            source_sha256,
        )?;
    }
    if let Some(receipt) = read_change_receipt(&transaction)? {
        require_matching_change_receipt(
            &receipt,
            source_byte_length,
            source_sha256,
            expected_summary,
        )?;
        require_complete_change_stage(&transaction, &receipt.summary)?;
        transaction.commit()?;
        return Ok(receipt);
    }
    let change_count =
        transaction.query_row("SELECT COUNT(*) FROM external_changes;", [], |row| {
            row.get::<_, i64>(0)
        })?;
    let dependency_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_change_dependencies;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if change_count != 0 || dependency_count != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let read_summary = with_verified_change_rows_and_payload(
        row_run,
        dependency_spool,
        extra_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |row, payload| {
            stage_change(&transaction, row, payload)?;
            after_stage(row)
        },
    )
    .map_err(|error| match error {
        ExternalRowRunConsumeError::Run(error) => ExternalSqliteStageError::RowRun(error),
        ExternalRowRunConsumeError::Consumer(error) => error,
    })?;
    if read_summary != *expected_summary {
        return Err(ExternalSqliteStageError::ReceiptConflict);
    }
    require_complete_change_stage(&transaction, &read_summary)?;
    insert_change_receipt(
        &transaction,
        source_byte_length,
        source_sha256,
        &read_summary,
    )?;
    transaction.commit()?;
    Ok(ExternalChangeStageReceipt {
        source_byte_length,
        source_sha256: source_sha256.to_string(),
        summary: read_summary,
    })
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn stage_verified_change_rows_with_test_fault(
    connection: &mut Connection,
    row_run: &mut File,
    dependency_spool: &mut File,
    extra_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalChangeRowSummary,
    row_limits: ExternalChangeRowLimits,
    run_limits: ExternalRowRunLimits,
    fail_after_change_index: u64,
) -> StageResult<ExternalChangeStageReceipt> {
    stage_verified_change_rows_with_after_stage(
        connection,
        row_run,
        dependency_spool,
        extra_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |row| {
            if row.index == fail_after_change_index {
                return Err(ExternalSqliteStageError::ReceiptConflict);
            }
            Ok(())
        },
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn stage_verified_operation_rows(
    connection: &mut Connection,
    row_run: &mut File,
    successor_spool: &mut File,
    value_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalOperationRowSummary,
    row_limits: ExternalOperationRowLimits,
    run_limits: ExternalRowRunLimits,
) -> StageResult<ExternalOperationStageReceipt> {
    stage_verified_operation_rows_with_after_stage(
        connection,
        row_run,
        successor_spool,
        value_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |_row| Ok(()),
    )
}

#[allow(clippy::too_many_arguments)]
fn stage_verified_operation_rows_with_after_stage(
    connection: &mut Connection,
    row_run: &mut File,
    successor_spool: &mut File,
    value_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalOperationRowSummary,
    row_limits: ExternalOperationRowLimits,
    run_limits: ExternalRowRunLimits,
    mut after_stage: impl FnMut(&ExternalVerifiedOperationRow) -> StageResult<()>,
) -> StageResult<ExternalOperationStageReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    stage_or_validate_layout(&transaction, source_byte_length, source_sha256, layout)?;

    if let Some(change_receipt) = read_change_receipt(&transaction)? {
        require_stage_source_identity(
            change_receipt.source_byte_length,
            &change_receipt.source_sha256,
            source_byte_length,
            source_sha256,
        )?;
    }
    if let Some(receipt) = read_operation_receipt(&transaction)? {
        require_matching_operation_receipt(
            &receipt,
            source_byte_length,
            source_sha256,
            expected_summary,
        )?;
        require_complete_operation_stage(&transaction, &receipt.summary)?;
        transaction.commit()?;
        return Ok(receipt);
    }
    let operation_count =
        transaction.query_row("SELECT COUNT(*) FROM external_operations;", [], |row| {
            row.get::<_, i64>(0)
        })?;
    let successor_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_operation_successors;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if operation_count != 0 || successor_count != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let read_summary = with_verified_operation_rows_and_payload(
        row_run,
        successor_spool,
        value_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |row, payload| {
            stage_operation(&transaction, row, payload)?;
            after_stage(row)
        },
    )
    .map_err(|error| match error {
        ExternalRowRunConsumeError::Run(error) => ExternalSqliteStageError::RowRun(error),
        ExternalRowRunConsumeError::Consumer(error) => error,
    })?;
    if read_summary != *expected_summary {
        return Err(ExternalSqliteStageError::ReceiptConflict);
    }
    require_complete_operation_stage(&transaction, &read_summary)?;
    insert_operation_receipt(
        &transaction,
        source_byte_length,
        source_sha256,
        &read_summary,
    )?;
    transaction.commit()?;
    Ok(ExternalOperationStageReceipt {
        source_byte_length,
        source_sha256: source_sha256.to_string(),
        summary: read_summary,
    })
}

fn configure_connection(connection: &Connection) -> StageResult<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.busy_timeout(std::time::Duration::from_millis(2_000))?;
    Ok(())
}

fn stage_or_validate_layout(
    transaction: &Transaction<'_>,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
) -> StageResult<()> {
    if !layout.matches_source(source_byte_length, source_sha256) {
        return Err(ExternalSqliteStageError::ReceiptConflict);
    }
    if let Some(receipt) = read_layout_receipt(transaction)? {
        require_stage_source_identity(
            receipt.source_byte_length,
            &receipt.source_sha256,
            source_byte_length,
            source_sha256,
        )?;
        if receipt.actor_count != layout.actor_count() || receipt.head_count != layout.head_count()
        {
            return Err(ExternalSqliteStageError::ReceiptConflict);
        }
        require_complete_layout_stage(transaction, layout)?;
        return Ok(());
    }

    let actor_count =
        transaction.query_row("SELECT COUNT(*) FROM external_actors;", [], |row| {
            row.get::<_, i64>(0)
        })?;
    let head_count = transaction.query_row("SELECT COUNT(*) FROM external_heads;", [], |row| {
        row.get::<_, i64>(0)
    })?;
    if actor_count != 0 || head_count != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let mut insert_actor = transaction
        .prepare_cached("INSERT INTO external_actors (actorIndex, actorId) VALUES (?1, ?2);")?;
    for index in 0..layout.actor_count() {
        let actor_id = layout
            .actor_id(usize::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        insert_actor.execute(params![
            i64::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            actor_id,
        ])?;
    }
    drop(insert_actor);

    let mut insert_head = transaction.prepare_cached(
        "INSERT INTO external_heads (headIndex, changeIndex, hash) VALUES (?1, ?2, ?3);",
    )?;
    for index in 0..layout.head_count() {
        let position =
            usize::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
        let hash = layout
            .head(position)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        let change_index = layout
            .head_change_index(position)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        insert_head.execute(params![
            i64::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(change_index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            hash,
        ])?;
    }
    drop(insert_head);

    transaction.execute(
        "INSERT INTO external_layout_stage_receipt (\
         singleton, sourceByteLength, sourceSha256, actorCount, headCount) \
         VALUES (1, ?1, ?2, ?3, ?4);",
        params![
            i64::try_from(source_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            source_sha256,
            i64::try_from(layout.actor_count())
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(layout.head_count())
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        ],
    )?;
    Ok(())
}

fn require_complete_layout_stage(
    transaction: &Transaction<'_>,
    layout: &ExternalVerifiedDocumentLayout,
) -> StageResult<()> {
    let actor_count =
        transaction.query_row("SELECT COUNT(*) FROM external_actors;", [], |row| {
            row.get::<_, i64>(0)
        })?;
    let head_count = transaction.query_row("SELECT COUNT(*) FROM external_heads;", [], |row| {
        row.get::<_, i64>(0)
    })?;
    if u64::try_from(actor_count).ok() != Some(layout.actor_count())
        || u64::try_from(head_count).ok() != Some(layout.head_count())
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    for index in 0..layout.actor_count() {
        let expected = layout
            .actor_id(usize::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        let stored = transaction
            .query_row(
                "SELECT actorId FROM external_actors WHERE actorIndex = ?1;",
                [i64::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if stored.as_deref() != Some(expected) {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
    }
    for index in 0..layout.head_count() {
        let position =
            usize::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
        let expected_hash = layout
            .head(position)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        let expected_change = layout
            .head_change_index(position)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        let stored = transaction
            .query_row(
                "SELECT changeIndex, hash FROM external_heads WHERE headIndex = ?1;",
                [i64::try_from(index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if stored
            != Some((
                i64::try_from(expected_change)
                    .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
                expected_hash.to_string(),
            ))
        {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
    }
    Ok(())
}

fn read_layout_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalLayoutStageReceipt>> {
    transaction
        .query_row(
            "SELECT sourceByteLength, sourceSha256, actorCount, headCount \
             FROM external_layout_stage_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalLayoutStageReceipt {
                    source_byte_length: row.get::<_, i64>(0)? as u64,
                    source_sha256: row.get(1)?,
                    actor_count: row.get::<_, i64>(2)? as u64,
                    head_count: row.get::<_, i64>(3)? as u64,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::Sql)
}

fn require_stage_source_identity(
    stored_byte_length: u64,
    stored_sha256: &str,
    source_byte_length: u64,
    source_sha256: &str,
) -> StageResult<()> {
    if stored_byte_length != source_byte_length || stored_sha256 != source_sha256 {
        return Err(ExternalSqliteStageError::ReceiptConflict);
    }
    Ok(())
}

fn initialize_or_validate_schema(transaction: &Transaction<'_>) -> StageResult<()> {
    let application_id =
        transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
    let user_version =
        transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
    let user_table_count = transaction.query_row(
        "SELECT COUNT(*) FROM sqlite_schema \
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%';",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if application_id == 0 && user_version == 0 && user_table_count == 0 {
        transaction.pragma_update(None, "application_id", STAGE_APPLICATION_ID)?;
        transaction.pragma_update(None, "user_version", STAGE_SCHEMA_VERSION)?;
        transaction.execute_batch(STAGE_SCHEMA_SQL)?;
    } else if application_id != STAGE_APPLICATION_ID || user_version != STAGE_SCHEMA_VERSION {
        return Err(ExternalSqliteStageError::InvalidDatabaseIdentity);
    }
    verify_schema_catalog(transaction)?;
    Ok(())
}

fn schema_catalog(connection: &Connection) -> StageResult<Vec<(String, String, String, String)>> {
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') \
         FROM sqlite_schema \
         WHERE name NOT LIKE 'sqlite_%' \
         ORDER BY type COLLATE BINARY, name COLLATE BINARY, tbl_name COLLATE BINARY;",
    )?;
    let catalog = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(ExternalSqliteStageError::Sql)?;
    Ok(catalog)
}

fn verify_schema_catalog(connection: &Connection) -> StageResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(STAGE_SCHEMA_SQL)?;
    if schema_catalog(connection)? != schema_catalog(&reference)? {
        return Err(ExternalSqliteStageError::SchemaContractMismatch);
    }
    Ok(())
}

fn stage_change(
    transaction: &Transaction<'_>,
    row: &ExternalVerifiedChangeRow,
    payload: &mut ExternalVerifiedPayloadReader<'_>,
) -> StageResult<()> {
    let change_index =
        i64::try_from(row.index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
    let actor_index =
        i64::try_from(row.actor_index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
    let payload_bytes = i32::try_from(payload.byte_length())
        .map_err(|_| ExternalSqliteStageError::PayloadTooLarge)?;
    transaction.execute(
        "INSERT INTO external_changes (\
         changeIndex, actorIndex, sequence, maxOperation, timestamp, message, extraPayload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        params![
            change_index,
            actor_index,
            row.sequence.to_be_bytes().as_slice(),
            row.max_operation.to_be_bytes().as_slice(),
            row.timestamp,
            row.message,
            ZeroBlob(payload_bytes),
        ],
    )?;
    if payload_bytes > 0 {
        let mut blob = transaction.blob_open(
            DatabaseName::Main,
            "external_changes",
            "extraPayload",
            change_index,
            false,
        )?;
        let copied = payload.copy_to(&mut blob)?;
        if copied != payload.byte_length() {
            return Err(ExternalSqliteStageError::ReceiptConflict);
        }
        blob.close()?;
    }
    let mut insert_dependency = transaction.prepare_cached(
        "INSERT INTO external_change_dependencies (\
         changeIndex, dependencyOrdinal, dependencyIndex) VALUES (?1, ?2, ?3);",
    )?;
    for (ordinal, dependency_index) in row.dependencies.iter().enumerate() {
        insert_dependency.execute(params![
            change_index,
            i64::try_from(ordinal).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(*dependency_index)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        ])?;
    }
    Ok(())
}

fn stage_operation(
    transaction: &Transaction<'_>,
    row: &ExternalVerifiedOperationRow,
    payload: &mut ExternalVerifiedPayloadReader<'_>,
) -> StageResult<()> {
    let operation_index =
        i64::try_from(row.index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
    let id_actor_index =
        i64::try_from(row.id.actor_index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
    let (object_kind, object_actor_index, object_counter) = object_columns(&row.object)?;
    let (key_kind, key_name, key_actor_index, key_counter) = key_columns(&row.key)?;
    let (value_kind, value_text, value_type_code, descriptor_payload_bytes) =
        value_columns(&row.value);
    if descriptor_payload_bytes != payload.byte_length() {
        return Err(ExternalSqliteStageError::ReceiptConflict);
    }
    let payload_bytes = i32::try_from(payload.byte_length())
        .map_err(|_| ExternalSqliteStageError::PayloadTooLarge)?;
    transaction.execute(
        "INSERT INTO external_operations (\
         operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, objectCounter, \
         keyKind, keyName, keyActorIndex, keyCounter, insertFlag, action, valueKind, valueText, \
         valueTypeCode, valuePayload, expandFlag, markName) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18);",
        params![
            operation_index,
            id_actor_index,
            row.id.counter.to_be_bytes().as_slice(),
            object_kind,
            object_actor_index,
            object_counter,
            key_kind,
            key_name,
            key_actor_index,
            key_counter,
            i64::from(row.insert),
            i64::try_from(row.action).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            value_kind,
            value_text,
            value_type_code,
            ZeroBlob(payload_bytes),
            i64::from(row.expand),
            row.mark_name,
        ],
    )?;
    if payload_bytes > 0 {
        let mut blob = transaction.blob_open(
            DatabaseName::Main,
            "external_operations",
            "valuePayload",
            operation_index,
            false,
        )?;
        let copied = payload.copy_to(&mut blob)?;
        if copied != payload.byte_length() {
            return Err(ExternalSqliteStageError::ReceiptConflict);
        }
        blob.close()?;
    }
    let mut insert_successor = transaction.prepare_cached(
        "INSERT INTO external_operation_successors (\
         operationIndex, successorOrdinal, actorIndex, counter) VALUES (?1, ?2, ?3, ?4);",
    )?;
    for (ordinal, successor) in row.successors.iter().enumerate() {
        insert_successor.execute(params![
            operation_index,
            i64::try_from(ordinal).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(successor.actor_index)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            successor.counter.to_be_bytes().as_slice(),
        ])?;
    }
    Ok(())
}

fn require_complete_change_stage(
    transaction: &Transaction<'_>,
    summary: &ExternalChangeRowSummary,
) -> StageResult<()> {
    let (change_count, payload_byte_length) = transaction.query_row(
        "SELECT COUNT(*), COALESCE(SUM(length(extraPayload)), 0) FROM external_changes;",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let dependency_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_change_dependencies;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let unresolved_head_count = transaction.query_row(
        "SELECT COUNT(*) \
         FROM external_heads AS head \
         LEFT JOIN external_changes AS change_row \
           ON change_row.changeIndex = head.changeIndex \
         WHERE change_row.changeIndex IS NULL;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let has_dangling_reference =
        foreign_key_check_has_row(transaction, "PRAGMA foreign_key_check(external_changes);")?
            || foreign_key_check_has_row(
                transaction,
                "PRAGMA foreign_key_check(external_change_dependencies);",
            )?;
    let change_count =
        u64::try_from(change_count).map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    let dependency_count =
        u64::try_from(dependency_count).map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    let payload_byte_length = u64::try_from(payload_byte_length)
        .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    if change_count != summary.change_count
        || dependency_count != summary.dependency_count
        || payload_byte_length != summary.extra_payload_spool_byte_length
        || unresolved_head_count != 0
        || has_dangling_reference
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn require_complete_operation_stage(
    transaction: &Transaction<'_>,
    summary: &ExternalOperationRowSummary,
) -> StageResult<()> {
    let (operation_count, payload_byte_length) = transaction.query_row(
        "SELECT COUNT(*), COALESCE(SUM(length(valuePayload)), 0) FROM external_operations;",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let successor_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_operation_successors;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let has_dangling_reference = foreign_key_check_has_row(
        transaction,
        "PRAGMA foreign_key_check(external_operations);",
    )? || foreign_key_check_has_row(
        transaction,
        "PRAGMA foreign_key_check(external_operation_successors);",
    )?;
    let operation_count =
        u64::try_from(operation_count).map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    let successor_count =
        u64::try_from(successor_count).map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    let payload_byte_length = u64::try_from(payload_byte_length)
        .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    if operation_count != summary.operation_count
        || successor_count != summary.successor_count
        || payload_byte_length != summary.value_payload_spool_byte_length
        || has_dangling_reference
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn foreign_key_check_has_row(connection: &Connection, pragma: &'static str) -> StageResult<bool> {
    let mut statement = connection.prepare(pragma)?;
    let mut rows = statement.query([])?;
    Ok(rows.next()?.is_some())
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn stage_verified_operation_rows_with_test_fault(
    connection: &mut Connection,
    row_run: &mut File,
    successor_spool: &mut File,
    value_payload_spool: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
    expected_summary: &ExternalOperationRowSummary,
    row_limits: ExternalOperationRowLimits,
    run_limits: ExternalRowRunLimits,
    fail_after_operation_index: u64,
) -> StageResult<ExternalOperationStageReceipt> {
    stage_verified_operation_rows_with_after_stage(
        connection,
        row_run,
        successor_spool,
        value_payload_spool,
        source_byte_length,
        source_sha256,
        layout,
        expected_summary,
        row_limits,
        run_limits,
        |row| {
            if row.index == fail_after_operation_index {
                return Err(ExternalSqliteStageError::ReceiptConflict);
            }
            Ok(())
        },
    )
}

type ObjectColumns = (&'static str, Option<i64>, Option<Vec<u8>>);

fn object_columns(object: &ObjectReference) -> StageResult<ObjectColumns> {
    match object {
        ObjectReference::Root => Ok(("root", None, None)),
        ObjectReference::Operation {
            actor_index,
            counter,
        } => Ok((
            "operation",
            Some(i64::try_from(*actor_index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?),
            Some(counter.to_be_bytes().to_vec()),
        )),
    }
}

type KeyColumns<'a> = (&'static str, Option<&'a str>, Option<i64>, Option<Vec<u8>>);

fn key_columns(key: &OperationKey) -> StageResult<KeyColumns<'_>> {
    match key {
        OperationKey::Property { name } => Ok(("property", Some(name), None, None)),
        OperationKey::Head => Ok(("head", None, None, None)),
        OperationKey::Element {
            actor_index,
            counter,
        } => Ok((
            "element",
            None,
            Some(i64::try_from(*actor_index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?),
            Some(counter.to_be_bytes().to_vec()),
        )),
    }
}

type ValueColumns<'a> = (&'static str, Option<&'a str>, Option<i64>, u64);

fn value_columns(value: &OperationScalar) -> ValueColumns<'_> {
    match value {
        OperationScalar::Null => ("null", None, None, 0),
        OperationScalar::Boolean { value } => (
            "boolean",
            Some(if *value { "true" } else { "false" }),
            None,
            0,
        ),
        OperationScalar::Unsigned { value } => ("unsigned", Some(value), None, 0),
        OperationScalar::Signed { value } => ("signed", Some(value), None, 0),
        OperationScalar::Counter { value } => ("counter", Some(value), None, 0),
        OperationScalar::Timestamp { value } => ("timestamp", Some(value), None, 0),
        OperationScalar::Float { little_endian_bits } => {
            ("float", Some(little_endian_bits), None, 0)
        }
        OperationScalar::String { byte_length, .. } => ("string", None, None, *byte_length),
        OperationScalar::Bytes { byte_length, .. } => ("bytes", None, None, *byte_length),
        OperationScalar::Unknown {
            type_code,
            byte_length,
            ..
        } => ("unknown", None, Some(i64::from(*type_code)), *byte_length),
    }
}

fn insert_change_receipt(
    transaction: &Transaction<'_>,
    source_byte_length: u64,
    source_sha256: &str,
    summary: &ExternalChangeRowSummary,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_change_stage_receipt (\
         singleton, sourceByteLength, sourceSha256, changeCount, dependencyCount, \
         dependencySpoolByteLength, dependencySpoolSha256, extraPayloadSpoolByteLength, \
         extraPayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256) \
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
        params![
            i64::try_from(source_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            source_sha256,
            i64::try_from(summary.change_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(summary.dependency_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(summary.dependency_spool_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            summary.dependency_spool_sha256,
            i64::try_from(summary.extra_payload_spool_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            summary.extra_payload_spool_sha256,
            i64::try_from(summary.row_run_prefix_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            summary.row_run_prefix_sha256,
        ],
    )?;
    Ok(())
}

fn read_change_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalChangeStageReceipt>> {
    transaction
        .query_row(
            "SELECT sourceByteLength, sourceSha256, changeCount, dependencyCount, \
             dependencySpoolByteLength, dependencySpoolSha256, extraPayloadSpoolByteLength, \
             extraPayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256 \
             FROM external_change_stage_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalChangeStageReceipt {
                    source_byte_length: row.get::<_, i64>(0)? as u64,
                    source_sha256: row.get(1)?,
                    summary: ExternalChangeRowSummary {
                        change_count: row.get::<_, i64>(2)? as u64,
                        dependency_count: row.get::<_, i64>(3)? as u64,
                        dependency_spool_byte_length: row.get::<_, i64>(4)? as u64,
                        dependency_spool_sha256: row.get(5)?,
                        extra_payload_spool_byte_length: row.get::<_, i64>(6)? as u64,
                        extra_payload_spool_sha256: row.get(7)?,
                        row_run_prefix_byte_length: row.get::<_, i64>(8)? as u64,
                        row_run_prefix_sha256: row.get(9)?,
                    },
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::Sql)
}

fn require_matching_change_receipt(
    receipt: &ExternalChangeStageReceipt,
    source_byte_length: u64,
    source_sha256: &str,
    summary: &ExternalChangeRowSummary,
) -> StageResult<()> {
    if receipt.source_byte_length != source_byte_length
        || receipt.source_sha256 != source_sha256
        || receipt.summary != *summary
    {
        return Err(ExternalSqliteStageError::ReceiptConflict);
    }
    Ok(())
}

fn insert_operation_receipt(
    transaction: &Transaction<'_>,
    source_byte_length: u64,
    source_sha256: &str,
    summary: &ExternalOperationRowSummary,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_operation_stage_receipt (\
         singleton, sourceByteLength, sourceSha256, operationCount, successorCount, \
         successorSpoolByteLength, successorSpoolSha256, valuePayloadSpoolByteLength, \
         valuePayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256) \
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
        params![
            i64::try_from(source_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            source_sha256,
            i64::try_from(summary.operation_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(summary.successor_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(summary.successor_spool_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            summary.successor_spool_sha256,
            i64::try_from(summary.value_payload_spool_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            summary.value_payload_spool_sha256,
            i64::try_from(summary.row_run_prefix_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            summary.row_run_prefix_sha256,
        ],
    )?;
    Ok(())
}

fn read_operation_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalOperationStageReceipt>> {
    transaction
        .query_row(
            "SELECT sourceByteLength, sourceSha256, operationCount, successorCount, \
             successorSpoolByteLength, successorSpoolSha256, valuePayloadSpoolByteLength, \
             valuePayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256 \
             FROM external_operation_stage_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalOperationStageReceipt {
                    source_byte_length: row.get::<_, i64>(0)? as u64,
                    source_sha256: row.get(1)?,
                    summary: ExternalOperationRowSummary {
                        operation_count: row.get::<_, i64>(2)? as u64,
                        successor_count: row.get::<_, i64>(3)? as u64,
                        successor_spool_byte_length: row.get::<_, i64>(4)? as u64,
                        successor_spool_sha256: row.get(5)?,
                        value_payload_spool_byte_length: row.get::<_, i64>(6)? as u64,
                        value_payload_spool_sha256: row.get(7)?,
                        row_run_prefix_byte_length: row.get::<_, i64>(8)? as u64,
                        row_run_prefix_sha256: row.get(9)?,
                    },
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::Sql)
}

fn require_matching_operation_receipt(
    receipt: &ExternalOperationStageReceipt,
    source_byte_length: u64,
    source_sha256: &str,
    summary: &ExternalOperationRowSummary,
) -> StageResult<()> {
    if receipt.source_byte_length != source_byte_length
        || receipt.source_sha256 != source_sha256
        || receipt.summary != *summary
    {
        return Err(ExternalSqliteStageError::ReceiptConflict);
    }
    Ok(())
}
