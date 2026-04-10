/**
 * Capture service for fetching RSS feeds
 *
 * Uses Tauri backend to bypass CORS restrictions. RSS parsing and
 * normalization delegate to @freed/capture-rss; only the HTTP transport
 * layer lives here because it must go through Tauri's fetch_url IPC.
 */

import { invoke } from "@tauri-apps/api/core";
import type { FeedItem, RssFeed, OPMLFeedEntry } from "@freed/shared";
import { generateOPML, downloadFile } from "@freed/shared";
import { parseFeedXml, feedToFeedItems, feedToRssFeed } from "@freed/capture-rss/browser";
import { captureXTimeline } from "./x-capture";
import { captureFbFeed } from "./fb-capture";
import { captureIgFeed } from "./instagram-capture";
import { captureLiFeed } from "./li-capture";
import { docBatchRefreshFeeds } from "./automerge";
import { useAppStore, withProviderSyncing } from "./store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { isProviderPaused, recordProviderHealthEvent } from "./provider-health";

/**
 * Fetch URL via Tauri backend (bypasses CORS)
 */
async function fetchUrl(url: string): Promise<string> {
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
      error instanceof Error ? error.message : "Failed to add feed"
    );
    throw error;
  } finally {
    store.setLoading(false);
  }
}

/** Max concurrent feed fetches — avoids saturating Tauri's HTTP layer. */
const FETCH_CONCURRENCY = 5;

/**
 * Refresh all subscribed RSS feeds and the X timeline.
 *
 * Key performance contract: ALL feed fetches run in parallel batches, and the
 * entire result (feed timestamps + new items) is committed as ONE Automerge
 * change. Previously this was N sequential changes → N full-doc IndexedDB
 * writes → N React re-renders → N rankFeedItems passes. Now it's 1.
 *
 * Error isolation contract: RSS and X are fully independent. A failure in
 * either path is logged and surfaces a user notification, but never prevents
 * the other path from running. Individual feed fetch failures are logged
 * silently unless every single feed failed (in which case the user is told).
 */
