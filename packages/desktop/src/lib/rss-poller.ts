/**
 * Background RSS polling service
 *
 * Automatically refreshes all subscribed feeds on a regular interval.
 * Runs in the JavaScript layer so it works regardless of Tauri's background state.
 */

import { refreshAllFeeds } from "./capture";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import {
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator";

/** Default poll interval: 30 minutes */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFERRED_RETRY_MS = 15_000;

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
let isPolling = false;

function clearDeferredRetry(): void {
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
}

function scheduleDeferredRetry(): void {
  if (retryTimeoutId !== null) return;
  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = null;
    void triggerPoll();
  }, DEFERRED_RETRY_MS);
}

/**
 * Start background RSS polling.
 * Safe to call multiple times — will not create duplicate intervals.
 *
 * @param intervalMs Poll interval in milliseconds (default: 30 minutes)
 */
export function startRssPoller(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (pollIntervalId !== null) return; // Already running

  // Do an immediate refresh on first start
  void triggerPoll();

  pollIntervalId = setInterval(triggerPoll, intervalMs);
  console.log(
    `[RssPoller] Started — polling every ${intervalMs / 60000} minutes`,
  );
}

/**
 * Stop background RSS polling.
 */
export function stopRssPoller(): void {
  clearDeferredRetry();
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    console.log("[RssPoller] Stopped");
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
      run: refreshAllFeeds,
    });
    clearDeferredRetry();
  } catch (err) {
    if (isBackgroundRuntimeDeferredError(err)) {
      addDebugEvent("change", `[RSS] poll deferred: ${err.reason}`);
      scheduleDeferredRetry();
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[RssPoller] Error during poll:", err);
    addDebugEvent("error", `[RSS] poller crashed: ${msg}`);
  } finally {
    isPolling = false;
  }
}
