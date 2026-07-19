import { describe, expect, it } from "vitest";
import { selectFriendsGalaxyAvatars } from "../../src/lib/friends-galaxy-presentation.js";
import { writeFriendsGalaxyWebGpuViewProjection } from "../../src/lib/friends-galaxy-camera.js";
import {
  createGalaxyLabFixture,
  galaxyLabNodePresentation,
  GALAXY_LAB_THEMES,
} from "./scene-fixture.js";
import { compactGalaxyLabFixtureMetadata } from "./scene-fixture-worker-protocol.js";

describe("Friends Galaxy avatar atlas selection", () => {
  const fixture = compactGalaxyLabFixtureMetadata(createGalaxyLabFixture({
    personCount: 5_000,
    accountCount: 25_000,
    backgroundStarCount: 0,
  }));

  it("loads no avatar workload before settled close detail", () => {
    expect(selectFriendsGalaxyAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      galaxyLabNodePresentation,
      "person:lab-person-0",
      false,
      "overview",
    )).toEqual([]);
    expect(selectFriendsGalaxyAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      galaxyLabNodePresentation,
      "person:lab-person-0",
      false,
      "middle",
    )).toEqual([]);
  });

  it("keeps the close atlas capped and retains a selected low-priority identity", () => {
    const selectedNodeId = "person:lab-person-4999";
    const desktop = selectFriendsGalaxyAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      galaxyLabNodePresentation,
      selectedNodeId,
      false,
      "close",
    );
    const compact = selectFriendsGalaxyAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      galaxyLabNodePresentation,
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
    const avatars = selectFriendsGalaxyAvatars(
      fixture,
      GALAXY_LAB_THEMES.neon,
      galaxyLabNodePresentation,
      "account:lab-account-0",
      false,
      "close",
    );
    expect(avatars.some((avatar) => avatar.nodeId === "person:lab-person-0" && avatar.selected)).toBe(true);
  });

  it("can prebuild a bounded hidden roster from compact atlas metadata", () => {
    const atlasPersonIds = new Set(
      fixture.atlas.nodes
        .filter((node) => node.kind === "friend_person" || node.kind === "connection_person")
        .map((node) => node.id),
    );
    const selectedNodeId = "person:lab-person-4999";
    const avatars = selectFriendsGalaxyAvatars(
      fixture,
      GALAXY_LAB_THEMES.scriptorium,
      galaxyLabNodePresentation,
      selectedNodeId,
      true,
      "close",
      undefined,
      "atlas",
    );

    expect(atlasPersonIds.has(selectedNodeId)).toBe(false);
    expect(avatars).toHaveLength(6);
    expect(avatars.some((avatar) => avatar.nodeId === selectedNodeId && avatar.selected)).toBe(true);
    expect(
      avatars.every((avatar) => avatar.nodeId === selectedNodeId || atlasPersonIds.has(avatar.nodeId)),
    ).toBe(true);
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
    writeFriendsGalaxyWebGpuViewProjection(matrix, transform, width, height);
    const avatars = selectFriendsGalaxyAvatars(
      fixture,
      GALAXY_LAB_THEMES.ember,
      galaxyLabNodePresentation,
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
