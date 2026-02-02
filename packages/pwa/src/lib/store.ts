/**
 * Global app state management with Zustand
 */

import { create } from "zustand";
import type { FeedItem, UserPreferences, RssFeed } from "@freed/shared";
import { createDefaultPreferences } from "@freed/shared";

// Filter options for the feed view
interface FilterOptions {
  platform?: string;
  tags?: string[];
  savedOnly?: boolean;
  showArchived?: boolean;
}

// App state interface
interface AppState {
  // Data
  items: FeedItem[];
  feeds: Record<string, RssFeed>;
  preferences: UserPreferences;

  // UI state
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  activeFilter: FilterOptions;
  selectedItemId: string | null;

  // Actions
  setItems: (items: FeedItem[]) => void;
  addItem: (item: FeedItem) => void;
  updateItem: (id: string, update: Partial<FeedItem>) => void;
  removeItem: (id: string) => void;

  setFeeds: (feeds: Record<string, RssFeed>) => void;
  addFeed: (feed: RssFeed) => void;
  removeFeed: (url: string) => void;

  setPreferences: (prefs: UserPreferences) => void;
  updatePreferences: (update: Partial<UserPreferences>) => void;

  setFilter: (filter: FilterOptions) => void;
  setSelectedItem: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  items: [],
  feeds: {},
  preferences: createDefaultPreferences(),
  isLoading: false,
  isSyncing: false,
  error: null,
  activeFilter: {},
  selectedItemId: null,

  // Item actions
  setItems: (items) => set({ items }),

  addItem: (item) =>
    set((state) => ({
      items: [item, ...state.items],
    })),

  updateItem: (id, update) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.globalId === id ? { ...item, ...update } : item,
      ),
    })),

  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.globalId !== id),
    })),

  // Feed actions
  setFeeds: (feeds) => set({ feeds }),

  addFeed: (feed) =>
    set((state) => ({
      feeds: { ...state.feeds, [feed.url]: feed },
    })),

  removeFeed: (url) =>
    set((state) => {
      const { [url]: _, ...rest } = state.feeds;
      return { feeds: rest };
    }),

  // Preference actions
  setPreferences: (preferences) => set({ preferences }),

  updatePreferences: (update) =>
    set((state) => ({
      preferences: { ...state.preferences, ...update },
    })),

  // UI actions
  setFilter: (filter) => set({ activeFilter: filter }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (error) => set({ error }),
}));
