import { describe, expect, it } from "vitest";
import {
  GalaxyActivitySceneFlag,
  GalaxyActivityScenePatchEncoder,
} from "./activity-scene-patches.js";
import type { GalaxyActivitySummaryPatch } from "./activity-summary-index.js";

function summaryPatch(
  namespace: "social" | "rss",
  key: string,
  itemCount: number,
  options: { avatarUrl?: string; hasLocation?: boolean; latestActivityAt?: number } = {},
): GalaxyActivitySummaryPatch {
  return {
    namespace,
    key,
    summary: {
      itemCount,
      latestActivityAt: options.latestActivityAt ?? 1_725_000_000_000,
      sampleItemIds: ["sample"],
      hasLocation: options.hasLocation ?? false,
      avatarUrlCandidates: options.avatarUrl ? [options.avatarUrl] : [],
    },
  };
}

describe("Friends Galaxy activity scene patches", () => {
  it("encodes source summaries as a stable node-index payload", () => {
    const encoder = new GalaxyActivityScenePatchEncoder([
      { namespace: "social", key: "instagram:alpha", nodeIndex: 7 },
      { namespace: "rss", key: "https://example.com/feed.xml", nodeIndex: 2 },
    ]);

    const batch = encoder.encode([
      summaryPatch("social", "instagram:alpha", 12, {
        avatarUrl: "https://example.com/avatar.jpg",
      }),
      summaryPatch("rss", "https://example.com/feed.xml", 3, { hasLocation: true }),
    ], 9);

    expect(batch.revision).toBe(9);
    expect(Array.from(batch.nodeIndices)).toEqual([2, 7]);
    expect(Array.from(batch.itemCounts)).toEqual([3, 12]);
    expect(Array.from(batch.flags)).toEqual([
      GalaxyActivitySceneFlag.HasLocation,
      GalaxyActivitySceneFlag.HasAvatar,
    ]);
    expect(batch.avatarUrls).toEqual([null, "https://example.com/avatar.jpg"]);
    expect(batch.unknownSources).toEqual([]);
  });

  it("represents source removal without item or position payloads", () => {
    const encoder = new GalaxyActivityScenePatchEncoder([
      { namespace: "social", key: "x:removed", nodeIndex: 44 },
    ]);
    const batch = encoder.encode([{
      namespace: "social",
      key: "x:removed",
      summary: null,
    }], 10);

    expect(Array.from(batch.nodeIndices)).toEqual([44]);
    expect(Array.from(batch.itemCounts)).toEqual([0]);
    expect(Array.from(batch.latestActivityAt)).toEqual([0]);
    expect(Array.from(batch.flags)).toEqual([GalaxyActivitySceneFlag.Removed]);
    expect(batch.avatarUrls).toEqual([null]);
    expect(batch).not.toHaveProperty("positions");
    expect(batch).not.toHaveProperty("sampleItemIds");
  });

  it("fans one source patch out to duplicate scene representations", () => {
    const encoder = new GalaxyActivityScenePatchEncoder([
      { namespace: "rss", key: "feed", nodeIndex: 12 },
      { namespace: "rss", key: "feed", nodeIndex: 3 },
      { namespace: "rss", key: "feed", nodeIndex: 12 },
    ]);

    const batch = encoder.encode([summaryPatch("rss", "feed", 8)], 2);

    expect(Array.from(batch.nodeIndices)).toEqual([3, 12]);
    expect(Array.from(batch.itemCounts)).toEqual([8, 8]);
  });

  it("reports unknown sources for a structural atlas refresh", () => {
    const encoder = new GalaxyActivityScenePatchEncoder([
      { namespace: "social", key: "linkedin:known", nodeIndex: 5 },
    ]);

    const batch = encoder.encode([
      summaryPatch("social", "instagram:new", 4),
      summaryPatch("rss", "https://example.com/new.xml", 2),
    ], 3);

    expect(batch.nodeIndices).toHaveLength(0);
    expect(batch.unknownSources).toEqual([
      { namespace: "rss", key: "https://example.com/new.xml" },
      { namespace: "social", key: "instagram:new" },
    ]);
  });

  it("keeps a one-source update proportional with 25,000 bindings", () => {
    const bindings = Array.from({ length: 25_000 }, (_, nodeIndex) => ({
      namespace: "social" as const,
      key: `source-${nodeIndex}`,
      nodeIndex,
    }));
    const encoder = new GalaxyActivityScenePatchEncoder(bindings);

    const batch = encoder.encode([
      summaryPatch("social", "source-19999", 101, { latestActivityAt: 1_800_000_000_000 }),
    ], 71);

    expect(Array.from(batch.nodeIndices)).toEqual([19_999]);
    expect(Array.from(batch.itemCounts)).toEqual([101]);
    expect(batch.latestActivityAt[0]).toBe(1_800_000_000_000);
    expect(batch.unknownSources).toEqual([]);
  });
});
