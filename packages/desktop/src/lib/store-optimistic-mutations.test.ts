import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type FeedItem, type RssFeed } from "@freed/shared";

const {
  mockDocArchiveItems,
  mockDocMarkItemsAsRead,
  mockDocRemoveFeedItem,
  mockDocToggleArchived,
  mockDocToggleLiked,
  mockDocToggleSaved,
  mockDocUpdateFeedItem,
  mockDocUpdatePreferences,
  mockDocUpdateRssFeed,
} = vi.hoisted(() => ({
  mockDocArchiveItems: vi.fn(),
  mockDocMarkItemsAsRead: vi.fn(),
  mockDocRemoveFeedItem: vi.fn(),
  mockDocToggleArchived: vi.fn(),
  mockDocToggleLiked: vi.fn(),
  mockDocToggleSaved: vi.fn(),
  mockDocUpdateFeedItem: vi.fn(),
  mockDocUpdatePreferences: vi.fn(),
  mockDocUpdateRssFeed: vi.fn(),
}));

vi.mock("./library-client", () => ({
  initDoc: vi.fn(),
  quiesceDesktopLibraryForFactoryReset: vi.fn(() => Promise.resolve()),
  subscribe: vi.fn(() => () => {}),
  getDocState: vi.fn(() => null),
  docAddFeedItems: vi.fn(),
  docAddSampleLibraryData: vi.fn(),
  docAddRssFeed: vi.fn(),
  docRemoveRssFeed: vi.fn(),
  docRemoveAllFeeds: vi.fn(),
  docUpdateRssFeed: mockDocUpdateRssFeed,
  docUpdateFeedItem: mockDocUpdateFeedItem,
  docMarkAsRead: vi.fn(),
  docMarkItemsAsRead: mockDocMarkItemsAsRead,
  docMarkAllAsRead: vi.fn(),
  docToggleSaved: mockDocToggleSaved,
  docRemoveFeedItem: mockDocRemoveFeedItem,
  docClearSampleData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
  docToggleArchived: mockDocToggleArchived,
  docArchiveItems: mockDocArchiveItems,
  docArchiveAllReadUnsaved: vi.fn(),
  docUnarchiveSavedItems: vi.fn(),
  docDeleteAllArchived: vi.fn(),
  docPruneArchivedItems: vi.fn(),
  docUpdatePreferences: mockDocUpdatePreferences,
  docBackfillContentSignals: vi.fn(() => Promise.resolve({ updated: 0, remaining: 0 })),
  docDeduplicateFeedItems: vi.fn(),
  docHealUntitledFeedTitles: vi.fn(),
  docToggleLiked: mockDocToggleLiked,
  docConfirmLikedSynced: vi.fn(),
  docConfirmSeenSynced: vi.fn(),
}));

vi.mock("@freed/ui/lib/bug-report", async () => {
  const actual = await vi.importActual<typeof import("@freed/ui/lib/bug-report")>(
    "@freed/ui/lib/bug-report",
  );
  return {
    ...actual,
    recordRuntimeError: vi.fn(),
    recordBugReportEvent: vi.fn(),
  };
});

import { useAppStore } from "./store";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeItem(id: string, state: Partial<FeedItem["userState"]> = {}): FeedItem {
  return {
    globalId: id,
    platform: "x",
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "author",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text: id,
      mediaUrls: [],
      mediaTypes: [],
    },
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      ...state,
    },
  };
}

function resetStore(): void {
  useAppStore.setState({
    items: [],
    feeds: {},
    persons: {},
    friends: {},
    accounts: {},
    preferences: createDefaultPreferences(),
    totalUnreadCount: 0,
  });
}

