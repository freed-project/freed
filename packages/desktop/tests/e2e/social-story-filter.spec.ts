import { test, expect } from "./fixtures/app";

async function injectInstagramItems(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const now = Date.now();
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };

    await automerge.docBatchImportItems([
      {
        globalId: "test-instagram-filter-post",
        platform: "instagram",
        contentType: "post",
        capturedAt: now - 30_000,
        publishedAt: now - 60_000,
        author: {
          id: "ig:social-filter",
          handle: "social.filter",
          displayName: "Social Filter",
        },
        content: {
          text: "Instagram filter post item",
          mediaUrls: [],
          mediaTypes: [],
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        sourceUrl: "https://www.instagram.com/p/social-filter-post/",
      },
      {
        globalId: "test-instagram-filter-video",
        platform: "instagram",
        contentType: "video",
        capturedAt: now - 20_000,
        publishedAt: now - 50_000,
        author: {
          id: "ig:social-filter",
          handle: "social.filter",
          displayName: "Social Filter",
        },
        content: {
          text: "Instagram filter reel item",
          mediaUrls: [],
          mediaTypes: [],
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        sourceUrl: "https://www.instagram.com/reel/social-filter-video/",
      },
      {
        globalId: "test-instagram-filter-story",
        platform: "instagram",
        contentType: "story",
        capturedAt: now - 10_000,
        publishedAt: now - 40_000,
        author: {
          id: "ig:social-filter",
          handle: "social.filter",
          displayName: "Social Filter",
        },
        content: {
          text: "Instagram filter story item",
          mediaUrls: ["https://cdn.example.com/social-filter-story.jpg"],
          mediaTypes: ["image"],
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        sourceUrl: "https://www.instagram.com/stories/social.filter/story/",
      },
    ]);
  });

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { items: Array<{ globalId: string }> } }
      | undefined;
    const ids = new Set(store?.getState().items.map((item) => item.globalId) ?? []);
    return ids.has("test-instagram-filter-post") && ids.has("test-instagram-filter-story");
  });
}

test("Instagram source toolbar filters posts, stories, and all items", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await injectInstagramItems(page);

  await page.getByTestId("source-row-instagram").first().click();
  const filter = page.getByTestId("social-content-toolbar-filter");
  await expect(filter).toBeVisible();

  await expect(page.getByText("Instagram filter post item")).toBeVisible();
  await expect(page.getByText("Instagram filter reel item")).toBeVisible();
  await expect(page.getByText("Instagram filter story item")).toBeVisible();

  await filter.getByRole("button", { name: "Stories" }).click();
  await expect(page.getByText("Instagram filter story item")).toBeVisible();
  await expect(page.getByText("Instagram filter post item")).toBeHidden();
  await expect(page.getByText("Instagram filter reel item")).toBeHidden();

  await filter.getByRole("button", { name: "Posts" }).click();
  await expect(page.getByText("Instagram filter post item")).toBeVisible();
  await expect(page.getByText("Instagram filter reel item")).toBeVisible();
  await expect(page.getByText("Instagram filter story item")).toBeHidden();

  await filter.getByRole("button", { name: "All" }).click();
  await expect(page.getByText("Instagram filter post item")).toBeVisible();
  await expect(page.getByText("Instagram filter reel item")).toBeVisible();
  await expect(page.getByText("Instagram filter story item")).toBeVisible();
});
