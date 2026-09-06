import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaLibraryBusyScreen } from "./PwaLibraryBusyScreen";

describe("PwaLibraryBusyScreen", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("explains the single-tab condition without destructive recovery", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRetry = vi.fn();

    act(() => {
      root.render(createElement(PwaLibraryBusyScreen, { onRetry }));
    });

    expect(container.textContent).toContain("Freed is open in another tab");
    expect(container.textContent).toContain("Return to the other tab");
    expect(container.textContent).not.toContain("fatal error");
    expect(container.textContent).not.toContain("Replace local Library");
    expect(container.textContent).not.toContain("crash report");

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry here",
    );
    act(() => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });
});
