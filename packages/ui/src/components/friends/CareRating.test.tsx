/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareRating, careLevelLabel } from "./CareRating.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("care rating", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("uses the confirmed five-level category mapping", () => {
    expect([1, 2, 3, 4, 5].map(careLevelLabel)).toEqual([
      "Connection",
      "Connection",
      "Friend",
      "Friend",
      "Fam",
    ]);
  });

  it("commits the released slider level, blocks duplicate writes and reports failures", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let reject!: (reason: Error) => void;
    const onChange = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    try {
      await act(async () =>
        root.render(<CareRating level={5} onChange={onChange} />),
      );
      const slider = container.querySelector("input")!;
      expect(slider.type).toBe("range");
      expect([slider.min, slider.max, slider.step]).toEqual(["1", "5", "1"]);
      expect(slider.getAttribute("aria-valuetext")).toBe("Fam, position 5 of 5");
      await act(async () => {
        slider.value = "2";
        slider.dispatchEvent(new Event("pointerup", { bubbles: true }));
        slider.dispatchEvent(new Event("pointerup", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledExactlyOnceWith(2);
      expect(slider.disabled).toBe(true);
      await act(async () => reject(new Error("unavailable")));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Could not save",
      );
      expect(slider.disabled).toBe(false);
      expect(slider.value).toBe("5");
      expect(slider.getAttribute("aria-valuetext")).toBe("Fam, position 5 of 5");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
