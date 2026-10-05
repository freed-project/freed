vi.mock("./LibraryHandoffPanel", () => ({ LibraryHandoffPanel: () => <section>Primary transfer</section> }));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { readLibraryCoreDesktopRole } from "../lib/library-core-desktop-role";
import { MobileSyncTab } from "./MobileSyncTab";

const mocks = vi.hoisted(() => ({
  recovery: null as null | { recoveryId: string; libraryId: string; predecessorEpochId: string; successorEpochId: string; state: "archived" | "prepared" | "following"; archivedPendingEdits: number; archivedPublishedEdits: number },
  prepareRecovery: vi.fn(), commitRecovery: vi.fn(),
  clipboardWrite: vi.fn(async () => {}),
  connect: vi.fn(),
  cancelConnect: vi.fn(),
  disconnect: vi.fn(),
  getAllLocalIPs: vi.fn(async () => []),
  getSyncUrl: vi.fn(async () => "ws://127.0.0.1:1421?t=pairing-token"),
  role: "primary" as "primary" | "follower",
  invoke: vi.fn(async () => ({ state: "standalone_primary", role: "primary", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) })),
  onStatusChange: vi.fn(() => () => {}),
  resetPairingToken: vi.fn(),
  resolveCloudSyncConflict: vi.fn(async () => {}),
  syncCloudProviderNow: vi.fn(async () => {}),
  transferSqliteLibraryWriterToThisDesktop: vi.fn(async () => {}),
  publicationReceipt: {
    version: 1 as const,
    localRevision: 7,
    itemCount: 19_003,
    checkpointStoredByteLength: 1_536,
    controlRevision: '"control-revision-12345678"',
    publishedAt: 1_787_139_200_000,
    controlPointer: {
      activeTransport: "google_drive_app_data_v1" as const,
      causalFrontierDigest: "d".repeat(64),
      generation: 4,
      libraryId: "a".repeat(64),
      manifest: {
        descriptor: {
          byteLength: 123,
          contentDigest: "67".repeat(32),
          objectKey: "checkpoint-manifest-object-key",
        },
        transportObjectId: "drive-object-12345678",
      },
      protocolVersion: 1 as const,
      schemaVersion: 1 as const,
      storageEpoch: "b".repeat(64),
      writerId: "c".repeat(64),
    },
  },
  providers: {
    dropbox: { status: "idle" as const },
    gdrive: {
      status: "connected" as "connected" | "error",
      error: undefined as string | undefined,
    },
  },
  followerStatus: {
    state: "active" as "active" | "authority_recovery_required" | "enrollment_pending",
    libraryId: "a".repeat(64),
    authorityEpochId: "b".repeat(64),
    actorId: "c".repeat(64),
    checkpointGeneration: 12,
    sourceRevision: 345,
    pendingIntentCount: 6,
    publishedIntentCount: 7,
    importedResultCount: 8,
    awaitingCanonicalChanges: false,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@freed/ui/context", () => ({
  usePlatform: () => ({ releaseChannel: "production" }),
}));

