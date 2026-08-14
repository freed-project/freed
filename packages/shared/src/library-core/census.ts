/**
 * The checked-in Library Core inventory distinguishes the active local
 * Desktop engine from the still-incomplete replacement replication protocol.
 *
 * These blockers describe missing executable contracts. They are not a
 * roadmap status and they cannot be cleared by changing this array alone.
 * Activation requires the corresponding implementations, proofs, transition
 * entry, and durable receipts.
 */
export const LIBRARY_CORE_CENSUS_BLOCKERS = [
  "actor_and_global_authority_contracts_unimplemented",
  "authenticated_adopter_pairing_unimplemented",
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
  status: "desktop_sqlite_active_replacement_incomplete",
  activationAllowed: false,
  /**
   * Freed Desktop now imports the legacy library once, then reads, writes, and
   * backs up its local library through native SQLite. Legacy Automerge LAN and
   * cloud replication are disabled while the immutable-object transport and
   * PWA adapter remain incomplete.
   */
  runtimeBehaviorChanged: true,
  runtimeBehaviorChange: "desktop_local_sqlite_import_read_write_backup_cutover",
  activeEngine: "sqlite_desktop_v2",
  replicationProtocol: "replacement_transport_pending",
  legacyEpochBootstrapContract: "closed_dormant_v1",
  legacyEpochBootstrapTrust: "tofu_read_only",
  legacyEpochBootstrapTransactionImplemented: false,
  registrySurfaces: [
    "field",
    "root",
    "operation",
    "query",
    "shared_store",
    "desktop_worker_message",
    "pwa_worker_message",
    "local_authority",
    "legacy_epoch_bootstrap_contract",
  ],
  blockers: LIBRARY_CORE_CENSUS_BLOCKERS,
} as const);
