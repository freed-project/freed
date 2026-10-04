//! Bounded native recovery inputs. Loading archive bytes is not signature
//! verification, proof of acceptance, or permission to submit another edit.
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

#[derive(Debug)]
pub(crate) struct ArchivedIntentInput {
    pub transaction_id: String,
    pub transaction_digest: String,
    pub actor_id: String,
    pub epoch_id: String,
    pub state: String,
    pub first_counter: u64,
    pub envelopes: Vec<Vec<u8>>,
}

struct ArchivedCells {
    names: Vec<String>,
    values: Vec<Vec<String>>,
}
impl ArchivedCells {
    fn cell(&self, name: &str, kind: &str) -> Result<&str, String> {
        let index = self
            .names
            .iter()
            .position(|value| value == name)
            .ok_or("archived intent column is missing")?;
        let value = &self.values[index];
        if value.len() != 2 || value[0] != kind {
            return Err("archived intent cell type is invalid".into());
        }
        Ok(&value[1])
    }
    fn optional_text(&self, name: &str) -> Result<Option<String>, String> {
        let index = self
            .names
            .iter()
            .position(|value| value == name)
            .ok_or("archived result column is missing")?;
        if self.values[index] == ["null"] {
            return Ok(None);
        }
        self.text(name).map(Some)
    }
    fn text(&self, name: &str) -> Result<String, String> {
        String::from_utf8(self.blob_value(name, "text")?)
            .map_err(|_| "archived intent text is invalid".into())
    }
    fn blob_value(&self, name: &str, kind: &str) -> Result<Vec<u8>, String> {
        STANDARD
            .decode(self.cell(name, kind)?)
            .map_err(|_| "archived intent bytes are invalid".into())
    }
    fn integer(&self, name: &str) -> Result<u64, String> {
        let text = self.cell(name, "integer")?;
        let value: u64 = text
            .parse()
            .map_err(|_| "archived intent integer is invalid")?;
        if value > 9_007_199_254_740_991 || value.to_string() != text {
            return Err("archived intent integer is invalid".into());
        }
        Ok(value)
    }
}

fn columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table});"))
        .map_err(|e| e.to_string())?;
    let result = statement
        .query_map([], |r| r.get(1))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(|e| e.to_string())?;
    Ok(result)
}

fn decode(row: &rusqlite::Row<'_>, expected: &[String]) -> Result<ArchivedCells, String> {
    let names: String = row.get(0).map_err(|e| e.to_string())?;
    let bytes: Vec<u8> = row.get(1).map_err(|e| e.to_string())?;
    let digest: String = row.get(2).map_err(|e| e.to_string())?;
    if bytes.len() > 2_097_152
        || names.len() > 16_384
        || crate::lower_hex(&Sha256::digest(&bytes)) != digest
    {
        return Err("archived intent row integrity failed".into());
    }
    let names: Vec<String> =
        serde_json::from_str(&names).map_err(|_| "archived intent columns are invalid")?;
    let value = crate::library_core_canonical::decode_canonical_value(&bytes, 2_097_152)
        .map_err(|_| "archived intent row is not canonical")?
        .into_value();
    let values: Vec<Vec<String>> =
        serde_json::from_value(value).map_err(|_| "archived intent cells are invalid")?;
    if names != expected || values.len() != names.len() {
        return Err("archived intent row shape changed".into());
    }
    Ok(ArchivedCells { names, values })
}

