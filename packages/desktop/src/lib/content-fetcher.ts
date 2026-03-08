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

export interface FetcherStatus {
  pending: number;
  completed: number;
  failed: string[]; // globalIds of permanently-failed items
}

interface QueueEntry {
  globalId: string;
  url: string;
}

// In-memory queue and status
const queue: QueueEntry[] = [];
const failed = new Set<string>();
let completed = 0;
let running = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeDoc: (() => void) | null = null;

// Status subscribers
type StatusSubscriber = (status: FetcherStatus) => void;
const statusSubscribers = new Set<StatusSubscriber>();

function notifyStatus(): void {
  const status: FetcherStatus = {
    pending: queue.length,
    completed,
    failed: Array.from(failed),
  };
  for (const sub of statusSubscribers) sub(status);
}

/** Subscribe to fetcher status changes */
export function subscribeToStatus(cb: StatusSubscriber): () => void {
  statusSubscribers.add(cb);
  return () => statusSubscribers.delete(cb);
}

/** Returns items from the doc that have a URL but no cached content */
function newStubItems(items: FeedItem[]): QueueEntry[] {
  const queuedIds = new Set(queue.map((e) => e.globalId));
  return items
    .filter((item) => {
      if (queuedIds.has(item.globalId) || failed.has(item.globalId)) return false;
      const url = item.content.linkPreview?.url;
      return !!url && !item.preservedContent?.text;
    })
    .map((item) => ({
      globalId: item.globalId,
      url: item.content.linkPreview!.url!,
    }));
}

/**
 * Add items to the fetch queue.
 * Skips items already queued, already failed, or that already have content.
 */
export function enqueue(items: FeedItem[]): void {
  const newEntries = newStubItems(items);
  queue.push(...newEntries);
  if (newEntries.length > 0) notifyStatus();
}

/** Process one item from the front of the queue */
async function processNext(): Promise<void> {
  if (queue.length === 0) return;

  const entry = queue.shift()!;
  notifyStatus();

  try {
    // Fetch HTML via Tauri IPC (bypasses CORS, uses native HTTP)
    const html = await invoke<string>("fetch_url", { url: entry.url });

    // Extract structured content using browser-safe Readability
    const content = extractContentBrowser(html, entry.url);
    const metadata = extractMetadataBrowser(html, entry.url);

    // Write full HTML to the device content cache (Layer 2 -- NOT Automerge)
    await contentCache.set(entry.globalId, html);

    // Get current AI preferences from the store (worker keeps preferences in sync)
    const prefs = (useAppStore.getState().preferences as { ai?: AIPreferences })?.ai;

    let summaryText = content.text;
    let extraTopics: string[] = [];

    // Optionally run AI summarization (replaces raw text in Automerge with a concise summary)
    if (prefs?.autoSummarize && prefs.provider !== "none") {
      const apiKey = prefs.provider !== "ollama"
        ? await secureStorage.getApiKey(prefs.provider as "openai" | "anthropic" | "gemini")
        : null;
      const aiResult = await summarize(content.text, prefs, apiKey);
      if (aiResult) {
        summaryText = aiResult.summary;
        extraTopics = aiResult.topics;
      }
    }

    // Write metadata + short text summary to Automerge (syncs to all devices).
    // author is omitted rather than set to undefined — Automerge's proxy
    // throws on undefined assignments and updateFeedItem uses Object.assign.
    const resolvedAuthor = content.author ?? metadata.author;
    await docUpdateFeedItem(entry.globalId, {
      preservedContent: {
        text: summaryText.slice(0, 10_000),
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
    console.warn(`[content-fetcher] Failed to fetch ${entry.url}:`, err);
    failed.add(entry.globalId);
    addDebugEvent("error", `[Fetcher] failed to fetch ${entry.url}: ${msg}`);
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

  // Wire up the Automerge subscription so stub items arriving via relay sync
  // are automatically enqueued for background fetch.
  unsubscribeDoc = subscribe((state) => {
    // state.items contains non-hidden, ranked items (from DocState).
    // allItemIds covers hidden/archived — stubs are never archived, so items is sufficient.
    enqueue(state.items);
  });

  // Process one item every 2 seconds -- polite to remote servers
  intervalHandle = setInterval(() => {
    processNext().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[content-fetcher] Unexpected error:", err);
      addDebugEvent("error", `[Fetcher] unexpected error in processNext: ${msg}`);
    });
  }, 2_000);
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

  if (unsubscribeDoc) {
    unsubscribeDoc();
    unsubscribeDoc = null;
  }
}

/** Get current fetcher status without subscribing */
export function getStatus(): FetcherStatus {
  return { pending: queue.length, completed, failed: Array.from(failed) };
}
