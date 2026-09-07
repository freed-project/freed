import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import assets from "../../src/data/showcase.json" with { type: "json" };

// Changed-path website coverage: catches fixed-theme media and animated
// reduced-motion output. Asset bytes, theme registry or component changes
// invalidate this result.
test("showcase follows all theme previews and reduced motion with verified assets", async ({ page, request }) => {
  await page.goto("/");
  const footer = page.locator('footer[aria-label="Site footer"]');
  const image = page.locator(".demo-showcase img");
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const [theme, asset] of Object.entries(assets.themes)) {
      await footer.scrollIntoViewIfNeeded();
      await footer.locator(`[data-theme-preview="${theme}"]`).hover();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const selected = reducedMotion === "reduce" ? asset.poster : asset.animation;
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname)).toBe(selected.url);
      const response = await request.get(selected.url);
      expect(response.ok()).toBeTruthy();
      expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(selected.sha256);
      await footer.getByText("Product", { exact: true }).hover();
    }
  }
});
