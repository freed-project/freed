import { describe, expect, it } from "vitest";
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
    expect(first.filter((record) => record.registryKey === "10_feed_item")).toHaveLength(45);
    expect(first.filter((record) => record.registryKey === "30_person")).toHaveLength(6);
    expect(first.filter((record) => record.registryKey === "40_account")).toHaveLength(6);
    expect(first.filter((record) => record.registryKey === "20_rss_feed")).toHaveLength(1);
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

    expect(importanceByName).toEqual({
      "Manny Tis": 5,
      "Cygnus Shy": 4,
      "Nudi Branch Manager": 3,
      "Frogbert Angler": 3,
      "Flora Mingo": 2,
      "Nova Remains": 1,
    });
    expect(people.every((record) => record.payload.relationshipStatus === "friend")).toBe(true);
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

  it("uses only the curated Wikimedia host for remote display images", () => {
    const serialized = JSON.stringify(createFreedDemoCheckpointRecords(FIXED_PRESENTATION));

    expect(serialized).not.toContain("picsum.photos");
    expect(serialized).toContain("thumb.wikimedia.org");
    expect(serialized).not.toMatch(
      /"(?:authorAvatarUrl|avatarUrl|imageUrl)":"https?:\/\/(?!thumb\.wikimedia\.org)[^"]+/i,
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
