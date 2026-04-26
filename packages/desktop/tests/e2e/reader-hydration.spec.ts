import { test, expect } from "./fixtures/app";

const ARTICLE_TITLE = "Hydration Test Article";
const ARTICLE_URL = "https://example.com/hydration-test";
const ARTICLE_BODY = "This body was fetched on demand and formatted inside Freed.";
const STORY_AUTHOR = "Story Tester";
const X_TITLE = "Deployment confirmed";
const X_REPLY_TEXT = "The scale of this never stops being impressive.";
const X_REPLY_MEDIA = "https://pbs.twimg.com/media/reply-rocket.jpg";

async function injectItems(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    async ({ articleTitle, articleUrl, storyAuthor, xTitle }) => {
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
      ]);
    },
    { articleTitle: ARTICLE_TITLE, articleUrl: ARTICLE_URL, storyAuthor: STORY_AUTHOR, xTitle: X_TITLE },
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
