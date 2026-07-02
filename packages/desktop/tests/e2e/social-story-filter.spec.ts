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
  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible();
  await expect(page.getByTestId("feed-signal-filter-button")).toHaveCount(0);

  const filterBox = await filter.boundingBox();
  const filterButtonBox = await filterButton.boundingBox();
  expect(filterBox).not.toBeNull();
  expect(filterButtonBox).not.toBeNull();
  expect((filterButtonBox?.x ?? 0) - ((filterBox?.x ?? 0) + (filterBox?.width ?? 0))).toBeGreaterThanOrEqual(8);
  const toolbarControlHeights = await page.getByTestId("workspace-toolbar").evaluate((toolbar) => {
    const selectors = [
      '[data-testid="feed-toolbar-lens"]',
      '[data-testid="social-content-toolbar-filter"]',
      '[data-testid="mobile-toolbar-filter-button"]',
      '[data-testid="toolbar-overflow-button"]',
    ];

    return selectors.flatMap((selector) => {
      const element = toolbar.querySelector(selector) as HTMLElement | null;
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? [Math.round(rect.height)] : [];
    });
  });
  expect(toolbarControlHeights.length).toBeGreaterThanOrEqual(4);
  expect(new Set(toolbarControlHeights)).toEqual(new Set([36]));

  await filterButton.click();
  const filterMenu = page.getByTestId("feed-signal-filter-menu");
  await expect(filterMenu.getByText("Classification", { exact: true })).toBeVisible();
  await expect(filterMenu.getByRole("menuitemcheckbox", { name: /Everything/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filterMenu).toBeHidden();

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

test("toolbar segmented dividers match the control border", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await injectInstagramItems(page);

  await page.getByTestId("source-row-instagram").first().click();
  await expect(page.getByTestId("feed-toolbar-lens")).toBeVisible();
  await expect(page.getByTestId("social-content-toolbar-filter")).toBeVisible();

  const styles = await page.evaluate(() => {
    const controls = [
      document.querySelector('[data-testid="feed-toolbar-lens"]'),
      document.querySelector('[data-testid="social-content-toolbar-filter"]'),
    ].filter((control): control is HTMLElement => control instanceof HTMLElement);

    return controls.map((control) => {
      const controlStyle = window.getComputedStyle(control);
      const segments = Array.from(control.querySelectorAll<HTMLElement>(".theme-toolbar-segment"));
      return {
        borderColor: controlStyle.borderTopColor,
        activeShadows: segments
          .filter((segment) => segment.classList.contains("theme-toolbar-segment-active"))
          .map((segment) => window.getComputedStyle(segment).boxShadow),
        dividerColors: segments
          .slice(1)
          .map((segment) => window.getComputedStyle(segment, "::before").backgroundColor),
        dividerWidths: segments
          .slice(1)
          .map((segment) => window.getComputedStyle(segment, "::before").width),
      };
    });
  });

  expect(styles).toHaveLength(2);
  for (const style of styles) {
    expect(style.activeShadows).toEqual(["none"]);
    expect(new Set(style.dividerColors)).toEqual(new Set([style.borderColor]));
    expect(new Set(style.dividerWidths)).toEqual(new Set(["1px"]));
  }
});

test("mobile source toolbar collapses social and signal filters into one menu", async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.goto();
  await app.waitForReady();
  await injectInstagramItems(page);

  await page.getByTestId("source-row-instagram").first().click();
  await expect(page.getByTestId("social-content-toolbar-filter")).toBeHidden();
  await expect(page.getByTestId("feed-signal-filter-button")).toBeHidden();

  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible();
  await expect(filterButton).toHaveClass(/theme-toolbar-button-neutral/);
  await expect(filterButton).not.toHaveClass(/theme-toolbar-button-ghost/);

  await filterButton.click();
  const menu = page.getByTestId("feed-signal-filter-menu");
  await expect(menu).toBeVisible();

  const contentFilter = page.getByTestId("mobile-social-content-toolbar-filter");
  await expect(contentFilter.getByRole("button", { name: "All" })).toBeVisible();
  await expect(contentFilter.getByRole("button", { name: "Posts" })).toBeVisible();
  await expect(contentFilter.getByRole("button", { name: "Stories" })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: /Everything/ })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: /Inspiring/ })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: /Events/ })).toBeVisible();

  await contentFilter.getByRole("button", { name: "Stories" }).click();
  await expect(page.getByText("Instagram filter story item")).toBeVisible();
  await expect(page.getByText("Instagram filter post item")).toBeHidden();
  await expect(page.getByText("Instagram filter reel item")).toBeHidden();
});
