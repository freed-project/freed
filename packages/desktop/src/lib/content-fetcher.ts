/**
 * Background content fetcher for desktop
 *
 * Maintains an in-memory queue of FeedItems that need their HTML fetched,
 * extracted, and cached. Runs one item at a time with randomized pacing and
 * adaptive backoff to stay polite to remote servers.
 *
 * Responsibilities:
 *  1. Fetch raw HTML via the `fetchUrl` Tauri IPC command (bypasses CORS)
 *  2. Extract article content with Readability via extractContentBrowser()
 *  3. Write full HTML to the device content cache (contentCache.set)
 *  4. Update Automerge with preservedContent.text + wordCount + readingTime
 *     (which then syncs back to the PWA via relay)
 *  5. Optionally run AI summarization and update preservedContent.text again
 *
 * Subscribe behavior: call start() once at app init. The fetcher wires a
 * subscribe() callback so any stub item that arrives via relay sync is
 * automatically enqueued.
 */

import { invoke } from "@tauri-apps/api/core";
import { extractContentBrowser, extractMetadataBrowser } from "@freed/capture-save/browser";
import type { FeedItem, AIPreferences } from "@freed/shared";
import { contentCache } from "./content-cache.js";
import { docUpdateFeedItem, subscribe } from "./automerge.js";
import { useAppStore } from "./store.js";
import { summarize } from "./ai-summarizer.js";
import { secureStorage } from "./secure-storage.js";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger.js";
import { toSyncedPreservedText } from "./preserved-text.js";
import {
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator.js";

const FETCH_TIMEOUT_MS = 30_000;
const AI_SUMMARY_TIMEOUT_MS = 60_000;
const AI_SUMMARY_TIMEOUT_MESSAGE = "ai_summarize TIMEOUT";
const MAX_BACKGROUND_HTML_BYTES = 2 * 1024 * 1024;
const BASE_DELAY_MIN_MS = 2_500;
const BASE_DELAY_MAX_MS = 7_500;
const MAX_BACKOFF_LEVEL = 5;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FAILED_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_TRACKED = 2_000;
const RESPONSE_TOO_LARGE_PREFIX = "response_too_large";
const RECENT_INPUT_IDLE_MS = 10_000;
const UI_DEFER_DELAY_MS = 15_000;
const CONTENT_FETCH_MEMORY_DEFER_MS = 5 * 60_000;
const CONTENT_FETCH_WEBKIT_FOOTPRINT_DEFER_BYTES = 512 * 1024 * 1024;
const CONTENT_FETCH_WEBKIT_RESIDENT_DEFER_BYTES = 768 * 1024 * 1024;

interface ContentFetcherOptions {
  startupDelayMs?: number;
  memoryGuard?: boolean;
}

export interface FetcherStatus {
  pending: number;
  completed: number;
  failedCount: number;
  active: boolean;
  activeAgeMs?: number;
  nextDelayMs?: number;
  backoffLevel: number;
}

interface QueueEntry {
  globalId: string;
  url: string;
}

interface EnqueueOptions {
  priority?: boolean;
  force?: boolean;
  bypassStartupDelay?: boolean;
  reopenSaveDialogOnError?: boolean;
}

interface ContentFetchMemoryStats {
  appResidentBytes?: number;
  webkitFootprintBytes?: number;
  webkitTotalFootprintBytes?: number;
  webkitLargestFootprintBytes?: number;
  webkitResidentBytes?: number;
  webkitTotalResidentBytes?: number;
  webkitLargestResidentBytes?: number;
  webkitLargestProcessId?: number;
  webkitProcessCount?: number;
  webkitTelemetryAvailable?: boolean;
}

// In-memory queue and status
const queue: QueueEntry[] = [];
const inFlight = new Set<string>();
const failed = new Map<string, number>();
const reopenSaveDialogOnErrorIds = new Set<string>();
let completed = 0;
let running = false;
let workerTimer: ReturnType<typeof setTimeout> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeDoc: (() => void) | null = null;
let lastScannedDocItemCount: number | null = null;
let activeStartedAt: number | null = null;
let nextDelayMs: number | undefined;
let backoffLevel = 0;
let lastUserInteractionAt = 0;
let removeUserInteractionListeners: (() => void) | null = null;
let memoryGuardEnabled = false;
let startupDelayUntil = 0;

// Status subscribers
type StatusSubscriber = (status: FetcherStatus) => void;
const statusSubscribers = new Set<StatusSubscriber>();

function notifyStatus(): void {
  pruneFailed();
  const status: FetcherStatus = {
    pending: queue.length,
    completed,
    failedCount: failed.size,
    active: activeStartedAt !== null,
    activeAgeMs: activeStartedAt === null ? undefined : Date.now() - activeStartedAt,
    nextDelayMs,
    backoffLevel,
  };
  for (const sub of statusSubscribers) sub(status);
}

function startupDelayRemainingMs(now = Date.now()): number {
  return Math.max(0, startupDelayUntil - now);
}

function clearStartupDelay(): void {
  if (startupTimer !== null) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  startupDelayUntil = 0;
}

/** Subscribe to fetcher status changes */
export function subscribeToStatus(cb: StatusSubscriber): () => void {
  statusSubscribers.add(cb);
  return () => statusSubscribers.delete(cb);
}

/** Returns items from the doc that have a URL but no cached content */
function newStubItems(items: FeedItem[], options: { force?: boolean } = {}): QueueEntry[] {
  const queuedIds = new Set(queue.map((e) => e.globalId));
  return items
    .filter((item) => {
      if (queuedIds.has(item.globalId) || inFlight.has(item.globalId) || hasRecentFailure(item.globalId)) {
        return false;
      }
      const url = item.content.linkPreview?.url;
      return !!url && (options.force || !item.preservedContent?.text);
    })
    .map((item) => ({
      globalId: item.globalId,
      url: item.content.linkPreview!.url!,
    }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
}

function renderItemReaderHtml(item: FeedItem): string {
  const title = item.content.linkPreview?.title ?? item.content.text?.slice(0, 100) ?? item.author.displayName;
  const body = item.content.text ? textToParagraphs(item.content.text) : "";
  const media = item.content.mediaUrls
    .map((url, index) => {
      const type = item.content.mediaTypes[index];
      const safeUrl = escapeHtml(url);
      if (type === "video") {
        return `<figure><video src="${safeUrl}" controls playsinline></video></figure>`;
      }
      return `<figure><img src="${safeUrl}" alt="" /></figure>`;
    })
    .join("");

  return `<article><h1>${escapeHtml(title)}</h1>${media}${body}</article>`;
}

function pruneFailed(now = Date.now()): void {
  for (const [id, failedAt] of failed) {
    if (now - failedAt > FAILED_RETRY_COOLDOWN_MS) {
      failed.delete(id);
    }
  }

  if (failed.size <= MAX_FAILED_TRACKED) return;

  const overflow = failed.size - MAX_FAILED_TRACKED;
  const oldest = Array.from(failed.entries()).sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < overflow; i++) {
    const entry = oldest[i];
    if (entry) failed.delete(entry[0]);
  }
}

function hasRecentFailure(globalId: string, now = Date.now()): boolean {
  const failedAt = failed.get(globalId);
  if (!failedAt) return false;
  if (now - failedAt <= FAILED_RETRY_COOLDOWN_MS) return true;
  failed.delete(globalId);
  return false;
}

/**
 * Add items to the fetch queue.
 * Skips items already queued, already failed, or that already have content.
 */
export function enqueue(items: FeedItem[], options: EnqueueOptions = {}): void {
  const newEntries = newStubItems(items, { force: options.force });
  if (options.reopenSaveDialogOnError) {
    for (const entry of newEntries) {
      reopenSaveDialogOnErrorIds.add(entry.globalId);
    }
  }
  if (options.priority) {
    queue.unshift(...newEntries.reverse());
  } else {
    queue.push(...newEntries);
  }
  if (newEntries.length > 0) {
    if (options.bypassStartupDelay) {
      clearStartupDelay();
    }
    notifyStatus();
    if (running && activeStartedAt === null && workerTimer === null) {
      scheduleWorker(0);
    }
  }
}

export async function pinReaderItem(item: FeedItem): Promise<void> {
  const url = item.content.linkPreview?.url;
  await contentCache.set(item.globalId, renderItemReaderHtml(item));
  if (url) {
    enqueue([item], { priority: true, force: true });
  }
}

function maybeScanVisibleItems(items: FeedItem[], docItemCount: number): void {
  if (lastScannedDocItemCount === docItemCount) return;
  lastScannedDocItemCount = docItemCount;
  enqueue(items);
}

type ProcessOutcome = "success" | "skipped" | "backoff" | "deferred" | "idle";

function isInteractiveUiOpen(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(".theme-settings-shell") ||
      document.querySelector(".theme-dialog-shell") ||
      document.querySelector('[role="dialog"]'),
  );
}

function recentUserInteractionAgeMs(now = Date.now()): number {
  if (!lastUserInteractionAt) return Number.POSITIVE_INFINITY;
  return now - lastUserInteractionAt;
}

function getUiDeferReason(now = Date.now()): string | null {
  if (isInteractiveUiOpen()) return "interactive_ui_open";
  const inputAgeMs = recentUserInteractionAgeMs(now);
  if (inputAgeMs < RECENT_INPUT_IDLE_MS) {
    return `recent_user_input:${Math.max(0, Math.round(inputAgeMs)).toLocaleString()}`;
  }
  return null;
}

function startUserInteractionTracking(): void {
  if (removeUserInteractionListeners || typeof window === "undefined") return;
  const markInput = () => {
    lastUserInteractionAt = Date.now();
  };
  window.addEventListener("pointerdown", markInput, { passive: true });
  window.addEventListener("keydown", markInput);
  removeUserInteractionListeners = () => {
    window.removeEventListener("pointerdown", markInput);
    window.removeEventListener("keydown", markInput);
    removeUserInteractionListeners = null;
  };
}

function randomDelayForBackoff(level: number): number {
  const multiplier = 2 ** Math.min(level, MAX_BACKOFF_LEVEL);
  const min = BASE_DELAY_MIN_MS * multiplier;
  const max = BASE_DELAY_MAX_MS * multiplier;
  return Math.round(min + Math.random() * (max - min));
}

function increaseBackoff(reason: string): void {
  const previous = backoffLevel;
  backoffLevel = Math.min(MAX_BACKOFF_LEVEL, backoffLevel + 1);
  if (backoffLevel !== previous) {
    log.warn(`[content-fetcher] backoff increased reason=${reason} level=${backoffLevel.toLocaleString()}`);
  }
}

function decayBackoff(): void {
  if (backoffLevel === 0) return;
  backoffLevel -= 1;
  log.info(`[content-fetcher] backoff decayed level=${backoffLevel.toLocaleString()}`);
}

async function withAiTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error(AI_SUMMARY_TIMEOUT_MESSAGE));
        }, AI_SUMMARY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

function isAiTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === AI_SUMMARY_TIMEOUT_MESSAGE;
}

function isResponseTooLargeError(message: string): boolean {
  return message.startsWith(RESPONSE_TOO_LARGE_PREFIX);
}

function dispatchSaveContentError(entry: QueueEntry, message: string): void {
  if (!reopenSaveDialogOnErrorIds.delete(entry.globalId)) return;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("freed:save-content-details-error", {
      detail: {
        initialUrl: entry.url,
        errorMessage: message,
      },
    }),
  );
}

function scheduleWorker(delayMs: number): void {
  if (!running || workerTimer !== null) return;
  const startupRemainingMs = startupDelayRemainingMs();
  if (startupRemainingMs > 0) {
    nextDelayMs = startupRemainingMs;
    notifyStatus();
    return;
  }
  nextDelayMs = delayMs;
  workerTimer = setTimeout(() => {
    workerTimer = null;
    nextDelayMs = undefined;
    void runWorkerOnce();
  }, delayMs);
  notifyStatus();
}

function scheduleStartupDelay(delayMs: number): void {
  clearStartupDelay();
  if (!running || delayMs <= 0) {
    startupDelayUntil = 0;
    scheduleWorker(0);
    return;
  }

  startupDelayUntil = Date.now() + delayMs;
  nextDelayMs = delayMs;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    startupDelayUntil = 0;
    nextDelayMs = undefined;
    scheduleWorker(0);
  }, delayMs);
  log.info(`[content-fetcher] startup delay scheduled delay_ms=${delayMs.toLocaleString()}`);
  notifyStatus();
}

