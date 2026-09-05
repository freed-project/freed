import { describe, expect, it } from "vitest";
import { SAMPLE_CHARACTER_ARCS } from "@freed/shared";
import { libraryCoreNormalizedCheckpointSqlitePayloadV2 } from "@freed/shared/library-core";
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
    expect(first.filter((record) => record.registryKey === "10_feed_item")).toHaveLength(500);
    expect(first.filter((record) => record.registryKey === "30_person")).toHaveLength(52);
    expect(first.filter((record) => record.registryKey === "40_account")).toHaveLength(52);
    expect(first.filter((record) => record.registryKey === "20_rss_feed")).toHaveLength(15);
  });

  it("links every recurring character to one person and provider account", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const people = records.filter((record) => record.registryKey === "30_person");
    const accounts = records.filter((record) => record.registryKey === "40_account");
    const items = records.filter((record) => record.registryKey === "10_feed_item");
    const personIds = new Set(people.map((record) => String(record.primaryKey)));
    const accountIds = new Set(accounts.map((record) => String(record.payload.externalId)));

    expect(new Set(accounts.map((record) => record.payload.provider))).toEqual(
      new Set(["facebook", "instagram", "linkedin", "rss", "x"]),
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
      "Alma Eight": 4,
      "Mora Grey": 2,
      "Colm Still": 1,
    });
    expect(people.every((record) => Number.isInteger(record.payload.careLevel) &&
      Number(record.payload.careLevel) >= 1 && Number(record.payload.careLevel) <= 5)).toBe(true);
    const reshuffled = createFreedDemoCheckpointRecords({ ...FIXED_PRESENTATION, presentationSeed: 99 })
      .filter((record) => record.registryKey === "30_person");
    expect(reshuffled.map((record) => [record.primaryKey, record.payload.careLevel]))
      .toEqual(people.map((record) => [record.primaryKey, record.payload.careLevel]));
    expect(people.every((record) => record.payload.relationshipStatus === "friend")).toBe(true);
  });

  it("preserves complete long stories and registers each RSS character's feed", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const feeds = new Set(records.filter((record) => record.registryKey === "20_rss_feed")
      .map((record) => record.primaryKey));
    const articles = records.filter((record) => record.registryKey === "10_feed_item" &&
      record.payload.contentType === "article");
    expect(articles).toHaveLength(145);
    expect(articles.every((record) => feeds.has(record.payload.rssFeedUrl as string))).toBe(true);
    const alma = articles.filter((record) => record.payload.authorDisplayName === "Alma Eight");
    expect(alma).toHaveLength(8);
    expect(alma.every((record) => String(record.payload.contentText).includes("\n\n"))).toBe(true);
  });

  it("keeps text-only episodes without inventing photographs, avatars or attribution", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const items = records.filter((record) => record.registryKey === "10_feed_item");
    const media = records.filter((record) => record.registryKey === "11_feed_item_media");
    let textOnlyCount = 0;
    let charactersWithoutImages = 0;
    for (const arc of SAMPLE_CHARACTER_ARCS) {
      const hasPhoto = arc.episodes.some((episode) => episode.mediaSha1 !== null);
      for (const [sequence, episode] of arc.episodes.entries()) {
        const item = items.find((record) => String(record.primaryKey).endsWith(`:sample-character:${arc.characterId}:${sequence}`));
        expect(item).toBeDefined();
        expect(item!.payload.contentText).toBe(episode.body);
        expect(item!.payload.linkTitle).toBe(episode.title);
        if (episode.mediaSha1 === null) {
          textOnlyCount += 1;
          expect(media.some((record) => Array.isArray(record.primaryKey) && record.primaryKey[0] === item!.primaryKey)).toBe(false);
          expect(item!.payload.linkDescription).toBeNull();
          expect(item!.payload.sourceUrl).toBe(`https://demo.freed.wtf/?item=${encodeURIComponent(String(item!.primaryKey))}`);
        }
        if (!hasPhoto) expect(item!.payload.authorAvatarUrl).toBeNull();
      }
      if (!hasPhoto) {
        charactersWithoutImages += 1;
        const person = records.find((record) => record.registryKey === "30_person" && record.payload.name === arc.identityNameBase);
        const account = records.find((record) => record.registryKey === "40_account" && record.payload.displayName === arc.identityNameBase);
        expect(person!.payload.avatarUrl).toBeNull();
        expect(account!.payload.avatarUrl).toBeNull();
      }
    }
    expect(textOnlyCount).toBeGreaterThan(0);
    expect(charactersWithoutImages).toBeGreaterThan(0);
  });

  it("places marine characters at their authored seabed homes, not missing photo coordinates", () => {
    const items = createFreedDemoCheckpointRecords(FIXED_PRESENTATION)
      .filter((record) => record.registryKey === "10_feed_item");
    for (const [name, lat, lng] of [
      ["Frogbert Angler", 1.46, 125.235],
      ["Alma Eight", 43.473, -3.753],
      ["Mora Grey", 13.758, 120.909],
    ] as const) {
      const episodes = items.filter((record) => record.payload.authorDisplayName === name);
      expect(episodes.length).toBeGreaterThan(0);
      expect(episodes.map(libraryCoreNormalizedCheckpointSqlitePayloadV2)
        .map((payload) => [payload.locationLat, payload.locationLng]))
        .toEqual(episodes.map(() => [lat, lng]));
    }
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
        const episode = Number(String(record.primaryKey).split(":").at(-1));
        episodeNumbersByAuthor.set(authorId, [...(episodeNumbersByAuthor.get(authorId) ?? []), episode]);
      }
      for (const episodeNumbers of episodeNumbersByAuthor.values()) {
        expect(episodeNumbers).toEqual([...episodeNumbers].sort((left, right) => right - left));
      }
    }
  });

  it("uses only curated Wikimedia hosts for remote display images", () => {
    const serialized = JSON.stringify(createFreedDemoCheckpointRecords(FIXED_PRESENTATION));

    expect(serialized).not.toContain("picsum.photos");
    expect(serialized).toContain("thumb.wikimedia.org");
    expect(serialized).not.toMatch(
      /"(?:authorAvatarUrl|avatarUrl|imageUrl)":"https?:\/\/(?!(?:thumb|upload)\.wikimedia\.org)[^"]+/i,
    );
    expect(serialized).not.toMatch(/private[_-]?key/i);
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
