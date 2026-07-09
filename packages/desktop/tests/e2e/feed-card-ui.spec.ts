import { test, expect } from "./fixtures/app";
import { fileURLToPath } from "node:url";

const FACEBOOK_TITLE = "Card UI Overhaul Facebook Item";
const RSS_TITLE = "Card UI Overhaul RSS Item";
const STORY_TITLE = "Story thumbnail proof";
const BROKEN_TITLE = "Broken thumbnail fallback proof";
const X_LIKE_TITLE = "X liked post retention proof";
const FACEBOOK_URL = "https://example.com/facebook/card-ui-overhaul";
const RSS_URL = "https://example.com/rss/card-ui-overhaul";
const X_LIKE_URL = "https://x.com/coindesk/status/2049705418436600244";
const FACEBOOK_MEDIA_URL = "/freed.svg?feed-card";
const STORY_MEDIA_URL = "/freed.svg?story-tile";
const BROKEN_MEDIA_URL = "/freed.svg?fallback";
const BUG_REPORT_STORE_PATH = `/@fs${fileURLToPath(new URL("../../../ui/src/lib/bug-report.ts", import.meta.url))}`;
const SETTINGS_STORE_PATH = `/@fs${fileURLToPath(new URL("../../../ui/src/lib/settings-store.ts", import.meta.url))}`;

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

async function injectXLikeRetentionItem(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    async ({ title, sourceUrl }) => {
      const now = Date.now();
      const w = window as Record<string, unknown>;
      const automerge = w.__FREED_AUTOMERGE__ as {
        docBatchImportItems: (items: unknown[]) => Promise<unknown>;
      };

      await automerge.docBatchImportItems([
        {
          globalId: "x:2049705418436600244",
          platform: "x",
          contentType: "post",
          capturedAt: now - 30_000,
          publishedAt: now - 60_000,
          author: {
            id: "coindesk",
            handle: "CoinDesk",
            displayName: "CoinDesk",
          },
          content: {
            text: "ICYMI: The U.S. Senate releases CLARITY Act compromise text.",
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: {
              url: sourceUrl,
              title,
              description: "A seeded X post used to prove like actions stay in Unified Feed.",
            },
          },
          engagement: {
            likes: 385,
            comments: 56,
          },
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            tags: [],
          },
          topics: ["testing"],
          sourceUrl,
        },
      ]);
    },
    {
      title: X_LIKE_TITLE,
      sourceUrl: X_LIKE_URL,
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

async function showStoriesFilter(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        setFilter: (filter: { socialContentFilter: "stories" }) => void;
      };
    };

    store.getState().setFilter({ socialContentFilter: "stories" });
  });
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
  const facebookImage = facebookCard.locator(`img[src="${FACEBOOK_MEDIA_URL}"]`).first();
  await expect(facebookImage).toHaveCount(0);

  const storyTile = app.page.locator('[data-feed-item-id="test-instagram-story-thumbnail"]');
  const storyImage = storyTile.locator(`img[src="${STORY_MEDIA_URL}"]`).first();
  await expect(storyImage).toBeVisible();

  const brokenCard = app.page.locator('[data-feed-item-id="test-broken-thumbnail-fallback"]');
  const brokenImage = brokenCard.locator("img").first();
  await expect(brokenImage).toHaveCount(0);
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
  const compactRailImage = compactRailCard.locator(`img[src="${FACEBOOK_MEDIA_URL}"]`).first();
  await expect(compactRailImage).toHaveCount(0);

  const openReaderButton = app.page.getByRole("button", { name: "Open", exact: true }).first();
  await expect(openReaderButton).toBeVisible();
});

