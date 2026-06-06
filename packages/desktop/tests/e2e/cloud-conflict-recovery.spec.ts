import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const DEBUG_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/debug-store.ts",
  import.meta.url,
);

async function seedAcceptedDesktopConsent(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:legal.json",
      JSON.stringify({
        "legal.bundle.desktop": {
          version: "2026-03-31.1",
          acceptedAt: 1775146800000,
          surface: "desktop-first-run",
        },
      }),
    );
  });
}

test("cloud conflict recovery click shows progress without a blocking browser confirm", async ({
  app,
  page,
  ipc,
}) => {
  await seedAcceptedDesktopConsent(page);

  await app.goto();
  await app.waitForReady();
  await ipc.setHandler("google_drive_request", () => new Promise(() => {}));

  await page.evaluate(async (debugStorePath) => {
    window.localStorage.setItem("freed_cloud_token_gdrive", "test-access-token");
    window.localStorage.setItem(
      "freed_cloud_token_meta_gdrive",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: Date.now() + 3_600_000,
      }),
    );
    window.localStorage.setItem("freed_cloud_token_dropbox", "");
    window.localStorage.removeItem("freed_cloud_token_meta_dropbox");
    (window as Window & { __cloudConflictConfirmCalls?: number }).__cloudConflictConfirmCalls = 0;
    window.confirm = () => {
      (window as Window & { __cloudConflictConfirmCalls?: number }).__cloudConflictConfirmCalls =
        ((window as Window & { __cloudConflictConfirmCalls?: number }).__cloudConflictConfirmCalls ?? 0) + 1;
      return true;
    };

    const debugMod = await import(debugStorePath);
    debugMod.useDebugStore.setState({
      docSnapshot: {
        deviceId: "device-1",
        itemCount: 10880,
        feedCount: 106,
        binarySize: 13_150_000,
        savedAt: Date.now(),
      },
      cloudProviders: {
        dropbox: { status: "idle" },
        gdrive: {
          status: "connected",
          stage: "idle",
          error: "Freed blocked a sync merge because it would remove too much feed history.",
          statusMessage: "Freed blocked a sync merge because it would remove too much feed history.",
          pendingReason: "Choose which copy should win before cloud sync retries.",
        },
      },
    });
  }, DEBUG_STORE_PATH);

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const nav = settingsDialog.locator("nav").first();
  await nav.getByRole("button", { name: "Sync", exact: true }).click();

  const recovery = settingsDialog.getByTestId("cloud-sync-conflict-recovery");
  await expect(recovery).toBeVisible({ timeout: 5_000 });
  const keepLocal = settingsDialog.getByTestId("cloud-sync-keep-local-button");
  await expect(keepLocal).toBeVisible();
  await keepLocal.click();

  await expect(settingsDialog.getByTestId("cloud-sync-keep-local-spinner")).toBeVisible({
    timeout: 1_000,
  });
  await expect(keepLocal).toBeDisabled();
  await expect(settingsDialog.getByTestId("cloud-sync-now-button")).toBeDisabled();
  await expect.poll(async () => {
    return page.evaluate(
      () => (window as Window & { __cloudConflictConfirmCalls?: number }).__cloudConflictConfirmCalls ?? 0,
    );
  }).toBe(0);
});