/// The transaction index bounds both lookups. At most 1,000 envelopes and 4 MiB
/// are hydrated, matching native intent transaction admission. Callers must
/// independently verify every original signature and determine its outcome.
pub(crate) fn load_archived_intent_input(
    connection: &Connection,
    recovery_id: &str,
    transaction_id: &str,
) -> Result<ArchivedIntentInput, String> {
    if !crate::library_core_hash::is_lower_sha256(recovery_id)
        || transaction_id.is_empty()
        || transaction_id.len() > 255
    {
        return Err("archived intent selector is invalid".into());
    }
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version != crate::sqlite_contract_generated::NATIVE_STORAGE_SCHEMA_VERSION {
        return Err("archived intent requires native recovery storage".into());
    }
    crate::normalized_sqlite::install_normalized_schema_v1(connection)
        .map_err(|e| e.to_string())?;
    let (actor, epoch): (String, String) = connection.query_row(
        "SELECT archive.actor_id, archive.predecessor_epoch_id FROM library_local_recovery_archives AS archive
         JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = archive.library_id
         WHERE recovery_id = ?1 AND archive.schema_sha256 = ?2;",
        params![recovery_id, crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| "archived intent does not belong to the selected Library")?;
    let transaction_columns = columns(connection, "library_intent_transactions")?;
    let member_columns = columns(connection, "library_intent_members")?;
    let mut statement = connection.prepare(
        "SELECT columns_json, canonical_row, row_digest FROM library_local_recovery_rows INDEXED BY library_local_recovery_transaction_rows
         WHERE recovery_id = ?1 AND table_key = 'library_intent_transactions' AND transaction_id = ?2
         ORDER BY row_ordinal LIMIT 2;"
    ).map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![recovery_id, transaction_id])
        .map_err(|e| e.to_string())?;
    let transaction = decode(
        rows.next()
            .map_err(|e| e.to_string())?
            .ok_or("archived intent is missing")?,
        &transaction_columns,
    )?;
    if rows.next().map_err(|e| e.to_string())?.is_some() {
        return Err("archived intent identity is ambiguous".into());
    }
    let count = transaction.integer("member_count")?;
    let first = transaction.integer("first_counter")?;
    let last = transaction.integer("last_counter")?;
    if transaction.text("transaction_id")? != transaction_id
        || transaction.text("actor_id")? != actor
        || transaction.text("intent_epoch_id")? != epoch
        || !(1..=1000).contains(&count)
        || first == 0
        || last.checked_sub(first).and_then(|v| v.checked_add(1)) != Some(count)
    {
        return Err("archived intent identity or counter range changed".into());
    }
    let state = transaction.text("state")?;
    if !["pending", "published", "accepted", "rejected"].contains(&state.as_str()) {
        return Err("archived intent state is invalid".into());
    }
    let mut members = connection
        .prepare(
            "SELECT columns_json, canonical_row, row_digest FROM library_local_recovery_rows INDEXED BY library_local_recovery_transaction_rows
         WHERE recovery_id = ?1 AND table_key = 'library_intent_members' AND transaction_id = ?2
         ORDER BY row_ordinal LIMIT ?3;",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = members
        .query(params![recovery_id, transaction_id, count + 1])
        .map_err(|e| e.to_string())?;
    let mut envelopes = Vec::new();
    let mut bytes = 0usize;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if envelopes.len() >= count as usize {
            return Err("archived intent has extra members".into());
        }
        let member = decode(row, &member_columns)?;
        if member.text("transaction_id")? != transaction_id
            || member.text("actor_id")? != actor
            || member.integer("member_index")? != envelopes.len() as u64
            || member.integer("actor_counter")? != first + envelopes.len() as u64
        {
            return Err("archived intent member sequence changed".into());
        }
        let envelope = member.blob_value("canonical_member", "blob")?;
        bytes = bytes
            .checked_add(envelope.len())
            .ok_or("archived intent byte count overflow")?;
        if envelope.is_empty() || envelope.len() > 131_072 || bytes > 4_194_304 {
            return Err("archived intent exceeds its verification bounds".into());
        }
        envelopes.push(envelope);
    }
    if envelopes.len() != count as usize
        || bytes as u64 != transaction.integer("canonical_member_bytes")?
    {
        return Err("archived intent members are incomplete".into());
    }
    Ok(ArchivedIntentInput {
        transaction_id: transaction_id.into(),
        transaction_digest: transaction.text("transaction_digest")?,
        actor_id: actor,
        epoch_id: epoch,
        state,
        first_counter: first,
        envelopes,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ArchivedIntentOutcomeV1 {
    Unresolved,
    ConfirmedAccepted {
        committed_revision: i64,
    },
    /// A historical rejection by the original authority, not permission to retry.
    ReportedRejected {
        reason: String,
        result_digest: String,
    },
}

/// The caller owns the read snapshot. Return only members whose original
/// signatures and archived identity have been checked against the selected Library.
/// Neither a historical rejection nor an unresolved outcome authorizes a new intent.
pub(crate) fn inspect_archived_intent_for_review(
    connection: &Connection,
    recovery_id: &str,
    transaction_id: &str,
) -> Result<
    (
        crate::normalized_operation::VerifiedOperationTransaction,
        ArchivedIntentOutcomeV1,
    ),
    String,
> {
    let input = load_archived_intent_input(connection, recovery_id, transaction_id)?;
    let verified = verify_archived_input_with_history(connection, &input, Some(recovery_id))?;
    let acceptance = inspect_verified_acceptance(connection, &verified)?;
    let outcome = match load_archived_result(connection, recovery_id, transaction_id)? {
        Some(record) => inspect_result_evidence(connection, &input, acceptance, &record)?,
        None => acceptance,
    };
    Ok((verified, outcome))
}

fn load_archived_result(
    connection: &Connection,
    recovery_id: &str,
    transaction_id: &str,
) -> Result<Option<crate::normalized_mutation::NormalizedFollowerResultRecordV1>, String> {
    let expected = columns(connection, "library_intent_results")?;
    let mut statement = connection.prepare(
        "SELECT columns_json, canonical_row, row_digest FROM library_local_recovery_rows INDEXED BY library_local_recovery_transaction_rows
         WHERE recovery_id = ?1 AND table_key = 'library_intent_results' AND transaction_id = ?2
         ORDER BY row_ordinal LIMIT 2;"
    ).map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![recovery_id, transaction_id])
        .map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let cells = decode(row, &expected)?;
    if rows.next().map_err(|e| e.to_string())?.is_some() {
        return Err("archived result identity is ambiguous".into());
    }
    let bytes = cells.blob_value("canonical_result", "blob")?;
    let value = crate::library_core_canonical::decode_canonical_value(&bytes, 131_072)
        .map_err(|_| "archived result is not canonical")?
        .into_value();
    let text = |name: &str| {
        value
            .get(name)
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "archived result text is invalid".to_string())
    };
    let optional = |name: &str| match value.get(name) {
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(text)) => Ok(Some(text.clone())),
        _ => Err("archived result nullable text is invalid".to_string()),
    };
    if cells.text("transaction_id")? != transaction_id {
        return Err("archived result transaction index changed".into());
    }
    Ok(Some(
        crate::normalized_mutation::NormalizedFollowerResultRecordV1 {
            transaction_id: cells.text("transaction_id")?,
            transaction_digest: text("transaction_digest")?,
            actor_id: cells.text("actor_id")?,
            authority_epoch_id: cells.text("authority_epoch_id")?,
            intent_epoch_id: cells.text("intent_epoch_id")?,
            result_sequence: cells.integer("result_sequence")? as i64,
            previous_result_digest: cells.optional_text("previous_result_digest")?,
            result_digest: cells.text("result_digest")?,
            status: cells.text("status")?,
            rejection_reason: optional("rejection_reason")?,
            original_result_digest: optional("original_result_digest")?,
            authoritative_source_revision: cells.integer("authoritative_source_revision")? as i64,
            canonical_result_json: String::from_utf8(bytes)
                .map_err(|_| "archived result is not UTF-8")?,
            enqueued_at: cells.integer("received_at")? as i64,
        },
    ))
}

