import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  snapshots: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@freed/ui/lib/factory-reset", () => ({
  isFactoryResetInProgress: () => false,
  waitForFactoryResetDrain: vi.fn(),
}));
vi.mock("./library-client", () => ({
  reloadDesktopLibraryRuntimeState: vi.fn(),
  subscribeDesktopLibraryRuntime: vi.fn(() => () => {}),
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

import { listSnapshots, restoreSnapshot } from "./snapshots";

describe("SQLite snapshot summaries", () => {
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
