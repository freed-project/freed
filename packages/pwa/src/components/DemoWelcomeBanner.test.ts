/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://freed-pwa-orpin.vercel.app/"}
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DemoWelcomeBanner } from "./DemoWelcomeBanner";

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(label));
}

describe("DemoWelcomeBanner", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(() => {
    localStorage.clear();
    delete window.turnstile;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it("transforms into a draggable Field Guide with no collapse controls", async () => {
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

    expect(container.querySelector('[aria-label="Minimize Freed Demo"]')).toBeNull();
    expect(container.querySelector('[data-testid="demo-welcome-reopen"]')).toBeNull();
    expect(container.textContent).toContain("Freed Newsletter");
    expect(container.textContent).not.toContain("Social media that respects you");
    await act(async () => findButton(container, "Skip the newsletter")?.click());
    expect(container.textContent).toContain("Freed Demo");
    expect(container.textContent).toContain("Social media that respects you, and your friends.");
    expect(container.textContent).toContain("Ready to make it your own?");

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("keeps the Field Guide newsletter inert on Vercel previews", async () => {
    vi.stubEnv("DEV", false);
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const turnstileRender = vi.fn((_container, options) => {
      options.callback?.("verified-token");
      return "newsletter-widget";
    });
    window.turnstile = {
      render: turnstileRender,
      reset: vi.fn(),
      remove: vi.fn(),
    };
    window.history.replaceState(null, "", "/");
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
    await act(async () => {
      findButton(container, "Explore Freed Demo")?.click();
      await vi.advanceTimersByTimeAsync(470);
    });
    await act(async () => {
      findButton(container, "Join the newsletter")?.click();
    });
    await act(async () => {
      setInput(
        container.querySelector<HTMLInputElement>('input[type="email"]')!,
        "reader@example.com",
      );
      findButton(container, "Join the newsletter")?.click();
    });
    await act(async () => {
      setInput(
        container.querySelector<HTMLInputElement>(
          'input[autocomplete="name"]',
        )!,
        "Reader Name",
      );
      findButton(container, "Join the newsletter")?.click();
    });

    expect(turnstileRender).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ sitekey: "1x00000000000000000000AA" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("That’s the complete signup flow.");

    await act(async () => root.unmount());
    container.remove();
  });
});
