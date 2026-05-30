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

  it("retries a deferred startup poll before the normal interval", async () => {
    const deferredError = { reason: "waiting_for_renderer_heartbeat:1" };
    runBackgroundJob
      .mockRejectedValueOnce(deferredError)
      .mockResolvedValueOnce(undefined);

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000);

    await vi.runAllTicks();
    expect(runBackgroundJob).toHaveBeenCalledTimes(1);
    expect(runBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "rss-poll",
        run: refreshRssFeeds,
      }),
    );

    await vi.advanceTimersByTimeAsync(14_999);
    expect(runBackgroundJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(runBackgroundJob).toHaveBeenCalledTimes(2);
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[RSS] poll deferred: waiting_for_renderer_heartbeat:1",
    );

    poller.stopRssPoller();
  });

  it("clears a deferred retry when the poller stops", async () => {
    runBackgroundJob.mockRejectedValueOnce({ reason: "cooldown:120000" });

    const poller = await loadPoller();
    poller.startRssPoller(30 * 60 * 1000);
    await vi.runAllTicks();

    poller.stopRssPoller();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(runBackgroundJob).toHaveBeenCalledTimes(1);
  });
});
