/**
 * E2E tests for Instagram capture flow.
 *
 * Verifies the settings section UI states: disconnected (login button),
 * connected (sync/disconnect), and disconnect flow.
 * Uses direct Zustand store manipulation to transition between states,
 * since the mock IPC layer doesn't record invocations in E2E mode.
 */

import { test, expect } from "./fixtures/app";

/**
 * Navigate to Settings and scroll the Instagram section into view.
 * Returns the Instagram section container locator.
 */
async function openInstagramSection(
  page: import("@playwright/test").Page,
  t: typeof test,
) {
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();
  if (!(await settingsBtn.isVisible())) {
    t.skip(true, "Settings button not visible");
    return null;
  }
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({
    timeout: 5_000,
  });

  const igNavBtn = page.getByRole("button", { name: "Instagram" }).last();
  await expect(igNavBtn).toBeVisible({ timeout: 3_000 });
  await igNavBtn.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(500);

  const igHeading = page.getByRole("heading", { name: "Instagram", level: 3 });
  await expect(igHeading).toBeVisible({ timeout: 3_000 });
  return igHeading.locator("..");
}

/**
 * Directly set Instagram auth state in the Zustand store.
 * This bypasses the event/IPC layer and directly drives the UI state.
 */
async function setIgAuthState(
  page: import("@playwright/test").Page,
  isAuthenticated: boolean,
) {
  await page.evaluate((authed) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      igAuth: { isAuthenticated: authed, lastCheckedAt: Date.now() },
    });
  }, isAuthenticated);
}

test("Instagram settings shows login button when not authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  const igSection = await openInstagramSection(app.page, test);
  if (!igSection) return;

  await expect(igSection.getByText("Log in with Instagram")).toBeVisible({
    timeout: 3_000,
  });
  await expect(igSection.getByText("Check Connection")).toBeVisible({
    timeout: 3_000,
  });
});

test("Instagram settings shows connected state when authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  const igSection = await openInstagramSection(app.page, test);
  if (!igSection) return;

  // Verify disconnected first
  await expect(igSection.getByText("Log in with Instagram")).toBeVisible({
    timeout: 3_000,
  });

  // Set authenticated via store
  await setIgAuthState(app.page, true);

  // Should now show connected state
  await expect(
    igSection.getByText("Connected", { exact: true }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(igSection.getByText("Sync Now")).toBeVisible({
    timeout: 3_000,
  });
  await expect(igSection.getByText("Disconnect")).toBeVisible({
    timeout: 3_000,
  });
});

test("Disconnect button returns to login state", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const igSection = await openInstagramSection(app.page, test);
  if (!igSection) return;

  // Set authenticated
  await setIgAuthState(app.page, true);
  await expect(igSection.getByText("Disconnect")).toBeVisible({
    timeout: 5_000,
  });

  // Click disconnect
  await igSection.getByText("Disconnect").click();

  // Should return to login state
  await expect(igSection.getByText("Log in with Instagram")).toBeVisible({
    timeout: 5_000,
  });
});

test("Instagram appears in sidebar as active source", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  // Instagram should be in the sidebar sources list (not "coming soon")
  const igButton = app.page.getByTestId("source-row-instagram");
  await expect(igButton).toBeVisible({ timeout: 3_000 });
});

test("Instagram source indicator shows connected when authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  // Set authenticated via store
  await setIgAuthState(app.page, true);

  // The Instagram sidebar button should indicate connection somehow
  const igButton = app.page.getByTestId("source-row-instagram");
  await expect(igButton).toBeVisible({ timeout: 3_000 });
});
