/**
 * Global app state management with Zustand
 *
 * PWA version - uses Automerge for persistence and syncs with desktop.
 * Hydration (CRDT → plain JS) now runs in the Automerge Web Worker, so the
 * subscriber callback receives already-processed DocState — no O(n) work
 * or WASM calls on the main thread.
 */

import { create } from "zustand";
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
  projectUpdatePreferences,
  rollbackOptimisticPatch,
  type OptimisticPatch,
} from "@freed/shared/optimistic-state";
import type {
  Account,
  BaseAppState,
  Friend,
  Person,
  ReachOutLog,
  RemoveFeedOptions,
  SampleLibraryData,
} from "@freed/shared";
import {
  recordBugReportEvent,
  recordRuntimeError,
} from "@freed/ui/lib/bug-report";
import {
  DEFAULT_FACTORY_RESET_PHASE_TIMEOUT_MS,
  waitForFactoryResetDrain,
} from "@freed/ui/lib/factory-reset";
import {
  getDeviceDisplayPreferences,
  migrateLegacyDeviceDisplayPreferences,
  setDeviceDisplayPreferences,
} from "@freed/ui/lib/device-display-preferences";
import {
  migrateLegacyDeviceAIPreferences,
  setDeviceAIPreferences,
} from "@freed/ui/lib/device-ai-preferences";
import {
  applyDeviceAccountGraphPositionUpdate,
  applyDevicePersonGraphPositionUpdate,
  getDeviceGraphLayout,
  migrateLegacyDeviceGraphLayout,
  pruneDeviceGraphLayout,
  restoreReplacedDeviceAccountGraphPositions,
} from "@freed/ui/lib/device-graph-layout";
import {
  initDoc,
  subscribe,
  docAddFeedItems,
  docAddSampleLibraryData,
  docAddRssFeed,
  docRemoveRssFeed,
  docRemoveAllFeeds,
  docUpdateRssFeed,
  docUpdateFeedItem,
  docBackfillContentSignals,
  docMarkAsRead,
  docMarkItemsAsRead,
  docMarkAllAsRead,
  docToggleSaved,
  docRemoveFeedItem,
  docClearSampleData,
  docToggleArchived,
  docArchiveItems,
  docToggleLiked,
  docArchiveAllReadUnsaved,
  docUnarchiveSavedItems,
  docDeleteAllArchived,
  docPruneArchivedItems,
  docUpdatePreferences,
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
} from "./automerge";
import type { DocState } from "./automerge";
import { pinReaderItemInPwa } from "./reader-cache";
import {
  assertPwaRuntimeCurrent,
  capturePwaRuntimeLifecycle,
  registerPwaFactoryResetQuiesceHandler,
} from "./factory-reset-coordinator";

let appInitializationPromise: Promise<void> | null = null;
let documentSubscriptionTeardown: (() => void) | null = null;
let startupMigrationsStopped = false;
let storeQuiesced = false;
const pendingStartupMigrations = new Set<Promise<void>>();

function readStateIdTails(ids: readonly string[]): string[] {
  return ids.slice(0, 5).map((id) => `...${id.slice(-8)}`);
}

function recordReadStateInfo(
  message: string,
  detail: Record<string, unknown>,
): void {
  recordBugReportEvent(
    "pwa:readState",
    "info",
    message,
    JSON.stringify(detail),
  );
}

/** PWA-specific store state — extends the shared base with sync connection status. */
interface AppState extends BaseAppState {
  syncConnected: boolean;
  setSyncConnected: (connected: boolean) => void;
}

