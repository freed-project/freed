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
  it("restores saved custom limits and reservations without enabling or resetting spending", async () => {
    get.mockResolvedValue({
      limits: { dailyNanoUsd: 2e9, monthlyNanoUsd: 20e9, totalNanoUsd: 25e9 },
      dailyReservedNanoUsd: 250_000_000, monthlyReservedNanoUsd: 750_000_000, totalReservedNanoUsd: 1_250_000_000,
    });
    const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
    await act(async () => root.render(<JevSpendingLimits />));
    expect(Array.from(node.querySelectorAll("input")).map(input => input.value)).toEqual(["2", "20", "25"]);
    expect(node.textContent).toContain("Limits enabled.");
    expect(node.textContent).toMatch(/Reserved today: [^;]*0[.,]25;/);
    expect(node.textContent).toMatch(/this month: [^;]*0[.,]75;/);
    expect(node.textContent).toMatch(/total: [^.]*1[.,]25/);
    expect(set).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it("preserves saved reservations and custom fields when saving fails", async () => {
    get.mockResolvedValue({
      limits: { dailyNanoUsd: 2e9, monthlyNanoUsd: 20e9, totalNanoUsd: 25e9 },
      dailyReservedNanoUsd: 250_000_000, monthlyReservedNanoUsd: 750_000_000, totalReservedNanoUsd: 1_250_000_000,
    });
    set.mockRejectedValueOnce(new Error("Could not save Jev limits."));
    const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
    await act(async () => root.render(<JevSpendingLimits />));
    await act(async () => node.querySelector("button")!.click());
    expect(set).toHaveBeenCalledExactlyOnceWith({ dailyNanoUsd: 2e9, monthlyNanoUsd: 20e9, totalNanoUsd: 25e9 });
    expect(Array.from(node.querySelectorAll("input")).map(input => input.value)).toEqual(["2", "20", "25"]);
    expect(node.textContent).toContain("Could not save Jev limits.");
    expect(node.textContent).not.toContain("Limits saved.");
    expect(node.textContent).toMatch(/Reserved today: [^;]*0[.,]25;/);
    expect(node.textContent).toMatch(/this month: [^;]*0[.,]75;/);
    expect(node.textContent).toMatch(/total: [^.]*1[.,]25/);
    expect(node.querySelector("button")!.disabled).toBe(false);
    await act(async () => root.unmount());
  });
});
