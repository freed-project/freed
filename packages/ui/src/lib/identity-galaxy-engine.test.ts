import { describe, expect, it } from "vitest";
import { galaxyLabelVisibilityPolicy } from "./identity-galaxy-engine.js";

describe("galaxy label visibility", () => {
  it.each(["three-starfield", "canvas-starfield-fallback"] as const)(
    "keeps every detail label without selection in %s",
    (renderer) => {
      for (const width of [390, 1280]) {
        expect(galaxyLabelVisibilityPolicy("detail", width, renderer)).toEqual({
          cap: Infinity,
          suppressOverlaps: false,
        });
      }
    },
  );

  it("preserves distant-cloud caps and collision suppression", () => {
    for (const lod of ["overview", "middle"] as const) {
      expect(galaxyLabelVisibilityPolicy(lod, 390, "three-starfield")).toEqual({ cap: 24, suppressOverlaps: true });
      expect(galaxyLabelVisibilityPolicy(lod, 1280, "three-starfield")).toEqual({ cap: 96, suppressOverlaps: true });
      expect(galaxyLabelVisibilityPolicy(lod, 1280, "canvas-starfield-fallback")).toEqual({ cap: 72, suppressOverlaps: true });
    }
  });
});
