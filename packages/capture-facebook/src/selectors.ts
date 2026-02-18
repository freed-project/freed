/**
 * Facebook DOM selectors
 *
 * Facebook uses generated obfuscated class names that change frequently.
 * We rely on semantic HTML attributes (role, data-*, aria-*) which are more
 * stable. Still: these WILL break. Update this file when scraping stops working.
 *
 * Last verified: 2026-02-17
 */

export const SELECTOR_VERSION = "2026-02-17";

export const SELECTORS = {
  // ==========================================================================
  // Feed container
  // ==========================================================================

  /** Main feed container. Stable — uses ARIA role. */
  feed: 'div[role="feed"]',

  /** Individual feed unit (one post + its reactions). */
  feedUnit: 'div[data-pagelet^="FeedUnit"]',

  /** Fallback: posts identified by aria-posinset attribute */
  feedUnitFallback: "div[aria-posinset]",

  // ==========================================================================
  // Author info (within a post)
  // ==========================================================================

  /** The "actor" profile link — first <a> in post header with a strong child */
  authorLink: "h4 a",

  /** Author name text */
  authorName: "h4 a strong",

  /** Fallback: aria-label on the profile link */
  authorLinkAria: 'a[aria-label][role="link"]',

  /** Avatar image */
  authorAvatar: 'image[xlink\\:href], img[referrerpolicy="origin-when-cross-origin"]',

  // ==========================================================================
  // Post content
  // ==========================================================================

  /** Main text content. Facebook uses data-* attributes here. */
  postText: '[data-ad-comet-preview="message"], [data-ad-preview="message"]',

  /** Expanded text (for "see more" truncated posts) */
  postTextExpanded: '[data-ad-comet-preview="message"] div, [data-ad-preview="message"] div',

  /** "See more" button to expand truncated posts */
  seeMoreButton: '[role="button"][tabindex="0"]:has-text("See more")',

  // ==========================================================================
  // Timestamps
  // ==========================================================================

  /** Primary: abbr[data-utime] contains UNIX timestamp in data-utime */
  timestampAbbr: "abbr[data-utime]",

  /** Fallback: time[datetime] in post header */
  timestampTime: "time[datetime]",

  // ==========================================================================
  // Post URL
  // ==========================================================================

  /** Link to the individual post (contains "story_fbid" or "/posts/") */
  postLink: 'a[href*="story_fbid"], a[href*="/posts/"], a[href*="/permalink/"]',

  // ==========================================================================
  // Media
  // ==========================================================================

  /** Images served from Facebook CDN */
  cdnImage: 'img[src*="scontent"], img[src*="fbcdn"]',

  /** Reel / video element */
  videoPost: 'video, div[data-pagelet*="Reel"]',

  // ==========================================================================
  // Engagement (reaction/comment/share counts)
  // ==========================================================================

  /** Reaction count span (often contains "X people" or "X reactions") */
  reactionCount: 'span[aria-label*="reaction"], span[aria-label*=" people"]',

  /** Comment count */
  commentCount: 'span[aria-label*="comment"]',

  /** Share count */
  shareCount: 'span[aria-label*="share"]',

  // ==========================================================================
  // Location
  // ==========================================================================

  /** Check-in / location link */
  location: 'a[href*="/places/"], a[href*="/?action=view_location"]',

  // ==========================================================================
  // Shared / repost
  // ==========================================================================

  /** Container for a post that was shared from another account */
  sharedPost: "div.x1yztbdb, div.x78zum5.xdt5ytf", // obfuscated but common pattern

  /** The original author link within a shared post */
  sharedFromLink: 'span[dir="auto"] a[href*="facebook.com"]',
} as const;

/**
 * Attempt to extract a Facebook post ID from the post URL or data-pagelet.
 */
export function extractPostId(url: string | null, pagelet: string | null): string | null {
  if (url) {
    // story_fbid=12345&id=67890
    const storyMatch = url.match(/story_fbid=(\d+)/);
    if (storyMatch) return storyMatch[1];

    // /posts/12345
    const postsMatch = url.match(/\/posts\/(\d+)/);
    if (postsMatch) return postsMatch[1];

    // /permalink/12345
    const permalinkMatch = url.match(/\/permalink\/(\d+)/);
    if (permalinkMatch) return permalinkMatch[1];
  }

  if (pagelet) {
    // FeedUnit_12345_67890
    const pageletMatch = pagelet.match(/FeedUnit[_:]?(\d+)/);
    if (pageletMatch) return pageletMatch[1];
  }

  return null;
}

/**
 * Extract hashtags from post text.
 */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#(\w+)/g) || [];
  return matches.map((h) => h.slice(1).toLowerCase());
}

/**
 * Parse a Facebook engagement count string like "1.2K", "345", "4M" to a number.
 */
export function parseEngagementCount(text: string): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.KMkm]/g, "").trim();
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  if (/[Kk]/.test(cleaned)) return Math.round(num * 1000);
  if (/[Mm]/.test(cleaned)) return Math.round(num * 1_000_000);
  return Math.round(num);
}
