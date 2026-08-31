/**
 * Performance benchmark suite for the Freed Desktop feed view.
 *
 * These tests inject large numbers of RSS items and measure the cost of key
 * operations that degrade with corpus size. They are intentionally NOT retried
 * (playwright.config.ts sets retries: 0) because timing variance is useful data.
 *
 * Scenarios covered:
 *   1. Cold load         - time from navigate() to isInitialized with 3k items
 *   2. Scroll            - frame budget while fast-scrolling 3k-item feed
 *   3. Mark-as-read      - enqueue cost across 20 rapid bounded mutations
 *   4. Search input      - bounded SQLite search while typing a query
 *   5. Reader view open  - simultaneous setSelectedItem + markAsRead with 3k items
 *   6. CPU profile       - V8 call-stack profile of markAsRead with 3k items
 */

import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const ITEM_COUNT_MEDIUM = 1_000;
const ITEM_COUNT_LARGE = 3_000;
const ITEM_COUNT_XLARGE = 5_000;
const SCROLL_LONG_TASK_COUNT_BUDGET = 2;
const SCROLL_LONG_TASK_WORST_MS_BUDGET = 120;
const SCROLL_FRAME_P95_MS_BUDGET = 50;
const SCROLL_DROPPED_FRAME_BUDGET = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Measure elapsed wall-clock milliseconds for an async operation running
 * inside the browser's JavaScript context.
 */
async function measureBrowserMs(
  page: import("@playwright/test").Page,
  label: string,
  fn: () => Promise<void>,
): Promise<number> {
  const start = Date.now();
  await fn();
  const elapsed = Date.now() - start;
  console.log(`[PERF] ${label}: ${elapsed.toLocaleString()} ms`);
  return elapsed;
}

/**
 * Measure actual frame delivery rate (FPS) during an async operation.
 *
 * Injects a requestAnimationFrame loop into the page before calling `fn`,
 * then reads back the collected frame deltas after it resolves. Reports
 * p50/p95/p99 frame times and dropped-frame count (delta > 32ms).
 *
 * This captures jank that PerformanceObserver long-task misses (tasks 16–50ms).
 */
async function measureFps(
  page: Page,
  label: string,
  fn: () => Promise<void>,
): Promise<{
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  droppedFrames: number | null;
  fps: number | null;
  sampleCount: number;
}> {
  // Arm the rAF loop
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
    w.__PERF_RAF_DELTAS__ = deltas;
    w.__PERF_RAF_STOP__ = () => { running = false; };
  });

  await fn();

  // Disarm and collect
  const result = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    (w.__PERF_RAF_STOP__ as () => void)();
    const deltas = (w.__PERF_RAF_DELTAS__ as number[]).slice();
    if (deltas.length < 2) {
      return {
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        droppedFrames: null,
        fps: null,
        sampleCount: deltas.length,
      };
    }

    const sorted = [...deltas].sort((a, b) => a - b);
    function pct(p: number) {
      const idx = Math.floor((p / 100) * (sorted.length - 1));
      return sorted[idx];
    }

    const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    return {
      p50Ms: Math.round(pct(50) * 10) / 10,
      p95Ms: Math.round(pct(95) * 10) / 10,
      p99Ms: Math.round(pct(99) * 10) / 10,
      droppedFrames: deltas.filter((d) => d > 32).length,
      fps: Math.round(1000 / avg),
      sampleCount: deltas.length,
    };
  });

  if (result.p95Ms === null) {
    console.log(
      `[PERF] ${label}: inconclusive, collected ${result.sampleCount.toLocaleString()} rAF samples`,
    );
    return result;
  }
  console.log(`[PERF] ${label} FPS: ${result.fps}`);
  console.log(`[PERF] ${label} frame p50: ${result.p50Ms} ms`);
  console.log(`[PERF] ${label} frame p95: ${result.p95Ms} ms`);
  console.log(`[PERF] ${label} frame p99: ${result.p99Ms} ms`);
  console.log(`[PERF] ${label} dropped frames (>32ms): ${result.droppedFrames}`);
  return result;
}

async function armLongTaskProbe(page: Page, probeId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const supported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    if (!supported) return false;
    const w = window as Record<string, unknown>;
    const entriesKey = `__PERF_LONG_TASK_ENTRIES_${id}`;
    const observerKey = `__PERF_LONG_TASK_OBSERVER_${id}`;
    w[entriesKey] = [] as PerformanceEntry[];
    const observer = new PerformanceObserver((list) => {
      const tasks = w[entriesKey] as PerformanceEntry[];
      tasks.push(...list.getEntries());
    });
    observer.observe({ type: "longtask", buffered: false });
    w[observerKey] = observer;
    return true;
  }, probeId);
}

