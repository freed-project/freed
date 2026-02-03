/**
 * RSS/Atom feed URL discovery
 *
 * Finds feed URLs for websites, including platform-specific patterns.
 */

import type { DiscoveredFeed, PlatformPattern } from "./types.js";

// =============================================================================
// Platform-Specific Patterns
// =============================================================================

/**
 * Known platform patterns for feed URL construction
 */
const PLATFORM_PATTERNS: PlatformPattern[] = [
  // Medium
  {
    match: /^https?:\/\/(www\.)?medium\.com\/@([^\/]+)/,
    transform: (url, match) => `https://medium.com/feed/@${match[2]}`,
  },
  {
    match: /^https?:\/\/([^.]+)\.medium\.com/,
    transform: (url, match) => `https://${match[1]}.medium.com/feed`,
  },

  // Substack
  {
    match: /^https?:\/\/([^.]+)\.substack\.com/,
    transform: (url, match) => `https://${match[1]}.substack.com/feed`,
  },

  // YouTube - Channel
  {
    match: /^https?:\/\/(www\.)?youtube\.com\/channel\/([^\/]+)/,
    transform: (url, match) =>
      `https://www.youtube.com/feeds/videos.xml?channel_id=${match[2]}`,
  },
  // YouTube - User
  {
    match: /^https?:\/\/(www\.)?youtube\.com\/user\/([^\/]+)/,
    transform: (url, match) =>
      `https://www.youtube.com/feeds/videos.xml?user=${match[2]}`,
  },
  // YouTube - Custom URL (@handle)
  {
    match: /^https?:\/\/(www\.)?youtube\.com\/@([^\/]+)/,
    transform: (url, match) =>
      `https://www.youtube.com/feeds/videos.xml?channel_id=@${match[2]}`,
  },

  // Reddit - Subreddit
  {
    match: /^https?:\/\/(www\.)?reddit\.com\/r\/([^\/]+)/,
    transform: (url, match) => `https://www.reddit.com/r/${match[2]}/.rss`,
  },
  // Reddit - User
  {
    match: /^https?:\/\/(www\.)?reddit\.com\/u(ser)?\/([^\/]+)/,
    transform: (url, match) => `https://www.reddit.com/user/${match[3]}/.rss`,
  },

  // GitHub - Releases
  {
    match: /^https?:\/\/(www\.)?github\.com\/([^\/]+)\/([^\/]+)(\/releases)?$/,
    transform: (url, match) =>
      `https://github.com/${match[2]}/${match[3]}/releases.atom`,
  },
  // GitHub - Commits
  {
    match: /^https?:\/\/(www\.)?github\.com\/([^\/]+)\/([^\/]+)\/commits/,
    transform: (url, match) =>
      `https://github.com/${match[2]}/${match[3]}/commits.atom`,
  },

  // Mastodon
  {
    match: /^https?:\/\/([^\/]+)\/@([^\/]+)$/,
    transform: (url, match) => `https://${match[1]}/@${match[2]}.rss`,
  },

  // Ghost blogs
  {
    match: /^https?:\/\/([^\/]+)\/$/,
    transform: (url) => `${url}rss/`,
  },

  // WordPress
  {
    match: /^https?:\/\/([^\/]+)\/$/,
    transform: (url) => `${url}feed/`,
  },

  // Blogger
  {
    match: /^https?:\/\/([^.]+)\.blogspot\.com/,
    transform: (url, match) =>
      `https://${match[1]}.blogspot.com/feeds/posts/default`,
  },

  // Tumblr
  {
    match: /^https?:\/\/([^.]+)\.tumblr\.com/,
    transform: (url, match) => `https://${match[1]}.tumblr.com/rss`,
  },
];

/**
 * Common feed paths to try
 */
const COMMON_FEED_PATHS = [
  "/feed",
  "/rss",
  "/atom.xml",
  "/feed.xml",
  "/rss.xml",
  "/index.xml",
  "/feed/rss",
  "/feed/atom",
  "/rss/feed",
  "/.rss",
  "/blog/feed",
  "/blog/rss",
  "/feeds/posts/default",
];

// =============================================================================
// Feed Discovery
// =============================================================================

/**
 * Discover RSS/Atom feed URL for a website
 *
 * @param url - The website URL
 * @returns Discovered feed URL or null if not found
 */
