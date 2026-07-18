import { IDENTITY_GALAXY_CAMERA_FOV } from "../../src/lib/identity-galaxy-camera.js";
import type { GalaxyLabTransform } from "./scene-fixture.js";

const DEFAULT_NEAR = 1;
const DEFAULT_FAR = 20_000;

export function galaxyLabInitialCameraScale(
  fittedScale: number,
  viewportWidth: number,
): number {
  const minimumUsefulScale = viewportWidth < 720 ? 0.16 : 0.08;
  return Math.max(fittedScale, minimumUsefulScale);
}

export function writeGalaxyLabWebGpuViewProjection(
  target: Float32Array,
  transform: GalaxyLabTransform,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees = IDENTITY_GALAXY_CAMERA_FOV,
  near = DEFAULT_NEAR,
  far = DEFAULT_FAR,
): Float32Array {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const scale = Math.max(0.0001, transform.scale);
  const focalScale = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const cameraX = (width / 2 - transform.x) / scale;
  const cameraY = -(height / 2 - transform.y) / scale;
  const cameraZ = height * focalScale / 2 / scale;
  const xScale = focalScale / (width / height);
  const depthScale = far / (near - far);
  const depthTranslate = far * near / (near - far);

  target.fill(0);
  target[0] = xScale;
  target[5] = focalScale;
  target[10] = depthScale;
  target[11] = -1;
  target[12] = -xScale * cameraX;
  target[13] = -focalScale * cameraY;
  target[14] = depthTranslate - depthScale * cameraZ;
  target[15] = cameraZ;
  return target;
}
