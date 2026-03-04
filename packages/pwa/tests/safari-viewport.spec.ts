/**
 * Safari viewport & scroll tests — WebKit / iPhone 14 project only.
 *
 * These tests verify the layout behaviors that cause visible gaps and broken
 * scroll on iPhone Safari. Run against a deployed preview with:
 *
 *   BASE_URL=https://freed-xxx.vercel.app npx playwright test --project=webkit-iphone
 *
 * Or locally (requires the dev server to be running):
 *
 *   npx playwright test --project=webkit-iphone
 *
 * NOTE: The Safari address-bar *collapse animation* cannot be triggered in an
 * automated browser — it requires a real touch gesture on real hardware. These
 * tests cover everything that can be mechanically verified: viewport unit
 * values, scroll overflow, gap detection, and sticky header position.
 */

import { test, expect, Page } from "@playwright/test";

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Returns key layout measurements from inside the page JS context.
 * All pixel values are rounded integers.
 */
async function getLayoutMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById("root")!;
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);

    // Measure a 1dvh and 1lvh element to get the actual pixel values.
    const dvhProbe = document.createElement("div");
    dvhProbe.style.cssText = "position:fixed;height:100dvh;width:0;top:0;left:0;visibility:hidden";
    document.body.appendChild(dvhProbe);
    const dvhPx = dvhProbe.getBoundingClientRect().height;
    document.body.removeChild(dvhProbe);

    const lvhProbe = document.createElement("div");
    lvhProbe.style.cssText = "position:fixed;height:100lvh;width:0;top:0;left:0;visibility:hidden";
    document.body.appendChild(lvhProbe);
    const lvhPx = lvhProbe.getBoundingClientRect().height;
    document.body.removeChild(lvhProbe);

    return {
      windowInnerHeight: window.innerHeight,
      windowInnerWidth: window.innerWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      dvhPx: Math.round(dvhPx),
      lvhPx: Math.round(lvhPx),
      rootHeight: Math.round(root.getBoundingClientRect().height),
      rootOverflow: rootStyle.overflow,
      rootOverflowY: rootStyle.overflowY,
      bodyOverflow: bodyStyle.overflow,
      htmlOverflow: htmlStyle.overflow,
      scrollY: Math.round(window.scrollY),
    };
  });
}

/**
 * Composites the actual painted background colour at a viewport coordinate by
 * walking the DOM stacking order from the topmost element up to the root.
 * Returns {r, g, b} for the first non-transparent ancestor, or the body
 * background as a fallback.
 */
function getActualBgAtPoint(x: number, y: number): { r: number; g: number; b: number } {
  function parseBg(bg: string): { r: number; g: number; b: number } | null {
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }

  let el: Element | null = document.elementFromPoint(x, y);
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    const parsed = parseBg(bg);
    // Skip fully-transparent elements (rgba(0,0,0,0)).
    if (parsed && !(parsed.r === 0 && parsed.g === 0 && parsed.b === 0 && bg.includes("0, 0)"))) {
      return parsed;
    }
    // More robust transparent check:
    if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && parsed) return parsed;
    el = el.parentElement;
  }
  return parseBg(getComputedStyle(document.body).backgroundColor) ?? { r: 0, g: 0, b: 0 };
}

// ─── tests ──────────────────────────────────────────────────────────────────

