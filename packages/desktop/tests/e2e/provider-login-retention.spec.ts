import { test, expect } from "./fixtures/app";

type ProviderCase = {
  provider: "facebook" | "instagram" | "linkedin";
  label: "Facebook" | "Instagram" | "LinkedIn";
  loginButton: string;
  authEvent: string;
  closeEvent: string;
  healthyEvent: string;
  failedEvent: string;
  showCommand: string;
  hideCommand: string;
  scrapeCommand: string;
  browserPreviewSyncText?: string;
  startingCopy: string;
  healthyCopy: string;
  failedCopy: string;
};

const providers: ProviderCase[] = [
  {
    provider: "facebook",
    label: "Facebook",
    loginButton: "Log in with Facebook",
    authEvent: "fb-auth-result",
    closeEvent: "fb-login-window-closed",
    healthyEvent: "fb-scrape-healthy",
    failedEvent: "fb-scrape-start-failed",
    showCommand: "fb_show_login",
    hideCommand: "fb_hide_login",
    scrapeCommand: "fb_scrape_feed",
    startingCopy: "Connected. Starting sync. Finish any Facebook prompts while Freed checks the session.",
    healthyCopy: "Connected. Sync started. Finish any Facebook prompts while Freed closes the login window.",
    failedCopy: "Connected, but sync did not start. Finish any Facebook prompts, then close the login window or click Sync Now.",
  },
  {
    provider: "instagram",
    label: "Instagram",
    loginButton: "Log in with Instagram",
    authEvent: "ig-auth-result",
    closeEvent: "ig-login-window-closed",
    healthyEvent: "ig-scrape-healthy",
    failedEvent: "ig-scrape-start-failed",
    showCommand: "ig_show_login",
    hideCommand: "ig_hide_login",
    scrapeCommand: "ig_scrape_feed",
    startingCopy: "Connected. Starting sync. Finish any Instagram prompts while Freed checks the session.",
    healthyCopy: "Connected. Sync started. Finish any Instagram prompts while Freed closes the login window.",
    failedCopy: "Connected, but sync did not start. Finish any Instagram prompts, then close the login window or click Sync Now.",
  },
  {
    provider: "linkedin",
    label: "LinkedIn",
    loginButton: "Log in with LinkedIn",
    authEvent: "li-auth-result",
    closeEvent: "li-login-window-closed",
    healthyEvent: "li-scrape-healthy",
    failedEvent: "li-scrape-start-failed",
    showCommand: "li_show_login",
    hideCommand: "li_hide_login",
    scrapeCommand: "li_scrape_feed",
    browserPreviewSyncText: "[LI] browser preview skips native LinkedIn capture",
    startingCopy: "Connected. Starting sync. Finish any LinkedIn prompts while Freed checks the session.",
    healthyCopy: "Connected. Sync started. Finish any LinkedIn prompts while Freed closes the login window.",
    failedCopy: "Connected, but sync did not start. Finish any LinkedIn prompts, then close the login window or click Sync Now.",
  },
];

function settingsDialog(page: import("@playwright/test").Page) {
  return page.locator(".fixed.inset-0.z-50").last();
}

async function openSettingsSection(
  page: import("@playwright/test").Page,
  sectionName: string,
): Promise<void> {
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();
  await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
  await settingsBtn.click();
  await expect(page.getByText("Settings").first()).toBeVisible({
    timeout: 5_000,
  });

  const section = settingsDialog(page).getByRole("button", { name: sectionName });
  await expect(section).toBeVisible({ timeout: 3_000 });
  await section.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
}

async function emitTauriEvent(
  page: import("@playwright/test").Page,
  event: string,
  payload: unknown,
): Promise<void> {
  await page.evaluate(
    ({ eventName, eventPayload }) => {
      const listeners =
        (window as unknown as Record<string, Array<(event: { payload: unknown }) => void>>)
          .__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) {
        listener({ payload: eventPayload });
      }
    },
    { eventName: event, eventPayload: payload },
  );
}

