import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { identityGalaxyCameraPose } from "../../src/lib/identity-galaxy-camera.js";
import { IdentityGalaxyNodeFlag } from "../../src/lib/identity-galaxy-scene.js";
import {
  placeGalaxyLabLabelsAroundAvatars,
  selectGalaxyLabLabels,
} from "./billboard-labels.js";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import { GalaxyLabSceneIndex } from "./scene-index.js";

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

    expect(state.contextualEdgeIndices).toHaveLength(8);
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

    expect(state.contextualEdgeIndices).toHaveLength(2);
    expect(state.roles.get(index.nodeIndex("person:lab-person-1")!)).toBe("selected");
    expect(state.roles.get(index.nodeIndex("account:lab-account-0")!)).toBe("hovered");
    expect(state.roles.get(index.nodeIndex("person:lab-person-0")!)).toBe("linked");
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
    const touched = index.applyFlags(flags, selected, []);
    expect(flags[0]! & IdentityGalaxyNodeFlag.Selected).toBeTruthy();

    const cleared = index.interactionState({ selectedNodeId: null, hoveredNodeId: null });
    index.applyFlags(flags, cleared, touched);
    expect(flags).toEqual(fixture.scene.flags);
  });

  it("picks the prominent parent star at its projected screen position", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 40,
      backgroundStarCount: 0,
    });
    const index = new GalaxyLabSceneIndex(fixture);
    const camera = new PerspectiveCamera(42, 800 / 600, 1, 20_000);
    const pose = identityGalaxyCameraPose({ x: 400, y: 300, scale: 0.2 }, 800, 600, camera.fov);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    camera.updateMatrixWorld();
    const viewProjection = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
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
    expect(index.pickNode(viewProjection.elements, 800, 600, -100, -100)).toBeNull();
  });
});

describe("Friends Galaxy billboard label selection", () => {
  const fixture = createGalaxyLabFixture({
    personCount: 5_000,
    accountCount: 25_000,
    backgroundStarCount: 0,
  });

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
