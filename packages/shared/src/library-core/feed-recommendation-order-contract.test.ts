import { describe, expect, it } from "vitest";

import {
  sortLibraryCoreFeedRecommendationV1,
} from "./feed-recommendation-order-contract.js";
import {
  rankFeedItems,
  rankFeedItemsInRecommendedOrder,
} from "../ranking.js";
import type { FeedItem, WeightPreferences } from "../types.js";

const NOW = 1_780_000_000_000;

function item(
  globalId: string,
  publishedAt: number,
  priority?: number,
): FeedItem {
  return {
    author: {
      displayName: globalId,
      handle: globalId,
      id: `author:${globalId}`,
    },
    capturedAt: NOW,
    content: { mediaTypes: [], mediaUrls: [], text: globalId },
    contentType: "post",
    globalId,
    platform: "x",
    priority,
    publishedAt,
    topics: [],
    userState: {
      archived: false,
      hidden: false,
      saved: false,
      tags: [],
    },
  } as FeedItem;
}

function legacyOrder(items: FeedItem[]): FeedItem[] {
  return [...items]
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .sort(
      (left, right) =>
        (right.priority ?? 0) - (left.priority ?? 0),
    );
}

function previousWorkerOrder(
  items: FeedItem[],
  preferences: WeightPreferences,
): FeedItem[] {
  const publishedAtOrdered = [...items].sort(
    (left, right) => right.publishedAt - left.publishedAt,
  );
  const ranked = rankFeedItems(
    publishedAtOrdered,
    preferences,
    undefined,
    NOW,
  );
  return [...ranked].sort(
    (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
  );
}

describe("Library Core recommendation-order contract", () => {
  it("reproduces priority, published time, and source-sequence ordering", () => {
    const source = [
      item("source-first", NOW - 2, 50),
      item("newer-low", NOW, 20),
      item("source-second", NOW - 2, 50),
      item("newest-high", NOW + 1, 50),
      item("missing-priority", NOW + 10),
    ];

    const expected = legacyOrder(source).map(({ globalId }) => globalId);
    const actual = sortLibraryCoreFeedRecommendationV1([...source]).map(
      ({ globalId }) => globalId,
    );

    expect(actual).toStrictEqual(expected);
    expect(actual).toStrictEqual([
      "newest-high",
      "source-first",
      "source-second",
      "newer-low",
      "missing-priority",
    ]);
  });

  it("matches the previous worker composition across deterministic corpus rows", () => {
    const preferences = {
      authors: { "author:x:4": 100 },
      platforms: { x: 60 },
      recency: 50,
      topics: { essay: 80 },
    } as WeightPreferences;
    const source = Array.from({ length: 256 }, (_, index) => {
      const value = item(
        `x:${index.toString().padStart(3, "0")}`,
        NOW - (index % 17) * 60_000,
      );
      if (index % 5 === 0) value.topics = ["essay"];
      if (index % 7 === 0) value.userState.saved = true;
      return value;
    });

    const previous = previousWorkerOrder(source, preferences).map(
      ({ globalId }) => globalId,
    );
    const current = rankFeedItemsInRecommendedOrder(
      [...source],
      preferences,
      undefined,
      NOW,
    ).map(({ globalId }) => globalId);

    expect(current).toStrictEqual(previous);
  });
});
