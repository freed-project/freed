import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocState } from "./automerge-types";

const recordWorkerInitMock = vi.hoisted(() => vi.fn());
const recordRuntimeHealthEventMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
  registerDocAccessors: vi.fn(),
  setDocSnapshot: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("./runtime-health-events", () => ({
  recordRuntimeHealthEvent: recordRuntimeHealthEventMock,
  recordWorkerInit: recordWorkerInitMock,
}));

type WorkerListener = (event: {
  data?: unknown;
  message?: string;
  currentTarget?: MockWorker;
}) => void;

class MockWorker {
  static instances: MockWorker[] = [];

  messages: unknown[] = [];
  terminated = false;
  onmessage: WorkerListener | null = null;
  onerror: WorkerListener | null = null;
  private listeners = new Map<string, Set<WorkerListener>>();

  constructor() {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    const event = { data, currentTarget: this };
    for (const listener of this.listeners.get("message") ?? []) listener(event);
    this.onmessage?.(event);
  }

  emitError(message: string): void {
    const event = { message, currentTarget: this };
    for (const listener of this.listeners.get("error") ?? []) listener(event);
    this.onerror?.(event);
  }
}

function makeItem(): FeedItem {
  return {
    globalId: "saved:test",
    platform: "saved",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "example.com",
      handle: "example.com",
      displayName: "example.com",
    },
    content: {
      text: "https://example.com/startup-worker",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url: "https://example.com/startup-worker" },
    },
    userState: {
      hidden: false,
      saved: true,
      savedAt: 1,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

function makeState(items: FeedItem[] = []): DocState {
  return {
    items,
    searchCorpusVersion: 1,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: items.length,
    unreadCountByPlatform: items.length > 0 ? { saved: items.length } : {},
    totalItemCount: items.length,
    itemCountByPlatform: items.length > 0 ? { saved: items.length } : {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
    docItemCount: items.length,
  };
}

async function waitForWorkerRequest(
  worker: MockWorker,
  type: string,
): Promise<{ reqId: number; type: string }> {
  let request: { reqId: number; type: string } | undefined;
  await vi.waitFor(() => {
    request = worker.messages.find(
      (message): message is { reqId: number; type: string } =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        (message as { type?: unknown }).type === type &&
        "reqId" in message,
    );
    expect(request).toBeDefined();
  });
  return request!;
}

async function completeWorkerInit(
  worker: MockWorker,
  initPromise: Promise<DocState>,
  state = makeState(),
  docBytes = 1_024,
): Promise<void> {
  const request = await waitForWorkerRequest(worker, "INIT");
  worker.emitMessage({ type: "STATE_UPDATE", state });
  worker.emitMessage({ type: "INIT_STATS", durationMs: 12, docBytes });
  worker.emitMessage({ reqId: request.reqId, type: "ACK" });
  await initPromise;
}

describe("automerge worker lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    MockWorker.instances = [];
    recordWorkerInitMock.mockReset();
    recordRuntimeHealthEventMock.mockReset();
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a document request after worker startup times out", async () => {
    const automerge = await import("./automerge");
    const firstWorker = MockWorker.instances[0];

    const savePromise = automerge.docAddFeedItem(makeItem());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(firstWorker.terminated).toBe(true);
    expect(MockWorker.instances).toHaveLength(2);

    const retryWorker = MockWorker.instances[1];
    retryWorker.emitMessage({ type: "READY" });
    await vi.waitFor(() => {
      expect(retryWorker.messages).toHaveLength(1);
    });

    const request = retryWorker.messages[0] as { reqId: number; type: string };
    expect(request.type).toBe("ADD_FEED_ITEM");

    retryWorker.emitMessage({ reqId: request.reqId, type: "ACK" });
    await expect(savePromise).resolves.toBeUndefined();
  });

  it("records INIT cost and reinitializes once after serialized idle termination", async () => {
    const automerge = await import("./automerge");
    const firstWorker = MockWorker.instances[0];
    firstWorker.emitMessage({ type: "READY" });

    const firstInit = automerge.initDoc();
    await completeWorkerInit(firstWorker, firstInit, makeState(), 6_291_456);
    expect(recordWorkerInitMock).toHaveBeenCalledTimes(1);
    expect(recordWorkerInitMock).toHaveBeenLastCalledWith({
      durationMs: 12,
      docBytes: 6_291_456,
    });

    const scheduledAtMs = Date.now();
    firstWorker.emitMessage({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        "[automerge-worker] released idle document after request queue drained",
    });
    vi.setSystemTime(scheduledAtMs + 15_000);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(firstWorker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(firstWorker.terminated).toBe(true);
    expect(recordRuntimeHealthEventMock).toHaveBeenCalledWith({
      event: "worker_idle_terminated",
      reason: "quiet_window",
      quietWindowTargetMs: 30_000,
      scheduledDelayMs: 30_000,
      timerElapsedMs: 45_000,
      timerOverrunMs: 15_000,
    });

    const mutation = automerge.docAddFeedItem(makeItem());
    expect(MockWorker.instances).toHaveLength(2);
    const secondWorker = MockWorker.instances[1];
    secondWorker.emitMessage({ type: "READY" });

    const reinitRequest = await waitForWorkerRequest(secondWorker, "INIT");
    secondWorker.emitMessage({ type: "STATE_UPDATE", state: makeState() });
    secondWorker.emitMessage({
      type: "INIT_STATS",
      durationMs: 9,
      docBytes: 6_291_456,
    });
    secondWorker.emitMessage({ reqId: reinitRequest.reqId, type: "ACK" });

    const addRequest = await waitForWorkerRequest(
      secondWorker,
      "ADD_FEED_ITEM",
    );
    secondWorker.emitMessage({ reqId: addRequest.reqId, type: "ACK" });
    await expect(mutation).resolves.toBeUndefined();

    expect(recordWorkerInitMock).toHaveBeenCalledTimes(2);
    expect(
      secondWorker.messages.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          (message as { type?: unknown }).type === "INIT",
      ),
    ).toHaveLength(1);
  });

  it("keeps the worker alive until a pending request settles", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });
    await completeWorkerInit(worker, automerge.initDoc());

    const mutation = automerge.docAddFeedItem(makeItem());
    const request = await waitForWorkerRequest(worker, "ADD_FEED_ITEM");
    worker.emitMessage({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        "[automerge-worker] released idle document after request queue drained",
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(worker.terminated).toBe(false);

    worker.emitMessage({ reqId: request.reqId, type: "ACK" });
    await mutation;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(worker.terminated).toBe(true);
  });

  it("restarts the quiet window after an unloaded binary read", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });
    await completeWorkerInit(worker, automerge.initDoc());

    worker.emitMessage({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        "[automerge-worker] released idle document after request queue drained",
    });
    await vi.advanceTimersByTimeAsync(20_000);

    const binaryPromise = automerge.getDocBinary();
    const request = await waitForWorkerRequest(worker, "GET_DOC_BINARY");
    expect(MockWorker.instances).toHaveLength(1);
    expect(
      worker.messages.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          (message as { type?: unknown }).type === "INIT",
      ),
    ).toHaveLength(1);

    worker.emitMessage({
      reqId: request.reqId,
      type: "DOC_BINARY",
      binary: new Uint8Array([1, 2, 3]),
    });
    await expect(binaryPromise).resolves.toEqual(new Uint8Array([1, 2, 3]));

    await vi.advanceTimersByTimeAsync(20_000);
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(worker.terminated).toBe(true);
  });

  it("stops the worker after an unanswered request times out", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });
    await completeWorkerInit(worker, automerge.initDoc());

    worker.emitMessage({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        "[automerge-worker] released idle document after request queue drained",
    });

    const binaryPromise = automerge.getDocBinary();
    const binaryResult = binaryPromise.then(
      () => null,
      (error: unknown) => error,
    );
    await waitForWorkerRequest(worker, "GET_DOC_BINARY");
    await vi.advanceTimersByTimeAsync(180_000);
    await expect(binaryResult).resolves.toMatchObject({
      message: expect.stringContaining("request TIMEOUT op=GET_DOC_BINARY"),
    });

    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(worker.terminated).toBe(true);
    expect(recordRuntimeHealthEventMock).toHaveBeenCalledWith({
      event: "worker_idle_terminated",
      reason: "request_timeout_cleanup",
      quietWindowTargetMs: 30_000,
      scheduledDelayMs: 1_000,
      timerElapsedMs: 1_000,
      timerOverrunMs: 0,
    });
  });

  it("restarts the quiet window after a relay client-count update", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });
    await completeWorkerInit(worker, automerge.initDoc());

    worker.emitMessage({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        "[automerge-worker] released idle document after request queue drained",
    });
    await vi.advanceTimersByTimeAsync(20_000);

    automerge.setRelayClientCount(1);
    const relayRequest = await waitForWorkerRequest(
      worker,
      "UPDATE_RELAY_CLIENT_COUNT",
    );
    expect(MockWorker.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(worker.terminated).toBe(false);
    worker.emitMessage({ reqId: relayRequest.reqId, type: "ACK" });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminated).toBe(true);
  });

  it("does not terminate while a large document reinitialization is pending", async () => {
    const automerge = await import("./automerge");
    const firstWorker = MockWorker.instances[0];
    firstWorker.emitMessage({ type: "READY" });
    await completeWorkerInit(firstWorker, automerge.initDoc(), makeState(), 6_291_456);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(firstWorker.terminated).toBe(true);

    const mutation = automerge.docAddFeedItem(makeItem());
    const secondWorker = MockWorker.instances[1];
    secondWorker.emitMessage({ type: "READY" });
    const reinitRequest = await waitForWorkerRequest(secondWorker, "INIT");

    automerge.setRelayClientCount(1);
    const relayRequest = await waitForWorkerRequest(
      secondWorker,
      "UPDATE_RELAY_CLIENT_COUNT",
    );
    secondWorker.emitMessage({ reqId: relayRequest.reqId, type: "ACK" });

    await vi.advanceTimersByTimeAsync(31_000);
    expect(secondWorker.terminated).toBe(false);

    secondWorker.emitMessage({ type: "STATE_UPDATE", state: makeState() });
    secondWorker.emitMessage({
      type: "INIT_STATS",
      durationMs: 31_000,
      docBytes: 6_291_456,
    });
    secondWorker.emitMessage({ reqId: reinitRequest.reqId, type: "ACK" });

    const addRequest = await waitForWorkerRequest(
      secondWorker,
      "ADD_FEED_ITEM",
    );
    secondWorker.emitMessage({ reqId: addRequest.reqId, type: "ACK" });
    await expect(mutation).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(secondWorker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(secondWorker.terminated).toBe(true);
  });

  it("resets a worker whose document reinitialization times out", async () => {
    const automerge = await import("./automerge");
    const firstWorker = MockWorker.instances[0];
    firstWorker.emitMessage({ type: "READY" });
    await completeWorkerInit(firstWorker, automerge.initDoc());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(firstWorker.terminated).toBe(true);

    const mutation = automerge.docAddFeedItem(makeItem());
    const mutationResult = mutation.then(
      () => null,
      (error: unknown) => error,
    );
    const secondWorker = MockWorker.instances[1];
    secondWorker.emitMessage({ type: "READY" });
    await waitForWorkerRequest(secondWorker, "INIT");

    await vi.advanceTimersByTimeAsync(180_000);
    expect(secondWorker.terminated).toBe(true);
    await expect(mutationResult).resolves.toMatchObject({
      message: expect.stringContaining("request TIMEOUT op=INIT"),
    });
    expect(recordRuntimeHealthEventMock).toHaveBeenCalledWith({
      event: "worker_runtime_failed",
      phase: "runtime_init_timeout",
      message: expect.stringContaining("request TIMEOUT op=INIT"),
    });
  });

  it("does not clear local data when the initial document load times out", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });

    const initResult = automerge.initDoc().then(
      () => null,
      (error: unknown) => error,
    );
    await waitForWorkerRequest(worker, "INIT");
    await vi.advanceTimersByTimeAsync(180_000);

    expect(worker.terminated).toBe(true);
    await expect(initResult).resolves.toMatchObject({
      message: expect.stringContaining("request TIMEOUT op=INIT"),
    });
    expect(MockWorker.instances).toHaveLength(1);
    expect(
      worker.messages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          (message as { type?: unknown }).type === "CLEAR_LOCAL",
      ),
    ).toBe(false);
  });

  it("does not clear local data when the initial worker generation crashes", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });

    const initResult = automerge.initDoc().then(
      () => null,
      (error: unknown) => error,
    );
    await waitForWorkerRequest(worker, "INIT");
    worker.emitError("worker crashed during INIT");

    expect(worker.terminated).toBe(true);
    await expect(initResult).resolves.toMatchObject({
      message: "worker crashed during INIT",
    });
    expect(MockWorker.instances).toHaveLength(1);
    expect(
      worker.messages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          (message as { type?: unknown }).type === "CLEAR_LOCAL",
      ),
    ).toBe(false);
  });

  it("ignores lifecycle messages from a terminated worker generation", async () => {
    const automerge = await import("./automerge");
    const firstWorker = MockWorker.instances[0];
    firstWorker.emitMessage({ type: "READY" });
    await completeWorkerInit(firstWorker, automerge.initDoc());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(firstWorker.terminated).toBe(true);

    const mutation = automerge.docAddFeedItem(makeItem());
    const secondWorker = MockWorker.instances[1];
    secondWorker.emitMessage({ type: "READY" });
    await completeWorkerInit(secondWorker, Promise.resolve(makeState()));
    const addRequest = await waitForWorkerRequest(
      secondWorker,
      "ADD_FEED_ITEM",
    );
    secondWorker.emitMessage({ reqId: addRequest.reqId, type: "ACK" });
    await mutation;

    await vi.advanceTimersByTimeAsync(20_000);
    firstWorker.emitMessage({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        "[automerge-worker] released idle document after request queue drained",
    });
    firstWorker.emitMessage({
      type: "STATE_UPDATE",
      state: makeState([makeItem()]),
    });

    expect(automerge.getDocState()?.items).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(secondWorker.terminated).toBe(true);
  });

  it.todo(
    "coalesces concurrent requests that wake the same idle worker generation",
  );
});
