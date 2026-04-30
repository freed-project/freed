import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { docBackfillContentSignals, subscribe } from "./automerge.js";
import { localAIModels, subscribeToLocalAIModelState } from "./local-ai-models.js";
import { log } from "./logger.js";

const BATCH_SIZE = 100;
const PROCESS_INTERVAL_MS = 5_000;
const RETRY_COOLDOWN_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

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
let pending = 0;

function scheduleBackfill(): void {
  scheduled = true;
  pending = Math.max(pending, 1);
}

async function recordSemanticHealth(summary: Awaited<ReturnType<typeof docBackfillContentSignals>>): Promise<void> {
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
  const now = Date.now();
  if (lastFailureAt && now - lastFailureAt < RETRY_COOLDOWN_MS) return;

  processing = true;
  try {
    const summary = await docBackfillContentSignals(BATCH_SIZE);
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
    failedCount += 1;
    lastFailureAt = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[semantic-classifier] enrichment failed err=${message}`);
    addDebugEvent("error", `[Semantic classifier] enrichment failed: ${message}`);
  } finally {
    processing = false;
  }
}

export function start(): void {
  if (running) return;
  running = true;
  scheduled = true;
  pending = 1;
  lastScannedDocItemCount = null;

  unsubscribeDoc = subscribe((state) => {
    if (lastScannedDocItemCount === state.docItemCount) return;
    lastScannedDocItemCount = state.docItemCount;
    scheduleBackfill();
  });
  unsubscribeLocalAIModelState = subscribeToLocalAIModelState(() => {
    scheduleBackfill();
  });

  log.info("[semantic-classifier] started");

  intervalHandle = setInterval(() => {
    processNextBatch().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[semantic-classifier] unexpected error in processNextBatch: ${message}`);
      addDebugEvent("error", `[Semantic classifier] unexpected error: ${message}`);
    });
  }, PROCESS_INTERVAL_MS);

  void processNextBatch();

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

  log.info("[semantic-classifier] stopped");
}
