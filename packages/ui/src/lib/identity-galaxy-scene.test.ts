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
  it("keeps rating size and brightness while randomizing shallow depth independently", () => {
    const nodes = Array.from({ length: 5 }, (_, index) => {
      const careLevel = (index + 1) as 1 | 2 | 3 | 4 | 5;
      return node(`person:care-${careLevel}`, {
        personId: `care-${careLevel}`,
        careLevel,
        radius: 40 + careLevel * 8,
        priority: 900 + careLevel * 40,
        activityCount: 0,
      });
    });
    const scene = compileIdentityGalaxyScene(atlas(nodes), { quality: "settled", now: 1_000 });
    const depths = nodes.map((_, index) => scene.positions[index * 3 + 2]!);

    for (let index = 1; index < nodes.length; index += 1) {
      expect(scene.pointSizes[index]).toBeGreaterThan(scene.pointSizes[index - 1]!);
      expect(scene.brightness[index]).toBeGreaterThan(scene.brightness[index - 1]!);
    }
    expect(new Set(depths).size).toBe(5);
    expect(depths.every(depth => depth >= -165 && depth <= -35)).toBe(true);
    const changedRatings = compileIdentityGalaxyScene(atlas(nodes.map(n => ({ ...n, careLevel: 1, priority: 940 }))), { quality: "settled", now: 1_000 });
    expect(nodes.map((_, index) => changedRatings.positions[index * 3 + 2])).toEqual(depths);
  });

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

  it("places linked planets at exactly their star's depth", () => {
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

    expect([famDepth, activeFriendDepth, activeConnectionDepth].every(z => z >= -165 && z <= -35)).toBe(true);
    expect(linkedAccountDepth).toBe(famDepth);
  });

  it("preserves world-space account orbits, depth and explicit pins", () => {
    const parent = node("person:shell", { personId: "shell", careLevel: 4 });
    const profiles = Array.from({ length: 6 }, (_, index) => {
      const angle = index * Math.PI / 3;
      return node(`account:shell-${index}`, {
        kind: "account", accountId: `shell-${index}`, linkedPersonId: "shell",
        x: parent.x + Math.cos(angle) * 60,
        y: parent.y + Math.sin(angle) * 54,
      });
    });
    const pinned = node("account:pinned", {
      kind: "account", accountId: "pinned", linkedPersonId: "shell",
      graphPinned: true, x: 270, y: 310,
    });
    const orphan = node("account:orphan", {
      kind: "account", accountId: "orphan", linkedPersonId: "missing", x: 420, y: 510,
    });
    const input = atlas([...profiles, parent, pinned, orphan]);
    const scene = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });
    const repeated = compileIdentityGalaxyScene(input, { quality: "settled", now: 1_000 });
    expect(scene.positions).toEqual(repeated.positions);
    profiles.forEach((profile, index) => {
      expect(scene.positions[index * 3]).toBeCloseTo(profile.x, 4);
      expect(scene.positions[index * 3 + 1]).toBeCloseTo(-profile.y, 4);
      expect(Math.abs(scene.positions[index * 3 + 2]! - scene.positions[6 * 3 + 2]!))
        .toBeLessThanOrEqual(3);
    });
    expect(new Set(profiles.map((_, index) =>
      `${scene.positions[index * 3]},${scene.positions[index * 3 + 1]}`)).size).toBe(6);
    expect([...scene.positions.slice(7 * 3, 7 * 3 + 2)]).toEqual([270, -310]);
    expect([...scene.positions.slice(8 * 3, 8 * 3 + 2)]).toEqual([420, -510]);
    expect(input.nodes[0]!.x).toBe(160);
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
    expect(Array.from(scene.positions.slice(0, 2))).toEqual([100, -200]);
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
