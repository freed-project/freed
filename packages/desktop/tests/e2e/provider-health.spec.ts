import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const FEED_URL = "https://example.com/feed.xml";
const DEBUG_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/debug-store.ts",
  import.meta.url,
);

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
  await expect(page.getByTestId("settings-close-button-sidebar")).toBeVisible({ timeout: 5_000 });
  const navButton = page.locator("button").filter({
    has: page.getByText(settingsLabel, { exact: true }),
  }).last();
  await expect(navButton).toBeVisible({ timeout: 3_000 });
  await navButton.click();
  await expect(page.getByRole("heading", { name: settingsLabel }).last()).toBeVisible({ timeout: 3_000 });
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
  await expect(page.getByRole("button", { name: "Sync Now" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Unsubscribe" })).toBeVisible();

  await page.getByLabel("RSS duration").selectOption("hourly");
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
        status: "degraded",
        lastAttemptAt: now,
        lastSuccessfulAt: now - 60 * 60 * 1000,
        lastOutcome: "error",
        lastError: "Scrape timed out",
        currentMessage: "Scrape timed out",
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
  await expect(page.getByRole("button", { name: "Resume Now" })).toBeVisible();
  await expect(page.getByTestId("settings-provider-status-x")).toHaveAttribute("title", "Paused");
  await expect(page.getByTestId("settings-provider-status-x")).toHaveClass(/bg-amber-500/);

  await page.getByRole("button", { name: "Resume Now" }).click();

  await expect(page.getByRole("button", { name: "Resume Now" })).toBeVisible();
  await expect(page.getByTestId("provider-sync-action-x")).toContainText("Resume Now");
});

test("facebook groups settings separate last-active text and show active counts", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
      getState: () => {
        preferences: Record<string, unknown>;
      };
    };

    store.setState({
      fbAuth: {
        isAuthenticated: true,
      },
      preferences: {
        ...store.getState().preferences,
        fbCapture: {
          knownGroups: {
            one: {
              id: "one",
              name: "CDA Buy Trade Or SellLast active about a minute ago",
              url: "https://facebook.com/groups/one",
            },
            two: {
              id: "two",
              name: "North Idaho Lifelast active 2 hours ago",
              url: "https://facebook.com/groups/two",
            },
          },
          excludedGroupIds: {
            two: true,
          },
        },
      },
    });
  });

  await openSettingsSection(page, "Facebook");

  await expect(page.getByText("1 active of 2 total")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate all", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate all", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page.getByTestId("facebook-group-one-label")).toHaveText("CDA Buy Trade Or Sell");
  await expect(page.getByTestId("facebook-group-one-meta")).toHaveText("Last active about a minute ago");
});

test("auth failures in X settings prompt the user to reconnect", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

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
        lastCaptureError:
          'X API error 401 Unauthorized: {"errors":[{"message":"Could not authenticate you.","code":32}]}',
      },
    });
  });

  await openSettingsSection(page, "X");

  await expect(page.getByText("Reconnect required").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect X" })).toBeVisible();
  await expect(
    page.getByText("X needs you to sign in again before sync can continue."),
  ).toBeVisible();
});

test("cooldown states use a specific label instead of generic attention copy", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  await page.addInitScript(() => {
    const now = Date.now();
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
        status: "paused",
        lastAttemptAt: now,
        lastSuccessfulAt: now - 16 * 60 * 1000,
        lastOutcome: "cooldown",
        lastError: "Cooling down. Try again in ~5 minutes.",
        currentMessage: "Cooling down. Try again in ~5 minutes.",
        pause: {
          pausedUntil: now + 5 * 60 * 1000,
          pauseReason: "Cooling down. Try again in ~5 minutes.",
          pauseLevel: 1,
          detectedAt: now - 60_000,
          detectedBy: "auto",
        },
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
        latestAttempts: [
          {
            id: "instagram-cooldown",
            provider: "instagram",
            scope: "provider",
            outcome: "cooldown",
            stage: "cooldown",
            reason: "Cooling down. Try again in ~5 minutes.",
            startedAt: now - 60_000,
            finishedAt: now,
            durationMs: 60_000,
            itemsSeen: 0,
            itemsAdded: 0,
            bytesMoved: 0,
            signalType: "none",
          },
        ],
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
          updatedAt: now,
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
      igAuth: {
        isAuthenticated: true,
        lastCaptureError: "Cooling down. Try again in ~5 minutes.",
      },
    });
  });

  await openSettingsSection(page, "Instagram");

  await expect(page.getByText("Cooling down").first()).toBeVisible();
  await expect(page.getByTestId("settings-provider-status-instagram")).toHaveAttribute(
    "title",
    "Cooling down",
  );
});

