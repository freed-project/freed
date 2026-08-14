import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addDebugEvent: vi.fn(),
  canStartBackgroundJob: vi.fn(() => ({ ok: true as const })),
  refreshSocialProvider: vi.fn(),
  recordMetaSyncScheduleAttempt: vi.fn(),
  recordMetaSyncScheduleOutcome: vi.fn(),
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: mocks.addDebugEvent,
}));

vi.mock("./capture", () => ({
  refreshSocialProvider: mocks.refreshSocialProvider,
}));

vi.mock("./background-runtime-coordinator", () => ({
  canStartBackgroundJob: mocks.canStartBackgroundJob,
}));

vi.mock("./runtime-health-events", () => ({
  recordMetaSyncScheduleAttempt: mocks.recordMetaSyncScheduleAttempt,
  recordMetaSyncScheduleOutcome: mocks.recordMetaSyncScheduleOutcome,
}));

describe("Meta sync scheduler", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    window.localStorage.clear();
    mocks.addDebugEvent.mockReset();
    mocks.canStartBackgroundJob.mockReset();
    mocks.canStartBackgroundJob.mockReturnValue({ ok: true });
    mocks.refreshSocialProvider.mockReset();
    mocks.refreshSocialProvider.mockImplementation(
      async (provider: string) => ({
        provider,
        status: "success",
        postsExtracted: 1,
        itemsAdded: 1,
      }),
    );
    mocks.recordMetaSyncScheduleOutcome.mockReset();
    mocks.recordMetaSyncScheduleAttempt.mockReset();
    const state = await import("./meta-sync-schedule-state");
    state.resetMetaSyncScheduleStateForTests();
    const scheduler = await import("./meta-sync-scheduler");
    scheduler.resetMetaSyncSchedulerForTests();
  });

  afterEach(async () => {
    const scheduler = await import("./meta-sync-scheduler");
    scheduler.resetMetaSyncSchedulerForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("runs one serialized attempt per due provider and preserves the interval", async () => {
    const scheduler = await import("./meta-sync-scheduler");
    scheduler.startMetaSyncScheduler({
      providerIntervalMs: 30_000,
      schedulerTickMs: 1_000,
      startupDelayMs: 0,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.refreshSocialProvider).toHaveBeenCalledTimes(2);
    expect(
      mocks.refreshSocialProvider.mock.calls.map(([provider]) => provider),
    ).toEqual(["facebook", "instagram"]);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.refreshSocialProvider).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.refreshSocialProvider).toHaveBeenCalledTimes(4);
    expect(mocks.recordMetaSyncScheduleOutcome).toHaveBeenCalledTimes(4);
    expect(mocks.recordMetaSyncScheduleAttempt).toHaveBeenCalledTimes(4);
  });

  it("does not overlap ticks while a provider is still settling", async () => {
    let release!: () => void;
    mocks.refreshSocialProvider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ provider: "facebook", status: "success" });
        }),
    );
    const scheduler = await import("./meta-sync-scheduler");
    scheduler.startMetaSyncScheduler({
      providerIntervalMs: 30_000,
      schedulerTickMs: 1_000,
      startupDelayMs: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.refreshSocialProvider).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.refreshSocialProvider).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.refreshSocialProvider).toHaveBeenCalledTimes(2);
  });

  it("keeps an overdue attempt unclaimed while local runtime work is active", async () => {
    mocks.canStartBackgroundJob.mockReturnValue({
      ok: false,
      reason: "active:rss-poll:rss-poller",
    });
    const scheduler = await import("./meta-sync-scheduler");
    scheduler.startMetaSyncScheduler({
      providerIntervalMs: 30_000,
      schedulerTickMs: 1_000,
      startupDelayMs: 0,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.refreshSocialProvider).not.toHaveBeenCalled();
    expect(mocks.recordMetaSyncScheduleAttempt).not.toHaveBeenCalled();

    mocks.canStartBackgroundJob.mockReturnValue({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.refreshSocialProvider).toHaveBeenCalledTimes(2);
    expect(mocks.recordMetaSyncScheduleAttempt).toHaveBeenCalledTimes(2);
  });
});
