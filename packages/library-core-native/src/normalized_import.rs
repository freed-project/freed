use crate::library_core_canonical::decode_canonical_value;
use crate::library_core_hash::lower_hex;
use crate::normalized_checkpoint::{
    checked_record, decode_fractional_payload, NormalizedCheckpointRecordV2,
};
use crate::normalized_sqlite::NormalizedSqliteError;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const CHECKPOINT_DIGEST_PREFIX: &[u8] =
    b"freed.library-core.v2/digest-records/normalized-checkpoint\0";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedCheckpointActivationReceiptV2 {
    pub stage_id: String,
    pub library_id: String,
    pub authority_epoch: String,
    pub source_revision: u64,
    pub record_count: usize,
    pub canonical_bytes: usize,
    pub checkpoint_digest: String,
}

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn record_from_canonical(
    bytes: &[u8],
) -> Result<NormalizedCheckpointRecordV2, NormalizedSqliteError> {
    let value = decode_canonical_value(
        bytes,
        crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
    )
    .map_err(|_| invalid("staged checkpoint record canonical bytes are invalid"))?;
    let record: NormalizedCheckpointRecordV2 = serde_json::from_value(value.into_value())
        .map_err(|_| invalid("staged checkpoint record shape is invalid"))?;
    let validated = checked_record(
        &record.registry_key,
        record.primary_key.clone(),
        record.payload.clone(),
    )?;
    if validated != record {
        return Err(invalid(
            "staged checkpoint record version identity is invalid",
        ));
    }
    Ok(record)
}

fn key_text(record: &NormalizedCheckpointRecordV2) -> Result<&str, NormalizedSqliteError> {
    record
        .primary_key
        .as_str()
        .ok_or(invalid("checkpoint primary key must be text"))
}

fn key_array(
    record: &NormalizedCheckpointRecordV2,
    length: usize,
) -> Result<&[Value], NormalizedSqliteError> {
    let values = record
        .primary_key
        .as_array()
        .ok_or(invalid("checkpoint primary key must be an array"))?;
    if values.len() != length {
        return Err(invalid("checkpoint primary key has the wrong length"));
    }
    Ok(values)
}

fn payload_json(record: &NormalizedCheckpointRecordV2) -> Result<String, NormalizedSqliteError> {
    let mut payload = record.payload.clone();
    decode_fractional_payload(&record.registry_key, &mut payload)?;
    serde_json::to_string(&payload).map_err(|error| {
        NormalizedSqliteError::Transport(format!("checkpoint payload encoding failed: {error}"))
    })
}

fn text_part(value: &Value) -> Result<&str, NormalizedSqliteError> {
    value
        .as_str()
        .ok_or(invalid("checkpoint primary key text part is invalid"))
}

fn integer_part(value: &Value) -> Result<i64, NormalizedSqliteError> {
    value
        .as_u64()
        .and_then(|number| i64::try_from(number).ok())
        .ok_or(invalid("checkpoint primary key integer part is invalid"))
}

fn require_payload_value(
    record: &NormalizedCheckpointRecordV2,
    field: &str,
    expected: &Value,
) -> Result<(), NormalizedSqliteError> {
    if record.payload.get(field) != Some(expected) {
        return Err(invalid(
            "checkpoint payload identity does not match its primary key",
        ));
    }
    Ok(())
}

