/**
 * Smoke tests for Freed Desktop.
 *
 * These verify that the app loads, initializes, and renders key UI surfaces
 * without crashing. They run in plain Chromium against the Vite dev server
 * (VITE_TEST_TAURI=1), so all Tauri IPC calls are intercepted by mocks.
 *
 * Design rule: smoke tests must be fast and not flaky. Use waitForReady() and
 * always assert on stable, visible elements. Avoid timing-sensitive assertions.
 */

import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  acceptLegalGate,
  resolveViteFsModulePath,
} from "./fixtures/app";
import { tauriInitScript } from "./fixtures/tauri-init";

const SIDEBAR_ALIGNMENT_TOLERANCE_PX = 4;
const SIDEBAR_ICON_ALIGNMENT_TOLERANCE_PX = 10;
const READER_RAIL_ALIGNMENT_TOLERANCE_PX = 8;
const LAYOUT_CONTROL_SPLIT_OFFSET_PX = 24;
const READER_LAYOUT_CONTROL_SPLIT_OFFSET_PX = 16;
const LAYOUT_CONTROL_GAP_PX = 8;
const READER_LAYOUT_CONTROL_GAP_PX = 0;
const COMPACT_PRIMARY_SIDEBAR_WIDTH_PX = 48;
const PRIMARY_SIDEBAR_GAP_WIDTH_PX = 8;
const TOP_TOOLBAR_HEIGHT_PX = COMPACT_PRIMARY_SIDEBAR_WIDTH_PX + PRIMARY_SIDEBAR_GAP_WIDTH_PX / 2;
const MACOS_TRAFFIC_LIGHT_INSET_PX = 100;
const TOOLBAR_CENTER_ALIGNMENT_TOLERANCE_PX = 3;
const TOOLBAR_VERTICAL_ALIGNMENT_TOLERANCE_PX = 2;
const TOOLTIP_ARROW_ALIGNMENT_TOLERANCE_PX = 1.5;
const SIDEBAR_CLOSED_EDGE_TOLERANCE_PX = 5;
const NARROW_DRAGGED_SIDEBAR_TARGET_WIDTH_PX = 184;
const NARROW_DRAGGED_SIDEBAR_TOLERANCE_PX = 16;
const DEFAULT_REOPENED_SIDEBAR_MIN_WIDTH_PX = 250;
const DEFAULT_REOPENED_SIDEBAR_MAX_WIDTH_PX = 262;
const SOFT_VIEWPORT_RADIUS = "20px";
const mapRangeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

async function dismissCloudSyncNudgeIfPresent(page: Page) {
  const dismissButton = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
  }
}

async function openVisibleMapMarker(
  page: Page,
  label = "Ada Lovelace",
  popupActionName?: "Open Friend" | "Open Post",
) {
  const mapSurface = page.getByTestId("map-surface");
  const visibleMarker = page.locator(`.freed-map-marker[aria-label="${label}"]:visible`).first();

  await expect(mapSurface).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await mapSurface.getAttribute("data-map-moving")) ?? "false", {
      timeout: 10_000,
    })
    .toBe("false");

  let lastClickError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(visibleMarker).toBeVisible({ timeout: 10_000 });
    try {
      await visibleMarker.click({ force: true });
      lastClickError = null;
      break;
    } catch (error) {
      lastClickError = error;
      await page.waitForTimeout(150);
    }
  }

  if (lastClickError) {
    throw lastClickError;
  }

  if (!popupActionName) {
    return;
  }

  const popupAction = page.getByRole("button", { name: popupActionName });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await popupAction.isVisible().catch(() => false)) {
      return;
    }

    await expect(visibleMarker).toBeVisible({ timeout: 10_000 });
    await visibleMarker.click();
    await page.waitForTimeout(250);
  }

  await expect(popupAction).toBeVisible({ timeout: 10_000 });
}

async function clickMapPopupAction(page: Page, actionName: "Open Friend" | "Open Post") {
  await expect(
    page.locator("button:visible", { hasText: new RegExp(`^${actionName}$`) }).first(),
  ).toBeVisible({ timeout: 5_000 });

  await expect
    .poll(
      async () =>
        page.evaluate((buttonText) => {
          const buttons = [...document.querySelectorAll("button")];
          const button = buttons.find((candidate) => {
            const label = candidate.textContent?.trim();
            const rect = candidate.getBoundingClientRect();
            const style = window.getComputedStyle(candidate);
            return (
              label === buttonText &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          });

          if (!button) {
            return false;
          }

          button.click();
          return true;
        }, actionName),
      { timeout: 5_000 },
    )
    .toBe(true);
}

async function dragElementBy(page: Page, locator: Locator, deltaX: number, deltaY = 0) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Drag target is not visible");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 4 });
  await page.mouse.up();
}

async function readPointDragState(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!target) return null;
      const style = window.getComputedStyle(target);
      return {
        tagName: target.tagName.toLowerCase(),
        testId: target.getAttribute("data-testid"),
        text: target.textContent?.trim() ?? "",
        hasDirectDragAttr: target.hasAttribute("data-tauri-drag-region"),
        dragAttrValue: target.getAttribute("data-tauri-drag-region"),
        inlineWebkitAppRegion: target.style.webkitAppRegion,
        computedCursor: style.cursor,
        computedUserSelect: style.userSelect,
      };
    },
    { x, y },
  );
}

async function readElementFromPointDragState(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Drag target is not visible");
  }

  return readPointDragState(page, box.x + box.width / 2, box.y + box.height / 2);
}

async function readDesktopSidebarGeometry(page: Page) {
  return page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const resizeHandle = document.querySelector('[data-testid="app-sidebar-resize-handle"]') as HTMLElement | null;

    const shellRect = sidebarShell?.getBoundingClientRect() ?? null;
    const sidebarRect = sidebar?.getBoundingClientRect() ?? null;
    const resizeHandleRect = resizeHandle?.getBoundingClientRect() ?? null;

    return {
      shellWidth: shellRect?.width ?? 0,
      sidebarWidth: sidebarRect?.width ?? 0,
      sidebarLeft: sidebarRect?.left ?? 0,
      sidebarRight: sidebarRect?.right ?? 0,
      resizeHandleCenter: resizeHandleRect ? resizeHandleRect.left + resizeHandleRect.width / 2 : 0,
    };
  });
}

async function expectDesktopSidebarShellWidthAtMost(page: Page, maximumWidth: number, timeout = 1_000) {
  await expect
    .poll(async () => (await readDesktopSidebarGeometry(page)).shellWidth, { timeout })
    .toBeLessThanOrEqual(maximumWidth);
}

async function expectDesktopSidebarClosed(page: Page, timeout = 1_000) {
  await waitForDesktopSidebarMode(page, "closed");
  await expect.poll(async () => await page.getByTestId("app-sidebar").count(), {
    timeout,
  }).toBe(0);
  await expect(page.getByTestId("app-sidebar-resize-handle")).toHaveCount(0);
}

async function expectDesktopSidebarWidthBetween(
  page: Page,
  minimumWidth: number,
  maximumWidth: number,
  timeout = 1_000,
) {
  await expect
    .poll(async () => {
      const width = (await readDesktopSidebarGeometry(page)).sidebarWidth;
      return width >= minimumWidth && width <= maximumWidth;
    }, { timeout })
    .toBe(true);
}

async function waitForDesktopSidebarMode(page: Page, mode: "expanded" | "compact" | "closed") {
  await page.waitForFunction((expectedMode) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { preferences: { display: { sidebarMode?: string } } } }
      | undefined;
    return store?.getState().preferences.display.sidebarMode === expectedMode;
  }, mode);
}

async function persistDisplayPreference(page: Page, key: "mapMode", value: string) {
  await page.waitForFunction(
    ({ key, value }) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | {
            getState: () => {
              preferences: { display: Record<string, unknown> };
            };
          }
        | undefined;
      return store?.getState().preferences.display[key] === value;
    },
    { key, value },
    { timeout: 5_000 },
  );

  await page.evaluate(
    async ({ key, value }) => {
      const w = window as Record<string, unknown>;
      const automerge = w.__FREED_AUTOMERGE__ as {
        docUpdatePreferences: (updates: { display: Record<string, string> }) => Promise<void>;
      };
      await automerge.docUpdatePreferences({ display: { [key]: value } });
    },
    { key, value },
  );
}

async function setMapTimeRange(page: Page, startAt: number, endAt: number) {
  const startInput = page.getByTestId("map-time-range-start");
  const endInput = page.getByTestId("map-time-range-end");
  await expect(startInput).toBeVisible({ timeout: 10_000 });
  await expect(endInput).toBeVisible({ timeout: 10_000 });

  const currentStart = Number(await startInput.inputValue());
  const currentEnd = Number(await endInput.inputValue());

  if (startAt > currentEnd) {
    await setRangeInputValue(endInput, endAt);
    await setRangeInputValue(startInput, startAt);
    return;
  }

  if (endAt < currentStart) {
    await setRangeInputValue(startInput, startAt);
    await setRangeInputValue(endInput, endAt);
    return;
  }

  await setRangeInputValue(startInput, startAt);
  await setRangeInputValue(endInput, endAt);
}

async function setRangeInputValue(input: Locator, value: number) {
  await input.evaluate((element, nextValue) => {
    const rangeInput = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(rangeInput, String(nextValue));
    rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

function formatMapRangeDate(value: number): string {
  return mapRangeFormatter.format(value);
}

function startOfLocalDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfLocalDay(value: number): number {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function addLocalDays(value: number, days: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function readDesktopSidebarPadding(page: Page) {
  return page.evaluate(() => {
    const sidebarBody = document.querySelector('[data-testid="app-sidebar-body"]') as HTMLElement | null;
    if (!sidebarBody) {
      return null;
    }

    const style = window.getComputedStyle(sidebarBody);
    return {
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      paddingBottom: Number.parseFloat(style.paddingBottom),
    };
  });
}

async function graphNodeScreenPoint(
  page: Page,
  matcher: { personId?: string; accountId?: string; kind?: string },
) {
  return page.evaluate((expected) => {
    const viewport = document.querySelector('[data-testid="friend-graph-viewport"]') as HTMLElement | null;
    const debug = (window as typeof window & {
      __FREED_GRAPH_DEBUG__?: {
        nodes: Array<{
          id: string;
          kind: string;
          personId?: string;
          accountId?: string;
          x: number;
          y: number;
        }>;
        transform: { x: number; y: number; scale: number };
      };
    }).__FREED_GRAPH_DEBUG__;

    if (!viewport || !debug) {
      return null;
    }

    const node = debug.nodes.find((candidate) =>
      (!expected.kind || candidate.kind === expected.kind) &&
      (!expected.personId || candidate.personId === expected.personId) &&
      (!expected.accountId || candidate.accountId === expected.accountId),
    );
    if (!node) {
      return null;
    }

    const rect = viewport.getBoundingClientRect();
    return {
      x: rect.left + node.x * debug.transform.scale + debug.transform.x,
      y: rect.top + node.y * debug.transform.scale + debug.transform.y,
    };
  }, matcher);
}

async function readGraphViewportBox(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="friend-graph-viewport"]') as HTMLElement | null;
    if (!viewport) {
      return null;
    }

    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function waitForGraphNodeScreenPoint(
  page: Page,
  matcher: { personId?: string; accountId?: string; kind?: string },
  timeout = 10_000,
) {
  let point: { x: number; y: number } | null = null;

  await expect
    .poll(async () => {
      const nextPoint = await graphNodeScreenPoint(page, matcher);
      const viewportBox = await readGraphViewportBox(page);
      if (!nextPoint || !viewportBox) {
        point = null;
        return false;
      }

      const isInsideViewport =
        nextPoint.x >= viewportBox.x + 4 &&
        nextPoint.x <= viewportBox.x + viewportBox.width - 4 &&
        nextPoint.y >= viewportBox.y + 4 &&
        nextPoint.y <= viewportBox.y + viewportBox.height - 4;
      point = isInsideViewport ? nextPoint : null;
      return isInsideViewport;
    }, { timeout })
    .toBe(true);

  if (!point) {
    throw new Error("Friends graph node did not settle inside the visible viewport");
  }

  return point;
}

async function readGraphDebug(page: Page) {
  return page.evaluate(() => {
    return (window as typeof window & {
      __FREED_GRAPH_DEBUG__?: {
        nodes: Array<{
          id: string;
          kind: string;
          personId?: string;
          accountId?: string;
          feedUrl?: string;
          linkedPersonId?: string | null;
          x: number;
          y: number;
          radius: number;
        }>;
        regions: Array<{
          id: string;
          provider: string;
          label: string;
          x: number;
          y: number;
          radiusX: number;
          radiusY: number;
          count: number;
        }>;
        transform: { x: number; y: number; scale: number };
        qualityMode: "interactive" | "settled";
        metrics: {
          modelBuildMs: number;
          layoutMs: number;
          sceneSyncMs: number;
          labelPassMs: number;
          sceneSyncCount: number;
          contentSyncCount: number;
          transformOnlySyncCount: number;
          edgeRebuildCount: number;
          nodeRestyleCount: number;
          labelLayoutCount: number;
          visibleLabelCount: number;
          visibleNodeLabelCount: number;
          visibleProviderLabelCount: number;
          rendererLabelCount: number;
          readyRendererLabelCount: number;
          sourceNodeCount?: number;
          visibleNodeCount?: number;
          renderedPrimitiveCount?: number;
          capped?: boolean;
          qualityMode: "interactive" | "settled";
        };
      };
    }).__FREED_GRAPH_DEBUG__ ?? null;
  });
}

async function readGraphSummary(page: Page) {
  return page.evaluate(() => {
    const debug = (window as typeof window & {
      __FREED_GRAPH_DEBUG__?: {
        nodes: Array<unknown>;
        transform: { x: number; y: number; scale: number };
        qualityMode: "interactive" | "settled";
        metrics: {
          modelBuildMs: number;
          layoutMs: number;
          sceneSyncMs: number;
          labelPassMs: number;
          sceneSyncCount: number;
          contentSyncCount: number;
          transformOnlySyncCount: number;
          edgeRebuildCount: number;
          nodeRestyleCount: number;
          labelLayoutCount: number;
          visibleLabelCount: number;
          visibleNodeLabelCount: number;
          visibleProviderLabelCount: number;
          rendererLabelCount: number;
          readyRendererLabelCount: number;
          qualityMode: "interactive" | "settled";
        };
      };
    }).__FREED_GRAPH_DEBUG__;

    if (!debug) {
      return null;
    }

    return {
      nodeCount: debug.nodes.length,
      transform: debug.transform,
      qualityMode: debug.qualityMode,
      metrics: debug.metrics,
    };
  });
}

async function waitForGraphPerfToSettle(page: Page, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let previous = await readGraphSummary(page);
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const next = await readGraphSummary(page);
    if (
      previous &&
      next &&
      next.qualityMode === "settled" &&
      next.metrics.edgeRebuildCount === previous.metrics.edgeRebuildCount &&
      next.metrics.sceneSyncCount === previous.metrics.sceneSyncCount
    ) {
      return next;
    }
    previous = next;
  }

  throw new Error("Friends graph perf metrics did not settle in time");
}

async function waitForGraphSceneSyncAfter(page: Page, previousSceneSyncCount: number, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.waitForTimeout(50);
    const next = await readGraphDebug(page);
    if (next && next.metrics.sceneSyncCount > previousSceneSyncCount) {
      return next;
    }
  }

  throw new Error("Friends graph scene sync did not advance in time");
}

async function seedStressIdentityGraph(page: Page) {
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccounts: (accounts: unknown[]) => Promise<void>;
      docAddRssFeed: (feed: unknown) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content"; themeId?: string } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    const personCount = 360;
    const accountCount = 1_440;
    const feedCount = 80;
    const friendCutoff = Math.round(personCount * 0.82);
    const persons = Array.from({ length: personCount }, (_, index) => ({
      id: `stress-person-${index}`,
      name: `Stress Person ${index}`,
      relationshipStatus: index < friendCutoff ? "friend" : "connection",
      careLevel: index < friendCutoff ? 3 + (index % 3) : 2,
      createdAt: now,
      updatedAt: now,
    }));
    const accounts = Array.from({ length: accountCount }, (_, index) => ({
      id: `stress-account-${index}`,
      personId: `stress-person-${index % personCount}`,
      kind: "social",
      provider: index % 5 === 0 ? "rss" : index % 5 === 1 ? "instagram" : index % 5 === 2 ? "linkedin" : index % 5 === 3 ? "facebook" : "x",
      externalId: `stress-external-${index}`,
      handle: `stress-${index}`,
      displayName: `Stress Channel ${index}`,
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    }));
    const feeds = Array.from({ length: feedCount }, (_, index) => ({
      url: `https://stress.example/feed-${index}.xml`,
      title: `Stress Feed ${index}`,
      enabled: true,
      trackUnread: true,
    }));
    await automerge.docAddPersons(persons);
    await automerge.docAddAccounts(accounts);
    await Promise.all(feeds.map((feed) => automerge.docAddRssFeed(feed)));
    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        themeId: "scriptorium",
      },
    });
    store.getState().setActiveView("friends");
  });
}

const SETTINGS_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/settings-store.ts",
  import.meta.url,
);
const DEBUG_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/debug-store.ts",
  import.meta.url,
);

// ---------------------------------------------------------------------------
// App initialization
// ---------------------------------------------------------------------------

test("app loads and renders without crashing", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("main")).toBeVisible();
});

test("locked macOS session defers full desktop startup", async ({ app, ipc }) => {
  await app.page.addInitScript(() => {
    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:legal.json",
      JSON.stringify({
        "legal.bundle.desktop": {
          version: "2026-03-31.1",
          acceptedAt: 1775146800000,
          surface: "desktop-first-run",
        },
      }),
    );
    const w = window as unknown as {
      __TAURI_MOCK_DESKTOP_SESSION_STATE__?: {
        available: boolean;
        screenLocked: boolean;
        error: null;
      };
    };
    w.__TAURI_MOCK_DESKTOP_SESSION_STATE__ = {
      available: true,
      screenLocked: true,
      error: null,
    };
  });

  await app.goto();

  await expect(
    app.page.getByText("Freed Desktop will finish opening after you unlock this Mac."),
  ).toBeVisible();
  await expect(app.page.locator("main")).toHaveCount(0);
  await expect
    .poll(async () => {
      const invocations = await ipc.invocations();
      return invocations.filter((call) => call.cmd === "broadcast_doc").length;
    })
    .toBe(0);
});

