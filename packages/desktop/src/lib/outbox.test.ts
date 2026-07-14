import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import type { DocChangeEvent } from "./automerge-types";
import type { ConfirmFn } from "./outbox";
import type { PlatformActions } from "./platform-actions";

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

const { mockRecordSocialOutboxAttempt } = vi.hoisted(() => ({
  mockRecordSocialOutboxAttempt: vi.fn(),
}));

vi.mock("./runtime-health-events", () => ({
  recordSocialOutboxAttempt: mockRecordSocialOutboxAttempt,
}));

async function loadOutbox() {
  vi.resetModules();
  vi.doMock("./side-effect-scheduler", () => ({
    scheduleSideEffect: vi.fn(async (task: { run: () => Promise<unknown> | unknown }) => task.run()),
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

function makePatchEvent(item: FeedItem): DocChangeEvent {
  return {
    source: "item_patch",
    mutation: "TOGGLE_LIKED",
    changedItemIds: [item.globalId],
    changedItems: [item],
    requiresFullScan: false,
  };
}

function makeFullScanEvent(): DocChangeEvent {
  return {
    source: "state_update",
    mutation: "ADD_FEED_ITEMS",
    changedItemIds: null,
    requiresFullScan: true,
  };
}

function requireSubscriber(
  subscriber: ((event: DocChangeEvent) => void) | null,
): (event: DocChangeEvent) => void {
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drains item patches without scanning the full item list", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();

    let subscriber: ((event: DocChangeEvent) => void) | null = null;
    const getItems = vi.fn(() => [makeItem("x:startup")]);
    const like = vi.fn(async () => true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      getItems,
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
    expect(getItems).toHaveBeenCalledTimes(1);
    const notify = requireSubscriber(subscriber);

    getItems.mockImplementation(() => {
      throw new Error("patch drain should not scan all items");
    });

    const patchedItem = makeItem("x:target", { liked: true, likedAt: 10 });
    notify(makePatchEvent(patchedItem));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getItems).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledWith(patchedItem);
    teardown();
  });

  it("retries patched items without falling back to a full scan", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();

    let subscriber: ((event: DocChangeEvent) => void) | null = null;
    const getItems = vi.fn(() => [makeItem("x:startup")]);
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
      getItems,
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
    expect(getItems).toHaveBeenCalledTimes(1);
    const notify = requireSubscriber(subscriber);

    getItems.mockImplementation(() => {
      throw new Error("patch retry should not scan all items");
    });

    const patchedItem = makeItem("x:retry", { liked: true, likedAt: 30 });
    notify(makePatchEvent(patchedItem));
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getItems).toHaveBeenCalledTimes(1);
    expect(like).toHaveBeenCalledTimes(2);
    expect(like).toHaveBeenNthCalledWith(1, patchedItem);
    expect(like).toHaveBeenNthCalledWith(2, patchedItem);
    teardown();
  });

  it("keeps full document updates on the full scan path", async () => {
    vi.useFakeTimers();
    const { startOutboxProcessor } = await loadOutbox();

    let subscriber: ((event: DocChangeEvent) => void) | null = null;
    const getItems = vi.fn(() => [makeItem("x:startup")]);
    const like = vi.fn(async () => true);
    const actions: PlatformActions = {
      like,
      unlike: vi.fn(async () => true),
      markSeen: vi.fn(async () => true),
      commentUrl: vi.fn(() => null),
    };

    const teardown = startOutboxProcessor(
      getItems,
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
    expect(getItems).toHaveBeenCalledTimes(1);
    const notify = requireSubscriber(subscriber);

    const pendingItem = makeItem("x:full-scan", { liked: true, likedAt: 20 });
    getItems.mockReturnValue([pendingItem]);

    notify(makeFullScanEvent());
    await vi.advanceTimersByTimeAsync(5_000);

    expect(getItems).toHaveBeenCalledTimes(2);
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
      () => [pendingItem],
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
      () => [pendingItem],
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
      () => [pendingItem],
      () => () => {},
      new Map([["x", actions]]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await vi.runAllTimersAsync();

    expect(like).toHaveBeenCalledTimes(3);
    secondTeardown();
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
      () => [historical],
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
    let subscriber: ((event: DocChangeEvent) => void) | null = null;
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
      () => [historical],
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
      mutation: "MERGE_DOC",
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
      () => [pendingItem],
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
      () => [pendingItem],
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

  it("retries a failed Automerge acknowledgement without repeating the provider action", async () => {
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
      () => [pendingItem],
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
      () => [pendingItem],
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
      () => [pendingItem],
      () => () => {},
      new Map([["x", actions]]),
      confirmLiked,
      vi.fn(async () => undefined),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(like).toHaveBeenCalledTimes(1);

    const secondTeardown = startOutboxProcessor(
      () => [pendingItem],
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
      () => [pendingItem],
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
});
