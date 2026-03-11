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
import type { FeedItem, FilterOptions, Friend, ReachOutLog, UserPreferences, RssFeed } from "@freed/shared";
import { createDefaultPreferences } from "@freed/shared";
import {
  initDoc,
  subscribe,
  getDocState,
  docAddFeedItems,
  docAddRssFeed,
  docRemoveRssFeed,
  docRemoveAllFeeds,
  docUpdateRssFeed,
  docUpdateFeedItem,
  docMarkAsRead,
  docMarkAllAsRead,
  docToggleSaved,
  docRemoveFeedItem,
  docToggleArchived,
  docArchiveAllReadUnsaved,
  docPruneArchivedItems,
  docUpdatePreferences,
  docDeduplicateFeedItems,
  docHealUntitledFeedTitles,
  docAddFriend,
  docUpdateFriend,
  docRemoveFriend,
  docLogReachOut,
  docToggleLiked,
  docConfirmLikedSynced,
  docConfirmSeenSynced,
  type DocState,
} from "./automerge";
import { buildPlatformActionsRegistry } from "./platform-actions";
import { startOutboxProcessor } from "./outbox";
import { loadStoredCookies, type XAuthState } from "./x-auth";

let outboxTeardown: (() => void) | null = null;
import { initFbAuth, type FbAuthState } from "./fb-auth";
import { initIgAuth, type IgAuthState } from "./instagram-auth";
import { initLiAuth, type LiAuthState } from "./li-auth";

// App state interface
interface AppState {
  // Data (received pre-hydrated from Automerge worker as DocState)
  items: FeedItem[];
  feeds: Record<string, RssFeed>;
  friends: Record<string, Friend>;
  preferences: UserPreferences;
  feedUnreadCounts: Record<string, number>;
  feedTotalCounts: Record<string, number>;
  totalUnreadCount: number;
  unreadCountByPlatform: Record<string, number>;
  totalItemCount: number;
  itemCountByPlatform: Record<string, number>;
  totalArchivableCount: number;
  archivableCountByPlatform: Record<string, number>;
  archivableFeedCounts: Record<string, number>;
  /** All globalIds including hidden/archived - for import dedup pre-scan. */
  allItemIds: string[];

  // X auth state
  xAuth: XAuthState;
  // Facebook auth state
  fbAuth: FbAuthState;
  // Instagram auth state
  igAuth: IgAuthState;
  // LinkedIn auth state
  liAuth: LiAuthState;

  // UI state
  isLoading: boolean;
  isSyncing: boolean;
  isInitialized: boolean;
  error: string | null;
  activeFilter: FilterOptions;
  selectedItemId: string | null;

  // Initialization
  initialize: () => Promise<void>;

  // Item actions (persisted to Automerge)
  addItems: (items: FeedItem[]) => Promise<void>;
  updateItem: (id: string, update: Partial<FeedItem>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: (platform?: string) => Promise<void>;
  toggleSaved: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  toggleArchived: (id: string) => Promise<void>;
  archiveAllReadUnsaved: (platform?: string, feedUrl?: string) => Promise<void>;
  /** Record like intent in Automerge. Outbox processor drains to platform. */
  toggleLiked: (id: string) => Promise<void>;

  // Feed actions (persisted to Automerge)
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string) => Promise<void>;
  renameFeed: (url: string, title: string) => Promise<void>;
  removeAllFeeds: (includeItems: boolean) => Promise<void>;

  // Friend actions (persisted to Automerge)
  addFriend: (friend: Friend) => Promise<void>;
  updateFriend: (id: string, updates: Partial<Friend>) => Promise<void>;
  removeFriend: (id: string) => Promise<void>;
  logReachOut: (id: string, entry: ReachOutLog) => Promise<void>;

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