fn apply_record(
    transaction: &Transaction<'_>,
    record: &NormalizedCheckpointRecordV2,
) -> Result<(), NormalizedSqliteError> {
    let payload = payload_json(record)?;
    match record.registry_key.as_str() {
        "00_checkpoint_header" => {
            if record.primary_key != Value::String("checkpoint".into()) {
                return Err(invalid("checkpoint header primary key is invalid"));
            }
            let library_id = record.payload["libraryId"]
                .as_str()
                .ok_or(invalid("checkpoint header Library identity is invalid"))?;
            let authority_epoch = record.payload["authorityEpoch"]
                .as_str()
                .ok_or(invalid("checkpoint header authority epoch is invalid"))?;
            let source_revision = record.payload["sourceRevision"]
                .as_u64()
                .ok_or(invalid("checkpoint header source revision is invalid"))?;
            let expected_checkpoint_id =
                format!("{library_id}:{authority_epoch}:{source_revision}");
            if record.payload["schemaVersion"].as_u64()
                != Some(u64::from(
                    crate::sqlite_contract_generated::SQLITE_SCHEMA_VERSION,
                ))
                || record.payload["checkpointId"].as_str() != Some(expected_checkpoint_id.as_str())
            {
                return Err(invalid("checkpoint header version identity is invalid"));
            }
            transaction.execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 SELECT 1, json_extract(?1, '$.libraryId'), json_extract(?1, '$.schemaVersion'),
                        json_extract(?1, '$.authorityEpoch'), json_extract(?1, '$.sourceRevision'),
                        json_extract(?1, '$.createdAtMs');",
                [&payload],
            )?;
        }
        "10_feed_item" => {
            transaction.execute(
                "INSERT INTO library_feed_items (
                   global_id, platform, content_type, captured_at, published_at,
                   author_id, author_handle, author_display_name, author_avatar_url,
                   content_text, content_text_blob_digest, link_url, link_title, link_description,
                   engagement_likes, engagement_reposts, engagement_comments, engagement_views,
                   location_name, location_lat, location_lng, location_url, location_source,
                   time_range_starts_at, time_range_ends_at, time_range_kind,
                   rss_feed_url, rss_feed_title, rss_site_url, fb_group_id, fb_group_name, fb_group_url,
                   preserved_text, preserved_text_blob_digest, preserved_author, preserved_published_at,
                   preserved_word_count, preserved_reading_time, preserved_at,
                   hidden, read_at, saved, saved_at, archived, archived_at, liked, liked_at,
                   liked_synced_at, seen_synced_at, priority, priority_computed_at, source_url,
                   sample_batch_id, sample_generated_at, sample_generator_version, updated_at
                 ) SELECT
                   ?1, json_extract(?2, '$.platform'), json_extract(?2, '$.contentType'),
                   json_extract(?2, '$.capturedAt'), json_extract(?2, '$.publishedAt'),
                   json_extract(?2, '$.authorId'), json_extract(?2, '$.authorHandle'),
                   json_extract(?2, '$.authorDisplayName'), json_extract(?2, '$.authorAvatarUrl'),
                   json_extract(?2, '$.contentText'), json_extract(?2, '$.contentTextBlobDigest'),
                   json_extract(?2, '$.linkUrl'), json_extract(?2, '$.linkTitle'),
                   json_extract(?2, '$.linkDescription'), json_extract(?2, '$.engagementLikes'),
                   json_extract(?2, '$.engagementReposts'), json_extract(?2, '$.engagementComments'),
                   json_extract(?2, '$.engagementViews'), json_extract(?2, '$.locationName'),
                   json_extract(?2, '$.locationLat'), json_extract(?2, '$.locationLng'),
                   json_extract(?2, '$.locationUrl'), json_extract(?2, '$.locationSource'),
                   json_extract(?2, '$.timeRangeStartsAt'), json_extract(?2, '$.timeRangeEndsAt'),
                   json_extract(?2, '$.timeRangeKind'), json_extract(?2, '$.rssFeedUrl'),
                   json_extract(?2, '$.rssFeedTitle'), json_extract(?2, '$.rssSiteUrl'),
                   json_extract(?2, '$.fbGroupId'), json_extract(?2, '$.fbGroupName'),
                   json_extract(?2, '$.fbGroupUrl'), json_extract(?2, '$.preservedText'),
                   json_extract(?2, '$.preservedTextBlobDigest'), json_extract(?2, '$.preservedAuthor'),
                   json_extract(?2, '$.preservedPublishedAt'), json_extract(?2, '$.preservedWordCount'),
                   json_extract(?2, '$.preservedReadingTime'), json_extract(?2, '$.preservedAt'),
                   json_extract(?2, '$.hidden'), json_extract(?2, '$.readAt'),
                   json_extract(?2, '$.saved'), json_extract(?2, '$.savedAt'),
                   json_extract(?2, '$.archived'), json_extract(?2, '$.archivedAt'),
                   json_extract(?2, '$.liked'), json_extract(?2, '$.likedAt'),
                   json_extract(?2, '$.likedSyncedAt'), json_extract(?2, '$.seenSyncedAt'),
                   json_extract(?2, '$.priority'), json_extract(?2, '$.priorityComputedAt'),
                   json_extract(?2, '$.sourceUrl'), json_extract(?2, '$.sampleBatchId'),
                   json_extract(?2, '$.sampleGeneratedAt'), json_extract(?2, '$.sampleGeneratorVersion'),
                   json_extract(?2, '$.updatedAt');",
                params![key_text(record)?, payload],
            )?;
        }
        "11_feed_item_media" => {
            let key = key_array(record, 2)?;
            transaction.execute(
                "INSERT INTO library_feed_item_media
                 (global_id, ordinal, source_url, media_type, blob_content_digest)
                 SELECT ?1, ?2, json_extract(?3, '$.sourceUrl'),
                        json_extract(?3, '$.mediaType'), json_extract(?3, '$.blobContentDigest');",
                params![text_part(&key[0])?, integer_part(&key[1])?, payload],
            )?;
        }
        "12_feed_item_topic" => {
            let key = key_array(record, 2)?;
            require_payload_value(record, "topic", &key[1])?;
            transaction.execute(
                "INSERT INTO library_feed_item_topics (global_id, topic) VALUES (?1, ?2);",
                params![text_part(&key[0])?, text_part(&key[1])?],
            )?;
        }
        "13_feed_item_tag" => {
            let key = key_array(record, 2)?;
            require_payload_value(record, "tag", &key[1])?;
            transaction.execute(
                "INSERT INTO library_feed_item_tags (global_id, tag) VALUES (?1, ?2);",
                params![text_part(&key[0])?, text_part(&key[1])?],
            )?;
        }
        "14_feed_item_highlight" => {
            let key = key_array(record, 2)?;
            transaction.execute(
                "INSERT INTO library_feed_item_highlights
                 (global_id, ordinal, text_value, text_blob_digest, note, created_at)
                 SELECT ?1, ?2, json_extract(?3, '$.text'), json_extract(?3, '$.textBlobDigest'),
                        json_extract(?3, '$.note'), json_extract(?3, '$.createdAt');",
                params![text_part(&key[0])?, integer_part(&key[1])?, payload],
            )?;
        }
        "15_feed_item_signal" => {
            transaction.execute(
                "INSERT INTO library_feed_item_signals (global_id, version, method, inferred_at)
                 SELECT ?1, json_extract(?2, '$.version'), json_extract(?2, '$.method'),
                        json_extract(?2, '$.inferredAt');",
                params![key_text(record)?, payload],
            )?;
        }
        "16_feed_item_signal_score" => {
            let key = key_array(record, 2)?;
            require_payload_value(record, "signal", &key[1])?;
            transaction.execute(
                "INSERT INTO library_feed_item_signal_scores (global_id, signal, score, tagged)
                 SELECT ?1, ?2, json_extract(?3, '$.score'), json_extract(?3, '$.tagged');",
                params![text_part(&key[0])?, text_part(&key[1])?, payload],
            )?;
        }
        "17_feed_item_event" => {
            transaction.execute(
                "INSERT INTO library_feed_item_events
                 (global_id, version, method, detected_at, confidence, title, starts_at, ends_at,
                  timezone, location_name, location_url, evidence, evidence_blob_digest)
                 SELECT ?1, json_extract(?2, '$.version'), json_extract(?2, '$.method'),
                        json_extract(?2, '$.detectedAt'), json_extract(?2, '$.confidence'),
                        json_extract(?2, '$.title'), json_extract(?2, '$.startsAt'),
                        json_extract(?2, '$.endsAt'), json_extract(?2, '$.timezone'),
                        json_extract(?2, '$.locationName'), json_extract(?2, '$.locationUrl'),
                        json_extract(?2, '$.evidence'), json_extract(?2, '$.evidenceBlobDigest');",
                params![key_text(record)?, payload],
            )?;
        }
        "20_rss_feed" => {
            transaction.execute(
                "INSERT INTO library_rss_feeds
                 (url, title, site_url, last_fetched, image_url, enabled, poll_interval,
                  track_unread, folder, sample_batch_id, sample_generated_at,
                  sample_generator_version, updated_at)
                 SELECT ?1, json_extract(?2, '$.title'), json_extract(?2, '$.siteUrl'),
                        json_extract(?2, '$.lastFetched'), json_extract(?2, '$.imageUrl'),
                        json_extract(?2, '$.enabled'), json_extract(?2, '$.pollInterval'),
                        json_extract(?2, '$.trackUnread'), json_extract(?2, '$.folder'),
                        json_extract(?2, '$.sampleBatchId'), json_extract(?2, '$.sampleGeneratedAt'),
                        json_extract(?2, '$.sampleGeneratorVersion'), json_extract(?2, '$.updatedAt');",
                params![key_text(record)?, payload],
            )?;
        }
        "30_person" => {
            transaction.execute(
                "INSERT INTO library_persons
                 (id, name, avatar_url, bio, relationship_status, care_level,
                  reach_out_interval_days, notes, sample_batch_id, sample_generated_at,
                  sample_generator_version, created_at, updated_at)
                 SELECT ?1, json_extract(?2, '$.name'), json_extract(?2, '$.avatarUrl'),
                        json_extract(?2, '$.bio'), json_extract(?2, '$.relationshipStatus'),
                        json_extract(?2, '$.careLevel'), json_extract(?2, '$.reachOutIntervalDays'),
                        json_extract(?2, '$.notes'), json_extract(?2, '$.sampleBatchId'),
                        json_extract(?2, '$.sampleGeneratedAt'), json_extract(?2, '$.sampleGeneratorVersion'),
                        json_extract(?2, '$.createdAt'), json_extract(?2, '$.updatedAt');",
                params![key_text(record)?, payload],
            )?;
        }
        "31_person_tag" => {
            let key = key_array(record, 2)?;
            require_payload_value(record, "tag", &key[1])?;
            transaction.execute(
                "INSERT INTO library_person_tags (person_id, tag) VALUES (?1, ?2);",
                params![text_part(&key[0])?, text_part(&key[1])?],
            )?;
        }
        "32_person_reach_out" => {
            let key = key_array(record, 2)?;
            transaction.execute(
                "INSERT INTO library_person_reach_outs (person_id, ordinal, logged_at, channel, notes)
                 SELECT ?1, ?2, json_extract(?3, '$.loggedAt'), json_extract(?3, '$.channel'),
                        json_extract(?3, '$.notes');",
                params![text_part(&key[0])?, integer_part(&key[1])?, payload],
            )?;
        }
        "40_account" => {
            transaction.execute(
                "INSERT INTO library_accounts
                 (id, person_id, kind, provider, external_id, handle, display_name, avatar_url,
                  profile_url, email, phone, address, imported_at, first_seen_at, last_seen_at,
                  discovered_from, follow_roster_active, follow_roster_synced_at, sample_batch_id,
                  sample_generated_at, sample_generator_version, created_at, updated_at)
                 SELECT ?1, json_extract(?2, '$.personId'), json_extract(?2, '$.kind'),
                        json_extract(?2, '$.provider'), json_extract(?2, '$.externalId'),
                        json_extract(?2, '$.handle'), json_extract(?2, '$.displayName'),
                        json_extract(?2, '$.avatarUrl'), json_extract(?2, '$.profileUrl'),
                        json_extract(?2, '$.email'), json_extract(?2, '$.phone'),
                        json_extract(?2, '$.address'), json_extract(?2, '$.importedAt'),
                        json_extract(?2, '$.firstSeenAt'), json_extract(?2, '$.lastSeenAt'),
                        json_extract(?2, '$.discoveredFrom'), json_extract(?2, '$.followRosterActive'),
                        json_extract(?2, '$.followRosterSyncedAt'), json_extract(?2, '$.sampleBatchId'),
                        json_extract(?2, '$.sampleGeneratedAt'), json_extract(?2, '$.sampleGeneratorVersion'),
                        json_extract(?2, '$.createdAt'), json_extract(?2, '$.updatedAt');",
                params![key_text(record)?, payload],
            )?;
        }
        "41_account_follow_role" => {
            let key = key_array(record, 2)?;
            require_payload_value(record, "role", &key[1])?;
            transaction.execute(
                "INSERT INTO library_account_follow_roles (account_id, role) VALUES (?1, ?2);",
                params![text_part(&key[0])?, text_part(&key[1])?],
            )?;
        }
        "50_preference" => {
            transaction.execute(
                "INSERT INTO library_preferences
                 (path, value_type, boolean_value, integer_value, real_value, text_value, updated_at)
                 SELECT ?1, json_extract(?2, '$.valueType'), json_extract(?2, '$.booleanValue'),
                        json_extract(?2, '$.integerValue'), json_extract(?2, '$.realValue'),
                        json_extract(?2, '$.textValue'), json_extract(?2, '$.updatedAt');",
                params![key_text(record)?, payload],
            )?;
        }
        "60_relationship" => {
            let key = key_array(record, 5)?;
            transaction.execute(
                "INSERT INTO library_relationships
                 (subject_type, subject_id, relation_type, object_type, object_id,
                  metadata_text, metadata_blob_digest, created_at, updated_at)
                 SELECT ?1, ?2, ?3, ?4, ?5, json_extract(?6, '$.metadataText'),
                        json_extract(?6, '$.metadataBlobDigest'), json_extract(?6, '$.createdAt'),
                        json_extract(?6, '$.updatedAt');",
                params![
                    text_part(&key[0])?,
                    text_part(&key[1])?,
                    text_part(&key[2])?,
                    text_part(&key[3])?,
                    text_part(&key[4])?,
                    payload
                ],
            )?;
        }
        "70_field_clock" => {
            let key = key_array(record, 3)?;
            transaction.execute(
                "INSERT INTO library_field_clocks
                 (entity_type, entity_id, field_path, actor_id, counter, operation_id, updated_at)
                 SELECT ?1, ?2, ?3, json_extract(?4, '$.actorId'), json_extract(?4, '$.counter'),
                        json_extract(?4, '$.operationId'), json_extract(?4, '$.updatedAt');",
                params![
                    text_part(&key[0])?,
                    text_part(&key[1])?,
                    text_part(&key[2])?,
                    payload
                ],
            )?;
        }
        "80_tombstone" => {
            let key = key_array(record, 2)?;
            transaction.execute(
                "INSERT INTO library_tombstones
                 (entity_type, entity_id, actor_id, counter, operation_id, deleted_at)
                 SELECT ?1, ?2, json_extract(?3, '$.actorId'), json_extract(?3, '$.counter'),
                        json_extract(?3, '$.operationId'), json_extract(?3, '$.deletedAt');",
                params![text_part(&key[0])?, text_part(&key[1])?, payload],
            )?;
        }
        "90_actor_state" => {
            transaction.execute(
                "INSERT INTO library_actors
                 (actor_id, actor_kind, public_key, accepted_counter, retired_at, created_at, updated_at)
                 SELECT ?1, json_extract(?2, '$.actorKind'), json_extract(?2, '$.publicKey'),
                        json_extract(?2, '$.acceptedCounter'), json_extract(?2, '$.retiredAt'),
                        json_extract(?2, '$.createdAt'), json_extract(?2, '$.updatedAt');",
                params![key_text(record)?, payload],
            )?;
        }
        "a0_receipt" => {
            let key = key_array(record, 2)?;
            transaction.execute(
                "INSERT INTO library_receipts
                 (actor_id, operation_id, status, digest, result_text, result_blob_digest, accepted_at)
                 SELECT ?1, ?2, json_extract(?3, '$.status'), json_extract(?3, '$.digest'),
                        json_extract(?3, '$.resultText'), json_extract(?3, '$.resultBlobDigest'),
                        json_extract(?3, '$.acceptedAt');",
                params![text_part(&key[0])?, text_part(&key[1])?, payload],
            )?;
        }
        "b0_blob_descriptor" => {
            require_payload_value(record, "blobContentDigest", &record.primary_key)?;
            transaction.execute(
                "INSERT INTO library_blobs
                 (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
                 SELECT ?1, json_extract(?2, '$.byteLength'), json_extract(?2, '$.chunkBytes'),
                        json_extract(?2, '$.chunkCount'), json_extract(?2, '$.mediaType');",
                params![key_text(record)?, payload],
            )?;
        }
        "b1_content_chunk" => {
            let key = key_array(record, 2)?;
            require_payload_value(record, "blobContentDigest", &key[0])?;
            require_payload_value(record, "chunkIndex", &key[1])?;
            let bytes = BASE64
                .decode(
                    record.payload["bytesBase64"]
                        .as_str()
                        .ok_or(invalid("checkpoint chunk base64 is missing"))?,
                )
                .map_err(|_| invalid("checkpoint chunk base64 is invalid"))?;
            if record.payload["byteLength"].as_u64() != u64::try_from(bytes.len()).ok() {
                return Err(invalid("checkpoint chunk byte length is invalid"));
            }
            transaction.execute(
                "INSERT INTO library_blob_chunks (content_digest, chunk_index, chunk_digest, bytes)
                 SELECT ?1, ?2, json_extract(?3, '$.chunkContentDigest'), ?4;",
                params![text_part(&key[0])?, integer_part(&key[1])?, payload, bytes],
            )?;
        }
        _ => return Err(invalid("checkpoint registry key is unsupported")),
    }
    Ok(())
}