// Called only after the original transaction signatures and canonical receipts
// have been inspected in the same read snapshot. Archived flags are not proof.
fn inspect_result_evidence(
    connection: &Connection,
    input: &ArchivedIntentInput,
    acceptance: ArchivedIntentOutcomeV1,
    record: &crate::normalized_mutation::NormalizedFollowerResultRecordV1,
) -> Result<ArchivedIntentOutcomeV1, String> {
    let (library_id, revision): (String, i64) = connection
        .query_row(
            "SELECT library_id, source_revision FROM library_meta WHERE singleton_id = 1;",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let value = crate::normalized_follower::verify_normalized_follower_result_record_v1(
        connection,
        record,
        &library_id,
    )
    .map_err(|e| format!("archived result verification failed: {e}"))?;
    if record.transaction_id != input.transaction_id
        || record.transaction_digest != input.transaction_digest
        || record.actor_id != input.actor_id
        || record.intent_epoch_id != input.epoch_id
        || !(1..=9_007_199_254_740_991).contains(&record.result_sequence)
        || !(0..=revision).contains(&record.authoritative_source_revision)
    {
        return Err("archived result does not match its original intent".into());
    }
    // A new authority can reject an old epoch without knowing whether the old
    // authority accepted it. Such a result cannot settle historical recovery.
    if record.status != "rejected" || record.authority_epoch_id != input.epoch_id {
        return Ok(acceptance);
    }
    let reason = record
        .rejection_reason
        .as_deref()
        .ok_or("archived rejection has no reason")?;
    if ![
        "actor_retired",
        "capability_denied",
        "precondition_failed",
        "target_missing",
        "target_tombstoned",
    ]
    .contains(&reason)
        || record.original_result_digest.is_some()
        || value.get("canonical_operation_ids") != Some(&serde_json::json!([]))
        || value.get("receipt_ids") != Some(&serde_json::json!([]))
    {
        return Err("archived rejection outcome is invalid".into());
    }
    if matches!(
        acceptance,
        ArchivedIntentOutcomeV1::ConfirmedAccepted { .. }
    ) {
        return Err("archived rejection contradicts canonical acceptance".into());
    }
    Ok(ArchivedIntentOutcomeV1::ReportedRejected {
        reason: reason.into(),
        result_digest: record.result_digest.clone(),
    })
}

#[cfg(test)]
fn verify_archived_input(
    connection: &Connection,
    input: &ArchivedIntentInput,
) -> Result<crate::normalized_operation::VerifiedOperationTransaction, String> {
    verify_archived_input_with_history(connection, input, None)
}

fn historical_archive_actor(
    connection: &Connection,
    recovery_id: &str,
    identity: &crate::normalized_operation_verifier::OperationIdentity,
) -> Result<crate::normalized_operation::ActorState, String> {
    let names = columns(connection, "library_follower_actor_request")?;
    let mut statement = connection.prepare(
        "SELECT rows.columns_json, rows.canonical_row, rows.row_digest
         FROM library_local_recovery_rows AS rows
         JOIN library_local_recovery_archives AS archive ON archive.recovery_id = rows.recovery_id
         WHERE rows.recovery_id = ?1 AND rows.table_key = 'library_follower_actor_request'
          AND archive.library_id = ?2 AND archive.predecessor_epoch_id = ?3 AND archive.actor_id = ?4
         ORDER BY rows.row_ordinal LIMIT 2;"
    ).map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![
            recovery_id,
            identity.library_id,
            identity.epoch_id,
            identity.actor_id
        ])
        .map_err(|e| e.to_string())?;
    let request = decode(
        rows.next()
            .map_err(|e| e.to_string())?
            .ok_or("historical actor enrollment is missing")?,
        &names,
    )?;
    if rows.next().map_err(|e| e.to_string())?.is_some()
        || request.integer("singleton_id")? != 1
        || request.text("library_id")? != identity.library_id
        || request.text("authority_epoch_id")? != identity.epoch_id
        || request.text("actor_id")? != identity.actor_id
    {
        return Err("historical actor enrollment identity is ambiguous or changed".into());
    }
    let certificate = request.text("canonical_enrollment_certificate")?;
    let decoded =
        crate::library_core_canonical::decode_canonical_value(certificate.as_bytes(), 65_536)
            .map_err(|_| "historical enrollment certificate is not bounded canonical data")?
            .into_value();
    let frontier = crate::normalized_enrollment_verifier::parse_causal_tips(
        decoded
            .pointer("/certificate_body/actor_enrollment_body/observed_frontier")
            .ok_or("historical enrollment frontier is missing")?,
    )
    .map_err(|e| e.to_string())?;
    let authority = connection.query_row(
        "SELECT epoch_number, authority_key_id, authority_public_key FROM library_authority_epochs WHERE library_id = ?1 AND epoch_id = ?2;",
        params![identity.library_id, identity.epoch_id], |row| Ok(crate::normalized_authority::NormalizedAuthorityStateV2 {
            library_id: identity.library_id.clone(), epoch_id: identity.epoch_id.clone(), epoch: row.get(0)?,
            authority_key_id: row.get(1)?, authority_public_key: row.get(2)?, observed_frontier: frontier.clone(),
        }),
    ).map_err(|_| "historical enrollment authority is missing")?;
    let enrollment = crate::normalized_enrollment_verifier::verify_actor_enrollment(
        certificate.as_bytes(),
        &authority,
    )
    .map_err(|e| format!("historical enrollment verification failed: {e}"))?;
    if enrollment.actor_id != identity.actor_id
        || enrollment.actor_public_key != request.text("actor_public_key")?
        || enrollment.enrollment_certificate_digest
            != request.text("enrollment_certificate_digest")?
        || enrollment.actor_chain_genesis != request.text("actor_chain_genesis")?
    {
        return Err("historical enrollment differs from its archived request".into());
    }
    Ok(crate::normalized_operation::ActorState {
        library_id: enrollment.library_id,
        epoch: enrollment.epoch,
        epoch_id: enrollment.epoch_id,
        actor_id: enrollment.actor_id,
        actor_public_key: enrollment.actor_public_key,
        enrollment_operation_id: enrollment.enrollment_operation_id,
        enrollment_certificate_digest: enrollment.enrollment_certificate_digest,
        canonical_enrollment_certificate_json: enrollment.canonical_enrollment_certificate_json,
        actor_chain_genesis: enrollment.actor_chain_genesis.clone(),
        // Resolution checks transaction signatures and internal chains, not an
        // invented current actor tip. This snapshot can never admit new writes.
        next_sequence: 1,
        previous_operation_id: None,
        previous_chain_digest: enrollment.actor_chain_genesis,
        capability: enrollment.capability,
        retired: true,
    })
}

