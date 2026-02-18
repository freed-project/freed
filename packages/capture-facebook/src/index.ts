/**
 * @freed/capture-facebook — Facebook feed capture package
 *
 * DOM-based scraping of the Facebook home feed using Playwright.
 * Requires the user to be logged into Facebook and their cookies extracted.
 *
 * Usage:
 *   import { captureFacebookFeed } from "@freed/capture-facebook";
 *   const items = await captureFacebookFeed(cookies, { maxPosts: 50 });
 *
 * Or with an existing Playwright browser:
 *   import { scrapeFacebookFeed, createFacebookContext } from "@freed/capture-facebook";
 *   const ctx = await createFacebookContext(browser, cookies);
 *   const page = await ctx.newPage();
 *   const items = await scrapeFacebookFeed(page);
 */

import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import type { FacebookCookies, FacebookScrapeOptions } from "./types.js";
import { createFacebookContext, navigateToFeed } from "./session.js";
import { scrapeFacebookFeed } from "./scraper.js";
import { fbPostsToFeedItems, deduplicateFeedItems } from "./normalize.js";

// Re-export public types and utilities
export type { FacebookCookies, FacebookScrapeOptions, RawFbPost, RateLimitState } from "./types.js";
export { createFacebookContext, navigateToFeed } from "./session.js";
export { scrapeFacebookFeed } from "./scraper.js";
export { fbPostToFeedItem, fbPostsToFeedItems, deduplicateFeedItems } from "./normalize.js";
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

export interface CaptureFacebookOptions extends FacebookScrapeOptions {
  /**
   * Playwright channel to use. Defaults to "chrome" (system Chrome).
   * Pass "chromium" to use Playwright's bundled Chromium.
   */
  browserChannel?: "chrome" | "chromium" | "chrome-beta" | "msedge";

  /**
   * Run browser in headless mode. Default: true.
   * Set to false for debugging.
   */
  headless?: boolean;

  /**
   * Pass an existing browser instance to reuse it.
   * If provided, browserChannel and headless are ignored.
   */
  browser?: Browser;
}

/**
 * High-level capture function: launch browser → login → scrape → normalize.
 *
 * @param cookies - Authenticated Facebook session cookies
 * @param options - Scrape options
 * @returns Array of FeedItems, deduplicated by globalId
 * @throws If the Facebook session is invalid / login wall encountered
 */
export async function captureFacebookFeed(
  cookies: FacebookCookies,
  options: CaptureFacebookOptions = {}
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
    const context = await createFacebookContext(browser, cookies, scrapeOptions);
    const page = await context.newPage();

    const isLoggedIn = await navigateToFeed(page);
    if (!isLoggedIn) {
      throw new Error(
        "Facebook session is invalid or expired. Please re-extract cookies."
      );
    }

    const rawPosts = await scrapeFacebookFeed(page, scrapeOptions);
    await context.close();

    const items = fbPostsToFeedItems(rawPosts);
    return deduplicateFeedItems(items);
  } finally {
    if (ownsBrowser) {
      await browser.close();
    }
  }
}
