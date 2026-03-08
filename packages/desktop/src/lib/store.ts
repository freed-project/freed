/**
 * Global app state management with Zustand
 *
 * State is synced with Automerge CRDT for persistence and multi-device sync.
 */

import { create } from "zustand";
import type { FeedItem, FilterOptions, Friend, ReachOutLog, UserPreferences, RssFeed } from "@freed/shared";
import { createDefaultPreferences, rankFeedItems } from "@freed/shared";
import {
  initDoc,
  subscribe,
  getDoc,
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
} from "./automerge";
import { buildPlatformActionsRegistry } from "./platform-actions";
import { startOutboxProcessor } from "./outbox";
import type { FreedDoc } from "@freed/shared/schema";

let outboxTeardown: (() => void) | null = null;
import { loadStoredCookies, type XAuthState } from "./x-auth";
import { initFbAuth, type FbAuthState } from "./fb-auth";
import { initIgAuth, type IgAuthState } from "./instagram-auth";


// App state interface
interface AppState {
  // Data (derived from Automerge doc)
  items: FeedItem[];
  feeds: Record<string, RssFeed>;
  /** Friends (unified identities) — keyed by Friend.id */
  friends: Record<string, Friend>;
  preferences: UserPreferences;
  /** Unread count per feed URL — derived in hydrateFromDoc */
  feedUnreadCounts: Record<string, number>;
  /** Total visible item count per feed URL. */
  feedTotalCounts: Record<string, number>;
  /** Total unread count across all non-hidden, non-archived items. */
  totalUnreadCount: number;
  /** Unread count bucketed by platform. */
  unreadCountByPlatform: Record<string, number>;
  /** Total visible (non-hidden) item count. */
  totalItemCount: number;
  /** Total visible item count bucketed by platform. */
  itemCountByPlatform: Record<string, number>;
  /** Total read-but-not-saved items eligible for archiving. */
  totalArchivableCount: number;
  /** Archivable item count bucketed by platform. */
  archivableCountByPlatform: Record<string, number>;
  /** Archivable item count per feed URL. */
  archivableFeedCounts: Record<string, number>;

  // X auth state
  xAuth: XAuthState;
  // Facebook auth state
  fbAuth: FbAuthState;
  // Instagram auth state
  igAuth: IgAuthState;

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

  // UI actions (not persisted)
  setFilter: (filter: FilterOptions) => void;
  setSelectedItem: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
  /** Current full-text search query. Empty string means no search active. */
  searchQuery: string;
  /** Update the full-text search query. Empty string clears the search. */
  setSearchQuery: (query: string) => void;
}

/**
 * Shallow-compare two string-keyed number maps.
 * Used to preserve object identity on count maps so Zustand selectors that
 * subscribe to these objects don't trigger re-renders when values are unchanged.
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
 * Cache for the expensive sort + rank step inside hydrateFromDoc.
 *
 * Re-ranking is only needed when the set of visible items changes (additions,
 * removals, hide/show) or when weights / saved-status change — because those
 * are the only inputs to calculatePriority. Mutations like markAsRead or
 * archiving do not affect priority scores, so the cache is still valid and we
 * skip the O(n log n) sort + O(n) rank entirely.
 */
const sortCache: {
  items: FeedItem[];
  visibleCount: number;
  savedCount: number;
  archivedCount: number;
  weightsJson: string;
} = { items: [], visibleCount: -1, savedCount: -1, archivedCount: -1, weightsJson: "" };

/**
 * Hydrate store state from Automerge document
 */
