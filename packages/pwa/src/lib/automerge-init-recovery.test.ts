import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addDebugEventMock = vi.hoisted(() => vi.fn());
const persistWorkerDebugEventMock = vi.hoisted(() => vi.fn());

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: addDebugEventMock,
  registerDocAccessors: vi.fn(),
  setDocSnapshot: vi.fn(),
}));

vi.mock("./automerge-worker-debug", () => ({
  persistWorkerDebugEvent: persistWorkerDebugEventMock,
}));

type WorkerListener = (event: {
  data: unknown;
  currentTarget: MockWorker;
}) => void;

class MockWorker {
  static instances: MockWorker[] = [];

  messages: unknown[] = [];
  onmessage: WorkerListener | null = null;
  onerror: ((error: unknown) => void) | null = null;
  private readonly listeners = new Set<WorkerListener>();

  constructor() {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener): void {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: WorkerListener): void {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emitMessage(data: unknown): void {
    const event = { data, currentTarget: this };
    for (const listener of this.listeners) listener(event);
    this.onmessage?.(event);
  }
}

describe("PWA Automerge INIT recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    MockWorker.instances = [];
    addDebugEventMock.mockReset();
    persistWorkerDebugEventMock.mockReset();
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not clear local data after an INIT response error", async () => {
    const automerge = await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: "READY" });

    const initResult = automerge.initDoc();
    await vi.waitFor(() => {
      expect(worker.messages).toHaveLength(1);
    });
    const initRequest = worker.messages[0] as {
      reqId: number;
      type: string;
    };
    expect(initRequest.type).toBe("INIT");

    worker.emitMessage({
      reqId: initRequest.reqId,
      type: "ACK",
      error: "initialization failed after load",
    });

    await expect(initResult).rejects.toThrow("initialization failed after load");
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

  it("records preserved corrupt-document recovery evidence", async () => {
    await import("./automerge");
    const worker = MockWorker.instances[0];
    worker.emitMessage({
      type: "INIT_RECOVERY",
      reason: "confirmed_corrupt_document",
      action: "preserved_recovery_copy_then_cleared_local",
      recoveryBytes: 8_192,
    });

    expect(addDebugEventMock).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("worker_init_recovery"),
      8_192,
    );
    expect(persistWorkerDebugEventMock).toHaveBeenCalledWith({
      kind: "worker_init_recovery",
      detail: expect.stringContaining("confirmed_corrupt_document"),
      bytes: 8_192,
    });
  });
});
