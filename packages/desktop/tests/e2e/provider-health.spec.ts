import { test, expect } from "./fixtures/app";

const FEED_URL = "https://example.com/feed.xml";

async function seedAcceptedDesktopConsent(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:legal.json",
      JSON.stringify({
        "legal.bundle.desktop": {
          version: "2026-03-31.1",
          acceptedAt: 1775146800000,
          surface: "desktop-first-run",
        },
      }),
    );
  });
}

async function openSettingsSection(
  page: import("@playwright/test").Page,
  sectionName: "X" | "Facebook" | "Instagram" | "LinkedIn",
) {
  const settingsLabel = sectionName === "X" ? "X / Twitter" : sectionName;
  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  const navButton = page.getByRole("button", { name: settingsLabel }).last();
  await expect(navButton).toBeVisible({ timeout: 3_000 });
  await navButton.click();
  await expect(page.getByRole("heading", { name: settingsLabel })).toBeVisible({ timeout: 3_000 });
}

test("health tab surfaces provider charts and can unsubscribe a failing feed", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);
  await page.addInitScript(() => {
    const providers = {
      rss: {
        provider: "rss",
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 1, successes: 1, failures: 0, itemsSeen: 4, itemsAdded: 2, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 1, successes: 1, failures: 0, itemsSeen: 6, itemsAdded: 3, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: index === 10 ? 1 : 0,
          successes: index === 10 ? 1 : 0,
          failures: 0,
          itemsSeen: index === 10 ? 3 : 0,
          itemsAdded: index === 10 ? 1 : 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        pause: null,
      },
      x: {
        provider: "x",
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 1, successes: 1, failures: 0, itemsSeen: 8, itemsAdded: 6, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 1, successes: 0, failures: 1, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: index === 11 ? 1 : 0,
          successes: 0,
          failures: index === 11 ? 1 : 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [
          {
            id: "x-rate-limit",
            provider: "x",
            scope: "provider",
            outcome: "provider_rate_limit",
            stage: "provider_rate_limit",
            reason: "Rate limit exceeded",
            startedAt: 1775146800000,
            finishedAt: 1775146860000,
            durationMs: 60000,
            itemsSeen: 0,
            itemsAdded: 0,
            bytesMoved: 0,
            signalType: "explicit",
          },
        ],
        pause: {
          pausedUntil: 1775154000000,
          pauseReason: "Rate limit exceeded",
          pauseLevel: 1,
          detectedAt: 1775146800000,
          detectedBy: "auto",
        },
        lastPauseLevel: 1,
        lastPauseDetectedAt: 1775146800000,
      },
      facebook: {
        provider: "facebook",
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        pause: null,
      },
      instagram: {
        provider: "instagram",
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        pause: null,
      },
      linkedin: {
        provider: "linkedin",
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        pause: null,
      },
      gdrive: {
        provider: "gdrive",
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        pause: null,
      },
      dropbox: {
        provider: "dropbox",
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        pause: null,
      },
    };

    const state = {
      version: 1,
      providers,
      rssFeeds: {
        "https://example.com/feed.xml": {
          feedUrl: "https://example.com/feed.xml",
          feedTitle: "Example Feed",
          dailyBuckets: [
            { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
            { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
            { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
            { dateKey: "2026-03-30", attempts: 1, successes: 0, failures: 1, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
            { dateKey: "2026-03-31", attempts: 1, successes: 0, failures: 1, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
            { dateKey: "2026-04-01", attempts: 1, successes: 0, failures: 1, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
            { dateKey: "2026-04-02", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          ],
          hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
            hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
            attempts: index === 10 ? 1 : 0,
            successes: 0,
            failures: index === 10 ? 1 : 0,
            itemsSeen: 0,
            itemsAdded: 0,
            bytesMoved: 0,
          })),
          latestAttempts: [
            {
              id: "feed-fail-1",
              provider: "rss",
              scope: "rss_feed",
              feedUrl: "https://example.com/feed.xml",
              feedTitle: "Example Feed",
              outcome: "error",
              stage: "fetch",
              reason: "Connection refused",
              startedAt: 1775056800000,
              finishedAt: 1775056860000,
              durationMs: 60000,
              itemsSeen: 0,
              itemsAdded: 0,
              bytesMoved: 0,
              signalType: "none",
            },
            {
              id: "feed-fail-2",
              provider: "rss",
              scope: "rss_feed",
              feedUrl: "https://example.com/feed.xml",
              feedTitle: "Example Feed",
              outcome: "error",
              stage: "fetch",
              reason: "Connection refused",
              startedAt: 1774970400000,
              finishedAt: 1774970460000,
              durationMs: 60000,
              itemsSeen: 0,
              itemsAdded: 0,
              bytesMoved: 0,
              signalType: "none",
            },
            {
              id: "feed-fail-3",
              provider: "rss",
              scope: "rss_feed",
              feedUrl: "https://example.com/feed.xml",
              feedTitle: "Example Feed",
              outcome: "error",
              stage: "fetch",
              reason: "Connection refused",
              startedAt: 1774884000000,
              finishedAt: 1774884060000,
              durationMs: 60000,
              itemsSeen: 0,
              itemsAdded: 0,
              bytesMoved: 0,
              signalType: "none",
            },
          ],
        },
      },
      updatedAt: 1775146860000,
    };

    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:sync-health.json",
      JSON.stringify({ "provider-health": state }),
    );
  });

  await app.goto();
  await app.waitForReady();

  await page.evaluate(async ({ feedUrl }) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddRssFeed: (feed: unknown) => Promise<void>;
      docAddFeedItem: (item: unknown) => Promise<void>;
    };

    await automerge.docAddRssFeed({
      url: feedUrl,
      title: "Example Feed",
      enabled: true,
      trackUnread: false,
    });
    await automerge.docAddFeedItem({
      globalId: "rss:example-feed:1",
      platform: "rss",
      contentType: "article",
      capturedAt: Date.now(),
      publishedAt: Date.now(),
      author: {
        id: "example-feed",
        handle: "example-feed",
        displayName: "Example Feed",
      },
      content: {
        text: "Broken feed article",
        mediaUrls: [],
        mediaTypes: [],
      },
      rssSource: {
        feedUrl,
        feedTitle: "Example Feed",
        siteUrl: "https://example.com",
      },
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
      },
      topics: [],
    });
  }, { feedUrl: FEED_URL });

  await page.waitForFunction((feedUrl) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            feeds: Record<string, unknown>;
            items: Array<{ globalId: string }>;
          };
        }
      | undefined;
    const state = store?.getState();
    return !!state?.feeds[feedUrl] && (state?.items.length ?? 0) > 0;
  }, FEED_URL);

  await page.keyboard.press("Control+Shift+D");
  await expect(page.getByRole("heading", { name: "Sync Diagnostics" })).toBeVisible();

  await page.getByRole("button", { name: "Health" }).click();
  await expect(page.getByText("Provider Health")).toBeVisible();
  await expect(page.getByText(FEED_URL, { exact: true })).toBeVisible();
  await expect(page.getByText("Rate limit exceeded").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Unsubscribe" })).toBeVisible();

  await page.getByRole("button", { name: "Show 24h" }).first().click();
  await expect(page.getByText("Pulled Per Hour").first()).toBeVisible();

  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByText("Also delete articles and reading history for this feed")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Unsubscribe" }).last().click();

  await page.waitForFunction((feedUrl) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            feeds: Record<string, unknown>;
            items: Array<{ rssSource?: { feedUrl?: string } }>;
          };
        }
      | undefined;
    const state = store?.getState();
    const feedGone = !state?.feeds[feedUrl];
    const matchingItems =
      state?.items.filter((item) => item.rssSource?.feedUrl === feedUrl) ?? [];
    return feedGone && matchingItems.length === 0;
  }, FEED_URL);

  await expect(page.getByText(FEED_URL, { exact: true })).toHaveCount(0);
});

