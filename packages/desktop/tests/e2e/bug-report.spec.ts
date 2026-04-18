import { test, expect } from "./fixtures/app";

test("fatal runtime errors show the crash reporting screen", async ({ app, ipc }) => {
  await app.goto("/");
  await app.waitForReady();

  await app.page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as
      | { setState: (next: { error: string; isInitialized: boolean }) => void }
      | undefined;
    store?.setState({
      error: "Synthetic fatal crash",
      isInitialized: false,
    });
  });

  await expect(app.page.getByText("Freed Desktop hit a fatal error")).toBeVisible();
  await expect(app.page.getByText("Export a crash report")).toBeVisible();
  await expect(app.page.getByText("Include screenshot of interface behind this bug report")).toHaveCount(0);
  await expect(app.page.getByRole("button", { name: "Download latest Freed Desktop" })).toBeVisible();
  await expect(app.page.getByRole("button", { name: "Open GitHub issue" })).toBeVisible();

  await app.page.getByRole("button", { name: "Download latest Freed Desktop" }).click();
  await expect.poll(async () => (await ipc.openedUrls())[0]).toBe("https://freed.wtf/get");
});

test("fatal recovery still surfaces available app updates", async ({ app }) => {
  await app.page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "26.4.1801-dev",
      body: "Fix startup recovery dead end",
    };
  });

  await app.goto("/");
  await app.waitForReady();

  await app.page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__FREED_STORE__ as
      | { setState: (next: { error: string; isInitialized: boolean }) => void }
      | undefined;
    store?.setState({
      error: "Synthetic fatal crash",
      isInitialized: false,
    });
  });

  await expect(app.page.getByText("Freed Desktop hit a fatal error")).toBeVisible();
  await expect(app.page.getByRole("button", { name: "Download & Install" })).toBeVisible({
    timeout: 2_000,
  });
});
