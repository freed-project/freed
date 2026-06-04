import { test, expect } from "./fixtures/app";

type SectionMetrics = {
  containerHeight: number;
  scrollTop: number;
  sectionHeight: number;
  sectionOffset: number;
  headingTopFromContainer: number;
  sectionTopFromContainer: number;
};

async function openSettingsTo(
  page: import("@playwright/test").Page,
  sectionId: string,
  headingName: string,
) {
  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const dialog = page.locator(".theme-settings-shell").first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByRole("button", { name: headingName, exact: true }).click();
  await expect(dialog.getByRole("heading", { name: headingName }).last()).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(async () => Math.abs((await getSectionMetrics(page, sectionId)).headingTopFromContainer - 20), {
      timeout: 3_000,
    })
    .toBeLessThanOrEqual(3);
}

async function getSectionMetrics(
  page: import("@playwright/test").Page,
  sectionId: string,
): Promise<SectionMetrics> {
  return page.evaluate((sectionId) => {
    const container = document.querySelector('[data-testid="settings-scroll-container"]') as HTMLElement | null;
    if (!container) {
      throw new Error("Settings scroll container was not found");
    }

    const section = container.querySelector(`[data-section="${sectionId}"]`) as HTMLElement | null;
    if (!section) {
      throw new Error(`Settings section ${sectionId} was not found`);
    }

    const heading = section.querySelector("h3") as HTMLElement | null;
    if (!heading) {
      throw new Error(`Settings section ${sectionId} heading was not found`);
    }

    const containerRect = container.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();

    return {
      containerHeight: containerRect.height,
      scrollTop: container.scrollTop,
      sectionHeight: sectionRect.height,
      sectionOffset: container.scrollTop - section.offsetTop,
      headingTopFromContainer: headingRect.top - containerRect.top,
      sectionTopFromContainer: sectionRect.top - containerRect.top,
    };
  }, sectionId);
}

async function expectSectionOffsetNear(
  page: import("@playwright/test").Page,
  sectionId: string,
  expectedOffset: number,
) {
  await expect
    .poll(async () => Math.abs((await getSectionMetrics(page, sectionId)).sectionOffset - expectedOffset), {
      timeout: 3_000,
    })
    .toBeLessThanOrEqual(3);
}

async function expectHeadingTopNear(
  page: import("@playwright/test").Page,
  sectionId: string,
  expectedTop: number,
) {
  await expect
    .poll(async () => Math.abs((await getSectionMetrics(page, sectionId)).headingTopFromContainer - expectedTop), {
      timeout: 3_000,
    })
    .toBeLessThanOrEqual(3);
}

async function expectSectionHeadingBelowScrollport(
  page: import("@playwright/test").Page,
  sectionId: string,
) {
  await expect
    .poll(async () => {
      const metrics = await getSectionMetrics(page, sectionId);
      return metrics.headingTopFromContainer - metrics.containerHeight;
    }, { timeout: 3_000 })
    .toBeGreaterThan(0);
}

async function expectSectionFillsScrollport(
  page: import("@playwright/test").Page,
  sectionId: string,
) {
  await expect
    .poll(async () => {
      const metrics = await getSectionMetrics(page, sectionId);
      return metrics.sectionHeight - metrics.containerHeight;
    }, { timeout: 3_000 })
    .toBeGreaterThanOrEqual(-1);
}

test("settings keeps the active section anchored during desktop height resize", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await openSettingsTo(page, "x", "X / Twitter");
  const before = await getSectionMetrics(page, "x");

  for (const height of [720, 960, 760]) {
    await page.setViewportSize({ width: 1440, height });
    await expectSectionOffsetNear(page, "x", before.sectionOffset);
    await expectHeadingTopNear(page, "x", before.headingTopFromContainer);
    await expect(page.locator('button[data-active="true"]').filter({ hasText: /^X \/ Twitter$/ })).toHaveCount(1);
  }
});

test("settings keeps the next desktop section out of view for short sections", async ({ app, page }) => {
  for (const viewport of [
    { width: 1180, height: 760 },
    { width: 1440, height: 1100 },
  ]) {
    await page.setViewportSize(viewport);
    await app.goto();
    await app.waitForReady();

    await openSettingsTo(page, "sync", "Sync");
    await expectHeadingTopNear(page, "sync", 20);
    await expectSectionFillsScrollport(page, "sync");
    await expectSectionHeadingBelowScrollport(page, "saved");
  }
});

