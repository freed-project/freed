/**
 * Global app state management with Zustand
 *
 * Native SQLite owns persistence and emits bounded materialized state updates.
 * The subscriber here applies them directly, with no document decode or
 * corpus-sized materialization on the main thread.
 */

import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import type {
  FeedItem,
  FilterOptions,
  RemoveFeedOptions,
  RssFeed,
  SampleDataClearSummary,
  SampleLibraryData,
  SavedFeedPresentationPatch,
  SavedFeedPresentationUserStatePatch,
  UserPreferences,
} from "@freed/shared";
import {
  applyFeedSignalModesToFilter,
  createDefaultPreferences,
  getDeviceLocalPreferenceUpdates,
  stripDeviceLocalPreferenceUpdates,
} from "@freed/shared";
import {
  migrateLegacyDeviceAIPreferences,
  setDeviceAIPreferences,
} from "@freed/ui/lib/device-ai-preferences";
import {
  migrateLegacyDeviceDisplayPreferences,
  setDeviceDisplayPreferences,
} from "@freed/ui/lib/device-display-preferences";
import { migrateLegacyThemePreference } from "@freed/ui/lib/theme";
import { migrateLegacyDeviceGraphLayoutToSqlite } from "@freed/ui/lib/device-graph-layout";
import { migrateLegacyFacebookGroupDiscovery } from "./facebook-group-discovery";
import {
  initializeDesktopLibraryRuntime,
  subscribeDesktopLibraryRuntime,
  addLibraryFeedItems,
  addSampleLibraryData,
  addLibraryRssFeed,
  removeLibraryRssFeed,
  removeAllLibraryFeeds,
  updateLibraryRssFeed,
  updateLibraryFeedItem,
  markLibraryItemsAsRead,
  markAllLibraryItemsAsRead,
  toggleLibraryItemSaved,
  removeLibraryFeedItem,
  clearSampleLibraryData,
  toggleLibraryItemArchived,
  archiveLibraryItems,
  archiveAllReadUnsavedLibraryItems,
  unarchiveSavedLibraryItems,
  deleteAllArchivedLibraryItems,
  pruneArchivedLibraryItems,
  updateLibraryPreferences,
  healUntitledLibraryFeedTitles,
  toggleLibraryItemLiked,
  confirmLibraryItemLikedSynced,
  confirmLibraryItemSeenSynced,
  quiesceDesktopLibraryForFactoryReset,
  type LibraryMutationEvent,
} from "./library-client";
import { buildPlatformActionsRegistry } from "./platform-actions";
import { startOutboxProcessor, stopAndDrainOutboxProcessor } from "./outbox";
import {
  readLibraryCoreItemDetail,
  scanLibraryCoreItems,
} from "./library-core-item-detail-runtime";
import { loadStoredCookies, type XAuthState } from "./x-auth";
import { recordBugReportEvent, recordRuntimeError } from "@freed/ui/lib/bug-report";
import { getDeviceDisplayPreferences } from "@freed/ui/lib/device-display-preferences";
import {
  BACKGROUND_CHANNEL_LABELS,
  finishBackgroundActivity,
  startBackgroundActivity,
} from "@freed/ui/lib/background-activity-store";
import { pinReaderItem } from "./content-fetcher";
import {
  scanLibraryCoreRssFeedsV1,
  type LibraryCoreRuntimeStateV1,
} from "@freed/shared/library-core";
import {
  mutateNormalizedDeviceGraphLayout,
  queryNormalizedLibrary,
} from "./library-core-normalized-query-client";
import { log } from "./logger";
import { initFbAuth, storeFbAuthState, type FbAuthState } from "./fb-auth";
import { initIgAuth, storeIgAuthState, type IgAuthState } from "./instagram-auth";
import { initLiAuth, storeLiAuthState, type LiAuthState } from "./li-auth";
import { initSubstackAuth, type SubstackAuthState } from "./substack-auth";
import { initMediumAuth, type MediumAuthState } from "./medium-auth";
import { initYouTubeAuth, type YouTubeAuthState } from "./youtube-auth";
import {
  capturePreLibraryMemoryBaseline,
  recordLibraryRuntimeReady,
  recordLibraryRuntimeLoadStarted,
} from "./memory-monitor";
import { reconcileSocialAuthStateHints } from "./social-auth-cookie-state";
import { getOrCreateDesktopClientRegistration } from "./desktop-client-registration";
import {
  isFactoryResetInProgress,
  waitForFactoryResetDrain,
} from "@freed/ui/lib/factory-reset";

let outboxTeardown: (() => void) | null = null;
let startupMaintenanceTimer: ReturnType<typeof setTimeout> | null = null;
let appInitializationPromise: Promise<void> | null = null;
let librarySubscriptionTeardown: (() => void) | null = null;
let storeAcceptingResetSensitiveWork = true;
const activeResetSensitiveStoreOperations = new Set<Promise<unknown>>();
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 180_000;
const SAVED_FEED_HARMLESS_ITEM_PATCH_MUTATIONS = new Set<string>([
  "MARK_AS_READ",
  "MARK_ITEMS_AS_READ",
  "MARK_ALL_AS_READ",
  "TOGGLE_LIKED",
  "CONFIRM_LIKED_SYNCED",
  "CONFIRM_SEEN_SYNCED",
]);
const SAVED_FEED_READ_ITEM_PATCH_MUTATIONS = new Set<string>([
  "MARK_AS_READ",
  "MARK_ITEMS_AS_READ",
]);
const SAVED_FEED_USER_STATE_ITEM_PATCH_MUTATIONS = new Set<string>([
  "TOGGLE_LIKED",
  "CONFIRM_LIKED_SYNCED",
  "CONFIRM_SEEN_SYNCED",
]);
const MAX_SAVED_FEED_PRESENTATION_IDENTITIES = 512;

