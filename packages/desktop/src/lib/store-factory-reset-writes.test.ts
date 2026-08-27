import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

const libraryRuntime = vi.hoisted(() => {
  const resolved = () => vi.fn(() => Promise.resolve());
  return {
    initializeDesktopLibraryRuntime: vi.fn(),
    quiesceDesktopLibraryForFactoryReset: resolved(),
    subscribeDesktopLibraryRuntime: vi.fn(() => () => {}),
    getDesktopLibraryRuntimeState: vi.fn(() => null),
    addLibraryFeedItems: resolved(),
    addSampleLibraryData: resolved(),
    addLibraryRssFeed: resolved(),
    removeLibraryRssFeed: resolved(),
    removeAllLibraryFeeds: resolved(),
    updateLibraryRssFeed: resolved(),
    updateLibraryFeedItem: resolved(),
    markLibraryItemsAsRead: resolved(),
    markAllLibraryItemsAsRead: resolved(),
    toggleLibraryItemSaved: resolved(),
    removeLibraryFeedItem: resolved(),
    clearSampleLibraryData: vi.fn(() => Promise.resolve({
      feeds: 0,
      items: 0,
      persons: 0,
      accounts: 0,
      total: 0,
    })),
    toggleLibraryItemArchived: resolved(),
    archiveLibraryItems: resolved(),
    archiveAllReadUnsavedLibraryItems: resolved(),
    unarchiveSavedLibraryItems: resolved(),
    deleteAllArchivedLibraryItems: resolved(),
    pruneArchivedLibraryItems: resolved(),
    updateLibraryPreferences: resolved(),
    backfillLibraryContentSignals: vi.fn(() => Promise.resolve({ updated: 0, remaining: 0 })),
    deduplicateLibraryFeedItems: resolved(),
    healUntitledLibraryFeedTitles: resolved(),
    toggleLibraryItemLiked: resolved(),
    confirmLibraryItemLikedSynced: resolved(),
    confirmLibraryItemSeenSynced: resolved(),
  };
});

vi.mock("./library-client", () => libraryRuntime);

vi.mock("./outbox", () => ({
  startOutboxProcessor: vi.fn(() => () => {}),
  stopAndDrainOutboxProcessor: vi.fn(() => Promise.resolve()),
}));

vi.mock("./desktop-client-registration", () => ({
  getOrCreateDesktopClientRegistration: vi.fn(() => Promise.resolve({
    id: "desktop-reset-test",
    registeredAt: 1,
  })),
}));

vi.mock("@freed/ui/lib/bug-report", () => ({
  recordBugReportEvent: vi.fn(),
  recordRuntimeError: vi.fn(),
}));

function makeLibraryState() {
  const preferences = createDefaultPreferences();
  preferences.display.sidebarMode = "closed";
  preferences.ai.provider = "ollama";
  return {
    searchCorpusVersion: 0,
    preferences,
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

describe("Desktop store factory reset write boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    for (const mock of Object.values(libraryRuntime)) {
      if ("mockResolvedValue" in mock && typeof mock.mockResolvedValue === "function") {
        mock.mockResolvedValue(undefined);
      }
    }
    libraryRuntime.backfillLibraryContentSignals.mockResolvedValue({
      updated: 0,
      remaining: 0,
    });
  });

  it("rejects preference writes after local writers quiesce", async () => {
    const { quiesceDesktopStoreForFactoryReset, useAppStore } = await import("./store");
    await quiesceDesktopStoreForFactoryReset();

    await expect(useAppStore.getState().updatePreferences({
      display: { sidebarMode: "closed" },
      ai: { provider: "integrated" },
    } as never)).rejects.toThrow("Desktop store is quiesced for factory reset");

    expect(localStorage.getItem("freed-device-display-preferences-v1")).toBeNull();
    expect(localStorage.getItem("freed-device-ai-preferences-v1")).toBeNull();
    expect(libraryRuntime.updateLibraryPreferences).not.toHaveBeenCalled();
  });

  it("does not submit SQLite mutations after local writers quiesce", async () => {
    const { quiesceDesktopStoreForFactoryReset, useAppStore } = await import("./store");
    const feedUrl = "https://example.com/reset-feed.xml";
    await quiesceDesktopStoreForFactoryReset();

    await expect(
      useAppStore.getState().renameFeed(feedUrl, "After reset"),
    ).rejects.toThrow("Desktop store is quiesced for factory reset");

    expect(libraryRuntime.updateLibraryRssFeed).not.toHaveBeenCalled();
  });

  it("does not migrate device state when startup finishes during quiescence", async () => {
    let finishInitialization!: (state: ReturnType<typeof makeLibraryState>) => void;
    libraryRuntime.initializeDesktopLibraryRuntime.mockImplementationOnce(
      () => new Promise((resolve) => {
        finishInitialization = resolve;
      }),
    );
    const { quiesceDesktopStoreForFactoryReset, useAppStore } = await import("./store");

    const initializing = useAppStore.getState().initialize();
    await vi.waitFor(() =>
      expect(
        libraryRuntime.initializeDesktopLibraryRuntime,
      ).toHaveBeenCalledOnce(),
    );
    const quiescing = quiesceDesktopStoreForFactoryReset();
    const quiesced = vi.fn();
    void quiescing.then(quiesced);
    await Promise.resolve();
    expect(quiesced).not.toHaveBeenCalled();
    localStorage.clear();
    finishInitialization(makeLibraryState());

    await Promise.all([initializing, quiescing]);
    expect(localStorage.getItem("freed-device-graph-layout-v1")).toBeNull();
    expect(localStorage.getItem("freed-device-display-preferences-v1")).toBeNull();
    expect(localStorage.getItem("freed-device-ai-preferences-v1")).toBeNull();
    expect(
      libraryRuntime.subscribeDesktopLibraryRuntime,
    ).not.toHaveBeenCalled();
  });
});
