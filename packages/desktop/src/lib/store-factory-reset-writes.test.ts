import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type Account, type Friend } from "@freed/shared";

const automerge = vi.hoisted(() => {
  const resolved = () => vi.fn(() => Promise.resolve());
  return {
    initDoc: vi.fn(),
    quiesceDesktopAutomergeForFactoryReset: resolved(),
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
    docAddAccount: resolved(),
    docAddAccounts: resolved(),
    docAddPerson: resolved(),
    docAddPersons: resolved(),
    docUpdateAccount: resolved(),
    docUpdatePerson: resolved(),
    docUpsertConnectionPersons: resolved(),
    docRemoveAccount: resolved(),
    docRemovePerson: resolved(),
    docLogReachOut: resolved(),
    docToggleLiked: resolved(),
    docConfirmLikedSynced: resolved(),
    docConfirmSeenSynced: resolved(),
  };
});

vi.mock("./automerge", () => automerge);

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

function makeFriend(id: string): Friend {
  return {
    id,
    name: "Reset Friend",
    relationshipStatus: "friend",
    careLevel: 3,
    sources: [{
      platform: "x",
      authorId: "reset-friend",
      handle: "reset-friend",
    }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeAccount(friendId: string): Account {
  return {
    id: "social:x:reset-friend",
    personId: friendId,
    kind: "social",
    provider: "x",
    externalId: "reset-friend",
    handle: "reset-friend",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
  };
}

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

  it("rejects graph and preference writes after local writers quiesce", async () => {
    const { quiesceDesktopStoreForFactoryReset, useAppStore } = await import("./store");
    await quiesceDesktopStoreForFactoryReset();

    await expect(useAppStore.getState().updatePerson("person", {
      graphX: 10,
      graphY: 20,
    })).rejects.toThrow("Desktop store is quiesced for factory reset");
    await expect(useAppStore.getState().updateAccount("account", {
      graphX: 30,
      graphY: 40,
    })).rejects.toThrow("Desktop store is quiesced for factory reset");
    await expect(useAppStore.getState().updatePreferences({
      display: { sidebarMode: "closed" },
      ai: { provider: "integrated" },
    } as never)).rejects.toThrow("Desktop store is quiesced for factory reset");

    expect(localStorage.getItem("freed-device-graph-layout-v1")).toBeNull();
    expect(localStorage.getItem("freed-device-display-preferences-v1")).toBeNull();
    expect(localStorage.getItem("freed-device-ai-preferences-v1")).toBeNull();
    expect(automerge.docUpdatePerson).not.toHaveBeenCalled();
    expect(automerge.docUpdateAccount).not.toHaveBeenCalled();
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

  it("cannot restore replaced account graph state after reset clears it", async () => {
    let finishAccountRemoval!: () => void;
    automerge.docRemoveAccount.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishAccountRemoval = resolve;
      }),
    );
    const { quiesceDesktopStoreForFactoryReset, useAppStore } = await import("./store");
    const {
      clearDeviceGraphLayout,
      getDeviceAccountGraphLayout,
      setDeviceAccountGraphPosition,
    } = await import("@freed/ui/lib/device-graph-layout");
    const friend = makeFriend("friend-reset");
    const account = makeAccount(friend.id);
    useAppStore.setState({
      friends: { [friend.id]: friend },
      persons: { [friend.id]: friend },
      accounts: { [account.id]: account },
    });
    setDeviceAccountGraphPosition(account.id, 50, 60, 100);

    const replacing = useAppStore.getState().updateFriend(friend.id, { name: "Updated" });
    await vi.waitFor(() => expect(automerge.docRemoveAccount).toHaveBeenCalledWith(account.id));

    await quiesceDesktopStoreForFactoryReset();
    expect(clearDeviceGraphLayout()).toBe(true);
    finishAccountRemoval();

    await expect(replacing).rejects.toThrow("Desktop store is quiesced for factory reset");
    expect(automerge.docAddAccounts).not.toHaveBeenCalled();
    expect(getDeviceAccountGraphLayout(account.id)).toBeNull();
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
