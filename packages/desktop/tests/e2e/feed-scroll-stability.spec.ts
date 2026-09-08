import { test, expect } from "./fixtures/app";

const DELAYED_MEDIA_URL = "/delayed-feed-image.svg";
const BROKEN_MEDIA_URL = "/broken-feed-image.svg";
const DESKTOP_CARD_HEIGHT_BY_DENSITY = {
  compact: 136,
  comfortable: 204,
  expansive: 300,
} as const;
type DesktopCardDensity = keyof typeof DESKTOP_CARD_HEIGHT_BY_DENSITY;

function svgBody(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#e8dcc7"/><rect x="30" y="30" width="580" height="300" rx="24" fill="#c7aa7a"/><text x="320" y="190" text-anchor="middle" font-family="Arial" font-size="34" fill="#352515">${label}</text></svg>`;
}

async function disableReadOnScroll(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        preferences: {
          display: {
            reading: Record<string, unknown>;
          };
        };
        updatePreferences: (update: unknown) => Promise<void>;
      };
    };

    const state = store.getState();
    await state.updatePreferences({
      display: {
        ...state.preferences.display,
        animationIntensity: "none",
        reading: {
          ...state.preferences.display.reading,
          markReadOnScroll: false,
        },
      },
    });
  });
}

async function setCardDensity(page: import("@playwright/test").Page, density: DesktopCardDensity): Promise<void> {
  await page.addInitScript((nextDensity) => {
    window.localStorage.setItem("freed-feed-card-density", nextDensity);
  }, density);
}

async function injectMixedFeedItems(page: import("@playwright/test").Page, storyIndices = [7, 8, 9], count = 36): Promise<void> {
  await page.evaluate(
    async ({ delayedMediaUrl, brokenMediaUrl, storyIndices, count }) => {
      const libraryCore = (window as Record<string, unknown>).__FREED_LIBRARY_CORE__ as {
        importLibraryItems: (items: unknown[]) => Promise<unknown>;
      };
      const now = Date.now();
      const longText = "Long preview text ".repeat(60);
      const items = Array.from({ length: count }, (_, index) => {
        const isStory = storyIndices.includes(index);
        const hasDelayedMedia = index % 4 === 1 || isStory;
        const hasBrokenMedia = index === 5;
        const globalId = isStory
          ? `test-scroll-stability-story-${index}`
          : `test-scroll-stability-item-${index}`;

        return {
          globalId,
          platform: isStory ? "instagram" : index % 3 === 0 ? "facebook" : "rss",
          contentType: isStory ? "story" : "article",
          capturedAt: now - index * 60_000,
          publishedAt: now - index * 60_000,
          author: {
            id: `scroll-stability-author-${index}`,
            handle: `scroll-stability-${index}`,
            displayName: `Scroll Stability ${index.toLocaleString()}`,
          },
          content: {
            text: index % 2 === 0 ? longText : `Mixed fixed-height preview ${index.toLocaleString()}`,
            mediaUrls: hasBrokenMedia
              ? [brokenMediaUrl]
              : hasDelayedMedia
              ? [`${delayedMediaUrl}?item=${index.toLocaleString()}`]
              : [],
            mediaTypes: hasBrokenMedia || hasDelayedMedia ? ["image"] : [],
            linkPreview: {
              url: `https://example.com/stable-feed-${index.toLocaleString()}`,
              title: `Stable Feed Row ${index.toLocaleString()}`,
              description: `Fixed row regression item ${index.toLocaleString()}`,
            },
          },
          contentSignals: index === 4
            ? {
                version: 1,
                method: "manual",
                inferredAt: now,
                scores: { deadline: 1 },
                tags: ["deadline"],
              }
            : undefined,
          eventCandidate: index === 6
            ? {
                version: 1,
                method: "manual",
                detectedAt: now,
                confidence: 0.95,
                startsAt: now + 86_400_000,
              }
            : undefined,
          userState: {
            hidden: false,
            saved: false,
            archived: false,
            tags: index === 3 ? ["scroll-stability", "alpha", "beta", "gamma", "delta", "epsilon"] : ["scroll-stability"],
          },
          topics: ["scroll", "stability"],
          rssSource: isStory
            ? undefined
            : {
                feedUrl: "https://example.com/stable-feed.xml",
                feedTitle: "Stable Feed",
                siteUrl: "https://example.com",
              },
          sourceUrl: `https://example.com/stable-feed-${index.toLocaleString()}`,
        };
      });

      await libraryCore.importLibraryItems(items);
    },
    { delayedMediaUrl: DELAYED_MEDIA_URL, brokenMediaUrl: BROKEN_MEDIA_URL, storyIndices, count },
  );

  // The Library reader is authoritative; the renderer no longer owns a
  // corpus-wide store.items array. Wait for the imported window to render.
  await expect(page.locator('[data-feed-item-id="test-scroll-stability-item-0"]').first()).toBeVisible();

}

