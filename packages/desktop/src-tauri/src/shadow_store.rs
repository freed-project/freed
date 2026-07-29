//! Native SQLite shadow store.
//!
//! The engine behind the Library Core migration. Until this module existed the
//! storage work was schema, projection, and contract with nothing to execute
//! them, which is why none of it had moved a byte of renderer memory.
//!
//! What lives here is deliberately narrow: open, migrate, upsert, and read a
//! bounded page. It owns no policy. The projection that produces rows is in
//! `packages/shared/src/projection.ts` and is proven lossless against the real
//! corpus; the ordering it reads by is the resolved `feed_page_v1` sort
//! contract in `packages/shared/src/library-core/query-registry.ts`.
//!
//! Two invariants are load bearing and both are tested below.
//!
//! 1. Rust executes the same checked-in SQL file that the TypeScript store
//!    contract verifies. Two engines writing the same file with different
//!    opinions about a column is how a store silently starts losing data.
//!
//! 2. A page must cost what a page costs, not what the library costs. The
//!    keyset predicate and the `feed_items_timeline` index exist so a page is
//!    an index range scan. If SQLite ever answers one with `USE TEMP B-TREE FOR
//!    ORDER BY` it is sorting the whole remaining set per page, and the result
//!    is bounded while the work behind it is not. That is the exact failure
//!    this migration exists to remove, so a test asserts the query plan.

use rusqlite::{
    params, Connection, OptionalExtension, Result as SqlResult, Row, Transaction,
    TransactionBehavior,
};
use std::path::Path;
use std::time::Duration;

const SHADOW_SCHEMA_VERSION: i64 = 2;
const MAX_FEED_PAGE_LIMIT: u32 = 128;
const MAX_PROJECTION_BATCH_ID_BYTES: usize = 128;
const MAX_PROJECTION_BATCH_ITEMS: usize = 1_000;
const MAX_PROJECTION_BATCH_BYTES: usize = 4 * 1024 * 1024;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const BASE_CACHE_KIB: i64 = -32 * 1024;

#[derive(Debug)]
enum ShadowStoreError {
    Sql(rusqlite::Error),
    StaleRevision { expected: i64, actual: i64 },
    InvalidPageLimit { requested: u32, maximum: u32 },
    InvalidProjectionBatchIdentity { field: &'static str },
    InvalidProjectionBatchSize { requested: usize, maximum: usize },
    InvalidProjectionBatchBytes { requested: usize, maximum: usize },
    ProjectionBatchReplayConflict { batch_id: String },
    UnsupportedSchemaVersion { expected: i64, actual: i64 },
    UnversionedSchemaPresent,
}

impl From<rusqlite::Error> for ShadowStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

type StoreResult<T> = std::result::Result<T, ShadowStoreError>;

/// One canonical schema is consumed by the native engine and checked against
/// the shared TypeScript DDL. This avoids maintaining a second handwritten
/// schema in Rust.
const SHADOW_SCHEMA_V1_SQL: &str =
    include_str!("../../../shared/src/library-core/shadow-schema-v1.sql");
const SHADOW_SCHEMA_V2_SQL: &str =
    include_str!("../../../shared/src/library-core/shadow-schema-v2.sql");

/// Sort position for an item whose `publishedAt` is absent or unusable.
///
/// Ordering is `sortAt DESC`, so this places undated items at the far end of
/// the timeline. It is not a timestamp and is never presented as one.
const SORT_AT_ABSENT: i64 = 0;

/// One projected row. Field order matches `SHADOW_COLUMNS`.
#[derive(Debug, Clone, PartialEq)]
struct FeedItemRow {
    pub global_id: String,
    pub platform: Option<String>,
    pub content_type: Option<String>,
    pub published_at: Option<i64>,
    pub captured_at: Option<i64>,
    pub author_id: Option<String>,
    pub author_display_name: Option<String>,
    pub author_handle: Option<String>,
    pub source_url: Option<String>,
    pub hidden: Option<i64>,
    pub saved: Option<i64>,
    pub archived: Option<i64>,
    pub read_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub liked_at: Option<i64>,
    pub tags: Option<String>,
    pub content_blob: Option<String>,
    pub preserved_blob: Option<String>,
    pub rest: String,
}

impl FeedItemRow {
    /// The derived sort key.
    ///
    /// Defensive because it must satisfy NOT NULL for every row the table will
    /// accept. A `publishedAt` that is absent sorts at the sentinel; anything
    /// else sorts at its own value.
    pub fn sort_key(&self) -> i64 {
        self.published_at.unwrap_or(SORT_AT_ABSENT)
    }

    fn projected_size_bytes(&self) -> usize {
        let string_bytes = [
            Some(self.global_id.as_str()),
            self.platform.as_deref(),
            self.content_type.as_deref(),
            self.author_id.as_deref(),
            self.author_display_name.as_deref(),
            self.author_handle.as_deref(),
            self.source_url.as_deref(),
            self.tags.as_deref(),
            self.content_blob.as_deref(),
            self.preserved_blob.as_deref(),
            Some(self.rest.as_str()),
        ]
        .into_iter()
        .flatten()
        .fold(0usize, |total, value| total.saturating_add(value.len()));
        let numeric_bytes = [
            self.published_at,
            self.captured_at,
            self.hidden,
            self.saved,
            self.archived,
            self.read_at,
            self.archived_at,
            self.liked_at,
        ]
        .into_iter()
        .flatten()
        .count()
        .saturating_mul(std::mem::size_of::<i64>());
        string_bytes.saturating_add(numeric_bytes)
    }

