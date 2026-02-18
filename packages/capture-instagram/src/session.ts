/**
 * Instagram session management
 *
 * Creates an authenticated Playwright context using Instagram cookies.
 */

import type { Browser, BrowserContext, Page } from "playwright-core";
import type { InstagramCookies, InstagramScrapeOptions, PlaywrightCookie } from "./types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

/**
 * Convert InstagramCookies to Playwright cookie format.
 */
export function cookiesToPlaywright(cookies: InstagramCookies): PlaywrightCookie[] {
  const base = { domain: ".instagram.com", path: "/" };
  const result: PlaywrightCookie[] = [
    { name: "sessionid", value: cookies.sessionid, ...base },
    { name: "csrftoken", value: cookies.csrftoken, ...base },
    { name: "ds_user_id", value: cookies.ds_user_id, ...base },
  ];
  if (cookies.ig_did) result.push({ name: "ig_did", value: cookies.ig_did, ...base });
  return result;
}

/**
 * Create an authenticated Playwright BrowserContext for Instagram.
 */
export async function createInstagramContext(
  browser: Browser,
  cookies: InstagramCookies,
  options: InstagramScrapeOptions = {}
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    viewport: options.viewport ?? { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    javaScriptEnabled: true,
    acceptDownloads: false,
  });

  await context.addCookies(cookiesToPlaywright(cookies));
  return context;
}

/**
 * Navigate to the Instagram home feed and verify login.
 * Returns true if the feed loaded, false if redirected to login.
 */
export async function navigateToFeed(page: Page): Promise<boolean> {
  await page.goto("https://www.instagram.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const url = page.url();
  if (url.includes("/accounts/login") || url.includes("/challenge")) {
    return false;
  }

  // Dismiss any "Save login info" or notification dialogs
  try {
    const notNow = page.getByRole("button", { name: /Not Now|Not now/i });
    if (await notNow.isVisible({ timeout: 4_000 })) {
      await notNow.click();
    }
  } catch {
    // No dialog — continue
  }

  try {
    await page.waitForSelector("article", { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scroll the Instagram feed to load more posts.
 */
export async function scrollFeed(
  page: Page,
  maxScrolls: number,
  delayMs: number
): Promise<void> {
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    const jitter = Math.floor(Math.random() * 500);
    await page.waitForTimeout(delayMs + jitter);
  }
}
