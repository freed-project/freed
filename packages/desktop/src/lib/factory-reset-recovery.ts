import { FactoryResetPhaseError } from "@freed/ui/lib/factory-reset";

export interface DesktopFactoryResetFailureRecovery {
  readonly resumeRelay: boolean;
  readonly message: string;
}

export function getDesktopFactoryResetFailureRecovery(
  error: unknown,
  cloudCleanupPaused: boolean,
): DesktopFactoryResetFailureRecovery {
  const failedPhase = error instanceof FactoryResetPhaseError
    ? error.phase
    : null;
  const resumeRelay = failedPhase !== null && failedPhase !== "clear document";

  if (failedPhase === "clear provider data and connections") {
    return {
      resumeRelay,
      message: "Factory reset stopped because account cleanup did not finish. Freed will reload with cloud sync paused so you can retry safely.",
    };
  }
  if (failedPhase === "clear document") {
    return {
      resumeRelay,
      message: "Factory reset stopped while clearing the library. Freed will reload with mobile sync paused so an older device cannot restore cleared data. Retry reset after reload.",
    };
  }
  if (cloudCleanupPaused) {
    return {
      resumeRelay,
      message: "Factory reset stopped before cleanup finished. Freed will reload with cloud sync paused so you can retry safely.",
    };
  }
  return {
    resumeRelay,
    message: "Factory reset stopped because Freed could not finish local cleanup. Freed will reload so you can retry safely.",
  };
}
