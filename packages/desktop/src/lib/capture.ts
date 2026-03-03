/**
 * Capture service for fetching RSS feeds
 *
 * Uses Tauri backend to bypass CORS restrictions.
 */

import { invoke } from "@tauri-apps/api/core";
import type { FeedItem, RssFeed } from "@freed/shared";
import { useAppStore } from "./store";
import type { OPMLFeedEntry } from "@freed/shared";
import { generateOPML, downloadFile } from "@freed/shared";
import { captureXTimeline } from "./x-capture";
import { docBatchRefreshFeeds } from "./automerge";

// Simple RSS XML parser
interface RssChannel {
  title: string;
  link: string;
  description: string;
  items: RssItem[];
}

interface RssItem {
  title: string;
  link: string;
  /** RSS <guid> or Atom <id> — preferred stable key over link URL */
  guid?: string;
  description?: string;
  pubDate?: string;
  content?: string;
  author?: string;
}

/**
 * Fetch URL via Tauri backend (bypasses CORS)
 */
async function fetchUrl(url: string): Promise<string> {
  return invoke<string>("fetch_url", { url });
}

/**
 * Parse RSS/Atom XML into structured data
 */
function parseRssFeed(xml: string, feedUrl: string): RssChannel {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid XML: " + parseError.textContent);
  }

  // Check for Atom format
  const atomFeed = doc.querySelector("feed");
  if (atomFeed) {
    return parseAtom(atomFeed, feedUrl);
  }

  // RSS format
  const channel = doc.querySelector("channel");
  if (!channel) {
    throw new Error("Invalid RSS feed: no channel element");
  }

  const title = channel.querySelector("title")?.textContent || feedUrl;
  const link = channel.querySelector("link")?.textContent || feedUrl;
  const description = channel.querySelector("description")?.textContent || "";

  const items: RssItem[] = [];
  channel.querySelectorAll("item").forEach((item) => {
    items.push({
      title: item.querySelector("title")?.textContent || "Untitled",
      link: item.querySelector("link")?.textContent || "",
      guid: item.querySelector("guid")?.textContent || undefined,
      description: item.querySelector("description")?.textContent || undefined,
      pubDate: item.querySelector("pubDate")?.textContent || undefined,
      content:
        item.querySelector("content\\:encoded")?.textContent || undefined,
      author: item.querySelector("author")?.textContent || undefined,
    });
  });

  return { title, link, description, items };
}

/**
 * Parse Atom format
 */
function parseAtom(feed: Element, feedUrl: string): RssChannel {
  const title = feed.querySelector("title")?.textContent || feedUrl;
  const linkEl = feed.querySelector('link[rel="alternate"]') || feed.querySelector("link");
  const link = linkEl?.getAttribute("href") || feedUrl;

  const items: RssItem[] = [];
  feed.querySelectorAll("entry").forEach((entry) => {
    const entryLinkEl = entry.querySelector('link[rel="alternate"]') || entry.querySelector("link");
    items.push({
      title: entry.querySelector("title")?.textContent || "Untitled",
      link: entryLinkEl?.getAttribute("href") || "",
      // Atom uses <id> as the stable unique identifier
      guid: entry.querySelector("id")?.textContent || undefined,
      description: entry.querySelector("summary")?.textContent || undefined,
      pubDate:
        entry.querySelector("published")?.textContent ||
        entry.querySelector("updated")?.textContent ||
        undefined,
      content: entry.querySelector("content")?.textContent || undefined,
      author: entry.querySelector("author > name")?.textContent || undefined,
    });
  });

  return { title, link, description: "", items };
}

/**
 * Convert parsed RSS items to FeedItems
 */
function rssToFeedItems(channel: RssChannel, feedUrl: string): FeedItem[] {
  const now = Date.now();
  let siteHost: string;
  try {
    siteHost = new URL(channel.link).hostname;
  } catch {
    siteHost = feedUrl;
  }

  return channel.items.map((item, index) => {
    const parsedDate = item.pubDate ? new Date(item.pubDate).getTime() : NaN;
    const publishedAt = Number.isFinite(parsedDate)
      ? parsedDate
      : now - index * 3600000; // Fallback: 1 hour apart

    // Build content — Automerge forbids `undefined` values, so optional
    // sub-objects use conditional spread to omit keys entirely.
    const content: FeedItem["content"] = {
      text: stripHtml(item.description || item.content || ""),
      mediaUrls: [],
      mediaTypes: [],
    };
    if (item.link) {
      content.linkPreview = {
        url: item.link,
        title: item.title,
        ...(item.description != null ? { description: item.description } : {}),
      };
    }

    const feedItem: FeedItem = {
      // Key priority: <guid>/<id> → article link → positional fallback.
      // <guid> is the RSS 2.0 spec's stable identifier; <id> is Atom's.
      // The positional fallback is unstable (shifts when publishers reorder
      // items), so it's a last resort only.
      globalId: `rss:${item.guid || item.link || feedUrl + "#" + index}`,
      platform: "rss" as const,
      contentType: "article" as const,
      capturedAt: now,
      publishedAt,
      author: {
        id: siteHost,
        handle: siteHost,
        displayName: channel.title,
      },
      content,
      rssSource: {
        feedUrl,
        feedTitle: channel.title,
        siteUrl: channel.link,
      },
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: [],
    };

    if (item.content) {
      const plainText = stripHtml(item.content);
      feedItem.preservedContent = {
        html: item.content,
        text: plainText,
        wordCount: plainText.split(/\s+/).length,
        readingTime: Math.ceil(plainText.split(/\s+/).length / 200),
        preservedAt: now,
      };
    }

    return feedItem;
  });
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

/**
 * Fetch and parse an RSS feed via Tauri backend
 */
export async function fetchRssFeed(feedUrl: string): Promise<FeedItem[]> {
  const xml = await fetchUrl(feedUrl);
  const channel = parseRssFeed(xml, feedUrl);
  return rssToFeedItems(channel, feedUrl);
}

/**
 * Add a new RSS feed and fetch its items
 */
export async function addRssFeed(feedUrl: string): Promise<void> {
  const store = useAppStore.getState();

  store.setLoading(true);
  store.setError(null);

  try {
    // Fetch items
    const newItems = await fetchRssFeed(feedUrl);

    if (newItems.length === 0) {
      throw new Error("No items found in feed");
    }

    // Add feed to store (persisted via Automerge).
    // Only include siteUrl if defined — Automerge rejects `undefined` values.
    const siteUrl = newItems[0]?.rssSource?.siteUrl;
    const feed: RssFeed = {
      url: feedUrl,
      title: newItems[0]?.rssSource?.feedTitle || feedUrl,
      ...(siteUrl ? { siteUrl } : {}),
      lastFetched: Date.now(),
      enabled: true,
      trackUnread: false,
    };

    await store.addFeed(feed);

    // Add items (persisted via Automerge, deduplication handled there)
    await store.addItems(newItems);
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
