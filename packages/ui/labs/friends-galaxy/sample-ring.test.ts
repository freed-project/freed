import { describe, expect, it } from "vitest";
import {
  FriendsGalaxySampleRing,
  shouldRefreshFriendsGalaxyDiagnostics,
} from "../../src/lib/friends-galaxy-samples.js";

describe("Friends Galaxy diagnostic sample ring", () => {
  it("retains samples in insertion order before capacity", () => {
    const ring = new FriendsGalaxySampleRing(4);
    ring.push(1);
    ring.push(2);

    expect(ring.length).toBe(2);
    expect(ring.snapshot()).toEqual([1, 2]);
  });

  it("overwrites the oldest sample without changing capacity", () => {
    const ring = new FriendsGalaxySampleRing(3);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    ring.push(4);
    ring.push(5);

    expect(ring.length).toBe(3);
    expect(ring.snapshot()).toEqual([3, 4, 5]);
  });

  it("clears state and ignores non-finite samples", () => {
    const ring = new FriendsGalaxySampleRing(2);
    ring.push(Number.NaN);
    ring.push(1);
    ring.clear();

    expect(ring.length).toBe(0);
    expect(ring.snapshot()).toEqual([]);
  });

  it("defers diagnostics for the complete camera motion window", () => {
    expect(shouldRefreshFriendsGalaxyDiagnostics(true, 5_000)).toBe(false);
    expect(shouldRefreshFriendsGalaxyDiagnostics(false, 499)).toBe(false);
  });

  it("refreshes diagnostics after motion settles and the interval elapses", () => {
    expect(shouldRefreshFriendsGalaxyDiagnostics(false, 500)).toBe(true);
  });
});
