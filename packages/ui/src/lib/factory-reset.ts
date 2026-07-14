export interface FactoryResetOperations {
  quiesceLocalWriters: readonly (() => Promise<void>)[];
  clearDeviceStores: () => readonly boolean[] | Promise<readonly boolean[]>;
  clearLocalSettings: readonly (() => void | Promise<void>)[];
  clearLocalData: readonly (() => Promise<void>)[];
  clearProviderDataAndConnections: () => Promise<void>;
  clearDocument: () => Promise<void>;
  phaseTimeoutMs?: number;
  trackedWorkDrainTimeoutMs?: number;
}

export interface FactoryResetRecoveryOptions {
  reset: () => Promise<void>;
  reload: () => void;
  onFailure: (error: unknown) => void;
  recoveryDelayMs?: number;
}

export type FactoryResetPhase =
  | "quiesce local writers"
  | "clear device stores"
  | "clear local settings"
  | "clear local data"
  | "clear provider data and connections"
  | "clear document";

export class FactoryResetPhaseError extends Error {
  readonly phase: FactoryResetPhase;
  readonly originalError: unknown;

  constructor(phase: FactoryResetPhase, error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "FactoryResetPhaseError";
    this.phase = phase;
    this.originalError = error;
  }
}

export interface ClearStoredCloudProvidersOptions<Provider extends string> {
  providers: readonly Provider[];
  deleteFromCloud: boolean;
  getStoredToken: (provider: Provider) => string | null;
  deleteCloudFile: (provider: Provider, token: string) => Promise<void>;
  clearStoredCredentials: (provider: Provider) => void | Promise<void>;
}

export const DEFAULT_FACTORY_RESET_PHASE_TIMEOUT_MS = 15_000;
const FACTORY_RESET_CLOUD_CLEANUP_BARRIER_KEY =
  "freed_factory_reset_cloud_cleanup_pending";

let factoryResetEpoch = 0;
let factoryResetStarted = false;
const pendingFactoryResetSensitiveOperations = new Set<Promise<unknown>>();

/** Block automatic cloud startup until the full factory reset succeeds. */
export function beginFactoryResetCloudCleanup(): void {
  localStorage.setItem(FACTORY_RESET_CLOUD_CLEANUP_BARRIER_KEY, "1");
}

/** True while a factory reset that reached cloud cleanup remains incomplete. */
export function hasFactoryResetCloudCleanupBarrier(): boolean {
  try {
    return localStorage.getItem(FACTORY_RESET_CLOUD_CLEANUP_BARRIER_KEY) !== null;
  } catch {
    return true;
  }
}

/** Remove the startup barrier after full cleanup or an explicit reconnect. */
export function clearFactoryResetCloudCleanupBarrier(): void {
  localStorage.removeItem(FACTORY_RESET_CLOUD_CLEANUP_BARRIER_KEY);
}

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

/** Close the shared reset-sensitive work boundary before any asynchronous reset coordination. */
export function beginFactoryResetBoundary(): void {
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

/**
 * Delete the requested cloud copies in caller-provided order before clearing
 * their device credentials. A failed deletion leaves every credential
 * available for an explicit retry.
 */
export async function clearStoredCloudProvidersForFactoryReset<Provider extends string>({
  providers,
  deleteFromCloud,
  getStoredToken,
  deleteCloudFile,
  clearStoredCredentials,
}: ClearStoredCloudProvidersOptions<Provider>): Promise<void> {
  const storedTokens = providers.flatMap((provider) => {
    const token = getStoredToken(provider);
    return token ? [{ provider, token }] : [];
  });

  if (deleteFromCloud) {
    for (const { provider, token } of storedTokens) {
      await deleteCloudFile(provider, token);
    }
  }

  for (const provider of providers) {
    await clearStoredCredentials(provider);
  }
}

async function runFactoryResetPhase<T>(
  label: FactoryResetPhase,
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
  } catch (error) {
    if (error instanceof FactoryResetPhaseError) throw error;
    throw new FactoryResetPhaseError(label, error);
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
      await Promise.race([
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
  const trackedWorkDrainTimeoutMs =
    operations.trackedWorkDrainTimeoutMs ?? phaseTimeoutMs;
  if (
    !Number.isFinite(trackedWorkDrainTimeoutMs)
    || trackedWorkDrainTimeoutMs <= 0
    || trackedWorkDrainTimeoutMs > phaseTimeoutMs
  ) {
    throw new Error(
      "Factory reset tracked work timeout must be greater than zero and no longer than the phase timeout.",
    );
  }

  beginFactoryResetBoundary();

  await runFactoryResetPhase("quiesce local writers", phaseTimeoutMs, async () => {
    const quiesceResults = await Promise.allSettled([
      waitForFactoryResetDrain(
        () => [...pendingFactoryResetSensitiveOperations],
        "Device-local cache work",
        trackedWorkDrainTimeoutMs,
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
