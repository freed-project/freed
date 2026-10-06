import catchupVector from "../../../shared/src/library-core/native-handoff-catchup-vector-v1.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseLibraryCoreReapplyConsumerIntentV1,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "@freed/shared/library-core";
import {
  PwaLibraryCoreSqliteClient,
  isPwaLibraryCoreSqliteBusyError,
} from "./library-core-sqlite-client";

class FakeWorker {
  static latest: FakeWorker | null = null;

  readonly posted: unknown[] = [];
  readonly listeners = new Map<
    string,
    (event: MessageEvent<unknown>) => void
  >();
  postError: Error | null = null;
  terminateCount = 0;

  readonly options?: WorkerOptions;

  constructor(_url: URL, options?: WorkerOptions) {
    this.options = options;
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
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts only closed local maintenance hints and ignores the disposed worker", () => {
    const changed=vi.fn();
    const client=new PwaLibraryCoreSqliteClient(undefined,changed);
    const worker=activeWorker();
    worker.respond({kind:"local_changes_available",extra:true});
    expect(changed).not.toHaveBeenCalled();
    worker.respond({kind:"local_changes_available"});
    expect(changed).toHaveBeenCalledOnce();
    client.dispose();
    worker.respond({kind:"local_changes_available"});
    expect(changed).toHaveBeenCalledOnce();
  });

  it("isolates demo workers without opting ordinary app tabs into disposable storage", () => {
    vi.stubEnv("VITE_FREED_DEMO", "0");
    for (const [hostname, search, expected] of [
      ["demo.freed.wtf", "", "freed-library-core-sqlite-demo"],
      ["preview.vercel.app", "?freed-demo=1", "freed-library-core-sqlite-demo"],
      ["app.freed.wtf", "?freed-demo=1", "freed-library-core-sqlite"],
      ["localhost", "", "freed-library-core-sqlite"],
    ]) {
      vi.stubGlobal("location", new URL(`https://${hostname}/${search}`));
      new PwaLibraryCoreSqliteClient();
      expect(activeWorker().options?.name).toBe(expected);
    }
    vi.stubEnv("VITE_FREED_DEMO", "1");
    new PwaLibraryCoreSqliteClient();
    expect(activeWorker().options?.name).toBe("freed-library-core-sqlite-demo");
  });

  it("validates replacement receipts and never retries an ambiguous recovery mutation", async () => {
    const id = "a".repeat(64);
    const input = parseLibraryCoreReapplyConsumerIntentV1({ review: { schemaVersion: 1, recoveryId: id, archiveDigest: id,
      transactionId: "original-edit", transactionDigest: id, reviewedGenerationId: id, reviewedRevision: 1, reviewedLocalSequence: 0, memberCount: 1 },
      intent: { envelopeBytes: [Uint8Array.of(123, 125)] } });
    const client = new PwaLibraryCoreSqliteClient(), worker = activeWorker();
    const pending = client.reapplyConsumerIntent(input);
    expect(worker.posted[0]).toMatchObject({ kind: "reapply_consumer_intent", recovery: input });
    worker.respond({ requestId: requestId(worker), ok: true, result: { schemaVersion: 1, recoveryId: id, originalTransactionId: "another-edit",
      replacementTransactionId: "replacement-edit", replacementTransactionDigest: id, replacementEpochId: id, replacementActorId: id,
      firstCounter: 1, lastCounter: 1, memberCount: 1, createdAt: 10 } });
    await expect(pending).rejects.toThrow(/receipt/);
    const lost = client.reapplyConsumerIntent(input);
    worker.emit("error");
    await expect(lost).rejects.toMatchObject({ code: "pwa_sqlite_worker_unavailable" });
    expect(worker.posted).toHaveLength(2);
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

  it.each([null, catchupVector.expectedReadProof])("decodes the predecessor read response without creating an activation token", async (reference) => {
    const client = new PwaLibraryCoreSqliteClient();
    const pending = client.preparePredecessorCheckpointRead("successor");
    const worker = activeWorker();
    expect(worker.posted.at(-1)).toMatchObject({ kind: "prepare_predecessor_checkpoint_read", stageId: "successor" });
    worker.respond({ ok: true, requestId: requestId(worker), result: reference });
    await expect(pending).resolves.toEqual(reference === null ? null : [reference]);
  });

  it.each(["abort", "deadline"] as const)("settles an audit %s without retiring other requests", async (mode) => {
    vi.useFakeTimers();
    const onUnavailable = vi.fn();
    const client = new PwaLibraryCoreSqliteClient(onUnavailable);
    const controller = new AbortController();
    const audit = client.auditNormalizedReplica(controller.signal);
    const rejected = expect(audit).rejects.toThrow();
    const worker = activeWorker();
    const auditId = requestId(worker);
    await vi.advanceTimersByTimeAsync(1);
    const status = client.status();
    const statusId = requestId(worker);
    if (mode === "abort") controller.abort();
    else await vi.advanceTimersByTimeAsync(29_999);
    await rejected;
    expect(worker.posted.at(-1)).toMatchObject({
      kind: "cancel_normalized_replica_audit", auditRequestId: auditId,
    });
    expect(worker.terminateCount).toBe(0);
    expect(onUnavailable).not.toHaveBeenCalled();
    worker.respond({ ok: true, requestId: statusId, status: validStatus() });
    await expect(status).resolves.toEqual(validStatus());
    worker.respond({ ok: true, requestId: auditId, result: { late: true } });
    expect(worker.terminateCount).toBe(0);
    client.dispose();
  });

  it("retires the complete client generation when a request times out", async () => {
    vi.useFakeTimers();
    const onUnavailable = vi.fn();
    const client = new PwaLibraryCoreSqliteClient(onUnavailable);
    const pending = client.status();
    const rejection = expect(pending).rejects.toMatchObject({
      code: "pwa_sqlite_worker_unavailable",
      message: "PWA Library SQLite request timed out (status)",
    });
    const worker = activeWorker();

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(worker.terminateCount).toBe(1);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it.each(["ordinary", "predecessor"] as const)("keeps queued reads alive only while %s checkpoint records advance", async (kind) => {
    vi.useFakeTimers();
    const client = new PwaLibraryCoreSqliteClient();
    const activation = kind === "ordinary" ? client.activateNormalizedCheckpointStage({
      followerReceipt: null, replaceExisting: false, stageId: "progress-test",
    }) : client.activateVerifiedPredecessorCheckpoint({ stageId: "predecessor", replaceExisting: true,
      followerReceipt: { checkpointGeneration: 1, controlRevision: "revision", installedAt: 2400,
        manifestContentDigest: "a".repeat(64) as never, manifestObjectKey: "manifest",
        manifestTransportObjectId: "object", writerActorId: "writer" },
    }, "successor");
    const activationFailure = expect(activation).rejects.toThrow("timed out");
    const worker = activeWorker();
    const activationId = requestId(worker);
    const read = client.status();
    const readId = requestId(worker);
    for (let completedRecords = 0; completedRecords < 3; completedRecords += 1) {
      await vi.advanceTimersByTimeAsync(20_000);
      worker.respond({ kind: "checkpoint_activation_progress", requestId: activationId,
        completedRecords, totalRecords: 100 });
      expect(worker.terminateCount).toBe(0);
    }
    worker.respond({ ok: true, requestId: readId, status: validStatus() });
    await expect(read).resolves.toEqual(validStatus());
    await vi.advanceTimersByTimeAsync(30_000);
    await activationFailure;
    expect(worker.terminateCount).toBe(1);
  });

  it("caps checkpoint work even when valid progress never stops", async () => {
    vi.useFakeTimers();
    const client = new PwaLibraryCoreSqliteClient();
    const activation = client.activateNormalizedCheckpointStage({
      followerReceipt: null, replaceExisting: false, stageId: "deadline-test",
    });
    const failure = expect(activation).rejects.toThrow("timed out");
    const worker = activeWorker();
    for (let completedRecords = 0; completedRecords < 30; completedRecords += 1) {
      worker.respond({ kind: "checkpoint_activation_progress", requestId: requestId(worker),
        completedRecords, totalRecords: 100 });
      await vi.advanceTimersByTimeAsync(20_000);
    }
    await failure;
    expect(worker.terminateCount).toBe(1);
  });

  it.each([
    { completedRecords: 1, totalRecords: 100 },
    { completedRecords: 0, totalRecords: 100 },
    { completedRecords: 2, totalRecords: 101 },
    { completedRecords: 2, totalRecords: 100, extra: true },
  ])("rejects nonmonotonic or open checkpoint progress: %j", async (invalid) => {
    const client = new PwaLibraryCoreSqliteClient();
    const activation = client.activateNormalizedCheckpointStage({
      followerReceipt: null, replaceExisting: false, stageId: "invalid-progress-test",
    });
    const failure = expect(activation).rejects.toThrow("checkpoint progress is invalid");
    const worker = activeWorker();
    const envelope = { kind: "checkpoint_activation_progress", requestId: requestId(worker) };
    worker.respond({ ...envelope, completedRecords: 1, totalRecords: 100 });
    worker.respond({ ...envelope, ...invalid });
    await failure;
    expect(worker.terminateCount).toBe(1);
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

  it("preserves a busy Library response as a typed startup condition", async () => {
    const client = new PwaLibraryCoreSqliteClient();
    const pending = client.open();
    const worker = activeWorker();
    worker.respond({
      code: "library_busy",
      message: "PWA Library SQLite is already open in another app window",
      ok: false,
      requestId: requestId(worker),
    });

    const error = await pending.catch((reason: unknown) => reason);

    expect(isPwaLibraryCoreSqliteBusyError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "library_busy",
      message: "PWA Library SQLite is already open in another app window",
      name: "PwaLibraryCoreSqliteWorkerError",
    });
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
