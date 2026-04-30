import { test, expect } from "./fixtures/app";

const LINKEDIN_ERROR = "LinkedIn sync did not start because Freed Desktop memory is critically high.";

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

async function authenticateSocialProviders(page: import("@playwright/test").Page) {
  await page.evaluate((linkedinError) => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        setError: (error: string | null) => void;
        setXAuth: (auth: unknown) => void;
        setFbAuth: (auth: unknown) => void;
        setIgAuth: (auth: unknown) => void;
        setLiAuth: (auth: unknown) => void;
      };
    };
    const state = store.getState();
    state.setXAuth({
      isAuthenticated: true,
      cookies: { ct0: "csrf-token", authToken: "auth-token" },
    });
    state.setFbAuth({ isAuthenticated: true });
    state.setIgAuth({ isAuthenticated: true });
    state.setLiAuth({ isAuthenticated: true, lastCaptureError: linkedinError });
    state.setError(linkedinError);
  }, LINKEDIN_ERROR);
}

async function openSettingsSection(
  page: import("@playwright/test").Page,
  sectionName: "X" | "Facebook" | "Instagram" | "LinkedIn",
) {
  const navName = sectionName === "X" ? "X / Twitter" : sectionName;
  const testId = {
    X: "provider-sync-action-x",
    Facebook: "provider-sync-action-facebook",
    Instagram: "provider-sync-action-instagram",
    LinkedIn: "provider-sync-action-linkedin",
  }[sectionName];
  if (!(await page.getByTestId("settings-scroll-container").isVisible().catch(() => false))) {
    const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();
  }
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });
  const navButton = page.locator("button").filter({
    has: page.getByText(navName, { exact: true }),
  }).last();
  await expect(navButton).toBeVisible({ timeout: 3_000 });
  await navButton.click();
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 3_000 });
}

function settingsSection(page: import("@playwright/test").Page, provider: "x" | "facebook" | "instagram" | "linkedin") {
  return page.locator(`[data-section="${provider}"]`);
}

test("provider settings only show errors for their own provider", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);
  await app.goto();
  await app.waitForReady();
  await authenticateSocialProviders(page);

  for (const provider of ["X", "Facebook", "Instagram"] as const) {
    await openSettingsSection(page, provider);
    const sectionId = provider === "X" ? "x" : provider.toLowerCase();
    await expect(
      settingsSection(page, sectionId as "x" | "facebook" | "instagram").getByText(LINKEDIN_ERROR),
    ).toHaveCount(0);
  }

  await openSettingsSection(page, "LinkedIn");
  await expect(settingsSection(page, "linkedin").getByText(LINKEDIN_ERROR)).toHaveCount(1);
});

test("social provider empty states do not inherit a different provider error", async ({ app, page }) => {
  await seedAcceptedDesktopConsent(page);
  await app.goto();
  await app.waitForReady();
  await authenticateSocialProviders(page);

  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { setFilter: (filter: { platform: string }) => void };
    };
    store.getState().setFilter({ platform: "facebook" });
  });
  await expect(page.getByText("Your Facebook feed is up to date.")).toBeVisible();
  await expect(page.getByText(LINKEDIN_ERROR)).toHaveCount(0);

  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { setFilter: (filter: { platform: string }) => void };
    };
    store.getState().setFilter({ platform: "instagram" });
  });
  await expect(page.getByText("Your Instagram feed is up to date.")).toBeVisible();
  await expect(page.getByText(LINKEDIN_ERROR)).toHaveCount(0);
});
