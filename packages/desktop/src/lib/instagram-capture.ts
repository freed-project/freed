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
import { formatClockTime } from "@freed/ui/lib/date-format";
import { useAppStore } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { getIgScraperWindowMode } from "./scraper-prefs";
import { storeIgAuthState } from "./instagram-auth";
import { attachScraperMediaDiagListener } from "./scraper-media-diag";
import { getProviderPause, recordProviderHealthEvent } from "./provider-health";
import { recordScrapeOutcome, type SocialScrapeTrigger } from "./runtime-health-events";
import {
  formatScrapeMemoryPressureDetails,
  prepareSocialScrapeMemory,
} from "./memory-monitor";
import { archiveRecentProviderMedia, upsertMediaVaultRosterFromItems } from "./media-vault";
import { socialProviderCopy } from "./social-provider-copy";
import { runBackgroundJob } from "./background-runtime-coordinator";
import { log } from "./logger";
import { safeUnlisten } from "./safe-unlisten";
import {
  applyRuntimeDeferredDiag,
  applyLockedSessionDeferredDiag,
  applyNativeMemoryPressureDiag,
  isRuntimeDeferredStage,
  formatSocialCaptureDuration,
  socialCaptureDurationMs,
  SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
  SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
  waitForSocialScrapeEvents,
} from "./social-capture-runtime";

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
  extractionPasses: number;
  totalCandidateCount: number;
  totalRejected: {
    suggestedOrSponsored: number;
    missingContent: number;
    duplicate: number;
    tinyOrInvisible: number;
  };
  lastExtractionStrategy: string | null;
  lastCandidateCount: number | null;
  lastRejected:
    | {
        suggestedOrSponsored?: number;
        missingContent?: number;
        duplicate?: number;
        tinyOrInvisible?: number;
      }
    | null;
  lastScrollY: number | null;
  maxScrollY: number | null;
  lastPageState:
    | {
        articleCount?: number;
        mainFound?: boolean;
        loggedInCookie?: boolean;
        loginChrome?: boolean;
        feedLike?: boolean;
        scrollHeight?: number;
        url?: string;
        title?: string;
      }
    | null;
  errorStage: string | null;
  errorMessage: string | null;
}

export interface IgSyncResult {
  items: ReturnType<typeof igPostsToFeedItems>;
  diag: IgSyncDiag;
}

function createEmptyIgSyncDiag(): IgSyncDiag {
  return {
    postsExtracted: 0,
    itemsNormalized: 0,
    itemsDeduplicated: 0,
    itemsAdded: 0,
    extractionPasses: 0,
    totalCandidateCount: 0,
    totalRejected: {
      suggestedOrSponsored: 0,
      missingContent: 0,
      duplicate: 0,
      tinyOrInvisible: 0,
    },
    lastExtractionStrategy: null,
    lastCandidateCount: null,
    lastRejected: null,
    lastScrollY: null,
    maxScrollY: null,
    lastPageState: null,
    errorStage: null,
    errorMessage: null,
  };
}

function formatInstagramEmptySyncMessage(diag: IgSyncDiag): string {
  const details: string[] = [];
  if (diag.extractionPasses > 0) {
    details.push(
      `${diag.extractionPasses.toLocaleString()} extraction pass${diag.extractionPasses === 1 ? "" : "es"}`,
    );
  }
  if (diag.lastExtractionStrategy) {
    details.push(`last strategy ${diag.lastExtractionStrategy}`);
  }
  if (typeof diag.lastCandidateCount === "number") {
    details.push(
      `${diag.lastCandidateCount.toLocaleString()} candidate${diag.lastCandidateCount === 1 ? "" : "s"} on the last pass`,
    );
  }
  if (typeof diag.lastScrollY === "number") {
    details.push(`scrollY ${diag.lastScrollY.toLocaleString()}`);
  }
  if (typeof diag.lastPageState?.scrollHeight === "number") {
    details.push(`scrollHeight ${diag.lastPageState.scrollHeight.toLocaleString()}`);
  }
  if (diag.lastPageState?.loginChrome) {
    details.push("login chrome visible");
  }
  const rejected =
    diag.totalRejected.suggestedOrSponsored +
    diag.totalRejected.missingContent +
    diag.totalRejected.duplicate +
    diag.totalRejected.tinyOrInvisible;
  if (rejected > 0) {
    details.push(`${rejected.toLocaleString()} rejected`);
  }

  return details.length > 0
    ? `Instagram feed returned 0 posts. ${details.join(", ")}.`
    : "Instagram feed returned 0 posts.";
}

