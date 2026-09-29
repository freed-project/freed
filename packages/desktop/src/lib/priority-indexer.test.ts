import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  reload: vi.fn(),
  librarySubscriber: null as null | ((state: unknown, event: { source: string }) => void),
  weightSubscriber: null as null | (() => void),
}));

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

import { start, stop, stopAndDrain } from "./priority-indexer";
import { pauseDesktopOperationsForHandoff } from "./factory-reset-guard";

describe("Primary priority indexer", () => {
  it("requires an owned pause and permits restarting after a resumable drain", async () => {
    await expect(stopAndDrain({ resumable: true })).rejects.toThrow("requires the handoff pause");
    const pause = pauseDesktopOperationsForHandoff();
    try {
      await stopAndDrain({ resumable: true });
      start({});
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.backfill).not.toHaveBeenCalled();
    } finally {
      pause.resume();
    }
    mocks.backfill.mockResolvedValue({ remaining: 0, updated: 1 });
    start({});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.backfill).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.backfill.mockReset();
    mocks.reload.mockReset();
    mocks.reload.mockResolvedValue({});
    mocks.librarySubscriber = null;
    mocks.weightSubscriber = null;
  });

  afterEach(() => {
    stop();
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

    start({
      subscribeToWeightChanges: (callback) => {
        mocks.weightSubscriber = callback;
        return vi.fn();
      },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    mocks.weightSubscriber?.();
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
    start({ subscribeToWeightChanges: callback => { mocks.weightSubscriber = callback; return vi.fn(); } });
    await vi.advanceTimersByTimeAsync(30_000);
    mocks.weightSubscriber?.(); mocks.weightSubscriber?.();
    finish({ remaining: 0, updated: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill.mock.calls[1]![0]).toBeGreaterThan(mocks.backfill.mock.calls[0]![0]);
    expect(mocks.reload).toHaveBeenCalledTimes(2);
  });

  it("retries a stale read without marking the pass complete", async () => {
    mocks.backfill.mockRejectedValueOnce(new Error("CURSOR_STALE")).mockResolvedValue({ remaining: 0, updated: 1 });
    start({});
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

    start({});
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
});
