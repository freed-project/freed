//! The durable bridge from one exact Automerge commit to the SQLite shadow.
//!
//! Automerge commits, then SQLite commits. Nothing makes those two writes
//! atomic, so the gap between them has to be survivable rather than wished
//! away. Every crash, restart and lost response has to land on exactly one
//! outcome, and the same one it would have reached without the interruption.
//!
//! ## Why storing the bytes is the whole mechanism
//!
//! An earlier attempt rebuilt the transaction on retry. That cannot work.
//! Envelope identity includes the actor's chain tip, and a successful commit
//! advances the tip, so a retry after a lost response rebuilds a *different*
//! transaction against the new tip. The journal then sees unfamiliar work
//! rather than a replay: it would either commit the same reads twice under new
//! operation IDs, or refuse on a stale tip, depending on timing. Taking a
//! fresh `created_at_ms` breaks it a second way, because that field is inside
//! the signed body.
//!
//! So the attempt is recorded durably, with its exact canonical envelope
//! bytes, *before* the SQLite commit is tried, keyed by a mutation identity
//! the caller keeps stable across retries. Retry replays those bytes verbatim.
//! The operation identity survives its own success.
//!
//! ## The four gaps, and what happens in each
//!
//! 1. Crash before the attempt is recorded: neither side has the read
//!    assignment beyond Automerge's own commit, and the next attempt builds
//!    fresh against the current tip. Nothing is lost, because Automerge is
//!    still authoritative and the shadow simply has not caught up.
//! 2. Crash after recording, before the SQLite commit: the stored bytes are
//!    replayed and commit exactly once.
//! 3. Crash after the SQLite commit, before the attempt is marked complete:
//!    the journal's own transaction replay returns the committed receipt, and
//!    the attempt is marked complete from it.
//! 4. Crash after marking complete: the stored completion is returned.
//!
//! ## What this is not
//!
//! Not authority. Automerge remains the writer; a disagreement here is
//! evidence, never an override. Native code loads authority and actor state
//! itself and verifies the original canonical bytes; a caller cannot hand in a
//! pre-verified object. No provider request belongs anywhere in this path.

use crate::library_core_journal::{
    ActorState, LibraryCoreJournal, ReadBridgeAttempt, TransactionReceipt,
};
use crate::library_core_read_transactions::{build_read_transaction, ReadAssignmentIntent};
use ring::signature::Ed25519KeyPair;

/// The exact durable Automerge revision a mutation committed at.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SourceRevision {
    pub(crate) storage_generation: i64,
    pub(crate) save_revision: i64,
    pub(crate) heads_digest: String,
}

/// What the caller is asking to shadow, named by a stable mutation identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReadBridgeRequest {
    /// Stable across retries of the same mutation. This is what makes an exact
    /// retry possible at all, so a caller that regenerates it per attempt has
    /// defeated the mechanism.
    pub(crate) attempt_id: String,
    pub(crate) source: SourceRevision,
    pub(crate) intents: Vec<ReadAssignmentIntent>,
    /// Inside the signed envelopes. Stored on the first attempt and reused,
    /// never re-read from the clock on retry.
    pub(crate) created_at_ms: i64,
}

fn invalid(what: &str) -> String {
    format!("Library Core read bridge {what} is invalid")
}

fn validate_request(request: &ReadBridgeRequest) -> Result<(), String> {
    if request.attempt_id.is_empty() || request.attempt_id.len() > 128 {
        return Err(invalid("attempt ID"));
    }
    if request.source.heads_digest.len() != 64
        || !request
            .source
            .heads_digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid("source heads digest"));
    }
    if request.source.storage_generation < 0 || request.source.save_revision < 0 {
        return Err(invalid("source revision"));
    }
    if request.created_at_ms < 0 {
        return Err(invalid("creation time"));
    }
    Ok(())
}

