import { describe, expect, it } from "vitest";
import {
  galaxyLabInitialCameraScale,
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
