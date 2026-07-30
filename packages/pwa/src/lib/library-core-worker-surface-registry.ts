import type { WorkerRequest, WorkerResponse } from "./automerge-types";
import type { LibraryCoreOperationId } from "@freed/shared/library-core";

export type PwaAutomergeWorkerRequestKind = WorkerRequest["type"];
export type PwaAutomergeWorkerResponseKind = WorkerResponse["type"];

export type LibraryCoreWorkerSurfaceClassification =
  | "diagnostic_transport"
  | "library_core_bounded_read"
  | "library_core_bounded_transport"
  | "library_core_lifecycle_control"
  | "library_core_local_projection"
  | "legacy_bulk_or_repair_authority"
  | "legacy_full_state_transport"
  | "legacy_lifecycle_control"
  | "legacy_mutation_authority"
  | "legacy_progress_transport"
  | "legacy_provider_receipt_authority"
  | "legacy_replication_authority"
  | "legacy_unbounded_read"
  | "legacy_unbounded_transport"
  | "mutation_acknowledgement";

export type LibraryCoreWorkerSurfaceBlocker =
  | "hidden_legacy_write_contract_unresolved"
  | "legacy_authority_active"
  | "library_core_runtime_inactive"
  | "lifecycle_contract_unresolved"
  | "local_authority_reset_contract_unresolved"
  | "provider_intent_execution_receipt_unresolved"
  | "provider_intent_separation_unresolved"
  | "query_contract_unresolved"
  | "replication_contract_unresolved"
  | "response_transport_not_cut_over"
  | "successor_contract_unresolved"
  | "unbounded_payload";

type NonEmptyWorkerSurfaceBlockers = readonly [
  LibraryCoreWorkerSurfaceBlocker,
  ...LibraryCoreWorkerSurfaceBlocker[],
];

export interface LibraryCoreWorkerSurfaceDefinition {
  readonly status: "planned_blocked";
  readonly classification: LibraryCoreWorkerSurfaceClassification;
  readonly blockers: NonEmptyWorkerSurfaceBlockers;
}

function blockedSurface(
  classification: LibraryCoreWorkerSurfaceClassification,
  ...blockers: readonly LibraryCoreWorkerSurfaceBlocker[]
): LibraryCoreWorkerSurfaceDefinition {
  return {
    status: "planned_blocked",
    classification,
    blockers: ["library_core_runtime_inactive", ...blockers],
  };
}

const lifecycleRequest = () =>
  blockedSurface("legacy_lifecycle_control", "lifecycle_contract_unresolved");
const mutationRequest = () =>
  blockedSurface(
    "legacy_mutation_authority",
    "legacy_authority_active",
    "successor_contract_unresolved",
    "unbounded_payload",
  );
const bulkOrRepairRequest = () =>
  blockedSurface(
    "legacy_bulk_or_repair_authority",
    "legacy_authority_active",
    "successor_contract_unresolved",
    "unbounded_payload",
  );
const providerReceiptRequest = () =>
  blockedSurface(
    "legacy_provider_receipt_authority",
    "legacy_authority_active",
    "provider_intent_execution_receipt_unresolved",
    "unbounded_payload",
  );
const providerSeenMutationRequest = (bulk: boolean) =>
  blockedSurface(
    bulk
      ? "legacy_bulk_or_repair_authority"
      : "legacy_mutation_authority",
    "legacy_authority_active",
    "successor_contract_unresolved",
    "unbounded_payload",
    "provider_intent_separation_unresolved",
    "provider_intent_execution_receipt_unresolved",
  );
const unboundedReadRequest = () =>
  blockedSurface(
    "legacy_unbounded_read",
    "query_contract_unresolved",
    "unbounded_payload",
  );

/**
 * Compile-time census of the current PWA Automerge request boundary.
 *
 * This registry is deliberately dormant. `satisfies Record<...>` makes a new
 * discriminant fail typecheck until it is classified, but no entry grants
 * Library Core authority or changes worker dispatch.
 */
