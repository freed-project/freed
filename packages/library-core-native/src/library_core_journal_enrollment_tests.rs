#[cfg(test)]
mod tests {
    use super::super::LibraryCoreJournal;
    use crate::library_core_canonical::{
        decode_canonical_value, encode_canonical_value, encode_signature_input,
    };
    use crate::library_core_error::LibraryCoreError;
    use crate::library_core_journal::VerifiedAuthorityEpoch;
    use crate::normalized_authority::{NormalizedAuthorityStateV2, NormalizedCausalTipV1};
    use crate::normalized_enrollment_verifier::*;
    use crate::normalized_protocol_limits::MAX_TRANSACTION_ENVELOPE_BYTES;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use serde_json::{json, Value};

    fn capability_vectors() -> Value {
        serde_json::from_str(include_str!(
            "../../shared/src/library-core/actor-capability-certificate-v2-vectors.json"
        ))
        .expect("cross-runtime actor capability vectors must parse")
    }

    fn vector_authority(vector: &Value) -> NormalizedAuthorityStateV2 {
        let authority = vector["authority_state"]
            .as_object()
            .expect("vector authority state");
        NormalizedAuthorityStateV2 {
            library_id: required_string(authority, "library_id").expect("library ID"),
            epoch: positive_safe_integer(authority, "epoch").expect("epoch"),
            epoch_id: required_string(authority, "epoch_id").expect("epoch ID"),
            authority_key_id: required_string(authority, "authority_key_id")
                .expect("authority key ID"),
            authority_public_key: required_string(authority, "authority_public_key")
                .expect("authority public key"),
            observed_frontier: Vec::new(),
        }
    }

