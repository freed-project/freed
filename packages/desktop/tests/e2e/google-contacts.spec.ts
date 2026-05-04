import { test, expect } from "./fixtures/app";

async function seedGoogleToken(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("freed_cloud_token_gdrive", "google-test-token");
  });
}

async function openGoogleContactsSection(
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
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  const settingsNav = page.getByRole("navigation").nth(1);
  const navBtn = settingsNav.getByRole("button", { name: "Google Contacts" }).first();
  await expect(navBtn).toBeVisible({ timeout: 3_000 });
  await navBtn.click();

  const section = page.getByTestId("google-contacts-settings");
  await expect(section).toBeVisible({ timeout: 3_000 });
  return section;
}

async function mockGoogleContacts(
  page: import("@playwright/test").Page,
  connections: unknown[],
  status = 200,
) {
  await page.route("https://people.googleapis.com/v1/people/me/connections?*", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status >= 400
          ? { error: { message: `People API error ${status.toLocaleString()}` } }
          : {
              connections,
              nextSyncToken: "sync-token-1",
            },
      ),
    });
  });
}

async function injectAuthor(page: import("@playwright/test").Page, displayName: string, handle = "author-handle") {
  await page.evaluate(async ({ displayName, handle }) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<void>;
    };
    const now = Date.now();
    await automerge.docBatchImportItems([
      {
        globalId: `x:${displayName}`,
        platform: "x",
        contentType: "post",
        capturedAt: now,
        publishedAt: now,
        author: { id: `author:${displayName}`, handle, displayName },
        content: { text: `post from ${displayName}`, mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
    ]);
  }, { displayName, handle });
}

async function injectFriend(page: import("@playwright/test").Page, friendName: string) {
  await page.evaluate(async (friendName) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPerson: (person: unknown) => Promise<void>;
    };
    const now = Date.now();
    await automerge.docAddPerson({
      id: `friend:${friendName}`,
      name: friendName,
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: now,
      updatedAt: now,
    });
  }, friendName);
}

test("Google Contacts appears in Settings > Sources", async ({ app }) => {
  await seedGoogleToken(app.page);
  await app.goto();
  await app.waitForReady();

  const section = await openGoogleContactsSection(app.page, test);
  if (!section) return;

  const settingsNav = app.page.getByRole("navigation").nth(1);
  await expect(settingsNav.getByRole("button", { name: "Saved" })).toBeVisible();
  const navLabels = (await settingsNav.getByRole("button").allTextContents()).map((label) => label.trim());
  expect(navLabels.indexOf("Google Contacts")).toBe(navLabels.indexOf("Saved") + 1);

  await expect(section.getByText("Google Contacts", { exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "Sync Now" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Review Matches" })).toBeVisible();
});

test("People API failures surface reconnect state instead of failing silently", async ({ app }) => {
  await seedGoogleToken(app.page);
  await mockGoogleContacts(app.page, [], 401);
  await app.goto();
  await app.waitForReady();

  const section = await openGoogleContactsSection(app.page, test);
  if (!section) return;
  await section.getByRole("button", { name: "Sync Now" }).click();

  await expect(section.getByText("Reconnect required")).toBeVisible({ timeout: 5_000 });
});
