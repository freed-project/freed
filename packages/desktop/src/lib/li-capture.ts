/**
 * LinkedIn capture service (WebView-based)
 *
 * Triggers the Rust backend to navigate a hidden Tauri WebView to
 * linkedin.com/feed, wait for the page to render, then inject an extraction
 * script that reads posts from the DOM. The extracted data is sent back
 * via Tauri event IPC ('li-feed-data').
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RawLiPost } from "@freed/capture-linkedin/browser";
import {
  liPostsToFeedItems,
  deduplicateFeedItems,
} from "@freed/capture-linkedin/browser";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getLiScraperDebugWindow } from "./scraper-prefs";

// =============================================================================
// Rate Limiting
// =============================================================================

let lastScrapeAt = 0;
// 30 min base interval + up to 6 min of jitter. LinkedIn is more sensitive
// than Facebook to regular scraping patterns.
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const INTERVAL_JITTER_MS = 6 * 60 * 1000;

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

export interface LiSyncDiag {
  postsExtracted: number;
  itemsNormalized: number;
  itemsDeduplicated: number;
  itemsAdded: number;
  errorStage: string | null;
  errorMessage: string | null;
}

export interface LiSyncResult {
  items: ReturnType<typeof liPostsToFeedItems>;
  diag: LiSyncDiag;
}

// =============================================================================
// Core scrape trigger
// =============================================================================

/**
 * Trigger a scrape via the hidden WebView and wait for results.
 *
 * Flow:
 * 1. Register a listener for 'li-feed-data' events
 * 2. Invoke 'li_scrape_feed' (Rust navigates WebView + injects script)
 * 3. Wait for the extraction script to emit results via the event
 * 4. Normalize raw posts to FeedItem[]
 *
 * LinkedIn's extraction aggregates posts across multiple scroll passes.
 * The Rust command fires multiple 'li-feed-data' events (one per pass).
 * We accumulate them until the final pass, identified by a 'done' flag.
 */
export async function fetchLiFeed(): Promise<LiSyncResult> {
  const diag: LiSyncDiag = {
    postsExtracted: 0,
    itemsNormalized: 0,
    itemsDeduplicated: 0,
    itemsAdded: 0,
    errorStage: null,
    errorMessage: null,
  };

  return new Promise<LiSyncResult>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    const allRawPosts: RawLiPost[] = [];
    const seenUrns = new Set<string>();

    // Timeout if the WebView takes too long
    const timeout = setTimeout(() => {
      unlisten?.();
      if (allRawPosts.length > 0) {
        // We have partial results — return them rather than nothing
        finalize(allRawPosts);
      } else {
        diag.errorStage = "timeout";
        diag.errorMessage = "Scrape timed out after 60 seconds";
        resolve({ items: [], diag });
      }
    }, 60_000);

    function finalize(posts: RawLiPost[]) {
      clearTimeout(timeout);
      unlisten?.();

      diag.postsExtracted = posts.length;

      if (posts.length === 0) {
        resolve({ items: [], diag });
        return;
      }

      try {
        const normalized = liPostsToFeedItems(posts);
        diag.itemsNormalized = normalized.length;

        const items = deduplicateFeedItems(normalized);
        diag.itemsDeduplicated = items.length;

        resolve({ items, diag });
      } catch (err) {
        diag.errorStage = "normalize";
        diag.errorMessage = err instanceof Error ? err.message : String(err);
        resolve({ items: [], diag });
      }
    }

    // Listen for extraction events (multiple per scrape — one per scroll pass)
    listen<{
      posts: RawLiPost[];
      error?: string;
      extractedAt: number;
      url: string;
      candidateCount?: number;
      scrollY?: number;
      done?: boolean;
    }>(
      "li-feed-data",
      (event) => {
        const { posts, error, candidateCount, done } = event.payload;

        addDebugEvent(
          "change",
          `[LI] extraction pass: candidates=${candidateCount ?? "?"}, posts=${posts.length}${done ? " (final)" : ""}`,
        );

        if (error) {
          clearTimeout(timeout);
          unlisten?.();
          diag.errorStage = "extract";
          diag.errorMessage = error;
          resolve({ items: [], diag });
          return;
        }

        // Accumulate unique posts across scroll passes
        for (const post of posts) {
          const key = post.urn ?? post.url ?? null;
          if (key && !seenUrns.has(key)) {
            seenUrns.add(key);
            allRawPosts.push(post);
          }
        }

        if (done) {
          finalize(allRawPosts);
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });

    // Trigger the Rust command
    invoke("li_scrape_feed", { showWindow: getLiScraperDebugWindow() }).catch(
      (err) => {
        clearTimeout(timeout);
        unlisten?.();
        diag.errorStage = "invoke";
        diag.errorMessage = err instanceof Error ? err.message : String(err);
        resolve({ items: [], diag });
      },
    );
  });
}

// =============================================================================
// Store Integration
// =============================================================================

/**
 * Capture LinkedIn feed and add items to the store.
 * Respects rate limiting to avoid triggering LinkedIn's anti-bot measures.
 */
export async function captureLiFeed(): Promise<LiSyncResult> {
  if (isRateLimited()) {
    const minutesRemaining = Math.ceil(
      (MIN_INTERVAL_MS - (Date.now() - lastScrapeAt)) / 60_000,
    );
    addDebugEvent(
      "change",
      `[LI] rate limited, next scrape in ~${minutesRemaining} min`,
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
    const result = await fetchLiFeed();

    if (result.diag.errorStage) {
      const detail = `[LI] sync failed at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      store.setError(result.diag.errorMessage ?? result.diag.errorStage);
      addDebugEvent("error", detail);
      return result;
    }

    recordScrape();

    if (result.items.length > 0) {
      const before = store.items.filter((i) => i.platform === "linkedin").length;
      await store.addItems(result.items);
      const after = useAppStore
        .getState()
        .items.filter((i) => i.platform === "linkedin").length;
      result.diag.itemsAdded = Math.max(0, after - before);
      addDebugEvent(
        "change",
        `[LI] synced: ${result.diag.postsExtracted.toLocaleString()} posts extracted, ${result.diag.itemsAdded.toLocaleString()} new items`,
      );
    } else {
      addDebugEvent("change", "[LI] sync complete: feed returned 0 posts");
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture LinkedIn feed";
    store.setError(message);
    addDebugEvent("error", `[LI] captureLiFeed threw: ${message}`);
    throw error;
  } finally {
    store.setLoading(false);
  }
}
