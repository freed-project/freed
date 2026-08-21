use crate::library_core_canonical::encode_canonical_value;
use crate::library_core_hash::lower_hex;
use crate::normalized_checkpoint::blob_digest;
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{
    CONTENT_CHUNK_BYTES, PREFERENCE_WRITE_POLICIES_JSON, SQLITE_MUTATION_PROGRAMS,
};
use rusqlite::{params, Transaction};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const INLINE_CONTENT_MAXIMUM_BYTES: usize = 65_536;
const MAXIMUM_TAGS: usize = 4_096;
const MAXIMUM_HIGHLIGHTS: usize = 4_096;
const MAXIMUM_SIGNALS: usize = 256;
const MAXIMUM_REACH_OUTS: usize = 20;
const MAXIMUM_PREFERENCE_NODES: i64 = 512;
const MAXIMUM_PREFERENCE_PATH_BYTES: i64 = 4_096;
const MAXIMUM_PREFERENCE_TEXT_BYTES: i64 = 8_192;
const LEGACY_REACH_OUT_DIGEST_PREFIX: &[u8] =
    b"freed.library-core.v2/digest-bytes/legacy-reach-out\0";

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn object_mut<'a>(
    value: &'a mut Value,
    key: &str,
) -> Result<&'a mut serde_json::Map<String, Value>, NormalizedSqliteError> {
    value
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("legacy FeedItem has an invalid normalized object"))
}

fn take_large_text(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<Vec<u8>>, NormalizedSqliteError> {
    let Some(value) = object.get_mut(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let text = value
        .as_str()
        .ok_or_else(|| invalid("legacy FeedItem content field is not text"))?;
    if text.len() <= INLINE_CONTENT_MAXIMUM_BYTES {
        return Ok(None);
    }
    let bytes = text.as_bytes().to_vec();
    *value = Value::Null;
    Ok(Some(bytes))
}

fn insert_content_blob(
    transaction: &Transaction<'_>,
    bytes: &[u8],
    media_type: &str,
) -> Result<String, NormalizedSqliteError> {
    let content_digest = blob_digest(bytes);
    let chunk_count = bytes.len().div_ceil(CONTENT_CHUNK_BYTES);
    transaction.execute(
        "INSERT INTO library_blobs
         (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(content_digest) DO NOTHING;",
        params![
            content_digest,
            i64::try_from(bytes.len()).map_err(|_| invalid("legacy content is too large"))?,
            i64::try_from(CONTENT_CHUNK_BYTES)
                .map_err(|_| invalid("content chunk bound is invalid"))?,
            i64::try_from(chunk_count).map_err(|_| invalid("legacy content is too large"))?,
            media_type,
        ],
    )?;
    let descriptor: (i64, i64, i64, String) = transaction.query_row(
        "SELECT byte_length, chunk_bytes, chunk_count, media_type
         FROM library_blobs WHERE content_digest = ?1;",
        [&content_digest],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    if descriptor
        != (
            i64::try_from(bytes.len()).unwrap_or(-1),
            i64::try_from(CONTENT_CHUNK_BYTES).unwrap_or(-1),
            i64::try_from(chunk_count).unwrap_or(-1),
            media_type.to_string(),
        )
    {
        return Err(invalid(
            "content-addressed blob descriptor replay is inconsistent",
        ));
    }
    for (chunk_index, chunk) in bytes.chunks(CONTENT_CHUNK_BYTES).enumerate() {
        let chunk_digest = blob_digest(chunk);
        transaction.execute(
            "INSERT INTO library_blob_chunks
             (content_digest, chunk_index, chunk_digest, bytes)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(content_digest, chunk_index) DO NOTHING;",
            params![
                content_digest,
                i64::try_from(chunk_index)
                    .map_err(|_| invalid("legacy content has too many chunks"))?,
                chunk_digest,
                chunk,
            ],
        )?;
        let stored: (String, Vec<u8>) = transaction.query_row(
            "SELECT chunk_digest, bytes FROM library_blob_chunks
             WHERE content_digest = ?1 AND chunk_index = ?2;",
            params![
                content_digest,
                i64::try_from(chunk_index)
                    .map_err(|_| invalid("legacy content has too many chunks"))?,
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if stored.0 != chunk_digest || stored.1 != chunk {
            return Err(invalid(
                "content-addressed blob chunk replay is inconsistent",
            ));
        }
    }
    let stored_chunks: i64 = transaction.query_row(
        "SELECT count(*) FROM library_blob_chunks WHERE content_digest = ?1;",
        [&content_digest],
        |row| row.get(0),
    )?;
    if stored_chunks != i64::try_from(chunk_count).unwrap_or(-1) {
        return Err(invalid("content-addressed blob replay is inconsistent"));
    }
    Ok(content_digest)
}

fn bounded_array<'a>(
    value: Option<&'a Value>,
    maximum: usize,
    label: &'static str,
) -> Result<&'a [Value], NormalizedSqliteError> {
    match value {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(values)) if values.len() <= maximum => Ok(values),
        _ => Err(invalid(label)),
    }
}

fn mutation_program(
    mutation_id: &str,
) -> Result<&'static crate::sqlite_contract_generated::SqliteMutationProgram, NormalizedSqliteError>
{
    SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|program| program.mutation_id == mutation_id)
        .ok_or_else(|| invalid("normalized migration mutation program is missing"))
}

fn legacy_map<'a>(
    shell: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<&'a serde_json::Map<String, Value>>, NormalizedSqliteError> {
    match shell.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(value)) => Ok(Some(value)),
        _ => Err(invalid("legacy Library shell collection is invalid")),
    }
}

