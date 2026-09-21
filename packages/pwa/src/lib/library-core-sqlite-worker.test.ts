import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLibraryCoreSqliteWorkerRequest } from "@freed/shared/library-core";

const storage = vi.hoisted(() => ({
  memoryOpen: vi.fn(),
  installOpfs: vi.fn(),
  reconcile: vi.fn(),
  vaultStorage: vi.fn(),
}));
vi.mock("@sqlite.org/sqlite-wasm", () => ({ default: async () => ({
  version: { libVersion: "test" },
  oo1: { DB: class { constructor(...args: unknown[]) { storage.memoryOpen(...args); } } },
  installOpfsSAHPoolVfs: storage.installOpfs,
}) }));
vi.mock("./library-core-sqlite-engine", () => ({ PwaLibraryCoreSqliteEngine: class {
  initialize() {}
  status() { return { synthetic: true }; }
} }));
vi.mock("./library-core-opfs-content-vault", () => ({ PwaLibraryCoreOpfsContentVault: class {
  constructor(_engine: unknown, ranges: unknown) { storage.vaultStorage(ranges); }
  reconcile = storage.reconcile;
} }));

describe("demo worker storage isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("VITE_FREED_DEMO", "0");
    vi.stubEnv("VITE_FREED_PWA_SQLITE_MEMORY_E2E", "0");
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
