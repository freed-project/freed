/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CareRating, careLevelLabel } from "./CareRating.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("care rating", () => {
  it("uses the confirmed five-level category mapping", () => {
    expect([1, 2, 3, 4, 5].map(careLevelLabel)).toEqual([
      "Connection",
      "Connection",
      "Friend",
      "Friend",
      "Fam",
    ]);
  });

  it("commits the exact clicked level, blocks duplicate writes and reports failures", async () => {
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
      const button = container.querySelectorAll("button")[1]!;
      expect(button.getAttribute("aria-label")).toBe(
        "Set Connection: 2 of 5 stars",
      );
      await act(async () => {
        button.click();
        button.click();
      });
      expect(onChange).toHaveBeenCalledExactlyOnceWith(2);
      expect(button.disabled).toBe(true);
      await act(async () => reject(new Error("unavailable")));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Could not save",
      );
      expect(button.disabled).toBe(false);
      expect(
        container
          .querySelector('[aria-pressed="true"]')
          ?.getAttribute("aria-label"),
      ).toBe("Set Fam: 5 of 5 stars");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
