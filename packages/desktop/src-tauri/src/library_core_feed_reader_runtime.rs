//! Dormant bounded feed reader for selected Library Core SQLite generations.
//!
//! Automerge remains authoritative and no product caller invokes these
//! commands. The runtime pins one authenticated immutable generation for a
//! short, bounded reader session so keyset cursors cannot drift across a
//! projection transition.

use crate::library_core_shadow_runtime::resolve_library_core_shadow_reader_paths;
use crate::projection_coordinator::{
    open_selected_projection, ProjectionCoordinatorError, ProjectionReadSession,
};
use crate::projection_generation_reader::ProjectionGenerationReaderError;
use crate::projection_generation_registry::{
    ProjectionGenerationRegistry, ProjectionGenerationRegistryError,
};
use crate::shadow_store::{
    FeedCardRow, FeedItemRow, FeedPage, ItemScanPage, LibraryFacetSummary, LibrarySurface,
    PageCursor, ShadowStoreError,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const QUERY_ID: &str = "feed_page_v1";
const SCHEMA_VERSION: u8 = 1;
const MAXIMUM_PAGE_LIMIT: u32 = 128;
const MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const MAXIMUM_CURSOR_BYTES: usize = 5_540;
const MAXIMUM_ENTITY_ID_BYTES: usize = 4_096;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const CURSOR_VERSION: u8 = 1;
const CURSOR_FIXED_BYTES: usize = 59;
const MAXIMUM_READER_SESSIONS: usize = 2;
const MAXIMUM_READER_SESSION_AGE: Duration = Duration::from_secs(60);
const ITEM_DETAIL_QUERY_ID: &str = "item_detail_v1";
const MAXIMUM_ITEM_DETAIL_RESPONSE_BYTES: usize = 8 * 1_048_576;
const MAXIMUM_DOCUMENT_ID_BYTES: usize = 4_096;
const ITEM_SCAN_QUERY_ID: &str = "background_item_page_v1";
const MAXIMUM_ITEM_SCAN_PAGE_LIMIT: u32 = 64;
const ITEM_SCAN_CURSOR_VERSION: u8 = 1;
const ITEM_SCAN_CURSOR_FIXED_BYTES: usize = 51;
const FACET_SUMMARY_QUERY_ID: &str = "library_facet_summary_v1";
const SURFACE_ITEMS_QUERY_ID: &str = "library_surface_items_v1";
const MAXIMUM_MAP_ITEMS: u32 = 1_000;

#[derive(Debug)]
enum FeedReaderError {
    Coordinator(ProjectionCoordinatorError),
    RuntimePath(String),
    RuntimeInactive,
    InvalidRequest(&'static str),
    CursorStale,
    SessionLimit,
    StatePoisoned,
    ResponseTooLarge,
}

impl From<ProjectionCoordinatorError> for FeedReaderError {
    fn from(error: ProjectionCoordinatorError) -> Self {
        Self::Coordinator(error)
    }
}

impl FeedReaderError {
    fn code(&self) -> &'static str {
        match self {
            Self::RuntimeInactive => "RUNTIME_INACTIVE",
            Self::CursorStale => "CURSOR_STALE",
            Self::SessionLimit => "SESSION_LIMIT",
            Self::InvalidRequest(_) => "INVALID_REQUEST",
            Self::ResponseTooLarge => "RESPONSE_TOO_LARGE",
            Self::Coordinator(_) | Self::RuntimePath(_) | Self::StatePoisoned => {
                "READER_UNAVAILABLE"
            }
        }
    }
}

impl fmt::Display for FeedReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Coordinator(error) => write!(formatter, "{error}"),
            Self::RuntimePath(error) => formatter.write_str(error),
            Self::RuntimeInactive => {
                formatter.write_str("Library Core feed reader is not initialized")
            }
            Self::InvalidRequest(field) => write!(formatter, "invalid feed reader {field}"),
            Self::CursorStale => formatter.write_str("Library Core feed cursor is stale"),
            Self::SessionLimit => formatter.write_str("Library Core feed reader is at capacity"),
            Self::StatePoisoned => {
                formatter.write_str("Library Core feed reader state is unavailable")
            }
            Self::ResponseTooLarge => {
                formatter.write_str("Library Core feed response exceeds its byte ceiling")
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FeedReaderErrorResponse {
    code: &'static str,
    message: String,
}

impl From<FeedReaderError> for FeedReaderErrorResponse {
    fn from(error: FeedReaderError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FeedPageRequestV1 {
    cancellation_id: String,
    cursor: RequiredNullableCursor,
    limit: u32,
    query_id: String,
    reader_session_id: String,
    schema_version: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
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
                Ok(RequiredNullableCursor(Some(value.to_string())))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(RequiredNullableCursor(Some(value)))
            }
        }

        deserializer.deserialize_any(CursorVisitor)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RequestIdentity {
    Feed {
        cancellation_id: String,
        cursor: Option<String>,
        limit: u32,
    },
    ItemScan {
        cancellation_id: String,
        cursor: Option<String>,
        limit: u32,
    },
}

impl RequestIdentity {
    fn cancellation_id(&self) -> &str {
        match self {
            Self::Feed {
                cancellation_id, ..
            }
            | Self::ItemScan {
                cancellation_id, ..
            } => cancellation_id,
        }
    }
}

impl From<&FeedPageRequestV1> for RequestIdentity {
    fn from(request: &FeedPageRequestV1) -> Self {
        Self::Feed {
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ItemDetailRequestV1 {
    global_id: String,
    query_id: String,
    schema_version: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ItemDetailSourceV1 {
    document_id: String,
    generation_id: String,
    head_count: i64,
    heads_digest: String,
    projection_revision: i64,
    storage_generation: i64,
    storage_save_revision: i64,
    transition_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ItemDetailResponseV1 {
    item: Option<FeedItemRow>,
    query_id: &'static str,
    schema_version: u8,
    source: ItemDetailSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FacetSummaryRequestV1 {
    query_id: String,
    schema_version: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FacetSummaryResponseV1 {
    query_id: &'static str,
    schema_version: u8,
    source: ItemDetailSourceV1,
    summary: LibraryFacetSummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SurfaceKindV1 {
    Map,
}

impl SurfaceKindV1 {
    fn store_surface(self) -> LibrarySurface {
        match self {
            Self::Map => LibrarySurface::Map,
        }
    }

    fn maximum(self) -> u32 {
        match self {
            Self::Map => MAXIMUM_MAP_ITEMS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SurfaceItemsRequestV1 {
    limit: u32,
    query_id: String,
    schema_version: u8,
    surface: SurfaceKindV1,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SurfaceItemsResponseV1 {
    query_id: &'static str,
    rows: Vec<FeedItemRow>,
    schema_version: u8,
    source: ItemDetailSourceV1,
    surface: SurfaceKindV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ItemScanRequestV1 {
    cancellation_id: String,
    cursor: RequiredNullableCursor,
    limit: u32,
    query_id: String,
    reader_session_id: String,
    schema_version: u8,
}

impl From<&ItemScanRequestV1> for RequestIdentity {
    fn from(request: &ItemScanRequestV1) -> Self {
        Self::ItemScan {
            cancellation_id: request.cancellation_id.clone(),
            cursor: request.cursor.0.clone(),
            limit: request.limit,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ItemScanResponseV1 {
    next_cursor: Option<String>,
    query_id: &'static str,
    rows: Vec<FeedItemRow>,
    schema_version: u8,
    source: ItemDetailSourceV1,
}

struct DecodedItemScanCursor {
    generation_id: String,
    transition_sequence: i64,
    projection_revision: i64,
    after_global_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FeedPageResponseV1 {
    next_cursor: Option<String>,
    query_id: &'static str,
    rows: Vec<FeedCardRow>,
    schema_version: u8,
    source: FeedPageSourceV1,
    total_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FeedReaderCancellationV1 {
    released: bool,
}

struct ReaderSession {
    reader_key: String,
    created_at: Instant,
    last_request: Option<RequestIdentity>,
}

struct CachedReader {
    reader: ProjectionReadSession,
}

#[derive(Default)]
struct FeedReaderRuntimeInner {
    quiesced: bool,
    readers: HashMap<String, CachedReader>,
    sessions: HashMap<String, ReaderSession>,
}

#[derive(Default)]
pub(super) struct LibraryCoreFeedReaderRuntimeState(Mutex<FeedReaderRuntimeInner>);

struct DecodedCursor {
    generation_id: String,
    transition_sequence: i64,
    page_cursor: PageCursor,
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

fn validate_request(request: &FeedPageRequestV1) -> Result<(), FeedReaderError> {
    if request.query_id != QUERY_ID || request.schema_version != SCHEMA_VERSION {
        return Err(FeedReaderError::InvalidRequest("protocol identity"));
    }
    if !is_operation_instance_id(&request.reader_session_id)
        || !is_operation_instance_id(&request.cancellation_id)
    {
        return Err(FeedReaderError::InvalidRequest("operation identity"));
    }
    if !(1..=MAXIMUM_PAGE_LIMIT).contains(&request.limit) {
        return Err(FeedReaderError::InvalidRequest("page limit"));
    }
    if request
        .cursor
        .0
        .as_ref()
        .is_some_and(|cursor| cursor.len() > MAXIMUM_CURSOR_BYTES)
    {
        return Err(FeedReaderError::InvalidRequest("cursor"));
    }
    Ok(())
}

fn decode_cursor(value: &str) -> Result<DecodedCursor, FeedReaderError> {
    if value.is_empty() || value.len() > MAXIMUM_CURSOR_BYTES || value.len() % 4 == 1 {
        return Err(FeedReaderError::InvalidRequest("cursor"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| FeedReaderError::InvalidRequest("cursor"))?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value
        || bytes.len() < CURSOR_FIXED_BYTES
        || bytes[0] != CURSOR_VERSION
    {
        return Err(FeedReaderError::InvalidRequest("cursor"));
    }
    let global_id_length = u16::from_be_bytes([bytes[57], bytes[58]]) as usize;
    if global_id_length == 0
        || global_id_length > MAXIMUM_ENTITY_ID_BYTES
        || bytes.len() != CURSOR_FIXED_BYTES + global_id_length
    {
        return Err(FeedReaderError::InvalidRequest("cursor entity identity"));
    }
    let transition_sequence = read_safe_integer(&bytes[33..41])?;
    let projection_revision = read_safe_integer(&bytes[41..49])?;
    let sort_at = read_safe_integer(&bytes[49..57])?;
    let global_id = std::str::from_utf8(&bytes[CURSOR_FIXED_BYTES..])
        .map_err(|_| FeedReaderError::InvalidRequest("cursor entity identity"))?
        .to_string();
    let generation_id = lower_hex(&bytes[1..33]);
    Ok(DecodedCursor {
        generation_id,
        transition_sequence,
        page_cursor: PageCursor {
            revision: projection_revision,
            sort_at,
            global_id,
        },
    })
}

fn read_safe_integer(bytes: &[u8]) -> Result<i64, FeedReaderError> {
    let value = u64::from_be_bytes(
        bytes
            .try_into()
            .map_err(|_| FeedReaderError::InvalidRequest("cursor integer"))?,
    );
    if value > MAXIMUM_SAFE_INTEGER {
        return Err(FeedReaderError::InvalidRequest("cursor integer"));
    }
    Ok(value as i64)
}

fn encode_cursor(
    generation_id: &str,
    transition_sequence: i64,
    cursor: &PageCursor,
) -> Result<String, FeedReaderError> {
    if transition_sequence < 0
        || cursor.revision < 0
        || cursor.sort_at < 0
        || transition_sequence as u64 > MAXIMUM_SAFE_INTEGER
        || cursor.revision as u64 > MAXIMUM_SAFE_INTEGER
        || cursor.sort_at as u64 > MAXIMUM_SAFE_INTEGER
    {
        return Err(FeedReaderError::InvalidRequest("cursor integer"));
    }
    let generation_bytes = decode_lower_hex_64(generation_id)?;
    let global_id = cursor.global_id.as_bytes();
    if global_id.is_empty() || global_id.len() > MAXIMUM_ENTITY_ID_BYTES {
        return Err(FeedReaderError::InvalidRequest("cursor entity identity"));
    }
    let mut bytes = Vec::with_capacity(CURSOR_FIXED_BYTES + global_id.len());
    bytes.push(CURSOR_VERSION);
    bytes.extend_from_slice(&generation_bytes);
    bytes.extend_from_slice(&(transition_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.revision as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.sort_at as u64).to_be_bytes());
    bytes.extend_from_slice(&(global_id.len() as u16).to_be_bytes());
    bytes.extend_from_slice(global_id);
    let encoded = URL_SAFE_NO_PAD.encode(bytes);
    if encoded.len() > MAXIMUM_CURSOR_BYTES {
        return Err(FeedReaderError::InvalidRequest("cursor"));
    }
    Ok(encoded)
}

fn decode_lower_hex_64(value: &str) -> Result<[u8; 32], FeedReaderError> {
    if value.len() != 64 {
        return Err(FeedReaderError::InvalidRequest("generation identity"));
    }
    let mut output = [0_u8; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        let offset = index * 2;
        *byte = u8::from_str_radix(&value[offset..offset + 2], 16)
            .map_err(|_| FeedReaderError::InvalidRequest("generation identity"))?;
    }
    if lower_hex(&output) != value {
        return Err(FeedReaderError::InvalidRequest("generation identity"));
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

fn decode_item_scan_cursor(value: &str) -> Result<DecodedItemScanCursor, FeedReaderError> {
    if value.is_empty() || value.len() > MAXIMUM_CURSOR_BYTES || value.len() % 4 == 1 {
        return Err(FeedReaderError::InvalidRequest("item scan cursor"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| FeedReaderError::InvalidRequest("item scan cursor"))?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value
        || bytes.len() < ITEM_SCAN_CURSOR_FIXED_BYTES
        || bytes[0] != ITEM_SCAN_CURSOR_VERSION
    {
        return Err(FeedReaderError::InvalidRequest("item scan cursor"));
    }
    let global_id_length = u16::from_be_bytes([bytes[49], bytes[50]]) as usize;
    if global_id_length == 0
        || global_id_length > MAXIMUM_ENTITY_ID_BYTES
        || bytes.len() != ITEM_SCAN_CURSOR_FIXED_BYTES + global_id_length
    {
        return Err(FeedReaderError::InvalidRequest(
            "item scan cursor entity identity",
        ));
    }
    Ok(DecodedItemScanCursor {
        generation_id: lower_hex(&bytes[1..33]),
        transition_sequence: read_safe_integer(&bytes[33..41])?,
        projection_revision: read_safe_integer(&bytes[41..49])?,
        after_global_id: std::str::from_utf8(&bytes[ITEM_SCAN_CURSOR_FIXED_BYTES..])
            .map_err(|_| FeedReaderError::InvalidRequest("item scan cursor entity identity"))?
            .to_string(),
    })
}

fn encode_item_scan_cursor(
    generation_id: &str,
    transition_sequence: i64,
    projection_revision: i64,
    after_global_id: &str,
) -> Result<String, FeedReaderError> {
    if transition_sequence < 0
        || projection_revision < 0
        || transition_sequence as u64 > MAXIMUM_SAFE_INTEGER
        || projection_revision as u64 > MAXIMUM_SAFE_INTEGER
    {
        return Err(FeedReaderError::InvalidRequest("item scan cursor integer"));
    }
    let generation_bytes = decode_lower_hex_64(generation_id)?;
    let global_id = after_global_id.as_bytes();
    if global_id.is_empty() || global_id.len() > MAXIMUM_ENTITY_ID_BYTES {
        return Err(FeedReaderError::InvalidRequest(
            "item scan cursor entity identity",
        ));
    }
    let mut bytes = Vec::with_capacity(ITEM_SCAN_CURSOR_FIXED_BYTES + global_id.len());
    bytes.push(ITEM_SCAN_CURSOR_VERSION);
    bytes.extend_from_slice(&generation_bytes);
    bytes.extend_from_slice(&(transition_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(projection_revision as u64).to_be_bytes());
    bytes.extend_from_slice(&(global_id.len() as u16).to_be_bytes());
    bytes.extend_from_slice(global_id);
    let encoded = URL_SAFE_NO_PAD.encode(bytes);
    if encoded.len() > MAXIMUM_CURSOR_BYTES {
        return Err(FeedReaderError::InvalidRequest("item scan cursor"));
    }
    Ok(encoded)
}

fn prune_expired(runtime: &mut FeedReaderRuntimeInner, now: Instant) {
    runtime.sessions.retain(|_, session| {
        now.checked_duration_since(session.created_at)
            .is_some_and(|age| age <= MAXIMUM_READER_SESSION_AGE)
    });
}

fn reader_key(generation_id: &str, transition_sequence: i64) -> String {
    format!("{generation_id}:{transition_sequence}")
}

fn evict_unreferenced_readers(runtime: &mut FeedReaderRuntimeInner) {
    if runtime.readers.len() < MAXIMUM_READER_SESSIONS {
        return;
    }
    let referenced = runtime
        .sessions
        .values()
        .map(|session| session.reader_key.as_str())
        .collect::<std::collections::HashSet<_>>();
    runtime
        .readers
        .retain(|key, _| referenced.contains(key.as_str()));
}

fn map_reader_open_error(error: ProjectionCoordinatorError) -> FeedReaderError {
    match error {
        ProjectionCoordinatorError::Reader(ProjectionGenerationReaderError::Registry(
            ProjectionGenerationRegistryError::NoSelectedGeneration,
        )) => FeedReaderError::RuntimeInactive,
        other => FeedReaderError::Coordinator(other),
    }
}

fn read_at_root(
    runtime: &LibraryCoreFeedReaderRuntimeState,
    base: &Path,
    request: FeedPageRequestV1,
    now: Instant,
) -> Result<FeedPageResponseV1, FeedReaderError> {
    validate_request(&request)?;
    let decoded_cursor = request.cursor.0.as_deref().map(decode_cursor).transpose()?;
    let mut runtime = runtime
        .0
        .lock()
        .map_err(|_| FeedReaderError::StatePoisoned)?;
    if runtime.quiesced {
        return Err(FeedReaderError::RuntimeInactive);
    }
    prune_expired(&mut runtime, now);

    if !runtime.sessions.contains_key(&request.reader_session_id) {
        if decoded_cursor.is_some() {
            return Err(FeedReaderError::CursorStale);
        }
        if runtime.sessions.len() >= MAXIMUM_READER_SESSIONS {
            return Err(FeedReaderError::SessionLimit);
        }
        let paths = resolve_library_core_shadow_reader_paths(base)
            .map_err(FeedReaderError::RuntimePath)?
            .ok_or(FeedReaderError::RuntimeInactive)?;
        let selected = ProjectionGenerationRegistry::read_selected_generation(&paths.registry_path)
            .map_err(|error| match error {
                ProjectionGenerationRegistryError::NoSelectedGeneration => {
                    FeedReaderError::RuntimeInactive
                }
                other => FeedReaderError::Coordinator(ProjectionCoordinatorError::Registry(other)),
            })?;
        if selected.transition_sequence < 0
            || selected.transition_sequence as u64 > MAXIMUM_SAFE_INTEGER
        {
            return Err(FeedReaderError::InvalidRequest("transition sequence"));
        }
        let key = reader_key(
            &selected.generation.generation_id,
            selected.transition_sequence,
        );
        if !runtime.readers.contains_key(&key) {
            evict_unreferenced_readers(&mut runtime);
            if runtime.readers.len() >= MAXIMUM_READER_SESSIONS {
                return Err(FeedReaderError::SessionLimit);
            }
            let reader = open_selected_projection(&paths.registry_path, &paths.generation_root)
                .map_err(map_reader_open_error)?;
            if reader.generation_id() != selected.generation.generation_id
                || reader.transition_sequence() != selected.transition_sequence
            {
                return Err(FeedReaderError::CursorStale);
            }
            runtime.readers.insert(key.clone(), CachedReader { reader });
        }
        runtime.sessions.insert(
            request.reader_session_id.clone(),
            ReaderSession {
                reader_key: key,
                created_at: now,
                last_request: None,
            },
        );
    }

    let reader_key = runtime
        .sessions
        .get(&request.reader_session_id)
        .ok_or(FeedReaderError::CursorStale)?;
    let reader_key = reader_key.reader_key.clone();
    let reader = &runtime
        .readers
        .get(&reader_key)
        .ok_or(FeedReaderError::CursorStale)?
        .reader;
    let request_identity = RequestIdentity::from(&request);
    if runtime
        .sessions
        .get(&request.reader_session_id)
        .and_then(|session| session.last_request.as_ref())
        .is_some_and(|prior| {
            prior.cancellation_id() == request.cancellation_id && prior != &request_identity
        })
    {
        return Err(FeedReaderError::InvalidRequest("cancellation replay"));
    }
    if let Some(cursor) = decoded_cursor.as_ref() {
        if cursor.generation_id != reader.generation_id()
            || cursor.transition_sequence != reader.transition_sequence()
        {
            return Err(FeedReaderError::CursorStale);
        }
    }

    let page = reader
        .feed_page(
            decoded_cursor.as_ref().map(|cursor| &cursor.page_cursor),
            request.limit,
        )
        .map_err(|error| match error {
            ProjectionCoordinatorError::Reader(ProjectionGenerationReaderError::Store(
                ShadowStoreError::StaleRevision { .. },
            )) => FeedReaderError::CursorStale,
            other => FeedReaderError::Coordinator(other),
        })?;
    let response = response_from_page(reader, page)?;
    ensure_response_size(&response)?;
    let exhausted = response.next_cursor.is_none();
    runtime
        .sessions
        .get_mut(&request.reader_session_id)
        .ok_or(FeedReaderError::CursorStale)?
        .last_request = Some(request_identity);
    if exhausted {
        runtime.sessions.remove(&request.reader_session_id);
    }
    Ok(response)
}

fn response_from_page(
    reader: &ProjectionReadSession,
    page: FeedPage,
) -> Result<FeedPageResponseV1, FeedReaderError> {
    if reader.transition_sequence() < 0
        || page.revision < 0
        || page.total_count < 0
        || page.revision as u64 > MAXIMUM_SAFE_INTEGER
        || reader.transition_sequence() as u64 > MAXIMUM_SAFE_INTEGER
        || page.total_count as u64 > MAXIMUM_SAFE_INTEGER
        || page.total_count < page.rows.len() as i64
    {
        return Err(FeedReaderError::InvalidRequest("response integer"));
    }
    let next_cursor = page
        .next_cursor
        .as_ref()
        .map(|cursor| encode_cursor(reader.generation_id(), reader.transition_sequence(), cursor))
        .transpose()?;
    Ok(FeedPageResponseV1 {
        next_cursor,
        query_id: QUERY_ID,
        rows: page.rows,
        schema_version: SCHEMA_VERSION,
        source: FeedPageSourceV1 {
            generation_id: reader.generation_id().to_string(),
            projection_revision: page.revision,
            transition_sequence: reader.transition_sequence(),
        },
        total_count: page.total_count,
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
            .ok_or_else(|| std::io::Error::other("feed response byte count overflow"))?;
        if self.written > MAXIMUM_RESPONSE_BYTES {
            return Err(std::io::Error::other(
                "feed response exceeds its byte ceiling",
            ));
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn ensure_response_size(response: &FeedPageResponseV1) -> Result<(), FeedReaderError> {
    serde_json::to_writer(&mut BoundedResponseWriter { written: 0 }, response)
        .map_err(|_| FeedReaderError::ResponseTooLarge)
}

fn cancel_session(
    runtime: &LibraryCoreFeedReaderRuntimeState,
    reader_session_id: &str,
    cancellation_id: &str,
) -> Result<FeedReaderCancellationV1, FeedReaderError> {
    if !is_operation_instance_id(reader_session_id) || !is_operation_instance_id(cancellation_id) {
        return Err(FeedReaderError::InvalidRequest("operation identity"));
    }
    let mut runtime = runtime
        .0
        .lock()
        .map_err(|_| FeedReaderError::StatePoisoned)?;
    let released = runtime
        .sessions
        .get(reader_session_id)
        .is_some_and(|session| {
            session
                .last_request
                .as_ref()
                .is_some_and(|request| request.cancellation_id() == cancellation_id)
        });
    if released {
        runtime.sessions.remove(reader_session_id);
    }
    Ok(FeedReaderCancellationV1 { released })
}

pub(super) fn quiesce_library_core_feed_reader_runtime(
    runtime: &LibraryCoreFeedReaderRuntimeState,
) -> Result<(), String> {
    let mut runtime = runtime
        .0
        .lock()
        .map_err(|_| FeedReaderError::StatePoisoned.to_string())?;
    runtime.quiesced = true;
    runtime.sessions.clear();
    runtime.readers.clear();
    Ok(())
}

#[tauri::command]
pub(super) fn read_library_core_feed_page(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreFeedReaderRuntimeState>,
    request: FeedPageRequestV1,
) -> Result<FeedPageResponseV1, FeedReaderErrorResponse> {
    let base = app.path().app_data_dir().map_err(|error| {
        FeedReaderErrorResponse::from(FeedReaderError::RuntimePath(error.to_string()))
    })?;
    read_at_root(&state, &base, request, Instant::now()).map_err(Into::into)
}

fn read_item_detail_at_root(
    base: &Path,
    request: ItemDetailRequestV1,
) -> Result<ItemDetailResponseV1, FeedReaderError> {
    if request.query_id != ITEM_DETAIL_QUERY_ID
        || request.schema_version != SCHEMA_VERSION
        || request.global_id.is_empty()
        || request.global_id.len() > MAXIMUM_ENTITY_ID_BYTES
    {
        return Err(FeedReaderError::InvalidRequest("item detail"));
    }
    let paths = resolve_library_core_shadow_reader_paths(base)
        .map_err(FeedReaderError::RuntimePath)?
        .ok_or(FeedReaderError::RuntimeInactive)?;
    let reader = open_selected_projection(&paths.registry_path, &paths.generation_root)?;
    let source = reader.source();
    if source.document_id.is_empty()
        || source.document_id.len() > MAXIMUM_DOCUMENT_ID_BYTES
        || source.heads_digest.len() != 64
        || source.head_count < 0
        || source.storage_generation < 0
        || source.storage_save_revision < 0
    {
        return Err(FeedReaderError::InvalidRequest("selected source"));
    }
    let response = ItemDetailResponseV1 {
        item: reader.item_detail(&request.global_id)?,
        query_id: ITEM_DETAIL_QUERY_ID,
        schema_version: SCHEMA_VERSION,
        source: ItemDetailSourceV1 {
            document_id: source.document_id,
            generation_id: reader.generation_id().to_string(),
            head_count: source.head_count,
            heads_digest: source.heads_digest,
            projection_revision: reader.projection_revision(),
            storage_generation: source.storage_generation,
            storage_save_revision: source.storage_save_revision,
            transition_sequence: reader.transition_sequence(),
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| FeedReaderError::ResponseTooLarge)?
        .len()
        > MAXIMUM_ITEM_DETAIL_RESPONSE_BYTES
    {
        return Err(FeedReaderError::ResponseTooLarge);
    }
    Ok(response)
}

#[tauri::command]
pub(super) fn read_library_core_item_detail(
    app: tauri::AppHandle,
    request: ItemDetailRequestV1,
) -> Result<ItemDetailResponseV1, FeedReaderErrorResponse> {
    let base = app.path().app_data_dir().map_err(|error| {
        FeedReaderErrorResponse::from(FeedReaderError::RuntimePath(error.to_string()))
    })?;
    read_item_detail_at_root(&base, request).map_err(Into::into)
}

fn selected_item_source(
    reader: &ProjectionReadSession,
) -> Result<ItemDetailSourceV1, FeedReaderError> {
    let source = reader.source();
    if source.document_id.is_empty()
        || source.document_id.len() > MAXIMUM_DOCUMENT_ID_BYTES
        || source.heads_digest.len() != 64
        || source.head_count < 0
        || source.storage_generation < 0
        || source.storage_save_revision < 0
        || reader.projection_revision() < 0
        || reader.transition_sequence() < 0
    {
        return Err(FeedReaderError::InvalidRequest("selected source"));
    }
    Ok(ItemDetailSourceV1 {
        document_id: source.document_id,
        generation_id: reader.generation_id().to_string(),
        head_count: source.head_count,
        heads_digest: source.heads_digest,
        projection_revision: reader.projection_revision(),
        storage_generation: source.storage_generation,
        storage_save_revision: source.storage_save_revision,
        transition_sequence: reader.transition_sequence(),
    })
}

fn read_facet_summary_at_root(
    base: &Path,
    request: FacetSummaryRequestV1,
) -> Result<FacetSummaryResponseV1, FeedReaderError> {
    if request.query_id != FACET_SUMMARY_QUERY_ID || request.schema_version != SCHEMA_VERSION {
        return Err(FeedReaderError::InvalidRequest("facet summary"));
    }
    let paths = resolve_library_core_shadow_reader_paths(base)
        .map_err(FeedReaderError::RuntimePath)?
        .ok_or(FeedReaderError::RuntimeInactive)?;
    let reader = open_selected_projection(&paths.registry_path, &paths.generation_root)?;
    let response = FacetSummaryResponseV1 {
        query_id: FACET_SUMMARY_QUERY_ID,
        schema_version: SCHEMA_VERSION,
        source: selected_item_source(&reader)?,
        summary: reader.facet_summary()?,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| FeedReaderError::ResponseTooLarge)?
        .len()
        > MAXIMUM_ITEM_DETAIL_RESPONSE_BYTES
    {
        return Err(FeedReaderError::ResponseTooLarge);
    }
    Ok(response)
}

#[tauri::command]
pub(super) fn read_library_core_facet_summary(
    app: tauri::AppHandle,
    request: FacetSummaryRequestV1,
) -> Result<FacetSummaryResponseV1, FeedReaderErrorResponse> {
    let base = app.path().app_data_dir().map_err(|error| {
        FeedReaderErrorResponse::from(FeedReaderError::RuntimePath(error.to_string()))
    })?;
    read_facet_summary_at_root(&base, request).map_err(Into::into)
}

fn read_surface_items_at_root(
    base: &Path,
    request: SurfaceItemsRequestV1,
) -> Result<SurfaceItemsResponseV1, FeedReaderError> {
    if request.query_id != SURFACE_ITEMS_QUERY_ID
        || request.schema_version != SCHEMA_VERSION
        || request.limit == 0
        || request.limit > request.surface.maximum()
    {
        return Err(FeedReaderError::InvalidRequest("surface items"));
    }
    let paths = resolve_library_core_shadow_reader_paths(base)
        .map_err(FeedReaderError::RuntimePath)?
        .ok_or(FeedReaderError::RuntimeInactive)?;
    let reader = open_selected_projection(&paths.registry_path, &paths.generation_root)?;
    let response = SurfaceItemsResponseV1 {
        query_id: SURFACE_ITEMS_QUERY_ID,
        rows: reader.surface_items(request.surface.store_surface(), request.limit)?,
        schema_version: SCHEMA_VERSION,
        source: selected_item_source(&reader)?,
        surface: request.surface,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| FeedReaderError::ResponseTooLarge)?
        .len()
        > MAXIMUM_ITEM_DETAIL_RESPONSE_BYTES
    {
        return Err(FeedReaderError::ResponseTooLarge);
    }
    Ok(response)
}

#[tauri::command]
pub(super) fn read_library_core_surface_items(
    app: tauri::AppHandle,
    request: SurfaceItemsRequestV1,
) -> Result<SurfaceItemsResponseV1, FeedReaderErrorResponse> {
    let base = app.path().app_data_dir().map_err(|error| {
        FeedReaderErrorResponse::from(FeedReaderError::RuntimePath(error.to_string()))
    })?;
    read_surface_items_at_root(&base, request).map_err(Into::into)
}

fn read_item_scan_at_root(
    runtime: &LibraryCoreFeedReaderRuntimeState,
    base: &Path,
    request: ItemScanRequestV1,
    now: Instant,
) -> Result<ItemScanResponseV1, FeedReaderError> {
    if request.query_id != ITEM_SCAN_QUERY_ID
        || request.schema_version != SCHEMA_VERSION
        || !(1..=MAXIMUM_ITEM_SCAN_PAGE_LIMIT).contains(&request.limit)
        || !is_operation_instance_id(&request.reader_session_id)
        || !is_operation_instance_id(&request.cancellation_id)
        || request
            .cursor
            .0
            .as_ref()
            .is_some_and(|cursor| cursor.len() > MAXIMUM_CURSOR_BYTES)
    {
        return Err(FeedReaderError::InvalidRequest("item scan"));
    }
    let decoded_cursor = request
        .cursor
        .0
        .as_deref()
        .map(decode_item_scan_cursor)
        .transpose()?;
    let mut runtime = runtime
        .0
        .lock()
        .map_err(|_| FeedReaderError::StatePoisoned)?;
    if runtime.quiesced {
        return Err(FeedReaderError::RuntimeInactive);
    }
    prune_expired(&mut runtime, now);
    if !runtime.sessions.contains_key(&request.reader_session_id) {
        if decoded_cursor.is_some() {
            return Err(FeedReaderError::CursorStale);
        }
        if runtime.sessions.len() >= MAXIMUM_READER_SESSIONS {
            return Err(FeedReaderError::SessionLimit);
        }
        let paths = resolve_library_core_shadow_reader_paths(base)
            .map_err(FeedReaderError::RuntimePath)?
            .ok_or(FeedReaderError::RuntimeInactive)?;
        let selected = ProjectionGenerationRegistry::read_selected_generation(&paths.registry_path)
            .map_err(|error| match error {
                ProjectionGenerationRegistryError::NoSelectedGeneration => {
                    FeedReaderError::RuntimeInactive
                }
                other => FeedReaderError::Coordinator(ProjectionCoordinatorError::Registry(other)),
            })?;
        if selected.transition_sequence < 0
            || selected.transition_sequence as u64 > MAXIMUM_SAFE_INTEGER
        {
            return Err(FeedReaderError::InvalidRequest("transition sequence"));
        }
        let key = reader_key(
            &selected.generation.generation_id,
            selected.transition_sequence,
        );
        if !runtime.readers.contains_key(&key) {
            evict_unreferenced_readers(&mut runtime);
            if runtime.readers.len() >= MAXIMUM_READER_SESSIONS {
                return Err(FeedReaderError::SessionLimit);
            }
            let reader = open_selected_projection(&paths.registry_path, &paths.generation_root)
                .map_err(map_reader_open_error)?;
            if reader.generation_id() != selected.generation.generation_id
                || reader.transition_sequence() != selected.transition_sequence
            {
                return Err(FeedReaderError::CursorStale);
            }
            runtime.readers.insert(key.clone(), CachedReader { reader });
        }
        runtime.sessions.insert(
            request.reader_session_id.clone(),
            ReaderSession {
                reader_key: key,
                created_at: now,
                last_request: None,
            },
        );
    }
    let reader_key = runtime
        .sessions
        .get(&request.reader_session_id)
        .ok_or(FeedReaderError::CursorStale)?
        .reader_key
        .clone();
    let reader = &runtime
        .readers
        .get(&reader_key)
        .ok_or(FeedReaderError::CursorStale)?
        .reader;
    let request_identity = RequestIdentity::from(&request);
    if runtime
        .sessions
        .get(&request.reader_session_id)
        .and_then(|session| session.last_request.as_ref())
        .is_some_and(|prior| {
            prior.cancellation_id() == request.cancellation_id && prior != &request_identity
        })
    {
        return Err(FeedReaderError::InvalidRequest("cancellation replay"));
    }
    if decoded_cursor.as_ref().is_some_and(|cursor| {
        cursor.generation_id != reader.generation_id()
            || cursor.transition_sequence != reader.transition_sequence()
            || cursor.projection_revision != reader.projection_revision()
    }) {
        return Err(FeedReaderError::CursorStale);
    }
    let source = reader.source();
    if source.document_id.is_empty()
        || source.document_id.len() > MAXIMUM_DOCUMENT_ID_BYTES
        || source.heads_digest.len() != 64
        || source.head_count < 0
        || source.storage_generation < 0
        || source.storage_save_revision < 0
        || reader.projection_revision() < 0
        || reader.transition_sequence() < 0
    {
        return Err(FeedReaderError::InvalidRequest("selected source"));
    }
    let ItemScanPage {
        rows,
        next_after_global_id,
    } = reader.item_scan_page(
        decoded_cursor
            .as_ref()
            .map(|cursor| cursor.after_global_id.as_str()),
        request.limit,
    )?;
    let next_cursor = next_after_global_id
        .as_deref()
        .map(|global_id| {
            encode_item_scan_cursor(
                reader.generation_id(),
                reader.transition_sequence(),
                reader.projection_revision(),
                global_id,
            )
        })
        .transpose()?;
    let response = ItemScanResponseV1 {
        next_cursor,
        query_id: ITEM_SCAN_QUERY_ID,
        rows,
        schema_version: SCHEMA_VERSION,
        source: ItemDetailSourceV1 {
            document_id: source.document_id,
            generation_id: reader.generation_id().to_string(),
            head_count: source.head_count,
            heads_digest: source.heads_digest,
            projection_revision: reader.projection_revision(),
            storage_generation: source.storage_generation,
            storage_save_revision: source.storage_save_revision,
            transition_sequence: reader.transition_sequence(),
        },
    };
    if serde_json::to_vec(&response)
        .map_err(|_| FeedReaderError::ResponseTooLarge)?
        .len()
        > MAXIMUM_ITEM_DETAIL_RESPONSE_BYTES
    {
        return Err(FeedReaderError::ResponseTooLarge);
    }
    let exhausted = response.next_cursor.is_none();
    runtime
        .sessions
        .get_mut(&request.reader_session_id)
        .ok_or(FeedReaderError::CursorStale)?
        .last_request = Some(request_identity);
    if exhausted {
        runtime.sessions.remove(&request.reader_session_id);
    }
    Ok(response)
}

#[tauri::command]
pub(super) fn read_library_core_item_scan_page(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreFeedReaderRuntimeState>,
    request: ItemScanRequestV1,
) -> Result<ItemScanResponseV1, FeedReaderErrorResponse> {
    let base = app.path().app_data_dir().map_err(|error| {
        FeedReaderErrorResponse::from(FeedReaderError::RuntimePath(error.to_string()))
    })?;
    read_item_scan_at_root(&state, &base, request, Instant::now()).map_err(Into::into)
}

#[tauri::command]
pub(super) fn cancel_library_core_feed_reader(
    state: tauri::State<'_, LibraryCoreFeedReaderRuntimeState>,
    reader_session_id: String,
    cancellation_id: String,
) -> Result<FeedReaderCancellationV1, FeedReaderErrorResponse> {
    cancel_session(&state, &reader_session_id, &cancellation_id).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection_coordinator::{
        apply_projection_batch, begin_or_resume_projection, finalize_and_open_projection,
    };
    use crate::shadow_store::{FeedItemRow, ProjectionSourceV1};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        base: PathBuf,
        generation_root: PathBuf,
        staging_path: PathBuf,
        destination_path: PathBuf,
        registry_path: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let base = std::fs::canonicalize(std::env::temp_dir())
                .expect("temp root")
                .join(format!(
                    "freed-library-core-feed-reader-{label}-{}-{nonce}",
                    std::process::id()
                ));
            std::fs::create_dir(&base).expect("fixture root");
            let root = base.join("library-core-shadow-v1");
            let generation_root = root.join("generations");
            std::fs::create_dir_all(&generation_root).expect("generation root");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                    .expect("private root");
                std::fs::set_permissions(&generation_root, std::fs::Permissions::from_mode(0o700))
                    .expect("private generation root");
            }
            Self {
                staging_path: generation_root.join("staging.sqlite"),
                destination_path: generation_root.join("generation.sqlite"),
                registry_path: root.join("registry.sqlite"),
                generation_root,
                base,
            }
        }

        fn publish(&self, rows: &[FeedItemRow]) {
            let source = source();
            begin_or_resume_projection(&self.staging_path, "reader-rebuild-1", &source, rows.len())
                .expect("begin");
            for (batch_index, batch) in rows.chunks(1_000).enumerate() {
                apply_projection_batch(
                    &self.staging_path,
                    "reader-rebuild-1",
                    &source,
                    rows.len(),
                    batch_index as i64,
                    &format!("reader-batch-{batch_index}"),
                    &format!("{:064x}", batch_index + 2),
                    batch_index * 1_000 + batch.len(),
                    (batch_index + 1) * 1_000 >= rows.len(),
                    batch,
                )
                .expect("apply");
            }
            finalize_and_open_projection(
                &self.staging_path,
                &self.destination_path,
                &self.registry_path,
                &self.generation_root,
                "reader-rebuild-1",
                &source,
                rows.len(),
                "reader-select-1",
                None,
            )
            .expect("finalize");
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    fn source() -> ProjectionSourceV1 {
        ProjectionSourceV1 {
            document_id: "freed-library".to_string(),
            heads_digest: "1".repeat(64),
            head_count: 2,
            storage_generation: 3,
            storage_save_revision: 4,
        }
    }

    fn row(index: usize) -> FeedItemRow {
        FeedItemRow {
            global_id: format!("x:item-{index}"),
            platform: Some("x".to_string()),
            content_type: Some("post".to_string()),
            published_at: Some(1_780_000_000_000 - index as i64),
            captured_at: Some(1_780_000_000_000),
            author_id: None,
            author_display_name: None,
            author_handle: None,
            source_url: None,
            hidden: Some(0),
            saved: Some(0),
            archived: Some(0),
            read_at: None,
            archived_at: None,
            liked_at: None,
            tags: Some("[]".to_string()),
            content_blob: Some("{\"text\":\"body\"}".to_string()),
            preserved_blob: None,
            rest: "{}".to_string(),
        }
    }

    fn request(
        reader_session_id: &str,
        cancellation_id: &str,
        cursor: Option<String>,
        limit: u32,
    ) -> FeedPageRequestV1 {
        FeedPageRequestV1 {
            cancellation_id: cancellation_id.to_string(),
            cursor: RequiredNullableCursor(cursor),
            limit,
            query_id: QUERY_ID.to_string(),
            reader_session_id: reader_session_id.to_string(),
            schema_version: SCHEMA_VERSION,
        }
    }

    fn item_request(global_id: &str) -> ItemDetailRequestV1 {
        ItemDetailRequestV1 {
            global_id: global_id.to_string(),
            query_id: ITEM_DETAIL_QUERY_ID.to_string(),
            schema_version: SCHEMA_VERSION,
        }
    }

    fn item_scan_request(cursor: Option<String>, limit: u32) -> ItemScanRequestV1 {
        let page = usize::from(cursor.is_some());
        ItemScanRequestV1 {
            cancellation_id: format!("item-scan-page-{page}"),
            cursor: RequiredNullableCursor(cursor),
            limit,
            query_id: ITEM_SCAN_QUERY_ID.to_string(),
            reader_session_id: "item-scan-reader-1".to_string(),
            schema_version: SCHEMA_VERSION,
        }
    }

    fn facet_request() -> FacetSummaryRequestV1 {
        FacetSummaryRequestV1 {
            query_id: FACET_SUMMARY_QUERY_ID.to_string(),
            schema_version: SCHEMA_VERSION,
        }
    }

    fn surface_request(surface: SurfaceKindV1, limit: u32) -> SurfaceItemsRequestV1 {
        SurfaceItemsRequestV1 {
            limit,
            query_id: SURFACE_ITEMS_QUERY_ID.to_string(),
            schema_version: SCHEMA_VERSION,
            surface,
        }
    }

    #[test]
    fn cursor_codec_matches_the_shared_cross_runtime_vector() {
        let cursor = PageCursor {
            revision: 34,
            sort_at: 1_780_000_000_000,
            global_id: "x:item-1".to_string(),
        };
        let generation_id = "a".repeat(64);
        let encoded = encode_cursor(&generation_id, 12, &cursor).expect("encode");
        assert_eq!(
            encoded,
            "AaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAAAAAwAAAAAAAAAIgAAAZ5wRIgAAAh4Oml0ZW0tMQ"
        );
        let decoded = decode_cursor(&encoded).expect("decode");
        assert_eq!(decoded.generation_id, generation_id);
        assert_eq!(decoded.transition_sequence, 12);
        assert_eq!(decoded.page_cursor, cursor);
        assert!(!encoded.contains('='));
    }

    #[test]
    fn cursor_codec_rejects_noncanonical_and_unsafe_values() {
        let cursor = PageCursor {
            revision: 9,
            sort_at: 10,
            global_id: "x:item-1".to_string(),
        };
        let encoded = encode_cursor(&"01".repeat(32), 7, &cursor).expect("encode");
        assert!(decode_cursor(&format!("{encoded}=")).is_err());

        let mut bytes = URL_SAFE_NO_PAD.decode(encoded).expect("decode bytes");
        bytes[49..57].copy_from_slice(&(MAXIMUM_SAFE_INTEGER + 1).to_be_bytes());
        assert!(decode_cursor(&URL_SAFE_NO_PAD.encode(bytes)).is_err());
    }

    #[test]
    fn item_scan_cursor_is_generation_bound_and_canonical() {
        let generation_id = "a".repeat(64);
        let encoded = encode_item_scan_cursor(&generation_id, 12, 34, "x:item-1")
            .expect("encode item scan cursor");
        let decoded = decode_item_scan_cursor(&encoded).expect("decode item scan cursor");
        assert_eq!(decoded.generation_id, generation_id);
        assert_eq!(decoded.transition_sequence, 12);
        assert_eq!(decoded.projection_revision, 34);
        assert_eq!(decoded.after_global_id, "x:item-1");
        assert!(!encoded.contains('='));
        assert!(decode_item_scan_cursor(&format!("{encoded}=")).is_err());
    }

    #[test]
    fn operation_ids_match_the_shared_closed_syntax() {
        assert!(is_operation_instance_id("reader-session:1"));
        assert!(is_operation_instance_id(&format!("a{}", "b".repeat(127))));
        for invalid in ["", "-leading", "has space", "slash/value"] {
            assert!(!is_operation_instance_id(invalid), "{invalid}");
        }
    }

    #[test]
    fn request_deserialization_requires_the_complete_closed_shape() {
        let valid = serde_json::json!({
            "cancellationId": "cancel-1",
            "cursor": null,
            "limit": 64,
            "queryId": QUERY_ID,
            "readerSessionId": "reader-1",
            "schemaVersion": SCHEMA_VERSION,
        });
        assert!(serde_json::from_value::<FeedPageRequestV1>(valid.clone()).is_ok());
        let mut missing_cursor = valid.clone();
        missing_cursor
            .as_object_mut()
            .expect("request object")
            .remove("cursor");
        assert!(serde_json::from_value::<FeedPageRequestV1>(missing_cursor).is_err());
        let mut unknown = valid;
        unknown
            .as_object_mut()
            .expect("request object")
            .insert("extra".to_string(), serde_json::Value::Bool(true));
        assert!(serde_json::from_value::<FeedPageRequestV1>(unknown).is_err());
    }

    #[test]
    fn reads_one_lossless_item_from_the_authenticated_selected_generation() {
        let fixture = Fixture::new("item-detail");
        let mut selected = row(1);
        selected.preserved_blob =
            Some("{\"text\":\"complete body\",\"readingTime\":7}".to_string());
        selected.rest = "{\"engagement\":{\"likes\":9}}".to_string();
        fixture.publish(&[row(0), selected.clone()]);

        let response = read_item_detail_at_root(&fixture.base, item_request(&selected.global_id))
            .expect("item detail");
        assert_eq!(response.query_id, ITEM_DETAIL_QUERY_ID);
        assert_eq!(response.source.document_id, source().document_id);
        assert_eq!(response.source.heads_digest, source().heads_digest);
        assert_eq!(response.item, Some(selected));

        let missing = read_item_detail_at_root(&fixture.base, item_request("x:missing"))
            .expect("missing item");
        assert_eq!(missing.item, None);
    }

    #[test]
    fn item_detail_rejects_unbounded_or_unknown_requests() {
        let fixture = Fixture::new("item-invalid");
        fixture.publish(&[row(0)]);
        let oversized = "x".repeat(MAXIMUM_ENTITY_ID_BYTES + 1);
        assert!(matches!(
            read_item_detail_at_root(&fixture.base, item_request(&oversized)),
            Err(FeedReaderError::InvalidRequest("item detail"))
        ));

        let valid = serde_json::json!({
            "globalId": "x:item-0",
            "queryId": ITEM_DETAIL_QUERY_ID,
            "schemaVersion": SCHEMA_VERSION,
        });
        assert!(serde_json::from_value::<ItemDetailRequestV1>(valid.clone()).is_ok());
        let mut unknown = valid;
        unknown
            .as_object_mut()
            .expect("request object")
            .insert("extra".to_string(), serde_json::Value::Bool(true));
        assert!(serde_json::from_value::<ItemDetailRequestV1>(unknown).is_err());
    }

    #[test]
    fn reads_exact_facets_and_only_bounded_surface_candidates() {
        let fixture = Fixture::new("surface-queries");
        let mut map = row(0);
        map.saved = Some(1);
        map.tags = Some("[\"places\",\"travel\"]".to_string());
        map.rest = "{\"location\":{\"name\":\"London\"}}".to_string();
        let mut archived = row(1);
        archived.archived = Some(1);
        archived.tags = Some("[\"travel\"]".to_string());
        archived.rest = "{\"location\":{\"name\":\"Paris\"}}".to_string();
        fixture.publish(&[map.clone(), archived.clone(), row(2)]);

        let facets =
            read_facet_summary_at_root(&fixture.base, facet_request()).expect("facet summary");
        assert_eq!(facets.summary.total_count, 3);
        assert_eq!(facets.summary.saved_count, 1);
        assert_eq!(facets.summary.archived_count, 1);
        assert_eq!(facets.summary.tags, vec!["places", "travel"]);

        let map_response = read_surface_items_at_root(
            &fixture.base,
            surface_request(SurfaceKindV1::Map, MAXIMUM_MAP_ITEMS),
        )
        .expect("map candidates");
        assert_eq!(map_response.rows, vec![map, archived]);

        assert!(matches!(
            read_surface_items_at_root(&fixture.base, surface_request(SurfaceKindV1::Map, 1),),
            Err(FeedReaderError::Coordinator(
                ProjectionCoordinatorError::Reader(ProjectionGenerationReaderError::Store(
                    ShadowStoreError::SurfaceItemsExceedLimit {
                        requested: 2,
                        maximum: 1,
                    },
                ),),
            ))
        ));

        assert!(matches!(
            read_surface_items_at_root(
                &fixture.base,
                surface_request(SurfaceKindV1::Map, MAXIMUM_MAP_ITEMS + 1),
            ),
            Err(FeedReaderError::InvalidRequest("surface items"))
        ));

        let overflow_fixture = Fixture::new("surface-overflow");
        let overflow_rows = (0..=MAXIMUM_MAP_ITEMS as usize)
            .map(|index| {
                let mut candidate = row(index);
                candidate.rest = "{\"location\":{\"name\":\"London\"}}".to_string();
                candidate
            })
            .collect::<Vec<_>>();
        overflow_fixture.publish(&overflow_rows);
        assert!(matches!(
            read_surface_items_at_root(
                &overflow_fixture.base,
                surface_request(SurfaceKindV1::Map, MAXIMUM_MAP_ITEMS),
            ),
            Err(FeedReaderError::Coordinator(
                ProjectionCoordinatorError::Reader(ProjectionGenerationReaderError::Store(
                    ShadowStoreError::SurfaceItemsExceedLimit {
                        requested: 1_001,
                        maximum: 1_000,
                    },
                ),),
            ))
        ));
    }

    #[test]
    fn scans_lossless_rows_in_bounded_generation_pinned_pages() {
        let fixture = Fixture::new("item-scan");
        fixture.publish(&[row(2), row(0), row(1)]);
        let runtime = LibraryCoreFeedReaderRuntimeState::default();
        let now = Instant::now();

        let first =
            read_item_scan_at_root(&runtime, &fixture.base, item_scan_request(None, 2), now)
                .expect("first item scan page");
        assert_eq!(first.rows.len(), 2);
        assert_eq!(first.rows[0].global_id, "x:item-0");
        assert_eq!(first.rows[1].global_id, "x:item-1");
        assert_eq!(first.source.document_id, source().document_id);
        let second = read_item_scan_at_root(
            &runtime,
            &fixture.base,
            item_scan_request(first.next_cursor, 2),
            now + Duration::from_millis(1),
        )
        .expect("second item scan page");
        assert_eq!(second.rows.len(), 1);
        assert_eq!(second.rows[0].global_id, "x:item-2");
        assert!(second.next_cursor.is_none());

        assert!(matches!(
            read_item_scan_at_root(
                &LibraryCoreFeedReaderRuntimeState::default(),
                &fixture.base,
                item_scan_request(None, 0),
                now,
            ),
            Err(FeedReaderError::InvalidRequest("item scan"))
        ));
    }

    #[test]
    fn pages_one_pinned_generation_and_expires_without_reopening_a_cursor() {
        let fixture = Fixture::new("page-expiry");
        fixture.publish(&[row(0), row(1), row(2)]);
        let runtime = LibraryCoreFeedReaderRuntimeState::default();
        let now = Instant::now();
        let first = read_at_root(
            &runtime,
            &fixture.base,
            request("reader-1", "page-1", None, 2),
            now,
        )
        .expect("first page");
        assert_eq!(first.total_count, 3);
        assert_eq!(first.rows.len(), 2);
        let next = first.next_cursor.expect("next cursor");

        let expiry_runtime = LibraryCoreFeedReaderRuntimeState::default();
        let expiring = read_at_root(
            &expiry_runtime,
            &fixture.base,
            request("reader-2", "expiry-1", None, 1),
            now,
        )
        .expect("expiring first page");
        let expired = read_at_root(
            &expiry_runtime,
            &fixture.base,
            request("reader-2", "expiry-2", expiring.next_cursor, 1),
            now + MAXIMUM_READER_SESSION_AGE + Duration::from_millis(1),
        )
        .expect_err("expired cursor");
        assert_eq!(expired.code(), "CURSOR_STALE");

        let second_request = request("reader-1", "page-2", Some(next), 2);
        let second = read_at_root(
            &runtime,
            &fixture.base,
            second_request.clone(),
            now + Duration::from_secs(1),
        )
        .expect("second page");
        assert_eq!(second.rows.len(), 1);
        assert!(second.next_cursor.is_none());

        let exhausted = read_at_root(
            &runtime,
            &fixture.base,
            second_request.clone(),
            now + Duration::from_secs(2),
        )
        .expect_err("exhausted cursor");
        assert_eq!(exhausted.code(), "CURSOR_STALE");
    }

    #[test]
    fn cancellation_releases_only_the_exact_reader_operation() {
        let fixture = Fixture::new("cancel");
        fixture.publish(&[row(0), row(1)]);
        let runtime = LibraryCoreFeedReaderRuntimeState::default();
        let now = Instant::now();
        let first = read_at_root(
            &runtime,
            &fixture.base,
            request("reader-1", "page-1", None, 1),
            now,
        )
        .expect("first page");
        let next = first.next_cursor.expect("next cursor");

        assert!(
            !cancel_session(&runtime, "reader-1", "wrong-operation")
                .expect("wrong cancel")
                .released
        );
        assert!(
            cancel_session(&runtime, "reader-1", "page-1")
                .expect("exact cancel")
                .released
        );
        let stale = read_at_root(
            &runtime,
            &fixture.base,
            request("reader-1", "page-2", Some(next), 1),
            now + Duration::from_secs(1),
        )
        .expect_err("released session");
        assert_eq!(stale.code(), "CURSOR_STALE");
    }

    #[test]
    fn reuses_one_bounded_cached_reader_and_caps_logical_sessions() {
        let fixture = Fixture::new("reader-reuse");
        fixture.publish(&[row(0), row(1), row(2)]);
        let runtime = LibraryCoreFeedReaderRuntimeState::default();
        let now = Instant::now();

        read_at_root(
            &runtime,
            &fixture.base,
            request("reader-1", "page-1", None, 1),
            now,
        )
        .expect("first logical reader");
        read_at_root(
            &runtime,
            &fixture.base,
            request("reader-2", "page-2", None, 1),
            now,
        )
        .expect("second logical reader");

        let at_capacity = read_at_root(
            &runtime,
            &fixture.base,
            request("reader-3", "page-3", None, 1),
            now,
        )
        .expect_err("third logical reader");
        assert_eq!(at_capacity.code(), "SESSION_LIMIT");

        let guard = runtime.0.lock().expect("runtime state");
        assert_eq!(guard.sessions.len(), MAXIMUM_READER_SESSIONS);
        assert_eq!(guard.readers.len(), 1);
    }

    #[test]
    fn factory_reset_quiescence_drops_cached_readers_and_blocks_reopen() {
        let fixture = Fixture::new("quiesce");
        fixture.publish(&[row(0), row(1)]);
        let runtime = LibraryCoreFeedReaderRuntimeState::default();
        read_at_root(
            &runtime,
            &fixture.base,
            request("reader-1", "page-1", None, 1),
            Instant::now(),
        )
        .expect("first page");
        quiesce_library_core_feed_reader_runtime(&runtime).expect("quiesce");
        let guard = runtime.0.lock().expect("runtime state");
        assert!(guard.quiesced);
        assert!(guard.sessions.is_empty());
        assert!(guard.readers.is_empty());
        drop(guard);
        let inactive = read_at_root(
            &runtime,
            &fixture.base,
            request("reader-2", "page-2", None, 1),
            Instant::now(),
        )
        .expect_err("quiesced runtime");
        assert_eq!(inactive.code(), "RUNTIME_INACTIVE");
    }
}
