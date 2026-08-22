use crate::library_core_canonical::decode_canonical_value;
use crate::library_core_hash::lower_hex;
use crate::normalized_checkpoint::{
    checked_record, decode_fractional_payload, NormalizedCheckpointRecordV2,
};
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{
    CONTENT_RANGE_MAP_DIGEST_DOMAIN, SQLITE_LOCAL_RECONCILIATION_PROGRAMS,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const CHECKPOINT_DIGEST_PREFIX: &[u8] =
    b"freed.library-core.v2/digest-records/normalized-checkpoint\0";

fn reconcile_local_content_state(
    transaction: &Transaction<'_>,
) -> Result<(), NormalizedSqliteError> {
    let program = SQLITE_LOCAL_RECONCILIATION_PROGRAMS
        .iter()
        .find(|program| program.0 == "content_checkpoint_reconcile_v1")
        .ok_or_else(|| invalid("content checkpoint reconciliation program is missing"))?;
    let before =
        transaction.query_row("SELECT total_changes();", [], |row| row.get::<_, i64>(0))?;
    transaction.execute_batch(program.1)?;
    let after = transaction.query_row("SELECT total_changes();", [], |row| row.get::<_, i64>(0))?;
    if after > before {
        let advanced = transaction.execute(
            "UPDATE library_device_content_state
             SET revision = revision + 1
             WHERE singleton_id = 1 AND revision < 9007199254740991;",
            [],
        )?;
        if advanced != 1 {
            return Err(invalid("selective content revision cannot advance"));
        }
    }
    Ok(())
}

pub(crate) struct NormalizedCheckpointDigestAccumulatorV2 {
    digest: Sha256,
    previous_identity: Option<(String, Vec<u8>)>,
    record_count: u64,
    canonical_bytes: u64,
}

impl NormalizedCheckpointDigestAccumulatorV2 {
    pub(crate) fn new() -> Self {
        let mut digest = Sha256::new();
        digest.update(CHECKPOINT_DIGEST_PREFIX);
        Self {
            digest,
            previous_identity: None,
            record_count: 0,
            canonical_bytes: 0,
        }
    }

    pub(crate) fn push(
        &mut self,
        record: &NormalizedCheckpointRecordV2,
    ) -> Result<(), NormalizedSqliteError> {
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
        let identity = (record.registry_key.clone(), primary_key);
        if self
            .previous_identity
            .as_ref()
            .is_some_and(|previous| previous >= &identity)
        {
            return Err(invalid(
                "checkpoint records are duplicated or outside canonical order",
            ));
        }
        let canonical = crate::library_core_canonical::encode_canonical_value(
            &serde_json::to_value(record).map_err(|_| invalid("checkpoint record is invalid"))?,
            crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        )
        .map_err(|_| invalid("checkpoint record exceeds its bound"))?;
        self.digest.update(
            u64::try_from(canonical.len())
                .map_err(|_| invalid("checkpoint record length is invalid"))?
                .to_be_bytes(),
        );
        self.digest.update(&canonical);
        self.previous_identity = Some(identity);
        self.record_count = self
            .record_count
            .checked_add(1)
            .ok_or_else(|| invalid("checkpoint record count is invalid"))?;
        self.canonical_bytes = self
            .canonical_bytes
            .checked_add(
                u64::try_from(canonical.len())
                    .map_err(|_| invalid("checkpoint canonical byte count is invalid"))?,
            )
            .ok_or_else(|| invalid("checkpoint canonical byte count is invalid"))?;
        Ok(())
    }

    pub(crate) fn finish(self) -> (String, u64, u64) {
        (
            lower_hex(&self.digest.finalize()),
            self.record_count,
            self.canonical_bytes,
        )
    }
}

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFollowerCheckpointReceiptV2 {
    pub checkpoint_generation: u64,
    pub writer_actor_id: String,
    pub manifest_object_key: String,
    pub manifest_transport_object_id: String,
    pub manifest_content_digest: String,
    pub control_revision: String,
    pub installed_at: u64,
}

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn bounded_text(value: &str, maximum_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= maximum_bytes
}

fn lowercase_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
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

fn payload_json(record: &NormalizedCheckpointRecordV2) -> Result<String, NormalizedSqliteError> {
    let mut payload = record.payload.clone();
    decode_fractional_payload(&record.registry_key, &mut payload)?;
    serde_json::to_string(&payload).map_err(|error| {
        NormalizedSqliteError::Transport(format!("checkpoint payload encoding failed: {error}"))
    })
}

fn validate_checkpoint_header(
    record: &NormalizedCheckpointRecordV2,
) -> Result<(), NormalizedSqliteError> {
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
    let expected_checkpoint_id = format!("{library_id}:{authority_epoch}:{source_revision}");
    if record.payload["schemaVersion"].as_u64()
        != Some(u64::from(
            crate::sqlite_contract_generated::SQLITE_SCHEMA_VERSION,
        ))
        || record.payload["checkpointId"].as_str() != Some(expected_checkpoint_id.as_str())
    {
        return Err(invalid("checkpoint header version identity is invalid"));
    }
    Ok(())
}

fn primary_key_arity(value: &Value) -> Option<usize> {
    match value {
        Value::String(_) => Some(1),
        Value::Array(values) => Some(values.len()),
        _ => None,
    }
}

fn apply_record(
    transaction: &Transaction<'_>,
    record: &NormalizedCheckpointRecordV2,
) -> Result<(), NormalizedSqliteError> {
    let (_, expected_arity, has_chunk_bytes, sql) =
        crate::sqlite_contract_generated::SQLITE_CHECKPOINT_IMPORT_PROGRAMS
            .iter()
            .find(|program| program.0 == record.registry_key)
            .copied()
            .ok_or(invalid("checkpoint registry key is unsupported"))?;
    if record.registry_key == "00_checkpoint_header" {
        validate_checkpoint_header(record)?;
    } else if primary_key_arity(&record.primary_key) != Some(expected_arity) {
        return Err(invalid("checkpoint primary key has the wrong length"));
    }
    let primary_key = serde_json::to_string(&record.primary_key).map_err(|error| {
        NormalizedSqliteError::Transport(format!("checkpoint primary key encoding failed: {error}"))
    })?;
    let payload = payload_json(record)?;
    let changes = if has_chunk_bytes {
        let encoded = record.payload["bytesBase64"]
            .as_str()
            .ok_or(invalid("checkpoint chunk base64 is missing"))?;
        let bytes = BASE64
            .decode(encoded)
            .map_err(|_| invalid("checkpoint chunk base64 is invalid"))?;
        if record.payload["byteLength"].as_u64() != u64::try_from(bytes.len()).ok() {
            return Err(invalid("checkpoint chunk byte length is invalid"));
        }
        transaction.execute(sql, params![primary_key, payload, bytes])?
    } else {
        transaction.execute(sql, params![primary_key, payload])?
    };
    if changes != 1 {
        return Err(invalid(
            "checkpoint payload identity does not match its primary key",
        ));
    }
    Ok(())
}

fn verify_blob_rows(transaction: &Transaction<'_>) -> Result<(), NormalizedSqliteError> {
    let mut descriptor_statement = transaction.prepare(
        "SELECT content_digest, byte_length, storage_layout, chunk_count, range_count,
                range_index_root_digest
         FROM library_blobs ORDER BY content_digest;",
    )?;
    let descriptors = descriptor_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    for descriptor in descriptors {
        let (
            content_digest,
            byte_length,
            storage_layout,
            chunk_count,
            range_count,
            range_index_root_digest,
        ) = descriptor?;
        if storage_layout == "authenticated_ranges" {
            let unexpected_chunks: i64 = transaction.query_row(
                "SELECT count(*) FROM library_blob_chunks WHERE content_digest = ?1;",
                [&content_digest],
                |row| row.get(0),
            )?;
            if unexpected_chunks != 0 {
                return Err(invalid("ranged content contains inline chunks"));
            }
            let mut range_statement = transaction.prepare(
                "SELECT range_index, byte_offset, byte_length, range_digest
                 FROM library_content_ranges
                 WHERE content_digest = ?1 ORDER BY range_index;",
            )?;
            let mut ranges = range_statement.query([&content_digest])?;
            let mut root = Sha256::new();
            root.update(CONTENT_RANGE_MAP_DIGEST_DOMAIN.as_bytes());
            root.update(content_digest.as_bytes());
            root.update(
                u64::try_from(byte_length)
                    .map_err(|_| invalid("ranged content byte length is invalid"))?
                    .to_be_bytes(),
            );
            root.update(
                u64::try_from(range_count)
                    .map_err(|_| invalid("content range count is invalid"))?
                    .to_be_bytes(),
            );
            let mut index = 0i64;
            let mut offset = 0i64;
            while let Some(row) = ranges.next()? {
                let row_index = row.get::<_, i64>(0)?;
                let row_offset = row.get::<_, i64>(1)?;
                let row_length = row.get::<_, i64>(2)?;
                let range_digest = row.get::<_, String>(3)?;
                if row_index != index || row_offset != offset || row_length < 1 {
                    return Err(invalid("checkpoint content ranges are not contiguous"));
                }
                root.update(
                    u64::try_from(row_index)
                        .map_err(|_| invalid("content range index is invalid"))?
                        .to_be_bytes(),
                );
                root.update(
                    u64::try_from(row_offset)
                        .map_err(|_| invalid("content range offset is invalid"))?
                        .to_be_bytes(),
                );
                root.update(
                    u64::try_from(row_length)
                        .map_err(|_| invalid("content range length is invalid"))?
                        .to_be_bytes(),
                );
                root.update(range_digest.as_bytes());
                offset = offset
                    .checked_add(row_length)
                    .ok_or(invalid("content range length overflowed"))?;
                index += 1;
            }
            if index != range_count
                || offset != byte_length
                || range_index_root_digest.as_deref() != Some(&lower_hex(&root.finalize()))
            {
                return Err(invalid("checkpoint content range map is incomplete"));
            }
            continue;
        }
        if storage_layout != "inline_chunks" || range_count != 0 {
            return Err(invalid("checkpoint content layout is invalid"));
        }
        let unexpected_ranges: i64 = transaction.query_row(
            "SELECT count(*) FROM library_content_ranges WHERE content_digest = ?1;",
            [&content_digest],
            |row| row.get(0),
        )?;
        if unexpected_ranges != 0 {
            return Err(invalid("inline content contains range records"));
        }
        let mut chunk_statement = transaction.prepare(
            "SELECT chunk_index, chunk_digest, bytes FROM library_blob_chunks
             WHERE content_digest = ?1 ORDER BY chunk_index;",
        )?;
        let mut chunks = chunk_statement.query([&content_digest])?;
        let mut content_hash = Sha256::new();
        content_hash.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
        let mut byte_count = 0i64;
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
            byte_count = byte_count
                .checked_add(
                    i64::try_from(chunk.len())
                        .map_err(|_| invalid("blob byte length is invalid"))?,
                )
                .ok_or(invalid("blob byte length overflowed"))?;
            content_hash.update(&chunk);
            index += 1;
        }
        if index != chunk_count || byte_count != byte_length {
            return Err(invalid("checkpoint content descriptor is incomplete"));
        }
        if lower_hex(&content_hash.finalize()) != content_digest {
            return Err(invalid("checkpoint content digest is invalid"));
        }
    }
    Ok(())
}

