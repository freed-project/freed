import { describe, expect, it } from "vitest";
import {
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
  SAMPLE_SHOWCASE_UNLINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_STRESS_FRIEND_COUNT,
  SAMPLE_STRESS_LINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT,
  SAMPLE_STRESS_UNLINKED_SOCIAL_IDENTITY_COUNT,
  friendForAuthor,
  generateSampleLibraryData,
  hasSampleDataFingerprint,
  personFromLegacyFriend,
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

  it("fingerprints every generated sample record", () => {
    const batch = generateSampleLibraryData({
      batchId: "batch-fingerprint",
      generatedAt: 123,
      seed: 5,
    });
    const people = batch.friends.map(personFromLegacyFriend);
    const accounts = batch.accounts;

    expect(batch.feeds.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.items.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.friends.every(hasSampleDataFingerprint)).toBe(true);
    expect(people.every(hasSampleDataFingerprint)).toBe(true);
    expect(accounts.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.items[0]?.sampleDataFingerprint).toEqual({
      marker: "freed.sample-data.v1",
      batchId: "batch-fingerprint",
      generatedAt: 123,
      generatorVersion: 2,
    });
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

  it("includes timestamped map entries for past, current, and future location tests", () => {
    const now = Date.now();
    const batch = generateSampleLibraryData({ batchId: "batch-map-time", seed: 10 });
    const locationItems = batch.items.filter((item) =>
      item.globalId.includes("sample-location-window:")
    );

    expect(locationItems).toHaveLength(6);
    expect(locationItems.every((item) => item.location?.coordinates)).toBe(true);
    expect(locationItems.every((item) => item.timeRange)).toBe(true);
    expect(locationItems.some((item) => item.timeRange && item.timeRange.endsAt && item.timeRange.endsAt < now)).toBe(true);
    expect(locationItems.some((item) =>
      item.timeRange &&
      item.timeRange.startsAt <= now &&
      (item.timeRange.endsAt ?? item.timeRange.startsAt) >= now
    )).toBe(true);
    expect(locationItems.some((item) => item.timeRange && item.timeRange.startsAt > now)).toBe(true);
  });

  it("can generate the benchmark stress identity graph population", () => {
    const batch = generateSampleLibraryData({
      batchId: "batch-stress",
      seed: 11,
      scale: "stress",
    });
    const linkedIdentityCount = batch.friends.reduce(
      (total, friend) => total + friend.sources.length,
      0,
    );
    const unlinkedIdentityCount = batch.accounts.filter((account) => !account.personId).length;

    expect(batch.friends).toHaveLength(SAMPLE_STRESS_FRIEND_COUNT);
    expect(linkedIdentityCount).toBe(SAMPLE_STRESS_LINKED_SOCIAL_IDENTITY_COUNT);
    expect(unlinkedIdentityCount).toBe(SAMPLE_STRESS_UNLINKED_SOCIAL_IDENTITY_COUNT);
    expect(batch.accounts).toHaveLength(SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT);
  });

  it("documents the showcase social identity count across linked and unlinked accounts", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-showcase", seed: 13 });
    const linkedIdentityCount = batch.friends.reduce(
      (total, friend) => total + friend.sources.length,
      0,
    );
    const unlinkedAccounts = batch.accounts.filter((account) => !account.personId);

    expect(linkedIdentityCount).toBe(SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT);
    expect(unlinkedAccounts).toHaveLength(SAMPLE_SHOWCASE_UNLINKED_SOCIAL_IDENTITY_COUNT);
    expect(batch.accounts).toHaveLength(SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT);
    expect(new Set(unlinkedAccounts.map((account) => account.provider))).toEqual(
      new Set(["instagram", "x", "facebook", "linkedin", "rss"]),
    );
    expect(unlinkedAccounts.every((account) => batch.items.some((item) =>
      item.platform === account.provider && item.author.id === account.externalId
    ))).toBe(true);
  });
});
