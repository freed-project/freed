/**
 * RSS/Atom feed parser with conditional GET support
 */

import Parser from "rss-parser";
import type {
  ParsedFeed,
  ParsedFeedItem,
  FetchOptions,
  FetchResult,
} from "./types.js";

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = "FREED/1.0 (https://freed.wtf) Feed Reader";

// =============================================================================
// Parser Setup
// =============================================================================

/**
 * Create a configured RSS parser instance
 */
function createParser(): Parser {
  return new Parser({
    customFields: {
      feed: ["language", "image"],
      item: [
        ["media:content", "media:content"],
        ["media:thumbnail", "media:thumbnail"],
        ["dc:creator", "creator"],
        ["content:encoded", "content"],
      ],
    },
    timeout: DEFAULT_TIMEOUT,
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
  });
}

const parser = createParser();

// =============================================================================
// Feed Fetching
// =============================================================================

/**
 * Fetch and parse an RSS/Atom feed with conditional GET support
 *
 * @param url - The feed URL to fetch
 * @param options - Fetch options including ETag/Last-Modified for conditional GET
 * @returns The parsed feed or indication that it's unchanged
 */
export async function fetchFeed(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
    Accept:
      "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  };

  // Add conditional GET headers if we have them
  if (options.etag) {
    headers["If-None-Match"] = options.etag;
  }
  if (options.lastModified) {
    headers["If-Modified-Since"] = options.lastModified;
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout || DEFAULT_TIMEOUT,
  );

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle 304 Not Modified
    if (response.status === 304) {
      return { unchanged: true };
    }

    // Handle errors
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get caching headers
    const etag = response.headers.get("etag") || undefined;
    const lastModified = response.headers.get("last-modified") || undefined;

    // Parse the feed
    const xml = await response.text();
    const parsed = await parser.parseString(xml);

    // Normalize to our feed format
    const feed: ParsedFeed = {
      title: parsed.title || "Untitled Feed",
      description: parsed.description,
      link: parsed.link,
      feedUrl: url,
      language: (parsed as any).language,
      lastBuildDate: parsed.lastBuildDate,
      image: (parsed as any).image,
      items: (parsed.items || []).map(normalizeItem),
    };

    return { unchanged: false, feed, etag, lastModified };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Request timeout after ${options.timeout || DEFAULT_TIMEOUT}ms`,
      );
    }

    throw error;
  }
}

/**
 * Normalize a parsed feed item to our format
 */
function normalizeItem(item: any): ParsedFeedItem {
  return {
    title: item.title,
    link: item.link,
    guid: item.guid || item.id || item.link,
    pubDate: item.pubDate || item.isoDate,
    creator: item.creator || item.author,
    content: item.content || item["content:encoded"],
    contentSnippet: item.contentSnippet || item.summary,
    summary: item.summary,
    categories: item.categories,
    enclosure: item.enclosure,
    "media:content": item["media:content"],
    "media:thumbnail": item["media:thumbnail"],
  };
}

// =============================================================================
// Feed Validation
// =============================================================================

/**
 * Check if a URL points to a valid RSS/Atom feed
 */
export async function validateFeed(url: string): Promise<boolean> {
  try {
    const result = await fetchFeed(url, { timeout: 10000 });
    return !result.unchanged && !!result.feed;
  } catch {
    return false;
  }
}

/**
 * Get feed metadata without fetching all items
 */
export async function getFeedMetadata(url: string): Promise<{
  title: string;
  description?: string;
  link?: string;
  imageUrl?: string;
} | null> {
  try {
    const result = await fetchFeed(url, { timeout: 10000 });

    if (result.unchanged || !result.feed) {
      return null;
    }

    return {
      title: result.feed.title,
      description: result.feed.description,
      link: result.feed.link,
      imageUrl: result.feed.image?.url,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Batch Fetching
// =============================================================================

/**
 * Fetch multiple feeds in parallel with rate limiting
 *
 * @param feeds - Array of feed URLs with optional caching info
 * @param concurrency - Maximum concurrent requests
 * @returns Array of fetch results
 */
export async function fetchFeeds(
  feeds: Array<{ url: string; etag?: string; lastModified?: string }>,
  concurrency: number = 5,
): Promise<Array<{ url: string; result: FetchResult | { error: string } }>> {
  const results: Array<{
    url: string;
    result: FetchResult | { error: string };
  }> = [];

  // Process in batches
  for (let i = 0; i < feeds.length; i += concurrency) {
    const batch = feeds.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async ({ url, etag, lastModified }) => {
        try {
          const result = await fetchFeed(url, { etag, lastModified });
          return { url, result };
        } catch (error) {
          return {
            url,
            result: {
              error: error instanceof Error ? error.message : "Unknown error",
            },
          };
        }
      }),
    );

    results.push(...batchResults);

    // Small delay between batches to be polite
    if (i + concurrency < feeds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}