export const PWA_AUTOMERGE_WORKER_REQUEST_SURFACE_REGISTRY = {
  INIT: blockedSurface(
    "legacy_lifecycle_control",
    "lifecycle_contract_unresolved",
    "hidden_legacy_write_contract_unresolved",
  ),
  QUIESCE: lifecycleRequest(),
  MARK_AS_READ: providerSeenMutationRequest(false),
  MARK_ITEMS_AS_READ: providerSeenMutationRequest(true),
  MARK_ALL_AS_READ: providerSeenMutationRequest(true),
  TOGGLE_SAVED: mutationRequest(),
  TOGGLE_ARCHIVED: mutationRequest(),
  ARCHIVE_ITEMS: bulkOrRepairRequest(),
  TOGGLE_LIKED: blockedSurface(
    "legacy_mutation_authority",
    "legacy_authority_active",
    "successor_contract_unresolved",
    "provider_intent_separation_unresolved",
    "provider_intent_execution_receipt_unresolved",
    "unbounded_payload",
  ),
  CONFIRM_LIKED_SYNCED: providerReceiptRequest(),
  CONFIRM_SEEN_SYNCED: providerReceiptRequest(),
  ADD_FEED_ITEM: mutationRequest(),
  ADD_FEED_ITEMS: bulkOrRepairRequest(),
  ADD_SAMPLE_LIBRARY_DATA: bulkOrRepairRequest(),
  REMOVE_FEED_ITEM: mutationRequest(),
  CLEAR_SAMPLE_DATA: bulkOrRepairRequest(),
  UPDATE_FEED_ITEM: mutationRequest(),
  ARCHIVE_ALL_READ_UNSAVED: bulkOrRepairRequest(),
  UNARCHIVE_SAVED_ITEMS: bulkOrRepairRequest(),
  PRUNE_ARCHIVED_ITEMS: bulkOrRepairRequest(),
  DELETE_ALL_ARCHIVED: bulkOrRepairRequest(),
  ADD_RSS_FEED: mutationRequest(),
  REMOVE_RSS_FEED: mutationRequest(),
  UPDATE_RSS_FEED: mutationRequest(),
  REMOVE_ALL_FEEDS: bulkOrRepairRequest(),
  UPDATE_PREFERENCES: mutationRequest(),
  ADD_PERSON: mutationRequest(),
  ADD_PERSONS: bulkOrRepairRequest(),
  UPDATE_PERSON: mutationRequest(),
  UPSERT_CONNECTION_PERSONS: bulkOrRepairRequest(),
  REMOVE_PERSON: mutationRequest(),
  LOG_REACH_OUT: mutationRequest(),
  ADD_ACCOUNT: mutationRequest(),
  ADD_ACCOUNTS: bulkOrRepairRequest(),
  UPDATE_ACCOUNT: mutationRequest(),
  REMOVE_ACCOUNT: mutationRequest(),
  ADD_STUB_ITEM: mutationRequest(),
  BACKFILL_CONTENT_SIGNALS: bulkOrRepairRequest(),
  MERGE_DOC: blockedSurface(
    "legacy_replication_authority",
    "legacy_authority_active",
    "replication_contract_unresolved",
    "hidden_legacy_write_contract_unresolved",
    "unbounded_payload",
  ),
  GET_COMMITTED_DOC: unboundedReadRequest(),
  GET_DOC_BINARY: unboundedReadRequest(),
  GET_HEADS: unboundedReadRequest(),
  COMPARE_DOC: unboundedReadRequest(),
  GET_ITEM_LEGACY_HTML: unboundedReadRequest(),
  MATERIALIZE_LIBRARY_CORE_FEED_GENERATION: blockedSurface(
    "library_core_local_projection",
    "response_transport_not_cut_over",
  ),
  MATERIALIZE_LIBRARY_CORE_FEED_BROWSE_GENERATION: blockedSurface(
    "library_core_local_projection",
    "response_transport_not_cut_over",
  ),
  READ_LIBRARY_CORE_FEED_PAGE: blockedSurface(
    "library_core_bounded_read",
    "response_transport_not_cut_over",
  ),
  CANCEL_LIBRARY_CORE_FEED_READER: blockedSurface(
    "library_core_lifecycle_control",
    "response_transport_not_cut_over",
  ),
  CLEAR_LOCAL: blockedSurface(
    "legacy_lifecycle_control",
    "lifecycle_contract_unresolved",
    "local_authority_reset_contract_unresolved",
  ),
} as const satisfies Readonly<
  Record<PwaAutomergeWorkerRequestKind, LibraryCoreWorkerSurfaceDefinition>
>;

type NonEmptyOperationIds = readonly [
  LibraryCoreOperationId,
  ...LibraryCoreOperationId[],
];

export type PwaLegacyWriteEffect =
  | "legacy_document_broadcast"
  | "legacy_document_merge"
  | "legacy_document_persistence"
  | "legacy_identity_migration"
  | "legacy_local_authority_reset"
  | "legacy_operation_write"
  | "legacy_runtime_state_write"
  | "legacy_schema_migration";

interface PwaRequestEffectDefinition {
  readonly legacyWriteEffects: readonly PwaLegacyWriteEffect[];
  readonly libraryCoreWriteEffects:
    | readonly []
    | readonly ["library_core_projection_generation_write"];
  readonly successorOperationIds:
    | readonly []
    | NonEmptyOperationIds;
  readonly blockers: readonly LibraryCoreWorkerSurfaceBlocker[];
}

