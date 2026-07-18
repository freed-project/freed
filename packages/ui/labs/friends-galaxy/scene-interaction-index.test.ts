import { describe, expect, it } from "vitest";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import {
  createGalaxyLabSceneInteractionIndex,
  findGalaxyLabPickCellIndex,
  findGalaxyLabSceneNodeIndex,
  galaxyLabNodeIdHash,
} from "./scene-interaction-index.js";

describe("Friends Galaxy transferred interaction index", () => {
  const fixture = createGalaxyLabFixture({
    personCount: 40,
    accountCount: 160,
    backgroundStarCount: 0,
  });

  it("resolves every stable id from the worker-built hash table", () => {
    for (
      let nodeIndex = 0;
      nodeIndex < fixture.scene.nodeIds.length;
      nodeIndex += 1
    ) {
      expect(
        findGalaxyLabSceneNodeIndex(
          fixture.scene,
          fixture.interactionIndex,
          fixture.scene.nodeIds[nodeIndex]!,
        ),
      ).toBe(nodeIndex);
    }
    expect(
      findGalaxyLabSceneNodeIndex(
        fixture.scene,
        fixture.interactionIndex,
        "person:missing",
      ),
    ).toBeNull();
  });

  it("stores compact adjacency offsets for contextual links", () => {
    expect(fixture.interactionIndex.neighborOffsets).toHaveLength(
      fixture.scene.nodeIds.length + 1,
    );
    expect(fixture.interactionIndex.neighborIndices).toHaveLength(
      fixture.scene.edgeIndices.length,
    );
    expect(fixture.interactionIndex.neighborOffsets.at(-1)).toBe(
      fixture.scene.edgeIndices.length,
    );
    expect(fixture.interactionIndex.maxNeighborCount).toBe(4);
  });

  it("indexes every star exactly once in transferable pick cells", () => {
    const interactionIndex = fixture.interactionIndex;
    expect(interactionIndex.pickCellOffsets).toHaveLength(
      interactionIndex.pickCellCoordinates.length / 2 + 1,
    );
    expect(interactionIndex.pickCellOffsets.at(-1)).toBe(
      fixture.scene.nodeIds.length,
    );
    expect([...interactionIndex.pickNodeIndices].sort((left, right) => left - right)).toEqual(
      Array.from({ length: fixture.scene.nodeIds.length }, (_, index) => index),
    );
    for (let nodeIndex = 0; nodeIndex < fixture.scene.nodeIds.length; nodeIndex += 1) {
      const offset = nodeIndex * 3;
      const cellIndex = findGalaxyLabPickCellIndex(
        interactionIndex,
        Math.floor(fixture.scene.positions[offset]! / interactionIndex.pickCellSize),
        Math.floor(fixture.scene.positions[offset + 1]! / interactionIndex.pickCellSize),
      );
      expect(cellIndex).not.toBeNull();
      expect([
        ...interactionIndex.pickNodeIndices.subarray(
          interactionIndex.pickCellOffsets[cellIndex!]!,
          interactionIndex.pickCellOffsets[cellIndex! + 1]!,
        ),
      ]).toContain(nodeIndex);
    }
  });

  it("keeps a distant pinned outlier proportional to occupied cells", () => {
    const positions = new Float32Array(fixture.scene.positions);
    positions[0] = 1_000_000_000;
    positions[1] = -1_000_000_000;
    const interactionIndex = createGalaxyLabSceneInteractionIndex({
      ...fixture.scene,
      positions,
    });

    expect(interactionIndex.pickCellCoordinates.length).toBeLessThanOrEqual(
      fixture.scene.nodeIds.length * 2,
    );
    expect(interactionIndex.pickCellOffsets.length).toBeLessThanOrEqual(
      fixture.scene.nodeIds.length + 1,
    );
    expect(findGalaxyLabPickCellIndex(
      interactionIndex,
      Math.floor(positions[0]! / interactionIndex.pickCellSize),
      Math.floor(positions[1]! / interactionIndex.pickCellSize),
    )).not.toBeNull();
  });

  it("keeps an empty scene queryable without invalid grid dimensions", () => {
    const emptyScene = {
      ...fixture.scene,
      nodeIds: [],
      personIds: [],
      accountIds: [],
      linkedPersonIds: [],
      providers: [],
      kinds: new Uint8Array(0),
      colorRoles: new Uint8Array(0),
      flags: new Uint16Array(0),
      positions: new Float32Array(0),
      radii: new Float32Array(0),
      pointSizes: new Float32Array(0),
      prominence: new Float32Array(0),
      brightness: new Float32Array(0),
      emphasis: new Float32Array(0),
      edgeIndices: new Uint32Array(0),
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    };
    const interactionIndex = createGalaxyLabSceneInteractionIndex(emptyScene);

    expect(interactionIndex.pickCellSlots).toEqual(new Uint32Array(2));
    expect(interactionIndex.pickCellCoordinates).toHaveLength(0);
    expect(interactionIndex.pickCellOffsets).toEqual(new Uint32Array(1));
    expect(interactionIndex.pickNodeIndices).toHaveLength(0);
    expect(interactionIndex.maxNeighborCount).toBe(0);
  });

  it("hashes ids deterministically into unsigned values", () => {
    expect(galaxyLabNodeIdHash("person:lab-person-7")).toBe(
      galaxyLabNodeIdHash("person:lab-person-7"),
    );
    expect(galaxyLabNodeIdHash("person:lab-person-7")).not.toBe(
      galaxyLabNodeIdHash("person:lab-person-8"),
    );
    expect(galaxyLabNodeIdHash("person:lab-person-7")).toBeGreaterThanOrEqual(
      0,
    );
  });
});
