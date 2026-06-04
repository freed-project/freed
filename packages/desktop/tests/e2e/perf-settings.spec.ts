import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const SETTINGS_FEED_COUNT = 1_600;
const SETTINGS_MOUNT_BUDGET_MS = process.env.CI ? 4_000 : 1_000;
const SETTINGS_SEARCH_BUDGET_MS = process.env.CI ? 1_200 : 500;
const SETTINGS_LIST_FILTER_BUDGET_MS = process.env.CI ? 1_200 : 500;
const SETTINGS_FRAME_P95_BUDGET_MS = process.env.CI ? 140 : 80;
const SETTINGS_DROPPED_FRAME_BUDGET = process.env.CI ? 36 : 24;
const SETTINGS_LONG_TASK_COUNT_BUDGET = 2;
const SETTINGS_DOM_NODE_BUDGET = 1_400;

async function seedLargeSettingsWorkspace(page: Page): Promise<void> {
  await page.evaluate((feedCount) => {
    const now = Date.now();
    const feeds = Object.fromEntries(
      Array.from({ length: feedCount }, (_, index) => {
        const url = `https://settings-scale.example/feed-${index}.xml`;
        return [
          url,
          {
            url,
            title: `Settings Scale Feed ${index.toLocaleString()}`,
            siteUrl: `https://settings-scale.example/${index.toLocaleString()}`,
            enabled: true,
            trackUnread: true,
            createdAt: now - index * 1_000,
            updatedAt: now - index * 1_000,
          },
        ];
      }),
    );
    const feedTotalCounts = Object.fromEntries(
      Object.keys(feeds).map((url, index) => [url, (index % 11) + 1]),
    );
    const feedUnreadCounts = Object.fromEntries(
      Object.keys(feeds).map((url, index) => [url, index % 5]),
    );
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          setState: (partial: Record<string, unknown>) => void;
        }
      | undefined;
    store?.setState({
      feeds,
      feedTotalCounts,
      feedUnreadCounts,
      totalItemCount: feedCount,
      itemCountByPlatform: { rss: feedCount },
      totalUnreadCount: Math.floor(feedCount / 5),
      unreadCountByPlatform: { rss: Math.floor(feedCount / 5) },
    });
  }, SETTINGS_FEED_COUNT);
}

async function openSettings(page: Page): Promise<void> {
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await expect(settingsButton).toBeVisible({ timeout: 5_000 });
  await settingsButton.click();
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });
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
    w.__SETTINGS_PERF_RAF_DELTAS__ = deltas;
    w.__SETTINGS_PERF_RAF_STOP__ = () => {
      running = false;
    };
  });

  await fn();

  return page.evaluate(() => {
    const w = window as Record<string, unknown>;
    (w.__SETTINGS_PERF_RAF_STOP__ as () => void)();
    const deltas = ((w.__SETTINGS_PERF_RAF_DELTAS__ as number[]) ?? []).slice();
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
    w.__SETTINGS_PERF_LONG_TASKS__ = [] as PerformanceEntry[];
    const observer = new PerformanceObserver((list) => {
      const tasks = w.__SETTINGS_PERF_LONG_TASKS__ as PerformanceEntry[];
      tasks.push(...list.getEntries());
    });
    observer.observe({ type: "longtask", buffered: false });
    w.__SETTINGS_PERF_LONG_TASK_OBSERVER__ = observer;
  });

  const result = await fn();

  const taskData = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const observer = w.__SETTINGS_PERF_LONG_TASK_OBSERVER__ as PerformanceObserver;
    observer.disconnect();
    const tasks = (w.__SETTINGS_PERF_LONG_TASKS__ as PerformanceEntry[]) ?? [];
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

