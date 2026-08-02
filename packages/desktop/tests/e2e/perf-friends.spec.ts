import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

const PERSON_COUNT = 1_600;
const ACCOUNT_COUNT = 1_920;
const ITEM_COUNT = 6_400;
const FRIEND_ROW_MOUNT_BUDGET = 80;
const FRIEND_RENDERER_LABEL_BUDGET = 64;
const SETTLED_VISIBLE_NODE_BUDGET = 1_100;
const INTERACTIVE_VISIBLE_NODE_BUDGET = 240;
const PAN_MOVE_STEPS = 24;
const COLLECT_PERF_TELEMETRY =
  process.env.FREED_FRIENDS_PERF_TELEMETRY === "1";

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
          edgeRebuildCount: number;
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
          rendererLabelCount: number;
          readyRendererLabelCount: number;
          bufferUploadCount: number;
          residentNodeCount: number;
          visibleNodeCount: number;
          capped: boolean;
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
        rendererType?: string;
        qualityMode?: "interactive" | "settled";
        visibleProviderLabelCount?: number;
        denseInteractionNodeCount?: number;
        denseInteractionRebuildCount?: number;
        sceneSyncCount?: number;
        contentSyncCount?: number;
        presentationSyncCount?: number;
        activitySyncCount?: number;
        edgeRebuildCount?: number;
        rendererEdgeCount?: number;
        labelLayoutCount?: number;
        transformOnlySyncCount?: number;
        rendererLabelCount?: number;
        readyRendererLabelCount?: number;
        bufferUploadCount?: number;
        presentationInFlight?: boolean;
        presentationQueued?: boolean;
        activityInFlight?: boolean;
        activityQueued?: boolean;
        transformScale?: number;
        residentNodeCount?: number;
        visibleNodeCount?: number;
      };
    }).__FREED_GRAPH_PERF__ ?? null;
  });
}

async function readTelemetryEnvironment(page: Page) {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency.toLocaleString(),
    longTaskSupported:
      PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false,
  }));
}

async function waitForGraphContractSettle(
  page: Page,
  options: { afterPresentationSyncCount?: number } = {},
) {
  let previousSignature: string | null = null;
  let stableReads = 0;
  let latest: Awaited<ReturnType<typeof readGraphPerf>> = null;
  await expect
    .poll(async () => {
      latest = await readGraphPerf(page);
      const presentationAdvanced =
        options.afterPresentationSyncCount === undefined ||
        (latest?.presentationSyncCount ?? 0) >
          options.afterPresentationSyncCount;
      if (!latest || latest.qualityMode !== "settled" || !presentationAdvanced) {
        previousSignature = null;
        stableReads = 0;
        return stableReads;
      }
      if (
        latest.presentationInFlight ||
        latest.presentationQueued ||
        latest.activityInFlight ||
        latest.activityQueued
      ) {
        previousSignature = null;
        stableReads = 0;
        return stableReads;
      }
      const signature = JSON.stringify({
        sceneSyncCount: latest.sceneSyncCount,
        presentationSyncCount: latest.presentationSyncCount,
        activitySyncCount: latest.activitySyncCount,
        bufferUploadCount: latest.bufferUploadCount,
        presentationInFlight: latest.presentationInFlight,
        presentationQueued: latest.presentationQueued,
        activityInFlight: latest.activityInFlight,
        activityQueued: latest.activityQueued,
        labelLayoutCount: latest.labelLayoutCount,
        transformScale: latest.transformScale,
        visibleNodeCount: latest.visibleNodeCount,
      });
      stableReads = signature === previousSignature ? stableReads + 1 : 0;
      previousSignature = signature;
      return stableReads;
    }, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  if (!latest) throw new Error("Friends graph did not publish a settled snapshot");
  return latest;
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
): Promise<{
  valid: boolean;
  p95Ms: number | null;
  droppedFrames: number | null;
  fps: number | null;
  sampleCount: number;
  durationMs: number | null;
}> {
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
    if (deltas.length < 2) {
      return {
        valid: false,
        p95Ms: null,
        droppedFrames: null,
        fps: null,
        sampleCount: deltas.length,
        durationMs: null,
      };
    }
    const sorted = [...deltas].sort((left, right) => left - right);
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
    const durationMs = deltas.reduce((sum, delta) => sum + delta, 0);
    const average = durationMs / deltas.length;
    return {
      valid: true,
      p95Ms: Math.round(p95 * 10) / 10,
      droppedFrames: deltas.filter((delta) => delta > 32).length,
      fps: Math.round(1_000 / average),
      sampleCount: deltas.length,
      durationMs,
    };
  });
}

