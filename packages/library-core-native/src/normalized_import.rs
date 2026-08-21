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