    fn hex(bytes: &[u8]) -> String {
        let mut encoded = String::with_capacity(bytes.len() * 2);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in bytes {
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
        encoded
    }

    fn authority(key_pair: &Ed25519KeyPair) -> NormalizedAuthorityStateV2 {
        let public_key = hex(key_pair.public_key().as_ref());
        NormalizedAuthorityStateV2 {
            library_id: "1".repeat(64),
            epoch: 1,
            epoch_id: "2".repeat(64),
            authority_key_id: digest_hex(
                "authority-key",
                &json!({
                    "signature_algorithm": "ed25519",
                    "authority_public_key": public_key,
                }),
            )
            .expect("authority key ID"),
            authority_public_key: public_key,
            observed_frontier: Vec::new(),
        }
    }

    fn certificate(
        actor_key: &Ed25519KeyPair,
        authority_key: &Ed25519KeyPair,
        authority: &NormalizedAuthorityStateV2,
    ) -> Vec<u8> {
        let actor_public_key = hex(actor_key.public_key().as_ref());
        let installation_incarnation = "3".repeat(64);
        let actor_incarnation_nonce = "4".repeat(64);
        let actor_public_key_fingerprint = digest_hex(
            "actor-public-key",
            &json!({
                "signature_algorithm": "ed25519",
                "actor_public_key": actor_public_key,
            }),
        )
        .expect("actor fingerprint");
        let actor_id = digest_hex(
            "actor-id",
            &json!({
                "library_id": authority.library_id,
                "installation_incarnation": installation_incarnation,
                "signature_algorithm": "ed25519",
                "actor_public_key": actor_public_key,
                "actor_incarnation_nonce": actor_incarnation_nonce,
            }),
        )
        .expect("actor ID");
        let actor_body = json!({
            "operation_id": "op:actor:enroll:native-verified",
            "operation_type": "actor_enrolled",
            "library_id": authority.library_id,
            "epoch": authority.epoch,
            "epoch_id": authority.epoch_id,
            "schema_version": 1,
            "authority_key_id": authority.authority_key_id,
            "installation_incarnation": installation_incarnation,
            "actor_incarnation_nonce": actor_incarnation_nonce,
            "actor_id": actor_id,
            "actor_public_key": actor_public_key,
            "actor_public_key_fingerprint": actor_public_key_fingerprint,
            "observed_frontier": [],
            "created_at_ms": 1_000,
            "signature_algorithm": "ed25519",
        });
        let enrollment_body_digest =
            digest_hex("actor-enrollment-body", &actor_body).expect("body digest");
        let actor_message = encode_signature_input(
            "actor-enrollment-proof",
            &json!({ "enrollment_body_digest": enrollment_body_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("actor proof input");
        let certificate_body = json!({
            "actor_enrollment_body": actor_body,
            "enrollment_body_digest": enrollment_body_digest,
            "actor_proof": hex(actor_key.sign(&actor_message).as_ref()),
        });
        let certificate_digest = digest_hex("actor-enrollment-certificate", &certificate_body)
            .expect("certificate digest");
        let authority_message = encode_signature_input(
            "actor-enrollment-authority",
            &json!({ "certificate_digest": certificate_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("authority signature input");
        encode_canonical_value(
            &json!({
                "certificate_body": certificate_body,
                "certificate_digest": certificate_digest,
                "authority_signature": hex(authority_key.sign(&authority_message).as_ref()),
            }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("canonical certificate")
    }

    fn install_authority(journal: &mut LibraryCoreJournal, authority: &NormalizedAuthorityStateV2) {
        journal
            .install_authority_epoch(&VerifiedAuthorityEpoch {
                authority: authority.clone(),
                transition_certificate_digest: "8".repeat(64),
                canonical_transition_certificate_json:
                    "{\"transition\":\"native-enrollment-fixture\"}".to_owned(),
                accepted_at_ms: 900,
            })
            .expect("install authority epoch");
        journal
            .connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?1, ?2, 'fixture-admission', 1);",
                rusqlite::params!["8".repeat(64), authority.epoch_id],
            )
            .expect("install fixture writer admission");
    }

    #[test]
    fn verifies_both_signatures_before_enrolling_the_actor() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[10_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).expect("authority key");
        let authority = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &authority);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &authority);

        let actor = journal
            .verify_and_enroll_actor(&certificate, &authority.library_id)
            .expect("verify and enroll");
        assert_eq!(actor.actor_public_key, hex(actor_key.public_key().as_ref()));
        assert_eq!(actor.next_sequence, 1);
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (1, 1));
    }

    #[test]
    fn matches_and_enrolls_the_cross_runtime_v2_capability_vector() {
        let vectors = capability_vectors();
        assert_eq!(vectors["schema_version"], 1);
        assert_eq!(vectors["format"], "freed_library_core_actor_capability_v2");
        let vector = &vectors["vectors"][0];
        let authority = vector_authority(vector);
        let certificate =
            encode_canonical_value(&vector["certificate"], MAX_TRANSACTION_ENVELOPE_BYTES)
                .expect("canonical cross-runtime certificate");
        let verified = verify_actor_enrollment(&certificate, &authority)
            .expect("verify cross-runtime v2 capability");
        assert_eq!(
            verified.actor_id,
            vector["certificate"]["certificate_body"]["actor_enrollment_body"]["actor_id"]
        );
        assert_eq!(
            verified.enrollment_certificate_digest,
            vector["certificate"]["certificate_digest"]
        );
        assert_eq!(verified.actor_chain_genesis, vector["actor_chain_genesis"]);
        assert_eq!(verified.capability.certificate_version, 2);
        assert_eq!(verified.capability.actor_class, "agent");
        assert_eq!(
            verified.capability.allowed_operation_types,
            [
                "feed_item_read_assignment".to_owned(),
                "feed_item_saved_assignment".to_owned(),
            ]
        );
        assert!(matches!(
            verified.capability.scope,
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide
        ));

        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &authority);
        journal
            .verify_and_enroll_actor(&certificate, &authority.library_id)
            .expect("enroll v2 actor");
        let stored: (i64, String, String, String, String, String) = journal
            .connection
            .query_row(
                "SELECT certificateVersion, actorClass, allowedOperationTypesJson,
                        scopeMode, issuanceIdentity, retirementIdentity
                   FROM library_core_actor_capability_state
                  WHERE actorId = ?1;",
                [&verified.actor_id],
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
            .expect("stored capability");
        assert_eq!(stored.0, 2);
        assert_eq!(stored.1, "agent");
        assert_eq!(
            stored.2,
            "[\"feed_item_read_assignment\",\"feed_item_saved_assignment\"]"
        );
        assert_eq!(stored.3, "library_wide");
        assert_eq!(
            stored.4,
            vector["certificate"]["certificate_body"]["actor_capability_body"]["issuance_identity"]
        );
        assert_eq!(
            stored.5,
            vector["certificate"]["certificate_body"]["actor_capability_body"]
                ["retirement_identity"]
        );
    }

    #[test]
    fn enrollment_and_authority_frontiers_reject_two_tips_for_one_actor() {
        let actor_id = "1".repeat(64);
        let tips = json!([
            {
                "actor_id": actor_id,
                "sequence": 1,
                "operation_id": "op:frontier:one",
                "chain_digest": "2".repeat(64),
            },
            {
                "actor_id": actor_id,
                "sequence": 2,
                "operation_id": "op:frontier:two",
                "chain_digest": "3".repeat(64),
            }
        ]);
        assert!(matches!(
            parse_causal_tips(&tips),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "observed_frontier"
            })
        ));

        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[14_u8; 32]).expect("authority key");
        let mut accepted = authority(&authority_key);
        accepted.observed_frontier = vec![
            NormalizedCausalTipV1 {
                actor_id: actor_id.clone(),
                sequence: 1,
                operation_id: "op:frontier:one".to_owned(),
                chain_digest: "2".repeat(64),
            },
            NormalizedCausalTipV1 {
                actor_id,
                sequence: 2,
                operation_id: "op:frontier:two".to_owned(),
                chain_digest: "3".repeat(64),
            },
        ];
        assert!(matches!(
            validate_authority(&accepted),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "authority.observed_frontier"
            })
        ));
    }

    #[test]
    fn v2_capability_rejects_changed_scope_operations_and_stale_epoch() {
        let vectors = capability_vectors();
        let vector = &vectors["vectors"][0];
        let authority = vector_authority(vector);
        let mut changed = vector["certificate"].clone();
        changed["certificate_body"]["actor_capability_body"]["allowed_operation_types"] =
            json!(["feed_item_remove"]);
        let changed = encode_canonical_value(&changed, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("changed capability certificate");
        assert!(matches!(
            verify_actor_enrollment(&changed, &authority),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "actor_capability_body_digest"
            })
        ));

        let mut missing_scope = vector["certificate"].clone();
        missing_scope["certificate_body"]["actor_capability_body"]
            .as_object_mut()
            .expect("capability body")
            .remove("scope");
        let missing_scope = encode_canonical_value(&missing_scope, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("missing scope certificate");
        assert!(matches!(
            verify_actor_enrollment(&missing_scope, &authority),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "actor_capability_body"
            })
        ));

        let mut scraper_escape = vector["certificate"].clone();
        scraper_escape["certificate_body"]["actor_capability_body"]["actor_class"] =
            json!("scraper");
        let scraper_escape =
            encode_canonical_value(&scraper_escape, MAX_TRANSACTION_ENVELOPE_BYTES)
                .expect("scraper escape certificate");
        assert!(matches!(
            verify_actor_enrollment(&scraper_escape, &authority),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "allowed_operation_types"
            })
        ));

        let certificate =
            encode_canonical_value(&vector["certificate"], MAX_TRANSACTION_ENVELOPE_BYTES)
                .expect("canonical certificate");
        let mut stale = authority.clone();
        stale.epoch += 1;
        assert!(matches!(
            verify_actor_enrollment(&certificate, &stale),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "authority_binding"
            })
        ));
    }

    #[test]
    fn rejects_tampering_before_actor_or_outbox_persistence() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[12_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[13_u8; 32]).expect("authority key");
        let authority = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &authority);
        let mut value = decode_canonical_value(&certificate, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("decode certificate")
            .into_value();
        let proof = value["certificate_body"]["actor_proof"]
            .as_str()
            .expect("actor proof");
        let replacement = if proof.ends_with('0') { '1' } else { '0' };
        value["certificate_body"]["actor_proof"] =
            Value::String(format!("{}{replacement}", &proof[..proof.len() - 1]));
        let tampered =
            encode_canonical_value(&value, MAX_TRANSACTION_ENVELOPE_BYTES).expect("tamper");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &authority);

        assert!(matches!(
            journal.verify_and_enroll_actor(&tampered, &authority.library_id),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "actor_proof"
            })
        ));
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("actor rows");
        assert_eq!(rows, (0, 0));

        let mut value = decode_canonical_value(&certificate, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("decode certificate")
            .into_value();
        let signature = value["authority_signature"]
            .as_str()
            .expect("authority signature");
        let replacement = if signature.ends_with('0') { '1' } else { '0' };
        value["authority_signature"] = Value::String(format!(
            "{}{replacement}",
            &signature[..signature.len() - 1]
        ));
        let tampered =
            encode_canonical_value(&value, MAX_TRANSACTION_ENVELOPE_BYTES).expect("tamper");

        assert!(matches!(
            journal.verify_and_enroll_actor(&tampered, &authority.library_id),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "authority_signature"
            })
        ));
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("actor rows");
        assert_eq!(rows, (0, 0));
    }

    #[test]
    fn authority_epoch_change_fences_a_previously_verified_enrollment() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[16_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[17_u8; 32]).expect("authority key");
        let accepted = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &accepted);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &accepted);
        let verified = journal
            .verify_actor_enrollment(&certificate, &accepted)
            .expect("verify enrollment");
        let mut next = accepted.clone();
        next.epoch = 2;
        next.epoch_id = "9".repeat(64);
        journal
            .install_authority_epoch(&VerifiedAuthorityEpoch {
                authority: next,
                transition_certificate_digest: "7".repeat(64),
                canonical_transition_certificate_json: "{\"transition\":\"next-epoch-fixture\"}"
                    .to_owned(),
                accepted_at_ms: 1_100,
            })
            .expect("advance authority epoch");

        assert!(matches!(
            journal.enroll_actor_under_authority(&verified, &accepted, false),
            Err(LibraryCoreError::StaleAuthority { .. })
        ));
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (0, 0));
    }

    #[test]
    fn committed_enrollment_retry_survives_authority_epoch_advance() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[18_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[19_u8; 32]).expect("authority key");
        let accepted = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &accepted);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_authority(&mut journal, &accepted);
        let verified = journal
            .verify_actor_enrollment(&certificate, &accepted)
            .expect("verify enrollment");
        let first = journal
            .enroll_actor_under_authority(&verified, &accepted, false)
            .expect("enroll actor");

        let mut next = accepted.clone();
        next.epoch = 2;
        next.epoch_id = "9".repeat(64);
        journal
            .install_authority_epoch(&VerifiedAuthorityEpoch {
                authority: next,
                transition_certificate_digest: "7".repeat(64),
                canonical_transition_certificate_json: "{\"transition\":\"next-epoch-fixture\"}"
                    .to_owned(),
                accepted_at_ms: 1_100,
            })
            .expect("advance authority epoch");

        let retry = journal
            .enroll_actor_under_authority(&verified, &accepted, false)
            .expect("retry committed enrollment");
        assert_eq!(retry, first);
        let rows: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_actors),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (1, 1));
    }

    #[test]
    fn rejects_wrong_authority_and_duplicate_fields_before_signatures() {
        let actor_key = Ed25519KeyPair::from_seed_unchecked(&[14_u8; 32]).expect("actor key");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[15_u8; 32]).expect("authority key");
        let authority = authority(&authority_key);
        let certificate = certificate(&actor_key, &authority_key, &authority);
        let mut wrong = authority.clone();
        wrong.epoch_id = "9".repeat(64);
        assert!(matches!(
            verify_actor_enrollment(&certificate, &wrong),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "authority_binding"
            })
        ));
        assert!(matches!(
            verify_actor_enrollment(
                br#"{"certificate_body":{},"certificate_body":{}}"#,
                &authority
            ),
            Err(LibraryCoreError::EnrollmentVerification {
                field: "canonical_certificate"
            })
        ));
    }
}
