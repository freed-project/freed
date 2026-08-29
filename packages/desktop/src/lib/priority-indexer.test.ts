import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeightPreferences } from "@freed/shared";

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  librarySubscriber: null as null | ((state: unknown, event: { source: string }) => void),
  weightSubscriber: null as null | (() => void),
}));

vi.mock("./library-client", () => ({
  backfillLibraryPriorities: mocks.backfill,
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

import { start, stop } from "./priority-indexer";

const firstWeights: WeightPreferences = Object.freeze({
  authors: { ada: 90 },
  platforms: { rss: 70 },
  recency: 50,
  topics: { research: 80 },
});
const secondWeights: WeightPreferences = Object.freeze({
  authors: { ada: 10 },
  platforms: { rss: 20 },
  recency: 30,
  topics: { research: 40 },
});

describe("Primary priority indexer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.backfill.mockReset();
    mocks.librarySubscriber = null;
    mocks.weightSubscriber = null;
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("keeps one weight and timestamp snapshot for every bounded pass", async () => {
    let currentWeights = firstWeights;
    mocks.backfill
      .mockResolvedValueOnce({ passStartedAt: 1, remaining: 1, updated: 64 })
      .mockResolvedValueOnce({ passStartedAt: 1, remaining: 0, updated: 2 })
      .mockResolvedValueOnce({
        passStartedAt: 30_500,
        remaining: 0,
        updated: 1,
      });

    start({
      getWeights: () => currentWeights,
      subscribeToWeightChanges: (callback) => {
        mocks.weightSubscriber = callback;
        return vi.fn();
      },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    currentWeights = secondWeights;
    mocks.weightSubscriber?.();
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.backfill).toHaveBeenNthCalledWith(1, firstWeights, 1, 64);
    expect(mocks.backfill).toHaveBeenNthCalledWith(2, firstWeights, 1, 64);
    expect(mocks.backfill).toHaveBeenNthCalledWith(
      3,
      secondWeights,
      30_500,
      64,
    );
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

    start({ getWeights: () => firstWeights });
    await vi.advanceTimersByTimeAsync(30_000);
    mocks.librarySubscriber?.(null, { source: "item_patch" });
    mocks.librarySubscriber?.(null, { source: "state_update" });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.backfill).toHaveBeenCalledTimes(3);
    expect(mocks.backfill).toHaveBeenNthCalledWith(
      3,
      firstWeights,
      30_500,
      64,
    );
  });
});
