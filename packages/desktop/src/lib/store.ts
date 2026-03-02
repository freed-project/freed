/**
 * Global app state management with Zustand
 *
 * State is synced with Automerge CRDT for persistence and multi-device sync.
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
  docUpdateFeedItem,
  docMarkAsRead,
  docMarkAllAsRead,
  docToggleSaved,
  docUpdatePreferences,
} from "./automerge";
import type { FreedDoc } from "@freed/shared/schema";
import { loadStoredCookies, type XAuthState } from "./x-auth";

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

  // X auth state
  xAuth: XAuthState;

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

  // Preference actions (persisted to Automerge)
  updatePreferences: (update: Partial<UserPreferences>) => Promise<void>;

  // X auth actions
  setXAuth: (auth: XAuthState) => void;

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
  const items = Object.values(doc.feedItems)
    .filter((item) => !item.userState.hidden)
    .sort((a, b) => b.publishedAt - a.publishedAt);

  // Apply ranking
  const rankedItems = rankFeedItems(items, doc.preferences.weights);

  return {
    items: rankedItems,
    feeds: doc.rssFeeds,
    preferences: doc.preferences,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  items: [],
  feeds: {},
  preferences: createDefaultPreferences(),
  xAuth: { isAuthenticated: false },
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

      // Load X auth state from storage
      const xCookies = loadStoredCookies();
      const xAuth = xCookies
        ? { isAuthenticated: true, cookies: xCookies }
        : { isAuthenticated: false };

      // Hydrate initial state
      set({
        ...hydrateFromDoc(doc),
        xAuth,
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

  // Preference actions
  updatePreferences: async (update) => {
    await docUpdatePreferences(update);
  },

  // X auth actions
  setXAuth: (auth) => set({ xAuth: auth }),

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (error) => set({ error }),
}));
