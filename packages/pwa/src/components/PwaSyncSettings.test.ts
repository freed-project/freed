import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider, type PlatformConfig } from "@freed/ui/context";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { useAppStore } from "../lib/store";
import { PwaSyncSettings } from "./PwaSyncSettings";

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(async () => {}),
  clearCloudSync: vi.fn(),
  getCloudProvider: vi.fn<() => "gdrive" | null>(() => "gdrive"),
  stopCloudSync: vi.fn(),
  syncCloudProviderNow: vi.fn(async () => {}),
  readCloudReceipt: vi.fn(async () => ({
    checkpoint: {
      authorityEpoch: "02".repeat(32),
      checkpointDigest: "67".repeat(32),
      checkpointGeneration: 4,
      controlRevision: "68".repeat(32),
      installedAt: Date.now(),
      libraryId: "01".repeat(32),
      manifestContentDigest: "67".repeat(32),
      manifestObjectKey: "checkpoint-manifest-object-key",
      manifestTransportObjectId: "drive-object-12345678",
      sourceRevision: 7,
      writerActorId: "69".repeat(32),
    },
    follower: {
      actorId: "70".repeat(32),
      libraryId: "01".repeat(32),
      nextIntentActorCounter: 4,
      nextResultSequence: 3,
      previousIntentSegmentDigest: "71".repeat(32),
      previousResultSegmentDigest: "72".repeat(32),
      schemaVersion: 2 as const,
      storageEpochId: "02".repeat(32),
    },
  })),
  readFacetSummary: vi.fn(async () => ({
    archivedCount: 0,
    archivableCount: 0,
    contactAccountCount: 0,
    contactLinkedPersonCount: 0,
    enabledRssFeedCount: 1,
    friendPersonCount: 0,
    latestContactImportedAt: null,
    latestRssFeedFetchedAt: Date.now() - 90_000,
    platformCounts: [],
    rssFeedCount: 1,
    sampleAccountCount: 0,
    sampleFeedCount: 0,
    savedArchivedCount: 0,
    savedCount: 0,
    savedPlatformCount: 0,
    socialAccountCount: 0,
    sampleItemCount: 0,
    samplePersonCount: 0,
    tags: [],
    totalCount: 0,
    unreadCount: 0,
  })),
}));

vi.mock("../lib/sync", () => ({
  clearCloudSync: mocks.clearCloudSync,
  getCloudProvider: mocks.getCloudProvider,
  stopCloudSync: mocks.stopCloudSync,
  syncCloudProviderNow: mocks.syncCloudProviderNow,
}));

vi.mock("../lib/library-core-runtime", () => ({
  readPwaLibraryCoreCloudReceiptV2: mocks.readCloudReceipt,
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
    readLibraryFacetSummary: mocks.readFacetSummary,
    releaseChannel: "production",
  };
}

function renderWithPlatform(node: ReactNode): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(PlatformProvider, {
        value: createPlatform(),
        children: node,
      }),
    );
  });
  return { container, root };
}

