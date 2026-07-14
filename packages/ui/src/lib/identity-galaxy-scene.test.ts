import { describe, expect, it } from "vitest";
import type {
  IdentityGraphAtlas,
  IdentityGraphAtlasNode,
} from "./identity-graph-atlas.js";
import {
  compileIdentityGalaxyContextEdgeIndices,
  compileIdentityGalaxyScene,
  IdentityGalaxyColorRole,
  IdentityGalaxyNodeFlag,
  IdentityGalaxyNodeKindCode,
  updateIdentityGalaxySceneInteraction,
} from "./identity-galaxy-scene.js";
import {
  identityGalaxySceneTransferables,
  identityGalaxyWorkerResponseTransferables,
} from "./identity-galaxy-worker-protocol.js";

function node(
  id: string,
  overrides: Partial<IdentityGraphAtlasNode> = {},
): IdentityGraphAtlasNode {
  return {
    id,
    kind: "friend_person",
    label: id,
    x: 100,
    y: 200,
    radius: 24,
    priority: 940,
    activityCount: 0,
    ...overrides,
  };
}

function atlas(
  nodes: IdentityGraphAtlasNode[],
  edges: IdentityGraphAtlas["edges"] = [],
): IdentityGraphAtlas {
  return {
    nodes,
    edges,
    regions: [],
    labels: [],
    hitBuckets: [],
    bounds: { left: 0, right: 400, top: 0, bottom: 400 },
    metrics: {
      sourceNodeCount: nodes.length,
      visibleNodeCount: nodes.length,
      renderedPrimitiveCount: nodes.length + edges.length,
      visibleLabelCount: 0,
      clusterNodeCount: 0,
      lod: "detail",
      capped: false,
      buildMs: 0,
    },
  };
}

