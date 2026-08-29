//! Sealed native operation identities for normalized SQLite authority.

use crate::library_core_actor_capability::ActorCapabilityState;
use crate::normalized_authority::NormalizedCausalTipV1;

#[derive(Debug, Clone, PartialEq)]
pub struct ActorState {
    pub library_id: String,
    pub epoch: i64,
    pub epoch_id: String,
    pub actor_id: String,
    pub actor_public_key: String,
    pub enrollment_operation_id: String,
    pub enrollment_certificate_digest: String,
    pub canonical_enrollment_certificate_json: String,
    pub actor_chain_genesis: String,
    pub next_sequence: i64,
    pub previous_operation_id: Option<String>,
    pub previous_chain_digest: String,
    pub(crate) retired: bool,
    pub(crate) capability: ActorCapabilityState,
}

#[derive(Debug, Clone)]
pub(crate) struct VerifiedActorEnrollment {
    pub(crate) library_id: String,
    pub(crate) epoch: i64,
    pub(crate) epoch_id: String,
    pub(crate) actor_id: String,
    pub(crate) actor_public_key: String,
    pub(crate) enrollment_operation_id: String,
    pub(crate) enrollment_certificate_digest: String,
    pub(crate) canonical_enrollment_certificate_json: String,
    pub(crate) actor_chain_genesis: String,
    pub(crate) enrolled_at_ms: i64,
    pub(crate) capability: ActorCapabilityState,
}

#[derive(Debug, Clone)]
pub(crate) struct VerifiedOperation {
    pub(crate) operation_id: String,
    pub(crate) actor_sequence: i64,
    pub(crate) previous_actor_operation_id: Option<String>,
    pub(crate) previous_actor_chain_digest: String,
    pub(crate) actor_chain_digest: String,
    pub(crate) member_digest: String,
    pub(crate) signing_body_digest: String,
    pub(crate) envelope_digest: String,
    pub(crate) entity_id: String,
    pub(crate) entity_type: String,
    pub(crate) operation_type: String,
    pub(crate) created_at_ms: i64,
    pub(crate) item_json: Option<String>,
    pub(crate) rss_feed_json: Option<String>,
    pub(crate) structured_payload_json: Option<String>,
    pub(crate) person_json: Option<String>,
    pub(crate) account_json: Option<String>,
    pub(crate) read_at_ms: Option<i64>,
    pub(crate) assigned: Option<bool>,
    pub(crate) assigned_at_ms: Option<i64>,
    pub(crate) synced_at_ms: Option<i64>,
    pub(crate) removed_at_ms: Option<i64>,
    pub(crate) canonical_envelope_json: String,
    pub(crate) causal_tips: Vec<NormalizedCausalTipV1>,
}

#[derive(Debug, Clone)]
pub(crate) struct VerifiedOperationTransaction {
    pub(crate) transaction_id: String,
    pub(crate) transaction_digest: String,
    pub(crate) library_id: String,
    pub(crate) epoch: i64,
    pub(crate) epoch_id: String,
    pub(crate) actor_id: String,
    pub(crate) actor_capability: ActorCapabilityState,
    pub(crate) canonical_envelope_bytes: usize,
    pub(crate) members: Vec<VerifiedOperation>,
}
