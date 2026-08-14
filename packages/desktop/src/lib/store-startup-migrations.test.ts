import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultPreferences,
  type Account,
  type FeedItem,
  type Person,
} from "@freed/shared";
import {
  getDeviceDisplayPreferences,
  resetDeviceDisplayPreferencesForTests,
} from "@freed/ui/lib/device-display-preferences";
import {
  getFacebookGroupDiscovery,
  resetFacebookGroupDiscoveryForTests,
} from "./facebook-group-discovery";

const {
  mockDocBackfillContentSignals,
  mockDocDeduplicateFeedItems,
  mockDocHealUntitledFeedTitles,
  mockDocPruneArchivedItems,
  mockCaptureShellMemoryBaseline,
  mockInitDoc,
  mockRecordDocumentHydrated,
  mockRecordDocumentHydrationStarted,
  mockRunBackgroundJob,
  mockStartOutboxProcessor,
  mockSubscribe,
  mockUnsubscribe,
} = vi.hoisted(() => ({
  mockDocBackfillContentSignals: vi.fn(),
  mockDocDeduplicateFeedItems: vi.fn(),
  mockDocHealUntitledFeedTitles: vi.fn(),
  mockDocPruneArchivedItems: vi.fn(),
  mockCaptureShellMemoryBaseline: vi.fn(),
  mockInitDoc: vi.fn(),
  mockRecordDocumentHydrated: vi.fn(),
  mockRecordDocumentHydrationStarted: vi.fn(),
  mockRunBackgroundJob: vi.fn(),
  mockStartOutboxProcessor: vi.fn(),
  mockSubscribe: vi.fn(),
  mockUnsubscribe: vi.fn(),
}));

vi.mock("./library-client", () => ({
  initDoc: mockInitDoc,
  quiesceDesktopLibraryForFactoryReset: vi.fn(() => Promise.resolve()),
  subscribe: mockSubscribe,
  getDocState: vi.fn(() => null),
  docAddFeedItems: vi.fn(),
  docAddSampleLibraryData: vi.fn(),
  docAddRssFeed: vi.fn(),
  docRemoveRssFeed: vi.fn(),
  docRemoveAllFeeds: vi.fn(),
  docUpdateRssFeed: vi.fn(),
  docUpdateFeedItem: vi.fn(),
  docMarkItemsAsRead: vi.fn(),
  docMarkAllAsRead: vi.fn(),
  docToggleSaved: vi.fn(),
  docRemoveFeedItem: vi.fn(),
  docClearSampleData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
  docToggleArchived: vi.fn(),
  docArchiveItems: vi.fn(),
  docArchiveAllReadUnsaved: vi.fn(),
  docUnarchiveSavedItems: vi.fn(),
  docDeleteAllArchived: vi.fn(),
  docPruneArchivedItems: mockDocPruneArchivedItems,
  docUpdatePreferences: vi.fn(),
  docBackfillContentSignals: mockDocBackfillContentSignals,
  docDeduplicateFeedItems: mockDocDeduplicateFeedItems,
  docHealUntitledFeedTitles: mockDocHealUntitledFeedTitles,
  docAddAccount: vi.fn(),
  docAddAccounts: vi.fn(),
  docAddPerson: vi.fn(),
  docAddPersons: vi.fn(),
  docUpdateAccount: vi.fn(),
  docUpdatePerson: vi.fn(),
  docUpsertConnectionPersons: vi.fn(),
  docRemoveAccount: vi.fn(),
  docRemovePerson: vi.fn(),
  docLogReachOut: vi.fn(),
  docToggleLiked: vi.fn(),
  docConfirmLikedSynced: vi.fn(),
  docConfirmSeenSynced: vi.fn(),
}));

vi.mock("./background-runtime-coordinator", () => ({
  isBackgroundRuntimeDeferredError: () => false,
  runBackgroundJob: mockRunBackgroundJob,
}));

vi.mock("./platform-actions", () => ({
  buildPlatformActionsRegistry: vi.fn(() => ({})),
}));

vi.mock("./outbox", () => ({
  startOutboxProcessor: mockStartOutboxProcessor,
}));

