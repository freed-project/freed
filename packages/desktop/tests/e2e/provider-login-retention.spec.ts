import { test, expect } from "./fixtures/app";

type ProviderCase = {
  provider: "facebook" | "instagram" | "linkedin";
  label: "Facebook" | "Instagram" | "LinkedIn";
  loginButton: string;
  authEvent: string;
  closeEvent: string;
  showCommand: string;
  hideCommand: string;
  scrapeCommand: string;
  promptCopy: string;
  closeEvidenceText?: string;
};

const providers: ProviderCase[] = [
  {
    provider: "facebook",
    label: "Facebook",
    loginButton: "Log in with Facebook",
    authEvent: "fb-auth-result",
    closeEvent: "fb-login-window-closed",
    showCommand: "fb_show_login",
    hideCommand: "fb_hide_login",
    scrapeCommand: "fb_scrape_feed",
    promptCopy: "Connected. Finish any Facebook prompts, then close the login window.",
  },
  {
    provider: "instagram",
    label: "Instagram",
    loginButton: "Log in with Instagram",
    authEvent: "ig-auth-result",
    closeEvent: "ig-login-window-closed",
    showCommand: "ig_show_login",
    hideCommand: "ig_hide_login",
    scrapeCommand: "ig_scrape_feed",
    promptCopy: "Connected. Finish any Instagram prompts, then close the login window.",
  },
  {
    provider: "linkedin",
    label: "LinkedIn",
    loginButton: "Log in with LinkedIn",
    authEvent: "li-auth-result",
    closeEvent: "li-login-window-closed",
    showCommand: "li_show_login",
    hideCommand: "li_hide_login",
    scrapeCommand: "li_scrape_feed",
    promptCopy: "Connected. Finish any LinkedIn prompts, then close the login window.",
    closeEvidenceText: "[LI] browser preview skips native LinkedIn capture",
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
  test(`${providerCase.label} login stays open after auth and syncs after close`, async ({
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
    await expect(page.getByText(providerCase.promptCopy)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId(`provider-sync-action-${providerCase.provider}`)).toBeVisible({
      timeout: 5_000,
    });

    const afterAuthInvocations = await ipc.invocations();
    expect(afterAuthInvocations.some((call) => call.cmd === providerCase.hideCommand)).toBe(false);
    expect(afterAuthInvocations.some((call) => call.cmd === providerCase.scrapeCommand)).toBe(false);
    if (providerCase.closeEvidenceText) {
      await expect(page.getByText(providerCase.closeEvidenceText)).toHaveCount(0);
    }

    await emitTauriEvent(page, providerCase.closeEvent, { closed: true });
    if (providerCase.closeEvidenceText) {
      await expect(page.getByText(providerCase.closeEvidenceText)).toBeVisible({ timeout: 5_000 });
    } else {
      await expect.poll(async () => (await ipc.invocations()).some(
        (call) => call.cmd === providerCase.scrapeCommand,
      )).toBe(true);
    }
    await expect(page.getByText(providerCase.promptCopy)).toBeHidden({ timeout: 5_000 });
  });
}
