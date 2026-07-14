import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type Account, type FeedItem, type Person, type RssFeed } from "@freed/shared";
import {
  DEVICE_GRAPH_LAYOUT_STORAGE_KEY,
  getDeviceAccountGraphLayout,
  getDevicePersonGraphLayout,
  resetDeviceGraphLayoutForTests,
  setDeviceAccountGraphPosition,
  setDevicePersonGraphPosition,
} from "@freed/ui/lib/device-graph-layout";

const {
  mockDocArchiveItems,
  mockDocMarkItemsAsRead,
  mockDocRemoveFeedItem,
  mockDocRemovePerson,
  mockDocToggleArchived,
  mockDocToggleLiked,
  mockDocToggleSaved,
  mockDocUpdateAccount,
  mockDocUpdateFeedItem,
  mockDocUpdatePerson,
  mockDocUpdatePreferences,
  mockDocUpdateRssFeed,
} = vi.hoisted(() => ({
  mockDocArchiveItems: vi.fn(),
  mockDocMarkItemsAsRead: vi.fn(),
  mockDocRemoveFeedItem: vi.fn(),
  mockDocRemovePerson: vi.fn(),
  mockDocToggleArchived: vi.fn(),
  mockDocToggleLiked: vi.fn(),
  mockDocToggleSaved: vi.fn(),
  mockDocUpdateAccount: vi.fn(),
  mockDocUpdateFeedItem: vi.fn(),
  mockDocUpdatePerson: vi.fn(),
  mockDocUpdatePreferences: vi.fn(),
  mockDocUpdateRssFeed: vi.fn(),
}));

