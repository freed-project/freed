use crate::library_core_canonical::encode_canonical_value;
use crate::library_core_hash::lower_hex;
use crate::normalized_checkpoint::{
    checked_record, encode_fractional_payload, ContentRecordError, NormalizedCheckpointRecordV2,
};
use crate::sqlite_contract_generated::{
    CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES, CHECKPOINT_PAGE_MAXIMUM_RECORDS,
    NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES, NORMALIZED_SCHEMA_SHA256, NORMALIZED_SCHEMA_SQL,
    SQLITE_APPLICATION_ID, SQLITE_CONTRACT_VERSION, SQLITE_PROTOCOL_VERSION, SQLITE_SCHEMA_VERSION,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const STAGED_RECORD_DIGEST_PREFIX: &[u8] =
    b"freed.library-core.v2/digest-bytes/staged-checkpoint-record\0";

#[derive(Debug)]
pub enum NormalizedSqliteError {
    Content(ContentRecordError),
    InvalidRequest(&'static str),
    Journal(crate::library_core_journal::JournalError),
    Sqlite(rusqlite::Error),
    Transport(String),
}

impl std::fmt::Display for NormalizedSqliteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Content(error) => write!(formatter, "{error}"),
            Self::InvalidRequest(message) => formatter.write_str(message),
            Self::Journal(error) => write!(formatter, "normalized operation failure: {error}"),
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

impl From<crate::library_core_journal::JournalError> for NormalizedSqliteError {
    fn from(value: crate::library_core_journal::JournalError) -> Self {
        Self::Journal(value)
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginNormalizedCheckpointStageV2 {
    pub stage_id: String,
    pub library_id: String,
    pub authority_epoch: String,
    pub source_revision: u64,
    pub expected_record_count: usize,
    pub expected_checkpoint_digest: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedCheckpointStageStatusV2 {
    pub stage_id: String,
    pub expected_record_count: usize,
    pub staged_record_count: usize,
    pub staged_canonical_bytes: usize,
    pub complete: bool,
}

pub fn install_normalized_schema_v1(connection: &Connection) -> Result<(), NormalizedSqliteError> {
    let user_version: u32 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let application_id: u32 =
        connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
    if user_version == 0 {
        if application_id != 0 {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized SQLite application identity is foreign",
            ));
        }
        connection.execute_batch(NORMALIZED_SCHEMA_SQL)?;
        connection.execute(
            "INSERT INTO library_storage_meta
             (singleton_id, contract_version, schema_version, protocol_version, schema_sha256)
             VALUES (1, ?1, ?2, ?3, ?4);",
            params![
                SQLITE_CONTRACT_VERSION,
                SQLITE_SCHEMA_VERSION,
                SQLITE_PROTOCOL_VERSION,
                NORMALIZED_SCHEMA_SHA256,
            ],
        )?;
        connection.pragma_update(None, "user_version", SQLITE_SCHEMA_VERSION)?;
    } else {
        if user_version != SQLITE_SCHEMA_VERSION || application_id != SQLITE_APPLICATION_ID {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized SQLite version identity is unsupported",
            ));
        }
        let matches: bool = connection.query_row(
            "SELECT contract_version = ?1 AND schema_version = ?2
                    AND protocol_version = ?3 AND schema_sha256 = ?4
             FROM library_storage_meta WHERE singleton_id = 1;",
            params![
                SQLITE_CONTRACT_VERSION,
                SQLITE_SCHEMA_VERSION,
                SQLITE_PROTOCOL_VERSION,
                NORMALIZED_SCHEMA_SHA256,
            ],
            |row| row.get(0),
        )?;
        if !matches {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized SQLite storage identity does not match this build",
            ));
        }
    }
    Ok(())
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn stage_status(
    connection: &Connection,
    stage_id: &str,
) -> Result<NormalizedCheckpointStageStatusV2, NormalizedSqliteError> {
    connection
        .query_row(
            "SELECT stage_id, expected_record_count, staged_record_count, staged_canonical_bytes
             FROM library_checkpoint_stages WHERE stage_id = ?1;",
            [stage_id],
            |row| {
                let expected = usize::try_from(row.get::<_, i64>(1)?).map_err(|_| {
                    rusqlite::Error::IntegralValueOutOfRange(1, row.get::<_, i64>(1).unwrap_or(-1))
                })?;
                let staged = usize::try_from(row.get::<_, i64>(2)?).map_err(|_| {
                    rusqlite::Error::IntegralValueOutOfRange(2, row.get::<_, i64>(2).unwrap_or(-1))
                })?;
                Ok(NormalizedCheckpointStageStatusV2 {
                    stage_id: row.get(0)?,
                    expected_record_count: expected,
                    staged_record_count: staged,
                    staged_canonical_bytes: usize::try_from(row.get::<_, i64>(3)?)
                        .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(3, -1))?,
                    complete: staged == expected,
                })
            },
        )
        .map_err(Into::into)
}