fn verify_archived_input_with_history(
    connection: &Connection,
    input: &ArchivedIntentInput,
    recovery_id: Option<&str>,
) -> Result<crate::normalized_operation::VerifiedOperationTransaction, String> {
    let (verified, _) =
        crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
            &input.envelopes,
            |identity| match crate::normalized_mutation::actor_state_at(connection, identity) {
                Err(crate::library_core_error::LibraryCoreError::ActorNotFound { .. })
                    if recovery_id.is_some() =>
                {
                    historical_archive_actor(
                        connection,
                        recovery_id.expect("checked archive identity"),
                        identity,
                    )
                    .map_err(|_| {
                        crate::library_core_error::LibraryCoreError::InvalidVerifiedInput {
                            field: "historical_archive_actor",
                        }
                    })
                }
                result => result,
            },
        )
        .map_err(|e| format!("archived intent signature verification failed: {e}"))?;
    if verified.transaction_id != input.transaction_id
        || verified.transaction_digest != input.transaction_digest
        || verified.actor_id != input.actor_id
        || verified.epoch_id != input.epoch_id
        || verified
            .members
            .first()
            .map(|member| member.actor_sequence as u64)
            != Some(input.first_counter)
        || !["pending", "published", "accepted", "rejected"].contains(&input.state.as_str())
    {
        return Err("archived intent metadata differs from its signed transaction".into());
    }
    Ok(verified)
}

#[cfg(test)]
fn inspect_input_acceptance(
    connection: &Connection,
    input: &ArchivedIntentInput,
) -> Result<ArchivedIntentOutcomeV1, String> {
    inspect_verified_acceptance(connection, &verify_archived_input(connection, input)?)
}

