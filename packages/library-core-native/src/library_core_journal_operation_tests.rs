#[cfg(test)]
pub(crate) mod tests {
    use crate::library_core_canonical::{
        decode_canonical_value, encode_canonical_value, encode_operation_signature_input,
    };
    use crate::library_core_error::LibraryCoreError;
    use crate::library_core_journal::LibraryCoreJournal;
    use crate::normalized_operation::VerifiedActorEnrollment;
    use crate::normalized_operation_verifier::{digest_hex, parse_causal_tips, validate_rss_feed};
    use crate::normalized_protocol_limits::{
        MAX_TRANSACTION_ENVELOPE_BYTES, MAX_TRANSACTION_MEMBERS,
    };
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use serde_json::{json, Value};

    fn hex(bytes: &[u8]) -> String {
        let mut encoded = String::with_capacity(bytes.len() * 2);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in bytes {
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
        encoded
    }

    pub(crate) fn signed_envelopes(
        key_pair: &Ed25519KeyPair,
        enrollment: &VerifiedActorEnrollment,
    ) -> Vec<Vec<u8>> {
        let entities = [("rss:item:1", 900_i64), ("rss:item:2", 901_i64)];
        signed_envelopes_from_tip(
            key_pair,
            enrollment,
            "tx:read:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &entities,
            "feed_item_read_assignment",
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn signed_envelopes_from_tip(
        key_pair: &Ed25519KeyPair,
        enrollment: &VerifiedActorEnrollment,
        transaction_id: &str,
        first_sequence: i64,
        previous_operation_id: Option<&str>,
        previous_chain_digest: &str,
        entities: &[(&str, i64)],
        operation_type: &str,
    ) -> Vec<Vec<u8>> {
        signed_envelopes_from_tip_with_payload(
            key_pair,
            enrollment,
            transaction_id,
            first_sequence,
            previous_operation_id,
            previous_chain_digest,
            entities,
            operation_type,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn signed_envelopes_from_tip_with_payload(
        key_pair: &Ed25519KeyPair,
        enrollment: &VerifiedActorEnrollment,
        transaction_id: &str,
        first_sequence: i64,
        previous_operation_id: Option<&str>,
        previous_chain_digest: &str,
        entities: &[(&str, i64)],
        operation_type: &str,
        payload_override: Option<&Value>,
    ) -> Vec<Vec<u8>> {
        let mut member_bodies = Vec::new();
        let mut member_digests = Vec::new();
        for (index, (entity_id, timestamp_ms)) in entities.iter().enumerate() {
            let payload = payload_override
                .cloned()
                .unwrap_or_else(|| match operation_type {
                    "feed_item_capture_upsert" => json!({
                        "item": {
                            "author": {
                                "displayName": "Verified Author",
                                "handle": "verified",
                                "id": "author:verified"
                            },
                            "capturedAt": timestamp_ms,
                            "content": {
                                "mediaTypes": [],
                                "mediaUrls": [],
                                "text": "Verified bounded capture"
                            },
                            "contentType": "article",
                            "globalId": entity_id,
                            "location": {
                                "coordinates": {
                                    "lat": {
                                        "bits": "4042e32fec56d5d0",
                                        "codec": "ieee754_binary64_hex_v1"
                                    },
                                    "lng": {
                                        "bits": "c05e9ad77318fc50",
                                        "codec": "ieee754_binary64_hex_v1"
                                    }
                                },
                                "name": "San Francisco",
                                "source": "explicit"
                            },
                            "platform": "saved",
                            "publishedAt": timestamp_ms,
                            "topics": [],
                            "userState": {
                                "archived": false,
                                "hidden": false,
                                "saved": true,
                                "tags": []
                            }
                        }
                    }),
                    "feed_item_read_assignment" => json!({ "read_at_ms": timestamp_ms }),
                    "feed_item_saved_assignment"
                    | "feed_item_archive_assignment"
                    | "feed_item_like_assignment" => {
                        json!({ "assigned": true, "assigned_at_ms": timestamp_ms })
                    }
                    "feed_item_like_sync_receipt" | "feed_item_seen_sync_receipt" => {
                        json!({ "synced_at_ms": timestamp_ms })
                    }
                    "feed_item_remove" => json!({ "removed_at_ms": timestamp_ms }),
                    "rss_feed_upsert" => json!({
                        "feed": {
                            "url": entity_id,
                            "title": "Verified feed",
                            "enabled": true,
                            "trackUnread": true
                        }
                    }),
                    "rss_feed_remove_keep_items" | "rss_feed_remove_with_items" => {
                        json!({ "removed_at_ms": timestamp_ms })
                    }
                    "rss_feed_title_assignment" => json!({
                        "assigned_at_ms": timestamp_ms,
                        "title": "Renamed feed"
                    }),
                    "preferences_leaf_assignment" => json!({
                        "updates": {
                            "display": { "archivePruneDays": 14 },
                            "ai": { "autoSummarize": true }
                        }
                    }),
                    "person_upsert" => json!({
                        "person": {
                            "id": entity_id,
                            "name": "Verified Person",
                            "relationshipStatus": "friend",
                            "careLevel": 3,
                            "reachOutIntervalDays": 30,
                            "notes": "Keep in touch",
                            "tags": ["local", "friend"],
                            "sampleDataFingerprint": {
                                "marker": "freed.sample-data.v1",
                                "batchId": "batch:verified",
                                "generatedAt": timestamp_ms,
                                "generatorVersion": 1
                            },
                            "createdAt": timestamp_ms,
                            "updatedAt": timestamp_ms
                        }
                    }),
                    "friend_replace" => json!({
                        "accounts": [],
                        "person": {
                            "id": entity_id,
                            "name": "Verified Friend",
                            "relationshipStatus": "friend",
                            "careLevel": 3,
                            "createdAt": timestamp_ms,
                            "updatedAt": timestamp_ms
                        }
                    }),
                    "person_reach_out_append" => json!({
                        "channel": "text",
                        "logged_at_ms": timestamp_ms,
                        "notes": "Hello"
                    }),
                    "person_remove_and_accounts" | "person_remove_detach_accounts" => {
                        json!({ "removed_at_ms": timestamp_ms })
                    }
                    "account_upsert" => json!({
                        "account": {
                            "id": entity_id,
                            "personId": "person:verified",
                            "kind": "social",
                            "provider": "instagram",
                            "externalId": "verified",
                            "handle": "verified_account",
                            "displayName": "Verified Account",
                            "discoveredFrom": "manual_entry",
                            "firstSeenAt": timestamp_ms,
                            "lastSeenAt": timestamp_ms,
                            "followRosterActive": true,
                            "followRosterRoles": ["follower", "following"],
                            "sampleDataFingerprint": {
                                "marker": "freed.sample-data.v1",
                                "batchId": "batch:verified",
                                "generatedAt": timestamp_ms,
                                "generatorVersion": 1
                            },
                            "createdAt": timestamp_ms,
                            "updatedAt": timestamp_ms
                        }
                    }),
                    "account_person_assignment" => json!({
                        "assigned_at_ms": timestamp_ms,
                        "person_id": "person:verified"
                    }),
                    "account_remove" => json!({ "removed_at_ms": timestamp_ms }),
                    _ => panic!("unsupported fixture operation type"),
                });
            let entity_type = if operation_type.starts_with("rss_feed_") {
                "RssFeed"
            } else if operation_type == "preferences_leaf_assignment" {
                "UserPreferences"
            } else if operation_type == "person_reach_out_append"
                || operation_type == "friend_replace"
                || operation_type == "person_upsert"
                || operation_type == "person_remove_and_accounts"
                || operation_type == "person_remove_detach_accounts"
            {
                "Person"
            } else if matches!(
                operation_type,
                "account_person_assignment" | "account_upsert" | "account_remove"
            ) {
                "Account"
            } else {
                "FeedItem"
            };
            let payload_digest = digest_hex(
                "operation-payload",
                &json!({
                    "schema_version": 1,
                    "operation_type": operation_type,
                    "payload": payload,
                }),
                index,
            )
            .expect("payload digest");
            let body = json!({
                "operation_id": format!("{transaction_id}:member:{index}"),
                "library_id": enrollment.library_id,
                "epoch": enrollment.epoch,
                "epoch_id": enrollment.epoch_id,
                "schema_version": 1,
                "actor_id": enrollment.actor_id,
                "actor_sequence": first_sequence + index as i64,
                "previous_actor_operation_id": if index == 0 {
                    previous_operation_id
                        .map(|value| Value::String(value.to_owned()))
                        .unwrap_or(Value::Null)
                } else {
                    Value::String(format!("{transaction_id}:member:{}", index - 1))
                },
                "causal_frontier": [],
                "hlc_wall_ms": 1_000 + index as i64,
                "hlc_counter": 0,
                "transaction_id": transaction_id,
                "transaction_member_index": index as i64,
                "transaction_member_count": entities.len() as i64,
                "operation_type": operation_type,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "payload": payload,
                "payload_digest": payload_digest,
                "blob_references": [],
                "created_at_ms": 1_000 + index as i64,
                "signature_algorithm": "ed25519",
            });
            member_digests
                .push(digest_hex("transaction-member", &body, index).expect("member digest"));
            member_bodies.push(body);
        }
        let transaction_digest = digest_hex(
            "transaction",
            &json!({
                "transaction_id": transaction_id,
                "transaction_member_count": entities.len() as i64,
                "actor_id": enrollment.actor_id,
                "initial_previous_actor_operation_id": previous_operation_id
                    .map(|value| Value::String(value.to_owned()))
                    .unwrap_or(Value::Null),
                "initial_previous_actor_chain_digest": previous_chain_digest,
                "transaction_member_digests": member_digests,
            }),
            0,
        )
        .expect("transaction digest");

        let mut previous_chain = previous_chain_digest.to_owned();
        member_bodies
            .into_iter()
            .enumerate()
            .map(|(index, body)| {
                let actor_chain_digest = digest_hex(
                    "actor-chain",
                    &json!({
                        "previous_actor_chain_digest": previous_chain,
                        "transaction_member_digest": member_digests[index],
                        "transaction_digest": transaction_digest,
                    }),
                    index,
                )
                .expect("actor chain digest");
                let mut signing_body = body.as_object().expect("body object").clone();
                signing_body.insert(
                    "previous_actor_chain_digest".to_owned(),
                    Value::String(previous_chain.clone()),
                );
                signing_body.insert(
                    "actor_chain_digest".to_owned(),
                    Value::String(actor_chain_digest.clone()),
                );
                signing_body.insert(
                    "transaction_digest".to_owned(),
                    Value::String(transaction_digest.clone()),
                );
                let signing_body = Value::Object(signing_body);
                let signing_body_digest =
                    digest_hex("operation-signing-body", &signing_body, index)
                        .expect("signing body digest");
                let message = encode_operation_signature_input(
                    &json!({ "operation_signing_body_digest": signing_body_digest }),
                    MAX_TRANSACTION_ENVELOPE_BYTES,
                )
                .expect("signature input");
                let signature = hex(key_pair.sign(&message).as_ref());
                let mut envelope = signing_body.as_object().expect("signing body").clone();
                envelope.insert("signature".to_owned(), Value::String(signature));
                previous_chain = actor_chain_digest;
                encode_canonical_value(&Value::Object(envelope), MAX_TRANSACTION_ENVELOPE_BYTES)
                    .expect("canonical envelope")
            })
            .collect()
    }

    pub(crate) fn enrollment(key_pair: &Ed25519KeyPair) -> VerifiedActorEnrollment {
        VerifiedActorEnrollment {
            library_id: "1".repeat(64),
            epoch: 1,
            epoch_id: "2".repeat(64),
            actor_id: "3".repeat(64),
            actor_public_key: hex(key_pair.public_key().as_ref()),
            enrollment_operation_id: "op:actor:enroll:native-verifier".to_owned(),
            enrollment_certificate_digest: "4".repeat(64),
            canonical_enrollment_certificate_json: "{\"certificate\":\"fixture\"}".to_owned(),
            actor_chain_genesis: "5".repeat(64),
            enrolled_at_ms: 1_000,
            capability:
                crate::library_core_actor_capability::ActorCapabilityState::historical_editor(
                    "4".repeat(64),
                    1_000,
                ),
        }
    }

    fn signed_v2_enrollment(
        actor_key: &Ed25519KeyPair,
        actor_class: &str,
        allowed_operation_types: &[&str],
        scope: crate::library_core_actor_capability::ActorCapabilityScope,
    ) -> (
        crate::normalized_authority::NormalizedAuthorityStateV2,
        Vec<u8>,
        VerifiedActorEnrollment,
    ) {
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[30_u8; 32]).expect("authority key");
        let authority_public_key = hex(authority_key.public_key().as_ref());
        let authority_key_id = digest_hex(
            "authority-key",
            &json!({
                "signature_algorithm": "ed25519",
                "authority_public_key": authority_public_key,
            }),
            0,
        )
        .expect("authority key ID");
        let authority = crate::normalized_authority::NormalizedAuthorityStateV2 {
            library_id: "1".repeat(64),
            epoch: 1,
            epoch_id: "2".repeat(64),
            authority_key_id: authority_key_id.clone(),
            authority_public_key,
            observed_frontier: Vec::new(),
        };
        let actor_public_key = hex(actor_key.public_key().as_ref());
        let actor_public_key_fingerprint = digest_hex(
            "actor-public-key",
            &json!({
                "signature_algorithm": "ed25519",
                "actor_public_key": actor_public_key,
            }),
            0,
        )
        .expect("actor public key fingerprint");
        let installation_incarnation = "3".repeat(64);
        let actor_incarnation_nonce = "4".repeat(64);
        let actor_id = digest_hex(
            "actor-id",
            &json!({
                "library_id": authority.library_id,
                "installation_incarnation": installation_incarnation,
                "signature_algorithm": "ed25519",
                "actor_public_key": actor_public_key,
                "actor_incarnation_nonce": actor_incarnation_nonce,
            }),
            0,
        )
        .expect("actor ID");
        let enrollment_body = json!({
            "operation_id": "actor-enrolled:capability-operation-test",
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
        let enrollment_body_digest = digest_hex("actor-enrollment-body", &enrollment_body, 0)
            .expect("enrollment body digest");
        let actor_proof_input = crate::library_core_canonical::encode_signature_input(
            "actor-enrollment-proof",
            &json!({ "enrollment_body_digest": enrollment_body_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("actor proof input");
        let actor_proof = hex(actor_key.sign(&actor_proof_input).as_ref());
        let issuance_identity = digest_hex(
            "actor-capability-issuance",
            &json!({
                "library_id": authority.library_id,
                "epoch_id": authority.epoch_id,
                "authority_key_id": authority.authority_key_id,
                "actor_id": actor_id,
                "enrollment_body_digest": enrollment_body_digest,
            }),
            0,
        )
        .expect("issuance identity");
        let retirement_identity = digest_hex(
            "actor-capability-retirement",
            &json!({
                "library_id": authority.library_id,
                "epoch_id": authority.epoch_id,
                "actor_id": actor_id,
                "issuance_identity": issuance_identity,
            }),
            0,
        )
        .expect("retirement identity");
        let scope = match scope {
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide => {
                json!({ "mode": "library_wide" })
            }
            crate::library_core_actor_capability::ActorCapabilityScope::Bounded {
                kind,
                scope_id,
            } => {
                json!({ "mode": "bounded", "scope_kind": kind, "scope_id": scope_id })
            }
            crate::library_core_actor_capability::ActorCapabilityScope::HistoricalEditor => {
                panic!("v2 test capability cannot use legacy scope")
            }
        };
        let capability_body = json!({
            "format": "freed_library_core_actor_capability_v2",
            "library_id": authority.library_id,
            "epoch": authority.epoch,
            "epoch_id": authority.epoch_id,
            "authority_key_id": authority.authority_key_id,
            "actor_id": actor_id,
            "actor_public_key": actor_public_key,
            "actor_class": actor_class,
            "allowed_operation_types": allowed_operation_types,
            "scope": scope,
            "issuance_identity": issuance_identity,
            "retirement_identity": retirement_identity,
            "issued_at_ms": 1_000,
            "signature_algorithm": "ed25519",
        });
        let capability_body_digest = digest_hex("actor-capability-body", &capability_body, 0)
            .expect("capability body digest");
        let certificate_body = json!({
            "actor_enrollment_body": enrollment_body,
            "enrollment_body_digest": enrollment_body_digest,
            "actor_proof": actor_proof,
            "actor_capability_body": capability_body,
            "actor_capability_body_digest": capability_body_digest,
        });
        let certificate_digest = digest_hex("actor-capability-certificate", &certificate_body, 0)
            .expect("certificate digest");
        let authority_signature_input = crate::library_core_canonical::encode_signature_input(
            "actor-capability-authority",
            &json!({ "certificate_digest": certificate_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("authority signature input");
        let certificate = encode_canonical_value(
            &json!({
                "certificate_body": certificate_body,
                "certificate_digest": certificate_digest,
                "authority_signature": hex(authority_key.sign(&authority_signature_input).as_ref()),
            }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("canonical v2 certificate");
        let enrollment = crate::library_core_journal::enrollment_verifier::verify_actor_enrollment(
            &certificate,
            &authority,
        )
        .expect("verify signed v2 enrollment fixture");
        (authority, certificate, enrollment)
    }

    fn signed_v1_enrollment(
        actor_key: &Ed25519KeyPair,
    ) -> (
        crate::normalized_authority::NormalizedAuthorityStateV2,
        Vec<u8>,
        VerifiedActorEnrollment,
    ) {
        let (authority, v2_certificate, _) = signed_v2_enrollment(
            actor_key,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let v2_value = decode_canonical_value(&v2_certificate, MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("decode v2 source certificate")
            .into_value();
        let v2_body = v2_value["certificate_body"]
            .as_object()
            .expect("v2 certificate body");
        let certificate_body = json!({
            "actor_enrollment_body": v2_body["actor_enrollment_body"].clone(),
            "enrollment_body_digest": v2_body["enrollment_body_digest"].clone(),
            "actor_proof": v2_body["actor_proof"].clone(),
        });
        let certificate_digest = digest_hex("actor-enrollment-certificate", &certificate_body, 0)
            .expect("v1 certificate digest");
        let authority_signature_input = crate::library_core_canonical::encode_signature_input(
            "actor-enrollment-authority",
            &json!({ "certificate_digest": certificate_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("v1 authority signature input");
        let authority_key =
            Ed25519KeyPair::from_seed_unchecked(&[30_u8; 32]).expect("authority key");
        let certificate = encode_canonical_value(
            &json!({
                "certificate_body": certificate_body,
                "certificate_digest": certificate_digest,
                "authority_signature": hex(authority_key.sign(&authority_signature_input).as_ref()),
            }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .expect("canonical v1 certificate");
        let enrollment = crate::library_core_journal::enrollment_verifier::verify_actor_enrollment(
            &certificate,
            &authority,
        )
        .expect("verify signed v1 enrollment fixture");
        (authority, certificate, enrollment)
    }

    fn install_signed_v2_actor(
        journal: &mut LibraryCoreJournal,
        actor_key: &Ed25519KeyPair,
        actor_class: &str,
        allowed_operation_types: &[&str],
        scope: crate::library_core_actor_capability::ActorCapabilityScope,
    ) -> VerifiedActorEnrollment {
        let (authority, certificate, enrollment) =
            signed_v2_enrollment(actor_key, actor_class, allowed_operation_types, scope);
        journal
            .install_authority_epoch(&crate::library_core_journal::VerifiedAuthorityEpoch {
                authority: authority.clone(),
                transition_certificate_digest: "c".repeat(64),
                canonical_transition_certificate_json: "{\"transition\":\"signed-v2-test\"}"
                    .to_owned(),
                accepted_at_ms: 900,
            })
            .expect("install signed v2 authority");
        journal
            .connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?1, ?2, 'signed-v2-test', 900);",
                rusqlite::params!["8".repeat(64), authority.epoch_id],
            )
            .expect("install signed v2 writer admission");
        journal
            .verify_and_enroll_actor(&certificate, &authority.library_id)
            .expect("install signed v2 actor");
        enrollment
    }

    fn install_signed_v1_actor(
        journal: &mut LibraryCoreJournal,
        actor_key: &Ed25519KeyPair,
    ) -> VerifiedActorEnrollment {
        let (authority, certificate, enrollment) = signed_v1_enrollment(actor_key);
        journal
            .install_authority_epoch(&crate::library_core_journal::VerifiedAuthorityEpoch {
                authority: authority.clone(),
                transition_certificate_digest: "c".repeat(64),
                canonical_transition_certificate_json: "{\"transition\":\"signed-v1-test\"}"
                    .to_owned(),
                accepted_at_ms: 900,
            })
            .expect("install signed v1 authority");
        journal
            .connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?1, ?2, 'signed-v1-test', 900);",
                rusqlite::params!["8".repeat(64), authority.epoch_id],
            )
            .expect("install signed v1 writer admission");
        journal
            .verify_and_enroll_actor(&certificate, &authority.library_id)
            .expect("install signed v1 actor");
        enrollment
    }

    fn authoritative_operation_state(
        journal: &LibraryCoreJournal,
        actor_id: &str,
    ) -> (i64, i64, i64, i64, i64, i64, i64) {
        journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox),
                   (SELECT COUNT(*) FROM library_core_feed_item_read_state),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("read authoritative operation state")
    }

    fn entity_for_operation(operation_type: &str) -> &'static str {
        match operation_type {
            "rss_feed_upsert" | "rss_feed_remove_keep_items" | "rss_feed_remove_with_items" => {
                "https://example.com/feed.xml"
            }
            "preferences_leaf_assignment" => "preferences",
            "friend_replace" | "person_upsert" | "person_remove_and_accounts" => "person:verified",
            "account_upsert" | "account_remove" => "account:verified",
            _ => "rss:item:capability",
        }
    }

    #[test]
    fn rejects_device_local_or_incomplete_rss_feed_payloads() {
        let entity_id = "https://example.com/feed.xml";
        let valid = json!({
            "url": entity_id,
            "title": "Example",
            "enabled": true,
            "trackUnread": true
        });
        assert!(validate_rss_feed(valid.as_object().expect("object"), entity_id, 0).is_ok());

        let device_local = json!({
            "url": entity_id,
            "title": "Example",
            "enabled": true,
            "trackUnread": true,
            "consecutiveFailures": 2
        });
        assert!(matches!(
            validate_rss_feed(device_local.as_object().expect("object"), entity_id, 0),
            Err(LibraryCoreError::OperationVerification { field: "feed", .. })
        ));

        let incomplete = json!({ "url": entity_id, "title": "Example" });
        assert!(matches!(
            validate_rss_feed(incomplete.as_object().expect("object"), entity_id, 0),
            Err(LibraryCoreError::OperationVerification { field: "feed", .. })
        ));
    }

    #[test]
    fn operation_frontier_rejects_two_tips_for_one_actor() {
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
            parse_causal_tips(&tips, 0),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "causal_frontier"
            })
        ));
    }

    #[test]
    fn genuine_signed_v1_enrollment_is_reverified_before_commit_and_replay() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[19_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v1_actor(&mut journal, &key_pair);
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:legacy-editor:genuine-certificate",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:genuine-v1", 1_234)],
            "feed_item_read_assignment",
        );

        let receipt = journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("commit genuine signed v1 operation");
        let replay = journal
            .verify_and_commit_read_transaction(&envelopes, 9_999)
            .expect("replay genuine signed v1 operation");
        assert_eq!(replay, receipt);
        assert_eq!(
            journal
                .read_state("rss:item:genuine-v1")
                .expect("read state")
                .expect("materialized read")
                .read_at_ms,
            1_234
        );
    }

    #[test]
    fn retired_actor_exact_replay_fails_without_writes_or_results() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[18_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v2_actor(
            &mut journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:agent:replay-after-retirement",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:replay-after-retirement", 1_234)],
            "feed_item_read_assignment",
        );
        let results = journal
            .accept_operation_transaction(&envelopes, 1_500)
            .expect("commit before retirement");
        assert_eq!(results.len(), 1);
        journal
            .connection
            .execute(
                "UPDATE library_core_actor_capability_state
                    SET retired = 1, retirementCertificateDigest = ?1
                  WHERE actorId = ?2;",
                rusqlite::params!["8".repeat(64), enrollment.actor_id],
            )
            .expect("install retired state fixture");
        let state_before = authoritative_operation_state(&journal, &enrollment.actor_id);
        assert!(matches!(
            journal.accept_operation_transaction(&envelopes, 9_000),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "actor_capability_retired"
            })
        ));
        assert_eq!(
            authoritative_operation_state(&journal, &enrollment.actor_id),
            state_before
        );
    }

    #[test]
    fn stale_epoch_exact_replay_fails_without_writes_or_results() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[19_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v2_actor(
            &mut journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:agent:replay-after-epoch-advance",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:replay-after-epoch-advance", 1_234)],
            "feed_item_read_assignment",
        );
        let results = journal
            .accept_operation_transaction(&envelopes, 1_500)
            .expect("commit before authority epoch advance");
        assert_eq!(results.len(), 1);
        journal
            .install_fixture_authority(&enrollment.library_id, 2, &"9".repeat(64))
            .expect("advance authority epoch");
        let state_before = authoritative_operation_state(&journal, &enrollment.actor_id);
        assert!(matches!(
            journal.accept_operation_transaction(&envelopes, 9_999),
            Err(LibraryCoreError::StaleAuthority { .. })
        ));
        assert_eq!(
            authoritative_operation_state(&journal, &enrollment.actor_id),
            state_before
        );
    }

    #[test]
    fn lost_writer_admission_exact_replay_fails_without_writes_or_results() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[20_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v2_actor(
            &mut journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:agent:replay-after-writer-loss",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:replay-after-writer-loss", 1_234)],
            "feed_item_read_assignment",
        );
        let results = journal
            .accept_operation_transaction(&envelopes, 1_500)
            .expect("commit before writer admission loss");
        assert_eq!(results.len(), 1);
        journal
            .connection
            .execute(
                "UPDATE library_core_cloud_writer_admission
                    SET activeWriterId = ?1
                  WHERE singletonId = 1;",
                ["7".repeat(64)],
            )
            .expect("remove local writer admission");
        let state_before = authoritative_operation_state(&journal, &enrollment.actor_id);
        assert!(matches!(
            journal.accept_operation_transaction(&envelopes, 9_999),
            Err(LibraryCoreError::StaleAuthority { .. })
        ));
        assert_eq!(
            authoritative_operation_state(&journal, &enrollment.actor_id),
            state_before
        );
    }