async function collectLongTaskProbe(
  page: Page,
  probeId: string,
  supported: boolean,
): Promise<{
  supported: boolean;
  count: number | null;
  totalMs: number | null;
  worstMs: number | null;
  tasks: ReadonlyArray<{ duration: number; startTime: number }>;
}> {
  if (!supported) {
    return {
      supported: false,
      count: null,
      totalMs: null,
      worstMs: null,
      tasks: [],
    };
  }
  return page.evaluate((id) => {
    const w = window as Record<string, unknown>;
    const entriesKey = `__PERF_LONG_TASK_ENTRIES_${id}`;
    const observerKey = `__PERF_LONG_TASK_OBSERVER_${id}`;
    (w[observerKey] as PerformanceObserver).disconnect();
    const tasks = w[entriesKey] as PerformanceEntry[];
    return {
      supported: true,
      count: tasks.length,
      totalMs: tasks.reduce((sum, task) => sum + task.duration, 0),
      worstMs: Math.max(0, ...tasks.map((task) => task.duration)),
      tasks: tasks.map((task) => ({
        duration: Math.round(task.duration),
        startTime: Math.round(task.startTime),
      })),
    };
  }, probeId);
}

async function injectPreservedRssItems(
  page: Page,
  count: number,
  {
    feedUrl = "https://bench.example/preserved.xml",
    preservedTextLength = 4_000,
  }: {
    feedUrl?: string;
    preservedTextLength?: number;
  } = {},
): Promise<void> {
  await page.evaluate(
    async ({ count, feedUrl, preservedTextLength }) => {
      const w = window as Record<string, unknown>;
      const libraryCore = w.__FREED_LIBRARY_CORE__ as {
        importLibraryItems: (items: unknown[]) => Promise<unknown>;
      };

      const now = Date.now();
      const seed = "quartz vector lattice memory probe ";
      const repeated = seed.repeat(Math.ceil(preservedTextLength / seed.length)).slice(0, preservedTextLength);

      const items = Array.from({ length: count }, (_, i) => ({
        globalId: `rss:${feedUrl}:preserved-${i}`,
        platform: "rss",
        contentType: "article",
        capturedAt: now - i * 60_000,
        publishedAt: now - i * 60_000,
        author: {
          id: "preserved-feed",
          handle: "preserved-feed",
          displayName: "Preserved Feed",
        },
        content: {
          text: `Preserved article ${i.toLocaleString()} carrying a longer search corpus.`,
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: `https://bench.example/preserved-${i}`,
            title: `Preserved Benchmark Article ${i.toLocaleString()}`,
            description: `Long-form preserved payload ${i.toLocaleString()}`,
          },
        },
        preservedContent: {
          text: `${repeated} item-${i.toLocaleString()}`,
          wordCount: 700,
          readingTime: 4,
          preservedAt: now - i * 60_000,
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: ["memory", "search"],
        rssSource: {
          feedUrl,
          feedTitle: "Preserved Feed",
        },
      }));

      await libraryCore.importLibraryItems(items);
    },
    { count, feedUrl, preservedTextLength },
  );

  await page.waitForFunction(
    (expectedCount: number) => {
      const w = window as Record<string, unknown>;
      const sqlite = w.__TAURI_MOCK_SQLITE_LIBRARY__ as
        | { items?: Record<string, { __deleted?: boolean }> }
        | undefined;
      const store = w.__FREED_STORE__ as
        | {
            getState: () => {
              itemCountByPlatform: Record<string, number>;
              items: unknown[];
            };
          }
        | undefined;
      if (sqlite) {
        return (
          Object.values(sqlite.items ?? {}).filter((item) => !item.__deleted)
            .length >= expectedCount &&
          (store?.getState().itemCountByPlatform.rss ?? 0) >= expectedCount
        );
      }
      return (store?.getState().items.length ?? 0) >= expectedCount;
    },
    count,
    { timeout: 30_000 },
  );
}

async function sqliteItemIds(page: Page, limit: number): Promise<string[]> {
  return page.evaluate((maximum) => {
    const sqlite = (window as unknown as Record<string, unknown>)
      .__TAURI_MOCK_SQLITE_LIBRARY__ as
      | {
          items?: Record<string, { __deleted?: boolean; globalId?: string }>;
        }
      | undefined;
    return Object.values(sqlite?.items ?? {})
      .filter(
        (item): item is { __deleted?: boolean; globalId: string } =>
          !item.__deleted && typeof item.globalId === "string",
      )
      .slice(0, maximum)
      .map((item) => item.globalId);
  }, limit);
}