const noWriteEffect = (): PwaRequestEffectDefinition => ({
  legacyWriteEffects: [],
  libraryCoreWriteEffects: [],
  successorOperationIds: [],
  blockers: [],
});

const operationWrite = (
  ...successorOperationIds: NonEmptyOperationIds
): PwaRequestEffectDefinition => ({
  legacyWriteEffects: ["legacy_operation_write"],
  libraryCoreWriteEffects: [],
  successorOperationIds,
  blockers: [],
});

const hiddenWrite = (
  legacyWriteEffects: readonly PwaLegacyWriteEffect[],
  blockers: readonly LibraryCoreWorkerSurfaceBlocker[],
): PwaRequestEffectDefinition => ({
  legacyWriteEffects,
  libraryCoreWriteEffects: [],
  successorOperationIds: [],
  blockers,
});

const libraryCoreProjectionWrite = (): PwaRequestEffectDefinition => ({
  legacyWriteEffects: [],
  libraryCoreWriteEffects: ["library_core_projection_generation_write"],
  successorOperationIds: [],
  blockers: ["response_transport_not_cut_over"],
});

/**
 * Typed effect coverage for every current PWA worker request.
 *
 * This registry is intentionally independent of request classification.
 * Initialization and replication can still migrate and persist the legacy
 * document, so every discriminant declares its concrete write effects,
 * dormant successors, or an explicit unresolved blocker.
 */
export const PWA_AUTOMERGE_REQUEST_EFFECT_REGISTRY = {
  INIT: hiddenWrite(
    [
      "legacy_schema_migration",
      "legacy_identity_migration",
      "legacy_document_persistence",
      "legacy_document_broadcast",
    ],
    ["hidden_legacy_write_contract_unresolved"],
  ),
  QUIESCE: hiddenWrite(
    ["legacy_runtime_state_write"],
    ["lifecycle_contract_unresolved"],
  ),
  MARK_AS_READ: operationWrite(
    "feed_item_read_assignment",
    "provider_intent",
  ),
  MARK_ITEMS_AS_READ: operationWrite(
    "feed_items_read_frozen",
    "provider_intent",
  ),
  MARK_ALL_AS_READ: operationWrite(
    "feed_items_read_frozen",
    "provider_intent",
  ),
  TOGGLE_SAVED: operationWrite("feed_item_saved_assignment"),
  TOGGLE_ARCHIVED: operationWrite("feed_item_archive_assignment"),
  ARCHIVE_ITEMS: operationWrite("feed_items_archive_frozen"),
  TOGGLE_LIKED: operationWrite(
    "feed_item_like_assignment",
    "provider_intent",
  ),
  CONFIRM_LIKED_SYNCED: operationWrite("feed_item_like_sync_receipt"),
  CONFIRM_SEEN_SYNCED: operationWrite("feed_item_seen_sync_receipt"),
  ADD_FEED_ITEM: operationWrite("feed_item_capture_upsert"),
  ADD_FEED_ITEMS: operationWrite("feed_item_capture_upsert"),
  ADD_SAMPLE_LIBRARY_DATA: operationWrite("sample_library_import"),
  REMOVE_FEED_ITEM: operationWrite("feed_item_remove"),
  CLEAR_SAMPLE_DATA: operationWrite("sample_library_remove"),
  UPDATE_FEED_ITEM: operationWrite("feed_item_capture_upsert"),
  ARCHIVE_ALL_READ_UNSAVED: operationWrite(
    "feed_items_archive_read_unsaved_frozen",
  ),
  UNARCHIVE_SAVED_ITEMS: operationWrite(
    "feed_items_unarchive_saved_frozen",
  ),
  PRUNE_ARCHIVED_ITEMS: operationWrite(
    "feed_items_prune_archived_frozen",
  ),
  DELETE_ALL_ARCHIVED: operationWrite(
    "feed_items_delete_archived_frozen",
  ),
  ADD_RSS_FEED: operationWrite("rss_feed_upsert"),
  REMOVE_RSS_FEED: operationWrite(
    "rss_feed_remove_keep_items",
    "rss_feed_remove_with_items",
  ),
  UPDATE_RSS_FEED: operationWrite(
    "rss_feed_title_assignment",
    "rss_feed_upsert",
  ),
  REMOVE_ALL_FEEDS: operationWrite(
    "rss_feeds_remove_keep_items",
    "rss_feeds_remove_with_items",
  ),
  UPDATE_PREFERENCES: operationWrite("preferences_leaf_assignment"),
  ADD_PERSON: operationWrite("person_upsert"),
  ADD_PERSONS: operationWrite("person_upsert"),
  UPDATE_PERSON: operationWrite("person_upsert"),
  UPSERT_CONNECTION_PERSONS: operationWrite(
    "account_person_assignment",
    "account_upsert",
    "person_upsert",
  ),
  REMOVE_PERSON: operationWrite("person_remove_and_accounts"),
  LOG_REACH_OUT: operationWrite("person_reach_out_append"),
  ADD_ACCOUNT: operationWrite("account_upsert"),
  ADD_ACCOUNTS: operationWrite("account_upsert"),
  UPDATE_ACCOUNT: operationWrite(
    "account_person_assignment",
    "account_upsert",
  ),
  REMOVE_ACCOUNT: operationWrite("account_remove"),
  ADD_STUB_ITEM: operationWrite("feed_item_capture_upsert"),
  BACKFILL_CONTENT_SIGNALS: operationWrite(
    "feed_items_content_signals_backfill_frozen",
  ),
  MERGE_DOC: hiddenWrite(
    [
      "legacy_document_merge",
      "legacy_schema_migration",
      "legacy_identity_migration",
      "legacy_document_persistence",
      "legacy_document_broadcast",
    ],
    [
      "hidden_legacy_write_contract_unresolved",
      "replication_contract_unresolved",
    ],
  ),
  GET_COMMITTED_DOC: noWriteEffect(),
  GET_DOC_BINARY: noWriteEffect(),
  GET_HEADS: noWriteEffect(),
  COMPARE_DOC: noWriteEffect(),
  GET_ITEM_LEGACY_HTML: noWriteEffect(),
  MATERIALIZE_LIBRARY_CORE_FEED_GENERATION: libraryCoreProjectionWrite(),
  MATERIALIZE_LIBRARY_CORE_FEED_BROWSE_GENERATION:
    libraryCoreProjectionWrite(),
  READ_LIBRARY_CORE_FEED_PAGE: noWriteEffect(),
  CANCEL_LIBRARY_CORE_FEED_READER: noWriteEffect(),
  CLEAR_LOCAL: hiddenWrite(
    ["legacy_local_authority_reset"],
    ["local_authority_reset_contract_unresolved"],
  ),
} as const satisfies Readonly<
  Record<PwaAutomergeWorkerRequestKind, PwaRequestEffectDefinition>
