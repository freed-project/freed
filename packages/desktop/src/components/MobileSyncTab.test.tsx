import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { MobileSyncTab } from "./MobileSyncTab";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  cancelConnect: vi.fn(),
  disconnect: vi.fn(),
  getAllLocalIPs: vi.fn(async () => []),
  getSyncUrl: vi.fn(async () => "ws://127.0.0.1:1421?t=pairing-token"),
  invoke: vi.fn(async () => false),
  onStatusChange: vi.fn(() => () => {}),
  resetPairingToken: vi.fn(),
  resolveCloudSyncConflict: vi.fn(async () => {}),
  syncCloudProviderNow: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@freed/ui/context", () => ({
  usePlatform: () => ({ releaseChannel: "production" }),
}));

vi.mock("../hooks/useCloudProviders", () => ({
  useCloudProviders: () => ({
    providers: {
      dropbox: { status: "idle" },
      gdrive: { status: "connected" },
    },
    connect: mocks.connect,
    cancelConnect: mocks.cancelConnect,
    disconnect: mocks.disconnect,
  }),
}));

vi.mock("../lib/sync", () => ({
  getAllLocalIPs: mocks.getAllLocalIPs,
  getSyncUrl: mocks.getSyncUrl,
  onStatusChange: mocks.onStatusChange,
  resetPairingToken: mocks.resetPairingToken,
  resolveCloudSyncConflict: mocks.resolveCloudSyncConflict,
  syncCloudProviderNow: mocks.syncCloudProviderNow,
}));

vi.mock("./DesktopSnapshotsSection", () => ({
  DesktopSnapshotsSection: () => <div data-testid="snapshots-section" />,
}));

describe("MobileSyncTab cloud diagnostics", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    useDebugStore.setState({
      docSnapshot: {
        deviceId: "device-1",
        itemCount: 10288,
        feedCount: 106,
        binarySize: 12_900_000,
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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    useDebugStore.setState({ docSnapshot: null, cloudProviders: null });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("explains a missing upload and lets the user run sync now", async () => {
    await act(async () => {
      root.render(<MobileSyncTab />);
    });

    const diagnostics = container.querySelector("[data-testid='cloud-sync-diagnostics']");
    const syncNow = container.querySelector<HTMLButtonElement>("[data-testid='cloud-sync-now-button']");

    expect(diagnostics?.textContent).toContain("Sync diagnostics");
    expect(diagnostics?.textContent).toContain("10,288");
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
  });

  it("lets the user choose a winner when a destructive cloud merge is blocked", async () => {
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connected",
          stage: "upload",
          error: "Freed blocked a sync merge because it would remove too much feed history.",
          statusMessage: "Watching for local document changes.",
        },
      },
    });
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root.render(<MobileSyncTab />);
    });

    const recovery = container.querySelector("[data-testid='cloud-sync-conflict-recovery']");
    const keepLocal = container.querySelector<HTMLButtonElement>("[data-testid='cloud-sync-keep-local-button']");
    const keepCloud = container.querySelector<HTMLButtonElement>("[data-testid='cloud-sync-keep-cloud-button']");

    expect(recovery?.textContent).toContain("Choose which copy should win.");
    expect(recovery?.textContent).toContain("Keep this device replaces the cloud backup.");
    expect(container.textContent).toContain("Upload has not completed because sync needs attention.");
    expect(container.textContent).not.toContain("Uploading now.");
    expect(keepLocal).toBeInstanceOf(HTMLButtonElement);
    expect(keepCloud).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      keepLocal?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("replace the Google Drive cloud backup"));
    expect(mocks.resolveCloudSyncConflict).toHaveBeenCalledWith("gdrive", "local");

    await act(async () => {
      keepCloud?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.resolveCloudSyncConflict).toHaveBeenCalledWith("gdrive", "cloud");
    confirmMock.mockRestore();
  });

  it("keeps the destructive merge recovery visible while a winner is applying", async () => {
    let finishRecovery!: () => void;
    mocks.resolveCloudSyncConflict.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishRecovery = resolve;
      }),
    );
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connected",
          stage: "idle",
          error: "Freed blocked a sync merge because it would remove too much feed history.",
          statusMessage: "Watching for local document changes.",
        },
      },
    });
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root.render(<MobileSyncTab />);
    });

    const keepLocal = container.querySelector<HTMLButtonElement>("[data-testid='cloud-sync-keep-local-button']");
    await act(async () => {
      keepLocal?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='cloud-sync-keep-local-spinner']")).toBeTruthy();
    expect(keepLocal?.disabled).toBe(true);

    await act(async () => {
      useDebugStore.setState({
        cloudProviders: {
          dropbox: { status: "idle" },
          gdrive: {
            status: "connected",
            stage: "upload",
            statusMessage: "Replacing the cloud backup with this device.",
            pendingReason: "Applying the selected sync recovery path.",
            error: undefined,
          },
        },
      });
      await Promise.resolve();
    });

    const recovery = container.querySelector("[data-testid='cloud-sync-conflict-recovery']");
    const syncNow = container.querySelector<HTMLButtonElement>("[data-testid='cloud-sync-now-button']");
    const localSpinner = container.querySelector("[data-testid='cloud-sync-keep-local-spinner']");

    expect(recovery?.textContent).toContain("Choose which copy should win.");
    expect(recovery?.textContent).toContain("Replacing...");
    expect(localSpinner).toBeTruthy();
    expect(syncNow?.disabled).toBe(true);

    await act(async () => {
      finishRecovery();
      await Promise.resolve();
    });
    confirmMock.mockRestore();
  });
});