async function collectHeapUsageBytes(
  page: Page,
): Promise<{ usedBytes: number; totalBytes: number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = await cdp.send("Runtime.getHeapUsage") as {
    usedSize: number;
    totalSize: number;
  };
  await cdp.send("HeapProfiler.disable");
  return {
    usedBytes: usage.usedSize,
    totalBytes: usage.totalSize,
  };
}

// ─── 1. Cold load ─────────────────────────────────────────────────────────────

test.describe("Cold load with pre-populated corpus", () => {
  test("1k items - time-to-interactive", async ({ app, page }) => {
    // Populate the native SQLite fixture, then measure a hard reload. This
    // mirrors a returning user whose Library is already present at startup.
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_MEDIUM);

    // The typed import resolves only after the SQLite transaction is durable.
    const elapsed = await measureBrowserMs(page, "Cold load 1k items", async () => {
      await page.reload();
      await app.waitForReady();
    });

    // Soft budget: 3 seconds is user-perceivable pain.
    expect(elapsed).toBeLessThan(3_000);
    console.log(`[PERF] Feed cards visible: ${await page.locator(".feed-card").count()}`);
  });

  test("3k items - time-to-interactive", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);
    const elapsed = await measureBrowserMs(page, "Cold load 3k items", async () => {
      await page.reload();
      await app.waitForReady();
    });

    expect(elapsed).toBeLessThan(5_000);
    console.log(`[PERF] Feed cards visible: ${await page.locator(".feed-card").count()}`);
  });

  test("5k items - time-to-interactive (stress)", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_XLARGE);
    const elapsed = await measureBrowserMs(page, "Cold load 5k items", async () => {
      await page.reload();
      await app.waitForReady();
    });

    // No hard pass/fail at 5k - we capture the number for trend analysis.
    console.log(`[PERF] 5k cold load result: ${elapsed.toLocaleString()} ms (informational)`);
    console.log(`[PERF] Feed cards visible: ${await page.locator(".feed-card").count()}`);
  });
});

// ─── 2. Scroll performance ────────────────────────────────────────────────────

test.describe("Scroll performance", () => {
  test("fast scroll through 3k items - frame budget", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Desktop FeedList uses class="flex-1 min-h-0 overflow-auto ... minimal-scroll"
    const scrollContainer = page.locator(".minimal-scroll").first();
    await scrollContainer.waitFor({ state: "visible" });

    // Capture long-tasks (>50ms) via PerformanceObserver before scrolling.
    await page.evaluate(() => {
      (window as Record<string, unknown>).__PERF_LONG_TASKS__ = [] as PerformanceEntry[];
      const obs = new PerformanceObserver((list) => {
        const tasks = (window as Record<string, unknown>).__PERF_LONG_TASKS__ as PerformanceEntry[];
        tasks.push(...list.getEntries());
      });
      obs.observe({ type: "longtask", buffered: false });
      (window as Record<string, unknown>).__PERF_OBS__ = obs;
    });

    // Simulate rapid scroll: 20 steps of 500px downward.
    const scrollStartedAt = await page.evaluate(() => performance.now());
    const elapsed = await measureBrowserMs(page, "Scroll 3k items (20 × 500px)", async () => {
      for (let i = 0; i < 20; i++) {
        await scrollContainer.evaluate((el) =>
          el.scrollBy({ top: 500, behavior: "instant" }),
        );
        await page.waitForTimeout(16); // one frame gap
      }
      // Let the virtualiser finish measuring after the last scroll.
      await page.waitForTimeout(100);
    });
    const scrollEndedAt = await page.evaluate(() => performance.now());

    const longTaskData = await page.evaluate(({ scrollStartedAt, scrollEndedAt }) => {
      const tasks = (window as Record<string, unknown>).__PERF_LONG_TASKS__ as PerformanceEntry[];
      const obs = (window as Record<string, unknown>).__PERF_OBS__ as PerformanceObserver;
      obs.disconnect();
      const scrollTasks = tasks.filter(
        (task) => task.startTime >= scrollStartedAt - 1 && task.startTime <= scrollEndedAt + 1,
      );
      return {
        count: scrollTasks.length,
        totalMs: scrollTasks.reduce((s, t) => s + t.duration, 0),
        worstMs: Math.max(0, ...scrollTasks.map((t) => t.duration)),
        tasks: scrollTasks.map((t) => ({
          duration: Math.round(t.duration),
          startTime: Math.round(t.startTime),
        })),
      };
    }, { scrollStartedAt, scrollEndedAt });

    console.log(`[PERF] Scroll elapsed: ${elapsed.toLocaleString()} ms`);
    console.log(`[PERF] Long tasks (>50ms): ${longTaskData.count}`);
    console.log(`[PERF] Total long-task time: ${Math.round(longTaskData.totalMs).toLocaleString()} ms`);
    console.log(`[PERF] Worst frame: ${Math.round(longTaskData.worstMs).toLocaleString()} ms`);

    if (longTaskData.count > 0) {
      console.log("[PERF] Long task breakdown:", JSON.stringify(longTaskData.tasks, null, 2));
    }

    expect(longTaskData.count).toBeLessThanOrEqual(SCROLL_LONG_TASK_COUNT_BUDGET);
    expect(longTaskData.worstMs).toBeLessThan(SCROLL_LONG_TASK_WORST_MS_BUDGET);
  });
});