    fn from_row(row: &Row<'_>) -> SqlResult<Self> {
        Ok(Self {
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
    }
}

/// Opaque resume point for the next page. Both parts are required: `sort_at`
/// alone is not unique, and a cursor that cannot resume uniquely drops or
/// repeats rows at the page boundary.
#[derive(Debug, Clone, PartialEq)]
struct PageCursor {
    revision: i64,
    pub sort_at: i64,
    pub global_id: String,
}

#[derive(Debug)]
struct FeedPage {
    revision: i64,
    pub rows: Vec<FeedItemRow>,
    /// `None` when the page reached the end of the feed.
    pub next_cursor: Option<PageCursor>,
}

#[derive(Debug, PartialEq)]
struct ProjectionCommit {
    batch_id: String,
    input_digest: String,
    previous_revision: i64,
    revision: i64,
    upserted: usize,
    deleted: usize,
}

#[derive(Debug, PartialEq)]
struct RevisionedCount {
    revision: i64,
    count: i64,
}

/// Visibility filter, written to match the partial index exactly so the planner
/// can use it.
const VISIBLE_PREDICATE: &str = "archived IS NOT 1 AND hidden IS NOT 1";

/// Two statements rather than one with a nullable cursor. A single statement
/// would need `(?1 IS NULL OR sortAt < ?1 ...)`, and a leading expression the
/// index cannot satisfy is precisely what forces a temp B-tree sort.
const PAGE_FIRST_SQL: &str = "SELECT globalId, platform, contentType, publishedAt, capturedAt, \
authorId, authorDisplayName, authorHandle, sourceUrl, hidden, saved, archived, readAt, \
archivedAt, likedAt, tags, contentBlob, preservedBlob, rest, sortAt \
FROM feed_items WHERE archived IS NOT 1 AND hidden IS NOT 1 \
ORDER BY sortAt DESC, globalId ASC LIMIT ?1;";

const PAGE_AFTER_SQL: &str = "SELECT globalId, platform, contentType, publishedAt, capturedAt, \
authorId, authorDisplayName, authorHandle, sourceUrl, hidden, saved, archived, readAt, \
archivedAt, likedAt, tags, contentBlob, preservedBlob, rest, sortAt \
FROM feed_items WHERE archived IS NOT 1 AND hidden IS NOT 1 \
AND (sortAt < ?1 OR (sortAt = ?1 AND globalId > ?2)) \
ORDER BY sortAt DESC, globalId ASC LIMIT ?3;";

const UPSERT_SQL: &str = "INSERT INTO feed_items (\
globalId, platform, contentType, publishedAt, capturedAt, authorId, authorDisplayName, \
authorHandle, sourceUrl, hidden, saved, archived, readAt, archivedAt, likedAt, tags, \
contentBlob, preservedBlob, rest, sortAt) \
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20) \
ON CONFLICT(globalId) DO UPDATE SET \
platform = excluded.platform, contentType = excluded.contentType, \
publishedAt = excluded.publishedAt, capturedAt = excluded.capturedAt, \
authorId = excluded.authorId, authorDisplayName = excluded.authorDisplayName, \
authorHandle = excluded.authorHandle, sourceUrl = excluded.sourceUrl, \
hidden = excluded.hidden, saved = excluded.saved, archived = excluded.archived, \
readAt = excluded.readAt, archivedAt = excluded.archivedAt, likedAt = excluded.likedAt, \
tags = excluded.tags, contentBlob = excluded.contentBlob, \
preservedBlob = excluded.preservedBlob, rest = excluded.rest, sortAt = excluded.sortAt;";

const DELETE_SQL: &str = "DELETE FROM feed_items WHERE globalId = ?1;";
const CURRENT_REVISION_SQL: &str =
    "SELECT integerValue FROM library_meta WHERE key = 'projectionRevision';";
const ADVANCE_REVISION_SQL: &str =
    "UPDATE library_meta SET integerValue = integerValue + 1 WHERE key = 'projectionRevision';";

struct ShadowStore {
    conn: Connection,
}

impl ShadowStore {
    fn open(path: &Path) -> StoreResult<Self> {
        let mut store = Self {
            conn: Connection::open(path)?,
        };
        store.configure()?;
        store.migrate()?;
        Ok(store)
    }

    fn open_in_memory() -> StoreResult<Self> {
        let mut store = Self {
            conn: Connection::open_in_memory()?,
        };
        store.configure()?;
        store.migrate()?;
        Ok(store)
    }

    fn configure(&self) -> StoreResult<()> {
        // WAL so a long read cannot block ingest, and NORMAL because the
        // Automerge document remains authoritative during the migration: a
        // shadow row lost to an untimely power cut is rebuilt by backfill, and
        // paying a full fsync per batch to protect a derived copy is not worth
        // the write cost.
        self.conn.pragma_update(None, "journal_mode", "WAL")?;
        self.conn.pragma_update(None, "synchronous", "NORMAL")?;
        self.conn.pragma_update(None, "foreign_keys", "ON")?;
        self.conn.busy_timeout(BUSY_TIMEOUT)?;
        // Gate B stays on the smallest declared memory tier until measured
        // device capability can select a larger one. A negative cache_size is
        // KiB, mmap is disabled so it cannot become an untracked resident
        // allocation, and temp work spills to disk instead of growing the
        // process heap.
        self.conn
            .pragma_update(None, "cache_size", BASE_CACHE_KIB)?;
        self.conn.pragma_update(None, "mmap_size", 0)?;
        self.conn.pragma_update(None, "temp_store", "FILE")?;
        Ok(())
    }

    fn migrate(&mut self) -> StoreResult<()> {
        // Take the writer lock before inspecting version or schema objects.
        // Otherwise another opener could create an incompatible table between
        // inspection and migration and have CREATE IF NOT EXISTS bless it.
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior = tx.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        if !(0..=SHADOW_SCHEMA_VERSION).contains(&prior) {
            return Err(ShadowStoreError::UnsupportedSchemaVersion {
                expected: SHADOW_SCHEMA_VERSION,
                actual: prior,
            });
        }
        let has_unversioned_tables = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%');",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if prior == 0 && has_unversioned_tables {
            return Err(ShadowStoreError::UnversionedSchemaPresent);
        }
        if prior == 0 {
            tx.execute_batch(SHADOW_SCHEMA_V1_SQL)?;
        }
        if prior < 2 {
            tx.execute_batch(SHADOW_SCHEMA_V2_SQL)?;
        }
        let actual = tx.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        if actual != SHADOW_SCHEMA_VERSION {
            return Err(ShadowStoreError::UnsupportedSchemaVersion {
                expected: SHADOW_SCHEMA_VERSION,
                actual,
            });
        }
        tx.commit()?;
        Ok(())
    }

    fn revision_in(transaction: &Transaction<'_>) -> SqlResult<i64> {
        transaction.query_row(CURRENT_REVISION_SQL, [], |row| row.get(0))
    }

    fn validate_projection_batch_identity(batch_id: &str, input_digest: &str) -> StoreResult<()> {
        if batch_id.is_empty() || batch_id.len() > MAX_PROJECTION_BATCH_ID_BYTES {
            return Err(ShadowStoreError::InvalidProjectionBatchIdentity { field: "batch_id" });
        }
        if input_digest.len() != 64
            || !input_digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ShadowStoreError::InvalidProjectionBatchIdentity {
                field: "input_digest",
            });
        }
        Ok(())
    }

