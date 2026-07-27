/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("./logger.js", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./runtime-health-events", () => ({ recordRuntimeHealthEvent: vi.fn() }));

const { reconcile, shadowStoreEnabled, startShadowSync } = await import("./shadow-sync");

type Handler = (state: unknown, event: unknown) => void;

function item(globalId: string, publishedAt = 1_780_000_000_000): Record<string, unknown> {
  return {
    globalId,
    platform: "x",
    contentType: "post",
    publishedAt,
    capturedAt: publishedAt,
    author: { id: "a:1", handle: "someone", displayName: "Someone" },
    content: { text: "hello", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
  };
}

function stateWith(...items: Record<string, unknown>[]): Record<string, unknown> {
  return { items };
}

/** Every call to a given Tauri command, with its argument object. */
function callsTo(command: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

/**
 * `startShadowSync` is idempotent by design: a second call returns the existing
 * stop function rather than subscribing twice. That means a test which starts it
 * and never stops it leaves the module subscribed and silently disables every
 * later start. Track and stop it.
 */
let activeStop: (() => void) | null = null;

function start(
  subscribe: (callback: Handler) => () => void,
  getState: () => unknown = () => null,
): void {
  activeStop = startShadowSync(subscribe as never, getState as never);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === "shadow_store_ids") return Promise.resolve([]);
    return Promise.resolve(0);
  });
  window.localStorage.clear();
});

afterEach(() => {
  activeStop?.();
  activeStop = null;
});

describe("shadow sync", () => {
  it("stays off unless explicitly enabled", () => {
    expect(shadowStoreEnabled()).toBe(false);
    // The store is a shadow that nothing reads, but it writes on the main
    // thread on every document change. Defaulting it on would add cost to the
    // exact place this whole programme is trying to relieve.
    start(() => () => {});
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reconciles inserts and deletes against what the store already holds", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "shadow_store_ids") return Promise.resolve(["x:1", "x:stale"]);
      return Promise.resolve(0);
    });

    await reconcile(stateWith(item("x:1"), item("x:2")) as never);

    const upserts = callsTo("shadow_store_upsert");
    expect(upserts).toHaveLength(1);
    // x:1 is already stored, so only x:2 is written.
    expect((upserts[0]!.rows as { globalId: string }[]).map((r) => r.globalId)).toStrictEqual([
      "x:2",
    ]);
    // x:stale is in the store but not the document.
    expect(callsTo("shadow_store_delete")[0]!.globalIds).toStrictEqual(["x:stale"]);
  });

  it("does not start a second reconcile while one is in flight", async () => {
    let release: (value: string[]) => void = () => {};
    invoke.mockImplementation((command: string) => {
      if (command === "shadow_store_ids") {
        return new Promise<string[]>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(0);
    });

    const first = reconcile(stateWith(item("x:1")) as never);
    const second = reconcile(stateWith(item("x:1")) as never);
    release([]);
    await Promise.all([first, second]);

    // A startup reconcile racing a STATE_UPDATE would otherwise walk the whole
    // library twice and double every write.
    expect(callsTo("shadow_store_ids")).toHaveLength(1);
  });

  it("treats a changed id with no supplied item as a deletion", async () => {
    window.localStorage.setItem("freed-shadow-store-enabled", "true");
    let handler: Handler = () => {};
    start((callback) => {
      handler = callback;
      return () => {};
    });

    handler(stateWith(), {
      source: "item_patch",
      requiresFullScan: false,
      changedItemIds: ["x:gone", "x:kept"],
      changedItems: [item("x:kept")],
    });
    await vi.waitFor(() => expect(callsTo("shadow_store_delete")).toHaveLength(1));

    expect(callsTo("shadow_store_delete")[0]!.globalIds).toStrictEqual(["x:gone"]);
    expect(
      (callsTo("shadow_store_upsert")[0]!.rows as { globalId: string }[]).map((r) => r.globalId),
    ).toStrictEqual(["x:kept"]);
  });

  it("reconciles rather than patching when the state was replaced wholesale", async () => {
    window.localStorage.setItem("freed-shadow-store-enabled", "true");
    let handler: Handler = () => {};
    start((callback) => {
      handler = callback;
      return () => {};
    });

    handler(stateWith(item("x:1")), {
      source: "state_update",
      requiresFullScan: true,
      changedItemIds: null,
    });

    // A STATE_UPDATE carries no patch, so a projector that only followed
    // patches would silently miss it entirely.
    await vi.waitFor(() => expect(callsTo("shadow_store_ids")).toHaveLength(1));
  });

  it("never lets a store failure escape into the application", async () => {
    window.localStorage.setItem("freed-shadow-store-enabled", "true");
    invoke.mockImplementation(() => Promise.reject(new Error("store unavailable")));

    let handler: Handler = () => {};
    start((callback) => {
      handler = callback;
      return () => {};
    });

    // Nothing reads these rows yet, so a projector that cannot write must not
    // be able to break the application it is shadowing. This changes at
    // Stage 8, when the store becomes the writer.
    expect(() =>
      handler(stateWith(), {
        source: "item_patch",
        requiresFullScan: false,
        changedItemIds: ["x:1"],
        changedItems: [item("x:1")],
      }),
    ).not.toThrow();
  });

  it("chunks large upserts rather than sending one enormous payload", async () => {
    const many = Array.from({ length: 1_200 }, (_, index) => item(`x:${index}`));
    await reconcile(stateWith(...many) as never);

    const upserts = callsTo("shadow_store_upsert");
    expect(upserts.length).toBeGreaterThan(1);
    for (const call of upserts) {
      expect((call.rows as unknown[]).length).toBeLessThanOrEqual(500);
    }
    const total = upserts.reduce((sum, call) => sum + (call.rows as unknown[]).length, 0);
    expect(total).toBe(1_200);
  });
});
