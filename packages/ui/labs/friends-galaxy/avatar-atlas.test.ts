import { describe, expect, it } from "vitest";
import { selectGalaxyLabAvatars } from "./avatar-atlas.js";
import { writeGalaxyLabWebGpuViewProjection } from "./camera-math.js";
import { createGalaxyLabFixture, GALAXY_LAB_THEMES } from "./scene-fixture.js";
import { compactGalaxyLabFixtureMetadata } from "./scene-fixture-worker-protocol.js";

describe("Friends Galaxy avatar atlas selection", () => {
  const fixture = compactGalaxyLabFixtureMetadata(createGalaxyLabFixture({
    personCount: 5_000,
    accountCount: 25_000,
    backgroundStarCount: 0,
  }));

  it("loads no avatar workload before settled close detail", () => {
    expect(selectGalaxyLabAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      "person:lab-person-0",
      false,
      "overview",
    )).toEqual([]);
    expect(selectGalaxyLabAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      "person:lab-person-0",
      false,
      "middle",
    )).toEqual([]);
  });

  it("keeps the close atlas capped and retains a selected low-priority identity", () => {
    const selectedNodeId = "person:lab-person-4999";
    const desktop = selectGalaxyLabAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      selectedNodeId,
      false,
      "close",
    );
    const compact = selectGalaxyLabAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      selectedNodeId,
      true,
      "close",
    );

    expect(desktop).toHaveLength(12);
    expect(compact).toHaveLength(6);
    expect(desktop.some((avatar) => avatar.nodeId === selectedNodeId && avatar.selected)).toBe(true);
    expect(compact.some((avatar) => avatar.nodeId === selectedNodeId && avatar.selected)).toBe(true);
  });

  it("resolves a selected linked channel to its parent identity", () => {
    const avatars = selectGalaxyLabAvatars(
      fixture,
      GALAXY_LAB_THEMES.neon,
      "account:lab-account-0",
      false,
      "close",
    );
    expect(avatars.some((avatar) => avatar.nodeId === "person:lab-person-0" && avatar.selected)).toBe(true);
  });

  it("admits only identities near the settled close viewport", () => {
    const selectedIndex = 4_999;
    const positionOffset = selectedIndex * 3;
    const width = 800;
    const height = 600;
    const scale = 2;
    const transform = {
      x: width / 2 - fixture.scene.positions[positionOffset]! * scale,
      y: height / 2 + fixture.scene.positions[positionOffset + 1]! * scale,
      scale,
    };
    const matrix = new Float32Array(16);
    writeGalaxyLabWebGpuViewProjection(matrix, transform, width, height);
    const avatars = selectGalaxyLabAvatars(
      fixture,
      GALAXY_LAB_THEMES.vesper,
      "person:lab-person-4999",
      false,
      "close",
      { viewProjection: matrix, width, height },
    );

    expect(avatars.some((avatar) => avatar.nodeId === "person:lab-person-4999")).toBe(true);
    expect(avatars.some((avatar) => avatar.nodeId === "person:lab-person-0")).toBe(false);
    expect(avatars).toHaveLength(12);
  });
});