test("settings sources nav shows provider status dots", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  await page.addInitScript(() => {
    const now = Date.now();
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
        status: "degraded",
        lastAttemptAt: now,
        lastSuccessfulAt: now - 24 * 60 * 60 * 1000,
        lastOutcome: "error",
        lastError: "Could not authenticate you.",
        currentMessage: "Could not authenticate you.",
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
      facebook: {
        provider: "facebook",
        status: "healthy",
        lastAttemptAt: now,
        lastSuccessfulAt: now,
        lastOutcome: "success",
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
          updatedAt: now,
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
        lastCaptureError: "401 Unauthorized",
      },
      fbAuth: {
        isAuthenticated: true,
      },
      liAuth: {
        isAuthenticated: true,
        lastCaptureError: "Scrape timed out",
      },
    });
  });

  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  await expect(page.getByTestId("settings-provider-status-x")).toHaveAttribute("title", "Reconnect required");
  await expect(page.getByTestId("settings-provider-status-facebook")).toHaveAttribute("title", "Connected");
  await expect(page.getByTestId("settings-provider-status-linkedin")).toHaveAttribute("title", "Sync issue");
  await expect(page.getByTestId("settings-provider-status-instagram")).toHaveCount(0);
  await expect(page.getByTestId("settings-provider-status-x")).toBeVisible();
  await expect(page.getByTestId("settings-provider-status-facebook")).toBeVisible();
  await expect(page.getByTestId("settings-provider-status-linkedin")).toBeVisible();

  await expect(page.getByTestId("settings-provider-status-x")).toHaveClass(/bg-red-500/);
  await expect(page.getByTestId("settings-provider-status-facebook")).toHaveClass(/bg-emerald-500/);
  await expect(page.getByTestId("settings-provider-status-linkedin")).toHaveClass(/bg-amber-500/);
  await expect(page.getByTestId("source-indicator-x")).toHaveAttribute("title", "Reconnect required");
  await expect(page.getByTestId("source-indicator-facebook")).toHaveAttribute("title", "Connected");
  await expect(page.getByTestId("source-indicator-linkedin")).toHaveAttribute("title", "Sync issue");
  await expect(page.getByTestId("source-indicator-instagram")).toHaveCount(0);
  await expect(page.getByTestId("source-indicator-x")).toHaveClass(/bg-red-500/);
  await expect(page.getByTestId("source-indicator-facebook")).toHaveClass(/bg-emerald-500/);
  await expect(page.getByTestId("source-indicator-linkedin")).toHaveClass(/bg-amber-500/);

  const facebookSourceIndicatorLayout = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="source-row-facebook"]')?.parentElement;
    const indicator = row?.querySelector('[data-testid="source-indicator-facebook"]');
    const label = row?.querySelector('[data-testid="source-row-facebook"] span.min-w-0.flex-1.truncate');
    if (!indicator || !label || !row) {
      return null;
    }

    const indicatorRect = indicator.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      indicatorLeft: indicatorRect.left,
      indicatorRight: indicatorRect.right,
      labelRight: labelRect.right,
      rowRight: rowRect.right,
    };
  });

  expect(facebookSourceIndicatorLayout).not.toBeNull();
  expect(facebookSourceIndicatorLayout!.indicatorLeft).toBeGreaterThan(facebookSourceIndicatorLayout!.labelRight);
  expect(facebookSourceIndicatorLayout!.indicatorRight).toBeLessThan(facebookSourceIndicatorLayout!.rowRight);

  const sidebarIndicatorSizes = await page.evaluate(() => {
    const settingsIndicator = document.querySelector('[data-testid="settings-provider-status-facebook"]');
    const sourceIndicator = document.querySelector('[data-testid="source-indicator-facebook"]');
    if (!settingsIndicator || !sourceIndicator) {
      return null;
    }

    const settingsRect = settingsIndicator.getBoundingClientRect();
    const sourceRect = sourceIndicator.getBoundingClientRect();
    return {
      settingsWidth: settingsRect.width,
      settingsHeight: settingsRect.height,
      sourceWidth: sourceRect.width,
      sourceHeight: sourceRect.height,
    };
  });

  expect(sidebarIndicatorSizes).not.toBeNull();
  expect(Math.abs(sidebarIndicatorSizes!.settingsWidth - sidebarIndicatorSizes!.sourceWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(sidebarIndicatorSizes!.settingsHeight - sidebarIndicatorSizes!.sourceHeight)).toBeLessThanOrEqual(1);
});

