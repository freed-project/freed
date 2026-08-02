import type { BaseAppState } from "../store-types.js";
import type {
  BaseAppFunctionKey,
  LibraryCoreOperationId,
} from "./operation-registry.js";
import type { LibraryCoreQueryId } from "./query-registry.js";

export type BaseAppValueKey = Exclude<keyof BaseAppState, BaseAppFunctionKey>;

export type StoreSurfaceClassification =
  | "derived"
  | "legacy_compatibility"
  | "legacy_unbounded"
  | "lifecycle"
  | "ui_local";

interface StoreSurfaceDefinition {
  readonly surfaceKind: "function" | "state";
  readonly classification: StoreSurfaceClassification;
  readonly successorOperationIds: readonly LibraryCoreOperationId[];
  readonly successorQueryIds: readonly LibraryCoreQueryId[];
  readonly activationBlocker: string | null;
  readonly deprecatedAliasFor?: keyof BaseAppState;
}

type StoreSurfaceRegistry = {
  readonly [Key in keyof BaseAppState]-?: NonNullable<BaseAppState[Key]> extends (
    ...args: never[]
  ) => unknown
    ? StoreSurfaceDefinition & { readonly surfaceKind: "function" }
    : StoreSurfaceDefinition & { readonly surfaceKind: "state" };
};

const functionSurface = (
  classification: StoreSurfaceClassification,
  options: Omit<
    StoreSurfaceDefinition,
    "classification" | "surfaceKind"
  > = {
    successorOperationIds: [],
    successorQueryIds: [],
    activationBlocker: null,
  },
): StoreSurfaceDefinition & { readonly surfaceKind: "function" } => ({
  surfaceKind: "function",
  classification,
  ...options,
});

const stateSurface = (
  classification: StoreSurfaceClassification,
  options: Omit<
    StoreSurfaceDefinition,
    "classification" | "surfaceKind"
  > = {
    successorOperationIds: [],
    successorQueryIds: [],
    activationBlocker: null,
  },
): StoreSurfaceDefinition & { readonly surfaceKind: "state" } => ({
  surfaceKind: "state",
  classification,
  ...options,
});

/**
 * Exhaustive inventory of the current shared Zustand contract.
 *
 * `satisfies StoreSurfaceRegistry` makes a new BaseAppState key fail typecheck
 * until it is classified. Every persisted mutation remains legacy until its
 * blocked successor operation has a closed payload, field algebra, materializer,
 * and activation receipt.
 */
