import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const SETTINGS_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/settings-store.ts",
  import.meta.url,
);

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
