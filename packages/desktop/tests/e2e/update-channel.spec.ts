import { test, expect } from "./fixtures/app";

test("launch-time auto-check runs once after legal acceptance", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await expect.poll(async () => {
    return page.evaluate(() => {
      return (
        (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_CHECK_CALLS__ as Array<
          { target?: string } | null
        >
      )?.map((call) => call?.target ?? null) ?? [];
    });
  }).toEqual(["production-darwin-aarch64"]);
});

test("switching release channels clears stale update state and rechecks the new channel", async ({
  app,
  page,
  ipc,
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
  const installedVersionLabel = page.getByText(/^Installed version:/).last();
  await expect(installedVersionLabel).toBeVisible();
  const initialInstalledVersion = (await installedVersionLabel.textContent())
    ?.replace(/\s+/g, " ")
    .trim();
  expect(initialInstalledVersion).toBeTruthy();

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
  await expect(installedVersionLabel).toHaveText(initialInstalledVersion ?? "");

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

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as
      | { setState: (next: { error: string; isInitialized: boolean }) => void }
      | undefined;
    store?.setState({
      error: "Synthetic fatal crash",
      isInitialized: false,
    });
  });

  await expect(page.getByText("Freed Desktop hit a fatal error")).toBeVisible();
  await page.getByRole("button", { name: "Download latest Freed Desktop" }).click();
  await expect.poll(async () => (await ipc.openedUrls()).at(-1)).toBe(
    "https://dev.freed.wtf/api/downloads/mac-arm",
  );
});

test("selected release channel survives when browser storage is missing after relaunch", async ({
  app,
  page,
}) => {
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await settingsDialog.getByRole("button", { name: /^Updates$/ }).click();

  const releaseChannelSelect = page.getByTestId("settings-release-channel-select");
  await expect(releaseChannelSelect).toHaveValue("production");
  await releaseChannelSelect.selectOption("dev");
  await expect(releaseChannelSelect).toHaveValue("dev");

  await page.evaluate(() => {
    const mockStoreKey = "__TAURI_MOCK_STORE__:release-channel.json";
    const existing = JSON.parse(window.localStorage.getItem(mockStoreKey) ?? "{}") as Record<
      string,
      unknown
    >;
    window.localStorage.setItem(
      mockStoreKey,
      JSON.stringify({
        ...existing,
        channel: "dev",
        installedChannel: "dev",
      }),
    );
    window.localStorage.removeItem("freed-release-channel");
  });

  await page.reload();
  await app.waitForReady();

  await page.locator("button").filter({ hasText: /settings/i }).first().click();
  const reopenedSettingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await reopenedSettingsDialog.getByRole("button", { name: /^Updates$/ }).click();

  await expect(page.getByTestId("settings-release-channel-select")).toHaveValue("dev");
  await expect(reopenedSettingsDialog.getByText(/Installed version:\s*v26\.4\.2500-dev/)).toBeVisible();

  await page.getByTestId("settings-release-channel-select").selectOption("production");
  await expect(page.getByTestId("settings-release-channel-select")).toHaveValue("production");
  await expect(reopenedSettingsDialog.getByText(/Installed version:\s*v26\.4\.2500-dev/)).toBeVisible();
});