/**
 * Shallow-compare two string-keyed number maps.
 * Preserves object identity on count maps so Zustand selectors don't trigger
 * re-renders when values haven't changed.
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

function optimisticBefore(
  state: AppState,
  patch: OptimisticPatch,
): OptimisticPatch {
  const before: OptimisticPatch = {};
  for (const key of Object.keys(patch) as Array<keyof OptimisticPatch>) {
    before[key] = state[key] as never;
  }
  return before;
}

function optimisticMutationTestFailure(source: string): Error | null {
  if (import.meta.env.VITE_TEST_TAURI !== "1") return null;
  const hook = (
    globalThis as unknown as {
      __FREED_FAIL_OPTIMISTIC_MUTATION__?: (
        source: string,
      ) => string | false | null | undefined;
    }
  ).__FREED_FAIL_OPTIMISTIC_MUTATION__;
  const message = hook?.(source);
  return message ? new Error(message) : null;
}

function assertPwaStoreWritable(): void {
  if (storeQuiesced) throw new Error("PWA store is quiesced for factory reset");
  assertPwaRuntimeCurrent();
}

async function runOptimisticMutation(
  getState: () => AppState,
  setState: (patch: Partial<AppState>) => void,
  source: string,
  project: (state: AppState) => OptimisticPatch | null,
  task: () => Promise<void>,
  options: { recordFailure?: boolean; waitForPersistence?: boolean } = {},
): Promise<void> {
  assertPwaStoreWritable();
  const projected = project(getState());
  if (!projected) {
    if (options.waitForPersistence === false) {
      void task().catch((error) => {
        if (options.recordFailure !== false) {
          const detail = error instanceof Error ? error.message : String(error);
          recordRuntimeError({ source, error, fatal: false });
          recordBugReportEvent(
            source,
            "error",
            "Optimistic mutation failed",
            detail,
          );
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
        recordBugReportEvent(
          source,
          "error",
          "Optimistic mutation failed",
          detail,
        );
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
  if (
    !isPrunableConnectionPerson(
      state.persons,
      state.accounts,
      personId,
      ignoredAccountIds,
    )
  ) {
    return;
  }
  await docRemovePerson(personId!);
}

async function runStartupMigrations(archivePruneDays: number): Promise<void> {
  if (startupMigrationsStopped || storeQuiesced) return;
  try {
    if (archivePruneDays > 0 && !startupMigrationsStopped) {
      await docPruneArchivedItems(archivePruneDays * 24 * 60 * 60 * 1000);
    }
  } catch {
    // non-fatal
  }

  try {
    while (!startupMigrationsStopped) {
      const summary = await docBackfillContentSignals(200);
      if (
        startupMigrationsStopped ||
        summary.updated === 0 ||
        summary.remaining === 0
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } catch {
    // non-fatal
  }
}

function startStartupMigrations(archivePruneDays: number): void {
  if (startupMigrationsStopped || storeQuiesced) return;
  const migration = runStartupMigrations(archivePruneDays);
  pendingStartupMigrations.add(migration);
  void migration.finally(() => {
    pendingStartupMigrations.delete(migration);
  });
}

/** Stop new startup maintenance and drain work already touching the local document. */
export async function quiescePwaStartupMigrations(): Promise<void> {
  stopPwaStoreForFactoryReset();
  await waitForFactoryResetDrain(
    () => [...pendingStartupMigrations],
    "PWA startup migrations",
    DEFAULT_FACTORY_RESET_PHASE_TIMEOUT_MS,
  );
  if (appInitializationPromise)
    await Promise.allSettled([appInitializationPromise]);
}

function stopPwaStoreForFactoryReset(): void {
  storeQuiesced = true;
  startupMigrationsStopped = true;
  documentSubscriptionTeardown?.();
  documentSubscriptionTeardown = null;
}

registerPwaFactoryResetQuiesceHandler("store", stopPwaStoreForFactoryReset, 20);

