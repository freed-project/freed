import { describe, expect, it } from "vitest";
import { friendsGalaxyAmbientMotionTimeSeconds } from "../../src/lib/friends-galaxy-ambient-motion.js";

describe("Friends Galaxy ambient motion", () => {
  it("converts a settled enabled frame to shader seconds", () => {
    expect(friendsGalaxyAmbientMotionTimeSeconds(4_250, true, false)).toBe(4.25);
  });

  it("preserves shader phase when camera movement starts and stops", () => {
    expect(friendsGalaxyAmbientMotionTimeSeconds(4_250, true, true)).toBe(4.25);
    expect(friendsGalaxyAmbientMotionTimeSeconds(4_500, true, false)).toBe(4.5);
  });

  it("freezes shader motion when the preference is disabled or time is invalid", () => {
    expect(friendsGalaxyAmbientMotionTimeSeconds(4_250, false, false)).toBe(-1);
    expect(friendsGalaxyAmbientMotionTimeSeconds(Number.NaN, true, false)).toBe(-1);
  });
});
