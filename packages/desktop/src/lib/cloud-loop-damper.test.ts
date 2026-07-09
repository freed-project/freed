/**
 * P1-01: break the desktop cloud upload loop (stability findings F01/F06).
 *
 * The verified defect: after every safe upload the caller merges the uploaded
 * binary back; MERGE_DOC emits a STATE_UPDATE; the cloud subscriber scheduled
 * an upload on EVERY state event, so upload→merge→state-update→upload ran
 * forever on idle machines. The damper (a) stops MERGE_DOC/REPLACE_DOC events
 * from scheduling unless the doc heads moved past the last successful upload,
 * and (b) re-checks heads when a debounced subscriber upload fires. Manual
 * "Sync now" and authoritative replaces are exempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocChangeEvent, DocState } from "./automerge-types";

const invokeMock = vi.fn();
const gdriveDownloadLatestMock = vi.fn();
const gdriveStartPollLoopMock = vi.fn();
const subscribeMock = vi.fn((_callback: (state: DocState, event: DocChangeEvent) => void) => vi.fn());
const recordProviderHealthEventMock = vi.fn();
const updateCloudProviderMock = vi.fn();
const recordCloudProviderEventMock = vi.fn();
const gdriveUploadSafeMock = vi.fn();
const gdriveUploadReplaceMock = vi.fn();
const gdriveDeleteFileMock = vi.fn();
const getDocBinaryMock = vi.fn(async () => new Uint8Array([1, 2, 3]));
const getDocHeadsMock = vi.fn(async (): Promise<string[] | null> => ["h1"]);
const mergeDocMock = vi.fn(async () => {});
const recordCloudUploadAttemptMock = vi.fn();
const recordCloudUploadSkippedMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

vi.mock("@freed/sync/cloud", () => ({
  gdriveDownloadLatest: gdriveDownloadLatestMock,
  gdriveStartPollLoop: gdriveStartPollLoopMock,
  gdriveUploadSafe: gdriveUploadSafeMock,
  gdriveUploadReplace: gdriveUploadReplaceMock,
  gdriveDeleteFile: gdriveDeleteFileMock,
  dropboxDownloadLatest: vi.fn(),
  dropboxStartLongpollLoop: vi.fn(),
  dropboxUploadSafe: vi.fn(),
  dropboxUploadReplace: vi.fn(),
  dropboxDeleteFile: vi.fn(),
}));

vi.mock("./automerge", () => ({
  getDocBinary: getDocBinaryMock,
  getDocHeads: getDocHeadsMock,
  mergeDoc: mergeDocMock,
  replaceLocalDoc: vi.fn(),
  setRelayClientCount: vi.fn(),
  subscribe: subscribeMock,
}));

vi.mock("./runtime-health-events", () => ({
  recordCloudUploadAttempt: recordCloudUploadAttemptMock,
  recordCloudUploadSkipped: recordCloudUploadSkippedMock,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
  recordCloudProviderEvent: recordCloudProviderEventMock,
  updateCloudProvider: updateCloudProviderMock,
}));

vi.mock("./logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./provider-health", () => ({
  recordProviderHealthEvent: recordProviderHealthEventMock,
}));

function docState(): DocState {
  return {} as DocState;
}

function changeEvent(mutation: DocChangeEvent["mutation"]): DocChangeEvent {
  return { source: "state_update", mutation, changedItemIds: null, requiresFullScan: true };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function startSyncAndCaptureSubscriber(): Promise<(event: DocChangeEvent) => void> {
  const { startCloudSync, storeCloudToken } = await import("./sync");
  storeCloudToken("gdrive", {
    accessToken: "valid-access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 3_600_000,
  });
  gdriveDownloadLatestMock.mockResolvedValue(null);
  gdriveStartPollLoopMock.mockResolvedValue(undefined);
  await startCloudSync("gdrive", "valid-access-token");
  expect(subscribeMock).toHaveBeenCalledTimes(1);
  const callback = subscribeMock.mock.calls[0][0];
  return (event) => callback(docState(), event);
}

function expectUploadQueued(times: number): void {
  const queued = updateCloudProviderMock.mock.calls.filter(
    ([, update]) => (update as { statusMessage?: string }).statusMessage === "Upload queued.",
  );
  expect(queued).toHaveLength(times);
}

describe("P1-01 desktop cloud upload loop damper", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();
    vi.stubEnv("VITE_GDRIVE_TOKEN_PROXY_URL", "https://app.freed.wtf/api/oauth/google");
    vi.stubEnv(
      "VITE_GDRIVE_DESKTOP_CLIENT_ID",
      "304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1.apps.googleusercontent.com",
    );
    for (const mock of [
      invokeMock,
      gdriveDownloadLatestMock,
      gdriveStartPollLoopMock,
      recordProviderHealthEventMock,
      updateCloudProviderMock,
      recordCloudProviderEventMock,
      gdriveUploadSafeMock,
      gdriveUploadReplaceMock,
      gdriveDeleteFileMock,
      recordCloudUploadAttemptMock,
      recordCloudUploadSkippedMock,
      mergeDocMock,
    ]) {
      mock.mockReset();
    }
    subscribeMock.mockClear();
    getDocHeadsMock.mockReset();
    getDocHeadsMock.mockResolvedValue(["h1"]);
    getDocBinaryMock.mockClear();
    localStorage.clear();
    const coordinator = await import("./background-runtime-coordinator");
    coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: false });
  });

  afterEach(async () => {
    const sync = await import("./sync");
    sync.stopAllCloudSyncs();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("local mutations still schedule an upload", async () => {
    const emit = await startSyncAndCaptureSubscriber();
    updateCloudProviderMock.mockClear();

    emit(changeEvent("ADD_PERSON"));
    await flush();

    expectUploadQueued(1);
    expect(recordCloudUploadSkippedMock).not.toHaveBeenCalled();
  });

  it("MERGE_DOC with unchanged heads after a successful upload does not schedule (the loop edge)", async () => {
    const emit = await startSyncAndCaptureSubscriber();

    // A successful upload whose merge-back settles at heads h-uploaded.
    getDocHeadsMock.mockResolvedValue(["h-uploaded"]);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([9]),
      uploadedBytes: 1,
      remoteBytes: 1,
      mergedRemote: true,
    });
    const { syncCloudProviderNow } = await import("./sync");
    await syncCloudProviderNow("gdrive");
    expect(mergeDocMock).toHaveBeenCalledTimes(1);
    updateCloudProviderMock.mockClear();

    // The merge-back's own MERGE_DOC event arrives with identical heads.
    emit(changeEvent("MERGE_DOC"));
    await flush();

    expectUploadQueued(0);
    expect(recordCloudUploadSkippedMock).toHaveBeenCalledWith({
      provider: "gdrive",
      cause: "subscriber",
      reason: "merge_heads_unchanged",
    });
  });

  it("a genuine merge that moves the heads still schedules an upload", async () => {
    const emit = await startSyncAndCaptureSubscriber();

    getDocHeadsMock.mockResolvedValue(["h-uploaded"]);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([9]),
      uploadedBytes: 1,
      remoteBytes: 1,
      mergedRemote: false,
    });
    const { syncCloudProviderNow } = await import("./sync");
    await syncCloudProviderNow("gdrive");
    updateCloudProviderMock.mockClear();

    // Remote data merged later moves the heads past the recorded upload.
    getDocHeadsMock.mockResolvedValue(["h-uploaded", "h-remote"]);
    emit(changeEvent("MERGE_DOC"));
    await flush();

    expectUploadQueued(1);
    expect(recordCloudUploadSkippedMock).not.toHaveBeenCalled();
  });

  it("REPLACE_DOC follows the same heads guard as MERGE_DOC", async () => {
    const emit = await startSyncAndCaptureSubscriber();

    getDocHeadsMock.mockResolvedValue(["h-uploaded"]);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([9]),
      uploadedBytes: 1,
      remoteBytes: 1,
      mergedRemote: false,
    });
    const { syncCloudProviderNow } = await import("./sync");
    await syncCloudProviderNow("gdrive");
    updateCloudProviderMock.mockClear();

    emit(changeEvent("REPLACE_DOC"));
    await flush();

    expectUploadQueued(0);
    expect(recordCloudUploadSkippedMock).toHaveBeenCalledTimes(1);
  });

  it("MERGE_DOC before any successful upload schedules (no recorded heads yet)", async () => {
    const emit = await startSyncAndCaptureSubscriber();
    updateCloudProviderMock.mockClear();

    emit(changeEvent("MERGE_DOC"));
    await flush();

    expectUploadQueued(1);
    expect(recordCloudUploadSkippedMock).not.toHaveBeenCalled();
  });

  it("heads lookup failure fails open: the upload is scheduled", async () => {
    const emit = await startSyncAndCaptureSubscriber();
    getDocHeadsMock.mockRejectedValue(new Error("worker unavailable"));
    updateCloudProviderMock.mockClear();

    emit(changeEvent("MERGE_DOC"));
    await flush();

    expectUploadQueued(1);
    expect(recordCloudUploadSkippedMock).not.toHaveBeenCalled();
  });

  it("manual Sync now always uploads even with unchanged heads", async () => {
    await startSyncAndCaptureSubscriber();
    getDocHeadsMock.mockResolvedValue(["h-uploaded"]);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([9]),
      uploadedBytes: 1,
      remoteBytes: 1,
      mergedRemote: false,
    });
    const { syncCloudProviderNow } = await import("./sync");

    await syncCloudProviderNow("gdrive");
    await syncCloudProviderNow("gdrive");

    expect(gdriveUploadSafeMock).toHaveBeenCalledTimes(2);
    expect(recordCloudUploadSkippedMock).not.toHaveBeenCalled();
  });

  it("deleteCloudFile clears the recorded heads so the next merge event uploads again", async () => {
    const emit = await startSyncAndCaptureSubscriber();

    getDocHeadsMock.mockResolvedValue(["h-uploaded"]);
    gdriveUploadSafeMock.mockResolvedValue({
      fileId: "file-1",
      uploadedBinary: new Uint8Array([9]),
      uploadedBytes: 1,
      remoteBytes: 1,
      mergedRemote: false,
    });
    const sync = await import("./sync");
    await sync.syncCloudProviderNow("gdrive");

    await sync.deleteCloudFile("gdrive", "valid-access-token");
    updateCloudProviderMock.mockClear();

    // Same heads as the recorded upload, but the cloud file is gone — the
    // guard must not suppress re-seeding the cloud.
    emit(changeEvent("MERGE_DOC"));
    await flush();

    expectUploadQueued(1);
    expect(recordCloudUploadSkippedMock).not.toHaveBeenCalled();
  });
});
