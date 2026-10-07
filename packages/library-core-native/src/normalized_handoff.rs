//! Installation-local handoff fencing, independent of synchronized authority rows.

use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{NATIVE_STORAGE_SCHEMA_VERSION, SQLITE_SCHEMA_VERSION};
use rusqlite::{Connection, OptionalExtension};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffInstallationRoleV1 {
    Source,
    Target,
    Consumer,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffPhaseV1 {
    Preparing,
    Sealed,
    Authorized,
    CasPending,
    Committed,
    Active,
    Demoted,
    Cancelled,
    Recovery,
    Following,
}

/// Recovery information, never an authority grant. Canonical receipts are
/// returned verbatim so retries do not reconstruct or replace committed consent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeHandoffStatusV1 {
    pub handoff_id: String,
    pub library_id: String,
    pub installation_role: HandoffInstallationRoleV1,
    pub phase: HandoffPhaseV1,
    pub predecessor_epoch_id: String,
    pub successor_epoch_id: Option<String>,
    pub canonical_readiness: String,
    pub canonical_authorization_body: Option<String>,
    pub canonical_authorization: Option<String>,
    pub canonical_activation: Option<String>,
    pub canonical_cancellation: Option<String>,
    pub expected_control_revision: Option<String>,
    pub observed_control_revision: Option<String>,
    pub updated_at_ms: u64,
}

fn handoff_enum<T: serde::de::DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    serde_json::from_value(serde_json::Value::String(row.get(index)?)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn handoff_receipt(
    row: &rusqlite::Row<'_>,
    index: usize,
    maximum: usize,
) -> rusqlite::Result<Option<String>> {
    let bytes: Option<Vec<u8>> = row.get(index)?;
    bytes
        .map(|bytes| {
            let invalid = || {
                rusqlite::Error::FromSqlConversionFailure(
                    index,
                    rusqlite::types::Type::Blob,
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "handoff receipt is not bounded canonical data",
                    )),
                )
            };
            let decoded = crate::library_core_canonical::decode_canonical_value(&bytes, maximum)
                .map_err(|_| invalid())?;
            let encoded = crate::library_core_canonical::encode_canonical_value(
                &decoded.into_value(),
                maximum,
            )
            .map_err(|_| invalid())?;
            if encoded != bytes {
                return Err(invalid());
            }
            String::from_utf8(bytes).map_err(|_| invalid())
        })
        .transpose()
}

pub fn read_native_handoff_status_v1(
    connection: &mut Connection,
) -> Result<Option<NativeHandoffStatusV1>, NormalizedSqliteError> {
    // Read the schema, local receipt and selected Library in one snapshot.
    let transaction = connection.transaction()?;
    let version: u32 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if ![SQLITE_SCHEMA_VERSION, NATIVE_STORAGE_SCHEMA_VERSION, 4, 5].contains(&version) {
        return Err(NormalizedSqliteError::InvalidRequest(
            "handoff status requires a recognized Library schema",
        ));
    }
    crate::normalized_sqlite::install_normalized_schema_v1(&transaction)?;
    if matches!(version, 1 | 4) {
        transaction.commit()?;
        return Ok(None);
    }
    let status = transaction
        .query_row(
            "SELECT handoff_id, library_id, installation_role, phase, predecessor_epoch_id,
          successor_epoch_id, canonical_readiness, canonical_authorization_body,
          canonical_authorization, canonical_activation, expected_control_revision,
          observed_control_revision, updated_at,
          (SELECT canonical_cancellation FROM library_local_handoff_cancellations AS cancelled
            WHERE cancelled.handoff_id = library_local_handoff.handoff_id)
          FROM library_local_handoff WHERE singleton_id = 1;",
            [],
            |row| {
                Ok(NativeHandoffStatusV1 {
                    handoff_id: row.get(0)?,
                    library_id: row.get(1)?,
                    installation_role: handoff_enum(row, 2)?,
                    phase: handoff_enum(row, 3)?,
                    predecessor_epoch_id: row.get(4)?,
                    successor_epoch_id: row.get(5)?,
                    canonical_readiness: handoff_receipt(row, 6, 16_384)?
                        .ok_or(rusqlite::Error::InvalidQuery)?,
                    canonical_authorization_body: handoff_receipt(row, 7, 16_384)?,
                    canonical_authorization: handoff_receipt(row, 8, 16_384)?,
                    canonical_activation: handoff_receipt(row, 9, 32_768)?,
                    expected_control_revision: row.get(10)?,
                    observed_control_revision: row.get(11)?,
                    updated_at_ms: row.get(12)?,
                    canonical_cancellation: handoff_receipt(row, 13, 16_384)?,
                })
            },
        )
        .optional()?
        .ok_or(NormalizedSqliteError::InvalidRequest(
            "native handoff recovery record is missing",
        ))?;
    if status.installation_role == HandoffInstallationRoleV1::Target
        && status.phase == HandoffPhaseV1::Cancelled
    {
        crate::normalized_handoff_cancellation::verify_cancelled_target_history_v1(&transaction)
            .map_err(|_| {
                NormalizedSqliteError::InvalidRequest("target cancellation proof is invalid")
            })?;
    }
    let selected_library: String = transaction.query_row(
        "SELECT library_id FROM library_meta WHERE singleton_id = 1;",
        [],
        |row| row.get(0),
    )?;
    if status.library_id != selected_library || status.updated_at_ms > 9_007_199_254_740_991 {
        return Err(NormalizedSqliteError::InvalidRequest(
            "handoff recovery identity or timestamp is invalid",
        ));
    }
    transaction.commit()?;
    Ok(Some(status))
}

