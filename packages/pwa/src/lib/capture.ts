/**
 * Feed management for the PWA
 *
 * The PWA is a reader — it manages feed subscriptions and displays items
 * synced from the desktop app via Automerge. It does NOT fetch RSS feeds
 * directly (no CORS proxy needed).
 *
 * Feed subscription management (add/remove/import/export) happens locally
 * in the Automerge document. The desktop app reads those subscriptions and
 * performs the actual fetching, pushing items back through Automerge sync.
 */

import type { RssFeed } from "@freed/shared";
import { useAppStore } from "./store";
import { toast } from "../components/Toast";
import type { OPMLFeedEntry } from "@freed/shared";
import { generateOPML, downloadFile } from "@freed/shared";

// =============================================================================
// Feed Subscription Management
// =============================================================================

/**
 * Subscribe to an RSS feed by URL.
 *
 * This only registers the subscription in the Automerge document —
 * the desktop app handles actual feed fetching and item population.
 */
export async function addRssFeed(feedUrl: string): Promise<void> {
  const store = useAppStore.getState();

  store.setLoading(true);
  store.setError(null);

  try {
    const feed: RssFeed = {
      url: feedUrl,
      title: new URL(feedUrl).hostname,
      enabled: true,
      trackUnread: false,
    };

    await store.addFeed(feed);
    toast.success(`Subscribed to ${feed.title}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add feed";
    store.setError(message);
    toast.error(message);
    throw error;
  } finally {
    store.setLoading(false);
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
 * Subscribes to each feed in the Automerge document (skipping duplicates).
 * The desktop app will pick up the new subscriptions and fetch their items.
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
        siteUrl: feed.siteUrl,
        enabled: true,
        trackUnread: false,
        folder: feed.folder,
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

  if (progress.added > 0) {
    toast.success(
      `Subscribed to ${progress.added} feed${progress.added !== 1 ? "s" : ""}`,
    );
  }

  return progress;
}

/**
 * Export all current feed subscriptions as an OPML file download.
 */
export function exportFeedsAsOPML(): void {
  const store = useAppStore.getState();
  const feeds = Object.values(store.feeds);

  if (feeds.length === 0) {
    toast.info("No feeds to export");
    return;
  }

  const xml = generateOPML(feeds);
  const filename = `freed-feeds-${new Date().toISOString().slice(0, 10)}.opml`;
  downloadFile(xml, filename);
  toast.success(`Exported ${feeds.length} feeds`);
}
