use crate::library_core_actor_capability as actor_capability;
use crate::library_core_error::{LibraryCoreError, LibraryCoreResult};
use crate::normalized_operation::VerifiedOperationTransaction;
use crate::normalized_protocol_limits::{
    is_lower_hex, is_operation_id, MAX_CAUSAL_TIPS_PER_OPERATION, MAX_ENTITY_ID_BYTES,
    MAX_SAFE_INTEGER, MAX_TRANSACTION_ENVELOPE_BYTES, MAX_TRANSACTION_MEMBERS,
};

pub(crate) fn validate_transaction(
    transaction: &VerifiedOperationTransaction,
) -> LibraryCoreResult<()> {
    if !is_operation_id(&transaction.transaction_id) {
        return Err(LibraryCoreError::InvalidVerifiedInput {
            field: "transaction_id",
        });
    }
    if !is_lower_hex(&transaction.transaction_digest, 32) {
        return Err(LibraryCoreError::InvalidVerifiedInput {
            field: "transaction_digest",
        });
    }
    if !is_lower_hex(&transaction.library_id, 32) {
        return Err(LibraryCoreError::InvalidVerifiedInput {
            field: "library_id",
        });
    }
    if !(1..=MAX_SAFE_INTEGER).contains(&transaction.epoch) {
        return Err(LibraryCoreError::InvalidVerifiedInput { field: "epoch" });
    }
    if !is_lower_hex(&transaction.epoch_id, 32) {
        return Err(LibraryCoreError::InvalidVerifiedInput { field: "epoch_id" });
    }
    if !is_lower_hex(&transaction.actor_id, 32) {
        return Err(LibraryCoreError::InvalidVerifiedInput { field: "actor_id" });
    }
    actor_capability::validate_capability_state(&transaction.actor_capability)
        .map_err(|field| LibraryCoreError::InvalidVerifiedInput { field })?;
    if transaction.members.is_empty() || transaction.members.len() > MAX_TRANSACTION_MEMBERS {
        return Err(LibraryCoreError::InvalidVerifiedInput { field: "members" });
    }
    if transaction.canonical_envelope_bytes == 0
        || transaction.canonical_envelope_bytes > MAX_TRANSACTION_ENVELOPE_BYTES
    {
        return Err(LibraryCoreError::InvalidVerifiedInput {
            field: "canonical_envelope_bytes",
        });
    }

    let mut measured_bytes = 0usize;
    for (index, member) in transaction.members.iter().enumerate() {
        if !is_operation_id(&member.operation_id) {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "operation_id",
            });
        }
        let expected_sequence = transaction.members[0]
            .actor_sequence
            .checked_add(index as i64)
            .ok_or(LibraryCoreError::InvalidVerifiedInput {
                field: "actor_sequence",
            })?;
        if !(1..MAX_SAFE_INTEGER).contains(&member.actor_sequence)
            || member.actor_sequence != expected_sequence
        {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "actor_sequence",
            });
        }
        if index > 0
            && member.previous_actor_operation_id.as_deref()
                != Some(transaction.members[index - 1].operation_id.as_str())
        {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "previous_actor_operation_id",
            });
        }
        for (field, value) in [
            (
                "previous_actor_chain_digest",
                member.previous_actor_chain_digest.as_str(),
            ),
            ("actor_chain_digest", member.actor_chain_digest.as_str()),
            ("member_digest", member.member_digest.as_str()),
            ("signing_body_digest", member.signing_body_digest.as_str()),
            ("envelope_digest", member.envelope_digest.as_str()),
        ] {
            if !is_lower_hex(value, 32) {
                return Err(LibraryCoreError::InvalidVerifiedInput { field });
            }
        }
        if index > 0
            && member.previous_actor_chain_digest
                != transaction.members[index - 1].actor_chain_digest
        {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "previous_actor_chain_digest",
            });
        }
        if member.entity_id.is_empty() || member.entity_id.len() > MAX_ENTITY_ID_BYTES {
            return Err(LibraryCoreError::InvalidVerifiedInput { field: "entity_id" });
        }
        let payload_slot_count = usize::from(member.item_json.is_some())
            + usize::from(member.rss_feed_json.is_some())
            + usize::from(member.structured_payload_json.is_some())
            + usize::from(member.person_json.is_some())
            + usize::from(member.account_json.is_some())
            + usize::from(member.read_at_ms.is_some())
            + usize::from(member.assigned.is_some() || member.assigned_at_ms.is_some())
            + usize::from(member.synced_at_ms.is_some())
            + usize::from(member.removed_at_ms.is_some());
        if payload_slot_count != 1 {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "operation_payload",
            });
        }
        let is_sync_receipt = matches!(
            member.operation_type.as_str(),
            "feed_item_like_sync_receipt" | "feed_item_seen_sync_receipt"
        );
        if !is_sync_receipt && member.synced_at_ms.is_some() {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "synced_at_ms",
            });
        }
        match member.operation_type.as_str() {
            "feed_item_capture_upsert" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_none()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput { field: "item_json" });
                }
            }
            "feed_item_analysis_replace" | "feed_item_annotations_replace" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_none()
                    || member.person_json.is_some()
                    || member.account_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.synced_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "structured_payload_json",
                    });
                }
            }
            "feed_item_read_assignment" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member
                        .read_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "read_at_ms",
                    });
                }
            }
            "feed_item_saved_assignment"
            | "feed_item_archive_assignment"
            | "feed_item_like_assignment" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_none()
                    || member
                        .assigned_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "user_state_assignment",
                    });
                }
            }
            "feed_item_like_sync_receipt" | "feed_item_seen_sync_receipt" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_some()
                    || member.account_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .synced_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "sync_receipt",
                    });
                }
            }
            "feed_item_remove" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "removed_at_ms",
                    });
                }
            }
            "rss_feed_upsert" => {
                if member.entity_type != "RssFeed"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_none()
                    || member.structured_payload_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "rss_feed_json",
                    });
                }
            }
            "rss_feed_remove_keep_items" | "rss_feed_remove_with_items" => {
                if member.entity_type != "RssFeed"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "rss_feed_remove",
                    });
                }
            }
            "rss_feed_title_assignment" => {
                if member.entity_type != "RssFeed"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_none()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_some()
                    || member.account_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "rss_feed_title_assignment",
                    });
                }
            }
            "preferences_leaf_assignment" => {
                if member.entity_type != "UserPreferences"
                    || member.entity_id != "preferences"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_none()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "structured_payload_json",
                    });
                }
            }
            "friend_replace" | "person_upsert" => {
                if member.entity_type != "Person"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_none()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "person_json",
                    });
                }
            }
            "person_reach_out_append" => {
                if member.entity_type != "Person"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_none()
                    || member.account_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "person_reach_out_append",
                    });
                }
            }
            "person_remove_and_accounts" | "person_remove_detach_accounts" => {
                if member.entity_type != "Person"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "person_remove",
                    });
                }
            }
            "account_upsert" => {
                if member.entity_type != "Account"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_some()
                    || member.account_json.is_none()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "account_json",
                    });
                }
            }
            "account_person_assignment" => {
                if member.entity_type != "Account"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_some()
                    || member.account_json.is_none()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "account_person_assignment",
                    });
                }
            }
            "account_remove" => {
                if member.entity_type != "Account"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.structured_payload_json.is_some()
                    || member.person_json.is_some()
                    || member.account_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(LibraryCoreError::InvalidVerifiedInput {
                        field: "account_remove",
                    });
                }
            }
            _ => {
                return Err(LibraryCoreError::InvalidVerifiedInput {
                    field: "operation_type",
                });
            }
        }
        if member.canonical_envelope_json.is_empty() {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "canonical_envelope_json",
            });
        }
        measured_bytes = measured_bytes
            .checked_add(member.canonical_envelope_json.len())
            .ok_or(LibraryCoreError::InvalidVerifiedInput {
                field: "canonical_envelope_bytes",
            })?;
        if member.causal_tips.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
            return Err(LibraryCoreError::InvalidVerifiedInput {
                field: "causal_tips",
            });
        }
        for tip in &member.causal_tips {
            if !is_lower_hex(&tip.actor_id, 32)
                || !(1..=MAX_SAFE_INTEGER).contains(&tip.sequence)
                || !is_operation_id(&tip.operation_id)
                || !is_lower_hex(&tip.chain_digest, 32)
            {
                return Err(LibraryCoreError::InvalidVerifiedInput {
                    field: "causal_tip",
                });
            }
        }
    }
    if measured_bytes != transaction.canonical_envelope_bytes {
        return Err(LibraryCoreError::InvalidVerifiedInput {
            field: "canonical_envelope_bytes",
        });
    }
    Ok(())
}
