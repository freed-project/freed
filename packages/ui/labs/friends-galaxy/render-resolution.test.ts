import { describe, expect, it } from "vitest";
import {
  friendsGalaxyRenderPixelRatio,
  friendsGalaxyViewDetailForScale,
} from "../../src/lib/friends-galaxy-renderer.js";

describe("Friends Galaxy render resolution", () => {
  it("caps settled Retina rendering without dropping below native density", () => {
    expect(friendsGalaxyRenderPixelRatio(3, 390, false)).toBe(1.5);
    expect(friendsGalaxyRenderPixelRatio(2, 1_280, false)).toBe(1.5);
    expect(friendsGalaxyRenderPixelRatio(1, 1_280, false)).toBe(1);
  });

  it("uses a lower motion density on compact and wide canvases", () => {
    expect(friendsGalaxyRenderPixelRatio(3, 390, true)).toBe(1);
    expect(friendsGalaxyRenderPixelRatio(2, 1_280, true)).toBe(1.25);
  });

  it("normalizes invalid device ratios", () => {
    expect(friendsGalaxyRenderPixelRatio(Number.NaN, 390, false)).toBe(1);
    expect(friendsGalaxyRenderPixelRatio(0, 390, true)).toBe(1);
  });

  it("shares stable overview, middle, and close detail thresholds", () => {
    expect(friendsGalaxyViewDetailForScale(0.239)).toBe("overview");
    expect(friendsGalaxyViewDetailForScale(0.24)).toBe("middle");
    expect(friendsGalaxyViewDetailForScale(0.899)).toBe("middle");
    expect(friendsGalaxyViewDetailForScale(0.9)).toBe("close");
    expect(friendsGalaxyViewDetailForScale(Number.NaN)).toBe("overview");
  });
});
