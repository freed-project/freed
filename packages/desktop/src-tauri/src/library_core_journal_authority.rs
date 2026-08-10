//! Stored authority-epoch state for the dormant authoritative journal.
//!
//! Transition certificates are verified by the caller, not here. This module
//! stores an already-verified decision and answers what the active epoch is,
//! so enrollment and operation commits can prove their same-transaction
//! active-epoch fences. `library_core_authority_genesis` builds and verifies
//! the one certificate a fresh installation can mint for itself.

use super::{
    is_lower_hex, is_operation_id, AcceptedAuthorityState, JournalError, JournalResult,
    VerifiedCausalTip, MAX_CAUSAL_TIPS_PER_OPERATION, MAX_SAFE_INTEGER,
};
use super::{LibraryCoreJournal, VerifiedAuthorityEpoch, MAX_TRANSACTION_ENVELOPE_BYTES};
use rusqlite::TransactionBehavior;
use rusqlite::{params, Connection, OptionalExtension};

fn invalid(field: &'static str) -> JournalError {
    JournalError::InvalidVerifiedInput { field }
}

fn validate_authority_state(authority: &AcceptedAuthorityState) -> JournalResult<()> {
    if !is_lower_hex(&authority.library_id, 32) {
        return Err(invalid("authority.library_id"));
    }
    if !(1..=MAX_SAFE_INTEGER).contains(&authority.epoch) {
        return Err(invalid("authority.epoch"));
    }
    for (field, value) in [
        ("authority.epoch_id", authority.epoch_id.as_str()),
        (
            "authority.authority_key_id",
            authority.authority_key_id.as_str(),
        ),
        (
            "authority.authority_public_key",
            authority.authority_public_key.as_str(),
        ),
    ] {
        if !is_lower_hex(value, 32) {
            return Err(invalid(field));
        }
    }
    if authority.observed_frontier.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
        return Err(invalid("authority.observed_frontier"));
    }
    let mut previous: Option<(&str, i64, &str, &str)> = None;
    for tip in &authority.observed_frontier {
        if !is_lower_hex(&tip.actor_id, 32)
            || !(1..=MAX_SAFE_INTEGER).contains(&tip.sequence)
            || !is_operation_id(&tip.operation_id)
            || !is_lower_hex(&tip.chain_digest, 32)
        {
            return Err(invalid("authority.observed_frontier"));
        }
        let current = (
            tip.actor_id.as_str(),
            tip.sequence,
            tip.operation_id.as_str(),
            tip.chain_digest.as_str(),
        );
        if previous.is_some_and(|prior| prior >= current) {
            return Err(invalid("authority.observed_frontier"));
        }
        previous = Some(current);
    }
    Ok(())
}

fn validate_verified_epoch(epoch: &VerifiedAuthorityEpoch) -> JournalResult<()> {
    validate_authority_state(&epoch.authority)?;
    if !is_lower_hex(&epoch.transition_certificate_digest, 32) {
        return Err(invalid("transition_certificate_digest"));
    }
    if epoch.canonical_transition_certificate_json.is_empty()
        || epoch.canonical_transition_certificate_json.len() > MAX_TRANSACTION_ENVELOPE_BYTES
    {
        return Err(invalid("canonical_transition_certificate_json"));
    }
    if !(0..=MAX_SAFE_INTEGER).contains(&epoch.accepted_at_ms) {
        return Err(invalid("accepted_at_ms"));
    }
    Ok(())
}

