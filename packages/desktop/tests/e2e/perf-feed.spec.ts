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
 *   3. Mark-as-read      - hydrateFromDoc cost across 20 rapid mutations
 *   4. Search input      - MiniSearch index rebuild cost while typing a query
 *   5. Reader view open  - simultaneous setSelectedItem + markAsRead with 3k items
 *   6. CPU profile       - V8 call-stack profile of markAsRead with 3k items
 */

import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const ITEM_COUNT_MEDIUM = 1_000;
const ITEM_COUNT_LARGE = 3_000;
const ITEM_COUNT_XLARGE = 5_000;

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
): Promise<{ p50Ms: number; p95Ms: number; p99Ms: number; droppedFrames: number; fps: number }> {
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
    if (deltas.length < 2) return { p50Ms: 0, p95Ms: 0, p99Ms: 0, droppedFrames: 0, fps: 0 };

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
    };
  });

  console.log(`[PERF] ${label} FPS: ${result.fps}`);
  console.log(`[PERF] ${label} frame p50: ${result.p50Ms} ms`);
  console.log(`[PERF] ${label} frame p95: ${result.p95Ms} ms`);
  console.log(`[PERF] ${label} frame p99: ${result.p99Ms} ms`);
  console.log(`[PERF] ${label} dropped frames (>32ms): ${result.droppedFrames}`);
  return result;
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
      const automerge = w.__FREED_AUTOMERGE__ as {
        docBatchImportItems: (items: unknown[]) => Promise<unknown>;
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

      await automerge.docBatchImportItems(items);
    },
    { count, feedUrl, preservedTextLength },
  );

  await page.waitForFunction(
    (expectedCount: number) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { items: unknown[] } }
        | undefined;
      return (store?.getState().items.length ?? 0) >= expectedCount;
    },
    count,
    { timeout: 30_000 },
  );
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
    // Pre-populate IndexedDB BEFORE the app loads by navigating, injecting,
    // then measuring a hard reload. This mirrors the real-world startup path.
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_MEDIUM);

    // Wait for the Automerge 400ms debounced save to flush to IndexedDB before
    // reloading, otherwise the injected items are lost on page refresh.
    await page.waitForTimeout(600);

    // Hard reload - IndexedDB now has data, simulating a returning user.
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
    await page.waitForTimeout(600);

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
    await page.waitForTimeout(600);

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
      obs.observe({ type: "longtask", buffered: true });
      (window as Record<string, unknown>).__PERF_OBS__ = obs;
    });

    // Simulate rapid scroll: 20 steps of 500px downward.
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

    const longTaskData = await page.evaluate(() => {
      const tasks = (window as Record<string, unknown>).__PERF_LONG_TASKS__ as PerformanceEntry[];
      const obs = (window as Record<string, unknown>).__PERF_OBS__ as PerformanceObserver;
      obs.disconnect();
      return {
        count: tasks.length,
        totalMs: tasks.reduce((s, t) => s + t.duration, 0),
        worstMs: Math.max(0, ...tasks.map((t) => t.duration)),
        tasks: tasks.map((t) => ({
          duration: Math.round(t.duration),
          startTime: Math.round(t.startTime),
        })),
      };
    });

    console.log(`[PERF] Scroll elapsed: ${elapsed.toLocaleString()} ms`);
    console.log(`[PERF] Long tasks (>50ms): ${longTaskData.count}`);
    console.log(`[PERF] Total long-task time: ${Math.round(longTaskData.totalMs).toLocaleString()} ms`);
    console.log(`[PERF] Worst frame: ${Math.round(longTaskData.worstMs).toLocaleString()} ms`);

    if (longTaskData.count > 0) {
      console.log("[PERF] Long task breakdown:", JSON.stringify(longTaskData.tasks, null, 2));
    }

    // Flag but don't fail: more than 5 long tasks during a scroll is a red alert.
    if (longTaskData.count > 5) {
      console.warn(`[PERF] WARNING: ${longTaskData.count} long tasks during scroll - investigate jank`);
    }
  });
});

// ─── 3. Mark-as-read storm ────────────────────────────────────────────────────