describe("compileIdentityGalaxyScene", () => {
  it("builds compact typed buffers with stable node and edge indices", () => {
    const input = atlas(
      [
        node("person:one", { personId: "one", careLevel: 4 }),
        node("account:one", {
          kind: "account",
          accountId: "account-one",
          linkedPersonId: "one",
          provider: "instagram",
          x: 130,
          y: 220,
          radius: 12,
          priority: 430,
        }),
      ],
      [{ id: "edge:one", sourceId: "person:one", targetId: "account:one" }],
    );

    const scene = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });

    expect(scene.nodeIds).toEqual(["person:one", "account:one"]);
    expect(scene.positions).toBeInstanceOf(Float32Array);
    expect(scene.positions).toHaveLength(6);
    expect(scene.positions[0]).toBe(100);
    expect(scene.positions[1]).toBe(-200);
    expect(scene.kinds).toEqual(new Uint8Array([
      IdentityGalaxyNodeKindCode.FriendPerson,
      IdentityGalaxyNodeKindCode.Account,
    ]));
    expect(scene.colorRoles).toEqual(new Uint8Array([
      IdentityGalaxyColorRole.Friend,
      IdentityGalaxyColorRole.Account,
    ]));
    expect(scene.edgeIndices).toEqual(new Uint32Array([0, 1]));
  });

  it("keeps relationship and care dominant while placing linked accounts behind people", () => {
    const input = atlas([
      node("person:fam", {
        personId: "fam",
        careLevel: 5,
        priority: 1_100,
        activityCount: 0,
      }),
      node("person:friend", {
        personId: "friend",
        careLevel: 1,
        priority: 940,
        activityCount: 100_000,
      }),
      node("person:connection", {
        kind: "connection_person",
        personId: "connection",
        priority: 560,
        activityCount: 100_000,
      }),
      node("account:fam", {
        kind: "account",
        accountId: "account-fam",
        linkedPersonId: "fam",
        priority: 440,
        activityCount: 100_000,
      }),
    ]);

    const scene = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });
    const famDepth = scene.positions[2]!;
    const activeFriendDepth = scene.positions[5]!;
    const activeConnectionDepth = scene.positions[8]!;
    const linkedAccountDepth = scene.positions[11]!;

    expect(famDepth).toBeGreaterThan(activeFriendDepth);
    expect(activeFriendDepth).toBeGreaterThan(activeConnectionDepth);
    expect(linkedAccountDepth).toBeLessThan(famDepth - 40);
  });

  it("encodes transient interaction state without changing stable positions", () => {
    const input = atlas([
      node("person:selected", {
        personId: "selected",
        careLevel: 3,
        graphPinned: true,
      }),
      node("account:hovered", {
        kind: "account",
        accountId: "hovered",
        linkedPersonId: "selected",
        friendSuggestionConfidence: "high",
      }),
    ]);
    const scene = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });
    const positions = scene.positions;
    const edgeIndices = scene.edgeIndices;
    const basePointSize = scene.pointSizes[0]!;
    updateIdentityGalaxySceneInteraction(scene, {
      quality: "interactive",
      selectedPersonId: "selected",
      hoveredNodeId: "account:hovered",
      now: 1_000,
    });

    expect(scene.positions).toBe(positions);
    expect(scene.edgeIndices).toBe(edgeIndices);
    expect(scene.flags[0]! & IdentityGalaxyNodeFlag.Selected).not.toBe(0);
    expect(scene.flags[0]! & IdentityGalaxyNodeFlag.Pinned).not.toBe(0);
    expect(scene.flags[1]! & IdentityGalaxyNodeFlag.Hovered).not.toBe(0);
    expect(scene.flags[1]! & IdentityGalaxyNodeFlag.LinkedToSelection).not.toBe(0);
    expect(scene.flags[1]! & IdentityGalaxyNodeFlag.SuggestedHigh).not.toBe(0);
    expect(scene.pointSizes[0]).toBeGreaterThan(basePointSize);
  });

  it("reveals only the hovered or selected identity constellation edges", () => {
    const input = atlas(
      [
        node("person:alpha", { personId: "alpha" }),
        node("account:alpha-one", {
          kind: "account",
          accountId: "alpha-one",
          linkedPersonId: "alpha",
        }),
        node("account:alpha-two", {
          kind: "account",
          accountId: "alpha-two",
          linkedPersonId: "alpha",
        }),
        node("person:beta", { personId: "beta" }),
        node("account:beta-one", {
          kind: "account",
          accountId: "beta-one",
          linkedPersonId: "beta",
        }),
      ],
      [
        { id: "edge:alpha-one", sourceId: "person:alpha", targetId: "account:alpha-one" },
        { id: "edge:alpha-two", sourceId: "person:alpha", targetId: "account:alpha-two" },
        { id: "edge:beta-one", sourceId: "person:beta", targetId: "account:beta-one" },
      ],
    );
    const scene = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });

    expect(compileIdentityGalaxyContextEdgeIndices(scene)).toHaveLength(0);

    updateIdentityGalaxySceneInteraction(scene, {
      quality: "settled",
      hoveredNodeId: "account:alpha-one",
      now: 1_000,
    });
    expect(compileIdentityGalaxyContextEdgeIndices(scene)).toEqual(new Uint32Array([0, 1, 0, 2]));

    updateIdentityGalaxySceneInteraction(scene, {
      quality: "settled",
      selectedAccountId: "beta-one",
      now: 1_000,
    });
    expect(compileIdentityGalaxyContextEdgeIndices(scene)).toEqual(new Uint32Array([3, 4]));
  });

  it("exposes each typed scene buffer exactly once for worker transfer", () => {
    const scene = compileIdentityGalaxyScene(atlas([
      node("person:transfer", { personId: "transfer", careLevel: 3 }),
    ]), { quality: "settled", now: 1_000 });

    const transferables = identityGalaxySceneTransferables(scene);

    expect(transferables).toHaveLength(10);
    expect(new Set(transferables).size).toBe(transferables.length);
    expect(transferables).toContain(scene.positions.buffer);
    expect(transferables).toContain(scene.edgeIndices.buffer);
  });

  it("transfers only the edge patch for a cached worker viewport response", () => {
    const edgeIndices = new Uint32Array([0, 1]);
    const response = {
      requestId: 2,
      sourceRevision: 1,
      atlas: atlas([]),
      edgeIndices,
      durationMs: 0,
    };

    expect(identityGalaxyWorkerResponseTransferables(response)).toEqual([edgeIndices.buffer]);
  });

  it("is deterministic for the same atlas and clock", () => {
    const input = atlas([
      node("person:stable", {
        personId: "stable",
        careLevel: 4,
        activityCount: 12,
        latestActivityAt: 500,
      }),
    ]);

    const first = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });
    const second = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });

    expect(second.positions).toEqual(first.positions);
    expect(second.prominence).toEqual(first.prominence);
    expect(second.brightness).toEqual(first.brightness);
    expect(second.bounds).toEqual(first.bounds);
  });
});
