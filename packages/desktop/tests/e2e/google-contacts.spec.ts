import { test, expect } from "./fixtures/app";

const CONTACT_SYNC_STORAGE_KEY = "freed_contact_sync";

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
  await page.evaluate(
    ({ connections, status }) => {
      const body = JSON.stringify(
        status >= 400
          ? {
              error: {
                message: `People API error ${status.toLocaleString()}`,
                errors: [{ reason: "authError" }],
              },
            }
          : {
              connections,
              nextSyncToken: "sync-token-1",
            },
      );
      const encodedBody = Array.from(new TextEncoder().encode(body));
      const handlers = (window as Window & {
        __TAURI_MOCK_HANDLERS__?: Record<string, (args: unknown) => unknown>;
      }).__TAURI_MOCK_HANDLERS__;
      if (!handlers) throw new Error("Tauri mock handlers are unavailable");
      handlers.google_api_request = () => ({
        status,
        headers: [["content-type", "application/json"]],
        body: encodedBody,
      });
    },
    { connections, status },
  );
}

async function readContactSyncState(page: import("@playwright/test").Page) {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as {
      authStatus?: string;
      syncStatus?: string;
      syncToken?: string | null;
      lastErrorMessage?: string;
      cachedContacts?: Array<{ resourceName?: string; name?: { displayName?: string } }>;
    } : null;
  }, CONTACT_SYNC_STORAGE_KEY);
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

test("syncs Google Contacts through the desktop native API path", async ({ app }) => {
  await seedGoogleToken(app.page);
  await app.goto();
  await mockGoogleContacts(app.page, [
    {
      resourceName: "people/ada",
      etag: "contact-etag",
      names: [{ displayName: "Ada Lovelace", givenName: "Ada", familyName: "Lovelace", metadata: { primary: true } }],
      emailAddresses: [{ value: "ada@example.com", type: "home" }],
      phoneNumbers: [{ value: "+15555550100", type: "mobile" }],
    },
  ]);
  await app.waitForReady();

  const section = await openGoogleContactsSection(app.page, test);
  if (!section) return;
  await section.getByRole("button", { name: "Sync Now" }).click();

  await expect(section.getByText("Connected")).toBeVisible({ timeout: 5_000 });
  await app.page.waitForFunction((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return false;
    const state = JSON.parse(raw) as { cachedContacts?: Array<{ resourceName?: string }> };
    return state.cachedContacts?.some((contact) => contact.resourceName === "people/ada");
  }, CONTACT_SYNC_STORAGE_KEY);

  const state = await readContactSyncState(app.page);
  expect(state?.authStatus).toBe("connected");
  expect(state?.syncToken).toBe("sync-token-1");
  expect(state?.cachedContacts).toHaveLength(1);
  expect(state?.cachedContacts?.[0]?.name?.displayName).toBe("Ada Lovelace");
});

test("People API failures surface reconnect state instead of failing silently", async ({ app }) => {
  await seedGoogleToken(app.page);
  await app.goto();
  await mockGoogleContacts(app.page, [], 401);
  await app.waitForReady();

  const section = await openGoogleContactsSection(app.page, test);
  if (!section) return;
  await section.getByRole("button", { name: "Sync Now" }).click();

  await expect(section.getByText("Reconnect required")).toBeVisible({ timeout: 5_000 });
  await expect(section.getByText(/Google Contacts API failed \(401\): People API error 401/)).toBeVisible();
});