#[derive(Clone, Copy)]
pub(crate) enum HandoffAdmission {
    CanonicalWrite,
    ProviderContact,
    LegacyReassignment,
}

/// Recheck inside each native admission transaction. Deleting or refreshing the
/// ordinary writer-admission rows cannot undo a persisted transfer fence.
pub(crate) fn require_handoff_admission(
    connection: &Connection,
    admission: HandoffAdmission,
) -> Result<(), NormalizedSqliteError> {
    let physical_version: u32 = connection.query_row(
        "SELECT schema_version FROM library_storage_meta WHERE singleton_id = 1;",
        [],
        |row| row.get(0),
    )?;
    crate::normalized_local_annotations::reject_building(connection)?;
    if physical_version == SQLITE_SCHEMA_VERSION
        || physical_version == crate::sqlite_contract_generated::ANNOTATION_STORAGE_SCHEMA_VERSION
    {
        return Ok(());
    }
    if physical_version != NATIVE_STORAGE_SCHEMA_VERSION
        && physical_version
            != crate::sqlite_contract_generated::ANNOTATION_RECOVERY_STORAGE_SCHEMA_VERSION
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "unsupported handoff storage version",
        ));
    }
    let state: Option<(String, String, String, String, Option<String>)> = connection
        .query_row(
            "SELECT handoff.library_id, installation_role, phase, predecessor_epoch_id,
                successor_epoch_id FROM library_local_handoff AS handoff WHERE singleton_id = 1;",
            [],
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
        .optional()?;
    let Some((library_id, role, phase, predecessor, successor)) = state else {
        return Err(NormalizedSqliteError::InvalidRequest(
            "native handoff recovery record is missing",
        ));
    };
    let (selected_library, selected_epoch): (String, String) = connection.query_row(
        "SELECT library_id, authority_epoch FROM library_meta WHERE singleton_id = 1;",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let allowed = library_id == selected_library
        && match (role.as_str(), phase.as_str(), admission) {
            // Admitted capture may finish persisting while preparation drains it.
            // Sealing later freezes the resulting exact frontier in one transaction.
            ("source", "preparing", HandoffAdmission::CanonicalWrite) => {
                selected_epoch == predecessor
            }
            (
                "source",
                "cancelled",
                HandoffAdmission::CanonicalWrite | HandoffAdmission::ProviderContact,
            ) => selected_epoch == predecessor,
            (
                "target",
                "active",
                HandoffAdmission::CanonicalWrite | HandoffAdmission::ProviderContact,
            ) => successor.as_deref() == Some(selected_epoch.as_str()),
            _ => false,
        };
    if !allowed {
        return Err(NormalizedSqliteError::InvalidRequest(
            "native handoff fences this authority operation",
        ));
    }
    Ok(())
}

/// Provider entry points use a stricter preparation fence than final canonical
/// persistence, so admitted work can drain without starting another capture.
pub fn require_normalized_provider_handoff_admission_v2(
    connection: &Connection,
) -> Result<(), NormalizedSqliteError> {
    require_handoff_admission(connection, HandoffAdmission::ProviderContact)
}

/// The selected successor drains its own edits before readiness. Keep that
/// settled frontier stable until activation; other consumer installations are
/// unaffected because this record is device-local.
pub(crate) fn require_handoff_follower_edit_admission_v1(
    connection: &Connection,
) -> Result<(), NormalizedSqliteError> {
    let version: u32 = connection.query_row(
        "SELECT schema_version FROM library_storage_meta WHERE singleton_id = 1;",
        [],
        |row| row.get(0),
    )?;
    crate::normalized_local_annotations::reject_building(connection)?;
    if version == SQLITE_SCHEMA_VERSION
        || version == crate::sqlite_contract_generated::ANNOTATION_STORAGE_SCHEMA_VERSION
    {
        return Ok(());
    }
    if version != NATIVE_STORAGE_SCHEMA_VERSION
        && version != crate::sqlite_contract_generated::ANNOTATION_RECOVERY_STORAGE_SCHEMA_VERSION
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "unsupported handoff storage version",
        ));
    }
    require_existing_handoff_follower_edit_admission(connection)
}

