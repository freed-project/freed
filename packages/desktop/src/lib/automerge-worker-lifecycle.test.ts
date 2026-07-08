import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

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
  recordWorkerInit: vi.fn(),
}));

type WorkerListener = (event: { data?: unknown; message?: string; currentTarget?: MockWorker }) => void;

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
    author: { id: "example.com", handle: "example.com", displayName: "example.com" },
    content: {
      text: "https://example.com/startup-worker",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url: "https://example.com/startup-worker" },
    },
    userState: { hidden: false, saved: true, savedAt: 1, archived: false },
    topics: [],
  };
}

describe("automerge worker lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    MockWorker.instances = [];
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
});