test("startup emits renderer health before background work can run", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        return (window as unknown as { __FREED_RENDERER_HEARTBEATS__?: number })
          .__FREED_RENDERER_HEARTBEATS__ ?? 0;
      }),
    )
    .toBeGreaterThanOrEqual(1);

  const heartbeat = await page.evaluate(() => {
    return (window as unknown as {
      __FREED_LAST_RENDERER_HEARTBEAT__?: {
        backgroundRuntime?: {
          rendererReady?: boolean;
          activeJob?: string | null;
          activeSource?: string | null;
          activeAgeMs?: number | null;
        };
      };
    }).__FREED_LAST_RENDERER_HEARTBEAT__;
  });

  expect(heartbeat?.backgroundRuntime).toEqual(
    expect.objectContaining({
      rendererReady: expect.any(Boolean),
      activeJob: null,
      activeSource: null,
      activeAgeMs: null,
    }),
  );
});

test("no console errors on startup", async ({ page }) => {
  await page.addInitScript(tauriInitScript());

  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await acceptLegalGate(page);
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

  // Filter out known benign messages from third-party scripts / WASM.
  const fatal = errors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("ResizeObserver") &&
      !e.includes("[mock") &&
      // The sync relay (broadcast_doc) is not available in the test
      // environment. sync.ts already catches these and logs them as
      // "[Sync] Failed to broadcast" -- safe to ignore.
      !e.includes("broadcast_doc") &&
      !e.includes("Failed to broadcast"),
  );

  expect(fatal, `Unexpected console errors: ${fatal.join("\n")}`).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Layout surfaces
// ---------------------------------------------------------------------------

test("desktop workspace keeps a single top toolbar in feed, reader, and friends views", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  await expect(page.getByTestId("workspace-toolbar")).toBeVisible();
  await expect(page.locator("header")).toHaveCount(1);

  await page.locator("[data-feed-item-id]").first().click();
  await expect(page.getByTestId("workspace-toolbar")).toBeVisible();
  await expect(page.locator("header")).toHaveCount(1);

  await page.getByTestId("app-sidebar").getByTestId("source-row-friends").click();
  await expect(page.getByTestId("workspace-toolbar")).toBeVisible();
  await expect(page.locator("header")).toHaveCount(1);
});

test("desktop sidebar toggle still clicks normally from the shared toolbar", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const initialWidth = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return sidebarShell?.getBoundingClientRect().width ?? 0;
  });

  const sidebarToggle = page.getByTestId("desktop-sidebar-toggle");
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Minimal sidebar");

  await sidebarToggle.click();
  await page.waitForTimeout(250);

  expect(initialWidth).toBeGreaterThan(200);
  await expectDesktopSidebarWidthBetween(page, 46, 50, 1_500);
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Hide sidebar");

  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Show sidebar");
  await waitForDesktopSidebarMode(page, "closed");
  await expectDesktopSidebarClosed(page, 3_000);
});

test("desktop titlebar controls align with the macOS stoplight row", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const geometry = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
    const sidebarToggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    if (!toolbar || !sidebarToggle) return null;

    const toolbarRect = toolbar.getBoundingClientRect();
    const toggleRect = sidebarToggle.getBoundingClientRect();
    return {
      toolbarHeight: Math.round(toolbarRect.height),
      toggleCenterY: Math.round(toggleRect.top + toggleRect.height / 2 - toolbarRect.top),
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry?.toolbarHeight).toBe(52);
  expect(geometry?.toggleCenterY).toBe(18);
});

test("narrow desktop viewports keep the desktop compact rail instead of switching to the mobile drawer", async ({ app, page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await app.goto();
  await app.waitForReady();

  const sidebarToggle = page.getByTestId("desktop-sidebar-toggle");
  await expect(sidebarToggle).toBeVisible();
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Hide sidebar");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("app-sidebar").getByTestId("compact-sidebar-search-trigger")).toBeVisible();
  await expect(page.getByTestId("app-sidebar-mobile")).toHaveCount(0);
  await expect(page.getByLabel("Open menu")).toHaveCount(0);

  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Show sidebar");
  await expectDesktopSidebarClosed(page, 1_000);

  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Hide sidebar");
  await expect.poll(async () => (await readDesktopSidebarGeometry(page)).sidebarWidth, {
    timeout: 1_000,
  }).toBeGreaterThanOrEqual(46);
});

test("narrow desktop reader mode keeps the compact sidebar accessible and collapses the reader rail", async ({ app, page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  await page.locator("[data-feed-item-id]").first().click();
  await expect(page.getByTestId("workspace-toolbar-reader-title-block")).toBeVisible();
  await expect(page.getByTestId("app-sidebar").getByTestId("compact-sidebar-search-trigger")).toBeVisible();

  const readerRailWidth = await page.evaluate(() =>
    window.getComputedStyle(document.documentElement).getPropertyValue("--freed-reader-rail-width").trim(),
  );
  expect(readerRailWidth).toBe("0px");

  const trigger = page.getByTestId("app-sidebar").getByTestId("compact-sidebar-search-trigger");
  await trigger.click();
  await expect(page.getByTestId("compact-sidebar-search-palette")).toBeVisible();
});

test("desktop sidebar snaps to compact and closed, then reopens at the default expanded width", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          setState: (partial: Record<string, unknown>) => void;
        }
      | undefined;

    store?.setState({
      xAuth: {
        isAuthenticated: true,
        cookies: { ct0: "ct0", authToken: "token" },
      },
      itemCountByPlatform: {
        x: 1,
      },
    });
  });

  const resizeHandle = page.getByTestId("app-sidebar-resize-handle");
  const sidebarToggle = page.getByTestId("desktop-sidebar-toggle");
  const desktopSidebar = page.getByTestId("app-sidebar");

  const initialGeometry = await readDesktopSidebarGeometry(page);
  expect(initialGeometry.shellWidth).toBeGreaterThan(200);

  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();

  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 156, startY, { steps: 8 });
  await page.waitForTimeout(100);

  const compactAnimatedGeometry = await readDesktopSidebarGeometry(page);
  expect(compactAnimatedGeometry.sidebarWidth).toBeGreaterThanOrEqual(46);
  expect(compactAnimatedGeometry.sidebarWidth).toBeLessThan(initialGeometry.sidebarWidth);

  await page.waitForTimeout(180);
  const compactGeometry = await readDesktopSidebarGeometry(page);
  expect(compactGeometry.sidebarWidth).toBeGreaterThanOrEqual(46);
  expect(compactGeometry.sidebarWidth).toBeLessThanOrEqual(50);
  await expect(desktopSidebar.getByTestId("compact-sidebar-search-trigger")).toBeVisible();

  const compactPreviewMetrics = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const handle = document.querySelector('[data-testid="app-sidebar-resize-handle"]') as HTMLElement | null;
    return {
      sidebarRight: sidebar?.getBoundingClientRect().right ?? 0,
      handleLeft: handle?.getBoundingClientRect().left ?? 0,
    };
  });
  expect(Math.abs((compactPreviewMetrics.handleLeft + 8) - (compactPreviewMetrics.sidebarRight + PRIMARY_SIDEBAR_GAP_WIDTH_PX / 2))).toBeLessThanOrEqual(1);

  const compactSquares = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const searchTrigger = sidebar?.querySelector('[data-testid="compact-sidebar-search-trigger"]') as HTMLElement | null;
    const allRow = sidebar?.querySelector('[data-testid="source-row-all"]') as HTMLElement | null;
    const xRow = sidebar?.querySelector('[data-testid="source-row-x"]') as HTMLElement | null;
    const friendsRow = sidebar?.querySelector('[data-testid="source-row-friends"]') as HTMLElement | null;
    const searchIcon = searchTrigger?.querySelector("svg") as SVGElement | null;
    const xIcon = xRow?.querySelector("svg") as SVGElement | null;
    const sidebarRect = sidebar?.getBoundingClientRect();
    const searchRect = searchTrigger?.getBoundingClientRect();
    const allRect = allRow?.getBoundingClientRect();
    const rowRect = xRow?.getBoundingClientRect();
    const friendsRect = friendsRow?.getBoundingClientRect();
    return {
      sidebarWidth: sidebarRect?.width ?? 0,
      searchWidth: searchRect?.width ?? 0,
      searchHeight: searchRect?.height ?? 0,
      rowWidth: rowRect?.width ?? 0,
      rowHeight: rowRect?.height ?? 0,
      searchLeftInset: (searchRect?.left ?? 0) - (sidebarRect?.left ?? 0),
      searchRightInset: (sidebarRect?.right ?? 0) - (searchRect?.right ?? 0),
      searchToAllGap: (allRect?.top ?? 0) - (searchRect?.bottom ?? 0),
      allToFriendsGap: (friendsRect?.top ?? 0) - (allRect?.bottom ?? 0),
      searchIconWidth: searchIcon?.getBoundingClientRect().width ?? 0,
      searchIconHeight: searchIcon?.getBoundingClientRect().height ?? 0,
      xIconTag: xIcon?.tagName.toLowerCase() ?? null,
      xIconWidth: xIcon?.getBoundingClientRect().width ?? 0,
      xIconHeight: xIcon?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(compactSquares.searchLeftInset).toBeGreaterThanOrEqual(3);
  expect(compactSquares.searchLeftInset).toBeLessThanOrEqual(5);
  expect(compactSquares.searchRightInset).toBeGreaterThanOrEqual(3);
  expect(compactSquares.searchRightInset).toBeLessThanOrEqual(5);
  expect(Math.abs(compactSquares.searchWidth - (compactSquares.sidebarWidth - 8))).toBeLessThanOrEqual(2);
  expect(Math.abs(compactSquares.searchHeight - compactSquares.searchWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(compactSquares.rowWidth - (compactSquares.sidebarWidth - 8))).toBeLessThanOrEqual(2);
  expect(Math.abs(compactSquares.rowHeight - compactSquares.rowWidth)).toBeLessThanOrEqual(1);
  expect(compactSquares.searchToAllGap).toBeGreaterThanOrEqual(1);
  expect(compactSquares.searchToAllGap).toBeLessThanOrEqual(3);
  expect(compactSquares.allToFriendsGap).toBeGreaterThanOrEqual(1);
  expect(compactSquares.allToFriendsGap).toBeLessThanOrEqual(3);
  expect(compactSquares.searchIconWidth).toBeGreaterThanOrEqual(16);
  expect(compactSquares.searchIconWidth).toBeLessThanOrEqual(19);
  expect(compactSquares.searchIconHeight).toBeGreaterThanOrEqual(16);
  expect(compactSquares.searchIconHeight).toBeLessThanOrEqual(19);
  expect(compactSquares.xIconTag).toBe("svg");
  expect(compactSquares.xIconWidth).toBeGreaterThanOrEqual(18);
  expect(compactSquares.xIconWidth).toBeLessThanOrEqual(21);
  expect(compactSquares.xIconHeight).toBeGreaterThanOrEqual(18);
  expect(compactSquares.xIconHeight).toBeLessThanOrEqual(21);

  const compactStatusBadgeLayout = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const xRow = sidebar?.querySelector('[data-testid="source-row-x"]') as HTMLElement | null;
    const xIcon = xRow?.querySelector("svg") as SVGElement | null;
    const xIndicator = xRow?.querySelector('[data-testid="source-indicator-x"]') as HTMLElement | null;
    const rowRect = xRow?.getBoundingClientRect();
    const iconRect = xIcon?.getBoundingClientRect();
    const indicatorRect = xIndicator?.getBoundingClientRect();
    if (!rowRect || !iconRect || !indicatorRect) return null;
    return {
      indicatorCenterX: indicatorRect.left + indicatorRect.width / 2,
      indicatorCenterY: indicatorRect.top + indicatorRect.height / 2,
      iconRight: iconRect.right,
      iconTop: iconRect.top,
      rowRight: rowRect.right,
      rowTop: rowRect.top,
    };
  });

  expect(compactStatusBadgeLayout).not.toBeNull();
  expect(Math.abs(compactStatusBadgeLayout!.indicatorCenterX - compactStatusBadgeLayout!.iconRight)).toBeLessThanOrEqual(2);
  expect(compactStatusBadgeLayout!.indicatorCenterX).toBeLessThan(compactStatusBadgeLayout!.rowRight - 6);
  expect(compactStatusBadgeLayout!.indicatorCenterY).toBeGreaterThanOrEqual(compactStatusBadgeLayout!.iconTop - 3);
  expect(compactStatusBadgeLayout!.indicatorCenterY).toBeLessThanOrEqual(compactStatusBadgeLayout!.iconTop + 3);

  await page.mouse.move(startX - 240, startY, { steps: 6 });
  await page.waitForTimeout(100);
  const closedPreviewGeometry = await readDesktopSidebarGeometry(page);
  expect(closedPreviewGeometry.shellWidth).toBeLessThan(compactGeometry.shellWidth);
  expect(closedPreviewGeometry.shellWidth).toBeGreaterThanOrEqual(0);
  expect(closedPreviewGeometry.sidebarRight).toBeGreaterThanOrEqual(-SIDEBAR_CLOSED_EDGE_TOLERANCE_PX);
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Show sidebar");

  await expectDesktopSidebarShellWidthAtMost(page, 2, 500);
  const settledClosedPreviewGeometry = await readDesktopSidebarGeometry(page);
  expect(settledClosedPreviewGeometry.sidebarRight).toBeLessThanOrEqual(2);
  await page.mouse.move(startX - 156, startY, { steps: 6 });
  await page.waitForTimeout(100);
  const compactAgainGeometry = await readDesktopSidebarGeometry(page);
  expect(compactAgainGeometry.sidebarWidth).toBeGreaterThanOrEqual(46);
  expect(compactAgainGeometry.sidebarWidth).toBeLessThanOrEqual(50);
  await page.mouse.up();
  await page.waitForTimeout(250);

  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Show sidebar");
  await waitForDesktopSidebarMode(page, "closed");
  await expectDesktopSidebarClosed(page, 1_000);

  const widthSamplesPromise = page.evaluate(() => new Promise<number[]>((resolve) => {
    const samples: number[] = [];
    const startedAt = performance.now();
    const record = () => {
      const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
      samples.push(sidebar?.getBoundingClientRect().width ?? 0);
      if (performance.now() - startedAt < 300) {
        requestAnimationFrame(record);
        return;
      }
      resolve(samples);
    };
    requestAnimationFrame(record);
  }));

  await sidebarToggle.click();
  const widthSamples = await widthSamplesPromise;
  const expandedWidthSamples = widthSamples.filter(
    (width) => width >= DEFAULT_REOPENED_SIDEBAR_MIN_WIDTH_PX,
  );
  expect(expandedWidthSamples.length).toBeGreaterThan(0);
  expect(expandedWidthSamples[0]).toBeGreaterThanOrEqual(DEFAULT_REOPENED_SIDEBAR_MIN_WIDTH_PX);
  expect(Math.min(...expandedWidthSamples)).toBeGreaterThanOrEqual(DEFAULT_REOPENED_SIDEBAR_MIN_WIDTH_PX);

  await waitForDesktopSidebarMode(page, "expanded");
  await expect(desktopSidebar).toBeVisible();
  await expectDesktopSidebarWidthBetween(
    page,
    DEFAULT_REOPENED_SIDEBAR_MIN_WIDTH_PX,
    DEFAULT_REOPENED_SIDEBAR_MAX_WIDTH_PX,
  );

  const compactHandleBox = await resizeHandle.boundingBox();
  expect(compactHandleBox).not.toBeNull();
  const compactStartX = compactHandleBox!.x + compactHandleBox!.width / 2;
  const compactStartY = compactHandleBox!.y + compactHandleBox!.height / 2;

  await page.mouse.move(compactStartX, compactStartY);
  await page.mouse.down();
  await page.mouse.move(compactStartX - 240, compactStartY, { steps: 8 });
  await page.waitForTimeout(100);
  const compactClosedPreviewGeometry = await readDesktopSidebarGeometry(page);
  expect(compactClosedPreviewGeometry.shellWidth).toBeGreaterThanOrEqual(0);
  await expectDesktopSidebarShellWidthAtMost(page, 2, 500);
  await page.mouse.up();

  await sidebarToggle.click();
  await waitForDesktopSidebarMode(page, "expanded");
  await expect(desktopSidebar).toBeVisible();
  await expectDesktopSidebarWidthBetween(page, 252, 260);

  await waitForDesktopSidebarMode(page, "expanded");
});

test("compact sidebar search opens as a floating palette and closes cleanly", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  const desktopSidebar = page.getByTestId("app-sidebar");

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          setState: (partial: {
            providerSyncCounts: Record<string, number>;
          }) => void;
        }
      | undefined;

    store?.setState({
      providerSyncCounts: {
        rss: 1,
        x: 1,
        facebook: 0,
        instagram: 0,
        linkedin: 0,
        gdrive: 0,
        dropbox: 0,
      },
    });
  });

  await dragElementBy(page, page.getByTestId("app-sidebar-resize-handle"), -208);
  await page.waitForTimeout(250);

  const trigger = desktopSidebar.getByTestId("compact-sidebar-search-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("compact-sidebar-search-palette")).toBeVisible();
  const compactPaletteGeometry = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const palette = document.querySelector('[data-testid="compact-sidebar-search-palette"]') as HTMLElement | null;
    return {
      sidebarTop: sidebar?.getBoundingClientRect().top ?? 0,
      paletteTop: palette?.getBoundingClientRect().top ?? 0,
    };
  });
  expect(Math.abs(compactPaletteGeometry.paletteTop - compactPaletteGeometry.sidebarTop)).toBeLessThanOrEqual(1);
  const floatingSearch = page.getByTestId("compact-sidebar-search-palette").getByLabel("Search or run");
  await expect(floatingSearch).toBeFocused();
  await expect(page.getByTestId("search-command-action-go-unified-feed")).toBeVisible();
  await floatingSearch.fill("face");
  await expect(page.getByTestId("compact-sidebar-search-palette").getByRole("option", { name: /Search current feed for "face"/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("compact-sidebar-search-palette")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByTestId("workspace-toolbar").getByLabel("Search all sources")).toHaveCount(0);
  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("Search: face");
  await page.evaluate(() => {
    const store = (window as any).__FREED_STORE__ as {
      getState: () => { setSearchQuery: (query: string) => void };
    };
    store.getState().setSearchQuery("");
  });
  await expect(page.getByTestId("workspace-toolbar-title-block")).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
});

