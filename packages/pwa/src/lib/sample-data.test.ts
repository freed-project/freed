import { describe, expect, it, vi } from "vitest";
import * as corpus from "../../../shared/src/sample-corpus.js";
import {
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
  SAMPLE_SHOWCASE_UNLINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_CURATED_DEMO_MEDIA,
  SAMPLE_CHARACTER_ARCS,
  SAMPLE_CHARACTER_AVATAR_MEDIA,
  SAMPLE_STRESS_FRIEND_COUNT,
  SAMPLE_STRESS_LINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT,
  SAMPLE_STRESS_UNLINKED_SOCIAL_IDENTITY_COUNT,
  generateSampleLibraryData,
  hasSampleDataFingerprint,
} from "@freed/shared";

function linkedSampleAuthorKeys(
  persons: readonly { id: string }[],
  accounts: readonly {
    externalId: string;
    personId?: string;
    provider: string;
  }[],
): Set<string> {
  const personIds = new Set(persons.map((person) => person.id));
  return new Set(
    accounts
      .filter(
        (account) =>
          account.personId !== undefined && personIds.has(account.personId),
      )
      .map((account) => `${account.provider}:${account.externalId}`),
  );
}

describe("sample data batches", () => {
  it("bounds exhausted template work in deterministic stress fixtures", () => {
    const text = vi.spyOn(corpus, "sampleCorpusGeneratedText")
      .mockReturnValue("I am a fixed synthetic fixture.");
    const options = {
      batchId: "exhausted-template-pool",
      seed: 11,
      generatedAt: 123,
      scale: "stress" as const,
      friendCount: 1,
      identitiesPerFriend: 1,
      unlinkedIdentityRatio: 0,
    };
    try {
      const first = generateSampleLibraryData(options);
      expect(text).toHaveBeenCalledTimes(1 + (first.items.length - 1) * 64);
      expect(new Set(first.items.map((item) => item.content.text)).size).toBe(first.items.length);
      expect(first.items[0]?.content.text).toBe("I am a fixed synthetic fixture.");
      expect(first.items[1]?.content.text).toBe("I am a fixed synthetic fixture.\n\n[Synthetic benchmark entry 2]");
      expect(first.items.every((item) => item.content.mediaUrls.length === 1)).toBe(true);
      const second = generateSampleLibraryData(options);
      expect(second).toEqual(first);
    } finally {
      text.mockRestore();
    }
  });

  it("appends unique friend, feed, and item ids across batches", () => {
    const batchA = generateSampleLibraryData({ batchId: "batch-a", seed: 1 });
    const batchB = generateSampleLibraryData({ batchId: "batch-b", seed: 2 });

    expect(generateSampleLibraryData({ batchId: "repeat", seed: 1, generatedAt: 123 })).toEqual(
      generateSampleLibraryData({ batchId: "repeat", seed: 1, generatedAt: 123 }),
    );
    expect(batchA.persons).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(batchB.persons).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(batchA.items).toHaveLength(SAMPLE_SHOWCASE_ITEM_COUNT);
    expect(batchB.items).toHaveLength(SAMPLE_SHOWCASE_ITEM_COUNT);

    const personIds = new Set([
      ...batchA.persons.map((person) => person.id),
      ...batchB.persons.map((person) => person.id),
    ]);
    const itemIds = new Set([
      ...batchA.items.map((item) => item.globalId),
      ...batchB.items.map((item) => item.globalId),
    ]);
    const feedUrls = new Set([
      ...batchA.feeds.map((feed) => feed.url),
      ...batchB.feeds.map((feed) => feed.url),
    ]);

    expect(personIds.size).toBe(SAMPLE_SHOWCASE_FRIEND_COUNT * 2);
    expect(itemIds.size).toBe(SAMPLE_SHOWCASE_ITEM_COUNT * 2);
    expect(feedUrls.size).toBe(SAMPLE_SHOWCASE_FEED_COUNT * 2);
  });

  it("keeps Person and Account links aligned with generated social posts", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-c", seed: 3 });
    const linkedAuthorKeys = linkedSampleAuthorKeys(
      batch.persons,
      batch.accounts,
    );

    const linkedItems = batch.items.filter((item) =>
      linkedAuthorKeys.has(`${item.platform}:${item.author.id}`),
    );

    expect(linkedItems.length).toBeGreaterThan(0);
  });

  it("fingerprints every sample record and supplies an image for every item", () => {
    const batch = generateSampleLibraryData({
      batchId: "batch-fingerprint",
      generatedAt: 123,
      seed: 5,
    });
    expect(batch.feeds.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.items.every(hasSampleDataFingerprint)).toBe(true);
    // Every showcase record needs a thumbnail source, not just Instagram.
    expect(batch.items.some((item) => item.contentType === "post")).toBe(true);
    expect(batch.items.some((item) => item.contentType === "story")).toBe(true);
    for (const item of batch.items) {
      expect(item.content.mediaTypes[0], item.globalId).toBe("image");
      expect(item.content.mediaUrls[0], item.globalId).toMatch(/^https:\/\//);
      const url = new URL(item.content.mediaUrls[0]!);
      expect(url.hostname, item.globalId).not.toBe("");
      // NPS download suffixes can return HTML instead of a decodable image.
      if (url.hostname === "npgallery.nps.gov") {
        expect(url.pathname, item.globalId).toMatch(/\/GetAsset\/[^/]+\/(?:original|proxy(?:lo|md|hi)res)$/);
      }
    }
    expect(batch.persons.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.accounts.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.items[0]?.sampleDataFingerprint).toEqual({
      marker: "freed.sample-data.v1",
      batchId: "batch-fingerprint",
      generatedAt: 123,
      generatorVersion: 12,
    });
  });

  it("normalizes negative seeds when generating sample friends", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-negative", seed: -1 });

    expect(batch.persons).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(batch.persons.every((person) => person.id.includes(":person:"))).toBe(true);
    for (const seed of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(generateSampleLibraryData({ batchId: "numeric-seed", seed, presentationSeed: seed }).items).toHaveLength(SAMPLE_SHOWCASE_ITEM_COUNT);
    }
  });

  it("includes LinkedIn posts that are linked to sample friends", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-linkedin", seed: 9 });
    const linkedAuthorKeys = linkedSampleAuthorKeys(
      batch.persons,
      batch.accounts,
    );

    const linkedInItems = batch.items.filter((item) => item.platform === "linkedin");
    const linkedFriendItems = linkedInItems.filter((item) =>
      linkedAuthorKeys.has(`${item.platform}:${item.author.id}`),
    );

    expect(linkedInItems.length).toBeGreaterThan(10);
    expect(linkedFriendItems.length).toBeGreaterThan(0);
    expect(batch.accounts.some((account) =>
      account.personId && account.provider === "linkedin"
    )).toBe(true);
  });

  it("includes timestamped map entries for past, current, and future location tests", () => {
    const now = Date.now();
    const batch = generateSampleLibraryData({ batchId: "batch-map-time", seed: 10, scale: "stress", friendCount: 5 });
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
    const linkedIdentityCount = batch.accounts.filter((account) => account.personId).length;
    const unlinkedIdentityCount = batch.accounts.filter((account) => !account.personId).length;

    expect(batch.persons).toHaveLength(SAMPLE_STRESS_FRIEND_COUNT);
    expect(linkedIdentityCount).toBe(SAMPLE_STRESS_LINKED_SOCIAL_IDENTITY_COUNT);
    expect(unlinkedIdentityCount).toBe(SAMPLE_STRESS_UNLINKED_SOCIAL_IDENTITY_COUNT);
    expect(batch.accounts).toHaveLength(SAMPLE_STRESS_SOCIAL_IDENTITY_COUNT);
    expect(batch.items.every((item) => item.content.mediaUrls.length === 1)).toBe(true);
    expect(new Set(batch.items.map((item) => item.content.text ?? "")).size).toBe(batch.items.length);
    expect(batch.items.every((item) => /\b(?:I|my|me)\b/i.test(item.content.text ?? ""))).toBe(true);
  });

  it("documents the showcase social identity count across linked and unlinked accounts", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-showcase", seed: 13 });
    const linkedIdentityCount = batch.accounts.filter((account) => account.personId).length;
    const unlinkedAccounts = batch.accounts.filter((account) => !account.personId);

    expect(linkedIdentityCount).toBe(SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT);
    expect(unlinkedAccounts).toHaveLength(SAMPLE_SHOWCASE_UNLINKED_SOCIAL_IDENTITY_COUNT);
    expect(batch.accounts).toHaveLength(SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT);
    expect(unlinkedAccounts.every((account) => batch.items.some((item) =>
      item.platform === account.provider && item.author.id === account.externalId
    ))).toBe(true);
  });

  it("projects only accepted episodes with exact prose, portraits and source credits", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-corpus", seed: 17 });
    const expected = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes
      .filter((episode) => episode.mediaSha1 !== null)
      .map((episode) => ({ arc, episode })));
    expect(batch.items).toHaveLength(expected.length);
    expect(new Set(batch.items.map((item) => item.content.mediaUrls[0])).size).toBe(expected.length);
    for (const { arc, episode } of expected) {
      const item = batch.items.find((candidate) => candidate.globalId.endsWith(`:${episode.mediaSha1}`))!;
      const asset = SAMPLE_CURATED_DEMO_MEDIA.find((candidate) => candidate.sha1 === episode.mediaSha1)!;
      expect(item, episode.title).toBeDefined();
      expect(item.platform).toBe(episode.platform ?? arc.platform);
      expect(item.content.linkPreview?.title).toBe(episode.title);
      expect(item.content.mediaUrls).toEqual([asset.imageUrl]);
      expect(item.author.displayName).toBe(arc.identityNameBase);
      expect(item.author.avatarUrl).toBe(SAMPLE_CHARACTER_AVATAR_MEDIA.get(arc.characterId)?.imageUrl);
      expect(item.location?.name).toBe(arc.location?.name);
      if (episode.video) {
        expect(item.contentType).toBe("video");
        expect(item.sourceUrl).toBe(episode.video.watchUrl);
        expect(item.content.text).toBe(`${episode.body}\n\nOriginal video: ${episode.video.title}\nUploaded by ${episode.video.uploader}: ${episode.video.channelUrl}\nSource: ${episode.video.primarySourceUrl}\nThumbnail by ${asset.creator}, ${asset.license}.\nThumbnail source: ${asset.sourceUrl}`);
      } else {
        expect(item.content.text).toBe(episode.body);
      }
    }
    expect(batch.feeds.every((feed) => !feed.enabled && feed.url.startsWith("https://sample.freed.wtf/"))).toBe(true);
    expect(batch.items.every((item) => !item.timeRange)).toBe(true);
    for (const arc of SAMPLE_CHARACTER_ARCS) {
      const timeline = arc.episodes.filter((episode) => episode.mediaSha1 !== null)
        .map((episode) => batch.items.find((item) => item.globalId.endsWith(`:${episode.mediaSha1}`))!.publishedAt);
      expect(timeline).toEqual([...timeline].sort((left, right) => left - right));
    }
    const now = batch.items[0]!.capturedAt;
    expect(batch.items.filter((item) => item.contentType === "story").every((item) =>
      item.publishedAt < now && item.publishedAt > now - 22 * 3_600_000
    )).toBe(true);
  });

  it("gives every Instagram post an image and distinct copy", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-instagram", seed: 19 });
    const instagramPosts = batch.items.filter((item) =>
      item.platform === "instagram" && item.contentType === "post"
    );

    expect(instagramPosts.length).toBe(SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes.filter((episode) => episode.mediaSha1 && (episode.platform ?? arc.platform) === "instagram" && (episode.contentType ?? "post") === "post")).length);
    expect(instagramPosts.every((item) =>
      item.content.mediaTypes.includes("image") && item.content.mediaUrls.length > 0
    )).toBe(true);
    const authorsByCaption = new Map<string, Set<string>>();
    for (const item of instagramPosts) {
      const caption = item.content.text ?? "";
      const authors = authorsByCaption.get(caption) ?? new Set<string>();
      authors.add(item.author.id);
      authorsByCaption.set(caption, authors);
    }
    const duplicatedAcrossAuthors = [...authorsByCaption.entries()]
      .filter(([, authors]) => authors.size > 1)
      .map(([caption, authors]) => ({ caption, authors: [...authors] }));
    expect(duplicatedAcrossAuthors).toEqual([]);
  });

  it("randomizes presentation timing without rewriting authored content", () => {
    const baseOptions = {
      batchId: "batch-presentation",
      generatedAt: Date.UTC(2026, 8, 1, 12),
      seed: 23,
    } as const;
    const first = generateSampleLibraryData({
      ...baseOptions,
      presentationSeed: 91,
    });
    const firstTop = [...first.items]
      .filter((item) =>
        item.contentType !== "story" &&
        !item.userState.archived &&
        !item.userState.hidden
      )
      .sort((left, right) =>
        right.publishedAt - left.publishedAt || left.globalId.localeCompare(right.globalId)
      )[0]!;
    const next = generateSampleLibraryData({
      ...baseOptions,
      presentationSeed: 91,
      previousTopItemId: firstTop.globalId,
    });
    const nextTop = [...next.items]
      .filter((item) =>
        item.contentType !== "story" &&
        !item.userState.archived &&
        !item.userState.hidden
      )
      .sort((left, right) =>
        right.publishedAt - left.publishedAt || left.globalId.localeCompare(right.globalId)
      )[0]!;
    const firstById = new Map(first.items.map((item) => [item.globalId, item]));

    expect(nextTop.globalId).not.toBe(firstTop.globalId);
    expect(next.items.every((item) => {
      const original = firstById.get(item.globalId);
      if (!original) return false;
      return original.content.text === item.content.text &&
        original.content.mediaUrls[0] === item.content.mediaUrls[0] &&
        original.author.displayName === item.author.displayName;
    })).toBe(true);
    expect(next.items.filter((item) => item.timeRange).map((item) => item.timeRange)).toEqual(
      first.items.filter((item) => item.timeRange).map((item) => item.timeRange),
    );
  });
});
