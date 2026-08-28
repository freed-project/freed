//! Normalized authority identities shared by SQLite protocol operations.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedCausalTipV1 {
    pub actor_id: String,
    pub sequence: i64,
    pub operation_id: String,
    pub chain_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedAuthorityStateV2 {
    pub library_id: String,
    pub epoch: i64,
    pub epoch_id: String,
    pub authority_key_id: String,
    pub authority_public_key: String,
    pub observed_frontier: Vec<NormalizedCausalTipV1>,
}
