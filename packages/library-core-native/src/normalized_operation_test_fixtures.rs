#[cfg(test)]
pub(crate) mod tests {
    use crate::library_core_canonical::{encode_canonical_value, encode_operation_signature_input};
    use crate::normalized_operation::VerifiedActorEnrollment;
    use crate::normalized_operation_verifier::digest_hex;
    use crate::normalized_protocol_limits::MAX_TRANSACTION_ENVELOPE_BYTES;
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
}