function optionalTimestamp(value: number | undefined): number | null {
  return value ?? null;
}

function compactSavedFeedUserState(
  item: FeedItem,
): SavedFeedPresentationUserStatePatch {
  return {
    globalId: item.globalId,
    liked: item.userState.liked === true,
    likedAt: optionalTimestamp(item.userState.likedAt),
    likedSyncedAt: optionalTimestamp(item.userState.likedSyncedAt),
    seenSyncedAt: optionalTimestamp(item.userState.seenSyncedAt),
  };
}

function mergeSavedFeedPresentationPatch(
  previous: SavedFeedPresentationPatch | null,
  sourceVersion: number,
  event: Extract<LibraryMutationEvent, { source: "item_patch" }>,
): SavedFeedPresentationPatch {
  const current =
    previous?.sourceVersion === sourceVersion ? previous : null;
  const readItemIds = new Set(current?.readItemIds ?? []);
  const readPlatforms = new Set(current?.readPlatforms ?? []);
  const userStates = new Map(
    (current?.userStates ?? []).map((state) => [state.globalId, state]),
  );
  let readAt = current?.readAt ?? 0;

  if (SAVED_FEED_READ_ITEM_PATCH_MUTATIONS.has(event.mutation ?? "")) {
    for (const globalId of event.changedItemIds) readItemIds.add(globalId);
  } else if (event.mutation === "MARK_ALL_AS_READ") {
    for (const item of event.changedItems) readPlatforms.add(item.platform);
  }

  if (
    SAVED_FEED_READ_ITEM_PATCH_MUTATIONS.has(event.mutation ?? "") ||
    event.mutation === "MARK_ALL_AS_READ"
  ) {
    for (const item of event.changedItems) {
      const candidate = item.userState.readAt;
      if (candidate && Number.isFinite(candidate) && candidate > readAt) {
        readAt = candidate;
      }
    }
  }

  if (
    SAVED_FEED_USER_STATE_ITEM_PATCH_MUTATIONS.has(event.mutation ?? "")
  ) {
    for (const item of event.changedItems) {
      userStates.set(item.globalId, compactSavedFeedUserState(item));
    }
  }

  return {
    revision: (current?.revision ?? 0) + 1,
    sourceVersion,
    readAt,
    readItemIds: [...readItemIds],
    readPlatforms: [...readPlatforms].sort(),
    userStates: [...userStates.values()],
  };
}

function savedFeedPresentationPatchExceedsLimit(
  previous: SavedFeedPresentationPatch | null,
  sourceVersion: number,
  event: Extract<LibraryMutationEvent, { source: "item_patch" }>,
): boolean {
  const current = previous?.sourceVersion === sourceVersion ? previous : null;
  if (SAVED_FEED_READ_ITEM_PATCH_MUTATIONS.has(event.mutation ?? "")) {
    const readItemIds = new Set(current?.readItemIds ?? []);
    for (const globalId of event.changedItemIds) {
      readItemIds.add(globalId);
      if (readItemIds.size > MAX_SAVED_FEED_PRESENTATION_IDENTITIES) {
        return true;
      }
    }
  }

  if (SAVED_FEED_USER_STATE_ITEM_PATCH_MUTATIONS.has(event.mutation ?? "")) {
    const userStateIds = new Set(
      (current?.userStates ?? []).map((state) => state.globalId),
    );
    for (const item of event.changedItems) {
      userStateIds.add(item.globalId);
      if (userStateIds.size > MAX_SAVED_FEED_PRESENTATION_IDENTITIES) {
        return true;
      }
    }
  }
  return false;
}

function trackResetSensitiveStoreOperation<T>(operation: Promise<T>): Promise<T> {
  let tracked: Promise<T>;
  tracked = operation.finally(() => activeResetSensitiveStoreOperations.delete(tracked));
  activeResetSensitiveStoreOperations.add(tracked);
  return tracked;
}

function assertDesktopStoreWritable(): void {
  if (!storeAcceptingResetSensitiveWork || isFactoryResetInProgress()) {
    throw new Error("Desktop store is quiesced for factory reset");
  }
}

export type SyncProviderId =
  | "rss"
  | "x"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "substack"
  | "medium"
  | "youtube"
  | "gdrive"
  | "dropbox";

export type ProviderSyncCounts = Record<SyncProviderId, number>;

const EMPTY_PROVIDER_SYNC_COUNTS: ProviderSyncCounts = {
  rss: 0,
  x: 0,
  facebook: 0,
  instagram: 0,
  linkedin: 0,
  substack: 0,
  medium: 0,
  youtube: 0,
  gdrive: 0,
  dropbox: 0,
};