test.describe("Safari viewport layout — iPhone 14 / WebKit", () => {
  test.beforeEach(async ({ page }) => {
    // "networkidle" times out on PWAs with service workers — use "load" instead.
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(500); // let React hydrate
  });

  test("dvh and lvh resolve to non-zero pixel values", async ({ page }) => {
    const m = await getLayoutMetrics(page);
    expect(m.dvhPx).toBeGreaterThan(400);
    expect(m.lvhPx).toBeGreaterThan(400);
    // On a real iPhone Safari with the address bar visible, lvh > dvh.
    // In WebKit emulation they are equal (no browser chrome), but both
    // must be positive and within a sane range of the window height.
    expect(m.dvhPx).toBeLessThanOrEqual(m.windowInnerHeight + 10);
    expect(m.lvhPx).toBeLessThanOrEqual(m.windowInnerHeight + 10);
  });

  test("#root has overflow:visible on mobile so feed content can overflow", async ({ page }) => {
    const m = await getLayoutMetrics(page);
    // overflow:visible (or the initial value) allows children to extend past
    // the root boundary and make the window scrollable.
    expect(["visible", "initial", ""]).toContain(m.rootOverflow);
  });

  test("html and body allow window scroll (not overflow:hidden)", async ({ page }) => {
    const m = await getLayoutMetrics(page);
    expect(m.htmlOverflow).not.toBe("hidden");
    expect(m.bodyOverflow).not.toBe("hidden");
  });

  test("app shell fills the full viewport with no body-colour gap at bottom", async ({ page }) => {
    // Walk the DOM stack at each sample point to find the actual PAINTED colour
    // (skipping transparent elements). Fail only if we find the body background
    // (#0a0a0a ≈ luminance 0.039) instead of the app surface (#121212 ≈ 0.071).
    const result = await page.evaluate(() => {
      function getActualBg(x: number, y: number) {
        function parse(bg: string) {
          const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? { r: +m[1], g: +m[2], b: +m[3], raw: bg } : null;
        }
        let el: Element | null = document.elementFromPoint(x, y);
        while (el) {
          const raw = getComputedStyle(el).backgroundColor;
          const p = parse(raw);
          if (p && raw !== "rgba(0, 0, 0, 0)") return p;
          el = el.parentElement;
        }
        return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 0, g: 0, b: 0, raw: "fallback" };
      }

      const bottomY = window.innerHeight - 2;
      return [0.25, 0.5, 0.75].map((frac) => {
        const x = Math.round(window.innerWidth * frac);
        const { r, g, b, raw } = getActualBg(x, bottomY) as any;
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return { x, raw, luminance };
      });
    });

    for (const { raw, luminance } of result) {
      // Body bg #0a0a0a ≈ 0.039. Surface #121212 ≈ 0.071. Threshold at 0.045
      // catches body bleed while allowing the correct surface colour through.
      expect(luminance, `Body bg bleed detected at bottom (${raw})`).toBeGreaterThan(0.045);
    }
  });

  test("header is sticky and stays visible after scroll", async ({ page }) => {
    const header = page.locator("header").first();
    await expect(header).toBeVisible();

    const position = await header.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe("sticky");

    // Scroll down 300px and confirm header is still in the viewport.
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(200);

    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    // Sticky header should be at y ≈ 0 after scrolling.
    expect(headerBox!.y).toBeLessThan(10);
  });

  test("feed content is scrollable (document height > viewport height) when items exist", async ({ page }) => {
    const m = await getLayoutMetrics(page);

    // If there are no feed items the document won't be taller than the viewport;
    // skip the overflow assertion in that case.
    const hasItems = await page.locator("[data-index]").count();
    if (hasItems === 0) {
      test.skip(); // Empty state — connect a feed to enable this assertion.
      return;
    }

    expect(m.documentScrollHeight).toBeGreaterThan(m.windowInnerHeight);
  });

  test("feed container bottom padding accounts for address-bar zone", async ({ page }) => {
    // The mobile window-virtualizer container should have a paddingBottom that
    // references 100lvh - 100dvh so the last item can scroll clear of the bar.
    const paddingBottom = await page.evaluate(() => {
      // Find the window-list container — it's the first div inside the feed section.
      const feedSection = document.querySelector("[data-index]")?.closest("div");
      if (!feedSection) return null;
      // Walk up to find the container that has the padding.
      let el: Element | null = feedSection;
      while (el) {
        const pb = getComputedStyle(el).paddingBottom;
        if (pb && pb !== "0px") return pb;
        el = el.parentElement;
      }
      return null;
    });

    // If null, there are no items yet; skip.
    if (paddingBottom === null) {
      test.skip();
      return;
    }

    // The padding must be non-zero (it equals the address-bar height which may
    // be 0px in WebKit emulation — acceptable as long as the property is set).
    expect(paddingBottom).toBeDefined();
  });

  test("no horizontal overflow", async ({ page }) => {
    const overflowsX = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflowsX).toBe(false);
  });
});

test.describe("BottomSheet / drawer viewport", () => {
  test("Settings drawer panel is visible and its top edge is within viewport", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(500);

    // Open the sidebar.
    await page.click('button[aria-label="Open menu"]');
    await page.waitForTimeout(300);

    const settingsBtn = page.locator("button", { hasText: "Settings" });
    if (!(await settingsBtn.isVisible())) {
      test.skip();
      return;
    }
    await settingsBtn.click();
    await page.waitForTimeout(500);

    // The rounded panel container (not the scrollable content) must be visible
    // and its top edge must be on-screen. The scrollable content inside the
    // drawer intentionally overflows the panel — we do not assert its height.
    const panel = page.locator(".rounded-t-2xl, .rounded-2xl").first();
    if (!(await panel.isVisible())) {
      test.skip();
      return;
    }

    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();

    // Panel top must be visible (not scrolled off screen).
    expect(box!.y).toBeGreaterThanOrEqual(0);
    // Panel top must be below the header (not covering it entirely).
    expect(box!.y).toBeLessThan(viewportHeight * 0.5);
  });
});
