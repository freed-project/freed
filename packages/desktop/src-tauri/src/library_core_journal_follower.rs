//! Durable state for a non-authoritative editable Freed Desktop follower.
//!
//! These rows are deliberately separate from the active authority epoch and
//! cloud-writer admission. Installing an authenticated checkpoint anchor can
//! therefore make local materialized data readable without granting this
//! installation permission to commit canonical operations, run provider
//! capture, or advance the cloud control pointer.

use super::{
    is_lower_hex, AcceptedAuthorityState, JournalError, JournalResult, LibraryCoreJournal,
    MAX_CAUSAL_TIPS_PER_OPERATION, MAX_SAFE_INTEGER,
};
use crate::library_core_canonical::encode_canonical_value;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

const MAX_CONTROL_REVISION_BYTES: usize = 512;
const MAX_MANIFEST_OBJECT_KEY_BYTES: usize = 4_096;
const MAX_FRONTIER_BYTES: usize = 4_194_304;

fn invalid(field: &'static str) -> JournalError {
    JournalError::InvalidVerifiedInput { field }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedFollowerAnchor {
    pub(crate) authority: AcceptedAuthorityState,
    pub(crate) manifest_object_key: String,
    pub(crate) manifest_content_digest: String,
    pub(crate) generation: i64,
    pub(crate) remote_ingest_sequence: i64,
    pub(crate) remote_materialized_digest: String,
    pub(crate) writer_id: String,
    pub(crate) control_revision: String,
    pub(crate) installed_at_ms: i64,
}

fn canonical_frontier(authority: &AcceptedAuthorityState) -> JournalResult<String> {
    if authority.observed_frontier.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
        return Err(invalid("follower_anchor.observed_frontier"));
    }
    let mut previous: Option<(&str, i64, &str, &str)> = None;
    let mut values = Vec::with_capacity(authority.observed_frontier.len());
    for tip in &authority.observed_frontier {
        if !is_lower_hex(&tip.actor_id, 32)
            || !(1..=MAX_SAFE_INTEGER).contains(&tip.sequence)
            || tip.operation_id.is_empty()
            || tip.operation_id.len() > 128
            || !is_lower_hex(&tip.chain_digest, 32)
        {
            return Err(invalid("follower_anchor.observed_frontier"));
        }
        let current = (
            tip.actor_id.as_str(),
            tip.sequence,
            tip.operation_id.as_str(),
            tip.chain_digest.as_str(),
        );
        if previous.is_some_and(|prior| prior >= current) {
            return Err(invalid("follower_anchor.observed_frontier"));
        }
        previous = Some(current);
        values.push(json!({
            "actor_id": tip.actor_id,
            "sequence": tip.sequence,
            "operation_id": tip.operation_id,
            "chain_digest": tip.chain_digest,
        }));
    }
    let bytes = encode_canonical_value(&Value::Array(values), MAX_FRONTIER_BYTES)
        .map_err(|_| invalid("follower_anchor.observed_frontier"))?;
    String::from_utf8(bytes).map_err(|_| invalid("follower_anchor.observed_frontier"))
}

fn validate(anchor: &VerifiedFollowerAnchor) -> JournalResult<String> {
    let authority = &anchor.authority;
    if !is_lower_hex(&authority.library_id, 32)
        || !(1..=MAX_SAFE_INTEGER).contains(&authority.epoch)
        || !is_lower_hex(&authority.epoch_id, 32)
        || !is_lower_hex(&authority.authority_key_id, 32)
        || !is_lower_hex(&authority.authority_public_key, 32)
        || anchor.manifest_object_key.is_empty()
        || anchor.manifest_object_key.len() > MAX_MANIFEST_OBJECT_KEY_BYTES
        || !is_lower_hex(&anchor.manifest_content_digest, 32)
        || !(0..=MAX_SAFE_INTEGER).contains(&anchor.generation)
        || !(0..=MAX_SAFE_INTEGER).contains(&anchor.remote_ingest_sequence)
        || !is_lower_hex(&anchor.remote_materialized_digest, 32)
        || !is_lower_hex(&anchor.writer_id, 32)
        || anchor.control_revision.is_empty()
        || anchor.control_revision.len() > MAX_CONTROL_REVISION_BYTES
        || !(0..=MAX_SAFE_INTEGER).contains(&anchor.installed_at_ms)
    {
        return Err(invalid("follower_anchor"));
    }
    canonical_frontier(authority)
}

impl LibraryCoreJournal {
    /// Install or advance one verified immutable-checkpoint anchor.
    ///
    /// A different Library is never adopted implicitly. An epoch transition is
    /// also refused while this follower has actor state, because dropping an
    /// unpublished intent chain would require an explicit user recovery choice.
    pub(crate) fn install_follower_anchor(
        &mut self,
        anchor: &VerifiedFollowerAnchor,
    ) -> JournalResult<VerifiedFollowerAnchor> {
        let observed_frontier_json = validate(anchor)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = transaction
            .query_row(
                "SELECT libraryId, epoch, epochId, manifestObjectKey,
                        manifestContentDigest, generation, remoteIngestSequence,
                        remoteMaterializedDigest, writerId
                 FROM library_core_follower_anchor WHERE singletonId = 1;",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                    ))
                },
            )
            .optional()?;

