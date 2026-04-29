/**
 * Background content fetcher for desktop
 *
 * Maintains an in-memory queue of FeedItems that need their HTML fetched,
 * extracted, and cached. Processes one item every 2 seconds to be polite to
 * remote servers.
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

const FETCH_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FAILED_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_TRACKED = 2_000;

export interface FetcherStatus {
  pending: number;
  completed: number;
  failedCount: number;
}

interface QueueEntry {
  globalId: string;
  url: string;
}

// In-memory queue and status
const queue: QueueEntry[] = [];
const inFlight = new Set<string>();
const failed = new Map<string, number>();
let completed = 0;
let running = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeDoc: (() => void) | null = null;
let lastScannedDocItemCount: number | null = null;

// Status subscribers
type StatusSubscriber = (status: FetcherStatus) => void;
const statusSubscribers = new Set<StatusSubscriber>();

function notifyStatus(): void {
  pruneFailed();
  const status: FetcherStatus = {
    pending: queue.length,
    completed,
    failedCount: failed.size,
  };
  for (const sub of statusSubscribers) sub(status);
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
export function enqueue(items: FeedItem[], options: { priority?: boolean; force?: boolean } = {}): void {
  const newEntries = newStubItems(items, { force: options.force });
  if (options.priority) {
    queue.unshift(...newEntries.reverse());
  } else {
    queue.push(...newEntries);
  }
  if (newEntries.length > 0) notifyStatus();
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

/** Process one item from the front of the queue */
async function processNext(): Promise<void> {
  if (queue.length === 0) return;

  const entry = queue.shift()!;
  inFlight.add(entry.globalId);
  notifyStatus();

  try {
    // Fetch HTML via Tauri IPC (bypasses CORS, uses native HTTP).
    // Race against a 30s timeout so a stalled network request on a sleeping
    // machine can't freeze the interval forever.
    const html = await Promise.race([
      invoke<string>("fetch_url", { url: entry.url }),
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
      const aiResult = await summarize(content.text, prefs, apiKey);
      if (aiResult) {
        summaryText = toSyncedPreservedText(aiResult.summary);
        extraTopics = prefs.extractTopics ? aiResult.topics : [];
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg === "fetch_url TIMEOUT";
    if (isTimeout) {
      log.warn(`[content-fetcher] fetch_url TIMEOUT url=${entry.url}`);
      addDebugEvent("error", `[Fetcher] fetch_url TIMEOUT: ${entry.url}`);
      // Re-enqueue so the item is retried next cycle rather than permanently failed.
      queue.push(entry);
    } else {
      log.warn(`[content-fetcher] fetch failed url=${entry.url} err=${msg}`);
      failed.set(entry.globalId, Date.now());
      pruneFailed();
      addDebugEvent("error", `[Fetcher] failed to fetch ${entry.url}: ${msg}`);
    }
  } finally {
    inFlight.delete(entry.globalId);
  }

  notifyStatus();
}

/**
 * Start the background fetcher.
 * Safe to call multiple times -- a second call is a no-op if already running.
 */
export function start(): void {
  if (running) return;
  running = true;
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

  // Process one item every 2 seconds -- polite to remote servers
  intervalHandle = setInterval(() => {
    processNext().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[content-fetcher] unexpected error in processNext: ${msg}`);
      addDebugEvent("error", `[Fetcher] unexpected error in processNext: ${msg}`);
    });
  }, 2_000);

  // Periodic heartbeat so logs show the fetcher is still alive overnight.
  heartbeatHandle = setInterval(() => {
    log.info(
      `[content-fetcher] heartbeat items_queued=${queue.length} completed=${completed} failed=${failed.size}`,
    );
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the background fetcher and clean up subscriptions.
 */
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

  log.info("[content-fetcher] stopped");
}

/** Get current fetcher status without subscribing */
export function getStatus(): FetcherStatus {
  pruneFailed();
  return { pending: queue.length, completed, failedCount: failed.size };
}
