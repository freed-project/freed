import { test, expect } from "./fixtures/app";

const ARTICLE_TITLE = "Hydration Test Article";
const ARTICLE_URL = "https://example.com/hydration-test";
const ARTICLE_BODY = "This body was fetched on demand and formatted inside Freed.";
const STORY_AUTHOR = "Story Tester";
const X_TITLE = "Deployment confirmed";
const X_REPLY_TEXT = "The scale of this never stops being impressive.";
const X_REPLY_MEDIA = "https://pbs.twimg.com/media/reply-rocket.jpg";
const FB_TITLE = "Facebook post with real discussion";
const FB_REPLY_TEXT = "This is useful context from the Facebook thread.";
const FB_REPLY_MEDIA = "https://scontent.example/comment-image.jpg";
const IG_TITLE = "Instagram reel with comments";
const IG_REPLY_TEXT = "This reply belongs in the Freed reader.";
const IG_REPLY_MEDIA = "https://cdninstagram.example/comment-frame.jpg";
const STORY_REPLY_MESSAGE = "Story replies are private on this platform. Open the story to reply there.";

async function injectItems(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    async ({ articleTitle, articleUrl, storyAuthor, xTitle, fbTitle, igTitle }) => {
      const now = Date.now();
      const w = window as Record<string, unknown>;
      const automerge = w.__FREED_AUTOMERGE__ as {
        docBatchImportItems: (items: unknown[]) => Promise<unknown>;
      };

      await automerge.docBatchImportItems([
        {
          globalId: "rss:reader-hydration",
          platform: "rss",
          contentType: "article",
          capturedAt: now,
          publishedAt: now,
          author: { id: "rss-author", handle: "rss-author", displayName: "RSS Author" },
          content: {
            text: "Short preview only.",
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: {
              url: articleUrl,
              title: articleTitle,
              description: "Short preview only.",
            },
          },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          rssSource: {
            feedUrl: "https://example.com/feed.xml",
            feedTitle: "Hydration Feed",
          },
          sourceUrl: articleUrl,
        },
        {
          globalId: "ig:story-expired",
          platform: "instagram",
          contentType: "story",
          capturedAt: now - 1_000,
          publishedAt: now - 1_000,
          author: { id: "story-author", handle: "story_author", displayName: storyAuthor },
          content: {
            text: "",
            mediaUrls: [],
            mediaTypes: [],
          },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          sourceUrl: "https://www.instagram.com/stories/story_author/1",
        },
        {
          globalId: "x:2048427420",
          platform: "x",
          contentType: "post",
          capturedAt: now - 2_000,
          publishedAt: now - 2_000,
          author: { id: "spacex", handle: "SpaceX", displayName: "SpaceX" },
          content: {
            text: xTitle,
            mediaUrls: [],
            mediaTypes: [],
          },
          engagement: { likes: 4200, reposts: 509, comments: 389, views: 525200 },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          sourceUrl: "https://x.com/SpaceX/status/2048427420",
        },
        {
          globalId: "facebook:post-discussion",
          platform: "facebook",
          contentType: "post",
          capturedAt: now - 3_000,
          publishedAt: now - 3_000,
          author: { id: "fb-author", handle: "fb-author", displayName: "Facebook Author" },
          content: {
            text: fbTitle,
            mediaUrls: [],
            mediaTypes: [],
          },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          sourceUrl: "https://www.facebook.com/fb-author/posts/123",
        },
        {
          globalId: "instagram:reel-discussion",
          platform: "instagram",
          contentType: "video",
          capturedAt: now - 4_000,
          publishedAt: now - 4_000,
          author: { id: "ig-author", handle: "ig_author", displayName: "Instagram Author" },
          content: {
            text: igTitle,
            mediaUrls: [],
            mediaTypes: [],
          },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          sourceUrl: "https://www.instagram.com/reel/ABC123/",
        },
        {
          globalId: "fb:story-cached",
          platform: "facebook",
          contentType: "story",
          capturedAt: now - 5_000,
          publishedAt: now - 5_000,
          author: { id: "fb-story-author", handle: "fb_story", displayName: "Facebook Story Author" },
          content: {
            text: "",
            mediaUrls: ["https://scontent.example/story.jpg"],
            mediaTypes: ["image"],
          },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          sourceUrl: "https://www.facebook.com/stories/fb_story/123",
        },
        {
          globalId: "ig:story-cached",
          platform: "instagram",
          contentType: "story",
          capturedAt: now - 6_000,
          publishedAt: now - 6_000,
          author: { id: "ig-story-author", handle: "ig_story", displayName: "Instagram Story Author" },
          content: {
            text: "",
            mediaUrls: ["https://cdninstagram.example/story.jpg"],
            mediaTypes: ["image"],
          },
          userState: { hidden: false, saved: false, archived: false, tags: [] },
          topics: [],
          sourceUrl: "https://www.instagram.com/stories/ig_story/123",
        },
      ]);
    },
    {
      articleTitle: ARTICLE_TITLE,
      articleUrl: ARTICLE_URL,
      storyAuthor: STORY_AUTHOR,
      xTitle: X_TITLE,
      fbTitle: FB_TITLE,
      igTitle: IG_TITLE,
    },
  );
}