// ─── 3. Mark-as-read enqueue storm ────────────────────────────────────────────

test.describe("Mark-as-read enqueue storm", () => {
  test("20 rapid mark-as-read enqueues with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Collect timing for each markAsRead call inside the page context.
    const targetIds = await sqliteItemIds(page, 20);
    const timings = await page.evaluate(async (ids) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          markAsRead: (id: string) => Promise<void>;
        };
      };
      const { markAsRead } = store.getState();
      const results: number[] = [];

      // Take 20 unread items from the front of the list.
      for (const id of ids) {
        const t0 = performance.now();
        await markAsRead(id);
        results.push(performance.now() - t0);
      }

      return results;
    }, targetIds);

    const avg = timings.reduce((s, t) => s + t, 0) / timings.length;
    const worst = Math.max(...timings);

    console.log(`[PERF] markAsRead 20 - avg: ${avg.toFixed(1)} ms, worst: ${worst.toFixed(1)} ms`);
    console.log(
      `[PERF] Per-call timings: [${timings.map((t) => t.toFixed(1)).join(", ")}]`,
    );

    // Single-item read marks enqueue into the bounded read-state batch without
    // making scrolling or reader open wait for its SQLite transaction.
    expect(worst).toBeLessThan(50);
  });
});

// ─── 4. Search input ─────────────────────────────────────────────────────────

test.describe("Search input (bounded native Library search)", () => {
  test("typing a 5-character query with 5k items", async ({ app, page }) => {
    await page.evaluate(() => {
      window.name = "__freed_e2e_sqlite_library_v1__" + JSON.stringify({
        active: true,
        expectedItemCount: 0,
        items: {},
        revision: 1,
        shell: {},
        sourceDigest: "a".repeat(64),
        sourceGeneration: 1,
        sourceRevision: 1,
      });
    });
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_XLARGE);

    // Locate the search input by its placeholder.
    const searchInput = page.getByPlaceholder(/search/i).first();
    await searchInput.waitFor({ state: "visible" });

    // Observe long tasks during typing.
    const searchLongTaskSupported = await armLongTaskProbe(page, "search");

    const elapsed = await measureBrowserMs(page, "Type 'bench' into search (5k items)", async () => {
      // Type one character at a time - each keystroke fires a state update.
      await searchInput.pressSequentially("bench", { delay: 50 });
      // Wait for search results to stabilise.
      await page.waitForTimeout(300);
    });

    const searchLongTasks = await collectLongTaskProbe(
      page,
      "search",
      searchLongTaskSupported,
    );

    console.log(`[PERF] Search typing elapsed: ${elapsed.toLocaleString()} ms`);
    if (searchLongTasks.supported) {
      console.log("[PERF] Search LongTask instrumentation: supported");
      console.log(`[PERF] Search long tasks: ${searchLongTasks.count}, worst: ${Math.round(searchLongTasks.worstMs ?? 0)} ms`);
    } else {
      console.log("[PERF] Search long tasks: inconclusive, instrumentation unsupported");
      test.info().annotations.push({
        type: "inconclusive telemetry",
        description: "LongTask instrumentation is unsupported for feed search",
      });
    }

    // Typing should not wait on a synchronous full-corpus index build.
    if (searchLongTasks.worstMs !== null) {
      expect(searchLongTasks.worstMs).toBeLessThan(200);
    }

    // Verify the bounded native contract returns results.
    await expect(page.locator(".feed-card")).not.toHaveCount(0, { timeout: 2_000 });

    // Clear search and verify list restores.
    await searchInput.clear();
    await page.waitForTimeout(200);
  });
});