    fn projection_receipt_in(
        transaction: &Transaction<'_>,
        batch_id: &str,
    ) -> SqlResult<Option<ProjectionCommit>> {
        transaction
            .query_row(
                "SELECT batchId, inputDigest, previousRevision, committedRevision, \
                 upserted, deleted FROM projection_batches WHERE batchId = ?1;",
                params![batch_id],
                |row| {
                    Ok(ProjectionCommit {
                        batch_id: row.get(0)?,
                        input_digest: row.get(1)?,
                        previous_revision: row.get(2)?,
                        revision: row.get(3)?,
                        upserted: row.get::<_, i64>(4)? as usize,
                        deleted: row.get::<_, i64>(5)? as usize,
                    })
                },
            )
            .optional()
    }

    /// Applies one projection delta, advances its revision, and records its
    /// durable retry receipt in the same transaction.
    ///
    /// Exact retry after response loss returns the original receipt without
    /// reapplying rows. Reusing a batch ID with different input or a different
    /// previous revision fails closed. This receipt belongs only to the dark
    /// derived projection. It is not an authoritative Library Core operation
    /// receipt and grants no mutation authority.
    fn apply_projection_batch(
        &mut self,
        batch_id: &str,
        input_digest: &str,
        expected_revision: i64,
        rows: &[FeedItemRow],
        deleted_ids: &[String],
    ) -> StoreResult<ProjectionCommit> {
        Self::validate_projection_batch_identity(batch_id, input_digest)?;
        let requested = rows.len().saturating_add(deleted_ids.len());
        if !(1..=MAX_PROJECTION_BATCH_ITEMS).contains(&requested) {
            return Err(ShadowStoreError::InvalidProjectionBatchSize {
                requested,
                maximum: MAX_PROJECTION_BATCH_ITEMS,
            });
        }
        let projected_bytes = rows
            .iter()
            .fold(0usize, |total, row| {
                total.saturating_add(row.projected_size_bytes())
            })
            .saturating_add(
                deleted_ids
                    .iter()
                    .fold(0usize, |total, id| total.saturating_add(id.len())),
            );
        if projected_bytes > MAX_PROJECTION_BATCH_BYTES {
            return Err(ShadowStoreError::InvalidProjectionBatchBytes {
                requested: projected_bytes,
                maximum: MAX_PROJECTION_BATCH_BYTES,
            });
        }
        let tx: Transaction<'_> = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(receipt) = Self::projection_receipt_in(&tx, batch_id)? {
            if receipt.input_digest == input_digest
                && receipt.previous_revision == expected_revision
            {
                tx.commit()?;
                return Ok(receipt);
            }
            return Err(ShadowStoreError::ProjectionBatchReplayConflict {
                batch_id: batch_id.to_string(),
            });
        }
        let actual_revision = Self::revision_in(&tx)?;
        if actual_revision != expected_revision {
            return Err(ShadowStoreError::StaleRevision {
                expected: expected_revision,
                actual: actual_revision,
            });
        }
        {
            let mut statement = tx.prepare_cached(UPSERT_SQL)?;
            for row in rows {
                statement.execute(params![
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
                ])?;
            }
        }
        let mut deleted = 0usize;
        {
            let mut statement = tx.prepare_cached(DELETE_SQL)?;
            for global_id in deleted_ids {
                deleted += statement.execute(params![global_id])?;
            }
        }
        tx.execute(ADVANCE_REVISION_SQL, [])?;
        let revision = Self::revision_in(&tx)?;
        tx.execute(
            "INSERT INTO projection_batches (batchId, inputDigest, previousRevision, \
             committedRevision, upserted, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            params![
                batch_id,
                input_digest,
                expected_revision,
                revision,
                rows.len() as i64,
                deleted as i64,
            ],
        )?;
        tx.commit()?;
        Ok(ProjectionCommit {
            batch_id: batch_id.to_string(),
            input_digest: input_digest.to_string(),
            previous_revision: expected_revision,
            revision,
            upserted: rows.len(),
            deleted,
        })
    }

    /// Reads one bounded page of the timeline.
    ///
    /// `limit` is a hard bound, not a hint. The caller gets at most that many
    /// rows and a cursor, never the whole library.
    fn feed_page(&self, cursor: Option<&PageCursor>, limit: u32) -> StoreResult<FeedPage> {
        if !(1..=MAX_FEED_PAGE_LIMIT).contains(&limit) {
            return Err(ShadowStoreError::InvalidPageLimit {
                requested: limit,
                maximum: MAX_FEED_PAGE_LIMIT,
            });
        }
        let tx = self.conn.unchecked_transaction()?;
        let revision = Self::revision_in(&tx)?;
        if let Some(cursor) = cursor {
            if cursor.revision != revision {
                return Err(ShadowStoreError::StaleRevision {
                    expected: cursor.revision,
                    actual: revision,
                });
            }
        }

        let rows = match cursor {
            None => {
                let mut statement = tx.prepare_cached(PAGE_FIRST_SQL)?;
                let mapped = statement.query_map(params![limit], FeedItemRow::from_row)?;
                mapped.collect::<SqlResult<Vec<_>>>()?
            }
            Some(cursor) => {
                let mut statement = tx.prepare_cached(PAGE_AFTER_SQL)?;
                let mapped = statement
                    .query_map(params![cursor.sort_at, cursor.global_id, limit], |row| {
                        FeedItemRow::from_row(row)
                    })?;
                mapped.collect::<SqlResult<Vec<_>>>()?
            }
        };

        // A short page means the feed ended. Handing back a cursor there would
        // invite one more round trip that can only return nothing.
        let next_cursor = if rows.len() as u32 == limit {
            rows.last().map(|row| PageCursor {
                revision,
                sort_at: row.sort_key(),
                global_id: row.global_id.clone(),
            })
        } else {
            None
        };

        tx.commit()?;
        Ok(FeedPage {
            revision,
            rows,
            next_cursor,
        })
    }

    fn visible_count(&self, expected_revision: Option<i64>) -> StoreResult<RevisionedCount> {
        let tx = self.conn.unchecked_transaction()?;
        let revision = Self::revision_in(&tx)?;
        if let Some(expected) = expected_revision {
            if expected != revision {
                return Err(ShadowStoreError::StaleRevision {
                    expected,
                    actual: revision,
                });
            }
        }
        let count = tx.query_row(
            &format!("SELECT COUNT(*) FROM feed_items WHERE {VISIBLE_PREDICATE};"),
            [],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok(RevisionedCount { revision, count })
    }

    fn total_count(&self) -> StoreResult<i64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM feed_items;", [], |row| row.get(0))?)
    }

    /// Query plan for a statement, used by the tests that guard page cost.
    fn explain(&self, sql: &str, first_page: bool) -> StoreResult<String> {
        let explained = format!("EXPLAIN QUERY PLAN {sql}");
        let mut statement = self.conn.prepare(&explained)?;
        let details = if first_page {
            statement
                .query_map(params![64u32], |row| row.get::<_, String>(3))?
                .collect::<SqlResult<Vec<_>>>()?
        } else {
            statement
                .query_map(params![0i64, "", 64u32], |row| row.get::<_, String>(3))?
                .collect::<SqlResult<Vec<_>>>()?
        };
        Ok(details.join(" | "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn row(index: usize, published_at: Option<i64>) -> FeedItemRow {
        FeedItemRow {
            global_id: format!("x:{index:06}"),
            platform: Some("x".to_string()),
            content_type: Some("post".to_string()),
            published_at,
            captured_at: Some(1_780_000_000_000),
            author_id: Some("a:1".to_string()),
            author_display_name: Some("Someone".to_string()),
            author_handle: Some("someone".to_string()),
            source_url: Some(format!("https://example.test/{index}")),
            hidden: Some(0),
            saved: Some(0),
            archived: Some(0),
            read_at: None,
            archived_at: None,
            liked_at: None,
            tags: None,
            content_blob: Some("body".to_string()),
            preserved_blob: None,
            rest: "{}".to_string(),
        }
    }

    /// One in eight items has no timestamp, which must stay NULL and still
    /// paginate. Heavy ties on the rest, because a scrape assigns many items
    /// the same value and that is when a missing tie-break loses rows.
    fn corpus(count: usize) -> Vec<FeedItemRow> {
        (0..count)
            .map(|index| {
                let published = if index % 8 == 3 {
                    None
                } else {
                    Some(1_780_000_000_000 - (index % 32) as i64 * 86_400_000)
                };
                row(index, published)
            })
            .collect()
    }

    fn digest(index: usize) -> String {
        format!("{index:064x}")
    }

    fn seeded(count: usize) -> ShadowStore {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let rows = corpus(count);
        for (index, chunk) in rows.chunks(MAX_PROJECTION_BATCH_ITEMS).enumerate() {
            store
                .apply_projection_batch(
                    &format!("seed-{index}"),
                    &digest(index + 1),
                    index as i64,
                    chunk,
                    &[],
                )
                .expect("seed");
        }
        store
    }

    #[test]
    fn a_disk_store_reopens_committed_rows() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-{}-{nonce}.sqlite",
            std::process::id()
        ));

        {
            let mut store = ShadowStore::open(&path).expect("open disk store");
            let commit = store
                .apply_projection_batch("disk-seed", &digest(1), 0, &corpus(32), &[])
                .expect("seed disk store");
            assert_eq!(commit.revision, 1);
            assert_eq!(store.total_count().expect("count"), 32);
        }

        {
            let reopened = ShadowStore::open(&path).expect("reopen disk store");
            assert_eq!(reopened.total_count().expect("reopened count"), 32);
        }

        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn a_page_is_an_index_scan_and_never_a_sort() {
        let store = seeded(500);
        for (sql, first) in [(PAGE_FIRST_SQL, true), (PAGE_AFTER_SQL, false)] {
            let plan = store.explain(sql, first).expect("explain");
            assert!(
                plan.contains("feed_items_timeline"),
                "page should read through the timeline index, got: {plan}"
            );
            // The invariant the whole migration rests on. A temp B-tree here
            // means each page sorts the remaining set, so the page is bounded
            // and the work behind it is not.
            assert!(
                !plan.to_uppercase().contains("TEMP B-TREE"),
                "page must not sort, got: {plan}"
            );
        }
    }

    #[test]
    fn keyset_pagination_serves_every_row_exactly_once() {
        let total = 2_000;
        let store = seeded(total);
        let limit = 64u32;

        let mut seen: HashSet<String> = HashSet::new();
        let mut previous: Option<(i64, String)> = None;
        let mut undated = 0usize;
        let mut cursor: Option<PageCursor> = None;
        let mut pages = 0usize;
        let mut revision = None;

        loop {
            let page = store.feed_page(cursor.as_ref(), limit).expect("page");
            if let Some(expected) = revision {
                assert_eq!(page.revision, expected);
            } else {
                revision = Some(page.revision);
            }
            if page.rows.is_empty() {
                break;
            }
            pages += 1;
            assert!(pages <= total, "cursor failed to advance");
            assert!(page.rows.len() as u32 <= limit, "limit is a hard bound");

            for item in &page.rows {
                // A repeat means the cursor compared differently from SQLite.
                assert!(seen.insert(item.global_id.clone()), "row served twice");
                if item.published_at.is_none() {
                    undated += 1;
                    assert_eq!(item.sort_key(), SORT_AT_ABSENT);
                }
                if let Some((prev_sort, prev_id)) = &previous {
                    let descends = item.sort_key() < *prev_sort
                        || (item.sort_key() == *prev_sort && item.global_id > *prev_id);
                    assert!(descends, "order broke across a page boundary");
                }
                previous = Some((item.sort_key(), item.global_id.clone()));
            }

            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }

        assert_eq!(seen.len(), total, "every row exactly once");
        assert_eq!(undated, total / 8, "undated items survived as undated");
    }

    #[test]
    fn a_cursor_fails_closed_after_the_projection_changes() {
        let mut store = seeded(128);
        let first = store.feed_page(None, 32).expect("first page");
        let cursor = first.next_cursor.expect("cursor");
        assert_eq!(cursor.revision, first.revision);

        let changed = row(999_999, Some(1_790_000_000_000));
        let commit = store
            .apply_projection_batch("cursor-change", &digest(2), 1, &[changed], &[])
            .expect("advance projection");
        assert!(commit.revision > cursor.revision);

        let error = store
            .feed_page(Some(&cursor), 32)
            .expect_err("stale cursor must fail");
        match error {
            ShadowStoreError::StaleRevision { expected, actual } => {
                assert_eq!(expected, cursor.revision);
                assert_eq!(actual, commit.revision);
            }
            ShadowStoreError::Sql(error) => panic!("unexpected SQL error: {error}"),
            error => panic!("unexpected page error: {error:?}"),
        }
    }

    #[test]
    fn page_limits_enforce_the_registered_query_contract() {
        let store = seeded(256);
        assert_eq!(
            store
                .feed_page(None, MAX_FEED_PAGE_LIMIT)
                .expect("maximum page")
                .rows
                .len(),
            MAX_FEED_PAGE_LIMIT as usize
        );

        for requested in [0, MAX_FEED_PAGE_LIMIT + 1] {
            match store
                .feed_page(None, requested)
                .expect_err("out-of-contract limit must fail")
            {
                ShadowStoreError::InvalidPageLimit {
                    requested: actual,
                    maximum,
                } => {
                    assert_eq!(actual, requested);
                    assert_eq!(maximum, MAX_FEED_PAGE_LIMIT);
                }
                error => panic!("unexpected page error: {error:?}"),
            }
        }
    }

    #[test]
    fn database_memory_and_waiting_limits_are_explicit() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-settings-{}-{nonce}.sqlite",
            std::process::id()
        ));
        let store = ShadowStore::open(&path).expect("open disk store");
        let cache_size: i64 = store
            .conn
            .pragma_query_value(None, "cache_size", |row| row.get(0))
            .expect("cache_size");
        let mmap_size: i64 = store
            .conn
            .pragma_query_value(None, "mmap_size", |row| row.get(0))
            .expect("mmap_size");
        let temp_store: i64 = store
            .conn
            .pragma_query_value(None, "temp_store", |row| row.get(0))
            .expect("temp_store");
        let user_version: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user_version");
        let busy_timeout: i64 = store
            .conn
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .expect("busy_timeout");
        let journal_mode: String = store
            .conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal_mode");
        let synchronous: i64 = store
            .conn
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .expect("synchronous");
        let foreign_keys: i64 = store
            .conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("foreign_keys");

        assert_eq!(cache_size, BASE_CACHE_KIB);
        assert_eq!(mmap_size, 0);
        assert_eq!(temp_store, 1, "FILE is SQLite temp_store mode 1");
        assert_eq!(user_version, SHADOW_SCHEMA_VERSION);
        assert_eq!(busy_timeout, BUSY_TIMEOUT.as_millis() as i64);
        assert_eq!(journal_mode, "wal");
        assert_eq!(synchronous, 1, "NORMAL is SQLite synchronous mode 1");
        assert_eq!(foreign_keys, 1);

        drop(store);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn a_newer_schema_version_fails_closed_before_migration() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-newer-schema-{}-{nonce}.sqlite",
            std::process::id()
        ));
        {
            let conn = Connection::open(&path).expect("create future store");
            conn.pragma_update(None, "user_version", SHADOW_SCHEMA_VERSION + 1)
                .expect("set future version");
        }

        let error = match ShadowStore::open(&path) {
            Ok(_) => panic!("newer schema must block"),
            Err(error) => error,
        };
        match error {
            ShadowStoreError::UnsupportedSchemaVersion { expected, actual } => {
                assert_eq!(expected, SHADOW_SCHEMA_VERSION);
                assert_eq!(actual, SHADOW_SCHEMA_VERSION + 1);
            }
            error => panic!("unexpected migration error: {error:?}"),
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn an_unversioned_existing_schema_is_never_blessed_as_v1() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-unversioned-{}-{nonce}.sqlite",
            std::process::id()
        ));
        {
            let conn = Connection::open(&path).expect("create legacy store");
            conn.execute("CREATE TABLE feed_items (globalId TEXT PRIMARY KEY);", [])
                .expect("create incompatible unversioned schema");
        }

        let error = match ShadowStore::open(&path) {
            Ok(_) => panic!("unversioned existing schema must block"),
            Err(error) => error,
        };
        assert!(
            matches!(error, ShadowStoreError::UnversionedSchemaPresent),
            "unexpected migration error: {error:?}"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_v1_store_migrates_forward_without_losing_rows() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-v1-migration-{}-{nonce}.sqlite",
            std::process::id()
        ));
        {
            let conn = Connection::open(&path).expect("create v1 store");
            conn.execute_batch(SHADOW_SCHEMA_V1_SQL)
                .expect("install v1 schema");
            conn.execute(
                "INSERT INTO feed_items (globalId, rest, sortAt) VALUES ('x:legacy', '{}', 0);",
                [],
            )
            .expect("seed v1 row");
        }

        let store = ShadowStore::open(&path).expect("migrate v1 store");
        assert_eq!(store.total_count().expect("count"), 1);
        let version: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version");
        assert_eq!(version, SHADOW_SCHEMA_VERSION);
        let receipt_table_exists: bool = store
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
                 WHERE type = 'table' AND name = 'projection_batches');",
                [],
                |row| row.get(0),
            )
            .expect("receipt table");
        assert!(receipt_table_exists);

        drop(store);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn a_conflicting_v2_schema_cannot_be_blessed_or_partially_migrated() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-v2-conflict-{}-{nonce}.sqlite",
            std::process::id()
        ));
        {
            let conn = Connection::open(&path).expect("create v1 store");
            conn.execute_batch(SHADOW_SCHEMA_V1_SQL)
                .expect("install v1 schema");
            conn.execute(
                "CREATE TABLE projection_batches (batchId TEXT PRIMARY KEY) STRICT;",
                [],
            )
            .expect("install conflicting table");
        }

        let error = match ShadowStore::open(&path) {
            Ok(_) => panic!("conflicting migration must block"),
            Err(error) => error,
        };
        assert!(matches!(error, ShadowStoreError::Sql(_)));
        let conn = Connection::open(&path).expect("inspect blocked store");
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version");
        assert_eq!(version, 1, "failed migration cannot advance its version");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn one_projection_transaction_upserts_deletes_and_advances_once() {
        let mut store = seeded(32);
        let removed = "x:000001".to_string();
        let replacement = row(999_999, Some(1_790_000_000_000));
        let commit = store
            .apply_projection_batch(
                "mixed-projection",
                &digest(2),
                1,
                std::slice::from_ref(&replacement),
                std::slice::from_ref(&removed),
            )
            .expect("apply projection");

        assert_eq!(
            commit,
            ProjectionCommit {
                batch_id: "mixed-projection".to_string(),
                input_digest: digest(2),
                previous_revision: 1,
                revision: 2,
                upserted: 1,
                deleted: 1,
            }
        );
        assert_eq!(store.total_count().expect("count"), 32);
        let page = store.feed_page(None, 64).expect("page");
        assert_eq!(page.revision, commit.revision);
        assert!(page
            .rows
            .iter()
            .any(|item| item.global_id == replacement.global_id));
        assert!(!page.rows.iter().any(|item| item.global_id == removed));
    }

    #[test]
    fn response_loss_retry_returns_the_original_receipt_after_reopen() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-retry-{}-{nonce}.sqlite",
            std::process::id()
        ));
        let rows = corpus(24);
        let original = {
            let mut store = ShadowStore::open(&path).expect("open");
            store
                .apply_projection_batch("stable-batch", &digest(42), 0, &rows, &[])
                .expect("commit before response loss")
        };

        let mut reopened = ShadowStore::open(&path).expect("reopen after response loss");
        let retried = reopened
            .apply_projection_batch("stable-batch", &digest(42), 0, &rows, &[])
            .expect("read durable receipt");
        assert_eq!(retried, original);
        assert_eq!(retried.revision, 1);
        assert_eq!(reopened.total_count().expect("count"), rows.len() as i64);

        for (input_digest, expected_revision) in [(digest(43), 0), (digest(42), 1)] {
            match reopened
                .apply_projection_batch(
                    "stable-batch",
                    &input_digest,
                    expected_revision,
                    &rows,
                    &[],
                )
                .expect_err("changed replay tuple must fail")
            {
                ShadowStoreError::ProjectionBatchReplayConflict { batch_id } => {
                    assert_eq!(batch_id, "stable-batch");
                }
                error => panic!("unexpected replay error: {error:?}"),
            }
        }
        assert_eq!(
            reopened.total_count().expect("final count"),
            rows.len() as i64
        );

        drop(reopened);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn receipt_write_failure_rolls_back_rows_and_revision() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        store
            .conn
            .execute_batch(
                "CREATE TEMP TRIGGER reject_projection_receipt \
                 BEFORE INSERT ON projection_batches \
                 BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;",
            )
            .expect("install failure injection");

        let error = store
            .apply_projection_batch("must-rollback", &digest(1), 0, &corpus(8), &[])
            .expect_err("receipt failure must fail the transaction");
        assert!(matches!(error, ShadowStoreError::Sql(_)));
        assert_eq!(store.total_count().expect("rolled back rows"), 0);
        assert_eq!(
            store.visible_count(Some(0)).expect("rolled back revision"),
            RevisionedCount {
                revision: 0,
                count: 0,
            }
        );
        let receipts: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM projection_batches;", [], |row| {
                row.get(0)
            })
            .expect("receipt count");
        assert_eq!(receipts, 0);
    }

    #[test]
    fn projection_batch_identity_and_revision_fail_closed() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        for (batch_id, input_digest, field) in [
            (String::new(), digest(1), "batch_id"),
            (
                "x".repeat(MAX_PROJECTION_BATCH_ID_BYTES + 1),
                digest(1),
                "batch_id",
            ),
            ("batch".to_string(), "ABC".to_string(), "input_digest"),
        ] {
            match store
                .apply_projection_batch(&batch_id, &input_digest, 0, &[], &[])
                .expect_err("invalid identity must fail")
            {
                ShadowStoreError::InvalidProjectionBatchIdentity { field: actual } => {
                    assert_eq!(actual, field);
                }
                error => panic!("unexpected identity error: {error:?}"),
            }
        }
        for rows in [Vec::new(), corpus(MAX_PROJECTION_BATCH_ITEMS + 1)] {
            match store
                .apply_projection_batch("sized", &digest(2), 0, &rows, &[])
                .expect_err("out-of-contract batch size must fail")
            {
                ShadowStoreError::InvalidProjectionBatchSize { requested, maximum } => {
                    assert_eq!(requested, rows.len());
                    assert_eq!(maximum, MAX_PROJECTION_BATCH_ITEMS);
                }
                error => panic!("unexpected batch size error: {error:?}"),
            }
        }
        let mut oversized = row(1, None);
        oversized.content_blob = Some("x".repeat(MAX_PROJECTION_BATCH_BYTES + 1));
        match store
            .apply_projection_batch("oversized", &digest(2), 0, &[oversized], &[])
            .expect_err("oversized projected bytes must fail")
        {
            ShadowStoreError::InvalidProjectionBatchBytes { requested, maximum } => {
                assert!(requested > MAX_PROJECTION_BATCH_BYTES);
                assert_eq!(maximum, MAX_PROJECTION_BATCH_BYTES);
            }
            error => panic!("unexpected batch byte error: {error:?}"),
        }
        match store
            .apply_projection_batch("stale", &digest(2), 1, &[row(1, None)], &[])
            .expect_err("unearned revision must fail")
        {
            ShadowStoreError::StaleRevision { expected, actual } => {
                assert_eq!(expected, 1);
                assert_eq!(actual, 0);
            }
            error => panic!("unexpected revision error: {error:?}"),
        }
        assert_eq!(store.total_count().expect("count"), 0);
    }

    #[test]
    fn an_absent_timestamp_is_never_fabricated() {
        let store = seeded(64);
        let page = store.feed_page(None, 64).expect("page");
        let undated: Vec<_> = page
            .rows
            .iter()
            .filter(|item| item.published_at.is_none())
            .collect();
        assert!(!undated.is_empty(), "fixture should contain undated items");
        for item in undated {
            // The sentinel reaches the sort column and nothing else. Writing it
            // into publishedAt would turn "never set" into "epoch zero", which
            // the projection exists to prevent and cannot be undone.
            assert_eq!(item.published_at, None);
            assert_eq!(item.sort_key(), SORT_AT_ABSENT);
        }
    }

    #[test]
    fn upsert_is_idempotent_and_updates_in_place() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let rows = corpus(32);
        store
            .apply_projection_batch("first", &digest(1), 0, &rows, &[])
            .expect("first");
        store
            .apply_projection_batch("second", &digest(2), 1, &rows, &[])
            .expect("second");
        assert_eq!(store.total_count().expect("count"), 32);

        let mut changed = rows[0].clone();
        changed.content_blob = Some("edited".to_string());
        store
            .apply_projection_batch("update", &digest(3), 2, &[changed], &[])
            .expect("update");
        assert_eq!(store.total_count().expect("count"), 32);

        let page = store.feed_page(None, 64).expect("page");
        let stored = page
            .rows
            .iter()
            .find(|item| item.global_id == rows[0].global_id)
            .expect("row present");
        assert_eq!(stored.content_blob.as_deref(), Some("edited"));
    }

    #[test]
    fn hidden_and_archived_items_stay_out_of_the_timeline() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let mut rows = corpus(16);
        rows[0].hidden = Some(1);
        rows[1].archived = Some(1);
        store
            .apply_projection_batch("visibility", &digest(1), 0, &rows, &[])
            .expect("seed");

        assert_eq!(store.total_count().expect("total"), 16);
        let visible = store.visible_count(None).expect("visible");
        assert_eq!(visible.revision, 1);
        assert_eq!(visible.count, 14);

        let page = store.feed_page(None, 64).expect("page");
        assert_eq!(page.rows.len(), 14);
        assert!(!page
            .rows
            .iter()
            .any(|item| item.global_id == rows[0].global_id));
        assert!(!page
            .rows
            .iter()
            .any(|item| item.global_id == rows[1].global_id));
    }

    #[test]
    fn a_short_page_ends_the_walk() {
        let store = seeded(10);
        let page = store.feed_page(None, 64).expect("page");
        assert_eq!(page.rows.len(), 10);
        // A cursor here would buy one more round trip that can only return
        // nothing.
        assert!(page.next_cursor.is_none());
    }

    #[test]
    fn the_table_really_is_strict() {
        let store = ShadowStore::open_in_memory().expect("open");
        // STRICT is the backstop behind the projection's type guards. If this
        // ever stops failing, a text timestamp can reach an INTEGER column.
        let result = store.conn.execute(
            "INSERT INTO feed_items (globalId, rest, sortAt, publishedAt) VALUES ('x:1', '{}', 0, 'not-a-number');",
            [],
        );
        assert!(result.is_err(), "STRICT should reject a text timestamp");
    }
}
