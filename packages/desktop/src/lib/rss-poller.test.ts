import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshScheduledRssFeeds = vi.fn(async () => {});
const addDebugEvent = vi.fn();
const runBackgroundJob = vi.fn(async (task: { run: () => Promise<unknown> }) => task.run());
const canStartBackgroundJob = vi.fn<
  () => { ok: true } | { ok: false; reason: string }
>(() => ({ ok: true }));
const claimRssSyncDue = vi.fn(() => ({
  intervalMs: 10_800_000,
  nextDueAt: 20_000_000,
  lastAttemptAt: 123,
}));
const deferRssSyncClaim = vi.fn(() => true);
const getRssSyncSchedule = vi.fn(() => ({ intervalMs: 10_800_000, nextDueAt: 20_000_000 }));
const setRssSyncInterval = vi.fn(() => true);
const settleRssSync = vi.fn(() => true);

vi.mock("./capture", () => ({ refreshScheduledRssFeeds }));
vi.mock("@freed/ui/lib/debug-store", () => ({ addDebugEvent }));
vi.mock("./rss-sync-schedule-state", () => ({
  claimRssSyncDue,
  deferRssSyncClaim,
  getRssSyncSchedule,
  setRssSyncInterval,
  settleRssSync,
}));
vi.mock("./background-runtime-coordinator", () => ({
  canStartBackgroundJob,
  runBackgroundJob,
  isBackgroundRuntimeDeferredError: (error: unknown) =>
    typeof error === "object" && error !== null && "reason" in error,
  formatBackgroundRuntimeDeferredReason: (reason: string) => reason,
}));

async function loadPoller() {
  vi.resetModules();
  return import("./rss-poller");
}

describe("RSS-only poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    canStartBackgroundJob.mockReturnValue({ ok: true });
    claimRssSyncDue.mockReturnValue({
      intervalMs: 10_800_000,
      nextDueAt: 20_000_000,
      lastAttemptAt: 123,
    });
  });

  it("restores the due RSS opportunity when coordination defers after claim", async () => {
    runBackgroundJob.mockRejectedValueOnce({ reason: "active:social-scrape" });
    const poller = await loadPoller();
    poller.startRssPoller(undefined, { startupDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);

    expect(deferRssSyncClaim).toHaveBeenCalledWith(123);
    expect(settleRssSync).not.toHaveBeenCalled();
    poller.stopRssPoller();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("claims one persisted due interval and calls only the RSS entrypoint", async () => {
    const poller = await loadPoller();
    poller.startRssPoller(undefined, { startupDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);

    expect(claimRssSyncDue).toHaveBeenCalledOnce();
    expect(runBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rss-poll", source: "rss-poller" }),
    );
    expect(refreshScheduledRssFeeds).toHaveBeenCalledWith({
      maxFeeds: 80,
      staleAfterMs: 3 * 60 * 60 * 1_000,
    });
    expect(settleRssSync).toHaveBeenCalledOnce();
    poller.stopRssPoller();
  });

  it("retains due state when local runtime work is ineligible", async () => {
    canStartBackgroundJob.mockReturnValue({
      ok: false as const,
      reason: "high_memory_pressure",
    });
    const poller = await loadPoller();
    poller.startRssPoller(undefined, { startupDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);

    expect(claimRssSyncDue).not.toHaveBeenCalled();
    expect(refreshScheduledRssFeeds).not.toHaveBeenCalled();
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      expect.stringContaining("poll retry scheduled"),
    );
    poller.stopRssPoller();
  });

  it("drains an already-issued RSS refresh before factory reset cleanup", async () => {
    let release!: () => void;
    refreshScheduledRssFeeds.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const poller = await loadPoller();
    poller.startRssPoller(undefined, { startupDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    const drained = vi.fn();
    const draining = poller.stopRssPollerAndDrain().then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();
    release();
    await draining;
    expect(drained).toHaveBeenCalledOnce();
  });
});
