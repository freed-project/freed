import { afterEach, describe, expect, it, vi } from "vitest";
import { beginFactoryResetBoundary, resetFactoryResetStateForTests } from "@freed/ui/lib/factory-reset";
import { assertFactoryResetEpoch, pauseDesktopOperationsForHandoff, runFactoryResetSensitiveDesktopOperation } from "./factory-reset-guard";

afterEach(() => {
  resetFactoryResetStateForTests();
  vi.useRealTimers();
});

describe("handoff renderer work ownership", () => {
  it("registers accepted work before yielding, preserves its write epoch and rejects new work", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const persisted = vi.fn();
    const accepted = runFactoryResetSensitiveDesktopOperation(async (epoch) => {
      await pending;
      assertFactoryResetEpoch(epoch);
      persisted();
    });
    const pause = pauseDesktopOperationsForHandoff();
    try {
      expect(() => pauseDesktopOperationsForHandoff()).toThrow("already owns");
      const newWork = vi.fn(async () => undefined);
      await expect(runFactoryResetSensitiveDesktopOperation(newWork)).rejects.toThrow("pausing");
      expect(newWork).not.toHaveBeenCalled();
      const drained = vi.fn();
      const draining = pause.drain(1_000).then(drained);
      await Promise.resolve();
      expect(drained).not.toHaveBeenCalled();
      finish();
      await accepted;
      await draining;
      expect(persisted).toHaveBeenCalledOnce();
    } finally { pause.resume(); }
    await expect(runFactoryResetSensitiveDesktopOperation(async () => "resumed")).resolves.toBe("resumed");
    const next = pauseDesktopOperationsForHandoff();
    try {
      pause.resume();
      await expect(runFactoryResetSensitiveDesktopOperation(async () => undefined)).rejects.toThrow("pausing");
    } finally { next.resume(); }
  });

  it("keeps the pause after a drain deadline and can finish the same accepted work later", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const accepted = runFactoryResetSensitiveDesktopOperation(() => pending);
    const pause = pauseDesktopOperationsForHandoff();
    try {
      const expired = expect(pause.drain(10)).rejects.toThrow("did not stop");
      await vi.advanceTimersByTimeAsync(10);
      await expired;
      await expect(runFactoryResetSensitiveDesktopOperation(async () => undefined)).rejects.toThrow("pausing");
      finish();
      await accepted;
      await pause.drain(10);
    } finally { pause.resume(); }
    await expect(pause.drain(10)).rejects.toThrow("no longer owned");
  });

  it("does not undo a real factory reset's write fence when the handoff pause resumes", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const accepted = runFactoryResetSensitiveDesktopOperation(async (epoch) => {
      await pending;
      assertFactoryResetEpoch(epoch);
    });
    await Promise.resolve();
    const pause = pauseDesktopOperationsForHandoff();
    try {
      beginFactoryResetBoundary();
      finish();
      await expect(accepted).rejects.toThrow("Factory reset");
      await pause.drain(1_000);
    } finally { pause.resume(); }
    await expect(runFactoryResetSensitiveDesktopOperation(async () => undefined)).rejects.toThrow("Factory reset");
  });
});
