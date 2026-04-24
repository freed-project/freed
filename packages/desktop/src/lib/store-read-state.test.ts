import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDocMarkItemsAsRead,
  mockRecordRuntimeError,
  mockRecordBugReportEvent,
} = vi.hoisted(() => ({
  mockDocMarkItemsAsRead: vi.fn(),
  mockRecordRuntimeError: vi.fn(),
  mockRecordBugReportEvent: vi.fn(),
}));

vi.mock("./automerge", () => ({
  initDoc: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getDocState: vi.fn(() => null),
  docAddFeedItems: vi.fn(),
  docAddRssFeed: vi.fn(),
  docRemoveRssFeed: vi.fn(),
  docRemoveAllFeeds: vi.fn(),
  docUpdateRssFeed: vi.fn(),
  docUpdateFeedItem: vi.fn(),
  docMarkAsRead: vi.fn(),
  docMarkItemsAsRead: mockDocMarkItemsAsRead,
  docMarkAllAsRead: vi.fn(),
  docToggleSaved: vi.fn(),
  docRemoveFeedItem: vi.fn(),
  docToggleArchived: vi.fn(),
  docArchiveAllReadUnsaved: vi.fn(),
  docDeleteAllArchived: vi.fn(),
  docPruneArchivedItems: vi.fn(),
  docUpdatePreferences: vi.fn(),
  docDeduplicateFeedItems: vi.fn(),
  docHealUntitledFeedTitles: vi.fn(),
  docAddFriend: vi.fn(),
  docAddFriends: vi.fn(),
  docUpdateFriend: vi.fn(),
  docRemoveFriend: vi.fn(),
  docUpsertConnectionPersons: vi.fn(),
  docLogReachOut: vi.fn(),
  docToggleLiked: vi.fn(),
  docConfirmLikedSynced: vi.fn(),
  docConfirmSeenSynced: vi.fn(),
}));

vi.mock("@freed/ui/lib/bug-report", async () => {
  const actual = await vi.importActual<typeof import("@freed/ui/lib/bug-report")>(
    "@freed/ui/lib/bug-report",
  );
  return {
    ...actual,
    recordRuntimeError: mockRecordRuntimeError,
    recordBugReportEvent: mockRecordBugReportEvent,
  };
});

async function loadStore() {
  const mod = await import("./store");
  return mod.useAppStore;
}

describe("store read-state batching", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockDocMarkItemsAsRead.mockReset();
    mockDocMarkItemsAsRead.mockResolvedValue(undefined);
    mockRecordRuntimeError.mockReset();
    mockRecordBugReportEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces single-item and multi-item read updates into one batch", async () => {
    const useAppStore = await loadStore();

    const first = useAppStore.getState().markAsRead("item-a");
    const second = useAppStore.getState().markAsRead("item-b");
    const third = useAppStore.getState().markItemsAsRead(["item-b", "item-c"]);

    expect(mockDocMarkItemsAsRead).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(READ_MARK_BATCH_DELAY_MS_FOR_TESTS);
    await Promise.all([first, second, third]);

    expect(mockDocMarkItemsAsRead).toHaveBeenCalledTimes(1);
    expect(mockDocMarkItemsAsRead).toHaveBeenCalledWith([
      "item-a",
      "item-b",
      "item-c",
    ]);
  });

  it("records non-fatal diagnostics when a batched read update rejects", async () => {
    const useAppStore = await loadStore();
    const error = new Error("[automerge-worker] request TIMEOUT op=MARK_AS_READ reqId=305 pending=93");
    mockDocMarkItemsAsRead.mockRejectedValueOnce(error);

    const markAsReadPromise = useAppStore.getState().markAsRead("item-a");
    await vi.advanceTimersByTimeAsync(READ_MARK_BATCH_DELAY_MS_FOR_TESTS);
    await expect(markAsReadPromise).resolves.toBeUndefined();

    expect(mockRecordRuntimeError).toHaveBeenCalledWith({
      source: "desktop:readState",
      error,
      fatal: false,
    });
    expect(mockRecordBugReportEvent).toHaveBeenCalledWith(
      "desktop:readState",
      "error",
      "Read state update failed for 1 item",
      error.message,
    );
  });
});

const READ_MARK_BATCH_DELAY_MS_FOR_TESTS = 50;
