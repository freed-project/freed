import type { BaseAppState } from "../store-types.js";
import { LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY } from "./field-registry.js";
import {
  FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA,
  type LibraryCoreOperationPayloadSchema,
} from "./operation-payload-contracts.js";
import type { LibraryCoreEntity } from "./protocol-registry.js";
import {
  LIBRARY_CORE_ENTITY_ID_CODEC_V1,
  type LibraryCoreEntityIdCodec,
} from "./protocol-scalars.js";

export type BaseAppFunctionKey = {
  [Key in keyof BaseAppState]-?: NonNullable<BaseAppState[Key]> extends (
    ...args: never[]
  ) => unknown
    ? Key
    : never;
}[keyof BaseAppState];

export const LIBRARY_CORE_MAX_TRANSACTION_MEMBERS = 1_000;
export const LIBRARY_CORE_MAX_CANONICAL_TRANSACTION_BYTES = 4_194_304;

export const LIBRARY_CORE_OPERATION_IDS = [
  "account_person_assignment",
  "account_remove",
  "account_restore",
  "account_upsert",
  "feed_item_archive_assignment",
  "feed_item_capture_upsert",
  "feed_item_like_assignment",
  "feed_item_like_sync_receipt",
  "feed_item_read_assignment",
  "feed_item_remove",
  "feed_item_restore",
  "feed_item_saved_assignment",
  "feed_item_seen_sync_receipt",
  "feed_items_archive_frozen",
  "feed_items_archive_read_unsaved_frozen",
  "feed_items_content_signals_backfill_frozen",
  "feed_items_deduplicate_frozen",
  "feed_items_delete_archived_frozen",
  "feed_items_prune_archived_frozen",
  "feed_items_read_frozen",
  "feed_items_unarchive_saved_frozen",
  "person_reach_out_append",
  "person_remove_and_accounts",
  "person_remove_detach_accounts",
  "person_restore",
  "person_upsert",
  "preferences_leaf_assignment",
  "provider_capture_snapshot_reconcile",
  "provider_intent",
  "rss_feed_remove_keep_items",
  "rss_feed_remove_with_items",
  "rss_feed_restore",
  "rss_feed_title_assignment",
  "rss_feed_upsert",
  "rss_feeds_heal_untitled_frozen",
  "rss_feeds_remove_keep_items",
  "rss_feeds_remove_with_items",
  "sample_library_import",
  "sample_library_remove",
] as const;

export type LibraryCoreOperationId = (typeof LIBRARY_CORE_OPERATION_IDS)[number];

export type LibraryCoreOperationEntity =
  | LibraryCoreEntity
  | "ProviderCaptureSnapshot"
  | "ProviderIntent"
  | "SampleLibrary";

export type LibraryCoreRelationshipEffect =
  | "delete_accounts_linked_to_person"
  | "delete_all_feed_items"
  | "delete_feed_items_for_feed"
  | "detach_accounts_from_person"
  | "remove_sample_accounts"
  | "remove_sample_feed_items"
  | "remove_sample_feeds"
  | "remove_sample_persons";

export type LibraryCoreOperationBlocker =
  | "capture_source_authority_unresolved"
  | "entity_id_schema_unresolved"
  | "field_algebra_unresolved"
  | "frozen_bulk_contract_unresolved"
  | "legacy_friend_account_replacement_unresolved"
  | "materializer_unimplemented"
  | "payload_schema_unresolved"
  | "provider_intent_execution_receipt_unresolved"
  | "provider_action_lifecycle_contract_unresolved"
  | "provider_intent_separation_unresolved"
  | "runtime_authority_inactive"
  | "touched_fields_unresolved";

type NonEmptyBlockers = readonly [
  LibraryCoreOperationBlocker,
  ...LibraryCoreOperationBlocker[],
];