async function collectVisibleGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const container = document.querySelector('[data-testid="feed-list-scroll-container"]') as HTMLElement;
    const total = container.firstElementChild as HTMLElement;
    const rows = Array.from(container.querySelectorAll("[data-feed-row-index]"), (element) => {
      const el = element as HTMLElement;
      const rect = el.getBoundingClientRect();
      return {
        index: Number(el.dataset.feedRowIndex),
        top: round(rect.top),
        height: round(rect.height),
        transform: el.style.transform,
      };
    });
    const cards = Array.from(container.querySelectorAll("[data-feed-item-id]"), (element) => {
      const el = element as HTMLElement;
      const rect = el.getBoundingClientRect();
      const computedHeight = Number.parseFloat(window.getComputedStyle(el).height);
      return {
        id: el.dataset.feedItemId ?? "",
        top: round(rect.top),
        height: round(rect.height),
        computedHeight: round(computedHeight),
      };
    });

    return {
      scrollTop: round(container.scrollTop),
      totalHeight: round(total.getBoundingClientRect().height),
      rows,
      cards,
    };
  });
}

test("desktop feed shows loading status until its bounded query completes", async ({
  app,
  page,
}) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const root = window as Record<string, unknown>;
    const handlers = root.__TAURI_MOCK_HANDLERS__ as Record<
      string,
      (args: { request?: { queryId?: string } }) => unknown
    >;
    const original = handlers.query_normalized_library;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    root.__RELEASE_FEED_QUERY__ = () => {
      handlers.query_normalized_library = original;
      release();
    };
    handlers.query_normalized_library = async (args) => {
      if (args.request?.queryId === "feed_browse_page_v3") await pending;
      return original(args);
    };
    const store = root.__FREED_STORE__ as {
      getState: () => { setFilter: (filter: { platform: string }) => void };
    };
    store.getState().setFilter({ platform: "rss" });
  });

  const loading = page
    .getByRole("status")
    .filter({ hasText: "Loading feed" });
  await expect(loading).toBeVisible();
  await page.evaluate(() => {
    (
      (window as Record<string, unknown>)
        .__RELEASE_FEED_QUERY__ as () => void
    )();
  });
  await expect(loading).toHaveCount(0);
});

for (const [density, expectedCardHeight] of Object.entries(DESKTOP_CARD_HEIGHT_BY_DENSITY) as Array<[DesktopCardDensity, number]>) {
  test(`desktop ${density} feed rows do not shift when media loads or fails`, async ({ app, page }) => {
    let releaseDelayedImages!: () => void;
    const delayedImages = new Promise<void>((resolve) => {
      releaseDelayedImages = resolve;
    });

    await setCardDensity(page, density);
    await page.route(`**${DELAYED_MEDIA_URL}?*`, async (route) => {
      await delayedImages;
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: svgBody("delayed"),
      });
    });
    await page.route(`**${BROKEN_MEDIA_URL}`, async (route) => {
      await route.fulfill({ status: 404, body: "" });
    });

    await app.goto();
    await app.waitForReady();
    await disableReadOnScroll(page);
    await injectMixedFeedItems(page);

    const scrollContainer = page.getByTestId("feed-list-scroll-container");
    await expect(scrollContainer).toBeVisible();
    await scrollContainer.evaluate((element) => {
      element.scrollTop = 520;
    });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    const before = await collectVisibleGeometry(page);
    expect(before.cards.length).toBeGreaterThan(0);
    for (const card of before.cards) {
      expect(card.computedHeight).toBe(expectedCardHeight);
    }

    releaseDelayedImages();
    await page.waitForFunction(() =>
      Array.from(document.images)
        .filter((image) => image.currentSrc.includes("delayed-feed-image.svg"))
        .every((image) => image.complete),
    );

    const brokenImage = page.locator(`img[src="${BROKEN_MEDIA_URL}"]`).first();
    if (await brokenImage.count()) {
      await brokenImage.evaluate((image) => {
        image.dispatchEvent(new Event("error"));
      });
    }
    await page.waitForTimeout(100);

    const after = await collectVisibleGeometry(page);
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(after.totalHeight).toBe(before.totalHeight);
    expect(after.rows).toEqual(before.rows);
    expect(after.cards).toEqual(before.cards);
  });
}