export async function refreshAllFeeds(): Promise<void> {
  const store = useAppStore.getState();
  const feeds = Object.values(store.feeds).filter((f) => f.enabled);

  // Skip only when there is truly nothing to do.
  if (feeds.length === 0 && !store.xAuth.isAuthenticated && !store.fbAuth.isAuthenticated && !store.igAuth.isAuthenticated && !store.liAuth.isAuthenticated) return;

  store.setSyncing(true);
  store.setError(null);

  try {
    // ── RSS feeds ─────────────────────────────────────────────────────────────
    // Each feed fetch is already isolated by Promise.allSettled. The Automerge
    // commit is wrapped in its own try/catch so a CRDT write error can't
    // prevent the X capture below from running.
    try {
      await withProviderSyncing("rss", async () => {
        const allNewItems: FeedItem[] = [];
        const fetchedFeeds: RssFeed[] = [];
        const feedErrors: string[] = [];
        const rssStartedAt = Date.now();
        const rssBefore = store.items.filter((item) => item.platform === "rss").length;
        let rssSeen = 0;

        // Parallel fetch with concurrency cap
        for (let i = 0; i < feeds.length; i += FETCH_CONCURRENCY) {
          const batch = feeds.slice(i, i + FETCH_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (feed) => {
              const { items, liveTitle, liveSiteUrl } = await fetchRssFeed(feed.url);

              // Sentinel check: OPML fallback or raw URL as title both indicate a broken import.
              const isUntitled = feed.title === "Untitled Feed" || feed.title === feed.url;

              // Resolve the best available title:
              //   1. Live XML title (if the parser found one)
              //   2. Hostname of the feed URL (e.g. "news.ycombinator.com") as a
              //      last resort so the feed doesn't stay labelled "Untitled Feed"
              //      forever when the XML genuinely omits a <title> element.
              let healedTitle: string | undefined;
              if (isUntitled) {
                try {
                  healedTitle = liveTitle ?? new URL(feed.url).hostname.replace(/^(?:www|feeds?)\./, "");
                } catch {
                  healedTitle = liveTitle;
                }
                console.log(
                  `[Heal] ${feed.url} | stored="${feed.title}" liveTitle="${liveTitle}" healedTitle="${healedTitle}"`,
                );
              }

              return {
                feed: {
                  ...feed,
                  lastFetched: Date.now(),
                  ...(healedTitle ? { title: healedTitle } : {}),
                  ...(!feed.siteUrl && liveSiteUrl ? { siteUrl: liveSiteUrl } : {}),
                },
                items,
              };
            }),
          );

          for (const [resultIndex, result] of results.entries()) {
            if (result.status === "fulfilled") {
              fetchedFeeds.push(result.value.feed);
              allNewItems.push(...result.value.items);
              rssSeen += result.value.items.length;
              await recordProviderHealthEvent({
                provider: "rss",
                scope: "rss_feed",
                feedUrl: result.value.feed.url,
                feedTitle: result.value.feed.title,
                outcome: result.value.items.length > 0 ? "success" : "empty",
                stage: result.value.items.length > 0 ? undefined : "empty",
                reason: result.value.items.length > 0 ? undefined : "No entries pulled",
                startedAt: rssStartedAt,
                finishedAt: Date.now(),
                itemsSeen: result.value.items.length,
                itemsAdded: result.value.items.length,
              });
            } else {
              const msg = result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
              console.error("[Refresh] Feed fetch failed:", result.reason);
              feedErrors.push(msg);
              addDebugEvent("error", `[RSS] feed fetch failed: ${msg}`);
              const failedFeed = batch[resultIndex];
              if (failedFeed) {
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

        // Single Automerge change for ALL feed + item updates
        if (fetchedFeeds.length > 0 || allNewItems.length > 0) {
          await docBatchRefreshFeeds(fetchedFeeds, allNewItems);
        }
        const rssAfter = useAppStore.getState().items.filter((item) => item.platform === "rss").length;
        const rssItemsAdded = Math.max(0, rssAfter - rssBefore);
        if (feeds.length > 0) {
          await recordProviderHealthEvent({
            provider: "rss",
            outcome: fetchedFeeds.length > 0 ? "success" : "error",
            stage:
              fetchedFeeds.length > 0
                ? undefined
                : "fetch",
            reason:
              fetchedFeeds.length > 0
                ? feedErrors.length > 0
                  ? `${feedErrors.length.toLocaleString()} feed failure${feedErrors.length === 1 ? "" : "s"} in batch`
                  : undefined
                : feedErrors[0] ?? "RSS refresh failed",
            startedAt: rssStartedAt,
            finishedAt: Date.now(),
            itemsSeen: rssSeen,
            itemsAdded: rssItemsAdded,
          });
        }

        // Surface per-feed failures to the user only when every feed failed.
        // Partial failures are logged but kept silent - some fresh content is
        // better than a scary error banner.
        if (feedErrors.length > 0) {
          if (feedErrors.length === feeds.length) {
            store.setError(
              feedErrors.length === 1
                ? `Feed failed to load: ${feedErrors[0]}`
                : `All ${feedErrors.length} feeds failed to load. Check your network connection.`,
            );
          } else {
            console.warn(
              `[Refresh] ${feedErrors.length}/${feeds.length} feeds failed (partial):`,
              feedErrors,
            );
          }
        }
      });
    } catch (rssError) {
      // Automerge commit error or unexpected RSS failure — log and notify,
      // but continue so the X capture below still runs.
      const msg = rssError instanceof Error ? rssError.message : "RSS refresh failed";
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

    // ── X timeline ────────────────────────────────────────────────────────────
    // Always runs, fully independent of RSS outcome.
    const { xAuth } = useAppStore.getState();
    const xCookies = xAuth.cookies;
    if (xAuth.isAuthenticated && xCookies && !isProviderPaused("x")) {
      try {
        await withProviderSyncing("x", () => captureXTimeline(xCookies));
      } catch (xError) {
        const msg = xError instanceof Error ? xError.message : "X timeline sync failed";
        console.error("[Refresh] X timeline failed:", xError);
        addDebugEvent("error", `[X] timeline sync threw: ${msg}`);
        if (!useAppStore.getState().error) {
          store.setError(msg);
        }
      }
    }

    // ── Facebook feed ─────────────────────────────────────────────────────────
    // Independent of both RSS and X outcomes.
    const { fbAuth } = useAppStore.getState();
    if (fbAuth.isAuthenticated && !isProviderPaused("facebook")) {
      try {
        await withProviderSyncing("facebook", () => captureFbFeed());
      } catch (fbError) {
        const msg = fbError instanceof Error ? fbError.message : "Facebook feed sync failed";
        console.error("[Refresh] Facebook feed failed:", fbError);
        addDebugEvent("error", `[FB] feed sync threw: ${msg}`);
        if (!useAppStore.getState().error) {
          store.setError(msg);
        }
      }
    }

    // ── Instagram feed ───────────────────────────────────────────────────────
    // Independent of RSS, X, and Facebook outcomes.
    const { igAuth } = useAppStore.getState();
    if (igAuth.isAuthenticated && !isProviderPaused("instagram")) {
      try {
        await withProviderSyncing("instagram", () => captureIgFeed());
      } catch (igError) {
        const msg = igError instanceof Error ? igError.message : "Instagram feed sync failed";
        console.error("[Refresh] Instagram feed failed:", igError);
        addDebugEvent("error", `[IG] feed sync threw: ${msg}`);
        if (!useAppStore.getState().error) {
          store.setError(msg);
        }
      }
    }

    // ── LinkedIn feed ─────────────────────────────────────────────────────────
    // Independent of RSS, X, Facebook, and Instagram outcomes.
    const { liAuth } = useAppStore.getState();
    if (liAuth.isAuthenticated && !isProviderPaused("linkedin")) {
      try {
        await withProviderSyncing("linkedin", () => captureLiFeed());
      } catch (liError) {
        const msg = liError instanceof Error ? liError.message : "LinkedIn feed sync failed";
        console.error("[Refresh] LinkedIn feed failed:", liError);
        addDebugEvent("error", `[LI] feed sync threw: ${msg}`);
        if (!useAppStore.getState().error) {
          store.setError(msg);
        }
      }
    }
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
    // Fire-and-forget — the UI shows sync spinner via store state
    refreshAllFeeds();
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
