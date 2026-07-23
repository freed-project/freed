import { describe, expect, it } from "vitest";
import { shouldContinueFriendsGalaxyFrame } from "../../src/lib/friends-galaxy-frame-loop.js";

describe("Friends Galaxy demand frame loop", () => {
  it("sleeps when the renderer is fully idle", () => {
    expect(shouldContinueFriendsGalaxyFrame(false, false, false)).toBe(false);
  });

  it("continues for explicit animation", () => {
    expect(shouldContinueFriendsGalaxyFrame(true, false, false)).toBe(true);
  });

  it("continues until dirty renderer work is submitted", () => {
    expect(shouldContinueFriendsGalaxyFrame(false, true, false)).toBe(true);
  });

  it("continues while the scalar settle deadline is pending", () => {
    expect(shouldContinueFriendsGalaxyFrame(false, false, true)).toBe(true);
  });

  it("sleeps while the graph presentation is suspended", () => {
    expect(shouldContinueFriendsGalaxyFrame(true, true, true, false)).toBe(false);
  });
});
