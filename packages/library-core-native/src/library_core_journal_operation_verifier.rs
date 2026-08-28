//! Native verification boundary for canonical Library Core operation envelopes.
//!
//! This module is private to the dormant authoritative journal. It reconstructs
//! every protocol digest and actor-chain link, verifies every Ed25519 signature,
//! and only then creates the sealed journal input type. No renderer value can
//! enter the authoritative log by merely matching a Rust struct's shape.

use super::{
    ActorState, JournalError, JournalResult, NormalizedCausalTipV1, VerifiedOperation,
    VerifiedOperationTransaction, MAX_CAUSAL_TIPS_PER_OPERATION, MAX_ENTITY_ID_BYTES,
    MAX_OPERATION_ID_BYTES, MAX_SAFE_INTEGER, MAX_TRANSACTION_ENVELOPE_BYTES,
    MAX_TRANSACTION_MEMBERS,
};
use crate::library_core_canonical::{
    decode_canonical_value, encode_canonical_value, encode_operation_digest_input,
    encode_operation_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const ENVELOPE_KEYS: [&str; 26] = [
    "operation_id",
    "library_id",
    "epoch",
    "epoch_id",
    "schema_version",
    "actor_id",
    "actor_sequence",
    "previous_actor_operation_id",
    "causal_frontier",
    "hlc_wall_ms",
    "hlc_counter",
    "transaction_id",
    "transaction_member_index",
    "transaction_member_count",
    "operation_type",
    "entity_type",
    "entity_id",
    "payload",
    "payload_digest",
    "blob_references",
    "created_at_ms",
    "signature_algorithm",
    "previous_actor_chain_digest",
    "actor_chain_digest",
    "transaction_digest",
    "signature",
];
const CAUSAL_TIP_KEYS: [&str; 4] = ["actor_id", "sequence", "operation_id", "chain_digest"];
const READ_PAYLOAD_KEYS: [&str; 1] = ["read_at_ms"];
const SYNC_RECEIPT_PAYLOAD_KEYS: [&str; 1] = ["synced_at_ms"];
const CAPTURE_PAYLOAD_KEYS: [&str; 1] = ["item"];
const ASSIGNMENT_PAYLOAD_KEYS: [&str; 2] = ["assigned", "assigned_at_ms"];
const REMOVE_PAYLOAD_KEYS: [&str; 1] = ["removed_at_ms"];
const RSS_FEED_UPSERT_PAYLOAD_KEYS: [&str; 1] = ["feed"];
const RSS_FEED_TITLE_PAYLOAD_KEYS: [&str; 2] = ["assigned_at_ms", "title"];
const PREFERENCES_PAYLOAD_KEYS: [&str; 1] = ["updates"];
const PERSON_UPSERT_PAYLOAD_KEYS: [&str; 1] = ["person"];
const FRIEND_REPLACE_PAYLOAD_KEYS: [&str; 2] = ["accounts", "person"];
const PERSON_REACH_OUT_APPEND_PAYLOAD_KEYS: [&str; 3] = ["channel", "logged_at_ms", "notes"];
const ACCOUNT_UPSERT_PAYLOAD_KEYS: [&str; 1] = ["account"];
const ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_KEYS: [&str; 2] = ["assigned_at_ms", "person_id"];
const RSS_FEED_KEYS: [&str; 10] = [
    "enabled",
    "folder",
    "imageUrl",
    "lastFetched",
    "pollInterval",
    "sampleDataFingerprint",
    "siteUrl",
    "title",
    "trackUnread",
    "url",
];
const PERSON_KEYS: [&str; 12] = [
    "avatarUrl",
    "bio",
    "careLevel",
    "createdAt",
    "id",
    "name",
    "notes",
    "reachOutIntervalDays",
    "relationshipStatus",
    "sampleDataFingerprint",
    "tags",
    "updatedAt",
];
const ACCOUNT_KEYS: [&str; 22] = [
    "address",
    "avatarUrl",
    "createdAt",
    "discoveredFrom",
    "displayName",
    "email",
    "externalId",
    "firstSeenAt",
    "followRosterActive",
    "followRosterRoles",
    "followRosterSyncedAt",
    "handle",
    "id",
    "importedAt",
    "kind",
    "lastSeenAt",
    "personId",
    "phone",
    "profileUrl",
    "provider",
    "sampleDataFingerprint",
    "updatedAt",
];
const MAX_CAPTURE_ITEM_BYTES: usize = 131_072;
const MAX_OPERATION_ENVELOPE_BYTES: usize = 131_072;
const MAX_RSS_FEED_BYTES: usize = 65_536;
const MAX_PREFERENCES_PATCH_BYTES: usize = 262_144;
const MAX_PREFERENCE_NODES: usize = 512;
const MAX_PREFERENCE_PATH_BYTES: usize = 4_096;
const MAX_PREFERENCE_TEXT_BYTES: usize = 8_192;
const MAX_PERSON_BYTES: usize = 262_144;
const MAX_ACCOUNT_BYTES: usize = 262_144;
const MAX_FRIEND_REPLACE_BYTES: usize = 98_304;
const MAX_FRIEND_REPLACE_ACCOUNTS: usize = 64;

#[derive(Debug, Clone)]
pub(crate) struct OperationIdentity {
    pub(crate) library_id: String,
    pub(crate) epoch_id: String,
    pub(crate) actor_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OperationAdmissionVerdict {
    Admissible,
    ActorRetired,
    CapabilityDenied { field: &'static str },
}

pub(crate) fn operation_admission_verdict(
    actor: &ActorState,
    verified: &VerifiedOperationTransaction,
) -> OperationAdmissionVerdict {
    if actor.retired {
        return OperationAdmissionVerdict::ActorRetired;
    }
    for member in &verified.members {
        let denied_field = if actor.capability.retired {
            Some("actor_capability_retired")
        } else if matches!(
            actor.capability.scope,
            crate::library_core_actor_capability::ActorCapabilityScope::Bounded { .. }
        ) {
            Some("actor_capability_scope")
        } else if !actor.capability.allows_operation(&member.operation_type) {
            Some("actor_capability_operation")
        } else {
            None
        };
        if let Some(field) = denied_field {
            return OperationAdmissionVerdict::CapabilityDenied { field };
        }
    }
    OperationAdmissionVerdict::Admissible
}

#[derive(Debug)]
struct ParsedEnvelope {
    value: Value,
    operation_id: String,
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    actor_sequence: i64,
    previous_actor_operation_id: Option<String>,
    causal_tips: Vec<NormalizedCausalTipV1>,
    transaction_id: String,
    transaction_member_index: i64,
    transaction_member_count: i64,
    entity_id: String,
    entity_type: String,
    operation_type: String,
    item_json: Option<String>,
    rss_feed_json: Option<String>,
    preferences_patch_json: Option<String>,
    person_json: Option<String>,
    account_json: Option<String>,
    read_at_ms: Option<i64>,
    assigned: Option<bool>,
    assigned_at_ms: Option<i64>,
    synced_at_ms: Option<i64>,
    removed_at_ms: Option<i64>,
    previous_actor_chain_digest: String,
    actor_chain_digest: String,
    transaction_digest: String,
    signature: String,
    member_digest: String,
    canonical_json: String,
}

fn invalid(index: usize, field: &'static str) -> JournalError {
    JournalError::OperationVerification { index, field }
}

fn validate_rss_feed(
    feed: &Map<String, Value>,
    entity_id: &str,
    index: usize,
) -> JournalResult<()> {
    if feed
        .keys()
        .any(|key| !RSS_FEED_KEYS.contains(&key.as_str()))
    {
        return Err(invalid(index, "feed"));
    }
    let url = feed
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "feed"))?;
    if url != entity_id || url.is_empty() || url.len() > MAX_ENTITY_ID_BYTES {
        return Err(invalid(index, "feed_identity"));
    }
    let title = feed
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "feed"))?;
    if title.len() > MAX_ENTITY_ID_BYTES
        || feed.get("enabled").and_then(Value::as_bool).is_none()
        || feed.get("trackUnread").and_then(Value::as_bool).is_none()
    {
        return Err(invalid(index, "feed"));
    }
    for key in ["siteUrl", "imageUrl", "folder"] {
        if feed.get(key).is_some_and(|value| {
            value
                .as_str()
                .is_none_or(|text| text.len() > MAX_ENTITY_ID_BYTES)
        }) {
            return Err(invalid(index, "feed"));
        }
    }
    for key in ["lastFetched", "pollInterval"] {
        if feed
            .get(key)
            .is_some_and(|value| value.as_i64().is_none_or(|number| number < 0))
        {
            return Err(invalid(index, "feed"));
        }
    }
    if feed.get("sampleDataFingerprint").is_some_and(|value| {
        value.as_object().is_none_or(|fingerprint| {
            fingerprint.len() != 4
                || fingerprint.get("marker").and_then(Value::as_str) != Some("freed.sample-data.v1")
                || fingerprint.get("batchId").and_then(Value::as_str).is_none()
                || fingerprint
                    .get("generatedAt")
                    .and_then(Value::as_i64)
                    .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                || fingerprint
                    .get("generatorVersion")
                    .and_then(Value::as_i64)
                    .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
        })
    }) {
        return Err(invalid(index, "feed"));
    }
    Ok(())
}

