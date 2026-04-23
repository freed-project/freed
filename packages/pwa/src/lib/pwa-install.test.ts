import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInstallNoticeDismissal,
  dismissInstallNotice,
  getInitialInstallNotice,
  isInstallNoticeDismissed,
  isStandalonePwa,
  watchInstallPrompt,
  type DeferredInstallPromptEvent,
} from "./pwa-install";

function stubMatchMedia(standalone = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(display-mode: standalone)" ? standalone : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function stubNavigator(options?: {
  userAgent?: string;
  standalone?: boolean;
  maxTouchPoints?: number;
}) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: options?.userAgent ?? "Mozilla/5.0 (X11; Linux x86_64) Chrome/123.0.0.0 Safari/537.36",
  });
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: options?.standalone,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: options?.maxTouchPoints ?? 0,
  });
}

describe("pwa install helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubMatchMedia(false);
    stubNavigator();
  });

  it("recognizes standalone mode from display-mode media query", () => {
    stubMatchMedia(true);
    expect(isStandalonePwa()).toBe(true);
  });

  it("offers iOS install guidance when Safari is not yet installed", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });

    expect(getInitialInstallNotice()).toEqual({ kind: "ios" });
  });

  it("suppresses the notice after dismissal until install completes", () => {
    dismissInstallNotice();

    expect(isInstallNoticeDismissed()).toBe(true);
    expect(getInitialInstallNotice()).toBeNull();

    clearInstallNoticeDismissal();
    expect(isInstallNoticeDismissed()).toBe(false);
  });

  it("captures browser install prompts and clears dismissal after appinstalled", () => {
    let noticeKind: "browser" | "ios" | null = null;
    let installed = false;
    const stopWatching = watchInstallPrompt({
      onInstallPrompt: (notice) => {
        noticeKind = notice.kind;
      },
      onInstalled: () => {
        installed = true;
      },
    });

    const promptEvent = new Event("beforeinstallprompt", {
      cancelable: true,
    }) as DeferredInstallPromptEvent;
    promptEvent.prompt = vi.fn().mockResolvedValue(undefined);
    promptEvent.userChoice = Promise.resolve({
      outcome: "accepted",
      platform: "web",
    });

    window.dispatchEvent(promptEvent);
    expect(promptEvent.defaultPrevented).toBe(true);
    expect(noticeKind).toBe("browser");

    dismissInstallNotice();
    window.dispatchEvent(new Event("appinstalled"));

    expect(installed).toBe(true);
    expect(isInstallNoticeDismissed()).toBe(false);

    stopWatching();
  });
});
