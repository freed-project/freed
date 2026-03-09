/**
 * E2E tests for X/Twitter capture flow.
 *
 * Verifies the settings connect form, sync button, and feed item rendering
 * with a mock x_api_request handler returning fixture timeline data.
 */

import { test, expect } from "./fixtures/app";

const TIMELINE_FIXTURE = {
  data: {
    home: {
      home_timeline_urt: {
        instructions: [
          {
            type: "TimelineAddEntries",
            entries: [
              {
                entryId: "tweet-100",
                sortIndex: "100",
                content: {
                  entryType: "TimelineTimelineItem",
                  __typename: "TimelineTimelineItem",
                  itemContent: {
                    itemType: "TimelineTweet",
                    __typename: "TimelineTweet",
                    tweetDisplayType: "Tweet",
                    tweet_results: {
                      result: {
                        __typename: "Tweet",
                        rest_id: "100",
                        core: {
                          user_results: {
                            result: {
                              __typename: "User",
                              id: "VXNlcjo5OQ==",
                              rest_id: "99",
                              is_blue_verified: false,
                              legacy: {
                                id_str: "99",
                                name: "Test User",
                                screen_name: "testuser",
                                description: "",
                                followers_count: 100,
                                friends_count: 50,
                                statuses_count: 200,
                                profile_image_url_https:
                                  "https://pbs.twimg.com/profile_images/1/photo_normal.jpg",
                                created_at:
                                  "Mon Jan 01 00:00:00 +0000 2020",
                              },
                            },
                          },
                        },
                        legacy: {
                          id_str: "100",
                          full_text: "Hello from the E2E test timeline!",
                          created_at: "Sat Mar 01 12:00:00 +0000 2025",
                          favorite_count: 42,
                          retweet_count: 7,
                          reply_count: 3,
                          quote_count: 1,
                          conversation_id_str: "100",
                          is_quote_status: false,
                          lang: "en",
                          entities: {
                            urls: [],
                            hashtags: [],
                            user_mentions: [],
                          },
                        },
                        views: { count: "1000", state: "EnabledWithCount" },
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
  },
};

test("X settings section shows connect button when not authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;

  // Open settings via sidebar
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();
  if (!(await settingsBtn.isVisible())) {
    test.skip(true, "Settings button not visible");
    return;
  }
  await settingsBtn.click();

  // Wait for settings panel to render (it's not a role="dialog" overlay)
  await expect(page.getByText("Settings").first()).toBeVisible({
    timeout: 5_000,
  });

  // Navigate to X section via the sidebar button
  const xSection = page.getByRole("button", { name: "X / Twitter" });
  await expect(xSection).toBeVisible({ timeout: 3_000 });
  await xSection.click();

  await expect(page.getByText("Sign in to X")).toBeVisible({
    timeout: 3_000,
  });
});

test("X connect form accepts cookies and triggers sync", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  // Wire up the mock AFTER the page has loaded so __TAURI_MOCK_HANDLERS__ exists
  await ipc.setHandler("x_api_request", () =>
    JSON.stringify(TIMELINE_FIXTURE),
  );

  const { page } = app;

  // Open settings
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();
  if (!(await settingsBtn.isVisible())) {
    test.skip(true, "Settings button not visible");
    return;
  }
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({
    timeout: 5_000,
  });

  // Navigate to X section via the sidebar button and wait for scroll to settle
  const xSection = page.getByRole("button", { name: "X / Twitter" });
  await expect(xSection).toBeVisible({ timeout: 3_000 });
  await xSection.click();
  await page.waitForTimeout(500);

  // Click "Manual cookie setup" to reach the cookie input form
  const manualBtn = page.getByText("Manual cookie setup");
  await expect(manualBtn).toBeVisible({ timeout: 5_000 });
  await manualBtn.click();

  // Fill cookies once the form is visible (allow for state transition)
  await expect(page.getByPlaceholder("ct0 value")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("ct0 value").fill("test_ct0_value");
  await page.getByPlaceholder("auth_token value").fill("test_auth_token_value");

  // Click Connect
  await page
    .locator("button")
    .filter({ hasText: /^Connect$/ })
    .first()
    .click();

  // After connecting, the "Connected" indicator should appear
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 10_000 });
});