vi.mock("../hooks/useCloudProviders", () => ({
  useCloudProviders: () => ({
    providers: mocks.providers,
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

vi.mock("../lib/library-core-handoff", () => ({
  prepareDesktopLibraryConsumerRecovery: mocks.prepareRecovery,
  commitDesktopLibraryConsumerRecovery: mocks.commitRecovery,
}));

vi.mock("../lib/sqlite-library", () => ({
  readNormalizedLibraryConsumerRecovery: vi.fn(async () => mocks.recovery),
  readNormalizedLibraryFollowerRuntimeStatus: vi.fn(
    async () => mocks.followerStatus,
  ),
}));

vi.mock("../lib/library-core-cloud-sync", () => ({
  readSqliteLibraryGoogleDrivePublicationReceipt: vi.fn(
    async () => mocks.publicationReceipt,
  ),
}));

vi.mock("./DesktopSnapshotsSection", () => ({
  DesktopSnapshotsSection: () => <div data-testid="snapshots-section" />,
}));

describe("MobileSyncTab cloud diagnostics", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.role = "primary";
    mocks.recovery = null;
    mocks.followerStatus.state = "active";
    mocks.invoke.mockImplementation(async () => ({
      state: mocks.role === "primary" ? "standalone_primary" : "editable_consumer", role: mocks.role,
      libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64),
    }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.clipboardWrite },
    });
    mocks.providers.gdrive = { status: "connected", error: undefined };
    window.localStorage.clear();
    useDebugStore.setState({
      librarySnapshot: {
        libraryId: "document-1",
        itemCount: 10288,
        feedCount: 106,
        storageBytes: 12_900_000,
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
    useDebugStore.setState({ librarySnapshot: null, cloudProviders: null });
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps archived edits visible through explicit prepare and reconnect steps", async () => {
    mocks.role = "follower";
    mocks.followerStatus.state = "authority_recovery_required";
    mocks.prepareRecovery.mockImplementation(async () => {
      mocks.recovery = { recoveryId: "e".repeat(64), libraryId: "a".repeat(64), predecessorEpochId: "b".repeat(64),
        successorEpochId: "d".repeat(64), state: "prepared", archivedPendingEdits: 6, archivedPublishedEdits: 7 };
      return mocks.recovery;
    });
    mocks.commitRecovery.mockImplementation(async () => {
      mocks.recovery = { ...mocks.recovery!, state: "following" };
      mocks.followerStatus.state = "enrollment_pending";
      return mocks.recovery;
    });
    await act(async () => { root.render(<MobileSyncTab />); });
    let button = container.querySelector<HTMLButtonElement>("[data-testid='consumer-recovery-action']");
    expect(button?.textContent).toBe("Prepare recovery");
    await act(async () => { button?.click(); });
    button = container.querySelector<HTMLButtonElement>("[data-testid='consumer-recovery-action']");
    expect(button?.textContent).toBe("Reconnect this consumer");
    expect(mocks.commitRecovery).not.toHaveBeenCalled();
    expect(container.textContent).toContain("pending changes will stop appearing");
    await act(async () => { button?.click(); });
    expect(mocks.commitRecovery).toHaveBeenCalledWith("e".repeat(64));
    expect(container.querySelector("[data-testid='consumer-recovery-action']")).toBeNull();
    expect(container.querySelector("[data-testid='consumer-recovery']")?.textContent).toContain("6 previously queued; 7 previously uploaded");
    expect(container.textContent).toContain("These edits have not been resent");
  });

  it("explains a missing upload and lets the user run sync now", async () => {
    await act(async () => {
      root.render(<MobileSyncTab />);
    });

    const diagnostics = container.querySelector(
      "[data-testid='cloud-sync-diagnostics']",
    );
    const syncNow = container.querySelector<HTMLButtonElement>(
      "[data-testid='cloud-sync-now-button']",
    );
    const copyReceipt = container.querySelector<HTMLButtonElement>(
      "[data-testid='copy-primary-checkpoint-receipt']",
    );

    expect(diagnostics?.textContent).toContain("Sync diagnostics");
    expect(diagnostics?.textContent).toContain("10,288");
    expect(diagnostics?.textContent).toContain("No remote changes found.");
    expect(diagnostics?.textContent).toContain(
      "Waiting for local document changes or Sync now.",
    );
    expect(diagnostics?.textContent).toContain("SQLite revision");
    expect(diagnostics?.textContent).toContain("7");
    expect(diagnostics?.textContent).toContain("Receipt items");
    expect(diagnostics?.textContent).toContain("19,003");
    expect(diagnostics?.textContent).toContain("1.5 KB");
    expect(diagnostics?.textContent).toContain("...12345678");
    expect(diagnostics?.textContent).toContain("...67676767");
    const controlReceipt = Array.from(
      diagnostics?.querySelectorAll("div") ?? [],
    ).find((cell) => cell.firstElementChild?.textContent === "Control receipt");
    expect(
      controlReceipt?.querySelector("p[title]")?.getAttribute("title"),
    ).toBe('"control-revision-12345678"');
    expect(syncNow).toBeInstanceOf(HTMLButtonElement);
    expect(syncNow?.disabled).toBe(false);
    expect(copyReceipt).toBeInstanceOf(HTMLButtonElement);
    expect(copyReceipt?.disabled).toBe(false);
    expect(container.querySelector("[role='radio']")).toBeNull();
    expect(container.textContent).toContain("Primary source");

    await act(async () => {
      copyReceipt?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(mocks.clipboardWrite).toHaveBeenCalledWith(
      JSON.stringify(mocks.publicationReceipt, null, 2),
    );
    expect(copyReceipt?.textContent).toContain("Primary receipt copied");

    await act(async () => {
      syncNow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.syncCloudProviderNow).toHaveBeenCalledWith("gdrive");
  });

  it("shows the native consumer role without a renderer promotion toggle", async () => {
    mocks.role = "follower";
    await act(async () => { root.render(<MobileSyncTab />); });
    const roleControl = container.querySelector("[data-testid='library-core-desktop-role']");
    expect(readLibraryCoreDesktopRole()).toBe("follower");
    expect(roleControl?.querySelector("[role='radio']")).toBeNull();
    expect(roleControl?.textContent).toContain("Editable consumer");
    expect(roleControl?.textContent).toContain("Capture runs on the Primary.");
    const diagnostics = container.querySelector(
      "[data-testid='library-core-follower-diagnostics']",
    );
    expect(diagnostics?.textContent).toContain("Library edits are still synchronizing.");
    expect(diagnostics?.textContent).toContain("6 edits waiting to upload. 7 edits awaiting Primary acceptance.");
    expect(diagnostics?.textContent).toContain("Queued edits");
    expect(diagnostics?.textContent).toContain("6");
    expect(diagnostics?.textContent).toContain("Published edits");
    expect(diagnostics?.textContent).toContain("7");
    expect(diagnostics?.textContent).toContain("Imported receipts");
    expect(diagnostics?.textContent).toContain("8");
    expect(diagnostics?.textContent).toContain("...cccccccc");
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

    const status = container.querySelector(
      "[data-testid='cloud-sync-status-message']",
    );
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toContain(
      "Publishing the SQLite Library checkpoint.",
    );
    expect(
      container.querySelector("[data-testid='cloud-sync-activity-spinner']"),
    ).not.toBeNull();
  });

  it("requires cooperative transfer instead of offering legacy takeover", async () => {
    useDebugStore.setState({
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connected",
          stage: "idle",
          error:
            "Another Freed Desktop currently owns writes for this Library.",
          statusMessage:
            "This Freed Desktop is read-only until ownership is transferred.",
        },
      },
    });
    await act(async () => { root.render(<MobileSyncTab />); });
    expect(container.querySelector("[data-testid='sqlite-writer-transfer-button']")).toBeNull();
    expect(container.textContent).toContain("signed transfer consent");
    expect(container.textContent).toContain("Primary transfer");
    expect(mocks.transferSqliteLibraryWriterToThisDesktop).not.toHaveBeenCalled();
  });
});
