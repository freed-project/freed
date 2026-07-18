import { describe, expect, it } from "vitest";
import { GalaxyLabPointerRoster } from "./pointer-roster.js";

describe("Friends Galaxy pointer roster", () => {
  it("retains scalar positions in pointer order", () => {
    const roster = new GalaxyLabPointerRoster(4);

    expect(roster.begin(41, 100, 200)).toBe(0);
    expect(roster.begin(73, 300, 400)).toBe(1);
    roster.update(1, 320, 440);

    expect(roster.count).toBe(2);
    expect(roster.indexOf(41)).toBe(0);
    expect(roster.indexOf(73)).toBe(1);
    expect(roster.xAt(1)).toBe(320);
    expect(roster.yAt(1)).toBe(440);
  });

  it("tracks movement from each pointer's fixed gesture origin", () => {
    const roster = new GalaxyLabPointerRoster(2);
    const index = roster.begin(12, 20, 30);

    expect(roster.movedBeyond(index, 23, 33, 4)).toBe(true);
    expect(roster.movedBeyond(index, 22, 32, 4)).toBe(false);

    roster.update(index, 80, 90);
    expect(roster.movedBeyond(index, 22, 32, 4)).toBe(false);
  });

  it("promotes remaining pointers in order after either touch lifts", () => {
    const roster = new GalaxyLabPointerRoster(4);
    roster.begin(1, 10, 20);
    roster.begin(2, 30, 40);
    roster.begin(3, 50, 60);

    expect(roster.remove(1)).toBe(true);
    expect(roster.count).toBe(2);
    expect(roster.indexOf(2)).toBe(0);
    expect(roster.indexOf(3)).toBe(1);
    expect(roster.xAt(0)).toBe(30);
    expect(roster.yAt(1)).toBe(60);
  });

  it("rejects excess pointers without changing the active roster", () => {
    const roster = new GalaxyLabPointerRoster(2);
    roster.begin(7, 1, 2);
    roster.begin(8, 3, 4);

    expect(roster.begin(9, 5, 6)).toBe(-1);
    expect(roster.count).toBe(2);
    expect(roster.remove(99)).toBe(false);
    expect(roster.count).toBe(2);
  });
});
