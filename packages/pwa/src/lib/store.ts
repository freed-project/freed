/**
 * Global app state management with Zustand
 *
 * PWA version. OPFS SQLite is the only durable Library row store.
 */

import { create } from "zustand";
import {
  applyFeedSignalModesToFilter,
  createDefaultPreferences,
  getDeviceLocalPreferenceUpdates,
  stripDeviceLocalPreferenceUpdates,
} from "@freed/shared";
import type {
  BaseAppState,
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
import { migrateLegacyThemePreference } from "@freed/ui/lib/theme";
import { migrateLegacyDeviceGraphLayoutToSqlite } from "@freed/ui/lib/device-graph-layout";
import {
  migrateLegacyDeviceAIPreferences,
  setDeviceAIPreferences,
} from "@freed/ui/lib/device-ai-preferences";
import { pinReaderItemInPwa } from "./reader-cache";
import {
  clearPwaLibraryCoreSampleData,
  drainPwaLibraryCoreLocalChanges,
  enqueuePwaLibraryCoreArchiveItems,
  enqueuePwaLibraryCoreArchiveAllReadUnsaved,
  enqueuePwaLibraryCoreDeleteAllArchived,
  enqueuePwaLibraryCoreFeedItemCapture,
  enqueuePwaLibraryCoreFeedItemCaptures,
  enqueuePwaLibraryCoreFeedItemAnalysisSets,
  enqueuePwaLibraryCoreFeedItemAnnotationSets,
  enqueuePwaLibraryCoreFeedItemRemove,
  enqueuePwaLibraryCoreRssFeedRemove,
  enqueuePwaLibraryCoreRssFeedTitleAssignment,
  enqueuePwaLibraryCoreRssFeedUpsert,
  removeAllPwaLibraryCoreRssFeeds,
  enqueuePwaLibraryCorePreferencesPatch,
  enqueuePwaLibraryCorePersonUpserts,
  enqueuePwaLibraryCoreAccountUpserts,
  enqueuePwaLibraryCoreMarkAllAsRead,
  enqueuePwaLibraryCoreReadAssignments,
  enqueuePwaLibraryCoreUnarchiveSavedItems,
  enqueuePwaLibraryCoreUserStateToggle,
  ensurePwaLibraryCoreLocalSampleState,
  initializePwaLibraryCoreState,
  readPwaLibraryCoreItemDetail,
  subscribePwaLibraryCoreState,
} from "./library-core-runtime";
import {
  assertPwaRuntimeCurrent,
  capturePwaRuntimeLifecycle,
  registerPwaFactoryResetQuiesceHandler,
} from "./factory-reset-coordinator";
import {
  mutatePwaDeviceGraphLayout,
  queryPwaNormalizedLibrary,
} from "./library-core-sqlite-runtime";

let appInitializationPromise: Promise<void> | null = null;
let documentSubscriptionTeardown: (() => void) | null = null;
let storeQuiesced = false;

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

function applyDefinedUpdate<T extends object>(
  current: T,
  updates: Partial<T>,
): T {
  const next: Record<string, unknown> = {
    ...(current as unknown as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

function isMergeableObject(value: unknown): value is Record<string, unknown> {
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
      isMergeableObject(currentValue) && isMergeableObject(updateValue)
        ? mergePreferenceUpdate<Record<string, unknown>>(
            currentValue,
            updateValue,
          )
        : updateValue
    ) as T[typeof key];
  }
  return next;
}

/**
 * Shallow-compare two string-keyed number maps.
 * Preserves object identity on count maps so Zustand selectors don't trigger
 * re-renders when values haven't changed.
 */
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

function assertPwaStoreWritable(
  options: {
    readonly allowLibraryCoreIntent?: boolean;
  } = {},
): void {
  if (storeQuiesced) throw new Error("PWA store is quiesced for factory reset");
  assertPwaRuntimeCurrent();
  if (options.allowLibraryCoreIntent !== true) {
    throw new Error(
      "This SQLite Library is read-only until its PWA intent outbox is active",
    );
  }
}

function invalidateLibraryWindows(
  getState: () => AppState,
  setState: (patch: Partial<AppState>) => void,
): void {
  const current = getState();
  setState({
    libraryItemVersion: (current.libraryItemVersion ?? 0) + 1,
    savedFeedVersion: (current.savedFeedVersion ?? 0) + 1,
  });
}

async function runSqliteMutation(
  getState: () => AppState,
  setState: (patch: Partial<AppState>) => void,
  source: string,
  task: () => Promise<void>,
  options: {
    allowLibraryCoreIntent?: boolean;
    recordFailure?: boolean;
    waitForPersistence?: boolean;
  } = {},
): Promise<void> {
  assertPwaStoreWritable({
    allowLibraryCoreIntent: options.allowLibraryCoreIntent,
  });
  const persist = async () => {
    try {
      const testFailure = optimisticMutationTestFailure(source);
      if (testFailure) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw testFailure;
      }
      await task();
      try {
        await drainPwaLibraryCoreLocalChanges(getState().searchCorpusVersion);
      } catch {
        // The SQLite mutation is already durable. The ordinary bounded window
        // invalidation below is the fail-safe refresh path.
      }
      invalidateLibraryWindows(getState, setState);
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

/** Stop new startup maintenance and drain work already touching the local document. */
export async function quiescePwaStartupMigrations(): Promise<void> {
  stopPwaStoreForFactoryReset();
  await waitForFactoryResetDrain(
    () => [],
    "PWA startup migrations",
    DEFAULT_FACTORY_RESET_PHASE_TIMEOUT_MS,
  );
  if (appInitializationPromise)
    await Promise.allSettled([appInitializationPromise]);
}

function stopPwaStoreForFactoryReset(): void {
  storeQuiesced = true;
  documentSubscriptionTeardown?.();
  documentSubscriptionTeardown = null;
}

registerPwaFactoryResetQuiesceHandler("store", stopPwaStoreForFactoryReset, 20);

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  searchCorpusVersion: 0,
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
  setVisibleFeedTotalCount: (totalCount) => {
    set({ visibleFeedTotalCount: totalCount });
  },

  // Initialize from the bounded OPFS SQLite Library window.
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
        const state = await initializePwaLibraryCoreState();
        runtimeLifecycle.assertCurrent();
        migrateLegacyDeviceDisplayPreferences(state.preferences.display);
        migrateLegacyThemePreference(state.preferences.display.themeId);
        migrateLegacyDeviceAIPreferences(state.preferences.ai);
        await migrateLegacyDeviceGraphLayoutToSqlite({
          mutate: mutatePwaDeviceGraphLayout,
          query: queryPwaNormalizedLibrary,
        });
        runtimeLifecycle.assertCurrent();
        documentSubscriptionTeardown?.();
        documentSubscriptionTeardown = subscribePwaLibraryCoreState(
          (next, localChange) => {
            if (storeQuiesced || !runtimeLifecycle.isCurrent()) return;
            set((current) =>
              localChange
                ? {
                    ...next,
                    libraryItemVersion:
                      (current.libraryItemVersion ??
                        current.searchCorpusVersion) + 1,
                    savedFeedVersion:
                      (current.savedFeedVersion ??
                        current.searchCorpusVersion) + 1,
                  }
                : next,
            );
          },
        );
        set({
          ...state,
          activeFilter: applyFeedSignalModesToFilter(
            get().activeFilter,
            getDeviceDisplayPreferences().feedSignalModes,
          ),
          isInitialized: true,
          isLoading: false,
        });
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
    await runSqliteMutation(
      get,
      set,
      "pwa:addItems",
      async () => {
        await enqueuePwaLibraryCoreFeedItemCaptures(items);
        const annotated = items.filter(
          (item) =>
            item.userState.tags.length > 0 ||
            (item.userState.highlights?.length ?? 0) > 0,
        );
        await enqueuePwaLibraryCoreFeedItemAnnotationSets(
          annotated.map((item) => ({
            entityId: item.globalId,
            highlights: item.userState.highlights ?? [],
            tags: item.userState.tags,
          })),
        );
        const analyzed = items.filter(
          (item) =>
            item.contentSignals !== undefined || item.eventCandidate !== undefined,
        );
        await enqueuePwaLibraryCoreFeedItemAnalysisSets(
          analyzed.map((item) => ({
            contentSignals: item.contentSignals,
            entityId: item.globalId,
            eventCandidate: item.eventCandidate,
          })),
        );
      },
      { allowLibraryCoreIntent: true },
    );
  },

  updateItem: async (id, update) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:updateItem",
      async () => {
        const item = await readPwaLibraryCoreItemDetail(id);
        if (!item) throw new Error("Feed item is unavailable");
        const next = applyDefinedUpdate(item, update);
        if (update.userState) {
          next.userState = applyDefinedUpdate(item.userState, update.userState);
        }
        await enqueuePwaLibraryCoreFeedItemCapture(next);
        if (
          update.contentSignals !== undefined ||
          update.eventCandidate !== undefined
        ) {
          await enqueuePwaLibraryCoreFeedItemAnalysisSets([
            {
              contentSignals: next.contentSignals,
              entityId: id,
              eventCandidate: next.eventCandidate,
            },
          ]);
        }
        if (
          update.userState?.tags !== undefined ||
          update.userState?.highlights !== undefined
        ) {
          await enqueuePwaLibraryCoreFeedItemAnnotationSets([
            {
              entityId: id,
              highlights: next.userState.highlights ?? [],
              tags: next.userState.tags,
            },
          ]);
        }
      },
      { allowLibraryCoreIntent: true },
    );
  },

  markAsRead: async (id) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:readState",
      () => enqueuePwaLibraryCoreReadAssignments([id]),
      { allowLibraryCoreIntent: true, recordFailure: false },
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
      await runSqliteMutation(
        get,
        set,
        "pwa:readState",
        () => enqueuePwaLibraryCoreReadAssignments(nextIds),
        { allowLibraryCoreIntent: true, recordFailure: false },
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
    await runSqliteMutation(
      get,
      set,
      "pwa:markAllAsRead",
      () => enqueuePwaLibraryCoreMarkAllAsRead(platform),
      { allowLibraryCoreIntent: true },
    );
  },

  toggleSaved: async (id) => {
    const item = await readPwaLibraryCoreItemDetail(id);
    const shouldPin = !!item && !item.userState.saved;
    await runSqliteMutation(
      get,
      set,
      "pwa:toggleSaved",
      () => enqueuePwaLibraryCoreUserStateToggle(id, "saved"),
      { allowLibraryCoreIntent: true },
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
    await runSqliteMutation(
      get,
      set,
      "pwa:toggleArchived",
      () => enqueuePwaLibraryCoreUserStateToggle(id, "archived"),
      { allowLibraryCoreIntent: true, waitForPersistence: false },
    );
  },

  archiveItems: async (ids) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:archiveItems",
      () => enqueuePwaLibraryCoreArchiveItems(ids),
      { allowLibraryCoreIntent: true },
    );
  },

  toggleLiked: async (id) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:toggleLiked",
      () => enqueuePwaLibraryCoreUserStateToggle(id, "liked"),
      { allowLibraryCoreIntent: true, waitForPersistence: false },
    );
  },

  archiveAllReadUnsaved: async (platform, feedUrl) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:archiveAllReadUnsaved",
      () => enqueuePwaLibraryCoreArchiveAllReadUnsaved(platform, feedUrl),
      { allowLibraryCoreIntent: true },
    );
  },

  unarchiveSavedItems: async () => {
    await runSqliteMutation(
      get,
      set,
      "pwa:unarchiveSavedItems",
      enqueuePwaLibraryCoreUnarchiveSavedItems,
      { allowLibraryCoreIntent: true },
    );
  },

  deleteAllArchived: async () => {
    await runSqliteMutation(
      get,
      set,
      "pwa:deleteAllArchived",
      enqueuePwaLibraryCoreDeleteAllArchived,
      { allowLibraryCoreIntent: true },
    );
  },

  removeItem: async (id) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:removeItem",
      () => enqueuePwaLibraryCoreFeedItemRemove(id),
      { allowLibraryCoreIntent: true },
    );
  },

  clearSampleData: async () => {
    const summary = await clearPwaLibraryCoreSampleData();
    invalidateLibraryWindows(get, set);
    return summary;
  },

  addSampleLibraryData: async (data: SampleLibraryData) => {
    await ensurePwaLibraryCoreLocalSampleState();
    for (const feed of data.feeds) {
      await enqueuePwaLibraryCoreRssFeedUpsert(feed);
    }
    await enqueuePwaLibraryCoreFeedItemCaptures(data.items);
    await enqueuePwaLibraryCoreFeedItemAnnotationSets(
      data.items.map((item) => ({
        entityId: item.globalId,
        highlights: item.userState.highlights ?? [],
        tags: item.userState.tags,
      })),
    );
    await enqueuePwaLibraryCoreFeedItemAnalysisSets(
      data.items
        .filter(
          (item) =>
            item.contentSignals !== undefined || item.eventCandidate !== undefined,
        )
        .map((item) => ({
          contentSignals: item.contentSignals,
          entityId: item.globalId,
          eventCandidate: item.eventCandidate,
        })),
    );
    await enqueuePwaLibraryCorePersonUpserts(data.persons);
    await enqueuePwaLibraryCoreAccountUpserts(data.accounts);
    invalidateLibraryWindows(get, set);
  },

  // Feed actions
  addFeed: async (feed) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:addFeed",
      () => enqueuePwaLibraryCoreRssFeedUpsert(feed),
      { allowLibraryCoreIntent: true },
    );
  },

  removeFeed: async (url, options?: RemoveFeedOptions) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:removeFeed",
      () =>
        enqueuePwaLibraryCoreRssFeedRemove(url, options?.includeItems ?? false),
      { allowLibraryCoreIntent: true },
    );
  },

  removeAllFeeds: async (includeItems) => {
    await removeAllPwaLibraryCoreRssFeeds(includeItems);
    invalidateLibraryWindows(get, set);
  },

  renameFeed: async (url, title) => {
    await runSqliteMutation(
      get,
      set,
      "pwa:renameFeed",
      () => enqueuePwaLibraryCoreRssFeedTitleAssignment(url, title),
      { allowLibraryCoreIntent: true },
    );
  },

  // Preference actions
  updatePreferences: async (update) => {
    assertPwaStoreWritable({ allowLibraryCoreIntent: true });
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
    const currentPreferences = get().preferences;
    const nextPreferences = mergePreferenceUpdate(
      currentPreferences,
      syncedUpdate,
    );
    set({ preferences: nextPreferences });
    try {
      await runSqliteMutation(
        get,
        set,
        "pwa:updatePreferences",
        () => enqueuePwaLibraryCorePreferencesPatch(syncedUpdate),
        { allowLibraryCoreIntent: true },
      );
    } catch (error) {
      set({ preferences: currentPreferences });
      throw error;
    }
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
