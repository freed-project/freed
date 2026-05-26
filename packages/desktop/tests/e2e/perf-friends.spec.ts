import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const PERSON_COUNT = 1_600;
const ACCOUNT_COUNT = 1_920;
const ITEM_COUNT = 6_400;
const MOUNT_BUDGET_MS = process.env.CI ? 6_000 : 1_800;
const GRAPH_LAYOUT_BUDGET_MS = process.env.CI ? 180 : 160;
const GRAPH_SCENE_SYNC_BUDGET_MS = process.env.CI ? 120 : 40;
const FRIEND_ROW_MOUNT_BUDGET = 80;
const FRAME_P95_BUDGET_MS = 50;
const CI_FRAME_P95_BUDGET_MS = 600;
const DROPPED_FRAME_BUDGET = 16;
const CI_DROPPED_FRAME_BUDGET = 80;
const DROPPED_FRAME_HEADROOM = 36;
const CI_DROPPED_FRAME_HEADROOM = 40;
const LONG_TASK_COUNT_BUDGET = 2;
const CI_LONG_TASK_COUNT_BUDGET = 40;
const LONG_TASK_WORST_BUDGET_MS = 140;
const CI_LONG_TASK_WORST_BUDGET_MS = 700;
const DENSE_INTERACTION_NODE_BUDGET = 96;

async function readGraphDebug(page: Page) {
  return page.evaluate(() => {
    return (window as typeof window & {
      __FREED_GRAPH_DEBUG__?: {
        nodes: Array<{
          id: string;
          personId?: string;
          accountId?: string;
          x: number;
          y: number;
          radius: number;
        }>;
        transform: { x: number; y: number; scale: number };
        qualityMode: "interactive" | "settled";
        metrics: {
          modelBuildMs: number;
          layoutMs: number;
          sceneSyncMs: number;
          labelPassMs: number;
          sceneSyncCount: number;
          avatarDisplayCount: number;
          visibleLabelCount: number;
          visibleNodeLabelCount: number;
          visibleProviderLabelCount: number;
          transformOnlySyncCount: number;
          denseRenderMode: "dense" | "containers";
          denseInteractionEligible: boolean;
          denseInteractionNodeCount: number;
          denseInteractionCulled: boolean;
          denseInteractionRebuildCount: number;
        };
      };
    }).__FREED_GRAPH_DEBUG__ ?? null;
  });
}

async function readLastRendererHeartbeat(page: Page) {
  return page.evaluate(() => {
    return (window as typeof window & {
      __FREED_LAST_RENDERER_HEARTBEAT__?: {
        surfacePerf?: {
          activeSurface?: string;
          friendsGraph?: {
            nodeCount?: number;
            sceneSyncMs?: number;
            visibleLabelCount?: number;
            denseRenderMode?: "dense" | "containers";
            denseInteractionNodeCount?: number;
          };
        };
      };
    }).__FREED_LAST_RENDERER_HEARTBEAT__ ?? null;
  });
}

async function readGraphPerf(page: Page) {
  return page.evaluate(() => {
    return (window as typeof window & {
      __FREED_GRAPH_PERF__?: {
        nodeCount?: number;
        qualityMode?: "interactive" | "settled";
        visibleProviderLabelCount?: number;
        denseInteractionNodeCount?: number;
        denseInteractionRebuildCount?: number;
      };
    }).__FREED_GRAPH_PERF__ ?? null;
  });
}

