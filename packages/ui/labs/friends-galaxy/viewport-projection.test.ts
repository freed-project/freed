import { describe, expect, it } from "vitest";
import { writeFriendsGalaxyWebGpuViewProjection } from "../../src/lib/friends-galaxy-camera.js";
import { projectGalaxyLabWorldPoint } from "./viewport-projection.js";

describe("Friends Galaxy viewport projection", () => {
  const matrix = new Float32Array(16);
  writeFriendsGalaxyWebGpuViewProjection(matrix, { x: 640, y: 360, scale: 1 }, 1_280, 720);
  const projection = { viewProjection: matrix, width: 1_280, height: 720 };

  it("projects the galactic origin into the viewport center", () => {
    const screen = new Float32Array(2);
    expect(projectGalaxyLabWorldPoint(screen, projection, 0, 0, 0)).toBe(true);
    expect(screen[0]).toBeCloseTo(640, 3);
    expect(screen[1]).toBeCloseTo(360, 3);
  });

  it("rejects points beyond the settled presentation margin", () => {
    const screen = new Float32Array(2);
    expect(projectGalaxyLabWorldPoint(screen, projection, 2_000, 0, 0, 48)).toBe(false);
  });

  it("preserves the prominence depth contribution to projection", () => {
    const near = new Float32Array(2);
    const far = new Float32Array(2);
    expect(projectGalaxyLabWorldPoint(near, projection, 180, 0, 220)).toBe(true);
    expect(projectGalaxyLabWorldPoint(far, projection, 180, 0, -220)).toBe(true);
    expect(near[0]! - 640).toBeGreaterThan(far[0]! - 640);
  });
});
