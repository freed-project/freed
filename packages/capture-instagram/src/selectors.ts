/**
 * Instagram DOM selectors
 *
 * Instagram uses a mix of semantic HTML, ARIA attributes, and
 * semi-stable class names. Prefer semantic selectors where possible.
 * Class-name based selectors are annotated with their visual meaning.
 *
 * Last verified: 2026-02-17
 */

export const SELECTOR_VERSION = "2026-02-17";

export const SELECTORS = {
  // ==========================================================================
  // Feed container
  // ==========================================================================

  /** Main content area */
  main: 'main[role="main"]',

  /** Individual post card. Instagram wraps each post in an <article>. */
  post: "article",

  // ==========================================================================
  // Author info (within a post)
  // ==========================================================================

  /** Author username link in post header */
  authorLink: 'header a[role="link"]',

  /** Author avatar image */
  authorAvatar: "header img",

  // ==========================================================================
  // Post content
  // ==========================================================================

  /** Caption block — h1 in the main post or div._a9zr */
  caption: "._a9zr, h1",

  /** Caption span inside the caption block */
  captionText: "._a9zs span, h1 span",

  /** "more" button to expand truncated caption */
  moreButton: 'div[role="button"]:has-text("more"), button:has-text("more")',

  // ==========================================================================
  // Timestamps
  // ==========================================================================

  /** time[datetime] — ISO timestamp */
  timestamp: "time[datetime]",

  // ==========================================================================
  // Post URL
  // ==========================================================================

  /** Link to the individual post: /p/SHORTCODE */
  postLink: 'a[href*="/p/"]',

  /** Reel link: /reel/SHORTCODE */
  reelLink: 'a[href*="/reel/"]',

  // ==========================================================================
  // Media
  // ==========================================================================

  /** Images in the post media area */
  postImage: 'img[srcset], img[src*="cdninstagram"], img[src*="instagram.com"]',

  /** Video element */
  video: "video",

  /** Carousel: next button indicates multiple slides */
  carouselNext: 'button[aria-label="Next"]',

  // ==========================================================================
  // Engagement
  // ==========================================================================

  /** Like count button/span */
  likeCount:
    'button[data-visualcompletion="ignore"], section > div > span > span',

  /** Comment count (in post footer) */
  commentLink: 'a[href*="/comments"]',

  // ==========================================================================
  // Location
  // ==========================================================================

  /** Location tag link */
  location: 'a[href*="/explore/locations/"]',
} as const;

/**
 * Extract the post shortcode from an Instagram post URL.
 * e.g. "https://www.instagram.com/p/ABC123xyz/" → "ABC123xyz"
 * e.g. "https://www.instagram.com/reel/DEF456/" → "DEF456"
 */
export function extractShortcode(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

/**
 * Extract hashtags from a caption string.
 */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#(\w+)/g) || [];
  return matches.map((h) => h.slice(1).toLowerCase());
}

/**
 * Parse Instagram engagement count text.
 * e.g. "1,234 likes" → 1234, "10K likes" → 10000
 */
export function parseEngagementCount(text: string): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.,KMkm]/g, "").replace(",", "");
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  if (/[Kk]/.test(text)) return Math.round(num * 1000);
  if (/[Mm]/.test(text)) return Math.round(num * 1_000_000);
  return Math.round(num);
}
