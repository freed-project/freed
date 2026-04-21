import { test, expect } from "./fixtures/app";

test("saved settings overview survives items arriving while open", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          setState: (partial: Record<string, unknown>) => void;
        }
      | undefined;

    if (!store) {
      throw new Error("Freed store not found");
    }

    store.setState({ items: [] });
  });

  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  const iconBtn = page.locator('[aria-label*="settings" i]').first();
  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;

  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await expect(settingsDialog).toBeVisible({ timeout: 5_000 });
  await settingsDialog.getByRole("button", { name: "Saved", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Saved Content", level: 3 })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("No saved items yet.")).toBeVisible();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as
      | { docAddFeedItems: (items: unknown[]) => Promise<void> }
      | undefined;

    if (!automerge) {
      throw new Error("Freed Automerge bridge not found");
    }

    await automerge.docAddFeedItems([
      {
        globalId: "saved:e2e:arrives-while-open",
        platform: "saved",
        contentType: "article",
        capturedAt: Date.now(),
        publishedAt: Date.now(),
        author: {
          id: "saved",
          handle: "saved",
          displayName: "Saved",
        },
        content: {
          text: "A saved article added after the settings pane rendered.",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://example.com/saved",
            title: "Saved Article",
            description: "Saved while settings is open.",
          },
        },
        userState: {
          hidden: false,
          saved: true,
          savedAt: Date.now(),
          archived: false,
          tags: [],
        },
        topics: [],
      },
    ]);
  });

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { items: Array<{ globalId: string }> } }
      | undefined;

    return store
      ?.getState()
      .items.some((item) => item.globalId === "saved:e2e:arrives-while-open");
  });

  await expect(page.getByText("Saved overview")).toBeVisible();
  await expect(page.getByText("Freed Desktop hit a fatal error")).toBeHidden();
});

test("saved settings jump lands on readable content", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  const iconBtn = page.locator('[aria-label*="settings" i]').first();
  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;

  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();

  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  const scrollContainer = page.getByTestId("settings-scroll-container");
  await expect(settingsDialog).toBeVisible({ timeout: 5_000 });

  await settingsDialog.getByRole("button", { name: "Saved", exact: true }).click();

  const heading = settingsDialog.getByRole("heading", { name: "Saved Content", level: 3 }).last();
  const emptyState = page.getByText("No saved items yet.");
  await expect(heading).toBeVisible();
  await expect(emptyState).toBeVisible();
});
