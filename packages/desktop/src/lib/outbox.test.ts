import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { scanLibraryCoreNormalizedBackgroundItemsV1, readLibraryCoreNormalizedItemDetailV1,
  parseLibraryCoreItemScanResponseV1, parseLibraryCoreItemDetailResponseV1,
  type LibraryCoreNormalizedReaderRuntime } from "@freed/shared/library-core";
import type { LibraryMutationEvent } from "./library-types";
import type { ConfirmFn } from "./outbox";
import type { PlatformActions } from "./platform-actions";

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

const {
  mockRecordSocialOutboxAttempt,
  mockSqliteLibraryCloudWriterAdmissionStatus,
  mockIsSqliteLibraryActive,
} = vi.hoisted(() => ({
  mockRecordSocialOutboxAttempt: vi.fn(),
  mockSqliteLibraryCloudWriterAdmissionStatus: vi.fn(async () => ({
    configured: false,
    allowed: false,
    localWriterId: null as string | null,
    activeWriterId: null as string | null,
    storageEpoch: null as string | null,
    controlRevision: null as string | null,
    verifiedAtMs: null as number | null,
  })),
  mockIsSqliteLibraryActive: vi.fn(() => false),
}));

vi.mock("./runtime-health-events", () => ({
  recordSocialOutboxAttempt: mockRecordSocialOutboxAttempt,
}));

async function loadOutbox(
  scheduleSideEffect: (task: {
    run: () => Promise<unknown> | unknown;
  }) => Promise<unknown> = async (task) => task.run(),
) {
  vi.resetModules();
  vi.doMock("./side-effect-scheduler", () => ({
    scheduleSideEffect: vi.fn(scheduleSideEffect),
  }));
  vi.doMock("./sqlite-library", () => ({
    isSqliteLibraryActive: mockIsSqliteLibraryActive,
    sqliteLibraryCloudWriterAdmissionStatus:
      mockSqliteLibraryCloudWriterAdmissionStatus,
  }));
  return import("./outbox");
}

function makeItem(
  globalId: string,
  userState: Partial<FeedItem["userState"]> = {},
): FeedItem {
  return {
    globalId,
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
      text: "Post",
      mediaUrls: [],
      mediaTypes: [],
    },
    topics: [],
    sourceUrl: `https://x.com/author/status/${globalId.slice(2)}`,
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      ...userState,
    },
  };
}

function makePatchEvent(item: FeedItem): LibraryMutationEvent {
  return {
    source: "item_patch",
    mutation: "TOGGLE_LIKED",
    changedItemIds: [item.globalId],
    changedItems: [item],
    requiresFullScan: false,
  };
}

function makeFullScanEvent(): LibraryMutationEvent {
  return {
    source: "state_update",
    mutation: "ADD_FEED_ITEMS",
    changedItemIds: null,
    requiresFullScan: true,
  };
}

function scanFixtureItems(
  getItems: () => readonly FeedItem[],
) {
  return vi.fn(async (
    visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  ) => {
    await visitPage(getItems());
  });
}

function requireSubscriber(
  subscriber: ((event: LibraryMutationEvent) => void) | null,
): (event: LibraryMutationEvent) => void {
  expect(subscriber).not.toBeNull();
  if (!subscriber) {
    throw new Error("outbox processor did not subscribe");
  }
  return subscriber;
}