test("uncached online articles hydrate in the reader and reopen from cache offline", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler(
    "fetch_url",
    () => "<html><body><article><h1>Hydrated Article</h1><p>This body was fetched on demand and formatted inside Freed.</p></article></body></html>",
  );
  await injectItems(app.page);

  await app.page.locator("article").filter({ hasText: ARTICLE_TITLE }).first().click();
  await expect(app.page.getByText(ARTICLE_BODY)).toBeVisible();

  await app.page.getByLabel("Back").click();
  await app.page.evaluate(() => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
  });
  await ipc.setHandler("fetch_url", () => {
    throw new Error("fetch_url should not be needed for cached reader content");
  });

  await app.page.locator("article").filter({ hasText: ARTICLE_TITLE }).first().click();
  await expect(app.page.getByText(ARTICLE_BODY)).toBeVisible();
  await expect(app.page.getByText("Connect to the internet")).toHaveCount(0);
});

test("expired stories show a precise reader state", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await injectItems(app.page);

  await app.page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { setSelectedItem: (id: string) => void };
    };
    store.getState().setSelectedItem("ig:story-expired");
  });
  await expect(
    app.page.getByText("This story media was not captured before the source expired it."),
  ).toBeVisible();
  await expect(app.page.getByText("Connect to the internet")).toHaveCount(0);
});

