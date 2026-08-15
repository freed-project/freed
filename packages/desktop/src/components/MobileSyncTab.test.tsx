import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { useAppStore } from "../lib/store";
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
  transferSqliteLibraryWriterToThisDesktop: vi.fn(async () => {}),
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
  transferSqliteLibraryWriterToThisDesktop:
    mocks.transferSqliteLibraryWriterToThisDesktop,
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
    window.localStorage.clear();
    useAppStore.setState({ desktopClientIds: ["desktop-current"] });
    useDebugStore.setState({
      docSnapshot: {
        documentId: "document-1",
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
    useAppStore.setState({ desktopClientIds: [] });
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
    expect(container.querySelector("[data-testid='multiple-desktop-client-warning']")).toBeNull();
    expect(syncNow).toBeInstanceOf(HTMLButtonElement);
    expect(syncNow?.disabled).toBe(false);

    await act(async () => {
      syncNow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.syncCloudProviderNow).toHaveBeenCalledWith("gdrive");
  });

  it("shows honest activity feedback while Drive publication is running", async () => {
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connecting",
          stage: "upload",
          statusMessage: "Publishing the SQLite Library checkpoint.",
          pendingReason: "Publishing immutable Library objects now.",
        },
      },
    });

    await act(async () => {
      root.render(<MobileSyncTab />);
    });

    const status = container.querySelector("[data-testid='cloud-sync-status-message']");
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toContain("Publishing the SQLite Library checkpoint.");
    expect(container.querySelector("[data-testid='cloud-sync-activity-spinner']")).not.toBeNull();
  });

  it("warns when the synced library has multiple Freed Desktop clients", async () => {
    useAppStore.setState({
      desktopClientIds: ["desktop-current", "desktop-other"],
    });

    await act(async () => {
      root.render(<MobileSyncTab />);
    });

    const warning = container.querySelector("[data-testid='multiple-desktop-client-warning']");
    expect(warning?.getAttribute("role")).toBe("alert");
    expect(warning?.textContent).toContain("Multiple Freed Desktop clients detected");
    expect(warning?.textContent).toContain("2 Freed Desktop clients are registered");
    expect(warning?.textContent).toContain("Only the current writer may publish SQLite Library revisions");

    const dismiss = Array.from(warning?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Got it",
    );
    expect(dismiss).toBeDefined();
    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-testid='multiple-desktop-client-warning']")).toBeNull();
  });

  it("offers one confirmed action when another Freed Desktop owns SQLite writes", async () => {
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connected",
          stage: "idle",
          error: "Another Freed Desktop currently owns writes for this Library.",
          statusMessage: "This Freed Desktop is read-only until ownership is transferred.",
        },
      },
    });
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root.render(<MobileSyncTab />);
    });

    const transfer = container.querySelector<HTMLButtonElement>(
      "[data-testid='sqlite-writer-transfer-button']",
    );
    expect(transfer?.textContent).toBe("Make This Freed Desktop the Writer");
    expect(container.textContent).toContain("Transfer ownership here to publish from this installation");

    await act(async () => {
      transfer?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(mocks.transferSqliteLibraryWriterToThisDesktop).toHaveBeenCalledTimes(1);
    confirmMock.mockRestore();
  });

});
