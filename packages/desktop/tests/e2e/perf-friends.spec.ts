import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const PERSON_COUNT = 1_600;
const ACCOUNT_COUNT = 1_920;
const ITEM_COUNT = 6_400;
const MOUNT_BUDGET_MS = process.env.CI ? 4_500 : 1_800;
const GRAPH_SCENE_SYNC_BUDGET_MS = 40;
const FRIEND_ROW_MOUNT_BUDGET = 80;
const FRAME_P95_BUDGET_MS = 50;
const CI_FRAME_P95_BUDGET_MS = 67;
const DROPPED_FRAME_BUDGET = 10;
const CI_DROPPED_FRAME_BUDGET = 40;
const LONG_TASK_COUNT_BUDGET = 2;
const LONG_TASK_WORST_BUDGET_MS = 140;

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
          sceneSyncMs: number;
          labelPassMs: number;
          sceneSyncCount: number;
          visibleLabelCount: number;
          visibleNodeLabelCount: number;
          transformOnlySyncCount: number;
        };
      };
    }).__FREED_GRAPH_DEBUG__ ?? null;
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
): Promise<{ result: T; count: number; worstMs: number }> {
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
    };
  });

  return {
    result,
    count: taskData.count,
    worstMs: Math.round(taskData.worstMs * 10) / 10,
  };
}

test("Friends view handles 1,600 visible people while zooming and panning", async ({ app, page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedLargeFriendsWorkspace(page);

  const mountStartedAt = Date.now();
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content"; themeId: string } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };
    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        themeId: "scriptorium",
      },
    });
    store.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      const debug = await readGraphDebug(page);
      return debug?.nodes.length ?? 0;
    }, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(PERSON_COUNT);

  const mountedRows = await page.getByTestId("friend-overview-virtual-row").count();
  const mountElapsed = Date.now() - mountStartedAt;
  const initialDebug = await readGraphDebug(page);
  expect(initialDebug).not.toBeNull();

  console.log(`[PERF] Friends mount: ${mountElapsed.toLocaleString()} ms`);
  console.log(`[PERF] Friends mounted sidebar rows: ${mountedRows.toLocaleString()}`);
  console.log(`[PERF] Friends graph scene sync: ${initialDebug!.metrics.sceneSyncMs.toFixed(1)} ms`);

  expect(mountElapsed).toBeLessThan(MOUNT_BUDGET_MS);
  expect(mountedRows).toBeLessThanOrEqual(FRIEND_ROW_MOUNT_BUDGET);
  expect(initialDebug!.metrics.sceneSyncMs).toBeLessThan(GRAPH_SCENE_SYNC_BUDGET_MS);

  const box = await viewport.boundingBox();
  if (!box) throw new Error("Friends graph viewport is not visible");
  const idleFrames = await measureFps(page, async () => {
    await page.waitForTimeout(1_400);
  });

  const interaction = await collectLongTasksDuring(page, () =>
    measureFps(page, async () => {
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

      await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.46);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.58, { steps: 24 });
      await page.mouse.up();
      await page.waitForTimeout(180);
    }),
  );

  const afterInteraction = await readGraphDebug(page);
  expect(afterInteraction).not.toBeNull();
  const p95Budget = process.env.CI
    ? Math.max(CI_FRAME_P95_BUDGET_MS, idleFrames.p95Ms + 34)
    : Math.max(FRAME_P95_BUDGET_MS, idleFrames.p95Ms + 20);
  const droppedFrameBudget = Math.max(
    process.env.CI ? CI_DROPPED_FRAME_BUDGET : DROPPED_FRAME_BUDGET,
    Math.ceil(
      (idleFrames.droppedFrames / Math.max(1, idleFrames.sampleCount)) *
        Math.max(1, interaction.result.sampleCount),
    ) + (process.env.CI ? 40 : 12),
  );
  console.log(`[PERF] Friends idle FPS: ${idleFrames.fps.toLocaleString()}`);
  console.log(`[PERF] Friends idle p95 frame: ${idleFrames.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Friends idle dropped frames: ${idleFrames.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Friends interaction FPS: ${interaction.result.fps.toLocaleString()}`);
  console.log(`[PERF] Friends interaction p95 frame: ${interaction.result.p95Ms.toFixed(1)} ms`);
  console.log(`[PERF] Friends interaction dropped frames: ${interaction.result.droppedFrames.toLocaleString()}`);
  console.log(`[PERF] Friends interaction long tasks: ${interaction.count.toLocaleString()}`);
  console.log(`[PERF] Friends interaction worst long task: ${interaction.worstMs.toFixed(1)} ms`);
  console.log(`[PERF] Friends interaction scene sync: ${afterInteraction!.metrics.sceneSyncMs.toFixed(1)} ms`);

  expect(interaction.result.p95Ms).toBeLessThanOrEqual(p95Budget);
  expect(interaction.result.droppedFrames).toBeLessThanOrEqual(droppedFrameBudget);
  expect(interaction.count).toBeLessThanOrEqual(LONG_TASK_COUNT_BUDGET);
  expect(interaction.worstMs).toBeLessThan(LONG_TASK_WORST_BUDGET_MS);
  expect(afterInteraction!.metrics.sceneSyncMs).toBeLessThan(GRAPH_SCENE_SYNC_BUDGET_MS);
});
