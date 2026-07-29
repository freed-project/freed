//! Atomic SQLite staging for receipt-bound Automerge operation rows.
//!
//! This dormant layer copies verified rows and their exact payload bytes into a
//! scratch SQLite database without allocating a source-sized value buffer. The
//! complete row and companion-spool receipts are rechecked before the staging
//! transaction commits. No command or production caller opens this store.

use crate::automerge_external_document_run::ExternalVerifiedDocumentLayout;
use crate::automerge_external_operation_rows::{
    ExternalOperationRowLimits, ExternalOperationRowSummary, ObjectReference, OperationKey,
    OperationScalar,
};
use crate::automerge_external_row_run::{
    with_verified_operation_rows_and_payload, ExternalRowRunConsumeError, ExternalRowRunError,
    ExternalRowRunLimits, ExternalVerifiedOperationRow, ExternalVerifiedPayloadReader,
};
use rusqlite::blob::ZeroBlob;
use rusqlite::{
    params, Connection, DatabaseName, OptionalExtension, Transaction, TransactionBehavior,
};
use std::fmt;
use std::fs::File;

const STAGE_APPLICATION_ID: i64 = 0x4652_4f53;
const STAGE_SCHEMA_VERSION: i64 = 1;

const STAGE_SCHEMA_SQL: &str = r#"
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
  idActorIndex INTEGER NOT NULL CHECK (idActorIndex >= 0),
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
  UNIQUE (operationIndex, actorIndex, counter)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS external_operations_object
  ON external_operations(objectKind, objectActorIndex, objectCounter, keyKind, keyName);
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalOperationStageReceipt {
    pub source_byte_length: u64,
    pub source_sha256: String,
    pub summary: ExternalOperationRowSummary,
}

#[derive(Debug)]
pub(super) enum ExternalOperationStageError {
    Sql(rusqlite::Error),
    RowRun(ExternalRowRunError),
    InvalidDatabaseIdentity,
    SchemaContractMismatch,
    IncompleteStage,
    ReceiptConflict,
    RangeOverflow,
    PayloadTooLarge,
}

impl From<rusqlite::Error> for ExternalOperationStageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<ExternalRowRunError> for ExternalOperationStageError {
    fn from(error: ExternalRowRunError) -> Self {
        Self::RowRun(error)
    }
}

impl fmt::Display for ExternalOperationStageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(formatter, "Automerge operation stage SQL failed: {error}"),
            Self::RowRun(error) => error.fmt(formatter),
            Self::InvalidDatabaseIdentity => {
                formatter.write_str("Automerge operation stage database identity is invalid")
            }
            Self::SchemaContractMismatch => {
                formatter.write_str("Automerge operation stage schema contract is invalid")
            }
            Self::IncompleteStage => {
                formatter.write_str("Automerge operation stage contains unreceipted rows")
            }
            Self::ReceiptConflict => {
                formatter.write_str("Automerge operation stage receipt conflicts with this source")
            }
            Self::RangeOverflow => {
                formatter.write_str("Automerge operation stage range overflows SQLite")
            }
            Self::PayloadTooLarge => {
                formatter.write_str("Automerge operation payload exceeds SQLite blob limits")
            }
        }
    }
}

impl std::error::Error for ExternalOperationStageError {}

type StageResult<T> = Result<T, ExternalOperationStageError>;

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

    if let Some(receipt) = read_receipt(&transaction)? {
        require_matching_receipt(
            &receipt,
            source_byte_length,
            source_sha256,
            expected_summary,
        )?;
        require_complete_stage(&transaction, &receipt.summary)?;
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
        return Err(ExternalOperationStageError::IncompleteStage);
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
        ExternalRowRunConsumeError::Run(error) => ExternalOperationStageError::RowRun(error),
        ExternalRowRunConsumeError::Consumer(error) => error,
    })?;
    if read_summary != *expected_summary {
        return Err(ExternalOperationStageError::ReceiptConflict);
    }
    require_complete_stage(&transaction, &read_summary)?;
    insert_receipt(
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
        return Err(ExternalOperationStageError::InvalidDatabaseIdentity);
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
        .map_err(ExternalOperationStageError::Sql)?;
    Ok(catalog)
}

