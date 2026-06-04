import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

type SavedSortMode = "date_saved" | "date_published" | "recommended" | "shortest_read";

const SAVED_SORT_ITEM_IDS = [
  "rss:https://saved-sort.example/feed.xml:saved-newest",
  "rss:https://saved-sort.example/feed.xml:published-newest",
  "rss:https://saved-sort.example/feed.xml:recommended-top",
  "rss:https://saved-sort.example/feed.xml:shortest-read",
] as const;

async function seedSavedSortItems(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        setFilter: (filter: { savedOnly: true }) => void;
        updatePreferences: (update: unknown) => Promise<void>;
      };
    };
    const now = Date.now();
    const feedUrl = "https://saved-sort.example/feed.xml";
    const base = {
      platform: "rss",
      contentType: "article",
      capturedAt: now,
      author: {
        id: "saved-sort-feed",
        handle: "saved-sort-feed",
        displayName: "Saved Sort Feed",
      },
      content: {
        text: "Saved sort fixture article.",
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: {
          url: "https://saved-sort.example/article",
          description: "A saved sorting fixture.",
        },
      },
      topics: [],
      rssSource: {
        feedUrl,
        feedTitle: "Saved Sort Feed",
      },
    };

    await automerge.docBatchImportItems([
      {
        ...base,
        globalId: "rss:https://saved-sort.example/feed.xml:saved-newest",
        publishedAt: now - 10 * 86_400_000,
        content: {
          ...base.content,
          linkPreview: { ...base.content.linkPreview, title: "Date saved wins" },
        },
        preservedContent: {
          text: "Date saved wins.",
          wordCount: 900,
          readingTime: 9,
          preservedAt: now,
        },
        userState: { hidden: false, saved: true, savedAt: now - 86_400_000, archived: false, tags: [] },
      },
      {
        ...base,
        globalId: "rss:https://saved-sort.example/feed.xml:published-newest",
        publishedAt: now - 86_400_000,
        content: {
          ...base.content,
          linkPreview: { ...base.content.linkPreview, title: "Date published wins" },
        },
        preservedContent: {
          text: "Date published wins.",
          wordCount: 500,
          readingTime: 5,
          preservedAt: now,
        },
        userState: { hidden: false, saved: true, savedAt: now - 4 * 86_400_000, archived: false, tags: [] },
      },
      {
        ...base,
        globalId: "rss:https://saved-sort.example/feed.xml:recommended-top",
        publishedAt: now - 5 * 86_400_000,
        content: {
          ...base.content,
          linkPreview: { ...base.content.linkPreview, title: "Recommended wins" },
        },
        preservedContent: {
          text: "Recommended wins.",
          wordCount: 300,
          readingTime: 3,
          preservedAt: now,
        },
        userState: { hidden: false, saved: true, savedAt: now - 3 * 86_400_000, archived: false, tags: [] },
      },
      {
        ...base,
        globalId: "rss:https://saved-sort.example/feed.xml:shortest-read",
        publishedAt: now - 7 * 86_400_000,
        content: {
          ...base.content,
          linkPreview: { ...base.content.linkPreview, title: "Shortest read wins" },
        },
        preservedContent: {
          text: "Shortest read wins.",
          wordCount: 100,
          readingTime: 1,
          preservedAt: now,
        },
        userState: { hidden: false, saved: true, savedAt: now - 2 * 86_400_000, archived: false, tags: [] },
      },
    ]);
    await store.getState().updatePreferences({
      display: { savedContentSortMode: "date_saved" },
    });
    store.getState().setFilter({ savedOnly: true });
  });

  await expect(page.locator('[data-feed-item-id="rss:https://saved-sort.example/feed.xml:saved-newest"]')).toBeVisible();
}

async function visibleSavedSortIds(page: Page): Promise<string[]> {
  return page.locator('[data-feed-item-id^="rss:https://saved-sort.example/feed.xml"]').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute("data-feed-item-id"))
      .filter((id): id is string => Boolean(id)),
  );
}

async function expectFirstSavedSortItem(page: Page, id: (typeof SAVED_SORT_ITEM_IDS)[number]): Promise<void> {
  await expect.poll(() => visibleSavedSortIds(page)).toEqual(expect.arrayContaining([...SAVED_SORT_ITEM_IDS]));
  await expect.poll(async () => (await visibleSavedSortIds(page))[0]).toBe(id);
}

test("Saved content can sort by saved date, published date, recommendations, and read time", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedSavedSortItems(page);

  const sortSelect = page.getByTestId("saved-sort-select");
  await expect(page.getByTestId("saved-sort-control")).toBeVisible();
  await expect(sortSelect).toHaveValue("date_saved");
  await expect(page.getByTestId("feed-signal-filter-button")).toBeVisible();

  await expectFirstSavedSortItem(page, "rss:https://saved-sort.example/feed.xml:saved-newest");

  await sortSelect.selectOption("date_published");
  await expectFirstSavedSortItem(page, "rss:https://saved-sort.example/feed.xml:published-newest");

  await expect(sortSelect.locator("option")).toContainText([
    "Date saved",
    "Date published",
    "Recommended",
    "Shortest read",
  ]);
  await sortSelect.selectOption("recommended");
  await expect(sortSelect).toHaveValue("recommended");

  await sortSelect.selectOption("shortest_read");
  await expectFirstSavedSortItem(page, "rss:https://saved-sort.example/feed.xml:shortest-read");
});

test("Saved sort collapses into the mobile filter menu", async ({ app, page }) => {
  await page.setViewportSize({ width: 430, height: 720 });
  await app.goto();
  await app.waitForReady();
  await seedSavedSortItems(page);

  await expect(page.getByTestId("saved-sort-control")).toHaveCount(0);
  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible({ timeout: 5_000 });
  await filterButton.click();

  const filterMenu = page.getByTestId("feed-signal-filter-menu");
  await expect(filterMenu.getByText("Sort", { exact: true })).toBeVisible();
  const sortSection = filterMenu.getByText("Sort", { exact: true }).locator("..");
  const sortControl = filterMenu.getByTestId("saved-sort-control");
  const sortSelect = filterMenu.getByTestId("saved-sort-select");
  await expect(sortSelect).toBeVisible();

  const menuGeometry = await sortSection.evaluate((section) => {
    const control = section.querySelector('[data-testid="saved-sort-control"]') as HTMLElement | null;
    if (!control) throw new Error("Saved sort control is missing");
    const controlRect = control.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const sectionStyle = window.getComputedStyle(section);
    const horizontalPadding =
      Number.parseFloat(sectionStyle.paddingLeft) +
      Number.parseFloat(sectionStyle.paddingRight);
    return {
      controlWidth: Math.round(controlRect.width),
      contentWidth: Math.round(sectionRect.width - horizontalPadding),
    };
  });
  expect(menuGeometry.controlWidth).toBe(menuGeometry.contentWidth);

  await sortSelect.selectOption("date_published");
  await expect(sortControl).toBeVisible();
  await expectFirstSavedSortItem(page, "rss:https://saved-sort.example/feed.xml:published-newest");
});
