/**
 * The checked-in Library Core inventory is deliberately dormant.
 *
 * These blockers describe missing executable contracts. They are not a
 * roadmap status and they cannot be cleared by changing this array alone.
 * Activation requires the corresponding implementations, proofs, transition
 * entry, and durable receipts.
 */
export const LIBRARY_CORE_CENSUS_BLOCKERS = [
  "actor_and_global_authority_contracts_unimplemented",
  "legacy_epoch_bootstrap_transaction_unimplemented",
  "local_authority_retention_and_migration_incomplete",
  "materializers_and_storage_adapters_unimplemented",
  "migration_source_and_frontier_unbound",
  "operation_payload_and_field_algebra_incomplete",
  "query_request_response_and_projection_contracts_incomplete",
  "synchronized_field_semantics_incomplete",
  "worker_surface_cutover_incomplete",
] as const;

export type LibraryCoreCensusBlocker =
  (typeof LIBRARY_CORE_CENSUS_BLOCKERS)[number];

export const LIBRARY_CORE_CENSUS = Object.freeze({
  schemaVersion: 1,
  status: "dormant_incomplete",
  activationAllowed: false,
  runtimeBehaviorChanged: false,
  activeEngine: "automerge_legacy",
  replicationProtocol: "automerge_blob_v1",
  registrySurfaces: [
    "field",
    "root",
    "operation",
    "query",
    "shared_store",
    "desktop_worker_message",
    "pwa_worker_message",
    "local_authority",
  ],
  blockers: LIBRARY_CORE_CENSUS_BLOCKERS,
} as const);