        if let Some(existing) = existing.as_ref() {
            if existing.0 != anchor.authority.library_id {
                return Err(invalid("follower_anchor.library_id"));
            }
            if anchor.authority.epoch < existing.1
                || (anchor.authority.epoch == existing.1 && anchor.authority.epoch_id != existing.2)
            {
                return Err(invalid("follower_anchor.epoch"));
            }
            if anchor.authority.epoch == existing.1 {
                if anchor.writer_id != existing.8
                    || anchor.generation < existing.5
                    || anchor.remote_ingest_sequence < existing.6
                {
                    return Err(invalid("follower_anchor.checkpoint_order"));
                }
                if anchor.generation == existing.5
                    && (anchor.manifest_object_key != existing.3
                        || anchor.manifest_content_digest != existing.4
                        || anchor.remote_ingest_sequence != existing.6
                        || anchor.remote_materialized_digest != existing.7)
                {
                    return Err(invalid("follower_anchor.checkpoint_identity"));
                }
            } else {
                let actor_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM library_core_follower_actor;",
                    [],
                    |row| row.get(0),
                )?;
                if actor_count != 0 {
                    return Err(invalid("follower_anchor.pending_epoch_state"));
                }
            }
            transaction.execute(
                "UPDATE library_core_follower_anchor
                 SET epoch = ?1, epochId = ?2, authorityKeyId = ?3,
                     authorityPublicKey = ?4, observedFrontierJson = ?5,
                     manifestObjectKey = ?6, manifestContentDigest = ?7,
                     generation = ?8, remoteIngestSequence = ?9,
                     remoteMaterializedDigest = ?10, writerId = ?11,
                     controlRevision = ?12, installedAtMs = ?13
                 WHERE singletonId = 1;",
                params![
                    anchor.authority.epoch,
                    anchor.authority.epoch_id,
                    anchor.authority.authority_key_id,
                    anchor.authority.authority_public_key,
                    observed_frontier_json,
                    anchor.manifest_object_key,
                    anchor.manifest_content_digest,
                    anchor.generation,
                    anchor.remote_ingest_sequence,
                    anchor.remote_materialized_digest,
                    anchor.writer_id,
                    anchor.control_revision,
                    anchor.installed_at_ms,
                ],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO library_core_follower_anchor (
                   singletonId, libraryId, epoch, epochId, authorityKeyId,
                   authorityPublicKey, observedFrontierJson, manifestObjectKey,
                   manifestContentDigest, generation, remoteIngestSequence,
                   remoteMaterializedDigest, writerId, controlRevision,
                   installedAtMs
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                           ?11, ?12, ?13, ?14);",
                params![
                    anchor.authority.library_id,
                    anchor.authority.epoch,
                    anchor.authority.epoch_id,
                    anchor.authority.authority_key_id,
                    anchor.authority.authority_public_key,
                    observed_frontier_json,
                    anchor.manifest_object_key,
                    anchor.manifest_content_digest,
                    anchor.generation,
                    anchor.remote_ingest_sequence,
                    anchor.remote_materialized_digest,
                    anchor.writer_id,
                    anchor.control_revision,
                    anchor.installed_at_ms,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(anchor.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_journal::VerifiedCausalTip;

    fn anchor(generation: i64, ingest_sequence: i64) -> VerifiedFollowerAnchor {
        VerifiedFollowerAnchor {
            authority: AcceptedAuthorityState {
                library_id: "a".repeat(64),
                epoch: 3,
                epoch_id: "b".repeat(64),
                authority_key_id: "c".repeat(64),
                authority_public_key: "d".repeat(64),
                observed_frontier: vec![VerifiedCausalTip {
                    actor_id: "e".repeat(64),
                    sequence: 7,
                    operation_id: "operation-7".to_string(),
                    chain_digest: "f".repeat(64),
                }],
            },
            manifest_object_key: format!("manifest-{generation}"),
            manifest_content_digest: if generation == 1 {
                "1".repeat(64)
            } else {
                "2".repeat(64)
            },
            generation,
            remote_ingest_sequence: ingest_sequence,
            remote_materialized_digest: if generation == 1 {
                "3".repeat(64)
            } else {
                "4".repeat(64)
            },
            writer_id: "5".repeat(64),
            control_revision: format!("revision-{generation}"),
            installed_at_ms: 1_000 + generation,
        }
    }

    #[test]
    fn checkpoint_anchor_never_grants_writer_admission() {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        let installed = journal.install_follower_anchor(&anchor(1, 10)).unwrap();
        assert_eq!(installed.generation, 1);
        let writer_admission: i64 = journal
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_cloud_writer_admission;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let authority_epochs: i64 = journal
            .connection_for_test()
            .query_row(
                "SELECT COUNT(*) FROM library_core_authority_epochs;",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(writer_admission, 0);
        assert_eq!(authority_epochs, 0);
    }

    #[test]
    fn checkpoint_anchor_advances_monotonically_and_rejects_changed_replay() {
        let mut journal = LibraryCoreJournal::open_in_memory().unwrap();
        journal.install_follower_anchor(&anchor(1, 10)).unwrap();
        journal.install_follower_anchor(&anchor(2, 20)).unwrap();

        let mut stale = anchor(1, 10);
        stale.control_revision = "late-response".to_string();
        assert!(journal.install_follower_anchor(&stale).is_err());

        let mut changed_replay = anchor(2, 20);
        changed_replay.manifest_content_digest = "9".repeat(64);
        assert!(journal.install_follower_anchor(&changed_replay).is_err());
    }
}