pub fn begin_normalized_checkpoint_stage_v2(
    connection: &Connection,
    request: &BeginNormalizedCheckpointStageV2,
) -> Result<NormalizedCheckpointStageStatusV2, NormalizedSqliteError> {
    if request.stage_id.is_empty()
        || request.stage_id.len() > 255
        || request.library_id.is_empty()
        || request.library_id.len() > 255
        || request.authority_epoch.is_empty()
        || request.authority_epoch.len() > 255
        || request.expected_record_count == 0
        || !valid_digest(&request.expected_checkpoint_digest)
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint stage identity is invalid",
        ));
    }
    let source_revision = i64::try_from(request.source_revision).map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized checkpoint sourceRevision is invalid")
    })?;
    let expected_record_count = i64::try_from(request.expected_record_count).map_err(|_| {
        NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint expectedRecordCount is invalid",
        )
    })?;
    let created_at = i64::try_from(request.created_at).map_err(|_| {
        NormalizedSqliteError::InvalidRequest("normalized checkpoint createdAt is invalid")
    })?;
    let inserted = connection.execute(
        "INSERT OR IGNORE INTO library_checkpoint_stages
         (stage_id, library_id, authority_epoch, source_revision,
          expected_record_count, expected_checkpoint_digest, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        params![
            request.stage_id,
            request.library_id,
            request.authority_epoch,
            source_revision,
            expected_record_count,
            request.expected_checkpoint_digest,
            created_at,
        ],
    )?;
    if inserted == 0 {
        let matches: bool = connection.query_row(
            "SELECT library_id = ?2 AND authority_epoch = ?3 AND source_revision = ?4
                    AND expected_record_count = ?5 AND expected_checkpoint_digest = ?6
                    AND created_at = ?7
             FROM library_checkpoint_stages WHERE stage_id = ?1;",
            params![
                request.stage_id,
                request.library_id,
                request.authority_epoch,
                source_revision,
                expected_record_count,
                request.expected_checkpoint_digest,
                created_at,
            ],
            |row| row.get(0),
        )?;
        if !matches {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized checkpoint stage replay changed its identity",
            ));
        }
    }
    stage_status(connection, &request.stage_id)
}

