import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const MAP_AUTHOR_COUNT = 1_600;
const MAP_ITEM_COUNT = MAP_AUTHOR_COUNT * 3;
const MAP_MOUNT_BUDGET_MS = process.env.CI ? 4_500 : 1_500;
const MAP_FRAME_P95_BUDGET_MS = process.env.CI ? 67 : 50;
const MAP_DROPPED_FRAME_BUDGET = process.env.CI ? 40 : 12;
const MAP_LONG_TASK_COUNT_BUDGET = process.env.CI ? 4 : 2;
const MAP_MARKER_DOM_BUDGET = 160;
const MAP_MOVING_MARKER_PAINT_BUDGET = 48;

async function seedLargeMapWorkspace(page: Page): Promise<void> {
  await page.evaluate(async ({ authorCount, itemCount }) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };

    const now = Date.now();
    const providers = ["instagram", "x", "facebook", "linkedin"];
    const items = Array.from({ length: itemCount }, (_, index) => {
      const authorIndex = index % authorCount;
      const provider = providers[authorIndex % providers.length]!;
      const lat = 25 + (authorIndex % 90) * 0.42;
      const lng = -124 + (Math.floor(authorIndex / 90) % 90) * 0.76;
      return {
        globalId: `map-scale-item-${index}`,
        platform: provider,
        contentType: "post",
        capturedAt: now - index * 30_000,
        publishedAt: now - index * 30_000,
        author: {
          id: `map-author-${authorIndex}`,
          handle: `map-author-${authorIndex}`,
          displayName: `Map Author ${authorIndex}`,
        },
        content: {
          text: `Map scale benchmark post ${index.toLocaleString()}`,
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: `Map Point ${authorIndex}`,
          coordinates: { lat, lng },
          source: "geo_tag",
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: ["map", "scale"],
      };
    });

    await automerge.docBatchImportItems(items);
  }, { authorCount: MAP_AUTHOR_COUNT, itemCount: MAP_ITEM_COUNT });
}

async function measureFps(
  page: Page,
  fn: () => Promise<void>,
): Promise<{ p95Ms: number; droppedFrames: number; fps: number; sampleCount: number }> {
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const deltas: number[] = [];
    let last: number | null = null;
    let running = true;
    function loop(ts: number) {
      if (!running) return;
      if (last !== null) deltas.push(ts - last);
      last = ts;
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    w.__MAP_PERF_RAF_DELTAS__ = deltas;
    w.__MAP_PERF_RAF_STOP__ = () => {
      running = false;
    };
  });

  await fn();

  return page.evaluate(() => {
    const w = window as Record<string, unknown>;
    (w.__MAP_PERF_RAF_STOP__ as () => void)();
    const deltas = ((w.__MAP_PERF_RAF_DELTAS__ as number[]) ?? []).slice();
    if (deltas.length < 2) return { p95Ms: 0, droppedFrames: 0, fps: 0, sampleCount: deltas.length };
    const sorted = [...deltas].sort((left, right) => left - right);
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
    const average = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
    return {
      p95Ms: Math.round(p95 * 10) / 10,
      droppedFrames: deltas.filter((delta) => delta > 32).length,
      fps: Math.round(1_000 / average),
      sampleCount: deltas.length,
    };
  });
}

async function collectLongTasksDuring<T>(
  page: Page,
  fn: () => Promise<T>,
): Promise<{ result: T; count: number; worstMs: number }> {
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    w.__MAP_PERF_LONG_TASKS__ = [] as PerformanceEntry[];
    const observer = new PerformanceObserver((list) => {
      const tasks = w.__MAP_PERF_LONG_TASKS__ as PerformanceEntry[];
      tasks.push(...list.getEntries());
    });
    observer.observe({ type: "longtask", buffered: false });
    w.__MAP_PERF_LONG_TASK_OBSERVER__ = observer;
  });

  const result = await fn();

  const taskData = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const observer = w.__MAP_PERF_LONG_TASK_OBSERVER__ as PerformanceObserver;
    observer.disconnect();
    const tasks = (w.__MAP_PERF_LONG_TASKS__ as PerformanceEntry[]) ?? [];
    return {
      count: tasks.length,
      worstMs: Math.max(0, ...tasks.map((task) => task.duration)),
    };
  });

  return {
    result,
    count: taskData.count,
    worstMs: Math.round(taskData.worstMs * 10) / 10,
  };
}

