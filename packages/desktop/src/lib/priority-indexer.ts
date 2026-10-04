import { LIBRARY_CORE_PRIORITY_TIME_MAXIMUM_CORPUS, parseLibraryCoreFacetSummaryResponseV1, parseLibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageSourceV1, parseLibraryCorePreferencesRevisionResponseV1 } from "@freed/shared/library-core";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import {
  backfillLibraryPriorities,
  reloadSqliteLibraryState,
  subscribeDesktopLibraryRuntime,
} from "./library-client";
import {
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator";
import { log } from "./logger";
import { isDesktopHandoffPaused } from "./factory-reset-guard";

const BATCH_SIZE = 64;
const PROCESS_INTERVAL_MS = 500;
const STARTUP_DELAY_MS = 30_000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 120_000;

let running = false;
let processing = false;
let scheduled = false;
let rerunRequested = false;
let passStartedAt = 0;
let nextRefreshAt = 0;
let startedAt = 0;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeLibrary: (() => void) | null = null;
let preferenceMarker: string | null = null;
let completedSource: LibraryCoreFeedPageSourceV1 | null = null;
let expectedPassSource: LibraryCoreFeedPageSourceV1 | null = null;
let timeOnly = false;
let passSourceClean = true;
let lifecycle = 0;

function sameSource(a: LibraryCoreFeedPageSourceV1, b: LibraryCoreFeedPageSourceV1): boolean {
  return a.generationId === b.generationId && a.projectionRevision === b.projectionRevision && a.transitionSequence === b.transitionSequence;
}
// Opt-in only; ordinary application startup leaves diagnostics disabled.
let diagnosticsEnabled = false;
const DIAGNOSTIC_INTERVAL_MS = 60_000;
const DIAGNOSTIC_MAX_LINES_PER_WINDOW = 8;
let diagnosticWindowAt = -Infinity;
let diagnosticLastClock = -Infinity;
let diagnosticLines = 0;
let suppressedDiagnosticEvents = 0;
let suppressedDiagnosticTriggers = 0;
const TRIGGERS = {
  startup: 1, hourly: 2, preferences_update: 4, item_update: 8,
  state_update: 16, other_update: 32, preferences_revision: 64,
  source_drift: 128, time_retry: 256,
} as const;
type PassTrigger = keyof typeof TRIGGERS;
let pendingDiagnosticTriggers = 0;
let passDiagnostics: null | {
  startedAt: number; lastLogAt: number; firstBatchAt: number | null;
  mode: "full" | "time"; triggers: number; batches: number; items: number;
  queueWaitMs: number; queueSamples: number; failures: number; deferrals: number;
} = null;

function boundedAdd(value: number, increment: number): number {
  return Number.isFinite(increment) && increment >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, value + increment) : value;
}

function diagnosticTriggers(mask: number): PassTrigger[] {
  return (Object.keys(TRIGGERS) as PassTrigger[]).filter(reason => (mask & TRIGGERS[reason]) !== 0);
}

function emitPassDiagnostic(outcome: "started" | "progress" | "complete" | "replaced" | "stopped"): void {
  const diagnostic = passDiagnostics;
  if (!diagnostic) return;
  const now = performance.now();
  const clockReset = now < diagnosticLastClock;
  if (clockReset || now - diagnosticWindowAt >= DIAGNOSTIC_INTERVAL_MS) {
    diagnosticWindowAt = now;
    diagnosticLines = 0;
    if (clockReset) { suppressedDiagnosticEvents = 0; suppressedDiagnosticTriggers = 0; }
  }
  diagnosticLastClock = now;
  if (diagnosticLines >= DIAGNOSTIC_MAX_LINES_PER_WINDOW) {
    suppressedDiagnosticEvents = boundedAdd(suppressedDiagnosticEvents, 1);
    suppressedDiagnosticTriggers |= diagnostic.triggers | pendingDiagnosticTriggers;
  } else {
    diagnosticLines += 1;
    log.info(`[priority-indexer] pass_summary ${JSON.stringify({
      outcome, mode: diagnostic.mode, triggers: diagnosticTriggers(diagnostic.triggers),
      rerunTriggers: diagnosticTriggers(pendingDiagnosticTriggers),
      elapsedMs: Math.trunc(Math.max(0, now - diagnostic.startedAt)),
      workElapsedMs: diagnostic.firstBatchAt === null ? null : Math.trunc(Math.max(0, now - diagnostic.firstBatchAt)),
      batches: diagnostic.batches, items: diagnostic.items,
      queueWaitMs: Math.trunc(diagnostic.queueWaitMs), queueSamples: diagnostic.queueSamples,
      failures: diagnostic.failures, deferrals: diagnostic.deferrals,
      suppressedEvents: suppressedDiagnosticEvents,
      suppressedTriggers: diagnosticTriggers(suppressedDiagnosticTriggers),
    })}`);
    suppressedDiagnosticEvents = 0;
    suppressedDiagnosticTriggers = 0;
  }
  diagnostic.lastLogAt = now;
  if (outcome === "complete" || outcome === "replaced" || outcome === "stopped") passDiagnostics = null;
}

