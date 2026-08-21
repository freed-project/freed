import type { BaseAppState } from "../store-types.js";
import {
  FEED_ITEM_READ_AT_FIELD_ALGEBRA,
  type LibraryCoreOperationFieldAlgebraContract,
} from "./operation-field-algebra-contracts.js";
import {
  FEED_ITEM_READ_ASSIGNMENT_MATERIALIZER,
  type LibraryCoreOperationMaterializerContract,
} from "./operation-materializer-contracts.js";
import {
  FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA,
  FEED_ITEM_REMOVE_PAYLOAD_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_PAYLOAD_SCHEMA,
  RSS_FEED_UPSERT_PAYLOAD_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA,
  PERSON_REMOVE_AND_ACCOUNTS_PAYLOAD_SCHEMA,
  PERSON_REMOVE_DETACH_ACCOUNTS_PAYLOAD_SCHEMA,
  PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA,
  PERSON_UPSERT_PAYLOAD_SCHEMA,
  ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_SCHEMA,
  ACCOUNT_UPSERT_PAYLOAD_SCHEMA,
  ACCOUNT_REMOVE_PAYLOAD_SCHEMA,
  type LibraryCoreOperationPayloadSchema,
} from "./operation-payload-contracts.js";
import {
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEM_SAVED_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  PREFERENCES_LEAF_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  ACCOUNT_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
  PERSON_REACH_OUT_APPEND_TOUCHED_FIELD_REGISTRY_KEYS,
  PERSON_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
  RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEM_CAPTURE_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEM_LIKE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEM_LIKE_SYNC_RECEIPT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEM_SEEN_SYNC_RECEIPT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEM_READ_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEMS_ARCHIVE_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEMS_READ_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
  RSS_FEEDS_HEAL_UNTITLED_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
  ACCOUNT_PERSON_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
  FEED_ITEMS_CONTENT_SIGNALS_BACKFILL_TOUCHED_FIELD_REGISTRY_KEYS,
} from "./operation-touched-fields.js";
import {
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REMOVE_DETACH_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA,
  PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_PERSON_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  type LibraryCoreTransactionMemberSchemaDescriptor,
} from "./operation-envelope-contracts.js";
import type { LibraryCoreEntity } from "./protocol-registry.js";
import {
  LIBRARY_CORE_ENTITY_ID_CODEC_V1,
  type LibraryCoreEntityIdCodec,
} from "./protocol-scalars.js";
import type { LibraryCoreOperationId } from "./sqlite-contract.generated.js";

export {
  LIBRARY_CORE_OPERATION_IDS,
  type LibraryCoreOperationId,
} from "./sqlite-contract.generated.js";

export type BaseAppFunctionKey = {
  [Key in keyof BaseAppState]-?: NonNullable<BaseAppState[Key]> extends (
    ...args: never[]
  ) => unknown
    ? Key
    : never;
}[keyof BaseAppState];

export const LIBRARY_CORE_MAX_TRANSACTION_MEMBERS = 1_000;
export const LIBRARY_CORE_MAX_CANONICAL_TRANSACTION_BYTES = 4_194_304;

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
  | "transaction_member_schema_unresolved"
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
  /**
   * Every synchronized leaf this operation may write on any code path, sorted
   * and unique. Leaves it only reads as a precondition are excluded. A closed
   * inventory says what changes, not how concurrent changes converge.
   */
  readonly touchedFieldRegistryKeys: readonly string[] | null;
  readonly fieldAlgebra: LibraryCoreOperationFieldAlgebraContract<unknown> | null;
  readonly transactionMemberSchema: LibraryCoreTransactionMemberSchemaDescriptor | null;
  /**
   * How this operation lands in the authoritative tables.
   *
   * Null means the operation cannot yet be the source of truth for anything,
   * whatever else about it is closed.
   */
  readonly materializer: LibraryCoreOperationMaterializerContract | null;
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
  readonly fieldAlgebra?: LibraryCoreOperationFieldAlgebraContract<unknown>;
  readonly transactionMemberSchema?: LibraryCoreTransactionMemberSchemaDescriptor;
  readonly materializer?: LibraryCoreOperationMaterializerContract;
}