vi.mock("./automerge", () => ({
  initDoc: vi.fn(),
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
  docAddFriend: vi.fn(),
  docAddFriends: vi.fn(),
  docUpdatePerson: mockDocUpdatePerson,
  docUpdateFriend: vi.fn(),
  docRemoveFriend: vi.fn(),
  docRemovePerson: mockDocRemovePerson,
  docUpsertConnectionPersons: vi.fn(),
  docLogReachOut: vi.fn(),
  docUpdateAccount: mockDocUpdateAccount,
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

function makePerson(id: string): Person {
  return {
    id,
    name: "Original",
    relationshipStatus: "friend",
    careLevel: 3,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeAccount(id: string): Account {
  return {
    id,
    kind: "social",
    provider: "x",
    externalId: id,
    handle: "original",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
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
    resetDeviceGraphLayoutForTests();
    mockDocArchiveItems.mockResolvedValue(undefined);
    mockDocMarkItemsAsRead.mockResolvedValue(undefined);
    mockDocRemoveFeedItem.mockResolvedValue(undefined);
    mockDocRemovePerson.mockResolvedValue(undefined);
    mockDocToggleArchived.mockResolvedValue(undefined);
    mockDocToggleLiked.mockResolvedValue(undefined);
    mockDocToggleSaved.mockResolvedValue(undefined);
    mockDocUpdateAccount.mockResolvedValue(undefined);
    mockDocUpdateFeedItem.mockResolvedValue(undefined);
    mockDocUpdatePerson.mockResolvedValue(undefined);
    mockDocUpdatePreferences.mockResolvedValue(undefined);
    mockDocUpdateRssFeed.mockResolvedValue(undefined);
    resetStore();
  });

  it("routes graph placement locally without sending it to Automerge", async () => {
    useAppStore.setState({
      persons: { person: makePerson("person") },
      accounts: { account: makeAccount("account") },
    });

    await useAppStore.getState().updatePerson("person", {
      graphX: 12,
      graphY: 24,
      graphPinned: true,
      graphUpdatedAt: 100,
    });
    await useAppStore.getState().updateAccount("account", {
      graphX: 36,
      graphY: 48,
      graphPinned: true,
      graphUpdatedAt: 200,
    });

    expect(getDevicePersonGraphLayout("person")).toMatchObject({ graphX: 12, graphY: 24 });
    expect(getDeviceAccountGraphLayout("account")).toMatchObject({ graphX: 36, graphY: 48 });
    expect(useAppStore.getState().persons.person).not.toHaveProperty("graphX");
    expect(useAppStore.getState().accounts.account).not.toHaveProperty("graphX");
    expect(mockDocUpdatePerson).not.toHaveBeenCalled();
    expect(mockDocUpdateAccount).not.toHaveBeenCalled();

    await useAppStore.getState().updatePerson("person", {
      name: "Renamed",
      graphX: 60,
      graphY: 72,
    });
    expect(mockDocUpdatePerson).toHaveBeenCalledWith("person", { name: "Renamed" });
    expect(getDevicePersonGraphLayout("person")).toMatchObject({ graphX: 60, graphY: 72 });
  });

  it("rejects graph updates when a newer device layout record cannot be replaced", async () => {
    const futureLayout = JSON.stringify({
      version: 2,
      legacyMigrationCompleted: true,
      persons: {},
      accounts: {},
    });
    localStorage.setItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY, futureLayout);
    resetDeviceGraphLayoutForTests();

    await expect(useAppStore.getState().updatePerson("person", {
      graphX: 12,
      graphY: 24,
      graphPinned: true,
    })).rejects.toThrow("could not save this graph position");

    expect(mockDocUpdatePerson).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEVICE_GRAPH_LAYOUT_STORAGE_KEY)).toBe(futureLayout);
  });

  it("keeps person and linked account pins when document removal fails", async () => {
    const person = makePerson("person");
    const account = { ...makeAccount("account"), personId: person.id };
    useAppStore.setState({
      persons: { [person.id]: person },
      accounts: { [account.id]: account },
    });
    setDevicePersonGraphPosition(person.id, 12, 24, 100);
    setDeviceAccountGraphPosition(account.id, 36, 48, 200);
    mockDocRemovePerson.mockRejectedValueOnce(new Error("persistence failed"));

    await expect(useAppStore.getState().removePerson(person.id)).rejects.toThrow(
      "persistence failed",
    );

    expect(getDevicePersonGraphLayout(person.id)).toMatchObject({ graphX: 12, graphY: 24 });
    expect(getDeviceAccountGraphLayout(account.id)).toMatchObject({ graphX: 36, graphY: 48 });
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

  it("projects feed, person, account, and preference edits before persistence resolves", async () => {
    const feedUpdate = deferred();
    const personUpdate = deferred();
    const accountUpdate = deferred();
    const preferenceUpdate = deferred();
    mockDocUpdateRssFeed.mockReturnValueOnce(feedUpdate.promise);
    mockDocUpdatePerson.mockReturnValueOnce(personUpdate.promise);
    mockDocUpdateAccount.mockReturnValueOnce(accountUpdate.promise);
    mockDocUpdatePreferences.mockReturnValueOnce(preferenceUpdate.promise);
    const feed: RssFeed = {
      url: "https://example.com/feed.xml",
      title: "Old",
      enabled: true,
      trackUnread: true,
    };
    useAppStore.setState({
      feeds: { [feed.url]: feed },
      persons: { person: makePerson("person") },
      accounts: { account: makeAccount("account") },
    });

    const feedPromise = useAppStore.getState().renameFeed(feed.url, "New");
    expect(useAppStore.getState().feeds[feed.url]?.title).toBe("New");
    feedUpdate.resolve();
    await feedPromise;

    const personPromise = useAppStore.getState().updatePerson("person", { name: "New Person" });
    expect(useAppStore.getState().persons.person?.name).toBe("New Person");
    personUpdate.resolve();
    await personPromise;

    const accountPromise = useAppStore.getState().updateAccount("account", { handle: "new-account" });
    expect(useAppStore.getState().accounts.account?.handle).toBe("new-account");
    accountUpdate.resolve();
    await accountPromise;

    const preferencesPromise = useAppStore.getState().updatePreferences({
      display: { showEngagementCounts: true },
    } as never);
    expect(useAppStore.getState().preferences.display.showEngagementCounts).toBe(true);
    preferenceUpdate.resolve();
    await preferencesPromise;
  });

  it("waits for account relink persistence before exposing the new person", async () => {
    const accountUpdate = deferred();
    mockDocUpdateAccount.mockReturnValueOnce(accountUpdate.promise);
    useAppStore.setState({
      accounts: { account: makeAccount("account") },
    });

    const relinkPromise = useAppStore.getState().linkAccountToPerson("account", "person");

    expect(useAppStore.getState().accounts.account?.personId).toBeUndefined();
    expect(mockDocUpdateAccount).toHaveBeenCalledWith(
      "account",
      expect.objectContaining({ personId: "person" }),
    );

    accountUpdate.resolve();
    await relinkPromise;
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
