import { describe, expect, it } from "vitest";
import {
  createGalaxyLabFixture,
  GALAXY_LAB_PROVIDERS,
} from "./scene-fixture.js";

describe("Friends Galaxy renderer lab fixture", () => {
  it("builds the final semantic and decorative stress target", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 5_000,
      accountCount: 25_000,
      backgroundStarCount: 100_000,
    });

    expect(fixture.scene.nodeIds).toHaveLength(30_000);
    expect(fixture.scene.positions).toHaveLength(90_000);
    expect(fixture.backgroundPositions).toHaveLength(300_000);
    expect(fixture.backgroundBrightness).toHaveLength(100_000);
    expect(fixture.linkedAccountCount).toBe(20_000);
    expect(fixture.scene.edgeIndices).toHaveLength(40_000);
  });

  it("is deterministic across repeated builds", () => {
    const options = { personCount: 36, accountCount: 180, backgroundStarCount: 240 };
    const first = createGalaxyLabFixture(options);
    const second = createGalaxyLabFixture(options);

    expect(first.scene.nodeIds).toEqual(second.scene.nodeIds);
    expect(Array.from(first.scene.positions)).toEqual(Array.from(second.scene.positions));
    expect(Array.from(first.scene.prominence)).toEqual(Array.from(second.scene.prominence));
    expect(Array.from(first.backgroundPositions)).toEqual(Array.from(second.backgroundPositions));
  });

  it("keeps linked channels in tight identity systems", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 20,
      accountCount: 100,
      backgroundStarCount: 0,
    });

    for (let accountIndex = 0; accountIndex < fixture.linkedAccountCount; accountIndex += 1) {
      const personIndex = accountIndex % fixture.personCount;
      const accountSceneIndex = fixture.personCount + accountIndex;
      const dx = fixture.scene.positions[accountSceneIndex * 3]! - fixture.scene.positions[personIndex * 3]!;
      const dy = fixture.scene.positions[accountSceneIndex * 3 + 1]! - fixture.scene.positions[personIndex * 3 + 1]!;
      const dz = fixture.scene.positions[accountSceneIndex * 3 + 2]! - fixture.scene.positions[personIndex * 3 + 2]!;
      expect(Math.hypot(dx, dy)).toBeLessThan(55);
      expect(Math.abs(dz)).toBeLessThan(12);
      expect(fixture.scene.linkedPersonIds[accountSceneIndex]).toBe(`lab-person-${personIndex}`);
    }
  });

  it("organizes unlinked channels into deterministic provider spiral sectors", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 90,
      backgroundStarCount: 0,
    });
    const providerDistances = new Map<string, number[]>();
    for (const provider of GALAXY_LAB_PROVIDERS) providerDistances.set(provider, []);

    for (let accountIndex = fixture.linkedAccountCount; accountIndex < fixture.accountCount; accountIndex += 1) {
      const sceneIndex = fixture.personCount + accountIndex;
      const provider = fixture.scene.providers[sceneIndex]!;
      const region = fixture.atlas.regions.find((candidate) => candidate.provider === provider)!;
      const dx = fixture.scene.positions[sceneIndex * 3]! - region.x;
      const dy = fixture.scene.positions[sceneIndex * 3 + 1]! + region.y;
      providerDistances.get(provider)!.push(Math.hypot(dx, dy));
    }

    for (const provider of GALAXY_LAB_PROVIDERS) {
      const distances = providerDistances.get(provider)!;
      expect(distances.length).toBeGreaterThan(0);
      const average = distances.reduce((sum, value) => sum + value, 0) / distances.length;
      expect(average).toBeGreaterThan(100);
      expect(average).toBeLessThan(500);
    }
  });
});
