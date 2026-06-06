import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "@freed/shared";

const {
  mockDocBackfillContentSignals,
  mockDocDeduplicateFeedItems,
  mockDocHealUntitledFeedTitles,
  mockDocPruneArchivedItems,
  mockInitDoc,
  mockRunBackgroundJob,
  mockStartOutboxProcessor,
  mockSubscribe,
} = vi.hoisted(() => ({
  mockDocBackfillContentSignals: vi.fn(),
  mockDocDeduplicateFeedItems: vi.fn(),
  mockDocHealUntitledFeedTitles: vi.fn(),
  mockDocPruneArchivedItems: vi.fn(),
  mockInitDoc: vi.fn(),
  mockRunBackgroundJob: vi.fn(),
  mockStartOutboxProcessor: vi.fn(),
  mockSubscribe: vi.fn(() => () => {}),
}));

vi.mock("./automerge", () => ({
  initDoc: mockInitDoc,
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
    mockInitDoc.mockReset();
    mockInitDoc.mockResolvedValue(createDocState());
    mockRunBackgroundJob.mockReset();
    mockRunBackgroundJob.mockImplementation(async (task) => task.run());
    mockStartOutboxProcessor.mockReset();
    mockStartOutboxProcessor.mockReturnValue(() => {});
    mockSubscribe.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
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
});
