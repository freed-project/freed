import { describe, expect, it } from "vitest";
import type { RssFeed } from "@freed/shared";
import {
  SCHEDULED_RSS_MAX_FEEDS,
  SCHEDULED_RSS_STALE_AFTER_MS,
  selectRssFeedsForRefresh,
} from "./rss-refresh-plan";

function feed(url: string, lastFetched?: number, enabled = true): RssFeed {
  return {
    url,
    title: url,
    enabled,
    trackUnread: false,
    lastFetched,
  };
}

describe("rss refresh plan", () => {
  it("keeps manual refreshes complete but stable", () => {
    const feeds = [
      feed("https://new.example/feed"),
      feed("https://old.example/feed", 10),
      feed("https://disabled.example/feed", 1, false),
    ];

    expect(selectRssFeedsForRefresh(feeds).map((entry) => entry.url)).toEqual([
      "https://new.example/feed",
      "https://old.example/feed",
    ]);
  });

  it("skips channels absent from the latest YouTube roster without changing enabled", () => {
    const unfollowed = {
      ...feed("https://youtube.example/unfollowed", 1),
      youtubeChannelId: "channel-unfollowed",
      youtubeRosterActive: false,
    };
    const followed = {
      ...feed("https://youtube.example/followed", 2),
      youtubeChannelId: "channel-followed",
      youtubeRosterActive: true,
    };
    const legacy = feed("https://legacy.example/feed", 3);

    expect(selectRssFeedsForRefresh([unfollowed, followed, legacy])).toEqual([
      followed,
      legacy,
    ]);
    expect(unfollowed.enabled).toBe(true);
  });

  it("limits scheduled refreshes to stale feeds", () => {
    const now = 10 * SCHEDULED_RSS_STALE_AFTER_MS;
    const fresh = now - SCHEDULED_RSS_STALE_AFTER_MS + 1;
    const stale = now - SCHEDULED_RSS_STALE_AFTER_MS - 1;
    const feeds = [
      feed("https://fresh.example/feed", fresh),
      feed("https://missing.example/feed"),
      feed("https://stale.example/feed", stale),
    ];

    expect(
      selectRssFeedsForRefresh(feeds, {
        staleAfterMs: SCHEDULED_RSS_STALE_AFTER_MS,
        maxFeeds: SCHEDULED_RSS_MAX_FEEDS,
        now,
      }).map((entry) => entry.url),
    ).toEqual([
      "https://missing.example/feed",
      "https://stale.example/feed",
    ]);
  });

  it("caps scheduled refreshes to the stalest feeds", () => {
    const now = 10 * SCHEDULED_RSS_STALE_AFTER_MS;
    const feeds = [
      feed("https://third.example/feed", 300),
      feed("https://first.example/feed", 100),
      feed("https://second.example/feed", 200),
    ];

    expect(
      selectRssFeedsForRefresh(feeds, {
        staleAfterMs: 1,
        maxFeeds: 2,
        now,
      }).map((entry) => entry.url),
    ).toEqual([
      "https://first.example/feed",
      "https://second.example/feed",
    ]);
  });

  it("skips feeds whose retry window is still closed", () => {
    const now = 10 * SCHEDULED_RSS_STALE_AFTER_MS;
    const eligible = feed("https://eligible.example/feed", 100);
    const delayed = {
      ...feed("https://delayed.example/feed", 100),
      nextFetchAfter: now + 1,
    };

    expect(
      selectRssFeedsForRefresh([delayed, eligible], {
        staleAfterMs: 1,
        maxFeeds: SCHEDULED_RSS_MAX_FEEDS,
        now,
      }).map((entry) => entry.url),
    ).toEqual(["https://eligible.example/feed"]);
  });
});
