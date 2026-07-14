import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RssFeed } from "@freed/shared";
import {
  clearAllRssRuntimeState,
  getRssRuntimeState,
  resetRssRuntimeStateForTests,
  setRssRuntimeState,
  withRssRuntimeState,
  withRssRuntimeStates,
} from "./rss-runtime-state";
import { selectRssFeedsForRefresh } from "./rss-refresh-plan";

describe("device-local RSS runtime state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRssRuntimeStateForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists retry state per feed without changing the shared feed object", () => {
    const feed: RssFeed = {
      url: "https://example.com/feed",
      title: "Example",
      enabled: true,
      trackUnread: false,
      lastFetched: 100,
    };
    setRssRuntimeState(feed.url, {
      lastFetchAttemptedAt: 200,
      nextFetchAfter: 300,
      consecutiveFailures: 2,
      lastFetchError: "offline",
    });

    expect(getRssRuntimeState(feed.url)).toEqual({
      lastFetchAttemptedAt: 200,
      nextFetchAfter: 300,
      consecutiveFailures: 2,
      lastFetchError: "offline",
    });
    expect(withRssRuntimeState(feed)).toMatchObject({
      lastFetched: 100,
      nextFetchAfter: 300,
      consecutiveFailures: 2,
    });
    expect(feed.nextFetchAfter).toBeUndefined();
  });

  it("does not reuse a retry window after a factory reset", () => {
    const url = "https://example.com/feed";
    setRssRuntimeState(url, {
      nextFetchAfter: 9_999,
      consecutiveFailures: 3,
      lastFetchError: "offline",
    });

    expect(clearAllRssRuntimeState()).toBe(true);

    expect(getRssRuntimeState(url)).toEqual({});
    expect(JSON.parse(
      window.localStorage.getItem("freed-device-rss-runtime-v1") ?? "null",
    )).toEqual({ version: 1, feeds: {} });
  });

  it("ignores legacy synced runtime state until this device records local state", () => {
    const feed: RssFeed = {
      url: "https://example.com/legacy-feed",
      title: "Legacy",
      enabled: true,
      trackUnread: false,
      lastFetchAttemptedAt: 7_000,
      nextFetchAfter: 8_000,
      consecutiveFailures: 4,
      lastFetchError: "legacy failure",
      etag: "legacy-etag",
      lastModified: "yesterday",
    };

    expect(withRssRuntimeState(feed)).toEqual({
      url: "https://example.com/legacy-feed",
      title: "Legacy",
      enabled: true,
      trackUnread: false,
    });

    setRssRuntimeState(feed.url, {
      lastFetchAttemptedAt: 11_000,
      nextFetchAfter: 12_000,
      consecutiveFailures: 1,
      lastFetchError: "local failure",
    });
    expect(withRssRuntimeState(feed)).toMatchObject({
      lastFetchAttemptedAt: 11_000,
      nextFetchAfter: 12_000,
      consecutiveFailures: 1,
      lastFetchError: "local failure",
    });
    expect(withRssRuntimeState(feed).etag).toBeUndefined();
    expect(withRssRuntimeState(feed).lastModified).toBeUndefined();
  });

  it("ignores malformed local records instead of spreading them into a feed", () => {
    const url = "https://example.com/malformed-feed";
    window.localStorage.setItem("freed-device-rss-runtime-v1", JSON.stringify({
      version: 1,
      feeds: {
        [url]: {
          nextFetchAfter: "tomorrow",
          consecutiveFailures: -4,
          lastFetchError: 500,
          title: "Injected title",
          enabled: false,
        },
      },
    }));

    const feed: RssFeed = {
      url,
      title: "Real title",
      enabled: true,
      trackUnread: false,
    };

    expect(getRssRuntimeState(url)).toEqual({});
    expect(withRssRuntimeState(feed)).toEqual(feed);
  });

  it("does not downgrade RSS runtime state written by a newer app", () => {
    const future = JSON.stringify({
      version: 2,
      feeds: {
        "https://example.com/future-feed": {
          adaptiveBackoffPlan: "future",
        },
      },
    });
    window.localStorage.setItem("freed-device-rss-runtime-v1", future);

    setRssRuntimeState("https://example.com/current-feed", {
      consecutiveFailures: 1,
      nextFetchAfter: 20_000,
    });

    expect(window.localStorage.getItem("freed-device-rss-runtime-v1")).toBe(future);
    const feed: RssFeed = {
      url: "https://example.com/current-feed",
      title: "Current",
      enabled: true,
      trackUnread: false,
    };
    const hydrated = withRssRuntimeStates([feed]);
    expect(hydrated[0].nextFetchAfter).toBe(Number.MAX_SAFE_INTEGER);
    expect(selectRssFeedsForRefresh(hydrated, { now: 1_000 })).toEqual([]);
    expect(selectRssFeedsForRefresh(hydrated, {
      now: 1_000,
      respectRetryWindow: false,
    })).toEqual(hydrated);
  });

  it("blocks scheduled pulls when runtime storage is unavailable", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    resetRssRuntimeStateForTests();

    const feed: RssFeed = {
      url: "https://example.com/unavailable-feed",
      title: "Unavailable",
      enabled: true,
      trackUnread: false,
    };
    const hydrated = withRssRuntimeState(feed);
    expect(hydrated.nextFetchAfter).toBe(Number.MAX_SAFE_INTEGER);
    expect(selectRssFeedsForRefresh([hydrated], { now: 1_000 })).toEqual([]);
  });

  it("blocks scheduled pulls after a runtime state write fails", () => {
    const actualStorage = window.localStorage;
    const failingStorage = new Proxy(actualStorage, {
      get(target, property) {
        if (property === "setItem") {
          return () => {
            throw new Error("quota exceeded");
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    vi.spyOn(window, "localStorage", "get").mockReturnValue(failingStorage);

    const feed: RssFeed = {
      url: "https://example.com/write-failure-feed",
      title: "Write failure",
      enabled: true,
      trackUnread: false,
    };
    setRssRuntimeState(feed.url, {
      consecutiveFailures: 1,
      nextFetchAfter: 20_000,
    });

    expect(getRssRuntimeState(feed.url)).toEqual({});
    const hydrated = withRssRuntimeState(feed);
    expect(hydrated.nextFetchAfter).toBe(Number.MAX_SAFE_INTEGER);
    expect(selectRssFeedsForRefresh([hydrated], { now: 1_000 })).toEqual([]);
    expect(selectRssFeedsForRefresh([hydrated], {
      now: 1_000,
      respectRetryWindow: false,
    })).toEqual([hydrated]);
  });

  it("keeps retry state when factory reset cannot persist", () => {
    const url = "https://example.com/stable-feed";
    setRssRuntimeState(url, { nextFetchAfter: 9_999 });
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(clearAllRssRuntimeState()).toBe(false);
    expect(getRssRuntimeState(url)).toEqual({ nextFetchAfter: 9_999 });
  });
});