// Cross-component contract: display packing, keyboard order and the reader
// rail must agree while the canonical Library reader stays sorted.
test("nearby stories share rows and keyboard navigation follows their display order", async ({
  app,
  page,
}) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? route.continue()
      : route.abort();
  });
  await page.route(`**${DELAYED_MEDIA_URL}?*`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: svgBody("Story"),
    }),
  );
  await page.route(`**${BROKEN_MEDIA_URL}`, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await app.goto();
  await app.waitForReady();
  await disableReadOnScroll(page);
  await injectMixedFeedItems(page, [1, 3, 5]);
  await page.evaluate(() => {
    const store = (
      window as unknown as {
        __FREED_STORE__: {
          getState: () => { setFilter: (filter: unknown) => void };
        };
      }
    ).__FREED_STORE__;
    store.getState().setFilter({ tags: ["scroll-stability"] });
  });
  const feed = page.getByTestId("feed-list-scroll-container");
  await expect(feed).toBeVisible();
  const story1 = feed.locator(
    '[data-feed-item-id="test-scroll-stability-story-1"]',
  );
  const story3 = feed.locator(
    '[data-feed-item-id="test-scroll-stability-story-3"]',
  );
  await expect(story1).toBeVisible();
  await expect(story3).toBeVisible();
  expect(
    await story1.evaluate((el) =>
      el.closest("[data-feed-row-index]")?.getAttribute("data-feed-row-index"),
    ),
  ).toBe(
    await story3.evaluate((el) =>
      el.closest("[data-feed-row-index]")?.getAttribute("data-feed-row-index"),
    ),
  );
  await page.keyboard.press("j");
  await expect(story1).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("j");
  await expect(story3).toHaveAttribute("data-focused", "true");
  await page.screenshot({
    path: "test-results/story-presentation-desktop.png",
  });
  await page.keyboard.press("Enter");
  const compact = page.getByTestId("compact-feed-panel-scroll-container");
  await expect(compact).toBeVisible();
  await expect(
    compact.locator('[data-feed-item-id="test-scroll-stability-story-3"]'),
  ).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(
    compact.locator('[data-feed-item-id="test-scroll-stability-story-5"]'),
  ).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(
    compact.locator('[data-feed-item-id="test-scroll-stability-item-0"]'),
  ).toHaveAttribute("data-selected", "true");
  await compact.evaluate((el) => {
    el.scrollTop = 220;
  });
  const anchorId = await compact.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    return [...element.querySelectorAll<HTMLElement>("[data-feed-item-id]")]
      .find((node) => node.getBoundingClientRect().bottom > top)!.dataset.feedItemId!;
  });
  const anchorCard = compact.locator(`[data-feed-item-id="${anchorId}"]`);
  const anchorOffset = await anchorCard.evaluate((el) =>
    el.getBoundingClientRect().top -
    el.closest('[data-testid="compact-feed-panel-scroll-container"]')!.getBoundingClientRect().top,
  );
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 100);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 160, box!.y + 100, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      anchorCard.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          el
            .closest('[data-testid="compact-feed-panel-scroll-container"]')!
            .getBoundingClientRect().top,
      ),
    )
    .toBeCloseTo(anchorOffset, 0);
  const compactRow = (id: string) =>
    compact
      .locator(`[data-feed-item-id="${id}"]`)
      .evaluate((el) =>
        el
          .closest("[data-compact-panel-index]")
          ?.getAttribute("data-compact-panel-index"),
      );
  expect(await compactRow("test-scroll-stability-story-1")).toBe(
    await compactRow("test-scroll-stability-story-3"),
  );
  await compact.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: "test-results/story-presentation-reader.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStory1 = page.locator(
    '[data-feed-item-id="test-scroll-stability-story-1"]',
  );
  const mobileStory3 = page.locator(
    '[data-feed-item-id="test-scroll-stability-story-3"]',
  );
  await expect(mobileStory1).toBeVisible();
  await expect
    .poll(() =>
      mobileStory1.evaluate((el) =>
        el
          .closest("[data-feed-row-index]")
          ?.getAttribute("data-feed-row-index"),
      ),
    )
    .toBe(
      await mobileStory3.evaluate((el) =>
        el
          .closest("[data-feed-row-index]")
          ?.getAttribute("data-feed-row-index"),
      ),
    );
  await page.screenshot({ path: "test-results/story-presentation-mobile.png" });
});

