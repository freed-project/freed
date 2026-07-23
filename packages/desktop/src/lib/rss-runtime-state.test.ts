import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RssFeed } from "@freed/shared";
import {
  resetRssRuntimeStateForTests,
  setRssRuntimeState,
  type RssRuntimeState,
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

    expect(withRssRuntimeState(feed)).toMatchObject({
      lastFetchAttemptedAt: 200,
      lastFetched: 100,
      nextFetchAfter: 300,
      consecutiveFailures: 2,
      lastFetchError: "offline",
    });
    expect(feed.nextFetchAfter).toBeUndefined();
  });

  it("migrates a legacy retry window once so an upgrade cannot pull early", () => {
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
      lastFetchAttemptedAt: 7_000,
      nextFetchAfter: 8_000,
      consecutiveFailures: 4,
      lastFetchError: "legacy failure",
    });
    expect(withRssRuntimeState(feed).etag).toBeUndefined();
    expect(withRssRuntimeState(feed).lastModified).toBeUndefined();

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

  it("keeps an existing local record ahead of stale synchronized retry state", () => {
    const feed: RssFeed = {
      url: "https://example.com/local-wins",
      title: "Local wins",
      enabled: true,
      trackUnread: false,
      lastFetchAttemptedAt: 7_000,
      nextFetchAfter: 80_000,
      consecutiveFailures: 4,
      lastFetchError: "stale synchronized failure",
    };
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
  });

  it("blocks scheduled pulls when a local feed record is malformed", () => {
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

    const hydrated = withRssRuntimeState(feed);
    expect(hydrated).toMatchObject({
      url,
      title: "Real title",
      enabled: true,
      nextFetchAfter: Number.MAX_SAFE_INTEGER,
    });
    expect(selectRssFeedsForRefresh([hydrated], { now: 1_000 })).toEqual([]);
    expect(selectRssFeedsForRefresh([hydrated], {
      now: 1_000,
      respectRetryWindow: false,
    })).toEqual([hydrated]);
  });

  it("blocks scheduled pulls when the ledger contains an invalid feed key", () => {
    window.localStorage.setItem("freed-device-rss-runtime-v1", JSON.stringify({
      version: 1,
      feeds: {
        "": {
          nextFetchAfter: 50_000,
          consecutiveFailures: 2,
        },
      },
    }));

    const feed: RssFeed = {
      url: "https://example.com/valid-feed",
      title: "Valid",
      enabled: true,
      trackUnread: false,
    };
    const hydrated = withRssRuntimeState(feed);
    expect(hydrated.nextFetchAfter).toBe(Number.MAX_SAFE_INTEGER);
    expect(selectRssFeedsForRefresh([hydrated], { now: 1_000 })).toEqual([]);
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

    const hydrated = withRssRuntimeState(feed);
    expect(hydrated.nextFetchAfter).toBe(Number.MAX_SAFE_INTEGER);
    expect(selectRssFeedsForRefresh([hydrated], { now: 1_000 })).toEqual([]);
    expect(selectRssFeedsForRefresh([hydrated], {
      now: 1_000,
      respectRetryWindow: false,
    })).toEqual([hydrated]);
  });

  it("preserves a full retry ledger and blocks newly untracked feeds", () => {
    const feeds = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `https://example.com/feed-${index.toLocaleString("en-US", { useGrouping: false })}`,
        {
          consecutiveFailures: 1,
          nextFetchAfter: 20_000 + index,
        },
      ]),
    );
    window.localStorage.setItem("freed-device-rss-runtime-v1", JSON.stringify({
      version: 1,
      feeds,
    }));
    resetRssRuntimeStateForTests();
    const existingUrl = "https://example.com/feed-0";
    const newUrl = "https://example.com/feed-over-capacity";

    setRssRuntimeState(existingUrl, { nextFetchAfter: 50_000 });
    setRssRuntimeState(newUrl, {
      consecutiveFailures: 1,
      nextFetchAfter: 60_000,
    });

    const stored = JSON.parse(
      window.localStorage.getItem("freed-device-rss-runtime-v1") ?? "{}",
    ) as { feeds?: Record<string, RssRuntimeState> };
    expect(Object.keys(stored.feeds ?? {})).toHaveLength(10_000);
    expect(stored.feeds?.[existingUrl]?.nextFetchAfter).toBe(50_000);
    expect(stored.feeds?.[newUrl]).toBeUndefined();
    const untrackedFeed: RssFeed = {
      url: newUrl,
      title: "Over capacity",
      enabled: true,
      trackUnread: false,
    };
    const hydrated = withRssRuntimeState(untrackedFeed);
    expect(hydrated.nextFetchAfter).toBe(Number.MAX_SAFE_INTEGER);
    expect(selectRssFeedsForRefresh([hydrated], { now: 1_000 })).toEqual([]);
  });
});
