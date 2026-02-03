/**
 * RSS/Atom item normalization to FeedItem
 */

import type {
  FeedItem,
  Platform,
  ContentType,
  MediaType,
  RssFeed,
} from "@freed/shared";
import type { ParsedFeed, ParsedFeedItem, MediaContent } from "./types.js";
import { detectPlatform } from "./discovery.js";

// =============================================================================
// Platform Detection
// =============================================================================

/**
 * Detect the platform from a feed URL
 */
function getPlatform(feedUrl: string): Platform {
  const platform = detectPlatform(feedUrl);

  // Map to valid Platform type
  switch (platform) {
    case "youtube":
      return "youtube";
    case "reddit":
      return "reddit";
    case "github":
      return "github";
    case "mastodon":
      return "mastodon";
    default:
      return "rss";
  }
}

/**
 * Detect content type from feed item
 */
function getContentType(item: ParsedFeedItem, platform: Platform): ContentType {
  // Video platforms
  if (platform === "youtube") return "video";

  // Check for podcast enclosure
  if (item.enclosure?.type?.includes("audio")) return "podcast";

  // Long-form content indicators
  const text = item.content || item.contentSnippet || "";
  if (text.length > 2000) return "article";

  // Default to post
  return "post";
}

// =============================================================================
// Media Extraction
// =============================================================================

/**
 * Extract media URLs from an RSS item
 */
function extractMediaUrls(item: ParsedFeedItem): string[] {
  const urls: string[] = [];

  // Check enclosure
  if (item.enclosure?.url) {
    urls.push(item.enclosure.url);
  }

  // Check media:content
  if (item["media:content"]) {
    const mediaContent = Array.isArray(item["media:content"])
      ? item["media:content"]
      : [item["media:content"]];

    for (const media of mediaContent) {
      if (media.$?.url) {
        urls.push(media.$.url);
      }
    }
  }

  // Check media:thumbnail
  if (item["media:thumbnail"]?.$?.url) {
    urls.push(item["media:thumbnail"].$.url);
  }

  // Extract images from content HTML
  const content = item.content || "";
  const imgMatches = content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
  for (const match of imgMatches) {
    if (match[1] && !urls.includes(match[1])) {
      urls.push(match[1]);
    }
  }

  return urls;
}

/**
 * Extract media types from an RSS item
 */
function extractMediaTypes(item: ParsedFeedItem): MediaType[] {
  const types: MediaType[] = [];

  // Check enclosure type
  if (item.enclosure?.type) {
    if (item.enclosure.type.includes("video")) {
      types.push("video");
    } else if (item.enclosure.type.includes("audio")) {
      types.push("video"); // Treat audio as video for now
    } else if (item.enclosure.type.includes("image")) {
      types.push("image");
    }
  }

  // Check media:content
  if (item["media:content"]) {
    const mediaContent = Array.isArray(item["media:content"])
      ? item["media:content"]
      : [item["media:content"]];

    for (const media of mediaContent) {
      const type = media.$?.type || media.$?.medium;
      if (type?.includes("video")) {
        if (!types.includes("video")) types.push("video");
      } else if (type?.includes("image")) {
        if (!types.includes("image")) types.push("image");
      }
    }
  }

  // Check for images in content
  const content = item.content || "";
  if (content.includes("<img")) {
    if (!types.includes("image")) types.push("image");
  }

  // Check for links
  if (item.link) {
    if (!types.includes("link")) types.push("link");
  }

  return types;
}

// =============================================================================
// Text Processing
// =============================================================================

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get clean text content from item
 */
function getTextContent(item: ParsedFeedItem): string | undefined {
  // Prefer content snippet (already stripped)
  if (item.contentSnippet) {
    return item.contentSnippet;
  }

  // Strip HTML from content
  if (item.content) {
    return stripHtml(item.content);
  }

  // Fall back to summary
  if (item.summary) {
    return stripHtml(item.summary);
  }

  return undefined;
}

/**
 * Extract author handle from feed/item
 */
function extractHandle(feed: ParsedFeed, item: ParsedFeedItem): string {
  // Use creator if available
  if (item.creator) return item.creator;

  // Try to extract from feed URL
  const url = feed.feedUrl;

  // Medium: @username
  const mediumMatch = url.match(/medium\.com\/feed\/@([^\/]+)/);
  if (mediumMatch) return `@${mediumMatch[1]}`;

  // Substack: publication name
  const substackMatch = url.match(/([^.]+)\.substack\.com/);
  if (substackMatch) return substackMatch[1];

  // YouTube: channel name from feed title
  if (url.includes("youtube.com")) {
    return feed.title;
  }

  // Reddit: subreddit or user
  const redditSubMatch = url.match(/reddit\.com\/r\/([^\/]+)/);
  if (redditSubMatch) return `r/${redditSubMatch[1]}`;
  const redditUserMatch = url.match(/reddit\.com\/user\/([^\/]+)/);
  if (redditUserMatch) return `u/${redditUserMatch[1]}`;

  // Default to feed title
  return feed.title;
}

// =============================================================================
// Main Normalization
// =============================================================================

/**
 * Convert an RSS/Atom item to a Freed FeedItem
 */
export function rssItemToFeedItem(
  item: ParsedFeedItem,
  feed: ParsedFeed
): FeedItem {
  const platform = getPlatform(feed.feedUrl);
  const contentType = getContentType(item, platform);

  // Generate global ID
  const itemId = item.guid || item.link || `${feed.feedUrl}:${item.title}`;
  const globalId = `${platform}:${itemId}`;

  // Parse publication date
  const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
  const publishedAt = isNaN(pubDate.getTime()) ? Date.now() : pubDate.getTime();

  return {
    globalId,
    platform,
    contentType,
    capturedAt: Date.now(),
    publishedAt,
    author: {
      id: feed.feedUrl,
      handle: extractHandle(feed, item),
      displayName: feed.title,
      avatarUrl: feed.image?.url,
    },
    content: {
      text: getTextContent(item),
      mediaUrls: extractMediaUrls(item),
      mediaTypes: extractMediaTypes(item),
      linkPreview: item.link
        ? {
            url: item.link,
            title: item.title,
            description: item.contentSnippet?.slice(0, 200),
          }
        : undefined,
    },
    rssSource: {
      feedUrl: feed.feedUrl,
      feedTitle: feed.title,
      siteUrl: feed.link || feed.feedUrl,
    },
    userState: {
      hidden: false,
      bookmarked: false,
    },
    topics: item.categories || [],
  };
}

/**
 * Convert all items in a feed to FeedItems
 */
export function feedToFeedItems(feed: ParsedFeed): FeedItem[] {
  return feed.items.map((item) => rssItemToFeedItem(item, feed));
}

/**
 * Convert a ParsedFeed to an RssFeed (subscription metadata)
 */
export function feedToRssFeed(
  feed: ParsedFeed,
  enabled: boolean = true
): RssFeed {
  return {
    url: feed.feedUrl,
    title: feed.title,
    siteUrl: feed.link,
    imageUrl: feed.image?.url,
    enabled,
    lastFetched: Date.now(),
  };
}

/**
 * Deduplicate feed items by globalId
 */
export function deduplicateFeedItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.globalId)) return false;
    seen.add(item.globalId);
    return true;
  });
}
