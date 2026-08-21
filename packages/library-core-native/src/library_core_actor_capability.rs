//! Closed actor capability policy shared by enrollment and operation checks.
//!
//! The operation lists are generated from the executable SQLite contract for
//! both Rust and TypeScript. A v1 actor receives only the frozen legacy-editor list. A v2
//! actor must name every allowed operation and an explicit scope. Bounded
//! scopes remain unusable until an operation envelope carries a canonical
//! scope binding. Nothing infers provider or source authority from payloads.

use crate::sqlite_contract_generated::{
    CAPABILITY_OPERATION_IDS, LEGACY_EDITOR_OPERATION_IDS, PRIMARY_WRITER_OPERATION_IDS,
    SCRAPER_OPERATION_IDS,
};

pub(super) const fn canonical_operation_types() -> &'static [&'static str] {
    CAPABILITY_OPERATION_IDS
}

pub(crate) const fn legacy_editor_operation_types() -> &'static [&'static str] {
    LEGACY_EDITOR_OPERATION_IDS
}

pub(crate) const fn primary_writer_operation_types() -> &'static [&'static str] {
    PRIMARY_WRITER_OPERATION_IDS
}

pub(super) const fn scraper_operation_types() -> &'static [&'static str] {
    SCRAPER_OPERATION_IDS
}

