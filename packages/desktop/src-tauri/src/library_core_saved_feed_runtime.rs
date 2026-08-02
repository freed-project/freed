//! Saved-only adapter over the proven query-specific feed browse store.
//!
//! Automerge remains authoritative. The adapter stages only compact Saved
//! cards in its own physical root, then serves source-fenced keyset pages from
//! one selected immutable SQLite generation.

use crate::library_core_feed_browse_reader_runtime::{
    cancel_library_core_feed_browse_reader_in_state,
    quiesce_library_core_feed_browse_reader_runtime,
    read_library_core_feed_browse_physical_page_in_root, FeedBrowsePhysicalReadRequest,
    LibraryCoreFeedBrowseReaderRuntimeState,
};
use crate::library_core_feed_browse_runtime::{
    append_at_root, begin_at_named_root, cancel_at_root,
    clear_library_core_feed_browse_runtime_in_root, finalize_at_root,
    select_generation_at_named_root, selected_generation_at_named_root,
    BrowseGenerationBatchInputV1, BrowseGenerationStatusV1, LibraryCoreFeedBrowseRuntimeState,
    SelectBrowseGenerationInputV1, SelectedBrowseGenerationV1,
};
use crate::library_core_feed_browse_store::{
    FeedBrowseCursor, FeedBrowsePage, FeedBrowseReadDirection,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::io::Write;
use std::path::Path;
use tauri::Manager;

const ROOT_DIRECTORY: &str = "library-core-saved-feed-v1";
const QUERY_ID: &str = "saved_feed_page_v1";
const SCHEMA_VERSION: u8 = 1;
const RECOMMENDATION_ORDER_SCHEMA_VERSION: i64 = 1;
const SORT_ORDER_SCHEMA_VERSION: i64 = 1;
const MAXIMUM_PAGE_LIMIT: u32 = 128;
const MAXIMUM_RESPONSE_BYTES: usize = 2 * 1_048_576;
const MAXIMUM_CURSOR_BYTES: usize = 5_564;
const MAXIMUM_FILTER_BYTES: usize = 64 * 1_024;
const MAXIMUM_ENTITY_ID_BYTES: usize = 4_096;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const CURSOR_VERSION: u8 = 1;
const CURSOR_FIXED_BYTES: usize = 69;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SavedSortMode {
    DateSaved,
    DatePublished,
    Recommended,
    ShortestRead,
}

impl SavedSortMode {
    fn code(self) -> u8 {
        match self {
            Self::DateSaved => 0,
            Self::DatePublished => 1,
            Self::Recommended => 2,
            Self::ShortestRead => 3,
        }
    }

    fn from_code(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::DateSaved),
            1 => Some(Self::DatePublished),
            2 => Some(Self::Recommended),
            3 => Some(Self::ShortestRead),
            _ => None,
        }
    }
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

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SavedPageRequestV1 {
    cancellation_id: String,
    cursor: RequiredNullableCursor,
    filter: Value,
    limit: u32,
    query_id: String,
    ranking_clock_ms: i64,
    reader_session_id: String,
    schema_version: u8,
    sort_mode: SavedSortMode,
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
pub(super) struct SavedPageResponseV1 {
    filter: Value,
    next_cursor: Option<String>,
    query_id: &'static str,
    ranking_clock_ms: i64,
    rows: Vec<Value>,
    schema_version: u8,
    sort_mode: SavedSortMode,
    source: FeedPageSourceV1,
    total_count: i64,
}

#[derive(Default)]
pub(super) struct LibraryCoreSavedFeedRuntimeState {
    writer: LibraryCoreFeedBrowseRuntimeState,
    reader: LibraryCoreFeedBrowseReaderRuntimeState,
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

fn validate_request(request: &SavedPageRequestV1) -> Result<Value, String> {
    if request.query_id != QUERY_ID
        || request.schema_version != SCHEMA_VERSION
        || !is_operation_instance_id(&request.reader_session_id)
        || !is_operation_instance_id(&request.cancellation_id)
        || !(1..=MAXIMUM_PAGE_LIMIT).contains(&request.limit)
        || request.ranking_clock_ms < 0
        || request.ranking_clock_ms as u64 > MAXIMUM_SAFE_INTEGER
        || request
            .cursor
            .0
            .as_ref()
            .is_some_and(|cursor| cursor.len() > MAXIMUM_CURSOR_BYTES)
    {
        return Err("invalid saved feed page request".to_owned());
    }
    let filter_json = serde_json::to_string(&request.filter)
        .map_err(|_| "invalid saved feed filter".to_owned())?;
    if filter_json.len() > MAXIMUM_FILTER_BYTES {
        return Err("invalid saved feed filter".to_owned());
    }
    let filter = request
        .filter
        .as_object()
        .ok_or_else(|| "invalid saved feed filter".to_owned())?;
    if filter.get("savedOnly").and_then(Value::as_bool) != Some(true)
        || filter.get("showHidden").and_then(Value::as_bool) != Some(false)
    {
        return Err("saved feed request must select visible saved rows".to_owned());
    }
    Ok(serde_json::json!({
        "filter": request.filter,
        "sortMode": request.sort_mode,
        "sortOrderSchemaVersion": SORT_ORDER_SCHEMA_VERSION,
    }))
}

struct DecodedSavedCursor {
    sort_mode: SavedSortMode,
    physical: FeedBrowseCursor,
}

fn decode_cursor(value: &str) -> Result<DecodedSavedCursor, String> {
    if value.is_empty() || value.len() > MAXIMUM_CURSOR_BYTES || value.len() % 4 == 1 {
        return Err("invalid saved feed cursor".to_owned());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "invalid saved feed cursor".to_owned())?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value
        || bytes.len() < CURSOR_FIXED_BYTES
        || bytes[0] != CURSOR_VERSION
    {
        return Err("invalid saved feed cursor".to_owned());
    }
    let sort_mode = SavedSortMode::from_code(bytes[1])
        .ok_or_else(|| "invalid saved feed cursor sort".to_owned())?;
    let global_id_length = u16::from_be_bytes([bytes[67], bytes[68]]) as usize;
    if global_id_length == 0
        || global_id_length > MAXIMUM_ENTITY_ID_BYTES
        || bytes.len() != CURSOR_FIXED_BYTES + global_id_length
    {
        return Err("invalid saved feed cursor identity".to_owned());
    }
    let transition_sequence = read_safe_integer(&bytes[34..42])?;
    let projection_revision = read_safe_integer(&bytes[42..50])?;
    let sort_group = bytes[50] as i64;
    if sort_group > 100 {
        return Err("invalid saved feed cursor group".to_owned());
    }
    let sort_primary = read_safe_integer(&bytes[51..59])?;
    let sort_secondary = read_safe_integer(&bytes[59..67])?;
    let global_id = std::str::from_utf8(&bytes[CURSOR_FIXED_BYTES..])
        .map_err(|_| "invalid saved feed cursor identity".to_owned())?
        .to_owned();
    Ok(DecodedSavedCursor {
        sort_mode,
        physical: FeedBrowseCursor {
            generation_id: lower_hex(&bytes[2..34]),
            transition_sequence,
            projection_revision,
            priority: sort_group,
            published_at: sort_primary,
            source_sequence: sort_secondary,
            global_id,
        },
    })
}

fn encode_cursor(cursor: &FeedBrowseCursor, sort_mode: SavedSortMode) -> Result<String, String> {
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
        return Err("invalid saved feed cursor integer".to_owned());
    }
    let generation = decode_lower_hex_64(&cursor.generation_id)?;
    let global_id = cursor.global_id.as_bytes();
    if global_id.is_empty() || global_id.len() > MAXIMUM_ENTITY_ID_BYTES {
        return Err("invalid saved feed cursor identity".to_owned());
    }
    let mut bytes = Vec::with_capacity(CURSOR_FIXED_BYTES + global_id.len());
    bytes.push(CURSOR_VERSION);
    bytes.push(sort_mode.code());
    bytes.extend_from_slice(&generation);
    bytes.extend_from_slice(&(cursor.transition_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.projection_revision as u64).to_be_bytes());
    bytes.push(cursor.priority as u8);
    bytes.extend_from_slice(&(cursor.published_at as u64).to_be_bytes());
    bytes.extend_from_slice(&(cursor.source_sequence as u64).to_be_bytes());
    bytes.extend_from_slice(&(global_id.len() as u16).to_be_bytes());
    bytes.extend_from_slice(global_id);
    let encoded = URL_SAFE_NO_PAD.encode(bytes);
    if encoded.len() > MAXIMUM_CURSOR_BYTES {
        return Err("saved feed cursor exceeds its byte ceiling".to_owned());
    }
    Ok(encoded)
}

fn read_safe_integer(bytes: &[u8]) -> Result<i64, String> {
    let value = u64::from_be_bytes(
        bytes
            .try_into()
            .map_err(|_| "invalid saved feed cursor integer".to_owned())?,
    );
    if value > MAXIMUM_SAFE_INTEGER {
        return Err("invalid saved feed cursor integer".to_owned());
    }
    Ok(value as i64)
}

fn decode_lower_hex_64(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 {
        return Err("invalid saved feed generation identity".to_owned());
    }
    let mut output = [0_u8; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        let offset = index * 2;
        *byte = u8::from_str_radix(&value[offset..offset + 2], 16)
            .map_err(|_| "invalid saved feed generation identity".to_owned())?;
    }
    if lower_hex(&output) != value {
        return Err("invalid saved feed generation identity".to_owned());
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

fn response_from_page(
    page: FeedBrowsePage,
    sort_mode: SavedSortMode,
) -> Result<SavedPageResponseV1, String> {
    if page.binding.total_rows < page.rows.len() as i64 {
        return Err("invalid saved feed response count".to_owned());
    }
    let envelope: Value = serde_json::from_str(&page.binding.filter_json)
        .map_err(|_| "invalid stored saved feed filter".to_owned())?;
    let filter = envelope
        .get("filter")
        .cloned()
        .ok_or_else(|| "invalid stored saved feed filter".to_owned())?;
    let stored_sort: SavedSortMode = serde_json::from_value(
        envelope
            .get("sortMode")
            .cloned()
            .ok_or_else(|| "invalid stored saved feed sort".to_owned())?,
    )
    .map_err(|_| "invalid stored saved feed sort".to_owned())?;
    if stored_sort != sort_mode
        || envelope
            .get("sortOrderSchemaVersion")
            .and_then(Value::as_i64)
            != Some(SORT_ORDER_SCHEMA_VERSION)
    {
        return Err("saved feed reader sort is stale".to_owned());
    }
    let mut rows = Vec::with_capacity(page.rows.len());
    for row in &page.rows {
        let value: Value = serde_json::from_str(&row.card_json)
            .map_err(|_| "invalid stored saved feed row".to_owned())?;
        let object = value
            .as_object()
            .ok_or_else(|| "invalid stored saved feed row".to_owned())?;
        if object.get("globalId").and_then(Value::as_str) != Some(row.global_id.as_str())
            || object.get("saved").and_then(Value::as_bool) != Some(true)
        {
            return Err("invalid stored saved feed row identity".to_owned());
        }
        rows.push(value);
    }
    let next_cursor = page
        .next_cursor
        .as_ref()
        .map(|cursor| encode_cursor(cursor, sort_mode))
        .transpose()?;
    Ok(SavedPageResponseV1 {
        filter,
        next_cursor,
        query_id: QUERY_ID,
        ranking_clock_ms: page.binding.ranking_clock_ms,
        rows,
        schema_version: SCHEMA_VERSION,
        sort_mode,
        source: FeedPageSourceV1 {
            generation_id: page.binding.generation_id,
            projection_revision: page.binding.projection_revision,
            transition_sequence: page.binding.transition_sequence,
        },
        total_count: page.binding.total_rows,
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
            .ok_or_else(|| std::io::Error::other("saved feed byte count overflow"))?;
        if self.written > MAXIMUM_RESPONSE_BYTES {
            return Err(std::io::Error::other(
                "saved feed response exceeds its byte ceiling",
            ));
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn read_saved_page_at_root(
    state: &LibraryCoreSavedFeedRuntimeState,
    base: &Path,
    request: SavedPageRequestV1,
) -> Result<SavedPageResponseV1, String> {
    let expected_filter = validate_request(&request)?;
    let decoded = request.cursor.0.as_deref().map(decode_cursor).transpose()?;
    if decoded
        .as_ref()
        .is_some_and(|cursor| cursor.sort_mode != request.sort_mode)
    {
        return Err("saved feed cursor sort is stale".to_owned());
    }
    let page = read_library_core_feed_browse_physical_page_in_root(
        &state.reader,
        base,
        ROOT_DIRECTORY,
        FeedBrowsePhysicalReadRequest {
            reader_session_id: &request.reader_session_id,
            cancellation_id: &request.cancellation_id,
            cursor_identity: request.cursor.0.as_deref(),
            cursor: decoded.as_ref().map(|cursor| &cursor.physical),
            direction: FeedBrowseReadDirection::Next,
            keep_session_on_exhaustion: false,
            limit: request.limit as usize,
            expected_filter: &expected_filter,
            ranking_clock_ms: request.ranking_clock_ms,
            recommendation_order_schema_version: RECOMMENDATION_ORDER_SCHEMA_VERSION,
        },
    )?;
    let response = response_from_page(page, request.sort_mode)?;
    serde_json::to_writer(&mut BoundedResponseWriter { written: 0 }, &response)
        .map_err(|_| "saved feed response exceeds its byte ceiling".to_owned())?;
    Ok(response)
}

pub(super) fn quiesce_library_core_saved_feed_runtime(
    state: &LibraryCoreSavedFeedRuntimeState,
) -> Result<(), String> {
    quiesce_library_core_feed_browse_reader_runtime(&state.reader)
}

pub(super) fn clear_library_core_saved_feed_runtime_in(
    state: &LibraryCoreSavedFeedRuntimeState,
    base: &Path,
) -> Result<(), String> {
    quiesce_library_core_saved_feed_runtime(state)?;
    clear_library_core_feed_browse_runtime_in_root(&state.writer, base, ROOT_DIRECTORY)
}

#[tauri::command]
pub(super) fn begin_library_core_saved_feed_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreSavedFeedRuntimeState>,
    session_id: String,
    binding: crate::library_core_feed_browse_store::FeedBrowseGenerationBinding,
) -> Result<BrowseGenerationStatusV1, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    begin_at_named_root(&state.writer, &base, ROOT_DIRECTORY, session_id, binding)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn append_library_core_saved_feed_generation_page(
    state: tauri::State<'_, LibraryCoreSavedFeedRuntimeState>,
    batch: BrowseGenerationBatchInputV1,
) -> Result<BrowseGenerationStatusV1, String> {
    append_at_root(&state.writer, batch).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn finalize_library_core_saved_feed_generation(
    state: tauri::State<'_, LibraryCoreSavedFeedRuntimeState>,
    session_id: String,
) -> Result<BrowseGenerationStatusV1, String> {
    finalize_at_root(&state.writer, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn cancel_library_core_saved_feed_generation(
    state: tauri::State<'_, LibraryCoreSavedFeedRuntimeState>,
    session_id: String,
) -> Result<BrowseGenerationStatusV1, String> {
    cancel_at_root(&state.writer, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn get_library_core_saved_feed_selection(
    app: tauri::AppHandle,
) -> Result<Option<SelectedBrowseGenerationV1>, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    selected_generation_at_named_root(&base, ROOT_DIRECTORY).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn select_library_core_saved_feed_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreSavedFeedRuntimeState>,
    input: SelectBrowseGenerationInputV1,
) -> Result<SelectedBrowseGenerationV1, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    select_generation_at_named_root(&state.writer, &base, ROOT_DIRECTORY, input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn read_library_core_saved_feed_page(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryCoreSavedFeedRuntimeState>,
    request: SavedPageRequestV1,
) -> Result<SavedPageResponseV1, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    read_saved_page_at_root(&state, &base, request)
}

#[tauri::command]
pub(super) fn cancel_library_core_saved_feed_reader(
    state: tauri::State<'_, LibraryCoreSavedFeedRuntimeState>,
    reader_session_id: String,
    cancellation_id: String,
) -> Result<(), String> {
    cancel_library_core_feed_browse_reader_in_state(
        &state.reader,
        &reader_session_id,
        &cancellation_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_feed_browse_registry::FeedBrowseGenerationRegistry;
    use crate::library_core_feed_browse_runtime::resolve_library_core_feed_browse_paths_in_root;
    use crate::library_core_feed_browse_store::{
        FeedBrowseGenerationBinding, FeedBrowseGenerationStore, FeedBrowseProjectedRow,
    };

    fn filter() -> Value {
        serde_json::json!({
            "archivedOnly": false,
            "authorId": null,
            "feedUrl": null,
            "platform": null,
            "savedOnly": true,
            "schemaVersion": 1,
            "showHidden": false,
            "signals": [],
            "socialContentFilter": "all",
            "tags": [],
        })
    }

    fn card(global_id: &str, saved_at: i64) -> String {
        serde_json::json!({
            "globalId": global_id,
            "saved": true,
            "savedAt": saved_at,
        })
        .to_string()
    }

    fn request(cursor: Option<String>, page: u8) -> SavedPageRequestV1 {
        SavedPageRequestV1 {
            cancellation_id: format!("saved-cancel:{page}"),
            cursor: RequiredNullableCursor(cursor),
            filter: filter(),
            limit: 1,
            query_id: QUERY_ID.to_owned(),
            ranking_clock_ms: 1_780_000_100_000,
            reader_session_id: "saved-reader:1".to_owned(),
            schema_version: SCHEMA_VERSION,
            sort_mode: SavedSortMode::DateSaved,
        }
    }

    #[test]
    fn request_fence_rejects_an_oversized_filter() {
        let mut oversized = request(None, 1);
        oversized.filter["tags"] =
            Value::Array(vec![Value::String("x".repeat(MAXIMUM_FILTER_BYTES))]);
        assert_eq!(
            validate_request(&oversized),
            Err("invalid saved feed filter".to_owned())
        );

        let cursor = FeedBrowseCursor {
            generation_id: "a".repeat(64),
            transition_sequence: 12,
            projection_revision: 34,
            priority: 0,
            published_at: 300,
            source_sequence: 0,
            global_id: "saved:item-1".to_owned(),
        };
        assert_eq!(
            encode_cursor(&cursor, SavedSortMode::DateSaved).expect("cursor"),
            "AQCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgAAAAAAAAAMAAAAAAAAACIAAAAAAAAAASwAAAAAAAAAAAAMc2F2ZWQ6aXRlbS0x"
        );
    }

    #[test]
    fn saved_adapter_reads_one_selected_generation_with_its_own_cursor() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let base = std::fs::canonicalize(temporary.path()).expect("base");
        let paths =
            resolve_library_core_feed_browse_paths_in_root(&base, ROOT_DIRECTORY).expect("paths");
        let filter = filter();
        let binding = FeedBrowseGenerationBinding {
            generation_id: "a".repeat(64),
            source_document_id: "library-1".to_owned(),
            source_heads_digest: "b".repeat(64),
            source_head_count: 2,
            transition_sequence: 12,
            projection_revision: 34,
            filter_json: serde_json::json!({
                "filter": filter,
                "sortMode": SavedSortMode::DateSaved,
                "sortOrderSchemaVersion": SORT_ORDER_SCHEMA_VERSION,
            })
            .to_string(),
            ranking_clock_ms: 1_780_000_100_000,
            recommendation_order_schema_version: RECOMMENDATION_ORDER_SCHEMA_VERSION,
            total_rows: 2,
        };
        let path = paths
            .generation_root
            .join(format!("{}.sqlite", binding.generation_id));
        let published = {
            let mut store = FeedBrowseGenerationStore::open(&path).expect("store");
            store.begin(&binding).expect("begin");
            store
                .append_page(
                    0,
                    &[
                        FeedBrowseProjectedRow {
                            priority: 0,
                            published_at: 300,
                            source_sequence: 0,
                            global_id: "saved:new".to_owned(),
                            card_json: card("saved:new", 300),
                        },
                        FeedBrowseProjectedRow {
                            priority: 0,
                            published_at: 200,
                            source_sequence: 0,
                            global_id: "saved:old".to_owned(),
                            card_json: card("saved:old", 200),
                        },
                    ],
                )
                .expect("append");
            store.finalize().expect("finalize");
            store.seal(&path, &binding).expect("seal")
        };
        let mut registry =
            FeedBrowseGenerationRegistry::open(&paths.registry_path, &paths.generation_root)
                .expect("registry");
        registry.register(&published).expect("register");
        registry
            .select("saved-select:1", None, &binding.generation_id)
            .expect("select");

        let state = LibraryCoreSavedFeedRuntimeState::default();
        let first = read_saved_page_at_root(&state, &base, request(None, 1)).expect("first page");
        assert_eq!(first.rows[0]["globalId"], "saved:new");
        let cursor = first.next_cursor.expect("next cursor");
        let second =
            read_saved_page_at_root(&state, &base, request(Some(cursor), 2)).expect("second page");
        assert_eq!(second.rows[0]["globalId"], "saved:old");
        let final_cursor = second.next_cursor.expect("final probe cursor");
        let exhausted = read_saved_page_at_root(&state, &base, request(Some(final_cursor), 3))
            .expect("exhausted page");
        assert!(exhausted.rows.is_empty());
        assert!(exhausted.next_cursor.is_none());
        assert_eq!(second.total_count, 2);
    }
}
