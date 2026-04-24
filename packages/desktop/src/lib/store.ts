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
import type { Account, FeedItem, FilterOptions, Friend, Person, ReachOutLog, UserPreferences, RssFeed, RemoveFeedOptions } from "@freed/shared";
import {
  accountsFromLegacyFriend,
  buildConnectionPersonDraftFromAccounts,
  createDefaultPreferences,
  isPrunableConnectionPerson,
  personFromLegacyFriend,
} from "@freed/shared";
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
  docMarkItemsAsRead,
  docMarkAllAsRead,
  docToggleSaved,
  docRemoveFeedItem,
  docToggleArchived,
  docArchiveAllReadUnsaved,
  docUnarchiveSavedItems,
  docDeleteAllArchived,
  docPruneArchivedItems,
  docUpdatePreferences,
  docDeduplicateFeedItems,
  docHealUntitledFeedTitles,
  docAddAccount,
  docAddAccounts,
  docAddPerson,
  docAddPersons,
  docUpdateAccount,
  docUpdatePerson,
  docUpsertConnectionPersons,
  docRemoveAccount,
  docRemovePerson,
  docLogReachOut,
  docToggleLiked,
  docConfirmLikedSynced,
  docConfirmSeenSynced,
  type DocState,
} from "./automerge";
import { buildPlatformActionsRegistry } from "./platform-actions";
import { startOutboxProcessor } from "./outbox";
import { loadStoredCookies, type XAuthState } from "./x-auth";
import { recordBugReportEvent, recordRuntimeError } from "@freed/ui/lib/bug-report";

let outboxTeardown: (() => void) | null = null;
import { initFbAuth, type FbAuthState } from "./fb-auth";
import { initIgAuth, type IgAuthState } from "./instagram-auth";
import { initLiAuth, type LiAuthState } from "./li-auth";

export type SyncProviderId =
  | "rss"
  | "x"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "gdrive"
  | "dropbox";

export type ProviderSyncCounts = Record<SyncProviderId, number>;

const EMPTY_PROVIDER_SYNC_COUNTS: ProviderSyncCounts = {
  rss: 0,
  x: 0,
  facebook: 0,
  instagram: 0,
  linkedin: 0,
  gdrive: 0,
  dropbox: 0,
};

// App state interface
interface AppState {
  // Data (received pre-hydrated from Automerge worker as DocState)
  items: FeedItem[];
  searchCorpusVersion: number;
  feeds: Record<string, RssFeed>;
  persons: Record<string, Person>;
  accounts: Record<string, Account>;
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
  /** Total feed-item records including hidden and archived items. */
  docItemCount: number;

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
  providerSyncCounts: ProviderSyncCounts;
  isInitialized: boolean;
  error: string | null;
  activeFilter: FilterOptions;
  selectedItemId: string | null;
  selectedPersonId: string | null;
  selectedAccountId: string | null;
  selectedFriendId: string | null;

  // Initialization
  initialize: () => Promise<void>;