test("story grid top padding aligns with the sidebar panel", async ({ app, page }) => {
  await page.setViewportSize({ width: 1412, height: 930 });
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(page);
  await showStoriesFilter(page);

  const storyTile = page.locator('[data-feed-item-id="test-instagram-story-thumbnail"]').first();
  await expect(storyTile).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("Stories");

  const geometry = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const story = document.querySelector('[data-feed-item-id="test-instagram-story-thumbnail"]') as HTMLElement | null;
    const rowContent = document.querySelector('[data-feed-row-index="0"] > div') as HTMLElement | null;
    if (!sidebar || !story || !rowContent) {
      throw new Error("Missing feed or sidebar geometry");
    }
    const sidebarStyle = window.getComputedStyle(sidebar);
    return {
      sidebarInnerTop: Math.round(
        sidebar.getBoundingClientRect().top + Number.parseFloat(sidebarStyle.borderTopWidth),
      ),
      storyTop: Math.round(story.getBoundingClientRect().top),
      rowPaddingTop: window.getComputedStyle(rowContent).paddingTop,
    };
  });

  expect(geometry.rowPaddingTop).toBe("9px");
  expect(geometry.storyTop).toBe(geometry.sidebarInnerTop);
});

test("feed card archive removes the visible card immediately", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(app.page);

  const card = app.page.locator('[data-feed-item-id="test-facebook-card-ui-overhaul"]').first();
  await expect(card).toBeVisible();

  const elapsedMs = await app.page.evaluate(async () => {
    const selector = '[data-feed-item-id="test-facebook-card-ui-overhaul"]';
    const cardElement = document.querySelector(selector) as HTMLElement | null;
    const archiveButton = cardElement?.querySelector('button[aria-label="Archive"]') as HTMLButtonElement | null;
    if (!archiveButton) {
      throw new Error("Archive button was not found");
    }

    const startedAt = performance.now();
    archiveButton.click();
    while (document.querySelector(selector)) {
      if (performance.now() - startedAt > 1_000) {
        throw new Error("Archived card stayed visible too long");
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return performance.now() - startedAt;
  });

  expect(elapsedMs).toBeLessThan(300);
  await expect(card).toHaveCount(0);
});

test("feed card archive rollback restores the visible card after a failed mutation", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(app.page);

  await app.page.evaluate(() => {
    (window as Window & {
      __FREED_FAIL_OPTIMISTIC_MUTATION__?: (source: string) => string | false;
    }).__FREED_FAIL_OPTIMISTIC_MUTATION__ = (source: string) =>
      source === "desktop:toggleArchived" ? "forced archive failure" : false;
  });

  const card = app.page.locator('[data-feed-item-id="test-facebook-card-ui-overhaul"]').first();
  await expect(card).toBeVisible();

  const archiveButton = card.locator('button[aria-label="Archive"]').first();
  await archiveButton.click({ force: true });

  await expect.poll(async () =>
    app.page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as
        | { getState: () => { items: Array<{ globalId: string; userState: { archived?: boolean } }> } }
        | undefined;
      const item = store?.getState().items.find((candidate) =>
        candidate.globalId === "test-facebook-card-ui-overhaul"
      );
      return item?.userState.archived ?? null;
    }),
  ).toBe(false);
  await expect(card).toBeVisible();

  const errorRecorded = await app.page.evaluate(async (bugReportStorePath) => {
    const mod = await import(bugReportStorePath);
    const events = mod.getRecentBugReportEvents() as Array<{ source?: string; level?: string; message?: string }>;
    return events.some((event) =>
      event.source === "desktop:toggleArchived" &&
      event.level === "error" &&
      event.message === "Optimistic mutation failed"
    );
  }, BUG_REPORT_STORE_PATH);
  expect(errorRecorded).toBe(true);
});

test("liking an X post keeps it in the unified feed", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("x_api_request", () => "{}");
  await injectXLikeRetentionItem(app.page);
  await setShowEngagementCounts(app.page, true);

  await app.page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        setXAuth: (auth: unknown) => void;
      };
    };
    store.getState().setXAuth({
      isAuthenticated: true,
      cookies: {
        ct0: "test-csrf",
        authToken: "test-auth",
      },
    });
  });

  const xCard = app.page.locator('[data-feed-item-id="x:2049705418436600244"]');
  await expect(xCard).toBeVisible();
  await expect(xCard).toContainText(X_LIKE_TITLE);
  await xCard.hover();

  await xCard.getByRole("button", { name: "Like", exact: true }).click();

  await expect(xCard).toBeVisible();
  await expect(xCard).toContainText(X_LIKE_TITLE);
  await expect(xCard.getByRole("button", { name: /Liked/ })).toBeVisible();
  await expect(xCard.getByRole("button", { name: "Liked on X" })).toBeVisible({
    timeout: 8_000,
  });
  await expect(xCard).toBeVisible();
  await expect(xCard).toContainText(X_LIKE_TITLE);

  const userState = await app.page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        items: Array<{
          globalId: string;
          userState: {
            archived: boolean;
            hidden: boolean;
            liked?: boolean;
            likedAt?: number;
            likedSyncedAt?: number;
          };
        }>;
      };
    };
    return store.getState().items.find((item) => item.globalId === "x:2049705418436600244")?.userState;
  });

  expect(userState).toMatchObject({
    archived: false,
    hidden: false,
    liked: true,
  });
  expect(userState?.likedAt).toEqual(expect.any(Number));
  expect(userState?.likedSyncedAt).toEqual(expect.any(Number));
});