describe("store optimistic mutations", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    mockDocArchiveItems.mockResolvedValue(undefined);
    mockDocMarkItemsAsRead.mockResolvedValue(undefined);
    mockDocRemoveFeedItem.mockResolvedValue(undefined);
    mockDocToggleArchived.mockResolvedValue(undefined);
    mockDocToggleLiked.mockResolvedValue(undefined);
    mockDocToggleSaved.mockResolvedValue(undefined);
    mockDocUpdateFeedItem.mockResolvedValue(undefined);
    mockDocUpdatePreferences.mockResolvedValue(undefined);
    mockDocUpdateRssFeed.mockResolvedValue(undefined);
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects save, archive, like, update, and remove item actions before persistence resolves", async () => {
    const save = deferred();
    const update = deferred();
    const remove = deferred();
    mockDocToggleSaved.mockReturnValueOnce(save.promise);
    mockDocUpdateFeedItem.mockReturnValueOnce(update.promise);
    mockDocRemoveFeedItem.mockReturnValueOnce(remove.promise);
    useAppStore.setState({
      items: [
        makeItem("save"),
        makeItem("archive"),
        makeItem("like"),
        makeItem("update"),
        makeItem("remove"),
      ],
    });

    const savePromise = useAppStore.getState().toggleSaved("save");
    expect(useAppStore.getState().items.find((item) => item.globalId === "save")?.userState.saved).toBe(true);
    save.resolve();
    await savePromise;

    await useAppStore.getState().toggleArchived("archive");
    expect(useAppStore.getState().items.find((item) => item.globalId === "archive")?.userState.archived).toBe(true);

    await useAppStore.getState().toggleLiked("like");
    expect(useAppStore.getState().items.find((item) => item.globalId === "like")?.userState.liked).toBe(true);

    const updatePromise = useAppStore.getState().updateItem("update", {
      content: { text: "Updated", mediaUrls: [], mediaTypes: [] },
    });
    expect(useAppStore.getState().items.find((item) => item.globalId === "update")?.content.text).toBe("Updated");
    update.resolve();
    await updatePromise;

    const removePromise = useAppStore.getState().removeItem("remove");
    expect(useAppStore.getState().items.some((item) => item.globalId === "remove")).toBe(false);
    remove.resolve();
    await removePromise;
  });

  it("projects feed and preference edits before persistence resolves", async () => {
    const feedUpdate = deferred();
    const preferenceUpdate = deferred();
    mockDocUpdateRssFeed.mockReturnValueOnce(feedUpdate.promise);
    mockDocUpdatePreferences.mockReturnValueOnce(preferenceUpdate.promise);
    const feed: RssFeed = {
      url: "https://example.com/feed.xml",
      title: "Old",
      enabled: true,
      trackUnread: true,
    };
    useAppStore.setState({ feeds: { [feed.url]: feed } });

    const feedPromise = useAppStore.getState().renameFeed(feed.url, "New");
    expect(useAppStore.getState().feeds[feed.url]?.title).toBe("New");
    feedUpdate.resolve();
    await feedPromise;

    const preferencesPromise = useAppStore.getState().updatePreferences({
      display: { showEngagementCounts: true },
    } as never);
    expect(useAppStore.getState().preferences.display.showEngagementCounts).toBe(true);
    preferenceUpdate.resolve();
    await preferencesPromise;
  });

  it("projects batched read marks after the batch timer flushes", async () => {
    vi.useFakeTimers();
    const readUpdate = deferred();
    mockDocMarkItemsAsRead.mockReturnValueOnce(readUpdate.promise);
    useAppStore.setState({
      items: [makeItem("read")],
      totalUnreadCount: 1,
    });

    const readPromise = useAppStore.getState().markItemsAsRead(["read"]);
    expect(useAppStore.getState().items[0]?.userState.readAt).toEqual(expect.any(Number));
    expect(useAppStore.getState().totalUnreadCount).toBe(1);

    await vi.advanceTimersByTimeAsync(50);
    readUpdate.resolve();
    await readPromise;
  });

  it("projects bulk archive without recomputing counts until worker state reconciles", async () => {
    const archiveUpdate = deferred();
    mockDocArchiveItems.mockReturnValueOnce(archiveUpdate.promise);
    useAppStore.setState({
      items: [makeItem("first", { readAt: 1 }), makeItem("second", { readAt: 1 })],
      totalUnreadCount: 2,
    });

    const archivePromise = useAppStore.getState().archiveItems(["first", "second"]);

    expect(useAppStore.getState().items.every((item) => item.userState.archived)).toBe(true);
    expect(useAppStore.getState().totalUnreadCount).toBe(2);

    archiveUpdate.resolve();
    await archivePromise;
    useAppStore.setState({ totalUnreadCount: 0 });

    expect(useAppStore.getState().totalUnreadCount).toBe(0);
  });
});