test("desktop toolbar controls remain clickable no-drag targets", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const initialWidth = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return sidebarShell?.getBoundingClientRect().width ?? 0;
  });

  const sidebarToggle = page.getByTestId("desktop-sidebar-toggle");
  const targetState = await readElementFromPointDragState(page, sidebarToggle);
  const sidebarToggleRegion = await sidebarToggle.evaluate((button) => button.style.webkitAppRegion);
  expect(targetState).not.toBeNull();
  expect(targetState?.hasDirectDragAttr).toBe(false);
  expect(sidebarToggleRegion).toBe("no-drag");

  await sidebarToggle.click();

  expect(initialWidth).toBeGreaterThan(200);
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
      return sidebarShell?.getBoundingClientRect().width ?? 0;
    });
  }).toBeLessThan(initialWidth);
});

test("desktop passive toolbar targets expose direct native drag attributes", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const wordmarkState = await readElementFromPointDragState(page, page.getByTestId("workspace-toolbar-wordmark"));
  const titleState = await readElementFromPointDragState(page, page.getByTestId("workspace-toolbar-title-block").locator("p"));
  const logoGapPoint = await page.evaluate(() => {
    const wordmark = document.querySelector('[data-testid="workspace-toolbar-wordmark"]') as HTMLElement | null;
    const sidebarToggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    if (!wordmark || !sidebarToggle) return null;

    const wordmarkRect = wordmark.getBoundingClientRect();
    const toggleRect = sidebarToggle.getBoundingClientRect();
    return {
      x: wordmarkRect.right + Math.max(2, Math.min(24, (toggleRect.left - wordmarkRect.right) / 2)),
      y: wordmarkRect.top + wordmarkRect.height / 2,
    };
  });
  expect(logoGapPoint).not.toBeNull();
  const logoGapState = await readPointDragState(page, logoGapPoint!.x, logoGapPoint!.y);

  expect(wordmarkState).not.toBeNull();
  expect(wordmarkState?.hasDirectDragAttr).toBe(true);
  expect(wordmarkState?.inlineWebkitAppRegion).toBe("drag");
  expect(wordmarkState?.computedCursor).toBe("default");
  expect(wordmarkState?.computedUserSelect).toBe("none");
  expect(titleState).not.toBeNull();
  expect(titleState?.hasDirectDragAttr).toBe(true);
  expect(titleState?.inlineWebkitAppRegion).toBe("drag");
  expect(titleState?.computedCursor).toBe("default");
  expect(titleState?.computedUserSelect).toBe("none");
  expect(logoGapState).not.toBeNull();
  expect(logoGapState?.testId).toBe("workspace-toolbar-logo-drag-region");
  expect(logoGapState?.hasDirectDragAttr).toBe(true);
  expect(logoGapState?.inlineWebkitAppRegion).toBe("drag");
});

test("reader toolbar keeps back button clickable while title text is a drag target", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  await page.locator("[data-feed-item-id]").first().click();
  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.classList.contains("feed-layout-transition"));
  }).toBe(false);
  const readerTitleBlock = page.getByTestId("workspace-toolbar-reader-title-block");
  await expect(readerTitleBlock).toBeVisible();

  const readerTitleState = await readElementFromPointDragState(page, readerTitleBlock.locator("p"));
  const backButton = page.getByTestId("workspace-toolbar-reader-back");
  const backButtonRegion = await backButton.evaluate((button) => button.style.webkitAppRegion);

  expect(readerTitleState).not.toBeNull();
  expect(readerTitleState?.hasDirectDragAttr).toBe(true);
  expect(readerTitleState?.inlineWebkitAppRegion).toBe("drag");
  expect(backButtonRegion).toBe("no-drag");

  await backButton.click();

  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedItemId: string | null } }
      | undefined;
    return store?.getState().selectedItemId === null;
  });
  await expect(page.locator("[data-feed-item-id]")).toHaveCount(8);
});

test("reader toolbar keeps the Focus toggle text vertically centered", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(4);

  await page.locator("[data-feed-item-id]").first().click();
  const focusButton = page.getByRole("button", { name: "Toggle focus reading mode" });
  await expect(focusButton).toBeVisible({ timeout: 5_000 });

  const geometry = await focusButton.evaluate((button) => {
    const label = button.querySelector("[aria-hidden='true']") as HTMLElement | null;
    if (!label) throw new Error("Focus toggle label is missing");

    const buttonRect = button.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    return {
      buttonHeight: Math.round(buttonRect.height),
      centerDelta: Math.abs(
        (labelRect.top + labelRect.height / 2) -
        (buttonRect.top + buttonRect.height / 2),
      ),
    };
  });

  expect(geometry.buttonHeight).toBe(36);
  expect(geometry.centerDelta).toBeLessThanOrEqual(1);
});

test("fullscreen reader toolbar passive targets expose direct native drag attributes", async ({ app, page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      get: () => ({ mobile: true }),
    });
  });
  await page.setViewportSize({ width: 430, height: 844 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(4);

  await page.getByText("Article 0:", { exact: false }).click();
  const title = page.getByTestId("reader-view-toolbar-title");
  await expect(title).toBeVisible({ timeout: 5_000 });

  const titleState = await readElementFromPointDragState(page, title);
  const spacerState = await readElementFromPointDragState(page, page.getByTestId("reader-view-toolbar-spacer"));
  const backButton = page.getByRole("button", { name: "Back", exact: true });
  const backButtonRegion = await backButton.evaluate((button) => button.style.webkitAppRegion);

  expect(titleState).not.toBeNull();
  expect(titleState?.hasDirectDragAttr).toBe(true);
  expect(titleState?.inlineWebkitAppRegion).toBe("drag");
  expect(spacerState).not.toBeNull();
  expect(spacerState?.hasDirectDragAttr).toBe(true);
  expect(spacerState?.inlineWebkitAppRegion).toBe("drag");
  expect(backButtonRegion).toBe("no-drag");
});

test("desktop primary feed marks scrolled-past rows as read", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(30);

  const firstItemId = "rss:https://bench.example/feed.xml:bench-item-0";
  const initialUnreadCount = await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            preferences: {
              display: {
                reading: {
                  markReadOnScroll: boolean;
                  showReadInGrayscale: boolean;
                };
              };
            };
            totalUnreadCount: number;
          };
        }
      | undefined;
    const state = store?.getState();
    if (!state?.preferences.display.reading.markReadOnScroll) {
      throw new Error("Mark read on scroll is not enabled");
    }
    if (!state.preferences.display.reading.showReadInGrayscale) {
      throw new Error("Read grayscale is not enabled");
    }
    return state.totalUnreadCount;
  });

  const feedContainer = page.getByTestId("feed-list-scroll-container");
  await expect(feedContainer).toBeVisible();
  const feedBox = await feedContainer.boundingBox();
  if (!feedBox) {
    throw new Error("Feed scroll container was not visible");
  }
  await page.mouse.move(feedBox.x + feedBox.width / 2, feedBox.y + feedBox.height / 2);
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, 400);
  }

  await expect
    .poll(async () => page.evaluate((itemId) => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as
        | {
            getState: () => {
              items: Array<{ globalId: string; userState: { readAt?: number } }>;
            };
          }
        | undefined;
      return Boolean(store?.getState().items.find((item) => item.globalId === itemId)?.userState.readAt);
    }, firstItemId), { timeout: 10_000 })
    .toBe(true);

  await expect
    .poll(async () => page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as
        | { getState: () => { totalUnreadCount: number } }
        | undefined;
      return store?.getState().totalUnreadCount ?? Number.POSITIVE_INFINITY;
    }), { timeout: 10_000 })
    .toBeLessThan(initialUnreadCount);

  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="feed-list-scroll-container"]') as HTMLElement | null;
    if (!container) {
      throw new Error("Feed scroll container was not found");
    }
    container.scrollTop = container.scrollHeight;
    container.dispatchEvent(new Event("scroll"));
  });

  await expect
    .poll(async () => page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as
        | { getState: () => { totalUnreadCount: number } }
        | undefined;
      return store?.getState().totalUnreadCount ?? Number.POSITIVE_INFINITY;
    }), { timeout: 10_000 })
    .toBe(0);

  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="feed-list-scroll-container"]') as HTMLElement | null;
    if (!container) {
      throw new Error("Feed scroll container was not found");
    }
    container.scrollTop = 0;
    container.dispatchEvent(new Event("scroll"));
  });

  await expect
    .poll(async () => page.evaluate(() => {
      const container = document.querySelector('[data-testid="feed-list-scroll-container"]') as HTMLElement | null;
      return container?.scrollTop ?? Number.NaN;
    }), { timeout: 10_000 })
    .toBe(0);

  const topCard = page.locator("[data-feed-item-id]").first();
  await expect(topCard).toBeVisible({ timeout: 10_000 });
  await expect(topCard).toHaveClass(/grayscale/);
});

test("keyboard focus scrolling keeps a full row visible past the focused item", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(12);

  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("ArrowDown");
  }

  await page.waitForFunction(() => {
    const container = document.querySelector('[data-testid="feed-list-scroll-container"]') as HTMLElement | null;
    const focusedItem = container?.querySelector('[data-focused="true"]') as HTMLElement | null;
    const focusedRow = focusedItem?.closest('[data-feed-row-index]') as HTMLElement | null;
    if (!container || !focusedRow) return false;

    const rowIndex = Number(focusedRow.dataset.feedRowIndex);
    const nextRow = container.querySelector(`[data-feed-row-index="${rowIndex + 1}"]`) as HTMLElement | null;
    if (!nextRow) return false;

    const containerRect = container.getBoundingClientRect();
    const nextRowRect = nextRow.getBoundingClientRect();

    return nextRowRect.top >= containerRect.top && nextRowRect.bottom <= containerRect.bottom;
  });

  const metrics = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="feed-list-scroll-container"]') as HTMLElement | null;
    const focusedItem = container?.querySelector('[data-focused="true"]') as HTMLElement | null;
    const focusedRow = focusedItem?.closest('[data-feed-row-index]') as HTMLElement | null;
    if (!container || !focusedRow) {
      throw new Error("Focused feed row was not found");
    }

    const rowIndex = Number(focusedRow.dataset.feedRowIndex);
    const nextRow = container.querySelector(`[data-feed-row-index="${rowIndex + 1}"]`) as HTMLElement | null;
    if (!nextRow) {
      throw new Error("Next feed row was not found");
    }

    const containerRect = container.getBoundingClientRect();
    const nextRowRect = nextRow.getBoundingClientRect();

    return {
      scrollTop: container.scrollTop,
      nextRowTop: nextRowRect.top,
      nextRowBottom: nextRowRect.bottom,
      containerTop: containerRect.top,
      containerBottom: containerRect.bottom,
    };
  });

  expect(metrics.scrollTop).toBeGreaterThan(0);
  expect(metrics.nextRowTop).toBeGreaterThanOrEqual(metrics.containerTop);
  expect(metrics.nextRowBottom).toBeLessThanOrEqual(metrics.containerBottom);
});

test("sidebar resize holds the dragged width after mouseup", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { sidebarWidth: number } }) => Promise<void>;
          };
          setState: (partial: Record<string, unknown>) => void;
        }
      | undefined;

    if (!store) return;

    const originalUpdatePreferences = store.getState().updatePreferences;
    store.setState({
      updatePreferences: async (patch: { display: { sidebarWidth: number } }) => {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        await originalUpdatePreferences(patch);
      },
    });
  });

  const sidebar = page.getByTestId("app-sidebar");
  const resizeHandle = page.getByTestId("app-sidebar-resize-handle");
  const initialWidth = await sidebar.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  await dragElementBy(page, resizeHandle, 72);
  await page.waitForTimeout(100);

  const widthAfterRelease = await sidebar.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  expect(widthAfterRelease).toBeGreaterThan(initialWidth + 24);

  await page.waitForTimeout(450);
  const settledWidth = await sidebar.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  expect(settledWidth).toBeGreaterThan(initialWidth + 40);

  await page.waitForFunction((minimumWidth) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { sidebarWidth?: number } };
          };
        }
      | undefined;

    const savedWidth = store?.getState().preferences.display.sidebarWidth ?? 0;
    return savedWidth >= minimumWidth;
  }, Math.round(initialWidth + 40));
});

test("primary sidebar resize caps at 400 pixels", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const resizeHandle = page.getByTestId("app-sidebar-resize-handle");
  await expect(resizeHandle).toBeVisible();

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;

    await store?.getState().updatePreferences({
      display: {
        sidebarMode: "expanded",
        sidebarWidth: 256,
      },
    });
  });
  await expect(page.getByTestId("desktop-sidebar-toggle")).toHaveAttribute("aria-label", "Minimal sidebar");

  await dragElementBy(page, resizeHandle, 300);
  await expect
    .poll(async () =>
      page.getByTestId("app-sidebar").evaluate((element) =>
        Math.round(element.getBoundingClientRect().width),
      ),
    )
    .toBeGreaterThanOrEqual(396);
  const sidebarWidth = await page.getByTestId("app-sidebar").evaluate((element) =>
    Math.round(element.getBoundingClientRect().width),
  );
  expect(sidebarWidth).toBeLessThanOrEqual(400);

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { sidebarWidth?: number } };
          };
        }
      | undefined;
    return store?.getState().preferences.display.sidebarWidth === 400;
  }, { timeout: 5_000 });
});

test("desktop sidebar reopens at the default width after being dragged narrow and collapsed", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const sidebar = page.getByTestId("app-sidebar");
  const resizeHandle = page.getByTestId("app-sidebar-resize-handle");
  const sidebarToggle = page.getByTestId("desktop-sidebar-toggle");

  await expect(sidebar).toBeVisible();
  await dragElementBy(page, resizeHandle, -72);
  await page.waitForTimeout(250);

  const narrowWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  expect(narrowWidth).toBeGreaterThanOrEqual(
    NARROW_DRAGGED_SIDEBAR_TARGET_WIDTH_PX - NARROW_DRAGGED_SIDEBAR_TOLERANCE_PX,
  );
  expect(narrowWidth).toBeLessThanOrEqual(
    NARROW_DRAGGED_SIDEBAR_TARGET_WIDTH_PX + NARROW_DRAGGED_SIDEBAR_TOLERANCE_PX,
  );

  await page.waitForFunction(({
    minimumWidth,
    maximumWidth,
  }) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { sidebarWidth?: number } };
          };
        }
      | undefined;

    const savedWidth = store?.getState().preferences.display.sidebarWidth ?? 0;
    return savedWidth >= minimumWidth && savedWidth <= maximumWidth;
  }, {
    minimumWidth: NARROW_DRAGGED_SIDEBAR_TARGET_WIDTH_PX - NARROW_DRAGGED_SIDEBAR_TOLERANCE_PX,
    maximumWidth: NARROW_DRAGGED_SIDEBAR_TARGET_WIDTH_PX + NARROW_DRAGGED_SIDEBAR_TOLERANCE_PX,
  });

  await sidebarToggle.click();
  await expectDesktopSidebarWidthBetween(page, 46, 50, 1_500);
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Hide sidebar");

  await sidebarToggle.click();
  await waitForDesktopSidebarMode(page, "closed");
  await expectDesktopSidebarClosed(page, 1_000);
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Show sidebar");

  await sidebarToggle.click();
  await expect
    .poll(async () => (await readDesktopSidebarGeometry(page)).sidebarWidth, { timeout: 1_000 })
    .toBeGreaterThanOrEqual(DEFAULT_REOPENED_SIDEBAR_MIN_WIDTH_PX);
  await expect
    .poll(async () => (await readDesktopSidebarGeometry(page)).sidebarWidth, { timeout: 1_000 })
    .toBeLessThanOrEqual(DEFAULT_REOPENED_SIDEBAR_MAX_WIDTH_PX);

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { sidebarWidth?: number } };
          };
        }
      | undefined;

    return store?.getState().preferences.display.sidebarWidth === 256;
  });
});

test("debug panel resize holds the dragged width after mouseup", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (debugStorePath) => {
    const mod = await import(debugStorePath);
    mod.useDebugStore.getState().setVisible(true);
  }, DEBUG_STORE_PATH);

  const debugPanel = page.getByTestId("debug-panel-drawer");
  const debugSurface = page.getByTestId("debug-panel-surface");
  await expect(debugPanel).toBeVisible();
  await page.waitForTimeout(350);

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { debugPanelWidth: number } }) => Promise<void>;
          };
          setState: (partial: Record<string, unknown>) => void;
        }
      | undefined;

    if (!store) return;

    const originalUpdatePreferences = store.getState().updatePreferences;
    store.setState({
      updatePreferences: async (patch: { display: { debugPanelWidth: number } }) => {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        await originalUpdatePreferences(patch);
      },
    });
  });

  const initialWidth = await page.evaluate(() => {
    const debugPanel = document.querySelector('[data-testid="debug-panel-drawer"]') as HTMLElement | null;
    const resizeHandle = document.querySelector('[data-testid="debug-panel-resize-handle"]') as HTMLElement | null;
    if (!debugPanel || !resizeHandle) {
      throw new Error("Debug panel resize elements were not found");
    }

    const initialWidth = debugPanel.getBoundingClientRect().width;
    const handleRect = resizeHandle.getBoundingClientRect();
    const startX = handleRect.left + handleRect.width / 2;
    const pointerY = handleRect.top + handleRect.height / 2;
    const endX = startX - 72;

    resizeHandle.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: startX,
        clientY: pointerY,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: endX,
        clientY: pointerY,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        clientX: endX,
        clientY: pointerY,
      }),
    );

    return initialWidth;
  });

  await page.waitForTimeout(450);
  const widthAfterTransition = await debugSurface.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  expect(widthAfterTransition).toBeGreaterThan(initialWidth + 40);

  await page.waitForTimeout(450);
  const settledWidth = await debugSurface.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  expect(settledWidth).toBeGreaterThan(initialWidth + 40);

  await page.waitForFunction((expectedWidth) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { debugPanelWidth?: number } };
          };
        }
      | undefined;

    const savedWidth = store?.getState().preferences.display.debugPanelWidth ?? 0;
    return Math.abs(savedWidth - expectedWidth) <= 2;
  }, Math.round(settledWidth));
});

test("settings dialog closes from the desktop sidebar close button", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  await page.getByTestId("settings-close-button-sidebar").click();
  await expect(page.getByTestId("settings-close-button-sidebar")).toHaveCount(0);
});

