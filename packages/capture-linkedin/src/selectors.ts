/**
 * LinkedIn DOM selectors and parsing helpers
 *
 * LinkedIn's feed uses data-urn attributes on post containers and
 * relatively stable BEM-style class names. These selectors target the
 * LinkedIn web feed as of early 2025. They may need updates as LinkedIn
 * evolves its front-end.
 */

export const SELECTOR_VERSION = "2025-03-10";

export const SELECTORS = {
  /** Feed container */
  feedContainer: [
    "div.scaffold-finite-scroll__content",
    "main[role='main']",
    "#main-content",
  ],

  /**
   * Post wrapper — LinkedIn stamps data-urn on the outermost container.
   * We match both activity URNs and ugcPost URNs.
   */
  postContainer: "[data-urn]",

  /** Post containers filtered to actual feed posts */
  feedPost: [
    "div.feed-shared-update-v2",
    "div[data-urn*='urn:li:activity']",
    "div[data-urn*='urn:li:ugcPost']",
    "div[data-urn*='urn:li:reshare']",
  ],

  /** Sponsored / promoted post indicators */
  sponsoredBadge: [
    ".update-components-actor__badge",
    "span[aria-label='Promoted']",
    "li-icon[type='promoted-flag-icon']",
  ],

  // ── Author ────────────────────────────────────────────────────────────────

  authorName: [
    ".update-components-actor__name > span[aria-hidden='true']",
    ".update-components-actor__name",
    ".feed-shared-actor__name",
    ".feed-shared-actor__title",
    "a.app-aware-link span[aria-hidden='true']",
  ],

  authorHeadline: [
    ".update-components-actor__description > span[aria-hidden='true']",
    ".update-components-actor__description",
    ".feed-shared-actor__description",
  ],

  authorProfileUrl: [
    ".update-components-actor__container a.app-aware-link",
    ".feed-shared-actor__container-link",
    "a[href*='/in/'][data-control-name='actor']",
  ],

  authorAvatar: [
    ".update-components-actor__avatar img",
    ".feed-shared-actor__avatar img",
    ".EntityPhoto-circle-3 img",
  ],

  // ── Post text ─────────────────────────────────────────────────────────────

  postText: [
    ".feed-shared-update-v2__description .feed-shared-text",
    ".update-components-text .feed-shared-text",
    ".feed-shared-update-v2__description",
    ".update-components-text",
    "div[dir='ltr']",
  ],

  // ── Timestamp ─────────────────────────────────────────────────────────────

  timestamp: [
    "time[datetime]",
    ".update-components-actor__sub-description span[aria-hidden='true']",
    ".feed-shared-actor__sub-description span[aria-hidden='true']",
  ],

  // ── Media ────────────────────────────────────────────────────────────────

  postImage: [
    "img.update-components-image__image",
    "img.feed-shared-image__image",
    ".feed-shared-update-v2__content img[src*='media.licdn.com']",
  ],

  postVideo: [
    "video",
    ".update-components-video",
    ".feed-shared-linkedin-video",
  ],

  // ── Shared article ────────────────────────────────────────────────────────

  articleLink: [
    ".feed-shared-article__link",
    ".update-components-article__link",
    "a.app-aware-link[href*='linkedin.com/pulse']",
    "a.app-aware-link[href*='linkedin.com/news']",
  ],

  articleTitle: [
    ".feed-shared-article__title",
    ".update-components-article__title",
    ".feed-shared-mini-update-v2__linkd-in-article-title",
  ],

  // ── Engagement ────────────────────────────────────────────────────────────

  reactionCount: [
    ".social-details-social-counts__reactions-count",
    "button[aria-label*='reaction'] span.social-details-social-counts__social-proof-text",
    ".feed-shared-social-actions__reaction-count",
    ".social-details-social-counts__count-value",
  ],

  commentCount: [
    "button[aria-label*='comment'] span.social-details-social-counts__social-proof-text",
    ".social-details-social-counts__comments a",
    ".feed-shared-social-actions__comment-count",
  ],

  repostCount: [
    "button[aria-label*='repost'] span.social-details-social-counts__social-proof-text",
    ".social-details-social-counts__reshares a",
  ],

  // ── Repost / shared content ───────────────────────────────────────────────

  repostContainer: [
    ".feed-shared-mini-update-v2",
    ".update-components-mini-update-v2",
    ".feed-shared-update-v2--is-reshare",
  ],

  repostOriginalAuthor: [
    ".feed-shared-mini-update-v2 .update-components-actor__name",
    ".update-components-mini-update-v2 .feed-shared-actor__name",
  ],
} as const;

// =============================================================================
// Parsing helpers
// =============================================================================

/**
 * Parse LinkedIn's engagement count strings.
 * Handles: "1,234", "1.2K", "4M", "345", "" → number or null.
 */
export function parseEngagementCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/,/g, "");
  if (!clean) return null;

  const lower = clean.toLowerCase();
  const numMatch = lower.match(/^([\d.]+)\s*([km]?)$/);
  if (!numMatch) return null;

  const num = parseFloat(numMatch[1]);
  if (isNaN(num)) return null;

  const suffix = numMatch[2];
  if (suffix === "k") return Math.round(num * 1000);
  if (suffix === "m") return Math.round(num * 1_000_000);
  return Math.round(num);
}

/**
 * Extract hashtags from post text.
 */
export function extractHashtags(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/#[a-zA-Z][a-zA-Z0-9_]*/g) ?? [];
  return [...new Set(matches.map((h) => h.toLowerCase()))];
}

/**
 * Parse a relative LinkedIn timestamp to an approximate absolute timestamp.
 * LinkedIn displays "2h", "1d", "3w", "2mo" relative strings.
 * Returns null if the string cannot be parsed.
 */
export function parseRelativeTimestamp(relative: string | null): number | null {
  if (!relative) return null;
  const lower = relative.trim().toLowerCase();
  const now = Date.now();

  // Match patterns like "2h", "1d", "3w", "2mo", "1yr"
  const match = lower.match(/^(\d+)\s*(s|m|h|d|w|mo|yr)$/);
  if (!match) return null;

  const n = parseInt(match[1], 10);
  const unit = match[2];

  const MS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    mo: 30 * 24 * 60 * 60 * 1000,
    yr: 365 * 24 * 60 * 60 * 1000,
  } as Record<string, number>;

  const ms = MS[unit];
  if (!ms) return null;
  return now - n * ms;
}

/**
 * Extract the URN from a data-urn attribute.
 * LinkedIn URNs look like: "urn:li:activity:1234567890"
 */
export function extractUrn(urnAttr: string | null): string | null {
  if (!urnAttr) return null;
  if (urnAttr.startsWith("urn:li:")) return urnAttr;
  return null;
}

/**
 * Derive a profile handle from a LinkedIn profile URL.
 * e.g. "https://www.linkedin.com/in/john-doe-123abc/" → "john-doe-123abc"
 * e.g. "https://www.linkedin.com/company/some-co/" → "some-co"
 */
export function extractProfileHandle(profileUrl: string | null): string {
  if (!profileUrl) return "unknown";
  try {
    const url = new URL(profileUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    // /in/<handle> or /company/<handle>
    if (parts.length >= 2 && (parts[0] === "in" || parts[0] === "company")) {
      return parts[1];
    }
    if (parts.length >= 1) return parts[parts.length - 1];
  } catch {
    // ignore malformed URLs
  }
  return "unknown";
}
