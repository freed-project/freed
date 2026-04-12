import { test, expect } from "./fixtures/app";

async function openSettings(page: import("@playwright/test").Page): Promise<void> {
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();

  await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({
    timeout: 5_000,
  });
}

async function openSettingsSection(
  page: import("@playwright/test").Page,
  sectionName: string,
): Promise<void> {
  await openSettings(page);
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const section = settingsDialog.getByRole("button", { name: new RegExp(`^${sectionName.replace("/", "\\/")}$`) });
  await expect(section).toBeVisible({ timeout: 3_000 });
  await section.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
}

async function cancelProviderRiskDialog(
  page: import("@playwright/test").Page,
  provider: "x" | "facebook" | "instagram" | "linkedin",
): Promise<void> {
  const dialog = page.getByTestId(`provider-risk-dialog-${provider}`);
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
}

test("first launch blocks the desktop shell until legal consent is accepted", async ({
  app,
}) => {
  await app.goto();

  await expect(app.page.getByTestId("legal-gate-accept")).toBeVisible({
    timeout: 5_000,
  });
  await expect(app.page.locator("main")).toBeHidden();

  await app.acceptLegalGateIfPresent();
  await app.waitForReady();
  await expect(app.page.locator("main")).toBeVisible();
});

test("accepted legal consent persists across reloads on the same device", async ({
  app,
}) => {
  await app.goto();
  await app.acceptLegalGateIfPresent();
  await app.waitForReady();

  await app.page.reload();
  await expect(app.page.getByTestId("legal-gate-accept")).toBeHidden();
  await app.waitForReady();
});

test("store failures fall back to the legal gate instead of a blank window", async ({
  app,
}) => {
  await app.page.addInitScript(() => {
    window.localStorage.setItem("__TAURI_MOCK_STORE_THROW__", "1");
  });

  await app.goto();

  await expect(app.page.getByTestId("legal-gate-accept")).toBeVisible({
    timeout: 5_000,
  });
  await expect(app.page.locator("main")).toBeHidden();
});

test("X risky connection flows require provider consent", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      xAuth: {
        isAuthenticated: false,
      },
    });
    window.localStorage.removeItem("freed.legal.legal.provider.x");
  });
  await openSettingsSection(page, "X / Twitter");

  await page.getByText("Sign in to X").click();
  await expect(page.getByTestId("provider-risk-accept-x")).toBeVisible({
    timeout: 5_000,
  });
});

test("Facebook login requires provider consent", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await openSettingsSection(page, "Facebook");

  await page.getByText("Log in with Facebook").click();
  await expect(page.getByTestId("provider-risk-accept-facebook")).toBeVisible({
    timeout: 5_000,
  });
});

test("Instagram login requires provider consent", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await openSettingsSection(page, "Instagram");

  await page.getByText("Log in with Instagram").click();
  await expect(page.getByTestId("provider-risk-accept-instagram")).toBeVisible({
    timeout: 5_000,
  });
});

test("LinkedIn login and sync require provider consent", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await openSettingsSection(page, "LinkedIn");

  await page.getByText("Log in with LinkedIn").click();
  await expect(page.getByTestId("provider-risk-accept-linkedin")).toBeVisible({
    timeout: 5_000,
  });

  await cancelProviderRiskDialog(page, "linkedin");
  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      liAuth: { isAuthenticated: true, lastCheckedAt: Date.now() },
    });
  });

  const syncNowButton = page.getByTestId("provider-sync-action-linkedin");
  await expect(syncNowButton).toBeVisible({ timeout: 5_000 });
  await syncNowButton.click();
  await expect(page.getByTestId("provider-risk-accept-linkedin")).toBeVisible({
    timeout: 5_000,
  });
});
