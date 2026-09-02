/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DemoWelcomeBanner } from "./DemoWelcomeBanner";

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(label));
}

describe("DemoWelcomeBanner", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("opens with the selected Take back direction and a theme-aware Freed logo", async () => {
    window.history.replaceState(null, "", "/");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(DemoWelcomeBanner, {
        downloadUrl: "https://freed.wtf/get",
      }));
    });

    expect(container.textContent).toContain("Take back your feed.");
    expect(container.textContent).toContain("You control what you see.");
    expect(container.textContent).not.toContain("You choose what rises.");
    const logo = container.querySelector<HTMLElement>('[role="img"][aria-label="Freed"]');
    expect(logo).not.toBeNull();
    expect(logo?.textContent).toBe("F");
    expect(logo?.className).toContain("bg-[image:var(--theme-logo-spectrum)]");

    expect(container.querySelector('[aria-label="Demo welcome variations"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("transforms into a draggable Field Guide with a mobile bottom tab", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(DemoWelcomeBanner, {
        downloadUrl: "https://freed.wtf/get",
      }));
    });

    expect(container.textContent).toContain("Take back your feed.");
    expect(container.querySelectorAll('[data-testid="demo-welcome-desktop"] a')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="demo-welcome-desktop"] button')).toHaveLength(1);
    const exploreButton = findButton(container, "Explore Freed Demo");
    expect(exploreButton).toBeInstanceOf(HTMLButtonElement);
    expect(exploreButton?.className).toContain("min-h-14");

    await act(async () => {
      exploreButton?.click();
      await vi.advanceTimersByTimeAsync(470);
    });

    expect(container.textContent).toContain("Freed Demo");
    expect(container.textContent).not.toContain("Refresh anytime to reset the demo.");
    expect(container.querySelector('[data-testid="demo-welcome-drag-handle"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Maximize demo welcome"]')).toBeNull();
    expect(container.querySelector('[aria-label="Restore demo welcome"]')).toBeNull();
    expect(container.textContent).toContain("Download Freed Desktop");
    expect(container.textContent).toContain("Join the newsletter");

    await act(async () => {
      findButton(container, "Join the newsletter")?.click();
    });
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://freed.wtf/get"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Minimize Freed Demo"]')?.click();
    });
    const reopen = container.querySelector('[data-testid="demo-welcome-reopen"]');
    expect(reopen).not.toBeNull();
    expect(reopen?.textContent).toContain("Freed Demo");

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
});