fn materialize_json_entity(
    transaction: &Transaction<'_>,
    mutation_id: &str,
    entity_id: &str,
    value: &Value,
    updated_at: i64,
) -> Result<(), NormalizedSqliteError> {
    if entity_id.is_empty() || entity_id.len() > 2_048 {
        return Err(invalid("legacy Library entity identity is invalid"));
    }
    let encoded = serde_json::to_string(value)
        .map_err(|_| invalid("legacy Library entity cannot be normalized"))?;
    if encoded.len() > INLINE_CONTENT_MAXIMUM_BYTES {
        return Err(invalid("legacy Library entity exceeds its metadata bound"));
    }
    let program = mutation_program(mutation_id)?;
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, [entity_id])?;
    }
    match mutation_id {
        "rss_feed_upsert" => {
            transaction.execute(
                program.materialize_sql,
                params![entity_id, encoded, updated_at],
            )?;
        }
        "person_upsert" | "account_upsert" => {
            transaction.execute(program.materialize_sql, params![entity_id, encoded])?;
        }
        _ => return Err(invalid("legacy Library entity program is unsupported")),
    }
    for sql in program.dependent_insert_sql {
        transaction.execute(sql, params![entity_id, encoded])?;
    }
    Ok(())
}

fn preference_policies() -> &'static serde_json::Map<String, Value> {
    static POLICIES: OnceLock<serde_json::Map<String, Value>> = OnceLock::new();
    POLICIES.get_or_init(|| {
        serde_json::from_str::<Value>(PREFERENCE_WRITE_POLICIES_JSON)
            .expect("generated preference write policies must be valid JSON")
            .as_object()
            .expect("generated preference write policies must be an object")
            .clone()
    })
}

fn policy(name: &str) -> &'static serde_json::Map<String, Value> {
    preference_policies()[name]
        .as_object()
        .unwrap_or_else(|| panic!("generated preference write policy {name} must be an object"))
}

fn sanitized_scalar_map(
    value: &Value,
    predicate: fn(&Value) -> bool,
) -> Result<Value, NormalizedSqliteError> {
    let source = value
        .as_object()
        .ok_or_else(|| invalid("legacy preference record is invalid"))?;
    if source.len() > 256 || source.values().any(|entry| !predicate(entry)) {
        return Err(invalid("legacy preference record is invalid"));
    }
    Ok(Value::Object(source.clone()))
}

fn sanitized_array(
    value: &Value,
    predicate: fn(&Value) -> bool,
) -> Result<Value, NormalizedSqliteError> {
    let source = value
        .as_array()
        .ok_or_else(|| invalid("legacy preference array is invalid"))?;
    if source.len() > 256 || source.iter().any(|entry| !predicate(entry)) {
        return Err(invalid("legacy preference array is invalid"));
    }
    Ok(Value::Array(source.clone()))
}

fn is_string(value: &Value) -> bool {
    value.as_str().is_some_and(|value| value.len() <= 8_192)
}

