import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultPreferences,
  type FeedItem,
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
  mockHealUntitledLibraryFeedTitles,
  mockPruneArchivedLibraryItems,
  mockCapturePreLibraryMemoryBaseline,
  mockInitializeLibrary,
  mockRecordLibraryRuntimeReady,
  mockRecordLibraryRuntimeLoadStarted,
  mockStartOutboxProcessor,
  mockSubscribe,
  mockUnsubscribe,
} = vi.hoisted(() => ({
  mockHealUntitledLibraryFeedTitles: vi.fn(),
  mockPruneArchivedLibraryItems: vi.fn(),
  mockCapturePreLibraryMemoryBaseline: vi.fn(),
  mockInitializeLibrary: vi.fn(),
  mockRecordLibraryRuntimeReady: vi.fn(),
  mockRecordLibraryRuntimeLoadStarted: vi.fn(),
  mockStartOutboxProcessor: vi.fn(),
  mockSubscribe: vi.fn(),
  mockUnsubscribe: vi.fn(),
}));

vi.mock("./library-client", () => ({
  initializeDesktopLibraryRuntime: mockInitializeLibrary,
  quiesceDesktopLibraryForFactoryReset: vi.fn(() => Promise.resolve()),
  subscribeDesktopLibraryRuntime: mockSubscribe,
  getDesktopLibraryRuntimeState: vi.fn(() => null),
  addLibraryFeedItems: vi.fn(),
  addSampleLibraryData: vi.fn(),
  addLibraryRssFeed: vi.fn(),
  removeLibraryRssFeed: vi.fn(),
  removeAllLibraryFeeds: vi.fn(),
  updateLibraryRssFeed: vi.fn(),
  updateLibraryFeedItem: vi.fn(),
  markLibraryItemsAsRead: vi.fn(),
  markAllLibraryItemsAsRead: vi.fn(),
  toggleLibraryItemSaved: vi.fn(),
  removeLibraryFeedItem: vi.fn(),
  clearSampleLibraryData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
  toggleLibraryItemArchived: vi.fn(),
  archiveLibraryItems: vi.fn(),
  archiveAllReadUnsavedLibraryItems: vi.fn(),
  unarchiveSavedLibraryItems: vi.fn(),
  deleteAllArchivedLibraryItems: vi.fn(),
  pruneArchivedLibraryItems: mockPruneArchivedLibraryItems,
  updateLibraryPreferences: vi.fn(),
  healUntitledLibraryFeedTitles: mockHealUntitledLibraryFeedTitles,
  toggleLibraryItemLiked: vi.fn(),
  confirmLibraryItemLikedSynced: vi.fn(),
  confirmLibraryItemSeenSynced: vi.fn(),
}));

vi.mock("./platform-actions", () => ({
  buildPlatformActionsRegistry: vi.fn(() => ({})),
}));

vi.mock("./outbox", () => ({
  startOutboxProcessor: mockStartOutboxProcessor,
}));