function plannedOperation(
  input: PlannedOperationInput,
): LibraryCoreOperationDefinition {
  // `runtime_authority_inactive` leads because it is the one blocker no
  // declaration can drop. Nothing in this registry grants write authority, so
  // every entry keeps it and the list is provably non-empty.
  const blockers: NonEmptyBlockers = [
    "runtime_authority_inactive",
    ...(input.materializer === undefined
      ? (["materializer_unimplemented"] as const)
      : []),
    ...(input.fieldAlgebra === undefined
      ? (["field_algebra_unresolved"] as const)
      : []),
    ...(input.touchedFieldRegistryKeys === undefined
      ? (["touched_fields_unresolved"] as const)
      : []),
    ...(input.entityIdCodec === undefined
      ? (["entity_id_schema_unresolved"] as const)
      : []),
    ...(input.payloadSchema === undefined
      ? (["payload_schema_unresolved"] as const)
      : []),
    ...(input.transactionMemberSchema === undefined
      ? (["transaction_member_schema_unresolved"] as const)
      : []),
    ...(input.additionalBlockers ?? []),
  ];

  return {
    status: "planned_blocked",
    schemaVersion: 1,
    entityType: input.entityType,
    payloadSchema: input.payloadSchema ?? null,
    entityIdCodec: input.entityIdCodec ?? null,
    touchedFieldRegistryKeys: input.touchedFieldRegistryKeys ?? null,
    fieldAlgebra: input.fieldAlgebra ?? null,
    transactionMemberSchema: input.transactionMemberSchema ?? null,
    materializer: input.materializer ?? null,
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
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_SCHEMA,
    transactionMemberSchema: ACCOUNT_PERSON_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
    touchedFieldRegistryKeys:
      ACCOUNT_PERSON_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
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
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: ACCOUNT_REMOVE_PAYLOAD_SCHEMA,
    transactionMemberSchema: ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA,
    candidateStoreSurfaces: ["removeAccount", "updateFriend"],
    legacyWorkerRequests: ["REMOVE_ACCOUNT"],
  }),
  account_restore: localUserOperation({
    entityType: "Account",
  }),
  account_upsert: localUserOperation({
    entityType: "Account",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: ACCOUNT_UPSERT_PAYLOAD_SCHEMA,
    transactionMemberSchema: ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA,
    touchedFieldRegistryKeys: ACCOUNT_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
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
  }),
  feed_item_archive_assignment: localUserOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_ARCHIVE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["toggleArchived"],
    legacyWorkerRequests: ["TOGGLE_ARCHIVED"],
  }),
  feed_item_capture_upsert: plannedOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: FEED_ITEM_CAPTURE_UPSERT_PAYLOAD_SCHEMA,
    transactionMemberSchema: FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
    touchedFieldRegistryKeys:
      FEED_ITEM_CAPTURE_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
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
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_LIKE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["toggleLiked"],
    legacyWorkerRequests: ["TOGGLE_LIKED"],
    additionalBlockers: ["provider_intent_separation_unresolved"],
  }),
  feed_item_like_sync_receipt: plannedOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_LIKE_SYNC_RECEIPT_TOUCHED_FIELD_REGISTRY_KEYS,
    legacyWorkerRequests: ["CONFIRM_LIKED_SYNCED"],
    intendedAuthority: "provider_action_executor_receipt",
    additionalBlockers: [
      "provider_action_lifecycle_contract_unresolved",
      "provider_intent_execution_receipt_unresolved",
    ],
  }),
  feed_item_read_assignment: localUserOperation({
    entityType: "FeedItem",
    materializer: FEED_ITEM_READ_ASSIGNMENT_MATERIALIZER,
    payloadSchema: FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA,
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_READ_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
    fieldAlgebra: FEED_ITEM_READ_AT_FIELD_ALGEBRA,
    transactionMemberSchema:
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
    candidateStoreSurfaces: ["markAsRead"],
    legacyWorkerRequests: ["MARK_AS_READ"],
  }),
  feed_item_remove: localUserOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: FEED_ITEM_REMOVE_PAYLOAD_SCHEMA,
    transactionMemberSchema: FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
    candidateStoreSurfaces: ["removeItem"],
    legacyWorkerRequests: ["REMOVE_FEED_ITEM"],
  }),
  feed_item_restore: localUserOperation({
    entityType: "FeedItem",
  }),
  feed_item_saved_assignment: localUserOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_SAVED_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["toggleSaved"],
    legacyWorkerRequests: ["TOGGLE_SAVED"],
  }),
  feed_item_seen_sync_receipt: plannedOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEM_SEEN_SYNC_RECEIPT_TOUCHED_FIELD_REGISTRY_KEYS,
    legacyWorkerRequests: ["CONFIRM_SEEN_SYNCED"],
    intendedAuthority: "provider_action_executor_receipt",
    additionalBlockers: [
      "provider_action_lifecycle_contract_unresolved",
      "provider_intent_execution_receipt_unresolved",
    ],
  }),
  feed_items_archive_frozen: localUserOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEMS_ARCHIVE_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["archiveItems"],
    legacyWorkerRequests: ["ARCHIVE_ITEMS"],
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_archive_read_unsaved_frozen: localUserOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEMS_ARCHIVE_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["archiveAllReadUnsaved"],
    legacyWorkerRequests: ["ARCHIVE_ALL_READ_UNSAVED"],
    additionalBlockers: frozenBulkBlocker,
  }),
  feed_items_content_signals_backfill_frozen: plannedOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEMS_CONTENT_SIGNALS_BACKFILL_TOUCHED_FIELD_REGISTRY_KEYS,
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
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEMS_READ_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["markAllAsRead", "markItemsAsRead"],
    legacyWorkerRequests: ["MARK_ALL_AS_READ", "MARK_ITEMS_AS_READ"],
    additionalBlockers: [
      ...frozenBulkBlocker,
      "provider_intent_separation_unresolved",
    ],
  }),
  feed_items_unarchive_saved_frozen: plannedOperation({
    entityType: "FeedItem",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    touchedFieldRegistryKeys:
      FEED_ITEMS_ARCHIVE_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["unarchiveSavedItems"],
    legacyWorkerRequests: ["UNARCHIVE_SAVED_ITEMS"],
    intendedAuthority: "system_repair",
    additionalBlockers: frozenBulkBlocker,
  }),
  person_reach_out_append: localUserOperation({
    entityType: "Person",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA,
    transactionMemberSchema:
      PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA,
    touchedFieldRegistryKeys:
      PERSON_REACH_OUT_APPEND_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["logReachOut"],
    legacyWorkerRequests: ["LOG_REACH_OUT"],
  }),
  person_remove_and_accounts: localUserOperation({
    entityType: "Person",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: PERSON_REMOVE_AND_ACCOUNTS_PAYLOAD_SCHEMA,
    transactionMemberSchema:
      PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
    relationshipEffects: ["delete_accounts_linked_to_person"],
    candidateStoreSurfaces: ["removeFriend", "removePerson"],
    legacyWorkerRequests: ["REMOVE_PERSON"],
  }),
  person_remove_detach_accounts: localUserOperation({
    entityType: "Person",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: PERSON_REMOVE_DETACH_ACCOUNTS_PAYLOAD_SCHEMA,
    transactionMemberSchema:
      PERSON_REMOVE_DETACH_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
    relationshipEffects: ["detach_accounts_from_person"],
    candidateStoreSurfaces: ["removeFriend", "removePerson"],
    legacyWorkerRequests: ["REMOVE_PERSON"],
  }),
  person_restore: localUserOperation({
    entityType: "Person",
  }),
  person_upsert: localUserOperation({
    entityType: "Person",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: PERSON_UPSERT_PAYLOAD_SCHEMA,
    transactionMemberSchema: PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
    touchedFieldRegistryKeys: PERSON_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
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
  }),
  preferences_leaf_assignment: localUserOperation({
    entityType: "UserPreferences",
    // `entityIdCodec` stays null on purpose. Preferences are a singleton root,
    // not an entity map, so there is no per-entity key for a codec to validate.
    // Declaring one would claim a key space this operation does not have.
    touchedFieldRegistryKeys:
      PREFERENCES_LEAF_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
    payloadSchema: PREFERENCES_LEAF_ASSIGNMENT_PAYLOAD_SCHEMA,
    transactionMemberSchema:
      PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
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
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA,
    transactionMemberSchema:
      RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
    candidateStoreSurfaces: ["removeFeed"],
    legacyWorkerRequests: ["REMOVE_RSS_FEED"],
  }),
  rss_feed_remove_with_items: localUserOperation({
    entityType: "RssFeed",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: RSS_FEED_REMOVE_WITH_ITEMS_PAYLOAD_SCHEMA,
    transactionMemberSchema:
      RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
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
    // `entityIdCodec` stays null. RSS feeds are keyed by url, a different key
    // space from the globalId one the existing codec declaration was justified
    // against, so reusing it here would be a new claim rather than a reuse.
    touchedFieldRegistryKeys:
      RSS_FEED_TITLE_ASSIGNMENT_TOUCHED_FIELD_REGISTRY_KEYS,
    payloadSchema: RSS_FEED_TITLE_ASSIGNMENT_PAYLOAD_SCHEMA,
    transactionMemberSchema:
      RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
    candidateStoreSurfaces: ["renameFeed"],
    legacyWorkerRequests: ["UPDATE_RSS_FEED"],
  }),
  rss_feed_upsert: localUserOperation({
    entityType: "RssFeed",
    entityIdCodec: LIBRARY_CORE_ENTITY_ID_CODEC_V1,
    payloadSchema: RSS_FEED_UPSERT_PAYLOAD_SCHEMA,
    transactionMemberSchema: RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
    touchedFieldRegistryKeys: RSS_FEED_UPSERT_TOUCHED_FIELD_REGISTRY_KEYS,
    candidateStoreSurfaces: ["addFeed"],
    legacyWorkerRequests: [
      "ADD_RSS_FEED",
      "BATCH_REFRESH_FEEDS",
      "UPDATE_RSS_FEED",
    ],
  }),
  rss_feeds_heal_untitled_frozen: plannedOperation({
    entityType: "RssFeed",
    touchedFieldRegistryKeys:
      RSS_FEEDS_HEAL_UNTITLED_FROZEN_TOUCHED_FIELD_REGISTRY_KEYS,
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
