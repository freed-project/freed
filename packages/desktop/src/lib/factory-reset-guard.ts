import {
  captureFactoryResetWriteEpoch,
  isFactoryResetWriteAllowed,
  trackFactoryResetSensitiveOperation,
  waitForFactoryResetDrain,
} from "@freed/ui/lib/factory-reset";

const FACTORY_RESET_INTERRUPTED_MESSAGE = "Factory reset is in progress";
const handoffOperations = new Set<Promise<unknown>>();
let handoffPause: symbol | null = null;
const handoffPauseListeners = new Set<() => void>();

export function subscribeDesktopHandoffPause(listener: () => void): () => void {
  handoffPauseListeners.add(listener);
  return () => { handoffPauseListeners.delete(listener); };
}

export function isDesktopHandoffPaused(): boolean {
  return handoffPause !== null;
}

/** Pause new renderer work without invalidating accepted writes. The coordinator
 * must verify native cancellation or completed demotion before releasing it. */
export function pauseDesktopOperationsForHandoff(): {
  drain: (timeoutMs: number) => Promise<void>;
  resume: () => void;
} {
  if (handoffPause !== null) throw new Error("Library transfer already owns the renderer pause");
  const owner = Symbol("handoff");
  handoffPause = owner;
  for (const listener of handoffPauseListeners) listener();
  return {
    drain(timeoutMs) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return Promise.reject(new Error("Library transfer drain timeout must be positive"));
      }
      if (handoffPause !== owner) return Promise.reject(new Error("Library transfer pause is no longer owned"));
      return waitForFactoryResetDrain(() => [...handoffOperations], "Library capture and reader work", timeoutMs);
    },
    resume() {
      if (handoffPause === owner) {
        handoffPause = null;
        for (const listener of handoffPauseListeners) listener();
      }
    },
  };
}

/** Return true while a captured operation may still issue work or commit state. */
export function isFactoryResetEpochCurrent(epoch: number | null): epoch is number {
  return isFactoryResetWriteAllowed(epoch);
}

/** Stop a reset-sensitive operation before it issues more work or persists a response. */
export function assertFactoryResetEpoch(epoch: number | null): asserts epoch is number {
  if (!isFactoryResetEpochCurrent(epoch)) {
    throw new Error(FACTORY_RESET_INTERRUPTED_MESSAGE);
  }
}

/** Capture and synchronously register one operation with the shared factory-reset drain. */
export function runFactoryResetSensitiveDesktopOperation<T>(
  operation: (epoch: number) => Promise<T>,
): Promise<T> {
  if (handoffPause !== null) {
    return Promise.reject(new Error("Library transfer is pausing new capture and reader updates"));
  }
  const epoch = captureFactoryResetWriteEpoch();
  if (epoch === null) {
    return Promise.reject(new Error(FACTORY_RESET_INTERRUPTED_MESSAGE));
  }

  const operationPromise = trackFactoryResetSensitiveOperation(
    Promise.resolve().then(async () => {
      assertFactoryResetEpoch(epoch);
      return operation(epoch);
    }),
  );
  const tracked = operationPromise.finally(() => handoffOperations.delete(tracked));
  handoffOperations.add(tracked);
  return tracked;
}