async function getContentFetchMemoryDeferReason(): Promise<string | null> {
  if (!memoryGuardEnabled) return null;

  let stats: ContentFetchMemoryStats;
  try {
    stats = await invoke<ContentFetchMemoryStats>("get_runtime_memory_stats");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`[content-fetcher] memory guard sample failed err=${msg}`);
    return null;
  }

  if (!stats.webkitTelemetryAvailable) return null;

  const webkitFootprintBytes =
    stats.webkitTotalFootprintBytes ??
    stats.webkitFootprintBytes ??
    stats.webkitLargestFootprintBytes ??
    0;
  const webkitResidentBytes =
    stats.webkitTotalResidentBytes ??
    stats.webkitResidentBytes ??
    stats.webkitLargestResidentBytes ??
    0;

  if (webkitFootprintBytes >= CONTENT_FETCH_WEBKIT_FOOTPRINT_DEFER_BYTES) {
    return `webkit_footprint:${webkitFootprintBytes.toLocaleString()}`;
  }
  if (webkitResidentBytes >= CONTENT_FETCH_WEBKIT_RESIDENT_DEFER_BYTES) {
    return `webkit_rss:${webkitResidentBytes.toLocaleString()}`;
  }
  return null;
}

async function runWorkerOnce(): Promise<void> {
  if (!running || activeStartedAt !== null) return;
  if (queue.length === 0) {
    notifyStatus();
    return;
  }

  const uiDeferReason = getUiDeferReason();
  if (uiDeferReason) {
    log.info(`[content-fetcher] deferred by UI reason=${uiDeferReason}`);
    notifyStatus();
    scheduleWorker(UI_DEFER_DELAY_MS);
    return;
  }

  const memoryDeferReason = await getContentFetchMemoryDeferReason();
  if (memoryDeferReason) {
    log.warn(`[content-fetcher] deferred by memory guard reason=${memoryDeferReason}`);
    notifyStatus();
    scheduleWorker(CONTENT_FETCH_MEMORY_DEFER_MS);
    return;
  }

  activeStartedAt = Date.now();
  notifyStatus();

  let outcome: ProcessOutcome = "idle";
  try {
    outcome = await runBackgroundJob({
      kind: "content-fetch",
      source: "content-fetcher",
      timeoutMs: 180_000,
      run: processNext,
    });
  } catch (err) {
    if (isBackgroundRuntimeDeferredError(err)) {
      log.info(`[content-fetcher] deferred by background runtime reason=${err.reason}`);
      outcome = "deferred";
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[content-fetcher] unexpected error in processNext: ${msg}`);
      addDebugEvent("error", `[Fetcher] unexpected error in processNext: ${msg}`);
      outcome = "backoff";
    }
  } finally {
    activeStartedAt = null;
  }

  if (outcome === "success") {
    decayBackoff();
  } else if (outcome === "backoff") {
    increaseBackoff("job_error");
  }

  notifyStatus();

  if (running && queue.length > 0) {
    const delayBackoffLevel = outcome === "deferred" ? Math.max(1, backoffLevel) : backoffLevel;
    scheduleWorker(randomDelayForBackoff(delayBackoffLevel));
  }
}

/** Process one item from the front of the queue */
async function processNext(): Promise<ProcessOutcome> {
  if (queue.length === 0) return "idle";

  const entry = queue.shift()!;
  inFlight.add(entry.globalId);
  notifyStatus();
  let outcome: ProcessOutcome = "success";

  try {
    // Fetch HTML via Tauri IPC (bypasses CORS, uses native HTTP).
    // Race against a 30s timeout so a stalled network request on a sleeping
    // machine can't freeze the interval forever.
    const html = await Promise.race([
      invoke<string>("fetch_url", { url: entry.url, maxBytes: MAX_BACKGROUND_HTML_BYTES }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("fetch_url TIMEOUT")), FETCH_TIMEOUT_MS),
      ),
    ]);

    // Extract structured content using browser-safe Readability
    const content = extractContentBrowser(html, entry.url);
    const metadata = extractMetadataBrowser(html, entry.url);

    // Write Readability-extracted article HTML to device content cache.
    // Intentionally NOT the raw page HTML -- that contains <style>, <script>,
    // and other full-page elements that would leak into the app DOM.
    await contentCache.set(entry.globalId, content.html);

    // Get current AI preferences from the store (worker keeps preferences in sync)
    const prefs = (useAppStore.getState().preferences as { ai?: AIPreferences })?.ai;

    // Keep the synced document small. Full article HTML already lives in the
    // device-local cache, so Automerge only needs a compact fallback excerpt.
    let summaryText = toSyncedPreservedText(content.text);
    let extraTopics: string[] = [];

    // Optionally run AI summarization (replaces raw text in Automerge with a concise summary)
    if (prefs?.autoSummarize && prefs.provider !== "none") {
      const cloudProvider = prefs.provider === "openai" ||
        prefs.provider === "anthropic" ||
        prefs.provider === "gemini"
        ? prefs.provider
        : null;
      const apiKey = cloudProvider ? await secureStorage.getApiKey(cloudProvider) : null;
      try {
        const aiResult = await withAiTimeout((signal) =>
          summarize(content.text, prefs, apiKey, { signal, throwOnError: true })
        );
        if (aiResult) {
          summaryText = toSyncedPreservedText(aiResult.summary);
          extraTopics = prefs.extractTopics ? aiResult.topics : [];
        }
      } catch (err) {
        outcome = "backoff";
        if (isAiTimeoutError(err)) {
          log.warn(`[content-fetcher] ai_summarize TIMEOUT url=${entry.url}`);
          addDebugEvent("error", `[Fetcher] ai_summarize TIMEOUT: ${entry.url}`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`[content-fetcher] ai summarize failed url=${entry.url} err=${msg}`);
          addDebugEvent("error", `[Fetcher] AI summarize failed for ${entry.url}: ${msg}`);
        }
      }
    }

    // Write metadata + short text summary to Automerge (syncs to all devices).
    // author is omitted rather than set to undefined — Automerge's proxy
    // throws on undefined assignments and updateFeedItem uses Object.assign.
    const resolvedAuthor = content.author ?? metadata.author;
    await docUpdateFeedItem(entry.globalId, {
      preservedContent: {
        text: summaryText,
        ...(resolvedAuthor !== undefined ? { author: resolvedAuthor } : {}),
        publishedAt: metadata.publishedAt,
        wordCount: content.wordCount,
        readingTime: content.readingTime,
        preservedAt: Date.now(),
      },
      ...(extraTopics.length > 0 ? { topics: extraTopics } : {}),
    });

    completed++;
    reopenSaveDialogOnErrorIds.delete(entry.globalId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg === "fetch_url TIMEOUT";
    if (isTimeout) {
      log.warn(`[content-fetcher] fetch_url TIMEOUT url=${entry.url}`);
      addDebugEvent("error", `[Fetcher] fetch_url TIMEOUT: ${entry.url}`);
      // Re-enqueue so the item is retried next cycle rather than permanently failed.
      queue.push(entry);
      outcome = "backoff";
    } else if (isResponseTooLargeError(msg)) {
      log.warn(
        `[content-fetcher] skipped oversized article url=${entry.url} ` +
          `limit_bytes=${MAX_BACKGROUND_HTML_BYTES.toLocaleString()} err=${msg}`,
      );
      failed.set(entry.globalId, Date.now());
      pruneFailed();
      addDebugEvent("error", `[Fetcher] skipped oversized article: ${entry.url}`);
      dispatchSaveContentError(entry, "Freed could not save details for this URL because the response was too large.");
      outcome = "skipped";
    } else {
      log.warn(`[content-fetcher] fetch failed url=${entry.url} err=${msg}`);
      failed.set(entry.globalId, Date.now());
      pruneFailed();
      addDebugEvent("error", `[Fetcher] failed to fetch ${entry.url}: ${msg}`);
      dispatchSaveContentError(entry, msg || "Freed could not save details for this URL.");
      outcome = "backoff";
    }
  } finally {
    inFlight.delete(entry.globalId);
  }

  notifyStatus();
  return outcome;
}

/**
 * Start the background fetcher.
 * Safe to call multiple times -- a second call is a no-op if already running.
 */
export function start(options: ContentFetcherOptions = {}): void {
  if (running) return;
  running = true;
  memoryGuardEnabled = options.memoryGuard ?? false;
  lastScannedDocItemCount = null;

  // Wire up the Automerge subscription so stub items arriving via relay sync
  // are automatically enqueued for background fetch.
  //
  // Important: do not rescan the whole visible feed on every mutation. Mark as
  // read, archive toggles, and preference changes all trigger document updates,
  // and a full enqueue() scan here turns those tiny mutations into O(n)
  // churn across the whole library. Only rescan when the document item count
  // changes, which is the common case for newly imported or relayed items.
  unsubscribeDoc = subscribe((state) => {
    // state.items contains non-hidden, ranked items from DocState.
    // Stub items we care about are not hidden or archived, so the visible list
    // is sufficient when the library grows or shrinks.
    maybeScanVisibleItems(state.items, state.docItemCount);
  });

  log.info("[content-fetcher] started");
  startUserInteractionTracking();

  scheduleStartupDelay(options.startupDelayMs ?? 0);

  // Periodic heartbeat so logs show the fetcher is still alive overnight.
  heartbeatHandle = setInterval(() => {
    log.info(
      `[content-fetcher] heartbeat items_queued=${queue.length.toLocaleString()} ` +
        `active=${String(activeStartedAt !== null)} backoff_level=${backoffLevel.toLocaleString()} ` +
        `next_delay_ms=${(nextDelayMs ?? 0).toLocaleString()} ` +
        `completed=${completed.toLocaleString()} failed=${failed.size.toLocaleString()}`,
    );
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the background fetcher and clean up subscriptions.
 */
export function stop(): void {
  if (!running) return;
  running = false;

  if (workerTimer !== null) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  clearStartupDelay();
  nextDelayMs = undefined;
  activeStartedAt = null;
  memoryGuardEnabled = false;

  if (heartbeatHandle !== null) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }

  if (unsubscribeDoc) {
    unsubscribeDoc();
    unsubscribeDoc = null;
  }

  removeUserInteractionListeners?.();
  lastUserInteractionAt = 0;

  log.info("[content-fetcher] stopped");
}

/** Get current fetcher status without subscribing */
export function getStatus(): FetcherStatus {
  pruneFailed();
  return {
    pending: queue.length,
    completed,
    failedCount: failed.size,
    active: activeStartedAt !== null,
    activeAgeMs: activeStartedAt === null ? undefined : Date.now() - activeStartedAt,
    nextDelayMs,
    backoffLevel,
  };
}