fn validate_person(
    person: &Map<String, Value>,
    entity_id: &str,
    index: usize,
) -> JournalResult<()> {
    if person
        .keys()
        .any(|key| !PERSON_KEYS.contains(&key.as_str()))
    {
        return Err(invalid(index, "person"));
    }
    let id = person
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "person"))?;
    let name = person
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "person"))?;
    let relationship_status = person
        .get("relationshipStatus")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "person"))?;
    let care_level = person
        .get("careLevel")
        .and_then(Value::as_i64)
        .ok_or_else(|| invalid(index, "person"))?;
    if id != entity_id
        || id.is_empty()
        || id.len() > MAX_ENTITY_ID_BYTES
        || name.len() > 16_384
        || !matches!(relationship_status, "connection" | "friend")
        || !(1..=5).contains(&care_level)
    {
        return Err(invalid(index, "person_identity"));
    }
    for key in ["createdAt", "updatedAt"] {
        let value = person
            .get(key)
            .and_then(Value::as_i64)
            .ok_or_else(|| invalid(index, "person"))?;
        if !(0..=MAX_SAFE_INTEGER).contains(&value) {
            return Err(invalid(index, "person"));
        }
    }
    for key in ["avatarUrl", "bio", "notes"] {
        if person.get(key).is_some_and(|value| {
            value
                .as_str()
                .is_none_or(|text| text.len() > MAX_PERSON_BYTES)
        }) {
            return Err(invalid(index, "person"));
        }
    }
    if person
        .get("reachOutIntervalDays")
        .is_some_and(|value| value.as_i64().is_none_or(|number| number < 0))
        || person.get("tags").is_some_and(|value| {
            value.as_array().is_none_or(|items| {
                items.len() > 4_096
                    || items.iter().any(|item| {
                        item.as_str()
                            .is_none_or(|text| text.len() > MAX_ENTITY_ID_BYTES)
                    })
            })
        })
        || person.get("reachOutLog").is_some_and(|value| {
            value.as_array().is_none_or(|items| {
                items.len() > 20
                    || items.iter().any(|item| {
                        let Some(entry) = item.as_object() else {
                            return true;
                        };
                        entry
                            .keys()
                            .any(|key| !["loggedAt", "channel", "notes"].contains(&key.as_str()))
                            || entry.get("loggedAt").and_then(Value::as_i64).is_none_or(
                                |logged_at| !(0..=MAX_SAFE_INTEGER).contains(&logged_at),
                            )
                            || entry.get("channel").is_some_and(|channel| {
                                channel.as_str().is_none_or(|channel| {
                                    !matches!(
                                        channel,
                                        "phone" | "text" | "email" | "in_person" | "other"
                                    )
                                })
                            })
                            || entry
                                .get("notes")
                                .is_some_and(|notes| notes.as_str().is_none())
                    })
            })
        })
        || person.get("sampleDataFingerprint").is_some_and(|value| {
            value.as_object().is_none_or(|fingerprint| {
                fingerprint.len() != 4
                    || fingerprint.get("marker").and_then(Value::as_str)
                        != Some("freed.sample-data.v1")
                    || fingerprint.get("batchId").and_then(Value::as_str).is_none()
                    || fingerprint
                        .get("generatedAt")
                        .and_then(Value::as_i64)
                        .is_none_or(|generated_at| !(0..=MAX_SAFE_INTEGER).contains(&generated_at))
                    || fingerprint
                        .get("generatorVersion")
                        .and_then(Value::as_i64)
                        .is_none_or(|version| !(0..=MAX_SAFE_INTEGER).contains(&version))
            })
        })
    {
        return Err(invalid(index, "person"));
    }
    Ok(())
}

