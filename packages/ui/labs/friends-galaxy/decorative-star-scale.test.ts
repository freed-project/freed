import { describe, expect, it } from "vitest";
import {
  FRIENDS_GALAXY_DECORATIVE_STAR_MAX_SCALE,
  FRIENDS_GALAXY_DECORATIVE_STAR_MIN_SCALE,
  FRIENDS_GALAXY_DECORATIVE_STAR_REFERENCE_SCALE,
  friendsGalaxyDecorativeStarScale,
} from "../../src/lib/friends-galaxy-decorative-star-scale.js";

describe("Friends Galaxy decorative star scale", () => {
  it("keeps the current dust size at the overview-to-middle reference scale", () => {
    expect(friendsGalaxyDecorativeStarScale(
      FRIENDS_GALAXY_DECORATIVE_STAR_REFERENCE_SCALE,
    )).toBe(1);
  });

  it("shrinks at overview and grows monotonically through close zoom", () => {
    const scales = [0.08, 0.16, 0.24, 0.5, 0.9, 1.2].map(
      friendsGalaxyDecorativeStarScale,
    );
    expect(scales[0]).toBeLessThan(1);
    expect(scales[2]).toBe(1);
    expect(scales.at(-1)).toBeGreaterThan(1);
    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]).toBeGreaterThanOrEqual(scales[index - 1]!);
    }
  });

  it("bounds malformed, extreme overview, and extreme close scales", () => {
    expect(friendsGalaxyDecorativeStarScale(Number.NaN)).toBe(
      FRIENDS_GALAXY_DECORATIVE_STAR_MIN_SCALE,
    );
    expect(friendsGalaxyDecorativeStarScale(-1)).toBe(
      FRIENDS_GALAXY_DECORATIVE_STAR_MIN_SCALE,
    );
    expect(friendsGalaxyDecorativeStarScale(100)).toBe(
      FRIENDS_GALAXY_DECORATIVE_STAR_MAX_SCALE,
    );
  });
});