test("sidebar keeps friends and map under all, and LinkedIn falls back to source counts for status", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        itemCountByPlatform: Record<string, number>;
        unreadCountByPlatform: Record<string, number>;
      };
      setState: (partial: Record<string, unknown>) => void;
    };
    const current = store.getState();
    store.setState({
      liAuth: {
        isAuthenticated: false,
      },
      itemCountByPlatform: {
        ...current.itemCountByPlatform,
        linkedin: 38,
      },
      unreadCountByPlatform: {
        ...current.unreadCountByPlatform,
        linkedin: 15,
      },
    });
  });

  const sourceRowOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="source-row-"]'))
      .map((node) => node.getAttribute("data-testid"))
      .slice(0, 8),
  );

  expect(sourceRowOrder).toEqual([
    "source-row-all",
    "source-row-friends",
    "source-row-map",
    "source-row-rss",
    "source-row-x",
    "source-row-facebook",
    "source-row-instagram",
    "source-row-linkedin",
  ]);

  await expect(page.getByTestId("source-indicator-linkedin")).toHaveAttribute("title", "Connected");
  await page.getByTestId("source-row-linkedin").hover();
  await page.getByTestId("source-menu-trigger-linkedin").click();
  await expect(page.getByText("Connected").first()).toBeVisible();
});

test("provider sync button shows a spinner while that provider is active", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        providerSyncCounts: Record<string, number>;
      };
      setState: (partial: Record<string, unknown>) => void;
    };
    const current = store.getState().providerSyncCounts;
    store.setState({
      xAuth: {
        isAuthenticated: true,
        cookies: { ct0: "ct0", authToken: "token" },
      },
      fbAuth: {
        isAuthenticated: true,
      },
      providerSyncCounts: {
        ...current,
        x: 1,
      },
    });

    window.__freed.debug?.()?.addEvent("change", "[X] sync started");
    window.__freed.debug?.()?.addEvent("change", "[X] requesting home timeline");
    window.__freed.debug?.()?.addEvent("change", "[X] response received: 12,345 bytes");
  });

  await openSettingsSection(page, "X");

  await expect(page.getByTestId("provider-sync-action-x")).toContainText("Syncing");
  await expect(page.getByTestId("provider-sync-action-x-spinner")).toBeVisible();
  await expect(page.getByTestId("settings-provider-status-x")).toHaveAttribute("title", "Syncing");
  await expect(page.getByTestId("provider-status-x")).toHaveAttribute("title", "Syncing");
  await expect(page.getByTestId("source-indicator-x")).toHaveAttribute("title", "Syncing");
  await expect(page.getByTestId("provider-activity-log-x")).toContainText("[X] sync started");
  await expect(page.getByTestId("provider-activity-log-x")).toContainText(
    "[X] requesting home timeline",
  );

  const sourceIndicatorSizes = await page.evaluate(() => {
    const syncingIndicator = document.querySelector('[data-testid="source-indicator-x"]');
    const healthyIndicator = document.querySelector('[data-testid="source-indicator-facebook"]');
    if (!syncingIndicator || !healthyIndicator) {
      return null;
    }

    const syncingRect = syncingIndicator.getBoundingClientRect();
    const healthyRect = healthyIndicator.getBoundingClientRect();
    return {
      syncingWidth: syncingRect.width,
      syncingHeight: syncingRect.height,
      healthyWidth: healthyRect.width,
      healthyHeight: healthyRect.height,
    };
  });

  expect(sourceIndicatorSizes).not.toBeNull();
  expect(Math.abs(sourceIndicatorSizes!.syncingWidth - sourceIndicatorSizes!.healthyWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(sourceIndicatorSizes!.syncingHeight - sourceIndicatorSizes!.healthyHeight)).toBeLessThanOrEqual(1);
});