test("settings backdrop stays blurred during high memory pressure", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await page.evaluate(async (settingsStorePath) => {
    document.documentElement.dataset.memoryPressure = "high";
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  const styles = await page.evaluate(() => {
    const overlay = document.querySelector(".theme-settings-overlay");
    const shell = document.querySelector(".theme-dialog-shell");
    if (!(overlay instanceof HTMLElement) || !(shell instanceof HTMLElement)) {
      throw new Error("Settings dialog styles were not mounted");
    }

    const overlayStyle = window.getComputedStyle(overlay);
    const shellStyle = window.getComputedStyle(shell);
    return {
      overlayFilter: overlayStyle.backdropFilter || overlayStyle.webkitBackdropFilter,
      shellFilter: shellStyle.backdropFilter || shellStyle.webkitBackdropFilter,
    };
  });

  expect(styles.overlayFilter).toContain("blur");
  expect(styles.overlayFilter).not.toBe("none");
  expect(styles.shellFilter).toContain("blur");
  expect(styles.shellFilter).not.toBe("none");
});

test("settings backdrop stays blurred while settings contents scroll", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  const scrollContainer = page.getByTestId("settings-scroll-container");
  const styles = await scrollContainer.evaluate((element) => {
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    element.scrollTop = Math.min(Math.max(maxScrollTop, 0), 360);
    element.dispatchEvent(new Event("scroll", { bubbles: true }));

    const overlay = document.querySelector(".theme-settings-overlay");
    const shell = document.querySelector(".theme-settings-shell");
    if (!(overlay instanceof HTMLElement) || !(shell instanceof HTMLElement)) {
      throw new Error("Settings dialog styles were not mounted");
    }

    const overlayStyle = window.getComputedStyle(overlay);
    const shellStyle = window.getComputedStyle(shell);
    return {
      maxScrollTop,
      scrollTop: element.scrollTop,
      overlayMoving: overlay.dataset.moving,
      shellMoving: shell.dataset.moving,
      overlayFilter: overlayStyle.backdropFilter || overlayStyle.webkitBackdropFilter,
      shellFilter: shellStyle.backdropFilter || shellStyle.webkitBackdropFilter,
    };
  });

  expect(styles.maxScrollTop).toBeGreaterThan(0);
  expect(styles.scrollTop).toBeGreaterThan(0);
  expect(styles.overlayMoving).toBe("true");
  expect(styles.shellMoving).toBe("true");
  expect(styles.overlayFilter).toBe("none");
  expect(styles.shellFilter).toContain("blur");
  expect(styles.shellFilter).not.toBe("none");
});

test("settings dialog closes from the mobile header close button", async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await expect(page.getByTestId("settings-close-button-mobile")).toBeVisible({ timeout: 5_000 });

  await page.getByTestId("settings-close-button-mobile").click();
  await expect(page.getByTestId("settings-close-button-mobile")).toHaveCount(0);

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page.getByTestId("settings-close-button-mobile")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("settings-close-button-mobile").click();
  await expect(page.getByTestId("settings-close-button-mobile")).toHaveCount(0);
});

test("settings nav highlight follows scroll position", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  const dialog = page.locator(".theme-dialog-shell").first();
  const scrollContainer = page.getByTestId("settings-scroll-container");
  const appearanceButton = dialog.locator('button[data-active="true"]').filter({
    hasText: /^Appearance$/,
  });
  const syncButton = dialog.locator('button[data-active="true"]').filter({
    hasText: /^Sync$/,
  });

  await expect(appearanceButton).toHaveCount(1);

  await scrollContainer.evaluate((element) => {
    const target = element.querySelector('[data-section="sync"]');
    if (!(target instanceof HTMLElement)) {
      throw new Error("Sync section not found");
    }
    element.scrollTo({ top: Math.max(0, target.offsetTop - 24) });
  });

  await expect(syncButton).toHaveCount(1);
});

test("provider settings do not remount when health updates arrive", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async ({ settingsStorePath, debugStorePath }) => {
    const makeDailyBuckets = () =>
      Array.from({ length: 7 }, (_, index) => ({
        dateKey: `2026-04-0${index + 1}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeHourlyBuckets = () =>
      Array.from({ length: 24 }, (_, index) => ({
        hourKey: `2026-04-12T${String(index).padStart(2, "0")}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeSnapshot = (
      provider: "rss" | "x" | "facebook" | "instagram" | "linkedin" | "gdrive" | "dropbox",
    ) => ({
      provider,
      status: provider === "x" ? "degraded" : "idle",
      lastAttemptAt: provider === "x" ? Date.now() : undefined,
      lastSuccessfulAt: provider === "x" ? Date.now() - 120_000 : undefined,
      lastOutcome: provider === "x" ? "error" : undefined,
      lastError: provider === "x" ? "Transient timeout" : undefined,
      currentMessage: provider === "x" ? "Transient timeout" : undefined,
      pause: null,
      dailyBuckets: makeDailyBuckets(),
      hourlyBuckets: makeHourlyBuckets(),
      latestAttempts: [],
      totalSeen7d: 0,
      totalAdded7d: 0,
      totalBytes7d: 0,
    });

    const settingsMod = await import(settingsStorePath);
    const debugMod = await import(debugStorePath);

    settingsMod.useSettingsStore.getState().openTo("x");
    debugMod.useDebugStore.getState().setHealth({
      providers: {
        rss: makeSnapshot("rss"),
        x: makeSnapshot("x"),
        facebook: makeSnapshot("facebook"),
        instagram: makeSnapshot("instagram"),
        linkedin: makeSnapshot("linkedin"),
        gdrive: makeSnapshot("gdrive"),
        dropbox: makeSnapshot("dropbox"),
      },
      failingRssFeeds: [],
      updatedAt: Date.now(),
    });
  }, { settingsStorePath: SETTINGS_STORE_PATH, debugStorePath: DEBUG_STORE_PATH });

  await expect(page.getByText("X / Twitter").first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Manual cookie setup" }).click();

  const ct0Input = page.getByPlaceholder("ct0 value");
  await expect(ct0Input).toBeVisible();
  await ct0Input.fill("sticky-cookie");

  await page.evaluate(async (debugStorePath) => {
    const makeDailyBuckets = () =>
      Array.from({ length: 7 }, (_, index) => ({
        dateKey: `2026-04-0${index + 1}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeHourlyBuckets = () =>
      Array.from({ length: 24 }, (_, index) => ({
        hourKey: `2026-04-12T${String(index).padStart(2, "0")}`,
        attempts: 0,
        successes: 0,
        failures: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
      }));
    const makeSnapshot = (
      provider: "rss" | "x" | "facebook" | "instagram" | "linkedin" | "gdrive" | "dropbox",
    ) => ({
      provider,
      status: provider === "x" ? "degraded" : "idle",
      lastAttemptAt: provider === "x" ? Date.now() : undefined,
      lastSuccessfulAt: provider === "x" ? Date.now() - 60_000 : undefined,
      lastOutcome: provider === "x" ? "error" : undefined,
      lastError: provider === "x" ? "Retrying after timeout" : undefined,
      currentMessage: provider === "x" ? "Retrying after timeout" : undefined,
      pause: null,
      dailyBuckets: makeDailyBuckets(),
      hourlyBuckets: makeHourlyBuckets(),
      latestAttempts: [],
      totalSeen7d: 0,
      totalAdded7d: 0,
      totalBytes7d: 0,
    });

    const debugMod = await import(debugStorePath);
    debugMod.useDebugStore.getState().setHealth({
      providers: {
        rss: makeSnapshot("rss"),
        x: makeSnapshot("x"),
        facebook: makeSnapshot("facebook"),
        instagram: makeSnapshot("instagram"),
        linkedin: makeSnapshot("linkedin"),
        gdrive: makeSnapshot("gdrive"),
        dropbox: makeSnapshot("dropbox"),
      },
      failingRssFeeds: [],
      updatedAt: Date.now(),
    });
  }, DEBUG_STORE_PATH);

  await expect(ct0Input).toBeVisible();
  await expect(ct0Input).toHaveValue("sticky-cookie");
});

test("provider risk dialog scrolls vertically on tiny mobile screens", async ({ app, page }) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("facebook");
  }, SETTINGS_STORE_PATH);

  await page.getByRole("button", { name: "Log in with Facebook" }).click();
  const dialog = page.getByTestId("provider-risk-dialog-facebook");
  const dialogBody = page.getByTestId("provider-risk-dialog-body-facebook");
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialogBody).toBeVisible({ timeout: 5_000 });

  const metrics = await dialogBody.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });

  expect(metrics.overflowY).toBe("auto");
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
});

test("provider risk eyebrow stays readable across themes", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("facebook");
  }, SETTINGS_STORE_PATH);

  await page.getByRole("button", { name: "Log in with Facebook" }).click();
  const eyebrow = page.getByTestId("provider-risk-eyebrow-facebook");
  await expect(eyebrow).toBeVisible({ timeout: 5_000 });

  const themeIds = ["scriptorium", "neon", "midas", "ember"] as const;
  for (const themeId of themeIds) {
    const contrast = await eyebrow.evaluate((element, nextThemeId) => {
      document.documentElement.dataset.theme = nextThemeId;

      function resolveColor(value: string): [number, number, number] {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          throw new Error("Could not create color parser");
        }
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return [red, green, blue];
      }

      function luminance([red, green, blue]: [number, number, number]): number {
        const [r, g, b] = [red, green, blue].map((channel) => {
          const value = channel / 255;
          return value <= 0.03928
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }

      const style = window.getComputedStyle(element);
      const rootStyle = window.getComputedStyle(document.documentElement);
      const foreground = resolveColor(style.color);
      const surface = resolveColor(rootStyle.getPropertyValue("--theme-bg-surface").trim());
      const foregroundLum = luminance(foreground);
      const surfaceLum = luminance(surface);
      const lighter = Math.max(foregroundLum, surfaceLum);
      const darker = Math.min(foregroundLum, surfaceLum);
      return (lighter + 0.05) / (darker + 0.05);
    }, themeId);

    expect(contrast, `${themeId} provider risk eyebrow contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test("Friends view can return to the feed from sidebar navigation", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(1);

  const { page } = app;
  const sidebar = page.getByTestId("app-sidebar");

  await sidebar.getByTestId("source-row-friends").click();
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "friends";
  }, { timeout: 15_000 });

  await page.getByRole("button", { name: /^Unified Feed$/ }).click();
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "feed";
  }, { timeout: 15_000 });
  await expect(page.getByText("Article 0:", { exact: false })).toBeVisible({ timeout: 5_000 });
});

test("desktop navigation history supports Cmd+[ and Cmd+] across views", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(1);

  const { page } = app;

  await page.getByTestId("source-row-friends").click();
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "friends";
  }, { timeout: 5_000 });

  await page.keyboard.press("Meta+[");
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "feed";
  }, { timeout: 5_000 });

  await page.keyboard.press("Meta+]");
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "friends";
  }, { timeout: 5_000 });
});

test("desktop reader history supports Cmd+[ and Cmd+] for open items", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(1);

  const { page } = app;
  await page.getByText("Article 0:", { exact: false }).click();

  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedItemId: string | null } }
      | undefined;
    return store?.getState().selectedItemId !== null;
  }, { timeout: 5_000 });
  await expect(page.getByLabel("Back")).toBeVisible({ timeout: 5_000 });

  await page.keyboard.press("Meta+[");
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedItemId: string | null } }
      | undefined;
    return store?.getState().selectedItemId === null;
  }, { timeout: 5_000 });
  await expect(page.getByLabel("Back")).toHaveCount(0);

  await page.keyboard.press("Meta+]");
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedItemId: string | null } }
      | undefined;
    return store?.getState().selectedItemId !== null;
  }, { timeout: 5_000 });
  await expect(page.getByLabel("Back")).toBeVisible({ timeout: 5_000 });
});

test("dual-column reader arrow navigation cycles tiles and keeps the selected tile visible", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(12);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;

    void store?.getState().updatePreferences({
      display: {
        animationIntensity: "detailed",
        reading: {
          dualColumnMode: true,
        },
      },
    });
  });

  await page.getByText("Article 0:", { exact: false }).click();
  await expect(page.getByLabel("Back")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("compact-feed-panel-scroll-container")).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.classList.contains("feed-layout-transition"));
  }).toBe(false);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const container = document.querySelector('[data-testid="compact-feed-panel-scroll-container"]') as HTMLElement | null;
          const selectedItem = container?.querySelector('[data-selected="true"]') as HTMLElement | null;
          const selectedRow = selectedItem?.closest('[data-compact-panel-index]') as HTMLElement | null;
          return Number(selectedRow?.dataset.compactPanelIndex ?? -1);
        });
      }, { timeout: 5_000 })
      .toBe(i + 1);
  }

  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedItemId: string | null } }
      | undefined;
    const selectedItemId = store?.getState().selectedItemId ?? "";
    return selectedItemId.endsWith("bench-item-6") || selectedItemId.endsWith("bench-item-7");
  }, { timeout: 5_000 });

  await page.waitForFunction(() => {
    const container = document.querySelector('[data-testid="compact-feed-panel-scroll-container"]') as HTMLElement | null;
    const selectedItem = container?.querySelector('[data-selected="true"]') as HTMLElement | null;
    const selectedRow = selectedItem?.closest('[data-compact-panel-index]') as HTMLElement | null;
    if (!container || !selectedRow) return false;

    const containerRect = container.getBoundingClientRect();
    const selectedRowRect = selectedRow.getBoundingClientRect();

    return selectedRowRect.top >= containerRect.top && selectedRowRect.bottom <= containerRect.bottom;
  }, { timeout: 5_000 });

  const metrics = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="compact-feed-panel-scroll-container"]') as HTMLElement | null;
    const selectedItem = container?.querySelector('[data-selected="true"]') as HTMLElement | null;
    const selectedRow = selectedItem?.closest('[data-compact-panel-index]') as HTMLElement | null;
    if (!container || !selectedRow) {
      throw new Error("Selected compact panel row was not found");
    }

    const containerRect = container.getBoundingClientRect();
    const selectedRowRect = selectedRow.getBoundingClientRect();

    return {
      scrollTop: container.scrollTop,
      selectedRowTop: selectedRowRect.top,
      selectedRowBottom: selectedRowRect.bottom,
      containerTop: containerRect.top,
      containerBottom: containerRect.bottom,
    };
  });

  expect(metrics.scrollTop).toBeGreaterThan(0);
  expect(metrics.selectedRowTop).toBeGreaterThanOrEqual(metrics.containerTop);
  expect(metrics.selectedRowBottom).toBeLessThanOrEqual(metrics.containerBottom);
});

test("desktop hide previews button collapses the compact reader rail", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;

    void store?.getState().updatePreferences({
      display: {
        reading: {
          dualColumnMode: true,
        },
      },
    });
  });

  await page.getByText("Article 0:", { exact: false }).click();
  await expect(page.getByTestId("compact-feed-panel-scroll-container")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel("Hide Previews")).toBeVisible({ timeout: 5_000 });

  const railWidthBeforeCollapse = await page.getByTestId("compact-feed-panel-rail").evaluate((rail) =>
    rail.getBoundingClientRect().width,
  );
  expect(railWidthBeforeCollapse).toBeGreaterThan(100);

  await page.getByLabel("Hide Previews").click();

  await expect(page.getByLabel("Show Previews")).toBeVisible({ timeout: 1_000 });
  await expect.poll(async () =>
    page.evaluate((initialWidth) => {
      const rail = document.querySelector('[data-testid="compact-feed-panel-rail"]') as HTMLElement | null;
      if (!rail) return 0;
      const width = rail.getBoundingClientRect().width;
      return width < initialWidth ? width : initialWidth;
    }, railWidthBeforeCollapse),
  ).toBeLessThan(railWidthBeforeCollapse);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as
        | {
            getState: () => {
              preferences: {
                display: {
                  reading: {
                    dualColumnMode: boolean;
                  };
                };
              };
            };
          }
        | undefined;
      return store?.getState().preferences.display.reading.dualColumnMode ?? true;
    });
  }).toBe(false);

  await expect.poll(async () =>
    page.evaluate(() => {
      const rail = document.querySelector('[data-testid="compact-feed-panel-rail"]') as HTMLElement | null;
      return rail?.getBoundingClientRect().width ?? 0;
    }),
  ).toBeLessThanOrEqual(1);
});

test("desktop hide previews skips the compact reader rail transition when animations are none", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;

    await store?.getState().updatePreferences({
      display: {
        animationIntensity: "none",
        reading: {
          dualColumnMode: true,
        },
      },
    });
  });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.animation),
  ).toBe("none");

  await page.getByText("Article 0:", { exact: false }).click();
  const rail = page.getByTestId("compact-feed-panel-rail");
  await expect(rail).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () =>
    rail.evaluate((element) => (element as HTMLElement).style.transition),
  ).toBe("none");

  await page.getByLabel("Hide Previews").click();

  await expect(page.getByLabel("Show Previews")).toBeVisible({ timeout: 1_000 });
  await expect(rail).toHaveCount(0);
});

test("narrow reader toolbar moves hidden actions into the overflow menu", async ({ app, page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(4);

  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;

    void store?.getState().updatePreferences({
      display: {
        reading: {
          dualColumnMode: true,
        },
      },
    });
  });

  await page.getByText("Article 0:", { exact: false }).click();
  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.classList.contains("feed-layout-transition"));
  }).toBe(false);
  await expect(page.getByRole("button", { name: "Hide Previews" })).toBeVisible({ timeout: 5_000 });
  const overflowButton = page.getByTestId("toolbar-overflow-button");
  await expect(overflowButton).toBeVisible({ timeout: 5_000 });
  const spacing = await page.evaluate(() => {
    const previewButton = document.querySelector('[aria-label="Hide Previews"]') as HTMLElement | null;
    const previewIcon = previewButton?.querySelector("svg") as SVGElement | null;
    const backButton = document.querySelector('[data-testid="workspace-toolbar-reader-back"]') as HTMLElement | null;
    const overflowButton = document.querySelector('[data-testid="toolbar-overflow-button"]') as HTMLElement | null;
    if (!previewIcon || !backButton || !overflowButton) {
      throw new Error("Narrow reader toolbar spacing elements were not found");
    }

    const previewIconRect = previewIcon.getBoundingClientRect();
    const backButtonRect = backButton.getBoundingClientRect();
    const overflowButtonRect = overflowButton.getBoundingClientRect();

    return {
      leftGap: backButtonRect.left - previewIconRect.right,
      rightGap: overflowButtonRect.left - backButtonRect.right,
    };
  });
  expect(Math.abs(spacing.leftGap - spacing.rightGap)).toBeLessThanOrEqual(4);

  await overflowButton.click();
  const overflowMenu = page.getByTestId("toolbar-overflow-menu");
  await expect(overflowMenu.getByRole("menuitem", { name: "Enable focus mode" })).toBeVisible();
  await expect(overflowMenu.getByRole("menuitem", { name: "Bookmark" })).toBeVisible();
  await expect(overflowMenu.getByRole("menuitem", { name: "Archive" })).toBeVisible();
});