// App state interface
interface AppState {
  // Bounded SQLite query invalidation and visible settings state.
  searchCorpusVersion: number;
  libraryItemVersion: number;
  savedFeedVersion: number;
  savedFeedPresentationPatch: SavedFeedPresentationPatch | null;
  preferences: UserPreferences;
  totalUnreadCount: number;
  unreadCountByPlatform: Record<string, number>;
  totalItemCount: number;
  itemCountByPlatform: Record<string, number>;
  rssFeedCount: number;
  enabledRssFeedCount: number;
  archivedItemCount: number;
  friendPersonCount: number;
  socialAccountCount: number;
  totalArchivableCount: number;
  archivableCountByPlatform: Record<string, number>;
  mapFriendLocationCount: number;
  mapAllContentLocationCount: number;
  visibleFeedTotalCount: number;

  // X auth state
  xAuth: XAuthState;
  // Facebook auth state
  fbAuth: FbAuthState;
  // Instagram auth state
  igAuth: IgAuthState;
  // LinkedIn auth state
  liAuth: LiAuthState;
  // Substack auth state
  substackAuth: SubstackAuthState;
  // Medium auth state
  mediumAuth: MediumAuthState;
  // YouTube auth state
  ytAuth: YouTubeAuthState;

  // UI state
  isLoading: boolean;
  isSyncing: boolean;
  providerSyncCounts: ProviderSyncCounts;
  isInitialized: boolean;
  error: string | null;
  activeFilter: FilterOptions;
  selectedItemId: string | null;
  selectedPersonId: string | null;
  selectedAccountId: string | null;
  selectedFriendId: string | null;
  setVisibleFeedTotalCount: (totalCount: number) => void;

  // Initialization
  initialize: () => Promise<void>;
  acknowledgeSavedFeedPresentationPatch: (
    sourceVersion: number,
    revision: number,
  ) => void;

  // Item actions persisted through typed SQLite mutations.
  addItems: (items: FeedItem[]) => Promise<void>;
  updateItem: (id: string, update: Partial<FeedItem>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markItemsAsRead: (ids: string[]) => Promise<void>;
  markAllAsRead: (platform?: string) => Promise<void>;
  toggleSaved: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  clearSampleData: () => Promise<SampleDataClearSummary>;
  addSampleLibraryData: (data: SampleLibraryData) => Promise<void>;
  toggleArchived: (id: string) => Promise<void>;
  archiveItems: (ids: string[]) => Promise<void>;
  archiveAllReadUnsaved: (platform?: string, feedUrl?: string) => Promise<void>;
  /** Record like intent in SQLite. The outbox processor drains it to the provider. */
  toggleLiked: (id: string) => Promise<void>;

  // Feed actions persisted through typed SQLite mutations.
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string, options?: RemoveFeedOptions) => Promise<void>;
  renameFeed: (url: string, title: string) => Promise<void>;
  removeAllFeeds: (includeItems: boolean) => Promise<void>;

  // Preference actions persisted through typed SQLite mutations.
  updatePreferences: (update: Partial<UserPreferences>) => Promise<void>;

  // X auth actions
  setXAuth: (auth: XAuthState) => void;
  // Facebook auth actions
  setFbAuth: (auth: FbAuthState) => void;
  // Instagram auth actions
  setIgAuth: (auth: IgAuthState) => void;
  // LinkedIn auth actions
  setLiAuth: (auth: LiAuthState) => void;
  // Substack auth actions
  setSubstackAuth: (auth: SubstackAuthState) => void;
  // Medium auth actions
  setMediumAuth: (auth: MediumAuthState) => void;
  // YouTube auth actions
  setYtAuth: (auth: YouTubeAuthState) => void;

