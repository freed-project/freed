import { describe, expect, it } from "vitest";
import { galaxyLabRenderPixelRatio } from "./backend.js";

describe("Friends Galaxy render resolution", () => {
  it("caps settled Retina rendering without dropping below native density", () => {
    expect(galaxyLabRenderPixelRatio(3, 390, false)).toBe(1.5);
    expect(galaxyLabRenderPixelRatio(2, 1_280, false)).toBe(1.5);
    expect(galaxyLabRenderPixelRatio(1, 1_280, false)).toBe(1);
  });

  it("uses a lower motion density on compact and wide canvases", () => {
    expect(galaxyLabRenderPixelRatio(3, 390, true)).toBe(1);
    expect(galaxyLabRenderPixelRatio(2, 1_280, true)).toBe(1.25);
  });

  it("normalizes invalid device ratios", () => {
    expect(galaxyLabRenderPixelRatio(Number.NaN, 390, false)).toBe(1);
    expect(galaxyLabRenderPixelRatio(0, 390, true)).toBe(1);
  });
});