test("narrow feed toolbar moves bulk actions into the overflow menu", async ({ app, page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(4);

  const toolbar = page.getByTestId("workspace-toolbar");
  await expect(toolbar.locator("button").filter({ hasText: / unread$/ }).first()).toBeHidden();
  await expect(page.getByTestId("social-content-toolbar-filter")).toBeHidden();

  const overflowButton = page.getByTestId("toolbar-overflow-button");
  await expect(overflowButton).toBeVisible({ timeout: 5_000 });
  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible({ timeout: 5_000 });
  const readCollapsedGeometry = () => page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
    const overflow = document.querySelector('[data-testid="toolbar-overflow-button"]') as HTMLElement | null;
    const filter = document.querySelector('[data-testid="mobile-toolbar-filter-button"]') as HTMLElement | null;
    if (!toolbar || !overflow || !filter) {
      throw new Error("Collapsed toolbar controls were not found");
    }

    const overflowRect = overflow.getBoundingClientRect();
    const filterRect = filter.getBoundingClientRect();

    return {
      overflowHeight: Math.round(overflowRect.height),
      filterHeight: Math.round(filterRect.height),
      gap: Math.round(filterRect.left - overflowRect.right),
      viewportReady: Math.round(window.innerWidth - filterRect.right) >= Math.round(filterRect.left - overflowRect.right),
    };
  });
  await expect.poll(readCollapsedGeometry, { timeout: 3_000 }).toEqual({
    overflowHeight: 36,
    filterHeight: 36,
    gap: 8,
    viewportReady: true,
  });
  await overflowButton.click();

  const overflowMenu = page.getByTestId("toolbar-overflow-menu");
  const markReadAction = overflowMenu.getByRole("menuitem", { name: /Mark .* unread as read/ });
  await expect(markReadAction).toBeVisible();
  await markReadAction.click();
  await expect(overflowMenu).toBeHidden();

  await overflowButton.click();
  await expect(overflowMenu.getByRole("menuitem", { name: /Archive .* read items/ })).toBeVisible();
});

test("narrow feed filter menu labels collapsed sections", async ({ app, page }) => {
  await page.setViewportSize({ width: 1024, height: 500 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(4);

  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible({ timeout: 5_000 });
  await filterButton.click();

  const filterMenu = page.getByTestId("feed-signal-filter-menu");
  await expect(filterMenu.getByText("Card density", { exact: true })).toBeVisible();
  await expect(filterMenu.getByText("Format", { exact: true })).toBeVisible();
  await expect(filterMenu.getByText("Connections", { exact: true })).toBeVisible();
  await expect(filterMenu.getByText("Classification", { exact: true })).toBeVisible();
  await expect(filterMenu.getByText("View", { exact: true })).toHaveCount(0);
  const headingLefts = await filterMenu.evaluate((menu) => {
    const headings = ["Card density", "Format", "Connections", "Classification"];
    return headings.map((heading) => {
      const element = Array.from(menu.querySelectorAll("p")).find((candidate) =>
        candidate.textContent?.trim() === heading
      );
      if (!element) throw new Error(`Missing ${heading} heading`);
      return Math.round(element.getBoundingClientRect().left);
    });
  });
  expect(Math.max(...headingLefts) - Math.min(...headingLefts)).toBeLessThanOrEqual(1);
  await expect(filterMenu.getByText("All visible items.", { exact: true })).toBeVisible();
  await expect(filterMenu.getByText("Essays, guides, and references.", { exact: true })).toBeVisible();

  const inspiringOption = filterMenu.getByRole("menuitemcheckbox", { name: /Inspiring/ });
  const inspiringCircle = inspiringOption.locator(".feed-signal-checkbox");
  const checkedCircleWidth = await inspiringCircle.evaluate((element) =>
    Math.round(element.getBoundingClientRect().width),
  );
  await inspiringOption.click();
  await expect(inspiringOption).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (
    inspiringCircle.evaluate((element) => Math.round(element.getBoundingClientRect().width))
  )).toBeLessThan(checkedCircleWidth);

  const scrollMetrics = await filterMenu.evaluate((menu) => {
    menu.scrollTop = menu.scrollHeight;
    const menuRect = menu.getBoundingClientRect();
    const newsItem = Array.from(menu.querySelectorAll('[role="menuitemcheckbox"]'))
      .find((item) => item.textContent?.includes("News")) as HTMLElement | undefined;
    const newsRect = newsItem?.getBoundingClientRect();
    const style = window.getComputedStyle(menu);
    return {
      clientHeight: menu.clientHeight,
      menuBottom: Math.round(menuRect.bottom),
      newsBottom: newsRect ? Math.round(newsRect.bottom) : null,
      overflowY: style.overflowY,
      scrollHeight: menu.scrollHeight,
      scrollTop: menu.scrollTop,
      viewportHeight: window.innerHeight,
    };
  });
  expect(scrollMetrics.overflowY).toBe("auto");
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  expect(scrollMetrics.scrollTop).toBeGreaterThan(0);
  expect(scrollMetrics.menuBottom).toBeLessThanOrEqual(scrollMetrics.viewportHeight);
  expect(scrollMetrics.newsBottom).not.toBeNull();
  expect(scrollMetrics.newsBottom ?? 0).toBeLessThanOrEqual(scrollMetrics.viewportHeight);
});

test("feed toolbar bulk action counts follow the active filter", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        reading: {
          markReadOnScroll: false,
        },
      },
    });
  });

  const activeFeedUrl = "https://bench.example/active-filter-feed.xml";
  const otherFeedUrl = "https://bench.example/other-filter-feed.xml";
  await app.injectRssItems(2, activeFeedUrl);
  await app.injectRssItems(6, otherFeedUrl);

  await page.evaluate(async ({ activeFeedUrl, otherFeedUrl }) => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            setFilter: (filter: { feedUrl: string }) => void;
            markItemsAsRead: (ids: string[]) => Promise<void>;
          };
        }
      | undefined;
    const state = store?.getState();
    await state?.markItemsAsRead([
      `rss:${activeFeedUrl}:bench-item-0`,
      `rss:${otherFeedUrl}:bench-item-0`,
      `rss:${otherFeedUrl}:bench-item-1`,
      `rss:${otherFeedUrl}:bench-item-2`,
      `rss:${otherFeedUrl}:bench-item-3`,
    ]);
    state?.setFilter({ feedUrl: activeFeedUrl });
  }, { activeFeedUrl, otherFeedUrl });

  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("2 items");
  await expect(page.getByTestId("workspace-toolbar").locator("button").filter({ hasText: / unread$/ })).toHaveCount(0);
  await expect(page.getByTestId("workspace-toolbar").locator("button").filter({ hasText: / read$/ })).toHaveCount(0);

  const overflowButton = page.getByTestId("toolbar-overflow-button");
  await expect(overflowButton).toBeVisible({ timeout: 5_000 });
  await overflowButton.click();

  const overflowMenu = page.getByTestId("toolbar-overflow-menu");
  await expect(overflowMenu.getByRole("menuitem", { name: "Mark 1 unread as read" })).toBeVisible();
  await expect(overflowMenu.getByRole("menuitem", { name: "Archive 1 read items" })).toBeVisible();
});

test("feed toolbar archives visible read Instagram posts in one batch", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const now = Date.now();
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        setActiveView: (view: "feed" | "friends" | "map") => void;
        setFilter: (filter: { platform: string; socialContentFilter: "posts" }) => void;
      };
    };
    const makeItem = (
      globalId: string,
      contentType: "post" | "story",
      userState: Record<string, unknown>,
    ) => ({
      globalId,
      platform: "instagram",
      contentType,
      capturedAt: now,
      publishedAt: now,
      author: {
        id: "visible-archive",
        handle: "visible_archive",
        displayName: "Visible Archive",
      },
      content: {
        text: `Visible archive item ${globalId}`,
        mediaUrls: [],
        mediaTypes: [],
      },
      topics: [],
      sourceUrl: `https://www.instagram.com/p/${globalId}`,
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: [],
        ...userState,
      },
    });

    const archiveCandidates = Array.from({ length: 300 }, (_, index) =>
      makeItem(`instagram:visible-archive:${index}`, "post", { readAt: now - index })
    );
    const storyItems = Array.from({ length: 5 }, (_, index) =>
      makeItem(`instagram:visible-story:${index}`, "story", { readAt: now - index })
    );
    const unreadPosts = Array.from({ length: 4 }, (_, index) =>
      makeItem(`instagram:visible-unread:${index}`, "post", {})
    );
    const savedPosts = Array.from({ length: 3 }, (_, index) =>
      makeItem(`instagram:visible-saved:${index}`, "post", { saved: true, readAt: now - index })
    );

    await automerge.docBatchImportItems([
      ...archiveCandidates,
      ...storyItems,
      ...unreadPosts,
      ...savedPosts,
    ]);
    store.getState().setActiveView("feed");
    store.getState().setFilter({ platform: "instagram", socialContentFilter: "posts" });
  });

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        archiveItems: (ids: string[]) => Promise<void>;
      };
      setState: (patch: { archiveItems: (ids: string[]) => Promise<void> }) => void;
    };
    const originalArchiveItems = store.getState().archiveItems;
    w.__FREED_ARCHIVE_ITEM_CALLS__ = [];
    store.setState({
      archiveItems: async (ids: string[]) => {
        (w.__FREED_ARCHIVE_ITEM_CALLS__ as string[][]).push(ids);
        await originalArchiveItems(ids);
      },
    });
  });

  const overflowButton = page.getByTestId("toolbar-overflow-button");
  await expect(overflowButton).toBeVisible({ timeout: 5_000 });
  await overflowButton.click();

  const archiveAction = page
    .getByTestId("toolbar-overflow-menu")
    .getByRole("menuitem", { name: "Archive 300 read items" });
  await expect(archiveAction).toBeVisible({ timeout: 10_000 });
  await archiveAction.click();

  await expect.poll(async () =>
    page.evaluate(() => {
      const calls = (window as Record<string, unknown>).__FREED_ARCHIVE_ITEM_CALLS__ as string[][] | undefined;
      return calls?.length ?? 0;
    }),
  ).toBe(1);
  const archiveCallSize = await page.evaluate(() => {
    const calls = (window as Record<string, unknown>).__FREED_ARCHIVE_ITEM_CALLS__ as string[][];
    return calls[0]?.length ?? 0;
  });
  expect(archiveCallSize).toBe(300);

  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { items: Array<{ globalId: string; userState: { archived?: boolean } }> } }
      | undefined;
    const items = store?.getState().items ?? [];
    const archivedCandidates = items.filter((item) =>
      item.globalId.startsWith("instagram:visible-archive:")
    );
    const storyItems = items.filter((item) =>
      item.globalId.startsWith("instagram:visible-story:")
    );
    const unreadPosts = items.filter((item) =>
      item.globalId.startsWith("instagram:visible-unread:")
    );
    const savedPosts = items.filter((item) =>
      item.globalId.startsWith("instagram:visible-saved:")
    );
    return (
      archivedCandidates.length === 300 &&
      archivedCandidates.every((item) => item.userState.archived === true) &&
      storyItems.every((item) => item.userState.archived !== true) &&
      unreadPosts.every((item) => item.userState.archived !== true) &&
      savedPosts.every((item) => item.userState.archived !== true)
    );
  }, { timeout: 30_000 });
});

test("feed toolbar title describes active content filters", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const now = Date.now();
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docBatchImportItems: (items: unknown[]) => Promise<unknown>;
    };
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            setFilter: (filter: unknown) => void;
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;

    await automerge.docBatchImportItems([
      {
        globalId: "context-title-facebook-story",
        platform: "facebook",
        contentType: "story",
        capturedAt: now - 10_000,
        publishedAt: now - 10_000,
        author: { id: "fb:context-title", handle: "context.title", displayName: "Context Title" },
        content: { text: "Facebook story title fixture", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: { version: 3, method: "manual", inferredAt: now, scores: { life_update: 1 }, tags: ["life_update"] },
      },
      {
        globalId: "context-title-conversation",
        platform: "facebook",
        contentType: "post",
        capturedAt: now - 20_000,
        publishedAt: now - 20_000,
        author: { id: "fb:context-title", handle: "context.title", displayName: "Context Title" },
        content: { text: "Conversation post title fixture", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: { version: 3, method: "manual", inferredAt: now, scores: { request: 1 }, tags: ["request"] },
      },
      {
        globalId: "context-title-news",
        platform: "linkedin",
        contentType: "post",
        capturedAt: now - 30_000,
        publishedAt: now - 30_000,
        author: { id: "li:context-title", handle: "context.title", displayName: "Context Title" },
        content: { text: "News post title fixture", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: { version: 3, method: "manual", inferredAt: now, scores: { news: 1 }, tags: ["news"] },
      },
    ]);

    await store?.getState().updatePreferences({
      display: {
        feedSignalModes: ["conversation", "news"],
      },
    });
    store?.getState().setFilter({ signals: ["request", "discussion", "news", "alert", "product_update"] });
  });

  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("Conversations and News");
  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("2 items");

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            setFilter: (filter: unknown) => void;
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        feedSignalModes: ["conversation", "news", "personal"],
      },
    });
    store?.getState().setFilter({
      signals: ["request", "discussion", "news", "alert", "product_update", "life_update", "moment"],
    });
  });
  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("Filtered");

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            setFilter: (filter: unknown) => void;
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        feedSignalModes: [],
      },
    });
    store?.getState().setFilter({ platform: "facebook", socialContentFilter: "stories" });
  });
  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("Facebook Stories");
  await expect(page.getByTestId("workspace-toolbar-title-block")).toContainText("1 item");
});

test("mobile feed toolbar keeps format as the rightmost control", async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(4);

  const overflowButton = page.getByTestId("toolbar-overflow-button");
  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(overflowButton).toBeVisible({ timeout: 5_000 });
  await expect(filterButton).toBeVisible({ timeout: 5_000 });

  const geometry = await page.evaluate(() => {
    const overflow = document.querySelector('[data-testid="toolbar-overflow-button"]') as HTMLElement | null;
    const filter = document.querySelector('[data-testid="mobile-toolbar-filter-button"]') as HTMLElement | null;
    const overflowRect = overflow?.getBoundingClientRect() ?? null;
    const filterRect = filter?.getBoundingClientRect() ?? null;
    if (!overflowRect || !filterRect) {
      throw new Error("Toolbar overflow or filter button is not visible");
    }

    return {
      gap: filterRect.left - overflowRect.right,
      overflowRight: overflowRect.right,
      filterLeft: filterRect.left,
      filterRight: filterRect.right,
      viewportRight: window.innerWidth,
    };
  });
  expect(geometry.overflowRight).toBeLessThanOrEqual(geometry.filterLeft);
  expect(geometry.gap).toBeGreaterThanOrEqual(0);
  expect(geometry.viewportRight - geometry.filterRight).toBeLessThanOrEqual(16);

  await overflowButton.click();
  const overflowMenu = page.getByTestId("toolbar-overflow-menu");
  await expect(overflowMenu.getByRole("menuitem", { name: /Mark .* unread as read/ })).toBeVisible();
  const menuTop = await overflowMenu.evaluate((menu) => Math.round(menu.getBoundingClientRect().top));
  await page.evaluate(() => window.scrollBy(0, 180));
  await expect
    .poll(() => overflowMenu.evaluate((menu) => Math.round(menu.getBoundingClientRect().top)))
    .toBe(menuTop);
});

test("dual-column reader toggles use shared view transitions when supported", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(6);

  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (update: unknown) => Promise<void>;
          };
        }
      | undefined;

    void store?.getState().updatePreferences({
      display: {
        reading: {
          dualColumnMode: true,
        },
      },
    });
  });

  await page.evaluate(() => {
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    const state = { count: 0 };
    (window as Record<string, unknown>).__FREED_VIEW_TRANSITIONS__ = state;

    Object.defineProperty(doc, "startViewTransition", {
      configurable: true,
      writable: true,
      value: (update: () => void) => {
        state.count += 1;
        update();
        return { finished: Promise.resolve() };
      },
    });
  });

  const firstCard = page.locator('[data-feed-item-id$="bench-item-0"]').first();
  await expect(firstCard).toBeVisible({ timeout: 5_000 });

  const transitionName = await firstCard.evaluate((element) =>
    window.getComputedStyle(element.parentElement as Element).viewTransitionName,
  );
  expect(transitionName).not.toBe("none");

  await firstCard.click();
  await expect(page.getByTestId("compact-feed-panel-scroll-container")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel("Back to list")).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => {
    return page.evaluate(() => {
      const state = (window as Record<string, unknown>).__FREED_VIEW_TRANSITIONS__ as
        | { count: number }
        | undefined;
      return state?.count ?? 0;
    });
  }).toBe(1);

  await page.getByLabel("Back to list").click();
  await expect(firstCard).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => {
    return page.evaluate(() => {
      const state = (window as Record<string, unknown>).__FREED_VIEW_TRANSITIONS__ as
        | { count: number }
        | undefined;
      return state?.count ?? 0;
    });
  }).toBe(2);
});