fn validate_account(
    account: &Map<String, Value>,
    entity_id: &str,
    index: usize,
) -> JournalResult<()> {
    if account
        .keys()
        .any(|key| !ACCOUNT_KEYS.contains(&key.as_str()))
    {
        return Err(invalid(index, "account"));
    }
    let id = account
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "account"))?;
    let kind = account
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "account"))?;
    let provider = account
        .get("provider")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "account"))?;
    let external_id = account
        .get("externalId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "account"))?;
    let discovered_from = account
        .get("discoveredFrom")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(index, "account"))?;
    if id != entity_id
        || id.is_empty()
        || id.len() > MAX_ENTITY_ID_BYTES
        || !matches!(kind, "social" | "contact")
        || !matches!(
            provider,
            "x" | "rss"
                | "youtube"
                | "reddit"
                | "mastodon"
                | "github"
                | "facebook"
                | "instagram"
                | "linkedin"
                | "substack"
                | "medium"
                | "saved"
                | "google_contacts"
                | "manual_contact"
                | "macos_contacts"
                | "ios_contacts"
                | "android_contacts"
                | "web_contact"
        )
        || external_id.is_empty()
        || external_id.len() > 16_384
        || !matches!(
            discovered_from,
            "captured_item" | "story_author" | "contact_import" | "manual_entry" | "follow_roster"
        )
    {
        return Err(invalid(index, "account_identity"));
    }
    for key in ["firstSeenAt", "lastSeenAt", "createdAt", "updatedAt"] {
        let value = account
            .get(key)
            .and_then(Value::as_i64)
            .ok_or_else(|| invalid(index, "account"))?;
        if !(0..=MAX_SAFE_INTEGER).contains(&value) {
            return Err(invalid(index, "account"));
        }
    }
    for key in [
        "personId",
        "handle",
        "displayName",
        "avatarUrl",
        "profileUrl",
        "email",
        "phone",
        "address",
    ] {
        if account.get(key).is_some_and(|value| {
            value
                .as_str()
                .is_none_or(|text| text.len() > MAX_ACCOUNT_BYTES)
        }) {
            return Err(invalid(index, "account"));
        }
    }
    for key in ["importedAt", "followRosterSyncedAt"] {
        if account.get(key).is_some_and(|value| {
            value
                .as_i64()
                .is_none_or(|number| !(0..=MAX_SAFE_INTEGER).contains(&number))
        }) {
            return Err(invalid(index, "account"));
        }
    }
    if account
        .get("followRosterActive")
        .is_some_and(|value| value.as_bool().is_none())
        || account.get("followRosterRoles").is_some_and(|value| {
            value.as_array().is_none_or(|roles| {
                roles.len() > 3
                    || roles.iter().any(|role| {
                        role.as_str().is_none_or(|role| {
                            !matches!(role, "follower" | "following" | "subscription")
                        })
                    })
            })
        })
        || account.get("sampleDataFingerprint").is_some_and(|value| {
            value.as_object().is_none_or(|fingerprint| {
                fingerprint.len() != 4
                    || fingerprint.get("marker").and_then(Value::as_str)
                        != Some("freed.sample-data.v1")
                    || fingerprint.get("batchId").and_then(Value::as_str).is_none()
                    || fingerprint
                        .get("generatedAt")
                        .and_then(Value::as_i64)
                        .is_none_or(|generated_at| !(0..=MAX_SAFE_INTEGER).contains(&generated_at))
                    || fingerprint
                        .get("generatorVersion")
                        .and_then(Value::as_i64)
                        .is_none_or(|version| !(0..=MAX_SAFE_INTEGER).contains(&version))
            })
        })
    {
        return Err(invalid(index, "account"));
    }
    Ok(())
}

fn validate_preference_node_bounds(
    value: &Value,
    path: &str,
    node_count: &mut usize,
    index: usize,
) -> JournalResult<()> {
    *node_count += 1;
    if *node_count > MAX_PREFERENCE_NODES || path.len() > MAX_PREFERENCE_PATH_BYTES {
        return Err(invalid(index, "preferences_node_bounds"));
    }
    match value {
        Value::String(text) if text.len() > MAX_PREFERENCE_TEXT_BYTES => {
            Err(invalid(index, "preferences_node_bounds"))
        }
        Value::Array(values) => {
            for (child_index, child) in values.iter().enumerate() {
                validate_preference_node_bounds(
                    child,
                    &format!("{path}[{child_index}]"),
                    node_count,
                    index,
                )?;
            }
            Ok(())
        }
        Value::Object(object) => {
            for (key, child) in object {
                let key = serde_json::to_string(key)
                    .map_err(|_| invalid(index, "preferences_node_bounds"))?;
                validate_preference_node_bounds(
                    child,
                    &format!("{path}.{key}"),
                    node_count,
                    index,
                )?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn validate_preferences_patch(updates: &Map<String, Value>, index: usize) -> JournalResult<()> {
    const TOP_LEVEL: [&str; 8] = [
        "weights",
        "ulysses",
        "display",
        "xCapture",
        "fbCapture",
        "friendSuggestions",
        "ai",
        "storyWall",
    ];
    if updates.is_empty() || updates.keys().any(|key| !TOP_LEVEL.contains(&key.as_str())) {
        return Err(invalid(index, "preferences_updates"));
    }
    let rejects = [
        (
            "display",
            [
                "themeId",
                "sidebarWidth",
                "sidebarMode",
                "friendsSidebarWidth",
                "friendsSidebarOpen",
                "friendsMode",
                "debugPanelWidth",
                "mapMode",
                "mapTimeMode",
                "feedSignalMode",
                "feedSignalModes",
                "savedContentSortMode",
            ]
            .as_slice(),
        ),
        ("ai", ["provider", "model", "ollamaUrl"].as_slice()),
        ("fbCapture", ["knownGroups"].as_slice()),
    ];
    for (parent, forbidden) in rejects {
        if updates
            .get(parent)
            .and_then(Value::as_object)
            .is_some_and(|object| object.keys().any(|key| forbidden.contains(&key.as_str())))
        {
            return Err(invalid(index, "preferences_device_local"));
        }
    }
    if updates
        .get("display")
        .and_then(Value::as_object)
        .and_then(|display| display.get("reading"))
        .and_then(Value::as_object)
        .is_some_and(|reading| reading.contains_key("dualColumnMode"))
    {
        return Err(invalid(index, "preferences_device_local"));
    }
    if updates
        .get("storyWall")
        .and_then(Value::as_object)
        .and_then(|story| story.get("publishTarget"))
        .and_then(Value::as_object)
        .is_some_and(|target| target.contains_key("lastError") || target.contains_key("status"))
    {
        return Err(invalid(index, "preferences_device_local"));
    }
    let mut node_count = 0;
    for (key, value) in updates {
        let key =
            serde_json::to_string(key).map_err(|_| invalid(index, "preferences_node_bounds"))?;
        validate_preference_node_bounds(value, &format!("$.{key}"), &mut node_count, index)?;
    }
    Ok(())
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
    index: usize,
    field: &'static str,
) -> JournalResult<&'a Map<String, Value>> {
    let object = value.as_object().ok_or_else(|| invalid(index, field))?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid(index, field));
    }
    Ok(object)
}

fn validate_capture_object_keys(
    object: &Map<String, Value>,
    allowed: &[&str],
    index: usize,
    field: &'static str,
) -> JournalResult<()> {
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(invalid(index, field));
    }
    Ok(())
}