function requestRerun(trigger: PassTrigger): void {
  rerunRequested = true;
  if (diagnosticsEnabled) pendingDiagnosticTriggers |= TRIGGERS[trigger];
}

function maybeEmitPassProgress(): void {
  if (passDiagnostics && performance.now() - passDiagnostics.lastLogAt >= DIAGNOSTIC_INTERVAL_MS) emitPassDiagnostic("progress");
}

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

function beginPass(source?: LibraryCoreFeedPageSourceV1, trigger?: PassTrigger): void {
  if (diagnosticsEnabled) {
    emitPassDiagnostic("replaced");
    const now = performance.now();
    passDiagnostics = { startedAt: now, lastLogAt: now, firstBatchAt: null,
      mode: source === undefined ? "full" : "time",
      triggers: pendingDiagnosticTriggers | (trigger ? TRIGGERS[trigger] : 0),
      batches: 0, items: 0, queueWaitMs: 0, queueSamples: 0, failures: 0, deferrals: 0 };
    pendingDiagnosticTriggers = 0;
    emitPassDiagnostic("started");
  }
  timeOnly = source !== undefined;
  expectedPassSource = source ?? null;
  passSourceClean = true;
  passStartedAt = Math.max(Date.now(), passStartedAt + 1);
  scheduled = true;
  rerunRequested = false;
}

function schedulePass(trigger: PassTrigger): void {
  if (!running || factoryResetDrainInProgress) return;
  completedSource = null;
  if (scheduled || processing) {
    requestRerun(trigger);
    return;
  }
  beginPass(undefined, trigger);
}