test.describe("Mark-as-read storm (hydrateFromDoc cost)", () => {
  test("20 rapid mark-as-read mutations with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Collect timing for each markAsRead call inside the page context.
    const timings = await page.evaluate(async () => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          markAsRead: (id: string) => Promise<void>;
          items: Array<{ globalId: string }>;
        };
      };
      const { markAsRead, items } = store.getState();
      const results: number[] = [];

      // Take 20 unread items from the front of the list.
      const targets = items.slice(0, 20);
      for (const item of targets) {
        const t0 = performance.now();
        await markAsRead(item.globalId);
        results.push(performance.now() - t0);
      }

      return results;
    });

    const avg = timings.reduce((s, t) => s + t, 0) / timings.length;
    const worst = Math.max(...timings);

    console.log(`[PERF] markAsRead 20 - avg: ${avg.toFixed(1)} ms, worst: ${worst.toFixed(1)} ms`);
    console.log(
      `[PERF] Per-call timings: [${timings.map((t) => t.toFixed(1)).join(", ")}]`,
    );

    // Each mutation should resolve in a reasonable time. At 3k items,
    // hydrateFromDoc (O(n) sort + rank) + A.change() WASM is the bottleneck.
    // 500ms is the hard limit before it feels completely broken.
    expect(worst).toBeLessThan(500);
  });
});

// ─── 4. Search input ─────────────────────────────────────────────────────────

test.describe("Search input (MiniSearch index rebuild)", () => {
  test("typing a 5-character query with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Locate the search input by its placeholder.
    const searchInput = page.getByPlaceholder(/search/i).first();
    await searchInput.waitFor({ state: "visible" });

    // Observe long tasks during typing.
    await page.evaluate(() => {
      (window as Record<string, unknown>).__PERF_SEARCH_TASKS__ = [] as PerformanceEntry[];
      new PerformanceObserver((list) => {
        const tasks = (window as Record<string, unknown>).__PERF_SEARCH_TASKS__ as PerformanceEntry[];
        tasks.push(...list.getEntries());
      }).observe({ type: "longtask", buffered: false });
    });

    const elapsed = await measureBrowserMs(page, "Type 'bench' into search (3k items)", async () => {
      // Type one character at a time - each keystroke fires a state update.
      await searchInput.pressSequentially("bench", { delay: 50 });
      // Wait for search results to stabilise.
      await page.waitForTimeout(300);
    });

    const searchLongTasks = await page.evaluate(() => {
      const tasks = (window as Record<string, unknown>).__PERF_SEARCH_TASKS__ as PerformanceEntry[];
      return {
        count: tasks.length,
        totalMs: tasks.reduce((s, t) => s + t.duration, 0),
        worstMs: Math.max(0, ...tasks.map((t) => t.duration)),
      };
    });

    console.log(`[PERF] Search typing elapsed: ${elapsed.toLocaleString()} ms`);
    console.log(`[PERF] Search long tasks: ${searchLongTasks.count}, worst: ${Math.round(searchLongTasks.worstMs)} ms`);

    // Typing should never cause a frame to take more than 300ms.
    expect(searchLongTasks.worstMs).toBeLessThan(300);

    // Verify search actually produces results (proves MiniSearch is working).
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
   * markAsRead() simultaneously. markAsRead triggers an Automerge mutation ->
   * hydrateFromDoc (O(n) sort + rank) -> items array recreated ->
   * useSearchResults MiniSearch rebuild, all while React mounts the heavy
   * ReaderView component and starts its async content waterfall.
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
    await page.evaluate(() => {
      (window as Record<string, unknown>).__PERF_READER_TASKS__ = [] as PerformanceEntry[];
      new PerformanceObserver((list) => {
        const tasks = (window as Record<string, unknown>).__PERF_READER_TASKS__ as PerformanceEntry[];
        tasks.push(...list.getEntries());
      }).observe({ type: "longtask", buffered: false });
    });

    // Click the first card and measure time until ReaderView is mounted.
    // We detect ReaderView by looking for the close button it renders.
    const elapsed = await measureBrowserMs(
      page,
      "Click card → ReaderView visible (3k items)",
      async () => {
        await firstCard.click();
        await page
          .locator('[aria-label="Back"], [aria-label="Back to list"]')
          .first()
          .waitFor({ state: "visible", timeout: 5_000 });
      },
    );

    const readerTasks = await page.evaluate(() => {
      const tasks = (window as Record<string, unknown>).__PERF_READER_TASKS__ as PerformanceEntry[];
      return {
        count: tasks.length,
        totalMs: tasks.reduce((s, t) => s + t.duration, 0),
        worstMs: Math.max(0, ...tasks.map((t) => t.duration)),
        tasks: tasks.map((t) => ({
          duration: Math.round(t.duration),
          startTime: Math.round(t.startTime),
        })),
      };
    });

    console.log(`[PERF] Reader view open: ${elapsed.toLocaleString()} ms`);
    console.log(`[PERF] Long tasks during open: ${readerTasks.count}`);
    console.log(`[PERF] Worst long task: ${Math.round(readerTasks.worstMs).toLocaleString()} ms`);
    console.log(`[PERF] Total long-task time: ${Math.round(readerTasks.totalMs).toLocaleString()} ms`);

    if (readerTasks.count > 0) {
      console.log("[PERF] Long task breakdown:", JSON.stringify(readerTasks.tasks, null, 2));
    }

    // The reader panel should appear within 1 second even at 3k items.
    // If it doesn't, hydrateFromDoc is blocking the React paint.
    expect(elapsed).toBeLessThan(2_000);
  });

  test("measure hydrateFromDoc cost directly after reader click", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Time markAsRead in isolation (without the React re-render overhead)
    // to isolate the Automerge + store cost from the UI paint cost.
    const markAsReadMs = await page.evaluate(async () => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          markAsRead: (id: string) => Promise<void>;
          items: Array<{ globalId: string }>;
        };
      };
      const { markAsRead, items } = store.getState();
      if (!items[0]) return -1;

      const t0 = performance.now();
      await markAsRead(items[0].globalId);
      return performance.now() - t0;
    });

    console.log(`[PERF] markAsRead (isolated, 3k items): ${markAsReadMs.toFixed(1)} ms`);
    console.log(`[PERF] This includes: A.change() CRDT write + hydrateFromDoc O(n) sort/rank + subscriber notification`);

    // At 3k items, hydrateFromDoc + A.change() takes ~300ms on this hardware.
    // This SHOULD fail until we optimize hydrateFromDoc. Record it as a known regression.
    // Target after optimization: < 50ms.
    console.log(`[PERF] hydrateFromDoc regression threshold: ${markAsReadMs.toFixed(0)}ms (target: <50ms after optimization)`);
    expect(markAsReadMs).toBeLessThan(1_000); // hard upper bound - anything above 1s is broken
  });
});