for (const providerCase of providers) {
  test(`${providerCase.label} auth starts sync and closes login after healthy scrape`, async ({
    app,
    page,
    ipc,
  }) => {
    await app.goto();
    await app.waitForReady();
    await ipc.setHandler(providerCase.scrapeCommand, () => null);

    await openSettingsSection(page, providerCase.label);
    await page.getByText(providerCase.loginButton).click();
    await app.acceptProviderRiskIfPresent(providerCase.provider);
    await expect.poll(async () => (await ipc.invocations()).some(
      (call) => call.cmd === providerCase.showCommand,
    )).toBe(true);

    await emitTauriEvent(page, providerCase.authEvent, { loggedIn: true });
    if (providerCase.browserPreviewSyncText) {
      await emitTauriEvent(page, providerCase.healthyEvent, {
        provider: providerCase.provider,
        windowMode: "hidden",
      });
    } else {
      await expect(page.getByText(providerCase.startingCopy)).toBeVisible({ timeout: 5_000 });
    }
    await expect(page.getByTestId(`provider-sync-action-${providerCase.provider}`)).toBeVisible({
      timeout: 5_000,
    });

    const afterAuthInvocations = await ipc.invocations();
    expect(afterAuthInvocations.some((call) => call.cmd === providerCase.hideCommand)).toBe(false);

    if (providerCase.browserPreviewSyncText) {
      await expect(page.getByText(providerCase.browserPreviewSyncText)).toBeVisible({
        timeout: 5_000,
      });
    } else {
      await expect.poll(async () => {
        const scrapeCall = (await ipc.invocations()).find(
          (call) => call.cmd === providerCase.scrapeCommand,
        );
        return (scrapeCall?.args as { windowMode?: string } | undefined)?.windowMode;
      }).toBe("hidden");
    }

    if (!providerCase.browserPreviewSyncText) {
      await emitTauriEvent(page, providerCase.healthyEvent, {
        provider: providerCase.provider,
        windowMode: "hidden",
      });
    }
    await expect(page.getByText(providerCase.healthyCopy)).toBeVisible({ timeout: 5_000 });
    await expect.poll(async () => (await ipc.invocations()).some(
      (call) => call.cmd === providerCase.hideCommand,
    ), { timeout: 7_000 }).toBe(true);
    await expect(page.getByText(providerCase.healthyCopy)).toBeHidden({ timeout: 7_000 });
  });

  test(`${providerCase.label} failed scrape startup leaves login prompt open`, async ({
    app,
    page,
    ipc,
  }) => {
    await app.goto();
    await app.waitForReady();
    await ipc.setHandler(providerCase.scrapeCommand, () => null);

    await openSettingsSection(page, providerCase.label);
    await page.getByText(providerCase.loginButton).click();
    await app.acceptProviderRiskIfPresent(providerCase.provider);
    await expect.poll(async () => (await ipc.invocations()).some(
      (call) => call.cmd === providerCase.showCommand,
    )).toBe(true);

    await emitTauriEvent(page, providerCase.authEvent, { loggedIn: true });
    if (providerCase.browserPreviewSyncText) {
      await expect(page.getByText(providerCase.failedCopy)).toBeVisible({ timeout: 5_000 });
    } else {
      await expect(page.getByText(providerCase.startingCopy)).toBeVisible({ timeout: 5_000 });
    }

    await emitTauriEvent(page, providerCase.failedEvent, {
      provider: providerCase.provider,
      windowMode: "hidden",
      reason: "test failure",
    });
    await expect(page.getByText(providerCase.failedCopy)).toBeVisible({ timeout: 5_000 });
    expect((await ipc.invocations()).some((call) => call.cmd === providerCase.hideCommand)).toBe(false);
  });

  test(`${providerCase.label} explicit close clears retained login prompt`, async ({
    app,
    page,
    ipc,
  }) => {
    await app.goto();
    await app.waitForReady();
    await ipc.setHandler(providerCase.scrapeCommand, () => null);

    await openSettingsSection(page, providerCase.label);
    await page.getByText(providerCase.loginButton).click();
    await app.acceptProviderRiskIfPresent(providerCase.provider);
    await expect.poll(async () => (await ipc.invocations()).some(
      (call) => call.cmd === providerCase.showCommand,
    )).toBe(true);

    await emitTauriEvent(page, providerCase.authEvent, { loggedIn: true });
    if (providerCase.browserPreviewSyncText) {
      await expect(page.getByText(providerCase.failedCopy)).toBeVisible({ timeout: 5_000 });
    } else {
      await expect(page.getByText(providerCase.startingCopy)).toBeVisible({ timeout: 5_000 });
    }
    await emitTauriEvent(page, providerCase.closeEvent, { closed: true });
    await expect(page.getByText(
      providerCase.browserPreviewSyncText ? providerCase.failedCopy : providerCase.startingCopy,
    )).toBeHidden({ timeout: 5_000 });
    await emitTauriEvent(page, providerCase.healthyEvent, {
      provider: providerCase.provider,
      windowMode: "hidden",
    });
    expect((await ipc.invocations()).some((call) => call.cmd === providerCase.hideCommand)).toBe(false);
  });
}
