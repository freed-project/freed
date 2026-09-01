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
    this.posted.push(value);
  }

  terminate(): void {}

  respond(value: unknown): void {
    this.listeners.get("message")?.({ data: value } as MessageEvent<unknown>);
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
    vi.unstubAllGlobals();
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
