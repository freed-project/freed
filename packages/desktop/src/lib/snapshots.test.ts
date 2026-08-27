import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backups: vi.fn(),
  facetSummary: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@freed/ui/lib/factory-reset", () => ({
  isFactoryResetInProgress: () => false,
  waitForFactoryResetDrain: vi.fn(),
}));
vi.mock("./library-client", () => ({
  reloadSqliteLibraryState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("./library-core-item-detail-runtime", () => ({
  readLibraryCoreFacetSummary: mocks.facetSummary,
}));
vi.mock("./sqlite-library", () => ({
  clearSqliteLibraryBackups: vi.fn(),
  createSqliteLibraryBackup: vi.fn(),
  isSqliteLibraryActive: () => true,
  listSqliteLibraryBackups: mocks.backups,
  restoreSqliteLibraryBackup: vi.fn(),
}));
vi.mock("./contact-sync-storage.js", () => ({
  readContactSyncState: () => ({
    cachedContacts: [{ id: "contact-1" }, { id: "contact-2" }],
    pendingSuggestions: [{ id: "suggestion-1" }],
  }),
}));
vi.mock("./background-runtime-coordinator.js", () => ({
  isBackgroundRuntimeDeferredError: () => false,
  runBackgroundJob: vi.fn(),
}));
vi.mock("./logger.js", () => ({
  log: { error: vi.fn(), info: vi.fn() },
}));

import { listSnapshots } from "./snapshots";

describe("SQLite snapshot summaries", () => {
  beforeEach(() => {
    mocks.facetSummary.mockReset().mockResolvedValue({
      friendPersonCount: 7,
    });
    mocks.backups.mockReset().mockResolvedValue([
      {
        backupId: "backup-1",
        byteLength: 4_096,
        createdAtMs: 1_000,
        itemCount: 42,
        reason: "manual",
      },
    ]);
  });

  it("reads the Friend count from the exact maintained SQLite facet", async () => {
    await expect(listSnapshots()).resolves.toEqual([
      {
        byteSize: 4_096,
        contactCount: 2,
        createdAt: 1_000,
        friendCount: 7,
        id: "backup-1",
        itemCount: 42,
        pendingMatchCount: 1,
        reason: "manual",
      },
    ]);
    expect(mocks.facetSummary).toHaveBeenCalledOnce();
  });
});
