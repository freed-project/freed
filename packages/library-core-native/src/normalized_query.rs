use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::SQLITE_QUERY_PROGRAMS;
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const FEED_PAGE_MAXIMUM_LIMIT: usize = 128;
const FEED_PAGE_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const FEED_PAGE_MAXIMUM_CURSOR_BYTES: usize = 5_540;
const ITEM_SCAN_MAXIMUM_LIMIT: usize = 64;
const ITEM_SCAN_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PREFERENCES_SNAPSHOT_MAXIMUM_ROWS: usize = 512;
const PREFERENCES_SNAPSHOT_MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const PREFERENCE_PATH_MAXIMUM_BYTES: usize = 4_096;
const PREFERENCE_TEXT_MAXIMUM_BYTES: usize = 8_192;
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
pub struct NormalizedItemScanRequestV1 {
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
pub struct NormalizedItemReaderBodyRequestV1 {
    pub body_kind: String,
    pub global_id: String,
    pub limit_bytes: usize,
    pub offset_bytes: usize,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NormalizedQueryRequestV1 {
    FacetSummary(NormalizedFacetSummaryRequestV1),
    FeedPage(NormalizedFeedPageRequestV1),
    ItemDetail(NormalizedItemDetailRequestV1),
    ItemReaderBody(NormalizedItemReaderBodyRequestV1),
    ItemScan(NormalizedItemScanRequestV1),
    PreferencesSnapshot(NormalizedPreferencesSnapshotRequestV1),
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
pub struct NormalizedItemScanResponseV1 {
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub rows: Vec<NormalizedFeedCardV1>,
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
    FacetSummary(NormalizedFacetSummaryResponseV1),
    FeedPage(NormalizedFeedPageResponseV1),
    ItemDetail(Box<NormalizedItemDetailResponseV1>),
    ItemReaderBody(NormalizedItemReaderBodyResponseV1),
    ItemScan(NormalizedItemScanResponseV1),
    PreferencesSnapshot(NormalizedPreferencesSnapshotResponseV1),
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
    let source: (String, i64) = connection.query_row(
        "SELECT library_id, source_revision FROM library_meta WHERE singleton_id = 1;",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if !valid_lower_hex_64(&source.0) || !valid_safe_integer(source.1) {
        return Err(invalid("normalized query source identity is invalid"));
    }
    Ok(source)
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
        NormalizedQueryRequestV1::PreferencesSnapshot(request) => {
            Ok(NormalizedQueryResponseV1::PreferencesSnapshot(
                query_preferences_snapshot(connection, request)?,
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
            .execute(
                "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;",
                [],
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
            .execute(
                "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;",
                [],
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
    fn native_preferences_dispatch_returns_closed_leaves_in_binary_order() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 9, 1000);
                 INSERT INTO library_preferences
                   (path, value_type, boolean_value, integer_value, real_value,
                    text_value, updated_at)
                   VALUES
                     ('😀', 'boolean', 1, NULL, NULL, NULL, 1),
                     ('alpha', 'integer', NULL, 3, NULL, NULL, 2),
                     ('null-value', 'null', NULL, NULL, NULL, NULL, 3),
                     ('real-value', 'real', NULL, NULL, 0.5, NULL, 4),
                     ('text-value', 'text', NULL, NULL, NULL, 'neon', 5),
                     ('', 'boolean', 0, NULL, NULL, NULL, 6);",
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
                "alpha",
                "null-value",
                "real-value",
                "text-value",
                "\u{e000}",
                "😀"
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