pub fn append_normalized_checkpoint_stage_page_v2(
    connection: &mut Connection,
    stage_id: &str,
    records: &[NormalizedCheckpointRecordV2],
) -> Result<NormalizedCheckpointStageStatusV2, NormalizedSqliteError> {
    if stage_id.is_empty()
        || stage_id.len() > 255
        || records.is_empty()
        || records.len() > CHECKPOINT_PAGE_MAXIMUM_RECORDS
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint stage page is outside its record bound",
        ));
    }
    let mut encoded = Vec::with_capacity(records.len());
    let mut page_bytes = 0usize;
    for record in records {
        let validated = checked_record(
            &record.registry_key,
            record.primary_key.clone(),
            record.payload.clone(),
        )?;
        if &validated != record {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized checkpoint record version identity is invalid",
            ));
        }
        let primary_key = encode_canonical_value(&record.primary_key, 4_096).map_err(|_| {
            NormalizedSqliteError::InvalidRequest("checkpoint primary key is invalid")
        })?;
        let bytes = encode_canonical_value(
            &serde_json::to_value(record).map_err(|error| {
                NormalizedSqliteError::Transport(format!(
                    "checkpoint record encoding failed: {error}"
                ))
            })?,
            crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        )
        .map_err(|_| {
            NormalizedSqliteError::InvalidRequest("checkpoint record exceeds its bound")
        })?;
        page_bytes =
            page_bytes
                .checked_add(bytes.len())
                .ok_or(NormalizedSqliteError::InvalidRequest(
                    "checkpoint page byte count overflowed",
                ))?;
        if page_bytes > CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES {
            return Err(NormalizedSqliteError::InvalidRequest(
                "normalized checkpoint stage page exceeds its decoded byte bound",
            ));
        }
        let mut digest = Sha256::new();
        digest.update(STAGED_RECORD_DIGEST_PREFIX);
        digest.update(&bytes);
        encoded.push((
            record.registry_key.as_str(),
            primary_key,
            bytes,
            lower_hex(&digest.finalize()),
        ));
    }

    let transaction = connection.transaction()?;
    let expected_record_count: i64 = transaction
        .query_row(
            "SELECT expected_record_count FROM library_checkpoint_stages WHERE stage_id = ?1;",
            [stage_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint stage does not exist",
        ))?;
    for (registry_key, primary_key, bytes, digest) in encoded {
        let inserted = transaction.execute(
            "INSERT OR IGNORE INTO library_checkpoint_stage_records
             (stage_id, registry_key, primary_key_canonical, record_canonical, record_digest)
             VALUES (?1, ?2, ?3, ?4, ?5);",
            params![stage_id, registry_key, primary_key, bytes, digest],
        )?;
        if inserted == 0 {
            let matches: bool = transaction.query_row(
                "SELECT record_digest = ?4 AND record_canonical = ?5
                 FROM library_checkpoint_stage_records
                 WHERE stage_id = ?1 AND registry_key = ?2 AND primary_key_canonical = ?3;",
                params![stage_id, registry_key, primary_key, digest, bytes],
                |row| row.get(0),
            )?;
            if !matches {
                return Err(NormalizedSqliteError::InvalidRequest(
                    "normalized checkpoint record replay changed its bytes",
                ));
            }
        }
    }
    let (staged_record_count, staged_canonical_bytes): (i64, i64) = transaction.query_row(
        "SELECT count(*), COALESCE(sum(length(record_canonical)), 0)
         FROM library_checkpoint_stage_records WHERE stage_id = ?1;",
        [stage_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if staged_record_count > expected_record_count {
        return Err(NormalizedSqliteError::InvalidRequest(
            "normalized checkpoint stage exceeds its expected record count",
        ));
    }
    transaction.execute(
        "UPDATE library_checkpoint_stages
         SET staged_record_count = ?2, staged_canonical_bytes = ?3
         WHERE stage_id = ?1;",
        params![stage_id, staged_record_count, staged_canonical_bytes],
    )?;
    transaction.commit()?;
    stage_status(connection, stage_id)
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
        encode_fractional_payload(&registry_key, &mut payload)?;
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
    use crate::normalized_import::{
        finalize_normalized_checkpoint_stage_v2, normalized_checkpoint_digest_v2,
    };
    use crate::sqlite_contract_generated::{
        CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES, CONTENT_CHUNK_BYTES,
        SQLITE_SCOPE_ACTION_PROGRAMS,
    };
    use rusqlite::params;
    use serde_json::json;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("open");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
    }

    fn install_test_authority(connection: &Connection, accepted_counter: i64) {
        let accepted_operation_id = (accepted_counter > 0).then_some("operation-2");
        connection
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES ('epoch-1', 'library-1', 1, ?1, ?2, ?3, '{}', 7, ?4, ?5, 400);",
                params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(64),
                    "d".repeat(64),
                    "e".repeat(64),
                ],
            )
            .expect("authority epoch");
        connection
            .execute(
                "INSERT INTO library_active_authority
                 (active_key, library_id, epoch_id, writer_id,
                  accepted_manifest_generation, activated_at)
                 VALUES ('active', 'library-1', 'epoch-1', 'writer-1', 7, 400);",
                [],
            )
            .expect("active authority");
        connection
            .execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  created_at, updated_at)
                 VALUES ('actor-1', 'epoch-1', 'desktop', ?1, 'enroll-1', ?2,
                         '{}', ?3, ?4, ?5, ?6, 500, 1000);",
                params![
                    "f".repeat(64),
                    "1".repeat(64),
                    "2".repeat(64),
                    accepted_counter,
                    accepted_operation_id,
                    if accepted_counter == 0 {
                        "2".repeat(64)
                    } else {
                        "3".repeat(64)
                    },
                ],
            )
            .expect("actor");
        connection
            .execute(
                "INSERT INTO library_actor_capabilities
                 (capability_id, actor_id, certificate_version, actor_class,
                  scope_mode, issuance_identity, retirement_identity,
                  certificate_digest, canonical_certificate, issued_at)
                 VALUES ('capability-1', 'actor-1', 2, 'editor', 'library_wide',
                         ?1, ?2, ?3, '{}', 500);",
                params!["5".repeat(64), "6".repeat(64), "4".repeat(64)],
            )
            .expect("capability");
        connection
            .execute(
                "INSERT INTO library_actor_capability_mutations
                 (capability_id, mutation_id)
                 VALUES ('capability-1', 'feed_item_read_assignment');",
                [],
            )
            .expect("capability mutation");
        if accepted_counter > 0 {
            connection
                .execute(
                    "INSERT INTO library_authority_frontier
                     (epoch_id, ordinal, actor_id, accepted_counter,
                      accepted_operation_id, accepted_chain_digest)
                     VALUES ('epoch-1', 0, 'actor-1', ?1, 'operation-2', ?2);",
                    params![accepted_counter, "3".repeat(64)],
                )
                .expect("authority frontier");
        }
    }

    fn checkpoint_header() -> NormalizedCheckpointRecordV2 {
        checked_record(
            "00_checkpoint_header",
            json!("checkpoint"),
            json!({
                "authorityEpoch": "epoch-1",
                "checkpointId": "library-1:epoch-1:7",
                "createdAtMs": 1000,
                "libraryId": "library-1",
                "schemaVersion": 1,
                "sourceRevision": 7,
            }),
        )
        .expect("checkpoint header")
    }

    #[test]
    fn normalized_checkpoint_digest_matches_the_typescript_vector() {
        assert_eq!(
            normalized_checkpoint_digest_v2(&[checkpoint_header()]).expect("digest"),
            "ce8a03cfece925243956fa104b7b583139da09036a14a1d7615a8994891d4104"
        );
    }

    fn begin_stage(
        connection: &Connection,
        stage_id: &str,
        records: &[NormalizedCheckpointRecordV2],
        digest: String,
    ) {
        begin_normalized_checkpoint_stage_v2(
            connection,
            &BeginNormalizedCheckpointStageV2 {
                stage_id: stage_id.into(),
                library_id: "library-1".into(),
                authority_epoch: "epoch-1".into(),
                source_revision: 7,
                expected_record_count: records.len(),
                expected_checkpoint_digest: digest,
                created_at: 1000,
            },
        )
        .expect("begin stage");
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
        let identity: (u32, u32, u32, String) = connection
            .query_row(
                "SELECT contract_version, schema_version, protocol_version, schema_sha256
                 FROM library_storage_meta WHERE singleton_id = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("storage identity");
        assert_eq!(
            identity,
            (
                SQLITE_CONTRACT_VERSION,
                SQLITE_SCHEMA_VERSION,
                SQLITE_PROTOCOL_VERSION,
                NORMALIZED_SCHEMA_SHA256.into(),
            )
        );
        for table in [
            "library_authority_epochs",
            "library_active_authority",
            "library_actor_capabilities",
            "library_transactions",
            "library_operations",
            "library_replication_outbox",
            "library_invalidations",
            "library_intent_transactions",
            "library_intent_members",
            "library_intent_results",
            "library_intent_result_cursors",
            "library_optimistic_fields",
        ] {
            let exists: i64 = connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1;",
                    [table],
                    |row| row.get(0),
                )
                .expect("operation table");
            assert_eq!(exists, 1, "missing {table}");
        }
    }

    #[test]
    fn scope_action_programs_freeze_and_page_only_finalized_members() {
        let connection = fixture();
        let sql = |program_id: &str| {
            SQLITE_SCOPE_ACTION_PROGRAMS
                .iter()
                .find_map(|(candidate, sql)| (*candidate == program_id).then_some(*sql))
                .expect("scope action program")
        };
        connection
            .execute(
                sql("create"),
                params!["stage-1", "read", "a".repeat(64), 1_000],
            )
            .expect("create stage");
        connection
            .execute(
                sql("append"),
                params!["stage-1", 0, r#"["item-1","item-2"]"#],
            )
            .expect("append members");
        connection
            .execute(
                "UPDATE library_device_scope_actions
                 SET member_count = member_count + 2
                 WHERE action_id = 'stage-1' AND state = 'staging' AND member_count = 0;",
                [],
            )
            .expect("advance member count");
        let before_finalize: i64 = connection
            .query_row(sql("page"), params!["stage-1", -1, 1_000], |_| Ok(1))
            .optional()
            .expect("read staging page")
            .unwrap_or(0);
        assert_eq!(before_finalize, 0);
        assert_eq!(
            connection
                .execute(sql("finalize"), params!["stage-1", 2])
                .expect("finalize stage"),
            1
        );
        let mut statement = connection.prepare(sql("page")).expect("prepare page");
        let members = statement
            .query_map(params!["stage-1", -1, 1_000], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .expect("page members")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect members");
        assert_eq!(members, vec![(0, "item-1".into()), (1, "item-2".into())]);
        assert_eq!(
            connection
                .execute(sql("delete"), ["stage-1"])
                .expect("delete stage"),
            1
        );
        let member_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM library_device_scope_action_members;",
                [],
                |row| row.get(0),
            )
            .expect("member count");
        assert_eq!(member_count, 0);
    }

    #[test]
    fn schema_install_refuses_a_foreign_application_identity_without_writes() {
        let connection = Connection::open_in_memory().expect("open");
        connection
            .pragma_update(None, "application_id", 7)
            .expect("foreign identity");
        let error = install_normalized_schema_v1(&connection).expect_err("foreign database");
        assert!(error.to_string().contains("identity is foreign"));
        let tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE type = 'table';",
                [],
                |row| row.get(0),
            )
            .expect("table count");
        assert_eq!(tables, 0);
    }

    #[test]
    fn operation_substrate_accepts_only_bounded_normalized_protocol_rows() {
        let mut connection = fixture();
        install_test_authority(&connection, 0);
        let transaction = connection.transaction().expect("transaction");
        for (transaction_id, counter, previous_operation_id, previous_revision) in [
            ("transaction-1", 1, None, 0),
            ("transaction-2", 2, Some("operation-1"), 1),
        ] {
            transaction
                .execute(
                    "INSERT INTO library_transactions
                     (transaction_id, transaction_digest, library_id, authority_epoch,
                      actor_id, member_count, first_counter, last_counter,
                      previous_operation_id, previous_chain_digest,
                      committed_operation_id, committed_chain_digest,
                      canonical_member_bytes, previous_revision, committed_revision,
                      committed_at)
                     VALUES (?1, ?2, 'library-1', 'epoch-1', 'actor-1', 1, ?3, ?3,
                             ?4, ?5, ?6, ?7, 131072, ?8, ?8 + 1, 1);",
                    params![
                        transaction_id,
                        format!("{:064x}", counter),
                        counter,
                        previous_operation_id,
                        format!("{:064x}", counter + 10),
                        format!("operation-{counter}"),
                        format!("{:064x}", counter + 20),
                        previous_revision,
                    ],
                )
                .expect("operation transaction");
        }
        transaction
            .execute(
                "INSERT INTO library_operations
                 (operation_id, transaction_id, member_index, member_count,
                  actor_id, actor_counter, previous_actor_operation_id,
                  previous_actor_chain_digest, actor_chain_digest, member_digest,
                  envelope_digest, mutation_id, entity_type, entity_id,
                  canonical_envelope, committed_at)
                 VALUES ('operation-1', 'transaction-1', 0, 1, 'actor-1', 1, NULL,
                         ?1, ?2, ?3, ?4, 'feed_item_read_assignment',
                         'feed_item', 'item-1', ?5, 1);",
                params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(64),
                    "d".repeat(64),
                    vec![7u8; 131_072],
                ],
            )
            .expect("bounded operation");
        let oversized = transaction.execute(
            "INSERT INTO library_operations
             (operation_id, transaction_id, member_index, member_count,
              actor_id, actor_counter, previous_actor_operation_id,
              previous_actor_chain_digest, actor_chain_digest, member_digest,
              envelope_digest, mutation_id, entity_type, entity_id,
              canonical_envelope, committed_at)
             VALUES ('operation-2', 'transaction-2', 0, 1, 'actor-1', 2, 'operation-1',
                     ?1, ?2, ?3, ?4, 'feed_item_read_assignment',
                     'feed_item', 'item-1', ?5, 1);",
            params![
                "b".repeat(64),
                "c".repeat(64),
                "d".repeat(64),
                "e".repeat(64),
                vec![9u8; 131_073],
            ],
        );
        assert!(oversized.is_err());
        transaction.rollback().expect("rollback");
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

    #[test]
    fn stages_bounded_typed_pages_idempotently_without_a_shell() {
        let mut connection = fixture();
        let records = split_content_records_v1(
            &vec![9; CONTENT_CHUNK_BYTES * 3 + 17],
            "application/octet-stream",
        )
        .expect("records");
        let request = BeginNormalizedCheckpointStageV2 {
            stage_id: "stage-1".into(),
            library_id: "library-1".into(),
            authority_epoch: "epoch-1".into(),
            source_revision: 7,
            expected_record_count: records.len(),
            expected_checkpoint_digest: "a".repeat(64),
            created_at: 1000,
        };
        let initial = begin_normalized_checkpoint_stage_v2(&connection, &request).expect("begin");
        assert_eq!(initial.staged_record_count, 0);
        let first =
            append_normalized_checkpoint_stage_page_v2(&mut connection, "stage-1", &records[..2])
                .expect("first page");
        assert_eq!(first.staged_record_count, 2);
        let replay =
            append_normalized_checkpoint_stage_page_v2(&mut connection, "stage-1", &records[..2])
                .expect("exact replay");
        assert_eq!(replay, first);
        let complete =
            append_normalized_checkpoint_stage_page_v2(&mut connection, "stage-1", &records[2..])
                .expect("remaining page");
        assert!(complete.complete);
        assert_eq!(complete.staged_record_count, records.len());
        let shell_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM library_checkpoint_stage_records
                 WHERE registry_key LIKE '%shell%';",
                [],
                |row| row.get(0),
            )
            .expect("shell count");
        assert_eq!(shell_count, 0);
    }

    #[test]
    fn changed_staged_record_replay_fails_without_changing_the_stage() {
        let mut connection = fixture();
        let records =
            split_content_records_v1(&[9; 17], "application/octet-stream").expect("records");
        begin_stage(
            &connection,
            "stage-changed-replay",
            &records,
            "a".repeat(64),
        );
        let first = append_normalized_checkpoint_stage_page_v2(
            &mut connection,
            "stage-changed-replay",
            &records[..1],
        )
        .expect("first record");
        let mut changed = records[0].clone();
        changed.payload["mediaType"] = json!("text/plain");
        let error = append_normalized_checkpoint_stage_page_v2(
            &mut connection,
            "stage-changed-replay",
            &[changed],
        )
        .expect_err("changed replay");
        assert!(error
            .to_string()
            .contains("record replay changed its bytes"));
        assert_eq!(
            stage_status(&connection, "stage-changed-replay").expect("stage status"),
            first
        );
    }

    #[test]
    fn checkpoint_digest_mismatch_rolls_back_activation_and_preserves_the_stage() {
        let mut connection = fixture();
        let records = vec![checkpoint_header()];
        begin_stage(&connection, "stage-bad-digest", &records, "a".repeat(64));
        append_normalized_checkpoint_stage_page_v2(&mut connection, "stage-bad-digest", &records)
            .expect("stage records");
        let error = finalize_normalized_checkpoint_stage_v2(&mut connection, "stage-bad-digest")
            .expect_err("digest mismatch");
        assert!(error.to_string().contains("digest does not match"));
        let materialized: i64 = connection
            .query_row("SELECT count(*) FROM library_meta;", [], |row| row.get(0))
            .expect("materialized rows");
        assert_eq!(materialized, 0);
        assert!(
            stage_status(&connection, "stage-bad-digest")
                .expect("preserved stage")
                .complete
        );
    }

    #[test]
    fn activation_refuses_an_independent_row_in_the_target() {
        let mut connection = fixture();
        connection
            .execute(
                "INSERT INTO library_preferences (path, value_type, updated_at)
                 VALUES ('v:$.existing', 'null', 1);",
                [],
            )
            .expect("existing preference");
        let records = vec![checkpoint_header()];
        let digest = normalized_checkpoint_digest_v2(&records).expect("digest");
        begin_stage(&connection, "stage-nonempty", &records, digest);
        append_normalized_checkpoint_stage_page_v2(&mut connection, "stage-nonempty", &records)
            .expect("stage records");
        let error = finalize_normalized_checkpoint_stage_v2(&mut connection, "stage-nonempty")
            .expect_err("nonempty target");
        assert!(error.to_string().contains("target is not empty"));
        let preferences: i64 = connection
            .query_row("SELECT count(*) FROM library_preferences;", [], |row| {
                row.get(0)
            })
            .expect("preferences");
        assert_eq!(preferences, 1);
    }

    #[test]
    fn unresolved_foreign_reference_rolls_back_activation() {
        let mut connection = fixture();
        let records = vec![
            checkpoint_header(),
            checked_record(
                "13_feed_item_tag",
                json!(["missing-item", "favorite"]),
                json!({ "tag": "favorite" }),
            )
            .expect("orphan tag"),
        ];
        let digest = normalized_checkpoint_digest_v2(&records).expect("digest");
        begin_stage(&connection, "stage-orphan", &records, digest);
        append_normalized_checkpoint_stage_page_v2(&mut connection, "stage-orphan", &records)
            .expect("stage records");
        let error = finalize_normalized_checkpoint_stage_v2(&mut connection, "stage-orphan")
            .expect_err("foreign reference");
        assert!(error.to_string().contains("unresolved foreign reference"));
        let materialized: i64 = connection
            .query_row(
                "SELECT (SELECT count(*) FROM library_meta) +
                        (SELECT count(*) FROM library_feed_item_tags);",
                [],
                |row| row.get(0),
            )
            .expect("materialized rows");
        assert_eq!(materialized, 0);
        assert!(
            stage_status(&connection, "stage-orphan")
                .expect("preserved stage")
                .complete
        );
    }

    #[test]
    fn activation_refuses_a_checkpoint_without_accepted_authority() {
        let mut connection = fixture();
        let records = vec![checkpoint_header()];
        let digest = normalized_checkpoint_digest_v2(&records).expect("digest");
        begin_stage(&connection, "stage-no-authority", &records, digest);
        append_normalized_checkpoint_stage_page_v2(&mut connection, "stage-no-authority", &records)
            .expect("stage records");
        let error = finalize_normalized_checkpoint_stage_v2(&mut connection, "stage-no-authority")
            .expect_err("missing authority");
        assert!(error.to_string().contains("active authority"));
        let materialized: i64 = connection
            .query_row("SELECT count(*) FROM library_meta;", [], |row| row.get(0))
            .expect("materialized rows");
        assert_eq!(materialized, 0);
    }

    #[test]
    fn activates_staged_records_and_reexports_the_exact_normalized_checkpoint() {
        let source = fixture();
        install_test_authority(&source, 2);
        source
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
                 VALUES (1, 'library-1', 1, 'epoch-1', 7, 1000);",
                [],
            )
            .expect("meta");
        source
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
        source
            .execute(
                "INSERT INTO library_feed_item_tags (global_id, tag)
                 VALUES ('saved:item-1', 'favorite');",
                [],
            )
            .expect("item tag");
        source
            .execute(
                "INSERT INTO library_persons
                 (id, name, relationship_status, care_level, created_at, updated_at)
                 VALUES ('person-1', 'Ada', 'friend', 5, 900, 1000);",
                [],
            )
            .expect("person");
        source
            .execute(
                "INSERT INTO library_person_tags (person_id, tag)
                 VALUES ('person-1', 'mathematician');",
                [],
            )
            .expect("person tag");
        let content = vec![23; CONTENT_CHUNK_BYTES + 17];
        let content_records =
            split_content_records_v1(&content, "text/plain").expect("content records");
        let content_digest = content_records[0]
            .primary_key
            .as_str()
            .expect("content digest");
        source
            .execute(
                "INSERT INTO library_blobs
                 (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
                 VALUES (?1, ?2, ?3, ?4, 'text/plain');",
                params![
                    content_digest,
                    i64::try_from(content.len()).expect("content length"),
                    i64::try_from(CONTENT_CHUNK_BYTES).expect("chunk bytes"),
                    i64::try_from(content_records.len() - 1).expect("chunk count")
                ],
            )
            .expect("blob");
        for (index, record) in content_records.iter().skip(1).enumerate() {
            source
                .execute(
                    "INSERT INTO library_blob_chunks
                     (content_digest, chunk_index, chunk_digest, bytes)
                     VALUES (?1, ?2, ?3, ?4);",
                    params![
                        content_digest,
                        i64::try_from(index).expect("index"),
                        record.payload["chunkContentDigest"]
                            .as_str()
                            .expect("chunk digest"),
                        BASE64
                            .decode(record.payload["bytesBase64"].as_str().expect("base64"))
                            .expect("chunk bytes")
                    ],
                )
                .expect("chunk");
        }
        source
            .execute(
                "UPDATE library_feed_items
                 SET content_text = NULL, content_text_blob_digest = ?1
                 WHERE global_id = 'saved:item-1';",
                [content_digest],
            )
            .expect("item blob reference");
        source
            .execute_batch(
                "INSERT INTO library_feed_item_media
                   (global_id, ordinal, source_url, media_type, blob_content_digest)
                 VALUES ('saved:item-1', 0, 'https://example.com/media', 'link', NULL);
                 INSERT INTO library_feed_item_topics (global_id, topic)
                 VALUES ('saved:item-1', 'systems');
                 INSERT INTO library_feed_item_highlights
                   (global_id, ordinal, text_value, text_blob_digest, note, created_at)
                 VALUES ('saved:item-1', 0, 'bounded highlight', NULL, 'note', 950);
                 INSERT INTO library_feed_item_signals (global_id, version, method, inferred_at)
                 VALUES ('saved:item-1', 1, 'rules', 960);
                 INSERT INTO library_feed_item_signal_scores (global_id, signal, score, tagged)
                 VALUES ('saved:item-1', 'essay', 0.75, 1);
                 INSERT INTO library_feed_item_events
                   (global_id, version, method, detected_at, confidence, title)
                 VALUES ('saved:item-1', 1, 'rules', 970, 0.8, 'Event');
                 INSERT INTO library_rss_feeds
                   (url, title, enabled, track_unread, updated_at)
                 VALUES ('https://example.com/feed', 'Example', 1, 0, 1000);
                 INSERT INTO library_person_reach_outs
                   (person_id, reach_out_id, logged_at, channel, notes)
                 VALUES ('person-1', 'reach-out-1', 980, 'email', 'hello');
                 INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, first_seen_at,
                    last_seen_at, discovered_from, created_at, updated_at)
                 VALUES ('account-1', 'person-1', 'social', 'x', 'external-1', 700,
                         900, 'captured_item', 700, 1000);
                 INSERT INTO library_account_follow_roles (account_id, role)
                 VALUES ('account-1', 'following');
                 INSERT INTO library_preferences (path, value_type, updated_at)
                 VALUES ('v:$.display.optional', 'null', 1000);
                 INSERT INTO library_relationships
                   (subject_type, subject_id, relation_type, object_type, object_id,
                    created_at, updated_at)
                 VALUES ('person', 'person-1', 'authored', 'item', 'saved:item-1', 900, 1000);
                 INSERT INTO library_field_clocks
                   (entity_type, entity_id, field_path, actor_id, counter, operation_id, updated_at)
                 VALUES ('feed_item', 'saved:item-1', 'saved', 'actor-1', 1, 'operation-1', 1000);
                 INSERT INTO library_tombstones
                   (entity_type, entity_id, actor_id, counter, operation_id, deleted_at)
                 VALUES ('rss_feed', 'removed-feed', 'actor-1', 2, 'operation-2', 1000);
                 INSERT INTO library_receipts
                   (actor_id, operation_id, status, digest, accepted_at)
                 VALUES ('actor-1', 'operation-1', 'accepted',
                         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1000);",
            )
            .expect("complete normalized fixture");
        let page = export_normalized_checkpoint_page_v2(
            &source,
            &NormalizedCheckpointExportRequestV2::default(),
        )
        .expect("source export");
        assert!(page.done);
        let registry_keys: std::collections::HashSet<_> = page
            .records
            .iter()
            .map(|record| record.registry_key.as_str())
            .collect();
        assert_eq!(registry_keys.len(), 28);
        let digest = normalized_checkpoint_digest_v2(&page.records).expect("digest");

        let mut target = fixture();
        begin_normalized_checkpoint_stage_v2(
            &target,
            &BeginNormalizedCheckpointStageV2 {
                stage_id: "stage-activation".into(),
                library_id: "library-1".into(),
                authority_epoch: "epoch-1".into(),
                source_revision: 7,
                expected_record_count: page.records.len(),
                expected_checkpoint_digest: digest.clone(),
                created_at: 1000,
            },
        )
        .expect("begin");
        append_normalized_checkpoint_stage_page_v2(&mut target, "stage-activation", &page.records)
            .expect("stage");
        let receipt = finalize_normalized_checkpoint_stage_v2(&mut target, "stage-activation")
            .expect("activate");
        assert_eq!(receipt.checkpoint_digest, digest);
        assert_eq!(receipt.record_count, page.records.len());
        assert_eq!(
            target
                .query_row(
                    "SELECT generation_id FROM library_materialization_generation
                     WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("materialization generation"),
            digest
        );
        assert_eq!(
            target
                .query_row(
                    "SELECT revision FROM library_change_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("activated revision"),
            7
        );
        assert_eq!(
            target
                .query_row(
                    "SELECT revision, topic, entity_id, reset_required
                     FROM library_invalidations;",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .expect("checkpoint reset invalidation"),
            (7, "library".to_owned(), None, 1)
        );
        let restored = export_normalized_checkpoint_page_v2(
            &target,
            &NormalizedCheckpointExportRequestV2::default(),
        )
        .expect("target export");
        assert_eq!(restored.records, page.records);
        let staged_rows: i64 = target
            .query_row(
                "SELECT count(*) FROM library_checkpoint_stage_records;",
                [],
                |row| row.get(0),
            )
            .expect("staged rows");
        assert_eq!(staged_rows, 0);
    }
}