fn is_number(value: &Value) -> bool {
    value.as_i64().is_some() || value.as_u64().is_some() || value.as_f64().is_some()
}

fn is_true(value: &Value) -> bool {
    value == &Value::Bool(true)
}

fn sanitize_preference_nested(
    policy_name: &str,
    field: &str,
    value: &Value,
) -> Result<Option<Value>, NormalizedSqliteError> {
    let sanitized = match (policy_name, field) {
        ("user", "weights") => sanitize_preference_object("weights", value)?,
        ("user", "ulysses") => sanitize_preference_object("ulysses", value)?,
        ("user", "display") => sanitize_preference_object("display", value)?,
        ("user", "xCapture") => sanitize_preference_object("xCapture", value)?,
        ("user", "fbCapture") => sanitize_preference_object("facebookCapture", value)?,
        ("user", "friendSuggestions") => sanitize_preference_object("friendSuggestions", value)?,
        ("user", "ai") => sanitize_preference_object("ai", value)?,
        ("user", "storyWall") => sanitize_preference_object("storyWall", value)?,
        ("weights", "platforms" | "topics" | "authors") => sanitized_scalar_map(value, is_number)?,
        ("ulysses", "blockedPlatforms") => sanitized_array(value, is_string)?,
        ("ulysses", "allowedPaths") => {
            let source = value
                .as_object()
                .ok_or_else(|| invalid("legacy Ulysses path preferences are invalid"))?;
            if source.len() > 256 {
                return Err(invalid("legacy Ulysses path preferences are invalid"));
            }
            Value::Object(
                source
                    .iter()
                    .map(|(key, entry)| Ok((key.clone(), sanitized_array(entry, is_string)?)))
                    .collect::<Result<_, NormalizedSqliteError>>()?,
            )
        }
        ("display", "reading") => sanitize_preference_object("reading", value)?,
        ("xCapture", "whitelist" | "blacklist") => {
            let source = value
                .as_object()
                .ok_or_else(|| invalid("legacy X account preference map is invalid"))?;
            if source.len() > 256 {
                return Err(invalid("legacy X account preference map is invalid"));
            }
            Value::Object(
                source
                    .iter()
                    .map(|(key, entry)| {
                        Ok((key.clone(), sanitize_preference_object("xAccount", entry)?))
                    })
                    .collect::<Result<_, NormalizedSqliteError>>()?,
            )
        }
        ("facebookCapture", "excludedGroupIds") => sanitized_scalar_map(value, is_true)?,
        ("friendSuggestions", "dismissedSuggestionIds") => sanitized_array(value, is_string)?,
        ("storyWall", "selectedYears") => sanitized_array(value, is_number)?,
        (
            "storyWall",
            "includedPlatforms" | "includedAccountIds" | "featuredItemIds" | "hiddenItemIds",
        ) => sanitized_array(value, is_string)?,
        ("storyWall", "style") => sanitize_preference_object("storyWallStyle", value)?,
        ("storyWall", "publishTarget") => {
            sanitize_preference_object("storyWallPublishTarget", value)?
        }
        _ => return Err(invalid("generated nested preference policy is unsupported")),
    };
    if sanitized
        .as_object()
        .is_some_and(|object| object.is_empty())
    {
        Ok(None)
    } else {
        Ok(Some(sanitized))
    }
}

fn sanitize_preference_object(
    policy_name: &str,
    value: &Value,
) -> Result<Value, NormalizedSqliteError> {
    let source = value
        .as_object()
        .ok_or_else(|| invalid("legacy preferences are invalid"))?;
    let mut result = serde_json::Map::new();
    for (field, disposition) in policy(policy_name) {
        let Some(value) = source.get(field) else {
            continue;
        };
        match disposition.as_str() {
            Some("sync") => {
                result.insert(field.clone(), value.clone());
            }
            Some("nested") => {
                if let Some(value) = sanitize_preference_nested(policy_name, field, value)? {
                    result.insert(field.clone(), value);
                }
            }
            Some("device-local" | "compatibility-only") => {}
            _ => return Err(invalid("generated preference disposition is invalid")),
        }
    }
    Ok(Value::Object(result))
}

