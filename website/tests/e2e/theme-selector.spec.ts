import { expect, test, type Locator, type Page } from "@playwright/test";

interface ThemeButtonGeometry {
  label: string;
  pressed: boolean;
  centerY: number;
  height: number;
  surfaceHeight: number;
}

interface SelectorLayout {
  theme: string | undefined;
  pageHeight: number;
  footerTop: number;
  footerBottom: number;
  gridTop: number;
  gridBottom: number;
  gridCount: number;
  floatingGridCount: number;
}

interface SelectorFrame extends SelectorLayout {
  hitLabel: string | null;
}

async function readThemeGeometry(grid: Locator): Promise<ThemeButtonGeometry[]> {
  return grid.locator(".website-theme-swatch").evaluateAll((buttons) =>
    buttons.map((button) => {
      const buttonRect = button.getBoundingClientRect();
      const surface = button.querySelector(".theme-preview-button-surface");
      const surfaceRect = surface?.getBoundingClientRect();

      return {
        label: button.getAttribute("aria-label") ?? "",
        pressed: button.getAttribute("aria-pressed") === "true",
        centerY: buttonRect.top + buttonRect.height / 2,
        height: buttonRect.height,
        surfaceHeight: surfaceRect?.height ?? 0,
      };
    }),
  );
}

async function readSelectorLayout(page: Page): Promise<SelectorLayout> {
  return page.evaluate(() => {
    const footer = document.querySelector<HTMLElement>(
      'footer[aria-label="Site footer"]',
    );
    const grid = footer?.querySelector<HTMLElement>(".website-theme-grid");
    if (!footer || !grid) {
      throw new Error("Footer theme selector was not rendered");
    }

    const footerRect = footer.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    return {
      theme: document.documentElement.dataset.theme,
      pageHeight: document.documentElement.scrollHeight,
      footerTop: footerRect.top,
      footerBottom: footerRect.bottom,
      gridTop: gridRect.top,
      gridBottom: gridRect.bottom,
      gridCount: document.querySelectorAll(".website-theme-grid").length,
      floatingGridCount: document.querySelectorAll(
        '[data-theme-selector-layer="floating"]',
      ).length,
    };
  });
}

async function sampleSelectorFrames(
  page: Page,
  pointer: { x: number; y: number },
  frameCount = 30,
): Promise<SelectorFrame[]> {
  return page.evaluate(async ({ pointer: point, frameCount: count }) => {
    const samples: SelectorFrame[] = [];

    for (let frame = 0; frame < count; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const footer = document.querySelector<HTMLElement>(
        'footer[aria-label="Site footer"]',
      );
      const grid = footer?.querySelector<HTMLElement>(".website-theme-grid");
      if (!footer || !grid) {
        throw new Error("Footer theme selector disappeared during interaction");
      }

      const footerRect = footer.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const hitButton = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLButtonElement>("button");
      samples.push({
        theme: document.documentElement.dataset.theme,
        pageHeight: document.documentElement.scrollHeight,
        footerTop: footerRect.top,
        footerBottom: footerRect.bottom,
        gridTop: gridRect.top,
        gridBottom: gridRect.bottom,
        gridCount: document.querySelectorAll(".website-theme-grid").length,
        floatingGridCount: document.querySelectorAll(
          '[data-theme-selector-layer="floating"]',
        ).length,
        hitLabel: hitButton?.getAttribute("aria-label") ?? null,
      });
    }

    return samples;
  }, { pointer, frameCount });
}