function hydrateFromDoc(doc: FreedDoc): Partial<AppState> {
  const allItems = Object.values(doc.feedItems);

  // Non-hidden items (archived are included — downstream filters handle them).
  const visibleItems = allItems.filter((item) => !item.userState.hidden);

  // saved and archived counts gate cache invalidation: saved affects priority
  // scores, and archived determines which items downstream filters keep.
  const savedCount = allItems.reduce(
    (n, item) => (item.userState.saved ? n + 1 : n),
    0,
  );
  const archivedCount = allItems.reduce(
    (n, item) => (item.userState.archived ? n + 1 : n),
    0,
  );
  const weightsJson = JSON.stringify(doc.preferences.weights);

  let rankedItems: FeedItem[];
  if (
    sortCache.visibleCount === visibleItems.length &&
    sortCache.savedCount === savedCount &&
    sortCache.archivedCount === archivedCount &&
    sortCache.weightsJson === weightsJson
  ) {
    // Fast path: nothing rank-affecting changed (e.g. markAsRead).
    rankedItems = sortCache.items;
  } else {
    rankedItems = rankFeedItems(
      visibleItems.sort((a, b) => b.publishedAt - a.publishedAt),
      doc.preferences.weights,
    );
    sortCache.items = rankedItems;
    sortCache.visibleCount = visibleItems.length;
    sortCache.savedCount = savedCount;
    sortCache.archivedCount = archivedCount;
    sortCache.weightsJson = weightsJson;
  }

  const feedUnreadCounts: Record<string, number> = {};
  const feedTotalCounts: Record<string, number> = {};
  const unreadCountByPlatform: Record<string, number> = {};
  const itemCountByPlatform: Record<string, number> = {};
  const archivableCountByPlatform: Record<string, number> = {};
  const archivableFeedCounts: Record<string, number> = {};
  let totalUnreadCount = 0;
  let totalItemCount = 0;
  let totalArchivableCount = 0;
  for (const item of allItems) {
    if (item.userState.hidden || item.userState.archived) continue;
    totalItemCount++;
    itemCountByPlatform[item.platform] = (itemCountByPlatform[item.platform] ?? 0) + 1;
    if (item.rssSource) {
      const url = item.rssSource.feedUrl;
      feedTotalCounts[url] = (feedTotalCounts[url] ?? 0) + 1;
    }
    if (!item.userState.readAt) {
      totalUnreadCount++;
      unreadCountByPlatform[item.platform] = (unreadCountByPlatform[item.platform] ?? 0) + 1;
      if (item.rssSource) {
        const url = item.rssSource.feedUrl;
        feedUnreadCounts[url] = (feedUnreadCounts[url] ?? 0) + 1;
      }
    } else if (!item.userState.saved) {
      totalArchivableCount++;
      archivableCountByPlatform[item.platform] = (archivableCountByPlatform[item.platform] ?? 0) + 1;
      if (item.rssSource) {
        const url = item.rssSource.feedUrl;
        archivableFeedCounts[url] = (archivableFeedCounts[url] ?? 0) + 1;
      }
    }
  }

  return {
    items: rankedItems,
    feeds: doc.rssFeeds,
    friends: doc.friends ?? {},
    preferences: doc.preferences,
    feedUnreadCounts,
    feedTotalCounts,
    totalUnreadCount,
    unreadCountByPlatform,
    totalItemCount,
    itemCountByPlatform,
    totalArchivableCount,
    archivableCountByPlatform,
    archivableFeedCounts,
  };
}

/**
 * Run idempotent startup migrations in the background after the app renders.
 * subscribe() is already wired up at call time, so any doc mutations propagate
 * to the UI automatically. Errors are swallowed — all three ops are non-fatal.
 */
async function runStartupMigrations(archivePruneDays: number): Promise<void> {
  try {
    // Heal "Untitled Feed" sentinels from URL hostname — zero network required.
    await docHealUntitledFeedTitles();
  } catch {
    // non-fatal
  }
  try {
    // Remove phantom duplicates caused by key-scheme changes (guid vs link priority).
    await docDeduplicateFeedItems();
  } catch {
    // non-fatal
  }
  try {
    if (archivePruneDays > 0) {
      await docPruneArchivedItems(archivePruneDays * 24 * 60 * 60 * 1000);
    }
  } catch {
    // non-fatal
  }
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
  xAuth: { isAuthenticated: false },
  fbAuth: { isAuthenticated: false },
  igAuth: { isAuthenticated: false },
  isLoading: true,
  isSyncing: false,
  isInitialized: false,
  error: null,
  activeFilter: {},
  selectedItemId: null,
  searchQuery: "",

  // Initialize from Automerge
  initialize: async () => {
    if (get().isInitialized) return;

    try {
      set({ isLoading: true });
      const doc = await initDoc();

      // Subscribe to future changes (for sync) before we flip isInitialized so
      // background migrations that fire immediately after are propagated to the UI.
      // Reuse count map references when values haven't changed so Sidebar
      // selectors don't trigger re-renders on unrelated mutations.
      subscribe((updatedDoc) => {
        const next = hydrateFromDoc(updatedDoc);
        const prev = get();
        if (shallowEqualRecord(next.feedUnreadCounts!, prev.feedUnreadCounts))
          next.feedUnreadCounts = prev.feedUnreadCounts;
        if (shallowEqualRecord(next.feedTotalCounts!, prev.feedTotalCounts))
          next.feedTotalCounts = prev.feedTotalCounts;
        if (shallowEqualRecord(next.unreadCountByPlatform!, prev.unreadCountByPlatform))
          next.unreadCountByPlatform = prev.unreadCountByPlatform;
        if (shallowEqualRecord(next.itemCountByPlatform!, prev.itemCountByPlatform))
          next.itemCountByPlatform = prev.itemCountByPlatform;
        set(next);
      });

      // Load X auth state from storage
      const xCookies = loadStoredCookies();
      const xAuth = xCookies
        ? { isAuthenticated: true, cookies: xCookies }
        : { isAuthenticated: false };

      const fbAuth = initFbAuth();
      const igAuth = initIgAuth();

      // Hydrate and show the app immediately — no need to wait for migrations.
      set({
        ...hydrateFromDoc(doc),
        xAuth,
        fbAuth,
        igAuth,
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
        () => { try { return getDoc(); } catch { return null; } },
        (cb) => subscribe((_doc) => cb()),
        platformActionsRegistry,
        async (id, syncedAt) => { await docConfirmLikedSynced(id, syncedAt); },
        async (id, syncedAt) => { await docConfirmSeenSynced(id, syncedAt); },
      );

      // Run cleanup migrations in the background. All three are idempotent; failures
      // are non-fatal. subscribe() above propagates any changes to the UI automatically.
      void runStartupMigrations(doc.preferences.display.archivePruneDays ?? 30);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to initialize",
        isLoading: false,
      });
    }
  },

  // Item actions — errors propagate to callers so UI can surface them
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

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