// Version admission belongs to the caller; every existing lifecycle fence is
// still checked here, including cancelled-target proof verification.
pub(crate) fn require_existing_handoff_follower_edit_admission(
    connection: &Connection,
) -> Result<(), NormalizedSqliteError> {
    let source: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff AS handoff
          JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = handoff.library_id
            AND meta.authority_epoch = handoff.successor_epoch_id
          JOIN library_follower_checkpoint_receipt AS receipt ON receipt.singleton_id = 1
            AND receipt.library_id = meta.library_id AND receipt.authority_epoch_id = meta.authority_epoch
          WHERE handoff.singleton_id = 1 AND handoff.installation_role = 'source' AND handoff.phase = 'demoted'
            AND receipt.writer_actor_id = json_extract(CAST(handoff.canonical_activation AS TEXT), '$.activation.control.writerId'))
          AND NOT EXISTS(SELECT 1 FROM library_writer_admission) AND NOT EXISTS(SELECT 1 FROM library_local_cloud_writer_admission);",
        [], |row| row.get(0),
    )?;
    let recovered: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff AS handoff
         JOIN library_local_recovery_archives AS archive ON archive.library_id = handoff.library_id
          AND archive.predecessor_epoch_id = handoff.predecessor_epoch_id
          AND archive.successor_epoch_id = handoff.successor_epoch_id AND archive.reenrollment_committed_at IS NOT NULL
         JOIN library_follower_actor_request AS request ON request.singleton_id = 1
          AND request.library_id = archive.library_id AND request.authority_epoch_id = archive.successor_epoch_id
          AND request.actor_id = json_extract(CAST(archive.reenrollment_receipt AS TEXT), '$.actorId')
          AND request.enrollment_request_digest = json_extract(CAST(archive.reenrollment_receipt AS TEXT), '$.enrollmentRequestDigest')
         JOIN library_meta AS meta ON meta.singleton_id = 1 AND meta.library_id = request.library_id
          AND meta.authority_epoch = request.authority_epoch_id
         WHERE handoff.singleton_id = 1 AND handoff.installation_role = 'consumer' AND handoff.phase = 'following');",
        [], |row| row.get(0),
    )?;
    if source {
        crate::normalized_source_handoff::verify_demoted_source_selection(connection)
            .map_err(NormalizedSqliteError::Transport)?;
    }
    if !source
        && !recovered
        && crate::normalized_handoff_cancellation::require_cancelled_target_admission_v1(connection)
            .is_err()
    {
        return Err(NormalizedSqliteError::InvalidRequest(
            "handoff target edits are paused during authority transfer",
        ));
    }
    Ok(())
}

