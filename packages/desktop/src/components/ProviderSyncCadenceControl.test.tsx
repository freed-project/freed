import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RandomSource } from "../lib/provider-sync-cadence";
import {
  getAutomaticProviderSyncEnabled,
  getProviderScheduleSnapshot,
  initializeProviderSchedules,
} from "../lib/provider-sync-schedule-state";
import { ProviderSyncCadenceControl } from "./ProviderSyncCadenceControl";

function deterministicRandom(): RandomSource {
  let cursor = 0;
  return {
    uniform: () => ((cursor++ % 89) + 0.5) / 89,
    id: () => `ui-${String(cursor)}`,
  };
}

describe("ProviderSyncCadenceControl", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    initializeProviderSchedules({ now: 1_000, random: deterministicRandom() });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderControl() {
    await act(async () => {
      root.render(<ProviderSyncCadenceControl provider="facebook" />);
    });
  }

  it("exposes generated bounds, next sync, pace, and both kill switches", async () => {
    await renderControl();

    expect(container.textContent).toContain("Generated");
    expect(container.textContent).toContain("Next automatic sync");
    expect(container.textContent).toContain("Current pace factor");
    const globalSwitch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Automatic provider sync"]',
    )!;
    const providerSwitch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Automatic facebook sync"]',
    )!;
    expect(globalSwitch.getAttribute("aria-checked")).toBe("true");
    expect(providerSwitch.disabled).toBe(false);

    await act(async () => globalSwitch.click());
    expect(getAutomaticProviderSyncEnabled()).toBe(false);
    expect(providerSwitch.disabled).toBe(true);
  });

  it("saves custom bounds and resets them to fresh generated defaults", async () => {
    await renderControl();
    const before = getProviderScheduleSnapshot("facebook").record!;
    const lower = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => {
      lower.value = "0.2";
      lower.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    const custom = getProviderScheduleSnapshot("facebook").record!;
    expect(custom.bounds.source).toBe("custom");
    expect(custom.bounds.lowerMs).toBe(12 * 60_000);

    const reset = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Reset to fresh generated defaults"),
    )!;
    await act(async () => reset.click());
    const generated = getProviderScheduleSnapshot("facebook").record!;
    expect(generated.bounds.source).toBe("generated");
    expect(generated.bounds).not.toEqual(before.bounds);
  });
});