fn verify_blob_rows(transaction: &Transaction<'_>) -> Result<(), NormalizedSqliteError> {
    let mut descriptor_statement = transaction.prepare(
        "SELECT content_digest, byte_length, chunk_count FROM library_blobs ORDER BY content_digest;",
    )?;
    let descriptors = descriptor_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    for descriptor in descriptors {
        let (content_digest, byte_length, chunk_count) = descriptor?;
        let mut chunk_statement = transaction.prepare(
            "SELECT chunk_index, chunk_digest, bytes FROM library_blob_chunks
             WHERE content_digest = ?1 ORDER BY chunk_index;",
        )?;
        let mut chunks = chunk_statement.query([&content_digest])?;
        let mut bytes = Vec::with_capacity(
            usize::try_from(byte_length).map_err(|_| invalid("blob byte length is invalid"))?,
        );
        let mut index = 0i64;
        while let Some(row) = chunks.next()? {
            if row.get::<_, i64>(0)? != index {
                return Err(invalid("checkpoint content chunks are not contiguous"));
            }
            let chunk: Vec<u8> = row.get(2)?;
            let mut chunk_hash = Sha256::new();
            chunk_hash.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
            chunk_hash.update(&chunk);
            if lower_hex(&chunk_hash.finalize()) != row.get::<_, String>(1)? {
                return Err(invalid("checkpoint content chunk digest is invalid"));
            }
            bytes.extend_from_slice(&chunk);
            index += 1;
        }
        if index != chunk_count || i64::try_from(bytes.len()).ok() != Some(byte_length) {
            return Err(invalid("checkpoint content descriptor is incomplete"));
        }
        let mut content_hash = Sha256::new();
        content_hash.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
        content_hash.update(&bytes);
        if lower_hex(&content_hash.finalize()) != content_digest {
            return Err(invalid("checkpoint content digest is invalid"));
        }
    }
    Ok(())
}

