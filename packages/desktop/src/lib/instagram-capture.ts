/**
 * Instagram capture service (WebView-based)
 *
 * Triggers the Rust backend to navigate a Tauri WebView to
 * instagram.com, wait for the page to render, then inject an extraction
 * script that reads posts from the DOM. The extracted data is sent back
 * via Tauri event IPC ('ig-feed-data').
 *
 * This approach is indistinguishable from a real user browsing Instagram
 * because the WebView IS a real browser (WebKit on macOS) executing all
 * of Instagram's JavaScript, telemetry, and headers natively.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RawIgPost } from "@freed/capture-instagram/browser";
import {
  igPostsToFeedItems,
  deduplicateFeedItems,
} from "@freed/capture-instagram/browser";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getIgScraperWindowMode } from "./scraper-prefs";
import { storeIgAuthState } from "./instagram-auth";
import { attachScraperMediaDiagListener } from "./scraper-media-diag";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import { formatBytesForMemoryLog, prepareSocialScrapeMemory } from "./memory-monitor";
import { archiveRecentProviderMedia, upsertMediaVaultRosterFromItems } from "./media-vault";
import { socialProviderCopy } from "./social-provider-copy";

// =============================================================================
// Rate Limiting
// =============================================================================

let lastScrapeAt = 0;
const MIN_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes minimum between scrapes

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

export interface IgSyncDiag {
  postsExtracted: number;
  itemsNormalized: number;
  itemsDeduplicated: number;
  itemsAdded: number;
  errorStage: string | null;
  errorMessage: string | null;
}

export interface IgSyncResult {
  items: ReturnType<typeof igPostsToFeedItems>;
  diag: IgSyncDiag;
}

// =============================================================================
// Core scrape trigger
// =============================================================================

/**
 * Trigger a scrape via the configured scraper window mode and wait for results.
 *
 * Flow:
 * 1. Register a listener for 'ig-feed-data' events
 * 2. Invoke 'ig_scrape_feed' (Rust navigates WebView + injects script)
 * 3. Wait for the extraction script to emit results via the event
 * 4. Normalize raw posts to FeedItem[]
 */
export async function fetchIgFeed(): Promise<IgSyncResult> {
  const diag: IgSyncDiag = {
    postsExtracted: 0,
    itemsNormalized: 0,
    itemsDeduplicated: 0,
    itemsAdded: 0,
    errorStage: null,
    errorMessage: null,
  };

  const memoryPrep = await prepareSocialScrapeMemory("instagram", "feed scrape");
  if (!memoryPrep.mayProceed) {
    diag.errorStage = "memory_pressure";
    diag.errorMessage =
      `${socialProviderCopy("instagram").memoryPressure} ` +
      `App RSS is ${formatBytesForMemoryLog(memoryPrep.after.appResidentBytes)} after cleanup.`;
    return { items: [], diag };
  }

  // Accumulate raw posts across all scroll-pass events.
  // The Rust scraper emits one 'ig-feed-data' event per scroll pass (~11 total).
  // We register the listener first, then await the invoke (which completes only
  // after all passes are done), then resolve with everything collected.
  const allRawPosts: RawIgPost[] = [];
  const seenIds = new Set<string>();

  let unlisten: UnlistenFn | null = null;

  try {
    attachScraperMediaDiagListener("IG", "instagram");
    unlisten = await listen<{
      posts: RawIgPost[];
      error?: string;
      extractedAt: number;
      url: string;
      candidateCount?: number;
    }>("ig-feed-data", (event) => {
      const { posts, error, candidateCount } = event.payload;

      addDebugEvent(
        "change",
        `[IG] pass: candidates=${candidateCount ?? "?"}, posts=${posts.length}`,
      );

      if (error) {
        addDebugEvent("error", `[IG] extraction error: ${error}`);
        return;
      }

      // Deduplicate across passes using shortcode or url as key
      for (const post of posts) {
        const key = post.shortcode ?? post.url ?? `${post.authorHandle}:${(post.caption ?? "").slice(0, 60)}`;
        if (key && !seenIds.has(key)) {
          seenIds.add(key);
          allRawPosts.push(post);
        }
      }
    });

    await invoke("ig_scrape_feed", { windowMode: getIgScraperWindowMode() });

    // Brief wait for any in-flight events to arrive after invoke resolves
    await new Promise<void>((r) => setTimeout(r, 500));
  } catch (err) {
    diag.errorStage = "invoke";
    diag.errorMessage = err instanceof Error ? err.message : String(err);
    return { items: [], diag };
  } finally {
    unlisten?.();
  }

  diag.postsExtracted = allRawPosts.length;
  addDebugEvent("change", `[IG] extraction complete: ${allRawPosts.length} unique posts across all passes`);

  if (allRawPosts.length === 0) {
    return { items: [], diag };
  }

  try {
    const normalized = igPostsToFeedItems(allRawPosts);
    diag.itemsNormalized = normalized.length;

    const items = deduplicateFeedItems(normalized);
    diag.itemsDeduplicated = items.length;

    return { items, diag };
  } catch (err) {
    diag.errorStage = "normalize";
    diag.errorMessage = err instanceof Error ? err.message : String(err);
    return { items: [], diag };
  }
}

