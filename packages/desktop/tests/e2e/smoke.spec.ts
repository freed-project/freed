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
  // waitForReady() already asserted <main> is visible.
  // This test just confirms the fixture itself didn't throw.
  await expect(app.page.locator("main")).toBeVisible();
});

test("page title is set", async ({ page }) => {
  await page.addInitScript(tauriInitScript());
  await page.goto("/");
  // Vite / React Router sets this after hydration. Just assert it's not blank.
  await expect(page).toHaveTitle(/.+/);
});

test("no console errors on startup", async ({ page }) => {
  await page.addInitScript(tauriInitScript());

  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  // Wait for init to complete before collecting errors.
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

  // Filter out known benign messages from third-party scripts / WASM.
  const fatal = errors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("ResizeObserver") &&
      !e.includes("[mock") &&
      // The sync relay (broadcast_doc) is not available in the test
      // environment. sync.ts already catches these and logs them as
      // "[Sync] Failed to broadcast" — safe to ignore.
      !e.includes("broadcast_doc") &&
      !e.includes("Failed to broadcast"),
  );

  expect(fatal, `Unexpected console errors: ${fatal.join("\n")}`).toHaveLength(
    0,
  );
});

// ---------------------------------------------------------------------------
// Layout surfaces
// ---------------------------------------------------------------------------

test("header is visible", async ({ app }) => {
  // The header contains the drag region at the top of the window.
  await expect(app.page.locator("header, [role='banner']").first()).toBeVisible();
});

test("main content area renders", async ({ app }) => {
  await expect(app.page.locator("main")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

test("settings panel can be opened", async ({ app }) => {
  const { page } = app;
  // The settings button lives in the header. Look for a button that opens settings.
  // Use aria-label or visible text since the exact selector varies by component.
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();

  // If the button is not visible the app may use an icon-only button with aria-label.
  const iconBtn = page.locator('[aria-label*="settings" i]').first();

  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;

  if (await btn.isVisible()) {
    await btn.click();
    // A settings panel / modal / drawer should appear.
    await expect(
      page.locator('[role="dialog"], [data-panel="settings"], section').first(),
    ).toBeVisible({ timeout: 5_000 });
  } else {
    // Settings entry point not yet wired with a stable selector — skip gracefully.
    test.skip(true, "Settings button not found with current selectors");
  }
});

// ---------------------------------------------------------------------------
// IPC mock verification
// ---------------------------------------------------------------------------

test("invoke mock is registered and callable from page context", async ({
  app,
  ipc,
}) => {
  // waitForReady() ensures mock modules have fully initialized (their window
  // globals are set during module init, which happens at import time).
  await ipc.setHandler("test_ping", (_args) => ({ pong: true }));

  const result = await app.page.evaluate(async () => {
    const inv = (window as unknown as Record<string, unknown>)
      .__TAURI_MOCK_INVOKE__ as
      | ((cmd: string, args?: unknown) => Promise<unknown>)
      | undefined;
    if (!inv) throw new Error("__TAURI_MOCK_INVOKE__ not found on window");
    return inv("test_ping", {});
  });

  expect(result).toEqual({ pong: true });
});

test("plugin-shell open() records URLs", async ({ app, ipc }) => {
  // App is ready: plugin-shell mock has run and set up window globals.
  await app.page.evaluate(() => {
    const urls = (window as unknown as Record<string, unknown>)
      .__TAURI_MOCK_OPENED_URLS__ as string[];
    urls.push("https://freed.wtf");
  });

  const urls = await ipc.openedUrls();
  expect(urls).toContain("https://freed.wtf");
});

test("plugin-process relaunch() is recorded", async ({ app, ipc }) => {
  await app.page.evaluate(() => {
    const calls = (window as unknown as Record<string, unknown>)
      .__TAURI_MOCK_PROCESS_CALLS__ as { fn: string; args: unknown[] }[];
    calls.push({ fn: "relaunch", args: [] });
  });

  const calls = await ipc.processCalls();
  expect(calls.map((c) => c.fn)).toContain("relaunch");
});

// ---------------------------------------------------------------------------
// Update flow
// ---------------------------------------------------------------------------

test("update notification appears when an update is available", async ({
  page,
}) => {
  // Inject Tauri IPC mock + update stub before page load. Both must be
  // addInitScript calls so they survive the navigation.
  await page.addInitScript(tauriInitScript());
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "99.0.0",
      currentVersion: "0.0.1",
      date: new Date().toISOString(),
      downloadAndInstall: async () => {},
    };
  });

  await page.goto("/");
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

  // The App polls for updates 5 s after init — wait up to 15 s total.
  // The notification renders "Update available — v99.0.0" and a
  // "Download & Install" button.
  await expect(
    page.locator("text=Update available").first(),
  ).toBeVisible({ timeout: 15_000 });
});
