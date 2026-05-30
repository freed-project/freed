/**
 * RSS/Atom item normalization to FeedItem
 */

import {
  canonicalEssayProviderProfileUrl,
  canonicalEssayProviderUrl,
  essayProviderGlobalId,
  type FeedItem,
  type Platform,
  type ContentType,
  type MediaType,
  type RssFeed,
} from "@freed/shared";
import type { ParsedFeed, ParsedFeedItem } from "./types.js";
import { detectPlatform } from "./discovery.js";

// =============================================================================
// Platform Detection
// =============================================================================

/**
 * Detect the platform from feed metadata and its URL.
 */
function getPlatform(feed: ParsedFeed): Platform {
  const generator = feed.generator?.trim().toLowerCase() ?? "";
  const platform = /^medium\b/.test(generator)
    ? "medium"
    : /^substack\b/.test(generator)
      ? "substack"
      : detectPlatform(feed.feedUrl);

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
    case "medium":
      return "medium";
    case "substack":
      return "substack";
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

  // Publication feeds are the body-bearing path for authenticated essay sources.
  if (platform === "substack" || platform === "medium") return "article";

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
function extractMedia(item: ParsedFeedItem): {
  mediaUrls: string[];
  mediaTypes: MediaType[];
} {
  const mediaUrls: string[] = [];
  const mediaTypes: MediaType[] = [];
  const indexByUrl = new Map<string, number>();

  const addMedia = (url: string | undefined, type: MediaType): void => {
    const normalized = url?.trim();
    if (!normalized) return;
    const existingIndex = indexByUrl.get(normalized);
    if (existingIndex !== undefined) {
      if (type === "video" && mediaTypes[existingIndex] !== "video") {
        mediaTypes[existingIndex] = "video";
      }
      return;
    }
    indexByUrl.set(normalized, mediaUrls.length);
    mediaUrls.push(normalized);
    mediaTypes.push(type);
  };

  // Check enclosure
  if (item.enclosure?.url) {
    const enclosureType = item.enclosure.type?.toLowerCase() ?? "";
    addMedia(
      item.enclosure.url,
      enclosureType.includes("video") || enclosureType.includes("audio")
        ? "video"
        : "image",
    );
  }

  // Check media:content
  if (item["media:content"]) {
    const mediaContent = Array.isArray(item["media:content"])
      ? item["media:content"]
      : [item["media:content"]];

    for (const media of mediaContent) {
      if (media.$?.url) {
        const type = (media.$.type ?? media.$.medium ?? "").toLowerCase();
        addMedia(
          media.$.url,
          type.includes("video") || type.includes("audio") ? "video" : "image",
        );
      }
    }
  }

  // Check media:thumbnail
  if (item["media:thumbnail"]?.$?.url) {
    addMedia(item["media:thumbnail"].$.url, "image");
  }

  // Extract images from content HTML
  const content = item.content || "";
  const imgMatches = content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
  for (const match of imgMatches) {
    addMedia(match[1], "image");
  }

  return { mediaUrls, mediaTypes };
}

// =============================================================================
// Text Processing
// =============================================================================

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|pre|section|article)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Get clean text content from item
 */
function getTextContent(item: ParsedFeedItem, platform: Platform): string | undefined {
  // For essay providers, prefer the body carried by RSS over a shorter excerpt.
  if ((platform === "substack" || platform === "medium") && item.content) {
    return stripHtml(item.content);
  }

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

function globalIdForItem(
  item: ParsedFeedItem,
  feed: ParsedFeed,
  platform: Platform,
): string {
  if (platform === "substack" || platform === "medium") {
    const articleId =
      essayProviderGlobalId(platform, item.link) ??
      essayProviderGlobalId(platform, item.guid);
    if (articleId) return articleId;
  }

  const itemId = item.guid || item.link || `${feed.feedUrl}:${item.title}`;
  return `${platform}:${itemId}`;
}

/**
 * Extract author handle from feed/item
 */
function extractHandle(feed: ParsedFeed, item: ParsedFeedItem): string {
  const url = feed.feedUrl;

  // Provider handles must match the authenticated roster identity shape.
  const mediumMatch =
    url.match(/medium\.com\/feed\/@([^/]+)/) ??
    item.link?.match(/medium\.com\/@([^/]+)/);
  if (mediumMatch) return decodeURIComponent(mediumMatch[1]).toLowerCase();

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith(".substack.com")) {
      const publication = hostname.slice(0, -".substack.com".length).split(".").pop();
      if (publication) return publication;
    }
  } catch {
    // Continue through the generic feed fallbacks.
  }

  if (item.creator) return item.creator;

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

