use crate::normalized_checkpoint::blob_digest;
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{CONTENT_CHUNK_BYTES, SQLITE_MUTATION_PROGRAMS};
use rusqlite::{params, Transaction};
use serde_json::Value;

const INLINE_CONTENT_MAXIMUM_BYTES: usize = 65_536;
const MAXIMUM_TAGS: usize = 4_096;
const MAXIMUM_HIGHLIGHTS: usize = 4_096;
const MAXIMUM_SIGNALS: usize = 256;

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