// Preserve actual viewport content when read-on-scroll refreshes multiple pages.
test("read-on-scroll keeps story rows stable across loaded and evicted pages", async ({ app, page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.route(`**${DELAYED_MEDIA_URL}?*`, (route) => route.fulfill({ contentType: "image/svg+xml", body: svgBody("Story") }));
  await page.route(`**${BROKEN_MEDIA_URL}`, (route) => route.fulfill({ status: 404, body: "" }));
  await app.goto();
  await app.waitForReady();
  await injectMixedFeedItems(page, [9, ...Array.from({ length: 65 }, (_, i) => 15 + i * 5)], 360);
  await page.evaluate(async () => {
    const w = window as any;
    const state = w.__FREED_STORE__.getState();
    await state.updatePreferences({ display: { ...state.preferences.display, animationIntensity: "none", reading: { ...state.preferences.display.reading, markReadOnScroll: true } } });
    w.__FREED_STORE__.getState().setFilter({ tags: ["scroll-stability"] });
  });
  const feed = page.getByTestId("feed-list-scroll-container");
  await expect(feed.locator('[data-feed-item-id="test-scroll-stability-story-9"]')).toBeInViewport();
  await page.clock.install();
  const initialVersion = await page.evaluate(() => (window as any).__FREED_STORE__.getState().libraryItemVersion);
  let sawStoryGrid = false;
  for (let step = 0; step < 16; step++) {
    const before = await feed.evaluate(async (element) => {
      element.scrollTop += 3500;
      await new Promise(requestAnimationFrame);
      const bounds = element.getBoundingClientRect();
      const visible = [...element.querySelectorAll<HTMLElement>("[data-feed-item-id]")]
        .filter((node) => { const r = node.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom; })
        .map((node) => ({ id: node.dataset.feedItemId!, y: Math.round(node.getBoundingClientRect().top) }));
      const storyGrid = [...element.querySelectorAll("[data-feed-row-index]")].some((row) => {
        const bounds = row.getBoundingClientRect();
        return bounds.bottom > element.getBoundingClientRect().top && bounds.top < element.getBoundingClientRect().bottom && row.querySelectorAll("[data-feed-item-id]").length > 1;
      });
      return { visible, storyGrid };
    });
    sawStoryGrid ||= before.storyGrid;
    // Advance the real read-flush timer deterministically. An eviction may
    // establish a new baseline without a flush; its viewport must stay put too.
    await page.clock.runFor(250);
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    for (const anchor of before.visible) {
      const item = feed.locator(`[data-feed-item-id="${anchor.id}"]`);
      await expect(item).toBeInViewport();
      expect(Math.abs((await item.boundingBox())!.y - anchor.y)).toBeLessThanOrEqual(2);
    }
  }
  expect(sawStoryGrid).toBe(true);
  expect(await page.evaluate(() => (window as any).__FREED_STORE__.getState().libraryItemVersion)).toBeGreaterThan(initialVersion + 3);
});