export async function discoverFeed(url: string): Promise<string | null> {
  // Normalize URL
  const normalizedUrl = url.endsWith("/") ? url : url + "/";

  // Try platform-specific patterns first
  for (const pattern of PLATFORM_PATTERNS) {
    const match = url.match(pattern.match);
    if (match) {
      const feedUrl = pattern.transform(url, match);
      if (await isValidFeed(feedUrl)) {
        return feedUrl;
      }
    }
  }

  // Try to find feed link in HTML
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Freed/1.0 Feed Discovery",
      },
    });

    if (response.ok) {
      const html = await response.text();
      const feedFromHtml = extractFeedFromHtml(html, url);
      if (feedFromHtml) {
        return feedFromHtml;
      }
    }
  } catch {
    // Continue to try common paths
  }

  // Try common feed paths
  const baseUrl = new URL(url).origin;
  for (const path of COMMON_FEED_PATHS) {
    const feedUrl = baseUrl + path;
    if (await isValidFeed(feedUrl)) {
      return feedUrl;
    }
  }

  return null;
}

/**
 * Discover all feed URLs for a website
 */
export async function discoverAllFeeds(url: string): Promise<DiscoveredFeed[]> {
  const feeds: DiscoveredFeed[] = [];
  const seenUrls = new Set<string>();

  // Try to find feeds in HTML
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Freed/1.0 Feed Discovery" },
    });

    if (response.ok) {
      const html = await response.text();
      const htmlFeeds = extractAllFeedsFromHtml(html, url);
      for (const feed of htmlFeeds) {
        if (!seenUrls.has(feed.url)) {
          seenUrls.add(feed.url);
          feeds.push(feed);
        }
      }
    }
  } catch {
    // Continue
  }

  // Try platform patterns
  for (const pattern of PLATFORM_PATTERNS) {
    const match = url.match(pattern.match);
    if (match) {
      const feedUrl = pattern.transform(url, match);
      if (!seenUrls.has(feedUrl) && (await isValidFeed(feedUrl))) {
        seenUrls.add(feedUrl);
        feeds.push({ url: feedUrl, type: "rss" });
      }
    }
  }

  return feeds;
}

// =============================================================================
// HTML Parsing
// =============================================================================

/**
 * Extract feed URL from HTML link tags
 */
function extractFeedFromHtml(html: string, baseUrl: string): string | null {
  // Match <link> tags with RSS/Atom types
  const linkPattern =
    /<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]*>/gi;
  const hrefPattern = /href=["']([^"']+)["']/i;

  const matches = html.matchAll(linkPattern);
  for (const match of matches) {
    const hrefMatch = match[0].match(hrefPattern);
    if (hrefMatch) {
      const href = hrefMatch[1];
      // Resolve relative URLs
      try {
        return new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Extract all feed URLs from HTML
 */
function extractAllFeedsFromHtml(
  html: string,
  baseUrl: string
): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];

  // Match <link> tags with feed types
  const linkPattern =
    /<link[^>]+type=["'](application\/(rss|atom)\+xml|application\/feed\+json)["'][^>]*>/gi;
  const hrefPattern = /href=["']([^"']+)["']/i;
  const titlePattern = /title=["']([^"']+)["']/i;

  const matches = html.matchAll(linkPattern);
  for (const match of matches) {
    const hrefMatch = match[0].match(hrefPattern);
    const titleMatch = match[0].match(titlePattern);

    if (hrefMatch) {
      try {
        const url = new URL(hrefMatch[1], baseUrl).href;
        const type = match[1].includes("atom")
          ? "atom"
          : match[1].includes("json")
          ? "json"
          : "rss";
        feeds.push({
          url,
          title: titleMatch?.[1],
          type,
        });
      } catch {
        continue;
      }
    }
  }

  return feeds;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Check if a URL returns a valid feed
 */
async function isValidFeed(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Freed/1.0 Feed Discovery" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") || "";
    return (
      contentType.includes("xml") ||
      contentType.includes("rss") ||
      contentType.includes("atom") ||
      contentType.includes("json")
    );
  } catch {
    return false;
  }
}

/**
 * Resolve a URL that might be relative
 */
export function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

// =============================================================================
// Platform Detection
// =============================================================================

/**
 * Detect the platform from a feed or site URL
 */
export function detectPlatform(url: string): string {
  if (url.includes("youtube.com")) return "youtube";
  if (url.includes("reddit.com")) return "reddit";
  if (url.includes("github.com")) return "github";
  if (url.includes("medium.com")) return "rss"; // Medium uses standard RSS
  if (url.includes("substack.com")) return "rss";
  if (url.includes("tumblr.com")) return "rss";
  if (url.includes("blogspot.com")) return "rss";
  if (url.includes("mastodon") || url.match(/@[^\/]+\.rss$/)) return "mastodon";
  return "rss";
}
