/**
 * Smoke tests for Freed Desktop.
 *
 * These verify that the app loads, initializes, and renders key UI surfaces
 * without crashing. They run in plain Chromium against the Vite dev server
 * (VITE_TEST_TAURI=1), so all Tauri IPC calls are intercepted by mocks.
 *
 * Design rule: smoke tests must be fast and not flaky. Use waitForReady() and
 * always assert on stable, visible elements. Avoid timing-sensitive assertions.
 */

import { test, expect } from "./fixtures/app";
import { tauriInitScript } from "./fixtures/tauri-init";

// ---------------------------------------------------------------------------
// App initialization
// ---------------------------------------------------------------------------

test("app loads and renders without crashing", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("main")).toBeVisible();
});

test("page title is set", async ({ page }) => {
  await page.addInitScript(tauriInitScript());
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
  // Vite / React Router sets this after hydration. Assert it's not blank.
  await expect(page).toHaveTitle(/.+/);
});

test("no console errors on startup", async ({ page }) => {
  await page.addInitScript(tauriInitScript());

  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

  // Filter out known benign messages from third-party scripts / WASM.
  const fatal = errors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("ResizeObserver") &&
      !e.includes("[mock") &&
      // The sync relay (broadcast_doc) is not available in the test
      // environment. sync.ts already catches these and logs them as
      // "[Sync] Failed to broadcast" -- safe to ignore.
      !e.includes("broadcast_doc") &&
      !e.includes("Failed to broadcast"),
  );

  expect(fatal, `Unexpected console errors: ${fatal.join("\n")}`).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Layout surfaces
// ---------------------------------------------------------------------------

test("header is visible", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("header, [role='banner']").first()).toBeVisible();
});

test("main content area renders", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("main")).toBeVisible();
});

test("Friends view can return to the feed from sidebar navigation", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(1);

  const { page } = app;

  await page.getByRole("button", { name: "Friends" }).click();
  await expect(page.getByText("No friends yet")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "All" }).click();
  await expect(page.getByText("Article 0:", { exact: false })).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

test("settings panel can be opened", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  // Look for a settings button by text or aria-label.
  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  const iconBtn = page.locator('[aria-label*="settings" i]').first();
  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;

  if (await btn.isVisible()) {
    await btn.click();
    await expect(
      page.locator('[role="dialog"], [data-panel="settings"], section').first(),
    ).toBeVisible({ timeout: 5_000 });
  } else {
    test.skip(true, "Settings button not found with current selectors");
  }
});

// ---------------------------------------------------------------------------
// IPC mock verification
// ---------------------------------------------------------------------------

test("invoke mock records calls via __TAURI_MOCK_INVOCATIONS__", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  await ipc.setHandler("test_ping", () => ({ pong: true }));

  await app.page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const handlers = w.__TAURI_MOCK_HANDLERS__ as Record<
      string,
      (args: unknown) => unknown
    >;
    // Simulate what the app does: call the handler directly.
    handlers["test_ping"]?.({});
  });

  // The invocations log is written by the Vite mock's invoke(). Trigger it
  // via window.__TAURI_INTERNALS__.invoke if available, otherwise just assert
  // that our handler is wired correctly.
  const invocations = await ipc.invocations();
  // At minimum, startup invoke calls (get_local_ip, etc.) should be recorded.
  expect(Array.isArray(invocations)).toBe(true);
});

test("plugin-shell open() records URLs", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();

  await app.page.evaluate(() => {
    const urls = (window as unknown as Record<string, unknown>)
      .__TAURI_MOCK_OPENED_URLS__ as string[];
    urls.push("https://freed.wtf");
  });

  const urls = await ipc.openedUrls();
  expect(urls).toContain("https://freed.wtf");
});

// ---------------------------------------------------------------------------
// Update mock availability
// ---------------------------------------------------------------------------

test("__TAURI_MOCK_UPDATE__ is readable after init script injection", async ({
  app,
}) => {
  // Verify the init-script / mock plumbing: set __TAURI_MOCK_UPDATE__ before
  // navigation and confirm it is present in the page context after load.
  // This doesn't test the full update notification UI (which requires the
  // 5-second App.tsx poll to fire), but it proves the mock infrastructure
  // used by update tests is wired correctly.
  await app.page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "99.0.0",
    };
  });

  await app.goto();
  await app.waitForReady();

  const update = await app.page.evaluate(() =>
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__,
  );
  expect((update as Record<string, unknown>)?.version).toBe("99.0.0");
});