test("cooldown indicators stay amber while sync is active", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  const debugStorePath = DEBUG_STORE_PATH;

  await app.goto();
  await app.waitForReady();

  await page.evaluate(async ({ debugStorePath }) => {
    const now = Date.now();
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        providerSyncCounts: Record<string, number>;
      };
      setState: (partial: Record<string, unknown>) => void;
    };

    store.setState({
      igAuth: {
        isAuthenticated: true,
        lastCaptureError: "Cooling down. Try again in ~1 minute.",
      },
      providerSyncCounts: {
        ...store.getState().providerSyncCounts,
        instagram: 1,
      },
      unreadCountByPlatform: {
        instagram: 97,
      },
      itemCountByPlatform: {
        instagram: 202,
      },
    });

    const makeBuckets = () =>
      Array.from({ length: 7 }, (_, index) => ({
        dateKey: `2026-04-0${index + 1}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeHourlyBuckets = () =>
      Array.from({ length: 24 }, (_, index) => ({
        hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));

    const response = await fetch(debugStorePath);
    if (!response.ok) throw new Error(`Failed to load debug store: ${response.status}`);
    await response.text();
    const mod = await import(debugStorePath);
    mod.useDebugStore.getState().setHealth({
      providers: {
        rss: { provider: "rss", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0 },
        x: { provider: "x", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0 },
        facebook: { provider: "facebook", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0 },
        instagram: {
          provider: "instagram",
          status: "paused",
          lastAttemptAt: now,
          lastSuccessfulAt: now - 16 * 60 * 1000,
          lastOutcome: "cooldown",
          lastError: "Cooling down. Try again in ~1 minute.",
          currentMessage: "Cooling down. Try again in ~1 minute.",
          pause: {
            pausedUntil: now + 60_000,
            pauseReason: "Cooling down. Try again in ~1 minute.",
            pauseLevel: 1,
            detectedAt: now - 30_000,
            detectedBy: "auto",
          },
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
          latestAttempts: [],
          totalSeen7d: 0,
          totalAdded7d: 0,
          totalBytes7d: 0,
        },
        linkedin: { provider: "linkedin", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0 },
        gdrive: { provider: "gdrive", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0 },
        dropbox: { provider: "dropbox", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0 },
      },
      failingRssFeeds: [],
      updatedAt: now,
    });
  }, { debugStorePath });

  await expect(page.getByTestId("source-indicator-instagram")).toHaveAttribute("title", "Cooling down");
  await expect(page.getByTestId("source-indicator-instagram")).toContainText("😴");
  await page.getByTestId("source-row-instagram").hover();
  await expect(page.getByTestId("source-menu-trigger-instagram")).toBeVisible();
  await page.getByTestId("source-menu-trigger-instagram").click();
  await expect(page.getByText("Cooling down").first()).toBeVisible();
});

test("feeds source indicator reflects aggregate feed health and active syncing", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  const debugStorePath = DEBUG_STORE_PATH;

  await app.goto();
  await app.waitForReady();

  await page.evaluate(async ({ debugStorePath }) => {
    const now = Date.now();
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    const makeBuckets = () =>
      Array.from({ length: 7 }, (_, index) => ({
        dateKey: `2026-04-0${index + 1}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeHourlyBuckets = () =>
      Array.from({ length: 24 }, (_, index) => ({
        hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));

    store.setState({
      feeds: {
        "https://healthy.example/feed.xml": {
          url: "https://healthy.example/feed.xml",
          title: "Healthy Feed",
          enabled: true,
          trackUnread: true,
        },
        "https://broken.example/feed.xml": {
          url: "https://broken.example/feed.xml",
          title: "Broken Feed",
          enabled: true,
          trackUnread: true,
        },
      },
      providerSyncCounts: {
        rss: 1,
        x: 0,
        facebook: 0,
        instagram: 0,
        linkedin: 0,
        gdrive: 0,
        dropbox: 0,
      },
    });

    const response = await fetch(debugStorePath);
    if (!response.ok) throw new Error(`Failed to load debug store: ${response.status}`);
    await response.text();
    const mod = await import(debugStorePath);
    mod.useDebugStore.getState().setHealth({
      providers: {
        rss: {
          provider: "rss",
          status: "degraded",
          lastAttemptAt: now,
          lastSuccessfulAt: now - 60_000,
          lastOutcome: "error",
          lastError: "One feed failed",
          currentMessage: "One feed failed",
          pause: null,
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
          latestAttempts: [],
          totalSeen7d: 0,
          totalAdded7d: 0,
          totalBytes7d: 0,
        },
        x: {
          provider: "x", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0,
        },
        facebook: {
          provider: "facebook", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0,
        },
        instagram: {
          provider: "instagram", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0,
        },
        linkedin: {
          provider: "linkedin", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0,
        },
        gdrive: {
          provider: "gdrive", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0,
        },
        dropbox: {
          provider: "dropbox", status: "idle", pause: null, dailyBuckets: makeBuckets(), hourlyBuckets: makeHourlyBuckets(), latestAttempts: [], totalSeen7d: 0, totalAdded7d: 0, totalBytes7d: 0,
        },
      },
      failingRssFeeds: [
        {
          feedUrl: "https://broken.example/feed.xml",
          feedTitle: "Broken Feed",
          status: "failing",
          outageSince: now - 48 * 60 * 60 * 1000,
          failedAttemptsSinceSuccess: 4,
          lastAttemptAt: now,
          lastSuccessfulAt: now - 49 * 60 * 60 * 1000,
          lastError: "404 Not Found",
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
          latestAttempts: [],
        },
      ],
      updatedAt: now,
    });
  }, { debugStorePath });

  await expect(page.getByTestId("source-status-rss")).toHaveAttribute("title", "Syncing");
  await page.getByTestId("source-row-rss").hover();
  await expect(page.getByTestId("source-menu-trigger-rss")).toBeVisible();

  await page.evaluate(async ({ debugStorePath }) => {
    const now = Date.now();
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      providerSyncCounts: {
        rss: 0,
        x: 0,
        facebook: 0,
        instagram: 0,
        linkedin: 0,
        gdrive: 0,
        dropbox: 0,
      },
    });

    const response = await fetch(debugStorePath);
    if (!response.ok) throw new Error(`Failed to load debug store: ${response.status}`);
    await response.text();
    const mod = await import(debugStorePath);
    const current = mod.useDebugStore.getState().health;
    mod.useDebugStore.getState().setHealth({
      ...current,
      updatedAt: now,
      failingRssFeeds: [
        {
          feedUrl: "https://healthy.example/feed.xml",
          feedTitle: "Healthy Feed",
          status: "failing",
          outageSince: now - 48 * 60 * 60 * 1000,
          failedAttemptsSinceSuccess: 3,
          lastAttemptAt: now,
          lastSuccessfulAt: now - 49 * 60 * 60 * 1000,
          lastError: "Timeout",
          dailyBuckets: current.failingRssFeeds[0].dailyBuckets,
          hourlyBuckets: current.failingRssFeeds[0].hourlyBuckets,
          latestAttempts: [],
        },
        ...current.failingRssFeeds,
      ],
    });
  }, { debugStorePath });

  await expect(page.getByTestId("source-status-rss")).toHaveAttribute("title", "Sync issue");
  await expect(page.getByTestId("source-status-rss")).toHaveClass(/bg-amber-500/);
});