test("Friends workspace keeps a visible sidebar and supports back navigation", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPerson: (person: unknown) => Promise<void>;
      docAddAccount: (account: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as
      | {
        getState: () => {
          setActiveView: (view: string) => void;
          setSelectedPerson: (personId: string | null) => void;
          setSelectedAccount: (accountId: string | null) => void;
          updatePreferences: (update: unknown) => Promise<void>;
        };
      }
      | undefined;

    const now = Date.now();
    await automerge.docAddPerson({
      id: "friend-ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      careLevel: 5,
      reachOutLog: [{ loggedAt: now - 40 * 24 * 60 * 60_000, channel: "text" }],
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddAccount({
      id: "friend-ada:instagram:ada-ig",
      personId: "friend-ada",
      kind: "social",
      provider: "instagram",
      externalId: "ada-ig",
      handle: "ada",
      displayName: "Ada Lovelace",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddFeedItems([
      {
        globalId: "ig:ada:paris",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 60_000,
        author: { id: "ada-ig", handle: "ada", displayName: "Ada Lovelace" },
        content: { text: "Bonjour from Paris", mediaUrls: [], mediaTypes: [] },
        location: {
          name: "Paris",
          coordinates: { lat: 48.8566, lng: 2.3522 },
          source: "geo_tag",
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
    ]);
    await store?.getState().updatePreferences({
      display: {
        friendsSidebarWidth: 388,
        friendsSidebarOpen: true,
      },
    });
    store?.getState().setSelectedPerson(null);
    store?.getState().setSelectedAccount(null);
    store?.getState().setActiveView("friends");
  });

  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByPlaceholder("Search friends")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { setSelectedPerson: (personId: string | null) => void } }
      | undefined;
    store?.getState().setSelectedPerson("friend-ada");
  });
  await expect(page.getByRole("button", { name: "Back to all friends" })).toBeVisible({ timeout: 5_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Back to all friends"]');
    if (!button || button.getClientRects().length === 0) return false;
    button.click();
    return true;
  }, undefined, { timeout: 5_000 });
  await expect(page.getByPlaceholder("Search friends")).toBeVisible({ timeout: 10_000 });
});

test("Map view popup exposes friend actions and supports post navigation", async ({ app }) => {
  test.setTimeout(60_000);
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(app.page);

  const { page } = app;

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { setActiveView: (view: "map") => void } }
      | undefined;
    store?.getState().setActiveView("map");
  });
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });

  await openVisibleMapMarker(page, "Ada Lovelace", "Open Friend");
  await clickMapPopupAction(page, "Open Friend");
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string; selectedPersonId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.activeView === "friends" && state.selectedPersonId === "friend-ada";
  }, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Back to all friends" })).toBeVisible({
    timeout: 10_000,
  });

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { setActiveView: (view: "map") => void } }
      | undefined;
    store?.getState().setActiveView("map");
  });
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });
  await openVisibleMapMarker(page, "Ada Lovelace", "Open Post");
  await clickMapPopupAction(page, "Open Post");
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string; selectedItemId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.activeView === "feed" && state.selectedItemId === "ig:ada:paris";
  }, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Bonjour from Paris" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByLabel("Back to list")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Bonjour from Paris" })).toBeVisible({
    timeout: 20_000,
  });
});

test("Friend detail last seen card opens the full Map view", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(app.page);

  const { page } = app;

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsSidebarWidth: number } }) => Promise<void>;
            setActiveView: (view: "friends") => void;
            setSelectedPerson: (personId: string | null) => void;
          };
        }
      | undefined;
    const state = store?.getState();
    if (!state) {
      return;
    }

    return state.updatePreferences({
      display: {
        friendsSidebarWidth: 388,
      },
    }).then(() => {
      state.setActiveView("friends");
      state.setSelectedPerson("friend-ada");
    });
  });

  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Last seen")).toBeVisible({ timeout: 5_000 });
  const lastSeenCard = page.getByRole("button", { name: /last seen paris/i });
  await expect(lastSeenCard).toBeVisible({ timeout: 5_000 });
  await lastSeenCard.evaluate((element) => {
    (element as HTMLElement).click();
  });

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string; selectedPersonId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.activeView === "map" && state.selectedPersonId === "friend-ada";
  }, { timeout: 10_000 });
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });
});

test("map defaults to All content when only unlinked author locations exist", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedAllContentLocationsWithoutFriends();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.locator('.freed-map-marker[aria-label="Nora Quinn"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('.freed-map-marker[aria-label="Ghost Noise"]')).toHaveCount(0);
});

test("explicit Friends map mode hides unlinked author locations", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedAllContentLocationsWithoutFriends();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.locator('.freed-map-marker[aria-label="Nora Quinn"]')).toBeVisible({
    timeout: 10_000,
  });

  const friendsButton = page
    .getByTestId("map-toolbar-scope")
    .getByRole("button", { name: "Friends", exact: true });
  await friendsButton.click();
  await expect(friendsButton).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await expect(page.locator('.freed-map-marker[aria-label="Nora Quinn"]')).toHaveCount(0);
  await expect(page.getByText("0 friends on the map")).toBeVisible({ timeout: 10_000 });
});

test("unlinked map markers route into the friends account workflow and can link to an existing friend", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await app.seedAllContentLocationsWithoutFriends();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await page
    .getByTestId("map-toolbar-scope")
    .getByRole("button", { name: "All content", exact: true })
    .click();
  await openVisibleMapMarker(page, "Nora Quinn", "Link to existing friend");
  await clickMapPopupAction(page, "Link to existing friend");

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string; selectedAccountId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.activeView === "friends" && state.selectedAccountId === "social:instagram:nora-ig";
  }, { timeout: 10_000 });

  await expect(page.getByRole("button", { name: "Promote to friend", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("Link to existing friend")).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => {
    const adaRow = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((element) => {
      const label = element.textContent ?? "";
      return /Ada Lovelace/i.test(label) && element.getClientRects().length > 0;
    });
    if (!adaRow) return false;
    adaRow.click();
    return true;
  }, { timeout: 5_000 });

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            activeView: string;
            selectedPersonId: string | null;
            accounts: Record<string, { personId?: string }>;
          };
        }
      | undefined;
    const state = store?.getState();
    return (
      state?.activeView === "friends" &&
      state.selectedPersonId === "friend-ada" &&
      state.accounts["social:instagram:nora-ig"]?.personId === "friend-ada"
    );
  }, { timeout: 10_000 });

  await expect(page.getByRole("button", { name: "Back to all friends" })).toBeVisible({
    timeout: 10_000,
  });
});

test("recoverable story locations appear in All content mode and the mode persists", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await app.seedAllContentLocationsWithoutFriends();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  const allContentButton = page.getByRole("button", { name: "All content", exact: true });
  await allContentButton.click();
  await expect(allContentButton).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await persistDisplayPreference(page, "mapMode", "all_content");

  await openVisibleMapMarker(page, "Nora Quinn");
  await expect(page.getByText("Big Bear California")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await app.waitForReady();
  await dismissCloudSyncNudgeIfPresent(page);
  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByRole("button", { name: "All content", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 10_000 },
  );
  await expect(page.locator('.freed-map-marker[aria-label="Nora Quinn"]')).toBeVisible({
    timeout: 10_000,
  });
});

test("map time range defaults to all available location windows", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  const seededNow = await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        items: Array<{ globalId: string }>;
      };
    };

    const now = Date.now();
    await automerge.docAddFeedItems([
      {
        globalId: "ig:grace:rome-memory",
        platform: "instagram",
        contentType: "post",
        capturedAt: now - 14 * 24 * 60 * 60_000,
        publishedAt: now - 14 * 24 * 60 * 60_000,
        author: {
          id: "grace-ig",
          handle: "grace",
          displayName: "Grace Hopper",
        },
        content: {
          text: "Still thinking about Rome.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Rome",
          coordinates: { lat: 41.9028, lng: 12.4964 },
          source: "geo_tag",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
      {
        globalId: "ig:ada:lisbon-plan",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now,
        author: {
          id: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
        content: {
          text: "Landing in Lisbon later this week.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Lisbon",
          coordinates: { lat: 38.7223, lng: -9.1393 },
          source: "geo_tag",
        },
        timeRange: {
          startsAt: now + 2 * 24 * 60 * 60_000,
          endsAt: now + 5 * 24 * 60 * 60_000,
          kind: "travel",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const hasFutureItem = store
          .getState()
          .items.some((item) => item.globalId === "ig:ada:lisbon-plan");
        if (hasFutureItem) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("seed timeout"));
        }
      }, 50);
    });

    return now;
  });

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-time-range-slider")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("map-time-preset-all")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("map-time-preset-today")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("map-time-preset-today-future")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("map-time-preset-last-week")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("map-time-range-slider").locator("button")).toHaveText([
    "last week",
    "today",
    "today + future",
    "all time",
  ]);
  await expect(page.getByRole("button", { name: "Current", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Future", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Past", exact: true })).toHaveCount(0);

  await openVisibleMapMarker(page, "Ada Lovelace");
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("map-time-preset-today").click();
  await expect(page.getByTestId("map-time-preset-today")).toHaveAttribute("aria-pressed", "true");
  const todayStartAt = Number(await page.getByTestId("map-time-range-start").inputValue());
  const todayEndAt = Number(await page.getByTestId("map-time-range-end").inputValue());
  const maxRangeAt = Number(await page.getByTestId("map-time-range-end").getAttribute("max"));
  expect(todayStartAt).toBe(addLocalDays(seededNow, -1));
  expect(todayEndAt).toBe(endOfLocalDay(seededNow));
  expect(todayEndAt).toBeLessThan(maxRangeAt);
  await expect(page.getByTestId("map-time-range-start-label")).toHaveText(formatMapRangeDate(addLocalDays(seededNow, -1)));
  await expect(page.getByTestId("map-time-range-end-label")).toHaveText(formatMapRangeDate(seededNow));
  const startLabelBox = await page.getByTestId("map-time-range-start-label").boundingBox();
  const endLabelBox = await page.getByTestId("map-time-range-end-label").boundingBox();
  expect(startLabelBox).not.toBeNull();
  expect(endLabelBox).not.toBeNull();
  expect(boxesOverlap(startLabelBox!, endLabelBox!)).toBe(false);
  expect(Math.abs(startLabelBox!.y - endLabelBox!.y)).toBeLessThan(2);
  expect(startLabelBox!.x).toBeLessThan(endLabelBox!.x);

  await page.getByTestId("map-time-preset-today-future").click();
  await expect(page.getByTestId("map-time-preset-today-future")).toHaveAttribute("aria-pressed", "true");
  expect(Number(await page.getByTestId("map-time-range-end").inputValue())).toBe(maxRangeAt);

  await page.getByTestId("map-time-preset-all").click();
  await expect(page.getByTestId("map-time-preset-all")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await app.waitForReady();
  await dismissCloudSyncNudgeIfPresent(page);
  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-time-range-slider")).toBeVisible({ timeout: 10_000 });

  const startAt = seededNow - 24 * 60 * 60_000;
  const endAt = seededNow + 24 * 60 * 60_000;
  await setMapTimeRange(page, startAt, endAt);
  const clampedStartAt = Number(await page.getByTestId("map-time-range-start").inputValue());
  const clampedEndAt = Number(await page.getByTestId("map-time-range-end").inputValue());
  expect(clampedStartAt).toBe(startOfLocalDay(startAt));
  expect(clampedEndAt).toBe(endOfLocalDay(endAt));
  await expect(page.getByTestId("map-time-range-start-label")).toHaveText(formatMapRangeDate(clampedStartAt));
  await expect(page.getByTestId("map-time-range-end-label")).toHaveText(formatMapRangeDate(clampedEndAt));
  await expect(page.getByTestId("map-time-preset-all")).toHaveAttribute("aria-pressed", "false");
  await openVisibleMapMarker(page, "Ada Lovelace");
  await expect(page.getByText("Paris", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Lisbon", { exact: true })).toHaveCount(0);
});

test("map range slider narrows future and historical markers", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  const seededNow = await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        items: Array<{ globalId: string }>;
      };
    };

    const now = Date.now();
    await automerge.docAddFeedItems([
      {
        globalId: "ig:ada:rome-history",
        platform: "instagram",
        contentType: "post",
        capturedAt: now - 10 * 24 * 60 * 60_000,
        publishedAt: now - 10 * 24 * 60 * 60_000,
        author: {
          id: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
        content: {
          text: "Throwback to Rome.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Rome",
          coordinates: { lat: 41.9028, lng: 12.4964 },
          source: "geo_tag",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
      {
        globalId: "ig:ada:berlin-history",
        platform: "instagram",
        contentType: "post",
        capturedAt: now - 3 * 24 * 60 * 60_000,
        publishedAt: now - 3 * 24 * 60 * 60_000,
        author: {
          id: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
        content: {
          text: "Berlin was a good idea.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Berlin",
          coordinates: { lat: 52.52, lng: 13.405 },
          source: "geo_tag",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
      {
        globalId: "ig:ada:lisbon-plan",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now,
        author: {
          id: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
        content: {
          text: "Landing in Lisbon soon.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Lisbon",
          coordinates: { lat: 38.7223, lng: -9.1393 },
          source: "geo_tag",
        },
        timeRange: {
          startsAt: now + 2 * 24 * 60 * 60_000,
          endsAt: now + 4 * 24 * 60 * 60_000,
          kind: "travel",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
      {
        globalId: "ig:ada:tokyo-plan",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now,
        author: {
          id: "ada-ig",
          handle: "ada",
          displayName: "Ada Lovelace",
        },
        content: {
          text: "Then straight to Tokyo.",
          mediaUrls: [],
          mediaTypes: [],
        },
        location: {
          name: "Tokyo",
          coordinates: { lat: 35.6764, lng: 139.65 },
          source: "geo_tag",
        },
        timeRange: {
          startsAt: now + 6 * 24 * 60 * 60_000,
          endsAt: now + 7 * 24 * 60 * 60_000,
          kind: "travel",
        },
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
        },
        topics: [],
      },
    ]);

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const itemIds = new Set(store.getState().items.map((item) => item.globalId));
        if (
          itemIds.has("ig:ada:rome-history")
          && itemIds.has("ig:ada:berlin-history")
          && itemIds.has("ig:ada:lisbon-plan")
          && itemIds.has("ig:ada:tokyo-plan")
        ) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("seed timeout"));
        }
      }, 50);
    });

    return now;
  });

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-time-range-slider")).toBeVisible({ timeout: 10_000 });

  await openVisibleMapMarker(page, "Ada Lovelace", "Open Post");
  await expect(page.getByText("Tokyo", { exact: true })).toBeVisible({ timeout: 10_000 });

  await setMapTimeRange(
    page,
    seededNow + 2 * 24 * 60 * 60_000,
    seededNow + 4 * 24 * 60 * 60_000,
  );
  await openVisibleMapMarker(page, "Ada Lovelace", "Open Post");
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible({ timeout: 10_000 });

  await setMapTimeRange(
    page,
    seededNow - 11 * 24 * 60 * 60_000,
    seededNow - 9 * 24 * 60 * 60_000,
  );
  await openVisibleMapMarker(page, "Ada Lovelace", "Open Post");
  await expect(page.getByText("Rome", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("Friends detail rail visibility preference hides and restores the desktop sidebar without losing width", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsMode: "friends"; friendsSidebarWidth: number; friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
            setSelectedPerson: (personId: string | null) => void;
            setSelectedAccount: (accountId: string | null) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsMode: "friends",
        friendsSidebarWidth: 388,
        friendsSidebarOpen: true,
      },
    });
    store?.getState().setActiveView("friends");
  });

  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });

  const before = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="friends-sidebar-shell"]') as HTMLElement | null;
    return {
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(before.shellWidth).toBeGreaterThanOrEqual(388);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { updatePreferences: (patch: { display: { friendsSidebarOpen: boolean } }) => Promise<void> } }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsSidebarOpen: false,
      },
    });
  });
  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("friends-sidebar-shell")).toHaveCount(0);
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { preferences: { display: { friendsSidebarOpen?: boolean } } } }
      | undefined;
    return store?.getState().preferences.display.friendsSidebarOpen === false;
  }, { timeout: 5_000 });

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { updatePreferences: (patch: { display: { friendsSidebarOpen: boolean } }) => Promise<void> } }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsSidebarOpen: true,
      },
    });
  });
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { friendsSidebarOpen?: boolean; friendsSidebarWidth?: number } };
          };
        }
      | undefined;
    const display = store?.getState().preferences.display;
    return display?.friendsSidebarOpen === true && display?.friendsSidebarWidth === 388;
  }, { timeout: 5_000 });
  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });

  const after = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="friends-sidebar-shell"]') as HTMLElement | null;
    return {
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(after.shellWidth).toBeGreaterThanOrEqual(388);
  expect(Math.abs(after.shellWidth - before.shellWidth)).toBeLessThanOrEqual(8);
});

test("Friends detail rail resize caps at 400 pixels", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsSidebarWidth: number; friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsSidebarWidth: 388,
        friendsSidebarOpen: true,
      },
    });
    store?.getState().setSelectedPerson(null);
    store?.getState().setSelectedAccount(null);
    store?.getState().setActiveView("friends");
  });

  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 10_000 });
  const handle = page.getByRole("separator", { name: "Resize friends sidebar" });
  await expect(handle).toBeVisible({ timeout: 10_000 });
  const sidebar = page.getByTestId("friends-sidebar");
  let sidebarBox: { x: number; y: number; width: number; height: number } | null = null;
  await expect
    .poll(async () => {
      sidebarBox = await sidebar.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }).catch(() => null);
      return sidebarBox !== null;
    }, { timeout: 10_000 })
    .toBe(true);
  if (!sidebarBox) {
    throw new Error("Friends sidebar did not expose browser geometry");
  }
  const startX = sidebarBox.x - 6;
  const pointerY = sidebarBox.y + Math.max(1, sidebarBox.height / 2);

  await handle.evaluate((element, gesture) => {
    const target = element as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
    };
    target.setPointerCapture = () => undefined;
    target.releasePointerCapture = () => undefined;

    const dispatch = (
      dispatchTarget: EventTarget,
      type: "pointerdown" | "pointermove" | "pointerup",
      clientX: number,
    ) => {
      dispatchTarget.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX,
        clientY: gesture.pointerY,
      }));
    };

    dispatch(target, "pointerdown", gesture.startX);
    dispatch(window, "pointermove", gesture.startX - 300);
    dispatch(window, "pointerup", gesture.startX - 300);
  }, { startX, pointerY });

  await expect.poll(async () =>
    page.getByTestId("friends-sidebar").evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    ),
  { timeout: 5_000 }).toBeGreaterThanOrEqual(396);
  const sidebarWidth = await page.getByTestId("friends-sidebar").evaluate((element) =>
    Math.round(element.getBoundingClientRect().width),
  );
  expect(sidebarWidth).toBeLessThanOrEqual(400);

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { friendsSidebarWidth?: number } };
          };
        }
      | undefined;
    return store?.getState().preferences.display.friendsSidebarWidth === 400;
  }, { timeout: 5_000 });
});

