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

  it("minimizes the draggable guide into a fixed tab and restores its newsletter state", async () => {
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
    expect(container.querySelectorAll('[data-testid="demo-welcome-desktop"] button')).toHaveLength(2);
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

    const minimize = container.querySelector<HTMLButtonElement>('[aria-label="Minimize demo banner"]')!;
    await act(async () => minimize.click());
    expect(localStorage.getItem("freed.demo.welcome-state.v1")).toBe("minimized");
    expect(container.querySelector('[data-testid="demo-welcome-desktop"]')?.hasAttribute("inert")).toBe(true);
    const tab = container.querySelector<HTMLElement>('[data-testid="demo-welcome-tab"]');
    expect(tab?.textContent).toContain("Freed Demo");
    const restore = tab as HTMLButtonElement;
    expect(document.activeElement).toBe(restore);
    // Keep the actual form mounted so minimizing cannot discard an email draft.
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    await act(async () => restore.click());
    expect(localStorage.getItem("freed.demo.welcome-state.v1")).toBe("banner");
    expect(container.querySelector('[data-testid="demo-welcome-tab"]')?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector('[data-testid="demo-welcome-desktop"]')?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(minimize);
    expect(container.textContent).toContain("Freed Newsletter");
    expect(container.textContent).not.toContain("Social media that respects you");
    await act(async () => findButton(container, "Skip the newsletter")?.click());
    expect(container.textContent).toContain("Freed Demo");
    expect(container.textContent).toContain("Social media that respects you, and your friends.");
    expect(container.textContent).toContain("Ready to make it your own?");

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open demo welcome modal"]')!.click());
    expect(container.textContent).toContain("Take back your feed.");
    expect(localStorage.getItem("freed.demo.welcome-state.v1")).toBe("modal");

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("docks the mobile tab on the right, clamps vertical dragging, and distinguishes dragging from restoring", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    localStorage.setItem("freed.demo.welcome-state.v1", "minimized");
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(DemoWelcomeBanner, { downloadUrl: "https://freed.wtf/get" })));
    // Mobile always welcomes a fresh load, even when the previous visit was minimized.
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      findButton(container, "Explore Freed Demo")!.click();
      await vi.advanceTimersByTimeAsync(700);
    });
    const tab = container.querySelector<HTMLButtonElement>('[data-testid="demo-welcome-tab"]')!;
    Object.defineProperty(tab, "offsetWidth", { value: 288 });
    expect(tab.style.transform).toContain("rotate(-90deg)");
    expect(tab.style.top).toBe("422px");
    const pointer = async (type: string, y: number) => act(async () => {
      const event = new MouseEvent(type, { bubbles: true, clientY: y, button: 0 });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
      tab.dispatchEvent(event);
    });
    await pointer("pointerdown", 422);
    await pointer("pointermove", -1000);
    expect(tab.style.top).toBe("156px");
    await pointer("pointerup", -1000);
    await act(async () => tab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(localStorage.getItem("freed.demo.welcome-state.v1")).toBe("minimized");
    await pointer("pointerdown", 156);
    await pointer("pointerup", 156);
    await act(async () => tab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(localStorage.getItem("freed.demo.welcome-state.v1")).toBe("modal");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      findButton(container, "Explore Freed Demo")!.click();
      await vi.advanceTimersByTimeAsync(700);
    });
    vi.stubGlobal("innerWidth", 1024);
    await act(async () => window.dispatchEvent(new Event("resize")));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    const horizontalTab = container.querySelector<HTMLButtonElement>('[data-testid="demo-welcome-tab"]')!;
    expect(horizontalTab.style.transform).not.toContain("rotate");
    expect(horizontalTab.style.top).toBe("");
    await act(async () => root.unmount());
  });

  it("restores a minimized tab immediately without the welcome modal", async () => {
    localStorage.setItem("freed.demo.welcome-state.v1", "minimized");
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(DemoWelcomeBanner, { downloadUrl: "https://freed.wtf/get" })));
    expect(container.textContent).not.toContain("Take back your feed.");
    expect(container.querySelector('[data-testid="demo-welcome-tab"]')?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector('[data-testid="demo-welcome-desktop"]')?.hasAttribute("inert")).toBe(true);
    await act(async () => root.unmount());
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