function hasStoredCloudSyncCredentials(): boolean {
  try {
    return (
      localStorage.getItem("freed_cloud_provider") !== null ||
      localStorage.getItem("freed_cloud_token_meta_gdrive") !== null ||
      localStorage.getItem("freed_cloud_token_meta_dropbox") !== null
    );
  } catch {
    return false;
  }
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
  syncConnected: false,
  isLoading: true,
  isSyncing: false,
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
    if (storeQuiesced)
      return Promise.reject(
        new Error("PWA store is quiesced for factory reset"),
      );
    assertPwaRuntimeCurrent();
    if (get().isInitialized) return Promise.resolve();
    if (appInitializationPromise) return appInitializationPromise;

    appInitializationPromise = (async () => {
      const runtimeLifecycle = capturePwaRuntimeLifecycle();
      try {
        set({ isLoading: true });
        const state = await initDoc();
        runtimeLifecycle.assertCurrent();
        if (storeQuiesced)
          throw new Error("PWA store is quiesced for factory reset");
        migrateLegacyDeviceDisplayPreferences(state.preferences.display);
        migrateLegacyDeviceAIPreferences(state.preferences.ai);
        migrateLegacyDeviceGraphLayout(state.persons, state.accounts);

        // Subscribe to future changes before flipping isInitialized so background
        // mutations and sync merges propagate to the UI immediately.
        // Reuse count map references when values are unchanged to avoid
        // re-rendering sidebar selectors on unrelated mutations.
        documentSubscriptionTeardown?.();
        documentSubscriptionTeardown = subscribe((next: DocState, event) => {
          if (storeQuiesced || !runtimeLifecycle.isCurrent()) return;
          if (
            event.mutation === "MERGE_DOC" ||
            event.mutation === "REMOVE_PERSON" ||
            event.mutation === "REMOVE_ACCOUNT"
          ) {
            pruneDeviceGraphLayout(next.persons, next.accounts);
          }
          const prev = get();
          const merged = {
            ...next,
          } as Partial<AppState>;
          if (shallowEqualRecord(next.feedUnreadCounts, prev.feedUnreadCounts))
            merged.feedUnreadCounts = prev.feedUnreadCounts;
          if (shallowEqualRecord(next.feedTotalCounts, prev.feedTotalCounts))
            merged.feedTotalCounts = prev.feedTotalCounts;
          if (
            shallowEqualRecord(
              next.unreadCountByPlatform,
              prev.unreadCountByPlatform,
            )
          )
            merged.unreadCountByPlatform = prev.unreadCountByPlatform;
          if (
            shallowEqualRecord(
              next.itemCountByPlatform,
              prev.itemCountByPlatform,
            )
          )
            merged.itemCountByPlatform = prev.itemCountByPlatform;
          set(merged);
        });

        set({
          ...state,
          activeFilter: applyFeedSignalModesToFilter(
            get().activeFilter,
            getDeviceDisplayPreferences().feedSignalModes,
          ),
          isInitialized: true,
          isLoading: false,
        });

        // Do not mutate the local doc before cloud sync has reconciled it.
        if (!hasStoredCloudSyncCredentials()) {
          const pruneDays = state.preferences.display.archivePruneDays ?? 30;
          startStartupMigrations(pruneDays);
        }
      } catch (error) {
        recordRuntimeError({ source: "pwa:initialize", error, fatal: false });
        recordBugReportEvent(
          "pwa:initialize",
          "error",
          "Initialization failed",
        );
        set({
          error:
            error instanceof Error ? error.message : "Failed to initialize",
          isLoading: false,
        });
      }
    })().finally(() => {
      appInitializationPromise = null;
    });

    return appInitializationPromise;
  },

  // Item actions — errors propagate to callers so UI can surface them
  addItems: async (items) => {
    await docAddFeedItems(items);
  },

  updateItem: async (id, update) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:updateItem",
      (state) => projectUpdateItem(state, id, update),
      () => docUpdateFeedItem(id, update),
    );
  },

  markAsRead: async (id) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:readState",
      (state) => projectMarkItemsAsRead(state, [id]),
      () => docMarkAsRead(id),
      { recordFailure: false },
    );
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
        "pwa:readState",
        (state) => projectMarkItemsAsRead(state, nextIds),
        () => docMarkItemsAsRead(nextIds),
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
      recordRuntimeError({ source: "pwa:readState", error, fatal: false });
      recordBugReportEvent(
        "pwa:readState",
        "error",
        `Read state update failed for ${nextIds.length.toLocaleString()} item${nextIds.length === 1 ? "" : "s"}`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  },

  markAllAsRead: async (platform) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:markAllAsRead",
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
      "pwa:toggleSaved",
      (state) => projectToggleSaved(state, id),
      () => docToggleSaved(id),
    );
    if (shouldPin) {
      void pinReaderItemInPwa(item).catch((error) => {
        recordRuntimeError({
          source: "pwa:pinReaderItem",
          error,
          fatal: false,
        });
      });
    }
  },

  toggleArchived: async (id) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:toggleArchived",
      (state) => projectToggleArchived(state, id),
      () => docToggleArchived(id),
      { waitForPersistence: false },
    );
  },

  archiveItems: async (ids) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:archiveItems",
      (state) => projectArchiveItems(state, ids),
      () => docArchiveItems(ids),
    );
  },

  toggleLiked: async (id) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:toggleLiked",
      (state) => projectToggleLiked(state, id),
      () => docToggleLiked(id),
      { waitForPersistence: false },
    );
  },

  archiveAllReadUnsaved: async (platform, feedUrl) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:archiveAllReadUnsaved",
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
      "pwa:removeItem",
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
      persons: data.friends.map((friend) =>
        personFromLegacyFriend(friend as Friend),
      ),
      accounts: data.friends.flatMap((friend) =>
        accountsFromLegacyFriend(friend as Friend),
      ),
    });
  },

  // Feed actions
  addFeed: async (feed) => {
    await docAddRssFeed(feed);
  },

  removeFeed: async (url, options?: RemoveFeedOptions) => {
    await docRemoveRssFeed(url, options?.includeItems ?? false);
  },

  removeAllFeeds: async (includeItems) => {
    await docRemoveAllFeeds(includeItems);
  },

  renameFeed: async (url, title) => {
    await runOptimisticMutation(
      get,
      set,
      "pwa:renameFeed",
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
    assertPwaStoreWritable();
    const localGraphUpdate = getDeviceLocalGraphPositionUpdates(updates);
    if (
      Object.keys(localGraphUpdate).length > 0 &&
      !applyDevicePersonGraphPositionUpdate(id, localGraphUpdate)
    ) {
      throw new Error(
        "Freed could not save this graph position on this device.",
      );
    }
    const syncedUpdates = stripDeviceLocalGraphPositionUpdates(updates);
    if (Object.keys(syncedUpdates).length === 0) return;
    await runOptimisticMutation(
      get,
      set,
      "pwa:updatePerson",
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
    await runOptimisticMutation(
      get,
      set,
      "pwa:linkAccountToPerson",
      (state) => projectUpdateAccount(state, accountId, updates),
      () => docUpdateAccount(accountId, updates),
    );
    await pruneConnectionPersonIfNeeded(get, previousPersonId, [accountId]);
  },

  createConnectionPersonFromAccounts: async (
    accountIds: string[],
    personOverride?: Person,
  ) => {
    const person = buildConnectionPersonDraftFromAccounts(
      get().accounts,
      accountIds,
      Date.now(),
      personOverride,
    );
    if (!person) {
      throw new Error(
        "Connection person requires at least one social account with a likely human name.",
      );
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
    const persons = friends.map((friend) =>
      personFromLegacyFriend(friend as Friend),
    );
    await docAddPersons(persons);
    const accounts = friends.flatMap((friend) =>
      accountsFromLegacyFriend(friend as Friend),
    );
    if (accounts.length > 0) {
      await docAddAccounts(accounts);
    }
  },

  updateFriend: async (id: string, updates: Partial<Friend>) => {
    assertPwaStoreWritable();
    const current = get().friends[id];
    if (!current) {
      await docUpdatePerson(id, updates);
      return;
    }
    const nextFriend = {
      ...current,
      ...updates,
      sources:
        "sources" in updates
          ? ((updates as Partial<Friend>).sources ?? [])
          : current.sources,
      contact:
        "contact" in updates
          ? (updates as Partial<Friend>).contact
          : current.contact,
    } as Friend;
    await docUpdatePerson(id, personFromLegacyFriend(nextFriend));
    const existingAccounts = Object.values(get().accounts).filter(
      (account) => account.personId === id,
    );
    const existingAccountIds = new Set(
      existingAccounts.map((account) => account.id),
    );
    const graphLayoutBeforeReplacement = getDeviceGraphLayout();
    await Promise.all(
      existingAccounts.map((account) => docRemoveAccount(account.id)),
    );
    const nextAccounts = accountsFromLegacyFriend(nextFriend);
    if (nextAccounts.length > 0) {
      await docAddAccounts(nextAccounts);
      assertPwaStoreWritable();
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
    assertPwaStoreWritable();
    const localGraphUpdate = getDeviceLocalGraphPositionUpdates(updates);
    if (
      Object.keys(localGraphUpdate).length > 0 &&
      !applyDeviceAccountGraphPositionUpdate(id, localGraphUpdate)
    ) {
      throw new Error(
        "Freed could not save this graph position on this device.",
      );
    }
    const syncedUpdates = stripDeviceLocalGraphPositionUpdates(updates);
    if (Object.keys(syncedUpdates).length === 0) return;
    await runOptimisticMutation(
      get,
      set,
      "pwa:updateAccount",
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
    assertPwaStoreWritable();
    const localUpdate = getDeviceLocalPreferenceUpdates(update);
    if (
      localUpdate.display &&
      !setDeviceDisplayPreferences(localUpdate.display)
    ) {
      throw new Error(
        "Freed could not save the display settings on this device.",
      );
    }
    if (localUpdate.ai && !setDeviceAIPreferences(localUpdate.ai)) {
      throw new Error("Freed could not save the AI settings on this device.");
    }
    const syncedUpdate = stripDeviceLocalPreferenceUpdates(update);
    if (Object.keys(syncedUpdate).length === 0) return;
    await runOptimisticMutation(
      get,
      set,
      "pwa:updatePreferences",
      (state) => projectUpdatePreferences(state, syncedUpdate),
      () => docUpdatePreferences(syncedUpdate),
    );
  },

  // Sync actions
  setSyncConnected: (connected) => set({ syncConnected: connected }),

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setSelectedPerson: (id) =>
    set({
      selectedPersonId: id,
      selectedAccountId: null,
      selectedFriendId: id,
    }),
  setSelectedAccount: (id) =>
    set({
      selectedPersonId: null,
      selectedAccountId: id,
      selectedFriendId: null,
    }),
  setSelectedFriend: (id) =>
    set({
      selectedPersonId: id,
      selectedAccountId: null,
      selectedFriendId: id,
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
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