test("paused provider health is visible in X settings and can be resumed", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);
  await page.addInitScript(() => {
    const now = Date.now();
    const pausedUntil = now + 2 * 60 * 60 * 1000;
    const lastAttemptAt = now - 60_000;
    const lastSuccessfulAt = now - 24 * 60 * 60 * 1000;
    const detectedAt = now - 120_000;
    const providers = {
      rss: {
        provider: "rss",
        status: "idle",
        lastAttemptAt: undefined,
        lastSuccessfulAt: undefined,
        lastOutcome: undefined,
        lastError: undefined,
        currentMessage: undefined,
        pause: null,
        dailyBuckets: Array.from({ length: 7 }, (_, index) => ({
          dateKey: `2026-04-0${index + 1}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
        totalBytes7d: 0,
      },
      x: {
        provider: "x",
        status: "paused",
        lastAttemptAt,
        lastSuccessfulAt,
        lastOutcome: "provider_rate_limit",
        lastError: "Rate limit exceeded",
        currentMessage: "Rate limit exceeded",
        pause: {
          pausedUntil,
          pauseReason: "Rate limit exceeded",
          pauseLevel: 1,
          detectedAt,
          detectedBy: "auto",
        },
        dailyBuckets: [
          { dateKey: "2026-03-27", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-28", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-29", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-30", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-03-31", attempts: 0, successes: 0, failures: 0, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
          { dateKey: "2026-04-01", attempts: 1, successes: 1, failures: 0, itemsSeen: 8, itemsAdded: 6, bytesMoved: 0 },
          { dateKey: "2026-04-02", attempts: 1, successes: 0, failures: 1, itemsSeen: 0, itemsAdded: 0, bytesMoved: 0 },
        ],
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: index === 11 ? 1 : 0,
          successes: 0,
          failures: index === 11 ? 1 : 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [
          {
            id: "x-rate-limit",
            provider: "x",
            scope: "provider",
            outcome: "provider_rate_limit",
            stage: "provider_rate_limit",
            reason: "Rate limit exceeded",
            startedAt: detectedAt,
            finishedAt: lastAttemptAt,
            durationMs: 60000,
            itemsSeen: 0,
            itemsAdded: 0,
            bytesMoved: 0,
            signalType: "explicit",
          },
        ],
        totalSeen7d: 8,
        totalAdded7d: 6,
        totalBytes7d: 0,
      },
      facebook: {
        provider: "facebook",
        status: "idle",
        lastAttemptAt: undefined,
        lastSuccessfulAt: undefined,
        lastOutcome: undefined,
        lastError: undefined,
        currentMessage: undefined,
        pause: null,
        dailyBuckets: Array.from({ length: 7 }, (_, index) => ({
          dateKey: `2026-04-0${index + 1}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
        totalBytes7d: 0,
      },
      instagram: {
        provider: "instagram",
        status: "idle",
        lastAttemptAt: undefined,
        lastSuccessfulAt: undefined,
        lastOutcome: undefined,
        lastError: undefined,
        currentMessage: undefined,
        pause: null,
        dailyBuckets: Array.from({ length: 7 }, (_, index) => ({
          dateKey: `2026-04-0${index + 1}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
        totalBytes7d: 0,
      },
      linkedin: {
        provider: "linkedin",
        status: "idle",
        lastAttemptAt: undefined,
        lastSuccessfulAt: undefined,
        lastOutcome: undefined,
        lastError: undefined,
        currentMessage: undefined,
        pause: null,
        dailyBuckets: Array.from({ length: 7 }, (_, index) => ({
          dateKey: `2026-04-0${index + 1}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
        totalBytes7d: 0,
      },
      gdrive: {
        provider: "gdrive",
        status: "idle",
        lastAttemptAt: undefined,
        lastSuccessfulAt: undefined,
        lastOutcome: undefined,
        lastError: undefined,
        currentMessage: undefined,
        pause: null,
        dailyBuckets: Array.from({ length: 7 }, (_, index) => ({
          dateKey: `2026-04-0${index + 1}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
        totalBytes7d: 0,
      },
      dropbox: {
        provider: "dropbox",
        status: "idle",
        lastAttemptAt: undefined,
        lastSuccessfulAt: undefined,
        lastOutcome: undefined,
        lastError: undefined,
        currentMessage: undefined,
        pause: null,
        dailyBuckets: Array.from({ length: 7 }, (_, index) => ({
          dateKey: `2026-04-0${index + 1}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        hourlyBuckets: Array.from({ length: 24 }, (_, index) => ({
          hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
          attempts: 0,
          successes: 0,
          failures: 0,
          itemsSeen: 0,
          itemsAdded: 0,
          bytesMoved: 0,
        })),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
        totalBytes7d: 0,
      },
    };

    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:sync-health.json",
      JSON.stringify({
        "provider-health": {
          version: 1,
          providers,
          rssFeeds: {},
          updatedAt: lastAttemptAt,
        },
      }),
    );
  });

  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      xAuth: {
        isAuthenticated: true,
        cookies: { ct0: "ct0", authToken: "token" },
        lastCapturedAt: Date.now() - 24 * 60 * 60 * 1000,
        lastCaptureError: "Rate limit exceeded",
        pausedUntil: Date.now() + 2 * 60 * 60 * 1000,
        pauseReason: "Rate limit exceeded",
        pauseLevel: 1,
      },
    });
  });

  await openSettingsSection(page, "X");

  await expect(page.getByText("Paused until").first()).toBeVisible();
  await expect(page.getByText("Rate limit exceeded").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume now" })).toBeVisible();

  await page.getByRole("button", { name: "Resume now" }).click();

  await expect(page.getByRole("button", { name: "Resume now" })).toHaveCount(0);
  await expect(page.getByText("Needs attention").last()).toBeVisible();
});