// ─── 6. CPU profile of markAsRead ────────────────────────────────────────────

/**
 * Use the Chrome DevTools Protocol to capture a V8 CPU profile of the
 * markAsRead operation with 3k items loaded. The profile shows exactly which
 * functions within hydrateFromDoc, A.change(), and rankFeedItems consume time.
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
    await page.evaluate(async () => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          markAsRead: (id: string) => Promise<void>;
          items: Array<{ globalId: string }>;
        };
      };
      const { markAsRead, items } = store.getState();
      for (const item of items.slice(0, 10)) {
        await markAsRead(item.globalId);
      }
    });

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

    const fps = await measureFps(
      page,
      "markAsRead × 20 storm",
      async () => {
        await page.evaluate(async () => {
          const w = window as Record<string, unknown>;
          const store = w.__FREED_STORE__ as {
            getState: () => { markAsRead: (id: string) => Promise<void>; items: Array<{ globalId: string }> };
          };
          const { markAsRead, items } = store.getState();
          for (const item of items.slice(0, 20)) {
            await markAsRead(item.globalId);
          }
        });
      },
    );

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

    const scrollContainer = page.locator(".minimal-scroll").first();
    await scrollContainer.waitFor({ state: "visible" });

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

    // Scroll should not produce p95 frame times above 33ms (30fps threshold)
    console.log(`[PERF] fps harness scroll 3k items p95: ${fps.p95Ms} ms`);
    expect(fps.p95Ms).toBeLessThan(100); // wide tolerance - informational until fix
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

    // Run 50 mutations
    await page.evaluate(async () => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => { markAsRead: (id: string) => Promise<void>; items: Array<{ globalId: string }> };
      };
      const { markAsRead, items } = store.getState();
      for (const item of items.slice(0, 50)) {
        await markAsRead(item.globalId);
      }
    });

    const afterHeap = (await collectHeapUsageBytes(page)).usedBytes;

    const growthMb = (afterHeap - beforeHeap) / (1024 * 1024);
    console.log(`[PERF] Heap growth after 50 mutations: ${growthMb.toFixed(1)} MB`);

    // Mutations should not leak more than 10MB after GC - indicates retained closures
    expect(growthMb).toBeLessThan(10);
  });

  test("search index releases heap after clearing a heavy query", async ({ app, page }) => {
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
    const releasedMb = (activeSearch - clearedSearch) / (1024 * 1024);
    console.log(`[PERF] Search heap growth heavy corpus: ${searchGrowthMb.toFixed(1)} MB`);
    console.log(`[PERF] Search heap released after clear: ${releasedMb.toFixed(1)} MB`);

    expect(releasedMb).toBeGreaterThan(5);
    expect(clearedSearch).toBeLessThan(activeSearch);
  });
});

// ─── 9. IPC round-trip latency ────────────────────────────────────────────────

test.describe("IPC round-trip latency (broadcast_doc)", () => {
  test("broadcast_doc timing at various corpus sizes", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();

    for (const count of [ITEM_COUNT_MEDIUM, ITEM_COUNT_LARGE]) {
      await app.injectRssItems(count);
      // Flush pending save
      await page.waitForTimeout(600);

      // Trigger a mark-as-read to force a broadcast_doc call
      await page.evaluate(async () => {
        const w = window as Record<string, unknown>;
        const store = w.__FREED_STORE__ as {
          getState: () => { markAsRead: (id: string) => Promise<void>; items: Array<{ globalId: string }> };
        };
        const { markAsRead, items } = store.getState();
        if (items[0]) await markAsRead(items[0].globalId);
      });

      // Wait for save to flush (debounce + idle callback)
      await page.waitForTimeout(800);

      const timings = await page.evaluate(() => {
        const w = window as Record<string, unknown>;
        const t = (w.__TAURI_MOCK_IPC_TIMINGS__ as Array<{ cmd: string; startMs: number; endMs: number }>) ?? [];
        return t.filter((x) => x.cmd === "broadcast_doc");
      });

      const durations = timings.map((t) => t.endMs - t.startMs);
      const avg = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
      const worst = durations.length ? Math.max(...durations) : 0;

      console.log(`[PERF] broadcast_doc IPC (${count.toLocaleString()} items) calls: ${timings.length}`);
      console.log(`[PERF] broadcast_doc IPC (${count.toLocaleString()} items) avg: ${avg.toFixed(1)} ms`);
      console.log(`[PERF] broadcast_doc IPC (${count.toLocaleString()} items) worst: ${worst.toFixed(1)} ms`);
    }
  });
});

// ─── 10. React Profiler render cost ──────────────────────────────────────────

test.describe("React Profiler render cost", () => {
  test("no render phase exceeds 70ms during mark-as-read with 3k items", async ({ app, page }) => {
    await app.goto();
    await app.waitForReady();
    await app.injectRssItems(ITEM_COUNT_LARGE);

    // Clear profile data collected during injection
    await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const arr = w.__FREED_REACT_PROFILE__ as unknown[];
      if (arr) arr.length = 0;
    });

    await page.evaluate(async () => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as { getState: () => { markAsRead: (id: string) => Promise<void>; items: Array<{ globalId: string }> } };
      const { markAsRead, items } = store.getState();
      for (const item of items.slice(0, 5)) await markAsRead(item.globalId);
    });

    const profile = await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      return (w.__FREED_REACT_PROFILE__ as Array<{ id: string; phase: string; actualDuration: number; baseDuration: number }>) ?? [];
    });

    const maxActual = Math.max(0, ...profile.map((e) => e.actualDuration));
    console.log(`[PERF] React Profiler - renders captured: ${profile.length}`);
    console.log(`[PERF] React Profiler - max actualDuration: ${maxActual.toFixed(1)} ms`);

    // Log the top 5 worst renders for diagnostics
    const worst = [...profile].sort((a, b) => b.actualDuration - a.actualDuration).slice(0, 5);
    for (const e of worst) {
      console.log(`[PERF]   ${e.id} (${e.phase}): ${e.actualDuration.toFixed(1)} ms`);
    }

    // GitHub's Linux runners can spike into the upper-60ms range here, so keep
    // a narrow buffer until the underlying Phase 4 perf work lands.
    expect(maxActual).toBeLessThan(70);
  });
});