test("selected Friends graph person shows a compact detail card when the detail rail is closed", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsMode: "friends"; friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
            setSelectedPerson: (personId: string | null) => void;
            setSelectedAccount: (accountId: string | null) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsMode: "friends",
        friendsSidebarOpen: false,
      },
    });
    store?.getState().setSelectedPerson(null);
    store?.getState().setSelectedAccount(null);
    store?.getState().setActiveView("friends");
  });

  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Fit all" }).click();
  await waitForGraphPerfToSettle(page, 20_000);

  const beforeSelection = await readGraphSummary(page);
  expect(beforeSelection).not.toBeNull();
  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            setSelectedPerson: (personId: string | null) => void;
            setSelectedAccount: (accountId: string | null) => void;
          };
        }
      | undefined;
    store?.getState().setSelectedAccount(null);
    store?.getState().setSelectedPerson("friend-ada");
  });

  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  const compactCard = page.getByTestId("friends-collapsed-selection-card");
  await expect(compactCard).toBeVisible({ timeout: 5_000 });
  await expect(compactCard).toContainText("Ada Lovelace");
  const afterSelection = await readGraphSummary(page);
  expect(afterSelection).not.toBeNull();
  expect(afterSelection!.transform.x).toBeCloseTo(beforeSelection!.transform.x, 1);
  expect(afterSelection!.transform.y).toBeCloseTo(beforeSelection!.transform.y, 1);
  expect(afterSelection!.transform.scale).toBeCloseTo(beforeSelection!.transform.scale, 3);
  expect(afterSelection!.metrics.edgeRebuildCount).toBeLessThanOrEqual(beforeSelection!.metrics.edgeRebuildCount + 2);
  expect(afterSelection!.metrics.nodeRestyleCount).toBeLessThanOrEqual(beforeSelection!.metrics.nodeRestyleCount + 2);
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { preferences: { display: { friendsSidebarOpen?: boolean } } } }
      | undefined;
    return store?.getState().preferences.display.friendsSidebarOpen === false;
  }, { timeout: 5_000 });

  await compactCard.getByRole("button", { name: "Open details" }).click();
  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Back to all friends" })).toBeVisible({
    timeout: 5_000,
  });
});

test("clicking empty graph space closes the collapsed Friends detail card", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsMode: "friends"; friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
            setSelectedPerson: (personId: string | null) => void;
            setSelectedAccount: (accountId: string | null) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsMode: "friends",
        friendsSidebarOpen: false,
      },
    });
    store?.getState().setSelectedPerson(null);
    store?.getState().setSelectedAccount(null);
    store?.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Fit all" }).click();
  await waitForGraphPerfToSettle(page, 20_000);

  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            setSelectedPerson: (personId: string | null) => void;
            setSelectedAccount: (accountId: string | null) => void;
          };
        }
      | undefined;
    store?.getState().setSelectedAccount(null);
    store?.getState().setSelectedPerson("friend-ada");
  });

  const compactCard = page.getByTestId("friends-collapsed-selection-card");
  await expect(compactCard).toBeVisible({ timeout: 10_000 });

  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) {
    throw new Error("Friends graph viewport is not visible");
  }

  await page.mouse.click(viewportBox.x + 24, viewportBox.y + 24);

  await expect(compactCard).toHaveCount(0);
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedPersonId: string | null; selectedAccountId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.selectedPersonId === null && state?.selectedAccountId === null;
  }, { timeout: 5_000 });
});

test("mobile Friends toolbar switches between graph lenses and Details mode", async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsMode: "friends" | "all_content"; friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        friendsSidebarOpen: true,
      },
    });
    store?.getState().setActiveView("friends");
  });

  const filterButton = page.getByTestId("mobile-toolbar-filter-button");
  await expect(filterButton).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("friends-toolbar-lens")).toBeHidden();
  await expect(page.getByTestId("friend-graph-viewport")).toBeVisible({ timeout: 5_000 });
  await waitForGraphNodeScreenPoint(page, { personId: "friend-ada" });
  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { setSelectedPerson: (personId: string | null) => void } }
      | undefined;
    store?.getState().setSelectedPerson("friend-ada");
  });
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedPersonId: string | null; selectedAccountId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.selectedPersonId === "friend-ada" && state.selectedAccountId === null;
  }, { timeout: 5_000 });
  await filterButton.click();

  const lens = page.getByTestId("mobile-friends-toolbar-lens");
  await expect(lens.getByRole("button", { name: "Friends" })).toBeVisible({ timeout: 5_000 });
  await expect(lens.getByRole("button", { name: "All content" })).toBeVisible({ timeout: 5_000 });
  await expect(lens.getByRole("button", { name: "Details" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);

  await lens.getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("friend-graph-viewport")).toHaveCount(0);
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { preferences: { display: { friendsMode?: "friends" | "all_content" } } } }
      | undefined;
    return store?.getState().preferences.display.friendsMode === "all_content";
  }, { timeout: 5_000 });

  await lens.getByRole("button", { name: "Friends" }).click();
  await expect(page.getByTestId("friend-graph-viewport")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { preferences: { display: { friendsMode?: "friends" | "all_content" } } } }
      | undefined;
    return store?.getState().preferences.display.friendsMode === "friends";
  }, { timeout: 5_000 });

  await lens.getByRole("button", { name: "All content" }).click();
  await expect(page.getByTestId("friend-graph-viewport")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { preferences: { display: { friendsMode?: "friends" | "all_content" } } } }
      | undefined;
    return store?.getState().preferences.display.friendsMode === "all_content";
  }, { timeout: 5_000 });
});

test("Friends graph renders confirmed friends, provisional people, and channels together", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccounts: (accounts: unknown[]) => Promise<void>;
      docAddRssFeed: (feed: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content"; themeId: string } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPersons([
      {
        id: "friend-ada",
        name: "Ada Lovelace",
        relationshipStatus: "friend",
        careLevel: 5,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "friend-grace",
        name: "Grace Hopper",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "connection-maya",
        name: "Maya Angelou",
        relationshipStatus: "connection",
        careLevel: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await automerge.docAddAccounts([
      {
        id: "social:instagram:ada-ig",
        personId: "friend-ada",
        kind: "social",
        provider: "instagram",
        externalId: "ada-ig",
        handle: "ada",
        displayName: "Ada Lovelace",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "social:linkedin:grace-li",
        personId: "friend-grace",
        kind: "social",
        provider: "linkedin",
        externalId: "grace-li",
        handle: "grace",
        displayName: "Grace Hopper",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "social:x:maya-x",
        personId: "connection-maya",
        kind: "social",
        provider: "x",
        externalId: "maya-x",
        handle: "maya",
        displayName: "Maya Angelou",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "social:x:systems-paper",
        kind: "social",
        provider: "x",
        externalId: "systems-paper",
        handle: "systems-paper",
        displayName: "Systems Journal Network",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await automerge.docAddRssFeed({
      url: "https://example.com/feed.xml",
      title: "Example Feed",
      enabled: true,
      trackUnread: true,
    });
    await automerge.docAddFeedItems([
      {
        globalId: "rss:example-feed:item-1",
        platform: "rss",
        contentType: "article",
        capturedAt: now,
        publishedAt: now - 60_000,
        author: { id: "feed-author", handle: "feed-author", displayName: "Feed Author" },
        content: { text: "Example article", mediaUrls: [], mediaTypes: [] },
        rssSource: {
          feedUrl: "https://example.com/feed.xml",
          feedTitle: "Example Feed",
        },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
      },
    ]);

    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        themeId: "scriptorium",
      },
    });
    store.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => {
    return viewport.evaluate((element) => ({
      nodes: Number((element as HTMLElement).dataset.graphNodeCount ?? "0"),
      people: Number((element as HTMLElement).dataset.graphPersonCount ?? "0"),
      channels: Number((element as HTMLElement).dataset.graphChannelCount ?? "0"),
      links: Number((element as HTMLElement).dataset.graphLinkCount ?? "0"),
      resident: Number((element as HTMLElement).dataset.graphResidentNodeCount ?? "0"),
    }));
  }).toEqual({
    nodes: 8,
    people: 3,
    channels: 5,
    links: 3,
    resident: 10,
  });
});

test("AI ranked friend suggestions surface and promote connection people", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPerson: (person: unknown) => Promise<void>;
      docAddAccount: (account: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "friends" } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPerson({
      id: "connection-maya-suggestion",
      name: "Maya Chen",
      relationshipStatus: "connection",
      careLevel: 2,
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddAccount({
      id: "social:instagram:maya-suggestion",
      personId: "connection-maya-suggestion",
      kind: "social",
      provider: "instagram",
      externalId: "maya-suggestion",
      handle: "maya",
      displayName: "Maya Chen",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddFeedItems([
      {
        globalId: "instagram:maya-suggestion:1",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 60_000,
        author: { id: "maya-suggestion", handle: "maya", displayName: "Maya Chen" },
        content: { text: "Garden visit", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: {
          version: 3,
          method: "rules",
          inferredAt: now,
          scores: { life_update: 1, moment: 1 },
          tags: ["life_update", "moment"],
        },
      },
      {
        globalId: "instagram:maya-suggestion:2",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 120_000,
        author: { id: "maya-suggestion", handle: "maya", displayName: "Maya Chen" },
        content: { text: "Moving update", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: {
          version: 3,
          method: "rules",
          inferredAt: now,
          scores: { life_update: 1, place: 1 },
          tags: ["life_update", "place"],
        },
      },
      {
        globalId: "instagram:maya-suggestion:3",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 180_000,
        author: { id: "maya-suggestion", handle: "maya", displayName: "Maya Chen" },
        content: { text: "Asked for help", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: {
          version: 3,
          method: "rules",
          inferredAt: now,
          scores: { request: 1, discussion: 1 },
          tags: ["request", "discussion"],
        },
      },
    ]);

    await store.getState().updatePreferences({ display: { friendsMode: "friends" } });
    store.getState().setActiveView("friends");
  });

  const suggestions = page.getByTestId("friend-candidate-suggestions");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await suggestions.getByText("Maya Chen").click();

  const detail = page.getByTestId("friend-candidate-detail");
  await expect(detail).toContainText("Personal updates");
  await expect(detail).toContainText("Evidence ...");
  await expect(detail.getByRole("button", { name: "Dismiss" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Promote to friend" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Promote to Fam" })).toBeVisible();
  await detail.getByRole("button", { name: "Promote to friend" }).click();

  await expect.poll(async () =>
    page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => { persons: Record<string, { relationshipStatus: string; careLevel: number }> };
      };
      return store.getState().persons["connection-maya-suggestion"];
    }),
  ).toMatchObject({
    relationshipStatus: "friend",
    careLevel: 3,
  });
});

test("account detail promote upgrades a linked connection instead of opening a duplicate draft", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccount: (account: unknown) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content" } }) => Promise<void>;
        setActiveView: (view: string) => void;
        setSelectedAccount: (accountId: string | null) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPersons([
      {
        id: "connection-linked-account",
        name: "Linked Maya",
        relationshipStatus: "connection",
        careLevel: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await automerge.docAddAccount({
      id: "social:instagram:linked-maya",
      personId: "connection-linked-account",
      kind: "social",
      provider: "instagram",
      externalId: "linked-maya",
      handle: "linkedmaya",
      displayName: "Linked Maya",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    });

    await store.getState().updatePreferences({ display: { friendsMode: "all_content" } });
    store.getState().setActiveView("friends");
    store.getState().setSelectedAccount("social:instagram:linked-maya");
  });

  const promoteButton = page.getByRole("button", { name: "Promote to friend", exact: true });
  await expect(promoteButton).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Promote to Fam", exact: true })).toBeVisible();
  await promoteButton.click();

  await expect.poll(async () =>
    page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => {
          selectedPersonId: string | null;
          selectedAccountId: string | null;
          persons: Record<string, { relationshipStatus: string; careLevel: number }>;
        };
      };
      const state = store.getState();
      return {
        selectedPersonId: state.selectedPersonId,
        selectedAccountId: state.selectedAccountId,
        person: state.persons["connection-linked-account"],
      };
    }),
  ).toMatchObject({
    selectedPersonId: "connection-linked-account",
    selectedAccountId: null,
    person: {
      relationshipStatus: "friend",
      careLevel: 3,
    },
  });
});

test("relationship slider maps selected people across Followed, Friends, and Fam", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPerson: (person: unknown) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content" } }) => Promise<void>;
        setActiveView: (view: string) => void;
        setSelectedPerson: (personId: string | null) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPerson({
      id: "tier-slider-person",
      name: "Tier Slider Person",
      relationshipStatus: "connection",
      careLevel: 1,
      createdAt: now,
      updatedAt: now,
    });
    await store.getState().updatePreferences({ display: { friendsMode: "all_content" } });
    store.getState().setActiveView("friends");
    store.getState().setSelectedPerson("tier-slider-person");
  });

  const control = page.getByTestId("relationship-tier-control");
  await expect(control).toBeVisible({ timeout: 10_000 });
  await control.getByRole("button", { name: "Friends" }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  await expect.poll(async () =>
    page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => { persons: Record<string, { relationshipStatus: string; careLevel: number }> };
      };
      return store.getState().persons["tier-slider-person"];
    }),
  ).toMatchObject({ relationshipStatus: "friend", careLevel: 3 });

  await control.getByRole("button", { name: "Fam" }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect.poll(async () =>
    page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => { persons: Record<string, { relationshipStatus: string; careLevel: number }> };
      };
      return store.getState().persons["tier-slider-person"];
    }),
  ).toMatchObject({ relationshipStatus: "friend", careLevel: 5 });

  await control.getByRole("button", { name: "Followed" }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect.poll(async () =>
    page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => { persons: Record<string, { relationshipStatus: string; careLevel: number }> };
      };
      return store.getState().persons["tier-slider-person"];
    }),
  ).toMatchObject({ relationshipStatus: "connection", careLevel: 1 });
});

test("AI ranked friend suggestion dismiss hides the candidate without deleting the account", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddAccount: (account: unknown) => Promise<void>;
      docAddFeedItems: (items: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content" } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddAccount({
      id: "social:instagram:ida-suggestion",
      kind: "social",
      provider: "instagram",
      externalId: "ida-suggestion",
      handle: "ida",
      displayName: "Ida Wells",
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    });
    await automerge.docAddFeedItems([
      {
        globalId: "instagram:ida-suggestion:1",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 60_000,
        author: { id: "ida-suggestion", handle: "ida", displayName: "Ida Wells" },
        content: { text: "Travel day", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: {
          version: 3,
          method: "rules",
          inferredAt: now,
          scores: { life_update: 1, moment: 1 },
          tags: ["life_update", "moment"],
        },
      },
      {
        globalId: "instagram:ida-suggestion:2",
        platform: "instagram",
        contentType: "post",
        capturedAt: now,
        publishedAt: now - 120_000,
        author: { id: "ida-suggestion", handle: "ida", displayName: "Ida Wells" },
        content: { text: "Recommendation thread", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: false, archived: false, tags: [] },
        topics: [],
        contentSignals: {
          version: 3,
          method: "rules",
          inferredAt: now,
          scores: { recommendation: 1, discussion: 1, place: 1 },
          tags: ["recommendation", "discussion", "place"],
        },
      },
    ]);

    await store.getState().updatePreferences({ display: { friendsMode: "all_content" } });
    store.getState().setActiveView("friends");
  });

  const row = page.getByTestId("friend-candidate-suggestion").filter({ hasText: "Ida Wells" });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const dismissButton = row.getByRole("button", { name: "Dismiss" });
  await expect(dismissButton).toBeVisible({ timeout: 10_000 });
  await dismissButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect(row).toBeHidden({ timeout: 10_000 });

  await expect.poll(async () =>
    page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FREED_STORE__ as {
        getState: () => { accounts: Record<string, unknown> };
      };
      return Boolean(store.getState().accounts["social:instagram:ida-suggestion"]);
    }),
  ).toBe(true);
});

test("linking a channel from the graph context menu survives reload", async ({ app, page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccounts: (accounts: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content" } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPersons([
      {
        id: "friend-ada",
        name: "Ada Lovelace",
        relationshipStatus: "friend",
        careLevel: 5,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "friend-grace",
        name: "Grace Hopper",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await automerge.docAddAccounts([
      {
        id: "social:instagram:nora-ig",
        kind: "social",
        provider: "instagram",
        externalId: "nora-ig",
        handle: "nora",
        displayName: "Nora Quinn",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "social:linkedin:grace-li",
        personId: "friend-grace",
        kind: "social",
        provider: "linkedin",
        externalId: "grace-li",
        handle: "grace",
        displayName: "Grace Hopper",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
      },
    });
    store.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => {
    return viewport.evaluate((element) => Number((element as HTMLElement).dataset.graphNodeCount ?? "0"));
  }).toBeGreaterThanOrEqual(3);
  await waitForGraphPerfToSettle(page);

  const accountPoint = await graphNodeScreenPoint(page, { accountId: "social:instagram:nora-ig" });
  expect(accountPoint).not.toBeNull();

  await page.mouse.click(accountPoint!.x, accountPoint!.y, { button: "right" });
  const menu = page.getByTestId("friend-graph-context-menu");
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await menu.getByRole("button", { name: "Link to person" }).click();
  await menu.getByPlaceholder("Search people").fill("Ada");
  await menu.getByRole("button", { name: /Ada Lovelace/ }).click();

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            accounts: Record<string, { personId?: string }>;
          };
        }
      | undefined;
    return store?.getState().accounts["social:instagram:nora-ig"]?.personId === "friend-ada";
  }, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as
      | {
          getDocState: () => {
            accounts: Record<string, { personId?: string }>;
          } | null;
        }
      | undefined;
    return automerge?.getDocState()?.accounts["social:instagram:nora-ig"]?.personId === "friend-ada";
  }, { timeout: 10_000 });

  await page.reload();
  await app.waitForReady();
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            accounts: Record<string, { personId?: string }>;
          };
        }
      | undefined;
    return store?.getState().accounts["social:instagram:nora-ig"]?.personId === "friend-ada";
  }, { timeout: 10_000 });
});

