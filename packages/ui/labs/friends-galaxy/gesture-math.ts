import type { GalaxyLabTransform } from "./scene-fixture.js";

function clampScale(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
  const nextScale = clampScale(
    transform.scale * nextDistance / previousDistance,
    minimumScale,
    maximumScale,
  );
  transform.scale = nextScale;
  transform.x = nextMidpointX - worldX * nextScale;
  transform.y = nextMidpointY - worldY * nextScale;
  return true;
}
