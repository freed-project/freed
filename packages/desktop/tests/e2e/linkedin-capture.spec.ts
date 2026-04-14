import { test, expect } from "./fixtures/app";

function getSettingsDialog(page: import("@playwright/test").Page) {
  return page.locator(".fixed.inset-0.z-50").last();
}

async function openLinkedInSection(
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

  const liNavBtn = getSettingsDialog(page).getByRole("button", { name: /^LinkedIn$/ });
  await expect(liNavBtn).toBeVisible({ timeout: 3_000 });
  await liNavBtn.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(500);

  const liHeading = getSettingsDialog(page).getByRole("heading", { name: "LinkedIn", level: 3 });
  await expect(liHeading).toBeVisible({ timeout: 3_000 });
  return liHeading.locator("..");
}

async function setLiAuthState(
  page: import("@playwright/test").Page,
  isAuthenticated: boolean,
) {
  await page.evaluate((authed) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({
      liAuth: { isAuthenticated: authed, lastCheckedAt: Date.now() },
    });
  }, isAuthenticated);
}

async function injectLinkedInItems(
  page: import("@playwright/test").Page,
  count: number,
) {
  await page.evaluate(async (itemCount) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };

    const now = Date.now();
    const items = Array.from({ length: itemCount }, (_, i) => ({
      globalId: `linkedin:urn:li:activity:${9_000 + i}`,
      platform: "linkedin",
      contentType: "post",
      capturedAt: now - i * 60_000,
      publishedAt: now - i * 60_000,
      author: {
        id: `linkedin-author-${i}`,
        handle: `author-${i}`,
        displayName: `LinkedIn Author ${i.toLocaleString()}`,
      },
      content: {
        text: `LinkedIn item ${i.toLocaleString()} for sidebar filtering`,
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: {
          url: `https://www.linkedin.com/feed/update/urn:li:activity:${9_000 + i}/`,
          title: `LinkedIn post ${i.toLocaleString()}`,
          description: "LinkedIn E2E fixture",
        },
      },
      userState: { hidden: false, saved: false, archived: false, tags: [] },
      topics: [],
    }));

    await automerge.docBatchImportItems(items);
  }, count);

  await page.waitForFunction(
    (expectedCount: number) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { itemCountByPlatform: Record<string, number> } }
        | undefined;
      return (store?.getState().itemCountByPlatform.linkedin ?? 0) >= expectedCount;
    },
    count,
    { timeout: 30_000 },
  );
}

test("LinkedIn settings shows login button when not authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  const liSection = await openLinkedInSection(app.page, test);
  if (!liSection) return;

  await expect(liSection.getByText("Log in with LinkedIn")).toBeVisible({
    timeout: 3_000,
  });
  await expect(liSection.getByText("Check Connection")).toBeVisible({
    timeout: 3_000,
  });
});

test("LinkedIn appears in sidebar as an active source", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const sidebar = app.page.locator("nav").first();
  const liButton = sidebar.getByTestId("source-row-linkedin");
  await expect(liButton).toBeVisible({ timeout: 3_000 });
});

test("LinkedIn source indicator shows connected when authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();

  await setLiAuthState(app.page, true);
  const sidebar = app.page.getByTestId("app-sidebar");

  await expect(sidebar.getByTestId("source-indicator-linkedin")).toBeVisible({ timeout: 3_000 });
});

test("LinkedIn source button filters the feed to LinkedIn items", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(1);
  await injectLinkedInItems(app.page, 1);

  const sidebar = app.page.locator("nav").first();
  await sidebar.getByTestId("source-row-linkedin").click();
  await app.page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeFilter: { platform?: string } } }
      | undefined;
    return store?.getState().activeFilter.platform === "linkedin";
  }, { timeout: 5_000 });

  await expect(
    app.page.getByText("LinkedIn item 0 for sidebar filtering"),
  ).toBeVisible({ timeout: 5_000 });
  await expect(app.page.getByText("Article 0:", { exact: false })).toBeHidden();
});

test("LinkedIn appears in the source sidebar when authenticated", async ({
  app,
}) => {
  await app.goto();
  await app.waitForReady();
  await setLiAuthState(app.page, true);
  await injectLinkedInItems(app.page, 1);

  const sidebar = app.page.getByTestId("app-sidebar");
  const linkedInRow = sidebar.getByTestId("source-row-linkedin");
  await expect(linkedInRow).toBeVisible({
    timeout: 3_000,
  });
  await expect(linkedInRow).toContainText("LinkedIn");
  await expect(sidebar.getByTestId("source-indicator-linkedin")).toBeVisible({
    timeout: 3_000,
  });
});
