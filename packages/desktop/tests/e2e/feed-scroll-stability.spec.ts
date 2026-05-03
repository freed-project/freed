import { test, expect } from "./fixtures/app";

const DELAYED_MEDIA_URL = "/delayed-feed-image.svg";
const BROKEN_MEDIA_URL = "/broken-feed-image.svg";
const DESKTOP_CARD_HEIGHT_BY_DENSITY = {
  compact: 172,
  comfortable: 220,
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

async function injectMixedFeedItems(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    async ({ delayedMediaUrl, brokenMediaUrl }) => {
      const automerge = (window as Record<string, unknown>).__FREED_AUTOMERGE__ as {
        docBatchImportItems: (items: unknown[]) => Promise<unknown>;
      };
      const now = Date.now();
      const longText = "Long preview text ".repeat(60);
      const items = Array.from({ length: 36 }, (_, index) => {
        const isStory = index >= 7 && index <= 9;
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
            tags: index === 3 ? ["alpha", "beta", "gamma", "delta", "epsilon"] : [],
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

      await automerge.docBatchImportItems(items);
    },
    { delayedMediaUrl: DELAYED_MEDIA_URL, brokenMediaUrl: BROKEN_MEDIA_URL },
  );

  await page.waitForFunction(
    () => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as
        | { getState: () => { items: unknown[] } }
        | undefined;
      return (store?.getState().items.length ?? 0) >= 36;
    },
    { timeout: 30_000 },
  );
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