test("X post reader hydration renders replies with media", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("x_api_request", () =>
    JSON.stringify({
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "2048427420",
                          core: {
                            user_results: {
                              result: {
                                __typename: "User",
                                rest_id: "34743251",
                                legacy: {
                                  id_str: "34743251",
                                  name: "SpaceX",
                                  screen_name: "SpaceX",
                                  followers_count: 1,
                                  friends_count: 1,
                                  statuses_count: 1,
                                  profile_image_url_https: "https://pbs.twimg.com/profile_images/spacex_normal.jpg",
                                  created_at: "Mon Apr 20 12:00:00 +0000 2009",
                                },
                              },
                            },
                          },
                          legacy: {
                            id_str: "2048427420",
                            full_text: "Deployment confirmed",
                            created_at: "Sun Apr 26 15:42:00 +0000 2026",
                            favorite_count: 4200,
                            retweet_count: 509,
                            reply_count: 389,
                            quote_count: 49,
                            conversation_id_str: "2048427420",
                            is_quote_status: false,
                            lang: "en",
                            entities: { urls: [], hashtags: [], user_mentions: [] },
                          },
                          views: { count: "525200", state: "EnabledWithCount" },
                        },
                      },
                    },
                  },
                },
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "2048427999",
                          core: {
                            user_results: {
                              result: {
                                __typename: "User",
                                rest_id: "1001",
                                legacy: {
                                  id_str: "1001",
                                  name: "Reply Pilot",
                                  screen_name: "ReplyPilot",
                                  followers_count: 1,
                                  friends_count: 1,
                                  statuses_count: 1,
                                  profile_image_url_https: "https://pbs.twimg.com/profile_images/reply_normal.jpg",
                                  created_at: "Mon Apr 20 12:00:00 +0000 2009",
                                },
                              },
                            },
                          },
                          legacy: {
                            id_str: "2048427999",
                            full_text: "The scale of this never stops being impressive. pic.twitter.com/reply",
                            created_at: "Sun Apr 26 16:02:00 +0000 2026",
                            favorite_count: 9,
                            retweet_count: 1,
                            reply_count: 0,
                            quote_count: 0,
                            conversation_id_str: "2048427420",
                            in_reply_to_status_id_str: "2048427420",
                            in_reply_to_screen_name: "SpaceX",
                            is_quote_status: false,
                            lang: "en",
                            entities: {
                              urls: [],
                              hashtags: [],
                              user_mentions: [],
                              media: [
                                {
                                  id_str: "media-1",
                                  media_url_https: "https://pbs.twimg.com/media/reply-rocket.jpg",
                                  url: "pic.twitter.com/reply",
                                  expanded_url: "https://x.com/ReplyPilot/status/2048427999/photo/1",
                                  display_url: "pic.twitter.com/reply",
                                  indices: [53, 75],
                                  type: "photo",
                                },
                              ],
                            },
                            extended_entities: {
                              media: [
                                {
                                  id_str: "media-1",
                                  media_url_https: "https://pbs.twimg.com/media/reply-rocket.jpg",
                                  url: "pic.twitter.com/reply",
                                  expanded_url: "https://x.com/ReplyPilot/status/2048427999/photo/1",
                                  display_url: "pic.twitter.com/reply",
                                  indices: [53, 75],
                                  type: "photo",
                                },
                              ],
                            },
                          },
                          views: { count: "236", state: "EnabledWithCount" },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await injectItems(app.page);
  await app.page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        setXAuth: (auth: { isAuthenticated: boolean; cookies: { ct0: string; authToken: string } }) => void;
      };
    };
    store.getState().setXAuth({ isAuthenticated: true, cookies: { ct0: "csrf", authToken: "auth" } });
  });

  await app.page.locator("article").filter({ hasText: X_TITLE }).first().click();
  await expect(app.page.getByText("Replies")).toBeVisible();
  await expect(app.page.getByText(X_REPLY_TEXT)).toBeVisible();
  await expect(app.page.locator(`img[src="${X_REPLY_MEDIA}:large"]`)).toBeVisible();
});

test("Facebook post reader hydration renders inline comments with media", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("fb_scrape_comments", () => ({
    comments: [
      {
        id: "fb-comment-1",
        authorName: "Facebook Reader",
        authorHandle: "fb_reader",
        text: "This is useful context from the Facebook thread.",
        mediaUrls: ["https://scontent.example/comment-image.jpg"],
        mediaTypes: ["image"],
        engagement: { likes: 12 },
      },
    ],
    extractedAt: Date.now(),
    url: "https://www.facebook.com/fb-author/posts/123",
    candidateCount: 1,
  }));
  await injectItems(app.page);

  await app.page.locator("article").filter({ hasText: FB_TITLE }).first().click();
  await expect
    .poll(async () => (await ipc.invocations()).some((call) => call.cmd === "fb_scrape_comments"))
    .toBe(true);
  await expect(app.page.getByText("Replies")).toBeVisible();
  await expect(app.page.getByText(FB_REPLY_TEXT)).toBeVisible();
  await expect(app.page.locator(`img[src="${FB_REPLY_MEDIA}"]`)).toBeVisible();
});

test("Instagram reader hydration renders post comments inside Freed", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("ig_scrape_comments", () => ({
    comments: [
      {
        id: "ig-comment-1",
        authorName: "Instagram Reader",
        authorHandle: "ig_reader",
        text: "This reply belongs in the Freed reader.",
        mediaUrls: ["https://cdninstagram.example/comment-frame.jpg"],
        mediaTypes: ["image"],
        engagement: { likes: 7 },
      },
    ],
    extractedAt: Date.now(),
    url: "https://www.instagram.com/reel/ABC123/",
    candidateCount: 1,
  }));
  await injectItems(app.page);

  await app.page.locator("article").filter({ hasText: IG_TITLE }).first().click();
  await expect
    .poll(async () => (await ipc.invocations()).some((call) => call.cmd === "ig_scrape_comments"))
    .toBe(true);
  await expect(app.page.getByText("Replies")).toBeVisible();
  await expect(app.page.getByText(IG_REPLY_TEXT)).toBeVisible();
  await expect(app.page.locator(`img[src="${IG_REPLY_MEDIA}"]`)).toBeVisible();
});

