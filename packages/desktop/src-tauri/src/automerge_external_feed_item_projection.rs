//! Bounded native projection from one reconstructed FeedItem document.
//!
//! This module mirrors the lossless shared projection contract without loading
//! the Automerge corpus into JavaScript. Callers provide one receipt-verified
//! document at a time. Unknown fields and values that cannot fit a typed
//! SQLite column stay in the `rest` escape object.

use crate::shadow_store::FeedItemRow;
use serde_json::{Map, Value};
use std::fmt;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const RESERVED_REST_KEYS: [&str; 4] = ["__absent", "__author", "__raw", "__userState"];

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) enum FeedItemProjectionError {
    InvalidDocument,
    ReservedRestKey { key: String },
    Serialization,
}

impl fmt::Display for FeedItemProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDocument => formatter.write_str("invalid FeedItem document"),
            Self::ReservedRestKey { key } => {
                write!(formatter, "FeedItem uses reserved projection key {key}")
            }
            Self::Serialization => formatter.write_str("FeedItem projection serialization failed"),
        }
    }
}

impl std::error::Error for FeedItemProjectionError {}

type ProjectionResult<T> = Result<T, FeedItemProjectionError>;

#[derive(Default)]
struct ColumnEscapes {
    absent: Vec<Value>,
    raw: Map<String, Value>,
}

impl ColumnEscapes {
    fn take(&mut self, container: &mut Map<String, Value>, key: &str, path: &str) -> Option<Value> {
        match container.remove(key) {
            Some(value) => Some(value),
            None => {
                self.absent.push(Value::String(path.to_string()));
                None
            }
        }
    }

    fn take_subobject(
        &mut self,
        container: &mut Map<String, Value>,
        key: &str,
    ) -> Option<Map<String, Value>> {
        match self.take(container, key, key) {
            Some(Value::Object(value)) => Some(value),
            Some(value) => {
                self.raw.insert(key.to_string(), value);
                None
            }
            None => None,
        }
    }

    fn string_column(&mut self, value: Option<Value>, path: &str) -> Option<String> {
        match value {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value),
            Some(value) => {
                self.raw.insert(path.to_string(), value);
                None
            }
        }
    }

    fn integer_column(
        &mut self,
        value: Option<Value>,
        path: &str,
    ) -> ProjectionResult<Option<i64>> {
        match value {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(value)) => {
                if let Some(integer) = value.as_i64() {
                    if integer.unsigned_abs() <= MAX_SAFE_INTEGER {
                        return Ok(Some(integer));
                    }
                } else if let Some(integer) = value.as_u64() {
                    if integer <= MAX_SAFE_INTEGER {
                        return Ok(i64::try_from(integer).ok());
                    }
                } else if let Some(float) = value.as_f64() {
                    if float == 0.0 && float.is_sign_negative() {
                        return Err(FeedItemProjectionError::InvalidDocument);
                    }
                    if float.is_finite()
                        && float.fract() == 0.0
                        && float.abs() <= MAX_SAFE_INTEGER as f64
                    {
                        return Ok(Some(float as i64));
                    }
                }
                self.raw.insert(path.to_string(), Value::Number(value));
                Ok(None)
            }
            Some(value) => {
                self.raw.insert(path.to_string(), value);
                Ok(None)
            }
        }
    }

    fn boolean_column(&mut self, value: Option<Value>, path: &str) -> Option<i64> {
        match value {
            None | Some(Value::Null) => None,
            Some(Value::Bool(value)) => Some(i64::from(value)),
            Some(value) => {
                self.raw.insert(path.to_string(), value);
                None
            }
        }
    }
}

