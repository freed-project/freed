use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::library_core_canonical::encode_canonical_value;
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{
    NORMALIZED_OPERATION_EXPORT_FORMAT, NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES,
    NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES,
    NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES,
    NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS, NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION,
};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn canonical_json(value: &[u8]) -> Result<Value, NormalizedSqliteError> {
    if value.len() < 2 || value.len() > NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES {
        return Err(invalid(
            "normalized operation record exceeds its byte bound",
        ));
    }
    let parsed: Value = serde_json::from_slice(value)
        .map_err(|_| invalid("normalized operation record is not JSON"))?;
    if encode_canonical_value(&parsed, NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES)
        .map_err(|_| invalid("normalized operation record is not canonical"))?
        != value
    {
        return Err(invalid(
            "normalized operation record is not exact canonical JSON",
        ));
    }
    Ok(parsed)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedOperationExportDescriptorV2 {
    pub authority_epoch: String,
    pub first_available_revision: i64,
    pub format: String,
    pub library_id: String,
    pub operation_count: usize,
    pub protocol_version: u8,
    pub source_revision: i64,
    pub transaction_count: usize,
    pub writer_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NormalizedOperationRecordKindV2 {
    AcceptedTransaction,
    Operation,
}

impl NormalizedOperationRecordKindV2 {
    fn ordinal(&self) -> i64 {
        match self {
            Self::AcceptedTransaction => 0,
            Self::Operation => 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedOperationCursorV2 {
    pub kind: NormalizedOperationRecordKindV2,
    pub member_index: i64,
    pub record_digest: String,
    pub source_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedOperationExportRequestV2 {
    pub after: Option<NormalizedOperationCursorV2>,
    pub after_source_revision: i64,
    pub maximum_records: usize,
    pub maximum_response_bytes: usize,
    pub snapshot: NormalizedOperationExportDescriptorV2,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedOperationExportRecordV2 {
    pub canonical_record_json: String,
    pub kind: NormalizedOperationRecordKindV2,
    pub member_index: i64,
    pub record_digest: String,
    pub source_revision: i64,
    pub transaction_digest: String,
    pub transaction_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedOperationExportPageV2 {
    pub canonical_record_bytes: usize,
    pub done: bool,
    pub next_cursor: Option<NormalizedOperationCursorV2>,
    pub records: Vec<NormalizedOperationExportRecordV2>,
}

type AuthorityIdentity = (String, String, String, i64);

fn authority_identity(connection: &Connection) -> Result<AuthorityIdentity, NormalizedSqliteError> {
    connection
        .query_row(
            "SELECT meta.library_id, meta.authority_epoch, active.writer_id,
                    meta.source_revision
             FROM library_meta AS meta
             JOIN library_active_authority AS active
               ON active.library_id = meta.library_id
              AND active.epoch_id = meta.authority_epoch
             WHERE meta.singleton_id = 1 AND active.active_key = 'active';",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(Into::into)
}

type ReplicationCounts = (i64, usize, usize);

fn replication_counts(
    connection: &Connection,
    through_revision: i64,
) -> Result<ReplicationCounts, NormalizedSqliteError> {
    let accepted: (Option<i64>, i64, i64) = connection.query_row(
        "SELECT min(tx.committed_revision), count(*),
                COALESCE(sum(tx.member_count), 0)
         FROM library_transactions AS tx
         JOIN library_follower_result_outbox AS result
           ON result.transaction_id = tx.transaction_id
          AND result.transaction_digest = tx.transaction_digest
          AND result.authoritative_source_revision = tx.committed_revision
          AND result.status = 'accepted'
         WHERE tx.committed_revision <= ?1;",
        [through_revision],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let total_transactions: i64 = connection.query_row(
        "SELECT count(*) FROM library_transactions
         WHERE committed_revision <= ?1;",
        [through_revision],
        |row| row.get(0),
    )?;
    if accepted.1 != total_transactions || accepted.1 < 0 || accepted.2 < 0 {
        return Err(NormalizedSqliteError::Transport(
            "normalized operation replication has an unsigned transaction gap".into(),
        ));
    }
    let transaction_count = usize::try_from(accepted.1)
        .map_err(|_| invalid("normalized operation transaction count is invalid"))?;
    let operation_count = usize::try_from(accepted.2)
        .map_err(|_| invalid("normalized operation count is invalid"))?;
    Ok((
        accepted.0.unwrap_or(through_revision.saturating_add(1)),
        transaction_count,
        operation_count,
    ))
}

pub fn describe_normalized_operation_export_v2(
    connection: &Connection,
) -> Result<NormalizedOperationExportDescriptorV2, NormalizedSqliteError> {
    let (library_id, authority_epoch, writer_id, source_revision) = authority_identity(connection)?;
    if !(0..=MAX_SAFE_INTEGER).contains(&source_revision)
        || !is_lower_sha256(&library_id)
        || !is_lower_sha256(&authority_epoch)
        || !is_lower_sha256(&writer_id)
    {
        return Err(NormalizedSqliteError::Transport(
            "normalized operation authority identity is invalid".into(),
        ));
    }
    let (first_available_revision, transaction_count, operation_count) =
        replication_counts(connection, source_revision)?;
    Ok(NormalizedOperationExportDescriptorV2 {
        authority_epoch,
        first_available_revision,
        format: NORMALIZED_OPERATION_EXPORT_FORMAT.to_owned(),
        library_id,
        operation_count,
        protocol_version: NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION,
        source_revision,
        transaction_count,
        writer_id,
    })
}

fn verify_snapshot(
    connection: &Connection,
    snapshot: &NormalizedOperationExportDescriptorV2,
) -> Result<(), NormalizedSqliteError> {
    if snapshot.format != NORMALIZED_OPERATION_EXPORT_FORMAT
        || snapshot.protocol_version != NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION
        || snapshot.source_revision < 0
        || snapshot.source_revision > MAX_SAFE_INTEGER
    {
        return Err(invalid("normalized operation export snapshot is invalid"));
    }
    let current = authority_identity(connection)?;
    if current.0 != snapshot.library_id
        || current.1 != snapshot.authority_epoch
        || current.2 != snapshot.writer_id
        || current.3 < snapshot.source_revision
    {
        return Err(invalid("normalized operation export authority changed"));
    }
    let counts = replication_counts(connection, snapshot.source_revision)?;
    if counts
        != (
            snapshot.first_available_revision,
            snapshot.transaction_count,
            snapshot.operation_count,
        )
    {
        return Err(invalid("normalized operation export snapshot changed"));
    }
    Ok(())
}

fn validate_accepted_result(
    connection: &Connection,
    record: &NormalizedOperationExportRecordV2,
    value: &Value,
) -> Result<(), NormalizedSqliteError> {
    let object = value
        .as_object()
        .ok_or(invalid("normalized accepted transaction is not an object"))?;
    let text = |field: &str| object.get(field).and_then(Value::as_str);
    let revision = object
        .get("authoritative_source_revision")
        .and_then(Value::as_i64);
    let operation_ids = object
        .get("canonical_operation_ids")
        .and_then(Value::as_array)
        .ok_or(invalid("normalized accepted transaction has no operations"))?
        .iter()
        .map(|value| value.as_str().map(str::to_owned))
        .collect::<Option<Vec<_>>>()
        .ok_or(invalid("normalized accepted operation identity is invalid"))?;
    if text("format") != Some("freed_follower_result_v1")
        || text("status") != Some("accepted")
        || text("transaction_id") != Some(record.transaction_id.as_str())
        || text("transaction_digest") != Some(record.transaction_digest.as_str())
        || text("result_body_digest") != Some(record.record_digest.as_str())
        || revision != Some(record.source_revision)
    {
        return Err(invalid("normalized accepted transaction identity changed"));
    }
    let mut statement = connection.prepare(
        "SELECT operation_id FROM library_operations
         WHERE transaction_id = ?1 ORDER BY member_index;",
    )?;
    let stored = statement
        .query_map([&record.transaction_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if stored.is_empty() || stored != operation_ids {
        return Err(invalid("normalized accepted operation set changed"));
    }
    Ok(())
}

fn validate_operation_record(
    record: &NormalizedOperationExportRecordV2,
    value: &Value,
) -> Result<(), NormalizedSqliteError> {
    let object = value
        .as_object()
        .ok_or(invalid("normalized operation is not an object"))?;
    if object.get("transaction_id").and_then(Value::as_str) != Some(record.transaction_id.as_str())
        || object.get("transaction_digest").and_then(Value::as_str)
            != Some(record.transaction_digest.as_str())
        || object
            .get("transaction_member_index")
            .and_then(Value::as_i64)
            != Some(record.member_index)
        || crate::normalized_operation_verifier::digest_hex(
            "operation-envelope",
            value,
            usize::try_from(record.member_index).unwrap_or(usize::MAX),
        )
        .map_err(|_| invalid("normalized operation record digest is invalid"))?
            != record.record_digest
    {
        return Err(invalid("normalized operation record identity changed"));
    }
    Ok(())
}

fn serialized_page_bytes(
    page: &NormalizedOperationExportPageV2,
) -> Result<usize, NormalizedSqliteError> {
    serde_json::to_vec(page)
        .map(|bytes| bytes.len())
        .map_err(|error| {
            NormalizedSqliteError::Transport(format!(
                "normalized operation page encoding failed: {error}"
            ))
        })
}

pub fn export_normalized_operation_page_v2(
    connection: &Connection,
    request: &NormalizedOperationExportRequestV2,
) -> Result<NormalizedOperationExportPageV2, NormalizedSqliteError> {
    if request.after_source_revision < 0
        || request.after_source_revision > request.snapshot.source_revision
        || request.maximum_records == 0
        || request.maximum_records > NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS
        || request.maximum_response_bytes == 0
        || request.maximum_response_bytes > NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid("normalized operation export bounds are invalid"));
    }
    verify_snapshot(connection, &request.snapshot)?;
    let (after_revision, after_kind, after_member) = match request.after.as_ref() {
        Some(cursor)
            if cursor.source_revision > request.after_source_revision
                && cursor.source_revision <= request.snapshot.source_revision
                && is_lower_sha256(&cursor.record_digest)
                && ((matches!(
                    cursor.kind,
                    NormalizedOperationRecordKindV2::AcceptedTransaction
                ) && cursor.member_index == -1)
                    || (matches!(cursor.kind, NormalizedOperationRecordKindV2::Operation)
                        && (0..1_000).contains(&cursor.member_index))) =>
        {
            let exact: Option<String> = connection
                .query_row(
                    "WITH records AS (
                       SELECT tx.committed_revision AS source_revision, 0 AS kind,
                              -1 AS member_index, result.result_digest AS record_digest
                       FROM library_transactions AS tx
                     JOIN library_follower_result_outbox AS result
                         ON result.transaction_id = tx.transaction_id
                        AND result.transaction_digest = tx.transaction_digest
                        AND result.authoritative_source_revision = tx.committed_revision
                        AND result.status = 'accepted'
                       UNION ALL
                       SELECT tx.committed_revision, 1, operation.member_index,
                              operation.envelope_digest
                       FROM library_transactions AS tx
                       JOIN library_operations AS operation
                         ON operation.transaction_id = tx.transaction_id
                     )
                     SELECT record_digest FROM records
                     WHERE source_revision = ?1 AND kind = ?2 AND member_index = ?3;",
                    params![
                        cursor.source_revision,
                        cursor.kind.ordinal(),
                        cursor.member_index
                    ],
                    |row| row.get(0),
                )
                .optional()?;
            if exact.as_deref() != Some(cursor.record_digest.as_str()) {
                return Err(invalid("normalized operation cursor changed"));
            }
            (
                cursor.source_revision,
                cursor.kind.ordinal(),
                cursor.member_index,
            )
        }
        Some(_) => return Err(invalid("normalized operation cursor is invalid")),
        None => (request.after_source_revision, 1, 999),
    };
    let fetch_limit = request.maximum_records.saturating_add(1);
    let mut statement = connection.prepare(
        "WITH records AS (
           SELECT tx.committed_revision AS source_revision, 0 AS kind,
                  -1 AS member_index, result.result_digest AS record_digest,
                  result.canonical_result AS canonical_record,
                  tx.transaction_id, tx.transaction_digest
           FROM library_transactions AS tx
           JOIN library_follower_result_outbox AS result
             ON result.transaction_id = tx.transaction_id
            AND result.transaction_digest = tx.transaction_digest
            AND result.authoritative_source_revision = tx.committed_revision
            AND result.status = 'accepted'
           UNION ALL
           SELECT tx.committed_revision, 1, operation.member_index,
                  operation.envelope_digest, operation.canonical_envelope,
                  tx.transaction_id, tx.transaction_digest
           FROM library_transactions AS tx
           JOIN library_operations AS operation
             ON operation.transaction_id = tx.transaction_id
         )
         SELECT source_revision, kind, member_index, record_digest,
                canonical_record, transaction_id, transaction_digest
         FROM records
         WHERE source_revision <= ?1
           AND (source_revision > ?2 OR
                (source_revision = ?2 AND kind > ?3) OR
                (source_revision = ?2 AND kind = ?3 AND member_index > ?4))
         ORDER BY source_revision, kind, member_index
         LIMIT ?5;",
    )?;
    let mut rows = statement.query(params![
        request.snapshot.source_revision,
        after_revision,
        after_kind,
        after_member,
        i64::try_from(fetch_limit)
            .map_err(|_| invalid("normalized operation record limit is invalid"))?,
    ])?;
    let mut page = NormalizedOperationExportPageV2 {
        canonical_record_bytes: 0,
        done: true,
        next_cursor: request.after.clone(),
        records: Vec::with_capacity(request.maximum_records),
    };
    while let Some(row) = rows.next()? {
        if page.records.len() == request.maximum_records {
            break;
        }
        let kind_ordinal: i64 = row.get(1)?;
        let kind = match kind_ordinal {
            0 => NormalizedOperationRecordKindV2::AcceptedTransaction,
            1 => NormalizedOperationRecordKindV2::Operation,
            _ => return Err(invalid("normalized operation record kind is invalid")),
        };
        let canonical_bytes: Vec<u8> = row.get(4)?;
        let canonical = canonical_json(&canonical_bytes)?;
        let record = NormalizedOperationExportRecordV2 {
            canonical_record_json: String::from_utf8(canonical_bytes.clone())
                .map_err(|_| invalid("normalized operation record is not UTF-8"))?,
            kind: kind.clone(),
            member_index: row.get(2)?,
            record_digest: row.get(3)?,
            source_revision: row.get(0)?,
            transaction_id: row.get(5)?,
            transaction_digest: row.get(6)?,
        };
        if record.source_revision <= request.after_source_revision
            || record.source_revision > request.snapshot.source_revision
            || !is_lower_sha256(&record.record_digest)
            || !is_lower_sha256(&record.transaction_digest)
            || (matches!(
                record.kind,
                NormalizedOperationRecordKindV2::AcceptedTransaction
            ) && record.member_index != -1)
            || (matches!(record.kind, NormalizedOperationRecordKindV2::Operation)
                && !(0..1_000).contains(&record.member_index))
        {
            return Err(invalid("normalized operation record identity is invalid"));
        }
        match record.kind {
            NormalizedOperationRecordKindV2::AcceptedTransaction => {
                validate_accepted_result(connection, &record, &canonical)?;
            }
            NormalizedOperationRecordKindV2::Operation => {
                validate_operation_record(&record, &canonical)?;
            }
        }
        let cursor = NormalizedOperationCursorV2 {
            kind,
            member_index: record.member_index,
            record_digest: record.record_digest.clone(),
            source_revision: record.source_revision,
        };
        let previous_cursor = page.next_cursor.clone();
        page.canonical_record_bytes += canonical_bytes.len();
        page.records.push(record);
        page.next_cursor = Some(cursor);
        page.done = false;
        if page.canonical_record_bytes > NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES
            || serialized_page_bytes(&page)? > request.maximum_response_bytes
        {
            let removed = page.records.pop().expect("one appended record");
            page.canonical_record_bytes -= removed.canonical_record_json.len();
            page.next_cursor = previous_cursor;
            break;
        }
    }
    let cursor = page.next_cursor.as_ref();
    let remaining: Option<()> = connection
        .query_row(
            "WITH records AS (
               SELECT tx.committed_revision AS source_revision, 0 AS kind, -1 AS member_index
               FROM library_transactions AS tx
               JOIN library_follower_result_outbox AS result
                 ON result.transaction_id = tx.transaction_id
                AND result.transaction_digest = tx.transaction_digest
                AND result.authoritative_source_revision = tx.committed_revision
                AND result.status = 'accepted'
               UNION ALL
               SELECT tx.committed_revision, 1, operation.member_index
               FROM library_transactions AS tx
               JOIN library_operations AS operation ON operation.transaction_id = tx.transaction_id
             )
             SELECT 1 FROM records
             WHERE source_revision <= ?1
               AND (source_revision > ?2 OR
                    (source_revision = ?2 AND kind > ?3) OR
                    (source_revision = ?2 AND kind = ?3 AND member_index > ?4))
             LIMIT 1;",
            params![
                request.snapshot.source_revision,
                cursor
                    .map(|value| value.source_revision)
                    .unwrap_or(request.after_source_revision),
                cursor.map(|value| value.kind.ordinal()).unwrap_or(1),
                cursor.map(|value| value.member_index).unwrap_or(999),
            ],
            |_| Ok(()),
        )
        .optional()?;
    page.done = remaining.is_none();
    if page.records.is_empty() && !page.done {
        return Err(invalid(
            "normalized operation response cannot fit the next record",
        ));
    }
    if serialized_page_bytes(&page)? > request.maximum_response_bytes {
        return Err(NormalizedSqliteError::Transport(
            "normalized operation response exceeded its byte bound".into(),
        ));
    }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_mutation::{accept_normalized_operation_transaction_v1, tests::fixture};
    use crate::normalized_operation_test_fixtures::tests::{
        signed_envelopes, signed_envelopes_from_tip_with_payload,
    };
    use serde_json::json;

    fn request(
        snapshot: NormalizedOperationExportDescriptorV2,
        after: Option<NormalizedOperationCursorV2>,
        maximum_records: usize,
    ) -> NormalizedOperationExportRequestV2 {
        NormalizedOperationExportRequestV2 {
            after,
            after_source_revision: 0,
            maximum_records,
            maximum_response_bytes: NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES,
            snapshot,
        }
    }

    #[test]
    fn exports_one_accepted_transaction_before_its_exact_signed_members() {
        let (mut connection, key_pair, enrollment) = fixture();
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let receipt = accept_normalized_operation_transaction_v1(
            &mut connection,
            &envelopes,
            &key_pair,
            2_000,
        )
        .expect("accepted transaction");
        let snapshot = describe_normalized_operation_export_v2(&connection)
            .expect("operation export descriptor");

        assert_eq!(snapshot.source_revision, receipt.committed_revision);
        assert_eq!(
            snapshot.first_available_revision,
            receipt.committed_revision
        );
        assert_eq!(snapshot.transaction_count, 1);
        assert_eq!(snapshot.operation_count, envelopes.len());

        let page = export_normalized_operation_page_v2(
            &connection,
            &request(
                snapshot.clone(),
                None,
                NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS,
            ),
        )
        .expect("operation export page");
        assert!(page.done);
        assert_eq!(page.records.len(), envelopes.len() + 1);
        assert_eq!(
            page.records[0].kind,
            NormalizedOperationRecordKindV2::AcceptedTransaction
        );
        assert_eq!(page.records[0].member_index, -1);
        for (index, envelope) in envelopes.iter().enumerate() {
            let record = &page.records[index + 1];
            assert_eq!(record.kind, NormalizedOperationRecordKindV2::Operation);
            assert_eq!(record.member_index, index as i64);
            assert_eq!(record.canonical_record_json.as_bytes(), envelope);
            assert!(
                record.canonical_record_json.len()
                    <= NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES
            );
        }
        assert_eq!(
            page.canonical_record_bytes,
            page.records
                .iter()
                .map(|record| record.canonical_record_json.len())
                .sum::<usize>()
        );
        assert!(
            page.canonical_record_bytes <= NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES
        );
        assert!(
            serialized_page_bytes(&page).expect("serialized response")
                <= NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES
        );

        let replay = export_normalized_operation_page_v2(
            &connection,
            &request(snapshot, None, NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS),
        )
        .expect("exact replay");
        assert_eq!(replay, page);
    }

    #[test]
    fn cursor_pages_are_stable_and_reject_changed_identity() {
        let (mut connection, key_pair, enrollment) = fixture();
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        accept_normalized_operation_transaction_v1(&mut connection, &envelopes, &key_pair, 2_000)
            .expect("accepted transaction");
        let snapshot = describe_normalized_operation_export_v2(&connection)
            .expect("operation export descriptor");

        let first =
            export_normalized_operation_page_v2(&connection, &request(snapshot.clone(), None, 1))
                .expect("accepted result page");
        assert!(!first.done);
        assert_eq!(
            first.records[0].kind,
            NormalizedOperationRecordKindV2::AcceptedTransaction
        );
        let second = export_normalized_operation_page_v2(
            &connection,
            &request(snapshot.clone(), first.next_cursor.clone(), 1),
        )
        .expect("first member page");
        assert!(!second.done);
        assert_eq!(second.records[0].member_index, 0);
        let third = export_normalized_operation_page_v2(
            &connection,
            &request(snapshot.clone(), second.next_cursor.clone(), 1),
        )
        .expect("second member page");
        assert!(third.done);
        assert_eq!(third.records[0].member_index, 1);

        let mut changed = second.next_cursor.expect("member cursor");
        changed.record_digest = "f".repeat(64);
        let error =
            export_normalized_operation_page_v2(&connection, &request(snapshot, Some(changed), 1))
                .expect_err("changed cursor must fail");
        assert!(matches!(error, NormalizedSqliteError::InvalidRequest(_)));
    }

    #[test]
    fn maximum_inline_feed_body_remains_one_lossless_bounded_operation_record() {
        let (mut connection, key_pair, enrollment) = fixture();
        let body = "x".repeat(65_536);
        let payload = json!({
            "item": {
                "author": {
                    "displayName": "Bounded Author",
                    "handle": "bounded",
                    "id": "author:bounded"
                },
                "capturedAt": 3_000,
                "content": {
                    "mediaTypes": [],
                    "mediaUrls": [],
                    "text": body
                },
                "contentType": "article",
                "globalId": "saved:item:maximum-inline-body",
                "platform": "saved",
                "publishedAt": 3_000,
                "topics": [],
                "userState": {
                    "archived": false,
                    "hidden": false,
                    "saved": true,
                    "tags": []
                }
            }
        });
        let envelopes = signed_envelopes_from_tip_with_payload(
            &key_pair,
            &enrollment,
            "tx:capture:maximum-inline-body",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("saved:item:maximum-inline-body", 3_000)],
            "feed_item_capture_upsert",
            Some(&payload),
        );
        assert_eq!(envelopes.len(), 1);
        assert!(
            envelopes[0].len() <= NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES,
            "a legal inline body must fit one logical operation record"
        );
        accept_normalized_operation_transaction_v1(&mut connection, &envelopes, &key_pair, 3_000)
            .expect("accepted maximum inline body");
        let snapshot = describe_normalized_operation_export_v2(&connection)
            .expect("operation export descriptor");
        let page = export_normalized_operation_page_v2(
            &connection,
            &request(snapshot, None, NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS),
        )
        .expect("bounded operation page");
        let exported = page
            .records
            .iter()
            .find(|record| matches!(record.kind, NormalizedOperationRecordKindV2::Operation))
            .expect("operation record");
        assert_eq!(exported.canonical_record_json.as_bytes(), envelopes[0]);
        let restored: Value =
            serde_json::from_str(&exported.canonical_record_json).expect("exported operation");
        assert_eq!(
            restored["payload"]["item"]["content"]["text"]
                .as_str()
                .expect("restored body")
                .len(),
            65_536
        );
    }
}
