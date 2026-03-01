/**
 * Instagram feed scraper
 *
 * Extracts raw post data from the Instagram DOM.
 */

import type { Page } from "playwright-core";
import type { RawIgPost, InstagramScrapeOptions } from "./types.js";
import { extractShortcode, extractHashtags, parseEngagementCount } from "./selectors.js";
import { scrollFeed } from "./session.js";

/**
 * Scrape the Instagram home feed from an already-authenticated page.
 */
export async function scrapeInstagramFeed(
  page: Page,
  options: InstagramScrapeOptions = {}
): Promise<RawIgPost[]> {
  const {
    maxScrolls = 5,
    maxPosts = 30,
    scrollDelayMs = 1200,
  } = options;

  // Scroll to load posts
  await scrollFeed(page, maxScrolls, scrollDelayMs);

  // Extract all posts from the DOM
  const rawPosts = await page.evaluate(({ limit }: { limit: number }) => {
    const articleEls = Array.from(document.querySelectorAll("article")).slice(
      0,
      limit
    ) as HTMLElement[];

    return articleEls.map((el) => {
      // --- Post URL & shortcode ---
      const postLinkEl = el.querySelector(
        'a[href*="/p/"], a[href*="/reel/"]'
      ) as HTMLAnchorElement | null;
      const url = postLinkEl?.href ?? null;

      // --- Author ---
      const authorLinkEl = el.querySelector(
        "header a[role='link']"
      ) as HTMLAnchorElement | null;
      const authorHandle =
        authorLinkEl?.textContent?.trim() ??
        authorLinkEl?.getAttribute("href")?.replace(/^\/|\/$/g, "") ??
        null;
      const authorProfileUrl = authorLinkEl?.href ?? null;
      const avatarEl = el.querySelector("header img") as HTMLImageElement | null;
      const authorAvatarUrl = avatarEl?.src ?? null;

      // --- Caption ---
      const captionBlock = el.querySelector(
        "._a9zr, h1"
      ) as HTMLElement | null;
      const captionText =
        captionBlock?.querySelector("._a9zs span, h1 span")?.textContent ??
        captionBlock?.textContent ??
        null;

      // --- Timestamp ---
      const timeEl = el.querySelector("time[datetime]") as HTMLTimeElement | null;
      const timestampIso = timeEl?.getAttribute("datetime") ?? null;

      // --- Media ---
      const imgEls = Array.from(
        el.querySelectorAll(
          'img[srcset], img[src*="cdninstagram"], img[src*="instagram"]'
        )
      ) as HTMLImageElement[];

      // Exclude avatar images (usually in header)
      const headerImgs = new Set(
        Array.from(el.querySelectorAll("header img")).map(
          (img) => (img as HTMLImageElement).src
        )
      );
      const mediaImgUrls = imgEls
        .map((img) => img.src)
        .filter((src) => src && !headerImgs.has(src))
        .filter((src, i, arr) => arr.indexOf(src) === i); // deduplicate

      const isVideo = el.querySelector("video") !== null;
      const isCarousel =
        el.querySelector('button[aria-label="Next"]') !== null ||
        el.querySelectorAll('img[srcset]').length > 1;

      // --- Engagement ---
      // Instagram often hides exact like counts ("Liked by X and others")
      const likeSectionText =
        el.querySelector("section")?.textContent ?? null;
      const likeEl = el.querySelector(
        'span[class*="like"], span[aria-label*="like"]'
      ) as HTMLElement | null;
      const likeText = likeEl?.getAttribute("aria-label") ?? likeEl?.textContent ?? null;

      const commentLinkEl = el.querySelector(
        'a[href*="/comments"]'
      ) as HTMLAnchorElement | null;
      const commentText = commentLinkEl?.textContent?.trim() ?? null;

      // --- Location ---
      const locationEl = el.querySelector(
        'a[href*="/explore/locations/"]'
      ) as HTMLAnchorElement | null;
      const location = locationEl?.textContent?.trim() ?? null;
      const locationUrl = locationEl?.href ?? null;

      // --- Post type ---
      let postType: string;
      if (url?.includes("/reel/")) {
        postType = "reel";
      } else if (isVideo) {
        postType = "video";
      } else if (isCarousel) {
        postType = "carousel";
      } else if (mediaImgUrls.length > 0) {
        postType = "photo";
      } else {
        postType = "unknown";
      }

      return {
        url,
        authorHandle,
        authorProfileUrl,
        authorAvatarUrl,
        captionText: captionText?.trim() ?? null,
        timestampIso,
        mediaImgUrls,
        isVideo,
        isCarousel,
        likeText,
        likeSectionText,
        commentText,
        location,
        locationUrl,
        postType,
      };
    });
  }, { limit: maxPosts });

  return rawPosts.map((raw) => {
    const shortcode = extractShortcode(raw.url);
    const caption = raw.captionText ?? "";
    const hashtags = extractHashtags(caption);
    const likeCount = raw.likeText
      ? parseEngagementCount(raw.likeText)
      : raw.likeSectionText
      ? parseEngagementCount(raw.likeSectionText)
      : null;
    const commentCount = raw.commentText ? parseEngagementCount(raw.commentText) : null;

    return {
      shortcode,
      url: raw.url,
      authorHandle: raw.authorHandle,
      authorDisplayName: raw.authorHandle, // IG doesn't show display names in feed easily
      authorAvatarUrl: raw.authorAvatarUrl,
      authorProfileUrl: raw.authorProfileUrl,
      caption: caption || null,
      timestampIso: raw.timestampIso,
      mediaUrls: raw.mediaImgUrls,
      isVideo: raw.isVideo,
      isCarousel: raw.isCarousel,
      likeCount,
      commentCount,
      hashtags,
      location: raw.location,
      locationUrl: raw.locationUrl,
      postType: raw.postType as RawIgPost["postType"],
    } satisfies RawIgPost;
  });
}
