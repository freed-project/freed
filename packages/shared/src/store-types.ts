/**
 * Shared store types used by both PWA and Desktop
 *
 * These define the common interface that platform-specific zustand stores
 * implement, enabling shared UI components to work with either store.
 */

import type { FeedItem, UserPreferences, RssFeed } from "./types.js";

/**
 * Filter options for the feed view.
 * Duplicated in both PWA and Desktop stores — canonicalized here.
 */
export interface FilterOptions {
  platform?: string;
  feedUrl?: string;
  tags?: string[];
  savedOnly?: boolean;
  showArchived?: boolean;
}

/**
 * Base app state interface shared by both PWA and Desktop stores.
 * Shared UI components select only from this interface.
 * Platform-specific fields (e.g. xAuth, syncConnected) live in the
 * platform's own store extension and are accessed by platform-specific widgets.
 */
export interface BaseAppState {
  // Data (derived from Automerge doc)
  items: FeedItem[];
  feeds: Record<string, RssFeed>;
  preferences: UserPreferences;

  // UI state
  isLoading: boolean;
  isSyncing: boolean;
  isInitialized: boolean;
  error: string | null;
  activeFilter: FilterOptions;
  selectedItemId: string | null;

  // Initialization
  initialize: () => Promise<void>;

  // Item actions
  addItems: (items: FeedItem[]) => Promise<void>;
  updateItem: (id: string, update: Partial<FeedItem>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: (platform?: string) => Promise<void>;
  toggleSaved: (id: string) => Promise<void>;

  // Feed actions
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string) => Promise<void>;

  // Preference actions
  updatePreferences: (update: Partial<UserPreferences>) => Promise<void>;

  // UI actions
  setFilter: (filter: FilterOptions) => void;
  setSelectedItem: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
}

/**
 * Progress state for OPML feed import operations.
 * Used by both PWA and Desktop capture modules.
 */
export interface ImportProgress {
  total: number;
  completed: number;
  current: string;
  added: number;
  skipped: number;
  failed: Array<{ url: string; error: string }>;
}
