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

function beginPass(source?: LibraryCoreFeedPageSourceV1): void {
  timeOnly = source !== undefined;
  expectedPassSource = source ?? null;
  passSourceClean = true;
  passStartedAt = Math.max(Date.now(), passStartedAt + 1);
  scheduled = true;
  rerunRequested = false;
}

function schedulePass(): void {
  if (!running || factoryResetDrainInProgress) return;
  completedSource = null;
  if (scheduled || processing) {
    rerunRequested = true;
    return;
  }
  beginPass();
}

async function checkPreferenceRevision(expectedLifecycle: number) {
  const parsed = parseLibraryCorePreferencesRevisionResponseV1(
    await queryNormalizedLibrary({ queryId: "preferences_revision_v1", schemaVersion: 1 }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  if (!running || lifecycle !== expectedLifecycle) return;
  // Generation replacement clears invalidations, so revision alone is insufficient.
  const marker = JSON.stringify([parsed.value.source.generationId, parsed.value.revision]);
  if (preferenceMarker !== null && preferenceMarker !== marker) rerunRequested = true;
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
      beginPass(selective && facet.ok ? facet.value.source : undefined);
    }
    const preflight = await checkPreferenceRevision(expectedLifecycle);
    if (!running || lifecycle !== expectedLifecycle || !preflight) return;
    if (expectedPassSource && !sameSource(expectedPassSource, preflight)) {
      completedSource = null;
      if (timeOnly) beginPass();
      else { passSourceClean = false; rerunRequested = true; }
    }
    const summary = await runBackgroundJob({
      kind: "library-projection",
      source: "feed-priority",
      blocking: true,
      timeoutMs: 120_000,
      run: () =>
        trackResetSensitiveOperation(
          timeOnly && expectedPassSource
            ? backfillLibraryPriorities(passStartedAt, BATCH_SIZE, false, expectedPassSource)
            : backfillLibraryPriorities(passStartedAt, BATCH_SIZE, false),
        ),
    });
    if (!running || lifecycle !== expectedLifecycle) return;
    const batchSource = parseLibraryCoreFeedPageSourceV1(summary.source);
    if (batchSource.ok) {
      if (expectedPassSource && !sameSource(expectedPassSource, batchSource.value)) {
        passSourceClean = false;
        rerunRequested = true;
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
      if (expectedPassSource && completionSource && !sameSource(expectedPassSource, completionSource)) rerunRequested = true;
      scheduled = false;
      addDebugEvent(
        "change",
        `[priority-indexer] ranked ${summary.updated.toLocaleString()} final items`,
      );
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
    if (isBackgroundRuntimeDeferredError(error)) return;
    if (timeOnly) {
      completedSource = null;
      beginPass();
    }
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[priority-indexer] ranking failed err=${message}`);
    addDebugEvent("error", `[Priority indexer] ranking failed: ${message}`);
  } finally {
    processing = false;
  }
}

export function start(): void {
  if (running || factoryResetDrainInProgress || isDesktopHandoffPaused()) return;
  running = true;
  startedAt = Date.now();
  schedulePass();
  unsubscribeLibrary = subscribeDesktopLibraryRuntime((_state, event) => {
    if (event.source === "preferences_patch" || (!processing && event.source !== "feeds_patch")) schedulePass();
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