/// A reset must not erase the installation-local proof that its old authority
/// was surrendered. A cancelled, never-authorized attempt has no such proof.
pub fn require_normalized_handoff_reset_v1(
    connection: &Connection,
) -> Result<(), NormalizedSqliteError> {
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 {
        let empty: bool = connection.query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*');",
            [],
            |row| row.get(0),
        )?;
        if empty {
            return Ok(());
        }
        return Err(NormalizedSqliteError::InvalidRequest(
            "cannot reset an unrecognized Library schema",
        ));
    }
    crate::normalized_sqlite::install_normalized_schema_v1(connection)?;
    if matches!(version, 1 | 4) {
        return Ok(());
    }
    let cancelled: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff
         WHERE singleton_id = 1 AND installation_role = 'source' AND phase = 'cancelled'
           AND canonical_authorization_body IS NULL AND canonical_authorization IS NULL
           AND canonical_activation IS NULL AND successor_epoch_id IS NULL);",
        [],
        |row| row.get(0),
    )?;
    if !cancelled {
        return Err(NormalizedSqliteError::InvalidRequest(
            "Library reset cannot erase this installation's authority handoff fence",
        ));
    }
    Ok(())
}

/// Export sealed predecessor or verified staged successor state without writer admission.
pub fn require_handoff_checkpoint_export_v1(
    connection: &Connection,
    handoff_id: &str,
) -> Result<(), NormalizedSqliteError> {
    let invalid = NormalizedSqliteError::InvalidRequest;
    if !crate::library_core_hash::is_lower_sha256(handoff_id) {
        return Err(invalid("handoff export identity is invalid"));
    }
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if !matches!(version, 2 | 5) {
        return Err(invalid(
            "handoff export requires a persisted native handoff",
        ));
    }
    crate::normalized_sqlite::install_normalized_schema_v1(connection)?;
    let sealed: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff AS handoff
         JOIN library_meta AS meta ON meta.singleton_id = 1
          AND meta.library_id = handoff.library_id AND meta.authority_epoch = handoff.predecessor_epoch_id
         JOIN library_active_authority AS active ON active.active_key = 'active'
          AND active.library_id = handoff.library_id AND active.epoch_id = handoff.predecessor_epoch_id
         WHERE handoff.singleton_id = 1 AND handoff.handoff_id = ?1
          AND handoff.installation_role = 'source' AND handoff.phase IN ('sealed', 'authorized'));",
        [handoff_id], |row| row.get(0),
    )?;
    if !sealed {
        crate::normalized_handoff_certificate::verify_staged_handoff_export_v1(
            connection, handoff_id,
        )
        .map_err(|_| {
            invalid("handoff export requires a sealed predecessor or verified fenced successor")
        })?;
    }
    Ok(())
}

/// Freeze the exact drained frontier without authorizing a successor. Logical
/// checkpoint export remains readable while all canonical admission is closed.
pub fn seal_source_handoff_v1(
    connection: &mut Connection,
    handoff_id: &str,
    expected: &crate::normalized_sqlite::NormalizedCheckpointExportDescriptorV2,
    sealed_at_ms: u64,
) -> Result<crate::normalized_sqlite::NormalizedCheckpointExportDescriptorV2, NormalizedSqliteError>
{
    crate::require_library_transfer_capability()
        .map_err(crate::NormalizedSqliteError::Transport)?;
    let invalid = NormalizedSqliteError::InvalidRequest;
    if !crate::library_core_hash::is_lower_sha256(handoff_id)
        || sealed_at_ms > 9_007_199_254_740_991
        || !connection.is_autocommit()
    {
        return Err(invalid("handoff seal input or transaction is invalid"));
    }
    let synchronous: u32 = connection.pragma_query_value(None, "synchronous", |row| row.get(0))?;
    if synchronous < 2 {
        return Err(invalid("handoff sealing requires full SQLite durability"));
    }
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let version: u32 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if !matches!(version, 2 | 5) {
        return Err(invalid(
            "handoff sealing requires a persisted native handoff",
        ));
    }
    crate::normalized_sqlite::install_normalized_schema_v1(&transaction)?;
    let state: Option<(String, String, String, i64, bool)> = transaction
        .query_row(
            "SELECT phase, library_id, predecessor_epoch_id, updated_at,
          canonical_authorization_body IS NULL AND canonical_authorization IS NULL
          AND canonical_activation IS NULL AND successor_epoch_id IS NULL
         FROM library_local_handoff WHERE singleton_id = 1
          AND installation_role = 'source' AND handoff_id = ?1;",
            [handoff_id],
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
        .optional()?;
    let Some((phase, library, predecessor, updated_at, unsigned)) = state else {
        return Err(invalid("handoff seal does not match this source transfer"));
    };
    if !unsigned || !matches!(phase.as_str(), "preparing" | "sealed") {
        return Err(invalid("handoff source cannot seal in its current phase"));
    }
    let snapshot =
        crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&transaction)?;
    if snapshot != *expected
        || snapshot.library_id != library
        || snapshot.authority_epoch != predecessor
    {
        return Err(invalid("handoff source frontier changed before sealing"));
    }
    if phase == "preparing" {
        if sealed_at_ms < updated_at as u64 {
            return Err(invalid("handoff seal time predates its persisted state"));
        }
        crate::normalized_mutation::normalized_primary_mutation_context_v1(&transaction)?;
        transaction.execute(
            "UPDATE library_local_handoff SET phase = 'sealed', updated_at = ?1 WHERE singleton_id = 1;",
            rusqlite::params![sealed_at_ms],
        )?;
        transaction.execute("DELETE FROM library_writer_admission;", [])?;
        transaction.execute("DELETE FROM library_local_cloud_writer_admission;", [])?;
    }
    transaction.commit()?;
    Ok(snapshot)
}

