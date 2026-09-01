import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteClient } from "./library-core-sqlite-client";

class FakeWorker {
  static latest: FakeWorker | null = null;

  readonly posted: unknown[] = [];
  readonly listeners = new Map<
    string,
    (event: MessageEvent<unknown>) => void
  >();
  postError: Error | null = null;
  terminateCount = 0;

  constructor() {
    FakeWorker.latest = this;
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.set(type, listener);
  }

  postMessage(value: unknown): void {
    if (this.postError) throw this.postError;
    this.posted.push(value);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  respond(value: unknown): void {
    this.listeners.get("message")?.({ data: value } as MessageEvent<unknown>);
  }

  emit(type: "error" | "messageerror"): void {
    this.listeners.get(type)?.({} as MessageEvent<unknown>);
  }
}

function activeWorker(): FakeWorker {
  const worker = FakeWorker.latest;
  if (!worker) throw new Error("fake SQLite worker is unavailable");
  return worker;
}

function requestId(worker: FakeWorker): string {
  const request = worker.posted.at(-1) as { requestId?: unknown } | undefined;
  if (typeof request?.requestId !== "string") {
    throw new Error("SQLite worker request identity is unavailable");
  }
  return request.requestId;
}

function validStatus() {
  return {
    connectionGeneration: 1,
    contractVersion: LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
    engine: "sqlite-wasm-opfs-sahpool" as const,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    schemaSha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
    schemaVersion: LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
    sqliteVersion: "3.50.4",
    storage: "opfs" as const,
  };
}

describe("PWA SQLite worker response boundary", () => {
  beforeEach(() => {
    FakeWorker.latest = null;
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("terminally retires the client when its worker errors", async () => {
    const onUnavailable = vi.fn();
    const client = new PwaLibraryCoreSqliteClient(onUnavailable);
    const firstPending = client.status();
    const secondPending = client.status();
    const worker = activeWorker();

    worker.emit("error");

    await expect(firstPending).rejects.toMatchObject({
      code: "pwa_sqlite_worker_unavailable",
      message: "PWA Library SQLite worker stopped unexpectedly",
    });
    await expect(secondPending).rejects.toMatchObject({
      code: "pwa_sqlite_worker_unavailable",
      message: "PWA Library SQLite worker stopped unexpectedly",
    });
    expect(worker.terminateCount).toBe(1);
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledWith(client);

    const postedBeforeClosedRequest = worker.posted.length;
    await expect(client.status()).rejects.toThrow(
      "PWA Library SQLite client is closed",
    );
    expect(worker.posted).toHaveLength(postedBeforeClosedRequest);
  });

  it("terminally retires the client when a worker response cannot be received", async () => {
    const onUnavailable = vi.fn();
    const client = new PwaLibraryCoreSqliteClient(onUnavailable);
    const pending = client.status();
    const worker = activeWorker();

    worker.emit("messageerror");

    await expect(pending).rejects.toMatchObject({
      code: "pwa_sqlite_worker_unavailable",
      message: "PWA Library SQLite worker response could not be received",
    });
    expect(worker.terminateCount).toBe(1);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("retires the client when posting to its worker throws", async () => {
    const onUnavailable = vi.fn();
    const client = new PwaLibraryCoreSqliteClient(onUnavailable);
    const worker = activeWorker();
    worker.postError = new Error("worker port is gone");

    await expect(client.status()).rejects.toMatchObject({
      code: "pwa_sqlite_worker_unavailable",
      message: "PWA Library SQLite worker is unavailable",
    });
    expect(worker.terminateCount).toBe(1);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("retires the complete client generation when a request times out", async () => {
    vi.useFakeTimers();
    const onUnavailable = vi.fn();
    const client = new PwaLibraryCoreSqliteClient(onUnavailable);
    const pending = client.status();
    const rejection = expect(pending).rejects.toMatchObject({
      code: "pwa_sqlite_worker_unavailable",
      message: "PWA Library SQLite request timed out",
    });
    const worker = activeWorker();

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(worker.terminateCount).toBe(1);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("accepts only the exact typed status for a status request", async () => {
    const client = new PwaLibraryCoreSqliteClient();
    const pending = client.status();
    const worker = activeWorker();
    worker.respond({
      ok: true,
      requestId: requestId(worker),
      status: validStatus(),
    });

    await expect(pending).resolves.toEqual(validStatus());
    client.dispose();
  });

  it("rejects an extra field in an otherwise valid worker response", async () => {
    const client = new PwaLibraryCoreSqliteClient();
    const pending = client.status();
    const worker = activeWorker();
    worker.respond({
      extra: true,
      ok: true,
      requestId: requestId(worker),
      status: validStatus(),
    });

    await expect(pending).rejects.toThrow(
      "worker success response is not closed",
    );
    client.dispose();
  });

  it("rejects a malformed typed result before application code sees it", async () => {
    const client = new PwaLibraryCoreSqliteClient();
    const pending = client.readContentState({
      contentDigest: "11".repeat(32),
      schemaVersion: 1,
    });
    const worker = activeWorker();
    worker.respond({
      ok: true,
      requestId: requestId(worker),
      result: { contentDigest: "11".repeat(32), schemaVersion: 1 },
    });

    await expect(pending).rejects.toThrow("selective content state is invalid");
    client.dispose();
  });
});
