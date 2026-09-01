import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginFactoryResetBoundary,
  resetFactoryResetStateForTests,
} from "@freed/ui/lib/factory-reset";

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
  clearCloudSync,
  getValidCloudToken,
  onStatusChange,
  startCloudSync,
  stopCloudSync,
  storeCloudToken,
  syncCloudProviderNow,
} from "./sync";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function successfulRefreshResponse() {
  return {
    ok: true,
    json: async () => ({
      access_token: "refreshed-access-token",
      expires_in: 3600,
    }),
  };
}

describe("PWA Library Core sync lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    resetFactoryResetStateForTests();
    stopCloudSync();
  });

  afterEach(() => {
    stopCloudSync();
    resetFactoryResetStateForTests();
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
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantType: "refresh_token",
          refreshToken: "stored-refresh-token",
        }),
      },
    );
    expect(mocks.syncLibraryCore).toHaveBeenNthCalledWith(2, {
      accessToken: "refreshed-access-token",
      signal: expect.any(AbortSignal),
    });
    expect(localStorage.getItem("freed_cloud_token_gdrive")).toBe(
      "refreshed-access-token",
    );
    expect(
      JSON.parse(
        localStorage.getItem("freed_cloud_token_meta_gdrive") ?? "null",
      ),
    ).toEqual(
      expect.objectContaining({
        accessToken: "refreshed-access-token",
        refreshToken: "stored-refresh-token",
      }),
    );
  });

  it("does not restore credentials when a refresh settles after Disconnect", async () => {
    storeCloudToken("gdrive", {
      accessToken: "expired-access-token",
      refreshToken: "stored-refresh-token",
      expiresAt: 1,
    });
    const response = deferred<ReturnType<typeof successfulRefreshResponse>>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));

    const refresh = getValidCloudToken("gdrive");
    expect(fetch).toHaveBeenCalledTimes(1);

    clearCloudSync("gdrive");
    expect(localStorage.getItem("freed_cloud_provider")).toBeNull();
    expect(localStorage.getItem("freed_cloud_token_gdrive")).toBeNull();
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBeNull();

    response.resolve(successfulRefreshResponse());
    await expect(refresh).resolves.toBeNull();
    expect(localStorage.getItem("freed_cloud_provider")).toBeNull();
    expect(localStorage.getItem("freed_cloud_token_gdrive")).toBeNull();
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBeNull();
  });

  it("rejects a refresh after the cloud lifecycle stops with credentials unchanged", async () => {
    storeCloudToken("gdrive", {
      accessToken: "expired-access-token",
      refreshToken: "stored-refresh-token",
      expiresAt: 1,
    });
    const accessBefore = localStorage.getItem("freed_cloud_token_gdrive");
    const metadataBefore = localStorage.getItem(
      "freed_cloud_token_meta_gdrive",
    );
    const response = deferred<ReturnType<typeof successfulRefreshResponse>>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));

    const refresh = getValidCloudToken("gdrive");
    expect(fetch).toHaveBeenCalledTimes(1);
    stopCloudSync();

    response.resolve(successfulRefreshResponse());
    await expect(refresh).resolves.toBeNull();
    expect(localStorage.getItem("freed_cloud_token_gdrive")).toBe(accessBefore);
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBe(
      metadataBefore,
    );
  });

  it("does not write refreshed credentials after factory reset begins", async () => {
    storeCloudToken("gdrive", {
      accessToken: "expired-access-token",
      refreshToken: "stored-refresh-token",
      expiresAt: 1,
    });
    const accessBefore = localStorage.getItem("freed_cloud_token_gdrive");
    const metadataBefore = localStorage.getItem(
      "freed_cloud_token_meta_gdrive",
    );
    const response = deferred<ReturnType<typeof successfulRefreshResponse>>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));

    const refresh = getValidCloudToken("gdrive");
    expect(fetch).toHaveBeenCalledTimes(1);
    beginFactoryResetBoundary();

    response.resolve(successfulRefreshResponse());
    await expect(refresh).resolves.toBeNull();
    expect(localStorage.getItem("freed_cloud_token_gdrive")).toBe(accessBefore);
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBe(
      metadataBefore,
    );
  });

  it.each([
    [
      "access token",
      {
        accessToken: "replacement-access-token",
        refreshToken: "account-a-refresh-token",
        expiresAt: 1,
      },
    ],
    [
      "refresh token",
      {
        accessToken: "account-a-access-token",
        refreshToken: "replacement-refresh-token",
        expiresAt: 1,
      },
    ],
    [
      "expiry",
      {
        accessToken: "account-a-access-token",
        refreshToken: "account-a-refresh-token",
        expiresAt: 2,
      },
    ],
  ])(
    "does not overwrite a replacement that changes only the %s",
    async (_field, replacement) => {
      storeCloudToken("gdrive", {
        accessToken: "account-a-access-token",
        refreshToken: "account-a-refresh-token",
        expiresAt: 1,
      });
      const response =
        deferred<ReturnType<typeof successfulRefreshResponse>>();
      vi.stubGlobal("fetch", vi.fn(() => response.promise));

      const refresh = getValidCloudToken("gdrive");
      expect(fetch).toHaveBeenCalledTimes(1);
      storeCloudToken("gdrive", replacement);

      response.resolve(successfulRefreshResponse());
      await expect(refresh).resolves.toBeNull();
      expect(localStorage.getItem("freed_cloud_provider")).toBe("gdrive");
      expect(localStorage.getItem("freed_cloud_token_gdrive")).toBe(
        replacement.accessToken,
      );
      expect(
        JSON.parse(
          localStorage.getItem("freed_cloud_token_meta_gdrive") ?? "null",
        ),
      ).toEqual(replacement);
    },
  );
});
