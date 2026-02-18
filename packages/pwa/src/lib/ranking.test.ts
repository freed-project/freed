/**
 * Unit tests for the shared ranking and filtering algorithms
 */

import { describe, it, expect } from "vitest";
import {
  calculatePriority,
  rankFeedItems,
  filterFeedItems,
  sortByPriority,
} from "@freed/shared";
import type { FeedItem, WeightPreferences } from "@freed/shared";

// =============================================================================
// Test fixtures
// =============================================================================

const baseWeights: WeightPreferences = {
  recency: 50,
  platforms: {},
  authors: {},
  topics: {},
};

function makeItem(overrides: Partial<FeedItem> & { globalId: string }): FeedItem {
  return {
    platform: "rss",
    contentType: "article",
    capturedAt: Date.now(),
    publishedAt: Date.now(),
    author: {
      id: "author-1",
      handle: "author1",
      displayName: "Author One",
    },
    content: { text: "Hello world", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    ...overrides,
  };
}

const NOW = Date.now();

// =============================================================================
// calculatePriority
// =============================================================================

describe("calculatePriority", () => {
  it("gives higher score to recent items", () => {
    const fresh = makeItem({ globalId: "fresh", publishedAt: NOW - 1000 * 60 }); // 1 min ago
    const old = makeItem({ globalId: "old", publishedAt: NOW - 1000 * 60 * 60 * 100 }); // 100 hours ago

    const freshScore = calculatePriority(fresh, baseWeights, NOW);
    const oldScore = calculatePriority(old, baseWeights, NOW);

    expect(freshScore).toBeGreaterThan(oldScore);
  });

  it("returns a score between 0 and 100", () => {
    const item = makeItem({ globalId: "test", publishedAt: NOW });
    const score = calculatePriority(item, baseWeights, NOW);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("boosts saved items", () => {
    const unsaved = makeItem({ globalId: "unsaved", publishedAt: NOW - 1000 * 60 * 60 * 24 });
    const saved = makeItem({
      globalId: "saved",
      publishedAt: NOW - 1000 * 60 * 60 * 24,
      userState: { hidden: false, saved: true, archived: false, tags: [] },
    });

    const savedScore = calculatePriority(saved, baseWeights, NOW);
    const unsavedScore = calculatePriority(unsaved, baseWeights, NOW);

    expect(savedScore).toBeGreaterThan(unsavedScore);
  });

  it("applies author weight boost", () => {
    const weights: WeightPreferences = {
      ...baseWeights,
      authors: { "author-1": 100 }, // max boost for author-1
    };
    const itemFav = makeItem({ globalId: "fav", publishedAt: NOW - 1000 * 60 * 60 * 10 });
    const itemPlain = makeItem({
      globalId: "plain",
      publishedAt: NOW - 1000 * 60 * 60 * 10,
      author: { id: "author-2", handle: "author2", displayName: "Author Two" },
    });

    const favScore = calculatePriority(itemFav, weights, NOW);
    const plainScore = calculatePriority(itemPlain, weights, NOW);

    expect(favScore).toBeGreaterThan(plainScore);
  });

  it("applies platform weight preference", () => {
    const weights: WeightPreferences = {
      ...baseWeights,
      platforms: { x: 100, rss: 10 },
    };
    const xItem = makeItem({
      globalId: "x-item",
      platform: "x",
      publishedAt: NOW - 1000 * 60 * 60,
    });
    const rssItem = makeItem({
      globalId: "rss-item",
      platform: "rss",
      publishedAt: NOW - 1000 * 60 * 60,
    });

    const xScore = calculatePriority(xItem, weights, NOW);
    const rssScore = calculatePriority(rssItem, weights, NOW);

    expect(xScore).toBeGreaterThan(rssScore);
  });

  it("uses engagement signal when present", () => {
    const viral = makeItem({
      globalId: "viral",
      publishedAt: NOW - 1000 * 60 * 60 * 10,
      engagement: { likes: 10000, reposts: 5000, comments: 2000 },
    });
    const quiet = makeItem({
      globalId: "quiet",
      publishedAt: NOW - 1000 * 60 * 60 * 10,
    });

    const viralScore = calculatePriority(viral, baseWeights, NOW);
    const quietScore = calculatePriority(quiet, baseWeights, NOW);

    expect(viralScore).toBeGreaterThan(quietScore);
  });

  it("returns same score for items with same attributes", () => {
    const a = makeItem({ globalId: "a", publishedAt: NOW - 5000 });
    const b = makeItem({ globalId: "b", publishedAt: NOW - 5000 });

    expect(calculatePriority(a, baseWeights, NOW)).toBe(
      calculatePriority(b, baseWeights, NOW)
    );
  });
});

// =============================================================================
// rankFeedItems
// =============================================================================

describe("rankFeedItems", () => {
  it("assigns a priority to every item", () => {
    const items = [
      makeItem({ globalId: "a", publishedAt: NOW - 1000 }),
      makeItem({ globalId: "b", publishedAt: NOW - 5000 }),
      makeItem({ globalId: "c", publishedAt: NOW - 100000 }),
    ];

    const ranked = rankFeedItems(items, baseWeights);

    expect(ranked).toHaveLength(3);
    for (const item of ranked) {
      expect(item.priority).toBeDefined();
      expect(typeof item.priority).toBe("number");
    }
  });

  it("does not mutate the original items", () => {
    const items = [
      makeItem({ globalId: "a", publishedAt: NOW }),
    ];
    const original = items[0];

    rankFeedItems(items, baseWeights);

    expect(items[0]).toBe(original); // same reference
    expect(original.priority).toBeUndefined(); // not mutated
  });

  it("sets priorityComputedAt on each item", () => {
    const items = [makeItem({ globalId: "a", publishedAt: NOW })];
    const ranked = rankFeedItems(items, baseWeights);

    expect(ranked[0].priorityComputedAt).toBeDefined();
  });
});

// =============================================================================
// sortByPriority
// =============================================================================

describe("sortByPriority", () => {
  it("sorts items highest priority first", () => {
    const items: FeedItem[] = [
      { ...makeItem({ globalId: "low" }), priority: 10 },
      { ...makeItem({ globalId: "high" }), priority: 90 },
      { ...makeItem({ globalId: "mid" }), priority: 50 },
    ];

    const sorted = sortByPriority(items);

    expect(sorted[0].globalId).toBe("high");
    expect(sorted[1].globalId).toBe("mid");
    expect(sorted[2].globalId).toBe("low");
  });

  it("treats undefined priority as 0", () => {
    const items: FeedItem[] = [
      { ...makeItem({ globalId: "noprio" }) }, // no priority
      { ...makeItem({ globalId: "highprio" }), priority: 80 },
    ];

    const sorted = sortByPriority(items);
    expect(sorted[0].globalId).toBe("highprio");
  });

  it("does not mutate the original array", () => {
    const items: FeedItem[] = [
      { ...makeItem({ globalId: "b" }), priority: 10 },
      { ...makeItem({ globalId: "a" }), priority: 90 },
    ];
    const originalFirst = items[0].globalId;

    sortByPriority(items);

    expect(items[0].globalId).toBe(originalFirst);
  });
});

// =============================================================================
// filterFeedItems
// =============================================================================

describe("filterFeedItems", () => {
  const items: FeedItem[] = [
    makeItem({ globalId: "visible-rss", platform: "rss", userState: { hidden: false, saved: false, archived: false, tags: ["tech"] } }),
    makeItem({ globalId: "visible-x", platform: "x", userState: { hidden: false, saved: true, archived: false, tags: [] } }),
    makeItem({ globalId: "hidden", platform: "rss", userState: { hidden: true, saved: false, archived: false, tags: [] } }),
    makeItem({ globalId: "archived", platform: "rss", userState: { hidden: false, saved: false, archived: true, tags: [] } }),
  ];

  it("filters out hidden items by default", () => {
    const result = filterFeedItems(items);
    expect(result.find((i) => i.globalId === "hidden")).toBeUndefined();
  });

  it("includes hidden items when showHidden is true", () => {
    const result = filterFeedItems(items, { showHidden: true });
    expect(result.find((i) => i.globalId === "hidden")).toBeDefined();
  });

  it("filters out archived items by default", () => {
    const result = filterFeedItems(items);
    expect(result.find((i) => i.globalId === "archived")).toBeUndefined();
  });

  it("includes archived items when showArchived is true", () => {
    const result = filterFeedItems(items, { showArchived: true });
    expect(result.find((i) => i.globalId === "archived")).toBeDefined();
  });

  it("filters by platform", () => {
    const result = filterFeedItems(items, { platform: "x" });
    expect(result.every((i) => i.platform === "x")).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("filters to saved only", () => {
    const result = filterFeedItems(items, { savedOnly: true });
    expect(result.every((i) => i.userState.saved)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].globalId).toBe("visible-x");
  });

  it("filters by tag (any match)", () => {
    const result = filterFeedItems(items, { tags: ["tech"] });
    expect(result).toHaveLength(1);
    expect(result[0].globalId).toBe("visible-rss");
  });

  it("returns all visible items when no filters specified", () => {
    const result = filterFeedItems(items);
    expect(result).toHaveLength(2); // hidden and archived excluded
    expect(result.map((i) => i.globalId)).toContain("visible-rss");
    expect(result.map((i) => i.globalId)).toContain("visible-x");
  });

  it("returns empty array when no items match", () => {
    const result = filterFeedItems(items, { platform: "youtube" });
    expect(result).toHaveLength(0);
  });

  it("combines filters (platform + savedOnly)", () => {
    const result = filterFeedItems(items, { platform: "x", savedOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].globalId).toBe("visible-x");
  });
});
