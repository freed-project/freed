/**
 * Facebook capture service (WebView-based)
 *
 * Triggers the Rust backend to navigate a Tauri WebView to
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
import type { FbGroupInfo, FeedItem } from "@freed/shared";
import { formatClockTime } from "@freed/ui/lib/date-format";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getFbScraperWindowMode } from "./scraper-prefs";
import { storeFbAuthState } from "./fb-auth";
import { attachScraperMediaDiagListener } from "./scraper-media-diag";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import { formatBytesForMemoryLog, prepareSocialScrapeMemory } from "./memory-monitor";
import { archiveRecentProviderMedia, upsertMediaVaultRosterFromItems } from "./media-vault";
import { socialProviderCopy } from "./social-provider-copy";
import { runBackgroundJob } from "./background-runtime-coordinator";
import {
  facebookGroupsFromFeedItems,
  mergeFacebookGroupRecords,
} from "./facebook-groups";

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

function filterExcludedGroups(
  items: FeedItem[],
  excludedGroupIds: Record<string, true>,
): FeedItem[] {
  return items.filter((item) => {
    const groupId = item.fbGroup?.id;
    return !groupId || !excludedGroupIds[groupId];
  });
}

async function updateKnownFacebookGroups(
  groups: readonly FbGroupInfo[],
): Promise<ReturnType<typeof mergeFacebookGroupRecords>> {
  const store = useAppStore.getState();
  const merge = mergeFacebookGroupRecords(
    store.preferences.fbCapture?.knownGroups ?? {},
    groups,
  );

  if (merge.changedCount > 0) {
    await store.updatePreferences({
      fbCapture: {
        knownGroups: merge.knownGroups,
        excludedGroupIds: store.preferences.fbCapture?.excludedGroupIds ?? {},
      },
    });
  }

  return merge;
}

export async function repairStoredFacebookGroupNamesFromItems(
  items: readonly FeedItem[] = useAppStore.getState().items,
): Promise<number> {
  const groups = facebookGroupsFromFeedItems(items);
  if (groups.length === 0) return 0;

  const merge = await updateKnownFacebookGroups(groups);
  if (merge.repairedNameCount > 0) {
    addDebugEvent(
      "change",
      `[FB] repaired ${merge.repairedNameCount.toLocaleString()} stored group name${merge.repairedNameCount === 1 ? "" : "s"} from captured posts`,
    );
  }

  return merge.repairedNameCount;
}

// =============================================================================
// Core scrape trigger
// =============================================================================

/**
 * Trigger a scrape via the configured scraper window mode and wait for results.
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

  const memoryPrep = await prepareSocialScrapeMemory("facebook", "feed scrape");
  if (!memoryPrep.mayProceed) {
    diag.errorStage = "memory_pressure";
    diag.errorMessage =
      `${socialProviderCopy("facebook").memoryPressure} ` +
      `App RSS is ${formatBytesForMemoryLog(memoryPrep.after.appResidentBytes)} after cleanup.`;
    return { items: [], diag };
  }

  const allRawPosts: RawFbPost[] = [];
  const seenIds = new Set<string>();
  let unlisten: UnlistenFn | null = null;
  let unlistenDiag: UnlistenFn | null = null;

  try {
    attachScraperMediaDiagListener("FB", "facebook");

    // Listen for diagnostics (fires before extraction)
    unlistenDiag = await listen("fb-diag", (diagEvent) => {
      const diag = diagEvent.payload as Record<string, unknown>;
      addDebugEvent("change", `[FB] DOM diag: feedUnits=${diag.feedUnits}, fallback=${diag.feedUnitsFallback}, feed=${diag.feedContainer}, h4s=${diag.h4Count}, bodyLen=${diag.bodyLen}, url=${diag.url}, tauriEmit=${diag.hasTauriEmit}`);
      console.log("[FB] DOM diagnostics:", diag);
    });

    // Listen for every extraction pass. The native scraper emits multiple
    // batches while it scrolls through the virtualized feed.
    unlisten = await listen<{ posts: RawFbPost[]; error?: string; extractedAt: number; url: string; strategy?: string; candidateCount?: number }>(
      "fb-feed-data",
      (event) => {
        const { posts, error, strategy, candidateCount } = event.payload;

        addDebugEvent("change", `[FB] extraction: strategy=${strategy ?? "?"}, candidates=${candidateCount ?? "?"}, posts=${posts.length}`);

        if (error) {
          addDebugEvent("error", `[FB] extraction error: ${error}`);
          diag.errorStage = "extract";
          diag.errorMessage = error;
          return;
        }

        for (const post of posts) {
          const key = post.id ?? post.url ?? `${post.authorName}:${(post.text ?? "").slice(0, 80)}`;
          if (key && !seenIds.has(key)) {
            seenIds.add(key);
            allRawPosts.push(post);
          }
        }
      },
    );

    await runBackgroundJob({
      kind: "social-scrape",
      source: "facebook:feed",
      timeoutMs: 600_000,
      run: () => invoke("fb_scrape_feed", { windowMode: getFbScraperWindowMode() }),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  } catch (err) {
    if (!diag.errorStage) {
      diag.errorStage = "invoke";
      diag.errorMessage = err instanceof Error ? err.message : String(err);
    }
    return { items: [], diag };
  } finally {
    unlisten?.();
    unlistenDiag?.();
  }

  if (diag.errorStage) {
    return { items: [], diag };
  }

  diag.postsExtracted = allRawPosts.length;

  if (allRawPosts.length === 0) {
    return { items: [], diag };
  }

  try {
    const normalized = fbPostsToFeedItems(allRawPosts);
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

export async function captureFbGroups(): Promise<FbGroupInfo[]> {
  const memoryPrep = await prepareSocialScrapeMemory("facebook", "groups scrape");
  if (!memoryPrep.mayProceed) {
    addDebugEvent(
      "change",
      `[FB] group refresh deferred for memory pressure: ${formatBytesForMemoryLog(memoryPrep.after.appResidentBytes)} after cleanup`,
    );
    return [];
  }

  const groups = await invoke<FbGroupInfo[]>("fb_scrape_groups", {
    windowMode: getFbScraperWindowMode(),
  });

  if (groups.length === 0) return groups;

  const merge = await updateKnownFacebookGroups(groups);

  addDebugEvent(
    "change",
    `[FB] groups refreshed: ${groups.length.toLocaleString()} group${groups.length === 1 ? "" : "s"}${merge.repairedNameCount > 0 ? `, repaired ${merge.repairedNameCount.toLocaleString()} stored name${merge.repairedNameCount === 1 ? "" : "s"}` : ""}`,
  );

  return groups;
}

// =============================================================================
// Store Integration
// =============================================================================

/**
 * Capture Facebook feed and add items to the store.
 * Respects rate limiting to avoid triggering Facebook's anti-bot measures.
 */
