//! Crash-resumable native SQLite generation for one bounded feed browse query.
//!
//! The active product still reads Automerge. This store is a dormant Gate B
//! primitive that accepts only already-filtered, already-ranked compact cards,
//! binds them to one immutable query identity, and performs the final keyset
//! order inside SQLite.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::Write;
use std::path::Path;
use std::time::Duration;

const SCHEMA_V1_SQL: &str =
    include_str!("../../../shared/src/library-core/feed-browse-generation-schema-v1.sql");
const APPLICATION_ID: i64 = 1_178_751_575;
const SCHEMA_VERSION: i64 = 1;
const MAXIMUM_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAXIMUM_TOTAL_ROWS: i64 = 250_000;
const MAXIMUM_PAGE_ROWS: usize = 128;
const MAXIMUM_PAGE_INPUT_BYTES: usize = 2 * 1_048_576;
const MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const RESPONSE_FIXED_OVERHEAD_BYTES: usize = 1_024;
const MAXIMUM_FILTER_BYTES: usize = 1_048_576;
const MAXIMUM_CARD_BYTES: usize = 262_144;
const BASE_CACHE_KIB: i64 = -4 * 1_024;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub(super) enum FeedBrowseStoreError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    Invalid(&'static str),
    IdentityConflict,
    CursorStale,
    BatchConflict,
    Incomplete,
    ResponseTooLarge,
}

impl From<rusqlite::Error> for FeedBrowseStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<std::io::Error> for FeedBrowseStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for FeedBrowseStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Sql(error) => write!(formatter, "{error}"),
            Self::Invalid(field) => write!(formatter, "invalid feed browse {field}"),
            Self::IdentityConflict => {
                formatter.write_str("feed browse generation identity conflicts with stored state")
            }
            Self::CursorStale => {
                formatter.write_str("feed browse cursor does not match the stored generation")
            }
            Self::BatchConflict => {
                formatter.write_str("feed browse page conflicts with stored batch state")
            }
            Self::Incomplete => formatter.write_str("feed browse generation is incomplete"),
            Self::ResponseTooLarge => {
                formatter.write_str("feed browse page exceeds its response byte ceiling")
            }
        }
    }
}

impl std::error::Error for FeedBrowseStoreError {}

