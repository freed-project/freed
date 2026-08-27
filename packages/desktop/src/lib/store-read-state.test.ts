import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMarkLibraryItemsAsRead,
  mockRecordRuntimeError,
  mockRecordBugReportEvent,
} = vi.hoisted(() => ({
  mockMarkLibraryItemsAsRead: vi.fn(),
  mockRecordRuntimeError: vi.fn(),
  mockRecordBugReportEvent: vi.fn(),
}));

vi.mock("./library-client", () => ({
  initializeDesktopLibraryRuntime: vi.fn(),
  quiesceDesktopLibraryForFactoryReset: vi.fn(() => Promise.resolve()),
  subscribeDesktopLibraryRuntime: vi.fn(() => () => {}),
  getDesktopLibraryRuntimeState: vi.fn(() => null),
  addLibraryFeedItems: vi.fn(),
  addSampleLibraryData: vi.fn(),
  addLibraryRssFeed: vi.fn(),
  removeLibraryRssFeed: vi.fn(),
  removeAllLibraryFeeds: vi.fn(),
  updateLibraryRssFeed: vi.fn(),
  updateLibraryFeedItem: vi.fn(),
  markLibraryItemAsRead: vi.fn(),
  markLibraryItemsAsRead: mockMarkLibraryItemsAsRead,
  markAllLibraryItemsAsRead: vi.fn(),
  toggleLibraryItemSaved: vi.fn(),
  removeLibraryFeedItem: vi.fn(),
  clearSampleLibraryData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
  toggleLibraryItemArchived: vi.fn(),
  archiveAllReadUnsavedLibraryItems: vi.fn(),
  deleteAllArchivedLibraryItems: vi.fn(),
  pruneArchivedLibraryItems: vi.fn(),
  updateLibraryPreferences: vi.fn(),
  backfillLibraryContentSignals: vi.fn(() => Promise.resolve({ updated: 0, remaining: 0 })),
  deduplicateLibraryFeedItems: vi.fn(),
  healUntitledLibraryFeedTitles: vi.fn(),
  toggleLibraryItemLiked: vi.fn(),
  confirmLibraryItemLikedSynced: vi.fn(),
  confirmLibraryItemSeenSynced: vi.fn(),
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

async function loadStoreModule() {
  return import("./store");
}

describe("store read-state batching", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockMarkLibraryItemsAsRead.mockReset();
    mockMarkLibraryItemsAsRead.mockResolvedValue(undefined);
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

    expect(mockMarkLibraryItemsAsRead).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(READ_MARK_BATCH_DELAY_MS_FOR_TESTS);
    await Promise.all([first, second, third]);

    expect(mockMarkLibraryItemsAsRead).toHaveBeenCalledTimes(1);
    expect(mockMarkLibraryItemsAsRead).toHaveBeenCalledWith([
      "item-a",
      "item-b",
      "item-c",
    ]);
  });

  it("does not make single-item read updates wait for the batch flush", async () => {
    const useAppStore = await loadStore();

    const markAsReadPromise = useAppStore.getState().markAsRead("item-a");

    await expect(markAsReadPromise).resolves.toBeUndefined();
    expect(mockMarkLibraryItemsAsRead).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(READ_MARK_BATCH_DELAY_MS_FOR_TESTS);

    expect(mockMarkLibraryItemsAsRead).toHaveBeenCalledWith(["item-a"]);
  });

  it("records non-fatal diagnostics when a batched read update rejects", async () => {
    const useAppStore = await loadStore();
    const error = new Error("[automerge-worker] request TIMEOUT op=MARK_AS_READ reqId=305 pending=93");
    mockMarkLibraryItemsAsRead.mockRejectedValueOnce(error);

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

  it("records queued and flushed diagnostics for multi-item read updates", async () => {
    const useAppStore = await loadStore();
    useAppStore.setState({ totalUnreadCount: 3 });

    const markItemsPromise = useAppStore.getState().markItemsAsRead([
      "rss:test:article-12345678",
      "rss:test:article-87654321",
    ]);

    await vi.advanceTimersByTimeAsync(READ_MARK_BATCH_DELAY_MS_FOR_TESTS);
    await markItemsPromise;

    expect(mockRecordBugReportEvent).toHaveBeenCalledWith(
      "desktop:readState",
      "info",
      "Queued 2 read marks",
      expect.stringContaining("...12345678"),
    );
    expect(mockRecordBugReportEvent).toHaveBeenCalledWith(
      "desktop:readState",
      "info",
      "Flushed 2 read marks",
      expect.stringContaining("...87654321"),
    );
  });

  it("records provider sync activity around the provider task", async () => {
    const { withProviderSyncing } = await loadStoreModule();
    const { useBackgroundActivityStore } = await import("@freed/ui/lib/background-activity-store");

    let activeDuringTask = false;
    const result = await withProviderSyncing("facebook", async () => {
      activeDuringTask = Boolean(useBackgroundActivityStore.getState().active["channel:facebook"]);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(activeDuringTask).toBe(true);
    expect(useBackgroundActivityStore.getState().active["channel:facebook"]).toBeUndefined();
    expect(useBackgroundActivityStore.getState().log[0]).toMatchObject({
      level: "success",
      channelId: "facebook",
      message: "Facebook sync finished.",
    });
  });

  it("drains an in-flight provider capture before reset cleanup begins", async () => {
    const { quiesceDesktopStoreForFactoryReset, withProviderSyncing } =
      await loadStoreModule();
    let releaseCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const captureSettled = vi.fn();
    const capturing = withProviderSyncing("facebook", async () => {
      await captureGate;
      captureSettled();
    });
    await Promise.resolve();

    const cleanupStarted = vi.fn();
    const quiescing = quiesceDesktopStoreForFactoryReset().then(cleanupStarted);
    await Promise.resolve();
    expect(cleanupStarted).not.toHaveBeenCalled();

    releaseCapture();
    await capturing;
    await quiescing;
    expect(captureSettled.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupStarted.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("drops queued read marks when reset quiescence starts", async () => {
    const { quiesceDesktopStoreForFactoryReset, useAppStore } =
      await loadStoreModule();

    await useAppStore.getState().markAsRead("item-never-written");
    await quiesceDesktopStoreForFactoryReset();
    await vi.advanceTimersByTimeAsync(READ_MARK_BATCH_DELAY_MS_FOR_TESTS);

    expect(mockMarkLibraryItemsAsRead).not.toHaveBeenCalled();
  });

  it("clears provider sync activity when the provider task throws", async () => {
    const { withProviderSyncing } = await loadStoreModule();
    const { useBackgroundActivityStore } = await import("@freed/ui/lib/background-activity-store");

    await expect(
      withProviderSyncing("instagram", async () => {
        throw new Error("session expired");
      }),
    ).rejects.toThrow("session expired");

    expect(useBackgroundActivityStore.getState().active["channel:instagram"]).toBeUndefined();
    expect(useBackgroundActivityStore.getState().log[0]).toMatchObject({
      level: "error",
      channelId: "instagram",
      message: "Instagram sync failed: session expired",
    });
  });
});

const READ_MARK_BATCH_DELAY_MS_FOR_TESTS = 50;
