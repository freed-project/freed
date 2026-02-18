/**
 * @freed/capture-instagram — Instagram feed capture package
 *
 * DOM-based scraping of the Instagram home feed using Playwright.
 * Requires the user to be logged into Instagram and their cookies extracted.
 *
 * Usage:
 *   import { captureInstagramFeed } from "@freed/capture-instagram";
 *   const items = await captureInstagramFeed(cookies, { maxPosts: 30 });
 *
 * Or with an existing Playwright browser:
 *   import { scrapeInstagramFeed, createInstagramContext } from "@freed/capture-instagram";
 *   const ctx = await createInstagramContext(browser, cookies);
 *   const page = await ctx.newPage();
 *   const items = await scrapeInstagramFeed(page);
 */

import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import type { InstagramCookies, InstagramScrapeOptions } from "./types.js";
import { createInstagramContext, navigateToFeed } from "./session.js";
import { scrapeInstagramFeed } from "./scraper.js";
import { igPostsToFeedItems, deduplicateFeedItems } from "./normalize.js";

// Re-export public types and utilities
export type { InstagramCookies, InstagramScrapeOptions, RawIgPost, RateLimitState } from "./types.js";
export { createInstagramContext, navigateToFeed } from "./session.js";
export { scrapeInstagramFeed } from "./scraper.js";
export { igPostToFeedItem, igPostsToFeedItems, deduplicateFeedItems } from "./normalize.js";
export {
  createRateLimitState,
  checkRateLimit,
  recordSuccess,
  recordError,
  formatWaitTime,
} from "./rate-limit.js";
export { SELECTORS, SELECTOR_VERSION } from "./selectors.js";

// =============================================================================
// High-level convenience API
// =============================================================================

export interface CaptureInstagramOptions extends InstagramScrapeOptions {
  /**
   * Playwright channel. Default: "chrome" (system Chrome).
   */
  browserChannel?: "chrome" | "chromium" | "chrome-beta" | "msedge";

  /**
   * Headless mode. Default: true.
   */
  headless?: boolean;

  /**
   * Pass an existing browser instance to reuse.
   */
  browser?: Browser;
}

/**
 * High-level capture function: launch browser → login → scrape → normalize.
 *
 * @param cookies - Authenticated Instagram session cookies
 * @param options - Scrape options
 * @returns Array of FeedItems, deduplicated by globalId
 * @throws If the Instagram session is invalid / login wall encountered
 */
export async function captureInstagramFeed(
  cookies: InstagramCookies,
  options: CaptureInstagramOptions = {}
): Promise<import("@freed/shared").FeedItem[]> {
  const {
    browserChannel = "chrome",
    headless = true,
    browser: existingBrowser,
    ...scrapeOptions
  } = options;

  const ownsBrowser = !existingBrowser;
  const browser =
    existingBrowser ??
    (await chromium.launch({ channel: browserChannel, headless }));

  try {
    const context = await createInstagramContext(browser, cookies, scrapeOptions);
    const page = await context.newPage();

    const isLoggedIn = await navigateToFeed(page);
    if (!isLoggedIn) {
      throw new Error(
        "Instagram session is invalid or expired. Please re-extract cookies."
      );
    }

    const rawPosts = await scrapeInstagramFeed(page, scrapeOptions);
    await context.close();

    const items = igPostsToFeedItems(rawPosts);
    return deduplicateFeedItems(items);
  } finally {
    if (ownsBrowser) {
      await browser.close();
    }
  }
}
