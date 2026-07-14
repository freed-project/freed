import * as A from "@automerge/automerge";
import { createEmptyDoc, type FreedDoc } from "@freed/shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocState, WorkerRequest, WorkerResponse } from "./automerge-types";

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
const updateCloudProviderMock = vi.fn();
const recordCloudProviderEventMock = vi.fn();

const storageHarness = vi.hoisted(() => ({
  binary: null as Uint8Array | null,
}));

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
  recordCloudProviderEvent: recordCloudProviderEventMock,
  updateCloudProvider: updateCloudProviderMock,
}));

vi.mock("@freed/sync/storage/indexeddb", () => ({
  IndexedDBStorage: class {
    async load(): Promise<Uint8Array | null> {
      return storageHarness.binary?.slice() ?? null;
    }

    async save(binary: Uint8Array): Promise<void> {
      storageHarness.binary = binary.slice();
    }

    async clear(): Promise<void> {
      storageHarness.binary = null;
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function emptyState(): DocState {
  return {
    items: [],
    searchCorpusVersion: 1,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createEmptyDoc().preferences,
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function startSyncAndCaptureSubscriber() {
  const sync = await import("./sync");
  sync.storeCloudToken("gdrive", {
    accessToken: "valid-access-token",
    expiresAt: Date.now() + 120_000,
  });
  await sync.startCloudSync("gdrive", "valid-access-token");
  const callback = subscribeMock.mock.calls[0]?.[0] as
    | ((state: DocState, event: { mutation?: WorkerRequest["type"] }) => void)
    | undefined;
  if (!callback) throw new Error("Cloud subscriber missing");
  return {
    sync,
    emit: (mutation: WorkerRequest["type"]) => callback(emptyState(), { mutation }),
  };
}

function queuedUploadCount(): number {
  return updateCloudProviderMock.mock.calls.filter(
    ([, update]) => (update as { statusMessage?: string }).statusMessage === "Upload queued.",
  ).length;
}

describe("P1-02 PWA Google Drive cloud loop damper", () => {
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
      updateCloudProviderMock,
      recordCloudProviderEventMock,
    ]) {
      mock.mockReset();
    }
    compareDocMock.mockResolvedValue("equal");
    getDocBinaryMock.mockResolvedValue(new Uint8Array([1]));
    getDocHeadsMock.mockResolvedValue(["h1"]);
    initDocMock.mockResolvedValue(emptyState());
    mergeDocMock.mockResolvedValue(undefined);
    subscribeMock.mockReturnValue(vi.fn());
    gdriveDownloadLatestMock.mockResolvedValue(new Uint8Array([9]));
    gdriveStartPollLoopMock.mockResolvedValue(undefined);
    dropboxStartLongpollLoopMock.mockResolvedValue(undefined);
    dropboxUploadSafeMock.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(async () => {
    const sync = await import("./sync");
    sync.stopCloudSync();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("does not turn a safe upload merge broadcast into another upload", async () => {
    vi.useFakeTimers();
    const { sync, emit } = await startSyncAndCaptureSubscriber();
    let emitUploadMerge = false;
    mergeDocMock.mockImplementation(async () => {
      if (emitUploadMerge) emit("MERGE_DOC");
    });
    gdriveDownloadLatestMock.mockResolvedValueOnce(null);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([1]),
      uploadedBytes: 1,
      remoteBytes: 1,
      mergedRemote: true,
    });

    emitUploadMerge = true;
    await sync.syncCloudProviderNow("gdrive");
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(1);
    expect(queuedUploadCount()).toBe(0);
    expect(addDebugEventMock).toHaveBeenCalledWith(
      "change",
      expect.stringContaining('"reason":"merge_heads_unchanged"'),
    );
  });

  it("uploads a genuine edit after the existing debounce", async () => {
    vi.useFakeTimers();
    let currentHead = "h1";
    getDocHeadsMock.mockImplementation(async () => [currentHead]);
    getDocBinaryMock.mockImplementation(
      async () => new Uint8Array([currentHead === "h1" ? 1 : 2]),
    );
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([1]),
      uploadedBytes: 1,
      remoteBytes: 0,
      mergedRemote: false,
    });
    const { sync, emit } = await startSyncAndCaptureSubscriber();
    gdriveDownloadLatestMock.mockResolvedValueOnce(null);
    await sync.syncCloudProviderNow("gdrive");
    updateCloudProviderMock.mockClear();

    currentHead = "h2";
    emit("ADD_PERSON");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(2);
    expect(gdriveUploadSafeMock.mock.calls[1][1]).toEqual(new Uint8Array([2]));
  });

  it("does not suppress an edit made while an upload is in flight", async () => {
    vi.useFakeTimers();
    let currentHead = "h-before-request";
    getDocHeadsMock.mockImplementation(async () => [currentHead]);
    getDocBinaryMock.mockImplementation(
      async () => new Uint8Array([currentHead === "h-before-request" ? 1 : 2]),
    );
    const firstUploadStarted = deferred<void>();
    const firstUploadResult = deferred<{
      fileId: string;
      uploadedBinary: Uint8Array;
      uploadedBytes: number;
      remoteBytes: number;
      mergedRemote: boolean;
    }>();
    gdriveUploadSafeMock
      .mockImplementationOnce(async () => {
        firstUploadStarted.resolve();
        return firstUploadResult.promise;
      })
      .mockResolvedValue({
        fileId: "file-2",
        uploadedBinary: new Uint8Array([2]),
        uploadedBytes: 1,
        remoteBytes: 0,
        mergedRemote: false,
      });
    const { sync, emit } = await startSyncAndCaptureSubscriber();
    gdriveDownloadLatestMock.mockResolvedValueOnce(null);

    const firstSync = sync.syncCloudProviderNow("gdrive");
    await firstUploadStarted.promise;
    currentHead = "h-during-request";
    emit("ADD_PERSON");
    firstUploadResult.resolve({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([1]),
      uploadedBytes: 1,
      remoteBytes: 0,
      mergedRemote: false,
    });
    await firstSync;

    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(1);
    expect(gdriveUploadSafeMock.mock.calls[0][1]).toEqual(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(2);
    expect(gdriveUploadSafeMock.mock.calls[1][1]).toEqual(new Uint8Array([2]));
  });

  it("records a document snapshot failure as an upload error", async () => {
    const { sync } = await startSyncAndCaptureSubscriber();
    gdriveDownloadLatestMock.mockResolvedValueOnce(null);
    getDocHeadsMock.mockRejectedValue(new Error("heads unavailable"));
    getDocBinaryMock.mockRejectedValue(new Error("snapshot read failed"));

    await expect(sync.syncCloudProviderNow("gdrive")).rejects.toThrow("snapshot read failed");

    expect(gdriveUploadSafeMock).not.toHaveBeenCalled();
    expect(updateCloudProviderMock).toHaveBeenCalledWith("gdrive", expect.objectContaining({
      status: "error",
      stage: "upload",
      error: "snapshot read failed",
      statusMessage: "Upload failed.",
    }));
    expect(addDebugEventMock).toHaveBeenCalledWith(
      "error",
      "[Cloud/gdrive] upload failed: snapshot read failed",
    );
  });
});

interface WorkerScopeHarness {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
}

async function waitForPost(
  posts: WorkerResponse[],
  predicate: (message: WorkerResponse) => boolean,
): Promise<WorkerResponse> {
  let match: WorkerResponse | undefined;
  await vi.waitFor(() => {
    match = posts.find(predicate);
    expect(match).toBeDefined();
  });
  return match!;
}

describe("PWA Automerge worker mutation origin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tags a MERGE_DOC state broadcast with its request origin", async () => {
    vi.resetModules();
    const base = createEmptyDoc();
    storageHarness.binary = A.save(base);
    const posts: WorkerResponse[] = [];
    const scope: WorkerScopeHarness = {
      onmessage: null,
      postMessage(message) {
        posts.push(message);
      },
    };
    vi.stubGlobal("self", scope);
    await import("./automerge.worker");
    if (!scope.onmessage) throw new Error("Worker message handler missing");

    scope.onmessage({ data: { reqId: 1, type: "INIT" } } as MessageEvent<WorkerRequest>);
    await waitForPost(posts, (message) => message.type === "ACK" && message.reqId === 1);
    const incoming = A.change(A.clone(base), "Remote edit", (draft: FreedDoc) => {
      draft.preferences.display.showEngagementCounts = true;
    });
    posts.length = 0;
    scope.onmessage({
      data: { reqId: 2, type: "MERGE_DOC", binary: A.save(incoming) },
    } as MessageEvent<WorkerRequest>);

    const stateUpdate = await waitForPost(
      posts,
      (message) => message.type === "STATE_UPDATE" && message.mutation === "MERGE_DOC",
    );
    expect(stateUpdate).toMatchObject({
      type: "STATE_UPDATE",
      mutation: "MERGE_DOC",
    });
  });
});
