import { describe, expect, it } from "vitest";
import { friendForAuthor, generateSampleLibraryData } from "@freed/shared";

describe("sample data batches", () => {
  it("appends unique friend, feed, and item ids across batches", () => {
    const batchA = generateSampleLibraryData({ batchId: "batch-a", seed: 1 });
    const batchB = generateSampleLibraryData({ batchId: "batch-b", seed: 2 });

    expect(batchA.friends).toHaveLength(25);
    expect(batchB.friends).toHaveLength(25);
    expect(batchA.items).toHaveLength(195);
    expect(batchB.items).toHaveLength(195);

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

    expect(friendIds.size).toBe(50);
    expect(itemIds.size).toBe(390);
    expect(feedUrls.size).toBe(30);
  });

  it("keeps friend source links aligned with the generated social posts", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-c", seed: 3 });
    const friendMap = Object.fromEntries(batch.friends.map((friend) => [friend.id, friend]));

    const linkedItems = batch.items.filter((item) =>
      friendForAuthor(friendMap, item.platform, item.author.id)
    );

    expect(linkedItems.length).toBeGreaterThan(0);
  });

  it("includes LinkedIn posts that are linked to sample friends", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-linkedin", seed: 9 });
    const friendMap = Object.fromEntries(batch.friends.map((friend) => [friend.id, friend]));

    const linkedInItems = batch.items.filter((item) => item.platform === "linkedin");
    const linkedFriendItems = linkedInItems.filter((item) =>
      friendForAuthor(friendMap, item.platform, item.author.id)
    );

    expect(linkedInItems).toHaveLength(10);
    expect(linkedFriendItems.length).toBeGreaterThan(0);
    expect(batch.friends.some((friend) =>
      friend.sources.some((source) => source.platform === "linkedin")
    )).toBe(true);
  });
});
