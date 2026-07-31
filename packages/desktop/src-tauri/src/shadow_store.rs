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
    params, Connection, OpenFlags, OptionalExtension, Result as SqlResult, Row, Transaction,
    TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::Duration;

const SHADOW_SCHEMA_VERSION: i64 = 3;
const MAX_FEED_PAGE_LIMIT: u32 = 128;
const MAX_FEED_PAGE_RESPONSE_BYTES: usize = 2 * 1_048_576;
const FEED_PAGE_ENVELOPE_RESERVE_BYTES: usize = 16 * 1_024;
const MAX_FEED_CARD_MEDIA: usize = 8;
const MAX_FEED_CARD_TAGS: usize = 32;
const MAX_FEED_CARD_SIGNAL_TAGS: usize = 32;
const MAX_PROJECTION_BATCH_ID_BYTES: usize = 128;
pub(super) const MAX_PROJECTION_BATCH_ITEMS: usize = 1_000;
/// One canonical 4 MiB source document plus bounded projection metadata.
///
/// The lossless projector removes typed fields from the JSON escape object,
/// but `__absent`, `__raw`, and their keys can make the projected row slightly
/// larger than its source document. Keeping a separate 64 KiB allowance means
/// every admitted source document can fit in one batch without weakening the
/// source payload ceiling.
pub(super) const MAX_PROJECTION_BATCH_BYTES: usize = 4 * 1024 * 1024 + 64 * 1024;
const MAX_ENTITY_ID_UTF8_BYTES: usize = 4_096;
const MAX_PROJECTION_REBUILD_ROWS: usize = 250_000;
const MAX_PROJECTION_SOURCE_DOCUMENT_ID_BYTES: usize = 4_096;
const MAX_JAVASCRIPT_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const BASE_CACHE_KIB: i64 = -32 * 1024;

#[derive(Debug)]
pub(super) enum ShadowStoreError {
    Sql(rusqlite::Error),
    StaleRevision {
        expected: i64,
        actual: i64,
    },
    InvalidPageLimit {
        requested: u32,
        maximum: u32,
    },
    InvalidProjectionBatchIdentity {
        field: &'static str,
    },
    InvalidProjectionBatchSize {
        requested: usize,
        maximum: usize,
    },
    InvalidProjectionBatchBytes {
        requested: usize,
        maximum: usize,
    },
    InvalidProjectionEntityId,
    InvalidReadAssignment {
        field: &'static str,
    },
    InvalidFeedCardProjection {
        field: &'static str,
    },
    FeedCardExceedsResponseBudget {
        requested: usize,
        maximum: usize,
    },
    ProjectionEntityNotFound {
        entity_id: String,
    },
    ProjectionBatchReplayConflict {
        batch_id: String,
    },
    InvalidProjectionRebuild {
        field: &'static str,
    },
    ProjectionRebuildConflict {
        rebuild_id: String,
    },
    ProjectionRebuildNotEmpty,
    ProjectionRebuildIncomplete {
        rebuild_id: String,
    },
    ProjectionRebuildBatchOutOfOrder {
        expected: i64,
        actual: i64,
    },
    ProjectionRebuildRowCountMismatch {
        expected: usize,
        actual: usize,
    },
    ProjectionPublicationInvalid {
        field: &'static str,
    },
    ProjectionPublicationConflict {
        path: PathBuf,
    },
    ProjectionCheckpointBusy {
        busy: i64,
        log_frames: i64,
        checkpointed_frames: i64,
    },
    ProjectionIntegrityCheckFailed {
        result: String,
    },
    UnsupportedSchemaVersion {
        expected: i64,
        actual: i64,
    },
    UnversionedSchemaPresent,
    Io(std::io::Error),
}

impl From<rusqlite::Error> for ShadowStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<std::io::Error> for ShadowStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for ShadowStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::StaleRevision { expected, actual } => write!(
                formatter,
                "projection revision changed from {expected} to {actual}"
            ),
            Self::InvalidPageLimit { requested, maximum } => write!(
                formatter,
                "feed page limit {requested} exceeds the supported range 1 through {maximum}"
            ),
            Self::InvalidProjectionBatchIdentity { field } => {
                write!(formatter, "invalid projection batch {field}")
            }
            Self::InvalidProjectionBatchSize { requested, maximum } => write!(
                formatter,
                "projection batch contains {requested} operations, maximum {maximum}"
            ),
            Self::InvalidProjectionBatchBytes { requested, maximum } => write!(
                formatter,
                "projection batch contains {requested} bytes, maximum {maximum}"
            ),
            Self::InvalidProjectionEntityId => {
                formatter.write_str("projection entity ID is empty or exceeds its byte bound")
            }
            Self::InvalidReadAssignment { field } => {
                write!(formatter, "invalid read assignment {field}")
            }
            Self::InvalidFeedCardProjection { field } => {
                write!(formatter, "invalid feed-card projection {field}")
            }
            Self::FeedCardExceedsResponseBudget { requested, maximum } => write!(
                formatter,
                "one feed card requires {requested} serialized bytes, maximum {maximum}"
            ),
            Self::ProjectionEntityNotFound { entity_id } => {
                write!(formatter, "projection entity {entity_id} was not found")
            }
            Self::ProjectionBatchReplayConflict { batch_id } => write!(
                formatter,
                "projection batch {batch_id} was retried with different input"
            ),
            Self::InvalidProjectionRebuild { field } => {
                write!(formatter, "invalid projection rebuild {field}")
            }
            Self::ProjectionRebuildConflict { rebuild_id } => write!(
                formatter,
                "projection rebuild {rebuild_id} does not match its durable state"
            ),
            Self::ProjectionRebuildNotEmpty => {
                formatter.write_str("projection rebuild requires an empty staging store")
            }
            Self::ProjectionRebuildIncomplete { rebuild_id } => {
                write!(formatter, "projection rebuild {rebuild_id} is incomplete")
            }
            Self::ProjectionRebuildBatchOutOfOrder { expected, actual } => write!(
                formatter,
                "projection rebuild expected batch {expected}, received {actual}"
            ),
            Self::ProjectionRebuildRowCountMismatch { expected, actual } => write!(
                formatter,
                "projection rebuild expected {expected} projected rows, received {actual}"
            ),
            Self::ProjectionPublicationInvalid { field } => {
                write!(formatter, "invalid projection publication {field}")
            }
            Self::ProjectionPublicationConflict { path } => write!(
                formatter,
                "projection publication destination already exists: {}",
                path.display()
            ),
            Self::ProjectionCheckpointBusy {
                busy,
                log_frames,
                checkpointed_frames,
            } => write!(
                formatter,
                "projection checkpoint remained busy ({busy}, {log_frames} log frames, \
                 {checkpointed_frames} checkpointed)"
            ),
            Self::ProjectionIntegrityCheckFailed { result } => {
                write!(formatter, "projection integrity check failed: {result}")
            }
            Self::UnsupportedSchemaVersion { expected, actual } => write!(
                formatter,
                "shadow schema version {actual} is unsupported, expected {expected}"
            ),
            Self::UnversionedSchemaPresent => {
                formatter.write_str("unversioned shadow schema objects are present")
            }
            Self::Io(error) => write!(formatter, "projection file error: {error}"),
        }
    }
}

impl std::error::Error for ShadowStoreError {}

pub(super) type StoreResult<T> = std::result::Result<T, ShadowStoreError>;

/// One canonical schema is consumed by the native engine and checked against
/// the shared TypeScript DDL. This avoids maintaining a second handwritten
/// schema in Rust.
const SHADOW_SCHEMA_V1_SQL: &str =
    include_str!("../../../shared/src/library-core/shadow-schema-v1.sql");
const SHADOW_SCHEMA_V2_SQL: &str =
    include_str!("../../../shared/src/library-core/shadow-schema-v2.sql");
const SHADOW_SCHEMA_V3_SQL: &str =
    include_str!("../../../shared/src/library-core/shadow-schema-v3.sql");
const READ_ASSIGNMENT_PROJECTION_V1_SQL: &str =
    include_str!("../../../shared/src/library-core/read-assignment-projection-v1.sql");

/// Sort position for an item whose `publishedAt` is absent or unusable.
///
/// Ordering is `sortAt DESC`, so this places undated items at the far end of
/// the timeline. It is not a timestamp and is never presented as one.
const SORT_AT_ABSENT: i64 = 0;

/// One lossless projected row. Field order matches `SHADOW_COLUMNS`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FeedItemRow {
    pub(super) global_id: String,
    pub(super) platform: Option<String>,
    pub(super) content_type: Option<String>,
    pub(super) published_at: Option<i64>,
    pub(super) captured_at: Option<i64>,
    pub(super) author_id: Option<String>,
    pub(super) author_display_name: Option<String>,
    pub(super) author_handle: Option<String>,
    pub(super) source_url: Option<String>,
    pub(super) hidden: Option<i64>,
    pub(super) saved: Option<i64>,
    pub(super) archived: Option<i64>,
    pub(super) read_at: Option<i64>,
    pub(super) archived_at: Option<i64>,
    pub(super) liked_at: Option<i64>,
    pub(super) tags: Option<String>,
    pub(super) content_blob: Option<String>,
    pub(super) preserved_blob: Option<String>,
    pub(super) rest: String,
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

    pub(super) fn projected_size_bytes(&self) -> usize {
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

/// One compact feed-card DTO.
///
/// This is intentionally not a `FeedItemRow`. The lossless row contains full
/// content, preserved reader bodies, and the unmodelled-field escape object.
/// Returning those from a nominally bounded page would cap row count while
/// leaving response bytes proportional to corpus contents. This DTO selects
/// only the fields the feed card can render, with independent nested limits.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FeedCardRow {
    global_id: String,
    platform: Option<String>,
    content_type: Option<String>,
    published_at: Option<i64>,
    captured_at: Option<i64>,
    author_id: Option<String>,
    author_display_name: Option<String>,
    author_handle: Option<String>,
    author_avatar_url: Option<String>,
    source_url: Option<String>,
    read_at: Option<i64>,
    saved: Option<bool>,
    archived: Option<bool>,
    liked: Option<bool>,
    liked_at: Option<i64>,
    liked_synced_at: Option<i64>,
    content_text: Option<String>,
    media_urls: Vec<String>,
    media_types: Vec<String>,
    link_preview_title: Option<String>,
    tags: Vec<String>,
    engagement_likes: Option<i64>,
    engagement_comments: Option<i64>,
    location_name: Option<String>,
    reading_time_minutes: Option<i64>,
    content_signal_tags: Vec<String>,
    event_starts_at: Option<i64>,
    event_confidence_basis_points: Option<i64>,
    #[serde(skip)]
    sort_at: i64,
}

