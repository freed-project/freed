import type { FriendsGalaxyTransform } from "./friends-galaxy-viewport.js";

const OUTWARD_RESISTANCE_CURVE_POWER = 0.15;

function clampScale(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function friendsGalaxyZoomCoordinate(
  scale: number,
  minimumScale: number,
  resistanceScale: number,
): number {
  if (scale >= resistanceScale) return Math.log(scale / resistanceScale);
  const resistanceRange = resistanceScale - minimumScale;
  const normalizedRange = Math.max(
    Number.EPSILON,
    (scale - minimumScale) / resistanceRange,
  );
  const curve = resistanceScale /
    (resistanceRange * OUTWARD_RESISTANCE_CURVE_POWER);
  return (1 - Math.pow(
    normalizedRange,
    -1 / OUTWARD_RESISTANCE_CURVE_POWER,
  )) / curve;
}

function friendsGalaxyScaleFromZoomCoordinate(
  coordinate: number,
  minimumScale: number,
  resistanceScale: number,
  maximumScale: number,
): number {
  if (coordinate >= 0) {
    return clampScale(
      resistanceScale * Math.exp(Math.min(64, coordinate)),
      minimumScale,
      maximumScale,
    );
  }
  const resistanceRange = resistanceScale - minimumScale;
  const curve = resistanceScale /
    (resistanceRange * OUTWARD_RESISTANCE_CURVE_POWER);
  return clampScale(
    minimumScale + resistanceRange * Math.pow(
      1 - curve * coordinate,
      -OUTWARD_RESISTANCE_CURVE_POWER,
    ),
    minimumScale,
    maximumScale,
  );
}

export function friendsGalaxyResistedScaleAtRatio(
  initialScale: number,
  scaleRatio: number,
  minimumScale: number,
  resistanceScale: number,
  maximumScale: number,
): number {
  const boundedResistance = Math.max(
    minimumScale + Number.EPSILON,
    Math.min(maximumScale, resistanceScale),
  );
  const boundedInitial = clampScale(initialScale, minimumScale, maximumScale);
  const boundedRatio = scaleRatio === 0
    ? Number.MIN_VALUE
    : scaleRatio === Number.POSITIVE_INFINITY
      ? Number.MAX_VALUE
      : Number.isFinite(scaleRatio) && scaleRatio > 0
        ? scaleRatio
        : 1;
  if (boundedRatio >= 1) {
    return Math.min(maximumScale, boundedInitial * boundedRatio);
  }
  const coordinate = friendsGalaxyZoomCoordinate(
    boundedInitial,
    minimumScale,
    boundedResistance,
  );
  return friendsGalaxyScaleFromZoomCoordinate(
    coordinate + Math.log(boundedRatio),
    minimumScale,
    boundedResistance,
    maximumScale,
  );
}

export function friendsGalaxyWheelDeltaPixels(
  delta: number,
  deltaMode: number,
  viewportExtent: number,
): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, viewportExtent);
  return delta;
}

export function friendsGalaxyGestureScaleRatio(
  previousScale: number,
  nextScale: number,
): number {
  if (
    !Number.isFinite(previousScale) || previousScale <= 0 ||
    !Number.isFinite(nextScale) || nextScale <= 0
  ) return 1;
  return nextScale / previousScale;
}

export function applyFriendsGalaxyZoomAt(
  transform: FriendsGalaxyTransform,
  viewportX: number,
  viewportY: number,
  nextScale: number,
  minimumScale: number,
  maximumScale: number,
): void {
  const clampedScale = clampScale(nextScale, minimumScale, maximumScale);
  const worldX = (viewportX - transform.x) / transform.scale;
  const worldY = (viewportY - transform.y) / transform.scale;
  transform.scale = clampedScale;
  transform.x = viewportX - worldX * clampedScale;
  transform.y = viewportY - worldY * clampedScale;
}

export function applyFriendsGalaxyResistedZoomAt(
  transform: FriendsGalaxyTransform,
  viewportX: number,
  viewportY: number,
  scaleRatio: number,
  minimumScale: number,
  resistanceScale: number,
  maximumScale: number,
): void {
  const nextScale = friendsGalaxyResistedScaleAtRatio(
    transform.scale,
    scaleRatio,
    minimumScale,
    resistanceScale,
    maximumScale,
  );
  applyFriendsGalaxyZoomAt(
    transform,
    viewportX,
    viewportY,
    nextScale,
    minimumScale,
    maximumScale,
  );
}

export function applyFriendsGalaxyPinch(
  transform: FriendsGalaxyTransform,
  previousFirstX: number,
  previousFirstY: number,
  previousSecondX: number,
  previousSecondY: number,
  nextFirstX: number,
  nextFirstY: number,
  nextSecondX: number,
  nextSecondY: number,
  minimumScale: number,
  resistanceScale: number,
  maximumScale: number,
): boolean {
  const previousDistance = Math.hypot(
    previousSecondX - previousFirstX,
    previousSecondY - previousFirstY,
  );
  if (previousDistance <= 0) return false;
  const nextDistance = Math.max(
    1,
    Math.hypot(nextSecondX - nextFirstX, nextSecondY - nextFirstY),
  );
  const previousMidpointX = (previousFirstX + previousSecondX) * 0.5;
  const previousMidpointY = (previousFirstY + previousSecondY) * 0.5;
  const nextMidpointX = (nextFirstX + nextSecondX) * 0.5;
  const nextMidpointY = (nextFirstY + nextSecondY) * 0.5;
  const worldX = (previousMidpointX - transform.x) / transform.scale;
  const worldY = (previousMidpointY - transform.y) / transform.scale;
  const nextScale = friendsGalaxyResistedScaleAtRatio(
    transform.scale,
    nextDistance / previousDistance,
    minimumScale,
    resistanceScale,
    maximumScale,
  );
  transform.scale = nextScale;
  transform.x = nextMidpointX - worldX * nextScale;
  transform.y = nextMidpointY - worldY * nextScale;
  return true;
}
