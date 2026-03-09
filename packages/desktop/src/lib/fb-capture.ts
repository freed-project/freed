/**
 * Facebook capture service (WebView-based)
 *
 * Triggers the Rust backend to navigate a hidden Tauri WebView to
 * facebook.com, wait for the page to render, then inject an extraction
 * script that reads posts from the DOM. The extracted data is sent back
 * via Tauri event IPC ('fb-feed-data').
 *
 * This approach is indistinguishable from a real user browsing Facebook
 * because the WebView IS a real browser (WebKit on macOS) executing all
 * of Facebook's JavaScript, telemetry, and headers natively.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RawFbPost } from "@freed/capture-facebook/browser";
import {
  fbPostsToFeedItems,
  deduplicateFeedItems,
} from "@freed/capture-facebook/browser";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getPlatformUA, selectPlatformUA, clearPlatformUA } from "./user-agent";

// =============================================================================
// Rate Limiting
// =============================================================================

let lastScrapeAt = 0;
// 20 min base interval + up to 4 min of jitter so scrapes don't land at
// perfectly regular clock-tick intervals (machine-like regularity is a signal).
const MIN_INTERVAL_MS = 20 * 60 * 1000;
const INTERVAL_JITTER_MS = 4 * 60 * 1000;

function isRateLimited(): boolean {
  if (lastScrapeAt === 0) return false;
  const jitter = Math.random() * INTERVAL_JITTER_MS;
  return Date.now() - lastScrapeAt < MIN_INTERVAL_MS + jitter;
}

function recordScrape(): void {
  lastScrapeAt = Date.now();
}

// =============================================================================
// Diagnostic Types
// =============================================================================

export interface FbSyncDiag {
  postsExtracted: number;
  itemsNormalized: number;
  itemsDeduplicated: number;
  itemsAdded: number;
  errorStage: string | null;
  errorMessage: string | null;
}

export interface FbSyncResult {
  items: ReturnType<typeof fbPostsToFeedItems>;
  diag: FbSyncDiag;
}

// =============================================================================
// Core scrape trigger
// =============================================================================

/**
 * Trigger a scrape via the hidden WebView and wait for results.
 *
 * Flow:
 * 1. Register a listener for 'fb-feed-data' events
 * 2. Invoke 'fb_scrape_feed' (Rust navigates WebView + injects script)
 * 3. Wait for the extraction script to emit results via the event
 * 4. Normalize raw posts to FeedItem[]
 */
export async function fetchFbFeed(): Promise<FbSyncResult> {
  const diag: FbSyncDiag = {
    postsExtracted: 0,
    itemsNormalized: 0,
    itemsDeduplicated: 0,
    itemsAdded: 0,
    errorStage: null,
    errorMessage: null,
  };

  return new Promise<FbSyncResult>((resolve) => {
    let unlisten: UnlistenFn | null = null;

    // Timeout if the WebView takes too long (30s for page load + extraction)
    const timeout = setTimeout(() => {
      unlisten?.();
      diag.errorStage = "timeout";
      diag.errorMessage = "Scrape timed out after 30 seconds";
      resolve({ items: [], diag });
    }, 30_000);

    // Listen for diagnostics (fires before extraction)
    listen("fb-diag", (diagEvent) => {
      const diag = diagEvent.payload as Record<string, unknown>;
      addDebugEvent("change", `[FB] DOM diag: feedUnits=${diag.feedUnits}, fallback=${diag.feedUnitsFallback}, feed=${diag.feedContainer}, h4s=${diag.h4Count}, bodyLen=${diag.bodyLen}, url=${diag.url}, tauriEmit=${diag.hasTauriEmit}`);
      console.log("[FB] DOM diagnostics:", diag);
    }).then((fn) => {
      // Auto-cleanup after 35 seconds
      setTimeout(() => fn(), 35_000);
    });

    // Listen for the extraction result
    listen<{ posts: RawFbPost[]; error?: string; extractedAt: number; url: string; strategy?: string; candidateCount?: number }>(
      "fb-feed-data",
      (event) => {
        clearTimeout(timeout);
        unlisten?.();

        const { posts, error, strategy, candidateCount } = event.payload;

        addDebugEvent("change", `[FB] extraction: strategy=${strategy ?? "?"}, candidates=${candidateCount ?? "?"}, posts=${posts.length}`);

        if (error) {
          diag.errorStage = "extract";
          diag.errorMessage = error;
          resolve({ items: [], diag });
          return;
        }

        diag.postsExtracted = posts.length;

        if (posts.length === 0) {
          resolve({ items: [], diag });
          return;
        }

        try {
          const normalized = fbPostsToFeedItems(posts);
          diag.itemsNormalized = normalized.length;

          const items = deduplicateFeedItems(normalized);
          diag.itemsDeduplicated = items.length;

          resolve({ items, diag });
        } catch (err) {
          diag.errorStage = "normalize";
          diag.errorMessage = err instanceof Error ? err.message : String(err);
          resolve({ items: [], diag });
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });

    // Trigger the Rust command
    invoke("fb_scrape_feed").catch((err) => {
      clearTimeout(timeout);
      unlisten?.();
      diag.errorStage = "invoke";
      diag.errorMessage = err instanceof Error ? err.message : String(err);
      resolve({ items: [], diag });
    });
  });
}

// =============================================================================
// Store Integration
// =============================================================================

/**
 * Capture Facebook feed and add items to the store.
 * Respects rate limiting to avoid triggering Facebook's anti-bot measures.
 */
export async function captureFbFeed(): Promise<FbSyncResult> {
  if (isRateLimited()) {
    const minutesRemaining = Math.ceil(
      (MIN_INTERVAL_MS - (Date.now() - lastScrapeAt)) / 60_000,
    );
    addDebugEvent(
      "change",
      `[FB] rate limited, next scrape in ~${minutesRemaining} min`,
    );
    return {
      items: [],
      diag: {
        postsExtracted: 0,
        itemsNormalized: 0,
        itemsDeduplicated: 0,
        itemsAdded: 0,
        errorStage: "rate_limit",
        errorMessage: `Rate limited. Try again in ~${minutesRemaining} minutes.`,
      },
    };
  }

  const store = useAppStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await fetchFbFeed();
    recordScrape();

    if (result.diag.errorStage) {
      const detail = `[FB] sync failed at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      store.setError(result.diag.errorMessage ?? result.diag.errorStage);
      addDebugEvent("error", detail);
      return result;
    }

    if (result.items.length > 0) {
      const before = store.items.filter((i) => i.platform === "facebook").length;
      await store.addItems(result.items);
      const after = useAppStore
        .getState()
        .items.filter((i) => i.platform === "facebook").length;
      result.diag.itemsAdded = Math.max(0, after - before);
      addDebugEvent(
        "change",
        `[FB] synced: ${result.diag.postsExtracted.toLocaleString()} posts extracted, ${result.diag.itemsAdded.toLocaleString()} new items`,
      );
    } else {
      addDebugEvent("change", "[FB] sync complete: feed returned 0 posts");
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture Facebook feed";
    store.setError(message);
    addDebugEvent("error", `[FB] captureFbFeed threw: ${message}`);
    throw error;
  } finally {
    store.setLoading(false);
  }
}