async function checkPreferenceRevision(expectedLifecycle: number) {
  const parsed = parseLibraryCorePreferencesRevisionResponseV1(
    await queryNormalizedLibrary({ queryId: "preferences_revision_v1", schemaVersion: 1 }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  if (!running || lifecycle !== expectedLifecycle) return;
  // Generation replacement clears invalidations, so revision alone is insufficient.
  const marker = JSON.stringify([parsed.value.source.generationId, parsed.value.revision]);
  if (preferenceMarker !== null && preferenceMarker !== marker) requestRerun("preferences_revision");
  preferenceMarker = marker;
  return parsed.value.source;
}

async function processNextBatch(): Promise<void> {
  if (!running || processing || (!scheduled && Date.now() < nextRefreshAt)) return;
  const now = Date.now();
  if (now < startedAt + STARTUP_DELAY_MS) return;
  if (
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  ) {
    return;
  }
  processing = true;
  if (passDiagnostics && passDiagnostics.firstBatchAt === null) passDiagnostics.firstBatchAt = performance.now();
  const expectedLifecycle = lifecycle;
  try {
    if (!scheduled) {
      const facet = parseLibraryCoreFacetSummaryResponseV1(await queryNormalizedLibrary({ queryId: "library_facet_summary_v1", schemaVersion: 1 }));
      if (!running || lifecycle !== expectedLifecycle) return;
      const selective = !scheduled && !rerunRequested && facet.ok && completedSource &&
        sameSource(completedSource, facet.value.source) &&
        facet.value.source.projectionRevision === facet.value.source.transitionSequence &&
        facet.value.summary.totalCount <= LIBRARY_CORE_PRIORITY_TIME_MAXIMUM_CORPUS &&
        facet.value.summary.platformCounts.reduce((sum, entry) => sum + entry.totalCount, 0) === facet.value.summary.totalCount;
      beginPass(selective && facet.ok ? facet.value.source : undefined, "hourly");
      if (passDiagnostics) passDiagnostics.firstBatchAt = performance.now();
    }
    const preflight = await checkPreferenceRevision(expectedLifecycle);
    if (!running || lifecycle !== expectedLifecycle || !preflight) return;
    if (expectedPassSource && !sameSource(expectedPassSource, preflight)) {
      completedSource = null;
      if (timeOnly) beginPass(undefined, "source_drift");
      else { passSourceClean = false; requestRerun("source_drift"); }
    }
    if (passDiagnostics && passDiagnostics.firstBatchAt === null) passDiagnostics.firstBatchAt = performance.now();
    const summary = await runBackgroundJob({
      kind: "library-projection",
      source: "feed-priority",
      blocking: true,
      timeoutMs: 120_000,
      run: () =>
        trackResetSensitiveOperation(
          diagnosticsEnabled
            ? backfillLibraryPriorities(passStartedAt, BATCH_SIZE, false,
                timeOnly ? expectedPassSource ?? undefined : undefined, true)
            : timeOnly && expectedPassSource
              ? backfillLibraryPriorities(passStartedAt, BATCH_SIZE, false, expectedPassSource)
              : backfillLibraryPriorities(passStartedAt, BATCH_SIZE, false),
        ),
    });
    if (!running || lifecycle !== expectedLifecycle) return;
    if (passDiagnostics) {
      passDiagnostics.batches = boundedAdd(passDiagnostics.batches, 1);
      passDiagnostics.items = boundedAdd(passDiagnostics.items, summary.updated);
      if (Number.isFinite(summary.queueWaitMs) && summary.queueWaitMs >= 0) {
        passDiagnostics.queueWaitMs = boundedAdd(passDiagnostics.queueWaitMs, summary.queueWaitMs);
        passDiagnostics.queueSamples = boundedAdd(passDiagnostics.queueSamples, 1);
      }
      maybeEmitPassProgress();
    }
    const batchSource = parseLibraryCoreFeedPageSourceV1(summary.source);
    if (batchSource.ok) {
      if (expectedPassSource && !sameSource(expectedPassSource, batchSource.value)) {
        passSourceClean = false;
        requestRerun("source_drift");
      }
      // A 64-member assignment batch is one signed transaction and revision.
      const advance = summary.updated > 0 ? 1 : 0;
      expectedPassSource = { ...batchSource.value, projectionRevision: batchSource.value.projectionRevision + advance,
        transitionSequence: batchSource.value.transitionSequence + advance };
    } else {
      // Unknown source can never establish a selective completion proof.
      passSourceClean = false;
      expectedPassSource = null;
    }
    scheduled = summary.remaining > 0;
    if (!scheduled) {
      // Keep completion retryable until both reload and the durable marker succeed.
      scheduled = true;
      await reloadSqliteLibraryState();
      const completionSource = await checkPreferenceRevision(expectedLifecycle);
      if (!running || lifecycle !== expectedLifecycle) return;
      if (expectedPassSource && completionSource && !sameSource(expectedPassSource, completionSource)) requestRerun("source_drift");
      scheduled = false;
      addDebugEvent(
        "change",
        `[priority-indexer] ranked ${summary.updated.toLocaleString()} final items`,
      );
      emitPassDiagnostic("complete");
      if (rerunRequested) {
        completedSource = null;
        beginPass();
      } else {
        completedSource = passSourceClean && completionSource && expectedPassSource && sameSource(expectedPassSource, completionSource)
          ? completionSource : null;
        nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
      }
    }
  } catch (error) {
    if (isBackgroundRuntimeDeferredError(error)) {
      if (running && lifecycle === expectedLifecycle && passDiagnostics) {
        passDiagnostics.deferrals = boundedAdd(passDiagnostics.deferrals, 1);
        maybeEmitPassProgress();
      }
      return;
    }
    if (running && lifecycle === expectedLifecycle && passDiagnostics) {
      passDiagnostics.failures = boundedAdd(passDiagnostics.failures, 1);
      maybeEmitPassProgress();
    }
    if (timeOnly) {
      completedSource = null;
      beginPass(undefined, "time_retry");
    }
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[priority-indexer] ranking failed err=${message}`);
    addDebugEvent("error", `[Priority indexer] ranking failed: ${message}`);
  } finally {
    processing = false;
  }
}

export function start(options: { diagnostics?: boolean } = {}): void {
  if (running || factoryResetDrainInProgress || isDesktopHandoffPaused()) return;
  diagnosticsEnabled = options.diagnostics === true;
  running = true;
  startedAt = Date.now();
  pendingDiagnosticTriggers = 0;
  schedulePass("startup");
  unsubscribeLibrary = subscribeDesktopLibraryRuntime((_state, event) => {
    if (event.source === "preferences_patch" || (!processing && event.source !== "feeds_patch")) {
      schedulePass(event.source === "preferences_patch" ? "preferences_update" :
        event.source === "item_patch" ? "item_update" : event.source === "state_update" ? "state_update" : "other_update");
    }
  });
  intervalHandle = setInterval(() => {
    trackResetSensitiveOperation(processNextBatch()).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[priority-indexer] unexpected failure: ${message}`);
    });
  }, PROCESS_INTERVAL_MS);
  log.info("[priority-indexer] started");
}

export function stop(): void {
  emitPassDiagnostic("stopped");
  diagnosticsEnabled = false;
  pendingDiagnosticTriggers = 0;
  running = false;
  lifecycle += 1;
  preferenceMarker = null;
  completedSource = null;
  expectedPassSource = null;
  timeOnly = false;
  passSourceClean = true;
  scheduled = false;
  rerunRequested = false;
  passStartedAt = 0;
  nextRefreshAt = 0;
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  unsubscribeLibrary?.();
  unsubscribeLibrary = null;
  log.info("[priority-indexer] stopped");
}

export async function stopAndDrain(options: { resumable?: boolean } = {}): Promise<void> {
  if (options.resumable && !isDesktopHandoffPaused()) throw new Error("Resumable priority drain requires the handoff pause");
  if (!options.resumable) factoryResetDrainInProgress = true;
  stop();
  await waitForFactoryResetDrain(
    () => Array.from(activeResetSensitiveOperations),
    "Priority indexer",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}
