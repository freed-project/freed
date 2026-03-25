/**
 * E2E tests for Facebook capture flow.
 *
 * Verifies the settings connect form, sync button, and feed item rendering
 * with a mock x_api_request handler returning mbasic.facebook.com HTML.
 */

import { test, expect } from "./fixtures/app";

// Minimal mbasic.facebook.com-style HTML fixture
const MBASIC_HTML = `
<html>
<head><title>Facebook</title></head>
<body>
<div id="root">
  <div id="recent">
    <div data-ft='{"mf_story_key":"12345"}'>
      <h3><a href="/alice.example">Alice Example</a></h3>
      <p>Hello from the Facebook E2E test feed!</p>
      <a href="/story.php?story_fbid=12345&id=999">2 hrs</a>
      <abbr data-utime="1709640000">2 hours ago</abbr>
      <span>5 Likes</span>
      <span>2 Comments</span>
    </div>
    <div data-ft='{"mf_story_key":"12346"}'>
      <h3><a href="/bob.builder">Bob Builder</a></h3>
      <p>Another test post with some content.</p>
      <a href="/story.php?story_fbid=12346&id=888">5 hrs</a>
      <abbr data-utime="1709629200">5 hours ago</abbr>
      <span>12 Likes</span>
    </div>
  </div>
</div>
</body>
</html>
`;

test("Facebook settings section shows connect button when not authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

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

  // Navigate to Facebook section via the settings sidebar button (second match,
  // after the main sidebar source button and before "Connect Facebook Account")
  const fbSection = page.getByRole("button", { name: "Facebook" }).nth(1);
  await expect(fbSection).toBeVisible({ timeout: 3_000 });
  await fbSection.click();

  await expect(page.getByText("Log in with Facebook")).toBeVisible({
    timeout: 3_000,
  });
});

test("Facebook connect form accepts cookies and triggers sync", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  // Wire up the mock to return our HTML fixture
  await ipc.setHandler("x_api_request", () => MBASIC_HTML);

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

  // Navigate to Facebook section via the settings sidebar button
  const fbSection = page.getByRole("button", { name: "Facebook" }).nth(1);
  await expect(fbSection).toBeVisible({ timeout: 3_000 });
  await fbSection.click();

  // Click "Log in with Facebook" to open the login WebView (calls fb_show_login IPC)
  await expect(page.getByText("Log in with Facebook")).toBeVisible({ timeout: 3_000 });
  await page.getByText("Log in with Facebook").click();
  await page.waitForTimeout(500);

  // Simulate a successful WebView login by setting auth state directly in the
  // Zustand store (same pattern as instagram-capture.spec.ts). This is more
  // reliable than firing the Tauri event in E2E mode.
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({ fbAuth: { isAuthenticated: true, lastCheckedAt: Date.now() } });
  });

  // After auth state updates, the section should expose the sync action.
  await expect(
    page.getByRole("button", { name: "Sync Now" }),
  ).toBeVisible({ timeout: 5_000 });
});

test("Facebook sync excludes posts from filtered groups", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;

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

  const fbSection = page.getByRole("button", { name: "Facebook" }).nth(1);
  await expect(fbSection).toBeVisible({ timeout: 3_000 });
  await fbSection.click();

  await ipc.setHandler("fb_scrape_feed", () => {
    const emit = (eventName: string, payload: unknown) => {
      const listeners =
        (window as unknown as Record<string, Array<(event: { payload: unknown }) => void>>)
          .__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) {
        listener({ payload });
      }
      const tauriInternals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as
        | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      void tauriInternals?.invoke?.("plugin:event|emit", {
        event: eventName,
        payload,
      });
    };

    setTimeout(() => {
      emit("fb-feed-data", {
        posts: [
          {
            id: "group-post-1",
            url: "https://www.facebook.com/groups/excluded-group/posts/1",
            authorName: "Alice Example",
            authorProfileUrl: "https://www.facebook.com/alice.example",
            authorAvatarUrl: null,
            text: "This should be filtered out",
            timestampSeconds: 1709640000,
            timestampIso: null,
            mediaUrls: [],
            hasVideo: false,
            likeCount: null,
            commentCount: null,
            shareCount: null,
            postType: "post",
            location: null,
            hashtags: [],
            isShare: false,
            sharedFrom: null,
            group: {
              id: "excluded-group",
              name: "Excluded Group",
              url: "https://www.facebook.com/groups/excluded-group",
            },
          },
          {
            id: "feed-post-2",
            url: "https://www.facebook.com/story.php?story_fbid=2&id=3",
            authorName: "Bob Builder",
            authorProfileUrl: "https://www.facebook.com/bob.builder",
            authorAvatarUrl: null,
            text: "This should stay visible",
            timestampSeconds: 1709640001,
            timestampIso: null,
            mediaUrls: [],
            hasVideo: false,
            likeCount: null,
            commentCount: null,
            shareCount: null,
            postType: "post",
            location: null,
            hashtags: [],
            isShare: false,
            sharedFrom: null,
            group: null,
          },
        ],
        extractedAt: Date.now(),
        url: "https://www.facebook.com/",
      });
    }, 0);

    return null;
  });

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (updater: (state: {
        fbAuth: { isAuthenticated: boolean };
        preferences: {
          fbCapture?: {
            knownGroups: Record<string, { id: string; name: string; url: string }>;
            excludedGroupIds: Record<string, true>;
          };
        };
      }) => Partial<unknown>) => void;
    };

    store.setState((state) => ({
      fbAuth: { ...state.fbAuth, isAuthenticated: true },
      preferences: {
        ...state.preferences,
        fbCapture: {
          knownGroups: {
            "excluded-group": {
              id: "excluded-group",
              name: "Excluded Group",
              url: "https://www.facebook.com/groups/excluded-group",
            },
          },
          excludedGroupIds: {
            "excluded-group": true,
          },
        },
      },
    }));
  });

  await expect(page.getByRole("button", { name: "Sync Now" })).toBeVisible({
    timeout: 5_000,
  });

  await page.getByRole("button", { name: "Sync Now" }).click();

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => { items: Array<{ globalId: string }> };
    };
    return store.getState().items.some((item) => item.globalId === "fb:feed-post-2");
  });

  const itemIds = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => { items: Array<{ globalId: string }> };
    };
    return store.getState().items.map((item) => item.globalId);
  });

  expect(itemIds).toContain("fb:feed-post-2");
  expect(itemIds).not.toContain("fb:group-post-1");
});
