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
    vi.unstubAllGlobals();
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
        statusMessage:
          "Waiting for the Primary Freed Desktop to publish its first Library checkpoint.",
        pendingReason:
          "Your Google Drive connection is working. No remote Library has been published yet.",
      }),
    );

    mocks.syncLibraryCore.mockResolvedValueOnce({});
    await syncCloudProviderNow("gdrive");

    expect(statuses.at(-1)).toBe(true);
    expect(mocks.syncLibraryCore).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("refreshes an unexpectedly rejected Google token and retries once", async () => {
    localStorage.setItem(
      "freed_cloud_token_meta_gdrive",
      JSON.stringify({
        accessToken: "expired-access-token",
        refreshToken: "stored-refresh-token",
        expiresAt: Date.now() + 30 * 60 * 1000,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "refreshed-access-token",
          expires_in: 3600,
        }),
      }),
    );
    mocks.syncLibraryCore
      .mockRejectedValueOnce(
        new Error(
          "Library Core Drive list failed: 401 - invalid authentication credentials",
        ),
      )
      .mockResolvedValueOnce({});

    await startCloudSync("gdrive", "expired-access-token");

    expect(fetch).toHaveBeenCalledWith(
      "/api/oauth/google",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          grantType: "refresh_token",
          refreshToken: "stored-refresh-token",
        }),
      }),
    );
    expect(mocks.syncLibraryCore).toHaveBeenNthCalledWith(2, {
      accessToken: "refreshed-access-token",
      signal: expect.any(AbortSignal),
    });
  });
});
