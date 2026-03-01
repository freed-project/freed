/**
 * Facebook feed scraper
 *
 * Extracts raw post data from the Facebook DOM. This is the most fragile layer —
 * Facebook changes their DOM structure frequently. All selector logic is in
 * selectors.ts to make updates easy.
 */

import type { Page } from "playwright-core";
import type { RawFbPost, FacebookScrapeOptions } from "./types.js";
import {
  SELECTORS,
  extractPostId,
  extractHashtags,
  parseEngagementCount,
} from "./selectors.js";
import { scrollFeed } from "./session.js";

/**
 * Scrape the Facebook home feed from an already-authenticated page.
 * The page must already be navigated to facebook.com with a logged-in session.
 */
export async function scrapeFacebookFeed(
  page: Page,
  options: FacebookScrapeOptions = {}
): Promise<RawFbPost[]> {
  const {
    maxScrolls = 5,
    maxPosts = 50,
    scrollDelayMs = 800,
  } = options;

  // Scroll to load posts
  await scrollFeed(page, maxScrolls, scrollDelayMs);

  // Extract all posts from the DOM in a single page.evaluate call.
  // We pass all selectors in so the closure doesn't capture them by reference.
  const rawPosts = await page.evaluate(
    ({ selectors, maxPosts: limit }) => {
      // Try data-pagelet first, then fallback
      let postElements = Array.from(
        document.querySelectorAll(selectors.feedUnit)
      ) as HTMLElement[];

      if (postElements.length === 0) {
        postElements = Array.from(
          document.querySelectorAll(selectors.feedUnitFallback)
        ) as HTMLElement[];
      }

      // Limit to maxPosts
      postElements = postElements.slice(0, limit);

      return postElements.map((el) => {
        // --- Post URL + ID ---
        const postLinkEl = el.querySelector(
          'a[href*="story_fbid"], a[href*="/posts/"], a[href*="/permalink/"]'
        ) as HTMLAnchorElement | null;
        const url = postLinkEl?.href ?? null;
        const pagelet = el.getAttribute("data-pagelet");

        // --- Author ---
        const authorLinkEl = el.querySelector("h4 a") as HTMLAnchorElement | null;
        const authorName =
          el.querySelector("h4 a strong")?.textContent?.trim() ??
          authorLinkEl?.getAttribute("aria-label")?.trim() ??
          null;
        const authorProfileUrl = authorLinkEl?.href ?? null;
        const avatarEl = el.querySelector(
          'image[xlink\\:href]'
        ) as SVGImageElement | null;
        const imgEl = el.querySelector(
          'img[referrerpolicy="origin-when-cross-origin"]'
        ) as HTMLImageElement | null;
        const authorAvatarUrl =
          avatarEl?.getAttribute("xlink:href") ?? imgEl?.src ?? null;

        // --- Timestamps ---
        const abbrEl = el.querySelector("abbr[data-utime]") as HTMLElement | null;
        const timestampSeconds = abbrEl
          ? parseInt(abbrEl.getAttribute("data-utime") ?? "0", 10) || null
          : null;
        const timeEl = el.querySelector("time[datetime]") as HTMLTimeElement | null;
        const timestampIso = timeEl?.getAttribute("datetime") ?? null;

        // --- Content text ---
        const textEl = el.querySelector(
          '[data-ad-comet-preview="message"], [data-ad-preview="message"]'
        ) as HTMLElement | null;
        const text = textEl?.innerText?.trim() ?? null;

        // --- Media ---
        const imgEls = Array.from(
          el.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]')
        ) as HTMLImageElement[];
        const mediaUrls = imgEls
          .map((img) => img.src)
          .filter((src) => src && !src.includes("emoji") && !src.includes("1x1"))
          // Skip tiny tracking pixels
          .filter((src, i, arr) => arr.indexOf(src) === i); // deduplicate

        const hasVideo = el.querySelector("video") !== null;

        // --- Engagement ---
        const reactionSpan = el.querySelector(
          'span[aria-label*="reaction"], span[aria-label*=" people"]'
        ) as HTMLElement | null;
        const commentSpan = el.querySelector(
          'span[aria-label*="comment"]'
        ) as HTMLElement | null;
        const shareSpan = el.querySelector(
          'span[aria-label*="share"]'
        ) as HTMLElement | null;

        const likeText = reactionSpan?.getAttribute("aria-label") ?? reactionSpan?.textContent ?? null;
        const commentText = commentSpan?.getAttribute("aria-label") ?? commentSpan?.textContent ?? null;
        const shareText = shareSpan?.getAttribute("aria-label") ?? shareSpan?.textContent ?? null;

        // --- Location ---
        const locationEl = el.querySelector(
          'a[href*="/places/"], a[href*="/?action=view_location"]'
        ) as HTMLAnchorElement | null;
        const location = locationEl?.textContent?.trim() ?? null;

        // --- Post type ---
        const isReel =
          el.getAttribute("data-pagelet")?.includes("Reel") ||
          el.querySelector("video") !== null;
        const postType = isReel ? "reel" : "post";

        return {
          url,
          pagelet,
          authorName,
          authorProfileUrl,
          authorAvatarUrl,
          text,
          timestampSeconds,
          timestampIso,
          mediaUrls,
          hasVideo,
          likeText,
          commentText,
          shareText,
          location,
          postType,
        };
      });
    },
    { selectors: SELECTORS, maxPosts }
  );

  // Process the raw DOM data into RawFbPost objects
  return rawPosts.map((raw) => {
    const id = extractPostId(raw.url, raw.pagelet);

    const likeCount = raw.likeText ? parseEngagementCount(raw.likeText) : null;
    const commentCount = raw.commentText ? parseEngagementCount(raw.commentText) : null;
    const shareCount = raw.shareText ? parseEngagementCount(raw.shareText) : null;

    const text = raw.text ?? "";
    const hashtags = extractHashtags(text);

    return {
      id,
      url: raw.url,
      authorName: raw.authorName,
      authorProfileUrl: raw.authorProfileUrl,
      authorAvatarUrl: raw.authorAvatarUrl,
      text: text || null,
      timestampSeconds: raw.timestampSeconds,
      timestampIso: raw.timestampIso,
      mediaUrls: raw.mediaUrls,
      hasVideo: raw.hasVideo,
      likeCount,
      commentCount,
      shareCount,
      postType: (raw.postType as RawFbPost["postType"]) ?? "unknown",
      location: raw.location,
      hashtags,
      isShare: false,
      sharedFrom: null,
    } satisfies RawFbPost;
  });
}
