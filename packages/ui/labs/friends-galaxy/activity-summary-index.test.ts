import { describe, expect, it } from "vitest";
import {
  diffFriendsGalaxyIdentityActivitySummaries,
  FriendsGalaxyActivitySummaryIndex,
  type FriendsGalaxyActivityContribution,
} from "../../src/lib/friends-galaxy-activity-index.js";

function contribution(
  globalId: string,
  publishedAt: number,
  overrides: Partial<FriendsGalaxyActivityContribution> = {},
): FriendsGalaxyActivityContribution {
  return {
    globalId,
    namespace: "social",
    key: "x:author-1",
    publishedAt,
    hasLocation: false,
    avatarUrl: null,
    ...overrides,
  };
}

describe("Friends Galaxy incremental activity summary index", () => {
  it("diffs legacy graph summaries into deterministic sparse product patches", () => {
    const previous = {
      social: {
        "x:author-1": {
          itemCount: 1,
          latestActivityAt: 10,
          sampleItemIds: ["item-1"],
          hasLocation: false,
          avatarUrl: null,
        },
      },
      rss: {},
      buildMs: 4,
      itemCount: 1,
    };
    const next = {
      social: {
        "x:author-1": {
          itemCount: 2,
          latestActivityAt: 20,
          sampleItemIds: ["item-2", "item-1"],
          hasLocation: true,
          avatarUrl: "https://images.test/author.png",
        },
      },
      rss: {
        "https://feed.test/rss.xml": {
          itemCount: 1,
          latestActivityAt: 15,
          sampleItemIds: ["rss-1"],
          hasLocation: false,
          avatarUrl: null,
        },
      },
      buildMs: 5,
      itemCount: 3,
    };

    expect(diffFriendsGalaxyIdentityActivitySummaries(previous, next)).toEqual([
      {
        namespace: "rss",
        key: "https://feed.test/rss.xml",
        summary: {
          itemCount: 1,
          latestActivityAt: 15,
          sampleItemIds: ["rss-1"],
          hasLocation: false,
          avatarUrlCandidates: [],
        },
      },
      {
        namespace: "social",
        key: "x:author-1",
        summary: {
          itemCount: 2,
          latestActivityAt: 20,
          sampleItemIds: ["item-2", "item-1"],
          hasLocation: true,
          avatarUrlCandidates: ["https://images.test/author.png"],
        },
      },
    ]);
  });

  it("builds deterministic samples and avatar candidates from unordered input", () => {
    const index = new FriendsGalaxyActivitySummaryIndex([
      contribution("item-c", 30, { avatarUrl: "https://images.test/c.png" }),
      contribution("item-b", 20, { hasLocation: true, avatarUrl: "https://images.test/b.png" }),
      contribution("item-d", 30, { avatarUrl: "https://images.test/d.png" }),
      contribution("item-a", 10, { avatarUrl: "https://images.test/b.png" }),
    ]);

    expect(index.snapshot().social["x:author-1"]).toEqual({
      itemCount: 4,
      latestActivityAt: 30,
      sampleItemIds: ["item-c", "item-d", "item-b"],
      hasLocation: true,
      avatarUrlCandidates: [
        "https://images.test/c.png",
        "https://images.test/d.png",
        "https://images.test/b.png",
      ],
    });
  });

  it("updates ordinary additions and non-leading removals without a rebuild scan", () => {
    const oldest = contribution("item-oldest", 1, { hasLocation: true });
    const index = new FriendsGalaxyActivitySummaryIndex([
      oldest,
      contribution("item-2", 2),
      contribution("item-3", 3),
      contribution("item-4", 4),
    ]);
    const added = contribution("item-5", 5);
    const unexpectedRebuild = () => {
      throw new Error("The constant-work path must not ask for a source rebuild.");
    };
    const addition = index.applyDeltas([{ previous: null, next: added }], unexpectedRebuild);
    const removal = index.applyDeltas([{ previous: oldest, next: null }], unexpectedRebuild);

    expect(addition.rebuiltSourceCount).toBe(0);
    expect(addition.rebuildContributionCount).toBe(0);
    expect(addition.patches[0]!.summary?.sampleItemIds).toEqual([
      "item-5",
      "item-4",
      "item-3",
    ]);
    expect(removal.rebuiltSourceCount).toBe(0);
    expect(removal.rebuildContributionCount).toBe(0);
    expect(removal.patches[0]!.summary).toMatchObject({
      itemCount: 4,
      hasLocation: false,
    });
  });

  it("rebuilds only an invalidated source when a leading candidate disappears", () => {
    const current = [
      contribution("item-1", 1),
      contribution("item-2", 2),
      contribution("item-3", 3),
      contribution("item-4", 4, { avatarUrl: "https://images.test/latest.png" }),
    ];
    const index = new FriendsGalaxyActivitySummaryIndex(current);
    const removed = current.pop()!;
    const rebuiltSources: string[][] = [];
    const result = index.applyDeltas(
      [{ previous: removed, next: null }],
      (sources) => {
        rebuiltSources.push(sources.map(({ namespace, key }) => `${namespace}:${key}`));
        return current;
      },
    );

    expect(rebuiltSources).toEqual([["social:x:author-1"]]);
    expect(result.rebuiltSourceCount).toBe(1);
    expect(result.rebuildContributionCount).toBe(3);
    expect(result.patches[0]!.summary).toMatchObject({
      itemCount: 3,
      latestActivityAt: 3,
      sampleItemIds: ["item-3", "item-2", "item-1"],
      avatarUrlCandidates: [],
    });
  });

  it("emits compact patches when an item moves between source namespaces", () => {
    const previous = contribution("item-1", 10);
    const next = contribution("item-1", 10, {
      namespace: "rss",
      key: "https://feed.test/rss.xml",
    });
    const index = new FriendsGalaxyActivitySummaryIndex([previous]);
    const result = index.applyDeltas([{ previous, next }], () => {
      throw new Error("Moving the sole source item must not require a rebuild.");
    });

    expect(result.patches).toEqual([
      {
        namespace: "rss",
        key: "https://feed.test/rss.xml",
        summary: {
          itemCount: 1,
          latestActivityAt: 10,
          sampleItemIds: ["item-1"],
          hasLocation: false,
          avatarUrlCandidates: [],
        },
      },
      { namespace: "social", key: "x:author-1", summary: null },
    ]);
    expect(result.changedItemCount).toBe(1);
    expect(result.itemCount).toBe(1);
  });

  it("returns isolated prototype-safe source snapshots", () => {
    const index = new FriendsGalaxyActivitySummaryIndex([
      contribution("item-1", 10, { key: "__proto__" }),
    ]);
    const first = index.snapshot();

    expect(Object.hasOwn(first.social, "__proto__")).toBe(true);
    expect(first.social["__proto__"]?.itemCount).toBe(1);
    first.social["__proto__"]!.sampleItemIds.push("external-mutation");
    expect(index.snapshot().social["__proto__"]?.sampleItemIds).toEqual(["item-1"]);
  });

  it("represents 250,000 items with 25,000 source summaries and constant-work additions", () => {
    function* stressContributions(): Iterable<FriendsGalaxyActivityContribution> {
      for (let sequence = 0; sequence < 10; sequence += 1) {
        for (let sourceIndex = 0; sourceIndex < 25_000; sourceIndex += 1) {
          yield contribution(`item-${sourceIndex}-${sequence}`, sequence, {
            key: `x:author-${sourceIndex}`,
            avatarUrl: `https://images.test/${sourceIndex}.png`,
          });
        }
      }
    }

    const index = new FriendsGalaxyActivitySummaryIndex(stressContributions());
    const snapshot = index.snapshot();
    expect(snapshot.itemCount).toBe(250_000);
    expect(Object.keys(snapshot.social)).toHaveLength(25_000);
    expect(snapshot.social["x:author-42"]!.sampleItemIds).toEqual([
      "item-42-9",
      "item-42-8",
      "item-42-7",
    ]);

    const result = index.applyDeltas(
      [{
        previous: null,
        next: contribution("item-42-10", 10, {
          key: "x:author-42",
          avatarUrl: "https://images.test/42.png",
        }),
      }],
      () => {
        throw new Error("Appending activity must not require a rebuild.");
      },
    );
    expect(result).toMatchObject({
      changedItemCount: 1,
      rebuiltSourceCount: 0,
      rebuildContributionCount: 0,
      itemCount: 250_001,
    });
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]!.summary?.sampleItemIds).toEqual([
      "item-42-10",
      "item-42-9",
      "item-42-8",
    ]);
  });
});