test("narrow desktop reader keeps rail gutters even and open action furthest right", async ({ app }) => {
  await app.page.setViewportSize({ width: 700, height: 900 });
  await app.goto();
  await app.waitForReady();
  await injectItems(app.page);

  const feedCard = app.page.locator('[data-feed-item-id="rss:reader-hydration"]');
  await expect(feedCard).toBeVisible();

  await expect.poll(async () =>
    app.page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement | null;
      const card = document.querySelector('[data-feed-item-id="rss:reader-hydration"]') as HTMLElement | null;
      if (!main || !card) return null;

      const feedCardGap = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue("--feed-card-gap"));
      const mainRect = main.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return {
        left: Math.round(cardRect.left - mainRect.left),
        right: Math.round(mainRect.right - cardRect.right),
        expected: Math.round(feedCardGap),
      };
    }),
  ).toMatchObject({ left: 8, right: 8, expected: 8 });

  await app.page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { setSelectedItem: (id: string) => void };
    };
    store.getState().setSelectedItem("fb:story-cached");
  });

  await expect(app.page.getByTestId("reader-article")).toBeVisible();
  await expect(app.page.getByRole("button", { name: "Open", exact: true })).toBeVisible();

  await expect.poll(async () =>
    app.page.evaluate(() => {
      const article = document.querySelector('[data-testid="reader-article"]') as HTMLElement | null;
      const storyMedia = document.querySelector('img[src="https://scontent.example/story.jpg"]') as HTMLElement | null;
      const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
      const openButton = toolbar?.querySelector('[aria-label="Open"]') as HTMLElement | null;
      const overflowButton = toolbar?.querySelector('[aria-label="More actions"]') as HTMLElement | null;
      if (!article || !storyMedia || !toolbar || !openButton || !overflowButton) return null;

      const feedCardGap = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue("--feed-card-gap"));
      const articleRect = article.getBoundingClientRect();
      const mediaRect = storyMedia.getBoundingClientRect();
      const openRect = openButton.getBoundingClientRect();
      const overflowRect = overflowButton.getBoundingClientRect();
      return {
        readerLeft: Math.round(mediaRect.left - articleRect.left),
        readerRight: Math.round(articleRect.right - mediaRect.right),
        expected: Math.round(feedCardGap),
        openAfterOverflow: openRect.left >= overflowRect.right,
        openRightmost: openRect.right >= overflowRect.right,
        openHeight: Math.round(openRect.height),
        overflowHeight: Math.round(overflowRect.height),
        openTop: Math.round(openRect.top),
        overflowTop: Math.round(overflowRect.top),
      };
    }),
  ).toMatchObject({
    readerLeft: 8,
    readerRight: 8,
    expected: 8,
    openAfterOverflow: true,
    openRightmost: true,
    openHeight: 40,
    overflowHeight: 40,
  });
});

test("Facebook and Instagram stories show that story replies stay private", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await injectItems(app.page);

  await app.page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { setSelectedItem: (id: string) => void };
    };
    store.getState().setSelectedItem("fb:story-cached");
  });

  await expect(app.page.getByText(STORY_REPLY_MESSAGE)).toBeVisible();
  await app.page.getByRole("button", { name: "Open the story" }).click();
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toBe(
    "https://www.facebook.com/stories/fb_story/123",
  );
  await expect(app.page.getByText("Connect to the internet")).toHaveCount(0);

  await app.page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { setSelectedItem: (id: string) => void };
    };
    store.getState().setSelectedItem("ig:story-cached");
  });

  await expect(app.page.getByText(STORY_REPLY_MESSAGE)).toBeVisible();
  await app.page.getByRole("button", { name: "Open the story" }).click();
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toBe(
    "https://www.instagram.com/stories/ig_story/123",
  );
  await expect(app.page.getByText("Connect to the internet")).toHaveCount(0);
});