async function seedLargeFriendsWorkspace(page: Page): Promise<void> {
  await page.evaluate(async ({ personCount, accountCount, itemCount }) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccounts: (accounts: unknown[]) => Promise<void>;
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };

    const now = Date.now();
    const providers = ["instagram", "x", "facebook", "linkedin"];
    const persons = Array.from({ length: personCount }, (_, index) => ({
      id: `scale-person-${index}`,
      name: `Scale Person ${index}`,
      relationshipStatus: index < Math.round(personCount * 0.75) ? "friend" : "connection",
      careLevel: ((index % 5) + 1),
      createdAt: now - index * 1_000,
      updatedAt: now - index * 1_000,
    }));
    const accounts = Array.from({ length: accountCount }, (_, index) => {
      const linked = index < personCount;
      const provider = providers[index % providers.length]!;
      return {
        id: `scale-account-${index}`,
        personId: linked ? `scale-person-${index}` : undefined,
        kind: "social",
        provider,
        externalId: `scale-author-${index}`,
        handle: `scale-author-${index}`,
        displayName: `Scale Person ${index % personCount}`,
        firstSeenAt: now - index * 1_000,
        lastSeenAt: now - index * 500,
        discoveredFrom: "captured_item",
        createdAt: now - index * 1_000,
        updatedAt: now - index * 500,
      };
    });
    const items = Array.from({ length: itemCount }, (_, index) => {
      const accountIndex = index % accountCount;
      const provider = providers[accountIndex % providers.length]!;
      return {
        globalId: `scale-item-${index}`,
        platform: provider,
        contentType: "post",
        capturedAt: now - index * 30_000,
        publishedAt: now - index * 30_000,
        author: {
          id: `scale-author-${accountIndex}`,
          handle: `scale-author-${accountIndex}`,
          displayName: `Scale Person ${accountIndex % personCount}`,
        },
        content: {
          text: `Friends scale benchmark post ${index.toLocaleString()}`,
          mediaUrls: [],
          mediaTypes: [],
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: ["friends", "scale"],
      };
    });

    await automerge.docAddPersons(persons);
    await automerge.docAddAccounts(accounts);
    await automerge.docBatchImportItems(items);
  }, { personCount: PERSON_COUNT, accountCount: ACCOUNT_COUNT, itemCount: ITEM_COUNT });
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
    w.__FRIENDS_PERF_RAF_DELTAS__ = deltas;
    w.__FRIENDS_PERF_RAF_STOP__ = () => {
      running = false;
    };
  });

  await fn();

  return page.evaluate(() => {
    const w = window as Record<string, unknown>;
    (w.__FRIENDS_PERF_RAF_STOP__ as () => void)();
    const deltas = ((w.__FRIENDS_PERF_RAF_DELTAS__ as number[]) ?? []).slice();
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
): Promise<{
  result: T;
  count: number;
  worstMs: number;
  marks: Array<{ name: string; startTime: number }>;
  tasks: Array<{ startTime: number; duration: number }>;
}> {
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    w.__FRIENDS_PERF_LONG_TASKS__ = [] as PerformanceEntry[];
    const observer = new PerformanceObserver((list) => {
      const tasks = w.__FRIENDS_PERF_LONG_TASKS__ as PerformanceEntry[];
      tasks.push(...list.getEntries());
    });
    observer.observe({ type: "longtask", buffered: false });
    w.__FRIENDS_PERF_LONG_TASK_OBSERVER__ = observer;
  });

  const result = await fn();

  const taskData = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const observer = w.__FRIENDS_PERF_LONG_TASK_OBSERVER__ as PerformanceObserver;
    observer.disconnect();
    const tasks = (w.__FRIENDS_PERF_LONG_TASKS__ as PerformanceEntry[]) ?? [];
    return {
      count: tasks.length,
      worstMs: Math.max(0, ...tasks.map((task) => task.duration)),
      tasks: tasks.map((task) => ({
        startTime: Math.round(task.startTime * 10) / 10,
        duration: Math.round(task.duration * 10) / 10,
      })),
      marks: performance.getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("friends-"))
        .map((entry) => ({
          name: entry.name,
          startTime: Math.round(entry.startTime * 10) / 10,
        })),
    };
  });

  return {
    result,
    count: taskData.count,
    worstMs: Math.round(taskData.worstMs * 10) / 10,
    marks: taskData.marks,
    tasks: taskData.tasks,
  };
}

