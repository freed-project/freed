/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PlatformProvider, type PlatformConfig } from "../context/PlatformContext";
import { FatalErrorScreen } from "./FatalErrorScreen";

vi.mock("./report/ReportComposer.js", () => ({
  ReportComposer: () => null,
}));

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${label}`);
  }
  return button;
}

async function renderScreen(
  onSecondaryAction: () => void | Promise<void>,
): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <FatalErrorScreen
        error={{ message: "SQLite could not open" }}
        productName="Freed"
        onRetry={() => {}}
        onSecondaryAction={onSecondaryAction}
        secondaryActionLabel="Replace local Library"
        secondaryActionConfirmation={{
          title: "Replace this device's local Library?",
          body: "Queued edits stored only here will be removed.",
          confirmLabel: "Replace local Library",
        }}
      />,
    );
  });
  return { container, root };
}

describe("FatalErrorScreen recovery confirmation", () => {
  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("offers only reload in the demo without exposing errors or data replacement", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const retry = vi.fn();
    const replace = vi.fn();
    await act(async () => root.render(
      <PlatformProvider value={{ interactionMode: "read-only" } as PlatformConfig}>
        <FatalErrorScreen error={{ message: "private SQLite failure" }} productName="Freed" onRetry={retry} onSecondaryAction={replace} secondaryActionLabel="Replace local Library" />
      </PlatformProvider>,
    ));
    expect(container.textContent).toContain("The demo needs a fresh start");
    expect(container.textContent).not.toContain("SQLite");
    expect(container.textContent).not.toContain("Replace local Library");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    await act(async () => buttonByText(container, "Reload demo").click());
    expect(retry).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("requires an explicit second action before replacing local data", async () => {
    const replace = vi.fn();
    const { container, root } = await renderScreen(replace);

    await act(async () => {
      buttonByText(container, "Replace local Library").click();
    });
    expect(replace).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => {
      buttonByText(container, "Cancel").click();
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText(container, "Replace local Library").click();
    });
    await act(async () => {
      const buttons = Array.from(container.querySelectorAll("button")).filter(
        (button) => button.textContent === "Replace local Library",
      );
      buttons.at(-1)?.click();
    });
    expect(replace).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });
});
