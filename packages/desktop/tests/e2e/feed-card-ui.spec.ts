import { test, expect } from "./fixtures/app";

const FACEBOOK_TITLE = "Card UI Overhaul Facebook Item";
const RSS_TITLE = "Card UI Overhaul RSS Item";
const FACEBOOK_URL = "https://example.com/facebook/card-ui-overhaul";
const RSS_URL = "https://example.com/rss/card-ui-overhaul";
const FACEBOOK_MEDIA_URL = "https://images.example.com/facebook/card-ui-overhaul.jpg";

async function injectCardUiItems(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    async ({ facebookTitle, rssTitle, facebookUrl, rssUrl, facebookMediaUrl }) => {
      const now = Date.now();
      const w = window as Record<string, unknown>;
      const automerge = w.__FREED_AUTOMERGE__ as {
        docBatchImportItems: (items: unknown[]) => Promise<unknown>;
      };

      await automerge.docBatchImportItems([
        {
          globalId: "test-facebook-card-ui-overhaul",
          platform: "facebook",
          contentType: "post",
          capturedAt: now - 30_000,
          publishedAt: now - 60_000,
          author: {
            id: "test-facebook-author",
            handle: "card.ui.overhaul",
            displayName: "Card UI Overhaul",
          },
          content: {
            text: "Facebook item to exercise the moved action cluster and hover reaction palette.",
            mediaUrls: [facebookMediaUrl],
            mediaTypes: ["image"],
            linkPreview: {
              url: facebookUrl,
              title: facebookTitle,
              description: "Facebook test item for card overhaul",
            },
          },
          engagement: {
            likes: 1234,
            comments: 45,
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            readAt: now - 15_000,
            tags: [],
          },
          topics: ["testing"],
          sourceUrl: facebookUrl,
        },
        {
          globalId: "test-rss-card-ui-overhaul",
          platform: "rss",
          contentType: "article",
          capturedAt: now - 20_000,
          publishedAt: now - 40_000,
          author: {
            id: "test-rss-author",
            handle: "card-ui-feed",
            displayName: "Card UI Feed",
          },
          content: {
            text: "RSS item to confirm single reaction platforms stay simple.",
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: {
              url: rssUrl,
              title: rssTitle,
              description: "RSS test item for card overhaul",
            },
          },
          engagement: {
            likes: 7,
            comments: 2,
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            tags: [],
          },
          topics: ["testing"],
          rssSource: {
            feedUrl: "https://example.com/feed.xml",
            feedTitle: "Example Feed",
            siteUrl: "https://example.com",
          },
          sourceUrl: rssUrl,
        },
      ]);
    },
    {
      facebookTitle: FACEBOOK_TITLE,
      rssTitle: RSS_TITLE,
      facebookUrl: FACEBOOK_URL,
      rssUrl: RSS_URL,
      facebookMediaUrl: FACEBOOK_MEDIA_URL,
    },
  );
}

async function setShowEngagementCounts(
  page: import("@playwright/test").Page,
  show: boolean,
): Promise<void> {
  await page.evaluate(async (shouldShow) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        preferences: {
          display: {
            showEngagementCounts: boolean;
          };
        };
        updatePreferences: (update: unknown) => Promise<void>;
      };
    };

    const state = store.getState();
    await state.updatePreferences({
      display: {
        ...state.preferences.display,
        showEngagementCounts: shouldShow,
      },
    });
  }, show);
}

test("feed card overhaul actions and reader open flow work", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(app.page);
  await setShowEngagementCounts(app.page, true);

  const facebookCard = app.page.locator("article").filter({ hasText: FACEBOOK_TITLE }).first();
  await expect(facebookCard).toBeVisible();
  await expect(facebookCard).toContainText("1,234");
  await expect(facebookCard).toContainText("45");
  await expect(facebookCard).toHaveClass(/grayscale/);
  await expect(facebookCard.locator('button[aria-label="Archive"]').first()).toBeVisible();
  await expect(facebookCard.locator(`img[src="${FACEBOOK_MEDIA_URL}"]`)).toHaveCount(0);

  await facebookCard.hover();
  const likeButton = facebookCard.locator('button[aria-label="Like"]').last();
  await likeButton.hover();
  await expect(facebookCard.locator('button[aria-label="Love"]')).toBeVisible();

  const rssCard = app.page.locator("article").filter({ hasText: RSS_TITLE }).first();
  await expect(rssCard).toBeVisible();
  await rssCard.hover();
  await rssCard.locator('button[aria-label="Like"]').first().hover();
  await expect(rssCard.locator('button[aria-label="Love"]')).toHaveCount(0);

  await expect(facebookCard.locator('button[aria-label="Open"]')).toBeVisible();

  await setShowEngagementCounts(app.page, false);
  await expect(facebookCard).not.toContainText("1,234");
  await expect(facebookCard).not.toContainText("45");

  await facebookCard.click();
  const reader = app.page.locator("header").filter({ hasText: "Card UI Overhaul" }).first();
  const readerHeading = app.page.locator("article h1").filter({ hasText: FACEBOOK_TITLE }).first();
  await expect(reader).toBeVisible();
  await expect(reader.locator('button[aria-label="Archive"]').first()).toBeVisible();
  await expect(readerHeading).toBeVisible();
  await expect(app.page.getByLabel("Archive")).toBeVisible();

  const openReaderButton = app.page.locator("header").getByRole("button", { name: "Open", exact: true });
  await expect(openReaderButton).toBeVisible();
});