fn observed_frontier(
    connection: &Connection,
    library_id: &str,
    epoch_id: &str,
) -> JournalResult<Vec<VerifiedCausalTip>> {
    let mut statement = connection.prepare(
        "SELECT tipIndex, actorId, sequence, operationId, chainDigest
         FROM library_core_authority_frontier
         WHERE libraryId = ?1 AND epochId = ?2
         ORDER BY tipIndex;",
    )?;
    let indexed_tips = statement
        .query_map(params![library_id, epoch_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                VerifiedCausalTip {
                    actor_id: row.get(1)?,
                    sequence: row.get(2)?,
                    operation_id: row.get(3)?,
                    chain_digest: row.get(4)?,
                },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if indexed_tips.len() > MAX_CAUSAL_TIPS_PER_OPERATION
        || indexed_tips
            .iter()
            .enumerate()
            .any(|(index, (stored_index, _))| *stored_index != index as i64)
    {
        return Err(invalid("authority.observed_frontier"));
    }
    Ok(indexed_tips.into_iter().map(|(_, tip)| tip).collect())
}

pub(super) fn active_authority(
    connection: &Connection,
    library_id: &str,
) -> JournalResult<Option<AcceptedAuthorityState>> {
    let row = connection
        .query_row(
            "SELECT epochs.libraryId, epochs.epoch, epochs.epochId,
                    epochs.authorityKeyId, epochs.authorityPublicKey
             FROM library_core_active_authority AS active
             JOIN library_core_authority_epochs AS epochs
               ON epochs.libraryId = active.libraryId
              AND epochs.epoch = active.epoch
              AND epochs.epochId = active.epochId
              AND epochs.transitionCertificateDigest =
                    active.transitionCertificateDigest
             WHERE active.libraryId = ?1;",
            [library_id],
            |row| {
                Ok(AcceptedAuthorityState {
                    library_id: row.get(0)?,
                    epoch: row.get(1)?,
                    epoch_id: row.get(2)?,
                    authority_key_id: row.get(3)?,
                    authority_public_key: row.get(4)?,
                    observed_frontier: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut authority) = row else {
        return Ok(None);
    };
    authority.observed_frontier =
        observed_frontier(connection, &authority.library_id, &authority.epoch_id)?;
    validate_authority_state(&authority)?;
    Ok(Some(authority))
}

pub(super) fn require_active_authority(
    connection: &Connection,
    expected: &AcceptedAuthorityState,
) -> JournalResult<()> {
    let actual = active_authority(connection, &expected.library_id)?.ok_or_else(|| {
        JournalError::AuthorityNotFound {
            library_id: expected.library_id.clone(),
        }
    })?;
    if actual != *expected {
        return Err(JournalError::StaleAuthority {
            library_id: expected.library_id.clone(),
        });
    }
    Ok(())
}

pub(super) fn require_active_epoch(
    connection: &Connection,
    library_id: &str,
    epoch: i64,
    epoch_id: &str,
) -> JournalResult<()> {
    let matches = connection.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM library_core_active_authority AS active
           JOIN library_core_authority_epochs AS epochs
             ON epochs.libraryId = active.libraryId
            AND epochs.epoch = active.epoch
            AND epochs.epochId = active.epochId
            AND epochs.transitionCertificateDigest =
                  active.transitionCertificateDigest
           WHERE active.libraryId = ?1 AND active.epoch = ?2
             AND active.epochId = ?3
         );",
        params![library_id, epoch, epoch_id],
        |row| row.get::<_, bool>(0),
    )?;
    if !matches {
        return Err(JournalError::StaleAuthority {
            library_id: library_id.to_owned(),
        });
    }
    Ok(())
}

impl LibraryCoreJournal {
    /// Return the complete active authority record, including the canonical
    /// transition certificate required for response-loss recovery.
    pub(crate) fn active_authority_epoch(
        &self,
        library_id: &str,
    ) -> JournalResult<Option<VerifiedAuthorityEpoch>> {
        let Some(authority) = active_authority(&self.connection, library_id)? else {
            return Ok(None);
        };
        let stored = self.connection.query_row(
            "SELECT epochs.transitionCertificateDigest,
                    epochs.canonicalTransitionCertificateJson,
                    epochs.acceptedAtMs
             FROM library_core_active_authority AS active
             JOIN library_core_authority_epochs AS epochs
               ON epochs.libraryId = active.libraryId
              AND epochs.epoch = active.epoch
              AND epochs.epochId = active.epochId
              AND epochs.transitionCertificateDigest = active.transitionCertificateDigest
             WHERE active.libraryId = ?1;",
            [library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?;
        Ok(Some(VerifiedAuthorityEpoch {
            authority,
            transition_certificate_digest: stored.0,
            canonical_transition_certificate_json: stored.1,
            accepted_at_ms: stored.2,
        }))
    }

    /// Install one verified authority epoch and make it active.
    ///
    /// The caller is responsible for verifying the transition certificate;
    /// this stores an already-verified decision. Replaying the exact same
    /// epoch returns the stored authority without writing again, so a caller
    /// that crashes after committing and retries converges instead of
    /// forking. Any other epoch must be exactly one past the current one.
    pub(crate) fn install_authority_epoch(
        &mut self,
        epoch: &VerifiedAuthorityEpoch,
    ) -> JournalResult<AcceptedAuthorityState> {
        validate_verified_epoch(epoch)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = transaction
            .query_row(
                "SELECT epoch, epochId, transitionCertificateDigest
                 FROM library_core_active_authority WHERE libraryId = ?1;",
                [&epoch.authority.library_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        if let Some((current_epoch, current_epoch_id, current_digest)) = current.as_ref() {
            if *current_epoch == epoch.authority.epoch
                && current_epoch_id == &epoch.authority.epoch_id
                && current_digest == &epoch.transition_certificate_digest
            {
                transaction.commit()?;
                return active_authority(&self.connection, &epoch.authority.library_id)?
                    .ok_or_else(|| JournalError::AuthorityNotFound {
                        library_id: epoch.authority.library_id.clone(),
                    });
            }
            if current_epoch.checked_add(1) != Some(epoch.authority.epoch) {
                return Err(JournalError::StaleAuthority {
                    library_id: epoch.authority.library_id.clone(),
                });
            }
        } else if epoch.authority.epoch != 1 {
            return Err(JournalError::StaleAuthority {
                library_id: epoch.authority.library_id.clone(),
            });
        }
        transaction.execute(
            "INSERT INTO library_core_authority_epochs (
               libraryId, epoch, epochId, transitionCertificateDigest,
               canonicalTransitionCertificateJson, authorityKeyId,
               authorityPublicKey, acceptedAtMs
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);",
            params![
                epoch.authority.library_id,
                epoch.authority.epoch,
                epoch.authority.epoch_id,
                epoch.transition_certificate_digest,
                epoch.canonical_transition_certificate_json,
                epoch.authority.authority_key_id,
                epoch.authority.authority_public_key,
                epoch.accepted_at_ms,
            ],
        )?;
        for (index, tip) in epoch.authority.observed_frontier.iter().enumerate() {
            transaction.execute(
                "INSERT INTO library_core_authority_frontier (
                   libraryId, epochId, tipIndex, actorId, sequence,
                   operationId, chainDigest
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
                params![
                    epoch.authority.library_id,
                    epoch.authority.epoch_id,
                    index as i64,
                    tip.actor_id,
                    tip.sequence,
                    tip.operation_id,
                    tip.chain_digest,
                ],
            )?;
        }
        match current {
            None => {
                transaction.execute(
                    "INSERT INTO library_core_active_authority (
                       libraryId, epoch, epochId, transitionCertificateDigest
                     ) VALUES (?1, ?2, ?3, ?4);",
                    params![
                        epoch.authority.library_id,
                        epoch.authority.epoch,
                        epoch.authority.epoch_id,
                        epoch.transition_certificate_digest,
                    ],
                )?;
            }
            Some((current_epoch, current_epoch_id, current_digest)) => {
                let updated = transaction.execute(
                    "UPDATE library_core_active_authority
                     SET epoch = ?1, epochId = ?2, transitionCertificateDigest = ?3
                     WHERE libraryId = ?4 AND epoch = ?5 AND epochId = ?6
                       AND transitionCertificateDigest = ?7;",
                    params![
                        epoch.authority.epoch,
                        epoch.authority.epoch_id,
                        epoch.transition_certificate_digest,
                        epoch.authority.library_id,
                        current_epoch,
                        current_epoch_id,
                        current_digest,
                    ],
                )?;
                if updated != 1 {
                    return Err(JournalError::StaleAuthority {
                        library_id: epoch.authority.library_id.clone(),
                    });
                }
            }
        }
        transaction.commit()?;
        active_authority(&self.connection, &epoch.authority.library_id)?.ok_or_else(|| {
            JournalError::AuthorityNotFound {
                library_id: epoch.authority.library_id.clone(),
            }
        })
    }
}
