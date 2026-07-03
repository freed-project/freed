/**
 * LinkedIn capture service (WebView-based)
 *
 * Triggers the Rust backend to navigate a Tauri WebView to
 * linkedin.com/feed, wait for the page to render, then inject an extraction
 * script that reads posts from the DOM. The extracted data is sent back
 * via Tauri event IPC ('li-feed-data').
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RawLiPost } from "@freed/capture-linkedin/browser";
import {
  liPostsToFeedItems,
  deduplicateFeedItems,
} from "@freed/capture-linkedin/browser";
import { formatClockTime } from "@freed/ui/lib/date-format";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getLiScraperWindowMode } from "./scraper-prefs";
import { attachScraperMediaDiagListener } from "./scraper-media-diag";
import { storeLiAuthState } from "./li-auth";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import { recordScrapeOutcome, type SocialScrapeTrigger } from "./runtime-health-events";
import {
  formatScrapeMemoryPressureDetails,
  prepareSocialScrapeMemory,
} from "./memory-monitor";
import { socialProviderCopy } from "./social-provider-copy";
import { safeUnlisten } from "./safe-unlisten";
import {
  applyRuntimeDeferredDiag,
  applyLockedSessionDeferredDiag,
  applyNativeMemoryPressureDiag,
  isRuntimeDeferredStage,
  SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
  SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
  waitForSocialScrapeEvents,
} from "./social-capture-runtime";
import { runBackgroundJob } from "./background-runtime-coordinator";

// =============================================================================
// Rate Limiting
// =============================================================================

let lastScrapeAt = 0;
// 30 min base interval + up to 6 min of jitter. LinkedIn is more sensitive
// than Facebook to regular scraping patterns.
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const INTERVAL_JITTER_MS = 6 * 60 * 1000;
const LI_ZERO_EVENT_DRAIN_MS = import.meta.env.MODE === "test" ? 0 : 2_500;

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
  extractionPasses: number;
  lastCandidateCount: number | null;
  lastUrl: string | null;
  lastPageState: LiExtractionPageState | null;
}

export interface LiSyncResult {
  items: ReturnType<typeof liPostsToFeedItems>;
  diag: LiSyncDiag;
}

function createEmptyLiSyncResult(): LiSyncResult {
  return {
    items: [],
    diag: {
      postsExtracted: 0,
      itemsNormalized: 0,
      itemsDeduplicated: 0,
      itemsAdded: 0,
      errorStage: null,
      errorMessage: null,
      extractionPasses: 0,
      lastCandidateCount: null,
      lastUrl: null,
      lastPageState: null,
    },
  };
}

interface LiExtractionPageState {
  url?: string | null;
  title?: string | null;
  readyState?: string | null;
  scrollHeight?: number | null;
  bodyTextLength?: number | null;
  mainFound?: boolean | null;
  loginChrome?: boolean | null;
  loggedInCookie?: boolean | null;
  candidateCount?: number | null;
  extractedPostCount?: number | null;
  feedContainerCount?: number | null;
  dataUrnCount?: number | null;
  activityUrnCount?: number | null;
  articleCount?: number | null;
}

function formatLiEmptyMessage(diag: LiSyncDiag): string {
  const page = diag.lastPageState;
  const parts = [
    `LinkedIn returned no posts after ${diag.extractionPasses.toLocaleString()} extraction pass${diag.extractionPasses === 1 ? "" : "es"}`,
    `candidate_count=${(diag.lastCandidateCount ?? 0).toLocaleString()}`,
  ];
  if (page) {
    parts.push(
      `activity_urns=${(page.activityUrnCount ?? 0).toLocaleString()}`,
      `data_urns=${(page.dataUrnCount ?? 0).toLocaleString()}`,
      `articles=${(page.articleCount ?? 0).toLocaleString()}`,
      `feed_containers=${(page.feedContainerCount ?? 0).toLocaleString()}`,
      `main_found=${page.mainFound === true ? "true" : "false"}`,
      `login_chrome=${page.loginChrome === true ? "true" : "false"}`,
      `logged_in_cookie=${page.loggedInCookie === true ? "true" : "false"}`,
      `ready_state=${page.readyState ?? "unknown"}`,
      `url=${page.url ?? diag.lastUrl ?? "unknown"}`,
    );
  } else if (diag.lastUrl) {
    parts.push(`url=${diag.lastUrl}`);
  }
  return `${parts.join(", ")}.`;
}

function formatLiNoEventsMessage(diag: LiSyncDiag): string {
  return `LinkedIn scraper finished before Freed received any extraction events. url=${diag.lastUrl ?? "unknown"}.`;
}

function waitForLiZeroEventDrain(): Promise<void> {
  if (LI_ZERO_EVENT_DRAIN_MS <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, LI_ZERO_EVENT_DRAIN_MS));
}

// =============================================================================
// Core scrape trigger
// =============================================================================

/**
 * Trigger a scrape via the configured scraper window mode and wait for results.
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
  const emptyResult = createEmptyLiSyncResult();
  const diag = emptyResult.diag;

  if (!isTauri()) {
    return emptyResult;
  }

  if (await applyLockedSessionDeferredDiag(diag)) {
    return { items: [], diag };
  }

  const memoryPrep = await prepareSocialScrapeMemory("linkedin", "feed scrape");
  if (!memoryPrep.mayProceed) {
    diag.errorStage = "memory_pressure";
    diag.errorMessage =
      `${socialProviderCopy("linkedin").memoryPressure} ` +
      formatScrapeMemoryPressureDetails(memoryPrep);
    return { items: [], diag };
  }

  let unlisten: UnlistenFn | null = null;
  const allRawPosts: RawLiPost[] = [];
  const seenUrns = new Set<string>();

  try {
    attachScraperMediaDiagListener("LI", "linkedin");

    // Listen for extraction events from each scroll pass.
    unlisten = await listen<{
      posts: RawLiPost[];
      error?: string;
      extractedAt: number;
      url: string;
      candidateCount?: number;
      scrollY?: number;
      done?: boolean;
      pageState?: LiExtractionPageState;
    }>(
      "li-feed-data",
      (event) => {
        const { posts, error, candidateCount, done, pageState, url } = event.payload;
        diag.extractionPasses += 1;
        if (typeof candidateCount === "number") {
          diag.lastCandidateCount = candidateCount;
        }
        if (typeof url === "string" && url) {
          diag.lastUrl = url;
        }
        if (pageState) {
          diag.lastPageState = pageState;
        }

        addDebugEvent(
          "change",
          `[LI] extraction pass: candidates=${candidateCount ?? "?"}, posts=${posts.length}${done ? " (final)" : ""}`,
        );

        if (error) {
          diag.errorStage = "extract";
          diag.errorMessage = error;
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

        if (done) return;
      },
    );

    await runBackgroundJob({
      kind: "social-scrape",
      source: "linkedin:feed",
      timeoutMs: 600_000,
      waitForActiveJobMs: SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
      waitForActiveJobKinds: SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
      run: () => invoke("li_scrape_feed", { windowMode: getLiScraperWindowMode() }),
    });
    if (diag.extractionPasses === 0) {
      await waitForLiZeroEventDrain();
    } else {
      await waitForSocialScrapeEvents();
    }
  } catch (err) {
    if (!diag.errorStage) {
      if (applyRuntimeDeferredDiag(diag, err)) {
        return { items: [], diag };
      }
      if (applyNativeMemoryPressureDiag(diag, err, "linkedin")) {
        return { items: [], diag };
      }
      diag.errorStage = "invoke";
      diag.errorMessage = err instanceof Error ? err.message : String(err);
    }
    return { items: [], diag };
  } finally {
    safeUnlisten(unlisten, "li-feed-data");
  }

  if (diag.errorStage) {
    return { items: [], diag };
  }

  diag.postsExtracted = allRawPosts.length;

  if (diag.extractionPasses === 0) {
    diag.errorStage = "event_timeout";
    diag.errorMessage = formatLiNoEventsMessage(diag);
    return { items: [], diag };
  }

  if (allRawPosts.length === 0) {
    diag.errorStage = "empty";
    diag.errorMessage = formatLiEmptyMessage(diag);
    return { items: [], diag };
  }

  try {
    const normalized = liPostsToFeedItems(allRawPosts);
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
 * Capture LinkedIn feed and add items to the store.
 * Respects rate limiting to avoid triggering LinkedIn's anti-bot measures.
 */
