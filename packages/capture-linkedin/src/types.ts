/**
 * LinkedIn-specific types for DOM-scraped data
 *
 * These represent the raw structured data extracted from the DOM before
 * normalization to FeedItem. Keeping raw types separate makes it easy
 * to update extraction logic independently of normalization.
 */

// =============================================================================
// Raw DOM-extracted post data
// =============================================================================

/**
 * Raw LinkedIn post as extracted from the DOM.
 * Fields are optional because selectors may not always find them.
 */
export interface RawLiPost {
  /** LinkedIn URN (e.g. urn:li:activity:1234567890 or urn:li:ugcPost:123) */
  urn: string | null;

  /** Canonical URL of the post */
  url: string | null;

  /** Author's display name */
  authorName: string | null;

  /** Author's headline / job title */
  authorHeadline: string | null;

  /** Author's profile URL (linkedin.com/in/...) */
  authorProfileUrl: string | null;

  /** Author's avatar image URL */
  authorAvatarUrl: string | null;

  /** Main text content of the post */
  text: string | null;

  /** ISO timestamp string */
  timestampIso: string | null;

  /** Relative timestamp as shown on the page ("2h", "1d", "3w") */
  timestampRelative: string | null;

  /** Image/video URLs attached to the post */
  mediaUrls: string[];

  /** Whether any media is a video */
  hasVideo: boolean;

  /** Shared article URL (if this post links to an external article) */
  articleUrl: string | null;

  /** Shared article title */
  articleTitle: string | null;

  /**
   * Reaction count (LinkedIn combines all reaction types into a single count).
   * May be null if the post has no reactions or the count is hidden.
   */
  reactionCount: number | null;

  /** Comment count */
  commentCount: number | null;

  /** Repost / reshare count */
  repostCount: number | null;

  /** Hashtags extracted from post text */
  hashtags: string[];

  /** Whether this is a reshare of another post */
  isRepost: boolean;

  /** Original poster info if this is a reshare */
  repostedFrom: { name: string; url: string } | null;

  /** Post type classification */
  postType: "post" | "article" | "shared" | "poll" | "event" | "unknown";
}

// =============================================================================
// Scraper options
// =============================================================================

export interface LinkedInScrapeOptions {
  /**
   * Max number of scroll iterations to load more posts.
   * Each scroll loads ~5-8 posts. Default: 8.
   */
  maxScrolls?: number;

  /**
   * Max number of posts to return. Default: 40.
   */
  maxPosts?: number;

  /**
   * User-Agent to use. Defaults to a realistic desktop UA.
   */
  userAgent?: string;

  /**
   * Viewport size. Default: 1280x900 (desktop).
   */
  viewport?: { width: number; height: number };

  /**
   * Min delay between scroll steps in ms. Default: 1200.
   */
  scrollDelayMs?: number;
}

// =============================================================================
// Rate limiting
// =============================================================================

export interface RateLimitState {
  /** Timestamp of last successful scrape */
  lastScrapeAt: number;
  /** Number of consecutive errors (triggers cooldown) */
  consecutiveErrors: number;
  /** Cooldown until timestamp (don't scrape before this) */
  cooldownUntil: number;
}