test("source rows swap counts for an actions menu on hover", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

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
        lastCaptureError: "Scrape timed out",
      },
      unreadCountByPlatform: {
        x: 537,
      },
      itemCountByPlatform: {
        x: 648,
      },
    });
  });

  const sourceRow = page.getByTestId("source-row-x");
  const counts = page.getByTestId("source-counts-x");
  const trigger = page.getByTestId("source-menu-trigger-x");
  const indicator = page.getByTestId("source-indicator-slot-x");

  await expect(page.getByTestId("source-menu-trigger-all")).toHaveCount(0);
  await expect(counts).toBeVisible();
  await expect(counts).toHaveClass(/opacity-100/);
  await expect(trigger).toHaveClass(/opacity-0/);
  await expect(trigger).toHaveClass(/pointer-events-none/);
  await expect(indicator).toHaveClass(/transition-transform/);
  await expect(counts).toHaveClass(/transition-all/);
  await expect(trigger).toHaveClass(/transition-all/);

  await sourceRow.hover();

  await expect(counts).toHaveClass(/opacity-0/);
  await expect(trigger).toHaveClass(/opacity-100/);

  await trigger.click();

  await expect(page.getByTestId("source-context-menu-x")).toBeVisible();
  await expect(page.getByText("537 unread, 648 total")).toBeVisible();
  await expect(page.getByText("Sync issue")).toBeVisible();
  await expect(page.getByText("Scrape timed out")).toBeVisible();
  await expect(page.getByTestId("source-menu-sync-x")).toBeVisible();
  await page.getByTestId("source-menu-settings-x").click();

  await expect(page.getByText("Settings").first()).toBeVisible();
  await expect(page.getByText("X / Twitter").first()).toBeVisible();
});

