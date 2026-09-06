import { SAMPLE_CHARACTER_ARCS, SAMPLE_CORPUS_MEDIA, SAMPLE_SHOWCASE_ITEM_COUNT, SAMPLE_SHOWCASE_FRIEND_COUNT, SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT, SAMPLE_SHOWCASE_FEED_COUNT } from "@freed/shared";
// This suite checks canonical record construction, not database activation.
vi.mock("./library-core-sqlite-runtime", () => ({}));
import { describe, expect, it, vi } from "vitest";
import { createFreedDemoCheckpointRecords } from "./demo-checkpoint";

describe("demo checkpoint", () => {
  const FIXED_PRESENTATION = {
    generatedAt: Date.UTC(2026, 8, 1, 12),
    presentationSeed: 42,
  } as const;

  it("builds the same curated local showcase for an explicit presentation", () => {
    const first = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const second = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);

    expect(second).toEqual(first);
    expect(first.filter((record) => record.registryKey === "10_feed_item")).toHaveLength(SAMPLE_SHOWCASE_ITEM_COUNT);
    expect(first.filter((record) => record.registryKey === "30_person")).toHaveLength(SAMPLE_SHOWCASE_FRIEND_COUNT);
    expect(first.filter((record) => record.registryKey === "40_account")).toHaveLength(SAMPLE_SHOWCASE_SOCIAL_IDENTITY_COUNT);
    expect(first.filter((record) => record.registryKey === "20_rss_feed")).toHaveLength(SAMPLE_SHOWCASE_FEED_COUNT);
  });

  it("links every recurring character to one person and provider account", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const people = records.filter((record) => record.registryKey === "30_person");
    const accounts = records.filter((record) => record.registryKey === "40_account");
    const items = records.filter((record) => record.registryKey === "10_feed_item");
    const personIds = new Set(people.map((record) => String(record.primaryKey)));
    const accountIds = new Set(accounts.map((record) => String(record.payload.externalId)));

    expect(new Set(accounts.map((record) => record.payload.provider))).toEqual(
      new Set(["facebook", "instagram", "linkedin", "rss", "x", "youtube", "medium", "substack"]),
    );
    expect(accounts.every((record) => personIds.has(String(record.payload.personId)))).toBe(true);
    expect(items.every((record) => accountIds.has(String(record.payload.authorId)))).toBe(true);
  });

  it("assigns every recurring character an explicit one-to-five importance level", () => {
    const people = createFreedDemoCheckpointRecords(FIXED_PRESENTATION)
      .filter((record) => record.registryKey === "30_person");
    const importanceByName = Object.fromEntries(
      people.map((record) => [String(record.payload.name), record.payload.careLevel]),
    );

    expect(importanceByName).toMatchObject({
      "Manny Tis": 5,
      "Cygnus Shy": 4,
      "Nudi Branch Manager": 3,
      "Frogbert Angler": 3,
      "Flora Mingo": 2,
      "Nova Remains": 1,
    });
    expect(people.every((record) => record.payload.relationshipStatus === "friend" && Number(record.payload.careLevel) >= 1 && Number(record.payload.careLevel) <= 5)).toBe(true);
  });

  it("reshuffles characters while preserving every character's episode order", () => {
    const first = createFreedDemoCheckpointRecords(FIXED_PRESENTATION)
      .filter((record) => record.registryKey === "10_feed_item")
      .sort((left, right) => Number(right.payload.publishedAt) - Number(left.payload.publishedAt));
    const second = createFreedDemoCheckpointRecords({
      ...FIXED_PRESENTATION,
      presentationSeed: FIXED_PRESENTATION.presentationSeed + 1,
    })
      .filter((record) => record.registryKey === "10_feed_item")
      .sort((left, right) => Number(right.payload.publishedAt) - Number(left.payload.publishedAt));

    expect(second.map((record) => record.primaryKey)).not.toEqual(first.map((record) => record.primaryKey));
    expect(new Set(second.map((record) => record.primaryKey))).toEqual(
      new Set(first.map((record) => record.primaryKey)),
    );

    for (const records of [first, second]) {
      const episodeNumbersByAuthor = new Map<string, number[]>();
      for (const record of records) {
        const authorId = String(record.payload.authorId);
        const hash = String(record.primaryKey).split(":").at(-1);
        const arc = SAMPLE_CHARACTER_ARCS.find((candidate) => candidate.episodes.some((episode) => episode.mediaSha1 === hash))!;
        const episode = arc.episodes.findIndex((episode) => episode.mediaSha1 === hash);
        episodeNumbersByAuthor.set(authorId, [...(episodeNumbersByAuthor.get(authorId) ?? []), episode]);
      }
      for (const episodeNumbers of episodeNumbersByAuthor.values()) {
        expect(episodeNumbers).toEqual([...episodeNumbers].sort((left, right) => right - left));
      }
    }
  });

  it("preserves admitted media, Story classification and YouTube credits in canonical rows", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const acceptedUrls = new Set(SAMPLE_CORPUS_MEDIA.map((asset) => asset.imageUrl));
    for (const record of records) {
      for (const key of ["authorAvatarUrl", "avatarUrl", "imageUrl"]) {
        const value = record.payload[key];
        if (typeof value === "string") expect(acceptedUrls.has(value), value).toBe(true);
      }
      if (record.registryKey === "11_feed_item_media") expect(acceptedUrls.has(String(record.payload.sourceUrl))).toBe(true);
    }
    const items = records.filter((record) => record.registryKey === "10_feed_item");
    const expectedStories = SAMPLE_CHARACTER_ARCS.flatMap((arc) => arc.episodes.filter((episode) => episode.mediaSha1 && episode.contentType === "story"));
    expect(items.filter((record) => record.payload.contentType === "story")).toHaveLength(expectedStories.length);
    const giles = items.find((record) => record.payload.linkTitle === "I can swim")!;
    expect(giles.payload.platform).toBe("youtube");
    expect(giles.payload.contentType).toBe("video");
    expect(giles.payload.sourceUrl).toBe("https://www.youtube.com/watch?v=B2Aeck7lKNs");
    expect(giles.payload.contentText).toContain("\n\nOriginal video:");
    expect(giles.payload.contentText).toContain("\nUploaded by ");
    expect(giles.payload.contentText).toContain("\nThumbnail source: ");
    expect(records.filter((record) => record.registryKey === "20_rss_feed").every((record) => record.payload.enabled === false)).toBe(true);
  });

  it("avoids repeating the previous first item without changing the corpus", () => {
    const first = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const firstItems = first.filter((record) =>
      record.registryKey === "10_feed_item" && record.payload.contentType !== "story"
    );
    const firstTop = [...firstItems].sort((left, right) =>
      Number(right.payload.publishedAt) - Number(left.payload.publishedAt) ||
      String(left.primaryKey).localeCompare(String(right.primaryKey))
    )[0]!;
    const next = createFreedDemoCheckpointRecords({
      ...FIXED_PRESENTATION,
      previousTopItemId: String(firstTop.primaryKey),
    });
    const nextItems = next.filter((record) =>
      record.registryKey === "10_feed_item" && record.payload.contentType !== "story"
    );
    const nextTop = [...nextItems].sort((left, right) =>
      Number(right.payload.publishedAt) - Number(left.payload.publishedAt) ||
      String(left.primaryKey).localeCompare(String(right.primaryKey))
    )[0]!;

    expect(nextTop.primaryKey).not.toBe(firstTop.primaryKey);
    expect(new Set(nextItems.map((record) => record.primaryKey))).toEqual(
      new Set(firstItems.map((record) => record.primaryKey)),
    );
  });
});
