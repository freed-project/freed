import { describe, expect, it } from "vitest";
import {
  SAMPLE_SHOWCASE_FEED_COUNT,
  SAMPLE_SHOWCASE_FRIEND_COUNT,
  SAMPLE_SHOWCASE_ITEM_COUNT,
  SAMPLE_SHOWCASE_LINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT,
  SAMPLE_SHOWCASE_UNLINKED_SOCIAL_IDENTITY_COUNT,
  SAMPLE_CORPUS_MEDIA,
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
  it("appends unique friend, feed, and item ids across batches", () => {
    const batchA = generateSampleLibraryData({ batchId: "batch-a", seed: 1 });
    const batchB = generateSampleLibraryData({ batchId: "batch-b", seed: 2 });

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

  it("fingerprints every generated sample record", () => {
    const batch = generateSampleLibraryData({
      batchId: "batch-fingerprint",
      generatedAt: 123,
      seed: 5,
    });
    expect(batch.feeds.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.items.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.persons.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.accounts.every(hasSampleDataFingerprint)).toBe(true);
    expect(batch.items[0]?.sampleDataFingerprint).toEqual({
      marker: "freed.sample-data.v1",
      batchId: "batch-fingerprint",
      generatedAt: 123,
      generatorVersion: 11,
    });
  });

  it("normalizes negative seeds when generating sample friends", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-negative", seed: -1 });

    expect(batch.persons).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(batch.persons.every((person) => person.id.includes("sample-friend-"))).toBe(true);
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
    expect(new Set(unlinkedAccounts.map((account) => account.provider))).toEqual(
      new Set(["instagram", "x", "facebook", "linkedin", "rss"]),
    );
    expect(unlinkedAccounts.every((account) => batch.items.some((item) =>
      item.platform === account.provider && item.author.id === account.externalId
    ))).toBe(true);
  });

  it("custom authors the entire shared corpus with unique matching imagery", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-corpus", seed: 17 });
    const imageItems = batch.items.filter((item) => item.content.mediaUrls.length > 0);

    expect(imageItems).toHaveLength(batch.items.length);
    expect(new Set(batch.items.map((item) => item.content.text ?? "")).size).toBe(batch.items.length);
    const authoredSentences = batch.items.flatMap((item) =>
      (item.content.text ?? "").split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
    );
    const sentenceCounts = new Map<string, number>();
    for (const sentence of authoredSentences) {
      sentenceCounts.set(sentence, (sentenceCounts.get(sentence) ?? 0) + 1);
    }
    const duplicatedSentences = [...sentenceCounts.entries()]
      .filter(([, count]) => count > 1)
      .slice(0, 20);
    expect(duplicatedSentences).toEqual([]);
    expect(imageItems.every((item) => item.content.mediaUrls.every((url) =>
      new URL(url).hostname === "thumb.wikimedia.org"
    ))).toBe(true);
    expect(new Set(imageItems.map((item) => item.platform))).toEqual(
      new Set(["facebook", "instagram", "linkedin", "rss", "saved", "x"]),
    );
    expect(new Set(imageItems.map((item) => item.content.mediaUrls[0])).size).toBe(batch.items.length);
    expect(new Set(batch.items.map((item) => item.author.displayName)).size).toBe(batch.items.length);
    expect(new Set(batch.items.map((item) => item.content.linkPreview?.title)).size).toBe(batch.items.length);
    const bannedTechnologyLanguage = /\b(?:algorithm|computer|database|dashboard|design system|digital|email|group chat|hardware|internet|notification|roadmap|server|software|status page|version control|webinar)\b/i;
    expect(batch.items.filter((item) => bannedTechnologyLanguage.test(item.content.text ?? ""))).toEqual([]);
    expect(batch.items.some((item) => item.platform === "instagram" && /equal billing|effortless beauty|good side/i.test(item.content.text ?? ""))).toBe(true);
    expect(batch.items.some((item) => item.platform === "facebook" && /will not be taking corrections|wetlands tribunal|unpopular opinion/i.test(item.content.text ?? ""))).toBe(true);
    expect(batch.items.some((item) => item.platform === "linkedin" && /major milestone|promoted|leadership philosophy|high-impact deliverable/i.test(item.content.text ?? ""))).toBe(true);
    expect(batch.items.some((item) => item.platform === "x" && /null hypothesis|uncontrolled variable|peer review|effect size/i.test(item.content.text ?? ""))).toBe(true);
    expect(batch.items.filter((item) => /^[^.!?]{1,32}:/.test(item.content.text ?? ""))).toEqual([]);
    const openingStructures = new Set(batch.items.map((item) =>
      (item.content.text ?? "").toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).slice(0, 4).join(" ")
    ));
    expect(openingStructures.size).toBeGreaterThan(300);
    const publicationItems = batch.items.filter((item) => item.platform === "rss");
    for (const publication of ["Substack", "Medium", "YouTube"] as const) {
      const channelItems = publicationItems.filter((item) => item.rssSource?.feedTitle.includes(publication));
      expect(channelItems).toHaveLength(40);
      expect(new Set(channelItems.map((item) => item.content.text ?? "")).size).toBe(channelItems.length);
    }
    const xPostLengths = batch.items
      .filter((item) => item.platform === "x")
      .map((item) => (item.content.text ?? "").length);
    expect(Math.max(...xPostLengths)).toBeLessThanOrEqual(280);
    const locatedItems = batch.items.filter((item) => item.location?.coordinates);
    expect(locatedItems.length).toBeGreaterThanOrEqual(96);
    expect(locatedItems.every((item) => item.content.mediaUrls.length > 0)).toBe(true);

    for (const item of imageItems) {
      const asset = SAMPLE_CORPUS_MEDIA.find((candidate) =>
        item.content.mediaUrls.some((url) => url.startsWith(candidate.baseUrl))
      );
      expect(asset, item.globalId).toBeDefined();
      const displayTitle = item.content.linkPreview?.title;
      expect(displayTitle, item.globalId).toBeTruthy();
      expect(item.content.text, item.globalId).not.toContain(displayTitle!);
      if (item.location && asset?.placeId) {
        expect(item.location.name, item.globalId).toBe(displayTitle);
      }
    }
  });

  it("gives every Instagram post an image and distinct copy", () => {
    const batch = generateSampleLibraryData({ batchId: "batch-instagram", seed: 19 });
    const instagramPosts = batch.items.filter((item) =>
      item.platform === "instagram" && item.contentType === "post"
    );

    expect(instagramPosts.length).toBeGreaterThan(250);
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