>;

/**
 * Compile-time census of the current PWA Automerge response boundary. These
 * classifications describe legacy transports only.
 */
export const PWA_AUTOMERGE_WORKER_RESPONSE_SURFACE_REGISTRY = {
  ACK: blockedSurface(
    "mutation_acknowledgement",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  STATE_UPDATE: blockedSurface(
    "legacy_full_state_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  DOC_BINARY: blockedSurface(
    "legacy_unbounded_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  COMMITTED_DOC: blockedSurface(
    "legacy_unbounded_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  DOC_HEADS: blockedSurface(
    "legacy_unbounded_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  DOC_RELATIONSHIP: blockedSurface(
    "legacy_unbounded_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  ITEM_LEGACY_HTML: blockedSurface(
    "legacy_unbounded_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  LIBRARY_CORE_FEED_GENERATION_RESULT: blockedSurface(
    "library_core_bounded_transport",
    "response_transport_not_cut_over",
  ),
  LIBRARY_CORE_FEED_BROWSE_GENERATION_RESULT: blockedSurface(
    "library_core_bounded_transport",
    "response_transport_not_cut_over",
  ),
  LIBRARY_CORE_FEED_PAGE_RESULT: blockedSurface(
    "library_core_bounded_transport",
    "response_transport_not_cut_over",
  ),
  LIBRARY_CORE_FEED_READER_CANCEL_RESULT: blockedSurface(
    "library_core_lifecycle_control",
    "response_transport_not_cut_over",
  ),
  INIT_STATS: blockedSurface(
    "diagnostic_transport",
    "response_transport_not_cut_over",
  ),
  DEBUG_EVENT: blockedSurface(
    "diagnostic_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  DEBUG_SNAPSHOT: blockedSurface(
    "diagnostic_transport",
    "response_transport_not_cut_over",
    "unbounded_payload",
  ),
  CONTENT_SIGNAL_BACKFILL_RESULT: blockedSurface(
    "legacy_progress_transport",
    "response_transport_not_cut_over",
  ),
  SAMPLE_DATA_CLEAR_RESULT: blockedSurface(
    "legacy_progress_transport",
    "response_transport_not_cut_over",
  ),
  READY: blockedSurface(
    "legacy_lifecycle_control",
    "lifecycle_contract_unresolved",
  ),
} as const satisfies Readonly<
  Record<PwaAutomergeWorkerResponseKind, LibraryCoreWorkerSurfaceDefinition>
>;
