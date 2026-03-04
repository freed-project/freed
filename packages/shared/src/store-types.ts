/**
 * Shared store types used by both PWA and Desktop
 *
 * These define the common interface that platform-specific zustand stores
 * implement, enabling shared UI components to work with either store.
 */

import type { FeedItem, Friend, ReachOutLog, UserPreferences, RssFeed } from "./types.js";

/**
 * Filter options for the feed view.
 * Duplicated in both PWA and Desktop stores — canonicalized here.
 */
export interface FilterOptions {
  platform?: string;
  feedUrl?: string;
  tags?: string[];
  savedOnly?: boolean;
  /** Navigate to the Archived view - shows only archived items. */
  archivedOnly?: boolean;
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
  /** Friends (unified identities) — keyed by Friend.id */
  friends: Record<string, Friend>;
  preferences: UserPreferences;
  /** Unread item count per RSS feed URL. Derived in hydrateFromDoc so shared
   *  UI components (Sidebar) don't need to subscribe to the full items array. */
  feedUnreadCounts: Record<string, number>;
  /** Total visible item count per RSS feed URL. */
  feedTotalCounts: Record<string, number>;
  /** Total unread count across all non-hidden, non-archived items. */
  totalUnreadCount: number;
  /** Unread count bucketed by platform (e.g. "rss", "x"). */
  unreadCountByPlatform: Record<string, number>;
  /** Total visible (non-hidden) item count. */
  totalItemCount: number;
  /** Total visible item count bucketed by platform. */
  itemCountByPlatform: Record<string, number>;
  /** Count of archivable items (read, non-saved, non-archived) across all platforms. */
  totalArchivableCount: number;
  /** Archivable count bucketed by platform. */
  archivableCountByPlatform: Record<string, number>;
  /** Archivable count bucketed by RSS feed URL. */
  archivableFeedCounts: Record<string, number>;

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
  toggleArchived: (id: string) => Promise<void>;
  /** Archive all read, non-saved items in the current view. */
  archiveAllReadUnsaved: (platform?: string, feedUrl?: string) => Promise<void>;

  // Feed actions
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string) => Promise<void>;
  renameFeed: (url: string, title: string) => Promise<void>;
  /** Remove all feed subscriptions. Pass `includeItems: true` to also wipe all articles. */
  removeAllFeeds: (includeItems: boolean) => Promise<void>;

  // Friend actions
  addFriend: (friend: Friend) => Promise<void>;
  updateFriend: (id: string, updates: Partial<Friend>) => Promise<void>;
  removeFriend: (id: string) => Promise<void>;
  logReachOut: (id: string, entry: ReachOutLog) => Promise<void>;

  // Preference actions
  updatePreferences: (update: Partial<UserPreferences>) => Promise<void>;

  // UI actions
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
