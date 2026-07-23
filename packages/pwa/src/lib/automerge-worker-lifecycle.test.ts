import { createDefaultPreferences } from "@freed/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocState } from "./automerge-types";

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
  registerDocAccessors: vi.fn(),
  setDocSnapshot: vi.fn(),
}));

vi.mock("./automerge-worker-debug", () => ({
  persistWorkerDebugEvent: vi.fn(),
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
  onmessageerror: WorkerListener | null = null;
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
    this.onerror?.({ message, currentTarget: this });
  }

  emitMessageError(message: string): void {
    this.onmessageerror?.({ message, currentTarget: this });
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function makeState(): DocState {
  return {
    items: [],
    searchCorpusVersion: 1,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
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

function requestsOfType(
  worker: MockWorker,
  type: string,
): Array<{ reqId: number; type: string }> {
  return worker.messages.filter(
    (message): message is { reqId: number; type: string } =>
      typeof message === "object" &&
      message !== null &&
      "reqId" in message &&
      "type" in message &&
      (message as { type?: unknown }).type === type,
  );
}

async function waitForRequest(
  worker: MockWorker,
  type: string,
  index = 0,
): Promise<{ reqId: number; type: string }> {
  await vi.waitFor(() => {
    expect(requestsOfType(worker, type).length).toBeGreaterThan(index);
  });
  return requestsOfType(worker, type)[index];
}

async function completeInit(
  worker: MockWorker,
  initialization: Promise<DocState>,
  index = 0,
): Promise<DocState> {
  const request = await waitForRequest(worker, "INIT", index);
  const state = makeState();
  worker.emitMessage({ type: "STATE_UPDATE", state });
  worker.emitMessage({ reqId: request.reqId, type: "ACK" });
  await expect(initialization).resolves.toEqual(state);
  return state;
}

describe("PWA Automerge worker lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["error", "messageerror"] as const)(
    "retries INIT on a replacement generation after a worker %s",
    async (failureKind) => {
      const automerge = await import("./automerge");
      const firstWorker = MockWorker.instances[0];
      firstWorker.emitMessage({ type: "READY" });

      const initialization = automerge.initDoc();
      await waitForRequest(firstWorker, "INIT");
      if (failureKind === "error") {
        firstWorker.emitError("worker crashed during INIT");
      } else {
        firstWorker.emitMessageError("worker response could not be decoded");
      }

      await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(2));
      expect(firstWorker.terminated).toBe(true);
      expect(requestsOfType(firstWorker, "CLEAR_LOCAL")).toHaveLength(0);

      const replacementWorker = MockWorker.instances[1];
      replacementWorker.emitMessage({ type: "READY" });
      await completeInit(replacementWorker, initialization);
      expect(requestsOfType(replacementWorker, "CLEAR_LOCAL")).toHaveLength(0);
    },
  );

  it("preserves local data after a typed corrupt-document INIT error", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });

    const initialization = automerge.initDoc();
    const failedInit = await waitForRequest(worker, "INIT");
    worker.emitMessage({
      reqId: failedInit.reqId,
      type: "ACK",
      error: "stored document could not be loaded",
      errorCode: "CORRUPT_DOCUMENT",
    });

    await expect(initialization).rejects.toThrow("stored document could not be loaded");
    expect(MockWorker.instances).toHaveLength(1);
    expect(requestsOfType(worker, "CLEAR_LOCAL")).toHaveLength(0);
  });

  it("terminates a silent worker when factory-reset quiescence times out", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });

    const quiesce = automerge.quiescePwaAutomergeForFactoryReset();
    const rejected = expect(quiesce).rejects.toThrow(
      "Automerge worker did not quiesce within 10,000 milliseconds",
    );
    await waitForRequest(worker, "QUIESCE");
    await vi.advanceTimersByTimeAsync(10_000);

    await rejected;
    expect(worker.terminated).toBe(true);
  });

  it("preserves local data after a generic INIT acknowledgement error", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });

    const initialization = automerge.initDoc();
    const failedInit = await waitForRequest(worker, "INIT");
    worker.emitMessage({
      reqId: failedInit.reqId,
      type: "ACK",
      error: "IndexedDB save failed",
    });

    await expect(initialization).rejects.toThrow("IndexedDB save failed");
    expect(requestsOfType(worker, "CLEAR_LOCAL")).toHaveLength(0);
  });

  it("times out INIT, removes its listener, and retries without clearing local data", async () => {
    const automerge = await import("./automerge");
    const firstWorker = MockWorker.instances[0];
    firstWorker.emitMessage({ type: "READY" });

    const initialization = automerge.initDoc();
    await waitForRequest(firstWorker, "INIT");
    expect(firstWorker.listenerCount("message")).toBe(1);

    await vi.advanceTimersByTimeAsync(180_000);
    await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(2));
    expect(firstWorker.terminated).toBe(true);
    expect(firstWorker.listenerCount("message")).toBe(0);
    expect(requestsOfType(firstWorker, "CLEAR_LOCAL")).toHaveLength(0);

    const replacementWorker = MockWorker.instances[1];
    replacementWorker.emitMessage({ type: "READY" });
    await completeInit(replacementWorker, initialization);
    expect(replacementWorker.listenerCount("message")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      label: "mutation",
      requestType: "MARK_ALL_AS_READ",
      start: (automerge: typeof import("./automerge")) => automerge.docMarkAllAsRead(),
    },
    {
      label: "result",
      requestType: "GET_DOC_BINARY",
      start: (automerge: typeof import("./automerge")) => automerge.getDocBinary(),
    },
  ])("retires a silent generation after a $label request timeout and reinitializes before reuse", async ({
    requestType,
    start,
  }) => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });
    await completeInit(worker, automerge.initDoc());

    const pendingRequest = start(automerge);
    const rejected = expect(pendingRequest).rejects.toThrow(
      `Automerge worker request ${requestType} timed out after 180,000 milliseconds`,
    );
    await waitForRequest(worker, requestType);
    await vi.advanceTimersByTimeAsync(180_000);

    await rejected;
    expect(worker.terminated).toBe(true);

    const retry = automerge.docMarkAllAsRead();
    await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(2));
    const replacementWorker = MockWorker.instances[1];
    replacementWorker.emitMessage({ type: "READY" });
    const init = await waitForRequest(replacementWorker, "INIT");
    replacementWorker.emitMessage({ type: "STATE_UPDATE", state: makeState() });
    replacementWorker.emitMessage({ reqId: init.reqId, type: "ACK" });
    const mutation = await waitForRequest(replacementWorker, "MARK_ALL_AS_READ");
    replacementWorker.emitMessage({ reqId: mutation.reqId, type: "ACK" });
    await expect(retry).resolves.toBeUndefined();
  });

  it("rejects failed generation requests and initializes the replacement before reuse", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });
    await completeInit(worker, automerge.initDoc());

    const binaryRequest = automerge.getDocBinary();
    await waitForRequest(worker, "GET_DOC_BINARY");
    worker.emitError("worker crashed with a request pending");

    await expect(binaryRequest).rejects.toThrow("worker crashed with a request pending");
    expect(worker.terminated).toBe(true);
    expect(requestsOfType(worker, "CLEAR_LOCAL")).toHaveLength(0);

    const retry = automerge.docMarkAllAsRead();
    await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(2));
    const replacementWorker = MockWorker.instances[1];
    replacementWorker.emitMessage({ type: "READY" });
    const init = await waitForRequest(replacementWorker, "INIT");
    replacementWorker.emitMessage({ type: "STATE_UPDATE", state: makeState() });
    replacementWorker.emitMessage({ reqId: init.reqId, type: "ACK" });

    const mutation = await waitForRequest(replacementWorker, "MARK_ALL_AS_READ");
    replacementWorker.emitMessage({ reqId: mutation.reqId, type: "ACK" });
    await expect(retry).resolves.toBeUndefined();
    expect(requestsOfType(replacementWorker, "CLEAR_LOCAL")).toHaveLength(0);
  });

  it("rejects a worker response that arrives after the PWA generation changes", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });
    await completeInit(worker, automerge.initDoc());

    const mutation = automerge.docMarkAllAsRead();
    const request = await waitForRequest(worker, "MARK_ALL_AS_READ");
    localStorage.setItem("freed_pwa_installation_generation", "1");
    localStorage.setItem("freed_pwa_factory_reset_tombstone", JSON.stringify({
      version: 1,
      resetId: "reset-during-worker-request",
      generation: 1,
      startedAt: Date.now(),
    }));
    worker.emitMessage({ reqId: request.reqId, type: "ACK" });

    await expect(mutation).rejects.toThrow(
      "installation generation that has been reset",
    );
  });
});