pub(super) fn project_feed_item_document(json: &str) -> ProjectionResult<FeedItemRow> {
    let Value::Object(mut root) =
        serde_json::from_str(json).map_err(|_| FeedItemProjectionError::InvalidDocument)?
    else {
        return Err(FeedItemProjectionError::InvalidDocument);
    };
    let Some(Value::String(global_id)) = root.remove("globalId") else {
        return Err(FeedItemProjectionError::InvalidDocument);
    };
    if global_id.is_empty() {
        return Err(FeedItemProjectionError::InvalidDocument);
    }

    let mut escapes = ColumnEscapes::default();
    let mut author = escapes.take_subobject(&mut root, "author");
    let mut user_state = escapes.take_subobject(&mut root, "userState");

    let platform = escapes.take(&mut root, "platform", "platform");
    let content_type = escapes.take(&mut root, "contentType", "contentType");
    let published_at = escapes.take(&mut root, "publishedAt", "publishedAt");
    let captured_at = escapes.take(&mut root, "capturedAt", "capturedAt");
    let source_url = escapes.take(&mut root, "sourceUrl", "sourceUrl");
    let content = escapes.take(&mut root, "content", "content");
    let preserved = escapes.take(&mut root, "preservedContent", "preservedContent");

    let author_id = author
        .as_mut()
        .and_then(|value| escapes.take(value, "id", "author.id"));
    let author_display_name = author
        .as_mut()
        .and_then(|value| escapes.take(value, "displayName", "author.displayName"));
    let author_handle = author
        .as_mut()
        .and_then(|value| escapes.take(value, "handle", "author.handle"));

    let hidden = user_state
        .as_mut()
        .and_then(|value| escapes.take(value, "hidden", "userState.hidden"));
    let saved = user_state
        .as_mut()
        .and_then(|value| escapes.take(value, "saved", "userState.saved"));
    let archived = user_state
        .as_mut()
        .and_then(|value| escapes.take(value, "archived", "userState.archived"));
    let read_at = user_state
        .as_mut()
        .and_then(|value| escapes.take(value, "readAt", "userState.readAt"));
    let archived_at = user_state
        .as_mut()
        .and_then(|value| escapes.take(value, "archivedAt", "userState.archivedAt"));
    let liked_at = user_state
        .as_mut()
        .and_then(|value| escapes.take(value, "likedAt", "userState.likedAt"));
    let tags = user_state
        .as_mut()
        .and_then(|value| escapes.take(value, "tags", "userState.tags"));

    for key in RESERVED_REST_KEYS {
        if root.contains_key(key) {
            return Err(FeedItemProjectionError::ReservedRestKey {
                key: key.to_string(),
            });
        }
    }
    if let Some(author) = author {
        if !author.is_empty() {
            root.insert("__author".to_string(), Value::Object(author));
        }
    }
    if let Some(user_state) = user_state {
        if !user_state.is_empty() {
            root.insert("__userState".to_string(), Value::Object(user_state));
        }
    }

    let row = FeedItemRow {
        global_id,
        platform: escapes.string_column(platform, "platform"),
        content_type: escapes.string_column(content_type, "contentType"),
        published_at: escapes.integer_column(published_at, "publishedAt")?,
        captured_at: escapes.integer_column(captured_at, "capturedAt")?,
        author_id: escapes.string_column(author_id, "author.id"),
        author_display_name: escapes.string_column(author_display_name, "author.displayName"),
        author_handle: escapes.string_column(author_handle, "author.handle"),
        source_url: escapes.string_column(source_url, "sourceUrl"),
        hidden: escapes.boolean_column(hidden, "userState.hidden"),
        saved: escapes.boolean_column(saved, "userState.saved"),
        archived: escapes.boolean_column(archived, "userState.archived"),
        read_at: escapes.integer_column(read_at, "userState.readAt")?,
        archived_at: escapes.integer_column(archived_at, "userState.archivedAt")?,
        liked_at: escapes.integer_column(liked_at, "userState.likedAt")?,
        tags: encode_present(tags)?,
        content_blob: encode_present(content)?,
        preserved_blob: encode_present(preserved)?,
        rest: String::new(),
    };

    if !escapes.absent.is_empty() {
        root.insert("__absent".to_string(), Value::Array(escapes.absent));
    }
    if !escapes.raw.is_empty() {
        root.insert("__raw".to_string(), Value::Object(escapes.raw));
    }
    Ok(FeedItemRow {
        rest: encode_value(Value::Object(root))?,
        ..row
    })
}

fn encode_present(value: Option<Value>) -> ProjectionResult<Option<String>> {
    value.map(encode_value).transpose()
}

