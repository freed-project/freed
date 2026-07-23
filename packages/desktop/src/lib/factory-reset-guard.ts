import {
  captureFactoryResetWriteEpoch,
  isFactoryResetWriteAllowed,
  trackFactoryResetSensitiveOperation,
} from "@freed/ui/lib/factory-reset";

const FACTORY_RESET_INTERRUPTED_MESSAGE = "Factory reset is in progress";

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
  const epoch = captureFactoryResetWriteEpoch();
  if (epoch === null) {
    return Promise.reject(new Error(FACTORY_RESET_INTERRUPTED_MESSAGE));
  }

  return trackFactoryResetSensitiveOperation(
    Promise.resolve().then(async () => {
      assertFactoryResetEpoch(epoch);
      return operation(epoch);
    }),
  );
}