pub fn finalize_normalized_checkpoint_stage_v2(
    connection: &mut Connection,
    stage_id: &str,
) -> Result<NormalizedCheckpointActivationReceiptV2, NormalizedSqliteError> {
    let transaction = connection.transaction()?;
    transaction.pragma_update(None, "defer_foreign_keys", true)?;
    let stage: (String, String, i64, i64, i64, String) = transaction
        .query_row(
            "SELECT library_id, authority_epoch, source_revision, expected_record_count,
                    staged_canonical_bytes, expected_checkpoint_digest
             FROM library_checkpoint_stages
             WHERE stage_id = ?1 AND staged_record_count = expected_record_count;",
            [stage_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?
        .ok_or(invalid("normalized checkpoint stage is incomplete"))?;
    let existing_rows: i64 = transaction.query_row(
        "SELECT
           (SELECT count(*) FROM library_meta) +
           (SELECT count(*) FROM library_feed_items) +
           (SELECT count(*) FROM library_rss_feeds) +
           (SELECT count(*) FROM library_persons) +
           (SELECT count(*) FROM library_accounts);",
        [],
        |row| row.get(0),
    )?;
    if existing_rows != 0 {
        return Err(invalid(
            "normalized checkpoint activation target is not empty",
        ));
    }

    let mut digest = Sha256::new();
    digest.update(CHECKPOINT_DIGEST_PREFIX);
    let mut statement = transaction.prepare(
        "SELECT record_canonical FROM library_checkpoint_stage_records
         WHERE stage_id = ?1 ORDER BY registry_key, primary_key_canonical;",
    )?;
    let mut rows = statement.query([stage_id])?;
    let mut record_count = 0usize;
    while let Some(row) = rows.next()? {
        let canonical: Vec<u8> = row.get(0)?;
        digest.update(
            u64::try_from(canonical.len())
                .map_err(|_| invalid("checkpoint record length is invalid"))?
                .to_be_bytes(),
        );
        digest.update(&canonical);
        apply_record(&transaction, &record_from_canonical(&canonical)?)?;
        record_count += 1;
    }
    drop(rows);
    drop(statement);
    let checkpoint_digest = lower_hex(&digest.finalize());
    if checkpoint_digest != stage.5 {
        return Err(invalid(
            "normalized checkpoint digest does not match its stage",
        ));
    }
    let meta_matches: bool = transaction.query_row(
        "SELECT library_id = ?1 AND authority_epoch = ?2 AND source_revision = ?3
         FROM library_meta WHERE singleton_id = 1;",
        params![stage.0, stage.1, stage.2],
        |row| row.get(0),
    )?;
    if !meta_matches {
        return Err(invalid(
            "checkpoint header does not match its stage identity",
        ));
    }
    verify_blob_rows(&transaction)?;
    let foreign_key_failure: Option<String> = transaction
        .query_row(
            "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1;",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if foreign_key_failure.is_some() {
        return Err(invalid(
            "normalized checkpoint has an unresolved foreign reference",
        ));
    }
    transaction.execute(
        "DELETE FROM library_checkpoint_stages WHERE stage_id = ?1;",
        [stage_id],
    )?;
    transaction.commit()?;
    Ok(NormalizedCheckpointActivationReceiptV2 {
        stage_id: stage_id.into(),
        library_id: stage.0,
        authority_epoch: stage.1,
        source_revision: u64::try_from(stage.2)
            .map_err(|_| invalid("source revision is invalid"))?,
        record_count,
        canonical_bytes: usize::try_from(stage.4)
            .map_err(|_| invalid("canonical byte count is invalid"))?,
        checkpoint_digest,
    })
}

pub fn normalized_checkpoint_digest_v2(
    records: &[NormalizedCheckpointRecordV2],
) -> Result<String, NormalizedSqliteError> {
    let mut encoded: Vec<(String, Vec<u8>, Vec<u8>)> = Vec::with_capacity(records.len());
    for record in records {
        if checked_record(
            &record.registry_key,
            record.primary_key.clone(),
            record.payload.clone(),
        )? != *record
        {
            return Err(invalid("checkpoint record version identity is invalid"));
        }
        let primary_key =
            crate::library_core_canonical::encode_canonical_value(&record.primary_key, 4_096)
                .map_err(|_| invalid("checkpoint primary key is invalid"))?;
        let canonical = crate::library_core_canonical::encode_canonical_value(
            &serde_json::to_value(record).map_err(|_| invalid("checkpoint record is invalid"))?,
            crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        )
        .map_err(|_| invalid("checkpoint record exceeds its bound"))?;
        encoded.push((record.registry_key.clone(), primary_key, canonical));
    }
    encoded.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    if encoded
        .windows(2)
        .any(|pair| pair[0].0 == pair[1].0 && pair[0].1 == pair[1].1)
    {
        return Err(invalid("checkpoint record identity is duplicated"));
    }
    let mut digest = Sha256::new();
    digest.update(CHECKPOINT_DIGEST_PREFIX);
    for (_, _, canonical) in encoded {
        digest.update(
            u64::try_from(canonical.len())
                .map_err(|_| invalid("checkpoint record length is invalid"))?
                .to_be_bytes(),
        );
        digest.update(canonical);
    }
    Ok(lower_hex(&digest.finalize()))
}
