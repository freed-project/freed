import type { ViewTransform } from "./identity-graph-layout.js";

export const IDENTITY_GALAXY_CAMERA_FOV = 42;

export interface IdentityGalaxyCameraPose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: 0;
}

export interface IdentityGalaxyPlanePoint {
  x: number;
  y: number;
}

function identityGalaxyCameraDistance(
  viewportHeight: number,
  scale: number,
  fovDegrees: number = IDENTITY_GALAXY_CAMERA_FOV,
): number {
  const safeHeight = Math.max(1, viewportHeight);
  const safeScale = Math.max(0.0001, scale);
  return safeHeight / 2 / Math.tan((fovDegrees * Math.PI) / 360) / safeScale;
}

export function identityGalaxyCameraPose(
  transform: ViewTransform,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees: number = IDENTITY_GALAXY_CAMERA_FOV,
): IdentityGalaxyCameraPose {
  const centerX = (viewportWidth / 2 - transform.x) / transform.scale;
  const centerY = (viewportHeight / 2 - transform.y) / transform.scale;
  return {
    x: centerX,
    y: -centerY,
    z: identityGalaxyCameraDistance(viewportHeight, transform.scale, fovDegrees),
    targetX: centerX,
    targetY: -centerY,
    targetZ: 0,
  };
}

export function viewportPointToIdentityGalaxyPlane(
  viewportX: number,
  viewportY: number,
  transform: ViewTransform,
): IdentityGalaxyPlanePoint {
  return {
    x: (viewportX - transform.x) / transform.scale,
    y: (viewportY - transform.y) / transform.scale,
  };
}
