//! Source-fenced annotation text. Physical bytes never leave this boundary unverified.
use crate::normalized_query::{query_source, NormalizedFeedPageSourceV1};
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::SQLITE_QUERY_PROGRAMS;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) type RangeReader<'a> = dyn Fn(&str, usize) -> Result<Vec<u8>, String> + 'a;
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationTextRequest {
    pub schema_version: u32,
    pub global_id: String,
    pub annotation_index: i64,
    pub expected_source: NormalizedFeedPageSourceV1,
    pub offset_bytes: i64,
    pub limit_bytes: i64,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationTextResponse {
    pub query_id: &'static str,
    pub schema_version: u32,
    pub global_id: String,
    pub annotation_index: i64,
    pub source: NormalizedFeedPageSourceV1,
    pub state: &'static str,
    pub text: Option<AnnotationText>,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationText {
    pub blob_digest: Option<String>,
    pub content_length: usize,
    pub start_offset: usize,
    pub end_offset: usize,
    pub bytes_base64: String,
}
fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}
fn hash(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
    hash.update(bytes);
    crate::lower_hex(&hash.finalize())
}
pub(crate) fn check_source(
    connection: &Connection,
    source: &NormalizedFeedPageSourceV1,
) -> Result<(), NormalizedSqliteError> {
    crate::normalized_query_control::check_current_query().map_err(invalid)?;
    let (generation, revision) = query_source(connection)?;
    if generation != source.generation_id
        || revision != source.projection_revision
        || revision != source.transition_sequence
    {
        return Err(invalid("CURSOR_STALE"));
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Target {
    text: Option<String>,
    #[serde(rename = "blobDigest")]
    digest: Option<String>,
    #[serde(rename = "byteLength")]
    length: Option<i64>,
    #[serde(rename = "storageLayout")]
    layout: Option<String>,
    #[serde(rename = "chunkCount")]
    chunks: Option<i64>,
    #[serde(rename = "rangeCount")]
    ranges: Option<i64>,
    #[serde(rename = "rangeRoot")]
    root: Option<String>,
    policy: String,
}
struct Range {
    index: i64,
    offset: i64,
    length: i64,
    digest: String,
    key: Option<String>,
    kind: Option<String>,
}

pub(crate) fn query(
    connection: &mut Connection,
    request: AnnotationTextRequest,
    read: Option<&RangeReader<'_>>,
) -> Result<AnnotationTextResponse, NormalizedSqliteError> {
    if request.schema_version != 1
        || request.global_id.is_empty()
        || request.global_id.len() > 2048
        || !(0..64).contains(&request.annotation_index)
        || !(0..=65536).contains(&request.offset_bytes)
        || !(1..=65536).contains(&request.limit_bytes)
    {
        return Err(invalid("annotation text request is invalid"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|p| p.query_id == "item_annotation_text_range_v1")
        .ok_or(invalid("annotation text program missing"))?;
    let transaction = connection.transaction()?;
    check_source(&transaction, &request.expected_source)?;
    let count: i64 =
        transaction.query_row(program.count_sql, [&request.global_id], |row| row.get(0))?;
    let target: Option<Target> = transaction
        .query_row(
            program.sql,
            params![request.global_id, request.annotation_index],
            |row| {
                crate::normalized_query::decode_generated_query_row(
                    row,
                    "item_annotation_text_range_v1",
                )
            },
        )
        .optional()?;
    let mut result = AnnotationTextResponse {
        query_id: "item_annotation_text_range_v1",
        schema_version: 1,
        global_id: request.global_id.clone(),
        annotation_index: request.annotation_index,
        source: request.expected_source.clone(),
        state: "missing",
        text: None,
    };
    let verify = || -> Result<(), NormalizedSqliteError> {
        macro_rules! refuse {
            ($state:literal) => {{
                result.state = $state;
                return Ok(());
            }};
        }
        if count > 64 {
            refuse!("oversized");
        }
        let Some(target) = target else {
            return Ok(());
        };
        if target.policy == "excluded" {
            refuse!("excluded");
        }
        let Some(length) = target.length else {
            refuse!("unavailable");
        };
        if length < 1 {
            refuse!("invalid_text");
        }
        if length > 65536 {
            refuse!("oversized");
        }
        let bytes = if let Some(text) = target.text {
            if target.digest.is_some() || text.len() as i64 != length {
                refuse!("corrupt");
            }
            text.into_bytes()
        } else {
            let Some(ref digest) = target.digest else {
                refuse!("corrupt");
            };
            let mut bytes = Vec::with_capacity(length as usize);
            match target.layout.as_deref() {
                Some("inline_chunks") => {
                    let sql = program
                        .variants
                        .iter()
                        .find(|p| p.variant_id == "chunks")
                        .ok_or(invalid("annotation chunks program missing"))?
                        .sql;
                    let chunks = transaction
                        .prepare(sql)?
                        .query_map([digest], |row| {
                            Ok((
                                row.get::<_, i64>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, Vec<u8>>(2)?,
                            ))
                        })?
                        .collect::<Result<Vec<_>, _>>()?;
                    if target.chunks != Some(1) || target.ranges != Some(0) || chunks.len() != 1 {
                        refuse!("corrupt");
                    }
                    let (index, chunk_digest, chunk) = &chunks[0];
                    if *index != 0 || chunk.len() as i64 != length || hash(chunk) != *chunk_digest {
                        refuse!("corrupt");
                    }
                    bytes.extend_from_slice(chunk);
                }
                Some("authenticated_ranges") => {
                    let count = target.ranges.unwrap_or(0);
                    if count > 64 {
                        refuse!("oversized");
                    }
                    if count < 1 || target.chunks != Some(0) {
                        refuse!("corrupt");
                    }
                    let sql = program
                        .variants
                        .iter()
                        .find(|p| p.variant_id == "ranges")
                        .ok_or(invalid("annotation ranges program missing"))?
                        .sql;
                    let ranges = transaction
                        .prepare(sql)?
                        .query_map([digest], |row| {
                            Ok(Range {
                                index: row.get(0)?,
                                offset: row.get(1)?,
                                length: row.get(2)?,
                                digest: row.get(3)?,
                                key: row.get(4)?,
                                kind: row.get(5)?,
                            })
                        })?
                        .collect::<Result<Vec<_>, _>>()?;
                    if ranges.len() as i64 != count {
                        refuse!("corrupt");
                    }
                    let mut root = Sha256::new();
                    root.update(b"freed.library-core.v1/digest-records/content-range-map\0");
                    root.update(digest.as_bytes());
                    root.update((length as u64).to_be_bytes());
                    root.update((count as u64).to_be_bytes());
                    let mut offset = 0;
                    for (index, range) in ranges.iter().enumerate() {
                        if range.index != index as i64
                            || range.offset != offset
                            || range.length < 1
                            || range.length > length - offset
                        {
                            refuse!("corrupt");
                        }
                        root.update((range.index as u64).to_be_bytes());
                        root.update((offset as u64).to_be_bytes());
                        root.update((range.length as u64).to_be_bytes());
                        root.update(range.digest.as_bytes());
                        offset += range.length;
                    }
                    if offset != length || Some(crate::lower_hex(&root.finalize())) != target.root {
                        refuse!("corrupt");
                    }
                    let Some(read) = read else {
                        refuse!("unavailable");
                    };
                    for range in ranges {
                        check_source(&transaction, &request.expected_source)?;
                        if range.kind.as_deref() != Some("content_vault") {
                            refuse!("unavailable");
                        }
                        let Some(key) = range.key else {
                            refuse!("unavailable");
                        };
                        let part = match read(&key, range.length as usize) {
                            Ok(part) => part,
                            Err(_) => {
                                refuse!("unavailable");
                            }
                        };
                        if part.len() as i64 != range.length || hash(&part) != range.digest {
                            refuse!("corrupt");
                        }
                        bytes.extend_from_slice(&part);
                    }
                }
                _ => {
                    refuse!("corrupt");
                }
            }
            if bytes.len() as i64 != length || hash(&bytes) != *digest {
                refuse!("corrupt");
            }
            bytes
        };
        if std::str::from_utf8(&bytes).is_err() {
            refuse!("invalid_text");
        }
        if request.offset_bytes > length {
            return Err(invalid("annotation text offset is outside the quote"));
        }
        let start = request.offset_bytes as usize;
        let end = bytes.len().min(start + request.limit_bytes as usize);
        result.state = "ready";
        result.text = Some(AnnotationText {
            blob_digest: target.digest,
            content_length: bytes.len(),
            start_offset: start,
            end_offset: end,
            bytes_base64: STANDARD.encode(&bytes[start..end]),
        });
        Ok(())
    };
    verify()?;
    transaction.commit()?;
    check_source(connection, &request.expected_source)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_normalized_schema_v1;
    fn seed(connection: &Connection, bytes: &[u8], ranged: bool) -> String {
        install_normalized_schema_v1(connection).unwrap();
        connection.execute_batch(&format!("INSERT INTO library_meta(singleton_id,library_id,schema_version,authority_epoch,source_revision,updated_at) VALUES(1,'{}',1,'epoch',0,0); INSERT INTO library_materialization_generation SELECT 1,library_id FROM library_meta;
            INSERT INTO library_feed_items(global_id,platform,content_type,captured_at,published_at,author_id,author_handle,author_display_name,hidden,saved,archived,updated_at) VALUES('item','saved','article',0,0,'a','a','a',0,1,0,0);", "a".repeat(64))).unwrap();
        seed_quote(connection, bytes, ranged, "item")
    }
    fn seed_quote(connection: &Connection, bytes: &[u8], ranged: bool, item: &str) -> String {
        let digest = hash(bytes);
        if ranged {
            let mut root = Sha256::new();
            root.update(b"freed.library-core.v1/digest-records/content-range-map\0");
            root.update(digest.as_bytes());
            for n in [bytes.len() as u64, 1, 0, 0, bytes.len() as u64] {
                root.update(n.to_be_bytes());
            }
            root.update(digest.as_bytes());
            connection.execute("INSERT INTO library_blobs(content_digest,byte_length,storage_layout,chunk_bytes,chunk_count,range_count,range_granularity,range_index_root_digest,rendition_id,cloud_availability_commitment,media_type) VALUES(?1,?2,'authenticated_ranges',0,0,1,?2,?3,'text',?1,'text/plain');", params![digest,bytes.len() as i64,crate::lower_hex(&root.finalize())]).unwrap();
            connection
                .execute(
                    "INSERT INTO library_content_ranges VALUES(?1,0,0,?2,?1);",
                    params![digest, bytes.len() as i64],
                )
                .unwrap();
            connection.execute("INSERT INTO library_device_content_ranges VALUES(?1,0,?2,?1,'content_vault','quote.bin',1);",params![digest,bytes.len() as i64]).unwrap();
        } else {
            connection.execute("INSERT INTO library_blobs(content_digest,byte_length,chunk_bytes,chunk_count,media_type) VALUES(?1,?2,65536,1,'text/plain');",params![digest,bytes.len() as i64]).unwrap();
            connection
                .execute(
                    "INSERT INTO library_blob_chunks VALUES(?1,0,?1,?2);",
                    params![digest, bytes],
                )
                .unwrap();
        }
        connection
            .execute(
                "INSERT INTO library_feed_item_highlights VALUES(?1,7,NULL,?2,'keep',1);",
                params![item, digest],
            )
            .unwrap();
        digest
    }
    fn request() -> serde_json::Value {
        serde_json::json!({"queryId":"item_annotation_text_range_v1","schemaVersion":1,"globalId":"item","annotationIndex":0,"expectedSource":{"generationId":"a".repeat(64),"projectionRevision":0,"transitionSequence":0},"offsetBytes":0,"limitBytes":65536})
    }
    #[cfg(unix)]
    #[test]
    fn signed_note_edit_survives_sqlite_vault_restart_and_retains_exact_retry() {
        use crate::normalized_mutation::accept_normalized_operation_transaction_with_source_v1;
        use crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload;
        use std::{
            fs,
            os::{fd::OwnedFd, unix::fs::PermissionsExt},
            sync::Arc,
            time::{Duration, Instant},
        };
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("signed.sqlite");
        let vault_path = dir.path().join("vault");
        fs::create_dir(&vault_path).unwrap();
        fs::set_permissions(&vault_path, fs::Permissions::from_mode(0o700)).unwrap();
        let bytes = "\u{feff}Exact\r\ne\u{301}\0🦉".as_bytes();
        let (fixture, key, enrollment) = crate::normalized_mutation::tests::fixture();
        fixture
            .execute(
                "INSERT INTO library_materialization_generation VALUES(1,?1)",
                ["a".repeat(64)],
            )
            .unwrap();
        let digest = seed_quote(&fixture, bytes, true, "rss:item:1");
        fixture
            .execute_batch("INSERT INTO library_feed_item_tags VALUES('rss:item:1','alpha');")
            .unwrap();
        fixture
            .execute(
                "INSERT INTO library_feed_item_tags VALUES('rss:item:1',?1)",
                ["omega\0é🦉"],
            )
            .unwrap();
        fixture.execute("INSERT INTO library_feed_item_highlights VALUES('rss:item:1',8,'Second quote',NULL,'second',2)", []).unwrap();
        fixture.execute("INSERT INTO library_feed_item_highlights VALUES('rss:item:1',9,?1,NULL,'old note',3)", ["\u{2063}"]).unwrap();
        fixture
            .backup(rusqlite::DatabaseName::Main, &db_path, None)
            .unwrap();
        drop(fixture);
        let file = vault_path.join("quote.bin");
        fs::write(&file, bytes).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        let read = |request: serde_json::Value| {
            let vault = crate::library_core_content_vault::LibraryCoreContentVault::from_directory(
                OwnedFd::from(fs::File::open(&vault_path).unwrap()),
            )
            .unwrap();
            crate::normalized_query_control::query_with_content_control(
                Connection::open(&db_path).unwrap(),
                request,
                Arc::new(crate::NormalizedQueryControl::new(
                    Instant::now() + Duration::from_secs(30),
                )),
                &|key, length| vault.read_annotation_object(key, length),
            )
            .unwrap()
        };
        let original_request = serde_json::json!({"queryId":"item_annotations_v1","schemaVersion":1,"globalId":"rss:item:1"});
        let original = read(original_request.clone());
        let source: crate::normalized_query::NormalizedFeedPageSourceV1 =
            serde_json::from_value(original["source"].clone()).unwrap();
        let mut range_request = request();
        range_request["globalId"] = "rss:item:1".into();
        range_request["expectedSource"] = original["source"].clone();
        assert_eq!(
            STANDARD
                .decode(
                    read(range_request.clone())["text"]["bytesBase64"]
                        .as_str()
                        .unwrap()
                )
                .unwrap(),
            bytes
        );
        let note = "Exact note\r\ne\u{301}\0🦉";
        let mut highlights = original["highlights"].as_array().unwrap().clone();
        highlights[2] = serde_json::json!({"createdAt":3000,"text":"\u{2063}","textBlobDigest":null,"note":note});
        let payload = serde_json::json!({"assigned_at_ms":3000,"highlights":highlights,"tags":original["tags"]});
        let frames = signed_envelopes_from_tip_with_payload(
            &key,
            &enrollment,
            "tx:annotation:restart",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 3000)],
            "feed_item_annotations_replace",
            Some(&payload),
        );
        let mut db = Connection::open(&db_path).unwrap();
        crate::normalized_local_annotations::open_owned(&mut db).unwrap();
        let receipt = accept_normalized_operation_transaction_with_source_v1(
            &mut db,
            &frames,
            &key,
            3000,
            Some(&source),
        )
        .unwrap();
        drop(db);
        let persisted = read(original_request.clone());
        let inspect = Connection::open(&db_path).unwrap();
        eprintln!("stored note hex: {}", inspect.query_row("SELECT hex(note) FROM library_feed_item_highlights WHERE global_id='rss:item:1' AND ordinal=2", [], |r| r.get::<_, String>(0)).unwrap());
        eprintln!("signed note hex: {}", crate::lower_hex(note.as_bytes()));
        drop(inspect);
        assert_eq!(persisted["highlights"], payload["highlights"]);
        assert_eq!(persisted["tags"], original["tags"]);
        assert_eq!(persisted["highlights"][0]["textBlobDigest"], digest);
        range_request["expectedSource"] = persisted["source"].clone();
        assert_eq!(
            STANDARD
                .decode(read(range_request)["text"]["bytesBase64"].as_str().unwrap())
                .unwrap(),
            bytes
        );
        let mut db = Connection::open(&db_path).unwrap();
        let before = db.total_changes();
        assert_eq!(
            accept_normalized_operation_transaction_with_source_v1(
                &mut db,
                &frames,
                &key,
                3100,
                Some(&source)
            )
            .unwrap(),
            receipt
        );
        assert_eq!(db.total_changes(), before);
        let stale_source: crate::normalized_query::NormalizedFeedPageSourceV1 =
            serde_json::from_value(persisted["source"].clone()).unwrap();
        let next = signed_envelopes_from_tip_with_payload(
            &key,
            &enrollment,
            "tx:annotation:stale",
            2,
            Some(&receipt.committed_operation_id),
            &receipt.committed_chain_digest,
            &[("rss:item:1", 4000)],
            "feed_item_annotations_replace",
            Some(&payload),
        );
        // A separate SQLite connection advances canonical source after rendering/signing.
        let remote = Connection::open(&db_path).unwrap();
        remote.execute_batch("BEGIN IMMEDIATE; UPDATE library_meta SET source_revision=source_revision+1; UPDATE library_change_state SET revision=revision+1; COMMIT;").unwrap();
        drop(remote);
        let before = db.total_changes();
        assert!(accept_normalized_operation_transaction_with_source_v1(
            &mut db,
            &next,
            &key,
            4000,
            Some(&stale_source)
        )
        .unwrap_err()
        .to_string()
        .contains("LOCAL_ADMISSION_SOURCE_STALE"));
        assert_eq!(db.total_changes(), before);
        assert_eq!(
            accept_normalized_operation_transaction_with_source_v1(
                &mut db,
                &frames,
                &key,
                4100,
                Some(&source)
            )
            .unwrap(),
            receipt
        );
        assert_eq!(db.total_changes(), before);
        drop(db);
        let unchanged = read(original_request);
        assert_eq!(unchanged["highlights"], persisted["highlights"]);
        assert_eq!(unchanged["tags"], persisted["tags"]);
    }

    #[test]
    fn registered_annotation_fields_preserve_exact_bytes_and_refuse_invalid_values() {
        for (table, column, limit, output) in [
            ("library_feed_item_highlights", "note", 8192, "note"),
            ("library_feed_item_tags", "tag", 512, "tag"),
            ("library_feed_item_highlights", "text_value", 65536, "text"),
        ] {
            let mut db = Connection::open_in_memory().unwrap();
            seed(&db, b"quote", false);
            db.execute(
                "INSERT INTO library_feed_item_tags VALUES('item','tag')",
                [],
            )
            .unwrap();
            if column == "text_value" {
                db.execute("UPDATE library_feed_item_highlights SET text_blob_digest=NULL,text_value='quote'", []).unwrap();
            }
            let exact = "\u{feff}Exact\r\ne\u{301}\0🦉";
            let boundary = format!("{exact}{}", "a".repeat(limit - exact.len()));
            let request = serde_json::json!({"queryId":"item_annotations_v1","schemaVersion":1,"globalId":"item"});
            for value in [exact, boundary.as_str()] {
                db.execute(
                    &format!("UPDATE {table} SET {column}=CAST(?1 AS TEXT)"),
                    [value.as_bytes()],
                )
                .unwrap();
                let result = crate::query_normalized_json_v1(&mut db, request.clone()).unwrap();
                let actual = if output == "tag" {
                    &result["tags"][0]
                } else {
                    &result["highlights"][0][output]
                };
                assert_eq!(actual, value);
            }
            // Model corrupt storage without weakening the production schema.
            for invalid in [
                format!("{boundary}a").into_bytes(),
                format!("{boundary}é").into_bytes(),
                vec![0x61, 0, 0xff],
            ] {
                db.execute_batch("PRAGMA ignore_check_constraints=ON;")
                    .unwrap();
                db.execute(
                    &format!("UPDATE {table} SET {column}=CAST(?1 AS TEXT)"),
                    [invalid],
                )
                .unwrap();
                db.execute_batch("PRAGMA ignore_check_constraints=OFF;")
                    .unwrap();
                assert!(crate::query_normalized_json_v1(&mut db, request.clone()).is_err());
            }
            db.execute(&format!("UPDATE {table} SET {column}=''"), [])
                .unwrap();
            let result = crate::query_normalized_json_v1(&mut db, request.clone());
            if column == "note" {
                assert_eq!(result.unwrap()["highlights"][0]["note"], "");
                db.execute("UPDATE library_feed_item_highlights SET note=NULL", [])
                    .unwrap();
                assert!(
                    crate::query_normalized_json_v1(&mut db, request).unwrap()["highlights"][0]
                        ["note"]
                        .is_null()
                );
            } else {
                assert!(result.is_err());
            }
        }
    }

    #[test]
    fn registered_inline_annotation_authenticates_entire_quote_and_source() {
        let mut db = Connection::open_in_memory().unwrap();
        let bytes = "\u{feff}Exact\r\ne\u{301}\0🦉".as_bytes();
        let digest = seed(&db, bytes, false);
        let original: String = db
            .query_row(
                "SELECT text_blob_digest FROM library_feed_item_highlights",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let result = crate::query_normalized_json_v1(&mut db, request()).unwrap();
        assert_eq!(result["state"], "ready");
        assert_eq!(
            STANDARD
                .decode(result["text"]["bytesBase64"].as_str().unwrap())
                .unwrap(),
            bytes
        );
        let mut partial = request();
        partial["limitBytes"] = 1.into();
        db.execute(
            "UPDATE library_blob_chunks SET bytes=?1",
            [vec![65u8; bytes.len()]],
        )
        .unwrap();
        assert_eq!(
            crate::query_normalized_json_v1(&mut db, partial).unwrap()["state"],
            "corrupt"
        );
        assert_eq!(original, digest);
        let mut stale = request();
        stale["expectedSource"]["transitionSequence"] = 1.into();
        assert!(crate::query_normalized_json_v1(&mut db, stale).is_err());
        let mut extra = request();
        extra["storageKey"] = "foreign".into();
        assert!(crate::query_normalized_json_v1(&mut db, extra).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn registered_vault_annotation_reopens_real_sqlite_and_private_file() {
        use std::{
            fs,
            os::{fd::OwnedFd, unix::fs::PermissionsExt},
            sync::Arc,
            time::{Duration, Instant},
        };
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("library.sqlite");
        let vault_path = dir.path().join("vault");
        fs::create_dir(&vault_path).unwrap();
        fs::set_permissions(&vault_path, fs::Permissions::from_mode(0o700)).unwrap();
        let bytes = "\u{feff}Exact\r\ne\u{301}\0🦉".as_bytes();
        let db = Connection::open(&db_path).unwrap();
        let digest = seed(&db, bytes, true);
        drop(db);
        let file = vault_path.join("quote.bin");
        fs::write(&file, bytes).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        let run = |request: serde_json::Value| {
            let vault = crate::library_core_content_vault::LibraryCoreContentVault::from_directory(
                OwnedFd::from(fs::File::open(&vault_path).unwrap()),
            )
            .unwrap();
            let connection = Connection::open(&db_path).unwrap();
            crate::normalized_query_control::query_with_content_control(
                connection,
                request,
                Arc::new(crate::NormalizedQueryControl::new(
                    Instant::now() + Duration::from_secs(30),
                )),
                &|key, length| vault.read_annotation_object(key, length),
            )
            .unwrap()
        };
        let result = run(request());
        assert_eq!(result["state"], "ready");
        assert_eq!(
            STANDARD
                .decode(result["text"]["bytesBase64"].as_str().unwrap())
                .unwrap(),
            bytes
        );
        let mut partial = request();
        partial["limitBytes"] = 1.into();
        let mut corrupt = bytes.to_vec();
        *corrupt.last_mut().unwrap() ^= 1;
        fs::write(&file, corrupt).unwrap();
        assert_eq!(run(partial)["state"], "corrupt");
        fs::remove_file(&file).unwrap();
        assert_eq!(run(request())["state"], "unavailable");
        let db = Connection::open(&db_path).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT text_blob_digest FROM library_feed_item_highlights",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            digest
        );
        assert_eq!(
            db.query_row("SELECT source_revision FROM library_meta", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn source_change_on_another_connection_cannot_escape_snapshot() {
        let directory = tempfile::TempDir::new().unwrap();
        let path = directory.path().join("library.sqlite");
        let mut reader = Connection::open(&path).unwrap();
        reader.pragma_update(None, "journal_mode", "WAL").unwrap();
        let bytes = b"exact quote";
        seed(&reader, bytes, true);
        let writer = Connection::open(&path).unwrap();
        let error = crate::normalized_query::query_normalized_json_with_content(
            &mut reader,
            request(),
            Some(&|_, _| {
                writer
                    .execute_batch("BEGIN IMMEDIATE; UPDATE library_meta SET source_revision = 1; UPDATE library_change_state SET revision = 1; COMMIT;")
                    .unwrap();
                Ok(bytes.to_vec())
            }),
        )
        .unwrap_err();
        assert!(error.to_string().contains("CURSOR_STALE"));
        assert!(reader.is_autocommit());
    }
}
