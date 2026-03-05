/**
 * Global app state management with Zustand
 *
 * PWA version - uses Automerge for persistence and syncs with desktop.
 */

import { create } from "zustand";
import { createDefaultPreferences, rankFeedItems } from "@freed/shared";
import type { BaseAppState, Friend, ReachOutLog } from "@freed/shared";
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
  docMarkAllAsRead,
  docToggleSaved,
  docRemoveFeedItem,
  docToggleArchived,
  docArchiveAllReadUnsaved,
  docPruneArchivedItems,
  docUpdatePreferences,
  docAddFriend,
  docUpdateFriend,
  docRemoveFriend,
  docLogReachOut,
} from "./automerge";
import type { FreedDoc } from "@freed/shared/schema";

/** PWA-specific store state — extends the shared base with sync connection status. */
interface AppState extends BaseAppState {
  syncConnected: boolean;
  setSyncConnected: (connected: boolean) => void;
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
 * Hydrate store state from Automerge document
 */
function hydrateFromDoc(doc: FreedDoc): Partial<AppState> {
  const allItems = Object.values(doc.feedItems);

  const visibleItems = allItems.filter((item) => !item.userState.hidden);
  const rankedItems = rankFeedItems(
    visibleItems.sort((a, b) => b.publishedAt - a.publishedAt),
    doc.preferences.weights,
  );

  // Single pass: derive all count derivations.
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
      // Read and not saved: eligible for batch archive
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
  syncConnected: false,
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

      // Prune archived items older than the configured threshold
      const pruneDays = doc.preferences.display.archivePruneDays ?? 30;
      if (pruneDays > 0) {
        await docPruneArchivedItems(pruneDays * 24 * 60 * 60 * 1000);
      }

      // Subscribe to future changes (for sync).
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

      // Hydrate initial state
      set({
        ...hydrateFromDoc(doc),
        isInitialized: true,
        isLoading: false,
      });
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

  // Sync actions
  setSyncConnected: (connected) => set({ syncConnected: connected }),

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