test("filter menu card density slider persists locally", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("feed-card-density-test-started") === "1") return;
    window.sessionStorage.setItem("feed-card-density-test-started", "1");
    window.localStorage.removeItem("freed-feed-card-density");
  });
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(page);

  await expect(page.getByTestId("social-content-toolbar-filter")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("feed-toolbar-lens")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("feed-card-density-slider")).toHaveCount(0);

  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible({ timeout: 5_000 });
  await filterButton.click();

  const filterMenu = page.getByTestId("feed-signal-filter-menu");
  await expect(filterMenu.getByText("Format", { exact: true })).toHaveCount(0);
  await expect(filterMenu.getByText("Connections", { exact: true })).toHaveCount(0);
  await expect(filterMenu.getByText("Classification", { exact: true })).toBeVisible();
  const slider = filterMenu.getByTestId("feed-card-density-slider");
  const card = page.locator('[data-feed-item-id="test-facebook-card-ui-overhaul"]').first();

  await expect(slider).toBeVisible();
  await expect(card).toHaveAttribute("data-feed-card-density", "comfortable");
  const comfortableHeight = await card.evaluate((element) => element.getBoundingClientRect().height);

  await slider.focus();
  await slider.press("ArrowLeft");
  await expect(card).toHaveAttribute("data-feed-card-density", "compact");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("freed-feed-card-density"))).toBe("compact");
  const compactHeight = await card.evaluate((element) => element.getBoundingClientRect().height);

  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(card).toHaveAttribute("data-feed-card-density", "expansive");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("freed-feed-card-density"))).toBe("expansive");
  const expansiveHeight = await card.evaluate((element) => element.getBoundingClientRect().height);

  expect(compactHeight).toBeLessThan(comfortableHeight);
  expect(expansiveHeight).toBeGreaterThan(comfortableHeight);

  await page.reload();
  await app.waitForReady();
  await page.getByTestId("mobile-toolbar-filter-button").click();
  await expect(page.getByTestId("feed-signal-filter-menu").getByTestId("feed-card-density-slider")).toHaveValue("2");
});

