import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { useAppStore } from "../lib/store";
import { PwaFeedEmptyState } from "./PwaFeedEmptyState";

function createPlatform(): PlatformConfig {
  return {
    store: useAppStore,
    SourceIndicator: null,
    HeaderSyncIndicator: null,
    SettingsExtraSections: null,
    LegalSettingsContent: null,
    FeedEmptyState: null,
    XSettingsContent: null,
    FacebookSettingsContent: null,
    InstagramSettingsContent: null,
    LinkedInSettingsContent: null,
    GoogleContactsSettingsContent: null,
    releaseChannel: "production",
  };
}

function renderWithPlatform(node: ReactNode): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(PlatformProvider, { value: createPlatform(), children: node }));
  });
  return { container, root };
}

describe("PwaFeedEmptyState", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:30Z"));
    vi.clearAllMocks();
    useAppStore.setState({
      syncConnected: true,
      isSyncing: false,
      activeFilter: {},
      feeds: {},
      items: [],
      persons: {},
      accounts: {},
    });
    useDebugStore.setState({ cloudProviders: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    useAppStore.setState({
      syncConnected: false,
      isSyncing: false,
      activeFilter: {},
      feeds: {},
      items: [],
      persons: {},
      accounts: {},
    });
    useDebugStore.setState({ cloudProviders: null });
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("points the blank feed state to Sync settings when cloud sync is blocked", () => {
    const blockedMessage =
      "Freed blocked a sync merge because it would remove too much feed history. Source: PWA sync. Largest input: 11,238 items. Merged result: 0 items. Potential loss: 11,238 items (100%). Restore from a trusted snapshot or reconnect sync after confirming which copy should win.";
    const openSettings = vi.fn();
    window.addEventListener("freed:open-settings", openSettings);
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "error",
          stage: "merge",
          error: blockedMessage,
          statusMessage: "Merge blocked.",
          pendingReason: "Resolve this error, then reconnect or run Sync now.",
          events: [],
        },
      },
    });

    const { container, root } = renderWithPlatform(createElement(PwaFeedEmptyState));
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Open Sync settings",
    );

    expect(container.textContent).toContain("Sync is blocked");
    expect(container.textContent).toContain("Open Sync settings to choose how to recover your Google Drive library.");
    expect(button).toBeDefined();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openSettings).toHaveBeenCalledTimes(1);

    window.removeEventListener("freed:open-settings", openSettings);
    act(() => {
      root.unmount();
    });
  });

  it("shows a spinner while cloud sync is actively downloading", () => {
    const startedAt = Date.now() - 30_000;
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connecting",
          stage: "download",
          lastAttemptAt: startedAt,
          statusMessage: "Checking cloud storage for remote changes.",
          events: [
            {
              id: "download-started",
              ts: startedAt,
              kind: "started",
              stage: "download",
              message: "Checking cloud storage for remote changes.",
            },
          ],
        },
      },
    });

    const { container, root } = renderWithPlatform(createElement(PwaFeedEmptyState));

    expect(container.querySelector("[aria-label='Syncing']")).toBeTruthy();
    expect(container.textContent).toContain("Waiting for content...");
    expect(container.textContent).toContain("Checking Google Drive for remote changes. Running for 30s.");
    expect(container.textContent).not.toContain("Sync is blocked");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(container.textContent).toContain("Running for 31s.");

    act(() => {
      root.unmount();
    });
  });
});
