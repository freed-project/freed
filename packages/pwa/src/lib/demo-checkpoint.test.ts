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
    expect(first.filter((record) => record.registryKey === "10_feed_item")).toHaveLength(521);
    expect(first.filter((record) => record.registryKey === "30_person")).toHaveLength(80);
  });

  it("creates a small inner circle and substantial provider neighborhoods", () => {
    const records = createFreedDemoCheckpointRecords(FIXED_PRESENTATION);
    const people = records.filter((record) => record.registryKey === "30_person");
    const unlinkedAccounts = records.filter((record) =>
      record.registryKey === "40_account" && record.payload.personId === null
    );
    const providerCounts = new Map<string, number>();
    for (const account of unlinkedAccounts) {
      const provider = String(account.payload.provider);
      providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
    }

    expect(people.filter((record) => record.payload.careLevel === 5)).toHaveLength(5);
    expect([...providerCounts.keys()].sort()).toEqual(["facebook", "instagram", "linkedin", "rss", "x"]);
    expect([...providerCounts.values()].every((count) => count === 32)).toBe(true);
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
