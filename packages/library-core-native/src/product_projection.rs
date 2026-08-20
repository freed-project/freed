//! Deterministic projection of one canonical feed item into SQLite.
//!
//! Both direct host imports and verified journal operations must execute the
//! exact same SQL. Keeping it here prevents the signed journal from calling
//! back into a host runtime merely to materialize a product row.

use rusqlite::{params, Transaction};
use serde_json::Value;

const MAX_ITEM_BYTES: usize = 4 * 1024 * 1024;

fn validate_json_object(value: &str, maximum_bytes: usize) -> Result<Value, String> {
    if value.len() < 2 || value.len() > maximum_bytes {
        return Err("JSON payload exceeds its storage bound".into());
    }
    let parsed: Value = serde_json::from_str(value).map_err(|error| error.to_string())?;
    if !parsed.is_object() {
        return Err("JSON payload must be an object".into());
    }
    Ok(parsed)
}

fn string_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn integer_at(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_i64()
}

fn boolean_at(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool().map(i64::from)
}

/// Insert or replace one canonical feed item using the shipping projection.
pub fn upsert_item(
    transaction: &Transaction<'_>,
    item_json: &str,
    updated_at_ms: i64,
) -> Result<(), String> {
    let item = validate_json_object(item_json, MAX_ITEM_BYTES)?;
    let global_id = string_at(&item, &["globalId"])
        .filter(|value| !value.is_empty() && value.len() <= 4_096)
        .ok_or_else(|| "feed item globalId is missing or invalid".to_string())?;
    transaction
        .execute(
            "INSERT INTO library_core_feed_items (
               globalId, platform, contentType, publishedAt, capturedAt,
               authorId, authorDisplayName, authorHandle, sourceUrl,
               hidden, saved, archived, readAt, archivedAt, liked, likedAt,
               likedSyncedAt, seenSyncedAt, feedUrl, sampleData, deletedAt,
               payloadJson, updatedAtMs
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
               ?14, ?15, ?16, ?17, ?18, ?19, ?20, NULL, ?21, ?22
             )
             ON CONFLICT(globalId) DO UPDATE SET
               platform = excluded.platform,
               contentType = excluded.contentType,
               publishedAt = excluded.publishedAt,
               capturedAt = excluded.capturedAt,
               authorId = excluded.authorId,
               authorDisplayName = excluded.authorDisplayName,
               authorHandle = excluded.authorHandle,
               sourceUrl = excluded.sourceUrl,
               hidden = excluded.hidden,
               saved = excluded.saved,
               archived = excluded.archived,
               readAt = excluded.readAt,
               archivedAt = excluded.archivedAt,
               liked = excluded.liked,
               likedAt = excluded.likedAt,
               likedSyncedAt = excluded.likedSyncedAt,
               seenSyncedAt = excluded.seenSyncedAt,
               feedUrl = excluded.feedUrl,
               sampleData = excluded.sampleData,
               deletedAt = NULL,
               payloadJson = excluded.payloadJson,
               updatedAtMs = excluded.updatedAtMs;",
            params![
                global_id,
                string_at(&item, &["platform"]),
                string_at(&item, &["contentType"]),
                integer_at(&item, &["publishedAt"]),
                integer_at(&item, &["capturedAt"]),
                string_at(&item, &["author", "id"]),
                string_at(&item, &["author", "displayName"]),
                string_at(&item, &["author", "handle"]),
                string_at(&item, &["sourceUrl"]),
                boolean_at(&item, &["userState", "hidden"]),
                boolean_at(&item, &["userState", "saved"]),
                boolean_at(&item, &["userState", "archived"]),
                integer_at(&item, &["userState", "readAt"]),
                integer_at(&item, &["userState", "archivedAt"]),
                boolean_at(&item, &["userState", "liked"]),
                integer_at(&item, &["userState", "likedAt"]),
                integer_at(&item, &["userState", "likedSyncedAt"]),
                integer_at(&item, &["userState", "seenSyncedAt"]),
                string_at(&item, &["rssSource", "feedUrl"]),
                i64::from(item.get("sampleDataFingerprint").is_some()),
                item_json,
                updated_at_ms,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
