import type { GalaxyLabTransform } from "./scene-fixture.js";

const MINIMUM_ZOOM_COORDINATE = -4;

function clampScale(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function galaxyLabZoomCoordinate(
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
  return (1 - 1 / normalizedRange) * resistanceRange / resistanceScale;
}

function galaxyLabScaleFromZoomCoordinate(
  coordinate: number,
  minimumScale: number,
  resistanceScale: number,
  maximumScale: number,
): number {
  const boundedCoordinate = Math.max(MINIMUM_ZOOM_COORDINATE, coordinate);
  if (boundedCoordinate >= 0) {
    return clampScale(
      resistanceScale * Math.exp(Math.min(64, boundedCoordinate)),
      minimumScale,
      maximumScale,
    );
  }
  const resistanceRange = resistanceScale - minimumScale;
  const curve = resistanceScale / resistanceRange;
  return clampScale(
    minimumScale + resistanceRange / (1 - curve * boundedCoordinate),
    minimumScale,
    maximumScale,
  );
}

export function galaxyLabResistedScaleAtRatio(
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
  const coordinate = galaxyLabZoomCoordinate(
    boundedInitial,
    minimumScale,
    boundedResistance,
  );
  return galaxyLabScaleFromZoomCoordinate(
    coordinate + Math.log(boundedRatio),
    minimumScale,
    boundedResistance,
    maximumScale,
  );
}

export function galaxyLabWheelDeltaPixels(
  delta: number,
  deltaMode: number,
  viewportExtent: number,
): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, viewportExtent);
  return delta;
}

export function applyGalaxyLabZoomAt(
  transform: GalaxyLabTransform,
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

export function applyGalaxyLabResistedZoomAt(
  transform: GalaxyLabTransform,
  viewportX: number,
  viewportY: number,
  scaleRatio: number,
  minimumScale: number,
  resistanceScale: number,
  maximumScale: number,
): void {
  const nextScale = galaxyLabResistedScaleAtRatio(
    transform.scale,
    scaleRatio,
    minimumScale,
    resistanceScale,
    maximumScale,
  );
  applyGalaxyLabZoomAt(
    transform,
    viewportX,
    viewportY,
    nextScale,
    minimumScale,
    maximumScale,
  );
}

export function applyGalaxyLabPinch(
  transform: GalaxyLabTransform,
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
  const nextScale = galaxyLabResistedScaleAtRatio(
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