test("source menu trigger toggles open and closed", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        providerSyncCounts: Record<string, number>;
      };
      setState: (partial: Record<string, unknown>) => void;
    };

    store.setState({
      xAuth: {
        isAuthenticated: true,
        cookies: { ct0: "ct0", authToken: "token" },
      },
      unreadCountByPlatform: {
        x: 537,
      },
      itemCountByPlatform: {
        x: 648,
      },
    });
  });

  const sourceRow = page.getByTestId("source-row-x");
  await sourceRow.hover();
  const trigger = page.getByTestId("source-menu-trigger-x");
  await trigger.click();

  const menu = page.getByTestId("source-context-menu-x");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Connected")).toBeVisible();

  await trigger.click();
  await expect(menu).toHaveCount(0);
});

test("source menu stays open and acknowledges sync now while syncing is already active", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        providerSyncCounts: Record<string, number>;
      };
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      xAuth: {
        isAuthenticated: true,
        cookies: { ct0: "ct0", authToken: "token" },
      },
      unreadCountByPlatform: {
        x: 537,
      },
      itemCountByPlatform: {
        x: 648,
      },
      providerSyncCounts: {
        ...store.getState().providerSyncCounts,
        x: 1,
      },
    });
  });

  const sourceRow = page.getByTestId("source-row-x");
  await sourceRow.hover();
  await page.getByTestId("source-menu-trigger-x").click();

  const menu = page.getByTestId("source-context-menu-x");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("537 unread, 648 total")).toBeVisible();
  await expect(menu.getByText("Syncing")).toBeVisible();

  await page.getByTestId("source-menu-sync-x").click();

  await expect(menu).toBeVisible();
  await expect(page.getByTestId("source-menu-sync-x")).toContainText("Syncing Initiated");
  await expect(page.getByText("Syncing Initiated")).toHaveCount(2);
});

