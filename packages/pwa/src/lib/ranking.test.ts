/**
 * Unit tests for the shared per-item ranking transform.
 */

import { describe, it, expect } from "vitest";
import { calculatePriority } from "@freed/shared";
import type {
  Account,
  FeedItem,
  Person,
  WeightPreferences,
} from "@freed/shared";

// =============================================================================
// Test fixtures
// =============================================================================

const baseWeights: WeightPreferences = {
  recency: 50,
  platforms: {},
  authors: {},
  topics: {},
};

function makeItem(
  overrides: Partial<FeedItem> & { globalId: string },
): FeedItem {
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
    const old = makeItem({
      globalId: "old",
      publishedAt: NOW - 1000 * 60 * 60 * 100,
    }); // 100 hours ago

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
    const unsaved = makeItem({
      globalId: "unsaved",
      publishedAt: NOW - 1000 * 60 * 60 * 24,
    });
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
    const itemFav = makeItem({
      globalId: "fav",
      publishedAt: NOW - 1000 * 60 * 60 * 10,
    });
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
      calculatePriority(b, baseWeights, NOW),
    );
  });

  it("keeps old-item priority stable while refreshing the recent window", () => {
    const old = makeItem({
      globalId: "old-stable",
      publishedAt: NOW - 30 * 24 * 60 * 60 * 1_000,
    });
    const recent = makeItem({
      globalId: "recent-decay",
      publishedAt: NOW - 60 * 60 * 1_000,
    });

    expect(calculatePriority(old, baseWeights, NOW + 365 * 24 * 60 * 60 * 1_000)).toBe(
      calculatePriority(old, baseWeights, NOW),
    );
    expect(
      calculatePriority(recent, baseWeights, NOW + 48 * 60 * 60 * 1_000),
    ).toBeLessThan(calculatePriority(recent, baseWeights, NOW));
  });

  it("boosts Fam content more than regular friend content", () => {
    const baseItem = makeItem({
      globalId: "friend-item",
      platform: "instagram",
      author: {
        id: "friend-author",
        handle: "friend",
        displayName: "Friend Author",
      },
      publishedAt: NOW - 1000 * 60 * 60,
    });
    const famItem = makeItem({
      globalId: "fam-item",
      platform: "instagram",
      author: { id: "fam-author", handle: "fam", displayName: "Fam Author" },
      publishedAt: baseItem.publishedAt,
    });
    const followedItem = makeItem({
      globalId: "followed-item",
      platform: "instagram",
      author: {
        id: "followed-author",
        handle: "followed",
        displayName: "Followed Author",
      },
      publishedAt: baseItem.publishedAt,
    });
    const persons: Record<string, Person> = {
      "friend-person": {
        id: "friend-person",
        name: "Friend Person",
        relationshipStatus: "friend",
        careLevel: 3,
        createdAt: NOW,
        updatedAt: NOW,
      },
      "fam-person": {
        id: "fam-person",
        name: "Fam Person",
        relationshipStatus: "friend",
        careLevel: 5,
        createdAt: NOW,
        updatedAt: NOW,
      },
      "followed-person": {
        id: "followed-person",
        name: "Followed Person",
        relationshipStatus: "connection",
        careLevel: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    };
    const accounts: Record<string, Account> = {
      "social:instagram:friend-author": {
        id: "social:instagram:friend-author",
        personId: "friend-person",
        kind: "social",
        provider: "instagram",
        externalId: "friend-author",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        discoveredFrom: "captured_item",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "social:instagram:fam-author": {
        id: "social:instagram:fam-author",
        personId: "fam-person",
        kind: "social",
        provider: "instagram",
        externalId: "fam-author",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        discoveredFrom: "captured_item",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "social:instagram:followed-author": {
        id: "social:instagram:followed-author",
        personId: "followed-person",
        kind: "social",
        provider: "instagram",
        externalId: "followed-author",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        discoveredFrom: "captured_item",
        createdAt: NOW,
        updatedAt: NOW,
      },
    };

    const friendScore = calculatePriority(baseItem, baseWeights, NOW, {
      persons,
      accounts,
    });
    const famScore = calculatePriority(famItem, baseWeights, NOW, {
      persons,
      accounts,
    });
    const followedScore = calculatePriority(followedItem, baseWeights, NOW, {
      persons,
      accounts,
    });

    expect(famScore).toBeGreaterThan(friendScore);
    expect(friendScore).toBeGreaterThan(followedScore);
  });
});
