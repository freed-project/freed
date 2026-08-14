/**
 * Background sync polling service
 *
 * Automatically refreshes subscribed feeds and connected social providers.
 * Runs in the JavaScript layer so it works regardless of Tauri's background state.
 */

import { refreshScheduledRssFeeds } from "./capture";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import {
  formatBackgroundRuntimeDeferredReason,
  isBackgroundRuntimeDeferredError,
  canStartBackgroundJob,
  runBackgroundJob,
} from "./background-runtime-coordinator";
import {
  SCHEDULED_RSS_MAX_FEEDS,
  SCHEDULED_RSS_STALE_AFTER_MS,
} from "./rss-refresh-plan";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import {
  claimRssSyncDue,
  deferRssSyncClaim,
  getRssSyncSchedule,
  setRssSyncInterval,
  settleRssSync,
} from "./rss-sync-schedule-state";

const SCHEDULER_TICK_MS = 60 * 1_000;
const DEFAULT_STARTUP_POLL_DELAY_MS = 0;
const DEFERRED_RETRY_BASE_MS = 60_000;
const DEFERRED_RETRY_MAX_MS = 30 * 60_000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 180_000;
const SCHEDULED_REFRESH_OPTIONS = {
  maxFeeds: SCHEDULED_RSS_MAX_FEEDS,
  staleAfterMs: SCHEDULED_RSS_STALE_AFTER_MS,
};

interface RssPollerOptions {
  startupDelayMs?: number;
}

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let isPolling = false;
let deferredRetryCount = 0;
let pollerAcceptingWork = false;
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

function clearDeferredRetry(): void {
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  deferredRetryCount = 0;
}

function clearStartupPoll(): void {
  if (startupTimeoutId !== null) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
}

function parseCooldownRetryMs(reason: string): number | null {
  const match = reason.match(/^cooldown:([\d,]+)$/);
  if (!match) return null;

  const value = Number.parseInt(match[1].replaceAll(",", ""), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function nextDeferredRetryMs(reason: string): number {
  const exponentialMs =
    DEFERRED_RETRY_BASE_MS * Math.pow(2, Math.min(deferredRetryCount, 8));
  const cooldownMs = parseCooldownRetryMs(reason) ?? 0;
  return Math.min(
    DEFERRED_RETRY_MAX_MS,
    Math.max(DEFERRED_RETRY_BASE_MS, exponentialMs, cooldownMs),
  );
}

function scheduleDeferredRetry(reason: string): void {
  if (!pollerAcceptingWork || retryTimeoutId !== null) return;
  const retryMs = nextDeferredRetryMs(reason);
  deferredRetryCount += 1;
  const displayReason = formatBackgroundRuntimeDeferredReason(reason);
  addDebugEvent(
    "change",
    `[Sync] poll retry scheduled in ${Math.round(retryMs / 1000).toLocaleString()}s. ${displayReason}`,
  );
  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = null;
    void triggerPoll();
  }, retryMs);
}

/**
 * Start background RSS polling.
 * Safe to call multiple times — will not create duplicate intervals.
 *
 * @param intervalMs Poll interval in milliseconds (default: 3 hours)
 */
export function startRssPoller(
  intervalMs?: number,
  options: RssPollerOptions = {},
): void {
  if (pollIntervalId !== null || factoryResetDrainInProgress) return; // Already running
  pollerAcceptingWork = true;
  if (intervalMs !== undefined && !setRssSyncInterval(intervalMs)) {
    addDebugEvent("error", "[RSS] automatic sync paused because its device schedule is unavailable.");
  }
  const schedule = getRssSyncSchedule();

  const startupDelayMs =
    options.startupDelayMs ?? DEFAULT_STARTUP_POLL_DELAY_MS;
  if (startupDelayMs > 0) {
    startupTimeoutId = setTimeout(() => {
      startupTimeoutId = null;
      void triggerPoll();
    }, startupDelayMs);
    addDebugEvent(
      "change",
      `[Sync] startup refresh scheduled in ${Math.round(startupDelayMs / 1000).toLocaleString()}s`,
    );
  } else {
    void triggerPoll();
  }

  pollIntervalId = setInterval(triggerPoll, SCHEDULER_TICK_MS);
  console.log(
    `[SyncPoller] Started, polling every ${((schedule?.intervalMs ?? intervalMs ?? 0) / 60000).toLocaleString()} minutes`,
  );
}

/**
 * Stop background RSS polling.
 */
export function stopRssPoller(): void {
  pollerAcceptingWork = false;
  clearStartupPoll();
  clearDeferredRetry();
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    console.log("[SyncPoller] Stopped");
  }
}

/** Stop future polls and wait for an already-started feed refresh to settle. */
export async function stopRssPollerAndDrain(): Promise<void> {
  factoryResetDrainInProgress = true;
  stopRssPoller();
  await waitForFactoryResetDrain(
    () => Array.from(activeResetSensitiveOperations),
    "RSS poller",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}

/**
 * Trigger a single poll (no-op if one is already in flight).
 */
async function triggerPoll(): Promise<void> {
  if (!pollerAcceptingWork || isPolling) return;
  const gate = canStartBackgroundJob("rss-poll");
  if (!gate.ok) {
    scheduleDeferredRetry(gate.reason);
    return;
  }
  const claim = claimRssSyncDue();
  if (!claim) return;
  isPolling = true;

  try {
    await runBackgroundJob({
      kind: "rss-poll",
      source: "rss-poller",
      timeoutMs: 180_000,
      run: () =>
        trackResetSensitiveOperation(
          Promise.resolve().then(() =>
            refreshScheduledRssFeeds(SCHEDULED_REFRESH_OPTIONS),
          ),
        ),
    });
    settleRssSync();
    clearDeferredRetry();
  } catch (err) {
    if (isBackgroundRuntimeDeferredError(err)) {
      deferRssSyncClaim(claim.lastAttemptAt ?? Date.now());
      addDebugEvent(
        "change",
        `[Sync] poll deferred: ${formatBackgroundRuntimeDeferredReason(err.reason)}`,
      );
      scheduleDeferredRetry(err.reason);
      return;
    }
    clearDeferredRetry();
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SyncPoller] Error during poll:", err);
    addDebugEvent("error", `[Sync] poller crashed: ${msg}`);
  } finally {
    isPolling = false;
  }
}
