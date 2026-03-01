/**
 * Instagram-specific types for DOM-scraped data
 *
 * Raw structured data extracted from the Instagram DOM, before normalization
 * to FeedItem.
 */

// =============================================================================
// Session / Auth
// =============================================================================

/**
 * Instagram session cookies required for authenticated scraping.
 * Extracted from a browser where the user is logged into instagram.com.
 */
export interface InstagramCookies {
  /** Primary session ID */
  sessionid: string;
  /** CSRF token */
  csrftoken: string;
  /** User ID */
  ds_user_id: string;
  /** Optional: device ID cookie */
  ig_did?: string;
  /** Optional: direct badge count (commonly present) */
  ig_direct_region_hint?: string;
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
 * Raw Instagram post as extracted from the DOM.
 */
export interface RawIgPost {
  /** Instagram post shortcode (from URL: instagram.com/p/SHORTCODE) */
  shortcode: string | null;

  /** Canonical post URL */
  url: string | null;

  /** Author's username (handle without @) */
  authorHandle: string | null;

  /** Author's display name (from aria-label or nearby text) */
  authorDisplayName: string | null;

  /** Author's avatar URL */
  authorAvatarUrl: string | null;

  /** Author's profile URL */
  authorProfileUrl: string | null;

  /** Post caption text */
  caption: string | null;

  /** ISO timestamp from time[datetime] */
  timestampIso: string | null;

  /** Image/video URLs */
  mediaUrls: string[];

  /** Whether this is a video/Reel */
  isVideo: boolean;

  /** Whether this is a carousel (multiple images/videos) */
  isCarousel: boolean;

  /** Like count (may be null — Instagram hides likes for many accounts) */
  likeCount: number | null;

  /** Comment count */
  commentCount: number | null;

  /** Hashtags extracted from caption */
  hashtags: string[];

  /** Tagged location (if present) */
  location: string | null;

  /** Location URL (instagram.com/explore/locations/...) */
  locationUrl: string | null;

  /** Post type derived from content */
  postType: "photo" | "video" | "reel" | "carousel" | "story" | "unknown";
}

// =============================================================================
// Scraper options
// =============================================================================

export interface InstagramScrapeOptions {
  /**
   * Max scroll iterations to load more posts. Default: 5 (≈15 posts).
   * Instagram loads ~3 posts per scroll.
   */
  maxScrolls?: number;

  /**
   * Max posts to return. Default: 30.
   * Instagram's anti-scraping is more aggressive than Facebook's.
   */
  maxPosts?: number;

  /**
   * User-Agent. Defaults to a realistic mobile-desktop UA.
   */
  userAgent?: string;

  /**
   * Viewport. Default: 1280x900.
   */
  viewport?: { width: number; height: number };

  /**
   * Min delay between scroll steps in ms. Default: 1200.
   * Instagram rate-limits more aggressively, so longer delays.
   */
  scrollDelayMs?: number;
}

// =============================================================================
// Rate limiting
// =============================================================================

export interface RateLimitState {
  lastScrapeAt: number;
  consecutiveErrors: number;
  cooldownUntil: number;
}
