import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gdriveDownloadLatestMock = vi.fn();
const gdriveStartPollLoopMock = vi.fn();
const mergeDocMock = vi.fn();
const addDebugEventMock = vi.fn();
const updateCloudProviderMock = vi.fn();

vi.mock("@freed/sync/cloud", () => ({
  gdriveDownloadLatest: gdriveDownloadLatestMock,
  gdriveStartPollLoop: gdriveStartPollLoopMock,
  gdriveUploadSafe: vi.fn(),
  gdriveDeleteFile: vi.fn(),
  dropboxDownloadLatest: vi.fn(),
  dropboxStartLongpollLoop: vi.fn(),
  dropboxUploadSafe: vi.fn(),
  dropboxDeleteFile: vi.fn(),
}));

vi.mock("./automerge", () => ({
  getDocBinary: vi.fn(() => new Uint8Array()),
  mergeDoc: mergeDocMock,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: addDebugEventMock,
  updateCloudProvider: updateCloudProviderMock,
}));

describe("PWA cloud sync auth refresh", () => {
  beforeEach(() => {
    vi.resetModules();
    gdriveDownloadLatestMock.mockReset();
    gdriveStartPollLoopMock.mockReset();
    mergeDocMock.mockReset();
    addDebugEventMock.mockReset();
    updateCloudProviderMock.mockReset();
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "refreshed-access-token",
      expires_in: 3600,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
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
  });

  afterEach(async () => {
    const sync = await import("./sync");
    sync.stopCloudSync();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("refreshes and retries the initial Google Drive download before polling", async () => {
    const remote = new Uint8Array([9, 8, 7]);
    gdriveDownloadLatestMock
      .mockRejectedValueOnce(Object.assign(new Error("GDrive list failed: 401 Unauthorized"), { status: 401 }))
      .mockResolvedValueOnce(remote);
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
    }));

    const { startCloudSync, stopCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "expired-access-token");
    stopCloudSync();

    expect(fetch).toHaveBeenCalledWith("/api/oauth/google", expect.objectContaining({
      method: "POST",
    }));
    expect(gdriveDownloadLatestMock).toHaveBeenNthCalledWith(1, "expired-access-token", expect.any(AbortSignal));
    expect(gdriveDownloadLatestMock).toHaveBeenNthCalledWith(2, "refreshed-access-token", expect.any(AbortSignal));
    expect(mergeDocMock).toHaveBeenCalledWith(remote);
    await vi.waitFor(() => {
      expect(gdriveStartPollLoopMock).toHaveBeenCalledWith(
        "refreshed-access-token",
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
    expect(updateCloudProviderMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      status: "connected",
      lastRemoteBytes: remote.length,
    }));
  });
});