/// A stored attempt must describe the same fact the caller is now asking for.
///
/// Reusing one mutation identity for a different revision or a different actor
/// is two facts sharing a name, and replaying the stored bytes would silently
/// answer the wrong question.
fn require_same_fact(
    stored: &ReadBridgeAttempt,
    request: &ReadBridgeRequest,
    actor: &ActorState,
) -> Result<(), String> {
    if stored.source_storage_generation != request.source.storage_generation
        || stored.source_save_revision != request.source.save_revision
        || stored.source_heads_digest != request.source.heads_digest
    {
        return Err(format!(
            "Library Core read bridge attempt {} was recorded against a different Automerge revision",
            stored.attempt_id
        ));
    }
    if stored.library_id != actor.library_id
        || stored.epoch_id != actor.epoch_id
        || stored.actor_id != actor.actor_id
    {
        return Err(format!(
            "Library Core read bridge attempt {} was recorded by a different actor",
            stored.attempt_id
        ));
    }
    Ok(())
}

/// Resolve one mutation to exactly one committed SQLite transaction.
///
/// Safe to call again with the same request after any interruption.
pub(crate) fn bridge_read_assignments(
    journal: &mut LibraryCoreJournal,
    request: &ReadBridgeRequest,
    library_id: &str,
    epoch_id: &str,
    actor_id: &str,
    actor_key_pair: &Ed25519KeyPair,
    now_ms: i64,
) -> Result<TransactionReceipt, String> {
    validate_request(request)?;

    // Authority and actor state are loaded here, natively. A caller cannot
    // hand in an actor it decided was enrolled.
    let actor = journal
        .actor_state(library_id, epoch_id, actor_id)
        .map_err(|error| format!("Library Core could not read actor state: {error}"))?
        .ok_or_else(|| "Library Core has no enrolled actor for this library".to_string())?;

    let stored = journal
        .read_bridge_attempt(&request.attempt_id)
        .map_err(|error| format!("Library Core could not read the bridge attempt: {error}"))?;

    let attempt = match stored {
        Some(stored) => {
            require_same_fact(&stored, request, &actor)?;
            stored
        }
        None => {
            // Gap 1 ends here: from the moment this insert commits, the exact
            // bytes are recoverable and no later rebuild can change them.
            let envelopes = build_read_transaction(
                &actor,
                &request.intents,
                actor_key_pair,
                request.created_at_ms,
            )?;
            let (transaction_id, transaction_digest) = transaction_identity(&envelopes)?;
            let attempt = ReadBridgeAttempt {
                attempt_id: request.attempt_id.clone(),
                library_id: actor.library_id.clone(),
                epoch_id: actor.epoch_id.clone(),
                actor_id: actor.actor_id.clone(),
                source_storage_generation: request.source.storage_generation,
                source_save_revision: request.source.save_revision,
                source_heads_digest: request.source.heads_digest.clone(),
                actor_sequence: actor.next_sequence,
                previous_operation_id: actor.previous_operation_id.clone(),
                previous_chain_digest: actor.previous_chain_digest.clone(),
                created_at_ms: request.created_at_ms,
                transaction_id,
                transaction_digest,
                canonical_envelopes: envelopes,
                committed: false,
                committed_ingest_sequence: None,
            };
            journal
                .prepare_read_bridge_attempt(&attempt, now_ms)
                .map_err(|error| {
                    format!("Library Core could not record the bridge attempt: {error}")
                })?;
            attempt
        }
    };

    // Replay the stored bytes, never a rebuild. The journal answers a repeat
    // of an already-committed transaction with its stored receipt, so gaps 3
    // and 4 both land here and both return the same completion.
    let receipt = journal
        .verify_and_commit_read_transaction(&attempt.canonical_envelopes, now_ms)
        .map_err(|error| format!("Library Core could not commit read assignments: {error}"))?;

    if !attempt.committed {
        journal
            .complete_read_bridge_attempt(&attempt.attempt_id, receipt.last_ingest_sequence, now_ms)
            .map_err(|error| {
                format!("Library Core could not complete the bridge attempt: {error}")
            })?;
    }

    Ok(receipt)
}

