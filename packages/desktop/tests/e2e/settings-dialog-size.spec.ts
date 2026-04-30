import { test, expect } from "./fixtures/app";

test("settings dialog expands with the desktop viewport", async ({ app, page }) => {
  await page.setViewportSize({ width: 1_024, height: 768 });
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const settingsPanel = page.locator(".theme-settings-shell").first();
  await expect(settingsPanel).toBeVisible({ timeout: 5_000 });

  const compactRect = await settingsPanel.boundingBox();
  expect(compactRect).not.toBeNull();

  await page.setViewportSize({ width: 1_600, height: 1_000 });

  await expect.poll(async () => {
    const expandedRect = await settingsPanel.boundingBox();
    return expandedRect?.width ?? 0;
  }).toBeGreaterThan((compactRect?.width ?? 0) + 250);

  await expect.poll(async () => {
    const expandedRect = await settingsPanel.boundingBox();
    return expandedRect?.height ?? 0;
  }).toBeGreaterThanOrEqual(845);

  const scrollContainer = page.getByTestId("settings-scroll-container");
  const spacing = await scrollContainer.evaluate((container) => {
    const containerRect = container.getBoundingClientRect();
    const syncSection = container.querySelector('[data-section="sync"]');
    if (!(syncSection instanceof HTMLElement)) {
      throw new Error("Sync section not found");
    }
    const syncRect = syncSection.getBoundingClientRect();
    return syncRect.top - containerRect.bottom;
  });
  expect(spacing).toBeGreaterThan(200);

  await page.setViewportSize({ width: 1_600, height: 1_600 });
  const maxHeightPx = await page.evaluate(() => {
    return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 65;
  });
  await expect.poll(async () => {
    const cappedRect = await settingsPanel.boundingBox();
    return cappedRect?.height ?? Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(maxHeightPx + 2);
});