function span(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function assertFixedRows(buttons: ThemeButtonGeometry[]) {
  expect(buttons).toHaveLength(6);
  expect(span(buttons.slice(0, 3).map((button) => button.centerY))).toBeLessThanOrEqual(0.5);
  expect(span(buttons.slice(3).map((button) => button.centerY))).toBeLessThanOrEqual(0.5);

  const rowDistance = buttons[3].centerY - buttons[0].centerY;
  expect(rowDistance).toBeGreaterThan(Math.max(...buttons.map((button) => button.height)));
  return rowDistance;
}

test("theme selector mirrors Freed Desktop preview, revert, focus, and commit behavior", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("freed-theme", "ember");
  });
  await page.goto("/vision");

  const footer = page.locator('footer[aria-label="Site footer"]');
  await footer.scrollIntoViewIfNeeded();
  const grid = footer.locator('[data-theme-selector-layer="inline"]');
  await expect(grid).toBeVisible();
  await expect(page.locator('[data-theme-selector-layer="floating"]')).toHaveCount(0);

  const initialGeometry = await readThemeGeometry(grid);
  const initialRowDistance = assertFixedRows(initialGeometry);
  const initialActive = initialGeometry.find((button) => button.pressed);
  const initialInactive = initialGeometry.find((button) => !button.pressed);
  expect(initialActive?.label).toMatch(/^Ember\./);
  expect(initialActive!.surfaceHeight - initialInactive!.surfaceHeight).toBeGreaterThan(8);

  const scriptoriumButton = grid.getByRole("button", { name: /^Scriptorium\./ });
  const starshipButton = grid.getByRole("button", { name: /^Starship\./ });
  const emberButton = grid.getByRole("button", { name: /^Ember\./ });
  const outsideSelector = footer.getByText("Product", { exact: true });

  await starshipButton.hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "starship");
  await expect.poll(() =>
    page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const logoPrimary = document.querySelector<HTMLElement>(".theme-logo-primary");
      const logoSuffix = document.querySelector<HTMLElement>(".theme-logo-suffix");
      if (!logoPrimary || !logoSuffix) {
        throw new Error("Starship logo segments were not rendered");
      }
      return {
        primary: rootStyle.getPropertyValue("--theme-accent-primary").trim(),
        secondary: rootStyle.getPropertyValue("--theme-accent-secondary").trim(),
        control: rootStyle.getPropertyValue("--theme-control-accent").trim(),
        logoPrimary: getComputedStyle(logoPrimary).color,
        logoSuffix: getComputedStyle(logoSuffix).color,
      };
    }),
  ).toEqual({
    primary: "#2997ff",
    secondary: "#2997ff",
    control: "#2997ff",
    logoPrimary: "rgb(41, 151, 255)",
    logoSuffix: "rgb(22, 22, 58)",
  });

  await outsideSelector.hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");

  await scriptoriumButton.hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "scriptorium");
  await expect(emberButton).toHaveAttribute("aria-pressed", "true");
  await expect(scriptoriumButton).toHaveAttribute("aria-pressed", "false");

  await outsideSelector.hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");

  await scriptoriumButton.focus();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "scriptorium");
  await footer.getByRole("link", { name: "Home", exact: true }).focus();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");

  await page.mouse.move(0, 0);
  await scriptoriumButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "scriptorium");
  await outsideSelector.hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "scriptorium");
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("freed-theme")),
  ).toBe("scriptorium");
  await expect(scriptoriumButton).toHaveAttribute("aria-pressed", "true");
  await expect(emberButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".website-theme-grid")).toHaveCount(1);
  await expect(page.locator('[data-theme-selector-layer="floating"]')).toHaveCount(0);

  await footer.scrollIntoViewIfNeeded();
  const committedGeometry = await readThemeGeometry(grid);
  const committedRowDistance = assertFixedRows(committedGeometry);
  expect(Math.abs(committedRowDistance - initialRowDistance)).toBeLessThanOrEqual(0.5);
});

test("theme preview remains attached to the footer through document reflow", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("freed-theme", "ember");
  });
  await page.goto("/vision");

  const footer = page.locator('footer[aria-label="Site footer"]');
  await footer.scrollIntoViewIfNeeded();
  const grid = footer.locator('[data-theme-selector-layer="inline"]');
  const scriptoriumButton = grid.getByRole("button", { name: /^Scriptorium\./ });
  const buttonBox = await scriptoriumButton.boundingBox();
  expect(buttonBox).not.toBeNull();

  const pointer = {
    x: buttonBox!.x + buttonBox!.width / 2,
    y: buttonBox!.y + buttonBox!.height / 2,
  };
  const initial = await readSelectorLayout(page);
  await page.mouse.move(pointer.x, pointer.y);
  const previewSamples = await sampleSelectorFrames(page, pointer);

  expect(previewSamples.at(-1)?.theme).toBe("scriptorium");
  expect(span(previewSamples.map((sample) => sample.gridTop))).toBeLessThanOrEqual(0.75);
  expect(span(previewSamples.map((sample) => sample.gridBottom))).toBeLessThanOrEqual(0.75);
  expect(span(previewSamples.map((sample) => sample.footerTop))).toBeLessThanOrEqual(0.75);
  expect(span(previewSamples.map((sample) => sample.footerBottom))).toBeLessThanOrEqual(0.75);
  expect(Math.abs(previewSamples.at(-1)!.gridTop - initial.gridTop)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(previewSamples.at(-1)!.footerTop - initial.footerTop)).toBeLessThanOrEqual(0.75);
  expect(previewSamples.every((sample) => sample.gridCount === 1)).toBe(true);
  expect(previewSamples.every((sample) => sample.floatingGridCount === 0)).toBe(true);
  expect(
    previewSamples
      .filter((sample) => sample.theme === "scriptorium")
      .every((sample) => sample.hitLabel?.startsWith("Scriptorium.")),
  ).toBe(true);

  await footer.getByText("Product", { exact: true }).hover();
  const revertSamples = await sampleSelectorFrames(page, pointer);
  const reverted = revertSamples.at(-1)!;
  expect(reverted.theme).toBe("ember");
  expect(span(revertSamples.map((sample) => sample.gridTop))).toBeLessThanOrEqual(0.75);
  expect(span(revertSamples.map((sample) => sample.footerTop))).toBeLessThanOrEqual(0.75);
  expect(Math.abs(reverted.gridTop - initial.gridTop)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(reverted.footerTop - initial.footerTop)).toBeLessThanOrEqual(0.75);
  expect(reverted.pageHeight).toBe(initial.pageHeight);
  expect(reverted.gridCount).toBe(1);
  expect(reverted.floatingGridCount).toBe(0);
  await expect(page.locator("html")).not.toHaveAttribute("style", /scroll-behavior/);
});
