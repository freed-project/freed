import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLibraryCoreSqliteReplicaAuditWorkerRequest, createLibraryCoreSqliteCancelReplicaAuditWorkerRequest, createLibraryCoreSqliteWorkerRequest, createLibraryCoreSqliteQueryWorkerRequest, createLibraryCoreSqliteActivatePredecessorWorkerRequest, createLibraryCoreSqlitePredecessorReadWorkerRequest } from "@freed/shared/library-core";

const storage = vi.hoisted(() => ({
  query: vi.fn(),
  audit: vi.fn(),
  predecessor: vi.fn(),
  predecessorRead: vi.fn(),
  memoryOpen: vi.fn(),
  engineOpen: vi.fn(),
  installOpfs: vi.fn(),
  reconcile: vi.fn(),
  vaultStorage: vi.fn(),
  beginAnnotations: vi.fn(),
  annotationPage: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@sqlite.org/sqlite-wasm", () => ({ default: async () => ({
  version: { libVersion: "test" },
  oo1: { DB: class { constructor(...args: unknown[]) { storage.memoryOpen(...args); } selectValue() { return 0; } } },
  installOpfsSAHPoolVfs: storage.installOpfs,
}) }));
vi.mock("./library-core-annotation-storage", () => ({ resumePwaAnnotationUpgrade: () => true }));
vi.mock("./library-core-sqlite-engine", () => ({ PwaLibraryCoreSqliteEngine: class {
  constructor(...args: unknown[]) { storage.engineOpen(...args); }
  queryWithVerification = storage.query;
  auditNormalizedReplica = storage.audit;
  activateVerifiedPredecessorCheckpoint = storage.predecessor;
  preparePredecessorCheckpointRead = storage.predecessorRead;
  beginAnnotationReconciliation = storage.beginAnnotations;
  reconcileAnnotationPage = storage.annotationPage;
  close = storage.close;
  initialize() {}
  status() { return { synthetic: true }; }
} }));
vi.mock("./library-core-opfs-content-vault", () => ({ PwaLibraryCoreOpfsContentVault: class {
  constructor(_engine: unknown, ranges: unknown) { storage.vaultStorage(ranges); }
  reconcile = storage.reconcile;
  async close() {}
} }));

