import { describe, expect, it } from "vitest";
import { shouldContinueGalaxyLabFrame } from "./frame-loop.js";

describe("Friends Galaxy demand frame loop", () => {
  it("sleeps when the renderer is fully idle", () => {
    expect(shouldContinueGalaxyLabFrame(false, false, false)).toBe(false);
  });

  it("continues for explicit animation", () => {
    expect(shouldContinueGalaxyLabFrame(true, false, false)).toBe(true);
  });

  it("continues until dirty renderer work is submitted", () => {
    expect(shouldContinueGalaxyLabFrame(false, true, false)).toBe(true);
  });

  it("continues while the scalar settle deadline is pending", () => {
    expect(shouldContinueGalaxyLabFrame(false, false, true)).toBe(true);
  });

  it("sleeps while the graph presentation is suspended", () => {
    expect(shouldContinueGalaxyLabFrame(true, true, true, false)).toBe(false);
  });
});
