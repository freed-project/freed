import { describe, expect, it } from "vitest";
import {
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
  SAMPLE_STRESS_FRIEND_COUNT,
  SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT,
  friendForAuthor,
  generateSampleLibraryData,
} from "@freed/shared";

describe("sample data batches", () => {
  it("appends unique friend, feed, and item ids across batches", () => {
    const batchA = generateSampleLibraryData({ batchId: "batch-a", seed: 1 });
    const batchB = generateSampleLibraryData({ batchId: "batch-b", seed: 2 });

    expect(batchA.friends).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(batchB.friends).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(batchA.items).toHaveLength(SAMPLE_SHOWCASE_ITEM_COUNT);
    expect(batchB.items).toHaveLength(SAMPLE_SHOWCASE_ITEM_COUNT);

    const friendIds = new Set([
      ...batchA.friends.map((friend) => friend.id),
      ...batchB.friends.map((friend) => friend.id),
    ]);
    const itemIds = new Set([
      ...batchA.items.map((item) => item.globalId),
      ...batchB.items.map((item) => item.globalId),
    ]);
    const feedUrls = new Set([
      ...batchA.feeds.map((feed) => feed.url),
      ...batchB.feeds.map((feed) => feed.url),
    ]);

    expect(friendIds.size).toBe(SAMPLE_SHOWCASE_FRIEND_COUNT * 2);
    expect(itemIds.size).toBe(SAMPLE_SHOWCASE_ITEM_COUNT * 2);
    expect(feedUrls.size).toBe(SAMPLE_SHOWCASE_FEED_COUNT * 2);
  });

  it("keeps friend source links aligned with the generated social posts", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-c", seed: 3 });
    const friendMap = Object.fromEntries(batch.friends.map((friend) => [friend.id, friend]));

    const linkedItems = batch.items.filter((item) =>
      friendForAuthor(friendMap, item.platform, item.author.id)
    );

    expect(linkedItems.length).toBeGreaterThan(0);
  });

  it("normalizes negative seeds when generating sample friends", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-negative", seed: -1 });

    expect(batch.friends).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(batch.friends.every((friend) => friend.id.includes("sample-friend-"))).toBe(true);
  });

  it("includes LinkedIn posts that are linked to sample friends", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-linkedin", seed: 9 });
    const friendMap = Object.fromEntries(batch.friends.map((friend) => [friend.id, friend]));

    const linkedInItems = batch.items.filter((item) => item.platform === "linkedin");
    const linkedFriendItems = linkedInItems.filter((item) =>
      friendForAuthor(friendMap, item.platform, item.author.id)
    );

    expect(linkedInItems.length).toBeGreaterThan(10);
    expect(linkedFriendItems.length).toBeGreaterThan(0);
    expect(batch.friends.some((friend) =>
      friend.sources.some((source) => source.platform === "linkedin")
    )).toBe(true);
  });

  it("can generate the benchmark stress identity graph population", () => {
    const batch = generateSampleLibraryData({
      batchId: "batch-stress",
      seed: 11,
      scale: "stress",
    });
    const identityCount = batch.friends.reduce(
      (total, friend) => total + friend.sources.length,
      0,
    );

    expect(batch.friends).toHaveLength(SAMPLE_STRESS_FRIEND_COUNT);
    expect(identityCount).toBe(SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT);
  });

  it("documents the showcase social identity count in generated friends", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-showcase", seed: 13 });
    const identityCount = batch.friends.reduce(
      (total, friend) => total + friend.sources.length,
      0,
    );

    expect(identityCount).toBe(SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT);
  });
});