test("pinning a person from the graph context menu survives reload", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccounts: (accounts: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content" } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPersons([
      {
        id: "friend-pinned",
        name: "Pinned Friend",
        relationshipStatus: "friend",
        careLevel: 5,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "friend-anchor",
        name: "Anchor Friend",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await automerge.docAddAccounts([
      {
        id: "social:instagram:pinned",
        personId: "friend-pinned",
        kind: "social",
        provider: "instagram",
        externalId: "pinned",
        handle: "pinned",
        displayName: "Pinned Channel",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
      },
    });
    store.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => {
    return viewport.evaluate((element) => Number((element as HTMLElement).dataset.graphNodeCount ?? "0"));
  }).toBeGreaterThanOrEqual(3);

  await expect.poll(async () =>
    page.evaluate(() => {
      const debug = (window as Record<string, unknown>).__FREED_GRAPH_DEBUG__ as
        | { nodes: Array<{ personId?: string }> }
        | undefined;
      return debug?.nodes.some((node) => node.personId === "friend-pinned") ?? false;
    }),
  { timeout: 10_000 }).toBe(true);
  const pinnedPosition = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const debug = w.__FREED_GRAPH_DEBUG__ as
      | {
          nodes: Array<{ personId?: string; x: number; y: number }>;
        }
      | undefined;
    const node = debug?.nodes.find((candidate) => candidate.personId === "friend-pinned");
    if (!node) {
      return null;
    }
    return {
      graphX: Math.round(node.x),
      graphY: Math.round(node.y),
    };
  });
  if (!pinnedPosition) {
    throw new Error("Friends graph debug node was unavailable for the pinned person");
  }

  const pinnedPoint = await graphNodeScreenPoint(page, { personId: "friend-pinned" });
  expect(pinnedPoint).not.toBeNull();
  await page.mouse.click(pinnedPoint!.x, pinnedPoint!.y, { button: "right" });
  const menu = page.getByTestId("friend-graph-context-menu");
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await menu.getByRole("button", { name: "Pin here" }).click();

  const storedPinnedPosition = await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            persons: Record<string, { graphPinned?: boolean; graphX?: number; graphY?: number }>;
          };
        }
      | undefined;
    const person = store?.getState().persons["friend-pinned"];
    if (!person?.graphPinned || typeof person.graphX !== "number" || typeof person.graphY !== "number") {
      return false;
    }
    return {
      graphX: person.graphX,
      graphY: person.graphY,
    };
  }, { timeout: 10_000 });
  const expectedPinnedPosition = await storedPinnedPosition.jsonValue() as { graphX: number; graphY: number };

  await page.waitForFunction((expected) => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as
      | {
          getDocState: () => {
            persons: Record<string, { graphPinned?: boolean; graphX?: number; graphY?: number }>;
          } | null;
        }
      | undefined;
    const person = automerge?.getDocState()?.persons["friend-pinned"];
    return person?.graphPinned === true &&
      person.graphX === expected.graphX &&
      person.graphY === expected.graphY;
  }, expectedPinnedPosition, { timeout: 10_000 });

  await page.reload();
  await app.waitForReady();
  await page.waitForFunction((expected) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            persons: Record<string, { graphPinned?: boolean; graphX?: number; graphY?: number }>;
          };
        }
      | undefined;
    const person = store?.getState().persons["friend-pinned"];
    return person?.graphPinned === true &&
      person.graphX === expected.graphX &&
      person.graphY === expected.graphY;
  }, expectedPinnedPosition, { timeout: 10_000 });
});

test("zooming the Friends graph keeps labels visible without collapsing the viewport", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccounts: (accounts: unknown[]) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content" } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPersons([
      {
        id: "friend-ada",
        name: "Ada Lovelace",
        relationshipStatus: "friend",
        careLevel: 5,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "connection-maya",
        name: "Maya Angelou",
        relationshipStatus: "connection",
        careLevel: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await automerge.docAddAccounts(
      Array.from({ length: 10 }, (_, index) => ({
        id: `social:instagram:dense-${index}`,
        personId: index < 4 ? "friend-ada" : index < 7 ? "connection-maya" : undefined,
        kind: "social",
        provider: index % 2 === 0 ? "instagram" : "x",
        externalId: `dense-${index}`,
        handle: `dense-${index}`,
        displayName: `Dense Node ${index}`,
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      })),
    );
    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
      },
    });
    store.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => {
      const debug = await readGraphSummary(page);
      if (!debug || debug.qualityMode !== "settled" || debug.metrics.visibleLabelCount <= 0) {
        return 0;
      }
      return debug.nodeCount;
    }, { timeout: 15_000 })
    .toBeGreaterThan(1);
  await waitForGraphPerfToSettle(page);

  const initial = await viewport.evaluate((element) => ({
    labels: Number((element as HTMLElement).dataset.visibleLabelCount ?? "0"),
    width: (element as HTMLElement).getBoundingClientRect().width,
    height: (element as HTMLElement).getBoundingClientRect().height,
    scale: (
      (window as typeof window & {
        __FREED_GRAPH_DEBUG__?: { transform: { scale: number } };
      }).__FREED_GRAPH_DEBUG__?.transform.scale ?? 0
    ),
  }));
  const initialDebug = await readGraphSummary(page);
  expect(initialDebug).not.toBeNull();
  expect(initialDebug!.metrics.visibleNodeLabelCount).toBeGreaterThan(0);

  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.down("Control");
  try {
    for (let index = 0; index < 4; index += 1) {
      await page.mouse.wheel(0, -260);
    }
  } finally {
    await page.keyboard.up("Control");
  }

  await expect
    .poll(async () => {
      const debug = await readGraphSummary(page);
      return debug?.transform.scale ?? 0;
    }, { timeout: 10_000 })
    .toBeGreaterThan(initial.scale);
  await expect
    .poll(async () => {
      const debug = await readGraphSummary(page);
      return debug?.metrics.visibleNodeLabelCount ?? 0;
    }, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const after = await viewport.evaluate((element) => ({
    labels: Number((element as HTMLElement).dataset.visibleLabelCount ?? "0"),
    width: (element as HTMLElement).getBoundingClientRect().width,
    height: (element as HTMLElement).getBoundingClientRect().height,
    scale: (
      (window as typeof window & {
        __FREED_GRAPH_DEBUG__?: { transform: { scale: number } };
      }).__FREED_GRAPH_DEBUG__?.transform.scale ?? 0
    ),
  }));
  const afterDebug = await readGraphSummary(page);
  expect(afterDebug).not.toBeNull();
  expect(after.labels).toBeGreaterThanOrEqual(afterDebug!.metrics.visibleProviderLabelCount);
  expect(Math.abs(after.width - initial.width)).toBeLessThan(4);
  expect(Math.abs(after.height - initial.height)).toBeLessThan(4);
  expect(after.scale).toBeGreaterThan(initial.scale);
});

test("pinching the Friends graph zooms around the active two-touch midpoint", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content"; friendsSidebarOpen: boolean } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };
    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        friendsSidebarOpen: true,
      },
    });
    store.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await readGraphDebug(page))?.nodes.length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const debug = await readGraphSummary(page);
      return Boolean(debug && debug.qualityMode === "settled" && debug.transform.scale > 0);
    }, { timeout: 10_000 })
    .toBe(true);
  await waitForGraphPerfToSettle(page);

  const box = await readGraphViewportBox(page);
  if (!box) {
    throw new Error("Friends graph viewport is not visible");
  }

  const before = await readGraphDebug(page);
  expect(before).not.toBeNull();
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const initialWorldPoint = {
    x: (box.width / 2 - before!.transform.x) / before!.transform.scale,
    y: (box.height / 2 - before!.transform.y) / before!.transform.scale,
  };
  const panDelta = { x: 48, y: 32 };

  await viewport.evaluate(async (element, gesture) => {
    const target = element as HTMLElement;
    const makeTouch = (identifier: number, x: number, y: number) => new Touch({
      identifier,
      target,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      pageX: x,
      pageY: y,
      radiusX: 8,
      radiusY: 8,
      force: 1,
    });
    const dispatchTouch = (
      type: "touchstart" | "touchmove",
      touches: Touch[],
      changedTouches: Touch[],
    ) => {
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches,
      }));
    };
    const nextFrame = () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    const firstStart = makeTouch(11, gesture.centerX - 80, gesture.centerY);
    dispatchTouch("touchstart", [firstStart], [firstStart]);
    const secondStart = makeTouch(12, gesture.centerX + 80, gesture.centerY);
    dispatchTouch("touchstart", [firstStart, secondStart], [secondStart]);
    await nextFrame();
    const firstMoved = makeTouch(
      11,
      gesture.centerX - 140 + gesture.panDelta.x,
      gesture.centerY - 18 + gesture.panDelta.y,
    );
    const secondMoved = makeTouch(
      12,
      gesture.centerX + 140 + gesture.panDelta.x,
      gesture.centerY + 18 + gesture.panDelta.y,
    );
    dispatchTouch("touchmove", [firstMoved, secondMoved], [firstMoved, secondMoved]);
    await nextFrame();
  }, { centerX, centerY, panDelta });

  await expect
    .poll(async () => (await readGraphDebug(page))?.transform.scale ?? before!.transform.scale, {
      timeout: 8_000,
    })
    .toBeGreaterThan(before!.transform.scale);

  const midpointTolerancePx = 64;
  await expect
    .poll(async () => {
      const after = await readGraphDebug(page);
      if (!after) {
        return Number.POSITIVE_INFINITY;
      }
      const projectedInitialMidpoint = {
        x: box.x + initialWorldPoint.x * after.transform.scale + after.transform.x,
        y: box.y + initialWorldPoint.y * after.transform.scale + after.transform.y,
      };
      return Math.max(
        Math.abs(projectedInitialMidpoint.x - (centerX + panDelta.x)),
        Math.abs(projectedInitialMidpoint.y - (centerY + panDelta.y)),
      );
    }, { timeout: 8_000 })
    .toBeLessThanOrEqual(midpointTolerancePx);

  const afterPinch = await readGraphDebug(page);
  expect(afterPinch).not.toBeNull();

  await viewport.evaluate(async (element, gesture) => {
    const target = element as HTMLElement;
    const makeTouch = (identifier: number, x: number, y: number) => new Touch({
      identifier,
      target,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      pageX: x,
      pageY: y,
      radiusX: 8,
      radiusY: 8,
      force: 1,
    });
    const dispatchTouch = (
      type: "touchmove" | "touchend",
      touches: Touch[],
      changedTouches: Touch[],
    ) => {
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches,
      }));
    };
    const nextFrame = () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    const firstEnd = makeTouch(
      11,
      gesture.centerX - 140 + gesture.panDelta.x,
      gesture.centerY - 18 + gesture.panDelta.y,
    );
    const secondCurrent = makeTouch(
      12,
      gesture.centerX + 140 + gesture.panDelta.x,
      gesture.centerY + 18 + gesture.panDelta.y,
    );
    dispatchTouch("touchend", [secondCurrent], [firstEnd]);
    await nextFrame();
    const secondMoved = makeTouch(
      12,
      gesture.centerX + 204 + gesture.panDelta.x,
      gesture.centerY + 42 + gesture.panDelta.y,
    );
    dispatchTouch("touchmove", [secondMoved], [secondMoved]);
    await nextFrame();
    dispatchTouch("touchend", [], [secondMoved]);
  }, { centerX, centerY, panDelta });

  await expect
    .poll(async () => {
      const afterSingleFingerPan = await readGraphDebug(page);
      if (!afterSingleFingerPan) return 0;
      return Math.hypot(
        afterSingleFingerPan.transform.x - afterPinch!.transform.x,
        afterSingleFingerPan.transform.y - afterPinch!.transform.y,
      );
    }, { timeout: 8_000 })
    .toBeGreaterThan(40);
});

test("stress Friends graph keeps labels resident and avoids scene rebuilds during pan", async ({ app, page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedStressIdentityGraph(page);

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => {
      const debug = await readGraphSummary(page);
      if (
        !debug ||
        debug.qualityMode !== "settled" ||
        debug.metrics.visibleLabelCount <= 0 ||
        !debug.metrics.capped
      ) {
        return 0;
      }
      return debug.metrics.sourceNodeCount ?? debug.nodeCount;
    }, { timeout: 45_000 })
    .toBeGreaterThan(1_000);

  const seededGraph = await readGraphSummary(page);
  expect(seededGraph).not.toBeNull();
  expect(seededGraph!.metrics.visibleLabelCount).toBeGreaterThan(0);
  expect(seededGraph!.metrics.visibleNodeCount ?? seededGraph!.nodeCount).toBeLessThanOrEqual(1_100);
  expect(seededGraph!.metrics.capped).toBe(true);

  const initial = await waitForGraphPerfToSettle(page);
  expect(initial).not.toBeNull();
  expect(initial!.metrics.modelBuildMs).toBeLessThan(500);
  expect(initial!.metrics.layoutMs).toBeLessThan(1_000);
  expect(initial!.metrics.sceneSyncMs).toBeLessThan(250);

  const benchmarkPoint = await graphNodeScreenPoint(page, { personId: "stress-person-0" });
  expect(benchmarkPoint).not.toBeNull();

  await page.mouse.move(benchmarkPoint!.x, benchmarkPoint!.y);
  const afterHover = await readGraphDebug(page);
  expect(afterHover).not.toBeNull();
  expect(afterHover!.metrics.sceneSyncMs).toBeLessThan(250);

  await page.mouse.click(benchmarkPoint!.x, benchmarkPoint!.y);
  const afterSelection = await waitForGraphSceneSyncAfter(page, afterHover!.metrics.sceneSyncCount);
  expect(afterSelection).not.toBeNull();
  expect(afterSelection!.metrics.sceneSyncMs).toBeLessThan(250);

  const box = await viewport.boundingBox();
  if (!box) {
    throw new Error("Friends graph viewport is not visible");
  }
  const startX = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.45;

  let duringPan: Awaited<ReturnType<typeof readGraphDebug>> = null;
  try {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 260, startY + 70, { steps: 18 });

    await expect
      .poll(async () => (await readGraphDebug(page))?.qualityMode, { timeout: 10_000 })
      .toBe("interactive");

    duringPan = await readGraphDebug(page);
    expect(duringPan).not.toBeNull();
    expect(duringPan!.metrics.visibleLabelCount).toBe(initial!.metrics.visibleLabelCount);
    expect(duringPan!.metrics.rendererLabelCount).toBe(initial!.metrics.rendererLabelCount);
    expect(duringPan!.metrics.readyRendererLabelCount).toBeGreaterThan(0);
    await page.mouse.move(startX + 300, startY + 90, { steps: 4 });
    await page.waitForTimeout(250);
    const steadyPan = await readGraphDebug(page);
    expect(steadyPan).not.toBeNull();
    expect(steadyPan!.metrics.sceneSyncCount).toBe(duringPan!.metrics.sceneSyncCount);
    expect(steadyPan!.metrics.edgeRebuildCount).toBe(duringPan!.metrics.edgeRebuildCount);
    expect(steadyPan!.metrics.rendererLabelCount).toBe(duringPan!.metrics.rendererLabelCount);
    expect(steadyPan!.metrics.readyRendererLabelCount).toBeGreaterThan(0);
    expect(steadyPan!.metrics.readyRendererLabelCount).toBeLessThanOrEqual(
      steadyPan!.metrics.rendererLabelCount,
    );
    expect(steadyPan!.metrics.transformOnlySyncCount).toBeGreaterThan(
      duringPan!.metrics.transformOnlySyncCount,
    );
    expect(steadyPan!.metrics.sceneSyncMs).toBeLessThan(60);
  } finally {
    await page.mouse.up();
  }

  const beforeZoom = await readGraphDebug(page);
  expect(beforeZoom).not.toBeNull();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  try {
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, -320);
    }
  } finally {
    await page.keyboard.up("Control");
  }

  await expect
    .poll(async () => (await readGraphDebug(page))?.transform.scale ?? beforeZoom!.transform.scale, {
      timeout: 8_000,
    })
    .toBeGreaterThan(beforeZoom!.transform.scale);

  const afterZoom = await waitForGraphSceneSyncAfter(page, beforeZoom!.metrics.sceneSyncCount, 8_000);
  expect(afterZoom).not.toBeNull();
  expect(afterZoom!.metrics.sceneSyncMs).toBeLessThan(250);
  expect(afterZoom!.transform.scale).toBeGreaterThan(beforeZoom!.transform.scale);
});

test("dense Friends graph stays visually structured in Scriptorium", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddPersons: (persons: unknown[]) => Promise<void>;
      docAddAccounts: (accounts: unknown[]) => Promise<void>;
      docAddRssFeed: (feed: unknown) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as {
      getState: () => {
        updatePreferences: (patch: { display: { friendsMode: "all_content"; themeId: string } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    await automerge.docAddPersons([
      { id: "friend-ada", name: "Ada Lovelace", relationshipStatus: "friend", careLevel: 5, createdAt: now, updatedAt: now },
      { id: "friend-grace", name: "Grace Hopper", relationshipStatus: "friend", careLevel: 4, createdAt: now, updatedAt: now },
      { id: "friend-katherine", name: "Katherine Johnson", relationshipStatus: "friend", careLevel: 4, createdAt: now, updatedAt: now },
      { id: "connection-maya", name: "Maya Angelou", relationshipStatus: "connection", careLevel: 2, createdAt: now, updatedAt: now },
      { id: "connection-james", name: "James Baldwin", relationshipStatus: "connection", careLevel: 2, createdAt: now, updatedAt: now },
    ]);
    await automerge.docAddAccounts([
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `social:instagram:ada-${index}`,
        personId: "friend-ada",
        kind: "social",
        provider: index % 2 === 0 ? "instagram" : "x",
        externalId: `ada-${index}`,
        handle: `ada-${index}`,
        displayName: `Ada Channel ${index}`,
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `social:linkedin:grace-${index}`,
        personId: "friend-grace",
        kind: "social",
        provider: index % 2 === 0 ? "linkedin" : "x",
        externalId: `grace-${index}`,
        handle: `grace-${index}`,
        displayName: `Grace Channel ${index}`,
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `social:instagram:maya-${index}`,
        personId: "connection-maya",
        kind: "social",
        provider: index % 2 === 0 ? "instagram" : "x",
        externalId: `maya-${index}`,
        handle: `maya-${index}`,
        displayName: `Maya Channel ${index}`,
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `social:x:outer-${index}`,
        kind: "social",
        provider: index % 2 === 0 ? "x" : "instagram",
        externalId: `outer-${index}`,
        handle: `outer-${index}`,
        displayName: `Outer Channel ${index}`,
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      })),
    ]);
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        automerge.docAddRssFeed({
          url: `https://example.com/feed-${index}.xml`,
          title: `Feed ${index}`,
          enabled: true,
          trackUnread: true,
        }),
      ),
    );

    await store.getState().updatePreferences({
      display: {
        friendsMode: "all_content",
        themeId: "scriptorium",
      },
    });
    store.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => {
    return viewport.evaluate((element) => Number((element as HTMLElement).dataset.graphNodeCount ?? "0"));
  }).toBeGreaterThan(20);
  await page.getByRole("button", { name: "Fit all" }).click();

  const debug = await readGraphDebug(page);
  expect(debug).not.toBeNull();
  expect(debug!.regions.length).toBeGreaterThanOrEqual(3);
  expect(debug?.regions.some((region) => region.provider === "rss")).toBe(true);
  expect(debug?.regions.some((region) => region.provider === "instagram")).toBe(true);
  await expect.poll(async () => {
    return (await readGraphDebug(page))?.metrics.visibleLabelCount ?? 0;
  }, { timeout: 10_000 }).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// IPC mock verification
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Update mock availability
// ---------------------------------------------------------------------------
