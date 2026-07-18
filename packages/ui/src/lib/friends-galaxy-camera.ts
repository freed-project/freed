import { IDENTITY_GALAXY_CAMERA_FOV } from "./identity-galaxy-camera.js";
import type {
  FriendsGalaxyTransform,
  FriendsGalaxyViewportInsets,
} from "./friends-galaxy-viewport.js";

export const FRIENDS_GALAXY_CAMERA_NEAR = 1;
export const FRIENDS_GALAXY_CAMERA_FAR = 20_000;
export const FRIENDS_GALAXY_CAMERA_FAR_UTILIZATION = 0.82;
export const FRIENDS_GALAXY_CAMERA_NEAR_CLEARANCE = 96;

const ZOOM_RESISTANCE_SCALE_MULTIPLIER = 1.55;
const FIT_MINIMUM_RESISTANCE_PROGRESS = 0.12;
const OUTWARD_ZOOM_TARGET_FIT_RATIO = 0.9;
const OUTWARD_ZOOM_RESISTANCE_FIT_RATIO = 1.35;
const ABSOLUTE_MAXIMUM_SCALE = 6;

const EMPTY_VIEWPORT_INSETS: FriendsGalaxyViewportInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export interface FriendsGalaxyCameraScaleLimits {
  minimum: number;
  resistance: number;
  fitMinimum: number;
  maximum: number;
}

export interface FriendsGalaxyOutwardZoomEnvelope {
  target: number;
  resistance: number;
}

function friendsGalaxyCameraDistance(
  viewportHeight: number,
  scale: number,
  fovDegrees: number,
): number {
  const height = Math.max(1, viewportHeight);
  const safeScale = Math.max(0.0001, scale);
  const boundedFov = Math.max(1, Math.min(179, fovDegrees));
  return height / 2 / Math.tan((boundedFov * Math.PI) / 360) / safeScale;
}

export function friendsGalaxyCameraScaleLimits(
  viewportHeight: number,
  minimumSceneZ: number,
  maximumSceneZ: number,
  fovDegrees = IDENTITY_GALAXY_CAMERA_FOV,
  far = FRIENDS_GALAXY_CAMERA_FAR,
): FriendsGalaxyCameraScaleLimits {
  const focalDistance = friendsGalaxyCameraDistance(
    viewportHeight,
    1,
    fovDegrees,
  );
  const minimumDepth = Number.isFinite(minimumSceneZ) ? minimumSceneZ : 0;
  const maximumDepth = Number.isFinite(maximumSceneZ) ? maximumSceneZ : 0;
  const availableCameraDepth = Math.max(
    FRIENDS_GALAXY_CAMERA_NEAR * 2,
    far * FRIENDS_GALAXY_CAMERA_FAR_UTILIZATION + minimumDepth,
  );
  const minimum = focalDistance / availableCameraDepth;
  const resistance = minimum * ZOOM_RESISTANCE_SCALE_MULTIPLIER;
  const fitMinimum = minimum +
    (resistance - minimum) * FIT_MINIMUM_RESISTANCE_PROGRESS;
  const maximum = Math.min(
    ABSOLUTE_MAXIMUM_SCALE,
    focalDistance / Math.max(
      FRIENDS_GALAXY_CAMERA_NEAR + FRIENDS_GALAXY_CAMERA_NEAR_CLEARANCE,
      maximumDepth + FRIENDS_GALAXY_CAMERA_NEAR_CLEARANCE,
    ),
  );
  return {
    minimum,
    resistance,
    fitMinimum,
    maximum: Math.max(fitMinimum, maximum),
  };
}

export function friendsGalaxyOutwardZoomEnvelope(
  fittedScale: number,
  limits: FriendsGalaxyCameraScaleLimits,
): FriendsGalaxyOutwardZoomEnvelope {
  const boundedFit = Math.max(
    limits.fitMinimum,
    Math.min(limits.maximum, fittedScale),
  );
  const target = Math.max(
    limits.fitMinimum,
    Math.min(limits.maximum, boundedFit * OUTWARD_ZOOM_TARGET_FIT_RATIO),
  );
  const resistance = Math.max(
    target,
    Math.min(
      limits.maximum,
      Math.max(
        limits.resistance,
        boundedFit * OUTWARD_ZOOM_RESISTANCE_FIT_RATIO,
      ),
    ),
  );
  return { target, resistance };
}

export function writeFriendsGalaxyFocusedTransform(
  target: FriendsGalaxyTransform,
  worldX: number,
  worldY: number,
  worldZ: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  viewportInsets: FriendsGalaxyViewportInsets = EMPTY_VIEWPORT_INSETS,
  fovDegrees = IDENTITY_GALAXY_CAMERA_FOV,
): FriendsGalaxyTransform {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const safeScale = Math.max(0.0001, scale);
  const left = Math.max(0, viewportInsets.left);
  const right = Math.max(0, viewportInsets.right);
  const top = Math.max(0, viewportInsets.top);
  const bottom = Math.max(0, viewportInsets.bottom);
  const viewportCenterX = width * 0.5;
  const viewportCenterY = height * 0.5;
  const focusX = left + Math.max(1, width - left - right) * 0.5;
  const focusY = top + Math.max(1, height - top - bottom) * 0.5;
  const cameraZ = friendsGalaxyCameraDistance(height, safeScale, fovDegrees);
  const depthRatio = (cameraZ - worldZ) / cameraZ;

  target.scale = safeScale;
  target.x = viewportCenterX - worldX * safeScale +
    (focusX - viewportCenterX) * depthRatio;
  target.y = viewportCenterY - worldY * safeScale +
    (focusY - viewportCenterY) * depthRatio;
  return target;
}

export function friendsGalaxyInitialCameraScale(
  fittedScale: number,
  viewportWidth: number,
): number {
  const minimumUsefulScale = viewportWidth < 720 ? 0.16 : 0.08;
  return Math.max(fittedScale, minimumUsefulScale);
}

export function writeFriendsGalaxyWebGpuMotionUniforms(
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

export function writeFriendsGalaxyWebGpuViewProjection(
  target: Float32Array,
  transform: FriendsGalaxyTransform,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees = IDENTITY_GALAXY_CAMERA_FOV,
  near = FRIENDS_GALAXY_CAMERA_NEAR,
  far = FRIENDS_GALAXY_CAMERA_FAR,
): Float32Array {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const scale = Math.max(0.0001, transform.scale);
  const focalScale = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const cameraX = (width / 2 - transform.x) / scale;
  const cameraY = -(height / 2 - transform.y) / scale;
  const cameraZ = friendsGalaxyCameraDistance(height, scale, fovDegrees);
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