export async function captureLiFeed(
  trigger: SocialScrapeTrigger = "unknown",
): Promise<LiSyncResult> {
  if (!isTauri()) {
    addDebugEvent("change", "[LI] browser preview skips native LinkedIn capture");
    return createEmptyLiSyncResult();
  }

  const scrapeStartedAt = Date.now();
  try {
    const result = await captureLiFeedInternal();
    recordScrapeOutcome({
      provider: "linkedin",
      trigger,
      itemsExtracted: result.diag.postsExtracted,
      itemsPersisted: result.diag.itemsAdded,
      stage: result.diag.errorStage ?? "ok",
      durationMs: Date.now() - scrapeStartedAt,
    });
    return result;
  } catch (error) {
    recordScrapeOutcome({
      provider: "linkedin",
      trigger,
      itemsExtracted: 0,
      itemsPersisted: 0,
      stage: "exception",
      durationMs: Date.now() - scrapeStartedAt,
    });
    throw error;
  }
}

async function captureLiFeedInternal(): Promise<LiSyncResult> {
  const startedAt = Date.now();
  const providerPause = getProviderPause("linkedin");
  if (providerPause) {
    addDebugEvent("change", `[LI] paused until ${formatClockTime(providerPause.pausedUntil)}`);
    return {
      items: [],
      diag: {
        postsExtracted: 0,
        itemsNormalized: 0,
        itemsDeduplicated: 0,
        itemsAdded: 0,
        errorStage: "provider_rate_limit",
        errorMessage: providerPause.pauseReason,
        extractionPasses: 0,
        lastCandidateCount: null,
        lastUrl: null,
        lastPageState: null,
      },
    };
  }

    if (isRateLimited()) {
    const minutesRemaining = Math.ceil(
      (MIN_INTERVAL_MS - (Date.now() - lastScrapeAt)) / 60_000,
    );
    addDebugEvent(
      "change",
      `[LI] rate limited, next scrape in ~${minutesRemaining} min`,
    );
    await recordProviderHealthEvent({
      provider: "linkedin",
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
        extractionPasses: 0,
        lastCandidateCount: null,
        lastUrl: null,
        lastPageState: null,
      },
    };
  }

  const store = useAppStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    addDebugEvent("change", "[LI] sync started");
    const result = await fetchLiFeed();

    if (result.diag.errorStage) {
      const runtimeDeferred = isRuntimeDeferredStage(result.diag.errorStage);
      const detail = `[LI] sync ${runtimeDeferred ? "deferred" : "failed"} at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      addDebugEvent(runtimeDeferred ? "change" : "error", detail);
      if (runtimeDeferred) {
        return result;
      }
      if (result.diag.errorStage !== "memory_pressure") {
        store.setError(result.diag.errorMessage ?? result.diag.errorStage);
        const errState = {
          ...useAppStore.getState().liAuth,
          lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage ?? "Sync failed",
        };
        store.setLiAuth(errState);
        storeLiAuthState(errState);
      }
      await recordProviderHealthEvent({
        provider: "linkedin",
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

    recordScrape();

    if (result.items.length > 0) {
      addDebugEvent(
        "change",
        `[LI] writing ${result.items.length.toLocaleString()} candidate item${result.items.length === 1 ? "" : "s"} to the library`,
      );
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

    const successState = {
      ...useAppStore.getState().liAuth,
      lastCapturedAt: Date.now(),
      lastCaptureError: undefined,
    };
    store.setLiAuth(successState);
    storeLiAuthState(successState);
    await recordProviderHealthEvent({
      provider: "linkedin",
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
      error instanceof Error ? error.message : "Failed to capture LinkedIn feed";
    store.setError(message);
    addDebugEvent("error", `[LI] captureLiFeed threw: ${message}`);
    const errState = { ...useAppStore.getState().liAuth, lastCaptureError: message };
    store.setLiAuth(errState);
    storeLiAuthState(errState);
    await recordProviderHealthEvent({
      provider: "linkedin",
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
