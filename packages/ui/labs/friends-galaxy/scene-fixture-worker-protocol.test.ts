import { describe, expect, it } from "vitest";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import {
  GALAXY_LAB_METADATA_NODE_CAP,
  compactGalaxyLabFixtureMetadata,
  galaxyLabFixtureTransferables,
  galaxyLabFixtureWorkerReceipt,
  validateGalaxyLabFixtureEnvelope,
} from "./scene-fixture-worker-protocol.js";
import {
  friendsGalaxyRendererSceneTransferables,
  friendsGalaxyWorkerSceneReceipt,
  validateFriendsGalaxyWorkerScene,
} from "../../src/lib/friends-galaxy-worker-scene.js";
import {
  buildIdentityGraphAtlasModel,
  fitTransformToAtlasBounds,
  sliceIdentityGraphAtlas,
} from "../../src/lib/identity-graph-atlas.js";
import { compileFriendsGalaxyProductRendererScene } from "../../src/lib/friends-galaxy-product-scene.js";
import { createFriendsGalaxyProductSource } from "./product-source-fixture.js";

describe("Friends Galaxy fixture worker protocol", () => {
  it("keeps lab and product semantic scenes complete while bounding rich metadata", () => {
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

    const productPersonCount = 120;
    const productAccountCount = 500;
    const source = createFriendsGalaxyProductSource(
      productPersonCount,
      productAccountCount,
    );
    const selectedAccountId = "product-account-499";
    const model = buildIdentityGraphAtlasModel({
      ...source,
      width: 1_400,
      height: 900,
    });
    const transform = fitTransformToAtlasBounds(model.bounds, 1_400, 900, 96);
    const atlas = sliceIdentityGraphAtlas({
      model,
      transform,
      width: 1_400,
      height: 900,
      quality: "settled",
      selectedAccountId,
    });
    const productScene = compileFriendsGalaxyProductRendererScene({
      atlas,
      source: model,
      selectedAccountId,
      backgroundStarCount: 2_000,
      backgroundSeed: "product-bridge",
      metadataNodeCap: GALAXY_LAB_METADATA_NODE_CAP,
      now: 1,
    });
    const productReceipt = friendsGalaxyWorkerSceneReceipt(productScene);

    expect(productScene.scene.nodeIds).toHaveLength(
      productPersonCount + productAccountCount,
    );
    expect(productScene.scene.nodeIds.some((id) => id.startsWith("provider:"))).toBe(false);
    expect(productScene.atlas.regions.length).toBeGreaterThan(0);
    expect(productScene.atlas.nodes.length).toBeLessThanOrEqual(
      GALAXY_LAB_METADATA_NODE_CAP,
    );
    expect(productScene.atlas.nodes[0]?.accountId).toBe(selectedAccountId);
    expect(productReceipt.transferableBufferCount).toBe(21);
    expect(() =>
      validateFriendsGalaxyWorkerScene(productScene, productReceipt, {
        metadataNodeCap: GALAXY_LAB_METADATA_NODE_CAP,
      }),
    ).not.toThrow();
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
    expect(transferables).toEqual(
      friendsGalaxyRendererSceneTransferables(fixture),
    );
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
    expect(transferables).toContain(
      fixture.packedStarInstances.semantic.buffer,
    );
    expect(transferables).toContain(
      fixture.packedStarInstances.background.buffer,
    );
    expect(transferables).toContain(fixture.backgroundPositions.buffer);
    expect(transferables).toContain(fixture.backgroundBrightness.buffer);
    expect(receipt).toEqual({
      semanticNodeCount: 60,
      metadataNodeCount: fixture.atlas.nodes.length,
      activitySummaryCount: 48,
      representedActivityItemCount: 480,
      transferableBufferCount: 21,
    });
    expect(friendsGalaxyWorkerSceneReceipt(fixture)).toEqual({
      semanticNodeCount: 60,
      metadataNodeCount: fixture.atlas.nodes.length,
      transferableBufferCount: 21,
    });
    expect(() =>
      validateFriendsGalaxyWorkerScene(
        fixture,
        friendsGalaxyWorkerSceneReceipt(fixture),
        { metadataNodeCap: GALAXY_LAB_METADATA_NODE_CAP },
      ),
    ).not.toThrow();
    expect(() =>
      validateGalaxyLabFixtureEnvelope(fixture, receipt),
    ).not.toThrow();
  });

  it("keeps worker payload shape tied to summary count instead of represented item volume", () => {
    const options = {
      personCount: 100,
      accountCount: 500,
      backgroundStarCount: 1_000,
      activitySummaryCount: 500,
    };
    const baseline = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture({
        ...options,
        representedActivityItemCount: 500,
      }),
    );
    const tenX = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture({
        ...options,
        representedActivityItemCount: 5_000,
      }),
    );
    const baselineTransferables = galaxyLabFixtureTransferables(baseline);
    const tenXTransferables = galaxyLabFixtureTransferables(tenX);
    const baselineReceipt = galaxyLabFixtureWorkerReceipt(
      baseline,
      baselineTransferables.length,
    );
    const tenXReceipt = galaxyLabFixtureWorkerReceipt(
      tenX,
      tenXTransferables.length,
    );

    expect(tenXTransferables.map((buffer) => buffer.byteLength)).toEqual(
      baselineTransferables.map((buffer) => buffer.byteLength),
    );
    expect(Array.from(tenX.scene.positions)).toEqual(
      Array.from(baseline.scene.positions),
    );
    expect(Array.from(tenX.scene.brightness)).not.toEqual(
      Array.from(baseline.scene.brightness),
    );
    expect(tenXReceipt).toMatchObject({
      semanticNodeCount: 600,
      activitySummaryCount: 500,
      representedActivityItemCount: 5_000,
      transferableBufferCount: 21,
    });
    expect(baselineReceipt).toMatchObject({
      activitySummaryCount: 500,
      representedActivityItemCount: 500,
      transferableBufferCount: 21,
    });
    expect("items" in tenX).toBe(false);
    expect(() =>
      validateGalaxyLabFixtureEnvelope(tenX, tenXReceipt),
    ).not.toThrow();
  });

  it("rejects malformed resident buffers before renderer admission", () => {
    const fixture = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture({
        personCount: 12,
        accountCount: 48,
        backgroundStarCount: 120,
      }),
    );
    const malformed = {
      ...fixture,
      scene: {
        ...fixture.scene,
        positions: fixture.scene.positions.slice(0, -3),
      },
    };
    const receipt = galaxyLabFixtureWorkerReceipt(fixture, 21);

    expect(() => validateGalaxyLabFixtureEnvelope(malformed, receipt)).toThrow(
      "Friends Galaxy worker returned positions length 177; expected 180.",
    );
  });

  it("fails closed on malformed or aliased renderer scene roots", () => {
    const fixture = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture({
        personCount: 12,
        accountCount: 48,
        backgroundStarCount: 120,
      }),
    );
    const receipt = friendsGalaxyWorkerSceneReceipt(fixture);
    const admission = { metadataNodeCap: GALAXY_LAB_METADATA_NODE_CAP };

    expect(() =>
      validateFriendsGalaxyWorkerScene(null, receipt, admission),
    ).toThrow("Friends Galaxy worker returned an invalid renderer scene.");
    expect(() =>
      validateFriendsGalaxyWorkerScene(
        { ...fixture, scene: null },
        receipt,
        admission,
      ),
    ).toThrow("Friends Galaxy worker returned an invalid semantic scene.");
    expect(() =>
      validateFriendsGalaxyWorkerScene(fixture, null, admission),
    ).toThrow("Friends Galaxy worker returned an invalid scene receipt.");
    expect(() =>
      validateFriendsGalaxyWorkerScene(
        {
          ...fixture,
          scene: {
            ...fixture.scene,
            pointSizes: fixture.scene.radii,
          },
        },
        receipt,
        admission,
      ),
    ).toThrow(
      "Friends Galaxy worker returned 20 unique scene buffers; expected 21.",
    );
  });

  it("rejects inconsistent sparse-index offsets and worker receipts", () => {
    const fixture = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture({
        personCount: 12,
        accountCount: 48,
        backgroundStarCount: 120,
      }),
    );
    const neighborOffsets = fixture.interactionIndex.neighborOffsets.slice();
    neighborOffsets[neighborOffsets.length - 1] -= 1;
    const malformedIndex = {
      ...fixture,
      interactionIndex: {
        ...fixture.interactionIndex,
        neighborOffsets,
      },
    };
    const receipt = galaxyLabFixtureWorkerReceipt(fixture, 21);

    expect(() =>
      validateGalaxyLabFixtureEnvelope(malformedIndex, receipt),
    ).toThrow("Friends Galaxy worker returned inconsistent neighbor offsets.");
    expect(() =>
      validateGalaxyLabFixtureEnvelope(fixture, {
        ...receipt,
        metadataNodeCount: receipt.metadataNodeCount + 1,
      }),
    ).toThrow(
      "Friends Galaxy worker receipt does not match its transferred scene.",
    );
    expect(() =>
      validateGalaxyLabFixtureEnvelope(
        {
          ...fixture,
          representedActivityItemCount: fixture.activitySummaryCount - 1,
        },
        receipt,
      ),
    ).toThrow(
      "Friends Galaxy worker returned fewer represented items than activity summaries.",
    );
  });
});
