/**
 * Global app state management with Zustand
 *
 * State is synced with Automerge CRDT for persistence and multi-device sync.
 *
 * After the Web Worker migration (Phase 4), all CRDT and hydration work runs
 * in automerge.worker.ts. The subscriber here receives a pre-hydrated DocState
 * and calls set() directly - zero hydrateFromDoc cost on the main thread.
 */

import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import type { Account, FeedItem, FilterOptions, Friend, Person, ReachOutLog, SampleDataClearSummary, SampleLibraryData, UserPreferences, RssFeed, RemoveFeedOptions } from "@freed/shared";
import {
  applyFeedSignalModesToFilter,
  accountsFromLegacyFriend,
  buildConnectionPersonDraftFromAccounts,
  createDefaultPreferences,
  getDeviceLocalGraphPositionUpdates,
  getDeviceLocalPreferenceUpdates,
  isPrunableConnectionPerson,
  personFromLegacyFriend,
  stripDeviceLocalPreferenceUpdates,
  stripDeviceLocalGraphPositionUpdates,
} from "@freed/shared";
import {
  migrateLegacyDeviceAIPreferences,
  setDeviceAIPreferences,
} from "@freed/ui/lib/device-ai-preferences";
import {
  migrateLegacyDeviceDisplayPreferences,
  setDeviceDisplayPreferences,
} from "@freed/ui/lib/device-display-preferences";
import {
  applyDeviceAccountGraphPositionUpdate,
  applyDevicePersonGraphPositionUpdate,
  getDeviceGraphLayout,
  migrateLegacyDeviceGraphLayout,
  pruneDeviceGraphLayout,
  restoreReplacedDeviceAccountGraphPositions,
} from "@freed/ui/lib/device-graph-layout";
import { migrateLegacyFacebookGroupDiscovery } from "./facebook-group-discovery";
import {
  projectArchiveAllReadUnsaved,
  projectArchiveItems,
  projectMarkAllAsRead,
  projectMarkItemsAsRead,
  projectRemoveItem,
  projectRenameFeed,
  projectToggleArchived,
  projectToggleLiked,
  projectToggleSaved,
  projectUpdateAccount,
  projectUpdateItem,
  projectUpdatePerson,
  rollbackOptimisticPatch,
  type OptimisticPatch,
} from "@freed/shared/optimistic-state";
import {
  initDoc,
  subscribe,
  getDocState,
  docAddFeedItems,
  docAddSampleLibraryData,
  docAddRssFeed,
  docRemoveRssFeed,
  docRemoveAllFeeds,
  docUpdateRssFeed,
  docUpdateFeedItem,
  docMarkItemsAsRead,
  docMarkAllAsRead,
  docToggleSaved,
  docRemoveFeedItem,
  docClearSampleData,
  docToggleArchived,
  docArchiveItems,
  docArchiveAllReadUnsaved,
  docUnarchiveSavedItems,
  docDeleteAllArchived,
  docPruneArchivedItems,
  docUpdatePreferences,
  docBackfillContentSignals,
  docDeduplicateFeedItems,
  docHealUntitledFeedTitles,
  docAddAccount,
  docAddAccounts,
  docAddPerson,
  docAddPersons,
  docUpdateAccount,
  docUpdatePerson,
  docUpsertConnectionPersons,
  docRemoveAccount,
  docRemovePerson,
  docLogReachOut,
  docToggleLiked,
  docConfirmLikedSynced,
  docConfirmSeenSynced,
  quiesceDesktopAutomergeForFactoryReset,
  type DocState,
} from "./automerge";
import { buildPlatformActionsRegistry } from "./platform-actions";
import {
  startOutboxProcessor,
  stopAndDrainOutboxProcessor,
} from "./outbox";
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
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator";
import { log } from "./logger";
import { initFbAuth, storeFbAuthState, type FbAuthState } from "./fb-auth";
import { initIgAuth, storeIgAuthState, type IgAuthState } from "./instagram-auth";
import { initLiAuth, storeLiAuthState, type LiAuthState } from "./li-auth";
import { initSubstackAuth, type SubstackAuthState } from "./substack-auth";
import { initMediumAuth, type MediumAuthState } from "./medium-auth";
import { initYouTubeAuth, type YouTubeAuthState } from "./youtube-auth";
import { reconcileSocialAuthStateHints } from "./social-auth-cookie-state";
import { getOrCreateDesktopClientRegistration } from "./desktop-client-registration";
import {
  isFactoryResetInProgress,
  waitForFactoryResetDrain,
} from "@freed/ui/lib/factory-reset";

