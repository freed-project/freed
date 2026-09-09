import { test, expect } from "./fixtures/app";
import { generateDemoLibraryData } from "../../../shared/src/demo-data";

test("Saved shows all 50 sample bookmarks after browsing Friends", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  const data = generateDemoLibraryData({
    batchId: "sample-saved-scope",
    generatedAt: Date.now(),
    presentationSeed: 42,
  });
  const savedIds = data.items.filter((item) => item.userState.saved).map((item) => item.globalId);
  expect(savedIds).toHaveLength(50);
  await page.evaluate(async (sample) => {
    const store = (window as unknown as {
      __FREED_STORE__: {
        getState: () => { addSampleLibraryData: (data: typeof sample) => Promise<void> };
      };
    }).__FREED_STORE__;
    await store.getState().addSampleLibraryData(sample);
  }, data);
  await app.setDeviceDisplayPreferences({ friendsMode: "friends" });
  const savedRow = page.getByTestId("source-row-saved");
  await expect(savedRow.locator("..")).toContainText("50");
  await savedRow.click();
  await expect(page.getByRole("banner")).toContainText("Saved•50 items");
  await page.locator("[data-feed-item-id]").first().click();
  const back = page.getByTestId("workspace-toolbar-reader-back");
  const bookmark = page.getByRole("banner").getByRole("button", { name: "Unsave", exact: true });
  await page.setViewportSize({ width: 600, height: 850 });
  await expect(back).toHaveText("Saved");
  await expect(bookmark).toBeVisible();
  await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  await bookmark.hover();
  await expect(bookmark).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(bookmark).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(bookmark).toHaveCSS("box-shadow", "none");
  await page.setViewportSize({ width: 320, height: 850 });
  await expect(bookmark).toBeHidden();
  const activity = page.getByTestId("background-activity-trigger");
  const actions = page.getByTestId("toolbar-overflow-button");
  await expect.poll(async () => {
    const left = await activity.boundingBox();
    const right = await actions.boundingBox();
    return left && right ? right.x - left.x - left.width : 0;
  }).toBeGreaterThan(0);
  await actions.click();
  await expect(page.getByRole("menu")).toContainText("Remove bookmark");
  await actions.click();
  await page.setViewportSize({ width: 1280, height: 850 });
  await back.click();
  await expect(page.getByTestId("feed-toolbar-lens")).toBeHidden();
  await expect(page.locator("[data-feed-item-id]").first()).toBeVisible();
  const renderedIds = await page.locator("[data-feed-item-id]").evaluateAll(
    (cards) => cards.map((card) => card.getAttribute("data-feed-item-id")),
  );
  expect(renderedIds.length).toBeGreaterThan(0);
  expect(renderedIds.every((id) => savedIds.includes(id!))).toBe(true);
  await page.getByRole("button", { name: "Unified Feed", exact: true }).click();
  await expect(page.getByTestId("feed-toolbar-lens").getByRole("button", { name: "Friends", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await savedRow.click();
  await expect(page.getByRole("banner")).toContainText("Saved•50 items");
});

test("saved settings overview survives items arriving while open", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  const iconBtn = page.locator('[aria-label*="settings" i]').first();
  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;

  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await expect(settingsDialog).toBeVisible({ timeout: 5_000 });
  await settingsDialog.getByRole("button", { name: "Saved", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Saved Content", level: 3 })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("No saved items yet.")).toBeVisible();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const libraryCore = w.__FREED_LIBRARY_CORE__ as
      | { addLibraryFeedItems: (items: unknown[]) => Promise<void> }
      | undefined;

    if (!libraryCore) {
      throw new Error("Freed Library test API not found");
    }

    await libraryCore.addLibraryFeedItems([
      {
        globalId: "saved:e2e:arrives-while-open",
        platform: "saved",
        contentType: "article",
        capturedAt: Date.now(),
        publishedAt: Date.now(),
        author: {
          id: "saved",
          handle: "saved",
          displayName: "Saved",
        },
        content: {
          text: "A saved article added after the settings pane rendered.",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://example.com/saved",
            title: "Saved Article",
            description: "Saved while settings is open.",
          },
        },
        userState: {
          hidden: false,
          saved: true,
          savedAt: Date.now(),
          archived: false,
          tags: [],
        },
        topics: [],
      },
    ]);
  });

  await expect(page.getByText("Saved overview")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Freed Desktop hit a fatal error")).toBeHidden();
});

test("saved settings jump lands on readable content", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  const iconBtn = page.locator('[aria-label*="settings" i]').first();
  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;

  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const scrollContainer = page.getByTestId("settings-scroll-container");
  await expect(settingsDialog).toBeVisible({ timeout: 5_000 });

  await settingsDialog.getByRole("button", { name: "Saved", exact: true }).click();

  const heading = settingsDialog.getByRole("heading", { name: "Saved Content", level: 3 }).last();
  const emptyState = page.getByText("No saved items yet.");
  await expect(heading).toBeVisible();
  await expect(emptyState).toBeVisible();
});