function extractAuthorId(
  feed: ParsedFeed,
  item: ParsedFeedItem,
  platform: Platform,
): string {
  if (platform === "substack") {
    for (const value of [feed.feedUrl, feed.link, item.link]) {
      try {
        const url = new URL(value ?? "");
        if (url.hostname === "substack.com" || url.hostname.endsWith(".substack.com")) {
          return `${url.origin}/`;
        }
      } catch {
        // Continue through the remaining publication URLs.
      }
    }
    const customPublicationUrl = canonicalEssayProviderUrl(feed.link);
    if (customPublicationUrl) {
      try {
        return `${new URL(customPublicationUrl).origin}/`;
      } catch {
        // Fall back to the feed identity below.
      }
    }
  }

  if (platform === "medium") {
    const mediumMatch =
      feed.feedUrl.match(/medium\.com\/feed\/@([^/]+)/) ??
      item.link?.match(/medium\.com\/@([^/]+)/);
    if (mediumMatch) {
      return canonicalEssayProviderProfileUrl(
        "medium",
        `https://medium.com/@${decodeURIComponent(mediumMatch[1])}`,
      ) ?? feed.feedUrl;
    }

    const publicationMatch = feed.feedUrl.match(
      /^https?:\/\/(?:www\.)?medium\.com\/feed\/([^/?#]+)\/?(?:[?#].*)?$/i,
    );
    if (publicationMatch && !publicationMatch[1].startsWith("@")) {
      return `https://medium.com/${decodeURIComponent(publicationMatch[1]).toLowerCase()}`;
    }

    const publicationUrl = canonicalEssayProviderUrl(feed.link);
    if (publicationUrl) return publicationUrl;

    try {
      const storyUrl = new URL(item.link ?? "");
      if (storyUrl.hostname !== "medium.com" && !storyUrl.hostname.endsWith(".medium.com")) {
        return `${storyUrl.origin}/`;
      }
    } catch {
      // Fall back to the feed identity below.
    }
  }

  return feed.feedUrl;
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
  const platform = getPlatform(feed);
  const contentType = getContentType(item, platform);

  const globalId = globalIdForItem(item, feed, platform);

  // Parse publication date
  const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
  const publishedAt = isNaN(pubDate.getTime()) ? Date.now() : pubDate.getTime();
  const textContent = getTextContent(item, platform);
  const authorHandle = extractHandle(feed, item);
  const media = extractMedia(item);

  return {
    globalId,
    platform,
    contentType,
    capturedAt: Date.now(),
    publishedAt,
    author: {
      id: extractAuthorId(feed, item, platform),
      handle: authorHandle,
      displayName: feed.title,
      ...(feed.image?.url ? { avatarUrl: feed.image.url } : {}),
    },
    content: {
      ...(textContent !== undefined ? { text: textContent } : {}),
      mediaUrls: media.mediaUrls,
      mediaTypes: media.mediaTypes,
      ...(item.link
        ? {
            linkPreview: {
              url: item.link,
              ...(item.title ? { title: item.title } : {}),
              ...(item.contentSnippet
                ? { description: item.contentSnippet.slice(0, 200) }
                : {}),
            },
          }
        : {}),
    },
    rssSource: {
      feedUrl: feed.feedUrl,
      feedTitle: feed.title,
      siteUrl: feed.link || feed.feedUrl,
    },
    ...(item.link ? { sourceUrl: item.link } : {}),
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
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
    trackUnread: false,
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