type StoreResult<T> = Result<T, FeedBrowseStoreError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FeedBrowseGenerationBinding {
    pub(super) generation_id: String,
    pub(super) source_document_id: String,
    pub(super) source_heads_digest: String,
    pub(super) source_head_count: i64,
    pub(super) transition_sequence: i64,
    pub(super) projection_revision: i64,
    pub(super) filter_json: String,
    pub(super) ranking_clock_ms: i64,
    pub(super) recommendation_order_schema_version: i64,
    pub(super) total_rows: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FeedBrowseProjectedRow {
    pub(super) priority: i64,
    pub(super) published_at: i64,
    pub(super) source_sequence: i64,
    pub(super) global_id: String,
    pub(super) card_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FeedBrowseCursor {
    pub(super) generation_id: String,
    pub(super) transition_sequence: i64,
    pub(super) projection_revision: i64,
    pub(super) priority: i64,
    pub(super) published_at: i64,
    pub(super) source_sequence: i64,
    pub(super) global_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FeedBrowsePage {
    pub(super) binding: FeedBrowseGenerationBinding,
    pub(super) rows: Vec<FeedBrowseProjectedRow>,
    pub(super) next_cursor: Option<FeedBrowseCursor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FeedBrowseGenerationState {
    Staging,
    Complete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FeedBrowseGenerationProgress {
    pub(super) next_batch_index: i64,
    pub(super) written_rows: i64,
    pub(super) total_rows: i64,
    pub(super) complete: bool,
}

pub(super) struct FeedBrowseGenerationStore {
    connection: Connection,
}

impl FeedBrowseGenerationStore {
    pub(super) fn open(path: &Path) -> StoreResult<Self> {
        let file_name = path
            .file_name()
            .ok_or(FeedBrowseStoreError::Invalid("database path"))?;
        let parent = path
            .parent()
            .filter(|candidate| !candidate.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let resolved_path = parent.canonicalize()?.join(file_name);
        let existing = resolved_path.try_exists()?;
        if existing {
            let preflight = Connection::open_with_flags(
                &resolved_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                    | OpenFlags::SQLITE_OPEN_NOFOLLOW
                    | OpenFlags::SQLITE_OPEN_EXRESCODE,
            )?;
            validate_open_identity(&preflight)?;
        }
        let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_EXRESCODE;
        if !existing {
            flags |= OpenFlags::SQLITE_OPEN_CREATE;
        }
        let connection = Connection::open_with_flags(&resolved_path, flags)?;
        validate_open_identity(&connection)?;
        let mut store = Self { connection };
        store.configure()?;
        store.migrate()?;
        Ok(store)
    }

    #[cfg(test)]
    fn open_in_memory() -> StoreResult<Self> {
        let connection = Connection::open_in_memory()?;
        let mut store = Self { connection };
        store.configure()?;
        store.migrate()?;
        Ok(store)
    }

    fn configure(&self) -> StoreResult<()> {
        self.connection.pragma_update(None, "journal_mode", "WAL")?;
        self.connection
            .pragma_update(None, "synchronous", "NORMAL")?;
        self.connection.pragma_update(None, "foreign_keys", "ON")?;
        self.connection
            .pragma_update(None, "cache_size", BASE_CACHE_KIB)?;
        self.connection.pragma_update(None, "mmap_size", 0)?;
        self.connection.pragma_update(None, "temp_store", "FILE")?;
        self.connection
            .pragma_update(None, "cell_size_check", "ON")?;
        self.connection.busy_timeout(BUSY_TIMEOUT)?;
        Ok(())
    }

    fn migrate(&mut self) -> StoreResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior =
            transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        let application_id =
            transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
        let has_tables = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%');",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if prior == 0 && !has_tables && application_id == 0 {
            transaction.execute_batch(SCHEMA_V1_SQL)?;
        } else if prior != SCHEMA_VERSION || application_id != APPLICATION_ID {
            return Err(FeedBrowseStoreError::Invalid("schema identity"));
        }
        transaction.commit()?;
        Ok(())
    }

    pub(super) fn begin(
        &mut self,
        binding: &FeedBrowseGenerationBinding,
    ) -> StoreResult<FeedBrowseGenerationState> {
        validate_binding(binding)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = read_binding(&transaction).optional()?;
        if let Some((stored, complete)) = existing {
            if stored != *binding {
                return Err(FeedBrowseStoreError::IdentityConflict);
            }
            transaction.commit()?;
            return Ok(if complete {
                FeedBrowseGenerationState::Complete
            } else {
                FeedBrowseGenerationState::Staging
            });
        }
        transaction.execute(
            "INSERT INTO feed_browse_generation (
               singleton, generationId, sourceDocumentId, sourceHeadsDigest,
               sourceHeadCount, transitionSequence, projectionRevision,
               filterJson, rankingClockMs, recommendationOrderSchemaVersion, totalRows
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
            params![
                &binding.generation_id,
                &binding.source_document_id,
                &binding.source_heads_digest,
                binding.source_head_count,
                binding.transition_sequence,
                binding.projection_revision,
                &binding.filter_json,
                binding.ranking_clock_ms,
                binding.recommendation_order_schema_version,
                binding.total_rows,
            ],
        )?;
        transaction.commit()?;
        Ok(FeedBrowseGenerationState::Staging)
    }

    pub(super) fn append_page(
        &mut self,
        batch_index: i64,
        rows: &[FeedBrowseProjectedRow],
    ) -> StoreResult<()> {
        validate_page(batch_index, rows)?;
        let page_digest = page_digest(rows)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (_, complete) = read_binding(&transaction)
            .optional()?
            .ok_or(FeedBrowseStoreError::Incomplete)?;
        if complete {
            return Err(FeedBrowseStoreError::BatchConflict);
        }
        if let Some((stored_digest, stored_rows)) = transaction
            .query_row(
                "SELECT pageDigest, rowCount FROM feed_browse_batches WHERE batchIndex = ?1;",
                params![batch_index],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?
        {
            if stored_digest == page_digest && stored_rows == rows.len() as i64 {
                transaction.commit()?;
                return Ok(());
            }
            return Err(FeedBrowseStoreError::BatchConflict);
        }
        let (next_batch_index, written_rows, total_rows) = transaction.query_row(
            "SELECT nextBatchIndex, writtenRows, totalRows
             FROM feed_browse_generation WHERE singleton = 1;",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?;
        if batch_index != next_batch_index {
            return Err(FeedBrowseStoreError::BatchConflict);
        }
        let cumulative_rows = written_rows
            .checked_add(rows.len() as i64)
            .ok_or(FeedBrowseStoreError::Invalid("row count"))?;
        if cumulative_rows > total_rows {
            return Err(FeedBrowseStoreError::Invalid("row count"));
        }
        {
            let mut insert = transaction.prepare_cached(
                "INSERT INTO feed_browse_rows (
                   priority, publishedAt, sourceSequence, globalId, cardJson
                 ) VALUES (?1, ?2, ?3, ?4, ?5);",
            )?;
            for row in rows {
                insert.execute(params![
                    row.priority,
                    row.published_at,
                    row.source_sequence,
                    &row.global_id,
                    &row.card_json,
                ])?;
            }
        }
        transaction.execute(
            "INSERT INTO feed_browse_batches (
               batchIndex, pageDigest, rowCount, cumulativeRows
             ) VALUES (?1, ?2, ?3, ?4);",
            params![batch_index, page_digest, rows.len() as i64, cumulative_rows,],
        )?;
        transaction.execute(
            "UPDATE feed_browse_generation
             SET writtenRows = ?1, nextBatchIndex = nextBatchIndex + 1
             WHERE singleton = 1;",
            params![cumulative_rows],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub(super) fn finalize(&mut self) -> StoreResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (written_rows, total_rows, complete) = transaction.query_row(
            "SELECT writtenRows, totalRows, complete
             FROM feed_browse_generation WHERE singleton = 1;",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )?;
        if complete {
            transaction.commit()?;
            return Ok(());
        }
        let physical_rows =
            transaction.query_row("SELECT COUNT(*) FROM feed_browse_rows;", [], |row| {
                row.get::<_, i64>(0)
            })?;
        if written_rows != total_rows || physical_rows != total_rows {
            return Err(FeedBrowseStoreError::Incomplete);
        }
        transaction.execute(
            "UPDATE feed_browse_generation SET complete = 1 WHERE singleton = 1;",
            [],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub(super) fn progress(&self) -> StoreResult<FeedBrowseGenerationProgress> {
        self.connection
            .query_row(
                "SELECT nextBatchIndex, writtenRows, totalRows, complete
                 FROM feed_browse_generation WHERE singleton = 1;",
                [],
                |row| {
                    Ok(FeedBrowseGenerationProgress {
                        next_batch_index: row.get(0)?,
                        written_rows: row.get(1)?,
                        total_rows: row.get(2)?,
                        complete: row.get(3)?,
                    })
                },
            )
            .map_err(FeedBrowseStoreError::from)
    }

    pub(super) fn read_page(
        &self,
        cursor: Option<&FeedBrowseCursor>,
        limit: usize,
    ) -> StoreResult<FeedBrowsePage> {
        if !(1..=MAXIMUM_PAGE_ROWS).contains(&limit) {
            return Err(FeedBrowseStoreError::Invalid("page limit"));
        }
        let transaction = self.connection.unchecked_transaction()?;
        let (binding, complete) = read_binding(&transaction)
            .optional()?
            .ok_or(FeedBrowseStoreError::Incomplete)?;
        if !complete {
            return Err(FeedBrowseStoreError::Incomplete);
        }
        let (rows, truncated_by_bytes) = if let Some(cursor) = cursor {
            validate_cursor(cursor)?;
            if cursor.generation_id != binding.generation_id
                || cursor.transition_sequence != binding.transition_sequence
                || cursor.projection_revision != binding.projection_revision
            {
                return Err(FeedBrowseStoreError::CursorStale);
            }
            let mut statement = transaction.prepare_cached(
                "SELECT priority, publishedAt, sourceSequence, globalId, cardJson
                 FROM feed_browse_rows
                 WHERE priority < ?1
                    OR (priority = ?1 AND publishedAt < ?2)
                    OR (priority = ?1 AND publishedAt = ?2 AND sourceSequence > ?3)
                    OR (priority = ?1 AND publishedAt = ?2
                        AND sourceSequence = ?3 AND globalId > ?4)
                 ORDER BY priority DESC, publishedAt DESC, sourceSequence ASC, globalId ASC
                 LIMIT ?5;",
            )?;
            let mut query = statement.query(params![
                cursor.priority,
                cursor.published_at,
                cursor.source_sequence,
                &cursor.global_id,
                limit as i64,
            ])?;
            collect_bounded_rows(&mut query, &binding)?
        } else {
            let mut statement = transaction.prepare_cached(
                "SELECT priority, publishedAt, sourceSequence, globalId, cardJson
                 FROM feed_browse_rows
                 ORDER BY priority DESC, publishedAt DESC, sourceSequence ASC, globalId ASC
                 LIMIT ?1;",
            )?;
            let mut query = statement.query(params![limit as i64])?;
            collect_bounded_rows(&mut query, &binding)?
        };
        let next_cursor = if truncated_by_bytes || rows.len() == limit {
            rows.last().map(|row| cursor_from_row(row, &binding))
        } else {
            None
        };
        transaction.commit()?;
        Ok(FeedBrowsePage {
            binding,
            rows,
            next_cursor,
        })
    }
}

fn validate_open_identity(connection: &Connection) -> StoreResult<()> {
    let version =
        connection.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
    let application_id =
        connection.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
    let has_tables = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%');",
        [],
        |row| row.get::<_, bool>(0),
    )?;
    if (version == 0 && application_id == 0 && !has_tables)
        || (version == SCHEMA_VERSION && application_id == APPLICATION_ID)
    {
        return Ok(());
    }
    Err(FeedBrowseStoreError::Invalid("schema identity"))
}

fn read_binding(
    transaction: &rusqlite::Transaction<'_>,
) -> rusqlite::Result<(FeedBrowseGenerationBinding, bool)> {
    transaction.query_row(
        "SELECT generationId, sourceDocumentId, sourceHeadsDigest, sourceHeadCount,
                transitionSequence, projectionRevision, filterJson, rankingClockMs,
                recommendationOrderSchemaVersion, totalRows, complete
         FROM feed_browse_generation WHERE singleton = 1;",
        [],
        |row| {
            Ok((
                FeedBrowseGenerationBinding {
                    generation_id: row.get(0)?,
                    source_document_id: row.get(1)?,
                    source_heads_digest: row.get(2)?,
                    source_head_count: row.get(3)?,
                    transition_sequence: row.get(4)?,
                    projection_revision: row.get(5)?,
                    filter_json: row.get(6)?,
                    ranking_clock_ms: row.get(7)?,
                    recommendation_order_schema_version: row.get(8)?,
                    total_rows: row.get(9)?,
                },
                row.get(10)?,
            ))
        },
    )
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<FeedBrowseProjectedRow> {
    Ok(FeedBrowseProjectedRow {
        priority: row.get(0)?,
        published_at: row.get(1)?,
        source_sequence: row.get(2)?,
        global_id: row.get(3)?,
        card_json: row.get(4)?,
    })
}

fn collect_bounded_rows(
    query: &mut rusqlite::Rows<'_>,
    binding: &FeedBrowseGenerationBinding,
) -> StoreResult<(Vec<FeedBrowseProjectedRow>, bool)> {
    let mut rows = Vec::with_capacity(MAXIMUM_PAGE_ROWS);
    let mut response_bytes = binding
        .filter_json
        .len()
        .saturating_add(RESPONSE_FIXED_OVERHEAD_BYTES);
    while let Some(sql_row) = query.next()? {
        let row = row_from_sql(sql_row)?;
        validate_row(&row)?;
        let row_bytes = row.card_json.len().saturating_add(1);
        if response_bytes.saturating_add(row_bytes) > MAXIMUM_RESPONSE_BYTES {
            if rows.is_empty() {
                return Err(FeedBrowseStoreError::ResponseTooLarge);
            }
            return Ok((rows, true));
        }
        response_bytes = response_bytes.saturating_add(row_bytes);
        rows.push(row);
    }
    Ok((rows, false))
}

fn cursor_from_row(
    row: &FeedBrowseProjectedRow,
    binding: &FeedBrowseGenerationBinding,
) -> FeedBrowseCursor {
    FeedBrowseCursor {
        generation_id: binding.generation_id.clone(),
        transition_sequence: binding.transition_sequence,
        projection_revision: binding.projection_revision,
        priority: row.priority,
        published_at: row.published_at,
        source_sequence: row.source_sequence,
        global_id: row.global_id.clone(),
    }
}

fn validate_binding(binding: &FeedBrowseGenerationBinding) -> StoreResult<()> {
    if !is_lower_sha256(&binding.generation_id)
        || binding.source_document_id.is_empty()
        || binding.source_document_id.len() > 4_096
        || !is_lower_sha256(&binding.source_heads_digest)
        || !is_safe_integer(binding.source_head_count)
        || !is_safe_integer(binding.transition_sequence)
        || !is_safe_integer(binding.projection_revision)
        || !is_safe_integer(binding.ranking_clock_ms)
        || binding.recommendation_order_schema_version != 1
        || !(0..=MAXIMUM_TOTAL_ROWS).contains(&binding.total_rows)
        || binding.filter_json.is_empty()
        || binding.filter_json.len() > MAXIMUM_FILTER_BYTES
        || serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&binding.filter_json)
            .is_err()
    {
        return Err(FeedBrowseStoreError::Invalid("generation binding"));
    }
    Ok(())
}

fn validate_page(batch_index: i64, rows: &[FeedBrowseProjectedRow]) -> StoreResult<()> {
    if !is_safe_integer(batch_index) || !(1..=MAXIMUM_PAGE_ROWS).contains(&rows.len()) {
        return Err(FeedBrowseStoreError::Invalid("page"));
    }
    for row in rows {
        validate_row(row)?;
    }
    Ok(())
}

fn validate_row(row: &FeedBrowseProjectedRow) -> StoreResult<()> {
    if !(0..=100).contains(&row.priority)
        || !is_safe_integer(row.published_at)
        || !is_safe_integer(row.source_sequence)
        || row.global_id.is_empty()
        || row.global_id.len() > 4_096
        || row.card_json.is_empty()
        || row.card_json.len() > MAXIMUM_CARD_BYTES
    {
        return Err(FeedBrowseStoreError::Invalid("row"));
    }
    let card = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&row.card_json)
        .map_err(|_| FeedBrowseStoreError::Invalid("card JSON"))?;
    if card.get("globalId").and_then(serde_json::Value::as_str) != Some(row.global_id.as_str()) {
        return Err(FeedBrowseStoreError::Invalid("card identity"));
    }
    Ok(())
}

fn validate_cursor(cursor: &FeedBrowseCursor) -> StoreResult<()> {
    if !is_lower_sha256(&cursor.generation_id)
        || !is_safe_integer(cursor.transition_sequence)
        || !is_safe_integer(cursor.projection_revision)
        || !(0..=100).contains(&cursor.priority)
        || !is_safe_integer(cursor.published_at)
        || !is_safe_integer(cursor.source_sequence)
        || cursor.global_id.is_empty()
        || cursor.global_id.len() > 4_096
    {
        return Err(FeedBrowseStoreError::Invalid("cursor"));
    }
    Ok(())
}

fn page_digest(rows: &[FeedBrowseProjectedRow]) -> StoreResult<String> {
    struct BoundedDigestWriter {
        bytes: usize,
        digest: Sha256,
        overflowed: bool,
    }

    impl Write for BoundedDigestWriter {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            let Some(next) = self
                .bytes
                .checked_add(buffer.len())
                .filter(|value| *value <= MAXIMUM_PAGE_INPUT_BYTES)
            else {
                self.overflowed = true;
                return Err(std::io::Error::other("feed browse page is too large"));
            };
            self.digest.update(buffer);
            self.bytes = next;
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let mut writer = BoundedDigestWriter {
        bytes: 0,
        digest: Sha256::new(),
        overflowed: false,
    };
    if serde_json::to_writer(&mut writer, rows).is_err() {
        return Err(FeedBrowseStoreError::Invalid(if writer.overflowed {
            "page bytes"
        } else {
            "page encoding"
        }));
    }
    Ok(lower_hex(&writer.digest.finalize()))
}

fn is_safe_integer(value: i64) -> bool {
    (0..=MAXIMUM_SAFE_INTEGER).contains(&value)
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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

    fn binding(total_rows: i64) -> FeedBrowseGenerationBinding {
        FeedBrowseGenerationBinding {
            generation_id: "a".repeat(64),
            source_document_id: "library-1".to_string(),
            source_heads_digest: "b".repeat(64),
            source_head_count: 2,
            transition_sequence: 7,
            projection_revision: 11,
            filter_json: r#"{"schemaVersion":1}"#.to_string(),
            ranking_clock_ms: 1_780_000_000_000,
            recommendation_order_schema_version: 1,
            total_rows,
        }
    }

    fn projected(
        id: &str,
        priority: i64,
        published_at: i64,
        source_sequence: i64,
    ) -> FeedBrowseProjectedRow {
        FeedBrowseProjectedRow {
            priority,
            published_at,
            source_sequence,
            global_id: id.to_string(),
            card_json: format!(r#"{{"globalId":"{id}","contentText":"bounded"}}"#),
        }
    }

    #[test]
    fn stages_replays_and_reads_the_exact_physical_order() {
        let mut store = FeedBrowseGenerationStore::open_in_memory().expect("store");
        let identity = binding(4);
        assert_eq!(
            store.begin(&identity).expect("begin"),
            FeedBrowseGenerationState::Staging
        );
        let first = vec![
            projected("x:third", 50, 30, 3),
            projected("x:first", 90, 20, 1),
        ];
        let second = vec![
            projected("x:fourth", 50, 30, 4),
            projected("x:second", 90, 10, 2),
        ];
        store.append_page(0, &first).expect("first page");
        store.append_page(0, &first).expect("first replay");
        store.append_page(1, &second).expect("second page");
        store.finalize().expect("finalize");
        assert_eq!(
            store.begin(&identity).expect("complete replay"),
            FeedBrowseGenerationState::Complete
        );

        let page_one = store.read_page(None, 2).expect("page one");
        assert_eq!(
            page_one
                .rows
                .iter()
                .map(|row| row.global_id.as_str())
                .collect::<Vec<_>>(),
            vec!["x:first", "x:second"]
        );
        let page_two = store
            .read_page(page_one.next_cursor.as_ref(), 2)
            .expect("page two");
        assert_eq!(
            page_two
                .rows
                .iter()
                .map(|row| row.global_id.as_str())
                .collect::<Vec<_>>(),
            vec!["x:third", "x:fourth"]
        );
        assert_eq!(
            page_two
                .next_cursor
                .as_ref()
                .map(|cursor| cursor.global_id.as_str()),
            Some("x:fourth")
        );
        assert_eq!(
            store
                .read_page(page_two.next_cursor.as_ref(), 2)
                .expect("end")
                .rows,
            vec![]
        );
    }

    #[test]
    fn rejects_changed_replay_identity_and_incomplete_reads() {
        let mut store = FeedBrowseGenerationStore::open_in_memory().expect("store");
        let identity = binding(1);
        store.begin(&identity).expect("begin");
        assert!(matches!(
            store.read_page(None, 1),
            Err(FeedBrowseStoreError::Incomplete)
        ));
        let rows = vec![projected("x:item", 40, 20, 0)];
        store.append_page(0, &rows).expect("append");
        let changed = vec![projected("x:item", 41, 20, 0)];
        assert!(matches!(
            store.append_page(0, &changed),
            Err(FeedBrowseStoreError::BatchConflict)
        ));
        let mut conflicting = identity.clone();
        conflicting.ranking_clock_ms += 1;
        assert!(matches!(
            store.begin(&conflicting),
            Err(FeedBrowseStoreError::IdentityConflict)
        ));
        let mut conflicting_source = identity.clone();
        conflicting_source.source_heads_digest = "c".repeat(64);
        assert!(matches!(
            store.begin(&conflicting_source),
            Err(FeedBrowseStoreError::IdentityConflict)
        ));
    }

    #[test]
    fn rejects_a_cursor_bound_to_a_different_generation() {
        let mut store = FeedBrowseGenerationStore::open_in_memory().expect("store");
        store.begin(&binding(1)).expect("begin");
        store
            .append_page(0, &[projected("x:item", 40, 20, 0)])
            .expect("append");
        store.finalize().expect("finalize");
        let mut cursor = store
            .read_page(None, 1)
            .expect("page")
            .next_cursor
            .expect("cursor");
        cursor.generation_id = "b".repeat(64);
        assert!(matches!(
            store.read_page(Some(&cursor), 1),
            Err(FeedBrowseStoreError::CursorStale)
        ));
    }

    #[test]
    fn persists_the_generation_contract_on_disk() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let path = temporary.path().join("browse.sqlite");
        let identity = binding(0);
        {
            let mut store = FeedBrowseGenerationStore::open(&path).expect("store");
            store.begin(&identity).expect("begin");
            store.finalize().expect("finalize");
        }
        let mut store = FeedBrowseGenerationStore::open(&path).expect("reopen");
        assert_eq!(
            store.begin(&identity).expect("complete replay"),
            FeedBrowseGenerationState::Complete
        );
        assert_eq!(store.read_page(None, 8).expect("read").rows, vec![]);
        assert_eq!(
            store
                .connection
                .pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))
                .expect("application id"),
            APPLICATION_ID
        );
        assert_eq!(
            store
                .connection
                .pragma_query_value(None, "cache_size", |row| row.get::<_, i64>(0))
                .expect("cache size"),
            BASE_CACHE_KIB
        );
        assert_eq!(
            store
                .connection
                .pragma_query_value(None, "mmap_size", |row| row.get::<_, i64>(0))
                .expect("mmap size"),
            0
        );
    }

    #[test]
    fn rejects_a_foreign_file_before_writable_configuration() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let path = temporary.path().join("foreign.sqlite");
        {
            let connection = Connection::open(&path).expect("foreign store");
            connection
                .execute("CREATE TABLE unrelated (value TEXT);", [])
                .expect("foreign schema");
        }
        let before = std::fs::read(&path).expect("before");
        assert!(matches!(
            FeedBrowseGenerationStore::open(&path),
            Err(FeedBrowseStoreError::Invalid("schema identity"))
        ));
        assert_eq!(std::fs::read(&path).expect("after"), before);
        assert!(!path.with_extension("sqlite-wal").exists());
        assert!(!path.with_extension("sqlite-shm").exists());
    }

    #[test]
    fn keyset_reads_use_the_physical_order_index_without_a_temp_sort() {
        fn plan_details<P: rusqlite::Params>(
            connection: &Connection,
            sql: &str,
            parameters: P,
        ) -> String {
            let mut statement = connection.prepare(sql).expect("plan");
            statement
                .query_map(parameters, |row| row.get::<_, String>(3))
                .expect("query plan")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("plan rows")
                .join(" ")
        }

        let store = FeedBrowseGenerationStore::open_in_memory().expect("store");
        let plans = [
            plan_details(
                &store.connection,
                "EXPLAIN QUERY PLAN
                 SELECT priority, publishedAt, sourceSequence, globalId, cardJson
                 FROM feed_browse_rows
                 ORDER BY priority DESC, publishedAt DESC, sourceSequence ASC, globalId ASC
                 LIMIT ?1;",
                params![8_i64],
            ),
            plan_details(
                &store.connection,
                "EXPLAIN QUERY PLAN
                 SELECT priority, publishedAt, sourceSequence, globalId, cardJson
                 FROM feed_browse_rows
                 WHERE priority < ?1
                    OR (priority = ?1 AND publishedAt < ?2)
                    OR (priority = ?1 AND publishedAt = ?2 AND sourceSequence > ?3)
                    OR (priority = ?1 AND publishedAt = ?2
                        AND sourceSequence = ?3 AND globalId > ?4)
                 ORDER BY priority DESC, publishedAt DESC, sourceSequence ASC, globalId ASC
                 LIMIT ?5;",
                params![90_i64, 20_i64, 1_i64, "x:item", 8_i64],
            ),
        ];
        for details in plans {
            assert!(details.contains("feed_browse_rows_order"), "{details}");
            assert!(!details.contains("TEMP B-TREE"), "{details}");
        }
    }

    #[test]
    fn rejects_oversized_and_mismatched_cards_before_sqlite() {
        let mut store = FeedBrowseGenerationStore::open_in_memory().expect("store");
        store.begin(&binding(1)).expect("begin");
        let mut mismatched = projected("x:item", 10, 20, 0);
        mismatched.card_json = r#"{"globalId":"x:other"}"#.to_string();
        assert!(matches!(
            store.append_page(0, &[mismatched]),
            Err(FeedBrowseStoreError::Invalid("card identity"))
        ));
        let mut oversized = projected("x:item", 10, 20, 0);
        oversized.card_json = format!(
            r#"{{"globalId":"x:item","contentText":"{}"}}"#,
            "x".repeat(MAXIMUM_CARD_BYTES)
        );
        assert!(matches!(
            store.append_page(0, &[oversized]),
            Err(FeedBrowseStoreError::Invalid("row"))
        ));
        let page_too_large = (0..9)
            .map(|index| {
                let mut row = projected(&format!("x:{index}"), 10, 20, index);
                row.card_json = format!(
                    r#"{{"globalId":"x:{index}","contentText":"{}"}}"#,
                    "x".repeat(240_000)
                );
                row
            })
            .collect::<Vec<_>>();
        assert!(matches!(
            store.append_page(0, &page_too_large),
            Err(FeedBrowseStoreError::Invalid("page bytes"))
        ));
    }

    #[test]
    fn streams_large_rows_under_the_response_ceiling() {
        let mut store = FeedBrowseGenerationStore::open_in_memory().expect("store");
        store.begin(&binding(9)).expect("begin");
        let rows = (0..9)
            .map(|index| {
                let mut row = projected(&format!("x:{index}"), 10, 20, index);
                row.card_json = format!(
                    r#"{{"globalId":"x:{index}","contentText":"{}"}}"#,
                    "x".repeat(240_000)
                );
                row
            })
            .collect::<Vec<_>>();
        store.append_page(0, &rows[..5]).expect("first page");
        store.append_page(1, &rows[5..]).expect("second page");
        store.finalize().expect("finalize");

        let first = store.read_page(None, 9).expect("bounded first page");
        assert!(first.rows.len() < 9);
        let second = store
            .read_page(first.next_cursor.as_ref(), 9)
            .expect("bounded second page");
        assert_eq!(first.rows.len() + second.rows.len(), 9);
    }

    #[test]
    fn read_only_open_flags_cannot_mutate_a_generation() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let path = temporary.path().join("browse.sqlite");
        {
            let mut store = FeedBrowseGenerationStore::open(&path).expect("store");
            store.begin(&binding(0)).expect("begin");
            store.finalize().expect("finalize");
        }
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .expect("read only");
        assert!(connection
            .execute("DELETE FROM feed_browse_generation;", [])
            .is_err());
    }
}
