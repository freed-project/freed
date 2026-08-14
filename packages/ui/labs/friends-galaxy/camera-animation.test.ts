import { describe, expect, it } from "vitest";
import {
  FRIENDS_GALAXY_FIT_ANIMATION_DURATION_MS,
  FriendsGalaxyCameraFitAnimation,
} from "../../src/lib/friends-galaxy-camera-animation.js";
import type { FriendsGalaxyTransform } from "../../src/lib/friends-galaxy-viewport.js";

function cameraCenter(
  transform: FriendsGalaxyTransform,
  viewportCenterX: number,
  viewportCenterY: number,
): { x: number; y: number } {
  return {
    x: (viewportCenterX - transform.x) / transform.scale,
    y: (viewportCenterY - transform.y) / transform.scale,
  };
}

describe("Friends Galaxy Fit all camera animation", () => {
  it("interpolates world-center pan and logarithmic zoom before landing exactly", () => {
    const animation = new FriendsGalaxyCameraFitAnimation();
    const source = { x: 120, y: -80, scale: 1.6 };
    const target = { x: 620, y: 340, scale: 0.4 };
    const viewportCenterX = 720;
    const viewportCenterY = 450;
    const startedAt = 1_000;

    expect(animation.start(
      source,
      target,
      viewportCenterX,
      viewportCenterY,
      startedAt,
      false,
    )).toBe(true);

    const halfway = animation.step(
      startedAt + FRIENDS_GALAXY_FIT_ANIMATION_DURATION_MS / 2,
    );
    const sourceCenter = cameraCenter(source, viewportCenterX, viewportCenterY);
    const targetCenter = cameraCenter(target, viewportCenterX, viewportCenterY);
    const halfwayCenter = cameraCenter(
      halfway.transform,
      viewportCenterX,
      viewportCenterY,
    );

    expect(halfway.active).toBe(true);
    expect(halfway.finished).toBe(false);
    expect(halfway.transform).not.toEqual(source);
    expect(halfway.transform).not.toEqual(target);
    expect(halfway.transform.scale).toBeCloseTo(
      Math.sqrt(source.scale * target.scale),
      12,
    );
    expect(halfwayCenter.x).toBeCloseTo(
      (sourceCenter.x + targetCenter.x) / 2,
      12,
    );
    expect(halfwayCenter.y).toBeCloseTo(
      (sourceCenter.y + targetCenter.y) / 2,
      12,
    );

    const finished = animation.step(
      startedAt + FRIENDS_GALAXY_FIT_ANIMATION_DURATION_MS,
    );
    expect(finished.transform).toEqual(target);
    expect(finished.active).toBe(false);
    expect(finished.finished).toBe(true);
    expect(animation.isActive).toBe(false);
  });

  it("declines animation for reduced motion and identical transforms", () => {
    const animation = new FriendsGalaxyCameraFitAnimation();
    const transform = { x: 320, y: 240, scale: 0.75 };

    expect(animation.start(transform, transform, 640, 360, 0, false)).toBe(false);
    expect(animation.start(
      transform,
      { x: 100, y: 80, scale: 1.2 },
      640,
      360,
      0,
      true,
    )).toBe(false);
    expect(animation.isActive).toBe(false);
  });

  it("stops immediately when direct camera input interrupts it", () => {
    const animation = new FriendsGalaxyCameraFitAnimation();
    expect(animation.start(
      { x: 100, y: 80, scale: 1.2 },
      { x: 320, y: 240, scale: 0.4 },
      640,
      360,
      0,
      false,
    )).toBe(true);

    animation.cancel();

    expect(animation.isActive).toBe(false);
    expect(animation.step(100).active).toBe(false);
    expect(animation.step(100).finished).toBe(false);
  });
});
