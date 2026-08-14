import { describe, expect, it } from "vitest";
import { writeFriendsGalaxyWebGpuViewProjection } from "../../src/lib/friends-galaxy-camera.js";
import {
  friendsGalaxyLabelCap,
  friendsGalaxyLabelSourceKey,
  selectFriendsGalaxyVisibleLabelSeeds,
} from "../../src/lib/friends-galaxy-presentation.js";
import type { FriendsGalaxyLabelSeed } from "../../src/lib/friends-galaxy-billboard-atlas.js";
import { createGalaxyLabFixture } from "./scene-fixture.js";

function label(id: string, anchorX: number, priority = 1): FriendsGalaxyLabelSeed {
  return {
    id,
    nodeId: id,
    text: id,
    anchorX,
    anchorY: 0,
    anchorZ: 0,
    fontSize: 14,
    gapY: 10,
    priority,
    provider: false,
  };
}

function providerLabel(id: string): FriendsGalaxyLabelSeed {
  return {
    ...label(id, 0),
    provider: true,
  };
}

function projection(x: number) {
  const viewProjection = new Float32Array(16);
  writeFriendsGalaxyWebGpuViewProjection(
    viewProjection,
    { x, y: 240, scale: 1 },
    640,
    480,
  );
  return { viewProjection, width: 640, height: 480 };
}

describe("Friends Galaxy live label layout", () => {
  it("changes the visible roster with the current camera frame", () => {
    const seeds = [
      label("near-origin", 0, 3),
      label("near-right-field", 900, 2),
    ];

    expect(
      selectFriendsGalaxyVisibleLabelSeeds(
        seeds,
        false,
        "close",
        projection(320),
      ).map((entry) => entry.id),
    ).toEqual(["near-origin"]);
    expect(
      selectFriendsGalaxyVisibleLabelSeeds(
        seeds,
        false,
        "close",
        projection(-580),
      ).map((entry) => entry.id),
    ).toEqual(["near-right-field"]);
  });

  it("keeps each zoom density bounded on compact and wide viewports", () => {
    const seeds = Array.from({ length: 100 }, (_, index) =>
      label(`label-${index.toLocaleString()}`, index * 100, 100 - index));

    for (const compact of [false, true]) {
      for (const detail of ["overview", "middle", "close"] as const) {
        const selected = selectFriendsGalaxyVisibleLabelSeeds(
          seeds,
          compact,
          detail,
        );
        expect(selected.length).toBeLessThanOrEqual(
          friendsGalaxyLabelCap(compact, detail),
        );
      }
    }
  });

  it("does not exceed the density cap when providers consume it", () => {
    const cap = friendsGalaxyLabelCap(true, "overview");
    const seeds = [
      ...Array.from({ length: cap }, (_, index) =>
        providerLabel(`provider-${index.toLocaleString()}`)),
      label("semantic", 0, 1_000),
    ];

    expect(
      selectFriendsGalaxyVisibleLabelSeeds(seeds, true, "overview"),
    ).toHaveLength(cap);
  });

  it("invalidates the raster pool when worker label metadata changes", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 6,
      accountCount: 18,
      backgroundStarCount: 0,
    });
    const originalKey = friendsGalaxyLabelSourceKey(
      fixture,
      false,
      "middle",
      null,
    );
    const firstNode = fixture.atlas.nodes[0]!;
    const updatedFixture = {
      ...fixture,
      atlas: {
        ...fixture.atlas,
        nodes: [
          { ...firstNode, label: `${firstNode.label} updated` },
          ...fixture.atlas.nodes.slice(1),
        ],
      },
    };

    expect(friendsGalaxyLabelSourceKey(
      updatedFixture,
      false,
      "middle",
      null,
    )).not.toBe(originalKey);
  });
});
