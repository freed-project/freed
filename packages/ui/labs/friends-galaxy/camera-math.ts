import { IDENTITY_GALAXY_CAMERA_FOV } from "../../src/lib/identity-galaxy-camera.js";
import type { GalaxyLabTransform } from "./scene-fixture.js";

export const GALAXY_LAB_CAMERA_NEAR = 1;
export const GALAXY_LAB_CAMERA_FAR = 20_000;
export const GALAXY_LAB_CAMERA_FAR_UTILIZATION = 0.82;

const ZOOM_RESISTANCE_SCALE_MULTIPLIER = 1.55;
const FIT_MINIMUM_RESISTANCE_PROGRESS = 0.12;

export interface GalaxyLabCameraScaleLimits {
  minimum: number;
  resistance: number;
  fitMinimum: number;
}

export function galaxyLabCameraScaleLimits(
  viewportHeight: number,
  minimumSceneZ: number,
  fovDegrees = IDENTITY_GALAXY_CAMERA_FOV,
  far = GALAXY_LAB_CAMERA_FAR,
): GalaxyLabCameraScaleLimits {
  const height = Math.max(1, viewportHeight);
  const boundedFov = Math.max(1, Math.min(179, fovDegrees));
  const focalDistance = height / 2 / Math.tan((boundedFov * Math.PI) / 360);
  const sceneDepth = Number.isFinite(minimumSceneZ) ? minimumSceneZ : 0;
  const availableCameraDepth = Math.max(
    GALAXY_LAB_CAMERA_NEAR * 2,
    far * GALAXY_LAB_CAMERA_FAR_UTILIZATION + sceneDepth,
  );
  const minimum = focalDistance / availableCameraDepth;
  const resistance = minimum * ZOOM_RESISTANCE_SCALE_MULTIPLIER;
  return {
    minimum,
    resistance,
    fitMinimum: minimum +
      (resistance - minimum) * FIT_MINIMUM_RESISTANCE_PROGRESS,
  };
}

export function galaxyLabInitialCameraScale(
  fittedScale: number,
  viewportWidth: number,
): number {
  const minimumUsefulScale = viewportWidth < 720 ? 0.16 : 0.08;
  return Math.max(fittedScale, minimumUsefulScale);
}

export function writeGalaxyLabWebGpuMotionUniforms(
  target: Float32Array,
  timeMs: number,
  cameraScale: number,
  animationEnabled: boolean,
  cameraInMotion: boolean,
): void {
  const safeScale = Math.max(0.0001, Math.abs(cameraScale));
  target[18] = animationEnabled && !cameraInMotion ? timeMs / 1_000 : -1;
  target[19] = cameraInMotion ? -safeScale : safeScale;
}

export function writeGalaxyLabWebGpuViewProjection(
  target: Float32Array,
  transform: GalaxyLabTransform,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees = IDENTITY_GALAXY_CAMERA_FOV,
  near = GALAXY_LAB_CAMERA_NEAR,
  far = GALAXY_LAB_CAMERA_FAR,
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
