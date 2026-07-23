import { describe, expect, it } from "vitest";
import { writeFriendsGalaxyWebGpuViewProjection } from "../../src/lib/friends-galaxy-camera.js";
import { FriendsGalaxyNavigationController } from "../../src/lib/friends-galaxy-navigation.js";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  type FriendsGalaxyProductWorkerSourceRequest,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import { projectFriendsGalaxyWorldPoint } from "../../src/lib/friends-galaxy-projection.js";
import type { FriendsGalaxyRendererScene } from "../../src/lib/friends-galaxy-renderer.js";
import { findFriendsGalaxySceneNodeIndex } from "../../src/lib/friends-galaxy-scene-interaction-index.js";
import { createFriendsGalaxyProductSource } from "./product-source-fixture.js";

function rendererScene(
  sourceRevision = 1,
  personCount = 24,
  accountCount = 80,
): FriendsGalaxyRendererScene {
  const request: FriendsGalaxyProductWorkerSourceRequest = {
    kind: "source",
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId: sourceRevision,
    sourceRevision,
    source: createFriendsGalaxyProductSource(personCount, accountCount),
    viewport: { width: 1_280, height: 720 },
    backgroundStarCount: 1_000,
    backgroundSeed: `navigation-${sourceRevision.toLocaleString()}`,
  };
  const response = new FriendsGalaxyProductWorkerService().handle(request);
  if (response.kind !== "source-ready") throw new Error("Expected a source scene.");
  return response.rendererScene;
}

describe("Friends Galaxy navigation controller", () => {
  it("opens with useful clip-safe framing and fits the complete scene on demand", () => {
    const navigation = new FriendsGalaxyNavigationController(
      rendererScene(),
      390,
      844,
    );

    expect(navigation.transform.scale).toBeGreaterThanOrEqual(
      navigation.frame.fittedScale,
    );
    expect(navigation.transform.scale).toBeLessThanOrEqual(
      navigation.frame.scaleLimits.maximum,
    );
    navigation.fit();
    expect(navigation.transform.scale).toBeCloseTo(
      navigation.frame.fittedScale,
      12,
    );
  });

  it("focuses positive-depth identities at the bounded usable center", () => {
    const scene = rendererScene();
    const navigation = new FriendsGalaxyNavigationController(
      scene,
      1_280,
      720,
      { top: 0, right: 0, bottom: 0, left: 356 },
    );
    const nodeId = "person:product-person-2";
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      scene.scene,
      scene.interactionIndex,
      nodeId,
    );
    if (nodeIndex === null) throw new Error("Expected a focus node.");

    expect(navigation.focusNode(nodeId)).toBe(true);
    const matrix = new Float32Array(16);
    writeFriendsGalaxyWebGpuViewProjection(
      matrix,
      navigation.transform,
      1_280,
      720,
    );
    const point = new Float32Array(2);
    const offset = nodeIndex * 3;
    expect(projectFriendsGalaxyWorldPoint(
      point,
      { viewProjection: matrix, width: 1_280, height: 720 },
      scene.scene.positions[offset]!,
      scene.scene.positions[offset + 1]!,
      scene.scene.positions[offset + 2]!,
    )).toBe(true);
    expect(point[0]).toBeCloseTo(818, 3);
    expect(point[1]).toBeCloseTo(360, 3);
    expect(navigation.focusNode("missing-node")).toBe(false);
  });

  it("reanchors the same world point when the interaction lane changes", () => {
    const navigation = new FriendsGalaxyNavigationController(
      rendererScene(),
      1_280,
      720,
      { top: 0, right: 0, bottom: 0, left: 356 },
    );
    navigation.panBy(-140, 85);
    const desktopCenterX = 356 + (1_280 - 356) * 0.5;
    const desktopCenterY = 360;
    const worldX = (desktopCenterX - navigation.transform.x) /
      navigation.transform.scale;
    const worldY = (desktopCenterY - navigation.transform.y) /
      navigation.transform.scale;

    navigation.resize(390, 844, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(navigation.transform.scale).toBeGreaterThanOrEqual(
      navigation.frame.outwardZoomEnvelope.target,
    );
    expect(worldX * navigation.transform.scale + navigation.transform.x)
      .toBeCloseTo(195, 10);
    expect(worldY * navigation.transform.scale + navigation.transform.y)
      .toBeCloseTo(422, 10);
  });

  it("keeps zoom focal points stable and restores native inward response", () => {
    const navigation = new FriendsGalaxyNavigationController(
      rendererScene(),
      390,
      844,
    );
    navigation.fit();
    const focalX = 240;
    const focalY = 360;
    const worldX = (focalX - navigation.transform.x) / navigation.transform.scale;
    const worldY = (focalY - navigation.transform.y) / navigation.transform.scale;
    for (let index = 0; index < 12; index += 1) {
      navigation.zoomAt(focalX, focalY, 0.5);
    }
    const outwardScale = navigation.transform.scale;

    expect(navigation.zoomAt(focalX, focalY, 1.18)).toBe(true);
    expect(navigation.transform.scale).toBeCloseTo(outwardScale * 1.18, 12);
    expect(worldX * navigation.transform.scale + navigation.transform.x)
      .toBeCloseTo(focalX, 10);
    expect(worldY * navigation.transform.scale + navigation.transform.y)
      .toBeCloseTo(focalY, 10);

    const movingWorldX = (focalX - navigation.transform.x) /
      navigation.transform.scale;
    const movingWorldY = (focalY - navigation.transform.y) /
      navigation.transform.scale;
    expect(navigation.zoomBetween(focalX, focalY, 260, 380, 1.04)).toBe(true);
    expect(movingWorldX * navigation.transform.scale + navigation.transform.x)
      .toBeCloseTo(260, 10);
    expect(movingWorldY * navigation.transform.scale + navigation.transform.y)
      .toBeCloseTo(380, 10);

    const translatedScale = navigation.transform.scale;
    expect(navigation.zoomBetween(260, 380, 275, 365, 1)).toBe(true);
    expect(navigation.transform.scale).toBe(translatedScale);
    expect(movingWorldX * navigation.transform.scale + navigation.transform.x)
      .toBeCloseTo(275, 10);
    expect(movingWorldY * navigation.transform.scale + navigation.transform.y)
      .toBeCloseTo(365, 10);
  });

  it("preserves the previous pinch midpoint world point at the moving midpoint", () => {
    const navigation = new FriendsGalaxyNavigationController(
      rendererScene(),
      390,
      844,
    );
    const previousMidpointX = 180;
    const previousMidpointY = 300;
    const worldX = (previousMidpointX - navigation.transform.x) /
      navigation.transform.scale;
    const worldY = (previousMidpointY - navigation.transform.y) /
      navigation.transform.scale;

    expect(navigation.pinch(
      120,
      300,
      240,
      300,
      100,
      320,
      300,
      320,
    )).toBe(true);
    expect(worldX * navigation.transform.scale + navigation.transform.x)
      .toBeCloseTo(200, 10);
    expect(worldY * navigation.transform.scale + navigation.transform.y)
      .toBeCloseTo(320, 10);
  });
});
