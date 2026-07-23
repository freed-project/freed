import { describe, expect, it } from "vitest";
import { FactoryResetPhaseError } from "@freed/ui/lib/factory-reset";
import { getDesktopFactoryResetFailureRecovery } from "./factory-reset-recovery";

describe("Desktop factory reset failure recovery", () => {
  it("resumes the relay only when a known earlier phase failed", () => {
    expect(getDesktopFactoryResetFailureRecovery(
      new FactoryResetPhaseError("quiesce local writers", new Error("stop failed")),
      false,
    ).resumeRelay).toBe(true);
    expect(getDesktopFactoryResetFailureRecovery(
      new FactoryResetPhaseError("clear provider data and connections", new Error("logout failed")),
      true,
    ).resumeRelay).toBe(true);
  });

  it("leaves the relay paused when document cleanup is uncertain", () => {
    const recovery = getDesktopFactoryResetFailureRecovery(
      new FactoryResetPhaseError("clear document", new Error("worker stopped")),
      false,
    );

    expect(recovery.resumeRelay).toBe(false);
    expect(recovery.message).toContain("mobile sync paused");
    expect(recovery.message).toContain("cannot restore cleared data");
  });

  it("fails closed for an unclassified reset error", () => {
    const recovery = getDesktopFactoryResetFailureRecovery(new Error("unknown"), false);

    expect(recovery.resumeRelay).toBe(false);
    expect(recovery.message).not.toContain("restore background services");
  });
});