    #[test]
    fn reused_transaction_id_cannot_bypass_capability_admission() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[17_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v2_actor(
            &mut journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let transaction_id = "tx:agent:reused-id";
        let allowed = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            transaction_id,
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:reused-id", 1_234)],
            "feed_item_read_assignment",
        );
        let receipt = journal
            .verify_and_commit_read_transaction(&allowed, 1_500)
            .expect("commit allowed transaction");
        let state_before: (i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [&enrollment.actor_id],
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
            .expect("state before conflicting replay");
        let denied = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            transaction_id,
            2,
            Some(&receipt.committed_operation_id),
            &receipt.committed_chain_digest,
            &[("rss:item:reused-id", 2_345)],
            "feed_item_remove",
        );

        assert!(matches!(
            journal.verify_and_commit_read_transaction(&denied, 2_500),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "actor_capability_operation"
            })
        ));
        let state_after: (i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [&enrollment.actor_id],
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
            .expect("state after conflicting replay");
        assert_eq!(state_after, state_before);
    }

    #[test]
    fn v2_scraper_capability_allows_capture_and_denies_every_other_operation() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[20_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v2_actor(
            &mut journal,
            &key_pair,
            "scraper",
            &["feed_item_capture_upsert"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let capture = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:scraper:capture",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:scraper-capture", 1_234)],
            "feed_item_capture_upsert",
        );
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 0, 0, '{{}}', 1, 1);"#,
                "b".repeat(64)
            ))
            .expect("install desktop state");
        let receipt = journal
            .verify_and_commit_read_transaction(&capture, 1_500)
            .expect("commit allowed scraper capture");
        let replay = journal
            .verify_and_commit_read_transaction(&capture, 9_999)
            .expect("replay exact allowed scraper capture");
        assert_eq!(replay, receipt);

        for operation_type in crate::library_core_actor_capability::canonical_operation_types()
            .iter()
            .filter(|operation| **operation != "feed_item_capture_upsert")
        {
            let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
            let enrollment = install_signed_v2_actor(
                &mut journal,
                &key_pair,
                "scraper",
                &["feed_item_capture_upsert"],
                crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
            );
            let transaction_id = format!("tx:scraper:deny:{operation_type}");
            let denied = signed_envelopes_from_tip(
                &key_pair,
                &enrollment,
                &transaction_id,
                1,
                None,
                &enrollment.actor_chain_genesis,
                &[(entity_for_operation(operation_type), 1_234)],
                operation_type,
            );
            assert!(matches!(
                journal.verify_and_commit_read_transaction(&denied, 1_500),
                Err(LibraryCoreError::OperationVerification {
                    index: 0,
                    field: "actor_capability_operation"
                })
            ));
            let rows: i64 = journal
                .connection
                .query_row("SELECT COUNT(*) FROM library_core_operations;", [], |row| {
                    row.get(0)
                })
                .expect("count denied operations");
            assert_eq!(rows, 0, "{operation_type}");
        }
    }

    #[test]
    fn v2_bounded_retired_stale_and_oversized_inputs_fail_before_ingestion() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[21_u8; 32]).expect("key pair");
        let mut bounded_journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let bounded = install_signed_v2_actor(
            &mut bounded_journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::Bounded {
                kind: "provider".to_owned(),
                scope_id: "instagram".to_owned(),
            },
        );
        let bounded_envelope = signed_envelopes_from_tip(
            &key_pair,
            &bounded,
            "tx:agent:bounded",
            1,
            None,
            &bounded.actor_chain_genesis,
            &[("rss:item:bounded", 1_234)],
            "feed_item_read_assignment",
        );
        assert!(matches!(
            bounded_journal.verify_and_commit_read_transaction(&bounded_envelope, 1_500),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "actor_capability_scope"
            })
        ));

        let mut retired_journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let active = install_signed_v2_actor(
            &mut retired_journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let active_envelope = signed_envelopes_from_tip(
            &key_pair,
            &active,
            "tx:agent:retired",
            1,
            None,
            &active.actor_chain_genesis,
            &[("rss:item:retired", 1_234)],
            "feed_item_read_assignment",
        );
        retired_journal
            .connection
            .execute(
                "UPDATE library_core_actor_capability_state
                    SET retired = 1, retirementCertificateDigest = ?1
                  WHERE actorId = ?2;",
                rusqlite::params!["8".repeat(64), &active.actor_id],
            )
            .expect("install retired state fixture");
        assert!(matches!(
            retired_journal.verify_and_commit_read_transaction(&active_envelope, 1_500),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "actor_capability_retired"
            })
        ));

        let stale_envelope = signed_envelopes_from_tip(
            &key_pair,
            &active,
            "tx:agent:stale-epoch",
            1,
            None,
            &active.actor_chain_genesis,
            &[("rss:item:stale-capability", 1_234)],
            "feed_item_read_assignment",
        );
        let mut stale_journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_signed_v2_actor(
            &mut stale_journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        stale_journal
            .install_fixture_authority(&active.library_id, 2, &"9".repeat(64))
            .expect("advance authority epoch");
        assert!(matches!(
            stale_journal.verify_and_commit_read_transaction(&stale_envelope, 1_500),
            Err(LibraryCoreError::StaleAuthority { .. })
        ));

        let oversized = vec![Vec::new(); MAX_TRANSACTION_MEMBERS + 1];
        assert!(matches!(
            stale_journal.verify_operation_transaction(&oversized),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "transaction_members"
            })
        ));

        for journal in [&bounded_journal, &retired_journal, &stale_journal] {
            let rows: i64 = journal
                .connection
                .query_row("SELECT COUNT(*) FROM library_core_operations;", [], |row| {
                    row.get(0)
                })
                .expect("count rejected operations");
            assert_eq!(rows, 0);
        }
    }

    #[test]
    fn signed_v2_capability_refuses_an_sql_widened_cache_without_any_write() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[22_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v2_actor(
            &mut journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let removal = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:agent:unsigned-cache-widening",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:unsigned-cache-widening", 1_234)],
            "feed_item_remove",
        );
        journal
            .connection
            .execute(
                "UPDATE library_core_actor_capability_state
                    SET allowedOperationTypesJson = '[\"feed_item_remove\"]'
                  WHERE actorId = ?1;",
                [&enrollment.actor_id],
            )
            .expect("widen unsigned capability cache");

        assert!(matches!(
            journal.verify_and_commit_read_transaction(&removal, 1_500),
            Err(LibraryCoreError::InvalidVerifiedInput {
                field: "actor_capability_signed_cache"
            })
        ));
        let state: (i64, i64, i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox),
                   (SELECT COUNT(*) FROM library_core_feed_items),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [&enrollment.actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("unchanged authoritative state");
        assert_eq!(state, (0, 0, 0, 0, 0, 1, 0));
    }

    #[test]
    fn signed_v2_capability_cannot_be_downgraded_to_the_legacy_policy() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[23_u8; 32]).expect("key pair");
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = install_signed_v2_actor(
            &mut journal,
            &key_pair,
            "agent",
            &["feed_item_read_assignment"],
            crate::library_core_actor_capability::ActorCapabilityScope::LibraryWide,
        );
        let removal = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:agent:unsigned-legacy-downgrade",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:unsigned-legacy-downgrade", 1_234)],
            "feed_item_remove",
        );
        journal
            .connection
            .execute(
                "UPDATE library_core_actor_capability_state
                    SET certificateVersion = 1,
                        actorClass = 'legacy_editor',
                        allowedOperationTypesJson =
                          '[\"account_remove\",\"account_upsert\",\"feed_item_archive_assignment\",\"feed_item_capture_upsert\",\"feed_item_like_assignment\",\"feed_item_read_assignment\",\"feed_item_remove\",\"feed_item_saved_assignment\",\"person_remove_and_accounts\",\"person_upsert\",\"preferences_leaf_assignment\",\"rss_feed_remove_keep_items\",\"rss_feed_remove_with_items\",\"rss_feed_upsert\"]',
                        scopeMode = 'legacy_editor', scopeKind = NULL,
                        scopeId = NULL, issuanceIdentity = NULL,
                        retirementIdentity = NULL
                  WHERE actorId = ?1;",
                [&enrollment.actor_id],
            )
            .expect("downgrade unsigned capability cache");

        assert!(matches!(
            journal.verify_and_commit_read_transaction(&removal, 1_500),
            Err(LibraryCoreError::InvalidVerifiedInput {
                field: "actor_capability_signed_cache"
            })
        ));
        let state: (i64, i64, i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox),
                   (SELECT COUNT(*) FROM library_core_feed_items),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [&enrollment.actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("unchanged authoritative state");
        assert_eq!(state, (0, 0, 0, 0, 0, 1, 0));
    }

    #[test]
    fn verifies_signatures_and_only_then_commits_the_sealed_transaction() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[7_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let receipt = journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("verify and commit");
        let retry = journal
            .verify_and_commit_read_transaction(&envelopes, 9_999)
            .expect("verify exact response-loss retry after actor tip advance");
        assert_eq!(retry, receipt);
        assert_eq!(receipt.member_count, 2);
        assert_eq!(
            journal
                .read_state("rss:item:1")
                .expect("read state")
                .expect("materialized read")
                .read_at_ms,
            900
        );

        let rows: (i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("row counts");
        assert_eq!(rows, (1, 2, 2));
    }

    #[test]
    fn verifies_signed_feed_item_remove_before_journal_admission() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[8_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:remove:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:remove", 1_234)],
            "feed_item_remove",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");

        journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("verify and commit removal");
        let committed: (String, String) = journal
            .connection
            .query_row(
                "SELECT operationType, entityId FROM library_core_operations;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read verified operation");
        assert_eq!(
            committed,
            ("feed_item_remove".to_owned(), "rss:item:remove".to_owned())
        );
    }

    #[test]
    fn verifies_and_materializes_signed_feed_item_capture() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:capture:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("saved:item:capture", 1_234)],
            "feed_item_capture_upsert",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");

        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 0, 0, '{{}}', 1, 1);"#,
                "b".repeat(64)
            ))
            .expect("install desktop materialization state");

        let receipt = journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("verify and commit capture");
        let retry = journal
            .verify_and_commit_read_transaction(&envelopes, 9_999)
            .expect("retry capture after response loss");
        assert_eq!(retry, receipt);
        let item_json: String = journal
            .connection
            .query_row(
                "SELECT payloadJson FROM library_core_feed_items WHERE globalId = 'saved:item:capture';",
                [],
                |row| row.get(0),
            )
            .expect("captured item JSON");
        let item: Value = serde_json::from_str(&item_json).expect("parse captured item JSON");
        assert_eq!(item["location"]["coordinates"]["lat"], json!(37.7749));
        assert_eq!(item["location"]["coordinates"]["lng"], json!(-122.4194));
        let rows: (i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_feed_items
                    WHERE globalId = 'saved:item:capture' AND saved = 1),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("capture rows");
        assert_eq!(rows, (1, 1, 1, 1));
    }

    #[test]
    fn verifies_and_materializes_signed_rss_feed_upsert() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[12_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let feed_url = "https://example.com/feed.xml";
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss-upsert:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[(feed_url, 1_234)],
            "rss_feed_upsert",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 0, 0, '{{"feeds":{{}}}}', 1, 1);"#,
                "b".repeat(64)
            ))
            .expect("install desktop state");

        journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("commit RSS upsert");
        let shell: String = journal
            .connection
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| row.get(0),
            )
            .expect("read shell");
        let shell: Value = serde_json::from_str(&shell).expect("parse shell");
        assert_eq!(shell["feeds"][feed_url]["title"], "Verified feed");
    }

    #[test]
    fn signed_rss_feed_removal_can_tombstone_its_items_atomically() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[13_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let feed_url = "https://example.com/feed.xml";
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:rss-remove:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[(feed_url, 1_234)],
            "rss_feed_remove_with_items",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 1, 1,
                   '{{"feeds":{{"{feed_url}":{{"url":"{feed_url}","title":"Example","enabled":true,"trackUnread":true}}}}}}',
                   1, 1);
                 INSERT INTO library_core_feed_items (
                   globalId, feedUrl, deletedAt, payloadJson, updatedAtMs
                 ) VALUES (
                   'rss:item:from-feed', '{feed_url}', NULL,
                   '{{"globalId":"rss:item:from-feed","rssSource":{{"feedUrl":"{feed_url}"}}}}',
                   1
                 );"#,
                "b".repeat(64)
            ))
            .expect("install feed and item");

        journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("commit RSS removal");
        let state: (i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   json_array_length(json_extract(shellJson, '$.feeds')),
                   (SELECT COUNT(*) FROM library_core_feed_items
                    WHERE globalId = 'rss:item:from-feed' AND deletedAt = 1234)
                 FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read removed state");
        assert_eq!(state, (0, 1));
    }

    #[test]
    fn verifies_and_materializes_signed_preferences_patch() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[14_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:preferences:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("preferences", 1_234)],
            "preferences_leaf_assignment",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 0, 0,
                   '{{"preferences":{{"display":{{"archivePruneDays":30,"showEngagementCounts":false}},"ai":{{"autoSummarize":false,"extractTopics":true}}}}}}',
                   1, 1);"#,
                "b".repeat(64)
            ))
            .expect("install desktop state");

        journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("commit preferences patch");
        let shell: String = journal
            .connection
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| row.get(0),
            )
            .expect("read shell");
        let shell: Value = serde_json::from_str(&shell).expect("parse shell");
        assert_eq!(shell["preferences"]["display"]["archivePruneDays"], 14);
        assert_eq!(
            shell["preferences"]["display"]["showEngagementCounts"],
            false
        );
        assert_eq!(shell["preferences"]["ai"]["autoSummarize"], true);
        assert_eq!(shell["preferences"]["ai"]["extractTopics"], true);
    }

    #[test]
    fn verifies_and_materializes_signed_person_upsert() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[15_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let person_id = "person:verified";
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[(person_id, 1_234)],
            "person_upsert",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 0, 0,
                   '{{"persons":{{}}}}', 1, 1);"#,
                "b".repeat(64)
            ))
            .expect("install desktop state");

        journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("commit Person upsert");
        let shell: String = journal
            .connection
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| row.get(0),
            )
            .expect("read shell");
        let shell: Value = serde_json::from_str(&shell).expect("parse shell");
        assert_eq!(shell["persons"][person_id]["name"], "Verified Person");
        assert_eq!(shell["persons"][person_id]["careLevel"], 3);
    }

    #[test]
    fn verifies_and_atomically_removes_person_and_linked_accounts() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[16_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let person_id = "person:verified";
        let envelopes = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:person-remove:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[(person_id, 1_234)],
            "person_remove_and_accounts",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 0, 0,
                   '{{"persons":{{"person:verified":{{"id":"person:verified","name":"Verified Person"}}}},"accounts":{{"account:linked":{{"id":"account:linked","personId":"person:verified"}},"account:other":{{"id":"account:other","personId":"person:other"}}}}}}',
                   1, 1);"#,
                "b".repeat(64)
            ))
            .expect("install desktop state");

        journal
            .verify_and_commit_read_transaction(&envelopes, 1_500)
            .expect("commit Person removal");
        let shell: String = journal
            .connection
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| row.get(0),
            )
            .expect("read shell");
        let shell: Value = serde_json::from_str(&shell).expect("parse shell");
        assert!(shell["persons"].get(person_id).is_none());
        assert!(shell["accounts"].get("account:linked").is_none());
        assert_eq!(
            shell["accounts"]["account:other"]["personId"],
            "person:other"
        );
    }

    #[test]
    fn verifies_and_materializes_signed_account_lifecycle() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[17_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let account_id = "account:verified";
        let upsert = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:account:native-verified",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[(account_id, 1_234)],
            "account_upsert",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 0, 1, 1, '{}', 0, 0,
                   '{{"accounts":{{}}}}', 1, 1);"#,
                "b".repeat(64)
            ))
            .expect("install desktop state");

        journal
            .verify_and_commit_read_transaction(&upsert, 1_500)
            .expect("commit Account upsert");
        let operation_id: String = journal
            .connection
            .query_row(
                "SELECT previousOperationId FROM library_core_actors WHERE actorId = ?1;",
                rusqlite::params![enrollment.actor_id],
                |row| row.get(0),
            )
            .expect("read Account actor tip");
        let chain_digest: String = journal
            .connection
            .query_row(
                "SELECT previousChainDigest FROM library_core_actors WHERE actorId = ?1;",
                rusqlite::params![enrollment.actor_id],
                |row| row.get(0),
            )
            .expect("read Account chain tip");
        let remove = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:account-remove:native-verified",
            2,
            Some(&operation_id),
            &chain_digest,
            &[(account_id, 1_235)],
            "account_remove",
        );
        journal
            .verify_and_commit_read_transaction(&remove, 1_600)
            .expect("commit Account removal");

        let shell: String = journal
            .connection
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state WHERE singletonId = 1;",
                [],
                |row| row.get(0),
            )
            .expect("read shell");
        let shell: Value = serde_json::from_str(&shell).expect("parse shell");
        assert!(shell["accounts"].get(account_id).is_none());
        let accepted_results: i64 = journal
            .connection
            .query_row(
                "SELECT COUNT(*) FROM library_core_intent_result_outbox;",
                [],
                |row| row.get(0),
            )
            .expect("count acceptance receipts");
        assert_eq!(accepted_results, 2);
    }

    #[test]
    fn verified_stale_fork_fails_at_the_atomic_actor_tip_check() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[10_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let first = signed_envelopes(&key_pair, &enrollment);
        let stale_fork = signed_envelopes_from_tip(
            &key_pair,
            &enrollment,
            "tx:read:stale-native-fork",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:stale-fork", 902)],
            "feed_item_read_assignment",
        );
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .verify_and_commit_read_transaction(&first, 1_500)
            .expect("commit first transaction");

        assert!(matches!(
            journal.verify_and_commit_read_transaction(&stale_fork, 1_600),
            Err(LibraryCoreError::StaleActorTip { actor_id })
                if actor_id == enrollment.actor_id
        ));
        let transaction_rows: i64 = journal
            .connection
            .query_row(
                "SELECT COUNT(*) FROM library_core_transactions;",
                [],
                |row| row.get(0),
            )
            .expect("transaction row count");
        assert_eq!(transaction_rows, 1);
    }

    #[test]
    fn rejects_tampering_before_any_authoritative_row_is_written() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[8_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let mut envelopes = signed_envelopes(&key_pair, &enrollment);
        let mut value = decode_canonical_value(&envelopes[1], MAX_TRANSACTION_ENVELOPE_BYTES)
            .expect("decode fixture")
            .value()
            .clone();
        let signature = value
            .get("signature")
            .and_then(Value::as_str)
            .expect("signature");
        let replacement = if signature.ends_with('0') { '1' } else { '0' };
        value["signature"] = Value::String(format!(
            "{}{replacement}",
            &signature[..signature.len() - 1]
        ));
        envelopes[1] =
            encode_canonical_value(&value, MAX_TRANSACTION_ENVELOPE_BYTES).expect("encode tamper");

        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        assert!(matches!(
            journal.verify_and_commit_read_transaction(&envelopes, 1_500),
            Err(LibraryCoreError::OperationVerification {
                index: 1,
                field: "signature"
            })
        ));
        let rows: i64 = journal
            .connection
            .query_row("SELECT COUNT(*) FROM library_core_operations;", [], |row| {
                row.get(0)
            })
            .expect("row count");
        assert_eq!(rows, 0);
    }

    #[test]
    fn rejects_noncanonical_duplicate_fields_and_incomplete_transactions() {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[9_u8; 32]).expect("key pair");
        let enrollment = enrollment(&key_pair);
        let envelopes = signed_envelopes(&key_pair, &enrollment);
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
        journal.enroll_actor(&enrollment).expect("enroll actor");

        assert!(matches!(
            journal.verify_operation_transaction(&envelopes[..1]),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "transaction_identity"
            })
        ));
        assert!(matches!(
            journal.verify_operation_transaction(&[
                br#"{"operation_id":"first","operation_id":"second"}"#.to_vec()
            ]),
            Err(LibraryCoreError::OperationVerification {
                index: 0,
                field: "canonical_envelope"
            })
        ));
    }
}
