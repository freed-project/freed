//! Bounded Tauri reader for selected feed-browse SQLite generations.
//!
//! Automerge remains the authoritative writer. Each reader session pins one
//! authenticated immutable generation and rejects a filter, source, or cursor
//! mismatch instead of walking across projections.

use crate::library_core_feed_browse_reader::{
    FeedBrowseGenerationReader, FeedBrowseGenerationReaderError,
};
use crate::library_core_feed_browse_registry::{
    FeedBrowseGenerationRegistry, FeedBrowseGenerationRegistryError,
};
use crate::library_core_feed_browse_runtime::resolve_existing_library_core_feed_browse_paths_in_root;
use crate::library_core_feed_browse_store::{
    FeedBrowseCursor, FeedBrowsePage, FeedBrowseStoreError,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const QUERY_ID_V1: &str = "feed_browse_page_v1";
const QUERY_ID_V2: &str = "feed_browse_page_v2";
const SCHEMA_VERSION_V1: u8 = 1;
const SCHEMA_VERSION_V2: u8 = 2;
const FRIENDS_PREDICATE_SCHEMA_VERSION: u8 = 1;
const RECOMMENDATION_ORDER_SCHEMA_VERSION: i64 = 1;
const MAXIMUM_PAGE_LIMIT: u32 = 128;
const MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const MAXIMUM_CURSOR_BYTES: usize = 5_560;
const MAXIMUM_ENTITY_ID_BYTES: usize = 4_096;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const CURSOR_VERSION: u8 = 1;
const CURSOR_FIXED_BYTES: usize = 68;
const MAXIMUM_READER_SESSIONS: usize = 2;
const MAXIMUM_READER_SESSION_AGE: Duration = Duration::from_secs(60);

#[derive(Debug)]
enum BrowseReaderError {
    InvalidRequest(&'static str),
    RuntimeInactive,
    CursorStale,
    SessionLimit,
    StatePoisoned,
    ResponseTooLarge,
    RuntimePath(String),
    Reader(FeedBrowseGenerationReaderError),
}

impl BrowseReaderError {
    fn code(&self) -> &'static str {
        match self {
            Self::RuntimeInactive => "RUNTIME_INACTIVE",
            Self::CursorStale => "CURSOR_STALE",
            Self::SessionLimit => "SESSION_LIMIT",
            Self::InvalidRequest(_) => "INVALID_REQUEST",
            Self::ResponseTooLarge => "RESPONSE_TOO_LARGE",
            Self::StatePoisoned | Self::RuntimePath(_) | Self::Reader(_) => "READER_UNAVAILABLE",
        }
    }
}

impl fmt::Display for BrowseReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(field) => write!(formatter, "invalid feed browse reader {field}"),
            Self::RuntimeInactive => formatter.write_str("feed browse reader is not initialized"),
            Self::CursorStale => formatter.write_str("feed browse cursor is stale"),
            Self::SessionLimit => formatter.write_str("feed browse reader is at capacity"),
            Self::StatePoisoned => formatter.write_str("feed browse reader state is unavailable"),
            Self::ResponseTooLarge => {
                formatter.write_str("feed browse response exceeds its byte ceiling")
            }
            Self::RuntimePath(error) => formatter.write_str(error),
            Self::Reader(error) => write!(formatter, "{error}"),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowseReaderErrorResponse {
    code: &'static str,
    message: String,
}

impl From<BrowseReaderError> for BrowseReaderErrorResponse {
    fn from(error: BrowseReaderError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BrowsePageRequestV1 {
    cancellation_id: String,
    cursor: RequiredNullableCursor,
    filter: Value,
    limit: u32,
    query_id: String,
    ranking_clock_ms: i64,
    reader_session_id: String,
    recommendation_order_schema_version: i64,
    schema_version: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum BrowseIdentityModeV2 {
    AllContent,
    Friends,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BrowsePageRequestV2 {
    cancellation_id: String,
    cursor: RequiredNullableCursor,
    filter: Value,
    friends_predicate_schema_version: u8,
    identity_mode: BrowseIdentityModeV2,
    limit: u32,
    query_id: String,
    ranking_clock_ms: i64,
    reader_session_id: String,
    recommendation_order_schema_version: i64,
    schema_version: u8,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub(super) enum BrowsePageRequest {
    V1(BrowsePageRequestV1),
    V2(BrowsePageRequestV2),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrowseGenerationScopeV2 {
    filter: Value,
    friends_predicate_schema_version: u8,
    identity_mode: BrowseIdentityModeV2,
}

#[derive(Debug, Clone, PartialEq)]
struct RequiredNullableCursor(Option<String>);

impl<'de> Deserialize<'de> for RequiredNullableCursor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct CursorVisitor;

        impl serde::de::Visitor<'_> for CursorVisitor {
            type Value = RequiredNullableCursor;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an explicit null or cursor string")
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(RequiredNullableCursor(None))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(RequiredNullableCursor(Some(value.to_owned())))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(RequiredNullableCursor(Some(value)))
            }
        }

        deserializer.deserialize_any(CursorVisitor)
    }
}

#[derive(Debug, Clone, PartialEq)]
struct RequestIdentity {
    cancellation_id: String,
    cursor: Option<String>,
    limit: u32,
}

impl From<&BrowsePageRequestV1> for RequestIdentity {
    fn from(request: &BrowsePageRequestV1) -> Self {
        Self {
            cancellation_id: request.cancellation_id.clone(),
            cursor: request.cursor.0.clone(),
            limit: request.limit,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedPageSourceV1 {
    generation_id: String,
    projection_revision: i64,
    transition_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowseNextOrderV1 {
    global_id: String,
    priority: i64,
    published_at: i64,
    source_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowsePageResponseV1 {
    filter: Value,
    next_cursor: Option<String>,
    next_order: Option<BrowseNextOrderV1>,
    query_id: &'static str,
    ranking_clock_ms: i64,
    recommendation_order_schema_version: i64,
    rows: Vec<Value>,
    schema_version: u8,
    source: FeedPageSourceV1,
    total_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowsePageResponseV2 {
    filter: Value,
    friends_predicate_schema_version: u8,
    identity_mode: BrowseIdentityModeV2,
    next_cursor: Option<String>,
    next_order: Option<BrowseNextOrderV1>,
    query_id: &'static str,
    ranking_clock_ms: i64,
    recommendation_order_schema_version: i64,
    rows: Vec<Value>,
    schema_version: u8,
    source: FeedPageSourceV1,
    total_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub(super) enum BrowsePageResponse {
    V1(BrowsePageResponseV1),
    V2(BrowsePageResponseV2),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowseReaderCancellationV1 {
    released: bool,
}

struct ReaderSession {
    root_directory: String,
    reader_key: String,
    created_at: Instant,
    active_cancellation_id: String,
    last_request: Option<RequestIdentity>,
}

struct CachedReader {
    reader: FeedBrowseGenerationReader,
}

#[derive(Default)]
struct BrowseReaderRuntimeInner {
    quiesced: bool,
    readers: HashMap<String, CachedReader>,
    sessions: HashMap<String, ReaderSession>,
}

#[derive(Default)]
pub(super) struct LibraryCoreFeedBrowseReaderRuntimeState(Mutex<BrowseReaderRuntimeInner>);

struct DecodedCursor {
    generation_id: String,
    transition_sequence: i64,
    projection_revision: i64,
    page_cursor: FeedBrowseCursor,
}

fn is_operation_instance_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => true,
            b'.' | b'_' | b':' | b'-' => index > 0,
            _ => false,
        })
}

fn validate_request_bounds(
    reader_session_id: &str,
    cancellation_id: &str,
    cursor: &RequiredNullableCursor,
    filter: &Value,
    limit: u32,
    ranking_clock_ms: i64,
) -> Result<(), BrowseReaderError> {
    if !is_operation_instance_id(reader_session_id) || !is_operation_instance_id(cancellation_id) {
        return Err(BrowseReaderError::InvalidRequest("operation identity"));
    }
    if !(1..=MAXIMUM_PAGE_LIMIT).contains(&limit)
        || ranking_clock_ms < 0
        || ranking_clock_ms as u64 > MAXIMUM_SAFE_INTEGER
    {
        return Err(BrowseReaderError::InvalidRequest("query bounds"));
    }
    if cursor
        .0
        .as_ref()
        .is_some_and(|cursor| cursor.len() > MAXIMUM_CURSOR_BYTES)
    {
        return Err(BrowseReaderError::InvalidRequest("cursor"));
    }
    let filter_json =
        serde_json::to_string(filter).map_err(|_| BrowseReaderError::InvalidRequest("filter"))?;
    if filter_json.len() > 64 * 1_024 {
        return Err(BrowseReaderError::InvalidRequest("filter"));
    }
    Ok(())
}

fn validate_request_v1(request: &BrowsePageRequestV1) -> Result<(), BrowseReaderError> {
    if request.query_id != QUERY_ID_V1
        || request.schema_version != SCHEMA_VERSION_V1
        || request.recommendation_order_schema_version != RECOMMENDATION_ORDER_SCHEMA_VERSION
        || is_generation_scope_v2(&request.filter)
    {
        return Err(BrowseReaderError::InvalidRequest("protocol identity"));
    }
    validate_request_bounds(
        &request.reader_session_id,
        &request.cancellation_id,
        &request.cursor,
        &request.filter,
        request.limit,
        request.ranking_clock_ms,
    )
}

fn is_generation_scope_v2(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == 3
        && object.contains_key("filter")
        && object
            .get("friendsPredicateSchemaVersion")
            .and_then(Value::as_u64)
            == Some(FRIENDS_PREDICATE_SCHEMA_VERSION as u64)
        && matches!(
            object.get("identityMode").and_then(Value::as_str),
            Some("all_content" | "friends")
        )
}

fn validate_request_v2(request: &BrowsePageRequestV2) -> Result<(), BrowseReaderError> {
    if request.query_id != QUERY_ID_V2
        || request.schema_version != SCHEMA_VERSION_V2
        || request.recommendation_order_schema_version != RECOMMENDATION_ORDER_SCHEMA_VERSION
        || request.friends_predicate_schema_version != FRIENDS_PREDICATE_SCHEMA_VERSION
    {
        return Err(BrowseReaderError::InvalidRequest("protocol identity"));
    }
    validate_request_bounds(
        &request.reader_session_id,
        &request.cancellation_id,
        &request.cursor,
        &request.filter,
        request.limit,
        request.ranking_clock_ms,
    )
}

fn generation_scope_v2(request: &BrowsePageRequestV2) -> Result<Value, BrowseReaderError> {
    serde_json::to_value(BrowseGenerationScopeV2 {
        filter: request.filter.clone(),
        friends_predicate_schema_version: request.friends_predicate_schema_version,
        identity_mode: request.identity_mode,
    })
    .map_err(|_| BrowseReaderError::InvalidRequest("query scope"))
}

fn decode_cursor(value: &str) -> Result<DecodedCursor, BrowseReaderError> {
    if value.is_empty() || value.len() > MAXIMUM_CURSOR_BYTES || value.len() % 4 == 1 {
        return Err(BrowseReaderError::InvalidRequest("cursor"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| BrowseReaderError::InvalidRequest("cursor"))?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value
        || bytes.len() < CURSOR_FIXED_BYTES
        || bytes[0] != CURSOR_VERSION
    {
        return Err(BrowseReaderError::InvalidRequest("cursor"));
    }
    let global_id_length = u16::from_be_bytes([bytes[66], bytes[67]]) as usize;
    if global_id_length == 0
        || global_id_length > MAXIMUM_ENTITY_ID_BYTES
        || bytes.len() != CURSOR_FIXED_BYTES + global_id_length
    {
        return Err(BrowseReaderError::InvalidRequest("cursor entity identity"));
    }
    let transition_sequence = read_safe_integer(&bytes[33..41])?;
    let projection_revision = read_safe_integer(&bytes[41..49])?;
    let priority = bytes[49] as i64;
    if priority > 100 {
        return Err(BrowseReaderError::InvalidRequest("cursor priority"));
    }
    let published_at = read_safe_integer(&bytes[50..58])?;
    let source_sequence = read_safe_integer(&bytes[58..66])?;
    let global_id = std::str::from_utf8(&bytes[CURSOR_FIXED_BYTES..])
        .map_err(|_| BrowseReaderError::InvalidRequest("cursor entity identity"))?
        .to_owned();
    let generation_id = lower_hex(&bytes[1..33]);
    Ok(DecodedCursor {
        generation_id: generation_id.clone(),
        transition_sequence,
        projection_revision,
        page_cursor: FeedBrowseCursor {
            generation_id,
            transition_sequence,
            projection_revision,
            priority,
            published_at,
            source_sequence,
            global_id,
        },
    })
}

fn read_safe_integer(bytes: &[u8]) -> Result<i64, BrowseReaderError> {
    let value = u64::from_be_bytes(
        bytes
            .try_into()
            .map_err(|_| BrowseReaderError::InvalidRequest("cursor integer"))?,
    );
    if value > MAXIMUM_SAFE_INTEGER {
        return Err(BrowseReaderError::InvalidRequest("cursor integer"));
    }
    Ok(value as i64)
}

fn encode_cursor(cursor: &FeedBrowseCursor) -> Result<String, BrowseReaderError> {
    if cursor.transition_sequence < 0
        || cursor.projection_revision < 0
        || cursor.priority < 0
        || cursor.priority > 100
        || cursor.published_at < 0
        || cursor.source_sequence < 0
        || [
            cursor.transition_sequence,
            cursor.projection_revision,
            cursor.published_at,
            cursor.source_sequence,
        ]
        .iter()
        .any(|value| *value as u64 > MAXIMUM_SAFE_INTEGER)
    {
        return Err(BrowseReaderError::InvalidRequest("cursor integer"));
    }
    let generation_bytes = decode_lower_hex_64(&cursor.generation_id)?;
    let global_id = cursor.global_id.as_bytes();
    if global_id.is_empty() || global_id.len() > MAXIMUM_ENTITY_ID_BYTES {
        return Err(BrowseReaderError::InvalidRequest("cursor entity identity"));
    }
    let mut bytes = Vec::with_capacity(CURSOR_FIXED_BYTES + global_id.len());
    bytes.push(CURSOR_VERSION);
    bytes.extend_from_slice(&generation_bytes);
    bytes.extend_from_slice(&(cursor.transition_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.projection_revision as u64).to_be_bytes());
    bytes.push(cursor.priority as u8);
    bytes.extend_from_slice(&(cursor.published_at as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.source_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(global_id.len() as u16).to_be_bytes());
    bytes.extend_from_slice(global_id);
    let encoded = URL_SAFE_NO_PAD.encode(bytes);
    if encoded.len() > MAXIMUM_CURSOR_BYTES {
        return Err(BrowseReaderError::InvalidRequest("cursor"));
    }
    Ok(encoded)
}

fn decode_lower_hex_64(value: &str) -> Result<[u8; 32], BrowseReaderError> {
    if value.len() != 64 {
        return Err(BrowseReaderError::InvalidRequest("generation identity"));
    }
    let mut output = [0_u8; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        let offset = index * 2;
        *byte = u8::from_str_radix(&value[offset..offset + 2], 16)
            .map_err(|_| BrowseReaderError::InvalidRequest("generation identity"))?;
    }
    if lower_hex(&output) != value {
        return Err(BrowseReaderError::InvalidRequest("generation identity"));
    }
    Ok(output)
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

fn prune_expired(runtime: &mut BrowseReaderRuntimeInner, now: Instant) {
    runtime.sessions.retain(|_, session| {
        now.checked_duration_since(session.created_at)
            .is_some_and(|age| age <= MAXIMUM_READER_SESSION_AGE)
    });
}

fn reader_key(root_directory: &str, generation_id: &str, selection_sequence: i64) -> String {
    format!("{root_directory}:{generation_id}:{selection_sequence}")
}

fn evict_unreferenced_readers(runtime: &mut BrowseReaderRuntimeInner) {
    if runtime.readers.len() < MAXIMUM_READER_SESSIONS {
        return;
    }
    let referenced = runtime
        .sessions
        .values()
        .map(|session| session.reader_key.as_str())
        .collect::<HashSet<_>>();
    runtime
        .readers
        .retain(|key, _| referenced.contains(key.as_str()));
}

fn map_reader_open_error(error: FeedBrowseGenerationReaderError) -> BrowseReaderError {
    match error {
        FeedBrowseGenerationReaderError::Registry(
            FeedBrowseGenerationRegistryError::NoSelectedGeneration,
        ) => BrowseReaderError::RuntimeInactive,
        other => BrowseReaderError::Reader(other),
    }
}

fn read_at_root(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
    base: &Path,
    request: BrowsePageRequestV1,
    now: Instant,
) -> Result<BrowsePageResponseV1, BrowseReaderError> {
    validate_request_v1(&request)?;
    let decoded_cursor = request.cursor.0.as_deref().map(decode_cursor).transpose()?;
    let page = read_physical_page_in_root(
        state,
        base,
        crate::library_core_feed_browse_runtime::ROOT_DIRECTORY_FOR_ADAPTERS,
        FeedBrowsePhysicalReadRequest {
            reader_session_id: &request.reader_session_id,
            cancellation_id: &request.cancellation_id,
            cursor_identity: request.cursor.0.as_deref(),
            cursor: decoded_cursor.as_ref().map(|cursor| &cursor.page_cursor),
            limit: request.limit as usize,
            expected_filter: &request.filter,
            ranking_clock_ms: request.ranking_clock_ms,
            recommendation_order_schema_version: request.recommendation_order_schema_version,
        },
        now,
    )?;
    let response = response_from_page(page)?;
    ensure_response_size(&response)?;
    Ok(response)
}

fn read_v2_at_root(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
    base: &Path,
    request: BrowsePageRequestV2,
    now: Instant,
) -> Result<BrowsePageResponseV2, BrowseReaderError> {
    validate_request_v2(&request)?;
    let decoded_cursor = request.cursor.0.as_deref().map(decode_cursor).transpose()?;
    let expected_scope = generation_scope_v2(&request)?;
    let page = read_physical_page_in_root(
        state,
        base,
        crate::library_core_feed_browse_runtime::ROOT_DIRECTORY_FOR_ADAPTERS,
        FeedBrowsePhysicalReadRequest {
            reader_session_id: &request.reader_session_id,
            cancellation_id: &request.cancellation_id,
            cursor_identity: request.cursor.0.as_deref(),
            cursor: decoded_cursor.as_ref().map(|cursor| &cursor.page_cursor),
            limit: request.limit as usize,
            expected_filter: &expected_scope,
            ranking_clock_ms: request.ranking_clock_ms,
            recommendation_order_schema_version: request.recommendation_order_schema_version,
        },
        now,
    )?;
    let response = response_v2_from_page(page)?;
    ensure_response_size(&response)?;
    Ok(response)
}

fn read_request_at_root(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
    base: &Path,
    request: BrowsePageRequest,
    now: Instant,
) -> Result<BrowsePageResponse, BrowseReaderError> {
    match request {
        BrowsePageRequest::V1(request) => {
            read_at_root(state, base, request, now).map(BrowsePageResponse::V1)
        }
        BrowsePageRequest::V2(request) => {
            read_v2_at_root(state, base, request, now).map(BrowsePageResponse::V2)
        }
    }
}

pub(super) struct FeedBrowsePhysicalReadRequest<'a> {
    pub(super) reader_session_id: &'a str,
    pub(super) cancellation_id: &'a str,
    pub(super) cursor_identity: Option<&'a str>,
    pub(super) cursor: Option<&'a FeedBrowseCursor>,
    pub(super) limit: usize,
    pub(super) expected_filter: &'a Value,
    pub(super) ranking_clock_ms: i64,
    pub(super) recommendation_order_schema_version: i64,
}

fn read_physical_page_in_root(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
    base: &Path,
    root_directory: &str,
    request: FeedBrowsePhysicalReadRequest<'_>,
    now: Instant,
) -> Result<FeedBrowsePage, BrowseReaderError> {
    if !is_operation_instance_id(request.reader_session_id)
        || !is_operation_instance_id(request.cancellation_id)
        || !(1..=MAXIMUM_PAGE_LIMIT as usize).contains(&request.limit)
        || request.ranking_clock_ms < 0
        || request.ranking_clock_ms as u64 > MAXIMUM_SAFE_INTEGER
        || request.recommendation_order_schema_version < 1
    {
        return Err(BrowseReaderError::InvalidRequest("physical page bounds"));
    }
    let mut runtime = state
        .0
        .lock()
        .map_err(|_| BrowseReaderError::StatePoisoned)?;
    if runtime.quiesced {
        return Err(BrowseReaderError::RuntimeInactive);
    }
    prune_expired(&mut runtime, now);

    if runtime
        .sessions
        .get(request.reader_session_id)
        .is_some_and(|session| session.root_directory != root_directory)
    {
        return Err(BrowseReaderError::CursorStale);
    }

    if !runtime.sessions.contains_key(request.reader_session_id) {
        if request.cursor.is_some() {
            return Err(BrowseReaderError::CursorStale);
        }
        if runtime.sessions.len() >= MAXIMUM_READER_SESSIONS {
            return Err(BrowseReaderError::SessionLimit);
        }
        let paths = resolve_existing_library_core_feed_browse_paths_in_root(base, root_directory)
            .map_err(|error| BrowseReaderError::RuntimePath(error.to_string()))?
            .ok_or(BrowseReaderError::RuntimeInactive)?;
        let selected = FeedBrowseGenerationRegistry::read_selected_generation(&paths.registry_path)
            .map_err(|error| match error {
                FeedBrowseGenerationRegistryError::NoSelectedGeneration => {
                    BrowseReaderError::RuntimeInactive
                }
                other => {
                    BrowseReaderError::Reader(FeedBrowseGenerationReaderError::Registry(other))
                }
            })?;
        let key = reader_key(
            root_directory,
            &selected.generation.binding.generation_id,
            selected.transition_sequence,
        );
        if !runtime.readers.contains_key(&key) {
            evict_unreferenced_readers(&mut runtime);
            if runtime.readers.len() >= MAXIMUM_READER_SESSIONS {
                return Err(BrowseReaderError::SessionLimit);
            }
            let reader =
                FeedBrowseGenerationReader::open(&paths.registry_path, &paths.generation_root)
                    .map_err(map_reader_open_error)?;
            if reader.generation_id() != selected.generation.binding.generation_id
                || reader.selection_sequence() != selected.transition_sequence
            {
                return Err(BrowseReaderError::CursorStale);
            }
            runtime.readers.insert(key.clone(), CachedReader { reader });
        }
        runtime.sessions.insert(
            request.reader_session_id.to_owned(),
            ReaderSession {
                root_directory: root_directory.to_owned(),
                reader_key: key,
                created_at: now,
                active_cancellation_id: request.cancellation_id.to_owned(),
                last_request: None,
            },
        );
    }

    let key = runtime
        .sessions
        .get(request.reader_session_id)
        .ok_or(BrowseReaderError::CursorStale)?
        .reader_key
        .clone();
    let request_identity = RequestIdentity {
        cancellation_id: request.cancellation_id.to_owned(),
        cursor: request.cursor_identity.map(str::to_owned),
        limit: request.limit as u32,
    };
    if runtime
        .sessions
        .get(request.reader_session_id)
        .and_then(|session| session.last_request.as_ref())
        .is_some_and(|prior| {
            prior.cancellation_id == request.cancellation_id && prior != &request_identity
        })
    {
        return Err(BrowseReaderError::InvalidRequest("cancellation replay"));
    }
    runtime
        .sessions
        .get_mut(request.reader_session_id)
        .ok_or(BrowseReaderError::CursorStale)?
        .active_cancellation_id = request.cancellation_id.to_owned();
    let reader = &runtime
        .readers
        .get(&key)
        .ok_or(BrowseReaderError::CursorStale)?
        .reader;
    let binding = reader.binding();
    let stored_filter = serde_json::from_str::<Value>(&binding.filter_json)
        .map_err(|_| BrowseReaderError::InvalidRequest("stored filter"))?;
    if stored_filter != *request.expected_filter
        || binding.ranking_clock_ms != request.ranking_clock_ms
        || binding.recommendation_order_schema_version
            != request.recommendation_order_schema_version
    {
        return Err(BrowseReaderError::CursorStale);
    }
    if let Some(cursor) = request.cursor {
        if cursor.generation_id != binding.generation_id
            || cursor.transition_sequence != binding.transition_sequence
            || cursor.projection_revision != binding.projection_revision
        {
            return Err(BrowseReaderError::CursorStale);
        }
    }
    let page = reader
        .read_page(request.cursor, request.limit)
        .map_err(|error| match error {
            FeedBrowseGenerationReaderError::Store(FeedBrowseStoreError::CursorStale) => {
                BrowseReaderError::CursorStale
            }
            other => BrowseReaderError::Reader(other),
        })?;
    let exhausted = page.next_cursor.is_none();
    runtime
        .sessions
        .get_mut(request.reader_session_id)
        .ok_or(BrowseReaderError::CursorStale)?
        .last_request = Some(request_identity);
    if exhausted {
        runtime.sessions.remove(request.reader_session_id);
    }
    Ok(page)
}

pub(super) fn read_library_core_feed_browse_physical_page_in_root(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
    base: &Path,
    root_directory: &str,
    request: FeedBrowsePhysicalReadRequest<'_>,
) -> Result<FeedBrowsePage, String> {
    read_physical_page_in_root(state, base, root_directory, request, Instant::now())
        .map_err(|error| error.to_string())
}

struct BrowsePageResponseParts {
    binding_filter: Value,
    next_cursor: Option<String>,
    next_order: Option<BrowseNextOrderV1>,
    ranking_clock_ms: i64,
    recommendation_order_schema_version: i64,
    rows: Vec<Value>,
    source: FeedPageSourceV1,
    total_count: i64,
}

fn response_parts_from_page(
    page: FeedBrowsePage,
) -> Result<BrowsePageResponseParts, BrowseReaderError> {
    let binding = page.binding;
    if binding.total_rows < page.rows.len() as i64 {
        return Err(BrowseReaderError::InvalidRequest("response count"));
    }
    let binding_filter = serde_json::from_str(&binding.filter_json)
        .map_err(|_| BrowseReaderError::InvalidRequest("stored filter"))?;
    let mut rows = Vec::with_capacity(page.rows.len());
    for row in &page.rows {
        let value: Value = serde_json::from_str(&row.card_json)
            .map_err(|_| BrowseReaderError::InvalidRequest("stored row"))?;
        let object = value
            .as_object()
            .ok_or(BrowseReaderError::InvalidRequest("stored row"))?;
        let published_at = object
            .get("publishedAt")
            .and_then(Value::as_i64)
            .ok_or(BrowseReaderError::InvalidRequest("stored row identity"))?;
        if object.get("globalId").and_then(Value::as_str) != Some(row.global_id.as_str())
            || published_at != row.published_at
        {
            return Err(BrowseReaderError::InvalidRequest("stored row identity"));
        }
        rows.push(value);
    }
    let next_cursor = page.next_cursor.as_ref().map(encode_cursor).transpose()?;
    let next_order = page.next_cursor.map(|cursor| BrowseNextOrderV1 {
        global_id: cursor.global_id,
        priority: cursor.priority,
        published_at: cursor.published_at,
        source_sequence: cursor.source_sequence,
    });
    Ok(BrowsePageResponseParts {
        binding_filter,
        next_cursor,
        next_order,
        ranking_clock_ms: binding.ranking_clock_ms,
        recommendation_order_schema_version: binding.recommendation_order_schema_version,
        rows,
        source: FeedPageSourceV1 {
            generation_id: binding.generation_id,
            projection_revision: binding.projection_revision,
            transition_sequence: binding.transition_sequence,
        },
        total_count: binding.total_rows,
    })
}

fn response_from_page(page: FeedBrowsePage) -> Result<BrowsePageResponseV1, BrowseReaderError> {
    let parts = response_parts_from_page(page)?;
    Ok(BrowsePageResponseV1 {
        filter: parts.binding_filter,
        next_cursor: parts.next_cursor,
        next_order: parts.next_order,
        query_id: QUERY_ID_V1,
        ranking_clock_ms: parts.ranking_clock_ms,
        recommendation_order_schema_version: parts.recommendation_order_schema_version,
        rows: parts.rows,
        schema_version: SCHEMA_VERSION_V1,
        source: parts.source,
        total_count: parts.total_count,
    })
}

fn response_v2_from_page(page: FeedBrowsePage) -> Result<BrowsePageResponseV2, BrowseReaderError> {
    let parts = response_parts_from_page(page)?;
    let scope = serde_json::from_value::<BrowseGenerationScopeV2>(parts.binding_filter)
        .map_err(|_| BrowseReaderError::InvalidRequest("stored query scope"))?;
    if scope.friends_predicate_schema_version != FRIENDS_PREDICATE_SCHEMA_VERSION {
        return Err(BrowseReaderError::InvalidRequest("stored query scope"));
    }
    Ok(BrowsePageResponseV2 {
        filter: scope.filter,
        friends_predicate_schema_version: scope.friends_predicate_schema_version,
        identity_mode: scope.identity_mode,
        next_cursor: parts.next_cursor,
        next_order: parts.next_order,
        query_id: QUERY_ID_V2,
        ranking_clock_ms: parts.ranking_clock_ms,
        recommendation_order_schema_version: parts.recommendation_order_schema_version,
        rows: parts.rows,
        schema_version: SCHEMA_VERSION_V2,
        source: parts.source,
        total_count: parts.total_count,
    })
}

struct BoundedResponseWriter {
    written: usize,
}

impl Write for BoundedResponseWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.written = self
            .written
            .checked_add(bytes.len())
            .ok_or_else(|| std::io::Error::other("feed browse byte count overflow"))?;
        if self.written > MAXIMUM_RESPONSE_BYTES {
            return Err(std::io::Error::other(
                "feed browse response exceeds its byte ceiling",
            ));
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn ensure_response_size(response: &impl Serialize) -> Result<(), BrowseReaderError> {
    serde_json::to_writer(&mut BoundedResponseWriter { written: 0 }, response)
        .map_err(|_| BrowseReaderError::ResponseTooLarge)
}

fn cancel_session(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
    reader_session_id: &str,
    cancellation_id: &str,
) -> Result<BrowseReaderCancellationV1, BrowseReaderError> {
    if !is_operation_instance_id(reader_session_id) || !is_operation_instance_id(cancellation_id) {
        return Err(BrowseReaderError::InvalidRequest("operation identity"));
    }
    let mut runtime = state
        .0
        .lock()
        .map_err(|_| BrowseReaderError::StatePoisoned)?;
    let released = runtime
        .sessions
        .get(reader_session_id)
        .is_some_and(|session| session.active_cancellation_id == cancellation_id);
    if released {
        runtime.sessions.remove(reader_session_id);
    }
    Ok(BrowseReaderCancellationV1 { released })
}

pub(super) fn cancel_library_core_feed_browse_reader_in_state(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
    reader_session_id: &str,
    cancellation_id: &str,
) -> Result<(), String> {
    cancel_session(state, reader_session_id, cancellation_id)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(super) fn quiesce_library_core_feed_browse_reader_runtime(
    state: &LibraryCoreFeedBrowseReaderRuntimeState,
) -> Result<(), String> {
    let mut runtime = state
        .0
        .lock()
        .map_err(|_| BrowseReaderError::StatePoisoned.to_string())?;
    runtime.quiesced = true;
    runtime.sessions.clear();
    runtime.readers.clear();
    Ok(())
}

#[tauri::command]
pub(super) fn read_library_core_feed_browse_page(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreFeedBrowseReaderRuntimeState>,
    request: BrowsePageRequest,
) -> Result<BrowsePageResponse, BrowseReaderErrorResponse> {
    let base = app.path().app_data_dir().map_err(|error| {
        BrowseReaderErrorResponse::from(BrowseReaderError::RuntimePath(error.to_string()))
    })?;
    read_request_at_root(&state, &base, request, Instant::now()).map_err(Into::into)
}

#[tauri::command]
pub(super) fn cancel_library_core_feed_browse_reader(
    state: tauri::State<'_, LibraryCoreFeedBrowseReaderRuntimeState>,
    reader_session_id: String,
    cancellation_id: String,
) -> Result<BrowseReaderCancellationV1, BrowseReaderErrorResponse> {
    cancel_session(&state, &reader_session_id, &cancellation_id).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_feed_browse_runtime::{
        resolve_library_core_feed_browse_paths_in_root, ROOT_DIRECTORY_FOR_ADAPTERS,
    };
    use crate::library_core_feed_browse_store::{
        FeedBrowseGenerationBinding, FeedBrowseGenerationStore, FeedBrowseProjectedRow,
    };

    const FILTER_JSON: &str = r#"{"archivedOnly":false,"authorId":null,"feedUrl":null,"platform":"x","savedOnly":true,"schemaVersion":1,"showHidden":false,"signals":[],"socialContentFilter":"all","tags":[]}"#;

    fn binding_with_filter(total_rows: i64, filter_json: String) -> FeedBrowseGenerationBinding {
        FeedBrowseGenerationBinding {
            generation_id: "a".repeat(64),
            source_document_id: "library-1".to_owned(),
            source_heads_digest: "b".repeat(64),
            source_head_count: 2,
            transition_sequence: 12,
            projection_revision: 34,
            filter_json,
            ranking_clock_ms: 1_780_000_100_000,
            recommendation_order_schema_version: 1,
            total_rows,
        }
    }

    fn card(global_id: &str, published_at: i64) -> String {
        serde_json::json!({
            "archived": false,
            "authorAvatarUrl": null,
            "authorDisplayName": null,
            "authorHandle": null,
            "authorId": null,
            "capturedAt": published_at + 1,
            "contentSignalTags": [],
            "contentText": "Bounded",
            "contentType": "post",
            "engagementComments": null,
            "engagementLikes": null,
            "eventConfidenceBasisPoints": null,
            "eventStartsAt": null,
            "globalId": global_id,
            "liked": false,
            "likedAt": null,
            "likedSyncedAt": null,
            "linkPreviewTitle": null,
            "locationName": null,
            "mediaTypes": [],
            "mediaUrls": [],
            "platform": "x",
            "publishedAt": published_at,
            "readAt": null,
            "readingTimeMinutes": null,
            "saved": true,
            "sourceUrl": null,
            "tags": [],
        })
        .to_string()
    }

    fn row(
        global_id: &str,
        priority: i64,
        published_at: i64,
        source_sequence: i64,
    ) -> FeedBrowseProjectedRow {
        FeedBrowseProjectedRow {
            priority,
            published_at,
            source_sequence,
            global_id: global_id.to_owned(),
            card_json: card(global_id, published_at),
        }
    }

    fn request(cursor: Option<String>, cancellation_id: &str) -> BrowsePageRequestV1 {
        BrowsePageRequestV1 {
            cancellation_id: cancellation_id.to_owned(),
            cursor: RequiredNullableCursor(cursor),
            filter: serde_json::from_str(FILTER_JSON).expect("filter"),
            limit: 1,
            query_id: QUERY_ID_V1.to_owned(),
            ranking_clock_ms: 1_780_000_100_000,
            reader_session_id: "reader-session-1".to_owned(),
            recommendation_order_schema_version: 1,
            schema_version: 1,
        }
    }

    fn v2_request(
        cursor: Option<String>,
        cancellation_id: &str,
        identity_mode: BrowseIdentityModeV2,
    ) -> BrowsePageRequestV2 {
        BrowsePageRequestV2 {
            cancellation_id: cancellation_id.to_owned(),
            cursor: RequiredNullableCursor(cursor),
            filter: serde_json::from_str(FILTER_JSON).expect("filter"),
            friends_predicate_schema_version: FRIENDS_PREDICATE_SCHEMA_VERSION,
            identity_mode,
            limit: 1,
            query_id: QUERY_ID_V2.to_owned(),
            ranking_clock_ms: 1_780_000_100_000,
            reader_session_id: "reader-session-2".to_owned(),
            recommendation_order_schema_version: 1,
            schema_version: SCHEMA_VERSION_V2,
        }
    }

    fn v2_scope_json(identity_mode: BrowseIdentityModeV2) -> String {
        serde_json::to_string(&BrowseGenerationScopeV2 {
            filter: serde_json::from_str(FILTER_JSON).expect("filter"),
            friends_predicate_schema_version: FRIENDS_PREDICATE_SCHEMA_VERSION,
            identity_mode,
        })
        .expect("scope")
    }

    fn publish_and_select(base: &Path) {
        publish_and_select_in_root(
            base,
            ROOT_DIRECTORY_FOR_ADAPTERS,
            vec![
                row("x:item-1", 91, 1_780_000_000_000, 56),
                row("x:item-2", 80, 1_779_000_000_000, 57),
            ],
        );
    }

    fn publish_and_select_in_root(
        base: &Path,
        root_directory: &str,
        rows: Vec<FeedBrowseProjectedRow>,
    ) {
        publish_and_select_in_root_with_filter(base, root_directory, FILTER_JSON.to_owned(), rows);
    }

    fn publish_and_select_in_root_with_filter(
        base: &Path,
        root_directory: &str,
        filter_json: String,
        rows: Vec<FeedBrowseProjectedRow>,
    ) {
        let paths =
            resolve_library_core_feed_browse_paths_in_root(base, root_directory).expect("paths");
        let identity = binding_with_filter(rows.len() as i64, filter_json);
        let path = paths
            .generation_root
            .join(format!("{}.sqlite", identity.generation_id));
        let published = {
            let mut store = FeedBrowseGenerationStore::open(&path).expect("store");
            store.begin(&identity).expect("begin");
            store.append_page(0, &rows).expect("append");
            store.finalize().expect("finalize");
            store.seal(&path, &identity).expect("seal")
        };
        let mut registry =
            FeedBrowseGenerationRegistry::open(&paths.registry_path, &paths.generation_root)
                .expect("registry");
        registry.register(&published).expect("register");
        registry
            .select("transition-1", None, &identity.generation_id)
            .expect("select");
    }

    #[test]
    fn cursor_codec_matches_the_shared_typescript_vector() {
        let cursor = FeedBrowseCursor {
            generation_id: "a".repeat(64),
            transition_sequence: 12,
            projection_revision: 34,
            priority: 91,
            published_at: 1_780_000_000_000,
            source_sequence: 56,
            global_id: "x:item-1".to_owned(),
        };
        let encoded = encode_cursor(&cursor).expect("encode");
        assert_eq!(
            encoded,
            "AaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAAAAAwAAAAAAAAAIlsAAAGecESIAAAAAAAAAAA4AAh4Oml0ZW0tMQ"
        );
        let decoded = decode_cursor(&encoded).expect("decode");
        assert_eq!(decoded.generation_id, cursor.generation_id);
        assert_eq!(decoded.transition_sequence, cursor.transition_sequence);
        assert_eq!(decoded.projection_revision, cursor.projection_revision);
        assert_eq!(decoded.page_cursor.priority, cursor.priority);
        assert_eq!(decoded.page_cursor.published_at, cursor.published_at);
        assert_eq!(decoded.page_cursor.source_sequence, cursor.source_sequence);
        assert_eq!(decoded.page_cursor.global_id, cursor.global_id);
    }

    #[test]
    fn reads_one_selected_generation_with_a_pinned_cursor() {
        let v1_wire_request = serde_json::json!({
            "cancellationId": "cancel-v1-wire",
            "cursor": null,
            "filter": serde_json::from_str::<Value>(FILTER_JSON).expect("filter"),
            "limit": 1,
            "queryId": QUERY_ID_V1,
            "rankingClockMs": 1_780_000_100_000_i64,
            "readerSessionId": "reader-session-v1-wire",
            "recommendationOrderSchemaVersion": 1,
            "schemaVersion": SCHEMA_VERSION_V1,
        });
        assert!(matches!(
            serde_json::from_value::<BrowsePageRequest>(v1_wire_request).expect("V1 request"),
            BrowsePageRequest::V1(_)
        ));
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        publish_and_select(&base);
        let state = LibraryCoreFeedBrowseReaderRuntimeState::default();
        let first = read_at_root(&state, &base, request(None, "cancel-1"), Instant::now())
            .expect("first page");
        assert_eq!(first.rows.len(), 1);
        assert_eq!(first.total_count, 2);
        assert_eq!(first.source.generation_id, "a".repeat(64));
        let first_wire = serde_json::to_value(&first).expect("serialize V1 response");
        assert_eq!(first_wire["queryId"], QUERY_ID_V1);
        assert_eq!(first_wire["schemaVersion"], SCHEMA_VERSION_V1);
        assert!(first_wire.get("identityMode").is_none());
        assert!(first_wire.get("friendsPredicateSchemaVersion").is_none());
        let cursor = first.next_cursor.expect("cursor");
        let second = read_at_root(
            &state,
            &base,
            request(Some(cursor), "cancel-2"),
            Instant::now(),
        )
        .expect("second page");
        assert_eq!(second.rows.len(), 1);
        let cursor = second.next_cursor.expect("terminal probe cursor");
        let terminal = read_at_root(
            &state,
            &base,
            request(Some(cursor), "cancel-3"),
            Instant::now(),
        )
        .expect("terminal page");
        assert!(terminal.rows.is_empty());
        assert!(terminal.next_cursor.is_none());
    }

    #[test]
    fn reads_a_v2_friends_generation_and_echoes_its_complete_scope() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        publish_and_select_in_root_with_filter(
            &base,
            ROOT_DIRECTORY_FOR_ADAPTERS,
            v2_scope_json(BrowseIdentityModeV2::Friends),
            vec![row("x:friend", 91, 1_780_000_000_000, 56)],
        );
        let state = LibraryCoreFeedBrowseReaderRuntimeState::default();
        let response = read_v2_at_root(
            &state,
            &base,
            v2_request(None, "friends-cancel-1", BrowseIdentityModeV2::Friends),
            Instant::now(),
        )
        .expect("V2 Friends page");

        assert_eq!(response.query_id, QUERY_ID_V2);
        assert_eq!(response.schema_version, SCHEMA_VERSION_V2);
        assert_eq!(
            response.friends_predicate_schema_version,
            FRIENDS_PREDICATE_SCHEMA_VERSION
        );
        assert_eq!(response.identity_mode, BrowseIdentityModeV2::Friends);
        assert_eq!(
            response.filter,
            serde_json::from_str::<Value>(FILTER_JSON).expect("filter")
        );
        assert_eq!(response.rows.len(), 1);
        assert_eq!(response.rows[0]["globalId"], "x:friend");
    }

    #[test]
    fn rejects_invalid_or_unknown_v2_scope() {
        let mut invalid_version =
            v2_request(None, "friends-cancel-1", BrowseIdentityModeV2::Friends);
        invalid_version.friends_predicate_schema_version = 2;
        assert!(matches!(
            validate_request_v2(&invalid_version),
            Err(BrowseReaderError::InvalidRequest("protocol identity"))
        ));

        let unknown_identity = serde_json::json!({
            "cancellationId": "friends-cancel-1",
            "cursor": null,
            "filter": serde_json::from_str::<Value>(FILTER_JSON).expect("filter"),
            "friendsPredicateSchemaVersion": FRIENDS_PREDICATE_SCHEMA_VERSION,
            "identityMode": "unknown",
            "limit": 1,
            "queryId": QUERY_ID_V2,
            "rankingClockMs": 1_780_000_100_000_i64,
            "readerSessionId": "reader-session-2",
            "recommendationOrderSchemaVersion": 1,
            "schemaVersion": SCHEMA_VERSION_V2,
        });
        assert!(serde_json::from_value::<BrowsePageRequest>(unknown_identity).is_err());

        let mut v1_cross_protocol = request(None, "cancel-v1-cross-protocol");
        v1_cross_protocol.filter =
            serde_json::from_str(&v2_scope_json(BrowseIdentityModeV2::Friends)).expect("V2 scope");
        assert!(matches!(
            validate_request_v1(&v1_cross_protocol),
            Err(BrowseReaderError::InvalidRequest("protocol identity"))
        ));
    }

    #[test]
    fn rejects_a_v2_generation_scope_mismatch_without_searching_another_generation() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        publish_and_select_in_root_with_filter(
            &base,
            ROOT_DIRECTORY_FOR_ADAPTERS,
            v2_scope_json(BrowseIdentityModeV2::Friends),
            vec![row("x:friend", 91, 1_780_000_000_000, 56)],
        );
        let state = LibraryCoreFeedBrowseReaderRuntimeState::default();
        assert!(matches!(
            read_v2_at_root(
                &state,
                &base,
                v2_request(
                    None,
                    "friends-cancel-mismatch",
                    BrowseIdentityModeV2::AllContent,
                ),
                Instant::now(),
            ),
            Err(BrowseReaderError::CursorStale)
        ));
        assert!(
            cancel_session(&state, "reader-session-2", "friends-cancel-mismatch")
                .expect("cancel failed read")
                .released
        );
    }

    #[test]
    fn reader_cache_is_fenced_by_the_physical_root() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        let saved_root = "library-core-saved-feed-v1";
        publish_and_select_in_root(
            &base,
            ROOT_DIRECTORY_FOR_ADAPTERS,
            vec![row("x:ordinary", 91, 1_780_000_000_000, 56)],
        );
        publish_and_select_in_root(
            &base,
            saved_root,
            vec![row("x:saved", 91, 1_780_000_000_000, 56)],
        );
        let state = LibraryCoreFeedBrowseReaderRuntimeState::default();
        let filter = serde_json::from_str::<Value>(FILTER_JSON).expect("filter");
        let ordinary = read_physical_page_in_root(
            &state,
            &base,
            ROOT_DIRECTORY_FOR_ADAPTERS,
            FeedBrowsePhysicalReadRequest {
                reader_session_id: "ordinary-reader",
                cancellation_id: "ordinary-cancel",
                cursor_identity: None,
                cursor: None,
                limit: 1,
                expected_filter: &filter,
                ranking_clock_ms: 1_780_000_100_000,
                recommendation_order_schema_version: 1,
            },
            Instant::now(),
        )
        .expect("ordinary page");
        let saved = read_physical_page_in_root(
            &state,
            &base,
            saved_root,
            FeedBrowsePhysicalReadRequest {
                reader_session_id: "saved-reader",
                cancellation_id: "saved-cancel",
                cursor_identity: None,
                cursor: None,
                limit: 1,
                expected_filter: &filter,
                ranking_clock_ms: 1_780_000_100_000,
                recommendation_order_schema_version: 1,
            },
            Instant::now(),
        )
        .expect("saved page");

        assert_eq!(ordinary.rows[0].global_id, "x:ordinary");
        assert!(matches!(
            read_physical_page_in_root(
                &state,
                &base,
                saved_root,
                FeedBrowsePhysicalReadRequest {
                    reader_session_id: "ordinary-reader",
                    cancellation_id: "saved-cross-root-cancel",
                    cursor_identity: None,
                    cursor: None,
                    limit: 1,
                    expected_filter: &filter,
                    ranking_clock_ms: 1_780_000_100_000,
                    recommendation_order_schema_version: 1,
                },
                Instant::now(),
            ),
            Err(BrowseReaderError::CursorStale)
        ));
        assert_eq!(saved.rows[0].global_id, "x:saved");
        let runtime = state.0.lock().expect("reader state");
        assert_eq!(runtime.readers.len(), 2);
        assert!(runtime.readers.contains_key(&reader_key(
            ROOT_DIRECTORY_FOR_ADAPTERS,
            &"a".repeat(64),
            1,
        )));
        assert!(runtime
            .readers
            .contains_key(&reader_key(saved_root, &"a".repeat(64), 1,)));
    }

    #[test]
    fn rejects_a_filter_mismatch() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        publish_and_select(&base);
        let state = LibraryCoreFeedBrowseReaderRuntimeState::default();
        let mut mismatched = request(None, "cancel-1");
        mismatched.filter["savedOnly"] = Value::Bool(false);
        assert!(matches!(
            read_at_root(&state, &base, mismatched, Instant::now()),
            Err(BrowseReaderError::CursorStale)
        ));
        assert!(
            cancel_session(&state, "reader-session-1", "cancel-1")
                .expect("cancel failed read")
                .released
        );
    }
}
