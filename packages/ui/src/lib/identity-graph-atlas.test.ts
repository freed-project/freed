import { describe, expect, it } from "vitest";
import type { Account, Person, RssFeed } from "@freed/shared";
import {
  buildIdentityGraphAtlas,
  buildIdentityGraphAtlasModel,
  sliceIdentityGraphAtlas,
} from "./identity-graph-atlas.js";
import type { IdentityGraphActivitySummaries } from "./identity-graph-activity-summary.js";
import { compileIdentityGalaxyScene } from "./identity-galaxy-scene.js";

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
  it("keeps the full semantic star scene resident while capping viewport detail", () => {
    const persons = Array.from({ length: 240 }, (_, index) => person(index));
    const accounts = Object.fromEntries(
      Array.from({ length: 900 }, (_, index) => {
        const entry = account(index);
        return [entry.id, entry];
      }),
    );
    const model = buildIdentityGraphAtlasModel({
      persons,
      accounts,
      feeds: {},
      activitySummaries: { social: {}, rss: {}, buildMs: 0, itemCount: 0 },
      mode: "all_content",
      width: 390,
      height: 760,
    });
    const viewportAtlas = sliceIdentityGraphAtlas({
      model,
      transform: { x: 0, y: 0, scale: 0.25 },
      width: 390,
      height: 760,
      quality: "interactive",
    });
    const scene = compileIdentityGalaxyScene({
      nodes: model.nodes,
      edges: viewportAtlas.edges,
    }, { quality: "interactive", now: 1_000 });

    expect(model.nodes.length).toBeGreaterThan(viewportAtlas.nodes.length);
    expect(viewportAtlas.nodes.length).toBeLessThanOrEqual(160);
    expect(scene.nodeIds).toHaveLength(model.nodes.length);
    expect(scene.positions).toHaveLength(model.nodes.length * 3);
    expect(scene.edgeIndices).toHaveLength(0);
  });

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

  it("packs linked accounts into tight fields around their person", () => {
    const linkedPerson = {
      ...person(1),
      careLevel: 5,
      relationshipStatus: "friend",
    } satisfies Person;
    const linkedAccounts = Array.from({ length: 32 }, (_, index) => ({
      ...account(index),
      id: `linked-account-${index}`,
      personId: linkedPerson.id,
      externalId: `linked-author-${index}`,
      handle: `linked-author-${index}`,
      displayName: `Linked Author ${index}`,
    } satisfies Account));
    const atlas = buildIdentityGraphAtlas({
      persons: [linkedPerson],
      accounts: Object.fromEntries(linkedAccounts.map((entry) => [entry.id, entry])),
      feeds: {},
      activitySummaries: {
        social: {},
        rss: {},
        buildMs: 0,
        itemCount: 0,
      },
      mode: "all_content",
      transform: { x: 0, y: 0, scale: 1 },
      width: 1_400,
      height: 900,
      quality: "settled",
    });

    const personNode = atlas.nodes.find((node) => node.personId === linkedPerson.id);
    expect(personNode).toBeDefined();
    const accountNodes = atlas.nodes.filter((node) => node.linkedPersonId === linkedPerson.id);
    expect(accountNodes).toHaveLength(linkedAccounts.length);
    const maxAccountDistance = Math.max(
      ...accountNodes.map((node) => Math.hypot(node.x - personNode!.x, node.y - personNode!.y)),
    );
    expect(maxAccountDistance).toBeLessThanOrEqual(personNode!.radius + 55);
  });
});
