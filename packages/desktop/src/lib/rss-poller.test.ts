import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshRssFeeds = vi.fn();
const addDebugEvent = vi.fn();
const runBackgroundJob = vi.fn();
const isBackgroundRuntimeDeferredError = vi.fn(
  (error: unknown) =>
    typeof error === "object" && error !== null && "reason" in error,
);

vi.mock("./capture", () => ({
  refreshRssFeeds,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent,
}));

vi.mock("./background-runtime-coordinator", () => ({
  runBackgroundJob,
  isBackgroundRuntimeDeferredError,
}));

async function loadPoller() {
  vi.resetModules();
  return import("./rss-poller");
}

describe("rss poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshRssFeeds.mockReset();
    addDebugEvent.mockReset();
    runBackgroundJob.mockReset();
    isBackgroundRuntimeDeferredError.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("delays the startup poll so launch stays responsive", async () => {
    runBackgroundJob.mockResolvedValueOnce(undefined);

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000);
    await vi.runAllTicks();

    expect(runBackgroundJob).not.toHaveBeenCalled();
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[RSS] startup poll scheduled in 300s",
    );

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(runBackgroundJob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runBackgroundJob).toHaveBeenCalledTimes(1);

    poller.stopRssPoller();
  });

  it("still supports an immediate startup poll when requested", async () => {
    runBackgroundJob.mockResolvedValueOnce(undefined);

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000, { startupDelayMs: 0 });
    await vi.runAllTicks();

    expect(runBackgroundJob).toHaveBeenCalledTimes(1);

    poller.stopRssPoller();
  });

  it("backs off a deferred startup poll before the normal interval", async () => {
    const deferredError = { reason: "waiting_for_renderer_heartbeat:1" };
    runBackgroundJob
      .mockRejectedValueOnce(deferredError)
      .mockResolvedValueOnce(undefined);

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000, { startupDelayMs: 0 });

    await vi.runAllTicks();
    expect(runBackgroundJob).toHaveBeenCalledTimes(1);
    expect(runBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "rss-poll",
        run: expect.any(Function),
      }),
    );
    const task = runBackgroundJob.mock.calls[0]?.[0];
    await task.run();
    expect(refreshRssFeeds).toHaveBeenCalledWith({
      maxFeeds: 80,
      staleAfterMs: 2 * 60 * 60 * 1000,
    });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(runBackgroundJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(runBackgroundJob).toHaveBeenCalledTimes(2);
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[RSS] poll deferred: waiting_for_renderer_heartbeat:1",
    );
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[RSS] poll retry scheduled in 60s after waiting_for_renderer_heartbeat:1",
    );

    poller.stopRssPoller();
  });

  it("clears a deferred retry when the poller stops", async () => {
    runBackgroundJob.mockRejectedValueOnce({ reason: "cooldown:120000" });

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000, { startupDelayMs: 0 });
    await vi.runAllTicks();

    poller.stopRssPoller();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(runBackgroundJob).toHaveBeenCalledTimes(1);
  });

  it("uses the runtime cooldown when it is longer than the base retry", async () => {
    runBackgroundJob
      .mockRejectedValueOnce({ reason: "cooldown:120,000" })
      .mockResolvedValueOnce(undefined);

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000, { startupDelayMs: 0 });
    await vi.runAllTicks();

    await vi.advanceTimersByTimeAsync(119_999);
    expect(runBackgroundJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(runBackgroundJob).toHaveBeenCalledTimes(2);
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[RSS] poll retry scheduled in 120s after cooldown:120,000",
    );

    poller.stopRssPoller();
  });

  it("doubles repeated deferred retries up to the cap", async () => {
    runBackgroundJob
      .mockRejectedValueOnce({ reason: "high_memory_pressure" })
      .mockRejectedValueOnce({ reason: "high_memory_pressure" })
      .mockResolvedValueOnce(undefined);

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000, { startupDelayMs: 0 });
    await vi.runAllTicks();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runBackgroundJob).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(runBackgroundJob).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(runBackgroundJob).toHaveBeenCalledTimes(3);
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[RSS] poll retry scheduled in 60s after high_memory_pressure",
    );
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[RSS] poll retry scheduled in 120s after high_memory_pressure",
    );

    poller.stopRssPoller();
  });
});
