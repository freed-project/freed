/**
 * Background sync polling service
 *
 * Automatically refreshes subscribed feeds and connected social providers.
 * Runs in the JavaScript layer so it works regardless of Tauri's background state.
 */

import { refreshAllFeeds } from "./capture";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import {
  formatBackgroundRuntimeDeferredReason,
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator";
import {
  SCHEDULED_RSS_MAX_FEEDS,
  SCHEDULED_RSS_STALE_AFTER_MS,
} from "./rss-refresh-plan";

/** Default poll interval: 30 minutes */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_STARTUP_POLL_DELAY_MS = 5 * 60 * 1000;
const DEFERRED_RETRY_BASE_MS = 60_000;
const DEFERRED_RETRY_MAX_MS = 30 * 60_000;
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
  if (retryTimeoutId !== null) return;
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
 * @param intervalMs Poll interval in milliseconds (default: 30 minutes)
 */
export function startRssPoller(
  intervalMs = DEFAULT_INTERVAL_MS,
  options: RssPollerOptions = {},
): void {
  if (pollIntervalId !== null) return; // Already running

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

  pollIntervalId = setInterval(triggerPoll, intervalMs);
  console.log(
    `[SyncPoller] Started, polling every ${(intervalMs / 60000).toLocaleString()} minutes`,
  );
}

/**
 * Stop background RSS polling.
 */
export function stopRssPoller(): void {
  clearStartupPoll();
  clearDeferredRetry();
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    console.log("[SyncPoller] Stopped");
  }
}

/**
 * Trigger a single poll (no-op if one is already in flight).
 */
async function triggerPoll(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    await runBackgroundJob({
      kind: "rss-poll",
      source: "rss-poller",
      timeoutMs: 180_000,
      run: () => refreshAllFeeds(SCHEDULED_REFRESH_OPTIONS),
    });
    clearDeferredRetry();
  } catch (err) {
    if (isBackgroundRuntimeDeferredError(err)) {
      addDebugEvent("change", `[Sync] poll deferred: ${formatBackgroundRuntimeDeferredReason(err.reason)}`);
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