test("feeds settings surfaces one needs-review filter and bulk unsubscribe above the list", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);

  const failingFeedUrl = "https://broken.example/feed.xml";
  const healthyFeedUrl = "https://healthy.example/feed.xml";
  const debugStorePath = DEBUG_STORE_PATH;

  await page.addInitScript(({ failingFeedUrl }) => {
    const now = Date.now();
    const makeBuckets = () =>
      Array.from({ length: 7 }, (_, index) => ({
        dateKey: `2026-04-0${index + 1}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeHourlyBuckets = () =>
      Array.from({ length: 24 }, (_, index) => ({
        hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));

    const providers = {
      rss: {
        provider: "rss",
        status: "degraded",
        lastAttemptAt: now,
        lastSuccessfulAt: now - 60 * 60 * 1000,
        lastOutcome: "error",
        lastError: "404 Not Found",
        currentMessage: "404 Not Found",
        pause: null,
        dailyBuckets: makeBuckets(),
        hourlyBuckets: makeHourlyBuckets(),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
        totalBytes7d: 0,
      },
      x: {
        provider: "x",
        status: "idle",
        lastAttemptAt: undefined,
        lastSuccessfulAt: undefined,
        lastOutcome: undefined,
        lastError: undefined,
        currentMessage: undefined,
        pause: null,
        dailyBuckets: makeBuckets(),
        hourlyBuckets: makeHourlyBuckets(),
        latestAttempts: [],
        totalSeen7d: 0,
        totalAdded7d: 0,
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
        dailyBuckets: makeBuckets(),
        hourlyBuckets: makeHourlyBuckets(),
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
        dailyBuckets: makeBuckets(),
        hourlyBuckets: makeHourlyBuckets(),
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
        dailyBuckets: makeBuckets(),
        hourlyBuckets: makeHourlyBuckets(),
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
        dailyBuckets: makeBuckets(),
        hourlyBuckets: makeHourlyBuckets(),
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
        dailyBuckets: makeBuckets(),
        hourlyBuckets: makeHourlyBuckets(),
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
          rssFeeds: {
            [failingFeedUrl]: {
              feedUrl: failingFeedUrl,
              feedTitle: "Broken Feed",
              status: "failing",
              outageSince: now - 2 * 24 * 60 * 60 * 1000,
              failedAttemptsSinceSuccess: 4,
              lastAttemptAt: now,
              lastSuccessfulAt: now - 3 * 24 * 60 * 60 * 1000,
              lastError: "404 Not Found",
              dailyBuckets: makeBuckets(),
              hourlyBuckets: makeHourlyBuckets(),
              latestAttempts: [],
            },
          },
          updatedAt: now,
        },
      }),
    );
  }, { failingFeedUrl });

  await app.goto();
  await app.waitForReady();

  await page.evaluate(async ({ debugStorePath, failingFeedUrl }) => {
    const now = Date.now();
    const makeBuckets = () =>
      Array.from({ length: 7 }, (_, index) => ({
        dateKey: `2026-04-0${index + 1}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeHourlyBuckets = () =>
      Array.from({ length: 24 }, (_, index) => ({
        hourKey: `2026-04-02T${String(index).padStart(2, "0")}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const response = await fetch(debugStorePath);
    if (!response.ok) throw new Error(`Failed to load debug store: ${response.status}`);
    await response.text();
    const mod = await import(debugStorePath);
    mod.useDebugStore.getState().setHealth({
      providers: {
        rss: {
          provider: "rss",
          status: "degraded",
          lastAttemptAt: now,
          lastSuccessfulAt: now - 60 * 60 * 1000,
          lastOutcome: "error",
          lastError: "404 Not Found",
          currentMessage: "404 Not Found",
          pause: null,
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
          latestAttempts: [],
          totalSeen7d: 0,
          totalAdded7d: 0,
          totalBytes7d: 0,
        },
        x: {
          provider: "x",
          status: "idle",
          lastAttemptAt: undefined,
          lastSuccessfulAt: undefined,
          lastOutcome: undefined,
          lastError: undefined,
          currentMessage: undefined,
          pause: null,
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
          latestAttempts: [],
          totalSeen7d: 0,
          totalAdded7d: 0,
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
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
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
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
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
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
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
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
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
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
          latestAttempts: [],
          totalSeen7d: 0,
          totalAdded7d: 0,
          totalBytes7d: 0,
        },
      },
      failingRssFeeds: [
        {
          feedUrl: failingFeedUrl,
          feedTitle: "Broken Feed",
          status: "failing",
          outageSince: now - 2 * 24 * 60 * 60 * 1000,
          failedAttemptsSinceSuccess: 4,
          lastAttemptAt: now,
          lastSuccessfulAt: now - 3 * 24 * 60 * 60 * 1000,
          lastError: "404 Not Found",
          dailyBuckets: makeBuckets(),
          hourlyBuckets: makeHourlyBuckets(),
          latestAttempts: [],
        },
      ],
      updatedAt: now,
    });
  }, { debugStorePath, failingFeedUrl });

  await page.evaluate(async ({ failingFeedUrl, healthyFeedUrl }) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddRssFeed: (feed: unknown) => Promise<void>;
    };

    await automerge.docAddRssFeed({
      url: failingFeedUrl,
      title: "Broken Feed",
      enabled: true,
      trackUnread: false,
    });
    await automerge.docAddRssFeed({
      url: healthyFeedUrl,
      title: "Healthy Feed",
      enabled: true,
      trackUnread: false,
    });
  }, { failingFeedUrl, healthyFeedUrl });

  await page.waitForFunction(
    ([failingFeedUrl, healthyFeedUrl]) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | {
            getState: () => {
              feeds: Record<string, unknown>;
            };
          }
        | undefined;
      const feeds = store?.getState().feeds ?? {};
      return !!feeds[failingFeedUrl] && !!feeds[healthyFeedUrl];
    },
    [failingFeedUrl, healthyFeedUrl],
  );

  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();

  await expect(settingsDialog.getByRole("button", { name: "All (2)", exact: true })).toBeVisible();
  const needsReviewButton = settingsDialog.getByRole("button", {
    name: "Needs review (1)",
    exact: true,
  });
  await expect(needsReviewButton).toBeVisible();
  await expect(
    settingsDialog.getByRole("button", { name: "Unsubscribe from all feeds (2)", exact: true }),
  ).toBeVisible();

  await needsReviewButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(settingsDialog.getByText("Healthy Feed")).toHaveCount(0);
  await expect(
    settingsDialog.getByRole("button", { name: "Unsubscribe from shown feeds (1)", exact: true }),
  ).toBeVisible();
  await expect(settingsDialog.getByText("404 Not Found")).toBeVisible();
  await expect(settingsDialog.getByText("Broken Feed")).toBeVisible();
  await expect(settingsDialog.getByText("Likely dead")).toBeVisible();
});