export async function captureFbFeed(): Promise<FbSyncResult> {
  const startedAt = Date.now();
  const providerPause = getProviderPause("facebook");
  if (providerPause) {
    addDebugEvent("change", `[FB] paused until ${formatClockTime(providerPause.pausedUntil)}`);
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
      `[FB] rate limited, next scrape in ~${minutesRemaining} min`,
    );
    await recordProviderHealthEvent({
      provider: "facebook",
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
    addDebugEvent("change", "[FB] sync started");
    const result = await fetchFbFeed();
    recordScrape();

    if (result.diag.errorStage) {
      const detail = `[FB] sync failed at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      addDebugEvent("error", detail);
      if (result.diag.errorStage !== "memory_pressure") {
        store.setError(result.diag.errorMessage ?? result.diag.errorStage);
        const errState = { ...useAppStore.getState().fbAuth, lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage ?? "Sync failed" };
        store.setFbAuth(errState);
        storeFbAuthState(errState);
      }
      await recordProviderHealthEvent({
        provider: "facebook",
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
      await repairStoredFacebookGroupNamesFromItems(result.items);
      const excludedGroupIds =
        useAppStore.getState().preferences.fbCapture?.excludedGroupIds ?? {};
      const filteredItems = filterExcludedGroups(result.items, excludedGroupIds);
      addDebugEvent(
        "change",
        `[FB] writing ${filteredItems.length.toLocaleString()} candidate item${filteredItems.length === 1 ? "" : "s"} to the library`,
      );
      const before = store.items.filter((i) => i.platform === "facebook").length;
      await store.addItems(filteredItems);
      const after = useAppStore
        .getState()
        .items.filter((i) => i.platform === "facebook").length;
      result.diag.itemsAdded = Math.max(0, after - before);
      await upsertMediaVaultRosterFromItems("facebook", filteredItems);
      const archivedCount = await archiveRecentProviderMedia(
        "facebook",
        useAppStore.getState().items.filter((i) => i.platform === "facebook"),
      );
      if (archivedCount > 0) {
        addDebugEvent(
          "change",
          `[FB] archived ${archivedCount.toLocaleString()} permanent media file${archivedCount === 1 ? "" : "s"}`,
        );
      }
      addDebugEvent(
        "change",
        `[FB] synced: ${result.diag.postsExtracted.toLocaleString()} posts extracted, ${result.diag.itemsAdded.toLocaleString()} new items`,
      );
    } else {
      addDebugEvent("change", "[FB] sync complete: feed returned 0 posts");
    }

    // Persist success timestamp so the sync dropdown shows "Synced X ago"
    const successState = { ...useAppStore.getState().fbAuth, lastCapturedAt: Date.now(), lastCaptureError: undefined };
    store.setFbAuth(successState);
    storeFbAuthState(successState);
    await recordProviderHealthEvent({
      provider: "facebook",
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
      error instanceof Error ? error.message : "Failed to capture Facebook feed";
    store.setError(message);
    addDebugEvent("error", `[FB] captureFbFeed threw: ${message}`);
    const errState = { ...useAppStore.getState().fbAuth, lastCaptureError: message };
    store.setFbAuth(errState);
    storeFbAuthState(errState);
    await recordProviderHealthEvent({
      provider: "facebook",
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
