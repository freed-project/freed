export interface FactoryResetOperations {
  quiesceLocalWriters: readonly (() => Promise<void>)[];
  clearDeviceStores: () => readonly boolean[] | Promise<readonly boolean[]>;
  clearLocalSettings: readonly (() => void | Promise<void>)[];
  clearLocalData: readonly (() => Promise<void>)[];
  clearProviderDataAndConnections: () => Promise<void>;
  clearDocument: () => Promise<void>;
  phaseTimeoutMs?: number;
}

export interface FactoryResetRecoveryOptions {
  reset: () => Promise<void>;
  reload: () => void;
  onFailure: (error: unknown) => void;
  recoveryDelayMs?: number;
}

export const DEFAULT_FACTORY_RESET_PHASE_TIMEOUT_MS = 15_000;

let factoryResetEpoch = 0;
let factoryResetStarted = false;
const pendingFactoryResetSensitiveOperations = new Set<Promise<unknown>>();

/** Capture permission for an operation that may write device-local data. */
export function captureFactoryResetWriteEpoch(): number | null {
  return factoryResetStarted ? null : factoryResetEpoch;
}

/** Return true only while a captured operation may still commit local data. */
export function isFactoryResetWriteAllowed(epoch: number | null): epoch is number {
  return epoch !== null && !factoryResetStarted && epoch === factoryResetEpoch;
}

/** True from the first reset phase until the page or app process reloads. */
export function isFactoryResetInProgress(): boolean {
  return factoryResetStarted;
}

/** Register work that reset must drain before deleting local data. */
export function trackFactoryResetSensitiveOperation<T>(operation: Promise<T>): Promise<T> {
  const tracked = operation.finally(() => {
    pendingFactoryResetSensitiveOperations.delete(tracked);
  });
  pendingFactoryResetSensitiveOperations.add(tracked);
  return tracked;
}

function beginFactoryReset(): void {
  if (factoryResetStarted) return;
  factoryResetEpoch += 1;
  factoryResetStarted = true;
}

/** Reset module state between isolated unit tests. Never call this in product code. */
export function resetFactoryResetStateForTests(): void {
  factoryResetEpoch += 1;
  factoryResetStarted = false;
  pendingFactoryResetSensitiveOperations.clear();
}

function throwFirstFailure(failures: readonly unknown[]): void {
  if (failures.length === 0) return;
  const first = failures[0];
  throw first instanceof Error ? first : new Error(String(first));
}

async function runFactoryResetPhase<T>(
  label: string,
  timeoutMs: number,
  operation: () => Promise<T> | T,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `Factory reset phase "${label}" did not finish within ${timeoutMs.toLocaleString()} ms.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

/** Wait for already-started local work without letting a hung job hang reset forever. */
export async function waitForFactoryResetDrain(
  getPending: () => readonly Promise<unknown>[],
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const pending = getPending();
    if (pending.length === 0) return;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`${label} did not stop within ${timeoutMs.toLocaleString()} ms.`);
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const results = await Promise.race([
        Promise.allSettled(pending),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `${label} did not stop within ${timeoutMs.toLocaleString()} ms.`,
              ),
            );
          }, remainingMs);
        }),
      ]);
      throwFirstFailure(
        results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason),
      );
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Run the shared destructive reset sequence for Freed Desktop and the PWA.
 * Local writers drain before any device store, provider, or document deletion begins.
 */
export async function runFactoryResetOperations(
  operations: FactoryResetOperations,
): Promise<void> {
  const phaseTimeoutMs = operations.phaseTimeoutMs ?? DEFAULT_FACTORY_RESET_PHASE_TIMEOUT_MS;
  if (!Number.isFinite(phaseTimeoutMs) || phaseTimeoutMs <= 0) {
    throw new Error("Factory reset phase timeout must be greater than zero.");
  }

  beginFactoryReset();

  await runFactoryResetPhase("quiesce local writers", phaseTimeoutMs, async () => {
    const quiesceResults = await Promise.allSettled([
      waitForFactoryResetDrain(
        () => [...pendingFactoryResetSensitiveOperations],
        "Device-local cache work",
        phaseTimeoutMs,
      ),
      ...operations.quiesceLocalWriters.map((quiesce) => quiesce()),
    ]);
    throwFirstFailure(
      quiesceResults
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason),
    );
  });

  await runFactoryResetPhase("clear device stores", phaseTimeoutMs, async () => {
    const deviceStoreResults = await operations.clearDeviceStores();
    if (deviceStoreResults.some((result) => result === false)) {
      throw new Error("One or more device stores could not be cleared.");
    }
  });

  await runFactoryResetPhase("clear local settings", phaseTimeoutMs, async () => {
    const localSettingResults = await Promise.allSettled(
      operations.clearLocalSettings.map((clearLocalSetting) =>
        Promise.resolve().then(clearLocalSetting),
      ),
    );
    throwFirstFailure(
      localSettingResults
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason),
    );
  });

  await runFactoryResetPhase("clear local data", phaseTimeoutMs, async () => {
    const localDataResults = await Promise.allSettled(
      operations.clearLocalData.map((clearLocalData) => clearLocalData()),
    );
    throwFirstFailure(
      localDataResults
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason),
    );
  });

  await runFactoryResetPhase(
    "clear provider data and connections",
    phaseTimeoutMs,
    operations.clearProviderDataAndConnections,
  );
  await runFactoryResetPhase("clear document", phaseTimeoutMs, operations.clearDocument);
}

/**
 * Reload after a successful reset, or shortly after reporting an aborted reset
 * so runtime services cannot remain stopped for the rest of the session.
 */
export async function runFactoryResetWithRecovery({
  reset,
  reload,
  onFailure,
  recoveryDelayMs = 1_500,
}: FactoryResetRecoveryOptions): Promise<void> {
  try {
    await reset();
    reload();
  } catch (error) {
    onFailure(error);
    setTimeout(reload, recoveryDelayMs);
    throw error;
  }
}