describe("outbox processor", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockRecordSocialOutboxAttempt.mockReset();
    mockIsSqliteLibraryActive.mockReset().mockReturnValue(false);
    mockSqliteLibraryCloudWriterAdmissionStatus.mockReset().mockResolvedValue({
      configured: false,
      allowed: false,
      localWriterId: null,
      activeWriterId: null,
      storageEpoch: null,
      controlRevision: null,
      verifiedAtMs: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Tier 1: actual scan/detail mapping and scheduler must not rediscover an accepted effect.
  it.each(["success", "failed-ack", "restart-after-failed-ack"] as const)(
    "retains canonical seen state through refresh and %s", async (mode) => {
      vi.useFakeTimers(); vi.setSystemTime(15_000);
      const { startOutboxProcessor } = await loadOutbox();
      let seenSyncedAt: number | null = null;
      const source = { generationId: "a".repeat(64), projectionRevision: 1, transitionSequence: 1 };
      const card = { archived: false, authorAvatarUrl: null, authorDisplayName: "Author", authorHandle: "author",
        authorId: "author", capturedAt: 1, contentSignalTags: [], contentText: "synthetic", contentType: "post",
        engagementComments: null, engagementLikes: null, eventConfidenceBasisPoints: null, eventStartsAt: null,
        globalId: "x:synthetic", liked: false, likedAt: null, likedSyncedAt: null, linkPreviewTitle: null,
        linkPreviewUrl: null, locationName: null, mediaTypes: [], mediaUrls: [], platform: "x", publishedAt: 1,
        readAt: 70, readingTimeMinutes: null, saved: false, sourceUrl: "https://example.invalid/item", tags: [] };
      const runtime = { randomId: () => "synthetic", query: async (request: any) => {
        if (request.queryId === "background_item_page_v1") {
          const parsed = parseLibraryCoreItemScanResponseV1({ queryId: request.queryId, schemaVersion: 1,
            nextCursor: null, source, rows: [{ ...card, hidden: false, seenSyncedAt, rankingCareLevel: null,
              rankingEngagementReposts: null, rankingEngagementViews: null, rssSource: null,
              sampleDataFingerprint: null, topics: [] }] }, request);
          if (!parsed.ok) throw new Error(parsed.error); return parsed.value;
        }
        if (request.queryId === "item_detail_v1") {
          const parsed = parseLibraryCoreItemDetailResponseV1({ queryId: request.queryId, schemaVersion: 1,
            source, item: { card, seenSyncedAt, contentBody: { storage: "inline", blobDigest: null },
              preservedBody: { storage: "none", blobDigest: null }, mediaBlobDigests: [] } }, request);
          if (!parsed.ok) throw new Error(parsed.error); return parsed.value;
        }
        if (request.queryId === "item_annotations_v1") return { source, highlights: [], tags: [] };
        if (request.queryId === "optimistic_fields_v1") return { source, rows: [] };
        throw new Error(`unexpected query ${request.queryId}`);
      } } as LibraryCoreNormalizedReaderRuntime;
      const scan = (visit: (items: readonly FeedItem[]) => void | Promise<void>) =>
        scanLibraryCoreNormalizedBackgroundItemsV1(runtime, async items => { await visit(items); return "continue" as const; });
      let subscriber: ((event: LibraryMutationEvent) => void) | null = null;
      const markSeen = vi.fn(async () => true);
      const actions = new Map([["x" as const, { markSeen, like: vi.fn(async () => true), unlike: vi.fn(async () => true), commentUrl: () => null }]]);
      let attempts = 0;
      let successfulAcknowledgements = 0;
      const confirm = vi.fn(async (_id: string, stamp?: number) => {
        if (stamp === undefined) throw new Error("scheduler omitted confirmation time");
        attempts++;
        if (mode !== "success" && attempts === 1) throw new Error("ack unavailable before commit");
        seenSyncedAt = stamp; successfulAcknowledgements++;
        const item = await readLibraryCoreNormalizedItemDetailV1(runtime, card.globalId);
        requireSubscriber(subscriber)({ source: "item_patch", mutation: "CONFIRM_SEEN_SYNCED",
          changedItemIds: [card.globalId], changedItems: [item!], requiresFullScan: false });
      });
      const start = () => startOutboxProcessor(scan, cb => { subscriber = cb; return () => {}; }, actions,
        vi.fn(async () => {}), confirm);
      let stop = start();
      if (mode === "restart-after-failed-ack") {
        await vi.advanceTimersByTimeAsync(500);
        expect(attempts).toBe(1); stop(); stop = start();
      }
      await vi.runAllTimersAsync();
      expect(markSeen).toHaveBeenCalledTimes(1);
      expect(successfulAcknowledgements).toBe(1);
      for (let i = 0; i < 20; i++) {
        requireSubscriber(subscriber)(makeFullScanEvent()); await vi.runAllTimersAsync();
        const item = await readLibraryCoreNormalizedItemDetailV1(runtime, card.globalId);
        requireSubscriber(subscriber)({ source: "item_patch", mutation: "CONFIRM_SEEN_SYNCED",
          changedItemIds: [card.globalId], changedItems: [item!], requiresFullScan: false });
        await vi.runAllTimersAsync();
      }
      stop(); stop = start(); await vi.runAllTimersAsync(); stop();
      expect(markSeen).toHaveBeenCalledTimes(1);
      expect(successfulAcknowledgements).toBe(1);
      expect(confirm.mock.calls.every(([, stamp]) => stamp === 15_000)).toBe(true);
    });

  it("drains item patches without scanning the full item list", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();

    let subscriber: ((event: LibraryMutationEvent) => void) | null = null;
    const scanItems = scanFixtureItems(() => [makeItem("x:startup")]);
    const like = vi.fn(async () => true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanItems,
      (cb) => {
        subscriber = cb;
        return () => {
          subscriber = null;
        };
      },
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();
    expect(scanItems).toHaveBeenCalledTimes(1);
    const notify = requireSubscriber(subscriber);

    scanItems.mockImplementation(async () => {
      throw new Error("patch drain should not scan all items");
    });

    const patchedItem = makeItem("x:target", { liked: true, likedAt: 10 });
    notify(makePatchEvent(patchedItem));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(scanItems).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledWith(patchedItem);
    teardown();
  });

  it("drains normalized SQLite null synchronization receipts", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();
    const pending = makeItem("x:normalized-null", {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      liked: true,
      likedAt: 10,
      likedSyncedAt: null,
      readAt: 11,
      seenSyncedAt: null,
    } as unknown as FeedItem["userState"]);
    const scanItems = scanFixtureItems(() => [pending]);
    const like = vi.fn(async () => true);
    const markSeen = vi.fn(async () => true);

    const teardown = startOutboxProcessor(
      scanItems,
      () => () => {},
      new Map([["x", {
        like,
        unlike: vi.fn(async () => true),
        markSeen,
        commentUrl: vi.fn(() => null),
      }]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledWith(pending);
    expect(markSeen).toHaveBeenCalledWith(pending);
    teardown();
  });

  it("makes no provider attempt before writer admission exists", async () => {
    vi.useFakeTimers();
    mockIsSqliteLibraryActive.mockReturnValue(true);
    mockSqliteLibraryCloudWriterAdmissionStatus.mockResolvedValue({
      configured: false,
      allowed: false,
      localWriterId: null,
      activeWriterId: null,
      storageEpoch: null,
      controlRevision: null,
      verifiedAtMs: null,
    });
    const like = vi.fn(async () => true);
    const markSeen = vi.fn(async () => true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen,
      commentUrl: vi.fn(() => null),
    };

    const { startOutboxProcessor } = await loadOutbox();
    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [makeItem("x:retired", { liked: true, likedAt: 10 })]),
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(mockSqliteLibraryCloudWriterAdmissionStatus).toHaveBeenCalled();
    expect(like).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
    expect(mockRecordSocialOutboxAttempt).not.toHaveBeenCalled();
    teardown();
  });

  it("streams startup candidates from bounded SQLite pages", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();
    const first = makeItem("x:first", { liked: true, likedAt: 10 });
    const second = makeItem("x:second", { liked: true, likedAt: 20 });
    const like = vi.fn(async () => true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };
    const scanItems = vi.fn(async (
      visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
    ) => {
      await visitPage([first]);
      await visitPage([second]);
    });

    const teardown = startOutboxProcessor(
      scanItems,
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(scanItems).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledTimes(2);
    expect(like).toHaveBeenNthCalledWith(1, first);
    expect(like).toHaveBeenNthCalledWith(2, second);
    teardown();
  });

  it("retries patched items without falling back to a full scan", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();

    let subscriber: ((event: LibraryMutationEvent) => void) | null = null;
    const scanItems = scanFixtureItems(() => [makeItem("x:startup")]);
    const like = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanItems,
      (cb) => {
        subscriber = cb;
        return () => {
          subscriber = null;
        };
      },
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();
    expect(scanItems).toHaveBeenCalledTimes(1);
    const notify = requireSubscriber(subscriber);

    scanItems.mockImplementation(async () => {
      throw new Error("patch retry should not scan all items");
    });

    const patchedItem = makeItem("x:retry", { liked: true, likedAt: 30 });
    notify(makePatchEvent(patchedItem));
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(scanItems).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledTimes(2);
    expect(like).toHaveBeenNthCalledWith(1, patchedItem);
    expect(like).toHaveBeenNthCalledWith(2, patchedItem);
    teardown();
  });

  it("keeps full document updates on the full scan path", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();

    let subscriber: ((event: LibraryMutationEvent) => void) | null = null;
    let scanRows = [makeItem("x:startup")];
    const scanItems = scanFixtureItems(() => scanRows);
    const like = vi.fn(async () => true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanItems,
      (cb) => {
        subscriber = cb;
        return () => {
          subscriber = null;
        };
      },
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();
    expect(scanItems).toHaveBeenCalledTimes(1);
    const notify = requireSubscriber(subscriber);

    const pendingItem = makeItem("x:full-scan", { liked: true, likedAt: 20 });
    scanRows = [pendingItem];

    notify(makeFullScanEvent());
    await vi.advanceTimersByTimeAsync(5_000);

    expect(scanItems).toHaveBeenCalledTimes(2);
    expect(like).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledWith(pendingItem);
    teardown();
  });

  it("stops after three local failures without synchronizing a failure sentinel", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();
    const pendingItem = makeItem("x:exhausted", { liked: true, likedAt: 30 });
    const like = vi.fn(async () => false);
    const confirmLiked = vi.fn<ConfirmFn>(async () => undefined);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledTimes(3);
    expect(confirmLiked).not.toHaveBeenCalled();
    expect(mockRecordSocialOutboxAttempt).toHaveBeenCalledTimes(3);
    expect(mockRecordSocialOutboxAttempt).toHaveBeenLastCalledWith({
      provider: "x",
      action: "like",
      attempt: 3,
      maxAttempts: 3,
    });
    expect(Object.keys(mockRecordSocialOutboxAttempt.mock.calls[0][0]).sort()).toEqual([
      "action",
      "attempt",
      "maxAttempts",
      "provider",
    ]);
    teardown();
  });

  it("keeps the remaining retry budget across a processor restart", async () => {
    vi.useFakeTimers();
    let loaded = await loadOutbox();
    const pendingItem = makeItem("x:restart", { liked: true, likedAt: 40 });
    const like = vi.fn(async () => false);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const firstTeardown = loaded.startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(like).toHaveBeenCalledTimes(1);
    firstTeardown();

    loaded = await loadOutbox();
    const secondTeardown = loaded.startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledTimes(3);
    secondTeardown();
  });

  it("keeps retry history for a pending item omitted from the hydrated list", async () => {
    vi.useFakeTimers();
    const hiddenIntent = {
      globalId: "x:hidden-pending",
      platform: "x" as const,
      action: "like" as const,
      intentAt: 41,
    };
    const state = await import("./social-outbox-state");
    expect(state.beginSocialOutboxAttempt(hiddenIntent, 1_000)).toMatchObject({
      kind: "attempt",
      attempt: 1,
    });

    const { startOutboxProcessor } = await loadOutbox();
    let subscriber: ((event: LibraryMutationEvent) => void) | null = null;
    const like = vi.fn(async () => false);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };
    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [makeItem("x:visible")]),
      (cb) => {
        subscriber = cb;
        return () => {
          subscriber = null;
        };
      },
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);

    const hiddenPending = makeItem(hiddenIntent.globalId, {
      liked: true,
      likedAt: hiddenIntent.intentAt,
    });
    requireSubscriber(subscriber)(makePatchEvent(hiddenPending));
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledTimes(2);
    expect(mockRecordSocialOutboxAttempt).toHaveBeenNthCalledWith(1, {
      provider: "x",
      action: "like",
      attempt: 2,
      maxAttempts: 3,
    });
    expect(mockRecordSocialOutboxAttempt).toHaveBeenNthCalledWith(2, {
      provider: "x",
      action: "like",
      attempt: 3,
      maxAttempts: 3,
    });
    teardown();
  });

  it("treats historical synchronized failure sentinels as terminal", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();
    const historical = makeItem("x:historical", {
      liked: true,
      likedAt: 50,
      likedSyncedAt: -1,
      readAt: 51,
      seenSyncedAt: -1,
    });
    const actions: PlatformActions = {
      like: vi.fn(async () => true),
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [historical]),
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(actions.like).not.toHaveBeenCalled();
    expect(actions.markSeen).not.toHaveBeenCalled();
    expect(mockRecordSocialOutboxAttempt).not.toHaveBeenCalled();
    teardown();
  });

  it("gives a new like intent a fresh budget after a historical failure", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();
    let subscriber: ((event: LibraryMutationEvent) => void) | null = null;
    const historical = makeItem("x:new-intent", {
      liked: true,
      likedAt: 60,
      likedSyncedAt: -1,
    });
    const like = vi.fn(async () => true);
    const confirmLiked = vi.fn<ConfirmFn>(async () => undefined);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [historical]),
      (cb) => {
        subscriber = cb;
        return () => { subscriber = null; };
      },
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);

    const freshIntent = makeItem("x:new-intent", { liked: true, likedAt: 61 });
    const notify = requireSubscriber(subscriber);
    notify(makePatchEvent(freshIntent));
    notify({
      ...makePatchEvent(makeItem("x:new-intent", {
        liked: true,
        likedAt: 60,
        likedSyncedAt: -1,
      })),
      mutation: "BATCH_IMPORT_ITEMS",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(like).toHaveBeenCalledTimes(1);
    expect(confirmLiked).toHaveBeenCalledTimes(1);
    expect(confirmLiked.mock.calls[0][1]).toBeGreaterThan(0);
    teardown();
  });

  it("synchronizes only a positive seen confirmation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { startOutboxProcessor } = await loadOutbox();
    const pendingItem = makeItem("x:seen", { readAt: 70 });
    const markSeen = vi.fn(async () => true);
    const confirmSeen = vi.fn(async () => undefined);
    const actions: PlatformActions = {
      like: vi.fn(async () => true),
      unlike: vi.fn(async () => true),
      markSeen,
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      confirmSeen,
    );
    await vi.runAllTimersAsync();

    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(confirmSeen).toHaveBeenCalledWith("x:seen", 10_000);
    teardown();
  });

  it("keeps seen exhaustion local after three attempts", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();
    const pendingItem = makeItem("x:seen-exhausted", { readAt: 72 });
    const markSeen = vi.fn(async () => false);
    const confirmSeen = vi.fn(async () => undefined);
    const actions: PlatformActions = {
      like: vi.fn(async () => true),
      unlike: vi.fn(async () => true),
      markSeen,
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      confirmSeen,
    );
    await vi.runAllTimersAsync();

    expect(markSeen).toHaveBeenCalledTimes(3);
    expect(confirmSeen).not.toHaveBeenCalled();
    expect(mockRecordSocialOutboxAttempt).toHaveBeenLastCalledWith({
      provider: "x",
      action: "seen",
      attempt: 3,
      maxAttempts: 3,
    });
    teardown();
  });

  it("retries a failed SQLite acknowledgement without repeating the provider action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(11_000);
    const { startOutboxProcessor } = await loadOutbox();
    const pendingItem = makeItem("x:ack-retry", { liked: true, likedAt: 75 });
    const like = vi.fn(async () => true);
    const confirmLiked = vi.fn()
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce(undefined);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledTimes(1);
    expect(confirmLiked).toHaveBeenCalledTimes(2);
    expect(confirmLiked).toHaveBeenNthCalledWith(1, "x:ack-retry", 11_000);
    expect(confirmLiked).toHaveBeenNthCalledWith(2, "x:ack-retry", 11_000);
    expect(mockRecordSocialOutboxAttempt).toHaveBeenCalledTimes(1);
    teardown();
  });

  it("does not repeat a provider action when local confirmation storage also fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(12_000);
    const storageKey = "freed-device-social-outbox-v1";
    const originalSetItem = Storage.prototype.setItem;
    let ledgerWrites = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === storageKey) {
        ledgerWrites += 1;
        if (ledgerWrites === 2) throw new Error("device storage unavailable");
      }
      return originalSetItem.call(this, key, value);
    });
    const { startOutboxProcessor } = await loadOutbox();
    const pendingItem = makeItem("x:double-failure", { liked: true, likedAt: 76 });
    const like = vi.fn(async () => true);
    const confirmLiked = vi.fn()
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce(undefined);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledTimes(1);
    expect(confirmLiked).toHaveBeenCalledTimes(2);
    expect(confirmLiked).toHaveBeenNthCalledWith(1, "x:double-failure", 12_000);
    expect(confirmLiked).toHaveBeenNthCalledWith(2, "x:double-failure", 12_000);
    expect(mockRecordSocialOutboxAttempt).toHaveBeenCalledTimes(1);
    teardown();
  });

  it("serializes replacement startup drains so the same intent is not sent twice", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();
    const pendingItem = makeItem("x:single-flight", { liked: true, likedAt: 80 });
    let resolveLike!: (value: boolean) => void;
    const like = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveLike = resolve;
    }));
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };
    const confirmLiked: ConfirmFn = vi.fn(async (_id, syncedAt) => {
      pendingItem.userState.likedSyncedAt = syncedAt;
    });

    const firstTeardown = startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(like).toHaveBeenCalledTimes(1);

    const secondTeardown = startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(like).toHaveBeenCalledTimes(1);

    resolveLike(true);
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledTimes(1);
    expect(confirmLiked).toHaveBeenCalledTimes(1);
    firstTeardown();
    secondTeardown();
  });

  it("drains a delayed provider action before reset deletes the ledger and document", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor, stopAndDrainOutboxProcessor } = await loadOutbox();
    const pendingItem = makeItem("x:reset-drain", { liked: true, likedAt: 90 });
    let resolveLike!: (value: boolean) => void;
    const like = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveLike = resolve;
    }));
    const confirmLiked = vi.fn(async () => undefined);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    startOutboxProcessor(
      scanFixtureItems(() => [pendingItem]),
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(like).toHaveBeenCalledOnce();

    const resetDeletion = vi.fn(() => window.localStorage.clear());
    const draining = stopAndDrainOutboxProcessor().then(resetDeletion);
    await Promise.resolve();
    expect(resetDeletion).not.toHaveBeenCalled();
    expect(confirmLiked).not.toHaveBeenCalled();

    resolveLike(true);
    await draining;
    expect(confirmLiked).toHaveBeenCalledOnce();
    expect(confirmLiked.mock.invocationCallOrder[0]).toBeLessThan(
      resetDeletion.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(window.localStorage.length).toBe(0);
    await vi.runAllTimersAsync();
    expect(confirmLiked).toHaveBeenCalledOnce();
    expect(window.localStorage.length).toBe(0);
  });

  it("drops a provider action queued by the debounce when reset begins", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor, stopAndDrainOutboxProcessor } = await loadOutbox();
    let subscriber: ((event: LibraryMutationEvent) => void) | null = null;
    const like = vi.fn(async () => true);
    const confirmLiked = vi.fn(async () => undefined);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    startOutboxProcessor(
      scanFixtureItems(() => []),
      (callback) => {
        subscriber = callback;
        return () => {
          subscriber = null;
        };
      },
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);

    const pendingItem = makeItem("x:queued-reset", {
      liked: true,
      likedAt: 95,
    });
    requireSubscriber(subscriber)(makePatchEvent(pendingItem));

    const draining = stopAndDrainOutboxProcessor();
    await draining;

    expect(like).not.toHaveBeenCalled();
    expect(confirmLiked).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(like).not.toHaveBeenCalled();
  });

  it("does not wait for scheduled work that has not issued a provider action", async () => {
    vi.useFakeTimers();
    let releaseSchedule!: () => void;
    const scheduleGate = new Promise<void>((resolve) => {
      releaseSchedule = resolve;
    });
    const scheduleSideEffect = vi.fn(async () => scheduleGate);
    const { startOutboxProcessor, stopAndDrainOutboxProcessor } = await loadOutbox(
      scheduleSideEffect,
    );
    const like = vi.fn(async () => true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    startOutboxProcessor(
      scanFixtureItems(() => [makeItem("x:not-issued", { liked: true, likedAt: 100 })]),
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduleSideEffect).toHaveBeenCalledOnce();

    await stopAndDrainOutboxProcessor();

    expect(like).not.toHaveBeenCalled();
    releaseSchedule();
    await vi.runAllTimersAsync();
    expect(like).not.toHaveBeenCalled();
  });

  it("waits for the issued provider action without starting the next one", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor, stopAndDrainOutboxProcessor } = await loadOutbox();
    const firstItem = makeItem("x:reset-first", { liked: true, likedAt: 101 });
    const secondItem = makeItem("x:reset-second", { liked: true, likedAt: 102 });
    let resolveFirstLike!: (value: boolean) => void;
    const like = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveFirstLike = resolve;
      }))
      .mockResolvedValue(true);
    const confirmLiked = vi.fn(async () => undefined);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    startOutboxProcessor(
      scanFixtureItems(() => [firstItem, secondItem]),
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(like).toHaveBeenCalledOnce();
    expect(like).toHaveBeenCalledWith(firstItem);

    const draining = stopAndDrainOutboxProcessor();
    await Promise.resolve();
    expect(confirmLiked).not.toHaveBeenCalled();

    resolveFirstLike(true);
    await draining;

    expect(like).toHaveBeenCalledOnce();
    expect(confirmLiked).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(like).toHaveBeenCalledOnce();
  });
});
