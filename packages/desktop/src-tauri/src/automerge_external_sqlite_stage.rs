//! Atomic SQLite staging for receipt-bound Automerge rows.
//!
//! This layer copies verified rows and their exact payload bytes into a
//! scratch SQLite database without allocating a source-sized value buffer. The
//! complete row and companion-spool receipts are rechecked before the staging
//! transaction commits.

use crate::automerge_external_change_rows::{ExternalChangeRowLimits, ExternalChangeRowSummary};
use crate::automerge_external_document_run::ExternalVerifiedDocumentLayout;
use crate::automerge_external_feed_item_projection::{
    project_feed_item_document, FeedItemProjectionError,
};
use crate::automerge_external_operation_rows::{
    ExternalOperationRowLimits, ExternalOperationRowSummary, ObjectReference, OperationKey,
    OperationScalar,
};
use crate::automerge_external_row_run::{
    with_verified_change_rows_and_payload, with_verified_operation_rows_and_payload,
    ExternalRowRunConsumeError, ExternalRowRunError, ExternalRowRunLimits,
    ExternalVerifiedChangeRow, ExternalVerifiedOperationRow, ExternalVerifiedPayloadReader,
};
use crate::shadow_store::{
    FeedItemRow, ProjectionSourceV1, MAX_PROJECTION_BATCH_BYTES, MAX_PROJECTION_BATCH_ITEMS,
};
use rusqlite::blob::ZeroBlob;
use rusqlite::types::ValueRef;
use rusqlite::{
    params, Connection, DatabaseName, OptionalExtension, Row, Transaction, TransactionBehavior,
};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::File;
use std::io::{Read, Write};

const STAGE_APPLICATION_ID: i64 = 0x4652_4f53;
const STAGE_SCHEMA_VERSION: i64 = 12;
const MAX_FEED_ITEM_OBJECT_DEPTH: i64 = 128;
const MAX_FEED_ITEM_JSON_BYTES: usize = 4 * 1024 * 1024;

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
  actorIndex INTEGER NOT NULL REFERENCES external_actors(actorIndex) CHECK (actorIndex >= 0),
  counter BLOB NOT NULL CHECK (length(counter) = 8),
  PRIMARY KEY (operationIndex, successorOrdinal),
  UNIQUE (operationIndex, actorIndex, counter)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS external_operations_object
  ON external_operations(objectKind, objectActorIndex, objectCounter, keyKind, keyName);