fn decode_bounded_string_array(
    encoded: String,
    maximum: usize,
    field: &'static str,
) -> SqlResult<Vec<String>> {
    let values = serde_json::from_str::<Vec<String>>(&encoded).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })?;
    if values.len() > maximum {
        return Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{field} exceeded its nested row bound"),
            )),
        ));
    }
    Ok(values)
}

fn string_within_bounds(value: &str, maximum_scalars: usize, maximum_bytes: usize) -> bool {
    value.len() <= maximum_bytes && value.chars().count() <= maximum_scalars
}

fn optional_string_within_bounds(
    value: Option<&str>,
    maximum_scalars: usize,
    maximum_bytes: usize,
) -> bool {
    value.is_none_or(|value| string_within_bounds(value, maximum_scalars, maximum_bytes))
}

fn optional_safe_integer(value: Option<i64>) -> bool {
    value.is_none_or(|value| (0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&value))
}

fn invalid_feed_card_field(field: &'static str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, field)),
    )
}

fn optional_boolean(row: &Row<'_>, index: usize) -> SqlResult<Option<bool>> {
    match row.get::<_, Option<i64>>(index)? {
        None => Ok(None),
        Some(0) => Ok(Some(false)),
        Some(1) => Ok(Some(true)),
        Some(_) => Err(rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "feed-card boolean must be zero, one, or null",
            )),
        )),
    }
}

impl FeedCardRow {
    fn from_row(row: &Row<'_>) -> SqlResult<Self> {
        let card = Self {
            global_id: row.get(0)?,
            platform: row.get(1)?,
            content_type: row.get(2)?,
            published_at: row.get(3)?,
            captured_at: row.get(4)?,
            author_id: row.get(5)?,
            author_display_name: row.get(6)?,
            author_handle: row.get(7)?,
            author_avatar_url: row.get(8)?,
            source_url: row.get(9)?,
            read_at: row.get(10)?,
            saved: optional_boolean(row, 11)?,
            archived: optional_boolean(row, 12)?,
            liked: optional_boolean(row, 13)?,
            liked_at: row.get(14)?,
            liked_synced_at: row.get(15)?,
            content_text: row.get(16)?,
            media_urls: decode_bounded_string_array(
                row.get(17)?,
                MAX_FEED_CARD_MEDIA,
                "media_urls",
            )?,
            media_types: decode_bounded_string_array(
                row.get(18)?,
                MAX_FEED_CARD_MEDIA,
                "media_types",
            )?,
            link_preview_title: row.get(19)?,
            tags: decode_bounded_string_array(row.get(20)?, MAX_FEED_CARD_TAGS, "tags")?,
            engagement_likes: row.get(21)?,
            engagement_comments: row.get(22)?,
            location_name: row.get(23)?,
            reading_time_minutes: row.get(24)?,
            content_signal_tags: decode_bounded_string_array(
                row.get(25)?,
                MAX_FEED_CARD_SIGNAL_TAGS,
                "content_signal_tags",
            )?,
            event_starts_at: row.get(26)?,
            event_confidence_basis_points: row.get(27)?,
            sort_at: row.get(28)?,
        };
        if card.global_id.is_empty()
            || card.global_id.len() > MAX_ENTITY_ID_UTF8_BYTES
            || !optional_string_within_bounds(card.platform.as_deref(), 64, 256)
            || !optional_string_within_bounds(card.content_type.as_deref(), 128, 512)
            || !optional_safe_integer(card.published_at)
            || !optional_safe_integer(card.captured_at)
            || !optional_string_within_bounds(card.author_id.as_deref(), 4_096, 16_384)
            || !optional_string_within_bounds(card.author_display_name.as_deref(), 512, 2_048)
            || !optional_string_within_bounds(card.author_handle.as_deref(), 256, 1_024)
            || !optional_string_within_bounds(card.author_avatar_url.as_deref(), 2_048, 8_192)
            || !optional_string_within_bounds(card.source_url.as_deref(), 2_048, 8_192)
            || !optional_safe_integer(card.read_at)
            || !optional_safe_integer(card.liked_at)
            || !optional_safe_integer(card.liked_synced_at)
            || !optional_string_within_bounds(card.content_text.as_deref(), 1_500, 6_000)
            || !card
                .media_urls
                .iter()
                .all(|value| string_within_bounds(value, 2_048, 8_192))
            || !card
                .media_types
                .iter()
                .all(|value| string_within_bounds(value, 16, 64))
            || !optional_string_within_bounds(card.link_preview_title.as_deref(), 512, 2_048)
            || !card
                .tags
                .iter()
                .all(|value| string_within_bounds(value, 256, 1_024))
            || !optional_safe_integer(card.engagement_likes)
            || !optional_safe_integer(card.engagement_comments)
            || !optional_string_within_bounds(card.location_name.as_deref(), 512, 2_048)
            || !optional_safe_integer(card.reading_time_minutes)
            || !card
                .content_signal_tags
                .iter()
                .all(|value| string_within_bounds(value, 64, 256))
            || !optional_safe_integer(card.event_starts_at)
            || card
                .event_confidence_basis_points
                .is_some_and(|value| !(0..=10_000).contains(&value))
            || !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&card.sort_at)
        {
            return Err(invalid_feed_card_field(
                "feed card violates the closed response contract",
            ));
        }
        Ok(card)
    }

    fn serialized_size_bytes(&self) -> StoreResult<usize> {
        serde_json::to_vec(self)
            .map(|bytes| bytes.len())
            .map_err(|_| ShadowStoreError::InvalidFeedCardProjection {
                field: "serialized_row",
            })
    }

    fn sort_key(&self) -> i64 {
        self.sort_at
    }
}

/// Opaque resume point for the next page. Both parts are required: `sort_at`
/// alone is not unique, and a cursor that cannot resume uniquely drops or
/// repeats rows at the page boundary.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PageCursor {
    pub(super) revision: i64,
    pub sort_at: i64,
    pub global_id: String,
}

impl PageCursor {
    fn serialized_size_bytes(&self) -> StoreResult<usize> {
        serde_json::to_vec(self)
            .map(|bytes| bytes.len())
            .map_err(|_| ShadowStoreError::InvalidFeedCardProjection {
                field: "serialized_cursor",
            })
    }
}