fn migrate_legacy_preferences_v1(
    transaction: &Transaction<'_>,
    preferences: &Value,
    updated_at: i64,
) -> Result<(), NormalizedSqliteError> {
    let sanitized = sanitize_preference_object("user", preferences)?;
    let encoded = serde_json::to_string(&sanitized)
        .map_err(|_| invalid("legacy preferences cannot be normalized"))?;
    let bounds: (i64, i64, i64) = transaction.query_row(
        "SELECT count(*),
                COALESCE(max(length(CAST(fullkey AS BLOB))), 0),
                COALESCE(max(CASE type WHEN 'text' THEN length(CAST(atom AS BLOB)) ELSE 0 END), 0)
         FROM json_tree(?1) WHERE fullkey <> '$';",
        [&encoded],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if bounds.0 > MAXIMUM_PREFERENCE_NODES
        || bounds.1 > MAXIMUM_PREFERENCE_PATH_BYTES
        || bounds.2 > MAXIMUM_PREFERENCE_TEXT_BYTES
    {
        return Err(invalid(
            "legacy synchronized preferences exceed their bounds",
        ));
    }
    let program = mutation_program("preferences_leaf_assignment")?;
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, [&encoded])?;
    }
    transaction.execute(program.materialize_sql, params![encoded, updated_at])?;
    Ok(())
}

fn legacy_reach_out_id(
    person_id: &str,
    ordinal: usize,
    value: &Value,
) -> Result<String, NormalizedSqliteError> {
    let canonical = encode_canonical_value(value, INLINE_CONTENT_MAXIMUM_BYTES)
        .map_err(|_| invalid("legacy reach-out entry cannot be canonicalized"))?;
    let mut digest = Sha256::new();
    digest.update(LEGACY_REACH_OUT_DIGEST_PREFIX);
    digest.update(person_id.as_bytes());
    digest.update([0]);
    digest.update(ordinal.to_be_bytes());
    digest.update(canonical);
    Ok(lower_hex(&digest.finalize()))
}

/// Decomposes the historical shell into final normalized product tables. The
/// caller owns the single cutover transaction and source fence. This function
/// does not retain, hash, or copy the shell itself.
pub(crate) fn migrate_legacy_shell_v1(
    transaction: &Transaction<'_>,
    shell_json: &str,
    updated_at: i64,
) -> Result<(), NormalizedSqliteError> {
    if updated_at < 0 {
        return Err(invalid("legacy Library shell time is invalid"));
    }
    let shell: Value = serde_json::from_str(shell_json)
        .map_err(|_| invalid("legacy Library shell JSON is invalid"))?;
    let shell = shell
        .as_object()
        .ok_or_else(|| invalid("legacy Library shell is not an object"))?;

    if let Some(feeds) = legacy_map(shell, "feeds")? {
        for (url, feed) in feeds {
            if feed.get("url").and_then(Value::as_str) != Some(url) {
                return Err(invalid("legacy RSS feed identity does not match its key"));
            }
            materialize_json_entity(transaction, "rss_feed_upsert", url, feed, updated_at)?;
        }
    }
    if let Some(persons) = legacy_map(shell, "persons")? {
        for (person_id, person) in persons {
            if person.get("id").and_then(Value::as_str) != Some(person_id) {
                return Err(invalid("legacy Person identity does not match its key"));
            }
            materialize_json_entity(transaction, "person_upsert", person_id, person, updated_at)?;
            for (ordinal, reach_out) in bounded_array(
                person.get("reachOutLog"),
                MAXIMUM_REACH_OUTS,
                "legacy Person reach-out history exceeds its bound",
            )?
            .iter()
            .enumerate()
            {
                let reach_out = reach_out
                    .as_object()
                    .ok_or_else(|| invalid("legacy Person reach-out entry is invalid"))?;
                let reach_out_value = Value::Object(reach_out.clone());
                let reach_out_id = legacy_reach_out_id(person_id, ordinal, &reach_out_value)?;
                let logged_at = reach_out
                    .get("loggedAt")
                    .and_then(Value::as_i64)
                    .filter(|value| *value >= 0)
                    .ok_or_else(|| invalid("legacy Person reach-out time is invalid"))?;
                let channel = reach_out.get("channel").and_then(Value::as_str);
                if channel.is_some_and(|value| value.is_empty() || value.len() > 255) {
                    return Err(invalid("legacy Person reach-out channel is invalid"));
                }
                let notes = reach_out.get("notes").and_then(Value::as_str);
                if notes.is_some_and(|value| value.len() > INLINE_CONTENT_MAXIMUM_BYTES) {
                    return Err(invalid("legacy Person reach-out notes exceed their bound"));
                }
                transaction.execute(
                    mutation_program("person_reach_out_append")?.materialize_sql,
                    params![person_id, reach_out_id, logged_at, channel, notes],
                )?;
            }
        }
    }
    if let Some(accounts) = legacy_map(shell, "accounts")? {
        for (account_id, account) in accounts {
            if account.get("id").and_then(Value::as_str) != Some(account_id) {
                return Err(invalid("legacy Account identity does not match its key"));
            }
            materialize_json_entity(
                transaction,
                "account_upsert",
                account_id,
                account,
                updated_at,
            )?;
        }
    }
    if let Some(preferences) = shell.get("preferences").filter(|value| !value.is_null()) {
        migrate_legacy_preferences_v1(transaction, preferences, updated_at)?;
    }
    Ok(())
}