test("Friends view handles 1,600 visible people while zooming and panning", async ({ app, page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedLargeFriendsWorkspace(page);

  const mountStartedAt = Date.now();
  const preferenceSavePromise = page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content"; themeId: string } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };
    const preferenceSaveStartedAt = performance.now();
    const savePromise = store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        themeId: "scriptorium",
      },
    });
    store.getState().setActiveView("friends");
    await savePromise;
    return performance.now() - preferenceSaveStartedAt;
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      const perf = await readGraphPerf(page);
      return perf?.nodeCount ?? 0;
    }, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(PERSON_COUNT);

  const mountedRows = await page.getByTestId("friend-overview-virtual-row").count();
  const mountElapsed = Date.now() - mountStartedAt;
  const preferenceSaveMs = await preferenceSavePromise;
  const initialDebug = await readGraphDebug(page);
  expect(initialDebug).not.toBeNull();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => {
      const heartbeat = await readLastRendererHeartbeat(page);
      return heartbeat?.surfacePerf?.friendsGraph?.nodeCount ?? 0;
    }, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(PERSON_COUNT);
  const heartbeat = await readLastRendererHeartbeat(page);
  expect(heartbeat?.surfacePerf?.activeSurface).toBe("friends_graph");
  expect(heartbeat?.surfacePerf?.friendsGraph?.denseRenderMode).toBe("dense");
  expect(heartbeat?.surfacePerf?.friendsGraph?.sceneSyncMs ?? -1).toBeGreaterThanOrEqual(0);

  console.log(`[PERF] Friends mount: ${mountElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Friends preference save: ${Math.round(preferenceSaveMs).toLocaleString()} ms`);
  console.log(`[PERF] Friends mounted sidebar rows: ${mountedRows.toLocaleString()}`);
  console.log(`[PERF] Friends graph model build: ${initialDebug!.metrics.modelBuildMs.toFixed(1)} ms`);
  console.log(`[PERF] Friends graph layout: ${initialDebug!.metrics.layoutMs.toFixed(1)} ms`);
  console.log(`[PERF] Friends graph scene sync: ${initialDebug!.metrics.sceneSyncMs.toFixed(1)} ms`);
  console.log(`[PERF] Friends avatar displays: ${initialDebug!.metrics.avatarDisplayCount.toLocaleString()}`);

  expect(mountElapsed).toBeLessThan(MOUNT_BUDGET_MS);
  expect(mountedRows).toBeLessThanOrEqual(FRIEND_ROW_MOUNT_BUDGET);
  expect(initialDebug!.metrics.denseRenderMode).toBe("dense");
  expect(initialDebug!.metrics.denseInteractionEligible).toBe(true);
  expect(initialDebug!.metrics.layoutMs).toBeLessThan(GRAPH_LAYOUT_BUDGET_MS);
  expect(initialDebug!.metrics.sceneSyncMs).toBeLessThan(GRAPH_SCENE_SYNC_BUDGET_MS);
  expect(initialDebug!.metrics.avatarDisplayCount).toBeLessThanOrEqual(PERSON_COUNT);

  const box = await viewport.boundingBox();
  if (!box) throw new Error("Friends graph viewport is not visible");
  const idleFrames = await measureFps(page, async () => {
    await page.waitForTimeout(1_400);
  });

  let denseInteractionNodeCount = 0;
  let maxInteractiveProviderLabelCount = 0;
  const interaction = await collectLongTasksDuring(page, () =>
    measureFps(page, async () => {
      await page.evaluate(() => performance.mark("friends-wheel-start"));
      for (let index = 0; index < 18; index += 1) {
        await viewport.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          element.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            deltaY: -120,
          }));
        });
        await page.waitForTimeout(16);
      }
      await page.evaluate(() => performance.mark("friends-wheel-end"));

      await expect
        .poll(async () => {
          const perf = await readGraphPerf(page);
          const nodeCount = perf?.denseInteractionNodeCount ?? 0;
          denseInteractionNodeCount = Math.max(denseInteractionNodeCount, nodeCount);
          if (perf?.qualityMode === "interactive") {
            maxInteractiveProviderLabelCount = Math.max(
              maxInteractiveProviderLabelCount,
              perf.visibleProviderLabelCount ?? 0,
            );
          }
          return nodeCount;
        }, { timeout: 5_000 })
        .toBeGreaterThan(0);

      await page.evaluate(() => performance.mark("friends-drag-start"));
      await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.46);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.58, { steps: 24 });
      await page.mouse.up();
      await page.evaluate(() => performance.mark("friends-drag-end"));
      await page.waitForTimeout(180);
    }),
  );

  const afterInteraction = await readGraphDebug(page);
  expect(afterInteraction).not.toBeNull();
  const p95Budget = process.env.CI
    ? Math.max(CI_FRAME_P95_BUDGET_MS, idleFrames.p95Ms + 34)
    : Math.max(FRAME_P95_BUDGET_MS, idleFrames.p95Ms + 34);
  const droppedFrameBudget = Math.max(
    process.env.CI ? CI_DROPPED_FRAME_BUDGET : DROPPED_FRAME_BUDGET,
    Math.ceil(
      (idleFrames.droppedFrames / Math.max(1, idleFrames.sampleCount)) *
        Math.max(1, interaction.result.sampleCount),
    ) + (process.env.CI ? CI_DROPPED_FRAME_HEADROOM : DROPPED_FRAME_HEADROOM),
  );
  console.log(`[PERF] Friends idle FPS: ${idleFrames.fps.toLocaleString()}`);
  console.log(`[PERF] Friends idle p95 frame: ${idleFrames.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Friends idle dropped frames: ${idleFrames.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Friends interaction FPS: ${interaction.result.fps.toLocaleString()}`);
  console.log(`[PERF] Friends interaction p95 frame: ${interaction.result.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Friends interaction dropped frames: ${interaction.result.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Friends interaction long tasks: ${interaction.count.toLocaleString()}`);
  console.log(`[PERF] Friends interaction worst long task: ${interaction.worstMs.toFixed(1)} ms`);
  console.log(`[PERF] Friends interaction marks: ${JSON.stringify(interaction.marks)}`);
  console.log(`[PERF] Friends interaction long task entries: ${JSON.stringify(interaction.tasks)}`);
  console.log(`[PERF] Friends interaction scene sync: ${afterInteraction!.metrics.sceneSyncMs.toFixed(1)} ms`);
  console.log(`[PERF] Friends dense interaction nodes: ${denseInteractionNodeCount.toLocaleString()}`);
  console.log(`[PERF] Friends dense interaction rebuilds: ${afterInteraction!.metrics.denseInteractionRebuildCount.toLocaleString()}`);

  expect(afterInteraction!.transform.scale).toBeGreaterThan(initialDebug!.transform.scale);
  expect(interaction.result.sampleCount).toBeGreaterThan(0);
  expect(denseInteractionNodeCount).toBeGreaterThan(0);
  expect(denseInteractionNodeCount).toBeLessThanOrEqual(DENSE_INTERACTION_NODE_BUDGET);
  expect(maxInteractiveProviderLabelCount).toBe(0);
  expect(afterInteraction!.metrics.denseInteractionRebuildCount).toBeLessThanOrEqual(16);
  expect(interaction.result.p95Ms).toBeLessThanOrEqual(p95Budget);
  expect(interaction.result.droppedFrames).toBeLessThanOrEqual(droppedFrameBudget);
  expect(interaction.count).toBeLessThanOrEqual(
    process.env.CI ? CI_LONG_TASK_COUNT_BUDGET : LONG_TASK_COUNT_BUDGET,
  );
  expect(interaction.worstMs).toBeLessThan(
    process.env.CI ? CI_LONG_TASK_WORST_BUDGET_MS : LONG_TASK_WORST_BUDGET_MS,
  );
  expect(afterInteraction!.metrics.sceneSyncMs).toBeLessThan(GRAPH_SCENE_SYNC_BUDGET_MS);
});