fn validate_feed_item_capture(item: &Map<String, Value>, index: usize) -> JournalResult<()> {
    validate_capture_object_keys(
        item,
        &[
            "author",
            "capturedAt",
            "content",
            "contentType",
            "engagement",
            "fbGroup",
            "globalId",
            "location",
            "platform",
            "preservedContent",
            "publishedAt",
            "rssSource",
            "sampleDataFingerprint",
            "sourceUrl",
            "timeRange",
            "topics",
            "userState",
        ],
        index,
        "item_fields",
    )?;
    for key in ["globalId", "platform", "contentType"] {
        if item
            .get(key)
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(invalid(index, "item_fields"));
        }
    }
    for key in ["capturedAt", "publishedAt"] {
        if item
            .get(key)
            .and_then(Value::as_i64)
            .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
        {
            return Err(invalid(index, "item_fields"));
        }
    }
    let author = item
        .get("author")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(index, "item_author"))?;
    validate_capture_object_keys(
        author,
        &["avatarUrl", "displayName", "handle", "id"],
        index,
        "item_author",
    )?;
    for key in ["id", "handle", "displayName"] {
        if author.get(key).and_then(Value::as_str).is_none() {
            return Err(invalid(index, "item_author"));
        }
    }
    let content = item
        .get("content")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(index, "item_content"))?;
    validate_capture_object_keys(
        content,
        &["linkPreview", "mediaTypes", "mediaUrls", "text"],
        index,
        "item_content",
    )?;
    let media_urls = content
        .get("mediaUrls")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(index, "item_media"))?;
    let media_types = content
        .get("mediaTypes")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(index, "item_media"))?;
    if media_urls.len() > 32
        || media_types.len() != media_urls.len()
        || media_urls
            .iter()
            .any(|value| value.as_str().is_none_or(str::is_empty))
        || media_types.iter().any(|value| value.as_str().is_none())
    {
        return Err(invalid(index, "item_media"));
    }
    if content
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| text.len() > 65_536)
    {
        return Err(invalid(index, "item_content_descriptor"));
    }
    for (key, allowed, field) in [
        (
            "engagement",
            ["comments", "likes", "reposts", "views"].as_slice(),
            "item_engagement",
        ),
        (
            "location",
            ["coordinates", "name", "source", "url"].as_slice(),
            "item_location",
        ),
        (
            "timeRange",
            ["endsAt", "kind", "startsAt"].as_slice(),
            "item_time_range",
        ),
        (
            "rssSource",
            ["feedTitle", "feedUrl", "siteUrl"].as_slice(),
            "item_rss_source",
        ),
        ("fbGroup", ["id", "name", "url"].as_slice(), "item_fb_group"),
        (
            "preservedContent",
            [
                "author",
                "preservedAt",
                "publishedAt",
                "readingTime",
                "text",
                "wordCount",
            ]
            .as_slice(),
            "item_preserved_content",
        ),
        (
            "sampleDataFingerprint",
            ["batchId", "generatedAt", "generatorVersion", "marker"].as_slice(),
            "item_sample_fingerprint",
        ),
    ] {
        if let Some(value) = item.get(key) {
            let object = value.as_object().ok_or_else(|| invalid(index, field))?;
            validate_capture_object_keys(object, allowed, index, field)?;
        }
    }
    if let Some(link_preview) = content.get("linkPreview") {
        let object = link_preview
            .as_object()
            .ok_or_else(|| invalid(index, "item_link_preview"))?;
        validate_capture_object_keys(
            object,
            &["description", "title", "url"],
            index,
            "item_link_preview",
        )?;
    }
    if let Some(coordinates) = item
        .get("location")
        .and_then(Value::as_object)
        .and_then(|location| location.get("coordinates"))
    {
        let object = coordinates
            .as_object()
            .ok_or_else(|| invalid(index, "item_location_coordinates"))?;
        validate_capture_object_keys(object, &["lat", "lng"], index, "item_location_coordinates")?;
    }
    let topics = item
        .get("topics")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(index, "item_topics"))?;
    if topics.len() > 64
        || topics
            .iter()
            .any(|value| value.as_str().is_none_or(str::is_empty))
    {
        return Err(invalid(index, "item_topics"));
    }
    let user_state = item
        .get("userState")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(index, "item_user_state"))?;
    validate_capture_object_keys(
        user_state,
        &[
            "archived",
            "archivedAt",
            "hidden",
            "liked",
            "likedAt",
            "likedSyncedAt",
            "readAt",
            "saved",
            "savedAt",
            "seenSyncedAt",
            "tags",
        ],
        index,
        "item_user_state",
    )?;
    if ["hidden", "saved", "archived"]
        .iter()
        .any(|key| user_state.get(*key).and_then(Value::as_bool).is_none())
        || user_state
            .get("tags")
            .and_then(Value::as_array)
            .is_none_or(|tags| !tags.is_empty())
    {
        return Err(invalid(index, "item_user_state"));
    }
    if item
        .get("preservedContent")
        .and_then(Value::as_object)
        .and_then(|content| content.get("text"))
        .and_then(Value::as_str)
        .is_some_and(|text| text.len() > 65_536)
    {
        return Err(invalid(index, "item_content_descriptor"));
    }
    Ok(())
}

fn required_string(
    object: &Map<String, Value>,
    key: &'static str,
    index: usize,
) -> JournalResult<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid(index, key))
}

fn safe_integer(
    object: &Map<String, Value>,
    key: &'static str,
    index: usize,
) -> JournalResult<i64> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
        .ok_or_else(|| invalid(index, key))
}

fn positive_safe_integer(
    object: &Map<String, Value>,
    key: &'static str,
    index: usize,
) -> JournalResult<i64> {
    safe_integer(object, key, index).and_then(|value| {
        if value == 0 {
            Err(invalid(index, key))
        } else {
            Ok(value)
        }
    })
}