  // UI actions (not persisted)
  setFilter: (filter: FilterOptions) => void;
  setSelectedItem: (id: string | null) => void;
  setSelectedPerson: (id: string | null) => void;
  setSelectedAccount: (id: string | null) => void;
  setSelectedFriend: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setProviderSyncing: (provider: SyncProviderId, syncing: boolean) => void;
  setError: (error: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // View navigation
  activeView: "feed" | "friends" | "map" | "storyWall";
  setActiveView: (view: "feed" | "friends" | "map" | "storyWall") => void;
  openMapForPerson: (personId: string) => void;
  pendingMatchCount: number;
  setPendingMatchCount: (count: number) => void;
}

/**
 * Shallow-compare two string-keyed number maps.
 * Preserves object identity on count maps so Zustand selectors that subscribe
 * to these objects don't trigger re-renders when values are unchanged.
 */
function shallowEqualRecord(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const aKeys = Object.keys(a);
  return (
    aKeys.length === Object.keys(b).length && aKeys.every((k) => a[k] === b[k])
  );
}

function runtimeStatePatch(state: LibraryCoreRuntimeStateV1): Pick<
  AppState,
  | "archivableCountByPlatform"
  | "itemCountByPlatform"
  | "rssFeedCount"
  | "enabledRssFeedCount"
  | "archivedItemCount"
  | "friendPersonCount"
  | "socialAccountCount"
  | "mapAllContentLocationCount"
  | "mapFriendLocationCount"
  | "preferences"
  | "searchCorpusVersion"
  | "totalArchivableCount"
  | "totalItemCount"
  | "totalUnreadCount"
  | "unreadCountByPlatform"
> {
  return {
    archivableCountByPlatform: state.archivableCountByPlatform,
    itemCountByPlatform: state.itemCountByPlatform,
    rssFeedCount: state.rssFeedCount,
    enabledRssFeedCount: state.enabledRssFeedCount,
    archivedItemCount: state.archivedItemCount,
    friendPersonCount: state.friendPersonCount,
    socialAccountCount: state.socialAccountCount,
    mapAllContentLocationCount: state.mapAllContentLocationCount,
    mapFriendLocationCount: state.mapFriendLocationCount,
    preferences: state.preferences,
    searchCorpusVersion: state.searchCorpusVersion,
    totalArchivableCount: state.totalArchivableCount,
    totalItemCount: state.totalItemCount,
    totalUnreadCount: state.totalUnreadCount,
    unreadCountByPlatform: state.unreadCountByPlatform,
  };
}

function isMergeablePreferenceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergePreferenceUpdate<T extends object>(
  current: T,
  update: Partial<T>,
): T {
  const next = { ...current };

  for (const key of Object.keys(update) as Array<keyof T>) {
    const currentValue = current[key];
    const updateValue = update[key];
    next[key] = (
      isMergeablePreferenceObject(currentValue) && isMergeablePreferenceObject(updateValue)
        ? mergePreferenceUpdate<Record<string, unknown>>(currentValue, updateValue)
        : updateValue
    ) as T[typeof key];
  }

  return next;
}

function mergeFacebookCapturePreferenceUpdate(
  current: UserPreferences["fbCapture"],
  update: Partial<UserPreferences["fbCapture"]>,
): UserPreferences["fbCapture"] {
  const next: UserPreferences["fbCapture"] = {
    excludedGroupIds: update.excludedGroupIds
      ? { ...update.excludedGroupIds }
      : { ...current.excludedGroupIds },
  };
  const knownGroups = update.knownGroups ?? current.knownGroups;
  if (knownGroups) next.knownGroups = { ...knownGroups };
  return next;
}

function optimisticMutationTestFailure(source: string): Error | null {
  if (import.meta.env.VITE_TEST_TAURI !== "1") return null;
  const hook = (globalThis as unknown as {
    __FREED_FAIL_OPTIMISTIC_MUTATION__?: (source: string) => string | false | null | undefined;
  }).__FREED_FAIL_OPTIMISTIC_MUTATION__;
  const message = hook?.(source);
  return message ? new Error(message) : null;
}

async function runStoreMutation(
  source: string,
  task: () => Promise<void>,
  options: { recordFailure?: boolean; waitForPersistence?: boolean } = {},
): Promise<void> {
  assertDesktopStoreWritable();
  const persist = async () => {
    try {
      const testFailure = optimisticMutationTestFailure(source);
      if (testFailure) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw testFailure;
      }
      await task();
    } catch (error) {
      if (options.recordFailure !== false) {
        const detail = error instanceof Error ? error.message : String(error);
        recordRuntimeError({ source, error, fatal: false });
        recordBugReportEvent(source, "error", "SQLite mutation failed", detail);
      }
      throw error;
    }
  };

  if (options.waitForPersistence === false) {
    void persist().catch(() => {});
    return;
  }
  await persist();
}

/**
 * Run idempotent startup migrations after the app survives launch.
 * The SQLite runtime subscription is already wired up at call time, so
 * mutation invalidations propagate to the UI automatically. Errors are
 * swallowed because archive maintenance is non-fatal. Delaying maintenance
 * keeps startup work away from first paint.
 */
async function runStartupMigrations(archivePruneDays: number): Promise<void> {
  if (!storeAcceptingResetSensitiveWork) return;
  try {
    await healUntitledLibraryFeedTitles();
  } catch { /* non-fatal */ }
  if (!storeAcceptingResetSensitiveWork) return;
  try {
    if (archivePruneDays > 0) {
      await pruneArchivedLibraryItems(archivePruneDays * 24 * 60 * 60 * 1000);
    }
  } catch { /* non-fatal */ }
}

const STARTUP_MAINTENANCE_INITIAL_DELAY_MS = 15 * 60 * 1000;
const READ_MARK_BATCH_DELAY_MS = 50;
const pendingReadIds = new Set<string>();
let readMarkBatchTimer: ReturnType<typeof setTimeout> | null = null;
let readMarkBatchInFlight = false;
let readMarkBatchWaiters: Array<() => void> = [];

function scheduleReadMarkBatchFlush(): void {
  if (
    !storeAcceptingResetSensitiveWork ||
    readMarkBatchTimer ||
    readMarkBatchInFlight ||
    pendingReadIds.size === 0
  ) return;
  readMarkBatchTimer = setTimeout(() => {
    readMarkBatchTimer = null;
    void trackResetSensitiveStoreOperation(flushPendingReadMarks());
  }, READ_MARK_BATCH_DELAY_MS);
}

function recordReadStateFailure(error: unknown, batchSize: number): void {
  const detail = error instanceof Error ? error.message : String(error);
  recordRuntimeError({ source: "desktop:readState", error, fatal: false });
  recordBugReportEvent(
    "desktop:readState",
    "error",
    `Read state update failed for ${batchSize.toLocaleString()} item${batchSize === 1 ? "" : "s"}`,
    detail,
  );
}

function readStateIdTails(ids: readonly string[]): string[] {
  return ids.slice(0, 5).map((id) => `...${id.slice(-8)}`);
}

function recordReadStateInfo(message: string, detail: Record<string, unknown>): void {
  recordBugReportEvent(
    "desktop:readState",
    "info",
    message,
    JSON.stringify(detail),
  );
}

function scheduleStartupMigrations(archivePruneDays: number): void {
  if (!storeAcceptingResetSensitiveWork || startupMaintenanceTimer) return;
  startupMaintenanceTimer = setTimeout(() => {
    startupMaintenanceTimer = null;
    void trackResetSensitiveStoreOperation(runStartupMigrations(archivePruneDays));
  }, STARTUP_MAINTENANCE_INITIAL_DELAY_MS);
}