CREATE TABLE IF NOT EXISTS external_omitted_deletes (
  actorIndex INTEGER NOT NULL REFERENCES external_actors(actorIndex) CHECK (actorIndex >= 0),
  counter BLOB NOT NULL CHECK (length(counter) = 8),
  objectKind TEXT NOT NULL CHECK (objectKind IN ('root', 'operation')),
  objectActorIndex INTEGER CHECK (objectActorIndex IS NULL OR objectActorIndex >= 0),
  objectCounter BLOB CHECK (objectCounter IS NULL OR length(objectCounter) = 8),
  keyKind TEXT NOT NULL CHECK (keyKind IN ('property', 'element')),
  keyName TEXT,
  keyActorIndex INTEGER CHECK (keyActorIndex IS NULL OR keyActorIndex >= 0),
  keyCounter BLOB CHECK (keyCounter IS NULL OR length(keyCounter) = 8),
  PRIMARY KEY (actorIndex, counter),
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
    (keyKind = 'element' AND keyName IS NULL AND keyActorIndex IS NOT NULL AND keyCounter IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS external_graph_stage_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sourceByteLength INTEGER NOT NULL CHECK (sourceByteLength >= 0),
  sourceSha256 TEXT NOT NULL CHECK (
    length(sourceSha256) = 64 AND sourceSha256 = lower(sourceSha256)
  ),
  actorCount INTEGER NOT NULL CHECK (actorCount >= 0),
  headCount INTEGER NOT NULL CHECK (headCount >= 0),
  changeCount INTEGER NOT NULL CHECK (changeCount >= 0),
  dependencyCount INTEGER NOT NULL CHECK (dependencyCount >= 0),
  operationCount INTEGER NOT NULL CHECK (operationCount >= 0),
  successorCount INTEGER NOT NULL CHECK (successorCount >= 0),
  omittedDeleteCount INTEGER NOT NULL CHECK (omittedDeleteCount >= 0),
  graphSha256 TEXT NOT NULL CHECK (
    length(graphSha256) = 64 AND graphSha256 = lower(graphSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_current_operations (
  operationIndex INTEGER PRIMARY KEY
    REFERENCES external_operations(operationIndex) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS external_current_operation_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  graphSha256 TEXT NOT NULL CHECK (
    length(graphSha256) = 64 AND graphSha256 = lower(graphSha256)
  ),
  currentOperationCount INTEGER NOT NULL CHECK (currentOperationCount >= 0),
  currentOperationsSha256 TEXT NOT NULL CHECK (
    length(currentOperationsSha256) = 64 AND
    currentOperationsSha256 = lower(currentOperationsSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_resolved_values (
  operationIndex INTEGER PRIMARY KEY
    REFERENCES external_current_operations(operationIndex) ON DELETE CASCADE,
  isWinner INTEGER NOT NULL CHECK (isWinner IN (0, 1)),
  resolvedCounterText TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS external_resolved_value_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  graphSha256 TEXT NOT NULL CHECK (
    length(graphSha256) = 64 AND graphSha256 = lower(graphSha256)
  ),
  currentOperationsSha256 TEXT NOT NULL CHECK (
    length(currentOperationsSha256) = 64 AND
    currentOperationsSha256 = lower(currentOperationsSha256)
  ),
  resolvedValueCount INTEGER NOT NULL CHECK (resolvedValueCount >= 0),
  winnerCount INTEGER NOT NULL CHECK (winnerCount >= 0),
  resolvedValuesSha256 TEXT NOT NULL CHECK (
    length(resolvedValuesSha256) = 64 AND
    resolvedValuesSha256 = lower(resolvedValuesSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_sequence_elements (
  objectActorIndex INTEGER NOT NULL CHECK (objectActorIndex >= 0),
  objectCounter BLOB NOT NULL CHECK (length(objectCounter) = 8),
  sequenceOrdinal INTEGER NOT NULL CHECK (sequenceOrdinal >= 0),
  insertionOperationIndex INTEGER NOT NULL UNIQUE
    REFERENCES external_operations(operationIndex) ON DELETE CASCADE,
  PRIMARY KEY (objectActorIndex, objectCounter, sequenceOrdinal),
  FOREIGN KEY (objectActorIndex, objectCounter)
    REFERENCES external_operations(idActorIndex, idCounter)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS external_sequence_element_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  graphSha256 TEXT NOT NULL CHECK (
    length(graphSha256) = 64 AND graphSha256 = lower(graphSha256)
  ),
  resolvedValuesSha256 TEXT NOT NULL CHECK (
    length(resolvedValuesSha256) = 64 AND
    resolvedValuesSha256 = lower(resolvedValuesSha256)
  ),
  sequenceObjectCount INTEGER NOT NULL CHECK (sequenceObjectCount >= 0),
  sequenceElementCount INTEGER NOT NULL CHECK (sequenceElementCount >= 0),
  sequenceElementsSha256 TEXT NOT NULL CHECK (
    length(sequenceElementsSha256) = 64 AND
    sequenceElementsSha256 = lower(sequenceElementsSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_feed_item_entities (
  entityOperationIndex INTEGER PRIMARY KEY
    REFERENCES external_resolved_values(operationIndex) ON DELETE CASCADE,
  globalId TEXT NOT NULL UNIQUE CHECK (length(CAST(globalId AS BLOB)) BETWEEN 1 AND 4096)
) STRICT;

CREATE TABLE IF NOT EXISTS external_feed_item_nodes (
  valueOperationIndex INTEGER PRIMARY KEY
    REFERENCES external_resolved_values(operationIndex) ON DELETE CASCADE,
  entityOperationIndex INTEGER NOT NULL
    REFERENCES external_feed_item_entities(entityOperationIndex) ON DELETE CASCADE,
  parentValueOperationIndex INTEGER
    REFERENCES external_feed_item_nodes(valueOperationIndex) ON DELETE CASCADE,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 128),
  segmentKind TEXT NOT NULL CHECK (segmentKind IN ('entity', 'property', 'sequence')),
  propertyName TEXT,
  sequenceOrdinal INTEGER CHECK (sequenceOrdinal IS NULL OR sequenceOrdinal >= 0),
  CHECK (
    (segmentKind = 'entity' AND parentValueOperationIndex IS NULL
      AND depth = 0 AND propertyName IS NULL AND sequenceOrdinal IS NULL) OR
    (segmentKind = 'property' AND parentValueOperationIndex IS NOT NULL
      AND depth > 0 AND propertyName IS NOT NULL AND sequenceOrdinal IS NULL) OR
    (segmentKind = 'sequence' AND parentValueOperationIndex IS NOT NULL
      AND depth > 0 AND propertyName IS NULL AND sequenceOrdinal IS NOT NULL)
  ),
  UNIQUE (entityOperationIndex, parentValueOperationIndex, segmentKind, propertyName),
  UNIQUE (entityOperationIndex, parentValueOperationIndex, segmentKind, sequenceOrdinal)
) STRICT;

CREATE TABLE IF NOT EXISTS external_feed_item_node_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  graphSha256 TEXT NOT NULL CHECK (
    length(graphSha256) = 64 AND graphSha256 = lower(graphSha256)
  ),
  resolvedValuesSha256 TEXT NOT NULL CHECK (
    length(resolvedValuesSha256) = 64 AND
    resolvedValuesSha256 = lower(resolvedValuesSha256)
  ),
  sequenceElementsSha256 TEXT NOT NULL CHECK (
    length(sequenceElementsSha256) = 64 AND
    sequenceElementsSha256 = lower(sequenceElementsSha256)
  ),
  feedItemCount INTEGER NOT NULL CHECK (feedItemCount >= 0),
  feedItemNodeCount INTEGER NOT NULL CHECK (feedItemNodeCount >= 0),
  feedItemNodesSha256 TEXT NOT NULL CHECK (
    length(feedItemNodesSha256) = 64 AND feedItemNodesSha256 = lower(feedItemNodesSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_feed_item_documents (
  entityOperationIndex INTEGER PRIMARY KEY
    REFERENCES external_feed_item_entities(entityOperationIndex) ON DELETE CASCADE,
  globalId TEXT NOT NULL UNIQUE,
  jsonText TEXT NOT NULL CHECK (
    json_valid(jsonText) AND length(CAST(jsonText AS BLOB)) BETWEEN 1 AND 4194304
  ),
  jsonByteLength INTEGER NOT NULL CHECK (jsonByteLength BETWEEN 1 AND 4194304),
  jsonSha256 TEXT NOT NULL CHECK (
    length(jsonSha256) = 64 AND jsonSha256 = lower(jsonSha256)
  ),
  CHECK (jsonByteLength = length(CAST(jsonText AS BLOB)))
) STRICT;

CREATE TABLE IF NOT EXISTS external_feed_item_document_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  feedItemNodesSha256 TEXT NOT NULL CHECK (
    length(feedItemNodesSha256) = 64 AND feedItemNodesSha256 = lower(feedItemNodesSha256)
  ),
  feedItemCount INTEGER NOT NULL CHECK (feedItemCount >= 0),
  jsonByteLength INTEGER NOT NULL CHECK (jsonByteLength >= 0),
  feedItemDocumentsSha256 TEXT NOT NULL CHECK (
    length(feedItemDocumentsSha256) = 64 AND
    feedItemDocumentsSha256 = lower(feedItemDocumentsSha256)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS external_feed_item_projection_rows (
  entityOperationIndex INTEGER PRIMARY KEY
    REFERENCES external_feed_item_documents(entityOperationIndex) ON DELETE CASCADE,
  globalId TEXT NOT NULL UNIQUE CHECK (length(CAST(globalId AS BLOB)) BETWEEN 1 AND 4096),
  platform TEXT,
  contentType TEXT,
  publishedAt INTEGER,
  capturedAt INTEGER,
  authorId TEXT,
  authorDisplayName TEXT,
  authorHandle TEXT,
  sourceUrl TEXT,
  hidden INTEGER CHECK (hidden IS NULL OR hidden IN (0, 1)),
  saved INTEGER CHECK (saved IS NULL OR saved IN (0, 1)),
  archived INTEGER CHECK (archived IS NULL OR archived IN (0, 1)),
  readAt INTEGER,
  archivedAt INTEGER,
  likedAt INTEGER,
  tags TEXT CHECK (tags IS NULL OR json_valid(tags)),
  contentBlob TEXT CHECK (contentBlob IS NULL OR json_valid(contentBlob)),
  preservedBlob TEXT CHECK (preservedBlob IS NULL OR json_valid(preservedBlob)),
  rest TEXT NOT NULL CHECK (json_valid(rest) AND json_type(rest) = 'object'),
  sortAt INTEGER NOT NULL,
  CHECK (sortAt = COALESCE(publishedAt, 0))
) STRICT;

CREATE TABLE IF NOT EXISTS external_feed_item_projection_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  feedItemDocumentsSha256 TEXT NOT NULL CHECK (
    length(feedItemDocumentsSha256) = 64 AND
    feedItemDocumentsSha256 = lower(feedItemDocumentsSha256)
  ),
  feedItemCount INTEGER NOT NULL CHECK (feedItemCount >= 0),
  feedItemProjectionRowsSha256 TEXT NOT NULL CHECK (
    length(feedItemProjectionRowsSha256) = 64 AND
    feedItemProjectionRowsSha256 = lower(feedItemProjectionRowsSha256)
  )
) STRICT;
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalGraphStageReceipt {
    pub source_byte_length: u64,
    pub source_sha256: String,
    pub actor_count: u64,
    pub head_count: u64,
    pub change_count: u64,
    pub dependency_count: u64,
    pub operation_count: u64,
    pub successor_count: u64,
    pub omitted_delete_count: u64,
    pub graph_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ExternalCurrentOperationReceipt {
    pub graph_sha256: String,
    pub current_operation_count: u64,
    pub current_operations_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ExternalResolvedValueReceipt {
    graph_sha256: String,
    current_operations_sha256: String,
    resolved_value_count: u64,
    winner_count: u64,
    resolved_values_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ExternalSequenceElementReceipt {
    graph_sha256: String,
    resolved_values_sha256: String,
    sequence_object_count: u64,
    sequence_element_count: u64,
    sequence_elements_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ExternalFeedItemNodeReceipt {
    graph_sha256: String,
    resolved_values_sha256: String,
    sequence_elements_sha256: String,
    feed_item_count: u64,
    feed_item_node_count: u64,
    feed_item_nodes_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ExternalFeedItemDocumentReceipt {
    feed_item_nodes_sha256: String,
    feed_item_count: u64,
    json_byte_length: u64,
    feed_item_documents_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalFeedItemProjectionReceipt {
    pub(super) feed_item_documents_sha256: String,
    pub(super) feed_item_count: u64,
    pub(super) feed_item_projection_rows_sha256: String,
}

#[derive(Debug, PartialEq)]
pub(super) struct ExternalFeedItemProjectionPage {
    pub(super) rows: Vec<FeedItemRow>,
    pub(super) last_entity_operation_index: i64,
    pub(super) complete: bool,
    pub(super) input_digest: String,
}

/// One stable, receipt-verified view of the scratch projection rows.
///
/// The transaction pins a single SQLite snapshot while the caller copies
/// bounded pages into a separate immutable generation. A concurrent scratch
/// writer cannot make later pages observe a different source.
pub(super) struct ExternalFeedItemProjectionSnapshot<'connection> {
    transaction: Transaction<'connection>,
    receipt: ExternalFeedItemProjectionReceipt,
}

impl ExternalFeedItemProjectionSnapshot<'_> {
    pub(super) fn receipt(&self) -> &ExternalFeedItemProjectionReceipt {
        &self.receipt
    }

    pub(super) fn cursor_for_projected_rows(
        &self,
        projected_rows: usize,
    ) -> StageResult<Option<i64>> {
        if projected_rows
            > usize::try_from(self.receipt.feed_item_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?
        {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        if projected_rows == 0 {
            return Ok(None);
        }
        self.transaction
            .query_row(
                "SELECT entityOperationIndex FROM external_feed_item_projection_rows \
                 ORDER BY entityOperationIndex LIMIT 1 OFFSET ?1;",
                [i64::try_from(projected_rows - 1)
                    .map_err(|_| ExternalSqliteStageError::RangeOverflow)?],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or(ExternalSqliteStageError::IncompleteStage)
            .map(Some)
    }

    pub(super) fn read_page(
        &self,
        after_entity_operation_index: Option<i64>,
        maximum_rows: usize,
        maximum_bytes: usize,
    ) -> StageResult<Option<ExternalFeedItemProjectionPage>> {
        if !(1..=MAX_PROJECTION_BATCH_ITEMS).contains(&maximum_rows)
            || !(1..=MAX_PROJECTION_BATCH_BYTES).contains(&maximum_bytes)
        {
            return Err(ExternalSqliteStageError::RangeOverflow);
        }
        let mut entries = Vec::with_capacity(maximum_rows);
        let mut projected_bytes = 0usize;
        let mut cursor = after_entity_operation_index.unwrap_or(-1);
        let mut statement = self.transaction.prepare(
            "SELECT entityOperationIndex, globalId, platform, contentType, publishedAt, \
                    capturedAt, authorId, authorDisplayName, authorHandle, sourceUrl, hidden, \
                    saved, archived, readAt, archivedAt, likedAt, tags, contentBlob, \
                    preservedBlob, rest \
             FROM external_feed_item_projection_rows \
             WHERE entityOperationIndex > ?1 \
             ORDER BY entityOperationIndex LIMIT ?2;",
        )?;
        let mut rows = statement.query(params![
            cursor,
            i64::try_from(maximum_rows).map_err(|_| ExternalSqliteStageError::RangeOverflow)?
        ])?;
        while let Some(source_row) = rows.next()? {
            let entity_operation_index = source_row.get::<_, i64>(0)?;
            let row = read_feed_item_projection_row(source_row, 1)?;
            let row_bytes = row.projected_size_bytes();
            if projected_bytes.saturating_add(row_bytes) > maximum_bytes {
                if entries.is_empty() {
                    return Err(ExternalSqliteStageError::PayloadTooLarge);
                }
                break;
            }
            projected_bytes = projected_bytes.saturating_add(row_bytes);
            cursor = entity_operation_index;
            entries.push((entity_operation_index, row));
        }
        if entries.is_empty() {
            return Ok(None);
        }
        let complete = self.transaction.query_row(
            "SELECT NOT EXISTS (\
               SELECT 1 FROM external_feed_item_projection_rows \
               WHERE entityOperationIndex > ?1\
             );",
            [cursor],
            |row| row.get::<_, i64>(0),
        )? == 1;
        let input_digest = feed_item_projection_page_sha256(&self.receipt, &entries)?;
        Ok(Some(ExternalFeedItemProjectionPage {
            rows: entries.into_iter().map(|(_, row)| row).collect(),
            last_entity_operation_index: cursor,
            complete,
            input_digest,
        }))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ExternalOperationTarget {
    object_kind: String,
    object_actor_index: Option<i64>,
    object_counter: Option<Vec<u8>>,
    key_kind: String,
    key_name: Option<String>,
    key_actor_index: Option<i64>,
    key_counter: Option<Vec<u8>>,
}

#[derive(Debug)]
pub(super) enum ExternalSqliteStageError {
    Sql(rusqlite::Error),
    Io(std::io::Error),
    RowRun(ExternalRowRunError),
    Projection(FeedItemProjectionError),
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

impl From<std::io::Error> for ExternalSqliteStageError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<ExternalRowRunError> for ExternalSqliteStageError {
    fn from(error: ExternalRowRunError) -> Self {
        Self::RowRun(error)
    }
}

impl From<FeedItemProjectionError> for ExternalSqliteStageError {
    fn from(error: FeedItemProjectionError) -> Self {
        Self::Projection(error)
    }
}

impl fmt::Display for ExternalSqliteStageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(formatter, "Automerge SQLite stage SQL failed: {error}"),
            Self::Io(error) => write!(formatter, "Automerge SQLite stage I/O failed: {error}"),
            Self::RowRun(error) => error.fmt(formatter),
            Self::Projection(error) => error.fmt(formatter),
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

pub(super) fn seal_staged_graph(
    connection: &mut Connection,
) -> StageResult<ExternalGraphStageReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let layout_receipt =
        read_layout_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    let change_receipt =
        read_change_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    let operation_receipt =
        read_operation_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    require_stage_source_identity(
        change_receipt.source_byte_length,
        &change_receipt.source_sha256,
        layout_receipt.source_byte_length,
        &layout_receipt.source_sha256,
    )?;
    require_stage_source_identity(
        operation_receipt.source_byte_length,
        &operation_receipt.source_sha256,
        layout_receipt.source_byte_length,
        &layout_receipt.source_sha256,
    )?;
    require_complete_change_stage(&transaction, &change_receipt.summary)?;
    require_complete_operation_stage(&transaction, &operation_receipt.summary)?;
    validate_layout_counts(&transaction, &layout_receipt)?;
    let existing_graph_receipt = read_graph_receipt(&transaction)?;
    let omitted_delete_count =
        stage_or_validate_omitted_deletes(&transaction, existing_graph_receipt.is_some())?;
    validate_successor_graph(&transaction)?;
    validate_actor_operation_intervals(&transaction, layout_receipt.actor_count)?;

    let receipt = ExternalGraphStageReceipt {
        source_byte_length: layout_receipt.source_byte_length,
        source_sha256: layout_receipt.source_sha256,
        actor_count: layout_receipt.actor_count,
        head_count: layout_receipt.head_count,
        change_count: change_receipt.summary.change_count,
        dependency_count: change_receipt.summary.dependency_count,
        operation_count: operation_receipt.summary.operation_count,
        successor_count: operation_receipt.summary.successor_count,
        omitted_delete_count,
        graph_sha256: graph_content_sha256(&transaction)?,
    };
    if let Some(stored) = existing_graph_receipt {
        if stored != receipt {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    insert_graph_receipt(&transaction, &receipt)?;
    transaction.commit()?;
    Ok(receipt)
}

/// Derives the exact projection identity from one sealed external graph.
///
/// The worker cannot expose this identity without hydrating Automerge. The
/// native decoder already has the authenticated heads and resolved root
/// metadata on disk, so it reconstructs the same source tuple without adding a
/// second document-sized resident copy.
pub(super) fn derive_projection_source(
    connection: &mut Connection,
    storage_generation: i64,
    storage_save_revision: i64,
) -> StageResult<ProjectionSourceV1> {
    if storage_generation < 0 || storage_save_revision < 0 {
        return Err(ExternalSqliteStageError::RangeOverflow);
    }
    materialize_current_operations(connection)?;
    materialize_resolved_values(connection)?;
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let graph_receipt =
        read_graph_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    if graph_content_sha256(&transaction)? != graph_receipt.graph_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let mut meta_statement = transaction.prepare(
        "SELECT operation.idActorIndex, operation.idCounter, operation.action \
         FROM external_resolved_values AS resolved \
         JOIN external_operations AS operation USING (operationIndex) \
         WHERE resolved.isWinner = 1 \
           AND operation.objectKind = 'root' \
           AND operation.keyKind = 'property' \
           AND operation.keyName = 'meta' \
         ORDER BY operation.operationIndex;",
    )?;
    let meta_rows = meta_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(meta_statement);
    if meta_rows.len() > 1 || meta_rows.first().is_some_and(|row| row.2 != 0) {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let read_meta_string = |property: &str| -> StageResult<Option<String>> {
        let Some((actor_index, counter, _)) = meta_rows.first() else {
            return Ok(None);
        };
        let mut statement = transaction.prepare(
            "SELECT operation.valuePayload, operation.action, operation.valueKind, \
                    operation.valueText, operation.valueTypeCode \
             FROM external_resolved_values AS resolved \
             JOIN external_operations AS operation USING (operationIndex) \
             WHERE resolved.isWinner = 1 \
               AND operation.objectKind = 'operation' \
               AND operation.objectActorIndex = ?1 \
               AND operation.objectCounter = ?2 \
               AND operation.keyKind = 'property' \
               AND operation.keyName = ?3 \
             ORDER BY operation.operationIndex;",
        )?;
        let rows = statement
            .query_map(params![actor_index, counter, property], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if rows.len() > 1 {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        let Some((payload, action, value_kind, value_text, value_type_code)) = rows.first() else {
            return Ok(None);
        };
        if *action != 1
            || value_kind != "string"
            || value_text.is_some()
            || value_type_code.is_some()
        {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        let value = std::str::from_utf8(payload)
            .map_err(|_| ExternalSqliteStageError::IncompleteStage)?
            .to_string();
        Ok(Some(value))
    };
    let document_id = read_meta_string("documentId")?
        .or(read_meta_string("deviceId")?)
        .unwrap_or_else(|| "unknown".to_string());
    if document_id.is_empty() || document_id.len() > 4_096 {
        return Err(ExternalSqliteStageError::RangeOverflow);
    }

    let mut head_statement =
        transaction.prepare("SELECT hash FROM external_heads ORDER BY hash COLLATE BINARY;")?;
    let heads = head_statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(head_statement);
    if heads.len() as u64 != graph_receipt.head_count {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    let mut hasher = Sha256::new();
    hasher.update(b"library-core-projection-heads-v1");
    for head in &heads {
        hasher.update(b"\n");
        hasher.update(head.as_bytes());
    }
    let source = ProjectionSourceV1 {
        document_id,
        heads_digest: lower_hex(&hasher.finalize()),
        head_count: i64::try_from(heads.len())
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        storage_generation,
        storage_save_revision,
    };
    transaction.commit()?;
    Ok(source)
}

fn materialize_current_operations(
    connection: &mut Connection,
) -> StageResult<ExternalCurrentOperationReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let graph_receipt =
        read_graph_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    if graph_content_sha256(&transaction)? != graph_receipt.graph_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let stored_receipt = read_current_operation_receipt(&transaction)?;
    if stored_receipt.is_none() {
        let existing_count = transaction.query_row(
            "SELECT COUNT(*) FROM external_current_operations;",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        if existing_count != 0 {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.execute(
            "INSERT INTO external_current_operations (operationIndex) \
             SELECT operationIndex FROM external_operations AS operation \
             WHERE operation.action != 5 \
               AND NOT EXISTS (\
                 SELECT 1 \
                 FROM external_operation_successors AS edge \
                 LEFT JOIN external_operations AS successor \
                   ON successor.idActorIndex = edge.actorIndex \
                  AND successor.idCounter = edge.counter \
                 WHERE edge.operationIndex = operation.operationIndex \
                   AND (successor.operationIndex IS NULL OR successor.action != 5)\
             ) \
             ORDER BY operationIndex;",
            [],
        )?;
    }

    validate_current_operation_set(&transaction)?;
    let current_operation_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_current_operations;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let receipt = ExternalCurrentOperationReceipt {
        graph_sha256: graph_receipt.graph_sha256,
        current_operation_count: u64::try_from(current_operation_count)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        current_operations_sha256: current_operations_sha256(&transaction)?,
    };
    if let Some(stored) = stored_receipt {
        if stored != receipt {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    insert_current_operation_receipt(&transaction, &receipt)?;
    transaction.commit()?;
    Ok(receipt)
}

fn materialize_resolved_values(
    connection: &mut Connection,
) -> StageResult<ExternalResolvedValueReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let graph_receipt =
        read_graph_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    if graph_content_sha256(&transaction)? != graph_receipt.graph_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    let current_receipt = read_current_operation_receipt(&transaction)?
        .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    validate_current_operation_set(&transaction)?;
    if current_receipt.graph_sha256 != graph_receipt.graph_sha256
        || current_operations_sha256(&transaction)? != current_receipt.current_operations_sha256
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    validate_increment_operations(&transaction)?;

    let stored_receipt = read_resolved_value_receipt(&transaction)?;
    let existing_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_resolved_values;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if stored_receipt.is_none() && existing_count != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    if stored_receipt.is_none() {
        populate_resolved_value_winners(&transaction)?;
    }
    materialize_or_validate_counter_values(&transaction, stored_receipt.is_some())?;
    validate_resolved_value_set(&transaction)?;

    let (resolved_value_count, winner_count) = transaction.query_row(
        "SELECT COUNT(*), COALESCE(SUM(isWinner), 0) FROM external_resolved_values;",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let receipt = ExternalResolvedValueReceipt {
        graph_sha256: graph_receipt.graph_sha256,
        current_operations_sha256: current_receipt.current_operations_sha256,
        resolved_value_count: u64::try_from(resolved_value_count)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        winner_count: u64::try_from(winner_count)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        resolved_values_sha256: resolved_values_sha256(&transaction)?,
    };
    if let Some(stored) = stored_receipt {
        if stored != receipt {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    insert_resolved_value_receipt(&transaction, &receipt)?;
    transaction.commit()?;
    Ok(receipt)
}

fn materialize_sequence_elements(
    connection: &mut Connection,
) -> StageResult<ExternalSequenceElementReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let graph_receipt =
        read_graph_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    if graph_content_sha256(&transaction)? != graph_receipt.graph_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    let resolved_receipt = read_resolved_value_receipt(&transaction)?
        .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    validate_resolved_value_set(&transaction)?;
    materialize_or_validate_counter_values(&transaction, true)?;
    if resolved_receipt.graph_sha256 != graph_receipt.graph_sha256
        || resolved_values_sha256(&transaction)? != resolved_receipt.resolved_values_sha256
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    validate_sequence_insert_graph(&transaction)?;

    let stored_receipt = read_sequence_element_receipt(&transaction)?;
    let existing_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_sequence_elements;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if stored_receipt.is_none() && existing_count != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let (sequence_object_count, sequence_element_count) =
        walk_sequence_elements(&transaction, stored_receipt.is_some())?;
    validate_sequence_element_set(&transaction)?;
    let receipt = ExternalSequenceElementReceipt {
        graph_sha256: graph_receipt.graph_sha256,
        resolved_values_sha256: resolved_receipt.resolved_values_sha256,
        sequence_object_count,
        sequence_element_count,
        sequence_elements_sha256: sequence_elements_sha256(&transaction)?,
    };
    if let Some(stored) = stored_receipt {
        if stored != receipt {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    insert_sequence_element_receipt(&transaction, &receipt)?;
    transaction.commit()?;
    Ok(receipt)
}

fn materialize_feed_item_nodes(
    connection: &mut Connection,
) -> StageResult<ExternalFeedItemNodeReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let graph_receipt =
        read_graph_receipt(&transaction)?.ok_or(ExternalSqliteStageError::IncompleteStage)?;
    if graph_content_sha256(&transaction)? != graph_receipt.graph_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    let resolved_receipt = read_resolved_value_receipt(&transaction)?
        .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    let sequence_receipt = read_sequence_element_receipt(&transaction)?
        .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    validate_resolved_value_set(&transaction)?;
    materialize_or_validate_counter_values(&transaction, true)?;
    validate_sequence_element_set(&transaction)?;
    if resolved_receipt.graph_sha256 != graph_receipt.graph_sha256
        || sequence_receipt.graph_sha256 != graph_receipt.graph_sha256
        || sequence_receipt.resolved_values_sha256 != resolved_receipt.resolved_values_sha256
        || resolved_values_sha256(&transaction)? != resolved_receipt.resolved_values_sha256
        || sequence_elements_sha256(&transaction)? != sequence_receipt.sequence_elements_sha256
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    build_expected_feed_item_nodes(&transaction)?;
    let stored_receipt = read_feed_item_node_receipt(&transaction)?;
    let stored_entity_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_feed_item_entities;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let stored_node_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_feed_item_nodes;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if stored_receipt.is_none() {
        if stored_entity_count != 0 || stored_node_count != 0 {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.execute(
            "INSERT INTO external_feed_item_entities (entityOperationIndex, globalId) \
             SELECT entityOperationIndex, globalId \
             FROM temp.external_expected_feed_item_entities \
             ORDER BY entityOperationIndex;",
            [],
        )?;
        transaction.execute(
            "INSERT INTO external_feed_item_nodes (\
             valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
             depth, segmentKind, propertyName, sequenceOrdinal) \
             SELECT valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
                    depth, segmentKind, propertyName, sequenceOrdinal \
             FROM temp.external_expected_feed_item_nodes \
             ORDER BY valueOperationIndex;",
            [],
        )?;
    }
    validate_feed_item_node_set(&transaction)?;

    let (feed_item_count, feed_item_node_count) = transaction.query_row(
        "SELECT \
           (SELECT COUNT(*) FROM external_feed_item_entities), \
           (SELECT COUNT(*) FROM external_feed_item_nodes);",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let receipt = ExternalFeedItemNodeReceipt {
        graph_sha256: graph_receipt.graph_sha256,
        resolved_values_sha256: resolved_receipt.resolved_values_sha256,
        sequence_elements_sha256: sequence_receipt.sequence_elements_sha256,
        feed_item_count: u64::try_from(feed_item_count)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        feed_item_node_count: u64::try_from(feed_item_node_count)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        feed_item_nodes_sha256: feed_item_nodes_sha256(&transaction)?,
    };
    if let Some(stored) = stored_receipt {
        if stored != receipt {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    insert_feed_item_node_receipt(&transaction, &receipt)?;
    transaction.commit()?;
    Ok(receipt)
}

fn materialize_feed_item_documents(
    connection: &mut Connection,
) -> StageResult<ExternalFeedItemDocumentReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let node_receipt = read_feed_item_node_receipt(&transaction)?
        .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    build_expected_feed_item_nodes(&transaction)?;
    validate_feed_item_node_set(&transaction)?;
    if feed_item_nodes_sha256(&transaction)? != node_receipt.feed_item_nodes_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    build_expected_feed_item_documents(&transaction)?;
    let stored_receipt = read_feed_item_document_receipt(&transaction)?;
    let stored_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_feed_item_documents;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if stored_receipt.is_none() {
        if stored_count != 0 {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.execute(
            "INSERT INTO external_feed_item_documents (\
             entityOperationIndex, globalId, jsonText, jsonByteLength, jsonSha256) \
             SELECT entityOperationIndex, globalId, jsonText, jsonByteLength, jsonSha256 \
             FROM temp.external_expected_feed_item_documents \
             ORDER BY entityOperationIndex;",
            [],
        )?;
    }
    validate_feed_item_document_set(&transaction)?;

    let (feed_item_count, json_byte_length) = transaction.query_row(
        "SELECT COUNT(*), COALESCE(SUM(jsonByteLength), 0) \
         FROM external_feed_item_documents;",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let receipt = ExternalFeedItemDocumentReceipt {
        feed_item_nodes_sha256: node_receipt.feed_item_nodes_sha256,
        feed_item_count: u64::try_from(feed_item_count)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        json_byte_length: u64::try_from(json_byte_length)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        feed_item_documents_sha256: feed_item_documents_sha256(&transaction)?,
    };
    if let Some(stored) = stored_receipt {
        if stored != receipt {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    insert_feed_item_document_receipt(&transaction, &receipt)?;
    transaction.commit()?;
    Ok(receipt)
}

pub(super) fn materialize_feed_item_projection(
    connection: &mut Connection,
) -> StageResult<ExternalFeedItemProjectionReceipt> {
    materialize_current_operations(connection)?;
    materialize_resolved_values(connection)?;
    materialize_sequence_elements(connection)?;
    materialize_feed_item_nodes(connection)?;
    materialize_feed_item_documents(connection)?;
    materialize_feed_item_projection_rows(connection)
}

fn materialize_feed_item_projection_rows(
    connection: &mut Connection,
) -> StageResult<ExternalFeedItemProjectionReceipt> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let document_receipt = read_feed_item_document_receipt(&transaction)?
        .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    build_expected_feed_item_nodes(&transaction)?;
    validate_feed_item_node_set(&transaction)?;
    build_expected_feed_item_documents(&transaction)?;
    validate_feed_item_document_set(&transaction)?;
    if feed_item_documents_sha256(&transaction)? != document_receipt.feed_item_documents_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let stored_receipt = read_feed_item_projection_receipt(&transaction)?;
    let stored_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_feed_item_projection_rows;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if stored_receipt.is_none() {
        if stored_count != 0 {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        populate_feed_item_projection_rows(&transaction)?;
    }
    validate_feed_item_projection_row_set(&transaction)?;

    let feed_item_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_feed_item_projection_rows;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let receipt = ExternalFeedItemProjectionReceipt {
        feed_item_documents_sha256: document_receipt.feed_item_documents_sha256,
        feed_item_count: u64::try_from(feed_item_count)
            .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        feed_item_projection_rows_sha256: feed_item_projection_rows_sha256(&transaction)?,
    };
    if let Some(stored) = stored_receipt {
        if stored != receipt {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.commit()?;
        return Ok(receipt);
    }
    insert_feed_item_projection_receipt(&transaction, &receipt)?;
    transaction.commit()?;
    Ok(receipt)
}

pub(super) fn open_feed_item_projection_snapshot(
    connection: &mut Connection,
) -> StageResult<ExternalFeedItemProjectionSnapshot<'_>> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    initialize_or_validate_schema(&transaction)?;
    let receipt = read_feed_item_projection_receipt(&transaction)?
        .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    validate_feed_item_projection_row_set(&transaction)?;
    if feed_item_projection_rows_sha256(&transaction)? != receipt.feed_item_projection_rows_sha256 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(ExternalFeedItemProjectionSnapshot {
        transaction,
        receipt,
    })
}

fn populate_feed_item_projection_rows(transaction: &Transaction<'_>) -> StageResult<()> {
    visit_feed_item_documents(transaction, |entity_operation_index, global_id, json| {
        let row = project_feed_item_document(json)?;
        if row.global_id != global_id {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        transaction.execute(
            "INSERT INTO external_feed_item_projection_rows (\
             entityOperationIndex, globalId, platform, contentType, publishedAt, capturedAt, \
             authorId, authorDisplayName, authorHandle, sourceUrl, hidden, saved, archived, \
             readAt, archivedAt, likedAt, tags, contentBlob, preservedBlob, rest, sortAt) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, \
                     ?16, ?17, ?18, ?19, ?20, ?21);",
            params![
                entity_operation_index,
                row.global_id,
                row.platform,
                row.content_type,
                row.published_at,
                row.captured_at,
                row.author_id,
                row.author_display_name,
                row.author_handle,
                row.source_url,
                row.hidden,
                row.saved,
                row.archived,
                row.read_at,
                row.archived_at,
                row.liked_at,
                row.tags,
                row.content_blob,
                row.preserved_blob,
                row.rest,
                row.sort_key(),
            ],
        )?;
        Ok(())
    })
}

fn validate_feed_item_projection_row_set(transaction: &Transaction<'_>) -> StageResult<()> {
    let (document_count, projection_count) = transaction.query_row(
        "SELECT \
           (SELECT COUNT(*) FROM external_feed_item_documents), \
           (SELECT COUNT(*) FROM external_feed_item_projection_rows);",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if document_count != projection_count {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    visit_feed_item_documents(transaction, |entity_operation_index, global_id, json| {
        let expected = project_feed_item_document(json)?;
        if expected.global_id != global_id {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        let actual = transaction
            .query_row(
                "SELECT globalId, platform, contentType, publishedAt, capturedAt, authorId, \
                        authorDisplayName, authorHandle, sourceUrl, hidden, saved, archived, \
                        readAt, archivedAt, likedAt, tags, contentBlob, preservedBlob, rest \
                 FROM external_feed_item_projection_rows WHERE entityOperationIndex = ?1;",
                [entity_operation_index],
                |row| {
                    Ok(FeedItemRow {
                        global_id: row.get(0)?,
                        platform: row.get(1)?,
                        content_type: row.get(2)?,
                        published_at: row.get(3)?,
                        captured_at: row.get(4)?,
                        author_id: row.get(5)?,
                        author_display_name: row.get(6)?,
                        author_handle: row.get(7)?,
                        source_url: row.get(8)?,
                        hidden: row.get(9)?,
                        saved: row.get(10)?,
                        archived: row.get(11)?,
                        read_at: row.get(12)?,
                        archived_at: row.get(13)?,
                        liked_at: row.get(14)?,
                        tags: row.get(15)?,
                        content_blob: row.get(16)?,
                        preserved_blob: row.get(17)?,
                        rest: row.get(18)?,
                    })
                },
            )
            .optional()?
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        if actual != expected {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        Ok(())
    })?;
    if foreign_key_check_has_row(
        transaction,
        "PRAGMA foreign_key_check(external_feed_item_projection_rows);",
    )? {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn read_feed_item_projection_row(row: &Row<'_>, offset: usize) -> rusqlite::Result<FeedItemRow> {
    Ok(FeedItemRow {
        global_id: row.get(offset)?,
        platform: row.get(offset + 1)?,
        content_type: row.get(offset + 2)?,
        published_at: row.get(offset + 3)?,
        captured_at: row.get(offset + 4)?,
        author_id: row.get(offset + 5)?,
        author_display_name: row.get(offset + 6)?,
        author_handle: row.get(offset + 7)?,
        source_url: row.get(offset + 8)?,
        hidden: row.get(offset + 9)?,
        saved: row.get(offset + 10)?,
        archived: row.get(offset + 11)?,
        read_at: row.get(offset + 12)?,
        archived_at: row.get(offset + 13)?,
        liked_at: row.get(offset + 14)?,
        tags: row.get(offset + 15)?,
        content_blob: row.get(offset + 16)?,
        preserved_blob: row.get(offset + 17)?,
        rest: row.get(offset + 18)?,
    })
}

fn visit_feed_item_documents(
    transaction: &Transaction<'_>,
    mut visitor: impl FnMut(i64, &str, &str) -> StageResult<()>,
) -> StageResult<()> {
    let mut after_entity_operation_index = -1_i64;
    let mut statement = transaction.prepare(
        "SELECT entityOperationIndex, globalId, jsonText \
         FROM external_feed_item_documents \
         WHERE entityOperationIndex > ?1 \
         ORDER BY entityOperationIndex LIMIT 1;",
    )?;
    loop {
        let document = statement
            .query_row([after_entity_operation_index], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .optional()?;
        let Some((entity_operation_index, global_id, json)) = document else {
            break;
        };
        visitor(entity_operation_index, &global_id, &json)?;
        after_entity_operation_index = entity_operation_index;
    }
    Ok(())
}

fn configure_connection(connection: &Connection) -> StageResult<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    // Winner selection may sort a source-sized operation set. Force SQLite to
    // spill that work to disk instead of turning migration into a second
    // whole-library resident copy.
    connection.pragma_update(None, "temp_store", "FILE")?;
    connection.pragma_update(None, "cache_size", -4_096_i64)?;
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

fn read_graph_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalGraphStageReceipt>> {
    transaction
        .query_row(
            "SELECT sourceByteLength, sourceSha256, actorCount, headCount, changeCount, \
             dependencyCount, operationCount, successorCount, omittedDeleteCount, graphSha256 \
             FROM external_graph_stage_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalGraphStageReceipt {
                    source_byte_length: row.get::<_, i64>(0)? as u64,
                    source_sha256: row.get(1)?,
                    actor_count: row.get::<_, i64>(2)? as u64,
                    head_count: row.get::<_, i64>(3)? as u64,
                    change_count: row.get::<_, i64>(4)? as u64,
                    dependency_count: row.get::<_, i64>(5)? as u64,
                    operation_count: row.get::<_, i64>(6)? as u64,
                    successor_count: row.get::<_, i64>(7)? as u64,
                    omitted_delete_count: row.get::<_, i64>(8)? as u64,
                    graph_sha256: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::Sql)
}

fn insert_graph_receipt(
    transaction: &Transaction<'_>,
    receipt: &ExternalGraphStageReceipt,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_graph_stage_receipt (\
         singleton, sourceByteLength, sourceSha256, actorCount, headCount, changeCount, \
         dependencyCount, operationCount, successorCount, omittedDeleteCount, graphSha256) \
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
        params![
            i64::try_from(receipt.source_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.source_sha256,
            i64::try_from(receipt.actor_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.head_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.change_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.dependency_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.operation_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.successor_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.omitted_delete_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.graph_sha256,
        ],
    )?;
    Ok(())
}

fn read_current_operation_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalCurrentOperationReceipt>> {
    transaction
        .query_row(
            "SELECT graphSha256, currentOperationCount, currentOperationsSha256 \
             FROM external_current_operation_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalCurrentOperationReceipt {
                    graph_sha256: row.get(0)?,
                    current_operation_count: row.get::<_, i64>(1)? as u64,
                    current_operations_sha256: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::from)
}

fn insert_current_operation_receipt(
    transaction: &Transaction<'_>,
    receipt: &ExternalCurrentOperationReceipt,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_current_operation_receipt (\
         singleton, graphSha256, currentOperationCount, currentOperationsSha256) \
         VALUES (1, ?1, ?2, ?3);",
        params![
            receipt.graph_sha256,
            i64::try_from(receipt.current_operation_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.current_operations_sha256,
        ],
    )?;
    Ok(())
}

fn read_resolved_value_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalResolvedValueReceipt>> {
    transaction
        .query_row(
            "SELECT graphSha256, currentOperationsSha256, resolvedValueCount, \
                    winnerCount, resolvedValuesSha256 \
             FROM external_resolved_value_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalResolvedValueReceipt {
                    graph_sha256: row.get(0)?,
                    current_operations_sha256: row.get(1)?,
                    resolved_value_count: row.get::<_, i64>(2)? as u64,
                    winner_count: row.get::<_, i64>(3)? as u64,
                    resolved_values_sha256: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::from)
}

fn insert_resolved_value_receipt(
    transaction: &Transaction<'_>,
    receipt: &ExternalResolvedValueReceipt,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_resolved_value_receipt (\
         singleton, graphSha256, currentOperationsSha256, resolvedValueCount, \
         winnerCount, resolvedValuesSha256) VALUES (1, ?1, ?2, ?3, ?4, ?5);",
        params![
            receipt.graph_sha256,
            receipt.current_operations_sha256,
            i64::try_from(receipt.resolved_value_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.winner_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.resolved_values_sha256,
        ],
    )?;
    Ok(())
}

fn read_sequence_element_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalSequenceElementReceipt>> {
    transaction
        .query_row(
            "SELECT graphSha256, resolvedValuesSha256, sequenceObjectCount, \
                    sequenceElementCount, sequenceElementsSha256 \
             FROM external_sequence_element_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalSequenceElementReceipt {
                    graph_sha256: row.get(0)?,
                    resolved_values_sha256: row.get(1)?,
                    sequence_object_count: row.get::<_, i64>(2)? as u64,
                    sequence_element_count: row.get::<_, i64>(3)? as u64,
                    sequence_elements_sha256: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::from)
}

fn insert_sequence_element_receipt(
    transaction: &Transaction<'_>,
    receipt: &ExternalSequenceElementReceipt,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_sequence_element_receipt (\
         singleton, graphSha256, resolvedValuesSha256, sequenceObjectCount, \
         sequenceElementCount, sequenceElementsSha256) VALUES (1, ?1, ?2, ?3, ?4, ?5);",
        params![
            receipt.graph_sha256,
            receipt.resolved_values_sha256,
            i64::try_from(receipt.sequence_object_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.sequence_element_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.sequence_elements_sha256,
        ],
    )?;
    Ok(())
}

fn read_feed_item_node_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalFeedItemNodeReceipt>> {
    transaction
        .query_row(
            "SELECT graphSha256, resolvedValuesSha256, sequenceElementsSha256, \
                    feedItemCount, feedItemNodeCount, feedItemNodesSha256 \
             FROM external_feed_item_node_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalFeedItemNodeReceipt {
                    graph_sha256: row.get(0)?,
                    resolved_values_sha256: row.get(1)?,
                    sequence_elements_sha256: row.get(2)?,
                    feed_item_count: row.get::<_, i64>(3)? as u64,
                    feed_item_node_count: row.get::<_, i64>(4)? as u64,
                    feed_item_nodes_sha256: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::from)
}

fn insert_feed_item_node_receipt(
    transaction: &Transaction<'_>,
    receipt: &ExternalFeedItemNodeReceipt,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_feed_item_node_receipt (\
         singleton, graphSha256, resolvedValuesSha256, sequenceElementsSha256, \
         feedItemCount, feedItemNodeCount, feedItemNodesSha256) \
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6);",
        params![
            receipt.graph_sha256,
            receipt.resolved_values_sha256,
            receipt.sequence_elements_sha256,
            i64::try_from(receipt.feed_item_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.feed_item_node_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.feed_item_nodes_sha256,
        ],
    )?;
    Ok(())
}

fn read_feed_item_document_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalFeedItemDocumentReceipt>> {
    transaction
        .query_row(
            "SELECT feedItemNodesSha256, feedItemCount, jsonByteLength, \
                    feedItemDocumentsSha256 \
             FROM external_feed_item_document_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalFeedItemDocumentReceipt {
                    feed_item_nodes_sha256: row.get(0)?,
                    feed_item_count: row.get::<_, i64>(1)? as u64,
                    json_byte_length: row.get::<_, i64>(2)? as u64,
                    feed_item_documents_sha256: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::from)
}

fn insert_feed_item_document_receipt(
    transaction: &Transaction<'_>,
    receipt: &ExternalFeedItemDocumentReceipt,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_feed_item_document_receipt (\
         singleton, feedItemNodesSha256, feedItemCount, jsonByteLength, \
         feedItemDocumentsSha256) \
         VALUES (1, ?1, ?2, ?3, ?4);",
        params![
            receipt.feed_item_nodes_sha256,
            i64::try_from(receipt.feed_item_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            i64::try_from(receipt.json_byte_length)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.feed_item_documents_sha256,
        ],
    )?;
    Ok(())
}

fn read_feed_item_projection_receipt(
    transaction: &Transaction<'_>,
) -> StageResult<Option<ExternalFeedItemProjectionReceipt>> {
    transaction
        .query_row(
            "SELECT feedItemDocumentsSha256, feedItemCount, feedItemProjectionRowsSha256 \
             FROM external_feed_item_projection_receipt WHERE singleton = 1;",
            [],
            |row| {
                Ok(ExternalFeedItemProjectionReceipt {
                    feed_item_documents_sha256: row.get(0)?,
                    feed_item_count: row.get::<_, i64>(1)? as u64,
                    feed_item_projection_rows_sha256: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(ExternalSqliteStageError::from)
}

fn insert_feed_item_projection_receipt(
    transaction: &Transaction<'_>,
    receipt: &ExternalFeedItemProjectionReceipt,
) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_feed_item_projection_receipt (\
         singleton, feedItemDocumentsSha256, feedItemCount, feedItemProjectionRowsSha256) \
         VALUES (1, ?1, ?2, ?3);",
        params![
            receipt.feed_item_documents_sha256,
            i64::try_from(receipt.feed_item_count)
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
            receipt.feed_item_projection_rows_sha256,
        ],
    )?;
    Ok(())
}

fn validate_layout_counts(
    transaction: &Transaction<'_>,
    receipt: &ExternalLayoutStageReceipt,
) -> StageResult<()> {
    let mut actor_statement =
        transaction.prepare("SELECT actorIndex FROM external_actors ORDER BY actorIndex;")?;
    let mut actor_rows = actor_statement.query([])?;
    let mut expected_actor_index = 0_u64;
    while let Some(row) = actor_rows.next()? {
        let actual = u64::try_from(row.get::<_, i64>(0)?)
            .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
        if actual != expected_actor_index {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        expected_actor_index = expected_actor_index
            .checked_add(1)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    }
    if expected_actor_index != receipt.actor_count {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let mut head_statement =
        transaction.prepare("SELECT headIndex FROM external_heads ORDER BY headIndex;")?;
    let mut head_rows = head_statement.query([])?;
    let mut expected_head_index = 0_u64;
    while let Some(row) = head_rows.next()? {
        let actual = u64::try_from(row.get::<_, i64>(0)?)
            .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
        if actual != expected_head_index {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        expected_head_index = expected_head_index
            .checked_add(1)
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    }
    if expected_head_index != receipt.head_count {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn stage_or_validate_omitted_deletes(
    transaction: &Transaction<'_>,
    validate_only: bool,
) -> StageResult<u64> {
    let existing_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_omitted_deletes;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if !validate_only && existing_count != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let mut expected_statement = transaction.prepare(
        "SELECT s.actorIndex, s.counter, \
                p.objectKind, p.objectActorIndex, p.objectCounter, \
                CASE WHEN p.insertFlag = 1 THEN 'element' ELSE p.keyKind END, \
                CASE WHEN p.insertFlag = 1 THEN NULL ELSE p.keyName END, \
                CASE WHEN p.insertFlag = 1 THEN p.idActorIndex ELSE p.keyActorIndex END, \
                CASE WHEN p.insertFlag = 1 THEN p.idCounter ELSE p.keyCounter END \
         FROM external_operation_successors AS s \
         JOIN external_operations AS p ON p.operationIndex = s.operationIndex \
         LEFT JOIN external_operations AS successor \
           ON successor.idActorIndex = s.actorIndex AND successor.idCounter = s.counter \
         WHERE successor.operationIndex IS NULL \
         ORDER BY s.actorIndex, s.counter, p.operationIndex;",
    )?;
    let mut expected_rows = expected_statement.query([])?;
    let mut previous_id: Option<(i64, Vec<u8>)> = None;
    let mut previous_target: Option<ExternalOperationTarget> = None;
    let mut unique_count = 0_u64;
    while let Some(row) = expected_rows.next()? {
        let actor_index = row.get::<_, i64>(0)?;
        let counter = row.get::<_, Vec<u8>>(1)?;
        let target = ExternalOperationTarget {
            object_kind: row.get(2)?,
            object_actor_index: row.get(3)?,
            object_counter: row.get(4)?,
            key_kind: row.get(5)?,
            key_name: row.get(6)?,
            key_actor_index: row.get(7)?,
            key_counter: row.get(8)?,
        };
        let id = (actor_index, counter.clone());
        if previous_id.as_ref() == Some(&id) {
            if previous_target.as_ref() != Some(&target) {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            continue;
        }

        unique_count = unique_count
            .checked_add(1)
            .ok_or(ExternalSqliteStageError::RangeOverflow)?;
        if validate_only {
            let stored = transaction
                .query_row(
                    "SELECT objectKind, objectActorIndex, objectCounter, keyKind, keyName, \
                            keyActorIndex, keyCounter \
                     FROM external_omitted_deletes WHERE actorIndex = ?1 AND counter = ?2;",
                    params![actor_index, counter],
                    |stored| {
                        Ok(ExternalOperationTarget {
                            object_kind: stored.get(0)?,
                            object_actor_index: stored.get(1)?,
                            object_counter: stored.get(2)?,
                            key_kind: stored.get(3)?,
                            key_name: stored.get(4)?,
                            key_actor_index: stored.get(5)?,
                            key_counter: stored.get(6)?,
                        })
                    },
                )
                .optional()?;
            if stored.as_ref() != Some(&target) {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
        } else {
            transaction.execute(
                "INSERT INTO external_omitted_deletes (\
                 actorIndex, counter, objectKind, objectActorIndex, objectCounter, \
                 keyKind, keyName, keyActorIndex, keyCounter) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9);",
                params![
                    actor_index,
                    counter,
                    target.object_kind,
                    target.object_actor_index,
                    target.object_counter,
                    target.key_kind,
                    target.key_name,
                    target.key_actor_index,
                    target.key_counter,
                ],
            )?;
        }
        previous_id = Some(id);
        previous_target = Some(target);
    }

    let actual_count = transaction.query_row(
        "SELECT COUNT(*) FROM external_omitted_deletes;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if u64::try_from(actual_count).ok() != Some(unique_count) {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    if foreign_key_check_has_row(
        transaction,
        "PRAGMA foreign_key_check(external_omitted_deletes);",
    )? {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(unique_count)
}

fn validate_successor_graph(transaction: &Transaction<'_>) -> StageResult<()> {
    let invalid_operation = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 FROM external_operations \
           WHERE action = 3 \
              OR (insertFlag = 1 AND keyKind = 'property') \
              OR (insertFlag = 0 AND keyKind = 'head')\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if invalid_operation != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let non_lamport_successor = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_operation_successors AS s \
           JOIN external_operations AS predecessor ON predecessor.operationIndex = s.operationIndex \
           JOIN external_actors AS predecessorActor \
             ON predecessorActor.actorIndex = predecessor.idActorIndex \
           JOIN external_actors AS successorActor ON successorActor.actorIndex = s.actorIndex \
           WHERE NOT (\
             s.counter > predecessor.idCounter OR \
             (s.counter = predecessor.idCounter AND successorActor.actorId > predecessorActor.actorId)\
           )\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if non_lamport_successor != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let mismatched_explicit_target = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_operation_successors AS edge \
           JOIN external_operations AS predecessor \
             ON predecessor.operationIndex = edge.operationIndex \
           JOIN external_operations AS successor \
             ON successor.idActorIndex = edge.actorIndex AND successor.idCounter = edge.counter \
           WHERE predecessor.objectKind IS NOT successor.objectKind \
              OR predecessor.objectActorIndex IS NOT successor.objectActorIndex \
              OR predecessor.objectCounter IS NOT successor.objectCounter \
              OR (CASE WHEN predecessor.insertFlag = 1 THEN 'element' ELSE predecessor.keyKind END) \
                   IS NOT \
                 (CASE WHEN successor.insertFlag = 1 THEN 'element' ELSE successor.keyKind END) \
              OR (CASE WHEN predecessor.insertFlag = 1 THEN NULL ELSE predecessor.keyName END) \
                   IS NOT \
                 (CASE WHEN successor.insertFlag = 1 THEN NULL ELSE successor.keyName END) \
              OR (CASE WHEN predecessor.insertFlag = 1 \
                       THEN predecessor.idActorIndex ELSE predecessor.keyActorIndex END) \
                   IS NOT \
                 (CASE WHEN successor.insertFlag = 1 \
                       THEN successor.idActorIndex ELSE successor.keyActorIndex END) \
              OR (CASE WHEN predecessor.insertFlag = 1 \
                       THEN predecessor.idCounter ELSE predecessor.keyCounter END) \
                   IS NOT \
                 (CASE WHEN successor.insertFlag = 1 \
                       THEN successor.idCounter ELSE successor.keyCounter END)\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if mismatched_explicit_target != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn validate_current_operation_set(transaction: &Transaction<'_>) -> StageResult<()> {
    let mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT operationIndex FROM external_current_operations \
           EXCEPT \
           SELECT operationIndex FROM external_operations AS operation \
           WHERE operation.action != 5 \
             AND NOT EXISTS (\
               SELECT 1 \
               FROM external_operation_successors AS edge \
               LEFT JOIN external_operations AS successor \
                 ON successor.idActorIndex = edge.actorIndex \
                AND successor.idCounter = edge.counter \
               WHERE edge.operationIndex = operation.operationIndex \
                 AND (successor.operationIndex IS NULL OR successor.action != 5)\
             )\
         ) OR EXISTS(\
           SELECT operationIndex FROM external_operations AS operation \
           WHERE operation.action != 5 \
             AND NOT EXISTS (\
               SELECT 1 \
               FROM external_operation_successors AS edge \
               LEFT JOIN external_operations AS successor \
                 ON successor.idActorIndex = edge.actorIndex \
                AND successor.idCounter = edge.counter \
               WHERE edge.operationIndex = operation.operationIndex \
                 AND (successor.operationIndex IS NULL OR successor.action != 5)\
             ) \
           EXCEPT \
           SELECT operationIndex FROM external_current_operations\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if mismatch != 0
        || foreign_key_check_has_row(
            transaction,
            "PRAGMA foreign_key_check(external_current_operations);",
        )?
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn validate_increment_operations(transaction: &Transaction<'_>) -> StageResult<()> {
    let invalid_shape = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_operations AS increment \
           WHERE increment.action = 5 \
             AND (\
               increment.insertFlag != 0 \
               OR increment.valueKind NOT IN ('signed', 'unsigned') \
               OR increment.valueText IS NULL \
               OR length(increment.valuePayload) != 0 \
               OR NOT EXISTS (\
                 SELECT 1 \
                 FROM external_operation_successors AS edge \
                 WHERE edge.actorIndex = increment.idActorIndex \
                   AND edge.counter = increment.idCounter\
               ) \
               OR EXISTS (\
                 SELECT 1 \
                 FROM external_operation_successors AS edge \
                 JOIN external_operations AS predecessor \
                   ON predecessor.operationIndex = edge.operationIndex \
                 WHERE edge.actorIndex = increment.idActorIndex \
                   AND edge.counter = increment.idCounter \
                   AND (predecessor.action != 1 OR predecessor.valueKind != 'counter')\
               )\
             )\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if invalid_shape != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let mut statement = transaction.prepare(
        "SELECT valueKind, valueText FROM external_operations \
         WHERE action = 5 ORDER BY operationIndex;",
    )?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        parse_increment(
            row.get::<_, String>(0)?.as_str(),
            row.get::<_, String>(1)?.as_str(),
        )?;
    }
    Ok(())
}

fn populate_resolved_value_winners(transaction: &Transaction<'_>) -> StageResult<()> {
    transaction.execute(
        "INSERT INTO external_resolved_values \
         (operationIndex, isWinner, resolvedCounterText) \
         SELECT operationIndex, CASE WHEN winnerRank = 1 THEN 1 ELSE 0 END, NULL \
         FROM (\
           SELECT operation.operationIndex, \
                  ROW_NUMBER() OVER (\
                    PARTITION BY \
                      operation.objectKind, operation.objectActorIndex, \
                      operation.objectCounter, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN 'element' ELSE operation.keyKind END, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN NULL ELSE operation.keyName END, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN operation.idActorIndex ELSE operation.keyActorIndex END, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN operation.idCounter ELSE operation.keyCounter END \
                    ORDER BY operation.idCounter DESC, actor.actorId COLLATE BINARY DESC\
                  ) AS winnerRank \
           FROM external_current_operations AS current \
           JOIN external_operations AS operation USING (operationIndex) \
           JOIN external_actors AS actor \
             ON actor.actorIndex = operation.idActorIndex\
         ) \
         ORDER BY operationIndex;",
        [],
    )?;
    Ok(())
}

fn materialize_or_validate_counter_values(
    transaction: &Transaction<'_>,
    validate_only: bool,
) -> StageResult<()> {
    const PAGE_SIZE: i64 = 256;
    let mut after_operation_index = -1_i64;
    loop {
        let page = {
            let mut statement = transaction.prepare(
                "SELECT current.operationIndex \
                 FROM external_current_operations AS current \
                 JOIN external_operations AS operation USING (operationIndex) \
                 WHERE current.operationIndex > ?1 AND operation.valueKind = 'counter' \
                 ORDER BY current.operationIndex LIMIT ?2;",
            )?;
            let rows = statement.query_map(params![after_operation_index, PAGE_SIZE], |row| {
                row.get::<_, i64>(0)
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        if page.is_empty() {
            break;
        }
        for operation_index in &page {
            let expected = resolved_counter_text(transaction, *operation_index)?
                .ok_or(ExternalSqliteStageError::IncompleteStage)?;
            if validate_only {
                let stored = transaction
                    .query_row(
                        "SELECT resolvedCounterText FROM external_resolved_values \
                         WHERE operationIndex = ?1;",
                        [operation_index],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .optional()?;
                if stored != Some(Some(expected)) {
                    return Err(ExternalSqliteStageError::IncompleteStage);
                }
            } else {
                let updated = transaction.execute(
                    "UPDATE external_resolved_values SET resolvedCounterText = ?2 \
                     WHERE operationIndex = ?1;",
                    params![operation_index, expected],
                )?;
                if updated != 1 {
                    return Err(ExternalSqliteStageError::IncompleteStage);
                }
            }
        }
        after_operation_index = *page
            .last()
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
    }
    Ok(())
}

fn resolved_counter_text(
    transaction: &Transaction<'_>,
    operation_index: i64,
) -> StageResult<Option<String>> {
    let (action, value_kind, value_text) = transaction.query_row(
        "SELECT action, valueKind, valueText FROM external_operations \
         WHERE operationIndex = ?1;",
        [operation_index],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        },
    )?;
    if value_kind != "counter" {
        return Ok(None);
    }
    if action != 1 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    let mut value = value_text
        .ok_or(ExternalSqliteStageError::IncompleteStage)?
        .parse::<i64>()
        .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    let mut statement = transaction.prepare(
        "SELECT successor.valueKind, successor.valueText \
         FROM external_operation_successors AS edge \
         JOIN external_operations AS successor \
           ON successor.idActorIndex = edge.actorIndex \
          AND successor.idCounter = edge.counter \
         WHERE edge.operationIndex = ?1 AND successor.action = 5 \
         ORDER BY successor.idCounter, successor.idActorIndex;",
    )?;
    let mut rows = statement.query([operation_index])?;
    while let Some(row) = rows.next()? {
        let kind = row.get::<_, String>(0)?;
        let text = row.get::<_, String>(1)?;
        value = value
            .checked_add(parse_increment(&kind, &text)?)
            .ok_or(ExternalSqliteStageError::RangeOverflow)?;
    }
    Ok(Some(value.to_string()))
}

fn parse_increment(kind: &str, text: &str) -> StageResult<i64> {
    match kind {
        "signed" => text
            .parse::<i64>()
            .map_err(|_| ExternalSqliteStageError::IncompleteStage),
        "unsigned" => {
            let value = text
                .parse::<u64>()
                .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
            i64::try_from(value).map_err(|_| ExternalSqliteStageError::RangeOverflow)
        }
        _ => Err(ExternalSqliteStageError::IncompleteStage),
    }
}

fn validate_resolved_value_set(transaction: &Transaction<'_>) -> StageResult<()> {
    let mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT operationIndex FROM external_resolved_values \
           EXCEPT \
           SELECT operationIndex FROM external_current_operations\
         ) OR EXISTS(\
           SELECT operationIndex FROM external_current_operations \
           EXCEPT \
           SELECT operationIndex FROM external_resolved_values\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let invalid_counter_shape = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_resolved_values AS resolved \
           JOIN external_operations AS operation USING (operationIndex) \
           WHERE (operation.valueKind = 'counter') != \
                 (resolved.resolvedCounterText IS NOT NULL)\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let invalid_winner = transaction.query_row(
        "WITH expected AS (\
           SELECT operation.operationIndex, \
                  CASE WHEN ROW_NUMBER() OVER (\
                    PARTITION BY \
                      operation.objectKind, operation.objectActorIndex, \
                      operation.objectCounter, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN 'element' ELSE operation.keyKind END, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN NULL ELSE operation.keyName END, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN operation.idActorIndex ELSE operation.keyActorIndex END, \
                      CASE WHEN operation.insertFlag = 1 \
                           THEN operation.idCounter ELSE operation.keyCounter END \
                    ORDER BY operation.idCounter DESC, actor.actorId COLLATE BINARY DESC\
                  ) = 1 THEN 1 ELSE 0 END AS isWinner \
           FROM external_current_operations AS current \
           JOIN external_operations AS operation USING (operationIndex) \
           JOIN external_actors AS actor \
             ON actor.actorIndex = operation.idActorIndex\
         ) \
         SELECT EXISTS(\
           SELECT 1 FROM expected \
           JOIN external_resolved_values AS resolved USING (operationIndex) \
           WHERE expected.isWinner != resolved.isWinner\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if mismatch != 0
        || invalid_counter_shape != 0
        || invalid_winner != 0
        || foreign_key_check_has_row(
            transaction,
            "PRAGMA foreign_key_check(external_resolved_values);",
        )?
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn validate_sequence_insert_graph(transaction: &Transaction<'_>) -> StageResult<()> {
    let invalid_insert = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_operations AS child \
           JOIN external_actors AS childActor \
             ON childActor.actorIndex = child.idActorIndex \
           LEFT JOIN external_operations AS objectOperation \
             ON objectOperation.idActorIndex = child.objectActorIndex \
            AND objectOperation.idCounter = child.objectCounter \
           LEFT JOIN external_operations AS anchor \
             ON anchor.idActorIndex = child.keyActorIndex \
            AND anchor.idCounter = child.keyCounter \
           LEFT JOIN external_actors AS anchorActor \
             ON anchorActor.actorIndex = anchor.idActorIndex \
           WHERE child.insertFlag = 1 \
             AND (\
               child.objectKind != 'operation' \
               OR objectOperation.action NOT IN (2, 4) \
               OR child.keyKind NOT IN ('head', 'element') \
               OR (child.keyKind = 'element' AND (\
                 anchor.operationIndex IS NULL \
                 OR anchor.insertFlag != 1 \
                 OR anchor.objectKind IS NOT child.objectKind \
                 OR anchor.objectActorIndex IS NOT child.objectActorIndex \
                 OR anchor.objectCounter IS NOT child.objectCounter \
                 OR NOT (\
                   child.idCounter > anchor.idCounter \
                   OR (child.idCounter = anchor.idCounter \
                       AND childActor.actorId > anchorActor.actorId)\
                 )\
               ))\
             )\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if invalid_insert != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn walk_sequence_elements(
    transaction: &Transaction<'_>,
    validate_only: bool,
) -> StageResult<(u64, u64)> {
    const OBJECT_PAGE_SIZE: i64 = 64;
    transaction.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS external_sequence_walk_stack (\
           stackIndex INTEGER PRIMARY KEY CHECK (stackIndex >= 0), \
           operationIndex INTEGER NOT NULL UNIQUE\
         ) STRICT; \
         DELETE FROM external_sequence_walk_stack;",
    )?;

    let mut after_actor_index = -1_i64;
    let mut after_counter = Vec::<u8>::new();
    let mut object_count = 0_u64;
    let mut element_count = 0_u64;
    loop {
        let objects = {
            let mut statement = transaction.prepare(
                "SELECT DISTINCT objectActorIndex, objectCounter \
                 FROM external_operations \
                 WHERE insertFlag = 1 \
                   AND (\
                     ?1 < 0 \
                     OR objectActorIndex > ?1 \
                     OR (objectActorIndex = ?1 AND objectCounter > ?2)\
                   ) \
                 ORDER BY objectActorIndex, objectCounter \
                 LIMIT ?3;",
            )?;
            let rows = statement.query_map(
                params![after_actor_index, after_counter, OBJECT_PAGE_SIZE],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        if objects.is_empty() {
            break;
        }
        for (object_actor_index, object_counter) in &objects {
            transaction.execute("DELETE FROM external_sequence_walk_stack;", [])?;
            push_sequence_children(transaction, *object_actor_index, object_counter, None)?;
            let mut ordinal = 0_i64;
            loop {
                let next = transaction
                    .query_row(
                        "SELECT stackIndex, operationIndex \
                         FROM external_sequence_walk_stack \
                         ORDER BY stackIndex DESC LIMIT 1;",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )
                    .optional()?;
                let Some((stack_index, operation_index)) = next else {
                    break;
                };
                let deleted = transaction.execute(
                    "DELETE FROM external_sequence_walk_stack WHERE stackIndex = ?1;",
                    [stack_index],
                )?;
                if deleted != 1 {
                    return Err(ExternalSqliteStageError::IncompleteStage);
                }
                if validate_only {
                    let stored = transaction
                        .query_row(
                            "SELECT objectActorIndex, objectCounter, sequenceOrdinal \
                             FROM external_sequence_elements \
                             WHERE insertionOperationIndex = ?1;",
                            [operation_index],
                            |row| {
                                Ok((
                                    row.get::<_, i64>(0)?,
                                    row.get::<_, Vec<u8>>(1)?,
                                    row.get::<_, i64>(2)?,
                                ))
                            },
                        )
                        .optional()?;
                    if stored != Some((*object_actor_index, object_counter.clone(), ordinal)) {
                        return Err(ExternalSqliteStageError::IncompleteStage);
                    }
                } else {
                    transaction.execute(
                        "INSERT INTO external_sequence_elements (\
                         objectActorIndex, objectCounter, sequenceOrdinal, \
                         insertionOperationIndex) VALUES (?1, ?2, ?3, ?4);",
                        params![object_actor_index, object_counter, ordinal, operation_index],
                    )?;
                }
                ordinal = ordinal
                    .checked_add(1)
                    .ok_or(ExternalSqliteStageError::RangeOverflow)?;
                push_sequence_children(
                    transaction,
                    *object_actor_index,
                    object_counter,
                    Some(operation_index),
                )?;
            }
            let expected = transaction.query_row(
                "SELECT COUNT(*) FROM external_operations \
                 WHERE insertFlag = 1 AND objectActorIndex = ?1 AND objectCounter = ?2;",
                params![object_actor_index, object_counter],
                |row| row.get::<_, i64>(0),
            )?;
            if ordinal != expected {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            object_count = object_count
                .checked_add(1)
                .ok_or(ExternalSqliteStageError::RangeOverflow)?;
            element_count = element_count
                .checked_add(
                    u64::try_from(ordinal).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
                )
                .ok_or(ExternalSqliteStageError::RangeOverflow)?;
        }
        let (last_actor_index, last_counter) = objects
            .last()
            .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        after_actor_index = *last_actor_index;
        after_counter = last_counter.clone();
    }
    transaction.execute("DELETE FROM external_sequence_walk_stack;", [])?;
    Ok((object_count, element_count))
}

fn push_sequence_children(
    transaction: &Transaction<'_>,
    object_actor_index: i64,
    object_counter: &[u8],
    parent_operation_index: Option<i64>,
) -> StageResult<()> {
    if let Some(parent_operation_index) = parent_operation_index {
        transaction.execute(
            "WITH base AS (\
               SELECT COALESCE(MAX(stackIndex), -1) AS maximum \
               FROM external_sequence_walk_stack\
             ), children AS (\
               SELECT child.operationIndex, \
                      ROW_NUMBER() OVER (\
                        ORDER BY child.idCounter, actor.actorId COLLATE BINARY\
                      ) AS offset \
               FROM external_operations AS parent \
               JOIN external_operations AS child \
                 ON child.keyActorIndex = parent.idActorIndex \
                AND child.keyCounter = parent.idCounter \
               JOIN external_actors AS actor \
                 ON actor.actorIndex = child.idActorIndex \
               WHERE parent.operationIndex = ?1 \
                 AND child.insertFlag = 1 \
                 AND child.objectActorIndex = ?2 \
                 AND child.objectCounter = ?3\
             ) \
             INSERT INTO external_sequence_walk_stack (stackIndex, operationIndex) \
             SELECT base.maximum + children.offset, children.operationIndex \
             FROM base CROSS JOIN children;",
            params![parent_operation_index, object_actor_index, object_counter],
        )?;
    } else {
        transaction.execute(
            "WITH base AS (\
               SELECT COALESCE(MAX(stackIndex), -1) AS maximum \
               FROM external_sequence_walk_stack\
             ), children AS (\
               SELECT child.operationIndex, \
                      ROW_NUMBER() OVER (\
                        ORDER BY child.idCounter, actor.actorId COLLATE BINARY\
                      ) AS offset \
               FROM external_operations AS child \
               JOIN external_actors AS actor \
                 ON actor.actorIndex = child.idActorIndex \
               WHERE child.insertFlag = 1 \
                 AND child.keyKind = 'head' \
                 AND child.objectActorIndex = ?1 \
                 AND child.objectCounter = ?2\
             ) \
             INSERT INTO external_sequence_walk_stack (stackIndex, operationIndex) \
             SELECT base.maximum + children.offset, children.operationIndex \
             FROM base CROSS JOIN children;",
            params![object_actor_index, object_counter],
        )?;
    }
    Ok(())
}

fn validate_sequence_element_set(transaction: &Transaction<'_>) -> StageResult<()> {
    let membership_mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT insertionOperationIndex FROM external_sequence_elements \
           EXCEPT \
           SELECT operationIndex FROM external_operations WHERE insertFlag = 1\
         ) OR EXISTS(\
           SELECT operationIndex FROM external_operations WHERE insertFlag = 1 \
           EXCEPT \
           SELECT insertionOperationIndex FROM external_sequence_elements\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let descriptor_mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_sequence_elements AS element \
           JOIN external_operations AS operation \
             ON operation.operationIndex = element.insertionOperationIndex \
           WHERE operation.objectActorIndex != element.objectActorIndex \
              OR operation.objectCounter != element.objectCounter\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let ordinal_mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_sequence_elements \
           GROUP BY objectActorIndex, objectCounter \
           HAVING MIN(sequenceOrdinal) != 0 \
              OR MAX(sequenceOrdinal) != COUNT(*) - 1\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if membership_mismatch != 0
        || descriptor_mismatch != 0
        || ordinal_mismatch != 0
        || foreign_key_check_has_row(
            transaction,
            "PRAGMA foreign_key_check(external_sequence_elements);",
        )?
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn build_expected_feed_item_nodes(transaction: &Transaction<'_>) -> StageResult<()> {
    transaction.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS external_expected_feed_item_entities (\
           entityOperationIndex INTEGER PRIMARY KEY, \
           globalId TEXT NOT NULL UNIQUE\
         ) STRICT; \
         CREATE TEMP TABLE IF NOT EXISTS external_expected_feed_item_nodes (\
           valueOperationIndex INTEGER PRIMARY KEY, \
           entityOperationIndex INTEGER NOT NULL, \
           parentValueOperationIndex INTEGER, \
           depth INTEGER NOT NULL, \
           segmentKind TEXT NOT NULL, \
           propertyName TEXT, \
           sequenceOrdinal INTEGER, \
           UNIQUE (entityOperationIndex, parentValueOperationIndex, segmentKind, propertyName), \
           UNIQUE (entityOperationIndex, parentValueOperationIndex, segmentKind, sequenceOrdinal)\
         ) STRICT; \
         DELETE FROM temp.external_expected_feed_item_nodes; \
         DELETE FROM temp.external_expected_feed_item_entities;",
    )?;

    let feed_items_root = {
        let mut statement = transaction.prepare(
            "SELECT operation.operationIndex, operation.idActorIndex, \
                    operation.idCounter, operation.action \
             FROM external_resolved_values AS resolved \
             JOIN external_operations AS operation USING (operationIndex) \
             WHERE resolved.isWinner = 1 \
               AND operation.objectKind = 'root' \
               AND operation.keyKind = 'property' \
               AND operation.keyName = 'feedItems' \
             ORDER BY operation.operationIndex;",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let [(feed_items_operation_index, feed_items_actor_index, feed_items_counter, action)] =
        feed_items_root.as_slice()
    else {
        return Err(ExternalSqliteStageError::IncompleteStage);
    };
    if *action != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let invalid_entity = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_resolved_values AS resolved \
           JOIN external_operations AS operation USING (operationIndex) \
           WHERE resolved.isWinner = 1 \
             AND operation.objectKind = 'operation' \
             AND operation.objectActorIndex = ?1 \
             AND operation.objectCounter = ?2 \
             AND (operation.insertFlag != 0 \
               OR operation.keyKind != 'property' \
               OR operation.action != 0 \
               OR length(CAST(operation.keyName AS BLOB)) NOT BETWEEN 1 AND 4096)\
         );",
        params![feed_items_actor_index, feed_items_counter],
        |row| row.get::<_, i64>(0),
    )?;
    if invalid_entity != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    transaction.execute(
        "INSERT INTO temp.external_expected_feed_item_entities \
         (entityOperationIndex, globalId) \
         SELECT operation.operationIndex, operation.keyName \
         FROM external_resolved_values AS resolved \
         JOIN external_operations AS operation USING (operationIndex) \
         WHERE resolved.isWinner = 1 \
           AND operation.objectKind = 'operation' \
           AND operation.objectActorIndex = ?1 \
           AND operation.objectCounter = ?2 \
         ORDER BY operation.operationIndex;",
        params![feed_items_actor_index, feed_items_counter],
    )?;
    transaction.execute(
        "INSERT INTO temp.external_expected_feed_item_nodes (\
         valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
         depth, segmentKind, propertyName, sequenceOrdinal) \
         SELECT entityOperationIndex, entityOperationIndex, NULL, \
                0, 'entity', NULL, NULL \
         FROM temp.external_expected_feed_item_entities \
         ORDER BY entityOperationIndex;",
        [],
    )?;

    for parent_depth in 0..MAX_FEED_ITEM_OBJECT_DEPTH {
        reject_invalid_feed_item_children(transaction, parent_depth)?;
        let map_children = transaction.execute(
            "INSERT INTO temp.external_expected_feed_item_nodes (\
             valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
             depth, segmentKind, propertyName, sequenceOrdinal) \
             SELECT child.operationIndex, parent.entityOperationIndex, \
                    parent.valueOperationIndex, ?1 + 1, 'property', child.keyName, NULL \
             FROM temp.external_expected_feed_item_nodes AS parent \
             JOIN external_operations AS parentOperation \
               ON parentOperation.operationIndex = parent.valueOperationIndex \
             JOIN external_operations AS child \
               ON child.objectKind = 'operation' \
              AND child.objectActorIndex = parentOperation.idActorIndex \
              AND child.objectCounter = parentOperation.idCounter \
             JOIN external_resolved_values AS resolved \
               ON resolved.operationIndex = child.operationIndex \
              AND resolved.isWinner = 1 \
             WHERE parent.depth = ?1 \
               AND parentOperation.action = 0 \
             ORDER BY child.operationIndex;",
            [parent_depth],
        )?;
        let sequence_children = transaction.execute(
            "INSERT INTO temp.external_expected_feed_item_nodes (\
             valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
             depth, segmentKind, propertyName, sequenceOrdinal) \
             SELECT valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
                    ?1 + 1, 'sequence', NULL, visibleOrdinal \
             FROM (\
               SELECT child.operationIndex AS valueOperationIndex, \
                      parent.entityOperationIndex AS entityOperationIndex, \
                      parent.valueOperationIndex AS parentValueOperationIndex, \
                      ROW_NUMBER() OVER (\
                        PARTITION BY parent.valueOperationIndex \
                        ORDER BY sequence.sequenceOrdinal\
                      ) - 1 AS visibleOrdinal \
               FROM temp.external_expected_feed_item_nodes AS parent \
               JOIN external_operations AS parentOperation \
                 ON parentOperation.operationIndex = parent.valueOperationIndex \
               JOIN external_sequence_elements AS sequence \
                 ON sequence.objectActorIndex = parentOperation.idActorIndex \
                AND sequence.objectCounter = parentOperation.idCounter \
               JOIN external_operations AS insertion \
                 ON insertion.operationIndex = sequence.insertionOperationIndex \
               JOIN external_operations AS child \
                 ON child.objectKind = 'operation' \
                AND child.objectActorIndex = parentOperation.idActorIndex \
                AND child.objectCounter = parentOperation.idCounter \
                AND (\
                  (child.insertFlag = 1 \
                    AND child.idActorIndex = insertion.idActorIndex \
                    AND child.idCounter = insertion.idCounter) \
                  OR \
                  (child.insertFlag = 0 AND child.keyKind = 'element' \
                    AND child.keyActorIndex = insertion.idActorIndex \
                    AND child.keyCounter = insertion.idCounter)\
                ) \
               JOIN external_resolved_values AS resolved \
                 ON resolved.operationIndex = child.operationIndex \
                AND resolved.isWinner = 1 \
               WHERE parent.depth = ?1 \
                 AND parentOperation.action IN (2, 4)\
             ) \
             ORDER BY valueOperationIndex;",
            [parent_depth],
        )?;
        if map_children == 0 && sequence_children == 0 {
            break;
        }
    }
    reject_feed_item_depth_overflow(transaction)?;
    validate_expected_feed_item_nodes(transaction, *feed_items_operation_index)?;
    Ok(())
}

fn reject_invalid_feed_item_children(
    transaction: &Transaction<'_>,
    parent_depth: i64,
) -> StageResult<()> {
    let invalid = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM temp.external_expected_feed_item_nodes AS parent \
           JOIN external_operations AS parentOperation \
             ON parentOperation.operationIndex = parent.valueOperationIndex \
           JOIN external_operations AS child \
             ON child.objectKind = 'operation' \
            AND child.objectActorIndex = parentOperation.idActorIndex \
            AND child.objectCounter = parentOperation.idCounter \
           JOIN external_resolved_values AS resolved \
             ON resolved.operationIndex = child.operationIndex \
            AND resolved.isWinner = 1 \
           WHERE parent.depth = ?1 \
             AND (\
               (parentOperation.action = 0 \
                 AND (child.insertFlag != 0 OR child.keyKind != 'property')) \
               OR \
               (parentOperation.action IN (2, 4) \
                 AND NOT EXISTS (\
                   SELECT 1 \
                   FROM external_sequence_elements AS sequence \
                   JOIN external_operations AS insertion \
                     ON insertion.operationIndex = sequence.insertionOperationIndex \
                   WHERE sequence.objectActorIndex = parentOperation.idActorIndex \
                     AND sequence.objectCounter = parentOperation.idCounter \
                     AND (\
                       (child.insertFlag = 1 \
                         AND child.idActorIndex = insertion.idActorIndex \
                         AND child.idCounter = insertion.idCounter) \
                       OR \
                       (child.insertFlag = 0 AND child.keyKind = 'element' \
                         AND child.keyActorIndex = insertion.idActorIndex \
                         AND child.keyCounter = insertion.idCounter)\
                     )\
                 )) \
               OR \
               (parentOperation.action NOT IN (0, 2, 4))\
             )\
         );",
        [parent_depth],
        |row| row.get::<_, i64>(0),
    )?;
    if invalid != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn reject_feed_item_depth_overflow(transaction: &Transaction<'_>) -> StageResult<()> {
    let overflow = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM temp.external_expected_feed_item_nodes AS parent \
           JOIN external_operations AS parentOperation \
             ON parentOperation.operationIndex = parent.valueOperationIndex \
           JOIN external_operations AS child \
             ON child.objectKind = 'operation' \
            AND child.objectActorIndex = parentOperation.idActorIndex \
            AND child.objectCounter = parentOperation.idCounter \
           JOIN external_resolved_values AS resolved \
             ON resolved.operationIndex = child.operationIndex \
            AND resolved.isWinner = 1 \
           WHERE parent.depth = ?1\
         );",
        [MAX_FEED_ITEM_OBJECT_DEPTH],
        |row| row.get::<_, i64>(0),
    )?;
    if overflow != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn validate_expected_feed_item_nodes(
    transaction: &Transaction<'_>,
    feed_items_operation_index: i64,
) -> StageResult<()> {
    let entity_mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM temp.external_expected_feed_item_entities AS entity \
           JOIN temp.external_expected_feed_item_nodes AS node \
             ON node.valueOperationIndex = entity.entityOperationIndex \
           JOIN external_operations AS operation \
             ON operation.operationIndex = entity.entityOperationIndex \
           WHERE node.entityOperationIndex != entity.entityOperationIndex \
              OR node.parentValueOperationIndex IS NOT NULL \
              OR node.depth != 0 \
              OR node.segmentKind != 'entity' \
              OR operation.action != 0\
         ) OR EXISTS(\
           SELECT entityOperationIndex \
           FROM temp.external_expected_feed_item_entities \
           EXCEPT \
           SELECT entityOperationIndex \
           FROM temp.external_expected_feed_item_nodes WHERE segmentKind = 'entity'\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let node_mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM temp.external_expected_feed_item_nodes AS node \
           LEFT JOIN temp.external_expected_feed_item_entities AS entity \
             ON entity.entityOperationIndex = node.entityOperationIndex \
           LEFT JOIN temp.external_expected_feed_item_nodes AS parent \
             ON parent.valueOperationIndex = node.parentValueOperationIndex \
           LEFT JOIN external_resolved_values AS resolved \
             ON resolved.operationIndex = node.valueOperationIndex \
           WHERE entity.entityOperationIndex IS NULL \
              OR resolved.isWinner IS NOT 1 \
              OR (node.depth > 0 AND (\
                parent.valueOperationIndex IS NULL \
                OR parent.entityOperationIndex != node.entityOperationIndex \
                OR parent.depth + 1 != node.depth\
              ))\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let root_is_nested = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM temp.external_expected_feed_item_nodes AS node \
           JOIN external_operations AS operation \
             ON operation.operationIndex = node.valueOperationIndex \
           WHERE node.valueOperationIndex = ?1\
         );",
        [feed_items_operation_index],
        |row| row.get::<_, i64>(0),
    )?;
    if entity_mismatch != 0 || node_mismatch != 0 || root_is_nested != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn validate_feed_item_node_set(transaction: &Transaction<'_>) -> StageResult<()> {
    let entity_mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT entityOperationIndex, globalId FROM external_feed_item_entities \
           EXCEPT \
           SELECT entityOperationIndex, globalId \
           FROM temp.external_expected_feed_item_entities\
         ) OR EXISTS(\
           SELECT entityOperationIndex, globalId \
           FROM temp.external_expected_feed_item_entities \
           EXCEPT \
           SELECT entityOperationIndex, globalId FROM external_feed_item_entities\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let node_mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
                  depth, segmentKind, propertyName, sequenceOrdinal \
           FROM external_feed_item_nodes \
           EXCEPT \
           SELECT valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
                  depth, segmentKind, propertyName, sequenceOrdinal \
           FROM temp.external_expected_feed_item_nodes\
         ) OR EXISTS(\
           SELECT valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
                  depth, segmentKind, propertyName, sequenceOrdinal \
           FROM temp.external_expected_feed_item_nodes \
           EXCEPT \
           SELECT valueOperationIndex, entityOperationIndex, parentValueOperationIndex, \
                  depth, segmentKind, propertyName, sequenceOrdinal \
           FROM external_feed_item_nodes\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if entity_mismatch != 0
        || node_mismatch != 0
        || foreign_key_check_has_row(
            transaction,
            "PRAGMA foreign_key_check(external_feed_item_entities);",
        )?
        || foreign_key_check_has_row(
            transaction,
            "PRAGMA foreign_key_check(external_feed_item_nodes);",
        )?
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn build_expected_feed_item_documents(transaction: &Transaction<'_>) -> StageResult<()> {
    transaction.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS external_expected_feed_item_json_values (\
           valueOperationIndex INTEGER PRIMARY KEY, \
           jsonText TEXT NOT NULL, \
           jsonByteLength INTEGER NOT NULL\
         ) STRICT; \
         CREATE TEMP TABLE IF NOT EXISTS external_expected_feed_item_documents (\
           entityOperationIndex INTEGER PRIMARY KEY, \
           globalId TEXT NOT NULL UNIQUE, \
           jsonText TEXT NOT NULL, \
           jsonByteLength INTEGER NOT NULL, \
           jsonSha256 TEXT NOT NULL\
         ) STRICT; \
         DELETE FROM temp.external_expected_feed_item_json_values; \
         DELETE FROM temp.external_expected_feed_item_documents;",
    )?;

    validate_feed_item_global_ids(transaction)?;
    validate_feed_item_reserved_escapes(transaction)?;
    materialize_scalar_json_values(transaction)?;
    for depth in (0..=MAX_FEED_ITEM_OBJECT_DEPTH).rev() {
        let mut after_operation_index = -1_i64;
        loop {
            let containers = {
                let mut statement = transaction.prepare(
                    "SELECT node.valueOperationIndex, operation.action, \
                            operation.valueKind, length(operation.valuePayload) \
                     FROM external_feed_item_nodes AS node \
                     JOIN external_operations AS operation \
                       ON operation.operationIndex = node.valueOperationIndex \
                     WHERE node.depth = ?1 \
                       AND node.valueOperationIndex > ?2 \
                       AND operation.action IN (0, 2, 4) \
                     ORDER BY node.valueOperationIndex LIMIT 256;",
                )?;
                let rows = statement.query_map(params![depth, after_operation_index], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            if containers.is_empty() {
                break;
            }
            for (operation_index, action, value_kind, payload_bytes) in &containers {
                if value_kind != "null" || *payload_bytes != 0 {
                    return Err(ExternalSqliteStageError::IncompleteStage);
                }
                let json = serialize_feed_item_container(transaction, *operation_index, *action)?;
                insert_expected_json_value(transaction, *operation_index, &json)?;
            }
            after_operation_index = containers
                .last()
                .map(|container| container.0)
                .ok_or(ExternalSqliteStageError::IncompleteStage)?;
        }
    }

    let (node_count, value_count) = transaction.query_row(
        "SELECT \
           (SELECT COUNT(*) FROM external_feed_item_nodes), \
           (SELECT COUNT(*) FROM temp.external_expected_feed_item_json_values);",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if node_count != value_count {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }

    let mut after_entity_operation_index = -1_i64;
    let mut entity_statement = transaction.prepare(
        "SELECT entity.entityOperationIndex, entity.globalId, value.jsonText \
         FROM external_feed_item_entities AS entity \
         JOIN temp.external_expected_feed_item_json_values AS value \
           ON value.valueOperationIndex = entity.entityOperationIndex \
         WHERE entity.entityOperationIndex > ?1 \
         ORDER BY entity.entityOperationIndex LIMIT 1;",
    )?;
    loop {
        let entity = entity_statement
            .query_row([after_entity_operation_index], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .optional()?;
        let Some((operation_index, global_id, json)) = entity else {
            break;
        };
        let json_byte_length =
            i64::try_from(json.len()).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
        transaction.execute(
            "INSERT INTO temp.external_expected_feed_item_documents (\
             entityOperationIndex, globalId, jsonText, jsonByteLength, jsonSha256) \
             VALUES (?1, ?2, ?3, ?4, ?5);",
            params![
                operation_index,
                global_id,
                json,
                json_byte_length,
                lower_hex(&Sha256::digest(json.as_bytes())),
            ],
        )?;
        after_entity_operation_index = operation_index;
    }
    Ok(())
}

fn validate_feed_item_global_ids(transaction: &Transaction<'_>) -> StageResult<()> {
    let mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 \
           FROM external_feed_item_entities AS entity \
           LEFT JOIN external_feed_item_nodes AS node \
             ON node.entityOperationIndex = entity.entityOperationIndex \
            AND node.parentValueOperationIndex = entity.entityOperationIndex \
            AND node.segmentKind = 'property' \
            AND node.propertyName = 'globalId' \
           LEFT JOIN external_operations AS operation \
             ON operation.operationIndex = node.valueOperationIndex \
           WHERE node.valueOperationIndex IS NULL \
              OR operation.action != 1 \
              OR operation.valueKind != 'string' \
              OR operation.valueText IS NOT NULL \
              OR operation.valueTypeCode IS NOT NULL \
              OR operation.valuePayload != CAST(entity.globalId AS BLOB)\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if mismatch != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn validate_feed_item_reserved_escapes(transaction: &Transaction<'_>) -> StageResult<()> {
    let collision = transaction.query_row(
        "SELECT EXISTS(\
           SELECT 1 FROM external_feed_item_nodes \
           WHERE segmentKind = 'property' AND propertyName = '__nonFinite'\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if collision != 0 {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

fn materialize_scalar_json_values(transaction: &Transaction<'_>) -> StageResult<()> {
    let mut after_operation_index = -1_i64;
    let mut scalar_statement = transaction.prepare(
        "SELECT node.valueOperationIndex, operation.valueKind, \
                operation.valueText, operation.valuePayload, \
                resolved.resolvedCounterText \
         FROM external_feed_item_nodes AS node \
         JOIN external_operations AS operation \
           ON operation.operationIndex = node.valueOperationIndex \
         JOIN external_resolved_values AS resolved \
           ON resolved.operationIndex = node.valueOperationIndex \
         WHERE node.valueOperationIndex > ?1 AND operation.action = 1 \
         ORDER BY node.valueOperationIndex LIMIT 1;",
    )?;
    loop {
        let scalar = scalar_statement
            .query_row([after_operation_index], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .optional()?;
        let Some((operation_index, value_kind, value_text, value_payload, resolved_counter_text)) =
            scalar
        else {
            break;
        };
        let json = scalar_json_value(
            &value_kind,
            value_text.as_deref(),
            &value_payload,
            resolved_counter_text.as_deref(),
        )?;
        insert_expected_json_value(transaction, operation_index, &json)?;
        after_operation_index = operation_index;
    }
    Ok(())
}

fn scalar_json_value(
    value_kind: &str,
    value_text: Option<&str>,
    value_payload: &[u8],
    resolved_counter_text: Option<&str>,
) -> StageResult<String> {
    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    if value_kind != "string" && !value_payload.is_empty() {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    match value_kind {
        "null" if value_text.is_none() && resolved_counter_text.is_none() => Ok("null".to_string()),
        "boolean" if resolved_counter_text.is_none() => match value_text {
            Some("true") => Ok("true".to_string()),
            Some("false") => Ok("false".to_string()),
            _ => Err(ExternalSqliteStageError::IncompleteStage),
        },
        "unsigned" if resolved_counter_text.is_none() => {
            let value = value_text
                .ok_or(ExternalSqliteStageError::IncompleteStage)?
                .parse::<u64>()
                .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
            if value > MAX_SAFE_INTEGER {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            Ok(value.to_string())
        }
        "signed" | "timestamp" if resolved_counter_text.is_none() => {
            let value = value_text
                .ok_or(ExternalSqliteStageError::IncompleteStage)?
                .parse::<i64>()
                .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
            if value.unsigned_abs() > MAX_SAFE_INTEGER {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            Ok(value.to_string())
        }
        "counter" => {
            let value = resolved_counter_text
                .ok_or(ExternalSqliteStageError::IncompleteStage)?
                .parse::<i64>()
                .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
            if value.unsigned_abs() > MAX_SAFE_INTEGER {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            Ok(value.to_string())
        }
        "float" if resolved_counter_text.is_none() => {
            let bits = value_text.ok_or(ExternalSqliteStageError::IncompleteStage)?;
            if bits.len() != 16 || !bits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            let mut bytes = [0_u8; 8];
            for (index, byte) in bytes.iter_mut().enumerate() {
                *byte = u8::from_str_radix(&bits[index * 2..index * 2 + 2], 16)
                    .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
            }
            let value = f64::from_le_bytes(bytes);
            if value == 0.0 && value.is_sign_negative() {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            if !value.is_finite() {
                let label = if value.is_nan() {
                    "NaN"
                } else if value.is_sign_positive() {
                    "Infinity"
                } else {
                    "-Infinity"
                };
                return Ok(format!("{{\"__nonFinite\":\"{label}\"}}"));
            }
            let number = serde_json::Number::from_f64(value)
                .ok_or(ExternalSqliteStageError::IncompleteStage)?;
            Ok(number.to_string())
        }
        "string" if value_text.is_none() && resolved_counter_text.is_none() => {
            let value = std::str::from_utf8(value_payload)
                .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
            encode_json_string(value)
        }
        _ => Err(ExternalSqliteStageError::IncompleteStage),
    }
}

fn serialize_feed_item_container(
    transaction: &Transaction<'_>,
    operation_index: i64,
    action: i64,
) -> StageResult<String> {
    match action {
        0 => serialize_feed_item_map(transaction, operation_index),
        2 => serialize_feed_item_list(transaction, operation_index),
        4 => serialize_feed_item_text(transaction, operation_index),
        _ => Err(ExternalSqliteStageError::IncompleteStage),
    }
}

fn serialize_feed_item_map(
    transaction: &Transaction<'_>,
    operation_index: i64,
) -> StageResult<String> {
    let mut writer = BoundedJsonWriter::new();
    write_json_bytes(&mut writer, b"{")?;
    let mut statement = transaction.prepare(
        "SELECT node.propertyName, value.jsonText \
         FROM external_feed_item_nodes AS node \
         JOIN temp.external_expected_feed_item_json_values AS value \
           ON value.valueOperationIndex = node.valueOperationIndex \
         WHERE node.parentValueOperationIndex = ?1 AND node.segmentKind = 'property' \
         ORDER BY node.propertyName COLLATE BINARY;",
    )?;
    let mut rows = statement.query([operation_index])?;
    let mut first = true;
    while let Some(row) = rows.next()? {
        if !first {
            write_json_bytes(&mut writer, b",")?;
        }
        first = false;
        let property_name = row.get::<_, String>(0)?;
        let property_json = encode_json_string(&property_name)?;
        let value_json = row.get::<_, String>(1)?;
        write_json_bytes(&mut writer, property_json.as_bytes())?;
        write_json_bytes(&mut writer, b":")?;
        write_json_bytes(&mut writer, value_json.as_bytes())?;
    }
    write_json_bytes(&mut writer, b"}")?;
    writer.into_string()
}

fn serialize_feed_item_list(
    transaction: &Transaction<'_>,
    operation_index: i64,
) -> StageResult<String> {
    let mut writer = BoundedJsonWriter::new();
    write_json_bytes(&mut writer, b"[")?;
    let mut statement = transaction.prepare(
        "SELECT node.sequenceOrdinal, value.jsonText \
         FROM external_feed_item_nodes AS node \
         JOIN temp.external_expected_feed_item_json_values AS value \
           ON value.valueOperationIndex = node.valueOperationIndex \
         WHERE node.parentValueOperationIndex = ?1 AND node.segmentKind = 'sequence' \
         ORDER BY node.sequenceOrdinal;",
    )?;
    let mut rows = statement.query([operation_index])?;
    let mut expected_ordinal = 0_i64;
    while let Some(row) = rows.next()? {
        let ordinal = row.get::<_, i64>(0)?;
        if ordinal != expected_ordinal {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        if expected_ordinal != 0 {
            write_json_bytes(&mut writer, b",")?;
        }
        write_json_bytes(&mut writer, row.get::<_, String>(1)?.as_bytes())?;
        expected_ordinal = expected_ordinal
            .checked_add(1)
            .ok_or(ExternalSqliteStageError::RangeOverflow)?;
    }
    write_json_bytes(&mut writer, b"]")?;
    writer.into_string()
}

fn serialize_feed_item_text(
    transaction: &Transaction<'_>,
    operation_index: i64,
) -> StageResult<String> {
    let mut writer = BoundedJsonWriter::new();
    write_json_bytes(&mut writer, b"\"")?;
    let mut statement = transaction.prepare(
        "SELECT node.sequenceOrdinal, operation.valueKind, operation.valuePayload \
         FROM external_feed_item_nodes AS node \
         JOIN external_operations AS operation \
           ON operation.operationIndex = node.valueOperationIndex \
         WHERE node.parentValueOperationIndex = ?1 AND node.segmentKind = 'sequence' \
         ORDER BY node.sequenceOrdinal;",
    )?;
    let mut rows = statement.query([operation_index])?;
    let mut expected_ordinal = 0_i64;
    while let Some(row) = rows.next()? {
        let ordinal = row.get::<_, i64>(0)?;
        let value_kind = row.get::<_, String>(1)?;
        let payload = row.get::<_, Vec<u8>>(2)?;
        if ordinal != expected_ordinal || value_kind != "string" {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
        let chunk =
            std::str::from_utf8(&payload).map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
        let encoded = encode_json_string(chunk)?;
        write_json_bytes(&mut writer, &encoded.as_bytes()[1..encoded.len() - 1])?;
        expected_ordinal = expected_ordinal
            .checked_add(1)
            .ok_or(ExternalSqliteStageError::RangeOverflow)?;
    }
    write_json_bytes(&mut writer, b"\"")?;
    writer.into_string()
}

fn insert_expected_json_value(
    transaction: &Transaction<'_>,
    operation_index: i64,
    json: &str,
) -> StageResult<()> {
    if json.is_empty() || json.len() > MAX_FEED_ITEM_JSON_BYTES {
        return Err(ExternalSqliteStageError::PayloadTooLarge);
    }
    transaction.execute(
        "INSERT INTO temp.external_expected_feed_item_json_values (\
         valueOperationIndex, jsonText, jsonByteLength) VALUES (?1, ?2, ?3);",
        params![
            operation_index,
            json,
            i64::try_from(json.len()).map_err(|_| ExternalSqliteStageError::RangeOverflow)?,
        ],
    )?;
    Ok(())
}

fn validate_feed_item_document_set(transaction: &Transaction<'_>) -> StageResult<()> {
    let mismatch = transaction.query_row(
        "SELECT EXISTS(\
           SELECT entityOperationIndex, globalId, jsonText, jsonByteLength, jsonSha256 \
           FROM external_feed_item_documents \
           EXCEPT \
           SELECT entityOperationIndex, globalId, jsonText, jsonByteLength, jsonSha256 \
           FROM temp.external_expected_feed_item_documents\
         ) OR EXISTS(\
           SELECT entityOperationIndex, globalId, jsonText, jsonByteLength, jsonSha256 \
           FROM temp.external_expected_feed_item_documents \
           EXCEPT \
           SELECT entityOperationIndex, globalId, jsonText, jsonByteLength, jsonSha256 \
           FROM external_feed_item_documents\
         );",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if mismatch != 0
        || foreign_key_check_has_row(
            transaction,
            "PRAGMA foreign_key_check(external_feed_item_documents);",
        )?
    {
        return Err(ExternalSqliteStageError::IncompleteStage);
    }
    Ok(())
}

struct BoundedJsonWriter {
    bytes: Vec<u8>,
}

impl BoundedJsonWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(256),
        }
    }

    fn into_string(self) -> StageResult<String> {
        String::from_utf8(self.bytes).map_err(|_| ExternalSqliteStageError::IncompleteStage)
    }
}

impl Write for BoundedJsonWriter {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let next_length = self
            .bytes
            .len()
            .checked_add(buffer.len())
            .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::InvalidData))?;
        if next_length > MAX_FEED_ITEM_JSON_BYTES {
            return Err(std::io::Error::from(std::io::ErrorKind::InvalidData));
        }
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn write_json_bytes(writer: &mut BoundedJsonWriter, bytes: &[u8]) -> StageResult<()> {
    writer
        .write_all(bytes)
        .map_err(|_| ExternalSqliteStageError::PayloadTooLarge)
}

fn encode_json_string(value: &str) -> StageResult<String> {
    let mut writer = BoundedJsonWriter::new();
    serde_json::to_writer(&mut writer, value)
        .map_err(|_| ExternalSqliteStageError::PayloadTooLarge)?;
    writer.into_string()
}

fn validate_actor_operation_intervals(
    transaction: &Transaction<'_>,
    actor_count: u64,
) -> StageResult<()> {
    for actor_index in 0..actor_count {
        let actor_index =
            i64::try_from(actor_index).map_err(|_| ExternalSqliteStageError::RangeOverflow)?;
        let mut change_statement = transaction.prepare(
            "SELECT sequence, maxOperation FROM external_changes \
             WHERE actorIndex = ?1 ORDER BY sequence;",
        )?;
        let mut change_rows = change_statement.query([actor_index])?;
        let mut expected_sequence = 0_u64;
        let mut final_max_operation = 0_u64;
        while let Some(row) = change_rows.next()? {
            let sequence = sortable_u64(row.get_ref(0)?)?;
            let max_operation = sortable_u64(row.get_ref(1)?)?;
            expected_sequence = expected_sequence
                .checked_add(1)
                .ok_or(ExternalSqliteStageError::IncompleteStage)?;
            if sequence != expected_sequence || max_operation < final_max_operation {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
            final_max_operation = max_operation;
        }

        let mut operation_statement = transaction.prepare(
            "SELECT counter FROM (\
               SELECT idCounter AS counter FROM external_operations WHERE idActorIndex = ?1 \
               UNION \
               SELECT counter FROM external_omitted_deletes WHERE actorIndex = ?1\
             ) ORDER BY counter;",
        )?;
        let mut operation_rows = operation_statement.query([actor_index])?;
        let mut expected_counter = 0_u64;
        while let Some(row) = operation_rows.next()? {
            let counter = sortable_u64(row.get_ref(0)?)?;
            expected_counter = expected_counter
                .checked_add(1)
                .ok_or(ExternalSqliteStageError::IncompleteStage)?;
            if counter != expected_counter {
                return Err(ExternalSqliteStageError::IncompleteStage);
            }
        }
        if expected_counter != final_max_operation {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
    }
    Ok(())
}

fn sortable_u64(value: ValueRef<'_>) -> StageResult<u64> {
    let ValueRef::Blob(bytes) = value else {
        return Err(ExternalSqliteStageError::IncompleteStage);
    };
    let bytes: [u8; 8] = bytes
        .try_into()
        .map_err(|_| ExternalSqliteStageError::IncompleteStage)?;
    Ok(u64::from_be_bytes(bytes))
}

fn graph_content_sha256(connection: &Connection) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-scratch-graph-v2");
    for (label, query) in [
        (
            "layout-receipt",
            "SELECT singleton, sourceByteLength, sourceSha256, actorCount, headCount \
             FROM external_layout_stage_receipt ORDER BY singleton;",
        ),
        (
            "change-receipt",
            "SELECT singleton, sourceByteLength, sourceSha256, changeCount, dependencyCount, \
             dependencySpoolByteLength, dependencySpoolSha256, extraPayloadSpoolByteLength, \
             extraPayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256 \
             FROM external_change_stage_receipt ORDER BY singleton;",
        ),
        (
            "operation-receipt",
            "SELECT singleton, sourceByteLength, sourceSha256, operationCount, successorCount, \
             successorSpoolByteLength, successorSpoolSha256, valuePayloadSpoolByteLength, \
             valuePayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256 \
             FROM external_operation_stage_receipt ORDER BY singleton;",
        ),
        (
            "actors",
            "SELECT actorIndex, actorId FROM external_actors ORDER BY actorIndex;",
        ),
        (
            "heads",
            "SELECT headIndex, changeIndex, hash FROM external_heads ORDER BY headIndex;",
        ),
        (
            "changes",
            "SELECT changeIndex, actorIndex, sequence, maxOperation, timestamp, message \
             FROM external_changes ORDER BY changeIndex;",
        ),
        (
            "dependencies",
            "SELECT changeIndex, dependencyOrdinal, dependencyIndex \
             FROM external_change_dependencies ORDER BY changeIndex, dependencyOrdinal;",
        ),
        (
            "operations",
            "SELECT operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
             objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, action, \
             valueKind, valueText, valueTypeCode, expandFlag, markName \
             FROM external_operations ORDER BY operationIndex;",
        ),
        (
            "successors",
            "SELECT operationIndex, successorOrdinal, actorIndex, counter \
             FROM external_operation_successors ORDER BY operationIndex, successorOrdinal;",
        ),
        (
            "omitted-deletes",
            "SELECT actorIndex, counter, objectKind, objectActorIndex, objectCounter, \
                    keyKind, keyName, keyActorIndex, keyCounter \
             FROM external_omitted_deletes ORDER BY actorIndex, counter;",
        ),
    ] {
        hash_query_rows(connection, &mut hasher, label, query)?;
    }
    hash_blob_column(
        connection,
        &mut hasher,
        "change-payloads",
        "external_changes",
        "extraPayload",
        "SELECT changeIndex FROM external_changes ORDER BY changeIndex;",
    )?;
    hash_blob_column(
        connection,
        &mut hasher,
        "operation-payloads",
        "external_operations",
        "valuePayload",
        "SELECT operationIndex FROM external_operations ORDER BY operationIndex;",
    )?;
    Ok(lower_hex(&hasher.finalize()))
}

fn current_operations_sha256(connection: &Connection) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-current-operation-set-v1");
    hash_query_rows(
        connection,
        &mut hasher,
        "current-operations",
        "SELECT current.operationIndex, operation.idActorIndex, operation.idCounter, \
                operation.objectKind, operation.objectActorIndex, operation.objectCounter, \
                operation.keyKind, operation.keyName, operation.keyActorIndex, \
                operation.keyCounter, operation.insertFlag, operation.action, \
                operation.valueKind, operation.valueText, operation.valueTypeCode, \
                operation.expandFlag, operation.markName \
         FROM external_current_operations AS current \
         JOIN external_operations AS operation USING (operationIndex) \
         ORDER BY current.operationIndex;",
    )?;
    hash_blob_column(
        connection,
        &mut hasher,
        "current-operation-payloads",
        "external_operations",
        "valuePayload",
        "SELECT operationIndex FROM external_current_operations ORDER BY operationIndex;",
    )?;
    Ok(lower_hex(&hasher.finalize()))
}

fn resolved_values_sha256(connection: &Connection) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-resolved-values-v1");
    hash_query_rows(
        connection,
        &mut hasher,
        "resolved-values",
        "SELECT resolved.operationIndex, resolved.isWinner, resolved.resolvedCounterText, \
                operation.idActorIndex, operation.idCounter, operation.objectKind, \
                operation.objectActorIndex, operation.objectCounter, operation.keyKind, \
                operation.keyName, operation.keyActorIndex, operation.keyCounter, \
                operation.insertFlag, operation.action, operation.valueKind, \
                operation.valueText, operation.valueTypeCode, operation.expandFlag, \
                operation.markName \
         FROM external_resolved_values AS resolved \
         JOIN external_operations AS operation USING (operationIndex) \
         ORDER BY resolved.operationIndex;",
    )?;
    hash_blob_column(
        connection,
        &mut hasher,
        "resolved-value-payloads",
        "external_operations",
        "valuePayload",
        "SELECT operationIndex FROM external_resolved_values ORDER BY operationIndex;",
    )?;
    Ok(lower_hex(&hasher.finalize()))
}

fn sequence_elements_sha256(connection: &Connection) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-sequence-elements-v1");
    hash_query_rows(
        connection,
        &mut hasher,
        "sequence-elements",
        "SELECT element.objectActorIndex, element.objectCounter, \
                element.sequenceOrdinal, element.insertionOperationIndex, \
                operation.idActorIndex, operation.idCounter, operation.keyKind, \
                operation.keyActorIndex, operation.keyCounter \
         FROM external_sequence_elements AS element \
         JOIN external_operations AS operation \
           ON operation.operationIndex = element.insertionOperationIndex \
         ORDER BY element.objectActorIndex, element.objectCounter, \
                  element.sequenceOrdinal;",
    )?;
    Ok(lower_hex(&hasher.finalize()))
}

fn feed_item_nodes_sha256(connection: &Connection) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-feed-item-nodes-v1");
    hash_query_rows(
        connection,
        &mut hasher,
        "feed-item-entities",
        "SELECT entity.entityOperationIndex, entity.globalId, \
                operation.idActorIndex, operation.idCounter \
         FROM external_feed_item_entities AS entity \
         JOIN external_operations AS operation \
           ON operation.operationIndex = entity.entityOperationIndex \
         ORDER BY entity.entityOperationIndex;",
    )?;
    hash_query_rows(
        connection,
        &mut hasher,
        "feed-item-nodes",
        "SELECT node.valueOperationIndex, node.entityOperationIndex, \
                node.parentValueOperationIndex, node.depth, node.segmentKind, \
                node.propertyName, node.sequenceOrdinal, operation.action, \
                operation.valueKind, operation.valueText, operation.valueTypeCode, \
                resolved.resolvedCounterText \
         FROM external_feed_item_nodes AS node \
         JOIN external_operations AS operation \
           ON operation.operationIndex = node.valueOperationIndex \
         JOIN external_resolved_values AS resolved \
           ON resolved.operationIndex = node.valueOperationIndex \
         ORDER BY node.entityOperationIndex, node.valueOperationIndex;",
    )?;
    hash_blob_column(
        connection,
        &mut hasher,
        "feed-item-node-payloads",
        "external_operations",
        "valuePayload",
        "SELECT valueOperationIndex FROM external_feed_item_nodes \
         ORDER BY entityOperationIndex, valueOperationIndex;",
    )?;
    Ok(lower_hex(&hasher.finalize()))
}

fn feed_item_documents_sha256(connection: &Connection) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-feed-item-documents-v1");
    hash_query_rows(
        connection,
        &mut hasher,
        "feed-item-documents",
        "SELECT entityOperationIndex, globalId, jsonByteLength, jsonSha256, jsonText \
         FROM external_feed_item_documents ORDER BY entityOperationIndex;",
    )?;
    Ok(lower_hex(&hasher.finalize()))
}

fn feed_item_projection_rows_sha256(connection: &Connection) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-feed-item-projection-rows-v1");
    hash_query_rows(
        connection,
        &mut hasher,
        "feed-item-projection-rows",
        "SELECT entityOperationIndex, globalId, platform, contentType, publishedAt, capturedAt, \
                authorId, authorDisplayName, authorHandle, sourceUrl, hidden, saved, archived, \
                readAt, archivedAt, likedAt, tags, contentBlob, preservedBlob, rest, sortAt \
         FROM external_feed_item_projection_rows ORDER BY entityOperationIndex;",
    )?;
    Ok(lower_hex(&hasher.finalize()))
}

fn feed_item_projection_page_sha256(
    receipt: &ExternalFeedItemProjectionReceipt,
    entries: &[(i64, FeedItemRow)],
) -> StageResult<String> {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"freed-automerge-feed-item-projection-page-v1");
    hash_field(
        &mut hasher,
        receipt.feed_item_projection_rows_sha256.as_bytes(),
    );
    hasher.update(receipt.feed_item_count.to_be_bytes());
    for (entity_operation_index, row) in entries {
        hasher.update(entity_operation_index.to_be_bytes());
        let encoded =
            serde_json::to_vec(row).map_err(|_| FeedItemProjectionError::Serialization)?;
        hash_field(&mut hasher, &encoded);
    }
    Ok(lower_hex(&hasher.finalize()))
}

fn hash_query_rows(
    connection: &Connection,
    hasher: &mut Sha256,
    label: &str,
    query: &'static str,
) -> StageResult<()> {
    hash_field(hasher, label.as_bytes());
    let mut statement = connection.prepare(query)?;
    let column_count = statement.column_count();
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        hasher.update(b"R");
        for index in 0..column_count {
            match row.get_ref(index)? {
                ValueRef::Null => hasher.update(b"N"),
                ValueRef::Integer(value) => {
                    hasher.update(b"I");
                    hasher.update(value.to_be_bytes());
                }
                ValueRef::Real(value) => {
                    hasher.update(b"F");
                    hasher.update(value.to_bits().to_be_bytes());
                }
                ValueRef::Text(value) => {
                    hasher.update(b"T");
                    hash_field(hasher, value);
                }
                ValueRef::Blob(value) => {
                    hasher.update(b"B");
                    hash_field(hasher, value);
                }
            }
        }
    }
    hasher.update(b"E");
    Ok(())
}

fn hash_blob_column(
    connection: &Connection,
    hasher: &mut Sha256,
    label: &str,
    table: &'static str,
    column: &'static str,
    row_id_query: &'static str,
) -> StageResult<()> {
    hash_field(hasher, label.as_bytes());
    let mut statement = connection.prepare(row_id_query)?;
    let mut rows = statement.query([])?;
    let mut buffer = [0_u8; 64 * 1024];
    while let Some(row) = rows.next()? {
        let row_id = row.get::<_, i64>(0)?;
        hasher.update(b"R");
        hasher.update(row_id.to_be_bytes());
        let mut blob = connection.blob_open(DatabaseName::Main, table, column, row_id, true)?;
        hasher.update(
            u64::try_from(blob.len())
                .map_err(|_| ExternalSqliteStageError::RangeOverflow)?
                .to_be_bytes(),
        );
        let mut total = 0_usize;
        loop {
            let read = blob.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(read)
                .ok_or(ExternalSqliteStageError::RangeOverflow)?;
            hasher.update(&buffer[..read]);
        }
        if total != blob.len() {
            return Err(ExternalSqliteStageError::IncompleteStage);
        }
    }
    hasher.update(b"E");
    Ok(())
}

fn hash_field(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn lower_hex(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(value.len() * 2);
    for byte in value {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
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

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE_SHA256: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    fn complete_minimal_graph() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        configure_connection(&connection).unwrap();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        initialize_or_validate_schema(&transaction).unwrap();
        transaction
            .execute(
                "INSERT INTO external_layout_stage_receipt \
                 (singleton, sourceByteLength, sourceSha256, actorCount, headCount) \
                 VALUES (1, 1, ?1, 1, 1);",
                [SOURCE_SHA256],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO external_actors (actorIndex, actorId) VALUES (0, 'aa');",
                [],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO external_changes \
                 (changeIndex, actorIndex, sequence, maxOperation, timestamp, message, extraPayload) \
                 VALUES (0, 0, ?1, ?2, 0, NULL, X'');",
                params![1_u64.to_be_bytes(), 1_u64.to_be_bytes()],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO external_heads (headIndex, changeIndex, hash) VALUES \
                 (0, 0, '2222222222222222222222222222222222222222222222222222222222222222');",
                [],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO external_change_stage_receipt \
                 (singleton, sourceByteLength, sourceSha256, changeCount, dependencyCount, \
                  dependencySpoolByteLength, dependencySpoolSha256, extraPayloadSpoolByteLength, \
                  extraPayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256) \
                 VALUES (1, 1, ?1, 1, 0, 0, ?2, 0, ?2, 1, ?1);",
                params![SOURCE_SHA256, EMPTY_SHA256],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                  objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (0, 0, ?1, 'root', NULL, NULL, 'property', 'title', NULL, NULL, \
                         0, 1, 'null', NULL, NULL, X'', 0, NULL);",
                [1_u64.to_be_bytes()],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO external_operation_stage_receipt \
                 (singleton, sourceByteLength, sourceSha256, operationCount, successorCount, \
                  successorSpoolByteLength, successorSpoolSha256, valuePayloadSpoolByteLength, \
                  valuePayloadSpoolSha256, rowRunPrefixByteLength, rowRunPrefixSha256) \
                 VALUES (1, 1, ?1, 1, 0, 0, ?2, 0, ?2, 1, ?1);",
                params![SOURCE_SHA256, EMPTY_SHA256],
            )
            .unwrap();
        transaction.commit().unwrap();
        connection
    }

    fn insert_root_property_operation(
        connection: &Connection,
        operation_index: i64,
        counter: u64,
        key: &str,
        action: i64,
        value_kind: &str,
        value_text: Option<&str>,
    ) {
        connection
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                  objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (?1, 0, ?2, 'root', NULL, NULL, 'property', ?3, NULL, NULL, \
                         0, ?4, ?5, ?6, NULL, X'', 0, NULL);",
                params![
                    operation_index,
                    counter.to_be_bytes(),
                    key,
                    action,
                    value_kind,
                    value_text,
                ],
            )
            .unwrap();
    }

    fn set_operation_bounds(
        connection: &Connection,
        max_operation: u64,
        operation_count: i64,
        successor_count: i64,
    ) {
        let mut payload_hasher = Sha256::new();
        let mut payload_byte_length = 0_i64;
        let mut payload_statement = connection
            .prepare("SELECT valuePayload FROM external_operations ORDER BY operationIndex;")
            .unwrap();
        let mut payload_rows = payload_statement.query([]).unwrap();
        while let Some(row) = payload_rows.next().unwrap() {
            let payload = row.get::<_, Vec<u8>>(0).unwrap();
            payload_byte_length += i64::try_from(payload.len()).unwrap();
            payload_hasher.update(payload);
        }
        let payload_sha256 = lower_hex(&payload_hasher.finalize());
        connection
            .execute(
                "UPDATE external_changes SET maxOperation = ?1 WHERE changeIndex = 0;",
                [max_operation.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_operation_stage_receipt \
                 SET operationCount = ?1, successorCount = ?2, \
                     successorSpoolByteLength = ?2 * 16, \
                     valuePayloadSpoolByteLength = ?3, \
                     valuePayloadSpoolSha256 = ?4 \
                 WHERE singleton = 1;",
                params![
                    operation_count,
                    successor_count,
                    payload_byte_length,
                    payload_sha256
                ],
            )
            .unwrap();
    }

    fn make_minimal_list_root(connection: &Connection) {
        connection
            .execute(
                "UPDATE external_operations \
                 SET keyName = 'list', action = 2 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
    }

    fn insert_list_value(
        connection: &Connection,
        operation_index: i64,
        counter: u64,
        object_counter: u64,
        anchor_counter: Option<u64>,
        value: &str,
    ) {
        let (key_kind, key_actor_index, key_counter) = if let Some(anchor) = anchor_counter {
            ("element", Some(0_i64), Some(anchor.to_be_bytes().to_vec()))
        } else {
            ("head", None, None)
        };
        connection
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                 objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (?1, 0, ?2, 'operation', 0, ?3, ?4, NULL, ?5, ?6, \
                         1, 1, 'string', NULL, NULL, ?7, 0, NULL);",
                params![
                    operation_index,
                    counter.to_be_bytes(),
                    object_counter.to_be_bytes(),
                    key_kind,
                    key_actor_index,
                    key_counter,
                    value.as_bytes(),
                ],
            )
            .unwrap();
    }

    fn insert_map_value(
        connection: &Connection,
        operation_index: i64,
        counter: u64,
        object_counter: u64,
        key: &str,
        action: i64,
        value_kind: &str,
        value_text: Option<&str>,
    ) {
        let (stored_value_text, value_payload) = if value_kind == "string" {
            (None, value_text.unwrap_or_default().as_bytes().to_vec())
        } else {
            (value_text, Vec::new())
        };
        connection
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                 objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (?1, 0, ?2, 'operation', 0, ?3, 'property', ?4, NULL, NULL, \
                         0, ?5, ?6, ?7, NULL, ?8, 0, NULL);",
                params![
                    operation_index,
                    counter.to_be_bytes(),
                    object_counter.to_be_bytes(),
                    key,
                    action,
                    value_kind,
                    stored_value_text,
                    value_payload,
                ],
            )
            .unwrap();
    }

    fn materialize_through_resolved_values(connection: &mut Connection) {
        seal_staged_graph(connection).unwrap();
        materialize_current_operations(connection).unwrap();
        materialize_resolved_values(connection).unwrap();
    }

    fn materialize_through_sequences(connection: &mut Connection) {
        materialize_through_resolved_values(connection);
        materialize_sequence_elements(connection).unwrap();
    }

    #[test]
    fn seals_and_replays_one_complete_graph_then_detects_same_count_tampering() {
        let mut connection = complete_minimal_graph();
        let receipt = seal_staged_graph(&mut connection).unwrap();
        assert_eq!(receipt.actor_count, 1);
        assert_eq!(receipt.head_count, 1);
        assert_eq!(receipt.change_count, 1);
        assert_eq!(receipt.operation_count, 1);
        assert_eq!(receipt.omitted_delete_count, 0);
        assert_eq!(receipt.graph_sha256.len(), 64);
        assert_eq!(seal_staged_graph(&mut connection).unwrap(), receipt);

        connection
            .execute(
                "UPDATE external_operations SET valueText = 'tampered' WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        assert!(matches!(
            seal_staged_graph(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn rejects_a_noncontiguous_operation_interval_before_sealing() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET idCounter = ?1 WHERE operationIndex = 0;",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        assert!(matches!(
            seal_staged_graph(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM external_graph_stage_receipt;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn seals_a_graph_with_an_omitted_delete_successor() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_changes SET maxOperation = ?1 WHERE changeIndex = 0;",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_operation_stage_receipt \
                 SET successorCount = 1, successorSpoolByteLength = 16 \
                 WHERE singleton = 1;",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (0, 0, 0, ?1);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();

        let receipt = seal_staged_graph(&mut connection).unwrap();
        assert_eq!(receipt.operation_count, 1);
        assert_eq!(receipt.successor_count, 1);
        assert_eq!(receipt.omitted_delete_count, 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT actorIndex, counter, objectKind, keyKind, keyName \
                     FROM external_omitted_deletes;",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, Vec<u8>>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .unwrap(),
            (
                0,
                2_u64.to_be_bytes().to_vec(),
                "root".to_string(),
                "property".to_string(),
                "title".to_string(),
            )
        );
        assert_eq!(seal_staged_graph(&mut connection).unwrap(), receipt);
    }

    #[test]
    fn rejects_one_omitted_delete_id_attached_to_different_targets() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_changes SET maxOperation = ?1 WHERE changeIndex = 0;",
                [3_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                  objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (1, 0, ?1, 'root', NULL, NULL, 'property', 'other', NULL, NULL, \
                         0, 1, 'null', NULL, NULL, X'', 0, NULL);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_operation_stage_receipt \
                 SET operationCount = 2, successorCount = 2, successorSpoolByteLength = 32 \
                 WHERE singleton = 1;",
                [],
            )
            .unwrap();
        for operation_index in [0_i64, 1_i64] {
            connection
                .execute(
                    "INSERT INTO external_operation_successors \
                     (operationIndex, successorOrdinal, actorIndex, counter) \
                     VALUES (?1, 0, 0, ?2);",
                    params![operation_index, 3_u64.to_be_bytes()],
                )
                .unwrap();
        }

        assert!(matches!(
            seal_staged_graph(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn rejects_an_explicit_successor_attached_to_a_different_target() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_changes SET maxOperation = ?1 WHERE changeIndex = 0;",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                  objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (1, 0, ?1, 'root', NULL, NULL, 'property', 'other', NULL, NULL, \
                         0, 1, 'null', NULL, NULL, X'', 0, NULL);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_operation_stage_receipt \
                 SET operationCount = 2, successorCount = 1, successorSpoolByteLength = 16 \
                 WHERE singleton = 1;",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (0, 0, 0, ?1);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();

        assert!(matches!(
            seal_staged_graph(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn materializes_and_replays_the_exact_current_operation_set() {
        let mut connection = complete_minimal_graph();
        assert!(matches!(
            materialize_current_operations(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));

        let graph_receipt = seal_staged_graph(&mut connection).unwrap();
        let receipt = materialize_current_operations(&mut connection).unwrap();
        assert_eq!(receipt.graph_sha256, graph_receipt.graph_sha256);
        assert_eq!(receipt.current_operation_count, 1);
        assert_eq!(receipt.current_operations_sha256.len(), 64);
        assert_eq!(
            connection
                .query_row(
                    "SELECT operationIndex FROM external_current_operations;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            materialize_current_operations(&mut connection).unwrap(),
            receipt
        );

        connection
            .execute("DELETE FROM external_current_operations;", [])
            .unwrap();
        assert!(matches!(
            materialize_current_operations(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn omitted_delete_removes_its_predecessor_from_the_current_set() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_changes SET maxOperation = ?1 WHERE changeIndex = 0;",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_operation_stage_receipt \
                 SET successorCount = 1, successorSpoolByteLength = 16 \
                 WHERE singleton = 1;",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (0, 0, 0, ?1);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();

        seal_staged_graph(&mut connection).unwrap();
        let receipt = materialize_current_operations(&mut connection).unwrap();
        assert_eq!(receipt.current_operation_count, 0);
    }

    #[test]
    fn counter_increment_keeps_only_the_counter_base_current() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations \
                 SET valueKind = 'counter', valueText = '10' \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_changes SET maxOperation = ?1 WHERE changeIndex = 0;",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                  objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (1, 0, ?1, 'root', NULL, NULL, 'property', 'title', NULL, NULL, \
                         0, 5, 'signed', '2', NULL, X'', 0, NULL);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (0, 0, 0, ?1);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_operation_stage_receipt \
                 SET operationCount = 2, successorCount = 1, successorSpoolByteLength = 16 \
                 WHERE singleton = 1;",
                [],
            )
            .unwrap();

        seal_staged_graph(&mut connection).unwrap();
        let receipt = materialize_current_operations(&mut connection).unwrap();
        assert_eq!(receipt.current_operation_count, 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT operationIndex FROM external_current_operations;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn current_operation_materialization_preserves_concurrent_conflicts() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_changes SET maxOperation = ?1 WHERE changeIndex = 0;",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO external_operations \
                 (operationIndex, idActorIndex, idCounter, objectKind, objectActorIndex, \
                 objectCounter, keyKind, keyName, keyActorIndex, keyCounter, insertFlag, \
                  action, valueKind, valueText, valueTypeCode, valuePayload, expandFlag, markName) \
                 VALUES (1, 0, ?1, 'root', NULL, NULL, 'property', 'title', NULL, NULL, \
                         0, 1, 'null', NULL, NULL, X'', 0, NULL);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE external_operation_stage_receipt \
                 SET operationCount = 2 WHERE singleton = 1;",
                [],
            )
            .unwrap();

        seal_staged_graph(&mut connection).unwrap();
        let receipt = materialize_current_operations(&mut connection).unwrap();
        assert_eq!(receipt.current_operation_count, 2);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM external_current_operations;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
    }

    #[test]
    fn resolved_values_require_current_materialization_and_replay_exactly() {
        let mut connection = complete_minimal_graph();
        seal_staged_graph(&mut connection).unwrap();
        assert!(matches!(
            materialize_resolved_values(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));

        materialize_current_operations(&mut connection).unwrap();
        let receipt = materialize_resolved_values(&mut connection).unwrap();
        assert_eq!(receipt.resolved_value_count, 1);
        assert_eq!(receipt.winner_count, 1);
        assert_eq!(
            materialize_resolved_values(&mut connection).unwrap(),
            receipt
        );

        connection
            .execute(
                "UPDATE external_resolved_values SET isWinner = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        assert!(matches!(
            materialize_resolved_values(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn counter_resolution_keeps_the_base_visible_and_applies_increment_successors() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations \
                 SET valueKind = 'counter', valueText = '10' \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_root_property_operation(&connection, 1, 2, "title", 5, "signed", Some("2"));
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (0, 0, 0, ?1);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        set_operation_bounds(&connection, 2, 2, 1);

        seal_staged_graph(&mut connection).unwrap();
        materialize_current_operations(&mut connection).unwrap();
        let receipt = materialize_resolved_values(&mut connection).unwrap();
        assert_eq!(receipt.resolved_value_count, 1);
        assert_eq!(receipt.winner_count, 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT operationIndex, isWinner, resolvedCounterText \
                     FROM external_resolved_values;",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .unwrap(),
            (0, 1, "12".to_string())
        );
        connection
            .execute(
                "UPDATE external_resolved_values SET resolvedCounterText = '13' \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        assert!(matches!(
            materialize_resolved_values(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn register_resolution_preserves_conflicts_and_marks_only_the_lamport_maximum() {
        let mut connection = complete_minimal_graph();
        insert_root_property_operation(&connection, 1, 2, "title", 1, "string", Some("later"));
        set_operation_bounds(&connection, 2, 2, 0);

        seal_staged_graph(&mut connection).unwrap();
        materialize_current_operations(&mut connection).unwrap();
        let receipt = materialize_resolved_values(&mut connection).unwrap();
        assert_eq!(receipt.resolved_value_count, 2);
        assert_eq!(receipt.winner_count, 1);
        let rows = connection
            .prepare(
                "SELECT operationIndex, isWinner FROM external_resolved_values \
                 ORDER BY operationIndex;",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(rows, vec![(0, 0), (1, 1)]);
    }

    #[test]
    fn register_resolution_marks_one_winner_for_each_distinct_target() {
        let mut connection = complete_minimal_graph();
        insert_root_property_operation(&connection, 1, 2, "other", 1, "string", Some("value"));
        set_operation_bounds(&connection, 2, 2, 0);

        seal_staged_graph(&mut connection).unwrap();
        materialize_current_operations(&mut connection).unwrap();
        let receipt = materialize_resolved_values(&mut connection).unwrap();
        assert_eq!(receipt.resolved_value_count, 2);
        assert_eq!(receipt.winner_count, 2);
    }

    #[test]
    fn register_resolution_rejects_orphan_and_noncounter_increments() {
        let mut orphan = complete_minimal_graph();
        insert_root_property_operation(&orphan, 1, 2, "title", 5, "signed", Some("1"));
        set_operation_bounds(&orphan, 2, 2, 0);
        seal_staged_graph(&mut orphan).unwrap();
        materialize_current_operations(&mut orphan).unwrap();
        assert!(matches!(
            materialize_resolved_values(&mut orphan),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));

        let mut noncounter = complete_minimal_graph();
        insert_root_property_operation(&noncounter, 1, 2, "title", 5, "signed", Some("1"));
        noncounter
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (0, 0, 0, ?1);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        set_operation_bounds(&noncounter, 2, 2, 1);
        seal_staged_graph(&mut noncounter).unwrap();
        materialize_current_operations(&mut noncounter).unwrap();
        assert!(matches!(
            materialize_resolved_values(&mut noncounter),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn counter_resolution_rejects_integer_overflow() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations \
                 SET valueKind = 'counter', valueText = ?1 \
                 WHERE operationIndex = 0;",
                [i64::MAX.to_string()],
            )
            .unwrap();
        insert_root_property_operation(&connection, 1, 2, "title", 5, "unsigned", Some("1"));
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (0, 0, 0, ?1);",
                [2_u64.to_be_bytes()],
            )
            .unwrap();
        set_operation_bounds(&connection, 2, 2, 1);

        seal_staged_graph(&mut connection).unwrap();
        materialize_current_operations(&mut connection).unwrap();
        assert!(matches!(
            materialize_resolved_values(&mut connection),
            Err(ExternalSqliteStageError::RangeOverflow)
        ));
    }

    #[test]
    fn sequence_materialization_requires_resolved_values_and_replays_exact_order() {
        let mut connection = complete_minimal_graph();
        make_minimal_list_root(&connection);
        insert_list_value(&connection, 1, 2, 1, None, "a");
        insert_list_value(&connection, 2, 3, 1, Some(2), "b");
        insert_list_value(&connection, 3, 4, 1, Some(2), "c");
        set_operation_bounds(&connection, 4, 4, 0);
        seal_staged_graph(&mut connection).unwrap();
        materialize_current_operations(&mut connection).unwrap();
        assert!(matches!(
            materialize_sequence_elements(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
        materialize_resolved_values(&mut connection).unwrap();

        let receipt = materialize_sequence_elements(&mut connection).unwrap();
        assert_eq!(receipt.sequence_object_count, 1);
        assert_eq!(receipt.sequence_element_count, 3);
        let order = connection
            .prepare(
                "SELECT insertionOperationIndex FROM external_sequence_elements \
                 ORDER BY sequenceOrdinal;",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(order, vec![1, 3, 2]);
        assert_eq!(
            materialize_sequence_elements(&mut connection).unwrap(),
            receipt
        );

        connection
            .execute(
                "UPDATE external_sequence_elements SET sequenceOrdinal = 99 \
                 WHERE insertionOperationIndex = 3;",
                [],
            )
            .unwrap();
        assert!(matches!(
            materialize_sequence_elements(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn sequence_materialization_keeps_deleted_anchors_in_the_order_graph() {
        let mut connection = complete_minimal_graph();
        make_minimal_list_root(&connection);
        insert_list_value(&connection, 1, 2, 1, None, "deleted anchor");
        insert_list_value(&connection, 2, 3, 1, Some(2), "visible child");
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (1, 0, 0, ?1);",
                [4_u64.to_be_bytes()],
            )
            .unwrap();
        set_operation_bounds(&connection, 4, 3, 1);

        materialize_through_resolved_values(&mut connection);
        let receipt = materialize_sequence_elements(&mut connection).unwrap();
        assert_eq!(receipt.sequence_element_count, 2);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM external_resolved_values \
                     WHERE operationIndex = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        let order = connection
            .prepare(
                "SELECT insertionOperationIndex FROM external_sequence_elements \
                 ORDER BY sequenceOrdinal;",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(order, vec![1, 2]);
    }

    #[test]
    fn sequence_materialization_rejects_cross_object_anchors() {
        let mut connection = complete_minimal_graph();
        make_minimal_list_root(&connection);
        insert_list_value(&connection, 1, 2, 1, None, "first list");
        insert_root_property_operation(&connection, 2, 3, "otherList", 2, "null", None);
        insert_list_value(&connection, 3, 4, 3, Some(2), "wrong object");
        set_operation_bounds(&connection, 4, 4, 0);

        materialize_through_resolved_values(&mut connection);
        assert!(matches!(
            materialize_sequence_elements(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn sequence_materialization_has_no_recursive_depth_ceiling() {
        const ELEMENT_COUNT: u64 = 1_100;
        let mut connection = complete_minimal_graph();
        make_minimal_list_root(&connection);
        for index in 0..ELEMENT_COUNT {
            let counter = index + 2;
            let anchor = (index > 0).then_some(counter - 1);
            insert_list_value(
                &connection,
                i64::try_from(index + 1).unwrap(),
                counter,
                1,
                anchor,
                "value",
            );
        }
        set_operation_bounds(
            &connection,
            ELEMENT_COUNT + 1,
            i64::try_from(ELEMENT_COUNT + 1).unwrap(),
            0,
        );

        materialize_through_resolved_values(&mut connection);
        let receipt = materialize_sequence_elements(&mut connection).unwrap();
        assert_eq!(receipt.sequence_object_count, 1);
        assert_eq!(receipt.sequence_element_count, ELEMENT_COUNT);
        assert_eq!(
            connection
                .query_row(
                    "SELECT MIN(sequenceOrdinal), MAX(sequenceOrdinal) \
                     FROM external_sequence_elements;",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .unwrap(),
            (0, i64::try_from(ELEMENT_COUNT - 1).unwrap())
        );
    }

    fn one_feed_item_graph() -> Connection {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(&connection, 1, 2, 1, "rss:item", 0, "null", None);
        insert_map_value(
            &connection,
            2,
            3,
            2,
            "globalId",
            1,
            "string",
            Some("rss:item"),
        );
        insert_map_value(&connection, 3, 4, 2, "author", 0, "null", None);
        insert_map_value(&connection, 4, 5, 4, "id", 1, "string", Some("author"));
        insert_map_value(&connection, 5, 6, 2, "topics", 2, "null", None);
        insert_list_value(&connection, 6, 7, 6, None, "alpha");
        insert_list_value(&connection, 7, 8, 6, Some(7), "beta");
        insert_map_value(&connection, 8, 9, 2, "summary", 4, "null", None);
        insert_list_value(&connection, 9, 10, 9, None, "hello ");
        insert_list_value(&connection, 10, 11, 9, Some(10), "\"world\"\n");
        set_operation_bounds(&connection, 11, 11, 0);

        materialize_through_sequences(&mut connection);
        connection
    }

    fn simple_feed_item_graph(global_ids: &[&str]) -> Connection {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        let mut operation_index = 1_i64;
        let mut counter = 2_u64;
        for global_id in global_ids {
            let entity_counter = counter;
            insert_map_value(
                &connection,
                operation_index,
                counter,
                1,
                global_id,
                0,
                "null",
                None,
            );
            operation_index += 1;
            counter += 1;
            insert_map_value(
                &connection,
                operation_index,
                counter,
                entity_counter,
                "globalId",
                1,
                "string",
                Some(global_id),
            );
            operation_index += 1;
            counter += 1;
        }
        set_operation_bounds(&connection, counter - 1, operation_index, 0);
        materialize_through_sequences(&mut connection);
        connection
    }

    #[test]
    fn feed_item_nodes_materialize_nested_maps_and_visible_sequence_order() {
        let mut connection = one_feed_item_graph();
        let receipt = materialize_feed_item_nodes(&mut connection).unwrap();
        assert_eq!(receipt.feed_item_count, 1);
        assert_eq!(receipt.feed_item_node_count, 10);
        let nodes = connection
            .prepare(
                "SELECT node.valueOperationIndex, node.parentValueOperationIndex, \
                        node.depth, node.segmentKind, node.propertyName, node.sequenceOrdinal \
                 FROM external_feed_item_nodes AS node \
                 ORDER BY node.valueOperationIndex;",
            )
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            nodes,
            vec![
                (1, None, 0, "entity".to_string(), None, None),
                (
                    2,
                    Some(1),
                    1,
                    "property".to_string(),
                    Some("globalId".to_string()),
                    None
                ),
                (
                    3,
                    Some(1),
                    1,
                    "property".to_string(),
                    Some("author".to_string()),
                    None
                ),
                (
                    4,
                    Some(3),
                    2,
                    "property".to_string(),
                    Some("id".to_string()),
                    None
                ),
                (
                    5,
                    Some(1),
                    1,
                    "property".to_string(),
                    Some("topics".to_string()),
                    None
                ),
                (6, Some(5), 2, "sequence".to_string(), None, Some(0)),
                (7, Some(5), 2, "sequence".to_string(), None, Some(1)),
                (
                    8,
                    Some(1),
                    1,
                    "property".to_string(),
                    Some("summary".to_string()),
                    None
                ),
                (9, Some(8), 2, "sequence".to_string(), None, Some(0)),
                (10, Some(8), 2, "sequence".to_string(), None, Some(1)),
            ]
        );
        assert_eq!(
            materialize_feed_item_nodes(&mut connection).unwrap(),
            receipt
        );
        let document_receipt = materialize_feed_item_documents(&mut connection).unwrap();
        assert_eq!(document_receipt.feed_item_count, 1);
        let stored_json = connection
            .query_row(
                "SELECT jsonText FROM external_feed_item_documents \
                 WHERE globalId = 'rss:item';",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        assert_eq!(
            stored_json,
            "{\"author\":{\"id\":\"author\"},\"globalId\":\"rss:item\",\
             \"summary\":\"hello \\\"world\\\"\\n\",\"topics\":[\"alpha\",\"beta\"]}"
        );
        assert_eq!(
            materialize_feed_item_documents(&mut connection).unwrap(),
            document_receipt
        );
        let projection_receipt = materialize_feed_item_projection_rows(&mut connection).unwrap();
        assert_eq!(projection_receipt.feed_item_count, 1);
        let projected = connection
            .query_row(
                "SELECT globalId, authorId, platform, rest, sortAt \
                 FROM external_feed_item_projection_rows \
                 WHERE entityOperationIndex = 1;",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(projected.0, "rss:item");
        assert_eq!(projected.1.as_deref(), Some("author"));
        assert_eq!(projected.2, None);
        assert_eq!(projected.4, 0);
        let rest = serde_json::from_str::<serde_json::Value>(&projected.3).unwrap();
        assert_eq!(rest["topics"], serde_json::json!(["alpha", "beta"]));
        assert_eq!(rest["summary"], "hello \"world\"\n");
        assert!(rest["__absent"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| path == "platform"));
        assert_eq!(
            materialize_feed_item_projection_rows(&mut connection).unwrap(),
            projection_receipt
        );
        connection
            .execute(
                "UPDATE external_feed_item_projection_rows \
                 SET rest = json_set(rest, '$.intruder', 1) \
                 WHERE entityOperationIndex = 1;",
                [],
            )
            .unwrap();
        assert!(matches!(
            materialize_feed_item_projection_rows(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
        connection
            .execute(
                "UPDATE external_feed_item_documents \
                 SET jsonText = replace(jsonText, 'alpha', 'gamma') \
                 WHERE globalId = 'rss:item';",
                [],
            )
            .unwrap();
        assert!(matches!(
            materialize_feed_item_documents(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));

        connection
            .execute(
                "UPDATE external_feed_item_nodes SET depth = 4 \
                 WHERE valueOperationIndex = 4;",
                [],
            )
            .unwrap();
        assert!(matches!(
            materialize_feed_item_nodes(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn verified_projection_rows_populate_and_resume_one_bounded_generation() {
        use crate::automerge_external_projection_population::{
            populate_projection_generation_from_external_stage,
            populate_projection_generation_with_test_limits, ExternalProjectionPopulationError,
        };
        use crate::shadow_store::{ProjectionSourceV1, ShadowStore, MAX_PROJECTION_BATCH_BYTES};
        use std::time::{SystemTime, UNIX_EPOCH};

        let mut connection = simple_feed_item_graph(&["rss:first", "rss:second"]);
        materialize_feed_item_nodes(&mut connection).unwrap();
        materialize_feed_item_documents(&mut connection).unwrap();
        let receipt = materialize_feed_item_projection_rows(&mut connection).unwrap();
        {
            let snapshot = open_feed_item_projection_snapshot(&mut connection).unwrap();
            for (maximum_rows, maximum_bytes) in [
                (0, MAX_PROJECTION_BATCH_BYTES),
                (MAX_PROJECTION_BATCH_ITEMS + 1, MAX_PROJECTION_BATCH_BYTES),
                (MAX_PROJECTION_BATCH_ITEMS, 0),
                (MAX_PROJECTION_BATCH_ITEMS, MAX_PROJECTION_BATCH_BYTES + 1),
            ] {
                assert!(matches!(
                    snapshot.read_page(None, maximum_rows, maximum_bytes),
                    Err(ExternalSqliteStageError::RangeOverflow)
                ));
            }
        }
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-external-projection-population-{}-{nonce}.sqlite",
            std::process::id()
        ));
        let source = ProjectionSourceV1 {
            document_id: "library".to_string(),
            heads_digest: "33".repeat(32),
            head_count: 1,
            storage_generation: 4,
            storage_save_revision: 9,
        };

        let partial = populate_projection_generation_with_test_limits(
            &mut connection,
            &path,
            "external-feed-items-v1",
            &source,
            1,
            MAX_PROJECTION_BATCH_BYTES,
            1,
        )
        .unwrap();
        assert!(!partial.complete);
        assert_eq!(partial.projected_rows, 1);
        assert_eq!(partial.next_batch_index, 1);

        let state = populate_projection_generation_from_external_stage(
            &mut connection,
            &path,
            "external-feed-items-v1",
            &source,
        )
        .unwrap();
        assert!(state.complete);
        assert_eq!(state.projected_rows, receipt.feed_item_count as usize);
        assert_eq!(state.next_batch_index, 2);
        assert_eq!(
            populate_projection_generation_from_external_stage(
                &mut connection,
                &path,
                "external-feed-items-v1",
                &source,
            )
            .unwrap(),
            state
        );

        let store = ShadowStore::open(&path).unwrap();
        let page = store.feed_page(None, 8).unwrap();
        assert_eq!(page.total_count, 2);
        assert_eq!(page.rows.len(), 2);
        drop(store);

        connection
            .execute(
                "UPDATE external_feed_item_projection_rows \
                 SET rest = json_set(rest, '$.tampered', 1);",
                [],
            )
            .unwrap();
        assert!(matches!(
            populate_projection_generation_from_external_stage(
                &mut connection,
                &path,
                "external-feed-items-v1",
                &source,
            ),
            Err(ExternalProjectionPopulationError::Stage(
                ExternalSqliteStageError::IncompleteStage
            ))
        ));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn empty_verified_projection_completes_without_an_artificial_batch() {
        use crate::automerge_external_projection_population::populate_projection_generation_from_external_stage;
        use crate::shadow_store::{ProjectionSourceV1, ShadowStore};
        use std::time::{SystemTime, UNIX_EPOCH};

        let mut connection = simple_feed_item_graph(&[]);
        materialize_feed_item_nodes(&mut connection).unwrap();
        materialize_feed_item_documents(&mut connection).unwrap();
        let receipt = materialize_feed_item_projection_rows(&mut connection).unwrap();
        assert_eq!(receipt.feed_item_count, 0);

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-empty-external-projection-population-{}-{nonce}.sqlite",
            std::process::id()
        ));
        let source = ProjectionSourceV1 {
            document_id: "empty-library".to_string(),
            heads_digest: "44".repeat(32),
            head_count: 1,
            storage_generation: 1,
            storage_save_revision: 1,
        };

        let state = populate_projection_generation_from_external_stage(
            &mut connection,
            &path,
            "empty-external-feed-items-v1",
            &source,
        )
        .unwrap();
        assert!(state.complete);
        assert_eq!(state.projected_rows, 0);
        assert_eq!(state.next_batch_index, 0);

        let store = ShadowStore::open(&path).unwrap();
        let page = store.feed_page(None, 8).unwrap();
        assert_eq!(page.total_count, 0);
        assert!(page.rows.is_empty());
        drop(store);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn feed_item_nodes_omit_a_deleted_entity_and_its_still_current_descendants() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(&connection, 1, 2, 1, "rss:deleted", 0, "null", None);
        insert_map_value(
            &connection,
            2,
            3,
            2,
            "globalId",
            1,
            "string",
            Some("rss:deleted"),
        );
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (1, 0, 0, ?1);",
                [4_u64.to_be_bytes()],
            )
            .unwrap();
        set_operation_bounds(&connection, 4, 3, 1);

        materialize_through_sequences(&mut connection);
        let receipt = materialize_feed_item_nodes(&mut connection).unwrap();
        assert_eq!(receipt.feed_item_count, 0);
        assert_eq!(receipt.feed_item_node_count, 0);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM external_resolved_values \
                     WHERE operationIndex = 2;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn feed_item_nodes_renumber_visible_sequence_values_after_a_deleted_anchor() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(&connection, 1, 2, 1, "rss:item", 0, "null", None);
        insert_map_value(&connection, 2, 3, 2, "topics", 2, "null", None);
        insert_list_value(&connection, 3, 4, 3, None, "deleted");
        insert_list_value(&connection, 4, 5, 3, Some(4), "visible");
        connection
            .execute(
                "INSERT INTO external_operation_successors \
                 (operationIndex, successorOrdinal, actorIndex, counter) \
                 VALUES (3, 0, 0, ?1);",
                [6_u64.to_be_bytes()],
            )
            .unwrap();
        set_operation_bounds(&connection, 6, 5, 1);

        materialize_through_sequences(&mut connection);
        materialize_feed_item_nodes(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT sequenceOrdinal FROM external_feed_item_nodes \
                     WHERE valueOperationIndex = 4;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM external_feed_item_nodes \
                     WHERE valueOperationIndex = 3;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn feed_item_nodes_reject_a_nonmap_entity_value() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(
            &connection,
            1,
            2,
            1,
            "rss:not-an-object",
            1,
            "string",
            Some("bad"),
        );
        set_operation_bounds(&connection, 2, 2, 0);

        materialize_through_sequences(&mut connection);
        assert!(matches!(
            materialize_feed_item_nodes(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn feed_item_documents_reject_an_entity_whose_global_id_disagrees_with_its_map_key() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(&connection, 1, 2, 1, "rss:map-key", 0, "null", None);
        insert_map_value(
            &connection,
            2,
            3,
            2,
            "globalId",
            1,
            "string",
            Some("rss:different"),
        );
        set_operation_bounds(&connection, 3, 3, 0);

        materialize_through_sequences(&mut connection);
        materialize_feed_item_nodes(&mut connection).unwrap();
        assert!(matches!(
            materialize_feed_item_documents(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn feed_item_documents_reject_a_reserved_nonfinite_escape_collision() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(&connection, 1, 2, 1, "rss:item", 0, "null", None);
        insert_map_value(
            &connection,
            2,
            3,
            2,
            "globalId",
            1,
            "string",
            Some("rss:item"),
        );
        insert_map_value(
            &connection,
            3,
            4,
            2,
            "__nonFinite",
            1,
            "string",
            Some("user-data"),
        );
        set_operation_bounds(&connection, 4, 4, 0);

        materialize_through_sequences(&mut connection);
        materialize_feed_item_nodes(&mut connection).unwrap();
        assert!(matches!(
            materialize_feed_item_documents(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn feed_item_projection_rejects_reserved_rest_collisions_without_partial_rows() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(&connection, 1, 2, 1, "rss:item", 0, "null", None);
        insert_map_value(
            &connection,
            2,
            3,
            2,
            "globalId",
            1,
            "string",
            Some("rss:item"),
        );
        insert_map_value(
            &connection,
            3,
            4,
            2,
            "__raw",
            1,
            "string",
            Some("user-data"),
        );
        set_operation_bounds(&connection, 4, 4, 0);

        materialize_through_sequences(&mut connection);
        materialize_feed_item_nodes(&mut connection).unwrap();
        materialize_feed_item_documents(&mut connection).unwrap();
        assert!(matches!(
            materialize_feed_item_projection_rows(&mut connection),
            Err(ExternalSqliteStageError::Projection(
                FeedItemProjectionError::ReservedRestKey { .. }
            ))
        ));
        assert_eq!(
            connection
                .query_row(
                    "SELECT \
                       (SELECT COUNT(*) FROM external_feed_item_projection_rows), \
                       (SELECT COUNT(*) FROM external_feed_item_projection_receipt);",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .unwrap(),
            (0, 0)
        );
    }

    #[test]
    fn feed_item_json_scalars_preserve_javascript_number_limits() {
        let negative_zero = lower_hex(&(-0.0_f64).to_le_bytes());
        assert!(matches!(
            scalar_json_value("float", Some(&negative_zero), &[], None),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));

        let infinity = lower_hex(&f64::INFINITY.to_le_bytes());
        assert_eq!(
            scalar_json_value("float", Some(&infinity), &[], None).unwrap(),
            "{\"__nonFinite\":\"Infinity\"}"
        );
        let negative_infinity = lower_hex(&f64::NEG_INFINITY.to_le_bytes());
        assert_eq!(
            scalar_json_value("float", Some(&negative_infinity), &[], None).unwrap(),
            "{\"__nonFinite\":\"-Infinity\"}"
        );
        let nan = lower_hex(&f64::NAN.to_le_bytes());
        assert_eq!(
            scalar_json_value("float", Some(&nan), &[], None).unwrap(),
            "{\"__nonFinite\":\"NaN\"}"
        );
        assert!(matches!(
            scalar_json_value("unsigned", Some("9007199254740992"), &[], None),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
        assert!(matches!(
            scalar_json_value("bytes", None, b"opaque", None),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }

    #[test]
    fn feed_item_nodes_reject_more_than_128_nested_object_levels() {
        let mut connection = complete_minimal_graph();
        connection
            .execute(
                "UPDATE external_operations SET keyName = 'feedItems', action = 0 \
                 WHERE operationIndex = 0;",
                [],
            )
            .unwrap();
        insert_map_value(&connection, 1, 2, 1, "rss:deep", 0, "null", None);
        let mut parent_counter = 2_u64;
        for depth in 1..=129_u64 {
            let counter = depth + 2;
            insert_map_value(
                &connection,
                i64::try_from(depth + 1).unwrap(),
                counter,
                parent_counter,
                "child",
                0,
                "null",
                None,
            );
            parent_counter = counter;
        }
        set_operation_bounds(&connection, 131, 131, 0);

        materialize_through_sequences(&mut connection);
        assert!(matches!(
            materialize_feed_item_nodes(&mut connection),
            Err(ExternalSqliteStageError::IncompleteStage)
        ));
    }
}
