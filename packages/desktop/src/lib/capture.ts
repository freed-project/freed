/**
 * Capture service for fetching RSS feeds
 *
 * Uses Tauri backend to bypass CORS restrictions.
 */

import { invoke } from "@tauri-apps/api/core";
import type { FeedItem, RssFeed } from "@freed/shared";
import { useAppStore } from "./store";

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
    const publishedAt = item.pubDate
      ? new Date(item.pubDate).getTime()
      : now - index * 3600000; // Fallback: 1 hour apart

    return {
      globalId: `rss:${item.link || feedUrl + "#" + index}`,
      platform: "rss" as const,
      contentType: "article" as const,
      capturedAt: now,
      publishedAt,
      author: {
        id: siteHost,
        handle: siteHost,
        displayName: channel.title,
      },
      content: {
        text: stripHtml(item.description || item.content || ""),
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: item.link
          ? {
              url: item.link,
              title: item.title,
              description: item.description,
            }
          : undefined,
      },
      preservedContent: item.content
        ? {
            html: item.content,
            text: stripHtml(item.content),
            wordCount: stripHtml(item.content).split(/\s+/).length,
            readingTime: Math.ceil(
              stripHtml(item.content).split(/\s+/).length / 200
            ),
            preservedAt: now,
          }
        : undefined,
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

    // Add feed to store (persisted via Automerge)
    const feed: RssFeed = {
      url: feedUrl,
      title: newItems[0]?.rssSource?.feedTitle || feedUrl,
      siteUrl: newItems[0]?.rssSource?.siteUrl,
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

/**
 * Refresh all subscribed RSS feeds
 */
export async function refreshAllFeeds(): Promise<void> {
  const store = useAppStore.getState();
  const feeds = Object.values(store.feeds);

  if (feeds.length === 0) return;

  store.setSyncing(true);
  store.setError(null);

  try {
    const allNewItems: FeedItem[] = [];

    for (const feed of feeds) {
      if (!feed.enabled) continue;

      try {
        const items = await fetchRssFeed(feed.url);
        allNewItems.push(...items);

        // Update feed's lastFetched (persisted via Automerge)
        await store.addFeed({ ...feed, lastFetched: Date.now() });
      } catch (error) {
        console.error(`Failed to fetch ${feed.url}:`, error);
      }
    }

    // Add all new items (deduplication handled by Automerge layer)
    if (allNewItems.length > 0) {
      await store.addItems(allNewItems);
    }
  } catch (error) {
    store.setError(
      error instanceof Error ? error.message : "Failed to refresh feeds"
    );
  } finally {
    store.setSyncing(false);
  }
}