  // Item actions (persisted to Automerge)
  addItems: (items: FeedItem[]) => Promise<void>;
  updateItem: (id: string, update: Partial<FeedItem>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markItemsAsRead: (ids: string[]) => Promise<void>;
  markAllAsRead: (platform?: string) => Promise<void>;
  toggleSaved: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  toggleArchived: (id: string) => Promise<void>;
  archiveAllReadUnsaved: (platform?: string, feedUrl?: string) => Promise<void>;
  /** Record like intent in Automerge. Outbox processor drains to platform. */
  toggleLiked: (id: string) => Promise<void>;

  // Feed actions (persisted to Automerge)
  addFeed: (feed: RssFeed) => Promise<void>;
  removeFeed: (url: string, options?: RemoveFeedOptions) => Promise<void>;
  renameFeed: (url: string, title: string) => Promise<void>;
  removeAllFeeds: (includeItems: boolean) => Promise<void>;

  // Friend actions (persisted to Automerge)
  addPerson: (person: Person) => Promise<void>;
  addPersons: (persons: Person[]) => Promise<void>;
  updatePerson: (id: string, updates: Partial<Person>) => Promise<void>;
  removePerson: (id: string) => Promise<void>;
  addFriend: (friend: Friend) => Promise<void>;
  addFriends: (friends: Friend[]) => Promise<void>;
  updateFriend: (id: string, updates: Partial<Friend>) => Promise<void>;
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
  setSelectedPerson: (id: string | null) => void;
  setSelectedAccount: (id: string | null) => void;
  setSelectedFriend: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setProviderSyncing: (provider: SyncProviderId, syncing: boolean) => void;
  setError: (error: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // View navigation
  activeView: "feed" | "friends" | "map";
  setActiveView: (view: "feed" | "friends" | "map") => void;
  pendingMatchCount: number;
  setPendingMatchCount: (count: number) => void;
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

async function pruneConnectionPersonIfNeeded(
  getState: () => AppState,
  personId: string | null | undefined,
  ignoredAccountIds: string[] = [],
): Promise<void> {
  const state = getState();
  if (!isPrunableConnectionPerson(state.persons, state.accounts, personId, ignoredAccountIds)) {
    return;
  }
  await docRemovePerson(personId!);
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

const READ_MARK_BATCH_DELAY_MS = 50;
const pendingReadIds = new Set<string>();
let readMarkBatchTimer: ReturnType<typeof setTimeout> | null = null;
let readMarkBatchInFlight = false;
let readMarkBatchWaiters: Array<() => void> = [];

function scheduleReadMarkBatchFlush(): void {
  if (readMarkBatchTimer || readMarkBatchInFlight || pendingReadIds.size === 0) return;
  readMarkBatchTimer = setTimeout(() => {
    readMarkBatchTimer = null;
    void flushPendingReadMarks();
  }, READ_MARK_BATCH_DELAY_MS);
}

function recordReadStateFailure(error: unknown, batchSize: number): void {
  const detail = error instanceof Error ? error.message : String(error);
  recordRuntimeError({ source: "desktop:readState", error, fatal: false });
  recordBugReportEvent(
    "desktop:readState",
    "error",
    `Read state update failed for ${batchSize.toLocaleString()} item${batchSize === 1 ? "" : "s"}`,
    detail,
  );
}

async function flushPendingReadMarks(): Promise<void> {
  if (readMarkBatchInFlight) return;
  readMarkBatchInFlight = true;

  try {
    while (pendingReadIds.size > 0) {
      const ids = Array.from(pendingReadIds);
      pendingReadIds.clear();

      try {
        await docMarkItemsAsRead(ids);
      } catch (error) {
        recordReadStateFailure(error, ids.length);
      }
    }
  } finally {
    readMarkBatchInFlight = false;
    const waiters = readMarkBatchWaiters;
    readMarkBatchWaiters = [];
    waiters.forEach((resolve) => resolve());
    scheduleReadMarkBatchFlush();
  }
}

function queueReadMarks(ids: readonly string[]): Promise<void> {
  const nextIds = ids.filter(Boolean);
  if (nextIds.length === 0) return Promise.resolve();

  for (const id of nextIds) pendingReadIds.add(id);

  const promise = new Promise<void>((resolve) => {
    readMarkBatchWaiters.push(resolve);
  });

  scheduleReadMarkBatchFlush();
  return promise;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  items: [],
  searchCorpusVersion: 0,
  feeds: {},
  persons: {},
  accounts: {},
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
  docItemCount: 0,
  xAuth: { isAuthenticated: false },
  fbAuth: { isAuthenticated: false },
  igAuth: { isAuthenticated: false },
  liAuth: { isAuthenticated: false },
  isLoading: true,
  isSyncing: false,
  providerSyncCounts: { ...EMPTY_PROVIDER_SYNC_COUNTS },
  isInitialized: false,
  error: null,
  activeFilter: {},
  selectedItemId: null,
  selectedPersonId: null,
  selectedAccountId: null,
  selectedFriendId: null,
  searchQuery: "",
  activeView: "feed",
  pendingMatchCount: 0,

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
        let next: Partial<AppState> = { ...state };

        if (shallowEqualRecord(state.feedUnreadCounts, prev.feedUnreadCounts))
          next = { ...next, feedUnreadCounts: prev.feedUnreadCounts };
        if (shallowEqualRecord(state.feedTotalCounts, prev.feedTotalCounts))
          next = { ...next, feedTotalCounts: prev.feedTotalCounts };
        if (shallowEqualRecord(state.unreadCountByPlatform, prev.unreadCountByPlatform))
          next = { ...next, unreadCountByPlatform: prev.unreadCountByPlatform };
        if (shallowEqualRecord(state.itemCountByPlatform, prev.itemCountByPlatform))
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
      recordRuntimeError({ source: "desktop:initialize", error, fatal: false });
      recordBugReportEvent("desktop:initialize", "error", "Initialization failed");
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
    await queueReadMarks([id]);
  },

  markItemsAsRead: async (ids) => {
    await queueReadMarks(ids);
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

  removeFeed: async (url, options) => {
    await docRemoveRssFeed(url, options?.includeItems ?? false);
    const { forgetRssFeedHealth } = await import("./provider-health");
    await forgetRssFeedHealth(url);
  },

  removeAllFeeds: async (includeItems) => {
    const feedUrls = Object.keys(get().feeds);
    await docRemoveAllFeeds(includeItems);
    const { forgetRssFeedHealth } = await import("./provider-health");
    await Promise.all(feedUrls.map((url) => forgetRssFeedHealth(url)));
  },

  renameFeed: async (url, title) => {
    await docUpdateRssFeed(url, { title });
  },

  // Person actions
  addPerson: async (person: Person) => {
    await docAddPerson(person);
  },

  addPersons: async (persons: Person[]) => {
    await docAddPersons(persons);
  },

  updatePerson: async (id: string, updates: Partial<Person>) => {
    await docUpdatePerson(id, updates);
  },

  removePerson: async (id: string) => {
    await docRemovePerson(id);
  },

  logReachOut: async (id: string, entry: ReachOutLog) => {
    await docLogReachOut(id, entry);
  },

  linkAccountToPerson: async (accountId: string, personId: string | null) => {
    const account = get().accounts[accountId];
    if (!account) return;
    const previousPersonId = account.personId ?? null;
    if (previousPersonId === personId) return;
    await docUpdateAccount(accountId, {
      personId: personId ?? undefined,
      updatedAt: Date.now(),
    });
    await pruneConnectionPersonIfNeeded(get, previousPersonId, [accountId]);
  },

  createConnectionPersonFromAccounts: async (accountIds: string[], personOverride?: Person) => {
    const person = buildConnectionPersonDraftFromAccounts(get().accounts, accountIds, Date.now(), personOverride);
    if (!person) {
      throw new Error("Connection person requires at least one social account with a likely human name.");
    }
    if (get().persons[person.id]) {
      await docUpdatePerson(person.id, person);
    } else {
      await docAddPerson(person);
    }
    for (const accountId of accountIds) {
      await get().linkAccountToPerson(accountId, person.id);
    }
    return person.id;
  },

  createConnectionPersonsFromCandidates: async (candidates) => {
    if (candidates.length === 0) return 0;
    await docUpsertConnectionPersons(candidates);
    return candidates.length;
  },

  // Deprecated friend aliases
  addFriend: async (friend: Friend) => {
    await docAddPerson(personFromLegacyFriend(friend));
    const accounts = accountsFromLegacyFriend(friend);
    if (accounts.length > 0) {
      await docAddAccounts(accounts);
    }
  },

  addFriends: async (friends: Friend[]) => {
    const persons = friends.map((friend) => personFromLegacyFriend(friend as Friend));
    await docAddPersons(persons);
    const accounts = friends.flatMap((friend) => accountsFromLegacyFriend(friend as Friend));
    if (accounts.length > 0) {
      await docAddAccounts(accounts);
    }
  },

  updateFriend: async (id: string, updates: Partial<Friend>) => {
    const current = get().friends[id];
    if (!current) {
      await docUpdatePerson(id, updates);
      return;
    }
    const nextFriend = {
      ...current,
      ...updates,
      sources: "sources" in updates ? ((updates as Partial<Friend>).sources ?? []) : current.sources,
      contact: "contact" in updates ? (updates as Partial<Friend>).contact : current.contact,
    } as Friend;
    await docUpdatePerson(id, personFromLegacyFriend(nextFriend));
    const existingAccounts = Object.values(get().accounts).filter((account) => account.personId === id);
    await Promise.all(existingAccounts.map((account) => docRemoveAccount(account.id)));
    const nextAccounts = accountsFromLegacyFriend(nextFriend);
    if (nextAccounts.length > 0) {
      await docAddAccounts(nextAccounts);
    }
  },

  removeFriend: async (id: string) => {
    await docRemovePerson(id);
  },

  addAccount: async (account: Account) => {
    await docAddAccount(account);
  },

  addAccounts: async (accounts: Account[]) => {
    await docAddAccounts(accounts);
  },

  updateAccount: async (id: string, updates: Partial<Account>) => {
    await docUpdateAccount(id, updates);
  },

  removeAccount: async (id: string) => {
    const previousPersonId = get().accounts[id]?.personId ?? null;
    await docRemoveAccount(id);
    await pruneConnectionPersonIfNeeded(get, previousPersonId);
  },

  // Preference actions
  updatePreferences: async (update) => {
    try {
      await docUpdatePreferences(update);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      recordRuntimeError({ source: "desktop:updatePreferences", error, fatal: false });
      recordBugReportEvent(
        "desktop:updatePreferences",
        "error",
        "Preference update failed",
        detail,
      );
    }
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
  setSelectedPerson: (id) => set({ selectedPersonId: id, selectedAccountId: null, selectedFriendId: id }),
  setSelectedAccount: (id) => set({ selectedPersonId: null, selectedAccountId: id, selectedFriendId: null }),
  setSelectedFriend: (id) => set({ selectedPersonId: id, selectedAccountId: null, selectedFriendId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setProviderSyncing: (provider, syncing) =>
    set((state) => ({
      providerSyncCounts: {
        ...state.providerSyncCounts,
        [provider]: Math.max(
          0,
          (state.providerSyncCounts[provider] ?? 0) + (syncing ? 1 : -1),
        ),
      },
    })),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveView: (activeView) => set({ activeView }),
  setPendingMatchCount: (pendingMatchCount) => set({ pendingMatchCount }),
}));

export async function withProviderSyncing<T>(
  provider: SyncProviderId,
  task: () => Promise<T>,
): Promise<T> {
  useAppStore.getState().setProviderSyncing(provider, true);
  try {
    return await task();
  } finally {
    useAppStore.getState().setProviderSyncing(provider, false);
  }
}
