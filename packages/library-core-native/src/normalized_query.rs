use crate::lower_hex;
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::SQLITE_QUERY_PROGRAMS;
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const FEED_PAGE_MAXIMUM_LIMIT: usize = 128;
const FEED_PAGE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const FEED_PAGE_MAXIMUM_CURSOR_BYTES: usize = 5_540;
const FEED_BROWSE_MAXIMUM_CURSOR_BYTES: usize = 5_560;
const SAVED_FEED_MAXIMUM_CURSOR_BYTES: usize = 5_586;
const PERSON_TIMELINE_MAXIMUM_LIMIT: usize = 100;
const PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PERSON_TIMELINE_MAXIMUM_CURSOR_BYTES: usize = 5_700;
const MAP_MARKERS_MAXIMUM_LIMIT: usize = 1_000;
const STORY_WALL_CANDIDATES_MAXIMUM_LIMIT: usize = 250;
const SECONDARY_SURFACE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const ITEM_SCAN_MAXIMUM_LIMIT: usize = 64;
const ITEM_SCAN_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const CONTENT_FETCH_MAXIMUM_LIMIT: usize = 64;
const CONTENT_FETCH_MAXIMUM_RESPONSE_BYTES: usize = 1_048_576;
const PROVIDER_MEDIA_MAXIMUM_LIMIT: usize = 64;
const PROVIDER_MEDIA_MAXIMUM_RESPONSE_BYTES: usize = 4 * 1_048_576;
const CHANGE_FEED_MAXIMUM_LIMIT: usize = 512;
const CHANGE_FEED_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PREFERENCES_SNAPSHOT_MAXIMUM_ROWS: usize = 512;
const PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PREFERENCE_PATH_MAXIMUM_BYTES: usize = 4_096;
const PREFERENCE_TEXT_MAXIMUM_BYTES: usize = 8_192;
const PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES: usize = 512 * 1_024;
const ACCOUNT_DETAIL_MAXIMUM_RESPONSE_BYTES: usize = 512 * 1_024;
const RSS_FEED_DETAIL_MAXIMUM_RESPONSE_BYTES: usize = 64 * 1_024;
const FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT: usize = 128;
const FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES: usize = 128;
const PERSONS_GRAPH_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PERSONS_GRAPH_SIGNALS: [&str; 20] = [
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
const ITEM_READER_BODY_MAXIMUM_RANGE_BYTES: usize = 256 * 1_024;
const ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES: usize = 512 * 1_024;
const CONTENT_CHUNK_BYTES: usize = 65_536;
const CURSOR_FIXED_BYTES: usize = 59;
const SEARCH_MAXIMUM_LIMIT: usize = 32;
const SEARCH_MAXIMUM_SCAN_ROWS: usize = 256;
const SEARCH_MAXIMUM_QUERY_BYTES: usize = 1_024;
const SEARCH_MAXIMUM_QUERY_TERMS: usize = 32;
const SEARCH_MAXIMUM_DOCUMENT_TERMS: usize = 384;
const SEARCH_MAXIMUM_ALIAS_TERMS: usize = 16;
const SEARCH_MAXIMUM_TOKEN_BYTES: usize = 1_024;
const SEARCH_MAXIMUM_TOKEN_SCALARS: usize = 256;
const SEARCH_MAXIMUM_SCORE_WORK: usize = 65_536;
const SEARCH_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedPageRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedBrowseFilterV1 {
    pub archived_only: bool,
    pub author_id: Option<String>,
    pub feed_url: Option<String>,
    pub platform: Option<String>,
    pub saved_only: bool,
    pub schema_version: u32,
    pub show_hidden: bool,
    pub signals: Vec<String>,
    pub social_content_filter: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedBrowsePageRequestV3 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub direction: String,
    pub filter: NormalizedFeedBrowseFilterV1,
    pub friends_predicate_schema_version: u32,
    pub identity_mode: String,
    pub limit: usize,
    pub ranking_clock_ms: i64,
    pub reader_session_id: String,
    pub recommendation_order_schema_version: u32,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedFeedPageRequestV2 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub direction: String,
    pub filter: NormalizedFeedBrowseFilterV1,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
    pub sort_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonTimelineRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub person_id: String,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedAccountTimelineRequestV1 {
    pub account_id: String,
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSearchPageRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub filter: NormalizedFeedBrowseFilterV1,
    pub friends_predicate_schema_version: u32,
    pub identity_mode: String,
    pub limit: usize,
    pub query: String,
    pub reader_session_id: String,
    pub recommendation_order_schema_version: u32,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedMapMarkersRequestV1 {
    pub cancellation_id: String,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedStoryWallCandidatesRequestV1 {
    pub cancellation_id: String,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemScanRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedContentFetchPageRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedProviderMediaPageRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub provider: String,
    pub reader_session_id: String,
    pub saved_only: bool,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedChangeFeedRequestV1 {
    pub after_revision: i64,
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFacetSummaryRequestV1 {
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedAnalyticsWindowV2 {
    pub end_ms: i64,
    pub start_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedAnalyticsRequestV2 {
    pub daily_windows: Vec<NormalizedSavedAnalyticsWindowV2>,
    pub hourly_windows: Vec<NormalizedSavedAnalyticsWindowV2>,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPreferencesSnapshotRequestV1 {
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphWindowV1 {
    pub end_ms: i64,
    pub start_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphSourceV1 {
    pub author_id: String,
    pub platform: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphRequestV1 {
    pub recent_window: NormalizedPersonsGraphWindowV1,
    pub rss_feed_urls: Vec<String>,
    pub schema_version: u32,
    pub sources: Vec<NormalizedPersonsGraphSourceV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemDetailRequestV1 {
    pub global_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonDetailRequestV1 {
    pub person_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedAccountDetailRequestV1 {
    pub account_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedRssFeedDetailRequestV1 {
    pub schema_version: u32,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFilterScopeSummaryRequestV1 {
    pub author_id: Option<String>,
    pub feed_url: Option<String>,
    pub platform: Option<String>,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonGraphPageRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedAccountGraphPageRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedRssFeedPageRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemReaderBodyRequestV1 {
    pub body_kind: String,
    pub global_id: String,
    pub limit_bytes: usize,
    pub offset_bytes: usize,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NormalizedQueryRequestV1 {
    AccountDetail(NormalizedAccountDetailRequestV1),
    AccountGraphPage(NormalizedAccountGraphPageRequestV1),
    AccountTimeline(NormalizedAccountTimelineRequestV1),
    ChangeFeed(NormalizedChangeFeedRequestV1),
    FacetSummary(NormalizedFacetSummaryRequestV1),
    FeedBrowsePage(NormalizedFeedBrowsePageRequestV3),
    FeedPage(NormalizedFeedPageRequestV1),
    FilterScopeSummary(NormalizedFilterScopeSummaryRequestV1),
    ItemDetail(NormalizedItemDetailRequestV1),
    ItemReaderBody(NormalizedItemReaderBodyRequestV1),
    ItemScan(NormalizedItemScanRequestV1),
    ContentFetchPage(NormalizedContentFetchPageRequestV1),
    ProviderMediaPage(NormalizedProviderMediaPageRequestV1),
    MapMarkers(NormalizedMapMarkersRequestV1),
    PersonDetail(NormalizedPersonDetailRequestV1),
    PersonGraphPage(NormalizedPersonGraphPageRequestV1),
    PersonTimeline(NormalizedPersonTimelineRequestV1),
    PersonsGraph(NormalizedPersonsGraphRequestV1),
    PreferencesSnapshot(NormalizedPreferencesSnapshotRequestV1),
    RssFeedDetail(NormalizedRssFeedDetailRequestV1),
    RssFeedPage(NormalizedRssFeedPageRequestV1),
    SavedAnalytics(NormalizedSavedAnalyticsRequestV2),
    SavedFeedPage(NormalizedSavedFeedPageRequestV2),
    SearchPage(NormalizedSearchPageRequestV1),
    StoryWallCandidates(NormalizedStoryWallCandidatesRequestV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedPageSourceV1 {
    pub generation_id: String,
    pub projection_revision: i64,
    pub transition_sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedCardV1 {
    pub archived: Option<bool>,
    pub author_avatar_url: Option<String>,
    pub author_display_name: Option<String>,
    pub author_handle: Option<String>,
    pub author_id: Option<String>,
    pub captured_at: Option<i64>,
    pub content_signal_tags: Vec<String>,
    pub content_text: Option<String>,
    pub content_type: Option<String>,
    pub engagement_comments: Option<i64>,
    pub engagement_likes: Option<i64>,
    pub event_confidence_basis_points: Option<i64>,
    pub event_starts_at: Option<i64>,
    pub global_id: String,
    pub liked: Option<bool>,
    pub liked_at: Option<i64>,
    pub liked_synced_at: Option<i64>,
    pub link_preview_title: Option<String>,
    pub location_name: Option<String>,
    pub media_types: Vec<String>,
    pub media_urls: Vec<String>,
    pub platform: Option<String>,
    pub published_at: Option<i64>,
    pub read_at: Option<i64>,
    pub reading_time_minutes: Option<i64>,
    pub saved: Option<bool>,
    pub source_url: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedPageResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedFeedCardV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
    pub total_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedBrowseEdgeOrderV3 {
    pub global_id: String,
    pub priority: i64,
    pub published_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFeedBrowsePageResponseV3 {
    pub filter: NormalizedFeedBrowseFilterV1,
    pub friends_predicate_schema_version: u32,
    pub identity_mode: String,
    pub next_cursor: Option<String>,
    pub next_order: Option<NormalizedFeedBrowseEdgeOrderV3>,
    pub previous_cursor: Option<String>,
    pub previous_order: Option<NormalizedFeedBrowseEdgeOrderV3>,
    pub query_id: String,
    pub ranking_clock_ms: i64,
    pub recommendation_order_schema_version: u32,
    pub rows: Vec<NormalizedFeedCardV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
    pub total_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedFeedCardV2 {
    #[serde(flatten)]
    pub card: NormalizedFeedCardV1,
    pub saved_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedFeedEdgeOrderV2 {
    pub global_id: String,
    pub sort_group: i64,
    pub sort_primary: i64,
    pub sort_secondary: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedFeedPageResponseV2 {
    pub filter: NormalizedFeedBrowseFilterV1,
    pub next_cursor: Option<String>,
    pub next_order: Option<NormalizedSavedFeedEdgeOrderV2>,
    pub previous_cursor: Option<String>,
    pub previous_order: Option<NormalizedSavedFeedEdgeOrderV2>,
    pub query_id: String,
    pub rows: Vec<NormalizedSavedFeedCardV2>,
    pub schema_version: u32,
    pub sort_mode: String,
    pub source: NormalizedFeedPageSourceV1,
    pub total_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonTimelineResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedFeedCardV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
    pub total_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSearchPageRowV1 {
    pub card: NormalizedFeedCardV1,
    pub priority: i64,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSearchPageResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedSearchPageRowV1>,
    pub scanned_rows: usize,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedMapMarkerV1 {
    pub author_avatar_url: Option<String>,
    pub author_display_name: String,
    pub author_handle: String,
    pub author_id: String,
    pub captured_at: i64,
    pub content_text: Option<String>,
    pub content_type: String,
    pub global_id: String,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub location_name: Option<String>,
    pub location_url: Option<String>,
    pub platform: String,
    pub published_at: i64,
    pub source_url: Option<String>,
    pub time_range_ends_at: Option<i64>,
    pub time_range_starts_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedMapMarkersResponseV1 {
    pub has_more: bool,
    pub query_id: String,
    pub rows: Vec<NormalizedMapMarkerV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedStoryWallCandidateV1 {
    pub author_display_name: String,
    pub author_handle: String,
    pub author_id: String,
    pub captured_at: i64,
    pub content_text: Option<String>,
    pub global_id: String,
    pub location_name: Option<String>,
    pub media_types: Vec<String>,
    pub media_urls: Vec<String>,
    pub platform: String,
    pub published_at: i64,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedStoryWallCandidatesResponseV1 {
    pub has_more: bool,
    pub query_id: String,
    pub rows: Vec<NormalizedStoryWallCandidateV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemScanResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedItemScanRowV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedContentFetchCandidateV1 {
    pub captured_at: i64,
    pub global_id: String,
    pub link_url: String,
    pub published_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedContentFetchPageResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedContentFetchCandidateV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemScanRssSourceV1 {
    pub feed_title: String,
    pub feed_url: String,
    pub site_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemScanSampleFingerprintV1 {
    pub batch_id: String,
    pub generated_at: i64,
    pub generator_version: i64,
    pub marker: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemScanRowV1 {
    #[serde(flatten)]
    pub card: NormalizedFeedCardV1,
    pub hidden: bool,
    pub rss_source: Option<NormalizedItemScanRssSourceV1>,
    pub sample_data_fingerprint: Option<NormalizedItemScanSampleFingerprintV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedProviderMediaGroupV1 {
    pub id: String,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedProviderMediaRowV1 {
    #[serde(flatten)]
    pub card: NormalizedFeedCardV1,
    pub fb_group: Option<NormalizedProviderMediaGroupV1>,
    pub link_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedProviderMediaPageResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedProviderMediaRowV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedChangeFeedRowV1 {
    pub entity_id: Option<String>,
    pub ordinal: i64,
    pub reset_required: bool,
    pub revision: i64,
    pub topic: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedChangeFeedResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedChangeFeedRowV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFacetSummaryV1 {
    pub archived_count: i64,
    pub archivable_count: i64,
    pub enabled_rss_feed_count: i64,
    pub friend_person_count: i64,
    pub platform_counts: Vec<NormalizedFacetPlatformCountV1>,
    pub rss_feed_count: i64,
    pub sample_account_count: i64,
    pub sample_feed_count: i64,
    pub sample_item_count: i64,
    pub sample_person_count: i64,
    pub saved_archived_count: i64,
    pub saved_count: i64,
    pub saved_platform_count: i64,
    pub social_account_count: i64,
    pub tags: Vec<String>,
    pub total_count: i64,
    pub unread_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFacetPlatformCountV1 {
    pub archivable_count: i64,
    pub platform: String,
    pub total_count: i64,
    pub unread_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFacetSummaryResponseV1 {
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
    pub summary: NormalizedFacetSummaryV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedAnalyticsCountV2 {
    pub count: i64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedSavedAnalyticsResponseV2 {
    pub content_mix: Vec<NormalizedSavedAnalyticsCountV2>,
    pub daily_counts: Vec<i64>,
    pub hourly_counts: Vec<i64>,
    pub latest_saved_at: Option<i64>,
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
    pub source_counts: Vec<NormalizedSavedAnalyticsCountV2>,
    pub total_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPreferenceLeafV1 {
    pub boolean_value: Option<bool>,
    pub integer_value: Option<i64>,
    pub path: String,
    pub real_value: Option<f64>,
    pub text_value: Option<String>,
    pub updated_at: i64,
    pub value_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPreferencesSnapshotResponseV1 {
    pub query_id: String,
    pub rows: Vec<NormalizedPreferenceLeafV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphSampleV1 {
    pub global_id: String,
    pub published_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphLocationV1 {
    pub effective_at: i64,
    pub global_id: String,
    pub published_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphSignalV1 {
    pub count: i64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphSocialV1 {
    pub author_id: String,
    pub avatar_global_id: Option<String>,
    pub avatar_published_at: Option<i64>,
    pub avatar_url: Option<String>,
    pub has_location: bool,
    pub item_count: i64,
    pub latest_activity_at: i64,
    pub location_candidate_count: i64,
    pub location_candidates: Vec<NormalizedPersonsGraphLocationV1>,
    pub platform: String,
    pub recent_count: i64,
    pub sample_items: Vec<NormalizedPersonsGraphSampleV1>,
    pub signal_counts: Vec<NormalizedPersonsGraphSignalV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphRssV1 {
    pub avatar_global_id: Option<String>,
    pub avatar_published_at: Option<i64>,
    pub avatar_url: Option<String>,
    pub feed_url: String,
    pub has_location: bool,
    pub item_count: i64,
    pub latest_activity_at: i64,
    pub location_candidate_count: i64,
    pub location_candidates: Vec<NormalizedPersonsGraphLocationV1>,
    pub sample_items: Vec<NormalizedPersonsGraphSampleV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonsGraphResponseV1 {
    pub query_id: String,
    pub rss: Vec<NormalizedPersonsGraphRssV1>,
    pub schema_version: u32,
    pub social: Vec<NormalizedPersonsGraphSocialV1>,
    pub source: NormalizedFeedPageSourceV1,
    pub total_item_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemBodyLocatorV1 {
    pub blob_digest: Option<String>,
    pub storage: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemDetailV1 {
    pub card: NormalizedFeedCardV1,
    pub content_body: NormalizedItemBodyLocatorV1,
    pub preserved_body: NormalizedItemBodyLocatorV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemDetailResponseV1 {
    pub item: Option<NormalizedItemDetailV1>,
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonReachOutV1 {
    pub channel: Option<String>,
    pub logged_at: i64,
    pub notes: Option<String>,
    pub reach_out_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonDetailV1 {
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub care_level: i64,
    pub created_at: i64,
    pub id: String,
    pub name: String,
    pub notes: Option<String>,
    pub reach_out_interval_days: Option<i64>,
    pub reach_outs: Vec<NormalizedPersonReachOutV1>,
    pub relationship_status: String,
    pub sample_batch_id: Option<String>,
    pub sample_generated_at: Option<i64>,
    pub sample_generator_version: Option<i64>,
    pub tags: Vec<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonDetailResponseV1 {
    pub person: Option<NormalizedPersonDetailV1>,
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedAccountDetailV1 {
    pub address: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: i64,
    pub discovered_from: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub external_id: String,
    pub first_seen_at: i64,
    pub follow_roster_active: Option<bool>,
    pub follow_roster_roles: Vec<String>,
    pub follow_roster_synced_at: Option<i64>,
    pub handle: Option<String>,
    pub id: String,
    pub imported_at: Option<i64>,
    pub kind: String,
    pub last_seen_at: i64,
    pub person_id: Option<String>,
    pub phone: Option<String>,
    pub profile_url: Option<String>,
    pub provider: String,
    pub sample_batch_id: Option<String>,
    pub sample_generated_at: Option<i64>,
    pub sample_generator_version: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedAccountDetailResponseV1 {
    pub account: Option<NormalizedAccountDetailV1>,
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedRssFeedDetailV1 {
    pub enabled: bool,
    pub folder: Option<String>,
    pub image_url: Option<String>,
    pub last_fetched: Option<i64>,
    pub poll_interval: Option<i64>,
    pub sample_batch_id: Option<String>,
    pub sample_generated_at: Option<i64>,
    pub sample_generator_version: Option<i64>,
    pub site_url: Option<String>,
    pub title: String,
    pub track_unread: bool,
    pub updated_at: i64,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedRssFeedDetailResponseV1 {
    pub feed: Option<NormalizedRssFeedDetailV1>,
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonGraphRowV1 {
    pub avatar_url: Option<String>,
    pub care_level: i64,
    pub graph_pinned: bool,
    pub graph_updated_at: Option<i64>,
    pub graph_x: Option<f64>,
    pub graph_y: Option<f64>,
    pub id: String,
    pub last_reach_out_at: Option<i64>,
    pub name: String,
    pub reach_out_interval_days: Option<i64>,
    pub relationship_status: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedAccountGraphRowV1 {
    pub activity_count: i64,
    pub avatar_url: Option<String>,
    pub discovered_from: String,
    pub display_name: Option<String>,
    pub external_id: String,
    pub first_seen_at: i64,
    pub follow_roster_active: Option<bool>,
    pub graph_pinned: bool,
    pub graph_updated_at: Option<i64>,
    pub graph_x: Option<f64>,
    pub graph_y: Option<f64>,
    pub handle: Option<String>,
    pub id: String,
    pub kind: String,
    pub last_seen_at: i64,
    pub latest_activity_at: Option<i64>,
    pub person_id: Option<String>,
    pub person_name: Option<String>,
    pub provider: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedRssFeedPageRowV1 {
    pub activity_count: i64,
    pub enabled: bool,
    pub folder: Option<String>,
    pub image_url: Option<String>,
    pub last_fetched: Option<i64>,
    pub latest_activity_at: Option<i64>,
    pub poll_interval: Option<i64>,
    pub sample_batch_id: Option<String>,
    pub sample_generated_at: Option<i64>,
    pub sample_generator_version: Option<i64>,
    pub site_url: Option<String>,
    pub title: String,
    pub track_unread: bool,
    pub unread_count: i64,
    pub updated_at: i64,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPersonGraphPageResponseV1 {
    pub layout_revision: i64,
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedPersonGraphRowV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedAccountGraphPageResponseV1 {
    pub layout_revision: i64,
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedAccountGraphRowV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedRssFeedPageResponseV1 {
    pub layout_revision: i64,
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedRssFeedPageRowV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemReaderBodyRangeV1 {
    pub blob_digest: Option<String>,
    pub bytes_base64: String,
    pub content_length: usize,
    pub end_offset: usize,
    pub start_offset: usize,
    pub storage: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemReaderBodyResponseV1 {
    pub body: Option<NormalizedItemReaderBodyRangeV1>,
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFilterScopeSummaryResponseV1 {
    pub item_count: i64,
    pub label: Option<String>,
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NormalizedQueryResponseV1 {
    AccountDetail(Box<NormalizedAccountDetailResponseV1>),
    AccountGraphPage(NormalizedAccountGraphPageResponseV1),
    AccountTimeline(NormalizedPersonTimelineResponseV1),
    ChangeFeed(NormalizedChangeFeedResponseV1),
    FacetSummary(NormalizedFacetSummaryResponseV1),
    FeedBrowsePage(Box<NormalizedFeedBrowsePageResponseV3>),
    FeedPage(NormalizedFeedPageResponseV1),
    FilterScopeSummary(NormalizedFilterScopeSummaryResponseV1),
    ItemDetail(Box<NormalizedItemDetailResponseV1>),
    ItemReaderBody(NormalizedItemReaderBodyResponseV1),
    ItemScan(NormalizedItemScanResponseV1),
    ContentFetchPage(NormalizedContentFetchPageResponseV1),
    ProviderMediaPage(NormalizedProviderMediaPageResponseV1),
    MapMarkers(NormalizedMapMarkersResponseV1),
    PersonDetail(Box<NormalizedPersonDetailResponseV1>),
    PersonGraphPage(NormalizedPersonGraphPageResponseV1),
    PersonTimeline(NormalizedPersonTimelineResponseV1),
    PersonsGraph(NormalizedPersonsGraphResponseV1),
    PreferencesSnapshot(NormalizedPreferencesSnapshotResponseV1),
    RssFeedDetail(NormalizedRssFeedDetailResponseV1),
    RssFeedPage(NormalizedRssFeedPageResponseV1),
    SavedAnalytics(NormalizedSavedAnalyticsResponseV2),
    SavedFeedPage(Box<NormalizedSavedFeedPageResponseV2>),
    SearchPage(NormalizedSearchPageResponseV1),
    StoryWallCandidates(NormalizedStoryWallCandidatesResponseV1),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FeedPageCursorV1 {
    generation_id: String,
    transition_sequence: i64,
    projection_revision: i64,
    sort_at: i64,
    global_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SearchPageCursorV1 {
    page: FeedPageCursorV1,
    search_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FeedBrowseCursorV2 {
    filter_digest: String,
    generation_id: String,
    transition_sequence: i64,
    projection_revision: i64,
    priority: i64,
    published_at: i64,
    global_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SavedFeedCursorV2 {
    filter_digest: String,
    generation_id: String,
    source_revision: i64,
    sort_mode: String,
    sort_group: i64,
    sort_primary: i64,
    sort_secondary: i64,
    global_id: String,
}

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn valid_operation_instance_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 128
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn valid_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_safe_integer(value: i64) -> bool {
    (0..=MAX_SAFE_INTEGER).contains(&value)
}

fn valid_platform(value: &str) -> bool {
    matches!(
        value,
        "x" | "rss"
            | "youtube"
            | "reddit"
            | "mastodon"
            | "github"
            | "facebook"
            | "instagram"
            | "linkedin"
            | "substack"
            | "medium"
            | "saved"
    )
}

fn valid_content_type(value: &str) -> bool {
    matches!(value, "post" | "story" | "article" | "video" | "podcast")
}

fn valid_media_type(value: &str) -> bool {
    matches!(value, "image" | "video" | "link" | "unknown")
}

fn encode_cursor(cursor: &FeedPageCursorV1) -> Result<String, NormalizedSqliteError> {
    if !valid_lower_hex_64(&cursor.generation_id)
        || !valid_safe_integer(cursor.transition_sequence)
        || !valid_safe_integer(cursor.projection_revision)
        || !valid_safe_integer(cursor.sort_at)
        || cursor.global_id.is_empty()
        || cursor.global_id.len() > 4_096
        || cursor.global_id.len() > usize::from(u16::MAX)
    {
        return Err(invalid("normalized feed cursor identity is invalid"));
    }
    let mut bytes = Vec::with_capacity(CURSOR_FIXED_BYTES + cursor.global_id.len());
    bytes.push(1);
    for pair in cursor.generation_id.as_bytes().chunks_exact(2) {
        let text = std::str::from_utf8(pair)
            .map_err(|_| invalid("normalized feed cursor identity is invalid"))?;
        bytes.push(
            u8::from_str_radix(text, 16)
                .map_err(|_| invalid("normalized feed cursor identity is invalid"))?,
        );
    }
    bytes.extend_from_slice(&(cursor.transition_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.projection_revision as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.sort_at as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.global_id.len() as u16).to_be_bytes());
    bytes.extend_from_slice(cursor.global_id.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn read_safe_u64(bytes: &[u8]) -> Result<i64, NormalizedSqliteError> {
    let array: [u8; 8] = bytes
        .try_into()
        .map_err(|_| invalid("normalized feed cursor encoding is invalid"))?;
    i64::try_from(u64::from_be_bytes(array))
        .ok()
        .filter(|value| valid_safe_integer(*value))
        .ok_or(invalid("normalized feed cursor integer is invalid"))
}

fn decode_cursor(value: &str) -> Result<FeedPageCursorV1, NormalizedSqliteError> {
    if value.is_empty() || value.len() > FEED_PAGE_MAXIMUM_CURSOR_BYTES {
        return Err(invalid("normalized feed cursor is outside its bound"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid("normalized feed cursor encoding is invalid"))?;
    if bytes.len() < CURSOR_FIXED_BYTES || bytes[0] != 1 {
        return Err(invalid("normalized feed cursor encoding is invalid"));
    }
    let global_id_length = usize::from(u16::from_be_bytes([bytes[57], bytes[58]]));
    if bytes.len() != CURSOR_FIXED_BYTES + global_id_length {
        return Err(invalid("normalized feed cursor length is invalid"));
    }
    let generation_id = bytes[1..33]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let global_id = std::str::from_utf8(&bytes[CURSOR_FIXED_BYTES..])
        .map_err(|_| invalid("normalized feed cursor entity is invalid"))?
        .to_owned();
    if global_id.is_empty() || global_id.len() > 4_096 {
        return Err(invalid("normalized feed cursor entity is invalid"));
    }
    Ok(FeedPageCursorV1 {
        generation_id,
        transition_sequence: read_safe_u64(&bytes[33..41])?,
        projection_revision: read_safe_u64(&bytes[41..49])?,
        sort_at: read_safe_u64(&bytes[49..57])?,
        global_id,
    })
}

fn encode_search_cursor(cursor: &SearchPageCursorV1) -> Result<String, NormalizedSqliteError> {
    if !valid_lower_hex_64(&cursor.search_digest) {
        return Err(invalid("normalized search cursor digest is invalid"));
    }
    Ok(format!(
        "1.{}.{}",
        encode_cursor(&cursor.page)?,
        cursor.search_digest
    ))
}

fn decode_search_cursor(value: &str) -> Result<SearchPageCursorV1, NormalizedSqliteError> {
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() != 3 || parts[0] != "1" || !valid_lower_hex_64(parts[2]) {
        return Err(invalid("normalized search cursor encoding is invalid"));
    }
    Ok(SearchPageCursorV1 {
        page: decode_cursor(parts[1])?,
        search_digest: parts[2].to_owned(),
    })
}

fn search_terms(value: &str, maximum_terms: usize) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    let mut current_bytes = 0_usize;
    let mut current_scalars = 0_usize;
    let mut overflow = false;
    for character in value
        .nfkd()
        .flat_map(char::to_lowercase)
        .filter(|character| !is_combining_mark(*character))
    {
        if character.is_alphanumeric() || matches!(character, '_' | '@' | '#') {
            if overflow {
                continue;
            }
            current_bytes += character.len_utf8();
            current_scalars += 1;
            if current_bytes > SEARCH_MAXIMUM_TOKEN_BYTES
                || current_scalars > SEARCH_MAXIMUM_TOKEN_SCALARS
            {
                current.clear();
                overflow = true;
                continue;
            }
            current.push(character);
        } else {
            if !overflow && !current.is_empty() && !terms.contains(&current) {
                terms.push(std::mem::take(&mut current));
                if terms.len() == maximum_terms {
                    return terms;
                }
            } else {
                current.clear();
            }
            current_bytes = 0;
            current_scalars = 0;
            overflow = false;
        }
    }
    if terms.len() < maximum_terms && !overflow && !current.is_empty() && !terms.contains(&current)
    {
        terms.push(current);
    }
    terms
}

fn bounded_search_edit_distance(left: &str, right: &str, maximum: usize) -> usize {
    if left.len() > SEARCH_MAXIMUM_TOKEN_BYTES || right.len() > SEARCH_MAXIMUM_TOKEN_BYTES {
        return maximum + 1;
    }
    let left = left.chars().collect::<Vec<_>>();
    let right = right.chars().collect::<Vec<_>>();
    if left.len() > SEARCH_MAXIMUM_TOKEN_SCALARS
        || right.len() > SEARCH_MAXIMUM_TOKEN_SCALARS
        || left.len().abs_diff(right.len()) > maximum
    {
        return maximum + 1;
    }
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    for (left_index, left_character) in left.iter().enumerate() {
        let mut current = vec![left_index + 1];
        let mut row_minimum = left_index + 1;
        for (right_index, right_character) in right.iter().enumerate() {
            let value = std::cmp::min(
                std::cmp::min(current[right_index] + 1, previous[right_index + 1] + 1),
                previous[right_index] + usize::from(left_character != right_character),
            );
            current.push(value);
            row_minimum = row_minimum.min(value);
        }
        if row_minimum > maximum {
            return maximum + 1;
        }
        previous = current;
    }
    previous[right.len()]
}

fn search_term_score(query: &str, candidate: &str, weight: f64) -> f64 {
    if candidate == query {
        return weight * 4.0;
    }
    if candidate.starts_with(query) {
        return weight * 3.0;
    }
    if query.chars().count() < 4 {
        return 0.0;
    }
    let maximum = std::cmp::max(1, query.chars().count() / 5);
    let distance = bounded_search_edit_distance(query, candidate, maximum);
    if distance <= maximum {
        weight * 2.0 - distance as f64 / 10.0
    } else {
        0.0
    }
}

fn collect_search_field(
    value: &str,
    weight: f64,
    maximum_terms: usize,
    fields: &mut Vec<(String, f64)>,
) {
    if fields.len() >= maximum_terms {
        return;
    }
    for term in search_terms(value, maximum_terms - fields.len()) {
        fields.push((term, weight));
    }
}

fn score_search_fields(fields: &[(String, f64)], query_terms: &[String]) -> f64 {
    let mut remaining_work = SEARCH_MAXIMUM_SCORE_WORK;
    let mut total = 0.0;
    for query in query_terms {
        let mut best = 0.0_f64;
        for (candidate, weight) in fields {
            if candidate == query || candidate.starts_with(query) {
                best = best.max(search_term_score(query, candidate, *weight));
                continue;
            }
            let work = (query.chars().count() + 1).saturating_mul(candidate.chars().count() + 1);
            if work > remaining_work {
                continue;
            }
            remaining_work -= work;
            best = best.max(search_term_score(query, candidate, *weight));
        }
        if best == 0.0 {
            return 0.0;
        }
        total += best;
    }
    total
}

fn encode_feed_browse_cursor(cursor: &FeedBrowseCursorV2) -> Result<String, NormalizedSqliteError> {
    if !valid_lower_hex_64(&cursor.filter_digest)
        || !valid_lower_hex_64(&cursor.generation_id)
        || !valid_safe_integer(cursor.transition_sequence)
        || !valid_safe_integer(cursor.projection_revision)
        || !(0..=100).contains(&cursor.priority)
        || !valid_safe_integer(cursor.published_at)
        || cursor.global_id.is_empty()
        || cursor.global_id.len() > 4_096
        || cursor.global_id.len() > usize::from(u16::MAX)
    {
        return Err(invalid("normalized browse cursor identity is invalid"));
    }
    let mut bytes = Vec::with_capacity(92 + cursor.global_id.len());
    bytes.push(2);
    for pair in cursor.generation_id.as_bytes().chunks_exact(2) {
        let text = std::str::from_utf8(pair)
            .map_err(|_| invalid("normalized browse cursor identity is invalid"))?;
        bytes.push(
            u8::from_str_radix(text, 16)
                .map_err(|_| invalid("normalized browse cursor identity is invalid"))?,
        );
    }
    for pair in cursor.filter_digest.as_bytes().chunks_exact(2) {
        let text = std::str::from_utf8(pair)
            .map_err(|_| invalid("normalized browse cursor identity is invalid"))?;
        bytes.push(
            u8::from_str_radix(text, 16)
                .map_err(|_| invalid("normalized browse cursor identity is invalid"))?,
        );
    }
    bytes.extend_from_slice(&(cursor.transition_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.projection_revision as u64).to_be_bytes());
    bytes.push(cursor.priority as u8);
    bytes.extend_from_slice(&(cursor.published_at as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.global_id.len() as u16).to_be_bytes());
    bytes.extend_from_slice(cursor.global_id.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_feed_browse_cursor(value: &str) -> Result<FeedBrowseCursorV2, NormalizedSqliteError> {
    if value.is_empty() || value.len() > FEED_BROWSE_MAXIMUM_CURSOR_BYTES {
        return Err(invalid("normalized browse cursor is outside its bound"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid("normalized browse cursor encoding is invalid"))?;
    if bytes.len() < 92 || bytes[0] != 2 {
        return Err(invalid("normalized browse cursor encoding is invalid"));
    }
    let global_id_length = usize::from(u16::from_be_bytes([bytes[90], bytes[91]]));
    if bytes.len() != 92 + global_id_length {
        return Err(invalid("normalized browse cursor length is invalid"));
    }
    let generation_id = lower_hex(&bytes[1..33]);
    let filter_digest = lower_hex(&bytes[33..65]);
    let priority = i64::from(bytes[81]);
    let global_id = std::str::from_utf8(&bytes[92..])
        .map_err(|_| invalid("normalized browse cursor entity is invalid"))?
        .to_owned();
    if !valid_lower_hex_64(&generation_id)
        || !valid_lower_hex_64(&filter_digest)
        || !(0..=100).contains(&priority)
        || global_id.is_empty()
        || global_id.len() > 4_096
    {
        return Err(invalid("normalized browse cursor identity is invalid"));
    }
    Ok(FeedBrowseCursorV2 {
        filter_digest,
        generation_id,
        transition_sequence: read_safe_u64(&bytes[65..73])?,
        projection_revision: read_safe_u64(&bytes[73..81])?,
        priority,
        published_at: read_safe_u64(&bytes[82..90])?,
        global_id,
    })
}

fn saved_sort_mode_code(value: &str) -> Option<u8> {
    match value {
        "date_saved" => Some(0),
        "date_published" => Some(1),
        "recommended" => Some(2),
        "shortest_read" => Some(3),
        _ => None,
    }
}

fn saved_sort_mode_from_code(value: u8) -> Option<&'static str> {
    [
        "date_saved",
        "date_published",
        "recommended",
        "shortest_read",
    ]
    .get(usize::from(value))
    .copied()
}

fn append_lower_hex_32(bytes: &mut Vec<u8>, value: &str) -> Result<(), NormalizedSqliteError> {
    for pair in value.as_bytes().chunks_exact(2) {
        let text = std::str::from_utf8(pair)
            .map_err(|_| invalid("normalized saved cursor identity is invalid"))?;
        bytes.push(
            u8::from_str_radix(text, 16)
                .map_err(|_| invalid("normalized saved cursor identity is invalid"))?,
        );
    }
    Ok(())
}

fn encode_saved_feed_cursor(cursor: &SavedFeedCursorV2) -> Result<String, NormalizedSqliteError> {
    let sort_mode = saved_sort_mode_code(&cursor.sort_mode)
        .ok_or(invalid("normalized saved cursor sort is invalid"))?;
    if !valid_lower_hex_64(&cursor.filter_digest)
        || !valid_lower_hex_64(&cursor.generation_id)
        || !valid_safe_integer(cursor.source_revision)
        || !(0..=100).contains(&cursor.sort_group)
        || !valid_safe_integer(cursor.sort_primary)
        || !valid_safe_integer(cursor.sort_secondary)
        || cursor.global_id.is_empty()
        || cursor.global_id.len() > 4_096
        || cursor.global_id.len() > usize::from(u16::MAX)
    {
        return Err(invalid("normalized saved cursor identity is invalid"));
    }
    let mut bytes = Vec::with_capacity(93 + cursor.global_id.len());
    bytes.push(2);
    bytes.push(sort_mode);
    append_lower_hex_32(&mut bytes, &cursor.generation_id)?;
    append_lower_hex_32(&mut bytes, &cursor.filter_digest)?;
    bytes.extend_from_slice(&(cursor.source_revision as u64).to_be_bytes());
    bytes.push(cursor.sort_group as u8);
    bytes.extend_from_slice(&(cursor.sort_primary as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.sort_secondary as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.global_id.len() as u16).to_be_bytes());
    bytes.extend_from_slice(cursor.global_id.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_saved_feed_cursor(value: &str) -> Result<SavedFeedCursorV2, NormalizedSqliteError> {
    if value.is_empty() || value.len() > SAVED_FEED_MAXIMUM_CURSOR_BYTES {
        return Err(invalid("normalized saved cursor is outside its bound"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid("normalized saved cursor encoding is invalid"))?;
    if bytes.len() < 93 || bytes[0] != 2 {
        return Err(invalid("normalized saved cursor encoding is invalid"));
    }
    let sort_mode = saved_sort_mode_from_code(bytes[1])
        .ok_or(invalid("normalized saved cursor sort is invalid"))?;
    let global_id_length = usize::from(u16::from_be_bytes([bytes[91], bytes[92]]));
    if bytes.len() != 93 + global_id_length {
        return Err(invalid("normalized saved cursor length is invalid"));
    }
    let generation_id = lower_hex(&bytes[2..34]);
    let filter_digest = lower_hex(&bytes[34..66]);
    let sort_group = i64::from(bytes[74]);
    let global_id = std::str::from_utf8(&bytes[93..])
        .map_err(|_| invalid("normalized saved cursor entity is invalid"))?
        .to_owned();
    if !valid_lower_hex_64(&generation_id)
        || !valid_lower_hex_64(&filter_digest)
        || !(0..=100).contains(&sort_group)
        || global_id.is_empty()
        || global_id.len() > 4_096
    {
        return Err(invalid("normalized saved cursor identity is invalid"));
    }
    Ok(SavedFeedCursorV2 {
        filter_digest,
        generation_id,
        source_revision: read_safe_u64(&bytes[66..74])?,
        sort_mode: sort_mode.to_owned(),
        sort_group,
        sort_primary: read_safe_u64(&bytes[75..83])?,
        sort_secondary: read_safe_u64(&bytes[83..91])?,
        global_id,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PersonTimelineCursorV1 {
    page: FeedPageCursorV1,
    person_digest: String,
}

fn encode_person_timeline_cursor(
    cursor: &PersonTimelineCursorV1,
) -> Result<String, NormalizedSqliteError> {
    if !valid_lower_hex_64(&cursor.person_digest) {
        return Err(invalid(
            "normalized person timeline identity digest is invalid",
        ));
    }
    Ok(format!(
        "1.{}.{}",
        encode_cursor(&cursor.page)?,
        cursor.person_digest
    ))
}

fn decode_person_timeline_cursor(
    value: &str,
) -> Result<PersonTimelineCursorV1, NormalizedSqliteError> {
    if value.is_empty() || value.len() > PERSON_TIMELINE_MAXIMUM_CURSOR_BYTES {
        return Err(invalid(
            "normalized person timeline cursor is outside its bound",
        ));
    }
    let mut parts = value.split('.');
    if parts.next() != Some("1") {
        return Err(invalid(
            "normalized person timeline cursor version is invalid",
        ));
    }
    let page = parts
        .next()
        .ok_or(invalid("normalized person timeline cursor is invalid"))?;
    let person_digest = parts
        .next()
        .ok_or(invalid("normalized person timeline cursor is invalid"))?;
    if parts.next().is_some() || !valid_lower_hex_64(person_digest) {
        return Err(invalid("normalized person timeline cursor is invalid"));
    }
    Ok(PersonTimelineCursorV1 {
        page: decode_cursor(page)?,
        person_digest: person_digest.to_owned(),
    })
}

fn optional_boolean(row: &Row<'_>, name: &str) -> rusqlite::Result<Option<bool>> {
    row.get::<_, Option<i64>>(name)?.map_or(Ok(None), |value| {
        if matches!(value, 0 | 1) {
            Ok(Some(value == 1))
        } else {
            Err(rusqlite::Error::IntegralValueOutOfRange(0, value))
        }
    })
}

fn string_array(
    row: &Row<'_>,
    name: &str,
    maximum_items: usize,
    maximum_item_bytes: usize,
) -> rusqlite::Result<Vec<String>> {
    let json: String = row.get(name)?;
    let values: Vec<String> = serde_json::from_str(&json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })?;
    if values.len() > maximum_items || values.iter().any(|value| value.len() > maximum_item_bytes) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(values)
}

fn feed_card(row: &Row<'_>) -> rusqlite::Result<NormalizedFeedCardV1> {
    Ok(NormalizedFeedCardV1 {
        archived: optional_boolean(row, "archived")?,
        author_avatar_url: row.get("authorAvatarUrl")?,
        author_display_name: row.get("authorDisplayName")?,
        author_handle: row.get("authorHandle")?,
        author_id: row.get("authorId")?,
        captured_at: row.get("capturedAt")?,
        content_signal_tags: string_array(row, "contentSignalTagsJson", 32, 256)?,
        content_text: row.get("contentText")?,
        content_type: row.get("contentType")?,
        engagement_comments: row.get("engagementComments")?,
        engagement_likes: row.get("engagementLikes")?,
        event_confidence_basis_points: row.get("eventConfidenceBasisPoints")?,
        event_starts_at: row.get("eventStartsAt")?,
        global_id: row.get("globalId")?,
        liked: optional_boolean(row, "liked")?,
        liked_at: row.get("likedAt")?,
        liked_synced_at: row.get("likedSyncedAt")?,
        link_preview_title: row.get("linkPreviewTitle")?,
        location_name: row.get("locationName")?,
        media_types: string_array(row, "mediaTypesJson", 8, 64)?,
        media_urls: string_array(row, "mediaUrlsJson", 8, 8_192)?,
        platform: row.get("platform")?,
        published_at: row.get("publishedAt")?,
        read_at: row.get("readAt")?,
        reading_time_minutes: row.get("readingTimeMinutes")?,
        saved: optional_boolean(row, "saved")?,
        source_url: row.get("sourceUrl")?,
        tags: string_array(row, "tagsJson", 32, 1_024)?,
    })
}

fn background_item_row(row: &Row<'_>) -> rusqlite::Result<NormalizedItemScanRowV1> {
    let hidden = optional_boolean(row, "hidden")?.ok_or(rusqlite::Error::InvalidQuery)?;
    let rss_feed_url: Option<String> = row.get("rssFeedUrl")?;
    let rss_source = match rss_feed_url {
        Some(feed_url) => Some(NormalizedItemScanRssSourceV1 {
            feed_title: row.get("rssFeedTitle")?,
            feed_url,
            site_url: row.get("rssSiteUrl")?,
        }),
        None => None,
    };
    let sample_batch_id: Option<String> = row.get("sampleBatchId")?;
    let sample_generated_at: Option<i64> = row.get("sampleGeneratedAt")?;
    let sample_generator_version: Option<i64> = row.get("sampleGeneratorVersion")?;
    let sample_data_fingerprint = match (
        sample_batch_id,
        sample_generated_at,
        sample_generator_version,
    ) {
        (None, None, None) => None,
        (Some(batch_id), Some(generated_at), Some(generator_version))
            if !batch_id.is_empty()
                && valid_safe_integer(generated_at)
                && generated_at >= 0
                && valid_safe_integer(generator_version)
                && generator_version >= 1 =>
        {
            Some(NormalizedItemScanSampleFingerprintV1 {
                batch_id,
                generated_at,
                generator_version,
                marker: "freed.sample-data.v1".to_owned(),
            })
        }
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(NormalizedItemScanRowV1 {
        card: feed_card(row)?,
        hidden,
        rss_source,
        sample_data_fingerprint,
    })
}

fn content_fetch_row(row: &Row<'_>) -> rusqlite::Result<NormalizedContentFetchCandidateV1> {
    Ok(NormalizedContentFetchCandidateV1 {
        captured_at: row.get("capturedAt")?,
        global_id: row.get("globalId")?,
        link_url: row.get("linkUrl")?,
        published_at: row.get("publishedAt")?,
    })
}

fn search_fields(row: &Row<'_>) -> rusqlite::Result<Vec<(String, f64)>> {
    let optional = |name: &str| -> rusqlite::Result<String> {
        Ok(row.get::<_, Option<String>>(name)?.unwrap_or_default())
    };
    let joined = |name: &str, maximum: usize| -> rusqlite::Result<String> {
        Ok(string_array(row, name, maximum, 2_048)?.join(" "))
    };
    let mut fields = Vec::new();
    let base_limit = SEARCH_MAXIMUM_DOCUMENT_TERMS - SEARCH_MAXIMUM_ALIAS_TERMS;
    collect_search_field(&optional("linkPreviewTitle")?, 4.0, base_limit, &mut fields);
    collect_search_field(
        &format!(
            "{} {}",
            joined("searchTopicsJson", 64)?,
            joined("contentSignalTagsJson", 32)?
        ),
        3.0,
        base_limit,
        &mut fields,
    );
    collect_search_field(
        &[
            optional("searchEventTitle")?,
            optional("searchEventLocation")?,
            optional("searchEventEvidence")?,
            optional("locationName")?,
        ]
        .join(" "),
        3.0,
        base_limit,
        &mut fields,
    );
    collect_search_field(&joined("tagsJson", 32)?, 3.0, base_limit, &mut fields);
    for name in ["authorDisplayName", "authorHandle", "authorId"] {
        collect_search_field(&optional(name)?, 3.0, base_limit, &mut fields);
    }
    for name in [
        "searchContentText",
        "searchLinkDescription",
        "searchRssFeedTitle",
    ] {
        collect_search_field(&optional(name)?, 2.0, base_limit, &mut fields);
    }
    collect_search_field(
        &joined("searchHighlightsJson", 8)?,
        2.0,
        base_limit,
        &mut fields,
    );
    collect_search_field(
        &optional("searchPreservedText")?,
        1.0,
        base_limit,
        &mut fields,
    );
    collect_search_field(
        &optional("searchAccountAliases")?,
        3.0,
        SEARCH_MAXIMUM_DOCUMENT_TERMS,
        &mut fields,
    );
    Ok(fields)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchDigestInput<'a> {
    filter: &'a NormalizedFeedBrowseFilterV1,
    identity_mode: &'a str,
    query: &'a str,
}

fn search_request_digest(
    request: &NormalizedSearchPageRequestV1,
) -> Result<String, NormalizedSqliteError> {
    let bytes = serde_json::to_vec(&SearchDigestInput {
        filter: &request.filter,
        identity_mode: &request.identity_mode,
        query: &request.query,
    })
    .map_err(|_| invalid("normalized search binding is invalid"))?;
    Ok(lower_hex(&Sha256::digest(bytes)))
}

fn query_source(connection: &Connection) -> Result<(String, i64), NormalizedSqliteError> {
    let source: (String, i64, i64) = connection.query_row(
        "SELECT generation.generation_id, meta.source_revision, changes.revision
         FROM library_materialization_generation AS generation
         JOIN library_meta AS meta ON meta.singleton_id = generation.singleton_id
         JOIN library_change_state AS changes ON changes.singleton_id = generation.singleton_id
         WHERE generation.singleton_id = 1;",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if !valid_lower_hex_64(&source.0) || !valid_safe_integer(source.1) || source.1 != source.2 {
        return Err(invalid("normalized query source identity is invalid"));
    }
    Ok((source.0, source.1))
}

fn query_graph_layout_revision(connection: &Connection) -> Result<i64, NormalizedSqliteError> {
    let revision = connection.query_row(
        "SELECT revision FROM library_device_graph_layout_state WHERE singleton_id = 1;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if !valid_safe_integer(revision) {
        return Err(invalid("device graph layout revision is invalid"));
    }
    Ok(revision)
}

fn query_feed_page(
    connection: &mut Connection,
    request: NormalizedFeedPageRequestV1,
) -> Result<NormalizedFeedPageResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=FEED_PAGE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized feed query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "feed_page_v1")
        .ok_or(invalid("normalized feed query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
    }) {
        return Err(invalid("normalized feed query cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mut rows = statement.query_map(
        params![
            cursor.as_ref().map(|cursor| cursor.sort_at),
            cursor
                .as_ref()
                .map(|cursor| cursor.global_id.as_str())
                .unwrap_or(""),
            i64::try_from(request.limit + 1).expect("bounded feed limit"),
        ],
        feed_card,
    )?;
    let mut cards = Vec::with_capacity(request.limit + 1);
    for row in rows.by_ref() {
        cards.push(row?);
        if cards.len() > program.maximum_scan_rows {
            return Err(invalid("normalized feed query exceeded its row bound"));
        }
    }
    drop(rows);
    drop(statement);
    let has_more = cards.len() > request.limit;
    cards.truncate(request.limit);
    let next_cursor = if has_more {
        let last = cards
            .last()
            .ok_or(invalid("normalized feed query cursor row is missing"))?;
        Some(encode_cursor(&FeedPageCursorV1 {
            generation_id: generation_id.clone(),
            transition_sequence: source_revision,
            projection_revision: source_revision,
            sort_at: last
                .published_at
                .ok_or(invalid("normalized feed query sort time is missing"))?,
            global_id: last.global_id.clone(),
        })?)
    } else {
        None
    };
    let total_count: i64 = transaction.query_row(program.count_sql, [], |row| row.get(0))?;
    let response = NormalizedFeedPageResponseV1 {
        next_cursor,
        query_id: "feed_page_v1".to_owned(),
        rows: cards,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
        total_count,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized feed query response is invalid"))?
        .len()
        > FEED_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized feed query response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

const FEED_BROWSE_SIGNAL_IDS: &[&str] = &[
    "alert",
    "announcement",
    "deal",
    "deadline",
    "discussion",
    "essay",
    "event",
    "how_to",
    "life_update",
    "media",
    "moment",
    "news",
    "opportunity",
    "place",
    "product_update",
    "promotion",
    "recommendation",
    "reference",
    "request",
    "transaction",
];

fn valid_feed_browse_text(value: &str) -> bool {
    value.len() <= 8_192 && value.chars().count() <= 2_048
}

fn valid_canonical_filter_set(values: &[String], allowed: Option<&[&str]>) -> bool {
    values.len() <= 32
        && values.iter().all(|value| {
            valid_feed_browse_text(value)
                && allowed.is_none_or(|allowed| allowed.contains(&value.as_str()))
        })
        && values
            .windows(2)
            .all(|pair| pair[0].encode_utf16().cmp(pair[1].encode_utf16()).is_lt())
}

fn valid_feed_browse_filter(filter: &NormalizedFeedBrowseFilterV1) -> bool {
    filter.schema_version == 1
        && [
            filter.author_id.as_deref(),
            filter.feed_url.as_deref(),
            filter.platform.as_deref(),
        ]
        .into_iter()
        .flatten()
        .all(valid_feed_browse_text)
        && matches!(
            filter.social_content_filter.as_str(),
            "all" | "posts" | "stories"
        )
        && valid_canonical_filter_set(&filter.tags, None)
        && valid_canonical_filter_set(&filter.signals, Some(FEED_BROWSE_SIGNAL_IDS))
}

fn feed_browse_filter_digest(
    filter: &NormalizedFeedBrowseFilterV1,
) -> Result<String, NormalizedSqliteError> {
    let bytes = serde_json::to_vec(&(
        filter.schema_version,
        filter.archived_only,
        &filter.author_id,
        &filter.feed_url,
        &filter.platform,
        filter.saved_only,
        filter.show_hidden,
        &filter.signals,
        &filter.social_content_filter,
        &filter.tags,
    ))
    .map_err(|_| invalid("normalized browse filter is invalid"))?;
    Ok(lower_hex(&Sha256::digest(bytes)))
}

fn feed_browse_binding_digest(
    filter: &NormalizedFeedBrowseFilterV1,
    identity_mode: &str,
) -> Result<String, NormalizedSqliteError> {
    if !matches!(identity_mode, "all_content" | "friends") {
        return Err(invalid("normalized browse identity mode is invalid"));
    }
    let bytes = serde_json::to_vec(&(1, identity_mode, feed_browse_filter_digest(filter)?))
        .map_err(|_| invalid("normalized browse binding is invalid"))?;
    Ok(lower_hex(&Sha256::digest(bytes)))
}

fn query_feed_browse_page(
    connection: &mut Connection,
    request: NormalizedFeedBrowsePageRequestV3,
) -> Result<NormalizedFeedBrowsePageResponseV3, NormalizedSqliteError> {
    if request.schema_version != 3
        || request.friends_predicate_schema_version != 1
        || !matches!(request.identity_mode.as_str(), "all_content" | "friends")
        || request.recommendation_order_schema_version != 1
        || !valid_safe_integer(request.ranking_clock_ms)
        || !(1..=FEED_PAGE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
        || !matches!(request.direction.as_str(), "next" | "previous")
        || (request.direction == "previous" && request.cursor.is_none())
        || !valid_feed_browse_filter(&request.filter)
    {
        return Err(invalid("normalized browse query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "feed_browse_page_v3")
        .ok_or(invalid("normalized browse query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let filter_digest = feed_browse_binding_digest(&request.filter, &request.identity_mode)?;
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_feed_browse_cursor)
        .transpose()?;
    if cursor
        .as_ref()
        .is_some_and(|cursor| cursor.filter_digest != filter_digest)
    {
        return Err(invalid(
            "normalized browse query cursor belongs to a different filter",
        ));
    }
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
    }) {
        return Err(invalid("normalized browse query cursor is stale"));
    }
    let tags_json = serde_json::to_string(&request.filter.tags)
        .map_err(|_| invalid("normalized browse tags are invalid"))?;
    let signals_json = serde_json::to_string(&request.filter.signals)
        .map_err(|_| invalid("normalized browse signals are invalid"))?;
    let query_sql = if request.direction == "previous" {
        program
            .reverse_sql
            .ok_or(invalid("normalized browse reverse query is missing"))?
    } else {
        program.sql
    };
    let mut statement = transaction.prepare(query_sql)?;
    let mut query_rows = statement.query_map(
        params![
            i64::from(request.filter.archived_only),
            i64::from(request.filter.show_hidden),
            request.filter.platform.as_deref(),
            request.filter.author_id.as_deref(),
            request.filter.feed_url.as_deref(),
            request.filter.social_content_filter,
            i64::from(request.filter.saved_only),
            tags_json,
            signals_json,
            request.identity_mode.as_str(),
            cursor.as_ref().map(|cursor| cursor.priority),
            cursor.as_ref().map(|cursor| cursor.published_at),
            cursor
                .as_ref()
                .map(|cursor| cursor.global_id.as_str())
                .unwrap_or(""),
            i64::try_from(request.limit + 1).expect("bounded browse limit"),
        ],
        |row| Ok((feed_card(row)?, row.get::<_, i64>("browsePriority")?)),
    )?;
    let mut selected = Vec::with_capacity(request.limit + 1);
    for row in query_rows.by_ref() {
        let row = row?;
        if !(0..=100).contains(&row.1) {
            return Err(invalid("normalized browse priority is invalid"));
        }
        selected.push(row);
        if selected.len() > program.maximum_scan_rows {
            return Err(invalid("normalized browse query exceeded its row bound"));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more_in_direction = selected.len() > request.limit;
    selected.truncate(request.limit);
    if request.direction == "previous" {
        selected.reverse();
    }
    let make_edge = |row: &(NormalizedFeedCardV1, i64)| {
        let published_at = row
            .0
            .published_at
            .ok_or(invalid("normalized browse sort time is missing"))?;
        let order = NormalizedFeedBrowseEdgeOrderV3 {
            global_id: row.0.global_id.clone(),
            priority: row.1,
            published_at,
        };
        let cursor = encode_feed_browse_cursor(&FeedBrowseCursorV2 {
            filter_digest: filter_digest.clone(),
            generation_id: generation_id.clone(),
            transition_sequence: source_revision,
            projection_revision: source_revision,
            priority: row.1,
            published_at,
            global_id: row.0.global_id.clone(),
        })?;
        Ok::<_, NormalizedSqliteError>((cursor, order))
    };
    let next_available = if request.direction == "next" {
        has_more_in_direction
    } else {
        !selected.is_empty()
    };
    let previous_available = if request.direction == "previous" {
        has_more_in_direction
    } else {
        request.cursor.is_some() && !selected.is_empty()
    };
    let next = if next_available {
        selected.last().map(make_edge).transpose()?
    } else {
        None
    };
    let previous = if previous_available {
        selected.first().map(make_edge).transpose()?
    } else {
        None
    };
    let total_count: i64 = transaction.query_row(
        program.count_sql,
        params![
            i64::from(request.filter.archived_only),
            i64::from(request.filter.show_hidden),
            request.filter.platform.as_deref(),
            request.filter.author_id.as_deref(),
            request.filter.feed_url.as_deref(),
            request.filter.social_content_filter,
            i64::from(request.filter.saved_only),
            serde_json::to_string(&request.filter.tags)
                .map_err(|_| invalid("normalized browse tags are invalid"))?,
            serde_json::to_string(&request.filter.signals)
                .map_err(|_| invalid("normalized browse signals are invalid"))?,
            request.identity_mode.as_str(),
        ],
        |row| row.get(0),
    )?;
    if !valid_safe_integer(total_count) {
        return Err(invalid("normalized browse total count is invalid"));
    }
    let response = NormalizedFeedBrowsePageResponseV3 {
        filter: request.filter,
        friends_predicate_schema_version: request.friends_predicate_schema_version,
        identity_mode: request.identity_mode,
        next_cursor: next.as_ref().map(|edge| edge.0.clone()),
        next_order: next.map(|edge| edge.1),
        previous_cursor: previous.as_ref().map(|edge| edge.0.clone()),
        previous_order: previous.map(|edge| edge.1),
        query_id: "feed_browse_page_v3".to_owned(),
        ranking_clock_ms: request.ranking_clock_ms,
        recommendation_order_schema_version: 1,
        rows: selected.into_iter().map(|row| row.0).collect(),
        schema_version: 3,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
        total_count,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized browse response is invalid"))?
        .len()
        > FEED_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid("normalized browse response exceeds its byte bound"));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_saved_feed_page(
    connection: &mut Connection,
    request: NormalizedSavedFeedPageRequestV2,
) -> Result<NormalizedSavedFeedPageResponseV2, NormalizedSqliteError> {
    if request.schema_version != 2
        || !(1..=FEED_PAGE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
        || !matches!(request.direction.as_str(), "next" | "previous")
        || (request.direction == "previous" && request.cursor.is_none())
        || saved_sort_mode_code(&request.sort_mode).is_none()
        || !valid_feed_browse_filter(&request.filter)
        || !request.filter.saved_only
        || request.filter.show_hidden
    {
        return Err(invalid("normalized saved query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "saved_feed_page_v2")
        .ok_or(invalid("normalized saved query program is missing"))?;
    let variant = program
        .variants
        .iter()
        .find(|variant| variant.variant_id == request.sort_mode)
        .ok_or(invalid("normalized saved query variant is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let filter_digest = feed_browse_filter_digest(&request.filter)?;
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_saved_feed_cursor)
        .transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.filter_digest != filter_digest || cursor.sort_mode != request.sort_mode
    }) {
        return Err(invalid(
            "normalized saved cursor belongs to different query inputs",
        ));
    }
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.generation_id != generation_id || cursor.source_revision != source_revision
    }) {
        return Err(invalid("normalized saved cursor is stale"));
    }
    let tags_json = serde_json::to_string(&request.filter.tags)
        .map_err(|_| invalid("normalized saved tags are invalid"))?;
    let signals_json = serde_json::to_string(&request.filter.signals)
        .map_err(|_| invalid("normalized saved signals are invalid"))?;
    let query_sql = if request.direction == "previous" {
        variant.reverse_sql
    } else {
        variant.sql
    };
    let mut statement = transaction.prepare(query_sql)?;
    let mut query_rows = statement.query_map(
        params![
            i64::from(request.filter.archived_only),
            request.filter.platform.as_deref(),
            request.filter.author_id.as_deref(),
            request.filter.feed_url.as_deref(),
            request.filter.social_content_filter,
            tags_json,
            signals_json,
            cursor.as_ref().map(|cursor| cursor.sort_group),
            cursor.as_ref().map(|cursor| cursor.sort_primary),
            cursor.as_ref().map(|cursor| cursor.sort_secondary),
            cursor
                .as_ref()
                .map(|cursor| cursor.global_id.as_str())
                .unwrap_or(""),
            i64::try_from(request.limit + 1).expect("bounded saved limit"),
        ],
        |row| {
            Ok((
                NormalizedSavedFeedCardV2 {
                    card: feed_card(row)?,
                    saved_at: row.get("savedAt")?,
                },
                row.get::<_, i64>("sortGroup")?,
                row.get::<_, i64>("sortPrimary")?,
                row.get::<_, i64>("sortSecondary")?,
            ))
        },
    )?;
    let mut selected = Vec::with_capacity(request.limit + 1);
    for row in query_rows.by_ref() {
        let row = row?;
        if !(0..=100).contains(&row.1)
            || !valid_safe_integer(row.2)
            || !valid_safe_integer(row.3)
            || row
                .0
                .saved_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row.0.card.saved != Some(true)
        {
            return Err(invalid("normalized saved query row is invalid"));
        }
        selected.push(row);
        if selected.len() > program.maximum_scan_rows {
            return Err(invalid("normalized saved query exceeded its row bound"));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more_in_direction = selected.len() > request.limit;
    selected.truncate(request.limit);
    if request.direction == "previous" {
        selected.reverse();
    }
    let make_edge = |row: &(NormalizedSavedFeedCardV2, i64, i64, i64)| {
        let order = NormalizedSavedFeedEdgeOrderV2 {
            global_id: row.0.card.global_id.clone(),
            sort_group: row.1,
            sort_primary: row.2,
            sort_secondary: row.3,
        };
        let cursor = encode_saved_feed_cursor(&SavedFeedCursorV2 {
            filter_digest: filter_digest.clone(),
            generation_id: generation_id.clone(),
            source_revision,
            sort_mode: request.sort_mode.clone(),
            sort_group: row.1,
            sort_primary: row.2,
            sort_secondary: row.3,
            global_id: row.0.card.global_id.clone(),
        })?;
        Ok::<_, NormalizedSqliteError>((cursor, order))
    };
    let next_available = if request.direction == "next" {
        has_more_in_direction
    } else {
        !selected.is_empty()
    };
    let previous_available = if request.direction == "previous" {
        has_more_in_direction
    } else {
        request.cursor.is_some() && !selected.is_empty()
    };
    let next = if next_available {
        selected.last().map(make_edge).transpose()?
    } else {
        None
    };
    let previous = if previous_available {
        selected.first().map(make_edge).transpose()?
    } else {
        None
    };
    let total_count: i64 = transaction.query_row(
        program.count_sql,
        params![
            i64::from(request.filter.archived_only),
            request.filter.platform.as_deref(),
            request.filter.author_id.as_deref(),
            request.filter.feed_url.as_deref(),
            request.filter.social_content_filter,
            serde_json::to_string(&request.filter.tags)
                .map_err(|_| invalid("normalized saved tags are invalid"))?,
            serde_json::to_string(&request.filter.signals)
                .map_err(|_| invalid("normalized saved signals are invalid"))?,
        ],
        |row| row.get(0),
    )?;
    if !valid_safe_integer(total_count) {
        return Err(invalid("normalized saved total count is invalid"));
    }
    let response = NormalizedSavedFeedPageResponseV2 {
        filter: request.filter,
        next_cursor: next.as_ref().map(|edge| edge.0.clone()),
        next_order: next.map(|edge| edge.1),
        previous_cursor: previous.as_ref().map(|edge| edge.0.clone()),
        previous_order: previous.map(|edge| edge.1),
        query_id: "saved_feed_page_v2".to_owned(),
        rows: selected.into_iter().map(|row| row.0).collect(),
        schema_version: 2,
        sort_mode: request.sort_mode,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
        total_count,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized saved response is invalid"))?
        .len()
        > FEED_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid("normalized saved response exceeds its byte bound"));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_search_page(
    connection: &mut Connection,
    request: NormalizedSearchPageRequestV1,
) -> Result<NormalizedSearchPageResponseV1, NormalizedSqliteError> {
    let query_terms = search_terms(&request.query, SEARCH_MAXIMUM_QUERY_TERMS);
    if request.schema_version != 1
        || request.friends_predicate_schema_version != 1
        || request.recommendation_order_schema_version != 1
        || !matches!(request.identity_mode.as_str(), "all_content" | "friends")
        || !(1..=SEARCH_MAXIMUM_LIMIT).contains(&request.limit)
        || request.query.len() > SEARCH_MAXIMUM_QUERY_BYTES
        || query_terms.is_empty()
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
        || !valid_feed_browse_filter(&request.filter)
    {
        return Err(invalid("normalized search query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "search_page_v1")
        .ok_or(invalid("normalized search query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let search_digest = search_request_digest(&request)?;
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_search_cursor)
        .transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.search_digest != search_digest
            || cursor.page.generation_id != generation_id
            || cursor.page.transition_sequence != source_revision
            || cursor.page.projection_revision != source_revision
    }) {
        return Err(invalid("normalized search cursor is stale or mismatched"));
    }
    let tags_json = serde_json::to_string(&request.filter.tags)
        .map_err(|_| invalid("normalized search tags are invalid"))?;
    let signals_json = serde_json::to_string(&request.filter.signals)
        .map_err(|_| invalid("normalized search signals are invalid"))?;
    let mut statement = transaction.prepare(program.sql)?;
    let mut query_rows = statement.query_map(
        params![
            i64::from(request.filter.archived_only),
            i64::from(request.filter.show_hidden),
            request.filter.platform.as_deref(),
            request.filter.author_id.as_deref(),
            request.filter.feed_url.as_deref(),
            request.filter.social_content_filter,
            i64::from(request.filter.saved_only),
            tags_json,
            signals_json,
            request.identity_mode,
            cursor
                .as_ref()
                .map(|cursor| cursor.page.global_id.as_str())
                .unwrap_or(""),
            i64::try_from(SEARCH_MAXIMUM_SCAN_ROWS).expect("bounded search scan"),
        ],
        |row| {
            let card = feed_card(row)?;
            let priority = row.get::<_, i64>("searchPriority")?;
            let fields = search_fields(row)?;
            Ok((card, priority, fields))
        },
    )?;
    let mut scanned_rows = 0_usize;
    let mut last_scanned_global_id = None;
    let mut matches = Vec::new();
    for row in query_rows.by_ref() {
        let (card, priority, fields) = row?;
        scanned_rows += 1;
        if scanned_rows > program.maximum_scan_rows || !(0..=100).contains(&priority) {
            return Err(invalid("normalized search scan row is invalid"));
        }
        last_scanned_global_id = Some(card.global_id.clone());
        let score = score_search_fields(&fields, &query_terms);
        if score > 0.0 {
            matches.push(NormalizedSearchPageRowV1 {
                card,
                priority,
                score,
            });
            if matches.len() == request.limit {
                break;
            }
        }
    }
    drop(query_rows);
    drop(statement);
    let next_cursor = if matches.len() == request.limit || scanned_rows == SEARCH_MAXIMUM_SCAN_ROWS
    {
        last_scanned_global_id
            .map(|global_id| {
                encode_search_cursor(&SearchPageCursorV1 {
                    page: FeedPageCursorV1 {
                        generation_id: generation_id.clone(),
                        transition_sequence: source_revision,
                        projection_revision: source_revision,
                        sort_at: 0,
                        global_id,
                    },
                    search_digest: search_digest.clone(),
                })
            })
            .transpose()?
    } else {
        None
    };
    let response = NormalizedSearchPageResponseV1 {
        next_cursor,
        query_id: "search_page_v1".to_owned(),
        rows: matches,
        scanned_rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized search response is invalid"))?
        .len()
        > SEARCH_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid("normalized search response exceeds its byte bound"));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_person_timeline(
    connection: &mut Connection,
    request: NormalizedPersonTimelineRequestV1,
) -> Result<NormalizedPersonTimelineResponseV1, NormalizedSqliteError> {
    query_identity_timeline(
        connection,
        request.person_id,
        request.cancellation_id,
        request.cursor,
        request.limit,
        request.reader_session_id,
        request.schema_version,
        "person_timeline_v1",
    )
}

fn query_account_timeline(
    connection: &mut Connection,
    request: NormalizedAccountTimelineRequestV1,
) -> Result<NormalizedPersonTimelineResponseV1, NormalizedSqliteError> {
    query_identity_timeline(
        connection,
        request.account_id,
        request.cancellation_id,
        request.cursor,
        request.limit,
        request.reader_session_id,
        request.schema_version,
        "account_timeline_v1",
    )
}

#[allow(clippy::too_many_arguments)]
fn query_identity_timeline(
    connection: &mut Connection,
    identity_id: String,
    cancellation_id: String,
    cursor_value: Option<String>,
    limit: usize,
    reader_session_id: String,
    schema_version: u32,
    query_id: &'static str,
) -> Result<NormalizedPersonTimelineResponseV1, NormalizedSqliteError> {
    if schema_version != 1
        || !(1..=PERSON_TIMELINE_MAXIMUM_LIMIT).contains(&limit)
        || !valid_operation_instance_id(&cancellation_id)
        || !valid_operation_instance_id(&reader_session_id)
        || identity_id.is_empty()
        || identity_id.len() > 4_096
    {
        return Err(invalid("normalized identity timeline query is invalid"));
    }
    let person_digest = lower_hex(&Sha256::digest(identity_id.as_bytes()));
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == query_id)
        .ok_or(invalid("normalized identity timeline program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let cursor = cursor_value
        .as_deref()
        .map(decode_person_timeline_cursor)
        .transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.person_digest != person_digest
            || cursor.page.generation_id != generation_id
            || cursor.page.transition_sequence != source_revision
            || cursor.page.projection_revision != source_revision
    }) {
        return Err(invalid("normalized identity timeline cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mut query_rows = statement.query_map(
        params![
            identity_id,
            cursor.as_ref().map(|cursor| cursor.page.sort_at),
            cursor
                .as_ref()
                .map(|cursor| cursor.page.global_id.as_str())
                .unwrap_or(""),
            i64::try_from(limit + 1).expect("bounded identity timeline limit"),
        ],
        feed_card,
    )?;
    let mut cards = Vec::with_capacity(limit + 1);
    for row in query_rows.by_ref() {
        cards.push(row?);
        if cards.len() > program.maximum_scan_rows {
            return Err(invalid(
                "normalized identity timeline exceeded its row bound",
            ));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more = cards.len() > limit;
    cards.truncate(limit);
    let next_cursor = if has_more {
        let last = cards.last().ok_or(invalid(
            "normalized identity timeline cursor row is missing",
        ))?;
        Some(encode_person_timeline_cursor(&PersonTimelineCursorV1 {
            page: FeedPageCursorV1 {
                generation_id: generation_id.clone(),
                transition_sequence: source_revision,
                projection_revision: source_revision,
                sort_at: last
                    .published_at
                    .ok_or(invalid("normalized identity timeline sort time is missing"))?,
                global_id: last.global_id.clone(),
            },
            person_digest,
        })?)
    } else {
        None
    };
    let total_count: i64 =
        transaction.query_row(program.count_sql, params![identity_id], |row| row.get(0))?;
    let response = NormalizedPersonTimelineResponseV1 {
        next_cursor,
        query_id: query_id.to_owned(),
        rows: cards,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
        total_count,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized identity timeline response is invalid"))?
        .len()
        > PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized identity timeline response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_map_markers(
    connection: &mut Connection,
    request: NormalizedMapMarkersRequestV1,
) -> Result<NormalizedMapMarkersResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=MAP_MARKERS_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized map query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "map_markers_v1")
        .ok_or(invalid("normalized map query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let mut query_rows = statement.query_map(
        params![i64::try_from(request.limit + 1).expect("bounded map limit")],
        |row| {
            Ok(NormalizedMapMarkerV1 {
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
                content_text: row.get(10)?,
                location_name: row.get(11)?,
                location_lat: row.get(12)?,
                location_lng: row.get(13)?,
                location_url: row.get(14)?,
                time_range_starts_at: row.get(15)?,
                time_range_ends_at: row.get(16)?,
            })
        },
    )?;
    let mut rows = Vec::with_capacity(request.limit);
    for row in query_rows.by_ref() {
        let row = row?;
        let coordinates_valid = match (row.location_lat, row.location_lng) {
            (Some(lat), Some(lng)) => {
                lat.is_finite()
                    && (-90.0..=90.0).contains(&lat)
                    && lng.is_finite()
                    && (-180.0..=180.0).contains(&lng)
            }
            (None, None) => row.location_name.is_some(),
            _ => false,
        };
        if row.global_id.is_empty()
            || row.global_id.len() > 4_096
            || !valid_platform(&row.platform)
            || !valid_content_type(&row.content_type)
            || row.author_id.len() > 4_096
            || row.author_handle.len() > 1_024
            || row.author_display_name.len() > 2_048
            || row
                .author_avatar_url
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || row
                .content_text
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || row
                .source_url
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || row
                .location_name
                .as_ref()
                .is_some_and(|value| value.len() > 2_048)
            || row
                .location_url
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || !valid_safe_integer(row.published_at)
            || !valid_safe_integer(row.captured_at)
            || row
                .time_range_starts_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .time_range_ends_at
                .is_some_and(|value| !valid_safe_integer(value))
            || !coordinates_valid
        {
            return Err(invalid("normalized map row is invalid"));
        }
        rows.push(row);
        if rows.len() > program.maximum_scan_rows {
            return Err(invalid("normalized map query exceeded its row bound"));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    let response = NormalizedMapMarkersResponseV1 {
        has_more,
        query_id: "map_markers_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized map response is invalid"))?
        .len()
        > SECONDARY_SURFACE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid("normalized map response exceeds its byte bound"));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_story_wall_candidates(
    connection: &mut Connection,
    request: NormalizedStoryWallCandidatesRequestV1,
) -> Result<NormalizedStoryWallCandidatesResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=STORY_WALL_CANDIDATES_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized Story Wall query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "story_wall_candidates_v1")
        .ok_or(invalid("normalized Story Wall query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let mut query_rows = statement.query_map(
        params![i64::try_from(request.limit + 1).expect("bounded Story Wall limit")],
        |row| {
            let media_urls_json: String = row.get(10)?;
            let media_types_json: String = row.get(11)?;
            Ok(NormalizedStoryWallCandidateV1 {
                global_id: row.get(0)?,
                platform: row.get(1)?,
                published_at: row.get(2)?,
                captured_at: row.get(3)?,
                author_id: row.get(4)?,
                author_display_name: row.get(5)?,
                author_handle: row.get(6)?,
                source_url: row.get(7)?,
                content_text: row.get(8)?,
                location_name: row.get(9)?,
                media_urls: serde_json::from_str(&media_urls_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        10,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                media_types: serde_json::from_str(&media_types_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        11,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
            })
        },
    )?;
    let mut rows = Vec::with_capacity(request.limit);
    for row in query_rows.by_ref() {
        let row = row?;
        if row.global_id.is_empty()
            || row.global_id.len() > 4_096
            || !valid_platform(&row.platform)
            || row.author_id.len() > 4_096
            || row.author_handle.len() > 1_024
            || row.author_display_name.len() > 2_048
            || row
                .content_text
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || row
                .source_url
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || row
                .location_name
                .as_ref()
                .is_some_and(|value| value.len() > 2_048)
            || !valid_safe_integer(row.published_at)
            || !valid_safe_integer(row.captured_at)
            || row.media_urls.is_empty()
            || row.media_urls.len() > 8
            || row.media_types.len() != row.media_urls.len()
            || row.media_urls.iter().any(|value| value.len() > 8_192)
            || row.media_types.iter().any(|value| !valid_media_type(value))
        {
            return Err(invalid("normalized Story Wall row is invalid"));
        }
        rows.push(row);
        if rows.len() > program.maximum_scan_rows {
            return Err(invalid(
                "normalized Story Wall query exceeded its row bound",
            ));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    let response = NormalizedStoryWallCandidatesResponseV1 {
        has_more,
        query_id: "story_wall_candidates_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized Story Wall response is invalid"))?
        .len()
        > SECONDARY_SURFACE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized Story Wall response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_item_scan(
    connection: &mut Connection,
    request: NormalizedItemScanRequestV1,
) -> Result<NormalizedItemScanResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=ITEM_SCAN_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized item scan identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "background_item_page_v1")
        .ok_or(invalid("normalized item scan program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.sort_at != 0
            || cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
    }) {
        return Err(invalid("normalized item scan cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mut rows = statement.query_map(
        params![
            cursor.as_ref().map(|cursor| cursor.global_id.as_str()),
            i64::try_from(request.limit + 1).expect("bounded item scan limit"),
        ],
        background_item_row,
    )?;
    let mut cards = Vec::with_capacity(request.limit + 1);
    for row in rows.by_ref() {
        cards.push(row?);
        if cards.len() > program.maximum_scan_rows {
            return Err(invalid("normalized item scan exceeded its row bound"));
        }
    }
    drop(rows);
    drop(statement);
    let has_more = cards.len() > request.limit;
    cards.truncate(request.limit);
    let next_cursor = if has_more {
        let last = cards
            .last()
            .ok_or(invalid("normalized item scan cursor row is missing"))?;
        Some(encode_cursor(&FeedPageCursorV1 {
            generation_id: generation_id.clone(),
            transition_sequence: source_revision,
            projection_revision: source_revision,
            sort_at: 0,
            global_id: last.card.global_id.clone(),
        })?)
    } else {
        None
    };
    let response = NormalizedItemScanResponseV1 {
        next_cursor,
        query_id: "background_item_page_v1".to_owned(),
        rows: cards,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized item scan response is invalid"))?
        .len()
        > ITEM_SCAN_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized item scan response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn content_fetch_binding_digest() -> String {
    lower_hex(&Sha256::digest(
        br#"{"queryId":"content_fetch_claim_v1","schemaVersion":1}"#,
    ))
}

fn query_content_fetch_page(
    connection: &mut Connection,
    request: NormalizedContentFetchPageRequestV1,
) -> Result<NormalizedContentFetchPageResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=CONTENT_FETCH_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized content fetch identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "content_fetch_claim_v1")
        .ok_or(invalid("normalized content fetch program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_feed_browse_cursor)
        .transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.filter_digest != content_fetch_binding_digest()
            || cursor.priority != 0
            || cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
    }) {
        return Err(invalid("normalized content fetch cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mut query_rows = statement.query_map(
        params![
            cursor.as_ref().map(|value| value.published_at),
            cursor
                .as_ref()
                .map(|value| value.global_id.as_str())
                .unwrap_or(""),
            i64::try_from(request.limit + 1).expect("bounded content fetch limit"),
        ],
        content_fetch_row,
    )?;
    let mut rows = Vec::with_capacity(request.limit + 1);
    for row in query_rows.by_ref() {
        let row = row?;
        if !valid_safe_integer(row.captured_at)
            || !valid_safe_integer(row.published_at)
            || row.global_id.is_empty()
            || row.global_id.len() > 4_096
            || row.link_url.is_empty()
            || row.link_url.len() > 8_192
        {
            return Err(invalid("normalized content fetch row is invalid"));
        }
        rows.push(row);
        if rows.len() > program.maximum_scan_rows {
            return Err(invalid("normalized content fetch exceeded its row bound"));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    let next_cursor = if has_more {
        let last = rows
            .last()
            .ok_or(invalid("normalized content fetch cursor row is missing"))?;
        Some(encode_feed_browse_cursor(&FeedBrowseCursorV2 {
            filter_digest: content_fetch_binding_digest(),
            generation_id: generation_id.clone(),
            transition_sequence: source_revision,
            projection_revision: source_revision,
            priority: 0,
            published_at: last.published_at,
            global_id: last.global_id.clone(),
        })?)
    } else {
        None
    };
    let response = NormalizedContentFetchPageResponseV1 {
        next_cursor,
        query_id: "content_fetch_claim_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized content fetch response is invalid"))?
        .len()
        > CONTENT_FETCH_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized content fetch response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn provider_media_binding_digest(provider: &str, saved_only: bool) -> String {
    let input =
        format!(r#"{{"provider":"{provider}","savedOnly":{saved_only},"schemaVersion":1}}"#);
    lower_hex(&Sha256::digest(input.as_bytes()))
}

fn query_provider_media_page(
    connection: &mut Connection,
    request: NormalizedProviderMediaPageRequestV1,
) -> Result<NormalizedProviderMediaPageResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=PROVIDER_MEDIA_MAXIMUM_LIMIT).contains(&request.limit)
        || !matches!(
            request.provider.as_str(),
            "facebook" | "instagram" | "youtube"
        )
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid(
            "normalized provider media query identity is invalid",
        ));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "provider_media_page_v1")
        .ok_or(invalid(
            "normalized provider media query program is missing",
        ))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let filter_digest = provider_media_binding_digest(&request.provider, request.saved_only);
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_feed_browse_cursor)
        .transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.filter_digest != filter_digest
            || cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
            || cursor.priority != 0
            || cursor.published_at != 0
    }) {
        return Err(invalid("normalized provider media cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mut query_rows = statement.query_map(
        params![
            request.provider,
            i64::from(request.saved_only),
            cursor.as_ref().map(|cursor| cursor.global_id.as_str()),
            i64::try_from(request.limit + 1).expect("bounded provider media limit"),
        ],
        |row| {
            let card = feed_card(row)?;
            let group_id: Option<String> = row.get("fbGroupId")?;
            let group_name: Option<String> = row.get("fbGroupName")?;
            let group_url: Option<String> = row.get("fbGroupUrl")?;
            let fb_group = group_id.map(|id| NormalizedProviderMediaGroupV1 {
                id,
                name: group_name.unwrap_or_default(),
                url: group_url.unwrap_or_default(),
            });
            Ok(NormalizedProviderMediaRowV1 {
                card,
                fb_group,
                link_url: row.get("linkUrl")?,
            })
        },
    )?;
    let mut rows = Vec::with_capacity(request.limit + 1);
    for row in query_rows.by_ref() {
        let row = row?;
        if (row.card.platform.as_deref() != Some(request.provider.as_str())
            && !(request.provider == "youtube"
                && request.saved_only
                && row.card.saved == Some(true)))
            || request.saved_only && row.card.saved != Some(true)
            || row
                .link_url
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || row.fb_group.as_ref().is_some_and(|group| {
                group.id.is_empty()
                    || group.id.len() > 4_096
                    || group.name.len() > 2_048
                    || group.url.len() > 8_192
            })
        {
            return Err(invalid("normalized provider media row is invalid"));
        }
        rows.push(row);
        if rows.len() > program.maximum_scan_rows {
            return Err(invalid(
                "normalized provider media query exceeded its row bound",
            ));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    let next_cursor = if has_more {
        let last = rows
            .last()
            .ok_or(invalid("normalized provider media cursor row is missing"))?;
        Some(encode_feed_browse_cursor(&FeedBrowseCursorV2 {
            filter_digest,
            generation_id: generation_id.clone(),
            transition_sequence: source_revision,
            projection_revision: source_revision,
            priority: 0,
            published_at: 0,
            global_id: last.card.global_id.clone(),
        })?)
    } else {
        None
    };
    let response = NormalizedProviderMediaPageResponseV1 {
        next_cursor,
        query_id: "provider_media_page_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized provider media response is invalid"))?
        .len()
        > PROVIDER_MEDIA_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized provider media response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn change_feed_row(row: &Row<'_>) -> rusqlite::Result<NormalizedChangeFeedRowV1> {
    let revision: i64 = row.get("revision")?;
    let ordinal: i64 = row.get("ordinal")?;
    let topic: String = row.get("topic")?;
    let entity_id: Option<String> = row.get("entityId")?;
    let reset_required =
        optional_boolean(row, "resetRequired")?.ok_or(rusqlite::Error::InvalidQuery)?;
    if !valid_safe_integer(revision)
        || revision < 1
        || !(0..=255).contains(&ordinal)
        || topic.is_empty()
        || topic.len() > 128
        || entity_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 2_048)
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(NormalizedChangeFeedRowV1 {
        entity_id,
        ordinal,
        reset_required,
        revision,
        topic,
    })
}

fn query_change_feed(
    connection: &mut Connection,
    request: NormalizedChangeFeedRequestV1,
) -> Result<NormalizedChangeFeedResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !valid_safe_integer(request.after_revision)
        || !(1..=CHANGE_FEED_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized change-feed identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "change_feed_v1")
        .ok_or(invalid("normalized change-feed program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, current_revision) = query_source(&transaction)?;
    let change_revision: i64 = transaction.query_row(program.count_sql, [], |row| row.get(0))?;
    if current_revision != change_revision {
        return Err(invalid("normalized change-feed revisions disagree"));
    }
    if request.after_revision > current_revision {
        return Err(invalid("normalized change-feed revision is ahead"));
    }
    let cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
    let (upper_revision, after_revision, after_ordinal) = if let Some(cursor) = &cursor {
        let ordinal = cursor
            .global_id
            .parse::<i64>()
            .ok()
            .filter(|value| (0..=255).contains(value))
            .ok_or(invalid("normalized change-feed cursor is invalid"))?;
        if cursor.generation_id != generation_id
            || cursor.projection_revision != request.after_revision
            || cursor.transition_sequence > current_revision
            || cursor.sort_at < request.after_revision
            || cursor.sort_at > cursor.transition_sequence
            || cursor.global_id != ordinal.to_string()
        {
            return Err(invalid("normalized change-feed cursor is stale"));
        }
        (cursor.transition_sequence, cursor.sort_at, ordinal)
    } else {
        (current_revision, request.after_revision, 255)
    };
    let mut statement = transaction.prepare(program.sql)?;
    let mut query_rows = statement.query_map(
        params![
            upper_revision,
            after_revision,
            after_ordinal,
            i64::try_from(request.limit + 1).expect("bounded change-feed limit"),
        ],
        change_feed_row,
    )?;
    let mut rows = Vec::with_capacity(request.limit + 1);
    for row in query_rows.by_ref() {
        rows.push(row?);
        if rows.len() > program.maximum_scan_rows {
            return Err(invalid("normalized change feed exceeded its row bound"));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    let mut previous_revision = after_revision;
    for row in &rows {
        if row.revision > previous_revision + 1 && !row.reset_required {
            return Err(invalid("normalized change feed has a revision gap"));
        }
        previous_revision = row.revision;
    }
    let last = rows.last();
    if !has_more
        && request.after_revision < upper_revision
        && last.map(|row| row.revision) != Some(upper_revision)
    {
        return Err(invalid("normalized change feed is incomplete"));
    }
    let next_cursor = if has_more {
        let last = last.ok_or(invalid("normalized change-feed cursor row is missing"))?;
        Some(encode_cursor(&FeedPageCursorV1 {
            generation_id: generation_id.clone(),
            transition_sequence: upper_revision,
            projection_revision: request.after_revision,
            sort_at: last.revision,
            global_id: last.ordinal.to_string(),
        })?)
    } else {
        None
    };
    let response = NormalizedChangeFeedResponseV1 {
        next_cursor,
        query_id: "change_feed_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: upper_revision,
            transition_sequence: upper_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized change-feed response is invalid"))?
        .len()
        > CHANGE_FEED_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized change-feed response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_filter_scope_summary(
    connection: &mut Connection,
    request: NormalizedFilterScopeSummaryRequestV1,
) -> Result<NormalizedFilterScopeSummaryResponseV1, NormalizedSqliteError> {
    let feed_mode = request
        .feed_url
        .as_ref()
        .is_some_and(|value| !value.is_empty() && value.len() <= 4_096)
        && request.author_id.is_none()
        && request.platform.is_none();
    let author_mode = request.feed_url.is_none()
        && request
            .author_id
            .as_ref()
            .is_some_and(|value| !value.is_empty() && value.len() <= 2_048)
        && request
            .platform
            .as_ref()
            .is_some_and(|value| !value.is_empty() && value.len() <= 256);
    if request.schema_version != 1 || (!feed_mode && !author_mode) {
        return Err(invalid(
            "normalized filter scope summary identity is invalid",
        ));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "filter_scope_summary_v1")
        .ok_or(invalid(
            "normalized filter scope summary program is missing",
        ))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let (label, item_count) = transaction.query_row(
        program.sql,
        params![request.feed_url, request.platform, request.author_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>("label")?,
                row.get::<_, i64>("itemCount")?,
            ))
        },
    )?;
    if !valid_safe_integer(item_count)
        || label
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 4_096)
    {
        return Err(invalid(
            "normalized filter scope summary response is invalid",
        ));
    }
    let response = NormalizedFilterScopeSummaryResponseV1 {
        item_count,
        label,
        query_id: "filter_scope_summary_v1".to_owned(),
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized filter scope summary response is invalid"))?
        .len()
        > 16 * 1_024
    {
        return Err(invalid(
            "normalized filter scope summary response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_facet_summary(
    connection: &mut Connection,
    request: NormalizedFacetSummaryRequestV1,
) -> Result<NormalizedFacetSummaryResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1 {
        return Err(invalid("normalized facet query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "library_facet_summary_v1")
        .ok_or(invalid("normalized facet query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let summary = transaction.query_row(program.sql, [], |row| {
        Ok(NormalizedFacetSummaryV1 {
            archived_count: row.get("archivedCount")?,
            archivable_count: row.get("archivableCount")?,
            enabled_rss_feed_count: row.get("enabledRssFeedCount")?,
            friend_person_count: row.get("friendPersonCount")?,
            platform_counts: decode_sqlite_json(&row.get::<_, String>("platformCountsJson")?)?,
            rss_feed_count: row.get("rssFeedCount")?,
            sample_account_count: row.get("sampleAccountCount")?,
            sample_feed_count: row.get("sampleFeedCount")?,
            sample_item_count: row.get("sampleItemCount")?,
            sample_person_count: row.get("samplePersonCount")?,
            saved_archived_count: row.get("savedArchivedCount")?,
            saved_count: row.get("savedCount")?,
            saved_platform_count: row.get("savedPlatformCount")?,
            social_account_count: row.get("socialAccountCount")?,
            tags: string_array(row, "tagsJson", 4_096, 1_024)?,
            total_count: row.get("totalCount")?,
            unread_count: row.get("unreadCount")?,
        })
    })?;
    let platform_totals = summary.platform_counts.iter().try_fold(
        (0_i64, 0_i64, 0_i64),
        |(total, unread, archivable), counts| {
            Some((
                total.checked_add(counts.total_count)?,
                unread.checked_add(counts.unread_count)?,
                archivable.checked_add(counts.archivable_count)?,
            ))
        },
    );
    if [
        summary.archived_count,
        summary.archivable_count,
        summary.enabled_rss_feed_count,
        summary.friend_person_count,
        summary.rss_feed_count,
        summary.sample_account_count,
        summary.sample_feed_count,
        summary.sample_item_count,
        summary.sample_person_count,
        summary.saved_archived_count,
        summary.saved_count,
        summary.saved_platform_count,
        summary.social_account_count,
        summary.total_count,
        summary.unread_count,
    ]
    .into_iter()
    .any(|value| !valid_safe_integer(value))
        || summary.archived_count > summary.total_count
        || summary.archivable_count > summary.total_count
        || summary.enabled_rss_feed_count > summary.rss_feed_count
        || summary.sample_item_count > summary.total_count
        || summary.saved_count > summary.total_count
        || summary.saved_archived_count > summary.saved_count.min(summary.archived_count)
        || summary.saved_platform_count > summary.saved_count
        || summary.platform_counts.len() > 64
        || summary
            .platform_counts
            .windows(2)
            .any(|counts| counts[0].platform.as_bytes() >= counts[1].platform.as_bytes())
        || summary.platform_counts.iter().any(|counts| {
            counts.platform.is_empty()
                || counts.platform.len() > 256
                || !valid_safe_integer(counts.total_count)
                || !valid_safe_integer(counts.unread_count)
                || !valid_safe_integer(counts.archivable_count)
                || counts.unread_count > counts.total_count
                || counts.archivable_count > counts.total_count
        })
        || platform_totals
            != Some((
                summary.total_count,
                summary.unread_count,
                summary.archivable_count,
            ))
        || summary.tags.windows(2).any(|tags| tags[0] >= tags[1])
    {
        return Err(invalid("normalized facet query response is invalid"));
    }
    let response = NormalizedFacetSummaryResponseV1 {
        query_id: "library_facet_summary_v1".to_owned(),
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
        summary,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized facet query response is invalid"))?
        .len()
        > FEED_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized facet query response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn valid_analytics_windows(
    windows: &[NormalizedSavedAnalyticsWindowV2],
    expected_count: usize,
) -> bool {
    windows.len() == expected_count
        && windows.iter().enumerate().all(|(index, window)| {
            valid_safe_integer(window.start_ms)
                && valid_safe_integer(window.end_ms)
                && window.end_ms > window.start_ms
                && (index == 0 || windows[index - 1].end_ms == window.start_ms)
        })
}

fn query_saved_analytics(
    connection: &mut Connection,
    request: NormalizedSavedAnalyticsRequestV2,
) -> Result<NormalizedSavedAnalyticsResponseV2, NormalizedSqliteError> {
    if request.schema_version != 2
        || !valid_analytics_windows(&request.daily_windows, 7)
        || !valid_analytics_windows(&request.hourly_windows, 24)
    {
        return Err(invalid(
            "normalized saved analytics query identity is invalid",
        ));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "saved_analytics_v2")
        .ok_or(invalid(
            "normalized saved analytics query program is missing",
        ))?;
    let daily_windows = serde_json::to_string(&request.daily_windows)
        .map_err(|_| invalid("normalized saved daily windows are invalid"))?;
    let hourly_windows = serde_json::to_string(&request.hourly_windows)
        .map_err(|_| invalid("normalized saved hourly windows are invalid"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut response =
        transaction.query_row(program.sql, params![daily_windows, hourly_windows], |row| {
            let source_counts_json: String = row.get("sourceCountsJson")?;
            let content_mix_json: String = row.get("contentMixJson")?;
            let daily_counts_json: String = row.get("dailyCountsJson")?;
            let hourly_counts_json: String = row.get("hourlyCountsJson")?;
            Ok(NormalizedSavedAnalyticsResponseV2 {
                content_mix: serde_json::from_str(&content_mix_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                daily_counts: serde_json::from_str(&daily_counts_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                hourly_counts: serde_json::from_str(&hourly_counts_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                latest_saved_at: row.get("latestSavedAt")?,
                query_id: "saved_analytics_v2".to_owned(),
                schema_version: 2,
                source: NormalizedFeedPageSourceV1 {
                    generation_id: generation_id.clone(),
                    projection_revision: source_revision,
                    transition_sequence: source_revision,
                },
                source_counts: serde_json::from_str(&source_counts_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                total_count: row.get("totalCount")?,
            })
        })?;
    let valid_counts = |counts: &[NormalizedSavedAnalyticsCountV2], maximum: usize| {
        counts.len() <= maximum
            && counts.iter().all(|count| {
                !count.label.is_empty()
                    && count.label.len() <= 256
                    && (1..=response.total_count).contains(&count.count)
            })
            && counts.windows(2).all(|pair| pair[0].label < pair[1].label)
    };
    if !valid_safe_integer(response.total_count)
        || response
            .latest_saved_at
            .is_some_and(|value| !valid_safe_integer(value))
        || (response.total_count == 0) != response.latest_saved_at.is_none()
        || !valid_counts(&response.source_counts, 64)
        || !valid_counts(&response.content_mix, 64)
        || response
            .source_counts
            .iter()
            .map(|count| count.count)
            .sum::<i64>()
            != response.total_count
        || response
            .content_mix
            .iter()
            .map(|count| count.count)
            .sum::<i64>()
            != response.total_count
        || response.daily_counts.len() != 7
        || response.hourly_counts.len() != 24
        || response
            .daily_counts
            .iter()
            .chain(&response.hourly_counts)
            .any(|count| !(0..=response.total_count).contains(count))
    {
        return Err(invalid("normalized saved analytics response is invalid"));
    }
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized saved analytics response is invalid"))?
        .len()
        > FEED_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized saved analytics response exceeds its byte bound",
        ));
    }
    response.content_mix.shrink_to_fit();
    response.source_counts.shrink_to_fit();
    transaction.commit()?;
    Ok(response)
}

fn query_preferences_snapshot(
    connection: &mut Connection,
    request: NormalizedPreferencesSnapshotRequestV1,
) -> Result<NormalizedPreferencesSnapshotResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1 {
        return Err(invalid("normalized preferences query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "preferences_snapshot_v1")
        .ok_or(invalid("normalized preferences query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map([], |row| {
        Ok(NormalizedPreferenceLeafV1 {
            boolean_value: optional_boolean(row, "booleanValue")?,
            integer_value: row.get("integerValue")?,
            path: row.get("path")?,
            real_value: row.get("realValue")?,
            text_value: row.get("textValue")?,
            updated_at: row.get("updatedAt")?,
            value_type: row.get("valueType")?,
        })
    })?;
    let mut rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() > PREFERENCES_SNAPSHOT_MAXIMUM_ROWS || rows.len() >= program.maximum_scan_rows {
        return Err(invalid("normalized preferences exceed their row bound"));
    }
    for row in &rows {
        let populated = [
            row.boolean_value.is_some(),
            row.integer_value.is_some(),
            row.real_value.is_some(),
            row.text_value.is_some(),
        ];
        let expected = [
            row.value_type == "boolean",
            row.value_type == "integer",
            row.value_type == "real",
            row.value_type == "text",
        ];
        if row.path.is_empty()
            || row.path.len() > PREFERENCE_PATH_MAXIMUM_BYTES
            || row
                .text_value
                .as_ref()
                .is_some_and(|value| value.len() > PREFERENCE_TEXT_MAXIMUM_BYTES)
            || !valid_safe_integer(row.updated_at)
            || row
                .integer_value
                .is_some_and(|value| !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value))
            || row.real_value.is_some_and(|value| !value.is_finite())
            || !matches!(
                row.value_type.as_str(),
                "boolean" | "integer" | "real" | "text" | "null"
            )
            || populated != expected
        {
            return Err(invalid("normalized preference row is invalid"));
        }
    }
    if rows.windows(2).any(|pair| pair[0].path >= pair[1].path) {
        return Err(invalid("normalized preferences are not in binary order"));
    }
    rows.shrink_to_fit();
    let response = NormalizedPreferencesSnapshotResponseV1 {
        query_id: "preferences_snapshot_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized preferences response is invalid"))?
        .len()
        > PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized preferences response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_persons_graph(
    connection: &mut Connection,
    request: NormalizedPersonsGraphRequestV1,
) -> Result<NormalizedPersonsGraphResponseV1, NormalizedSqliteError> {
    let combined = request.sources.len() + request.rss_feed_urls.len();
    let valid_text = |value: &str| !value.is_empty() && value.len() <= 4_096;
    if request.schema_version != 1
        || combined > PERSONS_GRAPH_MAXIMUM_COMBINED_SOURCES
        || !valid_safe_integer(request.recent_window.start_ms)
        || !valid_safe_integer(request.recent_window.end_ms)
        || request.recent_window.end_ms < request.recent_window.start_ms
        || request
            .sources
            .iter()
            .any(|source| !valid_text(&source.platform) || !valid_text(&source.author_id))
        || request.rss_feed_urls.iter().any(|url| !valid_text(url))
    {
        return Err(invalid(
            "normalized persons graph query identity is invalid",
        ));
    }
    for (index, source) in request.sources.iter().enumerate() {
        if request.sources[..index].contains(source) {
            return Err(invalid("normalized persons graph source is duplicated"));
        }
    }
    for (index, url) in request.rss_feed_urls.iter().enumerate() {
        if request.rss_feed_urls[..index].contains(url) {
            return Err(invalid("normalized persons graph RSS source is duplicated"));
        }
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "persons_graph_v1")
        .ok_or(invalid("normalized persons graph query program is missing"))?;
    let sources_json = serde_json::to_string(&request.sources)
        .map_err(|_| invalid("normalized persons graph sources are invalid"))?;
    let rss_json = serde_json::to_string(&request.rss_feed_urls)
        .map_err(|_| invalid("normalized persons graph RSS sources are invalid"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let total_item_count: i64 = transaction.query_row(program.count_sql, [], |row| row.get(0))?;
    if !valid_safe_integer(total_item_count) {
        return Err(invalid("normalized persons graph total is invalid"));
    }
    struct RawGraphRow {
        kind: String,
        platform: Option<String>,
        author_id: Option<String>,
        feed_url: Option<String>,
        item_count: i64,
        latest_activity_at: i64,
        recent_count: i64,
        avatar_global_id: Option<String>,
        avatar_published_at: Option<i64>,
        avatar_url: Option<String>,
        samples: Vec<NormalizedPersonsGraphSampleV1>,
        locations: Vec<NormalizedPersonsGraphLocationV1>,
        signals: Vec<NormalizedPersonsGraphSignalV1>,
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(
        params![
            sources_json,
            rss_json,
            request.recent_window.start_ms,
            request.recent_window.end_ms
        ],
        |row| {
            let samples_json: String = row.get("sampleItemsJson")?;
            let locations_json: String = row.get("locationCandidatesJson")?;
            let signals_json: String = row.get("signalCountsJson")?;
            Ok(RawGraphRow {
                kind: row.get("kind")?,
                platform: row.get("platform")?,
                author_id: row.get("authorId")?,
                feed_url: row.get("feedUrl")?,
                item_count: row.get("itemCount")?,
                latest_activity_at: row.get("latestActivityAt")?,
                recent_count: row.get("recentCount")?,
                avatar_global_id: row.get("avatarGlobalId")?,
                avatar_published_at: row.get("avatarPublishedAt")?,
                avatar_url: row.get("avatarUrl")?,
                samples: decode_sqlite_json(&samples_json)?,
                locations: decode_sqlite_json(&locations_json)?,
                signals: decode_sqlite_json(&signals_json)?,
            })
        },
    )?;
    let rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() != combined || rows.len() > program.maximum_scan_rows {
        return Err(invalid("normalized persons graph row count is invalid"));
    }
    let mut social = Vec::with_capacity(request.sources.len());
    let mut rss = Vec::with_capacity(request.rss_feed_urls.len());
    for (index, row) in rows.into_iter().enumerate() {
        if !valid_safe_integer(row.item_count)
            || !valid_safe_integer(row.latest_activity_at)
            || !valid_safe_integer(row.recent_count)
            || row
                .avatar_global_id
                .as_ref()
                .is_some_and(|value| !valid_text(value))
            || row
                .avatar_published_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .avatar_url
                .as_ref()
                .is_some_and(|value| value.len() > 4_096)
            || (row.avatar_global_id.is_none() != row.avatar_published_at.is_none())
            || (row.avatar_global_id.is_none() != row.avatar_url.is_none())
            || row.samples.len() > 5
            || row.locations.len() > 8
            || row.samples.iter().any(|sample| {
                !valid_text(&sample.global_id) || !valid_safe_integer(sample.published_at)
            })
            || row.locations.iter().any(|location| {
                !valid_text(&location.global_id)
                    || !valid_safe_integer(location.published_at)
                    || !valid_safe_integer(location.effective_at)
            })
        {
            return Err(invalid("normalized persons graph row is invalid"));
        }
        if index < request.sources.len() {
            let expected = &request.sources[index];
            if row.kind != "social"
                || row.platform.as_deref() != Some(expected.platform.as_str())
                || row.author_id.as_deref() != Some(expected.author_id.as_str())
                || row.feed_url.is_some()
            {
                return Err(invalid("normalized persons graph social order is invalid"));
            }
            let mut signal_counts = Vec::with_capacity(PERSONS_GRAPH_SIGNALS.len());
            for label in PERSONS_GRAPH_SIGNALS {
                let matches = row
                    .signals
                    .iter()
                    .filter(|signal| signal.label == label)
                    .collect::<Vec<_>>();
                if matches.len() > 1
                    || matches
                        .first()
                        .is_some_and(|signal| !valid_safe_integer(signal.count))
                    || row
                        .signals
                        .iter()
                        .any(|signal| !PERSONS_GRAPH_SIGNALS.contains(&signal.label.as_str()))
                {
                    return Err(invalid("normalized persons graph signals are invalid"));
                }
                signal_counts.push(NormalizedPersonsGraphSignalV1 {
                    count: matches.first().map_or(0, |signal| signal.count),
                    label: label.to_owned(),
                });
            }
            social.push(NormalizedPersonsGraphSocialV1 {
                author_id: expected.author_id.clone(),
                avatar_global_id: row.avatar_global_id,
                avatar_published_at: row.avatar_published_at,
                avatar_url: row.avatar_url,
                has_location: !row.locations.is_empty(),
                item_count: row.item_count,
                latest_activity_at: row.latest_activity_at,
                location_candidate_count: i64::try_from(row.locations.len())
                    .expect("bounded persons graph locations"),
                location_candidates: row.locations,
                platform: expected.platform.clone(),
                recent_count: row.recent_count,
                sample_items: row.samples,
                signal_counts,
            });
        } else {
            let expected = &request.rss_feed_urls[index - request.sources.len()];
            if row.kind != "rss"
                || row.feed_url.as_deref() != Some(expected.as_str())
                || row.platform.is_some()
                || row.author_id.is_some()
                || !row.signals.is_empty()
            {
                return Err(invalid("normalized persons graph RSS order is invalid"));
            }
            rss.push(NormalizedPersonsGraphRssV1 {
                avatar_global_id: row.avatar_global_id,
                avatar_published_at: row.avatar_published_at,
                avatar_url: row.avatar_url,
                feed_url: expected.clone(),
                has_location: !row.locations.is_empty(),
                item_count: row.item_count,
                latest_activity_at: row.latest_activity_at,
                location_candidate_count: i64::try_from(row.locations.len())
                    .expect("bounded persons graph locations"),
                location_candidates: row.locations,
                sample_items: row.samples,
            });
        }
    }
    let response = NormalizedPersonsGraphResponseV1 {
        query_id: "persons_graph_v1".to_owned(),
        rss,
        schema_version: 1,
        social,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
        total_item_count,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized persons graph response is invalid"))?
        .len()
        > PERSONS_GRAPH_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized persons graph response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn decode_sqlite_json<T: serde::de::DeserializeOwned>(text: &str) -> rusqlite::Result<T> {
    serde_json::from_str(text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn body_locator(
    row: &Row<'_>,
    storage_column: &str,
    digest_column: &str,
) -> rusqlite::Result<NormalizedItemBodyLocatorV1> {
    let storage: String = row.get(storage_column)?;
    let blob_digest: Option<String> = row.get(digest_column)?;
    if !matches!(storage.as_str(), "blob" | "inline" | "none")
        || (storage == "blob") != blob_digest.is_some()
        || blob_digest
            .as_ref()
            .is_some_and(|digest| !valid_lower_hex_64(digest))
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(NormalizedItemBodyLocatorV1 {
        blob_digest,
        storage,
    })
}

fn query_person_detail(
    connection: &mut Connection,
    request: NormalizedPersonDetailRequestV1,
) -> Result<NormalizedPersonDetailResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || request.person_id.is_empty()
        || request.person_id.len() > 2_048
    {
        return Err(invalid("normalized person detail identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "person_detail_v1")
        .ok_or(invalid("normalized person detail program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(params![request.person_id], |row| {
        let reach_outs_json: String = row.get("reachOutsJson")?;
        let reach_outs: Vec<NormalizedPersonReachOutV1> = serde_json::from_str(&reach_outs_json)
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
        Ok(NormalizedPersonDetailV1 {
            avatar_url: row.get("avatarUrl")?,
            bio: row.get("bio")?,
            care_level: row.get("careLevel")?,
            created_at: row.get("createdAt")?,
            id: row.get("id")?,
            name: row.get("name")?,
            notes: row.get("notes")?,
            reach_out_interval_days: row.get("reachOutIntervalDays")?,
            reach_outs,
            relationship_status: row.get("relationshipStatus")?,
            sample_batch_id: row.get("sampleBatchId")?,
            sample_generated_at: row.get("sampleGeneratedAt")?,
            sample_generator_version: row.get("sampleGeneratorVersion")?,
            tags: string_array(row, "tagsJson", 64, 1_024)?,
            updated_at: row.get("updatedAt")?,
        })
    })?;
    let mut persons = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if persons.len() > program.maximum_scan_rows {
        return Err(invalid("normalized person detail exceeded its row bound"));
    }
    if let Some(person) = persons.first() {
        let bounded_optional = |value: &Option<String>, maximum| {
            value.as_ref().is_none_or(|text| text.len() <= maximum)
        };
        if person.id != request.person_id
            || person.id.is_empty()
            || person.id.len() > 2_048
            || person.name.len() > 4_096
            || person.relationship_status.len() > 255
            || !bounded_optional(&person.avatar_url, 8_192)
            || !bounded_optional(&person.bio, 65_536)
            || !bounded_optional(&person.notes, 65_536)
            || !bounded_optional(&person.sample_batch_id, 255)
            || !(1..=5).contains(&person.care_level)
            || !valid_safe_integer(person.created_at)
            || !valid_safe_integer(person.updated_at)
            || person
                .reach_out_interval_days
                .is_some_and(|value| !valid_safe_integer(value))
            || person
                .sample_generated_at
                .is_some_and(|value| !valid_safe_integer(value))
            || person
                .sample_generator_version
                .is_some_and(|value| !valid_safe_integer(value))
            || person.tags.windows(2).any(|tags| tags[0] >= tags[1])
            || person.reach_outs.len() > 20
            || person.reach_outs.iter().any(|reach_out| {
                reach_out.reach_out_id.is_empty()
                    || reach_out.reach_out_id.len() > 255
                    || !valid_safe_integer(reach_out.logged_at)
                    || reach_out
                        .channel
                        .as_ref()
                        .is_some_and(|value| value.len() > 64)
                    || reach_out
                        .notes
                        .as_ref()
                        .is_some_and(|value| value.len() > 65_536)
            })
            || person.reach_outs.windows(2).any(|rows| {
                rows[0].logged_at < rows[1].logged_at
                    || (rows[0].logged_at == rows[1].logged_at
                        && rows[0].reach_out_id >= rows[1].reach_out_id)
            })
        {
            return Err(invalid("normalized person detail row is invalid"));
        }
    }
    let response = NormalizedPersonDetailResponseV1 {
        person: persons.pop(),
        query_id: "person_detail_v1".to_owned(),
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized person detail response is invalid"))?
        .len()
        > PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized person detail response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_account_detail(
    connection: &mut Connection,
    request: NormalizedAccountDetailRequestV1,
) -> Result<NormalizedAccountDetailResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || request.account_id.is_empty()
        || request.account_id.len() > 2_048
    {
        return Err(invalid("normalized account detail identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "account_detail_v1")
        .ok_or(invalid("normalized account detail program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(params![request.account_id], |row| {
        let follow_roster_active = row
            .get::<_, Option<i64>>("followRosterActive")?
            .map(|value| match value {
                0 => Ok(false),
                1 => Ok(true),
                _ => Err(rusqlite::Error::InvalidQuery),
            })
            .transpose()?;
        Ok(NormalizedAccountDetailV1 {
            address: row.get("address")?,
            avatar_url: row.get("avatarUrl")?,
            created_at: row.get("createdAt")?,
            discovered_from: row.get("discoveredFrom")?,
            display_name: row.get("displayName")?,
            email: row.get("email")?,
            external_id: row.get("externalId")?,
            first_seen_at: row.get("firstSeenAt")?,
            follow_roster_active,
            follow_roster_roles: string_array(row, "followRosterRolesJson", 8, 64)?,
            follow_roster_synced_at: row.get("followRosterSyncedAt")?,
            handle: row.get("handle")?,
            id: row.get("id")?,
            imported_at: row.get("importedAt")?,
            kind: row.get("kind")?,
            last_seen_at: row.get("lastSeenAt")?,
            person_id: row.get("personId")?,
            phone: row.get("phone")?,
            profile_url: row.get("profileUrl")?,
            provider: row.get("provider")?,
            sample_batch_id: row.get("sampleBatchId")?,
            sample_generated_at: row.get("sampleGeneratedAt")?,
            sample_generator_version: row.get("sampleGeneratorVersion")?,
            updated_at: row.get("updatedAt")?,
        })
    })?;
    let mut accounts = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if accounts.len() > program.maximum_scan_rows {
        return Err(invalid("normalized account detail exceeded its row bound"));
    }
    if let Some(account) = accounts.first() {
        let bounded_optional = |value: &Option<String>, maximum| {
            value.as_ref().is_none_or(|text| text.len() <= maximum)
        };
        if account.id != request.account_id
            || account.id.is_empty()
            || account.id.len() > 2_048
            || account.external_id.is_empty()
            || account.external_id.len() > 4_096
            || account.kind.is_empty()
            || account.kind.len() > 64
            || account.provider.is_empty()
            || account.provider.len() > 64
            || account.discovered_from.is_empty()
            || account.discovered_from.len() > 64
            || !bounded_optional(&account.person_id, 2_048)
            || !bounded_optional(&account.handle, 512)
            || !bounded_optional(&account.display_name, 512)
            || !bounded_optional(&account.avatar_url, 8_192)
            || !bounded_optional(&account.profile_url, 8_192)
            || !bounded_optional(&account.email, 4_096)
            || !bounded_optional(&account.phone, 512)
            || !bounded_optional(&account.address, 4_096)
            || !bounded_optional(&account.sample_batch_id, 255)
            || !valid_safe_integer(account.created_at)
            || !valid_safe_integer(account.first_seen_at)
            || !valid_safe_integer(account.last_seen_at)
            || !valid_safe_integer(account.updated_at)
            || account
                .imported_at
                .is_some_and(|value| !valid_safe_integer(value))
            || account
                .follow_roster_synced_at
                .is_some_and(|value| !valid_safe_integer(value))
            || account
                .sample_generated_at
                .is_some_and(|value| !valid_safe_integer(value))
            || account
                .sample_generator_version
                .is_some_and(|value| !valid_safe_integer(value))
            || account
                .follow_roster_roles
                .windows(2)
                .any(|roles| roles[0] >= roles[1])
        {
            return Err(invalid("normalized account detail row is invalid"));
        }
    }
    let response = NormalizedAccountDetailResponseV1 {
        account: accounts.pop(),
        query_id: "account_detail_v1".to_owned(),
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized account detail response is invalid"))?
        .len()
        > ACCOUNT_DETAIL_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized account detail response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_rss_feed_detail(
    connection: &mut Connection,
    request: NormalizedRssFeedDetailRequestV1,
) -> Result<NormalizedRssFeedDetailResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1 || request.url.is_empty() || request.url.len() > 4_096 {
        return Err(invalid("normalized RSS Feed detail URL is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "rss_feed_detail_v1")
        .ok_or(invalid("normalized RSS Feed detail program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(params![request.url], |row| {
        let boolean = |column| match row.get::<_, i64>(column)? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(rusqlite::Error::InvalidQuery),
        };
        Ok(NormalizedRssFeedDetailV1 {
            enabled: boolean("enabled")?,
            folder: row.get("folder")?,
            image_url: row.get("imageUrl")?,
            last_fetched: row.get("lastFetched")?,
            poll_interval: row.get("pollInterval")?,
            sample_batch_id: row.get("sampleBatchId")?,
            sample_generated_at: row.get("sampleGeneratedAt")?,
            sample_generator_version: row.get("sampleGeneratorVersion")?,
            site_url: row.get("siteUrl")?,
            title: row.get("title")?,
            track_unread: boolean("trackUnread")?,
            updated_at: row.get("updatedAt")?,
            url: row.get("url")?,
        })
    })?;
    let mut feeds = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if feeds.len() > program.maximum_scan_rows {
        return Err(invalid("normalized RSS Feed detail exceeded its row bound"));
    }
    if let Some(feed) = feeds.first() {
        let bounded_optional = |value: &Option<String>, maximum| {
            value.as_ref().is_none_or(|text| text.len() <= maximum)
        };
        if feed.url != request.url
            || feed.url.is_empty()
            || feed.url.len() > 4_096
            || feed.title.len() > 4_096
            || !bounded_optional(&feed.site_url, 4_096)
            || !bounded_optional(&feed.image_url, 4_096)
            || !bounded_optional(&feed.folder, 4_096)
            || !bounded_optional(&feed.sample_batch_id, 255)
            || !valid_safe_integer(feed.updated_at)
            || feed
                .last_fetched
                .is_some_and(|value| !valid_safe_integer(value))
            || feed
                .poll_interval
                .is_some_and(|value| !valid_safe_integer(value))
            || feed
                .sample_generated_at
                .is_some_and(|value| !valid_safe_integer(value))
            || feed
                .sample_generator_version
                .is_some_and(|value| !valid_safe_integer(value))
        {
            return Err(invalid("normalized RSS Feed detail row is invalid"));
        }
    }
    let response = NormalizedRssFeedDetailResponseV1 {
        feed: feeds.pop(),
        query_id: "rss_feed_detail_v1".to_owned(),
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized RSS Feed detail response is invalid"))?
        .len()
        > RSS_FEED_DETAIL_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized RSS Feed detail response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_person_graph_page(
    connection: &mut Connection,
    request: NormalizedPersonGraphPageRequestV1,
) -> Result<NormalizedPersonGraphPageResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized Person graph page request is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "person_graph_page_v1")
        .ok_or(invalid("normalized Person graph page program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let layout_revision = query_graph_layout_revision(&transaction)?;
    let cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.sort_at != layout_revision
            || cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
    }) {
        return Err(invalid("normalized Person graph page cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(
        params![
            cursor.as_ref().map(|cursor| cursor.global_id.as_str()),
            i64::try_from(request.limit + 1).expect("bounded Person graph page limit"),
        ],
        |row| {
            let graph_pinned = match row.get::<_, i64>("graphPinned")? {
                0 => false,
                1 => true,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(NormalizedPersonGraphRowV1 {
                avatar_url: row.get("avatarUrl")?,
                care_level: row.get("careLevel")?,
                graph_pinned,
                graph_updated_at: row.get("graphUpdatedAt")?,
                graph_x: row.get("graphX")?,
                graph_y: row.get("graphY")?,
                id: row.get("id")?,
                last_reach_out_at: row.get("lastReachOutAt")?,
                name: row.get("name")?,
                reach_out_interval_days: row.get("reachOutIntervalDays")?,
                relationship_status: row.get("relationshipStatus")?,
                updated_at: row.get("updatedAt")?,
            })
        },
    )?;
    let mut rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() > program.maximum_scan_rows {
        return Err(invalid(
            "normalized Person graph page exceeded its row bound",
        ));
    }
    let has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    for row in &rows {
        if row.id.is_empty()
            || row.id.len() > 2_048
            || row.name.is_empty()
            || row.name.len() > 4_096
            || row.relationship_status.is_empty()
            || row.relationship_status.len() > 255
            || row
                .avatar_url
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || !(1..=5).contains(&row.care_level)
            || row.graph_pinned != row.graph_x.is_some()
            || row.graph_pinned != row.graph_y.is_some()
            || row.graph_pinned != row.graph_updated_at.is_some()
            || row
                .graph_updated_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .graph_x
                .is_some_and(|value| !value.is_finite() || value.abs() > 1_000_000_000.0)
            || row
                .graph_y
                .is_some_and(|value| !value.is_finite() || value.abs() > 1_000_000_000.0)
            || !valid_safe_integer(row.updated_at)
            || row
                .last_reach_out_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .reach_out_interval_days
                .is_some_and(|value| !valid_safe_integer(value))
        {
            return Err(invalid("normalized Person graph page row is invalid"));
        }
    }
    if rows.windows(2).any(|pair| pair[0].id >= pair[1].id) {
        return Err(invalid("normalized Person graph page order is invalid"));
    }
    let next_cursor = if has_more {
        let last = rows.last().ok_or(invalid(
            "normalized Person graph page cursor row is missing",
        ))?;
        Some(encode_cursor(&FeedPageCursorV1 {
            generation_id: generation_id.clone(),
            transition_sequence: source_revision,
            projection_revision: source_revision,
            sort_at: layout_revision,
            global_id: last.id.clone(),
        })?)
    } else {
        None
    };
    let response = NormalizedPersonGraphPageResponseV1 {
        layout_revision,
        next_cursor,
        query_id: "person_graph_page_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized Person graph page response is invalid"))?
        .len()
        > FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized Person graph page response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_account_graph_page(
    connection: &mut Connection,
    request: NormalizedAccountGraphPageRequestV1,
) -> Result<NormalizedAccountGraphPageResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized Account graph page request is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "account_graph_page_v1")
        .ok_or(invalid("normalized Account graph page program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let layout_revision = query_graph_layout_revision(&transaction)?;
    let cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.sort_at != layout_revision
            || cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
    }) {
        return Err(invalid("normalized Account graph page cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(
        params![
            cursor.as_ref().map(|cursor| cursor.global_id.as_str()),
            i64::try_from(request.limit + 1).expect("bounded Account graph page limit"),
        ],
        |row| {
            let follow_roster_active = row
                .get::<_, Option<i64>>("followRosterActive")?
                .map(|value| match value {
                    0 => Ok(false),
                    1 => Ok(true),
                    _ => Err(rusqlite::Error::InvalidQuery),
                })
                .transpose()?;
            let graph_pinned = match row.get::<_, i64>("graphPinned")? {
                0 => false,
                1 => true,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(NormalizedAccountGraphRowV1 {
                activity_count: row.get("activityCount")?,
                avatar_url: row.get("avatarUrl")?,
                discovered_from: row.get("discoveredFrom")?,
                display_name: row.get("displayName")?,
                external_id: row.get("externalId")?,
                first_seen_at: row.get("firstSeenAt")?,
                follow_roster_active,
                graph_pinned,
                graph_updated_at: row.get("graphUpdatedAt")?,
                graph_x: row.get("graphX")?,
                graph_y: row.get("graphY")?,
                handle: row.get("handle")?,
                id: row.get("id")?,
                kind: row.get("kind")?,
                last_seen_at: row.get("lastSeenAt")?,
                latest_activity_at: row.get("latestActivityAt")?,
                person_id: row.get("personId")?,
                person_name: row.get("personName")?,
                provider: row.get("provider")?,
                updated_at: row.get("updatedAt")?,
            })
        },
    )?;
    let mut rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() > program.maximum_scan_rows {
        return Err(invalid(
            "normalized Account graph page exceeded its row bound",
        ));
    }
    let mut has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    for row in &rows {
        let bounded = |value: &Option<String>, maximum| {
            value.as_ref().is_none_or(|text| text.len() <= maximum)
        };
        if row.id.is_empty()
            || row.id.len() > 2_048
            || row.external_id.is_empty()
            || row.external_id.len() > 4_096
            || row.kind.is_empty()
            || row.kind.len() > 64
            || row.provider.is_empty()
            || row.provider.len() > 64
            || row.discovered_from.is_empty()
            || row.discovered_from.len() > 64
            || !bounded(&row.person_id, 2_048)
            || !bounded(&row.person_name, 4_096)
            || !bounded(&row.handle, 512)
            || !bounded(&row.display_name, 512)
            || !bounded(&row.avatar_url, 8_192)
            || row.graph_pinned != row.graph_x.is_some()
            || row.graph_pinned != row.graph_y.is_some()
            || row.graph_pinned != row.graph_updated_at.is_some()
            || row
                .graph_updated_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .graph_x
                .is_some_and(|value| !value.is_finite() || value.abs() > 1_000_000_000.0)
            || row
                .graph_y
                .is_some_and(|value| !value.is_finite() || value.abs() > 1_000_000_000.0)
            || !valid_safe_integer(row.first_seen_at)
            || !valid_safe_integer(row.activity_count)
            || !valid_safe_integer(row.last_seen_at)
            || !valid_safe_integer(row.updated_at)
            || row
                .latest_activity_at
                .is_some_and(|value| !valid_safe_integer(value))
        {
            return Err(invalid("normalized Account graph page row is invalid"));
        }
    }
    if rows.windows(2).any(|pair| pair[0].id >= pair[1].id) {
        return Err(invalid("normalized Account graph page order is invalid"));
    }
    let response = loop {
        let next_cursor = if has_more {
            let last = rows.last().ok_or(invalid(
                "normalized Account graph page cursor row is missing",
            ))?;
            Some(encode_cursor(&FeedPageCursorV1 {
                generation_id: generation_id.clone(),
                transition_sequence: source_revision,
                projection_revision: source_revision,
                sort_at: layout_revision,
                global_id: last.id.clone(),
            })?)
        } else {
            None
        };
        let candidate = NormalizedAccountGraphPageResponseV1 {
            layout_revision,
            next_cursor,
            query_id: "account_graph_page_v1".to_owned(),
            rows: rows.clone(),
            schema_version: 1,
            source: NormalizedFeedPageSourceV1 {
                generation_id: generation_id.clone(),
                projection_revision: source_revision,
                transition_sequence: source_revision,
            },
        };
        if serde_json::to_vec(&candidate)
            .map_err(|_| invalid("normalized Account graph page response is invalid"))?
            .len()
            <= FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
        {
            break candidate;
        }
        if rows.len() <= 1 {
            return Err(invalid(
                "normalized Account graph page contains an oversized row",
            ));
        }
        rows.pop();
        has_more = true;
    };
    transaction.commit()?;
    Ok(response)
}

fn query_rss_feed_page(
    connection: &mut Connection,
    request: NormalizedRssFeedPageRequestV1,
) -> Result<NormalizedRssFeedPageResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized RSS Feed page request is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "rss_feed_page_v1")
        .ok_or(invalid("normalized RSS Feed page program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let layout_revision = query_graph_layout_revision(&transaction)?;
    let cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.sort_at != layout_revision
            || cursor.generation_id != generation_id
            || cursor.transition_sequence != source_revision
            || cursor.projection_revision != source_revision
    }) {
        return Err(invalid("normalized RSS Feed page cursor is stale"));
    }
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(
        params![
            cursor.as_ref().map(|cursor| cursor.global_id.as_str()),
            i64::try_from(request.limit + 1).expect("bounded RSS Feed page limit"),
        ],
        |row| {
            let enabled = match row.get::<_, i64>("enabled")? {
                0 => false,
                1 => true,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            let track_unread = match row.get::<_, i64>("trackUnread")? {
                0 => false,
                1 => true,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(NormalizedRssFeedPageRowV1 {
                activity_count: row.get("activityCount")?,
                enabled,
                folder: row.get("folder")?,
                image_url: row.get("imageUrl")?,
                last_fetched: row.get("lastFetched")?,
                latest_activity_at: row.get("latestActivityAt")?,
                poll_interval: row.get("pollInterval")?,
                sample_batch_id: row.get("sampleBatchId")?,
                sample_generated_at: row.get("sampleGeneratedAt")?,
                sample_generator_version: row.get("sampleGeneratorVersion")?,
                site_url: row.get("siteUrl")?,
                title: row.get("title")?,
                track_unread,
                unread_count: row.get("unreadCount")?,
                updated_at: row.get("updatedAt")?,
                url: row.get("url")?,
            })
        },
    )?;
    let mut rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() > program.maximum_scan_rows {
        return Err(invalid("normalized RSS Feed page exceeded its row bound"));
    }
    let mut has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    for row in &rows {
        if row.url.is_empty()
            || row.url.len() > 4_096
            || row.title.len() > 4_096
            || row.folder.as_ref().is_some_and(|value| value.len() > 4_096)
            || row
                .image_url
                .as_ref()
                .is_some_and(|value| value.len() > 4_096)
            || row
                .site_url
                .as_ref()
                .is_some_and(|value| value.len() > 4_096)
            || row
                .sample_batch_id
                .as_ref()
                .is_some_and(|value| value.len() > 255)
            || !valid_safe_integer(row.activity_count)
            || !valid_safe_integer(row.unread_count)
            || row.unread_count > row.activity_count
            || !valid_safe_integer(row.updated_at)
            || row
                .last_fetched
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .latest_activity_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .poll_interval
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .sample_generated_at
                .is_some_and(|value| !valid_safe_integer(value))
            || row
                .sample_generator_version
                .is_some_and(|value| !valid_safe_integer(value))
            || row.sample_batch_id.is_none() != row.sample_generated_at.is_none()
            || row.sample_batch_id.is_none() != row.sample_generator_version.is_none()
        {
            return Err(invalid("normalized RSS Feed page row is invalid"));
        }
    }
    if rows.windows(2).any(|pair| pair[0].url >= pair[1].url) {
        return Err(invalid("normalized RSS Feed page order is invalid"));
    }
    let response = loop {
        let next_cursor = if has_more {
            let last = rows
                .last()
                .ok_or(invalid("normalized RSS Feed page cursor row is missing"))?;
            Some(encode_cursor(&FeedPageCursorV1 {
                generation_id: generation_id.clone(),
                transition_sequence: source_revision,
                projection_revision: source_revision,
                sort_at: layout_revision,
                global_id: last.url.clone(),
            })?)
        } else {
            None
        };
        let candidate = NormalizedRssFeedPageResponseV1 {
            layout_revision,
            next_cursor,
            query_id: "rss_feed_page_v1".to_owned(),
            rows: rows.clone(),
            schema_version: 1,
            source: NormalizedFeedPageSourceV1 {
                generation_id: generation_id.clone(),
                projection_revision: source_revision,
                transition_sequence: source_revision,
            },
        };
        if serde_json::to_vec(&candidate)
            .map_err(|_| invalid("normalized RSS Feed page response is invalid"))?
            .len()
            <= FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
        {
            break candidate;
        }
        if rows.len() <= 1 {
            return Err(invalid(
                "normalized RSS Feed page contains an oversized row",
            ));
        }
        rows.pop();
        has_more = true;
    };
    transaction.commit()?;
    Ok(response)
}

fn query_item_detail(
    connection: &mut Connection,
    request: NormalizedItemDetailRequestV1,
) -> Result<NormalizedItemDetailResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || request.global_id.is_empty()
        || request.global_id.len() > 2_048
    {
        return Err(invalid("normalized item detail identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "item_detail_v1")
        .ok_or(invalid("normalized item detail program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let rows = statement.query_map(params![request.global_id], |row| {
        Ok(NormalizedItemDetailV1 {
            card: feed_card(row)?,
            content_body: body_locator(row, "contentBodyStorage", "contentBodyBlobDigest")?,
            preserved_body: body_locator(row, "preservedBodyStorage", "preservedBodyBlobDigest")?,
        })
    })?;
    let mut items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    if items.len() > program.maximum_scan_rows {
        return Err(invalid("normalized item detail exceeded its row bound"));
    }
    drop(statement);
    let item = items.pop();
    let response = NormalizedItemDetailResponseV1 {
        item,
        query_id: "item_detail_v1".to_owned(),
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized item detail response is invalid"))?
        .len()
        > FEED_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized item detail response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

#[derive(Debug)]
struct ItemReaderSqlRow {
    storage: String,
    blob_digest: Option<String>,
    content_length: i64,
    chunk_index: i64,
    bytes: Option<Vec<u8>>,
}

fn query_item_reader_body(
    connection: &mut Connection,
    request: NormalizedItemReaderBodyRequestV1,
) -> Result<NormalizedItemReaderBodyResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !matches!(request.body_kind.as_str(), "content" | "preserved")
        || request.global_id.is_empty()
        || request.global_id.len() > 2_048
        || !(1..=ITEM_READER_BODY_MAXIMUM_RANGE_BYTES).contains(&request.limit_bytes)
        || request.offset_bytes > MAX_SAFE_INTEGER as usize
    {
        return Err(invalid("normalized item reader body request is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.query_id == "item_reader_body_v1")
        .ok_or(invalid("normalized item reader body program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.sql)?;
    let mapped = statement.query_map(
        params![
            request.global_id,
            request.body_kind,
            i64::try_from(request.offset_bytes)
                .map_err(|_| invalid("normalized item reader body offset is invalid"))?,
            i64::try_from(request.limit_bytes)
                .map_err(|_| invalid("normalized item reader body limit is invalid"))?,
        ],
        |row| {
            Ok(ItemReaderSqlRow {
                storage: row.get("bodyStorage")?,
                blob_digest: row.get("blobDigest")?,
                content_length: row.get("contentLength")?,
                chunk_index: row.get("chunkIndex")?,
                bytes: row.get("bytes")?,
            })
        },
    )?;
    let rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() > program.maximum_scan_rows {
        return Err(invalid(
            "normalized item reader body exceeded its row bound",
        ));
    }
    let body = if rows.is_empty() {
        None
    } else {
        let metadata = &rows[0];
        let content_length = usize::try_from(metadata.content_length)
            .ok()
            .filter(|value| *value <= MAX_SAFE_INTEGER as usize)
            .ok_or(invalid("normalized item reader body length is invalid"))?;
        if metadata.chunk_index != -1
            || !matches!(metadata.storage.as_str(), "inline" | "blob")
            || (metadata.storage == "blob") != metadata.blob_digest.is_some()
            || metadata
                .blob_digest
                .as_ref()
                .is_some_and(|digest| !valid_lower_hex_64(digest))
            || request.offset_bytes > content_length
        {
            return Err(invalid("normalized item reader body metadata is invalid"));
        }
        let end_offset = content_length.min(
            request
                .offset_bytes
                .checked_add(request.limit_bytes)
                .ok_or(invalid("normalized item reader body range overflowed"))?,
        );
        let range = if metadata.storage == "inline" {
            if rows.len() != 1 {
                return Err(invalid("normalized inline reader body returned chunk rows"));
            }
            let bytes = metadata
                .bytes
                .as_ref()
                .ok_or(invalid("normalized inline reader body is missing"))?;
            if bytes.len() != content_length {
                return Err(invalid(
                    "normalized inline reader body length is inconsistent",
                ));
            }
            bytes[request.offset_bytes..end_offset].to_vec()
        } else if request.offset_bytes == content_length {
            if rows.len() != 1 {
                return Err(invalid("normalized empty reader range returned chunk rows"));
            }
            Vec::new()
        } else {
            let first_chunk = request.offset_bytes / CONTENT_CHUNK_BYTES;
            let last_chunk = (end_offset - 1) / CONTENT_CHUNK_BYTES;
            let chunks = &rows[1..];
            if chunks.len() != last_chunk - first_chunk + 1 {
                return Err(invalid(
                    "normalized item reader body chunk range is incomplete",
                ));
            }
            let mut joined = Vec::with_capacity(chunks.len() * CONTENT_CHUNK_BYTES);
            for (relative_index, chunk) in chunks.iter().enumerate() {
                let chunk_index = first_chunk + relative_index;
                let bytes = chunk
                    .bytes
                    .as_ref()
                    .ok_or(invalid("normalized item reader body chunk is missing"))?;
                let expected_length = CONTENT_CHUNK_BYTES
                    .min(content_length.saturating_sub(chunk_index * CONTENT_CHUNK_BYTES));
                if chunk.chunk_index != chunk_index as i64
                    || chunk.storage != metadata.storage
                    || chunk.blob_digest != metadata.blob_digest
                    || chunk.content_length != metadata.content_length
                    || bytes.len() != expected_length
                {
                    return Err(invalid("normalized item reader body chunk is inconsistent"));
                }
                joined.extend_from_slice(bytes);
            }
            let relative_start = request.offset_bytes - first_chunk * CONTENT_CHUNK_BYTES;
            joined[relative_start..relative_start + end_offset - request.offset_bytes].to_vec()
        };
        Some(NormalizedItemReaderBodyRangeV1 {
            blob_digest: metadata.blob_digest.clone(),
            bytes_base64: BASE64_STANDARD.encode(range),
            content_length,
            end_offset,
            start_offset: request.offset_bytes,
            storage: metadata.storage.clone(),
        })
    };
    let response = NormalizedItemReaderBodyResponseV1 {
        body,
        query_id: "item_reader_body_v1".to_owned(),
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized item reader body response is invalid"))?
        .len()
        > ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized item reader body response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

pub fn query_normalized_v1(
    connection: &mut Connection,
    request: NormalizedQueryRequestV1,
) -> Result<NormalizedQueryResponseV1, NormalizedSqliteError> {
    match request {
        NormalizedQueryRequestV1::AccountDetail(request) => {
            Ok(NormalizedQueryResponseV1::AccountDetail(Box::new(
                query_account_detail(connection, request)?,
            )))
        }
        NormalizedQueryRequestV1::AccountGraphPage(request) => {
            Ok(NormalizedQueryResponseV1::AccountGraphPage(
                query_account_graph_page(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::AccountTimeline(request) => {
            Ok(NormalizedQueryResponseV1::AccountTimeline(
                query_account_timeline(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::ChangeFeed(request) => Ok(NormalizedQueryResponseV1::ChangeFeed(
            query_change_feed(connection, request)?,
        )),
        NormalizedQueryRequestV1::FacetSummary(request) => Ok(
            NormalizedQueryResponseV1::FacetSummary(query_facet_summary(connection, request)?),
        ),
        NormalizedQueryRequestV1::FeedBrowsePage(request) => {
            Ok(NormalizedQueryResponseV1::FeedBrowsePage(Box::new(
                query_feed_browse_page(connection, request)?,
            )))
        }
        NormalizedQueryRequestV1::FeedPage(request) => Ok(NormalizedQueryResponseV1::FeedPage(
            query_feed_page(connection, request)?,
        )),
        NormalizedQueryRequestV1::FilterScopeSummary(request) => {
            Ok(NormalizedQueryResponseV1::FilterScopeSummary(
                query_filter_scope_summary(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::ItemDetail(request) => Ok(NormalizedQueryResponseV1::ItemDetail(
            Box::new(query_item_detail(connection, request)?),
        )),
        NormalizedQueryRequestV1::ItemReaderBody(request) => Ok(
            NormalizedQueryResponseV1::ItemReaderBody(query_item_reader_body(connection, request)?),
        ),
        NormalizedQueryRequestV1::ItemScan(request) => Ok(NormalizedQueryResponseV1::ItemScan(
            query_item_scan(connection, request)?,
        )),
        NormalizedQueryRequestV1::ContentFetchPage(request) => {
            Ok(NormalizedQueryResponseV1::ContentFetchPage(
                query_content_fetch_page(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::ProviderMediaPage(request) => {
            Ok(NormalizedQueryResponseV1::ProviderMediaPage(
                query_provider_media_page(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::MapMarkers(request) => Ok(NormalizedQueryResponseV1::MapMarkers(
            query_map_markers(connection, request)?,
        )),
        NormalizedQueryRequestV1::PersonDetail(request) => {
            Ok(NormalizedQueryResponseV1::PersonDetail(Box::new(
                query_person_detail(connection, request)?,
            )))
        }
        NormalizedQueryRequestV1::PersonGraphPage(request) => {
            Ok(NormalizedQueryResponseV1::PersonGraphPage(
                query_person_graph_page(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::PersonTimeline(request) => Ok(
            NormalizedQueryResponseV1::PersonTimeline(query_person_timeline(connection, request)?),
        ),
        NormalizedQueryRequestV1::PersonsGraph(request) => Ok(
            NormalizedQueryResponseV1::PersonsGraph(query_persons_graph(connection, request)?),
        ),
        NormalizedQueryRequestV1::PreferencesSnapshot(request) => {
            Ok(NormalizedQueryResponseV1::PreferencesSnapshot(
                query_preferences_snapshot(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::RssFeedDetail(request) => Ok(
            NormalizedQueryResponseV1::RssFeedDetail(query_rss_feed_detail(connection, request)?),
        ),
        NormalizedQueryRequestV1::RssFeedPage(request) => Ok(
            NormalizedQueryResponseV1::RssFeedPage(query_rss_feed_page(connection, request)?),
        ),
        NormalizedQueryRequestV1::SavedAnalytics(request) => Ok(
            NormalizedQueryResponseV1::SavedAnalytics(query_saved_analytics(connection, request)?),
        ),
        NormalizedQueryRequestV1::SavedFeedPage(request) => {
            Ok(NormalizedQueryResponseV1::SavedFeedPage(Box::new(
                query_saved_feed_page(connection, request)?,
            )))
        }
        NormalizedQueryRequestV1::SearchPage(request) => Ok(NormalizedQueryResponseV1::SearchPage(
            query_search_page(connection, request)?,
        )),
        NormalizedQueryRequestV1::StoryWallCandidates(request) => {
            Ok(NormalizedQueryResponseV1::StoryWallCandidates(
                query_story_wall_candidates(connection, request)?,
            ))
        }
    }
}

/// Executes one closed normalized query from the flat native transport shape.
///
/// `queryId` selects a registered request type. Every remaining field is
/// deserialized by that request's `deny_unknown_fields` contract, so the
/// native boundary cannot become an arbitrary SQL or loosely typed JSON path.
pub fn query_normalized_json_v1(
    connection: &mut Connection,
    request: serde_json::Value,
) -> Result<serde_json::Value, NormalizedSqliteError> {
    let serde_json::Value::Object(mut fields) = request else {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized query request must be an object",
        ));
    };
    let query_id = fields
        .remove("queryId")
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized queryId is required",
        ))?;
    let fields = serde_json::Value::Object(fields);

    macro_rules! decode_request {
        ($request:ty, $variant:ident) => {
            NormalizedQueryRequestV1::$variant(serde_json::from_value::<$request>(fields).map_err(
                |_| NormalizedSqliteError::InvalidRequest("normalized query request is invalid"),
            )?)
        };
    }

    let request = match query_id.as_str() {
        "account_detail_v1" => decode_request!(NormalizedAccountDetailRequestV1, AccountDetail),
        "account_graph_page_v1" => {
            decode_request!(NormalizedAccountGraphPageRequestV1, AccountGraphPage)
        }
        "account_timeline_v1" => {
            decode_request!(NormalizedAccountTimelineRequestV1, AccountTimeline)
        }
        "change_feed_v1" => decode_request!(NormalizedChangeFeedRequestV1, ChangeFeed),
        "library_facet_summary_v1" => {
            decode_request!(NormalizedFacetSummaryRequestV1, FacetSummary)
        }
        "feed_browse_page_v3" => {
            decode_request!(NormalizedFeedBrowsePageRequestV3, FeedBrowsePage)
        }
        "feed_page_v1" => decode_request!(NormalizedFeedPageRequestV1, FeedPage),
        "filter_scope_summary_v1" => {
            decode_request!(NormalizedFilterScopeSummaryRequestV1, FilterScopeSummary)
        }
        "item_detail_v1" => decode_request!(NormalizedItemDetailRequestV1, ItemDetail),
        "item_reader_body_v1" => {
            decode_request!(NormalizedItemReaderBodyRequestV1, ItemReaderBody)
        }
        "background_item_page_v1" => decode_request!(NormalizedItemScanRequestV1, ItemScan),
        "content_fetch_claim_v1" => {
            decode_request!(NormalizedContentFetchPageRequestV1, ContentFetchPage)
        }
        "provider_media_page_v1" => {
            decode_request!(NormalizedProviderMediaPageRequestV1, ProviderMediaPage)
        }
        "map_markers_v1" => decode_request!(NormalizedMapMarkersRequestV1, MapMarkers),
        "person_detail_v1" => decode_request!(NormalizedPersonDetailRequestV1, PersonDetail),
        "person_graph_page_v1" => {
            decode_request!(NormalizedPersonGraphPageRequestV1, PersonGraphPage)
        }
        "person_timeline_v1" => {
            decode_request!(NormalizedPersonTimelineRequestV1, PersonTimeline)
        }
        "persons_graph_v1" => {
            decode_request!(NormalizedPersonsGraphRequestV1, PersonsGraph)
        }
        "preferences_snapshot_v1" => {
            decode_request!(NormalizedPreferencesSnapshotRequestV1, PreferencesSnapshot)
        }
        "rss_feed_detail_v1" => {
            decode_request!(NormalizedRssFeedDetailRequestV1, RssFeedDetail)
        }
        "rss_feed_page_v1" => {
            decode_request!(NormalizedRssFeedPageRequestV1, RssFeedPage)
        }
        "saved_analytics_v2" => {
            decode_request!(NormalizedSavedAnalyticsRequestV2, SavedAnalytics)
        }
        "saved_feed_page_v2" => {
            decode_request!(NormalizedSavedFeedPageRequestV2, SavedFeedPage)
        }
        "search_page_v1" => {
            decode_request!(NormalizedSearchPageRequestV1, SearchPage)
        }
        "story_wall_candidates_v1" => {
            decode_request!(NormalizedStoryWallCandidatesRequestV1, StoryWallCandidates)
        }
        _ => {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized queryId is unknown",
            ));
        }
    };
    let response = query_normalized_v1(connection, request)?;

    macro_rules! encode_response {
        ($response:expr) => {
            serde_json::to_value($response).map_err(|error| {
                NormalizedSqliteError::Transport(format!(
                    "normalized query response encoding failed: {error}"
                ))
            })
        };
    }

    match response {
        NormalizedQueryResponseV1::AccountDetail(response) => encode_response!(response),
        NormalizedQueryResponseV1::AccountGraphPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::AccountTimeline(response) => encode_response!(response),
        NormalizedQueryResponseV1::ChangeFeed(response) => encode_response!(response),
        NormalizedQueryResponseV1::FacetSummary(response) => encode_response!(response),
        NormalizedQueryResponseV1::FeedBrowsePage(response) => encode_response!(response),
        NormalizedQueryResponseV1::FeedPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::FilterScopeSummary(response) => encode_response!(response),
        NormalizedQueryResponseV1::ItemDetail(response) => encode_response!(response),
        NormalizedQueryResponseV1::ItemReaderBody(response) => encode_response!(response),
        NormalizedQueryResponseV1::ItemScan(response) => encode_response!(response),
        NormalizedQueryResponseV1::ContentFetchPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::ProviderMediaPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::MapMarkers(response) => encode_response!(response),
        NormalizedQueryResponseV1::PersonDetail(response) => encode_response!(response),
        NormalizedQueryResponseV1::PersonGraphPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::PersonTimeline(response) => encode_response!(response),
        NormalizedQueryResponseV1::PersonsGraph(response) => encode_response!(response),
        NormalizedQueryResponseV1::PreferencesSnapshot(response) => encode_response!(response),
        NormalizedQueryResponseV1::RssFeedDetail(response) => encode_response!(response),
        NormalizedQueryResponseV1::RssFeedPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::SavedAnalytics(response) => encode_response!(response),
        NormalizedQueryResponseV1::SavedFeedPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::SearchPage(response) => encode_response!(response),
        NormalizedQueryResponseV1::StoryWallCandidates(response) => encode_response!(response),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_sqlite::install_normalized_schema_v1;

    #[test]
    fn flat_json_boundary_accepts_only_registered_typed_queries() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 0, 0);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;",
                "a".repeat(64)
            ))
            .expect("query source fixture");

        let response = query_normalized_json_v1(
            &mut connection,
            serde_json::json!({
                "queryId": "library_facet_summary_v1",
                "schemaVersion": 1
            }),
        )
        .expect("query facet summary");
        assert_eq!(
            response.get("queryId").and_then(serde_json::Value::as_str),
            Some("library_facet_summary_v1")
        );
        assert!(response.get("FacetSummary").is_none());

        let scan = query_normalized_json_v1(
            &mut connection,
            serde_json::json!({
                "cancellationId": "cancel-scan-1",
                "cursor": null,
                "limit": 1,
                "queryId": "background_item_page_v1",
                "readerSessionId": "reader-scan-1",
                "schemaVersion": 1
            }),
        )
        .expect("query background item page");
        assert_eq!(
            scan.get("queryId").and_then(serde_json::Value::as_str),
            Some("background_item_page_v1")
        );

        connection
            .execute_batch(
                "INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES ('person-1', 'Ada', 'friend', 5, 1, 1);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, handle, display_name,
                    first_seen_at, last_seen_at, discovered_from, created_at, updated_at)
                   VALUES ('account-1', 'person-1', 'social', 'x', 'ada-remote',
                           'ada', 'Countess Ada', 1, 1, 'capture', 1, 1);
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, content_text,
                    hidden, saved, archived, updated_at)
                   VALUES ('item-1', 'x', 'article', 1, 1, 'ada-remote', 'ada',
                           'Ada', 'Analytical engine architecture', 0, 0, 0, 1);",
            )
            .expect("search fixture");
        let search = query_normalized_json_v1(
            &mut connection,
            serde_json::json!({
                "cancellationId": "cancel-search-1",
                "cursor": null,
                "filter": {
                    "archivedOnly": false,
                    "authorId": null,
                    "feedUrl": null,
                    "platform": null,
                    "savedOnly": false,
                    "schemaVersion": 1,
                    "showHidden": false,
                    "signals": [],
                    "socialContentFilter": "all",
                    "tags": []
                },
                "friendsPredicateSchemaVersion": 1,
                "identityMode": "friends",
                "limit": 32,
                "query": "countess",
                "queryId": "search_page_v1",
                "readerSessionId": "reader-search-1",
                "recommendationOrderSchemaVersion": 1,
                "schemaVersion": 1
            }),
        )
        .expect("query search page");
        assert_eq!(search["rows"].as_array().map(Vec::len), Some(1));
        assert_eq!(search["rows"][0]["card"]["globalId"], "item-1");

        let graph = query_normalized_json_v1(
            &mut connection,
            serde_json::json!({
                "queryId": "persons_graph_v1",
                "recentWindow": {"startMs": 0, "endMs": 2},
                "rssFeedUrls": [],
                "schemaVersion": 1,
                "sources": [{"authorId": "ada-remote", "platform": "x"}]
            }),
        )
        .expect("query persons graph");
        assert_eq!(graph["totalItemCount"], 1);
        assert_eq!(graph["social"][0]["itemCount"], 1);
        assert_eq!(graph["social"][0]["recentCount"], 1);
        assert_eq!(graph["social"][0]["sampleItems"][0]["globalId"], "item-1");
        assert_eq!(
            graph["social"][0]["signalCounts"].as_array().map(Vec::len),
            Some(20)
        );

        let unknown = query_normalized_json_v1(
            &mut connection,
            serde_json::json!({"queryId": "raw_sql_v1", "sql": "SELECT 1"}),
        )
        .expect_err("unknown query must fail");
        assert_eq!(unknown.to_string(), "normalized queryId is unknown");

        let extra = query_normalized_json_v1(
            &mut connection,
            serde_json::json!({
                "queryId": "library_facet_summary_v1",
                "schemaVersion": 1,
                "sql": "SELECT 1"
            }),
        )
        .expect_err("unknown request field must fail");
        assert_eq!(extra.to_string(), "normalized query request is invalid");
    }

    #[test]
    fn native_cursor_codec_matches_the_typescript_contract_golden_vector() {
        let cursor = FeedPageCursorV1 {
            generation_id: "a".repeat(64),
            transition_sequence: 12,
            projection_revision: 34,
            sort_at: 1_780_000_000_000,
            global_id: "x:item-1".to_owned(),
        };
        let encoded = encode_cursor(&cursor).expect("encode cursor");
        assert_eq!(
            encoded,
            "AaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAAAAAwAAAAAAAAAIgAAAZ5wRIgAAAh4Oml0ZW0tMQ"
        );
        assert_eq!(decode_cursor(&encoded).expect("decode cursor"), cursor);
        let search_request = NormalizedSearchPageRequestV1 {
            cancellation_id: "search-cancel".to_owned(),
            cursor: None,
            filter: NormalizedFeedBrowseFilterV1 {
                archived_only: false,
                author_id: None,
                feed_url: None,
                platform: None,
                saved_only: false,
                schema_version: 1,
                show_hidden: false,
                signals: vec![],
                social_content_filter: "all".to_owned(),
                tags: vec![],
            },
            friends_predicate_schema_version: 1,
            identity_mode: "all_content".to_owned(),
            limit: 32,
            query: "SQLite architecture".to_owned(),
            reader_session_id: "search-reader".to_owned(),
            recommendation_order_schema_version: 1,
            schema_version: 1,
        };
        assert_eq!(
            search_request_digest(&search_request).expect("search digest"),
            "5aceb922b5490c747e1453b87623add2482561f353921c833b39cb02c938b1cf"
        );
        let search_cursor = SearchPageCursorV1 {
            page: cursor.clone(),
            search_digest: "b".repeat(64),
        };
        let search_encoded = encode_search_cursor(&search_cursor).expect("encode search cursor");
        assert_eq!(
            decode_search_cursor(&search_encoded).expect("decode search cursor"),
            search_cursor
        );
        let browse_cursor = FeedBrowseCursorV2 {
            filter_digest: "60d920ddd5b896d7e24cb500f1ad80958fdaa871fa9707dad0faaf2631d75bb2"
                .to_owned(),
            generation_id: "a".repeat(64),
            transition_sequence: 12,
            projection_revision: 34,
            priority: 91,
            published_at: 1_780_000_000_000,
            global_id: "x:item-1".to_owned(),
        };
        let browse_encoded =
            encode_feed_browse_cursor(&browse_cursor).expect("encode browse cursor");
        assert_eq!(
            browse_encoded,
            "AqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqYNkg3dW4ltfiTLUA8a2AlY_aqHH6lwfa0PqvJjHXW7IAAAAAAAAADAAAAAAAAAAiWwAAAZ5wRIgAAAh4Oml0ZW0tMQ"
        );
        assert_eq!(
            decode_feed_browse_cursor(&browse_encoded).expect("decode browse cursor"),
            browse_cursor
        );
        let saved_cursor = SavedFeedCursorV2 {
            filter_digest: "9de41d87f30284b5a8370cfd14545afaa44d3a5edbbeb6785489bc9bb0731a45"
                .to_owned(),
            generation_id: "a".repeat(64),
            source_revision: 12,
            sort_mode: "recommended".to_owned(),
            sort_group: 90,
            sort_primary: 400,
            sort_secondary: 0,
            global_id: "saved:item-1".to_owned(),
        };
        let saved_encoded = encode_saved_feed_cursor(&saved_cursor).expect("encode saved cursor");
        assert_eq!(
            saved_encoded,
            "AgKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp3kHYfzAoS1qDcM_RRUWvqkTTpe2762eFSJvJuwcxpFAAAAAAAAAAxaAAAAAAAAAZAAAAAAAAAAAAAMc2F2ZWQ6aXRlbS0x"
        );
        assert_eq!(
            decode_saved_feed_cursor(&saved_encoded).expect("decode saved cursor"),
            saved_cursor
        );
    }

    #[test]
    fn native_secondary_surface_queries_return_only_bounded_view_rows() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        for query_id in ["map_markers_v1", "story_wall_candidates_v1"] {
            let program = SQLITE_QUERY_PROGRAMS
                .iter()
                .find(|program| program.query_id == query_id)
                .expect("secondary query program");
            let plan = connection
                .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
                .expect("secondary query plan")
                .query_map(params![10], |row| row.get::<_, String>(3))
                .expect("secondary plan rows")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("secondary plan");
            assert!(plan
                .iter()
                .any(|detail| detail.contains("library_feed_items_browse")));
            assert!(plan.iter().all(|detail| !detail.contains("TEMP B-TREE")));
        }
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, content_text,
                    location_name, location_lat, location_lng, hidden, saved, archived,
                    updated_at)
                   VALUES
                     ('visible', 'x', 'post', 300, 300, 'ada', 'ada', 'Ada',
                      'A compact caption', 'Observatory', 34.2, -118.2, 0, 0, 0, 300),
                     ('older', 'rss', 'article', 200, 200, 'grace', 'grace', 'Grace',
                      'An older caption', 'Library', 34.1, -118.1, 0, 0, 0, 200),
                     ('hidden', 'x', 'post', 400, 400, 'ada', 'ada', 'Ada',
                      'Not visible', 'Hidden place', 1.0, 2.0, 1, 0, 0, 400);
                 INSERT INTO library_feed_item_media
                   (global_id, ordinal, source_url, media_type)
                   VALUES ('visible', 0, 'https://example.test/image', 'image'),
                          ('older', 0, 'https://example.test/older', 'image'),
                          ('hidden', 0, 'https://example.test/hidden', 'image');",
                "a".repeat(64)
            ))
            .expect("secondary fixture");
        let map = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::MapMarkers(NormalizedMapMarkersRequestV1 {
                cancellation_id: "cancel-map-1".to_owned(),
                limit: 1,
                reader_session_id: "reader-map-1".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("map query");
        let NormalizedQueryResponseV1::MapMarkers(map) = map else {
            panic!("map response");
        };
        assert!(map.has_more);
        assert_eq!(map.rows[0].global_id, "visible");
        let story = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::StoryWallCandidates(NormalizedStoryWallCandidatesRequestV1 {
                cancellation_id: "cancel-story-1".to_owned(),
                limit: 1,
                reader_session_id: "reader-story-1".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("Story Wall query");
        let NormalizedQueryResponseV1::StoryWallCandidates(story) = story else {
            panic!("Story Wall response");
        };
        assert!(story.has_more);
        assert_eq!(story.rows[0].media_urls, ["https://example.test/image"]);
    }

    #[test]
    fn native_feed_browse_pages_both_directions_through_the_rank_index() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "feed_browse_page_v3")
            .expect("browse program");
        for sql in [
            program.sql,
            program.reverse_sql.expect("reverse browse program"),
        ] {
            let mut statement = connection
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("browse query plan");
            let plan = statement
                .query_map(
                    params![
                        0,
                        0,
                        Option::<String>::None,
                        Option::<String>::None,
                        Option::<String>::None,
                        "posts",
                        0,
                        "[]",
                        "[]",
                        "all_content",
                        Option::<i64>::None,
                        Option::<i64>::None,
                        "",
                        3
                    ],
                    |row| row.get::<_, String>(3),
                )
                .expect("browse plan rows")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("browse plan");
            assert!(plan
                .iter()
                .any(|detail| detail.contains("library_feed_items_browse_rank_all")));
            assert!(plan.iter().all(|detail| !detail.contains("TEMP B-TREE")));
        }
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, rss_feed_url,
                    priority, hidden, saved, archived, updated_at)
                   VALUES
                     ('a', 'x', 'post', 300, 300, 'ada', 'ada', 'Ada', NULL, 90.4, 0, 1, 0, 300),
                     ('b', 'x', 'post', 300, 300, 'ada', 'ada', 'Ada', NULL, 90.4, 0, 0, 0, 300),
                     ('c', 'saved', 'article', 400, 400, 'grace', 'grace', 'Grace', 'https://example.com/feed', 80, 0, 0, 0, 400),
                     ('story', 'x', 'story', 500, 500, 'ada', 'ada', 'Ada', NULL, 95, 0, 0, 0, 500),
                     ('hidden', 'x', 'post', 600, 600, 'ada', 'ada', 'Ada', NULL, 100, 1, 0, 0, 600),
                     ('archived', 'x', 'post', 700, 700, 'ada', 'ada', 'Ada', NULL, 99, 0, 0, 1, 700);
                 INSERT INTO library_feed_item_tags (global_id, tag)
                   VALUES ('a', 'important');
                 INSERT INTO library_feed_item_signal_scores (global_id, signal, score, tagged)
                   VALUES ('a', 'essay', 1.0, 1);
                 INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES
                     ('person-ada', 'Ada', 'friend', 5, 1, 1),
                     ('person-grace', 'Grace', 'connection', 3, 1, 1);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, first_seen_at,
                    last_seen_at, discovered_from, created_at, updated_at)
                   VALUES
                     ('account-ada', 'person-ada', 'social', 'x', 'ada', 1, 1, 'capture', 1, 1),
                     ('account-grace', 'person-grace', 'social', 'saved', 'grace', 1, 1, 'capture', 1, 1);",
                "a".repeat(64)
            ))
            .expect("browse fixture");
        let filter = NormalizedFeedBrowseFilterV1 {
            archived_only: false,
            author_id: None,
            feed_url: None,
            platform: None,
            saved_only: false,
            schema_version: 1,
            show_hidden: false,
            signals: vec![],
            social_content_filter: "posts".to_owned(),
            tags: vec![],
        };
        assert_eq!(
            feed_browse_filter_digest(&NormalizedFeedBrowseFilterV1 {
                archived_only: false,
                author_id: None,
                feed_url: None,
                platform: Some("x".to_owned()),
                saved_only: true,
                schema_version: 1,
                show_hidden: false,
                signals: vec!["essay".to_owned()],
                social_content_filter: "posts".to_owned(),
                tags: vec!["important".to_owned()],
            })
            .expect("filter digest"),
            "60d920ddd5b896d7e24cb500f1ad80958fdaa871fa9707dad0faaf2631d75bb2"
        );
        let request = NormalizedFeedBrowsePageRequestV3 {
            cancellation_id: "cancel-browse-1".to_owned(),
            cursor: None,
            direction: "next".to_owned(),
            filter,
            friends_predicate_schema_version: 1,
            identity_mode: "all_content".to_owned(),
            limit: 2,
            ranking_clock_ms: 1_000,
            reader_session_id: "reader-browse-1".to_owned(),
            recommendation_order_schema_version: 1,
            schema_version: 3,
        };
        let NormalizedQueryResponseV1::FeedBrowsePage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedBrowsePage(request.clone()),
        )
        .expect("first browse page") else {
            panic!("browse response");
        };
        assert_eq!(first.total_count, 3);
        assert_eq!(
            first
                .rows
                .iter()
                .map(|row| row.global_id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert!(first.previous_cursor.is_none());
        let NormalizedQueryResponseV1::FeedBrowsePage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedBrowsePage(NormalizedFeedBrowsePageRequestV3 {
                cursor: first.next_cursor.clone(),
                ..request.clone()
            }),
        )
        .expect("second browse page") else {
            panic!("browse response");
        };
        assert_eq!(second.rows[0].global_id, "c");
        assert!(second.next_cursor.is_none());
        let NormalizedQueryResponseV1::FeedBrowsePage(previous) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedBrowsePage(NormalizedFeedBrowsePageRequestV3 {
                cursor: second.previous_cursor,
                direction: "previous".to_owned(),
                ..request.clone()
            }),
        )
        .expect("previous browse page") else {
            panic!("browse response");
        };
        assert_eq!(
            previous
                .rows
                .iter()
                .map(|row| row.global_id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert!(previous.previous_cursor.is_none());
        assert!(previous.next_cursor.is_some());
        let NormalizedQueryResponseV1::FeedBrowsePage(friends) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedBrowsePage(NormalizedFeedBrowsePageRequestV3 {
                cursor: None,
                identity_mode: "friends".to_owned(),
                limit: 10,
                ..request.clone()
            }),
        )
        .expect("friends browse page") else {
            panic!("friends browse response");
        };
        assert_eq!(
            friends
                .rows
                .iter()
                .map(|row| row.global_id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        let changed_filter = NormalizedFeedBrowseFilterV1 {
            saved_only: true,
            ..request.filter.clone()
        };
        let changed_filter_error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedBrowsePage(NormalizedFeedBrowsePageRequestV3 {
                cursor: first.next_cursor,
                filter: changed_filter,
                ..request
            }),
        )
        .expect_err("changed filter cursor");
        assert!(changed_filter_error
            .to_string()
            .contains("belongs to a different filter"));
    }

    #[test]
    fn native_saved_feed_runs_all_orders_and_bidirectional_pages_in_sqlite() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "saved_feed_page_v2")
            .expect("saved program");
        let expected_indexes = [
            ("date_saved", "library_feed_items_saved_date_saved"),
            ("date_published", "library_feed_items_saved_date_published"),
            ("recommended", "library_feed_items_saved_recommended"),
            ("shortest_read", "library_feed_items_saved_shortest_read"),
        ];
        for (variant_id, index_name) in expected_indexes {
            let variant = program
                .variants
                .iter()
                .find(|variant| variant.variant_id == variant_id)
                .expect("saved variant");
            for sql in [variant.sql, variant.reverse_sql] {
                let mut statement = connection
                    .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                    .expect("saved query plan");
                let plan = statement
                    .query_map(
                        params![
                            0,
                            Option::<String>::None,
                            Option::<String>::None,
                            Option::<String>::None,
                            "all",
                            "[]",
                            "[]",
                            Option::<i64>::None,
                            Option::<i64>::None,
                            Option::<i64>::None,
                            "",
                            6,
                        ],
                        |row| row.get::<_, String>(3),
                    )
                    .expect("saved plan rows")
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .expect("saved plan");
                assert!(
                    plan.iter().any(|detail| detail.contains(index_name)),
                    "{variant_id} did not use {index_name}: {plan:?}"
                );
                assert!(plan.iter().all(|detail| !detail.contains("TEMP B-TREE")));
            }
        }
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 12, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 12 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, priority,
                    preserved_reading_time, hidden, saved, saved_at, archived,
                    updated_at)
                   VALUES
                     ('saved:a', 'saved', 'article', 50, 400, 'author', 'author', 'Author', 10, 5, 0, 1, 100, 0, 400),
                     ('saved:b', 'saved', 'article', 60, 100, 'author', 'author', 'Author', 90, NULL, 0, 1, 300, 0, 300),
                     ('saved:c', 'saved', 'article', 70, 300, 'author', 'author', 'Author', 90, 2, 0, 1, 200, 0, 300),
                     ('saved:d', 'saved', 'article', 80, 300, 'author', 'author', 'Author', 90, 2, 0, 1, 200, 0, 300),
                     ('saved:e', 'saved', 'article', 250, 0, 'author', 'author', 'Author', 20, 7, 0, 1, NULL, 0, 250),
                     ('hidden', 'saved', 'article', 900, 900, 'author', 'author', 'Author', 100, 1, 1, 1, 900, 0, 900),
                     ('unsaved', 'saved', 'article', 999, 999, 'author', 'author', 'Author', 100, 1, 0, 0, NULL, 0, 999);",
                "a".repeat(64)
            ))
            .expect("saved fixture");
        let filter = NormalizedFeedBrowseFilterV1 {
            archived_only: false,
            author_id: None,
            feed_url: None,
            platform: None,
            saved_only: true,
            schema_version: 1,
            show_hidden: false,
            signals: vec![],
            social_content_filter: "all".to_owned(),
            tags: vec![],
        };
        let expectations = [
            (
                "date_saved",
                vec!["saved:b", "saved:e", "saved:c", "saved:d", "saved:a"],
            ),
            (
                "date_published",
                vec!["saved:a", "saved:c", "saved:d", "saved:e", "saved:b"],
            ),
            (
                "recommended",
                vec!["saved:c", "saved:d", "saved:b", "saved:e", "saved:a"],
            ),
            (
                "shortest_read",
                vec!["saved:c", "saved:d", "saved:a", "saved:e", "saved:b"],
            ),
        ];
        for (sort_mode, expected) in expectations {
            let NormalizedQueryResponseV1::SavedFeedPage(response) = query_normalized_v1(
                &mut connection,
                NormalizedQueryRequestV1::SavedFeedPage(NormalizedSavedFeedPageRequestV2 {
                    cancellation_id: "cancel-saved-all".to_owned(),
                    cursor: None,
                    direction: "next".to_owned(),
                    filter: filter.clone(),
                    limit: 10,
                    reader_session_id: "reader-saved-all".to_owned(),
                    schema_version: 2,
                    sort_mode: sort_mode.to_owned(),
                }),
            )
            .expect("saved order") else {
                panic!("saved response");
            };
            assert_eq!(response.total_count, 5);
            assert_eq!(
                response
                    .rows
                    .iter()
                    .map(|row| row.card.global_id.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
        }
        let request = NormalizedSavedFeedPageRequestV2 {
            cancellation_id: "cancel-saved-pages".to_owned(),
            cursor: None,
            direction: "next".to_owned(),
            filter,
            limit: 2,
            reader_session_id: "reader-saved-pages".to_owned(),
            schema_version: 2,
            sort_mode: "date_saved".to_owned(),
        };
        let NormalizedQueryResponseV1::SavedFeedPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::SavedFeedPage(request.clone()),
        )
        .expect("first saved page") else {
            panic!("saved response");
        };
        let NormalizedQueryResponseV1::SavedFeedPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::SavedFeedPage(NormalizedSavedFeedPageRequestV2 {
                cursor: first.next_cursor,
                ..request.clone()
            }),
        )
        .expect("second saved page") else {
            panic!("saved response");
        };
        assert_eq!(
            second
                .rows
                .iter()
                .map(|row| row.card.global_id.as_str())
                .collect::<Vec<_>>(),
            ["saved:c", "saved:d"]
        );
        let NormalizedQueryResponseV1::SavedFeedPage(previous) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::SavedFeedPage(NormalizedSavedFeedPageRequestV2 {
                cursor: second.previous_cursor,
                direction: "previous".to_owned(),
                ..request
            }),
        )
        .expect("previous saved page") else {
            panic!("saved response");
        };
        assert_eq!(
            previous
                .rows
                .iter()
                .map(|row| row.card.global_id.as_str())
                .collect::<Vec<_>>(),
            ["saved:b", "saved:e"]
        );
    }

    #[test]
    fn native_facet_dispatch_aggregates_normalized_rows_in_binary_tag_order() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let facet_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "library_facet_summary_v1")
            .expect("facet program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", facet_program.sql))
            .expect("facet query plan");
        let plan = plan_statement
            .query_map([], |row| row.get::<_, String>(3))
            .expect("facet plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("facet plan");
        assert!(plan.iter().all(|detail| {
            !detail.contains("library_feed_items") && !detail.contains("library_feed_item_tags")
        }));
        drop(plan_statement);
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, hidden, saved,
                    archived, sample_batch_id, updated_at)
                   VALUES
                     ('item-1', 'saved', 'article', 100, 100, 'a', 'a', 'A', 0, 1, 1, 'sample-1', 100),
                     ('item-2', 'rss', 'article', 200, 200, 'b', 'b', 'B', 0, 1, 0, NULL, 200),
                     ('item-3', 'saved', 'post', 300, 300, 'c', 'c', 'C', 1, 0, 0, NULL, 300);
                 INSERT INTO library_feed_item_tags (global_id, tag)
                   VALUES ('item-1', '😀'), ('item-1', 'alpha'), ('item-2', '');
                 INSERT INTO library_rss_feeds
                   (url, title, enabled, track_unread, sample_batch_id, updated_at)
                   VALUES ('https://sample.test/feed', 'Sample', 1, 0, 'sample-1', 100);
                 INSERT INTO library_persons
                   (id, name, relationship_status, care_level, sample_batch_id,
                    created_at, updated_at)
                   VALUES ('person-1', 'Sample', 'friend', 3, 'sample-1', 100, 100);
                 INSERT INTO library_accounts
                   (id, kind, provider, external_id, first_seen_at, last_seen_at,
                    discovered_from, sample_batch_id, created_at, updated_at)
                   VALUES ('account-1', 'social', 'x', 'sample', 100, 100,
                           'sample', 'sample-1', 100, 100);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let NormalizedQueryResponseV1::FacetSummary(response) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FacetSummary(NormalizedFacetSummaryRequestV1 {
                schema_version: 1,
            }),
        )
        .expect("facet summary") else {
            panic!("facet response");
        };
        assert_eq!(response.source.projection_revision, 7);
        assert_eq!(response.summary.total_count, 3);
        assert_eq!(response.summary.archived_count, 1);
        assert_eq!(response.summary.unread_count, 3);
        assert_eq!(response.summary.archivable_count, 0);
        assert_eq!(response.summary.saved_count, 2);
        assert_eq!(response.summary.saved_archived_count, 1);
        assert_eq!(response.summary.saved_platform_count, 2);
        assert_eq!(response.summary.sample_item_count, 1);
        assert_eq!(response.summary.sample_feed_count, 1);
        assert_eq!(response.summary.sample_person_count, 1);
        assert_eq!(response.summary.sample_account_count, 1);
        assert_eq!(response.summary.rss_feed_count, 1);
        assert_eq!(response.summary.enabled_rss_feed_count, 1);
        assert_eq!(response.summary.friend_person_count, 1);
        assert_eq!(response.summary.social_account_count, 1);
        assert_eq!(response.summary.platform_counts.len(), 2);
        assert_eq!(response.summary.platform_counts[0].platform, "rss");
        assert_eq!(response.summary.platform_counts[0].total_count, 1);
        assert_eq!(response.summary.platform_counts[1].platform, "saved");
        assert_eq!(response.summary.platform_counts[1].total_count, 2);
        assert_eq!(response.summary.tags, ["alpha", "\u{e000}", "😀"]);

        connection
            .execute_batch(
                "UPDATE library_feed_items
                   SET saved = 0, archived = 1, sample_batch_id = 'sample-2'
                   WHERE global_id = 'item-2';
                 UPDATE library_feed_items SET hidden = 0, read_at = 500
                   WHERE global_id = 'item-3';
                 DELETE FROM library_feed_items WHERE global_id = 'item-1';
                 UPDATE library_rss_feeds SET enabled = 0
                   WHERE url = 'https://sample.test/feed';
                 UPDATE library_persons SET relationship_status = 'connection'
                   WHERE id = 'person-1';
                 UPDATE library_accounts SET kind = 'contact'
                   WHERE id = 'account-1';",
            )
            .expect("update fixture");
        let NormalizedQueryResponseV1::FacetSummary(updated) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FacetSummary(NormalizedFacetSummaryRequestV1 {
                schema_version: 1,
            }),
        )
        .expect("updated facet summary") else {
            panic!("facet response");
        };
        assert_eq!(updated.summary.total_count, 2);
        assert_eq!(updated.summary.archived_count, 1);
        assert_eq!(updated.summary.unread_count, 1);
        assert_eq!(updated.summary.archivable_count, 1);
        assert_eq!(updated.summary.saved_count, 0);
        assert_eq!(updated.summary.saved_archived_count, 0);
        assert_eq!(updated.summary.saved_platform_count, 0);
        assert_eq!(updated.summary.sample_item_count, 1);
        assert_eq!(updated.summary.rss_feed_count, 1);
        assert_eq!(updated.summary.enabled_rss_feed_count, 0);
        assert_eq!(updated.summary.friend_person_count, 0);
        assert_eq!(updated.summary.social_account_count, 0);
        assert_eq!(updated.summary.tags, ["\u{e000}"]);
    }

    #[test]
    fn native_filter_scope_summary_resolves_one_indexed_identity() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 9, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 9 WHERE singleton_id = 1;
                 INSERT INTO library_rss_feeds
                   (url, title, enabled, track_unread, updated_at)
                   VALUES ('https://alpha.example/feed', 'Alpha', 1, 0, 100);
                 INSERT INTO library_accounts
                   (id, kind, provider, external_id, handle, display_name,
                    first_seen_at, last_seen_at, discovered_from, created_at, updated_at)
                   VALUES ('account-1', 'social', 'x', 'ada-remote', 'ada',
                           'Countess Ada', 100, 100, 'capture', 100, 100);
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, rss_feed_url,
                    hidden, saved, archived, updated_at)
                   VALUES
                     ('rss-1', 'rss', 'article', 100, 100, 'alpha', 'alpha',
                      'Alpha', 'https://alpha.example/feed', 0, 0, 0, 100),
                     ('rss-hidden', 'rss', 'article', 101, 101, 'alpha', 'alpha',
                      'Alpha', 'https://alpha.example/feed', 1, 0, 0, 101),
                     ('x-1', 'x', 'post', 200, 200, 'ada-remote', 'ada',
                      'Countess Ada', NULL, 0, 0, 0, 200);",
                "a".repeat(64)
            ))
            .expect("fixture");

        let NormalizedQueryResponseV1::FilterScopeSummary(feed) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FilterScopeSummary(NormalizedFilterScopeSummaryRequestV1 {
                author_id: None,
                feed_url: Some("https://alpha.example/feed".to_owned()),
                platform: None,
                schema_version: 1,
            }),
        )
        .expect("feed scope") else {
            panic!("filter scope response");
        };
        assert_eq!(feed.label.as_deref(), Some("Alpha"));
        assert_eq!(feed.item_count, 1);
        assert_eq!(feed.source.projection_revision, 9);

        let NormalizedQueryResponseV1::FilterScopeSummary(author) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FilterScopeSummary(NormalizedFilterScopeSummaryRequestV1 {
                author_id: Some("ada-remote".to_owned()),
                feed_url: None,
                platform: Some("x".to_owned()),
                schema_version: 1,
            }),
        )
        .expect("author scope") else {
            panic!("filter scope response");
        };
        assert_eq!(author.label.as_deref(), Some("Countess Ada"));
        assert_eq!(author.item_count, 1);

        let NormalizedQueryResponseV1::FilterScopeSummary(missing) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FilterScopeSummary(NormalizedFilterScopeSummaryRequestV1 {
                author_id: None,
                feed_url: Some("https://missing.example/feed".to_owned()),
                platform: None,
                schema_version: 1,
            }),
        )
        .expect("missing scope") else {
            panic!("filter scope response");
        };
        assert_eq!(missing.label, None);
        assert_eq!(missing.item_count, 0);

        let invalid = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FilterScopeSummary(NormalizedFilterScopeSummaryRequestV1 {
                author_id: Some("ada-remote".to_owned()),
                feed_url: Some("https://alpha.example/feed".to_owned()),
                platform: Some("x".to_owned()),
                schema_version: 1,
            }),
        )
        .expect_err("mixed scope must fail");
        assert_eq!(
            invalid.to_string(),
            "normalized filter scope summary identity is invalid"
        );
    }

    #[test]
    fn native_saved_analytics_dispatch_returns_one_source_fenced_aggregate() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let analytics_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "saved_analytics_v2")
            .expect("saved analytics program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", analytics_program.sql))
            .expect("saved analytics query plan");
        let plan = plan_statement
            .query_map(params!["[]", "[]"], |row| row.get::<_, String>(3))
            .expect("saved analytics plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("saved analytics plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("library_feed_items_saved")));
        drop(plan_statement);
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, hidden, saved,
                    saved_at, archived, updated_at)
                   VALUES
                     ('item-1', 'rss', 'article', 100, 100, 'a', 'a', 'A', 0, 1, 150, 0, 100),
                     ('item-2', 'saved', 'video', 200, 200, 'b', 'b', 'B', 0, 1, NULL, 0, 200),
                     ('item-3', 'saved', 'post', 300, 300, 'c', 'c', 'C', 0, 0, NULL, 0, 300);",
                "a".repeat(64)
            ))
            .expect("analytics fixture");
        let windows = |count: usize| {
            (0..count)
                .map(|index| NormalizedSavedAnalyticsWindowV2 {
                    end_ms: ((index + 1) * 100) as i64,
                    start_ms: (index * 100) as i64,
                })
                .collect::<Vec<_>>()
        };
        let NormalizedQueryResponseV1::SavedAnalytics(response) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::SavedAnalytics(NormalizedSavedAnalyticsRequestV2 {
                daily_windows: windows(7),
                hourly_windows: windows(24),
                schema_version: 2,
            }),
        )
        .expect("saved analytics") else {
            panic!("saved analytics response");
        };
        assert_eq!(response.source.projection_revision, 7);
        assert_eq!(response.total_count, 2);
        assert_eq!(response.latest_saved_at, Some(200));
        assert_eq!(response.daily_counts, [0, 1, 1, 0, 0, 0, 0]);
        assert_eq!(
            response.source_counts,
            [
                NormalizedSavedAnalyticsCountV2 {
                    count: 1,
                    label: "rss".to_owned(),
                },
                NormalizedSavedAnalyticsCountV2 {
                    count: 1,
                    label: "saved".to_owned(),
                },
            ]
        );
        assert_eq!(
            response.content_mix,
            [
                NormalizedSavedAnalyticsCountV2 {
                    count: 1,
                    label: "article".to_owned(),
                },
                NormalizedSavedAnalyticsCountV2 {
                    count: 1,
                    label: "video".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn native_query_dispatch_pages_generated_sql_and_rejects_a_stale_cursor() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, hidden, saved,
                    archived, updated_at)
                   VALUES
                     ('item-2', 'saved', 'article', 200, 200, 'author-1', 'ada', 'Ada', 0, 1, 0, 200),
                     ('item-1', 'rss', 'article', 100, 100, 'author-2', 'grace', 'Grace', 0, 0, 0, 100),
                     ('hidden', 'saved', 'post', 300, 300, 'author-3', 'hidden', 'Hidden', 1, 0, 0, 300);
                 INSERT INTO library_feed_item_tags (global_id, tag)
                   VALUES ('item-2', 'favorite');",
                "a".repeat(64)
            ))
            .expect("fixture");
        let request = NormalizedFeedPageRequestV1 {
            cancellation_id: "cancel-1".to_owned(),
            cursor: None,
            limit: 1,
            reader_session_id: "reader-1".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::FeedPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedPage(request.clone()),
        )
        .expect("first page") else {
            panic!("feed page response");
        };
        assert_eq!(first.total_count, 2);
        assert_eq!(first.rows[0].global_id, "item-2");
        assert_eq!(first.rows[0].tags, ["favorite"]);
        let cursor = first.next_cursor.expect("cursor");
        assert_eq!(
            cursor,
            "AaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAAAAAcAAAAAAAAABwAAAAAAAADIAAZpdGVtLTI"
        );
        let NormalizedQueryResponseV1::FeedPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedPage(NormalizedFeedPageRequestV1 {
                cursor: Some(cursor.clone()),
                ..request.clone()
            }),
        )
        .expect("second page") else {
            panic!("feed page response");
        };
        assert_eq!(second.rows[0].global_id, "item-1");
        assert!(second.next_cursor.is_none());
        connection
            .execute_batch(
                "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;
                 UPDATE library_change_state SET revision = 8 WHERE singleton_id = 1;",
            )
            .expect("advance revision");
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::FeedPage(NormalizedFeedPageRequestV1 {
                cursor: Some(cursor),
                ..request
            }),
        )
        .expect_err("stale cursor");
        assert!(error.to_string().contains("cursor is stale"));
    }

    #[test]
    fn native_identity_timelines_use_indexes_and_bind_their_cursors() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "person_timeline_v1")
            .expect("person timeline program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
            .expect("person timeline plan");
        let plan = plan_statement
            .query_map(params!["person-1", Option::<i64>::None, "", 2], |row| {
                row.get::<_, String>(3)
            })
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("plan");
        assert!(plan.iter().any(|detail| {
            detail.contains("SEARCH timeline USING PRIMARY KEY")
                || detail.contains("SEARCH timeline USING INDEX")
        }));
        assert!(plan.iter().all(|detail| !detail.contains("SCAN timeline")));
        assert!(plan.iter().all(|detail| !detail.contains("TEMP B-TREE")));
        drop(plan_statement);
        let account_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "account_timeline_v1")
            .expect("account timeline program");
        let mut account_plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", account_program.sql))
            .expect("account timeline plan");
        let account_plan = account_plan_statement
            .query_map(params!["account-1", Option::<i64>::None, "", 2], |row| {
                row.get::<_, String>(3)
            })
            .expect("account plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("account plan");
        assert!(account_plan.iter().any(|detail| {
            detail.contains("SEARCH account USING") || detail.contains("SEARCH item USING INDEX")
        }));
        assert!(account_plan
            .iter()
            .all(|detail| !detail.contains("TEMP B-TREE")));
        drop(account_plan_statement);

        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES ('person-1', 'Ada', 'friend', 5, 1, 1),
                          ('person-2', 'Grace', 'friend', 4, 1, 1);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, first_seen_at,
                    last_seen_at, discovered_from, created_at, updated_at)
                   VALUES ('account-1', 'person-1', 'social', 'x', 'ada', 1, 1, 'capture', 1, 1),
                          ('account-2', 'person-1', 'social', 'rss', 'grace', 1, 1, 'capture', 1, 1);
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, hidden, saved,
                    archived, updated_at)
                   VALUES ('item-2', 'x', 'article', 200, 200, 'ada', 'ada', 'Ada', 0, 0, 0, 200),
                          ('item-1', 'rss', 'article', 100, 100, 'grace', 'grace', 'Grace', 0, 0, 0, 100),
                          ('other', 'x', 'post', 300, 300, 'other', 'other', 'Other', 0, 0, 0, 300);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let request = NormalizedPersonTimelineRequestV1 {
            cancellation_id: "cancel-person-1".to_owned(),
            cursor: None,
            limit: 1,
            person_id: "person-1".to_owned(),
            reader_session_id: "reader-person-1".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::PersonTimeline(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonTimeline(request.clone()),
        )
        .expect("first person timeline page") else {
            panic!("person timeline response");
        };
        assert_eq!(first.total_count, 2);
        assert_eq!(first.rows[0].global_id, "item-2");
        let cursor = first.next_cursor.expect("person timeline cursor");
        let NormalizedQueryResponseV1::PersonTimeline(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonTimeline(NormalizedPersonTimelineRequestV1 {
                cursor: Some(cursor.clone()),
                ..request.clone()
            }),
        )
        .expect("second person timeline page") else {
            panic!("person timeline response");
        };
        assert_eq!(second.rows[0].global_id, "item-1");
        assert!(second.next_cursor.is_none());
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonTimeline(NormalizedPersonTimelineRequestV1 {
                cursor: Some(cursor),
                person_id: "person-2".to_owned(),
                ..request
            }),
        )
        .expect_err("cursor for another person");
        assert!(error.to_string().contains("cursor is stale"));

        let NormalizedQueryResponseV1::AccountTimeline(account_timeline) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::AccountTimeline(NormalizedAccountTimelineRequestV1 {
                account_id: "account-1".to_owned(),
                cancellation_id: "cancel-account-1".to_owned(),
                cursor: None,
                limit: 10,
                reader_session_id: "reader-account-1".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("account timeline") else {
            panic!("account timeline response");
        };
        assert_eq!(account_timeline.total_count, 1);
        assert_eq!(account_timeline.rows[0].global_id, "item-2");
        assert_eq!(account_timeline.query_id, "account_timeline_v1");

        connection
            .execute(
                "UPDATE library_accounts SET person_id = 'person-2' WHERE id = 'account-1';",
                [],
            )
            .expect("reassign account");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_person_feed_items WHERE person_id = 'person-1';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("person one derived rows"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_person_feed_items WHERE person_id = 'person-2';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("person two derived rows"),
            1
        );
    }

    #[test]
    fn native_item_scan_uses_primary_key_pages_and_includes_background_rows() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "background_item_page_v1")
            .expect("item scan program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
            .expect("item scan plan");
        let plan = plan_statement
            .query_map(params![Option::<String>::None, 3], |row| {
                row.get::<_, String>(3)
            })
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("SEARCH item USING INDEX")));
        assert!(plan.iter().all(|detail| !detail.contains("SCAN item")));
        assert!(plan.iter().all(|detail| !detail.contains("TEMP B-TREE")));
        drop(plan_statement);

        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, hidden, saved,
                    archived, updated_at)
                   VALUES
                     ('item-2', 'saved', 'article', 200, 200, 'author-1', 'ada',
                      'Ada', 0, 1, 1, 200),
                     ('item-1', 'rss', 'article', 100, 100, 'author-2', 'grace',
                      'Grace', 0, 0, 0, 100),
                     ('hidden', 'saved', 'post', 300, 300, 'author-3', 'hidden',
                      'Hidden', 1, 0, 0, 300);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let request = NormalizedItemScanRequestV1 {
            cancellation_id: "cancel-scan-1".to_owned(),
            cursor: None,
            limit: 2,
            reader_session_id: "reader-scan-1".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::ItemScan(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ItemScan(request.clone()),
        )
        .expect("first item scan page") else {
            panic!("item scan response");
        };
        assert_eq!(
            first
                .rows
                .iter()
                .map(|row| row.card.global_id.as_str())
                .collect::<Vec<_>>(),
            ["hidden", "item-1"]
        );
        assert!(first.rows[0].hidden);
        let cursor = first.next_cursor.expect("item scan cursor");
        let NormalizedQueryResponseV1::ItemScan(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ItemScan(NormalizedItemScanRequestV1 {
                cursor: Some(cursor.clone()),
                ..request.clone()
            }),
        )
        .expect("second item scan page") else {
            panic!("item scan response");
        };
        assert_eq!(second.rows[0].card.global_id, "item-2");
        assert_eq!(second.rows[0].card.archived, Some(true));
        assert!(second.next_cursor.is_none());

        connection
            .execute_batch(
                "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;
                 UPDATE library_change_state SET revision = 8 WHERE singleton_id = 1;",
            )
            .expect("advance revision");
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ItemScan(NormalizedItemScanRequestV1 {
                cursor: Some(cursor),
                ..request
            }),
        )
        .expect_err("stale item scan cursor");
        assert!(error.to_string().contains("cursor is stale"));
    }

    #[test]
    fn native_content_fetch_pages_exclude_materialized_bodies_and_bind_cursors() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "content_fetch_claim_v1")
            .expect("content fetch program");
        let plan = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
            .expect("content fetch plan")
            .query_map(params![Option::<i64>::None, "", 2], |row| {
                row.get::<_, String>(3)
            })
            .expect("content fetch plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("content fetch plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("library_feed_items_content_fetch")));
        assert!(plan.iter().all(|detail| !detail.contains("TEMP B-TREE")));
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, link_url,
                    preserved_text, hidden, saved, archived, updated_at)
                   VALUES
                     ('saved:newest', 'saved', 'article', 300, 300,
                      'author-1', 'newest', 'Newest',
                      'https://example.test/newest', NULL, 1, 0, 0, 300),
                     ('saved:materialized', 'saved', 'article', 200, 200,
                      'author-2', 'materialized', 'Materialized',
                      'https://example.test/materialized', 'already here', 0, 0, 0, 200),
                     ('rss:oldest', 'rss', 'article', 100, 100,
                      'author-3', 'oldest', 'Oldest',
                      'https://example.test/oldest', NULL, 0, 0, 0, 100);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let request = NormalizedContentFetchPageRequestV1 {
            cancellation_id: "cancel-content-fetch-1".to_owned(),
            cursor: None,
            limit: 1,
            reader_session_id: "reader-content-fetch-1".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::ContentFetchPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ContentFetchPage(request.clone()),
        )
        .expect("first content fetch page") else {
            panic!("content fetch response");
        };
        assert_eq!(first.rows[0].global_id, "saved:newest");
        let cursor = first.next_cursor.expect("content fetch cursor");
        let NormalizedQueryResponseV1::ContentFetchPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ContentFetchPage(NormalizedContentFetchPageRequestV1 {
                cursor: Some(cursor.clone()),
                ..request.clone()
            }),
        )
        .expect("second content fetch page") else {
            panic!("content fetch response");
        };
        assert_eq!(second.rows[0].global_id, "rss:oldest");
        assert!(second.next_cursor.is_none());
        connection
            .execute_batch(
                "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;
                 UPDATE library_change_state SET revision = 8 WHERE singleton_id = 1;",
            )
            .expect("advance revision");
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ContentFetchPage(NormalizedContentFetchPageRequestV1 {
                cursor: Some(cursor),
                ..request
            }),
        )
        .expect_err("stale content fetch cursor");
        assert!(error.to_string().contains("cursor is stale"));
    }

    #[test]
    fn native_provider_media_pages_bind_provider_and_saved_mode() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, source_url,
                    link_url, fb_group_id, fb_group_name, fb_group_url, hidden,
                    saved, archived, updated_at)
                   VALUES
                     ('facebook-1', 'facebook', 'video', 1, 1, 'author-1', 'one',
                      'One', 'https://facebook.test/1', 'https://example.test/1',
                      'group-1', 'Group', 'https://facebook.test/groups/1', 0, 1, 0, 1),
                     ('facebook-2', 'facebook', 'video', 2, 2, 'author-2', 'two',
                      'Two', 'https://facebook.test/2', NULL, NULL, NULL, NULL, 0, 0, 0, 2),
                     ('instagram-1', 'instagram', 'video', 3, 3, 'author-3', 'three',
                      'Three', 'https://instagram.test/1', NULL, NULL, NULL, NULL, 0, 1, 0, 3),
                     ('saved-youtube', 'saved', 'article', 4, 4, 'author-4', 'four',
                      'Four', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', NULL, NULL, NULL, 0, 1, 0, 4);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let request = NormalizedProviderMediaPageRequestV1 {
            cancellation_id: "cancel-provider-media-1".to_owned(),
            cursor: None,
            limit: 1,
            provider: "facebook".to_owned(),
            reader_session_id: "reader-provider-media-1".to_owned(),
            saved_only: false,
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::ProviderMediaPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ProviderMediaPage(request.clone()),
        )
        .expect("first provider page") else {
            panic!("provider media response");
        };
        assert_eq!(first.rows[0].card.global_id, "facebook-1");
        assert_eq!(
            first.rows[0]
                .fb_group
                .as_ref()
                .map(|group| group.id.as_str()),
            Some("group-1")
        );
        let cursor = first.next_cursor.expect("provider cursor");
        let NormalizedQueryResponseV1::ProviderMediaPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ProviderMediaPage(NormalizedProviderMediaPageRequestV1 {
                cursor: Some(cursor.clone()),
                ..request.clone()
            }),
        )
        .expect("second provider page") else {
            panic!("provider media response");
        };
        assert_eq!(second.rows[0].card.global_id, "facebook-2");
        assert!(second.next_cursor.is_none());
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ProviderMediaPage(NormalizedProviderMediaPageRequestV1 {
                cursor: Some(cursor),
                saved_only: true,
                ..request
            }),
        )
        .expect_err("cursor reused across saved mode");
        assert!(error.to_string().contains("cursor is stale"));
        let NormalizedQueryResponseV1::ProviderMediaPage(saved_youtube) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ProviderMediaPage(NormalizedProviderMediaPageRequestV1 {
                cancellation_id: "cancel-provider-youtube-1".to_owned(),
                cursor: None,
                limit: 2,
                provider: "youtube".to_owned(),
                reader_session_id: "reader-provider-youtube-1".to_owned(),
                saved_only: true,
                schema_version: 1,
            }),
        )
        .expect("saved YouTube candidates") else {
            panic!("provider media response");
        };
        assert_eq!(
            saved_youtube
                .rows
                .iter()
                .map(|row| row.card.global_id.as_str())
                .collect::<Vec<_>>(),
            ["saved-youtube"]
        );
    }

    #[test]
    fn native_change_feed_pins_an_upper_revision_and_rejects_gaps() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "change_feed_v1")
            .expect("change-feed program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
            .expect("change-feed plan");
        let plan = plan_statement
            .query_map(params![7, 0, 255, 5], |row| row.get::<_, String>(3))
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("SEARCH library_invalidations USING PRIMARY KEY")));
        assert!(plan.iter().all(|detail| !detail.contains("SCAN")));
        assert!(plan.iter().all(|detail| !detail.contains("TEMP B-TREE")));
        drop(plan_statement);

        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_invalidations
                   (revision, ordinal, topic, entity_id, reset_required)
                   VALUES
                     (1, 0, 'library', NULL, 1),
                     (2, 0, 'feed_item', 'item-1', 0),
                     (3, 0, 'feed_item', 'item-2', 0),
                     (4, 0, 'preferences', NULL, 0),
                     (5, 0, 'feed_item', 'item-3', 0),
                     (6, 0, 'feed_item', 'item-4', 0),
                     (7, 0, 'feed_item', 'item-5', 0);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let request = NormalizedChangeFeedRequestV1 {
            after_revision: 0,
            cancellation_id: "cancel-changes-1".to_owned(),
            cursor: None,
            limit: 4,
            reader_session_id: "reader-changes-1".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::ChangeFeed(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ChangeFeed(request.clone()),
        )
        .expect("first change-feed page") else {
            panic!("change-feed response");
        };
        assert_eq!(
            first
                .rows
                .iter()
                .map(|row| row.revision)
                .collect::<Vec<_>>(),
            [1, 2, 3, 4]
        );
        assert!(first.rows[0].reset_required);
        let cursor = first.next_cursor.expect("change-feed cursor");

        connection
            .execute_batch(
                "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;
                 UPDATE library_change_state SET revision = 8 WHERE singleton_id = 1;
                 INSERT INTO library_invalidations
                   (revision, ordinal, topic, entity_id, reset_required)
                   VALUES (8, 0, 'feed_item', 'item-6', 0);",
            )
            .expect("advance source");
        let NormalizedQueryResponseV1::ChangeFeed(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ChangeFeed(NormalizedChangeFeedRequestV1 {
                cursor: Some(cursor),
                ..request.clone()
            }),
        )
        .expect("second change-feed page") else {
            panic!("change-feed response");
        };
        assert_eq!(
            second
                .rows
                .iter()
                .map(|row| row.revision)
                .collect::<Vec<_>>(),
            [5, 6, 7]
        );
        assert_eq!(second.source.projection_revision, 7);
        assert!(second.next_cursor.is_none());

        connection
            .execute("DELETE FROM library_invalidations WHERE revision = 6;", [])
            .expect("create gap");
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ChangeFeed(NormalizedChangeFeedRequestV1 {
                after_revision: 4,
                cursor: None,
                limit: 512,
                ..request
            }),
        )
        .expect_err("change-feed gap");
        assert!(error.to_string().contains("revision gap"));

        connection
            .execute_batch(
                "DELETE FROM library_invalidations;
                 INSERT INTO library_invalidations
                   (revision, ordinal, topic, entity_id, reset_required)
                   VALUES (8, 0, 'library', NULL, 1);",
            )
            .expect("replace gap with reset");
        let NormalizedQueryResponseV1::ChangeFeed(reset) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ChangeFeed(NormalizedChangeFeedRequestV1 {
                after_revision: 0,
                cursor: None,
                limit: 1,
                cancellation_id: "cancel-reset-1".to_owned(),
                reader_session_id: "reader-reset-1".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("reset closes historical gap") else {
            panic!("change-feed response");
        };
        assert!(reset.rows[0].reset_required);
        assert_eq!(reset.rows[0].revision, 8);
    }

    #[test]
    fn native_preferences_dispatch_returns_closed_nodes_in_binary_order() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 9, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 9 WHERE singleton_id = 1;
                 INSERT INTO library_preferences
                   (path, value_type, boolean_value, integer_value, real_value,
                    text_value, updated_at)
                   VALUES
                     ('v:$.zeta', 'boolean', 1, NULL, NULL, NULL, 1),
                     ('v:$.alpha', 'integer', NULL, 3, NULL, NULL, 2),
                     ('v:$.nullValue', 'null', NULL, NULL, NULL, NULL, 3),
                     ('v:$.realValue', 'real', NULL, NULL, 0.5, NULL, 4),
                     ('v:$.textValue', 'text', NULL, NULL, NULL, 'neon', 5),
                     ('v:$.zero', 'boolean', 0, NULL, NULL, NULL, 6);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let NormalizedQueryResponseV1::PreferencesSnapshot(response) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PreferencesSnapshot(NormalizedPreferencesSnapshotRequestV1 {
                schema_version: 1,
            }),
        )
        .expect("preferences snapshot") else {
            panic!("preferences response");
        };
        assert_eq!(response.source.projection_revision, 9);
        assert_eq!(
            response
                .rows
                .iter()
                .map(|row| row.path.as_str())
                .collect::<Vec<_>>(),
            [
                "v:$.alpha",
                "v:$.nullValue",
                "v:$.realValue",
                "v:$.textValue",
                "v:$.zero",
                "v:$.zeta"
            ]
        );
        assert_eq!(response.rows[0].integer_value, Some(3));
        assert_eq!(response.rows[2].real_value, Some(0.5));
        assert_eq!(response.rows[3].text_value.as_deref(), Some("neon"));
    }

    #[test]
    fn native_item_detail_returns_metadata_and_body_locators_without_bodies() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let item_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "item_detail_v1")
            .expect("item detail program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", item_program.sql))
            .expect("item detail plan");
        let plan = plan_statement
            .query_map(["item-1"], |row| row.get::<_, String>(3))
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("SEARCH item USING INDEX")));
        assert!(plan.iter().all(|detail| !detail.contains("SCAN item")));
        drop(plan_statement);
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 11, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 11 WHERE singleton_id = 1;
                 INSERT INTO library_blobs
                   (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
                   VALUES ('{}', 70000, 65536, 2, 'text/plain');
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, content_text,
                    preserved_text_blob_digest, hidden, saved, archived, updated_at)
                   VALUES
                     ('item-1', 'saved', 'article', 100, 100, 'author-1', 'ada',
                      'Ada', 'preview and body', '{}', 1, 1, 1, 100);",
                "a".repeat(64),
                "b".repeat(64),
                "b".repeat(64),
            ))
            .expect("fixture");
        let NormalizedQueryResponseV1::ItemDetail(response) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ItemDetail(NormalizedItemDetailRequestV1 {
                global_id: "item-1".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("item detail") else {
            panic!("item detail response");
        };
        let response = *response;
        let item = response.item.expect("item");
        assert_eq!(item.card.global_id, "item-1");
        assert_eq!(item.card.content_text.as_deref(), Some("preview and body"));
        assert_eq!(item.content_body.storage, "inline");
        assert_eq!(item.content_body.blob_digest, None);
        assert_eq!(item.preserved_body.storage, "blob");
        let digest = "b".repeat(64);
        assert_eq!(
            item.preserved_body.blob_digest.as_deref(),
            Some(digest.as_str())
        );
        assert!(!serde_json::to_string(&item)
            .expect("json")
            .contains("preservedText"));
    }

    #[test]
    fn native_person_detail_returns_one_bounded_normalized_record() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 12, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 12 WHERE singleton_id = 1;
                 INSERT INTO library_persons
                   (id, name, avatar_url, bio, relationship_status, care_level,
                    reach_out_interval_days, notes, created_at, updated_at)
                   VALUES ('person-1', 'Ada', 'https://example.com/ada',
                           'Mathematician', 'friend', 5, 14, 'Write soon', 50, 200);
                 INSERT INTO library_person_tags (person_id, tag)
                   VALUES ('person-1', 'science'), ('person-1', 'close');
                 INSERT INTO library_person_reach_outs
                   (person_id, reach_out_id, logged_at, channel, notes)
                   VALUES ('person-1', 'reach-1', 100, NULL, NULL),
                          ('person-1', 'reach-2', 200, 'text', 'Latest');",
                "a".repeat(64)
            ))
            .expect("fixture");
        let NormalizedQueryResponseV1::PersonDetail(response) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonDetail(NormalizedPersonDetailRequestV1 {
                person_id: "person-1".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("person detail") else {
            panic!("person detail response");
        };
        let person = response.person.expect("person");
        assert_eq!(person.id, "person-1");
        assert_eq!(person.tags, ["close", "science"]);
        assert_eq!(person.reach_outs.len(), 2);
        assert_eq!(person.reach_outs[0].reach_out_id, "reach-2");
        assert_eq!(person.reach_outs[1].reach_out_id, "reach-1");

        let NormalizedQueryResponseV1::PersonDetail(missing) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonDetail(NormalizedPersonDetailRequestV1 {
                person_id: "missing".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("missing person detail") else {
            panic!("person detail response");
        };
        assert!(missing.person.is_none());
    }

    #[test]
    fn native_account_detail_returns_one_bounded_normalized_record() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 12, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 12 WHERE singleton_id = 1;
                 INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES ('person-1', 'Ada', 'friend', 5, 50, 200);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, handle, display_name,
                    first_seen_at, last_seen_at, discovered_from, follow_roster_active,
                    follow_roster_synced_at, created_at, updated_at)
                   VALUES ('account-1', 'person-1', 'social', 'x', 'ada-remote',
                           'ada', 'Ada', 50, 200, 'capture', 1, 200, 50, 200);
                 INSERT INTO library_account_follow_roles (account_id, role)
                   VALUES ('account-1', 'following'), ('account-1', 'follower');",
                "a".repeat(64)
            ))
            .expect("fixture");
        let account_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "account_detail_v1")
            .expect("account detail program");
        let plan = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", account_program.sql))
            .expect("account detail plan")
            .query_map(params!["account-1"], |row| row.get::<_, String>(3))
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("SEARCH account USING INDEX")));
        assert!(plan
            .iter()
            .all(|detail| !detail.contains("USE TEMP B-TREE")));

        let NormalizedQueryResponseV1::AccountDetail(response) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::AccountDetail(NormalizedAccountDetailRequestV1 {
                account_id: "account-1".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("account detail") else {
            panic!("account detail response");
        };
        let account = response.account.expect("account");
        assert_eq!(account.id, "account-1");
        assert_eq!(account.person_id.as_deref(), Some("person-1"));
        assert_eq!(account.follow_roster_roles, ["follower", "following"]);

        let NormalizedQueryResponseV1::AccountDetail(missing) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::AccountDetail(NormalizedAccountDetailRequestV1 {
                account_id: "missing".to_owned(),
                schema_version: 1,
            }),
        )
        .expect("missing account detail") else {
            panic!("account detail response");
        };
        assert!(missing.account.is_none());
    }

    #[test]
    fn native_rss_feed_detail_returns_every_synchronized_field() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 13, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 13 WHERE singleton_id = 1;
                 INSERT INTO library_rss_feeds
                   (url, title, site_url, last_fetched, image_url, enabled,
                    poll_interval, track_unread, folder, sample_batch_id,
                    sample_generated_at, sample_generator_version, updated_at)
                   VALUES ('https://example.com/feed.xml', 'Example Feed',
                           'https://example.com', '30',
                           'https://example.com/icon.png', 1, 15, 1,
                           'Research', 'sample-batch', 10, 1, 40);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "rss_feed_detail_v1")
            .expect("RSS Feed detail program");
        let plan = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
            .expect("RSS Feed detail plan")
            .query_map(params!["https://example.com/feed.xml"], |row| {
                row.get::<_, String>(3)
            })
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("SEARCH feed USING INDEX")));

        let NormalizedQueryResponseV1::RssFeedDetail(response) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::RssFeedDetail(NormalizedRssFeedDetailRequestV1 {
                schema_version: 1,
                url: "https://example.com/feed.xml".to_owned(),
            }),
        )
        .expect("RSS Feed detail") else {
            panic!("RSS Feed detail response");
        };
        let feed = response.feed.expect("feed");
        assert_eq!(feed.title, "Example Feed");
        assert_eq!(feed.site_url.as_deref(), Some("https://example.com"));
        assert_eq!(feed.last_fetched, Some(30));
        assert_eq!(feed.poll_interval, Some(15));
        assert!(feed.track_unread);
        assert_eq!(feed.folder.as_deref(), Some("Research"));
        assert_eq!(feed.sample_batch_id.as_deref(), Some("sample-batch"));

        let NormalizedQueryResponseV1::RssFeedDetail(missing) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::RssFeedDetail(NormalizedRssFeedDetailRequestV1 {
                schema_version: 1,
                url: "https://missing.example/feed.xml".to_owned(),
            }),
        )
        .expect("missing RSS Feed detail") else {
            panic!("RSS Feed detail response");
        };
        assert!(missing.feed.is_none());
    }

    #[test]
    fn native_friends_identity_pages_use_source_fenced_primary_key_keysets() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 12, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 12 WHERE singleton_id = 1;
                 INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES ('person-1', 'Ada', 'friend', 5, 50, 200),
                          ('person-2', 'Grace', 'friend', 4, 60, 210);
                 INSERT INTO library_person_reach_outs
                   (person_id, reach_out_id, logged_at)
                   VALUES ('person-1', 'reach-1', 100),
                          ('person-1', 'reach-2', 200);
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, first_seen_at,
                    last_seen_at, discovered_from, created_at, updated_at)
                   VALUES ('account-1', 'person-1', 'social', 'x', 'ada', 50, 200, 'capture', 50, 200),
                          ('account-2', 'person-2', 'social', 'x', 'grace', 60, 210, 'capture', 60, 210);
                 INSERT INTO library_rss_feeds
                   (url, title, image_url, enabled, track_unread, updated_at)
                   VALUES ('https://alpha.example/feed', 'Alpha', NULL, 1, 1, 200),
                          ('https://beta.example/feed', 'Beta', 'https://beta.example/icon.png', 0, 1, 210);
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, author_avatar_url, rss_feed_url,
                    hidden, saved, archived, updated_at)
                   VALUES ('account-activity', 'x', 'post', 220, 220, 'ada', 'ada', 'Ada', NULL, NULL, 0, 0, 0, 220),
                          ('rss-activity', 'rss', 'article', 230, 230, 'alpha', 'alpha', 'Alpha', 'https://alpha.example/avatar.png', 'https://alpha.example/feed', 0, 0, 0, 230);
                 INSERT INTO library_device_person_graph_layout
                   (person_id, graph_x, graph_y, updated_at)
                   VALUES ('person-1', 12.5, -8.25, 300);
                 INSERT INTO library_device_account_graph_layout
                   (account_id, graph_x, graph_y, updated_at)
                   VALUES ('account-1', -4.5, 6.75, 301);",
                "a".repeat(64)
            ))
            .expect("fixture");
        for query_id in [
            "person_graph_page_v1",
            "account_graph_page_v1",
            "rss_feed_page_v1",
        ] {
            let program = SQLITE_QUERY_PROGRAMS
                .iter()
                .find(|program| program.query_id == query_id)
                .expect("graph page program");
            let plan = connection
                .prepare(&format!("EXPLAIN QUERY PLAN {}", program.sql))
                .expect("graph page plan")
                .query_map(params![Option::<String>::None, 2], |row| {
                    row.get::<_, String>(3)
                })
                .expect("plan rows")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("plan");
            assert!(plan
                .iter()
                .all(|detail| !detail.contains("USE TEMP B-TREE")));
            let root = match query_id {
                "person_graph_page_v1" => "SEARCH person USING INDEX",
                "account_graph_page_v1" => "SEARCH account USING INDEX",
                _ => "SEARCH feed USING INDEX",
            };
            assert!(plan.iter().any(|detail| detail.contains(root)));
            if query_id == "account_graph_page_v1" {
                assert!(plan
                    .iter()
                    .any(|detail| { detail.contains("library_feed_items_provider_author") }));
            }
            if query_id == "rss_feed_page_v1" {
                assert!(plan
                    .iter()
                    .any(|detail| detail.contains("library_feed_items_rss_feed")));
            }
        }

        let request = NormalizedPersonGraphPageRequestV1 {
            cancellation_id: "cancel-person-graph".to_owned(),
            cursor: None,
            limit: 1,
            reader_session_id: "reader-person-graph".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::PersonGraphPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonGraphPage(request.clone()),
        )
        .expect("Person graph page") else {
            panic!("Person graph page response");
        };
        assert_eq!(first.rows[0].id, "person-1");
        assert_eq!(first.rows[0].last_reach_out_at, Some(200));
        assert!(first.rows[0].graph_pinned);
        assert_eq!(first.rows[0].graph_x, Some(12.5));
        assert_eq!(first.rows[0].graph_y, Some(-8.25));
        assert_eq!(first.rows[0].graph_updated_at, Some(300));
        let person_cursor = first.next_cursor.clone();
        let NormalizedQueryResponseV1::PersonGraphPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonGraphPage(NormalizedPersonGraphPageRequestV1 {
                cursor: first.next_cursor,
                ..request
            }),
        )
        .expect("second Person graph page") else {
            panic!("Person graph page response");
        };
        assert_eq!(second.rows[0].id, "person-2");
        connection
            .execute(
                "UPDATE library_device_graph_layout_state SET revision = 1 WHERE singleton_id = 1;",
                [],
            )
            .expect("advance layout revision");
        let layout_error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonGraphPage(NormalizedPersonGraphPageRequestV1 {
                cancellation_id: "cancel-person-graph-layout-stale".to_owned(),
                cursor: person_cursor.clone(),
                limit: 1,
                reader_session_id: "reader-person-graph-layout-stale".to_owned(),
                schema_version: 1,
            }),
        )
        .expect_err("layout-stale Person graph cursor");
        assert!(layout_error.to_string().contains("cursor is stale"));

        let account_request = NormalizedAccountGraphPageRequestV1 {
            cancellation_id: "cancel-account-graph".to_owned(),
            cursor: None,
            limit: 1,
            reader_session_id: "reader-account-graph".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::AccountGraphPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::AccountGraphPage(account_request.clone()),
        )
        .expect("Account graph page") else {
            panic!("Account graph page response");
        };
        assert_eq!(first.rows[0].id, "account-1");
        assert_eq!(first.rows[0].person_name.as_deref(), Some("Ada"));
        assert_eq!(first.rows[0].activity_count, 1);
        assert_eq!(first.rows[0].latest_activity_at, Some(220));
        assert!(first.rows[0].graph_pinned);
        assert_eq!(first.rows[0].graph_x, Some(-4.5));
        assert_eq!(first.rows[0].graph_y, Some(6.75));
        assert_eq!(first.rows[0].graph_updated_at, Some(301));
        let NormalizedQueryResponseV1::AccountGraphPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::AccountGraphPage(NormalizedAccountGraphPageRequestV1 {
                cursor: first.next_cursor,
                ..account_request
            }),
        )
        .expect("second Account graph page") else {
            panic!("Account graph page response");
        };
        assert_eq!(second.rows[0].id, "account-2");
        let rss_request = NormalizedRssFeedPageRequestV1 {
            cancellation_id: "cancel-rss-graph".to_owned(),
            cursor: None,
            limit: 1,
            reader_session_id: "reader-rss-graph".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::RssFeedPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::RssFeedPage(rss_request.clone()),
        )
        .expect("RSS feed page") else {
            panic!("RSS feed page response");
        };
        assert_eq!(first.rows[0].url, "https://alpha.example/feed");
        assert!(first.rows[0].enabled);
        assert_eq!(first.rows[0].activity_count, 1);
        assert_eq!(first.rows[0].latest_activity_at, Some(230));
        assert_eq!(
            first.rows[0].image_url.as_deref(),
            Some("https://alpha.example/avatar.png")
        );
        let rss_cursor = first.next_cursor.clone();
        let NormalizedQueryResponseV1::RssFeedPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::RssFeedPage(NormalizedRssFeedPageRequestV1 {
                cursor: first.next_cursor,
                ..rss_request
            }),
        )
        .expect("second RSS feed page") else {
            panic!("RSS feed page response");
        };
        assert_eq!(second.rows[0].url, "https://beta.example/feed");
        connection
            .execute_batch(
                "UPDATE library_meta SET source_revision = 13 WHERE singleton_id = 1;
                 UPDATE library_change_state SET revision = 13 WHERE singleton_id = 1;",
            )
            .expect("advance source");
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::PersonGraphPage(NormalizedPersonGraphPageRequestV1 {
                cancellation_id: "cancel-person-graph-stale".to_owned(),
                cursor: person_cursor,
                limit: 1,
                reader_session_id: "reader-person-graph-stale".to_owned(),
                schema_version: 1,
            }),
        )
        .expect_err("stale Person graph cursor");
        assert!(error.to_string().contains("cursor is stale"));
        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::RssFeedPage(NormalizedRssFeedPageRequestV1 {
                cancellation_id: "cancel-rss-graph-stale".to_owned(),
                cursor: rss_cursor,
                limit: 1,
                reader_session_id: "reader-rss-graph-stale".to_owned(),
                schema_version: 1,
            }),
        )
        .expect_err("stale RSS feed cursor");
        assert!(error.to_string().contains("cursor is stale"));
    }

    #[test]
    fn native_rss_feed_pages_shorten_by_bytes_without_losing_legal_rows() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, 'library-1', 1, 'epoch-1', 1, 1);
                 INSERT INTO library_materialization_generation
                   (singleton_id, generation_id) VALUES (1, '{}');
                 UPDATE library_change_state SET revision = 1
                   WHERE singleton_id = 1;",
                "a".repeat(64)
            ))
            .expect("source fixture");
        let title = "t".repeat(4_096);
        let folder = "f".repeat(4_096);
        let site_url = format!("https://example.com/{}", "s".repeat(4_076));
        let image_url = format!("https://example.com/{}", "i".repeat(4_076));
        for index in 0..130 {
            let prefix = format!("https://000-large-{index:03}.example/");
            let url = format!("{}{}", prefix, "u".repeat(4_096 - prefix.len()));
            connection
                .execute(
                    "INSERT INTO library_rss_feeds
                       (url, title, site_url, image_url, enabled, track_unread,
                        folder, updated_at)
                     VALUES (?1, ?2, ?3, ?4, 1, 1, ?5, 1);",
                    params![url, title, site_url, image_url, folder],
                )
                .expect("maximum RSS Feed row");
        }
        let mut cursor = None;
        let mut row_count = 0usize;
        let mut page_count = 0usize;
        loop {
            let NormalizedQueryResponseV1::RssFeedPage(page) = query_normalized_v1(
                &mut connection,
                NormalizedQueryRequestV1::RssFeedPage(NormalizedRssFeedPageRequestV1 {
                    cancellation_id: format!("cancel-rss-maximum-{page_count}"),
                    cursor,
                    limit: 128,
                    reader_session_id: format!("reader-rss-maximum-{page_count}"),
                    schema_version: 1,
                }),
            )
            .expect("maximum RSS Feed page") else {
                panic!("RSS Feed page response");
            };
            assert!(
                serde_json::to_vec(&page).expect("serialized page").len()
                    <= FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
            );
            if page_count == 0 {
                assert!(page.rows.len() < 128);
            }
            assert!(page.rows.iter().all(|row| {
                row.title == title
                    && row.folder.as_deref() == Some(folder.as_str())
                    && row.site_url.as_deref() == Some(site_url.as_str())
                    && row.image_url.as_deref() == Some(image_url.as_str())
            }));
            row_count += page.rows.len();
            page_count += 1;
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(row_count, 130);
        assert!(page_count > 1);
    }

    #[test]
    fn native_account_pages_shorten_by_bytes_without_losing_linked_names() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, 'library-1', 1, 'epoch-1', 1, 1);
                 INSERT INTO library_materialization_generation
                   (singleton_id, generation_id) VALUES (1, '{}');
                 UPDATE library_change_state SET revision = 1
                   WHERE singleton_id = 1;",
                "a".repeat(64)
            ))
            .expect("source fixture");
        let person_name = "p".repeat(4_096);
        connection
            .execute(
                "INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                 VALUES ('person-maximum', ?1, 'friend', 3, 1, 1);",
                params![person_name],
            )
            .expect("maximum Person name");
        let handle = "h".repeat(512);
        let display_name = "d".repeat(512);
        let avatar_url = "a".repeat(8_192);
        for index in 0..130 {
            let id_prefix = format!("000-large-account-{index:03}-");
            let id = format!("{}{}", id_prefix, "i".repeat(2_048 - id_prefix.len()));
            let external_prefix = format!("external-{index:03}-");
            let external_id = format!(
                "{}{}",
                external_prefix,
                "e".repeat(4_096 - external_prefix.len())
            );
            connection
                .execute(
                    "INSERT INTO library_accounts
                       (id, person_id, kind, provider, external_id, handle,
                        display_name, avatar_url, first_seen_at, last_seen_at,
                        discovered_from, created_at, updated_at)
                     VALUES (?1, 'person-maximum', 'social', 'x', ?2, ?3,
                             ?4, ?5, 1, 1, 'captured_item', 1, 1);",
                    params![id, external_id, handle, display_name, avatar_url],
                )
                .expect("maximum Account row");
        }
        let mut cursor = None;
        let mut row_count = 0usize;
        let mut page_count = 0usize;
        loop {
            let NormalizedQueryResponseV1::AccountGraphPage(page) = query_normalized_v1(
                &mut connection,
                NormalizedQueryRequestV1::AccountGraphPage(NormalizedAccountGraphPageRequestV1 {
                    cancellation_id: format!("cancel-account-maximum-{page_count}"),
                    cursor,
                    limit: 128,
                    reader_session_id: format!("reader-account-maximum-{page_count}"),
                    schema_version: 1,
                }),
            )
            .expect("maximum Account page") else {
                panic!("Account page response");
            };
            assert!(
                serde_json::to_vec(&page).expect("serialized page").len()
                    <= FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
            );
            if page_count == 0 {
                assert!(page.rows.len() < 128);
            }
            assert!(page
                .rows
                .iter()
                .all(|row| row.person_name.as_deref() == Some(person_name.as_str())));
            row_count += page.rows.len();
            page_count += 1;
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(row_count, 130);
        assert!(page_count > 1);
    }

    #[test]
    fn native_item_reader_returns_exact_bounded_inline_and_blob_ranges() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let reader_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.query_id == "item_reader_body_v1")
            .expect("reader body program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", reader_program.sql))
            .expect("reader body plan");
        let plan = plan_statement
            .query_map(params!["item-1", "preserved", 65_534, 6], |row| {
                row.get::<_, String>(3)
            })
            .expect("plan rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("plan");
        assert!(plan
            .iter()
            .any(|detail| detail.contains("SEARCH item USING INDEX")));
        assert!(plan
            .iter()
            .any(|detail| detail.contains("SEARCH chunk USING PRIMARY KEY")));
        assert!(plan.iter().all(|detail| !detail.contains("SCAN item")));
        drop(plan_statement);

        let blob_digest = "7".repeat(64);
        let first_chunk = vec![11_u8; 65_536];
        let second_chunk = vec![21_u8, 22, 23, 24, 25, 26, 27, 28];
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 13, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 13 WHERE singleton_id = 1;
                 INSERT INTO library_feed_items
                   (global_id, platform, content_type, captured_at, published_at,
                    author_id, author_handle, author_display_name, content_text,
                    hidden, saved, archived, updated_at)
                   VALUES ('item-1', 'saved', 'article', 100, 100, 'author-1',
                           'ada', 'Ada', 'newer', 0, 1, 0, 100);",
                "a".repeat(64),
            ))
            .expect("metadata fixture");
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
                 VALUES (?1, ?2, 65536, 2, 'text/plain');",
                params![blob_digest, first_chunk.len() + second_chunk.len()],
            )
            .expect("blob descriptor");
        connection
            .execute(
                "INSERT INTO library_blob_chunks
                   (content_digest, chunk_index, chunk_digest, bytes)
                 VALUES (?1, 0, ?2, ?3);",
                params![blob_digest, "8".repeat(64), first_chunk],
            )
            .expect("first blob chunk");
        connection
            .execute(
                "INSERT INTO library_blob_chunks
                   (content_digest, chunk_index, chunk_digest, bytes)
                 VALUES (?1, 1, ?2, ?3);",
                params![blob_digest, "9".repeat(64), second_chunk],
            )
            .expect("second blob chunk");
        connection
            .execute(
                "UPDATE library_feed_items SET preserved_text_blob_digest = ?1
                 WHERE global_id = 'item-1';",
                [&blob_digest],
            )
            .expect("attach body");

        let NormalizedQueryResponseV1::ItemReaderBody(inline) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ItemReaderBody(NormalizedItemReaderBodyRequestV1 {
                body_kind: "content".to_owned(),
                global_id: "item-1".to_owned(),
                limit_bytes: 3,
                offset_bytes: 1,
                schema_version: 1,
            }),
        )
        .expect("inline range") else {
            panic!("reader body response");
        };
        let inline = inline.body.expect("inline body");
        assert_eq!(inline.storage, "inline");
        assert_eq!(inline.content_length, 5);
        assert_eq!(inline.end_offset, 4);
        assert_eq!(
            BASE64_STANDARD
                .decode(inline.bytes_base64)
                .expect("inline base64"),
            b"ewe"
        );

        let NormalizedQueryResponseV1::ItemReaderBody(blob) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ItemReaderBody(NormalizedItemReaderBodyRequestV1 {
                body_kind: "preserved".to_owned(),
                global_id: "item-1".to_owned(),
                limit_bytes: 6,
                offset_bytes: 65_534,
                schema_version: 1,
            }),
        )
        .expect("blob range") else {
            panic!("reader body response");
        };
        let blob = blob.body.expect("blob body");
        assert_eq!(blob.blob_digest.as_deref(), Some(blob_digest.as_str()));
        assert_eq!(blob.content_length, 65_544);
        assert_eq!(blob.end_offset, 65_540);
        assert_eq!(
            BASE64_STANDARD
                .decode(blob.bytes_base64)
                .expect("blob base64"),
            [11, 11, 21, 22, 23, 24]
        );

        let error = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::ItemReaderBody(NormalizedItemReaderBodyRequestV1 {
                body_kind: "content".to_owned(),
                global_id: "item-1".to_owned(),
                limit_bytes: 1,
                offset_bytes: 6,
                schema_version: 1,
            }),
        )
        .expect_err("offset past end");
        assert!(error.to_string().contains("metadata is invalid"));
    }
}