describe("demo worker storage isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storage.audit.mockReset();
    storage.beginAnnotations.mockReset().mockReturnValue(null);
    storage.annotationPage.mockReset();
    vi.stubEnv("VITE_FREED_DEMO", "0");
    vi.stubEnv("VITE_FREED_PWA_SQLITE_MEMORY_E2E", "0");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("yields annotation slices behind commands and cancels the old session on close", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("location", new URL("https://demo.freed.wtf/"));
    vi.stubGlobal("name", "freed-library-core-sqlite-demo");
    vi.stubGlobal("onmessage", null);
    const replies: unknown[]=[];
    vi.stubGlobal("postMessage",(reply:unknown)=>replies.push(reply));
    storage.beginAnnotations.mockReturnValue({identity:"old",through:["last",0],after:null});
    storage.annotationPage.mockReturnValue({changed:false,localChanged:true,after:["first",0]});
    await import("./library-core-sqlite-worker");
    const send=(kind:"open"|"status"|"close",id=kind) =>
      (globalThis.onmessage as unknown as (event:MessageEvent)=>void)({
        data:createLibraryCoreSqliteWorkerRequest(kind,id),isTrusted:true,source:null,origin:"https://demo.freed.wtf",
      } as MessageEvent);
    send("open");
    await vi.advanceTimersByTimeAsync(0);
    expect(replies).toContainEqual(expect.objectContaining({requestId:"open",ok:true}));
    await vi.advanceTimersToNextTimerAsync();
    expect(storage.annotationPage.mock.calls.length).toBeGreaterThan(0);
    expect(replies).toContainEqual({kind:"local_changes_available"});
    send("status"); send("close");
    await vi.advanceTimersByTimeAsync(0);
    expect(replies).toContainEqual(expect.objectContaining({requestId:"status",ok:true}));
    expect(replies).toContainEqual(expect.objectContaining({requestId:"close",ok:true}));
    const calls=storage.annotationPage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(storage.annotationPage).toHaveBeenCalledTimes(calls);
    storage.beginAnnotations.mockReturnValue(null);
    send("open");
    await vi.advanceTimersByTimeAsync(10);
    expect(storage.beginAnnotations).toHaveBeenCalledTimes(2);
    expect(storage.annotationPage).toHaveBeenCalledTimes(calls);
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it.each(["SQLITE_BUSY", "corrupt coverage"])("defers busy maintenance and latches permanent refusal: %s", async reason => {
    vi.useFakeTimers();
    vi.spyOn(console,"error").mockImplementation(()=>{});
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("location", new URL("https://demo.freed.wtf/"));
    vi.stubGlobal("name", "freed-library-core-sqlite-demo");
    vi.stubGlobal("onmessage", null);
    const replies: unknown[]=[];
    vi.stubGlobal("postMessage",(reply:unknown)=>replies.push(reply));
    storage.beginAnnotations.mockReturnValueOnce({identity:"session",through:["last",0],after:null}).mockReturnValue(null);
    storage.annotationPage.mockImplementationOnce(()=>{throw new Error(reason);})
      .mockReturnValue({changed:false,localChanged:false,after:null});
    await import("./library-core-sqlite-worker");
    const send=(data:unknown)=>(globalThis.onmessage as unknown as (event:MessageEvent)=>void)({
      data,isTrusted:true,source:null,origin:"https://demo.freed.wtf",
    } as MessageEvent);
    send(createLibraryCoreSqliteWorkerRequest("open","open"));
    await vi.advanceTimersByTimeAsync(100);
    expect(storage.annotationPage).toHaveBeenCalledTimes(reason==="SQLITE_BUSY"?2:1);
    const calls=storage.annotationPage.mock.calls.length;
    send(createLibraryCoreSqliteWorkerRequest("status","status"));
    send(createLibraryCoreSqliteQueryWorkerRequest("eligibility",{queryId:"item_annotation_edit_state_v1",schemaVersion:1,globalId:"item"}));
    await vi.advanceTimersByTimeAsync(100);
    expect(replies).toContainEqual(expect.objectContaining({requestId:"status",ok:true}));
    if (reason!=="SQLITE_BUSY") {
      expect(replies).toContainEqual(expect.objectContaining({requestId:"eligibility",ok:false,message:expect.stringContaining("maintenance refused")}));
      expect(replies).toContainEqual({kind:"local_changes_available"});
    }
    expect(storage.annotationPage).toHaveBeenCalledTimes(calls);
  });

  it.each(["released", "occupied", "rejected"])("bounds ownership acquisition when the previous worker is %s", async (outcome) => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_FREED_PWA_SQLITE_MEMORY_E2E", "1");
    let grant!: () => void;
    let signal!: AbortSignal;
    const lockRequest = vi.fn((_name, options, callback) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      grant = () => resolve(callback({ name: _name, mode: "exclusive" }));
      if (outcome === "rejected") reject(new Error("ownership service unavailable"));
    }));
    vi.stubGlobal("navigator", { locks: { request: lockRequest } });
    vi.stubGlobal("location", new URL("https://app.freed.wtf/"));
    vi.stubGlobal("name", "freed-library-core-sqlite");
    vi.stubGlobal("onmessage", null);
    const response = new Promise<{ ok: boolean; message?: string }>((resolve) => {
      vi.stubGlobal("postMessage", resolve);
    });
    await import("./library-core-sqlite-worker");
    (globalThis.onmessage as unknown as (event: MessageEvent) => void)({
      data: createLibraryCoreSqliteWorkerRequest("open", "ownership-test"),
      isTrusted: true, source: null, origin: "https://app.freed.wtf",
    } as MessageEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(lockRequest).toHaveBeenCalledOnce();
    expect(storage.memoryOpen).not.toHaveBeenCalled();
    if (outcome === "released") {
      await vi.advanceTimersByTimeAsync(250);
      grant();
      expect((await response).ok).toBe(true);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(signal.aborted).toBe(false);
      expect(storage.memoryOpen).toHaveBeenCalledOnce();
    } else {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await response).toMatchObject({ ok: false, message: outcome === "occupied"
        ? "PWA Library SQLite is already open in another app window"
        : "ownership service unavailable" });
      expect(storage.memoryOpen).not.toHaveBeenCalled();
    }
  });

  it("serializes a read behind asynchronous database opening", async () => {
    let finishReconcile!: () => void;
    storage.reconcile.mockReturnValueOnce(new Promise<void>(resolve => { finishReconcile = resolve; }));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("location", new URL("https://demo.freed.wtf/"));
    vi.stubGlobal("name", "freed-library-core-sqlite-demo");
    vi.stubGlobal("onmessage", null);
    const replies: { requestId: string; ok: boolean }[] = [];
    vi.stubGlobal("postMessage", (reply: { requestId: string; ok: boolean }) => replies.push(reply));
    await import("./library-core-sqlite-worker");
    const send = (kind: "open" | "status") =>
      (globalThis.onmessage as unknown as (event: MessageEvent) => void)({
        data: createLibraryCoreSqliteWorkerRequest(kind, kind),
        isTrusted: true, source: null, origin: "https://demo.freed.wtf",
      } as MessageEvent);
    send("open"); send("status");
    await vi.waitFor(() => expect(storage.reconcile).toHaveBeenCalledOnce());
    expect(replies).toEqual([]);
    finishReconcile();
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(replies).toMatchObject([{requestId: "open", ok: true}, {requestId: "status", ok: true}]);
    expect(storage.memoryOpen).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "deadline", "product-work"] as const)(
    "settles an audit on %s without stopping later worker commands", async (mode) => {
      let now = 100;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      vi.stubGlobal("navigator", {});
      vi.stubGlobal("location", new URL("https://demo.freed.wtf/"));
      vi.stubGlobal("name", "freed-library-core-sqlite-demo");
      vi.stubGlobal("onmessage", null);
      const replies: { requestId: string; ok: boolean; message?: string }[] = [];
      vi.stubGlobal("postMessage", (reply: typeof replies[number]) => replies.push(reply));
      let resume!: () => void;
      const held = new Promise<void>((resolve) => { resume = resolve; });
      storage.audit.mockImplementationOnce(async (control) => {
        await held;
        control.check();
        throw new Error("audit should have stopped");
      });
      await import("./library-core-sqlite-worker");
      const send = (data: unknown) => (globalThis.onmessage as unknown as (event: MessageEvent) => void)({
        data, isTrusted: true, source: null, origin: "https://demo.freed.wtf",
      } as MessageEvent);
      send(createLibraryCoreSqliteWorkerRequest("open", "open"));
      // A diagnostic never waits behind another operation, including startup.
      send(createLibraryCoreSqliteReplicaAuditWorkerRequest("busy-audit"));
      expect(replies.at(-1)).toMatchObject({ requestId: "busy-audit", ok: false, message: expect.stringContaining("Library is busy") });
      await vi.waitFor(() => expect(replies.some(reply => reply.requestId === "open")).toBe(true));
      send(createLibraryCoreSqliteReplicaAuditWorkerRequest("audit"));
      await vi.waitFor(() => expect(storage.audit).toHaveBeenCalledOnce());
      send(createLibraryCoreSqliteReplicaAuditWorkerRequest("second-audit"));
      expect(replies.at(-1)).toMatchObject({ requestId: "second-audit", ok: false, message: expect.stringContaining("Library is busy") });
      if (mode === "deadline") now += 30_001;
      else if (mode === "cancel") {
        send(createLibraryCoreSqliteCancelReplicaAuditWorkerRequest("cancel", "audit"));
        // This reply precedes release of the database queue.
        expect(replies.at(-1)).toMatchObject({ requestId: "cancel", ok: true });
      } else {
        send(createLibraryCoreSqliteWorkerRequest("status", "after-audit"));
        expect(replies.some(reply => reply.requestId === "after-audit")).toBe(false);
      }
      resume();
      await vi.waitFor(() => expect(replies.some(reply => reply.requestId === "audit")).toBe(true));
      expect(replies.find(reply => reply.requestId === "audit")).toMatchObject({
        ok: false, message: mode === "deadline" ? "AUDIT_DEADLINE" : mode === "cancel" ? "AUDIT_CANCELLED"
          : "Replica audit interrupted by Library activity. Retry after sync finishes.",
      });
      if (mode !== "product-work") send(createLibraryCoreSqliteWorkerRequest("status", "after-audit"));
      await vi.waitFor(() => expect(replies.at(-1)).toMatchObject({ requestId: "after-audit", ok: true }));
      expect(storage.audit).toHaveBeenCalledOnce();
    });

  it.each(["review", "predecessor", "predecessor read"] as const)("holds later commands behind asynchronous %s and releases them after verification failure", async (operation) => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("location", new URL("https://demo.freed.wtf/"));
    vi.stubGlobal("name", "freed-library-core-sqlite-demo");
    vi.stubGlobal("onmessage", null);
    const replies: { requestId: string; ok: boolean }[] = [];
    vi.stubGlobal("postMessage", (reply: { requestId: string; ok: boolean }) => replies.push(reply));
    let reject!: (error: Error) => void;
    const verification = operation === "review" ? storage.query : operation === "predecessor" ? storage.predecessor : storage.predecessorRead;
    verification.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await import("./library-core-sqlite-worker");
    const send = (data: unknown) => (globalThis.onmessage as unknown as (event: MessageEvent) => void)({
      data, isTrusted: true, source: null, origin: "https://demo.freed.wtf",
    } as MessageEvent);
    send(createLibraryCoreSqliteWorkerRequest("open", "open"));
    send(operation === "review" ? createLibraryCoreSqliteQueryWorkerRequest("review", { queryId: "recovery_intent_review_v1", schemaVersion: 1,
      recoveryId: "a".repeat(64), transactionId: "preserved-edit", cursor: null, limit: 1,
      cancellationId: "review-cancel", readerSessionId: "review-reader" }) :
      operation === "predecessor read" ? createLibraryCoreSqlitePredecessorReadWorkerRequest("review", "successor") :
      createLibraryCoreSqliteActivatePredecessorWorkerRequest("review", {
        stageId: "predecessor", replaceExisting: true, followerReceipt: {
          checkpointGeneration: 1, controlRevision: "revision", installedAt: 2400,
          manifestContentDigest: "a".repeat(64) as never, manifestObjectKey: "manifest",
          manifestTransportObjectId: "object", writerActorId: "writer",
        },
      }, "successor"));
    send(createLibraryCoreSqliteWorkerRequest("status", "after-review"));
    await vi.waitFor(() => expect(verification).toHaveBeenCalledOnce());
    expect(replies.map(reply => reply.requestId)).toEqual(["open"]);
    reject(new Error("signature rejected"));
    await vi.waitFor(() => expect(replies).toHaveLength(3));
    expect(replies).toMatchObject([{ requestId: "open", ok: true }, { requestId: "review", ok: false }, { requestId: "after-review", ok: true }]);
  });

  it.each([
    ["demo.freed.wtf", "freed-library-core-sqlite-demo", true],
    ["preview.vercel.app", "freed-library-core-sqlite-demo", true],
    ["app.freed.wtf", "freed-library-core-sqlite-demo", false],
    ["localhost", "freed-library-core-sqlite-demo", false],
    ["demo.freed.wtf", "freed-library-core-sqlite", false],
  ])("fences storage for %s / %s", async (hostname, name, disposable) => {
    const lockRequest = vi.fn(async (_name, _options, callback) => callback(null));
    vi.stubGlobal("navigator", { locks: { request: lockRequest } });
    vi.stubGlobal("location", new URL(`https://${hostname}/`));
    vi.stubGlobal("name", name);
    vi.stubGlobal("onmessage", null);
    const response = new Promise<{ ok: boolean; code?: string }>((resolve) => {
      vi.stubGlobal("postMessage", resolve);
    });
    await import("./library-core-sqlite-worker");
    (globalThis.onmessage as unknown as (event: MessageEvent) => void)({
      data: createLibraryCoreSqliteWorkerRequest("open", "isolation-test"),
      isTrusted: true, source: null, origin: `https://${hostname}`,
    } as MessageEvent);
    const reply = await response;
    expect(reply.ok).toBe(disposable);
    expect(storage.installOpfs).not.toHaveBeenCalled();
    if (disposable) {
      expect(lockRequest).not.toHaveBeenCalled();
      expect(storage.memoryOpen).toHaveBeenCalledExactlyOnceWith(":memory:", "c");
      expect(storage.engineOpen).toHaveBeenCalledWith(expect.anything(), "test",
        expect.objectContaining({ persistentAuditTemporaryStorage: false }));
      expect(storage.vaultStorage).toHaveBeenCalledWith(expect.objectContaining({
        read: expect.any(Function), create: expect.any(Function),
      }));
    } else {
      expect(lockRequest).toHaveBeenCalledExactlyOnceWith(
        "freed-library-core-sqlite-opfs-v1",
        { signal: expect.any(AbortSignal), mode: "exclusive" }, expect.any(Function),
      );
      expect(storage.memoryOpen).not.toHaveBeenCalled();
      expect(storage.vaultStorage).not.toHaveBeenCalled();
    }
  });
});
