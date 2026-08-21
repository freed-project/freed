use crate::lower_hex;
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::SQLITE_QUERY_PROGRAMS;
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const FEED_PAGE_MAXIMUM_LIMIT: usize = 128;
const FEED_PAGE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const FEED_PAGE_MAXIMUM_CURSOR_BYTES: usize = 5_540;
const PERSON_TIMELINE_MAXIMUM_LIMIT: usize = 100;
const PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PERSON_TIMELINE_MAXIMUM_CURSOR_BYTES: usize = 5_700;
const ITEM_SCAN_MAXIMUM_LIMIT: usize = 64;
const ITEM_SCAN_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const CHANGE_FEED_MAXIMUM_LIMIT: usize = 512;
const CHANGE_FEED_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PREFERENCES_SNAPSHOT_MAXIMUM_ROWS: usize = 512;
const PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PREFERENCE_PATH_MAXIMUM_BYTES: usize = 4_096;
const PREFERENCE_TEXT_MAXIMUM_BYTES: usize = 8_192;
const PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES: usize = 512 * 1_024;
const ACCOUNT_DETAIL_MAXIMUM_RESPONSE_BYTES: usize = 512 * 1_024;
const FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT: usize = 128;
const FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const ITEM_READER_BODY_MAXIMUM_RANGE_BYTES: usize = 256 * 1_024;
const ITEM_READER_BODY_MAXIMUM_RESPONSE_BYTES: usize = 512 * 1_024;
const CONTENT_CHUNK_BYTES: usize = 65_536;
const CURSOR_FIXED_BYTES: usize = 59;

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
pub struct NormalizedItemScanRequestV1 {
    pub cancellation_id: String,
    pub cursor: Option<String>,
    pub limit: usize,
    pub reader_session_id: String,
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
pub struct NormalizedPreferencesSnapshotRequestV1 {
    pub schema_version: u32,
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
pub struct NormalizedRssFeedGraphPageRequestV1 {
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
    ChangeFeed(NormalizedChangeFeedRequestV1),
    FacetSummary(NormalizedFacetSummaryRequestV1),
    FeedPage(NormalizedFeedPageRequestV1),
    ItemDetail(NormalizedItemDetailRequestV1),
    ItemReaderBody(NormalizedItemReaderBodyRequestV1),
    ItemScan(NormalizedItemScanRequestV1),
    PersonDetail(NormalizedPersonDetailRequestV1),
    PersonGraphPage(NormalizedPersonGraphPageRequestV1),
    PersonTimeline(NormalizedPersonTimelineRequestV1),
    PreferencesSnapshot(NormalizedPreferencesSnapshotRequestV1),
    RssFeedGraphPage(NormalizedRssFeedGraphPageRequestV1),
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
pub struct NormalizedPersonTimelineResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedFeedCardV1>,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
    pub total_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedItemScanResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedFeedCardV1>,
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
    pub sample_item_count: i64,
    pub saved_archived_count: i64,
    pub saved_count: i64,
    pub saved_platform_count: i64,
    pub tags: Vec<String>,
    pub total_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFacetSummaryResponseV1 {
    pub query_id: String,
    pub schema_version: u32,
    pub source: NormalizedFeedPageSourceV1,
    pub summary: NormalizedFacetSummaryV1,
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
    pub provider: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedRssFeedGraphRowV1 {
    pub activity_count: i64,
    pub enabled: bool,
    pub image_url: Option<String>,
    pub latest_activity_at: Option<i64>,
    pub title: String,
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
pub struct NormalizedRssFeedGraphPageResponseV1 {
    pub layout_revision: i64,
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedRssFeedGraphRowV1>,
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

#[derive(Debug, Clone, PartialEq)]
pub enum NormalizedQueryResponseV1 {
    AccountDetail(Box<NormalizedAccountDetailResponseV1>),
    AccountGraphPage(NormalizedAccountGraphPageResponseV1),
    ChangeFeed(NormalizedChangeFeedResponseV1),
    FacetSummary(NormalizedFacetSummaryResponseV1),
    FeedPage(NormalizedFeedPageResponseV1),
    ItemDetail(Box<NormalizedItemDetailResponseV1>),
    ItemReaderBody(NormalizedItemReaderBodyResponseV1),
    ItemScan(NormalizedItemScanResponseV1),
    PersonDetail(Box<NormalizedPersonDetailResponseV1>),
    PersonGraphPage(NormalizedPersonGraphPageResponseV1),
    PersonTimeline(NormalizedPersonTimelineResponseV1),
    PreferencesSnapshot(NormalizedPreferencesSnapshotResponseV1),
    RssFeedGraphPage(NormalizedRssFeedGraphPageResponseV1),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FeedPageCursorV1 {
    generation_id: String,
    transition_sequence: i64,
    projection_revision: i64,
    sort_at: i64,
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
        .find(|program| program.0 == "feed_page_v1")
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
    let mut statement = transaction.prepare(program.2)?;
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
        if cards.len() > program.1 {
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
    let total_count: i64 = transaction.query_row(program.3, [], |row| row.get(0))?;
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

fn query_person_timeline(
    connection: &mut Connection,
    request: NormalizedPersonTimelineRequestV1,
) -> Result<NormalizedPersonTimelineResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=PERSON_TIMELINE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
        || request.person_id.is_empty()
        || request.person_id.len() > 4_096
    {
        return Err(invalid(
            "normalized person timeline query identity is invalid",
        ));
    }
    let person_digest = lower_hex(&Sha256::digest(request.person_id.as_bytes()));
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.0 == "person_timeline_v1")
        .ok_or(invalid(
            "normalized person timeline query program is missing",
        ))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let cursor = request
        .cursor
        .as_deref()
        .map(decode_person_timeline_cursor)
        .transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.person_digest != person_digest
            || cursor.page.generation_id != generation_id
            || cursor.page.transition_sequence != source_revision
            || cursor.page.projection_revision != source_revision
    }) {
        return Err(invalid("normalized person timeline cursor is stale"));
    }
    let mut statement = transaction.prepare(program.2)?;
    let mut query_rows = statement.query_map(
        params![
            request.person_id,
            cursor.as_ref().map(|cursor| cursor.page.sort_at),
            cursor
                .as_ref()
                .map(|cursor| cursor.page.global_id.as_str())
                .unwrap_or(""),
            i64::try_from(request.limit + 1).expect("bounded person timeline limit"),
        ],
        feed_card,
    )?;
    let mut cards = Vec::with_capacity(request.limit + 1);
    for row in query_rows.by_ref() {
        cards.push(row?);
        if cards.len() > program.1 {
            return Err(invalid("normalized person timeline exceeded its row bound"));
        }
    }
    drop(query_rows);
    drop(statement);
    let has_more = cards.len() > request.limit;
    cards.truncate(request.limit);
    let next_cursor = if has_more {
        let last = cards
            .last()
            .ok_or(invalid("normalized person timeline cursor row is missing"))?;
        Some(encode_person_timeline_cursor(&PersonTimelineCursorV1 {
            page: FeedPageCursorV1 {
                generation_id: generation_id.clone(),
                transition_sequence: source_revision,
                projection_revision: source_revision,
                sort_at: last
                    .published_at
                    .ok_or(invalid("normalized person timeline sort time is missing"))?,
                global_id: last.global_id.clone(),
            },
            person_digest,
        })?)
    } else {
        None
    };
    let total_count: i64 =
        transaction.query_row(program.3, params![request.person_id], |row| row.get(0))?;
    let response = NormalizedPersonTimelineResponseV1 {
        next_cursor,
        query_id: "person_timeline_v1".to_owned(),
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
        .map_err(|_| invalid("normalized person timeline response is invalid"))?
        .len()
        > PERSON_TIMELINE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized person timeline response exceeds its byte bound",
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
        .find(|program| program.0 == "background_item_page_v1")
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
    let mut statement = transaction.prepare(program.2)?;
    let mut rows = statement.query_map(
        params![
            cursor.as_ref().map(|cursor| cursor.global_id.as_str()),
            i64::try_from(request.limit + 1).expect("bounded item scan limit"),
        ],
        feed_card,
    )?;
    let mut cards = Vec::with_capacity(request.limit + 1);
    for row in rows.by_ref() {
        cards.push(row?);
        if cards.len() > program.1 {
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
            global_id: last.global_id.clone(),
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
        .find(|program| program.0 == "change_feed_v1")
        .ok_or(invalid("normalized change-feed program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, current_revision) = query_source(&transaction)?;
    let change_revision: i64 = transaction.query_row(program.3, [], |row| row.get(0))?;
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
    let mut statement = transaction.prepare(program.2)?;
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
        if rows.len() > program.1 {
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

fn query_facet_summary(
    connection: &mut Connection,
    request: NormalizedFacetSummaryRequestV1,
) -> Result<NormalizedFacetSummaryResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1 {
        return Err(invalid("normalized facet query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.0 == "library_facet_summary_v1")
        .ok_or(invalid("normalized facet query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let summary = transaction.query_row(program.2, [], |row| {
        Ok(NormalizedFacetSummaryV1 {
            archived_count: row.get("archivedCount")?,
            sample_item_count: row.get("sampleItemCount")?,
            saved_archived_count: row.get("savedArchivedCount")?,
            saved_count: row.get("savedCount")?,
            saved_platform_count: row.get("savedPlatformCount")?,
            tags: string_array(row, "tagsJson", 4_096, 1_024)?,
            total_count: row.get("totalCount")?,
        })
    })?;
    if [
        summary.archived_count,
        summary.sample_item_count,
        summary.saved_archived_count,
        summary.saved_count,
        summary.saved_platform_count,
        summary.total_count,
    ]
    .into_iter()
    .any(|value| !valid_safe_integer(value))
        || summary.archived_count > summary.total_count
        || summary.sample_item_count > summary.total_count
        || summary.saved_count > summary.total_count
        || summary.saved_archived_count > summary.saved_count.min(summary.archived_count)
        || summary.saved_platform_count > summary.saved_count
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

fn query_preferences_snapshot(
    connection: &mut Connection,
    request: NormalizedPreferencesSnapshotRequestV1,
) -> Result<NormalizedPreferencesSnapshotResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1 {
        return Err(invalid("normalized preferences query identity is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.0 == "preferences_snapshot_v1")
        .ok_or(invalid("normalized preferences query program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.2)?;
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
    if rows.len() > PREFERENCES_SNAPSHOT_MAXIMUM_ROWS || rows.len() >= program.1 {
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
        .find(|program| program.0 == "person_detail_v1")
        .ok_or(invalid("normalized person detail program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.2)?;
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
    if persons.len() > program.1 {
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
        .find(|program| program.0 == "account_detail_v1")
        .ok_or(invalid("normalized account detail program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.2)?;
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
    if accounts.len() > program.1 {
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
        .find(|program| program.0 == "person_graph_page_v1")
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
    let mut statement = transaction.prepare(program.2)?;
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
    if rows.len() > program.1 {
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
        .find(|program| program.0 == "account_graph_page_v1")
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
    let mut statement = transaction.prepare(program.2)?;
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
                provider: row.get("provider")?,
                updated_at: row.get("updatedAt")?,
            })
        },
    )?;
    let mut rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() > program.1 {
        return Err(invalid(
            "normalized Account graph page exceeded its row bound",
        ));
    }
    let has_more = rows.len() > request.limit;
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
    let response = NormalizedAccountGraphPageResponseV1 {
        layout_revision,
        next_cursor,
        query_id: "account_graph_page_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized Account graph page response is invalid"))?
        .len()
        > FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized Account graph page response exceeds its byte bound",
        ));
    }
    transaction.commit()?;
    Ok(response)
}

fn query_rss_feed_graph_page(
    connection: &mut Connection,
    request: NormalizedRssFeedGraphPageRequestV1,
) -> Result<NormalizedRssFeedGraphPageResponseV1, NormalizedSqliteError> {
    if request.schema_version != 1
        || !(1..=FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT).contains(&request.limit)
        || !valid_operation_instance_id(&request.cancellation_id)
        || !valid_operation_instance_id(&request.reader_session_id)
    {
        return Err(invalid("normalized RSS feed graph page request is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|program| program.0 == "rss_feed_graph_page_v1")
        .ok_or(invalid("normalized RSS feed graph page program is missing"))?;
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
        return Err(invalid("normalized RSS feed graph page cursor is stale"));
    }
    let mut statement = transaction.prepare(program.2)?;
    let mapped = statement.query_map(
        params![
            cursor.as_ref().map(|cursor| cursor.global_id.as_str()),
            i64::try_from(request.limit + 1).expect("bounded RSS feed graph page limit"),
        ],
        |row| {
            let enabled = match row.get::<_, i64>("enabled")? {
                0 => false,
                1 => true,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(NormalizedRssFeedGraphRowV1 {
                activity_count: row.get("activityCount")?,
                enabled,
                image_url: row.get("imageUrl")?,
                latest_activity_at: row.get("latestActivityAt")?,
                title: row.get("title")?,
                updated_at: row.get("updatedAt")?,
                url: row.get("url")?,
            })
        },
    )?;
    let mut rows = mapped.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    if rows.len() > program.1 {
        return Err(invalid(
            "normalized RSS feed graph page exceeded its row bound",
        ));
    }
    let has_more = rows.len() > request.limit;
    rows.truncate(request.limit);
    for row in &rows {
        if row.url.is_empty()
            || row.url.len() > 8_192
            || row.title.is_empty()
            || row.title.len() > 4_096
            || row
                .image_url
                .as_ref()
                .is_some_and(|value| value.len() > 8_192)
            || !valid_safe_integer(row.activity_count)
            || !valid_safe_integer(row.updated_at)
            || row
                .latest_activity_at
                .is_some_and(|value| !valid_safe_integer(value))
        {
            return Err(invalid("normalized RSS feed graph page row is invalid"));
        }
    }
    if rows.windows(2).any(|pair| pair[0].url >= pair[1].url) {
        return Err(invalid("normalized RSS feed graph page order is invalid"));
    }
    let next_cursor = if has_more {
        let last = rows.last().ok_or(invalid(
            "normalized RSS feed graph page cursor row is missing",
        ))?;
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
    let response = NormalizedRssFeedGraphPageResponseV1 {
        layout_revision,
        next_cursor,
        query_id: "rss_feed_graph_page_v1".to_owned(),
        rows,
        schema_version: 1,
        source: NormalizedFeedPageSourceV1 {
            generation_id,
            projection_revision: source_revision,
            transition_sequence: source_revision,
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("normalized RSS feed graph page response is invalid"))?
        .len()
        > FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized RSS feed graph page response exceeds its byte bound",
        ));
    }
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
        .find(|program| program.0 == "item_detail_v1")
        .ok_or(invalid("normalized item detail program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.2)?;
    let rows = statement.query_map(params![request.global_id], |row| {
        Ok(NormalizedItemDetailV1 {
            card: feed_card(row)?,
            content_body: body_locator(row, "contentBodyStorage", "contentBodyBlobDigest")?,
            preserved_body: body_locator(row, "preservedBodyStorage", "preservedBodyBlobDigest")?,
        })
    })?;
    let mut items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    if items.len() > program.1 {
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
        .find(|program| program.0 == "item_reader_body_v1")
        .ok_or(invalid("normalized item reader body program is missing"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let (generation_id, source_revision) = query_source(&transaction)?;
    let mut statement = transaction.prepare(program.2)?;
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
    if rows.len() > program.1 {
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
        NormalizedQueryRequestV1::ChangeFeed(request) => Ok(NormalizedQueryResponseV1::ChangeFeed(
            query_change_feed(connection, request)?,
        )),
        NormalizedQueryRequestV1::FacetSummary(request) => Ok(
            NormalizedQueryResponseV1::FacetSummary(query_facet_summary(connection, request)?),
        ),
        NormalizedQueryRequestV1::FeedPage(request) => Ok(NormalizedQueryResponseV1::FeedPage(
            query_feed_page(connection, request)?,
        )),
        NormalizedQueryRequestV1::ItemDetail(request) => Ok(NormalizedQueryResponseV1::ItemDetail(
            Box::new(query_item_detail(connection, request)?),
        )),
        NormalizedQueryRequestV1::ItemReaderBody(request) => Ok(
            NormalizedQueryResponseV1::ItemReaderBody(query_item_reader_body(connection, request)?),
        ),
        NormalizedQueryRequestV1::ItemScan(request) => Ok(NormalizedQueryResponseV1::ItemScan(
            query_item_scan(connection, request)?,
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
        NormalizedQueryRequestV1::PreferencesSnapshot(request) => {
            Ok(NormalizedQueryResponseV1::PreferencesSnapshot(
                query_preferences_snapshot(connection, request)?,
            ))
        }
        NormalizedQueryRequestV1::RssFeedGraphPage(request) => {
            Ok(NormalizedQueryResponseV1::RssFeedGraphPage(
                query_rss_feed_graph_page(connection, request)?,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_sqlite::install_normalized_schema_v1;

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
    }

    #[test]
    fn native_facet_dispatch_aggregates_normalized_rows_in_binary_tag_order() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let facet_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.0 == "library_facet_summary_v1")
            .expect("facet program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", facet_program.2))
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
                   VALUES ('item-1', '😀'), ('item-1', 'alpha'), ('item-2', '');",
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
        assert_eq!(response.summary.saved_count, 2);
        assert_eq!(response.summary.saved_archived_count, 1);
        assert_eq!(response.summary.saved_platform_count, 2);
        assert_eq!(response.summary.sample_item_count, 1);
        assert_eq!(response.summary.tags, ["alpha", "\u{e000}", "😀"]);

        connection
            .execute_batch(
                "UPDATE library_feed_items
                   SET saved = 0, archived = 1, sample_batch_id = 'sample-2'
                   WHERE global_id = 'item-2';
                 DELETE FROM library_feed_items WHERE global_id = 'item-1';",
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
        assert_eq!(updated.summary.saved_count, 0);
        assert_eq!(updated.summary.saved_archived_count, 0);
        assert_eq!(updated.summary.saved_platform_count, 0);
        assert_eq!(updated.summary.sample_item_count, 1);
        assert_eq!(updated.summary.tags, ["\u{e000}"]);
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
    fn native_person_timeline_uses_the_derived_index_and_binds_its_cursor() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.0 == "person_timeline_v1")
            .expect("person timeline program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.2))
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
            .find(|program| program.0 == "background_item_page_v1")
            .expect("item scan program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.2))
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
                .map(|row| row.global_id.as_str())
                .collect::<Vec<_>>(),
            ["hidden", "item-1"]
        );
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
        assert_eq!(second.rows[0].global_id, "item-2");
        assert_eq!(second.rows[0].archived, Some(true));
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
    fn native_change_feed_pins_an_upper_revision_and_rejects_gaps() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.0 == "change_feed_v1")
            .expect("change-feed program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", program.2))
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
            .find(|program| program.0 == "item_detail_v1")
            .expect("item detail program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", item_program.2))
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
            .find(|program| program.0 == "account_detail_v1")
            .expect("account detail program");
        let plan = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", account_program.2))
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
            "rss_feed_graph_page_v1",
        ] {
            let program = SQLITE_QUERY_PROGRAMS
                .iter()
                .find(|program| program.0 == query_id)
                .expect("graph page program");
            let plan = connection
                .prepare(&format!("EXPLAIN QUERY PLAN {}", program.2))
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
            if query_id == "rss_feed_graph_page_v1" {
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
        let rss_request = NormalizedRssFeedGraphPageRequestV1 {
            cancellation_id: "cancel-rss-graph".to_owned(),
            cursor: None,
            limit: 1,
            reader_session_id: "reader-rss-graph".to_owned(),
            schema_version: 1,
        };
        let NormalizedQueryResponseV1::RssFeedGraphPage(first) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::RssFeedGraphPage(rss_request.clone()),
        )
        .expect("RSS feed graph page") else {
            panic!("RSS feed graph page response");
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
        let NormalizedQueryResponseV1::RssFeedGraphPage(second) = query_normalized_v1(
            &mut connection,
            NormalizedQueryRequestV1::RssFeedGraphPage(NormalizedRssFeedGraphPageRequestV1 {
                cursor: first.next_cursor,
                ..rss_request
            }),
        )
        .expect("second RSS feed graph page") else {
            panic!("RSS feed graph page response");
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
            NormalizedQueryRequestV1::RssFeedGraphPage(NormalizedRssFeedGraphPageRequestV1 {
                cancellation_id: "cancel-rss-graph-stale".to_owned(),
                cursor: rss_cursor,
                limit: 1,
                reader_session_id: "reader-rss-graph-stale".to_owned(),
                schema_version: 1,
            }),
        )
        .expect_err("stale RSS feed graph cursor");
        assert!(error.to_string().contains("cursor is stale"));
    }

    #[test]
    fn native_item_reader_returns_exact_bounded_inline_and_blob_ranges() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let reader_program = SQLITE_QUERY_PROGRAMS
            .iter()
            .find(|program| program.0 == "item_reader_body_v1")
            .expect("reader body program");
        let mut plan_statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", reader_program.2))
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
