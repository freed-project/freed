/**
 * Background RSS polling service
 *
 * Automatically refreshes all subscribed feeds on a regular interval.
 * Runs in the JavaScript layer so it works regardless of Tauri's background state.
 */

import { refreshAllFeeds } from "./capture";

/** Default poll interval: 30 minutes */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

/**
 * Start background RSS polling.
 * Safe to call multiple times — will not create duplicate intervals.
 *
 * @param intervalMs Poll interval in milliseconds (default: 30 minutes)
 */
export function startRssPoller(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (pollIntervalId !== null) return; // Already running

  // Do an immediate refresh on first start
  triggerPoll();

  pollIntervalId = setInterval(triggerPoll, intervalMs);
  console.log(
    `[RssPoller] Started — polling every ${intervalMs / 60000} minutes`,
  );
}

/**
 * Stop background RSS polling.
 */
export function stopRssPoller(): void {
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
    await refreshAllFeeds();
  } catch (err) {
    console.error("[RssPoller] Error during poll:", err);
  } finally {
    isPolling = false;
  }
}
