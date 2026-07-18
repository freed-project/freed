import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { identityGalaxyCameraPose } from "../../src/lib/identity-galaxy-camera.js";
import { IdentityGalaxyNodeFlag } from "../../src/lib/identity-galaxy-scene.js";
import {
  placeGalaxyLabLabelsAroundAvatars,
  selectGalaxyLabLabels,
} from "./billboard-labels.js";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import { compactGalaxyLabFixtureMetadata } from "./scene-fixture-worker-protocol.js";
import { GalaxyLabSceneIndex } from "./scene-index.js";

const stressFixture = compactGalaxyLabFixtureMetadata(createGalaxyLabFixture({
  personCount: 5_000,
  accountCount: 25_000,
  backgroundStarCount: 0,
}));

function pickNodeExhaustively(
  fixture: ReturnType<typeof createGalaxyLabFixture>,
  viewProjection: ArrayLike<number>,
  viewportWidth: number,
  viewportHeight: number,
  viewportX: number,
  viewportY: number,
): string | null {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < fixture.scene.nodeIds.length; index += 1) {
    const offset = index * 3;
    const x = fixture.scene.positions[offset]!;
    const y = fixture.scene.positions[offset + 1]!;
    const z = fixture.scene.positions[offset + 2]!;
    const clipX = viewProjection[0]! * x + viewProjection[4]! * y +
      viewProjection[8]! * z + viewProjection[12]!;
    const clipY = viewProjection[1]! * x + viewProjection[5]! * y +
      viewProjection[9]! * z + viewProjection[13]!;
    const clipZ = viewProjection[2]! * x + viewProjection[6]! * y +
      viewProjection[10]! * z + viewProjection[14]!;
    const clipW = viewProjection[3]! * x + viewProjection[7]! * y +
      viewProjection[11]! * z + viewProjection[15]!;
    if (clipW <= 0 || clipZ < -clipW || clipZ > clipW) continue;
    const screenX = (clipX / clipW + 1) * viewportWidth * 0.5;
    const screenY = (1 - clipY / clipW) * viewportHeight * 0.5;
    const dx = screenX - viewportX;
    const dy = screenY - viewportY;
    const radius = Math.max(9, fixture.scene.pointSizes[index]! * 0.24);
    const normalizedDistance = (dx * dx + dy * dy) / (radius * radius);
    if (normalizedDistance > 1) continue;
    const score = normalizedDistance - fixture.scene.prominence[index]! * 0.26;
    if (score < bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex < 0 ? null : fixture.scene.nodeIds[bestIndex] ?? null;
}

function viewProjectionFor(
  transform: { x: number; y: number; scale: number },
  width = 800,
  height = 600,
): { camera: PerspectiveCamera; matrix: Matrix4 } {
  const camera = new PerspectiveCamera(42, width / height, 1, 20_000);
  const pose = identityGalaxyCameraPose(transform, width, height, camera.fov);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
  camera.updateMatrixWorld();
  return {
    camera,
    matrix: new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  };
}

describe("Friends Galaxy renderer lab scene index", () => {
  it("returns only the selected identity constellation", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 40,
      backgroundStarCount: 0,
    });
    const index = new GalaxyLabSceneIndex(fixture);
    const state = index.interactionState({
      selectedNodeId: "person:lab-person-0",
      hoveredNodeId: null,
    });

    expect(state.contextualEdgeCount).toBe(4);
    expect(state.contextualEdgeIndices.length).toBeGreaterThanOrEqual(8);
    expect(state.roles.get(0)).toBe("selected");
    for (const neighbor of index.neighbors(0)) {
      expect(state.roles.get(neighbor)).toBe("linked");
    }
  });

  it("lets hover temporarily focus a different constellation without losing selection", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 40,
      backgroundStarCount: 0,
    });
    const index = new GalaxyLabSceneIndex(fixture);
    const state = index.interactionState({
      selectedNodeId: "person:lab-person-1",
      hoveredNodeId: "account:lab-account-0",
    });

    expect(state.contextualEdgeCount).toBe(1);
    expect(state.roles.get(index.nodeIndex("person:lab-person-1")!)).toBe("selected");
    expect(state.roles.get(index.nodeIndex("account:lab-account-0")!)).toBe("hovered");
    expect(state.roles.get(index.nodeIndex("person:lab-person-0")!)).toBe("linked");
  });

  it("reuses interaction roles, edges, and state across focus changes", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 40,
      backgroundStarCount: 0,
    });
    const index = new GalaxyLabSceneIndex(fixture);
    const selected = index.interactionState({
      selectedNodeId: "person:lab-person-0",
      hoveredNodeId: null,
    });
    const roles = selected.roles;
    const edgeIndices = selected.contextualEdgeIndices;

    const hovered = index.interactionState({
      selectedNodeId: "person:lab-person-1",
      hoveredNodeId: "account:lab-account-0",
    });

    expect(hovered).toBe(selected);
    expect(hovered.roles).toBe(roles);
    expect(hovered.contextualEdgeIndices).toBe(edgeIndices);
    expect(hovered.contextualEdgeCount).toBe(1);
    expect(hovered.contextualEdgeIndices[0]).toBe(
      index.nodeIndex("account:lab-account-0"),
    );
    expect(hovered.contextualEdgeIndices[1]).toBe(
      index.nodeIndex("person:lab-person-0"),
    );
    expect(index.contextualEdgeCapacity).toBeGreaterThanOrEqual(hovered.contextualEdgeCount);
  });

  it("applies and restores interaction flags without a graph-wide reset", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 40,
      backgroundStarCount: 0,
    });
    const index = new GalaxyLabSceneIndex(fixture);
    const flags = new Uint16Array(fixture.scene.flags);
    const selected = index.interactionState({
      selectedNodeId: "person:lab-person-0",
      hoveredNodeId: null,
    });
    const touched = new Set<number>();
    index.applyFlags(flags, selected, [], touched);
    expect(flags[0]! & IdentityGalaxyNodeFlag.Selected).toBeTruthy();

    const cleared = index.interactionState({ selectedNodeId: null, hoveredNodeId: null });
    index.applyFlags(flags, cleared, touched, touched);
    expect(flags).toEqual(fixture.scene.flags);
    expect(touched.size).toBe(0);
  });

  it("picks the prominent parent star at its projected screen position", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 40,
      backgroundStarCount: 0,
    });
    const index = new GalaxyLabSceneIndex(fixture);
    const { camera, matrix: viewProjection } = viewProjectionFor({
      x: 400,
      y: 300,
      scale: 0.2,
    });
    const projected = new Vector3(
      fixture.scene.positions[0]!,
      fixture.scene.positions[1]!,
      fixture.scene.positions[2]!,
    ).project(camera);
    const screenX = (projected.x + 1) * 400;
    const screenY = (1 - projected.y) * 300;

    expect(index.pickNode(viewProjection.elements, 800, 600, screenX, screenY)).toBe(
      "person:lab-person-0",
    );
    expect(index.lastPickCandidateCount).toBeLessThan(index.pickSourceNodeCount);
    expect(index.pickNode(viewProjection.elements, 800, 600, -100, -100)).toBeNull();
  });

  it("matches exhaustive picking across representative cameras and screen points", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 40,
      accountCount: 160,
      backgroundStarCount: 0,
    });
    const index = new GalaxyLabSceneIndex(fixture);
    const transforms = [
      { x: 400, y: 300, scale: 0.2 },
      { x: 120, y: -80, scale: 0.72 },
      { x: -1_400, y: 900, scale: 1.8 },
    ];
    const points = Array.from({ length: 80 }, (_, pointIndex) => ({
      x: 40 + pointIndex % 10 * 80,
      y: 30 + Math.floor(pointIndex / 10) * 75,
    }));

    for (const transform of transforms) {
      const { matrix } = viewProjectionFor(transform);
      for (const point of points) {
        expect(index.pickNode(matrix.elements, 800, 600, point.x, point.y)).toBe(
          pickNodeExhaustively(fixture, matrix.elements, 800, 600, point.x, point.y),
        );
      }
    }
  });

  it("keeps stress-fixture projection bounded by spatial candidates", () => {
    const index = new GalaxyLabSceneIndex(stressFixture);
    const { camera, matrix } = viewProjectionFor({ x: 400, y: 300, scale: 0.2 });
    const projected = new Vector3(
      stressFixture.scene.positions[0]!,
      stressFixture.scene.positions[1]!,
      stressFixture.scene.positions[2]!,
    ).project(camera);

    expect(index.pickNode(
      matrix.elements,
      800,
      600,
      (projected.x + 1) * 400,
      (1 - projected.y) * 300,
    )).not.toBeNull();
    expect(index.lastPickCandidateCount).toBeLessThan(2_000);
    expect(index.lastPickCandidateCount).toBeLessThan(index.pickSourceNodeCount);
  });
});

