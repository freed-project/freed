import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gdriveDownloadLatestMock = vi.fn();
const gdriveStartPollLoopMock = vi.fn();
const gdriveUploadSafeMock = vi.fn();
const getDocBinaryMock = vi.fn();
const initDocMock = vi.fn();
const mergeDocMock = vi.fn();
const addDebugEventMock = vi.fn();
const updateCloudProviderMock = vi.fn();
const recordCloudProviderEventMock = vi.fn();
const subscribeMock = vi.fn();
const compareDocMock = vi.fn();

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
  compareDoc: compareDocMock,
  getDocBinary: getDocBinaryMock,
  initDoc: initDocMock,
  mergeDoc: mergeDocMock,
  subscribe: subscribeMock,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: addDebugEventMock,
  recordCloudProviderEvent: recordCloudProviderEventMock,
  updateCloudProvider: updateCloudProviderMock,
}));

describe("PWA cloud sync auth refresh", () => {
  beforeEach(() => {
    vi.resetModules();
    gdriveDownloadLatestMock.mockReset();
    gdriveStartPollLoopMock.mockReset();
    gdriveUploadSafeMock.mockReset();
    getDocBinaryMock.mockReset();
    getDocBinaryMock.mockResolvedValue(new Uint8Array());
    initDocMock.mockReset();
    initDocMock.mockResolvedValue({});
    mergeDocMock.mockReset();
    addDebugEventMock.mockReset();
    updateCloudProviderMock.mockReset();
    recordCloudProviderEventMock.mockReset();
    subscribeMock.mockReset();
    subscribeMock.mockReturnValue(vi.fn());
    compareDocMock.mockReset();
    compareDocMock.mockResolvedValue("equal");
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
    vi.useRealTimers();
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

    expect(initDocMock.mock.invocationCallOrder[0]).toBeLessThan(
      gdriveDownloadLatestMock.mock.invocationCallOrder[0],
    );
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

  it("pauses Google Drive sync after an initial destructive merge block", async () => {
    const remote = new Uint8Array([9, 8, 7]);
    const blocked = new Error(
      "Freed blocked a sync merge because it would remove too much feed history. Source: PWA sync. Largest input: 11,238 items. Merged result: 0 items. Potential loss: 11,238 items (100%). Restore from a trusted snapshot or reconnect sync after confirming which copy should win.",
    );
    gdriveDownloadLatestMock.mockResolvedValue(remote);
    mergeDocMock.mockRejectedValue(blocked);
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "valid-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 120_000,
    }));

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "valid-access-token");

    expect(mergeDocMock).toHaveBeenCalledWith(remote);
    expect(gdriveStartPollLoopMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(updateCloudProviderMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      status: "error",
      stage: "merge",
      statusMessage: "Merge blocked.",
      error: blocked.message,
    }));
    expect(recordCloudProviderEventMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      kind: "waiting",
      stage: "merge",
      message: "Cloud sync paused until merge recovery is resolved.",
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
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "valid-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 120_000,
    }));

    const { syncCloudProviderNow } = await import("./sync");
    await syncCloudProviderNow("gdrive");

    expect(initDocMock.mock.invocationCallOrder[0]).toBeLessThan(
      gdriveDownloadLatestMock.mock.invocationCallOrder[0],
    );
    expect(gdriveDownloadLatestMock).toHaveBeenCalledWith("valid-access-token", expect.any(AbortSignal));
    expect(gdriveUploadSafeMock).toHaveBeenCalledWith("valid-access-token", expect.any(Uint8Array));
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

  it("reads the upload binary after the manual merge completes", async () => {
    const remote = new Uint8Array([1, 2, 3]);
    const mergedBinary = new Uint8Array([4, 5, 6]);
    gdriveDownloadLatestMock.mockResolvedValue(remote);
    getDocBinaryMock.mockResolvedValue(mergedBinary);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBytes: mergedBinary.byteLength,
      remoteBytes: remote.byteLength,
      mergedRemote: false,
      uploadedBinary: mergedBinary,
    });
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "valid-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 120_000,
    }));

    const { syncCloudProviderNow } = await import("./sync");
    await syncCloudProviderNow("gdrive");

    expect(mergeDocMock).toHaveBeenCalledWith(remote);
    expect(mergeDocMock.mock.invocationCallOrder[0]).toBeLessThan(
      getDocBinaryMock.mock.invocationCallOrder[0],
    );
    expect(gdriveUploadSafeMock).toHaveBeenCalledWith("valid-access-token", mergedBinary);
  });

  it("uploads after MERGE_DOC broadcasts while connected by Google Drive", async () => {
    vi.useFakeTimers();
    subscribeMock.mockImplementation(() => {
      return vi.fn();
    });
    gdriveDownloadLatestMock.mockResolvedValue(null);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBytes: 0,
      remoteBytes: 0,
      mergedRemote: false,
      uploadedBinary: new Uint8Array(),
    });
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "valid-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 120_000,
    }));

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "valid-access-token");

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    const notifyChange = subscribeMock.mock.calls[0]?.[0] as
      | ((state: unknown, event: { mutation: "MERGE_DOC" }) => void)
      | undefined;
    expect(notifyChange).toBeDefined();
    notifyChange?.({}, { mutation: "MERGE_DOC" });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(gdriveUploadSafeMock).toHaveBeenCalledWith("valid-access-token", expect.any(Uint8Array));
    expect(updateCloudProviderMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      lastUploadAt: expect.any(Number),
      statusMessage: "Upload complete.",
    }));
  });
});
