import { describe, expect, it } from "vitest";
import {
  FriendsGalaxyInertialPan,
  FriendsGalaxyInertialZoom,
} from "../../src/lib/friends-galaxy-inertia.js";
import { friendsGalaxyResistedScaleAtRatio } from "../../src/lib/friends-galaxy-gesture.js";

describe("Friends Galaxy inertial pan", () => {
  it("continues a recent drag and decays to a deterministic stop", () => {
    const inertia = new FriendsGalaxyInertialPan();
    inertia.begin(0);
    inertia.sample(16, 8, 16);
    inertia.sample(20, 10, 32);

    expect(inertia.start(34, 100, false)).toBe(true);
    const first = inertia.step(116);
    expect(first.deltaX).toBeGreaterThan(0);
    expect(first.deltaY).toBeGreaterThan(0);
    expect(first.active).toBe(true);

    const second = inertia.step(132);
    expect(second).toBe(first);

    let finished = false;
    for (let timeMs = 148; timeMs <= 2_500; timeMs += 16) {
      const step = inertia.step(timeMs);
      if (step.finished) {
        finished = true;
        break;
      }
    }
    expect(finished).toBe(true);
    expect(inertia.isActive).toBe(false);
  });

  it("does not throw after a stale release or under reduced motion", () => {
    const inertia = new FriendsGalaxyInertialPan();
    inertia.begin(0);
    inertia.sample(20, 0, 16);
    expect(inertia.start(200, 200, false)).toBe(false);

    inertia.begin(300);
    inertia.sample(20, 0, 316);
    expect(inertia.start(318, 318, true)).toBe(false);
  });

  it("caps extreme input velocity and cancels a stalled frame", () => {
    const inertia = new FriendsGalaxyInertialPan();
    inertia.begin(0);
    inertia.sample(1_000, 1_000, 1);
    expect(Math.hypot(
      inertia.currentVelocityX,
      inertia.currentVelocityY,
    )).toBeCloseTo(3.2, 8);
    expect(inertia.start(2, 20, false)).toBe(true);
    expect(inertia.step(200)).toEqual({
      deltaX: 0,
      deltaY: 0,
      active: false,
      finished: true,
    });
  });

  it("stops immediately when new input cancels the throw", () => {
    const inertia = new FriendsGalaxyInertialPan();
    inertia.begin(0);
    inertia.sample(24, -12, 16);
    expect(inertia.start(18, 40, false)).toBe(true);
    inertia.cancel();

    expect(inertia.isActive).toBe(false);
    expect(inertia.step(56)).toEqual({
      deltaX: 0,
      deltaY: 0,
      active: false,
      finished: false,
    });
  });
});

describe("Friends Galaxy inertial zoom", () => {
  it("continues an inward pinch in log scale and decays to a stop", () => {
    const inertia = new FriendsGalaxyInertialZoom();
    inertia.begin(0);
    inertia.sample(1.08, 16);
    inertia.sample(1.1, 32);

    expect(inertia.start(34, 100, false)).toBe(true);
    const first = inertia.step(116);
    expect(first.scaleRatio).toBeGreaterThan(1);
    expect(first.active).toBe(true);

    const second = inertia.step(132);
    expect(second).toBe(first);

    let finished = false;
    for (let timeMs = 148; timeMs <= 2_500; timeMs += 16) {
      if (inertia.step(timeMs).finished) {
        finished = true;
        break;
      }
    }
    expect(finished).toBe(true);
    expect(inertia.isActive).toBe(false);
  });

  it("preserves outward zoom direction", () => {
    const inertia = new FriendsGalaxyInertialZoom();
    inertia.begin(0);
    inertia.sample(0.92, 16);
    inertia.sample(0.9, 32);

    expect(inertia.start(34, 100, false)).toBe(true);
    expect(inertia.step(116).scaleRatio).toBeLessThan(1);
  });

  it("coasts into the soft outer envelope without crossing its target", () => {
    const inertia = new FriendsGalaxyInertialZoom();
    inertia.begin(0);
    inertia.sample(0.92, 16);
    inertia.sample(0.9, 32);
    expect(inertia.start(34, 100, false)).toBe(true);

    let scale = 0.12;
    for (let timeMs = 116; timeMs <= 2_500; timeMs += 16) {
      const step = inertia.step(timeMs);
      scale = friendsGalaxyResistedScaleAtRatio(
        scale,
        step.scaleRatio,
        0.09,
        0.12,
        6,
      );
      expect(scale).toBeGreaterThan(0.09);
      if (step.finished) break;
    }
  });

  it("uses native inward speed immediately from the outer envelope", () => {
    const inertia = new FriendsGalaxyInertialZoom();
    inertia.begin(0);
    inertia.sample(1.04, 16);
    inertia.sample(1.05, 32);
    expect(inertia.start(34, 100, false)).toBe(true);

    const initialScale = 0.0901;
    const ratio = inertia.step(116).scaleRatio;
    expect(friendsGalaxyResistedScaleAtRatio(
      initialScale,
      ratio,
      0.09,
      0.12,
      6,
    )).toBeCloseTo(initialScale * ratio, 12);
  });

  it("does not coast after a stale release or under reduced motion", () => {
    const inertia = new FriendsGalaxyInertialZoom();
    inertia.begin(0);
    inertia.sample(1.1, 16);
    expect(inertia.start(200, 200, false)).toBe(false);

    inertia.begin(300);
    inertia.sample(1.1, 316);
    expect(inertia.start(318, 318, true)).toBe(false);
  });

  it("caps extreme log velocity and cancels a stalled frame", () => {
    const inertia = new FriendsGalaxyInertialZoom();
    inertia.begin(0);
    inertia.sample(Number.MAX_VALUE, 1);
    expect(inertia.currentLogScaleVelocity).toBeCloseTo(0.0032, 8);
    expect(inertia.start(2, 20, false)).toBe(true);
    expect(inertia.step(200)).toEqual({
      scaleRatio: 1,
      active: false,
      finished: true,
    });
  });

  it("stops immediately when new input cancels the coast", () => {
    const inertia = new FriendsGalaxyInertialZoom();
    inertia.begin(0);
    inertia.sample(1.12, 16);
    expect(inertia.start(18, 40, false)).toBe(true);
    inertia.cancel();

    expect(inertia.isActive).toBe(false);
    expect(inertia.step(56)).toEqual({
      scaleRatio: 1,
      active: false,
      finished: false,
    });
  });
});