describe("Friends Galaxy billboard label selection", () => {
  const fixture = stressFixture;

  it("keeps a stable viewport-bounded label workload", () => {
    const cases = [
      { compact: false, detail: "overview" as const, cap: 13 },
      { compact: false, detail: "middle" as const, cap: 36 },
      { compact: false, detail: "close" as const, cap: 64 },
      { compact: true, detail: "overview" as const, cap: 8 },
      { compact: true, detail: "middle" as const, cap: 20 },
      { compact: true, detail: "close" as const, cap: 32 },
    ];
    for (const { compact, detail, cap } of cases) {
      const labels = selectGalaxyLabLabels(fixture, compact, detail);
      expect(labels.length).toBeGreaterThanOrEqual(5);
      expect(labels.length).toBeLessThanOrEqual(cap);
      expect(selectGalaxyLabLabels(fixture, compact, detail)).toEqual(labels);
    }
  });

  it("spatially separates overview identity labels", () => {
    const labels = selectGalaxyLabLabels(fixture, false, "overview")
      .filter((label) => !label.provider);
    for (let left = 0; left < labels.length; left += 1) {
      for (let right = left + 1; right < labels.length; right += 1) {
        expect(Math.hypot(
          labels[left]!.anchorX - labels[right]!.anchorX,
          labels[left]!.anchorY - labels[right]!.anchorY,
        )).toBeGreaterThanOrEqual(760);
      }
    }
  });

  it("retains every provider label before semantic labels", () => {
    const labels = selectGalaxyLabLabels(fixture, true, "overview");
    expect(labels.slice(0, 5).map((label) => label.nodeId)).toEqual([
      "provider:instagram",
      "provider:facebook",
      "provider:linkedin",
      "provider:x",
      "provider:rss",
    ]);
    expect(labels.slice(0, 5).every((label) => label.provider)).toBe(true);
  });

  it("keeps close labels clear of avatar billboards", () => {
    const labels = selectGalaxyLabLabels(fixture, false, "close");
    const ownLabel = labels.find((label) => !label.provider)!;
    const nearbyLabel = {
      ...ownLabel,
      id: `${ownLabel.id}:nearby`,
      nodeId: `${ownLabel.nodeId}:nearby`,
      anchorX: ownLabel.anchorX + 4,
    };
    const placed = placeGalaxyLabLabelsAroundAvatars(
      [ownLabel, nearbyLabel],
      [{
        nodeId: ownLabel.nodeId,
        initials: "ID",
        anchorX: ownLabel.anchorX,
        anchorY: ownLabel.anchorY,
        anchorZ: ownLabel.anchorZ,
        size: 48,
        priority: 1,
        selected: true,
        color: "#000000",
      }],
    );

    expect(placed).toHaveLength(1);
    expect(placed[0]!.nodeId).toBe(ownLabel.nodeId);
    expect(placed[0]!.gapY).toBeGreaterThanOrEqual(32);
  });

  it("keeps the selected identity named outside the ordinary label sample", () => {
    const selectedNodeId = "person:lab-person-4999";
    const labels = selectGalaxyLabLabels(fixture, false, "close", selectedNodeId);

    expect(labels.some((label) => label.nodeId === selectedNodeId)).toBe(true);
    expect(labels.length).toBeLessThanOrEqual(64);
  });
});