  // UI actions (not persisted)
  setFilter: (filter: FilterOptions) => void;
  setSelectedItem: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
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

/**
 * Run idempotent startup migrations in the background after the app renders.
 * subscribe() is already wired up at call time, so any doc mutations propagate
 * to the UI automatically. Errors are swallowed - all three ops are non-fatal.
 * Migrations now run in the worker (zero main-thread cost).
 */
async function runStartupMigrations(archivePruneDays: number): Promise<void> {
  try {
    await docHealUntitledFeedTitles();
  } catch { /* non-fatal */ }
  try {
    await docDeduplicateFeedItems();
  } catch { /* non-fatal */ }
  try {
    if (archivePruneDays > 0) {
      await docPruneArchivedItems(archivePruneDays * 24 * 60 * 60 * 1000);
    }
  } catch { /* non-fatal */ }
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  items: [],
  feeds: {},
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
  allItemIds: [],
  xAuth: { isAuthenticated: false },
  fbAuth: { isAuthenticated: false },
  igAuth: { isAuthenticated: false },
  liAuth: { isAuthenticated: false },
  isLoading: true,
  isSyncing: false,
  isInitialized: false,
  error: null,
  activeFilter: {},
  selectedItemId: null,
  searchQuery: "",

  // Initialize from Automerge worker
  initialize: async () => {
    if (get().isInitialized) return;

    try {
      set({ isLoading: true });

      // initDoc() now returns DocState (pre-hydrated, WASM ran in worker).
      const docState = await initDoc();

      // Subscribe to future state updates from the worker. Each update is already
      // hydrated - no hydrateFromDoc(), no sort, no rank on the main thread.
      // Preserve object identity on count maps to avoid spurious selector re-renders.
      subscribe((state: DocState) => {
        const prev = get();
        let next: DocState = state;

        if (shallowEqualRecord(next.feedUnreadCounts, prev.feedUnreadCounts))
          next = { ...next, feedUnreadCounts: prev.feedUnreadCounts };
        if (shallowEqualRecord(next.feedTotalCounts, prev.feedTotalCounts))
          next = { ...next, feedTotalCounts: prev.feedTotalCounts };
        if (shallowEqualRecord(next.unreadCountByPlatform, prev.unreadCountByPlatform))
          next = { ...next, unreadCountByPlatform: prev.unreadCountByPlatform };
        if (shallowEqualRecord(next.itemCountByPlatform, prev.itemCountByPlatform))
          next = { ...next, itemCountByPlatform: prev.itemCountByPlatform };

        set(next);
      });

      const xCookies = loadStoredCookies();
      const xAuth = xCookies
        ? { isAuthenticated: true, cookies: xCookies }
        : { isAuthenticated: false };

      const fbAuth = initFbAuth();
      const igAuth = initIgAuth();
      const liAuth = initLiAuth();

      // Hydrate immediately from the initial DocState returned by the worker.
      set({
        ...docState,
        xAuth,
        fbAuth,
        igAuth,
        liAuth,
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
        (cb) => subscribe(() => cb()),
        platformActionsRegistry,
        async (id, syncedAt) => { await docConfirmLikedSynced(id, syncedAt); },
        async (id, syncedAt) => { await docConfirmSeenSynced(id, syncedAt); },
      );

      // Run cleanup migrations in the background via worker.
      void runStartupMigrations(docState.preferences.display.archivePruneDays ?? 30);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to initialize",
        isLoading: false,
      });
    }
  },

  // Item actions
  addItems: async (items) => {
    await docAddFeedItems(items);
  },

  updateItem: async (id, update) => {
    await docUpdateFeedItem(id, update);
  },

  markAsRead: async (id) => {
    await docMarkAsRead(id);
  },

  markAllAsRead: async (platform) => {
    await docMarkAllAsRead(platform);
  },

  toggleSaved: async (id) => {
    await docToggleSaved(id);
  },

  toggleArchived: async (id) => {
    await docToggleArchived(id);
  },

  toggleLiked: async (id) => {
    await docToggleLiked(id);
    // The outbox processor will pick up the pending like on its next drain.
  },

  archiveAllReadUnsaved: async (platform, feedUrl) => {
    await docArchiveAllReadUnsaved(platform, feedUrl);
  },

  removeItem: async (id) => {
    await docRemoveFeedItem(id);
  },

  // Feed actions
  addFeed: async (feed) => {
    await docAddRssFeed(feed);
  },

  removeFeed: async (url) => {
    await docRemoveRssFeed(url);
  },

  removeAllFeeds: async (includeItems) => {
    await docRemoveAllFeeds(includeItems);
  },

  renameFeed: async (url, title) => {
    await docUpdateRssFeed(url, { title });
  },

  // Friend actions
  addFriend: async (friend: Friend) => {
    await docAddFriend(friend);
  },

  updateFriend: async (id: string, updates: Partial<Friend>) => {
    await docUpdateFriend(id, updates);
  },

  removeFriend: async (id: string) => {
    await docRemoveFriend(id);
  },

  logReachOut: async (id: string, entry: ReachOutLog) => {
    await docLogReachOut(id, entry);
  },

  // Preference actions
  updatePreferences: async (update) => {
    await docUpdatePreferences(update);
  },

  // X auth actions
  setXAuth: (auth) => set({ xAuth: auth }),
  // Facebook auth actions
  setFbAuth: (auth) => set({ fbAuth: auth }),
  // Instagram auth actions
  setIgAuth: (auth) => set({ igAuth: auth }),
  // LinkedIn auth actions
  setLiAuth: (auth) => set({ liAuth: auth }),

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
