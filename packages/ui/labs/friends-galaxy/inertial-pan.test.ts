import { describe, expect, it } from "vitest";
import { GalaxyLabInertialPan } from "./inertial-pan.js";

describe("Friends Galaxy inertial pan", () => {
  it("continues a recent drag and decays to a deterministic stop", () => {
    const inertia = new GalaxyLabInertialPan();
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
    const inertia = new GalaxyLabInertialPan();
    inertia.begin(0);
    inertia.sample(20, 0, 16);
    expect(inertia.start(200, 200, false)).toBe(false);

    inertia.begin(300);
    inertia.sample(20, 0, 316);
    expect(inertia.start(318, 318, true)).toBe(false);
  });

  it("caps extreme input velocity and cancels a stalled frame", () => {
    const inertia = new GalaxyLabInertialPan();
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
    const inertia = new GalaxyLabInertialPan();
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