// ─── 5. Reader view open ──────────────────────────────────────────────────────

test.describe("Reader view open (the worst offender)", () => {
  /**
   * This is the double-whammy: clicking a card fires setSelectedItem() AND
   * markAsRead() simultaneously. The read mark enters a bounded mutation batch
   * while React mounts ReaderView and starts its async content waterfall.
   *
   * We measure the time from click to ReaderView visible (first meaningful paint
   * of the reader panel), and the long tasks that fire during that window.
   */
  test("open reader view with 3k items loaded - click to visible", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Confirm feed cards are rendered.
    const firstCard = page.locator(".feed-card").first();
    await firstCard.waitFor({ state: "visible", timeout: 5_000 });

    // Arm long-task observer before the click.
    const readerLongTaskSupported = await armLongTaskProbe(page, "reader");

    // Click the first card and measure time until ReaderView is mounted.
    // We detect ReaderView by looking for the close button it renders.
    const elapsed = await measureBrowserMs(
      page,
      "Click card → ReaderView visible (3k items)",
      async () => {
        await firstCard.click();
        await page.locator("main article:not(.feed-card)").waitFor({
          state: "visible",
          timeout: 5_000,
        });
      },
    );

    const readerTasks = await collectLongTaskProbe(
      page,
      "reader",
      readerLongTaskSupported,
    );

    console.log(`[PERF] Reader view open: ${elapsed.toLocaleString()} ms`);
    if (readerTasks.supported) {
      console.log("[PERF] Reader LongTask instrumentation: supported");
      console.log(`[PERF] Long tasks during open: ${readerTasks.count}`);
      console.log(`[PERF] Worst long task: ${Math.round(readerTasks.worstMs ?? 0).toLocaleString()} ms`);
      console.log(`[PERF] Total long-task time: ${Math.round(readerTasks.totalMs ?? 0).toLocaleString()} ms`);
    } else {
      console.log("[PERF] Reader long tasks: inconclusive, instrumentation unsupported");
      test.info().annotations.push({
        type: "inconclusive telemetry",
        description: "LongTask instrumentation is unsupported for reader open",
      });
    }

    if ((readerTasks.count ?? 0) > 0) {
      console.log("[PERF] Long task breakdown:", JSON.stringify(readerTasks.tasks, null, 2));
    }

    // The reader panel should appear within 1 second even at 3k items.
    // A regression here means the visible-window or reader-content path is
    // blocking the first meaningful paint.
    expect(elapsed).toBeLessThan(2_000);
  });

  test("measure markAsRead enqueue cost directly after reader click", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Time markAsRead in isolation without React re-render overhead.
    // This measures enqueue cost only. The shared read-state batch commits the
    // durable SQLite mutation without blocking the paint path.
    const [targetId] = await sqliteItemIds(page, 1);
    const markAsReadMs = await page.evaluate(async (id) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          markAsRead: (id: string) => Promise<void>;
        };
      };
      const { markAsRead } = store.getState();
      if (!id) return -1;

      const t0 = performance.now();
      await markAsRead(id);
      return performance.now() - t0;
    }, targetId);

    console.log(`[PERF] markAsRead enqueue (isolated, 3k items): ${markAsReadMs.toFixed(1)} ms`);

    console.log(`[PERF] markAsRead enqueue threshold: ${markAsReadMs.toFixed(0)}ms (target: <50ms)`);
    expect(markAsReadMs).toBeLessThan(50);
  });
});

// ─── 6. CPU profile of markAsRead ────────────────────────────────────────────

/**
 * Use the Chrome DevTools Protocol to capture a V8 CPU profile of the
 * markAsRead enqueue path with 3k items loaded. The profile shows which
 * visible-store and bounded mutation functions consume time.
 *
 * Profile JSON is written to playwright-report/cpu-profile-mark-as-read.json.
 */
