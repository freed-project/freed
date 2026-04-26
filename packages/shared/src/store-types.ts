/**
 * Shared store types used by both PWA and Desktop
 *
 * These define the common interface that platform-specific zustand stores
 * implement, enabling shared UI components to work with either store.
 */

import type {
  Account,
  ContentSignal,
  FeedItem,
  Friend,
  Person,
  ReachOutLog,
  UserPreferences,
  RssFeed,
} from "./types.js";

export interface RemoveFeedOptions {
  includeItems?: boolean;
}

export type SocialContentFilter = "all" | "posts" | "stories";

/**
 * Filter options for the feed view.
 * Duplicated in both PWA and Desktop stores — canonicalized here.
 */
export interface FilterOptions {
  platform?: string;
  feedUrl?: string;
  tags?: string[];
  signals?: ContentSignal[];
  savedOnly?: boolean;
  /** Direct Facebook and Instagram source views only. */
  socialContentFilter?: SocialContentFilter;
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
  /** Bumps only when search-relevant corpus content changes. */
  searchCorpusVersion: number;
  feeds: Record<string, RssFeed>;
  /** Canonical same-human identities — keyed by Person.id */
  persons: Record<string, Person>;
  /** Attached social/contact nodes — keyed by Account.id */
  accounts: Record<string, Account>;
  /** @deprecated Use persons. */
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
  selectedPersonId: string | null;
  selectedAccountId: string | null;
  /** @deprecated Use selectedPersonId. */
  selectedFriendId: string | null;

  // Initialization
  initialize: () => Promise<void>;

  // Item actions
  addItems: (items: FeedItem[]) => Promise<void>;
  updateItem: (id: string, update: Partial<FeedItem>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markItemsAsRead: (ids: string[]) => Promise<void>;
  markAllAsRead: (platform?: string) => Promise<void>;
  toggleSaved: (id: string) => Promise<void>;
  toggleArchived: (id: string) => Promise<void>;
  /** Archive all read, non-saved items in the current view. */
  archiveAllReadUnsaved: (platform?: string, feedUrl?: string) => Promise<void>;
  /** Repair legacy states where saved items are also marked archived. */
  unarchiveSavedItems: () => Promise<void>;
  /** Immediately delete ALL archived, non-saved items regardless of age. */
  deleteAllArchived: () => Promise<void>;
  /** Permanently remove a single feed item from the library. */
  removeItem: (id: string) => Promise<void>;
  /**
   * Record like intent in Automerge. On the desktop, the outbox processor
   * drains this to the source platform. On the PWA, it syncs to desktop first.
   * Optional — components should check for presence before rendering like buttons.
   */
  toggleLiked?: (id: string) => Promise<void>;

  // Feed actions
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string, options?: RemoveFeedOptions) => Promise<void>;
  renameFeed: (url: string, title: string) => Promise<void>;
  /** Remove all feed subscriptions. Pass `includeItems: true` to also wipe all articles. */
  removeAllFeeds: (includeItems: boolean) => Promise<void>;

  // Person actions
  addPerson: (person: Person) => Promise<void>;
  addPersons: (persons: Person[]) => Promise<void>;
  updatePerson: (id: string, updates: Partial<Person>) => Promise<void>;
  removePerson: (id: string) => Promise<void>;
  /** @deprecated Use addPerson. */
  addFriend: (friend: Friend) => Promise<void>;
  /** @deprecated Use addPersons. */
  addFriends: (friends: Friend[]) => Promise<void>;
  /** @deprecated Use updatePerson. */
  updateFriend: (id: string, updates: Partial<Friend>) => Promise<void>;
  /** @deprecated Use removePerson. */
  removeFriend: (id: string) => Promise<void>;
  logReachOut: (id: string, entry: ReachOutLog) => Promise<void>;
  addAccount: (account: Account) => Promise<void>;
  addAccounts: (accounts: Account[]) => Promise<void>;
  updateAccount: (id: string, updates: Partial<Account>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  linkAccountToPerson: (accountId: string, personId: string | null) => Promise<void>;
  createConnectionPersonFromAccounts: (accountIds: string[], person?: Person) => Promise<string>;
  createConnectionPersonsFromCandidates: (
    candidates: Array<{ person: Person; accountIds: string[] }>,
  ) => Promise<number>;

  // Preference actions
  updatePreferences: (update: Partial<UserPreferences>) => Promise<void>;

  // UI actions
  setFilter: (filter: FilterOptions) => void;
  setSelectedItem: (id: string | null) => void;
  setSelectedPerson: (id: string | null) => void;
  setSelectedAccount: (id: string | null) => void;
  /** @deprecated Use setSelectedPerson. */
  setSelectedFriend: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
  /** Current full-text search query. Empty string means no search active. */
  searchQuery: string;
  /** Update the full-text search query. Empty string clears the search. */
  setSearchQuery: (query: string) => void;

  /** The currently active top-level view. */
  activeView: "feed" | "friends" | "map";
  /** Switch the top-level view. */
  setActiveView: (view: "feed" | "friends" | "map") => void;
  /** Number of unreviewed Google Contacts match suggestions. */
  pendingMatchCount: number;
  /** Update the pending match count (set by useContactSync). */
  setPendingMatchCount: (count: number) => void;
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
