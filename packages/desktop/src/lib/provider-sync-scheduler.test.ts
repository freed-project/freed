import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderScheduleRecord } from "./provider-sync-schedule-state";

const runScheduledProviderAdapter = vi.fn();
const canStartBackgroundJob = vi.fn();
const initializeProviderSchedules = vi.fn();
const listDueProviderSchedules = vi.fn();
const getProviderScheduleSnapshot = vi.fn();
const claimProviderSchedule = vi.fn();
const deferProviderScheduleLocally = vi.fn();
const markProviderContactIssued = vi.fn();
const settleProviderSchedule = vi.fn();
const recordProviderScheduleEvent = vi.fn();

const record: ProviderScheduleRecord = {
  provider: "facebook",
  phase: "waiting",
  bounds: { lowerMs: 1_800_000, upperMs: 10_800_000, source: "generated" },
  automaticPaused: false,
  nextDueAt: 1_000,
  activationAt: 0,
  regime: { multiplier: 1, startedAt: 0, expiresAt: 200_000_000 },
  yieldFactor: 1,
  consecutiveFailures: 0,
  previousBackoffMs: 0,
  migrationContext: "new_install",
};

vi.mock("./provider-sync-adapters", () => ({ runScheduledProviderAdapter }));
vi.mock("./background-runtime-coordinator", () => ({
  canStartBackgroundJob,
  isBackgroundRuntimeDeferredError: () => false,
}));
vi.mock("./provider-sync-schedule-state", () => ({
  initializeProviderSchedules,
  listDueProviderSchedules,
  getProviderScheduleSnapshot,
  claimProviderSchedule,
  deferProviderScheduleLocally,
  markProviderContactIssued,
  settleProviderSchedule,
}));
vi.mock("./runtime-health-events", () => ({ recordProviderScheduleEvent }));
vi.mock("@freed/ui/lib/debug-store", () => ({ addDebugEvent: vi.fn() }));

async function loadScheduler() {
  vi.resetModules();
  return import("./provider-sync-scheduler");
}

describe("provider sync scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    initializeProviderSchedules.mockReturnValue({ initialized: [], blocked: [] });
    listDueProviderSchedules.mockReturnValue([
      { provider: "facebook", dueAt: 1_000, dueAgeMs: 9_000, normalizedOverdue: 2 },
      { provider: "instagram", dueAt: 1_000, dueAgeMs: 9_000, normalizedOverdue: 1 },
    ]);
    getProviderScheduleSnapshot.mockReturnValue({ status: "supported", record });
    canStartBackgroundJob.mockReturnValue({ ok: true });
    claimProviderSchedule.mockReturnValue({
      status: "claimed",
      record: { ...record, phase: "claimed", nextDueAt: 4_000_000 },
      attempt: {
        attemptId: "facebook:attempt",
        trigger: "scheduled",
        scheduledAt: 1_000,
        claimedAt: 10_000,
        leaseUntil: 910_000,
        contactCount: 0,
      },
      dueAgeMs: 9_000,
    });
    runScheduledProviderAdapter.mockImplementation(
      async (_provider: string, onProviderContact: () => void) => {
        onProviderContact();
        return {
          provider: "facebook",
          status: "success",
          postsExtracted: 3,
          itemsAdded: 2,
        };
      },
    );
    markProviderContactIssued.mockReturnValue({ contactCount: 1 });
    settleProviderSchedule.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("runs only the most overdue provider and never drains every due provider", async () => {
    const scheduler = await loadScheduler();
    scheduler.startProviderSyncScheduler({
      tickMs: 60_000,
      now: () => 10_000,
      random: { uniform: () => 0.5, id: () => "attempt" },
    });
    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();

    expect(runScheduledProviderAdapter).toHaveBeenCalledOnce();
    expect(initializeProviderSchedules).toHaveBeenCalledWith({
      now: 10_000,
      random: expect.any(Object),
      existingInstall: false,
    });
    expect(runScheduledProviderAdapter).toHaveBeenCalledWith(
      "facebook",
      expect.any(Function),
    );
    expect(markProviderContactIssued).toHaveBeenCalledOnce();
    expect(claimProviderSchedule).toHaveBeenCalledOnce();
    expect(deferProviderScheduleLocally).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "instagram",
        category: "provider_collision",
      }),
    );
    scheduler.stopProviderSyncScheduler();
  });

  it("passes the existing-install migration decision into initialization", async () => {
    listDueProviderSchedules.mockReturnValue([]);
    const scheduler = await loadScheduler();
    scheduler.startProviderSyncScheduler({
      existingInstall: true,
      now: () => 10_000,
      random: { uniform: () => 0.5, id: () => "attempt" },
    });
    await vi.runAllTicks();

    expect(initializeProviderSchedules).toHaveBeenCalledWith({
      now: 10_000,
      random: expect.any(Object),
      existingInstall: true,
    });
    scheduler.stopProviderSyncScheduler();
  });

  it("records local deferral without claiming or contacting a provider", async () => {
    canStartBackgroundJob.mockReturnValue({
      ok: false,
      reason: "active:rss-poll:rss-poller",
    });
    const scheduler = await loadScheduler();
    scheduler.startProviderSyncScheduler({
      now: () => 10_000,
      random: { uniform: () => 0.5, id: () => "attempt" },
    });
    await vi.runAllTicks();

    expect(deferProviderScheduleLocally).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "facebook",
        category: "active:rss-poll:rss-poller",
      }),
    );
    expect(claimProviderSchedule).not.toHaveBeenCalled();
    expect(runScheduledProviderAdapter).not.toHaveBeenCalled();
    scheduler.stopProviderSyncScheduler();
  });
});