vi.mock("./memory-monitor", () => ({
  captureShellMemoryBaseline: mockCaptureShellMemoryBaseline,
  recordDocumentHydrated: mockRecordDocumentHydrated,
  recordDocumentHydrationStarted: mockRecordDocumentHydrationStarted,
}));

vi.mock("./desktop-client-registration", () => ({
  getOrCreateDesktopClientRegistration: vi.fn(async () => ({
    id: "desktop-startup-test",
    registeredAt: 1,
  })),
}));

vi.mock("./x-auth", () => ({
  loadStoredCookies: vi.fn(() => null),
}));

vi.mock("./fb-auth", () => ({
  initFbAuth: vi.fn(() => ({ isAuthenticated: false })),
}));

vi.mock("./instagram-auth", () => ({
  initIgAuth: vi.fn(() => ({ isAuthenticated: false })),
}));

vi.mock("./li-auth", () => ({
  initLiAuth: vi.fn(() => ({ isAuthenticated: false })),
}));

vi.mock("./logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createDocState() {
  return {
    items: [],
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    desktopClientIds: [],
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
    docItemCount: 0,
  };
}

function createFeedItem(
  globalId: string,
  platform: FeedItem["platform"] = "rss",
  userState: Partial<FeedItem["userState"]> = {},
): FeedItem {
  return {
    globalId,
    platform,
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: globalId, mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: {
      saved: true,
      archived: false,
      hidden: false,
      tags: [],
      ...userState,
    },
  };
}

