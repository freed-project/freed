import { describe, expect, it } from "vitest";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import {
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
