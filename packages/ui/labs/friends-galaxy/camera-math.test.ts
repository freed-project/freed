import { describe, expect, it } from "vitest";
import {
  GALAXY_LAB_CAMERA_FAR,
  GALAXY_LAB_CAMERA_FAR_UTILIZATION,
  GALAXY_LAB_CAMERA_NEAR_CLEARANCE,
  galaxyLabCameraScaleLimits,
  galaxyLabInitialCameraScale,
  galaxyLabOutwardZoomEnvelope,
  writeGalaxyLabFocusedTransform,
  writeGalaxyLabWebGpuViewProjection,
  writeGalaxyLabWebGpuMotionUniforms,
} from "./camera-math.js";

function project(
  matrix: ArrayLike<number>,
  point: readonly [number, number, number],
  width: number,
  height: number,
): { x: number; y: number; depth: number } {
  const [x, y, z] = point;
  const clipX = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
  const clipY = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
  const clipZ = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
  const clipW = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  return {
    x: (clipX / clipW + 1) * width / 2,
    y: (1 - clipY / clipW) * height / 2,
    depth: clipZ / clipW,
  };
}

describe("Friends Galaxy raw WebGPU camera math", () => {
  it("derives a clip-safe outward scale from viewport and scene depth", () => {
    const viewportHeight = 844;
    const minimumSceneZ = -224;
    const maximumSceneZ = 220;
    const limits = galaxyLabCameraScaleLimits(
      viewportHeight,
      minimumSceneZ,
      maximumSceneZ,
    );
    const focalScale = 1 / Math.tan((42 * Math.PI) / 360);
    const cameraZ = viewportHeight * focalScale / 2 / limits.minimum;
    const closestCameraZ = viewportHeight * focalScale / 2 / limits.maximum;

    expect(cameraZ - minimumSceneZ).toBeCloseTo(
      GALAXY_LAB_CAMERA_FAR * GALAXY_LAB_CAMERA_FAR_UTILIZATION,
      8,
    );
    expect(limits.resistance).toBeGreaterThan(limits.fitMinimum);
    expect(limits.fitMinimum).toBeGreaterThan(limits.minimum);
    expect(closestCameraZ - maximumSceneZ).toBeCloseTo(
      GALAXY_LAB_CAMERA_NEAR_CLEARANCE,
      8,
    );
  });

  it("moves both safe scale limits closer on a taller viewport", () => {
    const compact = galaxyLabCameraScaleLimits(667, -224, 220);
    const tall = galaxyLabCameraScaleLimits(1_366, -224, 220);

    expect(tall.minimum).toBeGreaterThan(compact.minimum);
    expect(tall.maximum).toBeGreaterThan(compact.maximum);
    expect(tall.resistance / tall.minimum).toBeCloseTo(
      compact.resistance / compact.minimum,
      12,
    );
  });

  it("keeps the fitted overview ahead of the clip reserve", () => {
    const limits = galaxyLabCameraScaleLimits(844, -224, 220);
    const envelope = galaxyLabOutwardZoomEnvelope(0.2, limits);

    expect(envelope.target).toBeCloseTo(0.18, 12);
    expect(envelope.resistance).toBeCloseTo(0.27, 12);
    expect(envelope.target).toBeGreaterThan(limits.fitMinimum);
    expect(limits.fitMinimum).toBeGreaterThan(limits.minimum);
  });

  it("uses the clip-derived fit floor when the galaxy bounds are more distant", () => {
    const limits = galaxyLabCameraScaleLimits(844, -224, 220);
    const envelope = galaxyLabOutwardZoomEnvelope(0.001, limits);

    expect(envelope.target).toBe(limits.fitMinimum);
    expect(envelope.resistance).toBeGreaterThan(envelope.target);
    expect(envelope.resistance).toBeLessThanOrEqual(limits.maximum);
  });

  it("centers a prominent star inside the usable full-canvas viewport", () => {
    const width = 1_400;
    const height = 900;
    const insets = { top: 44, right: 280, bottom: 120, left: 320 };
    const worldX = 860;
    const worldY = 420;
    const worldZ = 180;
    const transform = writeGalaxyLabFocusedTransform(
      { x: 0, y: 0, scale: 1 },
      worldX,
      worldY,
      worldZ,
      0.92,
      width,
      height,
      insets,
    );
    const matrix = writeGalaxyLabWebGpuViewProjection(
      new Float32Array(16),
      transform,
      width,
      height,
    );
    const projected = project(matrix, [worldX, -worldY, worldZ], width, height);

    expect(projected.x).toBeCloseTo(
      insets.left + (width - insets.left - insets.right) * 0.5,
      3,
    );
    expect(projected.y).toBeCloseTo(
      insets.top + (height - insets.top - insets.bottom) * 0.5,
      3,
    );
    expect(transform.scale).toBe(0.92);
  });

  it("opens compact canvases at a useful exploration scale", () => {
    expect(galaxyLabInitialCameraScale(0.045, 390)).toBe(0.16);
    expect(galaxyLabInitialCameraScale(0.2, 390)).toBe(0.2);
  });

  it("keeps a useful fitted desktop scale unchanged", () => {
    expect(galaxyLabInitialCameraScale(0.105, 1_280)).toBe(0.105);
    expect(galaxyLabInitialCameraScale(0.05, 1_280)).toBe(0.08);
  });

  it("maps galactic-plane positions through the shared transform", () => {
    const width = 1_200;
    const height = 800;
    const transform = { x: 240, y: -90, scale: 0.72 };
    const matrix = writeGalaxyLabWebGpuViewProjection(
      new Float32Array(16),
      transform,
      width,
      height,
    );
    const planePoint = { x: 660, y: 520 };
    const projected = project(matrix, [planePoint.x, -planePoint.y, 0], width, height);

    expect(projected.x).toBeCloseTo(planePoint.x * transform.scale + transform.x, 4);
    expect(projected.y).toBeCloseTo(planePoint.y * transform.scale + transform.y, 4);
    expect(projected.depth).toBeGreaterThanOrEqual(0);
    expect(projected.depth).toBeLessThanOrEqual(1);
  });

  it("makes prominent positive-depth stars project larger through perspective", () => {
    const width = 390;
    const height = 844;
    const matrix = writeGalaxyLabWebGpuViewProjection(
      new Float32Array(16),
      { x: 0, y: 0, scale: 0.4 },
      width,
      height,
    );
    const center = project(matrix, [500, -500, 0], width, height);
    const prominent = project(matrix, [500, -500, 180], width, height);

    expect(Math.abs(prominent.x - width / 2)).toBeGreaterThan(Math.abs(center.x - width / 2));
    expect(Math.abs(prominent.y - height / 2)).toBeGreaterThan(Math.abs(center.y - height / 2));
  });

  it("encodes animation and camera motion without expanding the uniform block", () => {
    const uniforms = new Float32Array(20);

    writeGalaxyLabWebGpuMotionUniforms(uniforms, 4_000, 0.5, true, false);
    expect(uniforms[18]).toBe(4);
    expect(uniforms[19]).toBe(0.5);

    writeGalaxyLabWebGpuMotionUniforms(uniforms, 5_000, 0.5, true, true);
    expect(uniforms[18]).toBe(-1);
    expect(uniforms[19]).toBe(-0.5);

    writeGalaxyLabWebGpuMotionUniforms(uniforms, 6_000, 0.5, false, false);
    expect(uniforms[18]).toBe(-1);
    expect(uniforms[19]).toBe(0.5);
  });
});
