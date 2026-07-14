import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const gdriveDownloadLatestMock = vi.fn();
const dropboxDownloadLatestMock = vi.fn();
const gdriveStartPollLoopMock = vi.fn();
const dropboxStartLongpollLoopMock = vi.fn();
const gdriveUploadSafeMock = vi.fn();
const dropboxUploadSafeMock = vi.fn();
const gdriveDeleteFileMock = vi.fn();
const dropboxDeleteFileMock = vi.fn();
const compareDocMock = vi.fn();
const mergeDocMock = vi.fn(async () => {});
const getDocBinaryMock = vi.fn(async () => new Uint8Array([1, 2, 3]));
const getDocHeadsMock = vi.fn(async () => ["local-head"]);
const subscribeMock = vi.fn(() => vi.fn());
const recordCloudUploadAttemptMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

vi.mock("@freed/sync/cloud", () => ({
  gdriveDownloadLatest: gdriveDownloadLatestMock,
  dropboxDownloadLatest: dropboxDownloadLatestMock,
  gdriveStartPollLoop: gdriveStartPollLoopMock,
  dropboxStartLongpollLoop: dropboxStartLongpollLoopMock,
  gdriveUploadSafe: gdriveUploadSafeMock,
  dropboxUploadSafe: dropboxUploadSafeMock,
  gdriveUploadReplace: vi.fn(),
  dropboxUploadReplace: vi.fn(),
  gdriveDeleteFile: gdriveDeleteFileMock,
  dropboxDeleteFile: dropboxDeleteFileMock,
}));

vi.mock("./automerge", () => ({
  compareDoc: compareDocMock,
  getDocBinary: getDocBinaryMock,
  getDocHeads: getDocHeadsMock,
  mergeDoc: mergeDocMock,
  replaceLocalDoc: vi.fn(),
  setRelayClientCount: vi.fn(),
  subscribe: subscribeMock,
}));