export interface LibraryCoreOperationDefinition {
  readonly status: "planned_blocked";
  readonly schemaVersion: 1;
  readonly entityType: LibraryCoreOperationEntity;
  /**
   * A non-null schema closes only payload syntax for that operation. It does
   * not close touched fields, algebra, materialization, or runtime authority.
   */
  readonly payloadSchema: LibraryCoreOperationPayloadSchema<
    string,
    unknown
  > | null;
  /** Exact entity-key syntax only. This does not prove the entity exists. */
  readonly entityIdCodec: LibraryCoreEntityIdCodec | null;
  readonly touchedFieldRegistryKeys: readonly string[] | null;
  readonly fieldAlgebra: null;
  readonly materializer: null;
  readonly frozenBulkContract: null;
  readonly transactionLimits: {
    readonly maximumMembers: 1_000;
    readonly maximumCanonicalTransactionBytes: 4_194_304;
  };
  readonly relationshipEffects: readonly LibraryCoreRelationshipEffect[];
  readonly candidateStoreSurfaces: readonly BaseAppFunctionKey[];
  readonly legacyWorkerRequests: readonly string[];
  readonly intendedAuthority:
    | "capture_ingest"
    | "local_user"
    | "provider_action_executor_receipt"
    | "provider_capture_reconciliation"
    | "system_repair";
  readonly blockers: NonEmptyBlockers;
}

interface PlannedOperationInput {
  readonly entityType: LibraryCoreOperationEntity;
  readonly relationshipEffects?: readonly LibraryCoreRelationshipEffect[];
  readonly candidateStoreSurfaces?: readonly BaseAppFunctionKey[];
  readonly legacyWorkerRequests?: readonly string[];
  readonly intendedAuthority:
    | "capture_ingest"
    | "local_user"
    | "provider_action_executor_receipt"
    | "provider_capture_reconciliation"
    | "system_repair";
  readonly additionalBlockers?: readonly LibraryCoreOperationBlocker[];
  readonly payloadSchema?: LibraryCoreOperationPayloadSchema<string, unknown>;
  readonly entityIdCodec?: LibraryCoreEntityIdCodec;
  readonly touchedFieldRegistryKeys?: readonly string[];
}

const BASE_OPERATION_BLOCKERS = [
  "field_algebra_unresolved",
  "materializer_unimplemented",
  "runtime_authority_inactive",
] as const satisfies NonEmptyBlockers;

function plannedOperation(
  input: PlannedOperationInput,
): LibraryCoreOperationDefinition {
  const blockers: NonEmptyBlockers = [
    "field_algebra_unresolved",
    ...(input.touchedFieldRegistryKeys === undefined
      ? (["touched_fields_unresolved"] as const)
      : []),
    ...(input.entityIdCodec === undefined
      ? (["entity_id_schema_unresolved"] as const)
      : []),
    ...(input.payloadSchema === undefined
      ? (["payload_schema_unresolved"] as const)
      : []),
    ...BASE_OPERATION_BLOCKERS.slice(1),
    ...(input.additionalBlockers ?? []),
  ];

  return {
    status: "planned_blocked",
    schemaVersion: 1,
    entityType: input.entityType,
    payloadSchema: input.payloadSchema ?? null,
    entityIdCodec: input.entityIdCodec ?? null,
    touchedFieldRegistryKeys: input.touchedFieldRegistryKeys ?? null,
    fieldAlgebra: null,
    materializer: null,
    frozenBulkContract: null,
    transactionLimits: {
      maximumMembers: LIBRARY_CORE_MAX_TRANSACTION_MEMBERS,
      maximumCanonicalTransactionBytes:
        LIBRARY_CORE_MAX_CANONICAL_TRANSACTION_BYTES,
    },
    relationshipEffects: input.relationshipEffects ?? [],
    candidateStoreSurfaces: input.candidateStoreSurfaces ?? [],
    legacyWorkerRequests: input.legacyWorkerRequests ?? [],
    intendedAuthority: input.intendedAuthority,
    blockers,
  };
}

const localUserOperation = (
  input: Omit<PlannedOperationInput, "intendedAuthority">,
): LibraryCoreOperationDefinition =>
  plannedOperation({ ...input, intendedAuthority: "local_user" });