async function flushPendingReadMarks(): Promise<void> {
  if (readMarkBatchInFlight) return;
  readMarkBatchInFlight = true;

  try {
    while (pendingReadIds.size > 0) {
      const ids = Array.from(pendingReadIds);
      pendingReadIds.clear();

      try {
        await markLibraryItemsAsRead(ids);
      } catch (error) {
        recordReadStateFailure(error, ids.length);
      }
    }
  } finally {
    readMarkBatchInFlight = false;
    const waiters = readMarkBatchWaiters;
    readMarkBatchWaiters = [];
    waiters.forEach((resolve) => resolve());
    scheduleReadMarkBatchFlush();
  }
}

async function collectRssFeedUrls(): Promise<string[]> {
  const urls: string[] = [];
  await scanLibraryCoreRssFeedsV1(
    {
      query: queryNormalizedLibrary,
      randomId: () => crypto.randomUUID(),
    },
    (feeds) => {
      for (const feed of feeds) urls.push(feed.url);
      return "continue";
    },
  );
  return urls;
}

function queueReadMarks(ids: readonly string[], options: { waitForFlush?: boolean } = {}): Promise<void> {
  if (!storeAcceptingResetSensitiveWork) return Promise.resolve();
  const nextIds = ids.filter(Boolean);
  if (nextIds.length === 0) return Promise.resolve();

  for (const id of nextIds) pendingReadIds.add(id);
  scheduleReadMarkBatchFlush();

  if (options.waitForFlush === false) {
    return Promise.resolve();
  }

  const promise = new Promise<void>((resolve) => {
    readMarkBatchWaiters.push(resolve);
  });

  return promise;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  searchCorpusVersion: 0,
  libraryItemVersion: 0,
  savedFeedVersion: 0,
  savedFeedPresentationPatch: null,
  preferences: createDefaultPreferences(),
  totalUnreadCount: 0,
  unreadCountByPlatform: {},
  totalItemCount: 0,
  itemCountByPlatform: {},
  rssFeedCount: 0,
  enabledRssFeedCount: 0,
  archivedItemCount: 0,
  friendPersonCount: 0,
  socialAccountCount: 0,
  totalArchivableCount: 0,
  archivableCountByPlatform: {},
  mapFriendLocationCount: 0,
  mapAllContentLocationCount: 0,
  visibleFeedTotalCount: 0,
  xAuth: { isAuthenticated: false },
  fbAuth: { isAuthenticated: false },
  igAuth: { isAuthenticated: false },
  liAuth: { isAuthenticated: false },
  substackAuth: { isAuthenticated: false },
  mediumAuth: { isAuthenticated: false },
  ytAuth: { isAuthenticated: false },
  isLoading: true,
  isSyncing: false,
  providerSyncCounts: { ...EMPTY_PROVIDER_SYNC_COUNTS },
  isInitialized: false,
  error: null,
  activeFilter: {},
  selectedItemId: null,
  selectedPersonId: null,
  selectedAccountId: null,
  selectedFriendId: null,
  searchQuery: "",
  activeView: "feed",
  pendingMatchCount: 0,
  setVisibleFeedTotalCount: (totalCount) => {
    set({ visibleFeedTotalCount: totalCount });
  },
  acknowledgeSavedFeedPresentationPatch: (sourceVersion, revision) => {
    set((state) =>
      state.savedFeedPresentationPatch?.sourceVersion === sourceVersion &&
      state.savedFeedPresentationPatch.revision === revision
        ? { savedFeedPresentationPatch: null }
        : state,
    );
  },

  // Initialize from the native SQLite Library.
  initialize: () => {
    assertDesktopStoreWritable();
    if (get().isInitialized) return Promise.resolve();
    if (appInitializationPromise) return appInitializationPromise;

    appInitializationPromise = (async () => {
      try {
        set({ isLoading: true });

        // Prime the pre-initialization memory probe before Library Core starts.
        // This is intentionally fire-and-forget: telemetry must never delay
        // startup. The Library-load marker below rejects a late result.
        void capturePreLibraryMemoryBaseline();
        const desktopClientRegistration = await getOrCreateDesktopClientRegistration();

        recordLibraryRuntimeLoadStarted();
        assertDesktopStoreWritable();
        const runtimeState = await initializeDesktopLibraryRuntime(
          desktopClientRegistration,
        );
        // Close the startup-baseline window. Any memory sample after this point
        // includes the active Library Core runtime, so it cannot be a baseline.
        recordLibraryRuntimeReady();
        assertDesktopStoreWritable();
        migrateLegacyDeviceDisplayPreferences(runtimeState.preferences.display);
        migrateLegacyThemePreference(runtimeState.preferences.display.themeId);
        migrateLegacyDeviceAIPreferences(runtimeState.preferences.ai);
        await migrateLegacyDeviceGraphLayoutToSqlite({
          mutate: mutateNormalizedDeviceGraphLayout,
          query: queryNormalizedLibrary,
        });
        migrateLegacyFacebookGroupDiscovery(
          runtimeState.preferences.fbCapture?.knownGroups,
        );

        // Subscribe to bounded SQLite state updates. Preserve object identity on
        // count maps to avoid spurious selector re-renders.
        librarySubscriptionTeardown?.();
        librarySubscriptionTeardown = subscribeDesktopLibraryRuntime((state, event) => {
          if (!storeAcceptingResetSensitiveWork || isFactoryResetInProgress()) return;
          const prev = get();
          const libraryItemVersion =
            event.source === "item_patch" || event.source === "state_update"
              ? prev.libraryItemVersion + 1
              : prev.libraryItemVersion;
          const savedFeedPresentationPatchOverflow =
            event.source === "item_patch" &&
            savedFeedPresentationPatchExceedsLimit(
              prev.savedFeedPresentationPatch,
              prev.savedFeedVersion,
              event,
            );
          // Preference patches preserve every untouched nested object. A new
          // weights identity therefore means the native recommended order is
          // stale, while display, capture, and other preference noise can stay
          // on the current bounded Saved generation.
          const savedFeedRankingWeightsChanged =
            event.source === "preferences_patch" &&
            state.preferences.weights !== prev.preferences.weights;
          const savedFeedVersion =
            event.source === "state_update" ||
            savedFeedRankingWeightsChanged ||
            (event.source === "item_patch" &&
              (!SAVED_FEED_HARMLESS_ITEM_PATCH_MUTATIONS.has(
                event.mutation ?? "",
              ) ||
                savedFeedPresentationPatchOverflow))
              ? prev.savedFeedVersion + 1
              : prev.savedFeedVersion;
          const savedFeedPresentationPatch =
            event.source === "item_patch" &&
            !savedFeedPresentationPatchOverflow &&
            SAVED_FEED_HARMLESS_ITEM_PATCH_MUTATIONS.has(
              event.mutation ?? "",
            )
              ? mergeSavedFeedPresentationPatch(
                  prev.savedFeedPresentationPatch,
                  savedFeedVersion,
                  event,
                )
              : savedFeedVersion !== prev.savedFeedVersion
                ? null
                : prev.savedFeedPresentationPatch;
          let next: Partial<AppState> = {
            ...runtimeStatePatch(state),
            libraryItemVersion,
            savedFeedPresentationPatch,
            savedFeedVersion,
          };

          if (shallowEqualRecord(state.unreadCountByPlatform, prev.unreadCountByPlatform))
            next = { ...next, unreadCountByPlatform: prev.unreadCountByPlatform };
          if (shallowEqualRecord(state.itemCountByPlatform, prev.itemCountByPlatform))
            next = { ...next, itemCountByPlatform: prev.itemCountByPlatform };
          set(next);
        });

        const xCookies = loadStoredCookies();
        const xAuth = xCookies
          ? { isAuthenticated: true, cookies: xCookies }
          : { isAuthenticated: false };

        let fbAuth = initFbAuth();
        let igAuth = initIgAuth();
        let liAuth = initLiAuth();
        const substackAuth = initSubstackAuth();
        const mediumAuth = initMediumAuth();
        const ytAuth = initYouTubeAuth();

        if (isTauri() || import.meta.env.VITE_TEST_TAURI === "1") {
          const previousAuth = { fbAuth, igAuth, liAuth };
          const reconciledAuth = await reconcileSocialAuthStateHints({ fbAuth, igAuth, liAuth });
          assertDesktopStoreWritable();
          fbAuth = reconciledAuth.fbAuth;
          igAuth = reconciledAuth.igAuth;
          liAuth = reconciledAuth.liAuth;
          if (fbAuth !== previousAuth.fbAuth) storeFbAuthState(fbAuth);
          if (igAuth !== previousAuth.igAuth) storeIgAuthState(igAuth);
          if (liAuth !== previousAuth.liAuth) storeLiAuthState(liAuth);
        }

        // Initialize immediately from the row-free SQLite runtime snapshot.
        set({
          ...runtimeStatePatch(runtimeState),
          activeFilter: applyFeedSignalModesToFilter(
            get().activeFilter,
            getDeviceDisplayPreferences().feedSignalModes,
          ),
          xAuth,
          fbAuth,
          igAuth,
          liAuth,
          substackAuth,
          mediumAuth,
          ytAuth,
          savedFeedPresentationPatch: null,
          isInitialized: true,
          isLoading: false,
        });

        // Tear down any previous outbox (guard against double-init).
        outboxTeardown?.();
        const xCookiesFn = () => {
          const state = get();
          return state.xAuth.isAuthenticated && state.xAuth.cookies
            ? state.xAuth.cookies
            : null;
        };
        const platformActionsRegistry = buildPlatformActionsRegistry(xCookiesFn);
        outboxTeardown = startOutboxProcessor(
          scanLibraryCoreItems,
          (cb) =>
            subscribeDesktopLibraryRuntime((_state, event) => cb(event)),
          platformActionsRegistry,
          async (id, syncedAt) => { await confirmLibraryItemLikedSynced(id, syncedAt); },
          async (id, syncedAt) => { await confirmLibraryItemSeenSynced(id, syncedAt); },
        );

        // Schedule bounded local SQLite maintenance after Library startup.
        const archivePruneDays =
          runtimeState.preferences.display.archivePruneDays ?? 30;
        scheduleStartupMigrations(archivePruneDays);
      } catch (error) {
        recordRuntimeError({ source: "desktop:initialize", error, fatal: false });
        recordBugReportEvent("desktop:initialize", "error", "Initialization failed");
        set({
          error: error instanceof Error ? error.message : "Failed to initialize",
          isLoading: false,
        });
      }
    })().finally(() => {
      appInitializationPromise = null;
    });

    return appInitializationPromise;
  },

  // Item actions
  addItems: async (items) => {
    const before = get().totalItemCount;
    await addLibraryFeedItems(items);
    const after = get().totalItemCount;
    log.info(
      `[store] addItems requested=${items.length.toLocaleString()} before=${before.toLocaleString()} after=${after.toLocaleString()} added=${Math.max(0, after - before).toLocaleString()}`,
    );
  },

  updateItem: async (id, update) => {
    await runStoreMutation(
      "desktop:updateItem",
      () => updateLibraryFeedItem(id, update),
    );
  },

  markAsRead: async (id) => {
    await queueReadMarks([id], { waitForFlush: false });
  },

  markItemsAsRead: async (ids) => {
    const nextIds = ids.filter(Boolean);
    if (nextIds.length === 0) return;

    const startedAt = performance.now();
    const beforeUnreadCount = get().totalUnreadCount;
    recordReadStateInfo(
      `Queued ${nextIds.length.toLocaleString()} read mark${nextIds.length === 1 ? "" : "s"}`,
      {
        queuedCount: nextIds.length,
        beforeUnreadCount,
        itemIdTails: readStateIdTails(nextIds),
      },
    );

    try {
      await runStoreMutation(
        "desktop:readState",
        () => queueReadMarks(nextIds),
        { recordFailure: false },
      );
      recordReadStateInfo(
        `Flushed ${nextIds.length.toLocaleString()} read mark${nextIds.length === 1 ? "" : "s"}`,
        {
          batchCount: nextIds.length,
          beforeUnreadCount,
          afterUnreadCount: get().totalUnreadCount,
          durationMs: Math.round(performance.now() - startedAt),
          itemIdTails: readStateIdTails(nextIds),
        },
      );
    } catch (error) {
      recordReadStateFailure(error, nextIds.length);
      throw error;
    }
  },

  markAllAsRead: async (platform) => {
    await runStoreMutation(
      "desktop:markAllAsRead",
      () => markAllLibraryItemsAsRead(platform),
    );
  },

  toggleSaved: async (id) => {
    const item =
      (await readLibraryCoreItemDetail(id).catch(() => null)) ?? undefined;
    const itemToPin = item && !item.userState.saved ? item : null;
    await runStoreMutation(
      "desktop:toggleSaved",
      () => toggleLibraryItemSaved(id),
    );
    if (itemToPin) {
      void pinReaderItem(itemToPin).catch((error) => {
        recordRuntimeError({
          source: "desktop:pinReaderItem",
          error: error instanceof Error ? error : new Error(String(error)),
          fatal: false,
        });
      });
    }
  },

  toggleArchived: async (id) => {
    await runStoreMutation(
      "desktop:toggleArchived",
      () => toggleLibraryItemArchived(id),
      { waitForPersistence: false },
    );
  },

  archiveItems: async (ids) => {
    await runStoreMutation(
      "desktop:archiveItems",
      () => archiveLibraryItems(ids),
    );
  },

  toggleLiked: async (id) => {
    await runStoreMutation(
      "desktop:toggleLiked",
      () => toggleLibraryItemLiked(id),
      { waitForPersistence: false },
    );
    // The outbox processor will pick up the pending like on its next drain.
  },

  archiveAllReadUnsaved: async (platform, feedUrl) => {
    await runStoreMutation(
      "desktop:archiveAllReadUnsaved",
      () => archiveAllReadUnsavedLibraryItems(platform, feedUrl),
    );
  },

  unarchiveSavedItems: async () => {
    await unarchiveSavedLibraryItems();
  },

  deleteAllArchived: async () => {
    await deleteAllArchivedLibraryItems();
  },

  removeItem: async (id) => {
    await runStoreMutation(
      "desktop:removeItem",
      () => removeLibraryFeedItem(id),
    );
  },

  clearSampleData: async () => {
    return clearSampleLibraryData();
  },

  addSampleLibraryData: async (data: SampleLibraryData) => {
    await addSampleLibraryData({
      feeds: data.feeds,
      items: data.items,
      persons: data.persons,
      accounts: data.accounts,
    });
  },

  // Feed actions
  addFeed: async (feed) => {
    await addLibraryRssFeed(feed);
  },

  removeFeed: async (url, options) => {
    await removeLibraryRssFeed(url, options?.includeItems ?? false);
    const { removeRssRuntimeState } = await import("./rss-runtime-state");
    removeRssRuntimeState(url);
    const { forgetRssFeedHealth } = await import("./provider-health");
    await forgetRssFeedHealth(url);
  },

  removeAllFeeds: async (includeItems) => {
    const feedUrls = await collectRssFeedUrls();
    await removeAllLibraryFeeds(includeItems);
    const { removeRssRuntimeState } = await import("./rss-runtime-state");
    for (const url of feedUrls) removeRssRuntimeState(url);
    const { forgetRssFeedHealth } = await import("./provider-health");
    await Promise.all(feedUrls.map((url) => forgetRssFeedHealth(url)));
  },

  renameFeed: async (url, title) => {
    await runStoreMutation(
      "desktop:renameFeed",
      () => updateLibraryRssFeed(url, { title }),
    );
  },

  // Preference actions
  updatePreferences: async (update) => {
    assertDesktopStoreWritable();
    const localUpdate = getDeviceLocalPreferenceUpdates(update);
    if (localUpdate.display && !setDeviceDisplayPreferences(localUpdate.display)) {
      throw new Error("Freed could not save the display settings on this device.");
    }
    if (localUpdate.ai && !setDeviceAIPreferences(localUpdate.ai)) {
      throw new Error("Freed could not save the AI settings on this device.");
    }
    const syncedUpdate = stripDeviceLocalPreferenceUpdates(update);
    if (Object.keys(syncedUpdate).length === 0) return;
    const currentPreferences = get().preferences;
    const nextPreferences = mergePreferenceUpdate(currentPreferences, syncedUpdate);
    if (syncedUpdate.fbCapture !== undefined) {
      nextPreferences.fbCapture = mergeFacebookCapturePreferenceUpdate(
        currentPreferences.fbCapture,
        syncedUpdate.fbCapture,
      );
    }

    try {
      set({ preferences: nextPreferences });
      await runStoreMutation(
        "desktop:updatePreferences",
        () => updateLibraryPreferences(syncedUpdate),
        { recordFailure: false },
      );
    } catch (error) {
      set({ preferences: currentPreferences });
      const detail = error instanceof Error ? error.message : String(error);
      recordRuntimeError({ source: "desktop:updatePreferences", error, fatal: false });
      recordBugReportEvent(
        "desktop:updatePreferences",
        "error",
        "Preference update failed",
        detail,
      );
      throw error;
    }
  },

  // X auth actions
  setXAuth: (auth) => set({ xAuth: auth }),
  // Facebook auth actions
  setFbAuth: (auth) => set({ fbAuth: auth }),
  // Instagram auth actions
  setIgAuth: (auth) => set({ igAuth: auth }),
  // LinkedIn auth actions
  setLiAuth: (auth) => set({ liAuth: auth }),
  // Substack auth actions
  setSubstackAuth: (auth) => set({ substackAuth: auth }),
  // Medium auth actions
  setMediumAuth: (auth) => set({ mediumAuth: auth }),
  // YouTube auth actions
  setYtAuth: (auth) => set({ ytAuth: auth }),

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setSelectedPerson: (id) => set({ selectedPersonId: id, selectedAccountId: null, selectedFriendId: id }),
  setSelectedAccount: (id) => set({ selectedPersonId: null, selectedAccountId: id, selectedFriendId: null }),
  setSelectedFriend: (id) => set({ selectedPersonId: id, selectedAccountId: null, selectedFriendId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setProviderSyncing: (provider, syncing) =>
    set((state) => ({
      providerSyncCounts: {
        ...state.providerSyncCounts,
        [provider]: Math.max(
          0,
          (state.providerSyncCounts[provider] ?? 0) + (syncing ? 1 : -1),
        ),
      },
    })),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveView: (activeView) => set({ activeView }),
  openMapForPerson: (personId) =>
    set({
      activeView: "map",
      selectedPersonId: personId,
      selectedAccountId: null,
      selectedFriendId: personId,
      selectedItemId: null,
    }),
  setPendingMatchCount: (pendingMatchCount) => set({ pendingMatchCount }),
}));