test("Map view handles 1,600 visible location authors within frame budget", async ({ app, page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    (
      window as Window & {
        __FREED_E2E_MAP_TIME_REFRESH_MS__?: number;
      }
    ).__FREED_E2E_MAP_TIME_REFRESH_MS__ = 120;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedLargeMapWorkspace(page);
  await page.waitForFunction(
    (expectedCount: number) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { items: unknown[] } }
        | undefined;
      return (store?.getState().items.length ?? 0) >= expectedCount;
    },
    MAP_ITEM_COUNT,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(600);
  await page.reload();
  await app.waitForReady();
  await page.waitForTimeout(1_000);

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { mapMode: "all_content"; mapTimeMode: "current"; themeId: string } }) => Promise<void>;
      };
    };
    await store.getState().updatePreferences({
      display: {
        mapMode: "all_content",
        mapTimeMode: "current",
        themeId: "scriptorium",
      },
    });
  });
  await page.waitForTimeout(600);
  const mountStartedAt = Date.now();
  await page.getByRole("button", { name: /^Map$/ }).click();

  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => page.locator(".freed-map-marker").count(), { timeout: 30_000 })
    .toBe(MAP_MARKER_DOM_BUDGET);

  const mountElapsed = Date.now() - mountStartedAt;
  const markerCount = await page.locator(".freed-map-marker").count();
  const movingPrimaryMarkerCount = await page.locator('.freed-map-marker[data-map-moving-priority="primary"]').count();
  const movingDeferredMarkerCount = await page.locator('.freed-map-marker[data-map-moving-priority="deferred"]').count();
  const totalMarkerCount = await page.getByTestId("map-surface").evaluate((element) =>
    Number.parseInt(element.getAttribute("data-map-total-markers") ?? "0", 10),
  );
  await page.locator(".freed-map-marker").evaluateAll((elements) => {
    elements.forEach((element, index) => {
      element.setAttribute("data-marker-stability-token", `marker-${index}`);
    });
  });
  await page.waitForTimeout(360);
  const retainedMarkerCount = await page.locator(".freed-map-marker[data-marker-stability-token]").count();
  const domNodeCount = await page.evaluate(() => document.querySelectorAll("*").length);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => page.getByTestId("map-surface").getAttribute("data-map-moving"), { timeout: 1_000 })
    .toBe("true");
  const movingVisibleMarkerCount = await page.getByTestId("map-surface").evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>(".freed-map-marker"))
      .filter((marker) => window.getComputedStyle(marker).display !== "none")
      .length,
  );
  await expect
    .poll(async () => page.getByTestId("map-surface").getAttribute("data-map-moving"), { timeout: 2_000 })
    .toBe("false");

  const interaction = await collectLongTasksDuring(page, () =>
    measureFps(page, async () => {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(180);
      await page.mouse.wheel(0, -900);
      await page.waitForTimeout(180);
      const marker = page.locator(".freed-map-marker").nth(Math.floor(MAP_MOVING_MARKER_PAINT_BUDGET / 2));
      await marker.click({ force: true });
      await page.waitForTimeout(220);
    }),
  );

  console.log(`[PERF] Map mount: ${mountElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Map marker DOM count: ${markerCount.toLocaleString()}`);
  console.log(`[PERF] Map moving primary markers: ${movingPrimaryMarkerCount.toLocaleString()}`);
  console.log(`[PERF] Map moving deferred markers: ${movingDeferredMarkerCount.toLocaleString()}`);
  console.log(`[PERF] Map visible markers while moving: ${movingVisibleMarkerCount.toLocaleString()}`);
  console.log(`[PERF] Map stable markers after timer refresh: ${retainedMarkerCount.toLocaleString()}`);
  console.log(`[PERF] Map total markers: ${totalMarkerCount.toLocaleString()}`);
  console.log(`[PERF] Map DOM nodes: ${domNodeCount.toLocaleString()}`);
  console.log(`[PERF] Map interaction FPS: ${interaction.result.fps.toLocaleString()}`);
  console.log(`[PERF] Map interaction p95 frame: ${interaction.result.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Map interaction dropped frames: ${interaction.result.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Map interaction long tasks: ${interaction.count.toLocaleString()}`);
  console.log(`[PERF] Map interaction worst long task: ${interaction.worstMs.toFixed(1)} ms`);

  expect(mountElapsed).toBeLessThan(MAP_MOUNT_BUDGET_MS);
  expect(totalMarkerCount).toBe(MAP_AUTHOR_COUNT);
  expect(markerCount).toBeLessThanOrEqual(MAP_MARKER_DOM_BUDGET);
  expect(retainedMarkerCount).toBe(markerCount);
  expect(movingPrimaryMarkerCount).toBeLessThanOrEqual(MAP_MOVING_MARKER_PAINT_BUDGET);
  expect(movingPrimaryMarkerCount + movingDeferredMarkerCount).toBe(markerCount);
  expect(movingVisibleMarkerCount).toBeLessThanOrEqual(MAP_MOVING_MARKER_PAINT_BUDGET);
  expect(interaction.result.p95Ms).toBeLessThan(MAP_FRAME_P95_BUDGET_MS);
  expect(interaction.result.droppedFrames).toBeLessThanOrEqual(MAP_DROPPED_FRAME_BUDGET);
  expect(interaction.count).toBeLessThanOrEqual(MAP_LONG_TASK_COUNT_BUDGET);
});
