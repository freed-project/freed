import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const SIDEBAR_FEED_COUNT = 1_600;
const SIDEBAR_FEED_PAGE_SIZE = 10;
const SIDEBAR_MOUNT_BUDGET_MS = process.env.CI ? 4_000 : 1_000;
const SIDEBAR_SEARCH_BUDGET_MS = process.env.CI ? 1_200 : 500;
const SIDEBAR_FRAME_P95_BUDGET_MS = process.env.CI ? 67 : 50;
const SIDEBAR_DROPPED_FRAME_BUDGET = process.env.CI ? 24 : 8;
const SIDEBAR_LONG_TASK_COUNT_BUDGET = 2;
const SIDEBAR_FEED_ROW_DOM_BUDGET = SIDEBAR_FEED_PAGE_SIZE + 2;

async function seedLargeSidebarFeedList(page: Page): Promise<void> {
  await page.evaluate((feedCount) => {
    const now = Date.now();
    const feeds = Object.fromEntries(
      Array.from({ length: feedCount }, (_, index) => {
        const url = `https://sidebar-scale.example/feed-${index}.xml`;
        return [
          url,
          {
            url,
            title: `Sidebar Scale Feed ${index.toLocaleString()}`,
            siteUrl: `https://sidebar-scale.example/${index.toLocaleString()}`,
            enabled: true,
            trackUnread: true,
            createdAt: now - index * 1_000,
            updatedAt: now - index * 1_000,
          },
        ];
      }),
    );
    const feedTotalCounts = Object.fromEntries(
      Object.keys(feeds).map((url, index) => [url, (index % 9) + 1]),
    );
    const feedUnreadCounts = Object.fromEntries(
      Object.keys(feeds).map((url, index) => [url, index % 3]),
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
      totalUnreadCount: Math.floor(feedCount / 3),
      unreadCountByPlatform: { rss: Math.floor(feedCount / 3) },
    });
  }, SIDEBAR_FEED_COUNT);
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
    w.__SIDEBAR_PERF_RAF_DELTAS__ = deltas;
    w.__SIDEBAR_PERF_RAF_STOP__ = () => {
      running = false;
    };
  });

  await fn();

  return page.evaluate(() => {
    const w = window as Record<string, unknown>;
    (w.__SIDEBAR_PERF_RAF_STOP__ as () => void)();
    const deltas = ((w.__SIDEBAR_PERF_RAF_DELTAS__ as number[]) ?? []).slice();
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
    w.__SIDEBAR_PERF_LONG_TASKS__ = [] as PerformanceEntry[];
    const observer = new PerformanceObserver((list) => {
      const tasks = w.__SIDEBAR_PERF_LONG_TASKS__ as PerformanceEntry[];
      tasks.push(...list.getEntries());
    });
    observer.observe({ type: "longtask", buffered: false });
    w.__SIDEBAR_PERF_LONG_TASK_OBSERVER__ = observer;
  });

  const result = await fn();

  const taskData = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const observer = w.__SIDEBAR_PERF_LONG_TASK_OBSERVER__ as PerformanceObserver;
    observer.disconnect();
    const tasks = (w.__SIDEBAR_PERF_LONG_TASKS__ as PerformanceEntry[]) ?? [];
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

test("source sidebar keeps 1,600 RSS feeds searchable within frame budget", async ({ app, page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedLargeSidebarFeedList(page);

  const sidebar = page.getByTestId("app-sidebar");
  const mountStartedAt = Date.now();
  await sidebar.getByLabel("Expand feeds").click();
  await expect(sidebar.getByText("Sidebar Scale Feed 0", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const mountElapsed = Date.now() - mountStartedAt;
  const initialFeedRows = await sidebar.locator("[data-sidebar-depth='1']").count();
  const initialDomNodes = await page.evaluate(() => document.querySelectorAll("*").length);

  const searchInput = sidebar.locator("input").first();
  const interaction = await collectLongTasksDuring(page, () =>
    measureFps(page, async () => {
      const searchStartedAt = Date.now();
      await searchInput.fill("1,599");
      await expect(sidebar.getByText("Sidebar Scale Feed 1,599", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const searchElapsed = Date.now() - searchStartedAt;
      await page.evaluate((elapsed) => {
        (window as Record<string, unknown>).__SIDEBAR_SEARCH_ELAPSED_MS__ = elapsed;
      }, searchElapsed);
      await page.waitForTimeout(240);
    }),
  );

  const searchElapsed = await page.evaluate(() =>
    (window as Record<string, unknown>).__SIDEBAR_SEARCH_ELAPSED_MS__ as number,
  );
  const filteredFeedRows = await sidebar.locator("[data-sidebar-depth='1']").count();
  const filteredDomNodes = await page.evaluate(() => document.querySelectorAll("*").length);

  console.log(`[PERF] Source sidebar feed mount: ${mountElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Source sidebar search: ${searchElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Source sidebar mounted feed rows: ${initialFeedRows.toLocaleString()}`);
  console.log(`[PERF] Source sidebar filtered feed rows: ${filteredFeedRows.toLocaleString()}`);
  console.log(`[PERF] Source sidebar initial DOM nodes: ${initialDomNodes.toLocaleString()}`);
  console.log(`[PERF] Source sidebar filtered DOM nodes: ${filteredDomNodes.toLocaleString()}`);
  console.log(`[PERF] Source sidebar search FPS: ${interaction.result.fps.toLocaleString()}`);
  console.log(`[PERF] Source sidebar search p95 frame: ${interaction.result.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Source sidebar search dropped frames: ${interaction.result.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Source sidebar search long tasks: ${interaction.count.toLocaleString()}`);
  console.log(`[PERF] Source sidebar search worst long task: ${interaction.worstMs.toFixed(1)} ms`);

  expect(mountElapsed).toBeLessThan(SIDEBAR_MOUNT_BUDGET_MS);
  expect(searchElapsed).toBeLessThan(SIDEBAR_SEARCH_BUDGET_MS);
  expect(initialFeedRows).toBeLessThanOrEqual(SIDEBAR_FEED_ROW_DOM_BUDGET);
  expect(filteredFeedRows).toBeLessThanOrEqual(SIDEBAR_FEED_ROW_DOM_BUDGET);
  expect(interaction.result.sampleCount).toBeGreaterThan(0);
  expect(interaction.result.p95Ms).toBeLessThan(SIDEBAR_FRAME_P95_BUDGET_MS);
  expect(interaction.result.droppedFrames).toBeLessThanOrEqual(SIDEBAR_DROPPED_FRAME_BUDGET);
  expect(interaction.count).toBeLessThanOrEqual(SIDEBAR_LONG_TASK_COUNT_BUDGET);
});