describe("store startup migrations", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockDocBackfillContentSignals.mockReset();
    mockDocBackfillContentSignals.mockResolvedValue({ updated: 50, remaining: 0, total: 50 });
    mockDocDeduplicateFeedItems.mockReset();
    mockDocDeduplicateFeedItems.mockResolvedValue(undefined);
    mockDocHealUntitledFeedTitles.mockReset();
    mockDocHealUntitledFeedTitles.mockResolvedValue(undefined);
    mockDocPruneArchivedItems.mockReset();
    mockDocPruneArchivedItems.mockResolvedValue(undefined);
    mockCaptureShellMemoryBaseline.mockReset();
    mockCaptureShellMemoryBaseline.mockResolvedValue(true);
    mockInitDoc.mockReset();
    mockInitDoc.mockResolvedValue(createDocState());
    mockRunBackgroundJob.mockReset();
    mockRunBackgroundJob.mockImplementation(async (task) => task.run());
    mockStartOutboxProcessor.mockReset();
    mockStartOutboxProcessor.mockReturnValue(() => {});
    mockSubscribe.mockReset();
    mockSubscribe.mockReturnValue(mockUnsubscribe);
    mockUnsubscribe.mockReset();
    mockRecordDocumentHydrated.mockReset();
    mockRecordDocumentHydrationStarted.mockReset();
    localStorage.clear();
    resetDeviceDisplayPreferencesForTests();
    resetFacebookGroupDiscoveryForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("primes the shell baseline and closes its window before loading the document", async () => {
    const order: string[] = [];
    mockCaptureShellMemoryBaseline.mockImplementation(async () => {
      order.push("baseline");
      return true;
    });
    mockRecordDocumentHydrationStarted.mockImplementation(() => {
      order.push("hydration-started");
    });
    mockInitDoc.mockImplementation(async () => {
      order.push("document");
      return createDocState();
    });
    mockRecordDocumentHydrated.mockImplementation(() => {
      order.push("hydrated");
    });
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();

    expect(order.slice(0, 4)).toEqual([
      "baseline",
      "hydration-started",
      "document",
      "hydrated",
    ]);
  });

  it("does not await a stalled shell measurement", async () => {
    mockCaptureShellMemoryBaseline.mockReturnValue(new Promise(() => {}));
    const { useAppStore } = await import("./store");

    await expect(useAppStore.getState().initialize()).resolves.toBeUndefined();

    expect(mockInitDoc).toHaveBeenCalledTimes(1);
    expect(mockRecordDocumentHydrationStarted.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitDoc.mock.invocationCallOrder[0],
    );
    expect(mockRecordDocumentHydrated.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockInitDoc.mock.invocationCallOrder[0],
    );
  });

  it("defers startup maintenance instead of running it during launch", async () => {
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockDocHealUntitledFeedTitles).not.toHaveBeenCalled();
    expect(mockDocDeduplicateFeedItems).not.toHaveBeenCalled();
    expect(mockDocPruneArchivedItems).not.toHaveBeenCalled();
    expect(mockDocBackfillContentSignals).not.toHaveBeenCalled();
    expect(mockRunBackgroundJob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    expect(mockDocHealUntitledFeedTitles).not.toHaveBeenCalled();
    expect(mockDocDeduplicateFeedItems).not.toHaveBeenCalled();
    expect(mockDocPruneArchivedItems).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(mockDocHealUntitledFeedTitles).toHaveBeenCalledTimes(1);
    expect(mockDocDeduplicateFeedItems).toHaveBeenCalledTimes(1);
    expect(mockDocPruneArchivedItems).toHaveBeenCalledTimes(1);
    expect(mockDocBackfillContentSignals).not.toHaveBeenCalled();
    expect(mockRunBackgroundJob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
    expect(mockDocBackfillContentSignals).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(mockRunBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "content-signal-backfill",
        source: "startup-migration",
      }),
    );
    expect(mockDocBackfillContentSignals).toHaveBeenCalledWith(50);
  });

  it("does not run cleanup migrations before cloud sync catches up", async () => {
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "token",
      expiresAt: Date.now() + 120_000,
    }));
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockDocHealUntitledFeedTitles).not.toHaveBeenCalled();
    expect(mockDocDeduplicateFeedItems).not.toHaveBeenCalled();
    expect(mockDocPruneArchivedItems).not.toHaveBeenCalled();
    expect(mockDocBackfillContentSignals).not.toHaveBeenCalled();
  });

  it("imports the legacy sidebar mode before initialization completes", async () => {
    const state = createDocState();
    state.preferences.display.sidebarMode = "closed";
    mockInitDoc.mockResolvedValue(state);
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().isInitialized).toBe(true);
    expect(getDeviceDisplayPreferences().sidebarMode).toBe("closed");
  });

  it("imports legacy Facebook group discovery before initialization completes", async () => {
    const state = createDocState();
    state.preferences.fbCapture.knownGroups = {
      "group-one": {
        id: "group-one",
        name: "Local group",
        url: "https://www.facebook.com/groups/group-one",
      },
    };
    mockInitDoc.mockResolvedValue(state);
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().isInitialized).toBe(true);
    expect(getFacebookGroupDiscovery()).toEqual(state.preferences.fbCapture.knownGroups);
  });

  it("coalesces concurrent initialization into one worker subscription", async () => {
    let resolveInit!: (state: ReturnType<typeof createDocState>) => void;
    mockInitDoc.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveInit = resolve;
      }),
    );
    const { useAppStore } = await import("./store");

    const initialize = useAppStore.getState().initialize;
    const first = initialize();
    const second = initialize();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(mockInitDoc).toHaveBeenCalledTimes(1));
    resolveInit(createDocState());
    await Promise.all([first, second]);

    expect(mockInitDoc).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockStartOutboxProcessor).toHaveBeenCalledTimes(1);
  });

  it("increments Library and Saved sources only for their relevant document changes", async () => {
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    const subscriber = mockSubscribe.mock.calls.at(-1)?.[0] as
      | ((
        state: ReturnType<typeof createDocState>,
        event: {
          mutation?: string;
          source?: "state_update" | "preferences_patch" | "item_patch" | "feeds_patch";
          changedItemIds?: string[];
          changedItems?: FeedItem[];
        },
      ) => void)
      | undefined;
    expect(subscriber).toBeTypeOf("function");
    expect(useAppStore.getState().libraryItemVersion).toBe(0);
    expect(useAppStore.getState().savedFeedVersion).toBe(0);

    subscriber?.(createDocState(), {
      mutation: "TOGGLE_SAVED",
      source: "item_patch",
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(1);
    expect(useAppStore.getState().savedFeedVersion).toBe(1);

    subscriber?.(createDocState(), {
      mutation: "MARK_AS_READ",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    subscriber?.(createDocState(), {
      mutation: "TOGGLE_LIKED",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    subscriber?.(createDocState(), {
      mutation: "CONFIRM_LIKED_SYNCED",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    subscriber?.(createDocState(), {
      mutation: "CONFIRM_SEEN_SYNCED",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(5);
    expect(useAppStore.getState().savedFeedVersion).toBe(1);

    const irrelevantPreferenceState = createDocState();
    irrelevantPreferenceState.preferences = {
      ...irrelevantPreferenceState.preferences,
      weights: useAppStore.getState().preferences.weights,
    };
    subscriber?.(irrelevantPreferenceState, {
      mutation: "UPDATE_PREFERENCES",
      source: "preferences_patch",
    });
    subscriber?.(createDocState(), {
      mutation: "UPDATE_RSS_FEED",
      source: "feeds_patch",
    });
    subscriber?.(createDocState(), {
      mutation: "SET_RENDERER_ITEM_HYDRATION",
      source: "state_update",
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(5);
    expect(useAppStore.getState().savedFeedVersion).toBe(1);

    const rankingPreferenceState = createDocState();
    rankingPreferenceState.preferences.weights = {
      ...useAppStore.getState().preferences.weights,
      recency: 75,
    };
    subscriber?.(rankingPreferenceState, {
      mutation: "UPDATE_PREFERENCES",
      source: "preferences_patch",
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(5);
    expect(useAppStore.getState().savedFeedVersion).toBe(2);

    subscriber?.(createDocState(), {
      mutation: "UPDATE_PREFERENCES",
      source: "state_update",
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(3);

    subscriber?.(createDocState(), {
      mutation: "ADD_FEED_ITEMS",
      source: "item_patch",
    });
    subscriber?.(createDocState(), {
      mutation: "FUTURE_ITEM_PATCH",
      source: "item_patch",
    });
    subscriber?.(createDocState(), {
      mutation: "TOGGLE_ARCHIVED",
      source: "item_patch",
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(6);

    subscriber?.(createDocState(), {
      mutation: "MERGE_DOC",
      source: "state_update",
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(10);
    expect(useAppStore.getState().savedFeedVersion).toBe(7);
  });

  it("publishes bounded Saved deltas and rebuilds oversized identity sets", async () => {
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    const subscriber = mockSubscribe.mock.calls.at(-1)?.[0] as
      | ((
          state: ReturnType<typeof createDocState>,
          event: {
            mutation: string;
            source: "item_patch";
            changedItemIds: string[];
            changedItems: FeedItem[];
          },
        ) => void)
      | undefined;
    expect(subscriber).toBeTypeOf("function");

    const first = createFeedItem("read-one", "rss", { readAt: 100 });
    const second = createFeedItem("read-two", "rss", { readAt: 100 });
    subscriber?.(createDocState(), {
      mutation: "MARK_ITEMS_AS_READ",
      source: "item_patch",
      changedItemIds: [first.globalId, second.globalId],
      changedItems: [first, second],
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(0);
    expect(useAppStore.getState().savedFeedPresentationPatch).toMatchObject({
      revision: 1,
      sourceVersion: 0,
      readAt: 100,
      readItemIds: ["read-one", "read-two"],
      readPlatforms: [],
      userStates: [],
    });

    const markAllX = createFeedItem("all-x", "x", { readAt: 200 });
    const markAllRss = createFeedItem("all-rss", "rss", { readAt: 200 });
    subscriber?.(createDocState(), {
      mutation: "MARK_ALL_AS_READ",
      source: "item_patch",
      changedItemIds: [markAllX.globalId, markAllRss.globalId],
      changedItems: [markAllX, markAllRss],
    });
    expect(useAppStore.getState().savedFeedPresentationPatch).toMatchObject({
      revision: 2,
      readAt: 200,
      readItemIds: ["read-one", "read-two"],
      readPlatforms: ["rss", "x"],
    });

    const liked = createFeedItem("liked", "x", {
      liked: true,
      likedAt: 250,
      likedSyncedAt: 300,
    });
    subscriber?.(createDocState(), {
      mutation: "CONFIRM_LIKED_SYNCED",
      source: "item_patch",
      changedItemIds: [liked.globalId],
      changedItems: [liked],
    });
    const receiptPatch = useAppStore.getState().savedFeedPresentationPatch;
    expect(receiptPatch).toMatchObject({
      revision: 3,
      sourceVersion: 0,
      userStates: [
        {
          globalId: "liked",
          liked: true,
          likedAt: 250,
          likedSyncedAt: 300,
          seenSyncedAt: null,
        },
      ],
    });

    useAppStore.getState().acknowledgeSavedFeedPresentationPatch(0, 2);
    expect(useAppStore.getState().savedFeedPresentationPatch?.revision).toBe(3);
    useAppStore
      .getState()
      .acknowledgeSavedFeedPresentationPatch(0, receiptPatch?.revision ?? -1);
    expect(useAppStore.getState().savedFeedPresentationPatch).toBeNull();

    const oversizedIds = Array.from(
      { length: 513 },
      (_, index) => `read-${index}`,
    );
    subscriber?.(createDocState(), {
      mutation: "MARK_ITEMS_AS_READ",
      source: "item_patch",
      changedItemIds: oversizedIds,
      changedItems: [],
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(1);
    expect(useAppStore.getState().savedFeedPresentationPatch).toBeNull();

    const maximumUserStates = Array.from({ length: 512 }, (_, index) =>
      createFeedItem(`liked-${index}`, "x", {
        liked: true,
        likedAt: 400 + index,
        likedSyncedAt: 800 + index,
      }),
    );
    subscriber?.(createDocState(), {
      mutation: "CONFIRM_LIKED_SYNCED",
      source: "item_patch",
      changedItemIds: maximumUserStates.map((item) => item.globalId),
      changedItems: maximumUserStates,
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(1);
    expect(
      useAppStore.getState().savedFeedPresentationPatch?.userStates,
    ).toHaveLength(512);

    const overflowUserState = createFeedItem("liked-512", "x", {
      liked: true,
      likedAt: 912,
      likedSyncedAt: 1_312,
    });
    subscriber?.(createDocState(), {
      mutation: "CONFIRM_LIKED_SYNCED",
      source: "item_patch",
      changedItemIds: [overflowUserState.globalId],
      changedItems: [overflowUserState],
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(2);
    expect(useAppStore.getState().savedFeedPresentationPatch).toBeNull();
  });

  it("replaces the document subscription when initialization runs again", async () => {
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    useAppStore.setState({ isInitialized: false });
    await useAppStore.getState().initialize();

    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps pins through empty startup and prunes only authoritative Desktop states", async () => {
    const person: Person = {
      id: "person-removed",
      name: "Removed",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: 1,
      updatedAt: 1,
    };
    const account: Account = {
      id: "account-linked",
      personId: person.id,
      kind: "social",
      provider: "instagram",
      externalId: "linked",
      firstSeenAt: 1,
      lastSeenAt: 1,
      discoveredFrom: "captured_item",
      createdAt: 1,
      updatedAt: 1,
    };
    const { useAppStore } = await import("./store");
    const {
      getDeviceAccountGraphLayout,
      getDevicePersonGraphLayout,
      setDeviceAccountGraphPosition,
      setDevicePersonGraphPosition,
    } = await import("@freed/ui/lib/device-graph-layout");

    setDevicePersonGraphPosition(person.id, 10, 20, 100);
    setDeviceAccountGraphPosition(account.id, 30, 40, 200);
    await useAppStore.getState().initialize();

    expect(getDevicePersonGraphLayout(person.id)).not.toBeNull();
    expect(getDeviceAccountGraphLayout(account.id)).not.toBeNull();

    const subscriber = mockSubscribe.mock.calls.at(-1)?.[0] as
      | ((
        state: ReturnType<typeof createDocState>,
        event: { mutation?: string },
      ) => void)
      | undefined;
    expect(subscriber).toBeTypeOf("function");
    subscriber?.(createDocState(), { mutation: "UPDATE_PERSON" });

    expect(getDevicePersonGraphLayout(person.id)).not.toBeNull();
    expect(getDeviceAccountGraphLayout(account.id)).not.toBeNull();

    const accountRemoved = createDocState();
    accountRemoved.persons = { [person.id]: person };
    subscriber?.(accountRemoved, { mutation: "REMOVE_ACCOUNT" });
    expect(getDevicePersonGraphLayout(person.id)).not.toBeNull();
    expect(getDeviceAccountGraphLayout(account.id)).toBeNull();

    subscriber?.(createDocState(), { mutation: "REMOVE_PERSON" });
    expect(getDevicePersonGraphLayout(person.id)).toBeNull();

  });
});
