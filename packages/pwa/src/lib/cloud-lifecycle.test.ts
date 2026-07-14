import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gdriveDownloadLatestMock = vi.fn();
const dropboxDownloadLatestMock = vi.fn();
const gdriveStartPollLoopMock = vi.fn();
const dropboxStartLongpollLoopMock = vi.fn();
const gdriveUploadSafeMock = vi.fn();
const dropboxUploadSafeMock = vi.fn();
const gdriveDeleteFileMock = vi.fn();
const dropboxDeleteFileMock = vi.fn();
const compareDocMock = vi.fn();
const getDocBinaryMock = vi.fn();
const getDocHeadsMock = vi.fn();
const initDocMock = vi.fn();
const mergeDocMock = vi.fn();
const subscribeMock = vi.fn();
const addDebugEventMock = vi.fn();

vi.mock("@freed/sync/cloud", () => ({
  gdriveDownloadLatest: gdriveDownloadLatestMock,
  dropboxDownloadLatest: dropboxDownloadLatestMock,
  gdriveStartPollLoop: gdriveStartPollLoopMock,
  dropboxStartLongpollLoop: dropboxStartLongpollLoopMock,
  gdriveUploadSafe: gdriveUploadSafeMock,
  dropboxUploadSafe: dropboxUploadSafeMock,
  gdriveDeleteFile: gdriveDeleteFileMock,
  dropboxDeleteFile: dropboxDeleteFileMock,
}));