let outboxTeardown: (() => void) | null = null;
let startupMaintenanceTimer: ReturnType<typeof setTimeout> | null = null;
let startupContentSignalTimer: ReturnType<typeof setTimeout> | null = null;
let startupContentSignalBackfillRunning = false;
let appInitializationPromise: Promise<void> | null = null;
let documentSubscriptionTeardown: (() => void) | null = null;
let storeAcceptingResetSensitiveWork = true;
const activeResetSensitiveStoreOperations = new Set<Promise<unknown>>();
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 180_000;

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
  // Data (received pre-hydrated from Automerge worker as DocState)
  items: FeedItem[];
  searchCorpusVersion: number;
  feeds: Record<string, RssFeed>;
  persons: Record<string, Person>;
  accounts: Record<string, Account>;
  friends: Record<string, Friend>;
  preferences: UserPreferences;
  desktopClientIds: string[];
  feedUnreadCounts: Record<string, number>;
  feedTotalCounts: Record<string, number>;
  totalUnreadCount: number;
  unreadCountByPlatform: Record<string, number>;
  totalItemCount: number;
  itemCountByPlatform: Record<string, number>;
  totalArchivableCount: number;
  archivableCountByPlatform: Record<string, number>;
  archivableFeedCounts: Record<string, number>;
  mapFriendLocationCount: number;
  mapAllContentLocationCount: number;
  /** Total feed-item records including hidden and archived items. */
  docItemCount: number;

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

  // Initialization
  initialize: () => Promise<void>;

  // Item actions (persisted to Automerge)
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
  /** Record like intent in Automerge. Outbox processor drains to platform. */
  toggleLiked: (id: string) => Promise<void>;

  // Feed actions (persisted to Automerge)
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string, options?: RemoveFeedOptions) => Promise<void>;
  renameFeed: (url: string, title: string) => Promise<void>;
  removeAllFeeds: (includeItems: boolean) => Promise<void>;

  // Friend actions (persisted to Automerge)
  addPerson: (person: Person) => Promise<void>;
  addPersons: (persons: Person[]) => Promise<void>;
  updatePerson: (id: string, updates: Partial<Person>) => Promise<void>;
  removePerson: (id: string) => Promise<void>;
  addFriend: (friend: Friend) => Promise<void>;
  addFriends: (friends: Friend[]) => Promise<void>;
  updateFriend: (id: string, updates: Partial<Friend>) => Promise<void>;
  removeFriend: (id: string) => Promise<void>;
  logReachOut: (id: string, entry: ReachOutLog) => Promise<void>;
  addAccount: (account: Account) => Promise<void>;
  addAccounts: (accounts: Account[]) => Promise<void>;
  updateAccount: (id: string, updates: Partial<Account>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  linkAccountToPerson: (accountId: string, personId: string | null) => Promise<void>;
  createConnectionPersonFromAccounts: (accountIds: string[], person?: Person) => Promise<string>;
  createConnectionPersonsFromCandidates: (
    candidates: Array<{ person: Person; accountIds: string[] }>,
  ) => Promise<number>;

  // Preference actions (persisted to Automerge)
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

function optimisticBefore(state: AppState, patch: OptimisticPatch): OptimisticPatch {
  const before: OptimisticPatch = {};
  for (const key of Object.keys(patch) as Array<keyof OptimisticPatch>) {
    before[key] = state[key] as never;
  }
  return before;
}

function optimisticMutationTestFailure(source: string): Error | null {
  if (import.meta.env.VITE_TEST_TAURI !== "1") return null;
  const hook = (globalThis as unknown as {
    __FREED_FAIL_OPTIMISTIC_MUTATION__?: (source: string) => string | false | null | undefined;
  }).__FREED_FAIL_OPTIMISTIC_MUTATION__;
  const message = hook?.(source);
  return message ? new Error(message) : null;
}

async function runOptimisticMutation(
  getState: () => AppState,
  setState: (patch: Partial<AppState>) => void,
  source: string,
  project: (state: AppState) => OptimisticPatch | null,
  task: () => Promise<void>,
  options: { recordFailure?: boolean; waitForPersistence?: boolean } = {},
): Promise<void> {
  assertDesktopStoreWritable();
  const projected = project(getState());
  if (!projected) {
    if (options.waitForPersistence === false) {
      void task().catch((error) => {
        if (options.recordFailure !== false) {
          const detail = error instanceof Error ? error.message : String(error);
          recordRuntimeError({ source, error, fatal: false });
          recordBugReportEvent(source, "error", "Optimistic mutation failed", detail);
        }
      });
      return;
    }
    await task();
    return;
  }

  const before = optimisticBefore(getState(), projected);
  setState(projected as Partial<AppState>);

  const persist = async () => {
    try {
      const testFailure = optimisticMutationTestFailure(source);
      if (testFailure) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw testFailure;
      }
      await task();
    } catch (error) {
      const rollback = rollbackOptimisticPatch(getState(), before, projected);
      if (rollback) {
        setState(rollback as Partial<AppState>);
      }
      if (options.recordFailure !== false) {
        const detail = error instanceof Error ? error.message : String(error);
        recordRuntimeError({ source, error, fatal: false });
        recordBugReportEvent(source, "error", "Optimistic mutation failed", detail);
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

async function pruneConnectionPersonIfNeeded(
  getState: () => AppState,
  personId: string | null | undefined,
  ignoredAccountIds: string[] = [],
): Promise<void> {
  const state = getState();
  if (!isPrunableConnectionPerson(state.persons, state.accounts, personId, ignoredAccountIds)) {
    return;
  }
  await docRemovePerson(personId!);
}

/**
 * Run idempotent startup migrations after the app survives launch.
 * subscribe() is already wired up at call time, so any doc mutations propagate
 * to the UI automatically. Errors are swallowed - all three ops are non-fatal.
 * Migrations run in the worker, but WebKit still owns worker memory. Delaying
 * them keeps large libraries from immediately reloading the Automerge document
 * right after first paint.
 */
async function runStartupMigrations(archivePruneDays: number): Promise<void> {
  if (!storeAcceptingResetSensitiveWork) return;
  try {
    await docHealUntitledFeedTitles();
  } catch { /* non-fatal */ }
  if (!storeAcceptingResetSensitiveWork) return;
  try {
    await docDeduplicateFeedItems();
  } catch { /* non-fatal */ }
  if (!storeAcceptingResetSensitiveWork) return;
  try {
    if (archivePruneDays > 0) {
      await docPruneArchivedItems(archivePruneDays * 24 * 60 * 60 * 1000);
    }
  } catch { /* non-fatal */ }
  scheduleStartupContentSignalBackfill(STARTUP_CONTENT_SIGNAL_INITIAL_DELAY_MS);
}

function hasStoredCloudSyncCredentials(): boolean {
  try {
    return (
      localStorage.getItem("freed_cloud_token_meta_gdrive") !== null ||
      localStorage.getItem("freed_cloud_token_meta_dropbox") !== null
    );
  } catch {
    return false;
  }
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

const STARTUP_CONTENT_SIGNAL_INITIAL_DELAY_MS = 10 * 60 * 1000;
const STARTUP_CONTENT_SIGNAL_RETRY_DELAY_MS = 30 * 1000;
const STARTUP_CONTENT_SIGNAL_INTERVAL_MS = 60 * 1000;
const STARTUP_CONTENT_SIGNAL_BATCH_SIZE = 50;

function scheduleStartupMigrations(archivePruneDays: number): void {
  if (!storeAcceptingResetSensitiveWork || startupMaintenanceTimer) return;
  startupMaintenanceTimer = setTimeout(() => {
    startupMaintenanceTimer = null;
    void trackResetSensitiveStoreOperation(runStartupMigrations(archivePruneDays));
  }, STARTUP_MAINTENANCE_INITIAL_DELAY_MS);
}

function scheduleStartupContentSignalBackfill(delayMs: number): void {
  if (!storeAcceptingResetSensitiveWork || startupContentSignalTimer) return;
  startupContentSignalTimer = setTimeout(() => {
    startupContentSignalTimer = null;
    void trackResetSensitiveStoreOperation(runStartupContentSignalBackfill());
  }, delayMs);
}

async function runStartupContentSignalBackfill(): Promise<void> {
  if (!storeAcceptingResetSensitiveWork || startupContentSignalBackfillRunning) return;
  startupContentSignalBackfillRunning = true;

  try {
    const summary = await runBackgroundJob({
      kind: "content-signal-backfill",
      source: "startup-migration",
      blocking: false,
      timeoutMs: 120_000,
      run: () => trackResetSensitiveStoreOperation(
        docBackfillContentSignals(STARTUP_CONTENT_SIGNAL_BATCH_SIZE),
      ),
    });

    if (summary.updated > 0) {
      log.info(
        `[content-signals] startup backfilled ${summary.updated.toLocaleString()} item${summary.updated === 1 ? "" : "s"}, ${summary.remaining.toLocaleString()} remaining`,
      );
    }

    if (summary.remaining > 0) {
      scheduleStartupContentSignalBackfill(STARTUP_CONTENT_SIGNAL_INTERVAL_MS);
    }
  } catch (error) {
    if (isBackgroundRuntimeDeferredError(error)) {
      log.info(`[content-signals] startup backfill deferred reason=${error.reason}`);
      scheduleStartupContentSignalBackfill(STARTUP_CONTENT_SIGNAL_RETRY_DELAY_MS);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[content-signals] startup backfill failed err=${message}`);
  } finally {
    startupContentSignalBackfillRunning = false;
  }
}

async function flushPendingReadMarks(): Promise<void> {
  if (readMarkBatchInFlight) return;
  readMarkBatchInFlight = true;

  try {
    while (pendingReadIds.size > 0) {
      const ids = Array.from(pendingReadIds);
      pendingReadIds.clear();

      try {
        await docMarkItemsAsRead(ids);
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
  items: [],
  searchCorpusVersion: 0,
  feeds: {},
  persons: {},
  accounts: {},
  friends: {},
  preferences: createDefaultPreferences(),
  desktopClientIds: [],
  feedUnreadCounts: {},
  feedTotalCounts: {},
  totalUnreadCount: 0,
  unreadCountByPlatform: {},
  totalItemCount: 0,
  itemCountByPlatform: {},
  totalArchivableCount: 0,
  archivableCountByPlatform: {},
  archivableFeedCounts: {},
  mapFriendLocationCount: 0,
  mapAllContentLocationCount: 0,
  docItemCount: 0,
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

  // Initialize from Automerge worker
  initialize: () => {
    assertDesktopStoreWritable();
    if (get().isInitialized) return Promise.resolve();
    if (appInitializationPromise) return appInitializationPromise;

    appInitializationPromise = (async () => {
      try {
        set({ isLoading: true });

        // initDoc() now returns DocState (pre-hydrated, WASM ran in worker).
        const desktopClientRegistration = await getOrCreateDesktopClientRegistration();
        assertDesktopStoreWritable();
        const docState = await initDoc(desktopClientRegistration);
        assertDesktopStoreWritable();
        migrateLegacyDeviceDisplayPreferences(docState.preferences.display);
        migrateLegacyDeviceAIPreferences(docState.preferences.ai);
        migrateLegacyDeviceGraphLayout(docState.persons, docState.accounts);
        migrateLegacyFacebookGroupDiscovery(docState.preferences.fbCapture?.knownGroups);

        // Subscribe to future state updates from the worker. Each update is already
        // hydrated - no hydrateFromDoc(), no sort, no rank on the main thread.
        // Preserve object identity on count maps to avoid spurious selector re-renders.
        documentSubscriptionTeardown?.();
        documentSubscriptionTeardown = subscribe((state: DocState, event) => {
          if (!storeAcceptingResetSensitiveWork || isFactoryResetInProgress()) return;
          if (
            event.mutation === "MERGE_DOC"
            || event.mutation === "REPLACE_DOC"
            || event.mutation === "REMOVE_PERSON"
            || event.mutation === "REMOVE_ACCOUNT"
          ) {
            pruneDeviceGraphLayout(state.persons, state.accounts);
          }
          const prev = get();
          let next: Partial<AppState> = { ...state };

          if (shallowEqualRecord(state.feedUnreadCounts, prev.feedUnreadCounts))
            next = { ...next, feedUnreadCounts: prev.feedUnreadCounts };
          if (shallowEqualRecord(state.feedTotalCounts, prev.feedTotalCounts))
            next = { ...next, feedTotalCounts: prev.feedTotalCounts };
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

        // Hydrate immediately from the initial DocState returned by the worker.
        set({
          ...docState,
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
          () => getDocState()?.items ?? null,
          (cb) => subscribe((_state, event) => cb(event)),
          platformActionsRegistry,
          async (id, syncedAt) => { await docConfirmLikedSynced(id, syncedAt); },
          async (id, syncedAt) => { await docConfirmSeenSynced(id, syncedAt); },
        );

        // Do not mutate the local doc before cloud sync has reconciled it.
        if (!hasStoredCloudSyncCredentials()) {
          // Run cleanup migrations later. On large local libraries, immediate
          // maintenance can force another full Automerge load while the renderer is
          // still recovering from initial hydration.
          scheduleStartupMigrations(docState.preferences.display.archivePruneDays ?? 30);
        }
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
    const before = get().items.length;
    await docAddFeedItems(items);
    const after = get().items.length;
    log.info(
      `[store] addItems requested=${items.length.toLocaleString()} before=${before.toLocaleString()} after=${after.toLocaleString()} added=${Math.max(0, after - before).toLocaleString()}`,
    );
  },

  updateItem: async (id, update) => {
    await runOptimisticMutation(
      get,
      set,
      "desktop:updateItem",
      (state) => projectUpdateItem(state, id, update),
      () => docUpdateFeedItem(id, update),
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
      await runOptimisticMutation(
        get,
        set,
        "desktop:readState",
        (state) => projectMarkItemsAsRead(state, nextIds),
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
    await runOptimisticMutation(
      get,
      set,
      "desktop:markAllAsRead",
      (state) => projectMarkAllAsRead(state, platform),
      () => docMarkAllAsRead(platform),
    );
  },

  toggleSaved: async (id) => {
    const item = get().items.find((candidate) => candidate.globalId === id);
    const shouldPin = !!item && !item.userState.saved;
    await runOptimisticMutation(
      get,
      set,
      "desktop:toggleSaved",
      (state) => projectToggleSaved(state, id),
      () => docToggleSaved(id),
    );
    if (shouldPin) {
      void pinReaderItem(item).catch((error) => {
        recordRuntimeError({
          source: "desktop:pinReaderItem",
          error: error instanceof Error ? error : new Error(String(error)),
          fatal: false,
        });
      });
    }
  },

  toggleArchived: async (id) => {
    await runOptimisticMutation(
      get,
      set,
      "desktop:toggleArchived",
      (state) => projectToggleArchived(state, id),
      () => docToggleArchived(id),
      { waitForPersistence: false },
    );
  },

  archiveItems: async (ids) => {
    await runOptimisticMutation(
      get,
      set,
      "desktop:archiveItems",
      (state) => projectArchiveItems(state, ids),
      () => docArchiveItems(ids),
    );
  },

  toggleLiked: async (id) => {
    await runOptimisticMutation(
      get,
      set,
      "desktop:toggleLiked",
      (state) => projectToggleLiked(state, id),
      () => docToggleLiked(id),
      { waitForPersistence: false },
    );
    // The outbox processor will pick up the pending like on its next drain.
  },

  archiveAllReadUnsaved: async (platform, feedUrl) => {
    await runOptimisticMutation(
      get,
      set,
      "desktop:archiveAllReadUnsaved",
      (state) => projectArchiveAllReadUnsaved(state, platform, feedUrl),
      () => docArchiveAllReadUnsaved(platform, feedUrl),
    );
  },

  unarchiveSavedItems: async () => {
    await docUnarchiveSavedItems();
  },

  deleteAllArchived: async () => {
    await docDeleteAllArchived();
  },

  removeItem: async (id) => {
    await runOptimisticMutation(
      get,
      set,
      "desktop:removeItem",
      (state) => projectRemoveItem(state, id),
      () => docRemoveFeedItem(id),
    );
  },

  clearSampleData: async () => {
    return docClearSampleData();
  },

  addSampleLibraryData: async (data: SampleLibraryData) => {
    await docAddSampleLibraryData({
      feeds: data.feeds,
      items: data.items,
      persons: data.friends.map((friend) => personFromLegacyFriend(friend as Friend)),
      accounts: data.friends.flatMap((friend) => accountsFromLegacyFriend(friend as Friend)),
    });
  },

  // Feed actions
  addFeed: async (feed) => {
    await docAddRssFeed(feed);
  },

  removeFeed: async (url, options) => {
    await docRemoveRssFeed(url, options?.includeItems ?? false);
    const { removeRssRuntimeState } = await import("./rss-runtime-state");
    removeRssRuntimeState(url);
    const { forgetRssFeedHealth } = await import("./provider-health");
    await forgetRssFeedHealth(url);
  },

  removeAllFeeds: async (includeItems) => {
    const feedUrls = Object.keys(get().feeds);
    await docRemoveAllFeeds(includeItems);
    const { removeRssRuntimeState } = await import("./rss-runtime-state");
    for (const url of feedUrls) removeRssRuntimeState(url);
    const { forgetRssFeedHealth } = await import("./provider-health");
    await Promise.all(feedUrls.map((url) => forgetRssFeedHealth(url)));
  },

  renameFeed: async (url, title) => {
    await runOptimisticMutation(
      get,
      set,
      "desktop:renameFeed",
      (state) => projectRenameFeed(state, url, title),
      () => docUpdateRssFeed(url, { title }),
    );
  },

  // Person actions
  addPerson: async (person: Person) => {
    await docAddPerson(person);
  },

  addPersons: async (persons: Person[]) => {
    await docAddPersons(persons);
  },

  updatePerson: async (id: string, updates: Partial<Person>) => {
    assertDesktopStoreWritable();
    const localGraphUpdate = getDeviceLocalGraphPositionUpdates(updates);
    if (
      Object.keys(localGraphUpdate).length > 0
      && !applyDevicePersonGraphPositionUpdate(id, localGraphUpdate)
    ) {
      throw new Error("Freed could not save this graph position on this device.");
    }
    const syncedUpdates = stripDeviceLocalGraphPositionUpdates(updates);
    if (Object.keys(syncedUpdates).length === 0) return;
    await runOptimisticMutation(
      get,
      set,
      "desktop:updatePerson",
      (state) => projectUpdatePerson(state, id, syncedUpdates),
      () => docUpdatePerson(id, syncedUpdates),
    );
  },

  removePerson: async (id: string) => {
    await docRemovePerson(id);
  },

  logReachOut: async (id: string, entry: ReachOutLog) => {
    await docLogReachOut(id, entry);
  },

  linkAccountToPerson: async (accountId: string, personId: string | null) => {
    const account = get().accounts[accountId];
    if (!account) return;
    const previousPersonId = account.personId ?? null;
    if (previousPersonId === personId) return;
    const updates = {
      personId: personId ?? undefined,
      updatedAt: Date.now(),
    };
    await docUpdateAccount(accountId, updates);
    await pruneConnectionPersonIfNeeded(get, previousPersonId, [accountId]);
  },

  createConnectionPersonFromAccounts: async (accountIds: string[], personOverride?: Person) => {
    const person = buildConnectionPersonDraftFromAccounts(get().accounts, accountIds, Date.now(), personOverride);
    if (!person) {
      throw new Error("Connection person requires at least one social account with a likely human name.");
    }
    if (get().persons[person.id]) {
      await docUpdatePerson(person.id, person);
    } else {
      await docAddPerson(person);
    }
    for (const accountId of accountIds) {
      await get().linkAccountToPerson(accountId, person.id);
    }
    return person.id;
  },

  createConnectionPersonsFromCandidates: async (candidates) => {
    if (candidates.length === 0) return 0;
    await docUpsertConnectionPersons(candidates);
    return candidates.length;
  },

  // Deprecated friend aliases
  addFriend: async (friend: Friend) => {
    await docAddPerson(personFromLegacyFriend(friend));
    const accounts = accountsFromLegacyFriend(friend);
    if (accounts.length > 0) {
      await docAddAccounts(accounts);
    }
  },

  addFriends: async (friends: Friend[]) => {
    const persons = friends.map((friend) => personFromLegacyFriend(friend as Friend));
    await docAddPersons(persons);
    const accounts = friends.flatMap((friend) => accountsFromLegacyFriend(friend as Friend));
    if (accounts.length > 0) {
      await docAddAccounts(accounts);
    }
  },

  updateFriend: async (id: string, updates: Partial<Friend>) => {
    assertDesktopStoreWritable();
    const current = get().friends[id];
    if (!current) {
      await docUpdatePerson(id, updates);
      return;
    }
    const nextFriend = {
      ...current,
      ...updates,
      sources: "sources" in updates ? ((updates as Partial<Friend>).sources ?? []) : current.sources,
      contact: "contact" in updates ? (updates as Partial<Friend>).contact : current.contact,
    } as Friend;
    await docUpdatePerson(id, personFromLegacyFriend(nextFriend));
    const existingAccounts = Object.values(get().accounts).filter((account) => account.personId === id);
    const existingAccountIds = new Set(existingAccounts.map((account) => account.id));
    const graphLayoutBeforeReplacement = getDeviceGraphLayout();
    await Promise.all(existingAccounts.map((account) => docRemoveAccount(account.id)));
    const nextAccounts = accountsFromLegacyFriend(nextFriend);
    if (nextAccounts.length > 0) {
      assertDesktopStoreWritable();
      await docAddAccounts(nextAccounts);
      restoreReplacedDeviceAccountGraphPositions(
        nextAccounts
          .map((account) => account.id)
          .filter((accountId) => existingAccountIds.has(accountId)),
        graphLayoutBeforeReplacement,
      );
    }
  },

  removeFriend: async (id: string) => {
    await docRemovePerson(id);
  },

  addAccount: async (account: Account) => {
    await docAddAccount(account);
  },

  addAccounts: async (accounts: Account[]) => {
    await docAddAccounts(accounts);
  },

  updateAccount: async (id: string, updates: Partial<Account>) => {
    assertDesktopStoreWritable();
    const localGraphUpdate = getDeviceLocalGraphPositionUpdates(updates);
    if (
      Object.keys(localGraphUpdate).length > 0
      && !applyDeviceAccountGraphPositionUpdate(id, localGraphUpdate)
    ) {
      throw new Error("Freed could not save this graph position on this device.");
    }
    const syncedUpdates = stripDeviceLocalGraphPositionUpdates(updates);
    if (Object.keys(syncedUpdates).length === 0) return;
    await runOptimisticMutation(
      get,
      set,
      "desktop:updateAccount",
      (state) => projectUpdateAccount(state, id, syncedUpdates),
      () => docUpdateAccount(id, syncedUpdates),
    );
  },

  removeAccount: async (id: string) => {
    const previousPersonId = get().accounts[id]?.personId ?? null;
    await docRemoveAccount(id);
    await pruneConnectionPersonIfNeeded(get, previousPersonId);
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
      await runOptimisticMutation(
        get,
        set,
        "desktop:updatePreferences",
        () => ({ preferences: nextPreferences }),
        () => docUpdatePreferences(syncedUpdate),
        { recordFailure: false },
      );
    } catch (error) {
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

/** Stop every store-owned writer and wait for already-issued work before document deletion. */
export async function quiesceDesktopStoreForFactoryReset(): Promise<void> {
  storeAcceptingResetSensitiveWork = false;
  documentSubscriptionTeardown?.();
  documentSubscriptionTeardown = null;

  if (startupMaintenanceTimer) {
    clearTimeout(startupMaintenanceTimer);
    startupMaintenanceTimer = null;
  }
  if (startupContentSignalTimer) {
    clearTimeout(startupContentSignalTimer);
    startupContentSignalTimer = null;
  }
  if (readMarkBatchTimer) {
    clearTimeout(readMarkBatchTimer);
    readMarkBatchTimer = null;
  }
  pendingReadIds.clear();
  const readWaiters = readMarkBatchWaiters;
  readMarkBatchWaiters = [];
  readWaiters.forEach((resolve) => resolve());

  await quiesceDesktopAutomergeForFactoryReset();

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