const frozenBulkBlocker = [
  "frozen_bulk_contract_unresolved",
] as const satisfies readonly LibraryCoreOperationBlocker[];

/**
 * Dormant operation census only.
 *
 * These IDs name candidate successors for current legacy surfaces. Every entry
 * is blocked because no payload schema, touched-field set, field algebra, or
 * materializer exists yet. Nothing in this registry grants write authority.
 */
export const LIBRARY_CORE_OPERATION_REGISTRY = {
  account_person_assignment: localUserOperation({
    entityType: "Account",
    candidateStoreSurfaces: [
      "createConnectionPersonFromAccounts",
      "createConnectionPersonsFromCandidates",
      "linkAccountToPerson",
      "updateAccount",
    ],
    legacyWorkerRequests: ["UPSERT_CONNECTION_PERSONS", "UPDATE_ACCOUNT"],
  }),
  account_remove: localUserOperation({
    entityType: "Account",
    candidateStoreSurfaces: ["removeAccount", "updateFriend"],
    legacyWorkerRequests: ["REMOVE_ACCOUNT"],
    additionalBlockers: ["legacy_friend_account_replacement_unresolved"],
  }),
  account_restore: localUserOperation({
    entityType: "Account",
  }),
  account_upsert: localUserOperation({
    entityType: "Account",
    candidateStoreSurfaces: [
      "addAccount",
      "addAccounts",
      "addFriend",
      "addFriends",
      "updateAccount",
      "updateFriend",
    ],
    legacyWorkerRequests: [
      "ADD_ACCOUNT",
      "ADD_ACCOUNTS",
      "UPDATE_ACCOUNT",
      "UPSERT_CONNECTION_PERSONS",
    ],
    additionalBlockers: ["legacy_friend_account_replacement_unresolved"],
  }),
  feed_item_archive_assignment: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["toggleArchived"],
    legacyWorkerRequests: ["TOGGLE_ARCHIVED"],
  }),
  feed_item_capture_upsert: plannedOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["addItems", "updateItem"],
    legacyWorkerRequests: [
      "ADD_FEED_ITEM",
      "ADD_FEED_ITEMS",
      "ADD_STUB_ITEM",
      "BATCH_IMPORT_ITEMS",
      "BATCH_REFRESH_FEEDS",
      "UPDATE_FEED_ITEM",
    ],
    intendedAuthority: "capture_ingest",
    additionalBlockers: ["capture_source_authority_unresolved"],
  }),
  feed_item_like_assignment: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["toggleLiked"],
    legacyWorkerRequests: ["TOGGLE_LIKED"],
    additionalBlockers: ["provider_intent_separation_unresolved"],
  }),
  feed_item_like_sync_receipt: plannedOperation({
    entityType: "FeedItem",
    legacyWorkerRequests: ["CONFIRM_LIKED_SYNCED"],
    intendedAuthority: "provider_action_executor_receipt",
    additionalBlockers: [
      "provider_action_lifecycle_contract_unresolved",
      "provider_intent_execution_receipt_unresolved",
    ],
  }),
  feed_item_read_assignment: localUserOperation({
    entityType: "FeedItem",
    payloadSchema: FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA,
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys: [
      LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY,
    ],
    candidateStoreSurfaces: ["markAsRead"],
    legacyWorkerRequests: ["MARK_AS_READ"],
    additionalBlockers: ["provider_intent_separation_unresolved"],
  }),
  feed_item_remove: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["removeItem"],
    legacyWorkerRequests: ["REMOVE_FEED_ITEM"],
  }),
  feed_item_restore: localUserOperation({
    entityType: "FeedItem",
  }),
  feed_item_saved_assignment: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["toggleSaved"],
    legacyWorkerRequests: ["TOGGLE_SAVED"],
  }),
  feed_item_seen_sync_receipt: plannedOperation({
    entityType: "FeedItem",
    legacyWorkerRequests: ["CONFIRM_SEEN_SYNCED"],
    intendedAuthority: "provider_action_executor_receipt",
    additionalBlockers: [
      "provider_action_lifecycle_contract_unresolved",
      "provider_intent_execution_receipt_unresolved",
    ],
  }),
  feed_items_archive_frozen: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["archiveItems"],
    legacyWorkerRequests: ["ARCHIVE_ITEMS"],
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_archive_read_unsaved_frozen: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["archiveAllReadUnsaved"],
    legacyWorkerRequests: ["ARCHIVE_ALL_READ_UNSAVED"],
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_content_signals_backfill_frozen: plannedOperation({
    entityType: "FeedItem",
    legacyWorkerRequests: ["BACKFILL_CONTENT_SIGNALS"],
    intendedAuthority: "system_repair",
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_deduplicate_frozen: plannedOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["addItems"],
    legacyWorkerRequests: [
      "ADD_FEED_ITEMS",
      "BATCH_REFRESH_FEEDS",
      "DEDUPLICATE_ITEMS",
    ],
    intendedAuthority: "system_repair",
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_delete_archived_frozen: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["deleteAllArchived"],
    legacyWorkerRequests: ["DELETE_ALL_ARCHIVED"],
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_prune_archived_frozen: plannedOperation({
    entityType: "FeedItem",
    legacyWorkerRequests: ["PRUNE_ARCHIVED_ITEMS"],
    intendedAuthority: "system_repair",
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_read_frozen: localUserOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["markAllAsRead", "markItemsAsRead"],
    legacyWorkerRequests: ["MARK_ALL_AS_READ", "MARK_ITEMS_AS_READ"],
    additionalBlockers: [
      ...frozenBulkBlocker,
      "provider_intent_separation_unresolved",
    ],
  }),
  feed_items_unarchive_saved_frozen: plannedOperation({
    entityType: "FeedItem",
    candidateStoreSurfaces: ["unarchiveSavedItems"],
    legacyWorkerRequests: ["UNARCHIVE_SAVED_ITEMS"],
    intendedAuthority: "system_repair",
    additionalBlockers: frozenBulkBlocker,
  }),
  person_reach_out_append: localUserOperation({
    entityType: "Person",
    candidateStoreSurfaces: ["logReachOut"],
    legacyWorkerRequests: ["LOG_REACH_OUT"],
  }),
  person_remove_and_accounts: localUserOperation({
    entityType: "Person",
    relationshipEffects: ["delete_accounts_linked_to_person"],
    candidateStoreSurfaces: ["removeFriend", "removePerson"],
    legacyWorkerRequests: ["REMOVE_PERSON"],
    additionalBlockers: frozenBulkBlocker,
  }),
  person_remove_detach_accounts: localUserOperation({
    entityType: "Person",
    relationshipEffects: ["detach_accounts_from_person"],
    candidateStoreSurfaces: ["removeFriend", "removePerson"],
    additionalBlockers: frozenBulkBlocker,
  }),
  person_restore: localUserOperation({
    entityType: "Person",
  }),
  person_upsert: localUserOperation({
    entityType: "Person",
    candidateStoreSurfaces: [
      "addFriend",
      "addFriends",
      "addPerson",
      "addPersons",
      "createConnectionPersonFromAccounts",
      "createConnectionPersonsFromCandidates",
      "updateFriend",
      "updatePerson",
    ],
    legacyWorkerRequests: [
      "ADD_PERSON",
      "ADD_PERSONS",
      "UPDATE_PERSON",
      "UPSERT_CONNECTION_PERSONS",
    ],
    additionalBlockers: ["legacy_friend_account_replacement_unresolved"],
  }),
  preferences_leaf_assignment: localUserOperation({
    entityType: "UserPreferences",
    candidateStoreSurfaces: ["updatePreferences"],
    legacyWorkerRequests: ["UPDATE_PREFERENCES"],
  }),
  provider_capture_snapshot_reconcile: plannedOperation({
    entityType: "ProviderCaptureSnapshot",
    legacyWorkerRequests: [
      "RECONCILE_FOLLOW_ROSTER_CAPTURE",
      "RECONCILE_YOUTUBE_CAPTURE",
    ],
    intendedAuthority: "provider_capture_reconciliation",
    additionalBlockers: frozenBulkBlocker,
  }),
  provider_intent: localUserOperation({
    entityType: "ProviderIntent",
    candidateStoreSurfaces: [
      "markAllAsRead",
      "markAsRead",
      "markItemsAsRead",
      "toggleLiked",
    ],
    legacyWorkerRequests: [
      "MARK_ALL_AS_READ",
      "MARK_AS_READ",
      "MARK_ITEMS_AS_READ",
      "TOGGLE_LIKED",
    ],
    additionalBlockers: [
      "provider_action_lifecycle_contract_unresolved",
      "provider_intent_execution_receipt_unresolved",
    ],
  }),
  rss_feed_remove_keep_items: localUserOperation({
    entityType: "RssFeed",
    candidateStoreSurfaces: ["removeFeed"],
    legacyWorkerRequests: ["REMOVE_RSS_FEED"],
  }),
  rss_feed_remove_with_items: localUserOperation({
    entityType: "RssFeed",
    relationshipEffects: ["delete_feed_items_for_feed"],
    candidateStoreSurfaces: ["removeFeed"],
    legacyWorkerRequests: ["REMOVE_RSS_FEED"],
    additionalBlockers: frozenBulkBlocker,
  }),
  rss_feed_restore: localUserOperation({
    entityType: "RssFeed",
  }),
  rss_feed_title_assignment: localUserOperation({
    entityType: "RssFeed",
    candidateStoreSurfaces: ["renameFeed"],
    legacyWorkerRequests: ["UPDATE_RSS_FEED"],
  }),
  rss_feed_upsert: localUserOperation({
    entityType: "RssFeed",
    candidateStoreSurfaces: ["addFeed"],
    legacyWorkerRequests: ["ADD_RSS_FEED", "BATCH_REFRESH_FEEDS", "UPDATE_RSS_FEED"],
  }),
  rss_feeds_heal_untitled_frozen: plannedOperation({
    entityType: "RssFeed",
    legacyWorkerRequests: ["HEAL_UNTITLED_FEEDS"],
    intendedAuthority: "system_repair",
    additionalBlockers: frozenBulkBlocker,
  }),
  rss_feeds_remove_keep_items: localUserOperation({
    entityType: "RssFeed",
    candidateStoreSurfaces: ["removeAllFeeds"],
    legacyWorkerRequests: ["REMOVE_ALL_FEEDS"],
    additionalBlockers: frozenBulkBlocker,
  }),
  rss_feeds_remove_with_items: localUserOperation({
    entityType: "RssFeed",
    relationshipEffects: ["delete_all_feed_items"],
    candidateStoreSurfaces: ["removeAllFeeds"],
    legacyWorkerRequests: ["REMOVE_ALL_FEEDS"],
    additionalBlockers: frozenBulkBlocker,
  }),
  sample_library_import: localUserOperation({
    entityType: "SampleLibrary",
    candidateStoreSurfaces: ["addSampleLibraryData"],
    legacyWorkerRequests: ["ADD_SAMPLE_LIBRARY_DATA"],
    additionalBlockers: frozenBulkBlocker,
  }),
  sample_library_remove: localUserOperation({
    entityType: "SampleLibrary",
    relationshipEffects: [
      "remove_sample_accounts",
      "remove_sample_feed_items",
      "remove_sample_feeds",
      "remove_sample_persons",
    ],
    candidateStoreSurfaces: ["clearSampleData"],
    legacyWorkerRequests: ["CLEAR_SAMPLE_DATA"],
    additionalBlockers: frozenBulkBlocker,
  }),
} as const satisfies Readonly<
  Record<LibraryCoreOperationId, LibraryCoreOperationDefinition>
>;
