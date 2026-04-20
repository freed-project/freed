import { test, expect } from "./fixtures/app";

test("switching release channels clears stale update state and rechecks the new channel", async ({
  app,
  page,
}) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const updatesNavButton = settingsDialog.getByRole("button", { name: /^Updates$/ });
  await expect(updatesNavButton).toBeVisible({ timeout: 3_000 });
  await updatesNavButton.click();

  await expect(page.getByRole("heading", { name: "Updates" }).last()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Installed version:")).toBeVisible();

  const releaseChannelSelect = page.getByTestId("settings-release-channel-select");
  await expect(releaseChannelSelect).toHaveValue("production");

  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByText("You're up to date")).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_BY_TARGET__ = {
      "production-darwin-aarch64": {
        version: "26.4.1800",
        body: "Production build available",
      },
    };
  });

  await releaseChannelSelect.selectOption("dev");
  await expect(releaseChannelSelect).toHaveValue("dev");

  await expect(page.getByText("You're up to date")).toHaveCount(0);
  await expect(
    settingsDialog.getByText("Update available on Production", { exact: true }),
  ).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => {
    return page.evaluate(() => {
      const calls = (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_CHECK_CALLS__ as
        | Array<{ target?: string } | null>
        | undefined;
      return (calls ?? [])
        .slice(-2)
        .map((call) => call?.target ?? null);
    });
  }).toEqual(["dev-darwin-aarch64", "production-darwin-aarch64"]);
});
