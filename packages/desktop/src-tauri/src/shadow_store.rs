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
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::Duration;
use url::Url;

pub(super) const SHADOW_SCHEMA_VERSION: i64 = 4;
const MIN_READABLE_SHADOW_SCHEMA_VERSION: i64 = 3;
const MAX_FEED_PAGE_LIMIT: u32 = 128;
const MAX_ITEM_SCAN_PAGE_LIMIT: u32 = 64;
const MAX_MAP_SURFACE_ITEMS: u32 = 1_000;
const MAX_STORY_WALL_SURFACE_ITEMS: u32 = 250;
const MAX_SAVED_ANALYTICS_SOURCE_LABELS: usize = 4_096;
const MAX_SAVED_ANALYTICS_CONTENT_TYPES: usize = 64;
const MAX_SAVED_ANALYTICS_LABEL_BYTES: usize = 2_048;
const MAX_FRIEND_SOURCE_KEYS: usize = 5_000;
const MAX_FRIEND_SAMPLE_ITEMS: usize = 5;
const MAX_FRIEND_LOCATION_CANDIDATES: usize = 8;
const MAX_PERSON_TIMELINE_LIMIT: u32 = 100;
const MAX_FRIENDS_GRAPH_RETAINED_BYTES: usize = 8 * 1_048_576 - 64 * 1_024;
const MAX_ITEM_SCAN_ROW_BYTES: usize = 8 * 1_048_576 - 64 * 1_024;
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
const MAX_SAFE_INTEGER_DECIMAL_GROWTH: usize = 15;
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
    InvalidItemScanPageLimit {
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
    ItemScanRowExceedsResponseBudget {
        requested: usize,
        maximum: usize,
    },
    FacetSummaryExceedsResponseBudget {
        requested: usize,
        maximum: usize,
    },
    FacetTagExceedsResponseBudget {
        requested_bytes: usize,
        maximum_bytes: usize,
    },
    SurfaceItemsExceedLimit {
        requested: usize,
        maximum: usize,
    },
    InvalidSavedAnalyticsProjection {
        field: &'static str,
    },
    SavedAnalyticsExceedsResponseBudget {
        field: &'static str,
        requested: usize,
        maximum: usize,
    },
    InvalidFriendsQuery {
        field: &'static str,
    },
    FriendsSourceLimit {
        requested: usize,
        maximum: usize,
    },
    FriendsGraphExceedsResponseBudget {
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
            Self::InvalidItemScanPageLimit { requested, maximum } => write!(
                formatter,
                "item scan page limit {requested} exceeds the supported range 1 through {maximum}"
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
            Self::ItemScanRowExceedsResponseBudget { requested, maximum } => write!(
                formatter,
                "one item scan row requires {requested} serialized bytes, maximum {maximum}"
            ),
            Self::FacetSummaryExceedsResponseBudget { requested, maximum } => write!(
                formatter,
                "facet summary contains {requested} tags, maximum {maximum}"
            ),
            Self::FacetTagExceedsResponseBudget {
                requested_bytes,
                maximum_bytes,
            } => write!(
                formatter,
                "one facet tag requires at least {requested_bytes} UTF-8 bytes, maximum {maximum_bytes}"
            ),
            Self::SurfaceItemsExceedLimit { requested, maximum } => write!(
                formatter,
                "surface contains at least {requested} candidate rows, maximum {maximum}"
            ),
            Self::InvalidSavedAnalyticsProjection { field } => {
                write!(formatter, "saved analytics cannot exactly project {field}")
            }
            Self::SavedAnalyticsExceedsResponseBudget {
                field,
                requested,
                maximum,
            } => write!(
                formatter,
                "saved analytics {field} contains {requested} entries or bytes, maximum {maximum}"
            ),
            Self::InvalidFriendsQuery { field } => {
                write!(formatter, "Friends query cannot exactly project {field}")
            }
            Self::FriendsSourceLimit { requested, maximum } => write!(
                formatter,
                "Friends query contains {requested} source keys, maximum {maximum}"
            ),
            Self::FriendsGraphExceedsResponseBudget { requested, maximum } => write!(
                formatter,
                "Friends graph requires {requested} retained bytes, maximum {maximum}"
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
const SHADOW_SCHEMA_V4_SQL: &str =
    include_str!("../../../shared/src/library-core/shadow-schema-v4.sql");
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LibraryFacetSummary {
    pub(super) archived_count: i64,
    pub(super) sample_item_count: i64,
    pub(super) saved_archived_count: i64,
    pub(super) saved_count: i64,
    pub(super) saved_platform_count: i64,
    pub(super) tags: Vec<String>,
    pub(super) total_count: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LibrarySurface {
    Map,
    StoryWall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SavedAnalyticsWindow {
    pub(super) start_ms: i64,
    pub(super) end_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SavedAnalyticsCount {
    pub(super) label: String,
    pub(super) count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LibrarySavedAnalytics {
    pub(super) total_count: i64,
    pub(super) latest_saved_at: Option<i64>,
    pub(super) daily_counts: [i64; 7],
    pub(super) hourly_counts: [i64; 24],
    pub(super) source_counts: Vec<SavedAnalyticsCount>,
    pub(super) content_mix: Vec<SavedAnalyticsCount>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FriendSourceKey {
    pub(super) platform: String,
    pub(super) author_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FriendsActivityWindow {
    pub(super) start_ms: i64,
    pub(super) end_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FriendSampleItem {
    pub(super) global_id: String,
    pub(super) published_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FriendSignalCount {
    pub(super) label: &'static str,
    pub(super) count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FriendLocationCandidate {
    pub(super) global_id: String,
    pub(super) published_at: i64,
    pub(super) effective_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FriendActivitySummary {
    pub(super) platform: String,
    pub(super) author_id: String,
    pub(super) item_count: i64,
    pub(super) latest_activity_at: i64,
    pub(super) has_location: bool,
    pub(super) avatar_url: Option<String>,
    pub(super) avatar_published_at: Option<i64>,
    pub(super) avatar_global_id: Option<String>,
    pub(super) location_candidate_count: i64,
    pub(super) location_candidates: Vec<FriendLocationCandidate>,
    pub(super) sample_items: Vec<FriendSampleItem>,
    pub(super) recent_count: i64,
    pub(super) signal_counts: Vec<FriendSignalCount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RssActivitySummary {
    pub(super) feed_url: String,
    pub(super) item_count: i64,
    pub(super) latest_activity_at: i64,
    pub(super) has_location: bool,
    pub(super) avatar_url: Option<String>,
    pub(super) avatar_published_at: Option<i64>,
    pub(super) avatar_global_id: Option<String>,
    pub(super) location_candidate_count: i64,
    pub(super) location_candidates: Vec<FriendLocationCandidate>,
    pub(super) sample_items: Vec<FriendSampleItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FriendsGraphActivity {
    pub(super) total_item_count: i64,
    pub(super) social: Vec<FriendActivitySummary>,
    pub(super) rss: Vec<RssActivitySummary>,
}

impl LibrarySurface {
    pub(super) const fn maximum(self) -> u32 {
        match self {
            Self::Map => MAX_MAP_SURFACE_ITEMS,
            Self::StoryWall => MAX_STORY_WALL_SURFACE_ITEMS,
        }
    }
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

fn saved_analytics_safe_integer(value: i64) -> bool {
    (-MAX_JAVASCRIPT_SAFE_INTEGER..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&value)
}

fn increment_saved_analytics_count(
    counts: &mut BTreeMap<String, i64>,
    label: String,
    maximum_entries: usize,
    field: &'static str,
) -> StoreResult<()> {
    if label.len() > MAX_SAVED_ANALYTICS_LABEL_BYTES {
        return Err(ShadowStoreError::SavedAnalyticsExceedsResponseBudget {
            field,
            requested: label.len(),
            maximum: MAX_SAVED_ANALYTICS_LABEL_BYTES,
        });
    }
    if !counts.contains_key(&label) && counts.len() == maximum_entries {
        return Err(ShadowStoreError::SavedAnalyticsExceedsResponseBudget {
            field,
            requested: maximum_entries + 1,
            maximum: maximum_entries,
        });
    }
    let count = counts.entry(label).or_default();
    *count = count
        .checked_add(1)
        .ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection { field })?;
    Ok(())
}

fn saved_source_label(source: &str) -> StoreResult<String> {
    if source.is_empty() {
        return Ok("Unknown".to_string());
    }
    if source.len() > MAX_SAVED_ANALYTICS_LABEL_BYTES {
        return Err(ShadowStoreError::SavedAnalyticsExceedsResponseBudget {
            field: "source label bytes",
            requested: source.len(),
            maximum: MAX_SAVED_ANALYTICS_LABEL_BYTES,
        });
    }
    let label = match Url::parse(source) {
        Ok(url) => url
            .host_str()
            .unwrap_or_default()
            .strip_prefix("www.")
            .unwrap_or_else(|| url.host_str().unwrap_or_default())
            .to_string(),
        Err(_) => source.to_string(),
    };
    Ok(label)
}

fn exact_saved_analytics_row(
    content_type: Option<&str>,
    captured_at: Option<i64>,
    author_handle: Option<&str>,
    source_url: Option<&str>,
    content_blob: Option<&str>,
    rest_text: &str,
) -> StoreResult<(i64, String, String)> {
    let rest = serde_json::from_str::<serde_json::Value>(rest_text)
        .map_err(|_| ShadowStoreError::InvalidSavedAnalyticsProjection { field: "rest" })?;
    let rest = rest
        .as_object()
        .ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection { field: "rest" })?;
    let absent = match rest.get("__absent") {
        None => None,
        Some(serde_json::Value::Array(values))
            if values
                .iter()
                .all(|value| matches!(value, serde_json::Value::String(_))) =>
        {
            Some(values)
        }
        Some(_) => {
            return Err(ShadowStoreError::InvalidSavedAnalyticsProjection {
                field: "absent paths",
            })
        }
    };
    let is_absent = |path: &str| {
        absent.is_some_and(|values| {
            values
                .iter()
                .any(|value| value.as_str().is_some_and(|value| value == path))
        })
    };
    if is_absent("userState") {
        return Err(ShadowStoreError::InvalidSavedAnalyticsProjection { field: "userState" });
    }
    if let Some(raw) = rest.get("__raw") {
        let raw = raw
            .as_object()
            .ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection {
                field: "raw escapes",
            })?;
        for field in [
            "author",
            "author.handle",
            "capturedAt",
            "contentType",
            "sourceUrl",
            "userState",
            "userState.hidden",
        ] {
            if raw.contains_key(field) {
                return Err(ShadowStoreError::InvalidSavedAnalyticsProjection { field });
            }
        }
    }

    let saved_at = match rest.get("__userState") {
        None => None,
        Some(serde_json::Value::Object(user_state)) => match user_state.get("savedAt") {
            None | Some(serde_json::Value::Null) => None,
            Some(serde_json::Value::Number(value)) => {
                let value = value
                    .as_i64()
                    .filter(|value| saved_analytics_safe_integer(*value));
                Some(
                    value.ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection {
                        field: "userState.savedAt",
                    })?,
                )
            }
            Some(_) => {
                return Err(ShadowStoreError::InvalidSavedAnalyticsProjection {
                    field: "userState.savedAt",
                })
            }
        },
        Some(_) => {
            return Err(ShadowStoreError::InvalidSavedAnalyticsProjection { field: "userState" })
        }
    };
    let captured_at = captured_at
        .filter(|value| saved_analytics_safe_integer(*value))
        .ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection {
            field: "capturedAt",
        })?;
    let timestamp = saved_at.unwrap_or(captured_at);

    let content_type = content_type
        .ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection {
            field: "contentType",
        })?
        .to_string();
    let content = serde_json::from_str::<serde_json::Value>(
        content_blob
            .ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection { field: "content" })?,
    )
    .map_err(|_| ShadowStoreError::InvalidSavedAnalyticsProjection { field: "content" })?;
    let content = content
        .as_object()
        .ok_or(ShadowStoreError::InvalidSavedAnalyticsProjection { field: "content" })?;
    let link_preview_url = match content.get("linkPreview") {
        Some(serde_json::Value::Object(link_preview)) => match link_preview.get("url") {
            None | Some(serde_json::Value::Null) => None,
            Some(serde_json::Value::String(value)) => Some(value.as_str()),
            Some(_) => {
                return Err(ShadowStoreError::InvalidSavedAnalyticsProjection {
                    field: "content.linkPreview.url",
                })
            }
        },
        None | Some(serde_json::Value::Null) => None,
        // JavaScript property access on a non-null primitive or array yields no
        // `url`, matching the existing optional-chain fallback.
        Some(_) => None,
    };
    if link_preview_url.is_none() && source_url.is_none() && is_absent("author") {
        return Err(ShadowStoreError::InvalidSavedAnalyticsProjection { field: "author" });
    }
    let source = link_preview_url.or(source_url).or(author_handle);
    let source_label = match source {
        Some(source) => saved_source_label(source)?,
        None => "Unknown".to_string(),
    };
    Ok((timestamp, source_label, content_type))
}

const FRIEND_SIGNAL_LABELS: [&str; 20] = [
    "event",
    "deadline",
    "opportunity",
    "how_to",
    "reference",
    "transaction",
    "product_update",
    "alert",
    "deal",
    "place",
    "media",
    "essay",
    "moment",
    "life_update",
    "announcement",
    "recommendation",
    "request",
    "discussion",
    "promotion",
    "news",
];

#[derive(Debug)]
struct ExactFriendActivityRow {
    global_id: String,
    platform: String,
    author_id: String,
    published_at: i64,
    avatar_url: Option<String>,
    rss_feed_url: Option<String>,
    has_location: bool,
    location_time_range: Option<FriendLocationTimeRange>,
    signal_indexes: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FriendLocationTimeRange {
    starts_at: i64,
    ends_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmptyFriendActivitySummary<'a> {
    platform: &'a str,
    author_id: &'a str,
    item_count: i64,
    latest_activity_at: i64,
    has_location: bool,
    avatar_url: Option<&'a str>,
    avatar_published_at: Option<i64>,
    avatar_global_id: Option<&'a str>,
    location_candidate_count: i64,
    location_candidates: &'a [FriendLocationCandidate],
    sample_items: &'a [FriendSampleItem],
    recent_count: i64,
    signal_counts: &'a [FriendSignalCount],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmptyRssActivitySummary<'a> {
    feed_url: &'a str,
    item_count: i64,
    latest_activity_at: i64,
    has_location: bool,
    avatar_url: Option<&'a str>,
    avatar_published_at: Option<i64>,
    avatar_global_id: Option<&'a str>,
    location_candidate_count: i64,
    location_candidates: &'a [FriendLocationCandidate],
    sample_items: &'a [FriendSampleItem],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BorrowedFriendSample<'a> {
    global_id: &'a str,
    published_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BorrowedFriendSignal<'a> {
    label: &'a str,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BorrowedFriendLocationCandidate<'a> {
    global_id: &'a str,
    published_at: i64,
    effective_at: i64,
}

#[derive(Debug)]
struct FriendsGraphRetainedBudget {
    retained_bytes: usize,
}

impl FriendsGraphRetainedBudget {
    fn new() -> StoreResult<Self> {
        let empty = FriendsGraphActivity {
            total_item_count: 0,
            social: Vec::new(),
            rss: Vec::new(),
        };
        let retained_bytes = serde_json::to_vec(&empty)
            .map_err(|_| ShadowStoreError::InvalidFriendsQuery {
                field: "retained output serialization",
            })?
            .len()
            // Reserve the maximum growth from zero to a safe-integer total.
            .saturating_add(15);
        Ok(Self { retained_bytes })
    }

    fn charge(&mut self, additional: usize) -> StoreResult<()> {
        let requested = self.retained_bytes.saturating_add(additional);
        if requested > MAX_FRIENDS_GRAPH_RETAINED_BYTES {
            return Err(ShadowStoreError::FriendsGraphExceedsResponseBudget {
                requested,
                maximum: MAX_FRIENDS_GRAPH_RETAINED_BYTES,
            });
        }
        self.retained_bytes = requested;
        Ok(())
    }

    fn replace(&mut self, previous: usize, replacement: usize) -> StoreResult<()> {
        let retained_without_previous = self.retained_bytes.checked_sub(previous).ok_or(
            ShadowStoreError::InvalidFriendsQuery {
                field: "retained output accounting",
            },
        )?;
        let requested = retained_without_previous.saturating_add(replacement);
        if requested > MAX_FRIENDS_GRAPH_RETAINED_BYTES {
            return Err(ShadowStoreError::FriendsGraphExceedsResponseBudget {
                requested,
                maximum: MAX_FRIENDS_GRAPH_RETAINED_BYTES,
            });
        }
        self.retained_bytes = requested;
        Ok(())
    }

    fn replace_delta(&mut self, previous: isize, replacement: isize) -> StoreResult<()> {
        let requested = self.retained_bytes as i128 - previous as i128 + replacement as i128;
        if requested < 0 {
            return Err(ShadowStoreError::InvalidFriendsQuery {
                field: "retained output accounting",
            });
        }
        let requested = usize::try_from(requested).unwrap_or(usize::MAX);
        if requested > MAX_FRIENDS_GRAPH_RETAINED_BYTES {
            return Err(ShadowStoreError::FriendsGraphExceedsResponseBudget {
                requested,
                maximum: MAX_FRIENDS_GRAPH_RETAINED_BYTES,
            });
        }
        self.retained_bytes = requested;
        Ok(())
    }
}

fn serialized_friends_value_bytes<T: Serialize>(value: &T) -> StoreResult<usize> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|_| ShadowStoreError::InvalidFriendsQuery {
            field: "retained output serialization",
        })
}

fn empty_social_retained_bytes(source: &FriendSourceKey) -> StoreResult<usize> {
    serialized_friends_value_bytes(&EmptyFriendActivitySummary {
        platform: &source.platform,
        author_id: &source.author_id,
        item_count: 0,
        latest_activity_at: 0,
        has_location: false,
        avatar_url: None,
        avatar_published_at: None,
        avatar_global_id: None,
        location_candidate_count: 0,
        location_candidates: &[],
        sample_items: &[],
        recent_count: 0,
        signal_counts: &[],
    })
    // Maximum decimal growth for itemCount, latestActivityAt,
    // locationCandidateCount, and recentCount.
    .map(|bytes| bytes.saturating_add(4 * MAX_SAFE_INTEGER_DECIMAL_GROWTH))
}

fn empty_rss_retained_bytes(feed_url: &str) -> StoreResult<usize> {
    serialized_friends_value_bytes(&EmptyRssActivitySummary {
        feed_url,
        item_count: 0,
        latest_activity_at: 0,
        has_location: false,
        avatar_url: None,
        avatar_published_at: None,
        avatar_global_id: None,
        location_candidate_count: 0,
        location_candidates: &[],
        sample_items: &[],
    })
    // Maximum decimal growth for itemCount, latestActivityAt, and
    // locationCandidateCount.
    .map(|bytes| bytes.saturating_add(3 * MAX_SAFE_INTEGER_DECIMAL_GROWTH))
}

fn avatar_retained_bytes(row: &ExactFriendActivityRow) -> StoreResult<usize> {
    let Some(avatar_url) = row.avatar_url.as_deref() else {
        return Ok(0);
    };
    let avatar_url = serialized_friends_value_bytes(&avatar_url)?;
    let global_id = serialized_friends_value_bytes(&row.global_id)?;
    let published_at = serialized_friends_value_bytes(&row.published_at)?;
    // The empty summary already includes three `null` values.
    Ok(avatar_url.saturating_sub(4) + global_id.saturating_sub(4) + published_at.saturating_sub(4))
}

fn location_candidate_retained_bytes(
    global_id: &str,
    published_at: i64,
    effective_at: i64,
    has_previous: bool,
) -> StoreResult<usize> {
    serialized_friends_value_bytes(&BorrowedFriendLocationCandidate {
        global_id,
        published_at,
        effective_at,
    })
    .map(|bytes| bytes.saturating_add(usize::from(has_previous)))
}

fn sample_retained_bytes(row: &ExactFriendActivityRow, has_previous: bool) -> StoreResult<usize> {
    sample_value_retained_bytes(&row.global_id, row.published_at)
        .map(|bytes| bytes.saturating_add(usize::from(has_previous)))
}

fn sample_value_retained_bytes(global_id: &str, published_at: i64) -> StoreResult<usize> {
    serialized_friends_value_bytes(&BorrowedFriendSample {
        global_id,
        published_at,
    })
}

fn signal_retained_bytes(label: &str, has_previous: bool) -> StoreResult<usize> {
    serialized_friends_value_bytes(&BorrowedFriendSignal {
        label,
        count: MAX_JAVASCRIPT_SAFE_INTEGER,
    })
    .map(|bytes| bytes.saturating_add(usize::from(has_previous)))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FriendsActivityAccumulator {
    item_count: i64,
    latest_activity_at: i64,
    has_location: bool,
    avatar_url: Option<String>,
    avatar_published_at: Option<i64>,
    avatar_global_id: Option<String>,
    avatar_retained_bytes: usize,
    location_candidate_count: i64,
    location_candidates: Vec<FriendLocationCandidate>,
    sample_items: Vec<FriendSampleItem>,
    recent_count: i64,
    signal_counts: [i64; FRIEND_SIGNAL_LABELS.len()],
}

impl FriendsActivityAccumulator {
    fn empty() -> Self {
        Self {
            item_count: 0,
            latest_activity_at: 0,
            has_location: false,
            avatar_url: None,
            avatar_published_at: None,
            avatar_global_id: None,
            avatar_retained_bytes: 0,
            location_candidate_count: 0,
            location_candidates: Vec::new(),
            sample_items: Vec::new(),
            recent_count: 0,
            signal_counts: [0; FRIEND_SIGNAL_LABELS.len()],
        }
    }

    fn add(
        &mut self,
        row: &ExactFriendActivityRow,
        recent_window: FriendsActivityWindow,
        include_social_fields: bool,
        retained_budget: &mut FriendsGraphRetainedBudget,
    ) -> StoreResult<()> {
        self.item_count =
            self.item_count
                .checked_add(1)
                .ok_or(ShadowStoreError::InvalidFriendsQuery {
                    field: "item count",
                })?;
        self.latest_activity_at = self.latest_activity_at.max(row.published_at);
        if let Some(avatar_url) = row.avatar_url.as_ref() {
            let replaces_current =
                match (self.avatar_published_at, self.avatar_global_id.as_deref()) {
                    (Some(published_at), Some(global_id)) => {
                        row.published_at > published_at
                            || (row.published_at == published_at
                                && row.global_id.as_bytes() < global_id.as_bytes())
                    }
                    _ => true,
                };
            if replaces_current {
                let replacement_bytes = avatar_retained_bytes(row)?;
                retained_budget.replace(self.avatar_retained_bytes, replacement_bytes)?;
                self.avatar_url = Some(avatar_url.clone());
                self.avatar_published_at = Some(row.published_at);
                self.avatar_global_id = Some(row.global_id.clone());
                self.avatar_retained_bytes = replacement_bytes;
            }
        }
        let first_location = row.has_location && !self.has_location;
        let has_location_delta = if first_location { -1 } else { 0 };
        if let Some(effective_at) = current_location_effective_at(row, recent_window.end_ms) {
            let next_candidate_count = self.location_candidate_count.checked_add(1).ok_or(
                ShadowStoreError::InvalidFriendsQuery {
                    field: "location candidate count",
                },
            )?;
            let candidate_position = self.location_candidates.partition_point(|candidate| {
                candidate.published_at > row.published_at
                    || (candidate.published_at == row.published_at
                        && candidate.global_id.as_bytes() < row.global_id.as_bytes())
            });
            if self.location_candidates.len() < MAX_FRIEND_LOCATION_CANDIDATES {
                let candidate_bytes = location_candidate_retained_bytes(
                    &row.global_id,
                    row.published_at,
                    effective_at,
                    !self.location_candidates.is_empty(),
                )?;
                retained_budget.replace_delta(0, has_location_delta + candidate_bytes as isize)?;
                self.has_location |= row.has_location;
                self.location_candidate_count = next_candidate_count;
                self.location_candidates.insert(
                    candidate_position,
                    FriendLocationCandidate {
                        global_id: row.global_id.clone(),
                        published_at: row.published_at,
                        effective_at,
                    },
                );
            } else if candidate_position < MAX_FRIEND_LOCATION_CANDIDATES {
                let removed = self.location_candidates.last().ok_or(
                    ShadowStoreError::InvalidFriendsQuery {
                        field: "location candidate retention",
                    },
                )?;
                let removed_bytes = location_candidate_retained_bytes(
                    &removed.global_id,
                    removed.published_at,
                    removed.effective_at,
                    false,
                )?;
                let replacement_bytes = location_candidate_retained_bytes(
                    &row.global_id,
                    row.published_at,
                    effective_at,
                    false,
                )?;
                retained_budget.replace_delta(
                    removed_bytes as isize,
                    has_location_delta + replacement_bytes as isize,
                )?;
                self.has_location |= row.has_location;
                self.location_candidate_count = next_candidate_count;
                self.location_candidates.insert(
                    candidate_position,
                    FriendLocationCandidate {
                        global_id: row.global_id.clone(),
                        published_at: row.published_at,
                        effective_at,
                    },
                );
                self.location_candidates.pop();
            } else {
                if first_location {
                    retained_budget.replace_delta(0, has_location_delta)?;
                }
                self.has_location |= row.has_location;
                self.location_candidate_count = next_candidate_count;
            }
        } else if first_location {
            // `true` is one JSON byte shorter than `false`. Keep retained
            // accounting exact even when every candidate is outside the
            // active time window.
            retained_budget.replace_delta(0, has_location_delta)?;
            self.has_location = true;
        }
        let sample_position = self.sample_items.partition_point(|sample| {
            sample.published_at > row.published_at
                || (sample.published_at == row.published_at
                    && sample.global_id.as_bytes() < row.global_id.as_bytes())
        });
        if self.sample_items.len() < MAX_FRIEND_SAMPLE_ITEMS {
            retained_budget.charge(sample_retained_bytes(row, !self.sample_items.is_empty())?)?;
            self.sample_items.insert(
                sample_position,
                FriendSampleItem {
                    global_id: row.global_id.clone(),
                    published_at: row.published_at,
                },
            );
        } else if sample_position < MAX_FRIEND_SAMPLE_ITEMS {
            let removed =
                self.sample_items
                    .last()
                    .ok_or(ShadowStoreError::InvalidFriendsQuery {
                        field: "sample retention",
                    })?;
            let removed_bytes =
                sample_value_retained_bytes(&removed.global_id, removed.published_at)?;
            let replacement_bytes = sample_value_retained_bytes(&row.global_id, row.published_at)?;
            retained_budget.replace(removed_bytes, replacement_bytes)?;
            self.sample_items.insert(
                sample_position,
                FriendSampleItem {
                    global_id: row.global_id.clone(),
                    published_at: row.published_at,
                },
            );
            self.sample_items.pop();
        }
        if include_social_fields
            && row.published_at >= recent_window.start_ms
            && row.published_at <= recent_window.end_ms
        {
            self.recent_count =
                self.recent_count
                    .checked_add(1)
                    .ok_or(ShadowStoreError::InvalidFriendsQuery {
                        field: "recent count",
                    })?;
        }
        for index in row.signal_indexes.iter().filter(|_| include_social_fields) {
            if self.signal_counts[*index] == 0 {
                let prior_signals = self
                    .signal_counts
                    .iter()
                    .filter(|count| **count > 0)
                    .count();
                retained_budget.charge(signal_retained_bytes(
                    FRIEND_SIGNAL_LABELS[*index],
                    prior_signals > 0,
                )?)?;
            }
            self.signal_counts[*index] = self.signal_counts[*index].checked_add(1).ok_or(
                ShadowStoreError::InvalidFriendsQuery {
                    field: "signal count",
                },
            )?;
        }
        Ok(())
    }

    fn social(self, key: FriendSourceKey) -> FriendActivitySummary {
        let signal_counts = FRIEND_SIGNAL_LABELS
            .iter()
            .copied()
            .zip(self.signal_counts)
            .filter_map(|(label, count)| (count > 0).then_some(FriendSignalCount { label, count }))
            .collect();
        FriendActivitySummary {
            platform: key.platform,
            author_id: key.author_id,
            item_count: self.item_count,
            latest_activity_at: self.latest_activity_at,
            has_location: self.has_location,
            avatar_url: self.avatar_url,
            avatar_published_at: self.avatar_published_at,
            avatar_global_id: self.avatar_global_id,
            location_candidate_count: self.location_candidate_count,
            location_candidates: self.location_candidates,
            sample_items: self.sample_items,
            recent_count: self.recent_count,
            signal_counts,
        }
    }

    fn rss(self, feed_url: String) -> RssActivitySummary {
        RssActivitySummary {
            feed_url,
            item_count: self.item_count,
            latest_activity_at: self.latest_activity_at,
            has_location: self.has_location,
            avatar_url: self.avatar_url,
            avatar_published_at: self.avatar_published_at,
            avatar_global_id: self.avatar_global_id,
            location_candidate_count: self.location_candidate_count,
            location_candidates: self.location_candidates,
            sample_items: self.sample_items,
        }
    }
}

fn json_optional_string<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
    field: &'static str,
) -> StoreResult<Option<&'a str>> {
    match object.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(ShadowStoreError::InvalidFriendsQuery { field }),
    }
}

fn decode_location_slug(value: &str) -> Option<String> {
    fn hex(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let input = value.as_bytes();
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] != b'%' {
            output.push(input[index]);
            index += 1;
            continue;
        }
        let high = hex(*input.get(index + 1)?)?;
        let low = hex(*input.get(index + 2)?)?;
        output.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(output).ok()
}

/// Exact ECMAScript `\s` / `String.prototype.trim` whitespace set.
///
/// Rust's Unicode whitespace predicate is deliberately different: it admits
/// U+0085, which JavaScript rejects, and omits U+FEFF, which JavaScript trims.
/// This reader mirrors the shared TypeScript location contract, so using the
/// host-language predicate would change persisted Friends graph results.
fn is_ecmascript_whitespace(value: char) -> bool {
    matches!(
        value,
        '\u{0009}'
            ..='\u{000D}'
                | '\u{0020}'
                | '\u{00A0}'
                | '\u{1680}'
                | '\u{2000}'..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn trim_ecmascript_whitespace(value: &str) -> &str {
    value.trim_matches(is_ecmascript_whitespace)
}

fn normalize_location_slug(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut pending_space = false;
    for value in value.chars() {
        if value == '_' || value == '-' || is_ecmascript_whitespace(value) {
            pending_space = !normalized.is_empty();
        } else {
            if pending_space {
                normalized.push(' ');
                pending_space = false;
            }
            normalized.push(value);
        }
    }
    normalized
}

/// Mirrors the successful-match shape of `MARKER\s*([^\n,]{2,60})`.
///
/// The JavaScript regex greedily consumes whitespace, then backtracks just
/// enough to satisfy the two-character capture. That oddity is observable: two
/// spaces before a comma produce a successful match whose trimmed value is
/// empty, while one space does not match and lets the regex seek a later marker.
fn marker_location_match(tail: &str) -> Option<bool> {
    let mut whitespace_end = 0usize;
    for (index, value) in tail.char_indices() {
        if !is_ecmascript_whitespace(value) {
            break;
        }
        whitespace_end = index + value.len_utf8();
    }

    let remainder = &tail[whitespace_end..];
    let remainder_count = remainder
        .chars()
        .take_while(|value| !matches!(value, '\n' | ','))
        .take(2)
        .count();
    if remainder_count >= 2 {
        // The whitespace prefix was consumed completely, so the capture starts
        // with a non-whitespace character and remains non-empty after trim.
        return Some(true);
    }

    let whitespace = &tail[..whitespace_end];
    let trailing_run = whitespace
        .rsplit_once('\n')
        .map_or(whitespace, |(_, trailing)| trailing);
    if trailing_run.chars().count().saturating_add(remainder_count) >= 2 {
        return Some(remainder_count > 0);
    }

    // Backtracking cannot capture across U+000A. An earlier whitespace run of
    // two characters can still satisfy the regex, but trim makes it empty and
    // the shared extractor stops without considering a later marker.
    if whitespace
        .split('\n')
        .rev()
        .skip(1)
        .any(|run| run.chars().count() >= 2)
    {
        return Some(false);
    }
    None
}

fn recovered_location_name(url: Option<&str>) -> bool {
    let Some(url) = url else { return false };
    let parsed = Url::parse(url)
        .or_else(|_| Url::parse("https://www.instagram.com").and_then(|base| base.join(url)));
    let Ok(parsed) = parsed else { return false };
    let segments = parsed
        .path_segments()
        .map(|segments| {
            segments
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let location_index = segments.iter().position(|segment| *segment == "locations");
    let slug = match location_index {
        Some(index) => segments.get(index + 2).copied(),
        None => segments.last().copied(),
    };
    let Some(slug) = slug else { return false };
    let Some(decoded) = decode_location_slug(slug) else {
        return false;
    };
    let decoded = normalize_location_slug(&decoded);
    !decoded.is_empty()
        && !decoded.chars().all(|value| value.is_ascii_digit())
        && !matches!(
            decoded.to_ascii_lowercase().as_str(),
            "locations" | "check registration"
        )
}

fn text_has_location(text: &str) -> bool {
    for marker in ['📍', '🌍', '🌎', '🌏'] {
        for (offset, _) in text.char_indices().filter(|(_, value)| *value == marker) {
            if let Some(has_location) = marker_location_match(&text[offset + marker.len_utf8()..]) {
                return has_location;
            }
        }
    }

    for (index, _) in text.char_indices() {
        if index > 0
            && !text[..index]
                .chars()
                .next_back()
                .is_some_and(is_ecmascript_whitespace)
        {
            continue;
        }
        let tail = &text[index..];
        let word_length = if tail.starts_with("in") || tail.starts_with("at") {
            2
        } else if tail.starts_with("from") {
            4
        } else {
            continue;
        };
        let after_word = &tail[word_length..];
        if !after_word
            .chars()
            .next()
            .is_some_and(is_ecmascript_whitespace)
        {
            continue;
        }
        let candidate = after_word.trim_start_matches(is_ecmascript_whitespace);
        let mut chars = candidate.chars();
        if !chars.next().is_some_and(|value| value.is_ascii_uppercase()) {
            continue;
        }
        if chars.next().is_some_and(|value| value.is_ascii_lowercase()) {
            return true;
        }
    }
    false
}

fn exact_location_presence(
    rest: &serde_json::Map<String, serde_json::Value>,
    content: &serde_json::Map<String, serde_json::Value>,
) -> StoreResult<bool> {
    if let Some(value) = rest.get("location") {
        match value {
            serde_json::Value::Null => {}
            serde_json::Value::Object(location) => {
                if let Some(coordinates) = location.get("coordinates") {
                    match coordinates {
                        serde_json::Value::Null => {}
                        serde_json::Value::Object(coordinates)
                            if coordinates
                                .get("lat")
                                .and_then(serde_json::Value::as_f64)
                                .is_some()
                                && coordinates
                                    .get("lng")
                                    .and_then(serde_json::Value::as_f64)
                                    .is_some() =>
                        {
                            return Ok(true)
                        }
                        _ => {
                            return Err(ShadowStoreError::InvalidFriendsQuery {
                                field: "location.coordinates",
                            })
                        }
                    }
                }
                let name = json_optional_string(location, "name", "location.name")?;
                let url = json_optional_string(location, "url", "location.url")?;
                let normalized =
                    trim_ecmascript_whitespace(name.unwrap_or_default()).to_ascii_lowercase();
                if !normalized.is_empty()
                    && !matches!(normalized.as_str(), "locations" | "check registration")
                {
                    return Ok(true);
                }
                if recovered_location_name(url) {
                    return Ok(true);
                }
            }
            _ => return Err(ShadowStoreError::InvalidFriendsQuery { field: "location" }),
        }
    }
    match content.get("text") {
        None | Some(serde_json::Value::Null) => Ok(false),
        Some(serde_json::Value::String(text)) => Ok(text_has_location(text)),
        Some(_) => Err(ShadowStoreError::InvalidFriendsQuery {
            field: "content.text",
        }),
    }
}

fn exact_location_time_range(
    rest: &serde_json::Map<String, serde_json::Value>,
) -> StoreResult<Option<FriendLocationTimeRange>> {
    if rest
        .get("__raw")
        .and_then(serde_json::Value::as_object)
        .is_some_and(|raw| raw.contains_key("timeRange"))
    {
        return Err(ShadowStoreError::InvalidFriendsQuery { field: "timeRange" });
    }
    let Some(time_range) = rest.get("timeRange") else {
        return Ok(None);
    };
    if time_range.is_null() {
        return Ok(None);
    }
    let time_range = time_range
        .as_object()
        .ok_or(ShadowStoreError::InvalidFriendsQuery { field: "timeRange" })?;
    let starts_at = time_range
        .get("startsAt")
        .and_then(serde_json::Value::as_i64)
        .filter(|value| saved_analytics_safe_integer(*value))
        .ok_or(ShadowStoreError::InvalidFriendsQuery {
            field: "timeRange.startsAt",
        })?;
    let ends_at = match time_range.get("endsAt") {
        None | Some(serde_json::Value::Null) => starts_at,
        Some(value) => value
            .as_i64()
            .filter(|value| saved_analytics_safe_integer(*value))
            .ok_or(ShadowStoreError::InvalidFriendsQuery {
                field: "timeRange.endsAt",
            })?,
    };
    Ok(Some(FriendLocationTimeRange { starts_at, ends_at }))
}

/// Returns the exact current-mode ordering timestamp used by the shared
/// location resolver, or `None` when the location row is not visible at the
/// requested graph instant.
///
/// The full item remains the authority for resolving coordinates and named
/// locations. This compact value only proves which lossless rows must be
/// fetched before the existing resolver runs.
fn current_location_effective_at(row: &ExactFriendActivityRow, current_at: i64) -> Option<i64> {
    if !row.has_location {
        return None;
    }
    match row.location_time_range {
        None => (row.published_at <= current_at).then_some(row.published_at),
        Some(time_range) => (time_range.starts_at <= current_at
            && time_range.ends_at >= current_at)
            .then_some(time_range.starts_at),
    }
}

fn exact_friend_activity_row(
    global_id: String,
    platform: Option<String>,
    author_id: Option<String>,
    published_at: Option<i64>,
    hidden: Option<i64>,
    content_blob: Option<String>,
    rest_text: String,
) -> StoreResult<ExactFriendActivityRow> {
    if global_id.is_empty() || global_id.len() > MAX_ENTITY_ID_UTF8_BYTES {
        return Err(ShadowStoreError::InvalidFriendsQuery { field: "globalId" });
    }
    let platform = platform
        .filter(|value| string_within_bounds(value, 64, 256))
        .ok_or(ShadowStoreError::InvalidFriendsQuery { field: "platform" })?;
    let author_id = author_id
        .filter(|value| string_within_bounds(value, 4_096, 16_384))
        .ok_or(ShadowStoreError::InvalidFriendsQuery { field: "author.id" })?;
    let published_at = published_at
        .filter(|value| (0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(value))
        .ok_or(ShadowStoreError::InvalidFriendsQuery {
            field: "publishedAt",
        })?;
    if !matches!(hidden, None | Some(0)) {
        return Err(ShadowStoreError::InvalidFriendsQuery {
            field: "userState.hidden",
        });
    }
    let rest = serde_json::from_str::<serde_json::Value>(&rest_text)
        .map_err(|_| ShadowStoreError::InvalidFriendsQuery { field: "rest" })?;
    let rest = rest
        .as_object()
        .ok_or(ShadowStoreError::InvalidFriendsQuery { field: "rest" })?;
    if let Some(raw) = rest.get("__raw") {
        let raw = raw
            .as_object()
            .ok_or(ShadowStoreError::InvalidFriendsQuery {
                field: "raw escapes",
            })?;
        for field in [
            "platform",
            "author",
            "author.id",
            "publishedAt",
            "userState",
            "userState.hidden",
            "content",
            "contentSignals",
            "location",
            "rssSource",
        ] {
            if raw.contains_key(field) {
                return Err(ShadowStoreError::InvalidFriendsQuery {
                    field: "raw escapes",
                });
            }
        }
    }
    if let Some(absent) = rest.get("__absent") {
        let absent = absent
            .as_array()
            .filter(|values| values.iter().all(serde_json::Value::is_string))
            .ok_or(ShadowStoreError::InvalidFriendsQuery {
                field: "absent paths",
            })?;
        for field in [
            "platform",
            "author",
            "author.id",
            "publishedAt",
            "userState",
            "userState.hidden",
            "content",
        ] {
            if absent.iter().any(|value| value.as_str() == Some(field)) {
                return Err(ShadowStoreError::InvalidFriendsQuery {
                    field: "absent paths",
                });
            }
        }
    }

    let content = match content_blob.as_deref() {
        None => serde_json::json!({}),
        Some(value) => serde_json::from_str::<serde_json::Value>(value)
            .map_err(|_| ShadowStoreError::InvalidFriendsQuery { field: "content" })?,
    };
    let content = content
        .as_object()
        .ok_or(ShadowStoreError::InvalidFriendsQuery { field: "content" })?;
    let avatar_url = match rest.get("__author") {
        None => None,
        Some(serde_json::Value::Object(author)) => {
            let value = json_optional_string(author, "avatarUrl", "author.avatarUrl")?;
            if !optional_string_within_bounds(value, 2_048, 8_192) {
                return Err(ShadowStoreError::InvalidFriendsQuery {
                    field: "author.avatarUrl",
                });
            }
            value.map(ToOwned::to_owned)
        }
        Some(_) => return Err(ShadowStoreError::InvalidFriendsQuery { field: "author" }),
    };
    let rss_feed_url = match rest.get("rssSource") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Object(rss)) => {
            let value = json_optional_string(rss, "feedUrl", "rssSource.feedUrl")?.ok_or(
                ShadowStoreError::InvalidFriendsQuery {
                    field: "rssSource.feedUrl",
                },
            )?;
            if !string_within_bounds(value, 2_048, 8_192) {
                return Err(ShadowStoreError::InvalidFriendsQuery {
                    field: "rssSource.feedUrl",
                });
            }
            Some(value.to_owned())
        }
        Some(_) => return Err(ShadowStoreError::InvalidFriendsQuery { field: "rssSource" }),
    };
    let mut signal_indexes = Vec::new();
    let mut seen_signal_indexes = BTreeSet::new();
    match rest.get("contentSignals") {
        None | Some(serde_json::Value::Null) => {}
        Some(serde_json::Value::Object(signals)) => match signals.get("tags") {
            None | Some(serde_json::Value::Null) => {}
            Some(serde_json::Value::Array(tags)) if tags.len() <= MAX_FEED_CARD_SIGNAL_TAGS => {
                for tag in tags {
                    let tag = tag.as_str().ok_or(ShadowStoreError::InvalidFriendsQuery {
                        field: "contentSignals.tags",
                    })?;
                    let index = FRIEND_SIGNAL_LABELS
                        .iter()
                        .position(|known| *known == tag)
                        .ok_or(ShadowStoreError::InvalidFriendsQuery {
                            field: "contentSignals.tags",
                        })?;
                    if !seen_signal_indexes.insert(index) {
                        return Err(ShadowStoreError::InvalidFriendsQuery {
                            field: "contentSignals.tags",
                        });
                    }
                    signal_indexes.push(index);
                }
            }
            Some(_) => {
                return Err(ShadowStoreError::InvalidFriendsQuery {
                    field: "contentSignals.tags",
                })
            }
        },
        Some(_) => {
            return Err(ShadowStoreError::InvalidFriendsQuery {
                field: "contentSignals",
            })
        }
    }
    let has_location = exact_location_presence(rest, content)?;
    let location_time_range = has_location
        .then(|| exact_location_time_range(rest))
        .transpose()?
        .flatten();
    Ok(ExactFriendActivityRow {
        global_id,
        platform,
        author_id,
        published_at,
        avatar_url,
        rss_feed_url,
        has_location,
        location_time_range,
        signal_indexes,
    })
}

fn canonical_friend_sources(
    sources: &[FriendSourceKey],
    require_non_empty: bool,
) -> StoreResult<Vec<&FriendSourceKey>> {
    if (require_non_empty && sources.is_empty()) || sources.len() > MAX_FRIEND_SOURCE_KEYS {
        return Err(ShadowStoreError::FriendsSourceLimit {
            requested: sources.len(),
            maximum: MAX_FRIEND_SOURCE_KEYS,
        });
    }
    let mut canonical = BTreeSet::new();
    for source in sources {
        if !string_within_bounds(&source.platform, 64, 256)
            || !string_within_bounds(&source.author_id, 4_096, 16_384)
        {
            return Err(ShadowStoreError::InvalidFriendsQuery { field: "sources" });
        }
        if !canonical.insert(source) {
            return Err(ShadowStoreError::InvalidFriendsQuery {
                field: "duplicate sources",
            });
        }
    }
    Ok(canonical.into_iter().collect())
}

fn canonical_rss_feed_urls(feed_urls: &[String]) -> StoreResult<Vec<&String>> {
    let mut canonical = BTreeSet::new();
    for feed_url in feed_urls {
        if !string_within_bounds(feed_url, 2_048, 8_192) {
            return Err(ShadowStoreError::InvalidFriendsQuery {
                field: "rssFeedUrls",
            });
        }
        if !canonical.insert(feed_url) {
            return Err(ShadowStoreError::InvalidFriendsQuery {
                field: "duplicate rssFeedUrls",
            });
        }
    }
    Ok(canonical.into_iter().collect())
}

const FRIENDS_GRAPH_SOCIAL_SQL: &str = "WITH requested AS (
       SELECT json_extract(value, '$.platform') AS platform,
              json_extract(value, '$.authorId') AS authorId
       FROM json_each(?1)
     )
     SELECT f.globalId, f.platform, f.authorId, f.publishedAt,
            f.hidden, f.contentBlob, f.rest
     FROM requested AS r
     JOIN feed_items AS f
       ON f.platform = r.platform AND f.authorId = r.authorId
     WHERE f.hidden IS NOT 1;";

const FRIENDS_GRAPH_RSS_SQL: &str = "WITH requested AS (
       SELECT value AS feedUrl FROM json_each(?1)
     )
     SELECT f.globalId, f.platform, f.authorId, f.publishedAt,
            f.hidden, f.contentBlob, f.rest
     FROM requested AS r
     JOIN feed_items AS f
       ON json_extract(f.rest, '$.rssSource.feedUrl') = r.feedUrl
     WHERE f.platform = 'rss' AND f.hidden IS NOT 1;";

/// The surface predicate and page order, factored out so the query-plan test
/// can explain exactly the SQL the reader runs.
///
/// The predicate uses json_type, json_extract, and GLOB, none of which an index
/// can satisfy. The ORDER BY must still be answered by the timeline index or
/// each open sorts the whole filtered corpus.
fn surface_items_sql(surface: LibrarySurface) -> String {
    let predicate = match surface {
        LibrarySurface::Map => {
            "json_type(rest, '$.location') = 'object'
                   OR json_extract(contentBlob, '$.text') GLOB '*📍*'
                   OR json_extract(contentBlob, '$.text') GLOB '*🌍*'
                   OR json_extract(contentBlob, '$.text') GLOB '*🌎*'
                   OR json_extract(contentBlob, '$.text') GLOB '*🌏*'
                   OR json_extract(contentBlob, '$.text') GLOB 'in [A-Z]*'
                   OR json_extract(contentBlob, '$.text') GLOB 'at [A-Z]*'
                   OR json_extract(contentBlob, '$.text') GLOB 'from [A-Z]*'
                   OR json_extract(contentBlob, '$.text') GLOB '* in [A-Z]*'
                   OR json_extract(contentBlob, '$.text') GLOB '* at [A-Z]*'
                   OR json_extract(contentBlob, '$.text') GLOB '* from [A-Z]*'
            "
        }
        LibrarySurface::StoryWall => {
            "hidden IS NOT 1
                   AND archived IS NOT 1
                   AND CASE
                     WHEN json_valid(contentBlob)
                     THEN json_type(contentBlob, '$.mediaUrls') = 'array'
                      AND json_array_length(contentBlob, '$.mediaUrls') > 0
                     ELSE 0
                   END
            "
        }
    };
    format!(
        "SELECT {ITEM_SCAN_COLUMNS} FROM feed_items
         WHERE {predicate}
         ORDER BY sortAt DESC, globalId ASC LIMIT ?1;"
    )
}

fn person_timeline_page_sql(after: bool, use_friends_timeline_index: bool) -> StoreResult<String> {
    let base = if after {
        PAGE_AFTER_SQL
    } else {
        PAGE_FIRST_SQL
    };
    let index = if use_friends_timeline_index {
        " INDEXED BY feed_items_friends_timeline"
    } else {
        ""
    };
    let replacement = if after {
        format!(
            "FROM feed_items{index} \
         JOIN json_each(?4) AS requested \
         ON feed_items.platform = json_extract(requested.value, '$.platform') \
         AND feed_items.authorId = json_extract(requested.value, '$.authorId') \
         WHERE feed_items.hidden IS NOT 1"
        )
    } else {
        format!(
            "FROM feed_items{index} \
         JOIN json_each(?2) AS requested \
         ON feed_items.platform = json_extract(requested.value, '$.platform') \
         AND feed_items.authorId = json_extract(requested.value, '$.authorId') \
         WHERE feed_items.hidden IS NOT 1"
        )
    };
    let marker = "FROM feed_items INDEXED BY feed_items_timeline \
                  WHERE archived IS NOT 1 AND hidden IS NOT 1";
    if !base.contains(marker) {
        return Err(ShadowStoreError::InvalidFriendsQuery {
            field: "timeline SQL contract",
        });
    }
    Ok(base.replacen(marker, &replacement, 1))
}

fn person_timeline_has_more_sql(use_friends_timeline_index: bool) -> String {
    let index = if use_friends_timeline_index {
        " INDEXED BY feed_items_friends_timeline"
    } else {
        ""
    };
    format!(
        "SELECT EXISTS (
           SELECT 1
           FROM feed_items{index}
           JOIN json_each(?3) AS requested
             ON feed_items.platform = json_extract(requested.value, '$.platform')
            AND feed_items.authorId = json_extract(requested.value, '$.authorId')
           WHERE feed_items.hidden IS NOT 1
             AND (
               feed_items.sortAt < ?1
               OR (feed_items.sortAt = ?1 AND feed_items.globalId > ?2)
             )
           LIMIT 1
         );"
    )
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

/// One lossless, bounded slice of the selected projection ordered by stable
/// item identity. Consumers must process and release each page before asking
/// for the next one. This is the bridge away from retaining the full Library
/// corpus in renderer memory.
#[derive(Debug)]
pub(super) struct ItemScanPage {
    pub(super) rows: Vec<FeedItemRow>,
    pub(super) next_after_global_id: Option<String>,
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

const ITEM_SCAN_COLUMNS: &str = "globalId, platform, contentType, publishedAt, capturedAt, \
authorId, authorDisplayName, authorHandle, sourceUrl, hidden, saved, archived, readAt, \
archivedAt, likedAt, tags, contentBlob, preservedBlob, rest";

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
FROM feed_items INDEXED BY feed_items_timeline \
WHERE archived IS NOT 1 AND hidden IS NOT 1 \
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
FROM feed_items INDEXED BY feed_items_timeline \
WHERE archived IS NOT 1 AND hidden IS NOT 1 \
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
    schema_version: i64,
}

impl ShadowStore {
    pub(super) fn open(path: &Path) -> StoreResult<Self> {
        let mut store = Self {
            conn: Connection::open(path)?,
            path: Some(path.to_path_buf()),
            schema_version: SHADOW_SCHEMA_VERSION,
        };
        store.configure()?;
        store.migrate()?;
        Ok(store)
    }

    fn open_in_memory() -> StoreResult<Self> {
        let mut store = Self {
            conn: Connection::open_in_memory()?,
            path: None,
            schema_version: SHADOW_SCHEMA_VERSION,
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
        if prior < 4 {
            tx.execute_batch(SHADOW_SCHEMA_V4_SQL)?;
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

    /// Returns exact corpus-wide counts and tags without hydrating item rows.
    pub(super) fn facet_summary(&self) -> StoreResult<LibraryFacetSummary> {
        const MAXIMUM_TAGS: usize = 4_096;
        const MAXIMUM_TAG_BYTES: usize = 1_024;

        let tx = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&tx)?;
        let (
            total_count,
            saved_count,
            archived_count,
            saved_archived_count,
            saved_platform_count,
            sample_item_count,
        ) = tx.query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(saved = 1), 0),
                        COALESCE(SUM(archived = 1), 0),
                        COALESCE(SUM(saved = 1 AND archived = 1), 0),
                        COALESCE(SUM(platform = 'saved'), 0),
                        COALESCE(SUM(
                          CASE
                            WHEN json_type(rest, '$.sampleDataFingerprint.marker') = 'text'
                             AND json_extract(rest, '$.sampleDataFingerprint.marker') = 'freed.sample-data.v1'
                            THEN 1 ELSE 0
                          END
                        ), 0)
                 FROM feed_items;",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )?;
        let oversized_tag_exists = tx.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM feed_items, json_each(feed_items.tags)
               WHERE json_type(feed_items.tags) = 'array'
                 AND json_each.type = 'text'
                 AND length(CAST(value AS BLOB)) > ?1
               LIMIT 1
             );",
            [MAXIMUM_TAG_BYTES as i64],
            |row| row.get::<_, bool>(0),
        )?;
        if oversized_tag_exists {
            return Err(ShadowStoreError::FacetTagExceedsResponseBudget {
                requested_bytes: MAXIMUM_TAG_BYTES + 1,
                maximum_bytes: MAXIMUM_TAG_BYTES,
            });
        }
        let mut statement = tx.prepare(
            "SELECT DISTINCT value
             FROM feed_items, json_each(feed_items.tags)
             WHERE json_type(feed_items.tags) = 'array' AND json_each.type = 'text'
             LIMIT ?1;",
        )?;
        let mut tags = statement
            .query_map([(MAXIMUM_TAGS + 1) as i64], |row| row.get::<_, String>(0))?
            .collect::<SqlResult<Vec<_>>>()?;
        if tags.len() > MAXIMUM_TAGS {
            return Err(ShadowStoreError::FacetSummaryExceedsResponseBudget {
                requested: tags.len(),
                maximum: MAXIMUM_TAGS,
            });
        }
        // JavaScript's existing Array.sort() order compares UTF-16 code units,
        // not UTF-8 bytes. Match it here so Unicode tags keep product parity.
        tags.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
        drop(statement);
        tx.commit()?;
        Ok(LibraryFacetSummary {
            archived_count,
            sample_item_count,
            saved_archived_count,
            saved_count,
            saved_platform_count,
            tags,
            total_count,
        })
    }

    /// Aggregates the Saved overview from one readable projection without
    /// returning or retaining the complete Saved item corpus.
    pub(super) fn saved_analytics(
        &self,
        daily_windows: &[SavedAnalyticsWindow; 7],
        hourly_windows: &[SavedAnalyticsWindow; 24],
    ) -> StoreResult<LibrarySavedAnalytics> {
        let tx = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&tx)?;
        let mut total_count = 0_i64;
        let mut latest_saved_at = None;
        let mut daily_counts = [0_i64; 7];
        let mut hourly_counts = [0_i64; 24];
        let mut source_counts = BTreeMap::new();
        let mut content_mix = BTreeMap::new();

        {
            let mut statement = tx.prepare(
                "SELECT contentType, capturedAt, authorHandle, sourceUrl, contentBlob, rest
                 FROM feed_items WHERE platform = 'saved' AND hidden IS NOT 1
                 ORDER BY globalId ASC;",
            )?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let content_type = row.get::<_, Option<String>>(0)?;
                let captured_at = row.get::<_, Option<i64>>(1)?;
                let author_handle = row.get::<_, Option<String>>(2)?;
                let source_url = row.get::<_, Option<String>>(3)?;
                let content_blob = row.get::<_, Option<String>>(4)?;
                let rest = row.get::<_, String>(5)?;
                let (timestamp, source_label, content_type) = exact_saved_analytics_row(
                    content_type.as_deref(),
                    captured_at,
                    author_handle.as_deref(),
                    source_url.as_deref(),
                    content_blob.as_deref(),
                    &rest,
                )?;

                total_count = total_count.checked_add(1).ok_or(
                    ShadowStoreError::InvalidSavedAnalyticsProjection {
                        field: "total count",
                    },
                )?;
                latest_saved_at =
                    Some(latest_saved_at.map_or(timestamp, |current: i64| current.max(timestamp)));
                for (count, window) in daily_counts.iter_mut().zip(daily_windows) {
                    if timestamp >= window.start_ms && timestamp < window.end_ms {
                        *count = count.checked_add(1).ok_or(
                            ShadowStoreError::InvalidSavedAnalyticsProjection {
                                field: "daily count",
                            },
                        )?;
                    }
                }
                for (count, window) in hourly_counts.iter_mut().zip(hourly_windows) {
                    if timestamp >= window.start_ms && timestamp < window.end_ms {
                        *count = count.checked_add(1).ok_or(
                            ShadowStoreError::InvalidSavedAnalyticsProjection {
                                field: "hourly count",
                            },
                        )?;
                    }
                }
                increment_saved_analytics_count(
                    &mut source_counts,
                    source_label,
                    MAX_SAVED_ANALYTICS_SOURCE_LABELS,
                    "source labels",
                )?;
                increment_saved_analytics_count(
                    &mut content_mix,
                    content_type,
                    MAX_SAVED_ANALYTICS_CONTENT_TYPES,
                    "content types",
                )?;
            }
        }
        tx.commit()?;

        let source_counts = source_counts
            .into_iter()
            .map(|(label, count)| SavedAnalyticsCount { label, count })
            .collect();
        let content_mix = content_mix
            .into_iter()
            .map(|(label, count)| SavedAnalyticsCount { label, count })
            .collect();
        Ok(LibrarySavedAnalytics {
            total_count,
            latest_saved_at,
            daily_counts,
            hourly_counts,
            source_counts,
            content_mix,
        })
    }

    /// Builds the compact Friends activity graph from one immutable projection.
    /// Every requested key is returned exactly once, including keys with no rows.
    pub(super) fn friends_graph_activity(
        &self,
        sources: &[FriendSourceKey],
        rss_feed_urls: &[String],
        recent_window: FriendsActivityWindow,
    ) -> StoreResult<FriendsGraphActivity> {
        let requested = sources.len().checked_add(rss_feed_urls.len()).ok_or(
            ShadowStoreError::FriendsSourceLimit {
                requested: usize::MAX,
                maximum: MAX_FRIEND_SOURCE_KEYS,
            },
        )?;
        if requested > MAX_FRIEND_SOURCE_KEYS {
            return Err(ShadowStoreError::FriendsSourceLimit {
                requested,
                maximum: MAX_FRIEND_SOURCE_KEYS,
            });
        }
        if !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&recent_window.start_ms)
            || !(0..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&recent_window.end_ms)
            || recent_window.start_ms >= recent_window.end_ms
        {
            return Err(ShadowStoreError::InvalidFriendsQuery {
                field: "recentWindow",
            });
        }
        let sources = canonical_friend_sources(sources, false)?;
        let rss_feed_urls = canonical_rss_feed_urls(rss_feed_urls)?;

        let mut retained_budget = FriendsGraphRetainedBudget::new()?;
        let mut social = BTreeMap::new();
        for (index, source) in sources.iter().enumerate() {
            retained_budget.charge(
                empty_social_retained_bytes(source)?.saturating_add(usize::from(index > 0)),
            )?;
            social.insert((**source).clone(), FriendsActivityAccumulator::empty());
        }
        let mut rss = BTreeMap::new();
        for (index, feed_url) in rss_feed_urls.iter().enumerate() {
            retained_budget.charge(
                empty_rss_retained_bytes(feed_url)?.saturating_add(usize::from(index > 0)),
            )?;
            rss.insert((**feed_url).clone(), FriendsActivityAccumulator::empty());
        }
        // Serialize the SQL selectors only after the complete zero-filled
        // response shape has passed its retained-output budget. Otherwise a
        // maximum-width 5,000-source request could allocate the full selector
        // document before proving that the requested response is admissible.
        let sources_json =
            serde_json::to_string(&sources).map_err(|_| ShadowStoreError::InvalidFriendsQuery {
                field: "sources serialization",
            })?;
        let rss_feed_urls_json = serde_json::to_string(&rss_feed_urls).map_err(|_| {
            ShadowStoreError::InvalidFriendsQuery {
                field: "rssFeedUrls serialization",
            }
        })?;

        let tx = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&tx)?;
        let total_item_count = tx.query_row(
            "SELECT COUNT(*) FROM feed_items WHERE hidden IS NOT 1;",
            [],
            |row| row.get(0),
        )?;

        if !sources.is_empty() {
            let mut statement = tx.prepare(FRIENDS_GRAPH_SOCIAL_SQL)?;
            let mut rows = statement.query([&sources_json])?;
            while let Some(row) = rows.next()? {
                let exact = exact_friend_activity_row(
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                )?;
                let key = FriendSourceKey {
                    platform: exact.platform.clone(),
                    author_id: exact.author_id.clone(),
                };
                social
                    .get_mut(&key)
                    .ok_or(ShadowStoreError::InvalidFriendsQuery {
                        field: "selected social source identity",
                    })?
                    .add(&exact, recent_window, true, &mut retained_budget)?;
            }
        }

        if !rss_feed_urls.is_empty() {
            let mut statement = tx.prepare(FRIENDS_GRAPH_RSS_SQL)?;
            let mut rows = statement.query([&rss_feed_urls_json])?;
            while let Some(row) = rows.next()? {
                let exact = exact_friend_activity_row(
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                )?;
                let feed_url =
                    exact
                        .rss_feed_url
                        .as_ref()
                        .ok_or(ShadowStoreError::InvalidFriendsQuery {
                            field: "selected RSS source identity",
                        })?;
                rss.get_mut(feed_url)
                    .ok_or(ShadowStoreError::InvalidFriendsQuery {
                        field: "selected RSS source identity",
                    })?
                    .add(&exact, recent_window, false, &mut retained_budget)?;
            }
        }
        tx.commit()?;

        Ok(FriendsGraphActivity {
            total_item_count,
            social: social
                .into_iter()
                .map(|(key, activity)| activity.social(key))
                .collect(),
            rss: rss
                .into_iter()
                .map(|(feed_url, activity)| activity.rss(feed_url))
                .collect(),
        })
    }

    /// Reads one stateless, bounded Friends timeline page for exact source keys.
    /// Hidden rows are excluded. Archived rows remain because Friends activity
    /// is an identity history, not the current inbox surface.
    pub(super) fn person_timeline(
        &self,
        sources: &[FriendSourceKey],
        cursor: Option<&PageCursor>,
        limit: u32,
    ) -> StoreResult<FeedPage> {
        if !(1..=MAX_PERSON_TIMELINE_LIMIT).contains(&limit) {
            return Err(ShadowStoreError::InvalidPageLimit {
                requested: limit,
                maximum: MAX_PERSON_TIMELINE_LIMIT,
            });
        }
        let sources = canonical_friend_sources(sources, true)?;
        let sources_json =
            serde_json::to_string(&sources).map_err(|_| ShadowStoreError::InvalidFriendsQuery {
                field: "sources serialization",
            })?;
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
                let sql =
                    person_timeline_page_sql(false, self.schema_version >= SHADOW_SCHEMA_VERSION)?;
                let mut statement = tx.prepare(&sql)?;
                let rows = statement
                    .query_map(params![limit, sources_json], FeedCardRow::from_row)?
                    .collect::<SqlResult<Vec<_>>>()?;
                rows
            }
            Some(cursor) => {
                let sql =
                    person_timeline_page_sql(true, self.schema_version >= SHADOW_SCHEMA_VERSION)?;
                let mut statement = tx.prepare(&sql)?;
                let rows = statement
                    .query_map(
                        params![cursor.sort_at, cursor.global_id, limit, sources_json],
                        FeedCardRow::from_row,
                    )?
                    .collect::<SqlResult<Vec<_>>>()?;
                rows
            }
        };
        let total_count = tx.query_row(
            "SELECT COUNT(*)
             FROM feed_items
             JOIN json_each(?1) AS requested
               ON feed_items.platform = json_extract(requested.value, '$.platform')
              AND feed_items.authorId = json_extract(requested.value, '$.authorId')
             WHERE feed_items.hidden IS NOT 1;",
            [&sources_json],
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
        let last_cursor = rows.last().map(|row| PageCursor {
            revision,
            sort_at: row.sort_key(),
            global_id: row.global_id.clone(),
        });
        let has_more = if truncated_by_bytes {
            true
        } else if rows.len() as u32 != limit {
            false
        } else if let Some(last_cursor) = last_cursor.as_ref() {
            let sql = person_timeline_has_more_sql(self.schema_version >= SHADOW_SCHEMA_VERSION);
            tx.query_row(
                &sql,
                params![last_cursor.sort_at, &last_cursor.global_id, &sources_json],
                |row| row.get::<_, i64>(0),
            )? != 0
        } else {
            false
        };
        let next_cursor = has_more.then_some(last_cursor).flatten();
        tx.commit()?;
        Ok(FeedPage {
            revision,
            total_count,
            serialized_row_bytes,
            rows,
            next_cursor,
        })
    }

    /// Returns one bounded surface-specific row set. SQLite performs the
    /// corpus scan and filtering; the renderer never receives non-candidates.
    pub(super) fn surface_items(
        &self,
        surface: LibrarySurface,
        limit: u32,
    ) -> StoreResult<Vec<FeedItemRow>> {
        let maximum = surface.maximum();
        if limit == 0 || limit > maximum {
            return Err(ShadowStoreError::InvalidItemScanPageLimit {
                requested: limit,
                maximum,
            });
        }
        let query = surface_items_sql(surface);
        let tx = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&tx)?;
        let rows = {
            let mut statement = tx.prepare(&query)?;
            let rows = statement
                .query_map([limit + 1], FeedItemRow::from_row)?
                .collect::<SqlResult<Vec<_>>>()?;
            rows
        };
        if rows.len() > limit as usize {
            return Err(ShadowStoreError::SurfaceItemsExceedLimit {
                requested: rows.len(),
                maximum: limit as usize,
            });
        }
        tx.commit()?;
        Ok(rows)
    }

    /// Enumerates complete projection rows without ever materializing the
    /// whole Library. The primary-key order gives a deterministic keyset scan
    /// and the serialized-byte ceiling prevents a bounded row count from
    /// becoming an unbounded IPC response.
    pub(super) fn item_scan_page(
        &self,
        after_global_id: Option<&str>,
        limit: u32,
    ) -> StoreResult<ItemScanPage> {
        if !(1..=MAX_ITEM_SCAN_PAGE_LIMIT).contains(&limit) {
            return Err(ShadowStoreError::InvalidItemScanPageLimit {
                requested: limit,
                maximum: MAX_ITEM_SCAN_PAGE_LIMIT,
            });
        }
        if after_global_id
            .is_some_and(|value| value.is_empty() || value.len() > MAX_ENTITY_ID_UTF8_BYTES)
        {
            return Err(ShadowStoreError::InvalidProjectionEntityId);
        }

        let tx = self.conn.unchecked_transaction()?;
        Self::require_readable_projection_in(&tx)?;
        let candidate_limit = limit.saturating_add(1);
        let query = match after_global_id {
            None => format!(
                "SELECT {ITEM_SCAN_COLUMNS} FROM feed_items ORDER BY globalId ASC LIMIT ?1;"
            ),
            Some(_) => format!(
                "SELECT {ITEM_SCAN_COLUMNS} FROM feed_items \
                 WHERE globalId > ?1 ORDER BY globalId ASC LIMIT ?2;"
            ),
        };
        let candidates = match after_global_id {
            None => {
                let mut statement = tx.prepare(&query)?;
                let mapped = statement.query_map([candidate_limit], FeedItemRow::from_row)?;
                mapped.collect::<SqlResult<Vec<_>>>()?
            }
            Some(cursor) => {
                let mut statement = tx.prepare(&query)?;
                let mapped = statement.query_map(
                    rusqlite::params![cursor, candidate_limit],
                    FeedItemRow::from_row,
                )?;
                mapped.collect::<SqlResult<Vec<_>>>()?
            }
        };

        let mut rows = Vec::with_capacity(candidates.len().min(limit as usize));
        let mut serialized_row_bytes = 0usize;
        let mut has_more = candidates.len() > limit as usize;
        for candidate in candidates.into_iter().take(limit as usize) {
            let candidate_bytes = serde_json::to_vec(&candidate)
                .map_err(|_| ShadowStoreError::InvalidFeedCardProjection {
                    field: "serialized_item_scan_row",
                })?
                .len();
            let next_bytes = serialized_row_bytes
                .saturating_add(candidate_bytes)
                .saturating_add(usize::from(!rows.is_empty()));
            if next_bytes > MAX_ITEM_SCAN_ROW_BYTES {
                if rows.is_empty() {
                    return Err(ShadowStoreError::ItemScanRowExceedsResponseBudget {
                        requested: next_bytes,
                        maximum: MAX_ITEM_SCAN_ROW_BYTES,
                    });
                }
                has_more = true;
                break;
            }
            serialized_row_bytes = next_bytes;
            rows.push(candidate);
        }
        let next_after_global_id = has_more
            .then(|| rows.last().map(|row| row.global_id.clone()))
            .flatten();
        Ok(ItemScanPage {
            rows,
            next_after_global_id,
        })
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

    fn verify_schema_catalog(conn: &Connection, schema_version: i64) -> StoreResult<()> {
        let reference = Connection::open_in_memory()?;
        reference.execute_batch(SHADOW_SCHEMA_V1_SQL)?;
        reference.execute_batch(SHADOW_SCHEMA_V2_SQL)?;
        reference.execute_batch(SHADOW_SCHEMA_V3_SQL)?;
        if schema_version >= SHADOW_SCHEMA_VERSION {
            reference.execute_batch(SHADOW_SCHEMA_V4_SQL)?;
        }
        if Self::schema_catalog(conn)? != Self::schema_catalog(&reference)? {
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
        if !(MIN_READABLE_SHADOW_SCHEMA_VERSION..=SHADOW_SCHEMA_VERSION).contains(&version) {
            return Err(ShadowStoreError::UnsupportedSchemaVersion {
                expected: SHADOW_SCHEMA_VERSION,
                actual: version,
            });
        }
        Self::verify_quick_check(&conn)?;
        Self::verify_foreign_keys(&conn)?;
        Self::verify_schema_catalog(&conn, version)?;
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
                schema_version: version,
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

        let ShadowStore {
            conn,
            path,
            schema_version: _,
        } = self;
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

    fn explain_person_timeline(&self, after: bool) -> StoreResult<String> {
        let sql = person_timeline_page_sql(after, true)?;
        let explained = format!("EXPLAIN QUERY PLAN {sql}");
        let sources = serde_json::to_string(&[FriendSourceKey {
            platform: "x".to_string(),
            author_id: "author-1".to_string(),
        }])
        .map_err(|_| ShadowStoreError::InvalidFriendsQuery {
            field: "sources serialization",
        })?;
        let mut statement = self.conn.prepare(&explained)?;
        let details = if after {
            statement
                .query_map(params![0i64, "", 64u32, sources], |row| {
                    row.get::<_, String>(3)
                })?
                .collect::<SqlResult<Vec<_>>>()?
        } else {
            statement
                .query_map(params![64u32, sources], |row| row.get::<_, String>(3))?
                .collect::<SqlResult<Vec<_>>>()?
        };
        Ok(details.join(" | "))
    }

    fn explain_person_timeline_has_more(&self) -> StoreResult<String> {
        let sql = person_timeline_has_more_sql(true);
        let explained = format!("EXPLAIN QUERY PLAN {sql}");
        let sources = serde_json::to_string(&[FriendSourceKey {
            platform: "x".to_string(),
            author_id: "author-1".to_string(),
        }])
        .map_err(|_| ShadowStoreError::InvalidFriendsQuery {
            field: "sources serialization",
        })?;
        let mut statement = self.conn.prepare(&explained)?;
        let details = statement
            .query_map(params![0i64, "", sources], |row| row.get::<_, String>(3))?
            .collect::<SqlResult<Vec<_>>>()?;
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

    fn friend_source(platform: &str, author_id: &str) -> FriendSourceKey {
        FriendSourceKey {
            platform: platform.to_string(),
            author_id: author_id.to_string(),
        }
    }

    fn exact_friend_row(global_id: &str, published_at: i64) -> ExactFriendActivityRow {
        ExactFriendActivityRow {
            global_id: global_id.to_string(),
            platform: "x".to_string(),
            author_id: "a:1".to_string(),
            published_at,
            avatar_url: None,
            rss_feed_url: None,
            has_location: false,
            location_time_range: None,
            signal_indexes: Vec::new(),
        }
    }

    #[test]
    fn friends_graph_is_exact_bounded_and_keeps_archived_activity() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let mut rows = (0..6)
            .map(|index| {
                let published_at = match index {
                    0 => 400,
                    1 | 2 => 300,
                    _ => 300 - index as i64,
                };
                let mut item = row(index, Some(published_at));
                item.archived = Some(i64::from(index == 0));
                item.content_blob = Some(
                    serde_json::json!({
                        "text": if index == 1 { "📍 London" } else { "body" },
                        "mediaUrls": [],
                        "mediaTypes": []
                    })
                    .to_string(),
                );
                item.rest = serde_json::json!({
                    "__author": if index == 0 {
                        serde_json::json!({})
                    } else if index == 2 {
                        serde_json::json!({ "avatarUrl": "https://example.test/avatar-tie.png" })
                    } else {
                        serde_json::json!({ "avatarUrl": "https://example.test/avatar.png" })
                    },
                    "__userState": { "liked": false },
                    "contentSignals": { "tags": ["event", "news"] }
                })
                .to_string();
                item
            })
            .collect::<Vec<_>>();
        let mut hidden = row(20, Some(400));
        hidden.hidden = Some(1);
        let mut rss = row(21, Some(350));
        rss.platform = Some("rss".to_string());
        rss.author_id = Some("rss-author".to_string());
        rss.content_blob = Some(
            serde_json::json!({
                "text": "from Paris",
                "mediaUrls": [],
                "mediaTypes": []
            })
            .to_string(),
        );
        rss.rest = serde_json::json!({
            "__author": { "avatarUrl": "https://example.test/rss.png" },
            "rssSource": { "feedUrl": "https://feed.test/rss" }
        })
        .to_string();
        let mut unrelated = row(22, Some(500));
        unrelated.author_id = Some("unrelated".to_string());
        rows.extend([hidden, rss, unrelated]);
        store
            .apply_projection_batch("friends-graph", &digest(201), 0, &rows, &[])
            .expect("project graph rows");

        let graph = store
            .friends_graph_activity(
                &[friend_source("x", "zero"), friend_source("x", "a:1")],
                &[
                    "https://feed.test/zero".to_string(),
                    "https://feed.test/rss".to_string(),
                ],
                FriendsActivityWindow {
                    start_ms: 298,
                    end_ms: 301,
                },
            )
            .expect("graph");

        assert_eq!(graph.total_item_count, 8, "hidden rows are not counted");
        assert_eq!(
            graph
                .social
                .iter()
                .map(|entry| (entry.author_id.as_str(), entry.item_count))
                .collect::<Vec<_>>(),
            vec![("a:1", 6), ("zero", 0)],
            "requested social keys are canonical and zero-filled",
        );
        let active = &graph.social[0];
        assert_eq!(active.latest_activity_at, 400);
        assert_eq!(active.recent_count, 2);
        assert!(active.has_location);
        assert_eq!(
            active.avatar_url.as_deref(),
            Some("https://example.test/avatar.png")
        );
        assert_eq!(active.avatar_published_at, Some(300));
        assert_eq!(active.avatar_global_id.as_deref(), Some("x:000001"));
        assert_eq!(active.location_candidate_count, 1);
        assert_eq!(
            active.location_candidates,
            vec![FriendLocationCandidate {
                global_id: "x:000001".to_string(),
                published_at: 300,
                effective_at: 300,
            }]
        );
        assert_eq!(active.sample_items.len(), MAX_FRIEND_SAMPLE_ITEMS);
        assert_eq!(
            active
                .sample_items
                .iter()
                .map(|sample| sample.global_id.as_str())
                .collect::<Vec<_>>(),
            vec!["x:000000", "x:000001", "x:000002", "x:000003", "x:000004"]
        );
        assert_eq!(
            active
                .signal_counts
                .iter()
                .map(|signal| (signal.label, signal.count))
                .collect::<Vec<_>>(),
            vec![("event", 6), ("news", 6)],
            "known signals retain the fixed enum order",
        );
        assert_eq!(
            graph
                .rss
                .iter()
                .map(|entry| (entry.feed_url.as_str(), entry.item_count))
                .collect::<Vec<_>>(),
            vec![("https://feed.test/rss", 1), ("https://feed.test/zero", 0)],
        );
        assert_eq!(graph.rss[0].avatar_published_at, Some(350));
        assert_eq!(graph.rss[0].avatar_global_id.as_deref(), Some("x:000021"));
        assert_eq!(graph.rss[0].location_candidate_count, 0);
        assert!(graph.rss[0].location_candidates.is_empty());
        assert_eq!(graph.rss[1].avatar_url, None);
        assert_eq!(graph.rss[1].avatar_published_at, None);
        assert_eq!(graph.rss[1].avatar_global_id, None);
        assert_eq!(graph.social[1].location_candidate_count, 0);
        assert!(graph.social[1].location_candidates.is_empty());
        assert_eq!(graph.rss[1].location_candidate_count, 0);
        assert!(graph.rss[1].location_candidates.is_empty());
    }

    #[test]
    fn friends_graph_keeps_explicit_rss_friend_and_feed_aggregates() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let mut rss = row(21, Some(350));
        rss.platform = Some("rss".to_string());
        rss.author_id = Some("rss-author".to_string());
        rss.content_blob = Some(
            serde_json::json!({
                "text": "from Paris",
                "mediaUrls": [],
                "mediaTypes": []
            })
            .to_string(),
        );
        rss.rest = serde_json::json!({
            "rssSource": { "feedUrl": "https://feed.test/rss" }
        })
        .to_string();
        store
            .apply_projection_batch("friends-rss-author", &digest(208), 0, &[rss], &[])
            .expect("project RSS Friend row");

        let graph = store
            .friends_graph_activity(
                &[friend_source("rss", "rss-author")],
                &["https://feed.test/rss".to_string()],
                FriendsActivityWindow {
                    start_ms: 0,
                    end_ms: 400,
                },
            )
            .expect("graph");

        assert_eq!(graph.total_item_count, 1);
        assert_eq!(graph.social[0].item_count, 1);
        assert_eq!(graph.rss[0].item_count, 1);
        assert_eq!(graph.social[0].location_candidate_count, 1);
        assert_eq!(graph.rss[0].location_candidate_count, 1);
        assert_eq!(
            graph.social[0].location_candidates, graph.rss[0].location_candidates,
            "one RSS row may intentionally appear in both explicitly requested aggregate keys"
        );
    }

    #[test]
    fn friends_graph_top_five_and_avatar_are_independent_of_sql_arrival_order() {
        let mut activity = FriendsActivityAccumulator::empty();
        let mut retained_budget = FriendsGraphRetainedBudget::new().expect("budget");
        let mut rows = [
            exact_friend_row("x:c", 300),
            exact_friend_row("x:f", 100),
            exact_friend_row("x:a", 300),
            exact_friend_row("x:g", 500),
            exact_friend_row("x:e", 200),
            exact_friend_row("x:d", 250),
            exact_friend_row("x:b", 300),
        ];
        rows[0].avatar_url = Some("https://example.test/c.png".to_string());
        rows[2].avatar_url = Some("https://example.test/a.png".to_string());
        rows[1].has_location = true;
        rows[4].has_location = true;
        for row in &rows {
            activity
                .add(
                    row,
                    FriendsActivityWindow {
                        start_ms: 0,
                        end_ms: 1_000,
                    },
                    true,
                    &mut retained_budget,
                )
                .expect("accumulate");
        }

        assert_eq!(
            activity
                .sample_items
                .iter()
                .map(|sample| sample.global_id.as_str())
                .collect::<Vec<_>>(),
            vec!["x:g", "x:a", "x:b", "x:c", "x:d"],
        );
        assert_eq!(
            activity.avatar_url.as_deref(),
            Some("https://example.test/a.png")
        );
        assert_eq!(activity.avatar_published_at, Some(300));
        assert_eq!(activity.avatar_global_id.as_deref(), Some("x:a"));
        assert_eq!(activity.location_candidate_count, 2);
        assert_eq!(
            activity.location_candidates,
            vec![
                FriendLocationCandidate {
                    global_id: "x:e".to_string(),
                    published_at: 200,
                    effective_at: 200,
                },
                FriendLocationCandidate {
                    global_id: "x:f".to_string(),
                    published_at: 100,
                    effective_at: 100,
                },
            ]
        );
        assert!(
            !activity
                .sample_items
                .iter()
                .any(|sample| sample.global_id == "x:e"),
            "location provenance is selected independently of the top-five sample"
        );
        assert_eq!(activity.recent_count, rows.len() as i64);
    }

    #[test]
    fn friends_graph_location_candidates_preserve_current_time_and_timeline_order() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let location_row =
            |index: usize, published_at: i64, time_range: Option<serde_json::Value>| {
                let mut item = row(index, Some(published_at));
                item.content_blob = Some(
                    serde_json::json!({
                        "text": "📍 Paris",
                        "mediaUrls": [],
                        "mediaTypes": []
                    })
                    .to_string(),
                );
                item.rest = time_range
                    .map(|time_range| serde_json::json!({ "timeRange": time_range }))
                    .unwrap_or_else(|| serde_json::json!({}))
                    .to_string();
                item
            };
        let rows = [
            location_row(20, 700, None),
            location_row(10, 500, None),
            location_row(9, 500, None),
            location_row(
                30,
                100,
                Some(serde_json::json!({
                    "startsAt": 800,
                    "endsAt": 1_200,
                    "kind": "travel"
                })),
            ),
            location_row(
                40,
                1_000,
                Some(serde_json::json!({
                    "startsAt": 1_100,
                    "endsAt": 1_200,
                    "kind": "event"
                })),
            ),
            location_row(
                50,
                900,
                Some(serde_json::json!({
                    "startsAt": 100,
                    "endsAt": 999,
                    "kind": "overlap"
                })),
            ),
        ];
        store
            .apply_projection_batch("friends-location-window", &digest(207), 0, &rows, &[])
            .expect("project location rows");

        let graph = store
            .friends_graph_activity(
                &[friend_source("x", "a:1")],
                &[],
                FriendsActivityWindow {
                    start_ms: 0,
                    end_ms: 1_000,
                },
            )
            .expect("graph");

        assert_eq!(graph.social[0].location_candidate_count, 4);
        assert_eq!(
            graph.social[0].location_candidates,
            vec![
                FriendLocationCandidate {
                    global_id: "x:000020".to_string(),
                    published_at: 700,
                    effective_at: 700,
                },
                FriendLocationCandidate {
                    global_id: "x:000009".to_string(),
                    published_at: 500,
                    effective_at: 500,
                },
                FriendLocationCandidate {
                    global_id: "x:000010".to_string(),
                    published_at: 500,
                    effective_at: 500,
                },
                FriendLocationCandidate {
                    global_id: "x:000030".to_string(),
                    published_at: 100,
                    effective_at: 800,
                },
            ],
            "future and ended ranges are excluded, while the complete current set stays in timeline order"
        );
    }

    #[test]
    fn friends_graph_location_candidates_are_capped_with_an_exact_total() {
        let mut activity = FriendsActivityAccumulator::empty();
        let mut retained_budget = FriendsGraphRetainedBudget::new().expect("budget");
        for index in 0..10 {
            let mut row = exact_friend_row(&format!("x:{index}"), index);
            row.has_location = true;
            activity
                .add(
                    &row,
                    FriendsActivityWindow {
                        start_ms: 0,
                        end_ms: 20,
                    },
                    true,
                    &mut retained_budget,
                )
                .expect("accumulate location candidate");
        }

        assert_eq!(activity.location_candidate_count, 10);
        assert_eq!(activity.location_candidates.len(), 8);
        assert_eq!(
            activity
                .location_candidates
                .iter()
                .map(|candidate| candidate.global_id.as_str())
                .collect::<Vec<_>>(),
            vec!["x:9", "x:8", "x:7", "x:6", "x:5", "x:4", "x:3", "x:2"]
        );
    }

    #[test]
    fn friends_graph_keeps_location_candidates_beyond_the_first_fifty_timeline_rows() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let mut rows = (0..51)
            .map(|index| row(index, Some(1_000 - index as i64)))
            .collect::<Vec<_>>();
        let mut old_location = row(999, Some(1));
        old_location.content_blob = Some(
            serde_json::json!({
                "text": "📍 Paris",
                "mediaUrls": [],
                "mediaTypes": []
            })
            .to_string(),
        );
        rows.push(old_location);
        store
            .apply_projection_batch("friends-old-location", &digest(206), 0, &rows, &[])
            .expect("project rows");

        let sources = [friend_source("x", "a:1")];
        let graph = store
            .friends_graph_activity(
                &sources,
                &[],
                FriendsActivityWindow {
                    start_ms: 0,
                    end_ms: 2_000,
                },
            )
            .expect("graph");
        assert_eq!(
            graph.social[0].location_candidates,
            vec![FriendLocationCandidate {
                global_id: "x:000999".to_string(),
                published_at: 1,
                effective_at: 1,
            }]
        );
        assert_eq!(graph.social[0].location_candidate_count, 1);

        let first_fifty = store
            .person_timeline(&sources, None, 50)
            .expect("first timeline page");
        assert_eq!(first_fifty.rows.len(), 50);
        assert!(first_fifty.next_cursor.is_some());
        assert!(
            first_fifty
                .rows
                .iter()
                .all(|item| item.global_id != "x:000999"),
            "graph location evidence must not be derived from the first timeline page"
        );
    }

    #[test]
    fn friends_graph_budget_fails_before_cloning_an_over_budget_row() {
        let mut activity = FriendsActivityAccumulator::empty();
        let mut retained_budget = FriendsGraphRetainedBudget {
            retained_bytes: MAX_FRIENDS_GRAPH_RETAINED_BYTES - 1,
        };
        let mut row = exact_friend_row(&"\0".repeat(MAX_ENTITY_ID_UTF8_BYTES), 100);
        row.avatar_url = Some("\0".repeat(2_048));
        row.signal_indexes = (0..FRIEND_SIGNAL_LABELS.len()).collect();

        let error = activity
            .add(
                &row,
                FriendsActivityWindow {
                    start_ms: 0,
                    end_ms: 200,
                },
                true,
                &mut retained_budget,
            )
            .expect_err("the exact escaped avatar evidence must exceed the remaining byte");
        assert!(matches!(
            error,
            ShadowStoreError::FriendsGraphExceedsResponseBudget { requested, maximum }
                if requested > maximum && maximum == MAX_FRIENDS_GRAPH_RETAINED_BYTES
        ));
        assert_eq!(
            retained_budget.retained_bytes,
            MAX_FRIENDS_GRAPH_RETAINED_BYTES - 1
        );
        assert_eq!(activity.avatar_url, None, "budgeting precedes the clone");
        assert_eq!(
            activity.avatar_global_id, None,
            "budgeting precedes the clone"
        );
        assert!(activity.sample_items.is_empty());
        assert!(activity.signal_counts.iter().all(|count| *count == 0));

        let mut location_activity = FriendsActivityAccumulator::empty();
        let mut location_budget = FriendsGraphRetainedBudget {
            retained_bytes: MAX_FRIENDS_GRAPH_RETAINED_BYTES - 1,
        };
        let mut location_row = exact_friend_row(&"\0".repeat(MAX_ENTITY_ID_UTF8_BYTES), 100);
        location_row.has_location = true;
        let error = location_activity
            .add(
                &location_row,
                FriendsActivityWindow {
                    start_ms: 0,
                    end_ms: 200,
                },
                true,
                &mut location_budget,
            )
            .expect_err("the exact escaped location candidate must exceed the remaining byte");
        assert!(matches!(
            error,
            ShadowStoreError::FriendsGraphExceedsResponseBudget { requested, maximum }
                if requested > maximum && maximum == MAX_FRIENDS_GRAPH_RETAINED_BYTES
        ));
        assert_eq!(
            location_budget.retained_bytes,
            MAX_FRIENDS_GRAPH_RETAINED_BYTES - 1
        );
        assert_eq!(
            location_activity.location_candidates,
            Vec::<FriendLocationCandidate>::new(),
            "location budgeting precedes the candidate clone"
        );
        assert_eq!(location_activity.location_candidate_count, 0);
        assert!(!location_activity.has_location);
        assert!(location_activity.sample_items.is_empty());
    }

    #[test]
    fn friends_graph_numeric_reserves_equal_the_exact_max_safe_integer_json() {
        let source = friend_source("x", "a:1");
        let social_reserve = empty_social_retained_bytes(&source).expect("social reserve");
        let exact_social = serialized_friends_value_bytes(&EmptyFriendActivitySummary {
            platform: &source.platform,
            author_id: &source.author_id,
            item_count: MAX_JAVASCRIPT_SAFE_INTEGER,
            latest_activity_at: MAX_JAVASCRIPT_SAFE_INTEGER,
            has_location: false,
            avatar_url: None,
            avatar_published_at: None,
            avatar_global_id: None,
            location_candidate_count: MAX_JAVASCRIPT_SAFE_INTEGER,
            location_candidates: &[],
            sample_items: &[],
            recent_count: MAX_JAVASCRIPT_SAFE_INTEGER,
            signal_counts: &[],
        })
        .expect("exact social JSON");
        assert_eq!(4 * MAX_SAFE_INTEGER_DECIMAL_GROWTH, 60);
        assert_eq!(social_reserve, exact_social);

        let feed_url = "https://feed.test/rss";
        let rss_reserve = empty_rss_retained_bytes(feed_url).expect("RSS reserve");
        let exact_rss = serialized_friends_value_bytes(&EmptyRssActivitySummary {
            feed_url,
            item_count: MAX_JAVASCRIPT_SAFE_INTEGER,
            latest_activity_at: MAX_JAVASCRIPT_SAFE_INTEGER,
            has_location: false,
            avatar_url: None,
            avatar_published_at: None,
            avatar_global_id: None,
            location_candidate_count: MAX_JAVASCRIPT_SAFE_INTEGER,
            location_candidates: &[],
            sample_items: &[],
        })
        .expect("exact RSS JSON");
        assert_eq!(3 * MAX_SAFE_INTEGER_DECIMAL_GROWTH, 45);
        assert_eq!(rss_reserve, exact_rss);

        let mut location_row = exact_friend_row("x:a", 0);
        location_row.has_location = true;
        let candidate = FriendLocationCandidate {
            global_id: location_row.global_id.clone(),
            published_at: location_row.published_at,
            effective_at: 0,
        };
        let empty_location = serialized_friends_value_bytes(&EmptyFriendActivitySummary {
            platform: &source.platform,
            author_id: &source.author_id,
            item_count: 0,
            latest_activity_at: 0,
            has_location: false,
            avatar_url: None,
            avatar_published_at: None,
            avatar_global_id: None,
            location_candidate_count: 0,
            location_candidates: &[],
            sample_items: &[],
            recent_count: 0,
            signal_counts: &[],
        })
        .expect("empty location JSON");
        let valid_location = serialized_friends_value_bytes(&EmptyFriendActivitySummary {
            platform: &source.platform,
            author_id: &source.author_id,
            item_count: 0,
            latest_activity_at: 0,
            has_location: true,
            avatar_url: None,
            avatar_published_at: None,
            avatar_global_id: None,
            location_candidate_count: 0,
            location_candidates: std::slice::from_ref(&candidate),
            sample_items: &[],
            recent_count: 0,
            signal_counts: &[],
        })
        .expect("valid location JSON");
        assert_eq!(
            location_candidate_retained_bytes(
                &location_row.global_id,
                location_row.published_at,
                0,
                false,
            )
            .expect("location candidate bytes") as isize
                - 1,
            valid_location as isize - empty_location as isize,
            "the candidate charge plus the exact false-to-true delta matches retained JSON"
        );
    }

    #[test]
    fn friends_location_detection_matches_the_shared_javascript_contract() {
        assert!(!recovered_location_name(Some(
            "https://www.instagram.com/locations/Paris"
        )));
        assert!(recovered_location_name(Some(
            "https://www.instagram.com/locations/123/Paris"
        )));
        assert!(text_has_location("📍,\nthen 📍 Paris"));
        assert!(text_has_location("📍 ,\nthen 📍 Paris"));
        assert!(!text_has_location("📍  ,\nthen 📍 Paris"));
        assert!(text_has_location("📍 A"));
        assert!(!text_has_location("📍   , then 📍 Paris"));
        assert!(text_has_location("at\u{00A0}Paris"));
        assert!(!text_has_location("in\u{0085}Paris"));
        assert!(text_has_location("in\u{FEFF}Paris"));
        assert!(!exact_location_presence(
            &serde_json::json!({ "location": { "name": "\u{FEFF}" } })
                .as_object()
                .expect("rest object")
                .clone(),
            serde_json::json!({}).as_object().expect("content object"),
        )
        .expect("blank explicit location"));
        assert_eq!(
            exact_location_time_range(
                serde_json::json!({ "timeRange": null })
                    .as_object()
                    .expect("rest object"),
            )
            .expect("null timeRange matches the shared nullish fallback"),
            None,
        );
        assert!(matches!(
            exact_location_time_range(
                serde_json::json!({
                    "timeRange": { "startsAt": "tomorrow", "kind": "event" }
                })
                .as_object()
                .expect("rest object"),
            ),
            Err(ShadowStoreError::InvalidFriendsQuery {
                field: "timeRange.startsAt"
            })
        ));
        assert!(exact_location_presence(
            serde_json::json!({ "location": { "name": "\u{0085}" } })
                .as_object()
                .expect("rest object"),
            serde_json::json!({}).as_object().expect("content object"),
        )
        .expect("non-JavaScript-whitespace explicit location"));
        assert!(!recovered_location_name(Some(
            "https://example.test/location/%EF%BB%BF"
        )));
        assert!(recovered_location_name(Some(
            "https://example.test/location/%C2%85"
        )));
    }

    #[test]
    fn friends_graph_rejects_duplicate_malformed_and_over_limit_inputs() {
        let store = seeded(1);
        let source = friend_source("x", "a:1");
        assert!(matches!(
            store.friends_graph_activity(
                &[source.clone(), source],
                &[],
                FriendsActivityWindow {
                    start_ms: 0,
                    end_ms: 1
                }
            ),
            Err(ShadowStoreError::InvalidFriendsQuery {
                field: "duplicate sources"
            })
        ));
        assert!(matches!(
            store.friends_graph_activity(
                &[],
                &[],
                FriendsActivityWindow {
                    start_ms: 1,
                    end_ms: 1
                }
            ),
            Err(ShadowStoreError::InvalidFriendsQuery {
                field: "recentWindow"
            })
        ));
        let maximum_sources = (0..MAX_FRIEND_SOURCE_KEYS)
            .map(|index| friend_source("x", &format!("author-{index}")))
            .collect::<Vec<_>>();
        assert!(matches!(
            store.friends_graph_activity(
                &maximum_sources,
                &["https://feed.test/overflow".to_string()],
                FriendsActivityWindow { start_ms: 0, end_ms: 1 }
            ),
            Err(ShadowStoreError::FriendsSourceLimit {
                requested,
                maximum: MAX_FRIEND_SOURCE_KEYS
            }) if requested == MAX_FRIEND_SOURCE_KEYS + 1
        ));

        let mut malformed_store = ShadowStore::open_in_memory().expect("open malformed");
        let mut malformed = row(1, Some(100));
        malformed.rest = serde_json::json!({
            "contentSignals": { "tags": ["unknown-signal"] }
        })
        .to_string();
        malformed_store
            .apply_projection_batch("malformed-friends", &digest(202), 0, &[malformed], &[])
            .expect("project malformed row");
        assert!(matches!(
            malformed_store.friends_graph_activity(
                &[friend_source("x", "a:1")],
                &[],
                FriendsActivityWindow {
                    start_ms: 0,
                    end_ms: 200
                }
            ),
            Err(ShadowStoreError::InvalidFriendsQuery {
                field: "contentSignals.tags"
            })
        ));
    }

    #[test]
    fn person_timeline_is_stateless_exact_and_retains_archived_rows() {
        let mut store = ShadowStore::open_in_memory().expect("open");
        let mut newest_archived = row(1, Some(300));
        newest_archived.archived = Some(1);
        let middle = row(2, Some(200));
        let oldest = row(3, Some(100));
        let mut hidden = row(4, Some(400));
        hidden.hidden = Some(1);
        let mut unrelated = row(5, Some(500));
        unrelated.author_id = Some("other".to_string());
        store
            .apply_projection_batch(
                "friends-timeline",
                &digest(203),
                0,
                &[newest_archived, middle, oldest, hidden, unrelated],
                &[],
            )
            .expect("project timeline rows");

        let sources = [friend_source("x", "a:1")];
        let first = store
            .person_timeline(&sources, None, 2)
            .expect("first timeline page");
        assert_eq!(first.total_count, 3);
        assert_eq!(
            first
                .rows
                .iter()
                .map(|row| (row.global_id.as_str(), row.archived))
                .collect::<Vec<_>>(),
            vec![("x:000001", Some(true)), ("x:000002", Some(false))],
        );
        let second = store
            .person_timeline(&sources, first.next_cursor.as_ref(), 2)
            .expect("second timeline page");
        assert_eq!(
            second
                .rows
                .iter()
                .map(|row| row.global_id.as_str())
                .collect::<Vec<_>>(),
            vec!["x:000003"],
        );
        assert!(second.next_cursor.is_none());
        assert!(matches!(
            store.person_timeline(&[sources[0].clone(), sources[0].clone()], None, 2),
            Err(ShadowStoreError::InvalidFriendsQuery {
                field: "duplicate sources"
            })
        ));
        let stale = PageCursor {
            revision: first.revision + 1,
            sort_at: 200,
            global_id: "x:000002".to_string(),
        };
        assert!(matches!(
            store.person_timeline(&sources, Some(&stale), 2),
            Err(ShadowStoreError::StaleRevision { .. })
        ));
    }

    #[test]
    fn person_timeline_exact_multiple_ends_without_a_false_cursor() {
        let store = seeded(100);
        let sources = [friend_source("x", "a:1")];
        let first = store
            .person_timeline(&sources, None, 50)
            .expect("first exact-multiple page");
        assert_eq!(first.rows.len(), 50);
        assert!(first.next_cursor.is_some());

        let second = store
            .person_timeline(&sources, first.next_cursor.as_ref(), 50)
            .expect("terminal exact-multiple page");
        assert_eq!(second.rows.len(), 50);
        assert!(
            second.next_cursor.is_none(),
            "an exact final page must not advertise an empty third page"
        );
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
    fn surface_queries_order_through_the_index_except_the_known_map_defect() {
        // Both surfaces filter with json_type, json_extract, and GLOB, none of
        // which an index can satisfy. What matters is whether the ORDER BY is
        // still answered by an index: if SQLite sorts instead, every open of
        // that surface sorts the whole filtered corpus, and the page is bounded
        // while the work behind it is not.
        let store = seeded(500);

        // Story Wall leads with `hidden IS NOT 1 AND archived IS NOT 1`, which
        // matches the friends-timeline index prefix, so it walks that index in
        // order and never sorts. This is the invariant.
        let story_wall = explain_surface(&store, LibrarySurface::StoryWall);
        assert!(
            story_wall.contains("feed_items_friends_timeline"),
            "Story Wall should read through the friends timeline index, got: {story_wall}"
        );
        assert!(
            !story_wall.to_uppercase().contains("TEMP B-TREE"),
            "Story Wall must not sort, got: {story_wall}"
        );

        // Map has no indexable leading term, so it scans and sorts. This
        // characterizes a KNOWN DEFECT tracked in issue #1323, it does not
        // bless it. Fixing that issue makes this assertion fail, which is the
        // signal to replace it with the same no-sort assertion above.
        let map = explain_surface(&store, LibrarySurface::Map);
        assert!(
            map.to_uppercase().contains("TEMP B-TREE"),
            "Map is expected to still sort until issue #1323 lands. If this \
             failed, the defect is fixed: assert the absence of TEMP B-TREE \
             here instead. Got: {map}"
        );
    }

    fn explain_surface(store: &ShadowStore, surface: LibrarySurface) -> String {
        let explained = format!("EXPLAIN QUERY PLAN {}", surface_items_sql(surface));
        let mut statement = store
            .conn
            .prepare(&explained)
            .expect("prepare surface plan");
        statement
            .query_map(params![64u32], |row| row.get::<_, String>(3))
            .expect("surface plan")
            .collect::<SqlResult<Vec<_>>>()
            .expect("surface plan rows")
            .join(" | ")
    }

    #[test]
    fn person_timeline_pages_use_the_archived_eligible_index_without_sorting() {
        let store = seeded(500);
        for after in [false, true] {
            let plan = store
                .explain_person_timeline(after)
                .expect("friends timeline plan");
            assert!(
                plan.contains("feed_items_friends_timeline"),
                "Friends timeline should use its archived-eligible index, got: {plan}"
            );
            assert!(
                !plan.to_uppercase().contains("TEMP B-TREE"),
                "Friends timeline must not sort, got: {plan}"
            );
        }
        let has_more_plan = store
            .explain_person_timeline_has_more()
            .expect("Friends timeline continuation plan");
        assert!(
            has_more_plan.contains("feed_items_friends_timeline"),
            "Friends continuation should use its archived-eligible index, got: {has_more_plan}"
        );
        assert!(
            !has_more_plan.to_uppercase().contains("TEMP B-TREE"),
            "Friends continuation must not sort, got: {has_more_plan}"
        );
    }

    #[test]
    fn friends_graph_aggregates_never_sort_the_full_matching_corpus() {
        let store = seeded(500);
        let sources = serde_json::to_string(&[friend_source("x", "a:1")]).expect("social selector");
        let feeds = serde_json::to_string(&["https://feed.test/rss"]).expect("RSS selector");
        for (sql, selector) in [
            (FRIENDS_GRAPH_SOCIAL_SQL, sources.as_str()),
            (FRIENDS_GRAPH_RSS_SQL, feeds.as_str()),
        ] {
            let mut statement = store
                .conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare graph plan");
            let plan = statement
                .query_map([selector], |row| row.get::<_, String>(3))
                .expect("query graph plan")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect graph plan")
                .join(" | ");
            assert!(
                !plan.to_uppercase().contains("TEMP B-TREE"),
                "Friends graph aggregation must not sort its full source corpus, got: {plan}"
            );
        }
    }

    #[test]
    fn lossless_item_scan_pages_every_row_once_in_primary_key_order() {
        let store = seeded(130);
        let mut after = None;
        let mut ids = Vec::new();
        loop {
            let page = store
                .item_scan_page(after.as_deref(), 17)
                .expect("item scan page");
            ids.extend(page.rows.iter().map(|row| row.global_id.clone()));
            match page.next_after_global_id {
                Some(cursor) => after = Some(cursor),
                None => break,
            }
        }
        assert_eq!(ids.len(), 130);
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(ids.first().map(String::as_str), Some("x:000000"));
        assert_eq!(ids.last().map(String::as_str), Some("x:000129"));
        assert!(matches!(
            store.item_scan_page(None, 0),
            Err(ShadowStoreError::InvalidItemScanPageLimit { .. })
        ));
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
    fn a_v3_staging_store_adds_the_friends_index_without_losing_rows() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "freed-shadow-store-v3-migration-{}-{nonce}.sqlite",
            std::process::id()
        ));
        {
            let conn = Connection::open(&path).expect("create v3 store");
            conn.execute_batch(SHADOW_SCHEMA_V1_SQL)
                .expect("install v1 schema");
            conn.execute_batch(SHADOW_SCHEMA_V2_SQL)
                .expect("install v2 schema");
            conn.execute_batch(SHADOW_SCHEMA_V3_SQL)
                .expect("install v3 schema");
            conn.execute(
                "INSERT INTO feed_items (globalId, rest, sortAt) VALUES ('x:legacy-v3', '{}', 0);",
                [],
            )
            .expect("seed v3 row");
        }

        let store = ShadowStore::open(&path).expect("migrate v3 staging store");
        assert_eq!(store.total_count().expect("count"), 1);
        let version: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version");
        assert_eq!(version, SHADOW_SCHEMA_VERSION);
        let index_exists: bool = store
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
                 WHERE type = 'index' AND name = 'feed_items_friends_timeline');",
                [],
                |row| row.get(0),
            )
            .expect("friends timeline index");
        assert!(index_exists);

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
