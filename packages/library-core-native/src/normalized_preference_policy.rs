//! Fresh-write preference policy. Historical signature verification stays separate.
use crate::normalized_operation::VerifiedOperation;
use serde_json::Value;
use std::sync::LazyLock;

static POLICIES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(crate::sqlite_contract_generated::PREFERENCE_WRITE_POLICIES_JSON)
        .expect("generated preference policy is valid JSON")
});

pub(crate) fn supports_fresh_preferences(member: &VerifiedOperation) -> bool {
    if member.operation_type != "preferences_leaf_assignment" {
        return true;
    }
    member
        .structured_payload_json
        .as_deref()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .is_some_and(|value| finite_wrappers(&value) && supports_object("user", &value))
}

// Match the shared reserved shape without interpreting ordinary object values.
pub(crate) fn is_binary64_wrapper(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == 2
            && object.get("codec").and_then(Value::as_str) == Some("ieee754_binary64_hex_v1")
            && object
                .get("bits")
                .and_then(Value::as_str)
                .is_some_and(|bits| {
                    bits.len() == 16
                        && bits
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                })
    })
}
fn wire_number(value: &Value) -> bool {
    value.is_number()
        || is_binary64_wrapper(value)
            && crate::normalized_checkpoint::decode_binary64_wrapper(value).is_ok()
}
fn finite_wrappers(value: &Value) -> bool {
    if is_binary64_wrapper(value) {
        return wire_number(value);
    }
    match value {
        Value::Array(values) => values.iter().all(finite_wrappers),
        Value::Object(values) => values.values().all(finite_wrappers),
        _ => true,
    }
}

// The shared sanitizer's output must equal its input. Check that condition
// without copying values or silently dropping unsupported keys or array members.
fn supports_object(policy: &str, value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object
        .iter()
        .all(|(key, value)| match POLICIES[policy][key].as_str() {
            Some("sync") => true,
            Some("nested") => supports_nested(policy, key, value),
            _ => false,
        })
}

fn every_record(value: &Value, test: impl Fn(&Value) -> bool) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.values().all(test))
}
fn string_array(value: &Value) -> bool {
    value
        .as_array()
        .is_some_and(|array| array.iter().all(Value::is_string))
}
fn supports_nested(policy: &str, key: &str, value: &Value) -> bool {
    match (policy, key) {
        ("user", "fbCapture") => supports_object("facebookCapture", value),
        ("user", child) => supports_object(child, value),
        ("display", "reading") => supports_object("reading", value),
        ("storyWall", "style") => supports_object("storyWallStyle", value),
        ("storyWall", "publishTarget") => supports_object("storyWallPublishTarget", value),
        ("weights", "platforms" | "topics" | "authors") => every_record(value, wire_number),
        ("ulysses", "allowedPaths") => every_record(value, string_array),
        ("facebookCapture", "excludedGroupIds") => {
            every_record(value, |entry| entry == &Value::Bool(true))
        }
        ("xCapture", "whitelist" | "blacklist") => {
            every_record(value, |entry| supports_object("xAccount", entry))
        }
        ("storyWall", "selectedYears") => value
            .as_array()
            .is_some_and(|array| array.iter().all(wire_number)),
        ("ulysses", "blockedPlatforms")
        | ("friendSuggestions", "dismissedSuggestionIds")
        | (
            "storyWall",
            "includedPlatforms" | "includedAccountIds" | "featuredItemIds" | "hiddenItemIds",
        ) => string_array(value),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_preference_policy_matches_shared_sanitizer_vectors() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/preference-write-policy-vector-v1.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                finite_wrappers(&case["updates"]) && supports_object("user", &case["updates"]),
                case["supported"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
}