fn verify_schema_catalog(connection: &Connection) -> StageResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(STAGE_SCHEMA_SQL)?;
    if schema_catalog(connection)? != schema_catalog(&reference)? {
        return Err(ExternalOperationStageError::SchemaContractMismatch);
    }
    Ok(())
}

fn stage_operation(
    transaction: &Transaction<'_>,
    row: &ExternalVerifiedOperationRow,
    payload: &mut ExternalVerifiedPayloadReader<'_>,
) -> StageResult<()> {
    let operation_index =
        i64::try_from(row.index).map_err(|_| ExternalOperationStageError::RangeOverflow)?;
    let id_actor_index = i64::try_from(row.id.actor_index)
        .map_err(|_| ExternalOperationStageError::RangeOverflow)?;
    let (object_kind, object_actor_index, object_counter) = object_columns(&row.object)?;
    let (key_kind, key_name, key_actor_index, key_counter) = key_columns(&row.key)?;
    let (value_kind, value_text, value_type_code, descriptor_payload_bytes) =
        value_columns(&row.value);
    if descriptor_payload_bytes != payload.byte_length() {
        return Err(ExternalOperationStageError::ReceiptConflict);
    }
    let payload_bytes = i32::try_from(payload.byte_length())
        .map_err(|_| ExternalOperationStageError::PayloadTooLarge)?;
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
            i64::try_from(row.action).map_err(|_| ExternalOperationStageError::RangeOverflow)?,
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
            return Err(ExternalOperationStageError::ReceiptConflict);
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
            i64::try_from(ordinal).map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            i64::try_from(successor.actor_index)
                .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            successor.counter.to_be_bytes().as_slice(),
        ])?;
    }
    Ok(())
}

fn require_complete_stage(
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
    let operation_count =
        u64::try_from(operation_count).map_err(|_| ExternalOperationStageError::IncompleteStage)?;
    let successor_count =
        u64::try_from(successor_count).map_err(|_| ExternalOperationStageError::IncompleteStage)?;
    let payload_byte_length = u64::try_from(payload_byte_length)
        .map_err(|_| ExternalOperationStageError::IncompleteStage)?;
    if operation_count != summary.operation_count
        || successor_count != summary.successor_count
        || payload_byte_length != summary.value_payload_spool_byte_length
    {
        return Err(ExternalOperationStageError::IncompleteStage);
    }
    Ok(())
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
                return Err(ExternalOperationStageError::ReceiptConflict);
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
            Some(
                i64::try_from(*actor_index)
                    .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            ),
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
            Some(
                i64::try_from(*actor_index)
                    .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            ),
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

fn insert_receipt(
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
                .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            source_sha256,
            i64::try_from(summary.operation_count)
                .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            i64::try_from(summary.successor_count)
                .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            i64::try_from(summary.successor_spool_byte_length)
                .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            summary.successor_spool_sha256,
            i64::try_from(summary.value_payload_spool_byte_length)
                .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            summary.value_payload_spool_sha256,
            i64::try_from(summary.row_run_prefix_byte_length)
                .map_err(|_| ExternalOperationStageError::RangeOverflow)?,
            summary.row_run_prefix_sha256,
        ],
    )?;
    Ok(())
}

fn read_receipt(
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
        .map_err(ExternalOperationStageError::Sql)
}

fn require_matching_receipt(
    receipt: &ExternalOperationStageReceipt,
    source_byte_length: u64,
    source_sha256: &str,
    summary: &ExternalOperationRowSummary,
) -> StageResult<()> {
    if receipt.source_byte_length != source_byte_length
        || receipt.source_sha256 != source_sha256
        || receipt.summary != *summary
    {
        return Err(ExternalOperationStageError::ReceiptConflict);
    }
    Ok(())
}
