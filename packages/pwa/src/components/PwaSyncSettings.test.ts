import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { useAppStore } from "../lib/store";
import { PwaSyncSettings } from "./PwaSyncSettings";

const mocks = vi.hoisted(() => ({
  clearCloudSync: vi.fn(),
  clearStoredRelayUrl: vi.fn(),
  disconnect: vi.fn(),
  getCloudProvider: vi.fn(() => "gdrive" as const),
  stopCloudSync: vi.fn(),
  syncCloudProviderNow: vi.fn(async () => {}),
}));

vi.mock("../lib/sync", () => ({
  clearCloudSync: mocks.clearCloudSync,
  clearStoredRelayUrl: mocks.clearStoredRelayUrl,
  disconnect: mocks.disconnect,
  getCloudProvider: mocks.getCloudProvider,
  stopCloudSync: mocks.stopCloudSync,
  syncCloudProviderNow: mocks.syncCloudProviderNow,
}));

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
    SubstackSettingsContent: null,
    MediumSettingsContent: null,
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

describe("PwaSyncSettings cloud diagnostics", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:30Z"));
    vi.clearAllMocks();
    useAppStore.setState({
      syncConnected: true,
      isSyncing: false,
      feeds: {},
    });
    useDebugStore.setState({
      docSnapshot: {
        documentId: "document-1",
        itemCount: 1,
        feedCount: 0,
        binarySize: 1536,
        savedAt: Date.now(),
      },
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connected",
          stage: "idle",
          lastDownloadAt: Date.now(),
          lastRemoteBytes: 0,
          statusMessage: "No remote changes found.",
          pendingReason: "Waiting for local document changes or Sync now.",
          events: [
            {
              id: "event-1",
              ts: Date.now(),
              kind: "success",
              stage: "idle",
              message: "Checked cloud storage. No remote changes found.",
            },
          ],
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    useAppStore.setState({
      syncConnected: false,
      isSyncing: false,
      feeds: {},
    });
    useDebugStore.setState({ docSnapshot: null, cloudProviders: null });
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("explains a missing upload and lets the user run sync now", async () => {
    const { container, root } = renderWithPlatform(createElement(PwaSyncSettings));

    const diagnostics = container.querySelector("[data-testid='pwa-cloud-sync-diagnostics']");
    const syncNow = container.querySelector<HTMLButtonElement>("[data-testid='pwa-cloud-sync-now-button']");

    expect(diagnostics?.textContent).toContain("Sync diagnostics");
    expect(diagnostics?.textContent).toContain("Local items");
    expect(diagnostics?.textContent).toContain("1");
    expect(diagnostics?.textContent).toContain("No remote changes found.");
    expect(diagnostics?.textContent).toContain("Waiting for local document changes or Sync now.");
    expect(diagnostics?.textContent).toContain("Checked cloud storage. No remote changes found.");
    expect(syncNow).toBeInstanceOf(HTMLButtonElement);
    expect(syncNow?.disabled).toBe(false);

    await act(async () => {
      syncNow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.syncCloudProviderNow).toHaveBeenCalledWith("gdrive");

    act(() => {
      root.unmount();
    });
  });

  it("summarizes blocked merge errors in the provider card and shows details only in diagnostics", () => {
    const blockedMessage =
      "Freed blocked a sync merge because it would remove too much feed history. Source: PWA sync. Largest input: 11,238 items. Merged result: 0 items. Potential loss: 11,238 items (100%). Restore from a trusted snapshot or reconnect sync after confirming which copy should win.";
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

    const { container, root } = renderWithPlatform(createElement(PwaSyncSettings));
    const text = container.textContent ?? "";
    const diagnostics = container.querySelector("[data-testid='pwa-cloud-sync-diagnostics']");

    expect(text).toContain("Merge blocked. Review Sync diagnostics below.");
    expect(diagnostics?.textContent).toContain(blockedMessage);
    expect((text.match(/Freed blocked a sync merge/g) ?? [])).toHaveLength(1);

    act(() => {
      root.unmount();
    });
  });

  it("shows the active cloud sync stage and elapsed time while a merge is running", () => {
    const startedAt = Date.now() - 30_000;
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connected",
          stage: "merge",
          lastAttemptAt: startedAt,
          statusMessage: "Merging remote document into the local library.",
          events: [
            {
              id: "merge-started",
              ts: startedAt,
              kind: "started",
              stage: "merge",
              message: "Merging remote document into the local library.",
            },
          ],
        },
      },
    });

    const { container, root } = renderWithPlatform(createElement(PwaSyncSettings));
    const activeCounter = container.querySelector("[data-testid='pwa-cloud-sync-active-counter']");

    expect(container.textContent).toContain("Merging 30s");
    expect(activeCounter?.textContent).toContain("Merging Google Drive data into this library");
    expect(activeCounter?.textContent).toContain("30s");
    expect(activeCounter?.querySelector("[aria-label='Syncing']")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(activeCounter?.textContent).toContain("31s");

    act(() => {
      root.unmount();
    });
  });
});
