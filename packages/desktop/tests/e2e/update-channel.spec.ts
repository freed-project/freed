import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const SETTINGS_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/settings-store.ts",
  import.meta.url,
);

test("switching release channels clears stale update state and rechecks the new channel", async ({
  app,
  page,
}) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("updates");
  }, SETTINGS_STORE_PATH);

  await expect(page.getByRole("heading", { name: "Updates" }).last()).toBeVisible({
    timeout: 5_000,
  });
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await expect(page.getByText("Installed version:")).toBeVisible();

  const releaseChannelSelect = page.getByTestId("settings-release-channel-select");
  await expect(releaseChannelSelect).toHaveValue("production");

  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByText("You're up to date")).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    (window as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "26.4.1501",
      body: "Dev build available",
    };
  });

  await releaseChannelSelect.selectOption("dev");

  await expect(page.getByText("You're up to date")).toHaveCount(0);
  await expect(settingsDialog.getByText("Update available on Dev", { exact: true })).toBeVisible({
    timeout: 5_000,
  });

  await expect.poll(async () => {
    return page.evaluate(() => {
      const args = (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_CHECK_ARGS__ as
        | { target?: string }
        | undefined;
      return args?.target ?? null;
    });
  }).toBe("dev-darwin-aarch64");
});
