import { describe, expect, it } from "vitest";
import { selectGalaxyLabAvatars } from "./avatar-atlas.js";
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
});
