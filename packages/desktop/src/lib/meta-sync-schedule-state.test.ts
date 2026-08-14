import { beforeEach, describe, expect, it } from "vitest";
import {
  claimMetaSyncScheduleAttempt,
  ensureMetaSyncSchedules,
  resetMetaSyncScheduleStateForTests,
  settleMetaSyncScheduleAttempt,
} from "./meta-sync-schedule-state";

describe("Meta sync schedule state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMetaSyncScheduleStateForTests();
  });

  it("coalesces missed intervals into one persisted attempt", () => {
    expect(ensureMetaSyncSchedules(1_000)).toBe(true);

    const claim = claimMetaSyncScheduleAttempt({
      provider: "facebook",
      attemptId: "facebook:one",
      now: 91_000,
      intervalMs: 30_000,
      inFlightLeaseMs: 60_000,
    });

    expect(claim).toEqual({
      status: "claimed",
      attemptId: "facebook:one",
      overdueMs: 90_000,
      coalescedIntervals: 3,
    });
    expect(
      settleMetaSyncScheduleAttempt({
        provider: "facebook",
        attemptId: "facebook:one",
        finishedAt: 92_000,
        outcome: "success",
      }),
    ).toBe(true);
    expect(
      claimMetaSyncScheduleAttempt({
        provider: "facebook",
        attemptId: "facebook:too-early",
        now: 120_999,
        intervalMs: 30_000,
        inFlightLeaseMs: 60_000,
      }),
    ).toEqual({ status: "not_due", nextDueAt: 121_000 });
  });

  it("keeps another provider behind a persisted in-flight lease", () => {
    expect(ensureMetaSyncSchedules(1_000)).toBe(true);
    expect(
      claimMetaSyncScheduleAttempt({
        provider: "instagram",
        attemptId: "instagram:one",
        now: 1_000,
        intervalMs: 30_000,
        inFlightLeaseMs: 60_000,
      }).status,
    ).toBe("claimed");

    expect(
      claimMetaSyncScheduleAttempt({
        provider: "facebook",
        attemptId: "facebook:blocked",
        now: 20_000,
        intervalMs: 30_000,
        inFlightLeaseMs: 60_000,
      }),
    ).toMatchObject({ status: "busy" });
  });

  it("recovers an abandoned renderer attempt only after its lease expires", () => {
    expect(ensureMetaSyncSchedules(1_000)).toBe(true);
    expect(
      claimMetaSyncScheduleAttempt({
        provider: "instagram",
        attemptId: "instagram:abandoned",
        now: 1_000,
        intervalMs: 30_000,
        inFlightLeaseMs: 60_000,
      }).status,
    ).toBe("claimed");

    resetMetaSyncScheduleStateForTests();
    const recovered = claimMetaSyncScheduleAttempt({
      provider: "facebook",
      attemptId: "facebook:after-restart",
      now: 61_001,
      intervalMs: 30_000,
      inFlightLeaseMs: 60_000,
    });
    expect(recovered).toMatchObject({ status: "claimed" });
  });

  it("fails closed when the persisted ledger is malformed", () => {
    window.localStorage.setItem(
      "freed-device-meta-sync-schedule-v1",
      JSON.stringify({
        version: 1,
        providers: {
          facebook: { nextDueAt: "soon" },
        },
      }),
    );
    resetMetaSyncScheduleStateForTests();

    expect(
      claimMetaSyncScheduleAttempt({
        provider: "facebook",
        attemptId: "facebook:blocked",
        now: 1_000,
        intervalMs: 30_000,
        inFlightLeaseMs: 60_000,
      }),
    ).toEqual({ status: "storage_blocked" });
  });
});
