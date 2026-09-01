/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DemoWelcomeBanner } from "./DemoWelcomeBanner";

describe("DemoWelcomeBanner", () => {
  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("minimizes and reopens the mobile welcome without removing the desktop panel", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(DemoWelcomeBanner, {
          downloadUrl: "https://freed.wtf/get",
        }),
      );
    });

    expect(container.querySelector('[data-testid="demo-welcome-desktop"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="demo-welcome-mobile"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Minimize demo welcome"]')?.click();
    });
    expect(container.querySelector('[data-testid="demo-welcome-mobile"]')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="demo-welcome-reopen"]')?.click();
    });
    expect(container.querySelector('[data-testid="demo-welcome-mobile"]')).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