#[derive(Debug)]
pub(super) struct FeedPage {
    pub(super) revision: i64,
    pub(super) total_count: i64,
    pub(super) serialized_row_bytes: usize,
    pub(super) rows: Vec<FeedCardRow>,
    /// `None` when the page reached the end of the feed.
    pub next_cursor: Option<PageCursor>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectionCommit {
    batch_id: String,
    input_digest: String,
    previous_revision: i64,
    revision: i64,
    upserted: usize,
    deleted: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectionSourceV1 {
    pub(super) document_id: String,
    pub(super) heads_digest: String,
    pub(super) head_count: i64,
    pub(super) storage_generation: i64,
    pub(super) storage_save_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectionRebuildState {
    pub(super) rebuild_id: String,
    pub(super) source: ProjectionSourceV1,
    pub(super) total_rows: usize,
    pub(super) next_batch_index: i64,
    pub(super) projection_revision: i64,
    pub(super) projected_rows: usize,
    pub(super) complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectionRebuildCommit {
    projection: ProjectionCommit,
    pub(super) state: ProjectionRebuildState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PublishedProjectionGeneration {
    pub(super) path: PathBuf,
    pub(super) rebuild_id: String,
    pub(super) source: ProjectionSourceV1,
    pub(super) total_rows: usize,
    pub(super) projection_revision: i64,
    pub(super) byte_length: u64,
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
const PAGE_FIRST_SQL: &str = "SELECT globalId, substr(platform, 1, 64), \
substr(contentType, 1, 128), publishedAt, capturedAt, \
substr(authorId, 1, 4096), substr(authorDisplayName, 1, 512), substr(authorHandle, 1, 256), \
CASE WHEN json_type(rest, '$.__author.avatarUrl') = 'text' \
  THEN substr(json_extract(rest, '$.__author.avatarUrl'), 1, 2048) END, \
substr(sourceUrl, 1, 2048), readAt, saved, archived, \
CASE json_type(rest, '$.__userState.liked') \
  WHEN 'true' THEN 1 WHEN 'false' THEN 0 END, likedAt, \
CASE WHEN json_type(rest, '$.__userState.likedSyncedAt') = 'integer' \
  THEN json_extract(rest, '$.__userState.likedSyncedAt') END, \
CASE WHEN json_type(contentBlob, '$.text') = 'text' \
  THEN substr(json_extract(contentBlob, '$.text'), 1, 1500) END, \
CASE WHEN json_type(contentBlob, '$.mediaUrls') = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 2048) AS value \
  FROM json_each(contentBlob, '$.mediaUrls') WHERE type = 'text' LIMIT 8\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(contentBlob, '$.mediaTypes') = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 16) AS value \
  FROM json_each(contentBlob, '$.mediaTypes') WHERE type = 'text' LIMIT 8\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(contentBlob, '$.linkPreview.title') = 'text' \
  THEN substr(json_extract(contentBlob, '$.linkPreview.title'), 1, 512) END, \
CASE WHEN json_type(tags) = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 256) AS value \
  FROM json_each(tags) WHERE type = 'text' LIMIT 32\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(rest, '$.engagement.likes') = 'integer' \
  THEN json_extract(rest, '$.engagement.likes') END, \
CASE WHEN json_type(rest, '$.engagement.comments') = 'integer' \
  THEN json_extract(rest, '$.engagement.comments') END, \
CASE WHEN json_type(rest, '$.location.name') = 'text' \
  THEN substr(json_extract(rest, '$.location.name'), 1, 512) END, \
CASE WHEN json_type(preservedBlob, '$.readingTime') = 'integer' \
  THEN json_extract(preservedBlob, '$.readingTime') END, \
CASE WHEN json_type(rest, '$.contentSignals.tags') = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 64) AS value \
  FROM json_each(rest, '$.contentSignals.tags') WHERE type = 'text' LIMIT 32\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(rest, '$.eventCandidate.startsAt') = 'integer' \
  THEN json_extract(rest, '$.eventCandidate.startsAt') END, \
CASE WHEN json_type(rest, '$.eventCandidate.confidence') IN ('integer', 'real') \
  AND json_extract(rest, '$.eventCandidate.confidence') BETWEEN 0 AND 1 \
  THEN CAST(ROUND(json_extract(rest, '$.eventCandidate.confidence') * 10000) AS INTEGER) END, \
sortAt \
FROM feed_items WHERE archived IS NOT 1 AND hidden IS NOT 1 \
ORDER BY sortAt DESC, globalId ASC LIMIT ?1;";

const PAGE_AFTER_SQL: &str = "SELECT globalId, substr(platform, 1, 64), \
substr(contentType, 1, 128), publishedAt, capturedAt, \
substr(authorId, 1, 4096), substr(authorDisplayName, 1, 512), substr(authorHandle, 1, 256), \
CASE WHEN json_type(rest, '$.__author.avatarUrl') = 'text' \
  THEN substr(json_extract(rest, '$.__author.avatarUrl'), 1, 2048) END, \
substr(sourceUrl, 1, 2048), readAt, saved, archived, \
CASE json_type(rest, '$.__userState.liked') \
  WHEN 'true' THEN 1 WHEN 'false' THEN 0 END, likedAt, \
CASE WHEN json_type(rest, '$.__userState.likedSyncedAt') = 'integer' \
  THEN json_extract(rest, '$.__userState.likedSyncedAt') END, \
CASE WHEN json_type(contentBlob, '$.text') = 'text' \
  THEN substr(json_extract(contentBlob, '$.text'), 1, 1500) END, \
CASE WHEN json_type(contentBlob, '$.mediaUrls') = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 2048) AS value \
  FROM json_each(contentBlob, '$.mediaUrls') WHERE type = 'text' LIMIT 8\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(contentBlob, '$.mediaTypes') = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 16) AS value \
  FROM json_each(contentBlob, '$.mediaTypes') WHERE type = 'text' LIMIT 8\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(contentBlob, '$.linkPreview.title') = 'text' \
  THEN substr(json_extract(contentBlob, '$.linkPreview.title'), 1, 512) END, \
CASE WHEN json_type(tags) = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 256) AS value \
  FROM json_each(tags) WHERE type = 'text' LIMIT 32\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(rest, '$.engagement.likes') = 'integer' \
  THEN json_extract(rest, '$.engagement.likes') END, \
CASE WHEN json_type(rest, '$.engagement.comments') = 'integer' \
  THEN json_extract(rest, '$.engagement.comments') END, \
CASE WHEN json_type(rest, '$.location.name') = 'text' \
  THEN substr(json_extract(rest, '$.location.name'), 1, 512) END, \
CASE WHEN json_type(preservedBlob, '$.readingTime') = 'integer' \
  THEN json_extract(preservedBlob, '$.readingTime') END, \
CASE WHEN json_type(rest, '$.contentSignals.tags') = 'array' THEN \
  COALESCE((SELECT json_group_array(value) FROM (\
  SELECT substr(value, 1, 64) AS value \
  FROM json_each(rest, '$.contentSignals.tags') WHERE type = 'text' LIMIT 32\
  )), '[]') ELSE '[]' END, \
CASE WHEN json_type(rest, '$.eventCandidate.startsAt') = 'integer' \
  THEN json_extract(rest, '$.eventCandidate.startsAt') END, \
CASE WHEN json_type(rest, '$.eventCandidate.confidence') IN ('integer', 'real') \
  AND json_extract(rest, '$.eventCandidate.confidence') BETWEEN 0 AND 1 \
  THEN CAST(ROUND(json_extract(rest, '$.eventCandidate.confidence') * 10000) AS INTEGER) END, \
sortAt \
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

#[cfg(unix)]
pub(super) fn publish_projection_file(staging: &Path, destination: &Path) -> std::io::Result<()> {
    let parent = destination
        .parent()
        .expect("validated publication destination has a parent");
    // Creating the second hard link is the atomic publication point and fails
    // when the immutable destination already exists. A plain Unix rename would
    // replace a destination created after the caller's preflight check.
    std::fs::hard_link(staging, destination)?;
    File::open(parent)?.sync_all()?;
    std::fs::remove_file(staging)?;
    File::open(parent)?.sync_all()
}

#[cfg(windows)]
pub(super) fn publish_projection_file(staging: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let staging_wide = staging
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            staging_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
pub(super) fn publish_projection_file(staging: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(staging, destination)
}

pub(super) struct ShadowStore {
    conn: Connection,
    path: Option<PathBuf>,
}

impl ShadowStore {
    pub(super) fn open(path: &Path) -> StoreResult<Self> {
        let mut store = Self {
            conn: Connection::open(path)?,
            path: Some(path.to_path_buf()),
        };
        store.configure()?;
        store.migrate()?;
        Ok(store)
    }

    fn open_in_memory() -> StoreResult<Self> {
        let mut store = Self {
            conn: Connection::open_in_memory()?,
            path: None,
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
        if prior < 3 {
            tx.execute_batch(SHADOW_SCHEMA_V3_SQL)?;
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

    /// Reads one complete lossless projection row by stable identity.
    ///
    /// The caller owns generation authentication and response-byte admission.
    /// This query never scans or hydrates the surrounding corpus.
    pub(super) fn item_detail(&self, global_id: &str) -> StoreResult<Option<FeedItemRow>> {
        if global_id.is_empty() || global_id.len() > MAX_ENTITY_ID_UTF8_BYTES {
            return Err(ShadowStoreError::InvalidProjectionEntityId);
        }
        self.conn
            .query_row(
                "SELECT globalId, platform, contentType, publishedAt, capturedAt, \
                 authorId, authorDisplayName, authorHandle, sourceUrl, hidden, saved, \
                 archived, readAt, archivedAt, likedAt, tags, contentBlob, preservedBlob, rest \
                 FROM feed_items WHERE globalId = ?1;",
                [global_id],
                FeedItemRow::from_row,
            )
            .optional()
            .map_err(Into::into)
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

    fn validate_projection_batch_payload(
        rows: &[FeedItemRow],
        deleted_ids: &[String],
    ) -> StoreResult<()> {
        let requested = rows.len().saturating_add(deleted_ids.len());
        if !(1..=MAX_PROJECTION_BATCH_ITEMS).contains(&requested) {
            return Err(ShadowStoreError::InvalidProjectionBatchSize {
                requested,
                maximum: MAX_PROJECTION_BATCH_ITEMS,
            });
        }
        if rows
            .iter()
            .any(|row| row.global_id.is_empty() || row.global_id.len() > MAX_ENTITY_ID_UTF8_BYTES)
            || deleted_ids
                .iter()
                .any(|id| id.is_empty() || id.len() > MAX_ENTITY_ID_UTF8_BYTES)
        {
            return Err(ShadowStoreError::InvalidProjectionEntityId);
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
        Ok(())
    }

    fn validate_projection_rebuild_identity(
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
    ) -> StoreResult<()> {
        if rebuild_id.is_empty() || rebuild_id.len() > MAX_PROJECTION_BATCH_ID_BYTES {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "rebuild_id",
            });
        }
        if source.document_id.is_empty()
            || source.document_id.len() > MAX_PROJECTION_SOURCE_DOCUMENT_ID_BYTES
        {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "source_document_id",
            });
        }
        if source.heads_digest.len() != 64
            || !source
                .heads_digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "source_heads_digest",
            });
        }
        if !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&source.head_count) {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "source_head_count",
            });
        }
        if !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&source.storage_generation) {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "source_generation",
            });
        }
        if !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&source.storage_save_revision) {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "source_save_revision",
            });
        }
        if total_rows > MAX_PROJECTION_REBUILD_ROWS {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "total_rows",
            });
        }
        Ok(())
    }

    fn projection_rebuild_state_in(
        transaction: &Transaction<'_>,
    ) -> SqlResult<Option<ProjectionRebuildState>> {
        transaction
            .query_row(
                "SELECT rebuildId, sourceDocumentId, sourceHeadsDigest, sourceHeadCount, \
                 sourceGeneration, sourceSaveRevision, totalRows, nextBatchIndex, \
                 projectionRevision, projectedRows, complete \
                 FROM projection_rebuild_state WHERE singleton = 1;",
                [],
                |row| {
                    Ok(ProjectionRebuildState {
                        rebuild_id: row.get(0)?,
                        source: ProjectionSourceV1 {
                            document_id: row.get(1)?,
                            heads_digest: row.get(2)?,
                            head_count: row.get(3)?,
                            storage_generation: row.get(4)?,
                            storage_save_revision: row.get(5)?,
                        },
                        total_rows: row.get::<_, i64>(6)? as usize,
                        next_batch_index: row.get(7)?,
                        projection_revision: row.get(8)?,
                        projected_rows: row.get::<_, i64>(9)? as usize,
                        complete: row.get::<_, i64>(10)? == 1,
                    })
                },
            )
            .optional()
    }

    fn require_matching_projection_rebuild(
        state: ProjectionRebuildState,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
    ) -> StoreResult<ProjectionRebuildState> {
        if state.rebuild_id != rebuild_id
            || state.source != *source
            || state.total_rows != total_rows
        {
            return Err(ShadowStoreError::ProjectionRebuildConflict {
                rebuild_id: rebuild_id.to_string(),
            });
        }
        Ok(state)
    }

    fn verify_projection_rebuild_state_in(
        transaction: &Transaction<'_>,
        state: &ProjectionRebuildState,
    ) -> StoreResult<()> {
        let projection_revision = Self::revision_in(transaction)?;
        let stored_rows = transaction.query_row("SELECT COUNT(*) FROM feed_items;", [], |row| {
            row.get::<_, i64>(0)
        })? as usize;
        let rebuild_batches = transaction.query_row(
            "SELECT COUNT(*) FROM projection_rebuild_batches \
             WHERE rebuildId = ?1;",
            params![state.rebuild_id],
            |row| row.get::<_, i64>(0),
        )?;
        let projection_receipts =
            transaction.query_row("SELECT COUNT(*) FROM projection_batches;", [], |row| {
                row.get::<_, i64>(0)
            })?;
        if state.projection_revision != projection_revision
            || state.projected_rows != stored_rows
            || state.next_batch_index != rebuild_batches
            || rebuild_batches != projection_receipts
            || state.complete != (state.projected_rows == state.total_rows)
        {
            return Err(ShadowStoreError::ProjectionRebuildConflict {
                rebuild_id: state.rebuild_id.clone(),
            });
        }
        Ok(())
    }

    fn require_readable_projection_in(transaction: &Transaction<'_>) -> StoreResult<()> {
        if let Some(state) = Self::projection_rebuild_state_in(transaction)? {
            if !state.complete {
                Self::verify_projection_rebuild_state_in(transaction, &state)?;
                return Err(ShadowStoreError::ProjectionRebuildIncomplete {
                    rebuild_id: state.rebuild_id,
                });
            }
        }
        Ok(())
    }

    fn require_complete_projection_rebuild(
        conn: &Connection,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
    ) -> StoreResult<ProjectionRebuildState> {
        let transaction = conn.unchecked_transaction()?;
        let state = Self::projection_rebuild_state_in(&transaction)?.ok_or(
            ShadowStoreError::ProjectionPublicationInvalid {
                field: "missing_rebuild_state",
            },
        )?;
        let state =
            Self::require_matching_projection_rebuild(state, rebuild_id, source, total_rows)?;
        Self::verify_projection_rebuild_state_in(&transaction, &state)?;
        if !state.complete {
            return Err(ShadowStoreError::ProjectionRebuildIncomplete {
                rebuild_id: state.rebuild_id,
            });
        }
        transaction.commit()?;
        Ok(state)
    }

    fn verify_quick_check(conn: &Connection) -> StoreResult<()> {
        let mut statement = conn.prepare("PRAGMA quick_check;")?;
        let results = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<SqlResult<Vec<_>>>()?;
        if results.as_slice() != ["ok"] {
            return Err(ShadowStoreError::ProjectionIntegrityCheckFailed {
                result: results.join("; "),
            });
        }
        Ok(())
    }

    fn verify_foreign_keys(conn: &Connection) -> StoreResult<()> {
        let problem = conn
            .query_row("PRAGMA foreign_key_check;", [], |_| Ok(()))
            .optional()?;
        if problem.is_some() {
            return Err(ShadowStoreError::ProjectionPublicationInvalid {
                field: "foreign_keys",
            });
        }
        Ok(())
    }

    fn schema_catalog(conn: &Connection) -> StoreResult<Vec<(String, String, String, String)>> {
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
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(catalog)
    }

    fn verify_schema_catalog(conn: &Connection) -> StoreResult<()> {
        let reference = Self::open_in_memory()?;
        if Self::schema_catalog(conn)? != Self::schema_catalog(&reference.conn)? {
            return Err(ShadowStoreError::ProjectionPublicationInvalid {
                field: "schema_catalog",
            });
        }
        Ok(())
    }

    pub(super) fn open_published_projection_generation_read_only(
        path: &Path,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
    ) -> StoreResult<(Self, PublishedProjectionGeneration)> {
        Self::open_published_projection_generation_read_only_with_cache_kib(
            path,
            rebuild_id,
            source,
            total_rows,
            BASE_CACHE_KIB,
        )
    }

    pub(super) fn open_published_projection_generation_read_only_with_cache_kib(
        path: &Path,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
        cache_kib: i64,
    ) -> StoreResult<(Self, PublishedProjectionGeneration)> {
        Self::validate_projection_rebuild_identity(rebuild_id, source, total_rows)?;
        if !(-32 * 1024..=-256).contains(&cache_kib) {
            return Err(ShadowStoreError::ProjectionPublicationInvalid {
                field: "reader_cache_size",
            });
        }
        let before = std::fs::symlink_metadata(path)?;
        if !before.file_type().is_file() {
            return Err(ShadowStoreError::ProjectionPublicationInvalid {
                field: "published_file_type",
            });
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW
                | OpenFlags::SQLITE_OPEN_EXRESCODE,
        )?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "cache_size", cache_kib)?;
        conn.pragma_update(None, "mmap_size", 0)?;
        conn.pragma_update(None, "temp_store", "FILE")?;
        let version = conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        if version != SHADOW_SCHEMA_VERSION {
            return Err(ShadowStoreError::UnsupportedSchemaVersion {
                expected: SHADOW_SCHEMA_VERSION,
                actual: version,
            });
        }
        Self::verify_quick_check(&conn)?;
        Self::verify_foreign_keys(&conn)?;
        Self::verify_schema_catalog(&conn)?;
        let state =
            Self::require_complete_projection_rebuild(&conn, rebuild_id, source, total_rows)?;
        let after = std::fs::symlink_metadata(path)?;
        if !after.file_type().is_file() || !same_published_file_generation(&before, &after) {
            return Err(ShadowStoreError::ProjectionPublicationInvalid {
                field: "published_file_generation",
            });
        }
        let generation = PublishedProjectionGeneration {
            path: path.to_path_buf(),
            rebuild_id: state.rebuild_id,
            source: state.source,
            total_rows: state.total_rows,
            projection_revision: state.projection_revision,
            byte_length: after.len(),
        };
        Ok((
            Self {
                conn,
                path: Some(path.to_path_buf()),
            },
            generation,
        ))
    }

    pub(super) fn inspect_published_projection_generation(
        path: &Path,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
    ) -> StoreResult<PublishedProjectionGeneration> {
        let (_, generation) = Self::open_published_projection_generation_read_only(
            path, rebuild_id, source, total_rows,
        )?;
        Ok(generation)
    }

    /// Seals one complete derived-shadow rebuild into an immutable generation.
    ///
    /// The staging and destination files must be distinct absolute paths in the
    /// same directory. Publication checkpoints and removes WAL mode, verifies
    /// the complete rebuild and SQLite quick check, closes and syncs the
    /// staging file, then performs one durable rename to a destination that
    /// must not already exist. The destination is verified read-only before the
    /// receipt returns. This publishes bytes only. Assigning the generation to
    /// a reader is a later activation boundary.
    pub(super) fn publish_complete_projection_generation(
        self,
        destination: &Path,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
    ) -> StoreResult<PublishedProjectionGeneration> {
        Self::validate_projection_rebuild_identity(rebuild_id, source, total_rows)?;
        let staging =
            self.path
                .as_deref()
                .ok_or(ShadowStoreError::ProjectionPublicationInvalid {
                    field: "in_memory_store",
                })?;
        if !staging.is_absolute()
            || !destination.is_absolute()
            || staging == destination
            || staging.parent().is_none()
            || staging.parent() != destination.parent()
            || staging.file_name().is_none()
            || destination.file_name().is_none()
        {
            return Err(ShadowStoreError::ProjectionPublicationInvalid { field: "paths" });
        }
        if !std::fs::symlink_metadata(staging)?.file_type().is_file() {
            return Err(ShadowStoreError::ProjectionPublicationInvalid {
                field: "staging_file_type",
            });
        }
        match std::fs::symlink_metadata(destination) {
            Ok(_) => {
                return Err(ShadowStoreError::ProjectionPublicationConflict {
                    path: destination.to_path_buf(),
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        Self::require_complete_projection_rebuild(&self.conn, rebuild_id, source, total_rows)?;
        let (busy, log_frames, checkpointed_frames) =
            self.conn
                .query_row("PRAGMA wal_checkpoint(TRUNCATE);", [], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })?;
        if busy != 0 || log_frames != checkpointed_frames {
            return Err(ShadowStoreError::ProjectionCheckpointBusy {
                busy,
                log_frames,
                checkpointed_frames,
            });
        }
        let journal_mode = self
            .conn
            .query_row("PRAGMA journal_mode = DELETE;", [], |row| {
                row.get::<_, String>(0)
            })?;
        if journal_mode != "delete" {
            return Err(ShadowStoreError::ProjectionPublicationInvalid {
                field: "journal_mode",
            });
        }
        Self::verify_quick_check(&self.conn)?;

        let ShadowStore { conn, path } = self;
        conn.close()
            .map_err(|(_, error)| ShadowStoreError::Sql(error))?;
        let staging = path.expect("disk store path was validated");
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(&staging)?
            .sync_all()?;
        publish_projection_file(&staging, destination)?;
        File::open(destination)?.sync_all()?;

        Self::inspect_published_projection_generation(destination, rebuild_id, source, total_rows)
    }

    pub(super) fn begin_projection_rebuild(
        &mut self,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
    ) -> StoreResult<ProjectionRebuildState> {
        Self::validate_projection_rebuild_identity(rebuild_id, source, total_rows)?;
        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(state) = Self::projection_rebuild_state_in(&transaction)? {
            let state =
                Self::require_matching_projection_rebuild(state, rebuild_id, source, total_rows)?;
            Self::verify_projection_rebuild_state_in(&transaction, &state)?;
            transaction.commit()?;
            return Ok(state);
        }

        let projection_revision = Self::revision_in(&transaction)?;
        let existing_rows =
            transaction.query_row("SELECT COUNT(*) FROM feed_items;", [], |row| {
                row.get::<_, i64>(0)
            })?;
        let existing_receipts =
            transaction.query_row("SELECT COUNT(*) FROM projection_batches;", [], |row| {
                row.get::<_, i64>(0)
            })?;
        if projection_revision != 0 || existing_rows != 0 || existing_receipts != 0 {
            return Err(ShadowStoreError::ProjectionRebuildNotEmpty);
        }

        let complete = total_rows == 0;
        transaction.execute(
            "INSERT INTO projection_rebuild_state (\
             singleton, rebuildId, sourceSchemaVersion, sourceDocumentId, \
             sourceHeadsDigest, sourceHeadCount, sourceGeneration, \
             sourceSaveRevision, totalRows, nextBatchIndex, projectionRevision, \
             projectedRows, complete) \
             VALUES (1, ?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 0, ?8);",
            params![
                rebuild_id,
                source.document_id,
                source.heads_digest,
                source.head_count,
                source.storage_generation,
                source.storage_save_revision,
                total_rows as i64,
                i64::from(complete),
            ],
        )?;
        let state = Self::projection_rebuild_state_in(&transaction)?
            .expect("projection rebuild state was inserted in this transaction");
        transaction.commit()?;
        Ok(state)
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

    fn begin_projection_batch_in(
        transaction: &Transaction<'_>,
        batch_id: &str,
        input_digest: &str,
        expected_revision: i64,
    ) -> StoreResult<Option<ProjectionCommit>> {
        if let Some(receipt) = Self::projection_receipt_in(transaction, batch_id)? {
            if receipt.input_digest == input_digest
                && receipt.previous_revision == expected_revision
            {
                return Ok(Some(receipt));
            }
            return Err(ShadowStoreError::ProjectionBatchReplayConflict {
                batch_id: batch_id.to_string(),
            });
        }
        let actual_revision = Self::revision_in(transaction)?;
        if actual_revision != expected_revision {
            return Err(ShadowStoreError::StaleRevision {
                expected: expected_revision,
                actual: actual_revision,
            });
        }
        Ok(None)
    }

    fn finish_projection_batch_in(
        transaction: &Transaction<'_>,
        batch_id: &str,
        input_digest: &str,
        expected_revision: i64,
        upserted: usize,
        deleted: usize,
    ) -> StoreResult<ProjectionCommit> {
        transaction.execute(ADVANCE_REVISION_SQL, [])?;
        let revision = Self::revision_in(transaction)?;
        transaction.execute(
            "INSERT INTO projection_batches (batchId, inputDigest, previousRevision, \
             committedRevision, upserted, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            params![
                batch_id,
                input_digest,
                expected_revision,
                revision,
                upserted as i64,
                deleted as i64,
            ],
        )?;
        Ok(ProjectionCommit {
            batch_id: batch_id.to_string(),
            input_digest: input_digest.to_string(),
            previous_revision: expected_revision,
            revision,
            upserted,
            deleted,
        })
    }

    fn apply_projection_batch_in(
        transaction: &Transaction<'_>,
        batch_id: &str,
        input_digest: &str,
        expected_revision: i64,
        rows: &[FeedItemRow],
        deleted_ids: &[String],
    ) -> StoreResult<ProjectionCommit> {
        if let Some(receipt) =
            Self::begin_projection_batch_in(transaction, batch_id, input_digest, expected_revision)?
        {
            return Ok(receipt);
        }
        {
            let mut statement = transaction.prepare_cached(UPSERT_SQL)?;
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
            let mut statement = transaction.prepare_cached(DELETE_SQL)?;
            for global_id in deleted_ids {
                deleted += statement.execute(params![global_id])?;
            }
        }
        Self::finish_projection_batch_in(
            transaction,
            batch_id,
            input_digest,
            expected_revision,
            rows.len(),
            deleted,
        )
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
        Self::validate_projection_batch_payload(rows, deleted_ids)?;
        let tx: Transaction<'_> = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let commit = Self::apply_projection_batch_in(
            &tx,
            batch_id,
            input_digest,
            expected_revision,
            rows,
            deleted_ids,
        )?;
        tx.commit()?;
        Ok(commit)
    }

    /// Applies one sequential batch to a fresh derived-shadow rebuild.
    ///
    /// The rebuild state, projected rows, ordinary projection receipt, batch
    /// mapping, revision, and completion marker share one transaction. An
    /// interrupted caller can reopen the staging store, read the exact next
    /// batch and row offsets, and retry the last committed batch without
    /// duplicating rows. This remains a derived-store receipt. It does not
    /// authorize Library Core migration or cutover.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn apply_projection_rebuild_batch(
        &mut self,
        rebuild_id: &str,
        source: &ProjectionSourceV1,
        total_rows: usize,
        batch_index: i64,
        batch_id: &str,
        input_digest: &str,
        projected_rows: usize,
        complete: bool,
        rows: &[FeedItemRow],
    ) -> StoreResult<ProjectionRebuildCommit> {
        Self::validate_projection_rebuild_identity(rebuild_id, source, total_rows)?;
        Self::validate_projection_batch_identity(batch_id, input_digest)?;
        Self::validate_projection_batch_payload(rows, &[])?;
        if !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&batch_index) {
            return Err(ShadowStoreError::InvalidProjectionRebuild {
                field: "batch_index",
            });
        }

        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state = Self::projection_rebuild_state_in(&transaction)?.ok_or(
            ShadowStoreError::InvalidProjectionRebuild {
                field: "missing_state",
            },
        )?;
        let state =
            Self::require_matching_projection_rebuild(state, rebuild_id, source, total_rows)?;
        Self::verify_projection_rebuild_state_in(&transaction, &state)?;

        let prior = transaction
            .query_row(
                "SELECT b.batchId, p.inputDigest, p.previousRevision, \
                 p.committedRevision, p.upserted, p.deleted, \
                 b.projectedRows, b.complete \
                 FROM projection_rebuild_batches b \
                 JOIN projection_batches p ON p.batchId = b.batchId \
                 WHERE b.rebuildId = ?1 AND b.batchIndex = ?2;",
                params![rebuild_id, batch_index],
                |row| {
                    Ok((
                        ProjectionCommit {
                            batch_id: row.get(0)?,
                            input_digest: row.get(1)?,
                            previous_revision: row.get(2)?,
                            revision: row.get(3)?,
                            upserted: row.get::<_, i64>(4)? as usize,
                            deleted: row.get::<_, i64>(5)? as usize,
                        },
                        row.get::<_, i64>(6)? as usize,
                        row.get::<_, i64>(7)? == 1,
                    ))
                },
            )
            .optional()?;
        if let Some((projection, prior_projected_rows, prior_complete)) = prior {
            if projection.batch_id != batch_id
                || projection.input_digest != input_digest
                || projection.upserted != rows.len()
                || projection.deleted != 0
                || prior_projected_rows != projected_rows
                || prior_complete != complete
            {
                return Err(ShadowStoreError::ProjectionRebuildConflict {
                    rebuild_id: rebuild_id.to_string(),
                });
            }
            transaction.commit()?;
            return Ok(ProjectionRebuildCommit { projection, state });
        }

        if state.complete {
            return Err(ShadowStoreError::ProjectionRebuildConflict {
                rebuild_id: rebuild_id.to_string(),
            });
        }
        if batch_index != state.next_batch_index {
            return Err(ShadowStoreError::ProjectionRebuildBatchOutOfOrder {
                expected: state.next_batch_index,
                actual: batch_index,
            });
        }
        let expected_projected_rows = state.projected_rows.saturating_add(rows.len());
        if projected_rows != expected_projected_rows || projected_rows > total_rows {
            return Err(ShadowStoreError::ProjectionRebuildRowCountMismatch {
                expected: expected_projected_rows,
                actual: projected_rows,
            });
        }
        if complete != (projected_rows == total_rows) {
            return Err(ShadowStoreError::InvalidProjectionRebuild { field: "complete" });
        }
        if Self::projection_receipt_in(&transaction, batch_id)?.is_some() {
            return Err(ShadowStoreError::ProjectionRebuildConflict {
                rebuild_id: rebuild_id.to_string(),
            });
        }

        let projection = Self::apply_projection_batch_in(
            &transaction,
            batch_id,
            input_digest,
            state.projection_revision,
            rows,
            &[],
        )?;
        if complete {
            let stored_rows =
                transaction.query_row("SELECT COUNT(*) FROM feed_items;", [], |row| {
                    row.get::<_, i64>(0)
                })? as usize;
            if stored_rows != total_rows {
                return Err(ShadowStoreError::ProjectionRebuildRowCountMismatch {
                    expected: total_rows,
                    actual: stored_rows,
                });
            }
        }
        transaction.execute(
            "INSERT INTO projection_rebuild_batches (\
             rebuildId, batchIndex, batchId, projectedRows, complete) \
             VALUES (?1, ?2, ?3, ?4, ?5);",
            params![
                rebuild_id,
                batch_index,
                batch_id,
                projected_rows as i64,
                i64::from(complete),
            ],
        )?;
        let updated = transaction.execute(
            "UPDATE projection_rebuild_state \
             SET nextBatchIndex = ?2, projectionRevision = ?3, \
                 projectedRows = ?4, complete = ?5 \
             WHERE singleton = 1 AND rebuildId = ?1 \
               AND nextBatchIndex = ?6 AND projectionRevision = ?7 \
               AND projectedRows = ?8 AND complete = 0;",
            params![
                rebuild_id,
                batch_index + 1,
                projection.revision,
                projected_rows as i64,
                i64::from(complete),
                state.next_batch_index,
                state.projection_revision,
                state.projected_rows as i64,
            ],
        )?;
        if updated != 1 {
            return Err(ShadowStoreError::ProjectionRebuildConflict {
                rebuild_id: rebuild_id.to_string(),
            });
        }
        let state = Self::projection_rebuild_state_in(&transaction)?
            .expect("projection rebuild state remains present after its batch");
        transaction.commit()?;
        Ok(ProjectionRebuildCommit { projection, state })
    }

    /// Applies one already validated local read assignment to the dark derived
    /// projection without reconstructing or rewriting the rest of the item.
    ///
    /// This reuses projection-batch receipts for exact response-loss retry. It
    /// remains derived-store bookkeeping, not an authoritative operation
    /// receipt, and has no production caller.
    fn apply_read_assignment_projection_batch(
        &mut self,
        batch_id: &str,
        input_digest: &str,
        expected_revision: i64,
        entity_id: &str,
        incoming_read_at: i64,
    ) -> StoreResult<ProjectionCommit> {
        Self::validate_projection_batch_identity(batch_id, input_digest)?;
        if entity_id.is_empty() || entity_id.len() > MAX_ENTITY_ID_UTF8_BYTES {
            return Err(ShadowStoreError::InvalidReadAssignment { field: "entity_id" });
        }
        if !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&incoming_read_at) {
            return Err(ShadowStoreError::InvalidReadAssignment {
                field: "read_at_ms",
            });
        }

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(receipt) =
            Self::begin_projection_batch_in(&tx, batch_id, input_digest, expected_revision)?
        {
            tx.commit()?;
            return Ok(receipt);
        }

        let current_read_at = tx
            .query_row(
                "SELECT readAt FROM feed_items WHERE globalId = ?1;",
                params![entity_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .ok_or_else(|| ShadowStoreError::ProjectionEntityNotFound {
                entity_id: entity_id.to_string(),
            })?;
        if current_read_at.is_some_and(|value| !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&value))
        {
            return Err(ShadowStoreError::InvalidReadAssignment {
                field: "current_read_at",
            });
        }
        let next_read_at = current_read_at
            .map(|current| current.min(incoming_read_at))
            .unwrap_or(incoming_read_at);
        let updated = tx.execute(
            READ_ASSIGNMENT_PROJECTION_V1_SQL,
            params![entity_id, next_read_at],
        )?;
        if updated != 1 {
            return Err(ShadowStoreError::ProjectionEntityNotFound {
                entity_id: entity_id.to_string(),
            });
        }

        let commit =
            Self::finish_projection_batch_in(&tx, batch_id, input_digest, expected_revision, 1, 0)?;
        tx.commit()?;
        Ok(commit)
    }

    /// Reads one bounded page of the timeline.
    ///
    /// `limit` is a hard bound, not a hint. The caller gets at most that many
    /// rows and a cursor, never the whole library.
    pub(super) fn feed_page(
        &self,
        cursor: Option<&PageCursor>,
        limit: u32,
    ) -> StoreResult<FeedPage> {
        if !(1..=MAX_FEED_PAGE_LIMIT).contains(&limit) {
            return Err(ShadowStoreError::InvalidPageLimit {
                requested: limit,
                maximum: MAX_FEED_PAGE_LIMIT,
            });
        }
        let tx = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&tx)?;
        let revision = Self::revision_in(&tx)?;
        if let Some(cursor) = cursor {
            if cursor.revision != revision {
                return Err(ShadowStoreError::StaleRevision {
                    expected: cursor.revision,
                    actual: revision,
                });
            }
        }

        let candidates = match cursor {
            None => {
                let mut statement = tx.prepare_cached(PAGE_FIRST_SQL)?;
                let mapped = statement.query_map(params![limit], FeedCardRow::from_row)?;
                mapped.collect::<SqlResult<Vec<_>>>()?
            }
            Some(cursor) => {
                let mut statement = tx.prepare_cached(PAGE_AFTER_SQL)?;
                let mapped = statement
                    .query_map(params![cursor.sort_at, cursor.global_id, limit], |row| {
                        FeedCardRow::from_row(row)
                    })?;
                mapped.collect::<SqlResult<Vec<_>>>()?
            }
        };
        let total_count = tx.query_row(
            &format!("SELECT COUNT(*) FROM feed_items WHERE {VISIBLE_PREDICATE};"),
            [],
            |row| row.get(0),
        )?;
        let row_budget =
            MAX_FEED_PAGE_RESPONSE_BYTES.saturating_sub(FEED_PAGE_ENVELOPE_RESERVE_BYTES);
        let mut rows = Vec::with_capacity(candidates.len());
        let mut serialized_row_bytes = 0usize;
        let mut truncated_by_bytes = false;
        for candidate in candidates {
            let candidate_bytes = candidate.serialized_size_bytes()?;
            let next_row_bytes = serialized_row_bytes
                .saturating_add(candidate_bytes)
                .saturating_add(usize::from(!rows.is_empty()));
            // The next cursor repeats the final row's identity. Measure its
            // encoded form instead of its raw string bytes because JSON escaping
            // can expand one input byte into six output bytes.
            let candidate_cursor = PageCursor {
                revision,
                sort_at: candidate.sort_key(),
                global_id: candidate.global_id.clone(),
            };
            let next_bounded_bytes =
                next_row_bytes.saturating_add(candidate_cursor.serialized_size_bytes()?);
            if next_bounded_bytes > row_budget {
                if rows.is_empty() {
                    return Err(ShadowStoreError::FeedCardExceedsResponseBudget {
                        requested: next_bounded_bytes,
                        maximum: row_budget,
                    });
                }
                truncated_by_bytes = true;
                break;
            }
            serialized_row_bytes = next_row_bytes;
            rows.push(candidate);
        }

        // A short page means the feed ended. Handing back a cursor there would
        // invite one more round trip that can only return nothing.
        let next_cursor = if truncated_by_bytes || rows.len() as u32 == limit {
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
            total_count,
            serialized_row_bytes,
            rows,
            next_cursor,
        })
    }

    fn visible_count(&self, expected_revision: Option<i64>) -> StoreResult<RevisionedCount> {
        let tx = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&tx)?;
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
        let transaction = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&transaction)?;
        let count =
            transaction.query_row("SELECT COUNT(*) FROM feed_items;", [], |row| row.get(0))?;
        transaction.commit()?;
        Ok(count)
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