test("filter menu interface zoom slider persists locally", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("interface-zoom-test-started") === "1") return;
    window.sessionStorage.setItem("interface-zoom-test-started", "1");
    window.localStorage.removeItem("freed-interface-zoom");
  });
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(page);

  const baseFontSize = await page.evaluate(() =>
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
  );
  const baseGeometry = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    if (!toolbar || !sidebar) {
      throw new Error("Workspace shell is missing");
    }
    return {
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      toolbarHeight: Math.round(toolbar.getBoundingClientRect().height),
    };
  });

  await page.getByTestId("mobile-toolbar-filter-button").click();
  const filterMenu = page.getByTestId("feed-signal-filter-menu");
  const zoomSlider = filterMenu.getByTestId("interface-zoom-slider");
  await expect(zoomSlider).toBeVisible();
  await expect(zoomSlider).toHaveAttribute("min", "75");
  await expect(zoomSlider).toHaveValue("100");
  await expect(filterMenu.getByTestId("interface-zoom-value")).toHaveText("100%");

  await zoomSlider.focus();
  for (let i = 0; i < 10; i += 1) {
    await zoomSlider.press("ArrowRight");
  }

  await expect(zoomSlider).toHaveValue("150");
  await expect(filterMenu.getByTestId("interface-zoom-value")).toHaveText("150%");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("freed-interface-zoom"))).toBe("150");
  await expect.poll(() => page.evaluate(() =>
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
  )).toBeGreaterThan(baseFontSize * 1.4);
  const zoomedGeometry = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    if (!toolbar || !sidebar) {
      throw new Error("Workspace shell is missing");
    }
    const clippedLabels = Array.from(document.querySelectorAll('[data-testid^="source-row-"] .truncate'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element) => (element.textContent?.trim().length ?? 0) > 1)
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent?.trim());
    return {
      clippedLabels,
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      toolbarHeight: Math.round(toolbar.getBoundingClientRect().height),
    };
  });
  expect(zoomedGeometry.sidebarWidth).toBeGreaterThan(baseGeometry.sidebarWidth * 1.4);
  expect(zoomedGeometry.toolbarHeight).toBeGreaterThan(baseGeometry.toolbarHeight * 1.4);
  expect(zoomedGeometry.clippedLabels).toEqual([]);

  await page.reload();
  await app.waitForReady();
  await expect.poll(() => page.evaluate(() =>
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
  )).toBeGreaterThan(baseFontSize * 1.4);

  await page.getByTestId("mobile-toolbar-filter-button").click();
  await expect(page.getByTestId("feed-signal-filter-menu").getByTestId("interface-zoom-slider")).toHaveValue("150");
});

test("filter menu stays visually stable while interface zoom is dragged", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.removeItem("freed-interface-zoom");
  });
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(page);

  const baseFontSize = await page.evaluate(() =>
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
  );

  await page.getByTestId("mobile-toolbar-filter-button").click();
  const filterMenu = page.getByTestId("feed-signal-filter-menu");
  const zoomControl = filterMenu.getByTestId("interface-zoom-control");
  const zoomSlider = filterMenu.getByTestId("interface-zoom-slider");
  await expect(zoomSlider).toHaveValue("100");

  const controlBox = await zoomControl.boundingBox();
  const menuBox = await filterMenu.boundingBox();
  const sliderBox = await zoomSlider.boundingBox();
  expect(controlBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(sliderBox).not.toBeNull();
  if (!controlBox || !menuBox || !sliderBox) {
    throw new Error("Interface zoom menu geometry is missing");
  }

  const startX = sliderBox.x + sliderBox.width * 0.2;
  const targetX = sliderBox.x + sliderBox.width * 0.72;
  const y = sliderBox.y + sliderBox.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 8 });

  await expect.poll(() => page.evaluate(() =>
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
  )).toBeGreaterThan(baseFontSize * 1.2);
  const draggedBox = await zoomControl.boundingBox();
  const draggedMenuBox = await filterMenu.boundingBox();
  expect(draggedBox).not.toBeNull();
  expect(draggedMenuBox).not.toBeNull();
  if (!draggedBox || !draggedMenuBox) {
    throw new Error("Interface zoom menu geometry disappeared while dragging");
  }
  expect(draggedBox.width).toBeGreaterThan(controlBox.width * 0.96);
  expect(draggedBox.width).toBeLessThan(controlBox.width * 1.04);
  expect(Math.abs(draggedMenuBox.x - menuBox.x)).toBeLessThan(2);
  expect(Math.abs(draggedMenuBox.y - menuBox.y)).toBeLessThan(2);
  expect(draggedMenuBox.width).toBeGreaterThan(menuBox.width * 0.99);
  expect(draggedMenuBox.width).toBeLessThan(menuBox.width * 1.01);

  await page.mouse.up();
});

