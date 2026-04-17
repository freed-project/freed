/**
 * Global app state management with Zustand
 *
 * PWA version - uses Automerge for persistence and syncs with desktop.
 * Hydration (CRDT → plain JS) now runs in the Automerge Web Worker, so the
 * subscriber callback receives already-processed DocState — no O(n) work
 * or WASM calls on the main thread.
 */

import { create } from "zustand";
import { createDefaultPreferences } from "@freed/shared";
import type { BaseAppState, Friend, ReachOutLog, RemoveFeedOptions } from "@freed/shared";
import { recordBugReportEvent, recordRuntimeError } from "@freed/ui/lib/bug-report";
import {
  initDoc,
  subscribe,
  docAddFeedItems,
  docAddRssFeed,
  docRemoveRssFeed,
  docRemoveAllFeeds,
  docUpdateRssFeed,
  docUpdateFeedItem,
  docMarkAsRead,
  docMarkItemsAsRead,
  docMarkAllAsRead,
  docToggleSaved,
  docRemoveFeedItem,
  docToggleArchived,
  docToggleLiked,
  docArchiveAllReadUnsaved,
  docUnarchiveSavedItems,
  docDeleteAllArchived,
  docPruneArchivedItems,
  docUpdatePreferences,
  docAddFriend,
  docAddFriends,
  docUpdateFriend,
  docRemoveFriend,
  docLogReachOut,
} from "./automerge";
import type { DocState } from "./automerge";

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

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  items: [],
  searchCorpusVersion: 0,
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
  syncConnected: false,
  isLoading: true,
  isSyncing: false,
  isInitialized: false,
  error: null,
  activeFilter: {},
  selectedItemId: null,
  selectedFriendId: null,
  searchQuery: "",
  activeView: "feed",
  pendingMatchCount: 0,

  // Initialize from Automerge worker
  initialize: async () => {
    if (get().isInitialized) return;

    try {
      set({ isLoading: true });
      const state = await initDoc();

      // Subscribe to future changes before flipping isInitialized so background
      // mutations (prune, sync merges) propagate to the UI immediately.
      // Reuse count map references when values are unchanged to avoid
      // re-rendering sidebar selectors on unrelated mutations.
      subscribe((next: DocState) => {
        const prev = get();
        const merged = { ...next } as Partial<AppState>;
        if (shallowEqualRecord(next.feedUnreadCounts, prev.feedUnreadCounts))
          merged.feedUnreadCounts = prev.feedUnreadCounts;
        if (shallowEqualRecord(next.feedTotalCounts, prev.feedTotalCounts))
          merged.feedTotalCounts = prev.feedTotalCounts;
        if (shallowEqualRecord(next.unreadCountByPlatform, prev.unreadCountByPlatform))
          merged.unreadCountByPlatform = prev.unreadCountByPlatform;
        if (shallowEqualRecord(next.itemCountByPlatform, prev.itemCountByPlatform))
          merged.itemCountByPlatform = prev.itemCountByPlatform;
        set(merged);
      });

      set({ ...state, isInitialized: true, isLoading: false });

      // Prune archived items in the background. Idempotent; failure is non-fatal.
      // The subscriber above propagates the doc change to the UI automatically.
      const pruneDays = state.preferences.display.archivePruneDays ?? 30;
      if (pruneDays > 0) {
        void docPruneArchivedItems(pruneDays * 24 * 60 * 60 * 1000).catch(() => {
          // non-fatal
        });
      }
    } catch (error) {
      recordRuntimeError({ source: "pwa:initialize", error, fatal: false });
      recordBugReportEvent("pwa:initialize", "error", "Initialization failed");
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

  markItemsAsRead: async (ids) => {
    await docMarkItemsAsRead(ids);
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
  },

  archiveAllReadUnsaved: async (platform, feedUrl) => {
    await docArchiveAllReadUnsaved(platform, feedUrl);
  },

  unarchiveSavedItems: async () => {
    await docUnarchiveSavedItems();
  },

  deleteAllArchived: async () => {
    await docDeleteAllArchived();
  },

  removeItem: async (id) => {
    await docRemoveFeedItem(id);
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
    await docUpdateRssFeed(url, { title });
  },

  // Friend actions
  addFriend: async (friend: Friend) => {
    await docAddFriend(friend);
  },

  addFriends: async (friends: Friend[]) => {
    await docAddFriends(friends);
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

  // Sync actions
  setSyncConnected: (connected) => set({ syncConnected: connected }),

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setSelectedFriend: (id) => set({ selectedFriendId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveView: (activeView) => set({ activeView }),
  setPendingMatchCount: (pendingMatchCount) => set({ pendingMatchCount }),
}));