async function runWithProviderSyncing<T>(
  provider: SyncProviderId,
  task: () => Promise<T>,
): Promise<T> {
  const label = BACKGROUND_CHANNEL_LABELS[provider];
  const activityId = startBackgroundActivity({
    id: `channel:${provider}`,
    kind: "channel",
    channelId: provider,
    label,
    message: `${label} sync started.`,
  });
  useAppStore.getState().setProviderSyncing(provider, true);
  try {
    const result = await task();
    finishBackgroundActivity(activityId, "success", `${label} sync finished.`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishBackgroundActivity(activityId, "error", `${label} sync failed: ${message}`);
    throw error;
  } finally {
    useAppStore.getState().setProviderSyncing(provider, false);
  }
}

export function withProviderSyncing<T>(
  provider: SyncProviderId,
  task: () => Promise<T>,
): Promise<T> {
  if (!storeAcceptingResetSensitiveWork) {
    return Promise.reject(new Error("Provider sync is being reset"));
  }
  return trackResetSensitiveStoreOperation(runWithProviderSyncing(provider, task));
}

/** Stop every store-owned writer and wait for already-issued work before Library deletion. */
export async function quiesceDesktopStoreForFactoryReset(): Promise<void> {
  storeAcceptingResetSensitiveWork = false;
  librarySubscriptionTeardown?.();
  librarySubscriptionTeardown = null;

  if (startupMaintenanceTimer) {
    clearTimeout(startupMaintenanceTimer);
    startupMaintenanceTimer = null;
  }
  if (readMarkBatchTimer) {
    clearTimeout(readMarkBatchTimer);
    readMarkBatchTimer = null;
  }
  pendingReadIds.clear();
  const readWaiters = readMarkBatchWaiters;
  readMarkBatchWaiters = [];
  readWaiters.forEach((resolve) => resolve());

  await quiesceDesktopLibraryForFactoryReset();

  const results = await Promise.allSettled([
    stopAndDrainOutboxProcessor(),
    appInitializationPromise ?? Promise.resolve(),
    waitForFactoryResetDrain(
      () => Array.from(activeResetSensitiveStoreOperations),
      "Desktop store operations",
      FACTORY_RESET_DRAIN_TIMEOUT_MS,
    ),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  outboxTeardown = null;
  if (failure) throw failure.reason;
}
