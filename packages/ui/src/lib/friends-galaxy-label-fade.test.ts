import { describe, expect, it } from "vitest";
import { FriendsGalaxyLabelFade } from "./friends-galaxy-label-fade.js";

describe("Friends Galaxy label timeline", () => {
  it("uses the same elapsed duration in either direction, including slow frames", () => {
    const fade = new FriendsGalaxyLabelFade<{ id: string }>();
    const pool = fade.mergePool([{ id: "one" }]);
    const visible = new Set(["one"]);
    expect(fade.step(pool, visible, 0, true)[0]?.opacity).toBe(0);
    expect(fade.step(pool, visible, 120, true)[0]?.opacity).toBe(0.5);
    expect(fade.step(pool, visible, 240, true)[0]?.opacity).toBe(1);
    expect(fade.step(pool, new Set(), 1_000, true)[0]?.opacity).toBe(1);
    expect(fade.step(pool, new Set(), 1_120, true)[0]?.opacity).toBe(0.5);
    expect(fade.step(pool, new Set(), 1_240, true)).toEqual([]);
    expect(fade.isActive).toBe(false);
  });

  it("retains outgoing atlas rows and reverses from the current opacity", () => {
    const fade = new FriendsGalaxyLabelFade<{ id: string }>();
    let pool = fade.mergePool([{ id: "one" }]);
    fade.step(pool, new Set(["one"]), 0, true);
    fade.step(pool, new Set(["one"]), 240, true);
    pool = fade.mergePool([{ id: "two" }]);
    expect(pool.map((label) => label.id)).toEqual(["two", "one"]);
    expect(fade.eligible(pool).map((label) => label.id)).toEqual(["two"]);
    fade.step(pool, new Set(["two"]), 250, true);
    expect(fade.step(pool, new Set(["two"]), 370, true).find((entry) => entry.label.id === "one")?.opacity).toBe(0.5);
    pool = fade.mergePool([{ id: "one" }]);
    expect(fade.step(pool, new Set(["one"]), 380, true)[0]?.opacity).toBe(0.5);
    expect(fade.step(pool, new Set(["one"]), 500, true)[0]?.opacity).toBe(1);
  });

  it("snaps reduced motion and does not charge new targets for idle time", () => {
    const fade = new FriendsGalaxyLabelFade<{ id: string }>();
    const pool = fade.mergePool([{ id: "one" }]);
    fade.step(pool, new Set(), 0, true);
    expect(fade.step(pool, new Set(["one"]), 50_000, true)[0]?.opacity).toBe(0);
    expect(fade.step(pool, new Set(["one"]), 50_001, false)[0]?.opacity).toBe(1);
    expect(fade.step(pool, new Set(), 50_002, false)).toEqual([]);
    expect(fade.isActive).toBe(false);
  });

  it("bounds retained outgoing metadata and clears it on disposal", () => {
    const fade = new FriendsGalaxyLabelFade<{ id: string }>();
    const initial = Array.from({ length: 192 }, (_, index) => ({ id: String(index) }));
    fade.mergePool(initial);
    fade.step(initial, new Set(initial.map((label) => label.id)), 0, false);
    expect(fade.mergePool([{ id: "next" }])).toHaveLength(193);
    fade.clear();
    expect(fade.mergePool([{ id: "final" }])).toEqual([{ id: "final" }]);
    expect(fade.isActive).toBe(false);
  });
});
