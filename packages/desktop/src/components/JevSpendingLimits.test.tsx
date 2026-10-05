import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../lib/jev-client", () => ({ getJevBudget: get, setJevBudget: set, onJevBudgetChange: () => () => {} }));
import { JevSpendingLimits } from "./JevSpendingLimits";
// Tier 1: opt-in approved defaults, honest reservation disclosure and persisted limits.
describe("Jev spending controls", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });
  it("shows defaults but does not enable spending until explicitly saved", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); get.mockResolvedValue(null);
    set.mockResolvedValue({ limits: { dailyNanoUsd: 1e9, monthlyNanoUsd: 10e9, totalNanoUsd: null }, dailyReservedNanoUsd: 0, monthlyReservedNanoUsd: 0, totalReservedNanoUsd: 0 });
    const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
    await act(async () => root.render(<JevSpendingLimits />));
    expect(Array.from(node.querySelectorAll("input")).map(input => input.value)).toEqual(["1", "10", ""]);
    expect(set).not.toHaveBeenCalled(); expect(node.textContent).toContain("not billed charges"); expect(node.textContent).toContain("midnight UTC");
    await act(async () => node.querySelector("button")!.click());
    expect(set).toHaveBeenCalledWith({ dailyNanoUsd: 1e9, monthlyNanoUsd: 10e9, totalNanoUsd: null });
    await act(async () => root.unmount());
  });
  it("shows fail-closed history errors rather than silently enabling defaults", async () => {
    get.mockRejectedValue(new Error("corrupt")); const node = document.createElement("div"); const root = createRoot(node);
    await act(async () => root.render(<JevSpendingLimits />));
    expect(node.textContent).toContain("requests are blocked"); expect(set).not.toHaveBeenCalled(); await act(async () => root.unmount());
  });
});