vi.mock("./automerge", () => ({
  compareDoc: compareDocMock,
  getDocBinary: getDocBinaryMock,
  getDocHeads: getDocHeadsMock,
  initDoc: initDocMock,
  mergeDoc: mergeDocMock,
  subscribe: subscribeMock,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: addDebugEventMock,
  recordCloudProviderEvent: vi.fn(),
  updateCloudProvider: vi.fn(),
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

describe("PWA cloud lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    for (const mock of [
      gdriveDownloadLatestMock,
      dropboxDownloadLatestMock,
      gdriveStartPollLoopMock,
      dropboxStartLongpollLoopMock,
      gdriveUploadSafeMock,
      dropboxUploadSafeMock,
      gdriveDeleteFileMock,
      dropboxDeleteFileMock,
      compareDocMock,
      getDocBinaryMock,
      getDocHeadsMock,
      initDocMock,
      mergeDocMock,
      subscribeMock,
      addDebugEventMock,
    ]) {
      mock.mockReset();
    }
    compareDocMock.mockResolvedValue("equal");
    getDocBinaryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    getDocHeadsMock.mockResolvedValue(["local-head"]);
    initDocMock.mockResolvedValue({});
    mergeDocMock.mockResolvedValue(undefined);
    subscribeMock.mockReturnValue(vi.fn());
    gdriveUploadSafeMock.mockResolvedValue(uploadResult);
    dropboxUploadSafeMock.mockResolvedValue(undefined);
    gdriveStartPollLoopMock.mockResolvedValue(undefined);
    dropboxStartLongpollLoopMock.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(async () => {
    const sync = await import("./sync");
    sync.stopCloudSync();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("publishes an offline PWA change once when the remote history lacks it", async () => {
    const remote = new Uint8Array([9, 8, 7]);
    gdriveDownloadLatestMock.mockResolvedValue(remote);
    compareDocMock.mockResolvedValue("diverged");

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "token");

    expect(compareDocMock).toHaveBeenCalledWith(remote);
    expect(mergeDocMock).toHaveBeenCalledWith(remote);
    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(1);
    expect(mergeDocMock.mock.invocationCallOrder[0]).toBeLessThan(
      gdriveUploadSafeMock.mock.invocationCallOrder[0],
    );
    expect(addDebugEventMock).toHaveBeenCalledWith(
      "change",
      expect.stringContaining('"cause":"startup-repair"'),
    );
  });

  it.each(["equal", "incoming-ahead"] as const)(
    "does not repair a remote history classified as %s",
    async (relation) => {
      gdriveDownloadLatestMock.mockResolvedValue(new Uint8Array([4, 5, 6]));
      compareDocMock.mockResolvedValue(relation);

      const { startCloudSync } = await import("./sync");
      await startCloudSync("gdrive", "token");

      expect(gdriveUploadSafeMock).not.toHaveBeenCalled();
    },
  );

  it("repairs an empty remote exactly once", async () => {
    gdriveDownloadLatestMock.mockResolvedValue(null);

    const { startCloudSync } = await import("./sync");
    await startCloudSync("gdrive", "token");

    expect(compareDocMock).not.toHaveBeenCalled();
    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(1);
  });

  it("does not start after document initialization is canceled", async () => {
    const initialization = deferred<Record<string, never>>();
    initDocMock.mockReturnValue(initialization.promise);

    const sync = await import("./sync");
    const start = sync.startCloudSync("gdrive", "token");
    await Promise.resolve();
    sync.stopCloudSync();
    initialization.resolve({});
    await start;

    expect(gdriveDownloadLatestMock).not.toHaveBeenCalled();
    expect(gdriveStartPollLoopMock).not.toHaveBeenCalled();
    expect(gdriveUploadSafeMock).not.toHaveBeenCalled();
  });

  it("restores the prior token when a delayed refresh is canceled", async () => {
    const refresh = deferred<Response>();
    const fetchMock = vi.fn(() => refresh.promise);
    vi.stubGlobal("fetch", fetchMock);

    const sync = await import("./sync");
    sync.storeCloudToken("gdrive", {
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1,
    });
    const start = sync.startCloudSync("gdrive", "expired");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    sync.stopCloudSync();
    refresh.resolve(new Response(JSON.stringify({
      access_token: "refreshed",
      expires_in: 3600,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await start;

    expect(gdriveDownloadLatestMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("freed_cloud_token_meta_gdrive") ?? "{}")).toMatchObject({
      accessToken: "expired",
      refreshToken: "refresh",
    });
  });

  it("does not restore credentials when a delayed refresh settles after disconnect", async () => {
    const refresh = deferred<Response>();
    const fetchMock = vi.fn(() => refresh.promise);
    vi.stubGlobal("fetch", fetchMock);

    const sync = await import("./sync");
    sync.storeCloudToken("gdrive", {
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1,
    });
    const start = sync.startCloudSync("gdrive", "expired");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    sync.clearCloudSync("gdrive");
    refresh.resolve(new Response(JSON.stringify({
      access_token: "late-refresh",
      expires_in: 3600,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await start;

    expect(localStorage.getItem("freed_cloud_token_gdrive")).toBeNull();
    expect(localStorage.getItem("freed_cloud_token_meta_gdrive")).toBeNull();
  });

  it("does not replace a newer Dropbox selection when a Google refresh settles late", async () => {
    const refresh = deferred<Response>();
    const fetchMock = vi.fn(() => refresh.promise);
    vi.stubGlobal("fetch", fetchMock);

    const sync = await import("./sync");
    sync.storeCloudToken("gdrive", {
      accessToken: "expired-google",
      refreshToken: "google-refresh",
      expiresAt: Date.now() - 1,
    });
    const start = sync.startCloudSync("gdrive", "expired-google");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    sync.stopCloudSync();
    sync.storeCloudToken("dropbox", {
      accessToken: "new-dropbox",
      expiresAt: Date.now() + 60_000,
    });
    refresh.resolve(new Response(JSON.stringify({
      access_token: "late-google",
      expires_in: 3600,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await start;

    expect(localStorage.getItem("freed_cloud_provider")).toBe("dropbox");
    expect(JSON.parse(localStorage.getItem("freed_cloud_token_meta_dropbox") ?? "{}")).toMatchObject({
      accessToken: "new-dropbox",
    });
    expect(JSON.parse(localStorage.getItem("freed_cloud_token_meta_gdrive") ?? "{}")).toMatchObject({
      accessToken: "expired-google",
      refreshToken: "google-refresh",
    });
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
