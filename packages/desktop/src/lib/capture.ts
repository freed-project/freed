/**
 * Capture service for fetching RSS feeds
 *
 * Uses Tauri backend to bypass CORS restrictions. RSS parsing and
 * normalization delegate to @freed/capture-rss; only the HTTP transport
 * layer lives here because it must go through Tauri's fetch_url IPC.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { FeedItem, RssFeed, OPMLFeedEntry } from "@freed/shared";
import { generateOPML, downloadFile } from "@freed/shared";
import {
  parseFeedXml,
  feedToFeedItems,
  feedToRssFeed,
} from "@freed/capture-rss/browser";
import { captureXTimeline } from "./x-capture";
import { captureFbFeed } from "./fb-capture";
import { captureIgFeed } from "./instagram-capture";
import { captureLiFeed } from "./li-capture";
import { docBatchRefreshFeeds } from "./automerge";
import { useAppStore, withProviderSyncing } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { isProviderPaused, recordProviderHealthEvent } from "./provider-health";
import {
  selectRssFeedsForRefresh,
  type RssRefreshPlanOptions,
} from "./rss-refresh-plan";
import { isRuntimeDeferredStage } from "./social-capture-runtime";

/**
 * Fetch URL via Tauri backend (bypasses CORS)
 */
async function fetchUrl(url: string): Promise<string> {
  if (!isTauri()) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed with ${response.status.toLocaleString()}`);
    }
    return response.text();
  }
  return invoke<string>("fetch_url", { url });
}

/** Result of fetching and parsing a single RSS feed */
interface FetchedFeed {
  items: FeedItem[];
  /** Feed-level title from the live XML — undefined if the parser found none */
  liveTitle: string | undefined;
  /** Feed-level site URL from the live XML */
  liveSiteUrl: string | undefined;
}

/**
 * Fetch and parse an RSS feed via Tauri backend.
 * Transport is Tauri IPC; parsing/normalization is @freed/capture-rss.
 *
 * Returns feed-level metadata alongside items so the refresh pipeline can heal
 * "Untitled Feed" sentinels even when the feed currently has zero items.
 */
async function fetchRssFeed(feedUrl: string): Promise<FetchedFeed> {
  const xml = await fetchUrl(feedUrl);
  const parsed = await parseFeedXml(xml, feedUrl);
  return {
    items: feedToFeedItems(parsed),
    liveTitle: parsed.title !== "Untitled Feed" ? parsed.title : undefined,
    liveSiteUrl: parsed.link || undefined,
  };
}

/**
 * Add a new RSS feed subscription and fetch its initial items
 */
export async function addRssFeed(feedUrl: string): Promise<void> {
  const store = useAppStore.getState();

  store.setLoading(true);
  store.setError(null);

  try {
    const xml = await fetchUrl(feedUrl);
    const parsed = await parseFeedXml(xml, feedUrl);

    if (parsed.items.length === 0) {
      throw new Error("No items found in feed");
    }

    // feedToRssFeed derives title, siteUrl, imageUrl from the parsed feed
    const feed = feedToRssFeed(parsed);
    const items = feedToFeedItems(parsed);

    await store.addFeed(feed);
    await store.addItems(items);
  } catch (error) {
    store.setError(
      error instanceof Error ? error.message : "Failed to add feed",
    );
    throw error;
  } finally {
    store.setLoading(false);
  }
}

/** Max concurrent feed fetches — avoids saturating Tauri's HTTP layer. */
const FETCH_CONCURRENCY = 5;
const RSS_FAILURE_RETRY_BASE_MS = 2 * 60 * 60 * 1000;
const RSS_FAILURE_RETRY_MAX_MS = 24 * 60 * 60 * 1000;
const SOCIAL_DEFERRED_RETRY_BASE_MS = 2 * 60 * 1000;
const SOCIAL_DEFERRED_RETRY_MAX_MS = 10 * 60 * 1000;

export type RetriableSocialProvider = "facebook" | "instagram" | "linkedin";

const socialDeferredRetryTimers = new Map<
  RetriableSocialProvider,
  ReturnType<typeof setTimeout>
>();
const socialDeferredRetryCounts = new Map<RetriableSocialProvider, number>();
const socialDebugLabels: Record<RetriableSocialProvider, string> = {
  facebook: "FB",
  instagram: "IG",
  linkedin: "LI",
};

function nextFailedFeedRetryMs(feed: RssFeed): number {
  const failureCount = Math.max(0, feed.consecutiveFailures ?? 0);
  return Math.min(
    RSS_FAILURE_RETRY_MAX_MS,
    RSS_FAILURE_RETRY_BASE_MS * Math.pow(2, Math.min(failureCount, 4)),
  );
}

function markFeedFetchSucceeded(feed: RssFeed, now: number): RssFeed {
  return {
    ...feed,
    lastFetched: now,
    lastFetchAttemptedAt: now,
    nextFetchAfter: 0,
    consecutiveFailures: 0,
    lastFetchError: "",
  };
}

function markFeedFetchFailed(feed: RssFeed, message: string, now: number): RssFeed {
  return {
    ...feed,
    lastFetchAttemptedAt: now,
    nextFetchAfter: now + nextFailedFeedRetryMs(feed),
    consecutiveFailures: (feed.consecutiveFailures ?? 0) + 1,
    lastFetchError: message.slice(0, 500),
  };
}

function shouldRetrySocialStage(stage: string | null): boolean {
  return stage === "memory_pressure" || isRuntimeDeferredStage(stage);
}

function nextSocialDeferredRetryMs(provider: RetriableSocialProvider): number {
  const retryCount = socialDeferredRetryCounts.get(provider) ?? 0;
  const exponentialMs =
    SOCIAL_DEFERRED_RETRY_BASE_MS * Math.pow(2, Math.min(retryCount, 3));
  const jitterMs = Math.floor(Math.random() * 30_000);
  return Math.min(
    SOCIAL_DEFERRED_RETRY_MAX_MS,
    exponentialMs + jitterMs,
  );
}

function clearSocialDeferredRetry(provider: RetriableSocialProvider): void {
  const timer = socialDeferredRetryTimers.get(provider);
  if (timer) {
    clearTimeout(timer);
    socialDeferredRetryTimers.delete(provider);
  }
  socialDeferredRetryCounts.delete(provider);
}

function scheduleSocialDeferredRetry(
  provider: RetriableSocialProvider,
  stage: string,
): void {
  if (socialDeferredRetryTimers.has(provider)) return;
  const retryMs = nextSocialDeferredRetryMs(provider);
  socialDeferredRetryCounts.set(
    provider,
    (socialDeferredRetryCounts.get(provider) ?? 0) + 1,
  );
  const label = socialDebugLabels[provider];
  addDebugEvent(
    "change",
    `[${label}] retry scheduled in ${Math.round(retryMs / 1000).toLocaleString()}s after ${stage}`,
  );
  const timer = setTimeout(() => {
    socialDeferredRetryTimers.delete(provider);
    void refreshSocialProvider(provider);
  }, retryMs);
  socialDeferredRetryTimers.set(provider, timer);
}

function handleSocialResult(
  provider: RetriableSocialProvider,
  stage: string | null,
): void {
  if (shouldRetrySocialStage(stage)) {
    scheduleSocialDeferredRetry(provider, stage ?? "deferred");
  } else {
    clearSocialDeferredRetry(provider);
  }
}

export async function refreshSocialProvider(
  provider: RetriableSocialProvider,
): Promise<void> {
  if (!isTauri() || isProviderPaused(provider)) {
    clearSocialDeferredRetry(provider);
    return;
  }

  const store = useAppStore.getState();
  try {
    if (provider === "facebook" && store.fbAuth.isAuthenticated) {
      const result = await withProviderSyncing("facebook", () => captureFbFeed());
      handleSocialResult("facebook", result.diag.errorStage);
      return;
    }
    if (provider === "instagram" && store.igAuth.isAuthenticated) {
      const result = await withProviderSyncing("instagram", () => captureIgFeed());
      handleSocialResult("instagram", result.diag.errorStage);
      return;
    }
    if (provider === "linkedin" && store.liAuth.isAuthenticated) {
      const result = await withProviderSyncing("linkedin", () => captureLiFeed());
      handleSocialResult("linkedin", result.diag.errorStage);
      return;
    }
    clearSocialDeferredRetry(provider);
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : `${provider} feed sync failed`;
    console.error(`[Refresh] ${provider} feed failed:`, error);
    addDebugEvent("error", `[${socialDebugLabels[provider]}] feed sync threw: ${msg}`);
    if (!useAppStore.getState().error) {
      store.setError(msg);
    }
    clearSocialDeferredRetry(provider);
  }
}

async function refreshEnabledRssFeeds(
  store: ReturnType<typeof useAppStore.getState>,
  feeds: RssFeed[],
): Promise<void> {
  if (feeds.length === 0) return;
  try {
    await withProviderSyncing("rss", async () => {
      const allNewItems: FeedItem[] = [];
      const fetchedFeeds: RssFeed[] = [];
      const feedUpdates: RssFeed[] = [];
      const feedErrors: string[] = [];
      const rssStartedAt = Date.now();
      const rssBefore = store.items.filter(
        (item) => item.platform === "rss",
      ).length;
      let rssSeen = 0;

      for (let i = 0; i < feeds.length; i += FETCH_CONCURRENCY) {
        const batch = feeds.slice(i, i + FETCH_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (feed) => {
            const { items, liveTitle, liveSiteUrl } = await fetchRssFeed(
              feed.url,
            );
            const isUntitled =
              feed.title === "Untitled Feed" || feed.title === feed.url;

            let healedTitle: string | undefined;
            if (isUntitled) {
              try {
                healedTitle =
                  liveTitle ??
                  new URL(feed.url).hostname.replace(/^(?:www|feeds?)\./, "");
              } catch {
                healedTitle = liveTitle;
              }
              console.log(
                `[Heal] ${feed.url} | stored="${feed.title}" liveTitle="${liveTitle}" healedTitle="${healedTitle}"`,
              );
            }

            return {
              feed: {
                ...markFeedFetchSucceeded(feed, Date.now()),
                ...(healedTitle ? { title: healedTitle } : {}),
                ...(!feed.siteUrl && liveSiteUrl
                  ? { siteUrl: liveSiteUrl }
                  : {}),
              },
              items,
            };
          }),
        );

        for (const [resultIndex, result] of results.entries()) {
          if (result.status === "fulfilled") {
            fetchedFeeds.push(result.value.feed);
            feedUpdates.push(result.value.feed);
            allNewItems.push(...result.value.items);
            rssSeen += result.value.items.length;
            await recordProviderHealthEvent({
              provider: "rss",
              scope: "rss_feed",
              feedUrl: result.value.feed.url,
              feedTitle: result.value.feed.title,
              outcome: result.value.items.length > 0 ? "success" : "empty",
              stage: result.value.items.length > 0 ? undefined : "empty",
              reason:
                result.value.items.length > 0 ? undefined : "No entries pulled",
              startedAt: rssStartedAt,
              finishedAt: Date.now(),
              itemsSeen: result.value.items.length,
              itemsAdded: result.value.items.length,
            });
          } else {
            const msg =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            console.error("[Refresh] Feed fetch failed:", result.reason);
            feedErrors.push(msg);
            addDebugEvent("error", `[RSS] feed fetch failed: ${msg}`);
            const failedFeed = batch[resultIndex];
            if (failedFeed) {
              feedUpdates.push(markFeedFetchFailed(failedFeed, msg, Date.now()));
              await recordProviderHealthEvent({
                provider: "rss",
                scope: "rss_feed",
                feedUrl: failedFeed.url,
                feedTitle: failedFeed.title,
                outcome: "error",
                stage: "fetch",
                reason: msg,
                startedAt: rssStartedAt,
                finishedAt: Date.now(),
              });
            }
          }
        }
      }

      if (feedUpdates.length > 0 || allNewItems.length > 0) {
        await docBatchRefreshFeeds(feedUpdates, allNewItems);
      }
      const rssAfter = useAppStore
        .getState()
        .items.filter((item) => item.platform === "rss").length;
      const rssItemsAdded = Math.max(0, rssAfter - rssBefore);
      await recordProviderHealthEvent({
        provider: "rss",
        outcome: fetchedFeeds.length > 0 ? "success" : "error",
        stage: fetchedFeeds.length > 0 ? undefined : "fetch",
        reason:
          fetchedFeeds.length > 0
            ? feedErrors.length > 0
              ? `${feedErrors.length.toLocaleString()} feed failure${feedErrors.length === 1 ? "" : "s"} in batch`
              : undefined
            : (feedErrors[0] ?? "RSS refresh failed"),
        startedAt: rssStartedAt,
        finishedAt: Date.now(),
        itemsSeen: rssSeen,
        itemsAdded: rssItemsAdded,
      });

      if (feedErrors.length > 0) {
        if (feedErrors.length === feeds.length) {
          store.setError(
            feedErrors.length === 1
              ? `Feed failed to load: ${feedErrors[0]}`
              : `All ${feedErrors.length.toLocaleString()} feeds failed to load. Check your network connection.`,
          );
        } else {
          console.warn(
            `[Refresh] ${feedErrors.length.toLocaleString()}/${feeds.length.toLocaleString()} feeds failed (partial):`,
            feedErrors,
          );
        }
      }
    });
  } catch (rssError) {
    const msg =
      rssError instanceof Error ? rssError.message : "RSS refresh failed";
    console.error("[Refresh] RSS batch failed:", rssError);
    store.setError(msg);
    addDebugEvent("error", `[RSS] batch refresh failed: ${msg}`);
    await recordProviderHealthEvent({
      provider: "rss",
      outcome: "error",
      stage: "merge",
      reason: msg,
      finishedAt: Date.now(),
    });
  }
}

export async function refreshRssFeeds(
  options: RssRefreshPlanOptions = {},
): Promise<void> {
  if (!isTauri()) {
    addDebugEvent(
      "change",
      "[Capture] Browser preview skips native RSS refresh",
    );
    return;
  }
  const store = useAppStore.getState();
  const enabledFeeds = Object.values(store.feeds).filter((f) => f.enabled);
  const feeds = selectRssFeedsForRefresh(enabledFeeds, options);
  if (feeds.length === 0) return;

  store.setSyncing(true);
  store.setError(null);

  try {
    await refreshEnabledRssFeeds(store, feeds);
  } finally {
    store.setSyncing(false);
  }
}

/**
 * Refresh all subscribed RSS feeds and authenticated social providers.
 */
export async function refreshAllFeeds(
  options: RssRefreshPlanOptions = {},
): Promise<void> {
  if (!isTauri()) {
    addDebugEvent(
      "change",
      "[Capture] Browser preview skips native background refresh",
    );
    return;
  }
  const store = useAppStore.getState();
  const enabledFeeds = Object.values(store.feeds).filter((f) => f.enabled);
  const feeds = selectRssFeedsForRefresh(enabledFeeds, options);
  const tauriAvailable = isTauri();
  const hasNativeSocialRefresh =
    tauriAvailable &&
    (store.xAuth.isAuthenticated ||
      store.fbAuth.isAuthenticated ||
      store.igAuth.isAuthenticated ||
      store.liAuth.isAuthenticated);

  if (feeds.length === 0 && !hasNativeSocialRefresh) return;

  store.setSyncing(true);
  store.setError(null);

  try {
    await refreshEnabledRssFeeds(store, feeds);

    // ── X timeline ────────────────────────────────────────────────────────────
    // Always runs, fully independent of RSS outcome.
    const { xAuth } = useAppStore.getState();
    const xCookies = xAuth.cookies;
    if (
      tauriAvailable &&
      xAuth.isAuthenticated &&
      xCookies &&
      !isProviderPaused("x")
    ) {
      try {
        await withProviderSyncing("x", () => captureXTimeline(xCookies));
      } catch (xError) {
        const msg =
          xError instanceof Error ? xError.message : "X timeline sync failed";
        console.error("[Refresh] X timeline failed:", xError);
        addDebugEvent("error", `[X] timeline sync threw: ${msg}`);
        if (!useAppStore.getState().error) {
          store.setError(msg);
        }
      }
    }

    await refreshSocialProvider("facebook");
    await refreshSocialProvider("instagram");
    await refreshSocialProvider("linkedin");
  } finally {
    store.setSyncing(false);
  }
}

// =============================================================================
// OPML Batch Import / Export
// =============================================================================

/** Progress state during OPML batch import */
export interface ImportProgress {
  total: number;
  completed: number;
  current: string;
  added: number;
  skipped: number;
  failed: Array<{ url: string; error: string }>;
}

/**
 * Import feeds from parsed OPML entries.
 *
 * Subscribes to each feed (skipping duplicates), then triggers a full
 * refresh cycle to fetch initial items for the newly added feeds.
 *
 * @param feeds - Parsed OPML feed entries to import
 * @param onProgress - Optional callback invoked after each feed is processed
 * @returns Final import progress with counts and error details
 */
export async function importOPMLFeeds(
  feeds: OPMLFeedEntry[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportProgress> {
  const store = useAppStore.getState();
  const existingUrls = new Set(Object.values(store.feeds).map((f) => f.url));

  const progress: ImportProgress = {
    total: feeds.length,
    completed: 0,
    current: "",
    added: 0,
    skipped: 0,
    failed: [],
  };

  for (const feed of feeds) {
    // Skip feeds already subscribed
    if (existingUrls.has(feed.url)) {
      progress.skipped++;
      progress.completed++;
      onProgress?.({ ...progress });
      continue;
    }

    progress.current = feed.title;
    onProgress?.({ ...progress });

    try {
      const rssFeed: RssFeed = {
        url: feed.url,
        title: feed.title,
        ...(feed.siteUrl ? { siteUrl: feed.siteUrl } : {}),
        enabled: true,
        trackUnread: false,
        ...(feed.folder ? { folder: feed.folder } : {}),
      };
      await store.addFeed(rssFeed);
      existingUrls.add(feed.url);
      progress.added++;
    } catch (err) {
      progress.failed.push({
        url: feed.url,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    progress.completed++;
    onProgress?.({ ...progress });
  }

  // Trigger refresh to fetch items for newly subscribed feeds
  if (progress.added > 0) {
    // Fire-and-forget. The UI shows sync spinner via store state.
    void refreshRssFeeds();
  }

  return progress;
}

/**
 * Export all current feed subscriptions as an OPML file download.
 */
export function exportFeedsAsOPML(): void {
  const store = useAppStore.getState();
  const feeds = Object.values(store.feeds);

  if (feeds.length === 0) return;

  const xml = generateOPML(feeds);
  const filename = `freed-feeds-${new Date().toISOString().slice(0, 10)}.opml`;
  downloadFile(xml, filename);
}
