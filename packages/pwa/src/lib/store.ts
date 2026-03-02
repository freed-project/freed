/**
 * Global app state management with Zustand
 *
 * PWA version - uses Automerge for persistence and syncs with desktop.
 */

import { create } from "zustand";
import type { FeedItem, UserPreferences, RssFeed } from "@freed/shared";
import { createDefaultPreferences, rankFeedItems } from "@freed/shared";
import {
  initDoc,
  subscribe,
  docAddFeedItems,
  docAddRssFeed,
  docRemoveRssFeed,
  docUpdateRssFeed,
  docUpdateFeedItem,
  docMarkAsRead,
  docMarkAllAsRead,
  docToggleSaved,
  docUpdatePreferences,
} from "./automerge";
import type { FreedDoc } from "@freed/shared/schema";

// Filter options for the feed view
interface FilterOptions {
  platform?: string;
  feedUrl?: string;
  tags?: string[];
  savedOnly?: boolean;
  showArchived?: boolean;
}

// App state interface
interface AppState {
  // Data (derived from Automerge doc)
  items: FeedItem[];
  feeds: Record<string, RssFeed>;
  preferences: UserPreferences;
  /** Unread count per feed URL — derived in hydrateFromDoc, stable reference when unchanged */
  feedUnreadCounts: Record<string, number>;

  // Sync state
  syncConnected: boolean;

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

  // Feed actions (persisted to Automerge)
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string) => Promise<void>;
  renameFeed: (url: string, title: string) => Promise<void>;

  // Preference actions (persisted to Automerge)
  updatePreferences: (update: Partial<UserPreferences>) => Promise<void>;

  // Sync actions
  setSyncConnected: (connected: boolean) => void;

  // UI actions (not persisted)
  setFilter: (filter: FilterOptions) => void;
  setSelectedItem: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
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
  let totalUnreadCount = 0;
  let totalItemCount = 0;
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
    }
  }

  return {
    items: rankedItems,
    feeds: doc.rssFeeds,
    preferences: doc.preferences,
    feedUnreadCounts,
    feedTotalCounts,
    totalUnreadCount,
    unreadCountByPlatform,
    totalItemCount,
    itemCountByPlatform,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  items: [],
  feeds: {},
  preferences: createDefaultPreferences(),
  feedUnreadCounts: {},
  feedTotalCounts: {},
  totalUnreadCount: 0,
  unreadCountByPlatform: {},
  totalItemCount: 0,
  itemCountByPlatform: {},
  syncConnected: false,
  isLoading: false,
  isSyncing: false,
  isInitialized: false,
  error: null,
  activeFilter: {},
  selectedItemId: null,

  // Initialize from Automerge
  initialize: async () => {
    if (get().isInitialized) return;

    try {
      set({ isLoading: true });
      const doc = await initDoc();

      // Subscribe to future changes (for sync)
      subscribe((updatedDoc) => {
        set(hydrateFromDoc(updatedDoc));
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

  // Feed actions
  addFeed: async (feed) => {
    await docAddRssFeed(feed);
  },

  removeFeed: async (url) => {
    await docRemoveRssFeed(url);
  },

  renameFeed: async (url, title) => {
    await docUpdateRssFeed(url, { title });
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
}));