/// Decomposes one historical FeedItem JSON row into final normalized product
/// tables. This is used only inside the one-epoch migration transaction. It
/// never writes a shell, whole-item JSON row, operation, receipt, or authority
/// record.
pub(crate) fn migrate_legacy_feed_item_v1(
    transaction: &Transaction<'_>,
    global_id: &str,
    payload_json: &str,
    updated_at: i64,
) -> Result<(), NormalizedSqliteError> {
    if global_id.is_empty() || global_id.len() > 2_048 || updated_at < 0 {
        return Err(invalid("legacy FeedItem row identity is invalid"));
    }
    let mut item: Value = serde_json::from_str(payload_json)
        .map_err(|_| invalid("legacy FeedItem JSON is invalid"))?;
    if item.get("globalId").and_then(Value::as_str) != Some(global_id) {
        return Err(invalid("legacy FeedItem identity does not match its row"));
    }

    let content_bytes = take_large_text(object_mut(&mut item, "content")?, "text")?;
    let preserved_bytes = match item.get_mut("preservedContent") {
        None | Some(Value::Null) => None,
        Some(value) => take_large_text(
            value
                .as_object_mut()
                .ok_or_else(|| invalid("legacy preserved content is invalid"))?,
            "text",
        )?,
    };
    let content_digest = content_bytes
        .as_deref()
        .map(|bytes| insert_content_blob(transaction, bytes, "text/plain; charset=utf-8"))
        .transpose()?;
    let preserved_digest = preserved_bytes
        .as_deref()
        .map(|bytes| insert_content_blob(transaction, bytes, "text/plain; charset=utf-8"))
        .transpose()?;

    let program = SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|program| program.mutation_id == "feed_item_capture_upsert")
        .ok_or_else(|| invalid("normalized FeedItem mutation program is missing"))?;
    let normalized_item = serde_json::to_string(&item)
        .map_err(|_| invalid("legacy FeedItem JSON cannot be normalized"))?;
    for sql in program.dependent_delete_sql {
        transaction.execute(sql, [global_id])?;
    }
    transaction.execute(
        program.materialize_sql,
        params![global_id, normalized_item, updated_at],
    )?;
    for sql in program.dependent_insert_sql {
        transaction.execute(sql, params![global_id, normalized_item])?;
    }
    transaction.execute(
        "UPDATE library_feed_items
         SET content_text_blob_digest = ?2,
             preserved_text_blob_digest = ?3
         WHERE global_id = ?1;",
        params![global_id, content_digest, preserved_digest],
    )?;

    let user_state = item
        .get("userState")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("legacy FeedItem user state is invalid"))?;
    for tag in bounded_array(
        user_state.get("tags"),
        MAXIMUM_TAGS,
        "legacy FeedItem tag set exceeds its bound",
    )? {
        let tag = tag
            .as_str()
            .filter(|tag| !tag.is_empty() && tag.len() <= 2_048)
            .ok_or_else(|| invalid("legacy FeedItem tag is invalid"))?;
        transaction.execute(
            "INSERT OR IGNORE INTO library_feed_item_tags (global_id, tag) VALUES (?1, ?2);",
            params![global_id, tag],
        )?;
    }
    for (ordinal, highlight) in bounded_array(
        user_state.get("highlights"),
        MAXIMUM_HIGHLIGHTS,
        "legacy FeedItem highlight set exceeds its bound",
    )?
    .iter()
    .enumerate()
    {
        let highlight = highlight
            .as_object()
            .ok_or_else(|| invalid("legacy FeedItem highlight is invalid"))?;
        let text = highlight
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("legacy FeedItem highlight text is invalid"))?;
        let (inline_text, text_digest) = if text.len() > INLINE_CONTENT_MAXIMUM_BYTES {
            (
                None,
                Some(insert_content_blob(
                    transaction,
                    text.as_bytes(),
                    "text/plain; charset=utf-8",
                )?),
            )
        } else {
            (Some(text), None)
        };
        let note = highlight.get("note").and_then(Value::as_str);
        if note.is_some_and(|note| note.len() > INLINE_CONTENT_MAXIMUM_BYTES) {
            return Err(invalid(
                "legacy FeedItem highlight note exceeds its metadata bound",
            ));
        }
        let created_at = highlight
            .get("createdAt")
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
            .ok_or_else(|| invalid("legacy FeedItem highlight time is invalid"))?;
        transaction.execute(
            "INSERT INTO library_feed_item_highlights
             (global_id, ordinal, text_value, text_blob_digest, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            params![
                global_id,
                i64::try_from(ordinal)
                    .map_err(|_| invalid("legacy highlight ordinal is invalid"))?,
                inline_text,
                text_digest,
                note,
                created_at,
            ],
        )?;
    }

    if let Some(signals) = item.get("contentSignals").filter(|value| !value.is_null()) {
        let signals = signals
            .as_object()
            .ok_or_else(|| invalid("legacy FeedItem signals are invalid"))?;
        let version = signals
            .get("version")
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
            .ok_or_else(|| invalid("legacy FeedItem signal version is invalid"))?;
        let method = signals
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("legacy FeedItem signal method is invalid"))?;
        let inferred_at = signals
            .get("inferredAt")
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
            .ok_or_else(|| invalid("legacy FeedItem signal time is invalid"))?;
        transaction.execute(
            "INSERT INTO library_feed_item_signals (global_id, version, method, inferred_at)
             VALUES (?1, ?2, ?3, ?4);",
            params![global_id, version, method, inferred_at],
        )?;
        let scores = signals
            .get("scores")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("legacy FeedItem signal scores are invalid"))?;
        if scores.len() > MAXIMUM_SIGNALS {
            return Err(invalid("legacy FeedItem signal scores exceed their bound"));
        }
        let tags = bounded_array(
            signals.get("tags"),
            MAXIMUM_SIGNALS,
            "legacy FeedItem signal tags exceed their bound",
        )?;
        for (signal, score) in scores {
            if signal.is_empty() || signal.len() > 512 {
                return Err(invalid("legacy FeedItem signal identity is invalid"));
            }
            let score = score
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| invalid("legacy FeedItem signal score is invalid"))?;
            let tagged = tags.iter().any(|tag| tag.as_str() == Some(signal.as_str()));
            transaction.execute(
                "INSERT INTO library_feed_item_signal_scores (global_id, signal, score, tagged)
                 VALUES (?1, ?2, ?3, ?4);",
                params![global_id, signal, score, tagged],
            )?;
        }
    }

    if let Some(event) = item.get("eventCandidate").filter(|value| !value.is_null()) {
        let event = event
            .as_object()
            .ok_or_else(|| invalid("legacy FeedItem event candidate is invalid"))?;
        let evidence = event.get("evidence").and_then(Value::as_str);
        let (inline_evidence, evidence_digest) =
            if evidence.is_some_and(|text| text.len() > INLINE_CONTENT_MAXIMUM_BYTES) {
                (
                    None,
                    Some(insert_content_blob(
                        transaction,
                        evidence.unwrap_or_default().as_bytes(),
                        "text/plain; charset=utf-8",
                    )?),
                )
            } else {
                (evidence, None)
            };
        transaction.execute(
            "INSERT INTO library_feed_item_events
             (global_id, version, method, detected_at, confidence, title,
              starts_at, ends_at, timezone, location_name, location_url,
              evidence, evidence_blob_digest)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13);",
            params![
                global_id,
                event.get("version").and_then(Value::as_i64),
                event.get("method").and_then(Value::as_str),
                event.get("detectedAt").and_then(Value::as_i64),
                event.get("confidence").and_then(Value::as_f64),
                event.get("title").and_then(Value::as_str),
                event.get("startsAt").and_then(Value::as_i64),
                event.get("endsAt").and_then(Value::as_i64),
                event.get("timezone").and_then(Value::as_str),
                event.get("locationName").and_then(Value::as_str),
                event.get("locationUrl").and_then(Value::as_str),
                inline_evidence,
                evidence_digest,
            ],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_sqlite::NormalizedCheckpointExportRequestV2;
    use crate::{export_normalized_checkpoint_page_v2, install_normalized_schema_v1};
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn decomposes_the_shell_and_excludes_local_and_compatibility_preferences() {
        let mut connection = Connection::open_in_memory().unwrap();
        install_normalized_schema_v1(&connection).unwrap();
        let shell = json!({
            "feeds": {
                "https://example.com/feed.xml": {
                    "url": "https://example.com/feed.xml",
                    "title": "Example",
                    "siteUrl": "https://example.com",
                    "enabled": true,
                    "trackUnread": true,
                    "lastFetchError": "device only"
                }
            },
            "persons": {
                "person:ada": {
                    "id": "person:ada",
                    "name": "Ada",
                    "relationshipStatus": "friend",
                    "careLevel": 5,
                    "reachOutLog": [
                        {"loggedAt": 40, "channel": "email", "notes": "Sent notes"},
                        {"loggedAt": 30, "notes": "Met at the library"}
                    ],
                    "tags": ["mathematician", "friend"],
                    "graphX": 100,
                    "createdAt": 10,
                    "updatedAt": 40
                }
            },
            "accounts": {
                "account:ada": {
                    "id": "account:ada",
                    "personId": "person:ada",
                    "kind": "social",
                    "provider": "x",
                    "externalId": "ada",
                    "handle": "ada",
                    "firstSeenAt": 10,
                    "lastSeenAt": 40,
                    "discoveredFrom": "manual_entry",
                    "followRosterRoles": ["following"],
                    "graphPinned": true,
                    "createdAt": 10,
                    "updatedAt": 40
                }
            },
            "preferences": {
                "weights": {
                    "recency": 70,
                    "platforms": {"rss": 1.5},
                    "topics": {},
                    "authors": {}
                },
                "display": {
                    "themeId": "midnight",
                    "itemsPerPage": 500,
                    "showEngagementCounts": true,
                    "animationIntensity": "detailed",
                    "reading": {
                        "focusMode": true,
                        "focusIntensity": 0.8,
                        "markReadOnScroll": true,
                        "showReadInGrayscale": false,
                        "dualColumnMode": true
                    },
                    "archivePruneDays": 30
                },
                "sync": {
                    "cloudProvider": "google_drive",
                    "autoBackup": true,
                    "backupFrequency": "daily"
                },
                "ai": {
                    "provider": "ollama",
                    "model": "local",
                    "ollamaUrl": "http://localhost",
                    "autoSummarize": true,
                    "extractTopics": false
                }
            }
        });
        let transaction = connection.transaction().unwrap();
        migrate_legacy_shell_v1(&transaction, &shell.to_string(), 50).unwrap();
        transaction.commit().unwrap();

        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM library_rss_feeds WHERE url = 'https://example.com/feed.xml';",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "Example"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_person_reach_outs WHERE person_id = 'person:ada';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT person_id FROM library_accounts WHERE id = 'account:ada';",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "person:ada"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_account_follow_roles
                     WHERE account_id = 'account:ada' AND role = 'following';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        let preference_paths = connection
            .prepare("SELECT path FROM library_preferences ORDER BY path;")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(preference_paths.contains(&"v:$.display.showEngagementCounts".to_string()));
        assert!(preference_paths.contains(&"v:$.ai.autoSummarize".to_string()));
        assert!(preference_paths.contains(&"v:$.weights.platforms.rss".to_string()));
        for excluded in [
            "themeId",
            "itemsPerPage",
            "dualColumnMode",
            "cloudProvider",
            "autoBackup",
            "provider",
            "model",
            "ollamaUrl",
        ] {
            assert!(preference_paths.iter().all(|path| !path.contains(excluded)));
        }

        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library', 1, 'epoch', 1, 50);",
                [],
            )
            .unwrap();
        let page = export_normalized_checkpoint_page_v2(
            &connection,
            &NormalizedCheckpointExportRequestV2::default(),
        )
        .unwrap();
        assert!(page
            .records
            .iter()
            .all(|record| !record.registry_key.contains("shell")));
    }

    #[test]
    fn shell_migration_fails_if_an_account_references_a_missing_person() {
        let mut connection = Connection::open_in_memory().unwrap();
        install_normalized_schema_v1(&connection).unwrap();
        let shell = json!({
            "accounts": {
                "account:orphaned-link": {
                    "id": "account:orphaned-link",
                    "personId": "person:missing",
                    "kind": "social",
                    "provider": "x",
                    "externalId": "missing",
                    "firstSeenAt": 10,
                    "lastSeenAt": 10,
                    "discoveredFrom": "manual_entry",
                    "createdAt": 10,
                    "updatedAt": 10
                }
            }
        });
        let transaction = connection.transaction().unwrap();
        assert!(migrate_legacy_shell_v1(&transaction, &shell.to_string(), 10).is_err());
        transaction.rollback().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM library_accounts;", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
    }

    #[test]
    fn decomposes_a_large_legacy_item_losslessly_without_a_shell_record() {
        let mut connection = Connection::open_in_memory().unwrap();
        install_normalized_schema_v1(&connection).unwrap();
        let body = "long-form ".repeat(300_000);
        let highlight = "highlight ".repeat(20_000);
        let evidence = "evidence ".repeat(20_000);
        let item = json!({
            "globalId": "rss:large",
            "platform": "rss",
            "contentType": "article",
            "capturedAt": 10,
            "publishedAt": 9,
            "author": {"id": "author", "handle": "author", "displayName": "Author"},
            "content": {"text": body, "mediaUrls": [], "mediaTypes": []},
            "userState": {
                "hidden": false,
                "saved": true,
                "archived": false,
                "tags": ["research"],
                "highlights": [{"text": highlight, "note": "Keep", "createdAt": 11}]
            },
            "topics": ["architecture"],
            "contentSignals": {
                "version": 1,
                "method": "manual",
                "inferredAt": 12,
                "scores": {"essay": 0.75},
                "tags": ["essay"]
            },
            "eventCandidate": {
                "version": 1,
                "method": "manual",
                "detectedAt": 13,
                "confidence": 0.9,
                "title": "Gathering",
                "evidence": evidence
            }
        });
        let payload_json = serde_json::to_string(&item).unwrap();
        assert!(payload_json.len() <= 4_194_304);
        let transaction = connection.transaction().unwrap();
        migrate_legacy_feed_item_v1(&transaction, "rss:large", &payload_json, 14).unwrap();
        transaction.commit().unwrap();

        let digests: (String, String, String) = connection
            .query_row(
                "SELECT item.content_text_blob_digest,
                        highlight.text_blob_digest,
                        event.evidence_blob_digest
                 FROM library_feed_items AS item
                 JOIN library_feed_item_highlights AS highlight USING (global_id)
                 JOIN library_feed_item_events AS event USING (global_id)
                 WHERE item.global_id = 'rss:large';",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        for (digest, expected) in [
            (digests.0, body.as_bytes()),
            (digests.1, highlight.as_bytes()),
            (digests.2, evidence.as_bytes()),
        ] {
            let mut statement = connection
                .prepare(
                    "SELECT bytes FROM library_blob_chunks
                     WHERE content_digest = ?1 ORDER BY chunk_index;",
                )
                .unwrap();
            let bytes = statement
                .query_map([digest], |row| row.get::<_, Vec<u8>>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
                .concat();
            assert_eq!(bytes, expected);
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_feed_item_tags WHERE global_id = 'rss:large';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT tagged FROM library_feed_item_signal_scores
                     WHERE global_id = 'rss:large' AND signal = 'essay';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library', 1, 'epoch', 1, 14);",
                [],
            )
            .unwrap();
        let page = export_normalized_checkpoint_page_v2(
            &connection,
            &NormalizedCheckpointExportRequestV2::default(),
        )
        .unwrap();
        assert!(page
            .records
            .iter()
            .all(|record| !record.registry_key.contains("shell")));
    }
}