fn verify_authority_rows(
    transaction: &Transaction<'_>,
    library_id: &str,
    authority_epoch: &str,
) -> Result<(), NormalizedSqliteError> {
    let matches: i64 = transaction.query_row(
        "SELECT count(*)
         FROM library_active_authority AS active
         JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
         WHERE active.active_key = 'active'
           AND active.library_id = ?1
           AND active.epoch_id = ?2
           AND epoch.library_id = active.library_id
           AND epoch.accepted_manifest_generation = active.accepted_manifest_generation;",
        params![library_id, authority_epoch],
        |row| row.get(0),
    )?;
    if matches != 1 {
        return Err(invalid(
            "checkpoint active authority does not match its header",
        ));
    }
    let actor_without_capability: i64 = transaction.query_row(
        "SELECT count(*)
         FROM library_actors AS actor
         WHERE actor.retired_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM library_actor_capabilities AS capability
             WHERE capability.actor_id = actor.actor_id
               AND capability.retired_at IS NULL
           );",
        [],
        |row| row.get(0),
    )?;
    if actor_without_capability != 0 {
        return Err(invalid(
            "checkpoint active actor does not have an active capability",
        ));
    }
    let mut statement = transaction.prepare(
        "SELECT DISTINCT mutation_id FROM library_actor_capability_mutations
         ORDER BY mutation_id;",
    )?;
    let mutations = statement.query_map([], |row| row.get::<_, String>(0))?;
    for mutation in mutations {
        let mutation = mutation?;
        if crate::sqlite_contract_generated::OPERATION_IDS
            .binary_search(&mutation.as_str())
            .is_err()
        {
            return Err(invalid(
                "checkpoint actor capability names an unknown mutation",
            ));
        }
    }
    Ok(())
}

