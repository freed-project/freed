import { describe, expect, it } from "vitest";
import {
  createFriendsGalaxyStarGeometry,
  friendsGalaxyMotionBackgroundStarCount,
  FRIENDS_GALAXY_MOTION_BACKGROUND_STAR_CAP,
  FRIENDS_GALAXY_MOTION_STAR_VERTEX_COUNT,
  FRIENDS_GALAXY_SETTLED_STAR_VERTEX_COUNT,
} from "../../src/lib/friends-galaxy-star-geometry.js";

function stripArea(vertices: Float32Array): number {
  let area = 0;
  for (let vertexIndex = 0; vertexIndex < vertices.length / 2 - 2; vertexIndex += 1) {
    const a = vertexIndex * 2;
    const b = a + 2;
    const c = a + 4;
    area += Math.abs(
      (vertices[b]! - vertices[a]!) * (vertices[c + 1]! - vertices[a + 1]!) -
      (vertices[b + 1]! - vertices[a + 1]!) * (vertices[c]! - vertices[a]!),
    ) * 0.5;
  }
  return area;
}

describe("Friends Galaxy star geometry", () => {
  it("keeps the settled square strip complete", () => {
    const geometry = createFriendsGalaxyStarGeometry();

    expect(geometry.settled).toHaveLength(FRIENDS_GALAXY_SETTLED_STAR_VERTEX_COUNT * 2);
    expect(stripArea(geometry.settled)).toBeCloseTo(4, 6);
  });

  it("orders the moving octagon as one non-overlapping triangle strip", () => {
    const geometry = createFriendsGalaxyStarGeometry();

    expect(geometry.motion).toHaveLength(FRIENDS_GALAXY_MOTION_STAR_VERTEX_COUNT * 2);
    expect(stripArea(geometry.motion)).toBeCloseTo(2 * Math.SQRT2, 6);
  });

  it("preserves both axis diameters while reducing raster coverage", () => {
    const { settled, motion } = createFriendsGalaxyStarGeometry();
    const xs = Array.from(motion.filter((_, index) => index % 2 === 0));
    const ys = Array.from(motion.filter((_, index) => index % 2 === 1));

    expect(Math.min(...xs)).toBe(-1);
    expect(Math.max(...xs)).toBe(1);
    expect(Math.min(...ys)).toBe(-1);
    expect(Math.max(...ys)).toBe(1);
    expect(stripArea(motion) / stripArea(settled)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("caps only decorative motion stars", () => {
    expect(friendsGalaxyMotionBackgroundStarCount(12_000)).toBe(12_000);
    expect(friendsGalaxyMotionBackgroundStarCount(100_000)).toBe(
      FRIENDS_GALAXY_MOTION_BACKGROUND_STAR_CAP,
    );
    expect(friendsGalaxyMotionBackgroundStarCount(-10)).toBe(0);
    expect(friendsGalaxyMotionBackgroundStarCount(Number.NaN)).toBe(0);
  });
});