async function collectLongTasksDuring<T>(
  page: Page,
  fn: () => Promise<T>,
): Promise<{
  result: T;
  supported: boolean;
  count: number | null;
  worstMs: number | null;
  marks: Array<{ name: string; startTime: number }>;
  tasks: Array<{ startTime: number; duration: number }>;
}> {
  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const supported =
      PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
    w.__FRIENDS_PERF_LONG_TASK_SUPPORTED__ = supported;
    w.__FRIENDS_PERF_LONG_TASKS__ = [] as PerformanceEntry[];
    if (!supported) return;
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
    const supported = Boolean(w.__FRIENDS_PERF_LONG_TASK_SUPPORTED__);
    const observer = w.__FRIENDS_PERF_LONG_TASK_OBSERVER__ as
      | PerformanceObserver
      | undefined;
    observer?.disconnect();
    const tasks = (w.__FRIENDS_PERF_LONG_TASKS__ as PerformanceEntry[]) ?? [];
    return {
      supported,
      count: supported ? tasks.length : null,
      worstMs: supported
        ? Math.max(0, ...tasks.map((task) => task.duration))
        : null,
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
    supported: taskData.supported,
    count: taskData.count,
    worstMs:
      taskData.worstMs === null
        ? null
        : Math.round(taskData.worstMs * 10) / 10,
    marks: taskData.marks,
    tasks: taskData.tasks,
  };
}

