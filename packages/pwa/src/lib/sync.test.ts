import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordCloudProviderEvent: vi.fn(),
  syncLibraryCore: vi.fn(),
  updateCloudProvider: vi.fn(),
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  recordCloudProviderEvent: mocks.recordCloudProviderEvent,
  updateCloudProvider: mocks.updateCloudProvider,
}));

vi.mock("./library-core-runtime", () => ({
  syncPwaLibraryCoreFromGoogleDrive: mocks.syncLibraryCore,
}));

import {
  onStatusChange,
  startCloudSync,
  stopCloudSync,
  syncCloudProviderNow,
} from "./sync";

describe("PWA Library Core sync lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    stopCloudSync();
  });

  afterEach(() => {
    stopCloudSync();
    vi.useRealTimers();
  });

  it("surfaces an initial failure and lets Sync now restore the live session", async () => {
    const statuses: boolean[] = [];
    const unsubscribe = onStatusChange((connected) => statuses.push(connected));
    mocks.syncLibraryCore.mockRejectedValueOnce(
      new Error("No published SQLite Library was found in Google Drive"),
    );

    await expect(startCloudSync("gdrive", "stored-token")).rejects.toThrow(
      "No published SQLite Library was found in Google Drive",
    );
    expect(statuses.at(-1)).toBe(false);
    expect(mocks.updateCloudProvider).toHaveBeenCalledWith(
      "gdrive",
      expect.objectContaining({
        status: "error",
        error: "No published SQLite Library was found in Google Drive",
      }),
    );

    mocks.syncLibraryCore.mockResolvedValueOnce({});
    await syncCloudProviderNow("gdrive");

    expect(statuses.at(-1)).toBe(true);
    expect(mocks.syncLibraryCore).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