// =============================================================================
// Store Integration
// =============================================================================

/**
 * Capture Instagram feed and add items to the store.
 * Respects rate limiting to avoid triggering Instagram's anti-bot measures.
 */
export async function captureIgFeed(): Promise<IgSyncResult> {
  const startedAt = Date.now();
  const providerPause = getProviderPause("instagram");
  if (providerPause) {
    addDebugEvent("change", `[IG] paused until ${new Date(providerPause.pausedUntil).toLocaleTimeString()}`);
    return {
      items: [],
      diag: {
        postsExtracted: 0,
        itemsNormalized: 0,
        itemsDeduplicated: 0,
        itemsAdded: 0,
        errorStage: "provider_rate_limit",
        errorMessage: providerPause.pauseReason,
      },
    };
  }

  if (isRateLimited()) {
    const minutesRemaining = Math.ceil(
      (MIN_INTERVAL_MS - (Date.now() - lastScrapeAt)) / 60_000,
    );
    addDebugEvent(
      "change",
      `[IG] rate limited, next scrape in ~${minutesRemaining} min`,
    );
    await recordProviderHealthEvent({
      provider: "instagram",
      outcome: "cooldown",
      stage: "cooldown",
      reason: `Cooling down. Try again in ~${minutesRemaining} minutes.`,
      startedAt,
      finishedAt: Date.now(),
    });
    return {
      items: [],
      diag: {
        postsExtracted: 0,
        itemsNormalized: 0,
        itemsDeduplicated: 0,
        itemsAdded: 0,
        errorStage: "cooldown",
        errorMessage: `Cooling down. Try again in ~${minutesRemaining} minutes.`,
      },
    };
  }

  const store = useAppStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    addDebugEvent("change", "[IG] sync started");
    const result = await fetchIgFeed();
    recordScrape();

    if (result.diag.errorStage) {
      const detail = `[IG] sync failed at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      store.setError(result.diag.errorMessage ?? result.diag.errorStage);
      addDebugEvent("error", detail);
      // Persist error so the sync dropdown can show "Last sync failed"
      const errState = { ...useAppStore.getState().igAuth, lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage ?? "Sync failed" };
      store.setIgAuth(errState);
      storeIgAuthState(errState);
      await recordProviderHealthEvent({
        provider: "instagram",
        outcome: "error",
        stage: result.diag.errorStage,
        reason: result.diag.errorMessage ?? result.diag.errorStage ?? "Sync failed",
        startedAt,
        finishedAt: Date.now(),
        itemsSeen: result.diag.postsExtracted,
        itemsAdded: result.diag.itemsAdded,
      });
      return result;
    }

    if (result.items.length > 0) {
      addDebugEvent(
        "change",
        `[IG] writing ${result.items.length.toLocaleString()} candidate item${result.items.length === 1 ? "" : "s"} to the library`,
      );
      const before = store.items.filter((i) => i.platform === "instagram").length;
      await store.addItems(result.items);
      const after = useAppStore
        .getState()
        .items.filter((i) => i.platform === "instagram").length;
      result.diag.itemsAdded = Math.max(0, after - before);
      await upsertMediaVaultRosterFromItems("instagram", result.items);
      const archivedCount = await archiveRecentProviderMedia(
        "instagram",
        useAppStore.getState().items.filter((i) => i.platform === "instagram"),
      );
      if (archivedCount > 0) {
        addDebugEvent(
          "change",
          `[IG] archived ${archivedCount.toLocaleString()} permanent media file${archivedCount === 1 ? "" : "s"}`,
        );
      }
      addDebugEvent(
        "change",
        `[IG] synced: ${result.diag.postsExtracted.toLocaleString()} posts extracted, ${result.diag.itemsAdded.toLocaleString()} new items`,
      );
    } else {
      addDebugEvent("change", "[IG] sync complete: feed returned 0 posts");
    }

    // Persist success timestamp so the sync dropdown shows "Synced X ago"
    const successState = { ...useAppStore.getState().igAuth, lastCapturedAt: Date.now(), lastCaptureError: undefined };
    store.setIgAuth(successState);
    storeIgAuthState(successState);
    await recordProviderHealthEvent({
      provider: "instagram",
      outcome: result.diag.postsExtracted > 0 ? "success" : "empty",
      stage: result.diag.postsExtracted > 0 ? undefined : "empty",
      reason: result.diag.postsExtracted > 0 ? undefined : "No posts pulled",
      startedAt,
      finishedAt: Date.now(),
      itemsSeen: result.diag.postsExtracted,
      itemsAdded: result.diag.itemsAdded,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture Instagram feed";
    store.setError(message);
    addDebugEvent("error", `[IG] captureIgFeed threw: ${message}`);
    const errState = { ...useAppStore.getState().igAuth, lastCaptureError: message };
    store.setIgAuth(errState);
    storeIgAuthState(errState);
    await recordProviderHealthEvent({
      provider: "instagram",
      outcome: "error",
      stage: "unknown",
      reason: message,
      startedAt,
      finishedAt: Date.now(),
    });
    throw error;
  } finally {
    store.setLoading(false);
  }
}
