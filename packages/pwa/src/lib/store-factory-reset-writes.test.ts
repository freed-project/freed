import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultPreferences,
  type Account,
  type Friend,
  type RssFeed,
} from "@freed/shared";

const automerge = vi.hoisted(() => {
  const resolved = () => vi.fn(() => Promise.resolve());
  return {
    initDoc: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    docAddFeedItems: resolved(),
    docAddSampleLibraryData: resolved(),
    docAddRssFeed: resolved(),
    docRemoveRssFeed: resolved(),
    docRemoveAllFeeds: resolved(),
    docUpdateRssFeed: resolved(),
    docUpdateFeedItem: resolved(),
    docBackfillContentSignals: vi.fn(() =>
      Promise.resolve({ updated: 0, remaining: 0 }),
    ),
    docMarkItemsAsRead: resolved(),
    docMarkAllAsRead: resolved(),
    docToggleSaved: resolved(),
    docRemoveFeedItem: resolved(),
    docClearSampleData: vi.fn(() =>
      Promise.resolve({
        feeds: 0,
        items: 0,
        persons: 0,
        accounts: 0,
        total: 0,
      }),
    ),
    docToggleArchived: resolved(),
    docToggleLiked: resolved(),
    docArchiveAllReadUnsaved: resolved(),
    docUnarchiveSavedItems: resolved(),
    docDeleteAllArchived: resolved(),
    docPruneArchivedItems: resolved(),
    docUpdatePreferences: resolved(),
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
  };
});

vi.mock("./automerge", () => automerge);

vi.mock("./reader-cache", () => ({
  pinReaderItemInPwa: vi.fn(),
}));

vi.mock("./factory-reset-coordinator", () => ({
  assertPwaRuntimeCurrent: vi.fn(),
  capturePwaRuntimeLifecycle: vi.fn(() => ({
    assertCurrent: vi.fn(),
    isCurrent: vi.fn(() => true),
  })),
  registerPwaFactoryResetQuiesceHandler: vi.fn(() => () => {}),
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
    sources: [
      {
        platform: "x",
        authorId: "reset-friend",
        handle: "reset-friend",
      },
    ],
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

describe("PWA store factory reset write boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("rejects graph and preference writes after local writers quiesce", async () => {
    const { quiescePwaStartupMigrations, useAppStore } =
      await import("./store");
    const preferences = createDefaultPreferences();
    await quiescePwaStartupMigrations();

    await expect(
      useAppStore.getState().updatePerson("person", {
        graphX: 10,
        graphY: 20,
      }),
    ).rejects.toThrow("PWA store is quiesced for factory reset");
    await expect(
      useAppStore.getState().updateAccount("account", {
        graphX: 30,
        graphY: 40,
      }),
    ).rejects.toThrow("PWA store is quiesced for factory reset");
    await expect(
      useAppStore.getState().updatePreferences({
        display: {
          ...preferences.display,
          sidebarMode: "closed",
        },
        ai: {
          ...preferences.ai,
          provider: "integrated",
        },
      }),
    ).rejects.toThrow("PWA store is quiesced for factory reset");

    expect(localStorage.getItem("freed-device-graph-layout-v1")).toBeNull();
    expect(
      localStorage.getItem("freed-device-display-preferences-v1"),
    ).toBeNull();
    expect(localStorage.getItem("freed-device-ai-preferences-v1")).toBeNull();
    expect(automerge.docUpdatePerson).not.toHaveBeenCalled();
    expect(automerge.docUpdateAccount).not.toHaveBeenCalled();
    expect(automerge.docUpdatePreferences).not.toHaveBeenCalled();
  });

  it("rejects optimistic projections before stale Zustand state can change", async () => {
    const { quiescePwaStartupMigrations, useAppStore } =
      await import("./store");
    const feed: RssFeed = {
      url: "https://example.com/feed.xml",
      title: "Original title",
      enabled: true,
      trackUnread: true,
    };
    useAppStore.setState({ feeds: { [feed.url]: feed } });
    await quiescePwaStartupMigrations();

    await expect(
      useAppStore.getState().renameFeed(feed.url, "Stale title"),
    ).rejects.toThrow("PWA store is quiesced for factory reset");

    expect(useAppStore.getState().feeds).toEqual({ [feed.url]: feed });
    expect(automerge.docUpdateRssFeed).not.toHaveBeenCalled();
  });

  it("cannot restore replaced account graph state after reset clears it", async () => {
    let finishAccountRemoval!: () => void;
    automerge.docRemoveAccount.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishAccountRemoval = resolve;
        }),
    );
    const { quiescePwaStartupMigrations, useAppStore } =
      await import("./store");
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

    const replacing = useAppStore
      .getState()
      .updateFriend(friend.id, { name: "Updated" });
    await vi.waitFor(() =>
      expect(automerge.docRemoveAccount).toHaveBeenCalledWith(account.id),
    );

    await quiescePwaStartupMigrations();
    expect(clearDeviceGraphLayout()).toBe(true);
    finishAccountRemoval();

    await expect(replacing).rejects.toThrow(
      "PWA store is quiesced for factory reset",
    );
    expect(automerge.docAddAccounts).toHaveBeenCalledOnce();
    expect(getDeviceAccountGraphLayout(account.id)).toBeNull();
  });
});
