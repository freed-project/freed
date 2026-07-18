import { describe, expect, it } from "vitest";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import {
  GALAXY_LAB_METADATA_NODE_CAP,
  compactGalaxyLabFixtureMetadata,
  galaxyLabFixtureTransferables,
  galaxyLabFixtureWorkerReceipt,
} from "./scene-fixture-worker-protocol.js";

describe("Friends Galaxy fixture worker protocol", () => {
  it("keeps the semantic scene complete while bounding rich main-thread metadata", () => {
    const fullFixture = createGalaxyLabFixture({
      personCount: 500,
      accountCount: 2_500,
      backgroundStarCount: 4_000,
    });
    const fixture = compactGalaxyLabFixtureMetadata(fullFixture);

    expect(fixture.scene.nodeIds).toHaveLength(3_000);
    expect(fixture.scene.edgeIndices).toHaveLength(4_000);
    expect(fixture.atlas.nodes.length).toBeLessThanOrEqual(
      GALAXY_LAB_METADATA_NODE_CAP,
    );
    expect(fixture.atlas.edges).toEqual([]);
    expect(fixture.atlas.hitBuckets).toEqual([]);
    expect(fixture.atlas.metrics.sourceNodeCount).toBe(3_000);
    expect(fixture.atlas.metrics.visibleNodeCount).toBe(
      fixture.atlas.nodes.length,
    );
    expect(fixture.atlas.metrics.capped).toBe(true);
    for (const label of fixture.atlas.labels.filter(
      (entry) => entry.kind !== "provider_cluster",
    )) {
      expect(fixture.atlas.nodes.some((node) => node.id === label.nodeId)).toBe(
        true,
      );
    }
  });

  it("transfers every numeric scene payload without duplicate buffers", () => {
    const fixture = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture({
        personCount: 12,
        accountCount: 48,
        backgroundStarCount: 120,
      }),
    );
    const transferables = galaxyLabFixtureTransferables(fixture);
    const receipt = galaxyLabFixtureWorkerReceipt(
      fixture,
      transferables.length,
    );

    expect(transferables).toHaveLength(21);
    expect(new Set(transferables).size).toBe(21);
    expect(transferables).toContain(fixture.scene.positions.buffer);
    expect(transferables).toContain(fixture.scene.edgeIndices.buffer);
    expect(transferables).toContain(
      fixture.interactionIndex.nodeIndexSlots.buffer,
    );
    expect(transferables).toContain(
      fixture.interactionIndex.neighborOffsets.buffer,
    );
    expect(transferables).toContain(
      fixture.interactionIndex.neighborIndices.buffer,
    );
    expect(fixture.interactionIndex.maxNeighborCount).toBe(4);
    expect(transferables).toContain(
      fixture.interactionIndex.pickCellSlots.buffer,
    );
    expect(transferables).toContain(
      fixture.interactionIndex.pickCellCoordinates.buffer,
    );
    expect(transferables).toContain(
      fixture.interactionIndex.pickCellOffsets.buffer,
    );
    expect(transferables).toContain(
      fixture.interactionIndex.pickNodeIndices.buffer,
    );
    expect(transferables).toContain(fixture.packedStarInstances.semantic.buffer);
    expect(transferables).toContain(fixture.packedStarInstances.background.buffer);
    expect(transferables).toContain(fixture.backgroundPositions.buffer);
    expect(transferables).toContain(fixture.backgroundBrightness.buffer);
    expect(receipt).toEqual({
      semanticNodeCount: 60,
      metadataNodeCount: fixture.atlas.nodes.length,
      transferableBufferCount: 21,
    });
  });
});
