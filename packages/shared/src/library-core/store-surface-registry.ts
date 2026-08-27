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
  | "sqlite_mutation"
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
  readonly [Key in keyof BaseAppState]-?: NonNullable<
    BaseAppState[Key]
  > extends (...args: never[]) => unknown
    ? StoreSurfaceDefinition & { readonly surfaceKind: "function" }
    : StoreSurfaceDefinition & { readonly surfaceKind: "state" };
};

const functionSurface = (
  classification: StoreSurfaceClassification,
  options: Omit<StoreSurfaceDefinition, "classification" | "surfaceKind"> = {
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
  options: Omit<StoreSurfaceDefinition, "classification" | "surfaceKind"> = {
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
 * until it is classified. Product writes may remain as UI conveniences only
 * when they terminate in a registered SQLite mutation or frozen scope action.
 */
export const BASE_APP_STORE_SURFACE_REGISTRY = {
  acknowledgeSavedFeedPresentationPatch: functionSurface("ui_local"),
  activeFilter: stateSurface("ui_local"),
  activeView: stateSurface("ui_local"),
  addFeed: functionSurface("sqlite_mutation", {
    successorOperationIds: ["rss_feed_upsert"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  addItems: functionSurface("sqlite_mutation", {
    successorOperationIds: [
      "feed_item_capture_upsert",
      "feed_items_deduplicate_frozen",
    ],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  addSampleLibraryData: functionSurface("sqlite_mutation", {
    successorOperationIds: ["sample_library_import"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  archiveAllReadUnsaved: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_items_archive_read_unsaved_frozen"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  archiveItems: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_items_archive_frozen"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  archivedItemCount: stateSurface("derived"),
  archivableCountByPlatform: stateSurface("derived"),
  clearSampleData: functionSurface("sqlite_mutation", {
    successorOperationIds: ["sample_library_remove"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  deleteAllArchived: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_items_delete_archived_frozen"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  error: stateSurface("lifecycle"),
  enabledRssFeedCount: stateSurface("derived"),
  friendPersonCount: stateSurface("derived"),
  initialize: functionSurface("lifecycle", {
    successorOperationIds: [],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  isInitialized: stateSurface("lifecycle"),
  isLoading: stateSurface("lifecycle"),
  isSyncing: stateSurface("lifecycle"),
  itemCountByPlatform: stateSurface("derived"),
  mapAllContentLocationCount: stateSurface("derived"),
  mapFriendLocationCount: stateSurface("derived"),
  markAllAsRead: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_items_read_frozen", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  markAsRead: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_item_read_assignment", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  markItemsAsRead: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_items_read_frozen", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  openMapForPerson: functionSurface("ui_local"),
  pendingMatchCount: stateSurface("derived"),
  preferences: stateSurface("derived", {
    successorOperationIds: [],
    successorQueryIds: ["preferences_snapshot_v1"],
    activationBlocker: null,
  }),
  removeAllFeeds: functionSurface("sqlite_mutation", {
    successorOperationIds: [
      "rss_feeds_remove_keep_items",
      "rss_feeds_remove_with_items",
    ],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  removeFeed: functionSurface("sqlite_mutation", {
    successorOperationIds: [
      "rss_feed_remove_keep_items",
      "rss_feed_remove_with_items",
    ],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  removeItem: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_item_remove"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  rssFeedCount: stateSurface("derived"),
  renameFeed: functionSurface("sqlite_mutation", {
    successorOperationIds: ["rss_feed_title_assignment"],
    successorQueryIds: [],
    activationBlocker: null,
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
  socialAccountCount: stateSurface("derived"),
  toggleArchived: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_item_archive_assignment"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  toggleLiked: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_item_like_assignment", "provider_intent"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  toggleSaved: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_item_saved_assignment"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  totalArchivableCount: stateSurface("derived"),
  totalItemCount: stateSurface("derived"),
  totalUnreadCount: stateSurface("derived"),
  unarchiveSavedItems: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_items_unarchive_saved_frozen"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  unreadCountByPlatform: stateSurface("derived"),
  updateItem: functionSurface("sqlite_mutation", {
    successorOperationIds: ["feed_item_capture_upsert"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
  updatePreferences: functionSurface("sqlite_mutation", {
    successorOperationIds: ["preferences_leaf_assignment"],
    successorQueryIds: [],
    activationBlocker: null,
  }),
} as const satisfies StoreSurfaceRegistry;
