import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocState } from "./automerge-types";

const recordWorkerInitMock = vi.hoisted(() => vi.fn());

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
  recordRuntimeHealthEvent: vi.fn(),
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

    firstWorker.emitMessage({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        "[automerge-worker] released idle document after request queue drained",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(firstWorker.terminated).toBe(true);

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

    await vi.advanceTimersByTimeAsync(1_000);
    expect(worker.terminated).toBe(false);

    worker.emitMessage({ reqId: request.reqId, type: "ACK" });
    await mutation;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(worker.terminated).toBe(true);
  });

  it.todo(
    "coalesces concurrent requests that wake the same idle worker generation",
  );
});
