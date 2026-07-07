import { test, expect } from "./fixtures/app";

test("startup recovery checks immediately and opens the channel-aware fallback download", async ({
  app,
  page,
  ipc,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("freed-release-channel", "dev");
  });
  await app.page.goto("/startup-recovery.html?releaseChannel=dev");

  await expect(page.getByText("Freed did not finish loading last time.")).toBeVisible();
  await expect.poll(async () => {
    return page.evaluate(() => {
      return (
        (window as Record<string, unknown>).__TAURI_MOCK_UPDATE_CHECK_CALLS__ as Array<
          { target?: string } | null
        >
      )?.map((call) => call?.target ?? null) ?? [];
    });
  }).toEqual(["dev-darwin-aarch64", "production-darwin-aarch64"]);

  await page.getByRole("button", { name: "Download latest Freed Desktop" }).click();
  await expect.poll(async () => (await ipc.openedUrls())[0]).toBe(
    "https://dev.freed.wtf/api/downloads/mac-arm",
  );

  await page.getByRole("button", { name: "Download diagnostics" }).click();
  await expect(
    page.getByText("Diagnostics saved to /Users/test/Downloads/freed-diagnostics-test.json"),
  ).toBeVisible();
});

test("startup recovery installs pending updates in place and surfaces install errors", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "26.4.2101-dev",
      body: "Startup recovery installer test",
      downloadAndInstall: async (onEvent: (event: { event: string; data: unknown }) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 50 } });
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        throw new Error("Synthetic install failure");
      },
    };
  });

  await app.page.goto("/startup-recovery.html?releaseChannel=dev");

  await expect(page.getByRole("button", { name: "Install update and restart" })).toBeVisible();
  await page.getByRole("button", { name: "Install update and restart" }).click();
  await expect(page.getByRole("button", { name: "Downloading 50%" })).toBeVisible();
  await expect(page.getByText("Synthetic install failure")).toBeVisible();
  await expect(page.getByRole("button", { name: "Install update and restart" })).toBeVisible();
});

test("startup recovery scrolls vertically when content exceeds the window", async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 420 });
  await page.addInitScript(() => {
    (window as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "26.5.302-dev",
      body: "Harden startup recovery and refine feed layout",
      downloadAndInstall: async () => undefined,
    };
  });

  await app.page.goto("/startup-recovery.html?releaseChannel=dev");
  await expect(page.getByText("Freed did not finish loading last time.")).toBeVisible();

  const scrollMetrics = await page.locator("main").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const style = window.getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });

  expect(scrollMetrics.overflowY).toBe("auto");
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  expect(scrollMetrics.scrollTop).toBeGreaterThan(0);
});
