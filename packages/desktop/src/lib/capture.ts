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
import { parseFeedXml, feedToFeedItems, feedToRssFeed } from "@freed/capture-rss";
import { captureXTimeline } from "./x-capture";
import { docBatchRefreshFeeds } from "./automerge";
import { useAppStore } from "./store";

/**
 * Fetch URL via Tauri backend (bypasses CORS)
 */
async function fetchUrl(url: string): Promise<string> {
  return invoke<string>("fetch_url", { url });
}

/**
 * Fetch and parse an RSS feed via Tauri backend.
 * Transport is Tauri IPC; parsing/normalization is @freed/capture-rss.
 */
async function fetchRssFeed(feedUrl: string): Promise<FeedItem[]> {
  const xml = await fetchUrl(feedUrl);
  const parsed = await parseFeedXml(xml, feedUrl);
  return feedToFeedItems(parsed);
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
 * Refresh all subscribed RSS feeds.
 *
 * Key performance contract: ALL feed fetches run in parallel batches, and the
 * entire result (feed timestamps + new items) is committed as ONE Automerge
 * change. Previously this was N sequential changes → N full-doc IndexedDB
 * writes → N React re-renders → N rankFeedItems passes. Now it's 1.
 */
export async function refreshAllFeeds(): Promise<void> {
  const store = useAppStore.getState();
  const feeds = Object.values(store.feeds).filter((f) => f.enabled);

  if (feeds.length === 0) return;

  store.setSyncing(true);
  store.setError(null);

  try {
    const allNewItems: FeedItem[] = [];
    const fetchedFeeds: RssFeed[] = [];

    // Parallel fetch with concurrency cap
    for (let i = 0; i < feeds.length; i += FETCH_CONCURRENCY) {
      const batch = feeds.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (feed) => {
          const items = await fetchRssFeed(feed.url);
          const liveFeedTitle = items[0]?.rssSource?.feedTitle;
          const liveSiteUrl = items[0]?.rssSource?.siteUrl;
          // Sentinel check: OPML fallback or raw URL as title both indicate a broken import
          const isUntitled = feed.title === "Untitled Feed" || feed.title === feed.url;
          return {
            feed: {
              ...feed,
              lastFetched: Date.now(),
              ...(isUntitled && liveFeedTitle ? { title: liveFeedTitle } : {}),
              ...(!feed.siteUrl && liveSiteUrl ? { siteUrl: liveSiteUrl } : {}),
            },
            items,
          };
        }),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          fetchedFeeds.push(result.value.feed);
          allNewItems.push(...result.value.items);
        } else {
          console.error("[Refresh] Feed fetch failed:", result.reason);
        }
      }
    }

    // Single Automerge change for ALL feed + item updates
    if (fetchedFeeds.length > 0 || allNewItems.length > 0) {
      await docBatchRefreshFeeds(fetchedFeeds, allNewItems);
    }

    // X timeline — separate change since it has its own auth path
    const { xAuth } = store;
    if (xAuth.isAuthenticated && xAuth.cookies) {
      try {
        await captureXTimeline(xAuth.cookies);
      } catch (error) {
        console.error("Failed to capture X timeline:", error);
      }
    }
  } catch (error) {
    store.setError(
      error instanceof Error ? error.message : "Failed to refresh feeds",
    );
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