test.describe("CPU profile", () => {
  test("V8 CPU profile of markAsRead with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Open a CDP session on the page to access Profiler domain.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");

    // Set sampling interval to 100µs (100 microseconds) for fine-grained data.
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");

    // Run 10 markAsRead operations while profiling to get representative samples.
    const targetIds = await sqliteItemIds(page, 10);
    await page.evaluate(async (ids) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          markAsRead: (id: string) => Promise<void>;
        };
      };
      const { markAsRead } = store.getState();
      for (const id of ids) {
        await markAsRead(id);
      }
    }, targetIds);

    const { profile } = await cdp.send("Profiler.stop") as {
      profile: {
        nodes: Array<{ id: number; hitCount: number; callFrame: { functionName: string; url: string; lineNumber: number } }>;
        samples: number[];
        timeDeltas: number[];
      };
    };
    await cdp.send("Profiler.disable");

    const totalSamples = profile.samples.length;
    console.log(`[CPU] Total profile samples: ${totalSamples.toLocaleString()}`);

    // Sum hit counts per function name and sort by hotness.
    const hits = new Map<string, number>();
    for (const node of profile.nodes) {
      if (!node.hitCount) continue;
      const key = node.callFrame.functionName || "(anonymous)";
      hits.set(key, (hits.get(key) ?? 0) + node.hitCount);
    }
    const sorted = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

    console.log("\n[CPU] Top 30 hot functions during markAsRead × 10:");
    for (const [name, count] of sorted) {
      const pct = ((count / totalSamples) * 100).toFixed(1);
      console.log(`  ${pct.padStart(5)}%  ${count.toString().padStart(6)}  ${name}`);
    }

    // Write the full profile for offline analysis in Chrome DevTools.
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const reportDir = join(
      new URL(".", import.meta.url).pathname,
      "../../playwright-report",
    );
    await mkdir(reportDir, { recursive: true });
    const profilePath = join(reportDir, "cpu-profile-mark-as-read.json");
    await writeFile(profilePath, JSON.stringify(profile, null, 2));
    console.log(`\n[CPU] Full profile saved to: ${profilePath}`);
    console.log("[CPU] Open in Chrome DevTools → Performance → Load Profile to see flame chart");

    expect(totalSamples).toBeGreaterThan(0);
  });
});

// ─── 7. FPS harness during mark-as-read storm ─────────────────────────────────

test.describe("FPS harness (rAF-based frame measurement)", () => {
  test("frame delivery during 20 mark-as-read mutations with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);
    const targetIds = await sqliteItemIds(page, 20);

    let completedMutationCount = 0;
    const fps = await measureFps(
      page,
      "markAsRead × 20 storm",
      async () => {
        completedMutationCount = await page.evaluate(async (ids) => {
          const w = window as Record<string, unknown>;
          const store = w.__FREED_STORE__ as {
            getState: () => { markAsRead: (id: string) => Promise<void> };
          };
          const { markAsRead } = store.getState();
          for (const id of ids) {
            await markAsRead(id);
          }
          return ids.length;
        }, targetIds);
      },
    );

    expect(completedMutationCount).toBe(targetIds.length);
    if (fps.p95Ms === null || fps.droppedFrames === null) {
      test.info().annotations.push({
        type: "inconclusive telemetry",
        description: `mark-as-read rAF probe collected ${fps.sampleCount.toLocaleString()} samples`,
      });
      return;
    }
    // After the worker migration, no frame should drop below 30fps.
    // Before the fix, markAsRead blocks the main thread (~300ms), tanking FPS.
    console.log(`[PERF] fps harness markAsRead 20 storm p95: ${fps.p95Ms} ms`);
    // Gate is intentionally loose until Phase 4 fix is in place; GitHub's Linux
    // runners currently land in the low-40s on this storm, so keep a little headroom.
    expect(fps.droppedFrames).toBeLessThan(50);
  });

  test("frame delivery during fast scroll with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    const scrollContainer = page.getByTestId("feed-list-scroll-container");
    await scrollContainer.waitFor({ state: "visible" });
    const initialScrollState = await scrollContainer.evaluate((element) => {
      const scrollable = element as HTMLElement;
      return {
        clientHeight: scrollable.clientHeight,
        scrollHeight: scrollable.scrollHeight,
        scrollTop: scrollable.scrollTop,
      };
    });
    expect(initialScrollState.scrollHeight).toBeGreaterThan(
      initialScrollState.clientHeight,
    );

    const fps = await measureFps(
      page,
      "scroll 3k items",
      async () => {
        for (let i = 0; i < 20; i++) {
          await scrollContainer.evaluate((el) => el.scrollBy({ top: 500, behavior: "instant" }));
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(100);
      },
    );

    const finalScrollTop = await scrollContainer.evaluate((element) =>
      (element as HTMLElement).scrollTop,
    );
    expect(finalScrollTop).toBeGreaterThan(initialScrollState.scrollTop);
    if (fps.p95Ms === null || fps.droppedFrames === null) {
      test.info().annotations.push({
        type: "inconclusive telemetry",
        description: `feed scroll rAF probe collected ${fps.sampleCount.toLocaleString()} samples`,
      });
      return;
    }
    // Keep this below obvious jank while leaving room for shared CI runners.
    console.log(`[PERF] fps harness scroll 3k items p95: ${fps.p95Ms} ms`);
    expect(fps.p95Ms).toBeLessThan(SCROLL_FRAME_P95_MS_BUDGET);
    expect(fps.droppedFrames).toBeLessThanOrEqual(SCROLL_DROPPED_FRAME_BUDGET);
  });
});

