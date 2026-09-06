import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckpointPublicationDeadline } from "./checkpoint-publication-deadline";

describe("checkpoint publication deadlines", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps unknown preflight bounded and disposes timers", async () => {
    const expire = vi.fn();
    const deadline = createCheckpointPublicationDeadline(expire);
    deadline.advanceRecords(1);
    deadline.verifiedObject("not-a-checkpoint");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(expire).toHaveBeenCalledExactlyOnceWith("total");
    deadline.beginCheckpoint(2_700_001);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("permits useful progress beyond five minutes but rejects duplicate milestones", async () => {
    const expire = vi.fn();
    const deadline = createCheckpointPublicationDeadline(expire);
    deadline.beginCheckpoint(2_700_001);
    await vi.advanceTimersByTimeAsync(240_000);
    deadline.advanceRecords(4096);
    await vi.advanceTimersByTimeAsync(240_000);
    deadline.verifiedObject("page-1");
    await vi.advanceTimersByTimeAsync(240_000);
    deadline.advanceRecords(4096);
    deadline.advanceRecords(0);
    deadline.advanceRecords(NaN);
    deadline.advanceRecords(2_700_002);
    deadline.verifiedObject("page-1");
    deadline.beginCheckpoint(33_000_000);
    expect(expire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expire).toHaveBeenCalledExactlyOnceWith("stalled");
    expect(vi.getTimerCount()).toBe(0);
    expect(deadline.diagnostics()).toEqual({
      elapsedMs: 780_000,
      idleMs: 300_000,
      expectedRecords: 2_700_001,
      advancedRecords: 4096,
      verifiedObjects: 1,
    });
  });

  it("anchors the size budget to attempt start and never extends it on progress", async () => {
    const expire = vi.fn();
    const deadline = createCheckpointPublicationDeadline(expire);
    await vi.advanceTimersByTimeAsync(200_000);
    deadline.beginCheckpoint(4096);
    await vi.advanceTimersByTimeAsync(100_000);
    deadline.advanceRecords(4096);
    deadline.beginCheckpoint(2_700_001);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(expire).toHaveBeenCalledExactlyOnceWith("total");
  });

  it("caps even continuously progressing large checkpoints at two hours", async () => {
    const expire = vi.fn();
    const deadline = createCheckpointPublicationDeadline(expire);
    deadline.beginCheckpoint(33_554_432);
    for (let index = 1; index <= 29; index += 1) {
      await vi.advanceTimersByTimeAsync(240_000);
      deadline.advanceRecords(index);
    }
    await vi.advanceTimersByTimeAsync(240_000);
    expect(expire).toHaveBeenCalledExactlyOnceWith("total");
  });

  it("does not revive canceled or completed attempts", async () => {
    const expire = vi.fn();
    const deadline = createCheckpointPublicationDeadline(expire);
    expect(() => deadline.beginCheckpoint(-1)).toThrow("Invalid checkpoint");
    deadline.beginCheckpoint(2_700_001);
    deadline.dispose();
    deadline.advanceRecords(4096);
    deadline.verifiedObject("page-1");
    await vi.advanceTimersByTimeAsync(7_200_000);
    expect(expire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not accept late progress while a busy JS turn delays timer delivery", () => {
    const expire = vi.fn();
    const deadline = createCheckpointPublicationDeadline(expire);
    deadline.beginCheckpoint(2_700_001);
    const now = performance.now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(now + 300_001);
    deadline.advanceRecords(4096);
    expect(expire).toHaveBeenCalledExactlyOnceWith("stalled");
    clock.mockRestore();
  });
});