test("appearance settings expose card density and interface zoom controls", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.addInitScript(() => {
    window.localStorage.removeItem("freed-feed-card-density");
    window.localStorage.removeItem("freed-interface-zoom");
  });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);

  const settingsControls = page.getByTestId("settings-display-scale-controls");
  await expect(settingsControls.getByText("Card density", { exact: true })).toBeVisible();
  await expect(settingsControls.getByText("Interface zoom", { exact: true })).toBeVisible();

  const densitySlider = settingsControls.getByTestId("feed-card-density-slider");
  await expect(densitySlider).toHaveValue("1");
  await densitySlider.focus();
  await densitySlider.press("ArrowLeft");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("freed-feed-card-density"))).toBe("compact");

  const baseFontSize = await page.evaluate(() =>
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
  );
  const zoomSlider = settingsControls.getByTestId("interface-zoom-slider");
  await expect(zoomSlider).toHaveValue("100");
  await zoomSlider.focus();
  for (let i = 0; i < 20; i += 1) {
    await zoomSlider.press("ArrowRight");
  }

  await expect(zoomSlider).toHaveValue("200");
  await expect(settingsControls.getByTestId("settings-interface-zoom-value")).toHaveText("200%");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("freed-interface-zoom"))).toBe("200");
  await expect.poll(() => page.evaluate(() =>
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize),
  )).toBeGreaterThan(baseFontSize * 1.9);
});

test("narrow desktop toolbar exposes card density slider in the filter menu", async ({ app, page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.addInitScript(() => {
    window.localStorage.removeItem("freed-feed-card-density");
  });
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(page);

  const card = page.locator('[data-feed-item-id="test-facebook-card-ui-overhaul"]').first();
  await expect(card).toHaveAttribute("data-feed-card-density", "comfortable");
  await expect(page.getByTestId("feed-card-density-slider")).toHaveCount(0);

  const overflowButton = page.getByTestId("toolbar-overflow-button");
  await expect(overflowButton).toBeVisible({ timeout: 5_000 });
  await overflowButton.click();
  const overflowMenu = page.getByTestId("toolbar-overflow-menu");
  await expect(overflowMenu.getByTestId("toolbar-overflow-density-section")).toHaveCount(0);
  await expect(overflowMenu.getByTestId("toolbar-overflow-actions-section").getByText("Actions", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible({ timeout: 5_000 });
  await filterButton.click();

  const filterMenu = page.getByTestId("feed-signal-filter-menu");
  const densitySection = filterMenu.getByTestId("feed-filter-density-section");
  const densityControl = filterMenu.getByTestId("feed-card-density-control");
  const slider = filterMenu.getByTestId("feed-card-density-slider");
  await expect(slider).toBeVisible();
  await expect(densitySection.getByText("Card density", { exact: true })).toBeVisible();

  const menuGeometry = await densitySection.evaluate((section) => {
    const control = section.querySelector('[data-testid="feed-card-density-control"]') as HTMLElement | null;
    if (!control) throw new Error("Density control is missing");
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

  await slider.focus();
  await slider.press("ArrowLeft");

  await expect(densityControl).toBeVisible();
  await expect(card).toHaveAttribute("data-feed-card-density", "compact");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("freed-feed-card-density"))).toBe("compact");
});

test("story cards participate in feed layout transitions", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await injectCardUiItems(app.page);
  await setDualColumnMode(app.page, true);

  await app.page.evaluate(() => {
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    const state = { count: 0 };
    (window as Record<string, unknown>).__FREED_STORY_VIEW_TRANSITIONS__ = state;

    Object.defineProperty(doc, "startViewTransition", {
      configurable: true,
      writable: true,
      value: (update: () => void) => {
        state.count += 1;
        update();
        return { finished: Promise.resolve() };
      },
    });
  });

  const storyTile = app.page.locator('[data-feed-item-id="test-instagram-story-thumbnail"]').first();
  await expect(storyTile).toBeVisible({ timeout: 5_000 });

  const transitionName = await storyTile.evaluate((element) =>
    window.getComputedStyle(element.parentElement as Element).viewTransitionName,
  );
  expect(transitionName).toBe("feed-card-test-instagram-story-thumbnail");

  await storyTile.click();
  await expect(app.page.getByTestId("compact-feed-panel-scroll-container")).toBeVisible({
    timeout: 5_000,
  });
  await expect(app.page.getByLabel("Back to list")).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => {
    return app.page.evaluate(() => {
      const state = (window as Record<string, unknown>).__FREED_STORY_VIEW_TRANSITIONS__ as
        | { count: number }
        | undefined;
      return state?.count ?? 0;
    });
  }).toBe(1);
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