function formatInstagramSilentExtractionMessage(): string {
  return (
    "Instagram extraction returned no scrape batches. The WebView may be on a stale page, " +
    "the injected script may not have emitted, or the renderer may have stalled before extraction finished."
  );
}

function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyInstagramPlaceholderDiag(diag: IgSyncDiag, error: unknown): boolean {
  const message = errorMessageFromUnknown(error);
  if (!message.startsWith("placeholder_feed:")) return false;
  diag.errorStage = "placeholder_feed";
  diag.errorMessage = message.replace(/^placeholder_feed:\s*/, "");
  return true;
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
  const diag = createEmptyIgSyncDiag();

  if (await applyLockedSessionDeferredDiag(diag)) {
    return { items: [], diag };
  }

  const memoryPrep = await prepareSocialScrapeMemory("instagram", "feed scrape");
  if (!memoryPrep.mayProceed) {
    diag.errorStage = "memory_pressure";
    diag.errorMessage =
      `${socialProviderCopy("instagram").memoryPressure} ` +
      formatScrapeMemoryPressureDetails(memoryPrep);
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
      rejected?: Partial<IgSyncDiag["totalRejected"]>;
      scrollY?: number;
      strategy?: string;
      pageState?: IgSyncDiag["lastPageState"];
    }>("ig-feed-data", (event) => {
      const { posts, error, candidateCount, pageState, rejected, scrollY, strategy } = event.payload;

      diag.extractionPasses += 1;
      diag.lastExtractionStrategy = strategy ?? diag.lastExtractionStrategy;
      diag.lastCandidateCount = typeof candidateCount === "number" ? candidateCount : diag.lastCandidateCount;
      diag.totalCandidateCount += candidateCount ?? 0;
      diag.lastScrollY = typeof scrollY === "number" ? scrollY : diag.lastScrollY;
      diag.maxScrollY =
        typeof scrollY === "number"
          ? Math.max(diag.maxScrollY ?? 0, scrollY)
          : diag.maxScrollY;
      diag.lastPageState = pageState ?? diag.lastPageState;
      if (rejected) {
        diag.lastRejected = rejected;
        diag.totalRejected.suggestedOrSponsored += rejected.suggestedOrSponsored ?? 0;
        diag.totalRejected.missingContent += rejected.missingContent ?? 0;
        diag.totalRejected.duplicate += rejected.duplicate ?? 0;
        diag.totalRejected.tinyOrInvisible += rejected.tinyOrInvisible ?? 0;
      }

      addDebugEvent(
        "change",
        `[IG] pass: candidates=${candidateCount?.toLocaleString() ?? "?"}, posts=${posts.length.toLocaleString()}, scrollY=${scrollY?.toLocaleString() ?? "?"}`,
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

    await runBackgroundJob({
      kind: "social-scrape",
      source: "instagram:feed",
      timeoutMs: 600_000,
      waitForActiveJobMs: SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS,
      waitForActiveJobKinds: SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS,
      run: () => invoke("ig_scrape_feed", { windowMode: getIgScraperWindowMode() }),
    });

    await waitForSocialScrapeEvents();
  } catch (err) {
    if (applyRuntimeDeferredDiag(diag, err)) {
      return { items: [], diag };
    }
    if (applyNativeMemoryPressureDiag(diag, err, "instagram")) {
      return { items: [], diag };
    }
    if (applyInstagramPlaceholderDiag(diag, err)) {
      return { items: [], diag };
    }
    diag.errorStage = "invoke";
    diag.errorMessage = errorMessageFromUnknown(err);
    return { items: [], diag };
  } finally {
    safeUnlisten(unlisten, "ig-feed-data");
  }

  diag.postsExtracted = allRawPosts.length;
  addDebugEvent("change", `[IG] extraction complete: ${allRawPosts.length} unique posts across all passes`);

  if (diag.extractionPasses === 0) {
    diag.errorStage = "extract_silent";
    diag.errorMessage = formatInstagramSilentExtractionMessage();
    return { items: [], diag };
  }

  if (allRawPosts.length === 0) {
    diag.errorStage = "extract_empty";
    diag.errorMessage = formatInstagramEmptySyncMessage(diag);
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
export async function captureIgFeed(
  trigger: SocialScrapeTrigger = "unknown",
): Promise<IgSyncResult> {
  const scrapeStartedAt = Date.now();
  try {
    const result = await captureIgFeedInternal();
    recordScrapeOutcome({
      provider: "instagram",
      trigger,
      itemsExtracted: result.diag.postsExtracted,
      itemsPersisted: result.diag.itemsAdded,
      stage: result.diag.errorStage ?? "ok",
      durationMs: Date.now() - scrapeStartedAt,
    });
    return result;
  } catch (error) {
    recordScrapeOutcome({
      provider: "instagram",
      trigger,
      itemsExtracted: 0,
      itemsPersisted: 0,
      stage: "exception",
      durationMs: Date.now() - scrapeStartedAt,
    });
    throw error;
  }
}

async function captureIgFeedInternal(): Promise<IgSyncResult> {
  const startedAt = Date.now();
  const providerPause = getProviderPause("instagram");
  if (providerPause) {
    addDebugEvent("change", `[IG] paused until ${formatClockTime(providerPause.pausedUntil)}`);
    const diag = createEmptyIgSyncDiag();
    diag.errorStage = "provider_rate_limit";
    diag.errorMessage = providerPause.pauseReason;
    return {
      items: [],
      diag,
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
    const diag = createEmptyIgSyncDiag();
    diag.errorStage = "cooldown";
    diag.errorMessage = `Cooling down. Try again in ~${minutesRemaining} minutes.`;
    return {
      items: [],
      diag,
    };
  }

  const store = useAppStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    addDebugEvent("change", "[IG] sync started");
    const fetchStartedAt = performance.now();
    const result = await fetchIgFeed();
    log.info(
      `[IG] fetch finished duration=${formatSocialCaptureDuration(socialCaptureDurationMs(fetchStartedAt))} ` +
        `items=${result.items.length.toLocaleString()} stage=${result.diag.errorStage ?? "ok"}`,
    );

    if (result.diag.errorStage) {
      const runtimeDeferred = isRuntimeDeferredStage(result.diag.errorStage);
      const detail = `[IG] sync ${runtimeDeferred ? "deferred" : "failed"} at stage="${result.diag.errorStage}": ${result.diag.errorMessage ?? "(no message)"}`;
      addDebugEvent(runtimeDeferred ? "change" : "error", detail);
      if (runtimeDeferred) {
        return result;
      }
      if (result.diag.errorStage !== "memory_pressure") {
        recordScrape();
      }
      if (result.diag.errorStage !== "memory_pressure") {
        store.setError(result.diag.errorMessage ?? result.diag.errorStage);
        const errState = { ...useAppStore.getState().igAuth, lastCaptureError: result.diag.errorMessage ?? result.diag.errorStage ?? "Sync failed" };
        store.setIgAuth(errState);
        storeIgAuthState(errState);
      }
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

    recordScrape();
    if (result.items.length > 0) {
      addDebugEvent(
        "change",
        `[IG] writing ${result.items.length.toLocaleString()} candidate item${result.items.length === 1 ? "" : "s"} to the library`,
      );
      const before = store.items.filter((i) => i.platform === "instagram").length;
      const writeStartedAt = performance.now();
      await store.addItems(result.items);
      const writeDurationMs = socialCaptureDurationMs(writeStartedAt);
      const after = useAppStore
        .getState()
        .items.filter((i) => i.platform === "instagram").length;
      result.diag.itemsAdded = Math.max(0, after - before);
      log.info(
        `[IG] store write complete candidates=${result.items.length.toLocaleString()} before=${before.toLocaleString()} after=${after.toLocaleString()} added=${result.diag.itemsAdded.toLocaleString()} duration=${formatSocialCaptureDuration(writeDurationMs)}`,
      );
      const mediaStartedAt = performance.now();
      await upsertMediaVaultRosterFromItems("instagram", result.items);
      const archivedCount = await archiveRecentProviderMedia(
        "instagram",
        result.items,
      );
      const mediaDurationMs = socialCaptureDurationMs(mediaStartedAt);
      const archivedTotal = archivedCount ?? 0;
      log.info(
        `[IG] media vault complete candidates=${result.items.length.toLocaleString()} archived=${archivedTotal.toLocaleString()} duration=${formatSocialCaptureDuration(mediaDurationMs)}`,
      );
      if (archivedTotal > 0) {
        addDebugEvent(
          "change",
          `[IG] archived ${archivedTotal.toLocaleString()} permanent media file${archivedTotal === 1 ? "" : "s"}`,
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
