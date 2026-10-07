import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import type { LibraryMutationEvent } from "./library-types";
import type { PlatformActions } from "./platform-actions";

const { logError, debugEvent } = vi.hoisted(() => ({ logError: vi.fn(), debugEvent: vi.fn() }));
vi.mock("@freed/ui/lib/debug-store", () => ({ addDebugEvent: debugEvent }));
vi.mock("./logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: logError } }));
vi.mock("./runtime-health-events", () => ({ recordSocialOutboxAttempt: vi.fn() }));
vi.mock("./sqlite-library", () => ({
  isSqliteLibraryActive: () => false,
  sqliteLibraryCloudWriterAdmissionStatus: () => { throw new Error("Unexpected database access"); },
}));

// Tier 1: actual outbox/scheduler/coordinator lifetime, replacement and reset.
// Provider actions and SQLite are inert; fake timers cover the full deadline.
const stops: Array<() => void> = [];
const releases: Array<() => void> = [];
function makeItem(id: string): FeedItem {
  return {
    globalId: `facebook:${id}`, platform: "facebook", contentType: "post",
    capturedAt: 1, publishedAt: 1,
    author: { id: "synthetic", handle: "synthetic", displayName: "Synthetic" },
    content: { text: "Synthetic", mediaUrls: [], mediaTypes: [] }, topics: [],
    sourceUrl: `https://example.invalid/${id}`,
    userState: { readAt: 70, hidden: false, saved: false, archived: false, tags: [] },
  };
}
async function loadRuntime() {
  vi.resetModules();
  const scheduler = await import("./side-effect-scheduler");
  const coordinator = await import("./background-runtime-coordinator");
  coordinator.resetBackgroundRuntimeForTests({ requireRendererHealth: false });
  const scheduled = vi.spyOn(scheduler, "scheduleSideEffect");
  const outbox = await import("./outbox");
  return { scheduler, coordinator, scheduled, outbox };
}
function heldActions(outcome: "success" | "failure" = "success") {
  let finish!: () => void, running = 0, maxConcurrent = 0, calls = 0;
  const held = new Promise<boolean>((resolve, reject) => {
    finish = () => outcome === "success" ? resolve(true) : reject(new Error("late action failure"));
  });
  releases.push(finish);
  const markSeen = vi.fn(async () => {
    calls++; running++; maxConcurrent = Math.max(maxConcurrent, running);
    try { return calls === 1 ? await held : true; } finally { running--; }
  });
  const actions: PlatformActions = {
    like: vi.fn(async () => false), unlike: vi.fn(async () => false),
    markSeen, commentUrl: () => null,
  };
  return { registry: new Map([["facebook" as const, actions]]), markSeen, finish,
    get maxConcurrent() { return maxConcurrent; } };
}
function start(runtime: Awaited<ReturnType<typeof loadRuntime>>, rows: FeedItem[],
  actions: ReturnType<typeof heldActions>,
  subscribe: (cb: (event: LibraryMutationEvent) => void) => () => void = () => () => {},
) {
  const confirmSeen = vi.fn(async (id: string, syncedAt?: number) => {
    rows.find(item => item.globalId === id)!.userState.seenSyncedAt = syncedAt;
  });
  stops.push(runtime.outbox.startOutboxProcessor(
    async visit => { await visit(rows); }, subscribe, actions.registry,
    vi.fn(async () => {}), confirmSeen,
  ));
  return confirmSeen;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10_000); window.localStorage.clear(); logError.mockClear(); debugEvent.mockClear();
});
afterEach(async () => {
  stops.splice(0).forEach(stop => stop()); releases.splice(0).forEach(release => release());
  await vi.advanceTimersByTimeAsync(0); vi.restoreAllMocks(); vi.useRealTimers();
});
describe("outbox work ownership after deadline", () => {
  it.each(["success", "failure"] as const)("holds replacement and competing jobs until late %s settles", async outcome => {
    const runtime = await loadRuntime(), rows = [makeItem(outcome)], actions = heldActions(outcome);
    start(runtime, rows, actions); await vi.advanceTimersByTimeAsync(0);
    expect(actions.markSeen).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runtime.coordinator.getBackgroundRuntimeStatus().activeJob).toBe("outbox");
    await expect(runtime.coordinator.runBackgroundJob({
      kind: "library-projection", source: "competing", run: async () => {},
    })).rejects.toThrow("active:outbox:outbox");
    const replacementConfirm = start(runtime, rows, actions);
    await vi.advanceTimersByTimeAsync(0);
    // Global drain ownership blocks replacement before it can enqueue.
    expect(runtime.scheduled).toHaveBeenCalledOnce(); expect(actions.markSeen).toHaveBeenCalledOnce();
    expect(logError).not.toHaveBeenCalled();
    actions.finish(); await vi.advanceTimersByTimeAsync(0);
    expect(actions.maxConcurrent).toBe(1);
    expect(actions.markSeen).toHaveBeenCalledTimes(outcome === "success" ? 1 : 2);
    expect(replacementConfirm).toHaveBeenCalledTimes(outcome === "success" ? 0 : 1);
    expect(runtime.coordinator.getBackgroundRuntimeStatus().activeJob).toBeNull();
    expect(debugEvent).toHaveBeenCalledWith("error", expect.stringContaining("timed_out_ms=120,000"));
  });
  it("keeps changed-item scheduling behind the active processor after deadline", async () => {
    const runtime = await loadRuntime(), rows = [makeItem("changed")], actions = heldActions();
    let subscriber!: (event: LibraryMutationEvent) => void;
    start(runtime, rows, actions, cb => { subscriber = cb; return () => {}; });
    await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(120_000);
    subscriber({ source: "state_update", mutation: "ADD_FEED_ITEMS", changedItemIds: null, requiresFullScan: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runtime.scheduled).toHaveBeenCalledOnce(); expect(actions.markSeen).toHaveBeenCalledOnce();
    actions.finish(); await vi.advanceTimersByTimeAsync(5_000);
    expect(runtime.scheduled).toHaveBeenCalledTimes(2); expect(actions.markSeen).toHaveBeenCalledOnce();
    expect(runtime.coordinator.getBackgroundRuntimeStatus().activeJob).toBeNull();
  });
  it("refuses reset while work is held, stops later items, and drains after settlement", async () => {
    const runtime = await loadRuntime(), actions = heldActions();
    start(runtime, [makeItem("reset-a"), makeItem("reset-b")], actions);
    await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(120_000);
    let resetSettled = false;
    const reset = runtime.outbox.stopAndDrainOutboxProcessor().then(
      () => { resetSettled = true; return null; },
      error => { resetSettled = true; return error as Error; },
    );
    await vi.advanceTimersByTimeAsync(0); expect(resetSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await reset)?.message).toContain("did not stop within 120,000 ms");
    expect(actions.markSeen).toHaveBeenCalledOnce();
    expect(runtime.coordinator.getBackgroundRuntimeStatus().activeJob).toBe("outbox");
    actions.finish(); await vi.advanceTimersByTimeAsync(0);
    await expect(runtime.outbox.stopAndDrainOutboxProcessor()).resolves.toBeUndefined();
    expect(actions.markSeen).toHaveBeenCalledOnce();
    expect(runtime.coordinator.getBackgroundRuntimeStatus().activeJob).toBeNull();
  });
});