fn inspect_verified_acceptance(
    connection: &Connection,
    verified: &crate::normalized_operation::VerifiedOperationTransaction,
) -> Result<ArchivedIntentOutcomeV1, String> {
    use rusqlite::OptionalExtension;
    let current_revision: i64 = connection
        .query_row(
            "SELECT source_revision FROM library_meta WHERE singleton_id = 1 AND library_id = ?1;",
            [&verified.library_id],
            |r| r.get(0),
        )
        .map_err(|_| "archived intent is outside the selected Library")?;
    let mut accepted = 0usize;
    let mut commit = None;
    let mut statement = connection.prepare(
        "SELECT status, digest, result_text, result_blob_digest, accepted_at FROM library_receipts
         WHERE actor_id = ?1 AND operation_id = ?2;"
    ).map_err(|e| e.to_string())?;
    type CanonicalReceipt = (String, String, Option<String>, Option<String>, i64);
    for member in &verified.members {
        let receipt: Option<CanonicalReceipt> = statement
            .query_row(params![verified.actor_id, member.operation_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((status, digest, text, blob, accepted_at)) = receipt else {
            continue;
        };
        if status != "accepted"
            || digest != member.envelope_digest
            || blob.is_some()
            || !(0..=9_007_199_254_740_991).contains(&accepted_at)
        {
            return Err("archived intent conflicts with its canonical receipt".into());
        }
        let text = text.ok_or("archived intent acceptance receipt is incomplete")?;
        let value = crate::library_core_canonical::decode_canonical_value(text.as_bytes(), 65_536)
            .map_err(|_| "archived intent acceptance receipt is not canonical")?
            .into_value();
        let object = value
            .as_object()
            .ok_or("archived intent acceptance receipt is invalid")?;
        let revision = object
            .get("committedRevision")
            .and_then(serde_json::Value::as_i64)
            .filter(|revision| (0..=current_revision).contains(revision))
            .ok_or("archived intent acceptance revision is invalid")?;
        if object.len() != 2
            || object
                .get("operationId")
                .and_then(serde_json::Value::as_str)
                != Some(member.operation_id.as_str())
        {
            return Err("archived intent acceptance receipt identity changed".into());
        }
        if commit.is_some_and(|previous| previous != (revision, accepted_at)) {
            return Err("archived intent receipts do not form one atomic commit".into());
        }
        commit = Some((revision, accepted_at));
        accepted += 1;
    }
    if accepted == 0 {
        return Ok(ArchivedIntentOutcomeV1::Unresolved);
    }
    if accepted != verified.members.len() {
        return Err("archived intent has incomplete canonical acceptance receipts".into());
    }
    Ok(ArchivedIntentOutcomeV1::ConfirmedAccepted {
        committed_revision: commit.ok_or("archived intent acceptance is missing")?.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_review_returns_only_verified_members_and_binds_continuation() {
        use crate::library_core_canonical::encode_canonical_value;
        use crate::normalized_mutation::accept_normalized_operation_transaction_v1;
        use crate::normalized_query::query_normalized_json_v1;
        use serde_json::json;
        let (mut connection, _, old_enrollment) = crate::normalized_mutation::tests::fixture();
        use ring::signature::{Ed25519KeyPair, KeyPair};
        struct CertificateKeys(Vec<u8>);
        impl crate::library_core_actor_enrollment::ActorKeyStore for CertificateKeys {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(self.0.clone()))
            }
            fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
                Err("fixture key is immutable".into())
            }
        }
        impl crate::normalized_authority_credentials::AuthorityKeyStore for CertificateKeys {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(self.0.clone()))
            }
            fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
                Err("fixture key is immutable".into())
            }
        }
        let keys = CertificateKeys(
            Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new())
                .unwrap()
                .as_ref()
                .to_vec(),
        );
        let key = Ed25519KeyPair::from_pkcs8(&keys.0).unwrap();
        let public = crate::lower_hex(key.public_key().as_ref());
        let key_id = crate::normalized_enrollment_verifier::digest_hex(
            "authority-key",
            &json!({"signature_algorithm":"ed25519","authority_public_key":public}),
        )
        .unwrap();
        connection.execute("UPDATE library_authority_epochs SET authority_public_key = ?1, authority_key_id = ?2;", params![public,key_id]).unwrap();
        let authority = crate::normalized_authority::NormalizedAuthorityStateV2 {
            library_id: old_enrollment.library_id.clone(),
            epoch: old_enrollment.epoch,
            epoch_id: old_enrollment.epoch_id.clone(),
            authority_key_id: key_id,
            authority_public_key: public,
            observed_frontier: Vec::new(),
        };
        let prepared = crate::library_core_actor_enrollment::prepare_normalized_follower_actor_enrollment_request_v2(&authority, &"f".repeat(64), &keys, 1000).unwrap();
        let certificate =
            crate::library_core_actor_enrollment::countersign_actor_enrollment_request_bytes(
                prepared.canonical_enrollment_request_json.as_bytes(),
                &keys,
            )
            .unwrap();
        let enrollment = crate::normalized_enrollment_verifier::verify_actor_enrollment(
            &certificate,
            &authority,
        )
        .unwrap();
        connection.execute("INSERT INTO library_actors SELECT ?1, authority_epoch_id, 'pwa', ?2, ?3, ?4, ?5, ?6, 0, NULL, ?6, NULL, 1000, 1000 FROM library_actors WHERE actor_id = ?7;",
            params![enrollment.actor_id,enrollment.actor_public_key,enrollment.enrollment_operation_id,enrollment.enrollment_certificate_digest,enrollment.canonical_enrollment_certificate_json,enrollment.actor_chain_genesis,old_enrollment.actor_id]).unwrap();
        connection.execute("INSERT INTO library_actor_capabilities (capability_id, actor_id, certificate_version, actor_class, scope_mode, issuance_identity, retirement_identity, certificate_digest, canonical_certificate, issued_at) SELECT ?1, ?2, certificate_version, actor_class, scope_mode, issuance_identity, retirement_identity, ?1, ?3, issued_at FROM library_actor_capabilities WHERE actor_id = ?4;",
            params![enrollment.enrollment_certificate_digest,enrollment.actor_id,enrollment.canonical_enrollment_certificate_json,old_enrollment.actor_id]).unwrap();
        connection.execute("INSERT INTO library_actor_capability_mutations SELECT ?1, mutation_id FROM library_actor_capability_mutations WHERE capability_id = ?2;", params![enrollment.enrollment_certificate_digest,old_enrollment.enrollment_certificate_digest]).unwrap();
        let envelopes =
            crate::normalized_operation_test_fixtures::tests::signed_envelopes(&key, &enrollment);
        let (verified, _) =
            crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
                &envelopes,
                |identity| crate::normalized_mutation::actor_state_at(&connection, identity),
            )
            .unwrap();
        let receipt =
            accept_normalized_operation_transaction_v1(&mut connection, &envelopes, &key, 2000)
                .unwrap();
        connection
            .execute(
                "INSERT INTO library_materialization_generation VALUES (1, ?1);",
                ["f".repeat(64)],
            )
            .unwrap();
        let last = verified.members.last().unwrap();
        connection
            .execute(
                "INSERT INTO library_intent_actors VALUES (?1, 3, ?2, ?3);",
                params![
                    verified.actor_id,
                    last.operation_id,
                    last.actor_chain_digest
                ],
            )
            .unwrap();
        let canonical = encode_canonical_value(
            &json!(envelopes
                .iter()
                .map(|bytes| serde_json::from_slice::<serde_json::Value>(bytes).unwrap())
                .collect::<Vec<_>>()),
            131072,
        )
        .unwrap();
        connection.execute("INSERT INTO library_intent_transactions VALUES (?1, ?2, ?3, ?4, ?5, 2, 1, 2, NULL, ?6, ?7, ?8, ?9, ?10, 'published', 1000, 1001, NULL);",
            params![verified.transaction_id, verified.transaction_digest, verified.actor_id, verified.epoch, verified.epoch_id,
                enrollment.actor_chain_genesis, last.operation_id, last.actor_chain_digest, verified.canonical_envelope_bytes, canonical]).unwrap();
        for (index, member) in verified.members.iter().enumerate() {
            connection.execute("INSERT INTO library_intent_members VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
                params![verified.transaction_id, verified.actor_id, index, member.operation_id, member.actor_sequence, member.operation_type,
                    member.entity_type, member.entity_id, member.canonical_envelope_json.as_bytes(), member.member_digest]).unwrap();
        }
        connection.execute("INSERT INTO library_follower_actor_request VALUES (1, ?1, ?2, ?3, ?4, ?5, '{}', ?6, ?5, ?7, ?8, ?6);",
            params![enrollment.library_id, enrollment.epoch_id, enrollment.actor_id, enrollment.actor_public_key,
                enrollment.enrollment_certificate_digest, enrollment.enrolled_at_ms, enrollment.canonical_enrollment_certificate_json,
                enrollment.actor_chain_genesis]).unwrap();
        // Isolated archive-query storage fixture. The cooperative lifecycle and
        // physical migration transaction are exercised separately in handoff tests.
        let tx = connection.transaction().unwrap();
        crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).unwrap();
        let recovery = "a".repeat(64);
        tx.execute("INSERT INTO library_local_recovery_archives (recovery_id, library_id, predecessor_epoch_id, successor_epoch_id, actor_id, schema_sha256, row_count, archive_digest, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 4, ?7, 2001);", params![recovery, verified.library_id, verified.epoch_id, "b".repeat(64), verified.actor_id,
                crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256, "c".repeat(64)]).unwrap();
        for table in [
            "library_intent_transactions",
            "library_intent_members",
            "library_follower_actor_request",
        ] {
            let names = columns(&tx, table).unwrap();
            let order = if table == "library_intent_members" {
                "member_index"
            } else if table == "library_follower_actor_request" {
                "singleton_id"
            } else {
                "transaction_id"
            };
            let mut statement = tx
                .prepare(&format!("SELECT * FROM {table} ORDER BY {order};"))
                .unwrap();
            let mut rows = statement.query([]).unwrap();
            let mut ordinal = 0;
            while let Some(row) = rows.next().unwrap() {
                let bytes =
                    crate::normalized_consumer_recovery::encode_recovery_row(row, names.len())
                        .unwrap();
                tx.execute(
                    "INSERT INTO library_local_recovery_rows VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
                    params![
                        recovery,
                        table,
                        ordinal,
                        verified.transaction_id,
                        serde_json::to_string(&names).unwrap(),
                        bytes,
                        crate::lower_hex(&Sha256::digest(&bytes))
                    ],
                )
                .unwrap();
                ordinal += 1;
            }
        }
        tx.commit().unwrap();
        let request = json!({ "queryId": "recovery_intent_review_v1", "schemaVersion": 1, "recoveryId": recovery,
            "transactionId": verified.transaction_id, "cursor": null, "limit": 1,
            "readerSessionId": "review-reader", "cancellationId": "review-cancel" });
        let first = query_normalized_json_v1(&mut connection, request.clone()).unwrap();

        assert_eq!(
            first["outcome"],
            json!({"state": "confirmed_accepted", "committed_revision": receipt.committed_revision})
        );
        assert_eq!(
            first["rows"],
            json!([{ "personState": null, "rssFeedState": null, "originalEnvelopeJson": null, "authorName": "Ada", "itemPresent": true, "itemState": "present", "itemText": null, "assigned": null, "assignedAt": null, "createdAt": 1000, "entityId": "rss:item:1", "memberIndex": 0, "operationType": "feed_item_read_assignment", "readAt": 900 }])
        );
        let mut editor = request.clone();
        editor["includeOriginal"] = json!(true);
        let original_page = query_normalized_json_v1(&mut connection, editor.clone()).unwrap();
        assert_eq!(
            original_page["rows"][0]["originalEnvelopeJson"],
            String::from_utf8(envelopes[0].clone()).unwrap()
        );
        editor["cursor"] = original_page["nextCursor"].clone();
        let original_next = query_normalized_json_v1(&mut connection, editor.clone()).unwrap();
        assert_eq!(
            original_next["rows"][0]["originalEnvelopeJson"],
            String::from_utf8(envelopes[1].clone()).unwrap()
        );
        editor["includeOriginal"] = json!(false);
        assert!(query_normalized_json_v1(&mut connection, editor)
            .unwrap_err()
            .to_string()
            .contains("CURSOR_STALE"));
        let mut next = request.clone();
        next["cursor"] = first["nextCursor"].clone();
        let second = query_normalized_json_v1(&mut connection, next.clone()).unwrap();
        assert_eq!(second["rows"][0]["entityId"], "rss:item:2");
        assert!(second["nextCursor"].is_null());
        // Isolate promotion's actor-epoch rebinding. The authority transition
        // itself is covered by the handoff lifecycle; these are real signatures.
        let moved_epoch = "9".repeat(64);
        connection.execute("INSERT INTO library_authority_epochs SELECT ?1, library_id, epoch_number + 1, authority_key_id, authority_public_key, transition_certificate_digest, canonical_transition_certificate, accepted_manifest_generation, checkpoint_frontier_digest, materialized_state_digest, accepted_at FROM library_authority_epochs WHERE epoch_id = ?2;",
            params![moved_epoch, enrollment.epoch_id]).unwrap();
        connection
            .execute(
                "UPDATE library_actors SET authority_epoch_id = ?1 WHERE actor_id = ?2;",
                params![moved_epoch, enrollment.actor_id],
            )
            .unwrap();
        let identity = crate::normalized_operation_verifier::OperationIdentity {
            library_id: enrollment.library_id.clone(),
            epoch_id: enrollment.epoch_id.clone(),
            actor_id: enrollment.actor_id.clone(),
        };
        assert!(crate::normalized_mutation::actor_state_at(&connection, &identity).is_err());
        assert!(
            historical_archive_actor(&connection, &recovery, &identity)
                .unwrap()
                .retired
        );
        let historical = query_normalized_json_v1(&mut connection, request.clone()).unwrap();
        assert_eq!(historical["outcome"], first["outcome"]);
        assert_eq!(historical["rows"], first["rows"]);
        let (archived_request, names): (Vec<u8>, String) = connection.query_row(
            "SELECT canonical_row, columns_json FROM library_local_recovery_rows WHERE recovery_id = ?1 AND table_key = 'library_follower_actor_request';", [&recovery],
            |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        let mut cells: Vec<Vec<String>> = serde_json::from_slice(&archived_request).unwrap();
        let names: Vec<String> = serde_json::from_str(&names).unwrap();
        let index = names
            .iter()
            .position(|name| name == "canonical_enrollment_certificate")
            .unwrap();
        let mut forged: serde_json::Value =
            serde_json::from_str(&enrollment.canonical_enrollment_certificate_json).unwrap();
        forged["authority_signature"] = json!("0".repeat(128));
        cells[index][1] = STANDARD.encode(encode_canonical_value(&forged, 65_536).unwrap());
        let forged_row = encode_canonical_value(&json!(cells), 2_097_152).unwrap();
        connection.execute("UPDATE library_local_recovery_rows SET canonical_row = ?1, row_digest = ?2 WHERE recovery_id = ?3 AND table_key = 'library_follower_actor_request';",
            params![forged_row, crate::lower_hex(&Sha256::digest(&forged_row)), recovery]).unwrap();
        assert!(query_normalized_json_v1(&mut connection, request.clone()).is_err());
        connection.execute("UPDATE library_local_recovery_rows SET canonical_row = ?1, row_digest = ?2 WHERE recovery_id = ?3 AND table_key = 'library_follower_actor_request';",
            params![archived_request, crate::lower_hex(&Sha256::digest(&archived_request)), recovery]).unwrap();
        assert_eq!(
            query_normalized_json_v1(&mut connection, request.clone()).unwrap()["outcome"],
            first["outcome"]
        );
        // Target deletion is separate from evidence about the original transaction.
        connection
            .execute(
                "DELETE FROM library_feed_items WHERE global_id = 'rss:item:1';",
                [],
            )
            .unwrap();
        let absent = query_normalized_json_v1(&mut connection, request.clone()).unwrap();
        assert_eq!(absent["rows"][0]["itemState"], "absent");
        assert_eq!(absent["rows"][0]["itemPresent"], false);
        connection.execute("INSERT INTO library_tombstones VALUES ('feed_item', 'rss:item:1', 'test-actor', 1, 'test-removal', 1);", []).unwrap();
        let deleted = query_normalized_json_v1(&mut connection, request.clone()).unwrap();
        assert_eq!(deleted["rows"][0]["itemState"], "deleted");
        assert_eq!(deleted["outcome"], first["outcome"]);
        connection
            .execute(
                "UPDATE library_local_recovery_archives SET archive_digest = ?1;",
                ["d".repeat(64)],
            )
            .unwrap();
        assert!(query_normalized_json_v1(&mut connection, next)
            .unwrap_err()
            .to_string()
            .contains("CURSOR_STALE"));
        connection
            .execute("UPDATE library_receipts SET digest = ?1;", ["0".repeat(64)])
            .unwrap();
        assert!(query_normalized_json_v1(&mut connection, request)
            .unwrap_err()
            .to_string()
            .contains("conflicts"));
    }

    #[test]
    fn archive_rejection_requires_the_original_authority_signature_and_matching_intent() {
        use crate::normalized_mutation::*;
        let (mut connection, key, enrollment) = crate::normalized_mutation::tests::fixture();
        let envelopes = crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip(
            &key,
            &enrollment,
            "tx:archived:missing",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:missing", 900)],
            "feed_item_read_assignment",
        );
        let (verified, _) =
            crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
                &envelopes,
                |identity| actor_state_at(&connection, identity),
            )
            .unwrap();
        let input = ArchivedIntentInput {
            transaction_id: verified.transaction_id,
            transaction_digest: verified.transaction_digest,
            actor_id: verified.actor_id,
            epoch_id: verified.epoch_id,
            state: "rejected".into(),
            first_counter: 1,
            envelopes,
        };
        // A locally recorded rejection alone must remain unresolved.
        assert_eq!(
            inspect_input_acceptance(&connection, &input).unwrap(),
            ArchivedIntentOutcomeV1::Unresolved
        );
        resolve_normalized_operation_transaction_v1(&mut connection, &input.envelopes, &key, 2000)
            .unwrap();
        let page = export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: input.actor_id.clone(),
                after: None,
                maximum_records: 1,
                maximum_response_bytes: 131_072,
            },
        )
        .unwrap();
        let mut record = page.records[0].clone();
        let inspect = |record: &NormalizedFollowerResultRecordV1| {
            inspect_result_evidence(
                &connection,
                &input,
                inspect_input_acceptance(&connection, &input).unwrap(),
                record,
            )
        };
        assert_eq!(
            inspect(&record).unwrap(),
            ArchivedIntentOutcomeV1::ReportedRejected {
                reason: "target_missing".into(),
                result_digest: record.result_digest.clone(),
            }
        );
        assert!(inspect_result_evidence(
            &connection,
            &input,
            ArchivedIntentOutcomeV1::ConfirmedAccepted {
                committed_revision: 1
            },
            &record
        )
        .unwrap_err()
        .contains("contradicts"));
        record.transaction_digest = "0".repeat(64);
        assert!(inspect(&record)
            .unwrap_err()
            .contains("verification failed"));
        record = page.records[0].clone();
        let mut tampered: serde_json::Value =
            serde_json::from_str(&record.canonical_result_json).unwrap();
        tampered["signature"] = serde_json::Value::String("0".repeat(128));
        record.canonical_result_json = String::from_utf8(
            crate::library_core_canonical::encode_canonical_value(&tampered, 131_072).unwrap(),
        )
        .unwrap();
        assert!(inspect(&record).unwrap_err().contains("signature"));

        // Reuse the real resolver under a successor epoch. Its valid stale-epoch
        // signature is a refusal to admit now, not evidence of the old outcome.
        let successor = "4".repeat(64);
        connection.execute(
            "INSERT INTO library_authority_epochs
             (epoch_id, library_id, epoch_number, authority_key_id, authority_public_key,
              transition_certificate_digest, canonical_transition_certificate,
              accepted_manifest_generation, checkpoint_frontier_digest, materialized_state_digest, accepted_at)
             SELECT ?1, library_id, 2, authority_key_id, authority_public_key,
                    ?2, '{}', 1, ?3, ?4, 1500
             FROM library_authority_epochs WHERE epoch_id = ?5;",
            params![successor, "d".repeat(64), "e".repeat(64), "f".repeat(64), input.epoch_id],
        ).unwrap();
        connection.execute("UPDATE library_active_authority SET epoch_id = ?1, accepted_manifest_generation = 1, activated_at = 1500;", [&successor]).unwrap();
        connection.execute("UPDATE library_writer_admission SET observed_manifest_generation = 1, observed_at = 1500;", []).unwrap();
        connection
            .execute(
                "UPDATE library_meta SET authority_epoch = ?1, updated_at = 1500;",
                [&successor],
            )
            .unwrap();
        let envelopes =
            crate::normalized_operation_test_fixtures::tests::signed_envelopes(&key, &enrollment);
        let (verified, _) =
            crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
                &envelopes,
                |identity| actor_state_at(&connection, identity),
            )
            .unwrap();
        let stale_input = ArchivedIntentInput {
            transaction_id: verified.transaction_id,
            transaction_digest: verified.transaction_digest,
            actor_id: verified.actor_id,
            epoch_id: verified.epoch_id,
            state: "published".into(),
            first_counter: 1,
            envelopes,
        };
        resolve_normalized_operation_transaction_v1(
            &mut connection,
            &stale_input.envelopes,
            &key,
            2100,
        )
        .unwrap();
        let stale_page = export_normalized_follower_result_page_v1(
            &connection,
            &NormalizedFollowerResultPageRequestV1 {
                actor_id: stale_input.actor_id.clone(),
                after: Some(NormalizedFollowerResultCursorV1 {
                    actor_id: input.actor_id,
                    result_sequence: page.records[0].result_sequence,
                    result_digest: page.records[0].result_digest.clone(),
                }),
                maximum_records: 1,
                maximum_response_bytes: 131_072,
            },
        )
        .unwrap();
        assert_eq!(
            stale_page.records[0].rejection_reason.as_deref(),
            Some("epoch_stale")
        );
        assert_eq!(
            inspect_result_evidence(
                &connection,
                &stale_input,
                inspect_input_acceptance(&connection, &stale_input).unwrap(),
                &stale_page.records[0]
            )
            .unwrap(),
            ArchivedIntentOutcomeV1::Unresolved
        );
    }

    #[test]
    fn archive_acceptance_requires_original_signatures_and_complete_canonical_receipts() {
        let (mut connection, key, enrollment) = crate::normalized_mutation::tests::fixture();
        let envelopes =
            crate::normalized_operation_test_fixtures::tests::signed_envelopes(&key, &enrollment);
        let (verified, _) =
            crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
                &envelopes,
                |identity| crate::normalized_mutation::actor_state_at(&connection, identity),
            )
            .unwrap();
        let mut input = ArchivedIntentInput {
            transaction_id: verified.transaction_id.clone(),
            transaction_digest: verified.transaction_digest.clone(),
            actor_id: verified.actor_id.clone(),
            epoch_id: verified.epoch_id.clone(),
            state: "published".into(),
            first_counter: 1,
            envelopes,
        };
        assert_eq!(
            inspect_input_acceptance(&connection, &input).unwrap(),
            ArchivedIntentOutcomeV1::Unresolved
        );
        let accepted = crate::normalized_mutation::accept_normalized_operation_transaction_v1(
            &mut connection,
            &input.envelopes,
            &key,
            2000,
        )
        .unwrap();
        // The outbox is not a checkpoint table. Acceptance must still be provable
        // through the canonical per-operation receipts that do cross checkpoints.
        connection
            .execute("DELETE FROM library_follower_result_outbox;", [])
            .unwrap();
        assert_eq!(
            inspect_input_acceptance(&connection, &input).unwrap(),
            ArchivedIntentOutcomeV1::ConfirmedAccepted {
                committed_revision: accepted.committed_revision,
            }
        );
        connection
            .execute_batch(
                "CREATE TEMP TABLE saved_acceptance_receipts AS SELECT * FROM library_receipts;",
            )
            .unwrap();
        connection
            .execute(
                "DELETE FROM library_receipts WHERE operation_id = ?1;",
                [&verified.members[0].operation_id],
            )
            .unwrap();
        assert!(inspect_input_acceptance(&connection, &input)
            .unwrap_err()
            .contains("incomplete canonical acceptance"));
        connection.execute_batch("DELETE FROM library_receipts; INSERT INTO library_receipts SELECT * FROM saved_acceptance_receipts;").unwrap();
        connection
            .execute(
                "UPDATE library_receipts SET digest = ?1 WHERE operation_id = ?2;",
                params!["0".repeat(64), verified.members[0].operation_id],
            )
            .unwrap();
        assert!(inspect_input_acceptance(&connection, &input)
            .unwrap_err()
            .contains("conflicts"));
        connection.execute_batch("DELETE FROM library_receipts; INSERT INTO library_receipts SELECT * FROM saved_acceptance_receipts;").unwrap();
        input.transaction_digest = "0".repeat(64);
        assert!(inspect_input_acceptance(&connection, &input)
            .unwrap_err()
            .contains("metadata differs"));
        input.transaction_digest = verified.transaction_digest;
        let mut tampered: serde_json::Value = serde_json::from_slice(&input.envelopes[0]).unwrap();
        tampered["signature"] = serde_json::Value::String("0".repeat(128));
        input.envelopes[0] =
            crate::library_core_canonical::encode_canonical_value(&tampered, 131_072).unwrap();
        assert!(inspect_input_acceptance(&connection, &input)
            .unwrap_err()
            .contains("signature verification failed"));
    }
}
