import { describe, expect, it } from "vitest";
import {
  applyFriendsGalaxyPinch,
  applyFriendsGalaxyResistedZoomAt,
  applyFriendsGalaxyZoomAt,
  friendsGalaxyGestureScaleRatio,
  friendsGalaxyResistedScaleAtRatio,
  friendsGalaxyWheelDeltaPixels,
} from "../../src/lib/friends-galaxy-gesture.js";

describe("Friends Galaxy gesture math", () => {
  it("preserves the world point beneath a centered zoom", () => {
    const transform = { x: 36, y: -24, scale: 0.5 };
    const viewportX = 190;
    const viewportY = 422;
    const worldX = (viewportX - transform.x) / transform.scale;
    const worldY = (viewportY - transform.y) / transform.scale;

    applyFriendsGalaxyZoomAt(transform, viewportX, viewportY, 0.9, 0.035, 6);

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

    expect(applyFriendsGalaxyPinch(
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

    applyFriendsGalaxyPinch(
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

  it("keeps native touch distance exact inside the ceiling band", () => {
    const transform = { x: 0, y: 0, scale: 0.0901 };

    applyFriendsGalaxyPinch(
      transform,
      100,
      100,
      200,
      100,
      98,
      100,
      202,
      100,
      0.09,
      0.12,
      6,
    );

    expect(transform.scale).toBeCloseTo(0.0901 * 1.04, 12);
  });

  it("keeps zoom ratios exact before outward resistance begins", () => {
    expect(friendsGalaxyResistedScaleAtRatio(0.5, 1.2, 0.07, 0.11, 6)).toBeCloseTo(0.6, 12);
    expect(friendsGalaxyResistedScaleAtRatio(0.5, 0.8, 0.07, 0.11, 6)).toBeCloseTo(0.4, 12);
  });

  it("approaches the clip-safe scale smoothly under repeated outward input", () => {
    const minimumScale = 0.07;
    const resistanceScale = 0.11;
    let scale = 0.12;
    let previousScale = scale;

    for (let index = 0; index < 200; index += 1) {
      const nextScale = friendsGalaxyResistedScaleAtRatio(
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

    expect(scale).toBeLessThan(0.078);
    expect(friendsGalaxyResistedScaleAtRatio(
      scale,
      1.05,
      minimumScale,
      resistanceScale,
      6,
    )).toBeCloseTo(scale * 1.05, 12);
  });

  it("keeps decelerating without reaching a discrete outward stop", () => {
    const targetScale = 0.09;
    const resistanceScale = 0.12;
    let scale = resistanceScale;

    for (let index = 0; index < 1_200; index += 1) {
      const nextScale = friendsGalaxyResistedScaleAtRatio(
        scale,
        0.995,
        targetScale,
        resistanceScale,
        6,
      );
      expect(nextScale).toBeLessThan(scale);
      expect(nextScale).toBeGreaterThan(targetScale);
      scale = nextScale;
    }

    expect(scale).toBeLessThan(0.096);
  });

  it("brakes outward input more aggressively inside the ceiling band", () => {
    const scale = friendsGalaxyResistedScaleAtRatio(
      0.12,
      0.5,
      0.09,
      0.12,
      6,
    );

    expect(scale).toBeCloseTo(0.10310327153353985, 12);
    expect(scale).toBeGreaterThan(0.1);
  });

  it("escapes the compressed ceiling at full overview speed", () => {
    const scale = friendsGalaxyResistedScaleAtRatio(
      0.0901,
      1.04,
      0.09,
      0.12,
      6,
      0.12,
    );

    expect(scale).toBeCloseTo(0.0901 + 0.12 * Math.log(1.04), 12);
    expect(scale).toBeGreaterThan(0.0901 * 1.04);
  });

  it("reverses a cumulative Safari gesture at full overview speed", () => {
    const scale = 0.0901;
    const ratio = friendsGalaxyGestureScaleRatio(0.72, 0.74);

    expect(ratio).toBeCloseTo(0.74 / 0.72, 12);
    const nextScale = friendsGalaxyResistedScaleAtRatio(
      scale,
      ratio,
      0.09,
      0.12,
      6,
      0.12,
    );

    expect(nextScale).toBeCloseTo(scale + 0.12 * Math.log(ratio), 12);
    expect(nextScale).toBeGreaterThan(scale * ratio);
  });

  it("ignores invalid cumulative gesture scales", () => {
    expect(friendsGalaxyGestureScaleRatio(0, 0.8)).toBe(1);
    expect(friendsGalaxyGestureScaleRatio(0.8, Number.NaN)).toBe(1);
  });

  it("preserves the anchored world point while outward zoom is resisted", () => {
    const transform = { x: 36, y: -24, scale: 0.12 };
    const viewportX = 190;
    const viewportY = 422;
    const worldX = (viewportX - transform.x) / transform.scale;
    const worldY = (viewportY - transform.y) / transform.scale;

    applyFriendsGalaxyResistedZoomAt(
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
    expect(friendsGalaxyWheelDeltaPixels(18.5, 0, 900)).toBe(18.5);
  });

  it("normalizes line and page wheel deltas before panning", () => {
    expect(friendsGalaxyWheelDeltaPixels(3, 1, 900)).toBe(48);
    expect(friendsGalaxyWheelDeltaPixels(-0.5, 2, 800)).toBe(-400);
  });
});
