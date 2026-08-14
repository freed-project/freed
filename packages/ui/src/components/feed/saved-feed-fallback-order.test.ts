import { describe, expect, it } from "vitest";
import {
  calculatePriority,
  RECENCY_HORIZON_HOURS,
  sortSavedFeedItems,
  type FeedItem,
  type SavedContentSortMode,
  type WeightPreferences,
} from "@freed/shared";
import {
  orderDesktopSavedFallbackItems,
  resolveBoundedReaderRankingClock,
  savedFeedRankingClockMs,
} from "./saved-feed-fallback-order";

const HOUR_MS = 60 * 60 * 1_000;
const WEIGHTS: WeightPreferences = {
  recency: 50,
  authors: { "author-a": 1, "author-b": 5 },
  platforms: { rss: 50 },
  topics: {},
};

function savedItem(
  globalId: string,
  authorId: string,
  publishedAt: number,
  priority: number,
): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "article",
    capturedAt: publishedAt,
    publishedAt,
    author: { id: authorId },
    content: { text: globalId },
    media: [],
    topics: [],
    priority,
    userState: {
      saved: true,
      savedAt: publishedAt,
      archived: false,
      hidden: false,
      tags: [],
    },
  };
}

describe("Saved fallback ranking parity", () => {
  it.each<[SavedContentSortMode, number]>([
    ["date_saved", 0],
    ["date_published", 0],
    ["recommended", 123_456],
    ["shortest_read", 0],
  ])("uses the required ranking clock for %s", (sortMode, expected) => {
    expect(savedFeedRankingClockMs(sortMode, 123_456)).toBe(expected);
  });

  it("reuses one identity clock and matches exact-clock order at the recency horizon", () => {
    const rankingClockMs = 1_800_000_000_000;
    const firstClock = resolveBoundedReaderRankingClock(
      null,
      "saved:recommended:1",
      rankingClockMs,
    );
    expect(
      resolveBoundedReaderRankingClock(
        firstClock,
        "saved:recommended:1",
        rankingClockMs + HOUR_MS,
      ),
    ).toBe(firstClock);
    expect(
      resolveBoundedReaderRankingClock(
        firstClock,
        "saved:recommended:2",
        rankingClockMs + HOUR_MS,
      ).rankingClockMs,
    ).toBe(rankingClockMs + HOUR_MS);

    const items = [
      savedItem(
        "a-boundary",
        "author-a",
        rankingClockMs - (RECENCY_HORIZON_HOURS - 2) * HOUR_MS,
        0,
      ),
      savedItem(
        "b-invariant",
        "author-b",
        rankingClockMs - (RECENCY_HORIZON_HOURS + 1) * HOUR_MS,
        100,
      ),
    ];
    const nativeOrder = sortSavedFeedItems(
      items.map((item) => ({
        ...item,
        priority: calculatePriority(item, WEIGHTS, rankingClockMs, {
          persons: {},
          accounts: {},
        }),
      })),
      "recommended",
    );
    const fallbackOrder = orderDesktopSavedFallbackItems({
      items,
      sortMode: "recommended",
      weights: WEIGHTS,
      persons: {},
      accounts: {},
      rankingClockMs,
    });

    expect(fallbackOrder.map((item) => item.globalId)).toEqual(
      nativeOrder.map((item) => item.globalId),
    );
    expect(fallbackOrder.map((item) => item.globalId)).toEqual([
      "a-boundary",
      "b-invariant",
    ]);
    expect(
      orderDesktopSavedFallbackItems({
        items,
        sortMode: "recommended",
        weights: WEIGHTS,
        persons: {},
        accounts: {},
        rankingClockMs: rankingClockMs + 2 * HOUR_MS,
      }).map((item) => item.globalId),
    ).toEqual(["b-invariant", "a-boundary"]);
  });

  it.each<SavedContentSortMode>([
    "date_saved",
    "date_published",
    "recommended",
    "shortest_read",
  ])("uses the Desktop v1 binary tie-break for %s", (sortMode) => {
    const rankingClockMs = 1_800_000_000_000;
    const items = [
      savedItem("ä-item", "author-a", rankingClockMs - HOUR_MS, 0),
      savedItem("z-item", "author-a", rankingClockMs - HOUR_MS, 0),
    ];

    expect(
      orderDesktopSavedFallbackItems({
        items,
        sortMode,
        weights: WEIGHTS,
        persons: {},
        accounts: {},
        rankingClockMs,
      }).map((item) => item.globalId),
    ).toEqual(["z-item", "ä-item"]);
  });
});
