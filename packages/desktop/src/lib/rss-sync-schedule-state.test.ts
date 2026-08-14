import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RSS_SYNC_INTERVAL_MS,
  claimRssSyncDue,
  deferRssSyncClaim,
  getRssSyncSchedule,
  setRssSyncInterval,
  settleRssSync,
} from "./rss-sync-schedule-state";

describe("RSS sync schedule state", () => {
  beforeEach(() => localStorage.clear());

  it("initializes one fixed three-hour interval and coalesces overdue work", () => {
    const initialized = getRssSyncSchedule(1_000)!;
    expect(initialized.intervalMs).toBe(DEFAULT_RSS_SYNC_INTERVAL_MS);
    expect(initialized.nextDueAt).toBe(1_000 + DEFAULT_RSS_SYNC_INTERVAL_MS);

    const claimed = claimRssSyncDue(initialized.nextDueAt + 24 * 60 * 60 * 1_000)!;
    expect(claimed.lastAttemptAt).toBe(initialized.nextDueAt + 24 * 60 * 60 * 1_000);
    expect(claimed.nextDueAt).toBe(claimed.lastAttemptAt! + DEFAULT_RSS_SYNC_INTERVAL_MS);
    expect(claimRssSyncDue(claimed.lastAttemptAt! + 1)).toBeNull();
  });

  it("keeps RSS due when local coordination defers before refresh", () => {
    const initialized = getRssSyncSchedule(1_000)!;
    const claimedAt = initialized.nextDueAt + 1;
    const claimed = claimRssSyncDue(claimedAt)!;
    expect(claimed.nextDueAt).toBeGreaterThan(claimedAt);

    expect(deferRssSyncClaim(claimedAt)).toBe(true);
    expect(getRssSyncSchedule(claimedAt)!.nextDueAt).toBe(claimedAt);
  });

  it("validates interval bounds and never brings an existing deadline forward", () => {
    const initialized = getRssSyncSchedule(1_000)!;
    expect(setRssSyncInterval(4 * 60_000, 2_000)).toBe(false);
    expect(setRssSyncInterval(25 * 60 * 60_000, 2_000)).toBe(false);
    expect(setRssSyncInterval(4 * 60 * 60_000, 2_000)).toBe(true);
    expect(getRssSyncSchedule(2_000)!.nextDueAt).toBeGreaterThanOrEqual(
      initialized.nextDueAt,
    );
  });

  it("preserves corrupt state and fails closed", () => {
    localStorage.setItem("freed-device-rss-sync-schedule-v1", "corrupt");
    expect(getRssSyncSchedule(1_000)).toBeNull();
    expect(setRssSyncInterval(DEFAULT_RSS_SYNC_INTERVAL_MS, 1_000)).toBe(false);
    expect(settleRssSync(1_000)).toBe(false);
    expect(localStorage.getItem("freed-device-rss-sync-schedule-v1")).toBe("corrupt");
  });
});
