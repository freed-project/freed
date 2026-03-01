/**
 * Facebook-specific types for DOM-scraped data
 *
 * These represent the raw structured data extracted from the DOM before
 * normalization to FeedItem. Keeping raw types separate makes it easy
 * to update extraction logic independently of normalization.
 */

// =============================================================================
// Session / Auth
// =============================================================================

/**
 * Facebook session cookies required for authenticated scraping.
 * Extracted from a browser where the user is logged into facebook.com.
 */
export interface FacebookCookies {
  /** Session cookie — primary auth token */
  c_user: string;
  /** CSRF token */
  xs: string;
  /** Optional: datr device token (reduces CAPTCHA triggers) */
  datr?: string;
  /** Optional: sb browser fingerprint */
  sb?: string;
}

/**
 * Full cookie object for Playwright context.addCookies()
 */
export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

// =============================================================================
// Raw DOM-extracted post data
// =============================================================================

/**
 * Raw Facebook post as extracted from the DOM.
 * Fields are optional because selectors may not always find them.
 */
export interface RawFbPost {
  /** Facebook post ID (from data-pagelet or URL) */
  id: string | null;

  /** Canonical URL of the post */
  url: string | null;

  /** Author's display name */
  authorName: string | null;

  /** Author's profile URL (facebook.com/author) */
  authorProfileUrl: string | null;

  /** Author's avatar image URL */
  authorAvatarUrl: string | null;

  /** Main text content of the post */
  text: string | null;

  /** UNIX timestamp (seconds), from abbr[data-utime] */
  timestampSeconds: number | null;

  /** ISO timestamp string fallback, from time[datetime] */
  timestampIso: string | null;

  /** Image/video URLs attached to the post */
  mediaUrls: string[];

  /** Whether any media is a video */
  hasVideo: boolean;

  /** Engagement counts (may be null if hidden by FB) */
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;

  /** Post type: user post, group post, page post, reel, etc. */
  postType: "post" | "reel" | "story" | "shared" | "unknown";

  /** Location tag if present */
  location: string | null;

  /** Hashtags extracted from post text */
  hashtags: string[];

  /** Whether this is a repost/share of another post */
  isShare: boolean;

  /** Original poster info if this is a share */
  sharedFrom: { name: string; url: string } | null;
}

// =============================================================================
// Scraper options
// =============================================================================

export interface FacebookScrapeOptions {
  /**
   * Max number of scroll iterations to load more posts.
   * Each scroll loads ~10 posts. Default: 5 (≈50 posts).
   */
  maxScrolls?: number;

  /**
   * Max number of posts to return. Default: 50.
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
   * Whether to capture Reels (video posts). Default: true.
   */
  includeReels?: boolean;

  /**
   * Min delay between scroll steps in ms. Default: 800.
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
