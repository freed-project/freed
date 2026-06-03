import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const gdriveDownloadLatestMock = vi.fn();
const gdriveStartPollLoopMock = vi.fn();
const subscribeMock = vi.fn(() => vi.fn());
const recordProviderHealthEventMock = vi.fn();
const logInfoMock = vi.fn();
const logWarnMock = vi.fn();
const logErrorMock = vi.fn();
const updateCloudProviderMock = vi.fn();
const recordCloudProviderEventMock = vi.fn();
const gdriveUploadSafeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

vi.mock("@freed/sync/cloud", () => ({
  gdriveDownloadLatest: gdriveDownloadLatestMock,
  gdriveStartPollLoop: gdriveStartPollLoopMock,
  gdriveUploadSafe: gdriveUploadSafeMock,
  gdriveDeleteFile: vi.fn(),
  dropboxDownloadLatest: vi.fn(),
  dropboxStartLongpollLoop: vi.fn(),
  dropboxUploadSafe: vi.fn(),
  dropboxDeleteFile: vi.fn(),
}));

vi.mock("./automerge", () => ({
  getDocBinary: vi.fn(async () => new Uint8Array()),
  mergeDoc: vi.fn(),
  setRelayClientCount: vi.fn(),
  subscribe: subscribeMock,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
  recordCloudProviderEvent: recordCloudProviderEventMock,
  updateCloudProvider: updateCloudProviderMock,
}));

vi.mock("./logger.js", () => ({
  log: {
    info: logInfoMock,
    warn: logWarnMock,
    error: logErrorMock,
  },
}));

vi.mock("./provider-health", () => ({
  recordProviderHealthEvent: recordProviderHealthEventMock,
}));

