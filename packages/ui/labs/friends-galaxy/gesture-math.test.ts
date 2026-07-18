import { describe, expect, it } from "vitest";
import {
  applyGalaxyLabPinch,
  applyGalaxyLabResistedZoomAt,
  applyGalaxyLabZoomAt,
  galaxyLabResistedScaleAtRatio,
  galaxyLabWheelDeltaPixels,
} from "./gesture-math.js";

describe("Friends Galaxy gesture math", () => {
  it("preserves the world point beneath a centered zoom", () => {
    const transform = { x: 36, y: -24, scale: 0.5 };
    const viewportX = 190;
    const viewportY = 422;
    const worldX = (viewportX - transform.x) / transform.scale;
    const worldY = (viewportY - transform.y) / transform.scale;

    applyGalaxyLabZoomAt(transform, viewportX, viewportY, 0.9, 0.035, 6);

    expect(transform.scale).toBe(0.9);
    expect(worldX * transform.scale + transform.x).toBeCloseTo(viewportX, 8);
    expect(worldY * transform.scale + transform.y).toBeCloseTo(viewportY, 8);
  });

  it("uses the exact touch-distance ratio and preserves the moving midpoint", () => {
    const transform = { x: 20, y: 30, scale: 0.5 };
    const previousMidpointX = 150;
    const previousMidpointY = 200;
    const worldX = (previousMidpointX - transform.x) / transform.scale;
    const worldY = (previousMidpointY - transform.y) / transform.scale;

    expect(applyGalaxyLabPinch(
      transform,
      100,
      200,
      200,
      200,
      80,
      220,
      240,
      220,
      0.035,
      0.08,
      6,
    )).toBe(true);

    expect(transform.scale).toBeCloseTo(0.8, 8);
    expect(worldX * transform.scale + transform.x).toBeCloseTo(160, 8);
    expect(worldY * transform.scale + transform.y).toBeCloseTo(220, 8);
  });

  it("clamps pinch scale without losing the active midpoint", () => {
    const transform = { x: 0, y: 0, scale: 5.8 };
    const worldX = 150 / transform.scale;
    const worldY = 100 / transform.scale;

    applyGalaxyLabPinch(
      transform,
      100,
      100,
      200,
      100,
      0,
      120,
      400,
      120,
      0.035,
      0.08,
      6,
    );

    expect(transform.scale).toBe(6);
    expect(worldX * transform.scale + transform.x).toBeCloseTo(200, 8);
    expect(worldY * transform.scale + transform.y).toBeCloseTo(120, 8);
  });

  it("keeps zoom ratios exact before outward resistance begins", () => {
    expect(galaxyLabResistedScaleAtRatio(0.5, 1.2, 0.07, 0.11, 6)).toBeCloseTo(0.6, 12);
    expect(galaxyLabResistedScaleAtRatio(0.5, 0.8, 0.07, 0.11, 6)).toBeCloseTo(0.4, 12);
  });

  it("approaches the clip-safe scale smoothly under repeated outward input", () => {
    const minimumScale = 0.07;
    const resistanceScale = 0.11;
    let scale = 0.12;
    let previousScale = scale;

    for (let index = 0; index < 200; index += 1) {
      const nextScale = galaxyLabResistedScaleAtRatio(
        scale,
        0.95,
        minimumScale,
        resistanceScale,
        6,
      );
      expect(nextScale).toBeLessThanOrEqual(previousScale);
      expect(nextScale).toBeGreaterThan(minimumScale);
      previousScale = nextScale;
      scale = nextScale;
    }

    expect(scale).toBeLessThan(0.074);
    expect(galaxyLabResistedScaleAtRatio(
      scale,
      1.05,
      minimumScale,
      resistanceScale,
      6,
    )).toBeGreaterThan(scale);
  });

  it("preserves the anchored world point while outward zoom is resisted", () => {
    const transform = { x: 36, y: -24, scale: 0.12 };
    const viewportX = 190;
    const viewportY = 422;
    const worldX = (viewportX - transform.x) / transform.scale;
    const worldY = (viewportY - transform.y) / transform.scale;

    applyGalaxyLabResistedZoomAt(
      transform,
      viewportX,
      viewportY,
      0.25,
      0.07,
      0.11,
      6,
    );

    expect(transform.scale).toBeGreaterThan(0.07);
    expect(transform.scale).toBeLessThan(0.11);
    expect(worldX * transform.scale + transform.x).toBeCloseTo(viewportX, 8);
    expect(worldY * transform.scale + transform.y).toBeCloseTo(viewportY, 8);
  });

  it("keeps pixel trackpad deltas exact", () => {
    expect(galaxyLabWheelDeltaPixels(18.5, 0, 900)).toBe(18.5);
  });

  it("normalizes line and page wheel deltas before panning", () => {
    expect(galaxyLabWheelDeltaPixels(3, 1, 900)).toBe(48);
    expect(galaxyLabWheelDeltaPixels(-0.5, 2, 800)).toBe(-400);
  });
});
