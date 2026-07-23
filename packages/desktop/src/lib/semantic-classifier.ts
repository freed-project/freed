import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { docBackfillContentSignals, subscribe } from "./automerge.js";
import { localAIModels, subscribeToLocalAIModelState } from "./local-ai-models.js";
import { log } from "./logger.js";
import {
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator.js";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";

const BATCH_SIZE = 100;
const PROCESS_INTERVAL_MS = 5_000;
const STARTUP_DELAY_MS = 10 * 60 * 1000;
const RETRY_COOLDOWN_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 120_000;

type SemanticClassifierOptions = {
  isEnabled?: () => boolean;
  subscribeToPreferenceChanges?: (callback: () => void) => () => void;
};

let running = false;
let scheduled = false;
let processing = false;
let completed = 0;
let failedCount = 0;
let lastFailureAt = 0;
let lastRunAt: number | undefined;
let lastScannedDocItemCount: number | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeDoc: (() => void) | null = null;
let unsubscribeLocalAIModelState: (() => void) | null = null;
let unsubscribePreferenceChanges: (() => void) | null = null;
let pending = 0;
let isEnabled: () => boolean = () => false;
let startedAt = 0;
let factoryResetDrainInProgress = false;
const activeResetSensitiveOperations = new Set<Promise<unknown>>();

function trackResetSensitiveOperation<T>(operation: Promise<T>): Promise<T> {
  let tracked: Promise<T>;
  tracked = operation.finally(() => activeResetSensitiveOperations.delete(tracked));
  activeResetSensitiveOperations.add(tracked);
  return tracked;
}

function scheduleBackfill(): void {
  if (factoryResetDrainInProgress || !isEnabled()) {
    scheduled = false;
    pending = 0;
    return;
  }
  scheduled = true;
  pending = Math.max(pending, 1);
}

async function recordSemanticHealth(summary: Awaited<ReturnType<typeof docBackfillContentSignals>>): Promise<void> {
  if (!isEnabled()) return;
  try {
    const models = await localAIModels.listModels();
    const semanticModel =
      models.find((model) => model.selected && model.manifest.supportsSemanticSearch) ??
      models.find((model) => model.manifest.supportsSemanticSearch);
    if (!semanticModel || semanticModel.state.status !== "available") return;

    await localAIModels.updateHealth(semanticModel.manifest.id, {
      lastIndexedItemCount: summary.total,
      lastRunAt,
      failureCount: failedCount,
    });
  } catch {
    // Health updates should never interrupt semantic enrichment.
  }
}

async function processNextBatch(): Promise<void> {
  if (!running || processing || !scheduled) return;
  if (!isEnabled()) {
    scheduled = false;
    pending = 0;
    return;
  }
  const now = Date.now();
  const startupDelayRemainingMs = startedAt + STARTUP_DELAY_MS - now;
  if (startupDelayRemainingMs > 0) return;
  if (
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  ) {
    return;
  }
  if (lastFailureAt && now - lastFailureAt < RETRY_COOLDOWN_MS) return;

  processing = true;
  try {
    const summary = await runBackgroundJob({
      kind: "semantic-classifier",
      source: "content-signals",
      blocking: false,
      timeoutMs: 120_000,
      run: () => trackResetSensitiveOperation(
        Promise.resolve().then(() => docBackfillContentSignals(BATCH_SIZE)),
      ),
    });
    lastRunAt = Date.now();
    completed += summary.updated;
    pending = summary.remaining;
    scheduled = summary.remaining > 0;
    await recordSemanticHealth(summary);
    if (summary.updated > 0) {
      addDebugEvent(
        "change",
        `[semantic-classifier] enriched ${summary.updated.toLocaleString()} items, ${summary.remaining.toLocaleString()} remaining`,
      );
    }
  } catch (error) {
    if (isBackgroundRuntimeDeferredError(error)) {
      log.info(`[semantic-classifier] deferred reason=${error.reason}`);
      return;
    }
    failedCount += 1;
    lastFailureAt = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[semantic-classifier] enrichment failed err=${message}`);
    addDebugEvent("error", `[Semantic classifier] enrichment failed: ${message}`);
  } finally {
    processing = false;
  }
}

export function start(options: SemanticClassifierOptions = {}): void {
  if (running || factoryResetDrainInProgress) return;
  isEnabled = options.isEnabled ?? (() => false);
  running = true;
  scheduled = isEnabled();
  pending = scheduled ? 1 : 0;
  lastScannedDocItemCount = null;
  startedAt = Date.now();

  unsubscribeDoc = subscribe((state) => {
    if (lastScannedDocItemCount === state.docItemCount) return;
    lastScannedDocItemCount = state.docItemCount;
    scheduleBackfill();
  });
  unsubscribeLocalAIModelState = subscribeToLocalAIModelState(() => {
    scheduleBackfill();
  });
  unsubscribePreferenceChanges = options.subscribeToPreferenceChanges?.(() => {
    scheduleBackfill();
  }) ?? null;

  log.info("[semantic-classifier] started");

  intervalHandle = setInterval(() => {
    trackResetSensitiveOperation(processNextBatch()).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[semantic-classifier] unexpected error in processNextBatch: ${message}`);
      addDebugEvent("error", `[Semantic classifier] unexpected error: ${message}`);
    });
  }, PROCESS_INTERVAL_MS);

  heartbeatHandle = setInterval(() => {
    log.info(
      `[semantic-classifier] heartbeat pending=${pending.toLocaleString()} completed=${completed.toLocaleString()} failed=${failedCount.toLocaleString()}`,
    );
  }, HEARTBEAT_INTERVAL_MS);
}

export function stop(): void {
  if (!running) return;
  running = false;

  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  if (heartbeatHandle !== null) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }

  if (unsubscribeDoc) {
    unsubscribeDoc();
    unsubscribeDoc = null;
  }

  if (unsubscribeLocalAIModelState) {
    unsubscribeLocalAIModelState();
    unsubscribeLocalAIModelState = null;
  }
  if (unsubscribePreferenceChanges) {
    unsubscribePreferenceChanges();
    unsubscribePreferenceChanges = null;
  }
  isEnabled = () => false;
  startedAt = 0;

  log.info("[semantic-classifier] stopped");
}

/** Stop future classification and wait for any current document write to settle. */
export async function stopAndDrain(): Promise<void> {
  factoryResetDrainInProgress = true;
  stop();
  await waitForFactoryResetDrain(
    () => Array.from(activeResetSensitiveOperations),
    "Semantic classifier",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}