export const BASE_APP_STORE_SURFACE_REGISTRY = {
  accounts: stateSurface("legacy_unbounded", {
    successorOperationIds: [],
    successorQueryIds: ["account_detail_v1", "persons_graph_v1"],
    activationBlocker: "complete account record is retained in renderer state",
  }),
  acknowledgeSavedFeedPresentationPatch: functionSurface("ui_local"),
  activeFilter: stateSurface("ui_local"),
  activeView: stateSurface("ui_local"),
  addAccount: functionSurface("legacy_compatibility", {
    successorOperationIds: ["account_upsert"],
    successorQueryIds: [],
    activationBlocker: "current method writes legacy Automerge and its successor payload is unresolved",
  }),
  addAccounts: functionSurface("legacy_unbounded", {
    successorOperationIds: ["account_upsert"],
    successorQueryIds: [],
    activationBlocker: "caller-supplied account array has no hard member bound",
  }),
  addFeed: functionSurface("legacy_compatibility", {
    successorOperationIds: ["rss_feed_upsert"],
    successorQueryIds: [],
    activationBlocker: "current method writes legacy Automerge and its successor payload is unresolved",
  }),
  addFriend: functionSurface("legacy_compatibility", {
    successorOperationIds: ["account_upsert", "person_upsert"],
    successorQueryIds: [],
    activationBlocker: "deprecated Friend write aliases Person without an explicit migration boundary",
    deprecatedAliasFor: "addPerson",
  }),
  addFriends: functionSurface("legacy_compatibility", {
    successorOperationIds: ["account_upsert", "person_upsert"],
    successorQueryIds: [],
    activationBlocker: "deprecated Friend batch is unbounded and aliases Person",
    deprecatedAliasFor: "addPersons",
  }),
  addItems: functionSurface("legacy_unbounded", {
    successorOperationIds: [
      "feed_item_capture_upsert",
      "feed_items_deduplicate_frozen",
    ],
    successorQueryIds: [],
    activationBlocker: "caller-supplied capture array has no hard member or byte bound, provider, import, and user-capture authority are not separated, and the conditional legacy duplicate-removal contract is frozen",
  }),
  addPerson: functionSurface("legacy_compatibility", {
    successorOperationIds: ["person_upsert"],
    successorQueryIds: [],
    activationBlocker: "current method writes legacy Automerge and its successor payload is unresolved",
  }),
  addPersons: functionSurface("legacy_unbounded", {
    successorOperationIds: ["person_upsert"],
    successorQueryIds: [],
    activationBlocker: "caller-supplied person array has no hard member bound",
  }),
  addSampleLibraryData: functionSurface("legacy_unbounded", {
    successorOperationIds: ["sample_library_import"],
    successorQueryIds: [],
    activationBlocker: "multi-root sample payload has no hard member or byte bound",
  }),
  archiveAllReadUnsaved: functionSurface("legacy_unbounded", {
    successorOperationIds: ["feed_items_archive_read_unsaved_frozen"],
    successorQueryIds: [],
    activationBlocker: "current implementation scans a mutable full document instead of frozen membership",
  }),
  archiveItems: functionSurface("legacy_unbounded", {
    successorOperationIds: ["feed_items_archive_frozen"],
    successorQueryIds: [],
    activationBlocker: "caller enumerates an unbounded item-id set",
  }),
  archivableCountByPlatform: stateSurface("derived"),
  archivableFeedCounts: stateSurface("derived"),
  clearSampleData: functionSurface("legacy_unbounded", {
    successorOperationIds: ["sample_library_remove"],
    successorQueryIds: [],
    activationBlocker: "current implementation scans every synchronized root",
  }),
  createConnectionPersonFromAccounts: functionSurface("legacy_unbounded", {
    successorOperationIds: ["account_person_assignment", "person_upsert"],
    successorQueryIds: [],
    activationBlocker: "caller-supplied account-id set has no hard member bound",
  }),
  createConnectionPersonsFromCandidates: functionSurface("legacy_unbounded", {
    successorOperationIds: ["account_person_assignment", "person_upsert"],
    successorQueryIds: [],
    activationBlocker: "candidate and nested account-id arrays have no hard member bound",
  }),
  deleteAllArchived: functionSurface("legacy_unbounded", {
    successorOperationIds: ["feed_items_delete_archived_frozen"],
    successorQueryIds: [],
    activationBlocker: "current implementation scans mutable corpus membership",
  }),
  error: stateSurface("lifecycle"),
  feedTotalCounts: stateSurface("derived"),
  feedUnreadCounts: stateSurface("derived"),
  feeds: stateSurface("legacy_unbounded", {
    successorOperationIds: [],
    successorQueryIds: ["feed_subscription_page_v1"],
    activationBlocker: "complete RSS subscription map is retained in renderer state",
  }),
  friends: stateSurface("legacy_unbounded", {
    successorOperationIds: [],
    successorQueryIds: ["persons_graph_v1"],
    activationBlocker: "deprecated Friend projection duplicates the complete Person and Account corpora in renderer state",
    deprecatedAliasFor: "persons",
  }),
  initialize: functionSurface("legacy_unbounded", {
    successorOperationIds: [],
    successorQueryIds: [],
    activationBlocker: "initialization decodes and hydrates the complete legacy document before bounded Library Core queries exist",
  }),
  isInitialized: stateSurface("lifecycle"),
  isLoading: stateSurface("lifecycle"),
  isSyncing: stateSurface("lifecycle"),
  itemCountByPlatform: stateSurface("derived"),
  items: stateSurface("legacy_unbounded", {
    successorOperationIds: [],
    successorQueryIds: [
      "feed_browse_page_v2",
      "feed_page_v1",
      "item_detail_v1",
      "person_timeline_v1",
      "persons_graph_v1",
      "saved_analytics_v1",
    ],
    activationBlocker: "ranked feed array retains a corpus-sized renderer projection",
  }),
  linkAccountToPerson: functionSurface("legacy_compatibility", {
    successorOperationIds: ["account_person_assignment"],
    successorQueryIds: [],
    activationBlocker: "current method writes legacy Automerge and its successor payload is unresolved",
  }),
  logReachOut: functionSurface("legacy_compatibility", {
    successorOperationIds: ["person_reach_out_append"],
    successorQueryIds: [],
    activationBlocker: "legacy ReachOutLog has no closed stable-element payload yet",
  }),
  mapAllContentLocationCount: stateSurface("derived"),
  mapFriendLocationCount: stateSurface("derived"),
  markAllAsRead: functionSurface("legacy_unbounded", {
    successorOperationIds: ["feed_items_read_frozen", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: "current implementation resolves mutable corpus membership and derives provider seen actions from ordinary read state",
  }),
  markAsRead: functionSurface("legacy_compatibility", {
    successorOperationIds: ["feed_item_read_assignment", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: "current method writes legacy Automerge and derives a provider seen action from ordinary read state",
  }),
  markItemsAsRead: functionSurface("legacy_unbounded", {
    successorOperationIds: ["feed_items_read_frozen", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: "caller enumerates an unbounded item-id set and derives provider seen actions from ordinary read state",
  }),
  openMapForPerson: functionSurface("ui_local"),
  pendingMatchCount: stateSurface("derived"),
  persons: stateSurface("legacy_unbounded", {
    successorOperationIds: [],
    successorQueryIds: ["person_detail_v1", "persons_graph_v1"],
    activationBlocker: "complete Person map is retained in renderer state",
  }),
  preferences: stateSurface("legacy_unbounded", {
    successorOperationIds: [],
    successorQueryIds: ["preferences_snapshot_v1"],
    activationBlocker: "complete preferences include dynamic maps without closed nested bounds",
  }),
  removeAccount: functionSurface("legacy_compatibility", {
    successorOperationIds: ["account_remove"],
    successorQueryIds: [],
    activationBlocker: "current method physically deletes from legacy Automerge without a tombstone receipt",
  }),
  removeAllFeeds: functionSurface("legacy_unbounded", {
    successorOperationIds: ["rss_feeds_remove_keep_items", "rss_feeds_remove_with_items"],
    successorQueryIds: [],
    activationBlocker: "boolean parameter conceals a corpus-wide cascade",
  }),
  removeFeed: functionSurface("legacy_compatibility", {
    successorOperationIds: ["rss_feed_remove_keep_items", "rss_feed_remove_with_items"],
    successorQueryIds: [],
    activationBlocker: "includeItems boolean conceals a relationship cascade",
  }),
  removeFriend: functionSurface("legacy_compatibility", {
    successorOperationIds: ["person_remove_and_accounts", "person_remove_detach_accounts"],
    successorQueryIds: [],
    activationBlocker: "deprecated alias inherits an implicit account-deletion cascade",
    deprecatedAliasFor: "removePerson",
  }),
  removeItem: functionSurface("legacy_compatibility", {
    successorOperationIds: ["feed_item_remove"],
    successorQueryIds: [],
    activationBlocker: "current method physically deletes from legacy Automerge without a tombstone receipt",
  }),
  removePerson: functionSurface("legacy_compatibility", {
    successorOperationIds: ["person_remove_and_accounts", "person_remove_detach_accounts"],
    successorQueryIds: [],
    activationBlocker: "current removePerson always deletes linked accounts instead of naming the cascade",
  }),
  renameFeed: functionSurface("legacy_compatibility", {
    successorOperationIds: ["rss_feed_title_assignment"],
    successorQueryIds: [],
    activationBlocker: "current method writes legacy Automerge and its successor payload is unresolved",
  }),
  searchCorpusVersion: stateSurface("derived"),
  libraryItemVersion: stateSurface("derived"),
  savedFeedPresentationPatch: stateSurface("ui_local"),
  savedFeedVersion: stateSurface("derived"),
  searchQuery: stateSurface("ui_local"),
  selectedAccountId: stateSurface("ui_local"),
  selectedFriendId: stateSurface("legacy_compatibility", {
    successorOperationIds: [],
    successorQueryIds: [],
    activationBlocker: "deprecated selection alias duplicates selectedPersonId",
    deprecatedAliasFor: "selectedPersonId",
  }),
  selectedItemId: stateSurface("ui_local"),
  selectedPersonId: stateSurface("ui_local"),
  setActiveView: functionSurface("ui_local"),
  setError: functionSurface("lifecycle"),
  setFilter: functionSurface("ui_local"),
  setLoading: functionSurface("lifecycle"),
  setPendingMatchCount: functionSurface("ui_local"),
  setSearchQuery: functionSurface("ui_local"),
  setSelectedAccount: functionSurface("ui_local"),
  setSelectedFriend: functionSurface("legacy_compatibility", {
    successorOperationIds: [],
    successorQueryIds: [],
    activationBlocker: "deprecated UI alias duplicates setSelectedPerson",
    deprecatedAliasFor: "setSelectedPerson",
  }),
  setSelectedItem: functionSurface("ui_local"),
  setSelectedPerson: functionSurface("ui_local"),
  setSyncing: functionSurface("lifecycle"),
  toggleArchived: functionSurface("legacy_compatibility", {
    successorOperationIds: ["feed_item_archive_assignment"],
    successorQueryIds: [],
    activationBlocker: "toggle is not a replay-idempotent authority command",
  }),
  toggleLiked: functionSurface("legacy_compatibility", {
    successorOperationIds: ["feed_item_like_assignment", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: "toggle is not replay-idempotent and current item state directly feeds the provider outbox",
  }),
  toggleSaved: functionSurface("legacy_compatibility", {
    successorOperationIds: ["feed_item_saved_assignment"],
    successorQueryIds: [],
    activationBlocker: "toggle is not a replay-idempotent authority command",
  }),
  totalArchivableCount: stateSurface("derived"),
  totalItemCount: stateSurface("derived"),
  totalUnreadCount: stateSurface("derived"),
  unarchiveSavedItems: functionSurface("legacy_unbounded", {
    successorOperationIds: ["feed_items_unarchive_saved_frozen"],
    successorQueryIds: [],
    activationBlocker: "current repair scans mutable corpus membership",
  }),
  unreadCountByPlatform: stateSurface("derived"),
  updateAccount: functionSurface("legacy_compatibility", {
    successorOperationIds: ["account_person_assignment", "account_upsert"],
    successorQueryIds: [],
    activationBlocker: "generic Partial<Account> merge has no closed authoritative payload",
  }),
  updateFriend: functionSurface("legacy_compatibility", {
    successorOperationIds: ["account_remove", "account_upsert", "person_upsert"],
    successorQueryIds: [],
    activationBlocker: "deprecated Friend replacement deletes every linked Account, then re-adds caller-supplied Accounts without a closed bounded replacement transaction",
    deprecatedAliasFor: "updatePerson",
  }),
  updateItem: functionSurface("legacy_compatibility", {
    successorOperationIds: ["feed_item_capture_upsert"],
    successorQueryIds: [],
    activationBlocker: "generic Partial<FeedItem> merge has no closed authoritative payload or separated capture-source authority",
  }),
  updatePerson: functionSurface("legacy_compatibility", {
    successorOperationIds: ["person_upsert"],
    successorQueryIds: [],
    activationBlocker: "generic Partial<Person> merge has no closed authoritative payload",
  }),
  updatePreferences: functionSurface("legacy_compatibility", {
    successorOperationIds: ["preferences_leaf_assignment"],
    successorQueryIds: [],
    activationBlocker: "generic nested merge cannot distinguish omission from clear or deletion",
  }),
} as const satisfies StoreSurfaceRegistry;
