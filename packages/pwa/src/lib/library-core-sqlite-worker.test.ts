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
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
        { ifAvailable: true, mode: "exclusive" }, expect.any(Function),
      );
      expect(storage.memoryOpen).not.toHaveBeenCalled();
      expect(storage.vaultStorage).not.toHaveBeenCalled();
    }
  });
});