pub(super) fn is_registered_operation(operation: &str) -> bool {
    canonical_operation_types()
        .binary_search(&operation)
        .is_ok()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ActorCapabilityScope {
    LegacyEditor,
    LibraryWide,
    Bounded { kind: String, scope_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActorCapabilityState {
    pub(super) certificate_version: i64,
    pub(super) actor_class: String,
    pub(super) allowed_operation_types: Vec<String>,
    pub(super) scope: ActorCapabilityScope,
    pub(super) issuance_identity: Option<String>,
    pub(super) retirement_identity: Option<String>,
    pub(super) capability_certificate_digest: String,
    pub(super) issued_at_ms: i64,
    pub(super) retired: bool,
    pub(super) retirement_certificate_digest: Option<String>,
}

impl ActorCapabilityState {
    pub(super) fn legacy_editor(certificate_digest: String, issued_at_ms: i64) -> Self {
        Self {
            certificate_version: 1,
            actor_class: "legacy_editor".to_owned(),
            allowed_operation_types: legacy_editor_operation_types()
                .iter()
                .map(|operation| (*operation).to_owned())
                .collect(),
            scope: ActorCapabilityScope::LegacyEditor,
            issuance_identity: None,
            retirement_identity: None,
            capability_certificate_digest: certificate_digest,
            issued_at_ms,
            retired: false,
            retirement_certificate_digest: None,
        }
    }

    pub(super) fn allows_operation(&self, operation: &str) -> bool {
        if self.retired || matches!(self.scope, ActorCapabilityScope::Bounded { .. }) {
            return false;
        }
        self.allowed_operation_types
            .binary_search_by(|candidate| candidate.as_str().cmp(operation))
            .is_ok()
    }

    pub(super) fn allowed_operation_types_json(&self) -> String {
        serde_json::to_string(&self.allowed_operation_types)
            .expect("validated actor capability operations serialize")
    }

    pub(super) fn stored_scope(&self) -> (&str, Option<&str>, Option<&str>) {
        match &self.scope {
            ActorCapabilityScope::LegacyEditor => ("legacy_editor", None, None),
            ActorCapabilityScope::LibraryWide => ("library_wide", None, None),
            ActorCapabilityScope::Bounded { kind, scope_id } => {
                ("bounded", Some(kind.as_str()), Some(scope_id.as_str()))
            }
        }
    }
}

pub(super) fn validate_allowed_operation_types(
    actor_class: &str,
    operations: &[String],
) -> Result<(), &'static str> {
    if operations.is_empty()
        || operations.len() > canonical_operation_types().len()
        || !operations.windows(2).all(|pair| pair[0] < pair[1])
        || operations
            .iter()
            .any(|operation| !is_registered_operation(operation))
    {
        return Err("allowed_operation_types");
    }
    if actor_class == "scraper"
        && operations.iter().any(|operation| {
            scraper_operation_types()
                .binary_search(&operation.as_str())
                .is_err()
        })
    {
        return Err("allowed_operation_types");
    }
    Ok(())
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn parse_stored_capability(
    certificate_version: i64,
    actor_class: String,
    allowed_operation_types_json: String,
    scope_mode: String,
    scope_kind: Option<String>,
    scope_id: Option<String>,
    issuance_identity: Option<String>,
    retirement_identity: Option<String>,
    capability_certificate_digest: String,
    issued_at_ms: i64,
    retired: i64,
    retirement_certificate_digest: Option<String>,
) -> Result<ActorCapabilityState, &'static str> {
    let allowed_operation_types: Vec<String> = serde_json::from_str(&allowed_operation_types_json)
        .map_err(|_| "allowed_operation_types")?;
    if serde_json::to_string(&allowed_operation_types).map_err(|_| "allowed_operation_types")?
        != allowed_operation_types_json
    {
        return Err("allowed_operation_types");
    }
    validate_allowed_operation_types(&actor_class, &allowed_operation_types)?;
    if !is_lower_hex_64(&capability_certificate_digest)
        || !(0..=9_007_199_254_740_991).contains(&issued_at_ms)
        || !matches!(retired, 0 | 1)
        || retirement_certificate_digest
            .as_deref()
            .is_some_and(|digest| !is_lower_hex_64(digest))
        || (retired == 1) != retirement_certificate_digest.is_some()
    {
        return Err("capability_state");
    }
    let scope = match (
        certificate_version,
        actor_class.as_str(),
        scope_mode.as_str(),
        scope_kind,
        scope_id,
        issuance_identity.as_deref(),
        retirement_identity.as_deref(),
    ) {
        (1, "legacy_editor", "legacy_editor", None, None, None, None)
            if allowed_operation_types
                .iter()
                .map(String::as_str)
                .eq(legacy_editor_operation_types().iter().copied()) =>
        {
            ActorCapabilityScope::LegacyEditor
        }
        (
            2,
            "editor" | "scraper" | "agent",
            "library_wide",
            None,
            None,
            Some(issuance),
            Some(retirement),
        ) if is_lower_hex_64(issuance) && is_lower_hex_64(retirement) => {
            ActorCapabilityScope::LibraryWide
        }
        (
            2,
            "editor" | "scraper" | "agent",
            "bounded",
            Some(kind),
            Some(scope_id),
            Some(issuance),
            Some(retirement),
        ) if matches!(kind.as_str(), "provider" | "source")
            && !scope_id.is_empty()
            && scope_id.len() <= 4_096
            && is_lower_hex_64(issuance)
            && is_lower_hex_64(retirement) =>
        {
            ActorCapabilityScope::Bounded { kind, scope_id }
        }
        _ => return Err("capability_state"),
    };
    Ok(ActorCapabilityState {
        certificate_version,
        actor_class,
        allowed_operation_types,
        scope,
        issuance_identity,
        retirement_identity,
        capability_certificate_digest,
        issued_at_ms,
        retired: retired == 1,
        retirement_certificate_digest,
    })
}

pub(super) fn validate_capability_state(
    capability: &ActorCapabilityState,
) -> Result<(), &'static str> {
    let (scope_mode, scope_kind, scope_id) = capability.stored_scope();
    parse_stored_capability(
        capability.certificate_version,
        capability.actor_class.clone(),
        capability.allowed_operation_types_json(),
        scope_mode.to_owned(),
        scope_kind.map(str::to_owned),
        scope_id.map(str::to_owned),
        capability.issuance_identity.clone(),
        capability.retirement_identity.clone(),
        capability.capability_certificate_digest.clone(),
        capability.issued_at_ms,
        i64::from(capability.retired),
        capability.retirement_certificate_digest.clone(),
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_registry_is_sorted_and_legacy_policy_cannot_grow_implicitly() {
        assert_eq!(canonical_operation_types().len(), 18);
        assert_eq!(
            legacy_editor_operation_types(),
            [
                "account_remove",
                "account_upsert",
                "feed_item_archive_assignment",
                "feed_item_capture_upsert",
                "feed_item_like_assignment",
                "feed_item_read_assignment",
                "feed_item_remove",
                "feed_item_saved_assignment",
                "person_remove_and_accounts",
                "person_upsert",
                "preferences_leaf_assignment",
                "rss_feed_remove_keep_items",
                "rss_feed_remove_with_items",
                "rss_feed_upsert",
            ]
        );
        assert_eq!(primary_writer_operation_types().len(), 18);
        assert!(primary_writer_operation_types().contains(&"person_reach_out_append"));
        assert!(!legacy_editor_operation_types().contains(&"person_reach_out_append"));
        assert!(primary_writer_operation_types().contains(&"person_remove_detach_accounts"));
        assert!(!legacy_editor_operation_types().contains(&"person_remove_detach_accounts"));
        assert!(primary_writer_operation_types().contains(&"rss_feed_title_assignment"));
        assert!(!legacy_editor_operation_types().contains(&"rss_feed_title_assignment"));
        assert_eq!(scraper_operation_types(), ["feed_item_capture_upsert"]);
        assert!(!is_registered_operation("future_operation"));
        assert!(!legacy_editor_operation_types().contains(&"future_operation"));
        assert!(!scraper_operation_types().contains(&"future_operation"));
    }

    #[test]
    fn bounded_and_retired_capabilities_never_authorize_an_operation() {
        let mut capability = ActorCapabilityState {
            certificate_version: 2,
            actor_class: "agent".to_owned(),
            allowed_operation_types: vec!["feed_item_read_assignment".to_owned()],
            scope: ActorCapabilityScope::Bounded {
                kind: "provider".to_owned(),
                scope_id: "instagram".to_owned(),
            },
            issuance_identity: Some("1".repeat(64)),
            retirement_identity: Some("2".repeat(64)),
            capability_certificate_digest: "3".repeat(64),
            issued_at_ms: 1,
            retired: false,
            retirement_certificate_digest: None,
        };
        assert!(!capability.allows_operation("feed_item_read_assignment"));
        capability.scope = ActorCapabilityScope::LibraryWide;
        capability.retired = true;
        capability.retirement_certificate_digest = Some("4".repeat(64));
        assert!(!capability.allows_operation("feed_item_read_assignment"));
    }
}
