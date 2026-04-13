import type { Page } from "@playwright/test";
import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const SETTINGS_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/settings-store.ts",
  import.meta.url,
);

async function dismissCloudSyncNudgeIfPresent(page: Page) {
  const dismissButton = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }
}

test("switching themes in settings applies the selected theme immediately", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("appearance");
  }, SETTINGS_STORE_PATH);

  await expect(page.getByText("Appearance").first()).toBeVisible({ timeout: 5_000 });

  const initialThemeId = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(initialThemeId).toBe("neon");

  await page
    .locator("button")
    .filter({ has: page.getByText("Scriptorium", { exact: true }) })
    .first()
    .click();

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("scriptorium");

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { preferences: { display: { themeId: string } } } }
        | undefined;
      return store?.getState().preferences.display.themeId;
    });
  }).toBe("scriptorium");
});

test("theme switching repaints the app even before preferences finish saving", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("appearance");
  }, SETTINGS_STORE_PATH);

  await expect(page.getByText("Appearance").first()).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => { updatePreferences: (update: unknown) => Promise<void> };
      setState: (partial: unknown) => void;
    };
    store.setState({
      updatePreferences: async () => await new Promise<void>(() => {}),
    });
  });

  await page
    .locator("button")
    .filter({ has: page.getByText("Scriptorium", { exact: true }) })
    .first()
    .click();

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("scriptorium");

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { preferences: { display: { themeId: string } } } }
        | undefined;
      return store?.getState().preferences.display.themeId;
    });
  }).toBe("neon");
});

test("map view repaints across all themes without using the old canvas filter", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });

  const themeIds = ["neon", "ember", "midas", "scriptorium"] as const;

  for (const themeId of themeIds) {
    await page.evaluate(async (nextThemeId) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          updatePreferences: (update: { display: { themeId: string } }) => Promise<void>;
        };
      };

      await store.getState().updatePreferences({
        display: {
          themeId: nextThemeId,
        },
      });
    }, themeId);

    await expect.poll(async () => {
      return page.evaluate(() => document.documentElement.dataset.theme);
    }).toBe(themeId);

    await expect(page.getByTestId("map-surface")).toHaveAttribute("data-map-theme", themeId);
    await expect(page.locator(".freed-map-marker")).toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => {
      return page.evaluate(() => {
        const canvas = document.querySelector(".maplibregl-canvas");
        return canvas ? window.getComputedStyle(canvas).filter : "none";
      });
    }).toBe("none");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const styleTag = Array.from(document.querySelectorAll("style")).find((node) =>
          node.textContent?.includes(".freed-map-shell .maplibregl-map"),
        );
        return styleTag?.textContent?.includes("filter: var(--theme-map-canvas-filter)") ?? false;
      });
    }).toBe(false);

    await expect(page.getByTestId("map-surface")).toHaveScreenshot(`map-theme-${themeId}.png`, {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    });
  }
});