fn encode_value(value: Value) -> ProjectionResult<String> {
    serde_json::to_string(&value).map_err(|_| FeedItemProjectionError::Serialization)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_typed_columns_and_preserves_unmodelled_fields() {
        let row = project_feed_item_document(
            r#"{
              "globalId":"rss:item",
              "platform":"rss",
              "contentType":"article",
              "publishedAt":42,
              "capturedAt":43,
              "author":{"id":"author","displayName":"Author","handle":"writer","avatarUrl":"a"},
              "sourceUrl":"https://example.test/item",
              "userState":{"hidden":false,"saved":true,"archived":null,"readAt":44,
                "archivedAt":null,"likedAt":45,"tags":["one"],"liked":true},
              "content":{"text":"body"},
              "preservedContent":{"readingTime":3},
              "engagement":{"likes":2}
            }"#,
        )
        .unwrap();

        assert_eq!(row.global_id, "rss:item");
        assert_eq!(row.platform.as_deref(), Some("rss"));
        assert_eq!(row.published_at, Some(42));
        assert_eq!(row.hidden, Some(0));
        assert_eq!(row.saved, Some(1));
        assert_eq!(row.archived, None);
        assert_eq!(row.tags.as_deref(), Some("[\"one\"]"));
        assert_eq!(row.content_blob.as_deref(), Some("{\"text\":\"body\"}"));
        assert_eq!(row.preserved_blob.as_deref(), Some("{\"readingTime\":3}"));
        assert_eq!(
            row.rest,
            "{\"__author\":{\"avatarUrl\":\"a\"},\"__userState\":{\"liked\":true},\
             \"engagement\":{\"likes\":2}}"
        );
    }

    #[test]
    fn records_absence_and_raw_values_without_coercion() {
        let row = project_feed_item_document(
            r#"{
              "globalId":"rss:item",
              "publishedAt":1.5,
              "capturedAt":9007199254740992,
              "author":null,
              "userState":{"saved":"yes"},
              "preservedContent":{"publishedAt":{"__nonFinite":"NaN"}}
            }"#,
        )
        .unwrap();

        assert_eq!(row.published_at, None);
        assert_eq!(row.captured_at, None);
        assert_eq!(row.saved, None);
        assert_eq!(
            row.preserved_blob.as_deref(),
            Some("{\"publishedAt\":{\"__nonFinite\":\"NaN\"}}")
        );
        assert_eq!(
            row.rest,
            "{\"__absent\":[\"platform\",\"contentType\",\"sourceUrl\",\
             \"content\",\"userState.hidden\",\"userState.archived\",\"userState.readAt\",\
             \"userState.archivedAt\",\"userState.likedAt\",\"userState.tags\"],\
             \"__raw\":{\"author\":null,\"capturedAt\":9007199254740992,\"publishedAt\":1.5,\
             \"userState.saved\":\"yes\"}}"
        );
    }

    #[test]
    fn orders_projection_json_by_utf8_key_bytes() {
        let row = project_feed_item_document(
            r#"{
              "globalId":"rss:unicode",
              "platform":null,
              "contentType":null,
              "publishedAt":null,
              "capturedAt":null,
              "author":{"id":null,"displayName":null,"handle":null},
              "sourceUrl":null,
              "userState":{"hidden":null,"saved":null,"archived":null,"readAt":null,
                "archivedAt":null,"likedAt":null,"tags":null},
              "content":null,
              "preservedContent":null,
              "\ud800\udc00":"later in UTF-8",
              "\ue000":"earlier in UTF-8"
            }"#,
        )
        .unwrap();

        assert_eq!(
            row.rest,
            "{\"\u{e000}\":\"earlier in UTF-8\",\"\u{10000}\":\"later in UTF-8\"}"
        );
    }

    #[test]
    fn rejects_invalid_identity_and_reserved_rest_collisions() {
        assert!(matches!(
            project_feed_item_document(r#"{"globalId":7}"#),
            Err(FeedItemProjectionError::InvalidDocument)
        ));
        assert!(matches!(
            project_feed_item_document(r#"{"globalId":"x","__raw":{"user":"data"}}"#),
            Err(FeedItemProjectionError::ReservedRestKey { .. })
        ));
        assert!(matches!(
            project_feed_item_document(r#"{"globalId":"x","capturedAt":-0.0}"#),
            Err(FeedItemProjectionError::InvalidDocument)
        ));
    }
}