vi.mock("./memory-monitor", () => ({
  capturePreLibraryMemoryBaseline: mockCapturePreLibraryMemoryBaseline,
  recordLibraryRuntimeReady: mockRecordLibraryRuntimeReady,
  recordLibraryRuntimeLoadStarted: mockRecordLibraryRuntimeLoadStarted,
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

function createLibraryState() {
  return {
    searchCorpusVersion: 0,
    preferences: createDefaultPreferences(),
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    rssFeedCount: 0,
    enabledRssFeedCount: 0,
    archivedItemCount: 0,
    friendPersonCount: 0,
    socialAccountCount: 0,
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
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
    mockHealUntitledLibraryFeedTitles.mockReset();
    mockHealUntitledLibraryFeedTitles.mockResolvedValue(undefined);
    mockPruneArchivedLibraryItems.mockReset();
    mockPruneArchivedLibraryItems.mockResolvedValue(undefined);
    mockCapturePreLibraryMemoryBaseline.mockReset();
    mockCapturePreLibraryMemoryBaseline.mockResolvedValue(true);
    mockInitializeLibrary.mockReset();
    mockInitializeLibrary.mockResolvedValue(createLibraryState());
    mockStartOutboxProcessor.mockReset();
    mockStartOutboxProcessor.mockReturnValue(() => {});
    mockSubscribe.mockReset();
    mockSubscribe.mockReturnValue(mockUnsubscribe);
    mockUnsubscribe.mockReset();
    mockRecordLibraryRuntimeReady.mockReset();
    mockRecordLibraryRuntimeLoadStarted.mockReset();
    localStorage.clear();
    resetDeviceDisplayPreferencesForTests();
    resetFacebookGroupDiscoveryForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("primes the renderer baseline and closes its window before loading SQLite", async () => {
    const order: string[] = [];
    mockCapturePreLibraryMemoryBaseline.mockImplementation(async () => {
      order.push("baseline");
      return true;
    });
    mockRecordLibraryRuntimeLoadStarted.mockImplementation(() => {
      order.push("library-load-started");
    });
    mockInitializeLibrary.mockImplementation(async () => {
      order.push("sqlite-library");
      return createLibraryState();
    });
    mockRecordLibraryRuntimeReady.mockImplementation(() => {
      order.push("library-ready");
    });
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();

    expect(order.slice(0, 4)).toEqual([
      "baseline",
      "library-load-started",
      "sqlite-library",
      "library-ready",
    ]);
  });

  it("does not await a stalled pre-Library measurement", async () => {
    mockCapturePreLibraryMemoryBaseline.mockReturnValue(new Promise(() => {}));
    const { useAppStore } = await import("./store");

    await expect(useAppStore.getState().initialize()).resolves.toBeUndefined();

    expect(mockInitializeLibrary).toHaveBeenCalledTimes(1);
    expect(mockRecordLibraryRuntimeLoadStarted.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitializeLibrary.mock.invocationCallOrder[0],
    );
    expect(mockRecordLibraryRuntimeReady.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockInitializeLibrary.mock.invocationCallOrder[0],
    );
  });

  it("defers startup maintenance instead of running it during launch", async () => {
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockHealUntitledLibraryFeedTitles).not.toHaveBeenCalled();
    expect(mockPruneArchivedLibraryItems).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    expect(mockHealUntitledLibraryFeedTitles).not.toHaveBeenCalled();
    expect(mockPruneArchivedLibraryItems).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(mockHealUntitledLibraryFeedTitles).toHaveBeenCalledTimes(1);
    expect(mockPruneArchivedLibraryItems).toHaveBeenCalledTimes(1);
  });

  it("does not run cleanup migrations before cloud sync catches up", async () => {
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "token",
      expiresAt: Date.now() + 120_000,
    }));
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockHealUntitledLibraryFeedTitles).not.toHaveBeenCalled();
    expect(mockPruneArchivedLibraryItems).not.toHaveBeenCalled();
  });

  it("imports the legacy sidebar mode before initialization completes", async () => {
    const state = createLibraryState();
    state.preferences.display.sidebarMode = "closed";
    mockInitializeLibrary.mockResolvedValue(state);
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().isInitialized).toBe(true);
    expect(getDeviceDisplayPreferences().sidebarMode).toBe("closed");
  });

  it("imports legacy Facebook group discovery before initialization completes", async () => {
    const state = createLibraryState();
    state.preferences.fbCapture.knownGroups = {
      "group-one": {
        id: "group-one",
        name: "Local group",
        url: "https://www.facebook.com/groups/group-one",
      },
    };
    mockInitializeLibrary.mockResolvedValue(state);
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().isInitialized).toBe(true);
    expect(getFacebookGroupDiscovery()).toEqual(state.preferences.fbCapture.knownGroups);
  });

  it("coalesces concurrent initialization into one worker subscription", async () => {
    let resolveInit!: (state: ReturnType<typeof createLibraryState>) => void;
    mockInitializeLibrary.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveInit = resolve;
      }),
    );
    const { useAppStore } = await import("./store");

    const initialize = useAppStore.getState().initialize;
    const first = initialize();
    const second = initialize();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(mockInitializeLibrary).toHaveBeenCalledTimes(1));
    resolveInit(createLibraryState());
    await Promise.all([first, second]);

    expect(mockInitializeLibrary).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockStartOutboxProcessor).toHaveBeenCalledTimes(1);
  });

  it("increments Library and Saved sources only for their relevant SQLite changes", async () => {
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    const subscriber = mockSubscribe.mock.calls.at(-1)?.[0] as
      | ((
        state: ReturnType<typeof createLibraryState>,
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

    subscriber?.(createLibraryState(), {
      mutation: "TOGGLE_SAVED",
      source: "item_patch",
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(1);
    expect(useAppStore.getState().savedFeedVersion).toBe(1);

    subscriber?.(createLibraryState(), {
      mutation: "MARK_AS_READ",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    subscriber?.(createLibraryState(), {
      mutation: "TOGGLE_LIKED",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    subscriber?.(createLibraryState(), {
      mutation: "CONFIRM_LIKED_SYNCED",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    subscriber?.(createLibraryState(), {
      mutation: "CONFIRM_SEEN_SYNCED",
      source: "item_patch",
      changedItemIds: [],
      changedItems: [],
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(5);
    expect(useAppStore.getState().savedFeedVersion).toBe(1);

    const irrelevantPreferenceState = createLibraryState();
    irrelevantPreferenceState.preferences = {
      ...irrelevantPreferenceState.preferences,
      weights: useAppStore.getState().preferences.weights,
    };
    subscriber?.(irrelevantPreferenceState, {
      mutation: "UPDATE_PREFERENCES",
      source: "preferences_patch",
    });
    subscriber?.(createLibraryState(), {
      mutation: "UPDATE_RSS_FEED",
      source: "feeds_patch",
    });
    expect(useAppStore.getState().libraryItemVersion).toBe(5);
    expect(useAppStore.getState().savedFeedVersion).toBe(1);

    const rankingPreferenceState = createLibraryState();
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

    subscriber?.(createLibraryState(), {
      mutation: "UPDATE_PREFERENCES",
      source: "state_update",
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(3);

    subscriber?.(createLibraryState(), {
      mutation: "ADD_FEED_ITEMS",
      source: "item_patch",
    });
    subscriber?.(createLibraryState(), {
      mutation: "FUTURE_ITEM_PATCH",
      source: "item_patch",
    });
    subscriber?.(createLibraryState(), {
      mutation: "TOGGLE_ARCHIVED",
      source: "item_patch",
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(6);

    subscriber?.(createLibraryState(), {
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
          state: ReturnType<typeof createLibraryState>,
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
    subscriber?.(createLibraryState(), {
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
    subscriber?.(createLibraryState(), {
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
    subscriber?.(createLibraryState(), {
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
    subscriber?.(createLibraryState(), {
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
    subscriber?.(createLibraryState(), {
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
    subscriber?.(createLibraryState(), {
      mutation: "CONFIRM_LIKED_SYNCED",
      source: "item_patch",
      changedItemIds: [overflowUserState.globalId],
      changedItems: [overflowUserState],
    });
    expect(useAppStore.getState().savedFeedVersion).toBe(2);
    expect(useAppStore.getState().savedFeedPresentationPatch).toBeNull();
  });

  it("replaces the Library subscription when initialization runs again", async () => {
    const { useAppStore } = await import("./store");

    await useAppStore.getState().initialize();
    useAppStore.setState({ isInitialized: false });
    await useAppStore.getState().initialize();

    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

});