fn assert_checkpoint_replacement_has_no_local_overlay(
    transaction: &Transaction<'_>,
) -> Result<(), NormalizedSqliteError> {
    let unresolved: i64 = transaction.query_row(
        "SELECT
           (SELECT count(*) FROM library_intent_transactions
              WHERE state IN ('pending', 'published')) +
           (SELECT count(*) FROM library_optimistic_fields) +
           (SELECT count(*) FROM library_replication_outbox
              WHERE acknowledged_at IS NULL) +
           (SELECT count(*) FROM library_follower_result_outbox
              WHERE acknowledged_at IS NULL) +
           (SELECT count(*) FROM library_primary_intent_stage_transactions);",
        [],
        |row| row.get(0),
    )?;
    if unresolved != 0 {
        return Err(invalid(
            "normalized checkpoint replacement has unresolved local operations",
        ));
    }
    Ok(())
}

fn clear_checkpoint_replacement_target(
    transaction: &Transaction<'_>,
) -> Result<(), NormalizedSqliteError> {
    transaction.execute_batch(
        "DELETE FROM library_optimistic_fields;
         DELETE FROM library_intent_results;
         DELETE FROM library_intent_result_cursors;
         DELETE FROM library_intent_members;
         DELETE FROM library_intent_transactions;
         DELETE FROM library_intent_actors;
         DELETE FROM library_primary_intent_stage_members;
         DELETE FROM library_primary_intent_stage_transactions;
         DELETE FROM library_follower_result_outbox;
         DELETE FROM library_follower_result_cursors;
         DELETE FROM library_replication_outbox;
         DELETE FROM library_operation_causal_tips;
         DELETE FROM library_operations;
         DELETE FROM library_transactions;
         DELETE FROM library_invalidations;
         DELETE FROM library_follower_checkpoint_receipt;
         DELETE FROM library_device_scope_action_members;
         DELETE FROM library_device_scope_actions;
         DELETE FROM library_device_person_graph_layout;
         DELETE FROM library_device_account_graph_layout;
         DELETE FROM library_person_feed_items;
         DELETE FROM library_relationships;
         DELETE FROM library_field_clocks;
         DELETE FROM library_tombstones;
         DELETE FROM library_receipts;
         DELETE FROM library_feed_items;
         DELETE FROM library_rss_feeds;
         DELETE FROM library_account_follow_roles;
         DELETE FROM library_accounts;
         DELETE FROM library_person_reach_outs;
         DELETE FROM library_person_tags;
         DELETE FROM library_persons;
         DELETE FROM library_preferences;
         DELETE FROM library_actor_capability_mutations;
         DELETE FROM library_actor_capabilities;
         DELETE FROM library_actors;
         DELETE FROM library_active_authority;
         DELETE FROM library_authority_frontier;
         DELETE FROM library_authority_epochs;
         DELETE FROM library_blob_chunks;
         DELETE FROM library_content_ranges;
         DELETE FROM library_blobs;
         DELETE FROM library_materialization_generation;
         DELETE FROM library_meta;
         DELETE FROM library_storage_transition_plan;
         DELETE FROM library_saved_platform_counts;
         DELETE FROM library_tag_counts;
         UPDATE library_facet_summary SET total_count = 0, archived_count = 0,
           sample_item_count = 0, saved_count = 0, saved_archived_count = 0
           WHERE singleton_id = 1;
         UPDATE library_device_graph_layout_state SET revision = 0
           WHERE singleton_id = 1;
         UPDATE library_change_state SET revision = 0 WHERE singleton_id = 1;",
    )?;
    Ok(())
}

