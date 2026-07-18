import { describe, expect, it } from "vitest";
import { GalaxyLabSettleScheduler } from "./settle-scheduler.js";

describe("Friends Galaxy settle scheduler", () => {
  it("replaces repeated movement with the latest scalar deadline", () => {
    const scheduler = new GalaxyLabSettleScheduler();
    scheduler.schedule(1, 100);
    scheduler.schedule(2, 180);

    expect(scheduler.isPending).toBe(true);
    expect(scheduler.takeDue(319)).toBeNull();
    expect(scheduler.takeDue(320)).toBe(2);
    expect(scheduler.isPending).toBe(false);
  });

  it("delivers each settled generation once", () => {
    const scheduler = new GalaxyLabSettleScheduler();
    scheduler.schedule(7, 100);

    expect(scheduler.takeDue(240)).toBe(7);
    expect(scheduler.takeDue(400)).toBeNull();
  });

  it("cancels pending settle work when a new gesture starts", () => {
    const scheduler = new GalaxyLabSettleScheduler();
    scheduler.schedule(3, 100);
    scheduler.cancel();

    expect(scheduler.takeDue(1_000)).toBeNull();
  });
});