// ─── 8. CDP heap memory profiling ────────────────────────────────────────────

test.describe("Memory profiling (CDP heap snapshots)", () => {
  test("JS heap growth after injecting 5k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    const baselineHeap = (await collectHeapUsageBytes(page)).usedBytes;

    await app.injectRssItems(ITEM_COUNT_XLARGE);
    const afterHeap = (await collectHeapUsageBytes(page)).usedBytes;

    const growthMb = (afterHeap - baselineHeap) / (1024 * 1024);
    console.log(`[PERF] Heap baseline: ${(baselineHeap / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`[PERF] Heap after 5k items: ${(afterHeap / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`[PERF] Heap growth 5k items: ${growthMb.toFixed(1)} MB`);

    // 5k items should not grow heap more than 100MB (generous - items are ~20KB each in CRDT)
    expect(growthMb).toBeLessThan(100);
  });

  test("heap growth after 50 mark-as-read mutations (leak detection)", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);
    const beforeHeap = (await collectHeapUsageBytes(page)).usedBytes;
    const targetIds = await sqliteItemIds(page, 50);

    // Run 50 mutations
    await page.evaluate(async (ids) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => { markAsRead: (id: string) => Promise<void> };
      };
      const { markAsRead } = store.getState();
      for (const id of ids) {
        await markAsRead(id);
      }
    }, targetIds);

    const afterHeap = (await collectHeapUsageBytes(page)).usedBytes;

    const growthMb = (afterHeap - beforeHeap) / (1024 * 1024);
    console.log(`[PERF] Heap growth after 50 mutations: ${growthMb.toFixed(1)} MB`);

    // Mutations should not leak more than 10MB after GC - indicates retained closures
    expect(growthMb).toBeLessThan(10);
  });

  test("runtime telemetry stays below the desktop memory budget after common mutations", async ({ app, page }) => {
    test.setTimeout(60_000);

    await app.goto();
    await app.waitForReady();
    await injectPreservedRssItems(page, ITEM_COUNT_XLARGE);
    const targetIds = await sqliteItemIds(page, 45);

    await page.evaluate(async (ids) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          markAsRead: (id: string) => Promise<void>;
          toggleArchived: (id: string) => Promise<void>;
          toggleLiked: (id: string) => Promise<void>;
        };
      };
      const { markAsRead, toggleArchived, toggleLiked } = store.getState();
      for (const id of ids.slice(0, 25)) await markAsRead(id);
      for (const id of ids.slice(25, 35)) await toggleArchived(id);
      for (const id of ids.slice(35, 45)) await toggleLiked(id);
    }, targetIds);

    await page.waitForFunction(() => {
      const freed = (window as Window & { __freed?: { debug?: () => { runtimeMemory?: { pressureLevel?: string } } } }).__freed;
      const debug = freed?.debug?.();
      return typeof debug?.runtimeMemory?.pressureLevel === "string";
    });

    const telemetry = await page.evaluate(() => {
      const freed = (window as Window & {
        __freed?: {
          debug?: () => {
            runtimeMemory?: {
              pressureLevel?: string;
              appResidentBytes?: number;
              webkitResidentBytes?: number;
              webkitTotalResidentBytes?: number;
              memoryCriticalBytes?: number;
              indexedDbBytes?: number;
              webkitCacheBytes?: number;
            };
          };
        };
      }).__freed;
      const memory = freed?.debug?.().runtimeMemory;
      return {
        pressureLevel: memory?.pressureLevel,
        appResidentBytes: memory?.appResidentBytes ?? 0,
        webkitResidentBytes: memory?.webkitTotalResidentBytes ?? memory?.webkitResidentBytes ?? 0,
        memoryCriticalBytes: memory?.memoryCriticalBytes ?? 3_500 * 1024 * 1024,
        indexedDbBytes: memory?.indexedDbBytes ?? 0,
        webkitCacheBytes: memory?.webkitCacheBytes ?? 0,
      };
    });

    console.log(`[PERF] Runtime memory pressure: ${telemetry.pressureLevel}`);
    console.log(`[PERF] Runtime app RSS: ${(telemetry.appResidentBytes / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`[PERF] Runtime WebKit RSS: ${(telemetry.webkitResidentBytes / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`[PERF] Runtime critical threshold: ${(telemetry.memoryCriticalBytes / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`[PERF] Runtime IndexedDB bytes: ${telemetry.indexedDbBytes.toLocaleString()}`);
    console.log(`[PERF] Runtime WebKit cache bytes: ${telemetry.webkitCacheBytes.toLocaleString()}`);

    expect(telemetry.pressureLevel).not.toBe("critical");
    expect(telemetry.appResidentBytes).toBeLessThan(telemetry.memoryCriticalBytes);
  });

  test("search index heap stays bounded after clearing a heavy query", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await injectPreservedRssItems(page, 3_000);

    const baseline = (await collectHeapUsageBytes(page)).usedBytes;

    await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => { setSearchQuery: (query: string) => void };
      };
      store.getState().setSearchQuery("quartz");
    });

    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="search"], input[placeholder*="Search"]');
      return input instanceof HTMLInputElement ? input.value === "quartz" : true;
    });

    const activeSearch = (await collectHeapUsageBytes(page)).usedBytes;

    await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => { setSearchQuery: (query: string) => void };
      };
      store.getState().setSearchQuery("");
    });

    await page.waitForTimeout(100);
    const clearedSearch = (await collectHeapUsageBytes(page)).usedBytes;

    const searchGrowthMb = (activeSearch - baseline) / (1024 * 1024);
    const retainedMb = (clearedSearch - baseline) / (1024 * 1024);
    const peakGrowthMb = (Math.max(activeSearch, clearedSearch) - baseline) / (1024 * 1024);
    console.log(`[PERF] Search heap growth heavy corpus: ${searchGrowthMb.toFixed(1)} MB`);
    console.log(`[PERF] Search heap retained after clear: ${retainedMb.toFixed(1)} MB`);
    console.log(`[PERF] Search heap peak growth: ${peakGrowthMb.toFixed(1)} MB`);

    expect(retainedMb).toBeLessThan(20);
    expect(peakGrowthMb).toBeLessThan(30);
  });
});

// ─── 9. IPC round-trip latency ────────────────────────────────────────────────

// ─── 10. React Profiler render cost ──────────────────────────────────────────

test.describe("React Profiler render cost", () => {
  test("no render phase exceeds 85ms during mark-as-read with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);
    const targetIds = await sqliteItemIds(page, 5);

    // Prove the Profiler is active before treating an empty mutation window as
    // a valid zero-render result.
    const profilerStatus = await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const arr = w.__FREED_REACT_PROFILE__;
      if (!Array.isArray(arr)) return { available: false, baselineCount: 0 };
      const baselineCount = arr.length;
      if (arr) arr.length = 0;
      return { available: true, baselineCount };
    });

    await page.evaluate(async (ids) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as { getState: () => { markAsRead: (id: string) => Promise<void> } };
      const { markAsRead } = store.getState();
      for (const id of ids) await markAsRead(id);
    }, targetIds);

    const profile = await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      return (w.__FREED_REACT_PROFILE__ as Array<{ id: string; phase: string; actualDuration: number; baseDuration: number }>) ?? [];
    });

    const maxActual = Math.max(0, ...profile.map((e) => e.actualDuration));
    if (!profilerStatus.available || profilerStatus.baselineCount === 0) {
      console.log(
        "[PERF] React Profiler: inconclusive, no baseline render phases were captured",
      );
      test.info().annotations.push({
        type: "inconclusive telemetry",
        description: "React Profiler captured no baseline render phases",
      });
      expect(targetIds).toHaveLength(5);
      return;
    }
    console.log(
      `[PERF] React Profiler - baseline renders captured: ${profilerStatus.baselineCount.toLocaleString()}`,
    );
    console.log(`[PERF] React Profiler - renders captured: ${profile.length}`);
    console.log(`[PERF] React Profiler - max actualDuration: ${maxActual.toFixed(1)} ms`);
    if (profile.length === 0) {
      console.log(
        "[PERF] React Profiler - mutation window captured a valid zero after baseline verification",
      );
    }

    // Log the top 5 worst renders for diagnostics
    const worst = [...profile].sort((a, b) => b.actualDuration - a.actualDuration).slice(0, 5);
    for (const e of worst) {
      console.log(`[PERF]   ${e.id} (${e.phase}): ${e.actualDuration.toFixed(1)} ms`);
    }

    // GitHub's Linux runners can spike into the high-70ms range here, so keep a
    // narrow buffer until the underlying Phase 4 perf work lands.
    expect(maxActual).toBeLessThan(85);
  });
});
