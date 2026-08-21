use crate::library_core_canonical::encode_canonical_value;
use crate::normalized_checkpoint::{
    checked_record, ContentRecordError, NormalizedCheckpointRecordV2,
};
use crate::sqlite_contract_generated::{
    CHECKPOINT_PAGE_MAXIMUM_RECORDS, NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES, NORMALIZED_SCHEMA_SQL,
    SQLITE_SCHEMA_VERSION,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug)]
pub enum NormalizedSqliteError {
    Content(ContentRecordError),
    InvalidRequest(&'static str),
    Sqlite(rusqlite::Error),
    Transport(String),
}

impl std::fmt::Display for NormalizedSqliteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Content(error) => write!(formatter, "{error}"),
            Self::InvalidRequest(message) => formatter.write_str(message),
            Self::Sqlite(error) => write!(formatter, "normalized SQLite failure: {error}"),
            Self::Transport(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for NormalizedSqliteError {}

impl From<rusqlite::Error> for NormalizedSqliteError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<ContentRecordError> for NormalizedSqliteError {
    fn from(value: ContentRecordError) -> Self {
        Self::Content(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedCheckpointCursorV2 {
    pub registry_key: String,
    pub primary_key_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedCheckpointExportRequestV2 {
    pub after: Option<NormalizedCheckpointCursorV2>,
    pub maximum_records: usize,
    pub maximum_response_bytes: usize,
}

impl Default for NormalizedCheckpointExportRequestV2 {
    fn default() -> Self {
        Self {
            after: None,
            maximum_records: CHECKPOINT_PAGE_MAXIMUM_RECORDS,
            maximum_response_bytes: NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedCheckpointExportPageV2 {
    pub records: Vec<NormalizedCheckpointRecordV2>,
    pub next_cursor: Option<NormalizedCheckpointCursorV2>,
    pub done: bool,
    pub canonical_record_bytes: usize,
}

pub fn install_normalized_schema_v1(connection: &Connection) -> Result<(), NormalizedSqliteError> {
    connection.execute_batch(NORMALIZED_SCHEMA_SQL)?;
    connection.pragma_update(None, "user_version", SQLITE_SCHEMA_VERSION)?;
    Ok(())
}

fn parse_json(value: &str, label: &'static str) -> Result<Value, NormalizedSqliteError> {
    serde_json::from_str(value)
        .map_err(|error| NormalizedSqliteError::Transport(format!("{label} is invalid: {error}")))
}

fn serialized_page_bytes(
    page: &NormalizedCheckpointExportPageV2,
) -> Result<usize, NormalizedSqliteError> {
    serde_json::to_vec(page)
        .map(|bytes| bytes.len())
        .map_err(|error| {
            NormalizedSqliteError::Transport(format!("checkpoint page encoding failed: {error}"))
        })
}

pub fn export_normalized_checkpoint_page_v2(
    connection: &Connection,
    request: &NormalizedCheckpointExportRequestV2,
) -> Result<NormalizedCheckpointExportPageV2, NormalizedSqliteError> {
    if request.maximum_records == 0 || request.maximum_records > CHECKPOINT_PAGE_MAXIMUM_RECORDS {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint maximumRecords is outside its bound",
        ));
    }
    if request.maximum_response_bytes == 0
        || request.maximum_response_bytes > NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint maximumResponseBytes is outside its bound",
        ));
    }
    let after_registry_key = request
        .after
        .as_ref()
        .map(|cursor| cursor.registry_key.as_str())
        .unwrap_or("");
    let after_primary_key_json = request
        .after
        .as_ref()
        .map(|cursor| cursor.primary_key_json.as_str())
        .unwrap_or("");
    if after_registry_key.contains("shell")
        || after_registry_key.len() > 64
        || after_primary_key_json.len() > 4_096
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint cursor is invalid",
        ));
    }

    let fetch_limit = request.maximum_records.saturating_add(1);
    let mut statement = connection.prepare(
        "SELECT registry_key, primary_key_json, payload_json, chunk_bytes
         FROM library_checkpoint_export
         WHERE (?1 = '' OR registry_key > ?1 OR (registry_key = ?1 AND primary_key_json > ?2))
         ORDER BY registry_key, primary_key_json
         LIMIT ?3;",
    )?;
    let mut rows = statement.query(params![
        after_registry_key,
        after_primary_key_json,
        i64::try_from(fetch_limit).map_err(|_| NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint maximumRecords is invalid"
        ))?,
    ])?;
    let mut page = NormalizedCheckpointExportPageV2 {
        records: Vec::with_capacity(request.maximum_records),
        next_cursor: request.after.clone(),
        done: true,
        canonical_record_bytes: 0,
    };
    while let Some(row) = rows.next()? {
        if page.records.len() == request.maximum_records {
            break;
        }
        let registry_key: String = row.get(0)?;
        let primary_key_json: String = row.get(1)?;
        let payload_json: String = row.get(2)?;
        let chunk_bytes: Option<Vec<u8>> = row.get(3)?;
        let primary_key = parse_json(&primary_key_json, "checkpoint primary key")?;
        let mut payload = parse_json(&payload_json, "checkpoint payload")?;
        if let Some(bytes) = chunk_bytes {
            let object = payload.as_object_mut().ok_or_else(|| {
                NormalizedSqliteError::Transport("checkpoint chunk payload is invalid".into())
            })?;
            object.insert("bytesBase64".into(), Value::String(BASE64.encode(bytes)));
        }
        let record = checked_record(&registry_key, primary_key, payload)?;
        let canonical_bytes = encode_canonical_value(
            &serde_json::to_value(&record).map_err(|error| {
                NormalizedSqliteError::Transport(format!(
                    "checkpoint record encoding failed: {error}"
                ))
            })?,
            crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        )
        .map_err(|_| {
            NormalizedSqliteError::Transport("checkpoint record exceeds its bound".into())
        })?
        .len();
        let cursor = NormalizedCheckpointCursorV2 {
            registry_key,
            primary_key_json,
        };
        let previous_cursor = page.next_cursor.clone();
        page.records.push(record);
        page.next_cursor = Some(cursor);
        page.canonical_record_bytes += canonical_bytes;
        page.done = false;
        if serialized_page_bytes(&page)? > request.maximum_response_bytes {
            page.records.pop();
            page.next_cursor = previous_cursor;
            page.canonical_record_bytes -= canonical_bytes;
            break;
        }
    }
    page.done = connection
        .query_row(
                "SELECT 1 FROM library_checkpoint_export
                 WHERE (?1 = '' OR registry_key > ?1 OR (registry_key = ?1 AND primary_key_json > ?2))
                 LIMIT 1;",
                params![
                    page.next_cursor
                        .as_ref()
                        .map(|cursor| cursor.registry_key.as_str())
                        .unwrap_or(""),
                    page.next_cursor
                        .as_ref()
                        .map(|cursor| cursor.primary_key_json.as_str())
                        .unwrap_or("")
                ],
                |_| Ok(()),
            )
        .optional()?
        .is_none();
    if page.records.is_empty() && !page.done {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint response bound cannot fit the next record",
        ));
    }
    if serialized_page_bytes(&page)? > request.maximum_response_bytes {
        return Err(NormalizedSqliteError::Transport(
            "normalized checkpoint response exceeded its exact byte bound".into(),
        ));
    }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_checkpoint::reassemble_content_records_v1;
    use crate::normalized_checkpoint::split_content_records_v1;
    use crate::sqlite_contract_generated::{
        CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES, CONTENT_CHUNK_BYTES,
    };
    use rusqlite::params;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("open");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
    }

    #[test]
    fn schema_contains_no_shell_or_whole_document_json_columns() {
        let connection = fixture();
        let schema: String = connection
            .query_row(
                "SELECT group_concat(sql, '\n') FROM sqlite_schema WHERE sql IS NOT NULL;",
                [],
                |row| row.get(0),
            )
            .expect("schema text");
        let lowered = schema.to_ascii_lowercase();
        assert!(!lowered.contains("shelljson"));
        assert!(!lowered.contains("payloadjson"));
        assert!(!lowered.contains("item_json"));
        assert!(!lowered.contains("docstate"));
    }

    #[test]
    fn exports_closed_normalized_rows_in_stable_pages() {
        let connection = fixture();
        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library-1', 1, 'epoch-1', 7, 1000);",
                [],
            )
            .expect("meta");
        connection
            .execute(
                "INSERT INTO library_persons
                 (id, name, relationship_status, care_level, created_at, updated_at)
                 VALUES ('person-1', 'Ada', 'friend', 5, 900, 1000);",
                [],
            )
            .expect("person");
        connection
            .execute(
                "INSERT INTO library_person_tags (person_id, tag) VALUES ('person-1', 'mathematician');",
                [],
            )
            .expect("tag");
        let first = export_normalized_checkpoint_page_v2(
            &connection,
            &NormalizedCheckpointExportRequestV2 {
                maximum_records: 2,
                ..Default::default()
            },
        )
        .expect("first page");
        assert_eq!(first.records.len(), 2);
        assert!(!first.done);
        let second = export_normalized_checkpoint_page_v2(
            &connection,
            &NormalizedCheckpointExportRequestV2 {
                after: first.next_cursor,
                maximum_records: 2,
                ..Default::default()
            },
        )
        .expect("second page");
        assert_eq!(second.records.len(), 1);
        assert!(second.done);
        assert_eq!(second.records[0].registry_key, "31_person_tag");
    }

    #[test]
    fn exports_a_feed_item_from_scalar_columns_without_whole_record_storage() {
        let connection = fixture();
        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library-1', 1, 'epoch-1', 7, 1000);",
                [],
            )
            .expect("meta");
        connection
            .execute(
                "INSERT INTO library_feed_items
                 (global_id, platform, content_type, captured_at, published_at,
                  author_id, author_handle, author_display_name, content_text,
                  hidden, saved, archived, updated_at)
                 VALUES ('saved:item-1', 'saved', 'article', 900, 800,
                         'author-1', 'ada', 'Ada', 'bounded text',
                         0, 1, 0, 1000);",
                [],
            )
            .expect("item");
        let page = export_normalized_checkpoint_page_v2(
            &connection,
            &NormalizedCheckpointExportRequestV2::default(),
        )
        .expect("page");
        let item = page
            .records
            .iter()
            .find(|record| record.registry_key == "10_feed_item")
            .expect("feed item record");
        assert_eq!(item.primary_key, Value::String("saved:item-1".into()));
        assert_eq!(item.payload["saved"], Value::Bool(true));
        assert_eq!(item.payload["contentText"], "bounded text");
        assert!(item.payload.get("globalId").is_none());
    }

    #[test]
    fn exports_and_reassembles_a_maximum_legal_value_as_bounded_records() {
        let connection = fixture();
        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library-1', 1, 'epoch-1', 7, 1000);",
                [],
            )
            .expect("meta");
        let original: Vec<u8> = (0..4_194_304)
            .map(|index| ((index * 31 + 17) % 251) as u8)
            .collect();
        let content_records =
            split_content_records_v1(&original, "application/octet-stream").expect("split records");
        let descriptor = &content_records[0];
        connection
            .execute(
                "INSERT INTO library_blobs
                 (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
                 VALUES (?1, ?2, ?3, ?4, ?5);",
                params![
                    descriptor.primary_key.as_str().expect("digest"),
                    i64::try_from(original.len()).expect("length"),
                    i64::try_from(CONTENT_CHUNK_BYTES).expect("chunk bytes"),
                    i64::try_from(content_records.len() - 1).expect("chunk count"),
                    "application/octet-stream"
                ],
            )
            .expect("descriptor");
        for (index, record) in content_records.iter().skip(1).enumerate() {
            let encoded = record.payload["bytesBase64"].as_str().expect("base64");
            let bytes = BASE64.decode(encoded).expect("decode");
            connection
                .execute(
                    "INSERT INTO library_blob_chunks
                     (content_digest, chunk_index, chunk_digest, bytes)
                     VALUES (?1, ?2, ?3, ?4);",
                    params![
                        descriptor.primary_key.as_str().expect("digest"),
                        i64::try_from(index).expect("index"),
                        record.payload["chunkContentDigest"]
                            .as_str()
                            .expect("chunk digest"),
                        bytes
                    ],
                )
                .expect("chunk");
        }
        let mut exported = Vec::new();
        let mut after = None;
        loop {
            let page = export_normalized_checkpoint_page_v2(
                &connection,
                &NormalizedCheckpointExportRequestV2 {
                    after,
                    maximum_records: 11,
                    ..Default::default()
                },
            )
            .expect("page");
            assert!(
                serde_json::to_vec(&page).expect("page bytes").len()
                    <= NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES
            );
            assert!(page.records.iter().all(|record| {
                encode_canonical_value(
                    &serde_json::to_value(record).expect("record value"),
                    CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
                )
                .is_ok()
            }));
            exported.extend(page.records);
            if page.done {
                break;
            }
            after = page.next_cursor;
        }
        assert!(exported
            .iter()
            .all(|record| !record.registry_key.contains("shell")));
        let content: Vec<_> = exported
            .into_iter()
            .filter(|record| record.registry_key.starts_with('b'))
            .collect();
        assert_eq!(
            reassemble_content_records_v1(&content).expect("reassemble"),
            original
        );
    }
}
