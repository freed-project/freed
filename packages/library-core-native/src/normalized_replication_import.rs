//! Ordered consumer materialization from the existing signed operation stream.
//! Staging commits separately so failed application can resume exact bytes.
use crate::normalized_follower::verify_normalized_follower_result_record_v1;
use crate::normalized_mutation::{
    actor_state_at, materialize_verified_normalized_transaction_v1, require_causal_tips,
    NormalizedFollowerResultRecordV1,
};
use crate::normalized_operation_verifier::{verify_operation_transaction, OperationIdentity};
use crate::normalized_replication::{
    NormalizedOperationExportDescriptorV2, NormalizedOperationExportPageV2,
    NormalizedOperationExportRecordV2, NormalizedOperationRecordKindV2,
};
use crate::normalized_sqlite::{normalized_writer_identity, NormalizedSqliteError};
use crate::normalized_transaction_validator::validate_transaction;
use crate::sqlite_contract_generated::{
    NORMALIZED_OPERATION_EXPORT_FORMAT, NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES,
    NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES,
    NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS, NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION,
    OPERATION_TRANSACTION_MAXIMUM_BYTES, OPERATION_TRANSACTION_MAXIMUM_MEMBERS,
    SQLITE_MUTATION_PROGRAMS,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

const MAX_SAFE: i64 = 9_007_199_254_740_991;
fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedOperationImportPageV2 {
    pub page: NormalizedOperationExportPageV2,
    pub received_at: i64,
    pub snapshot: NormalizedOperationExportDescriptorV2,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedOperationImportReceiptV2 {
    pub applied_through_revision: i64,
    pub applied_transaction_count: usize,
    pub received_at: i64,
    pub staged_record_count: usize,
    pub staged_transaction_count: usize,
}

fn text(value: &Value, key: &'static str) -> Result<String, NormalizedSqliteError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(invalid("replicated result text is invalid"))
}
fn integer(value: &Value, key: &'static str) -> Result<i64, NormalizedSqliteError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .filter(|v| (0..=MAX_SAFE).contains(v))
        .ok_or(invalid("replicated result integer is invalid"))
}
fn result_record(
    record: &NormalizedOperationExportRecordV2,
) -> Result<NormalizedFollowerResultRecordV1, NormalizedSqliteError> {
    let value =
        crate::normalized_replication::canonical_json(record.canonical_record_json.as_bytes())?;
    let optional = |key| match value.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(invalid("replicated result nullable identity is invalid")),
    };
    Ok(NormalizedFollowerResultRecordV1 {
        transaction_id: record.transaction_id.clone(),
        transaction_digest: record.transaction_digest.clone(),
        actor_id: text(&value, "actor_id")?,
        authority_epoch_id: text(&value, "epoch_id")?,
        intent_epoch_id: text(&value, "intent_epoch_id")?,
        result_sequence: integer(&value, "result_sequence")?,
        previous_result_digest: optional("previous_result_digest")?,
        result_digest: record.record_digest.clone(),
        status: text(&value, "status")?,
        rejection_reason: optional("rejection_reason")?,
        original_result_digest: optional("original_result_digest")?,
        authoritative_source_revision: record.source_revision,
        canonical_result_json: record.canonical_record_json.clone(),
        enqueued_at: integer(&value, "resolved_at_ms")?,
    })
}

fn consumer_revision(
    connection: &Connection,
    snapshot: &NormalizedOperationExportDescriptorV2,
) -> Result<i64, NormalizedSqliteError> {
    let (library, epoch, writer, revision) = normalized_writer_identity(connection)?;
    let (change_revision, admitted): (i64, bool) = connection.query_row(
        "SELECT revision, EXISTS(SELECT 1 FROM library_writer_admission) FROM library_change_state WHERE singleton_id = 1;",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if admitted
        || library != snapshot.library_id
        || epoch != snapshot.authority_epoch
        || writer != snapshot.writer_id
        || revision != change_revision
    {
        return Err(invalid("normalized operation consumer authority changed"));
    }
    Ok(revision)
}

fn accepted_result(
    connection: &Connection,
    record: &NormalizedOperationExportRecordV2,
    snapshot: &NormalizedOperationExportDescriptorV2,
) -> Result<(NormalizedFollowerResultRecordV1, Value, usize), NormalizedSqliteError> {
    let result = result_record(record)?;
    let value =
        verify_normalized_follower_result_record_v1(connection, &result, &snapshot.library_id)?;
    let count = value["canonical_operation_ids"]
        .as_array()
        .map(Vec::len)
        .ok_or(invalid("replicated result operations are invalid"))?;
    if result.status != "accepted"
        || result.rejection_reason.is_some()
        || result.original_result_digest.is_some()
        || result.authority_epoch_id != snapshot.authority_epoch
        || result.intent_epoch_id != snapshot.authority_epoch
        || integer(&value, "intent_epoch")? != integer(&value, "epoch")?
        || result.result_sequence < 1
        || count == 0
        || count > OPERATION_TRANSACTION_MAXIMUM_MEMBERS
        || value["receipt_ids"].as_array().map(Vec::len) != Some(count)
    {
        return Err(invalid("replicated accepted transaction is invalid"));
    }
    Ok((result, value, count))
}

fn validate_page(input: &NormalizedOperationImportPageV2) -> Result<(), NormalizedSqliteError> {
    let snapshot = &input.snapshot;
    if ![
        &snapshot.library_id,
        &snapshot.authority_epoch,
        &snapshot.writer_id,
    ]
    .iter()
    .all(|id| crate::library_core_hash::is_lower_sha256(id))
        || snapshot.transaction_count > MAX_SAFE as usize
        || snapshot.operation_count > MAX_SAFE as usize
        || snapshot.operation_count < snapshot.transaction_count
        || !(0..=MAX_SAFE).contains(&input.received_at)
        || !(0..=MAX_SAFE).contains(&snapshot.source_revision)
        || snapshot.first_available_revision < 0
        || snapshot.first_available_revision > snapshot.source_revision.saturating_add(1)
        || snapshot.format != NORMALIZED_OPERATION_EXPORT_FORMAT
        || snapshot.protocol_version != NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION
        || input.page.records.len() > NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS
        || input.page.canonical_record_bytes > NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES
    {
        return Err(invalid(
            "normalized operation import page exceeds its bounds",
        ));
    }
    let mut bytes = 0usize;
    let mut previous = None;
    for record in &input.page.records {
        bytes = bytes
            .checked_add(record.canonical_record_json.len())
            .ok_or(invalid("operation page byte count overflow"))?;
        let kind = match record.kind {
            NormalizedOperationRecordKindV2::AcceptedTransaction => 0,
            NormalizedOperationRecordKindV2::Operation => 1,
        };
        let key = (record.source_revision, kind, record.member_index);
        if record.transaction_id.is_empty()
            || record.transaction_id.len() > 255
            || !crate::library_core_hash::is_lower_sha256(&record.transaction_digest)
            || !crate::library_core_hash::is_lower_sha256(&record.record_digest)
            || bytes > NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES
            || record.source_revision < snapshot.first_available_revision
            || record.source_revision > snapshot.source_revision
            || record.source_revision < 1
            || (kind == 0 && record.member_index != -1)
            || (kind == 1 && !(0..1000).contains(&record.member_index))
            || previous.is_some_and(|previous| previous >= key)
        {
            return Err(invalid("normalized operation import order is invalid"));
        }
        crate::normalized_replication::canonical_json(record.canonical_record_json.as_bytes())?;
        previous = Some(key);
    }
    if bytes != input.page.canonical_record_bytes {
        return Err(invalid("normalized operation import byte count changed"));
    }
    let last = input.page.records.last();
    if last.is_none() != input.page.next_cursor.is_none() {
        return Err(invalid("normalized operation import cursor is absent"));
    }
    if let Some(cursor) = &input.page.next_cursor {
        if !last.is_some_and(|record| {
            record.source_revision == cursor.source_revision
                && record.kind == cursor.kind
                && record.member_index == cursor.member_index
                && record.record_digest == cursor.record_digest
        }) {
            return Err(invalid("normalized operation import cursor changed"));
        }
    } else if !input.page.done {
        return Err(invalid("normalized operation import cursor is absent"));
    }
    // Serialize only after every member and scalar has passed its input bound.
    if serde_json::to_vec(&input.page)
        .map_err(|_| invalid("operation page cannot serialize"))?
        .len()
        > NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES
    {
        return Err(invalid(
            "normalized operation import response exceeds its byte bound",
        ));
    }
    Ok(())
}

/// Stage bounded canonical bytes durably, then apply complete consecutive revisions.
/// No authority private key or writer admission is used or created by this path.
pub fn import_normalized_operation_page_v2(
    connection: &mut Connection,
    input: &NormalizedOperationImportPageV2,
) -> Result<NormalizedOperationImportReceiptV2, NormalizedSqliteError> {
    validate_page(input)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let revision = consumer_revision(&transaction, &input.snapshot)?;
    let mut touched = BTreeSet::new();
    for record in &input.page.records {
        touched.insert(record.source_revision);
        if record.source_revision <= revision {
            let exact: bool = match record.kind {
                NormalizedOperationRecordKindV2::AcceptedTransaction => transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM library_operation_replication_results AS r JOIN library_transactions AS t ON t.transaction_id = r.transaction_id WHERE r.source_revision = ?1 AND r.transaction_id = ?2 AND t.transaction_digest = ?3 AND r.result_digest = ?4 AND r.canonical_result = ?5);",
                    params![record.source_revision, record.transaction_id, record.transaction_digest, record.record_digest, record.canonical_record_json.as_bytes()], |r| r.get(0))?,
                NormalizedOperationRecordKindV2::Operation => transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM library_operations AS o JOIN library_transactions AS t ON t.transaction_id = o.transaction_id WHERE t.committed_revision = ?1 AND t.transaction_id = ?2 AND t.transaction_digest = ?3 AND o.envelope_digest = ?4 AND o.canonical_envelope = ?5 AND o.member_index = ?6);",
                    params![record.source_revision, record.transaction_id, record.transaction_digest, record.record_digest, record.canonical_record_json.as_bytes(), record.member_index], |r| r.get(0))?,
            };
            if !exact {
                return Err(invalid("normalized operation applied replay changed"));
            }
            continue;
        }
        match record.kind {
            NormalizedOperationRecordKindV2::AcceptedTransaction => {
                let (_, _, count) = accepted_result(&transaction, record, &input.snapshot)?;
                transaction.execute("INSERT OR IGNORE INTO library_operation_replication_stages (source_revision, transaction_id, transaction_digest, authority_epoch_id, writer_id, snapshot_source_revision, expected_member_count, result_digest, canonical_result, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);", params![record.source_revision,record.transaction_id,record.transaction_digest,input.snapshot.authority_epoch,input.snapshot.writer_id,input.snapshot.source_revision,count,record.record_digest,record.canonical_record_json.as_bytes(),input.received_at])?;
                let exact: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM library_operation_replication_stages WHERE source_revision = ?1 AND transaction_id = ?2 AND transaction_digest = ?3 AND authority_epoch_id = ?4 AND writer_id = ?5 AND snapshot_source_revision >= ?1 AND ?6 >= ?1 AND expected_member_count = ?7 AND result_digest = ?8 AND canonical_result = ?9);", params![record.source_revision,record.transaction_id,record.transaction_digest,input.snapshot.authority_epoch,input.snapshot.writer_id,input.snapshot.source_revision,count,record.record_digest,record.canonical_record_json.as_bytes()], |r| r.get(0))?;
                if !exact {
                    return Err(invalid("normalized operation staged result replay changed"));
                }
            }
            NormalizedOperationRecordKindV2::Operation => {
                let value = crate::normalized_replication::canonical_json(
                    record.canonical_record_json.as_bytes(),
                )?;
                crate::normalized_replication::validate_operation_record(record, &value)?;
                let operation_id = text(&value, "operation_id")?;
                let matches: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM library_operation_replication_stages WHERE source_revision = ?1 AND transaction_id = ?2 AND transaction_digest = ?3 AND authority_epoch_id = ?4 AND writer_id = ?5 AND expected_member_count > ?6);",params![record.source_revision,record.transaction_id,record.transaction_digest,input.snapshot.authority_epoch,input.snapshot.writer_id,record.member_index],|r|r.get(0))?;
                if !matches {
                    return Err(invalid(
                        "normalized operation member has no matching result",
                    ));
                }
                transaction.execute("INSERT OR IGNORE INTO library_operation_replication_stage_members (source_revision, member_index, operation_id, envelope_digest, canonical_envelope) VALUES (?1,?2,?3,?4,?5);",params![record.source_revision,record.member_index,operation_id,record.record_digest,record.canonical_record_json.as_bytes()])?;
                let exact: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM library_operation_replication_stage_members WHERE source_revision=?1 AND member_index=?2 AND operation_id=?3 AND envelope_digest=?4 AND canonical_envelope=?5);",params![record.source_revision,record.member_index,operation_id,record.record_digest,record.canonical_record_json.as_bytes()],|r|r.get(0))?;
                if !exact {
                    return Err(invalid("normalized operation staged member replay changed"));
                }
            }
        }
    }
    for revision in &touched {
        let bytes: i64 = transaction.query_row(
            "SELECT COALESCE(sum(length(canonical_envelope)),0) FROM library_operation_replication_stage_members WHERE source_revision=?1;",
            [revision], |row| row.get(0),
        )?;
        if bytes > OPERATION_TRANSACTION_MAXIMUM_BYTES as i64 {
            return Err(invalid(
                "staged transaction exceeds its canonical byte bound",
            ));
        }
    }
    transaction.commit()?;
    let mut applied = 0;
    // One bounded page can complete at most this many transactions. More durable
    // staged work resumes on the next pass rather than monopolizing the runtime.
    while applied < NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS
        && apply_next(connection, &input.snapshot)?
    {
        applied += 1;
    }
    Ok(NormalizedOperationImportReceiptV2 {
        applied_through_revision: consumer_revision(connection, &input.snapshot)?,
        applied_transaction_count: applied,
        received_at: input.received_at,
        staged_record_count: input.page.records.len(),
        staged_transaction_count: touched.len(),
    })
}

