import type { Page } from "@playwright/test";
import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const SETTINGS_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/settings-store.ts",
  import.meta.url,
);

async function openStoryWallSettings(page: Page) {
  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("storyWall");
  }, SETTINGS_STORE_PATH);
  await expect(page.getByRole("button", { name: "Beta", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Story Wall", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI", exact: true })).toBeVisible();
  const aiBox = await page.getByRole("button", { name: "AI", exact: true }).boundingBox();
  const storyWallBox = await page.getByRole("button", { name: "Story Wall", exact: true }).boundingBox();
  expect(aiBox?.y ?? 0).toBeLessThan(storyWallBox?.y ?? Number.POSITIVE_INFINITY);
  await expect(page.getByRole("heading", { name: "Story Wall", exact: true })).toBeVisible({ timeout: 5_000 });
}

async function injectStoryWallMediaItem(page: Page) {
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => { items: Array<{ globalId: string }> };
    };
    const now = Date.now();
    const mediaUrl =
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20260%22%3E%3Crect%20width%3D%22400%22%20height%3D%22260%22%20fill%3D%22%23c46b45%22%2F%3E%3Ccircle%20cx%3D%22295%22%20cy%3D%2285%22%20r%3D%2252%22%20fill%3D%22%23f0d6b6%22%2F%3E%3Cpath%20d%3D%22M0%20235%20L120%20145%20L210%20215%20L295%20160%20L400%20230%20V260%20H0Z%22%20fill%3D%22%235b3b2f%22%2F%3E%3C%2Fsvg%3E";

    await automerge.docAddFeedItems([
      {
        globalId: "instagram:story-wall:media-1",
        platform: "instagram",
        contentType: "story",
        capturedAt: now,
        publishedAt: now,
        author: {
          id: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
        content: {
          text: "A real memory",
          mediaUrls: [mediaUrl],
          mediaTypes: ["image"],
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
        sourceUrl: "https://instagram.example/story/1",
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        if (store.getState().items.some((item) => item.globalId === "instagram:story-wall:media-1")) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("story wall media seed timeout"));
        }
      }, 50);
    });
  });
}

test("Story Wall style controls update the preview from settings", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(3, "https://story-wall.example/feed.xml");

  await expect(page.getByTestId("source-row-story-wall")).toHaveCount(0);
  await openStoryWallSettings(page);

  await expect(page.getByTestId("story-wall-disabled-gate")).toBeVisible();
  await expect(page.getByTestId("story-wall-preview")).toHaveCount(0);
  await expect(page.getByTestId("story-wall-layout-select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enable Story Wall" })).toHaveCount(1);

  await page.getByTestId("story-wall-disabled-gate").getByRole("button", { name: "Enable Story Wall" }).click();

  const preview = page.getByTestId("story-wall-preview");
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("story-wall-preview-tile")).toHaveCount(0);
  await expect(page.getByText("No media-backed memories yet.")).toBeVisible();

  await injectStoryWallMediaItem(page);
  await expect(page.getByTestId("story-wall-preview-tile").first()).toBeVisible();

  await page.getByTestId("story-wall-layout-select").selectOption("filmstrip");
  await expect(preview).toHaveAttribute("data-layout", "filmstrip");

  await page.getByTestId("story-wall-palette-select").selectOption("gallery");
  await expect(preview).toHaveAttribute("data-palette", "gallery");

  await page.getByTestId("story-wall-density").fill("0.95");
  await expect(preview).toHaveAttribute("data-density", "0.95");

  await page.getByLabel("Show captions").uncheck();
  await expect(page.getByTestId("story-wall-preview-tile").first()).not.toContainText("A real memory");
});

test("Story Wall archive import explains the Instagram export flow", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await openStoryWallSettings(page);
  await expect(page.getByTestId("story-wall-disabled-gate")).toBeVisible();

  await page.getByRole("button", { name: "Import Instagram archive" }).click();

  const modal = page.getByTestId("story-wall-archive-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Download your information");
  await expect(modal).toContainText("Request a ZIP export");
  await expect(modal).toContainText("Freed stores imported media in your local vault");

  await modal.getByRole("button", { name: "Close" }).click();
  await expect(modal).toBeHidden();
});