describe("desktop cloud sync auth refresh", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    vi.stubEnv("VITE_GDRIVE_TOKEN_PROXY_URL", "https://app.freed.wtf/api/oauth/google");
    vi.stubEnv(
      "VITE_GDRIVE_DESKTOP_CLIENT_ID",
      "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com",
    );
    invokeMock.mockReset();
    gdriveDownloadLatestMock.mockReset();
    gdriveStartPollLoopMock.mockReset();
    subscribeMock.mockClear();
    recordProviderHealthEventMock.mockReset();
    logInfoMock.mockReset();
    logWarnMock.mockReset();
    logErrorMock.mockReset();
    updateCloudProviderMock.mockReset();
    recordCloudProviderEventMock.mockReset();
    gdriveUploadSafeMock.mockReset();
    localStorage.clear();
  });

  afterEach(async () => {
    const sync = await import("./sync");
    sync.stopAllCloudSyncs();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("preserves the existing Google refresh token when reconnect only returns an access token", async () => {
    const { storeCloudToken } = await import("./sync");

    storeCloudToken("gdrive", {
      accessToken: "old-access-token",
      refreshToken: "existing-refresh-token",
      expiresAt: Date.now() + 3_600_000,
    });
    storeCloudToken("gdrive", {
      accessToken: "new-access-token",
      expiresAt: Date.now() + 3_600_000,
    });

    const stored = JSON.parse(localStorage.getItem("freed_cloud_token_meta_gdrive") ?? "{}") as {
      accessToken?: string;
      refreshToken?: string;
    };
    expect(stored.accessToken).toBe("new-access-token");
    expect(stored.refreshToken).toBe("existing-refresh-token");
  });

  it("does not refresh a valid Google token after a non-refreshable Drive 403", async () => {
    const oauthCalls: string[] = [];
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "google_oauth_proxy_request") {
        oauthCalls.push(cmd);
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            access_token: "unexpected-refresh",
            expires_in: 3600,
          }))),
        };
      }
      return null;
    });
    gdriveDownloadLatestMock.mockResolvedValue(null);
    gdriveStartPollLoopMock.mockRejectedValue(
      Object.assign(new Error("GDrive changes failed: 403 Forbidden - insufficientPermissions"), {
        status: 403,
      }),
    );
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "valid-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
    }));

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "valid-access-token");

    await vi.waitFor(() => {
      expect(recordProviderHealthEventMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: "gdrive",
        outcome: "error",
        stage: "poll",
      }));
    });

    expect(oauthCalls).toHaveLength(0);
    expect(gdriveStartPollLoopMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalledWith(expect.stringContaining("auth failure is not refreshable status=403"));
  });

  it("refreshes only once when Drive keeps rejecting a token with 401", async () => {
    const oauthCalls: string[] = [];
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "google_oauth_proxy_request") {
        oauthCalls.push(String(args?.body ?? ""));
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 3600,
          }))),
        };
      }
      return null;
    });
    gdriveDownloadLatestMock.mockResolvedValue(null);
    gdriveStartPollLoopMock.mockRejectedValue(
      Object.assign(new Error("GDrive changes failed: 401 Unauthorized"), {
        status: 401,
      }),
    );
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
    }));

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "expired-access-token");

    await vi.waitFor(() => {
      expect(recordProviderHealthEventMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: "gdrive",
        outcome: "error",
        stage: "poll",
      }));
    });

    expect(oauthCalls).toHaveLength(1);
    expect(gdriveStartPollLoopMock).toHaveBeenCalledTimes(2);
    expect(logWarnMock).toHaveBeenCalledWith(expect.stringContaining("auth failure refresh suppressed"));
  });

  it("refreshes and retries the initial Google Drive download before polling", async () => {
    const oauthCalls: string[] = [];
    const remote = new Uint8Array([5, 4, 3]);
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "google_oauth_proxy_request") {
        oauthCalls.push(String(args?.body ?? ""));
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 3600,
          }))),
        };
      }
      return null;
    });
    gdriveDownloadLatestMock
      .mockRejectedValueOnce(Object.assign(new Error("GDrive list failed: 401 Unauthorized"), { status: 401 }))
      .mockResolvedValueOnce(remote);
    gdriveStartPollLoopMock.mockImplementation(
      async (_token: string, _onRemoteChange: (binary: Uint8Array) => void, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
    }));

    const { startCloudSync, stopAllCloudSyncs } = await import("./sync");
    await startCloudSync("gdrive", "expired-access-token");
    stopAllCloudSyncs();

    expect(oauthCalls).toHaveLength(1);
    expect(gdriveDownloadLatestMock).toHaveBeenNthCalledWith(
      1,
      "expired-access-token",
      expect.any(AbortSignal),
      undefined,
    );
    expect(gdriveDownloadLatestMock).toHaveBeenNthCalledWith(
      2,
      "refreshed-access-token",
      expect.any(AbortSignal),
      undefined,
    );
    const { mergeDoc } = await import("./automerge");
    expect(mergeDoc).toHaveBeenCalledWith(remote);
    expect(gdriveStartPollLoopMock).toHaveBeenCalledWith(
      "refreshed-access-token",
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
      undefined,
    );
    expect(updateCloudProviderMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      status: "connected",
      lastRemoteBytes: remote.length,
    }));
  });

  it("runs an immediate Google Drive download and upload for manual sync", async () => {
    gdriveDownloadLatestMock.mockResolvedValue(null);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBytes: 0,
      remoteBytes: 0,
      mergedRemote: false,
      uploadedBinary: new Uint8Array(),
    });

    const { storeCloudToken, syncCloudProviderNow } = await import("./sync");
    storeCloudToken("gdrive", {
      accessToken: "valid-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 120_000,
    });

    await syncCloudProviderNow("gdrive");

    expect(gdriveDownloadLatestMock).toHaveBeenCalledWith(
      "valid-access-token",
      expect.any(AbortSignal),
      undefined,
    );
    expect(gdriveUploadSafeMock).toHaveBeenCalledWith(
      "valid-access-token",
      expect.any(Uint8Array),
      undefined,
    );
    expect(updateCloudProviderMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      statusMessage: "Manual sync requested.",
      pendingReason: "Checking cloud storage, then uploading the local document.",
    }));
    expect(updateCloudProviderMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      lastUploadAt: expect.any(Number),
      lastUploadedBytes: 0,
      statusMessage: "Upload complete.",
    }));
    expect(recordCloudProviderEventMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      kind: "queued",
      message: "Manual sync requested.",
    }));
  });

  it("uses the default Google token proxy when a stored token refreshes with empty proxy env", async () => {
    vi.stubEnv("VITE_GDRIVE_TOKEN_PROXY_URL", "");
    const oauthCalls: Array<{ url: string; body: string; contentType: string }> = [];
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "google_oauth_proxy_request") {
        oauthCalls.push({
          url: String(args?.url ?? ""),
          body: String(args?.body ?? ""),
          contentType: String(args?.contentType ?? ""),
        });
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 3600,
          }))),
        };
      }
      return null;
    });
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 60_000,
    }));

    const { startAllCloudSyncs } = await import("./sync");
    await expect(startAllCloudSyncs()).resolves.toBeUndefined();

    expect(oauthCalls).toHaveLength(1);
    expect(oauthCalls[0]?.url).toBe("https://app.freed.wtf/api/oauth/google");
    expect(oauthCalls[0]?.contentType).toBe("application/json");
    expect(JSON.parse(oauthCalls[0]!.body)).toMatchObject({
      grantType: "refresh_token",
      refreshToken: "refresh-token",
      clientId: "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com",
    });
    expect(gdriveDownloadLatestMock).toHaveBeenCalledWith(
      "refreshed-access-token",
      expect.any(AbortSignal),
      undefined,
    );
  });

  it("does not crash startup when the Google token proxy is missing its secret", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "google_oauth_proxy_request") {
        return {
          status: 400,
          headers: [["content-type", "application/json"]],
          body: Array.from(new TextEncoder().encode(JSON.stringify({
            error: "invalid_request",
            error_description: "client_secret is missing.",
          }))),
        };
      }
      return null;
    });
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 60_000,
    }));

    const { startAllCloudSyncs } = await import("./sync");
    await expect(startAllCloudSyncs()).resolves.toBeUndefined();

    expect(gdriveDownloadLatestMock).not.toHaveBeenCalled();
    expect(gdriveStartPollLoopMock).not.toHaveBeenCalled();
    expect(recordProviderHealthEventMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gdrive",
      outcome: "error",
      stage: "auth",
      reason: expect.stringContaining("Google token proxy is missing"),
    }));
    expect(logWarnMock).toHaveBeenCalledWith(expect.stringContaining("Failed to refresh gdrive on startup"));
  });
});
