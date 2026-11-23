import { describe, expect, it } from "vitest";
import { classifyFeedFrameBudgets } from "../tests/e2e/helpers/feed-frame-budget";

// Tier 1: strict/inclusive classification and diagnostic fidelity, without timing.
describe("fast-scroll frame budgets", () => {
  const budgets = { p95Ms: 50, droppedFrames: 10 };
  it.each([
    { p95Ms: 0, droppedFrames: 0 },
    { p95Ms: 49.9, droppedFrames: 9 },
    { p95Ms: 49.9, droppedFrames: 10 },
  ])("accepts measurements within both limits: %j", (measured) => {
    expect(classifyFeedFrameBudgets(measured, budgets)).toEqual([]);
  });

  it.each([50, 50.1])("reports p95 %s at or above the strict limit", (p95Ms) => {
    expect(classifyFeedFrameBudgets({ p95Ms, droppedFrames: 10 }, budgets)).toEqual([{
      type: "perf budget exceeded (report-only)",
      description: `frame p95: ${p95Ms.toLocaleString()} ms >= 50 ms budget (requires <)`,
    }]);
  });

  it("reports dropped frames above the inclusive limit", () => {
    expect(classifyFeedFrameBudgets({ p95Ms: 49.9, droppedFrames: 11 }, budgets)).toEqual([{
      type: "perf budget exceeded (report-only)",
      description: "dropped frames: 11 > 10 budget (requires <=)",
    }]);
  });

  it("reports both breaches with the supplied measured values and budgets", () => {
    expect(classifyFeedFrameBudgets(
      { p95Ms: 25, droppedFrames: 4 }, { p95Ms: 25, droppedFrames: 3 },
    )).toEqual([
      { type: "perf budget exceeded (report-only)", description: "frame p95: 25 ms >= 25 ms budget (requires <)" },
      { type: "perf budget exceeded (report-only)", description: "dropped frames: 4 > 3 budget (requires <=)" },
    ]);
  });
});
