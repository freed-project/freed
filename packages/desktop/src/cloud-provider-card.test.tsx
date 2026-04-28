import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudProviderCard } from "@freed/ui/components/CloudProviderCard";

describe("CloudProviderCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("calls the cancel handler from the visible button while connecting", async () => {
    const onConnect = vi.fn();
    const onCancelConnect = vi.fn();

    await act(async () => {
      root.render(
        <CloudProviderCard
          provider="gdrive"
          state={{ status: "connecting" }}
          onConnect={onConnect}
          onCancelConnect={onCancelConnect}
        />,
      );
    });

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    );

    expect(cancelButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCancelConnect).toHaveBeenCalledWith("gdrive");
    expect(onConnect).not.toHaveBeenCalled();
  });
});
