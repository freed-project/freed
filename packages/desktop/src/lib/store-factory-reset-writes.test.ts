import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

const automerge = vi.hoisted(() => {
  const resolved = () => vi.fn(() => Promise.resolve());
  return {
    initDoc: vi.fn(),
    quiesceDesktopLibraryForFactoryReset: resolved(),
    subscribe: vi.fn(() => () => {}),
    getDocState: vi.fn(() => null),
    docAddFeedItems: resolved(),
    docAddSampleLibraryData: resolved(),
    docAddRssFeed: resolved(),
    docRemoveRssFeed: resolved(),
    docRemoveAllFeeds: resolved(),
    docUpdateRssFeed: resolved(),
    docUpdateFeedItem: resolved(),
    docMarkItemsAsRead: resolved(),
    docMarkAllAsRead: resolved(),
    docToggleSaved: resolved(),
    docRemoveFeedItem: resolved(),
    docClearSampleData: vi.fn(() => Promise.resolve({
      feeds: 0,
      items: 0,
      persons: 0,
      accounts: 0,
      total: 0,
    })),
    docToggleArchived: resolved(),
    docArchiveItems: resolved(),
    docArchiveAllReadUnsaved: resolved(),
    docUnarchiveSavedItems: resolved(),
    docDeleteAllArchived: resolved(),
    docPruneArchivedItems: resolved(),
    docUpdatePreferences: resolved(),
    docBackfillContentSignals: vi.fn(() => Promise.resolve({ updated: 0, remaining: 0 })),
    docDeduplicateFeedItems: resolved(),
    docHealUntitledFeedTitles: resolved(),
    docToggleLiked: resolved(),
    docConfirmLikedSynced: resolved(),
    docConfirmSeenSynced: resolved(),
  };
});

vi.mock("./library-client", () => automerge);

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

function makeDocState() {
  const preferences = createDefaultPreferences();
  preferences.display.sidebarMode = "closed";
  preferences.ai.provider = "ollama";
  return {
    items: [],
    searchCorpusVersion: 0,
    feeds: {},
    persons: {
      legacy: {
        id: "legacy",
        name: "Legacy",
        relationshipStatus: "friend" as const,
        careLevel: 3,
        graphX: 10,
        graphY: 20,
        graphPinned: true,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    accounts: {},
    friends: {},
    preferences,
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

describe("Desktop store factory reset write boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    for (const mock of Object.values(automerge)) {
      if ("mockResolvedValue" in mock && typeof mock.mockResolvedValue === "function") {
        mock.mockResolvedValue(undefined);
      }
    }
    automerge.docBackfillContentSignals.mockResolvedValue({ updated: 0, remaining: 0 });
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
    expect(automerge.docUpdatePreferences).not.toHaveBeenCalled();
  });

  it("does not project optimistic state after local writers quiesce", async () => {
    const { quiesceDesktopStoreForFactoryReset, useAppStore } = await import("./store");
    const feed = {
      url: "https://example.com/reset-feed.xml",
      title: "Before reset",
      enabled: true,
      trackUnread: true,
    };
    useAppStore.setState({ feeds: { [feed.url]: feed } });
    await quiesceDesktopStoreForFactoryReset();

    await expect(
      useAppStore.getState().renameFeed(feed.url, "After reset"),
    ).rejects.toThrow("Desktop store is quiesced for factory reset");

    expect(useAppStore.getState().feeds[feed.url]?.title).toBe("Before reset");
    expect(automerge.docUpdateRssFeed).not.toHaveBeenCalled();
  });

  it("does not migrate device state when startup finishes during quiescence", async () => {
    let finishInitialization!: (state: ReturnType<typeof makeDocState>) => void;
    automerge.initDoc.mockImplementationOnce(
      () => new Promise((resolve) => {
        finishInitialization = resolve;
      }),
    );
    const { quiesceDesktopStoreForFactoryReset, useAppStore } = await import("./store");

    const initializing = useAppStore.getState().initialize();
    await vi.waitFor(() => expect(automerge.initDoc).toHaveBeenCalledOnce());
    const quiescing = quiesceDesktopStoreForFactoryReset();
    const quiesced = vi.fn();
    void quiescing.then(quiesced);
    await Promise.resolve();
    expect(quiesced).not.toHaveBeenCalled();
    localStorage.clear();
    finishInitialization(makeDocState());

    await Promise.all([initializing, quiescing]);
    expect(localStorage.getItem("freed-device-graph-layout-v1")).toBeNull();
    expect(localStorage.getItem("freed-device-display-preferences-v1")).toBeNull();
    expect(localStorage.getItem("freed-device-ai-preferences-v1")).toBeNull();
    expect(automerge.subscribe).not.toHaveBeenCalled();
  });
});
