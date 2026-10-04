import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  reload: vi.fn(),
  librarySubscriber: null as null | ((state: unknown, event: { source: string }) => void),
  query: vi.fn(),
}));

vi.mock("./library-core-normalized-query-client", () => ({ queryNormalizedLibrary: mocks.query }));

vi.mock("./library-client", () => ({
  backfillLibraryPriorities: mocks.backfill,
  reloadSqliteLibraryState: mocks.reload,
  subscribeDesktopLibraryRuntime: vi.fn(
    (callback: (state: unknown, event: { source: string }) => void) => {
      mocks.librarySubscriber = callback;
      return vi.fn();
    },
  ),
}));

vi.mock("./background-runtime-coordinator", () => ({
  isBackgroundRuntimeDeferredError: () => false,
  runBackgroundJob: ({ run }: { run: () => Promise<unknown> }) => run(),
}));

vi.mock("./logger", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@freed/ui/lib/debug-store", () => ({ addDebugEvent: vi.fn() }));
vi.mock("@freed/ui/lib/factory-reset", () => ({
  waitForFactoryResetDrain: vi.fn(),
}));

import { log } from "./logger";

function passSummaries() {
  return vi.mocked(log.info).mock.calls.filter(([message]) => message.startsWith("[priority-indexer] pass_summary ")).map(([message]) => JSON.parse(message.slice("[priority-indexer] pass_summary ".length)));
}

import { start, stop, stopAndDrain } from "./priority-indexer";
import { pauseDesktopOperationsForHandoff } from "./factory-reset-guard";

function revision(value: number, generationId = "a".repeat(64)) {
  return { queryId: "preferences_revision_v1", schemaVersion: 1, revision: value,
    source: { generationId, projectionRevision: 100, transitionSequence: 100 } };
}

describe("Primary priority indexer", () => {
  it("reports total progress and queue samples once at completion", async () => {
    mocks.backfill.mockResolvedValueOnce({ remaining: 1, updated: 64, queueWaitMs: 7.25 })
      .mockResolvedValue({ remaining: 0, updated: 1, queueWaitMs: 3.75 });
    start({ diagnostics: true });
    await vi.advanceTimersByTimeAsync(30_500);
    expect(passSummaries()).toEqual([
      expect.objectContaining({ outcome: "started", triggers: ["startup"], batches: 0 }),
      expect.objectContaining({ outcome: "complete", items: 65, batches: 2, queueWaitMs: 11, queueSamples: 2,
        elapsedMs: 30_500, workElapsedMs: 500, rerunTriggers: [] }),
    ]);
  });

  it("coalesces trigger categories without logging content or changing reruns", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 0, queueWaitMs: 0 });
    mocks.reload.mockImplementation(async () => {
      mocks.librarySubscriber?.(null, { source: "state_update" });
      mocks.librarySubscriber?.(null, { source: "item_patch" });
    });
    start({ diagnostics: true });
    for (let index = 0; index < 10_000; index++) mocks.librarySubscriber?.(null, { source: "preferences_patch" });
    mocks.librarySubscriber?.(null, { source: "synthetic-private-source" });
    expect(passSummaries()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    const summaries = passSummaries();
    expect(summaries).toHaveLength(4);
    expect(summaries[1]).toMatchObject({ outcome: "complete", rerunTriggers: ["preferences_update", "other_update"] });
    expect(summaries[2]).toMatchObject({ outcome: "started", triggers: ["preferences_update", "other_update"] });
    expect(summaries[3]).toMatchObject({ outcome: "complete", rerunTriggers: [] });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(summaries)).not.toContain("synthetic-private-source");
    for (const summary of summaries) expect(JSON.stringify(summary).length).toBeLessThan(1024);
    expect(Object.keys(summaries[3]).sort()).toEqual(["outcome", "mode", "triggers", "rerunTriggers", "elapsedMs", "workElapsedMs", "batches", "items", "queueWaitMs", "queueSamples", "failures", "deferrals", "suppressedEvents", "suppressedTriggers"].sort());
  });

  it("bounds long-pass progress logging and closes stopped lifecycles once", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 1, updated: 64, queueWaitMs: 1 });
    start({ diagnostics: true });
    await vi.advanceTimersByTimeAsync(150_000);
    expect(passSummaries().map(summary => summary.outcome)).toEqual(["started", "progress", "progress"]);
    expect(passSummaries().filter(summary => summary.outcome === "progress").map(summary => summary.elapsedMs)).toEqual([60_000, 120_000]);
    stop(); stop();
    expect(passSummaries().map(summary => summary.outcome)).toEqual(["started", "progress", "progress", "stopped"]);
    start({ diagnostics: true });
    expect(passSummaries().at(-1)).toMatchObject({ outcome: "started", triggers: ["startup"], items: 0, queueWaitMs: 0 });
  });

  it("caps summaries during rapid completed-pass invalidations without suppressing work", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 0, queueWaitMs: 0 });
    start({ diagnostics: true });
    await vi.advanceTimersByTimeAsync(30_000);
    for (let index = 0; index < 50; index++) {
      mocks.librarySubscriber?.(null, { source: "item_patch" });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(mocks.backfill).toHaveBeenCalledTimes(51);
    expect(passSummaries()).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(5000);
    mocks.librarySubscriber?.(null, { source: "state_update" });
    expect(passSummaries().at(-1)).toMatchObject({ outcome: "started", suppressedEvents: 94, suppressedTriggers: ["item_update"] });
  });

  it("does not attribute an in-flight stopped batch to a later lifecycle", async () => {
    let finish!: (value: { remaining: number; updated: number; queueWaitMs: number }) => void;
    mocks.backfill.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ remaining: 0, updated: 1, queueWaitMs: 0 });
    start({ diagnostics: true });
    await vi.advanceTimersByTimeAsync(30_000);
    stop(); start({ diagnostics: true });
    finish({ remaining: 0, updated: 64, queueWaitMs: 900 });
    await vi.advanceTimersByTimeAsync(30_000);
    const summaries = passSummaries();
    expect(summaries.filter(summary => summary.outcome === "complete")).toEqual([expect.objectContaining({ items: 1, queueWaitMs: 0 })]);
    expect(summaries.filter(summary => summary.outcome === "stopped")).toEqual([expect.objectContaining({ items: 0 })]);
  });

  it("keeps ordinary startup diagnostics and queue timing disabled", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 1 });
    start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.backfill).toHaveBeenCalledWith(expect.any(Number), 64, false);
    expect(passSummaries()).toEqual([]);
    expect(performance.now).not.toHaveBeenCalled();
  });

  it("requires an owned pause and permits restarting after a resumable drain", async () => {
    await expect(stopAndDrain({ resumable: true })).rejects.toThrow("requires the handoff pause");
    const pause = pauseDesktopOperationsForHandoff();
    try {
      await stopAndDrain({ resumable: true });
      start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.backfill).not.toHaveBeenCalled();
    } finally {
      pause.resume();
    }
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 1 });
    start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.backfill).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.mocked(log.info).mockClear();
    mocks.backfill.mockReset();
    mocks.reload.mockReset();
    mocks.reload.mockResolvedValue({});
    mocks.librarySubscriber = null;
    mocks.query.mockReset();
    mocks.query.mockResolvedValue(revision(0));
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the pass timestamp and reruns after a weight change", async () => {
    mocks.backfill
      .mockResolvedValueOnce({ passStartedAt: 1, remaining: 1, updated: 64 })
      .mockResolvedValueOnce({ passStartedAt: 1, remaining: 0, updated: 2 })
      .mockResolvedValueOnce({
        passStartedAt: 30_500,
        remaining: 0,
        updated: 1,
      });

    start();

    await vi.advanceTimersByTimeAsync(30_000);
    mocks.librarySubscriber?.(null, { source: "preferences_patch" });
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.backfill).toHaveBeenNthCalledWith(
      1,
      1,
      64,
      false,
    );
    expect(mocks.backfill).toHaveBeenNthCalledWith(
      2,
      1,
      64,
      false,
    );
    expect(mocks.backfill).toHaveBeenNthCalledWith(
      3,
      30_500,
      64,
      false,
    );
    expect(mocks.reload).toHaveBeenCalledTimes(2);
  });

  it("coalesces preference changes received while a batch is in flight", async () => {
    let finish!: (value: { remaining: number; updated: number }) => void;
    mocks.backfill.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ remaining: 0, updated: 1 });
    start();
    await vi.advanceTimersByTimeAsync(30_000);
    mocks.librarySubscriber?.(null, { source: "preferences_patch" }); mocks.librarySubscriber?.(null, { source: "preferences_patch" });
    finish({ remaining: 0, updated: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill.mock.calls[1]![0]).toBeGreaterThan(mocks.backfill.mock.calls[0]![0]);
    expect(mocks.reload).toHaveBeenCalledTimes(2);
  });

  it("retries a stale read without marking the pass complete", async () => {
    mocks.backfill.mockRejectedValueOnce(new Error("CURSOR_STALE")).mockResolvedValue({ remaining: 0, updated: 1 });
    start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill.mock.calls[1]).toEqual(mocks.backfill.mock.calls[0]);
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it("coalesces Library invalidations into one follow-up pass", async () => {
    mocks.backfill
      .mockResolvedValueOnce({ passStartedAt: 1, remaining: 1, updated: 64 })
      .mockResolvedValueOnce({ passStartedAt: 1, remaining: 0, updated: 1 })
      .mockResolvedValueOnce({
        passStartedAt: 30_500,
        remaining: 0,
        updated: 1,
      });

    start();
    await vi.advanceTimersByTimeAsync(30_000);
    mocks.librarySubscriber?.(null, { source: "item_patch" });
    mocks.librarySubscriber?.(null, { source: "state_update" });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.backfill).toHaveBeenCalledTimes(3);
    expect(mocks.backfill).toHaveBeenNthCalledWith(
      3,
      30_500,
      64,
      false,
    );
    expect(mocks.reload).toHaveBeenCalledTimes(2);
  });
  it("detects durable preference changes without a renderer map subscription", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 1 });
    mocks.query.mockResolvedValueOnce(revision(0)).mockResolvedValue(revision(1));
    start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
  });

  it("does not loop on its own reload or item-only revisions", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 0 });
    mocks.reload.mockImplementation(async () => {
      mocks.librarySubscriber?.(null, { source: "state_update" });
      mocks.librarySubscriber?.(null, { source: "item_patch" });
    });
    start();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(mocks.backfill).toHaveBeenCalledOnce();
  });

  it("reruns after a checkpoint generation replacement with the same revision", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 1 });
    mocks.query.mockResolvedValueOnce(revision(0)).mockResolvedValue(revision(0, "b".repeat(64)));
    start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
  });

  it("retries a failed completion marker instead of silently completing", async () => {
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 1 });
    mocks.query.mockResolvedValueOnce(revision(0)).mockRejectedValueOnce(new Error("marker unavailable"))
      .mockResolvedValue(revision(0));
    start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill.mock.calls[1]).toEqual(mocks.backfill.mock.calls[0]);
  });

});