vi.mock("./runtime-health-events", () => ({
  recordCloudUploadAttempt: recordCloudUploadAttemptMock,
  recordCloudUploadSkipped: vi.fn(),
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
  recordCloudProviderEvent: vi.fn(),
  updateCloudProvider: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./provider-health", () => ({
  recordProviderHealthEvent: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const uploadResult = {
  fileId: "file-1",
  uploadedBinary: new Uint8Array([1, 2, 3]),
  uploadedBytes: 3,
  remoteBytes: 0,
  mergedRemote: false,
};

describe("desktop cloud lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    vi.stubEnv("VITE_GDRIVE_TOKEN_PROXY_URL", "https://app.freed.wtf/api/oauth/google");
    for (const mock of [
      invokeMock,
      gdriveDownloadLatestMock,
      dropboxDownloadLatestMock,
      gdriveStartPollLoopMock,
      dropboxStartLongpollLoopMock,
      gdriveUploadSafeMock,
      dropboxUploadSafeMock,
      gdriveDeleteFileMock,
      dropboxDeleteFileMock,
      compareDocMock,
      mergeDocMock,
      getDocBinaryMock,
      getDocHeadsMock,
      subscribeMock,
      recordCloudUploadAttemptMock,
    ]) {
      mock.mockReset();
    }
    compareDocMock.mockResolvedValue("equal");
    mergeDocMock.mockResolvedValue(undefined);
    getDocBinaryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    getDocHeadsMock.mockResolvedValue(["local-head"]);
    subscribeMock.mockReturnValue(vi.fn());
    gdriveUploadSafeMock.mockResolvedValue(uploadResult);
    dropboxUploadSafeMock.mockResolvedValue(undefined);
    gdriveStartPollLoopMock.mockResolvedValue(undefined);
    dropboxStartLongpollLoopMock.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(async () => {
    const sync = await import("./sync");
    sync.stopAllCloudSyncs();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("publishes a local Desktop registration once when the remote history lacks it", async () => {
    const remote = new Uint8Array([9, 8, 7]);
    gdriveDownloadLatestMock.mockResolvedValue(remote);
    compareDocMock.mockResolvedValue("local-ahead");

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "token");

    expect(compareDocMock).toHaveBeenCalledWith(remote);
    expect(mergeDocMock).toHaveBeenCalledWith(remote);
    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(1);
    expect(mergeDocMock.mock.invocationCallOrder[0]).toBeLessThan(
      gdriveUploadSafeMock.mock.invocationCallOrder[0],
    );
    expect(recordCloudUploadAttemptMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gdrive",
      cause: "startup-repair",
    }));
  });

  it.each(["equal", "incoming-ahead"] as const)(
    "does not repair a remote history classified as %s",
    async (relation) => {
      gdriveDownloadLatestMock.mockResolvedValue(new Uint8Array([4, 5, 6]));
      compareDocMock.mockResolvedValue(relation);

      const { startCloudSync } = await import("./sync");
      await startCloudSync("gdrive", "token");

      expect(gdriveUploadSafeMock).not.toHaveBeenCalled();
      expect(recordCloudUploadAttemptMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ cause: "startup-repair" }),
      );
    },
  );

  it("repairs an empty remote exactly once", async () => {
    gdriveDownloadLatestMock.mockResolvedValue(null);

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "token");

    expect(compareDocMock).not.toHaveBeenCalled();
    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(1);
    expect(recordCloudUploadAttemptMock).toHaveBeenCalledWith(expect.objectContaining({
      cause: "startup-repair",
    }));
  });

  it("does not resume after a delayed token refresh is canceled", async () => {
    const refresh = deferred<{ status: number; headers: Array<[string, string]>; body: number[] }>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "google_oauth_proxy_request") return refresh.promise;
      return Promise.resolve(null);
    });
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1,
    }));

    const sync = await import("./sync");
    const restart = sync.restartCloudSync("gdrive");
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "google_oauth_proxy_request",
      expect.any(Object),
    ));
    sync.stopCloudSync("gdrive");
    refresh.resolve({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: Array.from(new TextEncoder().encode(JSON.stringify({
        access_token: "refreshed",
        expires_in: 3600,
      }))),
    });
    await restart;

    expect(gdriveDownloadLatestMock).not.toHaveBeenCalled();
    expect(gdriveStartPollLoopMock).not.toHaveBeenCalled();
    expect(gdriveUploadSafeMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("freed_cloud_token_meta_gdrive") ?? "{}")).toMatchObject({
      accessToken: "expired",
      refreshToken: "refresh",
    });
  });

  it("does not restore credentials when a delayed refresh settles after disconnect", async () => {
    const refresh = deferred<{ status: number; headers: Array<[string, string]>; body: number[] }>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "google_oauth_proxy_request") return refresh.promise;
      return Promise.resolve(null);
    });
    localStorage.setItem("freed_cloud_token_gdrive", "expired");
    localStorage.setItem("freed_cloud_token_meta_gdrive", JSON.stringify({
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1,
    }));

    const sync = await import("./sync");
    const restart = sync.restartCloudSync("gdrive");
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "google_oauth_proxy_request",
      expect.any(Object),
    ));
    sync.clearCloudProvider("gdrive");
    refresh.resolve({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: Array.from(new TextEncoder().encode(JSON.stringify({
        access_token: "late-refresh",
        expires_in: 3600,
      }))),
    });
    await restart;

    expect(localStorage.getItem("freed_cloud_token_gdrive")).toBeNull();
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBeNull();
  });

  it.each(["gdrive", "dropbox"] as const)(
    "waits for an active %s upload before deleting and blocks stale recreation",
    async (provider) => {
      vi.useFakeTimers();
      const activeUpload = deferred<typeof uploadResult | void>();
      if (provider === "gdrive") {
        gdriveUploadSafeMock.mockReturnValue(activeUpload.promise);
      } else {
        dropboxUploadSafeMock.mockReturnValue(activeUpload.promise);
      }

      const sync = await import("./sync");
      sync.storeCloudToken(provider, {
        accessToken: "token",
        expiresAt: Date.now() + 60_000,
      });
      sync.scheduleCloudUpload(provider, "token");
      await vi.advanceTimersByTimeAsync(2_000);

      const deleteFile = sync.deleteCloudFile(provider, "token");
      await Promise.resolve();
      const deleteMock = provider === "gdrive" ? gdriveDeleteFileMock : dropboxDeleteFileMock;
      expect(deleteMock).not.toHaveBeenCalled();

      activeUpload.resolve(provider === "gdrive" ? uploadResult : undefined);
      await deleteFile;
      expect(deleteMock).toHaveBeenCalledTimes(1);

      await vi.runAllTimersAsync();
      const uploadMock = provider === "gdrive" ? gdriveUploadSafeMock : dropboxUploadSafeMock;
      expect(uploadMock).toHaveBeenCalledTimes(1);
    },
  );
});
