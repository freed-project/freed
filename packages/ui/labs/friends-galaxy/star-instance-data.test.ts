import { describe, expect, it } from "vitest";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import {
  FRIENDS_GALAXY_STAR_INSTANCE_FLOATS,
  FriendsGalaxyStarColorRole,
  createFriendsGalaxyPackedStarInstances,
} from "../../src/lib/friends-galaxy-star-instances.js";

describe("Friends Galaxy worker-packed star instances", () => {
  it("packs direct-upload semantic and background streams", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 10,
      accountCount: 50,
      backgroundStarCount: 100,
    });

    expect(fixture.packedStarInstances.semantic).toHaveLength(
      60 * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS,
    );
    expect(fixture.packedStarInstances.background).toHaveLength(
      100 * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS,
    );
    expect(fixture.packedStarInstances.semantic.slice(0, 3)).toEqual(
      fixture.scene.positions.slice(0, 3),
    );
    expect(fixture.packedStarInstances.semantic[5]).toBe(
      FriendsGalaxyStarColorRole.Friend,
    );
    expect(fixture.packedStarInstances.background[5]).toBe(
      FriendsGalaxyStarColorRole.Background,
    );
  });

  it("encodes provider palette roles without resolved theme colors", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 1,
      accountCount: 5,
      backgroundStarCount: 0,
    });
    const expectedRoles = [
      FriendsGalaxyStarColorRole.Instagram,
      FriendsGalaxyStarColorRole.Facebook,
      FriendsGalaxyStarColorRole.LinkedIn,
      FriendsGalaxyStarColorRole.X,
      FriendsGalaxyStarColorRole.Rss,
    ];

    for (let accountIndex = 0; accountIndex < expectedRoles.length; accountIndex += 1) {
      const nodeIndex = fixture.personCount + accountIndex;
      expect(
        fixture.packedStarInstances.semantic[
          nodeIndex * FRIENDS_GALAXY_STAR_INSTANCE_FLOATS + 5
        ],
      ).toBe(expectedRoles[accountIndex]);
    }
  });

  it("rejects mismatched decorative source arrays", () => {
    const fixture = createGalaxyLabFixture({
      personCount: 1,
      accountCount: 0,
      backgroundStarCount: 0,
    });
    expect(() => createFriendsGalaxyPackedStarInstances({
      scene: fixture.scene,
      backgroundPositions: new Float32Array(6),
      backgroundBrightness: new Float32Array(1),
    })).toThrow("background positions and brightness lengths do not match");
  });
});