/// Cancellation is legal only before the unsigned authorization body commits.
/// An exact retry observes cancellation without recreating admission that a
/// later cloud observation may have revoked.
#[cfg(test)]
pub(crate) fn cancel_source_handoff_v1(
    connection: &mut Connection,
    handoff_id: &str,
    cancelled_at_ms: u64,
) -> Result<(), NormalizedSqliteError> {
    let invalid = NormalizedSqliteError::InvalidRequest;
    if !crate::library_core_hash::is_lower_sha256(handoff_id)
        || cancelled_at_ms > 9_007_199_254_740_991
        || !connection.is_autocommit()
    {
        return Err(invalid(
            "handoff cancellation input or transaction is invalid",
        ));
    }
    let synchronous: u32 = connection.pragma_query_value(None, "synchronous", |row| row.get(0))?;
    if synchronous < 2 {
        return Err(invalid(
            "handoff cancellation requires full SQLite durability",
        ));
    }
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    cancel_source_handoff_in_transaction_v1(&transaction, handoff_id, cancelled_at_ms)?;
    transaction.commit()?;
    Ok(())
}

pub(crate) fn cancel_source_handoff_in_transaction_v1(
    transaction: &rusqlite::Transaction<'_>,
    handoff_id: &str,
    cancelled_at_ms: u64,
) -> Result<(), NormalizedSqliteError> {
    let invalid = NormalizedSqliteError::InvalidRequest;
    let version: u32 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if !matches!(version, 2 | 5) {
        return Err(invalid(
            "handoff cancellation requires a persisted native handoff",
        ));
    }
    crate::normalized_sqlite::install_normalized_schema_v1(transaction)?;
    let row: Option<(String, String, i64, bool)> = transaction
        .query_row(
            "SELECT phase, predecessor_epoch_id, updated_at,
                canonical_authorization_body IS NULL AND canonical_authorization IS NULL
                AND canonical_activation IS NULL AND successor_epoch_id IS NULL
         FROM library_local_handoff
         WHERE singleton_id = 1 AND handoff_id = ?1 AND installation_role = 'source';",
            [handoff_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((phase, predecessor, updated_at, unsigned)) = row else {
        return Err(invalid(
            "handoff cancellation does not match this source transfer",
        ));
    };
    if !unsigned || !matches!(phase.as_str(), "preparing" | "sealed" | "cancelled") {
        return Err(invalid(
            "authorized handoff cannot be cancelled; resume completion",
        ));
    }
    if phase == "cancelled" {
        require_source_cancellation_ledger_v1(transaction)?;
        return Ok(());
    }
    if cancelled_at_ms < updated_at as u64 {
        return Err(invalid(
            "handoff cancellation time predates its persisted state",
        ));
    }
    let authority: Option<(String, i64)> = transaction
        .query_row(
            "SELECT active.writer_id, active.accepted_manifest_generation
         FROM library_active_authority AS active
         JOIN library_meta AS meta ON meta.singleton_id = 1
           AND meta.library_id = active.library_id AND meta.authority_epoch = active.epoch_id
         JOIN library_local_handoff AS handoff ON handoff.singleton_id = 1
           AND handoff.library_id = active.library_id
         WHERE active.active_key = 'active' AND active.epoch_id = ?1;",
            [&predecessor],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((writer_id, generation)) = authority else {
        return Err(invalid(
            "handoff cancellation predecessor is no longer selected",
        ));
    };
    // Retain cancellation beyond replacement of the current lifecycle. Otherwise
    // an old copied readiness could become eligible for authorization again.
    transaction.execute(
        "INSERT INTO library_local_handoff_cancellations
         (handoff_id, library_id, predecessor_epoch_id, canonical_readiness, cancelled_at)
         SELECT handoff_id, library_id, predecessor_epoch_id, canonical_readiness, ?1
         FROM library_local_handoff WHERE singleton_id = 1 AND handoff_id = ?2;",
        rusqlite::params![cancelled_at_ms, handoff_id],
    )?;
    transaction.execute(
        "UPDATE library_local_handoff SET phase = 'cancelled', updated_at = ?1
         WHERE singleton_id = 1 AND handoff_id = ?2;",
        rusqlite::params![cancelled_at_ms, handoff_id],
    )?;
    transaction.execute(
        "INSERT INTO library_writer_admission
         (singleton_id, local_writer_id, active_writer_id, observed_manifest_generation, observed_at)
         VALUES (1, ?1, ?1, ?2, ?3)
         ON CONFLICT(singleton_id) DO UPDATE SET local_writer_id = excluded.local_writer_id,
           active_writer_id = excluded.active_writer_id,
           observed_manifest_generation = excluded.observed_manifest_generation,
           observed_at = excluded.observed_at;",
        rusqlite::params![writer_id, generation, cancelled_at_ms],
    )?;
    // Provider leases are refreshed separately from a verified cloud head.
    Ok(())
}

/// A terminal lifecycle is reusable only with its exact durable cancellation.
pub(crate) fn require_source_cancellation_ledger_v1(
    connection: &Connection,
) -> Result<(), NormalizedSqliteError> {
    let retained: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff_cancellations AS cancelled
         JOIN library_local_handoff AS current ON current.singleton_id = 1
           AND current.installation_role = 'source' AND current.phase = 'cancelled'
           AND current.handoff_id = cancelled.handoff_id
           AND current.library_id = cancelled.library_id
           AND current.predecessor_epoch_id = cancelled.predecessor_epoch_id
           AND current.canonical_readiness = cancelled.canonical_readiness
           AND current.updated_at = cancelled.cancelled_at);",
        [],
        |row| row.get(0),
    )?;
    if !retained {
        return Err(NormalizedSqliteError::InvalidRequest(
            "source cancellation ledger does not match its lifecycle",
        ));
    }
    Ok(())
}

/// A bounded keyset of actors whose durable results must precede source consent.
/// Retired actors still need their final rejection/acceptance receipts delivered.
pub fn read_sealed_handoff_result_actors_v1(
    connection: &Connection,
    handoff_id: &str,
    after: Option<&str>,
) -> Result<Vec<String>, String> {
    if !crate::library_core_hash::is_lower_sha256(handoff_id)
        || after.is_some_and(|id| !crate::library_core_hash::is_lower_sha256(id))
    {
        return Err("handoff result actor cursor is invalid".into());
    }
    require_handoff_checkpoint_export_v1(connection, handoff_id).map_err(|e| e.to_string())?;
    let sealed: bool = connection.query_row(
        "SELECT installation_role = 'source' AND phase = 'sealed' AND canonical_authorization_body IS NULL
         FROM library_local_handoff WHERE singleton_id = 1 AND handoff_id = ?1;",
        [handoff_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !sealed {
        return Err("result publication requires the sealed unsigned source".into());
    }
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT result.actor_id FROM library_follower_result_outbox AS result
         JOIN library_local_handoff AS handoff ON handoff.singleton_id = 1
         WHERE result.authority_epoch_id = handoff.predecessor_epoch_id AND result.actor_id > ?1
         ORDER BY result.actor_id LIMIT 100;",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([after.unwrap_or("")], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<String>>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_sqlite::{
        migrate_native_handoff_schema_v2, open_normalized_sqlite_database_v1,
    };
    use rusqlite::params;

    #[test]
    fn persisted_fence_survives_admission_refresh_and_is_seen_by_open_connections() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("library.sqlite");
        let mut writer = open_normalized_sqlite_database_v1(&path, true).unwrap();
        let library = "1".repeat(64);
        let predecessor = "2".repeat(64);
        let successor = "3".repeat(64);
        writer
            .execute(
                "INSERT INTO library_meta VALUES (1, ?1, 1, ?2, 0, 1);",
                params![library, predecessor],
            )
            .unwrap();
        let existing = open_normalized_sqlite_database_v1(&path, false).unwrap();
        let transaction = writer.transaction().unwrap();
        migrate_native_handoff_schema_v2(&transaction).unwrap();
        transaction
            .execute(
                "INSERT INTO library_local_handoff
             (singleton_id, handoff_id, library_id, installation_role, phase,
              predecessor_epoch_id, target_writer_id, target_authority_public_key,
              canonical_readiness, created_at, updated_at)
             VALUES (1, ?1, ?1, 'source', 'preparing', ?2, ?3, ?3, ?4, 1, 1);",
                params![library, predecessor, successor, b"{}".as_slice()],
            )
            .unwrap();
        transaction.commit().unwrap();
        assert!(require_handoff_admission(&existing, HandoffAdmission::CanonicalWrite).is_ok());
        assert!(require_normalized_provider_handoff_admission_v2(&existing).is_err());
        writer.execute("UPDATE library_local_handoff SET phase = 'authorized', canonical_authorization_body = ?1, expected_control_revision = 'etag';", [b"{}".as_slice()]).unwrap();
        writer.execute("INSERT OR REPLACE INTO library_writer_admission VALUES (1, 'primary:desktop', 'primary:desktop', 0, 1);", []).unwrap();
        assert!(require_handoff_admission(&existing, HandoffAdmission::CanonicalWrite).is_err());
        assert!(
            require_handoff_admission(&existing, HandoffAdmission::LegacyReassignment).is_err()
        );
        drop(existing);
        let reopened = open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert!(require_handoff_admission(&reopened, HandoffAdmission::CanonicalWrite).is_err());
        assert!(require_normalized_provider_handoff_admission_v2(&reopened).is_err());

        // A target phase alone cannot authorize writes under the predecessor.
        writer.execute("UPDATE library_local_handoff SET installation_role = 'target', phase = 'active', successor_epoch_id = ?1, canonical_authorization = ?2, canonical_activation = ?2, observed_control_revision = 'winner';", params![successor, b"{}".as_slice()]).unwrap();
        assert!(require_handoff_admission(&reopened, HandoffAdmission::CanonicalWrite).is_err());
        writer
            .execute(
                "UPDATE library_meta SET authority_epoch = ?1;",
                [&successor],
            )
            .unwrap();
        assert!(require_handoff_admission(&reopened, HandoffAdmission::CanonicalWrite).is_ok());
        assert!(require_normalized_provider_handoff_admission_v2(&reopened).is_ok());
        assert!(
            require_handoff_admission(&reopened, HandoffAdmission::LegacyReassignment).is_err()
        );
        writer
            .execute("DELETE FROM library_local_handoff;", [])
            .unwrap();
        assert!(read_native_handoff_status_v1(&mut writer).is_err());
        assert!(require_handoff_admission(&reopened, HandoffAdmission::CanonicalWrite).is_err());
    }

    #[test]
    fn cancellation_is_atomic_and_stops_at_unsigned_authorization_commit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cancel.sqlite");
        let mut database = open_normalized_sqlite_database_v1(&path, true).unwrap();
        let library = "a".repeat(64);
        let predecessor = "b".repeat(64);
        let handoff = "c".repeat(64);
        database
            .execute(
                "INSERT INTO library_meta VALUES (1, ?1, 1, ?2, 0, 1);",
                params![library, predecessor],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_authority_epochs VALUES
            (?1, ?2, 1, ?3, ?3, ?3, '{}', 3, ?3, ?3, 1);",
                params![predecessor, library, "d".repeat(64)],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO library_active_authority VALUES
            ('active', ?1, ?2, 'primary:desktop', 3, 1);",
                params![library, predecessor],
            )
            .unwrap();
        let transaction = database.transaction().unwrap();
        migrate_native_handoff_schema_v2(&transaction).unwrap();
        transaction
            .execute(
                "INSERT INTO library_local_handoff
            (singleton_id, handoff_id, library_id, installation_role, phase,
             predecessor_epoch_id, target_writer_id, target_authority_public_key,
             canonical_readiness, created_at, updated_at)
            VALUES (1, ?1, ?2, 'source', 'sealed', ?3, ?4, ?4, ?5, 1, 2);",
                params![
                    handoff,
                    library,
                    predecessor,
                    "e".repeat(64),
                    b"{}".as_slice()
                ],
            )
            .unwrap();
        transaction.commit().unwrap();
        assert!(cancel_source_handoff_v1(&mut database, &"f".repeat(64), 3).is_err());
        assert!(cancel_source_handoff_v1(&mut database, &handoff, 1).is_err());
        database
            .execute_batch(
                "CREATE TEMP TRIGGER reject_restored_admission
            BEFORE INSERT ON library_writer_admission
            BEGIN SELECT RAISE(ABORT, 'injected admission failure'); END;",
            )
            .unwrap();
        assert!(cancel_source_handoff_v1(&mut database, &handoff, 3).is_err());
        let phase: String = database
            .query_row("SELECT phase FROM library_local_handoff;", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(phase, "sealed");
        let cancellations: i64 = database
            .query_row(
                "SELECT count(*) FROM library_local_handoff_cancellations;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            cancellations, 0,
            "late failure must roll back the cancellation ledger"
        );
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        assert!(require_normalized_handoff_reset_v1(&database).is_err());
        cancel_source_handoff_v1(&mut database, &handoff, 3).unwrap();
        assert!(require_normalized_handoff_reset_v1(&database).is_ok());
        let restored: bool = database
            .query_row(
                "SELECT local_writer_id = 'primary:desktop'
            AND active_writer_id = 'primary:desktop' AND observed_manifest_generation = 3
            FROM library_writer_admission;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(restored);
        assert!(require_handoff_admission(&database, HandoffAdmission::CanonicalWrite).is_ok());
        database
            .execute("DELETE FROM library_writer_admission;", [])
            .unwrap();
        cancel_source_handoff_v1(&mut database, &handoff, 4).unwrap();
        let cancellation: (Vec<u8>, u64) = database.query_row(
            "SELECT canonical_readiness, cancelled_at FROM library_local_handoff_cancellations WHERE handoff_id = ?1;",
            [&handoff], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(
            cancellation,
            (b"{}".to_vec(), 3),
            "retry retains original bytes and time"
        );
        database.execute("UPDATE library_local_handoff_cancellations SET cancelled_at = 4 WHERE handoff_id = ?1;", [&handoff]).unwrap();
        assert!(cancel_source_handoff_v1(&mut database, &handoff, 5)
            .unwrap_err()
            .to_string()
            .contains("ledger does not match"));
        database.execute("UPDATE library_local_handoff_cancellations SET cancelled_at = 3 WHERE handoff_id = ?1;", [&handoff]).unwrap();
        let count: i64 = database
            .query_row(
                "SELECT count(*) FROM library_writer_admission;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 0,
            "cancellation replay must not recreate revoked admission"
        );

        // Signature generation is not the cutoff. Committing the unsigned body
        // is already irreversible, including after a process restart.
        database
            .execute(
                "UPDATE library_local_handoff SET phase = 'authorized',
            canonical_authorization_body = ?1, expected_control_revision = 'etag';",
                [b"{}".as_slice()],
            )
            .unwrap();
        drop(database);
        let mut database = open_normalized_sqlite_database_v1(&path, false).unwrap();
        let error = cancel_source_handoff_v1(&mut database, &handoff, 5).unwrap_err();
        assert!(error.to_string().contains("cannot be cancelled"));
        assert!(require_handoff_admission(&database, HandoffAdmission::CanonicalWrite).is_err());
        assert!(require_normalized_provider_handoff_admission_v2(&database).is_err());
        let unchanged: bool = database
            .query_row(
                "SELECT phase = 'authorized' AND canonical_authorization IS NULL
            FROM library_local_handoff;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(unchanged);
        assert!(require_normalized_handoff_reset_v1(&database).is_err());
    }
}