test("Friends WebGL2 compatibility view handles 1,600 visible people while zooming and panning", async ({ app, page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "freed.libraryCore.rendererItemEvictionV1.disabled",
      "1",
    );
  });
  await app.goto();
  await app.waitForReady();
  await seedLargeFriendsWorkspace(page);
  await expect
    .poll(async () => page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => {
          persons: Record<string, unknown>;
          accounts: Record<string, unknown>;
          items: Array<{ globalId: string }>;
        };
      };
      const state = store.getState();
      return {
        persons: Object.keys(state.persons)
          .filter((id) => id.startsWith("scale-person-")).length,
        accounts: Object.keys(state.accounts)
          .filter((id) => id.startsWith("scale-account-")).length,
        items: state.items
          .filter((item) => item.globalId.startsWith("scale-item-")).length,
      };
    }), { timeout: 60_000 })
    .toEqual({
      persons: PERSON_COUNT,
      accounts: ACCOUNT_COUNT,
      items: ITEM_COUNT,
    });

  const mountStartedAt = COLLECT_PERF_TELEMETRY ? Date.now() : null;
  const preferenceSaveMs = await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content"; themeId: string } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };
    const preferenceSaveStartedAt = performance.now();
    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        themeId: "scriptorium",
      },
    });
    store.getState().setActiveView("friends");
    return performance.now() - preferenceSaveStartedAt;
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("friends-graph-loading")).toHaveCount(0, {
    timeout: 60_000,
  });

  await expect
    .poll(async () => {
      const perf = await readGraphPerf(page);
      return perf?.nodeCount ?? 0;
    }, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(PERSON_COUNT + ACCOUNT_COUNT);
  const mountedRows = await page.getByTestId("friend-overview-virtual-row").count();
  const mountElapsed =
    mountStartedAt === null ? null : Date.now() - mountStartedAt;
  await waitForGraphContractSettle(page);
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

  expect(mountedRows).toBeLessThanOrEqual(FRIEND_ROW_MOUNT_BUDGET);
  expect(initialDebug!.metrics.denseRenderMode).toBe("dense");
  expect(initialDebug!.metrics.denseInteractionEligible).toBe(true);
  expect(initialDebug!.metrics.residentNodeCount).toBeGreaterThanOrEqual(
    PERSON_COUNT + ACCOUNT_COUNT,
  );
  expect(initialDebug!.metrics.visibleNodeCount).toBeGreaterThan(0);
  expect(initialDebug!.metrics.visibleNodeCount).toBeLessThanOrEqual(
    SETTLED_VISIBLE_NODE_BUDGET,
  );
  expect(initialDebug!.metrics.capped).toBe(true);
  expect(initialDebug!.metrics.avatarDisplayCount).toBeLessThanOrEqual(PERSON_COUNT);

  const box = await viewport.boundingBox();
  if (!box) throw new Error("Friends graph viewport is not visible");

  const telemetryEnvironment = COLLECT_PERF_TELEMETRY
    ? await readTelemetryEnvironment(page)
    : null;
  const idleTelemetry = COLLECT_PERF_TELEMETRY
    ? await collectLongTasksDuring(page, () =>
        measureFps(page, async () => {
          await page.waitForTimeout(1_400);
        }),
      )
    : null;
  const beforeMotionPerf = await waitForGraphContractSettle(page);
  expect(beforeMotionPerf!.rendererType).toBe("current-webgl2");
  let afterWheelPerf: Awaited<ReturnType<typeof readGraphPerf>> = null;
  let beforePanPerf: Awaited<ReturnType<typeof readGraphPerf>> = null;
  let duringPanPerf: Awaited<ReturnType<typeof readGraphPerf>> = null;
  const runInteraction = async () => {
    await page.evaluate(() => performance.mark("friends-wheel-start"));
    // Keep the first event, baseline, and remaining stream in one browser task.
    // Hosted driver round trips can exceed the gesture release timer and turn
    // one synthetic trackpad gesture into multiple correctly settled gestures.
    const wheelSnapshots = await viewport.evaluate(async (element) => {
      const readPerf = () => {
        const perf = (window as typeof window & {
          __FREED_GRAPH_PERF__?: Record<string, unknown>;
        }).__FREED_GRAPH_PERF__;
        return perf ? { ...perf } : null;
      };
      const dispatchWheel = () => {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          deltaY: -120,
        }));
      };

      dispatchWheel();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const baseline = readPerf();
      for (let index = 1; index < 18; index += 1) {
        dispatchWheel();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return { baseline, after: readPerf() };
    });
    const duringWheelBaseline = wheelSnapshots.baseline as
      Awaited<ReturnType<typeof readGraphPerf>>;
    afterWheelPerf = wheelSnapshots.after as
      Awaited<ReturnType<typeof readGraphPerf>>;
    expect(duringWheelBaseline).not.toBeNull();
    await page.evaluate(() => performance.mark("friends-wheel-end"));

    expect(afterWheelPerf).not.toBeNull();
    expect(afterWheelPerf!.qualityMode).toBe("interactive");
    expect(
      (afterWheelPerf!.transformOnlySyncCount ?? 0) -
        (beforeMotionPerf?.transformOnlySyncCount ?? 0),
    ).toBeGreaterThan(0);
    expect(afterWheelPerf!.rendererType).toBe(duringWheelBaseline!.rendererType);
    expect(afterWheelPerf!.sceneSyncCount).toBe(beforeMotionPerf.sceneSyncCount);
    expect(afterWheelPerf!.denseInteractionNodeCount ?? 0).toBeGreaterThan(0);
    expect(afterWheelPerf!.denseInteractionNodeCount ?? 0).toBeLessThanOrEqual(
      INTERACTIVE_VISIBLE_NODE_BUDGET,
    );
    expect(afterWheelPerf!.visibleNodeCount ?? 0).toBeLessThanOrEqual(
      INTERACTIVE_VISIBLE_NODE_BUDGET,
    );
    expect(afterWheelPerf!.rendererLabelCount ?? 0).toBeGreaterThan(0);
    expect(afterWheelPerf!.rendererLabelCount ?? 0).toBeLessThanOrEqual(
      FRIEND_RENDERER_LABEL_BUDGET,
    );
    expect(afterWheelPerf!.readyRendererLabelCount ?? 0).toBeGreaterThan(0);

    const afterWheelAppliedPerf = await waitForGraphContractSettle(page, {
      afterPresentationSyncCount: beforeMotionPerf.presentationSyncCount ?? 0,
    });
    expect(afterWheelAppliedPerf.sceneSyncCount).toBe(
      beforeMotionPerf.sceneSyncCount,
    );
    const wheelPresentationSyncs =
      (afterWheelAppliedPerf.presentationSyncCount ?? 0) -
      (beforeMotionPerf.presentationSyncCount ?? 0);
    const wheelBufferUploads =
      (afterWheelAppliedPerf.bufferUploadCount ?? 0) -
      (beforeMotionPerf.bufferUploadCount ?? 0);
    expect(wheelPresentationSyncs).toBeGreaterThan(0);
    expect(wheelBufferUploads).toBe(wheelPresentationSyncs);
    expect(afterWheelPerf!.labelLayoutCount ?? 0).toBeGreaterThan(
      duringWheelBaseline!.labelLayoutCount ?? 0,
    );

    await page.evaluate(() => performance.mark("friends-drag-start"));
    await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.46);
    await page.mouse.down();
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    beforePanPerf = await readGraphPerf(page);
    expect(beforePanPerf).not.toBeNull();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.58, {
      steps: PAN_MOVE_STEPS,
    });
    duringPanPerf = await readGraphPerf(page);
    expect(duringPanPerf).not.toBeNull();
    expect(duringPanPerf!.qualityMode).toBe("interactive");
    expect(duringPanPerf!.sceneSyncCount).toBe(beforePanPerf!.sceneSyncCount);
    expect(duringPanPerf!.denseInteractionNodeCount ?? 0).toBeGreaterThan(0);
    expect(duringPanPerf!.denseInteractionNodeCount ?? 0).toBeLessThanOrEqual(
      INTERACTIVE_VISIBLE_NODE_BUDGET,
    );
    expect(duringPanPerf!.visibleNodeCount ?? 0).toBeLessThanOrEqual(
      INTERACTIVE_VISIBLE_NODE_BUDGET,
    );
    expect(duringPanPerf!.labelLayoutCount ?? 0).toBeGreaterThan(
      beforePanPerf!.labelLayoutCount ?? 0,
    );
    expect(duringPanPerf!.rendererLabelCount ?? 0).toBeGreaterThan(0);
    expect(duringPanPerf!.rendererLabelCount ?? 0).toBeLessThanOrEqual(
      FRIEND_RENDERER_LABEL_BUDGET,
    );
    expect(duringPanPerf!.readyRendererLabelCount ?? 0).toBeGreaterThan(0);
    await page.mouse.up();
    await page.evaluate(() => performance.mark("friends-drag-end"));

    const afterPanAppliedPerf = await waitForGraphContractSettle(page, {
      afterPresentationSyncCount: beforePanPerf!.presentationSyncCount ?? 0,
    });
    expect(afterPanAppliedPerf.sceneSyncCount).toBe(
      beforePanPerf!.sceneSyncCount,
    );
    const panPresentationSyncs =
      (afterPanAppliedPerf.presentationSyncCount ?? 0) -
      (beforePanPerf!.presentationSyncCount ?? 0);
    const panBufferUploads =
      (afterPanAppliedPerf.bufferUploadCount ?? 0) -
      (beforePanPerf!.bufferUploadCount ?? 0);
    expect(panPresentationSyncs).toBeGreaterThan(0);
    expect(panBufferUploads).toBe(panPresentationSyncs);
  };

  if (COLLECT_PERF_TELEMETRY) {
    const interaction = await collectLongTasksDuring(page, () =>
      measureFps(page, runInteraction),
    );
    console.log(`[PERF-ENV] Friends environment: ${JSON.stringify({
      ...telemetryEnvironment!,
      rendererType: beforeMotionPerf!.rendererType,
    })}`);
    console.log(`[PERF] Friends mount: ${mountElapsed!.toLocaleString()} ms`);
    console.log(
      `[PERF] Friends preference save: ${Math.round(preferenceSaveMs).toLocaleString()} ms`,
    );
    console.log(
      `[PERF] Friends graph model build: ${initialDebug!.metrics.modelBuildMs.toFixed(1)} ms`,
    );
    console.log(
      `[PERF] Friends graph layout: ${initialDebug!.metrics.layoutMs.toFixed(1)} ms`,
    );
    console.log(
      `[PERF] Friends graph scene sync: ${initialDebug!.metrics.sceneSyncMs.toFixed(1)} ms`,
    );
    if (idleTelemetry!.result.valid && interaction.result.valid) {
      console.log(
        `[PERF] Friends idle FPS: ${idleTelemetry!.result.fps!.toLocaleString()}`,
      );
      console.log(
        `[PERF] Friends idle p95 frame: ${idleTelemetry!.result.p95Ms!.toFixed(1)} ms`,
      );
      console.log(
        `[PERF] Friends idle dropped frames: ${idleTelemetry!.result.droppedFrames!.toLocaleString()}`,
      );
      console.log(
        `[PERF] Friends interaction FPS: ${interaction.result.fps!.toLocaleString()}`,
      );
      console.log(
        `[PERF] Friends interaction p95 frame: ${interaction.result.p95Ms!.toFixed(1)} ms`,
      );
      console.log(
        `[PERF] Friends interaction dropped frames: ${interaction.result.droppedFrames!.toLocaleString()}`,
      );
    } else {
      console.log(`[PERF-ENV] Friends RAF telemetry: ${JSON.stringify({
        status: "inconclusive",
        idleSamples: idleTelemetry!.result.sampleCount.toLocaleString(),
        interactionSamples: interaction.result.sampleCount.toLocaleString(),
      })}`);
    }
    if (idleTelemetry!.supported && interaction.supported) {
      console.log(
        `[PERF] Friends idle long tasks: ${idleTelemetry!.count!.toLocaleString()}`,
      );
      console.log(
        `[PERF] Friends interaction long tasks: ${interaction.count!.toLocaleString()}`,
      );
      console.log(
        `[PERF] Friends interaction worst long task: ${interaction.worstMs!.toFixed(1)} ms`,
      );
    } else {
      console.log(
        "[PERF-ENV] Friends LongTask telemetry: unsupported or inconclusive",
      );
    }
    console.log(
      `[PERF-ENV] Friends interaction marks: ${JSON.stringify(interaction.marks)}`,
    );
    console.log(
      `[PERF-ENV] Friends interaction long task entries: ${JSON.stringify(interaction.tasks)}`,
    );
  } else {
    await runInteraction();
  }

  const afterInteraction = await readGraphDebug(page);
  expect(afterInteraction).not.toBeNull();
  const pinnedNodeCount = await page.evaluate(() => {
    const layout = JSON.parse(
      localStorage.getItem("freed-device-graph-layout-v1") ?? "null",
    ) as {
      persons?: Record<string, unknown>;
      accounts?: Record<string, unknown>;
    } | null;
    return Object.keys(layout?.persons ?? {}).length
      + Object.keys(layout?.accounts ?? {}).length;
  });

  expect(afterInteraction!.transform.scale).toBeGreaterThan(initialDebug!.transform.scale);
  expect(duringPanPerf?.transformOnlySyncCount ?? 0).toBeGreaterThan(
    beforeMotionPerf?.transformOnlySyncCount ?? 0,
  );
  expect(afterInteraction!.metrics.residentNodeCount).toBeGreaterThanOrEqual(
    PERSON_COUNT + ACCOUNT_COUNT,
  );
  expect(afterInteraction!.metrics.visibleNodeCount).toBeLessThanOrEqual(
    SETTLED_VISIBLE_NODE_BUDGET,
  );
  expect(afterInteraction!.metrics.capped).toBe(true);
  expect(pinnedNodeCount).toBe(0);
});
