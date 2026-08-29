import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import type { WeightPreferences } from "@freed/shared";
import {
  backfillLibraryPriorities,
  subscribeDesktopLibraryRuntime,
} from "./library-client";
import {
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator";
import { log } from "./logger";

const BATCH_SIZE = 64;
const PROCESS_INTERVAL_MS = 500;
const STARTUP_DELAY_MS = 30_000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 120_000;

interface PriorityIndexerOptions {
  readonly getWeights: () => WeightPreferences;
  readonly subscribeToWeightChanges?: (callback: () => void) => () => void;
}

let running = false;
let processing = false;
let scheduled = false;
let rerunRequested = false;
let passStartedAt = 0;
let activeWeights: WeightPreferences | null = null;
let nextRefreshAt = 0;
let startedAt = 0;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeLibrary: (() => void) | null = null;
let unsubscribeWeights: (() => void) | null = null;
let getWeights: () => WeightPreferences = () => ({
  authors: {},
  platforms: {},
  recency: 50,
  topics: {},
});
let factoryResetDrainInProgress = false;
const activeResetSensitiveOperations = new Set<Promise<unknown>>();

function trackResetSensitiveOperation<T>(operation: Promise<T>): Promise<T> {
  let tracked: Promise<T>;
  tracked = operation.finally(() =>
    activeResetSensitiveOperations.delete(tracked),
  );
  activeResetSensitiveOperations.add(tracked);
  return tracked;
}

function beginPass(): void {
  passStartedAt = Math.max(Date.now(), passStartedAt + 1);
  activeWeights = getWeights();
  scheduled = true;
  rerunRequested = false;
}

function schedulePass(): void {
  if (!running || factoryResetDrainInProgress) return;
  if (scheduled || processing) {
    rerunRequested = true;
    return;
  }
  beginPass();
}

async function processNextBatch(): Promise<void> {
  if (!running || processing || !scheduled) return;
  const now = Date.now();
  if (now < startedAt + STARTUP_DELAY_MS) return;
  if (
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  ) {
    return;
  }
  processing = true;
  try {
    const weights = activeWeights;
    if (weights === null) {
      throw new Error("priority pass has no weight snapshot");
    }
    const summary = await runBackgroundJob({
      kind: "library-projection",
      source: "feed-priority",
      blocking: false,
      timeoutMs: 120_000,
      run: () =>
        trackResetSensitiveOperation(
          backfillLibraryPriorities(weights, passStartedAt, BATCH_SIZE),
        ),
    });
    scheduled = summary.remaining > 0;
    if (!scheduled) {
      addDebugEvent(
        "change",
        `[priority-indexer] ranked ${summary.updated.toLocaleString()} final items`,
      );
      if (rerunRequested) {
        beginPass();
      } else {
        activeWeights = null;
        nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
      }
    }
  } catch (error) {
    if (isBackgroundRuntimeDeferredError(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[priority-indexer] ranking failed err=${message}`);
    addDebugEvent("error", `[Priority indexer] ranking failed: ${message}`);
  } finally {
    processing = false;
  }
}

export function start(options: PriorityIndexerOptions): void {
  if (running || factoryResetDrainInProgress) return;
  getWeights = options.getWeights;
  running = true;
  startedAt = Date.now();
  schedulePass();
  unsubscribeLibrary = subscribeDesktopLibraryRuntime((_state, event) => {
    if (!processing && event.source !== "feeds_patch") schedulePass();
  });
  unsubscribeWeights = options.subscribeToWeightChanges?.(schedulePass) ?? null;
  intervalHandle = setInterval(() => {
    if (!scheduled && Date.now() >= nextRefreshAt) schedulePass();
    trackResetSensitiveOperation(processNextBatch()).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[priority-indexer] unexpected failure: ${message}`);
    });
  }, PROCESS_INTERVAL_MS);
  log.info("[priority-indexer] started");
}

export function stop(): void {
  running = false;
  scheduled = false;
  rerunRequested = false;
  activeWeights = null;
  passStartedAt = 0;
  nextRefreshAt = 0;
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  unsubscribeLibrary?.();
  unsubscribeLibrary = null;
  unsubscribeWeights?.();
  unsubscribeWeights = null;
  getWeights = () => ({
    authors: {},
    platforms: {},
    recency: 50,
    topics: {},
  });
  log.info("[priority-indexer] stopped");
}

export async function stopAndDrain(): Promise<void> {
  factoryResetDrainInProgress = true;
  stop();
  await waitForFactoryResetDrain(
    () => Array.from(activeResetSensitiveOperations),
    "Priority indexer",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}