describe("PwaSyncSettings cloud diagnostics", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:30Z"));
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.clipboardWrite },
    });
    mocks.getCloudProvider.mockReturnValue("gdrive");
    useAppStore.setState({
      syncConnected: true,
      isSyncing: false,
    });
    useDebugStore.setState({
      librarySnapshot: {
        libraryId: "document-1",
        itemCount: 1,
        feedCount: 0,
        storageBytes: 1536,
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
    });
    useDebugStore.setState({ librarySnapshot: null, cloudProviders: null });
    document.body.innerHTML = "";
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("explains a missing upload and lets the user run sync now", async () => {
    const { container, root } = renderWithPlatform(
      createElement(PwaSyncSettings),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const diagnostics = container.querySelector(
      "[data-testid='pwa-cloud-sync-diagnostics']",
    );
    const syncNow = container.querySelector<HTMLButtonElement>(
      "[data-testid='pwa-cloud-sync-now-button']",
    );
    const copyReceipt = container.querySelector<HTMLButtonElement>(
      "[data-testid='copy-pwa-checkpoint-receipt']",
    );

    expect(diagnostics?.textContent).toContain("Sync diagnostics");
    expect(container.textContent).toContain("Last synced 1m ago");
    expect(diagnostics?.textContent).toContain("Local items");
    expect(diagnostics?.textContent).toContain("1");
    expect(diagnostics?.textContent).toContain("No remote changes found.");
    expect(diagnostics?.textContent).toContain(
      "Waiting for local document changes or Sync now.",
    );
    expect(diagnostics?.textContent).toContain(
      "Checked cloud storage. No remote changes found.",
    );
    expect(diagnostics?.textContent).toContain("Source revision");
    expect(diagnostics?.textContent).toContain("7");
    expect(diagnostics?.textContent).toContain("Checkpoint digest");
    expect(diagnostics?.textContent).toContain("Control revision");
    expect(diagnostics?.textContent).toContain("Follower actor");
    expect(diagnostics?.textContent).toContain("...70707070");
    expect(diagnostics?.textContent).toContain("Next intent");
    expect(diagnostics?.textContent).toContain("4");
    expect(diagnostics?.textContent).toContain("Intent head");
    expect(diagnostics?.textContent).toContain("...71717171");
    expect(diagnostics?.textContent).toContain("Next result");
    expect(diagnostics?.textContent).toContain("3");
    expect(diagnostics?.textContent).toContain("Result head");
    expect(diagnostics?.textContent).toContain("...72727272");
    expect(diagnostics?.textContent).toContain("...67676767");
    expect(diagnostics?.textContent).toContain("...12345678");
    const manifestDigest = Array.from(
      diagnostics?.querySelectorAll("div") ?? [],
    ).find((cell) => cell.firstElementChild?.textContent === "Manifest digest");
    expect(
      manifestDigest?.querySelector("p[title]")?.getAttribute("title"),
    ).toBe("67".repeat(32));
    expect(syncNow).toBeInstanceOf(HTMLButtonElement);
    expect(syncNow?.disabled).toBe(false);
    expect(copyReceipt).toBeInstanceOf(HTMLButtonElement);
    expect(copyReceipt?.disabled).toBe(false);

    await act(async () => {
      copyReceipt?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(mocks.clipboardWrite).toHaveBeenCalledWith(
      JSON.stringify(await mocks.readCloudReceipt(), null, 2),
    );
    expect(copyReceipt?.textContent).toContain("PWA sync receipt copied");

    await act(async () => {
      syncNow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.syncCloudProviderNow).toHaveBeenCalledWith("gdrive");

    act(() => {
      root.unmount();
    });
  });

  it("clears the configured cloud provider and immediately shows the reconnect UI", async () => {
    useAppStore.setState({ syncConnected: false });
    mocks.clearCloudSync.mockImplementationOnce(() => {
      mocks.getCloudProvider.mockReturnValue(null);
    });
    const { container, root } = renderWithPlatform(
      createElement(PwaSyncSettings),
    );
    const disconnectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Disconnect");

    expect(disconnectButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      disconnectButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(mocks.clearCloudSync).toHaveBeenCalledWith("gdrive");
    expect(container.textContent).toContain("Not connected");
    expect(container.textContent).toContain("Connect");
    expect(container.textContent).not.toContain("Disconnect");

    act(() => {
      root.unmount();
    });
  });

  it("shows a linked Google account without a published Library as waiting for Primary", () => {
    useAppStore.setState({ syncConnected: false });
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "error",
          stage: "download",
          error: "No published SQLite Library was found in Google Drive",
          statusMessage: "SQLite Library sync failed.",
          pendingReason: "Fix the error, then use Sync now to retry.",
          events: [],
        },
      },
    });

    const { container, root } = renderWithPlatform(
      createElement(PwaSyncSettings),
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Google Drive");
    expect(text).toContain("Waiting for Primary");
    expect(text).toContain(
      "Google Drive is connected. Waiting for the Primary Freed Desktop to publish its Library.",
    );
    expect(text).toContain(
      "No published SQLite Library was found in Google Drive",
    );
    expect(text).not.toContain("Needs attention");
    expect(text).not.toContain("Choose a sync method below to get started.");
    expect(
      container.querySelector("[data-testid='pwa-cloud-sync-now-button']"),
    ).toBeInstanceOf(HTMLButtonElement);

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

    const { container, root } = renderWithPlatform(
      createElement(PwaSyncSettings),
    );
    const text = container.textContent ?? "";
    const diagnostics = container.querySelector(
      "[data-testid='pwa-cloud-sync-diagnostics']",
    );

    expect(text).toContain("Merge blocked. Review Sync diagnostics below.");
    expect(diagnostics?.textContent).toContain(blockedMessage);
    expect(text.match(/Freed blocked a sync merge/g) ?? []).toHaveLength(1);

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

    const { container, root } = renderWithPlatform(
      createElement(PwaSyncSettings),
    );
    const activeCounter = container.querySelector(
      "[data-testid='pwa-cloud-sync-active-counter']",
    );

    expect(container.textContent).toContain("Merging 30s");
    expect(activeCounter?.textContent).toContain(
      "Applying Google Drive records to this Library",
    );
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
