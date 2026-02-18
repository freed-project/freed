/**
 * Facebook session management
 *
 * Creates an authenticated Playwright browser context using Facebook cookies.
 * The user must be logged into Facebook in their browser; cookies are extracted
 * and provided to this module.
 */

import type { Browser, BrowserContext, Page } from "playwright-core";
import type { FacebookCookies, FacebookScrapeOptions, PlaywrightCookie } from "./types.js";

/** Default realistic desktop user-agent */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

/**
 * Convert our FacebookCookies to Playwright cookie format.
 */
export function cookiesToPlaywright(cookies: FacebookCookies): PlaywrightCookie[] {
  const base = { domain: ".facebook.com", path: "/" };
  const result: PlaywrightCookie[] = [
    { name: "c_user", value: cookies.c_user, ...base },
    { name: "xs", value: cookies.xs, ...base },
  ];
  if (cookies.datr) result.push({ name: "datr", value: cookies.datr, ...base });
  if (cookies.sb) result.push({ name: "sb", value: cookies.sb, ...base });
  return result;
}

/**
 * Create an authenticated Playwright BrowserContext for Facebook.
 * The caller owns the browser lifecycle — this only creates the context.
 */
export async function createFacebookContext(
  browser: Browser,
  cookies: FacebookCookies,
  options: FacebookScrapeOptions = {}
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    viewport: options.viewport ?? { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    // Reduce bot-detection signals
    javaScriptEnabled: true,
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
  });

  await context.addCookies(cookiesToPlaywright(cookies));
  return context;
}

/**
 * Navigate to the Facebook home feed and wait for it to load.
 * Returns true if the feed loaded successfully, false if redirected to login.
 */
export async function navigateToFeed(page: Page): Promise<boolean> {
  await page.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Check if we were redirected to login
  const url = page.url();
  if (url.includes("/login") || url.includes("checkpoint")) {
    return false;
  }

  // Wait for the feed to appear (up to 15 seconds)
  try {
    await page.waitForSelector('div[role="feed"]', { timeout: 15_000 });
    return true;
  } catch {
    // Feed selector not found — might be a layout change or login wall
    return false;
  }
}

/**
 * Scroll the page to load more feed posts.
 * Facebook uses infinite scroll triggered by IntersectionObserver.
 */
export async function scrollFeed(
  page: Page,
  maxScrolls: number,
  delayMs: number
): Promise<void> {
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    // Random delay between scrolls to appear human-like
    const jitter = Math.floor(Math.random() * 400);
    await page.waitForTimeout(delayMs + jitter);
  }
}
