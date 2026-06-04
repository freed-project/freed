import { describe, expect, it } from "vitest";
import type { Account, Person, RssFeed } from "@freed/shared";
import { buildIdentityGraphAtlas } from "./identity-graph-atlas.js";
import type { IdentityGraphActivitySummaries } from "./identity-graph-activity-summary.js";

function person(index: number): Person {
  return {
    id: `person-${index}`,
    name: `Person ${index}`,
    relationshipStatus: index % 5 === 0 ? "connection" : "friend",
    careLevel: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    createdAt: 1,
    updatedAt: 1,
  };
}

function account(index: number): Account {
  const provider = index % 3 === 0 ? "instagram" : index % 3 === 1 ? "x" : "linkedin";
  return {
    id: `account-${index}`,
    personId: index < 800 ? `person-${index % 500}` : undefined,
    kind: "social",
    provider,
    externalId: `author-${index}`,
    handle: `author-${index}`,
    displayName: `Author ${index}`,
    firstSeenAt: 1,
    lastSeenAt: index + 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("buildIdentityGraphAtlas", () => {
  it("returns a capped overview atlas instead of the full graph payload", () => {
    const persons = Array.from({ length: 500 }, (_, index) => person(index));
    const accounts = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, index) => {
        const entry = account(index);
        return [entry.id, entry];
      }),
    );
    const feeds = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `https://example.com/${index}.xml`,
        {
          url: `https://example.com/${index}.xml`,
          title: `Feed ${index}`,
          enabled: true,
          trackUnread: true,
        } satisfies RssFeed,
      ]),
    );
    const activitySummaries: IdentityGraphActivitySummaries = {
      social: Object.fromEntries(
        Array.from({ length: 2_000 }, (_, index) => [
          `${account(index).provider}:author-${index}`,
          {
            itemCount: 8,
            latestActivityAt: index + 1,
            sampleItemIds: [`item-${index}`],
            hasLocation: false,
            avatarUrl: null,
          },
        ]),
      ),
      rss: {},
      buildMs: 0,
      itemCount: 16_000,
    };

    const atlas = buildIdentityGraphAtlas({
      persons,
      accounts,
      feeds,
      activitySummaries,
      mode: "all_content",
      transform: { x: 0, y: 0, scale: 0.25 },
      width: 390,
      height: 760,
      quality: "interactive",
    });

    expect(atlas.metrics.sourceNodeCount).toBeGreaterThan(2_000);
    expect(atlas.nodes.length).toBeLessThanOrEqual(160);
    expect(atlas.labels).toHaveLength(0);
    expect(atlas.metrics.capped).toBe(true);
    expect(atlas.metrics.lod).toBe("overview");
  });

  it("keeps selected nodes visible even when the atlas is capped", () => {
    const persons = Array.from({ length: 400 }, (_, index) => person(index));
    const accounts = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => {
        const entry = account(index);
        return [entry.id, entry];
      }),
    );
    const activitySummaries: IdentityGraphActivitySummaries = {
      social: {},
      rss: {},
      buildMs: 0,
      itemCount: 0,
    };

    const atlas = buildIdentityGraphAtlas({
      persons,
      accounts,
      feeds: {},
      activitySummaries,
      mode: "all_content",
      transform: { x: 0, y: 0, scale: 0.2 },
      width: 390,
      height: 760,
      quality: "settled",
      selectedPersonId: "person-399",
    });

    expect(atlas.nodes.some((node) => node.personId === "person-399")).toBe(true);
  });
});