test("settings preserves intra-section position during desktop height resize", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await openSettingsTo(page, "x", "X / Twitter");
  await page.getByTestId("settings-scroll-container").evaluate((container) => {
    const section = container.querySelector('[data-section="x"]') as HTMLElement | null;
    if (!section) {
      throw new Error("X settings section was not found");
    }
    container.scrollTop = section.offsetTop + 260;
    container.dispatchEvent(new Event("scroll"));
  });

  await expectSectionOffsetNear(page, "x", 260);
  await page.setViewportSize({ width: 1440, height: 700 });
  await expectSectionOffsetNear(page, "x", 260);
  await page.setViewportSize({ width: 1440, height: 940 });
  await expectSectionOffsetNear(page, "x", 260);
});

test("settings version click smooth-scrolls to updates once and remains anchored after resize", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await openSettingsTo(page, "x", "X / Twitter");

  await page.evaluate(() => {
    (window as unknown as { __TAURI_MOCK_UPDATE_CHECK_CALLS__?: unknown[] }).__TAURI_MOCK_UPDATE_CHECK_CALLS__ = [];
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    (window as unknown as { __SETTINGS_SCROLL_TO_CALLS__?: unknown[] }).__SETTINGS_SCROLL_TO_CALLS__ = [];
    HTMLElement.prototype.scrollTo = function (...args: Parameters<typeof originalScrollTo>) {
      if (this.getAttribute("data-testid") === "settings-scroll-container") {
        (window as unknown as { __SETTINGS_SCROLL_TO_CALLS__: unknown[] }).__SETTINGS_SCROLL_TO_CALLS__.push(args[0]);
      }
      return originalScrollTo.apply(this, args);
    };
  });

  const dialog = page.locator(".theme-settings-shell").first();
  await dialog.getByRole("button", { name: /^v\d+\.\d+\.\d+/ }).click();
  await expect(page.getByRole("heading", { name: "Updates" }).last()).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __SETTINGS_SCROLL_TO_CALLS__?: Array<{ behavior?: ScrollBehavior }> })
          .__SETTINGS_SCROLL_TO_CALLS__
          ?.some((call) => call?.behavior === "smooth") ?? false,
      ), { timeout: 3_000 })
    .toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(() =>
        ((window as unknown as { __TAURI_MOCK_UPDATE_CHECK_CALLS__?: unknown[] })
          .__TAURI_MOCK_UPDATE_CHECK_CALLS__ ?? []).length,
      ), { timeout: 3_000 })
    .toBe(1);

  await expectHeadingTopNear(page, "updates", 20);
  await expect
    .poll(async () => Math.abs((await getSectionMetrics(page, "updates")).sectionTopFromContainer - 20), {
      timeout: 3_000,
    })
    .toBeLessThanOrEqual(3);

  await page.setViewportSize({ width: 1440, height: 720 });
  await expectHeadingTopNear(page, "updates", 20);
});

test("settings reduces backdrop work during scroll and restores it at idle", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const settingsButton = page.locator("button").filter({ hasText: /settings/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();

  const dialog = page.locator(".theme-settings-shell").first();
  const overlay = page.locator(".theme-settings-overlay").first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  await dialog.getByRole("button", { name: "Sync", exact: true }).hover();
  await page.getByTestId("settings-scroll-container").hover();
  await expect(dialog).not.toHaveAttribute("data-moving", "true");
  await expect(overlay).not.toHaveClass(/theme-settings-overlay-preview-off/);
  await expect(overlay).not.toHaveAttribute("data-moving", "true");

  await page.getByTestId("settings-scroll-container").evaluate((container) => {
    container.scrollTop += 180;
    container.dispatchEvent(new Event("scroll"));
  });
  await expect(dialog).toHaveAttribute("data-moving", "true");
  await expect(overlay).toHaveAttribute("data-moving", "true");
  await expect(overlay).toHaveCSS("backdrop-filter", "none");
  await expect(overlay).not.toHaveClass(/theme-settings-overlay-preview-off/);
  await expect(overlay).not.toHaveAttribute("data-moving", "true", { timeout: 2_000 });

  await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
  await dialog.locator(".theme-settings-theme-card").hover();
  await expect(overlay).toHaveClass(/theme-settings-overlay-preview-off/);
});