fn install_follower_checkpoint_receipt(
    transaction: &Transaction<'_>,
    stage: &(String, String, i64, i64, i64),
    checkpoint_digest: &str,
    receipt: &NormalizedFollowerCheckpointReceiptV2,
) -> Result<(), NormalizedSqliteError> {
    if !lowercase_digest(&receipt.manifest_content_digest)
        || !bounded_text(&receipt.writer_actor_id, 255)
        || !bounded_text(&receipt.manifest_object_key, 1_024)
        || !bounded_text(&receipt.manifest_transport_object_id, 1_024)
        || !bounded_text(&receipt.control_revision, 1_024)
    {
        return Err(invalid("normalized follower checkpoint receipt is invalid"));
    }
    let writer_matches: i64 = transaction.query_row(
        "SELECT count(*)
         FROM library_active_authority AS active
         JOIN library_actors AS actor
           ON actor.authority_epoch_id = active.epoch_id
          AND actor.actor_kind = 'desktop' AND actor.retired_at IS NULL
         WHERE active.active_key = 'active' AND active.library_id = ?1
           AND active.epoch_id = ?2 AND actor.actor_id = ?3;",
        params![stage.0, stage.1, receipt.writer_actor_id],
        |row| row.get(0),
    )?;
    if writer_matches != 1 {
        return Err(invalid(
            "normalized follower checkpoint writer is not active",
        ));
    }
    transaction.execute(
        "INSERT INTO library_follower_checkpoint_receipt
         (singleton_id, library_id, authority_epoch_id, writer_actor_id,
          checkpoint_generation, source_revision, checkpoint_digest,
          manifest_object_key, manifest_transport_object_id,
          manifest_content_digest, control_revision, installed_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);",
        params![
            stage.0,
            stage.1,
            receipt.writer_actor_id,
            receipt.checkpoint_generation,
            stage.2,
            checkpoint_digest,
            receipt.manifest_object_key,
            receipt.manifest_transport_object_id,
            receipt.manifest_content_digest,
            receipt.control_revision,
            receipt.installed_at,
        ],
    )?;
    let local_actor: Option<String> = transaction
        .query_row(
            "SELECT actor_id FROM library_follower_actor_request
             WHERE singleton_id = 1 AND library_id = ?1
               AND authority_epoch_id = ?2
               AND enrollment_certificate_digest IS NOT NULL;",
            params![stage.0, stage.1],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(actor_id) = local_actor {
        let actor_tip: Option<(i64, Option<String>, String)> = transaction
            .query_row(
                "SELECT accepted_counter, accepted_operation_id,
                        accepted_chain_digest
                 FROM library_actors
                 WHERE actor_id = ?1 AND authority_epoch_id = ?2
                   AND retired_at IS NULL;",
                params![actor_id, stage.1],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((accepted_counter, accepted_operation_id, accepted_chain_digest)) = actor_tip
        else {
            return Err(invalid(
                "normalized checkpoint omits the enrolled local follower actor",
            ));
        };
        let next_counter = accepted_counter
            .checked_add(1)
            .ok_or(invalid("normalized follower actor counter is invalid"))?;
        transaction.execute(
            "INSERT INTO library_intent_actors
             (actor_id, next_counter, previous_operation_id,
              previous_chain_digest) VALUES (?1, ?2, ?3, ?4);",
            params![
                actor_id,
                next_counter,
                accepted_operation_id,
                accepted_chain_digest,
            ],
        )?;
    }
    Ok(())
}

fn activate_normalized_checkpoint_stage_v2(
    connection: &mut Connection,
    stage_id: &str,
    replace_existing: bool,
    follower_receipt: Option<&NormalizedFollowerCheckpointReceiptV2>,
) -> Result<NormalizedCheckpointActivationReceiptV2, NormalizedSqliteError> {
    let transaction = connection.transaction()?;
    transaction.pragma_update(None, "defer_foreign_keys", true)?;
    let stage: (String, String, i64, i64, i64) = transaction
        .query_row(
            "SELECT library_id, authority_epoch, source_revision, expected_record_count,
                    staged_canonical_bytes
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
                ))
            },
        )
        .optional()?
        .ok_or(invalid("normalized checkpoint stage is incomplete"))?;
    if replace_existing {
        assert_checkpoint_replacement_has_no_local_overlay(&transaction)?;
        clear_checkpoint_replacement_target(&transaction)?;
    }
    let existing_rows: i64 = transaction.query_row(
        "SELECT
           (SELECT count(*) FROM library_meta) +
           (SELECT count(*) FROM library_materialization_generation) +
           (SELECT count(*) FROM library_authority_epochs) +
           (SELECT count(*) FROM library_authority_frontier) +
           (SELECT count(*) FROM library_active_authority) +
           (SELECT count(*) FROM library_feed_items) +
           (SELECT count(*) FROM library_rss_feeds) +
           (SELECT count(*) FROM library_persons) +
           (SELECT count(*) FROM library_accounts) +
           (SELECT count(*) FROM library_preferences) +
           (SELECT count(*) FROM library_relationships) +
           (SELECT count(*) FROM library_field_clocks) +
           (SELECT count(*) FROM library_tombstones) +
           (SELECT count(*) FROM library_actors) +
           (SELECT count(*) FROM library_actor_capabilities) +
           (SELECT count(*) FROM library_actor_capability_mutations) +
           (SELECT count(*) FROM library_receipts) +
           (SELECT count(*) FROM library_blobs) +
           (SELECT count(*) FROM library_content_ranges) +
           (SELECT count(*) FROM library_transactions) +
           (SELECT count(*) FROM library_invalidations) +
           (SELECT count(*) FROM library_intent_transactions);",
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
    transaction.execute(
        "INSERT INTO library_materialization_generation
         (singleton_id, generation_id) VALUES (1, ?1);",
        [&checkpoint_digest],
    )?;
    let revision_updated = transaction.execute(
        "UPDATE library_change_state SET revision = ?1
         WHERE singleton_id = 1 AND revision = 0;",
        [stage.2],
    )?;
    if revision_updated != 1 {
        return Err(invalid("checkpoint change revision could not be activated"));
    }
    if stage.2 > 0 {
        transaction.execute(
            "INSERT INTO library_invalidations
             (revision, ordinal, topic, entity_id, reset_required)
             VALUES (?1, 0, 'library', NULL, 1);",
            [stage.2],
        )?;
    }
    verify_blob_rows(&transaction)?;
    reconcile_local_content_state(&transaction)?;
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
    verify_authority_rows(&transaction, &stage.0, &stage.1)?;
    if let Some(receipt) = follower_receipt {
        install_follower_checkpoint_receipt(&transaction, &stage, &checkpoint_digest, receipt)?;
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

pub fn finalize_normalized_checkpoint_stage_v2(
    connection: &mut Connection,
    stage_id: &str,
) -> Result<NormalizedCheckpointActivationReceiptV2, NormalizedSqliteError> {
    activate_normalized_checkpoint_stage_v2(connection, stage_id, false, None)
}

pub fn replace_with_normalized_checkpoint_stage_v2(
    connection: &mut Connection,
    stage_id: &str,
) -> Result<NormalizedCheckpointActivationReceiptV2, NormalizedSqliteError> {
    activate_normalized_checkpoint_stage_v2(connection, stage_id, true, None)
}

pub fn replace_with_normalized_follower_checkpoint_stage_v2(
    connection: &mut Connection,
    stage_id: &str,
    receipt: &NormalizedFollowerCheckpointReceiptV2,
) -> Result<NormalizedCheckpointActivationReceiptV2, NormalizedSqliteError> {
    activate_normalized_checkpoint_stage_v2(connection, stage_id, true, Some(receipt))
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
    let mut accumulator = NormalizedCheckpointDigestAccumulatorV2::new();
    for (_, _, canonical) in encoded {
        accumulator.digest.update(
            u64::try_from(canonical.len())
                .map_err(|_| invalid("checkpoint record length is invalid"))?
                .to_be_bytes(),
        );
        accumulator.digest.update(&canonical);
        accumulator.record_count += 1;
        accumulator.canonical_bytes += u64::try_from(canonical.len())
            .map_err(|_| invalid("checkpoint canonical byte count is invalid"))?;
    }
    Ok(accumulator.finish().0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_normalized_schema_v1;

    #[test]
    fn authenticated_range_map_closes_without_content_byte_allocation() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let content_digest = "a".repeat(64);
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, storage_layout, chunk_bytes, chunk_count,
                    range_count, range_granularity, range_index_root_digest, rendition_id,
                    encoding, cloud_availability_commitment, media_type)
                 VALUES (?1, 5000000000, 'authenticated_ranges', 0, 0, 2, 2500000000,
                         ?2, 'video-1080p', 'identity', ?3, 'video/mp4');",
                params![
                    content_digest,
                    "add3359c5ff23df62183d1fd6e086763c2de356b292357cdf43cbb6967240b95",
                    "d".repeat(64)
                ],
            )
            .expect("descriptor");
        connection
            .execute(
                "INSERT INTO library_content_ranges
                   (content_digest, range_index, byte_offset, byte_length, range_digest)
                 VALUES (?1, 0, 0, 2500000000, ?2),
                        (?1, 1, 2500000000, 2500000000, ?3);",
                params![content_digest, "b".repeat(64), "c".repeat(64)],
            )
            .expect("ranges");
        let transaction = connection.transaction().expect("transaction");
        verify_blob_rows(&transaction).expect("authenticated range map");
        transaction.rollback().expect("rollback proof transaction");
    }

    #[test]
    fn authenticated_range_map_rejects_gaps_and_changed_roots() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, storage_layout, chunk_bytes, chunk_count,
                    range_count, range_granularity, range_index_root_digest, rendition_id,
                    cloud_availability_commitment, media_type)
                 VALUES (?1, 10, 'authenticated_ranges', 0, 0, 1, 10,
                         ?2, 'video', ?3, 'video/mp4');",
                params!["a".repeat(64), "e".repeat(64), "d".repeat(64)],
            )
            .expect("descriptor");
        connection
            .execute(
                "INSERT INTO library_content_ranges
                   (content_digest, range_index, byte_offset, byte_length, range_digest)
                 VALUES (?1, 0, 1, 9, ?2);",
                params!["a".repeat(64), "b".repeat(64)],
            )
            .expect("gapped range");
        let transaction = connection.transaction().expect("transaction");
        let error = verify_blob_rows(&transaction).expect_err("reject gap");
        assert!(error.to_string().contains("not contiguous"));
        transaction.rollback().expect("rollback proof transaction");
    }

    #[test]
    fn checkpoint_reconciliation_preserves_exact_proofs_and_prunes_stale_ranges() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let content_digest = "a".repeat(64);
        let range_digest = "b".repeat(64);
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, storage_layout, chunk_bytes, chunk_count,
                    range_count, range_granularity, range_index_root_digest, rendition_id,
                    cloud_availability_commitment, media_type)
                 VALUES (?1, 5, 'authenticated_ranges', 0, 0, 1, 5, ?2,
                         'video', ?3, 'video/mp4');",
                params![content_digest, "c".repeat(64), "d".repeat(64)],
            )
            .expect("descriptor");
        connection
            .execute(
                "INSERT INTO library_content_ranges
                   (content_digest, range_index, byte_offset, byte_length, range_digest)
                 VALUES (?1, 0, 0, 5, ?2);",
                params![content_digest, range_digest],
            )
            .expect("canonical range");
        connection
            .execute(
                "INSERT INTO library_device_content_ranges
                   (content_digest, range_index, verified_byte_length,
                    verified_range_digest, storage_kind, storage_key, verified_at)
                 VALUES (?1, 0, 5, ?2, 'content_vault', 'range-one', 10);",
                params![content_digest, range_digest],
            )
            .expect("local range proof");
        connection
            .execute(
                "INSERT INTO library_device_content_availability
                   (content_digest, hydration_state, verified_bytes, storage_kind,
                    complete_digest_verified_at, updated_at)
                 VALUES (?1, 'partially_cached', 5, 'content_vault', NULL, 10);",
                params![content_digest],
            )
            .expect("local availability");

        let transaction = connection.transaction().expect("transaction");
        reconcile_local_content_state(&transaction).expect("exact reconciliation");
        assert_eq!(
            transaction
                .query_row(
                    "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("content revision"),
            0
        );
        transaction
            .execute(
                "UPDATE library_content_ranges SET range_digest = ?1
                 WHERE content_digest = ?2 AND range_index = 0;",
                params!["e".repeat(64), content_digest],
            )
            .expect("changed canonical range");
        reconcile_local_content_state(&transaction).expect("stale reconciliation");
        assert_eq!(
            transaction
                .query_row(
                    "SELECT count(*) FROM library_device_content_ranges;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("local ranges"),
            0
        );
        assert_eq!(
            transaction
                .query_row(
                    "SELECT count(*) FROM library_device_content_availability;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("local availability"),
            0
        );
        assert_eq!(
            transaction
                .query_row(
                    "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("advanced content revision"),
            1
        );
        transaction.rollback().expect("rollback proof transaction");
    }
}