/// Read the transaction identity back out of the envelopes that carry it.
///
/// Taken from the bytes rather than recomputed, so the stored row can never
/// name a transaction the stored bytes do not contain.
fn transaction_identity(envelopes: &[Vec<u8>]) -> Result<(String, String), String> {
    let first = envelopes.first().ok_or_else(|| invalid("envelope set"))?;
    let value: serde_json::Value =
        serde_json::from_slice(first).map_err(|_| invalid("canonical envelope"))?;
    let object = value
        .as_object()
        .ok_or_else(|| invalid("canonical envelope"))?;
    let transaction_id = object
        .get("transaction_id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| invalid("transaction ID"))?;
    let transaction_digest = object
        .get("transaction_digest")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| invalid("transaction digest"))?;
    Ok((transaction_id.to_owned(), transaction_digest.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_actor_enrollment::{
        enroll_desktop_actor, ActorKeyStore, EnrollmentAuthority,
    };
    use crate::library_core_authority_genesis::{
        establish_with_key_pair_for_test, LegacySourceRevision,
    };
    use tempfile::tempdir;

    struct FixedActorKeyStore(Vec<u8>);

    impl ActorKeyStore for FixedActorKeyStore {
        fn load(&self, _library_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(self.0.clone()))
        }

        fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
            Ok(())
        }
    }

    fn authority_key_pair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[7_u8; 32]).unwrap()
    }

    struct Fixture {
        directory: tempfile::TempDir,
        journal: LibraryCoreJournal,
        actor: ActorState,
        actor_key_pair: Ed25519KeyPair,
        pkcs8: Vec<u8>,
    }

    impl Fixture {
        /// Reopen the same database, standing in for a process restart.
        fn restart(self) -> Self {
            let path = self.directory.path().join("library-core.sqlite");
            drop(self.journal);
            let journal = LibraryCoreJournal::open(&path).expect("reopen journal");
            Self {
                directory: self.directory,
                journal,
                actor: self.actor,
                actor_key_pair: Ed25519KeyPair::from_pkcs8(&self.pkcs8).unwrap(),
                pkcs8: self.pkcs8,
            }
        }
    }

    fn fixture() -> Fixture {
        let directory = tempdir().unwrap();
        let mut journal =
            LibraryCoreJournal::open(&directory.path().join("library-core.sqlite")).unwrap();
        let accepted = establish_with_key_pair_for_test(
            &mut journal,
            &LegacySourceRevision {
                document_id: "freed-library-document-1".to_string(),
                heads_digest: "a".repeat(64),
                head_count: 2,
                storage_generation: 7,
                storage_save_revision: 11,
            },
            &authority_key_pair(),
            1_700,
        )
        .unwrap();
        let pkcs8 =
            ring::signature::Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new())
                .unwrap()
                .as_ref()
                .to_vec();
        let actor = enroll_desktop_actor(
            &mut journal,
            &EnrollmentAuthority {
                library_id: accepted.library_id.clone(),
                epoch: accepted.epoch,
                epoch_id: accepted.epoch_id.clone(),
                authority_key_id: accepted.authority_key_id.clone(),
                installation_witness: "c".repeat(64),
            },
            &FixedActorKeyStore(pkcs8.clone()),
            &authority_key_pair(),
            2_000,
        )
        .unwrap();
        Fixture {
            directory,
            journal,
            actor,
            actor_key_pair: Ed25519KeyPair::from_pkcs8(&pkcs8).unwrap(),
            pkcs8,
        }
    }

    fn request(attempt_id: &str) -> ReadBridgeRequest {
        ReadBridgeRequest {
            attempt_id: attempt_id.to_string(),
            source: SourceRevision {
                storage_generation: 7,
                save_revision: 11,
                heads_digest: "a".repeat(64),
            },
            intents: vec![
                ReadAssignmentIntent {
                    entity_id: "feed-item-a".to_string(),
                    read_at_ms: 5_000,
                },
                ReadAssignmentIntent {
                    entity_id: "feed-item-b".to_string(),
                    read_at_ms: 5_000,
                },
            ],
            created_at_ms: 6_000,
        }
    }

    fn bridge(
        f: &mut Fixture,
        request: &ReadBridgeRequest,
        now_ms: i64,
    ) -> Result<TransactionReceipt, String> {
        let (library_id, epoch_id, actor_id) = (
            f.actor.library_id.clone(),
            f.actor.epoch_id.clone(),
            f.actor.actor_id.clone(),
        );
        bridge_read_assignments(
            &mut f.journal,
            request,
            &library_id,
            &epoch_id,
            &actor_id,
            &f.actor_key_pair,
            now_ms,
        )
    }

    fn count(f: &Fixture, sql: &str) -> i64 {
        f.journal
            .connection_for_test()
            .query_row(sql, [], |row| row.get(0))
            .unwrap()
    }

    fn read_state(f: &Fixture, entity_id: &str) -> Option<i64> {
        f.journal
            .connection_for_test()
            .query_row(
                "SELECT readAtMs FROM library_core_feed_item_read_state WHERE entityId = ?1;",
                [entity_id],
                |row| row.get(0),
            )
            .ok()
    }

    #[test]
    fn a_single_mutation_reaches_sqlite_and_materializes() {
        let mut f = fixture();

        let receipt = bridge(&mut f, &request("mutation-1"), 6_500).unwrap();

        assert_eq!(receipt.member_count, 2);
        assert_eq!(read_state(&f, "feed-item-a"), Some(5_000));
        assert_eq!(read_state(&f, "feed-item-b"), Some(5_000));
        assert_eq!(
            count(
                &f,
                "SELECT COUNT(*) FROM library_core_read_bridge_attempts WHERE state = 'committed';"
            ),
            1
        );
    }

    /// Gap 4, and the case the previous design could not express: the commit
    /// succeeded, the response was lost, the caller retries. It must get the
    /// committed receipt, not a second transaction.
    #[test]
    fn a_lost_response_retry_returns_the_committed_receipt() {
        let mut f = fixture();

        let first = bridge(&mut f, &request("mutation-1"), 6_500).unwrap();
        // A later wall clock, exactly as a real retry would have.
        let second = bridge(&mut f, &request("mutation-1"), 90_000).unwrap();

        assert_eq!(first, second);
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            2
        );
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_replication_outbox;"),
            2
        );
    }

    /// Gap 2: the attempt is durable but the SQLite commit never happened.
    /// A restart must replay the stored bytes and commit exactly once.
    #[test]
    fn a_restart_resumes_a_prepared_attempt_exactly_once() {
        let mut f = fixture();
        let envelopes = build_read_transaction(
            &f.actor,
            &request("mutation-1").intents,
            &f.actor_key_pair,
            6_000,
        )
        .unwrap();
        let (transaction_id, transaction_digest) = transaction_identity(&envelopes).unwrap();
        f.journal
            .prepare_read_bridge_attempt(
                &ReadBridgeAttempt {
                    attempt_id: "mutation-1".to_string(),
                    library_id: f.actor.library_id.clone(),
                    epoch_id: f.actor.epoch_id.clone(),
                    actor_id: f.actor.actor_id.clone(),
                    source_storage_generation: 7,
                    source_save_revision: 11,
                    source_heads_digest: "a".repeat(64),
                    actor_sequence: f.actor.next_sequence,
                    previous_operation_id: f.actor.previous_operation_id.clone(),
                    previous_chain_digest: f.actor.previous_chain_digest.clone(),
                    created_at_ms: 6_000,
                    transaction_id,
                    transaction_digest,
                    canonical_envelopes: envelopes,
                    committed: false,
                    committed_ingest_sequence: None,
                },
                6_100,
            )
            .unwrap();
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            0
        );

        let mut f = f.restart();
        let receipt = bridge(&mut f, &request("mutation-1"), 7_000).unwrap();

        assert_eq!(receipt.member_count, 2);
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            2
        );
        assert_eq!(read_state(&f, "feed-item-a"), Some(5_000));

        // And retrying after the resume is still the same answer.
        let again = bridge(&mut f, &request("mutation-1"), 8_000).unwrap();
        assert_eq!(receipt, again);
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            2
        );
    }

    /// Gap 1: nothing was recorded, so nothing is owed. The next attempt is
    /// ordinary new work.
    #[test]
    fn a_crash_before_recording_leaves_neither_side_written() {
        let f = fixture();

        assert_eq!(
            count(
                &f,
                "SELECT COUNT(*) FROM library_core_read_bridge_attempts;"
            ),
            0
        );
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            0
        );

        let mut f = f.restart();
        bridge(&mut f, &request("mutation-1"), 6_500).unwrap();
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            2
        );
    }

    /// Gap 3: SQLite committed but the attempt was never marked complete.
    /// The journal's own replay supplies the receipt and the attempt closes.
    #[test]
    fn a_committed_transaction_with_an_unfinished_attempt_completes_on_retry() {
        let mut f = fixture();
        bridge(&mut f, &request("mutation-1"), 6_500).unwrap();

        // Reopen the gap: the transaction is committed, the attempt is not.
        f.journal
            .connection_for_test()
            .execute(
                "UPDATE library_core_read_bridge_attempts
                 SET state = 'prepared', committedAtMs = NULL, committedIngestSequence = NULL;",
                [],
            )
            .unwrap();

        let mut f = f.restart();
        let receipt = bridge(&mut f, &request("mutation-1"), 9_000).unwrap();

        assert_eq!(receipt.member_count, 2);
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            2
        );
        assert_eq!(
            count(
                &f,
                "SELECT COUNT(*) FROM library_core_read_bridge_attempts WHERE state = 'committed';"
            ),
            1
        );
    }

    /// Two different mutations are two transactions, and the chain continues.
    #[test]
    fn separate_mutations_commit_separately_and_extend_the_chain() {
        let mut f = fixture();
        let first = bridge(&mut f, &request("mutation-1"), 6_500).unwrap();

        let mut second_request = request("mutation-2");
        second_request.intents = vec![ReadAssignmentIntent {
            entity_id: "feed-item-c".to_string(),
            read_at_ms: 5_500,
        }];
        second_request.created_at_ms = 7_000;
        let second = bridge(&mut f, &second_request, 7_100).unwrap();

        assert_ne!(first.transaction_id, second.transaction_id);
        assert_eq!(second.first_sequence, 3, "the chain continues, not forks");
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            3
        );
    }

    /// One mutation identity naming two different Automerge revisions is two
    /// facts sharing a name. Replaying the stored bytes would answer the wrong
    /// question, so it fails closed instead.
    #[test]
    fn reusing_an_attempt_id_for_a_different_revision_fails_closed() {
        let mut f = fixture();
        bridge(&mut f, &request("mutation-1"), 6_500).unwrap();

        let mut moved = request("mutation-1");
        moved.source.save_revision = 12;
        let error = bridge(&mut f, &moved, 7_000).unwrap_err();

        assert!(error.contains("different Automerge revision"), "{error}");
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            2
        );
    }

    #[test]
    fn a_malformed_request_is_refused_before_anything_is_recorded() {
        let mut f = fixture();

        for broken in [
            ReadBridgeRequest {
                attempt_id: String::new(),
                ..request("x")
            },
            ReadBridgeRequest {
                source: SourceRevision {
                    heads_digest: "not a digest".to_string(),
                    ..request("x").source
                },
                ..request("x")
            },
            ReadBridgeRequest {
                created_at_ms: -1,
                ..request("x")
            },
        ] {
            assert!(bridge(&mut f, &broken, 6_500).is_err());
        }

        assert_eq!(
            count(
                &f,
                "SELECT COUNT(*) FROM library_core_read_bridge_attempts;"
            ),
            0
        );
        assert_eq!(
            count(&f, "SELECT COUNT(*) FROM library_core_operations;"),
            0
        );
    }

    /// The stored row must name the transaction the stored bytes contain, or a
    /// resume could commit one transaction while recording another.
    #[test]
    fn the_recorded_identity_matches_the_recorded_bytes() {
        let mut f = fixture();
        bridge(&mut f, &request("mutation-1"), 6_500).unwrap();

        let stored = f
            .journal
            .read_bridge_attempt("mutation-1")
            .unwrap()
            .unwrap();
        let (transaction_id, transaction_digest) =
            transaction_identity(&stored.canonical_envelopes).unwrap();

        assert_eq!(stored.transaction_id, transaction_id);
        assert_eq!(stored.transaction_digest, transaction_digest);
        assert!(stored.committed);
    }
}
