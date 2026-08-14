import { expect, test, type Locator } from "@playwright/test";

interface ThemeButtonGeometry {
  label: string;
  pressed: boolean;
  centerX: number;
  centerY: number;
  height: number;
  surfaceHeight: number;
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
        centerX: buttonRect.left + buttonRect.width / 2,
        centerY: buttonRect.top + buttonRect.height / 2,
        height: buttonRect.height,
        surfaceHeight: surfaceRect?.height ?? 0,
      };
    }),
  );
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

test("theme preview stays under the pointer while the active swatch remains taller", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("freed-theme", "ember");
  });
  await page.goto("/");
  await page.locator("footer").scrollIntoViewIfNeeded();

  const inlineGrid = page.locator('[data-theme-selector-layer="inline"]');
  await expect(inlineGrid).toBeVisible();

  const initialGeometry = await readThemeGeometry(inlineGrid);
  const initialRowDistance = assertFixedRows(initialGeometry);
  const activeTheme = initialGeometry.find((button) => button.pressed);
  const inactiveTheme = initialGeometry.find((button) => !button.pressed);
  expect(activeTheme).toBeDefined();
  expect(inactiveTheme).toBeDefined();
  expect(activeTheme!.surfaceHeight - inactiveTheme!.surfaceHeight).toBeGreaterThan(8);

  const midasButton = inlineGrid.getByRole("button", { name: /^Midas\./ });
  const midasBox = await midasButton.boundingBox();
  expect(midasBox).not.toBeNull();
  const pointer = {
    x: midasBox!.x + midasBox!.width / 2,
    y: midasBox!.y + midasBox!.height / 2,
  };
  await page.mouse.move(pointer.x, pointer.y);

  const floatingGrid = page.locator('[data-theme-selector-layer="floating"]');
  await expect(floatingGrid).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midas");

  const samples = await page.evaluate(async (point) => {
    const results: Array<{
      theme: string | undefined;
      labelAtPointer: string | null;
      gridX: number;
      gridY: number;
      buttonCenterX: number;
      buttonCenterY: number;
    }> = [];

    for (let frame = 0; frame < 16; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const grid = document.querySelector<HTMLElement>(
        '[data-theme-selector-layer="floating"]',
      );
      const button = [...(grid?.querySelectorAll<HTMLElement>(".website-theme-swatch") ?? [])]
        .find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Midas."));
      const gridRect = grid?.getBoundingClientRect();
      const buttonRect = button?.getBoundingClientRect();
      const hit = document.elementFromPoint(point.x, point.y)?.closest("button");

      results.push({
        theme: document.documentElement.dataset.theme,
        labelAtPointer: hit?.getAttribute("aria-label") ?? null,
        gridX: gridRect?.x ?? Number.NaN,
        gridY: gridRect?.y ?? Number.NaN,
        buttonCenterX: buttonRect
          ? buttonRect.left + buttonRect.width / 2
          : Number.NaN,
        buttonCenterY: buttonRect
          ? buttonRect.top + buttonRect.height / 2
          : Number.NaN,
      });
    }

    return results;
  }, pointer);

  expect(new Set(samples.map((sample) => sample.theme))).toEqual(new Set(["midas"]));
  expect(samples.every((sample) => sample.labelAtPointer?.startsWith("Midas."))).toBe(true);
  expect(span(samples.map((sample) => sample.gridX))).toBeLessThanOrEqual(0.5);
  expect(span(samples.map((sample) => sample.gridY))).toBeLessThanOrEqual(0.5);
  expect(span(samples.map((sample) => sample.buttonCenterX))).toBeLessThanOrEqual(0.5);
  expect(span(samples.map((sample) => sample.buttonCenterY))).toBeLessThanOrEqual(0.5);

  await page.mouse.move(0, 0);
  await expect(floatingGrid).toHaveCount(0);
  const neonButton = inlineGrid.getByRole("button", { name: /^Neon\./ });
  const neonBox = await neonButton.boundingBox();
  expect(neonBox).not.toBeNull();
  const neonPointer = {
    x: neonBox!.x + neonBox!.width / 2,
    y: neonBox!.y + neonBox!.height / 2,
  };
  await page.mouse.move(neonPointer.x, neonPointer.y);
  await expect(floatingGrid).toBeVisible();
  const floatingNeonButton = floatingGrid.getByRole("button", { name: /^Neon\./ });
  const floatingNeonBox = await floatingNeonButton.boundingBox();
  expect(floatingNeonBox).not.toBeNull();
  await page.mouse.click(
    floatingNeonBox!.x + floatingNeonBox!.width / 2,
    floatingNeonBox!.y + floatingNeonBox!.height / 2,
  );
  await expect(floatingGrid.locator(".website-theme-swatch").nth(5)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.mouse.move(0, 0);
  await expect(floatingGrid).toHaveCount(0);
  await expect(inlineGrid.locator(".website-theme-swatch").nth(5)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("footer").scrollIntoViewIfNeeded();

  const committedGeometry = await readThemeGeometry(inlineGrid);
  const committedRowDistance = assertFixedRows(committedGeometry);
  expect(Math.abs(committedRowDistance - initialRowDistance)).toBeLessThanOrEqual(0.5);
  const committedActive = committedGeometry.find((button) => button.pressed);
  const committedInactive = committedGeometry.find((button) => !button.pressed);
  expect(committedActive?.label).toMatch(/^Neon\./);
  expect(committedActive!.surfaceHeight - committedInactive!.surfaceHeight).toBeGreaterThan(8);
});
