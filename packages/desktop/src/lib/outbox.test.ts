import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import type { DocChangeEvent } from "./automerge-types";
import type { PlatformActions } from "./platform-actions";

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
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
});