fn apply_next(
    connection: &mut Connection,
    snapshot: &NormalizedOperationExportDescriptorV2,
) -> Result<bool, NormalizedSqliteError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let previous = consumer_revision(&transaction, snapshot)?;
    let next = previous
        .checked_add(1)
        .filter(|v| *v <= MAX_SAFE)
        .ok_or(invalid("operation revision exhausted"))?;
    if next > snapshot.source_revision {
        return Ok(false);
    }
    type Stage = (
        String,
        String,
        String,
        String,
        i64,
        usize,
        String,
        Vec<u8>,
        i64,
    );
    let stage: Option<Stage> = transaction.query_row("SELECT transaction_id,transaction_digest,authority_epoch_id,writer_id,snapshot_source_revision,expected_member_count,result_digest,canonical_result,received_at FROM library_operation_replication_stages WHERE source_revision=?1;",[next],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?))).optional()?;
    let Some(stage) = stage else {
        return Ok(false);
    };
    if stage.2 != snapshot.authority_epoch || stage.3 != snapshot.writer_id || stage.4 < next {
        return Err(invalid("staged operation authority changed"));
    }
    let (count, bytes): (usize,usize) = transaction.query_row("SELECT count(*),COALESCE(sum(length(canonical_envelope)),0) FROM library_operation_replication_stage_members WHERE source_revision=?1;",[next],|r|Ok((r.get(0)?,r.get(1)?)))?;
    if count < stage.5 {
        return Ok(false);
    }
    if count != stage.5
        || count > OPERATION_TRANSACTION_MAXIMUM_MEMBERS
        || bytes > OPERATION_TRANSACTION_MAXIMUM_BYTES
    {
        return Err(invalid("staged transaction exceeds its bounds"));
    }
    let members: Vec<(i64,String,String,Vec<u8>)> = transaction.prepare("SELECT member_index,operation_id,envelope_digest,canonical_envelope FROM library_operation_replication_stage_members WHERE source_revision=?1 ORDER BY member_index;")?.query_map([next],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
    let record = NormalizedOperationExportRecordV2 {
        canonical_record_json: String::from_utf8(stage.7.clone())
            .map_err(|_| invalid("staged result is not UTF-8"))?,
        kind: NormalizedOperationRecordKindV2::AcceptedTransaction,
        member_index: -1,
        record_digest: stage.6.clone(),
        source_revision: next,
        transaction_digest: stage.1.clone(),
        transaction_id: stage.0.clone(),
    };
    let (result, value, _) = accepted_result(&transaction, &record, snapshot)?;
    let canonical: Vec<Vec<u8>> = members.iter().map(|m| m.3.clone()).collect();
    let verified = verify_operation_transaction(&canonical, |identity| {
        actor_state_at(&transaction, identity)
    })?;
    validate_transaction(&verified)?;
    let actor = actor_state_at(
        &transaction,
        &OperationIdentity {
            library_id: verified.library_id.clone(),
            epoch_id: verified.epoch_id.clone(),
            actor_id: verified.actor_id.clone(),
        },
    )?;
    let first = &verified.members[0];
    let last = verified.members.last().expect("verified members");
    if verified.transaction_id != result.transaction_id
        || verified.transaction_digest != result.transaction_digest
        || verified.actor_id != result.actor_id
        || verified.epoch_id != snapshot.authority_epoch
        || verified.library_id != snapshot.library_id
        || actor.next_sequence != first.actor_sequence
        || actor.previous_operation_id != first.previous_actor_operation_id
        || actor.previous_chain_digest != first.previous_actor_chain_digest
        || result.enqueued_at < last.created_at_ms
        || members
            .iter()
            .zip(&verified.members)
            .enumerate()
            .any(|(i, (stored, member))| {
                stored.0 != i as i64
                    || stored.1 != member.operation_id
                    || stored.2 != member.envelope_digest
                    || value["canonical_operation_ids"][i].as_str()
                        != Some(member.operation_id.as_str())
                    || value["receipt_ids"][i].as_str() != Some(member.envelope_digest.as_str())
            })
    {
        return Err(invalid("replicated transaction proof changed"));
    }
    let program = SQLITE_MUTATION_PROGRAMS
        .iter()
        .find(|p| p.mutation_id == first.operation_type)
        .copied()
        .ok_or(invalid("replicated mutation is not registered"))?;
    if verified.members.len() > program.maximum_members
        || verified.members.iter().any(|m| {
            m.operation_type != program.mutation_id || m.entity_type != program.entity_type
        })
    {
        return Err(invalid("replicated mutation program changed"));
    }
    require_causal_tips(&transaction, &verified)?;
    for member in &verified.members {
        if program.requires_existing_target
            && !transaction.query_row(program.target_exists_sql, [&member.entity_id], |r| {
                r.get::<_, bool>(0)
            })?
        {
            return Err(invalid("replicated mutation target is absent"));
        }
    }
    let revisions = materialize_verified_normalized_transaction_v1(
        &transaction,
        &verified,
        &actor,
        program,
        result.enqueued_at,
        false,
    )?;
    if revisions != (previous, next) {
        return Err(invalid("replicated revision changed"));
    }
    transaction.execute("DELETE FROM library_optimistic_fields WHERE transaction_id=?1 AND EXISTS(SELECT 1 FROM library_intent_transactions WHERE transaction_id=?1 AND transaction_digest=?2 AND state='accepted');",params![verified.transaction_id,verified.transaction_digest])?;
    transaction.execute("INSERT INTO library_operation_replication_results (source_revision,transaction_id,result_digest,canonical_result,received_at) VALUES (?1,?2,?3,?4,?5);",params![next,stage.0,stage.6,stage.7,stage.8])?;
    transaction.execute(
        "DELETE FROM library_operation_replication_stages WHERE source_revision=?1;",
        [next],
    )?;
    transaction.commit()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_mutation::{accept_normalized_operation_transaction_v1, tests::fixture};
    use crate::normalized_operation_test_fixtures::tests::signed_envelopes;
    use crate::normalized_replication::{
        describe_normalized_operation_export_v2, export_normalized_operation_page_v2,
        NormalizedOperationExportRequestV2,
    };

    #[test]
    fn partial_replay_restart_and_final_write_failure_preserve_consumer_authority() {
        let (mut primary, key, actor) = fixture();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("consumer.sqlite");
        let mut consumer = Connection::open(&path).unwrap();
        rusqlite::backup::Backup::new(&primary, &mut consumer)
            .unwrap()
            .run_to_completion(128, std::time::Duration::ZERO, None)
            .unwrap();
        consumer
            .execute_batch("PRAGMA foreign_keys=ON; DELETE FROM library_writer_admission;")
            .unwrap();
        let envelopes = signed_envelopes(&key, &actor);
        let accepted =
            accept_normalized_operation_transaction_v1(&mut primary, &envelopes, &key, 2_000)
                .unwrap();
        let snapshot = describe_normalized_operation_export_v2(&primary).unwrap();
        let request = |after| NormalizedOperationExportRequestV2 {
            snapshot: snapshot.clone(),
            after,
            after_source_revision: 0,
            maximum_records: 1,
            maximum_response_bytes: NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES,
        };
        let first = export_normalized_operation_page_v2(&primary, &request(None)).unwrap();
        assert_eq!(
            first.records[0].kind,
            NormalizedOperationRecordKindV2::AcceptedTransaction
        );
        let input = NormalizedOperationImportPageV2 {
            page: first.clone(),
            received_at: 3_000,
            snapshot: snapshot.clone(),
        };
        let receipt = import_normalized_operation_page_v2(&mut consumer, &input).unwrap();
        assert_eq!(receipt.applied_transaction_count, 0);
        assert_eq!(receipt.applied_through_revision, accepted.previous_revision);
        import_normalized_operation_page_v2(&mut consumer, &input).unwrap();
        // The signed transaction is unchanged in a later delivery/export snapshot.
        let mut later_delivery = input.clone();
        later_delivery.received_at += 10;
        later_delivery.snapshot.source_revision += 1;
        import_normalized_operation_page_v2(&mut consumer, &later_delivery).unwrap();
        let mut changed = input.clone();
        changed.page.records[0].record_digest = "f".repeat(64);
        changed.page.next_cursor.as_mut().unwrap().record_digest = "f".repeat(64);
        assert!(import_normalized_operation_page_v2(&mut consumer, &changed).is_err());
        drop(consumer);
        let mut consumer = Connection::open(&path).unwrap();
        consumer.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        consumer.execute_batch("CREATE TRIGGER fail_replica_proof BEFORE INSERT ON library_operation_replication_results BEGIN SELECT RAISE(ABORT,'injected final proof failure'); END;").unwrap();
        let mut cursor = first.next_cursor;
        let mut final_page = None;
        while let Some(after) = cursor {
            let page =
                export_normalized_operation_page_v2(&primary, &request(Some(after))).unwrap();
            cursor = if page.done {
                None
            } else {
                page.next_cursor.clone()
            };
            let input = NormalizedOperationImportPageV2 {
                page,
                received_at: 3_001,
                snapshot: snapshot.clone(),
            };
            if import_normalized_operation_page_v2(&mut consumer, &input).is_err() {
                final_page = Some(input);
                break;
            }
        }
        let final_page = final_page.expect("complete staged transaction hits proof fault");
        assert_eq!(
            consumer_revision(&consumer, &snapshot).unwrap(),
            accepted.previous_revision
        );
        assert_eq!(
            consumer
                .query_row("SELECT count(*) FROM library_operations;", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            consumer
                .query_row(
                    "SELECT count(*) FROM library_operation_replication_stage_members;",
                    [],
                    |r| r.get::<_, usize>(0)
                )
                .unwrap(),
            envelopes.len()
        );
        consumer
            .execute_batch("DROP TRIGGER fail_replica_proof;")
            .unwrap();
        let result = import_normalized_operation_page_v2(&mut consumer, &final_page).unwrap();
        assert_eq!(result.applied_transaction_count, 1);
        assert_eq!(result.applied_through_revision, accepted.committed_revision);
        assert_eq!(
            import_normalized_operation_page_v2(&mut consumer, &final_page)
                .unwrap()
                .applied_transaction_count,
            0
        );
        import_normalized_operation_page_v2(&mut consumer, &input).unwrap();
        for table in [
            "library_replication_outbox",
            "library_follower_result_outbox",
            "library_writer_admission",
            "library_operation_replication_stages",
        ] {
            assert_eq!(
                consumer
                    .query_row(&format!("SELECT count(*) FROM {table};"), [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0,
                "consumer must not retain {table}"
            );
        }
        let state = |c: &Connection| {
            c.query_row("SELECT read_at FROM library_feed_items LIMIT 1;", [], |r| {
                r.get::<_, Option<i64>>(0)
            })
            .unwrap()
        };
        assert_eq!(state(&consumer), state(&primary));
        assert!(crate::normalized_primary_mutation_context_v1(&consumer).is_err());
        assert!(import_normalized_operation_page_v2(&mut primary, &input).is_err());
    }
    #[test]
    fn future_revision_waits_for_its_predecessor_and_bad_signature_never_stages() {
        use crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip;
        let (mut primary, key, actor) = fixture();
        let mut consumer = Connection::open_in_memory().unwrap();
        rusqlite::backup::Backup::new(&primary, &mut consumer)
            .unwrap()
            .run_to_completion(128, std::time::Duration::ZERO, None)
            .unwrap();
        consumer
            .execute_batch("PRAGMA foreign_keys=ON; DELETE FROM library_writer_admission;")
            .unwrap();
        let first = accept_normalized_operation_transaction_v1(
            &mut primary,
            &signed_envelopes(&key, &actor),
            &key,
            2_000,
        )
        .unwrap();
        let later = signed_envelopes_from_tip(
            &key,
            &actor,
            "tx:replication:next",
            first.last_counter + 1,
            Some(&first.committed_operation_id),
            &first.committed_chain_digest,
            &[("rss:item:1", 3_000)],
            "feed_item_saved_assignment",
        );
        let second =
            accept_normalized_operation_transaction_v1(&mut primary, &later, &key, 4_000).unwrap();
        let snapshot = describe_normalized_operation_export_v2(&primary).unwrap();
        let all = export_normalized_operation_page_v2(
            &primary,
            &NormalizedOperationExportRequestV2 {
                after: None,
                after_source_revision: 0,
                maximum_records: 128,
                maximum_response_bytes: NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES,
                snapshot: snapshot.clone(),
            },
        )
        .unwrap();
        let page = |revision| {
            let records: Vec<_> = all
                .records
                .iter()
                .filter(|r| r.source_revision == revision)
                .cloned()
                .collect();
            NormalizedOperationImportPageV2 {
                received_at: 5_000,
                snapshot: snapshot.clone(),
                page: NormalizedOperationExportPageV2 {
                    canonical_record_bytes: records
                        .iter()
                        .map(|r| r.canonical_record_json.len())
                        .sum(),
                    done: true,
                    next_cursor: records.last().map(|record| {
                        crate::normalized_replication::NormalizedOperationCursorV2 {
                            kind: record.kind.clone(),
                            member_index: record.member_index,
                            record_digest: record.record_digest.clone(),
                            source_revision: record.source_revision,
                        }
                    }),
                    records,
                },
            }
        };
        let mut corrupt = page(first.committed_revision);
        let mut result: Value =
            serde_json::from_str(&corrupt.page.records[0].canonical_record_json).unwrap();
        result["signature"] = Value::String("0".repeat(128));
        corrupt.page.records[0].canonical_record_json = String::from_utf8(
            crate::library_core_canonical::encode_canonical_value(&result, 131_072).unwrap(),
        )
        .unwrap();
        assert!(import_normalized_operation_page_v2(&mut consumer, &corrupt).is_err());
        assert_eq!(
            consumer
                .query_row(
                    "SELECT count(*) FROM library_operation_replication_stages;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let future =
            import_normalized_operation_page_v2(&mut consumer, &page(second.committed_revision))
                .unwrap();
        assert_eq!(future.applied_transaction_count, 0);
        assert_eq!(future.applied_through_revision, first.previous_revision);
        let caught_up =
            import_normalized_operation_page_v2(&mut consumer, &page(first.committed_revision))
                .unwrap();
        assert_eq!(caught_up.applied_transaction_count, 2);
        assert_eq!(
            caught_up.applied_through_revision,
            second.committed_revision
        );
        let state = |db: &Connection| {
            db.query_row(
                "SELECT saved, archived FROM library_feed_items WHERE global_id='rss:item:1';",
                [],
                |r| Ok((r.get::<_, bool>(0)?, r.get::<_, bool>(1)?)),
            )
            .unwrap()
        };
        assert_eq!(state(&consumer), state(&primary));
    }
}
