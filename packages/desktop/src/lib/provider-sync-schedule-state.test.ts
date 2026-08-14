import { beforeEach, describe, expect, it } from "vitest";
import type { RandomSource } from "./provider-sync-cadence";
import {
  claimProviderSchedule,
  getProviderScheduleSnapshot,
  initializeProviderSchedules,
  listDueProviderSchedules,
  markProviderContactIssued,
  resetProviderCadenceDefaults,
  rescheduleProviderAfterExternalSettlement,
  setAutomaticProviderSyncEnabled,
  setProviderAutomaticPaused,
  settleProviderSchedule,
  updateProviderCadenceBounds,
} from "./provider-sync-schedule-state";

function random(): RandomSource {
  let value = 0;
  return {
    uniform: () => ((value++ % 97) + 0.5) / 97,
    id: () => `attempt-${value.toLocaleString("en-US", { useGrouping: false })}`,
  };
}

describe("provider sync schedule state", () => {
  beforeEach(() => localStorage.clear());

  it("isolates providers, migrates Meta due times, and never brings contact forward", () => {
    localStorage.setItem(
      "freed-device-meta-sync-schedule-v1",
      JSON.stringify({
        version: 1,
        providers: {
          facebook: {
            nextDueAt: 9_000_000,
            lastAttemptStartedAt: 2_000,
            inFlightAttemptId: "facebook:legacy-attempt",
            inFlightStartedAt: 2_000,
          },
          instagram: { nextDueAt: 8_000_000 },
        },
      }),
    );
    initializeProviderSchedules({ now: 1_000, random: random(), existingInstall: true });
    const facebook = getProviderScheduleSnapshot("facebook").record!;
    const instagram = getProviderScheduleSnapshot("instagram").record!;
    expect(facebook.nextDueAt).toBeGreaterThanOrEqual(9_000_000);
    expect(instagram.nextDueAt).toBeGreaterThanOrEqual(8_000_000);
    expect(facebook.migrationContext).toBe("meta_v1");
    expect(instagram.migrationContext).toBe("meta_v1");
    expect(facebook.bounds).not.toEqual(instagram.bounds);
    expect(facebook.phase).toBe("contacted");
    expect(facebook.attempt).toMatchObject({
      attemptId: "facebook:legacy-attempt",
      trigger: "migration",
      contactCount: 1,
    });
  });

  it("preserves malformed Meta v1 state and blocks only those provider migrations", () => {
    const raw = JSON.stringify({
      version: 1,
      providers: {
        facebook: { nextDueAt: "soon" },
        instagram: { nextDueAt: 8_000_000 },
      },
    });
    localStorage.setItem("freed-device-meta-sync-schedule-v1", raw);

    const result = initializeProviderSchedules({
      now: 1_000,
      random: random(),
      existingInstall: true,
    });

    expect(result.blocked).toContain("facebook");
    expect(result.initialized).toContain("instagram");
    expect(result.initialized).toContain("x");
    expect(localStorage.getItem("freed-device-meta-sync-schedule-v1")).toBe(raw);
    expect(getProviderScheduleSnapshot("facebook").status).toBe("missing");
  });

  it("distinguishes a fresh device from an existing-install migration explicitly", () => {
    localStorage.setItem("freed-release-channel", "production");
    initializeProviderSchedules({ now: 1_000, random: random(), existingInstall: false });
    const fresh = getProviderScheduleSnapshot("youtube").record!;
    expect(fresh.migrationContext).toBe("new_install");
    expect(fresh.activationAt).toBe(1_000);

    localStorage.clear();
    initializeProviderSchedules({ now: 1_000, random: random(), existingInstall: true });
    const migrated = getProviderScheduleSnapshot("youtube").record!;
    expect(migrated.migrationContext).toBe("existing_install");
    expect(migrated.activationAt).toBeGreaterThan(1_000);
    expect(migrated.activationAt).toBeLessThanOrEqual(1_000 + 24 * 60 * 60_000);
  });

  it("preserves corrupt provider state and fails closed only for that provider", () => {
    localStorage.setItem("freed-device-provider-sync-state-v2:facebook", "not-json");
    const result = initializeProviderSchedules({ now: 1_000, random: random() });
    expect(result.blocked).toContain("facebook");
    expect(result.initialized).toContain("instagram");
    expect(localStorage.getItem("freed-device-provider-sync-state-v2:facebook")).toBe("not-json");
  });

  it("persists claim and deadline before contact, then lengthens contacted failures", () => {
    initializeProviderSchedules({ now: 0, random: random() });
    expect(
      updateProviderCadenceBounds("facebook", {
        lowerMs: 5 * 60_000,
        upperMs: 10 * 60_000,
        source: "custom",
      }),
    ).toBe(true);
    const initial = getProviderScheduleSnapshot("facebook").record!;
    const claim = claimProviderSchedule({
      provider: "facebook",
      now: initial.nextDueAt + 1,
      random: random(),
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(claim.record.nextDueAt).toBeGreaterThan(claim.attempt.claimedAt);
    expect(claim.record.phase).toBe("claimed");
    expect(markProviderContactIssued({
      provider: "facebook",
      attemptId: claim.attempt.attemptId,
      now: claim.attempt.claimedAt + 100,
    })?.contactCount).toBe(1);
    expect(
      settleProviderSchedule({
        provider: "facebook",
        attemptId: claim.attempt.attemptId,
        now: claim.attempt.claimedAt + 200,
        random: random(),
        status: "error",
        stage: "rate_limit",
        retryAfterMs: 6 * 60 * 60_000,
      }),
    ).toBe(true);
    const settled = getProviderScheduleSnapshot("facebook").record!;
    expect(settled.phase).toBe("backoff");
    expect(settled.nextDueAt).toBeGreaterThanOrEqual(
      claim.attempt.claimedAt + 200 + 6 * 60 * 60_000,
    );
  });

  it("restores due state when local deferral happens before contact", () => {
    initializeProviderSchedules({ now: 0, random: random() });
    const initial = getProviderScheduleSnapshot("instagram").record!;
    const claim = claimProviderSchedule({
      provider: "instagram",
      now: initial.nextDueAt + 1,
      random: random(),
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    settleProviderSchedule({
      provider: "instagram",
      attemptId: claim.attempt.attemptId,
      now: claim.attempt.claimedAt + 20,
      random: random(),
      status: "deferred",
      stage: "memory_pressure",
    });
    const settled = getProviderScheduleSnapshot("instagram").record!;
    expect(settled.phase).toBe("locally_deferred");
    expect(settled.nextDueAt).toBe(claim.attempt.scheduledAt);
    expect(settled.consecutiveFailures).toBe(0);
  });

  it("supports kill switches and resamples manual settlement without immediate catch-up", () => {
    initializeProviderSchedules({ now: 0, random: random() });
    const before = getProviderScheduleSnapshot("youtube").record!;
    expect(setProviderAutomaticPaused("youtube", true)).toBe(true);
    expect(listDueProviderSchedules(before.nextDueAt + 1)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: "youtube" })]),
    );
    expect(setProviderAutomaticPaused("youtube", false)).toBe(true);
    expect(setAutomaticProviderSyncEnabled(false)).toBe(true);
    expect(listDueProviderSchedules(before.nextDueAt + 1)).toEqual([]);
    expect(setAutomaticProviderSyncEnabled(true)).toBe(true);
    expect(
      rescheduleProviderAfterExternalSettlement({
        provider: "youtube",
        now: before.nextDueAt + 1,
        random: random(),
      }),
    ).toBe(true);
    expect(getProviderScheduleSnapshot("youtube").record!.nextDueAt).toBeGreaterThan(
      before.nextDueAt + 1,
    );
  });

  it("resets generated cadence and pace without bringing the persisted deadline forward", () => {
    initializeProviderSchedules({ now: 0, random: random() });
    const initial = getProviderScheduleSnapshot("medium").record!;
    const claim = claimProviderSchedule({
      provider: "medium",
      now: initial.nextDueAt + 1,
      random: random(),
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(
      settleProviderSchedule({
        provider: "medium",
        attemptId: claim.attempt.attemptId,
        now: claim.attempt.claimedAt + 1,
        random: random(),
        status: "empty",
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    ).toBe(true);
    const slowed = getProviderScheduleSnapshot("medium").record!;
    expect(slowed.yieldFactor).toBeGreaterThan(1);

    expect(
      resetProviderCadenceDefaults("medium", {
        now: slowed.lastAttemptFinishedAt! + 1,
        random: random(),
      }),
    ).toBe(true);
    const reset = getProviderScheduleSnapshot("medium").record!;
    expect(reset.bounds.source).toBe("generated");
    expect(reset.yieldFactor).toBe(1);
    expect(reset.consecutiveFailures).toBe(0);
    expect(reset.nextDueAt).toBeGreaterThanOrEqual(slowed.nextDueAt);
  });

  it("rotates an expired regime only after settlement and reconnect clears auth block", () => {
    initializeProviderSchedules({ now: 0, random: random() });
    const initial = getProviderScheduleSnapshot("linkedin").record!;
    const claimAt = Math.max(initial.nextDueAt + 1, initial.regime.expiresAt + 1);
    const claim = claimProviderSchedule({
      provider: "linkedin",
      now: claimAt,
      random: random(),
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(claim.record.regime).toEqual(initial.regime);
    markProviderContactIssued({
      provider: "linkedin",
      attemptId: claim.attempt.attemptId,
      now: claimAt + 1,
    });
    expect(
      settleProviderSchedule({
        provider: "linkedin",
        attemptId: claim.attempt.attemptId,
        now: claimAt + 2,
        random: random(),
        status: "error",
        stage: "auth",
        authBlocked: true,
      }),
    ).toBe(true);
    const blocked = getProviderScheduleSnapshot("linkedin").record!;
    expect(blocked.phase).toBe("blocked");
    expect(blocked.regime.startedAt).toBe(initial.regime.startedAt);

    expect(
      rescheduleProviderAfterExternalSettlement({
        provider: "linkedin",
        now: claimAt + 3,
        random: random(),
        unblockAuth: true,
      }),
    ).toBe(true);
    const reconnected = getProviderScheduleSnapshot("linkedin").record!;
    expect(reconnected.phase).toBe("waiting");
    expect(reconnected.blockedReason).toBeUndefined();
    expect(reconnected.regime.startedAt).toBe(claimAt + 3);
  });
});
