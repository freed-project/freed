import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  snapshots: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./library-client", () => ({
  reloadSqliteLibraryState: vi.fn(),
  subscribeDesktopLibraryRuntime: mocks.subscribe,
}));
vi.mock("./sqlite-library", () => ({
  clearNormalizedLocalSnapshots: vi.fn(),
  createNormalizedLocalSnapshot: vi.fn(),
  isSqliteLibraryActive: () => true,
  listNormalizedLocalSnapshots: mocks.snapshots,
  restoreNormalizedLocalSnapshot: mocks.restore,
}));
vi.mock("./background-runtime-coordinator.js", () => ({
  isBackgroundRuntimeDeferredError: () => false,
  runBackgroundJob: vi.fn(),
}));
vi.mock("./logger.js", () => ({
  log: { error: vi.fn(), info: vi.fn() },
}));

import { listSnapshots, restoreSnapshot, startSnapshotManager, stopSnapshotManager } from "./snapshots";
import { pauseDesktopOperationsForHandoff } from "./factory-reset-guard";

describe("SQLite snapshot summaries", () => {
  it("retains an accepted restore until handoff drain and refuses new restores", async () => {
    let complete!: () => void;
    mocks.restore.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const restore = restoreSnapshot("snapshot-1");
    await vi.waitFor(() => expect(mocks.restore).toHaveBeenCalledOnce());
    const pause = pauseDesktopOperationsForHandoff();
    try {
      const drained = vi.fn();
      const drain = pause.drain(1_000).then(drained);
      await expect(restoreSnapshot("snapshot-1")).rejects.toThrow("pausing");
      expect(drained).not.toHaveBeenCalled();
      complete();
      await restore;
      await drain;
      expect(drained).toHaveBeenCalledOnce();
    } finally { pause.resume(); }
  });

  it("does not resurrect a stopped manager after its snapshot listing finishes", async () => {
    let complete!: (value: unknown[]) => void;
    mocks.snapshots.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const start = startSnapshotManager();
    const pause = pauseDesktopOperationsForHandoff();
    stopSnapshotManager();
    pause.resume();
    complete([]);
    await start;
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.snapshots.mockReset().mockResolvedValue([
      {
        snapshotId: "snapshot-1",
        archiveByteLength: 4_096,
        createdAtMs: 1_000,
        itemCount: 42,
        recordCount: 89,
        reason: "manual",
      },
    ]);
    mocks.restore.mockReset();
  });

  it("reports only counts committed by the normalized snapshot", async () => {
    await expect(listSnapshots()).resolves.toEqual([
      {
        byteSize: 4_096,
        createdAt: 1_000,
        id: "snapshot-1",
        itemCount: 42,
        recordCount: 89,
        reason: "manual",
      },
    ]);
  });

  it("reuses one restore identity after a lost response", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "11111111-2222-4333-8444-555555555555",
    );
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    mocks.restore
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(undefined);

    await expect(restoreSnapshot("snapshot-1")).rejects.toThrow("response lost");
    await expect(restoreSnapshot("snapshot-1")).resolves.toMatchObject({ id: "snapshot-1" });

    expect(mocks.restore).toHaveBeenNthCalledWith(1, "snapshot-1", {
      operationId:
        "local-snapshot-restore:11111111-2222-4333-8444-555555555555",
      restoredAtMs: 2_000,
    });
    expect(mocks.restore).toHaveBeenNthCalledWith(2, "snapshot-1", {
      operationId:
        "local-snapshot-restore:11111111-2222-4333-8444-555555555555",
      restoredAtMs: 2_000,
    });
  });
});