fn decode_binary64_wrappers(value: &mut Value) -> Result<(), ()> {
    match value {
        Value::Array(values) => {
            for nested in values {
                decode_binary64_wrappers(nested)?;
            }
        }
        Value::Object(object) => {
            if object.len() == 2
                && object.get("codec").and_then(Value::as_str) == Some("ieee754_binary64_hex_v1")
                && object.contains_key("bits")
            {
                let bits = object.get("bits").and_then(Value::as_str).ok_or(())?;
                if bits.len() != 16 || !bits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    return Err(());
                }
                let decoded = f64::from_bits(u64::from_str_radix(bits, 16).map_err(|_| ())?);
                if !decoded.is_finite() {
                    return Err(());
                }
                *value = Value::Number(serde_json::Number::from_f64(decoded).ok_or(())?);
                return Ok(());
            }
            for nested in object.values_mut() {
                decode_binary64_wrappers(nested)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn require_literal(
    object: &Map<String, Value>,
    key: &'static str,
    expected: &str,
    index: usize,
) -> JournalResult<()> {
    if object.get(key).and_then(Value::as_str) != Some(expected) {
        return Err(invalid(index, key));
    }
    Ok(())
}

fn require_integer_literal(
    object: &Map<String, Value>,
    key: &'static str,
    expected: i64,
    index: usize,
) -> JournalResult<()> {
    if object.get(key).and_then(Value::as_i64) != Some(expected) {
        return Err(invalid(index, key));
    }
    Ok(())
}

fn require_hex(value: &str, bytes: usize, index: usize, field: &'static str) -> JournalResult<()> {
    if value.len() != bytes * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid(index, field));
    }
    Ok(())
}

fn require_operation_id(value: &str, index: usize, field: &'static str) -> JournalResult<()> {
    if value.is_empty()
        || value.len() > MAX_OPERATION_ID_BYTES
        || !value.bytes().enumerate().all(|(offset, byte)| {
            byte.is_ascii_alphanumeric()
                || (offset > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
    {
        return Err(invalid(index, field));
    }
    Ok(())
}

fn digest_hex(domain: &str, value: &Value, index: usize) -> JournalResult<String> {
    let input = encode_operation_digest_input(domain, value, MAX_TRANSACTION_ENVELOPE_BYTES)
        .map_err(|_| invalid(index, "digest_input"))?;
    let bytes = Sha256::digest(input);
    let mut encoded = String::with_capacity(64);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(encoded)
}

fn parse_causal_tips(value: &Value, index: usize) -> JournalResult<Vec<NormalizedCausalTipV1>> {
    let tips = value
        .as_array()
        .ok_or_else(|| invalid(index, "causal_frontier"))?;
    if tips.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
        return Err(invalid(index, "causal_frontier"));
    }
    let mut parsed = Vec::with_capacity(tips.len());
    let mut previous: Option<(String, i64, String, String)> = None;
    for tip in tips {
        let object = exact_object(tip, &CAUSAL_TIP_KEYS, index, "causal_frontier")?;
        let actor_id = required_string(object, "actor_id", index)?;
        let sequence = positive_safe_integer(object, "sequence", index)?;
        let operation_id = required_string(object, "operation_id", index)?;
        let chain_digest = required_string(object, "chain_digest", index)?;
        require_hex(&actor_id, 32, index, "causal_frontier")?;
        require_operation_id(&operation_id, index, "causal_frontier")?;
        require_hex(&chain_digest, 32, index, "causal_frontier")?;
        let key = (
            actor_id.clone(),
            sequence,
            operation_id.clone(),
            chain_digest.clone(),
        );
        if previous
            .as_ref()
            .is_some_and(|prior| prior.0 == actor_id || prior >= &key)
        {
            return Err(invalid(index, "causal_frontier"));
        }
        previous = Some(key);
        parsed.push(NormalizedCausalTipV1 {
            actor_id,
            sequence,
            operation_id,
            chain_digest,
        });
    }
    Ok(parsed)
}

fn parse_envelope(bytes: &[u8], index: usize) -> JournalResult<ParsedEnvelope> {
    if bytes.is_empty() || bytes.len() > MAX_OPERATION_ENVELOPE_BYTES {
        return Err(invalid(index, "canonical_envelope"));
    }
    let decoded = decode_canonical_value(bytes, MAX_TRANSACTION_ENVELOPE_BYTES)
        .map_err(|_| invalid(index, "canonical_envelope"))?;
    let value = decoded.into_value();
    let object = exact_object(&value, &ENVELOPE_KEYS, index, "field_set")?;

    require_integer_literal(object, "schema_version", 1, index)?;
    let operation_type = required_string(object, "operation_type", index)?;
    if !crate::library_core_actor_capability::is_registered_operation(&operation_type) {
        return Err(invalid(index, "operation_type"));
    }
    let entity_type = if operation_type.starts_with("rss_feed_") {
        "RssFeed"
    } else if operation_type == "preferences_leaf_assignment" {
        "UserPreferences"
    } else if matches!(
        operation_type.as_str(),
        "person_reach_out_append"
            | "friend_replace"
            | "person_upsert"
            | "person_remove_and_accounts"
            | "person_remove_detach_accounts"
    ) {
        "Person"
    } else if matches!(
        operation_type.as_str(),
        "account_person_assignment" | "account_upsert" | "account_remove"
    ) {
        "Account"
    } else {
        "FeedItem"
    };
    require_literal(object, "entity_type", entity_type, index)?;
    require_literal(object, "signature_algorithm", "ed25519", index)?;
    if object
        .get("blob_references")
        .and_then(Value::as_array)
        .is_none_or(|references| !references.is_empty())
    {
        return Err(invalid(index, "blob_references"));
    }

    let operation_id = required_string(object, "operation_id", index)?;
    let library_id = required_string(object, "library_id", index)?;
    let epoch = positive_safe_integer(object, "epoch", index)?;
    let epoch_id = required_string(object, "epoch_id", index)?;
    let actor_id = required_string(object, "actor_id", index)?;
    let actor_sequence = positive_safe_integer(object, "actor_sequence", index)?;
    let previous_actor_operation_id = match object.get("previous_actor_operation_id") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => {
            require_operation_id(value, index, "previous_actor_operation_id")?;
            Some(value.clone())
        }
        _ => return Err(invalid(index, "previous_actor_operation_id")),
    };
    if (actor_sequence == 1) != previous_actor_operation_id.is_none() {
        return Err(invalid(index, "previous_actor_operation_id"));
    }
    let causal_tips = parse_causal_tips(
        object
            .get("causal_frontier")
            .ok_or_else(|| invalid(index, "causal_frontier"))?,
        index,
    )?;
    safe_integer(object, "hlc_wall_ms", index)?;
    safe_integer(object, "hlc_counter", index)?;
    let transaction_id = required_string(object, "transaction_id", index)?;
    let transaction_member_index = safe_integer(object, "transaction_member_index", index)?;
    let transaction_member_count =
        positive_safe_integer(object, "transaction_member_count", index)?;
    if transaction_member_count > MAX_TRANSACTION_MEMBERS as i64
        || transaction_member_index >= transaction_member_count
    {
        return Err(invalid(index, "transaction_member_index"));
    }
    let entity_id = required_string(object, "entity_id", index)?;
    if entity_id.is_empty() || entity_id.len() > MAX_ENTITY_ID_BYTES {
        return Err(invalid(index, "entity_id"));
    }
    let payload = object
        .get("payload")
        .ok_or_else(|| invalid(index, "payload"))?;
    let (
        item_json,
        rss_feed_json,
        preferences_patch_json,
        person_json,
        account_json,
        read_at_ms,
        assigned,
        assigned_at_ms,
        synced_at_ms,
        removed_at_ms,
    ) = match operation_type.as_str() {
        "feed_item_capture_upsert" => {
            let payload_object = exact_object(payload, &CAPTURE_PAYLOAD_KEYS, index, "payload")?;
            let item = payload_object
                .get("item")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid(index, "item"))?;
            validate_feed_item_capture(item, index)?;
            if item.get("globalId").and_then(Value::as_str) != Some(entity_id.as_str()) {
                return Err(invalid(index, "item_identity"));
            }
            encode_canonical_value(&Value::Object(item.clone()), MAX_CAPTURE_ITEM_BYTES)
                .map_err(|_| invalid(index, "item"))?;
            let mut materialized_item = Value::Object(item.clone());
            decode_binary64_wrappers(&mut materialized_item).map_err(|_| invalid(index, "item"))?;
            (
                Some(
                    serde_json::to_string(&materialized_item)
                        .map_err(|_| invalid(index, "item"))?,
                ),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        "feed_item_read_assignment" => {
            let payload_object = exact_object(payload, &READ_PAYLOAD_KEYS, index, "payload")?;
            (
                None,
                None,
                None,
                None,
                None,
                Some(safe_integer(payload_object, "read_at_ms", index)?),
                None,
                None,
                None,
                None,
            )
        }
        "feed_item_saved_assignment"
        | "feed_item_archive_assignment"
        | "feed_item_like_assignment" => {
            let payload_object = exact_object(payload, &ASSIGNMENT_PAYLOAD_KEYS, index, "payload")?;
            let assigned = payload_object
                .get("assigned")
                .and_then(Value::as_bool)
                .ok_or_else(|| invalid(index, "assigned"))?;
            (
                None,
                None,
                None,
                None,
                None,
                None,
                Some(assigned),
                Some(safe_integer(payload_object, "assigned_at_ms", index)?),
                None,
                None,
            )
        }
        "feed_item_like_sync_receipt" | "feed_item_seen_sync_receipt" => {
            let payload_object =
                exact_object(payload, &SYNC_RECEIPT_PAYLOAD_KEYS, index, "payload")?;
            (
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(safe_integer(payload_object, "synced_at_ms", index)?),
                None,
            )
        }
        "feed_item_remove"
        | "person_remove_and_accounts"
        | "person_remove_detach_accounts"
        | "account_remove" => {
            let payload_object = exact_object(payload, &REMOVE_PAYLOAD_KEYS, index, "payload")?;
            (
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(safe_integer(payload_object, "removed_at_ms", index)?),
            )
        }
        "rss_feed_upsert" => {
            let payload_object =
                exact_object(payload, &RSS_FEED_UPSERT_PAYLOAD_KEYS, index, "payload")?;
            let feed = payload_object
                .get("feed")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid(index, "feed"))?;
            validate_rss_feed(feed, &entity_id, index)?;
            let canonical_feed =
                encode_canonical_value(&Value::Object(feed.clone()), MAX_RSS_FEED_BYTES)
                    .map_err(|_| invalid(index, "feed"))?;
            (
                None,
                Some(String::from_utf8(canonical_feed).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        "rss_feed_title_assignment" => {
            let payload_object =
                exact_object(payload, &RSS_FEED_TITLE_PAYLOAD_KEYS, index, "payload")?;
            let title = payload_object
                .get("title")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(index, "title"))?;
            if title.len() > MAX_ENTITY_ID_BYTES {
                return Err(invalid(index, "title"));
            }
            safe_integer(payload_object, "assigned_at_ms", index)?;
            let canonical = encode_canonical_value(payload, MAX_RSS_FEED_BYTES)
                .map_err(|_| invalid(index, "rss_feed_title_assignment"))?;
            (
                None,
                Some(String::from_utf8(canonical).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        "preferences_leaf_assignment" => {
            if entity_id != "preferences" {
                return Err(invalid(index, "preferences_identity"));
            }
            let payload_object =
                exact_object(payload, &PREFERENCES_PAYLOAD_KEYS, index, "payload")?;
            let updates = payload_object
                .get("updates")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid(index, "preferences_updates"))?;
            validate_preferences_patch(updates, index)?;
            let canonical = encode_canonical_value(
                &Value::Object(updates.clone()),
                MAX_PREFERENCES_PATCH_BYTES,
            )
            .map_err(|_| invalid(index, "preferences_updates"))?;
            (
                None,
                None,
                Some(String::from_utf8(canonical).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        "person_upsert" => {
            let payload_object =
                exact_object(payload, &PERSON_UPSERT_PAYLOAD_KEYS, index, "payload")?;
            let person = payload_object
                .get("person")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid(index, "person"))?;
            validate_person(person, &entity_id, index)?;
            let canonical =
                encode_canonical_value(&Value::Object(person.clone()), MAX_PERSON_BYTES)
                    .map_err(|_| invalid(index, "person"))?;
            (
                None,
                None,
                None,
                Some(String::from_utf8(canonical).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        "friend_replace" => {
            let payload_object =
                exact_object(payload, &FRIEND_REPLACE_PAYLOAD_KEYS, index, "payload")?;
            let person = payload_object
                .get("person")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid(index, "person"))?;
            validate_person(person, &entity_id, index)?;
            let accounts = payload_object
                .get("accounts")
                .and_then(Value::as_array)
                .filter(|accounts| accounts.len() <= MAX_FRIEND_REPLACE_ACCOUNTS)
                .ok_or_else(|| invalid(index, "accounts"))?;
            let mut prior_account_id: Option<&str> = None;
            let mut contact_count = 0usize;
            for account_value in accounts {
                let account = account_value
                    .as_object()
                    .ok_or_else(|| invalid(index, "accounts"))?;
                let account_id = account
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid(index, "accounts"))?;
                validate_account(account, account_id, index)?;
                if account.get("personId").and_then(Value::as_str) != Some(entity_id.as_str())
                    || prior_account_id.is_some_and(|prior| prior >= account_id)
                {
                    return Err(invalid(index, "accounts"));
                }
                if account.get("kind").and_then(Value::as_str) == Some("contact") {
                    contact_count += 1;
                    if contact_count > 1 {
                        return Err(invalid(index, "accounts"));
                    }
                }
                prior_account_id = Some(account_id);
            }
            let canonical = encode_canonical_value(payload, MAX_FRIEND_REPLACE_BYTES)
                .map_err(|_| invalid(index, "friend_replace"))?;
            (
                None,
                None,
                None,
                Some(String::from_utf8(canonical).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        "person_reach_out_append" => {
            let payload_object = exact_object(
                payload,
                &PERSON_REACH_OUT_APPEND_PAYLOAD_KEYS,
                index,
                "payload",
            )?;
            match payload_object.get("channel") {
                Some(Value::Null) => {}
                Some(Value::String(value))
                    if matches!(
                        value.as_str(),
                        "phone" | "text" | "email" | "in_person" | "other"
                    ) => {}
                _ => return Err(invalid(index, "channel")),
            }
            safe_integer(payload_object, "logged_at_ms", index)?;
            match payload_object.get("notes") {
                Some(Value::Null) => {}
                Some(Value::String(value)) if value.len() <= 65_536 => {}
                _ => return Err(invalid(index, "notes")),
            }
            let canonical = encode_canonical_value(payload, MAX_TRANSACTION_ENVELOPE_BYTES)
                .map_err(|_| invalid(index, "person_reach_out_append"))?;
            (
                None,
                None,
                None,
                Some(String::from_utf8(canonical).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
                None,
            )
        }
        "account_upsert" => {
            let payload_object =
                exact_object(payload, &ACCOUNT_UPSERT_PAYLOAD_KEYS, index, "payload")?;
            let account = payload_object
                .get("account")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid(index, "account"))?;
            validate_account(account, &entity_id, index)?;
            let canonical =
                encode_canonical_value(&Value::Object(account.clone()), MAX_ACCOUNT_BYTES)
                    .map_err(|_| invalid(index, "account"))?;
            (
                None,
                None,
                None,
                None,
                Some(String::from_utf8(canonical).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
            )
        }
        "account_person_assignment" => {
            let payload_object = exact_object(
                payload,
                &ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_KEYS,
                index,
                "payload",
            )?;
            safe_integer(payload_object, "assigned_at_ms", index)?;
            match payload_object.get("person_id") {
                Some(Value::Null) => {}
                Some(Value::String(value))
                    if !value.is_empty() && value.len() <= MAX_ENTITY_ID_BYTES => {}
                _ => return Err(invalid(index, "person_id")),
            }
            let canonical = encode_canonical_value(payload, MAX_ACCOUNT_BYTES)
                .map_err(|_| invalid(index, "account_person_assignment"))?;
            (
                None,
                None,
                None,
                None,
                Some(String::from_utf8(canonical).expect("canonical encoder emits UTF-8")),
                None,
                None,
                None,
                None,
                None,
            )
        }
        "rss_feed_remove_keep_items" | "rss_feed_remove_with_items" => {
            let payload_object = exact_object(payload, &REMOVE_PAYLOAD_KEYS, index, "payload")?;
            (
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(safe_integer(payload_object, "removed_at_ms", index)?),
            )
        }
        _ => unreachable!("validated operation type"),
    };
    let payload_digest = required_string(object, "payload_digest", index)?;
    let expected_payload_digest = digest_hex(
        "operation-payload",
        &json!({
            "schema_version": 1,
            "operation_type": operation_type,
            "payload": payload,
        }),
        index,
    )?;
    if payload_digest != expected_payload_digest {
        return Err(invalid(index, "payload_digest"));
    }
    safe_integer(object, "created_at_ms", index)?;
    let previous_actor_chain_digest =
        required_string(object, "previous_actor_chain_digest", index)?;
    let actor_chain_digest = required_string(object, "actor_chain_digest", index)?;
    let transaction_digest = required_string(object, "transaction_digest", index)?;
    let signature = required_string(object, "signature", index)?;

    require_operation_id(&operation_id, index, "operation_id")?;
    require_operation_id(&transaction_id, index, "transaction_id")?;
    require_hex(&library_id, 32, index, "library_id")?;
    require_hex(&epoch_id, 32, index, "epoch_id")?;
    require_hex(&actor_id, 32, index, "actor_id")?;
    require_hex(&payload_digest, 32, index, "payload_digest")?;
    require_hex(
        &previous_actor_chain_digest,
        32,
        index,
        "previous_actor_chain_digest",
    )?;
    require_hex(&actor_chain_digest, 32, index, "actor_chain_digest")?;
    require_hex(&transaction_digest, 32, index, "transaction_digest")?;
    require_hex(&signature, 64, index, "signature")?;

    let mut member_body = object.clone();
    for key in [
        "previous_actor_chain_digest",
        "actor_chain_digest",
        "transaction_digest",
        "signature",
    ] {
        member_body.remove(key);
    }
    let member_body = Value::Object(member_body);
    let member_digest = digest_hex("transaction-member", &member_body, index)?;

    Ok(ParsedEnvelope {
        value,
        operation_id,
        library_id,
        epoch,
        epoch_id,
        actor_id,
        actor_sequence,
        previous_actor_operation_id,
        causal_tips,
        transaction_id,
        transaction_member_index,
        transaction_member_count,
        entity_id,
        entity_type: entity_type.to_owned(),
        operation_type,
        item_json,
        rss_feed_json,
        preferences_patch_json,
        person_json,
        account_json,
        read_at_ms,
        assigned,
        assigned_at_ms,
        synced_at_ms,
        removed_at_ms,
        previous_actor_chain_digest,
        actor_chain_digest,
        transaction_digest,
        signature,
        member_digest,
        canonical_json: std::str::from_utf8(bytes)
            .expect("canonical decoder proved UTF-8")
            .to_owned(),
    })
}

fn verify_operation_transaction_with_verdict<F>(
    canonical_envelopes: &[Vec<u8>],
    actor_lookup: F,
) -> JournalResult<(VerifiedOperationTransaction, OperationAdmissionVerdict)>
where
    F: FnOnce(&OperationIdentity) -> JournalResult<ActorState>,
{
    if canonical_envelopes.is_empty() || canonical_envelopes.len() > MAX_TRANSACTION_MEMBERS {
        return Err(invalid(0, "transaction_members"));
    }
    let total_bytes = canonical_envelopes
        .iter()
        .try_fold(0usize, |total, envelope| total.checked_add(envelope.len()))
        .filter(|total| *total > 0 && *total <= MAX_TRANSACTION_ENVELOPE_BYTES)
        .ok_or_else(|| invalid(0, "canonical_envelope_bytes"))?;

    let mut parsed = Vec::with_capacity(canonical_envelopes.len());
    parsed.push(parse_envelope(&canonical_envelopes[0], 0)?);
    let actor = {
        let first = &parsed[0];
        let actor = actor_lookup(&OperationIdentity {
            library_id: first.library_id.clone(),
            epoch_id: first.epoch_id.clone(),
            actor_id: first.actor_id.clone(),
        })?;
        if actor.library_id != first.library_id
            || actor.epoch != first.epoch
            || actor.epoch_id != first.epoch_id
            || actor.actor_id != first.actor_id
        {
            return Err(invalid(0, "enrolled_actor_identity"));
        }
        actor
    };
    for (index, bytes) in canonical_envelopes.iter().enumerate().skip(1) {
        parsed.push(parse_envelope(bytes, index)?);
    }

    let first = &parsed[0];
    let mut operation_ids = HashSet::with_capacity(parsed.len());
    for (index, member) in parsed.iter().enumerate() {
        let expected_sequence = first
            .actor_sequence
            .checked_add(index as i64)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid(index, "actor_sequence"))?;
        if member.library_id != first.library_id
            || member.epoch != first.epoch
            || member.epoch_id != first.epoch_id
            || member.actor_id != first.actor_id
            || member.transaction_id != first.transaction_id
            || member.transaction_member_count != parsed.len() as i64
            || member.transaction_member_index != index as i64
            || member.actor_sequence != expected_sequence
        {
            return Err(invalid(index, "transaction_identity"));
        }
        if index > 0
            && member.previous_actor_operation_id.as_deref()
                != Some(parsed[index - 1].operation_id.as_str())
        {
            return Err(invalid(index, "previous_actor_operation_id"));
        }
        if !operation_ids.insert(member.operation_id.as_str()) {
            return Err(invalid(index, "operation_id"));
        }
    }

    let member_digests: Vec<Value> = parsed
        .iter()
        .map(|member| Value::String(member.member_digest.clone()))
        .collect();
    let transaction_body = json!({
        "transaction_id": first.transaction_id,
        "transaction_member_count": parsed.len() as i64,
        "actor_id": first.actor_id,
        "initial_previous_actor_operation_id": first.previous_actor_operation_id,
        "initial_previous_actor_chain_digest": first.previous_actor_chain_digest,
        "transaction_member_digests": member_digests,
    });
    let transaction_digest = digest_hex("transaction", &transaction_body, 0)?;

    let mut previous_chain_digest = first.previous_actor_chain_digest.clone();
    let mut verified_members = Vec::with_capacity(parsed.len());
    for (index, member) in parsed.iter().enumerate() {
        if member.previous_actor_chain_digest != previous_chain_digest
            || member.transaction_digest != transaction_digest
        {
            return Err(invalid(index, "transaction_chain"));
        }
        let actor_chain_digest = digest_hex(
            "actor-chain",
            &json!({
                "previous_actor_chain_digest": previous_chain_digest,
                "transaction_member_digest": member.member_digest,
                "transaction_digest": transaction_digest,
            }),
            index,
        )?;
        if member.actor_chain_digest != actor_chain_digest {
            return Err(invalid(index, "actor_chain_digest"));
        }

        let mut signing_body = member
            .value
            .as_object()
            .expect("parser proved object")
            .clone();
        signing_body.remove("signature");
        let signing_body = Value::Object(signing_body);
        let signing_body_digest = digest_hex("operation-signing-body", &signing_body, index)?;
        let signature_input = encode_operation_signature_input(
            &json!({ "operation_signing_body_digest": signing_body_digest }),
            MAX_TRANSACTION_ENVELOPE_BYTES,
        )
        .map_err(|_| invalid(index, "signature_input"))?;
        if !verify_library_core_ed25519(
            &actor.actor_public_key,
            &member.signature,
            &signature_input,
        )
        .map_err(|_| invalid(index, "signature"))?
        {
            return Err(invalid(index, "signature"));
        }
        let envelope_digest = digest_hex("operation-envelope", &member.value, index)?;
        verified_members.push(VerifiedOperation {
            operation_id: member.operation_id.clone(),
            actor_sequence: member.actor_sequence,
            previous_actor_operation_id: member.previous_actor_operation_id.clone(),
            previous_actor_chain_digest: member.previous_actor_chain_digest.clone(),
            actor_chain_digest: actor_chain_digest.clone(),
            member_digest: member.member_digest.clone(),
            signing_body_digest,
            envelope_digest,
            entity_id: member.entity_id.clone(),
            entity_type: member.entity_type.clone(),
            operation_type: member.operation_type.clone(),
            item_json: member.item_json.clone(),
            rss_feed_json: member.rss_feed_json.clone(),
            preferences_patch_json: member.preferences_patch_json.clone(),
            person_json: member.person_json.clone(),
            account_json: member.account_json.clone(),
            read_at_ms: member.read_at_ms,
            assigned: member.assigned,
            assigned_at_ms: member.assigned_at_ms,
            synced_at_ms: member.synced_at_ms,
            removed_at_ms: member.removed_at_ms,
            canonical_envelope_json: member.canonical_json.clone(),
            causal_tips: member.causal_tips.clone(),
        });
        previous_chain_digest = actor_chain_digest;
    }

    let verified = VerifiedOperationTransaction {
        transaction_id: first.transaction_id.clone(),
        transaction_digest,
        library_id: first.library_id.clone(),
        epoch: first.epoch,
        epoch_id: first.epoch_id.clone(),
        actor_id: first.actor_id.clone(),
        actor_capability: actor.capability.clone(),
        canonical_envelope_bytes: total_bytes,
        members: verified_members,
    };
    let verdict = operation_admission_verdict(&actor, &verified);
    Ok((verified, verdict))
}

pub(crate) fn verify_operation_transaction_for_resolution<F>(
    canonical_envelopes: &[Vec<u8>],
    actor_lookup: F,
) -> JournalResult<(VerifiedOperationTransaction, OperationAdmissionVerdict)>
where
    F: FnOnce(&OperationIdentity) -> JournalResult<ActorState>,
{
    verify_operation_transaction_with_verdict(canonical_envelopes, actor_lookup)
}

pub(crate) fn verify_operation_transaction<F>(
    canonical_envelopes: &[Vec<u8>],
    actor_lookup: F,
) -> JournalResult<VerifiedOperationTransaction>
where
    F: FnOnce(&OperationIdentity) -> JournalResult<ActorState>,
{
    let (verified, verdict) =
        verify_operation_transaction_with_verdict(canonical_envelopes, actor_lookup)?;
    match verdict {
        OperationAdmissionVerdict::Admissible => Ok(verified),
        OperationAdmissionVerdict::ActorRetired => Err(invalid(0, "actor_retired")),
        OperationAdmissionVerdict::CapabilityDenied { field } => Err(invalid(0, field)),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::{LibraryCoreJournal, VerifiedActorEnrollment};
    use super::*;
    use crate::library_core_canonical::encode_canonical_value;
    use ring::signature::{Ed25519KeyPair, KeyPair};

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
        super::super::NormalizedAuthorityStateV2,
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
        let authority = super::super::NormalizedAuthorityStateV2 {
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
        let enrollment =
            super::super::enrollment_verifier::verify_actor_enrollment(&certificate, &authority)
                .expect("verify signed v2 enrollment fixture");
        (authority, certificate, enrollment)
    }

    fn signed_v1_enrollment(
        actor_key: &Ed25519KeyPair,
    ) -> (
        super::super::NormalizedAuthorityStateV2,
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
        let enrollment =
            super::super::enrollment_verifier::verify_actor_enrollment(&certificate, &authority)
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
            .install_authority_epoch(&super::super::VerifiedAuthorityEpoch {
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
            .install_authority_epoch(&super::super::VerifiedAuthorityEpoch {
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
            Err(JournalError::OperationVerification { field: "feed", .. })
        ));

        let incomplete = json!({ "url": entity_id, "title": "Example" });
        assert!(matches!(
            validate_rss_feed(incomplete.as_object().expect("object"), entity_id, 0),
            Err(JournalError::OperationVerification { field: "feed", .. })
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
            Err(JournalError::OperationVerification {
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
            Err(JournalError::OperationVerification {
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
            Err(JournalError::StaleAuthority { .. })
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
            Err(JournalError::StaleAuthority { .. })
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
            Err(JournalError::OperationVerification {
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
                Err(JournalError::OperationVerification {
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
            Err(JournalError::OperationVerification {
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
            Err(JournalError::OperationVerification {
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
            Err(JournalError::StaleAuthority { .. })
        ));

        let oversized = vec![Vec::new(); MAX_TRANSACTION_MEMBERS + 1];
        assert!(matches!(
            stale_journal.verify_operation_transaction(&oversized),
            Err(JournalError::OperationVerification {
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
            Err(JournalError::InvalidVerifiedInput {
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
            Err(JournalError::InvalidVerifiedInput {
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
            Err(JournalError::StaleActorTip { actor_id })
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
            Err(JournalError::OperationVerification {
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
            Err(JournalError::OperationVerification {
                index: 0,
                field: "transaction_identity"
            })
        ));
        assert!(matches!(
            journal.verify_operation_transaction(&[
                br#"{"operation_id":"first","operation_id":"second"}"#.to_vec()
            ]),
            Err(JournalError::OperationVerification {
                index: 0,
                field: "canonical_envelope"
            })
        ));
    }
}