test("Settings dialog stays responsive with 1,600 RSS sources", async ({ app, page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedLargeSettingsWorkspace(page);

  const mountStartedAt = Date.now();
  await openSettings(page);
  const settingsDialog = page.locator(".fixed.inset-0.z-50").last();
  await expect(settingsDialog).toBeVisible({ timeout: 10_000 });
  await expect(settingsDialog.getByRole("heading", { name: "Appearance" })).toBeVisible();
  const mountElapsed = Date.now() - mountStartedAt;
  const initialDomNodes = await page.evaluate(() => document.querySelectorAll("*").length);

  const scrollContainer = page.getByTestId("settings-scroll-container");
  await scrollContainer.hover();
  const settingsShell = settingsDialog.locator(".theme-settings-shell");
  await expect(settingsShell).not.toHaveAttribute("data-moving", "true");
  await expect(settingsShell).toHaveCSS("transform", "none");
  await expect(settingsShell).not.toHaveCSS("backdrop-filter", "none");
  await expect(scrollContainer).toHaveCSS("will-change", "auto");
  const scrollInteraction = await collectLongTasksDuring(page, () =>
    measureFps(page, async () => {
      await scrollContainer.evaluate((element) => new Promise<void>((resolve) => {
        let frame = 0;
        const scrollable = element as HTMLElement;
        function step() {
          scrollable.scrollTop += frame < 18 ? 90 : -90;
          frame += 1;
          if (frame >= 36) {
            resolve();
            return;
          }
          requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }));
      await page.waitForTimeout(80);
    }),
  );

  const searchInput = settingsDialog.getByRole("textbox", { name: "Search settings" });
  const searchInteraction = await collectLongTasksDuring(page, () =>
    measureFps(page, async () => {
      const searchStartedAt = Date.now();
      await searchInput.fill("feeds");
      await expect(settingsDialog.getByRole("button", { name: /^Feeds$/ })).toBeVisible({
        timeout: 10_000,
      });
      const searchElapsed = Date.now() - searchStartedAt;
      await page.evaluate((elapsed) => {
        (window as Record<string, unknown>).__SETTINGS_SEARCH_ELAPSED_MS__ = elapsed;
      }, searchElapsed);
      await page.waitForTimeout(240);
    }),
  );

  const searchElapsed = await page.evaluate(() =>
    (window as Record<string, unknown>).__SETTINGS_SEARCH_ELAPSED_MS__ as number,
  );
  const filteredDomNodes = await page.evaluate(() => document.querySelectorAll("*").length);
  const feedFilterInput = page.getByTestId("feeds-manage-filter");
  const listFilterInteraction = await collectLongTasksDuring(page, () =>
    measureFps(page, async () => {
      const listFilterStartedAt = Date.now();
      await feedFilterInput.fill("feed-1599");
      await expect(settingsDialog.getByText(/^1 of 1,600$/)).toBeVisible({ timeout: 10_000 });
      const listFilterElapsed = Date.now() - listFilterStartedAt;
      await page.evaluate((elapsed) => {
        (window as Record<string, unknown>).__SETTINGS_LIST_FILTER_ELAPSED_MS__ = elapsed;
      }, listFilterElapsed);
      await page.waitForTimeout(240);
    }),
  );
  const listFilterElapsed = await page.evaluate(() =>
    (window as Record<string, unknown>).__SETTINGS_LIST_FILTER_ELAPSED_MS__ as number,
  );
  const listFilteredDomNodes = await page.evaluate(() => document.querySelectorAll("*").length);

  console.log(`[PERF] Settings mount: ${mountElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Settings initial DOM nodes: ${initialDomNodes.toLocaleString()}`);
  console.log(`[PERF] Settings search: ${searchElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Settings filtered DOM nodes: ${filteredDomNodes.toLocaleString()}`);
  console.log(`[PERF] Settings inner list filter: ${listFilterElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Settings inner list filtered DOM nodes: ${listFilteredDomNodes.toLocaleString()}`);
  console.log(`[PERF] Settings scroll FPS: ${scrollInteraction.result.fps.toLocaleString()}`);
  console.log(`[PERF] Settings scroll p95 frame: ${scrollInteraction.result.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Settings scroll dropped frames: ${scrollInteraction.result.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Settings scroll long tasks: ${scrollInteraction.count.toLocaleString()}`);
  console.log(`[PERF] Settings scroll worst long task: ${scrollInteraction.worstMs.toFixed(1)} ms`);
  console.log(`[PERF] Settings search FPS: ${searchInteraction.result.fps.toLocaleString()}`);
  console.log(`[PERF] Settings search p95 frame: ${searchInteraction.result.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Settings search dropped frames: ${searchInteraction.result.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Settings search long tasks: ${searchInteraction.count.toLocaleString()}`);
  console.log(`[PERF] Settings search worst long task: ${searchInteraction.worstMs.toFixed(1)} ms`);
  console.log(`[PERF] Settings inner list filter FPS: ${listFilterInteraction.result.fps.toLocaleString()}`);
  console.log(`[PERF] Settings inner list filter p95 frame: ${listFilterInteraction.result.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Settings inner list filter dropped frames: ${listFilterInteraction.result.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Settings inner list filter long tasks: ${listFilterInteraction.count.toLocaleString()}`);
  console.log(`[PERF] Settings inner list filter worst long task: ${listFilterInteraction.worstMs.toFixed(1)} ms`);

  expect(mountElapsed).toBeLessThan(SETTINGS_MOUNT_BUDGET_MS);
  expect(searchElapsed).toBeLessThan(SETTINGS_SEARCH_BUDGET_MS);
  expect(listFilterElapsed).toBeLessThan(SETTINGS_LIST_FILTER_BUDGET_MS);
  expect(initialDomNodes).toBeLessThan(SETTINGS_DOM_NODE_BUDGET);
  expect(filteredDomNodes).toBeLessThan(SETTINGS_DOM_NODE_BUDGET);
  expect(listFilteredDomNodes).toBeLessThan(SETTINGS_DOM_NODE_BUDGET);
  expect(scrollInteraction.result.sampleCount).toBeGreaterThan(0);
  expect(scrollInteraction.result.p95Ms).toBeLessThanOrEqual(SETTINGS_FRAME_P95_BUDGET_MS);
  expect(scrollInteraction.result.droppedFrames).toBeLessThanOrEqual(SETTINGS_DROPPED_FRAME_BUDGET);
  expect(scrollInteraction.count).toBeLessThanOrEqual(SETTINGS_LONG_TASK_COUNT_BUDGET);
  expect(searchInteraction.result.sampleCount).toBeGreaterThan(0);
  expect(searchInteraction.result.p95Ms).toBeLessThan(SETTINGS_FRAME_P95_BUDGET_MS);
  expect(searchInteraction.result.droppedFrames).toBeLessThanOrEqual(SETTINGS_DROPPED_FRAME_BUDGET);
  expect(searchInteraction.count).toBeLessThanOrEqual(SETTINGS_LONG_TASK_COUNT_BUDGET);
  expect(listFilterInteraction.result.sampleCount).toBeGreaterThan(0);
  expect(listFilterInteraction.result.p95Ms).toBeLessThan(SETTINGS_FRAME_P95_BUDGET_MS);
  expect(listFilterInteraction.result.droppedFrames).toBeLessThanOrEqual(SETTINGS_DROPPED_FRAME_BUDGET);
  expect(listFilterInteraction.count).toBeLessThanOrEqual(SETTINGS_LONG_TASK_COUNT_BUDGET);
});
