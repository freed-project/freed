/**
 * mbasic.facebook.com HTML parser
 *
 * Parses the static HTML served by Facebook's basic mobile site into
 * RawFbPost objects. mbasic renders without JavaScript, making it
 * fetchable via plain HTTP with session cookies.
 *
 * The DOM structure is much simpler than the full site. Posts live inside
 * a #structured_composer_async_container or in <div> elements within
 * the main content area.
 */

import type { RawFbPost } from "./types.js";
import { extractPostId, extractHashtags, parseEngagementCount } from "./selectors.js";

/**
 * Parse mbasic.facebook.com HTML into raw post data.
 *
 * Accepts the full HTML string from a GET request to mbasic.facebook.com
 * and returns an array of RawFbPost objects suitable for normalization
 * via fbPostsToFeedItems().
 */
export function parseMbasicFeed(html: string): RawFbPost[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // mbasic wraps each story in an article-like container. Several selector
  // strategies are tried in order of reliability.
  let postElements = Array.from(
    doc.querySelectorAll('div[data-ft], article, div[role="article"]')
  ) as HTMLElement[];

  // Fallback: the feed section often lives under #recent or #structured_composer_async_container
  if (postElements.length === 0) {
    const feedSection =
      doc.querySelector("#recent") ??
      doc.querySelector("#structured_composer_async_container") ??
      doc.querySelector("#root");
    if (feedSection) {
      // Each story is typically a direct child div with a nested <header> or <h3>
      postElements = Array.from(feedSection.querySelectorAll(":scope > div")).filter(
        (el) => el.querySelector("h3, header, a[href*='/story.php']") !== null
      ) as HTMLElement[];
    }
  }

  return postElements.map((el) => extractPost(el)).filter(isUsablePost);
}

function extractPost(el: HTMLElement): RawFbPost {
  // --- Author ---
  const headerLink = el.querySelector("h3 a, header a") as HTMLAnchorElement | null;
  const authorName = headerLink?.textContent?.trim() ?? null;
  const authorProfileUrl = headerLink ? resolveUrl(headerLink.getAttribute("href")) : null;

  // mbasic doesn't serve avatar images in the feed

  // --- Post URL / ID ---
  const storyLink = el.querySelector(
    'a[href*="/story.php"], a[href*="/permalink/"], a[href*="/posts/"]'
  ) as HTMLAnchorElement | null;
  const url = storyLink ? resolveUrl(storyLink.getAttribute("href")) : null;
  const dataFt = el.getAttribute("data-ft");
  let dataFtId: string | null = null;
  if (dataFt) {
    try {
      const parsed = JSON.parse(dataFt);
      dataFtId = parsed.mf_story_key ?? parsed.top_level_post_id ?? null;
    } catch { /* ignore malformed data-ft */ }
  }
  const id = extractPostId(url, null) ?? dataFtId;

  // --- Timestamp ---
  const abbrEl = el.querySelector("abbr") as HTMLElement | null;
  const timestampText = abbrEl?.textContent?.trim() ?? null;
  const timestampSeconds = abbrEl?.getAttribute("data-utime")
    ? parseInt(abbrEl.getAttribute("data-utime")!, 10)
    : null;

  // --- Text content ---
  // mbasic puts the post body in a <p> or <div> after the header
  const paragraphs = Array.from(el.querySelectorAll("p")) as HTMLElement[];
  const text = paragraphs
    .map((p) => p.textContent?.trim())
    .filter(Boolean)
    .join("\n") || null;

  // --- Media ---
  const imgEls = Array.from(el.querySelectorAll("img")) as HTMLImageElement[];
  const mediaUrls = imgEls
    .map((img) => img.src)
    .filter((src) =>
      src &&
      (src.includes("scontent") || src.includes("fbcdn")) &&
      !src.includes("emoji") &&
      !src.includes("1x1")
    );
  const hasVideo = el.querySelector("video, a[href*='/video/']") !== null;

  // --- Engagement ---
  // mbasic shows engagement as text like "5 Likes" or "2 Comments"
  const allText = el.textContent ?? "";
  const likeMatch = allText.match(/(\d[\d,.KkMm]*)\s*(?:Like|React)/i);
  const commentMatch = allText.match(/(\d[\d,.KkMm]*)\s*Comment/i);
  const shareMatch = allText.match(/(\d[\d,.KkMm]*)\s*Share/i);

  const likeCount = likeMatch ? parseEngagementCount(likeMatch[1]) : null;
  const commentCount = commentMatch ? parseEngagementCount(commentMatch[1]) : null;
  const shareCount = shareMatch ? parseEngagementCount(shareMatch[1]) : null;

  // --- Location ---
  const locationEl = el.querySelector(
    'a[href*="/places/"], a[href*="checkin"]'
  ) as HTMLAnchorElement | null;
  const location = locationEl?.textContent?.trim() ?? null;

  const hashtags = text ? extractHashtags(text) : [];

  return {
    id,
    url,
    authorName,
    authorProfileUrl,
    authorAvatarUrl: null,
    text,
    timestampSeconds,
    timestampIso: timestampText,
    mediaUrls,
    hasVideo,
    likeCount,
    commentCount,
    shareCount,
    postType: hasVideo ? "reel" : "post",
    location,
    hashtags,
    isShare: false,
    sharedFrom: null,
  };
}

function isUsablePost(post: RawFbPost): boolean {
  return (post.id !== null || post.url !== null) && (post.text !== null || post.mediaUrls.length > 0);
}

function resolveUrl(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  return `https://mbasic.facebook.com${href.startsWith("/") ? "" : "/"}${href}`;
}
