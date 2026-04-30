import { test, expect } from "./fixtures/app";

const FACEBOOK_TITLE = "Card UI Overhaul Facebook Item";
const RSS_TITLE = "Card UI Overhaul RSS Item";
const STORY_TITLE = "Story thumbnail proof";
const BROKEN_TITLE = "Broken thumbnail fallback proof";
const FACEBOOK_URL = "https://example.com/facebook/card-ui-overhaul";
const RSS_URL = "https://example.com/rss/card-ui-overhaul";
const FACEBOOK_MEDIA_URL = "/freed.svg?feed-card";
const STORY_MEDIA_URL = "/freed.svg?story-tile";
const BROKEN_MEDIA_URL = "/freed.svg?fallback";

async function injectCardUiItems(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    async ({
      facebookTitle,
      rssTitle,
      storyTitle,
      brokenTitle,
      facebookUrl,
      rssUrl,
      facebookMediaUrl,
      storyMediaUrl,
      brokenMediaUrl,
    }) => {
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
          globalId: "test-instagram-story-thumbnail",
          platform: "instagram",
          contentType: "story",
          capturedAt: now - 25_000,
          publishedAt: now - 55_000,
          author: {
            id: "test-instagram-story-author",
            handle: "story.thumbnail",
            displayName: "Story Thumbnail",
          },
          content: {
            text: storyTitle,
            mediaUrls: [storyMediaUrl],
            mediaTypes: ["image"],
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            tags: [],
          },
          topics: ["testing"],
          sourceUrl: "https://www.instagram.com/stories/story.thumbnail/123",
        },
        {
          globalId: "test-broken-thumbnail-fallback",
          platform: "facebook",
          contentType: "post",
          capturedAt: now - 22_000,
          publishedAt: now - 50_000,
          author: {
            id: "test-broken-thumbnail-author",
            handle: "broken.thumbnail",
            displayName: "Broken Thumbnail",
          },
          content: {
            text: brokenTitle,
            mediaUrls: [brokenMediaUrl],
            mediaTypes: ["image"],
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            tags: [],
          },
          topics: ["testing"],
          sourceUrl: "https://example.com/broken-thumbnail",
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
      storyTitle: STORY_TITLE,
      brokenTitle: BROKEN_TITLE,
      facebookUrl: FACEBOOK_URL,
      rssUrl: RSS_URL,
      facebookMediaUrl: FACEBOOK_MEDIA_URL,
      storyMediaUrl: STORY_MEDIA_URL,
      brokenMediaUrl: BROKEN_MEDIA_URL,
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

async function setDualColumnMode(
  page: import("@playwright/test").Page,
  enabled: boolean,
): Promise<void> {
  await page.evaluate(async (shouldEnable) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        preferences: {
          display: {
            reading: Record<string, unknown>;
          };
        };
        updatePreferences: (update: unknown) => Promise<void>;
      };
    };

    const state = store.getState();
    await state.updatePreferences({
      display: {
        ...state.preferences.display,
        reading: {
          ...state.preferences.display.reading,
          dualColumnMode: shouldEnable,
        },
      },
    });
  }, enabled);
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
  const facebookImage = facebookCard.locator("img").first();
  await expect(facebookImage).toBeVisible();
  await expect(facebookImage).toHaveAttribute("src", /\/freed\.svg\?feed-card$/);

  const storyTile = app.page.locator('[data-feed-item-id="test-instagram-story-thumbnail"]');
  const storyImage = storyTile.locator("img").first();
  await expect(storyImage).toBeVisible();
  await expect(storyImage).toHaveAttribute("src", /\/freed\.svg\?story-tile$/);

  const brokenCard = app.page.locator('[data-feed-item-id="test-broken-thumbnail-fallback"]');
  const brokenImage = brokenCard.locator("img").first();
  await expect(brokenImage).toBeVisible();
  await expect(brokenImage).toHaveAttribute("src", /\/freed\.svg\?fallback$/);
  await brokenImage.evaluate((image) => {
    image.dispatchEvent(new Event("error"));
  });
  await expect(brokenCard.locator("img")).toHaveCount(0);
  await expect(brokenCard).toContainText(BROKEN_TITLE);

  await facebookCard.hover();
  const likeButton = facebookCard.locator('button[aria-label="Like"]').last();
  await likeButton.hover();
  await expect(facebookCard.locator('button[aria-label="Love"]')).toBeVisible();

  const rssCard = app.page.locator("article").filter({ hasText: RSS_TITLE }).first();
  await expect(rssCard).toBeVisible();
  await rssCard.hover();
  await expect(rssCard.locator('button[aria-label="Love"]')).toHaveCount(0);

  await expect(facebookCard.locator('button[aria-label="Open"]')).toBeVisible();

  await setShowEngagementCounts(app.page, false);
  await expect(facebookCard).not.toContainText("1,234");
  await expect(facebookCard).not.toContainText("45");

  await setDualColumnMode(app.page, true);
  await facebookCard.click();
  const readerHeading = app.page.locator("article h1").filter({ hasText: FACEBOOK_TITLE }).first();
  await expect(readerHeading).toBeVisible();
  await expect(app.page.getByLabel("Archive").first()).toBeVisible();
  const compactRailCard = app.page.locator('[data-testid="compact-feed-panel-scroll-container"] [data-feed-item-id="test-facebook-card-ui-overhaul"]');
  const compactRailImage = compactRailCard.locator("img").first();
  await expect(compactRailImage).toBeVisible();
  await expect(compactRailImage).toHaveAttribute("src", /\/freed\.svg\?feed-card$/);

  const openReaderButton = app.page.getByRole("button", { name: "Open", exact: true }).first();
  await expect(openReaderButton).toBeVisible();
});

test("feed cards show compact event metadata from semantic enrichment", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  await app.page.evaluate(async () => {
    const publishedAt = Date.parse("2026-04-25T12:00:00Z");
    const automerge = (window as Record<string, unknown>).__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };

    await automerge.docBatchImportItems([
      {
        globalId: "test-semantic-event-card",
        platform: "rss",
        contentType: "article",
        capturedAt: publishedAt,
        publishedAt,
        author: {
          id: "semantic-feed",
          handle: "semantic-feed",
          displayName: "Semantic Feed",
        },
        content: {
          text: "Join us at Civic Hall on May 12 at 7pm for a live event. RSVP now.",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://example.com/semantic-event",
            title: "Semantic Event Card",
            description: "A high-confidence event candidate for the feed card.",
          },
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
        rssSource: {
          feedUrl: "https://example.com/semantic-feed.xml",
          feedTitle: "Semantic Feed",
          siteUrl: "https://example.com",
        },
        sourceUrl: "https://example.com/semantic-event",
      },
    ]);
  });

  const eventCard = app.page.locator("article").filter({ hasText: "Semantic Event Card" }).first();
  await expect(eventCard).toBeVisible();
  await expect(eventCard).toContainText(/Event/);
});