#[cfg(unix)]
fn same_published_file_generation(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
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
fn same_published_file_generation(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
        && left.created().ok() == right.created().ok()
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
            tags: Some("[\"important\"]".to_string()),
            content_blob: Some(
                "{\"text\":\"body\",\"mediaUrls\":[],\"mediaTypes\":[]}".to_string(),
            ),
            preserved_blob: Some("{\"readingTime\":3}".to_string()),
            rest: "{\"__author\":{\"avatarUrl\":\"https://example.test/avatar.png\"},\"__userState\":{\"liked\":false},\"engagement\":{\"likes\":3,\"comments\":1}}".to_string(),
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

    fn projection_source(index: usize) -> ProjectionSourceV1 {
        ProjectionSourceV1 {
            document_id: format!("document-{index}"),
            heads_digest: digest(index),
            head_count: 2,
            storage_generation: 3,
            storage_save_revision: 5,
        }
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
    fn feed_pages_expose_only_bounded_card_fields() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let mut projected = row(1, Some(1_780_000_000_000));
        projected.source_url = Some(format!("https://example.test/{}", "s".repeat(4_096)));
        projected.tags = Some(
            serde_json::to_string(
                &(0..40)
                    .map(|index| format!("tag-{index}"))
                    .collect::<Vec<_>>(),
            )
            .expect("tags"),
        );
        projected.content_blob = Some(
            serde_json::json!({
                "text": "t".repeat(2_000),
                "mediaUrls": (0..12)
                    .map(|index| format!("https://media.test/{index}/{}", "m".repeat(3_000)))
                    .collect::<Vec<_>>(),
                "mediaTypes": (0..12).map(|_| "image").collect::<Vec<_>>(),
                "linkPreview": {
                    "title": "l".repeat(700),
                    "description": "FULL_CONTENT_MUST_NOT_ESCAPE"
                }
            })
            .to_string(),
        );
        projected.preserved_blob = Some(
            serde_json::json!({
                "readingTime": 17,
                "text": "FULL_PRESERVED_BODY_MUST_NOT_ESCAPE".repeat(1_000)
            })
            .to_string(),
        );
        projected.rest = serde_json::json!({
            "__author": {
                "avatarUrl": format!("https://avatar.test/{}", "a".repeat(3_000))
            },
            "__userState": {
                "liked": true,
                "likedSyncedAt": 1_780_000_000_001_i64
            },
            "engagement": { "likes": 42, "comments": 7 },
            "location": { "name": "Somewhere" },
            "contentSignals": {
                "tags": (0..40)
                    .map(|index| format!("signal-{index}"))
                    .collect::<Vec<_>>()
            },
            "eventCandidate": {
                "startsAt": 1_780_000_000_002_i64,
                "confidence": 0.875
            },
            "unmodelledPrivateField": "FULL_REST_MUST_NOT_ESCAPE"
        })
        .to_string();
        store
            .apply_projection_batch("bounded-card", &digest(1), 0, &[projected], &[])
            .expect("project");

        let page = store.feed_page(None, 1).expect("page");
        assert_eq!(page.total_count, 1);
        assert_eq!(page.rows.len(), 1);
        let card = &page.rows[0];
        assert_eq!(card.content_text.as_ref().map(String::len), Some(1_500));
        assert_eq!(card.media_urls.len(), MAX_FEED_CARD_MEDIA);
        assert!(card.media_urls.iter().all(|value| value.len() <= 2_048));
        assert_eq!(card.media_types.len(), MAX_FEED_CARD_MEDIA);
        assert_eq!(card.link_preview_title.as_ref().map(String::len), Some(512));
        assert_eq!(card.tags.len(), MAX_FEED_CARD_TAGS);
        assert_eq!(card.content_signal_tags.len(), MAX_FEED_CARD_SIGNAL_TAGS);
        assert_eq!(card.reading_time_minutes, Some(17));
        assert_eq!(card.event_confidence_basis_points, Some(8_750));
        let serialized = serde_json::to_string(card).expect("serialize card");
        for forbidden in [
            "FULL_CONTENT_MUST_NOT_ESCAPE",
            "FULL_PRESERVED_BODY_MUST_NOT_ESCAPE",
            "FULL_REST_MUST_NOT_ESCAPE",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn feed_pages_reject_values_outside_the_closed_cross_runtime_contract() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let projected = row(1, Some(-1));
        store
            .apply_projection_batch("invalid-card", &digest(2), 0, &[projected], &[])
            .expect("project");
        assert!(matches!(
            store.feed_page(None, 1),
            Err(ShadowStoreError::Sql(
                rusqlite::Error::FromSqlConversionFailure(_, _, _)
            ))
        ));
    }

    #[test]
    fn feed_cards_never_coerce_malformed_optional_fields() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let mut projected = row(1, Some(1_780_000_000_000));
        projected.tags = Some(serde_json::json!("not-an-array").to_string());
        projected.content_blob = Some(
            serde_json::json!({
                "text": 42,
                "mediaUrls": "not-an-array",
                "mediaTypes": { "image": true },
                "linkPreview": { "title": false }
            })
            .to_string(),
        );
        projected.preserved_blob = Some(
            serde_json::json!({
                "readingTime": "17"
            })
            .to_string(),
        );
        projected.rest = serde_json::json!({
            "__author": { "avatarUrl": 42 },
            "__userState": {
                "liked": "true",
                "likedSyncedAt": 1.5
            },
            "engagement": {
                "likes": 42.5,
                "comments": "7"
            },
            "location": { "name": 42 },
            "contentSignals": { "tags": "event" },
            "eventCandidate": {
                "startsAt": "tomorrow",
                "confidence": 1.5
            }
        })
        .to_string();
        store
            .apply_projection_batch("malformed-card", &digest(1), 0, &[projected], &[])
            .expect("project");

        let page = store.feed_page(None, 1).expect("page");
        let card = &page.rows[0];
        assert_eq!(card.author_avatar_url, None);
        assert_eq!(card.liked, None);
        assert_eq!(card.liked_synced_at, None);
        assert_eq!(card.content_text, None);
        assert!(card.media_urls.is_empty());
        assert!(card.media_types.is_empty());
        assert_eq!(card.link_preview_title, None);
        assert!(card.tags.is_empty());
        assert_eq!(card.engagement_likes, None);
        assert_eq!(card.engagement_comments, None);
        assert_eq!(card.location_name, None);
        assert_eq!(card.reading_time_minutes, None);
        assert!(card.content_signal_tags.is_empty());
        assert_eq!(card.event_starts_at, None);
        assert_eq!(card.event_confidence_basis_points, None);
    }

    #[test]
    fn feed_page_bytes_are_bounded_even_when_the_requested_row_limit_fits() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let media = (0..MAX_FEED_CARD_MEDIA)
            .map(|index| format!("https://media.test/{index}/{}", "m".repeat(2_048)))
            .collect::<Vec<_>>();
        let mut rows = corpus(MAX_FEED_PAGE_LIMIT as usize);
        for projected in &mut rows {
            projected.source_url = Some(format!("https://source.test/{}", "s".repeat(2_048)));
            projected.content_blob = Some(
                serde_json::json!({
                    "text": "t".repeat(1_500),
                    "mediaUrls": media,
                    "mediaTypes": vec!["image"; MAX_FEED_CARD_MEDIA],
                })
                .to_string(),
            );
            projected.rest = serde_json::json!({
                "__author": {
                    "avatarUrl": format!("https://avatar.test/{}", "a".repeat(2_048))
                }
            })
            .to_string();
        }
        store
            .apply_projection_batch("large-cards", &digest(1), 0, &rows, &[])
            .expect("project");

        let page = store
            .feed_page(None, MAX_FEED_PAGE_LIMIT)
            .expect("bounded page");
        assert_eq!(page.total_count, i64::from(MAX_FEED_PAGE_LIMIT));
        assert!(page.rows.len() < MAX_FEED_PAGE_LIMIT as usize);
        assert!(page.next_cursor.is_some());
        assert!(
            page.serialized_row_bytes
                + page.next_cursor.as_ref().map_or(0, |cursor| cursor
                    .serialized_size_bytes()
                    .expect("cursor bytes"))
                <= MAX_FEED_PAGE_RESPONSE_BYTES - FEED_PAGE_ENVELOPE_RESERVE_BYTES
        );
    }

    #[test]
    fn feed_page_cursor_budget_counts_json_escape_expansion() {
        let cursor = PageCursor {
            revision: 1,
            sort_at: 2,
            global_id: "\u{0000}".repeat(MAX_ENTITY_ID_UTF8_BYTES),
        };

        assert!(
            cursor.serialized_size_bytes().expect("cursor bytes") > cursor.global_id.len() * 5,
            "the response budget must count encoded cursor bytes, not raw ID bytes"
        );
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
        for table in ["projection_batches", "projection_rebuild_state"] {
            let table_exists: bool = store
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
                     WHERE type = 'table' AND name = ?1);",
                    params![table],
                    |row| row.get(0),
                )
                .expect("migrated table");
            assert!(table_exists, "{table} should be installed by migration");
        }

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

        let read_entity_id = rows[0].global_id.clone();
        let original_read = reopened
            .apply_read_assignment_projection_batch(
                "stable-read",
                &digest(44),
                1,
                &read_entity_id,
                25,
            )
            .expect("commit read before response loss");
        drop(reopened);
        let mut reopened = ShadowStore::open(&path).expect("reopen read receipt");
        let retried_read = reopened
            .apply_read_assignment_projection_batch(
                "stable-read",
                &digest(44),
                1,
                &read_entity_id,
                25,
            )
            .expect("read durable read receipt");
        assert_eq!(retried_read, original_read);
        assert_eq!(
            reopened
                .feed_page(None, 128)
                .expect("read projected page")
                .rows
                .into_iter()
                .find(|row| row.global_id == read_entity_id)
                .expect("read entity")
                .read_at,
            Some(25)
        );
        for (input_digest, expected_revision) in [(digest(45), 1), (digest(44), 2)] {
            assert!(matches!(
                reopened
                    .apply_read_assignment_projection_batch(
                        "stable-read",
                        &input_digest,
                        expected_revision,
                        &read_entity_id,
                        25,
                    )
                    .expect_err("changed read replay tuple must fail"),
                ShadowStoreError::ProjectionBatchReplayConflict { .. }
            ));
        }
        drop(reopened);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn derived_rebuild_resumes_exactly_and_exposes_only_a_complete_generation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-rebuild-resume-{}-{nonce}.sqlite",
            std::process::id()
        ));
        let source = projection_source(71);
        let rows = corpus(3);
        let first_commit = {
            let mut store = ShadowStore::open(&path).expect("open staging store");
            let started = store
                .begin_projection_rebuild("rebuild-71", &source, rows.len())
                .expect("begin rebuild");
            assert_eq!(started.next_batch_index, 0);
            assert_eq!(started.projection_revision, 0);
            assert_eq!(started.projected_rows, 0);
            assert!(!started.complete);

            assert!(matches!(
                store
                    .apply_projection_rebuild_batch(
                        "rebuild-71",
                        &source,
                        rows.len(),
                        1,
                        "rebuild-71-batch-1",
                        &digest(72),
                        2,
                        false,
                        &rows[..2],
                    )
                    .expect_err("out-of-order batch must fail"),
                ShadowStoreError::ProjectionRebuildBatchOutOfOrder {
                    expected: 0,
                    actual: 1
                }
            ));

            let committed = store
                .apply_projection_rebuild_batch(
                    "rebuild-71",
                    &source,
                    rows.len(),
                    0,
                    "rebuild-71-batch-0",
                    &digest(73),
                    2,
                    false,
                    &rows[..2],
                )
                .expect("commit first batch");
            assert_eq!(committed.state.next_batch_index, 1);
            assert_eq!(committed.state.projection_revision, 1);
            assert_eq!(committed.state.projected_rows, 2);
            assert!(!committed.state.complete);
            assert!(matches!(
                store
                    .total_count()
                    .expect_err("partial rebuild must not be readable"),
                ShadowStoreError::ProjectionRebuildIncomplete { .. }
            ));
            committed
        };

        let mut reopened = ShadowStore::open(&path).expect("reopen staging store");
        let resumed = reopened
            .begin_projection_rebuild("rebuild-71", &source, rows.len())
            .expect("resume exact rebuild");
        assert_eq!(resumed, first_commit.state);
        let retried = reopened
            .apply_projection_rebuild_batch(
                "rebuild-71",
                &source,
                rows.len(),
                0,
                "rebuild-71-batch-0",
                &digest(73),
                2,
                false,
                &rows[..2],
            )
            .expect("retry committed batch");
        assert_eq!(retried, first_commit);

        let completed = reopened
            .apply_projection_rebuild_batch(
                "rebuild-71",
                &source,
                rows.len(),
                1,
                "rebuild-71-batch-1",
                &digest(74),
                3,
                true,
                &rows[2..],
            )
            .expect("complete rebuild");
        assert!(completed.state.complete);
        assert_eq!(completed.state.projected_rows, rows.len());
        assert_eq!(completed.state.next_batch_index, 2);
        assert_eq!(completed.state.projection_revision, 2);
        assert_eq!(reopened.total_count().expect("complete count"), 3);

        let changed_source = projection_source(75);
        assert!(matches!(
            reopened
                .begin_projection_rebuild("rebuild-71", &changed_source, rows.len())
                .expect_err("changed source must not resume"),
            ShadowStoreError::ProjectionRebuildConflict { .. }
        ));

        drop(reopened);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn derived_rebuild_state_failure_rolls_back_rows_receipts_and_revision() {
        let mut store = ShadowStore::open_in_memory().expect("open staging store");
        let source = projection_source(81);
        let started = store
            .begin_projection_rebuild("rebuild-81", &source, 1)
            .expect("begin rebuild");
        store
            .conn
            .execute_batch(
                "CREATE TEMP TRIGGER reject_rebuild_state \
                 BEFORE UPDATE ON projection_rebuild_state \
                 BEGIN SELECT RAISE(FAIL, 'forced rebuild-state failure'); END;",
            )
            .expect("install fault");

        assert!(matches!(
            store
                .apply_projection_rebuild_batch(
                    "rebuild-81",
                    &source,
                    1,
                    0,
                    "rebuild-81-batch-0",
                    &digest(82),
                    1,
                    true,
                    &[row(1, Some(1_780_000_000_000))],
                )
                .expect_err("state failure must roll back"),
            ShadowStoreError::Sql(_)
        ));
        let transaction = store.conn.unchecked_transaction().expect("inspect");
        assert_eq!(
            transaction
                .query_row("SELECT COUNT(*) FROM feed_items;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("rolled-back rows"),
            0
        );
        assert_eq!(ShadowStore::revision_in(&transaction).expect("revision"), 0);
        assert_eq!(
            ShadowStore::projection_rebuild_state_in(&transaction)
                .expect("state")
                .expect("rebuild state"),
            started
        );
        assert_eq!(
            transaction
                .query_row("SELECT COUNT(*) FROM projection_batches;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("receipt count"),
            0
        );
        assert_eq!(
            transaction
                .query_row(
                    "SELECT COUNT(*) FROM projection_rebuild_batches;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("rebuild batch count"),
            0
        );
        transaction.commit().expect("close inspection");
    }

    #[test]
    fn complete_rebuild_publishes_one_self_contained_immutable_generation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::fs::canonicalize(std::env::temp_dir())
            .expect("resolve publication temp root")
            .join(format!(
                "freed-shadow-publish-{}-{nonce}",
                std::process::id()
            ));
        std::fs::create_dir(&directory).expect("create publication directory");
        let staging = directory.join("rebuild.staging.sqlite");
        let published = directory.join("generation-91.sqlite");
        let source = projection_source(91);
        let rows = corpus(3);

        let mut store = ShadowStore::open(&staging).expect("open staging store");
        store
            .begin_projection_rebuild("rebuild-91", &source, rows.len())
            .expect("begin rebuild");
        store
            .apply_projection_rebuild_batch(
                "rebuild-91",
                &source,
                rows.len(),
                0,
                "rebuild-91-batch-0",
                &digest(92),
                rows.len(),
                true,
                &rows,
            )
            .expect("complete rebuild");
        let receipt = store
            .publish_complete_projection_generation(&published, "rebuild-91", &source, rows.len())
            .expect("publish complete generation");

        assert_eq!(receipt.path, published);
        assert_eq!(receipt.rebuild_id, "rebuild-91");
        assert_eq!(receipt.source, source);
        assert_eq!(receipt.total_rows, rows.len());
        assert_eq!(receipt.projection_revision, 1);
        assert!(receipt.byte_length > 0);
        assert!(!staging.exists());
        assert!(published.is_file());
        for path in [
            format!("{}-wal", staging.display()),
            format!("{}-shm", staging.display()),
            format!("{}-wal", published.display()),
            format!("{}-shm", published.display()),
        ] {
            assert!(!Path::new(&path).exists(), "sealed generation left {path}");
        }

        let readback = ShadowStore::inspect_published_projection_generation(
            &published,
            "rebuild-91",
            &source,
            rows.len(),
        )
        .expect("read back response-loss receipt");
        assert_eq!(readback, receipt);
        let (bounded_reader, _) =
            ShadowStore::open_published_projection_generation_read_only_with_cache_kib(
                &published,
                "rebuild-91",
                &source,
                rows.len(),
                -2 * 1024,
            )
            .expect("bounded read-only cache");
        assert_eq!(
            bounded_reader
                .conn
                .pragma_query_value(None, "cache_size", |row| row.get::<_, i64>(0))
                .expect("bounded cache size"),
            -2 * 1024
        );
        drop(bounded_reader);
        let reopened = ShadowStore::open(&published).expect("open published generation");
        assert_eq!(
            reopened.total_count().expect("published count"),
            rows.len() as i64
        );
        drop(reopened);

        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", published.display()));
        }
        std::fs::remove_dir(directory).expect("remove publication directory");
    }

    #[test]
    fn incomplete_rebuild_cannot_publish_and_remains_resumable() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::fs::canonicalize(std::env::temp_dir())
            .expect("resolve publication temp root")
            .join(format!(
                "freed-shadow-incomplete-publish-{}-{nonce}",
                std::process::id()
            ));
        std::fs::create_dir(&directory).expect("create publication directory");
        let staging = directory.join("rebuild.staging.sqlite");
        let published = directory.join("generation-101.sqlite");
        let source = projection_source(101);
        let rows = corpus(2);
        let mut store = ShadowStore::open(&staging).expect("open staging store");
        store
            .begin_projection_rebuild("rebuild-101", &source, rows.len())
            .expect("begin rebuild");
        store
            .apply_projection_rebuild_batch(
                "rebuild-101",
                &source,
                rows.len(),
                0,
                "rebuild-101-batch-0",
                &digest(102),
                1,
                false,
                &rows[..1],
            )
            .expect("commit partial rebuild");

        assert!(matches!(
            store
                .publish_complete_projection_generation(
                    &published,
                    "rebuild-101",
                    &source,
                    rows.len(),
                )
                .expect_err("incomplete rebuild must not publish"),
            ShadowStoreError::ProjectionRebuildIncomplete { .. }
        ));
        assert!(staging.is_file());
        assert!(!published.exists());
        let mut resumed = ShadowStore::open(&staging).expect("reopen incomplete staging store");
        let state = resumed
            .begin_projection_rebuild("rebuild-101", &source, rows.len())
            .expect("resume incomplete rebuild");
        assert_eq!(state.next_batch_index, 1);
        assert_eq!(state.projected_rows, 1);
        assert!(!state.complete);
        drop(resumed);

        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", staging.display()));
        }
        std::fs::remove_dir(directory).expect("remove publication directory");
    }

    #[test]
    fn publication_never_replaces_an_existing_generation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::fs::canonicalize(std::env::temp_dir())
            .expect("resolve publication temp root")
            .join(format!(
                "freed-shadow-publish-conflict-{}-{nonce}",
                std::process::id()
            ));
        std::fs::create_dir(&directory).expect("create publication directory");
        let staging = directory.join("rebuild.staging.sqlite");
        let published = directory.join("generation-111.sqlite");
        let sentinel = b"existing immutable generation";
        std::fs::write(&published, sentinel).expect("seed existing destination");
        let source = projection_source(111);
        let rows = corpus(1);
        let mut store = ShadowStore::open(&staging).expect("open staging store");
        store
            .begin_projection_rebuild("rebuild-111", &source, rows.len())
            .expect("begin rebuild");
        store
            .apply_projection_rebuild_batch(
                "rebuild-111",
                &source,
                rows.len(),
                0,
                "rebuild-111-batch-0",
                &digest(112),
                rows.len(),
                true,
                &rows,
            )
            .expect("complete rebuild");

        assert!(matches!(
            store
                .publish_complete_projection_generation(
                    &published,
                    "rebuild-111",
                    &source,
                    rows.len(),
                )
                .expect_err("existing generation must block"),
            ShadowStoreError::ProjectionPublicationConflict { .. }
        ));
        assert_eq!(
            std::fs::read(&published).expect("read existing generation"),
            sentinel
        );
        assert!(staging.is_file());
        assert!(
            publish_projection_file(&staging, &published).is_err(),
            "the publication primitive itself must refuse replacement"
        );
        assert_eq!(
            std::fs::read(&published).expect("read destination after primitive"),
            sentinel
        );
        assert!(staging.is_file());

        for path in [&staging, &published] {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
            }
        }
        std::fs::remove_dir(directory).expect("remove publication directory");
    }

    #[test]
    fn read_assignment_updates_only_read_at_and_retries_exactly() {
        let mut store = seeded(1);
        let before = store
            .feed_page(None, 1)
            .expect("read before assignment")
            .rows
            .into_iter()
            .next()
            .expect("seeded row");

        let first = store
            .apply_read_assignment_projection_batch(
                "read-first",
                &digest(50),
                1,
                &before.global_id,
                30,
            )
            .expect("first read assignment");
        assert_eq!(
            first,
            ProjectionCommit {
                batch_id: "read-first".to_string(),
                input_digest: digest(50),
                previous_revision: 1,
                revision: 2,
                upserted: 1,
                deleted: 0,
            }
        );
        let after_first = store
            .feed_page(None, 1)
            .expect("read after assignment")
            .rows
            .into_iter()
            .next()
            .expect("materialized row");
        let mut expected = before.clone();
        expected.read_at = Some(30);
        assert_eq!(after_first, expected, "no other column may be rewritten");

        let retried = store
            .apply_read_assignment_projection_batch(
                "read-first",
                &digest(50),
                1,
                &before.global_id,
                30,
            )
            .expect("response-loss retry");
        assert_eq!(retried, first);

        let later = store
            .apply_read_assignment_projection_batch(
                "read-later",
                &digest(51),
                2,
                &before.global_id,
                40,
            )
            .expect("later assignment");
        assert_eq!(later.revision, 3);
        assert_eq!(
            store
                .feed_page(None, 1)
                .expect("read after later assignment")
                .rows[0]
                .read_at,
            Some(30),
            "the earliest assignment must survive"
        );

        let earlier = store
            .apply_read_assignment_projection_batch(
                "read-earlier",
                &digest(52),
                3,
                &before.global_id,
                20,
            )
            .expect("earlier assignment");
        assert_eq!(earlier.revision, 4);
        assert_eq!(
            store
                .feed_page(None, 1)
                .expect("read after earlier assignment")
                .rows[0]
                .read_at,
            Some(20)
        );
    }

    #[test]
    fn read_assignment_rejects_invalid_or_missing_projection_state() {
        let mut store = seeded(1);
        let entity_id = store.feed_page(None, 1).expect("seed page").rows[0]
            .global_id
            .clone();
        let oversized_entity_id = "a".repeat(MAX_ENTITY_ID_UTF8_BYTES + 1);

        for (batch_id, candidate_entity_id, read_at, field) in [
            ("empty-entity", "", 1, "entity_id"),
            (
                "oversized-entity",
                oversized_entity_id.as_str(),
                1,
                "entity_id",
            ),
            ("negative-read", entity_id.as_str(), -1, "read_at_ms"),
            (
                "unsafe-read",
                entity_id.as_str(),
                MAX_JAVASCRIPT_SAFE_INTEGER + 1,
                "read_at_ms",
            ),
        ] {
            match store
                .apply_read_assignment_projection_batch(
                    batch_id,
                    &digest(60),
                    1,
                    candidate_entity_id,
                    read_at,
                )
                .expect_err("invalid assignment must fail")
            {
                ShadowStoreError::InvalidReadAssignment { field: actual } => {
                    assert_eq!(actual, field);
                }
                error => panic!("unexpected assignment error: {error:?}"),
            }
        }

        match store
            .apply_read_assignment_projection_batch(
                "missing-entity",
                &digest(61),
                1,
                "x:missing",
                1,
            )
            .expect_err("missing row must fail")
        {
            ShadowStoreError::ProjectionEntityNotFound { entity_id } => {
                assert_eq!(entity_id, "x:missing");
            }
            error => panic!("unexpected missing-row error: {error:?}"),
        }

        store
            .conn
            .execute(
                "UPDATE feed_items SET readAt = -1 WHERE globalId = ?1;",
                params![entity_id],
            )
            .expect("inject invalid current projection");
        match store
            .apply_read_assignment_projection_batch(
                "invalid-current",
                &digest(62),
                1,
                &entity_id,
                1,
            )
            .expect_err("invalid current projection must fail")
        {
            ShadowStoreError::InvalidReadAssignment { field } => {
                assert_eq!(field, "current_read_at");
            }
            error => panic!("unexpected current-state error: {error:?}"),
        }

        assert_eq!(
            store.visible_count(Some(1)).expect("unchanged revision"),
            RevisionedCount {
                revision: 1,
                count: 1,
            }
        );
        let receipts: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM projection_batches WHERE batchId LIKE 'read-%' \
                 OR batchId IN ('missing-entity', 'invalid-current');",
                [],
                |row| row.get(0),
            )
            .expect("receipt count");
        assert_eq!(receipts, 0);
    }

    #[test]
    fn read_assignment_receipt_failure_rolls_back_the_field_and_revision() {
        let mut store = seeded(1);
        let entity_id = store.feed_page(None, 1).expect("seed page").rows[0]
            .global_id
            .clone();
        store
            .conn
            .execute_batch(
                "CREATE TEMP TRIGGER reject_read_assignment_receipt \
                 BEFORE INSERT ON projection_batches \
                 WHEN NEW.batchId = 'read-must-rollback' \
                 BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;",
            )
            .expect("install failure injection");

        let error = store
            .apply_read_assignment_projection_batch(
                "read-must-rollback",
                &digest(70),
                1,
                &entity_id,
                10,
            )
            .expect_err("receipt failure must roll back");
        assert!(matches!(error, ShadowStoreError::Sql(_)));
        assert_eq!(
            store.feed_page(None, 1).expect("row after rollback").rows[0].read_at,
            None
        );
        assert_eq!(
            store
                .visible_count(Some(1))
                .expect("revision after rollback"),
            RevisionedCount {
                revision: 1,
                count: 1,
            }
        );
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
        let mut invalid_row = row(1, Some(1));
        invalid_row.global_id = "x".repeat(MAX_ENTITY_ID_UTF8_BYTES + 1);
        for (rows, deleted_ids) in [
            (vec![invalid_row], Vec::new()),
            (Vec::new(), vec![String::new()]),
        ] {
            assert!(matches!(
                store
                    .apply_projection_batch("invalid-entity", &digest(2), 0, &rows, &deleted_ids,)
                    .expect_err("invalid projection entity ID must fail"),
                ShadowStoreError::InvalidProjectionEntityId
            ));
        }
        let mut maximum_source_document = row(1, None);
        maximum_source_document.content_blob = Some("x".repeat(4 * 1024 * 1024));
        ShadowStore::validate_projection_batch_payload(&[maximum_source_document], &[])
            .expect("one maximum source document plus bounded projection metadata must fit");
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
        changed.content_blob =
            Some("{\"text\":\"edited\",\"mediaUrls\":[],\"mediaTypes\":[]}".to_string());
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
        assert_eq!(stored.global_id, rows[0].global_id);
        let stored_content: Option<String> = store
            .conn
            .query_row(
                "SELECT contentBlob FROM feed_items WHERE globalId = ?1;",
                params![rows[0].global_id],
                |row| row.get(0),
            )
            .expect("stored content");
        assert_eq!(
            stored_content.as_deref(),
            Some("{\"text\":\"edited\",\"mediaUrls\":[],\"mediaTypes\":[]}")
        );
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
